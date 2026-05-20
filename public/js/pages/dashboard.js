import { t, getLang } from '../i18n.js';
import { getTrip, getItinerary } from '../db.js';
import { subscribeItinerary } from '../db.js';
import { getExpenses } from '../db.js';
import { getBookings } from '../db.js';
import { getActivities } from '../db.js';
import { getTripWeather, getWeather, geocodeCity } from '../weather.js';
import { formatConverted, getCurrency, getCurrencyMeta, ensureRates } from '../currency.js';
import { calcMileageDetail } from '../mileage.js';
import { navigate, openModal, closeModal } from '../app.js';

let _unsubItinerary = null;
let _mileageDetail = { total: 0, segments: [] };
let _mileageKey = '';

export function destroy() {
  if (_unsubItinerary) { _unsubItinerary(); _unsubItinerary = null; }
  _mileageKey = '';
}

function _itin2key(items) {
  return items.map(i => `${i.id}|${i.location || ''}`).join(',');
}

export async function render(container, { userId, tripId, isGuest }) {
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
    const [trip, expenses, bookings, activities, itinerary] = await Promise.all([
      getTrip(userId, tripId),
      getExpenses(userId, tripId),
      getBookings(userId, tripId),
      getActivities(userId, tripId),
      getItinerary(userId, tripId),
    ]);
    const accomBookings = bookings.filter(b => !b.category || b.category === 'accommodation');

    if (!trip) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">❓</div><div class="empty-title">Trip not found</div></div>`;
      return;
    }

    await ensureRates();

    const today = new Date().toISOString().slice(0, 10);

    // Compute total expenses converted to trip base currency
    const baseCurrency = trip.baseCurrency || 'KRW';
    const { convert } = await import('../currency.js');
    let totalBase = 0;
    for (const e of expenses) {
      const amt = parseFloat(e.amount) || 0;
      totalBase += await convert(amt, e.currency || baseCurrency, baseCurrency);
    }
    const totalFormatted = await formatConverted(totalBase, baseCurrency);

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
        daysLeft = `${totalDays} days · ${t('common.completed').toLowerCase()}`;
      }
    }

    const completedActs = activities.filter(a => a.completed).length;
    const candidateStays = accomBookings.filter(a => a.status === 'candidate').length;
    const bookedStays = accomBookings.length - candidateStays;

    const travelers = trip.travelers || [];
    const travelerCount = travelers.length;
    const adults = travelers.filter(tr => parseInt(tr.age || 0) >= 20).length;
    const kids = travelerCount - adults;
    const isKo = getLang() === 'ko';
    const staysSub = [
      candidateStays > 0 ? `🔖${candidateStays}` : '',
      bookedStays > 0 ? `✅${bookedStays}` : ''
    ].filter(Boolean).join(' · ');
    const staysCardHTML = travelerCount > 0
      ? `<div class="stat-card" style="cursor:pointer" onclick="window.__navigate('booking')">
            <div class="stat-value mono">${travelerCount}</div>
            <div class="stat-label">${isKo ? '인원수' : 'TRAVELERS'}</div>
            <div class="stat-sub">${adults} ${isKo ? '성인' : 'Adults'} · ${kids} ${isKo ? '어린이' : 'Kids'}</div>
          </div>`
      : `<div class="stat-card" style="cursor:pointer" onclick="window.__navigate('booking')">
            <div class="stat-value mono">${accomBookings.length}</div>
            <div class="stat-label">${t('dash.stays')}</div>
            <div class="stat-sub">${staysSub}</div>
          </div>`;

    // Mileage
    _mileageKey = _itin2key(itinerary);
    _mileageDetail = await calcMileageDetail(itinerary);
    const mileageKm = _mileageDetail.total;
    const mileageTravelKm = _mileageDetail.travelTotal || 0;
    const mileageDriveKm = _mileageDetail.driveTotal || 0;

    container.innerHTML = `
      <div class="page" style="padding-bottom:24px">
        <!-- Trip header -->
        <div style="margin-bottom:20px;padding-top:4px">
          ${isGuest ? `<div class="eyebrow" style="margin-bottom:4px;color:var(--muted)">👁 Guest View</div>` : ''}
          <div class="eyebrow" style="margin-bottom:4px">${daysLeft}</div>
          <div class="page-title">${trip.name || 'My Trip'}</div>
          ${trip.destination ? `<div class="text-sm text-muted" style="margin-top:2px">📍 ${trip.destination}</div>` : ''}
          ${trip.startDate && trip.endDate ? `<div class="text-xs text-muted" style="margin-top:2px">${trip.startDate} → ${trip.endDate}</div>` : ''}
        </div>

        ${trip.imageUrl ? `<div style="margin:0 0 16px;border-radius:12px;overflow:hidden"><img src="${trip.imageUrl}" alt="" style="width:100%;height:160px;object-fit:cover;display:block"></div>` : ''}

        <!-- Quick stats -->
        <div class="stat-grid" style="margin-bottom:16px">
          <div class="stat-card" style="cursor:pointer" onclick="window.__navigate('expenses')">
            <div class="stat-value mono">${totalFormatted}</div>
            <div class="stat-label">${t('exp.total')}</div>
          </div>
          <div class="stat-card" style="cursor:pointer" onclick="window.__navigate('activities')">
            <div class="stat-value mono">${activities.length}</div>
            <div class="stat-label">${t('act.title')}</div>
            <div class="stat-sub">${completedActs} ${t('dash.completed').toLowerCase()}</div>
          </div>
          ${staysCardHTML}
          <div class="stat-card" style="cursor:pointer" onclick="window.__showMileageDetail()">
            <div class="stat-value mono" id="mileage-stat-value">${mileageKm} km</div>
            <div class="stat-label">${t('dash.mileage')}</div>
            <div class="stat-sub" id="mileage-stat-sub">${mileageTravelKm > 0 ? `✈️ ${mileageTravelKm} · ` : ''}${mileageDriveKm > 0 ? `🚗 ${mileageDriveKm}` : ''}</div>
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
        <div class="card">
          <div class="card-header">
            <span class="eyebrow">${t('dash.upcoming')}</span>
            <button class="btn btn-ghost btn-sm" onclick="window.__navigate('itinerary')">${t('dash.view_all')}</button>
          </div>
          <div id="upcoming-body">
            <div class="loading-center" style="padding:16px"><div class="spinner" style="width:20px;height:20px;border-width:2px"></div></div>
          </div>
        </div>
      </div>`;

    window.__navigate = navigate;

    window.__showMileageDetail = () => {
      const { total, segments } = _mileageDetail;
      if (segments.length === 0) {
        openModal({
          title: t('dash.mileage_detail'),
          body: `<div class="text-sm text-muted" style="padding:8px 0">Add locations to itinerary events to calculate route distance.</div>`,
          footer: `<button class="btn btn-ghost btn-full" onclick="window.__closeModal()">${t('common.done')}</button>`
        });
        return;
      }
      const failedCount = segments.filter(s => s.geocodeFailed).length;
      const rows = segments.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)">
          <div style="flex:1;min-width:0;overflow:hidden">
            <div class="text-xs text-muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.from}</div>
            <div style="font-size:11px;color:var(--muted-2);margin:2px 0">${s.segmentType === 'travel' ? '✈️' : '🚗'} ↓</div>
            <div class="text-xs" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.to}</div>
          </div>
          <div style="margin-left:12px;flex-shrink:0;text-align:right">
            ${s.geocodeFailed
              ? `<div class="text-xs" style="color:var(--rose)">⚠️ 주소 미인식</div>`
              : `<div class="mono text-sm" style="color:var(--accent)">${s.km} km</div>`}
          </div>
        </div>`).join('');
      openModal({
        title: t('dash.mileage_detail'),
        body: `${rows}
          <div style="display:flex;justify-content:space-between;padding:12px 0 4px">
            <div class="text-sm" style="font-weight:600">Total</div>
            <div class="mono text-sm" style="color:var(--accent);font-weight:600">${total} km</div>
          </div>
          ${failedCount > 0 ? `<div class="text-xs text-muted" style="padding-top:8px">⚠️ ${failedCount}개 구간 주소 미인식 — 이티너리 항목을 열어 다시 저장하면 해결됩니다.</div>` : ''}`,
        footer: `<button class="btn btn-ghost btn-full" onclick="window.__closeModal()">${t('common.done')}</button>`
      });
    };

    // Load weather async
    loadWeather(trip);

    // Subscribe to itinerary for upcoming section + live mileage
    if (_unsubItinerary) _unsubItinerary();
    _unsubItinerary = subscribeItinerary(userId, tripId, async (items) => {
      const upcomingEl = document.getElementById('upcoming-body');
      if (upcomingEl) {
        const upcoming = items.filter(i => i.date >= today).slice(0, 5);
        upcomingEl.innerHTML = renderUpcoming(upcoming);
      }
      const newKey = _itin2key(items);
      if (newKey !== _mileageKey) {
        _mileageKey = newKey;
        _mileageDetail = await calcMileageDetail(items);
      }
      const mileageEl = document.getElementById('mileage-stat-value');
      if (mileageEl) mileageEl.textContent = `${_mileageDetail.total} km`;
      const mileageSubEl = document.getElementById('mileage-stat-sub');
      if (mileageSubEl) {
        const tv = _mileageDetail.travelTotal || 0, dv = _mileageDetail.driveTotal || 0;
        mileageSubEl.textContent = `${tv > 0 ? `✈️ ${tv} · ` : ''}${dv > 0 ? `🚗 ${dv}` : ''}`;
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
      // Clear stale cache entry so geocoding retries with updated logic
      const cacheKey = `geo_${trip.destination.toLowerCase().replace(/\s+/g, '_')}`;
      const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
      if (!cached.lat) localStorage.removeItem(cacheKey);
      const geo = await geocodeCity(trip.destination, trip.country || '');
      if (geo) { lat = geo.lat; lng = geo.lng; }
    }
    if (!lat || !lng) {
      weatherEl.innerHTML = `<div class="text-sm text-muted">Set a destination to see weather</div>`;
      return;
    }

    // Use trip-date-ranged weather if dates set, otherwise 7-day forecast
    let days;
    let isFallback = false;
    const today = new Date().toISOString().slice(0, 10);
    const forecastLimit = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);

    if (trip.startDate && trip.endDate) {
      // Trip is within forecast/archive range — use date-ranged weather
      if (trip.startDate <= forecastLimit || trip.endDate < today) {
        days = await getTripWeather(lat, lng, trip.startDate, trip.endDate);
      }
      // Trip is too far in future (>16 days out) — fall back to current 7-day as reference
      if (!days || days.length === 0) {
        const weather = await getWeather(lat, lng);
        days = weather?.days || null;
        isFallback = true;
      }
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
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const precipStr = day.precip !== null && day.precip !== undefined
            ? (day.precipIsProb ? Math.round(day.precip) + '%' : Math.round(day.precip) + 'mm')
            : '';
          return `
            <div class="weather-day ${day.date === todayStr ? 'today' : ''}">
              <div class="weather-day-label">${label}</div>
              <div class="weather-day-date">${mm}/${dd}</div>
              <div class="weather-icon">${day.icon}</div>
              <div class="weather-temp">${day.maxTemp}°</div>
              <div class="text-xs" style="color:var(--muted-2)">${day.minTemp}°</div>
              ${precipStr ? `<div class="text-xs" style="color:var(--sky)">💧${precipStr}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
      ${isFallback ? `<div class="text-xs text-muted" style="margin-top:8px;text-align:center">${t('dash.weather_ref')}</div>` : ''}`;
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
  const typeIcons = { travel: '✈️', meal: '🍽️', activity: '⚡', rest: '🏨', shopping: '🛍️', home: '🏠', other: '📌' };
  return items.map(item => `
    <div class="list-item">
      <div class="list-icon" style="background:var(--surface-2)">${typeIcons[item.type] || '📌'}</div>
      <div class="list-content">
        <div class="list-title">${item.title || '—'}</div>
        <div class="list-sub">${item.date}${item.time ? ' · ' + item.time : ''}${item.location ? ' · ' + item.location : ''}</div>
      </div>
    </div>`).join('');
}

