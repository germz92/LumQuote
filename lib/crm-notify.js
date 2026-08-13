/**
 * CRM email notifications + tracking helpers (SendGrid).
 */

const mongoose = require('mongoose');
const { Project, Contract, Invoice, getCompanySettings } = require('./crm-models');
const { sendEmail, wrapEmailHtml, isValidEmail } = require('./email');

function lumQuoteUserModel() {
  return mongoose.model('LumQuoteUser');
}

function userModel() {
  return mongoose.model('User');
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function pushEmailLog(doc, entry) {
  if (!doc.emailLog) doc.emailLog = [];
  const logEntry = {
    type: entry.type,
    to: entry.to || [],
    subject: entry.subject || '',
    providerMessageId: entry.providerMessageId || null,
    sentAt: entry.sentAt || new Date(),
    openedAt: null,
    openCount: 0,
    meta: entry.meta || {}
  };
  doc.emailLog.push(logEntry);
  return doc.emailLog[doc.emailLog.length - 1];
}

function hasEmailLog(doc, type, metaMatch = null) {
  return (doc.emailLog || []).some((e) => {
    if (e.type !== type) return false;
    if (metaMatch && metaMatch.installmentIndex != null) {
      return Number(e.meta?.installmentIndex) === Number(metaMatch.installmentIndex);
    }
    return true;
  });
}

async function recordPageView(doc) {
  if (!doc) return;
  const now = new Date();
  if (!doc.firstViewedAt) doc.firstViewedAt = now;
  doc.lastViewedAt = now;
  doc.viewCount = (doc.viewCount || 0) + 1;
  await doc.save();
}

async function findEmailFromLumDashByName(name) {
  if (!name || mongoose.connection.readyState !== 1) return null;
  try {
    const dbName = process.env.LUMDASH_DB_NAME || 'test';
    const collection = mongoose.connection.getClient().db(dbName).collection('users');
    const doc = await collection.findOne(
      { $or: [{ fullName: name }, { name }] },
      { projection: { email: 1 } }
    );
    const email = String(doc?.email || '').trim().toLowerCase();
    return isValidEmail(email) ? email : null;
  } catch (error) {
    console.warn('[email] LumDash email lookup failed:', error.message);
    return null;
  }
}

async function resolveEmailForStaffName(name, lumQuoteUser = null) {
  if (!name && !lumQuoteUser) return null;

  let email = String(lumQuoteUser?.email || '').trim().toLowerCase();
  if (isValidEmail(email)) return email;

  // LumQuoteUser records often lack email (SSO token may omit it) — try LumDash
  email = await findEmailFromLumDashByName(name || lumQuoteUser?.name);
  if (email && lumQuoteUser?._id) {
    try {
      await lumQuoteUserModel().updateOne(
        { _id: lumQuoteUser._id },
        { $set: { email } }
      );
    } catch {
      // best-effort cache
    }
  }
  return email;
}

function envStaffNotifyEmails() {
  const raw = process.env.STAFF_NOTIFY_EMAILS || process.env.STAFF_NOTIFY_EMAIL || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(isValidEmail);
}

async function resolveStaffNotifyEmails(project) {
  if (!project) return [];
  const emails = new Set();

  // Owner: createdBy (User name) → LumQuoteUser.email → LumDash email
  let ownerName = null;
  if (project.createdBy) {
    if (typeof project.createdBy === 'object' && project.createdBy.name) {
      ownerName = project.createdBy.name;
    } else {
      const owner = await userModel().findById(project.createdBy).select('name').lean();
      ownerName = owner?.name || null;
    }
  }
  if (ownerName) {
    const ownerUser = await lumQuoteUserModel().findOne({
      $or: [{ name: ownerName }, { fullName: ownerName }]
    }).select('email name').lean();
    const ownerEmail = await resolveEmailForStaffName(ownerName, ownerUser);
    if (ownerEmail) emails.add(ownerEmail);
  }

  // Full-access shares
  const shares = project.sharedWith || [];
  for (const share of shares) {
    if (share.accessLevel !== 'full') continue;
    let shareUser = null;
    if (share.user && typeof share.user === 'object') {
      shareUser = share.user;
    } else if (share.user) {
      shareUser = await lumQuoteUserModel().findById(share.user).select('email name').lean();
    }
    const shareEmail = await resolveEmailForStaffName(shareUser?.name, shareUser);
    if (shareEmail) emails.add(shareEmail);
  }

  // All LumQuote admins (sign / pay alerts)
  const admins = await lumQuoteUserModel().find({ role: 'admin' }).select('email name').lean();
  for (const admin of admins) {
    const adminEmail = await resolveEmailForStaffName(admin.name, admin);
    if (adminEmail) emails.add(adminEmail);
  }

  // Explicit env overrides (always included)
  for (const email of envStaffNotifyEmails()) emails.add(email);

  // Company inbox fallback when no owner/share emails resolved
  if (emails.size === 0) {
    try {
      const settings = await getCompanySettings();
      const companyEmail = String(settings?.email || '').trim().toLowerCase();
      if (isValidEmail(companyEmail)) emails.add(companyEmail);
    } catch {
      // ignore
    }
  }

  if (emails.size === 0) {
    console.warn('[email] No staff notify emails resolved for project', String(project._id || ''));
  }

  return [...emails];
}

async function loadProjectForNotify(projectId) {
  return Project.findById(projectId)
    .populate('client')
    .populate('createdBy', 'name')
    .populate('sharedWith.user', 'name email');
}

function syncDocFrom(target, doc) {
  if (!target || !doc) return;
  doc.emailLog = target.emailLog;
  if (typeof target.__v === 'number') doc.__v = target.__v;
  if (target.sentAt != null) doc.sentAt = target.sentAt;
  if (target.firstViewedAt != null) doc.firstViewedAt = target.firstViewedAt;
  if (target.lastViewedAt != null) doc.lastViewedAt = target.lastViewedAt;
  if (target.viewCount != null) doc.viewCount = target.viewCount;
}

async function sendAndLog(doc, {
  type,
  to,
  subject,
  html,
  text,
  attachments,
  docType,
  meta
}) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(isValidEmail);
  if (recipients.length === 0) {
    return { ok: false, skipped: true, error: 'No valid recipients', to: [] };
  }

  // Always append on a freshly loaded doc so sequential emails don't hit VersionError
  const Model = doc.constructor;
  let target = Model?.findById ? await Model.findById(doc._id) : null;
  if (!target) target = doc;

  const pending = pushEmailLog(target, {
    type,
    to: recipients,
    subject,
    meta: meta || {}
  });
  await target.save();
  syncDocFrom(target, doc);

  const logId = String(pending._id);
  const result = await sendEmail({
    to: recipients,
    subject,
    html,
    text,
    attachments,
    customArgs: {
      docType: docType || 'unknown',
      docId: String(doc._id),
      logId
    }
  });

  // Refresh again before writing providerMessageId
  target = Model?.findById ? await Model.findById(doc._id) : target;
  const entry = (target.emailLog || []).id
    ? target.emailLog.id(logId)
    : (target.emailLog || []).find((e) => String(e._id) === logId);
  if (entry) {
    entry.providerMessageId = result.messageId || entry.providerMessageId;
    if (!result.ok && !result.skipped) {
      entry.meta = { ...(entry.meta.toObject?.() || entry.meta || {}), error: result.error || 'send_failed' };
    }
    await target.save();
    syncDocFrom(target, doc);
  }

  return { ...result, logId, to: recipients };
}

