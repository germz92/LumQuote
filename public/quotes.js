class QuotesManager {
    constructor() {
        this.allQuotes = [];
        this.showingArchived = false;
        this.init();
    }

    async init() {
        await this.loadQuotes();
        this.filterAndSort();
    }

    async loadQuotes() {
        try {
            this.showLoading(true);
            const response = await fetch('/api/saved-quotes');
            if (!response.ok) {
                throw new Error('Failed to load quotes');
            }
            this.allQuotes = await response.json();
            
            console.log('📚 Loaded quotes:', {
                total: this.allQuotes.length,
                archived: this.allQuotes.filter(q => q.archived === true).length,
                active: this.allQuotes.filter(q => !q.archived).length,
                quotes: this.allQuotes.map(q => ({ name: q.name, archived: q.archived }))
            });
        } catch (error) {
            console.error('Error loading quotes:', error);
            showAlertModal('Error loading quotes. Please try again.', 'error');
            this.allQuotes = [];
        } finally {
            this.showLoading(false);
        }
    }

    filterAndSort() {
        const searchTerm = document.getElementById('searchQuotes').value.toLowerCase();
        const sortBy = document.getElementById('sortQuotes').value;
        const dateFilter = document.getElementById('dateFilter').value;

        console.log('🔍 Filter and sort called:', {
            showingArchived: this.showingArchived,
            totalQuotes: this.allQuotes.length,
            searchTerm,
            sortBy,
            dateFilter
        });

        // Update clear filters button visibility
        const clearBtn = document.getElementById('clearFiltersBtn');
        if (searchTerm || dateFilter) {
            clearBtn.style.display = 'inline-block';
        } else {
            clearBtn.style.display = 'none';
        }

        // Filter by archive status first
        let filtered = this.allQuotes.filter(quote => {
            const isArchived = quote.archived || false;
            return this.showingArchived ? isArchived : !isArchived;
        });
        
        console.log('📊 After archive filter:', {
            filtered: filtered.length,
            archived: this.allQuotes.filter(q => q.archived).length,
            active: this.allQuotes.filter(q => !q.archived).length
        });

        // Filter by search term
        if (searchTerm) {
            filtered = filtered.filter(quote => 
                quote.name.toLowerCase().includes(searchTerm) ||
                (quote.clientName && quote.clientName.toLowerCase().includes(searchTerm)) ||
                (quote.location && quote.location.toLowerCase().includes(searchTerm))
            );
        }

        // Filter by date
        if (dateFilter) {
            filtered = filtered.filter(quote => {
                const days = quote.quoteData?.days || [];
                return days.some(day => {
                    if (!day.date) return false;
                    // Normalize both dates for comparison
                    const dayDate = this.normalizeDate(day.date);
                    const filterDate = this.normalizeDate(dateFilter);
                    return dayDate === filterDate;
                });
            });
        }

        // Sort
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'newest':
                    return new Date(b.updatedAt) - new Date(a.updatedAt);
                case 'oldest':
                    return new Date(a.updatedAt) - new Date(b.updatedAt);
                case 'name-asc':
                    return a.name.localeCompare(b.name);
                case 'name-desc':
                    return b.name.localeCompare(a.name);
                default:
                    return new Date(b.updatedAt) - new Date(a.updatedAt);
            }
        });

        this.displayQuotes(filtered);
    }

    normalizeDate(dateString) {
        // Parse date as YYYY-MM-DD format
        if (!dateString) return null;
        
        // If it's already in YYYY-MM-DD format, return as is
        if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return dateString;
        }
        
        // Otherwise, parse and format
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    displayQuotes(quotes) {
        const container = document.getElementById('quotesContainer');
        
        if (quotes.length === 0) {
            const emptyMessage = this.showingArchived ? 'No archived quotes found' : 'No active quotes found';
            const searchTerm = document.getElementById('searchQuotes').value;
            const dateFilter = document.getElementById('dateFilter').value;
            
            if (searchTerm || dateFilter) {
                container.innerHTML = `
                    <div class="no-quotes">
                        <p>No quotes match your filters</p>
                        <button class="primary-button" onclick="quotesManager.clearFilters()">Clear Filters</button>
                    </div>
                `;
            } else {
                container.innerHTML = `<div class="no-quotes">${emptyMessage}</div>`;
            }
            return;
        }

        container.innerHTML = quotes.map(quote => this.createQuoteCard(quote)).join('');
    }

    createQuoteCard(quote) {
        const total = quote.quoteData?.total || 0;
        const days = quote.quoteData?.days || [];
        const clientName = quote.clientName || 'No client';
        const location = quote.location || '';
        const quoteTitle = quote.quoteData?.quoteTitle || quote.name;
        const isArchived = quote.archived || false;
        
        // Calculate total services
        const totalServices = days.reduce((sum, day) => sum + (day.services?.length || 0), 0);
        
        // Get date range
        const dateRange = this.getQuoteDateRange(days);
        
        // Format dates
        const createdDate = new Date(quote.createdAt).toLocaleDateString();
        const updatedDate = new Date(quote.updatedAt).toLocaleDateString();

        return `
            <div class="quote-card ${isArchived ? 'archived' : ''}" data-quote-name="${this.escapeHtml(quote.name)}">
                <div class="quote-card-header">
                    <div class="quote-card-title-section">
                        <h3 class="quote-card-title">${this.escapeHtml(quoteTitle)}</h3>
                        ${isArchived ? '<span class="archived-badge">Archived</span>' : ''}
                    </div>
                    <div class="quote-card-total">${this.formatCurrency(total)}</div>
                </div>
                
                <div class="quote-card-body">
                    <div class="quote-card-info">
                        <div class="info-row">
                            <span class="info-label">Client:</span>
                            <span class="info-value">${this.escapeHtml(clientName)}</span>
                        </div>
                        ${location ? `
                            <div class="info-row">
                                <span class="info-label">Location:</span>
                                <span class="info-value">${this.escapeHtml(location)}</span>
                            </div>
                        ` : ''}
                        ${dateRange ? `
                            <div class="info-row">
                                <span class="info-label">Dates:</span>
                                <span class="info-value">${dateRange}</span>
                            </div>
                        ` : ''}
                        <div class="info-row">
                            <span class="info-label">Services:</span>
                            <span class="info-value">${totalServices} service${totalServices !== 1 ? 's' : ''} across ${days.length} day${days.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Updated:</span>
                            <span class="info-value">${updatedDate}</span>
                        </div>
                    </div>
                </div>

                <div class="quote-card-actions">
                    <button class="quote-action-btn primary" onclick="quotesManager.loadQuote('${this.escapeJs(quote.name)}')">
                        Load Quote
                    </button>
                    ${isArchived ? `
                        <button class="quote-action-btn secondary" onclick="quotesManager.unarchiveQuote('${this.escapeJs(quote.name)}')">
                            Unarchive
                        </button>
                    ` : `
                        <button class="quote-action-btn secondary" onclick="quotesManager.archiveQuote('${this.escapeJs(quote.name)}')">
                            Archive
                        </button>
                    `}
                    <button class="quote-action-btn danger" onclick="quotesManager.deleteQuote('${this.escapeJs(quote.name)}')">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }

    getQuoteDateRange(days) {
        // Find all days with dates
        const daysWithDates = days.filter(day => day.date);
        
        if (daysWithDates.length === 0) {
            return null;
        }
        
        // Parse and sort dates
        const dates = daysWithDates
            .map(day => this.parseStoredDate(day.date))
            .filter(date => date)
            .sort((a, b) => a - b);
        
        if (dates.length === 0) {
            return null;
        }
        
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];
        
        const startFormatted = this.formatDateShort(startDate);
        
        if (dates.length === 1) {
            return startFormatted;
        } else {
            const endFormatted = this.formatDateShort(endDate);
            return `${startFormatted} - ${endFormatted}`;
        }
    }

    parseStoredDate(dateString) {
        if (!dateString) return null;
        
        // Handle both ISO format and YYYY-MM-DD format
        if (dateString.includes('T')) {
            return new Date(dateString);
        } else {
            const [year, month, day] = dateString.split('-').map(Number);
            return new Date(year, month - 1, day);
        }
    }

    formatDateShort(date) {
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    }

    formatCurrency(amount) {
        if (typeof amount !== 'number') return '$0';
        
        const hasDecimals = amount % 1 !== 0;
        return amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: hasDecimals ? 2 : 0,
            maximumFractionDigits: 2
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeJs(text) {
        if (!text) return '';
        return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    }

    clearFilters() {
        document.getElementById('searchQuotes').value = '';
        document.getElementById('dateFilter').value = '';
        this.filterAndSort();
    }

    toggleArchiveView() {
        this.showingArchived = !this.showingArchived;
        
        console.log('🔄 Toggle archive view:', this.showingArchived);
        
        const toggleBtn = document.getElementById('archiveToggleText');
        const container = document.getElementById('quotesContainer');
        
        if (this.showingArchived) {
            toggleBtn.textContent = 'View Active';
            container.classList.add('showing-archived');
        } else {
            toggleBtn.textContent = 'View Archived';
            container.classList.remove('showing-archived');
        }
        
        this.filterAndSort();
    }

    async loadQuote(quoteName) {
        try {
            this.showLoading(true);
            
            const response = await fetch(`/api/load-quote/${encodeURIComponent(quoteName)}`);
            if (!response.ok) {
                throw new Error('Failed to load quote');
            }
            
            const quoteData = await response.json();
            
            // Store quote data in session storage for main page to load
            sessionStorage.setItem('loadQuoteData', JSON.stringify(quoteData));
            
            // Navigate to main page
            window.location.href = '/';
            
        } catch (error) {
            console.error('Error loading quote:', error);
            showAlertModal('Failed to load quote. Please try again.', 'error');
            this.showLoading(false);
        }
    }

    async archiveQuote(quoteName) {
        const confirmed = await showConfirmModal(
            `Are you sure you want to archive "${quoteName}"? Archived quotes will not appear on the calendar or in active quotes.`,
            'Archive Quote',
            'Archive',
            'Cancel'
        );
        
        if (!confirmed) return;

        try {
            this.showLoading(true);
            
            console.log('📦 Archiving quote:', quoteName);
            
            const response = await fetch(`/api/archive-quote/${encodeURIComponent(quoteName)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ archived: true })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                console.error('❌ Archive failed:', data);
                throw new Error(data.error || 'Failed to archive quote');
            }
            
            console.log('✅ Archive response:', data);
            
            await this.loadQuotes();
            this.filterAndSort();
            
            showAlertModal(`Quote "${quoteName}" has been archived.`, 'success', null, true);
            
        } catch (error) {
            console.error('Error archiving quote:', error);
            showAlertModal(`Failed to archive quote: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async unarchiveQuote(quoteName) {
        const confirmed = await showConfirmModal(
            `Are you sure you want to unarchive "${quoteName}"? It will appear in active quotes and on the calendar.`,
            'Unarchive Quote',
            'Unarchive',
            'Cancel'
        );
        
        if (!confirmed) return;

        try {
            this.showLoading(true);
            
            console.log('📦 Unarchiving quote:', quoteName);
            
            const response = await fetch(`/api/archive-quote/${encodeURIComponent(quoteName)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ archived: false })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                console.error('❌ Unarchive failed:', data);
                throw new Error(data.error || 'Failed to unarchive quote');
            }
            
            console.log('✅ Unarchive response:', data);
            
            await this.loadQuotes();
            this.filterAndSort();
            
            showAlertModal(`Quote "${quoteName}" has been restored to active quotes.`, 'success', null, true);
            
        } catch (error) {
            console.error('Error unarchiving quote:', error);
            showAlertModal(`Failed to unarchive quote: ${error.message}`, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async deleteQuote(quoteName) {
        const confirmed = await showConfirmModal(
            `Are you sure you want to permanently delete "${quoteName}"? This action cannot be undone.`,
            'Delete Quote',
            'Delete',
            'Cancel'
        );
        
        if (!confirmed) return;

        try {
            this.showLoading(true);
            
            const response = await fetch(`/api/saved-quotes/${encodeURIComponent(quoteName)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete quote');
            }
            
            await this.loadQuotes();
            this.filterAndSort();
            
            showAlertModal(`Quote "${quoteName}" has been deleted.`, 'success', null, true);
            
        } catch (error) {
            console.error('Error deleting quote:', error);
            showAlertModal('Failed to delete quote. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.display = show ? 'flex' : 'none';
    }
}

// Modal functions (reused from main app)
let currentConfirmCallback = null;

function showAlertModal(message, type = 'info', title = null, autoClose = false) {
    const modal = document.getElementById('alertModal');
    const titleEl = document.getElementById('alertModalTitle');
    const messageEl = document.getElementById('alertModalMessage');
    const iconEl = document.getElementById('alertModalIcon');
    const contentEl = modal.querySelector('.alert-modal-content');
    
    titleEl.textContent = title || (type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Information');
    messageEl.textContent = message;
    iconEl.className = `alert-icon ${type}`;
    contentEl.classList.remove('auto-close');
    modal.style.display = 'flex';
    
    if (autoClose && type === 'success') {
        contentEl.classList.add('auto-close');
        setTimeout(() => {
            hideAlertModal();
        }, 3500);
    }
    
    setTimeout(() => {
        const okButton = modal.querySelector('.primary-button');
        okButton.focus();
    }, 100);
}

function hideAlertModal() {
    const modal = document.getElementById('alertModal');
    if (modal) {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.style.display = 'none';
            modal.classList.remove('closing');
        }, 200);
    }
}

function showConfirmModal(message, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmModalTitle');
        const messageEl = document.getElementById('confirmModalMessage');
        const confirmBtn = document.getElementById('confirmModalOk');
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;
        
        currentConfirmCallback = resolve;
        modal.style.display = 'flex';
        
        setTimeout(() => {
            confirmBtn.focus();
        }, 100);
    });
}

function hideConfirmModal(result) {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.style.display = 'none';
            modal.classList.remove('closing');
            if (currentConfirmCallback) {
                currentConfirmCallback(result);
                currentConfirmCallback = null;
            }
        }, 200);
    }
}

// Keyboard support for modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (document.getElementById('alertModal').style.display === 'flex') {
            hideAlertModal();
        } else if (document.getElementById('confirmModal').style.display === 'flex') {
            hideConfirmModal(false);
        }
    }
});

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        
        if (response.ok) {
            window.location.href = '/login';
        } else {
            console.error('Logout failed');
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Initialize quotes manager when page loads
let quotesManager;
document.addEventListener('DOMContentLoaded', () => {
    quotesManager = new QuotesManager();
});

