let estimateRates = null;

function money(amount) {
    return Number(amount || 0).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    });
}

function publishEstimateHeight() {
    const height = Math.ceil(document.body.scrollHeight);
    if (!height || window.parent === window) return;
    window.parent.postMessage({ type: 'lumquote-estimate-height', height }, '*');
}

function scheduleEstimateHeight() {
    requestAnimationFrame(() => requestAnimationFrame(publishEstimateHeight));
}

function sliderValue(input, label) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const percent = max === min ? 0 : (value - min) / (max - min);
    label.textContent = String(value);
    label.style.left = `calc(${percent * 100}% + ${(0.5 - percent) * 16}px)`;
    input.setAttribute('aria-valuenow', String(value));
}

function selectedPhotoDelivery() {
    return document.querySelector('input[name="photoDelivery"]:checked')?.value || 'standard';
}

function selectedVideoDelivery() {
    return document.querySelector('input[name="videoDelivery"]:checked')?.value || 'week';
}

function renderEstimate() {
    const amount = document.getElementById('estimateAmount');
    const breakdown = document.getElementById('estimateBreakdown');
    if (!estimateRates) {
        amount.textContent = '—';
        breakdown.replaceChildren();
        return;
    }

    const days = Number(document.getElementById('estimateDays').value);
    const photographers = Number(document.getElementById('estimatePhotographers').value);
    const videographers = Number(document.getElementById('estimateVideographers').value);
    const extra = document.getElementById('estimateExtraHours').checked;
    const extras = Math.max(0, photographers - 1);
    const extraVideo = Math.max(0, videographers - 1);
    const dayLabel = days === 1 ? 'day' : 'days';
    const lines = [];

    const lead = days * estimateRates.leadDay;
    lines.push({ label: `Lead photographer, ${days} ${dayLabel}`, amount: lead });

    let additional = 0;
    if (extras) {
        additional = days * extras * estimateRates.additionalDay;
        lines.push({
            label: `${extras} additional ${extras === 1 ? 'photographer' : 'photographers'}, ${days} ${dayLabel}`,
            amount: additional
        });
    }

    let leadVideo = 0;
    let additionalVideo = 0;
    if (videographers > 0) {
        leadVideo = days * estimateRates.leadVideoDay;
        lines.push({ label: `Lead videographer, ${days} ${dayLabel}`, amount: leadVideo });
        if (extraVideo) {
            additionalVideo = days * extraVideo * estimateRates.additionalVideoDay;
            lines.push({
                label: `${extraVideo} additional ${extraVideo === 1 ? 'videographer' : 'videographers'}, ${days} ${dayLabel}`,
                amount: additionalVideo
            });
        }
    }

    let extraHours = 0;
    if (extra) {
        const hoursPastEight = 2;
        extraHours = days * hoursPastEight * estimateRates.leadExtraHours
            + days * extras * hoursPastEight * estimateRates.additionalExtraHours;
        if (videographers > 0) {
            extraHours += days * hoursPastEight * estimateRates.leadVideoExtraHours
                + days * extraVideo * hoursPastEight * estimateRates.additionalVideoExtraHours;
        }
        lines.push({ label: '10-hour days', amount: extraHours });
    }

    const videoDelivery = document.getElementById('videoDelivery');
    const videoEnabled = videographers > 0;
    videoDelivery.disabled = !videoEnabled;
    videoDelivery.classList.toggle('is-disabled', !videoEnabled);

    let liveGallery = 0;
    if (selectedPhotoDelivery() === 'live') {
        liveGallery = days * estimateRates.liveGallery;
        lines.push({ label: `Live Gallery, ${days} ${dayLabel}`, amount: liveGallery });
    }

    let videoEdit = 0;
    if (videoEnabled) {
        const sameDay = selectedVideoDelivery() === 'sameDay';
        videoEdit = sameDay ? estimateRates.videoEditSameDay : estimateRates.videoEditWeek;
        lines.push({
            label: sameDay ? 'Highlight video, on-site edit' : 'Highlight video, 1 week',
            amount: videoEdit
        });
    }

    const total = lead + additional + leadVideo + additionalVideo + extraHours + liveGallery + videoEdit;
    amount.textContent = money(total);
    breakdown.replaceChildren(...lines.map((line) => {
        const item = document.createElement('li');
        item.textContent = `${line.label}: ${money(line.amount)}`;
        return item;
    }));
    scheduleEstimateHeight();
}

function bindSlider(id) {
    const input = document.getElementById(id);
    const label = document.getElementById(`${id}Value`);
    const update = () => {
        sliderValue(input, label);
        renderEstimate();
    };
    input.addEventListener('input', update);
    update();
}

function applyRateHints() {
    document.getElementById('estimateLiveHint').textContent = `(+${money(estimateRates.liveGallery)}/day)`;
    document.getElementById('estimateVideoWeekHint').textContent = `(+${money(estimateRates.videoEditWeek)})`;
    document.getElementById('estimateVideoSameDayHint').textContent = `(+${money(estimateRates.videoEditSameDay)})`;
}