async function emailContractLink(contract, { email, baseUrl, project }) {
  const proj = project || await loadProjectForNotify(contract.project);
  const to = email || proj?.client?.email;
  if (!contract.publicToken) {
    throw new Error('Contract has no public link');
  }
  const link = `${baseUrl}/sign/${contract.publicToken}`;
  const company = (await getCompanySettings()).companyName || 'Lumetry Media';
  const html = wrapEmailHtml({
    title: 'Please review and sign your agreement',
    bodyHtml: `<p>Hi${proj?.client?.name ? ` ${proj.client.name}` : ''},</p>
      <p>${company} has sent you a contract for <strong>${proj?.name || contract.title || 'your project'}</strong>.</p>
      <p>Open the link below to review and sign.</p>`,
    ctaLabel: 'Review & Sign',
    ctaUrl: link,
    footer: `If the button does not work, open: ${link}`
  });
  return sendAndLog(contract, {
    type: 'sent_link',
    to,
    subject: `Contract ready to sign — ${proj?.name || contract.title || 'Agreement'}`,
    html,
    docType: 'contract'
  });
}

async function emailInvoiceLink(invoice, { email, baseUrl, project }) {
  const proj = project || await loadProjectForNotify(invoice.project);
  const to = email || invoice.to?.email || proj?.client?.email;
  if (!invoice.publicToken) {
    throw new Error('Invoice has no public link');
  }
  const link = `${baseUrl}/invoice/${invoice.publicToken}`;
  const company = (await getCompanySettings()).companyName || 'Lumetry Media';
  const html = wrapEmailHtml({
    title: `Invoice ${invoice.invoiceNumber}`,
    bodyHtml: `<p>Hi${invoice.to?.name ? ` ${invoice.to.name}` : ''},</p>
      <p>${company} has sent invoice <strong>${invoice.invoiceNumber}</strong>
      for <strong>${formatMoney(invoice.total)}</strong>${proj?.name ? ` (${proj.name})` : ''}.</p>
      <p>You can view and pay online using the button below.</p>`,
    ctaLabel: 'View Invoice',
    ctaUrl: link,
    footer: `If the button does not work, open: ${link}`
  });
  return sendAndLog(invoice, {
    type: 'sent_link',
    to,
    subject: `Invoice ${invoice.invoiceNumber} — ${formatMoney(invoice.total)}`,
    html,
    docType: 'invoice'
  });
}

