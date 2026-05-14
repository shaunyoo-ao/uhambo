import { signInWithGoogle, signOut, signInAnonymously, onAuthStateChange, handleRedirectResult } from './auth.js';
import { setLang, getLang, t } from './i18n.js';
import { setCurrency, getCurrency, CURRENCIES } from './currency.js';
import { getTrips, createTrip, getTrip, updateTrip, deleteTrip, getGuestCode, setGuestCode, removeGuestCode, lookupGuestCode } from './db.js';
import { resizeImageToBlob, uploadToImgBB } from './imgbb.js';

const APP_VERSION = '1.2.1';

const COUNTRIES = ['Australia','Austria','Belgium','Brazil','Canada','China','Croatia','Czech Republic','Denmark','Egypt','Finland','France','Germany','Greece','Hong Kong','Hungary','Iceland','India','Indonesia','Ireland','Israel','Italy','Japan','Malaysia','Mexico','Morocco','Netherlands','New Zealand','Norway','Philippines','Poland','Portugal','Romania','Russia','Singapore','South Africa','South Korea','Spain','Sweden','Switzerland','Taiwan','Thailand','Turkey','United Arab Emirates','United Kingdom','United States','Vietnam'];

// ── Global state ────────────────────────────────────────────────
export let currentUser = null;
export let currentTripId = null;
export let isGuest = false;
let _guestOwnerUid = null;
let _guestTripId = null;
let _pendingGuestCode = null;
let _appInitialized = false;
let _savingTrip = false;
let _trips = [];
let _tripImageSlot = { type: 'empty', value: null, preview: null };

function tripImageSlotHTML(slot) {
  if (slot.type === 'empty') return `<div class="img-slot img-slot-empty img-slot-banner" onclick="window.__tripImgPick()"><span style="font-size:13px">+ Cover photo</span></div>`;
  return `<div class="img-slot img-slot-filled img-slot-banner"><img src="${slot.preview}" alt=""><button type="button" class="img-slot-del" onclick="window.__tripImgRemove()">×</button></div>`;
}

// ── Per-page keep-alive tracking ─────────────────────────────────
const _renderedPages = new Set();  // routes rendered for current trip
const _pageModules   = new Map();  // route → module instance

function _clearAllPages() {
  for (const [route, mod] of _pageModules) {
    if (mod?.destroy) mod.destroy();
    const el = document.getElementById(`page-${route}`);
    if (el) el.innerHTML = '';
  }
  _renderedPages.clear();
  _pageModules.clear();
  document.querySelectorAll('.fab').forEach(f => f.remove());
}

// ── Page registry ────────────────────────────────────────────────
const routes = {
  dashboard:     () => import('./pages/dashboard.js'),
  itinerary:     () => import('./pages/itinerary.js'),
  booking:       () => import('./pages/accommodation.js'),
  activities:    () => import('./pages/activities.js'),
  expenses:      () => import('./pages/expenses.js'),
  archive:       () => import('./pages/archive.js'),
};

// ── Auth UI ─────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('loading-overlay').classList.add('hidden');
}

function hideLogin() {
  document.getElementById('login-screen').classList.add('hidden');
}

function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  setTimeout(() => el.style.display = 'none', 400);
}

// ── Trip selector ────────────────────────────────────────────────
async function loadTrips(userId) {
  const btn = document.getElementById('trip-selector-btn');
  try {
    _trips = await getTrips(userId);
    _trips.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
    if (_trips.length === 0) {
      if (btn) btn.textContent = '— No trips —';
      currentTripId = null;
    } else {
      const saved = localStorage.getItem('lastTripId');
      const match = saved && _trips.find(tr => tr.id === saved);
      const active = match || _trips[0];
      currentTripId = active.id;
      if (btn) btn.textContent = active.name;
    }
  } catch (e) {
    console.error('loadTrips:', e);
  }
}

