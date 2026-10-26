/**
 * Admin Forms tab — list, editor, extra fields, and Squarespace embeds.
 */

function leadFormPublicOrigin() {
    const origin = window.location.origin;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return 'https://lumquote.com';
    }
    return origin;
}

function squarespaceEmbedScriptTag() {
    return `<script src="${leadFormPublicOrigin()}/squarespace-embed.js"></script>`;
}

function squarespaceFooterSnippet() {
    return squarespaceEmbedScriptTag();
}

/*
 * Inline style that works with no JavaScript at all (Squarespace turns embedded
 * scripts off while you are logged in and editing, and some plans never run them).
 */
const SQUARESPACE_IFRAME_STYLE = 'display:block;position:relative;width:100%;height:clamp(760px,calc(4060px - 500vw),1280px);margin:0 0 -56.25%;border:0;';
const SQUARESPACE_CODE_IFRAME_STYLE = 'display:block;width:100%;height:clamp(760px,calc(4060px - 500vw),1280px);border:0;';

function leadFormPublicPath(form) {
    if (!form || form.isDefault) return '/inquire';
    return `/inquire/${form.slug || 'form'}`;
}

function leadFormEmbedSnippet(form) {
    const origin = leadFormPublicOrigin();
    const path = leadFormPublicPath(form);
    const slug = form?.isDefault ? '' : (form?.slug || 'form');
    const frameId = slug ? `lumquote-inquire-${slug}` : 'lumquote-inquire';
    const title = String(form?.name || 'Contact form').replace(/"/g, '&quot;');
    return `<iframe id="${frameId}" src="${origin}${path}" title="${title}" style="${SQUARESPACE_IFRAME_STYLE}"></iframe>
${squarespaceEmbedScriptTag()}`;
}

function estimateEmbedSnippet() {
    const origin = leadFormPublicOrigin();
    return `<iframe id="lumquote-estimate" src="${origin}/estimate" title="Photography estimate" style="${SQUARESPACE_CODE_IFRAME_STYLE}"></iframe>
${squarespaceEmbedScriptTag()}`;
}

async function copyTextToClipboard(snippet, textareaId, successMessage) {
    try {
        await navigator.clipboard.writeText(snippet);
        showAlertModal(successMessage, 'success', null, true);
    } catch (error) {
        const code = document.getElementById(textareaId);
        if (code) {
            code.focus();
            code.select();
        }
        showAlertModal('Could not copy automatically. Select the embed code and copy it.', 'error');
    }
}

async function copyEstimateEmbed() {
    await copyTextToClipboard(
        estimateEmbedSnippet(),
        'estimateEmbed',
        'Estimate embed copied. Paste it into the Squarespace Code block on the calculator page.'
    );
}
window.copyEstimateEmbed = copyEstimateEmbed;

async function copySquarespaceFooter() {
    await copyTextToClipboard(
        squarespaceFooterSnippet(),
        'squarespaceFooter',
        'Footer script copied. In Squarespace, open Settings, Advanced, Code Injection, and paste it into Footer.'
    );
}
window.copySquarespaceFooter = copySquarespaceFooter;

class FormsManager {
    constructor() {
        this.forms = [];
        this.current = null;
        this.extraFields = [];
        this.init();
    }

    async init() {
        const estimateCode = document.getElementById('estimateEmbed');
        if (estimateCode) estimateCode.value = estimateEmbedSnippet();
        const footer = document.getElementById('squarespaceFooter');
        if (footer) footer.value = squarespaceFooterSnippet();
        document.getElementById('leadFormEditor')?.addEventListener('input', () => this.refreshPreview());
        document.getElementById('lf-form-slug')?.addEventListener('input', () => this.syncFormUrlHint());
        await this.loadList();
    }

    async api(url, options) {
        const response = await fetch(url, {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    async loadList() {
        try {
            const data = await this.api('/api/admin/forms');
            this.forms = data.forms || [];
            this.renderList();
        } catch (error) {
            showAlertModal(error.message || 'Failed to load forms.', 'error');
        }
    }

    showList() {
        this.current = null;
        document.getElementById('admin-panel-website')?.classList.remove('is-editing');
        document.getElementById('formsListView').hidden = false;
        document.getElementById('leadFormEditor').hidden = true;
        this.loadList();
    }

    showEditor() {
        document.getElementById('admin-panel-website')?.classList.add('is-editing');
        document.getElementById('formsListView').hidden = true;
        document.getElementById('leadFormEditor').hidden = false;
    }

    publicUrl(form) {
        return `${window.location.origin}${leadFormPublicPath(form)}`;
    }

    renderList() {
        const list = document.getElementById('formsList');
        if (!list) return;
        const cards = this.forms.map((form) => this.galleryCard(form));
        cards.push(`
            <button type="button" class="forms-gallery-new" onclick="formsManager.openCreate()">
                <span class="forms-gallery-new-plus">+</span>
                <strong>New form</strong>
                <span>Copies the contact form so you can change the words and extra questions</span>
            </button>`);
        list.innerHTML = cards.join('');
    }

    previewInput(label, placeholder, kind) {
        const extra = kind === 'area'
            ? ' form-preview-input--area'
            : kind === 'select'
                ? ' form-preview-input--select'
                : '';
        const ph = placeholder ? ` data-ph="${CRM.escapeHtml(placeholder)}"` : '';
        return `<div class="form-preview-field"><span>${CRM.escapeHtml(label)}</span><span class="form-preview-input${extra}"${ph}></span></div>`;
    }

    galleryPreview(form) {
        const extras = Array.isArray(form.extraFields) ? form.extraFields : [];
        const extraHtml = extras.slice(0, 2).map((field) => {
            if (field.type === 'checkbox') {
                return `<div class="form-preview-field"><span class="form-preview-chip">${CRM.escapeHtml(field.label || 'Checkbox')}</span></div>`;
            }
            const kind = field.type === 'textarea' ? 'area' : field.type === 'select' ? 'select' : '';
            const ph = field.type === 'date' ? 'Date' : (field.placeholder || '');
            return this.previewInput(`${field.label || 'Field'}${field.required ? ' *' : ''}`, ph, kind);
        }).join('');
        const more = extras.length > 2
            ? `<p class="forms-gallery-more">+${extras.length - 2} more field${extras.length - 2 === 1 ? '' : 's'}</p>`
            : '';
        const services = (form.services || []).slice(0, 4);
        const serviceChips = services.map((name) => `<span class="form-preview-chip">${CRM.escapeHtml(name)}</span>`).join('');
        const serviceMore = (form.services || []).length > 4
            ? `<span class="form-preview-chip">+${form.services.length - 4}</span>`
            : '';
        return `
            <div class="forms-gallery-preview" aria-hidden="true">
                <h4>${CRM.escapeHtml(form.heading || 'Tell us about your project')}</h4>
                ${form.intro ? `<p class="form-preview-intro">${CRM.escapeHtml(form.intro)}</p>` : ''}
                <div class="form-preview-card">
                    ${this.previewInput(`${form.nameLabel || 'Name'} *`, form.namePlaceholder, '')}
                    ${this.previewInput(`${form.emailLabel || 'Email'} *`, form.emailPlaceholder, '')}
                    ${this.previewInput(`${form.phoneLabel || 'Phone'} *`, form.phonePlaceholder, '')}
                    ${this.previewInput(`${form.hearAboutLabel || 'How did you hear about us?'} *`, '', 'select')}
                    ${this.previewInput(`${form.messageLabel || 'Message'} *`, form.messagePlaceholder, 'area')}
                    ${extraHtml}
                    ${more}
                    <div class="form-preview-services-box">
                        <p class="form-preview-legend">${CRM.escapeHtml(form.servicesLegend || 'Services')} *</p>
                        <div class="form-preview-services">${serviceChips}${serviceMore}</div>
                    </div>
                    <div class="form-preview-button">${CRM.escapeHtml(form.submitLabel || 'Send')}</div>
                </div>
            </div>`;
    }

    galleryCard(form) {
        const id = CRM.escapeJs(form._id);
        const badge = form.isDefault ? '<span class="forms-card-badge">Default</span>' : '';
        const extraCount = (form.extraFields || []).length;
        const summary = extraCount
            ? `${extraCount} extra field${extraCount === 1 ? '' : 's'}`
            : 'Core fields only';
        const remove = form.isDefault
            ? ''
            : `<button type="button" class="secondary-button" onclick="event.stopPropagation(); formsManager.remove('${id}')">Delete</button>`;
        return `
            <article class="forms-gallery-card" role="button" tabindex="0"
                onclick="formsManager.openEditor('${id}')"
                onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();formsManager.openEditor('${id}')}">
                ${this.galleryPreview(form)}
                <div class="forms-gallery-meta">
                    <div>
                        <h3>${CRM.escapeHtml(form.name || 'Untitled form')} ${badge}</h3>
                        <p>${CRM.escapeHtml(summary)} · /${CRM.escapeHtml(form.isDefault ? 'inquire' : `inquire/${form.slug || 'form'}`)}</p>
                    </div>
                    <div class="forms-gallery-actions" onclick="event.stopPropagation()">
                        <button type="button" class="secondary-button" onclick="formsManager.copyListEmbed('${id}')">Copy embed</button>
                        <button type="button" class="primary-button" onclick="formsManager.openEditor('${id}')">Edit</button>
                        ${remove}
                    </div>
                </div>
            </article>`;
    }

    formById(id) {
        return this.forms.find((form) => String(form._id) === String(id));
    }

    async copyListEmbed(id) {
        const form = this.formById(id);
        if (!form) return;
        await copyTextToClipboard(
            leadFormEmbedSnippet(form),
            '',
            'Embed code copied. In Squarespace, add an Embed block, choose Code snippet, and paste it.'
        );
    }

    async copyEmbed() {
        if (!this.current) return;
        const textarea = document.getElementById('leadFormEmbed');
        const snippet = textarea?.value || leadFormEmbedSnippet(this.current);
        await copyTextToClipboard(
            snippet,
            'leadFormEmbed',
            'Embed code copied. In Squarespace, add an Embed block, choose Code snippet, and paste it.'
        );
    }

    async openCreate() {
        const values = await showPromptModal({
            title: 'New form',
            confirmText: 'Create',
            fields: [
                { name: 'name', label: 'Form name', required: true, placeholder: 'e.g. Trade show' },
                { name: 'slug', label: 'URL slug', placeholder: 'e.g. trade-show' }
            ]
        });
        if (!values) return;
        try {
            const created = await this.api('/api/admin/forms', {
                method: 'POST',
                body: JSON.stringify({
                    name: values.name,
                    slug: values.slug
                })
            });
            await this.loadList();
            this.openEditor(created._id, created);
        } catch (error) {
            showAlertModal(error.message || 'Failed to create the form.', 'error');
        }
    }

    async openEditor(id, preloaded) {
        try {
            const form = preloaded || this.formById(id);
            if (!form) throw new Error('Form not found');
            this.fillEditor(form);
            this.showEditor();
        } catch (error) {
            showAlertModal(error.message || 'Failed to open the form.', 'error');
        }
    }

    async remove(id) {
        const form = this.formById(id);
        if (!form || form.isDefault) return;
        const ok = await showConfirmModal(`Delete “${form.name}”? Existing embeds for this form will stop working.`, 'Delete form', 'Delete');
        if (!ok) return;
        try {
            await this.api(`/api/admin/forms/${encodeURIComponent(id)}`, { method: 'DELETE' });
            showAlertModal('Form deleted.', 'success', null, true);
            await this.loadList();
        } catch (error) {
            showAlertModal(error.message || 'Failed to delete the form.', 'error');
        }
    }

    setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }

    fillEditor(form) {
        this.current = form;
        this.extraFields = Array.isArray(form.extraFields)
            ? form.extraFields.map((field) => ({ ...field, options: [...(field.options || [])] }))
            : [];
        const title = document.getElementById('lf-editor-title');
        if (title) title.textContent = form.name || 'Edit form';
        this.setValue('lf-form-name', form.name);
        this.setValue('lf-form-slug', form.slug);
        this.setValue('lf-heading', form.heading);
        this.setValue('lf-intro', form.intro);
        this.setValue('lf-name', form.nameLabel);
        this.setValue('lf-email', form.emailLabel);
        this.setValue('lf-phone', form.phoneLabel);
        this.setValue('lf-message', form.messageLabel);
        this.setValue('lf-name-ph', form.namePlaceholder);
        this.setValue('lf-email-ph', form.emailPlaceholder);
        this.setValue('lf-phone-ph', form.phonePlaceholder);
        this.setValue('lf-message-ph', form.messagePlaceholder);
        this.setValue('lf-services-legend', form.servicesLegend);
        this.setValue('lf-services-hint', form.servicesHint);
        this.setValue('lf-hear', form.hearAboutLabel);
        this.setValue('lf-submit', form.submitLabel);
        this.setValue('lf-success-title', form.successTitle);
        this.setValue('lf-success-message', form.successMessage);
        const confirmEnabled = document.getElementById('lf-confirm-enabled');
        if (confirmEnabled) confirmEnabled.checked = form.confirmationEmailEnabled !== false;
        this.setValue('lf-confirm-subject', form.confirmationEmailSubject);
        this.setValue('lf-confirm-body', form.confirmationEmailBody);
        this.renderServices(form.services);
        this.renderExtraFields();
        this.toggleConfirmEmail();
        this.syncPublish(form);
        this.refreshPreview();
    }

    syncPublish(form) {
        const url = this.publicUrl(form);
        const link = document.getElementById('leadFormUrl');
        if (link) link.href = url;
        const hint = document.getElementById('lf-form-url-hint');
        if (hint) hint.textContent = form.isDefault ? `Default form stays at ${window.location.origin}/inquire` : `Public URL: ${url}`;
        const title = document.getElementById('lf-embed-title');
        if (title) title.textContent = form.name || 'Contact form';
        const code = document.getElementById('leadFormEmbed');
        if (code) code.value = leadFormEmbedSnippet(form);
    }

    syncFormUrlHint() {
        if (!this.current) return;
        const slug = (document.getElementById('lf-form-slug')?.value || '').trim();
        const draft = { ...this.current, slug, name: document.getElementById('lf-form-name')?.value || this.current.name };
        this.syncPublish(draft);
    }

    toggleConfirmEmail() {
        const enabled = document.getElementById('lf-confirm-enabled');
        const fields = document.getElementById('lf-confirm-fields');
        if (fields) fields.hidden = enabled ? !enabled.checked : false;
    }

    serviceRow(value) {
        const row = document.createElement('div');
        row.className = 'lead-form-service-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 80;
        input.value = value || '';
        input.placeholder = 'Service name';
        input.setAttribute('aria-label', 'Service name');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'lead-form-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove service');
        remove.addEventListener('click', () => {
            const rows = document.querySelectorAll('#lf-services .lead-form-service-row');
            if (rows.length <= 1) return;
            row.remove();
            this.refreshPreview();
        });
        row.append(input, remove);
        return row;
    }

    renderServices(services) {
        const list = document.getElementById('lf-services');
        if (!list) return;
        const names = Array.isArray(services) && services.length ? services : [''];
        list.replaceChildren(...names.map((name) => this.serviceRow(name)));
    }

    addService() {
        const list = document.getElementById('lf-services');
        if (!list) return;
        list.append(this.serviceRow(''));
        list.lastElementChild?.querySelector('input')?.focus();
        this.refreshPreview();
    }

    newExtraId() {
        return `f${Math.random().toString(16).slice(2, 12)}`;
    }

    addExtraField() {
        if (this.extraFields.length >= 12) {
            showAlertModal('You can add up to 12 extra fields.', 'error');
            return;
        }
        this.readExtraFieldsFromDom();
        this.extraFields.push({
            id: this.newExtraId(),
            type: 'text',
            label: 'New field',
            placeholder: '',
            required: false,
            options: []
        });
        this.renderExtraFields();
        this.refreshPreview();
    }

    readExtraFieldsFromDom() {
        const cards = document.querySelectorAll('#lf-extra-fields .form-extra-card');
        cards.forEach((card, index) => {
            const field = this.extraFields[index];
            if (!field) return;
            field.type = card.querySelector('[data-extra="type"]')?.value || 'text';
            field.label = card.querySelector('[data-extra="label"]')?.value || field.label;
            field.placeholder = card.querySelector('[data-extra="placeholder"]')?.value || '';
            field.required = !!card.querySelector('[data-extra="required"]')?.checked;
            const options = card.querySelector('[data-extra="options"]')?.value || '';
            field.options = options.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 20);
            if (field.type === 'checkbox' || field.type === 'date') field.placeholder = '';
            if (field.type !== 'select') field.options = [];
        });
    }

    moveExtraField(index, delta) {
        this.readExtraFieldsFromDom();
        const next = index + delta;
        if (next < 0 || next >= this.extraFields.length) return;
        const [field] = this.extraFields.splice(index, 1);
        this.extraFields.splice(next, 0, field);
        this.renderExtraFields();
        this.refreshPreview();
    }

    removeExtraField(index) {
        this.readExtraFieldsFromDom();
        this.extraFields.splice(index, 1);
        this.renderExtraFields();
        this.refreshPreview();
    }

    renderExtraFields() {
        const list = document.getElementById('lf-extra-fields');
        if (!list) return;
        if (!this.extraFields.length) {
            list.innerHTML = '<p class="crm-inline-note">No extra fields yet.</p>';
            return;
        }
        list.replaceChildren(...this.extraFields.map((field, index) => this.extraFieldCard(field, index)));
    }

    extraFieldCard(field, index) {
        const card = document.createElement('div');
        card.className = 'form-extra-card';
        const isSelect = field.type === 'select';
        const isCheck = field.type === 'checkbox';
        const isDate = field.type === 'date';
        card.innerHTML = `
            <div class="form-designer-grid">
                <div class="form-group">
                    <label>Type</label>
                    <select data-extra="type">
                        <option value="text" ${field.type === 'text' ? 'selected' : ''}>Short text</option>
                        <option value="textarea" ${field.type === 'textarea' ? 'selected' : ''}>Long text</option>
                        <option value="select" ${isSelect ? 'selected' : ''}>Dropdown</option>
                        <option value="checkbox" ${isCheck ? 'selected' : ''}>Checkbox</option>
                        <option value="date" ${isDate ? 'selected' : ''}>Date</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Label</label>
                    <input type="text" data-extra="label" maxlength="80" value="${CRM.escapeHtml(field.label || '')}">
                </div>
                <div class="form-group" ${isCheck || isDate ? 'hidden' : ''}>
                    <label>Placeholder</label>
                    <input type="text" data-extra="placeholder" maxlength="160" value="${CRM.escapeHtml(field.placeholder || '')}">
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" data-extra="required" ${field.required ? 'checked' : ''}>
                        <span class="checkbox-text">Required</span>
                    </label>
                </div>
                <div class="form-group form-designer-span-2" ${isSelect ? '' : 'hidden'}>
                    <label>Dropdown options</label>
                    <textarea data-extra="options" rows="3" placeholder="One option per line">${CRM.escapeHtml((field.options || []).join('\n'))}</textarea>
                </div>
            </div>
            <div class="form-extra-actions">
                <button type="button" class="secondary-button" data-move="-1">Up</button>
                <button type="button" class="secondary-button" data-move="1">Down</button>
                <button type="button" class="secondary-button" data-remove="1">Remove</button>
            </div>`;
        card.querySelector('[data-extra="type"]').addEventListener('change', () => {
            this.readExtraFieldsFromDom();
            this.renderExtraFields();
            this.refreshPreview();
        });
        card.querySelector('[data-move="-1"]').addEventListener('click', () => this.moveExtraField(index, -1));
        card.querySelector('[data-move="1"]').addEventListener('click', () => this.moveExtraField(index, 1));
        card.querySelector('[data-remove]').addEventListener('click', () => this.removeExtraField(index));
        return card;
    }

    previewText(id, fallback) {
        return document.getElementById(id)?.value?.trim() || fallback;
    }

    setPreviewPlaceholder(id, text) {
        const el = document.getElementById(id);
        if (!el) return;
        el.dataset.ph = text || '';
    }

    refreshPreview() {
        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        set('lf-preview-heading', this.previewText('lf-heading', 'Heading'));
        const intro = document.getElementById('lf-preview-intro');
        if (intro) {
            intro.textContent = document.getElementById('lf-intro')?.value?.trim() || '';
            intro.hidden = !intro.textContent;
        }
        set('lf-preview-name', `${this.previewText('lf-name', 'Name')} *`);
        set('lf-preview-email', `${this.previewText('lf-email', 'Email')} *`);
        set('lf-preview-phone', `${this.previewText('lf-phone', 'Phone')} *`);
        set('lf-preview-message', `${this.previewText('lf-message', 'Message')} *`);
        this.setPreviewPlaceholder('lf-preview-name-ph', this.previewText('lf-name-ph', ''));
        this.setPreviewPlaceholder('lf-preview-email-ph', this.previewText('lf-email-ph', ''));
        this.setPreviewPlaceholder('lf-preview-phone-ph', this.previewText('lf-phone-ph', ''));
        this.setPreviewPlaceholder('lf-preview-message-ph', this.previewText('lf-message-ph', ''));
        set('lf-preview-services-legend', `${this.previewText('lf-services-legend', 'Services')} *`);
        const hint = document.getElementById('lf-preview-services-hint');
        if (hint) {
            hint.textContent = document.getElementById('lf-services-hint')?.value?.trim() || '';
            hint.hidden = !hint.textContent;
        }
        set('lf-preview-hear', `${this.previewText('lf-hear', 'How did you hear about us')} *`);
        set('lf-preview-submit', this.previewText('lf-submit', 'Send'));
        const chips = document.getElementById('lf-preview-services');
        if (chips) {
            const names = [...document.querySelectorAll('#lf-services input')]
                .map((input) => input.value.trim())
                .filter(Boolean);
            chips.replaceChildren(...(names.length ? names : ['Service']).map((name) => {
                const chip = document.createElement('span');
                chip.className = 'form-preview-chip';
                chip.textContent = name;
                return chip;
            }));
        }
        this.readExtraFieldsFromDom();
        const extras = document.getElementById('lf-preview-extras');
        if (extras) {
            extras.replaceChildren(...this.extraFields.map((field) => {
                const wrap = document.createElement('div');
                wrap.className = 'form-preview-field';
                const label = document.createElement('span');
                label.textContent = `${field.label || 'Field'}${field.required ? ' *' : ''}`;
                wrap.appendChild(label);
                if (field.type === 'checkbox') {
                    const chip = document.createElement('span');
                    chip.className = 'form-preview-chip';
                    chip.textContent = field.label || 'Checkbox';
                    wrap.appendChild(chip);
                } else {
                    const box = document.createElement('span');
                    box.className = field.type === 'textarea'
                        ? 'form-preview-input form-preview-input--area'
                        : field.type === 'select'
                            ? 'form-preview-input form-preview-input--select'
                            : 'form-preview-input';
                    box.dataset.ph = field.type === 'date' ? 'mm/dd/yyyy' : (field.placeholder || '');
                    wrap.appendChild(box);
                }
                return wrap;
            }));
        }
        if (this.current) {
            const draft = {
                ...this.current,
                name: document.getElementById('lf-form-name')?.value || this.current.name,
                slug: document.getElementById('lf-form-slug')?.value || this.current.slug
            };
            const title = document.getElementById('lf-editor-title');
            if (title) title.textContent = draft.name || 'Edit form';
            this.syncPublish(draft);
        }
    }

    collectBody() {
        this.readExtraFieldsFromDom();
        const services = [...document.querySelectorAll('#lf-services input')]
            .map((input) => input.value.trim())
            .filter(Boolean);
        return {
            name: document.getElementById('lf-form-name').value,
            slug: document.getElementById('lf-form-slug').value,
            heading: document.getElementById('lf-heading').value,
            intro: document.getElementById('lf-intro').value,
            nameLabel: document.getElementById('lf-name').value,
            emailLabel: document.getElementById('lf-email').value,
            phoneLabel: document.getElementById('lf-phone').value,
            messageLabel: document.getElementById('lf-message').value,
            namePlaceholder: document.getElementById('lf-name-ph').value,
            emailPlaceholder: document.getElementById('lf-email-ph').value,
            phonePlaceholder: document.getElementById('lf-phone-ph').value,
            messagePlaceholder: document.getElementById('lf-message-ph').value,
            servicesLegend: document.getElementById('lf-services-legend').value,
            servicesHint: document.getElementById('lf-services-hint').value,
            hearAboutLabel: document.getElementById('lf-hear').value,
            submitLabel: document.getElementById('lf-submit').value,
            successTitle: document.getElementById('lf-success-title').value,
            successMessage: document.getElementById('lf-success-message').value,
            confirmationEmailEnabled: document.getElementById('lf-confirm-enabled').checked,
            confirmationEmailSubject: document.getElementById('lf-confirm-subject').value,
            confirmationEmailBody: document.getElementById('lf-confirm-body').value,
            services,
            extraFields: this.extraFields
        };
    }

    async save(event) {
        event.preventDefault();
        if (!this.current?._id) return;
        const body = this.collectBody();
        if (!body.services.length) {
            showAlertModal('Add at least one service.', 'error');
            return;
        }
        try {
            const saved = await this.api(`/api/admin/forms/${encodeURIComponent(this.current._id)}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
            this.fillEditor(saved);
            showAlertModal('Form saved.', 'success', null, true);
        } catch (error) {
            showAlertModal(error.message || 'Failed to save the form.', 'error');
        }
    }
}

const formsManager = new FormsManager();
window.formsManager = formsManager;
