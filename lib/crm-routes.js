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
  quoteDateRange,
  syncProjectDatesFromQuotes
} = require('./crm-models');

const {
  buildProjectAccessQuery,
  mergeAccessIntoQuery,
  canAccessProject,
  requireProjectAccess,
  annotateProjectAccessFields,
  getAccessibleProjectIds
} = require('./crm-access');

const { generatePdfFromHtml } = require('./pdf-generator');
const notify = require('./crm-notify');
const { isValidEmail } = require('./email');

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
  // Local requests must use localhost so sign/pay hits this server (not production APP_BASE_URL)
  if (req) {
    const host = String(req.get('host') || '');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      return `${proto}://${host}`;
    }
  }
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  if (!req) return '';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

const EMAIL_PDF_TIMEOUT_MS = 20000;

function withPdfTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${EMAIL_PDF_TIMEOUT_MS}ms`)), EMAIL_PDF_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function buildContractPdfBuffer(contract) {
  try {
    const [settings, project] = await Promise.all([
      getCompanySettings(),
      Project.findById(contract.project).populate('client')
    ]);
    if (contract.source === 'uploaded' && contract.uploadedFile?.localPath) {
      const filePath = path.join(__dirname, '..', contract.uploadedFile.localPath);
      return await fs.promises.readFile(filePath);
    }
    const html = renderContractDocumentHtml(contract, settings, {
      client: project?.client,
      project
    });
    return await withPdfTimeout(generatePdfFromHtml(html, { format: 'Letter' }), 'Contract PDF');
  } catch (error) {
    console.warn('[email] Could not build contract PDF:', error.message);
    return null;
  }
}

async function buildInvoicePdfBuffer(invoice) {
  try {
    const settings = await getCompanySettings();
    const schedule = await buildInstallmentSchedule(invoice);
    const html = renderInvoiceDocumentHtml(invoice, settings, schedule);
    return await withPdfTimeout(generatePdfFromHtml(html, { format: 'Letter' }), 'Invoice PDF');
  } catch (error) {
    console.warn('[email] Could not build invoice PDF:', error.message);
    return null;
  }
}

/** Client receipt + staff notify after a payment settles. */
async function notifyAfterInvoicePayment(invoice, { baseUrl, installmentIndex = null } = {}) {
  const url = baseUrl || getBaseUrl(null);
  try {
    let fresh = await Invoice.findById(invoice._id);
    if (!fresh) return;
    // Send emails even if PDF generation is slow/fails (link-only fallback)
    const pdfBuffer = await buildInvoicePdfBuffer(fresh);
    const fullyPaid = fresh.status === 'paid';

    // Installment receipt + staff alert (including when this payment completes the invoice)
    if (installmentIndex != null) {
      fresh = await Invoice.findById(invoice._id);
      if (!notify.hasEmailLog(fresh, 'receipt_installment', { installmentIndex })) {
        const receipt = await notify.emailInvoiceReceipt(fresh, {
          baseUrl: url,
          pdfBuffer,
          installmentIndex,
          auto: true
        });
        console.log('[email] Installment receipt:', receipt.ok ? 'sent' : (receipt.error || 'skipped'), receipt.to);
      }
      fresh = await Invoice.findById(invoice._id);
      const staff = await notify.notifyStaffInvoicePaid(fresh, { baseUrl: url, installmentIndex });
      console.log('[email] Staff installment paid notify:', staff.ok ? 'sent' : (staff.error || 'skipped'), staff.to || []);
    }

    if (fullyPaid) {
      fresh = await Invoice.findById(invoice._id);
      if (!notify.hasEmailLog(fresh, 'receipt') && installmentIndex == null) {
        const receipt = await notify.emailInvoiceReceipt(fresh, { baseUrl: url, pdfBuffer, auto: true });
        console.log('[email] Payment receipt:', receipt.ok ? 'sent' : (receipt.error || 'skipped'), receipt.to);
      }
      // Reload so owner notify never fails on a stale mongoose version after receipt save
      fresh = await Invoice.findById(invoice._id);
      const staff = await notify.notifyStaffInvoicePaid(fresh, { baseUrl: url });
      console.log('[email] Staff paid-in-full notify:', staff.ok ? 'sent' : (staff.error || 'skipped'), staff.to || []);
    }
  } catch (error) {
    console.error('[email] Payment notification failed:', error.message);
  }
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
    const dayDate = day.date || null;
    const dayLabel = formatDayShort(dayDate) || ((quoteData.days.length > 1) ? `Day ${dayIndex + 1}` : '');
    (day.services || []).forEach((service) => {
      if (service.tentative) return;
      const quantity = service.quantity || 1;
      const unitPrice = service.price || 0;
      const gross = unitPrice * quantity;
      const discountMeta = service.discount && typeof service.discount === 'object'
        ? {
            type: service.discount.type === 'fixed' ? 'fixed' : 'percentage',
            value: Number(service.discount.value) || 0,
            applied: !!service.discount.applied
          }
        : { type: 'percentage', value: 0, applied: false };
      let discount = 0;
      if (discountMeta.applied && discountMeta.value > 0) {
        discount = discountMeta.type === 'percentage'
          ? gross * (discountMeta.value / 100)
          : Math.min(discountMeta.value, gross);
      }
      const amount = gross - discount;
      subtotal += amount;
      const detailDescription = service.description !== undefined
        ? (service.description || '')
        : (serviceCatalog.get(String(service.id)) || '');
      lineItems.push({
        day: dayLabel,
        description: service.name || 'Service',
        detail: [detailDescription, discount > 0 ? 'Discount applied' : ''].filter(Boolean).join(' • '),
        quantity,
        unitPrice,
        amount: Math.round(amount * 100) / 100,
        kind: 'service',
        dayDate,
        serviceId: (service.id != null && /^[a-fA-F0-9]{24}$/.test(String(service.id)))
          ? String(service.id)
          : null,
        category: service.category || '',
        tentative: false,
        detailDescription,
        discount: discountMeta
      });
    });
  });

  (quoteData?.markups || []).forEach((markup) => {
    const amount = typeof markup.markupAmount === 'number' ? markup.markupAmount : 0;
    if (amount <= 0) return;
    const rounded = Math.round(amount * 100) / 100;
    subtotal += rounded;
    lineItems.push({
      day: '',
      description: markup.name || 'Markup',
      detail: markup.description || '',
      quantity: 1,
      unitPrice: rounded,
      amount: rounded,
      kind: 'markup',
      dayDate: null,
      serviceId: null,
      category: '',
      tentative: false,
      detailDescription: markup.description || '',
      discount: null
    });
  });

  const discountPercentage = Number(quoteData?.discountPercentage) || 0;
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

/** Rebuild quote editor state from invoice line items (lossless when origin fields present). */
function buildQuoteDataFromInvoice(invoice) {
  const items = invoice?.lineItems || [];
  const dayMap = new Map(); // key -> { date, services: [] }
  const markups = [];

  const ensureDay = (key, date) => {
    if (!dayMap.has(key)) {
      dayMap.set(key, { date: date || null, services: [] });
    }
    return dayMap.get(key);
  };

  items.forEach((item, index) => {
    const kind = item.kind || (item.day ? 'service' : 'markup');
    if (kind === 'markup') {
      markups.push({
        name: item.description || 'Markup',
        description: item.detailDescription || item.detail || '',
        markupAmount: Number(item.amount) || Number(item.unitPrice) || 0
      });
      return;
    }

    const dayDate = item.dayDate || null;
    const dayKey = dayDate || (item.day ? `label:${item.day}` : `ungrouped:${index}`);
    const day = ensureDay(dayKey, dayDate);
    const discount = item.discount && typeof item.discount === 'object'
      ? {
          type: item.discount.type === 'fixed' ? 'fixed' : 'percentage',
          value: Number(item.discount.value) || 0,
          applied: !!item.discount.applied
        }
      : { type: 'percentage', value: 0, applied: false };

    const realServiceId = item.serviceId && /^[a-fA-F0-9]{24}$/.test(String(item.serviceId))
      ? String(item.serviceId)
      : null;
    day.services.push({
      id: realServiceId || `invoice-line-${index}`,
      name: item.description || 'Service',
      price: Number(item.unitPrice) || 0,
      quantity: Number(item.quantity) || 1,
      tentative: !!item.tentative,
      category: item.category || '',
      description: item.detailDescription != null
        ? item.detailDescription
        : String(item.detail || '').replace(/\s*•\s*Discount applied\s*$/, ''),
      discount
    });
  });

  // Preserve order of first appearance
  const days = [...dayMap.values()];
  if (days.length === 0) {
    days.push({ date: null, services: [] });
  }

  let discountPercentage = Number(invoice?.discountPercentage) || 0;
  if (!discountPercentage && invoice?.subtotal > 0 && invoice?.discountAmount > 0) {
    discountPercentage = Math.round((invoice.discountAmount / invoice.subtotal) * 10000) / 100;
  }

  return {
    days,
    markups,
    discountPercentage,
    quoteTitle: invoice?.subtitle || invoice?.invoiceNumber || 'Invoice'
  };
}

function normalizeInvoiceLineItem(item) {
  const quantity = Number(item.quantity) || 1;
  const unitPrice = Number(item.unitPrice) || 0;
  const discount = item.discount && typeof item.discount === 'object'
    ? {
        type: item.discount.type === 'fixed' ? 'fixed' : 'percentage',
        value: Number(item.discount.value) || 0,
        applied: !!item.discount.applied
      }
    : null;

  let amount;
  if (discount && discount.applied && discount.value > 0) {
    const gross = unitPrice * quantity;
    const discountValue = discount.type === 'percentage'
      ? gross * (discount.value / 100)
      : Math.min(discount.value, gross);
    amount = Math.round((gross - discountValue) * 100) / 100;
  } else if (item.amount != null && item.amount !== '' && item.kind === 'markup') {
    amount = Math.round((Number(item.amount) || 0) * 100) / 100;
  } else {
    amount = Math.round(quantity * unitPrice * 100) / 100;
  }

  return {
    day: item.day || '',
    description: item.description || '',
    detail: item.detail || '',
    quantity,
    unitPrice,
    amount,
    kind: item.kind === 'markup' ? 'markup' : 'service',
    dayDate: item.dayDate || null,
    serviceId: item.serviceId != null ? String(item.serviceId) : null,
    category: item.category || '',
    tentative: !!item.tentative,
    detailDescription: item.detailDescription != null ? item.detailDescription : '',
    discount
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
    service_role: ctx.serviceRole || 'Service Provider',
    photo_delivery: ctx.photoDelivery || 'within forty-eight (48) hours after the event via online gallery',
    video_delivery: ctx.videoDelivery || 'according to the post-production option selected in the accepted quote'
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const value = map[key.toLowerCase()];
    return value !== undefined ? escapeHtml(value) : match;
  });
}

/** Known production catalog ids (name heuristics are the fallback). */
const DELIVERY_SERVICE_IDS = {
  liveGallery: new Set(['6855fbf035d971d27b176144']),
  highlightSameDay: new Set(['6855f9e235d971d27b17610c']),
  highlightOneWeek: new Set(['6855f9b635d971d27b176107'])
};

function classifyDeliveryService(service, catalogById = new Map()) {
  const id = service?.id != null ? String(service.id) : '';
  const catalog = id ? catalogById.get(id) : null;
  const name = String(service?.name || catalog?.name || '').trim();
  const category = String(service?.category || catalog?.category || '').toLowerCase().trim();

  const isLiveGallery = DELIVERY_SERVICE_IDS.liveGallery.has(id)
    || /live\s*gallery/i.test(name);
  const isHighlightSameDay = DELIVERY_SERVICE_IDS.highlightSameDay.has(id)
    || (/same\s*day/i.test(name) && /(highlight|edit|video)/i.test(name));
  const isHighlightOneWeek = DELIVERY_SERVICE_IDS.highlightOneWeek.has(id)
    || (/(1\s*week|one\s*week)/i.test(name) && /(highlight|edit|video)/i.test(name));

  const isPhotography = category === 'photography'
    || (!category && /photographer|photography|live\s*gallery/i.test(name) && !/video/i.test(name));

  return {
    id,
    name,
    category,
    isLiveGallery,
    isHighlightSameDay,
    isHighlightOneWeek,
    isPhotography
  };
}

/**
 * Inspect quote days for Live Gallery coverage and highlight-edit SKUs.
 * catalogById: Map(serviceId -> { name, category })
 */
function findQuoteDeliveryFlags(quoteData, catalogById = new Map()) {
  let photoDays = 0;
  let photoDaysWithLiveGallery = 0;
  let hasLiveGallery = false;
  let hasHighlightSameDay = false;
  let hasHighlightOneWeek = false;
  let hasVideography = false;

  (quoteData?.days || []).forEach((day) => {
    const services = day.services || [];
    let dayHasPhoto = false;
    let dayHasLiveGallery = false;

    services.forEach((service) => {
      const info = classifyDeliveryService(service, catalogById);
      if (info.isLiveGallery) {
        hasLiveGallery = true;
        dayHasLiveGallery = true;
        dayHasPhoto = true;
      }
      if (info.isPhotography && !info.isLiveGallery) {
        dayHasPhoto = true;
      }
      if (info.isHighlightSameDay) hasHighlightSameDay = true;
      if (info.isHighlightOneWeek) hasHighlightOneWeek = true;
      if (info.category === 'videography' || info.isHighlightSameDay || info.isHighlightOneWeek
        || /videograph/i.test(info.name)) {
        hasVideography = true;
      }
    });

    if (dayHasPhoto) {
      photoDays += 1;
      if (dayHasLiveGallery) photoDaysWithLiveGallery += 1;
    }
  });

  return {
    photoDays,
    photoDaysWithLiveGallery,
    hasLiveGallery,
    hasHighlightSameDay,
    hasHighlightOneWeek,
    hasVideography,
    liveGalleryAllPhotoDays: photoDays > 0 && photoDaysWithLiveGallery === photoDays,
    liveGallerySomePhotoDays: photoDaysWithLiveGallery > 0 && photoDaysWithLiveGallery < photoDays
  };
}

function buildPhotoDeliveryText(flags) {
  if (!flags?.hasLiveGallery || flags.photoDaysWithLiveGallery === 0) {
    return 'within forty-eight (48) hours after the event via online gallery';
  }
  if (flags.liveGalleryAllPhotoDays) {
    return 'in realtime via the Live Gallery during coverage on each event day';
  }
  // Mixed: Live Gallery on some photography days only
  return 'in realtime via the Live Gallery on days where Live Gallery is included, and within forty-eight (48) hours after the event via online gallery on days without Live Gallery';
}

function buildVideoDeliveryText(flags) {
  const sameDay = !!flags?.hasHighlightSameDay;
  const oneWeek = !!flags?.hasHighlightOneWeek;
  if (sameDay && oneWeek) {
    return 'on the same day as the event for Same Day edit, and within one (1) week for One Week edit, as listed in the accepted quote';
  }
  if (sameDay) {
    return 'on the same day as the event (60–90 second highlight)';
  }
  if (oneWeek) {
    return 'within one (1) week of the final project date (60–90 second highlight)';
  }
  // No concrete timeline until a post-production SKU is on the quote
  return 'according to the post-production option selected in the accepted quote';
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
  const catalogById = new Map();

  // Quote line items only snapshot id/name/price — resolve categories from the catalog
  if (quoteServices.size > 0 && ServiceModel) {
    const catalogServices = await ServiceModel.find({ _id: { $in: [...quoteServices.keys()] } }, { name: 1, category: 1 });
    catalogServices.forEach((s) => {
      const id = String(s._id);
      const category = s.category ? String(s.category).toLowerCase() : '';
      catalogById.set(id, { name: s.name || '', category });
      const entry = quoteServices.get(id);
      if (entry) {
        if (!entry.name && s.name) entry.name = s.name;
        if (!entry.category && category) entry.category = category;
      }
      if (category) categories.add(category);
    });
  }

  const deliveryFlags = findQuoteDeliveryFlags(quoteData, catalogById);
  const photoDelivery = buildPhotoDeliveryText(deliveryFlags);
  const videoDelivery = buildVideoDeliveryText(deliveryFlags);

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
    investment,
    photoDelivery,
    videoDelivery
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
  hr.contract-section-divider, hr.contract-divider { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
  table.items { width: 100%; border-collapse: collapse; margin: 14px 0; }
  table.items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; border-bottom: 1.5px solid #1f2430; padding: 6px 8px; }
  table.items td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.items .num { text-align: right; white-space: nowrap; }
  table.contract-table { width: 100%; border-collapse: collapse; margin: 14px 0; }
  table.contract-table th, table.contract-table td { border: 1px solid #ccc; padding: 7px 8px; vertical-align: top; text-align: left; }
  table.contract-table th { background: #f6f7f9; font-weight: 600; }
  .contract-field { display: flex; align-items: center; gap: 10px; margin: 14px 0; padding: 8px 0; }
  .contract-field-label { flex: 1; }
  .contract-initials .contract-field-label { flex: 0 0 auto; min-width: 70px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; font-weight: 600; }
  .contract-initials .contract-field-box { min-width: 80px; min-height: 28px; border-bottom: 1px solid #333; display: inline-flex; align-items: flex-end; justify-content: center; font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 20px; padding: 0 6px; }
  .contract-checkbox .contract-field-box { width: 14px; height: 14px; border: 1.5px solid #333; border-radius: 2px; flex: 0 0 auto; position: relative; display: inline-block; }
  .contract-checkbox .contract-field-box.is-checked::after { content: ''; position: absolute; left: 4px; top: 0; width: 4px; height: 8px; border: solid #1f2430; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
  .totals { width: 260px; margin-left: auto; margin-top: 8px; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 8px; }
  .totals .grand { font-weight: bold; font-size: 14px; border-top: 2px solid #1f2430; margin-top: 4px; padding-top: 7px; }
  .sig-block { margin-top: 44px; display: flex; gap: 48px; align-items: flex-end; }
  .sig-slot { flex: 1; min-width: 0; }
  .sig-pad {
    min-height: 56px;
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    padding: 0 2px 6px;
    box-sizing: border-box;
  }
  .sig-pad img {
    display: block;
    max-height: 48px;
    max-width: 100%;
    height: auto;
    object-fit: contain;
  }
  .sig-name {
    display: block;
    font-family: 'Brush Script MT', 'Segoe Script', cursive;
    font-size: 28px;
    line-height: 1.05;
    color: #1f2430;
    padding-bottom: 2px;
  }
  .sig-rule { border-bottom: 1px solid #333; height: 0; }
  .sig-caption { font-size: 10px; color: #666; margin-top: 6px; line-height: 1.35; }
  .audit { margin-top: 28px; padding: 10px 12px; background: #f6f7f9; border: 1px solid #e2e4e9; font-size: 10px; color: #555; }
`;