function openTripPicker() {
  if (_trips.length === 0) { openNewTrip(); return; }
  openModal({
    title: t('common.select_trip'),
    body: _trips.map(trip => `
      <div class="trip-radio-item" onclick="window.__selectTrip('${trip.id}')">
        <div class="trip-radio-dot">${trip.id === currentTripId ? '●' : '○'}</div>
        <div style="flex:1;min-width:0">
          <div class="font-medium">${trip.name}</div>
          ${trip.destination ? `<div class="text-xs text-muted">📍 ${trip.destination}</div>` : ''}
        </div>
      </div>`).join(''),
    footer: `<button class="btn btn-ghost btn-full" onclick="window.__closeModal()">${t('common.cancel')}</button>`
  });
}

function selectTrip(tripId) {
  const trip = _trips.find(tr => tr.id === tripId);
  if (!trip) return;
  currentTripId = tripId;
  localStorage.setItem('lastTripId', tripId);
  const btn = document.getElementById('trip-selector-btn');
  if (btn) btn.textContent = trip.name;
  closeModal();
  dispatchTripChange(tripId);
  navigate(localStorage.getItem('lastRoute') || 'dashboard');
}

function dispatchTripChange(tripId) {
  _clearAllPages();
  document.dispatchEvent(new CustomEvent('tripchange', { detail: { tripId } }));
}

// ── Router ───────────────────────────────────────────────────────
export async function navigate(route) {
  if (!routes[route]) route = 'dashboard';

  // Update nav
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.route === route));

  // Show active page container, hide others
  document.querySelectorAll('.page-container').forEach(el => {
    el.style.display = (el.id === `page-${route}`) ? '' : 'none';
  });

  // Show only this route's FAB
  document.querySelectorAll('.fab').forEach(fab => {
    fab.style.display = (fab.dataset.route === route) ? '' : 'none';
  });

  localStorage.setItem('lastRoute', route);

  // Already rendered for current trip → instant (live subscription still active)
  if (_renderedPages.has(route)) return;

  // First render for this trip
  const container = document.getElementById(`page-${route}`);
  container.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const mod = await routes[route]();
    _pageModules.set(route, mod);
    const renderUid = isGuest ? _guestOwnerUid : currentUser.uid;
    await mod.render(container, { userId: renderUid, tripId: currentTripId, isGuest });
    _renderedPages.add(route);
  } catch (e) {
    console.error('navigate:', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Failed to load</div><div class="empty-sub">${e.message}</div></div>`;
  }
}

// ── Modal ────────────────────────────────────────────────────────
export function openModal({ title, body, footer, onClose }) {
  setModalSaving(false);
  const overlay = document.getElementById('modal-root');
  document.getElementById('modal-title').textContent = title || '';
  document.getElementById('modal-body').innerHTML = body || '';
  document.getElementById('modal-footer').innerHTML = footer || '';
  overlay.classList.add('visible');
  overlay._onClose = onClose;
}

export function closeModal() {
  const overlay = document.getElementById('modal-root');
  overlay.classList.remove('visible');
  if (overlay._onClose) { overlay._onClose(); overlay._onClose = null; }
}

export function setModalSaving(saving) {
  const progress = document.getElementById('modal-save-progress');
  const primary  = document.querySelector('#modal-root .btn-primary');
  const ghost    = document.querySelector('#modal-root .btn-ghost');
  if (saving) {
    progress?.classList.add('saving');
    if (primary) {
      primary._origText   = primary.textContent.trim();
      const isAdd = primary._origText === t('common.add');
      primary.textContent = isAdd ? t('common.adding') : t('common.saving');
      primary.disabled    = true;
    }
    if (ghost) ghost.disabled = true;
  } else {
    progress?.classList.remove('saving');
    if (primary) {
      if (primary._origText) primary.textContent = primary._origText;
      primary.disabled = false;
    }
    if (ghost) ghost.disabled = false;
  }
}

// ── Toast ────────────────────────────────────────────────────────
export function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Confirm dialog ───────────────────────────────────────────────
export function showConfirm(title, msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    overlay.classList.add('visible');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function cleanup(result) {
      overlay.classList.remove('visible');
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      resolve(result);
    }
    document.getElementById('confirm-ok').addEventListener('click', () => cleanup(true), { once: true });
    document.getElementById('confirm-cancel').addEventListener('click', () => cleanup(false), { once: true });
  });
}

// ── Settings panel ───────────────────────────────────────────────
function openSettings() {
  const lang = getLang();
  const currency = getCurrency();
  const isKo = lang === 'ko';
  openModal({
    title: isKo ? '설정' : 'Settings',
    body: `
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">${isKo ? '언어' : 'Language'}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${lang === 'en' ? 'btn-primary' : 'btn-secondary'}" onclick="window.__setLang('en')">English</button>
          <button class="btn btn-sm ${lang === 'ko' ? 'btn-primary' : 'btn-secondary'}" onclick="window.__setLang('ko')">한국어</button>
        </div>
      </div>
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">${isKo ? '통화' : 'Display Currency'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${CURRENCIES.map(c => `
            <button class="btn btn-sm ${currency === c.code ? 'btn-primary' : 'btn-secondary'}"
              onclick="window.__setCurrency('${c.code}')">${c.symbol} ${c.code}</button>
          `).join('')}
        </div>
      </div>
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">${isKo ? '여행' : 'Trip'}</div>
        <button class="btn btn-secondary btn-sm" onclick="window.__newTrip()">${isKo ? '새 여행' : '+ New Trip'}</button>
        <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="window.__editCurrentTrip()">${isKo ? '현재 여행 수정' : 'Edit Current Trip'}</button>
        <button class="btn btn-danger btn-sm" style="margin-top:8px" onclick="window.__deleteCurrentTrip()">${isKo ? '현재 여행 삭제' : 'Delete Current Trip'}</button>
      </div>
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:6px">${isKo ? '게스트 접근' : 'Guest Access'}</div>
        <div class="text-xs text-muted" style="margin-bottom:8px">${isKo ? '이 코드를 가진 누구나 이 여행을 읽기 전용으로 볼 수 있습니다.' : 'Anyone with this code can view this trip (read-only).'}</div>
        <div id="guest-access-body"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div></div>
      </div>
      <div class="settings-group" style="margin-top:16px">
        <button class="btn btn-ghost btn-full" onclick="window.__signOut()">Sign Out</button>
      </div>
      <div class="settings-group" style="text-align:center;color:var(--muted);font-size:11px;margin-top:16px">
        Copyright ⓒ 2026, YONKE All rights reserved.<br>Version ${APP_VERSION}
      </div>
    `,
    footer: ''
  });
  setTimeout(() => _renderGuestCodeUI(), 50);
}

