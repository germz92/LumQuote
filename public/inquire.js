function setText(id, value) {
    const el = document.getElementById(id);
    if (el && value != null) el.textContent = value;
}

function applyInquiryForm(form) {
    setText('inquireHeading', form.heading);
    const intro = document.getElementById('inquireIntro');
    if (intro) {
        intro.textContent = form.intro || '';
        intro.hidden = !form.intro;
    }
    setText('inquireNameLabel', `${form.nameLabel} *`);
    setText('inquireEmailLabel', `${form.emailLabel} *`);
    setText('inquirePhoneLabel', `${form.phoneLabel} *`);
    setText('inquireMessageLabel', `${form.messageLabel} *`);
    setText('inquireServicesLegend', `${form.servicesLegend} *`);
    const hint = document.getElementById('inquireServicesHint');
    if (hint) {
        hint.textContent = form.servicesHint || '';
        hint.hidden = !form.servicesHint;
    }
    setText('inquireHearLabel', `${form.hearAboutLabel} *`);
    const submit = document.getElementById('inquireSubmit');
    if (submit) submit.textContent = form.submitLabel || 'Send';
    setText('inquireSuccessTitle', form.successTitle);
    const success = document.getElementById('inquireSuccessMessage');
    if (success) {
        success.textContent = form.successMessage || '';
        success.hidden = !form.successMessage;
    }
    scheduleInquireHeight();
    const services = document.getElementById('inquireServices');
    if (services && Array.isArray(form.services) && form.services.length) {
        services.replaceChildren(...form.services.map((name) => {
            const label = document.createElement('label');
            label.className = 'inquire-check';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'services';
            input.value = name;
            label.append(input, document.createTextNode(` ${name}`));
            return label;
        }));
    }
}

fetch('/api/public/lead-form')
    .then((response) => response.ok ? response.json() : null)
    .then((form) => { if (form) applyInquiryForm(form); })
    .catch(() => {});

function enhanceLeadSourceSelect() {
    const select = document.getElementById('leadSource');
    if (!select || select.dataset.enhanced === 'true') return;
    select.dataset.enhanced = 'true';

    const wrap = document.createElement('div');
    wrap.className = 'inquire-source';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('inquire-source-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inquire-source-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const list = document.createElement('ul');
    list.className = 'inquire-source-list';
    list.hidden = true;
    list.setAttribute('role', 'listbox');

    function currentLabel() {
        const option = [...select.options].find((item) => item.value === select.value);
        return option ? option.textContent : 'Select one';
    }

    function syncButton() {
        button.textContent = currentLabel();
        button.classList.toggle('is-placeholder', !select.value);
    }

    function closeList() {
        if (list.hidden) return;
        list.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        scheduleInquireHeight();
    }

    function renderOptions() {
        list.replaceChildren(...[...select.options].filter((option) => option.value).map((option) => {
            const item = document.createElement('li');
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'inquire-source-option';
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
        scheduleInquireHeight();
    });

    document.addEventListener('click', (event) => {
        if (!wrap.contains(event.target)) closeList();
    });

    select.addEventListener('change', syncButton);
    wrap.append(button, list);
    syncButton();
}

function publishInquireHeight() {
    const height = Math.ceil(document.body.scrollHeight);
    if (!height || window.parent === window) return;
    window.parent.postMessage({ type: 'lumquote-inquire-height', height }, '*');
}

function scheduleInquireHeight() {
    requestAnimationFrame(() => requestAnimationFrame(publishInquireHeight));
}

document.addEventListener('DOMContentLoaded', () => {
    enhanceLeadSourceSelect();
    scheduleInquireHeight();
});
window.addEventListener('load', scheduleInquireHeight);
window.addEventListener('resize', scheduleInquireHeight);

document.getElementById('inquireForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorEl = document.getElementById('inquireError');
    const submit = document.getElementById('inquireSubmit');
    errorEl.hidden = true;

    const services = [...form.querySelectorAll('input[name="services"]:checked')].map((input) => input.value);
    if (!services.length) {
        errorEl.textContent = 'Select at least one service.';
        errorEl.hidden = false;
        return;
    }
    const sourceError = window.LeadSources ? LeadSources.validateLeadSourceForm() : null;
    if (sourceError) {
        errorEl.textContent = sourceError;
        errorEl.hidden = false;
        return;
    }
    if (!form.reportValidity()) return;

    const leadSource = LeadSources.getLeadSourceFromForm();
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
                services,
                leadSource,
                companyWebsite: form.companyWebsite.value
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Could not submit the form.');
        }
        form.hidden = true;
        document.getElementById('inquireSuccess').hidden = false;
    } catch (error) {
        errorEl.textContent = error.message || 'Could not submit the form.';
        errorEl.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Send';
    }
});
