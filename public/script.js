class QuoteCalculator {
    constructor() {
        this.services = [];
        this.days = [{ services: [], date: null }];
        this.discountPercentage = 0;
        this.markups = [];
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.currentBooked = false;
        this.currentCreatedBy = null;
        this.currentQuoteTitle = "Conference Services Quote";
        this.activeCalendar = null;
        this.autoSaveKey = 'quote_calculator_draft';
        this.isOverrideMode = false;
        this.users = [];
        
        // Auto-save state
        this.autoSaveTimeout = null;
        this.autoSaveDelay = 2000; // 2 seconds after last change
        this.isSaving = false;
        this.lastSavedTime = null;
        
        // Per-event discount toggle
        this.perEventDiscountEnabled = false;
        
        // Drag and drop state
        this.draggedElement = null;
        this.draggedData = null;
        
        // Touch drag state
        this.touchStartTime = 0;
        this.touchHoldTimer = null;
        this.touchStartPos = { x: 0, y: 0 };
        this.isDragging = false;
        this.touchMoved = false;
        this.mobileGhost = null;
        this.lastServiceTap = 0;
        this.tooltipTimeout = null;
        
        this.init();
    }

    setupEventListeners() {
        // Event listeners for other functionality can be added here
        // Markup event listeners are set up when the modals are shown
        console.log('✅ Base event listeners set up');
    }

    async init() {
        await this.loadServices();
        this.loadDraftFromLocalStorage();
        this.setupEventListeners();
        this.renderDays();
        this.updateTotal();
        this.renderMarkups();
        this.applyPerEventDiscountState();
    }

    loadDraftFromLocalStorage() {
        try {
            const savedDraft = localStorage.getItem(this.autoSaveKey);
            if (savedDraft) {
                const draftData = JSON.parse(savedDraft);
                this.days = draftData.days || [{ services: [], date: null }];
                this.discountPercentage = draftData.discountPercentage || 0;
                this.markups = draftData.markups || [];
                this.currentQuoteName = draftData.currentQuoteName || null;
                this.currentClientName = draftData.currentClientName || null;
                this.currentQuoteTitle = draftData.currentQuoteTitle || "Conference Services Quote";
                this.currentLocation = draftData.currentLocation || null;
                this.currentBooked = draftData.currentBooked || false;
                this.currentCreatedBy = draftData.currentCreatedBy || null;
                this.perEventDiscountEnabled = draftData.perEventDiscountEnabled || false;
                
                console.log('📄 Restoring from localStorage:', {
                    quoteName: this.currentQuoteName,
                    clientName: this.currentClientName,
                    quoteTitle: this.currentQuoteTitle,
                    location: this.currentLocation,
                    booked: this.currentBooked,
                    createdBy: this.currentCreatedBy
                });
                
                // Update the displays if we loaded data (with slight delay to ensure DOM is ready)
                setTimeout(() => {
                    this.updateQuoteTitleDisplay();
                    this.updateClientDisplay();
                    this.updateLocationDisplay();
                    this.applyPerEventDiscountState();
                    console.log('📄 Display updated after localStorage restore');
                }, 0);
                
                // Ensure existing services have tentative and discount properties
                this.days.forEach(day => {
                    day.services.forEach(service => {
                        if (service.tentative === undefined) {
                            service.tentative = false;
                        }
                        if (!service.discount) {
                            service.discount = {
                                type: 'percentage',
                                value: 0,
                                applied: false
                            };
                        }
                    });
                });
                
                console.log('📄 Loaded draft from localStorage');
            }
        } catch (error) {
            console.warn('⚠️ Error loading draft from localStorage:', error);
            // If there's an error, start fresh
            this.clearDraft();
        }
    }

    saveDraftToLocalStorage() {
        try {
            const draftData = {
                days: this.days,
                discountPercentage: this.discountPercentage,
                markups: this.markups,
                currentQuoteName: this.currentQuoteName,
                currentClientName: this.currentClientName,
                currentQuoteTitle: this.currentQuoteTitle,
                currentLocation: this.currentLocation,
                currentBooked: this.currentBooked,
                currentCreatedBy: this.currentCreatedBy,
                perEventDiscountEnabled: this.perEventDiscountEnabled,
                lastSaved: new Date().toISOString()
            };
            console.log('💾 Saving to localStorage:', {
                quoteName: draftData.currentQuoteName,
                clientName: draftData.currentClientName,
                quoteTitle: draftData.currentQuoteTitle,
                location: draftData.currentLocation,
                booked: draftData.currentBooked,
                createdBy: draftData.currentCreatedBy
            });
            localStorage.setItem(this.autoSaveKey, JSON.stringify(draftData));
            
            // Trigger auto-save to database if this is a loaded quote
            this.triggerAutoSave();
        } catch (error) {
            console.warn('⚠️ Error saving draft to localStorage:', error);
        }
    }

    clearDraft() {
        console.log('🗑️ clearDraft() called - clearing all data');
        console.trace('clearDraft stack trace');
        localStorage.removeItem(this.autoSaveKey);
        this.days = [{ services: [], date: null }];
        this.discountPercentage = 0;
        this.markups = [];
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.currentBooked = false;
        this.currentCreatedBy = null;
        this.currentQuoteTitle = "Conference Services Quote";
        this.currentLocation = null;
        this.perEventDiscountEnabled = false;
        
        // Reset auto-save state
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }
        this.lastSavedTime = null;
        this.updateSaveStatus('saved');
        
        // Reset title display
        const titleElement = document.getElementById('quoteTitle');
        if (titleElement) {
            titleElement.textContent = this.currentQuoteTitle;
        }
        
        // Reset override mode
        if (this.isOverrideMode) {
            this.toggleOverrideMode();
        }
        
        this.renderDays();
        this.renderMarkups();
        this.updateTotal();
        this.updateClientDisplay();
        this.updateLocationDisplay();
        console.log('🗑️ Draft cleared from localStorage');
    }

    async loadServices() {
        try {
            const response = await fetch('/api/services');
            this.services = await response.json();
            
            // Ensure existing services in days have quantity property and days have date property
            this.days.forEach(day => {
                if (day.date === undefined) {
                    day.date = null;
                }
                day.services.forEach(service => {
                    if (!service.quantity) {
                        service.quantity = 1;
                    }
                });
            });
        } catch (error) {
            console.error('Error loading services:', error);
            this.services = [];
        }
    }

    setupEventListeners() {
        document.getElementById('increase-days').addEventListener('click', () => this.addDay());
        document.getElementById('decrease-days').addEventListener('click', () => this.removeDay());
        document.getElementById('generate-pdf').addEventListener('click', () => this.generatePDF());
        document.getElementById('export-excel').addEventListener('click', () => this.exportExcel());
        document.getElementById('export-docx').addEventListener('click', () => this.exportDocx());
        
        // Save modal form submission
        document.getElementById('saveQuoteForm').addEventListener('submit', (e) => this.saveQuoteFromModal(e));
    }

    addDay() {
        this.days.push({ services: [], date: null });
        this.updateDaysDisplay();
        this.renderDays();
        this.updateTotal();
        this.markQuoteAsModified(); // Mark as modified when structure changes
        this.saveDraftToLocalStorage();
    }

    removeDay() {
        if (this.days.length > 1) {
            this.days.pop();
            this.updateDaysDisplay();
            this.renderDays();
            this.updateTotal();
            this.markQuoteAsModified(); // Mark as modified when structure changes
            this.saveDraftToLocalStorage();
        }
    }

    updateDaysDisplay() {
        document.getElementById('days-count').textContent = this.days.length;
        
        // Update button states
        const decreaseBtn = document.getElementById('decrease-days');
        decreaseBtn.disabled = this.days.length <= 1;
    }

    getServiceById(serviceId) {
        return this.services.find(service => service._id === serviceId);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeJavaScript(text) {
        if (!text) return "''";
        return JSON.stringify(text);
    }

    getQuoteDateRange(days) {
        // Find all days with dates
        const daysWithDates = days.filter(day => day.date);
        
        if (daysWithDates.length === 0) {
            return null; // No dates assigned
        }
        
        // Parse and sort dates
        const dates = daysWithDates
            .map(day => this.parseStoredDate(day.date))
            .filter(date => date) // Filter out invalid dates
            .sort((a, b) => a - b);
        
        if (dates.length === 0) {
            return null; // No valid dates
        }
        
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];
        
        // Format dates for display
        const startFormatted = this.formatDate(startDate);
        
        if (dates.length === 1) {
            return startFormatted; // Single date
        } else {
            const endFormatted = this.formatDate(endDate);
            return `${startFormatted} - ${endFormatted}`; // Date range
        }
    }

    renderDays() {
        const container = document.getElementById('days-container');
        container.innerHTML = '';

        this.days.forEach((day, dayIndex) => {
            // On mobile, add day header as separate row first
            if (day.services.length > 0 && window.innerWidth < 768) {
                const dayHeaderRow = document.createElement('div');
                dayHeaderRow.className = 'day-row mobile-day-header-row';
                dayHeaderRow.innerHTML = `
                    <div class="day-cell">
                        <span class="day-header ${day.date ? 'has-date' : ''}" 
                              onclick="calculator.showCalendar(${dayIndex}, this)"
                              ontouchend="event.preventDefault(); event.stopPropagation(); calculator.showCalendar(${dayIndex}, this);">
                            ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                        </span>
                        ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
                    </div>
                `;
                container.appendChild(dayHeaderRow);
                
                // Add column headers after day header
                const columnHeaderRow = document.createElement('div');
                columnHeaderRow.className = 'mobile-column-header';
                columnHeaderRow.innerHTML = `
                    <div class="header-service">SERVICE</div>
                    <div class="header-qty">QTY</div>
                    <div class="header-price">PRICE</div>
                `;
                container.appendChild(columnHeaderRow);
            }
            
            // Render each service as its own row
            day.services.forEach((service, serviceIndex) => {
                const serviceRow = document.createElement('div');
                serviceRow.className = 'day-row draggable-service';
                serviceRow.draggable = true;
                serviceRow.dataset.dayIndex = dayIndex;
                serviceRow.dataset.serviceIndex = serviceIndex;
                serviceRow.dataset.serviceId = service.id;
                
                const isEdited = service.isNameEdited || service.isPriceEdited || service.isDescriptionEdited;
                const overrideCursor = this.isOverrideMode ? 'override-mode' : '';
                
                // Get description - use service-specific description if available, otherwise fall back to global
                const serviceDescription = service.description !== undefined ? service.description : this.getServiceById(service.id)?.description;
                
                // On mobile, don't include day header in service rows
                const includeDayHeader = window.innerWidth >= 768 && serviceIndex === 0;
                
                serviceRow.innerHTML = `
                    <div class="day-cell">
                        ${includeDayHeader ? `
                                                    <span class="day-header ${day.date ? 'has-date' : ''}" 
                                  onclick="calculator.showCalendar(${dayIndex}, this)"
                                  ontouchend="event.preventDefault(); event.stopPropagation(); calculator.showCalendar(${dayIndex}, this);">
                            ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                        </span>
                            ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
                        ` : ''}
                    </div>
                    <div class="service-cell">
                        <div class="service-name ${this.getServiceById(service.id)?.isSubservice ? 'subservice' : ''} ${serviceDescription ? 'has-tooltip' : ''} ${service.tentative ? 'tentative' : ''} ${overrideCursor}" 
                             oncontextmenu="calculator.showTentativeContextMenu(event, ${dayIndex}, ${serviceIndex}); return false;">
                            <span class="drag-handle">⋮⋮</span>
                            <span class="service-text">${this.getServiceById(service.id)?.isSubservice ? '└─ ' : ''}${this.escapeHtml(service.name)}${service.tentative ? ' (Tentative)' : ''}</span>
                            ${isEdited ? '<span class="edited-badge">Edited</span>' : ''}
                            ${service.discount && service.discount.applied ? `<div class="service-discount-indicator">${service.discount.type === 'percentage' ? `${service.discount.value}% off` : `${this.formatCurrency(service.discount.value)} off`}</div>` : ''}
                            ${serviceDescription ? `<div class="tooltip">${this.escapeHtml(serviceDescription)}</div>` : ''}
                        </div>
                        <button class="service-discount-btn ${service.discount && service.discount.applied ? 'has-discount' : ''}" 
                                onclick="calculator.openServiceDiscountModal(${dayIndex}, ${serviceIndex})"
                                title="${service.discount && service.discount.applied ? 'Edit discount' : 'Add discount'}">
                            %
                        </button>
                        <button class="remove-service" 
                                onclick="calculator.removeService(${dayIndex}, ${serviceIndex})"
                                ontouchend="if(event.target === this) { event.preventDefault(); calculator.removeService(${dayIndex}, ${serviceIndex}); }">×</button>
                    </div>
                    <div class="quantity-cell">
                        <input type="number" 
                               class="quantity-input" 
                               value="${service.quantity}" 
                               min="1" 
                               max="99"
                               onchange="calculator.updateQuantity(${dayIndex}, ${serviceIndex}, this.value)"
                               onclick="this.select()"
                               ontouchend="this.focus()">
                    </div>
                    <div class="price-cell ${service.tentative ? 'tentative' : ''}">
                        ${(() => {
                            const originalPrice = service.price * service.quantity;
                            const discount = this.calculateServiceDiscount(service);
                            const finalPrice = originalPrice - discount;
                            
                            if (service.tentative) {
                                return `(${this.formatCurrency(finalPrice)})`;
                            } else if (discount > 0) {
                                return `
                                    <div class="price-with-discount">
                                        <span class="original-price">${this.formatCurrency(originalPrice)}</span>
                                        <span class="discounted-price">${this.formatCurrency(finalPrice)}</span>
                                    </div>
                                `;
                            } else {
                                return this.formatCurrency(originalPrice);
                            }
                        })()}
                    </div>
                `;
                
                // Add drag event handlers directly to the element (like admin panel)
                serviceRow.ondragstart = (e) => this.handleDragStart(e);
                serviceRow.ondragover = (e) => this.handleDragOverWithCalendarProtection(e);
                serviceRow.ondrop = (e) => this.handleDrop(e);
                serviceRow.ondragend = (e) => this.handleDragEnd(e);
                
                // Add touch event handlers for mobile drag and drop
                serviceRow.ontouchstart = (e) => this.handleTouchStart(e);
                serviceRow.ontouchmove = (e) => this.handleTouchMove(e);
                serviceRow.ontouchend = (e) => this.handleTouchEnd(e);
                serviceRow.ontouchcancel = (e) => this.handleTouchEnd(e);
                
                // Add double-tap handler for tentative marking on mobile
                serviceRow.addEventListener('touchend', (e) => this.handleServiceDoubleTap(e, dayIndex, serviceIndex));
                
                // Add override mode click handler (mobile-friendly)
                if (this.isOverrideMode) {
                    const serviceName = serviceRow.querySelector('.service-name');
                    
                    // Desktop click handler
                    serviceName.addEventListener('click', (e) => {
                        // Only handle click if it's not from a drag handle
                        if (!e.target.closest('.drag-handle')) {
                            e.preventDefault();
                            e.stopPropagation();
                            this.openEditServiceModal(dayIndex, serviceIndex);
                        }
                    });
                    
                    // Mobile touch handler
                    serviceName.addEventListener('touchend', (e) => {
                        // Only handle if it's a tap (not drag) and not on drag handle
                        if (!this.touchMoved && !this.isDragging && !e.target.closest('.drag-handle')) {
                            e.preventDefault();
                            e.stopPropagation();
                            this.openEditServiceModal(dayIndex, serviceIndex);
                        }
                    });
                }
                
                // Add click handler for tooltip (only if service has description)
                if (!this.isOverrideMode && this.getServiceById(service.id)?.description) {
                    const serviceName = serviceRow.querySelector('.service-name');
                    serviceName.addEventListener('click', (e) => this.handleServiceClick(e, dayIndex, serviceIndex));
                }
                
                container.appendChild(serviceRow);
            });

            // Add the "Add Service" row for each day
            if (day.services.length === 0) {
                // On mobile, add day header first
                if (window.innerWidth < 768) {
                    const dayHeaderRow = document.createElement('div');
                    dayHeaderRow.className = 'day-row mobile-day-header-row';
                    dayHeaderRow.innerHTML = `
                        <div class="day-cell">
                            <span class="day-header ${day.date ? 'has-date' : ''}" 
                                  onclick="calculator.showCalendar(${dayIndex}, this)"
                                  ontouchend="event.preventDefault(); event.stopPropagation(); calculator.showCalendar(${dayIndex}, this);">
                                ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                            </span>
                            ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
                        </div>
                    `;
                    container.appendChild(dayHeaderRow);
                    
                    // Add column headers
                    const columnHeaderRow = document.createElement('div');
                    columnHeaderRow.className = 'mobile-column-header';
                    columnHeaderRow.innerHTML = `
                        <div class="header-service">SERVICE</div>
                        <div class="header-qty">QTY</div>
                        <div class="header-price">PRICE</div>
                    `;
                    container.appendChild(columnHeaderRow);
                }
                
                // Empty day row with drop zone functionality
                const emptyRow = document.createElement('div');
                emptyRow.className = 'day-row empty-day-drop-zone';
                emptyRow.dataset.dayIndex = dayIndex;
                emptyRow.dataset.serviceIndex = 0; // First service position
                emptyRow.dataset.isDropZone = 'true';
                emptyRow.dataset.isEmpty = 'true';
                
                // On desktop, include day header; on mobile, don't
                const includeDayHeader = window.innerWidth >= 768;
                
                emptyRow.innerHTML = `
                    <div class="day-cell">
                        ${includeDayHeader ? `
                            <span class="day-header ${day.date ? 'has-date' : ''}" 
                                  onclick="calculator.showCalendar(${dayIndex}, this)"
                                  ontouchend="event.preventDefault(); event.stopPropagation(); calculator.showCalendar(${dayIndex}, this);">
                                ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                            </span>
                            ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
                        ` : ''}
                    </div>
                    <div class="service-cell empty-service">
                        <span class="empty-text">No services selected</span>
                        <span class="drop-hint">Drop services here</span>
                    </div>
                    <div class="quantity-cell"></div>
                    <div class="price-cell">$0</div>
                `;
                
                // Add drag event handlers
                emptyRow.ondragover = (e) => this.handleDragOverWithCalendarProtection(e);
                emptyRow.ondrop = (e) => this.handleDrop(e);
                
                // Add touch event handlers for drop zones
                emptyRow.ontouchmove = (e) => this.handleTouchMove(e);
                emptyRow.ontouchend = (e) => this.handleTouchEnd(e);
                
                container.appendChild(emptyRow);
            }

            // Add invisible drop zone at the bottom of each day (only if day has services)
            if (day.services.length > 0) {
                const dropZone = document.createElement('div');
                dropZone.className = 'day-row drop-zone';
                dropZone.dataset.dayIndex = dayIndex;
                dropZone.dataset.serviceIndex = day.services.length; // Insert at end
                dropZone.dataset.isDropZone = 'true';
                
                dropZone.innerHTML = `
                    <div class="day-cell"></div>
                    <div class="service-cell drop-zone-indicator"></div>
                    <div class="quantity-cell"></div>
                    <div class="price-cell"></div>
                `;
                
                // Add drag event handlers
                dropZone.ondragover = (e) => this.handleDragOverWithCalendarProtection(e);
                dropZone.ondrop = (e) => this.handleDrop(e);
                
                // Add touch event handlers for drop zones
                dropZone.ontouchmove = (e) => this.handleTouchMove(e);
                dropZone.ontouchend = (e) => this.handleTouchEnd(e);
                
                container.appendChild(dropZone);
            }

            // Add service button row
            const addRow = document.createElement('div');
            addRow.className = 'day-row add-service-row';
            addRow.innerHTML = `
                <div class="day-cell"></div>
                <div class="service-cell">
                    <button class="add-service-btn" onclick="calculator.addServiceSelector(${dayIndex})">
                        + Add Service
                    </button>
                </div>
                <div class="quantity-cell"></div>
                <div class="price-cell"></div>
            `;
            container.appendChild(addRow);
        });

        this.updateDaysDisplay();
    }

    addServiceSelector(dayIndex) {
        // Find the add service button that was clicked
        const container = document.getElementById('days-container');
        const addButtons = container.querySelectorAll('.add-service-btn');
        let targetAddRow = null;
        
        // Find which add button corresponds to this dayIndex
        addButtons.forEach(button => {
            const buttonText = button.textContent.trim();
            if (buttonText === '+ Add Service') {
                const row = button.closest('.day-row');
                // Check if this is the right day by counting previous add-service-rows
                const allAddRows = Array.from(container.querySelectorAll('.add-service-row'));
                const thisRowIndex = allAddRows.indexOf(row);
                if (thisRowIndex === dayIndex) {
                    targetAddRow = row;
                }
            }
        });
        
        if (!targetAddRow) return;
        
        // Create dropdown row
        const dropdownRow = document.createElement('div');
        dropdownRow.className = 'day-row';
        
        const dropdown = document.createElement('select');
        dropdown.className = 'service-dropdown';
        dropdown.innerHTML = `
            <option value="">Select a service...</option>
            ${this.services.map(service => `
                <option value="${service._id}" data-name="${service.name}" data-price="${service.price}">
                    ${service.isSubservice ? '└─ ' : ''}${service.name} - ${this.formatCurrency(service.price)}
                </option>
            `).join('')}
        `;

        dropdown.addEventListener('change', async (e) => {
            if (e.target.value) {
                const option = e.target.selectedOptions[0];
                const service = {
                    id: e.target.value,
                    name: option.dataset.name,
                    price: parseFloat(option.dataset.price)
                };
                
                // Validate dependencies before adding (skip in override mode)
                if (this.isOverrideMode) {
                    // In override mode, bypass all dependency checks
                    this.addServiceToDay(dayIndex, service);
                    dropdownRow.remove();
                } else {
                    const canAdd = await this.validateServiceDependency(service.id, dayIndex);
                    if (canAdd.success) {
                        this.addServiceToDay(dayIndex, service);
                        dropdownRow.remove();
                    } else {
                        // Show error and don't add service
                        this.showDependencyError(canAdd.error);
                        dropdown.value = ''; // Reset dropdown
                    }
                }
            }
        });

        dropdown.addEventListener('blur', () => {
            if (!dropdown.value) {
                dropdownRow.remove();
            }
        });

        // Structure the dropdown row with 4 columns
        dropdownRow.innerHTML = `
            <div class="day-cell"></div>
            <div class="service-cell">
                <div class="service-dropdown-container"></div>
            </div>
            <div class="quantity-cell"></div>
            <div class="price-cell"></div>
        `;
        
        dropdownRow.querySelector('.service-dropdown-container').appendChild(dropdown);
        container.insertBefore(dropdownRow, targetAddRow);
        dropdown.focus();
    }

    addServiceToDay(dayIndex, service) {
        // Add quantity property with default value of 1
        service.quantity = 1;
        // Add tentative property if not present
        if (service.tentative === undefined) {
            service.tentative = false;
        }
        // Add discount property if not present
        if (!service.discount) {
            service.discount = {
                type: 'percentage', // 'percentage' or 'fixed'
                value: 0,
                applied: false
            };
        }
        
        this.days[dayIndex].services.push(service);
        this.renderDays();
        this.updateTotal();
        this.markQuoteAsModified();
        this.saveDraftToLocalStorage();
    }

    removeService(dayIndex, serviceIndex) {
        const serviceToRemove = this.days[dayIndex].services[serviceIndex];
        
        // In override mode, bypass all dependency checks
        if (this.isOverrideMode) {
            this.days[dayIndex].services.splice(serviceIndex, 1);
            this.renderDays();
            this.updateTotal();
            return;
        }
        
        // Check if removing this service would leave zero instances of this service type
        const remainingInstances = this.countServiceInstances(serviceToRemove.id, dayIndex, serviceIndex);
        
        // If this would be the last instance, check if any services depend on it
        if (remainingInstances === 0) {
            const dependentServices = this.findDependentServices(serviceToRemove.id, dayIndex);
            
            if (dependentServices.length > 0) {
                this.showDependencyRemovalError(serviceToRemove.name, dependentServices);
                return;
            }
        }
        
        // Safe to remove (either not the last instance, or no dependencies)
        this.days[dayIndex].services.splice(serviceIndex, 1);
        this.renderDays();
        this.updateTotal();
    }

    countServiceInstances(serviceId, excludeDayIndex = -1, excludeServiceIndex = -1) {
        let count = 0;
        
        this.days.forEach((day, dIndex) => {
            day.services.forEach((service, sIndex) => {
                // Skip the service we're considering removing
                if (dIndex === excludeDayIndex && sIndex === excludeServiceIndex) {
                    return;
                }
                
                if (service.id === serviceId) {
                    count++;
                }
            });
        });
        
        return count;
    }

    removeDayByIndex(dayIndex) {
        if (this.days.length > 1) {
            // In override mode, bypass all dependency checks
            if (this.isOverrideMode) {
                this.days.splice(dayIndex, 1);
                this.renderDays();
                this.updateTotal();
                return;
            }
            
            // Check if removing this day would break any dependencies
            const dayServices = this.days[dayIndex].services;
            let blockingDependencies = [];
            
            for (const service of dayServices) {
                // Count how many instances of this service would remain after removing this day
                const remainingInstances = this.countServiceInstancesExcludingDay(service.id, dayIndex);
                
                // Only check dependencies if this would be the last instance(s) of this service
                if (remainingInstances === 0) {
                    const dependentServices = this.findDependentServices(service.id, dayIndex);
                    if (dependentServices.length > 0) {
                        blockingDependencies.push({
                            service: service.name,
                            dependents: dependentServices
                        });
                    }
                }
            }
            
            if (blockingDependencies.length > 0) {
                this.showDayRemovalError(dayIndex + 1, blockingDependencies);
                return;
            }
            
            // Safe to remove
            this.days.splice(dayIndex, 1);
            this.renderDays();
            this.updateTotal();
        }
    }

    countServiceInstancesExcludingDay(serviceId, excludeDayIndex) {
        let count = 0;
        
        this.days.forEach((day, dIndex) => {
            // Skip the day we're considering removing
            if (dIndex === excludeDayIndex) {
                return;
            }
            
            day.services.forEach(service => {
                if (service.id === serviceId) {
                    count++;
                }
            });
        });
        
        return count;
    }

    updateQuantity(dayIndex, serviceIndex, newQuantity) {
        const quantity = Math.max(1, Math.min(99, parseInt(newQuantity) || 1));
        this.days[dayIndex].services[serviceIndex].quantity = quantity;
        this.renderDays();
        this.updateTotal();
        this.saveDraftToLocalStorage();
    }

    calculateDayTotal(dayIndex) {
        return this.days[dayIndex].services.reduce((total, service) => {
            const serviceTotal = service.price * service.quantity;
            const serviceDiscount = this.calculateServiceDiscount(service);
            return total + (serviceTotal - serviceDiscount);
        }, 0);
    }
    
    calculateServiceDiscount(service) {
        if (!service.discount || !service.discount.applied || service.discount.value === 0) {
            return 0;
        }
        
        const serviceTotal = service.price * service.quantity;
        let discountAmount = 0;
        
        if (service.discount.type === 'percentage') {
            discountAmount = serviceTotal * (service.discount.value / 100);
        } else {
            discountAmount = service.discount.value;
        }
        
        // Ensure discount doesn't exceed service total
        return Math.min(discountAmount, serviceTotal);
    }

    calculateTotal() {
        return this.days.reduce((total, day) => {
            return total + day.services.reduce((dayTotal, service) => {
                if (service.tentative) return dayTotal;
                
                const serviceTotal = service.price * service.quantity;
                const serviceDiscount = this.calculateServiceDiscount(service);
                return dayTotal + (serviceTotal - serviceDiscount);
            }, 0);
        }, 0);
    }

    calculateTentativeTotal() {
        return this.days.reduce((total, day) => {
            return total + day.services.reduce((dayTotal, service) => {
                return dayTotal + (service.tentative ? (service.price * service.quantity) : 0);
            }, 0);
        }, 0);
    }

    updateTotal() {
        const subtotal = this.calculateTotal();
        const markupsTotal = this.calculateMarkupsTotal();
        const subtotalWithMarkups = subtotal + markupsTotal;
        const discountAmount = subtotalWithMarkups * (this.discountPercentage / 100);
        const total = subtotalWithMarkups - discountAmount;
        const tentativeTotal = this.calculateTentativeTotal();
        
        // Update display based on whether discount is applied or markups exist
        if (this.discountPercentage > 0 || markupsTotal > 0) {
            // Show subtotal, markups (if any), discount (if any), and total
            document.getElementById('subtotalRow').style.display = 'flex';
            document.getElementById('subtotal-amount').textContent = this.formatCurrency(subtotal);
            
            // Handle markups row
            let markupsRow = document.getElementById('markupsRow');
            if (markupsTotal > 0) {
                if (!markupsRow) {
                    // Create markups row if it doesn't exist
                    const subtotalRowElement = document.getElementById('subtotalRow');
                    markupsRow = document.createElement('div');
                    markupsRow.className = 'summary-row';
                    markupsRow.id = 'markupsRow';
                    markupsRow.innerHTML = `
                        <span>Markups</span>
                        <span id="markups-amount">$0</span>
                    `;
                    subtotalRowElement.parentNode.insertBefore(markupsRow, subtotalRowElement.nextSibling);
                }
                markupsRow.style.display = 'flex';
                document.getElementById('markups-amount').textContent = this.formatCurrency(markupsTotal);
            } else if (markupsRow) {
                markupsRow.style.display = 'none';
            }
            
            // Handle discount row
            if (this.discountPercentage > 0) {
                document.getElementById('discountRow').style.display = 'flex';
                document.getElementById('discount-label').textContent = `Discount (${this.discountPercentage}%)`;
                document.getElementById('discount-amount').textContent = `-${this.formatCurrency(discountAmount)}`;
            } else {
                document.getElementById('discountRow').style.display = 'none';
            }
            
            document.getElementById('total-amount').textContent = this.formatCurrency(total);
        } else {
            // Hide subtotal, markups, and discount rows, show only total
            document.getElementById('subtotalRow').style.display = 'none';
            document.getElementById('discountRow').style.display = 'none';
            const markupsRow = document.getElementById('markupsRow');
            if (markupsRow) markupsRow.style.display = 'none';
            document.getElementById('total-amount').textContent = this.formatCurrency(subtotal);
        }
        
        // Update tentative total display (with discount applied)
        const tentativeRow = document.getElementById('tentativeRow');
        if (tentativeTotal > 0) {
            const tentativeDiscountAmount = tentativeTotal * (this.discountPercentage / 100);
            const finalTentativeTotal = tentativeTotal - tentativeDiscountAmount;
            
            if (!tentativeRow) {
                // Create tentative total row if it doesn't exist
                const totalsContainer = document.querySelector('.quote-summary');
                const tentativeRowElement = document.createElement('div');
                tentativeRowElement.className = 'summary-row tentative-row';
                tentativeRowElement.id = 'tentativeRow';
                tentativeRowElement.innerHTML = `
                    <span class="summary-label tentative-label">Tentative Total:</span>
                    <span class="summary-amount tentative-amount">(${this.formatCurrency(finalTentativeTotal)})</span>
                `;
                totalsContainer.appendChild(tentativeRowElement);
            } else {
                tentativeRow.querySelector('.tentative-amount').textContent = `(${this.formatCurrency(finalTentativeTotal)})`;
            }
        } else if (tentativeRow) {
            tentativeRow.remove();
        }
        
        // Enable/disable PDF, Excel and DOCX buttons
        const pdfButton = document.getElementById('generate-pdf');
        const excelButton = document.getElementById('export-excel');
        const docxButton = document.getElementById('export-docx');
        const hasServices = this.days.some(day => day.services.length > 0);
        
        pdfButton.disabled = !hasServices;
        excelButton.disabled = !hasServices;
        docxButton.disabled = !hasServices;
        
        if (hasServices) {
            pdfButton.textContent = 'Download Quote (PDF)';
            excelButton.textContent = 'Export to Excel';
            docxButton.textContent = 'Export to DOCX';
        } else {
            pdfButton.textContent = 'Select services to generate quote';
            excelButton.textContent = 'Export to Excel';
            docxButton.textContent = 'Export to DOCX';
        }
    }

    async generatePDF() {
        let clientName = this.currentClientName;
        let quoteTitle = this.currentQuoteName;
        
        // Only prompt if we don't already have both values
        if (!clientName || !quoteTitle) {
            const exportData = await showExportModal(quoteTitle || '', clientName || '');
            if (exportData === null) return; // User cancelled
            
            quoteTitle = exportData.title || null;
            clientName = exportData.clientName || null;
        }
        
        const loadingOverlay = document.getElementById('loading-overlay');
        loadingOverlay.style.display = 'flex';

        try {
            const subtotal = this.calculateTotal();
            const markupsTotal = this.calculateMarkupsTotal();
            const subtotalWithMarkups = subtotal + markupsTotal;
            const quoteData = {
                days: this.days,
                subtotal: subtotal,
                markups: this.markups,
                markupsTotal: markupsTotal,
                total: this.getFinalTotal(),
                discountPercentage: this.discountPercentage,
                discountAmount: subtotalWithMarkups * (this.discountPercentage / 100),
                clientName: clientName,
                quoteTitle: quoteTitle
            };

            const response = await fetch('/api/generate-pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ quoteData })
            });

            if (!response.ok) {
                throw new Error('Failed to generate PDF');
            }

            // Generate filename based on quote title or default
            let filename;
            if (quoteTitle) {
                // Sanitize title for filename
                const sanitizedTitle = quoteTitle
                    .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters
                    .replace(/\s+/g, '-') // Replace spaces with hyphens
                    .replace(/-+/g, '-') // Replace multiple hyphens with single
                    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
                    .toLowerCase();
                
                // Use sanitized title if not empty, otherwise fallback to default
                if (sanitizedTitle) {
                    filename = `${sanitizedTitle}-${new Date().toISOString().split('T')[0]}.pdf`;
                } else {
                    filename = `lumetry-quote-${new Date().toISOString().split('T')[0]}.pdf`;
                }
            } else {
                filename = `lumetry-quote-${new Date().toISOString().split('T')[0]}.pdf`;
            }

            // Create blob and download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Error generating PDF:', error);
            showAlertModal('Failed to generate PDF. Please try again.', 'error');
        } finally {
            loadingOverlay.style.display = 'none';
        }
    }

    async exportExcel() {
        let clientName = this.currentClientName;
        let quoteTitle = this.currentQuoteName;
        
        // Only prompt if we don't already have both values
        if (!clientName || !quoteTitle) {
            const exportData = await showExportModal(quoteTitle || '', clientName || '');
            if (exportData === null) return; // User cancelled
            
            quoteTitle = exportData.title || null;
            clientName = exportData.clientName || null;
        }
        
        try {
            const subtotal = this.calculateTotal();
            const markupsTotal = this.calculateMarkupsTotal();
            const subtotalWithMarkups = subtotal + markupsTotal;
            const discountAmount = subtotalWithMarkups * (this.discountPercentage / 100);
            const total = this.getFinalTotal();

            // Send data to server for XLSX generation
            const quoteData = {
                days: this.days,
                subtotal: subtotal,
                markups: this.markups,
                markupsTotal: markupsTotal,
                total: total,
                discountPercentage: this.discountPercentage,
                discountAmount: discountAmount,
                clientName: clientName,
                quoteTitle: quoteTitle
            };

            const response = await fetch('/api/generate-excel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    quoteData,
                    quoteName: quoteTitle 
                })
            });

            if (!response.ok) {
                throw new Error('Failed to generate Excel file');
            }

            // Get filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'quote-export.xlsx';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            // Create blob and download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Error exporting Excel:', error);
            showAlertModal('Failed to export Excel file. Please try again.', 'error');
        }
    }

    async exportDocx() {
        let clientName = this.currentClientName;
        let quoteTitle = this.currentQuoteName;
        
        // Only prompt if we don't already have both values
        if (!clientName || !quoteTitle) {
            const exportData = await showExportModal(quoteTitle || '', clientName || '');
            if (exportData === null) return; // User cancelled
            
            quoteTitle = exportData.title || null;
            clientName = exportData.clientName || null;
        }
        
        try {
            const subtotal = this.calculateTotal();
            const markupsTotal = this.calculateMarkupsTotal();
            const subtotalWithMarkups = subtotal + markupsTotal;
            const discountAmount = subtotalWithMarkups * (this.discountPercentage / 100);
            const total = this.getFinalTotal();

            // Send data to server for DOCX generation
            const quoteData = {
                days: this.days,
                subtotal: subtotal,
                markups: this.markups,
                markupsTotal: markupsTotal,
                total: total,
                discountPercentage: this.discountPercentage,
                discountAmount: discountAmount,
                clientName: clientName,
                quoteTitle: quoteTitle
            };

            const response = await fetch('/api/generate-docx', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    quoteData,
                    quoteName: quoteTitle 
                })
            });

            if (!response.ok) {
                throw new Error('Failed to generate DOCX file');
            }

            // Get filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'quote-export.docx';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            // Create blob and download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Error exporting DOCX:', error);
            showAlertModal('Failed to export DOCX file. Please try again.', 'error');
        }
    }

    async validateServiceDependency(serviceId, dayIndex) {
        try {
            const response = await fetch('/api/validate-service', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    serviceId: serviceId,
                    currentQuote: { days: this.days },
                    dayIndex: dayIndex
                })
            });

            const result = await response.json();
            return {
                success: result.canAdd,
                error: result.error
            };
        } catch (error) {
            console.error('Error validating service dependency:', error);
            return { success: true }; // Allow adding if validation fails
        }
    }

    findDependentServices(serviceId, dayIndex) {
        const dependentServices = [];
        
        // Check all days for services that depend on this one
        this.days.forEach((day, dIndex) => {
            day.services.forEach(service => {
                const serviceDefinition = this.services.find(s => s._id === service.id);
                if (serviceDefinition && serviceDefinition.dependsOn && serviceDefinition.dependsOn._id === serviceId) {
                    // Check based on dependency type
                    if (serviceDefinition.dependencyType === 'same_day' && dIndex === dayIndex) {
                        dependentServices.push({
                            name: service.name,
                            day: dIndex + 1,
                            dependencyType: 'same_day'
                        });
                    } else if (serviceDefinition.dependencyType === 'same_quote') {
                        dependentServices.push({
                            name: service.name,
                            day: dIndex + 1,
                            dependencyType: 'same_quote'
                        });
                    }
                }
            });
        });
        
        return dependentServices;
    }

    showDependencyError(message) {
        this.showErrorMessage(message);
    }

    showDependencyRemovalError(serviceName, dependentServices) {
        const dependentList = dependentServices.map(dep => 
            `"${dep.name}" on Day ${dep.day} (${dep.dependencyType === 'same_day' ? 'Same Day' : 'Same Quote'} dependency)`
        ).join(', ');
        
        const message = `Cannot remove "${serviceName}". The following services depend on it: ${dependentList}. Please remove these services first.`;
        this.showErrorMessage(message);
    }

    showDayRemovalError(dayNumber, blockingDependencies) {
        let message = `Cannot remove Day ${dayNumber}. The following services have dependencies:\n\n`;
        
        blockingDependencies.forEach(block => {
            const dependentList = block.dependents.map(dep => 
                `"${dep.name}" on Day ${dep.day}`
            ).join(', ');
            message += `• "${block.service}" is required by: ${dependentList}\n`;
        });
        
        message += '\nPlease remove the dependent services first.';
        this.showErrorMessage(message);
    }

    showErrorMessage(message) {
        // Create error message element
        const errorEl = document.createElement('div');
        errorEl.className = 'dependency-error';
        errorEl.innerHTML = message.replace(/\n/g, '<br>');
        errorEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fee2e2;
            color: #991b1b;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            max-width: 500px;
            animation: slideIn 0.3s ease-out;
            border-left: 4px solid #dc2626;
            line-height: 1.5;
        `;

        document.body.appendChild(errorEl);

        // Remove message after 7 seconds (longer for detailed messages)
        setTimeout(() => {
            errorEl.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                if (errorEl.parentNode) {
                    errorEl.parentNode.removeChild(errorEl);
                }
            }, 300);
        }, 7000);
    }

    // Save/Load functionality
    async showSaveModal() {
        // Pre-fill form with current quote info if available
        document.getElementById('saveQuoteTitle').value = this.currentQuoteTitle || this.currentQuoteName || '';
        document.getElementById('clientName').value = this.currentClientName || '';
        document.getElementById('eventLocation').value = this.currentLocation || '';
        document.getElementById('bookedCheckbox').checked = this.currentBooked || false;
        
        // Load previous clients for the dropdown
        await this.loadClients();
        
        // Load users for the Created By dropdown
        await this.loadUsers();
        document.getElementById('createdBySelect').value = this.currentCreatedBy || '';
        
        // Move dropdown to body if it's not already there
        this.ensureDropdownInBody();
        
        // Show modal
        document.getElementById('saveModal').style.display = 'flex';
        
        // Add click outside handler for dropdown
        this.setupDropdownClickHandler();
        
        // Focus on title input
        setTimeout(() => {
            document.getElementById('saveQuoteTitle').focus();
            // If pre-filled, select all text for easy replacement
            if (this.currentQuoteTitle || this.currentQuoteName) {
                document.getElementById('saveQuoteTitle').select();
            }
        }, 100);
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users');
            const users = await response.json();
            this.users = users;
            
            const select = document.getElementById('createdBySelect');
            // Keep the blank option
            select.innerHTML = '<option value="">-- Select User --</option>';
            
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user._id;
                option.textContent = user.name;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    async loadClients() {
        try {
            const response = await fetch('/api/clients');
            const clients = await response.json();
            
            // Store clients for filtering
            this.allClients = clients;
            this.displayClients(clients);
        } catch (error) {
            console.error('Error loading clients:', error);
        }
    }

    displayClients(clients) {
        const dropdown = document.getElementById('clientDropdown');
        dropdown.innerHTML = '';
        
        if (clients.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'client-dropdown-item no-results';
            noResults.textContent = 'No previous clients found';
            dropdown.appendChild(noResults);
        } else {
            clients.forEach(client => {
                const item = document.createElement('div');
                item.className = 'client-dropdown-item';
                item.textContent = client;
                item.onclick = () => this.selectClient(client);
                dropdown.appendChild(item);
            });
        }
    }

    selectClient(client) {
        const input = document.getElementById('clientName');
        input.value = client;
        this.hideClientDropdown();
    }

    hideClientDropdown() {
        const dropdown = document.getElementById('clientDropdown');
        dropdown.style.display = 'none';
    }

    showClientDropdown() {
        const dropdown = document.getElementById('clientDropdown');
        const input = document.getElementById('clientName');
        
        // Position dropdown relative to the input field
        this.positionDropdown(dropdown, input);
        dropdown.style.display = 'block';
    }

    ensureDropdownInBody() {
        const dropdown = document.getElementById('clientDropdown');
        if (dropdown && dropdown.parentElement !== document.body) {
            // Move dropdown to body so it's not constrained by modal overflow
            document.body.appendChild(dropdown);
        }
    }

    positionDropdown(dropdown, input) {
        const inputRect = input.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const dropdownMaxHeight = 200; // matches CSS max-height
        
        // Calculate available space below and above the input
        const spaceBelow = viewportHeight - inputRect.bottom;
        const spaceAbove = inputRect.top;
        
        // Determine if dropdown should open upward or downward
        const shouldOpenUpward = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow;
        
        if (shouldOpenUpward) {
            // Position above the input
            dropdown.style.top = 'auto';
            dropdown.style.bottom = (viewportHeight - inputRect.top + 2) + 'px';
            dropdown.style.maxHeight = Math.min(dropdownMaxHeight, spaceAbove - 10) + 'px';
        } else {
            // Position below the input (default)
            dropdown.style.top = (inputRect.bottom + 2) + 'px';
            dropdown.style.bottom = 'auto';
            dropdown.style.maxHeight = Math.min(dropdownMaxHeight, spaceBelow - 10) + 'px';
        }
        
        dropdown.style.left = inputRect.left + 'px';
        dropdown.style.width = inputRect.width + 'px';
        dropdown.style.position = 'fixed';
        dropdown.style.zIndex = '9999';
    }

    setupDropdownClickHandler() {
        const dropdown = document.getElementById('clientDropdown');
        const container = document.querySelector('.client-input-container');
        
        // Remove any existing listener to avoid duplicates
        if (this.dropdownClickHandler) {
            document.removeEventListener('click', this.dropdownClickHandler);
        }
        
        // Create new click handler
        this.dropdownClickHandler = (e) => {
            const isClickInsideContainer = container && container.contains(e.target);
            const isClickInsideDropdown = dropdown && dropdown.contains(e.target);
            
            if (!isClickInsideContainer && !isClickInsideDropdown) {
                this.hideClientDropdown();
            }
        };
        
        // Add listener to document for global click detection
        document.addEventListener('click', this.dropdownClickHandler);
        
        // Handle window resize to reposition dropdown
        if (this.dropdownResizeHandler) {
            window.removeEventListener('resize', this.dropdownResizeHandler);
        }
        
        this.dropdownResizeHandler = () => {
            const dropdown = document.getElementById('clientDropdown');
            if (dropdown && dropdown.style.display === 'block') {
                const input = document.getElementById('clientName');
                this.positionDropdown(dropdown, input);
            }
        };
        
        window.addEventListener('resize', this.dropdownResizeHandler);
    }

    async autoSaveQuoteTitle(newTitle) {
        // Only auto-save if we have a currently saved quote
        if (!this.currentQuoteName) {
            return;
        }

        const oldQuoteName = this.currentQuoteName;
        
        // If the title is the same as the old name, just update the existing quote
        if (oldQuoteName === newTitle) {
            return;
        }

        const quoteData = {
            days: this.days,
            total: this.getFinalTotal(),
            discountPercentage: this.discountPercentage
        };

        try {
            // Save quote with new title
            const saveResponse = await fetch('/api/save-quote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    name: newTitle,
                    quoteData,
                    clientName: this.currentClientName || null
                })
            });

            const saveResult = await saveResponse.json();

            if (saveResponse.status === 409) {
                // Quote with this name already exists, use overwrite instead
                const overwriteResponse = await fetch('/api/overwrite-quote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        name: newTitle,
                        quoteData,
                        clientName: this.currentClientName || null
                    })
                });

                const overwriteResult = await overwriteResponse.json();
                if (!overwriteResult.success) {
                    throw new Error(overwriteResult.error || 'Failed to overwrite quote');
                }
            } else if (!saveResult.success) {
                throw new Error(saveResult.error || 'Failed to save quote');
            }

            // Successfully saved with new name, now delete the old quote
            try {
                await fetch(`/api/saved-quotes/${encodeURIComponent(oldQuoteName)}`, {
                    method: 'DELETE'
                });
                console.log(`🗑️ Deleted old quote: ${oldQuoteName}`);
            } catch (deleteError) {
                console.warn('Could not delete old quote:', deleteError);
                // Don't fail the whole operation if delete fails
            }

            // Update current quote name to match the new title
            this.currentQuoteName = newTitle;
            console.log(`✅ Quote renamed from "${oldQuoteName}" to "${newTitle}"`);

        } catch (error) {
            throw new Error(`Failed to rename quote: ${error.message}`);
        }
    }

    closeSaveModal() {
        document.getElementById('saveModal').style.display = 'none';
        this.hideClientDropdown();
        
        // Clean up event listeners
        if (this.dropdownClickHandler) {
            document.removeEventListener('click', this.dropdownClickHandler);
            this.dropdownClickHandler = null;
        }
        
        if (this.dropdownResizeHandler) {
            window.removeEventListener('resize', this.dropdownResizeHandler);
            this.dropdownResizeHandler = null;
        }
    }

    async saveQuoteFromModal(event) {
        event.preventDefault();
        
        const title = document.getElementById('saveQuoteTitle').value.trim();
        const clientName = document.getElementById('clientName').value.trim();
        const location = document.getElementById('eventLocation').value.trim();
        const booked = document.getElementById('bookedCheckbox').checked;
        const createdBy = document.getElementById('createdBySelect').value || null;
        
        if (!title) {
            showAlertModal('Please enter a quote title.', 'error');
            return;
        }

        const quoteData = {
            days: this.days,
            total: this.getFinalTotal(),
            discountPercentage: this.discountPercentage,
            markups: this.markups
        };

        try {
            const response = await fetch('/api/save-quote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    name: title, 
                    quoteData,
                    clientName: clientName || null,
                    location: location || null,
                    booked: booked,
                    createdBy: createdBy
                })
            });

            const result = await response.json();

            if (response.status === 409) {
                // Quote name already exists
                const overwrite = await showConfirmModal(
                    `A quote named "${title}" already exists. Do you want to overwrite it?`,
                    'Quote Already Exists',
                    'Overwrite',
                    'Cancel'
                );
                if (overwrite) {
                    await this.overwriteQuote(title, quoteData, clientName, location, booked, createdBy);
                }
            } else if (result.success) {
                // Update current quote info
                this.currentQuoteName = title;
                this.currentClientName = clientName || null;
                this.currentLocation = location || null;
                this.currentBooked = booked;
                this.currentCreatedBy = createdBy;
                this.currentQuoteTitle = title; // Update the main page title
                this.lastSavedTime = new Date();
                
                // Update displays
                this.updateQuoteTitleDisplay();
                this.updateClientDisplay();
                this.updateLocationDisplay();
                this.updateSaveStatus('saved');
                
                this.closeSaveModal();
                showAlertModal('Quote saved successfully!', 'success', null, true);
            } else {
                throw new Error(result.error || 'Failed to save quote');
            }
        } catch (error) {
            console.error('Error saving quote:', error);
            showAlertModal('Error saving quote. Please try again.', 'error');
        }
    }

    // Generate an auto-save name for untitled quotes
    generateUntitledQuoteName() {
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return `Untitled Quote - ${timestamp}`;
    }
    
    // Trigger auto-save (debounced)
    triggerAutoSave() {
        // If no quote name exists, generate one for auto-save
        if (!this.currentQuoteName) {
            this.currentQuoteName = this.generateUntitledQuoteName();
            this.currentQuoteTitle = this.currentQuoteName;
            this.updateQuoteTitleDisplay();
            console.log('📝 Auto-generated quote name:', this.currentQuoteName);
        }
        
        // Clear any pending auto-save
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        
        // Update status
        this.updateSaveStatus('unsaved');
        
        // Schedule auto-save after delay
        this.autoSaveTimeout = setTimeout(() => {
            this.performAutoSave();
        }, this.autoSaveDelay);
    }
    
    // Perform the actual auto-save
    async performAutoSave() {
        // Don't save if already saving or no quote loaded
        if (this.isSaving || !this.currentQuoteName) {
            return;
        }
        
        this.isSaving = true;
        this.updateSaveStatus('saving');
        
        const quoteData = {
            days: this.days,
            total: this.getFinalTotal(),
            discountPercentage: this.discountPercentage,
            markups: this.markups,
            quoteTitle: this.currentQuoteTitle
        };
        
        try {
            // Try to overwrite first (for existing quotes)
            let response = await fetch('/api/overwrite-quote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    name: this.currentQuoteName,
                    quoteData,
                    clientName: this.currentClientName || null,
                    location: this.currentLocation || null,
                    booked: this.currentBooked || false,
                    createdBy: this.currentCreatedBy || null
                })
            });
            
            let result = await response.json();
            
            // If quote doesn't exist (404), create it with save-quote
            if (response.status === 404 || !result.success) {
                response = await fetch('/api/save-quote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        name: this.currentQuoteName,
                        quoteData,
                        clientName: this.currentClientName || null,
                        location: this.currentLocation || null,
                        booked: this.currentBooked || false,
                        createdBy: this.currentCreatedBy || null
                    })
                });
                
                result = await response.json();
            }
            
            if (result.success) {
                this.lastSavedTime = new Date();
                this.updateSaveStatus('saved');
                console.log('✅ Auto-saved:', this.currentQuoteName);
            } else {
                throw new Error(result.error || 'Failed to auto-save');
            }
        } catch (error) {
            console.error('Auto-save error:', error);
            this.updateSaveStatus('error');
        } finally {
            this.isSaving = false;
        }
    }
    
    // Update the save status indicator
    updateSaveStatus(status) {
        const indicator = document.getElementById('autoSaveIndicator');
        if (!indicator) return;
        
        const statusIcon = indicator.querySelector('.save-status-icon');
        const statusText = indicator.querySelector('.save-status-text');
        
        switch (status) {
            case 'saving':
                statusIcon.innerHTML = '⟳';
                statusIcon.style.animation = 'spin 1s linear infinite';
                statusText.textContent = 'Saving...';
                statusText.style.color = '#64748b';
                break;
            case 'saved':
                statusIcon.innerHTML = '✓';
                statusIcon.style.animation = 'none';
                statusText.textContent = 'All changes saved';
                statusText.style.color = '#10b981';
                break;
            case 'unsaved':
                statusIcon.innerHTML = '●';
                statusIcon.style.animation = 'none';
                statusText.textContent = 'Unsaved changes';
                statusText.style.color = '#f59e0b';
                break;
            case 'error':
                statusIcon.innerHTML = '⚠';
                statusIcon.style.animation = 'none';
                statusText.textContent = 'Save failed';
                statusText.style.color = '#dc2626';
                break;
        }
    }

    async overwriteQuote(name, quoteData, clientName, location, booked, createdBy) {
        try {
            const response = await fetch('/api/overwrite-quote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    name, 
                    quoteData,
                    clientName: clientName || null,
                    location: location || null,
                    booked: booked,
                    createdBy: createdBy
                })
            });

            const result = await response.json();

            if (result.success) {
                // Update current quote info
                this.currentQuoteName = name;
                this.currentClientName = clientName || null;
                this.currentLocation = location || null;
                this.currentQuoteTitle = name; // Update the main page title
                this.lastSavedTime = new Date();
                this.updateSaveStatus('saved');
                
                // Update displays
                this.updateQuoteTitleDisplay();
                this.updateClientDisplay();
                this.updateLocationDisplay();
                
                this.closeSaveModal();
                showAlertModal('Quote updated successfully!', 'success', null, true);
            } else {
                throw new Error(result.error || 'Failed to update quote');
            }
        } catch (error) {
            console.error('Error updating quote:', error);
            showAlertModal('Error updating quote. Please try again.', 'error');
        }
    }

    updateClientDisplay() {
        const clientDisplay = document.getElementById('client-display');
        console.log('🔧 updateClientDisplay called:', {
            clientDisplay: !!clientDisplay,
            currentClientName: this.currentClientName
        });
        if (this.currentClientName) {
            clientDisplay.textContent = `Client: ${this.currentClientName}`;
            clientDisplay.style.display = 'inline';
            console.log('✅ Client display updated to:', this.currentClientName);
        } else {
            clientDisplay.style.display = 'none';
            console.log('✅ Client display hidden');
        }
    }

    updateQuoteTitleDisplay() {
        const titleElement = document.getElementById('quoteTitle');
        console.log('🔧 updateQuoteTitleDisplay called:', {
            titleElement: !!titleElement,
            currentQuoteTitle: this.currentQuoteTitle
        });
        if (titleElement && this.currentQuoteTitle) {
            titleElement.textContent = this.currentQuoteTitle;
            console.log('✅ Title updated to:', this.currentQuoteTitle);
        }
    }

    updateLocationDisplay() {
        const locationDisplay = document.getElementById('location-display');
        console.log('🔧 updateLocationDisplay called:', {
            locationDisplay: !!locationDisplay,
            currentLocation: this.currentLocation
        });
        if (locationDisplay) {
            if (this.currentLocation) {
                locationDisplay.textContent = `📍 ${this.currentLocation}`;
                locationDisplay.style.display = 'block';
                console.log('✅ Location display updated to:', this.currentLocation);
            } else {
                locationDisplay.style.display = 'none';
                console.log('✅ Location display hidden');
            }
        }
    }

    clearCurrentQuote() {
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.currentLocation = null;
        this.currentBooked = false;
        this.currentCreatedBy = null;
        this.currentQuoteTitle = "Conference Services Quote";
        this.updateQuoteTitleDisplay();
        this.updateClientDisplay();
        this.updateLocationDisplay();
    }

    markQuoteAsModified() {
        // Keep the quote name and client name for saving/PDF, but update display to show it's modified
        // This allows the save modal to be pre-filled and PDF to use existing client name
        console.log('📝 markQuoteAsModified called');
        this.updateClientDisplay();
    }

    // Load quote data directly from a quote object (used for calendar navigation)
    loadQuoteFromData(quote) {
        try {
            // Load the quote data
            this.days = quote.quoteData.days;
            this.discountPercentage = quote.quoteData.discountPercentage || 0;
            this.markups = quote.quoteData.markups || [];
            this.currentQuoteName = quote.name;
            this.currentClientName = quote.clientName || null;
            this.currentLocation = quote.location || null;
            this.currentBooked = quote.booked || false;
            this.currentCreatedBy = quote.createdBy?._id || null;
            this.currentQuoteTitle = quote.name; // Use quote name as title (matching regular loadQuote)
            
            // Update the quote title display
            const titleElement = document.getElementById('quoteTitle');
            if (titleElement) {
                titleElement.textContent = this.currentQuoteTitle;
            }
            
            // Ensure all services have quantity property and days have date property
            this.days.forEach(day => {
                if (day.date === undefined) {
                    day.date = null;
                }
                day.services.forEach(service => {
                    if (!service.quantity) {
                        service.quantity = 1;
                    }
                    if (service.tentative === undefined) {
                        service.tentative = false;
                    }
                });
            });
            
            // Update discount button and input (matching regular loadQuote)
            const button = document.getElementById('discountBtn');
            if (this.discountPercentage > 0) {
                button.textContent = `Modify Discount (${this.discountPercentage}%)`;
            } else {
                button.textContent = 'Apply Discount';
            }
            document.getElementById('discountInput').value = this.discountPercentage;
            
            // Update client display
            this.updateClientDisplay();
            this.updateLocationDisplay();
            
            // Reset override mode when loading a quote (matching regular loadQuote)
            if (this.isOverrideMode) {
                this.toggleOverrideMode();
            }
            
            // Re-render the interface (matching regular loadQuote)
            this.renderDays();
            this.renderMarkups();
            this.updateTotal();
            
            // Save the loaded quote data to localStorage (matching regular loadQuote)
            this.saveDraftToLocalStorage();
            
        } catch (error) {
            console.error('Error loading quote data:', error);
            throw error;
        }
    }

    async showLoadModal() {
        document.getElementById('loadModal').style.display = 'flex';
        await this.loadSavedQuotes();
    }

    closeLoadModal() {
        document.getElementById('loadModal').style.display = 'none';
    }

    async loadSavedQuotes() {
        try {
            const response = await fetch('/api/saved-quotes');
            const quotes = await response.json();
            
            this.allQuotes = quotes;
            this.displayQuotes(quotes);
        } catch (error) {
            console.error('Error loading saved quotes:', error);
            document.getElementById('quotesContainer').innerHTML = 
                '<div class="no-quotes">Error loading saved quotes</div>';
        }
    }

    displayQuotes(quotes) {
        const container = document.getElementById('quotesContainer');
        
        if (quotes.length === 0) {
            container.innerHTML = '<div class="no-quotes">No saved quotes found</div>';
            return;
        }

        container.innerHTML = quotes.map(quote => {
            const totalServices = quote.quoteData.days.reduce((sum, day) => sum + day.services.length, 0);
            const createdDate = new Date(quote.createdAt).toLocaleDateString();
            const updatedDate = new Date(quote.updatedAt).toLocaleDateString();
            const dateRange = this.getQuoteDateRange(quote.quoteData.days);
            
            return `
                <div class="quote-item" data-quote-name="${this.escapeHtml(quote.name)}">
                    <div class="quote-item-header">
                        <h3 class="quote-name">${this.escapeHtml(quote.name)}</h3>
                        <div class="quote-actions">
                            <button class="delete-quote-btn" data-quote-name="${this.escapeHtml(quote.name)}">Delete</button>
                        </div>
                    </div>
                    <div class="quote-info">
                        <span>💰 Total: ${this.formatCurrency(quote.quoteData.total)}</span>
                        <span>📅 Days: ${quote.quoteData.days.length}</span>
                        <span>🎯 Services: ${totalServices}</span>
                        ${dateRange ? `<span>📅 Service Dates: ${dateRange}</span>` : ''}
                        <span>📅 Created: ${createdDate}</span>
                        ${createdDate !== updatedDate ? `<span>✏️ Updated: ${updatedDate}</span>` : ''}
                        ${quote.clientName ? `<span>👤 Client: ${this.escapeHtml(quote.clientName)}</span>` : ''}
                        ${quote.location ? `<span>📍 Location: ${this.escapeHtml(quote.location)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners for quote items and delete buttons
        setTimeout(() => {
            // Quote item click handlers
            container.querySelectorAll('.quote-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (!e.target.closest('.delete-quote-btn')) {
                        const quoteName = item.dataset.quoteName;
                        this.confirmLoadQuote(quoteName);
                    }
                });
            });

            // Delete button click handlers
            container.querySelectorAll('.delete-quote-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const quoteName = btn.dataset.quoteName;
                    this.deleteQuote(quoteName);
                });
            });
        }, 0);
    }

    filterQuotes() {
        const searchTerm = document.getElementById('searchQuotes').value.toLowerCase();
        const filtered = this.allQuotes.filter(quote => 
            quote.name.toLowerCase().includes(searchTerm) ||
            (quote.clientName && quote.clientName.toLowerCase().includes(searchTerm)) ||
            (quote.location && quote.location.toLowerCase().includes(searchTerm))
        );
        this.displayQuotes(filtered);
    }

    sortQuotes() {
        const sortBy = document.getElementById('sortQuotes').value;
        const sorted = [...this.allQuotes].sort((a, b) => {
            const dateA = new Date(a.updatedAt);
            const dateB = new Date(b.updatedAt);
            
            if (sortBy === 'newest') {
                return dateB - dateA;
            } else {
                return dateA - dateB;
            }
        });
        
        this.displayQuotes(sorted);
    }

    async confirmLoadQuote(quoteName) {
        const hasData = this.days.some(day => day.services.length > 0);
        
        if (hasData) {
            const confirm = await showConfirmModal(
                'Loading this quote will replace your current work. Are you sure you want to continue?',
                'Load Quote',
                'Load Quote',
                'Cancel'
            );
            if (!confirm) {
                return;
            }
        }
        
        await this.loadQuote(quoteName);
    }

    async loadQuote(quoteName) {
        try {
            const response = await fetch(`/api/load-quote/${encodeURIComponent(quoteName)}`);
            const quote = await response.json();
            
            if (quote.error) {
                throw new Error(quote.error);
            }
            
            // Load the quote data
            this.days = quote.quoteData.days;
            this.discountPercentage = quote.quoteData.discountPercentage || 0;
            this.markups = quote.quoteData.markups || [];
            this.currentQuoteName = quote.name;
            this.currentClientName = quote.clientName || null;
            this.currentLocation = quote.location || null;
            this.currentBooked = quote.booked || false;
            this.currentCreatedBy = quote.createdBy?._id || null;
            this.currentQuoteTitle = quote.name; // Use quote name as title
            
            // Update the quote title display
            const titleElement = document.getElementById('quoteTitle');
            if (titleElement) {
                titleElement.textContent = this.currentQuoteTitle;
            }
            
            // Ensure all services have quantity property and days have date property
            this.days.forEach(day => {
                if (day.date === undefined) {
                    day.date = null;
                }
                day.services.forEach(service => {
                    if (!service.quantity) {
                        service.quantity = 1;
                    }
                    if (service.tentative === undefined) {
                        service.tentative = false;
                    }
                });
            });
            
            // Update discount button and input
            const button = document.getElementById('discountBtn');
            if (this.discountPercentage > 0) {
                button.textContent = `Modify Discount (${this.discountPercentage}%)`;
            } else {
                button.textContent = 'Apply Discount';
            }
            document.getElementById('discountInput').value = this.discountPercentage;
            
            // Update client display
            this.updateClientDisplay();
            this.updateLocationDisplay();
            
            // Reset override mode when loading a quote
            if (this.isOverrideMode) {
                this.toggleOverrideMode();
            }
            
            // Re-render the interface
            this.renderDays();
            this.renderMarkups();
            this.updateTotal();
            
            // Close the modal
            this.closeLoadModal();
            
            // Save the loaded quote data to localStorage
            this.saveDraftToLocalStorage();
            
            showAlertModal(`Quote "${quoteName}" loaded successfully!`, 'success', null, true);
        } catch (error) {
            console.error('Error loading quote:', error);
            showAlertModal('Error loading quote. Please try again.', 'error');
        }
    }

    async deleteQuote(quoteName) {
        const confirm = await showConfirmModal(
            `Are you sure you want to delete the quote "${quoteName}"? This action cannot be undone.`,
            'Delete Quote',
            'Delete',
            'Cancel'
        );
        if (!confirm) {
            return;
        }
        
        try {
            const response = await fetch(`/api/saved-quotes/${encodeURIComponent(quoteName)}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                showAlertModal('Quote deleted successfully!', 'success', null, true);
                await this.loadSavedQuotes(); // Refresh the list
            } else {
                throw new Error(result.error || 'Failed to delete quote');
            }
        } catch (error) {
            console.error('Error deleting quote:', error);
            showAlertModal('Error deleting quote. Please try again.', 'error');
        }
    }

    // Discount functionality
    toggleDiscount() {
        const container = document.getElementById('discountInputContainer');
        const button = document.getElementById('discountBtn');
        
        if (container.style.display === 'none') {
            container.style.display = 'block';
            button.textContent = 'Hide Discount';
            // Set current discount value in input
            document.getElementById('discountInput').value = this.discountPercentage;
        } else {
            container.style.display = 'none';
            button.textContent = 'Apply Discount';
        }
    }

    applyDiscount() {
        const input = document.getElementById('discountInput');
        let percentage = parseFloat(input.value) || 0;
        
        // Validate range
        if (percentage < 0) {
            percentage = 0;
        } else if (percentage > 100) {
            percentage = 100;
        }
        
        this.discountPercentage = percentage;
        input.value = percentage;
        
        // Update the display
        this.updateTotal();
        this.saveDraftToLocalStorage();
        
        // Update button text
        const button = document.getElementById('discountBtn');
        if (percentage > 0) {
            button.textContent = `Modify Discount (${percentage}%)`;
        } else {
            button.textContent = 'Apply Discount';
        }
    }

    removeDiscount() {
        this.discountPercentage = 0;
        document.getElementById('discountInput').value = '';
        this.updateTotal();
        this.saveDraftToLocalStorage();
        
        // Hide input container and reset button
        document.getElementById('discountInputContainer').style.display = 'none';
        document.getElementById('discountBtn').textContent = 'Apply Discount';
    }

    // Service-specific discount methods
    openServiceDiscountModal(dayIndex, serviceIndex) {
        const service = this.days[dayIndex].services[serviceIndex];
        
        // Store current context
        this.currentDiscountDayIndex = dayIndex;
        this.currentDiscountServiceIndex = serviceIndex;
        
        // Populate modal with service info
        document.getElementById('discountServiceName').textContent = service.name;
        document.getElementById('discountServiceUnitPrice').textContent = this.formatCurrency(service.price);
        document.getElementById('discountServiceQty').textContent = service.quantity;
        document.getElementById('discountServiceTotal').textContent = this.formatCurrency(service.price * service.quantity);
        
        // Populate current discount if exists
        if (service.discount && service.discount.applied) {
            document.getElementById('serviceDiscountValue').value = service.discount.value;
            document.getElementById('serviceDiscountType').value = service.discount.type;
            document.getElementById('removeDiscountBtn').style.display = 'inline-block';
        } else {
            document.getElementById('serviceDiscountValue').value = '';
            document.getElementById('serviceDiscountType').value = 'percentage';
            document.getElementById('removeDiscountBtn').style.display = 'none';
        }
        
        // Update preview
        this.updateServiceDiscountPreview();
        
        // Add event listeners for live preview
        document.getElementById('serviceDiscountValue').addEventListener('input', () => this.updateServiceDiscountPreview());
        document.getElementById('serviceDiscountType').addEventListener('change', () => this.updateServiceDiscountPreview());
        
        // Show modal
        document.getElementById('serviceDiscountModal').style.display = 'flex';
    }
    
    updateServiceDiscountPreview() {
        if (this.currentDiscountDayIndex === undefined || this.currentDiscountServiceIndex === undefined) {
            return;
        }
        
        const service = this.days[this.currentDiscountDayIndex].services[this.currentDiscountServiceIndex];
        const originalAmount = service.price * service.quantity;
        
        const discountValue = parseFloat(document.getElementById('serviceDiscountValue').value) || 0;
        const discountType = document.getElementById('serviceDiscountType').value;
        
        let discountAmount = 0;
        if (discountType === 'percentage') {
            discountAmount = originalAmount * (discountValue / 100);
        } else {
            discountAmount = discountValue;
        }
        
        // Ensure discount doesn't exceed original amount
        discountAmount = Math.min(discountAmount, originalAmount);
        
        const finalAmount = originalAmount - discountAmount;
        
        // Update preview
        document.getElementById('previewOriginal').textContent = this.formatCurrency(originalAmount);
        document.getElementById('previewDiscountAmount').textContent = '- ' + this.formatCurrency(discountAmount);
        document.getElementById('previewFinal').textContent = this.formatCurrency(finalAmount);
    }
    
    applyServiceDiscount() {
        if (this.currentDiscountDayIndex === undefined || this.currentDiscountServiceIndex === undefined) {
            return;
        }
        
        const service = this.days[this.currentDiscountDayIndex].services[this.currentDiscountServiceIndex];
        const discountValue = parseFloat(document.getElementById('serviceDiscountValue').value) || 0;
        const discountType = document.getElementById('serviceDiscountType').value;
        
        if (discountValue > 0) {
            service.discount = {
                type: discountType,
                value: discountValue,
                applied: true
            };
        } else {
            service.discount = {
                type: 'percentage',
                value: 0,
                applied: false
            };
        }
        
        this.closeServiceDiscountModal();
        this.renderDays();
        this.updateTotal();
        this.saveDraftToLocalStorage();
    }
    
    removeServiceDiscount() {
        if (this.currentDiscountDayIndex === undefined || this.currentDiscountServiceIndex === undefined) {
            return;
        }
        
        const service = this.days[this.currentDiscountDayIndex].services[this.currentDiscountServiceIndex];
        service.discount = {
            type: 'percentage',
            value: 0,
            applied: false
        };
        
        this.closeServiceDiscountModal();
        this.renderDays();
        this.updateTotal();
        this.saveDraftToLocalStorage();
    }
    
    closeServiceDiscountModal() {
        document.getElementById('serviceDiscountModal').style.display = 'none';
        this.currentDiscountDayIndex = undefined;
        this.currentDiscountServiceIndex = undefined;
    }

    togglePerEventDiscount() {
        this.perEventDiscountEnabled = !this.perEventDiscountEnabled;
        this.applyPerEventDiscountState();
        this.saveDraftToLocalStorage();
    }

    applyPerEventDiscountState() {
        const toggleBtn = document.getElementById('perEventDiscountToggle');
        const toggleText = document.getElementById('perEventDiscountText');
        const container = document.getElementById('days-container');
        
        if (!toggleBtn || !toggleText || !container) return;
        
        if (this.perEventDiscountEnabled) {
            toggleBtn.classList.add('active');
            toggleText.textContent = 'Disable Per Event Discount';
            container.classList.add('per-event-discount-enabled');
        } else {
            toggleBtn.classList.remove('active');
            toggleText.textContent = 'Enable Per Service Discount';
            container.classList.remove('per-event-discount-enabled');
        }
    }

    getFinalTotal() {
        const subtotal = this.calculateTotal();
        const markupsTotal = this.calculateMarkupsTotal();
        const subtotalWithMarkups = subtotal + markupsTotal;
        const discountAmount = subtotalWithMarkups * (this.discountPercentage / 100);
        return subtotalWithMarkups - discountAmount;
    }

    // Calendar Methods
    formatDate(date) {
        const options = { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        };
        return date.toLocaleDateString('en-US', options);
    }

    formatCurrency(amount) {
        // Check if the amount has decimal places
        const hasDecimals = amount % 1 !== 0;
        
        return amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: hasDecimals ? 2 : 0,
            maximumFractionDigits: 2
        });
    }

    formatDateForStorage(date) {
        // Format as YYYY-MM-DD to avoid timezone issues
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    parseStoredDate(dateString) {
        if (!dateString) return null;
        
        // Handle both old ISO format and new YYYY-MM-DD format
        if (dateString.includes('T')) {
            // Old ISO format - convert to local date
            return new Date(dateString);
        } else {
            // New YYYY-MM-DD format - parse as local date
            const [year, month, day] = dateString.split('-').map(Number);
            return new Date(year, month - 1, day);
        }
    }

    showCalendar(dayIndex, element) {
        // Store the current day index for the modal
        this.currentCalendarDayIndex = dayIndex;
        
        // Create and show the calendar modal
        this.showCalendarModal(dayIndex);
    }

    showCalendarModal(dayIndex) {
        // Always remove existing modal first to ensure clean state
        const existingModal = document.getElementById('calendar-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create fresh modal
        let modal = document.createElement('div');
        modal.id = 'calendar-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content calendar-modal-content">
                <div class="modal-header">
                    <h2>Select Date for Day ${dayIndex + 1}</h2>
                    <span class="close">&times;</span>
                </div>
                <div class="modal-body">
                    <div id="calendar-container"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Add event listener to close button
        const closeBtn = modal.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideCalendarModal();
            });
        }

        // Generate calendar content
        const calendarContainer = modal.querySelector('#calendar-container');
        const defaultDate = this.getDefaultDateForDay(dayIndex);
        const currentDate = this.days[dayIndex].date ? this.parseStoredDate(this.days[dayIndex].date) : defaultDate;
        
        calendarContainer.innerHTML = this.generateCalendarHTML(currentDate, dayIndex);
        
        // Add event listeners to calendar elements
        this.addCalendarEventListeners(dayIndex, currentDate);
        
        // Show modal
        modal.style.display = 'block';
        
        // Add click outside to close
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.hideCalendarModal();
            }
        };
    }

    hideCalendarModal() {
        const modal = document.getElementById('calendar-modal');
        if (modal) {
            modal.remove();
        }
        this.currentCalendarDayIndex = null;
    }

    addCalendarEventListeners(dayIndex, currentDate) {
        const modal = document.getElementById('calendar-modal');
        if (!modal) return;

        // Month navigation buttons
        const prevBtn = modal.querySelector('.prev-month');
        const nextBtn = modal.querySelector('.next-month');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.changeCalendarMonth(dayIndex, currentDate.getMonth() - 1, currentDate.getFullYear());
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.changeCalendarMonth(dayIndex, currentDate.getMonth() + 1, currentDate.getFullYear());
            });
        }

        // Date selection
        const dayElements = modal.querySelectorAll('.calendar-day[data-day]');
        dayElements.forEach(dayEl => {
            dayEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const day = parseInt(dayEl.dataset.day);
                const month = parseInt(dayEl.dataset.month);
                const year = parseInt(dayEl.dataset.year);
                this.selectDate(dayIndex, year, month, day);
            });
        });

        // Clear and Today buttons
        const clearBtn = modal.querySelector('.calendar-clear');
        const todayBtn = modal.querySelector('.calendar-today');
        
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearDate(dayIndex);
            });
        }
        
        if (todayBtn) {
            todayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectToday(dayIndex);
            });
        }
    }

    createCalendar(dayIndex) {
        // This method is no longer needed for inline calendar
        // but keeping it for backward compatibility
        const calendar = document.createElement('div');
        calendar.className = 'calendar-content';
        
        const defaultDate = this.getDefaultDateForDay(dayIndex);
        const currentDate = this.days[dayIndex].date ? this.parseStoredDate(this.days[dayIndex].date) : defaultDate;
        
        calendar.innerHTML = this.generateCalendarHTML(currentDate, dayIndex);
        return calendar;
    }

    getDefaultDateForDay(dayIndex) {
        if (dayIndex === 0) {
            return new Date(); // Today for first day
        }
        
        // Check if previous day has a date
        const prevDay = this.days[dayIndex - 1];
        if (prevDay.date) {
            const prevDate = this.parseStoredDate(prevDay.date);
            prevDate.setDate(prevDate.getDate() + 1);
            return prevDate;
        }
        
        // Fall back to today + dayIndex
        const today = new Date();
        today.setDate(today.getDate() + dayIndex);
        return today;
    }

    generateCalendarHTML(displayDate, dayIndex) {
        const today = new Date();
        const selectedDate = this.days[dayIndex].date ? this.parseStoredDate(this.days[dayIndex].date) : null;
        
        const year = displayDate.getFullYear();
        const month = displayDate.getMonth();
        
        // Get first day of month and number of days
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();
        
        // Month navigation
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        
        let html = `
            <div class="calendar-header">
                <button class="calendar-nav prev-month">&lt;</button>
                <span class="calendar-month-year">${monthNames[month]} ${year}</span>
                <button class="calendar-nav next-month">&gt;</button>
            </div>
            <div class="calendar-grid">
                <div class="calendar-day-header">Sun</div>
                <div class="calendar-day-header">Mon</div>
                <div class="calendar-day-header">Tue</div>
                <div class="calendar-day-header">Wed</div>
                <div class="calendar-day-header">Thu</div>
                <div class="calendar-day-header">Fri</div>
                <div class="calendar-day-header">Sat</div>
        `;
        
        // Add empty cells for days before month starts
        for (let i = 0; i < startingDayOfWeek; i++) {
            const prevMonthDay = new Date(year, month, 1 - startingDayOfWeek + i).getDate();
            html += `<div class="calendar-day other-month">${prevMonthDay}</div>`;
        }
        
        // Add days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const dayDate = new Date(year, month, day);
            let classes = ['calendar-day'];
            
            // Check if this is today
            if (dayDate.toDateString() === today.toDateString()) {
                classes.push('today');
            }
            
            // Check if this is selected
            if (selectedDate && dayDate.toDateString() === selectedDate.toDateString()) {
                classes.push('selected');
            }
            
            // Check if this date conflicts with other days
            if (this.isDateConflict(dayDate, dayIndex)) {
                classes.push('other-month'); // Disable conflicting dates
                html += `<div class="${classes.join(' ')}" title="Date already used">${day}</div>`;
            } else {
                html += `<div class="${classes.join(' ')}" data-day="${day}" data-month="${month}" data-year="${year}">${day}</div>`;
            }
        }
        
        // Fill remaining cells
        const totalCells = Math.ceil((daysInMonth + startingDayOfWeek) / 7) * 7;
        const remainingCells = totalCells - (daysInMonth + startingDayOfWeek);
        for (let i = 1; i <= remainingCells; i++) {
            html += `<div class="calendar-day other-month">${i}</div>`;
        }
        
        html += `
            </div>
            <div class="calendar-actions">
                <button class="calendar-btn calendar-clear">Clear</button>
                <button class="calendar-btn calendar-today">Today</button>
            </div>
        `;
        
        return html;
    }

    isDateConflict(date, excludeDayIndex) {
        return this.days.some((day, index) => {
            if (index === excludeDayIndex) return false;
            if (!day.date) return false;
            return this.parseStoredDate(day.date).toDateString() === date.toDateString();
        });
    }

    validateDateOrder(dayIndex, newDate) {
        // Check if this violates the sequential order rule
        for (let i = 0; i < this.days.length; i++) {
            if (i === dayIndex || !this.days[i].date) continue;
            
            const existingDate = this.parseStoredDate(this.days[i].date);
            
            if (i < dayIndex && existingDate >= newDate) {
                return { valid: false, message: `Date must be after Day ${i + 1} (${this.formatDate(existingDate)})` };
            }
            
            if (i > dayIndex && existingDate <= newDate) {
                return { valid: false, message: `Date must be before Day ${i + 1} (${this.formatDate(existingDate)})` };
            }
        }
        
        return { valid: true };
    }

    selectDate(dayIndex, year, month, day) {
        const selectedDate = new Date(year, month, day);
        
        // Validate date order
        const validation = this.validateDateOrder(dayIndex, selectedDate);
        if (!validation.valid) {
            showAlertModal(validation.message, 'error');
            return;
        }
        
        // Set the date as YYYY-MM-DD format to avoid timezone issues
        this.days[dayIndex].date = this.formatDateForStorage(selectedDate);
        this.hideCalendarModal();
        this.renderDays();
        this.markQuoteAsModified(); // Mark as modified when dates change
        this.saveDraftToLocalStorage();
    }

    clearDate(dayIndex) {
        this.days[dayIndex].date = null;
        this.hideCalendarModal(); // Changed from hideCalendar()
        this.renderDays();
        this.markQuoteAsModified(); // Mark as modified when dates change
        this.saveDraftToLocalStorage();
    }

    selectToday(dayIndex) {
        const today = new Date();
        
        // Validate date order
        const validation = this.validateDateOrder(dayIndex, today);
        if (!validation.valid) {
            showAlertModal(validation.message, 'error');
            return;
        }
        
        this.days[dayIndex].date = this.formatDateForStorage(today);
        this.hideCalendarModal(); // Changed from hideCalendar()
        this.renderDays();
        this.markQuoteAsModified(); // Mark as modified when dates change
        this.saveDraftToLocalStorage();
    }

    changeCalendarMonth(dayIndex, newMonth, newYear) {
        let year = newYear;
        let month = newMonth;
        
        if (month < 0) {
            month = 11;
            year--;
        } else if (month > 11) {
            month = 0;
            year++;
        }
        
        const newDate = new Date(year, month, 1);
        
        // Update the calendar content in the modal
        const calendarContainer = document.querySelector('#calendar-container');
        if (calendarContainer) {
            calendarContainer.innerHTML = this.generateCalendarHTML(newDate, dayIndex);
            // Re-add event listeners after content update
            this.addCalendarEventListeners(dayIndex, newDate);
        }
    }

    handleDragStart(event) {
        this.draggedElement = event.currentTarget;
        this.draggedData = {
            dayIndex: parseInt(event.currentTarget.dataset.dayIndex),
            serviceIndex: parseInt(event.currentTarget.dataset.serviceIndex),
            serviceId: event.currentTarget.dataset.serviceId
        };
        
        event.currentTarget.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', event.currentTarget.dataset.serviceId);
    }

    handleDragOverWithCalendarProtection(event) {
        // Don't interfere if the target is a day header or calendar-related element
        if (event.target.classList.contains('day-header') || 
            event.target.closest('.day-header') ||
            event.target.closest('.inline-calendar') ||
            event.target.classList.contains('calendar-nav')) {
            return; // Let the click event pass through
        }
        
        this.handleDragOver(event);
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        
        const targetElement = event.currentTarget;
        
        if (!this.draggedElement || targetElement === this.draggedElement) {
            return;
        }
        
        const targetDayIndex = parseInt(targetElement.dataset.dayIndex);
        const isValidDrop = this.validateDrop(this.draggedData, targetDayIndex);
        
        // Clear ALL previous drop indicators first (prevents jittering)
        this.clearDropIndicators();
        
        if (isValidDrop) {
            // Check if this is a drop zone (always insert at bottom) or empty day
            if (targetElement.dataset.isDropZone === 'true' || targetElement.dataset.isEmpty === 'true') {
                targetElement.classList.add('drag-over-bottom');
            } else {
                // Calculate midpoint for more precise drop indication
                const rect = targetElement.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                
                if (event.clientY < midpoint) {
                    targetElement.classList.add('drag-over-top');
                } else {
                    targetElement.classList.add('drag-over-bottom');
                }
            }
        } else {
            targetElement.classList.add('drag-over-invalid');
        }
    }

    handleDrop(event) {
        event.preventDefault();
        
        const targetElement = event.currentTarget;
        
        if (!this.draggedElement || targetElement === this.draggedElement) {
            this.clearDragState();
            return;
        }
        
        const targetDayIndex = parseInt(targetElement.dataset.dayIndex);
        const targetServiceIndex = parseInt(targetElement.dataset.serviceIndex);
        
        if (!this.validateDrop(this.draggedData, targetDayIndex)) {
            this.showDependencyError('Cannot move this service. Other services depend on it being on the same day.');
            this.clearDragState();
            return;
        }
        
        // Calculate insertion position based on mouse position, drop zone, or empty day
        let insertAfter;
        if (targetElement.dataset.isDropZone === 'true' || targetElement.dataset.isEmpty === 'true') {
            // Drop zones and empty days always insert at the end (or beginning for empty days)
            insertAfter = true;
        } else {
            const rect = targetElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            insertAfter = event.clientY >= midpoint;
        }
        
        this.handleServiceDrop(this.draggedData, targetDayIndex, targetServiceIndex, insertAfter);
        this.clearDragState();
    }

    handleDragEnd(event) {
        this.clearDragState();
    }

    validateDrop(dragData, targetDayIndex) {
        // In override mode, allow all drops without dependency checks
        if (this.isOverrideMode) {
            return true;
        }
        
        const { dayIndex: sourceDayIndex, serviceId } = dragData;
        
        // If moving to a different day, check dependencies
        if (sourceDayIndex !== targetDayIndex) {
            // Check if any services depend on this one staying in the source day
            const dependentServices = this.findDependentServices(serviceId, sourceDayIndex);
            
            for (const dependent of dependentServices) {
                if (dependent.dependencyType === 'same_day') {
                    return false; // Same day dependency would be broken
                }
            }
        }
        
        return true;
    }

    async handleServiceDrop(dragData, targetDayIndex, targetServiceIndex, insertAfter) {
        const { dayIndex: sourceDayIndex, serviceIndex: sourceServiceIndex, serviceId } = dragData;
        
        // Validate the drop (this should have been checked already, but double-check)
        if (!this.validateDrop(dragData, targetDayIndex)) {
            this.showDependencyError('Cannot move this service. Other services depend on it being on the same day.');
            this.clearDragState();
            return;
        }
        
        // Get the service being moved
        const service = this.days[sourceDayIndex].services[sourceServiceIndex];
        
        // Remove from source
        this.days[sourceDayIndex].services.splice(sourceServiceIndex, 1);
        
        // Calculate target position based on insertAfter
        let insertIndex = targetServiceIndex;
        
        if (insertAfter) {
            insertIndex++;
        }
        
        // Adjust for same-day moves where source was before target
        if (sourceDayIndex === targetDayIndex && sourceServiceIndex < targetServiceIndex) {
            insertIndex--;
        }
        
        // Insert at target position
        this.days[targetDayIndex].services.splice(insertIndex, 0, service);
        
        // Re-render and update
        this.renderDays();
        this.updateTotal();
        this.markQuoteAsModified(); // Mark as modified
    }

    clearDropIndicators() {
        document.querySelectorAll('.service-row, .drop-zone, .empty-day-drop-zone').forEach(row => {
            row.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-invalid');
        });
    }

    clearDragState() {
        // Clear dragging state from the dragged element
        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging', 'mobile-dragging');
        }
        
        // Clear all drop indicators
        this.clearDropIndicators();
        this.clearMobileDropIndicators();
        this.hideMobileDropZones();
        
        // Remove mobile ghost
        if (this.mobileGhost) {
            this.mobileGhost.remove();
            this.mobileGhost = null;
        }
        
        // Reset drag variables
        this.draggedElement = null;
        this.draggedData = null;
        
        // Reset touch drag state
        this.isDragging = false;
        this.touchMoved = false;
        if (this.touchHoldTimer) {
            clearTimeout(this.touchHoldTimer);
            this.touchHoldTimer = null;
        }
    }

    // Helper method to check if drag-and-drop should be enabled on touch devices
    isTouchDragEnabled() {
        // Disable touch drag on screens smaller than 768px (mobile phones)
        // Keep enabled on tablets and larger devices
        return window.innerWidth >= 768;
    }

    // Touch event handlers for mobile drag and drop
    handleTouchStart(event) {
        // Disable touch drag on mobile devices (< 768px)
        if (!this.isTouchDragEnabled()) {
            return;
        }
        
        // Don't interfere with input elements
        if (event.target.matches('input, button, select, textarea')) {
            return;
        }
        
        // Only handle touches on the drag handle
        const dragHandle = event.target.closest('.drag-handle');
        if (!dragHandle) return;
        
        const serviceRow = event.currentTarget;
        const touch = event.touches[0];
        
        // Simple state setup
        this.touchStartTime = Date.now();
        this.touchStartPos = { x: touch.clientX, y: touch.clientY };
        this.touchMoved = false;
        this.isDragging = false;
        
        // Prevent default only when touching the drag handle
        event.preventDefault();
        
        // Shorter hold timer for better responsiveness
        this.touchHoldTimer = setTimeout(() => {
            if (!this.touchMoved) {
                this.startMobileDrag(serviceRow, touch);
            }
        }, 300); // Reduced from 700ms to 300ms
    }

    startMobileDrag(serviceRow, touch) {
        this.isDragging = true;
        this.draggedElement = serviceRow;
        this.draggedData = {
            dayIndex: parseInt(serviceRow.dataset.dayIndex),
            serviceIndex: parseInt(serviceRow.dataset.serviceIndex),
            serviceId: serviceRow.dataset.serviceId
        };
        
        // Visual feedback
        serviceRow.classList.add('mobile-dragging');
        
        // Create ghost element for better visual feedback
        this.createMobileGhost(serviceRow, touch);
        
        // Show drop zones
        this.showMobileDropZones();
        
        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    createMobileGhost(serviceRow, touch) {
        const ghost = serviceRow.cloneNode(true);
        ghost.classList.add('mobile-drag-ghost');
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '9999';
        ghost.style.opacity = '0.8';
        ghost.style.transform = 'scale(1.05)';
        ghost.style.left = (touch.clientX - 100) + 'px';
        ghost.style.top = (touch.clientY - 30) + 'px';
        
        document.body.appendChild(ghost);
        this.mobileGhost = ghost;
    }

    handleTouchMove(event) {
        // Disable touch drag on mobile devices (< 768px)
        if (!this.isTouchDragEnabled()) {
            return;
        }
        
        // Don't interfere with input elements
        if (event.target.matches('input, button, select, textarea')) {
            return;
        }
        
        const touch = event.touches[0];
        const moveDistance = Math.abs(touch.clientX - this.touchStartPos.x) + Math.abs(touch.clientY - this.touchStartPos.y);
        
        // Cancel hold timer if moved
        if (moveDistance > 10) {
            this.touchMoved = true;
            if (this.touchHoldTimer) {
                clearTimeout(this.touchHoldTimer);
                this.touchHoldTimer = null;
            }
        }
        
        // If dragging, update ghost position and show drop indicators
        if (this.isDragging) {
            event.preventDefault();
            
            // Update ghost position
            if (this.mobileGhost) {
                this.mobileGhost.style.left = (touch.clientX - 100) + 'px';
                this.mobileGhost.style.top = (touch.clientY - 30) + 'px';
            }
            
            // Clear previous indicators
            this.clearMobileDropIndicators();
            
            // Find drop target
            const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetRow = elementBelow?.closest('.day-row');
            
            if (targetRow && targetRow !== this.draggedElement && !targetRow.classList.contains('add-service-row')) {
                // Show drop indicator
                const rect = targetRow.getBoundingClientRect();
                const isUpperHalf = touch.clientY < rect.top + rect.height / 2;
                
                targetRow.classList.add('mobile-drop-target');
                if (isUpperHalf) {
                    targetRow.classList.add('drop-above');
                } else {
                    targetRow.classList.add('drop-below');
                }
            }
        }
    }

    handleTouchEnd(event) {
        // Disable touch drag on mobile devices (< 768px)
        if (!this.isTouchDragEnabled()) {
            return;
        }
        
        // Don't interfere with input elements
        if (event.target.matches('input, button, select, textarea')) {
            return;
        }
        
        // Clean up timer
        if (this.touchHoldTimer) {
            clearTimeout(this.touchHoldTimer);
            this.touchHoldTimer = null;
        }
        
        // Handle drop if we were dragging
        if (this.isDragging) {
            event.preventDefault();
            
            const touch = event.changedTouches[0];
            const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetRow = elementBelow?.closest('.day-row');
            
            if (targetRow && targetRow !== this.draggedElement && !targetRow.classList.contains('add-service-row')) {
                // Perform the drop
                this.performMobileDrop(targetRow, touch);
                
                // Success feedback
                if (navigator.vibrate) {
                    navigator.vibrate(100);
                }
            } else {
                // Failed drop feedback
                if (navigator.vibrate) {
                    navigator.vibrate([50, 50, 50]);
                }
            }
        }
        
        // Clean up
        this.cleanupMobileDrag();
    }

    performMobileDrop(targetRow, touch) {
        const targetDayIndex = parseInt(targetRow.dataset.dayIndex);
        const targetServiceIndex = parseInt(targetRow.dataset.serviceIndex);
        
        // Determine drop position
        const rect = targetRow.getBoundingClientRect();
        const isUpperHalf = touch.clientY < rect.top + rect.height / 2;
        
        // Perform the actual drop operation
        this.handleServiceDrop(this.draggedData, targetDayIndex, targetServiceIndex, !isUpperHalf);
    }

    cleanupMobileDrag() {
        // Remove ghost
        if (this.mobileGhost) {
            this.mobileGhost.remove();
            this.mobileGhost = null;
        }
        
        // Clear all mobile-specific classes
        this.clearMobileDropIndicators();
        this.hideMobileDropZones();
        
        // Remove dragging class
        if (this.draggedElement) {
            this.draggedElement.classList.remove('mobile-dragging');
        }
        
        // Reset state
        this.isDragging = false;
        this.draggedElement = null;
        this.draggedData = null;
        this.touchMoved = false;
    }

    clearMobileDropIndicators() {
        document.querySelectorAll('.mobile-drop-target, .drop-above, .drop-below').forEach(el => {
            el.classList.remove('mobile-drop-target', 'drop-above', 'drop-below');
        });
    }

    toggleTooltip(event) {
        event.stopPropagation();
        event.preventDefault();
        
        // Don't show tooltip if we're in the middle of a drag operation
        if (this.isDragging || this.touchDragEnabled) {
            return;
        }
        
        const serviceName = event.currentTarget;
        const isActive = serviceName.classList.contains('active');
        
        // If tooltip is already active, close it immediately
        if (isActive) {
            // Clear any pending tooltip timeout
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
            serviceName.classList.remove('active');
            return;
        }
        
        // Clear any existing tooltip timeout
        if (this.tooltipTimeout) {
            clearTimeout(this.tooltipTimeout);
            this.tooltipTimeout = null;
        }
        
        // Close all other tooltips
        document.querySelectorAll('.service-name.has-tooltip.active').forEach(el => {
            if (el !== serviceName) {
                el.classList.remove('active');
            }
        });
        
        // Delay showing tooltip to allow for double-tap detection
        this.tooltipTimeout = setTimeout(() => {
            serviceName.classList.add('active');
            this.tooltipTimeout = null;
            
            // Auto-close on mobile after 3 seconds
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    serviceName.classList.remove('active');
                }, 3000);
            }
        }, 350); // Delay slightly longer than double-tap window (300ms)
    }

    // Helper methods for mobile drag visual feedback
    showMobileDropZones() {
        // Highlight all potential drop zones for mobile users
        document.querySelectorAll('.day-row:not(.add-service-row)').forEach(row => {
            if (row !== this.draggedElement) {
                row.classList.add('mobile-drop-zone');
            }
        });
        
        // Add instructional text
        const instruction = document.createElement('div');
        instruction.className = 'mobile-drag-instruction';
        instruction.textContent = 'Drag to reorder • Release to drop';
        document.body.appendChild(instruction);
    }

    hideMobileDropZones() {
        // Remove mobile drop zone indicators
        document.querySelectorAll('.mobile-drop-zone').forEach(el => {
            el.classList.remove('mobile-drop-zone');
        });
        
        // Remove instruction text
        const instruction = document.querySelector('.mobile-drag-instruction');
        if (instruction) {
            instruction.remove();
        }
    }

    showTentativeContextMenu(event, dayIndex, serviceIndex) {
        event.preventDefault();
        
        // Remove any existing context menu
        const existingMenu = document.getElementById('tentative-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        const service = this.days[dayIndex].services[serviceIndex];
        const isTentative = service.tentative;
        
        // Create context menu
        const contextMenu = document.createElement('div');
        contextMenu.id = 'tentative-context-menu';
        contextMenu.className = 'context-menu';
        contextMenu.innerHTML = `
            <div class="context-menu-item" onclick="calculator.toggleTentativeStatus(${dayIndex}, ${serviceIndex})">
                ${isTentative ? 'Unmark as Tentative' : 'Mark as Tentative'}
            </div>
        `;
        
        // Position the menu
        contextMenu.style.position = 'absolute';
        contextMenu.style.left = event.pageX + 'px';
        contextMenu.style.top = event.pageY + 'px';
        contextMenu.style.zIndex = '1000';
        
        document.body.appendChild(contextMenu);
        
        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        
        // Delay adding the event listener to avoid immediate closure
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    toggleTentativeStatus(dayIndex, serviceIndex) {
        const service = this.days[dayIndex].services[serviceIndex];
        service.tentative = !service.tentative;
        
        // Remove context menu
        const contextMenu = document.getElementById('tentative-context-menu');
        if (contextMenu) {
            contextMenu.remove();
        }
        
        this.renderDays();
        this.updateTotal();
        this.markQuoteAsModified();
        this.saveDraftToLocalStorage();
    }

    handleServiceClick(event, dayIndex, serviceIndex) {
        // On desktop, just show tooltip immediately (no double-click for tentative)
        if (window.innerWidth > 768) {
            this.toggleTooltip(event);
            return;
        }
        
        // Mobile only: Check if this is a double tap (within 300ms of the last tap)
        const now = Date.now();
        const lastTap = this.lastServiceTap || 0;
        const timeDiff = now - lastTap;
        
        // Store this tap time for next comparison
        this.lastServiceTap = now;
        
        // If it's a double tap (within 300ms)
        if (timeDiff < 300 && timeDiff > 0) {
            // Prevent default behavior
            event.preventDefault();
            event.stopPropagation();
            
            // Cancel any pending tooltip
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
            
            // Close any active tooltips
            document.querySelectorAll('.service-name.has-tooltip.active').forEach(el => {
                el.classList.remove('active');
            });
            
            // Toggle tentative status
            this.toggleTentativeStatus(dayIndex, serviceIndex);
            
            // Reset the tap counter
            this.lastServiceTap = 0;
        } else {
            // Single tap on mobile - show tooltip after delay
            this.toggleTooltip(event);
        }
    }

    handleServiceDoubleTap(event, dayIndex, serviceIndex) {
        // This method is kept for touch events but now just delegates to handleServiceClick
        // We need both because desktop uses click and mobile uses touchend
        this.handleServiceClick(event, dayIndex, serviceIndex);
    }

    // Toggle Override Mode
    toggleOverrideMode() {
        this.isOverrideMode = !this.isOverrideMode;
        
        const button = document.getElementById('overrideBtn');
        const banner = document.getElementById('overrideBanner');
        
        if (this.isOverrideMode) {
            button.textContent = 'Exit Override';
            button.classList.add('active');
            banner.style.display = 'block';
        } else {
            button.textContent = 'Override';
            button.classList.remove('active');
            banner.style.display = 'none';
        }
        
        // Re-render to update click handlers
        this.renderDays();
    }

    // Open edit service modal
    openEditServiceModal(dayIndex, serviceIndex) {
        const service = this.days[dayIndex].services[serviceIndex];
        const originalService = this.getServiceById(service.id);
        
        // Create modal if it doesn't exist
        if (!document.getElementById('editServiceModal')) {
            this.createEditServiceModal();
        }
        
        const modal = document.getElementById('editServiceModal');
        const serviceNameInput = document.getElementById('editServiceName');
        const unitPriceInput = document.getElementById('editUnitPrice');
        const descriptionTextarea = document.getElementById('editServiceDescription');
        const originalNameSpan = document.getElementById('originalServiceName');
        const originalPriceSpan = document.getElementById('originalUnitPrice');
        const originalDescriptionSpan = document.getElementById('originalServiceDescription');
        
        // Set current values (use current edited values, not original)
        serviceNameInput.value = service.name;
        unitPriceInput.value = service.price; // Use current price, not originalUnitPrice
        descriptionTextarea.value = service.description !== undefined ? service.description : (originalService?.description || '');
        
        // Set original values for reference (what the service was before any edits)
        originalNameSpan.textContent = originalService?.name || service.originalName || service.name;
        originalPriceSpan.textContent = this.formatCurrency(originalService?.price || service.originalUnitPrice || service.price);
        originalDescriptionSpan.textContent = originalService?.description || service.originalDescription || 'No description';
        
        // Store current editing context
        modal.dataset.dayIndex = dayIndex;
        modal.dataset.serviceIndex = serviceIndex;
        
        modal.style.display = 'flex';
    }

    // Create edit service modal
    createEditServiceModal() {
        const modalHTML = `
            <div id="editServiceModal" class="modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Edit Service</h2>
                        <span class="close" onclick="calculator.closeEditServiceModal()">&times;</span>
                    </div>
                    <div class="modal-body">
                        <form id="editServiceForm">
                            <div class="form-group">
                                <label for="editServiceName">Service Name</label>
                                <input type="text" id="editServiceName" required>
                            </div>
                            <div class="form-group">
                                <label for="editUnitPrice">Unit Price</label>
                                <input type="number" id="editUnitPrice" step="0.01" min="0" required>
                            </div>
                            <div class="form-group">
                                <label for="editServiceDescription">Description</label>
                                <textarea id="editServiceDescription" rows="3" placeholder="Enter service description..."></textarea>
                            </div>
                            <div class="original-values">
                                <p><strong>Original Name:</strong> <span id="originalServiceName"></span></p>
                                <p><strong>Original Unit Price:</strong> <span id="originalUnitPrice"></span></p>
                                <p><strong>Original Description:</strong> <span id="originalServiceDescription"></span></p>
                            </div>
                            <div class="modal-buttons">
                                <button type="button" class="secondary-button" onclick="calculator.revertServiceToOriginal()">Revert to Original</button>
                                <button type="button" class="secondary-button" onclick="calculator.closeEditServiceModal()">Cancel</button>
                                <button type="submit" class="primary-button">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add form submit handler
        document.getElementById('editServiceForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveServiceEdit();
        });
    }

    // Close edit service modal
    closeEditServiceModal() {
        document.getElementById('editServiceModal').style.display = 'none';
    }

    // Save service edit
    saveServiceEdit() {
        const modal = document.getElementById('editServiceModal');
        const dayIndex = parseInt(modal.dataset.dayIndex);
        const serviceIndex = parseInt(modal.dataset.serviceIndex);
        const service = this.days[dayIndex].services[serviceIndex];
        const originalService = this.getServiceById(service.id);
        
        const newName = document.getElementById('editServiceName').value.trim();
        const newUnitPrice = parseFloat(document.getElementById('editUnitPrice').value);
        const newDescription = document.getElementById('editServiceDescription').value.trim();
        
        // Store original values if not already stored
        if (!service.originalName) {
            service.originalName = originalService?.name || service.name;
        }
        if (!service.originalUnitPrice) {
            service.originalUnitPrice = originalService?.price || service.price;
        }
        if (!service.originalDescription) {
            service.originalDescription = originalService?.description || '';
        }
        
        // Update service
        service.name = newName;
        service.price = newUnitPrice;
        service.description = newDescription;
        
        // Mark as edited if different from original
        service.isNameEdited = newName !== service.originalName;
        service.isPriceEdited = newUnitPrice !== service.originalUnitPrice;
        service.isDescriptionEdited = newDescription !== service.originalDescription;
        
        this.closeEditServiceModal();
        this.renderDays();
        this.updateTotal();
        this.saveDraftToLocalStorage();
        this.markQuoteAsModified();
    }

    // Revert service to original values
    revertServiceToOriginal() {
        const modal = document.getElementById('editServiceModal');
        const dayIndex = parseInt(modal.dataset.dayIndex);
        const serviceIndex = parseInt(modal.dataset.serviceIndex);
        const service = this.days[dayIndex].services[serviceIndex];
        const originalService = this.getServiceById(service.id);
        
        // Revert to original values
        service.name = service.originalName || originalService?.name || service.name;
        service.price = service.originalUnitPrice || originalService?.price || service.price;
        service.description = service.originalDescription || originalService?.description || '';
        
        // Clear edited flags
        service.isNameEdited = false;
        service.isPriceEdited = false;
        service.isDescriptionEdited = false;
        
        this.closeEditServiceModal();
        this.renderDays();
        this.updateTotal();
        this.saveDraftToLocalStorage();
        this.markQuoteAsModified();
    }

    // ============== MARKUP FUNCTIONALITY ==============

    showMarkupModal() {
        const modal = document.getElementById('markupModal');
        this.populateMarkupServiceList('markupServiceList');
        
        // Reset form
        document.getElementById('markupForm').reset();
        
        // Set up event listener for this modal if not already done
        this.setupMarkupEventListeners();
        
        modal.style.display = 'flex';
    }

    setupMarkupEventListeners() {
        const markupForm = document.getElementById('markupForm');
        if (markupForm && !markupForm.hasAttribute('data-listener-added')) {
            markupForm.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('📝 Markup form submitted');
                this.addMarkup();
            });
            markupForm.setAttribute('data-listener-added', 'true');
            console.log('✅ Markup form event listener added');
        }
        
        const editMarkupForm = document.getElementById('editMarkupForm');
        if (editMarkupForm && !editMarkupForm.hasAttribute('data-listener-added')) {
            editMarkupForm.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('📝 Edit markup form submitted');
                this.updateMarkup();
            });
            editMarkupForm.setAttribute('data-listener-added', 'true');
            console.log('✅ Edit markup form event listener added');
        }
    }

    hideMarkupModal() {
        document.getElementById('markupModal').style.display = 'none';
    }

    populateMarkupServiceList(containerId) {
        const container = document.getElementById(containerId);
        
        // Check if there are any services across all days
        const hasServices = this.days.some(day => day.services.length > 0);
        
        if (!hasServices) {
            container.innerHTML = '<div class="markup-no-services">No services available to apply markup to.</div>';
            return;
        }

        let html = '';
        
        this.days.forEach((day, dayIndex) => {
            if (day.services.length > 0) {
                const dayLabel = day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`;
                
                html += `<div class="markup-day-group">`;
                html += `<div class="markup-day-header">${dayLabel}</div>`;
                
                day.services.forEach((service, serviceIndex) => {
                    const serviceId = `${dayIndex}-${serviceIndex}`;
                    const serviceDefinition = this.getServiceById(service.id);
                    const isSubservice = serviceDefinition?.isSubservice || false;
                    const itemClass = isSubservice ? 'subservice' : '';
                    const displayName = isSubservice ? `└─ ${service.name}` : service.name;
                    const totalPrice = service.price * (service.quantity || 1);
                    
                    html += `
                        <div class="markup-service-item ${itemClass}">
                            <input type="checkbox" id="service-${serviceId}" value="${serviceId}">
                            <label for="service-${serviceId}" class="markup-service-label">
                                <span class="markup-service-name">${displayName}</span>
                                <span class="markup-service-price">${this.formatCurrency(totalPrice)}</span>
                            </label>
                        </div>
                    `;
                });
                
                html += '</div>';
            }
        });
        
        container.innerHTML = html;
    }

    addMarkup() {
        console.log('🔄 addMarkup() called');
        const form = document.getElementById('markupForm');
        if (!form) {
            console.error('❌ markupForm not found');
            return;
        }
        
        const formData = new FormData(form);
        
        const name = formData.get('markupName') || document.getElementById('markupName').value.trim();
        const description = formData.get('markupDescription') || document.getElementById('markupDescription').value.trim();
        const percentage = parseFloat(formData.get('markupPercentage') || document.getElementById('markupPercentage').value);
        
        console.log('📝 Form data:', { name, description, percentage });
        
        // Validate inputs
        if (!name) {
            showAlertModal('Please enter a markup name.', 'error');
            return;
        }
        
        if (isNaN(percentage) || percentage < 0) {
            showAlertModal('Please enter a valid percentage.', 'error');
            return;
        }
        
        // Get selected services
        const checkboxes = document.querySelectorAll('#markupServiceList input[type="checkbox"]:checked');
        
        if (checkboxes.length === 0) {
            showAlertModal('Please select at least one service to apply markup to.', 'error');
            return;
        }
        
        const selectedServices = Array.from(checkboxes).map(cb => {
            const [dayIndex, serviceIndex] = cb.value.split('-').map(Number);
            return {
                dayIndex,
                serviceIndex,
                service: this.days[dayIndex].services[serviceIndex]
            };
        });
        
        // Calculate markup amount
        const baseAmount = selectedServices.reduce((total, { service }) => {
            return total + (service.price * (service.quantity || 1));
        }, 0);
        
        const markupAmount = baseAmount * (percentage / 100);
        
        // Create markup object
        const markup = {
            id: Date.now().toString(), // Simple ID generation
            name,
            description,
            percentage,
            baseAmount,
            markupAmount,
            selectedServices: selectedServices.map(s => ({
                dayIndex: s.dayIndex,
                serviceIndex: s.serviceIndex,
                serviceName: s.service.name,
                servicePrice: s.service.price,
                serviceQuantity: s.service.quantity || 1
            }))
        };
        
        // Add to markups array
        this.markups.push(markup);
        
        // Update display
        this.renderMarkups();
        this.updateTotal();
        this.saveDraftToLocalStorage();
        this.markQuoteAsModified();
        
        // Hide modal and show success message
        this.hideMarkupModal();
        showAlertModal(`Markup "${name}" added successfully!`, 'success', null, true);
    }

    renderMarkups() {
        const container = document.getElementById('markupList');
        
        if (this.markups.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        container.innerHTML = this.markups.map(markup => `
            <div class="markup-item">
                <div class="markup-info">
                    <div class="markup-name">${markup.name}</div>
                    <div class="markup-details">
                        ${markup.percentage}% on ${this.formatCurrency(markup.baseAmount)}${markup.description ? ` • ${markup.description}` : ''}
                    </div>
                </div>
                <div class="markup-amount">${this.formatCurrency(markup.markupAmount)}</div>
                <div class="markup-actions">
                    <button class="markup-edit-btn" onclick="calculator.editMarkup('${markup.id}')">Edit</button>
                    <button class="markup-remove-btn" onclick="calculator.removeMarkup('${markup.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    }

    editMarkup(markupId) {
        const markup = this.markups.find(m => m.id === markupId);
        if (!markup) return;
        
        const modal = document.getElementById('editMarkupModal');
        modal.dataset.markupId = markupId;
        
        // Populate form with current values
        document.getElementById('editMarkupName').value = markup.name;
        document.getElementById('editMarkupDescription').value = markup.description || '';
        document.getElementById('editMarkupPercentage').value = markup.percentage;
        
        // Populate service list and check previously selected services
        this.populateMarkupServiceList('editMarkupServiceList');
        
        // Set up event listeners if not already done
        this.setupMarkupEventListeners();
        
        // Check the previously selected services
        setTimeout(() => {
            markup.selectedServices.forEach(selectedService => {
                const serviceId = `${selectedService.dayIndex}-${selectedService.serviceIndex}`;
                const checkbox = document.querySelector(`#editMarkupServiceList input[value="${serviceId}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            });
        }, 100);
        
        modal.style.display = 'flex';
    }

    hideEditMarkupModal() {
        document.getElementById('editMarkupModal').style.display = 'none';
    }

    updateMarkup() {
        const modal = document.getElementById('editMarkupModal');
        const markupId = modal.dataset.markupId;
        const markupIndex = this.markups.findIndex(m => m.id === markupId);
        
        if (markupIndex === -1) return;
        
        const name = document.getElementById('editMarkupName').value.trim();
        const description = document.getElementById('editMarkupDescription').value.trim();
        const percentage = parseFloat(document.getElementById('editMarkupPercentage').value);
        
        // Validate inputs
        if (!name) {
            showAlertModal('Please enter a markup name.', 'error');
            return;
        }
        
        if (isNaN(percentage) || percentage < 0) {
            showAlertModal('Please enter a valid percentage.', 'error');
            return;
        }
        
        // Get selected services
        const checkboxes = document.querySelectorAll('#editMarkupServiceList input[type="checkbox"]:checked');
        
        if (checkboxes.length === 0) {
            showAlertModal('Please select at least one service to apply markup to.', 'error');
            return;
        }
        
        const selectedServices = Array.from(checkboxes).map(cb => {
            const [dayIndex, serviceIndex] = cb.value.split('-').map(Number);
            return {
                dayIndex,
                serviceIndex,
                service: this.days[dayIndex].services[serviceIndex]
            };
        });
        
        // Calculate new markup amount
        const baseAmount = selectedServices.reduce((total, { service }) => {
            return total + (service.price * (service.quantity || 1));
        }, 0);
        
        const markupAmount = baseAmount * (percentage / 100);
        
        // Update markup object
        this.markups[markupIndex] = {
            ...this.markups[markupIndex],
            name,
            description,
            percentage,
            baseAmount,
            markupAmount,
            selectedServices: selectedServices.map(s => ({
                dayIndex: s.dayIndex,
                serviceIndex: s.serviceIndex,
                serviceName: s.service.name,
                servicePrice: s.service.price,
                serviceQuantity: s.service.quantity || 1
            }))
        };
        
        // Update display
        this.renderMarkups();
        this.updateTotal();
        this.saveDraftToLocalStorage();
        this.markQuoteAsModified();
        
        // Hide modal and show success message
        this.hideEditMarkupModal();
        showAlertModal(`Markup "${name}" updated successfully!`, 'success', null, true);
    }

    async removeMarkup(markupId) {
        const markup = this.markups.find(m => m.id === markupId);
        if (!markup) return;
        
        const confirmed = await showConfirmModal(
            `Are you sure you want to remove the markup "${markup.name}"?`,
            `Remove Markup`,
            'Remove',
            'Cancel'
        );
        
        if (confirmed) {
            this.markups = this.markups.filter(m => m.id !== markupId);
            this.renderMarkups();
            this.updateTotal();
            this.saveDraftToLocalStorage();
            this.markQuoteAsModified();
            
            showAlertModal(`Markup "${markup.name}" removed successfully!`, 'success', null, true);
        }
    }

    calculateMarkupsTotal() {
        return this.markups.reduce((total, markup) => total + markup.markupAmount, 0);
    }

    // Update the calculateTotal method to include markups
    calculateTotalWithMarkups() {
        const serviceTotal = this.calculateTotal();
        const markupsTotal = this.calculateMarkupsTotal();
        return serviceTotal + markupsTotal;
    }
}

