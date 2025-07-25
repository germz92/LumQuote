const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const htmlPdf = require('html-pdf-node');
const ExcelJS = require('exceljs');
const fs = require('fs');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Serve login page without authentication
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.APP_PASSWORD || 'admin123'; // Default password
  
  if (password === correctPassword) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Protect static files and main routes
app.use((req, res, next) => {
  // Allow access to login page, login API, and assets needed for login page
  if (req.path === '/login' || 
      req.path === '/api/login' || 
      req.path.startsWith('/login.') ||
      req.path.startsWith('/assets/') ||
      req.path === '/styles.css') {
    next();
  } else {
    requireAuth(req, res, next);
  }
});

app.use(express.static('public'));

// MongoDB connection
console.log('Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
console.log('MONGODB_URI (masked):', process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/\/\/.*@/, '//***:***@') : 'Not found');
console.log('All environment variables:', Object.keys(process.env).filter(key => key.includes('MONGO')));

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
  description: { type: String, maxlength: 200, default: '' },
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
    
    console.log('📝 Generating HTML content...');
    const html = await generateQuoteHTML(quoteData);
    
    console.log('📄 Creating PDF...');
    const options = {
      format: 'A4',
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    };
    
    const file = { content: html };
    const pdf = await htmlPdf.generatePdf(file, options);
    
    console.log('✅ PDF generated successfully');
    const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=lumetry-quote-${currentDate}.pdf`);
    res.send(pdf);
  } catch (error) {
    console.error('❌ PDF generation error:', error.message);
    console.error('❌ Full error:', error);
    
    res.status(500).json({ 
      error: 'Failed to generate PDF. Please try again.',
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
  const { days, subtotal, total, discountPercentage, discountAmount, clientName, quoteTitle } = quoteData;
  
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
        const serviceDescription = service.description !== undefined ? service.description : (serviceDefinition?.description || '');
        const serviceStyle = isSubservice ? 'color: #64748b; padding-left: 30px;' : 'color: #1e293b;';
        const isTentative = service.tentative || false;
        const tentativeStyle = isTentative ? 'color: #059669;' : '';
        const tentativeLabel = isTentative ? ' (Tentative)' : '';
        const tentativePrice = isTentative ? `(${formatCurrency(service.price * (service.quantity || 1))})` : formatCurrency(service.price * (service.quantity || 1));
        
        const dayLabel = serviceIndex === 0 ? (day.date ? formatDateForPDF(parseStoredDate(day.date)) : `Day ${dayIndex + 1}`) : '';
        
        servicesHTML += `
          <tr${serviceIndex === day.services.length - 1 && dayIndex < days.length - 1 ? ' class="day-separator"' : ''}>
            <td style="${serviceIndex === 0 ? 'font-weight: 600; color: #1e293b;' : ''}">${dayLabel}</td>
            <td style="${serviceStyle} ${tentativeStyle}">
              ${serviceDisplayName}${tentativeLabel}
            ${serviceDescription ? `<br><small style="color: #64748b; font-size: 10px; line-height: 1.3;">${serviceDescription}</small>` : ''}
            </td>
            <td style="text-align: center; color: #1e293b;">
              ${service.quantity || 1}
            </td>
            <td style="text-align: right; font-weight: 600; ${tentativeStyle}">
              ${tentativePrice}
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
      <title>${quoteTitle || 'Conference Services Quote'}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.4;
          color: #333;
          max-width: 900px;
          margin: 0 auto;
          padding: 15px;
          font-size: 12px;
        }
        .header {
          text-align: center;
          margin-bottom: 25px;
          border-bottom: 2px solid #4F46E5;
          padding-bottom: 15px;
        }
        .header h1 {
          color: #4F46E5;
          margin: 0;
          font-size: 22px;
        }
        .header p {
          color: #666;
          margin: 8px 0 0 0;
          font-size: 11px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
          font-size: 11px;
        }
        th {
          background-color: #f8fafc;
          padding: 10px 8px;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          color: #374151;
          font-size: 11px;
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
          padding: 8px 8px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
          font-size: 11px;
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
          margin-top: 20px;
          text-align: right;
          page-break-inside: avoid;
        }
        .totals div {
          margin: 6px 0;
          font-size: 14px;
        }
        .total-final {
          font-weight: bold;
          font-size: 18px;
          color: #4F46E5;
          border-top: 2px solid #4F46E5;
          padding-top: 8px;
          margin-top: 15px;
        }
        .footer {
          margin-top: 25px;
          text-align: center;
          color: #666;
          font-size: 11px;
          page-break-inside: avoid;
          page-break-before: avoid;
        }
        .contact {
          color: #4F46E5;
          font-weight: 600;
        }
        .bold {
          font-weight: bold;
        }
        
        /* Page break control */
        .totals-and-footer {
          page-break-inside: avoid;
          page-break-before: avoid;
        }
        
        /* Ensure table rows don't break awkwardly */
        tr {
          page-break-inside: avoid;
        }
        
        /* Keep day groups together when possible */
        .day-group {
          page-break-inside: avoid;
        }
      </style>
    </head>
    <body>
             <div class="header">
         ${logoBase64 ? `<img src="${logoBase64}" alt="Lumetry Media" style="max-height: 80px; margin-bottom: 20px;">` : ''}
         <h1>${quoteTitle || 'Conference Services Quote'}</h1>
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
      
      <div class="totals-and-footer">
        <div class="totals">
          ${discountPercentage > 0 ? `
            <div>Subtotal: ${formatCurrency(subtotal)}</div>
            <div>Discount (${discountPercentage}%): -${formatCurrency(discountAmount)}</div>
            <div class="total-final">Grand Total: ${formatCurrency(total)}</div>
          ` : `
            <div class="total-final">Grand Total: ${formatCurrency(total)}</div>
          `}
          ${(() => {
            const tentativeSubtotal = days.reduce((total, day) => {
              return total + day.services.reduce((dayTotal, service) => {
                return dayTotal + (service.tentative ? (service.price * (service.quantity || 1)) : 0);
              }, 0);
            }, 0);
            if (tentativeSubtotal > 0) {
              const tentativeDiscountAmount = tentativeSubtotal * (discountPercentage / 100);
              const finalTentativeTotal = tentativeSubtotal - tentativeDiscountAmount;
              return `<div style="color: #059669; font-weight: 600; margin-top: 8px;">Tentative Total: (${formatCurrency(finalTentativeTotal)})</div>`;
            }
            return '';
          })()}
        </div>
        
        <div class="footer">
          <p><strong>* Pricing may change. This is a quote, not an official invoice</strong></p>
          ${(() => {
            const hasTentativeServices = days.some(day => 
              day.services.some(service => service.tentative)
            );
            if (hasTentativeServices) {
              return `<p style="color: #059669; font-weight: 600; margin-top: 8px;"><strong>* Tentative services are not included in the Grand Total</strong></p>`;
            }
            return '';
          })()}
          <p class="contact">Contact us for any questions - sales@lumetrymedia.com</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Generate Excel quote
