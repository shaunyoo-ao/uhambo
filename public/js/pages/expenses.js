import { t } from '../i18n.js';
import { subscribeExpenses, addExpense, updateExpense, deleteExpense } from '../db.js';
import { openModal, closeModal, showToast, showConfirm } from '../app.js';
import { formatConverted, convert, getCurrency, getCurrencyMeta, formatCurrency, ensureRates, CURRENCIES } from '../currency.js';

let _unsub = null;
let _ctx = null;
let _items = [];
let _filterCat = 'all';
let _adding = false;
let _links = [];

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.querySelector('.fab')?.remove();
}

const CAT_ICONS = {
  transport: '🚗', food: '🍔', accom: '🏨',
  activity: '⚡', shopping: '🛍️', other: '💳'
};
const CATS = ['transport', 'food', 'accom', 'activity', 'shopping', 'other'];

export async function render(container, ctx) {
  _ctx = ctx;
  const { userId, tripId } = ctx;

  if (!tripId) {
    container.innerHTML = noTripHTML();
    return;
  }

  container.innerHTML = `
    <div style="padding:14px 16px 8px">
      <div class="eyebrow" style="margin-bottom:2px">${t('nav.expenses')}</div>
      <div class="page-title">Expenses</div>
    </div>
    <div id="exp-summary" style="padding:0 16px 12px">
      <div class="spinner" style="width:18px;height:18px;border-width:2px"></div>
    </div>
    <div class="chip-row" id="exp-chips">
      <div class="chip active" data-cat="all" onclick="window.__expFilter('all')">All</div>
      ${CATS.map(c => `<div class="chip" data-cat="${c}" onclick="window.__expFilter('${c}')">${CAT_ICONS[c]} ${t('exp.cats.' + c)}</div>`).join('')}
    </div>
    <div id="exp-list"><div class="loading-center"><div class="spinner"></div></div></div>
    <div style="height:80px"></div>`;

  addFAB(() => {
    if (_adding) return;
    openItemModal(null);
  });

  window.__expFilter = (cat) => {
    _filterCat = cat;
    document.querySelectorAll('#exp-chips .chip').forEach(c =>
      c.classList.toggle('active', c.dataset.cat === cat));
    renderList(_items);
  };

  if (_unsub) _unsub();
  _unsub = subscribeExpenses(userId, tripId, async items => {
    _items = items;
    await renderSummary(items);
    renderList(items);
  });
}

async function renderSummary(items) {
  const el = document.getElementById('exp-summary');
  if (!el) return;

  await ensureRates();
  const currency = getCurrency();

  let total = 0;
  const byCat = {};
  for (const e of items) {
    const amt = await convert(e.amount || 0, e.currency || 'KRW', currency);
    total += amt;
    const cat = e.category || 'other';
    byCat[cat] = (byCat[cat] || 0) + amt;
  }

  const totalStr = formatCurrency(total, currency);

  el.innerHTML = `
    <div class="card">
      <div class="card-body" style="padding:12px 14px">
        <div class="row-between" style="margin-bottom:12px">
          <div>
            <div class="eyebrow" style="margin-bottom:2px">${t('exp.total')}</div>
            <div class="mono text-xl text-accent">${totalStr}</div>
          </div>
          <div style="text-align:right">
            <div class="eyebrow" style="margin-bottom:2px">${items.length} ${t('exp.items').toLowerCase()}</div>
            <div class="text-sm text-muted">${currency}</div>
          </div>
        </div>
        ${items.length > 0 ? `
          <canvas id="exp-chart" class="chart-canvas" width="180" height="180"></canvas>
          <div id="exp-legend" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px"></div>
        ` : ''}
      </div>
    </div>`;

  if (items.length > 0) {
    drawPieChart(byCat, total);
  }
}

function drawPieChart(byCat, total) {
  const canvas = document.getElementById('exp-chart');
  const legend = document.getElementById('exp-legend');
  if (!canvas || total === 0) return;

  const ctx2d = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 8;

  const COLORS = {
    transport: '#6ea6e8', food: '#e8c87c', accom: '#5fb88c',
    activity: '#ee6c3a', shopping: '#d97a7a', other: '#7c8089'
  };

  ctx2d.clearRect(0, 0, W, H);

  let angle = -Math.PI / 2;
  const entries = Object.entries(byCat).filter(([, v]) => v > 0);

  entries.forEach(([cat, val]) => {
    const sweep = (val / total) * 2 * Math.PI;
    ctx2d.beginPath();
    ctx2d.moveTo(cx, cy);
    ctx2d.arc(cx, cy, r, angle, angle + sweep);
    ctx2d.closePath();
    ctx2d.fillStyle = COLORS[cat] || '#7c8089';
    ctx2d.fill();
    angle += sweep;
  });

  ctx2d.beginPath();
  ctx2d.arc(cx, cy, r * 0.52, 0, 2 * Math.PI);
  ctx2d.fillStyle = '#16181c';
  ctx2d.fill();

  if (legend) {
    legend.innerHTML = entries.map(([cat, val]) => {
      const pct = Math.round((val / total) * 100);
      return `<div class="badge" style="background:${COLORS[cat] || '#7c8089'}22;color:${COLORS[cat] || '#7c8089'};border:1px solid ${COLORS[cat] || '#7c8089'}44">
        ${CAT_ICONS[cat]} ${pct}%
      </div>`;
    }).join('');
  }
}

