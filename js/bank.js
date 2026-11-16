// بنك التعابير: لوحة سفلية للبحث والإدراج السريع داخل التقرير
import { $, $$, esc, norm, toast, debounce } from './util.js';
import { highlight } from './data.js';
let el, api, st, q = '', mode = 'add', openSet = new Set();
export const bankOpen = () => !!el && el.classList.contains('open');
const changed = () => window.__bankChanged && window.__bankChanged();

export function initBank(a) {
  api = a; el = $('#bank'); el.hidden = false;
  if (el.dataset.bound) return; el.dataset.bound = '1';
  el.addEventListener('click', onClick);
  el.addEventListener('input', e => { if (e.target.id === 'bkPop') api.setPop(+e.target.value); });
  el.addEventListener('input', debounce(e => { if (e.target.id === 'bkQ') { q = e.target.value; renderBody(); } }, 160));
}
export function openBank(study, o = {}) {
  st = study; q = o.query || ''; openSet = new Set(); renderAll(); el.classList.add('open'); changed();
  if (q) setTimeout(() => { const f = $('.phr', el); if (f) f.scrollIntoView({block: 'start'}); }, 60);
}
export function closeBank() { if (el) { el.classList.remove('open'); changed(); } }

const tokens = s => norm(s).split(' ').filter(Boolean);
function renderAll() {
  el.innerHTML = `<div class="bk-head">
    <div class="bk-top"><b>📖 Phrase bank <small style="font-weight:600;color:#5b6f82">— ${esc(st.bank_title ? st.title : st.title)}</small></b><button type="button" data-bk="close" aria-label="Close">✕</button></div>
    <div class="pop"><span>◐ See-through</span><input type="range" id="bkPop" min="25" max="100" step="5" value="${api.getPop()}" aria-label="Panel transparency"></div>
    <input class="fi" id="bkQ" type="search" placeholder="Search phrases in this study…" value="${esc(q)}" autocomplete="off">
    <div class="seg" data-bkmode><button type="button" data-m="add" aria-pressed="${mode === 'add'}">＋ Add as new item</button><button type="button" data-m="replace" aria-pressed="${mode === 'replace'}">⇄ Replace current item</button></div>
    <div class="hint" id="bkHint"></div></div><div class="bk-body" id="bkBody"></div>`;
  renderBody();
}
let flat = [];
function renderBody() {
  const body = $('#bkBody', el); flat = [];
  const t = tokens(q), bank = st.bank || [];
  $('#bkHint', el).textContent = api.hasCursor() ? 'Tap a phrase to insert it after the item you are on (Impression / Indication phrases go to their own section).' : 'Tap a phrase to insert it into the matching section of the report. The ⎘ icon only copies the text.';
  if (!bank.length) { body.innerHTML = '<div class="empty">No phrase bank for this study yet.</div>'; return; }
  let html = '', shown = 0;
  bank.forEach((g, gi) => {
    const gt = norm(g.title);
    const block = (items, si, sub) => {
      const rows = items.map((x, ii) => ({x, ii})).filter(({x}) => !t.length || t.every(w => (norm(x) + ' ' + gt + ' ' + (sub ? norm(sub.title) : '')).includes(w)));
      return rows.map(({x, ii}) => { flat.push({text: x, kind: sub ? sub.kind : ''}); shown++;
        return `<div class="phr" data-f="${flat.length - 1}"><div class="tx" data-bk="ins">${highlight(x, q)}</div><button type="button" class="cp" data-bk="cp" aria-label="Copy">⎘</button></div>`; }).join('');
    };
    let inner = block(g.items, -1, null);
    g.subs.forEach((s, si) => { const b = block(s.items, si, s); if (b) inner += `<div class="sub-t">${esc(s.title)}</div>${b}`; });
    if (!inner) return;
    const canApply = g.subs.some(s => s.kind && s.items.length);
    const open = t.length || openSet.has(gi) ? ' open' : '';
    html += `<details class="case" data-gi="${gi}"${open}><summary>${esc(g.title)}</summary><div class="case-body">${canApply ? `<div class="case-act"><button type="button" class="btn sm dark" data-bk="apply" data-gi="${gi}">✓ Apply this whole case to the report</button></div>` : ''}${inner}</div></details>`;
  });
  body.innerHTML = html || '<div class="empty">No matching phrases.</div>';
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
  toast('Copied');
}
function onClick(e) {
  const m = e.target.closest('[data-m]'); if (m) { mode = m.dataset.m; $$('[data-bkmode] button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode))); return; }
  const b = e.target.closest('[data-bk]'); if (!b) { const s = e.target.closest('summary'); if (s) { const d = s.parentElement, gi = +d.dataset.gi; setTimeout(() => { d.open ? openSet.add(gi) : openSet.delete(gi); }, 0); } return; }
  const a = b.dataset.bk;
  if (a === 'close') { closeBank(); return; }
  const row = b.closest('.phr'), f = row && flat[+row.dataset.f];
  if (a === 'ins' && f) { api.insertPhrase(f.text, f.kind, mode); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); }
  else if (a === 'cp' && f) copy(f.text);
  else if (a === 'apply') { const g = st.bank[+b.dataset.gi]; if (g && api.applyCase(g)) closeBank(); }
}
