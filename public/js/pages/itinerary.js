import { t } from '../i18n.js';
import { subscribeItinerary, addItineraryItem, updateItineraryItem, deleteItineraryItem, getTrip, getAccommodation, getActivities } from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving } from '../app.js';
import { geocodeCity } from '../weather.js';
import { initMap, destroyMap } from '../map.js';

let _unsub = null;
let _ctx = null;
let _links = [];
let _tripCountry = '';
let _map = null;
let _mapItems = [];
let _activeTab = 'schedule';
let _geoCache = {};
let _accomItems = null;
let _actItems = null;

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  if (_map) { destroyMap(_map); _map = null; }
  _accomItems = null;
  _actItems = null;
}

const TYPE_ICONS = { home: '🏠', travel: '✈️', rest: '🏨', meal: '🍽️', activity: '⚡', shopping: '🛍️', other: '📌' };
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
  _activeTab = 'schedule';
  _geoCache = {};
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
      <div id="itin-list"><div class="loading-center"><div class="spinner"></div></div></div>
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

  if (_unsub) _unsub();
  _unsub = subscribeItinerary(userId, tripId, items => {
    _mapItems = items;
    window.__editItinItem = (id) => {
      if (_ctx.isGuest) return;
      const item = _mapItems.find(i => i.id === id);
      if (item) openItemModal(item);
    };
    renderList(items);
    if (_activeTab === 'map') renderMap(items);
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
                <span>${TYPE_ICONS[item.type] || '📌'}</span>
                <span class="text-sm font-medium">${item.title || '—'}</span>
                <span class="badge badge-muted" style="margin-left:auto;font-size:10px">${item.type === 'rest' ? 'accommodation' : (item.type || 'other')}</span>
              </div>
              ${item.location ? `<div class="text-xs text-muted">📍 ${item.location}</div>` : ''}
              ${item.description ? `<div class="text-sm" style="color:var(--cream-dim);margin-top:4px">${item.description}</div>` : ''}
              ${(item.links || []).length > 0 ? `<div class="row gap-6" style="margin-top:4px;flex-wrap:wrap">${item.links.map(u => `<a href="${u}" target="_blank" rel="noopener" class="text-xs" style="color:var(--sky)" onclick="event.stopPropagation()">🔗 Link</a>`).join('')}</div>` : ''}
            </div>
          </div>
        </div>`).join('')}`;
  }).join('');
}

async function renderMap(itinItems) {
  const mapEl = document.getElementById('itin-map');
  if (!mapEl) return;

  if (_map) { destroyMap(_map); _map = null; }

  // Load accommodation and activities once per trip
  if (_accomItems === null) {
    [_accomItems, _actItems] = await Promise.all([
      getAccommodation(_ctx.userId, _ctx.tripId).catch(() => []),
      getActivities(_ctx.userId, _ctx.tripId).catch(() => []),
    ]);
  }

  // Identify first/last itinerary date to exclude home-side airports from map
  const itinDates = [...new Set(itinItems.map(i => i.date).filter(Boolean))].sort();
  const firstDate = itinDates[0];
  const lastDate  = itinDates[itinDates.length - 1];
  const multiDay  = itinDates.length >= 2 && firstDate !== lastDate;

  // Merge all sources — exclude home type; also skip travel events on first/last day
  const markerCandidates = [
    ...itinItems.filter(i => {
      if (!i.location || i.type === 'home') return false;
      if (multiDay && i.type === 'travel' && (i.date === firstDate || i.date === lastDate)) return false;
      return true;
    }).map(i => ({
      id: i.id, source: 'itin', type: i.type,
      title: i.title, location: i.location,
      lat: i.lat ? parseFloat(i.lat) : 0,
      lng: i.lng ? parseFloat(i.lng) : 0,
      date: i.date, time: i.time, description: i.description,
    })),
    ..._accomItems.filter(a => a.address).map(a => ({
      id: a.id, source: 'accom', type: 'rest',
      title: a.name, location: a.address,
      lat: 0, lng: 0,
      date: a.checkIn, time: a.checkInTime, description: a.notes,
      checkOut: a.checkOut,
    })),
    ..._actItems.filter(a => a.location).map(a => ({
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
              ${item.location ? `<div class="text-xs text-muted" style="margin-bottom:3px">📍 ${item.location}</div>` : ''}`;
    } else if (item.source === 'activity') {
      badge = `<span class="badge badge-muted" style="margin-left:auto;font-size:10px">⚡ Activity</span>`;
      meta = `${item.date ? `<div class="text-xs text-muted" style="margin-bottom:3px">📅 ${item.date}${item.time ? ' · ' + item.time : ''}</div>` : ''}
              ${item.category ? `<div class="text-xs text-muted" style="margin-bottom:3px">🏷️ ${item.category}</div>` : ''}
              ${item.location ? `<div class="text-xs text-muted" style="margin-bottom:3px">📍 ${item.location}</div>` : ''}`;
    } else {
      const typeLabel = item.type === 'rest' ? 'Accommodation' : (item.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : 'Other');
      badge = `<span class="badge badge-muted" style="margin-left:auto;font-size:10px">${typeLabel}</span>`;
      meta = `${item.date ? `<div class="text-xs text-muted" style="margin-bottom:3px">📅 ${item.date}${item.time ? ' · ' + item.time : ''}</div>` : ''}
              ${item.location ? `<div class="text-xs text-muted" style="margin-bottom:3px">📍 ${item.location}</div>` : ''}`;
      if (!_ctx?.isGuest) actions = `<button class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%" onclick="window.__editItinItem('${item.id}');document.getElementById('itin-map-popup').style.display='none'">✏️ Edit</button>`;
    }

    popupEl.innerHTML = `
      <div class="itin-map-popup-inner">
        <button class="itin-map-popup-close" onclick="document.getElementById('itin-map-popup').style.display='none'">×</button>
        <div class="row gap-8" style="margin-bottom:6px">
          <span>${TYPE_ICONS[item.type] || '📌'}</span>
          <span class="text-sm font-medium">${item.title || '—'}</span>
          ${badge}
        </div>
        ${meta}
        ${item.description ? `<div class="text-sm" style="color:var(--cream-dim);margin-top:6px">${item.description}</div>` : ''}
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
  const today = new Date().toISOString().slice(0, 10);
  const types = ['home', 'travel', 'rest', 'meal', 'activity', 'shopping', 'other'];
  _links = item?.links ? [...item.links] : [];

  openModal({
    title: isEdit ? t('modal.edit_event') : t('itin.add'),
    body: `
      <form id="itin-form">
        <div class="form-group">
          <label class="form-label">${t('itin.event_title')} *</label>
          <input class="form-input" name="title" value="${item?.title || ''}" placeholder="e.g. Airport transfer" required>
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
          <input class="form-input" name="location" value="${item?.location || ''}" placeholder="e.g. Narita Airport">
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
          <textarea class="form-textarea" name="description" placeholder="Additional notes…">${item?.description || ''}</textarea>
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
    setModalSaving(true);
    try {
      if (data.location) {
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
