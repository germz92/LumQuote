class CalendarView {
    constructor() {
        this.currentDate = new Date();
        this.events = [];
        this.currentTooltip = null;
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadEvents();
        this.renderCalendar();
    }

    setupEventListeners() {
        // Navigation buttons
        document.getElementById('prevMonth').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            this.renderCalendar();
        });

        document.getElementById('nextMonth').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            this.renderCalendar();
        });

        // Tooltip close button
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tooltip-close') || 
                e.target.id === 'closeTooltipBtn') {
                this.hideTooltip();
            }
        });

        // Open quote button
        document.getElementById('openQuoteBtn').addEventListener('click', () => {
            if (this.currentEventData) {
                this.loadQuote(this.currentEventData.extendedProps.quoteName);
            }
        });

        // Hide tooltip when clicking outside
        document.addEventListener('click', (e) => {
            if (this.currentTooltip && 
                !this.currentTooltip.contains(e.target) && 
                !e.target.closest('.calendar-event') &&
                !e.target.closest('.spanning-event')) {
                this.hideTooltip();
            }
        });
    }

    async loadEvents() {
        try {
            this.showLoading(true);
            
            const response = await fetch('/api/calendar-events');
            if (!response.ok) {
                throw new Error('Failed to load calendar events');
            }
            
            this.events = await response.json();
            
        } catch (error) {
            console.error('Error loading events:', error);
            this.showAlert('Failed to load calendar events. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        // Update month title
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;

        // Generate calendar grid
        this.renderCalendarGrid(year, month);
    }

    renderCalendarGrid(year, month) {
        const grid = document.getElementById('calendarGrid');
        grid.innerHTML = '';

        // First day of the month and last day
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        // Start from the Sunday of the week containing the first day
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - startDate.getDay());
        
        // End on the Saturday of the week containing the last day
        const endDate = new Date(lastDay);
        endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Store all dates for event rendering
        this.calendarDates = [];
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            this.calendarDates.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Generate calendar days
        this.calendarDates.forEach(date => {
            const dayElement = this.createDayElement(date, month, today);
            grid.appendChild(dayElement);
        });

        // Render events using absolute positioning for true spanning
        this.renderSpanningEvents();
    }

    createDayElement(date, currentMonth, today) {
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        
        const isCurrentMonth = date.getMonth() === currentMonth;
        const isToday = date.getTime() === today.getTime();
        
        if (!isCurrentMonth) {
            dayElement.classList.add('other-month');
        }
        if (isToday) {
            dayElement.classList.add('today');
        }

        // Day number
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = date.getDate();
        dayElement.appendChild(dayNumber);

        // Events container
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'day-events';
        eventsContainer.dataset.date = this.formatDateString(date);
        
        dayElement.appendChild(eventsContainer);

        return dayElement;
    }

    getEventsForDay(date) {
        const dateStr = this.formatDateString(date);
        
        return this.events.filter(event => {
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);
            
            // Check if the date falls within the event range
            return date >= eventStart && date <= eventEnd;
        });
    }

    renderDayEvents(container, events, date) {
        const maxVisibleEvents = 3;
        
        events.slice(0, maxVisibleEvents).forEach(event => {
            const eventElement = this.createEventElement(event, date);
            container.appendChild(eventElement);
        });

        // Show "more" indicator if there are additional events
        if (events.length > maxVisibleEvents) {
            const moreElement = document.createElement('div');
            moreElement.className = 'event-more';
            moreElement.textContent = `+${events.length - maxVisibleEvents} more`;
            moreElement.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAllEventsForDay(date, events);
            });
            container.appendChild(moreElement);
        }
    }

    createEventElement(event, currentDate) {
        const eventElement = document.createElement('div');
        eventElement.className = 'calendar-event';
        
        // Determine event position (start, middle, end, single)
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        
        const isStart = currentDate.getTime() === eventStart.getTime();
        const isEnd = currentDate.getTime() === eventEnd.getTime();
        const isSingle = eventStart.getTime() === eventEnd.getTime();
        
        if (isSingle) {
            eventElement.classList.add('event-single');
        } else if (isStart) {
            eventElement.classList.add('event-start');
        } else if (isEnd) {
            eventElement.classList.add('event-end');
        } else {
            eventElement.classList.add('event-middle');
        }

        // Show title on all days of the event for multi-day events
        if (isSingle) {
            // Single day event - show full title
            eventElement.textContent = event.title;
        } else {
            // Multi-day event - show title on all days
            eventElement.textContent = event.title;
            
            // For middle days, you might want to truncate or show a shorter version
            // but per your request, we'll show the full quote name on all days
            if (!isStart && !isEnd) {
                // This is a middle day - could add visual indicator if needed
                eventElement.classList.add('event-continuing');
            }
        }

        // Add click handler for tooltip
        eventElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEventTooltip(event, e.target);
        });

        return eventElement;
    }

    renderSpanningEvents() {
        // Get unique events (no duplicates)
        const uniqueEvents = [];
        const seenEventIds = new Set();
        
        this.events.forEach(event => {
            if (!seenEventIds.has(event.id)) {
                uniqueEvents.push(event);
                seenEventIds.add(event.id);
            }
        });

        // Organize events by week rows for proper stacking
        const weekRows = this.getWeekRows();
        const eventsByWeek = this.organizeEventsByWeek(uniqueEvents, weekRows);

        // Render events with absolute positioning
        eventsByWeek.forEach((weekEvents, weekIndex) => {
            this.renderWeekEvents(weekEvents, weekIndex);
        });
    }

    getWeekRows() {
        const weeks = [];
        for (let i = 0; i < this.calendarDates.length; i += 7) {
            weeks.push(this.calendarDates.slice(i, i + 7));
        }
        return weeks;
    }

    organizeEventsByWeek(events, weekRows) {
        const eventsByWeek = weekRows.map(() => []);

        events.forEach(event => {
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);

            // Find which weeks this event touches
            weekRows.forEach((week, weekIndex) => {
                const weekStart = week[0];
                const weekEnd = week[6];

                // Check if event overlaps with this week
                if (eventStart <= weekEnd && eventEnd >= weekStart) {
                    eventsByWeek[weekIndex].push(event);
                }
            });
        });

        return eventsByWeek;
    }

    renderWeekEvents(events, weekIndex) {
        const grid = document.getElementById('calendarGrid');
        const weekStartIndex = weekIndex * 7;

        events.forEach((event, eventIndex) => {
            const eventElement = this.createSpanningEventElement(event, weekIndex, eventIndex);
            grid.appendChild(eventElement);
        });
    }

    createSpanningEventElement(event, weekIndex, eventIndex) {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        const weekStartIndex = weekIndex * 7;
        
        // Calculate which days in this week the event spans
        let startDayInWeek = 0;
        let endDayInWeek = 6;
        
        // Find start position within the week
        const weekDates = this.calendarDates.slice(weekStartIndex, weekStartIndex + 7);
        const startIndex = weekDates.findIndex(date => date >= eventStart);
        const endIndex = weekDates.findIndex(date => date > eventEnd);
        
        if (startIndex !== -1) startDayInWeek = startIndex;
        if (endIndex !== -1) endDayInWeek = endIndex - 1;
        else {
            // Event extends beyond this week
            const lastDateInWeek = weekDates[6];
            if (eventEnd >= lastDateInWeek) endDayInWeek = 6;
        }

        // Create the spanning event element
        const eventElement = document.createElement('div');
        eventElement.className = 'spanning-event';
        eventElement.textContent = event.title;
        
        // Position absolutely to span across days
        const leftPercent = (startDayInWeek / 7) * 100;
        const widthPercent = ((endDayInWeek - startDayInWeek + 1) / 7) * 100;
        const gridRowHeight = 121; // 120px min-height + 1px gap
        const dayNumberHeight = 25; // Space for day number at top
        const topOffset = dayNumberHeight + 5 + (eventIndex * 20); // Stack events below day numbers
        
        eventElement.style.position = 'absolute';
        eventElement.style.left = `calc(${leftPercent}% + ${startDayInWeek}px)`;
        eventElement.style.width = `calc(${widthPercent}% - ${endDayInWeek - startDayInWeek}px)`;
        eventElement.style.top = `${weekIndex * gridRowHeight + topOffset}px`;
        eventElement.style.height = '16px';
        eventElement.style.backgroundColor = '#4f46e5';
        eventElement.style.color = 'white';
        eventElement.style.borderRadius = '3px';
        eventElement.style.padding = '2px 6px';
        eventElement.style.fontSize = '0.75rem';
        eventElement.style.fontWeight = '500';
        eventElement.style.cursor = 'pointer';
        eventElement.style.zIndex = '10';
        eventElement.style.overflow = 'hidden';
        eventElement.style.textOverflow = 'ellipsis';
        eventElement.style.whiteSpace = 'nowrap';
        eventElement.style.boxSizing = 'border-box';

        // Add click handler
        eventElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEventTooltip(event, e.target);
        });

        return eventElement;
    }

    showEventTooltip(event, targetElement) {
        this.hideTooltip(); // Hide any existing tooltip
        
        this.currentEventData = event;
        const tooltip = document.getElementById('eventTooltip');
        
        // Populate tooltip content
        document.getElementById('tooltipTitle').textContent = event.title;
        document.getElementById('tooltipClient').textContent = event.extendedProps.clientName || 'No client specified';
        document.getElementById('tooltipTotal').textContent = this.formatCurrency(event.extendedProps.total);
        document.getElementById('tooltipServices').textContent = event.extendedProps.totalServices;
        document.getElementById('tooltipDays').textContent = event.extendedProps.dayCount;

        // Position tooltip
        const rect = targetElement.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.bottom + 10;
        
        // Adjust position if tooltip goes off screen
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top + tooltipRect.height > window.innerHeight - 10) {
            top = rect.top - tooltipRect.height - 10;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.display = 'block';
        
        this.currentTooltip = tooltip;
    }

    hideTooltip() {
        if (this.currentTooltip) {
            this.currentTooltip.style.display = 'none';
            this.currentTooltip = null;
            this.currentEventData = null;
        }
    }

    showAllEventsForDay(date, events) {
        // Create a simple modal or expanded view showing all events for the day
        const eventsList = events.map(event => 
            `<div class="day-event-item">
                <strong>${event.title}</strong>
                ${event.extendedProps.clientName ? `<br>Client: ${event.extendedProps.clientName}` : ''}
                <br>Total: ${this.formatCurrency(event.extendedProps.total)}
            </div>`
        ).join('');

        const dateStr = date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });

        this.showAlert(`
            <h3>Events for ${dateStr}</h3>
            <div class="events-list">${eventsList}</div>
        `, 'info');
    }

    async loadQuote(quoteName) {
        try {
            this.showLoading(true);
            
            // Navigate to main page with quote loaded
            const response = await fetch(`/api/load-quote/${encodeURIComponent(quoteName)}`);
            if (!response.ok) {
                throw new Error('Failed to load quote');
            }
            
            const quoteData = await response.json();
            
            // Store quote data in session storage for the main page to load
            sessionStorage.setItem('loadQuoteData', JSON.stringify(quoteData));
            
            // Navigate to main page
            window.location.href = '/';
            
        } catch (error) {
            console.error('Error loading quote:', error);
            this.showAlert('Failed to load quote. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // Utility functions
    formatDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    formatCurrency(amount) {
        if (typeof amount !== 'number') return '$0';
        
        const hasDecimals = amount % 1 !== 0;
        return amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: hasDecimals ? 2 : 0,
            maximumFractionDigits: 2
        });
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.display = show ? 'flex' : 'none';
    }

    showAlert(message, type = 'info') {
        const modal = document.getElementById('alertModal');
        const title = document.getElementById('alertModalTitle');
        const content = document.getElementById('alertModalMessage');
        const icon = document.getElementById('alertModalIcon');

        title.textContent = type === 'error' ? 'Error' : 'Information';
        content.innerHTML = message;
        
        // Set icon based on type
        if (type === 'error') {
            icon.textContent = '❌';
            icon.style.color = '#dc2626';
        } else {
            icon.textContent = 'ℹ️';
            icon.style.color = '#2563eb';
        }

        modal.style.display = 'flex';
    }
}

// Modal functions (reused from main app)
function hideAlertModal() {
    document.getElementById('alertModal').style.display = 'none';
}

// Logout function (reused from main app)
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            window.location.href = '/login';
        } else {
            alert('Logout failed. Please try again.');
        }
    } catch (error) {
        console.error('Logout error:', error);
        alert('Logout failed. Please try again.');
    }
}

// Initialize calendar when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.calendar = new CalendarView();
});

// Add custom CSS for events list in alert modal
const style = document.createElement('style');
style.textContent = `
    .events-list {
        margin-top: 16px;
        max-height: 300px;
        overflow-y: auto;
    }
    
    .day-event-item {
        padding: 12px;
        margin-bottom: 8px;
        background: #f8fafc;
        border-radius: 6px;
        border-left: 4px solid #4f46e5;
    }
    
    .day-event-item:last-child {
        margin-bottom: 0;
    }
`;
document.head.appendChild(style);
