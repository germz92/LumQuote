/**
 * Project detail page — overview, quotes, contract, invoices.
 */

class ProjectPage {
    constructor() {
        this.projectId = window.location.pathname.split('/')[2];
        this.data = null;
        this.editingInvoice = null;
        this.linkQuoteDebounce = null;
        this.init();
    }

    async init() {
        try {
            await this.load();
        } catch (error) {
            showAlertModal('Could not load this project.', 'error');
            return;
        }
        this.renderAll();
        const params = new URLSearchParams(window.location.search);
        const hash = (window.location.hash || '').replace('#', '');
        const invoiceId = params.get('invoice');
        const tab = params.get('tab') || hash;
        if (invoiceId) {
            this.showTab('invoices');
            try {
                await this.editInvoice(invoiceId);
            } catch (error) {
                console.error('Could not open invoice from deep link:', error);
            }
            // Drop ?invoice= so refresh doesn't re-open the editor
            if (history.replaceState) {
                history.replaceState(null, '', `${window.location.pathname}#invoices`);
            }
        } else if (['overview', 'quotes', 'contract', 'invoices'].includes(tab)) {
            this.showTab(tab);
            if (params.get('tab') && history.replaceState) {
                history.replaceState(null, '', `${window.location.pathname}#${tab}`);
            }
        }
    }

    async load() {
        this.data = await CRM.api(`/api/projects/${this.projectId}`);
    }

    async reload() {
        await this.load();
        this.renderAll();
    }

    // ---------- Tabs ----------

    showTab(tab) {
        document.querySelectorAll('.crm-tab').forEach((el) => {
            el.classList.toggle('is-active', el.dataset.tab === tab);
        });
        document.querySelectorAll('.crm-panel').forEach((el) => {
            el.classList.toggle('is-active', el.id === `panel-${tab}`);
        });
        if (history.replaceState) {
            history.replaceState(null, '', `#${tab}`);
        }
    }

    // ---------- Render ----------

    isCurrentUserAdmin() {
        try {
            return JSON.parse(localStorage.getItem('user') || '{}').role === 'admin';
        } catch {
            return false;
        }
    }

    canEdit() {
        return (this.data?.accessLevel || this.data?.project?.accessLevel) !== 'read';
    }

    canShare() {
        return !!(this.data?.isOwner || this.data?.project?.isOwner || this.isCurrentUserAdmin());
    }

    renderAll() {
        const { project, quotes, invoices } = this.data;

        document.title = `${project.name} - LumQuote`;
        const titleEl = document.querySelector('.app-page-title');
        if (titleEl) titleEl.textContent = project.name;

        const accessLevel = this.data.accessLevel || project.accessLevel || 'full';
        // Share badge only for non-admin users who were shared in (not owners/admins)
        const showSharedBadge = !this.isCurrentUserAdmin()
            && !project.isOwner
            && !this.data.isOwner
            && accessLevel;
        const sharedBadge = showSharedBadge
            ? `<span class="crm-chip ${accessLevel === 'read' ? 'crm-chip--draft' : 'crm-chip--quoted'}" title="Shared with you">${accessLevel === 'read' ? 'Viewer' : 'Editor'}</span>`
            : '';

        const meta = document.getElementById('projectHeroMeta');
        meta.innerHTML = `
            ${CRM.projectStatusChip(project, invoices)}
            ${sharedBadge}
            <span>${CRM.escapeHtml(CRM.formatDateRange(project.startDate, project.endDate))}</span>
            ${project.client ? `<span>· ${CRM.escapeHtml(project.client.name)}</span>` : ''}
        `;
        document.getElementById('projectStatusChip').innerHTML = CRM.projectStatusChip(project, invoices);

        document.getElementById('quotesTabBadge').textContent = quotes.length;
        document.getElementById('invoicesTabBadge').textContent = invoices.length;

        this.fillOverviewForms();
        this.renderActivity();
        this.renderQuotes();
        this.renderContract();
        this.renderInvoices();
        this.applyAccessUi();
    }

    applyAccessUi() {
        const editable = this.canEdit();
        const shareable = this.canShare();
        const shareBtn = document.getElementById('shareProjectBtn');
        const saveBtn = document.getElementById('saveProjectBtn');
        const saveNotesBtn = document.getElementById('saveNotesBtn');
        const transferBtn = document.getElementById('transferLumDashBtn');
        const note = document.getElementById('projectSaveNote');
        const clientNote = document.getElementById('clientSaveNote');
        const notesNote = document.getElementById('notesSaveNote');

        if (shareBtn) shareBtn.style.display = shareable ? '' : 'none';
        if (saveBtn) saveBtn.style.display = editable ? '' : 'none';
        const sendNowBtn = document.getElementById('sendNowBtn');
        if (sendNowBtn) sendNowBtn.style.display = editable ? '' : 'none';
        if (saveNotesBtn) saveNotesBtn.style.display = editable ? '' : 'none';
        if (transferBtn) transferBtn.style.display = editable ? '' : 'none';
        if (note) {
            note.textContent = editable ? '' : 'You have read-only access to this project.';
        }
        if (clientNote && !editable) {
            clientNote.textContent = 'Read-only access';
        }
        if (notesNote) {
            notesNote.textContent = editable ? '' : 'Read-only access';
        }

        document.querySelectorAll('#panel-overview input, #panel-overview select, #panel-overview textarea').forEach((el) => {
            el.disabled = !editable;
        });

        // Hide mutate actions; keep view/copy/download/open/pdf.
        const keepText = /^(open|copy|copied!|pdf|download)/i;
        document.querySelectorAll(
            '#panel-overview .primary-button, #panel-overview .secondary-button, #panel-quotes .primary-button, #panel-quotes .secondary-button, #panel-quotes .crm-btn-sm, #panel-quotes a.crm-btn-sm, #panel-contract .primary-button, #panel-contract .secondary-button, #panel-contract .crm-btn-sm, #panel-contract a.primary-button, #panel-invoices .primary-button, #panel-invoices .secondary-button, #panel-invoices .crm-btn-sm, #panel-invoices a.crm-btn-sm'
        ).forEach((el) => {
            if (el.id === 'shareProjectBtn') return;
            const label = (el.textContent || '').trim();
            if (!editable && keepText.test(label)) {
                el.style.display = '';
                return;
            }
            el.style.display = editable ? '' : 'none';
        });
    }

    fillOverviewForms() {
        const { project } = this.data;
        document.getElementById('projName').value = project.name || '';
        const statusSelect = document.getElementById('projStatus');
        // Booked is not offered as a new choice; keep it visible only for existing booked projects
        let bookedOpt = statusSelect.querySelector('option[value="booked"]');
        if ((project.status || '') === 'booked') {
            if (!bookedOpt) {
                bookedOpt = document.createElement('option');
                bookedOpt.value = 'booked';
                bookedOpt.textContent = 'Booked';
                const quotedOpt = statusSelect.querySelector('option[value="quoted"]');
                if (quotedOpt?.nextSibling) {
                    statusSelect.insertBefore(bookedOpt, quotedOpt.nextSibling);
                } else {
                    statusSelect.appendChild(bookedOpt);
                }
            }
        } else if (bookedOpt) {
            bookedOpt.remove();
        }
        statusSelect.value = project.status || 'lead';
        const invoicedOpt = statusSelect.querySelector('option[value="invoiced"]');
        if (invoicedOpt) {
            const display = CRM.projectDisplayStatus(project, this.data.invoices);
            invoicedOpt.textContent = display.key === 'partial' ? 'Partial' : 'Invoiced';
        }
        document.getElementById('projStart').value = project.startDate || '';
        document.getElementById('projEnd').value = project.endDate || '';
        document.getElementById('projNotes').value = project.notes || '';
        const quoteLeadSource = (this.data.quotes || []).find((q) => q.leadSource)?.leadSource || '';
        if (window.LeadSources) {
            LeadSources.setLeadSourceFormValue(project.leadSource || quoteLeadSource);
        }

        const client = project.client || {};
        const address = client.address || {};
        document.getElementById('clientName').value = client.name || '';
        document.getElementById('clientCompany').value = client.company || '';
        document.getElementById('clientEmail').value = client.email || '';
        document.getElementById('clientPhone').value = client.phone || '';
        document.getElementById('clientStreet').value = address.street || '';
        document.getElementById('clientCity').value = address.city || '';
        document.getElementById('clientState').value = address.state || '';
        document.getElementById('clientZip').value = address.zip || '';
    }

    // ---------- Overview actions ----------

