/**
 * Compact mobile behavior for shared list page-controls bars.
 */
const PageControls = {
    toggleFilters(button) {
        const bar = button?.closest?.('.page-controls');
        if (!bar) return;
        const open = !bar.classList.contains('is-filters-open');
        bar.classList.toggle('is-filters-open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        const label = button.querySelector('.pc-filters-toggle-label');
        if (label) {
            if (!button.dataset.closedLabel) {
                button.dataset.closedLabel = (label.textContent || 'Filters').trim();
            }
            label.textContent = open ? 'Hide' : button.dataset.closedLabel;
        }
    },

    /** Mark Filters toggle when any non-default filter is active. */
    syncFilterIndicator(barOrSelector, isActive) {
        const bar = typeof barOrSelector === 'string'
            ? document.querySelector(barOrSelector)
            : barOrSelector;
        if (!bar) return;
        bar.classList.toggle('has-active-filters', !!isActive);
        const toggle = bar.querySelector('.pc-filters-toggle');
        if (toggle) toggle.classList.toggle('is-active', !!isActive);
    }
};

window.PageControls = PageControls;
