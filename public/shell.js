/**
 * Shared app shell — nav, page header, profile menu, logout (Phase 1)
 */
const APP_NAV = [
    { id: 'quotes', label: 'Quotes', href: '/quotes' },
    { id: 'calendar', label: 'Calendar', href: '/calendar' }
];

const AppShell = {
    currentUser: null,
    profileMenuOpen: false,

    init() {
        const body = document.body;
        if (!body || body.dataset.appShell === 'off') return;

        const page = body.dataset.appPage || this.detectPage();
        const title = body.dataset.appTitle || document.title;
        const subtitle = body.dataset.appSubtitle || '';
        const showBack = body.dataset.appShowBack === 'true';

        this.mount(page, { title, subtitle, showBack });
        this.initProfileMenu();
        this.refreshUserProfile();
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
            return `<a href="${item.href}" class="app-nav-link${active}" data-nav="${item.id}">${item.label}</a>`;
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
                    <div class="app-brand">
                        <img src="/assets/logo.png" alt="Lumetry Media" class="app-brand-logo" onclick="window.location.href='/quotes'">
                    </div>
                    <nav class="app-nav" aria-label="Main">${navHtml}${this.renderNewQuoteNavCta()}</nav>
                    <div class="app-shell-util">
                        <div class="app-profile-menu" id="appProfileMenu">
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
                            </button>
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
                                <a href="/admin" class="app-profile-dropdown-item" role="menuitem">Admin</a>
                                <label class="app-profile-dropdown-item app-profile-dropdown-item--action" role="menuitem">
                                    <span>Update photo</span>
                                    <input type="file" id="appProfilePhotoInput" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
                                </label>
                                <button type="button" class="app-profile-dropdown-item app-profile-dropdown-item--action" id="appProfileRemovePhoto" role="menuitem" hidden>Remove photo</button>
                                <div class="app-profile-dropdown-divider" role="separator"></div>
                                <button type="button" class="app-profile-dropdown-item app-profile-dropdown-item--danger" role="menuitem" onclick="logout()">Log out</button>
                            </div>
                        </div>
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

    renderNewQuoteNavCta() {
        return `<a href="/quote" class="app-nav-cta" onclick="clearQuoteData(event)">
            <svg class="app-nav-cta__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span class="app-nav-cta__label">New Quote</span>
        </a>`;
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

        const nameEl = document.getElementById('appProfileDropdownName');
        const emailEl = document.getElementById('appProfileDropdownEmail');
        const removeBtn = document.getElementById('appProfileRemovePhoto');

        if (nameEl) nameEl.textContent = user.name;
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
            if (event.key === 'Escape' && this.profileMenuOpen) {
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

function clearQuoteData(event) {
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

    window.location.href = '/quote';
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