// Initialize calculator when page loads
let calculator;
document.addEventListener('DOMContentLoaded', () => {
    calculator = new QuoteCalculator();
    
    // Check if we should load a quote from calendar navigation
    const loadQuoteData = sessionStorage.getItem('loadQuoteData');
    if (loadQuoteData) {
        try {
            const quoteData = JSON.parse(loadQuoteData);
            sessionStorage.removeItem('loadQuoteData'); // Clean up
            
            // Load the quote data into the calculator
            calculator.loadQuoteFromData(quoteData);
            
        } catch (error) {
            console.error('Error loading quote from calendar:', error);
            showAlertModal('Failed to load quote from calendar.', 'error');
        }
    }
});

// Global functions for HTML onclick handlers
function showSaveModal() {
    calculator.showSaveModal();
}

function closeSaveModal() {
    calculator.closeSaveModal();
}

async function saveAsCopy() {
    const title = document.getElementById('saveQuoteTitle').value.trim();
    const clientName = document.getElementById('clientName').value.trim();
    const location = document.getElementById('eventLocation').value.trim();
    const booked = document.getElementById('bookedCheckbox').checked;
    const createdBy = document.getElementById('createdBySelect').value || null;
    
    if (!title) {
        showAlertModal('Please enter a quote title.', 'error');
        return;
    }

    // Create copy title
    const copyTitle = `Copy of ${title}`;
    
    const quoteData = {
        days: calculator.days,
        total: calculator.getFinalTotal(),
        discountPercentage: calculator.discountPercentage
    };

    try {
        const response = await fetch('/api/save-quote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                name: copyTitle, 
                quoteData,
                clientName: clientName || null,
                location: location || null,
                booked: booked,
                createdBy: createdBy
            })
        });

        const result = await response.json();

        if (response.status === 409) {
            // Quote name already exists, try with a number suffix
            let counter = 2;
            let uniqueTitle = `${copyTitle} (${counter})`;
            
            while (true) {
                const retryResponse = await fetch('/api/save-quote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        name: uniqueTitle, 
                        quoteData,
                        clientName: clientName || null,
                        location: location || null,
                        booked: booked,
                        createdBy: createdBy
                    })
                });
                
                const retryResult = await retryResponse.json();
                
                if (retryResult.success) {
                    calculator.currentQuoteName = uniqueTitle;
                    calculator.currentClientName = clientName || null;
                    calculator.currentQuoteTitle = uniqueTitle;
                    
                    // Update displays
                    calculator.updateQuoteTitleDisplay();
                    calculator.updateClientDisplay();
                    calculator.closeSaveModal();
                    showAlertModal(`Quote saved as "${uniqueTitle}"!`, 'success', null, true);
                    break;
                } else if (retryResponse.status === 409) {
                    counter++;
                    uniqueTitle = `${copyTitle} (${counter})`;
                } else {
                    throw new Error(retryResult.error || 'Failed to save quote copy');
                }
            }
        } else if (result.success) {
            calculator.currentQuoteName = copyTitle;
            calculator.currentClientName = clientName || null;
            calculator.currentQuoteTitle = copyTitle;
            
            // Update displays
            calculator.updateQuoteTitleDisplay();
            calculator.updateClientDisplay();
            calculator.closeSaveModal();
            showAlertModal(`Quote saved as "${copyTitle}"!`, 'success', null, true);
        } else {
            throw new Error(result.error || 'Failed to save quote copy');
        }
    } catch (error) {
        console.error('Error saving quote copy:', error);
        showAlertModal('Error saving quote copy. Please try again.', 'error');
    }
}

