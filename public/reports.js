class ReportsManager {
    constructor() {
        this.reportData = null;
        this.init();
    }

    async init() {
        // Set default date range to current month
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
            return; // Don't reload, wait for user to set dates
        } else {
            customRange.classList.remove('visible');
        }

        switch (preset) {
            case 'current-month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'last-month':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'current-quarter':
                const currentQuarter = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
                endDate = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
                break;
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

        if (startDate) {
            document.getElementById('startDate').value = this.formatDateForInput(startDate);
        } else {
            document.getElementById('startDate').value = '';
        }
        
        if (endDate) {
            document.getElementById('endDate').value = this.formatDateForInput(endDate);
        } else {
            document.getElementById('endDate').value = '';
        }

        this.loadReports();
    }

    async loadReports() {
        try {
            // Show loading spinners
            this.showLoading();

            // Build query params
            const params = new URLSearchParams();
            
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            const booked = document.getElementById('bookedFilter').value;

            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (booked && booked !== 'all') params.append('booked', booked);

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
        const containers = ['topClientsByAmount', 'topClientsByCount', 'topCities', 'topSources'];
        containers.forEach(id => {
            document.getElementById(id).innerHTML = '<div class="loading-spinner"></div>';
        });
    }

    showError() {
        const containers = ['topClientsByAmount', 'topClientsByCount', 'topCities', 'topSources'];
        containers.forEach(id => {
            document.getElementById(id).innerHTML = `
                <div class="no-data">
                    <div class="no-data-icon">⚠️</div>
                    <p>Error loading data</p>
                </div>
            `;
        });
    }

    renderReports() {
        if (!this.reportData) return;

        // Update summary cards
        this.renderSummary();

        // Render each report section
        this.renderTopClientsByAmount();
        this.renderTopClientsByCount();
        this.renderTopCities();
        this.renderTopSources();
    }

    renderSummary() {
        const { summary } = this.reportData;
        
        document.getElementById('totalQuotes').textContent = summary.totalQuotes.toLocaleString();
        document.getElementById('totalInvoice').textContent = this.formatCurrency(summary.totalInvoiceAmount);
        document.getElementById('bookedCount').textContent = summary.bookedCount.toLocaleString();
        document.getElementById('notBookedCount').textContent = summary.notBookedCount.toLocaleString();
        document.getElementById('conversionRate').textContent = `${summary.conversionRate}% conversion`;
    }

    renderTopClientsByAmount() {
        const container = document.getElementById('topClientsByAmount');
        const data = this.reportData.topClientsByAmount;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML('No client data available');
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
                            <div class="details">${item.count} event${item.count !== 1 ? 's' : ''}</div>
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
        const container = document.getElementById('topClientsByCount');
        const data = this.reportData.topClientsByCount;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML('No client data available');
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
                            <div class="details">${this.formatCurrency(item.total)} total</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} event${item.count !== 1 ? 's' : ''}</div>
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
                            <div class="details">${this.formatCurrency(item.total)} total</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} event${item.count !== 1 ? 's' : ''}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    renderTopSources() {
        const container = document.getElementById('topSources');
        const data = this.reportData.topSources;

        if (!data || data.length === 0) {
            container.innerHTML = this.getNoDataHTML('No lead source data available');
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
                            <div class="details">${this.formatCurrency(item.total)} total</div>
                        </div>
                        <div class="stats">
                            <div class="primary-stat">${item.count} event${item.count !== 1 ? 's' : ''}</div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(item.count / maxCount) * 100}%"></div>
                            </div>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    getNoDataHTML(message) {
        return `
            <div class="no-data">
                <div class="no-data-icon">📭</div>
                <p>${message}</p>
            </div>
        `;
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

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Display logged in user name
function displayUserName() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const userNameEl = document.getElementById('userDisplayName');
    if (userNameEl && user.name) {
        userNameEl.textContent = user.name;
    }
}

// Initialize the reports manager
let reportsManager;
document.addEventListener('DOMContentLoaded', () => {
    reportsManager = new ReportsManager();
    displayUserName();
});
