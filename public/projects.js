/**
 * Projects list page.
 */

class ProjectsManager {
    constructor() {
        this.projects = [];
        this.showingArchived = false;
        this.currentPage = 1;
        this.pageSize = 50;
        this.totalProjects = 0;
        this.totalPages = 0;
        this.searchDebounceTimer = null;
        this.sortColumn = localStorage.getItem('projectsSortColumn') || '';
        this.sortDirection = localStorage.getItem('projectsSortDirection') || 'asc';
        const savedWhen = localStorage.getItem('projectsWhen');
        this.when = ['all', 'upcoming', 'past'].includes(savedWhen) ? savedWhen : 'upcoming';
        this.init();
    }

    async init() {
        this.syncWhenToggle();
        this.updateClearButton();
        await this.loadProjects();
        this.render();
        this.updateSortIndicators();
    }

    setWhen(when) {
        if (!['all', 'upcoming', 'past'].includes(when) || this.when === when) return;
        this.when = when;
        localStorage.setItem('projectsWhen', when);
        this.syncWhenToggle();
        this.updateClearButton();
        this.currentPage = 1;
        this.loadProjects().then(() => {
            this.render();
            this.updateSortIndicators();
        });
    }

    syncWhenToggle() {
        document.querySelectorAll('.pc-when-toggle [data-when]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.when === this.when);
        });
    }

    sortByColumn(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }
        localStorage.setItem('projectsSortColumn', this.sortColumn);
        localStorage.setItem('projectsSortDirection', this.sortDirection);
        this.currentPage = 1;
        this.loadProjects().then(() => {
            this.render();
            this.updateSortIndicators();
        });
    }

    updateSortIndicators() {
        document.querySelectorAll('.projects-table .sort-indicator').forEach((el) => {
            el.textContent = el.dataset.sort === this.sortColumn
                ? (this.sortDirection === 'asc' ? ' ▲' : ' ▼')
                : '';
        });
    }

    debouncedSearch() {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => this.applyFilters(), 300);
    }

    applyFilters() {
        this.currentPage = 1;
        this.loadProjects().then(() => {
            this.render();
            this.updateSortIndicators();
        });
        this.updateClearButton();
    }

    clearFilters() {
        document.getElementById('searchProjects').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('dateFilter').value = '';
        this.applyFilters();
    }

    updateClearButton() {
        const hasFilters = document.getElementById('searchProjects').value ||
            document.getElementById('statusFilter').value ||
            document.getElementById('dateFilter').value;
        document.getElementById('clearFiltersBtn').style.display = hasFilters ? '' : 'none';
        const drawerActive = !!(document.getElementById('statusFilter')?.value ||
            document.getElementById('dateFilter')?.value ||
            (this.when && this.when !== 'upcoming') ||
            this.showingArchived);
        if (window.PageControls) {
            PageControls.syncFilterIndicator('#projectsPageControls', drawerActive);
        }
    }

    toggleArchiveView() {
        this.showingArchived = !this.showingArchived;
        const toggleText = document.getElementById('archiveToggleText');
        const archiveBtn = document.getElementById('archiveToggleBtn');
        if (toggleText) toggleText.textContent = this.showingArchived ? 'View Active' : 'View Archived';
        archiveBtn?.classList.toggle('is-active', this.showingArchived);
        this.updateClearButton();
        this.currentPage = 1;
        this.loadProjects().then(() => this.render());
    }

    async loadProjects() {
        try {
            this.showLoading(true);
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.pageSize,
                archived: this.showingArchived
            });
            const search = document.getElementById('searchProjects')?.value || '';
            const status = document.getElementById('statusFilter')?.value || '';
            const date = document.getElementById('dateFilter')?.value || '';
            if (search) params.append('search', search);
            if (status) params.append('status', status);
            if (date) params.append('date', date);
            if (this.when && this.when !== 'all') params.append('when', this.when);
            const sortable = ['name', 'client', 'dates', 'status', 'contract', 'invoices', 'owner', 'created'];
            if (sortable.includes(this.sortColumn)) {
                params.append('sortBy', this.sortColumn);
                params.append('sortDir', this.sortDirection === 'desc' ? 'desc' : 'asc');
            }

            const data = await CRM.api(`/api/projects?${params}`);
            this.projects = data.projects || [];
            this.totalProjects = data.total || 0;
            this.totalPages = data.totalPages || 1;
            this.currentPage = data.page || 1;
        } catch (error) {
            console.error('Error loading projects:', error);
            showAlertModal('Error loading projects. Please try again.', 'error');
            this.projects = [];
        } finally {
            this.showLoading(false);
        }
    }

    showLoading(show) {
        const skeleton = document.getElementById('projectsSkeleton');
        if (!skeleton) return;
        if (show) {
            skeleton.className = 'quotes-skeleton quotes-skeleton--list';
            skeleton.innerHTML = Array.from({ length: 8 }, () => `
                <div class="skeleton-row">
                    <div class="skeleton-block skeleton-block--title"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                    <div class="skeleton-block skeleton-block--line"></div>
                    <div class="skeleton-block skeleton-block--line"></div>
                    <div class="skeleton-block skeleton-block--short"></div>
                </div>
            `).join('');
            skeleton.style.display = 'block';
        } else {
            skeleton.style.display = 'none';
        }
    }

    render() {
        const tbody = document.getElementById('projectsTableBody');
        const empty = document.getElementById('projectsEmpty');
        if (!tbody) return;

        if (this.projects.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
        } else {
            empty.style.display = 'none';
            tbody.innerHTML = this.projects.map((project) => this.renderRow(project)).join('');
        }
        this.renderPagination();
    }

    renderRow(project) {
        const client = project.client;
        const clientTitle = client
            ? `${client.name}${client.company ? ` · ${client.company}` : ''}`
            : '';
        const clientLabel = client
            ? `<span class="crm-client-cell">
                    <span class="crm-client-name">${CRM.escapeHtml(client.name)}</span>
                    ${client.company ? `<span class="crm-client-company">${CRM.escapeHtml(client.company)}</span>` : ''}
               </span>`
            : '<span class="crm-inline-note">—</span>';

        const statusSelect = `
            <select class="crm-status-select crm-chip--${CRM.escapeHtml(project.status || 'lead')}"
                    onclick="event.stopPropagation()"
                    onchange="projectsManager.changeStatus('${project._id}', this.value)">
                ${Object.entries(CRM.PROJECT_STATUS_LABELS).map(([value, label]) =>
                    `<option value="${value}" ${value === project.status ? 'selected' : ''}>${label}</option>`).join('')}
            </select>`;

        const inv = project.invoiceSummary || {};
        let invoiceCell = '<span class="crm-inline-note">—</span>';
        let invoiceMeta = '';
        if (inv.totalInvoiced > 0) {
            const pct = Math.min(100, Math.round((inv.totalPaid / inv.totalInvoiced) * 100));
            invoiceCell = `
                <div class="invoice-progress" title="${CRM.money(inv.totalPaid)} of ${CRM.money(inv.totalInvoiced)} paid">
                    <div class="invoice-progress-bar"><span style="width:${pct}%"></span></div>
                    <span class="invoice-progress-label">${CRM.money(inv.totalPaid, { cents: false })} / ${CRM.money(inv.totalInvoiced, { cents: false })}</span>
                </div>`;
            invoiceMeta = `${CRM.money(inv.totalPaid, { cents: false })} / ${CRM.money(inv.totalInvoiced, { cents: false })}`;
        } else if (inv.count > 0) {
            invoiceCell = `<span class="crm-inline-note">${inv.count} draft${inv.count === 1 ? '' : 's'}</span>`;
            invoiceMeta = `${inv.count} draft${inv.count === 1 ? '' : 's'}`;
        }

        const clientMeta = client
            ? `${CRM.escapeHtml(client.name)}${client.company ? ` · ${CRM.escapeHtml(client.company)}` : ''}`
            : '';
        const datesMeta = CRM.escapeHtml(CRM.formatDateRange(project.startDate, project.endDate));
        const contractMeta = CRM.escapeHtml(
            CRM.CONTRACT_STATUS_LABELS[project.contractStatus] || project.contractStatus || 'None'
        );
        const ownerMeta = project.createdBy?.name ? CRM.escapeHtml(project.createdBy.name) : '';
        const createdMeta = project.createdAt ? CRM.escapeHtml(CRM.formatDate(project.createdAt)) : '';
        const metaHtml = CRM.listRowMeta([
            clientMeta,
            datesMeta,
            contractMeta,
            invoiceMeta,
            ownerMeta,
            createdMeta
        ]);

        const canShare = project.isOwner || this.isCurrentUserAdmin();
        const canEdit = project.accessLevel !== 'read';
        const canDelete = project.isOwner || this.isCurrentUserAdmin();

        const menu = `
            <div class="quote-overflow-menu table-overflow-menu">
                <button class="quote-overflow-btn" onclick="projectsManager.toggleRowMenu(event)" aria-label="Project actions" aria-haspopup="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                </button>
                <div class="quote-overflow-dropdown list-overflow-dropdown" style="display: none;">
                    <button class="overflow-menu-item" onclick="window.location.href='/projects/${project._id}'">Open</button>
                    ${canShare ? `<button class="overflow-menu-item" onclick="projectsManager.openShareModal('${project._id}')">Share</button>` : ''}
                    ${canEdit ? `<button class="overflow-menu-item" onclick="projectsManager.transferToLumDash('${project._id}')">Transfer to LumDash</button>` : ''}
                    ${canEdit ? `<button class="overflow-menu-item" onclick="projectsManager.toggleArchive('${project._id}', ${!project.archived})">${project.archived ? 'Unarchive' : 'Archive'}</button>` : ''}
                    ${canDelete ? `<button class="overflow-menu-item danger" onclick="projectsManager.deleteProject('${project._id}', '${CRM.escapeJs(project.name)}')">Delete</button>` : ''}
                </div>
            </div>`;

        const isBookedPlus = CRM.isBookedPlus(project.status);
        // Share badge only for non-admin users who were shared in (matches quotes list)
        const showSharedBadge = !this.isCurrentUserAdmin() && !project.isOwner && project.accessLevel;
        const sharedBadge = showSharedBadge
            ? `<span class="crm-chip ${project.accessLevel === 'read' ? 'crm-chip--draft' : 'crm-chip--quoted'}" title="Shared with you">${project.accessLevel === 'read' ? 'Viewer' : 'Editor'}</span>`
            : '';

        const statusCell = canEdit
            ? statusSelect
            : CRM.projectStatusChip(project.status);

        return `
            <tr class="quote-row is-clickable${isBookedPlus ? ' project-row--booked' : ''}"${isBookedPlus ? ' title="Booked (signed, invoiced, paid, or complete)"' : ''} onclick="window.location.href='/projects/${project._id}'">
                <td class="quote-title-cell">
                    <div class="list-row-primary">
                        <span class="crm-project-name-wrap">
                            <span class="crm-project-name" title="${CRM.escapeHtml(project.name)}">${CRM.escapeHtml(project.name)}</span>
                            ${sharedBadge}
                        </span>
                        ${metaHtml}
                    </div>
                </td>
                <td class="col-fold-sm" title="${CRM.escapeHtml(clientTitle)}">${clientLabel}</td>
                <td class="col-fold-sm">${CRM.escapeHtml(CRM.formatDateRange(project.startDate, project.endDate))}</td>
                <td onclick="event.stopPropagation()">${statusCell}</td>
                <td class="col-fold-sm">${CRM.contractStatusChip(project.contractStatus)}</td>
                <td class="col-fold-sm">${invoiceCell}</td>
                <td class="col-hide-sm col-fold-sm">${project.createdBy?.name
                    ? CRM.escapeHtml(project.createdBy.name)
                    : '<span class="crm-inline-note">—</span>'}</td>
                <td class="col-hide-sm col-fold-sm">${project.createdAt
                    ? CRM.escapeHtml(CRM.formatDate(project.createdAt))
                    : '<span class="crm-inline-note">—</span>'}</td>
                <td class="actions-cell" onclick="event.stopPropagation()">${menu}</td>
            </tr>`;
    }

    async changeStatus(id, status) {
        const project = this.projects.find((p) => String(p._id) === String(id));
        if (project?.accessLevel === 'read') {
            showAlertModal('You have read-only access to this project.', 'error');
            this.render();
            return;
        }
        const previousStatus = project?.status || 'lead';
        try {
            await CRM.api(`/api/projects/${id}`, { method: 'PUT', body: { status } });
            if (project) project.status = status;
            this.render();
            showToast?.('Status updated', 'success');
            if (status === 'booked' && window.LumDashIntegration?.onProjectMarkedAsBooked) {
                await window.LumDashIntegration.onProjectMarkedAsBooked(id, previousStatus);
            }
        } catch (error) {
            showAlertModal(error.message, 'error');
            this.render();
        }
    }

    // ----- Row overflow menu -----

    closeRowMenus() {
        document.querySelectorAll('.projects-table .quote-overflow-dropdown').forEach((dd) => {
            dd.style.display = 'none';
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

        // Fixed positioning so the dropdown escapes the table's scroll container
        const btn = menu.querySelector('.quote-overflow-btn');
        const rect = btn.getBoundingClientRect();
        dropdown.style.display = 'block';
        dropdown.style.position = 'fixed';
        dropdown.style.minWidth = '160px';
        dropdown.style.zIndex = '1000';
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = 'auto';
        dropdown.style.right = `${window.innerWidth - rect.right}px`;

        const close = (e) => {
            if (!e.target.closest('.quote-overflow-menu')) {
                this.closeRowMenus();
                document.removeEventListener('click', close);
                window.removeEventListener('scroll', close, true);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', close, true);
        }, 0);
    }

    renderPagination() {
        const container = document.getElementById('paginationContainer');
        if (!container) return;
        if (this.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, this.totalProjects);
        container.innerHTML = `
            <div class="pagination-info">Showing ${startItem}-${endItem} of ${this.totalProjects} projects</div>
            <div class="pagination-controls">
                <button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} onclick="projectsManager.goToPage(${this.currentPage - 1})">Prev</button>
                <span class="pagination-current">Page ${this.currentPage} of ${this.totalPages}</span>
                <button class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} onclick="projectsManager.goToPage(${this.currentPage + 1})">Next</button>
            </div>`;
    }

    goToPage(page) {
        if (page < 1 || page > this.totalPages) return;
        this.currentPage = page;
        this.loadProjects().then(() => this.render());
    }

    async transferToLumDash(id) {
        this.closeRowMenus();
        if (!window.LumDashIntegration?.transferProjectToLumDash) {
            showAlertModal('LumDash integration is not available.', 'error');
            return;
        }
        try {
            await window.LumDashIntegration.transferProjectToLumDash(id);
        } catch (error) {
            showAlertModal(error.message || 'Failed to transfer to LumDash.', 'error');
        }
    }

    async toggleArchive(id, archived) {
        try {
            await CRM.api(`/api/projects/${id}/archive`, { method: 'POST', body: { archived } });
            showAlertModal(`Project ${archived ? 'archived' : 'unarchived'}.`, 'success', null, true);
            await this.loadProjects();
            this.render();
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async deleteProject(id, name, { force = false } = {}) {
        const confirmed = await showConfirmModal(
            force
                ? `Force-delete project "${name}" and ALL of its invoices (including sent/paid test invoices)? Linked quotes are kept but unlinked. This cannot be undone.`
                : `Delete project "${name}"? Linked quotes are kept but unlinked. This cannot be undone.`,
            force ? 'Force Delete Project' : 'Delete Project',
            force ? 'Force Delete' : 'Delete'
        );
        if (!confirmed) return;
        try {
            const url = force ? `/api/projects/${id}?force=1` : `/api/projects/${id}`;
            await CRM.api(url, { method: 'DELETE' });
            showAlertModal(force ? 'Project and invoices force-deleted.' : 'Project deleted.', 'success', null, true);
            await this.loadProjects();
            this.render();
        } catch (error) {
            const canForce = this.isCurrentUserAdmin()
                && /sent or paid invoice|HAS_INVOICES|force delete/i.test(error.message || '');
            if (!force && canForce) {
                const doForce = await showConfirmModal(
                    `${error.message}\n\nForce-delete this project and permanently remove those invoices? Use this for test data cleanup.`,
                    'Force Delete?',
                    'Force Delete',
                    'Cancel'
                );
                if (doForce) {
                    return this.deleteProject(id, name, { force: true });
                }
                return;
            }
            showAlertModal(error.message, 'error');
        }
    }

    isCurrentUserAdmin() {
        try {
            return JSON.parse(localStorage.getItem('user') || '{}').role === 'admin';
        } catch {
            return false;
        }
    }

    // ----- Share modal -----

    async openShareModal(projectId) {
        const project = this.projects.find((p) => String(p._id) === String(projectId));
        if (!project) {
            showAlertModal('Project not found.', 'error');
            return;
        }
        this.sharingProjectId = projectId;
        document.getElementById('shareProjectName').textContent = `"${project.name}"`;
        document.getElementById('shareProjectUserSearch').value = '';
        document.getElementById('selectedShareProjectUserId').value = '';
        document.getElementById('selectedShareProjectUserName').textContent = '';
        document.querySelector('input[name="projectAccessLevel"][value="read"]').checked = true;
        await this.loadShareableUsers();
        await this.loadSharedUsers(projectId);
        document.getElementById('shareProjectModal').style.display = 'flex';
        this.setupShareUserSearch();
    }

    closeShareModal() {
        document.getElementById('shareProjectModal').style.display = 'none';
        document.getElementById('shareProjectUserDropdown').style.display = 'none';
        this.sharingProjectId = null;
    }

    async loadShareableUsers() {
        try {
            const response = await fetch('/api/shareable-users', { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to load users');
            this.shareableUsers = await response.json();
        } catch (error) {
            console.error('Error loading shareable users:', error);
            this.shareableUsers = [];
        }
    }

    setupShareUserSearch() {
        const searchInput = document.getElementById('shareProjectUserSearch');
        const dropdown = document.getElementById('shareProjectUserDropdown');
        const newSearchInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newSearchInput, searchInput);

        newSearchInput.addEventListener('focus', () => {
            this.renderShareUserDropdown('');
            dropdown.style.display = 'block';
        });
        newSearchInput.addEventListener('input', (e) => {
            this.renderShareUserDropdown(e.target.value);
            dropdown.style.display = 'block';
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.share-user-dropdown')) {
                dropdown.style.display = 'none';
            }
        });
    }

    renderShareUserDropdown(searchTerm) {
        const dropdown = document.getElementById('shareProjectUserDropdown');
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const filteredUsers = (this.shareableUsers || []).filter((user) => {
            const matchesSearch = user.name.toLowerCase().includes((searchTerm || '').toLowerCase());
            return matchesSearch && user.name !== currentUser.name;
        });
        if (filteredUsers.length === 0) {
            dropdown.innerHTML = '<div class="share-user-item no-results">No users found</div>';
            return;
        }
        dropdown.innerHTML = filteredUsers.map((user) => `
            <div class="share-user-item" onclick="projectsManager.selectShareUser('${user._id}', '${CRM.escapeJs(user.name)}')">
                <span class="share-user-name">${CRM.escapeHtml(user.name)}</span>
                ${user.email ? `<span class="share-user-email">${CRM.escapeHtml(user.email)}</span>` : ''}
            </div>
        `).join('');
    }

    selectShareUser(userId, userName) {
        document.getElementById('selectedShareProjectUserId').value = userId;
        document.getElementById('selectedShareProjectUserName').textContent = userName;
        document.getElementById('shareProjectUserSearch').value = userName;
        document.getElementById('shareProjectUserDropdown').style.display = 'none';
    }

    async addShare() {
        const userId = document.getElementById('selectedShareProjectUserId').value;
        const accessLevel = document.querySelector('input[name="projectAccessLevel"]:checked').value;
        if (!userId) {
            showAlertModal('Please select a user to share with', 'error');
            return;
        }
        try {
            const result = await CRM.api(`/api/projects/${this.sharingProjectId}/share`, {
                method: 'POST',
                body: { userId, accessLevel }
            });
            document.getElementById('selectedShareProjectUserId').value = '';
            document.getElementById('selectedShareProjectUserName').textContent = '';
            document.getElementById('shareProjectUserSearch').value = '';
            await this.loadSharedUsers(this.sharingProjectId);
            showAlertModal(result.message || 'Project shared successfully!', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to share project', 'error');
        }
    }

    async loadSharedUsers(projectId) {
        const container = document.getElementById('sharedProjectUsersList');
        try {
            const sharedUsers = await CRM.api(`/api/projects/${projectId}/shared-with`);
            if (!sharedUsers.length) {
                container.innerHTML = '<p class="no-shares-message">Not shared with anyone yet</p>';
                return;
            }
            container.innerHTML = sharedUsers.map((share) => `
                <div class="shared-user-item">
                    <div class="shared-user-info">
                        <span class="shared-user-name">${CRM.escapeHtml(share.user?.name || 'Unknown User')}</span>
                        <span class="shared-user-access ${share.accessLevel}">${share.accessLevel === 'read' ? 'Read Only' : 'Full Access'}</span>
                    </div>
                    <button class="remove-share-btn" onclick="projectsManager.removeShare('${share.user?._id}')" title="Remove access">
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
            await CRM.api(`/api/projects/${this.sharingProjectId}/share/${userId}`, { method: 'DELETE' });
            await this.loadSharedUsers(this.sharingProjectId);
            showAlertModal('Share access removed.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to remove access', 'error');
        }
    }

    // ----- Create modal -----

    async openCreateModal() {
        document.getElementById('createProjectForm').reset();
        document.getElementById('createProjectModal').style.display = 'flex';
        try {
            const clients = await CRM.api('/api/crm/clients');
            const datalist = document.getElementById('clientNameOptions');
            datalist.innerHTML = clients.map((c) => `<option value="${CRM.escapeHtml(c.name)}"></option>`).join('');
        } catch {
            // autocomplete is optional
        }
        setTimeout(() => document.getElementById('newProjectName').focus(), 50);
    }

    closeCreateModal() {
        document.getElementById('createProjectModal').style.display = 'none';
    }

    async createProject(event) {
        event.preventDefault();
        const name = document.getElementById('newProjectName').value.trim();
        if (!name) return;

        const clientName = document.getElementById('newProjectClientName').value.trim();
        const body = {
            name,
            status: document.getElementById('newProjectStatus').value,
            startDate: document.getElementById('newProjectStart').value || null,
            endDate: document.getElementById('newProjectEnd').value || null
        };
        if (clientName) {
            body.client = {
                name: clientName,
                email: document.getElementById('newProjectClientEmail').value.trim(),
                company: document.getElementById('newProjectClientCompany').value.trim()
            };
        }

        try {
            const project = await CRM.api('/api/projects', { method: 'POST', body });
            this.closeCreateModal();
            window.location.href = `/projects/${project._id}`;
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }
}

const projectsManager = new ProjectsManager();
window.projectsManager = projectsManager;
