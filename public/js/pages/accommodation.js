import { t, getLang } from '../i18n.js';
import {
  subscribeBookings, addBooking, updateBooking, deleteBooking,
  upsertLinkedExpense, deleteLinkedExpense, upsertLinkedItinItem, deleteLinkedItinItems, deleteLinkedItinItem,
  getTrip,
} from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving, escapeHtml } from '../app.js';
import { formatConverted, getCurrency, CURRENCIES } from '../currency.js';
import { openCalc } from '../calculator.js';
import { geocodeCity } from '../weather.js';
import { resizeImageToBlob, uploadToImgBB } from '../imgbb.js';

const BOOK_CATS = ['accommodation', 'travel', 'rent', 'cruise'];
const BOOK_CAT_ICONS = { accommodation: '🏨', travel: '✈️', rent: '🚗', cruise: '⛴️' };

let _unsub = null;
let _ctx = null;
let _tripStartDate = null;
let _items = [];
let _links = [];
let _imageSlots = [];
let _portCalls = [];
let _tripCountry = '';
let _filter = 'all';
let _adding = false;

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.querySelector('.fab[data-route="booking"]')?.remove();
}

export async function render(container, ctx) {
  _ctx = ctx;
  _tripStartDate = ctx.tripStartDate || null;
  _filter = 'all';
  const { userId, tripId, isGuest } = ctx;
  getTrip(userId, tripId).then(tr => { _tripCountry = tr?.country || ''; }).catch(() => {});

  if (!tripId) {
    container.innerHTML = noTripHTML();
    return;
  }

  container.innerHTML = `
    <div style="padding:14px 16px 8px" class="row-between">
      <div>
        <div class="eyebrow" style="margin-bottom:2px">${t('nav.booking')}</div>
        <div class="page-title">Booking</div>
      </div>
    </div>
    <div class="chip-row" id="booking-filter-row" style="padding:0 16px 8px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none">
      <div class="chip ${_filter === 'all' ? 'chip-active' : ''}" onclick="window.__bookFilter('all')">All</div>
      ${BOOK_CATS.map(c => `<div class="chip ${_filter === c ? 'chip-active' : ''}" onclick="window.__bookFilter('${c}')">${BOOK_CAT_ICONS[c]} ${t('book.cats.' + c)}</div>`).join('')}
    </div>
    <div id="booking-list"><div class="loading-center"><div class="spinner"></div></div></div>
    <div style="height:80px"></div>`;

  window.__bookFilter = (cat) => {
    _filter = cat;
    const row = document.getElementById('booking-filter-row');
    if (row) row.innerHTML = `
      <div class="chip ${_filter === 'all' ? 'chip-active' : ''}" onclick="window.__bookFilter('all')">All</div>
      ${BOOK_CATS.map(c => `<div class="chip ${_filter === c ? 'chip-active' : ''}" onclick="window.__bookFilter('${c}')">${BOOK_CAT_ICONS[c]} ${t('book.cats.' + c)}</div>`).join('')}
    `;
    renderList(_items);
  };

  if (!isGuest) addFAB(() => openItemModal(null));

  if (_unsub) _unsub();
  _unsub = subscribeBookings(userId, tripId, items => {
    _items = items.sort((a, b) => {
      const da = (a.checkIn || a.departureDate || a.pickupDate || a.embarkDate || '') + 'T' + (a.checkInTime || a.departureTime || a.pickupTime || a.embarkTime || '');
      const db2 = (b.checkIn || b.departureDate || b.pickupDate || b.embarkDate || '') + 'T' + (b.checkInTime || b.departureTime || b.pickupTime || b.embarkTime || '');
      return da.localeCompare(db2);
    });
    renderList(_items);
  }, (err) => {
    const el = document.getElementById('booking-list');
    if (el) el.innerHTML = `<div class="empty-state" style="margin-top:40px"><div class="empty-icon">⚠️</div><div class="empty-sub">${err.message}</div></div>`;
  });
}

