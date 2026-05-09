import { t } from '../i18n.js';
import {
  subscribeAccommodation, addAccommodation, updateAccommodation, deleteAccommodation,
  upsertLinkedExpense, deleteLinkedExpense, upsertLinkedItinItem, deleteLinkedItinItems,
} from '../db.js';
import { openModal, closeModal, showToast, showConfirm } from '../app.js';
import { formatConverted, getCurrency, CURRENCIES } from '../currency.js';

let _unsub = null;
let _ctx = null;
let _items = [];
let _links = [];

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.querySelector('.fab')?.remove();
}

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
        <div class="eyebrow" style="margin-bottom:2px">${t('nav.accommodation')}</div>
        <div class="page-title">Accommodation</div>
      </div>
    </div>
    <div id="accom-list"><div class="loading-center"><div class="spinner"></div></div></div>
    <div style="height:80px"></div>`;

  addFAB(() => openItemModal(null));

  if (_unsub) _unsub();
  _unsub = subscribeAccommodation(userId, tripId, items => {
    _items = items;
    renderList(items);
  });
}

async function renderList(items) {
  const el = document.getElementById('accom-list');
  if (!el) return;

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">🏨</div>
      <div class="empty-title">${t('common.empty')}</div>
      <div class="empty-sub">Tap + to add a stay</div>
    </div>`;
    return;
  }

  const cards = await Promise.all(items.map(async item => {
    const nights = item.checkIn && item.checkOut
      ? Math.round((new Date(item.checkOut) - new Date(item.checkIn)) / 86400000)
      : null;
    const priceStr = item.cost ? await formatConverted(item.cost, item.currency || 'KRW') : null;

    return `
      <div class="card" style="margin:0 16px 12px;cursor:pointer" onclick="window.__editAccomItem('${item.id}')">
        <div class="card-body" style="padding:14px">
          <div class="row-between" style="margin-bottom:8px">
            <div class="row gap-8">
              <span style="font-size:20px">🏨</span>
              <div>
                <div class="font-medium">${item.name || '—'}</div>
                ${item.address ? `<div class="text-xs text-muted">📍 ${item.address}</div>` : ''}
              </div>
            </div>
            ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
          </div>
          <div class="dotrow"></div>
          <div class="row gap-16">
            <div>
              <div class="eyebrow" style="margin-bottom:2px">${t('accom.check_in')}</div>
              <div class="text-sm">${item.checkIn || '—'}${item.checkInTime ? ' ' + item.checkInTime : ''}</div>
            </div>
            <div>
              <div class="eyebrow" style="margin-bottom:2px">${t('accom.check_out')}</div>
              <div class="text-sm">${item.checkOut || '—'}${item.checkOutTime ? ' ' + item.checkOutTime : ''}</div>
            </div>
            ${nights !== null ? `
            <div style="margin-left:auto">
              <div class="eyebrow" style="margin-bottom:2px">${t('accom.nights')}</div>
              <div class="mono text-sm">${nights}</div>
            </div>` : ''}
          </div>
          ${(item.links || []).length > 0 ? `<div class="row gap-6" style="margin-top:8px;flex-wrap:wrap">${item.links.map(u => `<a href="${u}" target="_blank" rel="noopener" class="text-xs" style="color:var(--sky)" onclick="event.stopPropagation()">🔗 Link</a>`).join('')}</div>` : ''}
          ${item.notes ? `<div class="text-xs text-muted" style="margin-top:8px">${item.notes}</div>` : ''}
        </div>
      </div>`;
  }));

  el.innerHTML = cards.join('');

  window.__editAccomItem = (id) => {
    const item = _items.find(i => i.id === id);
    if (item) openItemModal(item);
  };
}

