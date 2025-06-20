const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB connection
console.log('Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
console.log('MONGODB_URI (masked):', process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/\/\/.*@/, '//***:***@') : 'Not found');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LumetryMedia';

if (!process.env.MONGODB_URI) {
  console.warn('⚠️  MONGODB_URI not found in environment variables. Using localhost fallback.');
  console.warn('⚠️  Make sure your .env file is in the root directory and contains MONGODB_URI');
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
})
.then(() => {
  console.log('✅ Connected to MongoDB - LumetryMedia database');
  console.log('✅ Using database:', mongoose.connection.db.databaseName);
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  console.error('❌ Connection string being used:', MONGODB_URI.replace(/\/\/.*@/, '//***:***@'));
});

// Service Schema
const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, default: 'photography' },
  dependsOn: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
  dependencyType: { type: String, enum: ['same_day', 'same_quote', null], default: null },
  isSubservice: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

const Service = mongoose.model('Service', serviceSchema, 'website');

// Routes
// Get all services
app.get('/api/services', async (req, res) => {
  try {
    const services = await Service.find().populate('dependsOn', 'name').sort({ sortOrder: 1, createdAt: 1 });
    
    // Sort services with subservices appearing after their parents (now considering sortOrder)
    const sortedServices = sortServicesWithSubservices(services);
    
    res.json(sortedServices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to sort services with subservices after their parents
function sortServicesWithSubservices(services) {
  const mainServices = services.filter(s => !s.isSubservice).sort((a, b) => a.sortOrder - b.sortOrder);
  const subservices = services.filter(s => s.isSubservice);
  
  const result = [];
  
  mainServices.forEach(mainService => {
    result.push(mainService);
    
    // Add subservices that depend on this main service, sorted by sortOrder
    const relatedSubservices = subservices
      .filter(sub => sub.dependsOn && sub.dependsOn._id.toString() === mainService._id.toString())
      .sort((a, b) => a.sortOrder - b.sortOrder);
    
    result.push(...relatedSubservices);
  });
  
  // Add any orphaned subservices (subservices without valid parent), sorted by sortOrder
  const orphanedSubservices = subservices
    .filter(sub => !sub.dependsOn || !mainServices.find(main => main._id.toString() === sub.dependsOn._id.toString()))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  
  result.push(...orphanedSubservices);
  
  return result;
}

// Create service
app.post('/api/services', async (req, res) => {
  try {
    // Auto-assign sortOrder if not provided
    if (!req.body.sortOrder) {
      const maxSortOrder = await Service.findOne().sort({ sortOrder: -1 }).select('sortOrder');
      req.body.sortOrder = (maxSortOrder?.sortOrder || 0) + 1;
    }
    
    const service = new Service(req.body);
    await service.save();
    await service.populate('dependsOn', 'name');
    res.status(201).json(service);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update service
app.put('/api/services/:id', async (req, res) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('dependsOn', 'name');
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json(service);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete service
app.delete('/api/services/:id', async (req, res) => {
  try {
    const serviceId = req.params.id;
    
    // Check if any other services depend on this service
    const dependentServices = await Service.find({ dependsOn: serviceId }).select('name');
    
    if (dependentServices.length > 0) {
      const dependentNames = dependentServices.map(s => s.name).join(', ');
      return res.status(400).json({ 
        error: `Cannot delete this service. The following services depend on it: ${dependentNames}. Please remove the dependencies first.`,
        dependentServices: dependentNames
      });
    }
    
    const service = await Service.findByIdAndDelete(serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate service dependencies
app.post('/api/validate-service', async (req, res) => {
  try {
    const { serviceId, currentQuote } = req.body;
    const service = await Service.findById(serviceId).populate('dependsOn', 'name');
    
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    // If no dependency, service can be added
    if (!service.dependsOn) {
      return res.json({ canAdd: true });
    }
    
    const dependencyId = service.dependsOn._id.toString();
    const dependencyName = service.dependsOn.name;
    
    // Check if dependency exists based on type
    let dependencyFound = false;
    
    if (service.dependencyType === 'same_quote') {
      // Check if dependency exists anywhere in the quote
      dependencyFound = currentQuote.days.some(day => 
        day.services.some(s => s.id === dependencyId)
      );
    } else if (service.dependencyType === 'same_day') {
      // For same_day, we need the dayIndex to check
      const { dayIndex } = req.body;
      if (dayIndex !== undefined && currentQuote.days[dayIndex]) {
        dependencyFound = currentQuote.days[dayIndex].services.some(s => s.id === dependencyId);
      }
    }
    
    if (dependencyFound) {
      res.json({ canAdd: true });
    } else {
      res.json({ 
        canAdd: false, 
        error: `Cannot add "${service.name}". It requires "${dependencyName}" to be added ${service.dependencyType === 'same_day' ? 'on the same day' : 'somewhere in the quote'} first.`,
        dependency: {
          name: dependencyName,
          type: service.dependencyType
        }
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate PDF quote
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { quoteData } = req.body;
    
    console.log('🔄 Starting PDF generation...');
    
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-features=VizDisplayCompositor'
      ],
      timeout: 30000
    });
    
    const page = await browser.newPage();
    
    console.log('📝 Generating HTML content...');
    const html = await generateQuoteHTML(quoteData);
    
    console.log('🌐 Setting page content...');
    await page.setContent(html, { 
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    console.log('📄 Creating PDF...');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      },
      timeout: 30000
    });
    
    console.log('🔒 Closing browser...');
    await browser.close();
    
    console.log('✅ PDF generated successfully');
    const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=lumetry-quote-${currentDate}.pdf`);
    res.send(pdf);
  } catch (error) {
    console.error('❌ PDF generation error:', error.message);
    console.error('❌ Full error:', error);
    
    // Try to provide a more helpful error message
    let errorMessage = 'Failed to generate PDF';
    if (error.message.includes('Failed to launch')) {
      errorMessage = 'Browser launch failed. Please try again.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'PDF generation timed out. Please try again.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error.message 
    });
  }
});

// Helper function to format date for PDF
function parseStoredDate(dateString) {
    if (!dateString) return null;
    
    // Handle both old ISO format and new YYYY-MM-DD format
    if (dateString.includes('T')) {
        // Old ISO format - convert to local date
        return new Date(dateString);
    } else {
        // New YYYY-MM-DD format - parse as local date
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
}

function formatCurrency(amount) {
    // Check if the amount has decimal places
    const hasDecimals = amount % 1 !== 0;
    
    return amount.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: 2
    });
}

function formatDateForPDF(date) {
    const options = { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    };
    return date.toLocaleDateString('en-US', options);
}

async function generateQuoteHTML(quoteData) {
  const { days, subtotal, total, discountPercentage, discountAmount, clientName } = quoteData;
  
  // Get all services for subservice checking
  const allServices = await Service.find();
  
  // Read logo file and convert to base64
  let logoBase64 = '';
  try {
    const logoPath = path.join(__dirname, 'public', 'assets', 'logo.png');
    const logoBuffer = fs.readFileSync(logoPath);
    logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch (error) {
    console.warn('Logo file not found for PDF generation:', error.message);
  }
  
  let servicesHTML = '';
  days.forEach((day, dayIndex) => {
    if (day.services.length > 0) {
      // Generate a row for each service
      day.services.forEach((service, serviceIndex) => {
        const serviceDefinition = allServices.find(s => s._id.toString() === service.id);
        const isSubservice = serviceDefinition?.isSubservice || false;
        const serviceDisplayName = isSubservice ? `└─ ${service.name}` : service.name;
        const serviceStyle = isSubservice ? 'color: #64748b; padding-left: 30px;' : 'color: #1e293b;';
        
        const dayLabel = serviceIndex === 0 ? (day.date ? formatDateForPDF(parseStoredDate(day.date)) : `Day ${dayIndex + 1}`) : '';
        
        servicesHTML += `
          <tr${serviceIndex === day.services.length - 1 && dayIndex < days.length - 1 ? ' class="day-separator"' : ''}>
            <td style="${serviceIndex === 0 ? 'font-weight: 600; color: #1e293b;' : ''}">${dayLabel}</td>
            <td style="${serviceStyle}">
              ${serviceDisplayName}
            </td>
            <td style="text-align: center; color: #1e293b;">
              ${service.quantity || 1}
            </td>
            <td style="text-align: right; font-weight: 600; color: #1e293b;">
              ${formatCurrency(service.price * (service.quantity || 1))}
            </td>
          </tr>
        `;
      });
    } else {
      // Empty day
      const emptyDayLabel = day.date ? formatDateForPDF(parseStoredDate(day.date)) : `Day ${dayIndex + 1}`;
      
      servicesHTML += `
        <tr>
          <td style="font-weight: 600; color: #1e293b;">${emptyDayLabel}</td>
          <td style="color: #64748b; font-style: italic;">
            No services selected
          </td>
          <td style="text-align: center; color: #64748b;">
            -
          </td>
          <td style="text-align: right; color: #64748b;">
            $0
          </td>
        </tr>
      `;
    }
  });
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Conference Services Quote</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
          border-bottom: 2px solid #4F46E5;
          padding-bottom: 20px;
        }
        .header h1 {
          color: #4F46E5;
          margin: 0;
          font-size: 28px;
        }
        .header p {
          color: #666;
          margin: 10px 0 0 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        th {
          background-color: #f8fafc;
          padding: 16px 12px;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          color: #374151;
        }
        th:first-child {
          width: 140px;
        }
        th:nth-child(2) {
          width: 410px;
        }
        th:nth-child(3) {
          width: 80px;
        }
        th:last-child {
          width: 120px;
        }
        td {
          padding: 16px 12px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }
        td:first-child {
          width: 140px;
          white-space: nowrap;
        }
        td:nth-child(2) {
          width: 410px;
          word-wrap: break-word;
        }
        td:nth-child(3) {
          width: 80px;
        }
        td:last-child {
          width: 120px;
        }
        .day-separator {
          border-bottom: 2px solid #f1f5f9 !important;
          margin-bottom: 8px;
        }
        .totals {
          margin-top: 30px;
          text-align: right;
        }
        .totals div {
          margin: 10px 0;
          font-size: 18px;
        }
        .total-final {
          font-weight: bold;
          font-size: 24px;
          color: #4F46E5;
          border-top: 2px solid #4F46E5;
          padding-top: 10px;
          margin-top: 20px;
        }
        .footer {
          margin-top: 40px;
          text-align: center;
          color: #666;
          font-size: 14px;
        }
        .contact {
          color: #4F46E5;
          font-weight: 600;
        }
        .bold {
          font-weight: bold;
        }
      </style>
    </head>
    <body>
             <div class="header">
         ${logoBase64 ? `<img src="${logoBase64}" alt="Lumetry Media" style="max-height: 80px; margin-bottom: 20px;">` : ''}
         <h1>Conference Services Quote</h1>
         <p>Professional photography and/or videography services</p>
         <p><strong>Created on:</strong> ${new Date().toLocaleDateString()}${clientName ? ` | <strong>Client:</strong> ${clientName}` : ''}</p>
       </div>
      
      <table>
        <thead>
          <tr>
            <th style="text-align: left;">Day</th>
            <th style="text-align: left;">Service</th>
            <th style="text-align: center;">Qty</th>
            <th style="text-align: right;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${servicesHTML}
        </tbody>
      </table>
      
      <div class="totals">
        ${discountPercentage > 0 ? `
          <div>Subtotal: ${formatCurrency(subtotal)}</div>
          <div>Discount (${discountPercentage}%): -${formatCurrency(discountAmount)}</div>
          <div class="total-final">Total: ${formatCurrency(total)}</div>
        ` : `
          <div class="total-final">Total: ${formatCurrency(total)}</div>
        `}
      </div>
      
      <div class="footer">
        <p><strong>* Pricing may change. This is a quote, not an official invoice</strong></p>
        <p class="contact">Contact us for any questions - sales@lumetrymedia.com</p>
      </div>
    </body>
    </html>
  `;
}

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Initialize default services
async function initializeServices() {
  try {
    // Wait for database connection
    if (mongoose.connection.readyState !== 1) {
      console.log('⏳ Waiting for database connection...');
      await new Promise((resolve, reject) => {
        mongoose.connection.once('connected', resolve);
        mongoose.connection.once('error', reject);
        setTimeout(() => reject(new Error('Database connection timeout')), 10000);
      });
    }

    const count = await Service.countDocuments();
    console.log(`📊 Found ${count} existing services in database`);
    
    // Check if any services need sortOrder assignment
    const servicesWithoutSortOrder = await Service.find({ $or: [{ sortOrder: { $exists: false } }, { sortOrder: 0 }] });
    if (servicesWithoutSortOrder.length > 0) {
      console.log(`🔄 Assigning sortOrder to ${servicesWithoutSortOrder.length} existing services`);
      for (let i = 0; i < servicesWithoutSortOrder.length; i++) {
        await Service.findByIdAndUpdate(servicesWithoutSortOrder[i]._id, { sortOrder: i + 1 });
      }
      console.log('✅ sortOrder assigned to existing services');
    }
    
    if (count === 0) {
      const defaultServices = [
        { name: 'Event Photography', price: 800, category: 'Photography', sortOrder: 1 },
        { name: 'Event Videography', price: 1200, category: 'Videography', sortOrder: 2 },
        { name: 'Headshot Booth', price: 500, category: 'Headshot Booth', sortOrder: 3 },
        { name: 'Drone Photography', price: 400, category: 'Photography', sortOrder: 4 },
        { name: 'Photo Editing', price: 300, category: 'Other', sortOrder: 5 }
      ];
      
      await Service.insertMany(defaultServices);
      console.log('✅ Default services initialized successfully');
    } else {
      console.log('✅ Using existing services from database');
    }
  } catch (error) {
    console.error('❌ Error initializing services:', error.message);
    console.error('❌ The application will continue but may not have default services');
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initializeServices();
});

// Saved Quote Schema
const savedQuoteSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  quoteData: { type: Object, required: true },
  clientName: { type: String, default: null }
}, { timestamps: true });

const SavedQuote = mongoose.model('SavedQuote', savedQuoteSchema, 'savedQuotes');

// Save quote endpoint
app.post('/api/save-quote', async (req, res) => {
  try {
    const { name, quoteData, clientName } = req.body;
    
    if (!name || !quoteData) {
      return res.status(400).json({ error: 'Name and quote data are required' });
    }

    // Check if quote with this name already exists
    const existingQuote = await SavedQuote.findOne({ name });
    
    if (existingQuote) {
      return res.status(409).json({ 
        error: 'Quote name already exists',
        existingQuote: {
          name: existingQuote.name,
          createdAt: existingQuote.createdAt,
          updatedAt: existingQuote.updatedAt
        }
      });
    }

    // Save new quote
    const savedQuote = new SavedQuote({
      name,
      quoteData,
      clientName: clientName || null
    });

    const result = await savedQuote.save();
    res.json({ success: true, id: result._id });
  } catch (error) {
    console.error('Error saving quote:', error);
    res.status(500).json({ error: 'Failed to save quote' });
  }
});

// Overwrite existing quote endpoint
app.post('/api/overwrite-quote', async (req, res) => {
  try {
    const { name, quoteData, clientName } = req.body;
    
    if (!name || !quoteData) {
      return res.status(400).json({ error: 'Name and quote data are required' });
    }

    const result = await SavedQuote.findOneAndUpdate(
      { name },
      { 
        quoteData,
        clientName: clientName || null
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error overwriting quote:', error);
    res.status(500).json({ error: 'Failed to overwrite quote' });
  }
});

// Get all saved quotes endpoint
app.get('/api/saved-quotes', async (req, res) => {
  try {
    const quotes = await SavedQuote.find({}, {
      name: 1,
      clientName: 1,
      createdAt: 1,
      updatedAt: 1,
      // Include basic quote info for preview
      'quoteData.total': 1,
      'quoteData.days': 1
    }).sort({ updatedAt: -1 });

    res.json(quotes);
  } catch (error) {
    console.error('Error fetching saved quotes:', error);
    res.status(500).json({ error: 'Failed to fetch saved quotes' });
  }
});

// Load specific quote endpoint
app.get('/api/load-quote/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    const quote = await SavedQuote.findOne({ name });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.json(quote);
  } catch (error) {
    console.error('Error loading quote:', error);
    res.status(500).json({ error: 'Failed to load quote' });
  }
});

// Delete saved quote endpoint
app.delete('/api/saved-quotes/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    const result = await SavedQuote.findOneAndDelete({ name });
    
    if (!result) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote:', error);
    res.status(500).json({ error: 'Failed to delete quote' });
  }
});

// Update service order endpoint
app.post('/api/services/reorder', async (req, res) => {
  try {
    const { serviceUpdates } = req.body;
    
    if (!Array.isArray(serviceUpdates) || serviceUpdates.length === 0) {
      return res.status(400).json({ error: 'Service updates array is required' });
    }
    
    // Update sortOrder for each service
    const updatePromises = serviceUpdates.map(update => 
      Service.findByIdAndUpdate(update.id, { sortOrder: update.sortOrder })
    );
    
    await Promise.all(updatePromises);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating service order:', error);
    res.status(500).json({ error: 'Failed to update service order' });
  }
}); 