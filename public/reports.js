class ReportsManager {
    constructor() {
        this.reportData = null;
        this.view = this.readViewFromUrl();
        this.cardIds = [
            'pipelineByStatus',
            'cashSummary',
            'topClientsByPaid',
            'topClientsByProjects',
            'topCities',
            'leadSources'
        ];
        this.copy = {
            projects: {
                subtitle: 'Pipeline and invoice cash across your projects',
                countLabel: 'Projects',
                thirdLabel: 'Invoices',
                primaryLabel: 'Invoiced',
                secondaryLabel: 'Paid',
                tertiaryLabel: 'Outstanding',
                pipelineHeading: 'Pipeline by status',
                valueHeading: 'Cash summary',
                topValueHeading: 'Top clients by paid',
                topCountHeading: 'Top clients by projects',
                placesHeading: 'Top cities',
                noun: 'project',
                nouns: 'projects',
                valueSuffix: 'invoiced',
                emptyPipeline: 'No projects in this period',
                emptyValue: 'No invoice activity in this period',
                emptyTopValue: 'No paid invoice data available',
                emptyTopCount: 'No project data available',
                emptyPlaces: 'No location data available',
                emptyLeads: 'No project lead sources in this period'
            },
            quotes: {
                subtitle: 'Volume and quoted value across your quotes',
                countLabel: 'Quotes',
                thirdLabel: 'Linked',
                primaryLabel: 'Quoted',
                secondaryLabel: 'Booked',
                tertiaryLabel: 'Open',
                pipelineHeading: 'Quote status',
                valueHeading: 'Quote value',
                topValueHeading: 'Top clients by quoted',
                topCountHeading: 'Top clients by quotes',
                placesHeading: 'Top locations',
                noun: 'quote',
                nouns: 'quotes',
                valueSuffix: 'quoted',
                emptyPipeline: 'No quotes in this period',
                emptyValue: 'No quote activity in this period',
                emptyTopValue: 'No quoted value in this period',
                emptyTopCount: 'No quote data available',
                emptyPlaces: 'No location data available',
                emptyLeads: 'No quote lead sources in this period'
            }
        };
        this.init();
    }

    readViewFromUrl() {
        const view = new URLSearchParams(window.location.search).get('view');
        return view === 'quotes' ? 'quotes' : 'projects';
    }

    async init() {
        this.applyViewChrome();
        this.setCurrentMonthDates();
        await this.loadReports();
    }

    setView(view) {
        if (view !== 'projects' && view !== 'quotes') return;
        if (this.view === view) return;
        this.view = view;
        const url = new URL(window.location.href);
        if (view === 'quotes') url.searchParams.set('view', 'quotes');
        else url.searchParams.delete('view');
        window.history.replaceState({}, '', url);
        this.applyViewChrome();
        this.renderReports();
    }

    applyViewChrome() {
        const copy = this.copy[this.view];
        document.body.dataset.appSubtitle = copy.subtitle;
        const subtitleEl = document.getElementById('app-page-subtitle');
        if (subtitleEl) subtitleEl.textContent = copy.subtitle;

        document.getElementById('reportViewProjectsBtn')?.classList.toggle('is-active', this.view === 'projects');
        document.getElementById('reportViewQuotesBtn')?.classList.toggle('is-active', this.view === 'quotes');

        this.setText('summaryCountLabel', copy.countLabel);
        this.setText('summaryThirdLabel', copy.thirdLabel);
        this.setText('summaryPrimaryLabel', copy.primaryLabel);
        this.setText('summarySecondaryLabel', copy.secondaryLabel);
        this.setText('summaryTertiaryLabel', copy.tertiaryLabel);
        this.setText('headingPipeline', copy.pipelineHeading);
        this.setText('headingValue', copy.valueHeading);
        this.setText('headingTopValue', copy.topValueHeading);
        this.setText('headingTopCount', copy.topCountHeading);
        this.setText('headingPlaces', copy.placesHeading);
    }

    setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    currentSlice() {
        if (!this.reportData) return null;
        return this.reportData[this.view] || null;
    }

    setCurrentMonthDates() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        document.getElementById('startDate').value = this.formatDateForInput(firstDay);
        document.getElementById('endDate').value = this.formatDateForInput(lastDay);
    }

    formatDateForInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    handleTimePresetChange() {
        const preset = document.getElementById('timePreset').value;
        const customRange = document.getElementById('customDateRange');
        const now = new Date();
        let startDate, endDate;

        if (preset === 'custom') {
            customRange.classList.add('visible');
            return;
        }
        customRange.classList.remove('visible');

        switch (preset) {
            case 'current-month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'last-month':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'current-quarter': {
                const currentQuarter = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
                endDate = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
                break;
            }
            case 'current-year':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
                break;
            case 'last-year':
                startDate = new Date(now.getFullYear() - 1, 0, 1);
                endDate = new Date(now.getFullYear() - 1, 11, 31);
                break;
            case 'all-time':
                startDate = null;
                endDate = null;
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }

        document.getElementById('startDate').value = startDate ? this.formatDateForInput(startDate) : '';
        document.getElementById('endDate').value = endDate ? this.formatDateForInput(endDate) : '';
        this.loadReports();
    }

    async loadReports() {
        try {
            this.showLoading();

            const params = new URLSearchParams();
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const response = await fetch(`/api/reports?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Failed to load reports');
            }

            this.reportData = await response.json();
            this.renderReports();
        } catch (error) {
            console.error('Error loading reports:', error);
            this.showError();
        }
    }

    showLoading() {
        this.cardIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="loading-spinner"></div>';
        });
    }

    showError() {
        this.cardIds.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = this.getNoDataHTML('Error loading data', 'alert');
        });
    }

    renderReports() {
        if (!this.currentSlice()) return;
        this.applyViewChrome();
        this.renderSummary();
        this.renderPipeline();
        this.renderValueSummary();
        this.renderTopClientsByValue();
        this.renderTopClientsByCount();
        this.renderTopPlaces();
        this.renderLeadSources();
    }

    renderSummary() {
        const { summary } = this.currentSlice();
        document.getElementById('totalProjects').textContent = (summary.count || 0).toLocaleString();
        document.getElementById('bookedPlusCount').textContent = (summary.bookedCount || 0).toLocaleString();
        document.getElementById('conversionRate').textContent = `${summary.conversionRate || 0}% conversion`;
        document.getElementById('invoiceCount').textContent = (summary.thirdCount || 0).toLocaleString();
        document.getElementById('invoicedTotal').textContent = this.formatCurrency(summary.primaryTotal);
        document.getElementById('paidTotal').textContent = this.formatCurrency(summary.secondaryTotal);
        document.getElementById('outstandingTotal').textContent = this.formatCurrency(summary.tertiaryTotal);
    }

    renderPipeline() {
        const container = document.getElementById('pipelineByStatus');
        const copy = this.copy[this.view];
        const data = this.currentSlice().pipeline || [];
        const withActivity = data.filter((row) => row.count > 0);

        if (withActivity.length === 0) {
            container.innerHTML = this.getNoDataHTML(copy.emptyPipeline);
            return;
        }

        const maxCount = Math.max(...withActivity.map((row) => row.count), 1);
        container.innerHTML = `
            <ul class="report-list">
                ${withActivity.map((item) => `
                    <li class="report-list-item">
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.label)}</div>
                            <div class="details">${this.formatCurrency(item.total)} ${copy.valueSuffix}</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} ${item.count === 1 ? copy.noun : copy.nouns}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderValueSummary() {
        const container = document.getElementById('cashSummary');
        const copy = this.copy[this.view];
        const rows = this.currentSlice().value || [];
        const maxTotal = Math.max(...rows.map((r) => r.total), 1);

        if (rows.every((r) => r.total === 0)) {
            container.innerHTML = this.getNoDataHTML(copy.emptyValue);
            return;
        }

        container.innerHTML = `
            <ul class="report-list reports-cash-list">
                ${rows.map((item) => `
                    <li class="report-list-item">
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.label)}</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${this.formatCurrency(item.total)}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.total / maxTotal) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderTopClientsByValue() {
        const container = document.getElementById('topClientsByPaid');
        const copy = this.copy[this.view];
        const data = this.currentSlice().topClientsByValue;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML(copy.emptyTopValue);
            return;
        }

        const maxTotal = data[0]?.total || 1;
        container.innerHTML = `
            <ul class="report-list">
                ${data.map((item, index) => `
                    <li class="report-list-item">
                        <span class="rank ${index < 3 ? 'top-3' : ''}">${index + 1}</span>
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.name)}</div>
                            <div class="details">${this.view === 'quotes'
                                ? `${item.count} quote${item.count !== 1 ? 's' : ''}`
                                : `${item.count} invoice${item.count !== 1 ? 's' : ''}`}</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${this.formatCurrency(item.total)}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.total / maxTotal) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderTopClientsByCount() {
        const container = document.getElementById('topClientsByProjects');
        const copy = this.copy[this.view];
        const data = this.currentSlice().topClientsByCount;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML(copy.emptyTopCount);
            return;
        }

        const maxCount = data[0]?.count || 1;
        container.innerHTML = `
            <ul class="report-list">
                ${data.map((item, index) => `
                    <li class="report-list-item">
                        <span class="rank ${index < 3 ? 'top-3' : ''}">${index + 1}</span>
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.name)}</div>
                            <div class="details">${this.formatCurrency(item.total)} ${copy.valueSuffix}</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} ${item.count === 1 ? copy.noun : copy.nouns}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderTopPlaces() {
        const container = document.getElementById('topCities');
        const copy = this.copy[this.view];
        const data = this.currentSlice().topPlaces;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML(copy.emptyPlaces);
            return;
        }

        const maxCount = data[0]?.count || 1;
        container.innerHTML = `
            <ul class="report-list">
                ${data.map((item, index) => `
                    <li class="report-list-item">
                        <span class="rank ${index < 3 ? 'top-3' : ''}">${index + 1}</span>
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.name)}</div>
                            <div class="details">${this.formatCurrency(item.total)} ${copy.valueSuffix}</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} ${item.count === 1 ? copy.noun : copy.nouns}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderLeadSources() {
        const container = document.getElementById('leadSources');
        if (!container) return;
        const copy = this.copy[this.view];
        const data = this.currentSlice().leadSources || [];

        if (data.length === 0) {
            container.innerHTML = this.getNoDataHTML(copy.emptyLeads);
            return;
        }

        const maxCount = Math.max(...data.map((row) => row.count), 1);
        container.innerHTML = `
            <ul class="report-list">
                ${data.map((item) => `
                    <li class="report-list-item">
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.name)}</div>
                            <div class="details">${item.booked || 0} booked · ${this.formatCurrency(item.total)} ${copy.valueSuffix}</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} ${item.count === 1 ? copy.noun : copy.nouns}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    getNoDataHTML(message, iconKey = 'inbox') {
        const icon = (window.ReportsIcons && window.ReportsIcons[iconKey]) || '';
        return `
            <div class="no-data reports-no-data">
                <div class="reports-no-data__icon">${icon}</div>
                <p class="reports-no-data__message">${this.escapeHtml(message)}</p>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    formatCurrency(amount) {
        if (amount === undefined || amount === null) return '$0';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }
}

let reportsManager;
document.addEventListener('DOMContentLoaded', () => {
    reportsManager = new ReportsManager();
});