    formatActivityWhen(value) {
        if (!value) return '';
        const date = new Date(value);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    emailLogLabel(type, docKind) {
        const labels = {
            sent_link: docKind === 'invoice' ? 'Invoice emailed' : 'Contract emailed',
            sent_bundle: 'Contract and invoice emailed',
            signed_copy: 'Signed copy emailed',
            copy_request: docKind === 'invoice' ? 'Invoice copy emailed' : 'Contract copy emailed',
            receipt: 'Payment receipt emailed',
            receipt_installment: 'Installment receipt emailed',
            owner_signed: 'Staff notified — contract signed',
            owner_paid: 'Staff notified — invoice paid',
            owner_paid_installment: 'Staff notified — installment paid'
        };
        return labels[type] || (docKind === 'invoice' ? `Invoice email (${type})` : `Contract email (${type})`);
    }

    pushActivity(events, at, title, detail = '') {
        if (!at) return;
        const when = new Date(at);
        if (isNaN(when.getTime())) return;
        events.push({ at: when.getTime(), title, detail });
    }

    appendEmailLogActivity(events, emailLog, docKind, docLabel) {
        (emailLog || []).forEach((entry) => {
            const to = Array.isArray(entry.to) ? entry.to.filter(Boolean).join(', ') : '';
            const baseDetail = [docLabel, to ? `to ${to}` : ''].filter(Boolean).join(' · ');
            this.pushActivity(events, entry.sentAt, this.emailLogLabel(entry.type, docKind), baseDetail);
            if (entry.openedAt) {
                const opens = entry.openCount > 1 ? ` · ${entry.openCount} opens` : '';
                this.pushActivity(
                    events,
                    entry.openedAt,
                    'Email opened',
                    `${this.emailLogLabel(entry.type, docKind)}${opens}`
                );
            }
        });
    }

    buildActivityEvents() {
        const events = [];
        const { project, contract, invoices } = this.data || {};

        if (project?.createdAt) {
            this.pushActivity(events, project.createdAt, 'Project created');
        }

        if (contract) {
            const contractLabel = contract.title || 'Contract';
            this.pushActivity(events, contract.sentAt, 'Contract sent', contractLabel);
            if (contract.firstViewedAt) {
                const views = contract.viewCount > 1 ? `${contract.viewCount} views` : '1 view';
                this.pushActivity(events, contract.firstViewedAt, 'Contract page viewed', views);
            }
            if (contract.signature?.signedAt) {
                if (contract.source === 'external' || contract.signature.method === 'external') {
                    this.pushActivity(
                        events,
                        contract.signature.signedAt,
                        'External contract uploaded',
                        contract.uploadedFile?.filename || contractLabel
                    );
                } else {
                    const signer = contract.signature.name ? `by ${contract.signature.name}` : '';
                    this.pushActivity(events, contract.signature.signedAt, 'Contract signed', signer);
                }
            }
            if (contract.countersignature?.signedAt) {
                const signer = contract.countersignature.name ? `by ${contract.countersignature.name}` : '';
                this.pushActivity(events, contract.countersignature.signedAt, 'Contract countersigned', signer);
            }
            this.appendEmailLogActivity(events, contract.emailLog, 'contract', contractLabel);
        }

        (invoices || []).forEach((invoice) => {
            if (!invoice || invoice.status === 'void') return;
            const invLabel = invoice.invoiceNumber || 'Invoice';
            this.pushActivity(events, invoice.sentAt, 'Invoice sent', invLabel);
            if (invoice.firstViewedAt) {
                const views = invoice.viewCount > 1 ? `${invoice.viewCount} views` : '1 view';
                this.pushActivity(events, invoice.firstViewedAt, 'Invoice page viewed', `${invLabel} · ${views}`);
            }
            (invoice.paymentPlan?.installments || []).forEach((inst, index) => {
                if (inst?.paidAt) {
                    this.pushActivity(
                        events,
                        inst.paidAt,
                        'Installment paid',
                        `${invLabel} · ${inst.label || `Payment ${index + 1}`}`
                    );
                }
            });
            if (invoice.paidAt) {
                this.pushActivity(events, invoice.paidAt, 'Invoice paid', invLabel);
            }
            this.appendEmailLogActivity(events, invoice.emailLog, 'invoice', invLabel);
        });

        events.sort((a, b) => b.at - a.at);
        return events;
    }

    renderActivity() {
        const list = document.getElementById('projectActivityList');
        if (!list) return;
        const events = this.buildActivityEvents();
        if (!events.length) {
            list.innerHTML = '<p class="crm-inline-note" style="margin:0">No activity yet.</p>';
            return;
        }
        list.innerHTML = events.map((event) => `
            <div class="crm-activity-item">
                <div class="crm-activity-item-main">
                    <span class="crm-activity-title">${CRM.escapeHtml(event.title)}</span>
                    ${event.detail ? `<span class="crm-activity-detail">${CRM.escapeHtml(event.detail)}</span>` : ''}
                </div>
                <time class="crm-activity-when">${CRM.escapeHtml(this.formatActivityWhen(event.at))}</time>
            </div>
        `).join('');
    }

    async saveNotes() {
        try {
            await CRM.api(`/api/projects/${this.projectId}`, {
                method: 'PUT',
                body: { notes: document.getElementById('projNotes').value }
            });
            if (this.data?.project) this.data.project.notes = document.getElementById('projNotes').value;
            const note = document.getElementById('notesSaveNote');
            if (note) {
                note.textContent = 'Saved.';
                setTimeout(() => {
                    if (note.textContent === 'Saved.') note.textContent = '';
                }, 2000);
            }
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    sendNowPlan() {
        const { project, quotes = [], contract, invoices = [] } = this.data || {};
        const email = String(project?.client?.email || '').trim();
        const billable = invoices.filter((inv) => inv && inv.status !== 'void');
        const needsContract = !contract;
        const needsInvoice = billable.length === 0;
        const quote = quotes.length === 1 ? quotes[0] : null;
        const quoteLabel = quote ? this.quoteTitle(quote) : '';

        if (!email) {
            return { error: 'Add a client email on this project first.' };
        }
        if (billable.length > 1) {
            return { error: 'This project has more than one invoice. Send the one you want from the Invoices tab.' };
        }
        if ((needsContract || needsInvoice) && quotes.length !== 1) {
            return {
                error: quotes.length === 0
                    ? 'Link exactly one quote to this project before Send It! can generate a contract or invoice.'
                    : 'This project has more than one quote. Generate the contract and invoice from the right quote first, then use Send It!'
            };
        }

        const contractAction = needsContract
            ? 'generate'
            : (contract.status === 'signed' ? 'skip' : 'send');
        const invoiceAction = needsInvoice
            ? 'create'
            : (billable[0].status === 'paid' ? 'skip' : 'send');

        if (contractAction === 'skip' && invoiceAction === 'skip') {
            return { error: 'Nothing to send. The contract is already signed and the invoice is already paid.' };
        }

        const clientName = String(project?.client?.name || '').trim();
        const who = clientName
            ? `${CRM.escapeHtml(clientName)} (${CRM.escapeHtml(email)})`
            : CRM.escapeHtml(email);
        const quoteHtml = quoteLabel ? `“${CRM.escapeHtml(quoteLabel)}”` : 'the quote';

        let contractDetail;
        let contractSkip = false;
        if (contractAction === 'generate') {
            contractDetail = `Create it from ${quoteHtml} and email the signing link.`;
        } else if (contractAction === 'send') {
            contractDetail = 'Email the existing signing link.';
        } else {
            contractDetail = 'Already signed — won’t send again.';
            contractSkip = true;
        }

        let invoiceDetail;
        let invoiceSkip = false;
        if (invoiceAction === 'create') {
            invoiceDetail = `Create it from ${quoteHtml} and email it. Due in full, no deposit plan.`;
        } else if (invoiceAction === 'send') {
            invoiceDetail = `Email ${CRM.escapeHtml(billable[0].invoiceNumber)}.`;
        } else {
            invoiceDetail = `${CRM.escapeHtml(billable[0].invoiceNumber)} is already paid — won’t send again.`;
            invoiceSkip = true;
        }

        const html = `
            <div class="send-it-copy">
                <p>This sends <strong>one email</strong> to <strong>${who}</strong> with the contract and invoice.</p>
                <ul>
                    <li class="${contractSkip ? 'is-skip' : ''}"><span class="send-it-label">Contract</span>${contractDetail}</li>
                    <li class="${invoiceSkip ? 'is-skip' : ''}"><span class="send-it-label">Invoice</span>${invoiceDetail}</li>
                </ul>
            </div>`;

        return { email, html };
    }

    async sendNow() {
        const plan = this.sendNowPlan();
        if (plan.error) {
            showAlertModal(plan.error, 'error');
            return;
        }
        const confirmed = await showConfirmModal(plan.html, 'Send It!', 'Send It!', 'Cancel', true);
        if (!confirmed) return;

        const button = document.getElementById('sendNowBtn');
        const original = button ? button.textContent : '';
        if (button) {
            button.disabled = true;
            button.textContent = 'Sending...';
        }
        try {
            const result = await CRM.api(`/api/projects/${this.projectId}/send-now`, { method: 'POST' });
            await this.reload();
            this.renderAll();
            const emailedTo = (result.emailedTo || [plan.email]).join(', ');
            showAlertModal(
                `Sent one email to ${emailedTo} with the contract and invoice.`,
                'success',
                'Send It!'
            );
        } catch (error) {
            showAlertModal(error.message, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = original || 'Send It!';
            }
        }
    }

    async saveProject() {
        const previousStatus = this.data?.project?.status || 'lead';
        const nextStatus = document.getElementById('projStatus').value;
        const leadSourceError = window.LeadSources
            ? LeadSources.validateLeadSourceForm({ required: false })
            : null;
        if (leadSourceError) {
            showAlertModal(leadSourceError, 'error');
            return;
        }
        const leadSource = window.LeadSources
            ? LeadSources.getLeadSourceFromForm()
            : (document.getElementById('leadSource')?.value || '').trim();
        try {
            await CRM.api(`/api/projects/${this.projectId}`, {
                method: 'PUT',
                body: {
                    name: document.getElementById('projName').value.trim(),
                    status: nextStatus,
                    startDate: document.getElementById('projStart').value || null,
                    endDate: document.getElementById('projEnd').value || null,
                    notes: document.getElementById('projNotes').value,
                    leadSource: leadSource || null
                }
            });
            showAlertModal('Project saved.', 'success', null, true);
            await this.reload();
            if (nextStatus === 'booked' && window.LumDashIntegration?.onProjectMarkedAsBooked) {
                await window.LumDashIntegration.onProjectMarkedAsBooked(this.projectId, previousStatus);
            }
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async transferToLumDash() {
        if (!window.LumDashIntegration?.transferProjectToLumDash) {
            showAlertModal('LumDash integration is not available.', 'error');
            return;
        }
        try {
            await window.LumDashIntegration.transferProjectToLumDash(this.projectId);
        } catch (error) {
            showAlertModal(error.message || 'Failed to transfer to LumDash.', 'error');
        }
    }

    // ---------- Share ----------

    async openShareModal() {
        if (!this.canShare()) {
            showAlertModal('Only the owner can manage sharing.', 'error');
            return;
        }
        const project = this.data?.project;
        document.getElementById('shareProjectName').textContent = `"${project?.name || 'Project'}"`;
        document.getElementById('shareProjectUserSearch').value = '';
        document.getElementById('selectedShareProjectUserId').value = '';
        document.getElementById('selectedShareProjectUserName').textContent = '';
        document.querySelector('input[name="projectAccessLevel"][value="read"]').checked = true;
        await this.loadShareableUsers();
        await this.loadSharedUsers();
        document.getElementById('shareProjectModal').style.display = 'flex';
        this.setupShareUserSearch();
    }

    closeShareModal() {
        document.getElementById('shareProjectModal').style.display = 'none';
        document.getElementById('shareProjectUserDropdown').style.display = 'none';
    }

    async loadShareableUsers() {
        try {
            const response = await fetch('/api/shareable-users', { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to load users');
            this.shareableUsers = await response.json();
        } catch (error) {
            console.error(error);
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
            if (!e.target.closest('.share-user-dropdown')) dropdown.style.display = 'none';
        });
    }

    renderShareUserDropdown(searchTerm) {
        const dropdown = document.getElementById('shareProjectUserDropdown');
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const filtered = (this.shareableUsers || []).filter((user) =>
            user.name.toLowerCase().includes((searchTerm || '').toLowerCase())
            && user.name !== currentUser.name
        );
        if (!filtered.length) {
            dropdown.innerHTML = '<div class="share-user-item no-results">No users found</div>';
            return;
        }
        dropdown.innerHTML = filtered.map((user) => `
            <div class="share-user-item" onclick="projectPage.selectShareUser('${user._id}', '${CRM.escapeJs(user.name)}')">
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
            const result = await CRM.api(`/api/projects/${this.projectId}/share`, {
                method: 'POST',
                body: { userId, accessLevel }
            });
            document.getElementById('selectedShareProjectUserId').value = '';
            document.getElementById('selectedShareProjectUserName').textContent = '';
            document.getElementById('shareProjectUserSearch').value = '';
            await this.loadSharedUsers();
            showAlertModal(result.message || 'Project shared successfully!', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to share project', 'error');
        }
    }

    async loadSharedUsers() {
        const container = document.getElementById('sharedProjectUsersList');
        try {
            const sharedUsers = await CRM.api(`/api/projects/${this.projectId}/shared-with`);
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
                    <button class="remove-share-btn" onclick="projectPage.removeShare('${share.user?._id}')" title="Remove access">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `).join('');
        } catch (error) {
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
            await CRM.api(`/api/projects/${this.projectId}/share/${userId}`, { method: 'DELETE' });
            await this.loadSharedUsers();
            showAlertModal('Share access removed.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to remove access', 'error');
        }
    }

    async saveClient() {
        const name = document.getElementById('clientName').value.trim();
        if (!name) {
            showAlertModal('Client name is required.', 'error');
            return;
        }
        const body = {
            name,
            company: document.getElementById('clientCompany').value.trim(),
            email: document.getElementById('clientEmail').value.trim(),
            phone: document.getElementById('clientPhone').value.trim(),
            address: {
                street: document.getElementById('clientStreet').value.trim(),
                city: document.getElementById('clientCity').value.trim(),
                state: document.getElementById('clientState').value.trim(),
                zip: document.getElementById('clientZip').value.trim()
            }
        };
        try {
            const existing = this.data.project.client;
            if (existing) {
                await CRM.api(`/api/crm/clients/${existing._id}`, { method: 'PUT', body });
            } else {
                const client = await CRM.api('/api/crm/clients', { method: 'POST', body });
                await CRM.api(`/api/projects/${this.projectId}`, { method: 'PUT', body: { clientId: client._id } });
            }
            showAlertModal('Client saved.', 'success', null, true);
            await this.reload();
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    // ---------- Quotes tab ----------

    quoteTitle(quote) {
        return quote.quoteData?.quoteTitle || quote.name;
    }

    quoteServiceDate(quote) {
        const dates = (quote.quoteData?.days || []).map((d) => d.date).filter(Boolean).sort();
        if (dates.length === 0) return '—';
        return CRM.formatDateRange(dates[0], dates[dates.length - 1]);
    }

    quoteHasInvoice(quote) {
        const quoteId = quote?._id != null ? String(quote._id) : '';
        if (!quoteId) return false;
        return (this.data?.invoices || []).some((inv) => {
            if (!inv || inv.status === 'void') return false;
            const source = inv.sourceQuote;
            const sourceId = source && typeof source === 'object' ? source._id : source;
            return sourceId != null && String(sourceId) === quoteId;
        });
    }

    renderQuotes() {
        const area = document.getElementById('quotesListArea');
        const { quotes } = this.data;
        if (quotes.length === 0) {
            area.innerHTML = `<div class="crm-empty"><p>No quotes linked to this project yet.</p></div>`;
            return;
        }
        area.innerHTML = `
            <div class="crm-table-scroll">
            <table class="crm-table">
                <thead><tr>
                    <th>Quote</th>
                    <th class="col-fold-sm">Location</th>
                    <th class="col-fold-sm">Service Date</th>
                    <th class="num">Total</th>
                    <th></th>
                </tr></thead>
                <tbody>
                    ${quotes.map((q) => {
                        const location = q.location || '';
                        const serviceDate = this.quoteServiceDate(q);
                        const metaHtml = CRM.listRowMeta([
                            location ? CRM.escapeHtml(location) : '',
                            serviceDate && serviceDate !== '—' ? CRM.escapeHtml(serviceDate) : ''
                        ]);
                        const hasInvoice = this.quoteHasInvoice(q);
                        const invoiceLabel = hasInvoice ? 'Invoice' : 'Create Invoice';
                        return `
                        <tr>
                            <td>
                                <div class="list-row-primary">
                                    <strong>${CRM.escapeHtml(this.quoteTitle(q))}</strong>
                                    ${metaHtml}
                                </div>
                            </td>
                            <td class="col-fold-sm">${CRM.escapeHtml(q.location || '—')}</td>
                            <td class="col-fold-sm">${CRM.escapeHtml(serviceDate)}</td>
                            <td class="num">${CRM.money(q.quoteData?.total || 0, { cents: false })}</td>
                            <td>
                                <div class="crm-row-actions">
                                    <button class="crm-btn-sm primary" onclick="projectPage.openQuote('${CRM.escapeJs(q.name)}')">Open</button>
                                    <button class="crm-btn-sm" onclick="projectPage.invoiceFromQuote('${CRM.escapeJs(q.name)}')">${invoiceLabel}</button>
                                    <button class="crm-btn-sm danger" onclick="projectPage.unlinkQuote('${CRM.escapeJs(q.name)}')">Unlink</button>
                                </div>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    }

    async openQuote(quoteName) {
        try {
            const quoteData = await CRM.api(`/api/load-quote/${encodeURIComponent(quoteName)}`);
            sessionStorage.setItem('loadQuoteData', JSON.stringify(quoteData));
            window.location.href = '/quote';
        } catch (error) {
            showAlertModal('Failed to open quote.', 'error');
        }
    }

    openInvoiceInQuoteEditor(invoiceId) {
        const inv = this.editingInvoice;
        if (!inv || String(inv._id) !== String(invoiceId)) {
            showAlertModal('Open the invoice editor first.', 'error');
            return;
        }
        if (inv.status === 'paid' || inv.status === 'void') {
            showAlertModal('Paid and void invoices cannot be edited in the quote editor.', 'error');
            return;
        }
        sessionStorage.removeItem('loadQuoteData');
        sessionStorage.removeItem('lumquote_start_new');
        sessionStorage.setItem('invoiceEditorSession', JSON.stringify({
            invoiceId: inv._id,
            projectId: this.projectId,
            invoiceNumber: inv.invoiceNumber,
            returnUrl: `/projects/${this.projectId}?invoice=${encodeURIComponent(inv._id)}`
        }));
        window.location.href = '/quote';
    }

    async unlinkQuote(quoteName) {
        const confirmed = await showConfirmModal(`Remove "${quoteName}" from this project? The quote itself is kept.`, 'Unlink Quote', 'Unlink');
        if (!confirmed) return;
        try {
            await CRM.api(`/api/projects/${this.projectId}/unlink-quote`, { method: 'POST', body: { quoteName } });
            await this.reload();
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    openLinkQuoteModal() {
        document.getElementById('linkQuoteModal').style.display = 'flex';
        document.getElementById('linkQuoteSearch').value = '';
        this.searchLinkableQuotes();
    }

    closeLinkQuoteModal() {
        document.getElementById('linkQuoteModal').style.display = 'none';
    }

    searchLinkableQuotes() {
        clearTimeout(this.linkQuoteDebounce);
        this.linkQuoteDebounce = setTimeout(async () => {
            const container = document.getElementById('linkQuoteResults');
            container.innerHTML = '<div class="crm-loading">Searching…</div>';
            try {
                const search = document.getElementById('linkQuoteSearch').value;
                const params = new URLSearchParams({ page: 1, limit: 20, archived: false });
                if (search) params.append('search', search);
                const data = await CRM.api(`/api/saved-quotes?${params}`);
                const linkedNames = new Set(this.data.quotes.map((q) => q.name));
                const candidates = (data.quotes || []).filter((q) => !linkedNames.has(q.name));
                if (candidates.length === 0) {
                    container.innerHTML = '<div class="crm-empty"><p>No matching quotes found.</p></div>';
                    return;
                }
                container.innerHTML = candidates.map((q) => `
                    <div class="template-list-item">
                        <div>
                            <strong>${CRM.escapeHtml(this.quoteTitle(q))}</strong>
                            <div class="template-meta">${CRM.escapeHtml([q.clientName, q.clientCompany].filter(Boolean).join(' · ') || 'No client')} · ${CRM.money(q.quoteData?.total || 0, { cents: false })}${q.project ? ' · linked to another project' : ''}</div>
                        </div>
                        <button class="crm-btn-sm primary" onclick="projectPage.linkQuote('${CRM.escapeJs(q.name)}')">Link</button>
                    </div>`).join('');
            } catch (error) {
                container.innerHTML = `<div class="crm-empty"><p>${CRM.escapeHtml(error.message)}</p></div>`;
            }
        }, 250);
    }

    async linkQuote(quoteName) {
        try {
            await CRM.api(`/api/projects/${this.projectId}/link-quote`, { method: 'POST', body: { quoteName } });
            this.closeLinkQuoteModal();
            showAlertModal('Quote linked to project.', 'success', null, true);
            await this.reload();
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    // ---------- Contract tab ----------

    renderContract() {
        const area = document.getElementById('contractArea');
        const contract = this.data.contract;

        if (!contract) {
            area.innerHTML = `
                <div class="crm-card">
                    <h3>Create a Contract</h3>
                    <p class="crm-inline-note" style="margin-bottom:16px">
                        Generate a contract from a quote's services using your template library, or upload an unsigned PDF to send for signature in LumQuote.
                    </p>
                    <div class="crm-actions-row">
                        <button class="primary-button" onclick="projectPage.openGenerateContractModal()">Generate from Quote</button>
                        <button class="secondary-button" onclick="document.getElementById('contractFileInput').click()">Upload Contract PDF</button>
                        <input type="file" id="contractFileInput" accept="application/pdf" hidden onchange="projectPage.uploadContract(this.files[0])">
                    </div>
                </div>
                <div class="crm-card">
                    <h3>Signed outside LumQuote</h3>
                    <p class="crm-inline-note" style="margin-bottom:16px">
                        Already created, signed, and processed elsewhere? File the finished PDF here. It is stored as signed and will not go through LumQuote e-sign.
                    </p>
                    <div class="crm-actions-row">
                        <button class="secondary-button" onclick="document.getElementById('externalContractFileInput').click()">Upload signed PDF</button>
                        <input type="file" id="externalContractFileInput" accept="application/pdf" hidden onchange="projectPage.uploadExternalContract(this.files[0])">
                    </div>
                </div>`;
            return;
        }

        if (contract.source === 'external') {
            const signedAt = contract.signature?.signedAt
                ? new Date(contract.signature.signedAt).toLocaleString('en-US')
                : '';
            area.innerHTML = `
                <div class="crm-card">
                    <div class="crm-card-header">
                        <h3>${CRM.escapeHtml(contract.title || 'Contract')}</h3>
                        ${CRM.contractStatusChip(contract.status)}
                    </div>
                    <p class="crm-inline-note" style="margin-bottom:16px">
                        Filed as signed outside LumQuote${signedAt ? ` on ${signedAt}` : ''}.
                    </p>
                    <div class="contract-file-box">
                        <span>📄 ${CRM.escapeHtml(contract.uploadedFile?.filename || 'contract.pdf')}</span>
                        <a class="crm-btn-sm" href="/api/contracts/${contract._id}/file" target="_blank">View</a>
                    </div>
                    <div class="crm-actions-row">
                        <button class="secondary-button" onclick="document.getElementById('externalContractFileInput').click()">Replace PDF</button>
                        <input type="file" id="externalContractFileInput" accept="application/pdf" hidden onchange="projectPage.uploadExternalContract(this.files[0])">
                        <button class="crm-btn-sm danger" onclick="projectPage.deleteContract()">Delete</button>
                    </div>
                </div>`;
            return;
        }

        const isSigned = contract.status === 'signed';
        const sig = contract.signature || {};

        const statusRow = `
            <div class="crm-card-header">
                <h3>${CRM.escapeHtml(contract.title || 'Contract')}</h3>
                ${CRM.contractStatusChip(contract.status)}
            </div>`;

        const linkRow = contract.publicToken ? `
            <div class="invoice-share-link" style="margin-bottom:16px">
                <span id="contractLinkText">${CRM.escapeHtml(`${window.location.origin}/sign/${contract.publicToken}`)}</span>
                <button class="crm-btn-sm" onclick="projectPage.copyLink('${CRM.escapeJs(`${window.location.origin}/sign/${contract.publicToken}`)}', this)">Copy</button>
                <a class="crm-btn-sm" href="/sign/${CRM.escapeHtml(contract.publicToken)}" target="_blank" rel="noopener noreferrer">Open</a>
            </div>
            ${this.docTrackingHtml(contract)}` : '';

        const signedBlock = isSigned ? `
            <div class="crm-card" style="border-color: var(--color-success);">
                <h3>Signed</h3>
                <p class="crm-inline-note">
                    Signed by <strong>${CRM.escapeHtml(sig.name || '')}</strong> (${sig.method === 'drawn' ? 'drawn' : 'typed'} signature)
                    on ${sig.signedAt ? new Date(sig.signedAt).toLocaleString('en-US') : ''}<br>
                    IP: ${CRM.escapeHtml(sig.ip || 'n/a')}<br>
                    Document SHA-256: <code style="font-size:11px">${CRM.escapeHtml(sig.documentHash || 'n/a')}</code>
                </p>
                ${sig.method === 'drawn' && sig.imageData ? `<img src="${sig.imageData}" alt="Signature" style="max-height:70px;border-bottom:1px solid #333">` : ''}
            </div>` : '';

        const counterBlock = this.countersignBlock(contract);

        if (contract.source === 'uploaded') {
            area.innerHTML = `
                <div class="crm-card">
                    ${statusRow}
                    ${linkRow}
                    <div class="contract-file-box">
                        <span>📄 ${CRM.escapeHtml(contract.uploadedFile?.filename || 'contract.pdf')}</span>
                        <a class="crm-btn-sm" href="/api/contracts/${contract._id}/file" target="_blank">View</a>
                    </div>
                    <div class="crm-actions-row">
                        ${!isSigned ? `
                            <button class="primary-button" onclick="projectPage.emailContract()">Send Contract</button>
                            <button class="secondary-button" onclick="projectPage.sendContract()">${contract.status === 'sent' ? 'Refresh Signature Link' : 'Create Signature Link'}</button>
                            <button class="secondary-button" onclick="document.getElementById('contractFileInput').click()">Replace PDF</button>
                            <input type="file" id="contractFileInput" accept="application/pdf" hidden onchange="projectPage.uploadContract(this.files[0])">
                            <button class="crm-btn-sm danger" onclick="projectPage.deleteContract()">Delete</button>
                        ` : `
                            <a class="primary-button" style="text-decoration:none" href="/api/contracts/${contract._id}/pdf">Download Signature Certificate</a>
                        `}
                    </div>
                </div>
                ${counterBlock}
                ${signedBlock}`;
            return;
        }

        // Generated contract
        area.innerHTML = `
            <div class="crm-card">
                ${statusRow}
                ${linkRow}
                ${!isSigned ? `
                <div class="form-group">
                    <label for="contractTitle">Contract Title</label>
                    <input type="text" id="contractTitle" value="${CRM.escapeHtml(contract.title || '')}">
                </div>
                <div class="contract-editor-toolbar" id="contractEditorToolbar"></div>
                <div class="contract-editor" id="contractEditor" contenteditable="true">${contract.contentHtml || ''}</div>
                <div class="crm-actions-row">
                    <button class="primary-button" onclick="projectPage.saveContract()">Save Contract</button>
                    <button class="secondary-button" onclick="projectPage.emailContract()">Send Contract</button>
                    <button class="secondary-button" onclick="projectPage.sendContract()">${contract.status === 'sent' ? 'Refresh Signature Link' : 'Create Signature Link'}</button>
                    <a class="crm-btn-sm" href="/api/contracts/${contract._id}/pdf">Preview PDF</a>
                    <button class="crm-btn-sm" onclick="projectPage.openGenerateContractModal()">Regenerate from Quote</button>
                    <button class="crm-btn-sm danger" onclick="projectPage.deleteContract()">Delete</button>
                </div>
                ` : `
                <div class="contract-editor" style="background:#fafbfc">${contract.contentHtml || ''}</div>
                <div class="crm-actions-row">
                    <a class="primary-button" style="text-decoration:none" href="/api/contracts/${contract._id}/pdf">Download Signed PDF</a>
                </div>
                `}
            </div>
            ${counterBlock}
            ${signedBlock}`;

        if (!isSigned) {
            this.mountContractEditor();
        } else if (window.ContractEditor) {
            const preview = area.querySelector('.contract-editor');
            if (preview) {
                ContractEditor.applyFieldResponses?.(preview, contract.fieldResponses || []);
            }
        }
    }

    mountContractEditor() {
        const toolbar = document.getElementById('contractEditorToolbar');
        if (!toolbar || !window.ContractEditor) return;
        this.contractEditorApi = ContractEditor.mountToolbar(toolbar, {
            getEditorEl: () => document.getElementById('contractEditor')
        });
    }

    countersignBlock(contract) {
        const cs = contract.countersignature || {};

        if (cs.signedAt) {
            return `
                <div class="crm-card" style="border-color: var(--color-success);">
                    <h3>Countersigned</h3>
                    <p class="crm-inline-note">
                        Countersigned by <strong>${CRM.escapeHtml(cs.name || '')}</strong>${cs.title ? `, ${CRM.escapeHtml(cs.title)}` : ''}
                        (${cs.method === 'drawn' ? 'drawn' : 'typed'} signature)
                        on ${new Date(cs.signedAt).toLocaleString('en-US')}
                    </p>
                    ${cs.method === 'drawn' && cs.imageData
                        ? `<img src="${cs.imageData}" alt="Countersignature" style="max-height:70px;border-bottom:1px solid #333">`
                        : `<div style="font-family:'Brush Script MT','Segoe Script',cursive;font-size:26px;border-bottom:1px solid #333;display:inline-block;padding:0 20px 2px">${CRM.escapeHtml(cs.name || '')}</div>`}
                </div>`;
        }

        return `
            <div class="crm-card">
                <h3>Countersignature</h3>
                <p class="crm-inline-note" style="margin-bottom:14px">
                    Sign on behalf of your company. The countersignature appears on the client's signing page
                    and in the contract PDF — whether or not the client has signed yet.
                </p>
                <div class="crm-form-grid">
                    <div class="form-group">
                        <label for="csName">Full Name</label>
                        <input type="text" id="csName" placeholder="Your full legal name"
                               oninput="document.getElementById('csPreview').textContent = this.value.trim() || '\u00a0'">
                    </div>
                    <div class="form-group">
                        <label for="csTitle">Title</label>
                        <input type="text" id="csTitle" placeholder="e.g., Owner, Managing Director">
                    </div>
                </div>
                <div class="typed-signature-preview" id="csPreview" style="margin:10px 0 14px">&nbsp;</div>
                <div class="crm-actions-row">
                    <button class="primary-button" onclick="projectPage.countersign()">Countersign</button>
                    <span class="crm-inline-note">Recorded with timestamp and IP for the audit trail</span>
                </div>
            </div>`;
    }

    async countersign() {
        const contract = this.data.contract;
        if (!contract) return;
        const name = document.getElementById('csName').value.trim();
        if (!name) {
            showAlertModal('Please enter your full legal name.', 'error');
            return;
        }
        try {
            await CRM.api(`/api/contracts/${contract._id}/countersign`, {
                method: 'POST',
                body: {
                    name,
                    title: document.getElementById('csTitle').value.trim(),
                    method: 'typed'
                }
            });
            showToast?.('Contract countersigned', 'success');
            await this.load();
            this.showTab('contract');
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    execCmd(command, value = null) {
        if (this.contractEditorApi) {
            this.contractEditorApi.execCmd(command, value);
            return;
        }
        document.getElementById('contractEditor')?.focus();
        document.execCommand(command, false, value);
    }

    populateQuoteSelect(selectId, { includeBlank = false } = {}) {
        const select = document.getElementById(selectId);
        const options = this.data.quotes.map((q) =>
            `<option value="${CRM.escapeHtml(q.name)}">${CRM.escapeHtml(this.quoteTitle(q))} — ${CRM.money(q.quoteData?.total || 0, { cents: false })}</option>`);
        select.innerHTML = (includeBlank ? '<option value="">Blank invoice</option>' : '') + options.join('');
    }

    openGenerateContractModal() {
        if (this.data.quotes.length === 0) {
            showAlertModal('Link a quote to this project first — the contract is generated from the quote\'s services.', 'info');
            return;
        }
        this.populateQuoteSelect('generateContractQuote');
        document.getElementById('generateContractModal').style.display = 'flex';
    }

    closeGenerateContractModal() {
        document.getElementById('generateContractModal').style.display = 'none';
    }

    async generateContract() {
        const quoteName = document.getElementById('generateContractQuote').value;
        if (!quoteName) return;
        if (this.data.contract && this.data.contract.contentHtml) {
            const confirmed = await showConfirmModal(
                'Regenerating replaces the current contract text (your edits will be lost). Continue?',
                'Regenerate Contract', 'Regenerate'
            );
            if (!confirmed) return;
        }
        try {
            await CRM.api(`/api/projects/${this.projectId}/contract/generate`, { method: 'POST', body: { quoteName } });
            this.closeGenerateContractModal();
            showAlertModal('Contract generated from quote.', 'success', null, true);
            await this.reload();
            this.showTab('contract');
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async saveContract({ silent = false } = {}) {
        const contract = this.data.contract;
        if (!contract) return;
        try {
            await CRM.api(`/api/contracts/${contract._id}`, {
                method: 'PUT',
                body: {
                    title: document.getElementById('contractTitle')?.value ?? contract.title,
                    contentHtml: (window.ContractEditor
                        ? ContractEditor.getEditorHtml(document.getElementById('contractEditor'))
                        : document.getElementById('contractEditor')?.innerHTML) ?? contract.contentHtml
                }
            });
            if (!silent) showAlertModal('Contract saved.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message, 'error');
            throw error;
        }
    }

    docTrackingHtml(doc) {
        if (!doc) return '';
        const fmt = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
        const emailOpened = (doc.emailLog || [])
            .filter((e) => e.openedAt)
            .map((e) => new Date(e.openedAt).getTime())
            .sort((a, b) => b - a)[0];
        return `<p class="crm-inline-note" style="margin:0 0 14px">
            Sent ${fmt(doc.sentAt)} · Viewed ${fmt(doc.firstViewedAt)}${doc.viewCount ? ` (${doc.viewCount})` : ''} · Email opened ${fmt(emailOpened || null)}
        </p>`;
    }

    async emailContract() {
        const contract = this.data.contract;
        if (!contract) return;
        const defaultEmail = this.data.project?.client?.email || '';
        const values = await showPromptModal({
            title: 'Send Contract',
            message: 'Email the signing link to your client.',
            confirmText: 'Send Email',
            fields: [{
                name: 'email',
                label: 'Recipient email',
                type: 'email',
                value: defaultEmail,
                required: true
            }]
        });
        if (!values?.email) return;
        try {
            if (contract.source === 'generated') {
                await this.saveContract({ silent: true });
            }
            const result = await CRM.api(`/api/contracts/${contract._id}/email`, {
                method: 'POST',
                body: { email: values.email }
            });
            await this.reload();
            this.showTab('contract');
            showAlertModal(
                `Contract emailed to <strong>${CRM.escapeHtml((result.emailedTo || [values.email]).join(', '))}</strong>.`,
                'success', 'Contract Sent', false, true
            );
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async sendContract() {
        const contract = this.data.contract;
        if (!contract) return;
        try {
            if (contract.source === 'generated') {
                await this.saveContract({ silent: true });
            }
            const result = await CRM.api(`/api/contracts/${contract._id}/send`, { method: 'POST' });
            await this.reload();
            this.showTab('contract');
            const copied = await CRM.copyToClipboard(result.link);
            showAlertModal(
                `Signing link ready${copied ? ' (copied to clipboard)' : ''}:<br><code>${CRM.escapeHtml(result.link)}</code><br><br>Share this link with your client to collect their signature.`,
                'success', 'Contract Ready to Sign', false, true
            );
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async deleteContract() {
        const confirmed = await showConfirmModal('Delete this contract? This cannot be undone.', 'Delete Contract', 'Delete');
        if (!confirmed) return;
        try {
            await CRM.api(`/api/contracts/${this.data.contract._id}`, { method: 'DELETE' });
            await this.reload();
            this.showTab('contract');
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    uploadContract(file) {
        this.readContractPdf(file, async (fileData, filename) => {
            await CRM.api(`/api/projects/${this.projectId}/contract/upload`, {
                method: 'POST',
                body: { fileData, filename }
            });
            showAlertModal('Contract uploaded.', 'success', null, true);
            await this.reload();
            this.showTab('contract');
        });
    }

    uploadExternalContract(file) {
        this.readContractPdf(file, async (fileData, filename) => {
            await CRM.api(`/api/projects/${this.projectId}/contract/upload-external`, {
                method: 'POST',
                body: { fileData, filename }
            });
            showAlertModal('Signed contract filed.', 'success', null, true);
            await this.reload();
            this.showTab('contract');
        });
    }

    readContractPdf(file, onReady) {
        if (!file) return;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        if (!isPdf) {
            showAlertModal('Please choose a PDF file.', 'error');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            showAlertModal('Contract PDF must be 15 MB or smaller.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                await onReady(reader.result, file.name);
            } catch (error) {
                showAlertModal(error.message, 'error');
            }
        };
        reader.readAsDataURL(file);
    }

    copyLink(link, buttonEl) {
        CRM.copyToClipboard(link).then((ok) => {
            if (ok && buttonEl) {
                const original = buttonEl.textContent;
                buttonEl.textContent = 'Copied!';
                setTimeout(() => { buttonEl.textContent = original; }, 1600);
            }
        });
    }

    // ---------- Invoices tab ----------

    renderInvoices() {
        const area = document.getElementById('invoicesListArea');
        const { invoices } = this.data;
        if (invoices.length === 0) {
            area.innerHTML = `<div class="crm-empty"><p>No invoices yet. Create one from a quote or start blank.</p></div>`;
            return;
        }
        area.innerHTML = `
            <div class="crm-table-scroll">
            <table class="crm-table">
                <thead><tr>
                    <th>Invoice #</th>
                    <th>Status</th>
                    <th class="col-fold-sm">Issued</th>
                    <th class="col-fold-sm">Due</th>
                    <th class="num">Total</th>
                    <th></th>
                </tr></thead>
                <tbody>
                    ${invoices.map((inv) => {
                        const issued = CRM.formatDate(inv.issueDate) || '';
                        const dueDate = CRM.effectiveDueDate(inv);
                        const due = CRM.formatDate(dueDate) || '';
                        const overdue = CRM.isInvoiceOverdue(inv);
                        const paidMeta = inv.amountPaid > 0 ? `Paid ${CRM.money(inv.amountPaid)}` : '';
                        const metaHtml = CRM.listRowMeta([
                            issued ? `Issued ${CRM.escapeHtml(issued)}` : '',
                            due ? `${overdue ? 'Overdue' : 'Due'} ${CRM.escapeHtml(due)}` : '',
                            paidMeta
                        ]);
                        return `
                        <tr>
                            <td>
                                <div class="list-row-primary">
                                    <div>
                                        <strong>${CRM.escapeHtml(inv.invoiceNumber)}</strong>
                                        ${inv.subtitle ? `<br><span class="crm-inline-note">${CRM.escapeHtml(inv.subtitle)}</span>` : ''}
                                    </div>
                                    ${metaHtml}
                                </div>
                            </td>
                            <td>${CRM.invoiceStatusChip(inv)}</td>
                            <td class="col-fold-sm">${CRM.escapeHtml(CRM.formatDate(inv.issueDate) || '—')}</td>
                            <td class="col-fold-sm${overdue ? ' invoice-due--overdue' : ''}">${CRM.escapeHtml(due || '—')}</td>
                            <td class="num">${CRM.money(inv.total)}</td>
                            <td>
                                <div class="crm-row-actions">
                                    ${(inv.status === 'draft' || inv.status === 'sent') ? `<button class="crm-btn-sm primary" onclick="projectPage.editInvoice('${inv._id}')">Edit</button>` : ''}
                                    ${inv.publicToken && inv.status !== 'void' ? `<button class="crm-btn-sm" onclick="projectPage.copyLink('${CRM.escapeJs(`${window.location.origin}/invoice/${inv.publicToken}`)}', this)">Link</button>` : ''}
                                    ${inv.publicToken && inv.status !== 'void' ? `<a class="crm-btn-sm" href="/invoice/${CRM.escapeHtml(inv.publicToken)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
                                    <a class="crm-btn-sm" href="/api/invoices/${inv._id}/pdf">PDF</a>
                                    ${(inv.status === 'draft' || inv.status === 'sent') ? `<button class="crm-btn-sm danger" onclick="projectPage.voidOrDeleteInvoice('${inv._id}', '${inv.status}')">${inv.status === 'draft' ? 'Delete' : 'Void'}</button>` : ''}
                                </div>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;
    }

    openCreateInvoiceModal() {
        this.populateQuoteSelect('createInvoiceQuote', { includeBlank: true });
        document.getElementById('createInvoiceModal').style.display = 'flex';
    }

    closeCreateInvoiceModal() {
        document.getElementById('createInvoiceModal').style.display = 'none';
    }

    async createInvoice() {
        const quoteName = document.getElementById('createInvoiceQuote').value;
        try {
            const invoice = await CRM.api(`/api/projects/${this.projectId}/invoices`, {
                method: 'POST',
                body: quoteName ? { quoteName } : {}
            });
            this.closeCreateInvoiceModal();
            await this.reload();
            this.showTab('invoices');
            this.editInvoice(invoice._id);
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async invoiceFromQuote(quoteName) {
        try {
            const invoice = await CRM.api(`/api/projects/${this.projectId}/invoices`, {
                method: 'POST',
                body: { quoteName }
            });
            await this.reload();
            this.showTab('invoices');
            this.editInvoice(invoice._id);
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async editInvoice(invoiceId) {
        try {
            this.editingInvoice = await CRM.api(`/api/invoices/${invoiceId}`);
            this.renderInvoiceEditor();
            document.getElementById('invoiceEditorArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    closeInvoiceEditor() {
        this.editingInvoice = null;
        document.getElementById('invoiceEditorArea').innerHTML = '';
    }

    partyFields(prefix, party) {
        return `
            <div class="form-group">
                <label>Name</label>
                <input type="text" id="${prefix}Name" value="${CRM.escapeHtml(party.name || '')}">
            </div>
            <div class="form-group">
                <label>Company</label>
                <input type="text" id="${prefix}Company" value="${CRM.escapeHtml(party.company || '')}">
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" id="${prefix}Email" value="${CRM.escapeHtml(party.email || '')}">
            </div>
            <div class="form-group">
                <label>Phone</label>
                <input type="tel" id="${prefix}Phone" value="${CRM.escapeHtml(party.phone || '')}">
            </div>
            <div class="form-group form-group--full">
                <label>Address</label>
                <textarea id="${prefix}Address" rows="2">${CRM.escapeHtml(party.address || '')}</textarea>
            </div>`;
    }

    renderInvoiceEditor() {
        const inv = this.editingInvoice;
        const area = document.getElementById('invoiceEditorArea');
        if (!inv) { area.innerHTML = ''; return; }

        area.innerHTML = `
            <div class="crm-card" id="invoiceEditorCard">
                <div class="crm-card-header">
                    <h3>Edit ${CRM.escapeHtml(inv.invoiceNumber)}</h3>
                    <div class="crm-actions-row" style="margin-top:0">
                        ${CRM.invoiceStatusChip(inv)}
                        <button class="crm-btn-sm" onclick="projectPage.closeInvoiceEditor()">Close</button>
                    </div>
                </div>

                <div class="crm-form-grid">
                    <div class="form-group">
                        <label>Text under invoice number</label>
                        <input type="text" id="invSubtitle" value="${CRM.escapeHtml(inv.subtitle || '')}" placeholder="e.g., ${CRM.escapeHtml(this.data.project.name)}">
                    </div>
                    <div class="form-group">
                        <label>Issue Date</label>
                        <input type="date" id="invIssueDate" value="${CRM.escapeHtml(inv.issueDate || '')}">
                    </div>
                    <div class="form-group">
                        <label>Due Date</label>
                        <input type="date" id="invDueDate" value="${CRM.escapeHtml(inv.dueDate || '')}">
                    </div>
                    <div class="form-group form-group--full">
                        <label>Note at top of invoice</label>
                        <textarea id="invHeaderNote" rows="2" placeholder="Optional message shown above the line items">${CRM.escapeHtml(inv.headerNote || '')}</textarea>
                    </div>
                </div>

                <div class="crm-form-grid invoice-parties-grid" style="margin-top:20px">
                    <div>
                        <h3 style="font-size:14px">Bill To</h3>
                        <div class="crm-form-grid">${this.partyFields('invTo', inv.to || {})}</div>
                    </div>
                    <div>
                        <h3 style="font-size:14px">From</h3>
                        <div class="crm-form-grid">${this.partyFields('invFrom', inv.from || {})}</div>
                    </div>
                </div>

                <h3 style="font-size:14px;margin-top:24px">Line Items</h3>
                <div class="invoice-items-scroll">
                <table class="crm-table invoice-items-table">
                    <thead><tr>
                        <th class="col-day">Day</th>
                        <th>Description</th><th>Detail</th>
                        <th class="col-qty num">Qty</th><th class="col-price num">Unit Price</th>
                        <th class="col-amount num">Amount</th><th class="col-remove"></th>
                    </tr></thead>
                    <tbody id="invoiceItemsBody"></tbody>
                </table>
                </div>
                <button class="crm-btn-sm" style="margin-top:8px" onclick="projectPage.addInvoiceLine()">+ Add Line</button>

                <div class="invoice-totals">
                    <div class="row"><span>Subtotal</span><span id="invSubtotalDisplay">$0.00</span></div>
                    <div class="row">
                        <span>Discount</span>
                        <span>-$<input type="number" id="invDiscount" min="0" step="0.01" value="${inv.discountAmount || 0}"
                            style="width:90px;text-align:right;border:1px solid var(--color-border);border-radius:4px;padding:2px 6px"
                            oninput="projectPage.recalcInvoiceTotals()"></span>
                    </div>
                    <div class="row grand"><span>Total</span><span id="invTotalDisplay">$0.00</span></div>
                </div>

                <h3 style="font-size:14px;margin-top:24px">Payment Plan</h3>
                <div id="ppBox"></div>

                <div class="form-group" style="margin-top:20px">
                    <label>Note at bottom of invoice</label>
                    <textarea id="invFooterNote" rows="2" placeholder="e.g., payment terms, thank-you message">${CRM.escapeHtml(inv.footerNote || '')}</textarea>
                </div>

                ${inv.publicToken ? `
                <div class="invoice-share-link" style="margin-top:14px">
                    <span>${CRM.escapeHtml(`${window.location.origin}/invoice/${inv.publicToken}`)}</span>
                    <button class="crm-btn-sm" onclick="projectPage.copyLink('${CRM.escapeJs(`${window.location.origin}/invoice/${inv.publicToken}`)}', this)">Copy</button>
                    <a class="crm-btn-sm" href="/invoice/${CRM.escapeHtml(inv.publicToken)}" target="_blank" rel="noopener noreferrer">Open</a>
                </div>
                ${this.docTrackingHtml(inv)}` : ''}

                <div class="crm-actions-row">
                    <button class="primary-button" onclick="projectPage.saveInvoice()">Save Invoice</button>
                    ${(inv.status === 'draft' || inv.status === 'sent') ? `
                    <button type="button" class="secondary-button" onclick="projectPage.openInvoiceInQuoteEditor('${inv._id}')">Open in Quote Editor</button>` : ''}
                    ${(inv.status === 'draft' || inv.status === 'sent') ? `
                    <button type="button" class="secondary-button" onclick="projectPage.emailInvoice()">Send Invoice</button>` : ''}
                    <button class="secondary-button" onclick="projectPage.sendInvoice()">${inv.status === 'draft' ? 'Get Shareable Link' : 'Refresh Shareable Link'}</button>
                    <a class="crm-btn-sm" href="/api/invoices/${inv._id}/pdf">Download PDF</a>
                </div>

                ${this.recordPaymentSectionHtml(inv)}
            </div>`;

        this.renderInvoiceLines();
        this.renderPaymentPlan();
    }

    todayYmd() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    paidOnLabel(paidAt) {
        const formatted = CRM.formatDate(paidAt);
        return formatted ? ` on ${formatted}` : '';
    }

    async promptPaidDate(title, message) {
        const values = await showPromptModal({
            title,
            message,
            confirmText: 'Mark Paid',
            fields: [{
                name: 'paidDate',
                label: 'Payment date',
                type: 'date',
                value: this.todayYmd(),
                required: true
            }]
        });
        if (!values || !values.paidDate) return null;
        return values.paidDate;
    }

    recordPaymentSectionHtml(inv) {
        if (!inv || inv.status === 'draft' || inv.status === 'void') {
            return '';
        }

        const plan = inv.paymentPlan;
        const installments = plan?.enabled ? (plan.installments || []) : [];
        const hasPlan = installments.length > 0;

        if (inv.status === 'paid') {
            const paidLine = inv.paidAt
                ? `Paid in full${this.paidOnLabel(inv.paidAt)}.`
                : 'Paid in full.';
            const installmentRows = hasPlan
                ? `<div class="invoice-record-installments" style="margin-top:10px">
                    ${installments.map((inst, i) => {
                        const label = CRM.escapeHtml(inst.label || `Payment ${i + 1}`);
                        const amount = CRM.money(inst.amount || 0);
                        const when = inst.status === 'paid' ? this.paidOnLabel(inst.paidAt) : '';
                        return `<div class="pp-row-static">
                            <strong>${label}</strong> — ${amount}
                            <span class="crm-chip crm-chip--paid" style="margin-left:6px">Paid${CRM.escapeHtml(when)}</span>
                        </div>`;
                    }).join('')}
                </div>`
                : '';
            return `
                <div class="invoice-record-payment" style="margin-top:28px;padding-top:20px;border-top:1px solid var(--color-border)">
                    <h3 style="font-size:14px;margin:0 0 6px">Payment</h3>
                    <p class="crm-inline-note" style="margin:0">${CRM.escapeHtml(paidLine)}</p>
                    ${installmentRows}
                </div>`;
        }

        let installmentRows = '';
        if (hasPlan) {
            installmentRows = `
                <div class="invoice-record-installments">
                    ${installments.map((inst, i) => {
                        const label = CRM.escapeHtml(inst.label || `Payment ${i + 1}`);
                        const amount = CRM.money(inst.amount || 0);
                        if (inst.status === 'paid') {
                            const when = this.paidOnLabel(inst.paidAt);
                            return `<div class="pp-row-static">
                                <strong>${label}</strong> — ${amount}
                                <span class="crm-chip crm-chip--paid" style="margin-left:6px">Paid${CRM.escapeHtml(when)}</span>
                            </div>`;
                        }
                        return `<div class="pp-row-static" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:space-between">
                            <span><strong>${label}</strong> — ${amount}</span>
                            <button type="button" class="crm-btn-sm primary" onclick="projectPage.markInstallmentPaid('${inv._id}', ${i})">Mark paid</button>
                        </div>`;
                    }).join('')}
                </div>`;
        }

        const remaining = Math.max(0, (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0));
        return `
            <div class="invoice-record-payment" style="margin-top:28px;padding-top:20px;border-top:1px solid var(--color-border)">
                <h3 style="font-size:14px;margin:0 0 6px">Record payment</h3>
                <p class="crm-inline-note" style="margin:0 0 14px">
                    For payments received outside Stripe.
                    ${hasPlan
                        ? 'Mark individual installments as they come in, or mark the full invoice paid.'
                        : 'Marks the invoice paid in full.'}
                    You will choose the payment date when marking paid.
                    ${remaining > 0 ? ` Balance due: <strong>${CRM.money(remaining)}</strong>.` : ''}
                </p>
                ${installmentRows}
                <div class="crm-actions-row" style="margin-top:12px">
                    <button type="button" class="secondary-button" onclick="projectPage.markInvoicePaid('${inv._id}')">
                        Mark invoice paid in full
                    </button>
                </div>
            </div>`;
    }

    // ---------- Payment plan editor ----------

    getEditorTotal() {
        const items = this.editingInvoice?.lineItems || [];
        const subtotal = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0);
        const discount = Number(document.getElementById('invDiscount')?.value) || 0;
        return Math.max(0, subtotal - discount);
    }

    planLocked() {
        return (this.editingInvoice?.paymentPlan?.installments || []).some((i) => i.status === 'paid');
    }

    renderPaymentPlan() {
        const box = document.getElementById('ppBox');
        if (!box) return;
        const plan = this.editingInvoice.paymentPlan || { enabled: false, installments: [] };
        this.editingInvoice.paymentPlan = plan;

        if (this.planLocked()) {
            box.innerHTML = `
                <p class="crm-inline-note">A payment has already been made — the plan schedule is locked. Use Record payment below to mark remaining installments.</p>
                ${plan.installments.map((inst, i) => `
                    <div class="pp-row-static">
                        <strong>${CRM.escapeHtml(inst.label || `Payment ${i + 1}`)}</strong> — ${inst.percent}% (${CRM.money(inst.amount)})
                        ${inst.status === 'paid'
                            ? `<span class="crm-chip crm-chip--paid" style="margin-left:6px">Paid${CRM.escapeHtml(this.paidOnLabel(inst.paidAt))}</span>`
                            : '<span class="crm-chip crm-chip--draft" style="margin-left:6px">Pending</span>'}
                    </div>`).join('')}`;
            return;
        }

        let html = `
            <label class="checkbox-label" style="margin:0 0 10px">
                <input type="checkbox" id="ppEnabled" ${plan.enabled ? 'checked' : ''} onchange="projectPage.togglePaymentPlan(this.checked)">
                <span class="checkbox-text">Split this invoice into scheduled payments</span>
            </label>`;

        if (plan.enabled) {
            const total = this.getEditorTotal();
            const percentSum = plan.installments.reduce((sum, inst) => sum + (Number(inst.percent) || 0), 0);
            const sumOk = Math.abs(percentSum - 100) <= 0.01;

            html += plan.installments.map((inst, i) => this.installmentRowHtml(inst, i, total)).join('');
            html += `
                <div class="crm-actions-row" style="margin-top:10px">
                    <button type="button" class="crm-btn-sm" onclick="projectPage.addInstallment()">+ Add Payment</button>
                    <button type="button" class="crm-btn-sm" onclick="projectPage.applyPreset5050()">Preset: 50% now / 50% at project start</button>
                    <span class="crm-inline-note" style="color:${sumOk ? 'var(--color-success, #16794c)' : '#b3261e'}">
                        ${Math.round(percentSum * 100) / 100}% of 100% allocated
                    </span>
                </div>`;
        }
        box.innerHTML = html;
    }

    installmentRowHtml(inst, i, total) {
        const amount = total * ((Number(inst.percent) || 0) / 100);
        const offsetAbs = Math.abs(Number(inst.offsetDays) || 0);
        const direction = (Number(inst.offsetDays) || 0) >= 0 ? 'after' : 'before';
        const anchors = [
            ['project_start', 'project start'],
            ['project_end', 'project end'],
            ['contract_signed', 'contract signed'],
            ['issue_date', 'invoice issue date']
        ];
        return `
            <div class="pp-row" data-idx="${i}">
                <input type="text" class="pp-label" placeholder="e.g., Deposit" value="${CRM.escapeHtml(inst.label || '')}"
                    oninput="projectPage.updateInstallment(${i}, 'label', this.value)">
                <span class="pp-percent">
                    <input type="number" min="0" max="100" step="0.01" value="${inst.percent ?? ''}"
                        oninput="projectPage.updateInstallment(${i}, 'percent', this.value)">%
                </span>
                <span class="pp-amount" id="ppAmount-${i}">${CRM.money(amount)}</span>
                <select onchange="projectPage.updateInstallment(${i}, 'dueType', this.value)">
                    <option value="immediate" ${inst.dueType === 'immediate' ? 'selected' : ''}>Due immediately</option>
                    <option value="fixed" ${inst.dueType === 'fixed' ? 'selected' : ''}>Fixed date</option>
                    <option value="relative" ${inst.dueType === 'relative' ? 'selected' : ''}>Relative to…</option>
                </select>
                ${inst.dueType === 'fixed' ? `
                    <input type="date" value="${CRM.escapeHtml(inst.dueDate || '')}"
                        onchange="projectPage.updateInstallment(${i}, 'dueDate', this.value)">` : ''}
                ${inst.dueType === 'relative' ? `
                    <span class="pp-relative">
                        <input type="number" min="0" step="1" value="${offsetAbs}"
                            oninput="projectPage.updateInstallment(${i}, 'offsetAbs', this.value)">
                        <select onchange="projectPage.updateInstallment(${i}, 'direction', this.value)">
                            <option value="before" ${direction === 'before' ? 'selected' : ''}>days before</option>
                            <option value="after" ${direction === 'after' ? 'selected' : ''}>days after</option>
                        </select>
                        <select onchange="projectPage.updateInstallment(${i}, 'anchor', this.value)">
                            ${anchors.map(([value, label]) => `<option value="${value}" ${inst.anchor === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </span>` : ''}
                <button type="button" class="crm-btn-sm danger" onclick="projectPage.removeInstallment(${i})" title="Remove">×</button>
            </div>`;
    }

    togglePaymentPlan(enabled) {
        const plan = this.editingInvoice.paymentPlan;
        plan.enabled = enabled;
        if (enabled && plan.installments.length === 0) {
            this.applyPreset5050();
            return;
        }
        this.renderPaymentPlan();
    }

    applyPreset5050() {
        this.editingInvoice.paymentPlan = {
            enabled: true,
            installments: [
                { label: 'Deposit', percent: 50, dueType: 'immediate', dueDate: null, anchor: 'project_start', offsetDays: 0 },
                { label: 'Final Payment', percent: 50, dueType: 'relative', dueDate: null, anchor: 'project_start', offsetDays: 0 }
            ]
        };
        this.renderPaymentPlan();
    }

    addInstallment() {
        this.editingInvoice.paymentPlan.installments.push({
            label: '', percent: 0, dueType: 'immediate', dueDate: null, anchor: 'project_start', offsetDays: 0
        });
        this.renderPaymentPlan();
    }

    removeInstallment(i) {
        this.editingInvoice.paymentPlan.installments.splice(i, 1);
        this.renderPaymentPlan();
    }

    updateInstallment(i, field, value) {
        const inst = this.editingInvoice.paymentPlan.installments[i];
        if (!inst) return;
        if (field === 'percent') {
            inst.percent = Number(value) || 0;
            this.renderPaymentPlanAmounts();
            return;
        }
        if (field === 'offsetAbs') {
            const sign = (inst.offsetDays || 0) < 0 ? -1 : 1;
            inst.offsetDays = sign * Math.abs(Number(value) || 0);
            return;
        }
        if (field === 'direction') {
            inst.offsetDays = (value === 'before' ? -1 : 1) * Math.abs(inst.offsetDays || 0);
            return;
        }
        inst[field] = value;
        if (field === 'dueType') this.renderPaymentPlan();
    }

    /** Refresh the derived $ amounts and the percent-sum note without a full re-render. */
    renderPaymentPlanAmounts() {
        const plan = this.editingInvoice.paymentPlan;
        const total = this.getEditorTotal();
        plan.installments.forEach((inst, i) => {
            const cell = document.getElementById(`ppAmount-${i}`);
            if (cell) cell.textContent = CRM.money(total * ((Number(inst.percent) || 0) / 100));
        });
        const note = document.querySelector('#ppBox .crm-inline-note');
        if (note) {
            const percentSum = plan.installments.reduce((sum, inst) => sum + (Number(inst.percent) || 0), 0);
            const sumOk = Math.abs(percentSum - 100) <= 0.01;
            note.style.color = sumOk ? 'var(--color-success, #16794c)' : '#b3261e';
            note.textContent = `${Math.round(percentSum * 100) / 100}% of 100% allocated`;
        }
    }

    renderInvoiceLines() {
        const tbody = document.getElementById('invoiceItemsBody');
        const items = this.editingInvoice.lineItems || [];
        tbody.innerHTML = items.map((item, i) => `
            <tr>
                <td><textarea class="inv-line-text" rows="1" data-line="${i}" data-field="day" placeholder="e.g., Fri, Nov 5" oninput="projectPage.updateInvoiceLine(this)">${CRM.escapeHtml(item.day || '')}</textarea></td>
                <td><textarea class="inv-line-text" rows="1" data-line="${i}" data-field="description" oninput="projectPage.updateInvoiceLine(this)">${CRM.escapeHtml(item.description || '')}</textarea></td>
                <td><textarea class="inv-line-text" rows="1" data-line="${i}" data-field="detail" oninput="projectPage.updateInvoiceLine(this)">${CRM.escapeHtml(item.detail || '')}</textarea></td>
                <td class="num"><input type="number" min="0" step="1" data-line="${i}" data-field="quantity" value="${item.quantity ?? 1}" oninput="projectPage.updateInvoiceLine(this)" style="text-align:right"></td>
                <td class="num"><input type="number" min="0" step="0.01" data-line="${i}" data-field="unitPrice" value="${item.unitPrice ?? 0}" oninput="projectPage.updateInvoiceLine(this)" style="text-align:right"></td>
                <td class="num" id="lineAmount-${i}">${CRM.money((item.quantity || 1) * (item.unitPrice || 0))}</td>
                <td><button class="crm-btn-sm danger" onclick="projectPage.removeInvoiceLine(${i})" title="Remove line">×</button></td>
            </tr>`).join('');
        tbody.querySelectorAll('textarea.inv-line-text').forEach((el) => this.autosizeInvoiceField(el));
        this.recalcInvoiceTotals();
    }

    autosizeInvoiceField(el) {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.max(34, el.scrollHeight)}px`;
    }

    updateInvoiceLine(input) {
        const i = Number(input.dataset.line);
        const field = input.dataset.field;
        const item = this.editingInvoice.lineItems[i];
        if (!item) return;
        if (input.tagName === 'TEXTAREA') this.autosizeInvoiceField(input);
        if (field === 'quantity' || field === 'unitPrice') {
            item[field] = Number(input.value) || 0;
            const amountCell = document.getElementById(`lineAmount-${i}`);
            if (amountCell) amountCell.textContent = CRM.money((item.quantity || 0) * (item.unitPrice || 0));
            this.recalcInvoiceTotals();
        } else {
            item[field] = input.value;
        }
    }

    addInvoiceLine() {
        this.editingInvoice.lineItems.push({ day: '', description: '', detail: '', quantity: 1, unitPrice: 0, amount: 0 });
        this.renderInvoiceLines();
    }

    removeInvoiceLine(index) {
        this.editingInvoice.lineItems.splice(index, 1);
        this.renderInvoiceLines();
    }

    recalcInvoiceTotals() {
        const items = this.editingInvoice?.lineItems || [];
        const subtotal = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0);
        const discount = Number(document.getElementById('invDiscount')?.value) || 0;
        document.getElementById('invSubtotalDisplay').textContent = CRM.money(subtotal);
        document.getElementById('invTotalDisplay').textContent = CRM.money(Math.max(0, subtotal - discount));
        if (this.editingInvoice?.paymentPlan?.enabled && !this.planLocked()) {
            this.renderPaymentPlanAmounts();
        }
    }

    collectInvoiceBody() {
        const party = (prefix) => ({
            name: document.getElementById(`${prefix}Name`).value,
            company: document.getElementById(`${prefix}Company`).value,
            email: document.getElementById(`${prefix}Email`).value,
            phone: document.getElementById(`${prefix}Phone`).value,
            address: document.getElementById(`${prefix}Address`).value
        });
        const body = {
            subtitle: document.getElementById('invSubtitle').value,
            headerNote: document.getElementById('invHeaderNote').value,
            footerNote: document.getElementById('invFooterNote').value,
            issueDate: document.getElementById('invIssueDate').value || null,
            dueDate: document.getElementById('invDueDate').value || null,
            from: party('invFrom'),
            to: party('invTo'),
            lineItems: this.editingInvoice.lineItems,
            discountAmount: Number(document.getElementById('invDiscount').value) || 0
        };
        // The server rejects plan changes after a payment — don't send the plan once locked
        if (!this.planLocked()) {
            body.paymentPlan = this.editingInvoice.paymentPlan || { enabled: false, installments: [] };
        }
        return body;
    }

    async saveInvoice({ silent = false } = {}) {
        try {
            this.editingInvoice = await CRM.api(`/api/invoices/${this.editingInvoice._id}`, {
                method: 'PUT',
                body: this.collectInvoiceBody()
            });
            if (!silent) showAlertModal('Invoice saved.', 'success', null, true);
            await this.load();
            this.renderInvoices();
            document.getElementById('invoicesTabBadge').textContent = this.data.invoices.length;
        } catch (error) {
            showAlertModal(error.message, 'error');
            throw error;
        }
    }

    async emailInvoice() {
        if (!this.editingInvoice) return;
        const defaultEmail = this.editingInvoice.to?.email
            || this.data.project?.client?.email
            || '';
        const values = await showPromptModal({
            title: 'Send Invoice',
            message: 'Email the invoice link to your client.',
            confirmText: 'Send Email',
            fields: [{
                name: 'email',
                label: 'Recipient email',
                type: 'email',
                value: defaultEmail,
                required: true
            }]
        });
        if (!values?.email) return;
        try {
            await this.saveInvoice({ silent: true });
            const result = await CRM.api(`/api/invoices/${this.editingInvoice._id}/email`, {
                method: 'POST',
                body: { email: values.email }
            });
            this.editingInvoice = result.invoice;
            await this.load();
            this.renderInvoices();
            this.renderInvoiceEditor();
            showAlertModal(
                `Invoice emailed to <strong>${CRM.escapeHtml((result.emailedTo || [values.email]).join(', '))}</strong>.`,
                'success', 'Invoice Sent', false, true
            );
        } catch (error) {
            if (error.message) showAlertModal(error.message, 'error');
        }
    }

    async sendInvoice() {
        try {
            await this.saveInvoice({ silent: true });
            const result = await CRM.api(`/api/invoices/${this.editingInvoice._id}/send`, { method: 'POST' });
            this.editingInvoice = result.invoice;
            await this.load();
            this.renderInvoices();
            this.renderInvoiceEditor();
            const copied = await CRM.copyToClipboard(result.link);
            showAlertModal(
                `Invoice link ready${copied ? ' (copied to clipboard)' : ''}:<br><code>${CRM.escapeHtml(result.link)}</code><br><br>This is the formal invoice your client can view and pay online.`,
                'success', 'Shareable Link Ready', false, true
            );
        } catch (error) {
            if (error.message) showAlertModal(error.message, 'error');
        }
    }

    async markInvoicePaid(invoiceId) {
        const paidDate = await this.promptPaidDate(
            'Mark Invoice Paid',
            'All unpaid installments will be marked paid. Choose the date the payment was received.'
        );
        if (!paidDate) return;
        try {
            await CRM.api(`/api/invoices/${invoiceId}/mark-paid`, {
                method: 'POST',
                body: { paidDate }
            });
            showAlertModal('Invoice marked as paid.', 'success', null, true);
            await this.reload();
            this.showTab('invoices');
            if (this.editingInvoice && String(this.editingInvoice._id) === String(invoiceId)) {
                await this.editInvoice(invoiceId);
            }
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async markInstallmentPaid(invoiceId, index) {
        const paidDate = await this.promptPaidDate(
            'Mark Installment Paid',
            'Choose the date this payment was received (outside Stripe).'
        );
        if (!paidDate) return;
        try {
            await CRM.api(`/api/invoices/${invoiceId}/mark-installment-paid`, {
                method: 'POST',
                body: { index, paidDate }
            });
            showAlertModal('Installment marked as paid.', 'success', null, true);
            await this.reload();
            this.showTab('invoices');
            await this.editInvoice(invoiceId);
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async voidOrDeleteInvoice(invoiceId, status) {
        const isDraft = status === 'draft';
        const confirmed = await showConfirmModal(
            isDraft ? 'Delete this draft invoice?' : 'Void this invoice? The shareable link will stop working.',
            isDraft ? 'Delete Invoice' : 'Void Invoice',
            isDraft ? 'Delete' : 'Void'
        );
        if (!confirmed) return;
        try {
            if (isDraft) {
                await CRM.api(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
            } else {
                await CRM.api(`/api/invoices/${invoiceId}/void`, { method: 'POST' });
            }
            if (this.editingInvoice && this.editingInvoice._id === invoiceId) {
                this.closeInvoiceEditor();
            }
            await this.reload();
            this.showTab('invoices');
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }
}

const projectPage = new ProjectPage();
window.projectPage = projectPage;
