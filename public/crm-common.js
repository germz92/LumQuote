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

    INVOICE_STATUS_LABELS: {
        draft: 'Draft',
        sent: 'Sent',
        partial: 'Partial',
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

    invoiceDisplayStatus(inv) {
        if (!inv || typeof inv === 'string') return inv || 'draft';
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
    }
};

window.CRM = CRM;
