/**
 * SendGrid mail wrapper. No-ops with a warning when SENDGRID_API_KEY is missing.
 */

const sgMail = require('@sendgrid/mail');

let configured = false;

function ensureConfigured() {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return false;
  if (!configured) {
    sgMail.setApiKey(key);
    configured = true;
  }
  return true;
}

function fromAddress() {
  return {
    email: process.env.SENDGRID_FROM_EMAIL || 'noreply@lumetrymedia.com',
    name: process.env.SENDGRID_FROM_NAME || 'Lumetry Media'
  };
}

function normalizeEmails(to) {
  const list = Array.isArray(to) ? to : [to];
  return [...new Set(list.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * @param {object} options
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {string} [options.text]
 * @param {object} [options.customArgs] - docType, docId, logId for Event Webhook
 * @param {Array<{ content: string|Buffer, filename: string, type?: string }>} [options.attachments]
 * @returns {Promise<{ ok: boolean, messageId: string|null, skipped?: boolean, error?: string, to: string[] }>}
 */
async function sendEmail({ to, subject, html, text, customArgs = {}, attachments = [] }) {
  const recipients = normalizeEmails(to).filter(isValidEmail);
  if (recipients.length === 0) {
    return { ok: false, messageId: null, skipped: true, error: 'No valid recipients', to: [] };
  }

  if (!ensureConfigured()) {
    console.warn('[email] SENDGRID_API_KEY not set — skipping send:', subject, '→', recipients.join(', '));
    return { ok: true, messageId: null, skipped: true, to: recipients };
  }

  const msg = {
    to: recipients,
    from: fromAddress(),
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    customArgs: Object.fromEntries(
      Object.entries(customArgs).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
    ),
    trackingSettings: {
      clickTracking: { enable: true, enableText: false },
      openTracking: { enable: true }
    }
  };

  if (attachments.length > 0) {
    msg.attachments = attachments.map((a) => ({
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64'),
      filename: a.filename,
      type: a.type || 'application/pdf',
      disposition: 'attachment'
    }));
  }

  try {
    const [response] = await sgMail.send(msg);
    const messageId = response?.headers?.['x-message-id'] || response?.headers?.['X-Message-Id'] || null;
    return { ok: true, messageId: messageId ? String(messageId) : null, to: recipients };
  } catch (error) {
    const detail = error?.response?.body || error.message;
    console.error('[email] SendGrid error:', detail);
    return { ok: false, messageId: null, error: error.message || 'Send failed', to: recipients };
  }
}

function wrapEmailHtml({ title, bodyHtml, ctaLabel, ctaUrl, ctas, footer }) {
  const buttons = (Array.isArray(ctas) && ctas.length)
    ? ctas.filter((b) => b?.url && b?.label)
    : (ctaUrl && ctaLabel ? [{ label: ctaLabel, url: ctaUrl }] : []);
  const button = buttons.length
    ? `<p style="margin:24px 0">${buttons.map((b) =>
      `<a href="${b.url}" style="display:inline-block;padding:12px 18px;background:#1f2430;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:0 8px 8px 0">${b.label}</a>`
    ).join('')}</p>`
    : '';
  return `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1f2430;line-height:1.5;padding:24px">
  <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
  ${bodyHtml}
  ${button}
  ${footer ? `<p style="margin-top:28px;font-size:12px;color:#697386">${footer}</p>` : ''}
</body></html>`;
}

module.exports = {
  sendEmail,
  wrapEmailHtml,
  isValidEmail,
  normalizeEmails,
  fromAddress
};
