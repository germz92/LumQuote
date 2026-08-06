/**
 * CRM data models — Clients, Projects, Contracts, Invoices, Company settings.
 * Also contains the idempotent migration that wraps existing quotes in projects.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

// ---------- Schemas ----------

const addressSchema = new mongoose.Schema({
  street: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  zip: { type: String, default: '' },
  country: { type: String, default: '' }
}, { _id: false });

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  phone: { type: String, default: '', trim: true },
  company: { type: String, default: '', trim: true },
  address: { type: addressSchema, default: () => ({}) },
  notes: { type: String, default: '' }
}, { timestamps: true });

clientSchema.index({ name: 1 });

const Client = mongoose.model('CrmClient', clientSchema, 'crmClients');

const PROJECT_STATUSES = ['lead', 'quoted', 'booked', 'contract_signed', 'invoiced', 'paid', 'complete'];

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmClient', default: null },
  status: { type: String, enum: PROJECT_STATUSES, default: 'lead' },
  // Stored as YYYY-MM-DD strings to match quote day dates and avoid TZ drift
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  notes: { type: String, default: '' },
  archived: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

const Project = mongoose.model('CrmProject', projectSchema, 'crmProjects');

const contractTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  body: { type: String, default: '' },
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
  categories: [{ type: String }],
  alwaysInclude: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

const ContractTemplate = mongoose.model('ContractTemplate', contractTemplateSchema, 'contractTemplates');

const signatureSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  title: { type: String, default: '' }, // signer's role, used for the company countersignature
  method: { type: String, enum: ['typed', 'drawn'], default: 'typed' },
  imageData: { type: String, default: null }, // data URL of drawn signature
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  signedAt: { type: Date, default: null },
  documentHash: { type: String, default: '' }
}, { _id: false });

const contractSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmProject', required: true },
  sourceQuote: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedQuote', default: null },
  source: { type: String, enum: ['generated', 'uploaded'], default: 'generated' },
  title: { type: String, default: 'Service Agreement' },
  contentHtml: { type: String, default: '' },
  uploadedFile: {
    url: { type: String, default: null },
    publicId: { type: String, default: null },
    filename: { type: String, default: null },
    localPath: { type: String, default: null },
    mimeType: { type: String, default: null }
  },
  investment: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'sent', 'signed'], default: 'draft' },
  publicToken: { type: String, default: null, index: true },
  sentAt: { type: Date, default: null },
  signature: { type: signatureSchema, default: () => ({}) },
  countersignature: { type: signatureSchema, default: () => ({}) },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

const Contract = mongoose.model('Contract', contractSchema, 'contracts');

const partySchema = new mongoose.Schema({
  name: { type: String, default: '' },
  company: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' } // free-form, multi-line
}, { _id: false });

const invoiceLineItemSchema = new mongoose.Schema({
  day: { type: String, default: '' },          // e.g. "Fri, Nov 5, 2027" — groups rows like the quote
  description: { type: String, default: '' },
  detail: { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, default: 0 },
  amount: { type: Number, default: 0 }
}, { _id: false });

const installmentSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  percent: { type: Number, default: null },   // % of invoice total; amount is derived
  amount: { type: Number, default: 0 },       // dollar snapshot (recomputed on save)
  dueType: { type: String, enum: ['immediate', 'fixed', 'relative'], default: 'immediate' },
  dueDate: { type: String, default: null },   // used when dueType === 'fixed'
  anchor: {
    type: String,
    enum: ['project_start', 'project_end', 'contract_signed', 'issue_date'],
    default: 'project_start'
  },
  offsetDays: { type: Number, default: 0 },   // negative = before anchor
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  paidAt: { type: Date, default: null },
  stripeSessionId: { type: String, default: null },
  stripePaymentIntentId: { type: String, default: null }
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmProject', required: true },
  sourceQuote: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedQuote', default: null },
  invoiceNumber: { type: String, required: true, unique: true },
  status: { type: String, enum: ['draft', 'sent', 'paid', 'void'], default: 'draft' },
  from: { type: partySchema, default: () => ({}) },
  to: { type: partySchema, default: () => ({}) },
  subtitle: { type: String, default: '' },     // extra words under the invoice number
  headerNote: { type: String, default: '' },   // text at top of invoice
  footerNote: { type: String, default: '' },   // text at bottom of invoice
  lineItems: [invoiceLineItemSchema],
  subtotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  currency: { type: String, default: 'usd' },
  issueDate: { type: String, default: null },  // YYYY-MM-DD
  dueDate: { type: String, default: null },
  paymentPlan: {
    enabled: { type: Boolean, default: false },
    installments: { type: [installmentSchema], default: [] }
  },
  publicToken: { type: String, default: null, index: true },
  sentAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  stripeSessionId: { type: String, default: null },
  stripePaymentIntentId: { type: String, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

const Invoice = mongoose.model('Invoice', invoiceSchema, 'invoices');

const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 1000 }
});

const Counter = mongoose.model('CrmCounter', counterSchema, 'counters');

const companySettingsSchema = new mongoose.Schema({
  singletonKey: { type: String, default: 'company', unique: true },
  companyName: { type: String, default: 'Lumetry Media' },
  email: { type: String, default: 'sales@lumetrymedia.com' },
  phone: { type: String, default: '' },
  website: { type: String, default: '' },
  address: { type: addressSchema, default: () => ({}) },
  logoUrl: { type: String, default: '' },
  contractSignerName: { type: String, default: '' },
  contractSignerTitle: { type: String, default: '' },
  invoiceFooterDefault: { type: String, default: 'Thank you for your business!' },
  // Payment settings
  cardFeeEnabled: { type: Boolean, default: false },
  cardFeePercent: { type: Number, default: 3 },
  achEnabled: { type: Boolean, default: false }
}, { timestamps: true });

const CompanySettings = mongoose.model('CompanySettings', companySettingsSchema, 'companySettings');

// ---------- Helpers ----------

function generatePublicToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function nextInvoiceNumber() {
  let counter = await Counter.findByIdAndUpdate(
    'invoice',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  // $inc on upsert starts at 1 (schema defaults don't apply) — enforce the 1000 floor
  if (counter.seq <= 1000) {
    counter = await Counter.findByIdAndUpdate('invoice', { $set: { seq: 1001 } }, { new: true });
  }
  return `INV-${counter.seq}`;
}

async function getCompanySettings() {
  let settings = await CompanySettings.findOne({ singletonKey: 'company' });
  if (!settings) {
    settings = await CompanySettings.create({ singletonKey: 'company' });
  }
  return settings;
}

function quoteDateRange(quoteData) {
  const dates = (quoteData?.days || [])
    .map((day) => day.date)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return { startDate: null, endDate: null };
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

// ---------- Migration ----------

async function findOrCreateClientByName(name, cache) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let client = await Client.findOne({ name: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (!client) {
    client = await Client.create({ name: trimmed });
  }
  cache.set(key, client);
  return client;
}

/**
 * Idempotent: creates a Client per distinct quote clientName and wraps every
 * quote that has no project into its own project.
 */
