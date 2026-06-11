import { t } from '../i18n.js';
import {
  subscribeActivities, addActivity, updateActivity, deleteActivity, toggleActivity,
  upsertLinkedExpense, deleteLinkedExpense, upsertLinkedItinItem, deleteLinkedItinItems,
  getTrip,
} from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving, escapeHtml, skeletonHTML } from '../app.js';
import { formatConverted, getCurrency, CURRENCIES } from '../currency.js';
import { openCalc } from '../calculator.js';
import { geocodeCity } from '../weather.js';

let _unsub = null;
let _ctx = null;
let _tripStartDate = null;
let _items = [];
let _filter = 'all';
let _search = '';
let _links = [];
let _adding = false;
let _tripCountry = '';

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.querySelector('.fab')?.remove();
}

const CAT_ICONS = {
  outdoor: '🏔️', sport: '⛳', culture: '🎭', museum: '🏛️', site: '🗿', other: '⚡'
};
const CATS = ['outdoor', 'sport', 'culture', 'museum', 'site', 'other'];

export async function render(container, ctx) {
  _ctx = ctx;
  _tripStartDate = ctx.tripStartDate || null;
  const { userId, tripId, isGuest } = ctx;
  _filter = 'all';
  _search = '';
  getTrip(userId, tripId).then(tr => { _tripCountry = tr?.country || ''; }).catch(() => {});

  if (!tripId) {
    container.innerHTML = noTripHTML();
    return;
  }

  container.innerHTML = `
    <div style="padding:14px 16px 8px" class="row-between">
      <div>
        <div class="eyebrow" style="margin-bottom:2px">${t('nav.activities')}</div>
        <div class="page-title">${t('act.title')}</div>
      </div>
      <div id="act-stats" class="text-xs text-muted"></div>
    </div>
    <div class="chip-row" id="act-chips">
      <div class="chip active" data-cat="all" onclick="window.__actFilter('all')">All</div>
      ${CATS.map(c => `<div class="chip" data-cat="${c}" onclick="window.__actFilter('${c}')">${CAT_ICONS[c]} ${t('act.cats.' + c)}</div>`).join('')}
    </div>
    <div class="search-row">
      <input class="search-input" id="act-search" type="search" placeholder="${t('common.search')}" value="${escapeHtml(_search)}">
    </div>
    <div id="act-list">${skeletonHTML()}</div>
    <div style="height:80px"></div>`;

  if (!isGuest) addFAB(() => {
    if (_adding) return;
    openItemModal(null);
  });

  window.__actFilter = (cat) => {
    _filter = cat;
    document.querySelectorAll('#act-chips .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.cat === cat));
    renderList(_items);
  };

  let _searchDebounce = null;
  document.getElementById('act-search').addEventListener('input', e => {
    clearTimeout(_searchDebounce);
    const val = e.target.value;
    _searchDebounce = setTimeout(() => {
      _search = val;
      renderList(_items);
    }, 150);
  });

  if (_unsub) _unsub();
  _unsub = subscribeActivities(userId, tripId, items => {
    _items = items;
    const done = items.filter(i => i.completed).length;
    const stats = document.getElementById('act-stats');
    if (stats) stats.textContent = `${done}/${items.length} done`;
    renderList(items);
  }, (err) => {
    const el = document.getElementById('act-list');
    if (el) el.innerHTML = `<div class="empty-state" style="margin-top:40px"><div class="empty-icon">⚠️</div><div class="empty-sub">${err.message}</div></div>`;
  });
}

async function renderList(items) {
  const el = document.getElementById('act-list');
  if (!el) return;

  let filtered = _filter === 'all' ? items : items.filter(i => i.category === _filter);
  const search = _search.trim().toLowerCase();
  if (search) filtered = filtered.filter(i => (i.name || '').toLowerCase().includes(search));

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">⚡</div>
      <div class="empty-title">${search ? t('common.no_results') : t('common.empty')}</div>
      ${search ? '' : `<div class="empty-sub">${t('act.tap_add')}</div>`}
    </div>`;
    return;
  }

  // Group by date
  const byDate = {};
  filtered.forEach(item => {
    const d = item.date || '';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(item);
  });
  const dates = Object.keys(byDate).sort();

  const rows = await Promise.all(dates.map(async date => {
    const dayItems = byDate[date];
    const label = date ? formatDate(date) : 'No Date';
    const dayRows = await Promise.all(dayItems.map(item => renderItem(item)));
    return `
      ${date ? `<div style="padding:8px 16px 4px"><div class="eyebrow">${label}</div></div>` : ''}
      ${dayRows.join('')}`;
  }));

  el.innerHTML = rows.join('');

  window.__toggleAct = async (id, completed) => {
    try {
      await toggleActivity(_ctx.userId, _ctx.tripId, id, completed);
    } catch (e) { showToast('Error: ' + e.message); }
  };
  window.__editActItem = (id) => {
    const item = _items.find(i => i.id === id);
    if (item) openItemModal(item);
  };
}

async function renderItem(item) {
  const priceStr = item.cost ? await formatConverted(item.cost, item.currency || 'KRW') : null;
  const isGuest = _ctx?.isGuest;
  return `
    <div class="list-item" style="padding-left:12px">
      <div class="check-box ${item.completed ? 'checked' : ''}"
           ${isGuest ? 'style="opacity:0.5;pointer-events:none"' : `onclick="event.stopPropagation();window.__toggleAct('${item.id}', ${!item.completed})"`}></div>
      <div class="list-icon" style="background:var(--surface-2)">${CAT_ICONS[item.category] || '⚡'}</div>
      <div class="list-content" ${isGuest ? '' : `onclick="window.__editActItem('${item.id}')"`}>
        <div class="list-title ${item.completed ? 'text-muted' : ''}" style="${item.completed ? 'text-decoration:line-through' : ''}">${escapeHtml(item.name) || '—'}</div>
        <div class="list-sub">
          ${item.time ? item.time + ' · ' : ''}
          ${item.location ? '📍' + escapeHtml(item.location) : ''}
        </div>
        ${item.notes ? `<div class="text-xs text-muted" style="margin-top:4px;white-space:pre-wrap">${escapeHtml(item.notes)}</div>` : ''}
      </div>
      <div class="list-meta" ${isGuest ? '' : `onclick="window.__editActItem('${item.id}')"`}>
        ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
        <div class="badge badge-muted" style="margin-top:4px">${item.category || 'other'}</div>
        ${item.status === 'candidate' ? `<div class="badge" style="margin-top:4px;background:var(--sun-dim,rgba(232,200,124,0.15));color:var(--sun)">🔖</div>` : ''}
        ${item.status === 'booked' ? `<div class="badge" style="margin-top:4px;background:rgba(95,184,140,0.15);color:var(--mint)">✅</div>` : ''}
      </div>
    </div>`;
}

function linkListHTML(links) {
  return (links || []).map((url, i) => `
    <div class="link-item">
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>
      <button type="button" class="link-item-del" onclick="window.__actRmLink(${i})">×</button>
    </div>`).join('');
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = _tripStartDate || new Date().toISOString().slice(0, 10);
  _links = item?.links ? [...item.links] : [];

  openModal({
    title: isEdit ? t('modal.edit_activity') : t('act.add'),
    body: `
      <form id="act-form">
        <div class="form-group">
          <label class="form-label">${t('act.name')} *</label>
          <input class="form-input" name="name" value="${escapeHtml(item?.name || '')}" placeholder="e.g. Teamlab Borderless" required>
        </div>
        <div class="form-group">
          <label class="form-label">${t('act.category')}</label>
          <select class="form-select" name="category">
            ${CATS.map(c => `<option value="${c}" ${(item?.category || 'other') === c ? 'selected' : ''}>${CAT_ICONS[c]} ${t('act.cats.' + c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${t('act.date')}</label>
            <input class="form-input" name="date" type="date" value="${item?.date || today}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('act.time')}</label>
            <input class="form-input" name="time" type="time" value="${item?.time || ''}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('act.location')}</label>
          <input class="form-input" name="location" value="${escapeHtml(item?.location || '')}" placeholder="e.g. Odaiba, Tokyo">
        </div>
        <div class="form-group" style="margin-top:-4px">
          <label class="form-label" style="font-size:0.7rem;color:var(--muted)">${t('book.coords')} <span style="font-weight:400">(${t('book.coords_hint')})</span></label>
          <input class="form-input" name="coords" value="${item?.lat && item?.lng ? `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}` : ''}" placeholder="e.g. -25.989, 28.005" autocomplete="off" style="font-size:0.8rem">
        </div>
        <div class="form-group">
          <label class="form-label">${t('book.headcount')}</label>
          <input class="form-input" name="headcount" type="number" min="1" value="${item?.headcount || ''}" placeholder="2">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label class="form-label">${t('act.cost')}</label>
            <div style="display:flex;gap:6px">
              <input id="act-cost-input" class="form-input" name="cost" type="number" min="0" step="any" value="${item?.cost || ''}" placeholder="0" style="flex:1">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('act-cost-input')" style="flex-shrink:0;padding:0 10px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg></button>
            </div>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">${t('act.currency')}</label>
            <select class="form-select" name="currency">
              ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.links')}</label>
          <div class="link-list" id="act-link-list">${linkListHTML(_links)}</div>
          <div class="link-add-row">
            <input class="form-input" id="act-link-input" placeholder="https://..." type="url">
            <button type="button" class="btn btn-secondary btn-sm link-add-btn" onclick="window.__actAddLink()">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.status')}</label>
          <select class="form-select" name="status">
            <option value="booked" ${(item?.status || 'booked') === 'booked' ? 'selected' : ''}>✅ ${t('common.booked')}</option>
            <option value="candidate" ${item?.status === 'candidate' ? 'selected' : ''}>🔖 ${t('common.candidate')}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('act.notes')}</label>
          <textarea class="form-textarea" name="notes" placeholder="Details, booking info…">${escapeHtml(item?.notes || '')}</textarea>
        </div>
      </form>`,
    footer: `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="window.__deleteActItem('${item.id}')">${t('common.delete')}</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveActItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}</button>`
  });

  window.__openCalc = openCalc;

  window.__actAddLink = () => {
    const inp = document.getElementById('act-link-input');
    const val = inp.value.trim();
    if (!val) return;
    _links.push(val);
    inp.value = '';
    const el = document.getElementById('act-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };
  window.__actRmLink = (i) => {
    _links.splice(i, 1);
    const el = document.getElementById('act-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };

  window.__saveActItem = async (id) => {
    if (_adding) return;
    const form = document.getElementById('act-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    if (data.cost) data.cost = Number(data.cost);
    if (data.headcount) data.headcount = Number(data.headcount);
    data.links = _links;
    // Resolve lat/lng before save so coords string is not persisted.
    const rawCoords = data.coords?.trim();
    delete data.coords;
    let geoFields = {};
    if (rawCoords) {
      const parts = rawCoords.replace(/(\d),(\d)/g, '$1.$2').split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        geoFields = { lat: parts[0], lng: parts[1] };
        data.lat = parts[0]; data.lng = parts[1];
      }
    } else if (data.location) {
      try { localStorage.removeItem(`geo_${data.location.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
      const geo = await geocodeCity(data.location, _tripCountry);
      if (geo) { geoFields = { lat: geo.lat, lng: geo.lng }; data.lat = geo.lat; data.lng = geo.lng; }
    }
    const { userId, tripId } = _ctx;
    _adding = true;
    setModalSaving(true);
    try {
      let savedId = id;
      if (id) {
        await updateActivity(userId, tripId, id, data);
        showToast(t('toast.activity_updated'));
      } else {
        const ref = await addActivity(userId, tripId, data);
        savedId = ref.id;
        showToast(t('toast.activity_added'));
      }
      // Expense sync
      const costNum = parseFloat(data.cost) || 0;
      if (costNum > 0) {
        await upsertLinkedExpense(userId, tripId, savedId, 'activity', {
          title: data.name,
          amount: costNum,
          currency: data.currency || getCurrency(),
          date: data.date || '',
          category: 'activity',
          notes: '',
        });
      } else {
        await deleteLinkedExpense(userId, tripId, savedId, 'activity');
      }
      // Itinerary sync
      await upsertLinkedItinItem(userId, tripId, savedId, 'activity', 'event', {
        title: data.name,
        date: data.date || '',
        time: data.time || '',
        location: data.location || '',
        type: 'activity',
        links: data.links || [],
        ...geoFields,
      });
      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    } finally { _adding = false; }
  };

  window.__deleteActItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Activity', 'This cannot be undone.');
    if (!confirmed) return;
    const { userId, tripId } = _ctx;
    try {
      await Promise.all([
        deleteLinkedExpense(userId, tripId, id, 'activity'),
        deleteLinkedItinItems(userId, tripId, id, 'activity'),
      ]);
      await deleteActivity(userId, tripId, id);
      showToast(t('toast.activity_deleted'));
    } catch (e) { showToast('Error: ' + e.message); }
  };
}

function addFAB(onClick) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.dataset.route = 'activities';
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  fab.addEventListener('click', onClick);
  document.getElementById('app').appendChild(fab);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (_) { return dateStr; }
}

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">⚡</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
