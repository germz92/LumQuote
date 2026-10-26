/**
 * Invoices list page — all invoices with plan schedule expand.
 */

class InvoicesManager {
    constructor() {
        this.invoices = [];
        this.expanded = new Set();
        this.currentPage = 1;
        this.pageSize = 50;
        this.totalInvoices = 0;
        this.totalPages = 0;
        this.searchDebounceTimer = null;
        this.sortColumn = localStorage.getItem('invoicesSortColumn') || 'createdAt';
        this.sortDirection = localStorage.getItem('invoicesSortDirection') || 'desc';
        const savedWhen = localStorage.getItem('invoicesWhen');
        this.when = ['all', 'upcoming', 'past'].includes(savedWhen) ? savedWhen : 'upcoming';
        this.init();
    }

    async init() {
        this.syncWhenToggle();
        await this.loadInvoices();
        this.render();
        this.updateSortIndicators();
        this.updateClearButton();
    }

    setWhen(when) {
        if (!['all', 'upcoming', 'past'].includes(when) || this.when === when) return;
        this.when = when;
        localStorage.setItem('invoicesWhen', when);
        this.syncWhenToggle();
        this.updateClearButton();
        this.currentPage = 1;
        this.expanded.clear();
        this.loadInvoices().then(() => {
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
            this.sortDirection = column === 'dueDate' || column === 'invoiceNumber' ? 'asc' : 'desc';
        }
        localStorage.setItem('invoicesSortColumn', this.sortColumn);
        localStorage.setItem('invoicesSortDirection', this.sortDirection);
        this.currentPage = 1;
        this.loadInvoices().then(() => {
            this.render();
            this.updateSortIndicators();
        });
    }

    updateSortIndicators() {
        document.querySelectorAll('.invoices-table .sort-indicator').forEach((el) => {
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
        this.expanded.clear();
        this.updateClearButton();
        this.loadInvoices().then(() => {
            this.render();
            this.updateSortIndicators();
        });
    }

    clearFilters() {
        document.getElementById('searchInvoices').value = '';
        document.getElementById('statusFilter').value = '';
        this.applyFilters();
    }

    openMetric(kind) {
        const status = document.getElementById('statusFilter');
        if (!status) return;
        const next = kind === 'collected' ? 'collected' : 'unpaid';
        const already = status.value === next && this.when === 'all';
        if (already) {
            status.value = '';
        } else {
            status.value = next;
            this.when = 'all';
            localStorage.setItem('invoicesWhen', 'all');
            this.syncWhenToggle();
        }
        this.applyFilters();
        document.getElementById('invoicesDataArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    syncMetricCards() {
        const status = document.getElementById('statusFilter')?.value || '';
        document.getElementById('metricCollectedCard')?.classList.toggle('is-active', status === 'collected');
        document.getElementById('metricOpenCard')?.classList.toggle('is-active', status === 'unpaid');
    }

    updateClearButton() {
        const hasFilters = document.getElementById('searchInvoices')?.value ||
            document.getElementById('statusFilter')?.value;
        const btn = document.getElementById('clearFiltersBtn');
        if (btn) btn.style.display = hasFilters ? '' : 'none';
        const drawerActive = !!(document.getElementById('statusFilter')?.value ||
            (this.when && this.when !== 'upcoming'));
        if (window.PageControls) {
            PageControls.syncFilterIndicator('#invoicesPageControls', drawerActive);
        }
        this.syncMetricCards();
    }

    async loadInvoices() {
        try {
            this.showLoading(true);
            const params = new URLSearchParams({
                page: this.currentPage,
                limit: this.pageSize
            });
            const search = document.getElementById('searchInvoices')?.value || '';
            const status = document.getElementById('statusFilter')?.value || '';
            if (search) params.append('search', search);
            if (status) params.append('status', status);
            if (this.when && this.when !== 'all') params.append('when', this.when);
            else if (this.when === 'all') params.append('when', 'all');

            const sortable = ['invoiceNumber', 'status', 'dueDate', 'total', 'amountPaid', 'issueDate', 'createdAt', 'owner'];
            if (sortable.includes(this.sortColumn)) {
                params.append('sortBy', this.sortColumn);
                params.append('sortDir', this.sortDirection === 'asc' ? 'asc' : 'desc');
            }

            const data = await CRM.api(`/api/invoices?${params}`);
            this.invoices = data.invoices || [];
            this.totalInvoices = data.total || 0;
            this.totalPages = data.totalPages || 1;
            this.currentPage = data.page || 1;
            this.renderMetrics(data.summary);
        } catch (error) {
            console.error('Error loading invoices:', error);
            showAlertModal('Error loading invoices. Please try again.', 'error');
            this.invoices = [];
        } finally {
            this.showLoading(false);
        }
    }

    renderMetrics(summary) {
        const collected = document.getElementById('metricCollected');
        const collectedNote = document.getElementById('metricCollectedNote');
        const open = document.getElementById('metricOpen');
        const revenue = document.getElementById('metricRevenue');
        if (!collected || !open || !revenue) return;
        const stats = summary || {};
        collected.textContent = CRM.money(stats.collectedMonth || 0, { cents: false });
        if (collectedNote) collectedNote.textContent = stats.monthLabel || 'This month';
        open.textContent = CRM.money(stats.openBalance || 0, { cents: false });
        const change = stats.rollingChangePercent;
        if (change == null || Number.isNaN(Number(change))) {
            revenue.textContent = '—';
            revenue.className = 'invoice-metric__value';
            return;
        }
        const percent = Math.round(Number(change));
        revenue.textContent = `${percent > 0 ? '+' : ''}${percent}%`;
        revenue.className = `invoice-metric__value ${percent < 0 ? 'invoice-metric__value--down' : 'invoice-metric__value--up'}`;
    }

    showLoading(show) {
        const area = document.getElementById('invoicesDataArea');
        const skeleton = document.getElementById('invoicesSkeleton');
        if (area) area.classList.toggle('is-loading', !!show);
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

    toggleExpand(invoiceId, event) {
        if (event) event.stopPropagation();
        const id = String(invoiceId);
        if (this.expanded.has(id)) {
            this.expanded.delete(id);
        } else {
            this.expanded.clear();
            this.expanded.add(id);
        }
        this.render();
        this.updateSortIndicators();
    }

    openInvoice(projectId, invoiceId) {
        if (!projectId || !invoiceId) return;
        window.location.href = `/projects/${projectId}?invoice=${invoiceId}#invoices`;
    }

    render() {
        const tbody = document.getElementById('invoicesTableBody');
        const empty = document.getElementById('invoicesEmpty');
        if (!tbody) return;

        if (this.invoices.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            this.updateEmptyCopy();
        } else {
            empty.style.display = 'none';
            tbody.innerHTML = this.invoices.map((inv) => this.renderRows(inv)).join('');
        }
        this.renderPagination();
    }

    updateEmptyCopy() {
        const empty = document.getElementById('invoicesEmpty');
        if (!empty) return;
        const search = document.getElementById('searchInvoices')?.value;
        const status = document.getElementById('statusFilter')?.value;
        const h3 = empty.querySelector('h3');
        const p = empty.querySelector('p');
        if (status === 'overdue') {
            h3.textContent = 'No overdue invoices';
            p.textContent = 'Invoices with a balance and a due date before today will show here.';
        } else if (status === 'collected') {
            h3.textContent = 'No collections this month';
            p.textContent = 'Invoices with a payment recorded this month will show here.';
        } else if (status === 'unpaid') {
            h3.textContent = 'No unpaid invoices';
            p.textContent = 'Draft and sent invoices that still have a balance will show here.';
        } else if (search || status) {
            h3.textContent = 'No matching invoices';
            p.textContent = 'Try adjusting your search or filters.';
        } else if (this.when === 'past') {
            h3.textContent = 'No past invoices';
            p.textContent = 'Invoices with a due date before today will show here.';
        } else if (this.when === 'upcoming') {
            h3.textContent = 'No upcoming invoices';
            p.textContent = 'Invoices due today or later (and undated ones) will show here. Switch to All to see everything.';
        } else {
            h3.textContent = 'No invoices yet';
            p.textContent = 'Create an invoice from a project — they will appear here.';
        }
    }

    clientLabel(client) {
        if (!client?.name && !client?.company) {
            return '<span class="crm-inline-note">—</span>';
        }
        const name = client.name || client.company;
        const company = client.company && client.name && client.company !== client.name
            ? ` <span class="crm-inline-note">· ${CRM.escapeHtml(client.company)}</span>`
            : '';
        return `${CRM.escapeHtml(name)}${company}`;
    }

    planSummary(inv) {
        const plan = inv.plan;
        if (!plan) return '<span class="crm-inline-note">—</span>';
        const left = Math.max(0, (plan.total || 0) - (plan.amountPaid || 0));
        const parts = [`${plan.paidCount}/${plan.totalCount} paid`];
        if (left > 0 && inv.status !== 'paid') {
            parts.push(`${CRM.money(left)} left`);
        }
        return `<span class="invoice-plan-summary">${parts.join(' · ')}</span>`;
    }

    renderSchedule(plan) {
        if (!plan?.installments?.length) return '';
        const rows = plan.installments.map((inst) => {
            const paid = inst.status === 'paid';
            const partial = inst.status === 'partial';
            const stripe = paid && inst.paidViaStripe;
            const manualMethods = [...new Set((inst.payments || [])
                .filter((payment) => !payment.paidViaStripe && payment.paymentMethod)
                .map((payment) => payment.paymentMethod))];
            const methodLabel = manualMethods.length === 1 ? CRM.paymentMethodLabel(manualMethods[0]) : '';
            let statusLabel = 'Pending';
            let tone = 'draft';
            let title = '';
            if (partial) {
                statusLabel = 'Partial';
                tone = 'partial';
                title = `${CRM.money(inst.amountReceived || 0)} of ${CRM.money(inst.amount)}`;
            } else if (paid && stripe) {
                statusLabel = 'Stripe';
                tone = 'paid';
                title = 'Paid by the client through the invoice link';
            } else if (paid && methodLabel) {
                statusLabel = methodLabel;
                tone = 'recorded';
                title = (inst.payments || []).map((payment) => payment.paymentNote).filter(Boolean).join(' · ') || 'Marked paid by staff';
            } else if (paid) {
                statusLabel = 'Paid';
                tone = 'recorded';
                title = 'Marked paid by staff';
            }
            const amountCell = partial
                ? `${CRM.money(inst.amountReceived || 0)} <span class="crm-inline-note">/ ${CRM.money(inst.amount)}</span>`
                : CRM.money(inst.amount);
            return `
                <tr>
                    <td class="invoice-plan-col-payment">${CRM.escapeHtml(inst.label || 'Payment')}</td>
                    <td class="invoice-plan-col-due">${CRM.escapeHtml(inst.dueLabel || (inst.dueDate ? CRM.formatDate(inst.dueDate) : '—'))}</td>
                    <td class="invoice-plan-col-amount num">${amountCell}</td>
                    <td class="invoice-plan-col-status">
                        <span class="crm-chip crm-chip--${tone}" ${title ? `title="${CRM.escapeHtml(title)}"` : ''}>${statusLabel}</span>
                    </td>
                </tr>`;
        }).join('');
        return `
            <tr class="invoice-plan-row">
                <td colspan="10">
                    <div class="invoice-plan-panel" onclick="event.stopPropagation()">
                        <div class="invoice-plan-panel-label">Payment schedule</div>
                        <table class="invoice-plan-table">
                            <thead>
                                <tr>
                                    <th class="invoice-plan-col-payment">Payment</th>
                                    <th class="invoice-plan-col-due">Due</th>
                                    <th class="invoice-plan-col-amount num">Amount</th>
                                    <th class="invoice-plan-col-status">Status</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </td>
            </tr>`;
    }

    renderRows(inv) {
        const id = String(inv._id);
        const projectId = inv.project?._id ? String(inv.project._id) : '';
        const hasPlan = !!(inv.plan && inv.plan.installments?.length);
        const isOpen = this.expanded.has(id);
        const dueDate = CRM.effectiveDueDate(inv);
        const due = dueDate
            ? `<span class="${CRM.isInvoiceOverdue(inv) ? 'invoice-due--overdue' : ''}">${CRM.escapeHtml(CRM.formatDate(dueDate))}</span>`
            : '<span class="crm-inline-note">—</span>';

        const caret = hasPlan
            ? `<span class="caret ${isOpen ? 'open' : ''}" onclick="invoicesManager.toggleExpand('${CRM.escapeJs(id)}', event)">▸</span>`
            : '';

        const client = inv.client;
        const clientMeta = client?.name || client?.company
            ? CRM.escapeHtml(client.name || client.company) +
              (client.company && client.name && client.company !== client.name
                  ? ` · ${CRM.escapeHtml(client.company)}`
                  : '')
            : '';
        const projectMeta = inv.project?.name ? CRM.escapeHtml(inv.project.name) : '';
        const dueMeta = dueDate
            ? `${CRM.isInvoiceOverdue(inv) ? 'Overdue' : 'Due'} ${CRM.escapeHtml(CRM.formatDate(dueDate))}`
            : '';
        const paidMeta = `Paid ${CRM.money(inv.amountPaid)}`;
        const plan = inv.plan;
        let planMeta = '';
        if (plan) {
            const left = Math.max(0, (plan.total || 0) - (plan.amountPaid || 0));
            planMeta = `${plan.paidCount}/${plan.totalCount} paid`;
            if (left > 0 && inv.status !== 'paid') {
                planMeta += ` · ${CRM.money(left)} left`;
            }
        }
        const ownerMeta = inv.createdBy?.name ? CRM.escapeHtml(inv.createdBy.name) : '';
        const createdMeta = inv.createdAt ? CRM.escapeHtml(CRM.formatDate(inv.createdAt)) : '';
        const metaHtml = CRM.listRowMeta([
            clientMeta,
            projectMeta,
            dueMeta,
            paidMeta,
            planMeta,
            ownerMeta,
            createdMeta
        ]);
        const projectName = (inv.project?.name || '').trim();
        const subtitle = (inv.subtitle || '').trim();
        const subtitleIsProject = !!(subtitle && projectName && subtitle.toLowerCase() === projectName.toLowerCase());
        let underInvoice = '';
        if (subtitle && !subtitleIsProject) {
            underInvoice += `<br><span class="crm-inline-note">${CRM.escapeHtml(subtitle)}</span>`;
        }
        if (projectId) {
            underInvoice += `<a class="invoice-project-link" href="/projects/${CRM.escapeHtml(projectId)}" onclick="event.stopPropagation()">${CRM.escapeHtml(projectName || 'Project')}</a>`;
        }

        const main = `
            <tr class="invoice-row ${isOpen ? 'is-open' : ''} ${hasPlan ? 'has-plan' : ''}"
                onclick="invoicesManager.openInvoice('${CRM.escapeJs(projectId)}', '${CRM.escapeJs(id)}')">
                <td class="invoice-caret">${caret}</td>
                <td>
                    <div class="list-row-primary">
                        <div>
                            <strong class="invoice-number">${CRM.escapeHtml(inv.invoiceNumber || '')}</strong>
                            ${underInvoice}
                        </div>
                        ${metaHtml}
                    </div>
                </td>
                <td>${CRM.invoiceStatusChip(inv)}</td>
                <td class="col-fold-sm">${this.clientLabel(inv.client)}</td>
                <td class="col-fold-sm">${due}</td>
                <td class="num"><span class="crm-cell-amount">${CRM.money(inv.total)}</span></td>
                <td class="num col-fold-sm">${CRM.money(inv.amountPaid)}</td>
                <td class="col-plan col-fold-sm">${this.planSummary(inv)}</td>
                <td class="col-owner col-hide-sm col-fold-sm">${inv.createdBy?.name
                    ? CRM.escapeHtml(inv.createdBy.name)
                    : '<span class="crm-inline-note">—</span>'}</td>
                <td class="col-created col-hide-sm col-fold-sm">${inv.createdAt
                    ? CRM.escapeHtml(CRM.formatDate(inv.createdAt))
                    : '<span class="crm-inline-note">—</span>'}</td>
            </tr>`;

        if (!isOpen || !hasPlan) return main;
        return main + this.renderSchedule(inv.plan);
    }

    renderPagination() {
        const container = document.getElementById('paginationContainer');
        if (!container) return;
        if (this.totalPages <= 1) {
            container.innerHTML = this.totalInvoices
                ? `<div class="pagination-info">${this.totalInvoices} invoice${this.totalInvoices === 1 ? '' : 's'}</div>`
                : '';
            return;
        }
        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, this.totalInvoices);
        container.innerHTML = `
            <div class="pagination-info">Showing ${startItem}-${endItem} of ${this.totalInvoices} invoices</div>
            <div class="pagination-controls">
                <button type="button" class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} onclick="invoicesManager.goToPage(${this.currentPage - 1})">Prev</button>
                <span class="pagination-current">Page ${this.currentPage} of ${this.totalPages}</span>
                <button type="button" class="pagination-btn" ${this.currentPage === this.totalPages ? 'disabled' : ''} onclick="invoicesManager.goToPage(${this.currentPage + 1})">Next</button>
            </div>`;
    }

    goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) return;
        this.currentPage = page;
        this.expanded.clear();
        this.loadInvoices().then(() => {
            this.render();
            this.updateSortIndicators();
        });
    }
}

const invoicesManager = new InvoicesManager();
