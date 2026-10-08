class LeadPage {
    constructor() {
        this.lead = null;
        this.users = [];
        this.me = null;
        this.init();
    }

    leadId() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts[0] === 'leads' ? parts[1] : '';
    }

    async init() {
        const id = this.leadId();
        if (!id) {
            window.location.href = '/leads';
            return;
        }
        try {
            await Promise.all([this.loadMe(), this.loadUsers(), this.loadLead(id)]);
            this.render();
        } catch (error) {
            showAlertModal(error.message || 'Failed to load this lead.', 'error');
        }
    }

    async loadMe() {
        const response = await fetch('/api/me', { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        this.me = data.user || null;
    }

    async loadUsers() {
        const response = await fetch('/api/shareable-users', { credentials: 'include' });
        if (!response.ok) return;
        this.users = await response.json();
    }

    async loadLead(id) {
        const response = await fetch(`/api/leads/${encodeURIComponent(id)}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Lead not found');
        this.lead = data.lead;
    }

    isAdmin() {
        return this.me?.role === 'admin';
    }

    canWork() {
        const lead = this.lead;
        if (!lead) return false;
        if (this.isAdmin()) return true;
        return !!(lead.assignedTo && this.me?.id && String(lead.assignedTo._id) === String(this.me.id));
    }

    statusSelect(status) {
        const labels = { lead: 'Lead', assigned: 'Assigned', quoted: 'Quoted', converted: 'Converted', stale: 'Stale', not_converted: 'Not Converted', archived: 'Archived' };
        const current = status || 'lead';
        const options = Object.entries(labels).map(([value, label]) =>
            `<option value="${value}" ${value === current ? 'selected' : ''}>${CRM.escapeHtml(label)}</option>`
        ).join('');
        return `<select class="crm-status-select crm-chip--${CRM.escapeHtml(current)}" onchange="leadPage.changeStatus(this.value)">${options}</select>`;
    }

    render() {
        const lead = this.lead;
        if (!lead) return;
        document.title = `${lead.name} - LumQuote`;
        const pageTitle = document.querySelector('.app-page-title');
        if (pageTitle) pageTitle.textContent = lead.name;

        const submitted = CRM.formatDate(lead.createdAt) || '';
        document.getElementById('leadHeroMeta').innerHTML = `
            ${this.statusSelect(lead.status)}
            <span>Submitted ${CRM.escapeHtml(submitted)}</span>
        `;

        const claim = this.isAdmin() && lead.status === 'lead' && !lead.assignedTo
            ? `<button type="button" class="crm-btn-sm primary" onclick="leadPage.claim()">Claim</button>`
            : '';
        const menu = this.isAdmin()
            ? `<div class="quote-overflow-menu">
                <button type="button" class="quote-overflow-btn" onclick="leadPage.toggleMenu(event)" aria-label="Lead actions" aria-haspopup="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                    </svg>
                </button>
                <div class="quote-overflow-dropdown" style="display: none;">
                    <button type="button" class="overflow-menu-item danger" onclick="leadPage.closeMenu(); leadPage.deleteLead()">Delete</button>
                </div>
               </div>`
            : '';
        document.getElementById('leadHeroActions').innerHTML = `${claim} ${menu}`;

        const assign = this.isAdmin()
            ? `<div class="form-group">
                <label for="leadAssign">Assigned to</label>
                <select id="leadAssign" onchange="leadPage.assign(this.value)">
                    <option value="">Select a user</option>
                    ${this.users.map((user) => `<option value="${CRM.escapeHtml(user._id)}" ${lead.assignedTo && String(lead.assignedTo._id) === String(user._id) ? 'selected' : ''}>${CRM.escapeHtml(user.name)}</option>`).join('')}
                </select>
               </div>`
            : `<div class="form-group"><label>Assigned to</label><p>${CRM.escapeHtml(lead.assignedTo?.name || 'Unassigned')}</p></div>`;

        document.getElementById('leadInquiry').innerHTML = `
            <div class="crm-form-grid">
                <div class="form-group"><label>Name</label><p>${CRM.escapeHtml(lead.name)}</p></div>
                <div class="form-group"><label>Email</label><p><a href="mailto:${CRM.escapeHtml(lead.email)}">${CRM.escapeHtml(lead.email)}</a></p></div>
                <div class="form-group"><label>Phone</label><p><a href="tel:${CRM.escapeHtml(lead.phone)}">${CRM.escapeHtml(lead.phone)}</a></p></div>
                <div class="form-group"><label>Submitted</label><p>${CRM.escapeHtml(submitted)}</p></div>
                <div class="form-group form-group--full"><label>Services</label><p>${CRM.escapeHtml((lead.services || []).join(', ') || '—')}</p></div>
                <div class="form-group form-group--full"><label>How they heard about us</label><p>${CRM.escapeHtml(lead.leadSource || '—')}</p></div>
                <div class="form-group form-group--full"><label>Message</label><p class="lead-message">${CRM.escapeHtml(lead.message || '—')}</p></div>
                ${assign}
            </div>
        `;
        document.getElementById('leadStatusChip').innerHTML = this.statusSelect(lead.status);
        const notes = document.getElementById('leadNotes');
        if (notes && document.activeElement !== notes) notes.value = lead.notes || '';
        this.renderQuote();
        this.renderActivity();
    }

    renderActivity() {
        const panel = document.getElementById('leadActivity');
        if (!panel) return;
        const items = Array.isArray(this.lead.activity) ? this.lead.activity : [];
        if (!items.length) {
            panel.innerHTML = '<p class="crm-inline-note">No activity yet.</p>';
            return;
        }
        panel.innerHTML = `<ul class="lead-activity-list">${items.map((item) => {
            const when = item.at
                ? new Date(item.at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                : '';
            const who = item.actorName ? ` · ${item.actorName}` : '';
            return `<li class="lead-activity-item">
                <div class="lead-activity-text">${CRM.escapeHtml(item.text || '')}</div>
                <div class="lead-activity-meta">${CRM.escapeHtml(`${when}${who}`)}</div>
            </li>`;
        }).join('')}</ul>`;
    }

    renderQuote() {
        const lead = this.lead;
        const panel = document.getElementById('leadQuotePanel');
        const canCreate = this.canWork() && lead.assignedTo && lead.status !== 'lead' && !lead.quote;
        const canSend = this.canWork() && lead.quote;
        let html = '';
        if (this.isAdmin() && (!lead.assignedTo || lead.status === 'lead')) {
            html += `<p>Claim or assign this lead before creating a quote.</p>`;
        } else if (!this.isAdmin() && (!lead.assignedTo || lead.status === 'lead')) {
            html += `<p>A quote is available after this lead is assigned and moved past Lead.</p>`;
        }
        if (lead.quote?.name) {
            html += `<p><strong>${CRM.escapeHtml(lead.quote.name)}</strong></p>`;
            if (lead.quotedAt) {
                html += `<p>Sent ${CRM.escapeHtml(CRM.formatDate(lead.quotedAt) || '')}</p>`;
            }
        } else if (lead.assignedTo && lead.status !== 'lead') {
            html += `<p>No quote yet. The quote builder will start with this lead's name, message, and how they heard about you.</p>`;
        }
        if (lead.project) {
            html += `<p><a href="/projects/${CRM.escapeHtml(String(lead.project))}">View project</a></p>`;
        }
        html += `<div class="crm-actions-row">`;
        if (canCreate) html += `<button type="button" class="primary-button" onclick="leadPage.createQuote()">Create quote</button>`;
        if (lead.quote?.name) html += `<button type="button" class="secondary-button" onclick="leadPage.openQuote()">Open quote</button>`;
        if (canSend) html += `<button type="button" class="primary-button" onclick="leadPage.sendQuote()">Send quote</button>`;
        html += `</div>`;
        panel.innerHTML = html;
    }

    async changeStatus(status) {
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(this.lead._id)}/status`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to update status');
            this.lead = data.lead;
            this.render();
            showToast?.('Status updated', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to update status.', 'error');
            this.render();
        }
    }

    closeMenu() {
        const dropdown = document.querySelector('#leadHeroActions .quote-overflow-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }

    toggleMenu(event) {
        event.stopPropagation();
        const menu = event.target.closest('.quote-overflow-menu');
        const dropdown = menu?.querySelector('.quote-overflow-dropdown');
        if (!dropdown) return;
        const isOpen = dropdown.style.display === 'block';
        this.closeMenu();
        if (isOpen) return;
        dropdown.style.display = 'block';
        const close = (clickEvent) => {
            if (clickEvent.target.closest('.quote-overflow-menu')) return;
            this.closeMenu();
            document.removeEventListener('click', close);
        };
        setTimeout(() => document.addEventListener('click', close), 0);
    }

    async saveNotes() {
        const notes = document.getElementById('leadNotes')?.value ?? '';
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(this.lead._id)}/notes`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to save notes');
            this.lead = data.lead;
            showToast?.('Notes saved', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to save notes.', 'error');
        }
    }

    async deleteLead() {
        const lead = this.lead;
        if (!lead || !this.isAdmin()) return;
        const confirmed = await showConfirmModal(
            `Delete ${lead.name}? This cannot be undone. A linked quote or project is kept.`,
            'Delete lead',
            'Delete',
            'Cancel'
        );
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(lead._id)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to delete lead');
            window.location.href = '/leads';
        } catch (error) {
            showAlertModal(error.message || 'Failed to delete lead.', 'error');
        }
    }

    async claim() {
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(this.lead._id)}/claim`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to claim lead');
            this.lead = data.lead;
            this.render();
            showAlertModal('Lead claimed.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to claim lead.', 'error');
        }
    }

    async assign(userId) {
        if (!userId) return;
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(this.lead._id)}/assign`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to assign lead');
            this.lead = data.lead;
            this.render();
        } catch (error) {
            showAlertModal(error.message || 'Failed to assign lead.', 'error');
            this.render();
        }
    }

    createQuote() {
        const lead = this.lead;
        sessionStorage.setItem('leadQuoteDraft', JSON.stringify({
            leadId: lead._id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            message: lead.message,
            leadSource: lead.leadSource,
            services: lead.services || []
        }));
        window.location.href = '/quote';
    }

    async openQuote() {
        const name = this.lead?.quote?.name;
        if (!name) return;
        const response = await fetch(`/api/load-quote/${encodeURIComponent(name)}`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok) {
            showAlertModal(data.error || 'Failed to open quote.', 'error');
            return;
        }
        sessionStorage.setItem('loadQuoteData', JSON.stringify(data));
        window.location.href = '/quote';
    }

    async sendQuote() {
        const lead = this.lead;
        const confirmed = await showConfirmModal(
            `Email the quote PDF to ${lead.email}?`,
            'Send quote',
            'Send',
            'Cancel'
        );
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/leads/${encodeURIComponent(lead._id)}/send-quote`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to send quote');
            this.lead = data.lead;
            this.render();
            showAlertModal(this.lead.status === 'converted'
                ? 'Quote sent.'
                : 'Quote sent. This lead is marked Quoted.', 'success');
        } catch (error) {
            showAlertModal(error.message || 'Failed to send quote.', 'error');
        }
    }
}

let leadPage;
document.addEventListener('DOMContentLoaded', () => {
    leadPage = new LeadPage();
});
