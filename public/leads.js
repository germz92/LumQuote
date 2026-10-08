class LeadsManager {
    constructor() {
        this.leads = [];
        this.users = [];
        this.assigneeCounts = {};
        this.selected = new Set();
        this.anchorId = null;
        this.assigneeId = null;
        this.assignMode = false;
        this.hiddenAssigneeIds = new Set();
        this.me = null;
        this.sortColumn = 'created';
        this.sortDirection = 'desc';
        this.searchDebounceTimer = null;
        this.init();
    }

    async init() {
        try {
            await this.loadMe();
            const tasks = [this.loadLeads()];
            if (this.isAdmin()) tasks.push(this.loadUsers(), this.loadAssigneeCounts());
            await Promise.all(tasks);
            await this.markLeadsSeen();
            this.render();
            this.renderAssignees();
            this.updateSortIndicators();
        } catch (error) {
            showAlertModal(error.message || 'Failed to load leads.', 'error');
        }
    }

    async loadMe() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            const data = await response.json();
            this.me = data.user || null;
            const hidden = Array.isArray(this.me?.leadAssignHiddenUserIds) ? this.me.leadAssignHiddenUserIds : [];
            this.hiddenAssigneeIds = new Set(hidden.map(String));
        } catch (error) {
            this.me = null;
        }
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/shareable-users', { credentials: 'include' });
            if (!response.ok) return;
            this.users = await response.json();
        } catch (error) {
            this.users = [];
        }
    }

    async loadLeads() {
        const params = new URLSearchParams();
        const search = document.getElementById('searchLeads')?.value.trim();
        const status = document.getElementById('statusFilter')?.value;
        if (search) params.set('search', search);
        if (status) params.set('status', status);
        if (this.isAdmin() && this.assigneeId) params.set('assignee', this.assigneeId);
        params.set('sortBy', this.sortColumn);
        params.set('sortDir', this.sortDirection);
        const response = await fetch(`/api/leads?${params.toString()}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load leads');
        this.leads = data.leads || [];
    }

    async loadAssigneeCounts() {
        const status = document.getElementById('assigneeCountFilter')?.value || 'pending';
        const response = await fetch(`/api/leads/assignee-counts?status=${encodeURIComponent(status)}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to count assigned leads');
        this.assigneeCounts = {};
        (data.counts || []).forEach((row) => {
            this.assigneeCounts[String(row.userId)] = row.count;
        });
    }

    debouncedSearch() {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => this.applyFilters(), 300);
    }

    applyFilters() {
        this.updateClearButton();
        this.loadLeads().then(() => {
            this.render();
            this.updateSortIndicators();
        }).catch((error) => {
            showAlertModal(error.message || 'Failed to load leads.', 'error');
        });
    }

    clearFilters() {
        document.getElementById('searchLeads').value = '';
        document.getElementById('statusFilter').value = 'pending';
        this.assigneeId = null;
        this.selected.clear();
        this.applyFilters();
        this.renderAssignees();
    }

    updateClearButton() {
        const status = document.getElementById('statusFilter')?.value || '';
        const active = !!(document.getElementById('searchLeads')?.value.trim() || (status && status !== 'pending') || this.assigneeId);
        const btn = document.getElementById('clearFiltersBtn');
        if (btn) btn.style.display = active ? '' : 'none';
    }

    sortByColumn(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = column === 'created' ? 'desc' : 'asc';
        }
        this.applyFilters();
    }

    updateSortIndicators() {
        document.querySelectorAll('.leads-table .sort-indicator').forEach((el) => {
            el.textContent = el.dataset.sort === this.sortColumn
                ? (this.sortDirection === 'asc' ? ' ▲' : ' ▼')
                : '';
        });
    }

    isAdmin() {
        return this.me?.role === 'admin';
    }

    async openCreateModal() {
        document.getElementById('createLeadForm')?.reset();
        window.LeadSources?.populateLeadSourceSelect();
        window.handleLeadSourceChange?.();
        const box = document.getElementById('newLeadServices');
        if (box) {
            box.innerHTML = '<p class="crm-inline-note">Loading services…</p>';
            try {
                const response = await fetch('/api/public/lead-form', { credentials: 'include' });
                const data = await response.json();
                const services = Array.isArray(data.services) ? data.services : [];
                box.innerHTML = services.map((service) => `
                    <label class="lead-service-check">
                        <input type="checkbox" name="newLeadService" value="${CRM.escapeHtml(service)}">
                        <span>${CRM.escapeHtml(service)}</span>
                    </label>
                `).join('') || '<p class="crm-inline-note">No services are configured.</p>';
            } catch (error) {
                box.innerHTML = '<p class="crm-inline-note">Could not load services.</p>';
            }
        }
        document.getElementById('createLeadModal').style.display = 'flex';
        setTimeout(() => document.getElementById('newLeadName')?.focus(), 50);
    }

    closeCreateModal() {
        const modal = document.getElementById('createLeadModal');
        if (modal) modal.style.display = 'none';
    }

    async createLead(event) {
        event.preventDefault();
        const leadSourceError = window.LeadSources ? LeadSources.validateLeadSourceForm() : 'Choose how they heard about you.';
        if (leadSourceError) {
            showAlertModal(leadSourceError, 'error');
            return;
        }
        const services = [...document.querySelectorAll('input[name="newLeadService"]:checked')].map((input) => input.value);
        if (!services.length) {
            showAlertModal('Select at least one service.', 'error');
            return;
        }
        try {
            const response = await fetch('/api/leads', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('newLeadName').value.trim(),
                    email: document.getElementById('newLeadEmail').value.trim(),
                    phone: document.getElementById('newLeadPhone').value.trim(),
                    message: document.getElementById('newLeadMessage').value.trim(),
                    services,
                    leadSource: LeadSources.getLeadSourceFromForm()
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to create lead');
            this.closeCreateModal();
            await this.loadLeads();
            this.render();
            if (this.isAdmin()) this.refreshAssigneeCounts();
            window.AppShell?.refreshUnseenLeads?.();
            showToast?.('Lead created', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to create lead.', 'error');
        }
    }

    async markLeadsSeen() {
        try {
            await fetch('/api/leads/seen', { method: 'POST', credentials: 'include' });
            window.AppShell?.refreshUnseenLeads?.();
        } catch (error) {
            // The list still loads if the seen marker cannot be saved.
        }
    }

    statusSelect(lead) {
        const labels = { lead: 'Lead', assigned: 'Assigned', quoted: 'Quoted', converted: 'Converted', stale: 'Stale', not_converted: 'Not Converted', archived: 'Archived' };
        const status = lead.status || 'lead';
        const options = Object.entries(labels).map(([value, label]) =>
            `<option value="${value}" ${value === status ? 'selected' : ''}>${CRM.escapeHtml(label)}</option>`
        ).join('');
        return `<select class="crm-status-select crm-chip--${CRM.escapeHtml(status)}" onclick="event.stopPropagation()" onchange="leadsManager.changeStatus('${CRM.escapeJs(String(lead._id))}', this.value)">${options}</select>`;
    }

    render() {
        const body = document.getElementById('leadsTableBody');
        const empty = document.getElementById('leadsEmpty');
        const hint = document.getElementById('leadAssignHint');
        const assignBtn = document.getElementById('assignModeBtn');
        if (assignBtn) {
            assignBtn.hidden = !this.isAdmin();
            assignBtn.classList.toggle('is-active', this.assignMode);
            assignBtn.setAttribute('aria-pressed', this.assignMode ? 'true' : 'false');
        }
        if (hint) {
            hint.style.display = this.isAdmin() ? '' : 'none';
            const count = this.assignMode ? this.selected.size : 0;
            hint.textContent = !this.assignMode
                ? 'Turn on Assign mode to select leads and drag them onto a name.'
                : (count
                    ? `${count} selected. Drag the rows onto a name.`
                    : 'Click a lead to select it. Shift-click selects a range, Ctrl-click adds or removes. Drag the rows onto a name. Double-click opens a lead.');
        }
        document.querySelector('.leads-table')?.classList.toggle('is-admin-leads', this.isAdmin());
        document.querySelector('.leads-table')?.classList.toggle('is-assign-mode', this.isAdmin() && this.assignMode);
        const board = document.querySelector('.lead-assign-board');
        if (board) board.hidden = !this.isAdmin();
        document.querySelector('.leads-workspace')?.classList.toggle('is-personal', !this.isAdmin());
        this.renderAssigneeView();
        if (!this.leads.length) {
            body.innerHTML = '';
            empty.style.display = '';
            const title = empty.querySelector('h3');
            const copy = empty.querySelector('p');
            if (!this.isAdmin()) {
                if (title) title.textContent = 'No leads assigned to you';
                if (copy) copy.textContent = 'Leads an admin assigns to you will show up here.';
            } else if (this.assigneeId) {
                if (title) title.textContent = 'No leads for this person';
                if (copy) copy.textContent = 'Try another count filter, or drag leads here from the full list.';
            } else {
                if (title) title.textContent = 'No leads yet';
                if (copy) copy.textContent = 'Inquiries from the website form will show up here.';
            }
            return;
        }
        empty.style.display = 'none';
        body.innerHTML = this.leads.map((lead) => {
            const id = CRM.escapeJs(String(lead._id));
            const menu = this.isAdmin()
                ? `<div class="quote-overflow-menu table-overflow-menu">
                    <button type="button" class="quote-overflow-btn" onclick="leadsManager.toggleRowMenu(event)" aria-label="Lead actions" aria-haspopup="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="12" cy="5" r="1"></circle>
                            <circle cx="12" cy="19" r="1"></circle>
                        </svg>
                    </button>
                    <div class="quote-overflow-dropdown list-overflow-dropdown" style="display: none;">
                        <button type="button" class="overflow-menu-item danger" onclick="event.stopPropagation(); leadsManager.closeRowMenus(); leadsManager.deleteLead('${id}', '${CRM.escapeJs(lead.name)}')">Delete</button>
                    </div>
                   </div>`
                : '';
            const action = !this.isAdmin()
                ? ''
                : `${lead.assignedTo
                    ? `<button type="button" class="crm-btn-sm" onclick="event.stopPropagation(); leadsManager.unassign('${id}')">Unassign</button>`
                    : `<button type="button" class="crm-btn-sm primary" onclick="event.stopPropagation(); leadsManager.claim('${id}')">Claim</button>`}
                   ${menu}`;
            const rowClass = [
                lead.assignedTo ? 'is-assigned' : '',
                this.assignMode && this.selected.has(String(lead._id)) ? 'is-selected' : ''
            ].filter(Boolean).join(' ');
            const dragAttrs = this.isAdmin() && this.assignMode
                ? `draggable="true" ondragstart="leadsManager.startDrag(event, '${id}')" ondragend="leadsManager.endDrag()"`
                : '';
            return `<tr class="${rowClass}" data-lead-id="${id}" ${dragAttrs} onclick="leadsManager.onRowClick(event, '${id}')" ondblclick="leadsManager.onRowDoubleClick(event, '${id}')">
                <td>${CRM.escapeHtml(lead.name)}</td>
                <td class="col-fold-sm">${CRM.escapeHtml(lead.email)}</td>
                <td class="col-hide-sm col-fold-sm">${CRM.escapeHtml(lead.phone)}</td>
                <td class="col-fold-sm">${CRM.escapeHtml((lead.services || []).join(', '))}</td>
                <td>${CRM.escapeHtml(CRM.formatDate(lead.createdAt) || '')}</td>
                <td onclick="event.stopPropagation()">${this.statusSelect(lead)}</td>
                <td class="col-fold-sm">${CRM.escapeHtml(lead.assignedTo?.name || '—')}</td>
                <td class="actions-cell" onclick="event.stopPropagation()"><div class="actions-cell-inner">${action}</div></td>
            </tr>`;
        }).join('');
    }

    renderAssignees() {
        const board = document.getElementById('leadAssignBoard');
        if (!board || !this.isAdmin()) return;
        if (!this.users.length) {
            board.innerHTML = '<p class="lead-assign-hint">No users yet.</p>';
            return;
        }
        const visible = this.users.filter((user) => !this.hiddenAssigneeIds.has(String(user._id)));
        const filterBtn = document.getElementById('assignNameFilterBtn');
        if (filterBtn) filterBtn.classList.toggle('is-active', this.hiddenAssigneeIds.size > 0);
        if (!visible.length) {
            board.innerHTML = '<p class="lead-assign-hint">No names match this filter.</p>';
            return;
        }
        board.innerHTML = visible.map((user) => {
            const id = CRM.escapeJs(String(user._id));
            const count = this.assigneeCounts[String(user._id)] || 0;
            const viewing = this.assigneeId && String(this.assigneeId) === String(user._id);
            return `<div class="lead-assignee${viewing ? ' is-viewing' : ''}" ondragover="leadsManager.dragOverAssignee(event)" ondragleave="leadsManager.dragLeaveAssignee(event)" ondrop="leadsManager.dropOnAssignee(event, '${id}')">
                <button type="button" class="lead-assignee-name" onclick="leadsManager.openAssignee('${id}')">${CRM.escapeHtml(user.name)}</button>
                <span class="lead-assignee-count">${count}</span>
            </div>`;
        }).join('');
    }

    toggleNameFilter(event) {
        event.stopPropagation();
        const panel = document.getElementById('assignNameFilter');
        const button = document.getElementById('assignNameFilterBtn');
        if (!panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            const search = document.getElementById('assignNameFilterSearch');
            if (search) search.value = '';
            this.renderNameFilterList();
            search?.focus();
            this.bindNameFilterDismiss();
        }
    }

    bindNameFilterDismiss() {
        if (this.nameFilterDismiss) return;
        this.nameFilterDismiss = (event) => {
            const panel = document.getElementById('assignNameFilter');
            const button = document.getElementById('assignNameFilterBtn');
            if (!panel || panel.hidden) return;
            if (panel.contains(event.target) || button?.contains(event.target)) return;
            panel.hidden = true;
            button?.setAttribute('aria-expanded', 'false');
        };
        document.addEventListener('click', this.nameFilterDismiss);
    }

    nameFilterQuery() {
        return document.getElementById('assignNameFilterSearch')?.value.trim().toLowerCase() || '';
    }

    filteredNameUsers() {
        const query = this.nameFilterQuery();
        return this.users.filter((user) => !query || String(user.name || '').toLowerCase().includes(query));
    }

    renderNameFilterList() {
        const list = document.getElementById('assignNameFilterList');
        const selectAll = document.getElementById('assignNameFilterAll');
        if (!list) return;
        const users = this.filteredNameUsers();
        const shown = users.filter((user) => !this.hiddenAssigneeIds.has(String(user._id))).length;
        if (selectAll) {
            selectAll.checked = users.length > 0 && shown === users.length;
            selectAll.indeterminate = shown > 0 && shown < users.length;
        }
        list.innerHTML = users.map((user) => {
            const id = String(user._id);
            const checked = !this.hiddenAssigneeIds.has(id);
            return `<label class="lead-name-filter-row">
                <input type="checkbox" ${checked ? 'checked' : ''} onchange="leadsManager.toggleNameFilterUser('${CRM.escapeJs(id)}', this.checked)">
                <span>${CRM.escapeHtml(user.name)}</span>
            </label>`;
        }).join('') || '<p class="lead-assign-hint">No names match.</p>';
    }

    toggleNameFilterUser(id, checked) {
        if (checked) this.hiddenAssigneeIds.delete(String(id));
        else this.hiddenAssigneeIds.add(String(id));
        if (this.assigneeId && this.hiddenAssigneeIds.has(String(this.assigneeId))) this.clearAssignee();
        this.renderNameFilterList();
        this.renderAssignees();
        this.saveNameFilter();
    }

    toggleAllNameFilter(checked) {
        this.filteredNameUsers().forEach((user) => {
            const id = String(user._id);
            if (checked) this.hiddenAssigneeIds.delete(id);
            else this.hiddenAssigneeIds.add(id);
        });
        if (this.assigneeId && this.hiddenAssigneeIds.has(String(this.assigneeId))) this.clearAssignee();
        this.renderNameFilterList();
        this.renderAssignees();
        this.saveNameFilter();
    }

    saveNameFilter() {
        clearTimeout(this.nameFilterSaveTimer);
        this.nameFilterSaveTimer = setTimeout(async () => {
            try {
                const hiddenUserIds = [...this.hiddenAssigneeIds];
                const response = await fetch('/api/me/lead-assign-filter', {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hiddenUserIds })
                });
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || 'Failed to save the name filter');
                }
                if (this.me) this.me.leadAssignHiddenUserIds = hiddenUserIds;
            } catch (error) {
                showAlertModal(error.message || 'Failed to save the name filter.', 'error');
            }
        }, 250);
    }

    renderAssigneeView() {
        const bar = document.getElementById('assigneeViewBar');
        const label = document.getElementById('assigneeViewLabel');
        if (!bar || !label) return;
        const user = this.users.find((item) => String(item._id) === String(this.assigneeId));
        if (!this.isAdmin() || !user) {
            bar.hidden = true;
            return;
        }
        bar.hidden = false;
        label.textContent = `${user.name}'s leads`;
    }

    openAssignee(id) {
        if (!this.isAdmin() || this.suppressAssigneeClick) return;
        this.assigneeId = String(this.assigneeId) === String(id) ? null : String(id);
        this.selected.clear();
        this.anchorId = null;
        this.applyFilters();
        this.renderAssignees();
    }

    clearAssignee() {
        this.assigneeId = null;
        this.selected.clear();
        this.applyFilters();
        this.renderAssignees();
    }

    toggleAssignMode() {
        if (!this.isAdmin()) return;
        this.assignMode = !this.assignMode;
        if (!this.assignMode) {
            this.selected.clear();
            this.anchorId = null;
        }
        this.render();
    }

    openLead(id) {
        if (this.suppressOpen) return;
        window.location.href = `/leads/${id}`;
    }

    onRowDoubleClick(event, id) {
        if (event.target.closest('button, select, a, input, label')) return;
        if (!this.assignMode) return;
        this.openLead(id);
    }

    onRowClick(event, id) {
        if (event.target.closest('button, select, a, input, label')) return;
        if (this.didDrag) {
            this.didDrag = false;
            return;
        }
        if (!this.isAdmin() || !this.assignMode) {
            this.openLead(id);
            return;
        }
        if (event.detail > 1) return;
        if (event.shiftKey) {
            event.preventDefault();
            this.selectRange(id, event.ctrlKey || event.metaKey);
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            if (this.selected.has(id)) this.selected.delete(id);
            else this.selected.add(id);
            this.anchorId = id;
            this.render();
            return;
        }
        this.selected = new Set([id]);
        this.anchorId = id;
        this.render();
    }

    selectRange(id, additive) {
        const ids = this.leads.map((lead) => String(lead._id));
        const end = ids.indexOf(id);
        if (end < 0) return;
        const start = this.anchorId ? ids.indexOf(this.anchorId) : -1;
        if (start < 0) {
            this.anchorId = id;
            this.selected = new Set([id]);
            this.render();
            return;
        }
        const [from, to] = start < end ? [start, end] : [end, start];
        const range = ids.slice(from, to + 1);
        this.selected = additive ? new Set([...this.selected, ...range]) : new Set(range);
        this.render();
    }

    startDrag(event, id) {
        if (!this.isAdmin() || !this.assignMode || event.target.closest('button, select, a, input, label')) {
            event.preventDefault();
            return;
        }
        this.didDrag = true;
        this.suppressOpen = true;
        event.stopPropagation();
        if (!this.selected.has(id)) {
            this.selected = new Set([id]);
            this.anchorId = id;
            document.querySelectorAll('.leads-table tbody tr.is-selected').forEach((row) => row.classList.remove('is-selected'));
            event.currentTarget.classList.add('is-selected');
        }
        const ids = [...this.selected];
        this.dragIds = ids;
        event.dataTransfer.setData('text/plain', JSON.stringify(ids));
        event.dataTransfer.effectAllowed = 'move';
        this.setDragGhost(event, ids.length);
        ids.forEach((leadId) => {
            document.querySelector(`.leads-table tr[data-lead-id="${leadId}"]`)?.classList.add('is-dragging');
        });
    }

    setDragGhost(event, count) {
        this.clearDragGhost();
        const ghost = document.createElement('div');
        ghost.className = 'lead-drag-ghost';
        ghost.innerHTML = `
            <span class="lead-drag-ghost-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21a8 8 0 0 0-16 0"></path>
                    <circle cx="12" cy="8" r="4"></circle>
                </svg>
            </span>
            <span class="lead-drag-ghost-count">${count}</span>
        `;
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, 28, 28);
        this.dragGhost = ghost;
    }

    clearDragGhost() {
        this.dragGhost?.remove();
        this.dragGhost = null;
    }

    endDrag() {
        document.querySelectorAll('.leads-table tr.is-dragging').forEach((row) => row.classList.remove('is-dragging'));
        this.clearDragGhost();
        setTimeout(() => { this.suppressOpen = false; }, 0);
    }

    dragOverAssignee(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.classList.add('is-drop-target');
    }

    dragLeaveAssignee(event) {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        event.currentTarget.classList.remove('is-drop-target');
    }

    dropOnAssignee(event, userId) {
        event.preventDefault();
        this.suppressAssigneeClick = true;
        setTimeout(() => { this.suppressAssigneeClick = false; }, 0);
        event.currentTarget.classList.remove('is-drop-target');
        let ids = [];
        try {
            const raw = JSON.parse(event.dataTransfer.getData('text/plain'));
            ids = Array.isArray(raw) ? raw : [raw];
        } catch (error) {
            const single = event.dataTransfer.getData('text/plain');
            if (single) ids = [single];
        }
        if (ids.length) this.assignMany(ids, userId);
    }

    async refreshAssigneeCounts() {
        try {
            await this.loadAssigneeCounts();
            this.renderAssignees();
        } catch (error) {
            showAlertModal(error.message || 'Failed to count assigned leads.', 'error');
        }
    }

    async changeStatus(id, status) {
        const lead = this.leads.find((item) => String(item._id) === String(id));
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(id)}/status`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to update status');
            if (lead && data.lead) Object.assign(lead, data.lead);
            else if (lead) lead.status = status;
            this.render();
            this.refreshAssigneeCounts();
            showToast?.('Status updated', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to update status.', 'error');
            this.render();
        }
    }

    closeRowMenus() {
        document.querySelectorAll('.leads-table .quote-overflow-dropdown').forEach((dropdown) => {
            dropdown.style.display = 'none';
        });
    }

    toggleRowMenu(event) {
        event.stopPropagation();
        const menu = event.target.closest('.quote-overflow-menu');
        const dropdown = menu?.querySelector('.quote-overflow-dropdown');
        if (!dropdown) return;
        const isOpen = dropdown.style.display === 'block';
        this.closeRowMenus();
        if (isOpen) return;
        const button = menu.querySelector('.quote-overflow-btn');
        const rect = button.getBoundingClientRect();
        dropdown.style.display = 'block';
        dropdown.style.position = 'fixed';
        dropdown.style.minWidth = '140px';
        dropdown.style.zIndex = '1000';
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = 'auto';
        dropdown.style.right = `${window.innerWidth - rect.right}px`;
        const close = (clickEvent) => {
            if (clickEvent.target.closest('.quote-overflow-menu')) return;
            this.closeRowMenus();
            document.removeEventListener('click', close);
            window.removeEventListener('scroll', close, true);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', close, true);
        }, 0);
    }

    async deleteLead(id, name) {
        const confirmed = await showConfirmModal(
            `Delete ${name || 'this lead'}? This cannot be undone. A linked quote or project is kept.`,
            'Delete lead',
            'Delete',
            'Cancel'
        );
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to delete lead');
            this.selected.delete(String(id));
            if (String(this.assigneeId) === String(id)) this.assigneeId = null;
            await this.loadLeads();
            this.render();
            this.refreshAssigneeCounts();
            window.AppShell?.refreshUnseenLeads?.();
            showToast?.('Lead deleted', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to delete lead.', 'error');
        }
    }

    async claim(id) {
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(id)}/claim`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to claim lead');
            await this.loadLeads();
            this.render();
            this.refreshAssigneeCounts();
            showAlertModal('Lead claimed.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to claim lead.', 'error');
        }
    }

    async unassign(id) {
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(id)}/unassign`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to unassign lead');
            this.selected.delete(String(id));
            await this.loadLeads();
            this.render();
            this.refreshAssigneeCounts();
            showToast?.('Lead unassigned', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to unassign lead.', 'error');
        }
    }

    async assignMany(ids, userId) {
        if (!userId || !ids.length) return;
        try {
            const response = await fetch('/api/leads/bulk-assign', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadIds: ids, userId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to assign leads');
            ids.forEach((id) => this.selected.delete(String(id)));
            await this.loadLeads();
            this.render();
            this.refreshAssigneeCounts();
            const count = data.count || ids.length;
            showToast?.(count === 1 ? 'Lead assigned' : `${count} leads assigned`, 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to assign leads.', 'error');
            this.render();
        }
    }

}

let leadsManager;
document.addEventListener('DOMContentLoaded', () => {
    leadsManager = new LeadsManager();
});
