/**
 * Shared CRM helpers — formatting, status chips, fetch wrapper.
 */

const CRM = {
    PROJECT_STATUS_LABELS: {
        lead: 'Lead',
        quoted: 'Quoted',
        booked: 'Booked',
        invoiced: 'Invoiced',
        contract_signed: 'Contract Signed',
        paid: 'Paid',
        complete: 'Complete'
    },

    // Dropdown order (no Booked). Filter still uses PROJECT_STATUS_LABELS including Booked.
    PROJECT_STATUS_DROPDOWN: [
        ['lead', 'Lead'],
        ['quoted', 'Quoted'],
        ['invoiced', 'Invoiced'],
        ['contract_signed', 'Contract Signed'],
        ['paid', 'Paid'],
        ['complete', 'Complete']
    ],

    BOOKED_PLUS_STATUSES: ['booked', 'contract_signed', 'invoiced', 'paid', 'complete'],

    isBookedPlus(status) {
        return this.BOOKED_PLUS_STATUSES.includes(status);
    },

    CONTRACT_STATUS_LABELS: {
        none: 'None',
        draft: 'Draft',
        sent: 'Sent',
        signed: 'Signed'
    },

    PAYMENT_METHOD_LABELS: {
        cash: 'Cash',
        check: 'Check',
        etransfer: 'e-Transfer',
        other: 'Other'
    },

    paymentMethodLabel(method) {
        return this.PAYMENT_METHOD_LABELS[method] || '';
    },

    INVOICE_STATUS_LABELS: {
        draft: 'Draft',
        sent: 'Sent',
        partial: 'Partial',
        overdue: 'Overdue',
        paid: 'Paid',
        void: 'Void'
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    },

    escapeJs(text) {
        return String(text ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    },

    money(amount, { cents = true } = {}) {
        const n = Number(amount || 0);
        return `$${n.toLocaleString('en-US', {
            minimumFractionDigits: cents ? 2 : 0,
            maximumFractionDigits: cents ? 2 : 0
        })}`;
    },

    parseYmd(value) {
        if (!value || typeof value !== 'string') return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        if (!m) return null;
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    },

    formatDate(value, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
        const d = this.parseYmd(value) || (value ? new Date(value) : null);
        if (!d || isNaN(d)) return '';
        return d.toLocaleDateString('en-US', opts);
    },

    formatDateRange(start, end) {
        const s = this.formatDate(start);
        const e = this.formatDate(end);
        if (s && e && s !== e) return `${s} – ${e}`;
        return s || e || '—';
    },

    /** Join already-escaped HTML fragments into a mobile-only meta line under a list title. */
    listRowMeta(parts) {
        const items = (parts || []).filter((p) => {
            if (p == null) return false;
            const t = String(p).replace(/<[^>]*>/g, '').trim();
            return t && t !== '—' && t !== '-';
        });
        if (!items.length) return '';
        return `<div class="list-row-meta">${items.join('<span class="list-row-meta-sep">·</span>')}</div>`;
    },

    isPartialAmount(paid, total) {
        const p = Math.round(Number(paid || 0) * 100);
        const t = Math.round(Number(total || 0) * 100);
        return t > 0 && p > 0 && p < t;
    },

    todayYmd() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    ymd(value) {
        if (typeof value !== 'string') return '';
        const due = value.slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '';
    },

    effectiveDueDate(inv) {
        if (!inv) return '';
        if (this.ymd(inv.effectiveDueDate)) return this.ymd(inv.effectiveDueDate);
        const installments = inv.plan?.installments || inv.paymentPlan?.installments || [];
        if (installments.length) {
            const next = installments.find((inst) => inst.status !== 'paid');
            if (!next) return '';
            return this.ymd(next.dueDate);
        }
        return this.ymd(inv.dueDate);
    },

    isInvoiceOverdue(inv) {
        if (!inv || inv.status === 'paid' || inv.status === 'void') return false;
        const paid = Number(inv.amountPaid) || 0;
        const total = Number(inv.total) || 0;
        if (total > 0 && paid >= total) return false;
        const due = this.effectiveDueDate(inv);
        if (!due) return false;
        return due < this.todayYmd();
    },

    invoiceDisplayStatus(inv) {
        if (!inv || typeof inv === 'string') return inv || 'draft';
        if (this.isInvoiceOverdue(inv)) return 'overdue';
        if (inv.status === 'sent' && this.isPartialAmount(inv.amountPaid, inv.total)) return 'partial';
        return inv.status || 'draft';
    },

    projectHasPartialPayment(project, invoices) {
        const summary = project?.invoiceSummary;
        if (summary && Number(summary.totalInvoiced) > 0) {
            return this.isPartialAmount(summary.totalPaid, summary.totalInvoiced);
        }
        const list = invoices || project?.invoices || [];
        let paid = 0;
        let total = 0;
        list.forEach((inv) => {
            if (!inv || inv.status === 'void') return;
            paid += Number(inv.amountPaid) || 0;
            total += Number(inv.total) || 0;
        });
        return this.isPartialAmount(paid, total);
    },

    projectDisplayStatus(project, invoices) {
        if (!project || typeof project === 'string') {
            const status = project || 'lead';
            return { key: status, label: this.PROJECT_STATUS_LABELS[status] || status };
        }
        const status = project.status || 'lead';
        if (status === 'invoiced' && this.projectHasPartialPayment(project, invoices)) {
            return { key: 'partial', label: 'Partial' };
        }
        return { key: status, label: this.PROJECT_STATUS_LABELS[status] || status };
    },

    projectStatusDropdownOptions(currentStatus, display) {
        const options = this.PROJECT_STATUS_DROPDOWN.map(([value, label]) => {
            const text = (value === (currentStatus || 'lead') && display?.key === 'partial')
                ? (display.label || label)
                : label;
            return [value, text];
        });
        if (currentStatus === 'booked') {
            options.splice(2, 0, ['booked', 'Booked']);
        }
        return options;
    },

    projectGroupIcon(role) {
        if (role !== 'primary' && role !== 'member') return '';
        const main = role === 'primary';
        const label = main ? 'Main project' : 'In a project group';
        const svg = main
            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 14.8 8.8 21 9.6 16.4 14 17.6 20.2 12 17.2 6.4 20.2 7.6 14 3 9.6 9.2 8.8 12 3"></polygon></svg>'
            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
        return `<span class="project-group-icon${main ? ' is-main' : ''}" title="${label}">${svg}</span>`;
    },

    projectStatusChip(projectOrStatus, invoices) {
        const { key, label } = this.projectDisplayStatus(projectOrStatus, invoices);
        return `<span class="crm-chip crm-chip--${this.escapeHtml(key || 'lead')}">${this.escapeHtml(label)}</span>`;
    },

    contractStatusChip(status) {
        const label = this.CONTRACT_STATUS_LABELS[status] || status || 'None';
        return `<span class="crm-chip crm-chip--${this.escapeHtml(status || 'none')}">${this.escapeHtml(label)}</span>`;
    },

    invoiceStatusChip(inv) {
        const status = this.invoiceDisplayStatus(inv);
        const label = this.INVOICE_STATUS_LABELS[status] || status;
        return `<span class="crm-chip crm-chip--${this.escapeHtml(status)}">${this.escapeHtml(label)}</span>`;
    },

    async api(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'include',
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
            ...options,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        let data = null;
        try {
            data = await response.json();
        } catch {
            // non-JSON response
        }
        if (!response.ok) {
            throw new Error(data?.error || `Request failed (${response.status})`);
        }
        return data;
    },

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const input = document.createElement('textarea');
            input.value = text;
            document.body.appendChild(input);
            input.select();
            const ok = document.execCommand('copy');
            input.remove();
            return ok;
        }
    },

    async copyHtmlToClipboard(html, text) {
        const plain = text || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (navigator.clipboard?.write && window.ClipboardItem) {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([html], { type: 'text/html' }),
                        'text/plain': new Blob([plain], { type: 'text/plain' })
                    })
                ]);
                return true;
            } catch {
                // fall through to plain text
            }
        }
        return this.copyToClipboard(plain);
    },

    US_STATES: [
        ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
        ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
        ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
        ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
        ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
        ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
        ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
        ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
        ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
        ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
        ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
        ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
        ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming']
    ],

    // Existing projects store one location string ("City, ST" or "Venue, City, ST").
    splitLocation(location) {
        const raw = String(location || '').trim();
        if (!raw) return { city: '', state: '' };
        const comma = raw.lastIndexOf(',');
        const dash = raw.lastIndexOf(' - ');
        const cut = Math.max(comma, dash);
        if (cut < 0) return { city: raw, state: '' };
        const sepLen = cut === dash && dash > comma ? 3 : 1;
        return {
            city: raw.slice(0, cut).trim(),
            state: raw.slice(cut + sepLen).trim()
        };
    },

    composeLocation(city, state) {
        return [String(city || '').trim(), String(state || '').trim()].filter(Boolean).join(', ');
    },

    fillStateSelect(select, selected) {
        if (!select) return;
        const current = String(selected || '').trim();
        const known = this.US_STATES.some(([code, name]) =>
            code.toLowerCase() === current.toLowerCase() || name.toLowerCase() === current.toLowerCase()
        );
        const match = this.US_STATES.find(([code, name]) =>
            code.toLowerCase() === current.toLowerCase() || name.toLowerCase() === current.toLowerCase()
        );
        select.innerHTML = '<option value="">Select state</option>'
            + (current && !known ? `<option value="${this.escapeHtml(current)}">${this.escapeHtml(current)}</option>` : '')
            + this.US_STATES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
        select.value = match ? match[0] : current;
    },

    isUsState(value) {
        const current = String(value || '').trim();
        if (!current) return false;
        return this.US_STATES.some(([code, name]) =>
            code.toLowerCase() === current.toLowerCase() || name.toLowerCase() === current.toLowerCase()
        );
    },

    placeFields(ids) {
        return {
            international: document.getElementById(ids.international),
            city: document.getElementById(ids.city),
            state: document.getElementById(ids.state),
            region: document.getElementById(ids.region),
            stateLabel: document.getElementById(ids.stateLabel),
            required: !!ids.required
        };
    },

    bindPlaceFields(ids) {
        const els = this.placeFields(ids);
        const box = els.international;
        if (box && box.dataset.placeBound !== '1') {
            box.dataset.placeBound = '1';
            box.addEventListener('change', () => this.syncPlaceFields(els));
        }
        this.syncPlaceFields(els);
        return els;
    },

    syncPlaceFields(els) {
        const intl = !!els.international?.checked;
        if (intl && els.region && !els.region.value && els.state?.value && !this.isUsState(els.state.value)) {
            els.region.value = els.state.value;
        }
        if (!intl && els.region?.value && this.isUsState(els.region.value)) {
            this.fillStateSelect(els.state, els.region.value);
        }
        if (els.state) {
            els.state.hidden = intl;
            els.state.disabled = intl;
            if (els.required) els.state.required = !intl;
        }
        if (els.region) {
            els.region.hidden = !intl;
            els.region.disabled = !intl;
            if (els.required) els.region.required = intl;
        }
        if (els.stateLabel) {
            const star = els.required ? ' *' : '';
            els.stateLabel.textContent = intl ? `Region / country${star}` : `State${star}`;
        }
    },

    writePlaceFields(els, city, state) {
        const nextCity = String(city || '').trim();
        const nextState = String(state || '').trim();
        const intl = !!(nextState && !this.isUsState(nextState));
        if (els.city) els.city.value = nextCity;
        if (els.international) els.international.checked = intl;
        this.fillStateSelect(els.state, intl ? '' : nextState);
        if (els.region) els.region.value = intl ? nextState : '';
        this.syncPlaceFields(els);
    },

    readPlaceFields(els) {
        const city = els.city?.value.trim() || '';
        const state = els.international?.checked
            ? (els.region?.value.trim() || '')
            : (els.state?.value.trim() || '');
        return {
            city,
            state,
            location: this.composeLocation(city, state),
            international: !!els.international?.checked
        };
    },

    hotBadge() {
        return `<span class="lead-hot-badge" title="Hot lead" aria-label="Hot lead">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
            </svg>
        </span>`;
    },

    hideContextMenu() {
        document.getElementById('crm-context-menu')?.remove();
        if (this._contextMenuClose) {
            document.removeEventListener('click', this._contextMenuClose);
            document.removeEventListener('contextmenu', this._contextMenuClose);
            document.removeEventListener('keydown', this._contextMenuClose);
            window.removeEventListener('scroll', this._contextMenuClose, true);
            window.removeEventListener('resize', this._contextMenuClose);
            this._contextMenuClose = null;
        }
    },

    showContextMenu(event, items) {
        event.preventDefault();
        event.stopPropagation();
        this.hideContextMenu();
        const menu = document.createElement('div');
        menu.id = 'crm-context-menu';
        menu.className = 'context-menu crm-context-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = items.map((item, index) =>
            `<button type="button" class="context-menu-item" role="menuitem" data-index="${index}">${this.escapeHtml(item.label)}</button>`
        ).join('');
        document.body.appendChild(menu);
        const pad = 8;
        const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - pad);
        const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - pad);
        menu.style.position = 'fixed';
        menu.style.left = `${Math.max(pad, left)}px`;
        menu.style.top = `${Math.max(pad, top)}px`;
        menu.style.zIndex = '2400';
        menu.addEventListener('click', (clickEvent) => {
            const button = clickEvent.target.closest('[data-index]');
            if (!button) return;
            const item = items[Number(button.dataset.index)];
            this.hideContextMenu();
            item?.action?.();
        });
        const close = (closeEvent) => {
            if (closeEvent.type === 'keydown' && closeEvent.key !== 'Escape') return;
            if (closeEvent.type === 'click' && menu.contains(closeEvent.target)) return;
            this.hideContextMenu();
        };
        this._contextMenuClose = close;
        setTimeout(() => {
            document.addEventListener('click', close);
            document.addEventListener('contextmenu', close);
            document.addEventListener('keydown', close);
            window.addEventListener('scroll', close, true);
            window.addEventListener('resize', close);
        }, 0);
    }
};

window.CRM = CRM;