/** Parse interactive field definitions from contract HTML. */
function extractContractFields(contentHtml) {
  if (!contentHtml) return [];
  const fields = [];
  const re = /<div\b[^>]*\bclass="[^"]*\bcontract-field\b[^"]*"[^>]*>/gi;
  let match;
  while ((match = re.exec(contentHtml)) !== null) {
    const tag = match[0];
    const idMatch = tag.match(/\bdata-field-id="([^"]+)"/i);
    const typeMatch = tag.match(/\bdata-field-type="([^"]+)"/i);
    const required = !/\bdata-required="false"/i.test(tag);
    if (!idMatch || !typeMatch) continue;
    const type = typeMatch[1];
    if (type !== 'initials' && type !== 'checkbox') continue;

    const openEnd = match.index + tag.length;
    const closeIdx = contentHtml.indexOf('</div>', openEnd);
    const inner = closeIdx === -1 ? '' : contentHtml.slice(openEnd, closeIdx);
    const labelMatch = inner.match(/class="contract-field-label"[^>]*>([\s\S]*?)<\/span>/i);
    const label = labelMatch
      ? labelMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : (type === 'initials' ? 'Initials' : 'Acknowledgment');

    fields.push({
      fieldId: idMatch[1],
      type,
      required,
      label
    });
  }
  return fields;
}