async function renderList(items) {
  const el = document.getElementById('booking-list');
  if (!el) return;

  const filtered = _filter === 'all' ? items : items.filter(i => (i.category || 'accommodation') === _filter);

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">${_filter === 'all' ? '📋' : BOOK_CAT_ICONS[_filter] || '📋'}</div>
      <div class="empty-title">${t('common.empty')}</div>
      <div class="empty-sub">${t('book.tap_add')}</div>
    </div>`;
    return;
  }

  const cards = await Promise.all(filtered.map(async item => {
    const cat = item.category || 'accommodation';
    const priceStr = item.cost ? await formatConverted(item.cost, item.currency || 'KRW') : null;
    const statusBadge = item.status === 'candidate'
      ? `<div class="badge" style="background:rgba(232,200,124,0.15);color:var(--sun)" title="${t('common.candidate')}">🔖</div>`
      : item.status === 'booked'
      ? `<div class="badge" style="background:rgba(95,184,140,0.15);color:var(--mint)" title="${t('common.booked')}">✅</div>` : '';
    const clickAttr = _ctx?.isGuest ? '' : `onclick="window.__editBookItem('${item.id}')"`;
    const cursorStyle = _ctx?.isGuest ? '' : 'cursor:pointer';

    let cardContent = '';
    if (cat === 'cruise') {
      const nights = item.embarkDate && item.disembarkDate
        ? Math.round((new Date(item.disembarkDate) - new Date(item.embarkDate)) / 86400000)
        : null;
      const portCount = (item.portCalls || []).length;
      const portNames = (item.portCalls || []).map(p => p.port).filter(Boolean).join(' · ');
      cardContent = `
        <div class="row-between" style="margin-bottom:8px">
          <div class="row gap-8">
            <span style="font-size:20px">⛴️</span>
            <div>
              <div class="font-medium">${escapeHtml(item.shipName || item.name || '—')}${item.cruiseLine ? `<span class="text-xs text-muted" style="margin-left:6px">${escapeHtml(item.cruiseLine)}</span>` : ''}</div>
              ${item.cabinNo || item.cabinType ? `<div class="text-xs text-muted">🛏 ${escapeHtml([item.cabinNo, item.cabinType].filter(Boolean).join(' · '))}</div>` : ''}
            </div>
          </div>
          <div class="row gap-8">
            ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="dotrow"></div>
        <div class="row gap-16" style="flex-wrap:wrap">
          ${item.embarkDate ? `<div><div class="eyebrow" style="margin-bottom:2px">${t('book.embark_port')}</div><div class="text-sm">${item.embarkDate}${item.embarkTime ? ' ' + item.embarkTime : ''}<br><span class="text-xs text-muted">${escapeHtml(item.embarkPort || '')}</span></div></div>` : ''}
          ${item.disembarkDate ? `<div><div class="eyebrow" style="margin-bottom:2px">${t('book.disembark_port')}</div><div class="text-sm">${item.disembarkDate}${item.disembarkTime ? ' ' + item.disembarkTime : ''}<br><span class="text-xs text-muted">${escapeHtml(item.disembarkPort || '')}</span></div></div>` : ''}
          ${nights !== null ? `<div style="margin-left:auto"><div class="eyebrow" style="margin-bottom:2px">${t('accom.nights')}</div><div class="mono text-sm">${nights}</div></div>` : ''}
        </div>
        ${portCount > 0 ? `<div class="text-xs text-muted" style="margin-top:8px">⚓ ${portCount} ${t('book.port_calls')}${portNames ? ': ' + escapeHtml(portNames) : ''}</div>` : ''}
        ${item.bookingRef ? `<div class="text-xs text-muted" style="margin-top:4px">Ref: ${escapeHtml(item.bookingRef)}</div>` : ''}
        ${(item.images || []).length > 0 ? `<div style="margin-top:10px;display:grid;grid-template-columns:${(item.images || []).length > 1 ? '1fr 1fr' : '1fr'};gap:6px;border-radius:8px;overflow:hidden">${(item.images || []).slice(0, 4).map(u => `<img src="${u}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block">`).join('')}</div>` : ''}`;
    } else if (cat === 'travel') {
      const from = item.departureAirport || item.from || '';
      const to = item.arrivalAirport || item.to || '';
      const airline = item.airline || '';
      const flightNo = item.flightNo || '';
      cardContent = `
        <div class="row-between" style="margin-bottom:8px">
          <div class="row gap-8">
            <span style="font-size:20px">✈️</span>
            <div>
              <div class="font-medium">${escapeHtml(item.name || (airline ? `${airline} ${flightNo}` : (from && to ? `${from} → ${to}` : '—')))}</div>
              ${from && to ? `<div class="text-xs text-muted">${escapeHtml(from)} → ${escapeHtml(to)}</div>` : ''}
            </div>
          </div>
          <div class="row gap-8">
            ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="dotrow"></div>
        <div class="row gap-16">
          ${item.departureDate ? `<div><div class="eyebrow" style="margin-bottom:2px">${t('book.dep_date')}</div><div class="text-sm">${item.departureDate}${item.departureTime ? ' ' + item.departureTime : ''}</div></div>` : ''}
          ${item.arrivalDate ? `<div><div class="eyebrow" style="margin-bottom:2px">${t('book.arr_date')}</div><div class="text-sm">${item.arrivalDate}${item.arrivalTime ? ' ' + item.arrivalTime : ''}</div></div>` : ''}
        </div>
        ${item.pnr ? `<div class="text-xs text-muted" style="margin-top:6px">PNR: ${escapeHtml(item.pnr)}</div>` : ''}`;
    } else if (cat === 'rent') {
      const pickup = item.pickupLocation || '';
      const dropoff = item.dropoffLocation || '';
      cardContent = `
        <div class="row-between" style="margin-bottom:8px">
          <div class="row gap-8">
            <span style="font-size:20px">🚗</span>
            <div>
              <div class="font-medium">${escapeHtml(item.name || (item.rentalCompany ? `${item.rentalCompany}${item.vehicleType ? ' — ' + item.vehicleType : ''}` : '—'))}</div>
              ${pickup ? `<div class="text-xs text-muted">📍 ${escapeHtml(pickup)}</div>` : ''}
            </div>
          </div>
          <div class="row gap-8">
            ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="dotrow"></div>
        <div class="row gap-16">
          ${item.pickupDate ? `<div><div class="eyebrow" style="margin-bottom:2px">${t('book.pickup_date')}</div><div class="text-sm">${item.pickupDate}${item.pickupTime ? ' ' + item.pickupTime : ''}</div></div>` : ''}
          ${item.dropoffDate ? `<div><div class="eyebrow" style="margin-bottom:2px">${t('book.dropoff_date')}</div><div class="text-sm">${item.dropoffDate}${item.dropoffTime ? ' ' + item.dropoffTime : ''}</div></div>` : ''}
        </div>
        ${item.bookingRef ? `<div class="text-xs text-muted" style="margin-top:6px">Ref: ${escapeHtml(item.bookingRef)}</div>` : ''}`;
    } else {
      // Accommodation
      const nights = item.checkIn && item.checkOut
        ? Math.round((new Date(item.checkOut) - new Date(item.checkIn)) / 86400000)
        : null;
      cardContent = `
        <div class="row-between" style="margin-bottom:8px">
          <div class="row gap-8">
            <span style="font-size:20px">🏨</span>
            <div>
              <div class="font-medium">${escapeHtml(item.name || '—')}</div>
              ${item.address ? `<div class="text-xs text-muted">📍 ${escapeHtml(item.address)}</div>` : ''}
            </div>
          </div>
          <div class="row gap-8">
            ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
            ${statusBadge}
          </div>
        </div>
        <div class="dotrow"></div>
        <div class="row gap-16">
          <div><div class="eyebrow" style="margin-bottom:2px">${t('accom.check_in')}</div><div class="text-sm">${item.checkIn || '—'}${item.checkInTime ? ' ' + item.checkInTime : ''}</div></div>
          <div><div class="eyebrow" style="margin-bottom:2px">${t('accom.check_out')}</div><div class="text-sm">${item.checkOut || '—'}${item.checkOutTime ? ' ' + item.checkOutTime : ''}</div></div>
          ${nights !== null ? `<div style="margin-left:auto"><div class="eyebrow" style="margin-bottom:2px">${t('accom.nights')}</div><div class="mono text-sm">${nights}</div></div>` : ''}
        </div>
        ${(item.images || []).length > 0 ? `<div style="margin-top:10px;display:grid;grid-template-columns:${(item.images || []).length > 1 ? '1fr 1fr' : '1fr'};gap:6px;border-radius:8px;overflow:hidden">${(item.images || []).slice(0, 4).map(u => `<img src="${u}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block">`).join('')}</div>` : ''}`;
    }

    return `
      <div class="card" style="margin:0 16px 12px;${cursorStyle}" ${clickAttr}>
        <div class="card-body" style="padding:14px">
          ${cardContent}
          ${(item.links || []).length > 0 ? `<div class="row gap-6" style="margin-top:8px;flex-wrap:wrap">${item.links.map(u => `<a href="${u}" target="_blank" rel="noopener" class="text-xs" style="color:var(--sky)" onclick="event.stopPropagation()">🔗 Link</a>`).join('')}</div>` : ''}
          ${item.notes ? `<div class="text-xs text-muted" style="margin-top:8px;white-space:pre-wrap">${escapeHtml(item.notes)}</div>` : ''}
        </div>
      </div>`;
  }));

  el.innerHTML = cards.join('');

  window.__editBookItem = (id) => {
    const item = _items.find(i => i.id === id);
    if (item) openItemModal(item);
  };
}

function coordsField(lat, lng, name = 'coords') {
  return `
    <div class="form-group" style="margin-top:-4px">
      <label class="form-label" style="font-size:0.7rem;color:var(--muted)">${t('book.coords')} <span style="font-weight:400">(${t('book.coords_hint')})</span></label>
      <input class="form-input" name="${name}" value="${lat && lng ? `${parseFloat(lat).toFixed(6)}, ${parseFloat(lng).toFixed(6)}` : ''}" placeholder="e.g. -25.989, 28.005" autocomplete="off" style="font-size:0.8rem">
    </div>`;
}

function parseCoords(raw) {
  if (!raw?.trim()) return null;
  const parts = raw.trim().split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return { lat: parts[0], lng: parts[1] };
  return null;
}

function accomImgGridHTML() {
  return _imageSlots.map((slot, i) => {
    if (slot.type === 'empty') return `<div class="img-slot img-slot-empty" onclick="window.__bookImgPick(${i})"><span>+</span></div>`;
    return `<div class="img-slot img-slot-filled"><img src="${slot.preview}" alt=""><button type="button" class="img-slot-del" onclick="event.stopPropagation();window.__bookImgRemove(${i})">×</button></div>`;
  }).join('');
}

function linkListHTML(links) {
  return (links || []).map((url, i) => `
    <div class="link-item">
      <a href="${url}" target="_blank" rel="noopener">${url}</a>
      <button type="button" class="link-item-del" onclick="window.__bookRmLink(${i})">×</button>
    </div>`).join('');
}

function accommodationFormHTML(item, today) {
  return `
    <div class="form-group">
      <label class="form-label">${t('accom.name')} *</label>
      <input class="form-input" name="name" value="${escapeHtml(item?.name || '')}" placeholder="e.g. Hotel Gracery" required>
    </div>
    <div class="form-group">
      <label class="form-label">${t('accom.address')}</label>
      <input class="form-input" name="address" value="${escapeHtml(item?.address || '')}" placeholder="Full address">
    </div>
    ${coordsField(item?.lat, item?.lng)}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('accom.check_in')}</label>
        <input class="form-input" name="checkIn" type="date" lang="${getLang()}" value="${item?.checkIn || today}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('accom.check_in_time')}</label>
        <input class="form-input" name="checkInTime" type="time" value="${item?.checkInTime || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('accom.check_out')}</label>
        <input class="form-input" name="checkOut" type="date" lang="${getLang()}" value="${item?.checkOut || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('accom.check_out_time')}</label>
        <input class="form-input" name="checkOutTime" type="time" value="${item?.checkOutTime || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.headcount')}</label>
      <input class="form-input" name="headcount" type="number" min="1" value="${item?.headcount || ''}" placeholder="2">
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label class="form-label">${t('accom.cost')}</label>
        <div style="display:flex;gap:6px">
          <input id="book-cost-input" class="form-input" name="cost" type="number" min="0" step="any" value="${item?.cost || ''}" placeholder="0" style="flex:1">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('book-cost-input')" style="flex-shrink:0;padding:0 10px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg></button>
        </div>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">${t('accom.currency')}</label>
        <select class="form-select" name="currency">
          ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Photos</label>
      <div class="img-upload-grid" id="book-img-grid">${accomImgGridHTML()}</div>
      <input type="file" id="book-file-input" accept="image/*" style="display:none" onchange="window.__bookFileChange(this)">
    </div>`;
}

function travelFormHTML(item, today) {
  return `
    <div class="form-group">
      <label class="form-label">${t('book.airline')}</label>
      <input class="form-input" name="airline" value="${escapeHtml(item?.airline || '')}" placeholder="e.g. Korean Air">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('book.flight_no')}</label>
        <input class="form-input" name="flightNo" value="${escapeHtml(item?.flightNo || '')}" placeholder="e.g. KE 001">
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.cabin_class')}</label>
        <select class="form-select" name="cabinClass">
          <option value="economy" ${(item?.cabinClass || 'economy') === 'economy' ? 'selected' : ''}>Economy</option>
          <option value="business" ${item?.cabinClass === 'business' ? 'selected' : ''}>Business</option>
          <option value="first" ${item?.cabinClass === 'first' ? 'selected' : ''}>First</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.from')} *</label>
      <input class="form-input" name="departureAirport" value="${escapeHtml(item?.departureAirport || '')}" placeholder="e.g. ICN — Seoul Incheon" required>
    </div>
    ${coordsField(item?.depLat, item?.depLng, 'depCoords')}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('book.dep_date')}</label>
        <input class="form-input" name="departureDate" type="date" lang="${getLang()}" value="${item?.departureDate || today}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.dep_time')}</label>
        <input class="form-input" name="departureTime" type="time" value="${item?.departureTime || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.to')} *</label>
      <input class="form-input" name="arrivalAirport" value="${escapeHtml(item?.arrivalAirport || '')}" placeholder="e.g. JFK — New York JFK" required>
    </div>
    ${coordsField(item?.arrLat, item?.arrLng, 'arrCoords')}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('book.arr_date')}</label>
        <input class="form-input" name="arrivalDate" type="date" lang="${getLang()}" value="${item?.arrivalDate || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.arr_time')}</label>
        <input class="form-input" name="arrivalTime" type="time" value="${item?.arrivalTime || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.pnr')}</label>
      <input class="form-input" name="pnr" value="${escapeHtml(item?.pnr || '')}" placeholder="e.g. ABC123">
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.headcount')}</label>
      <input class="form-input" name="headcount" type="number" min="1" value="${item?.headcount || ''}" placeholder="2">
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label class="form-label">${t('accom.cost')}</label>
        <div style="display:flex;gap:6px">
          <input id="book-cost-input" class="form-input" name="cost" type="number" min="0" step="any" value="${item?.cost || ''}" placeholder="0" style="flex:1">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('book-cost-input')" style="flex-shrink:0;padding:0 10px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg></button>
        </div>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">${t('accom.currency')}</label>
        <select class="form-select" name="currency">
          ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

