// بنك التعابير: لوحة سفلية للبحث والإدراج السريع داخل التقرير
import { $, $$, esc, norm, toast, debounce } from './util.js';
import { highlight } from './data.js';
let el, api, st, q = '', mode = 'add', tab = 'phrases', openSet = new Set(), secs = [];
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
  st = study; q = o.query || ''; openSet = new Set(); tab = 'phrases'; renderAll(); el.classList.add('open'); changed();
  if (q) setTimeout(() => { const f = $('.phr', el); if (f) f.scrollIntoView({block: 'start'}); }, 60);
}
export function closeBank() { if (el) { el.classList.remove('open'); changed(); } }

const tokens = s => norm(s).split(' ').filter(Boolean);
function renderAll() {
  el.innerHTML = `<div class="bk-head">
    <div class="bk-top"><b>📖 Phrase bank <small style="font-weight:600;color:#5b6f82">— ${esc(st.bank_title ? st.title : st.title)}</small></b><button type="button" data-bk="close" aria-label="Close">✕</button></div>
    <div class="pop"><span>◐ See-through</span><input type="range" id="bkPop" min="25" max="100" step="5" value="${api.getPop()}" aria-label="Panel transparency"></div>
    <div class="seg" data-bktab><button type="button" data-t="phrases" aria-pressed="${tab === 'phrases'}">Phrase bank</button><button type="button" data-t="versions" aria-pressed="${tab === 'versions'}">Copy from versions (${st.variants.length})</button></div>
    <input class="fi" id="bkQ" type="search" placeholder="${tab === 'phrases' ? 'Search phrases in this study…' : 'Search inside the versions…'}" value="${esc(q)}" autocomplete="off">
    <div class="seg" data-bkmode><button type="button" data-m="add" aria-pressed="${mode === 'add'}">＋ Add as new item</button><button type="button" data-m="replace" aria-pressed="${mode === 'replace'}">⇄ Replace current item</button></div>
    <div class="hint" id="bkHint"></div></div><div class="bk-body" id="bkBody"></div>`;
  renderBody();
}
let flat = [];
function renderBody() {
  const body = $('#bkBody', el); flat = []; secs = [];
  if (tab === 'versions') return renderVersions(body);
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
  const tb = e.target.closest('[data-t]'); if (tb) { tab = tb.dataset.t; q = ''; renderAll(); return; }
  const m = e.target.closest('[data-m]'); if (m) { mode = m.dataset.m; $$('[data-bkmode] button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode))); return; }
  const b = e.target.closest('[data-bk]'); if (!b) { const s = e.target.closest('summary'); if (s) { const d = s.parentElement, gi = /^v/.test(d.dataset.gi) ? d.dataset.gi : +d.dataset.gi; setTimeout(() => { d.open ? openSet.add(gi) : openSet.delete(gi); }, 0); } return; }
  if (b.dataset.bk === 'vins' || b.dataset.bk === 'vrep') { const sec = secs[+b.dataset.s]; if (sec) api.insertSection(sec.blocks, b.dataset.bk === 'vrep'); return; }
  const a = b.dataset.bk;
  if (a === 'close') { closeBank(); return; }
  const row = b.closest('.phr'), f = row && flat[+row.dataset.f];
  if (a === 'ins' && f) { api.insertPhrase(f.text, f.kind, mode); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); }
  else if (a === 'cp' && f) copy(f.text);
  else if (a === 'apply') { const g = st.bank[+b.dataset.gi]; if (g && api.applyCase(g)) closeBank(); }
}

// Copy from other versions of the same study (Blank / Normal / Limited …)
function sectionsOf(v) {
  const out = []; let cur = null;
  (v.blocks || []).forEach(b => { if (b.t === 'h1' || !cur) { cur = {title: b.t === 'h1' ? b.x : '', blocks: []}; out.push(cur); } cur.blocks.push(b); });
  return out;
}
function renderVersions(body) {
  const t = tokens(q);
  $('#bkHint', el).textContent = 'Open a version, then tap a line to insert it (after the item you are on), or copy a whole section into the report. “Replace” swaps the same-named section already in your report.';
  let html = '';
  st.variants.forEach((v, vi) => {
    let inner = '';
    sectionsOf(v).forEach(sec => {
      const kind = api.kindOfTitle(sec.title), si = secs.length; secs.push(sec);
      const rows = sec.blocks.filter(b => b.t === 'li').filter(b => !t.length || t.every(w => (norm(b.x) + ' ' + norm(sec.title)).includes(w)));
      if (t.length && !rows.length) return;
      let list = '';
      sec.blocks.forEach(b => {
        if (b.t === 'h2') { if (!t.length) list += `<div class="sub-t">${esc(b.x)}</div>`; }
        else if (b.t === 'li' && rows.includes(b)) { flat.push({text: b.x, kind}); list += `<div class="phr" data-f="${flat.length - 1}"><div class="tx" data-bk="ins">${highlight(b.x, q)}</div><button type="button" class="cp" data-bk="cp" aria-label="Copy">⎘</button></div>`; }
      });
      inner += `<div class="sec-h"><b>${esc(sec.title || 'Content')}</b><span><button type="button" class="btn sm dark" data-bk="vins" data-s="${si}">＋ Insert</button><button type="button" class="btn sm" data-bk="vrep" data-s="${si}">⇄ Replace</button></span></div>${list}`;
    });
    if (!inner) return;
    const open = t.length || openSet.has('v' + vi) ? ' open' : '';
    html += `<details class="case" data-gi="v${vi}"${open}><summary>${esc(v.label)}${v.id === (window.__curVariant || '') ? ' <small>(current)</small>' : ''}</summary><div class="case-body">${inner}</div></details>`;
  });
  body.innerHTML = html || '<div class="empty">Nothing matches.</div>';
}