function normalizeFieldResponses(rawResponses, definedFields) {
  const byId = new Map();
  (Array.isArray(rawResponses) ? rawResponses : []).forEach((item) => {
    if (!item || !item.fieldId) return;
    byId.set(String(item.fieldId), item);
  });

  const required = definedFields.filter((f) => f.required !== false);
  const completedAt = new Date();
  const normalized = [];

  for (const field of required) {
    const incoming = byId.get(String(field.fieldId));
    if (!incoming) {
      throw new Error(`Please complete all required fields (${field.label || field.type})`);
    }
    if (field.type === 'initials') {
      const value = String(incoming.value || '').trim();
      if (!value) {
        throw new Error(`Please provide initials for "${field.label || 'Initials'}"`);
      }
      if (value.length > 40) {
        throw new Error('Initials are too long');
      }
      normalized.push({
        fieldId: field.fieldId,
        type: 'initials',
        value,
        label: field.label || '',
        completedAt
      });
    } else if (field.type === 'checkbox') {
      const checked = incoming.value === true
        || incoming.value === 'true'
        || incoming.value === 'on'
        || incoming.value === 1
        || incoming.value === '1';
      if (!checked) {
        throw new Error(`Please check: "${field.label || 'Acknowledgment'}"`);
      }
      normalized.push({
        fieldId: field.fieldId,
        type: 'checkbox',
        value: 'true',
        label: field.label || '',
        completedAt
      });
    }
  }

  return normalized;
}

function applyFieldResponsesToHtml(contentHtml, fieldResponses) {
  if (!contentHtml) return '';
  const map = new Map((fieldResponses || []).map((r) => [String(r.fieldId), r]));
  if (!map.size) return contentHtml;

  return contentHtml.replace(
    /<div\b([^>]*\bclass="[^"]*\bcontract-field\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi,
    (full, attrs, inner) => {
      const idMatch = attrs.match(/\bdata-field-id="([^"]+)"/i);
      const typeMatch = attrs.match(/\bdata-field-type="([^"]+)"/i);
      if (!idMatch || !typeMatch) return full;
      const response = map.get(String(idMatch[1]));
      if (!response) return full;
      const type = typeMatch[1];

      if (type === 'initials') {
        const value = escapeHtml(response.value || '');
        let nextInner = inner.replace(
          /(<span\b[^>]*\bclass="[^"]*\bcontract-field-box\b[^"]*"[^>]*>)([\s\S]*?)(<\/span>)/i,
          `$1${value}$3`
        );
        if (nextInner === inner) {
          nextInner = `${inner}<span class="contract-field-box is-filled">${value}</span>`;
        }
        const attrsWithClass = attrs.replace(/\bclass="([^"]*)"/i, (m, cls) => (
          cls.includes('is-complete') ? m : `class="${cls} is-complete"`
        ));
        return `<div${attrsWithClass}>${nextInner}</div>`;
      }

      if (type === 'checkbox') {
        let nextInner = inner.replace(
          /(<span\b[^>]*\bclass="[^"]*\bcontract-field-box\b[^"]*")([^>]*>)/i,
          (m, start, end) => {
            if (/\bis-checked\b/.test(start)) return m;
            return `${start.replace(/\bclass="/i, 'class="is-checked ')}${end}`;
          }
        );
        const attrsWithClass = attrs.replace(/\bclass="([^"]*)"/i, (m, cls) => {
          let next = cls;
          if (!next.includes('is-complete')) next += ' is-complete';
          if (!next.includes('is-checked')) next += ' is-checked';
          return `class="${next}"`;
        });
        return `<div${attrsWithClass}>${nextInner}</div>`;
      }

      return full;
    }
  );
}

