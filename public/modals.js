/**
 * Shared alert & confirm modals (Phase 1)
 */
function injectAppModals() {
    if (document.getElementById('confirmModal')) return;

    const MODAL_HTML = `
    <div id="alertModal" class="modal" style="display: none;">
        <div class="modal-content alert-modal-content">
            <div class="modal-header">
                <h2 id="alertModalTitle">Message</h2>
                <span class="close" onclick="hideAlertModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="alert-content">
                    <div id="alertModalIcon" class="alert-icon"></div>
                    <p id="alertModalMessage">Message content</p>
                </div>
                <div class="modal-buttons">
                    <button type="button" class="btn btn-primary btn-md primary-button" onclick="hideAlertModal()">OK</button>
                </div>
            </div>
        </div>
    </div>
    <div id="confirmModal" class="modal" style="display: none;">
        <div class="modal-content confirm-modal-content">
            <div class="modal-header">
                <h2 id="confirmModalTitle">Confirm</h2>
                <span class="close" onclick="hideConfirmModal(false)">&times;</span>
            </div>
            <div class="modal-body">
                <div class="confirm-content">
                    <div class="confirm-icon">⚠️</div>
                    <div id="confirmModalMessage">Are you sure?</div>
                </div>
                <div class="modal-buttons">
                    <button type="button" class="btn btn-secondary btn-md secondary-button" id="confirmModalCancel" onclick="hideConfirmModal(false)">Cancel</button>
                    <button type="button" class="btn btn-primary btn-md primary-button" id="confirmModalOk" onclick="hideConfirmModal(true)">Confirm</button>
                </div>
            </div>
        </div>
    </div>
    <div id="promptModal" class="modal" style="display: none;">
        <div class="modal-content prompt-modal-content">
            <div class="modal-header">
                <h2 id="promptModalTitle">Input</h2>
                <span class="close" onclick="hidePromptModal(null)">&times;</span>
            </div>
            <div class="modal-body">
                <p id="promptModalMessage" class="prompt-modal-message" style="display:none"></p>
                <form id="promptModalForm" class="prompt-modal-form" onsubmit="event.preventDefault(); hidePromptModal(collectPromptModalValues());">
                    <div id="promptModalFields"></div>
                    <div class="modal-buttons">
                        <button type="button" class="btn btn-secondary btn-md secondary-button" onclick="hidePromptModal(null)">Cancel</button>
                        <button type="submit" class="btn btn-primary btn-md primary-button" id="promptModalOk">Insert</button>
                    </div>
                </form>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
}

if (document.body) {
    injectAppModals();
} else {
    document.addEventListener('DOMContentLoaded', injectAppModals);
}

let currentConfirmCallback = null;
let currentPromptCallback = null;
let currentAlertModal = null;

function showAlertModal(message, type = 'info', title = null, autoClose = false, allowHtml = false) {
    if (type === 'success' && autoClose && typeof showToast === 'function') {
        showToast(message, 'success');
        return;
    }

    const modal = document.getElementById('alertModal');
    if (!modal) return;

    const titleEl = document.getElementById('alertModalTitle');
    const messageEl = document.getElementById('alertModalMessage');
    const iconEl = document.getElementById('alertModalIcon');
    const contentEl = modal.querySelector('.alert-modal-content');

    titleEl.textContent = title || (type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Information');
    if (allowHtml) {
        messageEl.innerHTML = message;
    } else {
        messageEl.textContent = message;
    }
    iconEl.className = `alert-icon ${type}`;
    contentEl.classList.remove('auto-close');
    modal.style.display = 'flex';
    currentAlertModal = modal;

    if (autoClose && type === 'success') {
        contentEl.classList.add('auto-close');
        setTimeout(() => hideAlertModal(), 3500);
    }

    setTimeout(() => {
        const okButton = modal.querySelector('.primary-button');
        if (okButton) okButton.focus();
    }, 100);
}

function hideAlertModal() {
    const modal = document.getElementById('alertModal');
    if (!modal) return;

    modal.classList.add('closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
        currentAlertModal = null;
    }, 200);
}

function showConfirmModal(message, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', allowHtml = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        if (!modal) {
            resolve(false);
            return;
        }

        const titleEl = document.getElementById('confirmModalTitle');
        const messageEl = document.getElementById('confirmModalMessage');
        const confirmBtn = document.getElementById('confirmModalOk');
        const cancelBtn = document.getElementById('confirmModalCancel');

        titleEl.textContent = title;
        if (allowHtml) {
            messageEl.innerHTML = message;
        } else {
            messageEl.textContent = message;
        }
        confirmBtn.textContent = confirmText;
        if (cancelBtn) cancelBtn.textContent = cancelText;

        currentConfirmCallback = resolve;
        modal.style.display = 'flex';

        setTimeout(() => confirmBtn.focus(), 100);
    });
}

function hideConfirmModal(result) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;

    modal.classList.add('closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
        if (currentConfirmCallback) {
            currentConfirmCallback(result);
            currentConfirmCallback = null;
        }
    }, 200);
}

/**
 * Custom prompt modal.
 * @param {{ title?: string, message?: string, confirmText?: string, fields: Array<{name:string,label:string,type?:string,value?:string|number,min?:number,max?:number,required?:boolean,placeholder?:string}> }} options
 * @returns {Promise<Record<string,string>|null>}
 */
function showPromptModal(options = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('promptModal');
        if (!modal) {
            resolve(null);
            return;
        }

        const titleEl = document.getElementById('promptModalTitle');
        const messageEl = document.getElementById('promptModalMessage');
        const fieldsEl = document.getElementById('promptModalFields');
        const okBtn = document.getElementById('promptModalOk');
        const fields = Array.isArray(options.fields) ? options.fields : [];

        titleEl.textContent = options.title || 'Input';
        okBtn.textContent = options.confirmText || 'OK';

        if (options.message) {
            messageEl.style.display = '';
            messageEl.textContent = options.message;
        } else {
            messageEl.style.display = 'none';
            messageEl.textContent = '';
        }

        fieldsEl.innerHTML = fields.map((field, index) => {
            const type = field.type || 'text';
            const required = field.required !== false;
            const min = field.min != null ? ` min="${field.min}"` : '';
            const max = field.max != null ? ` max="${field.max}"` : '';
            const value = field.value != null ? String(field.value) : '';
            const placeholder = field.placeholder ? ` placeholder="${String(field.placeholder).replace(/"/g, '&quot;')}"` : '';
            return `
                <div class="form-group">
                    <label for="promptField_${index}">${field.label || field.name}</label>
                    <input id="promptField_${index}" name="${field.name}" type="${type}" value="${value.replace(/"/g, '&quot;')}"${min}${max}${placeholder}${required ? ' required' : ''} autocomplete="off">
                </div>`;
        }).join('');

        currentPromptCallback = resolve;
        modal.style.display = 'flex';

        setTimeout(() => {
            const first = fieldsEl.querySelector('input');
            if (first) {
                first.focus();
                if (first.type === 'text' || first.type === 'number') first.select();
            }
        }, 50);
    });
}

