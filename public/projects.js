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
        await this.loadProjects();
        this.render();
        this.updateSortIndicators();
    }

    setWhen(when) {
        if (!['all', 'upcoming', 'past'].includes(when) || this.when === when) return;
        this.when = when;
        localStorage.setItem('projectsWhen', when);
        this.syncWhenToggle();
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
    }

    toggleArchiveView() {
        this.showingArchived = !this.showingArchived;
        const toggleText = document.getElementById('archiveToggleText');
        const archiveBtn = document.getElementById('archiveToggleBtn');
        if (toggleText) toggleText.textContent = this.showingArchived ? 'View Active' : 'View Archived';
        archiveBtn?.classList.toggle('is-active', this.showingArchived);
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
            const sortable = ['name', 'client', 'dates', 'status', 'contract', 'invoices'];
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
        if (skeleton) skeleton.style.display = show ? 'block' : 'none';
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
        const clientLabel = client
            ? `${CRM.escapeHtml(client.name)}${client.company ? ` <span class="crm-inline-note">· ${CRM.escapeHtml(client.company)}</span>` : ''}`
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
        if (inv.totalInvoiced > 0) {
            const pct = Math.min(100, Math.round((inv.totalPaid / inv.totalInvoiced) * 100));
            invoiceCell = `
                <div class="invoice-progress" title="${CRM.money(inv.totalPaid)} of ${CRM.money(inv.totalInvoiced)} paid">
                    <div class="invoice-progress-bar"><span style="width:${pct}%"></span></div>
                    <span class="invoice-progress-label">${CRM.money(inv.totalPaid, { cents: false })} / ${CRM.money(inv.totalInvoiced, { cents: false })}</span>
                </div>`;
        } else if (inv.count > 0) {
            invoiceCell = `<span class="crm-inline-note">${inv.count} draft${inv.count === 1 ? '' : 's'}</span>`;
        }

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
                    <button class="overflow-menu-item" onclick="projectsManager.toggleArchive('${project._id}', ${!project.archived})">${project.archived ? 'Unarchive' : 'Archive'}</button>
                    <button class="overflow-menu-item danger" onclick="projectsManager.deleteProject('${project._id}', '${CRM.escapeJs(project.name)}')">Delete</button>
                </div>
            </div>`;

        return `
            <tr class="quote-row is-clickable" onclick="window.location.href='/projects/${project._id}'">
                <td class="quote-title-cell">
                    <span class="crm-project-name">${CRM.escapeHtml(project.name)}</span>
                </td>
                <td>${clientLabel}</td>
                <td>${CRM.escapeHtml(CRM.formatDateRange(project.startDate, project.endDate))}</td>
                <td onclick="event.stopPropagation()">${statusSelect}</td>
                <td>${CRM.contractStatusChip(project.contractStatus)}</td>
                <td>${invoiceCell}</td>
                <td class="actions-cell" onclick="event.stopPropagation()">${menu}</td>
            </tr>`;
    }

    async changeStatus(id, status) {
        try {
            await CRM.api(`/api/projects/${id}`, { method: 'PUT', body: { status } });
            const project = this.projects.find((p) => String(p._id) === String(id));
            if (project) project.status = status;
            this.render();
            showToast?.('Status updated', 'success');
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

    async deleteProject(id, name) {
        const confirmed = await showConfirmModal(
            `Delete project "${name}"? Linked quotes are kept but unlinked. This cannot be undone.`,
            'Delete Project', 'Delete'
        );
        if (!confirmed) return;
        try {
            await CRM.api(`/api/projects/${id}`, { method: 'DELETE' });
            showAlertModal('Project deleted.', 'success', null, true);
            await this.loadProjects();
            this.render();
        } catch (error) {
            showAlertModal(error.message, 'error');
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