async function runCrmMigration(SavedQuote) {
  const orphanQuotes = await SavedQuote.find({
    $or: [{ project: null }, { project: { $exists: false } }]
  });

  if (orphanQuotes.length === 0) return { migrated: 0 };

  const clientCache = new Map();
  let migrated = 0;

  for (const quote of orphanQuotes) {
    try {
      const client = await findOrCreateClientByName(quote.clientName, clientCache);
      const { startDate, endDate } = quoteDateRange(quote.quoteData);

      const project = await Project.create({
        name: quote.quoteData?.quoteTitle || quote.name,
        client: client ? client._id : null,
        status: quote.booked ? 'booked' : 'quoted',
        startDate,
        endDate,
        archived: !!quote.archived,
        createdBy: quote.createdBy || null
      });

      quote.project = project._id;
      await quote.save();
      migrated++;
    } catch (err) {
      console.error(`CRM migration: could not migrate quote "${quote.name}":`, err.message);
    }
  }

  console.log(`✅ CRM migration: wrapped ${migrated} quote(s) into projects`);
  return { migrated };
}

// ---------- Default contract templates ----------

const DEFAULT_TEMPLATES = [
  {
    name: 'General Terms',
    alwaysInclude: true,
    sortOrder: 0,
    categories: [],
    body: `<h3>Agreement</h3>
<p>This Service Agreement (the "Agreement") is entered into between {{our_company}} ("Provider") and {{client_name}}{{client_company_clause}} ("Client") for services to be performed on {{project_dates}}.</p>
<h3>Payment</h3>
<p>The total investment for the services described in this Agreement is {{investment}}. A signed agreement and any agreed-upon deposit are required to reserve the project dates. The remaining balance is due upon receipt of the final invoice unless otherwise agreed in writing.</p>
<h3>Cancellation &amp; Rescheduling</h3>
<p>Cancellations made more than 30 days before the first project date will forfeit any deposit paid. Cancellations within 30 days of the first project date are responsible for 50% of the total investment. Rescheduling requests are subject to Provider availability.</p>
<h3>Liability</h3>
<p>Provider's total liability under this Agreement shall not exceed the total amount paid by Client. Provider is not responsible for failures caused by events beyond its reasonable control, including venue restrictions, weather, or acts of God.</p>`
  },
  {
    name: 'Photography Terms',
    categories: ['Photography'],
    sortOrder: 10,
    body: `<h3>Photography Services</h3>
<p>Provider will supply professional photography coverage as described in the accepted quote. Client will receive edited, high-resolution images delivered via online gallery within four (4) weeks of the final project date. RAW/unedited files are not included.</p>
<p>Provider retains copyright to all images and grants Client a non-exclusive license for personal and internal business use. Provider may use selected images for portfolio and marketing purposes unless Client opts out in writing.</p>`
  },
  {
    name: 'Videography Terms',
    categories: ['Videography'],
    sortOrder: 20,
    body: `<h3>Videography Services</h3>
<p>Provider will supply professional videography coverage as described in the accepted quote. Edited video deliverables will be provided within six (6) weeks of the final project date. Raw footage is not included unless specified in the quote.</p>
<p>Up to two (2) rounds of revisions are included per video deliverable. Additional revisions are billed at Provider's standard hourly rate. Provider retains copyright and grants Client a non-exclusive license for personal and internal business use.</p>`
  },
  {
    name: 'Headshot Booth Terms',
    categories: ['Headshot Booth'],
    sortOrder: 30,
    body: `<h3>Headshot Booth Services</h3>
<p>Provider will operate an on-site headshot booth for the hours described in the accepted quote. Client is responsible for providing adequate space, power, and reasonable access for setup at least one (1) hour before the start time.</p>
<p>Participants will receive access to their images via online delivery. Basic retouching is included; additional retouching is available at Provider's standard rates.</p>`
  },
  {
    name: 'AI Services Terms',
    categories: ['AI'],
    sortOrder: 40,
    body: `<h3>AI Services</h3>
<p>Provider will deliver the AI-powered services described in the accepted quote. Client acknowledges that AI-generated outputs may require review and that Provider will make commercially reasonable efforts to ensure quality and accuracy of deliverables.</p>`
  }
];

async function seedContractTemplates() {
  const count = await ContractTemplate.countDocuments();
  if (count > 0) return;
  await ContractTemplate.insertMany(DEFAULT_TEMPLATES);
  console.log('✅ Seeded default contract templates');
}

module.exports = {
  Client,
  Project,
  ContractTemplate,
  Contract,
  Invoice,
  Counter,
  CompanySettings,
  PROJECT_STATUSES,
  generatePublicToken,
  nextInvoiceNumber,
  getCompanySettings,
  quoteDateRange,
  runCrmMigration,
  seedContractTemplates
};
