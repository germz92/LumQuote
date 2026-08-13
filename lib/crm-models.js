/**
 * CRM data models — Clients, Projects, Contracts, Invoices, Company settings.
 * Startup helpers seed clients from quote names and undo auto-wrapped quote→project links.
 * Quotes stay unlinked unless created inside a project or linked by a user.
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
  googleCalendarEventId: { type: String, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sharedWith: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'LumQuoteUser' },
    accessLevel: { type: String, enum: ['read', 'full'], default: 'read' },
    sharedAt: { type: Date, default: Date.now }
  }]
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

const contractFieldResponseSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  type: { type: String, enum: ['initials', 'checkbox'], required: true },
  value: { type: String, default: '' },
  label: { type: String, default: '' },
  completedAt: { type: Date, default: Date.now }
}, { _id: false });

const emailLogSchema = new mongoose.Schema({
  type: { type: String, required: true },
  to: [{ type: String }],
  subject: { type: String, default: '' },
  providerMessageId: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
  openedAt: { type: Date, default: null },
  openCount: { type: Number, default: 0 },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: true });

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
  firstViewedAt: { type: Date, default: null },
  lastViewedAt: { type: Date, default: null },
  viewCount: { type: Number, default: 0 },
  emailLog: { type: [emailLogSchema], default: [] },
  fieldResponses: { type: [contractFieldResponseSchema], default: [] },
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

const lineItemDiscountSchema = new mongoose.Schema({
  type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  value: { type: Number, default: 0 },
  applied: { type: Boolean, default: false }
}, { _id: false });

const invoiceLineItemSchema = new mongoose.Schema({
  day: { type: String, default: '' },          // e.g. "Fri, Nov 5, 2027" — groups rows like the quote
  description: { type: String, default: '' },
  detail: { type: String, default: '' },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  // Origin fields for lossless quote-editor round-trip
  kind: { type: String, enum: ['service', 'markup'], default: 'service' },
  dayDate: { type: String, default: null },    // YYYY-MM-DD
  serviceId: { type: String, default: null },
  category: { type: String, default: '' },
  tentative: { type: Boolean, default: false },
  detailDescription: { type: String, default: '' },
  discount: { type: lineItemDiscountSchema, default: null }
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
  discountPercentage: { type: Number, default: 0 }, // quote-level % for editor round-trip
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
  firstViewedAt: { type: Date, default: null },
  lastViewedAt: { type: Date, default: null },
  viewCount: { type: Number, default: 0 },
  emailLog: { type: [emailLogSchema], default: [] },
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
  achEnabled: { type: Boolean, default: false },
  googleCalendar: {
    type: new mongoose.Schema({
      refreshToken: { type: String, default: '' },
      calendarId: { type: String, default: '' },
      calendarName: { type: String, default: '' },
      email: { type: String, default: '' },
      connectedBy: { type: String, default: '' },
      connectedAt: { type: Date, default: null }
    }, { _id: false }),
    default: () => ({})
  }
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

/**
 * Set project start/end from the min/max day dates across linked quote docs.
 * Returns true when the project was saved with new dates.
 */
