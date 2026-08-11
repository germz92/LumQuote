/**
 * Public contract signing page (/sign/:token).
 */

class SignPage {
    constructor() {
        this.token = window.location.pathname.split('/')[2];
        this.contract = null;
        this.method = 'typed';
        this.padHasInk = false;
        this.drawing = false;
        this.ctx = null;
        this.fieldEls = [];
        this.init();
    }

    async init() {
        try {
            const response = await fetch(`/api/public/contracts/${encodeURIComponent(this.token)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Contract not found');
            this.contract = data;
            this.render();
        } catch (error) {
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('errorState').style.display = 'block';
            document.getElementById('errorMessage').textContent = error.message;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    render() {
        const c = this.contract;
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('contractContent').style.display = 'block';
        document.title = `${c.title} — ${c.companyName}`;

        document.getElementById('companyBrand').textContent = c.companyName;
        document.getElementById('contractTitle').textContent = c.title;
        document.getElementById('contractSubtitle').textContent =
            [c.projectName, c.clientName ? `Prepared for ${c.clientName}` : ''].filter(Boolean).join(' · ');
        document.getElementById('projectDates').textContent = c.projectDates ? `Project dates: ${c.projectDates}` : '';
        if (c.investment > 0) {
            document.getElementById('investment').textContent =
                `Investment: $${Number(c.investment).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }

        if (c.source === 'generated') {
            // Contract HTML is authored internally (templates + staff edits)
            const body = document.getElementById('contractBody');
            body.innerHTML = c.contentHtml || '';
            if (c.status === 'signed') {
                this.applyFieldResponses(body, c.fieldResponses || []);
            } else {
                this.hydrateContractFields(body);
            }
        } else if (c.hasFile) {
            const frame = document.getElementById('contractPdfFrame');
            frame.src = `/api/public/contracts/${encodeURIComponent(this.token)}/file`;
            frame.style.display = 'block';
        }

        this.renderSignatures();

        if (c.status === 'signed') {
            this.showSignedState(c.signedBy, c.signedAt, {
                clientEmail: c.clientEmail || ''
            });
        } else {
            this.initPad();
        }
    }

    deriveInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    hydrateContractFields(root) {
        this.fieldEls = [];
        if (!root) return;

        root.querySelectorAll('.contract-field').forEach((field) => {
            const fieldId = field.getAttribute('data-field-id');
            const type = field.getAttribute('data-field-type');
            const required = field.getAttribute('data-required') !== 'false';
            const labelEl = field.querySelector('.contract-field-label');
            const label = (labelEl?.textContent || '').trim();
            if (!fieldId || (type !== 'initials' && type !== 'checkbox')) return;

            field.classList.add('is-interactive', 'is-incomplete');
            field.setAttribute('contenteditable', 'false');
            labelEl?.removeAttribute('contenteditable');

            let control = null;
            if (type === 'initials') {
                const box = field.querySelector('.contract-field-box');
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'contract-initials-input';
                input.maxLength = 40;
                input.placeholder = 'Initials';
                input.setAttribute('aria-label', label || 'Initials');
                input.addEventListener('input', () => this.syncFieldCompletion(field, type, input));
                if (box) box.replaceWith(input);
                else field.appendChild(input);

                const useName = document.createElement('button');
                useName.type = 'button';
                useName.className = 'contract-field-use-name';
                useName.textContent = 'Use my initials';
                useName.addEventListener('click', () => {
                    const name = document.getElementById('signerName')?.value || '';
                    input.value = this.deriveInitials(name);
                    this.syncFieldCompletion(field, type, input);
                    input.focus();
                });
                field.appendChild(useName);
                control = input;
            } else {
                const box = field.querySelector('.contract-field-box');
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.className = 'contract-checkbox-input';
                input.setAttribute('aria-label', label || 'Acknowledgment');
                input.addEventListener('change', () => this.syncFieldCompletion(field, type, input));
                if (box) box.replaceWith(input);
                else field.insertBefore(input, field.firstChild);
                control = input;
            }

            this.fieldEls.push({ field, fieldId, type, required, label, control });
            this.syncFieldCompletion(field, type, control);
        });
    }

    syncFieldCompletion(field, type, control) {
        let complete = false;
        if (type === 'initials') {
            complete = !!(control?.value || '').trim();
        } else if (type === 'checkbox') {
            complete = !!control?.checked;
            field.classList.toggle('is-checked', complete);
        }
        field.classList.toggle('is-incomplete', !complete);
        field.classList.toggle('is-complete', complete);
    }

    collectFieldResponses() {
        return this.fieldEls.map(({ fieldId, type, label, control }) => ({
            fieldId,
            type,
            label,
            value: type === 'checkbox'
                ? (control?.checked ? 'true' : 'false')
                : String(control?.value || '').trim()
        }));
    }

    validateFields() {
        for (const item of this.fieldEls) {
            if (!item.required) continue;
            if (item.type === 'initials' && !(item.control?.value || '').trim()) {
                item.field.scrollIntoView({ behavior: 'smooth', block: 'center' });
                item.control?.focus();
                return `Please provide initials for "${item.label || 'Initials'}".`;
            }
            if (item.type === 'checkbox' && !item.control?.checked) {
                item.field.scrollIntoView({ behavior: 'smooth', block: 'center' });
                item.control?.focus();
                return `Please check: "${item.label || 'Acknowledgment'}".`;
            }
        }
        return null;
    }

    applyFieldResponses(root, responses) {
        if (!root) return;
        const map = new Map((responses || []).map((r) => [String(r.fieldId), r]));
        root.querySelectorAll('.contract-field').forEach((field) => {
            const id = field.getAttribute('data-field-id');
            const type = field.getAttribute('data-field-type');
            const response = map.get(String(id));
            const box = field.querySelector('.contract-field-box');
            field.classList.toggle('is-complete', !!response);
            if (type === 'initials' && box) {
                box.textContent = response?.value || '';
                box.classList.toggle('is-filled', !!(response?.value));
            }
            if (type === 'checkbox') {
                const checked = response?.value === 'true' || response?.value === true;
                field.classList.toggle('is-checked', checked);
                if (box) box.classList.toggle('is-checked', checked);
            }
        });
    }

    signatureSlot({ signatureHtml, caption, pending }) {
        return `
            <div class="public-sig-slot">
                <div class="public-sig-pad">${signatureHtml || '&nbsp;'}</div>
                <div class="public-sig-rule"></div>
                <div class="public-sig-caption">${caption}</div>
                ${pending ? `<div class="public-sig-pending">${pending}</div>` : ''}
            </div>`;
    }

    renderSignatures() {
        const c = this.contract;
        const fmt = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        // Client slot
        let clientSlot;
        if (c.clientSignature) {
            const sig = c.clientSignature;
            clientSlot = this.signatureSlot({
                signatureHtml: sig.method === 'drawn' && sig.imageData
                    ? `<img src="${sig.imageData}" alt="Signature">`
                    : `<span class="public-sig-name">${this.escapeHtml(sig.name)}</span>`,
                caption: `Signed by ${this.escapeHtml(sig.name)} on ${fmt(sig.signedAt)}`
            });
        } else {
            clientSlot = this.signatureSlot({
                caption: `Client signature${c.clientName ? ` — ${this.escapeHtml(c.clientName)}` : ''}`,
                pending: 'Sign below'
            });
        }

        // Company slot — always shown, countersigned or not
        let companySlot;
        if (c.countersignature) {
            const cs = c.countersignature;
            const who = `${this.escapeHtml(cs.name)}${cs.title ? `, ${this.escapeHtml(cs.title)}` : ''}`;
            companySlot = this.signatureSlot({
                signatureHtml: cs.method === 'drawn' && cs.imageData
                    ? `<img src="${cs.imageData}" alt="Countersignature">`
                    : `<span class="public-sig-name">${this.escapeHtml(cs.name)}</span>`,
                caption: `Signed by ${who} — ${this.escapeHtml(c.companyName)} on ${fmt(cs.signedAt)}`
            });
        } else {
            const signer = c.companySigner || {};
            const who = `${this.escapeHtml(signer.name || c.companyName)}${signer.title ? `, ${this.escapeHtml(signer.title)}` : ''}`;
            companySlot = this.signatureSlot({
                caption: `${who} — ${this.escapeHtml(c.companyName)}`,
                pending: 'Awaiting countersignature'
            });
        }

        document.getElementById('signaturesGrid').innerHTML = clientSlot + companySlot;
    }

    showSignedState(name, signedAt, { autoEmailedTo = null, clientEmail = '' } = {}) {
        document.getElementById('signSection').style.display = 'none';
        const confirmation = document.getElementById('signedConfirmation');
        confirmation.style.display = 'block';
        const when = signedAt ? new Date(signedAt).toLocaleString('en-US') : '';
        document.getElementById('signedDetails').textContent =
            `Signed by ${name || 'client'}${when ? ` on ${when}` : ''}. A copy has been recorded with a full audit trail.`;
        document.getElementById('signedPdfLink').href = `/api/public/contracts/${encodeURIComponent(this.token)}/pdf`;

        const autoNote = document.getElementById('autoEmailNote');
        if (autoEmailedTo) {
            autoNote.style.display = 'block';
            autoNote.textContent = `A signed copy was also emailed to ${autoEmailedTo}.`;
        } else {
            autoNote.style.display = 'none';
            autoNote.textContent = '';
        }
        const emailInput = document.getElementById('emailCopyInput');
        if (emailInput && !emailInput.value) {
            emailInput.value = clientEmail || autoEmailedTo || '';
        }
    }

    async emailCopy() {
        const input = document.getElementById('emailCopyInput');
        const status = document.getElementById('emailCopyStatus');
        const email = (input?.value || '').trim();
        if (!email) {
            status.textContent = 'Enter an email address.';
            status.style.color = '#df1b41';
            return;
        }
        status.textContent = 'Sending…';
        status.style.color = '#697386';
        try {
            const response = await fetch(`/api/public/contracts/${encodeURIComponent(this.token)}/email-copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to send email');
            status.textContent = `Sent to ${email}.`;
            status.style.color = '#16794c';
        } catch (error) {
            status.textContent = error.message || 'Failed to send email.';
            status.style.color = '#df1b41';
        }
    }

    // ---------- Signature methods ----------

    setMethod(method) {
        this.method = method;
        document.getElementById('methodTyped').classList.toggle('is-active', method === 'typed');
        document.getElementById('methodDrawn').classList.toggle('is-active', method === 'drawn');
        document.getElementById('typedArea').style.display = method === 'typed' ? 'block' : 'none';
        document.getElementById('drawnArea').style.display = method === 'drawn' ? 'block' : 'none';
        if (method === 'drawn') this.resizePad();
    }

    updateTypedPreview() {
        const name = document.getElementById('signerName').value.trim();
        document.getElementById('typedPreview').innerHTML = name ? this.escapeHtml(name) : '&nbsp;';
    }

    initPad() {
        const canvas = document.getElementById('signaturePad');
        this.ctx = canvas.getContext('2d');
        this.resizePad();

        const pos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const point = e.touches ? e.touches[0] : e;
            return {
                x: (point.clientX - rect.left) * (canvas.width / rect.width),
                y: (point.clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        const start = (e) => {
            e.preventDefault();
            this.drawing = true;
            const p = pos(e);
            this.ctx.beginPath();
            this.ctx.moveTo(p.x, p.y);
        };
        const move = (e) => {
            if (!this.drawing) return;
            e.preventDefault();
            const p = pos(e);
            this.ctx.lineTo(p.x, p.y);
            this.ctx.stroke();
            if (!this.padHasInk) {
                this.padHasInk = true;
                document.getElementById('padHint').style.display = 'none';
            }
        };
        const end = () => { this.drawing = false; };

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);

        window.addEventListener('resize', () => {
            if (this.method === 'drawn' && !this.padHasInk) this.resizePad();
        });
    }

    resizePad() {
        const canvas = document.getElementById('signaturePad');
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = Math.max(300, Math.floor(rect.width));
        canvas.height = 160;
        this.ctx.lineWidth = 2.2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = '#0a2540';
    }

    clearPad() {
        const canvas = document.getElementById('signaturePad');
        this.ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.padHasInk = false;
        document.getElementById('padHint').style.display = 'flex';
    }

    // ---------- Submit ----------

    showError(message) {
        const el = document.getElementById('signError');
        el.textContent = message;
        el.style.display = 'block';
    }

    async submitSignature() {
        const name = document.getElementById('signerName').value.trim();
        document.getElementById('signError').style.display = 'none';

        if (!name) {
            this.showError('Please type your full legal name.');
            return;
        }
        if (this.method === 'drawn' && !this.padHasInk) {
            this.showError('Please draw your signature, or switch to a typed signature.');
            return;
        }
        const fieldError = this.validateFields();
        if (fieldError) {
            this.showError(fieldError);
            return;
        }

        const button = document.getElementById('signButton');
        button.disabled = true;
        button.textContent = 'Recording signature…';

        try {
            const body = {
                name,
                method: this.method,
                fieldResponses: this.collectFieldResponses()
            };
            if (this.method === 'drawn') {
                body.imageData = document.getElementById('signaturePad').toDataURL('image/png');
            }
            const response = await fetch(`/api/public/contracts/${encodeURIComponent(this.token)}/sign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to record signature');
            this.contract.clientSignature = {
                name,
                method: this.method,
                imageData: body.imageData || null,
                signedAt: data.signedAt
            };
            this.contract.fieldResponses = data.fieldResponses || body.fieldResponses;
            this.contract.status = 'signed';

            if (this.contract.source === 'generated') {
                const bodyEl = document.getElementById('contractBody');
                bodyEl.innerHTML = this.contract.contentHtml || '';
                this.applyFieldResponses(bodyEl, this.contract.fieldResponses || []);
                this.fieldEls = [];
            }

            this.renderSignatures();
            this.showSignedState(name, data.signedAt, {
                autoEmailedTo: data.autoEmailedTo || null,
                clientEmail: data.clientEmail || this.contract?.clientEmail || ''
            });
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        } catch (error) {
            this.showError(error.message);
            button.disabled = false;
            button.textContent = 'Agree & Sign';
        }
    }
}

const signPage = new SignPage();
window.signPage = signPage;
