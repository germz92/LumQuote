const PortalShare = {
    ensureModal() {
        if (document.getElementById('portalShareModal')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="portalShareModal" class="modal" style="display:none">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 id="portalShareTitle">Client portal</h2>
                        <span class="close" onclick="PortalShare.close()">&times;</span>
                    </div>
                    <div class="modal-body" id="portalShareBody"></div>
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
        document.getElementById('portalShareTitle').textContent = opts.scope === 'company'
            ? 'Company portal'
            : 'Person portal';
        document.getElementById('portalShareBody').innerHTML = '<div class="crm-loading">Loading…</div>';
        document.getElementById('portalShareModal').style.display = 'flex';
        try {
            const params = new URLSearchParams({ scope: opts.scope });
            if (opts.clientId) params.set('clientId', opts.clientId);
            if (opts.company) params.set('company', opts.company);
            const data = await CRM.api(`/api/portals?${params}`);
            this.render(data);
        } catch (error) {
            document.getElementById('portalShareBody').innerHTML = `<p>${CRM.escapeHtml(error.message)}</p>`;
        }
    },

    render(data) {
        this.data = data;
        const scopeNote = data.scope === 'company'
            ? 'Anyone with this link and password can see every project, contract, and invoice for this company.'
            : 'Anyone with this link and password can see this person’s projects, contracts, and invoices.';
        const status = !data.exists
            ? 'Not created yet'
            : (data.enabled ? 'On' : 'Off');
        const passwordFields = data.canViewPassword
            ? `${data.password ? `
                <label for="portalCurrentPassword">Password</label>
                <div class="portal-link-row">
                    <input type="text" id="portalCurrentPassword" readonly value="${CRM.escapeHtml(data.password)}">
                    <button type="button" class="secondary-button" id="portalCopyPassword">Copy password</button>
                </div>
                <label for="portalSharePassword">New password</label>
                <input type="text" id="portalSharePassword" placeholder="Leave blank to keep the current password" autocomplete="off">
                <p class="field-hint">This password is visible to admins. A new one must be at least 6 characters.</p>` : `
                <label for="portalSharePassword">${data.hasPassword ? 'New password' : 'Password'}</label>
                <input type="text" id="portalSharePassword" placeholder="At least 6 characters" autocomplete="off">
                <p class="field-hint">${data.hasPassword
                    ? 'This password was saved before it could be shown. Set a new one of at least 6 characters to view it here.'
                    : 'At least 6 characters. You’ll be able to view it here after saving.'}</p>`}`
            : `
                <label for="portalSharePassword">${data.hasPassword ? 'New password' : 'Password'}</label>
                <input type="password" id="portalSharePassword" placeholder="${data.hasPassword ? 'Leave blank to keep the current password' : 'At least 6 characters'}" autocomplete="new-password">
                <p class="field-hint">At least 6 characters.</p>`;
        document.getElementById('portalShareBody').innerHTML = `
            <p class="crm-inline-note">${scopeNote}</p>
            <p><strong>${CRM.escapeHtml(data.label || '')}</strong> · ${CRM.escapeHtml(status)}</p>
            ${data.link ? `
                <label>Portal link</label>
                <div class="portal-link-row">
                    <input type="text" id="portalShareLink" readonly value="${CRM.escapeHtml(data.link)}">
                    <button type="button" class="secondary-button" id="portalCopyLink">Copy link</button>
                </div>` : ''}
            ${data.logoUrl ? `<img class="portal-company-logo" src="${CRM.escapeHtml(data.logoUrl)}" alt="Company logo">` : ''}
            <label for="portalShareLogo">Company logo</label>
            <input type="file" id="portalShareLogo" accept="image/png,image/jpeg,image/webp,image/gif">
            ${data.logoUrl ? '<label class="portal-remove-logo"><input type="checkbox" id="portalRemoveLogo"> Remove logo</label>' : ''}
            ${passwordFields}
            <div class="crm-actions-row">
                <button type="button" class="primary-button" id="portalSaveBtn">Save portal</button>
                ${data.exists ? `<button type="button" class="secondary-button" id="portalToggleBtn">${data.enabled ? 'Turn off' : 'Turn on'}</button>` : ''}
            </div>`;
        document.getElementById('portalCopyLink')?.addEventListener('click', async () => {
            const ok = await CRM.copyToClipboard(data.link);
            showAlertModal(ok ? 'Portal link copied.' : 'Could not copy the link.', ok ? 'success' : 'error', null, ok);
        });
        document.getElementById('portalCopyPassword')?.addEventListener('click', async () => {
            const ok = await CRM.copyToClipboard(data.password);
            showAlertModal(ok ? 'Password copied.' : 'Could not copy the password.', ok ? 'success' : 'error', null, ok);
        });
        document.getElementById('portalSaveBtn').addEventListener('click', () => this.save());
        document.getElementById('portalToggleBtn')?.addEventListener('click', () => this.save({ enabled: !data.enabled, keepPassword: true }));
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
        const removeLogo = !!document.getElementById('portalRemoveLogo')?.checked;
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