function collectPromptModalValues() {
    const fieldsEl = document.getElementById('promptModalFields');
    if (!fieldsEl) return {};
    const values = {};
    fieldsEl.querySelectorAll('input').forEach((input) => {
        values[input.name] = input.value;
    });
    return values;
}

function hidePromptModal(result) {
    const modal = document.getElementById('promptModal');
    if (!modal) return;

    // Validate required fields when confirming
    if (result && typeof result === 'object') {
        const form = document.getElementById('promptModalForm');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
    }

    modal.classList.add('closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
        if (currentPromptCallback) {
            currentPromptCallback(result);
            currentPromptCallback = null;
        }
    }, 200);
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const alertModal = document.getElementById('alertModal');
    const confirmModal = document.getElementById('confirmModal');
    const promptModal = document.getElementById('promptModal');

    if (promptModal && promptModal.style.display === 'flex') {
        hidePromptModal(null);
    } else if (alertModal && alertModal.style.display === 'flex') {
        hideAlertModal();
    } else if (confirmModal && confirmModal.style.display === 'flex') {
        hideConfirmModal(false);
    }
});

window.AppModals = {
    showAlertModal,
    hideAlertModal,
    showConfirmModal,
    hideConfirmModal,
    showPromptModal,
    hidePromptModal,
    collectPromptModalValues
};

window.showPromptModal = showPromptModal;
window.hidePromptModal = hidePromptModal;
window.collectPromptModalValues = collectPromptModalValues;