async function loadRates() {
    const error = document.getElementById('estimateError');
    try {
        const response = await fetch('/api/public/estimate-rates');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load pricing.');
        estimateRates = data.rates;
        applyRateHints();
        error.hidden = true;
        document.getElementById('estimateQuoteBtn').disabled = false;
        renderEstimate();
    } catch (err) {
        error.textContent = err.message || 'Could not load pricing.';
        error.hidden = false;
        scheduleEstimateHeight();
    }
}

document.getElementById('estimateExtraHours').addEventListener('change', renderEstimate);
document.querySelectorAll('input[name="photoDelivery"], input[name="videoDelivery"]').forEach((input) => {
    input.addEventListener('change', renderEstimate);
});
bindSlider('estimateDays');
bindSlider('estimatePhotographers');
bindSlider('estimateVideographers');
loadRates();
window.addEventListener('load', scheduleEstimateHeight);
window.addEventListener('resize', () => {
    sliderValue(document.getElementById('estimateDays'), document.getElementById('estimateDaysValue'));
    sliderValue(document.getElementById('estimatePhotographers'), document.getElementById('estimatePhotographersValue'));
    sliderValue(document.getElementById('estimateVideographers'), document.getElementById('estimateVideographersValue'));
    scheduleEstimateHeight();
});

function estimateRequest() {
    return {
        days: Number(document.getElementById('estimateDays').value),
        extraHours: document.getElementById('estimateExtraHours').checked,
        photographers: Number(document.getElementById('estimatePhotographers').value),
        videographers: Number(document.getElementById('estimateVideographers').value),
        photoDelivery: selectedPhotoDelivery(),
        videoDelivery: selectedVideoDelivery()
    };
}

function enhanceQuoteLeadSource() {
    const select = document.getElementById('leadSource');
    if (!select || select.dataset.enhanced === 'true') return;
    select.dataset.enhanced = 'true';
    const wrap = document.createElement('div');
    wrap.className = 'estimate-source';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('estimate-source-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'estimate-source-button is-placeholder';
    button.textContent = 'Select one';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const list = document.createElement('ul');
    list.className = 'estimate-source-list';
    list.hidden = true;
    list.setAttribute('role', 'listbox');

    function syncButton() {
        const option = [...select.options].find((item) => item.value === select.value);
        button.textContent = option ? option.textContent : 'Select one';
        button.classList.toggle('is-placeholder', !select.value);
    }

    function closeList() {
        list.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

    function placeList() {
        const rect = button.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
        list.style.width = `${width}px`;
        list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
        const menuHeight = list.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = menuHeight + 6 <= spaceBelow ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6);
        list.style.top = `${top}px`;
    }

    function renderOptions() {
        list.replaceChildren(...[...select.options].filter((option) => option.value).map((option) => {
            const item = document.createElement('li');
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'estimate-source-option';
            choice.textContent = option.textContent;
            choice.setAttribute('role', 'option');
            if (option.value === select.value) choice.setAttribute('aria-selected', 'true');
            choice.addEventListener('click', () => {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                syncButton();
                closeList();
            });
            item.appendChild(choice);
            return item;
        }));
    }

    button.addEventListener('click', () => {
        const willOpen = list.hidden;
        if (willOpen) renderOptions();
        list.hidden = !willOpen;
        button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen) placeList();
    });
    document.addEventListener('click', (event) => {
        if (!wrap.contains(event.target)) closeList();
    });
    select.addEventListener('change', syncButton);
    wrap.append(button, list);
    syncButton();
}

function openQuoteModal() {
    const modal = document.getElementById('estimateQuoteModal');
    modal.hidden = false;
    const form = document.getElementById('estimateQuoteForm');
    const submit = document.getElementById('estimateQuoteSubmit');
    form.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Send';
    document.getElementById('estimateQuoteSuccess').hidden = true;
    enhanceQuoteLeadSource();
    document.getElementById('quoteName').focus();
}

function closeQuoteModal() {
    document.getElementById('estimateQuoteModal').hidden = true;
}

document.getElementById('estimateQuoteBtn').addEventListener('click', openQuoteModal);
document.getElementById('estimateQuoteClose').addEventListener('click', closeQuoteModal);
document.getElementById('estimateQuoteModal').addEventListener('click', (event) => {
    if (event.target.id === 'estimateQuoteModal') closeQuoteModal();
});

document.getElementById('estimateQuoteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = document.getElementById('estimateQuoteError');
    const submit = document.getElementById('estimateQuoteSubmit');
    error.hidden = true;
    const sourceError = window.LeadSources ? LeadSources.validateLeadSourceForm() : 'Choose how you heard about us.';
    if (sourceError) {
        error.textContent = sourceError;
        error.hidden = false;
        return;
    }
    submit.disabled = true;
    submit.textContent = 'Sending...';
    try {
        const response = await fetch('/api/public/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: form.name.value.trim(),
                email: form.email.value.trim(),
                phone: form.phone.value.trim(),
                message: form.message.value.trim(),
                leadSource: LeadSources.getLeadSourceFromForm(),
                companyWebsite: form.companyWebsite.value,
                estimate: estimateRequest()
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not send your request.');
        form.hidden = true;
        document.getElementById('estimateQuoteSuccess').hidden = false;
    } catch (err) {
        error.textContent = err.message || 'Could not send your request.';
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Send';
    }
});

document.addEventListener('DOMContentLoaded', enhanceQuoteLeadSource);
