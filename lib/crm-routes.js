/**
 * CRM routes — projects, clients, contracts (generation + e-sign), invoices (Stripe).
 * Registered from server.js after core models are defined.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const {
  Client,
  Project,
  ContractTemplate,
  Contract,
  Invoice,
  PROJECT_STATUSES,
  generatePublicToken,
  nextInvoiceNumber,
  getCompanySettings,
  quoteDateRange
} = require('./crm-models');

const { generatePdfFromHtml } = require('./pdf-generator');

const CONTRACT_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'contracts');
const CONTRACT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

const STATUS_ORDER = PROJECT_STATUSES.reduce((map, status, i) => {
  map[status] = i;
  return map;
}, {});

// ---------- Stripe ----------

let stripeClient = null;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) {
    try {
      const Stripe = require('stripe');
      stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    } catch (err) {
      console.error('Stripe package not available:', err.message);
      return null;
    }
  }
  return stripeClient;
}

// ---------- Utilities ----------

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function formatMoney(amount, currency = 'usd') {
  const symbol = currency === 'usd' ? '$' : '';
  return `${symbol}${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseYmd(value) {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateLong(value) {
  const date = parseYmd(value);
  if (!date) return null;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateRange(startDate, endDate) {
  const start = formatDateLong(startDate);
  const end = formatDateLong(endDate);
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end || 'TBD';
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function addressToLines(address = {}) {
  const lines = [];
  if (address.street) lines.push(address.street);
  const cityLine = [address.city, address.state].filter(Boolean).join(', ');
  const cityZip = [cityLine, address.zip].filter(Boolean).join(' ');
  if (cityZip) lines.push(cityZip);
  if (address.country) lines.push(address.country);
  return lines;
}

function advanceOrder(a, b) {
  return (STATUS_ORDER[b] ?? -1) > (STATUS_ORDER[a] ?? -1) ? b : a;
}

async function advanceProjectStatus(projectId, status) {
  const project = await Project.findById(projectId);
  if (!project) return;
  const next = advanceOrder(project.status, status);
  if (next !== project.status) {
    project.status = next;
    await project.save();
  }
}

// ---------- Quote → invoice conversion ----------

function formatDayShort(ymd) {
  const date = parseYmd(ymd);
  if (!date) return null;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function buildInvoiceLineItemsFromQuote(quoteData, serviceCatalog = new Map()) {
  const lineItems = [];
  let subtotal = 0;

  (quoteData?.days || []).forEach((day, dayIndex) => {
    const dayLabel = formatDayShort(day.date) || ((quoteData.days.length > 1) ? `Day ${dayIndex + 1}` : '');
    (day.services || []).forEach((service) => {
      if (service.tentative) return;
      const quantity = service.quantity || 1;
      const gross = (service.price || 0) * quantity;
      let discount = 0;
      if (service.discount && service.discount.applied && service.discount.value > 0) {
        discount = service.discount.type === 'percentage'
          ? gross * (service.discount.value / 100)
          : Math.min(service.discount.value, gross);
      }
      const amount = gross - discount;
      subtotal += amount;
      const description = service.description !== undefined
        ? service.description
        : (serviceCatalog.get(String(service.id)) || '');
      lineItems.push({
        day: dayLabel,
        description: service.name || 'Service',
        detail: [description, discount > 0 ? 'Discount applied' : ''].filter(Boolean).join(' • '),
        quantity,
        unitPrice: service.price || 0,
        amount: Math.round(amount * 100) / 100
      });
    });
  });

  (quoteData?.markups || []).forEach((markup) => {
    const amount = typeof markup.markupAmount === 'number' ? markup.markupAmount : 0;
    if (amount <= 0) return;
    subtotal += amount;
    lineItems.push({
      day: '',
      description: markup.name || 'Markup',
      detail: markup.description || '',
      quantity: 1,
      unitPrice: Math.round(amount * 100) / 100,
      amount: Math.round(amount * 100) / 100
    });
  });

  const discountPercentage = quoteData?.discountPercentage || 0;
  const discountAmount = Math.round(subtotal * (discountPercentage / 100) * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;

  return {
    lineItems,
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount,
    discountPercentage,
    total
  };
}

function todayYmd(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clientToParty(client) {
  if (!client) return {};
  return {
    name: client.name || '',
    company: client.company || '',
    email: client.email || '',
    phone: client.phone || '',
    address: addressToLines(client.address).join('\n')
  };
}

function settingsToParty(settings) {
  return {
    name: settings.companyName || '',
    company: '',
    email: settings.email || '',
    phone: settings.phone || '',
    address: addressToLines(settings.address).join('\n')
  };
}

// ---------- Contract assembly ----------

const ROLE_BY_CATEGORY = {
  photography: 'Photographer',
  headshot: 'Photographer',
  'headshot booth': 'Photographer',
  videography: 'Videographer',
  editing: 'Editor'
};

function roleForCategory(category) {
  return ROLE_BY_CATEGORY[String(category || '').toLowerCase().trim()] || 'Service Provider';
}

/** "A" | "A and B" | "A, B, and C" */
function joinList(items) {
  const unique = [...new Set(items.filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

function resolveMergeFields(body, ctx) {
  const clientCompanyClause = ctx.clientCompany ? ` of ${ctx.clientCompany}` : '';
  const map = {
    client_name: ctx.clientName || 'Client',
    client_company: ctx.clientCompany || '',
    client_company_clause: clientCompanyClause,
    client_email: ctx.clientEmail || '',
    client_phone: ctx.clientPhone || '',
    client_address: ctx.clientAddress || '',
    company_name: ctx.clientCompany || ctx.clientName || '',
    our_company: ctx.ourCompany || 'Lumetry Media',
    our_email: ctx.ourEmail || '',
    our_phone: ctx.ourPhone || '',
    project_name: ctx.projectName || '',
    project_dates: ctx.projectDates || 'TBD',
    investment: ctx.investment || '$0.00',
    service_name: ctx.serviceNames || 'the contracted services',
    service_names: ctx.serviceNames || 'the contracted services',
    service_role: ctx.serviceRole || 'Service Provider'
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const value = map[key.toLowerCase()];
    return value !== undefined ? escapeHtml(value) : match;
  });
}

function collectQuoteServiceInfo(quoteData) {
  // id -> { name, category } for every service used in the quote
  const services = new Map();
  const categories = new Set();
  (quoteData?.days || []).forEach((day) => {
    (day.services || []).forEach((service) => {
      const category = service.category ? String(service.category).toLowerCase() : '';
      if (category) categories.add(category);
      if (!service.id) return;
      const id = String(service.id);
      const existing = services.get(id) || {};
      services.set(id, {
        name: service.name || existing.name || '',
        category: category || existing.category || ''
      });
    });
  });
  return { services, categories };
}

async function assembleContractHtml({ quote, project, client, settings, ServiceModel }) {
  const quoteData = quote?.quoteData || {};
  const { services: quoteServices, categories } = collectQuoteServiceInfo(quoteData);

  // Quote line items only snapshot id/name/price — resolve categories from the catalog
  if (quoteServices.size > 0 && ServiceModel) {
    const catalogServices = await ServiceModel.find({ _id: { $in: [...quoteServices.keys()] } }, { name: 1, category: 1 });
    catalogServices.forEach((s) => {
      const entry = quoteServices.get(String(s._id));
      if (entry) {
        if (!entry.name && s.name) entry.name = s.name;
        if (!entry.category && s.category) entry.category = String(s.category).toLowerCase();
      }
      if (s.category) categories.add(String(s.category).toLowerCase());
    });
  }

  const allQuoteServices = [...quoteServices.values()];
  const templates = await ContractTemplate.find().sort({ sortOrder: 1, createdAt: 1 });
  const included = [];
  const seen = new Set();

  templates.forEach((template) => {
    const templateCategories = (template.categories || []).map((c) => String(c).toLowerCase());
    const templateServiceIds = new Set((template.services || []).map((s) => String(s)));
    const matches = template.alwaysInclude
      || templateCategories.some((c) => categories.has(c))
      || [...templateServiceIds].some((id) => quoteServices.has(id));
    if (matches && !seen.has(String(template._id))) {
      seen.add(String(template._id));
      // Which quote services triggered this clause — drives {{service_name}} / {{service_role}}
      let matchedServices = [...quoteServices.entries()]
        .filter(([id, s]) => templateServiceIds.has(id) || templateCategories.includes(s.category))
        .map(([, s]) => s);
      if (matchedServices.length === 0) matchedServices = allQuoteServices;
      included.push({ template, matchedServices });
    }
  });

  const investment = formatMoney(quoteData.total || 0);
  const dates = quoteDateRange(quoteData);
  const ctx = {
    clientName: client?.name || quote?.clientName || 'Client',
    clientCompany: client?.company || '',
    clientEmail: client?.email || '',
    clientPhone: client?.phone || '',
    clientAddress: client ? addressToLines(client.address).join(', ') : '',
    ourCompany: settings.companyName,
    ourEmail: settings.email,
    ourPhone: settings.phone,
    projectName: project?.name || '',
    projectDates: formatDateRange(dates.startDate || project?.startDate, dates.endDate || project?.endDate),
    investment
  };

  const sections = included.map(({ template, matchedServices }) => resolveMergeFields(template.body, {
    ...ctx,
    serviceNames: joinList(matchedServices.map((s) => s.name)),
    serviceRole: joinList([...new Set(matchedServices.map((s) => roleForCategory(s.category)))])
  }));
  return {
    contentHtml: sections.join('\n<hr class="contract-section-divider">\n'),
    investment: quoteData.total || 0
  };
}

// ---------- PDF / document rendering ----------

const DOC_BASE_CSS = `
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2430; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  h3 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 0 0 10px; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1f2430; padding-bottom: 14px; margin-bottom: 20px; }
  .doc-meta { text-align: right; font-size: 11px; color: #555; }
  .muted { color: #666; }
  hr.contract-section-divider { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
  table.items { width: 100%; border-collapse: collapse; margin: 14px 0; }
  table.items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; border-bottom: 1.5px solid #1f2430; padding: 6px 8px; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.items .num { text-align: right; white-space: nowrap; }
  .totals { width: 260px; margin-left: auto; margin-top: 8px; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 8px; }
  .totals .grand { font-weight: bold; font-size: 14px; border-top: 2px solid #1f2430; margin-top: 4px; padding-top: 7px; }
  .sig-block { margin-top: 44px; display: flex; gap: 48px; }
  .sig-slot { flex: 1; }
  .sig-line { border-bottom: 1px solid #333; height: 44px; display: flex; align-items: flex-end; }
  .sig-line img { max-height: 42px; }
  .sig-name { font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 26px; }
  .sig-caption { font-size: 10px; color: #666; margin-top: 4px; }
  .audit { margin-top: 28px; padding: 10px 12px; background: #f6f7f9; border: 1px solid #e2e4e9; font-size: 10px; color: #555; }
`;

function renderSignatureSlot(label, { signatureHtml = '', caption = '' } = {}) {
  return `
    <div class="sig-slot">
      <div class="sig-line">${signatureHtml}</div>
      <div class="sig-caption">${escapeHtml(label)}${caption ? ` — ${escapeHtml(caption)}` : ''}</div>
    </div>`;
}

function renderContractDocumentHtml(contract, settings, { client, project } = {}) {
  const signature = contract.signature || {};
  const signed = contract.status === 'signed' && signature.signedAt;
  const counter = contract.countersignature || {};
  const countersigned = !!counter.signedAt;

  let clientSignatureHtml = '';
  let clientCaption = 'Client signature';
  if (signed) {
    clientSignatureHtml = signature.method === 'drawn' && signature.imageData
      ? `<img src="${signature.imageData}" alt="Signature">`
      : `<span class="sig-name">${escapeHtml(signature.name)}</span>`;
    clientCaption = `Signed by ${signature.name} on ${new Date(signature.signedAt).toLocaleString('en-US')}`;
  }

  // Company slot: real countersignature when present, otherwise a blank line awaiting it
  const signerName = countersigned ? counter.name : (settings.contractSignerName || settings.companyName);
  const signerTitle = countersigned ? (counter.title || '') : (settings.contractSignerTitle || '');
  let companySignatureHtml = '';
  let companyCaption = `${signerName}${signerTitle ? `, ${signerTitle}` : ''} — ${settings.companyName}`;
  if (countersigned) {
    companySignatureHtml = counter.method === 'drawn' && counter.imageData
      ? `<img src="${counter.imageData}" alt="Countersignature">`
      : `<span class="sig-name">${escapeHtml(counter.name)}</span>`;
    companyCaption = `Signed by ${signerName}${signerTitle ? `, ${signerTitle}` : ''} — ${settings.companyName} on ${new Date(counter.signedAt).toLocaleString('en-US')}`;
  }

  const auditEntries = [];
  if (signed) {
    auditEntries.push(`
      Signed by: ${escapeHtml(signature.name)} (${signature.method === 'drawn' ? 'drawn signature' : 'typed signature'})<br>
      Date &amp; time: ${new Date(signature.signedAt).toISOString()}<br>
      IP address: ${escapeHtml(signature.ip || 'n/a')}<br>
      Document SHA-256: ${escapeHtml(signature.documentHash || 'n/a')}`);
  }
  if (countersigned) {
    auditEntries.push(`
      Countersigned by: ${escapeHtml(counter.name)}${counter.title ? `, ${escapeHtml(counter.title)}` : ''} (${counter.method === 'drawn' ? 'drawn signature' : 'typed signature'})<br>
      Date &amp; time: ${new Date(counter.signedAt).toISOString()}<br>
      IP address: ${escapeHtml(counter.ip || 'n/a')}<br>
      Document SHA-256: ${escapeHtml(counter.documentHash || 'n/a')}`);
  }
  const auditBlock = auditEntries.length > 0 ? `
    <div class="audit">
      <strong>Signature audit trail</strong><br>
      ${auditEntries.join('<br><br>')}
    </div>` : '';

  const uploadedNote = contract.source === 'uploaded'
    ? `<p class="muted">This signature certificate accompanies the uploaded contract document "${escapeHtml(contract.uploadedFile?.filename || 'contract.pdf')}".</p>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${DOC_BASE_CSS}</style></head>
<body>
  <div class="doc-header">
    <div>
      <h1>${escapeHtml(contract.title || 'Service Agreement')}</h1>
      <div class="muted">${escapeHtml(settings.companyName)}${project ? ` • ${escapeHtml(project.name)}` : ''}</div>
    </div>
    <div class="doc-meta">
      ${client ? `Prepared for ${escapeHtml(client.name)}${client.company ? ` (${escapeHtml(client.company)})` : ''}<br>` : ''}
      ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
    </div>
  </div>
  ${uploadedNote}
  ${contract.source === 'generated' ? contract.contentHtml : ''}
  <div class="sig-block">
    ${renderSignatureSlot(clientCaption, { signatureHtml: clientSignatureHtml })}
    ${renderSignatureSlot(companyCaption, { signatureHtml: companySignatureHtml })}
  </div>
  ${auditBlock}
</body></html>`;
}

function renderInvoiceDocumentHtml(invoice, settings, schedule = null) {
  const partyBlock = (label, party) => `
    <div>
      <h3>${escapeHtml(label)}</h3>
      ${party.name ? `<p style="margin:0"><strong>${escapeHtml(party.name)}</strong></p>` : ''}
      ${party.company ? `<p style="margin:0">${escapeHtml(party.company)}</p>` : ''}
      ${party.address ? `<p style="margin:0">${textToHtml(party.address)}</p>` : ''}
      ${party.email ? `<p style="margin:0">${escapeHtml(party.email)}</p>` : ''}
      ${party.phone ? `<p style="margin:0">${escapeHtml(party.phone)}</p>` : ''}
    </div>`;

  const hasDays = (invoice.lineItems || []).some((item) => item.day);
  let previousDay = null;
  const rows = (invoice.lineItems || []).map((item) => {
    const showDay = hasDays && item.day !== previousDay;
    previousDay = item.day;
    return `
    <tr>
      ${hasDays ? `<td style="white-space:nowrap">${showDay && item.day ? `<strong>${escapeHtml(item.day)}</strong>` : ''}</td>` : ''}
      <td>
        <strong>${escapeHtml(item.description)}</strong>
        ${item.detail ? `<br><span class="muted">${escapeHtml(item.detail)}</span>` : ''}
      </td>
      <td class="num">${item.quantity}</td>
      <td class="num">${formatMoney(item.unitPrice, invoice.currency)}</td>
      <td class="num">${formatMoney(item.amount, invoice.currency)}</td>
    </tr>`;
  }).join('');
  const itemsHead = `<tr>${hasDays ? '<th>Day</th>' : ''}<th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr>`;

  const statusLabel = invoice.status === 'paid' ? 'PAID' : (invoice.status === 'void' ? 'VOID' : '');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${DOC_BASE_CSS}
  .invoice-status { display: inline-block; padding: 3px 10px; border: 2px solid; font-weight: bold; font-size: 12px; letter-spacing: 0.1em; }
  .invoice-status.paid { color: #16794c; border-color: #16794c; }
  .invoice-status.void { color: #b3261e; border-color: #b3261e; }
  .parties { display: flex; gap: 60px; margin: 18px 0; }
</style></head>
<body>
  <div class="doc-header">
    <div>
      <h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1>
      ${invoice.subtitle ? `<div class="muted">${textToHtml(invoice.subtitle)}</div>` : ''}
    </div>
    <div class="doc-meta">
      ${statusLabel ? `<div class="invoice-status ${invoice.status}">${statusLabel}</div><br>` : ''}
      Issue date: ${formatDateLong(invoice.issueDate) || '—'}<br>
      Due date: ${formatDateLong(invoice.dueDate) || 'Upon receipt'}
    </div>
  </div>
  ${invoice.headerNote ? `<p>${textToHtml(invoice.headerNote)}</p>` : ''}
  <div class="parties">
    ${partyBlock('Bill To', invoice.to || {})}
    ${partyBlock('From', invoice.from || {})}
  </div>
  <table class="items">
    <thead>${itemsHead}</thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${formatMoney(invoice.subtotal, invoice.currency)}</span></div>
    ${invoice.discountAmount > 0 ? `<div class="row"><span>Discount</span><span>-${formatMoney(invoice.discountAmount, invoice.currency)}</span></div>` : ''}
    ${invoice.amountPaid > 0 && invoice.status !== 'paid' ? `<div class="row"><span>Paid</span><span>-${formatMoney(invoice.amountPaid, invoice.currency)}</span></div>` : ''}
    <div class="row grand"><span>${invoice.status === 'paid' ? 'Total (Paid)' : 'Amount Due'}</span><span>${formatMoney(invoice.status === 'paid' ? invoice.total : invoice.total - invoice.amountPaid, invoice.currency)}</span></div>
  </div>
  ${schedule && schedule.length ? `
  <h3 style="margin-top:28px">Payment Schedule</h3>
  <table class="items">
    <thead><tr><th>Payment</th><th>Due</th><th class="num">Amount</th><th>Status</th></tr></thead>
    <tbody>
      ${schedule.map((inst) => `
      <tr>
        <td><strong>${escapeHtml(inst.label)}</strong>${inst.percent != null ? ` <span class="muted">(${inst.percent}%)</span>` : ''}</td>
        <td>${escapeHtml(inst.dueLabel)}</td>
        <td class="num">${formatMoney(inst.amount, invoice.currency)}</td>
        <td>${inst.status === 'paid' ? '<span style="color:#16794c;font-weight:bold">Paid</span>' : 'Pending'}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}
  ${invoice.footerNote ? `<p style="margin-top:30px" class="muted">${textToHtml(invoice.footerNote)}</p>` : ''}
</body></html>`;
}

// ---------- Payment ----------

async function markInvoicePaid(invoice, { paymentIntentId = null } = {}) {
  if (invoice.status === 'paid') return invoice;
  invoice.status = 'paid';
  invoice.amountPaid = invoice.total;
  invoice.paidAt = new Date();
  if (paymentIntentId) invoice.stripePaymentIntentId = paymentIntentId;
  (invoice.paymentPlan?.installments || []).forEach((inst) => {
    if (inst.status !== 'paid') {
      inst.status = 'paid';
      inst.paidAt = invoice.paidAt;
    }
  });
  await invoice.save();
  await advanceProjectStatus(invoice.project, 'paid');
  return invoice;
}

// ---------- Payment plans ----------

const INSTALLMENT_ANCHOR_LABELS = {
  project_start: 'project start',
  project_end: 'project end',
  contract_signed: 'contract signing',
  issue_date: 'invoice issue date'
};

function hasPaymentPlan(invoice) {
  return !!(invoice.paymentPlan?.enabled && (invoice.paymentPlan.installments || []).length > 0);
}

/**
 * Sanitizes a plan from the editor and snapshots dollar amounts from percents.
 * The last installment absorbs rounding so amounts always sum to the total.
 */
function normalizePaymentPlan(rawPlan, total) {
  const enabled = !!rawPlan?.enabled;
  const rawInstallments = Array.isArray(rawPlan?.installments) ? rawPlan.installments : [];
  if (!enabled || rawInstallments.length === 0) return { enabled: false, installments: [] };

  const percents = rawInstallments.map((inst) => Math.max(0, Number(inst.percent) || 0));
  const percentSum = percents.reduce((sum, p) => sum + p, 0);
  if (Math.abs(percentSum - 100) > 0.01) {
    throw new Error(`Installment percentages must add up to 100% (currently ${Math.round(percentSum * 100) / 100}%)`);
  }

  let allocated = 0;
  const installments = rawInstallments.map((inst, i) => {
    const isLast = i === rawInstallments.length - 1;
    const amount = isLast
      ? Math.round((total - allocated) * 100) / 100
      : Math.round(total * (percents[i] / 100) * 100) / 100;
    allocated = Math.round((allocated + amount) * 100) / 100;

    const dueType = ['immediate', 'fixed', 'relative'].includes(inst.dueType) ? inst.dueType : 'immediate';
    return {
      label: String(inst.label || `Payment ${i + 1}`).slice(0, 120),
      percent: percents[i],
      amount,
      dueType,
      dueDate: dueType === 'fixed' ? (inst.dueDate || null) : null,
      anchor: Object.keys(INSTALLMENT_ANCHOR_LABELS).includes(inst.anchor) ? inst.anchor : 'project_start',
      offsetDays: dueType === 'relative' ? (Number(inst.offsetDays) || 0) : 0,
      status: 'pending',
      paidAt: null,
      stripeSessionId: null,
      stripePaymentIntentId: null
    };
  });

  return { enabled: true, installments };
}

function addDaysYmd(ymd, days) {
  const date = parseYmd(ymd);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Resolves when an installment is due, given project/contract context. Returns { date, label }. */
function resolveInstallmentDue(installment, { project, contract, invoice }) {
  if (installment.dueType === 'immediate') {
    return { date: null, label: 'Due immediately' };
  }
  if (installment.dueType === 'fixed') {
    const label = formatDateLong(installment.dueDate);
    return { date: installment.dueDate, label: label ? `Due ${label}` : 'Due date TBD' };
  }

  // relative
  let anchorDate = null;
  if (installment.anchor === 'project_start') anchorDate = project?.startDate || null;
  if (installment.anchor === 'project_end') anchorDate = project?.endDate || null;
  if (installment.anchor === 'issue_date') anchorDate = invoice?.issueDate || null;
  if (installment.anchor === 'contract_signed' && contract?.signature?.signedAt) {
    const signed = new Date(contract.signature.signedAt);
    const pad = (n) => String(n).padStart(2, '0');
    anchorDate = `${signed.getFullYear()}-${pad(signed.getMonth() + 1)}-${pad(signed.getDate())}`;
  }

  const offset = installment.offsetDays || 0;
  const anchorLabel = INSTALLMENT_ANCHOR_LABELS[installment.anchor] || installment.anchor;
  let when;
  if (offset === 0) when = `on ${anchorLabel}`;
  else if (offset < 0) when = `${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} before ${anchorLabel}`;
  else when = `${offset} day${offset === 1 ? '' : 's'} after ${anchorLabel}`;

  const resolved = anchorDate ? addDaysYmd(anchorDate, offset) : null;
  const dateLabel = resolved ? ` (${formatDateLong(resolved)})` : '';
  return { date: resolved, label: `Due ${when}${dateLabel}` };
}

/** Installment schedule with resolved due labels, for the public page, editor, and PDF. */
async function buildInstallmentSchedule(invoice) {
  if (!hasPaymentPlan(invoice)) return null;
  const [project, contract] = await Promise.all([
    Project.findById(invoice.project),
    Contract.findOne({ project: invoice.project }).sort({ createdAt: -1 })
  ]);
  return invoice.paymentPlan.installments.map((inst, i) => {
    const due = resolveInstallmentDue(inst, { project, contract, invoice });
    return {
      index: i,
      label: inst.label || `Payment ${i + 1}`,
      percent: inst.percent,
      amount: inst.amount,
      status: inst.status,
      paidAt: inst.paidAt,
      dueDate: due.date,
      dueLabel: due.label
    };
  });
}

/** Applies a completed Stripe Checkout session to the right target (installment or full invoice). */
async function settleStripeSession(invoice, session) {
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  const idx = session.metadata?.installmentIndex;
  if (idx !== undefined && idx !== null && idx !== '') {
    return markInstallmentPaid(invoice, Number(idx), { paymentIntentId });
  }
  return markInvoicePaid(invoice, { paymentIntentId });
}

/** Marks one installment paid; marks the whole invoice paid once every installment is. */
async function markInstallmentPaid(invoice, index, { paymentIntentId = null } = {}) {
  const installments = invoice.paymentPlan?.installments || [];
  const inst = installments[index];
  if (!inst || inst.status === 'paid') return invoice;

  inst.status = 'paid';
  inst.paidAt = new Date();
  if (paymentIntentId) inst.stripePaymentIntentId = paymentIntentId;

  const paidTotal = installments
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + (i.amount || 0), 0);
  invoice.amountPaid = Math.min(invoice.total, Math.round(paidTotal * 100) / 100);

  if (installments.every((i) => i.status === 'paid')) {
    return markInvoicePaid(invoice, { paymentIntentId });
  }
  await invoice.save();
  return invoice;
}

// ---------- Registration ----------

module.exports = function registerCrmRoutes(app, ctx) {
  const { requireAuth, requireApiAuth, SavedQuote, Service } = ctx;

  // ----- Pages -----

  const publicDir = path.join(__dirname, '..', 'public');

  app.get('/projects', requireAuth, (req, res) => {
    res.sendFile(path.join(publicDir, 'projects.html'));
  });

  app.get('/projects/:id', requireAuth, (req, res) => {
    res.sendFile(path.join(publicDir, 'project.html'));
  });

  app.get('/clients', requireAuth, (req, res) => {
    res.sendFile(path.join(publicDir, 'clients.html'));
  });

  // Public (token-protected data; pages themselves are static shells)
  app.get('/sign/:token', (req, res) => {
    res.sendFile(path.join(publicDir, 'sign.html'));
  });

  app.get('/invoice/:token', (req, res) => {
    res.sendFile(path.join(publicDir, 'invoice-view.html'));
  });

  // ----- Clients -----

  app.get('/api/crm/clients', requireApiAuth, async (req, res) => {
    try {
      const { search } = req.query;
      const query = search ? { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {};
      const clients = await Client.find(query).sort({ name: 1 }).limit(200);
      res.json(clients);
    } catch (error) {
      console.error('Error fetching clients:', error);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  });

  app.post('/api/crm/clients', requireApiAuth, async (req, res) => {
    try {
      const { name, email, phone, company, address, notes } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Client name is required' });
      }
      const client = await Client.create({
        name: name.trim(),
        email: email || '',
        phone: phone || '',
        company: company || '',
        address: address || {},
        notes: notes || ''
      });
      res.status(201).json(client);
    } catch (error) {
      console.error('Error creating client:', error);
      res.status(500).json({ error: 'Failed to create client' });
    }
  });

  app.put('/api/crm/clients/:id', requireApiAuth, async (req, res) => {
    try {
      const { name, email, phone, company, address, notes } = req.body;
      const update = {};
      if (name !== undefined) update.name = name.trim();
      if (email !== undefined) update.email = email;
      if (phone !== undefined) update.phone = phone;
      if (company !== undefined) update.company = company;
      if (address !== undefined) update.address = address;
      if (notes !== undefined) update.notes = notes;

      const client = await Client.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!client) return res.status(404).json({ error: 'Client not found' });
      res.json(client);
    } catch (error) {
      console.error('Error updating client:', error);
      res.status(500).json({ error: 'Failed to update client' });
    }
  });

  // ----- Projects -----

  async function attachProjectSummaries(projects) {
    const ids = projects.map((p) => p._id);
    const [quotes, contracts, invoices] = await Promise.all([
      SavedQuote.find({ project: { $in: ids } }, { name: 1, project: 1, booked: 1, 'quoteData.total': 1 }),
      Contract.find({ project: { $in: ids } }, { project: 1, status: 1 }),
      Invoice.find({ project: { $in: ids } }, { project: 1, status: 1, total: 1, amountPaid: 1 })
    ]);

    const byProject = (docs) => {
      const map = new Map();
      docs.forEach((doc) => {
        const key = String(doc.project);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(doc);
      });
      return map;
    };

    const quoteMap = byProject(quotes);
    const contractMap = byProject(contracts);
    const invoiceMap = byProject(invoices);

    return projects.map((project) => {
      const obj = project.toObject();
      const key = String(project._id);
      const projectQuotes = quoteMap.get(key) || [];
      const projectContracts = contractMap.get(key) || [];
      const projectInvoices = invoiceMap.get(key) || [];

      obj.quoteCount = projectQuotes.length;
      obj.quoteTotal = projectQuotes.reduce((sum, q) => sum + (q.quoteData?.total || 0), 0);
      obj.contractStatus = projectContracts.length > 0
        ? projectContracts.reduce((best, c) => advanceContractStatus(best, c.status), 'none')
        : 'none';
      const billableInvoices = projectInvoices.filter((i) => i.status !== 'void');
      obj.invoiceSummary = {
        count: projectInvoices.length,
        paid: projectInvoices.filter((i) => i.status === 'paid').length,
        outstanding: projectInvoices.filter((i) => i.status === 'sent').length,
        totalInvoiced: billableInvoices.reduce((sum, i) => sum + (i.total || 0), 0),
        totalPaid: billableInvoices.reduce((sum, i) => sum + (i.amountPaid || 0), 0)
      };
      return obj;
    });
  }

  function advanceContractStatus(a, b) {
    const order = { none: 0, draft: 1, sent: 2, signed: 3 };
    return (order[b] ?? 0) > (order[a] ?? 0) ? b : a;
  }

  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Past = last project day before today. Upcoming = last day today/future, or undated.
  function projectWhenClause(when) {
    if (when !== 'past' && when !== 'upcoming') return null;
    const today = todayYmd();
    // Prefer endDate, else startDate; treat '' like missing
    const lastDay = {
      $cond: [
        { $and: [{ $ne: ['$endDate', null] }, { $ne: ['$endDate', ''] }] },
        '$endDate',
        {
          $cond: [
            { $and: [{ $ne: ['$startDate', null] }, { $ne: ['$startDate', ''] }] },
            '$startDate',
            null
          ]
        }
      ]
    };
    if (when === 'past') {
      return {
        $expr: {
          $and: [
            { $ne: [lastDay, null] },
            { $lt: [lastDay, today] }
          ]
        }
      };
    }
    return {
      $expr: {
        $or: [
          { $eq: [lastDay, null] },
          { $gte: [lastDay, today] }
        ]
      }
    };
  }

  function projectMatchesWhen(project, when) {
    if (when !== 'past' && when !== 'upcoming') return true;
    const today = todayYmd();
    const lastDay = project.endDate || project.startDate || null;
    if (when === 'past') return !!(lastDay && lastDay < today);
    return !lastDay || lastDay >= today;
  }

  app.get('/api/projects', requireApiAuth, async (req, res) => {
    try {
      const { search, status, archived, date, when } = req.query;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      const query = {};
      if (archived === 'true') {
        query.archived = true;
      } else {
        query.archived = { $ne: true };
      }
      if (status) query.status = status;
      const whenClause = projectWhenClause(when);
      if (whenClause) {
        query.$and = (query.$and || []).concat([whenClause]);
      }
      // Match projects that start/end on this day, or whose date range includes it
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        query.$and = (query.$and || []).concat([{
          $or: [
            { startDate: date },
            { endDate: date },
            { startDate: { $lte: date }, endDate: { $gte: date } }
          ]
        }]);
      }
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const matchingClients = await Client.find({ $or: [{ name: regex }, { company: regex }] }, { _id: 1 });
        const searchClause = {
          $or: [
            { name: regex },
            { client: { $in: matchingClients.map((c) => c._id) } }
          ]
        };
        query.$and = (query.$and || []).concat([searchClause]);
      }

      const total = await Project.countDocuments(query);
      const SORTABLE = ['name', 'client', 'dates', 'status', 'contract', 'invoices'];
      const sortBy = SORTABLE.includes(req.query.sortBy) ? req.query.sortBy : null;
      const sortDir = req.query.sortDir === 'asc' ? 1 : -1;
      const statusRank = {
        lead: 0, quoted: 1, booked: 2, contract_signed: 3, invoiced: 4, paid: 5, complete: 6
      };
      const contractRank = { none: 0, draft: 1, sent: 2, signed: 3 };

      async function hydrateProjectsInOrder(ids) {
        const found = await Project.find({ _id: { $in: ids } })
          .populate('client')
          .populate('createdBy', 'name');
        const byId = new Map(found.map((p) => [String(p._id), p]));
        return ids.map((id) => byId.get(String(id))).filter(Boolean);
      }

      let withSummaries;
      if (sortBy === 'contract' || sortBy === 'invoices' || sortBy === 'status') {
        // Computed / pipeline fields — summarize all matches, then sort + paginate
        const all = await Project.find(query)
          .populate('client')
          .populate('createdBy', 'name');
        withSummaries = await attachProjectSummaries(all);
        withSummaries.sort((a, b) => {
          let cmp = 0;
          if (sortBy === 'status') {
            cmp = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
          } else if (sortBy === 'contract') {
            cmp = (contractRank[a.contractStatus] ?? 0) - (contractRank[b.contractStatus] ?? 0);
          } else {
            const aInv = a.invoiceSummary?.totalInvoiced || 0;
            const bInv = b.invoiceSummary?.totalInvoiced || 0;
            const aPct = aInv > 0 ? (a.invoiceSummary.totalPaid || 0) / aInv : -1;
            const bPct = bInv > 0 ? (b.invoiceSummary.totalPaid || 0) / bInv : -1;
            cmp = aPct - bPct || aInv - bInv;
          }
          if (cmp !== 0) return cmp * sortDir;
          return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
        withSummaries = withSummaries.slice((page - 1) * limit, page * limit);
      } else if (sortBy === 'client') {
        const sortedIds = await Project.aggregate([
          { $match: query },
          {
            $lookup: {
              from: 'crmClients',
              localField: 'client',
              foreignField: '_id',
              as: 'clientDoc'
            }
          },
          {
            $addFields: {
              _clientName: {
                $toLower: { $ifNull: [{ $arrayElemAt: ['$clientDoc.name', 0] }, ''] }
              }
            }
          },
          { $sort: { _clientName: sortDir, updatedAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { _id: 1 } }
        ]);
        const projects = await hydrateProjectsInOrder(sortedIds.map((d) => d._id));
        withSummaries = await attachProjectSummaries(projects);
      } else {
        const sort = sortBy === 'name'
          ? { name: sortDir, updatedAt: -1 }
          : sortBy === 'dates'
            ? { startDate: sortDir, endDate: sortDir, updatedAt: -1 }
            : { updatedAt: -1 };
        let findQuery = Project.find(query)
          .populate('client')
          .populate('createdBy', 'name')
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit);
        if (sortBy === 'name') {
          findQuery = findQuery.collation({ locale: 'en', strength: 2 });
        }
        withSummaries = await attachProjectSummaries(await findQuery);
      }

      res.json({
        projects: withSummaries,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  });

  // ----- Clients -----

  app.get('/api/clients', requireApiAuth, async (req, res) => {
    try {
      const { search } = req.query;
      const query = {};
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ name: regex }, { company: regex }, { email: regex }];
      }

      const clients = await Client.find(query).sort({ name: 1 });
      const projects = await Project.find({
        client: { $in: clients.map((c) => c._id) },
        archived: { $ne: true }
      }).sort({ startDate: -1, updatedAt: -1 });

      const withSummaries = await attachProjectSummaries(projects);
      const projectsByClient = new Map();
      withSummaries.forEach((p) => {
        const key = String(p.client);
        if (!projectsByClient.has(key)) projectsByClient.set(key, []);
        projectsByClient.get(key).push({
          _id: p._id,
          name: p.name,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          quoteCount: p.quoteCount,
          quoteTotal: p.quoteTotal,
          invoiceSummary: p.invoiceSummary
        });
      });

      res.json({
        clients: clients.map((c) => {
          const clientProjects = projectsByClient.get(String(c._id)) || [];
          return {
            ...c.toObject(),
            projects: clientProjects,
            projectCount: clientProjects.length,
            totalValue: clientProjects.reduce((sum, p) => sum + (p.quoteTotal || 0), 0)
          };
        })
      });
    } catch (error) {
      console.error('Error fetching clients:', error);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  });

  async function resolveClientFromPayload(payload) {
    if (!payload) return null;
    if (payload.clientId) {
      return Client.findById(payload.clientId);
    }
    if (payload.client && payload.client.name && payload.client.name.trim()) {
      const c = payload.client;
      const trimmedName = c.name.trim();
      const escaped = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await Client.findOne({ name: new RegExp(`^${escaped}$`, 'i') });
      if (existing) {
        // Fill in any newly provided details without overwriting existing ones
        let changed = false;
        ['email', 'phone', 'company'].forEach((field) => {
          if (c[field] && !existing[field]) {
            existing[field] = c[field];
            changed = true;
          }
        });
        if (changed) await existing.save();
        return existing;
      }
      return Client.create({
        name: trimmedName,
        email: c.email || '',
        phone: c.phone || '',
        company: c.company || '',
        address: c.address || {}
      });
    }
    return null;
  }

  app.post('/api/projects', requireApiAuth, async (req, res) => {
    try {
      const { name, status, startDate, endDate, notes } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Project name is required' });
      }
      const client = await resolveClientFromPayload(req.body);
      const userRecord = await ctx.getOrCreateUserRecord(req.user.name || req.user.fullName);

      const project = await Project.create({
        name: name.trim(),
        client: client ? client._id : null,
        status: PROJECT_STATUSES.includes(status) ? status : 'lead',
        startDate: startDate || null,
        endDate: endDate || null,
        notes: notes || '',
        createdBy: userRecord?._id || null
      });

      const populated = await Project.findById(project._id).populate('client');
      res.status(201).json(populated);
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(500).json({ error: 'Failed to create project' });
    }
  });

  app.get('/api/projects/:id', requireApiAuth, async (req, res) => {
    try {
      const project = await Project.findById(req.params.id)
        .populate('client')
        .populate('createdBy', 'name');
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const [quotes, contract, invoices] = await Promise.all([
        SavedQuote.find({ project: project._id }, {
          name: 1, clientName: 1, location: 1, booked: 1, archived: 1,
          createdAt: 1, updatedAt: 1, 'quoteData.total': 1, 'quoteData.days': 1, 'quoteData.quoteTitle': 1
        }).sort({ updatedAt: -1 }),
        Contract.findOne({ project: project._id }).sort({ createdAt: -1 }),
        Invoice.find({ project: project._id }).sort({ createdAt: -1 })
      ]);

      res.json({ project, quotes, contract, invoices });
    } catch (error) {
      console.error('Error fetching project:', error);
      res.status(500).json({ error: 'Failed to fetch project' });
    }
  });

  app.put('/api/projects/:id', requireApiAuth, async (req, res) => {
    try {
      const { name, status, startDate, endDate, notes, clientId } = req.body;
      const update = {};
      if (name !== undefined) update.name = name.trim();
      if (status !== undefined && PROJECT_STATUSES.includes(status)) update.status = status;
      if (startDate !== undefined) update.startDate = startDate || null;
      if (endDate !== undefined) update.endDate = endDate || null;
      if (notes !== undefined) update.notes = notes;
      if (clientId !== undefined) update.client = clientId || null;

      const project = await Project.findByIdAndUpdate(req.params.id, update, { new: true }).populate('client');
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json(project);
    } catch (error) {
      console.error('Error updating project:', error);
      res.status(500).json({ error: 'Failed to update project' });
    }
  });

  app.post('/api/projects/:id/archive', requireApiAuth, async (req, res) => {
    try {
      const { archived } = req.body;
      const project = await Project.findByIdAndUpdate(req.params.id, { archived: !!archived }, { new: true });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json({ success: true, archived: project.archived });
    } catch (error) {
      console.error('Error archiving project:', error);
      res.status(500).json({ error: 'Failed to archive project' });
    }
  });

  app.delete('/api/projects/:id', requireApiAuth, async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      await Promise.all([
        SavedQuote.updateMany({ project: project._id }, { $set: { project: null } }),
        Contract.deleteMany({ project: project._id }),
        Invoice.deleteMany({ project: project._id, status: 'draft' })
      ]);
      const remainingInvoices = await Invoice.countDocuments({ project: project._id });
      if (remainingInvoices > 0) {
        return res.status(400).json({ error: 'Project has sent or paid invoices. Void them first.' });
      }
      await Project.findByIdAndDelete(project._id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting project:', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  app.post('/api/projects/:id/link-quote', requireApiAuth, async (req, res) => {
    try {
      const { quoteName } = req.body;
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const quote = await SavedQuote.findOne({ name: quoteName });
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      quote.project = project._id;
      await quote.save();
      await advanceProjectStatus(project._id, quote.booked ? 'booked' : 'quoted');

      // Fill in project dates from the quote if missing
      if (!project.startDate) {
        const { startDate, endDate } = quoteDateRange(quote.quoteData);
        if (startDate) {
          project.startDate = startDate;
          project.endDate = endDate;
          await project.save();
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error linking quote:', error);
      res.status(500).json({ error: 'Failed to link quote' });
    }
  });

  app.post('/api/projects/:id/unlink-quote', requireApiAuth, async (req, res) => {
    try {
      const { quoteName } = req.body;
      const quote = await SavedQuote.findOne({ name: quoteName, project: req.params.id });
      if (!quote) return res.status(404).json({ error: 'Quote not found in this project' });
      quote.project = null;
      await quote.save();
      res.json({ success: true });
    } catch (error) {
      console.error('Error unlinking quote:', error);
      res.status(500).json({ error: 'Failed to unlink quote' });
    }
  });

  // ----- Contract templates (admin manages, all users can read) -----

  app.get('/api/contract-templates', requireApiAuth, async (req, res) => {
    try {
      const templates = await ContractTemplate.find()
        .populate('services', 'name')
        .sort({ sortOrder: 1, createdAt: 1 });
      res.json(templates);
    } catch (error) {
      console.error('Error fetching contract templates:', error);
      res.status(500).json({ error: 'Failed to fetch contract templates' });
    }
  });

  app.post('/api/contract-templates', requireApiAuth, async (req, res) => {
    try {
      const { name, body, services, categories, alwaysInclude, sortOrder } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Template name is required' });
      }
      const template = await ContractTemplate.create({
        name: name.trim(),
        body: body || '',
        services: services || [],
        categories: categories || [],
        alwaysInclude: !!alwaysInclude,
        sortOrder: sortOrder || 0
      });
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating contract template:', error);
      res.status(500).json({ error: 'Failed to create contract template' });
    }
  });

  app.put('/api/contract-templates/:id', requireApiAuth, async (req, res) => {
    try {
      const { name, body, services, categories, alwaysInclude, sortOrder } = req.body;
      const update = {};
      if (name !== undefined) update.name = name.trim();
      if (body !== undefined) update.body = body;
      if (services !== undefined) update.services = services;
      if (categories !== undefined) update.categories = categories;
      if (alwaysInclude !== undefined) update.alwaysInclude = !!alwaysInclude;
      if (sortOrder !== undefined) update.sortOrder = sortOrder;

      const template = await ContractTemplate.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!template) return res.status(404).json({ error: 'Template not found' });
      res.json(template);
    } catch (error) {
      console.error('Error updating contract template:', error);
      res.status(500).json({ error: 'Failed to update contract template' });
    }
  });

  app.delete('/api/contract-templates/:id', requireApiAuth, async (req, res) => {
    try {
      const template = await ContractTemplate.findByIdAndDelete(req.params.id);
      if (!template) return res.status(404).json({ error: 'Template not found' });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting contract template:', error);
      res.status(500).json({ error: 'Failed to delete contract template' });
    }
  });

  // ----- Company settings -----

  app.get('/api/company-settings', requireApiAuth, async (req, res) => {
    try {
      res.json(await getCompanySettings());
    } catch (error) {
      console.error('Error fetching company settings:', error);
      res.status(500).json({ error: 'Failed to fetch company settings' });
    }
  });

  app.put('/api/company-settings', requireApiAuth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const settings = await getCompanySettings();
      const fields = ['companyName', 'email', 'phone', 'website', 'address', 'logoUrl',
        'contractSignerName', 'contractSignerTitle', 'invoiceFooterDefault',
        'cardFeeEnabled', 'cardFeePercent', 'achEnabled'];
      fields.forEach((field) => {
        if (req.body[field] !== undefined) settings[field] = req.body[field];
      });
      settings.cardFeePercent = Math.min(10, Math.max(0, Number(settings.cardFeePercent) || 0));
      await settings.save();
      res.json(settings);
    } catch (error) {
      console.error('Error updating company settings:', error);
      res.status(500).json({ error: 'Failed to update company settings' });
    }
  });

  // ----- Contracts -----

  app.post('/api/projects/:id/contract/generate', requireApiAuth, async (req, res) => {
    try {
      const { quoteName } = req.body;
      const project = await Project.findById(req.params.id).populate('client');
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const quote = await SavedQuote.findOne({ name: quoteName });
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      const settings = await getCompanySettings();
      const { contentHtml, investment } = await assembleContractHtml({
        quote,
        project,
        client: project.client,
        settings,
        ServiceModel: Service
      });

      const userRecord = await ctx.getOrCreateUserRecord(req.user.name || req.user.fullName);

      let contract = await Contract.findOne({ project: project._id });
      if (contract && contract.status === 'signed') {
        return res.status(400).json({ error: 'This project already has a signed contract' });
      }
      if (contract) {
        contract.source = 'generated';
        contract.sourceQuote = quote._id;
        contract.contentHtml = contentHtml;
        contract.investment = investment;
        contract.status = 'draft';
        contract.publicToken = null;
        contract.sentAt = null;
        contract.uploadedFile = {};
        await contract.save();
      } else {
        contract = await Contract.create({
          project: project._id,
          sourceQuote: quote._id,
          source: 'generated',
          title: `${project.name} — Service Agreement`,
          contentHtml,
          investment,
          createdBy: userRecord?._id || null
        });
      }

      res.json(contract);
    } catch (error) {
      console.error('Error generating contract:', error);
      res.status(500).json({ error: 'Failed to generate contract' });
    }
  });

  app.put('/api/contracts/:id', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      if (contract.status === 'signed') {
        return res.status(400).json({ error: 'Signed contracts cannot be edited' });
      }
      const { title, contentHtml, investment } = req.body;
      if (title !== undefined) contract.title = title;
      if (contentHtml !== undefined) contract.contentHtml = contentHtml;
      if (investment !== undefined) contract.investment = Number(investment) || 0;
      await contract.save();
      res.json(contract);
    } catch (error) {
      console.error('Error updating contract:', error);
      res.status(500).json({ error: 'Failed to update contract' });
    }
  });

  app.post('/api/projects/:id/contract/upload', requireApiAuth, async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const { fileData, filename } = req.body;
      const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(fileData || '');
      if (!match) {
        return res.status(400).json({ error: 'A PDF file is required' });
      }
      const buffer = Buffer.from(match[1], 'base64');
      if (buffer.length > CONTRACT_UPLOAD_MAX_BYTES) {
        return res.status(400).json({ error: 'Contract PDF must be 15 MB or smaller' });
      }

      let existing = await Contract.findOne({ project: project._id });
      if (existing && existing.status === 'signed') {
        return res.status(400).json({ error: 'This project already has a signed contract' });
      }

      fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });
      const safeName = `contract-${project._id}-${Date.now()}.pdf`;
      const localPath = path.join(CONTRACT_UPLOAD_DIR, safeName);
      await fs.promises.writeFile(localPath, buffer);

      const userRecord = await ctx.getOrCreateUserRecord(req.user.name || req.user.fullName);
      const uploadedFile = {
        url: null,
        publicId: null,
        filename: filename || safeName,
        localPath: path.relative(path.join(__dirname, '..'), localPath),
        mimeType: 'application/pdf'
      };

      if (existing) {
        existing.source = 'uploaded';
        existing.uploadedFile = uploadedFile;
        existing.contentHtml = '';
        existing.status = 'draft';
        existing.publicToken = null;
        existing.sentAt = null;
        await existing.save();
        return res.json(existing);
      }

      const contract = await Contract.create({
        project: project._id,
        source: 'uploaded',
        title: `${project.name} — Contract`,
        uploadedFile,
        createdBy: userRecord?._id || null
      });
      res.json(contract);
    } catch (error) {
      console.error('Error uploading contract:', error);
      res.status(500).json({ error: 'Failed to upload contract' });
    }
  });

  app.post('/api/contracts/:id/send', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      if (contract.status === 'signed') {
        return res.status(400).json({ error: 'Contract is already signed' });
      }
      if (!contract.publicToken) {
        contract.publicToken = generatePublicToken();
      }
      contract.status = 'sent';
      contract.sentAt = new Date();
      await contract.save();

      const link = `${getBaseUrl(req)}/sign/${contract.publicToken}`;
      res.json({ success: true, link, contract });
    } catch (error) {
      console.error('Error sending contract:', error);
      res.status(500).json({ error: 'Failed to send contract' });
    }
  });

  // Countersign on behalf of the company — allowed at any stage, before or after the client signs
  app.post('/api/contracts/:id/countersign', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      if (contract.countersignature?.signedAt) {
        return res.status(400).json({ error: 'This contract has already been countersigned' });
      }

      let payload;
      try {
        payload = buildSignaturePayload(req);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      contract.countersignature = {
        ...payload,
        documentHash: await contractDocumentHash(contract)
      };
      await contract.save();

      res.json({ success: true, countersignature: contract.countersignature });
    } catch (error) {
      console.error('Error countersigning contract:', error);
      res.status(500).json({ error: 'Failed to record countersignature' });
    }
  });

  app.delete('/api/contracts/:id', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      if (contract.status === 'signed') {
        return res.status(400).json({ error: 'Signed contracts cannot be deleted' });
      }
      if (contract.uploadedFile?.localPath) {
        await fs.promises.unlink(path.join(__dirname, '..', contract.uploadedFile.localPath)).catch(() => {});
      }
      await Contract.findByIdAndDelete(contract._id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting contract:', error);
      res.status(500).json({ error: 'Failed to delete contract' });
    }
  });

  app.get('/api/contracts/:id/file', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract || !contract.uploadedFile?.localPath) {
        return res.status(404).json({ error: 'File not found' });
      }
      res.sendFile(path.join(__dirname, '..', contract.uploadedFile.localPath));
    } catch (error) {
      res.status(500).json({ error: 'Failed to load file' });
    }
  });

  async function contractPdfResponse(contract, res) {
    const [settings, project] = await Promise.all([
      getCompanySettings(),
      Project.findById(contract.project).populate('client')
    ]);
    const html = renderContractDocumentHtml(contract, settings, {
      client: project?.client,
      project
    });
    const pdf = await generatePdfFromHtml(html, { format: 'Letter' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(contract.title || 'contract').replace(/[^a-z0-9 \-_]/gi, '')}.pdf"`);
    res.send(pdf);
  }

  app.get('/api/contracts/:id/pdf', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      await contractPdfResponse(contract, res);
    } catch (error) {
      console.error('Error generating contract PDF:', error);
      res.status(500).json({ error: 'Failed to generate contract PDF' });
    }
  });

  // ----- Public contract signing -----

  async function findPublicContract(token) {
    if (!token || token.length < 24) return null;
    return Contract.findOne({ publicToken: token, status: { $in: ['sent', 'signed'] } });
  }

  async function contractDocumentHash(contract) {
    let hashSource = contract.contentHtml || '';
    if (contract.source === 'uploaded' && contract.uploadedFile?.localPath) {
      try {
        hashSource = await fs.promises.readFile(path.join(__dirname, '..', contract.uploadedFile.localPath));
      } catch {
        // fall back to empty content hash source
      }
    }
    return crypto.createHash('sha256').update(hashSource).digest('hex');
  }

  function buildSignaturePayload(req) {
    const { name, title, method, imageData } = req.body;
    if (!name || !name.trim()) {
      throw new Error('Please enter your full legal name');
    }
    if (method === 'drawn' && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imageData || '')) {
      throw new Error('Signature image is invalid');
    }
    return {
      name: name.trim(),
      title: (title || '').trim(),
      method: method === 'drawn' ? 'drawn' : 'typed',
      imageData: method === 'drawn' ? imageData : null,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      signedAt: new Date()
    };
  }

  app.get('/api/public/contracts/:token', async (req, res) => {
    try {
      const contract = await findPublicContract(req.params.token);
      if (!contract) return res.status(404).json({ error: 'Contract not found or no longer available' });

      const [settings, project] = await Promise.all([
        getCompanySettings(),
        Project.findById(contract.project).populate('client')
      ]);

      res.json({
        title: contract.title,
        source: contract.source,
        contentHtml: contract.source === 'generated' ? contract.contentHtml : null,
        hasFile: !!contract.uploadedFile?.localPath,
        filename: contract.uploadedFile?.filename || null,
        status: contract.status,
        investment: contract.investment,
        companyName: settings.companyName,
        clientName: project?.client?.name || '',
        projectName: project?.name || '',
        projectDates: formatDateRange(project?.startDate, project?.endDate),
        signedAt: contract.signature?.signedAt || null,
        signedBy: contract.signature?.name || null,
        clientSignature: contract.signature?.signedAt ? {
          name: contract.signature.name,
          method: contract.signature.method,
          imageData: contract.signature.method === 'drawn' ? contract.signature.imageData : null,
          signedAt: contract.signature.signedAt
        } : null,
        countersignature: contract.countersignature?.signedAt ? {
          name: contract.countersignature.name,
          title: contract.countersignature.title || '',
          method: contract.countersignature.method,
          imageData: contract.countersignature.method === 'drawn' ? contract.countersignature.imageData : null,
          signedAt: contract.countersignature.signedAt
        } : null,
        companySigner: {
          name: settings.contractSignerName || settings.companyName,
          title: settings.contractSignerTitle || ''
        }
      });
    } catch (error) {
      console.error('Error loading public contract:', error);
      res.status(500).json({ error: 'Failed to load contract' });
    }
  });

  app.get('/api/public/contracts/:token/file', async (req, res) => {
    try {
      const contract = await findPublicContract(req.params.token);
      if (!contract || !contract.uploadedFile?.localPath) {
        return res.status(404).json({ error: 'File not found' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.sendFile(path.join(__dirname, '..', contract.uploadedFile.localPath));
    } catch (error) {
      res.status(500).json({ error: 'Failed to load file' });
    }
  });

  app.post('/api/public/contracts/:token/sign', async (req, res) => {
    try {
      const contract = await findPublicContract(req.params.token);
      if (!contract) return res.status(404).json({ error: 'Contract not found or no longer available' });
      if (contract.status === 'signed') {
        return res.status(400).json({ error: 'This contract has already been signed' });
      }

      let payload;
      try {
        payload = buildSignaturePayload(req);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      contract.signature = {
        ...payload,
        documentHash: await contractDocumentHash(contract)
      };
      contract.status = 'signed';
      await contract.save();
      await advanceProjectStatus(contract.project, 'contract_signed');

      res.json({ success: true, signedAt: contract.signature.signedAt });
    } catch (error) {
      console.error('Error signing contract:', error);
      res.status(500).json({ error: 'Failed to record signature' });
    }
  });

  app.get('/api/public/contracts/:token/pdf', async (req, res) => {
    try {
      const contract = await findPublicContract(req.params.token);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      await contractPdfResponse(contract, res);
    } catch (error) {
      console.error('Error generating public contract PDF:', error);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  // ----- Invoices -----

  async function createInvoiceFromQuote({ project, quote, user }) {
    const settings = await getCompanySettings();
    const client = project.client ? await Client.findById(project.client) : null;
    const userRecord = await ctx.getOrCreateUserRecord(user.name || user.fullName);

    let conversion = { lineItems: [], subtotal: 0, discountAmount: 0, total: 0 };
    if (quote) {
      // Descriptions live in the service catalog when the quote didn't snapshot them
      const serviceIds = new Set();
      (quote.quoteData?.days || []).forEach((day) => (day.services || []).forEach((s) => {
        if (s.id) serviceIds.add(String(s.id));
      }));
      const serviceCatalog = new Map();
      if (serviceIds.size > 0) {
        const catalogServices = await Service.find({ _id: { $in: [...serviceIds] } }, { description: 1 });
        catalogServices.forEach((s) => serviceCatalog.set(String(s._id), s.description || ''));
      }
      conversion = buildInvoiceLineItemsFromQuote(quote.quoteData, serviceCatalog);
    }

    const invoiceNumber = await nextInvoiceNumber();
    return Invoice.create({
      project: project._id,
      sourceQuote: quote ? quote._id : null,
      invoiceNumber,
      from: settingsToParty(settings),
      to: clientToParty(client),
      subtitle: project.name || '',
      headerNote: '',
      footerNote: settings.invoiceFooterDefault || '',
      lineItems: conversion.lineItems,
      subtotal: conversion.subtotal,
      discountAmount: conversion.discountAmount,
      total: conversion.total,
      issueDate: todayYmd(),
      dueDate: todayYmd(14),
      createdBy: userRecord?._id || null
    });
  }

  app.post('/api/projects/:id/invoices', requireApiAuth, async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      let quote = null;
      if (req.body.quoteName) {
        quote = await SavedQuote.findOne({ name: req.body.quoteName });
        if (!quote) return res.status(404).json({ error: 'Quote not found' });
      }

      const invoice = await createInvoiceFromQuote({ project, quote, user: req.user });
      res.status(201).json(invoice);
    } catch (error) {
      console.error('Error creating invoice:', error);
      res.status(500).json({ error: 'Failed to create invoice' });
    }
  });

  // Convert a quote to an invoice from the quotes list (auto-creates a project if needed)
  app.post('/api/quotes/:name/convert-to-invoice', requireApiAuth, async (req, res) => {
    try {
      const quote = await SavedQuote.findOne({ name: req.params.name });
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      let project = quote.project ? await Project.findById(quote.project) : null;
      if (!project) {
        let client = null;
        if (quote.clientName && quote.clientName.trim()) {
          const escaped = quote.clientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          client = await Client.findOne({ name: new RegExp(`^${escaped}$`, 'i') });
          if (!client) client = await Client.create({ name: quote.clientName.trim() });
        }
        const { startDate, endDate } = quoteDateRange(quote.quoteData);
        project = await Project.create({
          name: quote.quoteData?.quoteTitle || quote.name,
          client: client ? client._id : null,
          status: quote.booked ? 'booked' : 'quoted',
          startDate,
          endDate,
          createdBy: quote.createdBy || null
        });
        quote.project = project._id;
        await quote.save();
      }

      const invoice = await createInvoiceFromQuote({ project, quote, user: req.user });
      res.status(201).json({ success: true, projectId: project._id, invoiceId: invoice._id });
    } catch (error) {
      console.error('Error converting quote to invoice:', error);
      res.status(500).json({ error: 'Failed to convert quote to invoice' });
    }
  });

  app.get('/api/invoices/:id', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id).populate('sourceQuote', 'name');
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch invoice' });
    }
  });

  app.put('/api/invoices/:id', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.status === 'paid' || invoice.status === 'void') {
        return res.status(400).json({ error: `${invoice.status === 'paid' ? 'Paid' : 'Void'} invoices cannot be edited` });
      }

      const editable = ['from', 'to', 'subtitle', 'headerNote', 'footerNote', 'issueDate', 'dueDate'];
      editable.forEach((field) => {
        if (req.body[field] !== undefined) invoice[field] = req.body[field];
      });

      if (Array.isArray(req.body.lineItems)) {
        invoice.lineItems = req.body.lineItems.map((item) => {
          const quantity = Number(item.quantity) || 1;
          const unitPrice = Number(item.unitPrice) || 0;
          return {
            day: item.day || '',
            description: item.description || '',
            detail: item.detail || '',
            quantity,
            unitPrice,
            amount: Math.round(quantity * unitPrice * 100) / 100
          };
        });
      }
      if (req.body.discountAmount !== undefined) {
        invoice.discountAmount = Math.max(0, Number(req.body.discountAmount) || 0);
      }

      invoice.subtotal = Math.round(invoice.lineItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
      invoice.total = Math.round((invoice.subtotal - invoice.discountAmount) * 100) / 100;

      const hasPaidInstallment = (invoice.paymentPlan?.installments || []).some((i) => i.status === 'paid');
      if (req.body.paymentPlan !== undefined) {
        if (hasPaidInstallment) {
          return res.status(400).json({ error: 'The payment plan cannot be changed after a payment has been made' });
        }
        try {
          invoice.paymentPlan = normalizePaymentPlan(req.body.paymentPlan, invoice.total);
        } catch (planError) {
          return res.status(400).json({ error: planError.message });
        }
      } else if (hasPaymentPlan(invoice) && !hasPaidInstallment) {
        // Totals may have changed — re-derive installment amounts from percents
        invoice.paymentPlan = normalizePaymentPlan(invoice.paymentPlan, invoice.total);
      }

      await invoice.save();
      res.json(invoice);
    } catch (error) {
      console.error('Error updating invoice:', error);
      res.status(500).json({ error: 'Failed to update invoice' });
    }
  });

  app.post('/api/invoices/:id/send', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.status === 'void') return res.status(400).json({ error: 'Void invoices cannot be sent' });

      if (!invoice.publicToken) invoice.publicToken = generatePublicToken();
      if (invoice.status === 'draft') invoice.status = 'sent';
      invoice.sentAt = invoice.sentAt || new Date();
      await invoice.save();
      await advanceProjectStatus(invoice.project, 'invoiced');

      const link = `${getBaseUrl(req)}/invoice/${invoice.publicToken}`;
      res.json({ success: true, link, invoice });
    } catch (error) {
      console.error('Error sending invoice:', error);
      res.status(500).json({ error: 'Failed to send invoice' });
    }
  });

  app.post('/api/invoices/:id/mark-paid', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.status === 'void') return res.status(400).json({ error: 'Void invoices cannot be marked paid' });
      await markInvoicePaid(invoice);
      res.json({ success: true, invoice });
    } catch (error) {
      console.error('Error marking invoice paid:', error);
      res.status(500).json({ error: 'Failed to mark invoice paid' });
    }
  });

  app.post('/api/invoices/:id/void', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.status === 'paid') return res.status(400).json({ error: 'Paid invoices cannot be voided' });
      invoice.status = 'void';
      await invoice.save();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to void invoice' });
    }
  });

  app.delete('/api/invoices/:id', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.status !== 'draft' && invoice.status !== 'void') {
        return res.status(400).json({ error: 'Only draft or void invoices can be deleted' });
      }
      await Invoice.findByIdAndDelete(invoice._id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete invoice' });
    }
  });

  async function invoicePdfResponse(invoice, res) {
    const settings = await getCompanySettings();
    const schedule = await buildInstallmentSchedule(invoice);
    const html = renderInvoiceDocumentHtml(invoice, settings, schedule);
    const pdf = await generatePdfFromHtml(html, { format: 'Letter' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdf);
  }

  app.get('/api/invoices/:id/pdf', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      await invoicePdfResponse(invoice, res);
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      res.status(500).json({ error: 'Failed to generate invoice PDF' });
    }
  });

  // ----- Public invoice + Stripe -----

  async function findPublicInvoice(token) {
    if (!token || token.length < 24) return null;
    return Invoice.findOne({ publicToken: token, status: { $in: ['sent', 'paid'] } });
  }

  async function publicInvoiceJson(invoice) {
    return {
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      from: invoice.from,
      to: invoice.to,
      subtitle: invoice.subtitle,
      headerNote: invoice.headerNote,
      footerNote: invoice.footerNote,
      lineItems: invoice.lineItems,
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
      installments: await buildInstallmentSchedule(invoice),
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
      paymentOptions: await (async () => {
        const settings = await getCompanySettings();
        return {
          cardFeeEnabled: !!settings.cardFeeEnabled && settings.cardFeePercent > 0,
          cardFeePercent: settings.cardFeePercent || 0,
          achEnabled: !!settings.achEnabled
        };
      })()
    };
  }

  app.get('/api/public/invoices/:token', async (req, res) => {
    try {
      const invoice = await findPublicInvoice(req.params.token);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found or no longer available' });
      res.json(await publicInvoiceJson(invoice));
    } catch (error) {
      console.error('Error loading public invoice:', error);
      res.status(500).json({ error: 'Failed to load invoice' });
    }
  });

  app.get('/api/public/invoices/:token/pdf', async (req, res) => {
    try {
      const invoice = await findPublicInvoice(req.params.token);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      await invoicePdfResponse(invoice, res);
    } catch (error) {
      console.error('Error generating public invoice PDF:', error);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  app.post('/api/public/invoices/:token/checkout', async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        return res.status(503).json({ error: 'Online payment is not configured. Please contact us to pay this invoice.' });
      }

      const invoice = await findPublicInvoice(req.params.token);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      if (invoice.status === 'paid') return res.status(400).json({ error: 'This invoice is already paid' });

      // With a payment plan, each checkout pays one installment — unless the client
      // opts to pay the full remaining balance (payFull), which settles everything.
      let amountDue;
      let productName = `Invoice ${invoice.invoiceNumber}`;
      let installmentIndex = null;
      if (hasPaymentPlan(invoice) && !req.body?.payFull) {
        const installments = invoice.paymentPlan.installments;
        const requested = req.body?.installmentIndex;
        installmentIndex = requested !== undefined && requested !== null
          ? Number(requested)
          : installments.findIndex((i) => i.status !== 'paid');
        const inst = installments[installmentIndex];
        if (!inst) return res.status(400).json({ error: 'Installment not found' });
        if (inst.status === 'paid') return res.status(400).json({ error: 'This installment is already paid' });
        amountDue = Math.round(inst.amount * 100);
        productName = `Invoice ${invoice.invoiceNumber} — ${inst.label || `Payment ${installmentIndex + 1}`} (${installmentIndex + 1} of ${installments.length})`;
      } else {
        amountDue = Math.round((invoice.total - invoice.amountPaid) * 100);
        if (hasPaymentPlan(invoice)) {
          productName = `Invoice ${invoice.invoiceNumber} — Remaining balance`;
        }
      }
      if (amountDue <= 0) return res.status(400).json({ error: 'No balance due on this invoice' });

      const settings = await getCompanySettings();
      const method = req.body?.method === 'ach' && settings.achEnabled ? 'ach' : 'card';

      const lineItems = [{
        price_data: {
          currency: invoice.currency || 'usd',
          product_data: {
            name: productName,
            description: invoice.subtitle || undefined
          },
          unit_amount: amountDue
        },
        quantity: 1
      }];

      // Card surcharge (offset processing fees) — never applied to bank payments
      if (method === 'card' && settings.cardFeeEnabled && settings.cardFeePercent > 0) {
        const fee = Math.round(amountDue * (settings.cardFeePercent / 100));
        if (fee > 0) {
          lineItems.push({
            price_data: {
              currency: invoice.currency || 'usd',
              product_data: { name: `Card processing fee (${settings.cardFeePercent}%)` },
              unit_amount: fee
            },
            quantity: 1
          });
        }
      }

      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: method === 'ach' ? ['us_bank_account'] : ['card'],
        line_items: lineItems,
        customer_email: invoice.to?.email || undefined,
        metadata: {
          invoiceId: String(invoice._id),
          invoiceNumber: invoice.invoiceNumber,
          ...(installmentIndex !== null ? { installmentIndex: String(installmentIndex) } : {})
        },
        success_url: `${baseUrl}/invoice/${invoice.publicToken}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/invoice/${invoice.publicToken}`
      });

      if (installmentIndex !== null) {
        invoice.paymentPlan.installments[installmentIndex].stripeSessionId = session.id;
      } else {
        invoice.stripeSessionId = session.id;
      }
      await invoice.save();

      res.json({ url: session.url });
    } catch (error) {
      console.error('Error creating Stripe checkout session:', error);
      res.status(500).json({ error: 'Failed to start payment. Please try again.' });
    }
  });

  // Fallback confirmation for environments without webhooks (e.g. local dev):
  // verifies the Checkout Session directly with Stripe before marking paid.
  app.get('/api/public/invoices/:token/confirm', async (req, res) => {
    try {
      const stripe = getStripe();
      const sessionId = req.query.session_id;
      const invoice = await findPublicInvoice(req.params.token);
      if (!invoice || !stripe || !sessionId) {
        return res.json({ paid: invoice ? invoice.status === 'paid' : false });
      }
      if (invoice.status === 'paid') return res.json({ paid: true });

      const session = await stripe.checkout.sessions.retrieve(String(sessionId));
      const belongsToInvoice = session?.metadata?.invoiceId === String(invoice._id);
      if (belongsToInvoice && session.payment_status === 'paid') {
        await settleStripeSession(invoice, session);
        return res.json({ paid: invoice.status === 'paid', updated: true });
      }
      res.json({ paid: false });
    } catch (error) {
      console.error('Error confirming payment:', error);
      res.json({ paid: false });
    }
  });

  // Stripe webhook (raw body captured in server.js via express.json verify hook)
  app.post('/api/stripe/webhook', async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).send('Stripe not configured');

    let event = null;
    try {
      if (process.env.STRIPE_WEBHOOK_SECRET) {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          req.headers['stripe-signature'],
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } else {
        console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set — rejecting unverified webhook');
        return res.status(400).send('Webhook secret not configured');
      }
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send('Invalid signature');
    }

    try {
      // ACH debits settle days later — async_payment_succeeded fires when the funds clear
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object;
        const invoiceId = session.metadata?.invoiceId;
        if (invoiceId && session.payment_status === 'paid') {
          const invoice = await Invoice.findById(invoiceId);
          if (invoice) {
            await settleStripeSession(invoice, session);
            const which = session.metadata?.installmentIndex !== undefined
              ? ` (installment ${Number(session.metadata.installmentIndex) + 1})` : '';
            console.log(`✅ Invoice ${invoice.invoiceNumber}${which} paid via Stripe`);
          }
        }
      }
      res.json({ received: true });
    } catch (error) {
      console.error('Error handling Stripe webhook:', error);
      res.status(500).send('Webhook handler error');
    }
  });
};
