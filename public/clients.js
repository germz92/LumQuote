/**
 * Clients page — People view (contacts) or Companies view (grouped by company).
 */

class ClientsManager {
    constructor() {
        this.clients = [];
        this.expanded = new Set();
        this.searchTimer = null;
        this.viewMode = localStorage.getItem('clientsViewMode') === 'companies' ? 'companies' : 'people';
        this.load();
    }

    debouncedSearch() {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.load(), 300);
    }

    setView(mode) {
        if (mode !== 'people' && mode !== 'companies') return;
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        localStorage.setItem('clientsViewMode', mode);
        this.expanded.clear();
        this.syncViewToggle();
        this.render();
    }

    syncViewToggle() {
        document.getElementById('viewPeopleBtn')?.classList.toggle('is-active', this.viewMode === 'people');
        document.getElementById('viewCompaniesBtn')?.classList.toggle('is-active', this.viewMode === 'companies');
    }

    async load() {
        const skeleton = document.getElementById('clientsSkeleton');
        try {
            const search = document.getElementById('searchClients').value.trim();
            const params = search ? `?search=${encodeURIComponent(search)}` : '';
            const data = await CRM.api(`/api/clients${params}`);
            this.clients = data.clients || [];
            this.syncViewToggle();
            this.render();
        } catch (error) {
            showToast?.(error.message, 'error');
        } finally {
            if (skeleton) skeleton.style.display = 'none';
        }
    }

    // ---------- Company grouping ----------

    groupByCompany() {
        const map = new Map();
        this.clients.forEach((client) => {
            const raw = (client.company || '').trim();
            const key = raw ? raw.toLowerCase() : '__none__';
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    name: raw || 'No company',
                    clients: [],
                    projects: [],
                    projectIds: new Set()
                });
            }
            const group = map.get(key);
            // Prefer a cased company name over the placeholder
            if (raw && group.name === 'No company') group.name = raw;
            else if (raw && raw.length > group.name.length) group.name = raw;

            group.clients.push(client);
            (client.projects || []).forEach((p) => {
                const pid = String(p._id);
                if (!group.projectIds.has(pid)) {
                    group.projectIds.add(pid);
                    group.projects.push({ ...p, contactName: client.name });
                }
            });
        });

        const groups = [...map.values()].map((g) => ({
            key: g.key,
            name: g.name,
            clients: g.clients,
            projects: g.projects,
            contactCount: g.clients.length,
            projectCount: g.projects.length,
            totalValue: g.projects.reduce((sum, p) => sum + (p.quoteTotal || 0), 0)
        }));

        // Named companies first (A–Z), then "No company"
        groups.sort((a, b) => {
            if (a.key === '__none__') return 1;
            if (b.key === '__none__') return -1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return groups;
    }

    // ---------- Render ----------

    render() {
        this.syncViewToggle();
        if (this.viewMode === 'companies') {
            this.renderCompanies();
        } else {
            this.renderPeople();
        }
    }

    renderPeople() {
        const head = document.getElementById('clientsTableHead');
        const body = document.getElementById('clientsTableBody');
        const empty = document.getElementById('clientsEmpty');

        head.innerHTML = `
            <tr>
                <th style="width:28px"></th>
                <th>Client</th>
                <th class="col-hide-sm">Company</th>
                <th class="col-hide-sm">Contact</th>
                <th>Projects</th>
                <th class="col-hide-sm">Total Value</th>
            </tr>`;

        if (this.clients.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'block';
            empty.querySelector('h3').textContent = 'No clients yet';
            empty.querySelector('p').textContent = 'Clients are created automatically when you save a quote or create a project.';
            return;
        }
        empty.style.display = 'none';

        body.innerHTML = this.clients.map((client) => {
            const id = String(client._id);
            const isOpen = this.expanded.has(id);
            const contact = [client.email, client.phone].filter(Boolean)
                .map((v) => CRM.escapeHtml(v)).join(' · ') || '<span class="crm-inline-note">—</span>';
            const projectsLabel = client.projectCount > 0
                ? `${client.projectCount} project${client.projectCount === 1 ? '' : 's'}`
                : '<span class="crm-inline-note">None</span>';
            const valueLabel = client.totalValue > 0
                ? `<span class="crm-cell-amount">${CRM.money(client.totalValue, { cents: false })}</span>`
                : '<span class="crm-inline-note">—</span>';

            const mainRow = `
                <tr class="client-row ${isOpen ? 'is-open' : ''}" onclick="clientsManager.toggleExpand('${CRM.escapeJs(id)}')">
                    <td class="client-caret">${client.projectCount > 0 ? `<span class="caret ${isOpen ? 'open' : ''}">▸</span>` : ''}</td>
                    <td><strong>${CRM.escapeHtml(client.name)}</strong></td>
                    <td class="col-hide-sm">${client.company ? CRM.escapeHtml(client.company) : '<span class="crm-inline-note">—</span>'}</td>
                    <td class="col-hide-sm">${contact}</td>
                    <td>${projectsLabel}</td>
                    <td class="col-hide-sm">${valueLabel}</td>
                </tr>`;

            if (!isOpen || client.projectCount === 0) return mainRow;

            return mainRow + this.expandProjectsRow(client.projects, 5);
        }).join('');
    }

    renderCompanies() {
        const head = document.getElementById('clientsTableHead');
        const body = document.getElementById('clientsTableBody');
        const empty = document.getElementById('clientsEmpty');
        const groups = this.groupByCompany();

        head.innerHTML = `
            <tr>
                <th style="width:28px"></th>
                <th>Company</th>
                <th>Contacts</th>
                <th>Projects</th>
                <th class="col-hide-sm">Total Value</th>
            </tr>`;

        if (groups.length === 0) {
            body.innerHTML = '';
            empty.style.display = 'block';
            empty.querySelector('h3').textContent = 'No companies yet';
            empty.querySelector('p').textContent = 'Add a company name on a client\'s project overview to group them here.';
            return;
        }
        empty.style.display = 'none';

        body.innerHTML = groups.map((group) => {
            const isOpen = this.expanded.has(group.key);
            const canExpand = group.contactCount > 0 || group.projectCount > 0;
            const valueLabel = group.totalValue > 0
                ? `<span class="crm-cell-amount">${CRM.money(group.totalValue, { cents: false })}</span>`
                : '<span class="crm-inline-note">—</span>';
            const unnamed = group.key === '__none__';

            const mainRow = `
                <tr class="client-row ${isOpen ? 'is-open' : ''}" onclick="clientsManager.toggleExpand('${CRM.escapeJs(group.key)}')">
                    <td class="client-caret">${canExpand ? `<span class="caret ${isOpen ? 'open' : ''}">▸</span>` : ''}</td>
                    <td><strong class="${unnamed ? 'crm-inline-note' : ''}">${CRM.escapeHtml(group.name)}</strong></td>
                    <td>${group.contactCount} contact${group.contactCount === 1 ? '' : 's'}</td>
                    <td>${group.projectCount > 0 ? `${group.projectCount} project${group.projectCount === 1 ? '' : 's'}` : '<span class="crm-inline-note">None</span>'}</td>
                    <td class="col-hide-sm">${valueLabel}</td>
                </tr>`;

            if (!isOpen || !canExpand) return mainRow;

            const contactsHtml = group.clients.map((c) => {
                const bits = [c.name, c.email, c.phone].filter(Boolean).map((v) => CRM.escapeHtml(v));
                return `<span class="company-contact-chip">${bits.join(' · ')}</span>`;
            }).join('');

            const projectRows = group.projects.map((p) => `
                <tr>
                    <td><a href="/projects/${p._id}" onclick="event.stopPropagation()">${CRM.escapeHtml(p.name)}</a></td>
                    <td>${CRM.escapeHtml(p.contactName || '—')}</td>
                    <td>${CRM.escapeHtml(CRM.formatDateRange(p.startDate, p.endDate))}</td>
                    <td>${CRM.projectStatusChip(p.status)}</td>
                    <td class="num">${p.quoteTotal > 0 ? CRM.money(p.quoteTotal, { cents: false }) : '—'}</td>
                </tr>`).join('');

            return mainRow + `
                <tr class="client-projects-row">
                    <td></td>
                    <td colspan="4">
                        <div class="company-contacts">${contactsHtml}</div>
                        ${group.projects.length > 0 ? `
                        <table class="client-projects-table">
                            <thead>
                                <tr><th>Project</th><th>Contact</th><th>Dates</th><th>Status</th><th class="num">Quoted</th></tr>
                            </thead>
                            <tbody>${projectRows}</tbody>
                        </table>` : '<p class="crm-inline-note" style="margin:8px 0 0">No projects yet.</p>'}
                    </td>
                </tr>`;
        }).join('');
    }

    expandProjectsRow(projects, colspan) {
        const projectRows = (projects || []).map((p) => `
            <tr>
                <td><a href="/projects/${p._id}" onclick="event.stopPropagation()">${CRM.escapeHtml(p.name)}</a></td>
                <td>${CRM.escapeHtml(CRM.formatDateRange(p.startDate, p.endDate))}</td>
                <td>${CRM.projectStatusChip(p.status)}</td>
                <td class="num">${p.quoteTotal > 0 ? CRM.money(p.quoteTotal, { cents: false }) : '—'}</td>
            </tr>`).join('');

        return `
            <tr class="client-projects-row">
                <td></td>
                <td colspan="${colspan}">
                    <table class="client-projects-table">
                        <thead>
                            <tr><th>Project</th><th>Dates</th><th>Status</th><th class="num">Quoted</th></tr>
                        </thead>
                        <tbody>${projectRows}</tbody>
                    </table>
                </td>
            </tr>`;
    }

    toggleExpand(id) {
        if (this.expanded.has(id)) {
            this.expanded.delete(id);
        } else {
            this.expanded.add(id);
        }
        this.render();
    }
}

const clientsManager = new ClientsManager();
window.clientsManager = clientsManager;