app.post('/api/generate-excel', async (req, res) => {
  try {
    const { quoteData, quoteName } = req.body;
    const { days, subtotal, total, discountPercentage, discountAmount, clientName, quoteTitle } = quoteData;
    
    console.log('🔄 Starting Excel generation...');
    
    // Get all services for subservice checking
    const allServices = await Service.find();
    
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Quote');
    
    // Set column widths
    worksheet.columns = [
      { header: 'Date', key: 'date', width: 25 },
      { header: 'Item', key: 'item', width: 40 },
      { header: 'Qty', key: 'qty', width: 8 },
      { header: 'Rate', key: 'rate', width: 15 },
      { header: 'Price', key: 'price', width: 15 },
      { header: 'Description', key: 'description', width: 50 }
    ];
    
    let currentRow = 1;
    
    // Add title row if provided
    if (quoteTitle) {
      worksheet.mergeCells('A1:F1');
      const titleRow = worksheet.getRow(1);
      titleRow.getCell(1).value = quoteTitle;
      titleRow.getCell(1).font = { bold: true, name: 'Arial', size: 11 };
      titleRow.getCell(1).alignment = { horizontal: 'center' };
      titleRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      currentRow++;
    }
    
    // Add client name row if provided
    if (clientName) {
      worksheet.mergeCells(`A${currentRow}:F${currentRow}`);
      const clientRow = worksheet.getRow(currentRow);
      clientRow.getCell(1).value = clientName;
      clientRow.getCell(1).font = { bold: true, name: 'Arial', size: 11 };
      clientRow.getCell(1).alignment = { horizontal: 'center' };
      clientRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      currentRow++;
    }
    
    // Add headers row
    const headerRow = worksheet.getRow(currentRow);
    headerRow.values = ['Date', 'Item', 'Qty', 'Rate', 'Price', 'Description'];
    headerRow.font = { bold: true, name: 'Arial', size: 11 };
    headerRow.alignment = { horizontal: 'center' };
    
    // Apply gray background to all columns A-F
    for (let col = 1; col <= 6; col++) {
      headerRow.getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' } // Light gray background
      };
    }
    
    currentRow++;
    
    // Process each day
    days.forEach((day, dayIndex) => {
      if (day.services.length > 0) {
        day.services.forEach((service, serviceIndex) => {
          const isTentative = service.tentative || false;
          const serviceName = isTentative ? `${service.name} (Tentative)` : service.name;
          
          // Get service definition for description
          const serviceDefinition = allServices.find(s => s._id.toString() === service.id);
          const serviceDescription = service.description !== undefined ? service.description : (serviceDefinition?.description || '');
          
          // Show date only on first service of each day
          const dateDisplay = serviceIndex === 0 
            ? (day.date ? formatDateForExcel(parseStoredDate(day.date)) : `Day ${dayIndex + 1}`)
            : '';
          
          const rate = formatCurrency(service.price);
          const price = isTentative ? `(${formatCurrency(service.price * service.quantity)})` : formatCurrency(service.price * service.quantity);
          
          const row = worksheet.addRow({
            date: dateDisplay,
            item: serviceName,
            qty: service.quantity,
            rate: rate,
            price: price,
            description: serviceDescription
          });
          
          // Set Arial font for all cells first
          row.font = { name: 'Arial', size: 11 };
          
          // Make dates bold and right-aligned (override after base font)
          if (dateDisplay) {
            row.getCell('date').font = { bold: true, name: 'Arial', size: 11 };
            row.getCell('date').alignment = { horizontal: 'right' };
          }
          
          // Set quantity column to left-aligned
          row.getCell('qty').alignment = { horizontal: 'left' };
          
          // Enable text wrapping for description column
          if (serviceDescription) {
            row.getCell('description').alignment = { wrapText: true, vertical: 'top' };
            // Set minimum row height to accommodate wrapped text
            row.height = Math.max(20, Math.ceil(serviceDescription.length / 60) * 15);
          }
          
          currentRow++;
        });
      } else {
        // Empty day
        const dateDisplay = day.date 
          ? formatDateForExcel(parseStoredDate(day.date))
          : `Day ${dayIndex + 1}`;
        
        const row = worksheet.addRow({
          date: dateDisplay,
          item: 'No services selected',
          qty: 0,
          rate: '$0',
          price: '$0',
          description: ''
        });
        
        // Set Arial font for all cells first
        row.font = { name: 'Arial', size: 11 };
        
        // Make dates bold and right-aligned (override after base font)
        row.getCell('date').font = { bold: true, name: 'Arial', size: 11 };
        row.getCell('date').alignment = { horizontal: 'right' };
        
        // Set quantity column to left-aligned
        row.getCell('qty').alignment = { horizontal: 'left' };
        currentRow++;
      }
    });
    
    // Add empty row
    worksheet.addRow({});
    currentRow++;
    
    // Add summary rows based on discount
    if (discountPercentage > 0) {
      // Subtotal row
      const subtotalRow = worksheet.addRow({
        date: '',
        item: '',
        qty: '',
        rate: '',
        price: formatCurrency(subtotal),
        description: 'Subtotal'
      });
      subtotalRow.getCell('description').alignment = { horizontal: 'left' };
      subtotalRow.font = { name: 'Arial', size: 11 };
      
      // Discount row
      const discountRow = worksheet.addRow({
        date: '',
        item: `${discountPercentage}% Discount`,
        qty: '',
        rate: '',
        price: formatCurrency(discountAmount),
        description: 'Discount'
      });
      discountRow.getCell('description').alignment = { horizontal: 'left' };
      discountRow.font = { name: 'Arial', size: 11 };
      
      // Grand Total row
      const grandTotalRow = worksheet.addRow({
        date: '',
        item: '',
        qty: '',
        rate: '',
        price: formatCurrency(total),
        description: 'Grand Total'
      });
      grandTotalRow.getCell('description').alignment = { horizontal: 'left' };
      // Set base font first, then override specific cells
      grandTotalRow.font = { name: 'Arial', size: 11 };
      grandTotalRow.getCell('description').font = { bold: true, name: 'Arial', size: 11 };
      grandTotalRow.getCell('price').font = { bold: true, name: 'Arial', size: 11 };
      grandTotalRow.getCell('description').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' } // Light gray background
      };
      grandTotalRow.getCell('price').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' } // Light gray background
      };
    } else {
      // Grand Total row only
      const grandTotalRow = worksheet.addRow({
        date: '',
        item: '',
        qty: '',
        rate: '',
        price: formatCurrency(total),
        description: 'Grand Total'
      });
      grandTotalRow.getCell('description').alignment = { horizontal: 'left' };
      // Set base font first, then override specific cells
      grandTotalRow.font = { name: 'Arial', size: 11 };
      grandTotalRow.getCell('description').font = { bold: true, name: 'Arial', size: 11 };
      grandTotalRow.getCell('price').font = { bold: true, name: 'Arial', size: 11 };
      grandTotalRow.getCell('description').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' } // Light gray background
      };
      grandTotalRow.getCell('price').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' } // Light gray background
      };
    }
    
    // Add tentative total (sum of only tentative services with discount applied)
    const tentativeSubtotal = days.reduce((total, day) => {
      return total + day.services.reduce((dayTotal, service) => {
        return dayTotal + (service.tentative ? (service.price * service.quantity) : 0);
      }, 0);
    }, 0);
    
    if (tentativeSubtotal > 0) {
      const tentativeDiscountAmount = tentativeSubtotal * (discountPercentage / 100);
      const finalTentativeTotal = tentativeSubtotal - tentativeDiscountAmount;
      
      const tentativeRow = worksheet.addRow({
        date: '',
        item: '',
        qty: '',
        rate: '',
        price: `(${formatCurrency(finalTentativeTotal)})`,
        description: 'Tentative Total'
      });
      tentativeRow.getCell('description').alignment = { horizontal: 'left' };
      tentativeRow.font = { name: 'Arial', size: 11 };
    }
    
    // Generate Excel buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();
    
    console.log('✅ Excel generated successfully');
    
    // Generate filename using same convention as PDF
    const currentDate = new Date().toISOString().split('T')[0];
    let filename;
    
    if (quoteTitle) {
      // Sanitize quote title for filename
      const sanitizedTitle = quoteTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
      filename = `${sanitizedTitle}-${currentDate}.xlsx`;
    } else {
      filename = `lumetry-quote-${currentDate}.xlsx`;
    }
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(excelBuffer);
    
  } catch (error) {
    console.error('❌ Excel generation error:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate Excel file. Please try again.',
      details: error.message 
    });
  }
});

function formatDateForExcel(date) {
  const options = { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  };
  return date.toLocaleDateString('en-US', options);
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