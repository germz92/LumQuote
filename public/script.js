class QuoteCalculator {
    constructor() {
        this.services = [];
        this.days = [{ services: [], date: null }];
        this.discountPercentage = 0;
        this.currentQuoteName = null;
        this.currentClientName = null;
        this.activeCalendar = null;
        this.init();
    }

    async init() {
        await this.loadServices();
        this.setupEventListeners();
        this.renderDays();
        this.updateTotal();
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
        this.clearCurrentQuote(); // Mark as new quote when structure changes
    }

    removeDay() {
        if (this.days.length > 1) {
            this.days.pop();
            this.updateDaysDisplay();
            this.renderDays();
            this.updateTotal();
            this.clearCurrentQuote(); // Mark as new quote when structure changes
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
                serviceRow.className = 'day-row';
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
                        <div class="service-name ${this.getServiceById(service.id)?.isSubservice ? 'subservice' : ''}">
                            ${this.getServiceById(service.id)?.isSubservice ? '└─ ' : ''}${service.name}
                            <button class="remove-service" onclick="calculator.removeService(${dayIndex}, ${serviceIndex})">×</button>
                        </div>
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
                container.appendChild(serviceRow);
            });

            // Add the "Add Service" row for each day
            if (day.services.length === 0) {
                // Empty day row
                const emptyRow = document.createElement('div');
                emptyRow.className = 'day-row';
                emptyRow.innerHTML = `
                    <div class="day-cell">
                        <span class="day-header ${day.date ? 'has-date' : ''}" onclick="calculator.showCalendar(${dayIndex}, this)">
                            ${day.date ? this.formatDate(this.parseStoredDate(day.date)) : `Day ${dayIndex + 1}`}
                        </span>
                        ${this.days.length > 1 ? `<button class="remove-day-btn" onclick="calculator.removeDayByIndex(${dayIndex})">×</button>` : ''}
                    </div>
                    <div class="service-cell empty-service">No services selected</div>
                    <div class="quantity-cell"></div>
                    <div class="price-cell">$0</div>
                `;
                container.appendChild(emptyRow);
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
    }

    removeService(dayIndex, serviceIndex) {
        const serviceToRemove = this.days[dayIndex].services[serviceIndex];
        
        // Check if any other services depend on this one
        const dependentServices = this.findDependentServices(serviceToRemove.id, dayIndex);
        
        if (dependentServices.length > 0) {
            this.showDependencyRemovalError(serviceToRemove.name, dependentServices);
            return;
        }
        
        // Safe to remove
        this.days[dayIndex].services.splice(serviceIndex, 1);
        this.renderDays();
        this.updateTotal();
    }

    removeDayByIndex(dayIndex) {
        if (this.days.length > 1) {
            // Check if removing this day would break any dependencies
            const dayServices = this.days[dayIndex].services;
            let blockingDependencies = [];
            
            for (const service of dayServices) {
                const dependentServices = this.findDependentServices(service.id, dayIndex);
                if (dependentServices.length > 0) {
                    blockingDependencies.push({
                        service: service.name,
                        dependents: dependentServices
                    });
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

    updateQuantity(dayIndex, serviceIndex, newQuantity) {
        const quantity = Math.max(1, Math.min(99, parseInt(newQuantity) || 1));
        this.days[dayIndex].services[serviceIndex].quantity = quantity;
        this.renderDays();
        this.updateTotal();
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
        
        // Only prompt for client name if we don't already have one
        if (!clientName) {
            clientName = prompt('Please provide client name (optional):');
            clientName = clientName && clientName.trim() ? clientName.trim() : null;
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
                clientName: clientName
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
            if (this.currentQuoteName) {
                // Sanitize title for filename
                const sanitizedTitle = this.currentQuoteName
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
            alert('Failed to generate PDF. Please try again.');
        } finally {
            loadingOverlay.style.display = 'none';
        }
    }

    async exportExcel() {
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
                clientName: this.currentClientName
            };

            const response = await fetch('/api/generate-excel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    quoteData,
                    quoteName: this.currentQuoteName 
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
            alert('Failed to export Excel file. Please try again.');
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
        // Reset form
        document.getElementById('quoteTitle').value = '';
        document.getElementById('clientName').value = '';
        
        // Show modal
        document.getElementById('saveModal').style.display = 'flex';
        
        // Focus on title input
        setTimeout(() => {
            document.getElementById('quoteTitle').focus();
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
            alert('Please enter a quote title.');
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
                const overwrite = confirm(`A quote named "${title}" already exists. Do you want to overwrite it?`);
                if (overwrite) {
                    await this.overwriteQuote(title, quoteData, clientName);
                }
            } else if (result.success) {
                // Update current quote info
                this.currentQuoteName = title;
                this.currentClientName = clientName || null;
                this.updateClientDisplay();
                
                this.closeSaveModal();
                alert('Quote saved successfully!');
            } else {
                throw new Error(result.error || 'Failed to save quote');
            }
        } catch (error) {
            console.error('Error saving quote:', error);
            alert('Error saving quote. Please try again.');
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
                alert('Quote updated successfully!');
            } else {
                throw new Error(result.error || 'Failed to update quote');
            }
        } catch (error) {
            console.error('Error updating quote:', error);
            alert('Error updating quote. Please try again.');
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
            const confirm = window.confirm('Loading this quote will replace your current work. Are you sure you want to continue?');
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
            
            alert(`Quote "${quoteName}" loaded successfully!`);
        } catch (error) {
            console.error('Error loading quote:', error);
            alert('Error loading quote. Please try again.');
        }
    }

    async deleteQuote(quoteName) {
        const confirm = window.confirm(`Are you sure you want to delete the quote "${quoteName}"? This action cannot be undone.`);
        if (!confirm) {
            return;
        }
        
        try {
            const response = await fetch(`/api/saved-quotes/${encodeURIComponent(quoteName)}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('Quote deleted successfully!');
                await this.loadSavedQuotes(); // Refresh the list
            } else {
                throw new Error(result.error || 'Failed to delete quote');
            }
        } catch (error) {
            console.error('Error deleting quote:', error);
            alert('Error deleting quote. Please try again.');
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
        // If calendar is already open for this day, close it
        if (this.activeCalendar && this.activeCalendar.dayIndex === dayIndex) {
            this.hideCalendar();
            return;
        }
        
        // Close any existing calendar
        this.hideCalendar();
        
        const dayCell = element.closest('.day-cell');
        const calendar = this.createCalendar(dayIndex);
        dayCell.appendChild(calendar);
        this.activeCalendar = { dayIndex, element: calendar };
        
        // Position calendar
        this.positionCalendar(calendar, dayCell);
        
        // Add click outside listener
        setTimeout(() => {
            document.addEventListener('click', this.handleCalendarOutsideClick.bind(this));
        }, 0);
    }

    createCalendar(dayIndex) {
        const calendar = document.createElement('div');
        calendar.className = 'inline-calendar';
        
        // Get default date for this day
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
                <button class="calendar-nav" onclick="event.stopPropagation(); calculator.changeCalendarMonth(${dayIndex}, ${month - 1}, ${year})">&lt;</button>
                <span class="calendar-month-year">${monthNames[month]} ${year}</span>
                <button class="calendar-nav" onclick="event.stopPropagation(); calculator.changeCalendarMonth(${dayIndex}, ${month + 1}, ${year})">&gt;</button>
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
                html += `<div class="${classes.join(' ')}" onclick="event.stopPropagation(); calculator.selectDate(${dayIndex}, ${year}, ${month}, ${day})">${day}</div>`;
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
                <button class="calendar-btn calendar-clear" onclick="event.stopPropagation(); calculator.clearDate(${dayIndex})">Clear</button>
                <button class="calendar-btn calendar-today" onclick="event.stopPropagation(); calculator.selectToday(${dayIndex})">Today</button>
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
            alert(validation.message);
            return;
        }
        
        // Set the date as YYYY-MM-DD format to avoid timezone issues
        this.days[dayIndex].date = this.formatDateForStorage(selectedDate);
        this.hideCalendar();
        this.renderDays();
        this.clearCurrentQuote(); // Mark as new quote when dates change
    }

    clearDate(dayIndex) {
        this.days[dayIndex].date = null;
        this.hideCalendar();
        this.renderDays();
        this.clearCurrentQuote(); // Mark as new quote when dates change
    }

    selectToday(dayIndex) {
        const today = new Date();
        
        // Validate date order
        const validation = this.validateDateOrder(dayIndex, today);
        if (!validation.valid) {
            alert(validation.message);
            return;
        }
        
        this.days[dayIndex].date = this.formatDateForStorage(today);
        this.hideCalendar();
        this.renderDays();
        this.clearCurrentQuote(); // Mark as new quote when dates change
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
        const calendar = this.activeCalendar.element;
        calendar.innerHTML = this.generateCalendarHTML(newDate, dayIndex);
    }

    positionCalendar(calendar, dayCell) {
        const rect = dayCell.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const calendarHeight = 400; // Approximate calendar height
        const calendarWidth = 280; // Calendar width
        
        let top = rect.bottom + 5; // 5px spacing below the day cell
        let left = rect.left;
        
        // Adjust if calendar would go off bottom of screen
        if (top + calendarHeight > viewportHeight) {
            top = rect.top - calendarHeight - 5; // Position above instead
        }
        
        // Adjust if calendar would go off right of screen
        if (left + calendarWidth > viewportWidth) {
            left = viewportWidth - calendarWidth - 10; // 10px margin from edge
        }
        
        // Ensure calendar doesn't go off left of screen
        if (left < 10) {
            left = 10;
        }
        
        calendar.style.top = `${top}px`;
        calendar.style.left = `${left}px`;
    }

    handleCalendarOutsideClick(event) {
        if (this.activeCalendar && !this.activeCalendar.element.contains(event.target)) {
            // Don't close if clicking on day header or calendar navigation
            if (!event.target.classList.contains('day-header') && 
                !event.target.classList.contains('calendar-nav') &&
                !event.target.closest('.inline-calendar')) {
                this.hideCalendar();
            }
        }
    }

    hideCalendar() {
        if (this.activeCalendar) {
            this.activeCalendar.element.remove();
            this.activeCalendar = null;
            document.removeEventListener('click', this.handleCalendarOutsideClick.bind(this));
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