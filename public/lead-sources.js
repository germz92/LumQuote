/**
 * Standard lead sources for quote tracking and reports.
 * "Referral" and "Other" store as "Referral: {name}" / "Other: {detail}" for consistent report buckets.
 */
const LEAD_SOURCE_OPTIONS = [
    'Repeat Client',
    'Referral',
    'Website / Inbound',
    'LinkedIn',
    'Social Media',
    'Google Search',
    'Email / Newsletter',
    'Trade Show / Industry Event',
    'Partner Referral',
    'Cold Outreach',
    'Other'
];

const LEAD_SOURCE_REFERRAL = 'Referral';
const LEAD_SOURCE_OTHER = 'Other';
const LEAD_SOURCE_REFERRAL_PREFIX = 'Referral: ';
const LEAD_SOURCE_OTHER_PREFIX = 'Other: ';

/** Map legacy free-text values to standard options when loading existing quotes */
const LEAD_SOURCE_LEGACY_MAP = {
    'repeat': 'Repeat Client',
    'repeat client': 'Repeat Client',
    'referral': LEAD_SOURCE_REFERRAL,
    'website': 'Website / Inbound',
    'inbound': 'Website / Inbound',
    'linkedin': 'LinkedIn',
    'social media': 'Social Media',
    'instagram': 'Social Media',
    'google': 'Google Search',
    'email': 'Email / Newsletter',
    'newsletter': 'Email / Newsletter',
    'trade show': 'Trade Show / Industry Event',
    'event': 'Trade Show / Industry Event',
    'partner': 'Partner Referral',
    'cold outreach': 'Cold Outreach',
    'lumdash': LEAD_SOURCE_OTHER
};

function normalizeLegacyLeadSource(value) {
    if (!value) return '';
    const trimmed = value.trim();
    if (LEAD_SOURCE_OPTIONS.includes(trimmed)) {
        return trimmed;
    }
    const mapped = LEAD_SOURCE_LEGACY_MAP[trimmed.toLowerCase()];
    if (mapped) {
        return mapped;
    }
    if (trimmed.startsWith(LEAD_SOURCE_REFERRAL_PREFIX) || trimmed.startsWith(LEAD_SOURCE_OTHER_PREFIX)) {
        return trimmed;
    }
    return trimmed;
}

function parseStoredLeadSource(stored) {
    const normalized = normalizeLegacyLeadSource(stored);
    if (!normalized) {
        return { selectValue: '', referralText: '', otherText: '' };
    }
    if (normalized.startsWith(LEAD_SOURCE_REFERRAL_PREFIX)) {
        return {
            selectValue: LEAD_SOURCE_REFERRAL,
            referralText: normalized.slice(LEAD_SOURCE_REFERRAL_PREFIX.length).trim(),
            otherText: ''
        };
    }
    if (normalized.startsWith(LEAD_SOURCE_OTHER_PREFIX)) {
        return {
            selectValue: LEAD_SOURCE_OTHER,
            referralText: '',
            otherText: normalized.slice(LEAD_SOURCE_OTHER_PREFIX.length).trim()
        };
    }
    if (normalized === LEAD_SOURCE_REFERRAL) {
        return { selectValue: LEAD_SOURCE_REFERRAL, referralText: '', otherText: '' };
    }
    if (LEAD_SOURCE_OPTIONS.includes(normalized)) {
        return { selectValue: normalized, referralText: '', otherText: '' };
    }
    return { selectValue: LEAD_SOURCE_OTHER, referralText: '', otherText: normalized };
}

function formatLeadSourceForStorage(selectValue, referralText, otherText) {
    if (!selectValue) {
        return '';
    }
    if (selectValue === LEAD_SOURCE_REFERRAL) {
        const detail = (referralText || '').trim();
        return detail ? `${LEAD_SOURCE_REFERRAL_PREFIX}${detail}` : '';
    }
    if (selectValue === LEAD_SOURCE_OTHER) {
        const detail = (otherText || '').trim();
        return detail ? `${LEAD_SOURCE_OTHER_PREFIX}${detail}` : '';
    }
    return selectValue;
}

