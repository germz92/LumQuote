/**
 * Shared app shell — nav, page header, profile menu, logout (Phase 1)
 */
const APP_NAV_ICONS = {
    projects: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    quotes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
    leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
};

const APP_NAV = [
    { id: 'projects', label: 'Projects', href: '/projects' },
    { id: 'quotes', label: 'Quotes', href: '/quotes' },
    { id: 'leads', label: 'Leads', href: '/leads' },
    { id: 'invoices', label: 'Invoices', href: '/invoices' },
    { id: 'clients', label: 'Clients', href: '/clients' },
    { id: 'calendar', label: 'Calendar', href: '/calendar' }
];

const SIDEBAR_COLLAPSED_KEY = 'lumquote_sidebar_collapsed';

// Apply the saved state before the shell mounts so the layout does not jump.
// The sidebar starts collapsed unless the user has explicitly expanded it.
(function applySavedSidebarState() {
    let collapsed = true;
    try {
        collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== '0';
    } catch (error) {
        // localStorage can be unavailable; fall back to the collapsed default.
    }
    if (collapsed) {
        document.documentElement.classList.add('app-sidebar-collapsed');
    }
})();

const AppShell = {
    currentUser: null,
    profileMenuOpen: false,
    mobileNavOpen: false,
    sidebarCollapsed: false,

    init() {
        const body = document.body;
        if (!body || body.dataset.appShell === 'off') return;

        const page = body.dataset.appPage || this.detectPage();
        const title = body.dataset.appTitle || document.title;
        const subtitle = body.dataset.appSubtitle || '';
        const showBack = body.dataset.appShowBack === 'true';

        this.sidebarCollapsed = document.documentElement.classList.contains('app-sidebar-collapsed');
        this.mount(page, { title, subtitle, showBack });
        this.initProfileMenu();
        this.initMobileNav();
        this.initSidebar();
        this.refreshUserProfile();
        this.refreshUnseenLeads(page === 'leads');
        body.classList.add('app-has-shell');
        this.updateLayoutOffsets();
    },

    async refreshUnseenLeads(markSeen) {
        try {
            if (markSeen) {
                await fetch('/api/leads/seen', { method: 'POST', credentials: 'include' });
            }
            const response = await fetch('/api/leads/unseen-count', { credentials: 'include' });
            if (!response.ok) return;
            const data = await response.json();
            const count = Number(data.count) || 0;
            document.querySelectorAll('[data-nav="leads"]').forEach((link) => {
                let badge = link.querySelector('.nav-unseen-badge');
                if (!count) {
                    badge?.remove();
                    return;
                }
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'nav-unseen-badge';
                    link.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : String(count);
            });
        } catch (error) {
            // Nav still works if the unseen count cannot be loaded.
        }
    },

    updateLayoutOffsets() {
        const topbar = document.querySelector('.app-topbar');
        // The slim top bar only exists on mobile; on desktop it is display:none and measures 0.
        const topbarHeight = topbar ? topbar.offsetHeight : 0;
        document.documentElement.style.setProperty('--app-topbar-height', `${topbarHeight}px`);
        const shellBody = document.querySelector('.app-shell-body');
        if (shellBody) {
            shellBody.style.paddingTop = `${topbarHeight}px`;
        }

        const pageControls = document.querySelector('.page-controls-sticky') || document.querySelector('.quotes-sticky-chrome');
        if (pageControls) {
            document.documentElement.style.setProperty('--quotes-controls-height', `${pageControls.offsetHeight}px`);
        }
    },

    detectPage() {
        const path = window.location.pathname.replace(/\/$/, '') || '/';
        if (path === '/quotes' || path === '/') return 'quotes';
        if (path === '/leads' || path.startsWith('/leads/')) return 'leads';
        if (path === '/projects' || path.startsWith('/projects/')) return 'projects';
        if (path === '/invoices') return 'invoices';
        if (path === '/clients') return 'clients';
        if (path === '/builder' || path === '/calculator' || path.startsWith('/quote')) return 'quote';
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
            const icon = APP_NAV_ICONS[item.id] || '';
            return `<a href="${item.href}" class="app-nav-link${active}" data-nav="${item.id}" title="${item.label}"${active ? ' aria-current="page"' : ''}>
                <span class="app-nav-link-icon">${icon}</span>
                <span class="app-nav-link-label">${item.label}</span>
            </a>`;
        }).join('');

        const backBtn = options.showBack
            ? `<button type="button" class="app-page-header-back" onclick="window.location.href='/quotes'" aria-label="Back to Quotes">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <polyline points="15,18 9,12 15,6"></polyline>
                </svg>
            </button>`
            : '';

        const subtitleHtml = options.subtitle
            ? `<span class="app-page-subtitle" id="app-page-subtitle">${this.escapeHtml(options.subtitle)}</span>`
            : `<span class="app-page-subtitle client-display" id="client-display" style="display: none;"></span>`;

        mount.innerHTML = `
        <div class="app-shell">
            <header class="app-topbar">
                <div class="app-topbar-inner">
                    <button
                        type="button"
                        class="app-nav-toggle"
                        id="appNavToggle"
                        aria-label="Open menu"
                        aria-expanded="false"
                        aria-controls="appSidebar"
                    >
                        <span class="app-nav-toggle-bars" aria-hidden="true">
                            <span></span><span></span><span></span>
                        </span>
                    </button>
                    <div class="app-brand">
                        <img src="/assets/logo.png" alt="Lumetry Media" class="app-brand-logo" onclick="window.location.href='/quotes'">
                    </div>
                    <button type="button" class="app-topbar-account" id="appTopbarAccount" aria-label="Open menu">
                        <span class="app-profile-avatar" id="appTopbarAvatar" aria-hidden="true"></span>
                    </button>
                </div>
            </header>
            <div class="app-sidebar-backdrop" id="appMobileNavBackdrop" aria-hidden="true"></div>
            <aside class="app-sidebar" id="appSidebar" aria-label="Main">
                <div class="app-sidebar-top">
                    <a href="/quotes" class="app-sidebar-brand" aria-label="Lumetry Media">
                        <img src="/assets/logo.png" alt="" class="app-sidebar-brand-full">
                        <img src="/assets/lumquote_transparent_favicon.png" alt="" class="app-sidebar-brand-mark">
                    </a>
                    <button type="button" class="app-sidebar-close" id="appMobileNavClose" aria-label="Close menu">&times;</button>
                </div>
                <nav class="app-sidebar-nav" aria-label="Main">${navHtml}</nav>
                <button
                    type="button"
                    class="app-sidebar-collapse"
                    id="appSidebarCollapse"
                    aria-expanded="${this.sidebarCollapsed ? 'false' : 'true'}"
                    aria-label="${this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
                    title="${this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
                >
                    <span class="app-nav-link-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </span>
                    <span class="app-nav-link-label">Collapse</span>
                </button>
                <div class="app-profile-menu app-sidebar-account" id="appProfileMenu">
                    <div
                        class="app-profile-dropdown"
                        id="appProfileDropdown"
                        role="menu"
                        hidden
                    >
                        <div class="app-profile-dropdown-header">
                            <span class="app-profile-avatar app-profile-avatar--lg" id="appProfileDropdownAvatar" aria-hidden="true"></span>
                            <div class="app-profile-dropdown-meta">
                                <div class="app-profile-dropdown-name" id="appProfileDropdownName"></div>
                                <div class="app-profile-dropdown-email" id="appProfileDropdownEmail"></div>
                            </div>
                        </div>
                        <a href="/reports" class="app-profile-dropdown-item" role="menuitem" data-profile-admin-only hidden>Reports</a>
                        <a href="/admin" class="app-profile-dropdown-item" role="menuitem" data-profile-admin-only hidden>Admin</a>
                        <label class="app-profile-dropdown-item app-profile-dropdown-item--action" role="menuitem">
                            <span>Update photo</span>
                            <input type="file" id="appProfilePhotoInput" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
                        </label>
                        <button type="button" class="app-profile-dropdown-item app-profile-dropdown-item--action" id="appProfileRemovePhoto" role="menuitem" hidden>Remove photo</button>
                        <div class="app-profile-dropdown-divider" role="separator"></div>
                        <button type="button" class="app-profile-dropdown-item app-profile-dropdown-item--danger" role="menuitem" onclick="logout()">Log out</button>
                    </div>
                    <button
                        type="button"
                        class="app-profile-trigger"
                        id="appProfileTrigger"
                        aria-haspopup="menu"
                        aria-expanded="false"
                        aria-controls="appProfileDropdown"
                        aria-label="Account menu"
                    >
                        <span class="app-profile-avatar" id="appProfileAvatar" aria-hidden="true"></span>
                        <span class="app-profile-trigger-meta">
                            <span class="app-profile-trigger-name" id="appProfileTriggerName">Account</span>
                            <span class="app-profile-trigger-hint">Account menu</span>
                        </span>
                        <span class="app-profile-trigger-chevron" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                        </span>
                    </button>
                </div>
            </aside>
            <div class="app-shell-body">
                <div class="app-shell-inner">
                    <div class="app-page-header">
                        ${backBtn}
                        <div class="app-page-header-body">
                            <h1 class="app-page-title">${this.escapeHtml(options.title)}</h1>
                            ${subtitleHtml}
                        </div>
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

    getStoredUser() {
        try {
            return JSON.parse(localStorage.getItem('user') || '{}');
        } catch {
            return {};
        }
    },

    setStoredUser(user) {
        this.currentUser = user;
        localStorage.setItem('user', JSON.stringify(user));
        this.applyUserToProfileUI(user);
    },

    avatarHue(name) {
        let hash = 0;
        const seed = name || 'user';
        for (let i = 0; i < seed.length; i++) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        return Math.abs(hash) % 360;
    },

    buildAvatarElement(user, sizeClass = '') {
        const name = user?.name || 'User';
        const initials = user?.initials || '?';
        const hue = this.avatarHue(name);
        const sizeAttr = sizeClass ? ` ${sizeClass}` : '';
        const imageUrl = user?.profileImageUrl;

        const el = document.createElement('span');
        el.className = `app-profile-avatar${sizeAttr}${imageUrl ? ' app-profile-avatar--has-image' : ''}`;
        el.style.setProperty('--avatar-hue', String(hue));

        if (imageUrl) {
            const img = document.createElement('img');
            img.className = 'app-profile-avatar__img';
            img.src = `${imageUrl}?t=${Date.now()}`;
            img.alt = '';
            img.loading = 'lazy';
            el.appendChild(img);
        }

        const initialsEl = document.createElement('span');
        initialsEl.className = 'app-profile-avatar__initials';
        initialsEl.textContent = initials;
        el.appendChild(initialsEl);

        return el;
    },

    mountAvatar(container, user) {
        if (!container) return;
        const isLarge = container.classList.contains('app-profile-avatar--lg');
        const next = this.buildAvatarElement(user, isLarge ? 'app-profile-avatar--lg' : '');
        if (container.id) next.id = container.id;
        container.replaceWith(next);
    },

    applyUserToProfileUI(user) {
        if (!user?.name) return;

        this.mountAvatar(document.getElementById('appProfileAvatar'), user);
        this.mountAvatar(document.getElementById('appProfileDropdownAvatar'), user);
        this.mountAvatar(document.getElementById('appTopbarAvatar'), user);

        const nameEl = document.getElementById('appProfileDropdownName');
        const triggerNameEl = document.getElementById('appProfileTriggerName');
        const emailEl = document.getElementById('appProfileDropdownEmail');
        const removeBtn = document.getElementById('appProfileRemovePhoto');

        if (nameEl) nameEl.textContent = user.name;
        if (triggerNameEl) triggerNameEl.textContent = user.name;
        if (emailEl) {
            emailEl.textContent = user.email || '';
            emailEl.hidden = !user.email;
        }
        if (removeBtn) {
            removeBtn.hidden = !user.profileImageUrl;
        }

        this.syncAdminProfileMenu(user);
    },

    syncAdminProfileMenu(user) {
        const isAdmin = user?.role === 'admin';
        document.querySelectorAll('[data-profile-admin-only]').forEach((el) => {
            el.hidden = !isAdmin;
        });
    },

    displayUserName() {
        const user = this.currentUser || this.getStoredUser();
        this.applyUserToProfileUI(user);
    },

    async refreshUserProfile() {
        const cached = this.getStoredUser();
        if (cached?.name) {
            this.applyUserToProfileUI(cached);
        }

        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (!response.ok) return;
            const data = await response.json();
            if (data.user) {
                this.setStoredUser(data.user);
            }
        } catch (error) {
            console.warn('Could not refresh user profile:', error.message);
        }
    },

    initProfileMenu() {
        const menu = document.getElementById('appProfileMenu');
        const trigger = document.getElementById('appProfileTrigger');
        const dropdown = document.getElementById('appProfileDropdown');
        const photoInput = document.getElementById('appProfilePhotoInput');
        const removeBtn = document.getElementById('appProfileRemovePhoto');

        if (!menu || !trigger || !dropdown) return;

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setProfileMenuOpen(!this.profileMenuOpen);
        });

        document.addEventListener('click', (event) => {
            if (!this.profileMenuOpen) return;
            if (!menu.contains(event.target)) {
                this.setProfileMenuOpen(false);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (this.mobileNavOpen) {
                this.setMobileNavOpen(false);
                document.getElementById('appNavToggle')?.focus();
                return;
            }
            if (this.profileMenuOpen) {
                this.setProfileMenuOpen(false);
                trigger.focus();
            }
        });

        photoInput?.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
                await this.uploadProfilePhoto(file);
            }
        });

        removeBtn?.addEventListener('click', async () => {
            await this.removeProfilePhoto();
        });
    },

    initMobileNav() {
        const toggle = document.getElementById('appNavToggle');
        const drawer = document.getElementById('appSidebar');
        const backdrop = document.getElementById('appMobileNavBackdrop');
        const closeBtn = document.getElementById('appMobileNavClose');
        const accountBtn = document.getElementById('appTopbarAccount');
        if (!toggle || !drawer || !backdrop) return;

        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setProfileMenuOpen(false);
            this.setMobileNavOpen(!this.mobileNavOpen);
        });

        // The mobile avatar opens the drawer and jumps to the account menu at its foot.
        accountBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setMobileNavOpen(true);
            this.setProfileMenuOpen(true);
        });

        closeBtn?.addEventListener('click', () => this.setMobileNavOpen(false));
        backdrop.addEventListener('click', () => this.setMobileNavOpen(false));

        drawer.querySelectorAll('a.app-nav-link').forEach((link) => {
            link.addEventListener('click', () => this.setMobileNavOpen(false));
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && this.mobileNavOpen) {
                this.setMobileNavOpen(false);
            }
        });
    },

    setMobileNavOpen(open) {
        this.mobileNavOpen = open;
        const toggle = document.getElementById('appNavToggle');
        const drawer = document.getElementById('appSidebar');
        const backdrop = document.getElementById('appMobileNavBackdrop');
        if (!toggle || !drawer || !backdrop) return;

        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        toggle.classList.toggle('is-open', open);
        drawer.classList.toggle('is-open', open);
        backdrop.classList.toggle('is-open', open);
        backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.body.classList.toggle('app-mobile-nav-open', open);

        if (open) {
            document.getElementById('appMobileNavClose')?.focus();
        } else {
            this.setProfileMenuOpen(false);
        }
    },

    initSidebar() {
        const button = document.getElementById('appSidebarCollapse');
        if (!button) return;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setSidebarCollapsed(!this.sidebarCollapsed);
        });
    },

    setSidebarCollapsed(collapsed) {
        this.sidebarCollapsed = collapsed;
        document.documentElement.classList.toggle('app-sidebar-collapsed', collapsed);
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
        } catch (error) {
            // Preference simply will not persist without storage.
        }
        const button = document.getElementById('appSidebarCollapse');
        if (button) {
            const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
            button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
        }
        this.setProfileMenuOpen(false);
    },

    setProfileMenuOpen(open) {
        this.profileMenuOpen = open;
        const trigger = document.getElementById('appProfileTrigger');
        const dropdown = document.getElementById('appProfileDropdown');
        if (!trigger || !dropdown) return;

        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        dropdown.hidden = !open;
        dropdown.classList.toggle('is-open', open);
    },

    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read image file'));
            reader.readAsDataURL(file);
        });
    },

    async uploadProfilePhoto(file) {
        if (!file.type.startsWith('image/')) {
            showAlertModal?.('Please choose an image file.', 'error');
            return;
        }

        try {
            const imageData = await this.readFileAsDataUrl(file);
            const response = await fetch('/api/me/profile-image', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to upload photo');
            }
            if (data.user) {
                this.setStoredUser(data.user);
            }
            this.setProfileMenuOpen(false);
            showAlertModal?.('Profile photo updated.', 'success', null, true);
        } catch (error) {
            console.error('Profile upload error:', error);
            showAlertModal?.(error.message || 'Failed to upload photo.', 'error');
        }
    },

    async removeProfilePhoto() {
        try {
            const response = await fetch('/api/me/profile-image', {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to remove photo');
            }
            if (data.user) {
                this.setStoredUser(data.user);
            }
            this.setProfileMenuOpen(false);
            showAlertModal?.('Profile photo removed.', 'success', null, true);
        } catch (error) {
            console.error('Profile remove error:', error);
            showAlertModal?.(error.message || 'Failed to remove photo.', 'error');
        }
    },

    syncAdminNav() {
        this.syncAdminProfileMenu(this.currentUser || this.getStoredUser());
    }
};

function clearQuoteData(event, redirectUrl = null) {
    if (event) event.preventDefault();

    localStorage.removeItem('quote_calculator_draft');
    sessionStorage.removeItem('loadQuoteData');
    sessionStorage.setItem('lumquote_start_new', '1');

    const path = window.location.pathname.replace(/\/$/, '') || '/';
    const onQuoteEditor = path === '/builder' || path === '/calculator' || path === '/quote';

    if (onQuoteEditor) {
        if (typeof calculator !== 'undefined' && calculator) {
            calculator.clearDraft({ startUntitled: true });
        } else {
            window.location.reload();
        }
        return;
    }

    window.location.href = redirectUrl || '/quote';
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

let layoutOffsetResizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(layoutOffsetResizeTimer);
    layoutOffsetResizeTimer = setTimeout(() => {
        if (window.AppShell) {
            AppShell.updateLayoutOffsets();
        }
    }, 150);
});

window.AppShell = AppShell;
