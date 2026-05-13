import { t } from '../i18n.js';
import { subscribeExpenses, addExpense, updateExpense, deleteExpense } from '../db.js';
import { openModal, closeModal, showToast, showConfirm, setModalSaving } from '../app.js';
import { openCalc } from '../calculator.js';
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
  transport: '🚗', food: '🍽️', accom: '🏨',
  activity: '⚡', shopping: '🛍️', other: '💳'
};
const CAT_COLORS = {
  transport: '#6ea6e8', food: '#e8c87c', accom: '#5fb88c',
  activity: '#ee6c3a', shopping: '#d97a7a', other: '#7c8089'
};
const CATS = ['food', 'shopping', 'transport', 'activity', 'accom', 'other'];

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

  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

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
        ${catEntries.map(([cat, val]) => {
          const pct = total > 0 ? Math.round((val / total) * 100) : 0;
          return `
            <div style="margin-bottom:10px">
              <div class="row-between" style="margin-bottom:3px">
                <div class="row gap-6">
                  <span>${CAT_ICONS[cat] || '💳'}</span>
                  <span class="text-sm">${t('exp.cats.' + cat)}</span>
                </div>
                <div class="row gap-8">
                  <span class="text-xs text-muted mono">${pct}%</span>
                  <span class="mono text-sm text-accent">${formatCurrency(val, currency)}</span>
                </div>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width:${pct}%;background:${CAT_COLORS[cat] || 'var(--accent)'}"></div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
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
    title: isEdit ? t('modal.edit_expense') : t('exp.add'),
    body: `
      <form id="exp-form">
        <div class="form-group">
          <label class="form-label">${t('exp.name')} *</label>
          <input class="form-input" name="title" value="${item?.title || ''}" placeholder="e.g. Dinner at Sukiyabashi" required>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:2">
            <label class="form-label">${t('exp.amount')} *</label>
            <div style="display:flex;gap:6px">
              <input id="exp-amount-input" class="form-input" name="amount" type="number" min="0" step="any" value="${item?.amount || ''}" placeholder="0" required style="flex:1">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.__openCalc('exp-amount-input')" style="flex-shrink:0;padding:0 10px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.5" fill="currentColor" stroke="none"/><circle cx="9" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></svg></button>
            </div>
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
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="window.__deleteExpItem('${item.id}')">${t('common.delete')}</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="window.__closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" style="flex:2" onclick="window.__saveExpItem(${isEdit ? `'${item.id}'` : 'null'})">
        ${isEdit ? t('common.save') : t('common.add')}</button>`
  });

  window.__openCalc = openCalc;

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
    setModalSaving(true);
    try {
      if (id) {
        await updateExpense(_ctx.userId, _ctx.tripId, id, data);
        showToast(t('toast.expense_updated'));
      } else {
        await addExpense(_ctx.userId, _ctx.tripId, data);
        showToast(t('toast.expense_added'));
      }
      closeModal();
    } catch (e) {
      setModalSaving(false);
      showToast('Error: ' + e.message);
    } finally { _adding = false; }
  };

  window.__deleteExpItem = async (id) => {
    closeModal();
    const confirmed = await showConfirm('Delete Expense', 'This cannot be undone.');
    if (!confirmed) return;
    try {
      await deleteExpense(_ctx.userId, _ctx.tripId, id);
      showToast(t('toast.expense_deleted'));
    } catch (e) { showToast('Error: ' + e.message); }
  };
}

function addFAB(onClick) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.dataset.route = 'expenses';
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