async function syncProjectDatesFromQuotes(project, quotes) {
  if (!project) return false;
  const dates = [];
  (quotes || []).forEach((quote) => {
    (quote?.quoteData?.days || []).forEach((day) => {
      if (day?.date) dates.push(String(day.date));
    });
  });
  dates.sort();
  if (dates.length === 0) return false;

  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  if (project.startDate === startDate && project.endDate === endDate) return false;

  project.startDate = startDate;
  project.endDate = endDate;
  await project.save();
  return true;
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
 * Idempotent: ensure a Client exists for each distinct quote clientName.
 * Does NOT create or attach projects — quotes stay unlinked by default.
 */
async function runCrmMigration(SavedQuote) {
  const namedQuotes = await SavedQuote.find(
    { clientName: { $nin: [null, ''] } },
    { clientName: 1 }
  );
  const clientCache = new Map();
  let ensured = 0;

  for (const quote of namedQuotes) {
    try {
      const before = clientCache.has((quote.clientName || '').trim().toLowerCase());
      await findOrCreateClientByName(quote.clientName, clientCache);
      if (!before) ensured++;
    } catch (err) {
      console.error(`CRM migration: could not ensure client for "${quote.clientName}":`, err.message);
    }
  }

  if (ensured > 0) {
    console.log(`✅ CRM migration: ensured ${ensured} client(s) from quote names`);
  }
  return { clientsEnsured: ensured };
}

/**
 * One-shot cleanup for the old "one project per quote" wrap.
 * Unlinks quotes and deletes projects that look like empty auto-wrappers:
 * exactly one linked quote, no contracts, no invoices.
 * Intended for manual `node scripts/migrate-crm.js` — not every startup
 * (otherwise intentional Convert-to-Project links would be undone).
 */
async function unlinkAutoWrappedProjects(SavedQuote) {
  const linkedQuotes = await SavedQuote.find(
    { project: { $ne: null, $exists: true } },
    { _id: 1, project: 1 }
  );
  if (linkedQuotes.length === 0) {
    return { unlinked: 0, deletedProjects: 0 };
  }

  const byProject = new Map();
  linkedQuotes.forEach((quote) => {
    const key = String(quote.project);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(quote._id);
  });

  let unlinked = 0;
  let deletedProjects = 0;

  for (const [projectId, quoteIds] of byProject.entries()) {
    if (quoteIds.length !== 1) continue;

    try {
      const [contractCount, invoiceCount] = await Promise.all([
        Contract.countDocuments({ project: projectId }),
        Invoice.countDocuments({ project: projectId })
      ]);
      if (contractCount > 0 || invoiceCount > 0) continue;

      await SavedQuote.updateOne({ _id: quoteIds[0] }, { $set: { project: null } });
      unlinked++;

      const project = await Project.findById(projectId);
      if (project) {
        await Project.findByIdAndDelete(projectId);
        deletedProjects++;
      }
    } catch (err) {
      console.error(`CRM unlink: could not unwrap project ${projectId}:`, err.message);
    }
  }

  if (unlinked > 0 || deletedProjects > 0) {
    console.log(`✅ CRM unlink: unlinked ${unlinked} quote(s), deleted ${deletedProjects} wrapper project(s)`);
  }
  return { unlinked, deletedProjects };
}

/**
 * Idempotent: if a quote was marked booked under the old model and is linked
 * to a project, advance that project to booked (no LumDash side effects).
 */
async function advanceProjectsFromBookedQuotes(SavedQuote) {
  const bookedLinked = await SavedQuote.find(
    { booked: true, project: { $ne: null, $exists: true } },
    { project: 1 }
  );
  if (bookedLinked.length === 0) return { advanced: 0 };

  const projectIds = [...new Set(bookedLinked.map((q) => String(q.project)))];
  let advanced = 0;
  const order = PROJECT_STATUSES.reduce((map, status, i) => {
    map[status] = i;
    return map;
  }, {});

  for (const id of projectIds) {
    try {
      const project = await Project.findById(id);
      if (!project) continue;
      if ((order[project.status] || 0) >= order.booked) continue;
      project.status = 'booked';
      await project.save();
      advanced++;
    } catch (err) {
      console.error(`CRM booked migrate: could not advance project ${id}:`, err.message);
    }
  }

  if (advanced > 0) {
    console.log(`✅ CRM booked migrate: advanced ${advanced} project(s) to booked`);
  }
  return { advanced };
}

// ---------- Default contract templates ----------
// Bodies adapted from docs/contract-clause-snippets.md (legacy Lumetry terms).

const DEFAULT_TEMPLATES = [
  {
    name: 'General Terms',
    alwaysInclude: true,
    sortOrder: 0,
    categories: [],
    body: `<h3>Agreement</h3>
<p>This Service Agreement (the "Agreement") is entered into between {{our_company}} ("Provider") and {{client_name}}{{client_company_clause}} ("Client") for services to be performed on {{project_dates}}.</p>
<h3>Services</h3>
<p>The following is a breakdown of each service to be provided in accordance with this contract. Applicable service descriptions appear in the sections below based on the services in the accepted quote.</p>
<h3>Payment</h3>
<p>The total investment for the services described in this Agreement is {{investment}}. The remaining balance after any retainer is due upon receipt of the final invoice unless otherwise agreed in writing.</p>
<h3>Cancellation &amp; Rescheduling</h3>
<p>Rescheduling requests are subject to Provider availability. Cancellation terms are governed by the Retainer section of this Agreement.</p>`
  },
  {
    name: 'Retainer',
    alwaysInclude: true,
    sortOrder: 5,
    categories: [],
    body: `<h3>Retainer</h3>
<p>A retainer of 50% of {{investment}} is due once the contract has been signed. In the event of cancellation, the retainer paid is non-refundable. Client agrees to provide cancellation notice in writing and releases the {{service_role}} from any further responsibilities and liabilities related to the cancelled engagement.</p>`
  },
  {
    name: 'Photography Terms',
    categories: ['Photography'],
    sortOrder: 10,
    body: `<h3>Event Photography</h3>
<p><strong>Event Photography:</strong> Professional photographic coverage of the event, including attendees, speakers, seminars, activations, and general event activities.</p>
<p>Provider will supply professional photography coverage as described in the accepted quote. Client will receive edited, high-resolution images delivered {{photo_delivery}}. RAW/unedited files are not included.</p>`
  },
  {
    name: 'Videography Terms',
    categories: ['Videography'],
    sortOrder: 20,
    body: `<h3>Event Videography</h3>
<p><strong>Event Videography:</strong> Comprehensive video coverage of the event, capturing attendees, presenters, seminars, and key moments throughout the day(s).</p>
<p>Provider will supply professional videography coverage as described in the accepted quote. Edited video deliverables will be provided {{video_delivery}}. Raw footage is not included unless specified in the quote.</p>`
  },
  {
    name: 'Headshot Booth Terms',
    categories: ['Headshot Booth'],
    sortOrder: 30,
    body: `<h3>Headshot Booth</h3>
<p><strong>Headshot Booth:</strong> A dedicated headshot station providing high-quality, professionally lit portraits for event attendees.</p>
<p>Provider will operate an on-site headshot booth for the hours described in the accepted quote. Client is responsible for providing adequate space, power, and reasonable access for setup at least one (1) hour before the start time. Participants will receive access to their images via online delivery. Basic retouching is included; additional retouching is available at Provider's standard rates.</p>
<h3>Booth Service Period</h3>
<p>Provider agrees to have {{our_company}}'s Headshot Booth operational for a minimum of 80% of the contracted service period. Occasionally, operations may need to be interrupted for maintenance of the Headshot Booth.</p>`
  },
  {
    name: 'House Rules',
    categories: ['Photography', 'Videography', 'Headshot Booth'],
    sortOrder: 35,
    body: `<h3>House Rules</h3>
<p>The {{service_role}} is limited by the guidelines of the event site management. Client agrees to accept the technical results of those guidelines' imposition on the {{service_role}}. Negotiation with officials for moderation of guidelines is Client's responsibility; the {{service_role}} will offer technical recommendations only.</p>
<p>The {{service_role}} will not video record or photograph any event in the rain or other inclement weather that would damage equipment. If weather conditions prohibit photography and/or videography of the event, in part or in whole, and arrangements have not been made to move the event indoors, any retainer and other moneys paid are non-refundable.</p>
<p>Aerial footage is available only if weather permits and airspace is clear of obstructions, including power lines, tall buildings, pedestrians, and trees.</p>`
  },
  {
    name: 'Film and Copyrights',
    categories: ['Photography', 'Videography', 'Headshot Booth'],
    sortOrder: 36,
    body: `<h3>Film and Copyrights</h3>
<p>Until final payment for services is made, the images and videos produced by the {{service_role}} are protected by Federal Copyright Law (all rights reserved) and may not be reproduced in any manner without the {{service_role}}'s explicit written permission. Upon full payment, Client receives a non-exclusive license for personal and internal business use, unless otherwise agreed in writing. {{our_company}} may use selected images and video for portfolio and marketing purposes unless Client opts out in writing.</p>`
  },
  {
    name: 'Limit of Liability',
    alwaysInclude: true,
    sortOrder: 37,
    categories: [],
    body: `<h3>Limit of Liability</h3>
<p>In the unlikely event that the {{service_role}} is injured or becomes too ill to cover the event, the {{service_role}} will make every effort to secure a replacement. If a suitable replacement is not found, responsibility and liability are limited to the return of all payments received for the event package.</p>
<p>The {{service_role}} takes the utmost care with respect to exposure, transportation, and processing of images and videos. However, in the unlikely event that images and/or videos have been lost, stolen, or destroyed for reasons within or beyond the {{service_role}}'s control, the {{service_role}}'s liability is limited to the return of all payments received for the event. The limit of liability for a partial loss of originals shall be a prorated amount based on the percentage of total footage or images lost.</p>`
  },
  {
    name: 'AI Services Terms',
    categories: ['AI'],
    sortOrder: 40,
    body: `<h3>AI Services</h3>
<p>Provider will deliver the AI-powered services described in the accepted quote. Client acknowledges that AI-generated outputs may require review and that Provider will make commercially reasonable efforts to ensure quality and accuracy of deliverables.</p>`
  }
];

/**
 * One-time bootstrap only: if the clause library is empty, insert defaults.
 * After that, Admin owns the collection — edits and deletes are never restored.
 */
async function seedContractTemplates() {
  const existingCount = await ContractTemplate.countDocuments();
  if (existingCount > 0) return;

  const docs = DEFAULT_TEMPLATES.map((template) => ({
    name: template.name,
    body: template.body,
    categories: template.categories || [],
    alwaysInclude: !!template.alwaysInclude,
    sortOrder: template.sortOrder ?? 0,
    services: template.services || []
  }));
  if (docs.length === 0) return;

  await ContractTemplate.insertMany(docs);
  console.log(`✅ Contract templates: seeded ${docs.length} defaults (empty library)`);
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
  syncProjectDatesFromQuotes,
  runCrmMigration,
  unlinkAutoWrappedProjects,
  advanceProjectsFromBookedQuotes,
  seedContractTemplates
};
