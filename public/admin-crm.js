/**
 * Admin: page tabs, contract template workspace + company settings.
 */

const ADMIN_TABS = ['services', 'contracts', 'company', 'payments', 'users'];

function showAdminTab(tab) {
    if (!ADMIN_TABS.includes(tab)) tab = 'services';
    document.querySelectorAll('#adminTabs .crm-tab').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });
    ADMIN_TABS.forEach((t) => {
        document.getElementById(`admin-panel-${t}`)?.classList.toggle('is-active', t === tab);
    });
    history.replaceState(null, '', `#${tab}`);
}
window.showAdminTab = showAdminTab;

// Deep links like /admin#contracts open on the right tab
const initialAdminTab = window.location.hash.replace('#', '');
if (ADMIN_TABS.includes(initialAdminTab)) showAdminTab(initialAdminTab);

const TEMPLATE_CATEGORIES = ['Photography', 'Videography', 'Headshot Booth', 'AI', 'Other'];

const MERGE_TOKENS = [
    { token: 'client_name', label: 'Client name' },
    { token: 'client_company', label: 'Client company' },
    { token: 'client_email', label: 'Client email' },
    { token: 'client_phone', label: 'Client phone' },
    { token: 'client_address', label: 'Client address' },
    { token: 'our_company', label: 'Our company' },
    { token: 'project_name', label: 'Project name' },
    { token: 'project_dates', label: 'Project dates' },
    { token: 'investment', label: 'Investment' },
    { token: 'service_name', label: 'Service name(s)' },
    { token: 'service_role', label: 'Provider role' },
    { token: 'photo_delivery', label: 'Photo delivery' },
    { token: 'video_delivery', label: 'Video delivery' }
];

// Sample values used by the in-editor preview
const SAMPLE_MERGE_DATA = {
    client_name: 'Jane Smith',
    client_company: 'Acme Corp',
    client_company_clause: ' of Acme Corp',
    client_email: 'jane@acmecorp.com',
    client_phone: '(555) 123-4567',
    client_address: '123 Main St, Denver, CO 80202',
    company_name: 'Acme Corp',
    our_company: 'Lumetry Media',
    our_email: 'sales@lumetrymedia.com',
    our_phone: '(555) 987-6543',
    project_name: 'Acme Annual Conference',
    project_dates: 'March 12 – March 14, 2026',
    investment: '$4,850.00',
    service_name: 'Event Videography',
    service_names: 'Event Videography',
    service_role: 'Videographer',
    photo_delivery: 'within forty-eight (48) hours after the event via online gallery',
    video_delivery: 'within one (1) week of the final project date (60–90 second highlight)'
};

class AdminCrm {
    constructor() {
        this.templates = [];
        this.services = [];
        this.selectedId = null;      // template _id being edited, or null
        this.isNew = false;          // editor holds an unsaved clause
        this.newPrefill = null;      // { name, serviceId } when creating from a missing-language row
        this.targets = { alwaysInclude: false, categories: [], services: [] };
        this.searchTerm = '';
        this.previewOn = false;
        this.dragId = null;
        this.init();
    }

    async init() {
        this.bindForms();
        await this.loadServices();
        await Promise.all([this.loadTemplates(), this.loadCompanySettings()]);
        if (this.templates.length > 0) {
            this.selectClause(this.templates[0]._id);
        } else {
            this.renderClauseList();
            this.renderEditor();
        }
    }

    bindForms() {
        document.getElementById('company-settings-form')?.addEventListener('submit', (e) => this.saveCompanySettings(e));
        document.getElementById('payment-settings-form')?.addEventListener('submit', (e) => this.savePaymentSettings(e));
    }

    async loadServices() {
        try {
            this.services = await CRM.api('/api/services');
        } catch (error) {
            console.error('Error loading services:', error);
            this.services = [];
        }
    }

    async loadTemplates() {
        try {
            this.templates = await CRM.api('/api/contract-templates');
            this.renderClauseList();
        } catch (error) {
            console.error('Error loading templates:', error);
        }
    }

    // ---------- Sidebar: clause list ----------

    onSearch(value) {
        this.searchTerm = value.toLowerCase().trim();
        this.renderClauseList();
    }

    templateTargetNames(t) {
        const names = [];
        if (t.alwaysInclude) names.push('Always included');
        (t.categories || []).forEach((c) => names.push(c));
        (t.services || []).forEach((s) => { if (s?.name) names.push(s.name); });
        return names;
    }