function showLoadModal() {
    calculator.showLoadModal();
}

function closeLoadModal() {
    calculator.closeLoadModal();
}

function filterQuotes() {
    calculator.filterQuotes();
}

function sortQuotes() {
    calculator.sortQuotes();
}

function toggleDiscount() {
    calculator.toggleDiscount();
}

function applyDiscount() {
    calculator.applyDiscount();
}

function removeDiscount() {
    calculator.removeDiscount();
}

async function clearQuote() {
    const confirmed = await showConfirmModal(
        'Are you sure you want to clear the entire quote? This will remove all services, dates, and settings. This action cannot be undone.',
        'Clear Quote',
        'Clear Quote',
        'Cancel'
    );
    
    if (confirmed) {
        calculator.clearDraft();
        showAlertModal('Quote cleared successfully!', 'success', null, true);
    }
}

// Custom Modal System
let currentAlertModal = null;
let currentConfirmCallback = null;
let currentPromptCallback = null;

function showAlertModal(message, type = 'info', title = null, autoClose = false) {
    const modal = document.getElementById('alertModal');
    const titleEl = document.getElementById('alertModalTitle');
    const messageEl = document.getElementById('alertModalMessage');
    const iconEl = document.getElementById('alertModalIcon');
    const contentEl = modal.querySelector('.alert-modal-content');
    
    // Set title
    titleEl.textContent = title || (type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Information');
    
    // Set message
    messageEl.textContent = message;
    
    // Set icon type
    iconEl.className = `alert-icon ${type}`;
    
    // Remove any existing auto-close class
    contentEl.classList.remove('auto-close');
    
    // Show modal
    modal.style.display = 'flex';
    currentAlertModal = modal;
    
    // Auto-close for success messages
    if (autoClose && type === 'success') {
        contentEl.classList.add('auto-close');
        setTimeout(() => {
            hideAlertModal();
        }, 3500);
    }
    
    // Focus management
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
            currentAlertModal = null;
        }, 200);
    }
}

