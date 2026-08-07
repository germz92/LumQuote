/**
 * LumDash Integration for LumQuote
 * Handles SSO authentication and event transfer to LumDash (project-first).
 */

const IS_LOCAL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const LUMDASH_API = 'https://lumdash2-0.onrender.com';
const LUMDASH_APP = 'https://beta.lumdash.app';

console.log('🔧 LumDash Integration config:', { IS_LOCAL, LUMDASH_API, LUMDASH_APP, hostname: window.location.hostname });

function getCallbackUrl() {
    return window.location.origin + '/login';
}

async function hasValidLumDashToken() {
    const token = localStorage.getItem('authToken');
    if (!token) return false;

    try {
        const response = await fetch('/api/verify-token', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return response.ok;
    } catch {
        return false;
    }
}

function authenticateWithLumDash(returnPath = '/projects') {
    sessionStorage.setItem('lumDashReturnPath', returnPath);
    const callback = encodeURIComponent(getCallbackUrl());
    window.location.href = `${LUMDASH_API}/auth/redirect?callback=${callback}`;
}

function getQuoteDateRange(days) {
    if (!days || days.length === 0) return { startDate: null, endDate: null };

    const datesWithValues = days
        .filter(day => day.date)
        .map(day => {
            if (day.date.includes('T')) {
                return new Date(day.date);
            }
            const [year, month, dayNum] = day.date.split('-').map(Number);
            return new Date(year, month - 1, dayNum);
        })
        .filter(date => !isNaN(date.getTime()))
        .sort((a, b) => a - b);

    if (datesWithValues.length === 0) {
        return { startDate: null, endDate: null };
    }

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

function parseLocation(locationString) {
    if (!locationString) return { city: '', state: '', venue: '' };

    const parts = locationString.split(/[,\-]/).map(p => p.trim()).filter(p => p);

    const stateAbbreviations = [
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
    ];

    let city = '';
    let state = '';
    let venue = locationString;

    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i].toUpperCase();
        if (stateAbbreviations.includes(part)) {
            state = part;
            if (i > 0) city = parts[i - 1];
            venue = i > 1 ? parts.slice(0, i - 1).join(', ') : '';
            break;
        }
    }

    return { city, state, venue };
}

const PROJECT_STATUS_ORDER = {
    lead: 0,
    quoted: 1,
    booked: 2,
    contract_signed: 3,
    invoiced: 4,
    paid: 5,
    complete: 6
};

function buildTransferPayloadFromProject(project, quotes = []) {
    const primaryQuote = quotes[0] || null;
    let startDate = project.startDate || null;
    let endDate = project.endDate || startDate;
    if (!startDate && primaryQuote) {
        const range = getQuoteDateRange(primaryQuote.quoteData?.days || []);
        startDate = range.startDate;
        endDate = range.endDate;
    }

    const locationSource = primaryQuote?.location || '';
    const { city, state, venue } = parseLocation(locationSource);
    const userInfo = JSON.parse(localStorage.getItem('user') || '{}');
    const clientName = project.client?.name
        || primaryQuote?.clientName
        || '';

    return {
        name: project.name,
        externalSource: 'lumquote',
        externalId: String(project._id),
        startDate,
        endDate,
        city,
        state,
        client: clientName,
        location: venue || locationSource || '',
        owner: userInfo.name || ''
    };
}

