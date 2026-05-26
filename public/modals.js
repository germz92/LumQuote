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
                    <p id="confirmModalMessage">Are you sure?</p>
                </div>
                <div class="modal-buttons">
                    <button type="button" class="btn btn-secondary btn-md secondary-button" id="confirmModalCancel" onclick="hideConfirmModal(false)">Cancel</button>
                    <button type="button" class="btn btn-primary btn-md primary-button" id="confirmModalOk" onclick="hideConfirmModal(true)">Confirm</button>
                </div>
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

function showConfirmModal(message, title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel') {
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
        messageEl.textContent = message;
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

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const alertModal = document.getElementById('alertModal');
    const confirmModal = document.getElementById('confirmModal');

    if (alertModal && alertModal.style.display === 'flex') {
        hideAlertModal();
    } else if (confirmModal && confirmModal.style.display === 'flex') {
        hideConfirmModal(false);
    }
});

window.AppModals = {
    showAlertModal,
    hideAlertModal,
    showConfirmModal,
    hideConfirmModal
};