function linkListHTML(links) {
  return (links || []).map((url, i) => `
    <div class="link-item">
      <a href="${url}" target="_blank" rel="noopener">${url}</a>
      <button type="button" class="link-item-del" onclick="window.__accomRmLink(${i})">×</button>
    </div>`).join('');
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = new Date().toISOString().slice(0, 10);
  _links = item?.links ? [...item.links] : [];

  openModal({
    title: isEdit ? t('accom.edit_stay') : t('accom.add'),
    body: `
      <form id="accom-form">
        <div class="form-group">
          <label class="form-label">${t('accom.name')} *</label>
          <input class="form-input" name="name" value="${item?.name || ''}" placeholder="e.g. Hotel Gracery" required>
        </div>
        <div class="form-group">
          <label class="form-label">${t('accom.address')}</label>
          <input class="form-input" name="address" value="${item?.address || ''}" placeholder="Full address">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${t('accom.check_in')}</label>
            <input class="form-input" name="checkIn" type="date" value="${item?.checkIn || today}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('accom.check_in_time')}</label>
            <input class="form-input" name="checkInTime" type="time" value="${item?.checkInTime || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${t('accom.check_out')}</label>
            <input class="form-input" name="checkOut" type="date" value="${item?.checkOut || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">${t('accom.check_out_time')}</label>
            <input class="form-input" name="checkOutTime" type="time" value="${item?.checkOutTime || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label class="form-label">${t('accom.cost')} (${t('accom.total').toLowerCase()})</label>
            <input class="form-input" name="cost" type="number" min="0" value="${item?.cost || ''}" placeholder="0">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">${t('accom.currency')}</label>
            <select class="form-select" name="currency">
              ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.links')}</label>
          <div class="link-list" id="accom-link-list">${linkListHTML(_links)}</div>
          <div class="link-add-row">
            <input class="form-input" id="accom-link-input" placeholder="https://..." type="url">
            <button type="button" class="btn btn-secondary btn-sm link-add-btn" onclick="window.__accomAddLink()">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('accom.notes')}</label>
          <textarea class="form-textarea" name="notes" placeholder="Booking ref, check-in instructions…">${item?.notes || ''}</textarea>
        </div>
      </form>`,
    footer: `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="window.__deleteAccomItem('${item.id}')">${t('common.delete')}</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveAccomItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}</button>`
  });

  window.__accomAddLink = () => {
    const inp = document.getElementById('accom-link-input');
    const val = inp.value.trim();
    if (!val) return;
    _links.push(val);
    inp.value = '';
    const el = document.getElementById('accom-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };
  window.__accomRmLink = (i) => {
    _links.splice(i, 1);
    const el = document.getElementById('accom-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };

  window.__saveAccomItem = async (id) => {
    const form = document.getElementById('accom-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    if (data.cost) data.cost = Number(data.cost);
    data.links = _links;
    const { userId, tripId } = _ctx;
    try {
      let savedId = id;
      if (id) {
        await updateAccommodation(userId, tripId, id, data);
        showToast('Stay updated');
      } else {
        const ref = await addAccommodation(userId, tripId, data);
        savedId = ref.id;
        showToast('Stay added');
      }
      // Expense sync
      if (data.cost) {
        await upsertLinkedExpense(userId, tripId, savedId, 'accommodation', {
          title: `${data.name} (Stay)`,
          amount: parseFloat(data.cost),
          currency: data.currency || 'KRW',
          date: data.checkIn,
          category: 'accom',
          notes: '',
        });
      } else {
        await deleteLinkedExpense(userId, tripId, savedId, 'accommodation');
      }
      // Itinerary sync – check-in
      if (data.checkInTime) {
        await upsertLinkedItinItem(userId, tripId, savedId, 'accommodation', 'checkin', {
          title: `Check-in: ${data.name}`,
          date: data.checkIn,
          time: data.checkInTime,
          location: data.address || '',
          type: 'rest',
        });
      }
      // Itinerary sync – check-out
      if (data.checkOutTime && data.checkOut) {
        await upsertLinkedItinItem(userId, tripId, savedId, 'accommodation', 'checkout', {
          title: `Check-out: ${data.name}`,
          date: data.checkOut,
          time: data.checkOutTime,
          location: data.address || '',
          type: 'rest',
        });
      }
      closeModal();
    } catch (e) { showToast('Error: ' + e.message); }
  };

  window.__deleteAccomItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Stay', 'This cannot be undone.');
    if (!confirmed) return;
    const { userId, tripId } = _ctx;
    try {
      await Promise.all([
        deleteAccommodation(userId, tripId, id),
        deleteLinkedExpense(userId, tripId, id, 'accommodation'),
        deleteLinkedItinItems(userId, tripId, id, 'accommodation'),
      ]);
      showToast('Stay deleted');
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

function noTripHTML() {
  return `<div class="empty-state" style="padding-top:80px">
    <div class="empty-icon">🏨</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
