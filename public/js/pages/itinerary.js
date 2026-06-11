import { t, getLang } from '../i18n.js';
import { subscribeItinerary, addItineraryItem, updateItineraryItem, deleteItineraryItem, getTrip, getBookings, getActivities } from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving, escapeHtml, skeletonHTML } from '../app.js';
import { geocodeCity } from '../weather.js';
import { initMap, destroyMap } from '../map.js';

let _unsub = null;
let _ctx = null;
let _tripStartDate = null;
let _links = [];
let _tripCountry = '';
let _map = null;
let _mapItems = [];
let _activeTab = 'schedule';
let _geoCache = {};
let _accomItems = null;
let _actItems = null;
let _tripEndDate = null;
let _calBookings = [];
let _calItems = [];
let _calMonth = null;       // 'YYYY-MM' currently displayed
let _calCollapsed = false;

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  if (_map) { destroyMap(_map); _map = null; }
  _accomItems = null;
  _actItems = null;
  _calBookings = [];
  _calItems = [];
  _calMonth = null;
}

const TYPE_ICONS = { home: '🏠', travel: '✈️', rest: '🏨', meal: '🍽️', activity: '⚡', shopping: '🛍️', other: '📌' };

function itemIcon(item) {
  if (item._isCruise) return '⛴️';
  return TYPE_ICONS[item.type] || '📌';
}
const TYPE_COLORS = { home: 'var(--muted)', travel: 'var(--sky)', rest: 'var(--mint)', meal: 'var(--sun)', activity: 'var(--accent)', shopping: 'var(--sky)', other: 'var(--muted)' };
const TYPE_COLORS_HEX = {
  travel:   '#1565C0',
  rest:     '#2E7D32',
  meal:     '#BF360C',
  activity: '#AD1457',
  shopping: '#4A148C',
  other:    '#37474F',
};

export async function render(container, ctx) {
  _ctx = ctx;
  _tripStartDate = ctx.tripStartDate || null;
  _tripEndDate = ctx.tripEndDate || null;
  _activeTab = 'schedule';
  _geoCache = {};
  _calBookings = [];
  _calItems = [];
  _calMonth = null;
  const { userId, tripId, isGuest } = ctx;
  getTrip(userId, tripId).then(tr => { _tripCountry = tr?.country || ''; }).catch(() => {});

  if (!tripId) {
    container.innerHTML = noTripHTML();
    return;
  }

  container.innerHTML = `
    <div style="padding:14px 16px 8px" class="row-between">
      <div>
        <div class="eyebrow" style="margin-bottom:2px">${t('nav.itinerary')}</div>
        <div class="page-title">${t('itin.title')}</div>
      </div>
    </div>
    <div class="itin-tab-bar" id="itin-tabs">
      <button class="itin-tab active" data-tab="schedule">📋 ${t('itin.tab_schedule')}</button>
      <button class="itin-tab" data-tab="map">🗺️ ${t('itin.tab_map')}</button>
    </div>
    <div id="itin-schedule">
      <div id="itin-calendar"></div>
      <div id="itin-list">${skeletonHTML()}</div>
      <div style="height:80px"></div>
    </div>
    <div id="itin-map-view" style="display:none;position:relative">
      <div id="itin-map" class="itin-map-wrap"></div>
      <div id="itin-map-popup" class="itin-map-popup" style="display:none"></div>
    </div>`;

  document.getElementById('itin-tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]')?.dataset?.tab;
    if (!tab || tab === _activeTab) return;
    _activeTab = tab;
    document.querySelectorAll('.itin-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('itin-schedule').style.display = tab === 'schedule' ? '' : 'none';
    document.getElementById('itin-map-view').style.display = tab === 'map' ? '' : 'none';
    if (tab === 'map') renderMap(_mapItems);
  });

  if (!isGuest) addFAB(container, () => openItemModal(null));

  getBookings(userId, tripId).then(b => { _calBookings = b || []; renderCalendar(); }).catch(() => {});

  window.__calToggle = () => { _calCollapsed = !_calCollapsed; renderCalendar(); };
  window.__calNav = (delta) => {
    const { months } = calRange();
    const next = months.indexOf(_calMonth) + delta;
    if (next < 0 || next >= months.length) return;
    _calMonth = months[next];
    renderCalendar();
  };
  window.__calDay = (ds) => openCalDayModal(ds);

  if (_unsub) _unsub();
  _unsub = subscribeItinerary(userId, tripId, items => {
    _mapItems = items;
    _calItems = items;
    window.__editItinItem = (id) => {
      if (_ctx.isGuest) return;
      const item = _mapItems.find(i => i.id === id);
      if (item) openItemModal(item);
    };
    renderList(items);
    renderCalendar();
    if (_activeTab === 'map') renderMap(items);
  }, (err) => {
    const el = document.getElementById('itin-list');
    if (el) el.innerHTML = `<div class="empty-state" style="margin-top:40px"><div class="empty-icon">⚠️</div><div class="empty-sub">${err.message}</div></div>`;
  });
}