    matchesSearch(t) {
        if (!this.searchTerm) return true;
        const haystack = [t.name, ...this.templateTargetNames(t)].join(' ').toLowerCase();
        return haystack.includes(this.searchTerm);
    }

    /** Templates that a given service would pull into a generated contract. */
    templatesForService(service) {
        const category = String(service.category || '').toLowerCase();
        return this.templates.filter((t) => {
            if (t.alwaysInclude) return true;
            if ((t.services || []).some((s) => String(s?._id || s) === String(service._id))) return true;
            return (t.categories || []).some((c) => String(c).toLowerCase() === category);
        });
    }

    servicesMissingLanguage() {
        return this.services.filter((service) =>
            !this.templatesForService(service).some((t) => !t.alwaysInclude));
    }

    renderClauseList() {
        const container = document.getElementById('tplClauseList');
        if (!container) return;

        const visible = this.templates.filter((t) => this.matchesSearch(t));
        const missing = this.servicesMissingLanguage().filter((s) =>
            !this.searchTerm || s.name.toLowerCase().includes(this.searchTerm));

        let html = '';
        if (visible.length === 0 && this.templates.length > 0) {
            html += '<p class="crm-inline-note" style="padding:12px">No clauses match your search.</p>';
        } else if (this.templates.length === 0) {
            html += '<p class="crm-inline-note" style="padding:12px">No clauses yet. Click "+ New Clause" to add your first one.</p>';
        } else {
            html += '<div class="tpl-list-label">Clauses — in contract order, drag to reorder</div>';
            html += visible.map((t) => {
                const chips = this.templateTargetNames(t).map((n) =>
                    `<span class="tpl-mini-chip${t.alwaysInclude ? ' always' : ''}">${CRM.escapeHtml(n)}</span>`).join('');
                const selected = !this.isNew && String(t._id) === String(this.selectedId);
                return `
                    <div class="tpl-row${selected ? ' is-selected' : ''}" draggable="true" data-id="${t._id}"
                         onclick="adminCrm.selectClause('${t._id}')">
                        <div class="tpl-row-name">${CRM.escapeHtml(t.name)}</div>
                        <div class="tpl-row-chips">${chips || '<span class="tpl-mini-chip warn">Not mapped</span>'}</div>
                    </div>`;
            }).join('');
        }

        if (missing.length > 0) {
            html += '<div class="tpl-list-label warn">Services missing language</div>';
            html += missing.map((s) => `
                <div class="tpl-row tpl-missing" onclick="adminCrm.newClause('${s._id}')">
                    <div class="tpl-row-name">${s.icon ? s.icon + ' ' : ''}${CRM.escapeHtml(s.name)}</div>
                    <div class="tpl-row-chips"><span class="tpl-mini-chip warn">Click to add language</span></div>
                </div>`).join('');
        }

        container.innerHTML = html;
        this.attachDragHandlers(container);
    }