async function emailSignedCopy(contract, { email, baseUrl, pdfBuffer, auto = false }) {
  const proj = await loadProjectForNotify(contract.project);
  const to = email || proj?.client?.email;
  const link = contract.publicToken ? `${baseUrl}/sign/${contract.publicToken}` : baseUrl;
  const pdfLink = contract.publicToken ? `${baseUrl}/api/public/contracts/${contract.publicToken}/pdf` : link;
  const attachments = pdfBuffer
    ? [{ content: pdfBuffer, filename: `${(contract.title || 'contract').replace(/[^a-z0-9-_]+/gi, '_')}.pdf`, type: 'application/pdf' }]
    : [];
  const html = wrapEmailHtml({
    title: 'Your signed agreement',
    bodyHtml: `<p>Thank you for signing.</p>
      <p>Your signed copy of <strong>${contract.title || 'the agreement'}</strong>
      ${proj?.name ? ` for ${proj.name}` : ''} is attached${attachments.length ? '' : ' (or available via the link below)'}.</p>`,
    ctaLabel: attachments.length ? null : 'Download PDF',
    ctaUrl: attachments.length ? null : pdfLink,
    footer: `Download anytime: ${pdfLink}`
  });
  return sendAndLog(contract, {
    type: auto ? 'signed_copy' : 'copy_request',
    to,
    subject: `Signed copy — ${contract.title || 'Agreement'}`,
    html,
    attachments,
    docType: 'contract'
  });
}