function renderList(items) {
  const el = document.getElementById('itin-list');
  if (!el) return;

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">📅</div>
      <div class="empty-title">${t('common.empty')}</div>
      <div class="empty-sub">${t('itin.no_events')}</div>
    </div>`;
    return;
  }

  const byDate = {};
  items.forEach(item => {
    const d = item.date || 'No Date';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(item);
  });

  const dates = Object.keys(byDate).sort();
  const today = new Date().toISOString().slice(0, 10);

  el.innerHTML = dates.map(date => {
    const dayItems = byDate[date];
    const label = formatDateLabel(date, today);
    return `
      <div class="timeline-date">
        <div class="eyebrow">${label}</div>
      </div>
      ${dayItems.map((item, idx) => `
        <div class="timeline-item">
          <div class="timeline-aside">
            <div class="timeline-time">${item.time || ''}</div>
            <div class="timeline-dot" style="background:${TYPE_COLORS[item.type] || 'var(--accent)'}"></div>
            ${idx < dayItems.length - 1 ? '<div class="timeline-line"></div>' : ''}
          </div>
          <div style="flex:1;padding-bottom:10px">
            <div class="timeline-card" ${_ctx?.isGuest ? '' : `onclick="window.__editItinItem('${item.id}')"`}>
              <div class="row gap-8" style="margin-bottom:4px">
                <span>${itemIcon(item)}</span>
                <span class="text-sm font-medium">${escapeHtml(item.title) || '—'}</span>
                <span class="badge badge-muted" style="margin-left:auto;font-size:10px">${item.type === 'rest' ? 'accommodation' : (item.type || 'other')}</span>
              </div>
              ${item.location ? `<div class="text-xs text-muted">📍 ${escapeHtml(item.location)}</div>` : ''}
              ${item.description ? `<div class="text-sm" style="color:var(--cream-dim);margin-top:4px">${escapeHtml(item.description)}</div>` : ''}
              ${(item.links || []).length > 0 ? `<div class="row gap-6" style="margin-top:4px;flex-wrap:wrap">${item.links.map(u => `<a href="${u}" target="_blank" rel="noopener" class="text-xs" style="color:var(--sky)" onclick="event.stopPropagation()">🔗 Link</a>`).join('')}</div>` : ''}
            </div>
          </div>
        </div>`).join('')}`;
  }).join('');
}

// ── Monthly Calendar ─────────────────────────────────────────────
function addMonth(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function bookingRange(b) {
  const cat = b.category || 'accommodation';
  let start, end, color;
  if (cat === 'accommodation') { start = b.checkIn;       end = b.checkOut || b.checkIn;        color = 'var(--mint)'; }
  else if (cat === 'travel')   { start = b.departureDate; end = b.arrivalDate || b.departureDate; color = 'var(--sky)'; }
  else if (cat === 'rent')     { start = b.pickupDate;    end = b.dropoffDate || b.pickupDate;   color = 'var(--sun)'; }
  else if (cat === 'cruise')   { start = b.embarkDate;    end = b.disembarkDate || b.embarkDate; color = 'var(--accent)'; }
  else return null;
  if (!start) return null;
  return { start, end: end || start, color, cat, label: b.name || b.shipName || cat };
}

function calBookingRanges() {
  return (_calBookings || []).map(bookingRange).filter(Boolean);
}

function calRange() {
  const dates = [];
  if (_tripStartDate) dates.push(_tripStartDate);
  if (_tripEndDate) dates.push(_tripEndDate);
  if (dates.length < 2) {
    _calItems.forEach(i => { if (i.date) dates.push(i.date); });
    calBookingRanges().forEach(r => { dates.push(r.start); if (r.end) dates.push(r.end); });
  }
  if (dates.length === 0) dates.push(new Date().toISOString().slice(0, 10));
  dates.sort();
  const startYM = dates[0].slice(0, 7);
  const endYM = dates[dates.length - 1].slice(0, 7);
  const months = [];
  let cur = startYM;
  for (let i = 0; i < 120 && cur <= endYM; i++) { months.push(cur); cur = addMonth(cur, 1); }
  return { startYM, endYM, months };
}

function renderCalendar() {
  const host = document.getElementById('itin-calendar');
  if (!host) return;
  const { months } = calRange();
  if (months.length === 0) { host.innerHTML = ''; return; }

  const today = new Date().toISOString().slice(0, 10);
  const todayYM = today.slice(0, 7);
  if (!_calMonth || !months.includes(_calMonth)) {
    _calMonth = months.includes(todayYM) ? todayYM : months[0];
  }

  const idx = months.indexOf(_calMonth);
  const [year, month] = _calMonth.split('-').map(Number); // month 1-12
  const monthNames = t('cal.months');
  const weekdays = t('cal.weekdays');
  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const chevron = _calCollapsed ? '▸' : '▾';

  let html = `
    <div class="cal-wrap">
      <div class="cal-head" onclick="window.__calToggle()">
        <span class="eyebrow">📅 ${t('cal.title')}</span>
        <span class="cal-chevron">${chevron}</span>
      </div>`;

  if (!_calCollapsed) {
    const startWeekday = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month, 0).getDate();

    const itemsByDay = {};
    _calItems.forEach(it => {
      if (it.date && it.date.slice(0, 7) === _calMonth) {
        (itemsByDay[it.date] = itemsByDay[it.date] || []).push(it);
      }
    });
    const ranges = calBookingRanges();

    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell out"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${_calMonth}-${String(d).padStart(2, '0')}`;
      const dayItems = itemsByDay[ds] || [];
      const dayRanges = ranges.filter(r => ds >= r.start && ds <= r.end);
      const isToday = ds === today;
      const iconSet = [...new Set(dayItems.map(i => TYPE_ICONS[i.type] || '📌'))].slice(0, 3).join('');
      const bars = dayRanges.slice(0, 3).map(r => `<div class="cal-bar" style="background:${r.color}"></div>`).join('');
      const tappable = dayItems.length > 0 || dayRanges.length > 0;
      cells += `
        <div class="cal-cell${isToday ? ' today' : ''}${tappable ? ' has' : ''}" ${tappable ? `onclick="window.__calDay('${ds}')"` : ''}>
          <div class="cal-num">${d}</div>
          ${iconSet ? `<div class="cal-icons">${iconSet}</div>` : ''}
          ${bars ? `<div class="cal-bars">${bars}</div>` : ''}
        </div>`;
    }

    html += `
      <div class="cal-nav">
        <button class="cal-arrow" ${idx <= 0 ? 'disabled' : ''} onclick="window.__calNav(-1)">‹</button>
        <span class="cal-month">${monthLabel}</span>
        <button class="cal-arrow" ${idx >= months.length - 1 ? 'disabled' : ''} onclick="window.__calNav(1)">›</button>
      </div>
      <div class="cal-grid">
        ${weekdays.map((w, i) => `<div class="cal-weekday${i === 0 ? ' sun' : ''}">${w}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells}</div>`;
  }

  html += `</div>`;
  host.innerHTML = html;
}

function openCalDayModal(ds) {
  const dayItems = _calItems.filter(i => i.date === ds)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dayRanges = calBookingRanges().filter(r => ds >= r.start && ds <= r.end);
  let body = '';
  if (dayRanges.length > 0) {
    body += `<div class="eyebrow" style="margin-bottom:6px">${t('cal.bookings')}</div>`;
    body += dayRanges.map(r => `
      <div class="row gap-8" style="margin-bottom:8px;align-items:center">
        <span style="background:${r.color};width:14px;height:14px;border-radius:4px;flex-shrink:0"></span>
        <span class="text-sm font-medium">${r.label}</span>
        <span class="badge badge-muted" style="margin-left:auto;font-size:10px">${r.cat}</span>
      </div>`).join('');
  }
  if (dayItems.length > 0) {
    body += `<div class="eyebrow" style="margin:12px 0 6px">${t('cal.events')}</div>`;
    body += dayItems.map(it => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line-soft)">
        <div class="row gap-8" style="align-items:center">
          <span>${TYPE_ICONS[it.type] || '📌'}</span>
          <span class="text-sm font-medium">${escapeHtml(it.title) || '—'}</span>
          ${it.time ? `<span class="text-xs text-muted" style="margin-left:auto">${it.time}</span>` : ''}
        </div>
        ${it.location ? `<div class="text-xs text-muted" style="margin-top:2px">📍 ${escapeHtml(it.location)}</div>` : ''}
        ${it.description ? `<div class="text-sm" style="color:var(--cream-dim);margin-top:2px">${escapeHtml(it.description)}</div>` : ''}
      </div>`).join('');
  }
  if (!body) body = `<div class="text-sm text-muted">${t('cal.no_items')}</div>`;
  openModal({
    title: formatDate(ds),
    body,
    footer: `<button class="btn btn-ghost btn-full" onclick="window.__closeModal()">${t('common.done')}</button>`,
  });
}