function _generateCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789#$&*?+!';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ch[b % ch.length]).join('');
}

async function _renderGuestCodeUI() {
  const el = document.getElementById('guest-access-body');
  if (!el || !currentTripId) return;
  const code = await getGuestCode(currentUser.uid, currentTripId).catch(() => null);
  el.innerHTML = code
    ? `<div class="guest-code-display"><span class="mono" style="font-size:20px;letter-spacing:4px">${code}</span></div>
       <div style="display:flex;gap:6px;margin-top:8px">
         <button class="btn btn-secondary btn-sm" onclick="window.__copyGuestCode('${code}')">📋 Copy</button>
         <button class="btn btn-secondary btn-sm" onclick="window.__regenGuestCode('${code}')">🔄 New</button>
         <button class="btn btn-danger btn-sm" onclick="window.__deleteGuestCode('${code}')">🗑️ Delete</button>
       </div>`
    : `<button class="btn btn-secondary btn-sm" onclick="window.__generateGuestCode()">+ Generate Guest Code</button>`;
}

window.__generateGuestCode = async () => {
  const code = _generateCode();
  setModalSaving(true);
  try {
    await setGuestCode(currentUser.uid, currentTripId, code);
    await _renderGuestCodeUI();
  } catch (e) { showToast('Error: ' + e.message); }
  finally { setModalSaving(false); }
};
window.__regenGuestCode = async (oldCode) => {
  const newCode = _generateCode();
  setModalSaving(true);
  try {
    await removeGuestCode(currentUser.uid, currentTripId, oldCode);
    await setGuestCode(currentUser.uid, currentTripId, newCode);
    await _renderGuestCodeUI();
  } catch (e) { showToast('Error: ' + e.message); }
  finally { setModalSaving(false); }
};
window.__deleteGuestCode = async (code) => {
  setModalSaving(true);
  try {
    await removeGuestCode(currentUser.uid, currentTripId, code);
    await _renderGuestCodeUI();
  } catch (e) { showToast('Error: ' + e.message); }
  finally { setModalSaving(false); }
};
window.__copyGuestCode = (code) => {
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!')).catch(() => showToast(code));
};