    attachDragHandlers(container) {
        container.querySelectorAll('.tpl-row[draggable="true"]').forEach((row) => {
            row.addEventListener('dragstart', (e) => {
                this.dragId = row.dataset.id;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            row.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                this.dragId = null;
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                row.classList.add('drag-over');
            });
            row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
                if (this.dragId && this.dragId !== row.dataset.id) {
                    this.reorderClause(this.dragId, row.dataset.id);
                }
            });
        });
    }

    async reorderClause(draggedId, targetId) {
        const fromIndex = this.templates.findIndex((t) => String(t._id) === String(draggedId));
        const toIndex = this.templates.findIndex((t) => String(t._id) === String(targetId));
        if (fromIndex === -1 || toIndex === -1) return;

        const [moved] = this.templates.splice(fromIndex, 1);
        this.templates.splice(toIndex, 0, moved);
        this.renderClauseList();

        try {
            const updates = [];
            this.templates.forEach((t, i) => {
                const sortOrder = (i + 1) * 10;
                if (t.sortOrder !== sortOrder) {
                    t.sortOrder = sortOrder;
                    updates.push(CRM.api(`/api/contract-templates/${t._id}`, { method: 'PUT', body: { sortOrder } }));
                }
            });
            await Promise.all(updates);
        } catch (error) {
            showAlertModal('Failed to save the new order: ' + error.message, 'error');
            await this.loadTemplates();
        }
    }

    // ---------- Editor pane ----------

    selectClause(id) {
        const template = this.templates.find((t) => String(t._id) === String(id));
        if (!template) return;
        this.selectedId = id;
        this.isNew = false;
        this.newPrefill = null;
        this.previewOn = false;
        this.targets = {
            alwaysInclude: !!template.alwaysInclude,
            categories: [...(template.categories || [])],
            services: (template.services || []).map((s) => String(s?._id || s))
        };
        this.renderClauseList();
        this.renderEditor();
    }

    newClause(prefillServiceId = null) {
        this.selectedId = null;
        this.isNew = true;
        this.previewOn = false;
        const service = prefillServiceId
            ? this.services.find((s) => String(s._id) === String(prefillServiceId))
            : null;
        this.newPrefill = service ? { name: `${service.name} Terms`, serviceId: String(service._id) } : null;
        this.targets = {
            alwaysInclude: false,
            categories: [],
            services: service ? [String(service._id)] : []
        };
        this.renderClauseList();
        this.renderEditor();
        document.getElementById('tplName')?.focus();
    }

    currentTemplate() {
        return this.templates.find((t) => String(t._id) === String(this.selectedId)) || null;
    }

    renderEditor() {
        const container = document.getElementById('tplEditor');
        if (!container) return;

        if (!this.isNew && !this.selectedId) {
            container.innerHTML = `
                <div class="tpl-empty-state">
                    <p>Select a clause on the left, or create a new one.</p>
                    <button type="button" class="primary-button" onclick="adminCrm.newClause()">+ New Clause</button>
                </div>`;
            return;
        }

        const template = this.currentTemplate();
        const name = this.isNew ? (this.newPrefill?.name || '') : (template?.name || '');
        const body = this.isNew ? '' : (template?.body || '');

        const tokenChips = MERGE_TOKENS.map(({ token, label }) =>
            `<button type="button" class="tpl-token" onclick="adminCrm.insertToken('${token}')" title="Inserts {{${token}}}">${label}</button>`).join('');

        container.innerHTML = `
            <div class="tpl-editor-head">
                <input type="text" id="tplName" placeholder="Clause name (e.g., Videography Terms)" value="${CRM.escapeHtml(name)}">
                <div class="tpl-editor-head-actions">
                    <button type="button" class="crm-btn-sm" id="tplPreviewBtn" onclick="adminCrm.togglePreview()">Preview</button>
                    ${!this.isNew ? `<button type="button" class="crm-btn-sm danger" onclick="adminCrm.deleteClause()">Delete</button>` : ''}
                </div>
            </div>

            <div class="tpl-applies">
                <label class="checkbox-label" style="margin:0">
                    <input type="checkbox" id="tplAlways" ${this.targets.alwaysInclude ? 'checked' : ''}
                           onchange="adminCrm.toggleAlways(this.checked)">
                    <span class="checkbox-text">Always include — general terms that go in every contract</span>
                </label>
                <div class="tpl-target-row" id="tplTargetRow" ${this.targets.alwaysInclude ? 'hidden' : ''}>
                    <span class="tpl-target-label">Applies to:</span>
                    <span id="tplTargetChips"></span>
                    <select id="tplAddTarget" class="tpl-add-target" onchange="adminCrm.addTarget(this.value); this.value=''">
                        <option value="">+ Add category or service…</option>
                        <optgroup label="Categories (all services in it)">
                            ${TEMPLATE_CATEGORIES.map((c) => `<option value="cat:${CRM.escapeHtml(c)}">${CRM.escapeHtml(c)}</option>`).join('')}
                        </optgroup>
                        <optgroup label="Specific services">
                            ${this.services.map((s) => `<option value="svc:${s._id}">${CRM.escapeHtml(s.name)}</option>`).join('')}
                        </optgroup>
                    </select>
                </div>
            </div>

            <div class="contract-editor-toolbar" id="tplEditorToolbar"></div>
            <div class="contract-editor tpl-body" id="tplBody" contenteditable="true"
                 data-placeholder="Paste or write the contract language for this clause...">${body}</div>

            <div class="tpl-token-bar">
                <span class="tpl-target-label">Insert field:</span>
                ${tokenChips}
            </div>
            <small class="form-help">Fields are filled in automatically when a contract is generated — "Provider role" becomes Photographer, Videographer, etc. based on the services in the project's quote. Use Preview to see sample output.</small>

            <div class="tpl-preview" id="tplPreview" hidden>
                <div class="tpl-preview-label">Preview with sample project data</div>
                <div class="tpl-preview-body" id="tplPreviewBody"></div>
            </div>

            <div class="crm-actions-row" style="margin-top:14px">
                <button type="button" class="primary-button" onclick="adminCrm.saveClause()">${this.isNew ? 'Create Clause' : 'Save Clause'}</button>
                ${this.isNew ? `<button type="button" class="secondary-button" onclick="adminCrm.cancelNew()">Cancel</button>` : ''}
            </div>`;

        this.renderTargetChips();
        this.mountTemplateEditor();
    }

    mountTemplateEditor() {
        const toolbar = document.getElementById('tplEditorToolbar');
        if (!toolbar || !window.ContractEditor) return;
        this.templateEditorApi = ContractEditor.mountToolbar(toolbar, {
            getEditorEl: () => document.getElementById('tplBody')
        });
        const body = document.getElementById('tplBody');
        if (body && this.previewOn) {
            body.addEventListener('input', () => this.updatePreview());
        }
    }

    renderTargetChips() {
        const holder = document.getElementById('tplTargetChips');
        if (!holder) return;
        const chips = [];
        this.targets.categories.forEach((c) => {
            chips.push(`<span class="tpl-chip">${CRM.escapeHtml(c)}<button type="button" onclick="adminCrm.removeTarget('cat', '${CRM.escapeJs(c)}')" title="Remove">&times;</button></span>`);
        });
        this.targets.services.forEach((id) => {
            const service = this.services.find((s) => String(s._id) === String(id));
            const label = service ? service.name : 'Unknown service';
            chips.push(`<span class="tpl-chip">${CRM.escapeHtml(label)}<button type="button" onclick="adminCrm.removeTarget('svc', '${id}')" title="Remove">&times;</button></span>`);
        });
        holder.innerHTML = chips.length ? chips.join('') : '<span class="tpl-chip muted">Nothing yet — pick below</span>';
    }

    toggleAlways(checked) {
        this.targets.alwaysInclude = checked;
        const row = document.getElementById('tplTargetRow');
        if (row) row.hidden = checked;
    }

    addTarget(value) {
        if (!value) return;
        const [kind, id] = [value.slice(0, 3), value.slice(4)];
        if (kind === 'cat' && !this.targets.categories.some((c) => c.toLowerCase() === id.toLowerCase())) {
            this.targets.categories.push(id);
        }
        if (kind === 'svc' && !this.targets.services.includes(id)) {
            this.targets.services.push(id);
        }
        this.renderTargetChips();
    }

    removeTarget(kind, id) {
        if (kind === 'cat') this.targets.categories = this.targets.categories.filter((c) => c !== id);
        if (kind === 'svc') this.targets.services = this.targets.services.filter((s) => s !== id);
        this.renderTargetChips();
    }

    execCmd(command, value = null) {
        if (this.templateEditorApi) {
            this.templateEditorApi.execCmd(command, value);
            return;
        }
        document.getElementById('tplBody')?.focus();
        document.execCommand(command, false, value);
    }

    insertToken(token) {
        const body = document.getElementById('tplBody');
        if (!body) return;
        body.focus();
        document.execCommand('insertText', false, `{{${token}}}`);
        if (this.previewOn) this.updatePreview();
    }

    togglePreview() {
        this.previewOn = !this.previewOn;
        const panel = document.getElementById('tplPreview');
        const btn = document.getElementById('tplPreviewBtn');
        if (panel) panel.hidden = !this.previewOn;
        if (btn) btn.classList.toggle('is-on', this.previewOn);
        if (this.previewOn) this.updatePreview();
    }

    updatePreview() {
        const body = document.getElementById('tplBody');
        const out = document.getElementById('tplPreviewBody');
        if (!body || !out) return;
        const html = body.innerHTML.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
            const value = SAMPLE_MERGE_DATA[key.toLowerCase()];
            return value !== undefined ? `<mark>${CRM.escapeHtml(value)}</mark>` : match;
        });
        out.innerHTML = html || '<p class="crm-inline-note">Nothing to preview yet.</p>';
    }

    cancelNew() {
        this.isNew = false;
        this.newPrefill = null;
        if (this.templates.length > 0) {
            this.selectClause(this.templates[0]._id);
        } else {
            this.renderClauseList();
            this.renderEditor();
        }
    }

    async saveClause() {
        const name = document.getElementById('tplName')?.value.trim();
        const tplBody = document.getElementById('tplBody');
        const body = (window.ContractEditor && tplBody
            ? ContractEditor.getEditorHtml(tplBody)
            : tplBody?.innerHTML) || '';
        if (!name) {
            showAlertModal('Give the clause a name first.', 'error');
            return;
        }
        const payload = {
            name,
            body,
            alwaysInclude: this.targets.alwaysInclude,
            categories: this.targets.categories,
            services: this.targets.services
        };
        try {
            let savedId = this.selectedId;
            if (this.isNew) {
                const maxSort = Math.max(0, ...this.templates.map((t) => t.sortOrder || 0));
                const created = await CRM.api('/api/contract-templates', {
                    method: 'POST',
                    body: { ...payload, sortOrder: maxSort + 10 }
                });
                savedId = created._id;
            } else {
                await CRM.api(`/api/contract-templates/${this.selectedId}`, { method: 'PUT', body: payload });
            }
            await this.loadTemplates();
            this.selectClause(savedId);
            showAlertModal('Clause saved.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async deleteClause() {
        const template = this.currentTemplate();
        if (!template) return;
        const confirmed = await showConfirmModal(`Delete clause "${template.name}"?`, 'Delete Clause', 'Delete');
        if (!confirmed) return;
        try {
            await CRM.api(`/api/contract-templates/${template._id}`, { method: 'DELETE' });
            this.selectedId = null;
            await this.loadTemplates();
            if (this.templates.length > 0) {
                this.selectClause(this.templates[0]._id);
            } else {
                this.renderEditor();
            }
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    // ---------- Company settings ----------

    async loadCompanySettings() {
        try {
            const s = await CRM.api('/api/company-settings');
            document.getElementById('cs-companyName').value = s.companyName || '';
            document.getElementById('cs-email').value = s.email || '';
            document.getElementById('cs-phone').value = s.phone || '';
            document.getElementById('cs-website').value = s.website || '';
            document.getElementById('cs-street').value = s.address?.street || '';
            document.getElementById('cs-city').value = s.address?.city || '';
            document.getElementById('cs-state').value = s.address?.state || '';
            document.getElementById('cs-zip').value = s.address?.zip || '';
            document.getElementById('cs-signerName').value = s.contractSignerName || '';
            document.getElementById('cs-signerTitle').value = s.contractSignerTitle || '';
            document.getElementById('cs-invoiceFooter').value = s.invoiceFooterDefault || '';
            document.getElementById('ps-cardFeeEnabled').checked = !!s.cardFeeEnabled;
            document.getElementById('ps-cardFeePercent').value = s.cardFeePercent ?? 3;
            document.getElementById('ps-achEnabled').checked = !!s.achEnabled;
        } catch (error) {
            console.error('Error loading company settings:', error);
        }
    }

    async savePaymentSettings(event) {
        event.preventDefault();
        try {
            await CRM.api('/api/company-settings', {
                method: 'PUT',
                body: {
                    cardFeeEnabled: document.getElementById('ps-cardFeeEnabled').checked,
                    cardFeePercent: Number(document.getElementById('ps-cardFeePercent').value) || 0,
                    achEnabled: document.getElementById('ps-achEnabled').checked
                }
            });
            showAlertModal('Payment settings saved.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }

    async saveCompanySettings(event) {
        event.preventDefault();
        try {
            await CRM.api('/api/company-settings', {
                method: 'PUT',
                body: {
                    companyName: document.getElementById('cs-companyName').value.trim(),
                    email: document.getElementById('cs-email').value.trim(),
                    phone: document.getElementById('cs-phone').value.trim(),
                    website: document.getElementById('cs-website').value.trim(),
                    address: {
                        street: document.getElementById('cs-street').value.trim(),
                        city: document.getElementById('cs-city').value.trim(),
                        state: document.getElementById('cs-state').value.trim(),
                        zip: document.getElementById('cs-zip').value.trim()
                    },
                    contractSignerName: document.getElementById('cs-signerName').value.trim(),
                    contractSignerTitle: document.getElementById('cs-signerTitle').value.trim(),
                    invoiceFooterDefault: document.getElementById('cs-invoiceFooter').value
                }
            });
            showAlertModal('Company settings saved.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    }
}

const adminCrm = new AdminCrm();
window.adminCrm = adminCrm;
