import { t } from '../i18n.js';
import { getAllTripsData } from '../db.js';
import { convert, formatCurrency, getCurrency, ensureRates } from '../currency.js';
import { calcMileageDetail } from '../mileage.js';
import { openModal, closeModal } from '../app.js';

let _ctx = null;
let _tripsData = [];
let _selectedYear = 'all';
let _years = [];

const CAT_COLORS = {
  transport: '#6ea6e8', food: '#e8c87c', accom: '#5fb88c',
  activity: '#ee6c3a', shopping: '#d97a7a', other: '#7c8089'
};
const CAT_ICONS = {
  transport: '🚗', food: '🍽️', accom: '🏨',
  activity: '⚡', shopping: '🛍️', other: '💳'
};

function extractCity(loc) {
  const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || null;
  return parts[parts.length - 2];
}

export function destroy() {}

export async function render(container, ctx) {
  _ctx = ctx;
  const { userId, tripId } = ctx;

  container.innerHTML = `<div class="loading-center" style="padding:80px"><div class="spinner"></div></div>`;

  try {
    await ensureRates();
    _tripsData = await getAllTripsData(userId);

    if (_tripsData.length === 0) {
      container.innerHTML = noTripHTML();
      return;
    }

    const currentTrip = _tripsData.find(d => d.trip.id === tripId)?.trip;
    const currentTripYear = currentTrip?.startDate?.slice(0, 4) || null;

    _years = [...new Set(_tripsData.map(d => d.trip.startDate?.slice(0, 4)).filter(Boolean))].sort((a, b) => b - a);

    _selectedYear = (currentTripYear && _years.includes(currentTripYear)) ? currentTripYear : (_years[0] || 'all');

    await renderFull(container);
  } catch (e) {
    console.error('Archive render:', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error loading archive</div><div class="empty-sub">${e.message}</div></div>`;
  }
}

async function renderFull(container) {
  container.innerHTML = `
    <div style="padding:14px 16px 8px">
      <div class="eyebrow" style="margin-bottom:2px">${t('nav.archive')}</div>
      <div class="page-title">Archive</div>
    </div>
    <div class="chip-row" id="arch-tabs">
      <div class="chip ${_selectedYear === 'all' ? 'active' : ''}" data-year="all" onclick="window.__archYear('all')">All</div>
      ${_years.map(y => `<div class="chip ${_selectedYear === y ? 'active' : ''}" data-year="${y}" onclick="window.__archYear('${y}')">${y}</div>`).join('')}
    </div>
    <div id="arch-content">
      <div class="loading-center" style="padding:40px"><div class="spinner"></div></div>
    </div>
    <div style="height:32px"></div>`;

  window.__archYear = async (year) => {
    _selectedYear = year;
    document.querySelectorAll('#arch-tabs .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.year === year));
    await renderContent();
  };

  await renderContent();
}

async function renderContent() {
  const el = document.getElementById('arch-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-center" style="padding:40px"><div class="spinner"></div></div>`;

  const currency = getCurrency();

  const filtered = _selectedYear === 'all'
    ? _tripsData
    : _tripsData.filter(d => d.trip.startDate?.startsWith(_selectedYear));

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-sub">No trips in ${_selectedYear}</div></div>`;
    return;
  }

  let grandTotal = 0;
  const byCat = {};
  let totalDays = 0;
  let totalMileage = 0;
  let totalStays = 0;
  const placeEntries = [];
  let totalActivities = 0;
  let completedActivities = 0;
  const allActivities = [];
  const countryCounts = {};

  for (const { trip, expenses, activities, accommodation, itinerary } of filtered) {
    for (const e of expenses) {
      const amt = await convert(e.amount || 0, e.currency || 'KRW', currency);
      grandTotal += amt;
      const cat = e.category || 'other';
      byCat[cat] = (byCat[cat] || 0) + amt;
    }

    if (trip.startDate && trip.endDate) {
      totalDays += Math.round((new Date(trip.endDate) - new Date(trip.startDate)) / 86400000) + 1;
    }

    const mDetail = await calcMileageDetail(itinerary);
    totalMileage += mDetail.total || 0;

    totalStays += accommodation.length;
    totalActivities += activities.length;
    completedActivities += activities.filter(a => a.completed).length;
    allActivities.push(...activities);

    [...itinerary, ...activities].forEach(item => {
      if (item.location && item.type !== 'home') {
        const city = extractCity(item.location);
        if (city) placeEntries.push({ city, date: item.date || '' });
      }
    });
    accommodation.forEach(a => {
      if (a.address) {
        const city = extractCity(a.address);
        if (city) placeEntries.push({ city, date: a.checkIn || '' });
      }
    });

    const country = trip.country || (trip.destination ? trip.destination.split(',').pop().trim() : null);
    if (country) {
      countryCounts[country] = (countryCounts[country] || 0) + 1;
    }
  }

  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const tripCount = filtered.length;

  placeEntries.sort((a, b) => b.date.localeCompare(a.date));
  const seenCities = new Set();
  const uniquePlaces = placeEntries.filter(p => {
    if (seenCities.has(p.city)) return false;
    seenCities.add(p.city);
    return true;
  }).map(p => p.city);

  allActivities.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  el.innerHTML = `
    <div style="padding:0 16px 32px">
      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat-card" style="grid-column:1/-1">
          <div class="eyebrow" style="margin-bottom:6px">${t('arch.total_spent')}</div>
          <div class="mono" style="font-size:32px;font-weight:700;color:var(--accent)">${formatCurrency(grandTotal, currency)}</div>
          <div class="text-xs text-muted" style="margin-top:4px">${currency}</div>
        </div>
      </div>

      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat-card" style="cursor:pointer" onclick="window.__archShowTrips()">
          <div class="stat-value mono">${tripCount}</div>
          <div class="stat-label">${t('arch.trips')}</div>
          <div class="stat-sub">${Object.keys(countryCounts).length} ${t('arch.countries')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value mono">${totalDays || '—'}</div>
          <div class="stat-label">${t('arch.days')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value mono">${totalMileage} km</div>
          <div class="stat-label">${t('arch.mileage')}</div>
          <div class="stat-sub">${totalStays} ${t('arch.stays_label')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value mono">${completedActivities}</div>
          <div class="stat-label">${t('arch.activities')}</div>
          <div class="stat-sub">${totalActivities} ${t('arch.total_label')}</div>
        </div>
      </div>

      ${catEntries.length > 0 ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <span class="eyebrow">${t('arch.by_category')}</span>
          <span class="text-xs text-muted">${formatCurrency(grandTotal, currency)}</span>
        </div>
        <div class="card-body" style="padding:12px 14px">
          ${catEntries.map(([cat, val]) => {
            const pct = grandTotal > 0 ? Math.round((val / grandTotal) * 100) : 0;
            return `
              <div style="margin-bottom:12px">
                <div class="row-between" style="margin-bottom:4px">
                  <div class="row gap-6">
                    <span>${CAT_ICONS[cat] || '💳'}</span>
                    <span class="text-sm">${t('exp.cats.' + cat)}</span>
                  </div>
                  <div class="row gap-8">
                    <span class="text-xs text-muted mono">${pct}%</span>
                    <span class="mono text-sm text-accent">${formatCurrency(val, currency)}</span>
                  </div>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width:${pct}%;background:${CAT_COLORS[cat] || 'var(--accent)'}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${uniquePlaces.length > 0 ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="eyebrow">${t('arch.places')}</span></div>
        <div class="card-body" style="padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px">
          ${uniquePlaces.map(p => `<div class="badge badge-sky">📍 ${p}</div>`).join('')}
        </div>
      </div>` : ''}

      ${allActivities.length > 0 ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <span class="eyebrow">${t('arch.act_prog')}</span>
          <span class="mono text-sm">${completedActivities}/${totalActivities}</span>
        </div>
        <div class="card-body">
          <div class="progress-bar" style="height:8px;margin-bottom:10px">
            <div class="progress-fill" style="width:${totalActivities > 0 ? Math.round(completedActivities / totalActivities * 100) : 0}%"></div>
          </div>
          ${allActivities.map(a => `
            <div class="row gap-8" style="padding:5px 0;border-bottom:1px solid var(--line-soft)">
              <div class="check-box ${a.completed ? 'checked' : ''}" style="pointer-events:none"></div>
              <span class="text-sm ${a.completed ? 'text-muted' : ''}" style="${a.completed ? 'text-decoration:line-through' : ''}">${a.name || '—'}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;

  window.__archShowTrips = () => {
    const rows = Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `
        <div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--line)">
          <span class="text-sm">🌍 ${c}</span>
          <span class="mono text-sm text-accent">×${n}</span>
        </div>`).join('');
    openModal({
      title: t('arch.trips'),
      body: rows || `<div class="text-sm text-muted" style="padding:8px 0">No country info available</div>`,
      footer: `<button class="btn btn-ghost btn-full" onclick="window.__closeModal()">${t('common.done')}</button>`
    });
  };
}

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">📊</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