function openGuestSettings() {
  const lang = getLang();
  const currency = getCurrency();
  const isKo = lang === 'ko';
  openModal({
    title: isKo ? '설정' : 'Settings',
    body: `
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">${isKo ? '언어' : 'Language'}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${lang === 'en' ? 'btn-primary' : 'btn-secondary'}" onclick="window.__setLang('en')">English</button>
          <button class="btn btn-sm ${lang === 'ko' ? 'btn-primary' : 'btn-secondary'}" onclick="window.__setLang('ko')">한국어</button>
        </div>
      </div>
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">${isKo ? '통화' : 'Display Currency'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${CURRENCIES.map(c => `
            <button class="btn btn-sm ${currency === c.code ? 'btn-primary' : 'btn-secondary'}"
              onclick="window.__setCurrency('${c.code}')">${c.symbol} ${c.code}</button>
          `).join('')}
        </div>
      </div>
      <div class="settings-group" style="margin-top:16px">
        <button class="btn btn-ghost btn-full" onclick="window.__guestExit()">← ${isKo ? '나가기' : 'Exit Guest'}</button>
      </div>
      <div class="settings-group" style="text-align:center;color:var(--muted);font-size:11px;margin-top:16px">
        Copyright ⓒ 2026, YONKE All rights reserved.<br>Version ${APP_VERSION}
      </div>
    `,
    footer: ''
  });
}

window.__guestExit = async () => {
  await signOut();
  ['guestCode', 'guestOwnerUid', 'guestTripId'].forEach(k => localStorage.removeItem(k));
  isGuest = false; _guestOwnerUid = null; _guestTripId = null; _appInitialized = false;
  closeModal();
  location.reload();
};

