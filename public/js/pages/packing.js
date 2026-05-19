import { t, getLang } from '../i18n.js';
import { subscribePacking, addPackingItem, deletePackingItem, togglePackingItem, getTrip } from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving } from '../app.js';

let _ctx = null;
let _unsub = null;
let _items = [];
let _trip = null;
let _fab = null;
let _seedAttempted = false;

const CATEGORIES = ['Critical', 'Electronics', 'Health', 'Clothing', 'Comfort', 'Food'];

const CAT_EMOJI = {
  Critical: '⚠️', Electronics: '📱', Health: '💊',
  Clothing: '👔', Comfort: '😌', Food: '🍜',
};

const DEFAULTS = [
  { title: 'Passport',              category: 'Critical',    isRequired: true  },
  { title: 'Credit / Debit Card',   category: 'Critical',    isRequired: true  },
  { title: 'Travel Insurance Docs', category: 'Critical',    isRequired: true  },
  { title: 'Emergency Contacts',    category: 'Critical',    isRequired: true  },
  { title: 'Local Cash',            category: 'Critical',    isRequired: true  },
  { title: 'Phone Charger',         category: 'Electronics', isRequired: false },
  { title: 'Universal Adapter',     category: 'Electronics', isRequired: false },
  { title: 'Power Bank',            category: 'Electronics', isRequired: false },
  { title: 'Earphones / Headphones',category: 'Electronics', isRequired: false },
  { title: 'Camera',                category: 'Electronics', isRequired: false },
  { title: 'Prescription Medicine', category: 'Health',      isRequired: false },
  { title: 'Pain Reliever',         category: 'Health',      isRequired: false },
  { title: 'Band-Aids / Plasters',  category: 'Health',      isRequired: false },
  { title: 'Sunscreen',             category: 'Health',      isRequired: false },
  { title: 'Hand Sanitizer',        category: 'Health',      isRequired: false },
  { title: 'Underwear (×3)',        category: 'Clothing',    isRequired: false },
  { title: 'Socks (×3)',            category: 'Clothing',    isRequired: false },
  { title: 'T-Shirts',              category: 'Clothing',    isRequired: false },
  { title: 'Jacket / Hoodie',       category: 'Clothing',    isRequired: false },
  { title: 'Comfortable Shoes',     category: 'Clothing',    isRequired: false },
  { title: 'Neck Pillow',           category: 'Comfort',     isRequired: false },
  { title: 'Eye Mask',              category: 'Comfort',     isRequired: false },
  { title: 'Earplugs',              category: 'Comfort',     isRequired: false },
  { title: 'Water Bottle',          category: 'Comfort',     isRequired: false },
  { title: 'Reusable Bag',          category: 'Comfort',     isRequired: false },
  { title: 'Snacks',                category: 'Food',        isRequired: false },
  { title: 'Instant Noodles',       category: 'Food',        isRequired: false },
  { title: 'Korean Instant Food',   category: 'Food',        isRequired: false },
];

function _travelerLabels() {
  const travelers = _trip?.travelers || [];
  if (!travelers.length) return [];
  const countByRelation = {};
  travelers.forEach(tr => { countByRelation[tr.relation] = (countByRelation[tr.relation] || 0) + 1; });
  const seen = {};
  return travelers.map(tr => {
    const rel = tr.relation;
    if (countByRelation[rel] > 1) {
      seen[rel] = (seen[rel] || 0) + 1;
      return `${rel} #${seen[rel]}`;
    }
    return rel;
  });
}

function _catLabel(cat) {
  const map = {
    Critical: 'packing.cat_crit', Electronics: 'packing.cat_elec',
    Health: 'packing.cat_hlth', Clothing: 'packing.cat_clth',
    Comfort: 'packing.cat_cmft', Food: 'packing.cat_food',
  };
  return t(map[cat] || cat);
}