function rentFormHTML(item, today) {
  return `
    <div class="form-group">
      <label class="form-label">${t('book.company')}</label>
      <input class="form-input" name="rentalCompany" value="${escapeHtml(item?.rentalCompany || '')}" placeholder="e.g. Hertz">
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.vehicle')}</label>
      <input class="form-input" name="vehicleType" value="${escapeHtml(item?.vehicleType || '')}" placeholder="e.g. Compact SUV">
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.pickup_loc')} *</label>
      <input class="form-input" name="pickupLocation" value="${escapeHtml(item?.pickupLocation || '')}" placeholder="e.g. JFK Airport, Terminal 4" required>
    </div>
    ${coordsField(item?.pickupLat, item?.pickupLng, 'pickupCoords')}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('book.pickup_date')}</label>
        <input class="form-input" name="pickupDate" type="date" lang="${getLang()}" value="${item?.pickupDate || today}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.pickup_time')}</label>
        <input class="form-input" name="pickupTime" type="time" value="${item?.pickupTime || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.dropoff_loc')}</label>
      <input class="form-input" name="dropoffLocation" value="${escapeHtml(item?.dropoffLocation || '')}" placeholder="e.g. Same location">
    </div>
    ${coordsField(item?.dropoffLat, item?.dropoffLng, 'dropoffCoords')}
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${t('book.dropoff_date')}</label>
        <input class="form-input" name="dropoffDate" type="date" lang="${getLang()}" value="${item?.dropoffDate || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.dropoff_time')}</label>
        <input class="form-input" name="dropoffTime" type="time" value="${item?.dropoffTime || ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.booking_ref')}</label>
      <input class="form-input" name="bookingRef" value="${escapeHtml(item?.bookingRef || '')}" placeholder="e.g. HR-123456">
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label class="form-label">${t('accom.cost')}</label>
        <div style="display:flex;gap:6px">
          <input id="book-cost-input" class="form-input" name="cost" type="number" min="0" step="any" value="${item?.cost || ''}" placeholder="0" style="flex:1">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('book-cost-input')" style="flex-shrink:0;padding:0 10px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg></button>
        </div>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">${t('accom.currency')}</label>
        <select class="form-select" name="currency">
          ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

function portCallsHTML() {
  if (_portCalls.length === 0) {
    return `<div class="text-xs text-muted" style="padding:2px 0 8px">${getLang() === 'ko' ? '기항지를 추가하세요' : 'Add port calls below'}</div>`;
  }
  return _portCalls.map((pc, i) => {
    const coordsVal = pc.coords !== undefined ? pc.coords : (pc.lat && pc.lng ? `${pc.lat}, ${pc.lng}` : '');
    return `
    <div style="background:var(--surface-3,#232730);border-radius:8px;padding:10px 12px;margin-bottom:8px">
      <div class="row-between" style="margin-bottom:8px">
        <span class="eyebrow">${t('book.port_n')} ${i + 1}</span>
        <button type="button" class="link-item-del" onclick="window.__removePortCall(${i})">×</button>
      </div>
      <input class="form-input" style="margin-bottom:6px" placeholder="${getLang() === 'ko' ? '항구명 (예: Kusadasi, Turkiye)' : 'Port name (e.g. Kusadasi, Turkiye)'}"
        value="${escapeHtml(pc.port || '')}"
        oninput="window.__portCallUpdate(${i},'port',this.value)">
      <div class="form-row" style="margin-bottom:4px">
        <div class="form-group" style="flex:3">
          <label class="form-label">${getLang() === 'ko' ? '날짜' : 'Date'}</label>
          <input class="form-input" type="date" lang="${getLang()}" value="${pc.date || ''}"
            oninput="window.__portCallUpdate(${i},'date',this.value)">
        </div>
        <div class="form-group" style="flex:2">
          <label class="form-label">${t('book.arr_time')}</label>
          <input class="form-input" type="time" value="${pc.arrTime || ''}"
            oninput="window.__portCallUpdate(${i},'arrTime',this.value)">
        </div>
        <div class="form-group" style="flex:2">
          <label class="form-label">${t('book.dep_time')}</label>
          <input class="form-input" type="time" value="${pc.depTime || ''}"
            oninput="window.__portCallUpdate(${i},'depTime',this.value)">
        </div>
      </div>
      <input class="form-input" style="font-size:0.78rem" placeholder="${getLang() === 'ko' ? '좌표 (선택) 예: 37.857, 27.258' : 'Coords (optional) e.g. 37.857, 27.258'}"
        value="${escapeHtml(coordsVal)}"
        oninput="window.__portCallUpdate(${i},'coords',this.value)">
    </div>`;
  }).join('');
}

function cruiseFormHTML(item, today) {
  _portCalls = (item?.portCalls || []).map(p => ({ ...p }));
  const calcSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg>`;
  return `
    <div class="form-row">
      <div class="form-group" style="flex:3">
        <label class="form-label">${t('book.ship')} *</label>
        <input class="form-input" name="shipName" value="${escapeHtml(item?.shipName || '')}" placeholder="e.g. MSC FANTASIA" required>
      </div>
      <div class="form-group" style="flex:2">
        <label class="form-label">${t('book.cabin_no')}</label>
        <input class="form-input" name="cabinNo" value="${escapeHtml(item?.cabinNo || '')}" placeholder="e.g. 10020">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label class="form-label">${t('book.cruise_line')}</label>
        <input class="form-input" name="cruiseLine" value="${escapeHtml(item?.cruiseLine || '')}" placeholder="e.g. MSC Cruises">
      </div>
      <div class="form-group" style="flex:3">
        <label class="form-label">${t('book.cabin_type')}</label>
        <input class="form-input" name="cabinType" value="${escapeHtml(item?.cabinType || '')}" placeholder="e.g. BL2 - Balcony Cabin">
      </div>
    </div>

    <div style="margin:8px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line)">
      <span class="eyebrow">⚓ ${t('book.embark_port')}</span>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.embark_port')} *</label>
      <input class="form-input" name="embarkPort" value="${escapeHtml(item?.embarkPort || '')}" placeholder="e.g. Piraeus, Greece" required>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${getLang() === 'ko' ? '날짜' : 'Date'} *</label>
        <input class="form-input" name="embarkDate" type="date" lang="${getLang()}" value="${item?.embarkDate || today}" required>
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.embark_time')}</label>
        <input class="form-input" name="embarkTime" type="time" value="${item?.embarkTime || ''}">
      </div>
    </div>

    <div style="margin:8px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line)">
      <span class="eyebrow">🗺️ ${t('book.port_calls')}</span>
    </div>
    <div id="cruise-port-list">${portCallsHTML()}</div>
    <button type="button" class="btn btn-secondary btn-sm" style="width:100%;margin-bottom:14px" onclick="window.__addPortCall()">
      ${t('book.add_port')}
    </button>

    <div style="margin:8px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line)">
      <span class="eyebrow">🏁 ${t('book.disembark_port')}</span>
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.disembark_port')} *</label>
      <input class="form-input" name="disembarkPort" value="${escapeHtml(item?.disembarkPort || '')}" placeholder="e.g. Piraeus, Greece" required>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">${getLang() === 'ko' ? '날짜' : 'Date'} *</label>
        <input class="form-input" name="disembarkDate" type="date" lang="${getLang()}" value="${item?.disembarkDate || ''}" required>
      </div>
      <div class="form-group">
        <label class="form-label">${t('book.disembark_time')}</label>
        <input class="form-input" name="disembarkTime" type="time" value="${item?.disembarkTime || ''}">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">${t('book.booking_ref')}</label>
      <input class="form-input" name="bookingRef" value="${escapeHtml(item?.bookingRef || '')}" placeholder="e.g. 72662893">
    </div>
    <div class="form-group">
      <label class="form-label">${t('book.headcount')}</label>
      <input class="form-input" name="headcount" type="number" min="1" value="${item?.headcount || ''}" placeholder="4">
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label class="form-label">${t('accom.cost')}</label>
        <div style="display:flex;gap:6px">
          <input id="book-cost-input" class="form-input" name="cost" type="number" min="0" step="any" value="${item?.cost || ''}" placeholder="0" style="flex:1">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('book-cost-input')" style="flex-shrink:0;padding:0 10px">${calcSvg}</button>
        </div>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">${t('accom.currency')}</label>
        <select class="form-select" name="currency">
          ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Photos</label>
      <div class="img-upload-grid" id="book-img-grid">${accomImgGridHTML()}</div>
      <input type="file" id="book-file-input" accept="image/*" style="display:none" onchange="window.__bookFileChange(this)">
    </div>`;
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = _tripStartDate || new Date().toISOString().slice(0, 10);
  const defaultCat = item?.category || 'accommodation';
  _links = item?.links ? [...item.links] : [];
  _portCalls = defaultCat === 'cruise' ? (item?.portCalls || []).map(p => ({ ...p })) : [];
  if (defaultCat === 'accommodation' || defaultCat === 'cruise') {
    _imageSlots = (item?.images || []).slice(0, 4).map(url => ({ type: 'url', value: url, preview: url }));
    while (_imageSlots.length < 4) _imageSlots.push({ type: 'empty', value: null, preview: null });
  } else {
    _imageSlots = [];
  }

  function buildBody(cat) {
    let catFields = '';
    if (cat === 'travel') catFields = travelFormHTML(item, today);
    else if (cat === 'rent') catFields = rentFormHTML(item, today);
    else if (cat === 'cruise') catFields = cruiseFormHTML(item, today);
    else { catFields = accommodationFormHTML(item, today); }

    return `
      <form id="book-form">
        <div class="form-group">
          <label class="form-label">${t('book.category')}</label>
          <select class="form-select" name="category" onchange="window.__bookCatSwitch(this.value)">
            ${BOOK_CATS.map(c => `<option value="${c}" ${cat === c ? 'selected' : ''}>${BOOK_CAT_ICONS[c]} ${t('book.cats.' + c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" id="book-name-group" style="${cat === 'accommodation' || cat === 'cruise' ? 'display:none' : ''}">
          <label class="form-label" id="book-name-label">${cat === 'travel' ? (getLang() === 'ko' ? '항공 이름' : 'Airline Name') : (getLang() === 'ko' ? '렌트 이름' : 'Rental Name')} <span class="text-muted" style="font-weight:400">${getLang() === 'ko' ? '(선택)' : '(optional)'}</span></label>
          <input class="form-input" name="name" id="book-name-input" value="${escapeHtml(item?.name || '')}" placeholder="${cat === 'travel' ? 'e.g. Outbound KE001' : 'e.g. Hertz Compact'}">
        </div>
        <div id="book-cat-fields">${catFields}</div>
        <div class="form-group">
          <label class="form-label">${t('common.links')}</label>
          <div class="link-list" id="book-link-list">${linkListHTML(_links)}</div>
          <div class="link-add-row">
            <input class="form-input" id="book-link-input" placeholder="https://..." type="url">
            <button type="button" class="btn btn-secondary btn-sm link-add-btn" onclick="window.__bookAddLink()">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.status')}</label>
          <select class="form-select" name="status">
            <option value="booked" ${(item?.status || 'candidate') === 'booked' ? 'selected' : ''}>✅ ${t('common.booked')}</option>
            <option value="candidate" ${(item?.status || 'candidate') === 'candidate' ? 'selected' : ''}>🔖 ${t('common.candidate')}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('accom.notes')}</label>
          <textarea class="form-textarea" name="notes" placeholder="Booking details, instructions…">${escapeHtml(item?.notes || '')}</textarea>
        </div>
      </form>`;
  }

  openModal({
    title: isEdit ? t('book.edit') : t('book.add'),
    body: buildBody(defaultCat),
    footer: `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="window.__deleteBookItem('${item.id}')">${t('common.delete')}</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveBookItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}</button>`
  });

  window.__openCalc = openCalc;

  window.__bookCatSwitch = (newCat) => {
    const catFieldsEl = document.getElementById('book-cat-fields');
    if (!catFieldsEl) return;

    // Re-init image slots for accommodation; port calls for cruise
    if (newCat === 'accommodation') {
      _imageSlots = [];
      while (_imageSlots.length < 4) _imageSlots.push({ type: 'empty', value: null, preview: null });
    } else if (newCat === 'cruise') {
      _portCalls = [];
      _imageSlots = [];
      while (_imageSlots.length < 4) _imageSlots.push({ type: 'empty', value: null, preview: null });
    }

    let newCatFields = '';
    if (newCat === 'travel') newCatFields = travelFormHTML(null, today);
    else if (newCat === 'rent') newCatFields = rentFormHTML(null, today);
    else if (newCat === 'cruise') newCatFields = cruiseFormHTML(null, today);
    else newCatFields = accommodationFormHTML(null, today);
    catFieldsEl.innerHTML = newCatFields;

    // Show/hide the optional name field (not for accommodation or cruise — those have their own name fields)
    const nameGroup = document.getElementById('book-name-group');
    const nameLabel = document.getElementById('book-name-label');
    if (nameGroup) {
      nameGroup.style.display = (newCat === 'accommodation' || newCat === 'cruise') ? 'none' : '';
      if (nameLabel) { const _ko = getLang() === 'ko'; nameLabel.innerHTML = (newCat === 'travel' ? (_ko ? '항공 이름' : 'Airline Name') : (_ko ? '렌트 이름' : 'Rental Name')) + ` <span class="text-muted" style="font-weight:400">${_ko ? '(선택)' : '(optional)'}</span>`; }
    }
  };

  window.__addPortCall = () => {
    _portCalls.push({ port: '', date: '', arrTime: '', depTime: '', coords: '' });
    const el = document.getElementById('cruise-port-list');
    if (el) el.innerHTML = portCallsHTML();
  };
  window.__removePortCall = (i) => {
    _portCalls.splice(i, 1);
    const el = document.getElementById('cruise-port-list');
    if (el) el.innerHTML = portCallsHTML();
  };
  window.__portCallUpdate = (i, field, value) => {
    if (_portCalls[i]) _portCalls[i][field] = value;
  };

  window.__bookAddLink = () => {
    const inp = document.getElementById('book-link-input');
    const val = inp.value.trim();
    if (!val) return;
    _links.push(val);
    inp.value = '';
    const el = document.getElementById('book-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };
  window.__bookRmLink = (i) => {
    _links.splice(i, 1);
    const el = document.getElementById('book-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };

  window.__bookImgPick = (idx) => {
    const inp = document.getElementById('book-file-input');
    if (!inp) return;
    inp.dataset.slotIdx = String(idx);
    inp.click();
  };
  window.__bookFileChange = (input) => {
    const idx = parseInt(input.dataset.slotIdx || '0', 10);
    const file = input.files[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    _imageSlots[idx] = { type: 'file', value: file, preview };
    const grid = document.getElementById('book-img-grid');
    if (grid) grid.innerHTML = accomImgGridHTML();
    input.value = '';
  };
  window.__bookImgRemove = (idx) => {
    _imageSlots[idx] = { type: 'empty', value: null, preview: null };
    const grid = document.getElementById('book-img-grid');
    if (grid) grid.innerHTML = accomImgGridHTML();
  };

  window.__saveBookItem = async (id) => {
    if (_adding) return;
    const form = document.getElementById('book-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    if (data.cost) data.cost = Number(data.cost);
    if (data.headcount) data.headcount = Number(data.headcount);
    data.links = _links;
    const cat = data.category || 'accommodation';
    const { userId, tripId } = _ctx;
    _adding = true;
    setModalSaving(true);

    try {
      // --- Accommodation: handle photos ---
      if (cat === 'accommodation') {
        const images = [];
        for (const slot of _imageSlots) {
          if (slot.type === 'file') {
            const blob = await resizeImageToBlob(slot.value);
            images.push(await uploadToImgBB(blob));
          } else if (slot.type === 'url') {
            images.push(slot.value);
          }
        }
        data.images = images;

        // Parse coords for accommodation address
        const rawCoords = data.coords?.trim();
        delete data.coords;
        let geoCoords = null;
        if (rawCoords) {
          geoCoords = parseCoords(rawCoords);
          if (geoCoords) { data.lat = geoCoords.lat; data.lng = geoCoords.lng; }
        } else if (data.address) {
          try { localStorage.removeItem(`geo_${data.address.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
          geoCoords = await geocodeCity(data.address, _tripCountry);
          if (geoCoords) { data.lat = geoCoords.lat; data.lng = geoCoords.lng; }
        }

        let savedId = id;
        if (id) {
          await updateBooking(userId, tripId, id, data);
          showToast(t('toast.booking_updated'));
        } else {
          const ref = await addBooking(userId, tripId, data);
          savedId = ref.id;
          showToast(t('toast.booking_added'));
        }

        // Expense sync
        if (data.cost) {
          await upsertLinkedExpense(userId, tripId, savedId, 'booking-accom', {
            title: `${data.name} (Stay)`,
            amount: parseFloat(data.cost),
            currency: data.currency || 'KRW',
            date: data.checkIn,
            category: 'accom',
            notes: '',
          });
        } else {
          await deleteLinkedExpense(userId, tripId, savedId, 'booking-accom');
        }

        const geoFields = geoCoords ? { lat: geoCoords.lat, lng: geoCoords.lng } : {};

        // Itinerary sync – check-in
        if (data.checkInTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'checkin', {
            title: `Check-in: ${data.name}`,
            date: data.checkIn,
            time: data.checkInTime,
            location: data.address || '',
            type: 'rest',
            links: data.links || [],
            ...geoFields,
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'checkin');
        }
        // Itinerary sync – check-out
        if (data.checkOutTime && data.checkOut) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'checkout', {
            title: `Check-out: ${data.name}`,
            date: data.checkOut,
            time: data.checkOutTime,
            location: data.address || '',
            type: 'rest',
            links: data.links || [],
            ...geoFields,
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'checkout');
        }

      } else if (cat === 'travel') {
        // Parse departure coords
        const rawDep = data.depCoords?.trim();
        delete data.depCoords;
        const rawArr = data.arrCoords?.trim();
        delete data.arrCoords;

        let depGeo = null;
        if (rawDep) {
          depGeo = parseCoords(rawDep);
          if (depGeo) { data.depLat = depGeo.lat; data.depLng = depGeo.lng; }
        } else if (data.departureAirport) {
          try { localStorage.removeItem(`geo_${data.departureAirport.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
          const geo = await geocodeCity(data.departureAirport, _tripCountry);
          if (geo) { data.depLat = geo.lat; data.depLng = geo.lng; depGeo = geo; }
        }
        let arrGeo = null;
        if (rawArr) {
          arrGeo = parseCoords(rawArr);
          if (arrGeo) { data.arrLat = arrGeo.lat; data.arrLng = arrGeo.lng; }
        } else if (data.arrivalAirport) {
          try { localStorage.removeItem(`geo_${data.arrivalAirport.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
          const geo = await geocodeCity(data.arrivalAirport, _tripCountry);
          if (geo) { data.arrLat = geo.lat; data.arrLng = geo.lng; arrGeo = geo; }
        }

        let savedId = id;
        if (id) {
          await updateBooking(userId, tripId, id, data);
          showToast(t('toast.booking_updated'));
        } else {
          const ref = await addBooking(userId, tripId, data);
          savedId = ref.id;
          showToast(t('toast.booking_added'));
        }

        // Expense sync
        if (data.cost) {
          const flightLabel = data.name || [data.airline, data.flightNo].filter(Boolean).join(' ') || 'Flight';
          await upsertLinkedExpense(userId, tripId, savedId, 'booking-travel', {
            title: flightLabel,
            amount: parseFloat(data.cost),
            currency: data.currency || 'KRW',
            date: data.departureDate,
            category: 'transport',
            notes: '',
          });
        } else {
          await deleteLinkedExpense(userId, tripId, savedId, 'booking-travel');
        }

        // Itinerary sync – departure (only if time provided)
        if (data.departureTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'departure', {
            title: `Departure: ${data.departureAirport || ''}`,
            description: data.pnr ? `${t('book.pnr')}: ${data.pnr}` : '',
            date: data.departureDate,
            time: data.departureTime,
            location: data.departureAirport || '',
            type: 'travel',
            _isFlight: true,
            links: data.links || [],
            ...(depGeo ? { lat: depGeo.lat, lng: depGeo.lng } : (data.depLat ? { lat: data.depLat, lng: data.depLng } : {})),
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'departure');
        }
        // Itinerary sync – arrival (only if time provided)
        if (data.arrivalTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'arrival', {
            title: `Arrival: ${data.arrivalAirport || ''}`,
            description: data.pnr ? `${t('book.pnr')}: ${data.pnr}` : '',
            date: data.arrivalDate,
            time: data.arrivalTime,
            location: data.arrivalAirport || '',
            type: 'travel',
            _isFlight: true,
            links: data.links || [],
            ...(arrGeo ? { lat: arrGeo.lat, lng: arrGeo.lng } : (data.arrLat ? { lat: data.arrLat, lng: data.arrLng } : {})),
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'arrival');
        }

      } else if (cat === 'rent') {
        // Parse pickup/dropoff coords
        const rawPickup = data.pickupCoords?.trim();
        delete data.pickupCoords;
        const rawDropoff = data.dropoffCoords?.trim();
        delete data.dropoffCoords;

        let pickupGeo = null;
        if (rawPickup) {
          pickupGeo = parseCoords(rawPickup);
          if (pickupGeo) { data.pickupLat = pickupGeo.lat; data.pickupLng = pickupGeo.lng; }
        } else if (data.pickupLocation) {
          try { localStorage.removeItem(`geo_${data.pickupLocation.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
          const geo = await geocodeCity(data.pickupLocation, _tripCountry);
          if (geo) { data.pickupLat = geo.lat; data.pickupLng = geo.lng; pickupGeo = geo; }
        }
        let dropoffGeo = null;
        if (rawDropoff) {
          dropoffGeo = parseCoords(rawDropoff);
          if (dropoffGeo) { data.dropoffLat = dropoffGeo.lat; data.dropoffLng = dropoffGeo.lng; }
        } else if (data.dropoffLocation) {
          try { localStorage.removeItem(`geo_${data.dropoffLocation.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
          const geo = await geocodeCity(data.dropoffLocation, _tripCountry);
          if (geo) { data.dropoffLat = geo.lat; data.dropoffLng = geo.lng; dropoffGeo = geo; }
        }

        let savedId = id;
        if (id) {
          await updateBooking(userId, tripId, id, data);
          showToast(t('toast.booking_updated'));
        } else {
          const ref = await addBooking(userId, tripId, data);
          savedId = ref.id;
          showToast(t('toast.booking_added'));
        }

        // Expense sync
        if (data.cost) {
          const rentLabel = data.name || [data.rentalCompany, data.vehicleType].filter(Boolean).join(' — ') || 'Car Rental';
          await upsertLinkedExpense(userId, tripId, savedId, 'booking-rent', {
            title: rentLabel,
            amount: parseFloat(data.cost),
            currency: data.currency || 'KRW',
            date: data.pickupDate,
            category: 'transport',
            notes: '',
          });
        } else {
          await deleteLinkedExpense(userId, tripId, savedId, 'booking-rent');
        }

        // Itinerary sync – pickup (only if time provided)
        if (data.pickupTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'pickup', {
            title: `Pickup: ${data.name || [data.rentalCompany, data.vehicleType].filter(Boolean).join(' — ') || data.pickupLocation}`,
            date: data.pickupDate,
            time: data.pickupTime,
            location: data.pickupLocation || '',
            type: 'travel',
            _isFlight: false,
            links: data.links || [],
            ...(pickupGeo ? { lat: pickupGeo.lat, lng: pickupGeo.lng } : (data.pickupLat ? { lat: data.pickupLat, lng: data.pickupLng } : {})),
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'pickup');
        }
        // Itinerary sync – dropoff (only if time provided)
        if (data.dropoffTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'dropoff', {
            title: `Dropoff: ${data.name || [data.rentalCompany, data.vehicleType].filter(Boolean).join(' — ') || data.dropoffLocation}`,
            date: data.dropoffDate,
            time: data.dropoffTime,
            location: data.dropoffLocation || '',
            type: 'travel',
            _isFlight: false,
            links: data.links || [],
            ...(dropoffGeo ? { lat: dropoffGeo.lat, lng: dropoffGeo.lng } : (data.dropoffLat ? { lat: data.dropoffLat, lng: data.dropoffLng } : {})),
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'dropoff');
        }

      } else if (cat === 'cruise') {
        // Handle photos (same as accommodation)
        const cruiseImages = [];
        for (const slot of _imageSlots) {
          if (slot.type === 'file') {
            const blob = await resizeImageToBlob(slot.value);
            cruiseImages.push(await uploadToImgBB(blob));
          } else if (slot.type === 'url') {
            cruiseImages.push(slot.value);
          }
        }
        data.images = cruiseImages;

        // Collect port calls — parse optional coords
        data.portCalls = _portCalls.filter(p => p.port?.trim()).map(p => {
          const geo = parseCoords(p.coords);
          return {
            port: p.port.trim(),
            date: p.date || '',
            arrTime: p.arrTime || '',
            depTime: p.depTime || '',
            ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
          };
        });
        // name is derived — store ship + line for display/expense label
        if (!data.name) data.name = [data.cruiseLine, data.shipName].filter(Boolean).join(' — ') || null;

        let savedId = id;
        if (id) {
          await updateBooking(userId, tripId, id, data);
          showToast(t('toast.booking_updated'));
        } else {
          const ref = await addBooking(userId, tripId, data);
          savedId = ref.id;
          showToast(t('toast.booking_added'));
        }

        // Expense sync
        if (data.cost) {
          await upsertLinkedExpense(userId, tripId, savedId, 'booking-cruise', {
            title: data.name || data.shipName || 'Cruise',
            amount: parseFloat(data.cost),
            currency: data.currency || 'KRW',
            date: data.embarkDate,
            category: 'accom',
            notes: '',
          });
        } else {
          await deleteLinkedExpense(userId, tripId, savedId, 'booking-cruise');
        }

        // Itinerary — embarkation
        if (data.embarkTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'embark', {
            title: `Embark: ${data.shipName || 'Cruise'}`,
            date: data.embarkDate,
            time: data.embarkTime,
            location: data.embarkPort || '',
            type: 'travel',
            _isFlight: false,
            links: data.links || [],
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'embark');
        }

        // Itinerary — port calls (arrival time used for itin; up to 20 slots)
        for (let pi = 0; pi < 20; pi++) {
          const pc = data.portCalls?.[pi];
          if (pc && pc.port && pc.date && pc.arrTime) {
            await upsertLinkedItinItem(userId, tripId, savedId, 'booking', `port-${pi}`, {
              title: pc.port,
              date: pc.date,
              time: pc.arrTime,
              location: pc.port,
              type: 'activity',
              links: [],
              ...(pc.lat && pc.lng ? { lat: pc.lat, lng: pc.lng } : {}),
            });
          } else {
            await deleteLinkedItinItem(userId, tripId, savedId, 'booking', `port-${pi}`);
          }
        }

        // Itinerary — disembarkation
        if (data.disembarkTime) {
          await upsertLinkedItinItem(userId, tripId, savedId, 'booking', 'disembark', {
            title: `Disembark: ${data.shipName || 'Cruise'}`,
            date: data.disembarkDate,
            time: data.disembarkTime,
            location: data.disembarkPort || '',
            type: 'travel',
            _isFlight: false,
            links: data.links || [],
          });
        } else {
          await deleteLinkedItinItem(userId, tripId, savedId, 'booking', 'disembark');
        }
      }

      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    } finally { _adding = false; }
  };

  window.__deleteBookItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Booking', 'This cannot be undone.');
    if (!confirmed) return;
    const { userId, tripId } = _ctx;
    try {
      await Promise.all([
        deleteLinkedExpense(userId, tripId, id, 'booking-accom'),
        deleteLinkedExpense(userId, tripId, id, 'booking-travel'),
        deleteLinkedExpense(userId, tripId, id, 'booking-rent'),
        deleteLinkedExpense(userId, tripId, id, 'booking-cruise'),
        deleteLinkedItinItems(userId, tripId, id, 'booking'),
      ]);
      await deleteBooking(userId, tripId, id);
      showToast(t('toast.booking_deleted'));
    } catch (e) { showToast('Error: ' + e.message); }
  };
}


function addFAB(onClick) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.dataset.route = 'booking';
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  fab.addEventListener('click', onClick);
  document.getElementById('app').appendChild(fab);
}

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">📋</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
