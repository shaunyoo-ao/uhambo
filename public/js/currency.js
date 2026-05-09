export const CURRENCIES = [
  { code: 'KRW', symbol: '₩', label: 'Korean Won',          decimals: 0 },
  { code: 'USD', symbol: '$', label: 'US Dollar',            decimals: 2 },
  { code: 'EUR', symbol: '€', label: 'Euro',                 decimals: 2 },
  { code: 'ZAR', symbol: 'R', label: 'South African Rand',   decimals: 2 },
];

let _currency = localStorage.getItem('currency') || 'KRW';
let _rates = null; // rates relative to KRW base

const CACHE_KEY = 'fx_rates';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export function getCurrency() { return _currency; }

export function setCurrency(code) {
  _currency = code;
  localStorage.setItem('currency', code);
}

export function getCurrencyMeta(code) {
  return CURRENCIES.find(c => c.code === code) || CURRENCIES[0];
}

export async function ensureRates() {
  if (_rates) return _rates;

  // Check cache
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    if (cached.ts && Date.now() - cached.ts < CACHE_TTL && cached.rates) {
      _rates = cached.rates;
      return _rates;
    }
  } catch (_) {}

  // Fetch fresh
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/KRW');
    const data = await res.json();
    if (data.result === 'success') {
      _rates = data.rates;
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rates: _rates }));
      return _rates;
    }
  } catch (_) {}

  // Fallback static rates (approximate)
  _rates = { KRW: 1, USD: 0.00075, EUR: 0.00069, ZAR: 0.01372 };
  return _rates;
}

export async function convert(amount, fromCode, toCode) {
  if (!amount || fromCode === toCode) return amount || 0;
  const rates = await ensureRates();
  // Convert via KRW as base
  const inKRW = amount / (rates[fromCode] || 1);
  return inKRW * (rates[toCode] || 1);
}

export function formatCurrency(amount, code) {
  const meta = getCurrencyMeta(code);
  if (code === 'KRW') {
    return `₩${Math.round(amount).toLocaleString('ko-KR')}`;
  }
  return `${meta.symbol}${Number(amount).toFixed(meta.decimals)}`;
}

export async function formatConverted(amount, fromCode) {
  const to = _currency;
  const converted = await convert(amount, fromCode, to);
  return formatCurrency(converted, to);
}
