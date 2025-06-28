class QuoteCalculator {
    constructor() {
        this.services = [];
        this.days = [{ services: [], date: null }];
        this.discountPercentage = 0;
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.activeCalendar = null;
        this.autoSaveKey = 'quote_calculator_draft';
        
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
        
        this.init();
    }

    async init() {
        await this.loadServices();
        this.loadDraftFromLocalStorage();
        this.setupEventListeners();
        this.renderDays();
        this.updateTotal();
    }

    loadDraftFromLocalStorage() {
        try {
            const savedDraft = localStorage.getItem(this.autoSaveKey);
            if (savedDraft) {
                const draftData = JSON.parse(savedDraft);
                this.days = draftData.days || [{ services: [], date: null }];
                this.discountPercentage = draftData.discountPercentage || 0;
                this.currentQuoteName = draftData.currentQuoteName || null;
                this.currentClientName = draftData.currentClientName || null;
                
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
                currentQuoteName: this.currentQuoteName,
                currentClientName: this.currentClientName,
                lastSaved: new Date().toISOString()
            };
            localStorage.setItem(this.autoSaveKey, JSON.stringify(draftData));
        } catch (error) {
            console.warn('⚠️ Error saving draft to localStorage:', error);
        }
    }

    clearDraft() {
        localStorage.removeItem(this.autoSaveKey);
        this.days = [{ services: [], date: null }];
        this.discountPercentage = 0;
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.renderDays();
        this.updateTotal();
        this.updateClientDisplay();
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

    renderDays() {
        const container = document.getElementById('days-container');
        container.innerHTML = '';

        this.days.forEach((day, dayIndex) => {
            // Render each service as its own row
            day.services.forEach((service, serviceIndex) => {
                const serviceRow = document.createElement('div');
                serviceRow.className = 'day-row draggable-service';
                serviceRow.draggable = true;
                serviceRow.dataset.dayIndex = dayIndex;
                serviceRow.dataset.serviceIndex = serviceIndex;
                serviceRow.dataset.serviceId = service.id;
                
                serviceRow.innerHTML = `
                    <div class="day-cell">
                        ${serviceIndex === 0 ? `
                                                    <span class="day-header ${day.date ? 'has-date' : ''}" onclick="calculator.showCalendar(${dayIndex}, this)">
                            ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                        </span>
                            ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
                        ` : ''}
                    </div>
                    <div class="service-cell">
                        <div class="service-name ${this.getServiceById(service.id)?.isSubservice ? 'subservice' : ''} ${this.getServiceById(service.id)?.description ? 'has-tooltip' : ''}" ${this.getServiceById(service.id)?.description ? `onclick="calculator.toggleTooltip(event)"` : ''}>
                            <span class="drag-handle">⋮⋮</span>
                            <span class="service-text">${this.getServiceById(service.id)?.isSubservice ? '└─ ' : ''}${service.name}</span>
                            ${this.getServiceById(service.id)?.description ? `<div class="tooltip">${this.getServiceById(service.id).description}</div>` : ''}
                        </div>
                        <button class="remove-service" onclick="calculator.removeService(${dayIndex}, ${serviceIndex})">×</button>
                    </div>
                    <div class="quantity-cell">
                        <input type="number" 
                               class="quantity-input" 
                               value="${service.quantity}" 
                               min="1" 
                               max="99"
                               onchange="calculator.updateQuantity(${dayIndex}, ${serviceIndex}, this.value)"
                               onclick="this.select()">
                    </div>
                    <div class="price-cell">
                        ${this.formatCurrency(service.price * service.quantity)}
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
                
                container.appendChild(serviceRow);
            });

            // Add the "Add Service" row for each day
            if (day.services.length === 0) {
                // Empty day row with drop zone functionality
                const emptyRow = document.createElement('div');
                emptyRow.className = 'day-row empty-day-drop-zone';
                emptyRow.dataset.dayIndex = dayIndex;
                emptyRow.dataset.serviceIndex = 0; // First service position
                emptyRow.dataset.isDropZone = 'true';
                emptyRow.dataset.isEmpty = 'true';
                
                emptyRow.innerHTML = `
                    <div class="day-cell">
                        <span class="day-header ${day.date ? 'has-date' : ''}" onclick="calculator.showCalendar(${dayIndex}, this)">
                            ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                        </span>
                        ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
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
                
                // Validate dependencies before adding
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
        this.days[dayIndex].services.push(service);
        this.renderDays();
        this.updateTotal();
        this.saveDraftToLocalStorage();
    }

    removeService(dayIndex, serviceIndex) {
        const serviceToRemove = this.days[dayIndex].services[serviceIndex];
        
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
        return this.days[dayIndex].services.reduce((total, service) => total + (service.price * service.quantity), 0);
    }

    calculateTotal() {
        return this.days.reduce((total, day) => total + this.calculateDayTotal(this.days.indexOf(day)), 0);
    }

    updateTotal() {
        const subtotal = this.calculateTotal();
        const discountAmount = subtotal * (this.discountPercentage / 100);
        const total = subtotal - discountAmount;
        
        // Update display based on whether discount is applied
        if (this.discountPercentage > 0) {
            // Show subtotal, discount, and total
            document.getElementById('subtotalRow').style.display = 'flex';
            document.getElementById('discountRow').style.display = 'flex';
            document.getElementById('subtotal-amount').textContent = this.formatCurrency(subtotal);
            document.getElementById('discount-label').textContent = `Discount (${this.discountPercentage}%)`;
            document.getElementById('discount-amount').textContent = `-${this.formatCurrency(discountAmount)}`;
            document.getElementById('total-amount').textContent = this.formatCurrency(total);
        } else {
            // Hide subtotal and discount rows, show only total
            document.getElementById('subtotalRow').style.display = 'none';
            document.getElementById('discountRow').style.display = 'none';
            document.getElementById('total-amount').textContent = this.formatCurrency(subtotal);
        }
        
        // Enable/disable PDF and Excel buttons
        const pdfButton = document.getElementById('generate-pdf');
        const excelButton = document.getElementById('export-excel');
        const hasServices = this.days.some(day => day.services.length > 0);
        
        pdfButton.disabled = !hasServices;
        excelButton.disabled = !hasServices;
        
        if (hasServices) {
            pdfButton.textContent = 'Download Quote (PDF)';
            excelButton.textContent = 'Export to Excel';
        } else {
            pdfButton.textContent = 'Select services to generate quote';
            excelButton.textContent = 'Export to Excel';
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
            const quoteData = {
                days: this.days,
                subtotal: subtotal,
                total: this.getFinalTotal(),
                discountPercentage: this.discountPercentage,
                discountAmount: subtotal * (this.discountPercentage / 100),
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
            const discountAmount = subtotal * (this.discountPercentage / 100);
            const total = this.getFinalTotal();

            // Send data to server for XLSX generation
            const quoteData = {
                days: this.days,
                subtotal: subtotal,
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
    showSaveModal() {
        // Pre-fill form with current quote info if available
        document.getElementById('quoteTitle').value = this.currentQuoteName || '';
        document.getElementById('clientName').value = this.currentClientName || '';
        
        // Show modal
        document.getElementById('saveModal').style.display = 'flex';
        
        // Focus on title input
        setTimeout(() => {
            document.getElementById('quoteTitle').focus();
            // If pre-filled, select all text for easy replacement
            if (this.currentQuoteName) {
                document.getElementById('quoteTitle').select();
            }
        }, 100);
    }

    closeSaveModal() {
        document.getElementById('saveModal').style.display = 'none';
    }

    async saveQuoteFromModal(event) {
        event.preventDefault();
        
        const title = document.getElementById('quoteTitle').value.trim();
        const clientName = document.getElementById('clientName').value.trim();
        
        if (!title) {
            showAlertModal('Please enter a quote title.', 'error');
            return;
        }

        const quoteData = {
            days: this.days,
            total: this.getFinalTotal(),
            discountPercentage: this.discountPercentage
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
                    clientName: clientName || null
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
                    await this.overwriteQuote(title, quoteData, clientName);
                }
            } else if (result.success) {
                // Update current quote info
                this.currentQuoteName = title;
                this.currentClientName = clientName || null;
                this.updateClientDisplay();
                
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

    async overwriteQuote(name, quoteData, clientName) {
        try {
            const response = await fetch('/api/overwrite-quote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    name, 
                    quoteData,
                    clientName: clientName || null
                })
            });

            const result = await response.json();

            if (result.success) {
                // Update current quote info
                this.currentQuoteName = name;
                this.currentClientName = clientName || null;
                this.updateClientDisplay();
                
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
        if (this.currentClientName) {
            clientDisplay.textContent = `Client: ${this.currentClientName}`;
            clientDisplay.style.display = 'inline';
        } else {
            clientDisplay.style.display = 'none';
        }
    }

    clearCurrentQuote() {
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.updateClientDisplay();
    }

    markQuoteAsModified() {
        // Keep the quote name and client name for saving/PDF, but update display to show it's modified
        // This allows the save modal to be pre-filled and PDF to use existing client name
        this.updateClientDisplay();
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
            
            return `
                <div class="quote-item" onclick="calculator.confirmLoadQuote('${quote.name}')">
                    <div class="quote-item-header">
                        <h3 class="quote-name">${quote.name}</h3>
                        <div class="quote-actions">
                            <button class="delete-quote-btn" onclick="event.stopPropagation(); calculator.deleteQuote('${quote.name}')">Delete</button>
                        </div>
                    </div>
                    <div class="quote-info">
                        <span>💰 Total: ${this.formatCurrency(quote.quoteData.total)}</span>
                        <span>📅 Days: ${quote.quoteData.days.length}</span>
                        <span>🎯 Services: ${totalServices}</span>
                        <span>📅 Created: ${createdDate}</span>
                        ${createdDate !== updatedDate ? `<span>✏️ Updated: ${updatedDate}</span>` : ''}
                        ${quote.clientName ? `<span>👤 Client: ${quote.clientName}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    filterQuotes() {
        const searchTerm = document.getElementById('searchQuotes').value.toLowerCase();
        const filtered = this.allQuotes.filter(quote => 
            quote.name.toLowerCase().includes(searchTerm) ||
            (quote.clientName && quote.clientName.toLowerCase().includes(searchTerm))
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
            this.currentQuoteName = quote.name;
            this.currentClientName = quote.clientName || null;
            
            // Ensure all services have quantity property and days have date property
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
            
            // Re-render the interface
            this.renderDays();
            this.updateTotal();
            
            // Close the modal
            this.closeLoadModal();
            
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

    getFinalTotal() {
        const subtotal = this.calculateTotal();
        const discountAmount = subtotal * (this.discountPercentage / 100);
        return subtotal - discountAmount;
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

    // Touch event handlers for mobile drag and drop
    handleTouchStart(event) {
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
        
        // Close all other tooltips
        document.querySelectorAll('.service-name.has-tooltip.active').forEach(el => {
            if (el !== serviceName) {
                el.classList.remove('active');
            }
        });
        
        // Toggle this tooltip
        if (isActive) {
            serviceName.classList.remove('active');
        } else {
            serviceName.classList.add('active');
            
            // Auto-close on mobile after 3 seconds
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    serviceName.classList.remove('active');
                }, 3000);
            }
        }
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
}

// Initialize calculator when page loads
let calculator;
document.addEventListener('DOMContentLoaded', () => {
    calculator = new QuoteCalculator();
});

// Global functions for HTML onclick handlers
function showSaveModal() {
    calculator.showSaveModal();
}

function closeSaveModal() {
    calculator.closeSaveModal();
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