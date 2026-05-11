// ── Calculator overlay ───────────────────────────────────────────
// Safe recursive-descent expression parser: +, -, ×, ÷, %, (, )
// % is treated as /100 on a trailing number: 15% → 0.15

let _targetId = null;
let _expr = '';
let _lastWasResult = false;

function safeEval(expr) {
  // Normalise display symbols to JS operators
  const e = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d+\.?\d*)%/g, '($1/100)');

  // Tokenise
  const tokens = [];
  let i = 0;
  while (i < e.length) {
    if (/\s/.test(e[i])) { i++; continue; }
    if (/[\d.]/.test(e[i])) {
      let n = '';
      while (i < e.length && /[\d.]/.test(e[i])) n += e[i++];
      tokens.push({ t: 'num', v: parseFloat(n) });
    } else if ('+-*/()'.includes(e[i])) {
      tokens.push({ t: 'op', v: e[i++] });
    } else { i++; }
  }

  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseExpr() {
    let left = parseTerm();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = consume().v;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek() && (peek().v === '*' || peek().v === '/')) {
      const op = consume().v;
      const right = parseFactor();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function parseFactor() {
    if (peek()?.v === '-') { consume(); return -parseFactor(); }
    if (peek()?.v === '+') { consume(); return parseFactor(); }
    if (peek()?.v === '(') {
      consume();
      const val = parseExpr();
      if (peek()?.v === ')') consume();
      return val;
    }
    if (peek()?.t === 'num') return consume().v;
    return 0;
  }

  const result = parseExpr();
  return isFinite(result) ? result : null;
}

function updateDisplay() {
  const exprEl = document.getElementById('calc-expr');
  const dispEl = document.getElementById('calc-display');
  if (exprEl) exprEl.textContent = _expr || '';
  if (dispEl) {
    if (_expr === '') { dispEl.textContent = '0'; return; }
    // Show live result if expression is complete enough
    try {
      const r = safeEval(_expr);
      dispEl.textContent = r !== null ? formatNum(r) : _expr;
    } catch (_) {
      dispEl.textContent = _expr;
    }
  }
}

function formatNum(n) {
  if (n === null || isNaN(n)) return 'Error';
  // Trim unnecessary decimals, max 10 sig figs
  const s = parseFloat(n.toPrecision(10)).toString();
  return s;
}

export function openCalc(targetInputId) {
  _targetId = targetInputId;
  const el = document.getElementById(targetInputId);
  _expr = el ? (el.value || '') : '';
  _lastWasResult = false;
  const root = document.getElementById('calc-root');
  if (root) root.classList.add('visible');
  updateDisplay();
}

export function closeCalc() {
  const root = document.getElementById('calc-root');
  if (root) root.classList.remove('visible');
  _targetId = null;
  _expr = '';
}

// Attached to window so HTML buttons can call them
window.__calcInput = (ch) => {
  const ops = ['+', '-', '×', '÷', '%'];
  const isOp = ops.includes(ch);
  const lastCh = _expr.slice(-1);
  const lastIsOp = ops.includes(lastCh);

  if (_lastWasResult && !isOp && ch !== '.') {
    // Start fresh number after result (unless continuing with operator)
    _expr = '';
  }
  _lastWasResult = false;

  if (ch === '(') {
    _expr += '(';
  } else if (ch === ')') {
    // auto-insert ) only if there's an unmatched (
    const opens = (_expr.match(/\(/g) || []).length;
    const closes = (_expr.match(/\)/g) || []).length;
    if (opens > closes) _expr += ')';
  } else if (isOp) {
    if (lastIsOp) _expr = _expr.slice(0, -1); // replace last op
    _expr += ch;
  } else if (ch === '.') {
    // Find current number segment
    const seg = _expr.split(/[+\-×÷()]/).pop();
    if (!seg.includes('.')) _expr += '.';
  } else {
    _expr += ch;
  }
  updateDisplay();
};

window.__calcClear = () => {
  _expr = '';
  _lastWasResult = false;
  updateDisplay();
};

window.__calcEval = () => {
  if (!_expr) return;
  const r = safeEval(_expr);
  if (r !== null) {
    _expr = formatNum(r);
    _lastWasResult = true;
  }
  updateDisplay();
};

window.__calcClose = () => closeCalc();

window.__calcParen = () => {
  const opens = (_expr.match(/\(/g) || []).length;
  const closes = (_expr.match(/\)/g) || []).length;
  if (opens > closes) {
    _expr += ')';
  } else {
    const lastCh = _expr.slice(-1);
    if (/[\d)]/.test(lastCh)) _expr += '×';
    _expr += '(';
  }
  _lastWasResult = false;
  updateDisplay();
};

window.__calcConfirm = () => {
  window.__calcEval();
  if (_targetId) {
    const el = document.getElementById(_targetId);
    if (el) {
      const r = safeEval(_expr);
      el.value = r !== null ? formatNum(r) : _expr;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  closeCalc();
};