async function renderMap(itinItems) {
  const mapEl = document.getElementById('itin-map');
  if (!mapEl) return;

  if (_map) { destroyMap(_map); _map = null; }

  // Load accommodation and activities once per trip
  if (_accomItems === null) {
    [_accomItems, _actItems] = await Promise.all([
      getBookings(_ctx.userId, _ctx.tripId).catch(() => []),
      getActivities(_ctx.userId, _ctx.tripId).catch(() => []),
    ]);
  }

  // Identify first/last itinerary date to exclude home-side airports from map
  const itinDates = [...new Set(itinItems.map(i => i.date).filter(Boolean))].sort();
  const firstDate = itinDates[0];
  const lastDate  = itinDates[itinDates.length - 1];
  const multiDay  = itinDates.length >= 2 && firstDate !== lastDate;

  // Deduplicate ghost linked items: pre-v1.2.1 items had sourceType='accommodation';
  // v1.2.1+ uses sourceType='booking'. For the same sourceId+sourceSubType keep 'booking'.
  const linkedItemMap = new Map();
  const nonLinkedItems = [];
  for (const item of itinItems) {
    if (item.sourceId && item.sourceSubType) {
      const key = `${item.sourceId}:${item.sourceSubType}`;
      if (!linkedItemMap.has(key) || item.sourceType === 'booking') {
        linkedItemMap.set(key, item);
      }
    } else {
      nonLinkedItems.push(item);
    }
  }
  const dedupedItems = [...nonLinkedItems, ...linkedItemMap.values()];

  // Skip _accomItems / _actItems already represented by linked itinerary markers
  // Include old sourceType='accommodation' so a 3rd marker isn't added from _accomItems
  const linkedBookingIds = new Set(
    dedupedItems.filter(i => (i.sourceType === 'booking' || i.sourceType === 'accommodation') && i.sourceId).map(i => i.sourceId)
  );
  const linkedActivityIds = new Set(
    dedupedItems.filter(i => i.sourceType === 'activity' && i.sourceId).map(i => i.sourceId)
  );

  const markerCandidates = [
    ...dedupedItems.filter(i => {
      if ((!i.location && (!i.lat || !i.lng)) || i.type === 'home') return false;
      if (multiDay && i.type === 'travel' && (i.date === firstDate || i.date === lastDate)) return false;
      return true;
    }).map(i => ({
      id: i.id, source: 'itin', type: i.type,
      title: i.title, location: i.location,
      lat: i.lat ? parseFloat(i.lat) : 0,
      lng: i.lng ? parseFloat(i.lng) : 0,
      date: i.date, time: i.time, description: i.description,
      _isCruise: i._isCruise,
    })),
    ..._accomItems.filter(a => a.address && (!a.category || a.category === 'accommodation') && !linkedBookingIds.has(a.id)).map(a => ({
      id: a.id, source: 'accom', type: 'rest',
      title: a.name, location: a.address,
      lat: 0, lng: 0,
      date: a.checkIn, time: a.checkInTime, description: a.notes,
      checkOut: a.checkOut,
    })),
    ..._actItems.filter(a => a.location && !linkedActivityIds.has(a.id)).map(a => ({
      id: a.id, source: 'activity', type: 'activity',
      title: a.name, location: a.location,
      lat: 0, lng: 0,
      date: a.date, time: a.time, description: a.notes,
      category: a.category,
    })),
  ];

  if (markerCandidates.length === 0) {
    mapEl.innerHTML = `<div class="empty-state" style="padding-top:60px">
      <div class="empty-icon">🗺️</div>
      <div class="empty-title">No locations</div>
      <div class="empty-sub">Add locations to events, stays, or activities to see them on the map</div>
    </div>`;
    return;
  }

  mapEl.innerHTML = `<div class="loading-center" style="height:100%"><div class="spinner"></div></div>`;

  // Geocode items without stored coordinates
  const resolved = [];
  for (const item of markerCandidates) {
    let { lat, lng } = item;
    if (!lat || !lng) {
      const key = item.location;
      if (_geoCache[key]) {
        ({ lat, lng } = _geoCache[key]);
      } else {
        try {
          const geo = await geocodeCity(item.location, _tripCountry);
          if (geo) { lat = geo.lat; lng = geo.lng; _geoCache[key] = { lat, lng }; }
        } catch (_) {}
      }
    }
    if (lat && lng) resolved.push({ ...item, lat, lng });
  }

  if (resolved.length === 0) {
    mapEl.innerHTML = `<div class="empty-state" style="padding-top:60px">
      <div class="empty-icon">🗺️</div>
      <div class="empty-title">Locations not found</div>
      <div class="empty-sub">Could not resolve addresses to coordinates</div>
    </div>`;
    return;
  }

  mapEl.innerHTML = '';
  _map = await initMap('itin-map', resolved[0].lat, resolved[0].lng, 12);

  const { Feature } = window.ol;
  const { Point } = window.ol.geom;
  const { Vector: VectorLayer } = window.ol.layer;
  const { Vector: VectorSource } = window.ol.source;
  const { Style, Icon } = window.ol.style;
  const { fromLonLat } = window.ol.proj;

  const features = resolved.map(item => {
    const color = TYPE_COLORS_HEX[item.type] || '#37474F';
    const emoji = TYPE_ICONS[item.type] || '📌';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path fill="rgba(0,0,0,0.25)" d="M18 2C11.4 2 6 7.4 6 14c0 9 12 26 12 26S30 23 30 14C30 7.4 24.6 2 18 2z" transform="translate(2,3)"/>
      <path fill="${color}" stroke="#fff" stroke-width="1.5" d="M18 0C11.4 0 6 5.4 6 12c0 9 12 26 12 26S30 21 30 12C30 5.4 24.6 0 18 0z"/>
      <circle fill="#fff" cx="18" cy="12" r="9"/>
      <text x="18" y="16" text-anchor="middle" font-size="11" font-family="sans-serif">${emoji}</text>
    </svg>`;
    const feature = new Feature({
      geometry: new Point(fromLonLat([item.lng, item.lat])),
      item,
    });
    feature.setStyle(new Style({
      image: new Icon({
        src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
        anchor: [0.5, 1],
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
      }),
    }));
    return feature;
  });

  const source = new VectorSource({ features });
  _map.addLayer(new VectorLayer({ source }));

  if (resolved.length > 1) {
    _map.getView().fit(source.getExtent(), { padding: [48, 32, 48, 32], maxZoom: 14, duration: 400 });
  }

  setTimeout(() => _map && _map.updateSize(), 100);

  _map.on('click', evt => {
    const popupEl = document.getElementById('itin-map-popup');
    if (!popupEl) return;
    const feature = _map.forEachFeatureAtPixel(evt.pixel, f => f, { hitTolerance: 8 });
    if (!feature) { popupEl.style.display = 'none'; return; }
    const item = feature.get('item');
    if (!item) return;

    let badge = '', meta = '', actions = '';

    if (item.source === 'accom') {
      badge = `<span class="badge badge-muted" style="margin-left:auto;font-size:10px">🏨 Stay</span>`;
      meta = `${item.date ? `<div class="text-xs text-muted" style="margin-bottom:3px">📅 ${item.date}${item.checkOut ? ' → ' + item.checkOut : ''}</div>` : ''}
              ${item.location ? `<div class="text-xs text-muted" style="margin-bottom:3px">📍 ${escapeHtml(item.location)}</div>` : ''}`;
    } else if (item.source === 'activity') {
      badge = `<span class="badge badge-muted" style="margin-left:auto;font-size:10px">⚡ Activity</span>`;
      meta = `${item.date ? `<div class="text-xs text-muted" style="margin-bottom:3px">📅 ${item.date}${item.time ? ' · ' + item.time : ''}</div>` : ''}
              ${item.category ? `<div class="text-xs text-muted" style="margin-bottom:3px">🏷️ ${item.category}</div>` : ''}
              ${item.location ? `<div class="text-xs text-muted" style="margin-bottom:3px">📍 ${escapeHtml(item.location)}</div>` : ''}`;
    } else {
      const typeLabel = item.type === 'rest' ? 'Accommodation' : (item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : 'Other');
      badge = `<span class="badge badge-muted" style="margin-left:auto;font-size:10px">${typeLabel}</span>`;
      meta = `${item.date ? `<div class="text-xs text-muted" style="margin-bottom:3px">📅 ${item.date}${item.time ? ' · ' + item.time : ''}</div>` : ''}
              ${item.location ? `<div class="text-xs text-muted" style="margin-bottom:3px">📍 ${escapeHtml(item.location)}</div>` : ''}`;
      if (!_ctx?.isGuest) actions = `<button class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%" onclick="window.__editItinItem('${item.id}');document.getElementById('itin-map-popup').style.display='none'">✏️ Edit</button>`;
    }

    popupEl.innerHTML = `
      <div class="itin-map-popup-inner">
        <button class="itin-map-popup-close" onclick="document.getElementById('itin-map-popup').style.display='none'">×</button>
        <div class="row gap-8" style="margin-bottom:6px">
          <span>${itemIcon(item)}</span>
          <span class="text-sm font-medium">${escapeHtml(item.title) || '—'}</span>
          ${badge}
        </div>
        ${meta}
        ${item.description ? `<div class="text-sm" style="color:var(--cream-dim);margin-top:6px">${escapeHtml(item.description)}</div>` : ''}
        ${actions}
      </div>`;
    popupEl.style.display = 'block';
  });

  _map.on('pointermove', evt => {
    const hit = _map.hasFeatureAtPixel(evt.pixel, { hitTolerance: 8 });
    _map.getViewport().style.cursor = hit ? 'pointer' : '';
  });
}