async function renderList(items) {
  const el = document.getElementById('exp-list');
  if (!el) return;

  const filtered = _filterCat === 'all' ? items : items.filter(i => i.category === _filterCat);

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding-top:40px">
      <div class="empty-icon">💳</div>
      <div class="empty-title">${_filterCat === 'all' ? t('common.empty') : 'No ' + _filterCat + ' expenses'}</div>
      ${_filterCat === 'all' ? `<div class="empty-sub">${t('exp.tap_add')}</div>` : ''}
    </div>`;
    return;
  }

  const currency = getCurrency();
  const rows = await Promise.all(filtered.map(async e => {
    const displayAmt = await formatConverted(e.amount || 0, e.currency || 'KRW');
    const meta = getCurrencyMeta(e.currency || 'KRW');
    const origAmt = e.currency !== currency
      ? `<div class="text-xs text-muted">${meta.symbol}${Number(e.amount).toLocaleString()}</div>`
      : '';
    const syncBadge = e.sourceType
      ? `<div class="badge badge-sky" style="margin-top:4px;font-size:10px">↔ ${e.sourceType}</div>`
      : '';
    return `
      <div class="list-item" onclick="window.__editExpItem('${e.id}')">
        <div class="list-icon" style="background:var(--surface-2)">${CAT_ICONS[e.category] || '💳'}</div>
        <div class="list-content">
          <div class="list-title">${e.title || '—'}</div>
          <div class="list-sub">${e.date || ''} ${e.category ? '· ' + t('exp.cats.' + e.category) : ''}</div>
        </div>
        <div class="list-meta">
          <div class="mono text-sm text-accent">${displayAmt}</div>
          ${origAmt}
          ${syncBadge}
        </div>
      </div>`;
  }));

  el.innerHTML = rows.join('');

  window.__editExpItem = (id) => {
    const item = _items.find(i => i.id === id);
    if (item) openItemModal(item);
  };
}

function linkListHTML(links) {
  return (links || []).map((url, i) => `
    <div class="link-item">
      <a href="${url}" target="_blank" rel="noopener">${url}</a>
      <button type="button" class="link-item-del" onclick="window.__expRmLink(${i})">×</button>
    </div>`).join('');
}

function openItemModal(item) {
  const isEdit = !!item;
  const today = new Date().toISOString().slice(0, 10);
  _links = item?.links ? [...item.links] : [];

  openModal({
    title: isEdit ? 'Edit Expense' : t('exp.add'),
    body: `
      <form id="exp-form">
        <div class="form-group">
          <label class="form-label">${t('exp.name')} *</label>
          <input class="form-input" name="title" value="${item?.title || ''}" placeholder="e.g. Dinner at Sukiyabashi" required>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label class="form-label">${t('exp.amount')} *</label>
            <input class="form-input" name="amount" type="number" min="0" step="any" value="${item?.amount || ''}" placeholder="0" required>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">${t('exp.currency')}</label>
            <select class="form-select" name="currency">
              ${CURRENCIES.map(c => `<option value="${c.code}" ${(item?.currency || getCurrency()) === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('exp.category')}</label>
          <select class="form-select" name="category">
            ${CATS.map(c => `<option value="${c}" ${(item?.category || 'other') === c ? 'selected' : ''}>${CAT_ICONS[c]} ${t('exp.cats.' + c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('exp.date')}</label>
          <input class="form-input" name="date" type="date" value="${item?.date || today}">
        </div>
        <div class="form-group">
          <label class="form-label">${t('common.links')}</label>
          <div class="link-list" id="exp-link-list">${linkListHTML(_links)}</div>
          <div class="link-add-row">
            <input class="form-input" id="exp-link-input" placeholder="https://..." type="url">
            <button type="button" class="btn btn-secondary btn-sm link-add-btn" onclick="window.__expAddLink()">+</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">${t('exp.notes')}</label>
          <textarea class="form-textarea" name="notes" placeholder="Optional notes…">${item?.notes || ''}</textarea>
        </div>
      </form>`,
    footer: `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="window.__deleteExpItem('${item.id}')">Delete</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveExpItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}</button>`
  });

  window.__expAddLink = () => {
    const inp = document.getElementById('exp-link-input');
    const val = inp.value.trim();
    if (!val) return;
    _links.push(val);
    inp.value = '';
    const el = document.getElementById('exp-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };
  window.__expRmLink = (i) => {
    _links.splice(i, 1);
    const el = document.getElementById('exp-link-list');
    if (el) el.innerHTML = linkListHTML(_links);
  };

  window.__saveExpItem = async (id) => {
    if (_adding) return;
    const form = document.getElementById('exp-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = Object.fromEntries(new FormData(form));
    data.amount = Number(data.amount);
    data.links = _links;
    _adding = true;
    try {
      if (id) {
        await updateExpense(_ctx.userId, _ctx.tripId, id, data);
        showToast('Expense updated');
      } else {
        await addExpense(_ctx.userId, _ctx.tripId, data);
        showToast('Expense added');
      }
      closeModal();
    } catch (e) { showToast('Error: ' + e.message); }
    finally { _adding = false; }
  };

  window.__deleteExpItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Expense', 'This cannot be undone.');
    if (!confirmed) return;
    try {
      await deleteExpense(_ctx.userId, _ctx.tripId, id);
      showToast('Expense deleted');
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
    <div class="empty-icon">💳</div>
    <div class="empty-title">${t('common.no_trip')}</div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="window.__newTrip()">+ New Trip</button>
  </div>`;
}
