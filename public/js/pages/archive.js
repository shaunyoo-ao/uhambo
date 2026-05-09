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
    // Total expenses by category
    const byCat = {};
    let grandTotal = 0;
    for (const e of expenses) {
      const amt = await convert(e.amount || 0, e.currency || 'KRW', currency);
      grandTotal += amt;
      const cat = e.category || 'other';
      byCat[cat] = (byCat[cat] || 0) + amt;
    }

    // Nights stayed
    let totalNights = 0;
    accommodation.forEach(a => {
      if (a.checkIn && a.checkOut) {
        totalNights += Math.max(0, Math.round((new Date(a.checkOut) - new Date(a.checkIn)) / 86400000));
      }
    });

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

    // Per-category breakdown
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
            <canvas id="arch-chart" width="200" height="200" class="chart-canvas" style="margin-top:16px"></canvas>
          </div>
        </div>` : ''}

        <!-- Per-day spending -->
        ${renderDailySpend(expenses, currency)}

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
              <div class="progress-fill" style="width:${activities.length > 0 ? Math.round(completedActs/activities.length*100) : 0}%"></div>
            </div>
            ${activities.slice(0, 6).map(a => `
              <div class="row gap-8" style="padding:5px 0;border-bottom:1px solid var(--line-soft)">
                <div class="check-box ${a.completed ? 'checked' : ''}" style="pointer-events:none"></div>
                <span class="text-sm ${a.completed ? 'text-muted' : ''}" style="${a.completed ? 'text-decoration:line-through' : ''}">${a.name || '—'}</span>
              </div>`).join('')}
            ${activities.length > 6 ? `<div class="text-xs text-muted" style="margin-top:6px">+${activities.length-6} more</div>` : ''}
          </div>
        </div>` : ''}

        <!-- Itinerary summary -->
        ${itinerary.length > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <span class="eyebrow">Trip Timeline</span>
            <span class="text-xs text-muted">${itinerary.length} events</span>
          </div>
          <div class="card-body" style="padding:10px 14px">
            <div class="row gap-8" style="flex-wrap:wrap">
              <div class="stat-card" style="flex:1;min-width:80px">
                <div class="stat-value mono">${itinerary.filter(i=>i.type==='travel').length}</div>
                <div class="stat-label">Travel</div>
              </div>
              <div class="stat-card" style="flex:1;min-width:80px">
                <div class="stat-value mono">${itinerary.filter(i=>i.type==='meal').length}</div>
                <div class="stat-label">Meals</div>
              </div>
              <div class="stat-card" style="flex:1;min-width:80px">
                <div class="stat-value mono">${itinerary.filter(i=>i.type==='activity').length}</div>
                <div class="stat-label">Activities</div>
              </div>
            </div>
          </div>
        </div>` : ''}

        <!-- Per-night cost -->
        ${totalNights > 0 && grandTotal > 0 ? `
        <div class="card">
          <div class="card-header"><span class="eyebrow">Cost Breakdown</span></div>
          <div class="card-body">
            <div class="row-between" style="padding:5px 0;border-bottom:1px solid var(--line-soft)">
              <span class="text-sm">Per night</span>
              <span class="mono text-sm text-accent">${formatCurrency(grandTotal / totalNights, currency)}</span>
            </div>
            ${tripDays > 0 ? `
            <div class="row-between" style="padding:5px 0;border-bottom:1px solid var(--line-soft)">
              <span class="text-sm">Per day</span>
              <span class="mono text-sm text-accent">${formatCurrency(grandTotal / tripDays, currency)}</span>
            </div>` : ''}
            <div class="row-between" style="padding:5px 0">
              <span class="text-sm">Per activity</span>
              <span class="mono text-sm text-accent">${activities.length > 0 ? formatCurrency(grandTotal / activities.length, currency) : '—'}</span>
            </div>
          </div>
        </div>` : ''}
      </div>`;

    // Draw donut chart
    if (catEntries.length > 0) {
      drawDonut(catEntries, grandTotal);
    }

  } catch (e) {
    console.error('Archive render:', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error loading archive</div><div class="empty-sub">${e.message}</div></div>`;
  }
}

function renderDailySpend(expenses, currency) {
  if (expenses.length === 0) return '';
  const byDate = {};
  expenses.forEach(e => {
    const d = e.date || 'Unknown';
    if (!byDate[d]) byDate[d] = 0;
    // Use raw amount in same currency for simplicity here (already converted async above)
  });
  return '';
}

function drawDonut(catEntries, total) {
  const canvas = document.getElementById('arch-chart');
  if (!canvas || total === 0) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 12;
  ctx.clearRect(0, 0, W, H);
  let angle = -Math.PI / 2;
  catEntries.forEach(([cat, val]) => {
    const sweep = (val / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = CAT_COLORS[cat] || '#7c8089';
    ctx.fill();
    angle += sweep;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, 2 * Math.PI);
  ctx.fillStyle = '#16181c';
  ctx.fill();
}

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">📊</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
