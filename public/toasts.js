/**
 * Non-blocking toast notifications (Phase 5)
 */
(function () {
    const TOAST_DURATION = 4000;

    function ensureContainer() {
        let container = document.getElementById('app-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'app-toast-container';
            container.className = 'app-toast-container';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-atomic', 'false');
            document.body.appendChild(container);
        }
        return container;
    }

    function getIcon(type) {
        if (type === 'success') {
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        }
        if (type === 'error') {
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        }
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    }

    function showToast(message, type = 'success', duration = TOAST_DURATION) {
        const container = ensureContainer();
        const toast = document.createElement('div');
        toast.className = `app-toast app-toast--${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

        toast.innerHTML = `
            <span class="app-toast-icon">${getIcon(type)}</span>
            <span class="app-toast-message"></span>
            <button type="button" class="app-toast-dismiss" aria-label="Dismiss notification">&times;</button>
        `;

        toast.querySelector('.app-toast-message').textContent = message;

        const dismiss = () => {
            toast.classList.add('app-toast--leaving');
            setTimeout(() => toast.remove(), 200);
        };

        toast.querySelector('.app-toast-dismiss').addEventListener('click', dismiss);

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('app-toast--visible'));

        const timer = setTimeout(dismiss, duration);
        toast.addEventListener('mouseenter', () => clearTimeout(timer));
        toast.addEventListener('mouseleave', () => setTimeout(dismiss, 1500));
    }

    window.showToast = showToast;
    window.AppToasts = { showToast };
})();