function populateLeadSourceSelect() {
    const select = document.getElementById('leadSource');
    if (!select || select.tagName !== 'SELECT') {
        return;
    }

    const currentValue = select.value;
    select.innerHTML = '<option value="">Select lead source</option>';
    LEAD_SOURCE_OPTIONS.forEach(option => {
        const el = document.createElement('option');
        el.value = option;
        el.textContent = option;
        select.appendChild(el);
    });
    if (currentValue) {
        select.value = currentValue;
    }
}

function setLeadSourceFormValue(stored) {
    const select = document.getElementById('leadSource');
    const referralInput = document.getElementById('leadSourceReferral');
    const otherInput = document.getElementById('leadSourceOther');
    if (!select) {
        return;
    }

    const { selectValue, referralText, otherText } = parseStoredLeadSource(stored);
    select.value = selectValue;

    if (referralInput) {
        referralInput.value = referralText;
    }
    if (otherInput) {
        otherInput.value = otherText;
    }

    updateLeadSourceDetailFields();
}

function updateLeadSourceDetailFields() {
    const select = document.getElementById('leadSource');
    const referralGroup = document.getElementById('leadSourceReferralGroup');
    const referralInput = document.getElementById('leadSourceReferral');
    const otherGroup = document.getElementById('leadSourceOtherGroup');
    const otherInput = document.getElementById('leadSourceOther');
    if (!select) {
        return;
    }

    const isReferral = select.value === LEAD_SOURCE_REFERRAL;
    const isOther = select.value === LEAD_SOURCE_OTHER;

    if (referralGroup && referralInput) {
        referralGroup.style.display = isReferral ? 'block' : 'none';
        referralInput.required = isReferral;
        if (!isReferral) {
            referralInput.value = '';
        }
    }

    if (otherGroup && otherInput) {
        otherGroup.style.display = isOther ? 'block' : 'none';
        otherInput.required = isOther;
        if (!isOther) {
            otherInput.value = '';
        }
    }
}

function getLeadSourceFromForm() {
    const select = document.getElementById('leadSource');
    const referralInput = document.getElementById('leadSourceReferral');
    const otherInput = document.getElementById('leadSourceOther');
    if (!select) {
        return '';
    }
    return formatLeadSourceForStorage(
        select.value,
        referralInput?.value || '',
        otherInput?.value || ''
    );
}

function validateLeadSourceForm() {
    const select = document.getElementById('leadSource');
    if (!select?.value) {
        return 'Please select a lead source.';
    }
    if (select.value === LEAD_SOURCE_REFERRAL) {
        const referralInput = document.getElementById('leadSourceReferral');
        if (!referralInput?.value.trim()) {
            return 'Please enter who referred this lead.';
        }
    }
    if (select.value === LEAD_SOURCE_OTHER) {
        const otherInput = document.getElementById('leadSourceOther');
        if (!otherInput?.value.trim()) {
            return 'Please specify the lead source when "Other" is selected.';
        }
    }
    return null;
}

function handleLeadSourceChange() {
    updateLeadSourceDetailFields();
}

/** For server-side or report grouping */
function normalizeLeadSourceForReport(stored) {
    if (!stored) {
        return 'Unknown';
    }
    const parsed = parseStoredLeadSource(stored);
    if (parsed.selectValue === LEAD_SOURCE_REFERRAL || parsed.selectValue === LEAD_SOURCE_OTHER) {
        return parsed.selectValue;
    }
    if (parsed.selectValue && LEAD_SOURCE_OPTIONS.includes(parsed.selectValue)) {
        return parsed.selectValue;
    }
    return LEAD_SOURCE_OTHER;
}

window.LeadSources = {
    LEAD_SOURCE_OPTIONS,
    LEAD_SOURCE_REFERRAL,
    LEAD_SOURCE_OTHER,
    populateLeadSourceSelect,
    setLeadSourceFormValue,
    getLeadSourceFromForm,
    validateLeadSourceForm,
    handleLeadSourceChange,
    normalizeLeadSourceForReport,
    parseStoredLeadSource,
    formatLeadSourceForStorage
};

document.addEventListener('DOMContentLoaded', () => {
    populateLeadSourceSelect();
});