async function emailInvoiceReceipt(invoice, { email, baseUrl, pdfBuffer, installmentIndex = null, auto = false }) {
  if (auto) {
    const type = installmentIndex != null ? 'receipt_installment' : 'receipt';
    const match = installmentIndex != null ? { installmentIndex } : null;
    if (hasEmailLog(invoice, type, match)) {
      return { ok: true, skipped: true, to: [], error: 'already_sent' };
    }
  }
  const proj = await loadProjectForNotify(invoice.project);
  const to = email || invoice.to?.email || proj?.client?.email;
  const link = invoice.publicToken ? `${baseUrl}/invoice/${invoice.publicToken}` : baseUrl;
  const pdfLink = invoice.publicToken ? `${baseUrl}/api/public/invoices/${invoice.publicToken}/pdf` : link;
  const inst = installmentIndex != null ? invoice.paymentPlan?.installments?.[installmentIndex] : null;
  const amount = inst ? inst.amount : invoice.total;
  const label = inst
    ? `Payment received for ${inst.label || `installment ${installmentIndex + 1}`} (${formatMoney(amount)})`
    : `Payment received in full (${formatMoney(invoice.total)})`;
  const attachments = pdfBuffer
    ? [{ content: pdfBuffer, filename: `${invoice.invoiceNumber}-receipt.pdf`, type: 'application/pdf' }]
    : [];
  const html = wrapEmailHtml({
    title: 'Payment receipt',
    bodyHtml: `<p>Thank you for your payment.</p>
      <p>${label} on invoice <strong>${invoice.invoiceNumber}</strong>${proj?.name ? ` (${proj.name})` : ''}.</p>`,
    ctaLabel: 'View Invoice',
    ctaUrl: link,
    footer: `PDF: ${pdfLink}`
  });
  return sendAndLog(invoice, {
    type: auto ? (inst ? 'receipt_installment' : 'receipt') : 'copy_request',
    to,
    subject: `Receipt — Invoice ${invoice.invoiceNumber}`,
    html,
    attachments,
    docType: 'invoice',
    meta: installmentIndex != null ? { installmentIndex } : {}
  });
}

async function notifyStaffContractSigned(contract, { baseUrl, force = false }) {
  const proj = await loadProjectForNotify(contract.project);
  const to = await resolveStaffNotifyEmails(proj);
  if (to.length === 0) return { ok: false, skipped: true, to: [], error: 'No staff recipients' };
  if (!force && hasEmailLog(contract, 'owner_signed')) return { ok: true, skipped: true, to };

  const signer = contract.signature?.name || 'Client';
  const docLink = contract.publicToken
    ? `${baseUrl}/sign/${contract.publicToken}`
    : `${baseUrl}/projects/${contract.project}?tab=contract`;
  const projectLink = `${baseUrl}/projects/${contract.project}?tab=contract`;
  const html = wrapEmailHtml({
    title: 'Contract signed',
    bodyHtml: `<p><strong>${signer}</strong> signed the contract
      for <strong>${proj?.name || 'a project'}</strong>.</p>`,
    ctaLabel: 'View Signed Contract',
    ctaUrl: docLink,
    footer: `Open in LumQuote: ${projectLink}`
  });
  return sendAndLog(contract, {
    type: 'owner_signed',
    to,
    subject: `Signed — ${proj?.name || contract.title || 'Contract'}`,
    html,
    docType: 'contract'
  });
}