function showConfirmModal(message, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmModalTitle');
        const messageEl = document.getElementById('confirmModalMessage');
        const confirmBtn = document.getElementById('confirmModalOk');
        
        // Set content
        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;
        
        // Set callback
        currentConfirmCallback = resolve;
        
        // Show modal
        modal.style.display = 'flex';
        
        // Focus management
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

function showPromptModal(message, defaultValue = '', title = 'Input Required', placeholder = 'Enter value') {
    return new Promise((resolve) => {
        const modal = document.getElementById('promptModal');
        const titleEl = document.getElementById('promptModalTitle');
        const labelEl = document.getElementById('promptModalLabel');
        const inputEl = document.getElementById('promptModalInput');
        const form = document.getElementById('promptForm');
        
        // Set content
        titleEl.textContent = title;
        labelEl.textContent = message;
        inputEl.value = defaultValue;
        inputEl.placeholder = placeholder;
        
        // Set callback
        currentPromptCallback = resolve;
        
        // Show modal
        modal.style.display = 'flex';
        
        // Focus management
        setTimeout(() => {
            inputEl.focus();
            inputEl.select();
        }, 100);
        
        // Handle form submission
        form.onsubmit = (e) => {
            e.preventDefault();
            hidePromptModal(inputEl.value.trim());
        };
    });
}

function hidePromptModal(result) {
    const modal = document.getElementById('promptModal');
    if (modal) {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.style.display = 'none';
            modal.classList.remove('closing');
            if (currentPromptCallback) {
                currentPromptCallback(result);
                currentPromptCallback = null;
            }
        }, 200);
    }
}