async function sendTransferPayload(transferData) {
    if (!(await hasValidLumDashToken())) {
        sessionStorage.setItem('pendingLumDashTransfer', JSON.stringify({
            __kind: 'payload',
            transferData
        }));
        authenticateWithLumDash(window.location.pathname);
        return { success: false, error: 'Authentication required' };
    }

    const token = localStorage.getItem('authToken');
    console.log('📤 Transferring to LumDash:', transferData);

    try {
        const response = await fetch(`${LUMDASH_API}/api/events/external-create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(transferData)
        });

        if (response.status === 401) {
            localStorage.removeItem('authToken');
            sessionStorage.setItem('pendingLumDashTransfer', JSON.stringify({
                __kind: 'payload',
                transferData
            }));
            authenticateWithLumDash(window.location.pathname);
            return { success: false, error: 'Authentication required' };
        }

        const result = await response.json();

        if (result.success) {
            const lumDashUrl = `${LUMDASH_APP}${result.redirectUrl}`;

            if (result.alreadyExists) {
                const shouldOpen = await showConfirmModal(
                    'This event already exists in LumDash. Would you like to open it?',
                    'Event Exists',
                    'Open in LumDash',
                    'Cancel'
                );
                if (shouldOpen) {
                    window.open(lumDashUrl, '_blank');
                }
            } else {
                showAlertModal('Event created in LumDash!', 'success', 'Success');
                window.open(lumDashUrl, '_blank');
            }

            return { success: true, eventId: result.eventId, url: lumDashUrl };
        }

        showAlertModal(result.error || 'Failed to create event in LumDash', 'error');
        return { success: false, error: result.error };
    } catch (err) {
        console.error('❌ LumDash transfer failed:', err);
        showAlertModal('Failed to connect to LumDash. Please try again.', 'error');
        return { success: false, error: err.message };
    }
}

async function transferProjectToLumDash(projectId) {
    if (!projectId) return { success: false, error: 'Missing project' };

    try {
        const data = await (window.CRM
            ? CRM.api(`/api/projects/${projectId}`)
            : fetch(`/api/projects/${projectId}`, { credentials: 'include' }).then(async (r) => {
                const json = await r.json();
                if (!r.ok) throw new Error(json.error || 'Failed to load project');
                return json;
            }));

        const project = data.project || data;
        const quotes = data.quotes || [];
        const transferData = buildTransferPayloadFromProject(project, quotes);
        return sendTransferPayload(transferData);
    } catch (err) {
        console.error('Error loading project for LumDash transfer:', err);
        if (typeof showAlertModal === 'function') {
            showAlertModal(err.message || 'Failed to load project for LumDash transfer.', 'error');
        }
        return { success: false, error: err.message };
    }
}

async function onProjectMarkedAsBooked(projectId, previousStatus = 'lead') {
    if (!projectId) return;
    if ((PROJECT_STATUS_ORDER[previousStatus] || 0) >= PROJECT_STATUS_ORDER.booked) {
        return;
    }

    if (typeof showConfirmModal !== 'function') {
        console.warn('showConfirmModal not available for LumDash transfer prompt');
        return;
    }

    const shouldTransfer = await showConfirmModal(
        'Transfer this project to LumDash?',
        'Project Booked',
        'Yes',
        'No'
    );

    if (!shouldTransfer) return;
    await transferProjectToLumDash(projectId);
}

/** @deprecated Quote booking retired — use transferProjectToLumDash */
async function transferToLumDash(quote) {
    if (quote?.project) {
        return transferProjectToLumDash(quote.project._id || quote.project);
    }
    // Legacy: build payload from quote shape if somehow still called
    const { startDate, endDate } = getQuoteDateRange(quote.quoteData?.days || []);
    const { city, state, venue } = parseLocation(quote.location);
    const userInfo = JSON.parse(localStorage.getItem('user') || '{}');
    return sendTransferPayload({
        name: quote.quoteData?.quoteTitle || quote.name,
        externalSource: 'lumquote',
        externalId: quote._id || quote.name,
        startDate,
        endDate,
        city,
        state,
        client: quote.clientName || '',
        location: venue || quote.location || '',
        owner: userInfo.name || quote.createdBy?.name || ''
    });
}

/** @deprecated */
async function onQuoteMarkedAsBooked() {
    console.warn('onQuoteMarkedAsBooked is deprecated; book the project instead.');
}

function checkPendingLumDashTransfer() {
    const pending = sessionStorage.getItem('pendingLumDashTransfer');
    if (!pending) return;
    sessionStorage.removeItem('pendingLumDashTransfer');
    try {
        const data = JSON.parse(pending);
        setTimeout(() => {
            if (data?.__kind === 'payload' && data.transferData) {
                sendTransferPayload(data.transferData);
            } else if (data?.__kind === 'project' && data.projectId) {
                transferProjectToLumDash(data.projectId);
            } else if (data?.name || data?.quoteData) {
                transferToLumDash(data);
            }
        }, 500);
    } catch (err) {
        console.error('Failed to resume LumDash transfer:', err);
    }
}

function showAdminOnlyElements() {
    if (window.AppShell?.syncAdminNav) {
        window.AppShell.syncAdminNav();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkPendingLumDashTransfer();
    showAdminOnlyElements();
});

window.LumDashIntegration = {
    transferToLumDash,
    transferProjectToLumDash,
    onProjectMarkedAsBooked,
    onQuoteMarkedAsBooked,
    authenticateWithLumDash,
    hasValidLumDashToken,
    checkPendingLumDashTransfer
};
