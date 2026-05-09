import { t } from '../i18n.js';
import {
  subscribeActivities, addActivity, updateActivity, deleteActivity, toggleActivity,
  upsertLinkedExpense, deleteLinkedExpense, upsertLinkedItinItem, deleteLinkedItinItems,
} from '../db.js';
import { openModal, closeModal, showToast, showConfirm } from '../app.js';
import { formatConverted, getCurrency, CURRENCIES } from '../currency.js';

let _unsub = null;
let _ctx = null;
let _items = [];
let _filter = 'all';
let _links = [];
let _adding = false;

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.querySelector('.fab')?.remove();
}

const CAT_ICONS = {
  outdoor: '🏔️', culture: '🎭', sport: '⛳', shopping: '🛍️', other: '⚡'
};
const CATS = ['outdoor', 'culture', 'sport', 'shopping', 'other'];

export async function render(container, ctx) {
  _ctx = ctx;
  const { userId, tripId } = ctx;

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
    <div id="act-list"><div class="loading-center"><div class="spinner"></div></div></div>
    <div style="height:80px"></div>`;

  addFAB(() => {
    if (_adding) return;
    openItemModal(null);
  });

  window.__actFilter = (cat) => {
    _filter = cat;
    document.querySelectorAll('#act-chips .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.cat === cat));
    renderList(_items);
  };

  if (_unsub) _unsub();
  _unsub = subscribeActivities(userId, tripId, items => {
    _items = items;
    const done = items.filter(i => i.completed).length;
    const stats = document.getElementById('act-stats');
    if (stats) stats.textContent = `${done}/${items.length} done`;
    renderList(items);
  });
}

async function renderList(items) {
  const el = document.getElementById('act-list');
  if (!el) return;

  const filtered = _filter === 'all' ? items : items.filter(i => i.category === _filter);

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">⚡</div>
      <div class="empty-title">${t('common.empty')}</div>
      <div class="empty-sub">Tap + to add an activity</div>
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
  return `
    <div class="list-item" style="padding-left:12px">
      <div class="check-box ${item.completed ? 'checked' : ''}"
           onclick="event.stopPropagation();window.__toggleAct('${item.id}', ${!item.completed})"></div>
      <div class="list-icon" style="background:var(--surface-2)">${CAT_ICONS[item.category] || '⚡'}</div>
      <div class="list-content" onclick="window.__editActItem('${item.id}')">
        <div class="list-title ${item.completed ? 'text-muted' : ''}" style="${item.completed ? 'text-decoration:line-through' : ''}">${item.name || '—'}</div>
        <div class="list-sub">
          ${item.time ? item.time + ' · ' : ''}
          ${item.location ? '📍' + item.location : ''}
        </div>
      </div>
      <div class="list-meta" onclick="window.__editActItem('${item.id}')">
        ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
        <div class="badge badge-muted" style="margin-top:4px">${item.category || 'other'}</div>
      </div>
    </div>`;
}

function linkListHTML(links) {
  return (links || []).map((url, i) => `
    <div class="link-item">
      <a href="${url}" target="_blank" rel="noopener">${url}</a>
      <button type="button" class="link-item-del" onclick="window.__actRmLink(${i})">×</button>
    </div>`).join('');
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = new Date().toISOString().slice(0, 10);
  _links = item?.links ? [...item.links] : [];

  openModal({
    title: isEdit ? 'Edit Activity' : t('act.add'),
    body: `
      <form id="act-form">
        <div class="form-group">
          <label class="form-label">${t('act.name')} *</label>
          <input class="form-input" name="name" value="${item?.name || ''}" placeholder="e.g. Teamlab Borderless" required>
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
          <input class="form-input" name="location" value="${item?.location || ''}" placeholder="e.g. Odaiba, Tokyo">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label class="form-label">${t('act.cost')}</label>
            <input class="form-input" name="cost" type="number" min="0" value="${item?.cost || ''}" placeholder="0">
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
          <label class="form-label">${t('act.notes')}</label>
          <textarea class="form-textarea" name="notes" placeholder="Details, booking info…">${item?.notes || ''}</textarea>
        </div>
      </form>`,
    footer: `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="window.__deleteActItem('${item.id}')">Delete</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveActItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}</button>`
  });

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
    data.links = _links;
    const { userId, tripId } = _ctx;
    _adding = true;
    try {
      let savedId = id;
      if (id) {
        await updateActivity(userId, tripId, id, data);
        showToast('Activity updated');
      } else {
        const ref = await addActivity(userId, tripId, data);
        savedId = ref.id;
        showToast('Activity added');
      }
      // Expense sync
      await upsertLinkedExpense(userId, tripId, savedId, 'activity', {
        title: data.name,
        amount: parseFloat(data.cost) || 0,
        currency: data.currency || getCurrency(),
        date: data.date || '',
        category: 'activity',
        notes: '',
      });
      // Itinerary sync
      await upsertLinkedItinItem(userId, tripId, savedId, 'activity', 'event', {
        title: data.name,
        date: data.date || '',
        time: data.time || '',
        location: data.location || '',
        type: 'activity',
      });
      closeModal();
    } catch (e) { showToast('Error: ' + e.message); }
    finally { _adding = false; }
  };

  window.__deleteActItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Activity', 'This cannot be undone.');
    if (!confirmed) return;
    const { userId, tripId } = _ctx;
    try {
      await Promise.all([
        deleteActivity(userId, tripId, id),
        deleteLinkedExpense(userId, tripId, id, 'activity'),
        deleteLinkedItinItems(userId, tripId, id, 'activity'),
      ]);
      showToast('Activity deleted');
    } catch (e) { showToast('Error: ' + e.message); }
  };
}

function addFAB(onClick) {
  document.querySelector('.fab')?.remove();
  const fab = document.createElement('button');
  fab.className = 'fab';
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
