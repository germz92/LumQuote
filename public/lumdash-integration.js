/**
 * LumDash Integration for LumQuote
 * Handles SSO authentication and event transfer to LumDash
 */

// For local development, use localhost. For production, use the live URLs.
const IS_LOCAL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const LUMDASH_API = IS_LOCAL ? 'http://localhost:3000' : 'https://lumdash2-0.onrender.com';
const LUMDASH_APP = IS_LOCAL ? 'http://localhost:3000' : 'https://beta.lumdash.app';

console.log('🔧 LumDash Integration config:', { IS_LOCAL, LUMDASH_API, LUMDASH_APP, hostname: window.location.hostname });

// Get the callback URL dynamically based on current origin
function getCallbackUrl() {
    return window.location.origin + '/login';
}

// Check if we have a valid LumDash token (same as auth token since we use shared JWT)
async function hasValidLumDashToken() {
    const token = localStorage.getItem('authToken');
    if (!token) return false;
    
    try {
        // Verify with our own server (which uses the same JWT secret)
        const response = await fetch('/api/verify-token', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return response.ok;
    } catch {
        return false;
    }
}

// Redirect to LumDash for authentication
function authenticateWithLumDash(returnPath = '/quotes') {
    // Save where user was so we can return them there
    sessionStorage.setItem('lumDashReturnPath', returnPath);
    
    const callback = encodeURIComponent(getCallbackUrl());
    window.location.href = `${LUMDASH_API}/auth/redirect?callback=${callback}`;
}

// Get date range from quote days
function getQuoteDateRange(days) {
    if (!days || days.length === 0) return { startDate: null, endDate: null };
    
    const datesWithValues = days
        .filter(day => day.date)
        .map(day => {
            // Parse YYYY-MM-DD format
            if (day.date.includes('T')) {
                return new Date(day.date);
            } else {
                const [year, month, dayNum] = day.date.split('-').map(Number);
                return new Date(year, month - 1, dayNum);
            }
        })
        .filter(date => !isNaN(date.getTime()))
        .sort((a, b) => a - b);
    
    if (datesWithValues.length === 0) {
        return { startDate: null, endDate: null };
    }
    
    // Format as YYYY-MM-DD
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

// Parse location string to extract city and state
function parseLocation(locationString) {
    if (!locationString) return { city: '', state: '', venue: '' };
    
    // Common patterns:
    // "Venue Name, City, State"
    // "City, State"
    // "Venue Name - City, State"
    
    const parts = locationString.split(/[,\-]/).map(p => p.trim()).filter(p => p);
    
    // US state abbreviations
    const stateAbbreviations = [
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
    ];
    
    let city = '';
    let state = '';
    let venue = locationString; // Default to full string as venue
    
    // Look for state abbreviation
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i].toUpperCase();
        if (stateAbbreviations.includes(part)) {
            state = part;
            if (i > 0) {
                city = parts[i - 1];
            }
            if (i > 1) {
                venue = parts.slice(0, i - 1).join(', ');
            } else {
                venue = '';
            }
            break;
        }
    }
    
    return { city, state, venue };
}

// Transfer quote to LumDash
async function transferToLumDash(quote) {
    // Check for valid token first
    if (!(await hasValidLumDashToken())) {
        // Store quote data to transfer after auth
        sessionStorage.setItem('pendingLumDashTransfer', JSON.stringify(quote));
        authenticateWithLumDash(window.location.pathname);
        return;
    }
    
    const token = localStorage.getItem('authToken');
    
    // Get date range
    const { startDate, endDate } = getQuoteDateRange(quote.quoteData?.days || []);
    
    // Parse location for city/state
    const { city, state, venue } = parseLocation(quote.location);
    
    // Get current user info
    const userInfo = JSON.parse(localStorage.getItem('user') || '{}');
    
    // Build transfer data
    const transferData = {
        name: quote.quoteData?.quoteTitle || quote.name,
        externalSource: 'lumquote',
        externalId: quote._id || quote.name,
        startDate: startDate,
        endDate: endDate,
        city: city,
        state: state,
        client: quote.clientName || '',
        location: venue || quote.location || '',
        owner: userInfo.name || quote.createdBy?.name || ''
    };
    
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
            // Token expired, re-authenticate
            localStorage.removeItem('authToken');
            sessionStorage.setItem('pendingLumDashTransfer', JSON.stringify(quote));
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
                // Open LumDash in new tab
                window.open(lumDashUrl, '_blank');
            }
            
            return { success: true, eventId: result.eventId, url: lumDashUrl };
        } else {
            showAlertModal(result.error || 'Failed to create event in LumDash', 'error');
            return { success: false, error: result.error };
        }
    } catch (err) {
        console.error('❌ LumDash transfer failed:', err);
        showAlertModal('Failed to connect to LumDash. Please try again.', 'error');
        return { success: false, error: err.message };
    }
}

// Check for pending transfer after auth callback
function checkPendingLumDashTransfer() {
    const pending = sessionStorage.getItem('pendingLumDashTransfer');
    if (pending) {
        sessionStorage.removeItem('pendingLumDashTransfer');
        const quote = JSON.parse(pending);
        // Small delay to ensure page is ready
        setTimeout(() => {
            transferToLumDash(quote);
        }, 500);
    }
}

// Check if current user is admin and show admin-only elements
function showAdminOnlyElements() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role === 'admin') {
        // Show Reports link for admin users
        const reportsLink = document.getElementById('reportsLink');
        if (reportsLink) {
            reportsLink.style.display = '';
        }
    }
}

// Initialize - check for pending transfers when page loads
document.addEventListener('DOMContentLoaded', () => {
    checkPendingLumDashTransfer();
    showAdminOnlyElements();
});

// Export for use in other files
window.LumDashIntegration = {
    transferToLumDash,
    authenticateWithLumDash,
    hasValidLumDashToken,
    checkPendingLumDashTransfer
};

