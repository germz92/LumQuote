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
            document.getElementById('contractBody').innerHTML = c.contentHtml || '';
        } else if (c.hasFile) {
            const frame = document.getElementById('contractPdfFrame');
            frame.src = `/api/public/contracts/${encodeURIComponent(this.token)}/file`;
            frame.style.display = 'block';
        }

        this.renderSignatures();

        if (c.status === 'signed') {
            this.showSignedState(c.signedBy, c.signedAt);
        } else {
            this.initPad();
        }
    }

    signatureSlot({ signatureHtml, caption, pending }) {
        return `
            <div class="public-sig-slot">
                <div class="public-sig-line">${signatureHtml || ''}</div>
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

    showSignedState(name, signedAt) {
        document.getElementById('signSection').style.display = 'none';
        const confirmation = document.getElementById('signedConfirmation');
        confirmation.style.display = 'block';
        const when = signedAt ? new Date(signedAt).toLocaleString('en-US') : '';
        document.getElementById('signedDetails').textContent =
            `Signed by ${name || 'client'}${when ? ` on ${when}` : ''}. A copy has been recorded with a full audit trail.`;
        document.getElementById('signedPdfLink').href = `/api/public/contracts/${encodeURIComponent(this.token)}/pdf`;
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

        const button = document.getElementById('signButton');
        button.disabled = true;
        button.textContent = 'Recording signature…';

        try {
            const body = { name, method: this.method };
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
            this.renderSignatures();
            this.showSignedState(name, data.signedAt);
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
