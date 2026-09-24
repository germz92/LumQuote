class ClientPortalPage {
    constructor() {
        this.token = window.location.pathname.split('/').filter(Boolean)[1] || '';
        this.root = document.getElementById('portalApp');
        this.portal = null;
        this.when = 'all';
        this.sort = 'date-desc';
        this.search = '';
        this.load();
    }

    async load() {
        try {
            const response = await fetch(`/api/public/portal/${encodeURIComponent(this.token)}`, {
                credentials: 'same-origin'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                this.renderMessage(data.error || 'This portal link is not available.');
                return;
            }
            if (!data.authenticated) {
                this.renderLogin(data);
                return;
            }
            this.portal = data;
            this.renderPortal();
        } catch (error) {
            this.renderMessage('Could not load this portal.');
        }
    }

    renderMessage(text) {
        this.root.innerHTML = `
            <div class="portal-card">
                ${this.brandHtml()}
                <h1>Portal unavailable</h1>
                <p class="crm-inline-note">${this.escape(text)}</p>
            </div>`;
    }

    renderLogin(data) {
        const who = data.scope === 'company' ? 'company' : 'client';
        this.root.innerHTML = `
            <form class="portal-card" id="portalLoginForm">
                ${this.brandHtml()}
                ${data.logoUrl ? `<img class="portal-company-logo" src="${this.escape(data.logoUrl)}" alt="">` : ''}
                <h1>${this.escape(data.title || 'Client portal')}</h1>
                <p class="crm-inline-note">Enter the password to view this ${who}'s projects, contracts, and invoices.</p>
                <label for="portalPassword">Password</label>
                <input type="password" id="portalPassword" autocomplete="current-password" required>
                <p class="portal-error" id="portalError" hidden></p>
                <button type="submit" class="primary-button" id="portalLoginBtn">View portal</button>
            </form>`;
        document.getElementById('portalLoginForm').addEventListener('submit', (event) => this.login(event));
        document.getElementById('portalPassword').focus();
    }

    async login(event) {
        event.preventDefault();
        const button = document.getElementById('portalLoginBtn');
        const errorEl = document.getElementById('portalError');
        errorEl.hidden = true;
        button.disabled = true;
        try {
            const response = await fetch(`/api/public/portal/${encodeURIComponent(this.token)}/login`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: document.getElementById('portalPassword').value })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Incorrect password.');
            await this.load();
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.hidden = false;
            button.disabled = false;
        }
    }

    invoiceLabel(inv) {
        const paid = Number(inv.amountPaid) || 0;
        const total = Number(inv.total) || 0;
        if (inv.status === 'paid' || (total > 0 && paid >= total)) return 'Paid';
        if (paid > 0) return 'Partial';
        const due = String(inv.dueDate || '');
        const today = new Date();
        const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (due && due < ymd) return 'Overdue';
        return 'Unpaid';
    }

    todayYmd() {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }

    lastDay(project) {
        return project.endDate || project.startDate || '';
    }

    matchesWhen(project) {
        if (this.when === 'all') return true;
        const lastDay = this.lastDay(project);
        const today = this.todayYmd();
        if (this.when === 'past') return !!(lastDay && lastDay < today);
        return !lastDay || lastDay >= today;
    }

    matchesSearch(project) {
        const q = this.search.trim().toLowerCase();
        if (!q) return true;
        const haystack = [
            project.name,
            project.clientName,
            project.clientCompany,
            project.contract?.title,
            ...(project.invoices || []).map((inv) => inv.invoiceNumber)
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
    }

    visibleProjects() {
        const list = (this.portal?.projects || []).filter((project) => this.matchesWhen(project) && this.matchesSearch(project));
        const dir = this.sort.endsWith('asc') ? 1 : -1;
        return list.sort((a, b) => {
            if (this.sort.startsWith('name')) {
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * (this.sort === 'name-asc' ? 1 : -1);
            }
            const aDay = this.lastDay(a) || '';
            const bDay = this.lastDay(b) || '';
            if (!aDay && !bDay) return a.name.localeCompare(b.name);
            if (!aDay) return 1;
            if (!bDay) return -1;
            if (aDay === bDay) return a.name.localeCompare(b.name);
            return aDay < bDay ? -dir : dir;
        });
    }

    renderPortal() {
        const data = this.portal;
        document.title = `${data.title} — Client Portal`;
        this.root.innerHTML = `
            <header class="portal-top">
                <div>
                    ${this.brandHtml()}
                    ${data.logoUrl ? `<img class="portal-company-logo" src="${this.escape(data.logoUrl)}" alt="${this.escape(data.title)}">` : ''}
                    <h1>${this.escape(data.title)}</h1>
                    <p class="crm-inline-note">${this.escape(data.subtitle || (data.scope === 'company' ? 'Company portal' : 'Your projects'))}</p>
                </div>
                <button type="button" class="secondary-button" id="portalLogout">Sign out</button>
            </header>
            <div class="portal-toolbar">
                <input type="search" id="portalSearch" placeholder="Search projects, contracts, invoices" value="${this.escape(this.search)}" aria-label="Search projects">
                <div class="pc-when-toggle" role="group" aria-label="Project timing">
                    <button type="button" class="pc-btn ${this.when === 'all' ? 'is-active' : ''}" data-when="all">All</button>
                    <button type="button" class="pc-btn ${this.when === 'upcoming' ? 'is-active' : ''}" data-when="upcoming">Upcoming</button>
                    <button type="button" class="pc-btn ${this.when === 'past' ? 'is-active' : ''}" data-when="past">Past</button>
                </div>
                <select id="portalSort" aria-label="Sort projects">
                    <option value="date-desc" ${this.sort === 'date-desc' ? 'selected' : ''}>Date, newest</option>
                    <option value="date-asc" ${this.sort === 'date-asc' ? 'selected' : ''}>Date, oldest</option>
                    <option value="name-asc" ${this.sort === 'name-asc' ? 'selected' : ''}>Name, A–Z</option>
                    <option value="name-desc" ${this.sort === 'name-desc' ? 'selected' : ''}>Name, Z–A</option>
                </select>
            </div>
            <div class="portal-grid" id="portalGrid"></div>`;
        document.getElementById('portalLogout').addEventListener('click', () => this.logout());
        document.getElementById('portalSearch').addEventListener('input', (event) => {
            this.search = event.target.value;
            this.renderGrid();
        });
        document.getElementById('portalSort').addEventListener('change', (event) => {
            this.sort = event.target.value;
            this.renderGrid();
        });
        this.root.querySelectorAll('[data-when]').forEach((button) => {
            button.addEventListener('click', () => {
                this.when = button.dataset.when;
                this.root.querySelectorAll('[data-when]').forEach((el) => {
                    el.classList.toggle('is-active', el.dataset.when === this.when);
                });
                this.renderGrid();
            });
        });
        this.renderGrid();
    }

    renderGrid() {
        const grid = document.getElementById('portalGrid');
        if (!grid) return;
        const projects = this.visibleProjects();
        const total = (this.portal?.projects || []).length;
        if (!total) {
            grid.innerHTML = '<div class="portal-card portal-empty"><p class="crm-inline-note">No projects to show yet.</p></div>';
            return;
        }
        if (!projects.length) {
            grid.innerHTML = '<div class="portal-card portal-empty"><p class="crm-inline-note">No projects match this search or filter.</p></div>';
            return;
        }
        grid.innerHTML = projects.map((project) => this.projectCard(project, this.portal.scope)).join('');
    }

    projectCard(project, scope) {
        const dates = CRM.formatDateRange(project.startDate, project.endDate);
        const who = scope === 'company' && project.clientName
            ? `<p class="portal-meta">${this.escape(project.clientName)}</p>`
            : '';
        const contract = project.contract
            ? `<div class="portal-doc">
                <div>
                    <strong>${this.escape(project.contract.title || 'Contract')}</strong>
                    <span class="portal-meta">${this.escape(project.contract.status === 'signed' ? 'Signed' : 'Ready to sign')}</span>
                </div>
                ${this.docLinks(project.contract, 'contract')}
               </div>`
            : '<p class="crm-inline-note">No contract shared yet.</p>';
        const invoices = (project.invoices || []).length
            ? project.invoices.map((inv) => `
                <div class="portal-doc">
                    <div>
                        <strong>${this.escape(inv.invoiceNumber)}</strong>
                        <span class="portal-meta">${this.escape(this.invoiceLabel(inv))} · ${CRM.money(inv.total)}</span>
                    </div>
                    ${inv.url ? `<a class="crm-btn-sm" href="${this.escape(inv.url)}" target="_blank" rel="noopener">View</a>` : ''}
                </div>`).join('')
            : '<p class="crm-inline-note">No invoices shared yet.</p>';
        return `
            <section class="portal-card">
                <div class="portal-card-head">
                    <div>
                        <h2>${this.escape(project.name)}</h2>
                        ${who}
                        <p class="portal-meta">${this.escape(dates || 'Dates not set')}</p>
                    </div>
                    ${CRM.projectStatusChip(project.status)}
                </div>
                <h3>Contract</h3>
                ${contract}
                <h3>Invoices</h3>
                ${invoices}
            </section>`;
    }

    docLinks(contract, kind) {
        const links = [];
        if (contract.url) {
            links.push(`<a class="crm-btn-sm" href="${this.escape(contract.url)}" target="_blank" rel="noopener">${contract.status === 'signed' ? 'View' : 'Sign'}</a>`);
        }
        if (contract.hasFile) {
            links.push(`<a class="crm-btn-sm" href="/api/public/portal/${encodeURIComponent(this.token)}/contracts/${contract.id}/file" target="_blank" rel="noopener">PDF</a>`);
        }
        return links.join('');
    }

    async logout() {
        await fetch(`/api/public/portal/${encodeURIComponent(this.token)}/logout`, {
            method: 'POST',
            credentials: 'same-origin'
        });
        await this.load();
    }

    brandHtml() {
        return `<div class="portal-brand">
            <img src="/assets/lumetry-media-logo.png" alt="Lumetry Media">
            <span>Client Portal</span>
        </div>`;
    }

    escape(value) {
        return CRM.escapeHtml(value ?? '');
    }
}

new ClientPortalPage();
