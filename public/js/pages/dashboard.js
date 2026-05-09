import { t } from '../i18n.js';
import { getTrip, getItinerary } from '../db.js';
import { subscribeItinerary } from '../db.js';
import { getExpenses } from '../db.js';
import { getAccommodation } from '../db.js';
import { getActivities } from '../db.js';
import { getTripWeather, getWeather, geocodeCity } from '../weather.js';
import { formatConverted, getCurrency, getCurrencyMeta, ensureRates } from '../currency.js';
import { calcMileage } from '../mileage.js';
import { navigate } from '../app.js';

let _unsubItinerary = null;

export function destroy() {
  if (_unsubItinerary) { _unsubItinerary(); _unsubItinerary = null; }
}

export async function render(container, { userId, tripId }) {
  if (!tripId) {
    container.innerHTML = `
      <div class="empty-state" style="padding-top:80px">
        <div class="empty-icon">✈️</div>
        <div class="empty-title">${t('dash.no_trip')}</div>
        <div class="empty-sub">${t('dash.create_trip')}</div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    const [trip, expenses, accommodation, activities, itinerary] = await Promise.all([
      getTrip(userId, tripId),
      getExpenses(userId, tripId),
      getAccommodation(userId, tripId),
      getActivities(userId, tripId),
      getItinerary(userId, tripId),
    ]);

    if (!trip) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">❓</div><div class="empty-title">Trip not found</div></div>`;
      return;
    }

    await ensureRates();

    const today = new Date().toISOString().slice(0, 10);

    // Compute total expenses
    let totalKRW = 0;
    for (const e of expenses) {
      const { convert } = await import('../currency.js');
      totalKRW += await convert(e.amount || 0, e.currency || 'KRW', 'KRW');
    }
    const totalFormatted = await formatConverted(totalKRW, 'KRW');

    // Trip duration
    let daysLeft = '';
    if (trip.startDate && trip.endDate) {
      const start = new Date(trip.startDate);
      const end = new Date(trip.endDate);
      const now = new Date();
      const totalDays = Math.round((end - start) / 86400000) + 1;
      if (now < start) {
        const countdown = Math.round((start - now) / 86400000);
        daysLeft = `Starts in ${countdown} day${countdown !== 1 ? 's' : ''}`;
      } else if (now <= end) {
        const elapsed = Math.round((now - start) / 86400000) + 1;
        daysLeft = `Day ${elapsed} of ${totalDays}`;
      } else {
        daysLeft = `${totalDays} days · Completed`;
      }
    }

    const completedActs = activities.filter(a => a.completed).length;

    // Mileage
    const mileageKm = await calcMileage(itinerary);

    container.innerHTML = `
      <div class="page" style="padding-bottom:24px">
        <!-- Trip header -->
        <div style="margin-bottom:20px;padding-top:4px">
          <div class="eyebrow" style="margin-bottom:4px">${daysLeft}</div>
          <div class="page-title">${trip.name || 'My Trip'}</div>
          ${trip.destination ? `<div class="text-sm text-muted" style="margin-top:2px">📍 ${trip.destination}</div>` : ''}
          ${trip.startDate && trip.endDate ? `<div class="text-xs text-muted" style="margin-top:2px">${trip.startDate} → ${trip.endDate}</div>` : ''}
        </div>

        <!-- Quick stats -->
        <div class="stat-grid" style="margin-bottom:16px">
          <div class="stat-card">
            <div class="stat-value mono">${totalFormatted}</div>
            <div class="stat-label">${t('exp.total')}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${activities.length}</div>
            <div class="stat-label">${t('act.title')}</div>
            <div class="stat-sub">${completedActs} ${t('dash.completed').toLowerCase()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${accommodation.length}</div>
            <div class="stat-label">${t('dash.stays')}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${mileageKm} km</div>
            <div class="stat-label">${t('dash.mileage')}</div>
          </div>
        </div>

        <!-- Weather -->
        <div id="weather-section" style="margin-bottom:16px">
          <div class="card">
            <div class="card-header">
              <span class="eyebrow">${t('dash.weather')}</span>
              ${trip.destination ? `<span class="text-xs text-muted">${trip.destination}</span>` : ''}
            </div>
            <div class="card-body" id="weather-body">
              <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
            </div>
          </div>
        </div>

        <!-- Upcoming itinerary -->
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <span class="eyebrow">${t('dash.upcoming')}</span>
            <button class="btn btn-ghost btn-sm" onclick="window.__navigate('itinerary')">${t('dash.view_all')}</button>
          </div>
          <div id="upcoming-body">
            <div class="loading-center" style="padding:16px"><div class="spinner" style="width:20px;height:20px;border-width:2px"></div></div>
          </div>
        </div>

        <!-- Recent expenses -->
        <div class="card">
          <div class="card-header">
            <span class="eyebrow">${t('dash.recent_exp')}</span>
            <button class="btn btn-ghost btn-sm" onclick="window.__navigate('expenses')">${t('dash.view_all')}</button>
          </div>
          <div id="expenses-body">
            ${renderRecentExpenses(expenses.slice(0, 4))}
          </div>
        </div>
      </div>`;

    window.__navigate = navigate;

    // Load weather async
    loadWeather(trip);

    // Subscribe to itinerary for upcoming section
    if (_unsubItinerary) _unsubItinerary();
    _unsubItinerary = subscribeItinerary(userId, tripId, (items) => {
      const upcomingEl = document.getElementById('upcoming-body');
      if (upcomingEl) {
        const upcoming = items.filter(i => i.date >= today).slice(0, 5);
        upcomingEl.innerHTML = renderUpcoming(upcoming);
      }
    });

  } catch (e) {
    console.error('Dashboard render:', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error loading dashboard</div><div class="empty-sub">${e.message}</div></div>`;
  }
}

async function loadWeather(trip) {
  const weatherEl = document.getElementById('weather-body');
  if (!weatherEl) return;

  try {
    let lat = trip.destLat, lng = trip.destLng;
    if ((!lat || !lng) && trip.destination) {
      const geo = await geocodeCity(trip.destination);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }
    if (!lat || !lng) {
      weatherEl.innerHTML = `<div class="text-sm text-muted">Set a destination to see weather</div>`;
      return;
    }

    // Use trip-date-ranged weather if dates set, otherwise 7-day forecast
    let days;
    if (trip.startDate && trip.endDate) {
      days = await getTripWeather(lat, lng, trip.startDate, trip.endDate);
    } else {
      const weather = await getWeather(lat, lng);
      days = weather?.days || null;
    }

    if (!days || days.length === 0) {
      weatherEl.innerHTML = `<div class="text-sm text-muted">Weather unavailable</div>`;
      return;
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayStr = new Date().toISOString().slice(0, 10);

    weatherEl.innerHTML = `
      <div class="weather-widget">
        ${days.slice(0, 7).map((day) => {
          const d = new Date(day.date);
          const label = day.date === todayStr ? 'Today' : dayNames[d.getDay()];
          return `
            <div class="weather-day ${day.date === todayStr ? 'today' : ''}">
              <div class="weather-day-label">${label}</div>
              <div class="weather-icon">${day.icon}</div>
              <div class="weather-temp">${day.maxTemp}°</div>
              <div class="text-xs" style="color:var(--muted-2)">${day.minTemp}°</div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    const el = document.getElementById('weather-body');
    if (el) el.innerHTML = `<div class="text-sm text-muted">Weather unavailable</div>`;
  }
}

function renderUpcoming(items) {
  if (items.length === 0) {
    return `<div class="empty-state" style="padding:20px 16px">
      <div class="empty-sub">${t('dash.no_events')}</div>
    </div>`;
  }
  const typeIcons = { travel: '✈️', meal: '🍽️', activity: '⚡', rest: '🏨', other: '📌' };
  return items.map(item => `
    <div class="list-item">
      <div class="list-icon" style="background:var(--surface-2)">${typeIcons[item.type] || '📌'}</div>
      <div class="list-content">
        <div class="list-title">${item.title || '—'}</div>
        <div class="list-sub">${item.date}${item.time ? ' · ' + item.time : ''}${item.location ? ' · ' + item.location : ''}</div>
      </div>
    </div>`).join('');
}

function renderRecentExpenses(expenses) {
  if (expenses.length === 0) {
    return `<div class="empty-state" style="padding:20px 16px"><div class="empty-sub">${t('dash.no_expenses')}</div></div>`;
  }
  const catIcons = { transport: '🚗', food: '🍔', accom: '🏨', activity: '⚡', shopping: '🛍️', other: '💳' };
  return expenses.map(e => {
    const meta = getCurrencyMeta(e.currency || 'KRW');
    const amtStr = e.amount ? `${meta.symbol}${Number(e.amount).toLocaleString()}` : '—';
    return `
    <div class="list-item">
      <div class="list-icon" style="background:var(--surface-2)">${catIcons[e.category] || '💳'}</div>
      <div class="list-content">
        <div class="list-title">${e.title || e.name || '—'}</div>
        <div class="list-sub">${e.date || ''}</div>
      </div>
      <div class="list-meta">
        <div class="mono text-sm text-accent">${amtStr}</div>
      </div>
    </div>`;
  }).join('');
}
