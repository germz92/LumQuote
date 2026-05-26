const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const htmlPdf = require('html-pdf-node');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, UnderlineType } = require('docx');
const fs = require('fs');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || '84gh29nf89gh2b3v9bgh29g843hfg932hf';
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

// Cookie parser middleware (inline implementation)
app.use((req, res, next) => {
  req.cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      req.cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    });
  }
  next();
});

// Trust proxy for Render/Heroku (needed for secure cookies behind reverse proxy)
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  app.set('trust proxy', 1);
}

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: isProduction, // true for HTTPS in production
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// JWT Authentication middleware
function requireAuth(req, res, next) {
  // Check for token in cookie, Authorization header, or session (fallback)
  let token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token && req.session?.token) {
    token = req.session.token;
  }
  
  if (!token) {
    // For API requests, return 401
    if (req.path.startsWith('/api/') && req.path !== '/api/login') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    // For page requests, redirect to login
    return res.redirect('/login');
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    // Clear invalid token
    if (req.session) {
      req.session.token = null;
    }
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.redirect('/login');
  }
}

// API-only auth middleware (returns JSON instead of redirect)
function requireApiAuth(req, res, next) {
  let token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token && req.session?.token) {
    token = req.session.token;
  }
  
  if (!token) {
    console.log('❌ API Auth: No token found for', req.path);
    console.log('   Cookies:', Object.keys(req.cookies || {}));
    console.log('   Auth header:', req.headers.authorization ? 'present' : 'missing');
    console.log('   Session token:', req.session?.token ? 'present' : 'missing');
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.log('❌ API Auth: Token verification failed:', error.message);
    console.log('   Token (first 50 chars):', token.substring(0, 50) + '...');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Serve login page without authentication
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// LumDash SSO Authentication endpoint
// Verifies JWT token from LumDash (uses same JWT_SECRET)
app.post('/api/auth/lumdash', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required' });
  }
  
  try {
    // Verify the token using shared JWT secret
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // LumDash uses: id, fullName, role, email
    // Handle both formats for compatibility
    const lumDashId = decoded.id || decoded.userId || decoded._id;
    const userName = decoded.fullName || decoded.name || 'Unknown User';
    const userEmail = decoded.email || '';
    // Map LumDash roles to valid LumQuote roles (only 'admin' and 'user' are supported)
    // Other roles like 'planner' should be treated as 'user'
    const rawRole = decoded.role || 'user';
    const userRole = (rawRole === 'admin') ? 'admin' : 'user';
    
    console.log('✅ LumDash token verified for:', userName);
    console.log('   Token payload:', JSON.stringify(decoded));
    
    // Find or create local user record
    let localUser = await LumQuoteUser.findOne({ lumDashId: lumDashId });
    
    if (!localUser) {
      // Create new local user from LumDash data
      localUser = new LumQuoteUser({
        lumDashId: lumDashId,
        name: userName,
        email: userEmail,
        role: userRole
      });
      await localUser.save();
      console.log('✅ Created new LumQuote user:', localUser.name);
    } else {
      // Update user info from LumDash (in case it changed)
      localUser.name = userName;
      if (userEmail) localUser.email = userEmail;
      localUser.role = userRole;
      localUser.lastLogin = new Date();
      await localUser.save();
      console.log('✅ Updated existing LumQuote user:', localUser.name);
    }
    
    // Store in session for page-based auth
    req.session.token = token;
    req.session.authenticated = true;
    req.session.user = {
      id: localUser._id,
      lumDashId: localUser.lumDashId,
      name: localUser.name,
      email: localUser.email,
      role: localUser.role
    };
    
    // Also set a cookie for page navigation auth
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = [
      `token=${token}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${7 * 24 * 60 * 60}`,
      'SameSite=Lax'
    ];
    
    // Add Secure flag for HTTPS in production
    if (isProduction) {
      cookieOptions.push('Secure');
    }
    
    res.setHeader('Set-Cookie', cookieOptions.join('; '));
    console.log('🍪 Cookie set for user:', localUser.name, isProduction ? '(Secure)' : '(Local)');
    
    res.json({ 
      success: true,
      user: {
        id: localUser._id,
        name: localUser.name,
        email: localUser.email,
        role: localUser.role
      }
    });
  } catch (error) {
    console.error('LumDash auth error:', error.message);
    console.error('Full error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token. Please sign in again.' });
    }
    
    res.status(401).json({ success: false, message: 'Authentication failed. Please try again.' });
  }
});

// Verify token endpoint
app.get('/api/verify-token', requireApiAuth, (req, res) => {
  res.json({ 
    success: true, 
    user: req.user 
  });
});

// Get current user endpoint
app.get('/api/me', requireApiAuth, (req, res) => {
  res.json({ 
    success: true, 
    user: req.user 
  });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  // Destroy session
  if (req.session) {
    req.session.destroy();
  }
  
  // Clear the auth cookie
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = [
    'token=',
    'Path=/',
    'HttpOnly',
    'Max-Age=0', // Expire immediately
    'SameSite=Lax'
  ];
  
  if (isProduction) {
    cookieOptions.push('Secure');
  }
  
  res.setHeader('Set-Cookie', cookieOptions.join('; '));
  console.log('👋 User logged out, cookie cleared');
  
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

// Define custom routes BEFORE static middleware
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quotes.html'));
});

app.get('/calculator', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/calendar', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calendar.html'));
});

