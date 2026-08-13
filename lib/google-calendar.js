/**
 * Company Google Calendar — one shared calendar for booked+ projects.
 * One-way sync: LumQuote writes events; Google edits are not read back.
 */

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { google } = require('googleapis');

const { Project, Contract, Invoice, getCompanySettings, quoteDateRange } = require('./crm-models');

const CALENDAR_NAME = 'LumQuote Projects';
const SYNC_STATUSES = new Set(['booked', 'contract_signed', 'invoiced', 'paid', 'complete']);
const STATUS_LABELS = {
  lead: 'Lead',
  quoted: 'Quoted',
  booked: 'Booked',
  contract_signed: 'Contract Signed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  complete: 'Complete'
};
const CONFIRMED_COLOR_ID = '6'; // tangerine — close to in-app booked+ amber
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const STATE_PURPOSE = 'gcal-connect';

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function publicBaseUrl() {
  return String(process.env.APP_BASE_URL || 'https://lumquote.com').replace(/\/$/, '');
}

function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI.replace(/\/$/, '');
  }
  if (req) {
    const host = String(req.get('host') || '');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      return `${proto}://${host}/api/admin/google-calendar/callback`;
    }
  }
  return `${publicBaseUrl()}/api/admin/google-calendar/callback`;
}

function oauthClient(req) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri(req)
  );
}

function jwtSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET;
}

function createConnectState(user, { popup = false } = {}) {
  return jwt.sign(
    {
      purpose: STATE_PURPOSE,
      name: user.name || user.fullName || '',
      role: user.role,
      popup: !!popup
    },
    jwtSecret(),
    { expiresIn: '15m' }
  );
}

function verifyConnectState(state) {
  const decoded = jwt.verify(state, jwtSecret());
  if (decoded.purpose !== STATE_PURPOSE) {
    throw new Error('Invalid Google Calendar connect state');
  }
  return decoded;
}

function peekConnectState(state) {
  try {
    return verifyConnectState(state);
  } catch {
    return null;
  }
}

function getAuthUrl(req, user, { popup = false } = {}) {
  if (!isConfigured()) {
    throw new Error('Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  const client = oauthClient(req);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: createConnectState(user, { popup })
  });
}

function gcalFields(settings) {
  return settings.googleCalendar || {};
}

function isAuthorized(settings) {
  return !!gcalFields(settings).refreshToken;
}

function isConnected(settings) {
  const gcal = gcalFields(settings);
  return !!(gcal.refreshToken && gcal.calendarId);
}

async function getStatus() {
  const settings = await getCompanySettings();
  const gcal = gcalFields(settings);
  return {
    configured: isConfigured(),
    authorized: isAuthorized(settings),
    connected: isConnected(settings),
    email: gcal.email || '',
    calendarName: gcal.calendarName || '',
    calendarId: gcal.calendarId || '',
    connectedBy: gcal.connectedBy || '',
    connectedAt: gcal.connectedAt || null
  };
}

async function handleCallback(req) {
  const { code, state } = req.query;
  if (!code || !state) throw new Error('Google did not return an authorization code.');
  const decoded = verifyConnectState(state);
  if (decoded.role !== 'admin') throw new Error('Admin access required');

  const client = oauthClient(req);
  const { tokens } = await client.getToken(String(code));
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Disconnect the app in your Google account and try again.');
  }
  client.setCredentials(tokens);

  const calendar = google.calendar({ version: 'v3', auth: client });
  let email = '';
  try {
    const primary = await calendar.calendarList.get({ calendarId: 'primary' });
    email = primary.data.id || '';
  } catch {
    email = '';
  }

  const settings = await getCompanySettings();
  const previous = gcalFields(settings);
  settings.googleCalendar = {
    refreshToken: tokens.refresh_token,
    calendarId: previous.calendarId || '',
    calendarName: previous.calendarName || '',
    email,
    connectedBy: decoded.name || 'admin',
    connectedAt: previous.connectedAt || null
  };
  await settings.save();
  return { popup: !!decoded.popup, status: await getStatus() };
}

async function getAuthorizedCalendar() {
  if (!isConfigured()) return null;
  const settings = await getCompanySettings();
  const token = gcalFields(settings).refreshToken;
  if (!token) return null;
  const auth = oauthClient(null);
  auth.setCredentials({ refresh_token: token });
  return {
    calendar: google.calendar({ version: 'v3', auth }),
    settings
  };
}

