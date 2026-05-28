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
        this.boundRepositionSpanningEvents = () => this.repositionSpanningEvents();
        window.addEventListener('resize', this.boundRepositionSpanningEvents);

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
            if (e.target.classList.contains('tooltip-close')) {
                this.hideTooltip();
            }
        });

        // Open quote button
        document.getElementById('openQuoteBtn').addEventListener('click', () => {
            if (this.currentEventData) {
                this.loadQuote(this.currentEventData.extendedProps.quoteName);
            }
        });

        // Toggle booked button
        document.getElementById('toggleBookedBtn').addEventListener('click', () => {
            if (this.currentEventData) {
                this.toggleBookedStatus(this.currentEventData);
            }
        });

        // Toggle archive button
        document.getElementById('toggleArchiveBtn').addEventListener('click', () => {
            if (this.currentEventData) {
                this.toggleArchiveStatus(this.currentEventData);
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

    async loadEvents(options = {}) {
        const { silent = false } = options;

        try {
            if (!silent) {
                this.showLoading(true);
            }
            
            const response = await fetch('/api/calendar-events');
            if (!response.ok) {
                throw new Error('Failed to load calendar events');
            }
            
            this.events = await response.json();
            this.updateEmptyBanner();
            
        } catch (error) {
            console.error('Error loading events:', error);
            this.showAlert('Failed to load calendar events. Please try again.', 'error');
        } finally {
            if (!silent) {
                this.showLoading(false);
            }
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
        requestAnimationFrame(() => this.repositionSpanningEvents());
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

    applyEventStyles(eventElement, event) {
        const isBooked = event.extendedProps?.booked || false;
        eventElement.classList.add('calendar-event');
        if (isBooked) {
            eventElement.classList.add('calendar-event--booked');
        }
    }

    updateEmptyBanner() {
        const banner = document.getElementById('calendarEmptyBanner');
        if (!banner) return;

        if (!this.events || this.events.length === 0) {
            banner.style.display = 'block';
            banner.textContent = 'No scheduled quote events yet. Add service dates on a quote to see events on the calendar.';
        } else {
            banner.style.display = 'none';
            banner.textContent = '';
        }
    }

    renderCalendarSkeleton() {
        const skeleton = document.getElementById('calendarSkeleton');
        if (!skeleton) return;

        skeleton.innerHTML = Array.from({ length: 42 }, () => `
            <div class="calendar-skeleton-cell">
                <div class="skeleton-block skeleton-block--short"></div>
                <div class="skeleton-block skeleton-block--line"></div>
                <div class="skeleton-block skeleton-block--line"></div>
            </div>
        `).join('');
    }

    createEventElement(event, currentDate) {
        const eventElement = document.createElement('div');
        this.applyEventStyles(eventElement, event);
        
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
        const frame = document.getElementById('calendarFrame');
        frame?.querySelectorAll('.calendar-event--spanning').forEach((el) => el.remove());

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
            const eventStart = this.parseLocalDate(event.start);
            const eventEnd = this.parseLocalDate(event.end);

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
        const frame = document.getElementById('calendarFrame');
        if (!frame) return;

        const eventLayers = this.createEventLayers(events, weekIndex);

        eventLayers.forEach((layer, layerIndex) => {
            layer.forEach(event => {
                const eventElement = this.createSpanningEventElement(event, weekIndex, layerIndex);
                frame.appendChild(eventElement);
            });
        });
    }

    createEventLayers(events, weekIndex) {
        const weekStartIndex = weekIndex * 7;
        const weekDates = this.calendarDates.slice(weekStartIndex, weekStartIndex + 7);
        const layers = [];
        
        events.forEach(event => {
            const eventStart = this.parseLocalDate(event.start);
            const eventEnd = this.parseLocalDate(event.end);
            
            // Find the first layer where this event doesn't conflict
            let placed = false;
            for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
                const layer = layers[layerIndex];
                let conflicts = false;
                
                // Check if this event conflicts with any event in this layer
                for (const layerEvent of layer) {
                    const layerStart = this.parseLocalDate(layerEvent.start);
                    const layerEnd = this.parseLocalDate(layerEvent.end);
                    
                    // Check if events overlap in time within this week
                    if (this.datesOverlap(eventStart, eventEnd, layerStart, layerEnd, weekDates)) {
                        conflicts = true;
                        break;
                    }
                }
                
                if (!conflicts) {
                    layer.push(event);
                    placed = true;
                    break;
                }
            }
            
            // If no existing layer works, create a new one
            if (!placed) {
                layers.push([event]);
            }
        });
        
        return layers;
    }

    parseLocalDate(dateString) {
        // Parse date as local date without timezone conversion
        // Format expected: "YYYY-MM-DD"
        const parts = dateString.split('-');
        if (parts.length === 3) {
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
        // Fallback to regular parsing if format is different
        return new Date(dateString);
    }

    datesOverlap(start1, end1, start2, end2, weekDates) {
        // Normalize all dates to just date (no time)
        const normalizeDate = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
        
        const weekStart = normalizeDate(weekDates[0]);
        const weekEnd = normalizeDate(weekDates[6]);
        
        const normStart1 = normalizeDate(start1);
        const normEnd1 = normalizeDate(end1);
        const normStart2 = normalizeDate(start2);
        const normEnd2 = normalizeDate(end2);
        
        // Clamp dates to this week's boundaries
        const clampedStart1 = normStart1 < weekStart ? weekStart : normStart1;
        const clampedEnd1 = normEnd1 > weekEnd ? weekEnd : normEnd1;
        const clampedStart2 = normStart2 < weekStart ? weekStart : normStart2;
        const clampedEnd2 = normEnd2 > weekEnd ? weekEnd : normEnd2;
        
        // Check if the clamped ranges overlap
        return clampedStart1 <= clampedEnd2 && clampedStart2 <= clampedEnd1;
    }

    getSpanningDayIndices(event, weekDates) {
        const eventStart = this.parseLocalDate(event.start);
        const eventEnd = this.parseLocalDate(event.end);
        const eventStartDate = new Date(eventStart.getFullYear(), eventStart.getMonth(), eventStart.getDate());
        const eventEndDate = new Date(eventEnd.getFullYear(), eventEnd.getMonth(), eventEnd.getDate());

        let startDayIndex = -1;
        let endDayIndex = -1;

        for (let i = 0; i < 7; i++) {
            const dayDate = new Date(weekDates[i].getFullYear(), weekDates[i].getMonth(), weekDates[i].getDate());
            if (dayDate >= eventStartDate && dayDate <= eventEndDate) {
                if (startDayIndex === -1) {
                    startDayIndex = i;
                }
                endDayIndex = i;
            }
        }

        if (startDayIndex === -1) startDayIndex = 0;
        if (endDayIndex === -1) endDayIndex = 6;

        return { startDayIndex, endDayIndex };
    }

    createSpanningEventElement(event, weekIndex, layerIndex) {
        const weekStartIndex = weekIndex * 7;
        const weekDates = this.calendarDates.slice(weekStartIndex, weekStartIndex + 7);
        const { startDayIndex, endDayIndex } = this.getSpanningDayIndices(event, weekDates);

        const eventElement = document.createElement('div');
        this.applyEventStyles(eventElement, event);
        eventElement.classList.add('calendar-event--spanning');
        eventElement.textContent = event.title;
        eventElement.dataset.spanning = 'true';
        eventElement.dataset.weekIndex = String(weekIndex);
        eventElement.dataset.startDay = String(startDayIndex);
        eventElement.dataset.endDay = String(endDayIndex);
        eventElement.dataset.layerIndex = String(layerIndex);

        eventElement.style.position = 'absolute';
        eventElement.style.color = 'white';
        eventElement.style.padding = '2px 6px';
        eventElement.style.fontWeight = '500';
        eventElement.style.cursor = 'pointer';
        eventElement.style.zIndex = '10';
        eventElement.style.boxSizing = 'border-box';
        eventElement.style.overflow = 'hidden';
        eventElement.style.textOverflow = 'ellipsis';
        eventElement.style.whiteSpace = 'nowrap';
        eventElement.style.margin = '0';

        eventElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showEventTooltip(event, e.target);
        });

        return eventElement;
    }

    repositionSpanningEvents() {
        const frame = document.getElementById('calendarFrame');
        const grid = document.getElementById('calendarGrid');
        if (!frame || !grid) return;

        const days = grid.querySelectorAll('.calendar-day');
        const frameRect = frame.getBoundingClientRect();
        const eventHeight = 18;
        const eventSpacing = 2;

        frame.querySelectorAll('.calendar-event--spanning').forEach((eventElement) => {
            const weekIndex = parseInt(eventElement.dataset.weekIndex, 10);
            const startDayIndex = parseInt(eventElement.dataset.startDay, 10);
            const endDayIndex = parseInt(eventElement.dataset.endDay, 10);
            const layerIndex = parseInt(eventElement.dataset.layerIndex, 10) || 0;

            const startDayEl = days[weekIndex * 7 + startDayIndex];
            const endDayEl = days[weekIndex * 7 + endDayIndex];
            if (!startDayEl || !endDayEl) return;

            const startRect = startDayEl.getBoundingClientRect();
            const endRect = endDayEl.getBoundingClientRect();
            const dayNumberEl = startDayEl.querySelector('.day-number');
            const dayNumberBottom = dayNumberEl
                ? dayNumberEl.getBoundingClientRect().bottom - startRect.top
                : 20;
            const topOffset = dayNumberBottom + 4 + layerIndex * (eventHeight + eventSpacing);
            const inset = 2;

            eventElement.style.left = `${startRect.left - frameRect.left + inset}px`;
            eventElement.style.width = `${Math.max(0, endRect.right - startRect.left - inset * 2)}px`;
            eventElement.style.top = `${startRect.top - frameRect.top + topOffset}px`;
            eventElement.style.height = `${eventHeight}px`;
        });
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

        // Update toggle booked button text based on current status
        const isBooked = event.extendedProps.booked || false;
        const toggleBookedBtn = document.getElementById('toggleBookedBtn');
        toggleBookedBtn.textContent = isBooked ? 'Mark as Not Booked' : 'Mark as Booked';

        // Show tooltip first to get accurate dimensions
        tooltip.style.display = 'block';
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        
        // Position tooltip after it's visible
        const rect = targetElement.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.bottom + 10;
        
        // Adjust position if tooltip goes off screen
        const padding = 10;
        if (left < padding) {
            left = padding;
        }
        if (left + tooltipRect.width > window.innerWidth - padding) {
            left = window.innerWidth - tooltipRect.width - padding;
        }
        if (top + tooltipRect.height > window.innerHeight - padding) {
            top = rect.top - tooltipRect.height - 10;
        }
        if (top < padding) {
            top = padding;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        
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
            
            // Store quote data in session storage for the calculator page to load
            sessionStorage.setItem('loadQuoteData', JSON.stringify(quoteData));
            
            // Navigate to builder page
            window.location.href = '/quote';
            
        } catch (error) {
            console.error('Error loading quote:', error);
            this.showAlert('Failed to load quote. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async toggleBookedStatus(event) {
        const quoteName = event.extendedProps.quoteName;
        const currentBooked = event.extendedProps.booked || false;
        const newBookedStatus = !currentBooked;

        try {
            this.showLoading(true);
            this.hideTooltip();

            const response = await fetch(`/api/update-quote-metadata/${encodeURIComponent(quoteName)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    newName: quoteName,
                    booked: newBookedStatus
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to update booked status');
            }

            if (newBookedStatus && window.LumDashIntegration?.onQuoteMarkedAsBooked) {
                await window.LumDashIntegration.onQuoteMarkedAsBooked(quoteName, currentBooked);
            }

            await this.loadEvents({ silent: true });
            this.renderCalendar();

            const statusText = newBookedStatus ? 'booked' : 'not booked';
            this.showAlert(`Quote "${quoteName}" marked as ${statusText}!`, 'success');

        } catch (error) {
            console.error('Error updating booked status:', error);
            this.showAlert('Failed to update booked status. Please try again.', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async toggleArchiveStatus(event) {
        const quoteName = event.extendedProps.quoteName;
        const currentArchived = event.extendedProps.archived || false;
        const newArchivedStatus = !currentArchived;

        try {
            this.showLoading(true);
            this.hideTooltip();

            const response = await fetch(`/api/archive-quote/${encodeURIComponent(quoteName)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    archived: newArchivedStatus
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to update archive status');
            }

            await this.loadEvents({ silent: true });
            this.renderCalendar();

            const statusText = newArchivedStatus ? 'archived' : 'unarchived';
            const message = newArchivedStatus 
                ? `Quote "${quoteName}" has been archived and removed from the calendar.`
                : `Quote "${quoteName}" has been unarchived and will now appear on the calendar.`;
            this.showAlert(message, 'success');

        } catch (error) {
            console.error('Error updating archive status:', error);
            this.showAlert('Failed to update archive status. Please try again.', 'error');
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
        const frame = document.getElementById('calendarFrame');
        const skeleton = document.getElementById('calendarSkeleton');
        const overlay = document.getElementById('loading-overlay');

        if (frame) {
            if (show) {
                this.renderCalendarSkeleton();
            }
            frame.classList.toggle('is-loading', show);
        }

        if (skeleton) {
            skeleton.setAttribute('aria-hidden', show ? 'false' : 'true');
        }

        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showAlert(message, type = 'info') {
        if (typeof showAlertModal === 'function') {
            showAlertModal(message, type, null, false, true);
        }
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
