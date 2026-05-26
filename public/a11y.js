/**
 * Accessibility helpers — overflow menus, focus (Phase 5)
 */
(function () {
    function getMenuItems(dropdown) {
        return Array.from(dropdown.querySelectorAll('.overflow-menu-item:not([disabled])'));
    }

    function getDropdownForButton(btn) {
        const menu = btn.closest('.quote-overflow-menu');
        return menu ? menu.querySelector('.quote-overflow-dropdown') : null;
    }

    function isDropdownOpen(dropdown) {
        return dropdown && dropdown.style.display === 'block';
    }

    function enhanceOpenMenu(btn, dropdown) {
        btn.setAttribute('aria-expanded', 'true');
        dropdown.setAttribute('role', 'menu');

        const items = getMenuItems(dropdown);
        items.forEach((item, index) => {
            item.setAttribute('role', 'menuitem');
            item.tabIndex = index === 0 ? 0 : -1;
        });

        if (items.length > 0) {
            items[0].focus();
        }
    }

    function closeMenuFromButton(btn) {
        const dropdown = getDropdownForButton(btn);
        if (!dropdown) return;

        btn.setAttribute('aria-expanded', 'false');
        dropdown.style.display = 'none';
        dropdown.removeAttribute('role');
        getMenuItems(dropdown).forEach((item) => {
            item.removeAttribute('role');
            item.tabIndex = -1;
        });
    }

    function closeAllOverflowMenus(focusButton = true) {
        document.querySelectorAll('.quote-overflow-dropdown').forEach((dropdown) => {
            if (!isDropdownOpen(dropdown)) return;

            const btn = dropdown.closest('.quote-overflow-menu')?.querySelector('.quote-overflow-btn');
            dropdown.style.display = 'none';
            dropdown.removeAttribute('role');

            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                if (focusButton) btn.focus();
            }

            getMenuItems(dropdown).forEach((item) => {
                item.removeAttribute('role');
                item.tabIndex = -1;
            });
        });

        document.querySelectorAll('.quote-card.menu-open, .actions-cell.menu-open').forEach((el) => {
            el.classList.remove('menu-open');
        });
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.quote-overflow-btn');
        if (!btn) return;

        requestAnimationFrame(() => {
            const dropdown = getDropdownForButton(btn);
            if (dropdown && isDropdownOpen(dropdown)) {
                enhanceOpenMenu(btn, dropdown);
            } else {
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        const btn = e.target.closest('.quote-overflow-btn');
        if (btn && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            btn.click();
            return;
        }

        if (e.key === 'Escape') {
            const inMenu = e.target.closest('.quote-overflow-dropdown');
            if (inMenu || document.querySelector('.quote-overflow-dropdown[style*="block"]')) {
                e.preventDefault();
                closeAllOverflowMenus(true);
            }
            return;
        }

        const active = document.activeElement;
        if (!active?.classList?.contains('overflow-menu-item')) return;

        const dropdown = active.closest('.quote-overflow-dropdown');
        if (!dropdown || !isDropdownOpen(dropdown)) return;

        const items = getMenuItems(dropdown);
        const index = items.indexOf(active);
        if (index === -1) return;

        let nextIndex = index;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            nextIndex = (index + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            nextIndex = (index - 1 + items.length) % items.length;
        } else if (e.key === 'Home') {
            e.preventDefault();
            nextIndex = 0;
        } else if (e.key === 'End') {
            e.preventDefault();
            nextIndex = items.length - 1;
        } else if (e.key === 'Tab') {
            closeAllOverflowMenus(false);
            return;
        } else {
            return;
        }

        items.forEach((item, i) => {
            item.tabIndex = i === nextIndex ? 0 : -1;
        });
        items[nextIndex].focus();
    });

    function initOverflowButtons(root = document) {
        root.querySelectorAll('.quote-overflow-btn').forEach((btn) => {
            if (!btn.hasAttribute('aria-haspopup')) {
                btn.setAttribute('aria-haspopup', 'true');
            }
            if (!btn.hasAttribute('aria-expanded')) {
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initOverflowButtons();

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        initOverflowButtons(node);
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });

    window.AppA11y = { closeAllOverflowMenus };
})();
