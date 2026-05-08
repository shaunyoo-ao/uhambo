import { t } from '../i18n.js';
import { subscribeItinerary, addItineraryItem, updateItineraryItem, deleteItineraryItem } from '../db.js';
import { openModal, closeModal, showToast, showConfirm } from '../app.js';

let _unsub = null;
let _ctx = null;

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
}

const TYPE_ICONS = { travel: '✈️', meal: '🍽️', activity: '⚡', rest: '🏨', other: '📌' };
const TYPE_COLORS = { travel: 'var(--sky)', meal: 'var(--sun)', activity: 'var(--accent)', rest: 'var(--mint)', other: 'var(--muted)' };

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
        <div class="eyebrow" style="margin-bottom:2px">${t('nav.itinerary')}</div>
        <div class="page-title">${t('itin.title')}</div>
      </div>
    </div>
    <div id="itin-list"><div class="loading-center"><div class="spinner"></div></div></div>
    <div style="height:80px"></div>`;

  addFAB(container, () => openItemModal(null));

  if (_unsub) _unsub();
  _unsub = subscribeItinerary(userId, tripId, items => renderList(items));
}

function renderList(items) {
  const el = document.getElementById('itin-list');
  if (!el) return;

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">📅</div>
      <div class="empty-title">${t('common.empty')}</div>
      <div class="empty-sub">Tap + to add your first event</div>
    </div>`;
    return;
  }

  // Group by date
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
            <div class="timeline-card" onclick="window.__editItinItem('${item.id}')">
              <div class="row gap-8" style="margin-bottom:4px">
                <span>${TYPE_ICONS[item.type] || '📌'}</span>
                <span class="text-sm font-medium">${item.title || '—'}</span>
                <span class="badge badge-muted" style="margin-left:auto;font-size:10px">${item.type || 'other'}</span>
              </div>
              ${item.location ? `<div class="text-xs text-muted">📍 ${item.location}</div>` : ''}
              ${item.description ? `<div class="text-sm" style="color:var(--cream-dim);margin-top:4px">${item.description}</div>` : ''}
            </div>
          </div>
        </div>`).join('')}`;
  }).join('');

  window.__editItinItem = (id) => {
    const item = items.find(i => i.id === id);
    if (item) openItemModal(item);
  };
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = new Date().toISOString().slice(0, 10);
  const types = ['travel', 'meal', 'activity', 'rest', 'other'];

  openModal({
    title: isEdit ? t('common.edit') + ' Event' : t('itin.add'),
    body: `
      <form id="itin-form">
        <div class="form-group">
          <label class="form-label">${t('itin.event_title')} *</label>
          <input class="form-input" name="title" value="${item?.title || ''}" placeholder="e.g. Airport transfer" required>
        </div>
        <div class="form-group">
          <label class="form-label">${t('itin.type')}</label>
          <select class="form-select" name="type">
            ${types.map(tp => `<option value="${tp}" ${item?.type === tp ? 'selected' : ''}>${TYPE_ICONS[tp]} ${tp.charAt(0).toUpperCase() + tp.slice(1)}</option>`).join('')}
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
          <label class="form-label">${t('itin.notes')}</label>
          <textarea class="form-textarea" name="description" placeholder="Additional notes…">${item?.description || ''}</textarea>
        </div>
      </form>`,
    footer: `
      ${isEdit ? `<button class="btn btn-danger" onclick="window.__deleteItinItem('${item.id}')">Delete</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveItinItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}
      </button>`
  });

  window.__saveItinItem = async (id) => {
    const form = document.getElementById('itin-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    try {
      if (id) {
        await updateItineraryItem(_ctx.userId, _ctx.tripId, id, data);
        showToast('Event updated');
      } else {
        await addItineraryItem(_ctx.userId, _ctx.tripId, data);
        showToast('Event added');
      }
      closeModal();
    } catch (e) { showToast('Error: ' + e.message); }
  };

  window.__deleteItinItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Event', 'This cannot be undone.');
    if (!confirmed) return;
    try {
      await deleteItineraryItem(_ctx.userId, _ctx.tripId, id);
      showToast('Event deleted');
    } catch (e) { showToast('Error: ' + e.message); }
  };
}

function addFAB(container, onClick) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  fab.addEventListener('click', onClick);
  document.getElementById('app').appendChild(fab);
  // Cleanup on navigate
  const orig = window.__fabCleanup;
  window.__fabCleanup = () => { fab.remove(); if (orig) orig(); };
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