app.get('/quotes', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quotes.html'));
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
  const { days, subtotal, total, discountPercentage, discountAmount, clientName, quoteTitle, markups, markupsTotal } = quoteData;
  
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
        
        // Calculate service discount
        const originalPrice = service.price * (service.quantity || 1);
        let serviceDiscountAmount = 0;
        if (service.discount && service.discount.applied && service.discount.value > 0) {
          if (service.discount.type === 'percentage') {
            serviceDiscountAmount = originalPrice * (service.discount.value / 100);
          } else {
            serviceDiscountAmount = service.discount.value;
          }
          serviceDiscountAmount = Math.min(serviceDiscountAmount, originalPrice);
        }
        const finalPrice = originalPrice - serviceDiscountAmount;
        
        // Build price display
        let priceDisplay;
        let priceStyle = 'text-align: right; font-weight: 600;';
        if (isTentative) {
          priceDisplay = `(${formatCurrency(finalPrice)})`;
        } else if (serviceDiscountAmount > 0) {
          priceDisplay = `<div style="text-decoration: line-through; color: #94a3b8; font-size: 10px; margin-bottom: 2px;">${formatCurrency(originalPrice)}</div><div style="color: #10b981; font-weight: 700; font-size: 11px;">${formatCurrency(finalPrice)}</div>`;
          priceStyle = 'text-align: right; vertical-align: middle;';
        } else {
          priceDisplay = formatCurrency(originalPrice);
        }
        
        // Build discount indicator
        const discountIndicator = (service.discount && service.discount.applied && service.discount.value > 0) 
          ? `<br><small style="color: #f59e0b; font-size: 10px; font-weight: 600;">${service.discount.type === 'percentage' ? `${service.discount.value}% off` : `${formatCurrency(service.discount.value)} off`}</small>`
          : '';
        
        const dayLabel = serviceIndex === 0 ? (day.date ? formatDateForPDF(parseStoredDate(day.date)) : `Day ${dayIndex + 1}`) : '';
        
        servicesHTML += `
          <tr${serviceIndex === day.services.length - 1 && dayIndex < days.length - 1 ? ' class="day-separator"' : ''}>
            <td style="${serviceIndex === 0 ? 'font-weight: 600; color: #1e293b;' : ''}">${dayLabel}</td>
            <td style="${serviceStyle} ${tentativeStyle}">
              ${serviceDisplayName}${tentativeLabel}
              ${discountIndicator}
            ${serviceDescription ? `<br><small style="color: #64748b; font-size: 10px; line-height: 1.3;">${serviceDescription}</small>` : ''}
            </td>
            <td style="text-align: center; color: #1e293b;">
              ${service.quantity || 1}
            </td>
            <td style="${priceStyle} ${tentativeStyle}">
              ${priceDisplay}
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
  
  // Add markups as separate line items
  if (markups && markups.length > 0) {
    markups.forEach(markup => {
      servicesHTML += `
        <tr>
          <td style="color: #1e293b;"></td>
          <td style="color: #1e293b;">
            ${markup.name}
            ${markup.description ? `<br><small style="color: #64748b; font-size: 10px; line-height: 1.3;">${markup.description}</small>` : ''}
          </td>
          <td style="text-align: center; color: #1e293b;">
            1
          </td>
          <td style="text-align: right; font-weight: 600; color: #1e293b;">
            ${formatCurrency(markup.markupAmount)}
          </td>
        </tr>
      `;
    });
  }
  
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
          ${(discountPercentage > 0 || (markupsTotal && markupsTotal > 0)) ? `
            <div>Subtotal: ${formatCurrency(subtotal)}</div>
            ${markupsTotal && markupsTotal > 0 ? `<div>Markups: ${formatCurrency(markupsTotal)}</div>` : ''}
            ${discountPercentage > 0 ? `<div>Discount (${discountPercentage}%): -${formatCurrency(discountAmount)}</div>` : ''}
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
    const { quoteData, quoteName, enableBorders = true } = req.body;
    const { days, subtotal, total, discountPercentage, discountAmount, clientName, quoteTitle, markups, markupsTotal } = quoteData;
    
    console.log('🔄 Starting Excel generation...');
    
    // Get all services for subservice checking
    const allServices = await Service.find();
    
    // Check if any service has a per-event discount
    const hasPerEventDiscount = days.some(day => 
      day.services.some(service => 
        service.discount && service.discount.applied && service.discount.value > 0
      )
    );
    
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Quote');
    
    // Set column headers dynamically based on whether discounts exist
    const columns = [
      { header: 'Date', key: 'date' },
      { header: 'Item', key: 'item' },
      { header: 'Qty', key: 'qty' },
      { header: 'Rate', key: 'rate' }
    ];
    
    if (hasPerEventDiscount) {
      columns.push({ header: 'Discount', key: 'discount' });
    }
    
    columns.push(
      { header: 'Price', key: 'price' },
      { header: 'Description', key: 'description' }
    );
    
    worksheet.columns = columns;
    
    // Determine last column letter based on whether discount column exists
    const lastColLetter = hasPerEventDiscount ? 'G' : 'F';
    const numColumns = hasPerEventDiscount ? 7 : 6;
    
    let currentRow = 1;
    
    // Add title row if provided
    if (quoteTitle) {
      worksheet.mergeCells(`A1:${lastColLetter}1`);
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
      worksheet.mergeCells(`A${currentRow}:${lastColLetter}${currentRow}`);
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
    const headerValues = ['Date', 'Item', 'Qty', 'Rate'];
    if (hasPerEventDiscount) {
      headerValues.push('Discount');
    }
    headerValues.push('Price', 'Description');
    headerRow.values = headerValues;
    headerRow.font = { bold: true, name: 'Arial', size: 11 };
    headerRow.alignment = { horizontal: 'center' };
    
    // Apply gray background to all columns
    for (let col = 1; col <= numColumns; col++) {
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
          
          // Calculate service discount
          const originalPrice = service.price * service.quantity;
          let serviceDiscountAmount = 0;
          let discountDisplay = '';
          
          if (service.discount && service.discount.applied && service.discount.value > 0) {
            if (service.discount.type === 'percentage') {
              serviceDiscountAmount = originalPrice * (service.discount.value / 100);
              discountDisplay = `${service.discount.value}%`;
            } else {
              serviceDiscountAmount = service.discount.value;
              discountDisplay = formatCurrency(service.discount.value);
            }
            serviceDiscountAmount = Math.min(serviceDiscountAmount, originalPrice);
          }
          
          const finalPrice = originalPrice - serviceDiscountAmount;
          
          const rate = formatCurrency(service.price);
          const price = isTentative ? `(${formatCurrency(finalPrice)})` : formatCurrency(finalPrice);
          
          // Build row data conditionally
          const rowData = {
            date: dateDisplay,
            item: serviceName,
            qty: service.quantity,
            rate: rate
          };
          
          if (hasPerEventDiscount) {
            rowData.discount = discountDisplay;
          }
          
          rowData.price = price;
          rowData.description = serviceDescription;
          
          const row = worksheet.addRow(rowData);
          
          // Set Arial font for all cells first
          row.font = { name: 'Arial', size: 11 };
          
          // Make dates bold and right-aligned (override after base font)
          if (dateDisplay) {
            row.getCell('date').font = { bold: true, name: 'Arial', size: 11 };
            row.getCell('date').alignment = { horizontal: 'right' };
          }
          
          // Set quantity column to left-aligned
          row.getCell('qty').alignment = { horizontal: 'left' };
          
          // Set discount column styling if it exists
          if (hasPerEventDiscount) {
            row.getCell('discount').alignment = { horizontal: 'center' };
          }
          
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
        
        const emptyRowData = {
          date: dateDisplay,
          item: 'No services selected',
          qty: 0,
          rate: '$0'
        };
        
        if (hasPerEventDiscount) {
          emptyRowData.discount = '';
        }
        
        emptyRowData.price = '$0';
        emptyRowData.description = '';
        
        const row = worksheet.addRow(emptyRowData);
        
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
    
    // Add markups as line items
    if (markups && markups.length > 0) {
      markups.forEach(markup => {
        const markupRowData = {
          date: '',
          item: markup.name,
          qty: 1,
          rate: formatCurrency(markup.markupAmount)
        };
        
        if (hasPerEventDiscount) {
          markupRowData.discount = '';
        }
        
        markupRowData.price = formatCurrency(markup.markupAmount);
        markupRowData.description = markup.description || '';
        
        const row = worksheet.addRow(markupRowData);
        
        // Set Arial font for all cells
        row.font = { name: 'Arial', size: 11 };
        
        // Set quantity column to left-aligned
        row.getCell('qty').alignment = { horizontal: 'left' };
        
        // Enable text wrapping for description column if there's a description
        if (markup.description) {
          row.getCell('description').alignment = { wrapText: true, vertical: 'top' };
          row.height = Math.max(20, Math.ceil(markup.description.length / 60) * 15);
        }
        
        currentRow++;
      });
    }
    
    // Add empty row
    worksheet.addRow({});
    currentRow++;
    
    // Add summary rows based on discount or markups
    if (discountPercentage > 0 || (markupsTotal && markupsTotal > 0)) {
      // Subtotal row
      const subtotalRowData = {
        date: '',
        item: '',
        qty: '',
        rate: ''
      };
      
      if (hasPerEventDiscount) {
        subtotalRowData.discount = '';
      }
      
      subtotalRowData.price = formatCurrency(subtotal);
      subtotalRowData.description = 'Subtotal';
      
      const subtotalRow = worksheet.addRow(subtotalRowData);
      subtotalRow.getCell('description').alignment = { horizontal: 'left' };
      subtotalRow.font = { name: 'Arial', size: 11 };
      
      // Markups row (if any)
      if (markupsTotal && markupsTotal > 0) {
        const markupsRowData = {
          date: '',
          item: '',
          qty: '',
          rate: ''
        };
        
        if (hasPerEventDiscount) {
          markupsRowData.discount = '';
        }
        
        markupsRowData.price = formatCurrency(markupsTotal);
        markupsRowData.description = 'Markups';
        
        const markupsRow = worksheet.addRow(markupsRowData);
        markupsRow.getCell('description').alignment = { horizontal: 'left' };
        markupsRow.font = { name: 'Arial', size: 11 };
      }
      
      // Discount row (if any)
      if (discountPercentage > 0) {
        const discountRowData = {
          date: '',
          item: `${discountPercentage}% Global Discount`,
          qty: '',
          rate: ''
        };
        
        if (hasPerEventDiscount) {
          discountRowData.discount = '';
        }
        
        discountRowData.price = formatCurrency(discountAmount);
        discountRowData.description = 'Discount';
        
        const discountRow = worksheet.addRow(discountRowData);
        discountRow.getCell('description').alignment = { horizontal: 'left' };
        discountRow.font = { name: 'Arial', size: 11 };
      }
      
      // Grand Total row
      const grandTotalRowData = {
        date: '',
        item: '',
        qty: '',
        rate: ''
      };
      
      if (hasPerEventDiscount) {
        grandTotalRowData.discount = '';
      }
      
      grandTotalRowData.price = formatCurrency(total);
      grandTotalRowData.description = 'Grand Total';
      
      const grandTotalRow = worksheet.addRow(grandTotalRowData);
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
      const grandTotalRowData = {
        date: '',
        item: '',
        qty: '',
        rate: ''
      };
      
      if (hasPerEventDiscount) {
        grandTotalRowData.discount = '';
      }
      
      grandTotalRowData.price = formatCurrency(total);
      grandTotalRowData.description = 'Grand Total';
      
      const grandTotalRow = worksheet.addRow(grandTotalRowData);
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
      
      const tentativeRowData = {
        date: '',
        item: '',
        qty: '',
        rate: ''
      };
      
      if (hasPerEventDiscount) {
        tentativeRowData.discount = '';
      }
      
      tentativeRowData.price = `(${formatCurrency(finalTentativeTotal)})`;
      tentativeRowData.description = 'Tentative Total';
      
      const tentativeRow = worksheet.addRow(tentativeRowData);
      tentativeRow.getCell('description').alignment = { horizontal: 'left' };
      tentativeRow.font = { name: 'Arial', size: 11 };
    }
    
    // Add borders to all used cells for grid lines (if enabled)
    if (enableBorders) {
      try {
        const lastRow = worksheet.lastRow?.number || currentRow;
        const lastCol = numColumns; // Dynamic based on whether discount column exists
        
        // Ensure we have valid row numbers
        if (lastRow > 0 && lastCol > 0) {
        // Define border style
        const borderStyle = {
          top: { style: 'thin', color: { argb: 'FF000000' } },
          left: { style: 'thin', color: { argb: 'FF000000' } },
          bottom: { style: 'thin', color: { argb: 'FF000000' } },
          right: { style: 'thin', color: { argb: 'FF000000' } }
        };
        
        // Apply borders to all cells in the used range
        for (let row = 1; row <= Math.min(lastRow, 1000); row++) { // Limit to prevent memory issues
          for (let col = 1; col <= lastCol; col++) {
            try {
              const cell = worksheet.getCell(row, col);
              cell.border = borderStyle;
            } catch (cellError) {
              console.warn(`⚠️ Could not apply border to cell ${row},${col}:`, cellError.message);
            }
          }
        }
          console.log(`✅ Borders applied to ${lastRow} rows and ${lastCol} columns`);
        } else {
          console.warn('⚠️ Invalid row/column numbers, skipping border application');
        }
      } catch (borderError) {
        console.error('❌ Error applying borders:', borderError.message);
        // Continue without borders if there's an issue
      }
    } else {
      console.log('📝 Borders disabled for this export');
    }
    
    // Auto-fit column widths based on content
    console.log('🔄 Auto-fitting column widths...');
    try {
      // Define column-specific default and maximum widths dynamically
      const columnSettings = {
        'A': { autofit: true, max: 35 },   // Date column - always autofit
        'B': { default: 25, max: 50 },     // Item column
        'C': { default: 5, max: 8 },       // Qty column - small default
        'D': { default: 8, max: 12 }       // Rate column - small default
      };
      
      if (hasPerEventDiscount) {
        // With discount column
        columnSettings['E'] = { default: 10, max: 15 };  // Discount column - small default
        columnSettings['F'] = { default: 10, max: 15 };  // Price column - small default
        columnSettings['G'] = { default: 30, max: 60 };  // Description column
      } else {
        // Without discount column
        columnSettings['E'] = { default: 10, max: 15 };  // Price column - small default
        columnSettings['F'] = { default: 30, max: 60 };  // Description column
      }
      
      worksheet.columns.forEach((column, index) => {
        let maxLength = 0;
        const columnLetter = String.fromCharCode(65 + index); // A, B, C, etc.
        const settings = columnSettings[columnLetter] || { default: 8, max: 20 };
        
        // Check each cell in the column to find the longest content
        worksheet.getColumn(columnLetter).eachCell({ includeEmpty: false }, (cell) => {
          let cellValue = '';
          
          if (cell.value) {
            cellValue = cell.value.toString();
            
            // Handle wrapped text - estimate line breaks
            if (cell.alignment && cell.alignment.wrapText) {
              // For wrapped text, consider the width needed for readability
              const words = cellValue.split(' ');
              const longestWord = Math.max(...words.map(word => word.length));
              maxLength = Math.max(maxLength, longestWord);
            } else {
              maxLength = Math.max(maxLength, cellValue.length);
            }
          }
        });
        
        // Calculate width based on column type
        let calculatedWidth;
        if (settings.autofit) {
          // Date column: always autofit to content with padding, cap at max
          calculatedWidth = Math.min(maxLength + 3, settings.max);
        } else if (maxLength + 2 > settings.default) {
          // Other columns: use default unless content needs more space
          calculatedWidth = Math.min(maxLength + 2, settings.max);
        } else {
          // Content fits in default width
          calculatedWidth = settings.default;
        }
        
        column.width = calculatedWidth;
        
        const widthType = settings.autofit ? 'autofit' : `default ${settings.default}`;
        console.log(`📏 Column ${columnLetter} (${column.header || 'Unknown'}): ${maxLength} chars -> ${widthType}, calculated ${calculatedWidth}`);
      });
      
      console.log('✅ Column widths auto-fitted successfully');
    } catch (autofitError) {
      console.error('❌ Error auto-fitting columns:', autofitError.message);
      // Continue without auto-fitting if there's an issue
    }
    
    // Generate Excel buffer
    console.log('🔄 Generating Excel buffer...');
    const excelBuffer = await workbook.xlsx.writeBuffer();
    
    // Validate buffer
    if (!excelBuffer || excelBuffer.length === 0) {
      throw new Error('Generated Excel buffer is empty or invalid');
    }
    
    console.log(`✅ Excel buffer generated successfully (${excelBuffer.length} bytes)`);
    
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
    console.error('❌ Full error stack:', error.stack);
    
    // Send a more specific error response
    const errorMessage = error.message || 'Unknown error occurred';
    res.status(500).json({ 
      error: 'Failed to generate Excel file. Please try again.',
      details: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// Generate DOCX quote
app.post('/api/generate-docx', async (req, res) => {
  try {
    const { quoteData, quoteName } = req.body;
    const { days, subtotal, total, discountPercentage, discountAmount, clientName, quoteTitle, markups, markupsTotal } = quoteData;
    
    console.log('🔄 Starting DOCX generation...');
    
    // Load all services to get category information
    const allServices = await Service.find({});
    const serviceMap = {};
    allServices.forEach(service => {
      serviceMap[service._id.toString()] = service;
    });
    
    // Create document content
    const children = [];
    
    // Header with quote name and client name
    if (quoteTitle || clientName) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: quoteTitle || 'Quote',
              bold: true,
              size: 28,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        })
      );
      
      if (clientName) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Client: ${clientName}`,
                size: 24,
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          })
        );
      }
    }
    
    // Filter out tentative services and process days
    const processedDays = days.map(day => ({
      ...day,
      services: day.services.filter(service => !service.tentative)
    })).filter(day => day.services.length > 0); // Remove days with no non-tentative services
    
    // Add days with services grouped by categories
    processedDays.forEach((day, dayIndex) => {
      // Day header (centered)
      const dayHeader = day.date ? formatDateForDocx(day.date) : `Day ${dayIndex + 1}`;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: dayHeader,
              bold: true,
              size: 24,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: dayIndex > 0 ? 300 : 0, after: 200 },
        })
      );
      
      // Group services by category
      const servicesByCategory = {};
      day.services.forEach(service => {
        // Look up the service definition to get category
        const serviceDefinition = serviceMap[service.id];
        const category = serviceDefinition?.category || 'Other';
        if (!servicesByCategory[category]) {
          servicesByCategory[category] = [];
        }
        servicesByCategory[category].push(service);
      });
      
      let dayTotal = 0;
      
      // Process each category
      Object.keys(servicesByCategory).sort().forEach(category => {
        const categoryServices = servicesByCategory[category];
        let categoryTotal = 0;
        
        // Category header
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: category,
                bold: true,
                size: 22,
              }),
            ],
            spacing: { before: 100, after: 50 },
          })
        );
        
        // Services in this category
        categoryServices.forEach(service => {
          const originalTotal = service.price * service.quantity;
          
          // Calculate service discount
          let serviceDiscountAmount = 0;
          let discountText = '';
          
          if (service.discount && service.discount.applied && service.discount.value > 0) {
            if (service.discount.type === 'percentage') {
              serviceDiscountAmount = originalTotal * (service.discount.value / 100);
              discountText = `${service.discount.value}% off`;
            } else {
              serviceDiscountAmount = service.discount.value;
              discountText = `$${service.discount.value.toFixed(2)} off`;
            }
            serviceDiscountAmount = Math.min(serviceDiscountAmount, originalTotal);
          }
          
          const finalTotal = originalTotal - serviceDiscountAmount;
          categoryTotal += finalTotal;
          dayTotal += finalTotal;
          
          // Build the service line with discount
          const textRuns = [
            new TextRun({
              text: `• ${service.name} (Qty: ${service.quantity}`,
              size: 22,
            })
          ];
          
          // Add discount text if applicable
          if (discountText) {
            textRuns.push(
              new TextRun({
                text: ` - ${discountText}`,
                size: 22,
              })
            );
          }
          
          textRuns.push(
            new TextRun({
              text: ' - ',
              size: 22,
            })
          );
          
          // Add unit rate
          textRuns.push(
            new TextRun({
              text: `$${service.price.toFixed(2)}`,
              size: 22,
            })
          );
          
          textRuns.push(
            new TextRun({
              text: `): $${finalTotal.toFixed(2)}`,
              size: 22,
            })
          );
          
          children.push(
            new Paragraph({
              children: textRuns,
              spacing: { after: 50 },
              indent: { left: 360 }, // Indent for bullet points
            })
          );
        });
        
        // Category total
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Category Total: $${categoryTotal.toFixed(2)}`,
                bold: true,
                size: 22,
              }),
            ],
            spacing: { before: 50, after: 100 },
            indent: { left: 360 },
          })
        );
      });
      
      // Day total
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Day Total: $${dayTotal.toFixed(2)}`,
              bold: true,
              size: 24,
            }),
          ],
          spacing: { before: 100, after: 200 },
        })
      );
    });
    
    // Grand total section
    if (processedDays.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "Quote Summary",
              bold: true,
              size: 24,
              underline: {
                type: UnderlineType.SINGLE,
              },
            }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      
      // Subtotal
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Subtotal: $${subtotal.toFixed(2)}`,
              size: 22,
            }),
          ],
          spacing: { after: 50 },
        })
      );
      
      // Markups (if applicable)
      if (markupsTotal && markupsTotal > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Markups: $${markupsTotal.toFixed(2)}`,
                size: 22,
              }),
            ],
            spacing: { after: 50 },
          })
        );
      }
      
      // Discount (if applicable)
      if (discountPercentage > 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Discount (${discountPercentage}%): -$${discountAmount.toFixed(2)}`,
                size: 22,
              }),
            ],
            spacing: { after: 50 },
          })
        );
      }
      
      // Grand total
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Total: $${total.toFixed(2)}`,
              bold: true,
              size: 26,
            }),
          ],
          spacing: { before: 100 },
        })
      );
    }
    
    // Create the document
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: children,
        },
      ],
    });
    
    console.log('📄 Creating DOCX buffer...');
    const docxBuffer = await Packer.toBuffer(doc);
    
    // Validate buffer
    if (!docxBuffer || docxBuffer.length === 0) {
      throw new Error('Generated DOCX buffer is empty or invalid');
    }
    
    console.log(`✅ DOCX buffer generated successfully (${docxBuffer.length} bytes)`);
    
    // Generate filename using same convention as Excel
    const currentDate = new Date().toISOString().split('T')[0];
    let filename;
    
    if (quoteTitle) {
      // Sanitize quote title for filename
      const sanitizedTitle = quoteTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
      filename = `${sanitizedTitle}-${currentDate}.docx`;
    } else {
      filename = `lumetry-quote-${currentDate}.docx`;
    }
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(docxBuffer);
    
  } catch (error) {
    console.error('❌ DOCX generation error:', error.message);
    console.error('❌ Full error stack:', error.stack);
    
    // Send a more specific error response
    const errorMessage = error.message || 'Unknown error occurred';
    res.status(500).json({ 
      error: 'Failed to generate DOCX file. Please try again.',
      details: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

function formatDateForDocx(dateString) {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    
    const options = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    };
    
    return date.toLocaleDateString('en-US', options);
  } catch (error) {
    console.error('Date formatting error:', error);
    return dateString || 'No Date Set';
  }
}

function formatDateForExcel(date) {
  const options = { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  };
  return date.toLocaleDateString('en-US', options);
}

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

// User Schema (for quote creators - original)
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema, 'users');

// LumQuoteUser Schema (synced from LumDash SSO)
const lumQuoteUserSchema = new mongoose.Schema({
  lumDashId: { type: String, required: true, unique: true }, // User ID from LumDash
  name: { type: String, required: true },
  email: { type: String, default: '', lowercase: true }, // Optional - LumDash may not provide
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  lastLogin: { type: Date, default: Date.now }
}, { timestamps: true });

const LumQuoteUser = mongoose.model('LumQuoteUser', lumQuoteUserSchema, 'lumQuoteUsers');

// Saved Quote Schema
const savedQuoteSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  quoteData: { type: Object, required: true },
  clientName: { type: String, default: null },
  location: { type: String, default: null },
  leadSource: { type: String, default: null },
  archived: { type: Boolean, default: false },
  booked: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sharedWith: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'LumQuoteUser' },
    accessLevel: { type: String, enum: ['read', 'full'], default: 'read' },
    sharedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const SavedQuote = mongoose.model('SavedQuote', savedQuoteSchema, 'savedQuotes');

// User management endpoints
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().sort({ name: 1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'User name is required' });
    }

    const existingUser = await User.findOne({ name: name.trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'User name already exists' });
    }

    const user = new User({ name: name.trim() });
    await user.save();
    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'User name is required' });
    }

    const existingUser = await User.findOne({ name: name.trim(), _id: { $ne: req.params.id } });
    if (existingUser) {
      return res.status(409).json({ error: 'User name already exists' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Save quote endpoint
// Helper function to get or create User record for logged-in user
async function getOrCreateUserRecord(userName) {
  if (!userName) return null;
  
  let userRecord = await User.findOne({ name: userName });
  
  if (!userRecord) {
    // Create a new User record for this LumDash user
    userRecord = new User({ name: userName });
    await userRecord.save();
    console.log('✅ Created User record for:', userName);
  }
  
  return userRecord;
}

// Save quote endpoint (auto-assigns createdBy from logged-in user)
app.post('/api/save-quote', requireApiAuth, async (req, res) => {
  try {
    const { name, quoteData, clientName, location, leadSource, booked } = req.body;
    const user = req.user;
    
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
    
    // Auto-assign createdBy from logged-in user
    const userName = user.name || user.fullName;
    const userRecord = await getOrCreateUserRecord(userName);

    // Save new quote
    const savedQuote = new SavedQuote({
      name,
      quoteData,
      clientName: clientName || null,
      location: location || null,
      leadSource: leadSource || null,
      booked: booked || false,
      createdBy: userRecord?._id || null
    });

    const result = await savedQuote.save();
    res.json({ success: true, id: result._id, createdBy: userRecord?.name });
  } catch (error) {
    console.error('Error saving quote:', error);
    res.status(500).json({ error: 'Failed to save quote' });
  }
});

// Overwrite existing quote endpoint
// Overwrite existing quote (with access control)
app.post('/api/overwrite-quote', requireApiAuth, async (req, res) => {
  try {
    const { name, quoteData, clientName, location, leadSource, booked } = req.body;
    const user = req.user;
    
    if (!name || !quoteData) {
      return res.status(400).json({ error: 'Name and quote data are required' });
    }
    
    // Find existing quote and check access
    const existingQuote = await SavedQuote.findOne({ name }).populate('createdBy', 'name');
    
    if (!existingQuote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Check access - need full access to edit
    const accessLevel = await canAccessQuote(user, existingQuote, true);
    if (!accessLevel || accessLevel === 'read') {
      return res.status(403).json({ error: 'You do not have permission to edit this quote' });
    }

    // Update the quote but keep the original createdBy
    const result = await SavedQuote.findOneAndUpdate(
      { name },
      { 
        quoteData,
        clientName: clientName || null,
        location: location || null,
        leadSource: leadSource || null,
        booked: booked || false
        // Don't update createdBy - keep original owner
      },
      { new: true }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error overwriting quote:', error);
    res.status(500).json({ error: 'Failed to overwrite quote' });
  }
});

// Get all saved quotes endpoint
// Helper function to check if user can access a quote
// Returns: false (no access), 'read' (read-only), 'full' (full access), or true (owner/admin)
async function canAccessQuote(user, quote, returnAccessLevel = false) {
  // Admins can access all quotes
  if (user.role === 'admin') return returnAccessLevel ? 'full' : true;
  
  // Check if user is the owner
  if (quote.createdBy) {
    const createdByName = quote.createdBy.name || quote.createdBy;
    if (user.name === createdByName || user.fullName === createdByName) {
      return returnAccessLevel ? 'full' : true;
    }
  }
  
  // Check if quote is shared with this user
  if (quote.sharedWith && quote.sharedWith.length > 0) {
    // Find user's LumQuoteUser record
    const lumQuoteUser = await LumQuoteUser.findOne({ 
      $or: [{ name: user.name }, { name: user.fullName }] 
    });
    
    if (lumQuoteUser) {
      const shareEntry = quote.sharedWith.find(s => 
        s.user && (s.user.toString() === lumQuoteUser._id.toString() || 
                   s.user._id?.toString() === lumQuoteUser._id.toString())
      );
      
      if (shareEntry) {
        return returnAccessLevel ? shareEntry.accessLevel : true;
      }
    }
  }
  
  return false;
}

// Get all saved quotes (filtered by role, includes shared quotes)
app.get('/api/saved-quotes', requireApiAuth, async (req, res) => {
  try {
    const user = req.user;
    const isAdmin = user.role === 'admin';
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    // Filter and sort parameters from query string
    const { archived, search, createdBy: createdByFilter, booked, dateFilter, sortBy, sortDirection } = req.query;
    
    let query = {};
    
    // If not admin, show quotes created by this user OR shared with this user
    if (!isAdmin) {
      // Find user records
      const userRecord = await User.findOne({ name: user.name || user.fullName });
      const lumQuoteUser = await LumQuoteUser.findOne({ 
        $or: [{ name: user.name }, { name: user.fullName }] 
      });
      
      const orConditions = [];
      
      // Quotes created by user
      if (userRecord) {
        orConditions.push({ createdBy: userRecord._id });
      }
      
      // Quotes shared with user
      if (lumQuoteUser) {
        orConditions.push({ 'sharedWith.user': lumQuoteUser._id });
      }
      
      if (orConditions.length === 0) {
        return res.json({ quotes: [], total: 0, page, limit, totalPages: 0 });
      }
      
      query.$or = orConditions;
    }
    
    // Apply archived filter
    // For archived=false, also include quotes where archived is undefined/null (older quotes)
    if (archived !== undefined) {
      if (archived === 'true') {
        query.archived = true;
      } else {
        // Show non-archived quotes: archived is false, null, or doesn't exist
        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { archived: false },
            { archived: null },
            { archived: { $exists: false } }
          ]
        });
      }
    }
    
    // Apply booked filter
    if (booked !== undefined && booked !== '') {
      query.booked = booked === 'true';
    }
    
    // Apply createdBy filter
    if (createdByFilter) {
      query.createdBy = createdByFilter;
    }
    
    // Apply search filter (searches name, clientName, location, quoteTitle)
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      const searchConditions = [
        { name: searchRegex },
        { clientName: searchRegex },
        { location: searchRegex },
        { 'quoteData.quoteTitle': searchRegex }
      ];
      
      if (query.$or) {
        // Combine with existing $or conditions using $and
        query.$and = [
          { $or: query.$or },
          { $or: searchConditions }
        ];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }
    
    // Get total count for pagination
    const total = await SavedQuote.countDocuments(query);
    const totalPages = Math.ceil(total / limit);
    
    // Build sort object based on parameters
    let sortObj = { updatedAt: -1 }; // Default sort
    if (sortBy) {
      const direction = sortDirection === 'asc' ? 1 : -1;
      
      // Map frontend column names to database fields
      const sortFieldMap = {
        'name': 'name',
        'clientName': 'clientName',
        'location': 'location',
        'total': 'quoteData.total',
        'updatedAt': 'updatedAt',
        'createdAt': 'createdAt',
        'createdBy': 'createdBy.name',
        'startDate': 'quoteData.days.0.date', // First day's date
        'booked': 'booked'
      };
      
      const dbField = sortFieldMap[sortBy] || sortBy;
      sortObj = { [dbField]: direction };
    }
    
    const quotes = await SavedQuote.find(query, {
      name: 1,
      clientName: 1,
      location: 1,
      leadSource: 1,
      archived: 1,
      booked: 1,
      createdBy: 1,
      sharedWith: 1,
      createdAt: 1,
      updatedAt: 1,
      'quoteData.total': 1,
      'quoteData.days': 1,
      'quoteData.quoteTitle': 1
    })
    .populate('createdBy', 'name')
    .populate('sharedWith.user', 'name')
    .sort(sortObj)
    .skip(skip)
    .limit(limit);
    
    // Add access level info for each quote
    const quotesWithAccess = await Promise.all(quotes.map(async (quote) => {
      const quoteObj = quote.toObject();
      const accessLevel = await canAccessQuote(user, quote, true);
      quoteObj.accessLevel = accessLevel;
      quoteObj.isOwner = quote.createdBy && (quote.createdBy.name === user.name || quote.createdBy.name === user.fullName);
      return quoteObj;
    }));

    res.json({
      quotes: quotesWithAccess,
      total,
      page,
      limit,
      totalPages
    });
  } catch (error) {
    console.error('Error fetching saved quotes:', error);
    res.status(500).json({ error: 'Failed to fetch saved quotes' });
  }
});

// Load specific quote endpoint (with access control)
app.get('/api/load-quote/:name', requireApiAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const user = req.user;
    
    const quote = await SavedQuote.findOne({ name })
      .populate('createdBy', 'name')
      .populate('sharedWith.user', 'name');
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Check access and get access level
    const accessLevel = await canAccessQuote(user, quote, true);
    if (!accessLevel) {
      return res.status(403).json({ error: 'You do not have permission to access this quote' });
    }
    
    // Add access info to response
    const quoteObj = quote.toObject();
    quoteObj.accessLevel = accessLevel;
    quoteObj.isOwner = quote.createdBy && (quote.createdBy.name === user.name || quote.createdBy.name === user.fullName);

    res.json(quoteObj);
  } catch (error) {
    console.error('Error loading quote:', error);
    res.status(500).json({ error: 'Failed to load quote' });
  }
});

// Update quote metadata endpoint (with access control)
app.put('/api/update-quote-metadata/:name', requireApiAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const { newName, clientName, location, createdBy, booked } = req.body;
    const user = req.user;
    
    if (!newName) {
      return res.status(400).json({ error: 'New name is required' });
    }

    // Check if the quote exists
    const existingQuote = await SavedQuote.findOne({ name }).populate('createdBy', 'name');
    if (!existingQuote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Check access - need full access to edit
    const accessLevel = await canAccessQuote(user, existingQuote, true);
    if (!accessLevel || accessLevel === 'read') {
      return res.status(403).json({ error: 'You do not have permission to edit this quote' });
    }

    // If name is changing, check if new name already exists
    if (name !== newName) {
      const nameConflict = await SavedQuote.findOne({ name: newName });
      if (nameConflict) {
        return res.status(409).json({ error: 'A quote with this name already exists' });
      }
    }

    // Build update object with only provided fields
    const updateFields = { name: newName };
    
    if (clientName !== undefined) {
      updateFields.clientName = clientName || null;
    }
    if (location !== undefined) {
      updateFields.location = location || null;
    }
    if (createdBy !== undefined) {
      updateFields.createdBy = createdBy || null;
    }
    if (booked !== undefined) {
      updateFields.booked = booked || false;
    }

    // Update the quote metadata
    const result = await SavedQuote.findOneAndUpdate(
      { name },
      updateFields,
      { new: true }
    );

    res.json({ success: true, quote: result });
  } catch (error) {
    console.error('Error updating quote metadata:', error);
    res.status(500).json({ error: 'Failed to update quote' });
  }
});

// Delete saved quote endpoint (with access control)
app.delete('/api/saved-quotes/:name', requireApiAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const user = req.user;
    
    // Find the quote first to check access
    const quote = await SavedQuote.findOne({ name }).populate('createdBy', 'name');
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Only owner or admin can delete (not shared users)
    const isOwner = quote.createdBy && (quote.createdBy.name === user.name || quote.createdBy.name === user.fullName);
    if (user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the owner can delete this quote' });
    }
    
    await SavedQuote.findOneAndDelete({ name });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote:', error);
    res.status(500).json({ error: 'Failed to delete quote' });
  }
});

// Archive/Unarchive quote endpoint
// Archive/Unarchive quote endpoint (with access control)
app.post('/api/archive-quote/:name', requireApiAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const { archived } = req.body;
    const user = req.user;
    
    console.log('📦 Archive request received:', {
      name,
      archived,
      decodedName: decodeURIComponent(name)
    });
    
    if (typeof archived !== 'boolean') {
      return res.status(400).json({ error: 'Archived status must be a boolean' });
    }
    
    // Find the quote first to check access
    const quote = await SavedQuote.findOne({ name }).populate('createdBy', 'name');
    
    if (!quote) {
      console.error('❌ Quote not found with name:', name);
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Check access - need full access to archive
    const accessLevel = await canAccessQuote(user, quote, true);
    if (!accessLevel || accessLevel === 'read') {
      return res.status(403).json({ error: 'You do not have permission to archive this quote' });
    }

    const result = await SavedQuote.findOneAndUpdate(
      { name },
      { archived },
      { new: true }
    );

    console.log('✅ Quote archived successfully:', result.name, 'archived:', result.archived);
    res.json({ success: true, archived: result.archived });
  } catch (error) {
    console.error('Error archiving/unarchiving quote:', error);
    res.status(500).json({ error: 'Failed to update quote archive status' });
  }
});

// Get all unique client names endpoint
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await SavedQuote.distinct('clientName', { 
      clientName: { $ne: null, $ne: '' } 
    });
    
    // Sort alphabetically and filter out any null/empty values
    const sortedClients = clients
      .filter(client => client && client.trim())
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    
    res.json(sortedClients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch client names' });
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

// Get calendar events from saved quotes (with access control)
app.get('/api/calendar-events', requireApiAuth, async (req, res) => {
  try {
    const user = req.user;
    const isAdmin = user.role === 'admin';
    
    let query = { archived: { $ne: true } };
    
    // If not admin, only show quotes created by this user
    if (!isAdmin) {
      const userRecord = await User.findOne({ name: user.name || user.fullName });
      if (userRecord) {
        query.createdBy = userRecord._id;
      } else {
        return res.json([]); // No quotes for this user
      }
    }
    
    const quotes = await SavedQuote.find(query, {
      name: 1,
      clientName: 1,
      booked: 1,
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
      'quoteData.total': 1,
      'quoteData.days': 1,
      'quoteData.quoteTitle': 1
    }).populate('createdBy', 'name');

    const events = [];

    quotes.forEach(quote => {
      const days = quote.quoteData.days || [];
      
      // Find days with dates
      const daysWithDates = days.filter(day => day.date);
      
      if (daysWithDates.length === 0) {
        // Skip quotes with no dates assigned
        return;
      }

      // Sort dates to find first and last
      const sortedDates = daysWithDates
        .map(day => parseStoredDate(day.date))
        .sort((a, b) => a - b);

      const firstDate = sortedDates[0];
      const lastDate = sortedDates[sortedDates.length - 1];

      // Calculate total services
      const totalServices = days.reduce((sum, day) => sum + (day.services?.length || 0), 0);

      // Create calendar event
      // For calendar display, we want the event to span from first to last date inclusive
      const eventEndDate = new Date(lastDate);
      // Don't add a day to end date since we want it inclusive for same-day end
      
      events.push({
        id: quote._id,
        title: quote.quoteData.quoteTitle || quote.name,
        start: formatDateForCalendar(firstDate),
        end: formatDateForCalendar(eventEndDate),
        extendedProps: {
          quoteName: quote.name,
          clientName: quote.clientName,
          total: quote.quoteData.total,
          totalServices: totalServices,
          dayCount: days.length,
          daysWithDates: daysWithDates.length,
          booked: quote.booked || false,
          createdAt: quote.createdAt,
          updatedAt: quote.updatedAt
        }
      });
    });

    res.json(events);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// Helper function to format date for calendar (YYYY-MM-DD)
function formatDateForCalendar(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================
// REPORTS ENDPOINTS
// ============================================

// Reports page route (admin only)
app.get('/reports', requireAuth, (req, res) => {
  // Check if user is admin
  if (req.user.role !== 'admin') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

// Get report data with filters (admin only)
app.get('/api/reports', requireApiAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { startDate, endDate, booked } = req.query;
    
    // Build query
    let query = { archived: { $ne: true } };
    
    // Date filter - filter by first day's date in the quote
    if (startDate || endDate) {
      // We'll filter after fetching since dates are nested in quoteData.days
    }
    
    // Booked filter
    if (booked !== undefined && booked !== '' && booked !== 'all') {
      query.booked = booked === 'true';
    }
    
    // Load all services to build a category lookup map
    const allServices = await Service.find({}, { category: 1 });
    const serviceCategoryMap = {};
    allServices.forEach(s => {
      serviceCategoryMap[s._id.toString()] = s.category || 'Other';
    });

    // Fetch all quotes matching base query
    const quotes = await SavedQuote.find(query, {
      name: 1,
      clientName: 1,
      location: 1,
      leadSource: 1,
      booked: 1,
      createdAt: 1,
      'quoteData.total': 1,
      'quoteData.days': 1
    });
    
    // Filter by date range (based on first event date in the quote)
    let filteredQuotes = quotes;
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      if (end) end.setHours(23, 59, 59, 999); // Include the entire end day
      
      filteredQuotes = quotes.filter(quote => {
        const days = quote.quoteData?.days || [];
        const daysWithDates = days.filter(d => d.date);
        if (daysWithDates.length === 0) return false;
        
        // Get the first event date
        const eventDates = daysWithDates.map(d => parseStoredDate(d.date)).filter(d => d).sort((a, b) => a - b);
        if (eventDates.length === 0) return false;
        
        const firstDate = eventDates[0];
        
        if (start && end) {
          return firstDate >= start && firstDate <= end;
        } else if (start) {
          return firstDate >= start;
        } else if (end) {
          return firstDate <= end;
        }
        return true;
      });
    }
    
    // Calculate aggregations
    const totalQuotes = filteredQuotes.length;
    const totalInvoiceAmount = filteredQuotes.reduce((sum, q) => sum + (q.quoteData?.total || 0), 0);
    const bookedCount = filteredQuotes.filter(q => q.booked).length;
    const notBookedCount = filteredQuotes.filter(q => !q.booked).length;
    
    // Top Clients by invoice amount
    const clientTotals = {};
    const clientCounts = {};
    filteredQuotes.forEach(quote => {
      const client = quote.clientName || 'Unknown';
      if (!clientTotals[client]) {
        clientTotals[client] = 0;
        clientCounts[client] = 0;
      }
      clientTotals[client] += quote.quoteData?.total || 0;
      clientCounts[client]++;
    });
    
    const topClientsByAmount = Object.entries(clientTotals)
      .map(([name, total]) => ({ name, total, count: clientCounts[name] }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    
    // Most Events (clients with most projects)
    const topClientsByCount = Object.entries(clientCounts)
      .map(([name, count]) => ({ name, count, total: clientTotals[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Top Cities
    const cityCounts = {};
    const cityTotals = {};
    filteredQuotes.forEach(quote => {
      const city = quote.location || 'Unknown';
      if (!cityCounts[city]) {
        cityCounts[city] = 0;
        cityTotals[city] = 0;
      }
      cityCounts[city]++;
      cityTotals[city] += quote.quoteData?.total || 0;
    });
    
    const topCities = Object.entries(cityCounts)
      .map(([name, count]) => ({ name, count, total: cityTotals[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Top Sources (normalize for consistent reporting buckets)
    const normalizeLeadSourceForReport = (source) => {
      if (!source) return 'Unknown';
      const standard = [
        'Repeat Client', 'Referral', 'Website / Inbound', 'LinkedIn', 'Social Media',
        'Google Search', 'Email / Newsletter', 'Trade Show / Industry Event',
        'Partner Referral', 'Cold Outreach', 'Other'
      ];
      if (standard.includes(source)) return source;
      if (source.startsWith('Referral:')) return 'Referral';
      if (source.startsWith('Other:')) return 'Other';
      const legacy = {
        repeat: 'Repeat Client',
        'repeat client': 'Repeat Client',
        referral: 'Referral',
        website: 'Website / Inbound',
        inbound: 'Website / Inbound',
        linkedin: 'LinkedIn',
        'social media': 'Social Media',
        instagram: 'Social Media',
        google: 'Google Search',
        email: 'Email / Newsletter',
        lumdash: 'Other'
      };
      const mapped = legacy[String(source).trim().toLowerCase()];
      if (mapped) return mapped;
      return 'Other';
    };

    const sourceCounts = {};
    const sourceTotals = {};
    filteredQuotes.forEach(quote => {
      const source = normalizeLeadSourceForReport(quote.leadSource);
      if (!sourceCounts[source]) {
        sourceCounts[source] = 0;
        sourceTotals[source] = 0;
      }
      sourceCounts[source]++;
      sourceTotals[source] += quote.quoteData?.total || 0;
    });
    
    const topSources = Object.entries(sourceCounts)
      .map(([name, count]) => ({ name, count, total: sourceTotals[name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Top Categories (by revenue from service items)
    const categoryCounts = {};
    const categoryTotals = {};
    filteredQuotes.forEach(quote => {
      const days = quote.quoteData?.days || [];
      days.forEach(day => {
        (day.services || []).forEach(service => {
          // Resolve category: try inline category, then lookup by service id, fallback to 'Other'
          const category = service.category || serviceCategoryMap[service.id] || 'Other';
          
          // Capitalize first letter for display consistency
          const displayCategory = category.charAt(0).toUpperCase() + category.slice(1);
          
          if (!categoryCounts[displayCategory]) {
            categoryCounts[displayCategory] = 0;
            categoryTotals[displayCategory] = 0;
          }
          
          // Calculate effective revenue for this service line
          const originalTotal = (service.price || 0) * (service.quantity || 1);
          let discountAmount = 0;
          if (service.discount && service.discount.applied && service.discount.value > 0) {
            if (service.discount.type === 'percentage') {
              discountAmount = originalTotal * (service.discount.value / 100);
            } else {
              discountAmount = service.discount.value;
            }
            discountAmount = Math.min(discountAmount, originalTotal);
          }
          const finalTotal = originalTotal - discountAmount;
          
          categoryCounts[displayCategory]++;
          categoryTotals[displayCategory] += finalTotal;
        });
      });
    });
    
    const topCategories = Object.entries(categoryTotals)
      .map(([name, total]) => ({ name, total, count: categoryCounts[name] }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    
    res.json({
      summary: {
        totalQuotes,
        totalInvoiceAmount,
        bookedCount,
        notBookedCount,
        conversionRate: totalQuotes > 0 ? ((bookedCount / totalQuotes) * 100).toFixed(1) : 0
      },
      topClientsByAmount,
      topClientsByCount,
      topCities,
      topSources,
      topCategories,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (error) {
    console.error('Error generating reports:', error);
    res.status(500).json({ error: 'Failed to generate reports' });
  }
});

// ============================================
// LUMQUOTE USER ENDPOINTS
// ============================================

// Get all LumQuote users (admin only)
app.get('/api/lumquote-users', requireApiAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const users = await LumQuoteUser.find({}).sort({ name: 1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching LumQuote users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all users for sharing (accessible by all logged-in users)
app.get('/api/shareable-users', requireApiAuth, async (req, res) => {
  try {
    const users = await LumQuoteUser.find({}, { name: 1, email: 1 }).sort({ name: 1 });
    res.json(users);
  } catch (error) {
    console.error('Error fetching shareable users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get users a quote is shared with
app.get('/api/quotes/:name/shared-with', requireApiAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const user = req.user;
    
    const quote = await SavedQuote.findOne({ name })
      .populate('createdBy', 'name')
      .populate('sharedWith.user', 'name email');
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Only owner or admin can see sharing details
    const isOwner = quote.createdBy && (quote.createdBy.name === user.name || quote.createdBy.name === user.fullName);
    if (user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the owner can manage sharing' });
    }
    
    res.json(quote.sharedWith || []);
  } catch (error) {
    console.error('Error fetching shared users:', error);
    res.status(500).json({ error: 'Failed to fetch shared users' });
  }
});

// Share a quote with a user
app.post('/api/quotes/:name/share', requireApiAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const { userId, accessLevel } = req.body;
    const user = req.user;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    if (accessLevel && !['read', 'full'].includes(accessLevel)) {
      return res.status(400).json({ error: 'Invalid access level' });
    }
    
    const quote = await SavedQuote.findOne({ name }).populate('createdBy', 'name');
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Only owner or admin can share
    const isOwner = quote.createdBy && (quote.createdBy.name === user.name || quote.createdBy.name === user.fullName);
    if (user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the owner can share this quote' });
    }
    
    // Check if user exists
    const targetUser = await LumQuoteUser.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already shared with this user
    const existingShare = quote.sharedWith?.find(s => s.user?.toString() === userId);
    if (existingShare) {
      // Update access level if already shared
      existingShare.accessLevel = accessLevel || 'read';
      await quote.save();
      return res.json({ success: true, message: 'Access level updated' });
    }
    
    // Add to shared list
    quote.sharedWith = quote.sharedWith || [];
    quote.sharedWith.push({
      user: userId,
      accessLevel: accessLevel || 'read',
      sharedAt: new Date()
    });
    
    await quote.save();
    
    res.json({ success: true, message: `Quote shared with ${targetUser.name}` });
  } catch (error) {
    console.error('Error sharing quote:', error);
    res.status(500).json({ error: 'Failed to share quote' });
  }
});

// Remove share access from a user
app.delete('/api/quotes/:name/share/:userId', requireApiAuth, async (req, res) => {
  try {
    const { name, userId } = req.params;
    const user = req.user;
    
    const quote = await SavedQuote.findOne({ name }).populate('createdBy', 'name');
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Only owner or admin can remove sharing
    const isOwner = quote.createdBy && (quote.createdBy.name === user.name || quote.createdBy.name === user.fullName);
    if (user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Only the owner can manage sharing' });
    }
    
    // Remove from shared list
    quote.sharedWith = (quote.sharedWith || []).filter(s => s.user?.toString() !== userId);
    await quote.save();
    
    res.json({ success: true, message: 'Share access removed' });
  } catch (error) {
    console.error('Error removing share:', error);
    res.status(500).json({ error: 'Failed to remove share access' });
  }
}); 