// ── New trip form ────────────────────────────────────────────────
function openNewTrip() {
  closeModal();
  setTimeout(() => {
    _tripImageSlot = { type: 'empty', value: null, preview: null };
    openModal({
      title: 'New Trip',
      body: `
        <form id="new-trip-form">
          <div class="form-group">
            <label class="form-label">Trip Name</label>
            <input class="form-input" name="name" placeholder="e.g. Japan 2025" required>
          </div>
          <div class="form-group">
            <label class="form-label">Destination</label>
            <input class="form-input" name="destination" placeholder="e.g. Tokyo, Japan">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Start Date</label>
              <input class="form-input" name="startDate" type="date">
            </div>
            <div class="form-group">
              <label class="form-label">End Date</label>
              <input class="form-input" name="endDate" type="date">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Country</label>
            <select class="form-select" name="country">
              <option value="">— Select country —</option>
              ${COUNTRIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Base Currency</label>
            <select class="form-select" name="baseCurrency">
              ${CURRENCIES.map(c => `<option value="${c.code}">${c.symbol} ${c.code} — ${c.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Cover Photo</label>
            <div id="trip-img-slot">${tripImageSlotHTML(_tripImageSlot)}</div>
            <input type="file" id="trip-img-input" accept="image/*" style="display:none" onchange="window.__tripImgChange(this)">
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-ghost btn-full" onclick="window.__closeModal()">Cancel</button>
        <button class="btn btn-primary btn-full" onclick="window.__submitNewTrip()">Create</button>
      `
    });
  }, 100);
}

async function submitNewTrip() {
  if (_savingTrip) return;          // block queued/double clicks

  const form = document.getElementById('new-trip-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  _savingTrip = true;
  setModalSaving(true);
  const data = Object.fromEntries(new FormData(form));
  try {
    if (_tripImageSlot.type === 'file') {
      const blob = await resizeImageToBlob(_tripImageSlot.value);
      data.imageUrl = await uploadToImgBB(blob);
    } else if (_tripImageSlot.type === 'url') {
      data.imageUrl = _tripImageSlot.value;
    }
    const tripId = await createTrip(currentUser.uid, data);
    localStorage.setItem('lastTripId', tripId);
    currentTripId = tripId;
    await loadTrips(currentUser.uid);
    dispatchTripChange(tripId);
    closeModal();
    showToast('Trip created');
    navigate(localStorage.getItem('lastRoute') || 'dashboard');
  } catch (e) {
    setModalSaving(false);
    showToast('Failed to create trip: ' + e.message);
  } finally {
    _savingTrip = false;
  }
}

// ── Currency picker (quick) ──────────────────────────────────────
function openCurrencyPicker() {
  const currency = getCurrency();
  openModal({
    title: 'Display Currency',
    body: `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${CURRENCIES.map(c => `
          <button class="btn ${currency === c.code ? 'btn-primary' : 'btn-secondary'} btn-full"
            onclick="window.__setCurrency('${c.code}');window.__closeModal()">
            <span style="font-size:18px">${c.symbol}</span>
            <span style="flex:1;text-align:left;margin-left:8px">${c.code} — ${c.label}</span>
          </button>
        `).join('')}
      </div>
    `,
    footer: ''
  });
}

// ── Language picker ──────────────────────────────────────────────
function openLangPicker() {
  const lang = getLang();
  openModal({
    title: 'Language',
    body: `
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn ${lang === 'en' ? 'btn-primary' : 'btn-secondary'} btn-full"
          onclick="window.__setLang('en');window.__closeModal()">🇬🇧 English</button>
        <button class="btn ${lang === 'ko' ? 'btn-primary' : 'btn-secondary'} btn-full"
          onclick="window.__setLang('ko');window.__closeModal()">🇰🇷 한국어</button>
      </div>
    `,
    footer: ''
  });
}

// ── Global helpers (called from inline onclick) ──────────────────
window.__closeModal = closeModal;
window.__signOut = async () => {
  await signOut();
  closeModal();
  location.reload();
};
window.__setLang = (lang) => {
  setLang(lang);
  _clearAllPages();
  closeModal();
  navigate(localStorage.getItem('lastRoute') || 'dashboard');
};
window.__setCurrency = (code) => {
  setCurrency(code);
  document.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: code } }));
  _clearAllPages();
  closeModal();
  navigate(localStorage.getItem('lastRoute') || 'dashboard');
};
window.__newTrip = openNewTrip;
window.__submitNewTrip = submitNewTrip;
window.__tripImgPick = () => document.getElementById('trip-img-input')?.click();
window.__tripImgRemove = () => {
  _tripImageSlot = { type: 'empty', value: null, preview: null };
  const el = document.getElementById('trip-img-slot');
  if (el) el.innerHTML = tripImageSlotHTML(_tripImageSlot);
};
window.__tripImgChange = (input) => {
  const file = input.files[0];
  if (!file) return;
  const preview = URL.createObjectURL(file);
  _tripImageSlot = { type: 'file', value: file, preview };
  const el = document.getElementById('trip-img-slot');
  if (el) el.innerHTML = tripImageSlotHTML(_tripImageSlot);
  input.value = '';
};
window.__deleteCurrentTrip = async () => {
  if (!currentTripId) { showToast('No trip selected'); return; }
  closeModal();
  const ok = await showConfirm('Delete Current Trip', 'This will delete all trip data and cannot be undone.');
  if (!ok) return;
  try {
    await deleteTrip(currentUser.uid, currentTripId);
    currentTripId = null;
    localStorage.removeItem('lastTripId');
    _clearAllPages();
    await loadTrips(currentUser.uid);
    navigate('dashboard');
    showToast('Trip deleted');
  } catch (e) { showToast('Error: ' + e.message); }
};

window.__editCurrentTrip = async () => {
  if (!currentTripId) { showToast('No trip selected'); return; }
  closeModal();
  try {
    const trip = await getTrip(currentUser.uid, currentTripId);
    if (!trip) { showToast('Trip not found'); return; }
    _tripImageSlot = trip.imageUrl
      ? { type: 'url', value: trip.imageUrl, preview: trip.imageUrl }
      : { type: 'empty', value: null, preview: null };
    setTimeout(() => {
      openModal({
        title: 'Edit Trip',
        body: `
          <form id="edit-trip-form">
            <div class="form-group">
              <label class="form-label">Trip Name</label>
              <input class="form-input" name="name" value="${trip.name || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Destination</label>
              <input class="form-input" name="destination" value="${trip.destination || ''}" placeholder="e.g. Tokyo, Japan">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Start Date</label>
                <input class="form-input" name="startDate" type="date" value="${trip.startDate || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">End Date</label>
                <input class="form-input" name="endDate" type="date" value="${trip.endDate || ''}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Country</label>
              <select class="form-select" name="country">
                <option value="">— Select country —</option>
                ${COUNTRIES.map(c => `<option value="${c}" ${trip.country === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Base Currency</label>
              <select class="form-select" name="baseCurrency">
                ${CURRENCIES.map(c => `<option value="${c.code}" ${(trip.baseCurrency || 'KRW') === c.code ? 'selected' : ''}>${c.symbol} ${c.code} — ${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Cover Photo</label>
              <div id="trip-img-slot">${tripImageSlotHTML(_tripImageSlot)}</div>
              <input type="file" id="trip-img-input" accept="image/*" style="display:none" onchange="window.__tripImgChange(this)">
            </div>
          </form>`,
        footer: `
          <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">Cancel</button>
          <button class="btn btn-primary" style="flex:2" onclick="window.__saveEditTrip()">Save</button>`
      });
    }, 100);
  } catch (e) { showToast('Error: ' + e.message); }
};

window.__saveEditTrip = async () => {
  const form = document.getElementById('edit-trip-form');
  if (!form || !form.checkValidity()) { form?.reportValidity(); return; }
  const data = Object.fromEntries(new FormData(form));
  setModalSaving(true);
  try {
    if (_tripImageSlot.type === 'file') {
      const blob = await resizeImageToBlob(_tripImageSlot.value);
      data.imageUrl = await uploadToImgBB(blob);
    } else if (_tripImageSlot.type === 'url') {
      data.imageUrl = _tripImageSlot.value;
    } else {
      data.imageUrl = '';
    }
    await updateTrip(currentUser.uid, currentTripId, data);
    const tr = _trips.find(t => t.id === currentTripId);
    if (tr) tr.name = data.name;
    const btn = document.getElementById('trip-selector-btn');
    if (btn && currentTripId) btn.textContent = data.name;
    _clearAllPages();
    closeModal();
    showToast('Trip updated');
    navigate(localStorage.getItem('lastRoute') || 'dashboard');
  } catch (e) {
    setModalSaving(false);
    showToast('Error: ' + e.message);
  }
};

// ── Init ─────────────────────────────────────────────────────────
async function initApp(user) {
  currentUser = user;
  hideLogin();
  hideLoading();

  if (isGuest) {
    // Guest mode: fixed trip, no trip picker, hide archive tab
    currentTripId = _guestTripId;
    const trip = await getTrip(_guestOwnerUid, _guestTripId).catch(() => null);
    const btn = document.getElementById('trip-selector-btn');
    if (btn) { btn.textContent = trip?.name || 'Guest View'; btn.disabled = true; }
    const archiveTab = document.querySelector('.tab-btn[data-route="archive"]');
    if (archiveTab) archiveTab.style.display = 'none';
    window.__openTripPicker = () => {};
  } else {
    await loadTrips(user.uid);
    window.__openTripPicker = openTripPicker;
    window.__selectTrip = selectTrip;
  }

  // Bind nav tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  // Bind header buttons
  document.getElementById('settings-btn').addEventListener('click', isGuest ? openGuestSettings : openSettings);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    _clearAllPages();
    navigate(localStorage.getItem('lastRoute') || 'dashboard');
  });

  // Bind modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-root').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-root')) closeModal();
  });

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW:', e));
  }

  // Navigate to last route
  const route = localStorage.getItem('lastRoute') || 'dashboard';
  navigate(route);
}

// ── Auth debug logger ────────────────────────────────────────────
window._alog = (msg) => {
  console.log('[auth]', msg);
  const el = document.getElementById('auth-debug');
  if (!el) return;
  const ts = new Date().toISOString().slice(11, 23);
  el.textContent += `[${ts}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

// ── Bootstrap ────────────────────────────────────────────────────
document.getElementById('google-login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('google-login-btn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Opening Google Sign-In…';
  _alog('button clicked — calling signInWithGoogle()');
  try {
    await signInWithGoogle();
    _alog('signInWithGoogle() resolved — waiting for onAuthStateChanged');
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    _alog('signInWithGoogle() ERROR: ' + e.code + ' — ' + e.message);
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
      return;
    }
    showToast('Sign-in failed (' + (e.code || 'unknown') + ')');
    console.error('[auth] signInWithGoogle error:', e.code, e.message);
  }
});

document.getElementById('guest-enter-btn').addEventListener('click', async () => {
  const code = document.getElementById('guest-code-input').value.trim();
  if (!code) return;
  _pendingGuestCode = code;
  const btn = document.getElementById('guest-enter-btn');
  btn.disabled = true;
  btn.textContent = 'Verifying…';
  try {
    await signInAnonymously();
  } catch (e) {
    _pendingGuestCode = null;
    btn.disabled = false;
    btn.textContent = 'Enter as Guest';
    showToast('Error: ' + e.message);
  }
});

// handleRedirectResult() MUST be awaited before onAuthStateChanged is
// registered. Without the await, Firebase fires an initial null auth state
// before the redirect result is processed, which triggers showLogin() even
// after a successful redirect sign-in. The async IIFE makes this sequential.
(async () => {
  _alog('page load — awaiting handleRedirectResult()');
  const redirectUser = await handleRedirectResult();
  _alog('handleRedirectResult() done — user: ' + (redirectUser ? redirectUser.email : 'null'));

  onAuthStateChange(async (user, err) => {
    if (err === 'access_denied') {
      _alog('onAuthStateChanged → access_denied');
      _appInitialized = false;
      hideLoading();
      showLogin();
      showToast('Access denied. This app is private.');
      return;
    }
    if (!user) {
      _alog('onAuthStateChanged → null (appInitialized=' + _appInitialized + ')');
      if (!_appInitialized) {
        hideLoading();
        showLogin();
      }
      return;
    }
    if (_appInitialized) return;
    _appInitialized = true;

    if (user.isAnonymous) {
      _alog('onAuthStateChanged → anonymous guest');
      const code = _pendingGuestCode || localStorage.getItem('guestCode');
      _pendingGuestCode = null;
      const info = code ? await lookupGuestCode(code).catch(() => null) : null;
      if (!info) {
        await signOut();
        _appInitialized = false;
        ['guestCode', 'guestOwnerUid', 'guestTripId'].forEach(k => localStorage.removeItem(k));
        hideLoading();
        showLogin();
        const btn = document.getElementById('guest-enter-btn');
        if (btn) { btn.disabled = false; btn.textContent = 'Enter as Guest'; }
        showToast('Invalid or expired code');
        return;
      }
      isGuest = true;
      _guestOwnerUid = info.ownerUid;
      _guestTripId = info.tripId;
      localStorage.setItem('guestCode', code);
      localStorage.setItem('guestOwnerUid', info.ownerUid);
      localStorage.setItem('guestTripId', info.tripId);
      initApp(user);
      return;
    }

    _alog('onAuthStateChanged → ' + user.email + ' (appInitialized=' + _appInitialized + ')');
    initApp(user);
  });
})();
