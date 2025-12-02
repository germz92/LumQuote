class QuotesManager {
    constructor() {
        this.allQuotes = [];
        this.showingArchived = false;
        this.users = [];
        // Load saved view preference or default to grid
        this.viewMode = localStorage.getItem('quotesViewMode') || 'grid';
        this.sortColumn = localStorage.getItem('quotesSortColumn') || 'created-newest';
        this.sortDirection = localStorage.getItem('quotesSortDirection') || 'desc';
        this.init();
    }

    async init() {
        await this.loadUsers();
        await this.loadQuotes();
        this.applyViewMode(); // Apply saved view mode
        this.filterAndSort();
        
        // Update sort indicators if in list view
        if (this.viewMode === 'list') {
            this.updateSortIndicators();
        }
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) {
                throw new Error('Failed to load users');
            }
            this.users = await response.json();
            
            // Populate user filter dropdown
            const userFilter = document.getElementById('userFilter');
            userFilter.innerHTML = '<option value="">All Users</option>';
            this.users.forEach(user => {
                const option = document.createElement('option');
                option.value = user._id;
                option.textContent = user.name;
                userFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading users:', error);
            this.users = [];
        }
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
        const userFilter = document.getElementById('userFilter').value;
        const bookedFilter = document.getElementById('bookedFilter').value;

        console.log('🔍 Filter and sort called:', {
            showingArchived: this.showingArchived,
            totalQuotes: this.allQuotes.length,
            searchTerm,
            sortBy,
            dateFilter,
            userFilter,
            bookedFilter
        });

        // Update clear filters button visibility
        const clearBtn = document.getElementById('clearFiltersBtn');
        if (searchTerm || dateFilter || userFilter || bookedFilter) {
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

        // Filter by user
        if (userFilter) {
            filtered = filtered.filter(quote => {
                return quote.createdBy && quote.createdBy._id === userFilter;
            });
        }

        // Filter by booked status
        if (bookedFilter) {
            filtered = filtered.filter(quote => {
                const isBooked = quote.booked || false;
                if (bookedFilter === 'booked') {
                    return isBooked === true;
                } else if (bookedFilter === 'not-booked') {
                    return isBooked === false;
                }
                return true;
            });
        }

        // Sort
        if (this.viewMode === 'list' && this.sortColumn !== 'created-newest') {
            // Use column-based sorting for list view
            filtered.sort((a, b) => {
                let result = 0;
                switch (this.sortColumn) {
                    case 'title':
                        const aTitle = a.quoteData?.quoteTitle || a.name;
                        const bTitle = b.quoteData?.quoteTitle || b.name;
                        result = aTitle.localeCompare(bTitle);
                        break;
                    case 'client':
                        const aClient = a.clientName || '';
                        const bClient = b.clientName || '';
                        result = aClient.localeCompare(bClient);
                        break;
                    case 'location':
                        const aLocation = a.location || '';
                        const bLocation = b.location || '';
                        result = aLocation.localeCompare(bLocation);
                        break;
                    case 'owner':
                        const aOwner = a.createdBy?.name || '';
                        const bOwner = b.createdBy?.name || '';
                        result = aOwner.localeCompare(bOwner);
                        break;
                    case 'date':
                        result = this.compareServiceDates(a, b);
                        break;
                    case 'created':
                        result = new Date(a.createdAt) - new Date(b.createdAt);
                        break;
                    case 'modified':
                        result = new Date(a.updatedAt) - new Date(b.updatedAt);
                        break;
                    case 'total':
                        const aTotal = a.quoteData?.total || 0;
                        const bTotal = b.quoteData?.total || 0;
                        result = aTotal - bTotal;
                        break;
                }
                return this.sortDirection === 'asc' ? result : -result;
            });
        } else {
            // Use dropdown-based sorting for grid view
            filtered.sort((a, b) => {
                switch (sortBy) {
                    case 'service-date-newest':
                        return this.compareServiceDates(b, a);
                    case 'service-date-oldest':
                        return this.compareServiceDates(a, b);
                    case 'newest':
                        return new Date(b.updatedAt) - new Date(a.updatedAt);
                    case 'oldest':
                        return new Date(a.updatedAt) - new Date(b.updatedAt);
                    case 'created-newest':
                        return new Date(b.createdAt) - new Date(a.createdAt);
                    case 'created-oldest':
                        return new Date(a.createdAt) - new Date(b.createdAt);
                    case 'name-asc':
                        return a.name.localeCompare(b.name);
                    case 'name-desc':
                        return b.name.localeCompare(a.name);
                    default:
                        return new Date(b.createdAt) - new Date(a.createdAt); // Default to created newest
                }
            });
        }

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

    compareServiceDates(quoteA, quoteB) {
        // Get the earliest service date from each quote (for multi-day quotes, use start date)
        const daysA = quoteA.quoteData?.days || [];
        const daysB = quoteB.quoteData?.days || [];
        
        // Parse and filter valid dates
        const datesA = daysA
            .filter(day => day.date)
            .map(day => this.parseStoredDate(day.date))
            .filter(date => date && !isNaN(date.getTime())); // Ensure valid date objects
        
        const datesB = daysB
            .filter(day => day.date)
            .map(day => this.parseStoredDate(day.date))
            .filter(date => date && !isNaN(date.getTime()));
        
        // If no dates, put at the end
        if (datesA.length === 0 && datesB.length === 0) return 0;
        if (datesA.length === 0) return 1;
        if (datesB.length === 0) return -1;
        
        // Sort dates to get the earliest (start date) for each quote
        datesA.sort((a, b) => a.getTime() - b.getTime());
        datesB.sort((a, b) => a.getTime() - b.getTime());
        
        // Compare the earliest dates (start dates)
        const earliestA = datesA[0].getTime();
        const earliestB = datesB[0].getTime();
        
        return earliestA - earliestB;
    }

    displayQuotes(quotes) {
        if (this.viewMode === 'list') {
            this.displayQuotesList(quotes);
        } else {
            this.displayQuotesGrid(quotes);
        }
    }

    displayQuotesGrid(quotes) {
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

    displayQuotesList(quotes) {
        const tableBody = document.getElementById('quotesTableBody');
        
        if (quotes.length === 0) {
            const emptyMessage = this.showingArchived ? 'No archived quotes found' : 'No active quotes found';
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 60px 20px; color: #64748b;">
                        ${emptyMessage}
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = quotes.map(quote => this.createQuoteRow(quote)).join('');
    }

    createQuoteRow(quote) {
        const total = quote.quoteData?.total || 0;
        const days = quote.quoteData?.days || [];
        const clientName = quote.clientName || '-';
        const location = quote.location || '-';
        const quoteTitle = quote.quoteData?.quoteTitle || quote.name;
        const isBooked = quote.booked || false;
        const createdBy = quote.createdBy?.name || '-';
        
        // Get earliest service date
        const daysWithDates = days.filter(day => day.date);
        let serviceDate = '-';
        if (daysWithDates.length > 0) {
            const dates = daysWithDates
                .map(day => this.parseStoredDate(day.date))
                .filter(date => date)
                .sort((a, b) => a - b);
            if (dates.length > 0) {
                serviceDate = this.formatDateShort(dates[0]);
            }
        }
        
        const createdDate = new Date(quote.createdAt).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        
        const modifiedDate = new Date(quote.updatedAt).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });

        return `
            <tr class="quote-row ${isBooked ? 'booked-row' : ''}" data-quote-name="${this.escapeHtml(quote.name)}" onclick="quotesManager.loadQuote('${this.escapeJs(quote.name)}')">
                <td class="quote-title-cell">
                    ${isBooked ? '<span class="booked-badge-small">BOOKED</span>' : ''}
                    <strong>${this.escapeHtml(quoteTitle)}</strong>
                </td>
                <td>${this.escapeHtml(clientName)}</td>
                <td>${this.escapeHtml(location)}</td>
                <td>${this.escapeHtml(createdBy)}</td>
                <td>${serviceDate}</td>
                <td>${createdDate}</td>
                <td>${modifiedDate}</td>
                <td class="total-cell">${this.formatCurrency(total)}</td>
                <td class="actions-cell" onclick="event.stopPropagation()">
                    <button class="table-action-btn secondary" onclick="quotesManager.openEditModal('${this.escapeJs(quote.name)}')" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                        </svg>
                    </button>
                    <button class="table-action-btn danger" onclick="quotesManager.deleteQuote('${this.escapeJs(quote.name)}')" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }

    createQuoteCard(quote) {
        const total = quote.quoteData?.total || 0;
        const days = quote.quoteData?.days || [];
        const clientName = quote.clientName || 'No client';
        const location = quote.location || '';
        const quoteTitle = quote.quoteData?.quoteTitle || quote.name;
        const isArchived = quote.archived || false;
        const isBooked = quote.booked || false;
        const createdBy = quote.createdBy?.name || 'Unknown User';
        
        // Calculate total services
        const totalServices = days.reduce((sum, day) => sum + (day.services?.length || 0), 0);
        
        // Get date range
        const dateRange = this.getQuoteDateRange(days);
        
        // Format dates
        const createdDate = new Date(quote.createdAt).toLocaleDateString();
        const updatedDate = new Date(quote.updatedAt).toLocaleDateString();

        return `
            <div class="quote-card ${isArchived ? 'archived' : ''}" data-quote-name="${this.escapeHtml(quote.name)}">
                ${isBooked ? '<div class="booked-banner">BOOKED</div>' : ''}
                <div class="quote-card-header">
                    <div class="quote-card-title-section">
                        <h3 class="quote-card-title">${this.escapeHtml(quoteTitle)}</h3>
                        ${isArchived ? '<span class="archived-badge">Archived</span>' : ''}
                    </div>
                    <div class="quote-card-header-right">
                        <div class="quote-card-total">${this.formatCurrency(total)}</div>
                        <div class="quote-overflow-menu">
                            <button class="quote-overflow-btn" onclick="quotesManager.toggleOverflowMenu(event, '${this.escapeJs(quote.name)}')" aria-label="More actions">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                    <circle cx="12" cy="12" r="1"></circle>
                                    <circle cx="12" cy="5" r="1"></circle>
                                    <circle cx="12" cy="19" r="1"></circle>
                                </svg>
                            </button>
                            <div class="quote-overflow-dropdown" id="overflow-${this.escapeHtml(quote.name).replace(/\s/g, '-')}" style="display: none;">
                                <button class="overflow-menu-item" onclick="quotesManager.toggleBookedStatus('${this.escapeJs(quote.name)}', ${!isBooked})">
                                    ${isBooked ? 'Mark as Not Booked' : 'Mark as Booked'}
                                </button>
                                <button class="overflow-menu-item danger" onclick="quotesManager.deleteQuote('${this.escapeJs(quote.name)}')">
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
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
                        <div class="info-row">
                            <span class="info-label">Created By:</span>
                            <span class="info-value">${this.escapeHtml(createdBy)}</span>
                        </div>
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
                    <button class="quote-action-btn secondary" onclick="quotesManager.openEditModal('${this.escapeJs(quote.name)}')">
                        Edit
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
        
        try {
            // Handle both ISO format and YYYY-MM-DD format
            if (dateString.includes('T')) {
                const date = new Date(dateString);
                return isNaN(date.getTime()) ? null : date;
            } else {
                // Parse YYYY-MM-DD format explicitly to avoid timezone issues
                const parts = dateString.split('-');
                if (parts.length !== 3) return null;
                
                const [year, month, day] = parts.map(Number);
                if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
                
                const date = new Date(year, month - 1, day);
                return isNaN(date.getTime()) ? null : date;
            }
        } catch (error) {
            console.error('Error parsing date:', dateString, error);
            return null;
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
        document.getElementById('userFilter').value = '';
        document.getElementById('bookedFilter').value = '';
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

    toggleView() {
        this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
        
        // Save preference to localStorage
        localStorage.setItem('quotesViewMode', this.viewMode);
        
        this.applyViewMode();
        this.filterAndSort();
        
        // Update sort indicators if switching to list view
        if (this.viewMode === 'list') {
            this.updateSortIndicators();
        }
    }

    applyViewMode() {
        const gridContainer = document.getElementById('quotesContainer');
        const listContainer = document.getElementById('quotesListView');
        const toggleText = document.getElementById('viewToggleText');
        const toggleIcon = document.getElementById('viewToggleIcon');
        const sortDropdown = document.getElementById('sortQuotes');
        
        if (this.viewMode === 'list') {
            gridContainer.style.display = 'none';
            listContainer.style.display = 'block';
            sortDropdown.style.display = 'none'; // Hide sort dropdown in list view
            toggleText.textContent = 'Grid View';
            toggleIcon.innerHTML = `
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
            `;
        } else {
            gridContainer.style.display = 'grid';
            listContainer.style.display = 'none';
            sortDropdown.style.display = 'block'; // Show sort dropdown in grid view
            toggleText.textContent = 'List View';
            toggleIcon.innerHTML = `
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
            `;
        }
    }

    sortByColumn(column) {
        // If clicking the same column, toggle direction
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        
        // Save sort preferences to localStorage
        localStorage.setItem('quotesSortColumn', this.sortColumn);
        localStorage.setItem('quotesSortDirection', this.sortDirection);
        
        this.filterAndSort();
        this.updateSortIndicators();
    }

    updateSortIndicators() {
        // Clear all indicators
        document.querySelectorAll('.sort-indicator').forEach(el => {
            el.textContent = '';
        });
        
        // Only update if we have a valid sort column for list view
        if (!this.sortColumn || this.sortColumn === 'created-newest') {
            return;
        }
        
        // Find the active column
        const headers = document.querySelectorAll('.quotes-table th.sortable');
        const columnMap = {
            'title': 0,
            'client': 1,
            'location': 2,
            'owner': 3,
            'date': 4,
            'created': 5,
            'modified': 6,
            'total': 7
        };
        
        const columnIndex = columnMap[this.sortColumn];
        if (columnIndex !== undefined && headers[columnIndex]) {
            const indicator = headers[columnIndex].querySelector('.sort-indicator');
            if (indicator) {
                indicator.textContent = this.sortDirection === 'asc' ? ' ▲' : ' ▼';
            }
        }
    }

    async loadQuote(quoteName) {
        try {
            this.showLoading(true);
            
            const response = await fetch(`/api/load-quote/${encodeURIComponent(quoteName)}`);
            if (!response.ok) {
                throw new Error('Failed to load quote');
            }
            
            const quoteData = await response.json();
            
            // Store quote data in session storage for calculator page to load
            sessionStorage.setItem('loadQuoteData', JSON.stringify(quoteData));
            
            // Navigate to calculator page
            window.location.href = '/calculator';
            
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

    toggleOverflowMenu(event, quoteName) {
        event.stopPropagation();
        const safeName = quoteName.replace(/\s/g, '-');
        const dropdown = document.getElementById(`overflow-${safeName}`);
        const card = event.target.closest('.quote-card');
        
        // Close all other dropdowns and remove elevated class from other cards
        document.querySelectorAll('.quote-overflow-dropdown').forEach(dd => {
            if (dd !== dropdown) {
                dd.style.display = 'none';
            }
        });
        document.querySelectorAll('.quote-card').forEach(c => {
            if (c !== card) {
                c.classList.remove('menu-open');
            }
        });
        
        // Toggle this dropdown
        if (dropdown.style.display === 'none') {
            dropdown.style.display = 'block';
            card.classList.add('menu-open'); // Keep card elevated while menu is open
            
            // Close dropdown when clicking outside
            setTimeout(() => {
                const closeDropdown = (e) => {
                    if (!e.target.closest('.quote-overflow-menu')) {
                        dropdown.style.display = 'none';
                        card.classList.remove('menu-open');
                        document.removeEventListener('click', closeDropdown);
                    }
                };
                document.addEventListener('click', closeDropdown);
            }, 0);
        } else {
            dropdown.style.display = 'none';
            card.classList.remove('menu-open');
        }
    }

    async toggleBookedStatus(quoteName, newBookedStatus) {
        try {
            this.showLoading(true);

            const response = await fetch(`/api/update-quote-metadata/${encodeURIComponent(quoteName)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    newName: quoteName,
                    booked: newBookedStatus
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to update booked status');
            }

            await this.loadQuotes();
            this.filterAndSort();

            const statusText = newBookedStatus ? 'booked' : 'not booked';
            showAlertModal(`Quote marked as ${statusText}!`, 'success', null, true);

        } catch (error) {
            console.error('Error updating booked status:', error);
            showAlertModal('Failed to update booked status. Please try again.', 'error');
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

    async openEditModal(quoteName) {
        const quote = this.allQuotes.find(q => q.name === quoteName);
        if (!quote) {
            showAlertModal('Quote not found.', 'error');
            return;
        }

        // Store the original quote name for the update
        this.editingQuoteName = quoteName;

        // Populate form fields
        document.getElementById('editQuoteName').value = quote.name;
        document.getElementById('editQuoteClient').value = quote.clientName || '';
        document.getElementById('editQuoteLocation').value = quote.location || '';
        document.getElementById('editQuoteBooked').checked = quote.booked || false;

        // Populate users dropdown
        const userSelect = document.getElementById('editQuoteCreatedBy');
        userSelect.innerHTML = '<option value="">-- Select User --</option>';
        this.users.forEach(user => {
            const option = document.createElement('option');
            option.value = user._id;
            option.textContent = user.name;
            if (quote.createdBy && quote.createdBy._id === user._id) {
                option.selected = true;
            }
            userSelect.appendChild(option);
        });

        // Show modal
        document.getElementById('editQuoteModal').style.display = 'flex';
    }

    closeEditModal() {
        document.getElementById('editQuoteModal').style.display = 'none';
        this.editingQuoteName = null;
    }

    async saveQuoteEdit(event) {
        event.preventDefault();

        const newName = document.getElementById('editQuoteName').value.trim();
        const clientName = document.getElementById('editQuoteClient').value.trim();
        const location = document.getElementById('editQuoteLocation').value.trim();
        const createdBy = document.getElementById('editQuoteCreatedBy').value || null;
        const booked = document.getElementById('editQuoteBooked').checked;

        if (!newName) {
            showAlertModal('Please enter a quote name.', 'error');
            return;
        }

        try {
            this.showLoading(true);

            const response = await fetch(`/api/update-quote-metadata/${encodeURIComponent(this.editingQuoteName)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    newName,
                    clientName: clientName || null,
                    location: location || null,
                    createdBy,
                    booked
                })
            });

            const result = await response.json();

            if (response.status === 409) {
                showAlertModal('A quote with this name already exists.', 'error');
                return;
            }

            if (!response.ok) {
                throw new Error(result.error || 'Failed to update quote');
            }

            await this.loadQuotes();
            this.filterAndSort();
            this.closeEditModal();

            showAlertModal('Quote updated successfully!', 'success', null, true);

        } catch (error) {
            console.error('Error updating quote:', error);
            showAlertModal('Failed to update quote. Please try again.', 'error');
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

// Clear quote data function (for New Quote button)
function clearQuoteData(event) {
    event.preventDefault();
    // Clear localStorage draft
    localStorage.removeItem('quote_calculator_draft');
    // Clear sessionStorage
    sessionStorage.removeItem('loadQuoteData');
    // Navigate to calculator
    window.location.href = '/calculator';
}

// Initialize quotes manager when page loads
let quotesManager;
document.addEventListener('DOMContentLoaded', () => {
    quotesManager = new QuotesManager();
});

