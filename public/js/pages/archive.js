import { t } from '../i18n.js';
import { getTrip, getItinerary, getAccommodation, getActivities, getExpenses } from '../db.js';
import { convert, formatCurrency, getCurrency, ensureRates } from '../currency.js';
import { calcMileage } from '../mileage.js';

let _ctx = null;

export function destroy() {
  document.querySelector('.fab')?.remove();
}

const CAT_COLORS = {
  transport: '#6ea6e8', food: '#e8c87c', accom: '#5fb88c',
  activity: '#ee6c3a', shopping: '#d97a7a', other: '#7c8089'
};
const CAT_ICONS = {
  transport: '🚗', food: '🍔', accom: '🏨',
  activity: '⚡', shopping: '🛍️', other: '💳'
};

export async function render(container, ctx) {
  _ctx = ctx;
  const { userId, tripId } = ctx;

  if (!tripId) {
    container.innerHTML = noTripHTML();
    return;
  }

  container.innerHTML = `
    <div style="padding:14px 16px 8px">
      <div class="eyebrow" style="margin-bottom:2px">${t('nav.archive')}</div>
      <div class="page-title">Archive</div>
    </div>
    <div class="loading-center" style="padding:48px"><div class="spinner"></div></div>`;

  try {
    await ensureRates();
    const currency = getCurrency();

    const [trip, itinerary, accommodation, activities, expenses] = await Promise.all([
      getTrip(userId, tripId),
      getItinerary(userId, tripId),
      getAccommodation(userId, tripId),
      getActivities(userId, tripId),
      getExpenses(userId, tripId),
    ]);

    // ── Compute stats ────────────────────────────────────────────
    const byCat = {};
    let grandTotal = 0;
    for (const e of expenses) {
      const amt = await convert(e.amount || 0, e.currency || 'KRW', currency);
      grandTotal += amt;
      const cat = e.category || 'other';
      byCat[cat] = (byCat[cat] || 0) + amt;
    }

    // Mileage
    const mileageKm = await calcMileage(itinerary);

    // Activities completed
    const completedActs = activities.filter(a => a.completed).length;

    // Trip duration
    let tripDays = 0;
    if (trip?.startDate && trip?.endDate) {
      tripDays = Math.round((new Date(trip.endDate) - new Date(trip.startDate)) / 86400000) + 1;
    }

    // Places visited (unique locations from itinerary + activities)
    const places = new Set();
    [...itinerary, ...activities].forEach(item => {
      if (item.location) places.add(item.location.split(',')[0].trim());
    });
    accommodation.forEach(a => {
      if (a.address) places.add(a.address.split(',')[0].trim());
    });

    const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
      <div class="page" style="padding-bottom:32px">
        <!-- Header -->
        <div style="margin-bottom:20px;padding-top:4px">
          <div class="eyebrow" style="margin-bottom:2px">${t('nav.archive')}</div>
          <div class="page-title">${trip?.name || 'Trip'}</div>
          ${trip?.destination ? `<div class="text-sm text-muted">📍 ${trip.destination}</div>` : ''}
        </div>

        <!-- Top stats grid -->
        <div class="stat-grid" style="margin-bottom:16px">
          <div class="stat-card" style="grid-column:1/-1">
            <div class="eyebrow" style="margin-bottom:6px">${t('arch.total_spent')}</div>
            <div class="mono" style="font-size:32px;font-weight:700;color:var(--accent)">${formatCurrency(grandTotal, currency)}</div>
            <div class="text-xs text-muted" style="margin-top:4px">${expenses.length} transactions · ${currency}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${tripDays || '—'}</div>
            <div class="stat-label">${t('arch.days')}</div>
            ${trip?.startDate ? `<div class="stat-sub">${trip.startDate}</div>` : ''}
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${mileageKm} km</div>
            <div class="stat-label">${t('arch.mileage')}</div>
            <div class="stat-sub">${accommodation.length} ${t('arch.stays_label')}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${completedActs}</div>
            <div class="stat-label">${t('arch.activities')}</div>
            <div class="stat-sub">${activities.length} ${t('arch.total_label')}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value mono">${places.size}</div>
            <div class="stat-label">${t('arch.places')}</div>
          </div>
        </div>

        <!-- Expense by category -->
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

        <!-- Places visited -->
        ${places.size > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <span class="eyebrow">${t('arch.places')}</span>
          </div>
          <div class="card-body" style="padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px">
            ${[...places].map(p => `<div class="badge badge-sky">📍 ${p}</div>`).join('')}
          </div>
        </div>` : ''}

        <!-- Activity completion -->
        ${activities.length > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <span class="eyebrow">${t('arch.act_prog')}</span>
            <span class="mono text-sm">${completedActs}/${activities.length}</span>
          </div>
          <div class="card-body">
            <div class="progress-bar" style="height:8px;margin-bottom:10px">
              <div class="progress-fill" style="width:${activities.length > 0 ? Math.round(completedActs / activities.length * 100) : 0}%"></div>
            </div>
            ${activities.slice(0, 6).map(a => `
              <div class="row gap-8" style="padding:5px 0;border-bottom:1px solid var(--line-soft)">
                <div class="check-box ${a.completed ? 'checked' : ''}" style="pointer-events:none"></div>
                <span class="text-sm ${a.completed ? 'text-muted' : ''}" style="${a.completed ? 'text-decoration:line-through' : ''}">${a.name || '—'}</span>
              </div>`).join('')}
            ${activities.length > 6 ? `<div class="text-xs text-muted" style="margin-top:6px">+${activities.length - 6} more</div>` : ''}
          </div>
        </div>` : ''}
      </div>`;

  } catch (e) {
    console.error('Archive render:', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error loading archive</div><div class="empty-sub">${e.message}</div></div>`;
  }
}

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">📊</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
