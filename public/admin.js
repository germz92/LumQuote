class AdminPanel {
    constructor() {
        this.services = [];
        this.editingService = null;
        this.draggedElement = null;
        this.draggedService = null;
        this.init();
    }

    async init() {
        // Check authentication status first
        const isAuthenticated = await this.checkAuth();
        if (!isAuthenticated) {
            window.location.href = '/login.html';
            return;
        }
        
        await this.loadServices();
        this.setupEventListeners();
        this.populateDependencyDropdown();
        this.renderServices();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/auth/status');
            const data = await response.json();
            return data.authenticated;
        } catch (error) {
            console.error('Auth check failed:', error);
            return false;
        }
    }

    async loadServices() {
        try {
            const response = await fetch('/api/services');
            if (response.status === 401) {
                // Unauthorized - redirect to login
                window.location.href = '/login.html';
                return;
            }
            if (!response.ok) {
                throw new Error('Failed to load services');
            }
            this.services = await response.json();
        } catch (error) {
            console.error('Error loading services:', error);
            this.services = [];
        }
    }

    setupEventListeners() {
        document.getElementById('service-form').addEventListener('submit', (e) => this.handleFormSubmit(e));
        document.getElementById('cancel-edit').addEventListener('click', () => this.cancelEdit());
        
        // Handle dependency selection
        document.getElementById('service-dependency').addEventListener('change', (e) => {
            const dependencyTypeSelect = document.getElementById('dependency-type');
            const isSubserviceCheckbox = document.getElementById('is-subservice');
            
            if (e.target.value) {
                dependencyTypeSelect.disabled = false;
                dependencyTypeSelect.innerHTML = `
                    <option value="">Select dependency type</option>
                    <option value="same_day">Same Day</option>
                    <option value="same_quote">Same Quote</option>
                `;
                
                // If subservice is checked, auto-select same_day and disable
                if (isSubserviceCheckbox.checked) {
                    dependencyTypeSelect.value = 'same_day';
                    dependencyTypeSelect.disabled = true;
                }
            } else {
                dependencyTypeSelect.disabled = true;
                dependencyTypeSelect.innerHTML = '<option value="">Select dependency first</option>';
                dependencyTypeSelect.value = '';
            }
        });
        
        // Handle subservice checkbox
        document.getElementById('is-subservice').addEventListener('change', (e) => {
            const dependencySelect = document.getElementById('service-dependency');
            const dependencyTypeSelect = document.getElementById('dependency-type');
            
            if (e.target.checked) {
                // If dependency is already selected, auto-set to same_day
                if (dependencySelect.value) {
                    dependencyTypeSelect.value = 'same_day';
                    dependencyTypeSelect.disabled = true;
                } else {
                    // Show helpful message but allow the checkbox to stay checked
                    showAlertModal('Remember to select a dependency service for this subservice before saving.', 'info');
                }
            } else {
                // Re-enable dependency type selection if dependency is selected
                if (dependencySelect.value) {
                    dependencyTypeSelect.disabled = false;
                }
            }
        });
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        const dependsOnValue = document.getElementById('service-dependency').value;
        const isSubservice = document.getElementById('is-subservice').checked;
        
        const formData = {
            name: document.getElementById('service-name').value,
            price: parseFloat(document.getElementById('service-price').value),
            category: document.getElementById('service-category').value,
            description: document.getElementById('service-description').value.trim(),
            isSubservice: isSubservice
        };

        // Validate subservice requirements
        if (isSubservice && !dependsOnValue) {
            showAlertModal('Subservices must have a dependency service selected.', 'error');
            return;
        }

        // Only add dependency fields if a dependency is selected
        if (dependsOnValue) {
            const dependencyTypeValue = document.getElementById('dependency-type').value;
            if (!dependencyTypeValue) {
                showAlertModal('Please select a dependency type when adding a dependency.', 'error');
                return;
            }
            formData.dependsOn = dependsOnValue;
            formData.dependencyType = dependencyTypeValue;
        }

        try {
            let response;
            if (this.editingService) {
                response = await fetch(`/api/services/${this.editingService._id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
            } else {
                response = await fetch('/api/services', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
            }

            if (response.ok) {
                await this.loadServices();
                this.populateDependencyDropdown();
                this.renderServices();
                this.resetForm();
                showAlertModal(this.editingService ? 'Service updated successfully!' : 'Service added successfully!', 'success', null, true);
            } else {
                throw new Error('Failed to save service');
            }
        } catch (error) {
            console.error('Error saving service:', error);
            showAlertModal('Error saving service. Please try again.', 'error');
        }
    }

    async deleteService(serviceId) {
        const confirmed = await showConfirmModal(
            'Are you sure you want to delete this service?',
            'Delete Service',
            'Delete',
            'Cancel'
        );
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`/api/services/${serviceId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await this.loadServices();
                this.populateDependencyDropdown();
                this.renderServices();
                showAlertModal('Service deleted successfully!', 'success', null, true);
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete service');
            }
        } catch (error) {
            console.error('Error deleting service:', error);
            showAlertModal(error.message, 'error');
        }
    }

    editService(service) {
        this.editingService = service;
        
        document.getElementById('service-name').value = service.name;
        document.getElementById('service-price').value = service.price;
        document.getElementById('service-category').value = service.category;
        document.getElementById('service-description').value = service.description || '';
        document.getElementById('is-subservice').checked = service.isSubservice || false;
        
        // Handle dependencies
        if (service.dependsOn) {
            document.getElementById('service-dependency').value = service.dependsOn._id || service.dependsOn;
            const dependencyTypeSelect = document.getElementById('dependency-type');
            dependencyTypeSelect.disabled = false;
            dependencyTypeSelect.innerHTML = `
                <option value="">Select dependency type</option>
                <option value="same_day">Same Day</option>
                <option value="same_quote">Same Quote</option>
            `;
            dependencyTypeSelect.value = service.dependencyType || '';
            
            // If it's a subservice, disable dependency type selection
            if (service.isSubservice) {
                dependencyTypeSelect.disabled = true;
            }
        } else {
            document.getElementById('service-dependency').value = '';
            document.getElementById('dependency-type').disabled = true;
            document.getElementById('dependency-type').innerHTML = '<option value="">Select dependency first</option>';
        }
        
        document.getElementById('form-button-text').textContent = 'Update Service';
        document.getElementById('cancel-edit').style.display = 'inline-block';
        
        document.getElementById('service-name').focus();
    }

    cancelEdit() {
        this.editingService = null;
        this.resetForm();
    }

    resetForm() {
        document.getElementById('service-form').reset();
        document.getElementById('form-button-text').textContent = 'Add Service';
        document.getElementById('cancel-edit').style.display = 'none';
        document.getElementById('dependency-type').disabled = true;
        document.getElementById('dependency-type').innerHTML = '<option value="">Select dependency first</option>';
        document.getElementById('is-subservice').checked = false;
        this.editingService = null;
    }

    populateDependencyDropdown() {
        const dependencySelect = document.getElementById('service-dependency');
        dependencySelect.innerHTML = '<option value="">No dependency</option>';
        
        this.services.forEach(service => {
            // Don't allow a service to depend on itself when editing
            if (!this.editingService || service._id !== this.editingService._id) {
                dependencySelect.innerHTML += `<option value="${service._id}">${service.name}</option>`;
            }
        });
    }

    renderServices() {
        const container = document.getElementById('services-container');
        
        if (this.services.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #64748b;">No services available. Add your first service above.</p>';
            return;
        }

        container.innerHTML = this.services.map(service => {
            let dependencyText = '';
            if (service.dependsOn) {
                const dependencyName = service.dependsOn.name || 'Unknown Service';
                const dependencyTypeText = service.dependencyType === 'same_day' ? 'Same Day' : 'Same Quote';
                dependencyText = `<p><strong>Depends on:</strong> ${dependencyName} (${dependencyTypeText})</p>`;
            }
            
            const isSubservice = service.isSubservice;
            const indentClass = isSubservice ? 'subservice-item' : '';
            
            return `
                <div class="service-item ${indentClass}" 
                     draggable="true" 
                     data-service-id="${service._id}"
                     data-is-subservice="${isSubservice}"
                     data-parent-id="${service.dependsOn?._id || ''}"
                     ondragstart="adminPanel.handleDragStart(event)"
                     ondragover="adminPanel.handleDragOver(event)"
                     ondrop="adminPanel.handleDrop(event)"
                     ondragend="adminPanel.handleDragEnd(event)">
                    <div class="service-info">
                        <div class="service-details">
                            <h4>${isSubservice ? '└─ ' : ''}${service.name}${isSubservice ? ' (Subservice)' : ''}</h4>
                            <p>Category: ${service.category}</p>
                            ${service.description ? `<p><strong>Description:</strong> ${service.description}</p>` : ''}
                            ${dependencyText}
                        </div>
                    </div>
                    <div class="service-price">${service.price.toLocaleString('en-US', { 
                    style: 'currency', 
                    currency: 'USD',
                    minimumFractionDigits: service.price % 1 !== 0 ? 2 : 0,
                    maximumFractionDigits: 2
                })}</div>
                    <div class="service-actions">
                        <button class="edit-btn" onclick="adminPanel.editService(${JSON.stringify(service).replace(/"/g, '&quot;')})">
                            Edit
                        </button>
                        <button class="delete-btn" onclick="adminPanel.deleteService('${service._id}')">
                            Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }



    // Drag and Drop Methods
    handleDragStart(event) {
        this.draggedElement = event.target;
        this.draggedService = this.services.find(s => s._id === event.target.dataset.serviceId);
        
        event.target.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        
        // Set drag data
        event.dataTransfer.setData('text/plain', event.target.dataset.serviceId);
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        
        const targetElement = event.currentTarget;
        const targetServiceId = targetElement.dataset.serviceId;
        
        if (!this.draggedService || targetServiceId === this.draggedService._id) {
            return;
        }
        
        // Check if this is a valid drop target
        if (this.isValidDropTarget(targetElement)) {
            const rect = targetElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            // Clear previous drop indicators
            document.querySelectorAll('.service-item').forEach(el => {
                el.classList.remove('drag-over', 'drag-over-bottom');
            });
            
            // Add appropriate drop indicator
            if (event.clientY < midpoint) {
                targetElement.classList.add('drag-over');
            } else {
                targetElement.classList.add('drag-over-bottom');
            }
        }
    }

    handleDrop(event) {
        event.preventDefault();
        
        const targetElement = event.currentTarget;
        const targetServiceId = targetElement.dataset.serviceId;
        
        if (!this.draggedService || !this.isValidDropTarget(targetElement)) {
            this.clearDragStyles();
            return;
        }
        
        const targetService = this.services.find(s => s._id === targetServiceId);
        if (!targetService) {
            this.clearDragStyles();
            return;
        }
        
        // Calculate new position
        const rect = targetElement.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertAfter = event.clientY >= midpoint;
        
        this.reorderServices(this.draggedService, targetService, insertAfter);
        this.clearDragStyles();
    }

    handleDragEnd(event) {
        this.clearDragStyles();
        this.draggedElement = null;
        this.draggedService = null;
    }

    isValidDropTarget(targetElement) {
        const draggedIsSubservice = this.draggedService.isSubservice;
        const draggedParentId = this.draggedService.dependsOn?._id;
        
        const targetIsSubservice = targetElement.dataset.isSubservice === 'true';
        const targetParentId = targetElement.dataset.parentId;
        
        if (draggedIsSubservice) {
            // Subservices can only be reordered within their parent's group
            if (targetIsSubservice) {
                // Both are subservices - must have same parent
                return draggedParentId === targetParentId;
            } else {
                // Target is parent service - only valid if it's the subservice's parent
                return draggedParentId === targetElement.dataset.serviceId;
            }
        } else {
            // Parent services can be reordered with other parent services only
            return !targetIsSubservice;
        }
    }

    async reorderServices(draggedService, targetService, insertAfter) {
        try {
            // Create a copy of services array for manipulation
            const newOrder = [...this.services];
            
            // Remove dragged service from current position
            const draggedIndex = newOrder.findIndex(s => s._id === draggedService._id);
            newOrder.splice(draggedIndex, 1);
            
            // If dragging a parent service, also move its subservices
            let subservicesToMove = [];
            if (!draggedService.isSubservice) {
                subservicesToMove = newOrder.filter(s => s.isSubservice && s.dependsOn?._id === draggedService._id);
                // Remove subservices from their current positions
                subservicesToMove.forEach(sub => {
                    const subIndex = newOrder.findIndex(s => s._id === sub._id);
                    if (subIndex > -1) {
                        newOrder.splice(subIndex, 1);
                    }
                });
            }
            
            // Find new insertion point
            let targetIndex = newOrder.findIndex(s => s._id === targetService._id);
            if (insertAfter) {
                targetIndex++;
                // If target is a parent service and we're inserting after, skip its subservices
                if (!targetService.isSubservice) {
                    while (targetIndex < newOrder.length && 
                           newOrder[targetIndex].isSubservice && 
                           newOrder[targetIndex].dependsOn?._id === targetService._id) {
                        targetIndex++;
                    }
                }
            }
            
            // Insert dragged service and its subservices
            newOrder.splice(targetIndex, 0, draggedService);
            if (subservicesToMove.length > 0) {
                newOrder.splice(targetIndex + 1, 0, ...subservicesToMove);
            }
            
            // Create service updates with new sortOrder
            const serviceUpdates = newOrder.map((service, index) => ({
                id: service._id,
                sortOrder: index + 1
            }));
            
            // Send update to server
            const response = await fetch('/api/services/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serviceUpdates })
            });
            
            if (response.ok) {
                // Reload services to get updated order
                await this.loadServices();
                this.renderServices();
                showAlertModal('Services reordered successfully!', 'success', null, true);
            } else {
                throw new Error('Failed to update service order');
            }
            
        } catch (error) {
            console.error('Error reordering services:', error);
            showAlertModal('Error reordering services. Please try again.', 'error');
        }
    }

    clearDragStyles() {
        document.querySelectorAll('.service-item').forEach(el => {
            el.classList.remove('dragging', 'drag-over', 'drag-over-bottom');
        });
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize admin panel when page loads
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new AdminPanel();
});

// Custom Modal System (shared with main script)
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

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST'
        });
        
        if (response.ok) {
            window.location.href = '/';
        } else {
            console.error('Logout failed');
            // Force redirect anyway
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Logout error:', error);
        // Force redirect anyway
        window.location.href = '/';
    }
}