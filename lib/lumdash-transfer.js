/**
 * Silent LumDash event transfer for contract-signed and paid projects.
 * Failures are logged and never thrown to the caller.
 */

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const { Project } = require('./crm-models');

const LUMDASH_API = 'https://lumdash2-0.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || '84gh29nf89gh2b3v9bgh29g843hfg932hf';

const STATE_ABBREVIATIONS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
];

function parseLocation(locationString) {
  if (!locationString) return { city: '', state: '', venue: '' };

  const parts = String(locationString).split(/[,\-]/).map((p) => p.trim()).filter((p) => p);
  let city = '';
  let state = '';
  let venue = locationString;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].replace(/\.$/, '').toUpperCase();
    if (STATE_ABBREVIATIONS.includes(part)) {
      state = part;
      if (i > 0) city = parts[i - 1];
      venue = i > 1 ? parts.slice(0, i - 1).join(', ') : '';
      break;
    }
  }

  return { city, state, venue };
}

function getQuoteDateRange(days) {
  if (!days || days.length === 0) return { startDate: null, endDate: null };

  const datesWithValues = days
    .filter((day) => day.date)
    .map((day) => {
      if (String(day.date).includes('T')) return new Date(day.date);
      const [year, month, dayNum] = String(day.date).split('-').map(Number);
      return new Date(year, month - 1, dayNum);
    })
    .filter((date) => !isNaN(date.getTime()))
    .sort((a, b) => a - b);

  if (datesWithValues.length === 0) return { startDate: null, endDate: null };

  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    startDate: formatDate(datesWithValues[0]),
    endDate: formatDate(datesWithValues[datesWithValues.length - 1])
  };
}

function buildTransferPayload(project, quotes, ownerName) {
  const primaryQuote = quotes[0] || null;
  let startDate = project.startDate || null;
  let endDate = project.endDate || startDate;
  if (!startDate && primaryQuote) {
    const range = getQuoteDateRange(primaryQuote.quoteData?.days || []);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  const locationSource = String(project.location || primaryQuote?.location || '').trim();
  const { city, state, venue } = parseLocation(locationSource);
  const quoteWithClient = quotes.find((q) => q.clientName) || primaryQuote;
  const quoteWithCompany = quotes.find((q) => q.clientCompany) || primaryQuote;
  const clientName = String(project.client?.name || quoteWithClient?.clientName || '').trim();
  const company = String(project.client?.company || quoteWithCompany?.clientCompany || '').trim();

  return {
    name: project.name,
    externalSource: 'lumquote',
    externalId: String(project._id),
    startDate,
    endDate,
    city,
    state,
    client: clientName,
    company,
    companyName: company,
    location: venue || locationSource || '',
    owner: ownerName || ''
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveOwner(project) {
  let name = '';
  if (project.createdBy && typeof project.createdBy === 'object' && project.createdBy.name) {
    name = project.createdBy.name;
  } else if (project.createdBy) {
    const User = mongoose.model('User');
    const user = await User.findById(project.createdBy).select('name');
    name = user?.name || '';
  }
  name = String(name || '').trim();
  if (!name) return null;

  const LumQuoteUser = mongoose.model('LumQuoteUser');
  let owner = await LumQuoteUser.findOne({ name });
  if (!owner) {
    owner = await LumQuoteUser.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  }
  if (!owner?.lumDashId) return null;
  return owner;
}

function signOwnerToken(owner) {
  return jwt.sign(
    {
      id: owner.lumDashId,
      fullName: owner.name,
      role: owner.role || 'user',
      email: owner.email || ''
    },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

async function transferProject(projectId) {
  if (!projectId) return { ok: false, skipped: true };

  try {
    const project = await Project.findById(projectId)
      .populate('client')
      .populate('createdBy', 'name');
    if (!project) {
      console.warn('[lumdash] Transfer skipped, project not found:', String(projectId));
      return { ok: false, skipped: true };
    }

    const owner = await resolveOwner(project);
    if (!owner) {
      console.warn('[lumdash] Transfer skipped, no LumDash user for project owner:', project.name);
      return { ok: false, skipped: true };
    }

    const SavedQuote = mongoose.model('SavedQuote');
    const quotes = await SavedQuote.find(
      { project: project._id },
      { clientName: 1, clientCompany: 1, location: 1, quoteData: 1, updatedAt: 1 }
    ).sort({ updatedAt: -1 });

    const transferData = buildTransferPayload(project, quotes, owner.name);
    const token = signOwnerToken(owner);
    const response = await fetch(`${LUMDASH_API}/api/events/external-create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(transferData),
      signal: AbortSignal.timeout(20000)
    });

    let result = {};
    try {
      result = await response.json();
    } catch {
      result = {};
    }

    if (!response.ok || !result.success) {
      console.warn(
        '[lumdash] Transfer failed:',
        project.name,
        response.status,
        result.error || response.statusText
      );
      return { ok: false, error: result.error || response.statusText };
    }

    console.log(
      result.alreadyExists ? '[lumdash] Event already exists:' : '[lumdash] Event created:',
      project.name,
      result.eventId || ''
    );
    return { ok: true, alreadyExists: !!result.alreadyExists, eventId: result.eventId || null };
  } catch (error) {
    console.warn('[lumdash] Background transfer failed:', error.message);
    return { ok: false, error: error.message };
  }
}

function scheduleProjectTransfer(projectId) {
  if (!projectId) return;
  setImmediate(() => {
    transferProject(projectId).catch((error) => {
      console.warn('[lumdash] Background transfer failed:', error.message);
    });
  });
}

module.exports = {
  parseLocation,
  buildTransferPayload,
  transferProject,
  scheduleProjectTransfer
};
