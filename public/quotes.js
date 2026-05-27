class QuotesManager {
    constructor() {
        this.allQuotes = [];
        this.showingArchived = false;
        this.users = [];
        // Load saved view preference or default to list
        this.viewMode = localStorage.getItem('quotesViewMode') || 'list';
        this.sortColumn = localStorage.getItem('quotesSortColumn') || 'created-newest';
        this.sortDirection = localStorage.getItem('quotesSortDirection') || 'desc';
        
        // Pagination state
        this.currentPage = 1;
        this.pageSize = 50;
        this.totalQuotes = 0;
        this.totalPages = 0;
        
        // Debounce timer for search
        this.searchDebounceTimer = null;
        
        this.init();
    }
    
    // Debounced search - waits 300ms after user stops typing
    debouncedSearch() {
        // Clear any existing timer
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
        
        // Set a new timer
        this.searchDebounceTimer = setTimeout(() => {
            this.filterAndSort();
        }, 300);
    }

    async init() {
        await this.loadUsers();
        await this.loadQuotes();
        this.applyViewMode(); // Apply saved view mode
        try {
            this.renderQuotes();
        } catch (error) {
            console.error('Error rendering quotes:', error);
            showAlertModal('Could not display quotes. Please refresh the page.', 'error');
        }
        this.updateStickyOffsets();
        
        // Update sort indicators if in list view
        if (this.viewMode === 'list') {
            this.updateSortIndicators();
        }
    }

    updateStickyOffsets() {
        if (window.AppShell?.updateLayoutOffsets) {
            window.AppShell.updateLayoutOffsets();
        }
    }

    async loadUsers() {
        // Users are now populated from quotes data in updateUserFilterFromQuotes()
        // This method is kept for compatibility but the filter is populated dynamically
        this.users = [];
    }

    async loadQuotes(options = {}) {
        const showSkeleton = options.showSkeleton !== false;
        try {
            if (showSkeleton) {
                this.showLoading(true);
            } else {
                this.setQuotesRefreshing(true);
            }
            
            // Build query parameters
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.pageSize,
                archived: this.showingArchived
            });
            
            // Add filters if set
            const searchTerm = document.getElementById('searchQuotes')?.value || '';
            const userFilter = document.getElementById('userFilter')?.value || '';
            const bookedFilter = document.getElementById('bookedFilter')?.value || '';
            
            if (searchTerm) params.append('search', searchTerm);
            if (userFilter) params.append('createdBy', userFilter);
            if (bookedFilter) params.append('booked', bookedFilter);
            
            // Add sort parameters for server-side sorting
            const sortDropdown = document.getElementById('sortQuotes')?.value || '';
            
            // Handle list view column sorting
            if (this.viewMode === 'list' && this.sortColumn && this.sortColumn !== 'created-newest') {
                // Map frontend column names to server field names
                const sortFieldMap = {
                    'title': 'name',
                    'client': 'clientName',
                    'location': 'location',
                    'owner': 'createdBy',
                    'date': 'startDate',
                    'created': 'createdAt',
                    'modified': 'updatedAt',
                    'total': 'total'
                };
                const serverSortField = sortFieldMap[this.sortColumn] || this.sortColumn;
                params.append('sortBy', serverSortField);
                params.append('sortDirection', this.sortDirection || 'asc');
            } 
            // Handle grid view dropdown sorting
            else if (sortDropdown) {
                const dropdownSortMap = {
                    'service-date-newest': { field: 'startDate', direction: 'desc' },
                    'service-date-oldest': { field: 'startDate', direction: 'asc' },
                    'newest': { field: 'updatedAt', direction: 'desc' },
                    'oldest': { field: 'updatedAt', direction: 'asc' },
                    'created-newest': { field: 'createdAt', direction: 'desc' },
                    'created-oldest': { field: 'createdAt', direction: 'asc' },
                    'name-asc': { field: 'name', direction: 'asc' },
                    'name-desc': { field: 'name', direction: 'desc' }
                };
                const sortConfig = dropdownSortMap[sortDropdown];
                if (sortConfig) {
                    params.append('sortBy', sortConfig.field);
                    params.append('sortDirection', sortConfig.direction);
                }
            }
            
            const response = await fetch(`/api/saved-quotes?${params}`);
            if (!response.ok) {
                throw new Error('Failed to load quotes');
            }
            
            const data = await response.json();
            
            // Handle both old format (array) and new format (object with pagination)
            if (Array.isArray(data)) {
                this.allQuotes = data;
                this.totalQuotes = data.length;
                this.totalPages = 1;
            } else {
                this.allQuotes = data.quotes || [];
                this.totalQuotes = data.total || 0;
                this.totalPages = data.totalPages || 1;
                this.currentPage = data.page || 1;
            }
            
            // Update user filter dropdown based on actual quotes
            this.updateUserFilterFromQuotes();
            
            // Update pagination controls
            this.renderPagination();
            
            console.log('📚 Loaded quotes:', {
                page: this.currentPage,
                pageSize: this.pageSize,
                loaded: this.allQuotes.length,
                total: this.totalQuotes,
                totalPages: this.totalPages
            });
        } catch (error) {
            console.error('Error loading quotes:', error);
            showAlertModal('Error loading quotes. Please try again.', 'error');
            this.allQuotes = [];
        } finally {
            if (showSkeleton) {
                this.showLoading(false);
            } else {
                this.setQuotesRefreshing(false);
            }
        }
    }

    setQuotesRefreshing(isRefreshing) {
        const dataArea = document.getElementById('quotesDataArea');
        if (dataArea) {
            dataArea.classList.toggle('is-refreshing', isRefreshing);
        }
    }
    
    renderPagination() {
        const container = document.getElementById('paginationContainer');
        if (!container) return;
        
        if (this.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, this.totalQuotes);
        
        let paginationHtml = `
            <div class="pagination-info">
                Showing ${startItem}-${endItem} of ${this.totalQuotes} quotes
            </div>
            <div class="pagination-controls">
                <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} onclick="quotesManager.goToPage(1)" title="First page">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="11 17 6 12 11 7"></polyline>
                        <polyline points="18 17 13 12 18 7"></polyline>
                    </svg>
                </button>
                <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} onclick="quotesManager.goToPage(${this.currentPage - 1})" title="Previous page">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
                <span class="pagination-current">Page ${this.currentPage} of ${this.totalPages}</span>
                <button class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} onclick="quotesManager.goToPage(${this.currentPage + 1})" title="Next page">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <button class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} onclick="quotesManager.goToPage(${this.totalPages})" title="Last page">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="13 17 18 12 13 7"></polyline>
                        <polyline points="6 17 11 12 6 7"></polyline>
                    </svg>
                </button>
            </div>
        `;
        
        container.innerHTML = paginationHtml;
    }
    
    async goToPage(page) {
        if (page < 1 || page > this.totalPages) return;
        this.currentPage = page;
        await this.loadQuotes({ showSkeleton: false });
        this.renderQuotes();
        
        // Scroll to top of quotes container
        document.querySelector('.quotes-section')?.scrollIntoView({ behavior: 'smooth' });
    }
    
    renderQuotes() {
        if (this.viewMode === 'grid') {
            this.displayQuotesGrid(this.allQuotes);
        } else {
            this.displayQuotesList(this.allQuotes);
        }
    }
    
    updateUserFilterFromQuotes() {
        const userFilter = document.getElementById('userFilter');
        if (!userFilter) return;
        
        const currentValue = userFilter.value; // Preserve current selection
        
        // Get unique creators from quotes
        const creatorsMap = new Map();
        this.allQuotes.forEach(quote => {
            if (quote.createdBy && quote.createdBy._id && quote.createdBy.name) {
                creatorsMap.set(quote.createdBy._id, quote.createdBy.name);
            }
        });
        
        // Sort creators alphabetically
        const sortedCreators = Array.from(creatorsMap.entries()).sort((a, b) => 
            a[1].localeCompare(b[1])
        );
        
        // Populate dropdown
        userFilter.innerHTML = '<option value="">All Users</option>';
        sortedCreators.forEach(([id, name]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            userFilter.appendChild(option);
        });
        
        // Restore previous selection if still valid
        if (currentValue && creatorsMap.has(currentValue)) {
            userFilter.value = currentValue;
        }
    }

    async filterAndSort() {
        const searchTerm = document.getElementById('searchQuotes')?.value || '';
        const sortBy = document.getElementById('sortQuotes')?.value || '';
        const dateFilter = document.getElementById('dateFilter')?.value || '';
        const userFilter = document.getElementById('userFilter')?.value || '';
        const bookedFilter = document.getElementById('bookedFilter')?.value || '';

        console.log('🔍 Filter and sort called:', {
            showingArchived: this.showingArchived,
            searchTerm,
            sortBy,
            dateFilter,
            userFilter,
            bookedFilter,
            sortColumn: this.sortColumn,
            sortDirection: this.sortDirection
        });

        // Update clear filters button visibility
        const clearBtn = document.getElementById('clearFiltersBtn');
        if (clearBtn) {
            if (searchTerm || dateFilter || userFilter || bookedFilter) {
                clearBtn.style.display = 'inline-block';
            } else {
                clearBtn.style.display = 'none';
            }
        }

        // Reset to page 1 when filters change
        this.currentPage = 1;
        
        // Reload quotes with filters and sorting from server
        await this.loadQuotes({ showSkeleton: false });
        
        // Apply date filter client-side (complex date parsing in quoteData.days)
        let filtered = [...this.allQuotes];
        if (dateFilter) {
            filtered = filtered.filter(quote => {
                const days = quote.quoteData?.days || [];
                return days.some(day => {
                    if (!day.date) return false;
                    const dayDate = this.normalizeDate(day.date);
                    const filterDate = this.normalizeDate(dateFilter);
                    return dayDate === filterDate;
                });
            });
        }

        // Display quotes - sorting is already done server-side
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

    getEmptyStateType() {
        const searchTerm = document.getElementById('searchQuotes')?.value || '';
        const dateFilter = document.getElementById('dateFilter')?.value || '';
        const userFilter = document.getElementById('userFilter')?.value || '';
        const bookedFilter = document.getElementById('bookedFilter')?.value || '';

        if (searchTerm || dateFilter || userFilter || bookedFilter) {
            return 'filtered';
        }
        if (this.showingArchived) {
            return 'archived';
        }
        return 'default';
    }

    getEmptyStateContent(type) {
        const states = {
            default: {
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
                title: 'No quotes yet',
                message: 'Create your first quote to get started. You can save, share, and book quotes from here.',
                primaryAction: `<button type="button" class="btn btn-primary btn-md primary-button" onclick="clearQuoteData(event)">New Quote</button>`
            },
            filtered: {
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
                title: 'No matching quotes',
                message: 'Try adjusting your search or filters to find what you are looking for.',
                primaryAction: `<button type="button" class="btn btn-secondary btn-md secondary-button" onclick="quotesManager.clearFilters()">Clear filters</button>`
            },
            archived: {
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`,
                title: 'No archived quotes',
                message: 'Quotes you archive will appear here for easy reference later.',
                primaryAction: `<button type="button" class="btn btn-secondary btn-md secondary-button" onclick="quotesManager.toggleArchiveView()">View active quotes</button>`
            }
        };
        return states[type] || states.default;
    }

    renderEmptyStateHTML(type) {
        const content = this.getEmptyStateContent(type);
        return `
            <div class="empty-state" role="status">
                <div class="empty-state__icon">${content.icon}</div>
                <h3 class="empty-state__title">${content.title}</h3>
                <p class="empty-state__message">${content.message}</p>
                <div class="empty-state__actions">${content.primaryAction}</div>
            </div>
        `;
    }

    renderSkeleton() {
        const skeleton = document.getElementById('quotesSkeleton');
        if (!skeleton) return;

        if (this.viewMode === 'list') {
            skeleton.className = 'quotes-skeleton quotes-skeleton--list';
            skeleton.innerHTML = Array.from({ length: 8 }, () => `
                <div class="skeleton-row">
                    <div class="skeleton-block skeleton-block--title"></div>
                    <div class="skeleton-block skeleton-block--line"></div>
                    <div class="skeleton-block skeleton-block--line"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                </div>
            `).join('');
        } else {
            skeleton.className = 'quotes-skeleton quotes-skeleton--grid';
            skeleton.innerHTML = Array.from({ length: 6 }, () => `
                <div class="skeleton-card">
                    <div class="skeleton-block skeleton-block--title"></div>
                    <div class="skeleton-block skeleton-block--line"></div>
                    <div class="skeleton-block skeleton-block--line"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                </div>
            `).join('');
        }
    }

    displayQuotesGrid(quotes) {
        const container = document.getElementById('quotesContainer');
        
        if (quotes.length === 0) {
            container.innerHTML = this.renderEmptyStateHTML(this.getEmptyStateType());
            return;
        }

        container.innerHTML = quotes.map(quote => this.createQuoteCard(quote)).join('');
    }

    displayQuotesList(quotes) {
        const tableBody = document.getElementById('quotesTableBody');
        
        if (quotes.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="empty-state-cell">
                        ${this.renderEmptyStateHTML(this.getEmptyStateType())}
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
        const isArchived = quote.archived || false;
        const isBooked = quote.booked || false;
        const createdBy = quote.createdBy?.name || '-';
        const isSharedWithMe = !quote.isOwner && quote.accessLevel;
        const hasShares = quote.sharedWith && quote.sharedWith.length > 0;
        
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

        const canEdit = quote.accessLevel !== 'read';
        const canDelete = quote.isOwner || this.isCurrentUserAdmin();
        const overflowMenuHtml = (canEdit || canDelete || isArchived) ? `
            <div class="quote-overflow-menu table-overflow-menu">
                <button class="table-action-btn secondary quote-overflow-btn" onclick="quotesManager.toggleOverflowMenu(event, '${this.escapeJs(quote.name)}')" aria-label="More actions">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                </button>
                <div class="quote-overflow-dropdown list-overflow-dropdown" style="display: none;">
                    ${canEdit ? `
                        <button class="overflow-menu-item" onclick="quotesManager.openEditModal('${this.escapeJs(quote.name)}')">Edit</button>
                    ` : ''}
                    ${isArchived ? `
                        <button class="overflow-menu-item" onclick="quotesManager.unarchiveQuote('${this.escapeJs(quote.name)}')">Unarchive</button>
                    ` : canEdit ? `
                        <button class="overflow-menu-item" onclick="quotesManager.archiveQuote('${this.escapeJs(quote.name)}')">Archive</button>
                    ` : ''}
                    ${canDelete ? `
                        <button class="overflow-menu-item danger" onclick="quotesManager.deleteQuote('${this.escapeJs(quote.name)}')">Delete</button>
                    ` : ''}
                </div>
            </div>
        ` : '';

        return `
            <tr class="quote-row ${isBooked ? 'booked-row' : ''} ${isSharedWithMe ? 'shared-row' : ''}" data-quote-name="${this.escapeHtml(quote.name)}" onclick="quotesManager.loadQuote('${this.escapeJs(quote.name)}')">
                <td class="quote-title-cell">
                    ${isBooked ? '<span class="status-badge status-badge--booked">Booked</span>' : ''}
                    ${isArchived ? '<span class="status-badge status-badge--archived">Archived</span>' : ''}
                    ${isSharedWithMe ? `<span class="shared-badge-small ${quote.accessLevel === 'read' ? 'read-only' : 'full-access'}">${quote.accessLevel === 'read' ? 'VIEW' : 'EDIT'}</span>` : ''}
                    ${hasShares && quote.isOwner ? `<span class="sharing-badge-small" title="Shared with ${quote.sharedWith.length} user(s)">👥</span>` : ''}
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
                    <div class="actions-cell-inner">
                    <button class="table-action-btn lumdash" onclick="quotesManager.transferToLumDash('${this.escapeJs(quote.name)}')" title="Transfer to LumDash">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M7 17L17 7"></path>
                            <path d="M7 7h10v10"></path>
                        </svg>
                    </button>
                    ${quote.isOwner || quote.accessLevel === 'full' ? `
                        <button class="table-action-btn share" onclick="quotesManager.openShareModal('${this.escapeJs(quote.name)}')" title="Share">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="18" cy="5" r="3"></circle>
                                <circle cx="6" cy="12" r="3"></circle>
                                <circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                        </button>
                    ` : ''}
                    ${quote.accessLevel !== 'read' ? `
                        <button class="table-action-btn booked${isBooked ? ' active' : ''}" onclick="quotesManager.toggleBookedStatus('${this.escapeJs(quote.name)}', ${!isBooked})" title="${isBooked ? 'Mark as Not Booked' : 'Mark as Booked'}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        </button>
                    ` : ''}
                    ${overflowMenuHtml}
                    </div>
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
        const isSharedWithMe = !quote.isOwner && quote.accessLevel;
        const hasShares = quote.sharedWith && quote.sharedWith.length > 0;
        
        // Calculate total services
        const totalServices = days.reduce((sum, day) => sum + (day.services?.length || 0), 0);
        
        // Get date range
        const dateRange = this.getQuoteDateRange(days);
        
        // Format dates
        const createdDate = new Date(quote.createdAt).toLocaleDateString();
        const updatedDate = new Date(quote.updatedAt).toLocaleDateString();

        return `
            <div class="quote-card ${isArchived ? 'archived' : ''} ${isSharedWithMe ? 'shared-quote' : ''}" data-quote-name="${this.escapeHtml(quote.name)}">
                ${isBooked ? '<div class="booked-banner">BOOKED</div>' : ''}
                <div class="quote-card-header">
                    <div class="quote-card-header-main">
                        <h3 class="quote-card-title" title="${this.escapeHtml(quoteTitle)}">${this.escapeHtml(quoteTitle)}</h3>
                        <div class="quote-card-badges">
                            ${isArchived ? '<span class="archived-badge">Archived</span>' : ''}
                            ${isSharedWithMe ? `<span class="shared-badge ${quote.accessLevel === 'read' ? 'read-only' : 'full-access'}">${quote.accessLevel === 'read' ? 'Shared (View)' : 'Shared (Edit)'}</span>` : ''}
                            ${hasShares && quote.isOwner ? `<span class="sharing-badge" title="Shared with ${quote.sharedWith.length} user(s)">👥 ${quote.sharedWith.length}</span>` : ''}
                        </div>
                    </div>
                    <div class="quote-card-header-aside">
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
                                ${quote.accessLevel !== 'read' ? `
                                    <button class="overflow-menu-item" onclick="quotesManager.toggleBookedStatus('${this.escapeJs(quote.name)}', ${!isBooked})">
                                        ${isBooked ? 'Mark as Not Booked' : 'Mark as Booked'}
                                    </button>
                                ` : ''}
                                ${quote.isOwner || this.isCurrentUserAdmin() ? `
                                    <button class="overflow-menu-item danger" onclick="quotesManager.deleteQuote('${this.escapeJs(quote.name)}')">
                                        Delete
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="quote-card-body">
                    <dl class="quote-card-info">
                        <div class="quote-card-info-row">
                            <dt>Client</dt>
                            <dd>${this.escapeHtml(clientName)}</dd>
                        </div>
                        ${location ? `
                            <div class="quote-card-info-row">
                                <dt>Location</dt>
                                <dd>${this.escapeHtml(location)}</dd>
                            </div>
                        ` : ''}
                        <div class="quote-card-info-row">
                            <dt>Created by</dt>
                            <dd>${this.escapeHtml(createdBy)}</dd>
                        </div>
                        ${dateRange ? `
                            <div class="quote-card-info-row">
                                <dt>Dates</dt>
                                <dd>${dateRange}</dd>
                            </div>
                        ` : ''}
                        <div class="quote-card-info-row">
                            <dt>Services</dt>
                            <dd>${totalServices} service${totalServices !== 1 ? 's' : ''} · ${days.length} day${days.length !== 1 ? 's' : ''}</dd>
                        </div>
                        <div class="quote-card-info-row">
                            <dt>Updated</dt>
                            <dd>${updatedDate}</dd>
                        </div>
                    </dl>
                </div>

                <div class="quote-card-actions">
                    <button class="quote-action-btn primary quote-action-btn--full" onclick="quotesManager.loadQuote('${this.escapeJs(quote.name)}')">
                        Open Quote
                    </button>
                    ${quote.accessLevel !== 'read' ? `
                        <button class="quote-action-btn secondary" onclick="quotesManager.openEditModal('${this.escapeJs(quote.name)}')">
                            Edit
                        </button>
                    ` : ''}
                    ${quote.isOwner || quote.accessLevel === 'full' ? `
                        <button class="quote-action-btn share" onclick="quotesManager.openShareModal('${this.escapeJs(quote.name)}')" title="Share Quote">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                <circle cx="18" cy="5" r="3"></circle>
                                <circle cx="6" cy="12" r="3"></circle>
                                <circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                            Share
                        </button>
                    ` : ''}
                    <button class="quote-action-btn lumdash" onclick="quotesManager.transferToLumDash('${this.escapeJs(quote.name)}')" title="Transfer to LumDash">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                            <path d="M7 17L17 7"></path>
                            <path d="M7 7h10v10"></path>
                        </svg>
                        LumDash
                    </button>
                    ${isArchived ? `
                        <button class="quote-action-btn secondary" onclick="quotesManager.unarchiveQuote('${this.escapeJs(quote.name)}')">
                            Unarchive
                        </button>
                    ` : `
                        ${quote.accessLevel !== 'read' ? `
                            <button class="quote-action-btn secondary" onclick="quotesManager.archiveQuote('${this.escapeJs(quote.name)}')">
                                Archive
                            </button>
                        ` : ''}
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
    
    isCurrentUserAdmin() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.role === 'admin';
    }

    escapeJs(text) {
        if (!text) return '';
        return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    }

    async clearFilters() {
        document.getElementById('searchQuotes').value = '';
        document.getElementById('dateFilter').value = '';
        document.getElementById('userFilter').value = '';
        document.getElementById('bookedFilter').value = '';
        this.currentPage = 1;
        await this.loadQuotes({ showSkeleton: false });
        this.renderQuotes();
    }

    async toggleArchiveView() {
        this.showingArchived = !this.showingArchived;
        this.currentPage = 1; // Reset to first page
        
        console.log('🔄 Toggle archive view:', this.showingArchived);
        
        const toggleText = document.getElementById('archiveToggleText');
        const archiveBtn = document.getElementById('archiveToggleBtn');
        const dataArea = document.getElementById('quotesDataArea');
        
        if (this.showingArchived) {
            if (toggleText) toggleText.textContent = 'View Active';
            archiveBtn?.classList.add('is-active');
            dataArea?.classList.add('showing-archived');
        } else {
            if (toggleText) toggleText.textContent = 'View Archived';
            archiveBtn?.classList.remove('is-active');
            dataArea?.classList.remove('showing-archived');
        }
        
        await this.loadQuotes({ showSkeleton: false });
        this.renderQuotes();
    }

    toggleView() {
        this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
        
        // Save preference to localStorage
        localStorage.setItem('quotesViewMode', this.viewMode);
        
        this.applyViewMode();
        this.renderQuotes();
        this.updateStickyOffsets();
        
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
            if (sortDropdown) sortDropdown.style.display = 'none';
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
            if (sortDropdown) sortDropdown.style.display = 'block';
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
            window.location.href = '/quote';
            
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

    closeOverflowMenus(exceptDropdown = null) {
        document.querySelectorAll('.quote-overflow-dropdown').forEach(dd => {
            if (dd !== exceptDropdown) {
                dd.style.display = 'none';
                this.resetListOverflowDropdown(dd);
            }
        });
        document.querySelectorAll('.quote-card.menu-open, .actions-cell.menu-open').forEach(c => {
            c.classList.remove('menu-open');
        });
    }

    resetListOverflowDropdown(dropdown) {
        if (!dropdown?.classList.contains('list-overflow-dropdown')) return;
        dropdown.style.position = '';
        dropdown.style.top = '';
        dropdown.style.right = '';
        dropdown.style.left = '';
        dropdown.style.bottom = '';
        dropdown.style.minWidth = '';
        dropdown.style.zIndex = '';
    }

    positionListOverflowDropdown(menu, dropdown) {
        const btn = menu.querySelector('.quote-overflow-btn');
        if (!btn) return;

        dropdown.style.display = 'block';
        dropdown.style.position = 'fixed';
        dropdown.style.minWidth = '200px';
        dropdown.style.zIndex = '150';

        const rect = btn.getBoundingClientRect();
        const dropdownHeight = dropdown.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (spaceBelow >= dropdownHeight + 8 || spaceBelow >= spaceAbove) {
            dropdown.style.top = `${rect.bottom + 4}px`;
        } else {
            dropdown.style.top = `${rect.top - dropdownHeight - 4}px`;
        }

        const dropdownWidth = dropdown.offsetWidth;
        dropdown.style.left = `${Math.max(8, rect.right - dropdownWidth)}px`;
        dropdown.style.right = 'auto';
        dropdown.style.bottom = 'auto';
    }

    toggleOverflowMenu(event, quoteName) {
        event.stopPropagation();
        const menu = event.target.closest('.quote-overflow-menu');
        if (!menu) return;

        const dropdown = menu.querySelector('.quote-overflow-dropdown');
        const isListMenu = dropdown.classList.contains('list-overflow-dropdown');
        const container = event.target.closest('.quote-card') || event.target.closest('.actions-cell');
        const isOpen = dropdown.style.display === 'block';

        this.closeOverflowMenus();

        if (isOpen) {
            dropdown.style.display = 'none';
            this.resetListOverflowDropdown(dropdown);
            return;
        }

        dropdown.style.display = 'block';
        if (container) container.classList.add('menu-open');

        if (isListMenu) {
            this.positionListOverflowDropdown(menu, dropdown);
        }

        const closeDropdown = (e) => {
            if (!e.target.closest('.quote-overflow-menu') && !e.target.closest('.list-overflow-dropdown')) {
                dropdown.style.display = 'none';
                this.resetListOverflowDropdown(dropdown);
                if (container) container.classList.remove('menu-open');
                document.removeEventListener('click', closeDropdown);
                window.removeEventListener('scroll', closeDropdown, true);
                window.removeEventListener('resize', closeDropdown);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeDropdown);
            window.addEventListener('scroll', closeDropdown, true);
            window.addEventListener('resize', closeDropdown);
        }, 0);
    }

    async toggleBookedStatus(quoteName, newBookedStatus) {
        const quote = this.allQuotes.find(q => q.name === quoteName);
        const wasPreviouslyBooked = quote?.booked || false;

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

            if (newBookedStatus && window.LumDashIntegration?.onQuoteMarkedAsBooked) {
                await window.LumDashIntegration.onQuoteMarkedAsBooked(quoteName, wasPreviouslyBooked);
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

        // Show modal
        document.getElementById('editQuoteModal').style.display = 'flex';
    }

    closeEditModal() {
        document.getElementById('editQuoteModal').style.display = 'none';
        this.editingQuoteName = null;
    }

    // ============== SHARE FUNCTIONALITY ==============
    
    async openShareModal(quoteName) {
        this.sharingQuoteName = quoteName;
        const quote = this.allQuotes.find(q => q.name === quoteName);
        
        if (!quote) {
            showAlertModal('Quote not found', 'error');
            return;
        }
        
        // Set quote name in modal
        document.getElementById('shareQuoteName').textContent = `"${quote.quoteData?.quoteTitle || quote.name}"`;
        
        // Reset form
        document.getElementById('shareUserSearch').value = '';
        document.getElementById('selectedShareUserId').value = '';
        document.getElementById('selectedUserName').textContent = '';
        document.querySelector('input[name="accessLevel"][value="read"]').checked = true;
        
        // Load users for dropdown
        await this.loadShareableUsers();
        
        // Load current shares
        await this.loadSharedUsers(quoteName);
        
        // Show modal
        document.getElementById('shareQuoteModal').style.display = 'flex';
        
        // Setup search functionality
        this.setupShareUserSearch();
    }
    
    closeShareModal() {
        document.getElementById('shareQuoteModal').style.display = 'none';
        document.getElementById('shareUserDropdown').style.display = 'none';
        this.sharingQuoteName = null;
    }
    
    async loadShareableUsers() {
        try {
            const response = await fetch('/api/shareable-users');
            if (!response.ok) throw new Error('Failed to load users');
            
            this.shareableUsers = await response.json();
        } catch (error) {
            console.error('Error loading shareable users:', error);
            this.shareableUsers = [];
        }
    }
    
    setupShareUserSearch() {
        const searchInput = document.getElementById('shareUserSearch');
        const dropdown = document.getElementById('shareUserDropdown');
        
        // Remove existing listeners
        const newSearchInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearchInput, searchInput);
        
        // Show dropdown on focus
        newSearchInput.addEventListener('focus', () => {
            this.renderShareUserDropdown('');
            dropdown.style.display = 'block';
        });
        
        // Filter on input
        newSearchInput.addEventListener('input', (e) => {
            this.renderShareUserDropdown(e.target.value);
            dropdown.style.display = 'block';
        });
        
        // Close dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.share-user-dropdown')) {
                dropdown.style.display = 'none';
            }
        });
    }
    
    renderShareUserDropdown(searchTerm) {
        const dropdown = document.getElementById('shareUserDropdown');
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        
        // Filter users based on search and exclude current user
        const filteredUsers = this.shareableUsers.filter(user => {
            const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase());
            const isNotCurrentUser = user.name !== currentUser.name;
            return matchesSearch && isNotCurrentUser;
        });
        
        if (filteredUsers.length === 0) {
            dropdown.innerHTML = '<div class="share-user-item no-results">No users found</div>';
            return;
        }
        
        dropdown.innerHTML = filteredUsers.map(user => `
            <div class="share-user-item" onclick="quotesManager.selectShareUser('${user._id}', '${this.escapeHtml(user.name)}')">
                <span class="share-user-name">${this.escapeHtml(user.name)}</span>
                ${user.email ? `<span class="share-user-email">${this.escapeHtml(user.email)}</span>` : ''}
            </div>
        `).join('');
    }
    
    selectShareUser(userId, userName) {
        document.getElementById('selectedShareUserId').value = userId;
        document.getElementById('selectedUserName').textContent = userName;
        document.getElementById('shareUserSearch').value = userName;
        document.getElementById('shareUserDropdown').style.display = 'none';
    }
    
    async addShare() {
        const userId = document.getElementById('selectedShareUserId').value;
        const accessLevel = document.querySelector('input[name="accessLevel"]:checked').value;
        
        if (!userId) {
            showAlertModal('Please select a user to share with', 'error');
            return;
        }
        
        try {
            const response = await fetch(`/api/quotes/${encodeURIComponent(this.sharingQuoteName)}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, accessLevel })
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to share quote');
            }
            
            // Clear selection
            document.getElementById('selectedShareUserId').value = '';
            document.getElementById('selectedUserName').textContent = '';
            document.getElementById('shareUserSearch').value = '';
            
            // Reload shared users list
            await this.loadSharedUsers(this.sharingQuoteName);
            
            // Reload quotes to update badges
            await this.loadQuotes();
            this.filterAndSort();
            
            showAlertModal(result.message || 'Quote shared successfully!', 'success', null, true);
            
        } catch (error) {
            console.error('Error sharing quote:', error);
            showAlertModal(error.message || 'Failed to share quote', 'error');
        }
    }
    
    async loadSharedUsers(quoteName) {
        const container = document.getElementById('sharedUsersList');
        
        try {
            const response = await fetch(`/api/quotes/${encodeURIComponent(quoteName)}/shared-with`);
            
            if (!response.ok) {
                throw new Error('Failed to load shared users');
            }
            
            const sharedUsers = await response.json();
            
            if (sharedUsers.length === 0) {
                container.innerHTML = '<p class="no-shares-message">Not shared with anyone yet</p>';
                return;
            }
            
            container.innerHTML = sharedUsers.map(share => `
                <div class="shared-user-item">
                    <div class="shared-user-info">
                        <span class="shared-user-name">${this.escapeHtml(share.user?.name || 'Unknown User')}</span>
                        <span class="shared-user-access ${share.accessLevel}">${share.accessLevel === 'read' ? 'Read Only' : 'Full Access'}</span>
                    </div>
                    <button class="remove-share-btn" onclick="quotesManager.removeShare('${share.user?._id}')" title="Remove access">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `).join('');
            
        } catch (error) {
            console.error('Error loading shared users:', error);
            container.innerHTML = '<p class="no-shares-message">Failed to load shared users</p>';
        }
    }
    
    async removeShare(userId) {
        if (!userId) return;
        
        const confirmed = await showConfirmModal(
            'Are you sure you want to remove this user\'s access?',
            'Remove Access',
            'Remove',
            'Cancel'
        );
        
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/quotes/${encodeURIComponent(this.sharingQuoteName)}/share/${userId}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Failed to remove access');
            }
            
            // Reload shared users list
            await this.loadSharedUsers(this.sharingQuoteName);
            
            // Reload quotes to update badges
            await this.loadQuotes();
            this.filterAndSort();
            
            showAlertModal('Access removed successfully', 'success', null, true);
            
        } catch (error) {
            console.error('Error removing share:', error);
            showAlertModal(error.message || 'Failed to remove access', 'error');
        }
    }

    // ============== END SHARE FUNCTIONALITY ==============

    async saveQuoteEdit(event) {
        event.preventDefault();

        const editingQuote = this.allQuotes.find(q => q.name === this.editingQuoteName);
        const wasPreviouslyBooked = editingQuote?.booked || false;

        const newName = document.getElementById('editQuoteName').value.trim();
        const clientName = document.getElementById('editQuoteClient').value.trim();
        const location = document.getElementById('editQuoteLocation').value.trim();
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

            if (booked && window.LumDashIntegration?.onQuoteMarkedAsBooked) {
                await window.LumDashIntegration.onQuoteMarkedAsBooked(newName, wasPreviouslyBooked);
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
        const dataArea = document.getElementById('quotesDataArea');
        const skeleton = document.getElementById('quotesSkeleton');

        if (!dataArea) return;

        if (show) {
            this.renderSkeleton();
            dataArea.classList.add('is-loading');
            dataArea.classList.remove('is-refreshing');
            if (skeleton) skeleton.setAttribute('aria-hidden', 'false');
        } else {
            dataArea.classList.remove('is-loading');
            dataArea.classList.remove('is-refreshing');
            if (skeleton) {
                skeleton.setAttribute('aria-hidden', 'true');
                skeleton.className = 'quotes-skeleton';
            }
        }
    }

    async transferToLumDash(quoteName) {
        const quote = this.allQuotes.find(q => q.name === quoteName);
        if (!quote) {
            showAlertModal('Quote not found.', 'error');
            return;
        }

        // Load full quote data if needed
        try {
            this.showLoading(true);
            
            const response = await fetch(`/api/load-quote/${encodeURIComponent(quoteName)}`);
            if (!response.ok) {
                throw new Error('Failed to load quote data');
            }
            
            const fullQuote = await response.json();
            
            this.showLoading(false);
            
            // Use the LumDash integration
            if (window.LumDashIntegration) {
                await window.LumDashIntegration.transferToLumDash(fullQuote);
            } else {
                showAlertModal('LumDash integration not loaded.', 'error');
            }
        } catch (error) {
            console.error('Error transferring to LumDash:', error);
            showAlertModal('Failed to transfer quote to LumDash.', 'error');
            this.showLoading(false);
        }
    }
}

// Initialize quotes manager when page loads
let quotesManager;
document.addEventListener('DOMContentLoaded', () => {
    quotesManager = new QuotesManager();
});