function showExportModal(defaultTitle = '', defaultClientName = '') {
    return new Promise((resolve) => {
        // Create modal HTML if it doesn't exist
        let modal = document.getElementById('exportModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'exportModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Export Details</h2>
                        <span class="close" onclick="hideExportModal(null)">&times;</span>
                    </div>
                    <div class="modal-body">
                        <form id="exportForm">
                            <div class="form-group">
                                <label for="exportTitle">Quote Title (optional):</label>
                                <input type="text" id="exportTitle" placeholder="Enter quote title">
                            </div>
                            <div class="form-group">
                                <label for="exportClientName">Client Name (optional):</label>
                                <input type="text" id="exportClientName" placeholder="Enter client name">
                            </div>
                        </form>
                    </div>
                    <div class="modal-buttons">
                        <button type="button" class="secondary-button" onclick="hideExportModal(null)">Cancel</button>
                        <button type="button" class="primary-button" onclick="submitExportModal()">Continue</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        const titleInput = document.getElementById('exportTitle');
        const clientNameInput = document.getElementById('exportClientName');
        
        // Set default values
        titleInput.value = defaultTitle;
        clientNameInput.value = defaultClientName;
        
        // Set callback
        window.currentExportCallback = resolve;
        
        // Show modal
        modal.style.display = 'flex';
        
        // Focus management
        setTimeout(() => {
            titleInput.focus();
            titleInput.select();
        }, 100);
        
        // Handle form submission
        const form = document.getElementById('exportForm');
        form.onsubmit = (e) => {
            e.preventDefault();
            submitExportModal();
        };
    });
}

function hideExportModal(result) {
    const modal = document.getElementById('exportModal');
    if (modal) {
        modal.classList.add('closing');
        setTimeout(() => {
            modal.style.display = 'none';
            modal.classList.remove('closing');
            if (window.currentExportCallback) {
                window.currentExportCallback(result);
                window.currentExportCallback = null;
            }
        }, 200);
    }
}

function submitExportModal() {
    const titleInput = document.getElementById('exportTitle');
    const clientNameInput = document.getElementById('exportClientName');
    
    const result = {
        title: titleInput.value.trim() || null,
        clientName: clientNameInput.value.trim() || null
    };
    
    hideExportModal(result);
}

// Keyboard support for modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (currentAlertModal) {
            hideAlertModal();
        } else if (document.getElementById('confirmModal').style.display === 'flex') {
            hideConfirmModal(false);
        } else if (document.getElementById('promptModal').style.display === 'flex') {
            hidePromptModal(null);
        }
    }
});