function renderSignatureSlot(label, { signatureHtml = '', caption = '' } = {}) {
  return `
    <div class="sig-slot">
      <div class="sig-pad">${signatureHtml || '&nbsp;'}</div>
      <div class="sig-rule"></div>
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

  const fieldResponses = contract.fieldResponses || [];
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
  if (fieldResponses.length) {
    const fieldLines = fieldResponses.map((field) => {
      if (field.type === 'initials') {
        return `Initialed "${escapeHtml(field.label || 'Initials')}": ${escapeHtml(field.value || '')}`;
      }
      return `Acknowledged: ${escapeHtml(field.label || 'Checkbox')}`;
    });
    auditEntries.push(`In-document fields<br>${fieldLines.join('<br>')}`);
  }
  const auditBlock = auditEntries.length > 0 ? `
    <div class="audit">
      <strong>Signature audit trail</strong><br>
      ${auditEntries.join('<br><br>')}
    </div>` : '';

  const uploadedNote = contract.source === 'uploaded'
    ? `<p class="muted">This signature certificate accompanies the uploaded contract document "${escapeHtml(contract.uploadedFile?.filename || 'contract.pdf')}".</p>`
    : '';

  const bodyHtml = contract.source === 'generated'
    ? applyFieldResponsesToHtml(contract.contentHtml || '', fieldResponses)
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
  ${bodyHtml}
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

/** Parse YYYY-MM-DD to a local noon Date, or null if invalid. */
function parsePaidDateInput(value) {
  if (value instanceof Date && !isNaN(value)) return value;
  if (!value || typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

async function markInvoicePaid(invoice, { paymentIntentId = null, paidAt = null } = {}) {
  if (invoice.status === 'paid') return invoice;
  const when = paidAt instanceof Date && !isNaN(paidAt) ? paidAt : new Date();
  invoice.status = 'paid';
  invoice.amountPaid = invoice.total;
  invoice.paidAt = when;
  if (paymentIntentId) invoice.stripePaymentIntentId = paymentIntentId;
  (invoice.paymentPlan?.installments || []).forEach((inst) => {
    if (inst.status !== 'paid') {
      inst.status = 'paid';
      inst.paidAt = when;
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
async function settleStripeSession(invoice, session, { baseUrl = null } = {}) {
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  const idx = session.metadata?.installmentIndex;
  const url = baseUrl || getBaseUrl(null);
  let result = invoice;
  let installmentIndex = null;
  let alreadySettled = false;

  if (idx !== undefined && idx !== null && idx !== '') {
    installmentIndex = Number(idx);
    const inst = invoice.paymentPlan?.installments?.[installmentIndex];
    if (inst?.status === 'paid') {
      alreadySettled = true;
    } else {
      result = await markInstallmentPaid(invoice, installmentIndex, { paymentIntentId });
    }
  } else if (invoice.status === 'paid') {
    alreadySettled = true;
  } else {
    result = await markInvoicePaid(invoice, { paymentIntentId });
  }

  // Always attempt notify (idempotent). Important for local dev: Stripe webhooks often
  // hit production first and mark the shared DB paid without running this server's email code.
  if (alreadySettled) {
    console.log(`[email] Payment already settled for ${invoice.invoiceNumber}; ensuring notify emails`);
  }
  await notifyAfterInvoicePayment(result, { baseUrl: url, installmentIndex });
  return result;
}

/** Marks one installment paid; marks the whole invoice paid once every installment is. */
async function markInstallmentPaid(invoice, index, { paymentIntentId = null, paidAt = null } = {}) {
  const installments = invoice.paymentPlan?.installments || [];
  const inst = installments[index];
  if (!inst || inst.status === 'paid') return invoice;

  const when = paidAt instanceof Date && !isNaN(paidAt) ? paidAt : new Date();
  inst.status = 'paid';
  inst.paidAt = when;
  if (paymentIntentId) inst.stripePaymentIntentId = paymentIntentId;

  const paidTotal = installments
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + (i.amount || 0), 0);
  invoice.amountPaid = Math.min(invoice.total, Math.round(paidTotal * 100) / 100);

  if (installments.every((i) => i.status === 'paid')) {
    return markInvoicePaid(invoice, { paymentIntentId, paidAt: when });
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

  app.get('/invoices', requireAuth, (req, res) => {
    res.sendFile(path.join(publicDir, 'invoices.html'));
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

      let query = {};
      if (archived === 'true') {
        query.archived = true;
      } else {
        query.archived = { $ne: true };
      }
      // "Booked" filter = booked through complete (signed / invoiced / paid / complete)
      if (status === 'booked' || status === 'booked_plus') {
        query.status = { $in: ['booked', 'contract_signed', 'invoiced', 'paid', 'complete'] };
      } else if (status) {
        query.status = status;
      }

      const accessQuery = await buildProjectAccessQuery(req.user);
      query = mergeAccessIntoQuery(query, accessQuery);
      if (query._id === null) {
        return res.json({ projects: [], total: 0, page, limit, totalPages: 0 });
      }

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
      const SORTABLE = ['name', 'client', 'dates', 'status', 'contract', 'invoices', 'owner', 'created'];
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
      } else if (sortBy === 'client' || sortBy === 'owner') {
        const lookup = sortBy === 'client'
          ? {
              from: 'crmClients',
              localField: 'client',
              foreignField: '_id',
              as: 'sortDoc',
              namePath: 'name'
            }
          : {
              from: 'users',
              localField: 'createdBy',
              foreignField: '_id',
              as: 'sortDoc',
              namePath: 'name'
            };
        const sortedIds = await Project.aggregate([
          { $match: query },
          {
            $lookup: {
              from: lookup.from,
              localField: lookup.localField,
              foreignField: lookup.foreignField,
              as: 'sortDoc'
            }
          },
          {
            $addFields: {
              _sortName: {
                $toLower: { $ifNull: [{ $arrayElemAt: [`$sortDoc.${lookup.namePath}`, 0] }, ''] }
              }
            }
          },
          { $sort: { _sortName: sortDir, updatedAt: -1 } },
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
            : sortBy === 'created'
              ? { createdAt: sortDir }
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

      const projectsWithAccess = await Promise.all(withSummaries.map(async (project) => {
        const accessLevel = await canAccessProject(req.user, project, true);
        return annotateProjectAccessFields(req.user, project, accessLevel);
      }));

      res.json({
        projects: projectsWithAccess,
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

      // Only clients linked to projects the user can access (owner / shared / admin).
      const accessQuery = await buildProjectAccessQuery(req.user);
      const projectQuery = mergeAccessIntoQuery(
        { archived: { $ne: true }, client: { $ne: null } },
        accessQuery
      );
      const projects = projectQuery._id === null
        ? []
        : await Project.find(projectQuery)
          .populate('createdBy', 'name')
          .sort({ startDate: -1, updatedAt: -1 });

      const clientIds = [...new Set(
        projects.map((p) => p.client?.toString?.() || String(p.client)).filter(Boolean)
      )];
      if (!clientIds.length) {
        return res.json({ clients: [] });
      }

      const query = { _id: { $in: clientIds } };
      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ name: regex }, { company: regex }, { email: regex }];
      }

      const clients = await Client.find(query).sort({ name: 1 });
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
        }).filter((c) => c.projectCount > 0)
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
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'read' });
      if (!access) return;

      const project = await Project.findById(req.params.id)
        .populate('client')
        .populate('createdBy', 'name')
        .populate('sharedWith.user', 'name email');
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const [quotes, contract, invoices] = await Promise.all([
        SavedQuote.find({ project: project._id }, {
          name: 1, clientName: 1, location: 1, booked: 1, archived: 1,
          createdAt: 1, updatedAt: 1, 'quoteData.total': 1, 'quoteData.days': 1, 'quoteData.quoteTitle': 1
        }).sort({ updatedAt: -1 }),
        Contract.findOne({ project: project._id }).sort({ createdAt: -1 }),
        Invoice.find({ project: project._id }).sort({ createdAt: -1 })
      ]);

      res.json({
        project: annotateProjectAccessFields(req.user, project, access.accessLevel),
        quotes,
        contract,
        invoices,
        accessLevel: access.accessLevel,
        isOwner: access.isOwner
      });
    } catch (error) {
      console.error('Error fetching project:', error);
      res.status(500).json({ error: 'Failed to fetch project' });
    }
  });

  app.put('/api/projects/:id', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;

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
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;

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
      const access = await requireProjectAccess(req, res, req.params.id, { ownerOrAdmin: true });
      if (!access) return;

      const project = access.project;
      const force = req.query.force === '1' || req.query.force === 'true' || req.body?.force === true;
      const isAdmin = req.user?.role === 'admin';

      // Draft + void never block deletion
      await Promise.all([
        SavedQuote.updateMany({ project: project._id }, { $set: { project: null } }),
        Contract.deleteMany({ project: project._id }),
        Invoice.deleteMany({ project: project._id, status: { $in: ['draft', 'void'] } })
      ]);

      const remainingInvoices = await Invoice.countDocuments({ project: project._id });
      if (remainingInvoices > 0) {
        if (!force) {
          return res.status(400).json({
            error: `Project has ${remainingInvoices} sent or paid invoice(s). Void unpaid ones first, or use force delete (admin).`,
            code: 'HAS_INVOICES',
            invoiceCount: remainingInvoices
          });
        }
        if (!isAdmin) {
          return res.status(403).json({ error: 'Only admins can force-delete projects with sent or paid invoices.' });
        }
        await Invoice.deleteMany({ project: project._id });
      }

      await Project.findByIdAndDelete(project._id);
      res.json({ success: true, force: !!force && remainingInvoices > 0 });
    } catch (error) {
      console.error('Error deleting project:', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  app.post('/api/projects/:id/link-quote', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;
      const project = access.project;

      const { quoteName } = req.body;
      const quote = await SavedQuote.findOne({ name: quoteName });
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      quote.project = project._id;
      await quote.save();
      await advanceProjectStatus(project._id, 'quoted');

      // Project start/end follow the day dates on linked quotes
      const linkedQuotes = await SavedQuote.find({ project: project._id }, { quoteData: 1 });
      await syncProjectDatesFromQuotes(project, linkedQuotes);

      res.json({ success: true });
    } catch (error) {
      console.error('Error linking quote:', error);
      res.status(500).json({ error: 'Failed to link quote' });
    }
  });

  app.post('/api/projects/:id/unlink-quote', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;
      const project = access.project;

      const { quoteName } = req.body;
      const quote = await SavedQuote.findOne({ name: quoteName, project: req.params.id });
      if (!quote) return res.status(404).json({ error: 'Quote not found in this project' });
      quote.project = null;
      await quote.save();

      const remainingQuotes = await SavedQuote.find({ project: project._id }, { quoteData: 1 });
      await syncProjectDatesFromQuotes(project, remainingQuotes);

      res.json({ success: true });
    } catch (error) {
      console.error('Error unlinking quote:', error);
      res.status(500).json({ error: 'Failed to unlink quote' });
    }
  });

  // ----- Project sharing -----

  app.get('/api/projects/:id/shared-with', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { ownerOrAdmin: true });
      if (!access) return;
      res.json(access.project.sharedWith || []);
    } catch (error) {
      console.error('Error fetching project shares:', error);
      res.status(500).json({ error: 'Failed to fetch shared users' });
    }
  });

  app.post('/api/projects/:id/share', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { ownerOrAdmin: true });
      if (!access) return;

      const { userId, accessLevel } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
      if (accessLevel && !['read', 'full'].includes(accessLevel)) {
        return res.status(400).json({ error: 'Invalid access level' });
      }

      const mongoose = require('mongoose');
      const LumQuoteUser = mongoose.model('LumQuoteUser');
      const targetUser = await LumQuoteUser.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      const project = access.project;
      const existingShare = project.sharedWith?.find((s) => s.user?._id?.toString() === userId || s.user?.toString() === userId);
      if (existingShare) {
        existingShare.accessLevel = accessLevel || 'read';
        await project.save();
        return res.json({ success: true, message: 'Access level updated' });
      }

      project.sharedWith = project.sharedWith || [];
      project.sharedWith.push({
        user: userId,
        accessLevel: accessLevel || 'read',
        sharedAt: new Date()
      });
      await project.save();
      res.json({ success: true, message: `Project shared with ${targetUser.name}` });
    } catch (error) {
      console.error('Error sharing project:', error);
      res.status(500).json({ error: 'Failed to share project' });
    }
  });

  app.delete('/api/projects/:id/share/:userId', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { ownerOrAdmin: true });
      if (!access) return;

      const { userId } = req.params;
      const project = access.project;
      project.sharedWith = (project.sharedWith || []).filter((s) => {
        const id = s.user?._id?.toString() || s.user?.toString();
        return id !== userId;
      });
      await project.save();
      res.json({ success: true, message: 'Share access removed' });
    } catch (error) {
      console.error('Error removing project share:', error);
      res.status(500).json({ error: 'Failed to remove share access' });
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
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;

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
      const access = await requireProjectAccess(req, res, contract.project, { minLevel: 'full' });
      if (!access) return;
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
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;
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
      const access = await requireProjectAccess(req, res, contract.project, { minLevel: 'full' });
      if (!access) return;
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

  app.post('/api/contracts/:id/email', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      const access = await requireProjectAccess(req, res, contract.project, { minLevel: 'full' });
      if (!access) return;
      if (contract.status === 'signed') {
        return res.status(400).json({ error: 'Contract is already signed' });
      }

      const project = await notify.loadProjectForNotify(contract.project);
      const email = (req.body?.email || project?.client?.email || '').trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid recipient email is required' });
      }

      if (!contract.publicToken) contract.publicToken = generatePublicToken();
      contract.status = 'sent';
      contract.sentAt = contract.sentAt || new Date();
      await contract.save();

      const baseUrl = getBaseUrl(req);
      const result = await notify.emailContractLink(contract, { email, baseUrl, project });
      if (!result.ok && !result.skipped) {
        return res.status(502).json({ error: result.error || 'Failed to send email' });
      }

      const fresh = await Contract.findById(contract._id);
      res.json({
        success: true,
        link: `${baseUrl}/sign/${fresh.publicToken}`,
        contract: fresh,
        emailedTo: result.to,
        tracking: notify.trackingSummary(fresh)
      });
    } catch (error) {
      console.error('Error emailing contract:', error);
      res.status(500).json({ error: 'Failed to email contract' });
    }
  });

  // Countersign on behalf of the company — allowed at any stage, before or after the client signs
  app.post('/api/contracts/:id/countersign', requireApiAuth, async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      const access = await requireProjectAccess(req, res, contract.project, { minLevel: 'full' });
      if (!access) return;
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
      const access = await requireProjectAccess(req, res, contract.project, { minLevel: 'full' });
      if (!access) return;
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
    if (contract.source === 'uploaded' && contract.uploadedFile?.localPath) {
      try {
        const fileBytes = await fs.promises.readFile(path.join(__dirname, '..', contract.uploadedFile.localPath));
        return crypto.createHash('sha256').update(fileBytes).digest('hex');
      } catch {
        // fall through
      }
    }

    const responses = (contract.fieldResponses || [])
      .map((r) => ({
        fieldId: String(r.fieldId || ''),
        type: r.type || '',
        value: String(r.value || ''),
        label: String(r.label || '')
      }))
      .sort((a, b) => a.fieldId.localeCompare(b.fieldId));

    const hashSource = `${contract.contentHtml || ''}\n---FIELD_RESPONSES---\n${JSON.stringify(responses)}`;
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

      await notify.recordPageView(contract);

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
        clientEmail: project?.client?.email || '',
        projectName: project?.name || '',
        projectDates: formatDateRange(project?.startDate, project?.endDate),
        fieldResponses: contract.fieldResponses || [],
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
      let fieldResponses = [];
      try {
        payload = buildSignaturePayload(req);
        if (contract.source === 'generated') {
          const definedFields = extractContractFields(contract.contentHtml || '');
          fieldResponses = normalizeFieldResponses(req.body.fieldResponses, definedFields);
        }
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      contract.fieldResponses = fieldResponses;
      contract.signature = {
        ...payload,
        documentHash: await contractDocumentHash(contract)
      };
      contract.status = 'signed';
      await contract.save();
      await advanceProjectStatus(contract.project, 'contract_signed');

      const baseUrl = getBaseUrl(req);
      const project = await notify.loadProjectForNotify(contract.project);
      let autoEmailedTo = null;
      try {
        const pdfBuffer = await buildContractPdfBuffer(contract);
        if (project?.client?.email && isValidEmail(project.client.email)) {
          const copyResult = await notify.emailSignedCopy(contract, {
            email: project.client.email,
            baseUrl,
            pdfBuffer,
            auto: true
          });
          console.log('[email] Signed copy:', copyResult.ok ? 'sent' : (copyResult.error || 'skipped'), copyResult.to);
          if (copyResult.ok || copyResult.skipped) {
            autoEmailedTo = project.client.email;
          }
        } else {
          console.warn('[email] No client email for signed copy on project', String(contract.project));
        }
        const staffResult = await notify.notifyStaffContractSigned(contract, { baseUrl });
        console.log('[email] Staff signed notify:', staffResult.ok ? 'sent' : (staffResult.error || 'skipped'), staffResult.to || []);
      } catch (mailError) {
        console.error('[email] Post-sign notifications failed:', mailError.message);
      }

      res.json({
        success: true,
        signedAt: contract.signature.signedAt,
        fieldResponses: contract.fieldResponses,
        autoEmailedTo,
        clientEmail: project?.client?.email || ''
      });
    } catch (error) {
      console.error('Error signing contract:', error);
      res.status(500).json({ error: 'Failed to record signature' });
    }
  });

  app.post('/api/public/contracts/:token/email-copy', async (req, res) => {
    try {
      const contract = await findPublicContract(req.params.token);
      if (!contract) return res.status(404).json({ error: 'Contract not found or no longer available' });
      if (contract.status !== 'signed') {
        return res.status(400).json({ error: 'Contract must be signed before emailing a copy' });
      }
      const email = String(req.body?.email || '').trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      const pdfBuffer = await buildContractPdfBuffer(contract);
      const result = await notify.emailSignedCopy(contract, {
        email,
        baseUrl: getBaseUrl(req),
        pdfBuffer,
        auto: false
      });
      if (!result.ok && !result.skipped) {
        return res.status(502).json({ error: result.error || 'Failed to send email' });
      }
      res.json({ success: true, emailedTo: result.to });
    } catch (error) {
      console.error('Error emailing signed contract copy:', error);
      res.status(500).json({ error: 'Failed to email signed copy' });
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

    let conversion = { lineItems: [], subtotal: 0, discountAmount: 0, discountPercentage: 0, total: 0 };
    if (quote) {
      const serviceCatalog = await loadServiceCatalogForQuoteData(quote.quoteData);
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
      discountPercentage: conversion.discountPercentage || 0,
      total: conversion.total,
      issueDate: todayYmd(),
      dueDate: todayYmd(14),
      createdBy: userRecord?._id || null
    });
  }

  async function loadServiceCatalogForQuoteData(quoteData) {
    const serviceIds = new Set();
    (quoteData?.days || []).forEach((day) => (day.services || []).forEach((s) => {
      const id = s.id != null ? String(s.id) : '';
      // Only real Mongo ids — synthetic rebuild ids like "invoice-line-0" are skipped
      if (/^[a-fA-F0-9]{24}$/.test(id)) serviceIds.add(id);
    }));
    const serviceCatalog = new Map();
    if (serviceIds.size > 0) {
      const catalogServices = await Service.find({ _id: { $in: [...serviceIds] } }, { description: 1 });
      catalogServices.forEach((s) => serviceCatalog.set(String(s._id), s.description || ''));
    }
    return serviceCatalog;
  }

  app.post('/api/projects/:id/invoices', requireApiAuth, async (req, res) => {
    try {
      const access = await requireProjectAccess(req, res, req.params.id, { minLevel: 'full' });
      if (!access) return;
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

  // Convert an unlinked quote into a new project (status quoted)
  app.post('/api/quotes/:name/convert-to-project', requireApiAuth, async (req, res) => {
    try {
      const quote = await SavedQuote.findOne({ name: req.params.name });
      if (!quote) return res.status(404).json({ error: 'Quote not found' });
      if (quote.project) {
        return res.status(400).json({
          error: 'This quote is already linked to a project.',
          projectId: quote.project
        });
      }

      let client = null;
      if (quote.clientName && quote.clientName.trim()) {
        const escaped = quote.clientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        client = await Client.findOne({ name: new RegExp(`^${escaped}$`, 'i') });
        if (!client) client = await Client.create({ name: quote.clientName.trim() });
      }

      const { startDate, endDate } = quoteDateRange(quote.quoteData);
      const project = await Project.create({
        name: quote.quoteData?.quoteTitle || quote.name,
        client: client ? client._id : null,
        status: 'quoted',
        startDate,
        endDate,
        archived: !!quote.archived,
        createdBy: quote.createdBy || null
      });

      quote.project = project._id;
      await quote.save();

      res.status(201).json({ success: true, projectId: project._id });
    } catch (error) {
      console.error('Error converting quote to project:', error);
      res.status(500).json({ error: 'Failed to convert quote to project' });
    }
  });

  // Convert a quote to an invoice — quote must already belong to a project
  app.post('/api/quotes/:name/convert-to-invoice', requireApiAuth, async (req, res) => {
    try {
      const quote = await SavedQuote.findOne({ name: req.params.name });
      if (!quote) return res.status(404).json({ error: 'Quote not found' });

      const project = quote.project ? await Project.findById(quote.project) : null;
      if (!project) {
        return res.status(400).json({
          error: 'Link this quote to a project first, then convert it to an invoice.'
        });
      }

      const access = await requireProjectAccess(req, res, project._id, { minLevel: 'full' });
      if (!access) return;

      const invoice = await createInvoiceFromQuote({ project, quote, user: req.user });
      res.status(201).json({ success: true, projectId: project._id, invoiceId: invoice._id });
    } catch (error) {
      console.error('Error converting quote to invoice:', error);
      res.status(500).json({ error: 'Failed to convert quote to invoice' });
    }
  });

  app.get('/api/invoices', requireApiAuth, async (req, res) => {
    try {
      const { search, status, when, sortBy, sortDir } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const skip = (page - 1) * limit;
      const today = todayYmd();

      const query = {};
      const and = [];

      if (req.user.role !== 'admin') {
        const projectIds = await getAccessibleProjectIds(req.user);
        if (!projectIds.length) {
          return res.json({ invoices: [], total: 0, page, limit, totalPages: 1 });
        }
        and.push({ project: { $in: projectIds } });
      }

      if (status && ['draft', 'sent', 'paid', 'void'].includes(status)) {
        query.status = status;
      }

      // Past = due before today. Upcoming (default) = undated or due today/future. All = no date filter.
      if (when === 'past') {
        and.push({
          dueDate: { $exists: true, $nin: [null, ''], $lt: today }
        });
      } else if (when !== 'all') {
        and.push({
          $or: [
            { dueDate: { $exists: false } },
            { dueDate: null },
            { dueDate: '' },
            { dueDate: { $gte: today } }
          ]
        });
      }

      if (search && String(search).trim()) {
        const raw = String(search).trim();
        const regex = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const matchingClients = await Client.find(
          { $or: [{ name: regex }, { company: regex }] },
          { _id: 1 }
        );
        const clientIds = matchingClients.map((c) => c._id);
        const matchingProjects = await Project.find(
          {
            $or: [
              { name: regex },
              ...(clientIds.length ? [{ client: { $in: clientIds } }] : [])
            ]
          },
          { _id: 1 }
        );
        const projectIds = matchingProjects.map((p) => p._id);
        and.push({
          $or: [
            { invoiceNumber: regex },
            { subtitle: regex },
            { 'to.name': regex },
            { 'to.company': regex },
            ...(projectIds.length ? [{ project: { $in: projectIds } }] : [])
          ]
        });
      }

      if (and.length) query.$and = and;

      const sortFieldMap = {
        invoiceNumber: 'invoiceNumber',
        status: 'status',
        dueDate: 'dueDate',
        issueDate: 'issueDate',
        total: 'total',
        amountPaid: 'amountPaid',
        createdAt: 'createdAt'
      };

      let invoices;
      const total = await Invoice.countDocuments(query);

      if (sortBy === 'owner') {
        const direction = sortDir === 'asc' ? 1 : -1;
        const sortedIds = await Invoice.aggregate([
          { $match: query },
          {
            $lookup: {
              from: 'users',
              localField: 'createdBy',
              foreignField: '_id',
              as: 'ownerDoc'
            }
          },
          {
            $addFields: {
              _ownerName: {
                $toLower: { $ifNull: [{ $arrayElemAt: ['$ownerDoc.name', 0] }, ''] }
              }
            }
          },
          { $sort: { _ownerName: direction, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { _id: 1 } }
        ]);
        const found = await Invoice.find({ _id: { $in: sortedIds.map((d) => d._id) } })
          .populate('project', 'name client startDate endDate')
          .populate('createdBy', 'name');
        const byId = new Map(found.map((inv) => [String(inv._id), inv]));
        invoices = sortedIds.map((d) => byId.get(String(d._id))).filter(Boolean);
      } else {
        const dbSort = sortFieldMap[sortBy] || 'createdAt';
        const direction = sortDir === 'asc' ? 1 : -1;
        const sortObj = { [dbSort]: direction };
        if (dbSort !== 'createdAt') sortObj.createdAt = -1;

        invoices = await Invoice.find(query)
          .populate('project', 'name client startDate endDate')
          .populate('createdBy', 'name')
          .sort(sortObj)
          .skip(skip)
          .limit(limit);
      }

      const clientIds = [...new Set(
        invoices
          .map((inv) => inv.project?.client)
          .filter(Boolean)
          .map((id) => String(id))
      )];
      const clients = clientIds.length
        ? await Client.find({ _id: { $in: clientIds } }, { name: 1, company: 1 })
        : [];
      const clientById = new Map(clients.map((c) => [String(c._id), c]));

      const items = await Promise.all(invoices.map(async (inv) => {
        const projectDoc = inv.project;
        const projectId = projectDoc?._id || inv.project;
        const clientDoc = projectDoc?.client
          ? clientById.get(String(projectDoc.client))
          : null;

        let client = null;
        if (clientDoc) {
          client = { _id: clientDoc._id, name: clientDoc.name, company: clientDoc.company || '' };
        } else if (inv.to?.name || inv.to?.company) {
          client = {
            _id: null,
            name: inv.to.name || inv.to.company || '',
            company: inv.to.company || ''
          };
        }

        const amountPaid = Number(inv.amountPaid) || 0;
        const totalAmt = Number(inv.total) || 0;
        const installments = await buildInstallmentSchedule(inv);
        let plan = null;
        if (installments && installments.length) {
          const paidCount = installments.filter((i) => i.status === 'paid').length;
          plan = {
            paidCount,
            totalCount: installments.length,
            amountPaid,
            total: totalAmt,
            installments
          };
        }

        return {
          _id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          subtitle: inv.subtitle || '',
          status: inv.status,
          issueDate: inv.issueDate || null,
          dueDate: inv.dueDate || null,
          createdAt: inv.createdAt || null,
          createdBy: inv.createdBy
            ? { _id: inv.createdBy._id, name: inv.createdBy.name || '' }
            : null,
          total: totalAmt,
          amountPaid,
          balance: Math.max(0, Math.round((totalAmt - amountPaid) * 100) / 100),
          client,
          project: projectId
            ? { _id: projectId, name: projectDoc?.name || 'Project' }
            : null,
          plan
        };
      }));

      res.json({
        invoices: items,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit))
      });
    } catch (error) {
      console.error('Error listing invoices:', error);
      res.status(500).json({ error: 'Failed to fetch invoices' });
    }
  });

  app.get('/api/invoices/:id', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id).populate('sourceQuote', 'name');
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'read' });
      if (!access) return;
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch invoice' });
    }
  });

  app.put('/api/invoices/:id', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
      if (invoice.status === 'paid' || invoice.status === 'void') {
        return res.status(400).json({ error: `${invoice.status === 'paid' ? 'Paid' : 'Void'} invoices cannot be edited` });
      }

      const editable = ['from', 'to', 'subtitle', 'headerNote', 'footerNote', 'issueDate', 'dueDate'];
      editable.forEach((field) => {
        if (req.body[field] !== undefined) invoice[field] = req.body[field];
      });

      if (Array.isArray(req.body.lineItems)) {
        invoice.lineItems = req.body.lineItems.map((item) => normalizeInvoiceLineItem(item));
      }
      if (req.body.discountAmount !== undefined) {
        invoice.discountAmount = Math.max(0, Number(req.body.discountAmount) || 0);
      }
      if (req.body.discountPercentage !== undefined) {
        invoice.discountPercentage = Math.max(0, Number(req.body.discountPercentage) || 0);
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

  app.get('/api/invoices/:id/quote-editor-data', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
      if (invoice.status === 'paid' || invoice.status === 'void') {
        return res.status(400).json({
          error: `${invoice.status === 'paid' ? 'Paid' : 'Void'} invoices cannot be opened in the quote editor`
        });
      }
      const quoteData = buildQuoteDataFromInvoice(invoice);
      res.json({
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        projectId: invoice.project,
        status: invoice.status,
        quoteData
      });
    } catch (error) {
      console.error('Error building quote editor data:', error);
      res.status(500).json({ error: 'Failed to prepare quote editor data' });
    }
  });

  app.post('/api/invoices/:id/commit-from-quote', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
      if (invoice.status === 'paid' || invoice.status === 'void') {
        return res.status(400).json({
          error: `${invoice.status === 'paid' ? 'Paid' : 'Void'} invoices cannot be edited`
        });
      }

      const quoteData = req.body?.quoteData;
      if (!quoteData || typeof quoteData !== 'object') {
        return res.status(400).json({ error: 'quoteData is required' });
      }

      const serviceCatalog = await loadServiceCatalogForQuoteData(quoteData);
      const conversion = buildInvoiceLineItemsFromQuote(quoteData, serviceCatalog);
      const previousTotal = invoice.total;
      const hasPaidInstallment = (invoice.paymentPlan?.installments || []).some((i) => i.status === 'paid');

      if (hasPaidInstallment && Math.abs((conversion.total || 0) - (previousTotal || 0)) > 0.009) {
        return res.status(400).json({
          error: 'Invoice total cannot change after a payment plan installment has been paid'
        });
      }

      invoice.lineItems = conversion.lineItems;
      invoice.subtotal = conversion.subtotal;
      invoice.discountAmount = conversion.discountAmount;
      invoice.discountPercentage = conversion.discountPercentage || 0;
      invoice.total = conversion.total;

      if (hasPaymentPlan(invoice) && !hasPaidInstallment) {
        try {
          invoice.paymentPlan = normalizePaymentPlan(invoice.paymentPlan, invoice.total);
        } catch (planError) {
          return res.status(400).json({ error: planError.message });
        }
      }

      await invoice.save();
      res.json({ success: true, invoice });
    } catch (error) {
      console.error('Error committing invoice from quote:', error);
      res.status(500).json({ error: 'Failed to commit invoice from quote editor' });
    }
  });

  app.post('/api/invoices/:id/send', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
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

  app.post('/api/invoices/:id/email', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
      if (invoice.status === 'void') return res.status(400).json({ error: 'Void invoices cannot be emailed' });

      const project = await notify.loadProjectForNotify(invoice.project);
      const email = (req.body?.email || invoice.to?.email || project?.client?.email || '').trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid recipient email is required' });
      }

      if (!invoice.publicToken) invoice.publicToken = generatePublicToken();
      if (invoice.status === 'draft') invoice.status = 'sent';
      invoice.sentAt = invoice.sentAt || new Date();
      await invoice.save();
      await advanceProjectStatus(invoice.project, 'invoiced');

      const baseUrl = getBaseUrl(req);
      const result = await notify.emailInvoiceLink(invoice, { email, baseUrl, project });
      if (!result.ok && !result.skipped) {
        return res.status(502).json({ error: result.error || 'Failed to send email' });
      }

      const fresh = await Invoice.findById(invoice._id);
      res.json({
        success: true,
        link: `${baseUrl}/invoice/${fresh.publicToken}`,
        invoice: fresh,
        emailedTo: result.to,
        tracking: notify.trackingSummary(fresh)
      });
    } catch (error) {
      console.error('Error emailing invoice:', error);
      res.status(500).json({ error: 'Failed to email invoice' });
    }
  });

  app.post('/api/invoices/:id/mark-paid', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
      if (invoice.status === 'void') return res.status(400).json({ error: 'Void invoices cannot be marked paid' });
      const wasPaid = invoice.status === 'paid';
      const paidAt = req.body?.paidDate != null
        ? parsePaidDateInput(req.body.paidDate)
        : new Date();
      if (req.body?.paidDate != null && !paidAt) {
        return res.status(400).json({ error: 'paidDate must be YYYY-MM-DD' });
      }
      await markInvoicePaid(invoice, { paidAt });
      if (!wasPaid) {
        await notifyAfterInvoicePayment(invoice, { baseUrl: getBaseUrl(req) });
      }
      res.json({ success: true, invoice });
    } catch (error) {
      console.error('Error marking invoice paid:', error);
      res.status(500).json({ error: 'Failed to mark invoice paid' });
    }
  });

  app.post('/api/invoices/:id/mark-installment-paid', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
      if (invoice.status === 'void') return res.status(400).json({ error: 'Void invoices cannot record payments' });
      if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice is already paid' });
      if (!invoice.paymentPlan?.enabled) {
        return res.status(400).json({ error: 'This invoice does not have a payment plan' });
      }
      const index = Number(req.body?.index);
      if (!Number.isInteger(index) || index < 0) {
        return res.status(400).json({ error: 'Valid installment index is required' });
      }
      const inst = invoice.paymentPlan.installments?.[index];
      if (!inst) return res.status(404).json({ error: 'Installment not found' });
      if (inst.status === 'paid') return res.status(400).json({ error: 'This installment is already paid' });

      // Sent invoices only for staff offline payments (drafts should be sent first)
      if (invoice.status === 'draft') {
        return res.status(400).json({ error: 'Send the invoice before recording payments' });
      }

      const paidAt = req.body?.paidDate != null
        ? parsePaidDateInput(req.body.paidDate)
        : new Date();
      if (req.body?.paidDate != null && !paidAt) {
        return res.status(400).json({ error: 'paidDate must be YYYY-MM-DD' });
      }

      await markInstallmentPaid(invoice, index, { paidAt });
      const fresh = await Invoice.findById(invoice._id);
      await notifyAfterInvoicePayment(fresh, { baseUrl: getBaseUrl(req), installmentIndex: index });
      res.json({ success: true, invoice: fresh });
    } catch (error) {
      console.error('Error marking installment paid:', error);
      res.status(500).json({ error: 'Failed to mark installment paid' });
    }
  });

  app.post('/api/invoices/:id/void', requireApiAuth, async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
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
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'full' });
      if (!access) return;
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
      const access = await requireProjectAccess(req, res, invoice.project, { minLevel: 'read' });
      if (!access) return;
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
      await notify.recordPageView(invoice);
      res.json(await publicInvoiceJson(invoice));
    } catch (error) {
      console.error('Error loading public invoice:', error);
      res.status(500).json({ error: 'Failed to load invoice' });
    }
  });

  app.post('/api/public/invoices/:token/email-copy', async (req, res) => {
    try {
      const invoice = await findPublicInvoice(req.params.token);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found or no longer available' });
      const email = String(req.body?.email || '').trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      const baseUrl = getBaseUrl(req);
      const pdfBuffer = await buildInvoicePdfBuffer(invoice);
      let result;
      if (invoice.status === 'paid') {
        result = await notify.emailInvoiceReceipt(invoice, {
          email,
          baseUrl,
          pdfBuffer,
          auto: false
        });
      } else {
        result = await notify.emailInvoiceLink(invoice, { email, baseUrl });
      }
      if (!result.ok && !result.skipped) {
        return res.status(502).json({ error: result.error || 'Failed to send email' });
      }
      res.json({ success: true, emailedTo: result.to });
    } catch (error) {
      console.error('Error emailing invoice copy:', error);
      res.status(500).json({ error: 'Failed to email invoice' });
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
  // Also re-runs notify when already paid — production webhooks share this MongoDB
  // and can mark paid before local confirm runs (skipping emails on this server).
  app.get('/api/public/invoices/:token/confirm', async (req, res) => {
    try {
      const stripe = getStripe();
      const sessionId = req.query.session_id;
      const invoice = await findPublicInvoice(req.params.token);
      if (!invoice || !stripe || !sessionId) {
        return res.json({ paid: invoice ? invoice.status === 'paid' : false });
      }

      const session = await stripe.checkout.sessions.retrieve(String(sessionId));
      const belongsToInvoice = session?.metadata?.invoiceId === String(invoice._id);
      if (!belongsToInvoice) {
        return res.json({ paid: invoice.status === 'paid' });
      }
      if (session.payment_status === 'paid') {
        await settleStripeSession(invoice, session, { baseUrl: getBaseUrl(req) });
        const fresh = await Invoice.findById(invoice._id);
        return res.json({ paid: fresh?.status === 'paid', updated: true });
      }
      res.json({ paid: invoice.status === 'paid' });
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
            await settleStripeSession(invoice, session, { baseUrl: getBaseUrl(req) });
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

  // SendGrid Event Webhook — enable "Open" events at:
  // {APP_BASE_URL}/api/sendgrid/webhook  (custom args: docType, docId, logId)
  app.post('/api/sendgrid/webhook', async (req, res) => {
    try {
      const events = Array.isArray(req.body) ? req.body : [req.body];
      const updated = await notify.applySendGridOpenEvents(events.filter(Boolean));
      res.status(200).json({ received: true, updated });
    } catch (error) {
      console.error('SendGrid webhook error:', error);
      res.status(200).json({ received: true });
    }
  });
};
