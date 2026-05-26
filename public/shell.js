/**
 * Shared app shell — nav, page header, user, logout (Phase 1)
 */
const APP_NAV = [
    { id: 'quotes', label: 'Quotes', href: '/quotes' },
    { id: 'builder', label: 'Builder', href: '/builder' },
    { id: 'calendar', label: 'Calendar', href: '/calendar' },
    { id: 'reports', label: 'Reports', href: '/reports', adminOnly: true },
    { id: 'admin', label: 'Admin', href: '/admin' }
];

const AppShell = {
    init() {
        const body = document.body;
        if (!body || body.dataset.appShell === 'off') return;

        const page = body.dataset.appPage || this.detectPage();
        const title = body.dataset.appTitle || document.title;
        const subtitle = body.dataset.appSubtitle || '';
        const showBack = body.dataset.appShowBack === 'true';
        const showNewQuote = body.dataset.appNewQuote === 'true';

        this.mount(page, { title, subtitle, showBack, showNewQuote });
        this.displayUserName();
        this.syncAdminNav();
        this.updateLayoutOffsets();
        body.classList.add('app-has-shell');
    },

    updateLayoutOffsets() {
        const topbar = document.querySelector('.app-topbar');
        const topbarInner = document.querySelector('.app-topbar-inner');
        const topbarHeight = topbar?.offsetHeight || topbarInner?.offsetHeight;
        if (topbarHeight) {
            document.documentElement.style.setProperty('--app-topbar-height', `${topbarHeight}px`);
            const shellBody = document.querySelector('.app-shell-body');
            if (shellBody) {
                shellBody.style.paddingTop = `${topbarHeight}px`;
            }
        }

        const quotesChrome = document.querySelector('.quotes-sticky-chrome');
        if (quotesChrome) {
            document.documentElement.style.setProperty('--quotes-controls-height', `${quotesChrome.offsetHeight}px`);
        }
    },

    detectPage() {
        const path = window.location.pathname.replace(/\/$/, '') || '/';
        if (path === '/quotes' || path === '/') return 'quotes';
        if (path === '/builder' || path === '/calculator') return 'builder';
        if (path === '/calendar') return 'calendar';
        if (path === '/reports') return 'reports';
        if (path === '/admin') return 'admin';
        return '';
    },

    mount(activePage, options) {
        const container = document.querySelector('.container');
        if (!container) return;

        let mount = document.getElementById('app-shell-mount');
        if (!mount) {
            mount = document.createElement('div');
            mount.id = 'app-shell-mount';
            container.insertBefore(mount, container.firstChild);
        }

        const navHtml = APP_NAV.map((item) => {
            const active = item.id === activePage ? ' is-active' : '';
            const adminAttr = item.adminOnly ? ' data-admin-only="true" style="display: none;"' : '';
            return `<a href="${item.href}" class="app-nav-link${active}" data-nav="${item.id}" id="${item.id === 'reports' ? 'reportsLink' : ''}"${adminAttr}>${item.label}</a>`;
        }).join('');

        const backBtn = options.showBack
            ? `<button type="button" class="app-page-header-back" onclick="window.location.href='/quotes'" aria-label="Back to Quotes">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <polyline points="15,18 9,12 15,6"></polyline>
                </svg>
            </button>`
            : '';

        const newQuoteBtn = options.showNewQuote
            ? `<button type="button" class="btn btn-primary btn-md" onclick="clearQuoteData(event)">New Quote</button>`
            : '';

        const subtitleHtml = options.subtitle
            ? `<span class="app-page-subtitle" id="app-page-subtitle">${this.escapeHtml(options.subtitle)}</span>`
            : `<span class="app-page-subtitle client-display" id="client-display" style="display: none;"></span>`;

        mount.innerHTML = `
        <div class="app-shell">
            <header class="app-topbar">
                <div class="app-topbar-inner">
                    <div class="app-brand">
                        <img src="/assets/logo.png" alt="Lumetry Media" class="app-brand-logo" onclick="window.location.href='/quotes'">
                    </div>
                    <nav class="app-nav" aria-label="Main">${navHtml}</nav>
                    <div class="app-shell-util">
                        <span class="app-user-badge" id="userDisplayName"></span>
                        <button type="button" class="logout-btn" onclick="logout()">Logout</button>
                    </div>
                </div>
            </header>
            <div class="app-shell-body">
                <div class="app-shell-inner">
                    <div class="app-page-header">
                        ${backBtn}
                        <div class="app-page-header-body">
                            <h1 class="app-page-title">${this.escapeHtml(options.title)}</h1>
                            ${subtitleHtml}
                        </div>
                        ${newQuoteBtn ? `<div class="app-page-header-actions">${newQuoteBtn}</div>` : ''}
                    </div>
                </div>
            </div>
        </div>`;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    displayUserName() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const el = document.getElementById('userDisplayName');
        if (el && user.name) {
            el.textContent = user.name;
        }
    },

    syncAdminNav() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (user.role !== 'admin') return;

        document.querySelectorAll('[data-admin-only="true"]').forEach((el) => {
            el.style.display = '';
        });

        const reportsLink = document.getElementById('reportsLink');
        if (reportsLink) reportsLink.style.display = '';
    }
};

function clearQuoteData(event) {
    if (event) event.preventDefault();

    localStorage.removeItem('quote_calculator_draft');
    sessionStorage.removeItem('loadQuoteData');

    const path = window.location.pathname.replace(/\/$/, '') || '/';
    const onBuilder = path === '/builder' || path === '/calculator';

    if (onBuilder) {
        if (typeof calculator !== 'undefined' && calculator) {
            calculator.clearDraft();
        } else {
            window.location.reload();
        }
        return;
    }

    window.location.href = '/builder';
}

async function logout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
    }
}

function displayUserName() {
    AppShell.displayUserName();
}

document.addEventListener('DOMContentLoaded', () => AppShell.init());

window.addEventListener('resize', () => {
    if (window.AppShell) {
        AppShell.updateLayoutOffsets();
    }
});

window.AppShell = AppShell;
