const PortalShare = {
    ensureModal() {
        if (document.getElementById('portalShareModal')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="portalShareModal" class="modal portal-share-modal" style="display:none">
                <div class="modal-content portal-share-content">
                    <div class="modal-header">
                        <div class="portal-share-heading">
                            <h2 id="portalShareTitle">Client portal</h2>
                            <p class="portal-share-subtitle" id="portalShareSubtitle"></p>
                        </div>
                        <span class="close" onclick="PortalShare.close()">&times;</span>
                    </div>
                    <div class="modal-body" id="portalShareBody"></div>
                    <div class="modal-buttons portal-share-footer" id="portalShareFooter" hidden></div>
                </div>
            </div>`);
    },

    openPerson() {
        const client = window.projectPage?.data?.project?.client;
        const clientId = client?._id || client;
        if (!clientId) {
            showAlertModal('Save a client on this project first.', 'error');
            return;
        }
        this.open({
            scope: 'person',
            clientId: String(clientId),
            label: client?.name || 'this person'
        });
    },

    openCompany() {
        const company = document.getElementById('clientCompany')?.value?.trim()
            || window.projectPage?.data?.project?.client?.company
            || '';
        if (!company) {
            showAlertModal('Add a company name before sharing a company portal.', 'error');
            return;
        }
        this.open({ scope: 'company', company, label: company });
    },

    async open(opts) {
        this.ensureModal();
        this.opts = opts;
        const title = opts.scope === 'company' ? 'Company portal' : 'Person portal';
        document.getElementById('portalShareTitle').textContent = title;
        document.getElementById('portalShareSubtitle').textContent = opts.label || '';
        document.getElementById('portalShareBody').innerHTML = '<div class="crm-loading">Loading…</div>';
        const footer = document.getElementById('portalShareFooter');
        footer.hidden = true;
        footer.innerHTML = '';
        document.getElementById('portalShareModal').style.display = 'flex';
        try {
            const params = new URLSearchParams({ scope: opts.scope });
            if (opts.clientId) params.set('clientId', opts.clientId);
            if (opts.company) params.set('company', opts.company);
            const data = await CRM.api(`/api/portals?${params}`);
            this.render(data);
        } catch (error) {
            document.getElementById('portalShareBody').innerHTML = `<p class="portal-share-error">${CRM.escapeHtml(error.message)}</p>`;
        }
    },

    statusChip(data) {
        if (!data.exists) return '<span class="crm-chip crm-chip--none">Not created</span>';
        return data.enabled
            ? '<span class="crm-chip crm-chip--paid">On</span>'
            : '<span class="crm-chip crm-chip--invoiced">Off</span>';
    },

    copyRow({ id, value, copyId, extra }) {
        return `
            <div class="portal-share-row">
                <input type="text" id="${id}" readonly value="${CRM.escapeHtml(value || '')}">
                <div class="portal-share-row-actions">
                    <button type="button" class="secondary-button" id="${copyId}">Copy</button>
                    ${extra || ''}
                </div>
            </div>`;
    },

    render(data) {
        this.data = data;
        this.removeLogo = false;
        const isCompany = data.scope === 'company';
        const scopeNote = isCompany
            ? 'Anyone with this link and password can see every project, contract, and invoice for this company.'
            : 'Anyone with this link and password can see this person’s projects, contracts, and invoices.';
        document.getElementById('portalShareTitle').textContent = isCompany ? 'Company portal' : 'Person portal';
        document.getElementById('portalShareSubtitle').innerHTML = `
            <span class="portal-share-name">${CRM.escapeHtml(data.label || this.opts?.label || '')}</span>
            ${this.statusChip(data)}`;

        const linkSection = data.link ? `
            <div class="portal-share-field">
                <label for="portalShareLink">Portal link</label>
                ${this.copyRow({
                    id: 'portalShareLink',
                    value: data.link,
                    copyId: 'portalCopyLink',
                    extra: `<a class="primary-button" id="portalOpenLink" href="${CRM.escapeHtml(data.link)}" target="_blank" rel="noopener noreferrer">Open portal</a>`
                })}
            </div>` : `
            <div class="portal-share-empty">
                Save the portal to create a shareable link.
            </div>`;

        const currentPassword = data.canViewPassword && data.password ? `
            <div class="portal-share-field">
                <label for="portalCurrentPassword">Current password</label>
                ${this.copyRow({
                    id: 'portalCurrentPassword',
                    value: data.password,
                    copyId: 'portalCopyPassword'
                })}
            </div>` : '';

        const passwordLabel = data.hasPassword ? 'New password' : 'Password';
        const passwordPlaceholder = data.hasPassword
            ? 'Leave blank to keep the current password'
            : 'At least 6 characters';
        const passwordHint = data.canViewPassword
            ? (data.password
                ? 'Copy the password and send it with the link. A new one must be at least 6 characters.'
                : (data.hasPassword
                    ? 'This password was saved before it could be shown. Set a new one of at least 6 characters to view it here.'
                    : 'At least 6 characters. You’ll be able to view it here after saving.'))
            : 'At least 6 characters.';

        const logoPreview = data.logoUrl
            ? `<img class="portal-share-logo-img" src="${CRM.escapeHtml(data.logoUrl)}" alt="Company logo">`
            : '<span class="portal-share-logo-placeholder">No logo</span>';

        document.getElementById('portalShareBody').innerHTML = `
            <p class="portal-share-note">${scopeNote}</p>
            <section class="portal-share-section">
                <h3>Access</h3>
                ${linkSection}
                ${currentPassword}
                <div class="portal-share-field">
                    <label for="portalSharePassword">${passwordLabel}</label>
                    <input type="${data.canViewPassword ? 'text' : 'password'}"
                           id="portalSharePassword"
                           placeholder="${passwordPlaceholder}"
                           autocomplete="${data.canViewPassword ? 'off' : 'new-password'}">
                    <p class="field-hint">${passwordHint}</p>
                </div>
            </section>
            <section class="portal-share-section">
                <h3>Branding</h3>
                <div class="portal-share-logo">
                    <div class="portal-share-logo-preview" id="portalShareLogoPreview">${logoPreview}</div>
                    <div class="portal-share-logo-actions">
                        <label class="secondary-button portal-share-file-btn">
                            ${data.logoUrl ? 'Replace image' : 'Upload logo'}
                            <input type="file" id="portalShareLogo" hidden accept="image/png,image/jpeg,image/webp,image/gif">
                        </label>
                        ${data.logoUrl ? '<button type="button" class="tertiary-button" id="portalRemoveLogoBtn">Remove</button>' : ''}
                        <p class="field-hint">PNG, JPG, WebP, or GIF. Shown at the top of the client portal.</p>
                    </div>
                </div>
            </section>`;

        const footer = document.getElementById('portalShareFooter');
        footer.hidden = false;
        footer.innerHTML = `
            ${data.exists ? `<button type="button" class="secondary-button" id="portalToggleBtn">${data.enabled ? 'Turn off' : 'Turn on'}</button>` : ''}
            <button type="button" class="primary-button" id="portalSaveBtn">${data.exists ? 'Save changes' : 'Create portal'}</button>`;

        document.getElementById('portalCopyLink')?.addEventListener('click', async () => {
            const ok = await CRM.copyToClipboard(data.link);
            showAlertModal(ok ? 'Portal link copied.' : 'Could not copy the link.', ok ? 'success' : 'error', null, ok);
        });
        document.getElementById('portalCopyPassword')?.addEventListener('click', async () => {
            const ok = await CRM.copyToClipboard(data.password);
            showAlertModal(ok ? 'Password copied.' : 'Could not copy the password.', ok ? 'success' : 'error', null, ok);
        });
        document.getElementById('portalShareLogo')?.addEventListener('change', (event) => this.previewLogo(event.target.files?.[0]));
        document.getElementById('portalRemoveLogoBtn')?.addEventListener('click', () => this.toggleRemoveLogo());
        document.getElementById('portalSaveBtn').addEventListener('click', () => this.save());
        document.getElementById('portalToggleBtn')?.addEventListener('click', () => this.save({ enabled: !data.enabled, keepPassword: true }));
    },

    previewLogo(file) {
        const preview = document.getElementById('portalShareLogoPreview');
        if (!file || !preview) return;
        this.removeLogo = false;
        preview.classList.remove('is-removing');
        const reader = new FileReader();
        reader.onload = () => {
            preview.innerHTML = `<img class="portal-share-logo-img" src="${reader.result}" alt="Logo preview">`;
        };
        reader.readAsDataURL(file);
        const removeBtn = document.getElementById('portalRemoveLogoBtn');
        if (removeBtn) removeBtn.textContent = 'Remove';
    },

    toggleRemoveLogo() {
        const preview = document.getElementById('portalShareLogoPreview');
        const input = document.getElementById('portalShareLogo');
        const btn = document.getElementById('portalRemoveLogoBtn');
        this.removeLogo = !this.removeLogo;
        if (this.removeLogo && input) input.value = '';
        preview?.classList.toggle('is-removing', this.removeLogo);
        if (btn) btn.textContent = this.removeLogo ? 'Undo remove' : 'Remove';
    },

    readLogoFile() {
        const input = document.getElementById('portalShareLogo');
        const file = input?.files?.[0];
        if (!file) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read that logo.'));
            reader.readAsDataURL(file);
        });
    },

    async save(extra = {}) {
        const password = extra.keepPassword ? '' : document.getElementById('portalSharePassword').value;
        if (!extra.keepPassword && password.length > 0 && password.length < 6) {
            showAlertModal('Password must be at least 6 characters.', 'error');
            return;
        }
        if (!extra.keepPassword && !this.data?.hasPassword && password.length < 6) {
            showAlertModal('Set a password of at least 6 characters.', 'error');
            return;
        }
        const removeLogo = !!this.removeLogo;
        let logoData = null;
        try {
            if (!removeLogo) logoData = await this.readLogoFile();
            const data = await CRM.api('/api/portals', {
                method: 'POST',
                body: {
                    scope: this.opts.scope,
                    clientId: this.opts.clientId,
                    company: this.opts.company,
                    password,
                    enabled: extra.enabled,
                    logoData,
                    removeLogo
                }
            });
            showAlertModal('Portal saved. Send the link and password to your client.', 'success', null, true);
            this.render(data);
            window.clientsManager?.load?.();
        } catch (error) {
            showAlertModal(error.message, 'error');
        }
    },

    close() {
        const modal = document.getElementById('portalShareModal');
        if (modal) modal.style.display = 'none';
    }
};

window.PortalShare = PortalShare;
