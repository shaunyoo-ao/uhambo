import { signInWithGoogle, signOut, onAuthStateChange, handleRedirectResult } from './auth.js';
import { setLang, getLang, t } from './i18n.js';
import { setCurrency, getCurrency, CURRENCIES } from './currency.js';
import { getTrips, createTrip } from './db.js';

// ── Global state ────────────────────────────────────────────────
export let currentUser = null;
export let currentTripId = null;
let currentPage = null;
let _appInitialized = false; // guard against duplicate initApp calls

// ── Page registry ────────────────────────────────────────────────
const routes = {
  dashboard:     () => import('./pages/dashboard.js'),
  itinerary:     () => import('./pages/itinerary.js'),
  accommodation: () => import('./pages/accommodation.js'),
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
  const sel = document.getElementById('trip-selector');
  try {
    const trips = await getTrips(userId);
    sel.innerHTML = '';
    if (trips.length === 0) {
      sel.innerHTML = '<option value="">— No trips —</option>';
    } else {
      trips.forEach(trip => {
        const opt = document.createElement('option');
        opt.value = trip.id;
        opt.textContent = trip.name;
        sel.appendChild(opt);
      });
    }
    // Restore last trip or use first
    const saved = localStorage.getItem('lastTripId');
    if (saved && trips.find(t => t.id === saved)) {
      sel.value = saved;
      currentTripId = saved;
    } else if (trips.length > 0) {
      sel.value = trips[0].id;
      currentTripId = trips[0].id;
    }
  } catch (e) {
    console.error('loadTrips:', e);
  }
}

function dispatchTripChange(tripId) {
  document.dispatchEvent(new CustomEvent('tripchange', { detail: { tripId } }));
}

// ── Router ───────────────────────────────────────────────────────
export async function navigate(route) {
  if (!routes[route]) route = 'dashboard';

  // Update nav
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.route === route));

  const container = document.getElementById('page-content');
  container.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  // Cleanup previous page and FAB
  if (currentPage?.destroy) currentPage.destroy();
  document.querySelector('.fab')?.remove();
  currentPage = null;

  try {
    const mod = await routes[route]();
    currentPage = mod;
    await mod.render(container, { userId: currentUser.uid, tripId: currentTripId });
    localStorage.setItem('lastRoute', route);
  } catch (e) {
    console.error('navigate:', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Failed to load</div><div class="empty-sub">${e.message}</div></div>`;
  }
}

// ── Modal ────────────────────────────────────────────────────────
export function openModal({ title, body, footer, onClose }) {
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
  openModal({
    title: 'Settings',
    body: `
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">Language</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm ${lang === 'en' ? 'btn-primary' : 'btn-secondary'}" onclick="window.__setLang('en')">English</button>
          <button class="btn btn-sm ${lang === 'ko' ? 'btn-primary' : 'btn-secondary'}" onclick="window.__setLang('ko')">한국어</button>
        </div>
      </div>
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">Currency</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${CURRENCIES.map(c => `
            <button class="btn btn-sm ${currency === c.code ? 'btn-primary' : 'btn-secondary'}"
              onclick="window.__setCurrency('${c.code}')">${c.symbol} ${c.code}</button>
          `).join('')}
        </div>
      </div>
      <div class="settings-group">
        <div class="eyebrow" style="margin-bottom:10px">Trip</div>
        <button class="btn btn-secondary btn-sm" onclick="window.__newTrip()">+ New Trip</button>
      </div>
      <div class="settings-group" style="margin-top:24px">
        <button class="btn btn-ghost btn-full" onclick="window.__signOut()">Sign Out</button>
      </div>
    `,
    footer: ''
  });
}

// ── New trip form ────────────────────────────────────────────────
function openNewTrip() {
  closeModal();
  setTimeout(() => {
    openModal({
      title: 'New Trip',
      body: `
        <div id="trip-save-progress" class="modal-progress"></div>
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
            <label class="form-label">Base Currency</label>
            <select class="form-select" name="baseCurrency">
              ${CURRENCIES.map(c => `<option value="${c.code}">${c.symbol} ${c.code} — ${c.label}</option>`).join('')}
            </select>
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
  const form = document.getElementById('new-trip-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const createBtn = document.querySelector('#modal-root .btn-primary');
  const cancelBtn = document.querySelector('#modal-root .btn-ghost');
  const progress  = document.getElementById('trip-save-progress');

  createBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  createBtn.textContent = 'Saving…';
  if (progress) progress.classList.add('saving');

  const data = Object.fromEntries(new FormData(form));
  try {
    const tripId = await createTrip(currentUser.uid, data);
    await loadTrips(currentUser.uid);
    document.getElementById('trip-selector').value = tripId;
    currentTripId = tripId;
    localStorage.setItem('lastTripId', tripId);
    dispatchTripChange(tripId);
    closeModal();
    showToast('Trip created');
    navigate(localStorage.getItem('lastRoute') || 'dashboard');
  } catch (e) {
    if (progress) progress.classList.remove('saving');
    createBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    createBtn.textContent = 'Create';
    showToast('Failed to create trip: ' + e.message);
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
  closeModal();
  navigate(localStorage.getItem('lastRoute') || 'dashboard');
};
window.__setCurrency = (code) => {
  setCurrency(code);
  document.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: code } }));
};
window.__newTrip = openNewTrip;
window.__submitNewTrip = submitNewTrip;

// ── Init ─────────────────────────────────────────────────────────
async function initApp(user) {
  currentUser = user;
  hideLogin();
  hideLoading();

  await loadTrips(user.uid);

  // Bind trip selector
  document.getElementById('trip-selector').addEventListener('change', e => {
    currentTripId = e.target.value;
    localStorage.setItem('lastTripId', currentTripId);
    dispatchTripChange(currentTripId);
    navigate(localStorage.getItem('lastRoute') || 'dashboard');
  });

  // Bind nav tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route));
  });

  // Bind header buttons
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('lang-btn').addEventListener('click', openLangPicker);
  document.getElementById('currency-btn').addEventListener('click', openCurrencyPicker);

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

// handleRedirectResult() MUST be awaited before onAuthStateChanged is
// registered. Without the await, Firebase fires an initial null auth state
// before the redirect result is processed, which triggers showLogin() even
// after a successful redirect sign-in. The async IIFE makes this sequential.
(async () => {
  _alog('page load — awaiting handleRedirectResult()');
  const redirectUser = await handleRedirectResult();
  _alog('handleRedirectResult() done — user: ' + (redirectUser ? redirectUser.email : 'null'));

  onAuthStateChange((user, err) => {
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
    _alog('onAuthStateChanged → ' + user.email + ' (appInitialized=' + _appInitialized + ')');
    if (_appInitialized) return;
    _appInitialized = true;
    initApp(user);
  });
})();
