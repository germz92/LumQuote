class ReportsManager {
    constructor() {
        this.reportData = null;
        this.cardIds = [
            'pipelineByStatus',
            'cashSummary',
            'topClientsByPaid',
            'topClientsByProjects',
            'topCities'
        ];
        this.init();
    }

    async init() {
        this.setCurrentMonthDates();
        await this.loadReports();
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
        if (!this.reportData) return;
        this.renderSummary();
        this.renderPipelineByStatus();
        this.renderCashSummary();
        this.renderTopClientsByPaid();
        this.renderTopClientsByProjects();
        this.renderTopCities();
    }

    renderSummary() {
        const { summary } = this.reportData;
        document.getElementById('totalProjects').textContent = (summary.totalProjects || 0).toLocaleString();
        document.getElementById('bookedPlusCount').textContent = (summary.bookedPlusCount || 0).toLocaleString();
        document.getElementById('conversionRate').textContent = `${summary.conversionRate || 0}% conversion`;
        document.getElementById('invoiceCount').textContent = (summary.invoiceCount || 0).toLocaleString();
        document.getElementById('invoicedTotal').textContent = this.formatCurrency(summary.invoicedTotal);
        document.getElementById('paidTotal').textContent = this.formatCurrency(summary.paidTotal);
        document.getElementById('outstandingTotal').textContent = this.formatCurrency(summary.outstandingTotal);
    }

    renderPipelineByStatus() {
        const container = document.getElementById('pipelineByStatus');
        const data = this.reportData.pipelineByStatus || [];
        const withActivity = data.filter((row) => row.count > 0);

        if (withActivity.length === 0) {
            container.innerHTML = this.getNoDataHTML('No projects in this period');
            return;
        }

        const maxCount = Math.max(...withActivity.map((row) => row.count), 1);
        container.innerHTML = `
            <ul class="report-list">
                ${withActivity.map((item) => `
                    <li class="report-list-item">
                        <div class="info">
                            <div class="name">${this.escapeHtml(item.label)}</div>
                            <div class="details">${this.formatCurrency(item.invoicedTotal)} invoiced</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} project${item.count !== 1 ? 's' : ''}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderCashSummary() {
        const container = document.getElementById('cashSummary');
        const cash = this.reportData.cash || {};
        const rows = [
            { label: 'Invoiced', total: cash.invoicedTotal || 0 },
            { label: 'Paid', total: cash.paidTotal || 0 },
            { label: 'Outstanding', total: cash.outstandingTotal || 0 }
        ];
        const maxTotal = Math.max(...rows.map((r) => r.total), 1);

        if (rows.every((r) => r.total === 0)) {
            container.innerHTML = this.getNoDataHTML('No invoice activity in this period');
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

    renderTopClientsByPaid() {
        const container = document.getElementById('topClientsByPaid');
        const data = this.reportData.topClientsByPaid;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML('No paid invoice data available');
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
                            <div class="details">${item.count} invoice${item.count !== 1 ? 's' : ''}</div>
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

    renderTopClientsByProjects() {
        const container = document.getElementById('topClientsByProjects');
        const data = this.reportData.topClientsByProjects;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML('No project data available');
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
                            <div class="details">${this.formatCurrency(item.invoicedTotal)} invoiced</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} project${item.count !== 1 ? 's' : ''}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderTopCities() {
        const container = document.getElementById('topCities');
        const data = this.reportData.topCities;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML('No location data available');
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
                            <div class="details">${this.formatCurrency(item.total)} invoiced</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} project${item.count !== 1 ? 's' : ''}</div>
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