async function notifyStaffInvoicePaid(invoice, { baseUrl, installmentIndex = null, force = false }) {
  const proj = await loadProjectForNotify(invoice.project);
  const to = await resolveStaffNotifyEmails(proj);
  if (to.length === 0) return { ok: false, skipped: true, to: [], error: 'No staff recipients' };

  const isFull = invoice.status === 'paid' && installmentIndex == null;
  const type = isFull ? 'owner_paid' : 'owner_paid_installment';
  if (!force && isFull && hasEmailLog(invoice, 'owner_paid')) return { ok: true, skipped: true, to };
  if (!force && !isFull && hasEmailLog(invoice, 'owner_paid_installment', { installmentIndex })) {
    return { ok: true, skipped: true, to };
  }

  const inst = installmentIndex != null ? invoice.paymentPlan?.installments?.[installmentIndex] : null;
  const amount = inst ? inst.amount : invoice.total;
  const detail = inst
    ? `${inst.label || 'Installment'} of ${formatMoney(amount)} paid`
    : `Invoice paid in full (${formatMoney(invoice.total)})`;
  const docLink = invoice.publicToken
    ? `${baseUrl}/invoice/${invoice.publicToken}`
    : `${baseUrl}/projects/${invoice.project}?invoice=${invoice._id}`;
  const projectLink = `${baseUrl}/projects/${invoice.project}?invoice=${invoice._id}`;
  const html = wrapEmailHtml({
    title: 'Payment received',
    bodyHtml: `<p>${detail} on <strong>${invoice.invoiceNumber}</strong>
      ${proj?.name ? `for ${proj.name}` : ''}.</p>`,
    ctaLabel: 'View Invoice',
    ctaUrl: docLink,
    footer: `Open in LumQuote: ${projectLink}`
  });
  return sendAndLog(invoice, {
    type,
    to,
    subject: `Paid — ${invoice.invoiceNumber}${proj?.name ? ` (${proj.name})` : ''}`,
    html,
    docType: 'invoice',
    meta: installmentIndex != null ? { installmentIndex } : {}
  });
}

async function applySendGridOpenEvents(events) {
  let updated = 0;
  for (const event of events || []) {
    if (event.event !== 'open') continue;
    const docType = event.docType || event.doctType;
    const docId = event.docId;
    const logId = event.logId;
    const messageId = event.sg_message_id || event['smtp-id'];

    let Model = null;
    if (docType === 'contract') Model = Contract;
    else if (docType === 'invoice') Model = Invoice;
    if (!Model) continue;

    let doc = null;
    if (docId && mongoose.Types.ObjectId.isValid(docId)) {
      doc = await Model.findById(docId);
    }
    if (!doc && messageId) {
      doc = await Model.findOne({ 'emailLog.providerMessageId': String(messageId).split('.')[0] });
    }
    if (!doc) continue;

    let entry = null;
    if (logId) entry = doc.emailLog.id(logId);
    if (!entry && messageId) {
      const mid = String(messageId).split('.')[0];
      entry = (doc.emailLog || []).find((e) => e.providerMessageId && String(e.providerMessageId).startsWith(mid));
    }
    if (!entry) continue;

    const when = event.timestamp ? new Date(event.timestamp * 1000) : new Date();
    if (!entry.openedAt) entry.openedAt = when;
    entry.openCount = (entry.openCount || 0) + 1;
    await doc.save();
    updated += 1;
  }
  return updated;
}

function latestEmailOpenedAt(doc) {
  const times = (doc.emailLog || [])
    .filter((e) => e.openedAt)
    .map((e) => new Date(e.openedAt).getTime())
    .filter((t) => !isNaN(t));
  if (!times.length) return null;
  return new Date(Math.max(...times));
}

function trackingSummary(doc) {
  return {
    sentAt: doc.sentAt || null,
    firstViewedAt: doc.firstViewedAt || null,
    lastViewedAt: doc.lastViewedAt || null,
    viewCount: doc.viewCount || 0,
    emailOpenedAt: latestEmailOpenedAt(doc),
    emailLog: (doc.emailLog || []).map((e) => ({
      type: e.type,
      to: e.to,
      subject: e.subject,
      sentAt: e.sentAt,
      openedAt: e.openedAt,
      openCount: e.openCount || 0
    }))
  };
}

module.exports = {
  isValidEmail,
  recordPageView,
  resolveStaffNotifyEmails,
  loadProjectForNotify,
  emailContractLink,
  emailInvoiceLink,
  emailSignedCopy,
  emailInvoiceReceipt,
  notifyStaffContractSigned,
  notifyStaffInvoicePaid,
  applySendGridOpenEvents,
  trackingSummary,
  hasEmailLog,
  formatMoney
};