function linkListHTML(links) {
  return (links || []).map((url, i) => `
    <div class="link-item">
      <a href="${url}" target="_blank" rel="noopener">${url}</a>
      <button type="button" class="link-item-del" onclick="window.__itinRmLink(${i})">×</button>
    </div>`).join('');
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = _tripStartDate || new Date().toISOString().slice(0, 10);
  const types = ['home', 'travel', 'rest', 'meal', 'activity', 'shopping', 'other'];
  _links = item?.links ? [...item.links] : [];

  openModal({
    title: isEdit ? t('modal.edit_event') : t('itin.add'),
    body: `
      <form id="itin-form">
        <div class="form-group">
          <label class="form-label">${t('itin.event_title')} *</label>
          <input class="form-input" name="title" value="${escapeHtml(item?.title)}" placeholder="e.g. Airport transfer" required>
        </div>
        <div class="form-group">
          <label class="form-label">${t('itin.type')}</label>
          <select class="form-select" name="type">
            ${types.map(tp => {
              let label = tp.charAt(0).toUpperCase() + tp.slice(1);
              if (tp === 'rest') label = 'Accommodation';
              return `<option value="${tp}" ${item?.type === tp ? 'selected' : ''}>${TYPE_ICONS[tp]} ${label}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${t('itin.date')}</label>
            <input class="form-input" name="date" type="date" value="${item?.date || today}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('itin.time')}</label>
            <input class="form-input" name="time" type="time" value="${item?.time || ''}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('itin.location')}</label>
          <input class="form-input" name="location" value="${escapeHtml(item?.location)}" placeholder="e.g. Narita Airport">
        </div>
        <div class="form-group" style="margin-top:-4px">
          <label class="form-label" style="font-size:0.7rem;color:var(--muted)">${t('book.coords')} <span style="font-weight:400">(${t('book.coords_hint')})</span></label>
          <input class="form-input" name="coords" value="${item?.lat && item?.lng ? `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}` : ''}" placeholder="e.g. -25.989, 28.005" autocomplete="off" style="font-size:0.8rem">
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.links')}</label>
          <div class="link-list" id="itin-link-list">${linkListHTML(_links)}</div>
          <div class="link-add-row">
            <input class="form-input" id="itin-link-input" placeholder="https://..." type="url">
            <button type="button" class="btn btn-secondary btn-sm link-add-btn" onclick="window.__itinAddLink()">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('itin.notes')}</label>
          <textarea class="form-textarea" name="description" placeholder="Additional notes…">${escapeHtml(item?.description)}</textarea>
        </div>
      </form>`,
    footer: `
      ${isEdit ? `<button class="btn btn-danger" onclick="window.__deleteItinItem('${item.id}')">${t('common.delete')}</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveItinItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}
      </button>`
  });

  window.__itinAddLink = () => {
    const inp = document.getElementById('itin-link-input');
    const val = inp.value.trim();
    if (!val) return;
    _links.push(val);
    inp.value = '';
    const el = document.getElementById('itin-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };
  window.__itinRmLink = (i) => {
    _links.splice(i, 1);
    const el = document.getElementById('itin-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };

  window.__saveItinItem = async (id) => {
    const form = document.getElementById('itin-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    data.links = _links;
    const rawCoords = data.coords?.trim();
    delete data.coords;
    setModalSaving(true);
    try {
      if (rawCoords) {
        const parts = rawCoords.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          data.lat = parts[0];
          data.lng = parts[1];
        }
      } else if (data.location) {
        try { localStorage.removeItem(`geo_${data.location.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
        const geo = await geocodeCity(data.location, _tripCountry);
        if (geo) { data.lat = geo.lat; data.lng = geo.lng; }
      }
      if (id) {
        await updateItineraryItem(_ctx.userId, _ctx.tripId, id, data);
        showToast(t('toast.event_updated'));
      } else {
        await addItineraryItem(_ctx.userId, _ctx.tripId, data);
        showToast(t('toast.event_added'));
      }
      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    }
  };

  window.__deleteItinItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Event', 'This cannot be undone.');
    if (!confirmed) return;
    try {
      await deleteItineraryItem(_ctx.userId, _ctx.tripId, id);
      showToast(t('toast.event_deleted'));
    } catch (e) { showToast('Error: ' + e.message); }
  };
}

function addFAB(container, onClick) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  fab.dataset.route = 'itinerary';
  fab.addEventListener('click', onClick);
  document.getElementById('app').appendChild(fab);
}

function formatDateLabel(date, today) {
  if (date === today) return 'Today · ' + formatDate(date);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (date === tomorrow) return 'Tomorrow · ' + formatDate(date);
  return formatDate(date);
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'No Date') return dateStr;
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (_) { return dateStr; }
}

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">📅</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
