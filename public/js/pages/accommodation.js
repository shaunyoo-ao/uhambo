import { t } from '../i18n.js';
import {
  subscribeAccommodation, addAccommodation, updateAccommodation, deleteAccommodation,
  upsertLinkedExpense, deleteLinkedExpense, upsertLinkedItinItem, deleteLinkedItinItems,
  getTrip,
} from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving } from '../app.js';
import { formatConverted, getCurrency, CURRENCIES } from '../currency.js';
import { openCalc } from '../calculator.js';
import { geocodeCity } from '../weather.js';
import { resizeImageToBlob, uploadToImgBB } from '../imgbb.js';

let _unsub = null;
let _ctx = null;
let _items = [];
let _links = [];
let _imageSlots = [];
let _tripCountry = '';

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.querySelector('.fab')?.remove();
}

export async function render(container, ctx) {
  _ctx = ctx;
  const { userId, tripId } = ctx;
  getTrip(userId, tripId).then(tr => { _tripCountry = tr?.country || ''; }).catch(() => {});

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
      <div class="empty-sub">${t('accom.tap_add')}</div>
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
            <div class="row gap-8">
              ${priceStr ? `<div class="mono text-sm text-accent">${priceStr}</div>` : ''}
              ${item.status === 'candidate' ? `<div class="badge" style="background:rgba(232,200,124,0.15);color:var(--sun)">🔖 ${t('common.candidate')}</div>` : ''}
            </div>
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
          ${(item.images || []).length > 0 ? `<div style="margin-top:10px;display:grid;grid-template-columns:${(item.images || []).length > 1 ? '1fr 1fr' : '1fr'};gap:6px;border-radius:8px;overflow:hidden">${(item.images || []).slice(0, 4).map(u => `<img src="${u}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block">`).join('')}</div>` : ''}
        </div>
      </div>`;
  }));

  el.innerHTML = cards.join('');

  window.__editAccomItem = (id) => {
    const item = _items.find(i => i.id === id);
    if (item) openItemModal(item);
  };
}

function accomImgGridHTML() {
  return _imageSlots.map((slot, i) => {
    if (slot.type === 'empty') return `<div class="img-slot img-slot-empty" onclick="window.__accomImgPick(${i})"><span>+</span></div>`;
    return `<div class="img-slot img-slot-filled"><img src="${slot.preview}" alt=""><button type="button" class="img-slot-del" onclick="event.stopPropagation();window.__accomImgRemove(${i})">×</button></div>`;
  }).join('');
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
  _imageSlots = (item?.images || []).slice(0, 4).map(url => ({ type: 'url', value: url, preview: url }));
  while (_imageSlots.length < 4) _imageSlots.push({ type: 'empty', value: null, preview: null });

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
            <div style="display:flex;gap:6px">
              <input id="accom-cost-input" class="form-input" name="cost" type="number" min="0" value="${item?.cost || ''}" placeholder="0" style="flex:1">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('accom-cost-input')" style="flex-shrink:0;padding:0 10px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg></button>
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
          <label class="form-label">${t('common.links')}</label>
          <div class="link-list" id="accom-link-list">${linkListHTML(_links)}</div>
          <div class="link-add-row">
            <input class="form-input" id="accom-link-input" placeholder="https://..." type="url">
            <button type="button" class="btn btn-secondary btn-sm link-add-btn" onclick="window.__accomAddLink()">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Photos</label>
          <div class="img-upload-grid" id="accom-img-grid">${accomImgGridHTML()}</div>
          <input type="file" id="accom-file-input" accept="image/*" style="display:none" onchange="window.__accomFileChange(this)">
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.status')}</label>
          <select class="form-select" name="status">
            <option value="booked" ${(item?.status || 'booked') === 'booked' ? 'selected' : ''}>✅ ${t('common.booked')}</option>
            <option value="candidate" ${item?.status === 'candidate' ? 'selected' : ''}>🔖 ${t('common.candidate')}</option>
          </select>
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

  window.__openCalc = openCalc;

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

  window.__accomImgPick = (idx) => {
    const inp = document.getElementById('accom-file-input');
    if (!inp) return;
    inp.dataset.slotIdx = String(idx);
    inp.click();
  };
  window.__accomFileChange = (input) => {
    const idx = parseInt(input.dataset.slotIdx || '0', 10);
    const file = input.files[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    _imageSlots[idx] = { type: 'file', value: file, preview };
    const grid = document.getElementById('accom-img-grid');
    if (grid) grid.innerHTML = accomImgGridHTML();
    input.value = '';
  };
  window.__accomImgRemove = (idx) => {
    _imageSlots[idx] = { type: 'empty', value: null, preview: null };
    const grid = document.getElementById('accom-img-grid');
    if (grid) grid.innerHTML = accomImgGridHTML();
  };

  window.__saveAccomItem = async (id) => {
    const form = document.getElementById('accom-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    if (data.cost) data.cost = Number(data.cost);
    data.links = _links;
    const { userId, tripId } = _ctx;
    setModalSaving(true);
    // Upload new image files
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
    try {
      let savedId = id;
      if (id) {
        await updateAccommodation(userId, tripId, id, data);
        showToast(t('toast.stay_updated'));
      } else {
        const ref = await addAccommodation(userId, tripId, data);
        savedId = ref.id;
        showToast(t('toast.stay_added'));
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
      // Geocode address once for itinerary sync lat/lng; clear cache to force fresh geocode.
      let geoCoords = null;
      if (data.address) {
        try { localStorage.removeItem(`geo_${data.address.toLowerCase().trim().replace(/\s+/g, '_')}`); } catch(_) {}
        geoCoords = await geocodeCity(data.address, _tripCountry);
      }
      const geoFields = geoCoords ? { lat: geoCoords.lat, lng: geoCoords.lng } : {};

      // Itinerary sync – check-in
      if (data.checkInTime) {
        await upsertLinkedItinItem(userId, tripId, savedId, 'accommodation', 'checkin', {
          title: `Check-in: ${data.name}`,
          date: data.checkIn,
          time: data.checkInTime,
          location: data.address || '',
          type: 'rest',
          links: data.links || [],
          ...geoFields,
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
          links: data.links || [],
          ...geoFields,
        });
      }
      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    }
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
      showToast(t('toast.stay_deleted'));
    } catch (e) { showToast('Error: ' + e.message); }
  };
}

function addFAB(onClick) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.dataset.route = 'accommodation';
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
