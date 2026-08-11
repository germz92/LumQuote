class AdminPanel {
    constructor() {
        this.services = [];
        this.editingService = null;
        this.draggedElement = null;
        this.draggedService = null;
        this.isServiceDragging = false;
        this.dropTargetElement = null;
        this.dropInsertAfter = false;
        this.init();
    }

    async init() {
        try {
            await this.loadServices();
            this.setupEventListeners();
            this.populateDependencyDropdown();
            this.renderServices();
        } catch (error) {
            console.error('Admin services init failed:', error);
            const container = document.getElementById('services-container');
            if (container) {
                container.innerHTML = '<p style="text-align: center; color: #df1b41;">Could not load services. Refresh the page and try again.</p>';
            }
        }
    }

    async loadServices() {
        try {
            const data = window.CRM
                ? await CRM.api('/api/services')
                : await fetch('/api/services', { credentials: 'include' }).then(async (response) => {
                    const json = await response.json();
                    if (!response.ok) throw new Error(json.error || 'Failed to load services');
                    return json;
                });
            this.services = Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('Error loading services:', error);
            this.services = [];
            if (typeof showAlertModal === 'function') {
                showAlertModal(error.message || 'Failed to load services.', 'error');
            }
        }
    }

    setupEventListeners() {
        document.getElementById('service-form').addEventListener('submit', (e) => this.handleFormSubmit(e));
        document.getElementById('cancel-edit').addEventListener('click', () => this.closeServiceModal());

        const modal = document.getElementById('serviceModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeServiceModal();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal?.style.display === 'flex') {
                this.closeServiceModal();
            }
        });

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
            const previousValue = dependencySelect.value;

            // Rebuild parent list: subservices may only attach to main services
            this.populateDependencyDropdown();
            if (previousValue && [...dependencySelect.options].some((o) => o.value === previousValue)) {
                dependencySelect.value = previousValue;
            } else if (e.target.checked) {
                dependencySelect.value = '';
            }

            if (e.target.checked) {
                if (dependencySelect.value) {
                    dependencyTypeSelect.disabled = false;
                    dependencyTypeSelect.innerHTML = `
                        <option value="">Select dependency type</option>
                        <option value="same_day">Same Day</option>
                        <option value="same_quote">Same Quote</option>
                    `;
                    dependencyTypeSelect.value = 'same_day';
                    dependencyTypeSelect.disabled = true;
                } else {
                    showAlertModal('Select a main parent service in Parent / Dependency for this subservice.', 'info');
                }
            } else if (dependencySelect.value) {
                dependencyTypeSelect.disabled = false;
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
            isSubservice: isSubservice,
            dependsOn: null,
            dependencyType: null
        };

        if (isSubservice && !dependsOnValue) {
            showAlertModal('Subservices must have a parent service selected.', 'error');
            return;
        }

        if (dependsOnValue) {
            const parent = this.findServiceById(dependsOnValue);
            if (isSubservice && parent?.isSubservice) {
                showAlertModal('A subservice must attach to a main parent service, not another subservice.', 'error');
                return;
            }
            const dependencyTypeValue = isSubservice
                ? 'same_day'
                : document.getElementById('dependency-type').value;
            if (!dependencyTypeValue) {
                showAlertModal('Please select a dependency type when adding a dependency.', 'error');
                return;
            }
            formData.dependsOn = dependsOnValue;
            formData.dependencyType = dependencyTypeValue;
        }

        try {
            if (this.editingService) {
                if (window.CRM?.api) {
                    await CRM.api(`/api/services/${this.editingService._id}`, { method: 'PUT', body: formData });
                } else {
                    const response = await fetch(`/api/services/${this.editingService._id}`, {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    });
                    if (!response.ok) throw new Error('Failed to save service');
                }
            } else if (window.CRM?.api) {
                await CRM.api('/api/services', { method: 'POST', body: formData });
            } else {
                const response = await fetch('/api/services', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                if (!response.ok) throw new Error('Failed to save service');
            }

            const wasEditing = !!this.editingService;
            await this.loadServices();
            this.populateDependencyDropdown();
            this.renderServices();
            this.closeServiceModal();
            showAlertModal(wasEditing ? 'Service updated successfully!' : 'Service added successfully!', 'success', null, true);
        } catch (error) {
            console.error('Error saving service:', error);
            showAlertModal(error.message || 'Error saving service. Please try again.', 'error');
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

    openAddServiceModal() {
        this.editingService = null;
        this.resetForm();
        this.populateDependencyDropdown();
        document.getElementById('serviceModalTitle').textContent = 'Add Service';
        document.getElementById('form-button-text').textContent = 'Add Service';
        this.showServiceModal();
    }

    showServiceModal() {
        const modal = document.getElementById('serviceModal');
        if (!modal) return;
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('service-name')?.focus(), 50);
    }

    closeServiceModal() {
        const modal = document.getElementById('serviceModal');
        if (modal) modal.style.display = 'none';
        this.resetForm();
    }

    editService(service) {
        this.editingService = service;
        this.populateDependencyDropdown();

        document.getElementById('service-name').value = service.name;
        document.getElementById('service-price').value = service.price;
        document.getElementById('service-category').value = service.category;
        document.getElementById('service-description').value = service.description || '';
        document.getElementById('is-subservice').checked = service.isSubservice || false;

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
            if (service.isSubservice) {
                dependencyTypeSelect.disabled = true;
            }
        } else {
            document.getElementById('service-dependency').value = '';
            document.getElementById('dependency-type').disabled = true;
            document.getElementById('dependency-type').innerHTML = '<option value="">Select dependency first</option>';
        }

        document.getElementById('serviceModalTitle').textContent = 'Edit Service';
        document.getElementById('form-button-text').textContent = 'Update Service';
        this.showServiceModal();
    }

    resetForm() {
        document.getElementById('service-form')?.reset();
        document.getElementById('form-button-text').textContent = 'Add Service';
        document.getElementById('serviceModalTitle').textContent = 'Add Service';
        const dependencyType = document.getElementById('dependency-type');
        if (dependencyType) {
            dependencyType.disabled = true;
            dependencyType.innerHTML = '<option value="">Select dependency first</option>';
        }
        const isSubservice = document.getElementById('is-subservice');
        if (isSubservice) isSubservice.checked = false;
        this.editingService = null;
    }

    populateDependencyDropdown() {
        const dependencySelect = document.getElementById('service-dependency');
        if (!dependencySelect) return;
        const isSubservice = !!document.getElementById('is-subservice')?.checked;
        dependencySelect.innerHTML = isSubservice
            ? '<option value="">Select parent service...</option>'
            : '<option value="">No dependency</option>';

        const editingId = this.editingService ? this.serviceId(this.editingService._id) : '';
        (Array.isArray(this.services) ? this.services : []).forEach((service) => {
            if (editingId && this.serviceId(service._id) === editingId) return;
            // Subservices can only attach under main services
            if (isSubservice && service.isSubservice) return;
            const opt = document.createElement('option');
            opt.value = service._id;
            opt.textContent = service.name;
            dependencySelect.appendChild(opt);
        });
    }

    editServiceById(serviceId) {
        const service = (Array.isArray(this.services) ? this.services : [])
            .find((s) => String(s._id) === String(serviceId));
        if (!service) {
            showAlertModal('Service not found. Refresh and try again.', 'error');
            return;
        }
        this.editService(service);
    }

    renderServices() {
        const container = document.getElementById('services-container');
        if (!container) return;

        const services = Array.isArray(this.services) ? this.services : [];
        if (services.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #64748b;">No services available. Add your first service above.</p>';
            return;
        }

        container.innerHTML = services.map((service) => {
            let dependencyText = '';
            if (service.dependsOn) {
                const dependencyName = service.dependsOn.name || 'Unknown Service';
                const dependencyTypeText = service.dependencyType === 'same_day' ? 'Same Day' : 'Same Quote';
                dependencyText = `<p><strong>Depends on:</strong> ${this.escapeHtml(dependencyName)} (${dependencyTypeText})</p>`;
            }

            const isSubservice = !!service.isSubservice;
            const parentId = service.dependsOn?._id || service.dependsOn || '';
            const parentService = parentId ? this.findServiceById(parentId) : null;
            const hasInvalidParent = isSubservice && (!parentService || parentService.isSubservice);
            const indentClass = [
                isSubservice ? 'subservice-item' : '',
                hasInvalidParent ? 'service-item-orphan' : ''
            ].filter(Boolean).join(' ');
            const price = Number(service.price) || 0;

            return `
                <div class="service-item ${indentClass}"
                     data-service-id="${this.escapeHtml(String(service._id))}"
                     data-is-subservice="${isSubservice}"
                     data-parent-id="${this.escapeHtml(String(parentId))}">
                    <button type="button" class="service-drag-handle" title="Drag to reorder or onto a parent" aria-label="Drag to reorder">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="9" cy="7" r="1.5"></circle><circle cx="15" cy="7" r="1.5"></circle>
                            <circle cx="9" cy="12" r="1.5"></circle><circle cx="15" cy="12" r="1.5"></circle>
                            <circle cx="9" cy="17" r="1.5"></circle><circle cx="15" cy="17" r="1.5"></circle>
                        </svg>
                    </button>
                    <div class="service-info">
                        <div class="service-details">
                            <h4>${isSubservice ? '└─ ' : ''}${this.escapeHtml(service.name)}${isSubservice ? ' (Subservice)' : ''}</h4>
                            <p>Category: ${this.escapeHtml(service.category || '')}</p>
                            ${service.description ? `<p><strong>Description:</strong> ${this.escapeHtml(service.description)}</p>` : ''}
                            ${dependencyText}
                            ${hasInvalidParent ? '<p class="service-orphan-note"><strong>Needs parent:</strong> Edit or drag onto a main service to attach it.</p>' : ''}
                        </div>
                    </div>
                    <div class="service-price">${price.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: price % 1 !== 0 ? 2 : 0,
                        maximumFractionDigits: 2
                    })}</div>
                    <div class="service-actions">
                        <button type="button" class="edit-btn" onclick="adminPanel.editServiceById('${this.escapeHtml(String(service._id))}')">
                            Edit
                        </button>
                        <button type="button" class="delete-btn" onclick="adminPanel.deleteService('${this.escapeHtml(String(service._id))}')">
                            Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.bindServiceDragHandlers();
    }

    serviceId(value) {
        if (value == null) return '';
        if (typeof value === 'object' && value._id != null) return String(value._id);
        return String(value);
    }

    findServiceById(id) {
        const needle = this.serviceId(id);
        return (Array.isArray(this.services) ? this.services : [])
            .find((s) => this.serviceId(s._id) === needle);
    }

    bindServiceDragHandlers() {
        const container = document.getElementById('services-container');
        if (!container) return;

        container.querySelectorAll('.service-item').forEach((item) => {
            const handle = item.querySelector('.service-drag-handle');
            if (!handle) return;
            handle.addEventListener('pointerdown', (event) => this.onServicePointerDown(event, item));
        });
    }

    onServicePointerDown(event, item) {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();

        this.draggedElement = item;
        this.draggedService = this.findServiceById(item.dataset.serviceId);
        this.dropTargetElement = null;
        this.dropInsertAfter = false;
        if (!this.draggedService) return;

        this.isServiceDragging = true;
        item.classList.add('dragging');
        document.body.classList.add('is-service-reordering');

        this._onServicePointerMove = (e) => this.onServicePointerMove(e);
        this._onServicePointerUp = (e) => this.onServicePointerUp(e);
        this._onServiceKeyDown = (e) => {
            if (e.key === 'Escape') this.cancelServiceDrag();
        };

        document.addEventListener('pointermove', this._onServicePointerMove);
        document.addEventListener('pointerup', this._onServicePointerUp);
        document.addEventListener('pointercancel', this._onServicePointerUp);
        document.addEventListener('keydown', this._onServiceKeyDown);

        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // ignore capture failures
        }
    }

    onServicePointerMove(event) {
        if (!this.isServiceDragging || !this.draggedService) return;

        const el = document.elementFromPoint(event.clientX, event.clientY);
        const targetElement = el?.closest?.('.service-item');

        document.querySelectorAll('.service-item').forEach((node) => {
            node.classList.remove('drag-over', 'drag-over-bottom');
        });

        this.dropTargetElement = null;
        this.dropInsertAfter = false;

        if (!targetElement || targetElement === this.draggedElement) return;
        if (!this.isValidDropTarget(targetElement)) return;

        const rect = targetElement.getBoundingClientRect();
        const insertAfter = event.clientY >= rect.top + rect.height / 2;
        targetElement.classList.add(insertAfter ? 'drag-over-bottom' : 'drag-over');
        this.dropTargetElement = targetElement;
        this.dropInsertAfter = insertAfter;
    }

    onServicePointerUp() {
        if (!this.isServiceDragging) return;

        const draggedService = this.draggedService;
        const targetElement = this.dropTargetElement;
        const insertAfter = this.dropInsertAfter;
        const targetService = targetElement
            ? this.findServiceById(targetElement.dataset.serviceId)
            : null;

        this.endServiceDrag();

        if (draggedService && targetService) {
            this.reorderOrReparentService(draggedService, targetService, insertAfter);
        }
    }

    cancelServiceDrag() {
        this.endServiceDrag();
    }

    endServiceDrag() {
        this.isServiceDragging = false;
        document.body.classList.remove('is-service-reordering');
        if (this._onServicePointerMove) {
            document.removeEventListener('pointermove', this._onServicePointerMove);
            this._onServicePointerMove = null;
        }
        if (this._onServicePointerUp) {
            document.removeEventListener('pointerup', this._onServicePointerUp);
            document.removeEventListener('pointercancel', this._onServicePointerUp);
            this._onServicePointerUp = null;
        }
        if (this._onServiceKeyDown) {
            document.removeEventListener('keydown', this._onServiceKeyDown);
            this._onServiceKeyDown = null;
        }
        this.clearDragStyles();
        this.draggedElement = null;
        this.draggedService = null;
        this.dropTargetElement = null;
        this.dropInsertAfter = false;
    }

    isValidDropTarget(targetElement) {
        if (!this.draggedService || !targetElement) return false;

        const draggedIsSubservice = !!this.draggedService.isSubservice;
        const draggedParentId = this.serviceId(this.draggedService.dependsOn);

        const targetIsSubservice = targetElement.dataset.isSubservice === 'true';
        const targetParentId = this.serviceId(targetElement.dataset.parentId);

        if (draggedIsSubservice) {
            if (targetIsSubservice) {
                // Reorder within the same parent group only
                return !!draggedParentId && draggedParentId === targetParentId;
            }
            // Dropping on any main service reorders under it (and reparents if different)
            return true;
        }

        return !targetIsSubservice;
    }

    async reorderOrReparentService(draggedService, targetService, insertAfter) {
        try {
            let workingDragged = draggedService;
            const draggedId = this.serviceId(draggedService._id);

            // Subservice dropped on a different main parent → reattach first
            if (draggedService.isSubservice && !targetService.isSubservice) {
                const newParentId = this.serviceId(targetService._id);
                const oldParentId = this.serviceId(draggedService.dependsOn);
                if (newParentId && newParentId !== oldParentId) {
                    const body = {
                        dependsOn: newParentId,
                        dependencyType: draggedService.dependencyType || 'same_day',
                        isSubservice: true
                    };
                    if (window.CRM?.api) {
                        await CRM.api(`/api/services/${draggedId}`, { method: 'PUT', body });
                    } else {
                        const response = await fetch(`/api/services/${draggedId}`, {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        if (!response.ok) throw new Error('Failed to update parent');
                    }
                    workingDragged = {
                        ...draggedService,
                        dependsOn: { _id: newParentId, name: targetService.name },
                        isSubservice: true
                    };
                    // Keep local list in sync before reorder math
                    const local = this.findServiceById(draggedId);
                    if (local) {
                        local.dependsOn = workingDragged.dependsOn;
                        local.isSubservice = true;
                    }
                }
            }

            await this.reorderServices(workingDragged, targetService, insertAfter);
        } catch (error) {
            console.error('Error moving service:', error);
            showAlertModal(error.message || 'Error moving service. Please try again.', 'error');
            await this.loadServices();
            this.renderServices();
        }
    }

    async reorderServices(draggedService, targetService, insertAfter) {
        try {
            const newOrder = [...this.services];
            const draggedId = this.serviceId(draggedService._id);
            const targetId = this.serviceId(targetService._id);

            const draggedIndex = newOrder.findIndex((s) => this.serviceId(s._id) === draggedId);
            if (draggedIndex < 0) return;
            newOrder.splice(draggedIndex, 1);

            let subservicesToMove = [];
            if (!draggedService.isSubservice) {
                subservicesToMove = newOrder.filter((s) =>
                    s.isSubservice && this.serviceId(s.dependsOn) === draggedId
                );
                subservicesToMove.forEach((sub) => {
                    const subIndex = newOrder.findIndex((s) => this.serviceId(s._id) === this.serviceId(sub._id));
                    if (subIndex > -1) newOrder.splice(subIndex, 1);
                });
            }

            let targetIndex = newOrder.findIndex((s) => this.serviceId(s._id) === targetId);
            if (targetIndex < 0) targetIndex = newOrder.length;
            if (insertAfter) {
                targetIndex++;
                if (!targetService.isSubservice) {
                    while (
                        targetIndex < newOrder.length &&
                        newOrder[targetIndex].isSubservice &&
                        this.serviceId(newOrder[targetIndex].dependsOn) === targetId
                    ) {
                        targetIndex++;
                    }
                }
            }

            newOrder.splice(targetIndex, 0, draggedService);
            if (subservicesToMove.length > 0) {
                newOrder.splice(targetIndex + 1, 0, ...subservicesToMove);
            }

            const serviceUpdates = newOrder.map((service, index) => ({
                id: this.serviceId(service._id),
                sortOrder: index + 1
            }));

            if (window.CRM?.api) {
                await CRM.api('/api/services/reorder', {
                    method: 'POST',
                    body: { serviceUpdates }
                });
            } else {
                const response = await fetch('/api/services/reorder', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serviceUpdates })
                });
                if (!response.ok) throw new Error('Failed to update service order');
            }

            await this.loadServices();
            this.populateDependencyDropdown();
            this.renderServices();
            showAlertModal('Services updated successfully!', 'success', null, true);
        } catch (error) {
            console.error('Error reordering services:', error);
            showAlertModal(error.message || 'Error reordering services. Please try again.', 'error');
        }
    }

    clearDragStyles() {
        document.querySelectorAll('.service-item').forEach((el) => {
            el.classList.remove('dragging', 'drag-over', 'drag-over-bottom');
        });
        document.body.classList.remove('is-service-reordering');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

// Initialize admin panel when page loads (window so inline onclick handlers can reach it)
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
});