async function listCalendars() {
  const api = await getAuthorizedCalendar();
  if (!api) throw new Error('Sign in with Google first.');
  const list = await api.calendar.calendarList.list({ maxResults: 250 });
  return (list.data.items || [])
    .filter((item) => item.accessRole === 'owner' || item.accessRole === 'writer')
    .map((item) => ({
      id: item.id,
      name: item.summary || item.id,
      primary: !!item.primary,
      accessRole: item.accessRole
    }))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

async function selectCalendar({ calendarId = '', createNew = false } = {}) {
  const api = await getAuthorizedCalendar();
  if (!api) throw new Error('Sign in with Google first.');

  let selected;
  if (createNew) {
    selected = await ensureCompanyCalendar(api.calendar);
  } else if (calendarId) {
    const item = await api.calendar.calendarList.get({ calendarId });
    selected = { id: item.data.id, summary: item.data.summary || item.data.id };
  } else {
    throw new Error('Choose a calendar or create LumQuote Projects.');
  }

  const gcal = gcalFields(api.settings);
  api.settings.googleCalendar = {
    refreshToken: gcal.refreshToken,
    calendarId: selected.id,
    calendarName: selected.summary || CALENDAR_NAME,
    email: gcal.email || '',
    connectedBy: gcal.connectedBy || 'admin',
    connectedAt: new Date()
  };
  await api.settings.save();
  return getStatus();
}

async function ensureCompanyCalendar(calendar) {
  const list = await calendar.calendarList.list({ maxResults: 250 });
  const existing = (list.data.items || []).find((item) => item.summary === CALENDAR_NAME);
  if (existing) {
    return { id: existing.id, summary: existing.summary };
  }
  const created = await calendar.calendars.insert({
    requestBody: {
      summary: CALENDAR_NAME,
      description: 'Booked and later projects synced from LumQuote'
    }
  });
  return { id: created.data.id, summary: created.data.summary || CALENDAR_NAME };
}

async function disconnect() {
  const settings = await getCompanySettings();
  const token = gcalFields(settings).refreshToken;
  if (token) {
    try {
      const client = oauthClient(null);
      await client.revokeToken(token);
    } catch (error) {
      console.warn('[gcal] Could not revoke Google token:', error.message);
    }
  }
  settings.googleCalendar = {
    refreshToken: '',
    calendarId: '',
    calendarName: '',
    email: '',
    connectedBy: '',
    connectedAt: null
  };
  await settings.save();
  return getStatus();
}

async function getCalendarClient() {
  if (!isConfigured()) return null;
  const settings = await getCompanySettings();
  if (!isConnected(settings)) return null;
  const gcal = gcalFields(settings);
  const auth = oauthClient(null);
  auth.setCredentials({ refresh_token: gcal.refreshToken });
  return {
    calendar: google.calendar({ version: 'v3', auth }),
    calendarId: gcal.calendarId,
    settings
  };
}

function addOneDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function ymdFromValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function quoteSpan(quote) {
  const range = quoteDateRange(quote?.quoteData);
  const start = ymdFromValue(range.startDate);
  const end = ymdFromValue(range.endDate) || start;
  return start ? { start, end } : null;
}

async function projectDateSpan(project) {
  let start = ymdFromValue(project.startDate);
  let end = ymdFromValue(project.endDate) || start;
  if (start) return { start, end: end || start };

  try {
    const SavedQuote = mongoose.model('SavedQuote');
    const quotes = await SavedQuote.find({ project: project._id }, { quoteData: 1 });
    const spans = quotes.map(quoteSpan).filter(Boolean);
    if (!spans.length) return null;
    start = spans.reduce((min, s) => (s.start < min ? s.start : min), spans[0].start);
    end = spans.reduce((max, s) => (s.end > max ? s.end : max), spans[0].end);
    return { start, end };
  } catch (error) {
    console.warn('[gcal] Could not read quote dates:', error.message);
    return null;
  }
}

function isEligible(project, span) {
  return !project.archived && SYNC_STATUSES.has(project.status) && !!span;
}

function clientLabel(client) {
  if (!client) return '';
  if (client.company && client.name) return `${client.name} · ${client.company}`;
  return client.company || client.name || '';
}

function buildDescription({ project, client, ownerName, contract, invoice }) {
  const base = publicBaseUrl();
  const status = STATUS_LABELS[project.status] || project.status || 'Lead';
  const contractLink = contract?.publicToken ? `${base}/sign/${contract.publicToken}` : 'Not sent yet';
  const invoiceLink = invoice?.publicToken ? `${base}/invoice/${invoice.publicToken}` : 'Not sent yet';
  const lines = [
    `Client: ${clientLabel(client) || '—'}`,
    `Status: ${status}`
  ];
  if (ownerName) lines.push(`Owner: ${ownerName}`);
  lines.push(
    '',
    `Project: ${base}/projects/${project._id}`,
    `Contract: ${contractLink}`,
    `Invoice: ${invoiceLink}`
  );
  return lines.join('\n');
}

async function loadSyncContext(projectId) {
  const project = await Project.findById(projectId)
    .populate('client')
    .populate('createdBy', 'name');
  if (!project) return null;

  const [contract, invoice] = await Promise.all([
    Contract.findOne({ project: project._id, publicToken: { $ne: null } }).sort({ updatedAt: -1 }),
    Invoice.findOne({
      project: project._id,
      status: { $ne: 'void' },
      publicToken: { $ne: null }
    }).sort({ updatedAt: -1 })
  ]);

  return { project, contract, invoice };
}

function eventBody(ctx, span) {
  const { project, contract, invoice } = ctx;
  const ownerName = project.createdBy?.name || '';
  return {
    summary: project.name,
    location: clientLabel(project.client) || undefined,
    description: buildDescription({
      project,
      client: project.client,
      ownerName,
      contract,
      invoice
    }),
    start: { date: span.start },
    end: { date: addOneDay(span.end) },
    colorId: CONFIRMED_COLOR_ID
  };
}

function googleStatus(error) {
  return Number(error.code || error.response?.status || 0);
}

async function deleteGoogleEvent(calendar, calendarId, eventId) {
  if (!eventId) return;
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (error) {
    const status = googleStatus(error);
    if (status !== 404 && status !== 410) {
      throw error;
    }
  }
}

async function syncProjectToGoogle(projectId) {
  const api = await getCalendarClient();
  if (!api) return { skipped: true };
  const ctx = await loadSyncContext(projectId);
  if (!ctx) return { skipped: true };

  const { calendar, calendarId } = api;
  const { project } = ctx;
  const span = await projectDateSpan(project);
  const eventId = project.googleCalendarEventId;

  if (!isEligible(project, span)) {
    if (eventId) {
      await deleteGoogleEvent(calendar, calendarId, eventId);
      project.googleCalendarEventId = null;
      await project.save();
    }
    return { removed: !!eventId };
  }

  const body = eventBody(ctx, span);
  if (eventId) {
    try {
      await calendar.events.update({
        calendarId,
        eventId,
        requestBody: body
      });
      return { updated: true, eventId };
    } catch (error) {
      const status = googleStatus(error);
      if (status !== 404 && status !== 410) throw error;
    }
  }

  const created = await calendar.events.insert({
    calendarId,
    requestBody: body
  });
  project.googleCalendarEventId = created.data.id;
  await project.save();
  return { created: true, eventId: created.data.id };
}

async function removeProjectEvent(projectId) {
  const api = await getCalendarClient();
  const project = await Project.findById(projectId);
  if (!project?.googleCalendarEventId) return;
  if (api) {
    await deleteGoogleEvent(api.calendar, api.calendarId, project.googleCalendarEventId);
  }
  project.googleCalendarEventId = null;
  await project.save();
}

async function syncAllProjects() {
  const api = await getCalendarClient();
  if (!api) {
    throw new Error('Google Calendar is not connected.');
  }

  const projects = await Project.find({
    $or: [
      { status: { $in: [...SYNC_STATUSES] }, archived: { $ne: true } },
      { googleCalendarEventId: { $nin: [null, ''] } }
    ]
  }, { _id: 1 });

  let created = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;
  for (const project of projects) {
    try {
      const result = await syncProjectToGoogle(project._id);
      if (result.created) created += 1;
      else if (result.updated) updated += 1;
      else if (result.removed) removed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[gcal] Sync failed for ${project._id}:`, error.message);
    }
  }
  return { total: projects.length, created, updated, removed, failed };
}

function scheduleProjectSync(projectId) {
  if (!projectId) return;
  setImmediate(() => {
    syncProjectToGoogle(projectId).catch((error) => {
      console.warn('[gcal] Background sync failed:', error.message);
    });
  });
}

module.exports = {
  CALENDAR_NAME,
  SYNC_STATUSES,
  isConfigured,
  getStatus,
  getAuthUrl,
  peekConnectState,
  handleCallback,
  listCalendars,
  selectCalendar,
  disconnect,
  syncProjectToGoogle,
  syncAllProjects,
  removeProjectEvent,
  scheduleProjectSync
};