function _checkboxSVG(packed) {
  if (packed) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <polyline points="8 12 11 15 16 9" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
  </svg>`;
}

function renderList() {
  const listEl = document.getElementById('packing-list');
  const fillEl = document.getElementById('packing-bar-fill');
  const textEl = document.getElementById('packing-progress-text');
  if (!listEl) return;

  const total = _items.length;
  const packed = _items.filter(i => i.isPacked).length;
  const pct = total > 0 ? Math.round((packed / total) * 100) : 0;
  if (fillEl) fillEl.style.width = pct + '%';
  if (textEl) textEl.textContent = `${packed} / ${total} ${t('packing.packed')}`;

  const isGuest = _ctx?.isGuest;
  let html = '';
  for (const cat of CATEGORIES) {
    const catItems = _items.filter(i => i.category === cat);
    if (!catItems.length) continue;
    const required = catItems.filter(i => i.isRequired);
    const optional = catItems.filter(i => !i.isRequired);
    const ordered = [...required, ...optional];
    html += `<div class="pack-category">
      <div class="pack-category-label">${CAT_EMOJI[cat]} ${_catLabel(cat)}</div>
    </div>`;
    for (const item of ordered) {
      const esc = item.title.replace(/'/g, '&#39;');
      html += `<div class="pack-item${item.isPacked ? ' pack-item--packed' : ''}">
        <button class="pack-check" onclick="window.__togglePackItem('${item.id}', ${item.isPacked})"
          aria-label="${item.isPacked ? 'Unpack' : 'Pack'} ${esc}">
          ${_checkboxSVG(item.isPacked)}
        </button>
        <span class="pack-item-title">${item.title}</span>
        ${item.assignee ? `<span class="pack-assignee">${item.assignee}</span>` : ''}
        ${!item.isRequired && !isGuest
          ? `<button class="pack-delete" onclick="window.__deletePackItem('${item.id}')" aria-label="Delete">&#10005;</button>`
          : ''}
      </div>`;
    }
  }
  listEl.innerHTML = html || `<div class="empty-state" style="margin-top:40px"><div class="empty-sub">No items yet</div></div>`;
}

export async function render(container, ctx) {
  _ctx = ctx;
  _seedAttempted = false;
  _trip = null;

  const isKo = getLang() === 'ko';

  container.innerHTML = `
    <div class="packing-header">
      <button class="icon-btn" onclick="window.__closePacking()" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h2 class="packing-title">${t('packing.title')}</h2>
    </div>
    <div class="packing-progress-wrap">
      <div class="packing-progress-bar"><div id="packing-bar-fill" style="width:0%"></div></div>
      <span id="packing-progress-text" class="packing-progress-text">0 / 0 ${t('packing.packed')}</span>
    </div>
    <div id="packing-list" class="packing-list">
      <div class="loading-center" style="padding-top:40px"><div class="spinner"></div></div>
    </div>`;

  // Fetch trip for travelers
  try { _trip = await getTrip(ctx.userId, ctx.tripId); } catch (_) {}

  // Register globals
  window.__closePacking = () => {
    document.getElementById('packing-panel').style.display = 'none';
    destroy();
  };

  window.__togglePackItem = (id, isPacked) => {
    if (_ctx?.isGuest) return;
    togglePackingItem(_ctx.userId, _ctx.tripId, id, !isPacked);
  };

  window.__deletePackItem = async (id) => {
    if (_ctx?.isGuest) return;
    const ok = await showConfirm(isKo ? '항목 삭제' : 'Delete item', isKo ? '이 항목을 삭제할까요?' : 'Remove this item?');
    if (ok) deletePackingItem(_ctx.userId, _ctx.tripId, id);
  };

  window.__openAddPackItem = () => {
    const labels = _travelerLabels();
    const assigneeField = labels.length
      ? `<select class="form-select" id="pack-assignee-select">
           <option value="">— ${isKo ? '담당자 없음' : 'No assignee'} —</option>
           ${labels.map(l => `<option value="${l}">${l}</option>`).join('')}
         </select>`
      : `<input class="form-input" id="pack-assignee-select" placeholder="${isKo ? '담당자 (선택)' : 'Assignee (optional)'}">`;

    openModal({
      title: t('packing.add'),
      body: `
        <div class="form-group">
          <label class="form-label">${isKo ? '항목 이름' : 'Item name'}</label>
          <input class="form-input" id="pack-title-input" placeholder="${isKo ? '예: 세면도구' : 'e.g. Toiletries'}" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label">${isKo ? '카테고리' : 'Category'}</label>
          <select class="form-select" id="pack-cat-select">
            ${CATEGORIES.map(c => `<option value="${c}">${_catLabel(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${isKo ? '담당자' : 'Assignee'}</label>
          ${assigneeField}
        </div>`,
      footer: `
        <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${isKo ? '취소' : 'Cancel'}</button>
        <button class="btn btn-primary" style="flex:2" onclick="window.__savePackItem()">${isKo ? '추가' : 'Add'}</button>`,
    });
    setTimeout(() => document.getElementById('pack-title-input')?.focus(), 100);
  };

  window.__savePackItem = async () => {
    const titleEl = document.getElementById('pack-title-input');
    const catEl = document.getElementById('pack-cat-select');
    const assigneeEl = document.getElementById('pack-assignee-select');
    const title = titleEl?.value.trim();
    if (!title) { titleEl?.focus(); return; }
    const category = catEl?.value || 'Critical';
    const assignee = assigneeEl?.value || '';
    setModalSaving(true);
    try {
      await addPackingItem(_ctx.userId, _ctx.tripId, { title, category, isPacked: false, isRequired: false, assignee });
      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    }
  };

  // Subscribe (seed on first empty snapshot)
  _unsub = subscribePacking(ctx.userId, ctx.tripId, async (items) => {
    _items = items;
    if (!_seedAttempted && items.length === 0) {
      _seedAttempted = true;
      await Promise.all(DEFAULTS.map(d => addPackingItem(ctx.userId, ctx.tripId, { ...d, isPacked: false, assignee: '' })));
      return;
    }
    renderList();
  });

  // FAB
  if (!ctx.isGuest) {
    _fab = document.createElement('button');
    _fab.className = 'fab';
    _fab.dataset.route = '__packing__';
    _fab.style.display = '';
    _fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
    _fab.addEventListener('click', () => window.__openAddPackItem());
    document.getElementById('app').appendChild(_fab);
  }
}

export function destroy() {
  _unsub?.();
  _unsub = null;
  _items = [];
  _trip = null;
  _fab?.remove();
  _fab = null;
}
