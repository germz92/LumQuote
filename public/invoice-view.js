/**
 * Public invoice page (/invoice/:token) — formal invoice view + Stripe Checkout.
 */

class InvoicePage {
    constructor() {
        this.token = window.location.pathname.split('/')[2];
        this.invoice = null;
        this.payMethod = 'card';
        this.init();
    }

    async init() {
        // Returning from Stripe Checkout: confirm the session before rendering
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session_id');
        if (sessionId) {
            try {
                await fetch(`/api/public/invoices/${encodeURIComponent(this.token)}/confirm?session_id=${encodeURIComponent(sessionId)}`);
            } catch {
                // webhook may still confirm it
            }
            history.replaceState(null, '', window.location.pathname);
        }

        try {
            const response = await fetch(`/api/public/invoices/${encodeURIComponent(this.token)}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Invoice not found');
            this.invoice = data;
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

    money(amount) {
        return `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    formatDate(value) {
        if (!value) return '';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    partyHtml(label, party) {
        if (!party || (!party.name && !party.company)) return '';
        return `
            <h3>${label}</h3>
            ${party.name ? `<p><strong>${this.escapeHtml(party.name)}</strong></p>` : ''}
            ${party.company ? `<p>${this.escapeHtml(party.company)}</p>` : ''}
            ${party.address ? `<p style="white-space:pre-wrap">${this.escapeHtml(party.address)}</p>` : ''}
            ${party.email ? `<p>${this.escapeHtml(party.email)}</p>` : ''}
            ${party.phone ? `<p>${this.escapeHtml(party.phone)}</p>` : ''}`;
    }

    render() {
        const inv = this.invoice;
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('invoiceContent').style.display = 'block';
        document.title = `Invoice ${inv.invoiceNumber}`;

        document.getElementById('invoiceNumber').textContent = `Invoice ${inv.invoiceNumber}`;
        document.getElementById('invoiceSubtitle').textContent = inv.subtitle || '';
        document.getElementById('issueDate').textContent = inv.issueDate ? `Issue date: ${this.formatDate(inv.issueDate)}` : '';
        document.getElementById('dueDate').textContent = inv.dueDate ? `Due: ${this.formatDate(inv.dueDate)}` : 'Due upon receipt';
        document.getElementById('headerNote').textContent = inv.headerNote || '';
        document.getElementById('footerNote').textContent = inv.footerNote || '';

        document.getElementById('fromParty').innerHTML = this.partyHtml('From', inv.from);
        document.getElementById('toParty').innerHTML = this.partyHtml('Bill To', inv.to);

        const hasDays = (inv.lineItems || []).some((item) => item.day);
        if (hasDays) {
            document.getElementById('itemsHead').innerHTML =
                '<tr><th>Day</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr>';
        }
        let previousDay = null;
        document.getElementById('itemsBody').innerHTML = (inv.lineItems || []).map((item) => {
            const showDay = hasDays && item.day !== previousDay;
            previousDay = item.day;
            const dayCell = hasDays
                ? `<td class="public-item-day${showDay && item.day ? '' : ' is-empty'}">${showDay && item.day ? `<strong>${this.escapeHtml(item.day)}</strong>` : ''}</td>`
                : '';
            return `
            <tr>
                ${dayCell}
                <td class="public-item-desc">
                    <strong>${this.escapeHtml(item.description)}</strong>
                    ${item.detail ? `<div class="public-item-detail">${this.escapeHtml(item.detail)}</div>` : ''}
                    <div class="public-item-figures">
                        <span>${item.quantity} × ${this.money(item.unitPrice)}</span>
                        <span class="public-item-amount">${this.money(item.amount)}</span>
                    </div>
                </td>
                <td class="num">${item.quantity}</td>
                <td class="num">${this.money(item.unitPrice)}</td>
                <td class="num">${this.money(item.amount)}</td>
            </tr>`;
        }).join('');

        document.getElementById('subtotalDisplay').textContent = this.money(inv.subtotal);
        if (inv.discountAmount > 0) {
            document.getElementById('discountRow').style.display = 'flex';
            document.getElementById('discountDisplay').textContent = `-${this.money(inv.discountAmount)}`;
        }

        const isPaid = inv.status === 'paid';
        const installments = inv.installments || null;
        // Bank transfers the client already started. They take days to clear, so until then the
        // payment is shown as processing and cannot be paid a second time.
        const pending = isPaid ? [] : (inv.pendingPayments || []);
        const wholeBalancePending = pending.some((p) => p.installmentIndex == null);
        const pendingIndexes = new Set(pending.filter((p) => p.installmentIndex != null).map((p) => Number(p.installmentIndex)));
        const isProcessing = (inst) => inst.status !== 'paid' && (wholeBalancePending || pendingIndexes.has(inst.index));
        const nextInstallment = installments ? installments.find((i) => i.status !== 'paid' && !isProcessing(i)) : null;
        this.nextInstallmentIndex = nextInstallment ? nextInstallment.index : null;

        if (inv.amountPaid > 0 && !isPaid) {
            document.getElementById('paidRow').style.display = 'flex';
            document.getElementById('paidDisplay').textContent = `-${this.money(inv.amountPaid)}`;
        }

        if (installments && installments.length > 0) {
            document.getElementById('scheduleArea').style.display = 'block';
            document.getElementById('scheduleBody').innerHTML = installments.map((inst) => {
                let status;
                const received = Number(inst.amountReceived) || 0;
                const remaining = inst.amountRemaining != null
                    ? Number(inst.amountRemaining)
                    : Math.max(0, (Number(inst.amount) || 0) - received);
                if (inst.status === 'paid') {
                    status = `<span style="color:#16794c; font-weight:600">✓ Paid${inst.paidAt ? ` ${new Date(inst.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</span>`;
                } else if (isProcessing(inst)) {
                    status = '<span style="color:#3b4a8a; font-weight:600">Bank transfer processing</span>';
                } else if (received > 0) {
                    status = `<span style="color:#c2410c; font-weight:600">${this.money(received)} received · ${this.money(remaining)} due</span>`;
                } else if (nextInstallment && inst.index === nextInstallment.index) {
                    status = '<span style="color:#1f2430; font-weight:600">Due next</span>';
                } else {
                    status = '<span style="color:#697386">Upcoming</span>';
                }
                return `
                    <tr>
                        <td class="public-item-desc">
                            <strong>${this.escapeHtml(inst.label)}</strong>${inst.percent != null ? ` <span class="public-item-detail">(${inst.percent}%)</span>` : ''}
                            <div class="public-schedule-mobile-due">${this.escapeHtml(inst.dueLabel || '')}</div>
                            <div class="public-item-figures">
                                <span>${status}</span>
                                <span class="public-item-amount">${this.money(inst.amount)}</span>
                            </div>
                        </td>
                        <td class="public-schedule-due">${this.escapeHtml(inst.dueLabel || '')}</td>
                        <td class="num">${this.money(inst.amount)}</td>
                        <td class="public-schedule-status">${status}</td>
                    </tr>`;
            }).join('');
        }

        if (isPaid) {
            document.getElementById('paidBanner').style.display = 'flex';
            document.getElementById('paidBannerText').textContent =
                `This invoice was paid${inv.paidAt ? ` on ${new Date(inv.paidAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}. Thank you!`;
            document.getElementById('totalLabel').textContent = 'Total (Paid)';
            document.getElementById('totalDisplay').textContent = this.money(inv.total);
            document.getElementById('payArea').style.display = 'none';
            const receiptBox = document.getElementById('emailReceiptBox');
            const receiptInput = document.getElementById('emailReceiptInput');
            if (receiptBox) receiptBox.style.display = 'block';
            if (receiptInput && !receiptInput.value) {
                receiptInput.value = inv.to?.email || '';
            }
        } else {
            const receiptBox = document.getElementById('emailReceiptBox');
            if (receiptBox) receiptBox.style.display = 'none';
            const due = inv.total - (inv.amountPaid || 0);
            document.getElementById('totalDisplay').textContent = this.money(due);
            this.renderProcessingNotice(pending);
            // Everything still unpaid is already covered by a bank transfer in progress.
            const nothingLeftToPay = pending.length > 0
                && (installments && installments.length > 0 ? !nextInstallment : true);
            if (!inv.stripeEnabled) {
                document.getElementById('payButton').style.display = 'none';
                document.querySelector('#payArea p').textContent = 'Please contact us to arrange payment for this invoice.';
            } else if (nothingLeftToPay) {
                document.getElementById('payMethodArea').style.display = 'none';
                document.getElementById('payButton').style.display = 'none';
                document.getElementById('feeNote').style.display = 'none';
            } else {
                this.renderPayOptions();
                // With multiple unpaid installments, offer settling the whole balance at once.
                // Not while a bank transfer is in progress: the full balance would include it.
                const unpaidCount = installments ? installments.filter((i) => i.status !== 'paid').length : 0;
                if (unpaidCount > 1 && pending.length === 0) {
                    const fullBtn = document.getElementById('payFullBtn');
                    fullBtn.style.display = 'inline';
                    fullBtn.textContent = `Or pay the full remaining balance — ${this.money(due)}`;
                }
            }
        }

        document.getElementById('pdfLink').href = `/api/public/invoices/${encodeURIComponent(this.token)}/pdf`;
    }

    renderProcessingNotice(pending) {
        const existing = document.getElementById('processingNotice');
        if (existing) existing.remove();
        if (!pending.length) return;
        const total = pending.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const notice = document.createElement('div');
        notice.id = 'processingNotice';
        notice.style.cssText = 'padding:14px 18px; border-radius:10px; background:#eef2ff; color:#3b4a8a; font-size:14px; line-height:1.5; margin-bottom:16px';
        notice.textContent = `${total > 0 ? `Your bank transfer of ${this.money(total)}` : 'Your bank transfer'} is processing. `
            + 'Bank transfers usually clear within a few business days, and this page will show the payment once it does. '
            + 'There is no need to pay it again.';
        const payArea = document.getElementById('payArea');
        payArea.insertBefore(notice, payArea.firstChild);
    }

    payButtonLabel() {
        const inv = this.invoice;
        const installments = inv.installments || null;
        if (installments && this.nextInstallmentIndex !== null) {
            const next = installments.find((i) => i.index === this.nextInstallmentIndex);
            if (next) {
                const due = next.amountRemaining != null ? next.amountRemaining : next.amount;
                return `Pay ${next.label} — ${this.money(due)}`;
            }
        }
        return `Pay ${this.money(inv.total - (inv.amountPaid || 0))}`;
    }

    // Amount the main pay button charges (next installment, or remaining balance)
    amountDueNext() {
        const inv = this.invoice;
        const installments = inv.installments || null;
        if (installments && this.nextInstallmentIndex !== null) {
            const next = installments.find((i) => i.index === this.nextInstallmentIndex);
            if (next) return next.amountRemaining != null ? next.amountRemaining : next.amount;
        }
        return inv.total - (inv.amountPaid || 0);
    }

    renderPayOptions() {
        const opts = this.invoice.paymentOptions || {};
        const methodArea = document.getElementById('payMethodArea');

        if (opts.achEnabled) {
            methodArea.style.display = 'flex';
            const feeHint = opts.cardFeeEnabled ? `+${opts.cardFeePercent}% fee` : 'instant';
            const icon = (paths) => `<svg class="pm-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
            const cardIcon = icon('<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line>');
            const bankIcon = icon('<path d="M3 10l9-6 9 6"></path><line x1="5" y1="10" x2="5" y2="18"></line><line x1="10" y1="10" x2="10" y2="18"></line><line x1="14" y1="10" x2="14" y2="18"></line><line x1="19" y1="10" x2="19" y2="18"></line><line x1="3" y1="21" x2="21" y2="21"></line>');
            methodArea.innerHTML = `
                <button type="button" class="pay-method-btn ${this.payMethod === 'card' ? 'is-selected' : ''}" onclick="invoicePage.setPayMethod('card')">
                    <span class="pm-title">${cardIcon}Card</span>
                    <span class="pm-sub">${this.escapeHtml(feeHint)}</span>
                </button>
                <button type="button" class="pay-method-btn ${this.payMethod === 'ach' ? 'is-selected' : ''}" onclick="invoicePage.setPayMethod('ach')">
                    <span class="pm-title">${bankIcon}Bank Transfer</span>
                    <span class="pm-sub">no fee · via ACH</span>
                </button>`;
        } else {
            methodArea.style.display = 'none';
            this.payMethod = 'card';
        }

        document.getElementById('payButton').textContent = this.payButtonLabel();

        const feeNote = document.getElementById('feeNote');
        if (this.payMethod === 'card' && opts.cardFeeEnabled) {
            const fee = Math.round(this.amountDueNext() * opts.cardFeePercent) / 100;
            feeNote.textContent = `A ${opts.cardFeePercent}% card processing fee (${this.money(fee)}) is added at checkout. `
                + (opts.achEnabled ? 'Pay by bank transfer to avoid it.' : '');
            feeNote.style.display = 'block';
        } else if (this.payMethod === 'ach') {
            feeNote.textContent = 'Bank transfers have no processing fee. Funds take a few business days to clear.';
            feeNote.style.display = 'block';
        } else {
            feeNote.style.display = 'none';
        }
    }

    setPayMethod(method) {
        this.payMethod = method;
        this.renderPayOptions();
    }

    async pay(payFull = false) {
        const button = document.getElementById('payButton');
        const errorEl = document.getElementById('payError');
        errorEl.style.display = 'none';
        button.disabled = true;
        button.textContent = 'Redirecting to secure checkout…';
        try {
            let body = {};
            if (payFull) {
                body = { payFull: true };
            } else if (this.nextInstallmentIndex !== null && this.nextInstallmentIndex !== undefined) {
                body = { installmentIndex: this.nextInstallmentIndex };
            }
            body.method = this.payMethod;
            const response = await fetch(`/api/public/invoices/${encodeURIComponent(this.token)}/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not start payment');
            window.location.href = data.url;
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            button.disabled = false;
            button.textContent = this.payButtonLabel();
        }
    }

    async emailCopy() {
        const input = document.getElementById('emailReceiptInput');
        const status = document.getElementById('emailReceiptStatus');
        const email = (input?.value || '').trim();
        if (!email) {
            status.textContent = 'Enter an email address.';
            status.style.color = '#df1b41';
            return;
        }
        status.textContent = 'Sending…';
        status.style.color = '#697386';
        try {
            const response = await fetch(`/api/public/invoices/${encodeURIComponent(this.token)}/email-copy`, {
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
}

const invoicePage = new InvoicePage();
window.invoicePage = invoicePage;
