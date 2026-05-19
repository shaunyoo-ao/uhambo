import { t, getLang } from '../i18n.js';
import { subscribePacking, addPackingItem, deletePackingItem, togglePackingItem, updatePackingItem, getTrip } from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving } from '../app.js';

let _ctx = null;
let _unsub = null;
let _items = [];
let _trip = null;
let _fab = null;
let _seedAttempted = false;
let _drag = null;

const CATEGORIES = ['Critical', 'Electronics', 'Health', 'Clothing', 'Comfort', 'Food'];

const CAT_EMOJI = {
  Critical: '⚠️', Electronics: '📱', Health: '💊',
  Clothing: '👔', Comfort: '😌', Food: '🍜',
};

const DEFAULTS = [
  { en: 'Passport',               ko: '여권',                category: 'Critical',    isRequired: true  },
  { en: 'Credit / Debit Card',    ko: '신용카드 / 체크카드', category: 'Critical',    isRequired: true  },
  { en: 'Travel Insurance Docs',  ko: '여행 보험 서류',      category: 'Critical',    isRequired: true  },
  { en: 'Local Cash',             ko: '현지 현금',           category: 'Critical',    isRequired: true  },
  { en: 'Phone Charger',          ko: '휴대폰 충전기',       category: 'Electronics', isRequired: false },
  { en: 'Universal Adapter',      ko: '여행용 어댑터',       category: 'Electronics', isRequired: false },
  { en: 'Power Bank',             ko: '보조 배터리',         category: 'Electronics', isRequired: false },
  { en: 'Earphones / Headphones', ko: '이어폰 / 헤드폰',    category: 'Electronics', isRequired: false },
  { en: 'Camera',                 ko: '카메라',              category: 'Electronics', isRequired: false },
  { en: 'Pain Reliever',          ko: '진통제',              category: 'Health',      isRequired: false },
  { en: 'Sunscreen',              ko: '선크림',              category: 'Health',      isRequired: false },
  { en: 'Hand Sanitizer',         ko: '손 소독제',           category: 'Health',      isRequired: false },
  { en: 'First Aid Kit',          ko: '구급 키트',           category: 'Health',      isRequired: false },
  { en: 'Hangover Remedy',        ko: '숙취 해소제',         category: 'Health',      isRequired: false },
  { en: 'Underwear (×3)',         ko: '속옷 (×3)',           category: 'Clothing',    isRequired: false },
  { en: 'Socks (×3)',             ko: '양말 (×3)',           category: 'Clothing',    isRequired: false },
  { en: 'Comfortable Shoes',      ko: '편한 신발',           category: 'Clothing',    isRequired: false },
  { en: 'Neck Pillow',            ko: '목베개',              category: 'Comfort',     isRequired: false },
  { en: 'Eye Mask',               ko: '안대',                category: 'Comfort',     isRequired: false },
  { en: 'Earplugs',               ko: '귀마개',              category: 'Comfort',     isRequired: false },
  { en: 'Water Bottle',           ko: '물병',                category: 'Comfort',     isRequired: false },
  { en: 'Reusable Bag',           ko: '에코백',              category: 'Comfort',     isRequired: false },
  { en: 'Snacks',                 ko: '간식',                category: 'Food',        isRequired: false },
  { en: 'Instant Noodles',        ko: '라면',                category: 'Food',        isRequired: false },
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
    const ordered = [...catItems].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    html += `<div class="pack-category">
      <div class="pack-category-label">${CAT_EMOJI[cat]} ${_catLabel(cat)}</div>
    </div>`;
    for (const item of ordered) {
      const esc = item.title.replace(/'/g, '&#39;');
      html += `<div class="pack-item${item.isPacked ? ' pack-item--packed' : ''}" data-id="${item.id}" data-cat="${item.category}">
        <button class="pack-check" onclick="window.__togglePackItem('${item.id}', ${item.isPacked})"
          aria-label="${item.isPacked ? 'Unpack' : 'Pack'} ${esc}">
          ${_checkboxSVG(item.isPacked)}
        </button>
        <span class="pack-item-title">${item.title}</span>
        ${item.assignee ? `<span class="pack-assignee">${item.assignee}</span>` : ''}
        ${!isGuest ? `<button class="pack-delete" onclick="window.__deletePackItem('${item.id}')" aria-label="Delete">&#10005;</button>` : ''}
        ${!isGuest ? `<button class="pack-drag-handle" aria-label="Reorder">⠿</button>` : ''}
      </div>`;
    }
  }
  listEl.innerHTML = html || `<div class="empty-state" style="margin-top:40px"><div class="empty-sub">No items yet</div></div>`;
}

// ── Drag & Drop ───────────────────────────────────────────────────

function _onTouchStart(e) {
  const handle = e.target.closest('.pack-drag-handle');
  if (!handle) return;
  const itemEl = handle.closest('.pack-item[data-id]');
  if (!itemEl) return;
  e.preventDefault();

  const t0 = e.touches[0];
  const rect = itemEl.getBoundingClientRect();
  const ghost = itemEl.cloneNode(true);
  ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;` +
    `z-index:60;pointer-events:none;background:var(--surface-2);border-radius:6px;` +
    `box-shadow:0 4px 20px rgba(0,0,0,0.5);`;
  document.body.appendChild(ghost);

  itemEl.classList.add('pack-item--dragging');
  _drag = { id: itemEl.dataset.id, ghost, touchY: t0.clientY, itemEl };

  document.addEventListener('touchmove', _onTouchMove, { passive: false });
  document.addEventListener('touchend', _onTouchEnd);
}

function _onTouchMove(e) {
  if (!_drag) return;
  e.preventDefault();

  const t0 = e.touches[0];
  const dy = t0.clientY - _drag.touchY;
  _drag.touchY = t0.clientY;
  _drag.ghost.style.top = (parseFloat(_drag.ghost.style.top) + dy) + 'px';

  document.querySelectorAll('.pack-item--drag-over').forEach(el => el.classList.remove('pack-item--drag-over'));
  const els = document.elementsFromPoint(t0.clientX, t0.clientY);
  const target = els.find(el => el.matches?.('.pack-item[data-id]') && el.dataset.id !== _drag.id);
  if (target) target.classList.add('pack-item--drag-over');
}

async function _onTouchEnd() {
  document.removeEventListener('touchmove', _onTouchMove);
  document.removeEventListener('touchend', _onTouchEnd);
  if (!_drag) return;

  _drag.ghost.remove();
  _drag.itemEl.classList.remove('pack-item--dragging');

  const targetEl = document.querySelector('.pack-item--drag-over');
  document.querySelectorAll('.pack-item--drag-over').forEach(el => el.classList.remove('pack-item--drag-over'));

  const { id: dragId } = _drag;
  _drag = null;

  if (!targetEl || targetEl.dataset.id === dragId) return;

  const dragItem = _items.find(i => i.id === dragId);
  const targetItem = _items.find(i => i.id === targetEl.dataset.id);
  if (!dragItem || !targetItem || dragItem.category !== targetItem.category) return;

  const catItemEls = [...document.querySelectorAll(`.pack-item[data-cat="${dragItem.category}"]`)];
  const orderedIds = catItemEls.map(el => el.dataset.id).filter(id => id !== dragId);
  const targetIdx = orderedIds.indexOf(targetEl.dataset.id);
  orderedIds.splice(targetIdx, 0, dragId);

  await Promise.all(orderedIds.map((id, idx) =>
    updatePackingItem(_ctx.userId, _ctx.tripId, id, { sortOrder: idx * 1000 })
  ));
}

function _bindDrag() {
  const listEl = document.getElementById('packing-list');
  if (listEl) listEl.addEventListener('touchstart', _onTouchStart, { passive: false });
}

// ── Render & Export ───────────────────────────────────────────────

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
      ${!ctx.isGuest ? `<button class="icon-btn" onclick="window.__resetPacking()" aria-label="${isKo ? '초기화' : 'Reset'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
      </button>` : ''}
    </div>
    <div class="packing-progress-wrap">
      <div class="packing-progress-bar"><div id="packing-bar-fill" style="width:0%"></div></div>
      <span id="packing-progress-text" class="packing-progress-text">0 / 0 ${t('packing.packed')}</span>
    </div>
    <div id="packing-list" class="packing-list">
      <div class="loading-center" style="padding-top:40px"><div class="spinner"></div></div>
    </div>`;

  try { _trip = await getTrip(ctx.userId, ctx.tripId); } catch (_) {}

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

  window.__resetPacking = async () => {
    if (_ctx?.isGuest) return;
    const ok = await showConfirm(
      isKo ? '목록 초기화' : 'Reset List',
      isKo ? '모든 항목을 삭제하고 기본 목록으로 초기화할까요?' : 'Delete all items and reset to defaults?'
    );
    if (!ok) return;
    const toDelete = [..._items];
    _seedAttempted = false;
    await Promise.all(toDelete.map(item => deletePackingItem(_ctx.userId, _ctx.tripId, item.id)));
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
    const catItems = _items.filter(i => i.category === category);
    const maxOrder = catItems.reduce((max, i) => Math.max(max, i.sortOrder ?? 0), 0);
    setModalSaving(true);
    try {
      await addPackingItem(_ctx.userId, _ctx.tripId, { title, category, isPacked: false, isRequired: false, assignee, sortOrder: maxOrder + 1000 });
      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    }
  };

  _unsub = subscribePacking(ctx.userId, ctx.tripId, async (items) => {
    _items = items;
    if (!_seedAttempted && items.length === 0) {
      _seedAttempted = true;
      try {
        const lang = getLang();
        await Promise.all(DEFAULTS.map((d, idx) => addPackingItem(ctx.userId, ctx.tripId, {
          title: lang === 'ko' ? d.ko : d.en,
          category: d.category,
          isPacked: false,
          isRequired: d.isRequired,
          assignee: '',
          sortOrder: idx * 1000,
        })));
      } catch (e) {
        renderList();
      }
      return;
    }
    renderList();
  }, (err) => {
    const listEl = document.getElementById('packing-list');
    if (listEl) listEl.innerHTML = `<div class="empty-state" style="margin-top:40px"><div class="empty-icon">⚠️</div><div class="empty-sub">${err.message}</div></div>`;
  });

  _bindDrag();

  if (!ctx.isGuest) {
    _fab = document.createElement('button');
    _fab.className = 'fab';
    _fab.dataset.route = '__packing__';
    _fab.style.display = '';
    _fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
    _fab.addEventListener('click', () => window.__openAddPackItem());
    container.appendChild(_fab);
  }
}

export function destroy() {
  document.removeEventListener('touchmove', _onTouchMove);
  document.removeEventListener('touchend', _onTouchEnd);
  if (_drag?.ghost) _drag.ghost.remove();
  _drag = null;
  _unsub?.();
  _unsub = null;
  _items = [];
  _trip = null;
  _fab?.remove();
  _fab = null;
}