// Close tooltips when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.service-name.has-tooltip')) {
        document.querySelectorAll('.service-name.has-tooltip.active').forEach(el => {
            el.classList.remove('active');
        });
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

// Editable Quote Title Functions
function editQuoteTitle() {
    const titleElement = document.getElementById('quoteTitle');
    const inputElement = document.getElementById('quoteTitleInput');
    
    inputElement.value = titleElement.textContent;
    titleElement.style.display = 'none';
    inputElement.style.display = 'inline-block';
    inputElement.focus();
    inputElement.select();
}

async function saveQuoteTitle() {
    const titleElement = document.getElementById('quoteTitle');
    const inputElement = document.getElementById('quoteTitleInput');
    
    const newTitle = inputElement.value.trim();
    if (newTitle) {
        titleElement.textContent = newTitle;
        if (calculator) {
            const oldTitle = calculator.currentQuoteTitle;
            calculator.currentQuoteTitle = newTitle;
            calculator.saveDraftToLocalStorage(); // Save the title change to localStorage
            
            // If there's a current quote saved, automatically update it in the database
            if (calculator.currentQuoteName && oldTitle !== newTitle) {
                try {
                    await calculator.autoSaveQuoteTitle(newTitle);
                } catch (error) {
                    console.error('Error auto-saving quote title:', error);
                    // Show a subtle notification
                    showAlertModal('Title updated locally. Save quote to update database.', 'info');
                }
            }
        }
    }
    
    inputElement.style.display = 'none';
    titleElement.style.display = 'inline-block';
}

function handleTitleKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveQuoteTitle();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        const titleElement = document.getElementById('quoteTitle');
        const inputElement = document.getElementById('quoteTitleInput');
        
        inputElement.style.display = 'none';
        titleElement.style.display = 'inline-block';
    }
}

// Client dropdown functionality
function toggleClientDropdown() {
    const dropdown = document.getElementById('clientDropdown');
    if (dropdown.style.display === 'none' || !dropdown.style.display) {
        calculator.showClientDropdown();
    } else {
        calculator.hideClientDropdown();
    }
}

function hideClientDropdown() {
    calculator.hideClientDropdown();
}

function filterClients() {
    if (!calculator.allClients) return;
    
    const input = document.getElementById('clientName');
    const filter = input.value.toLowerCase();
    
    if (filter === '') {
        calculator.displayClients(calculator.allClients);
    } else {
        const filtered = calculator.allClients.filter(client => 
            client.toLowerCase().includes(filter)
        );
        calculator.displayClients(filtered);
    }
} 