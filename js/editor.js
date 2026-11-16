// Editor: real A4 pages, patient fields, items, free-floating blocks (text / signature / stamp), control panel
import { $, $$, esc, clamp, r1, uid, toast, choose, confirmBox, openSheet, closeSheet, readImg, debounce } from './util.js';
import * as St from './store.js';
import * as Data from './data.js';
import { initBank, openBank, closeBank, bankOpen } from './bank.js';
import * as Exp from './export.js';

const VAR_DESC = {
  template: 'Ready template: normal values pre-written, with [ ] fields to edit (fastest)',
  blank: 'Blank: headings only, you write everything',
  normal: 'Complete normal study example',
  limited: 'Limited / non-diagnostic case',
  other: 'Other version',
};
const KIND_EN = {template: 'Template', blank: 'Blank', normal: 'Normal', limited: 'Limited', other: 'Version'};
const STD_FIELDS = ['Patient Name', 'Date', 'Age / Sex', 'Referred By'];

/* ===== حالة المحرر ===== */
let D = null, study = null, busy = false, tbd = null, lastW = 0;
const cur = {atom: null};
const PAGES = $('#pages'), stage = $('#stage'), scaler = $('#scaler'), panel = $('#panel');
const S = () => St.settings;
const pages = () => $$('.page', PAGES);
const atomsList = () => $$('.pg-body > .atom', PAGES);
const docAtoms = () => atomsList();
const isOpen = () => !$('#editor').hidden;

/* ===== بناء عناصر التقرير ===== */
const phHtml = t => esc(t).replace(/\[[^\]\n]{1,300}\]|_{3,}/g, m => `<span class="ph">${m}</span>`);
const ce = (cls, html, extra = '') => `<div class="c ${cls}" contenteditable="true" ${extra}>${html}</div>`;
const fmtDate = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
const A = {
  meta: (fields, vals = {}) => `<div class="atom a-meta" data-k="meta"><div class="meta-grid">${fields.map(f => A.mf(f, vals[f] ?? (/^date$/i.test(f) ? fmtDate() : ''))).join('')}</div></div>`,
  mf: (label, val = '') => `<div class="mf">${ce('ml', esc(label), 'data-ph="Label"')}${ce('mv', esc(val), 'dir="auto"')}</div>`,
  title: t => `<div class="atom a-title" data-k="title">${ce('', phHtml(t))}</div>`,
  h1: t => `<div class="atom a-h1" data-k="h1">${ce('', phHtml(t))}</div>`,
  h2: t => `<div class="atom a-h2" data-k="h2">${ce('', phHtml(t))}</div>`,
  li: (html = '') => `<div class="atom a-li" data-k="li">${ce('', html, 'data-ph="Type here"')}</div>`,
  p: (html = '') => `<div class="atom a-p" data-k="p">${ce('', html, 'data-ph="Type here"')}</div>`,
};
export function atomsFromVariant(v, vals) {
  const out = [A.meta(v.fields || STD_FIELDS, vals), A.title(v.title)];
  v.blocks.forEach(b => out.push(b.t === 'li' ? A.li(phHtml(b.x)) : b.t === 'h2' ? A.h2(b.x) : A.h1(b.x)));
  return out;
}
export function makeDraft(st, variantId) {
  const v = st.variants.find(x => x.id === variantId) || st.variants[0];
  return {id: St.newDraftId(), studyId: st.id, variantId: v.id, title: st.title, created: Date.now(), edited: false,
    atoms: atomsFromVariant(v), tb: [], sigInit: false, fit: false, patient: ''};
}
const newNode = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/* ===== الهوية: الترويسة والتذييل والعلامة المائية ===== */
let hdrHas = false, ftrHas = false;
function renderBrand() {
  const b = St.brand(), h = b.header || {}, f = b.footer || {}, w = b.watermark || {};
  hdrHas = !!(h.line1 || h.line2 || h.line3 || h.logoRight || h.logoLeft);
  ftrHas = !!(f.line1 || f.line2);
  const img = (s, c) => s ? `<img class="hdr-logo" src="${esc(s)}" alt="">` : `<span class="hdr-logo empty"></span>`;
  const headHtml = hdrHas ? `<div class="hdr-row">${img(h.logoLeft)}<div class="hdr-mid"><div class="l1">${esc(h.line1 || '')}</div><div class="l2">${esc(h.line2 || '')}</div><div class="l3">${esc(h.line3 || '')}</div></div>${img(h.logoRight)}</div>` : '';
  const footHtml = `<div class="f1">${esc(f.line1 || '')}</div><div class="f2">${esc(f.line2 || '')}</div>`;
  pages().forEach(pg => {
    $('.pg-head', pg).innerHTML = headHtml; $('.f-in', pg).innerHTML = footHtml;
    const wm = $('.wm', pg); wm.hidden = !(w.image && S().wmOn); if (w.image) wm.src = w.image;
    pg.style.setProperty('--wm', (S().wmOp || 8) / 100);
  });
}
const fmtNum = (i, N) => { const m = S().pn; return m === 'n' ? String(i) : m === 'nofm' ? `${i} / ${N}` : m === 'page' ? `Page ${i} of ${N}` : ''; };
function makePage() {
  const pg = document.createElement('section'); pg.className = 'page';
  pg.innerHTML = '<img class="wm" alt="" hidden><header class="pg-head" hidden></header><div class="pg-body"></div><footer class="pg-foot"><div class="f-line"></div><div class="f-in"></div><div class="pg-num"></div></footer>';
  return pg;
}
function ensurePages(n) { while (pages().length < n) PAGES.appendChild(makePage()); if (pages().length) renderBrandNew(); }
let brandDirty = true;
function renderBrandNew() { if (brandDirty || pages().some(p => !p.dataset.b)) { renderBrand(); pages().forEach(p => p.dataset.b = '1'); brandDirty = false; } }
function applyPageVis(N) {
  const s = S();
  pages().forEach((pg, i) => {
    $('.pg-head', pg).hidden = !hdrHas || s.hdr === 'none' || (s.hdr === 'first' && i > 0);
    const hasText = ftrHas && !(s.ftr === 'none' || (s.ftr === 'last' && i !== N - 1));
    const hasNum = s.pn !== 'off';
    const hasLine = s.fline === 'on' || (s.fline !== 'off' && hasText);
    const foot = $('.pg-foot', pg), num = $('.pg-num', pg);
    $('.f-in', pg).hidden = !hasText; $('.f-line', pg).hidden = !hasLine;
    num.hidden = !hasNum; num.className = 'pg-num pn-' + (s.pnPos === 'l' ? 'l' : 'r'); num.textContent = fmtNum(i + 1, N);
    foot.hidden = !(hasText || hasNum || hasLine);
    foot.classList.toggle('hasnum', hasNum && hasText);
    foot.classList.toggle('numonly', hasNum && !hasText);
    foot.classList.toggle('lineonly', hasLine && !hasText && !hasNum);
  });
}

/* ===== محرّك التوزيع على الصفحات ===== */
function capOf(p) {
  const pg = pages()[Math.min(p, pages().length - 1)]; const b = $('.pg-body', pg), cs = getComputedStyle(b);
  return b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 1;
}
function flags(atoms) { atoms.forEach(a => { const k = a.dataset.k; if (k === 'meta' || k === 'title' || k === 'h1' || k === 'h2') a.dataset.kn = '1'; else delete a.dataset.kn; }); }
function assign(atoms, hs) {
  const pg = new Array(atoms.length); let p = 0, used = 0, i = 0;
  const cap = q => capOf(q);
  while (i < atoms.length) {
    let j = i; while (j < atoms.length - 1 && atoms[j].dataset.kn) j++;
    let gh = 0; for (let k = i; k <= j; k++) gh += hs[k];
    if (used > 0 && used + gh > cap(p) && gh <= cap(p + 1)) { p++; used = 0; }
    for (let k = i; k <= j; k++) { if (used > 0 && used + hs[k] > cap(p)) { p++; used = 0; } pg[k] = p; used += hs[k]; }
    i = j + 1;
  }
  return {pg, count: p + 1};
}
function saveSel() {
  const ae = document.activeElement; if (!ae || !ae.isContentEditable) return null;
  const s = getSelection(); if (!s.rangeCount) return {el: ae};
  const r = s.getRangeAt(0); if (!ae.contains(r.startContainer)) return {el: ae};
  const pre = document.createRange(); pre.selectNodeContents(ae); pre.setEnd(r.startContainer, r.startOffset);
  const so = pre.toString().length; pre.setEnd(r.endContainer, r.endOffset);
  return {el: ae, so, eo: pre.toString().length};
}
function restoreSel(st) {
  if (!st || !st.el.isConnected) return;
  if (document.activeElement === st.el) return;
  st.el.focus({preventScroll: true});
  if (st.so == null) return;
  const w = document.createTreeWalker(st.el, NodeFilter.SHOW_TEXT); let n, acc = 0, a = null, b = null;
  while ((n = w.nextNode())) { const l = n.nodeValue.length; if (!a && acc + l >= st.so) a = [n, st.so - acc]; if (!b && acc + l >= st.eo) { b = [n, st.eo - acc]; break; } acc += l; }
  if (a) { const r = document.createRange(); r.setStart(...a); r.setEnd(...(b || a)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
const setK = k => PAGES.style.setProperty('--k', String(k));
function reflow() {
  if (busy || !D) return; busy = true;
  const sel = saveSel();
  try {
    if (!pages().length) PAGES.appendChild(makePage());
    ensurePages(1);
    const atoms = atomsList();
    flags(atoms);
    const run = () => {
      let N = Math.max(1, pages().length), res = null;
      for (let it = 0; it < 5; it++) {
        ensurePages(N); applyPageVis(N);
        const hs = atoms.map(a => a.offsetHeight);
        res = assign(atoms, hs); res.used = hs.reduce((a, b) => a + b, 0);
        if (res.count === N) break; N = res.count;
      }
      return res;
    };
    setK(1); let res = run();
    if (D.fit && res.count > 1) {          // ملاءمة صفحة واحدة: تصغير الخط تدريجياً
      let k = 1;
      while (res.count > 1 && k > 0.46) { k = Math.round((k - 0.03) * 100) / 100; setK(k); res = run(); }
    }
    if (D.fit && res.count === 1) {        // اترك مكاناً للتوقيع (نص التوقيع) أسفل المحتوى
      const need = () => Math.max(0, ...$$('.float[data-sg]', PAGES).map(f => f.offsetHeight + 6));
      let k = parseFloat(PAGES.style.getPropertyValue('--k')) || 1;
      while (res.count === 1 && res.used + need() > capOf(0) && k > 0.46) { k = Math.round((k - 0.03) * 100) / 100; setK(k); res = run(); }
    }
    ensurePages(res.count); applyPageVis(res.count);
    const pgs = pages();
    pgs.forEach((pg, pi) => {
      const body = $('.pg-body', pg), want = atoms.filter((a, i) => res.pg[i] === pi);
      want.forEach((a, idx) => { const c = body.children[idx]; if (c !== a) body.insertBefore(a, c || null); });
    });
    pgs.slice(res.count).forEach(p => { $$('.float', p).forEach(f => pgs[res.count - 1].appendChild(f)); p.remove(); });
    applyPageVis(res.count); scaleView();
  } finally { busy = false; restoreSel(sel); }
}
const schedReflow = debounce(reflow, 90);
function scaleView() {
  if (!stage.offsetWidth) return;
  const avail = document.documentElement.clientWidth - 12, fit = Math.min(1, avail / stage.offsetWidth), k = fit * (S().zoom || 1);
  stage.style.transform = `scale(${k})`; stage.dataset.k = k;
  scaler.style.width = Math.round(stage.offsetWidth * k) + 'px'; scaler.style.height = Math.round(stage.offsetHeight * k) + 'px';
  $$('.sig-pad', PAGES).forEach(fitPad);
}

/* ===== العناصر الحرة: نص / توقيع (نص) / لوحة توقيع / ختم — كلها تُحرَّك وتُحذف وتُضاف بحرية ===== */
const defaultSigHtml = () => { const b = St.brand().signature || {}; return S().sigText ?? `${esc(b.line1 || 'Best Regards,')}<div>${esc(b.line2 || 'Dr. ..............................................')}</div>`; };
const stampSrc = () => (St.brand().stamp || {}).image || '';
const bar = t => `<div class="fl-bar no-print" contenteditable="false"><button type="button" data-tb="mv" aria-label="Move">✥ Move</button><button type="button" data-tb="rs" aria-label="Resize">↔</button><button type="button" data-act="fend" aria-label="Move to end of report">⇩ End</button><button type="button" data-act="fdel" aria-label="Delete">✕</button></div>`;
const posStyle = o => `left:${o.x}%;top:${o.y}%;width:${o.w}%`;
function createFloat(pg, o) {
  const t = o.t || 'text'; let d;
  if (t === 'pad') d = newNode(`<div class="float padbox" data-t="pad" style="${posStyle(o)}">${bar()}<div class="sig-pad"><canvas></canvas><div class="pad-hint">Sign here</div><div class="pad-tools no-print"><button type="button" data-act="pundo">↶</button><button type="button" data-act="pclr">Clear</button></div></div></div>`);
  else if (t === 'stamp') d = newNode(`<div class="float stampbox" data-t="stamp" style="${posStyle(o)}">${bar()}<img alt="stamp" draggable="false" src="${esc(stampSrc())}"></div>`);
  else d = newNode(`<div class="float tbox" data-t="text"${o.sg ? ' data-sg="1"' : ''} style="${posStyle(o)}">${bar()}${ce('tb-c', o.html || '', 'data-ph="Free text…"')}</div>`);
  setLo(d); pg.appendChild(d);
  if (t === 'pad') { initPad(d); fitPad(d); }
  return d;
}
const setLo = d => d.classList.toggle('lo', parseFloat(d.style.top) < 7);
const floatData = d => { const t = d.dataset.t || 'text', pg = d.closest('.page');
  return {t, sg: d.dataset.sg ? 1 : 0, p: pages().indexOf(pg), x: r1(parseFloat(d.style.left)), y: r1(parseFloat(d.style.top)), w: r1(parseFloat(d.style.width)), html: t === 'text' ? $('.tb-c', d).innerHTML : ''}; };
const collectTb = () => $$('.float', PAGES).map(floatData);
// أين ينتهي المحتوى؟ (الصفحة + النسبة المئوية للارتفاع)
function endOfContent() {
  const last = docAtoms().at(-1), pg = last ? last.closest('.page') : pages().at(-1), pr = pg.getBoundingClientRect();
  const bottom = last ? last.getBoundingClientRect().bottom : pr.top + pr.height * .1;
  return {pg, y: clamp(r1((bottom - pr.top) / pr.height * 100 + 1.2), 3, 99)};
}
function viewCenter() {
  const pgs = pages(), mid = innerHeight * .4, pg = pgs.find(p => { const r = p.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || pgs[0], r = pg.getBoundingClientRect();
  return {pg, y: clamp(r1((mid - r.top) / r.height * 100), 5, 88)};
}
const DEF = {text: {w: 60, x: 8}, sig: {w: 34, x: 6}, pad: {w: 28, x: 44}, stamp: {w: 22, x: 72}};
function addFloat(kind, auto = false) {       // kind: text | sig | pad | stamp
  if (kind === 'stamp' && !stampSrc()) { toast('Upload a stamp image first (Sign tab)'); openPanel('sig'); return; }
  const where = S().place === 'here' ? viewCenter() : endOfContent(), d0 = DEF[kind];
  const o = {t: kind === 'sig' ? 'text' : kind, sg: kind === 'sig' ? 1 : 0, x: d0.x, y: where.y, w: d0.w, html: kind === 'sig' ? defaultSigHtml() : ''};
  const d = createFloat(where.pg, o); closePanel(); reflow();
  let over = 0; if (S().place !== 'here') over = snapEnd(d);
  if (auto && over > 4) { d.remove(); toast('No room left on the last page for the signature – add it from Add → Signature text and place it where you like.'); return null; }
  touch(); if (over > 4) toast('Little room left on this page – block placed at the bottom (it may cover the last line). Drag it, or use Page → Fit on one page.');
  d.classList.add('sel'); if (!auto) d.scrollIntoView({block: 'center', behavior: 'smooth'});
  if (kind === 'text') $('.tb-c', d).focus();
  return d;
}
// يضع الصندوق تحت آخر سطر مباشرة؛ وإن لم تكف المساحة يُثبَّت أسفل الصفحة (قد يغطي آخر سطر بقدر بسيط) بدل القفز لصفحة جديدة
function snapEnd(d) {
  const e = endOfContent(); e.pg.appendChild(d);
  const hPct = d.offsetHeight / (e.pg.offsetHeight || 1) * 100, maxY = 99 - hPct, over = e.y - maxY;
  d.style.top = r1(Math.max(2, Math.min(e.y, maxY))) + '%'; setLo(d);
  return over > 0 ? over * (e.pg.offsetHeight || 1) / 100 : 0;      // px of overlap with content
}
function floatToEnd(d) {
  const over = snapEnd(d); touch();
  if (over > 4) toast('Little room left on this page – block placed at the bottom (it may cover the last line). Drag it, or use Page → Fit on one page.');
}
function delFloat(d) {
  const o = floatData(d), pg = d.parentElement; d.remove(); touch();
  toast('Deleted', () => { createFloat(pg.isConnected ? pg : pages()[0], o); touch(); });
}
// --- رسم التوقيع (الخطوط مخزّنة عالمياً بنسب 0..1 وتظهر في كل لوحات التوقيع) ---
let drawing = null;
const strokes = () => S().sig.strokes;
function fitPad(root) {
  const pad = root.classList && root.classList.contains('sig-pad') ? root : $('.sig-pad', root); if (!pad || !pad.clientWidth) return;
  const cv = $('canvas', pad), k = Math.min(3, (parseFloat(stage.dataset.k) || 1) * Math.max(1, devicePixelRatio || 1));
  const w = Math.round(pad.clientWidth * k), h = Math.round(pad.clientHeight * k);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  redraw(pad);
}
function redraw(only) {
  const pads = only ? [only] : $$('.sig-pad', PAGES);
  pads.forEach(pad => {
    const cv = $('canvas', pad), ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = S().sig.pen; ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = S().sig.pw * cv.width / 234;
    const all = drawing && drawing.pad === pad ? [...strokes(), drawing.pts] : strokes();
    all.forEach(s => { if (!s.length) return; ctx.beginPath(); ctx.moveTo(s[0][0] * cv.width, s[0][1] * cv.height);
      if (s.length < 3) s.forEach(p => ctx.lineTo(p[0] * cv.width, p[1] * cv.height));
      else { for (let i = 1; i < s.length - 1; i++) { const mx = (s[i][0] + s[i + 1][0]) / 2 * cv.width, my = (s[i][1] + s[i + 1][1]) / 2 * cv.height; ctx.quadraticCurveTo(s[i][0] * cv.width, s[i][1] * cv.height, mx, my); } const l = s.at(-1); ctx.lineTo(l[0] * cv.width, l[1] * cv.height); }
      ctx.stroke(); });
    pad.classList.toggle('has-ink', all.length > 0);
  });
}
function initPad(box) {
  const pad = $('.sig-pad', box), cv = $('canvas', pad);
  const pt = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = {pad, pts: [pt(e)]}; });
  cv.addEventListener('pointermove', e => { if (!drawing || drawing.pad !== pad) return; drawing.pts.push(pt(e)); redraw(pad); });
  const end = () => { if (!drawing) return; const pts = drawing.pts; drawing = null;
    if (pts.length >= 3) { strokes().push(pts); St.saveSettings(); redraw(); } else redraw(pad); };   // لمسة قصيرة = تحديد الصندوق فقط
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  new ResizeObserver(() => fitPad(pad)).observe(pad);
}
function refreshStamps() { $$('.stampbox img', PAGES).forEach(im => { im.src = stampSrc(); }); }
document.addEventListener('pointerdown', e => {
  if (!isOpen()) return;
  const f = e.target.closest && e.target.closest('.float');
  $$('.float.sel').forEach(x => { if (x !== f) x.classList.remove('sel'); }); if (f) f.classList.add('sel');
  let b = e.target.closest && e.target.closest('[data-tb]'), mode = b && b.dataset.tb;
  if (!b && e.target.closest && e.target.closest('.stampbox img')) mode = 'mv';       // الختم يُسحب باللمس مباشرة
  if (!mode) return;
  e.preventDefault();
  const box = e.target.closest('.float'), r = box.getBoundingClientRect();
  tbd = {box, mode, ox: e.clientX - r.left, oy: e.clientY - r.top, x0: e.clientX, w0: parseFloat(box.style.width)};
}, true);
document.addEventListener('pointermove', e => {
  if (!tbd) return; e.preventDefault();
  const box = tbd.box; let pg = box.parentElement;
  if (tbd.mode === 'mv') {
    const t = pages().find(p => { const r = p.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
    if (t && t !== pg) { t.appendChild(box); pg = t; }
    const r = pg.getBoundingClientRect(), w = parseFloat(box.style.width);
    box.style.left = r1(clamp((e.clientX - tbd.ox - r.left) / r.width * 100, 0, 100 - w)) + '%';
    box.style.top = r1(clamp((e.clientY - tbd.oy - r.top) / r.height * 100, 0, 97)) + '%';
  } else {
    const r = pg.getBoundingClientRect();
    box.style.width = r1(clamp(tbd.w0 + (e.clientX - tbd.x0) / r.width * 100, 8, 100 - parseFloat(box.style.left))) + '%';
  }
  setLo(box);
}, {passive: false});
const endTb = () => { if (tbd) { tbd = null; touch(); } };
document.addEventListener('pointerup', endTb); document.addEventListener('pointercancel', endTb);

/* ===== الحفظ التلقائي ===== */
let saveT;
function touch() { if (!D) return; D.edited = true; clearTimeout(saveT); saveT = setTimeout(save, 350); }
function save() {
  clearTimeout(saveT); if (!D || !pages().length) return;
  D.atoms = docAtoms().map(a => { const c = a.cloneNode(true); c.classList.remove('sel', 'flash'); c.removeAttribute('data-hide'); return c.outerHTML; });
  D.tb = collectTb();
  const pm = $$('.mf', PAGES).find(m => /name/i.test($('.ml', m).textContent)); D.patient = pm ? $('.mv', pm).textContent.trim() : '';
  if (!St.saveDraft(D)) toast('Could not save: storage is full. Download a backup.');
}
document.addEventListener('visibilitychange', () => { if (document.hidden && isOpen()) save(); });
window.addEventListener('pagehide', () => { if (isOpen()) save(); });

/* ===== تحميل محتوى التقرير ===== */
function loadAtoms(list) {
  $$('.float', PAGES).forEach(f => f.remove());
  pages().slice(1).forEach(p => p.remove());
  if (!pages().length) PAGES.appendChild(makePage());
  $('.pg-body', pages()[0]).innerHTML = list.join('');
  reflow();
}
function restoreFloats() {
  (D.tb || []).forEach(o => createFloat(pages()[Math.min(Math.max(o.p || 0, 0), pages().length - 1)], o));
}
function reload(list) { D.tb = collectTb(); loadAtoms(list); restoreFloats(); }
const snapshot = () => docAtoms().map(a => a.cloneNode(true).outerHTML);

export async function open(draft, opts = {}) {
  D = draft; study = await Data.loadStudy(D.studyId);
  $('#home').hidden = true; $('#editor').hidden = false; document.body.classList.remove('home-on');
  PAGES.innerHTML = ''; brandDirty = true;
  buildPanel(); closePanel(); closeBank(); applyOpts();
  $('#abTitle').textContent = study.title; updateBar();
  PAGES.appendChild(makePage());
  loadAtoms(D.atoms); restoreFloats(); reflow();
  if (!D.sigInit) { D.sigInit = true; if (S().sigDefault !== false) { const keep = S().place; S().place = 'end'; addFloat('sig', true); S().place = keep; D.edited = false; } }
  window.scrollTo(0, 0); cur.atom = null; updateCtx();
  initBank(api); if (opts.bank) openBank(study, {query: opts.bank});
}
export function close() {
  if (!D) return; save(); clearTimeout(saveT); closePanel(); closeBank();
  $('#editor').hidden = true; PAGES.innerHTML = ''; D = null; study = null;
}
export const current = () => D;
function updateBar() {
  const v = study.variants.find(x => x.id === D.variantId) || study.variants[0];
  $('#abSub').textContent = v.label;
  $('#abVar').textContent = (KIND_EN[v.kind] || 'Version') + ' ▾';
}

/* ===== تعديل البنود ===== */
const atomOf = n => n && n.closest && n.closest('.pg-body > .atom');
const kind = a => a && a.dataset.k;
function focusAtom(a, end = true) {
  const c = $('.c', a); if (!c) return; c.focus({preventScroll: false});
  const r = document.createRange(); r.selectNodeContents(c); r.collapse(!end); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function insertAfter(ref, node) {
  if (!ref || !ref.isConnected || kind(ref) === 'sig') ref = docAtoms().at(-1);
  if (!ref) { $('.pg-body', pages()[0]).prepend(node); return; }
  ref.after(node);
}
function addAtom(k, after) {
  const node = newNode(A[k](''));
  insertAfter(after || cur.atom, node); touch(); reflow(); focusAtom(node);
  return node;
}
const sectionOf = a => { // المجموعة التابعة للعنوان
  const list = docAtoms(), i = list.indexOf(a), k = kind(a), out = [a];
  if (k !== 'h1' && k !== 'h2') return out;
  for (let j = i + 1; j < list.length; j++) { const kk = kind(list[j]); if (kk === 'h1' || (k === 'h2' && kk === 'h2')) break; out.push(list[j]); }
  return out;
};
function delAtom(a) {
  if (!a || ['meta', 'title'].includes(kind(a))) return toast('This item cannot be deleted');
  const snap = snapshot(), grp = sectionOf(a), list = docAtoms(), prev = list[list.indexOf(a) - 1], nextA = list[list.indexOf(grp.at(-1)) + 1];
  grp.forEach(x => x.remove()); touch(); reflow();
  const f = prev || nextA; if (f) focusAtom(f);
  toast(grp.length > 1 ? `Section deleted (${grp.length} items)` : 'Deleted', () => { reload(snap); touch(); });
}
function moveAtom(a, dir) {
  const k = kind(a); if (!a || ['meta', 'title'].includes(k)) return;
  const list = docAtoms(), grp = sectionOf(a), i0 = list.indexOf(grp[0]), i1 = list.indexOf(grp.at(-1));
  let ref;
  if (k === 'li' || k === 'p') ref = dir < 0 ? list[i0 - 1] : list[i1 + 1];
  else {
    const same = x => kind(x) === k;
    if (dir < 0) { let s = i0 - 1; while (s >= 0 && !same(list[s]) && !(k === 'h2' && kind(list[s]) === 'h1')) s--; if (s < 0 || !same(list[s])) return toast('This is the first section'); ref = list[s]; }
    else { const n = list[i1 + 1]; if (!n || !same(n)) return toast('This is the last section'); ref = sectionOf(n).at(-1); }
  }
  if (!ref || ['meta', 'title'].includes(kind(ref))) return toast('Cannot move further');
  const ae = document.activeElement;
  if (dir < 0) ref.before(...grp); else ref.after(...grp);
  touch(); reflow(); if (ae && ae.isConnected) { try { ae.focus({preventScroll: true}); } catch (e) {} }
  grp[0].scrollIntoView({block: 'center', behavior: 'smooth'});
}

// --- الحقول بين [ ] ---
function fixPh(el) {
  const c = el && el.closest && el.closest('.c'); if (!c) return;
  $$('.ph', c).forEach(s => { const t = s.textContent; if (!/^\[[\s\S]*\]$/.test(t) && !/^_{3,}$/.test(t)) s.replaceWith(...s.childNodes); });
}
function phOptions(txt) {
  const inner = txt.slice(1, -1).trim();
  if (!txt.startsWith('[') || /^(e\.?g\.?|insert|enter|describe|specify|mechanism|primary|secondary)/i.test(inner) || !inner.includes('/')) return null;
  const parts = inner.split('/').map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 8 && parts.every(p => p.length <= 120 && !p.includes('[')) ? parts : null;
}
function selectNode(n) { const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function phAction(ph) {
  const c = ph.closest('.c'); if (c) c.focus({preventScroll: true});
  const opts = phOptions(ph.textContent);
  ph.scrollIntoView({block: 'center', behavior: 'smooth'});
  if (!opts) { selectNode(ph); return; }
  choose('Choose', [...opts.map(o => ({label: o, value: o, ltr: true})), {label: '✎ Type manually', value: null}], v => {
    if (v == null) { selectNode(ph); return; }
    const t = document.createTextNode(v); ph.replaceWith(t);
    const r = document.createRange(); r.setStartAfter(t); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    touch(); reflow();
  });
}
function nextPh() {
  const all = $$('.ph', PAGES).filter(p => p.offsetParent !== null); if (!all.length) return toast('No [ ] fields left ✓');
  const s = getSelection(); let t = all[0];
  if (s.rangeCount) { const a = s.getRangeAt(0); const f = all.find(p => (p.compareDocumentPosition(a.endContainer) & Node.DOCUMENT_POSITION_PRECEDING) && !p.contains(a.endContainer)); if (f) t = f; }
  phAction(t);
}
const unfilled = () => S().phOn ? $$('.ph', PAGES).length : 0;

// --- لوحة المفاتيح ---
PAGES.addEventListener('beforeinput', e => {
  const c = e.target.closest && e.target.closest('.c'); if (!c) return;
  const atom = atomOf(c), k = kind(atom);
  if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
    if (c.matches('.tb-c')) return;
    e.preventDefault();
    if (k === 'li' || k === 'p') {
      const s = getSelection(), r = s.getRangeAt(0); if (!r.collapsed) r.deleteContents();
      const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(c, c.childNodes.length);
      const frag = tail.extractContents(), tmp = document.createElement('div'); tmp.appendChild(frag);
      const n = newNode(A[k](tmp.innerHTML)); atom.after(n); touch(); reflow(); focusAtom(n, false);
    } else if (k === 'h1' || k === 'h2' || k === 'title') { const n = newNode(A.li('')); atom.after(n); touch(); reflow(); focusAtom(n); }
    else if (k === 'meta') { const all = $$('.c', atom), i = all.indexOf(c); const nx = all[i + 1]; if (nx) nx.focus(); else { const nxa = docAtoms()[docAtoms().indexOf(atom) + 2]; if (nxa) focusAtom(nxa); } }
  } else if (e.inputType === 'deleteContentBackward' && (k === 'li' || k === 'p')) {
    const s = getSelection(); if (!s.rangeCount || !s.getRangeAt(0).collapsed) return;
    const r = s.getRangeAt(0), pre = document.createRange(); pre.selectNodeContents(c); pre.setEnd(r.startContainer, r.startOffset);
    if (pre.toString().length) return;
    e.preventDefault();
    const list = docAtoms(), prev = list[list.indexOf(atom) - 1];
    if (!prev) return;
    if ((kind(prev) === 'li' || kind(prev) === 'p') && $('.c', prev)) {
      const pc = $('.c', prev), mark = pc.textContent.length; pc.insertAdjacentHTML('beforeend', c.innerHTML.replace(/^<br>$/, '')); atom.remove();
      touch(); reflow(); pc.focus(); const w = document.createTreeWalker(pc, NodeFilter.SHOW_TEXT); let n, acc = 0; const rr = document.createRange(); rr.selectNodeContents(pc); rr.collapse(false);
      while ((n = w.nextNode())) { if (acc + n.nodeValue.length >= mark) { rr.setStart(n, mark - acc); rr.collapse(true); break; } acc += n.nodeValue.length; }
      s.removeAllRanges(); s.addRange(rr);
    } else if (!c.textContent.trim()) { atom.remove(); touch(); reflow(); focusAtom(prev); }
  }
});
PAGES.addEventListener('paste', e => {
  const c = e.target.closest && e.target.closest('.c'); if (!c) return; e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\r/g, ''), atom = atomOf(c), k = kind(atom);
  const lines = t.split('\n').map(s => s.replace(/^\s*[-•▪*●]\s+/, '').trim()).filter(Boolean);
  if (lines.length > 1 && (k === 'li' || k === 'p')) {
    document.execCommand('insertText', false, lines[0]); let ref = atom;
    lines.slice(1).forEach(l => { const n = newNode(A.li(esc(l))); ref.after(n); ref = n; });
    touch(); reflow(); focusAtom(ref);
  } else document.execCommand('insertText', false, c.matches('.tb-c') ? t : lines.join(' ') || t);
});
PAGES.addEventListener('input', e => { fixPh(e.target); touch(); schedReflow();
  const c = e.target.closest && e.target.closest('.c');
  if (c && c.matches('.tb-c') && c.closest('[data-sg]')) { S().sigText = c.innerHTML; St.saveSettings(); }   // last signature wording is reused in new reports
});
PAGES.addEventListener('click', e => {
  const ph = e.target.closest && e.target.closest('.ph'); if (ph && S().phOn) { phAction(ph); return; }
  const b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'fdel') delFloat(b.closest('.float')); else if (a === 'fend') floatToEnd(b.closest('.float'));
  else if (a === 'pundo') { strokes().pop(); redraw(); St.saveSettings(); } else if (a === 'pclr') { S().sig.strokes = []; redraw(); St.saveSettings(); }
});
document.addEventListener('focusin', e => {
  if (!isOpen()) return;
  const a = atomOf(e.target); if (a) cur.atom = a; else if (e.target.closest && e.target.closest('.float')) cur.atom = null;
  setTimeout(updateCtx, 0);
});
document.addEventListener('focusout', () => { if (isOpen()) setTimeout(updateCtx, 80); });
function updateCtx() {
  const ae = document.activeElement, inBody = !!(ae && ae.isContentEditable && atomOf(ae));
  const k = cur.atom && kind(cur.atom), movable = !['meta', 'title', undefined, null].includes(k);
  $('[data-do=next]').hidden = !S().phOn;
  $('[data-do=up]').disabled = $('[data-do=down]').disabled = $('[data-do=del]').disabled = !movable;
  $('#ctxbar').hidden = !(inBody && !panel.classList.contains('open') && !bankOpen());
}
$('#ctxbar').addEventListener('click', e => {
  const b = e.target.closest('[data-do]'); if (!b || b.disabled) return; const d = b.dataset.do;
  if (d === 'addli') addAtom(cur.atom && kind(cur.atom) === 'p' ? 'p' : 'li'); else if (d === 'del') delAtom(cur.atom);
  else if (d === 'up') moveAtom(cur.atom, -1); else if (d === 'down') moveAtom(cur.atom, 1); else if (d === 'next') nextPh();
});

/* ===== بنك التعابير: واجهة الإدراج ===== */
const SEC_RX = {indication: /indication|history|clinical/i, impression: /impression|conclusion/i, technique: /technique/i, findings: /^findings?\b/i};
const findSection = k => docAtoms().find(a => kind(a) === 'h1' && SEC_RX[k].test($('.c', a).textContent));
const lastOfSection = h => { const g = sectionOf(h); return g.at(-1); };
const isPlaceholderOnly = a => { const c = $('.c', a); const t = c.textContent.trim(); return !t || (c.querySelectorAll('.ph').length && [...c.querySelectorAll('.ph')].map(x => x.textContent).join('').replace(/\s/g, '') === t.replace(/\s/g, '')); };
function flashAtom(a) {
  a.classList.add('flash'); setTimeout(() => a.classList.remove('flash'), 1400);
  const r = a.getBoundingClientRect(); if (r.top < 90 || r.bottom > innerHeight * .32) window.scrollBy({top: r.top - innerHeight * .18, behavior: 'smooth'});
}
function insertPhrase(text, k, mode = 'add') {
  const html = phHtml(text); let node;
  const useSection = ['indication', 'impression', 'technique'].includes(k) ? findSection(k) : null;
  if (useSection) {
    const last = lastOfSection(useSection);
    if (kind(last) === 'li' && (isPlaceholderOnly(last) || mode === 'replace')) { $('.c', last).innerHTML = html; node = last; }
    else { node = newNode(A.li(html)); last.after(node); }
  } else {
    const ca = cur.atom && cur.atom.isConnected && ['li', 'p'].includes(kind(cur.atom)) ? cur.atom : null;
    if (ca) {
      if (mode === 'replace' || isPlaceholderOnly(ca)) { $('.c', ca).innerHTML = html; node = ca; }
      else { node = newNode(A.li(html)); ca.after(node); }
    } else {
      const sec = findSection('findings'); node = newNode(A.li(html));
      if (sec) lastOfSection(sec).after(node); else insertAfter(null, node);
    }
  }
  cur.atom = node; touch(); reflow(); flashAtom(node);
  const where = useSection ? $('.c', useSection).textContent.replace(/[:：]/g, '') : 'current position';
  toast('Added → ' + where);
}
function applyCase(g) {
  const parts = {};
  g.subs.forEach(s => { if (s.kind && s.items.length) parts[s.kind] = s.items; });
  if (!Object.keys(parts).length) { toast('These are separate phrases – tap any phrase to insert it'); return false; }
  const snap = snapshot(); let done = 0;
  for (const k of ['indication', 'technique', 'findings', 'impression']) {
    if (!parts[k]) continue; const h = findSection(k); if (!h) continue;
    const grp = sectionOf(h); grp.slice(1).forEach(x => x.remove());
    let ref = h; parts[k].forEach(t => { const n = newNode(A.li(phHtml(t))); ref.after(n); ref = n; }); done++;
  }
  if (!done) { toast('No matching sections in this template'); return false; }
  touch(); reflow(); window.scrollTo({top: 0, behavior: 'smooth'});
  toast('Case applied to the report', () => { reload(snap); touch(); }); return true;
}
const api = {readDocForName: () => readDoc(false), insertPhrase, applyCase, toast, unfilled, hasCursor: () => !!(cur.atom && cur.atom.isConnected && ['li', 'p'].includes(kind(cur.atom))), pages, sectionNames: () => docAtoms().filter(a => kind(a) === 'h1').map(a => $('.c', a).textContent)};

/* ===== قراءة التقرير للتصدير ===== */
const hasText = a => !!$('.c', a).textContent.trim();
export function markEmpties(on) {
  const list = docAtoms();
  list.forEach(a => a.removeAttribute('data-hide')); if (!on) return;
  list.forEach(a => { if ((kind(a) === 'li' || kind(a) === 'p') && !hasText(a)) a.dataset.hide = '1'; });
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i], k = kind(a); if (k !== 'h1' && k !== 'h2') continue;
    const grp = sectionOf(a).slice(1); if (!grp.some(x => !x.dataset.hide)) a.dataset.hide = '1';
  }
}
export function readDoc(hideEmpty) {
  markEmpties(hideEmpty);
  const out = {fields: [], title: '', items: [], free: [], pad: null, stamp: '', fitK: parseFloat(PAGES.style.getPropertyValue('--k')) || 1, brand: St.brand(), settings: S()};
  docAtoms().forEach(a => {
    const k = kind(a); if (a.dataset.hide) return;
    if (k === 'meta') $$('.mf', a).forEach(m => out.fields.push({l: $('.ml', m).textContent.replace(/:\s*$/, '').trim(), v: $('.mv', m).textContent.trim()}));
    else if (k === 'title') out.title = $('.c', a).textContent.trim();
    else out.items.push({t: k, html: $('.c', a).innerHTML, text: $('.c', a).textContent.trim()});
  });
  $$('.float', PAGES).forEach(d => {
    const f = floatData(d);
    if (f.t === 'text') { const tx = $('.tb-c', d).textContent.trim(); if (tx) out.free.push({...f, text: tx}); }
    else out.free.push({...f, text: ''});
  });
  out.free.sort((a, c) => a.p - c.p || a.y - c.y || a.x - c.x);
  out.pad = {strokes: S().sig.strokes, pen: S().sig.pen, pw: S().sig.pw, image: (St.brand().signature || {}).image || ''};
  out.stamp = stampSrc();
  markEmpties(false); return out;
}
let prepared = false;
export function prepOutput() { if (prepared) return; prepared = true; markEmpties(S().hideEmpty); document.body.classList.add('printing'); $$('.sel').forEach(x => x.classList.remove('sel')); reflow(); }
export function endOutput() { if (!prepared) return; prepared = false; markEmpties(false); document.body.classList.remove('printing'); reflow(); }
window.addEventListener('beforeprint', () => { if (isOpen()) prepOutput(); });
window.addEventListener('afterprint', () => { if (isOpen()) endOutput(); });

/* ===== Control panel ===== */
const TABS = [['xp', 'Export'], ['add', 'Add'], ['fmt', 'Format'], ['page', 'Page'], ['sig', 'Sign'], ['brand', 'Letterhead']];
const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
const sw = (id, label) => `<label class="sw"><span>${label}</span><input type="checkbox" id="${id}"></label>`;
const upl = (id, label) => `<div class="upl" data-upl="${id}"><img alt="" hidden><span class="nm">${label}</span><label class="btn sm fileb">Upload<input type="file" accept="image/*"></label><button class="btn sm danger" type="button" data-clr="${id}">Remove</button></div>`;
function buildPanel() {
  panel.innerHTML = `<button class="p-x" type="button" id="pClose" aria-label="Close">✕</button>
  <div class="pop"><span>◐ See-through</span><input type="range" id="pop" min="25" max="100" step="5" aria-label="Panel transparency"></div>
  <div class="tabs">${TABS.map(([k, l]) => `<button type="button" data-tabbtn="${k}">${l}</button>`).join('')}</div>
  <section class="tab" data-tab="xp">
    <button class="btn dark" type="button" data-x="print">🖨 Print / Save as PDF</button>
    <button class="btn" type="button" data-x="docx">📄 Export Word file (.docx)</button>
    <button class="btn" type="button" data-x="png">🖼 Save as image (PNG)</button>
    <button class="btn" type="button" data-x="copy">📋 Copy report text</button>
    <div class="lbl">PNG options</div>
    ${seg('xmode', [['one', 'One long image'], ['each', 'Image per page']])}
    ${seg('xq', [['1', 'Normal'], ['2', 'High'], ['3', 'Very high']])}
    ${sw('shareOn', 'Share the file instead of downloading (phones)')}
    <div class="hint">Empty items are skipped automatically in print and export (can be turned off in the Page tab). Note: Word export places free blocks (text, signature, stamp) after the content in reading order; exact positions are kept in PDF / print / PNG.</div>
  </section>
  <section class="tab" data-tab="add">
    <div class="lbl">Report content</div>
    <div class="g3">
      <button class="tbtn" type="button" data-add="li"><span class="ic">•</span><span>Bullet</span></button>
      <button class="tbtn" type="button" data-add="h2"><span class="ic">▪</span><span>Sub-heading</span></button>
      <button class="tbtn" type="button" data-add="h1"><span class="ic">▪▪</span><span>Section heading</span></button>
      <button class="tbtn" type="button" data-add="p"><span class="ic">¶</span><span>Paragraph</span></button>
      <button class="tbtn" type="button" data-add="ph"><span class="ic">[ ]</span><span>Fill-in field</span></button>
    </div>
    <div class="lbl">Free blocks (movable, deletable, unlimited)</div>
    ${seg('place', [['end', 'At end of report'], ['here', 'Here (current view)']])}
    <div class="g2">
      <button class="tbtn" type="button" data-addf="text"><span class="ic">⬚</span><span>Free text</span></button>
      <button class="tbtn" type="button" data-addf="sig"><span class="ic">Dr.</span><span>Signature text<br>(Best Regards…)</span></button>
      <button class="tbtn" type="button" data-addf="pad"><span class="ic">✍</span><span>Signature drawing box</span></button>
      <button class="tbtn" type="button" data-addf="stamp"><span class="ic">◉</span><span>Stamp</span></button>
    </div>
    <div class="hint">Tap a block to select it, then use <b>✥ Move</b> (drag to any place on any page), <b>↔</b> (width), <b>⇩ End</b> (jump below the last line) or <b>✕</b> (delete). Press Enter inside a text block to add more lines. Content items are added after the item you are editing.</div>
  </section>
  <section class="tab" data-tab="fmt">
    <div class="g4">
      <button class="tbtn" type="button" data-fmt="bold"><span class="ic"><b>B</b></span><span>Bold</span></button>
      <button class="tbtn" type="button" data-fmt="italic"><span class="ic"><i>I</i></span><span>Italic</span></button>
      <button class="tbtn" type="button" data-fmt="underline"><span class="ic"><u>U</u></span><span>Underline</span></button>
      <button class="tbtn" type="button" data-fmt="clear"><span class="ic">⌫</span><span>Clear format</span></button>
      <button class="tbtn" type="button" data-fmt="sz+"><span class="ic">A+</span><span>Larger</span></button>
      <button class="tbtn" type="button" data-fmt="sz-"><span class="ic">A−</span><span>Smaller</span></button>
      <button class="tbtn" type="button" data-fmt="undo"><span class="ic">↶</span><span>Undo</span></button>
      <button class="tbtn" type="button" data-fmt="redo"><span class="ic">↷</span><span>Redo</span></button>
    </div>
    <div class="hint">Select the text first, then tap. Headings are bold automatically.</div>
    ${sw('phOn', 'Highlight [ ] fields (tap one to pick an option)')}
    <div class="hint">Off by default: bracketed text stays plain text you can edit normally. Turn on to see [ ] fields in yellow, jump between them with “[ ] Next”, and pick from “a / b / c” options.</div>
  </section>
  <section class="tab" data-tab="page">
    ${sw('fit', 'Fit report on ONE page (shrinks text only if needed)')}
    <div class="lbl">Patient info fields</div>
    <div id="fldList"></div>
    ${seg('metaCols', [['2', 'Two columns'], ['1', 'One column']])}
    ${sw('titleLines', 'Lines above and below the title')}
    <div class="lbl">View size</div>
    <div class="g3"><button class="btn" type="button" data-x="zout">− Smaller</button><button class="btn" type="button" data-x="zfit">Fit</button><button class="btn" type="button" data-x="zin">+ Larger</button></div>
    <div class="lbl">Page numbers</div>
    ${seg('pn', [['off', 'None'], ['n', '1'], ['nofm', '1 / 3'], ['page', 'Page 1 of 3']])}
    ${seg('pnPos', [['l', 'Left'], ['r', 'Right']])}
    <div class="lbl">Header (if set)</div>
    ${seg('hdr', [['all', 'All pages'], ['first', 'First only'], ['none', 'Hide']])}
    ${seg('hline', [['on', 'Line under header'], ['off', 'No line']])}
    <div class="lbl">Footer (if set)</div>
    ${seg('ftr', [['all', 'All pages'], ['last', 'Last only'], ['none', 'Hide']])}
    ${seg('fline', [['auto', 'Line: auto'], ['on', 'Line: always'], ['off', 'No line']])}
    ${sw('hideEmpty', 'Skip empty items when printing / exporting')}
  </section>
  <section class="tab" data-tab="sig">
    ${sw('sigDefault', 'Add “Best Regards / Dr.” text to new reports')}
    <div class="g2"><button class="btn" type="button" data-x="sigreset">Reset signature wording</button><button class="btn danger" type="button" data-x="sigclr">Clear saved drawing</button></div>
    <div class="hint">Add signature text, drawing box or stamp from the <b>Add</b> tab. Each one is a separate block you can move, resize, delete or add again. The drawing and the wording are saved on this device and reused in every report.</div>
    <div class="lbl">Pen color</div>
    ${seg('pen', [['#0b1a4a', 'Navy'], ['#000000', 'Black'], ['#1740c8', 'Blue']])}
    <div class="lbl">Pen thickness</div><input type="range" id="penW" min="1" max="5" step=".2">
    ${upl('stamp', 'Stamp image')}
    <div class="hint">No stamp by default. After uploading, add it from Add → Stamp.</div>
  </section>
  <section class="tab" data-tab="brand">
    <div class="hint">Letterhead (header, footer, logos, watermark) is empty by default because the template is not tied to a specific institution. Fill what you need; it appears in all reports on this device.</div>
    <div class="lbl">Header</div>
    <input class="fi" data-b="header.line1" placeholder="Line 1 (hospital / center name)"><input class="fi" data-b="header.line2" placeholder="Line 2 (department)"><input class="fi" data-b="header.line3" placeholder="Line 3 (address / phone)">
    ${upl('logoLeft', 'Left logo')}${upl('logoRight', 'Right logo')}
    <div class="lbl">Footer</div>
    <input class="fi" data-b="footer.line1" placeholder="Footer line 1"><input class="fi" data-b="footer.line2" placeholder="Footer line 2">
    <div class="lbl">Watermark</div>
    ${upl('wm', 'Watermark image')}
    ${sw('wmOn', 'Show watermark')}
    <div class="lbl">Watermark opacity</div><input type="range" id="wmOp" min="3" max="25" step="1">
  </section>`;
  syncPanel();
}
const metaAtom = () => docAtoms().find(a => kind(a) === 'meta');
function renderFields() {
  const box = $('#fldList', panel), m = metaAtom(); if (!box) return;
  const rows = m ? $$('.mf', m) : [];
  box.innerHTML = rows.map((f, i) => `<div class="frow"><input class="fi" data-fi="${i}" value="${esc($('.ml', f).textContent)}" aria-label="Field name"><button class="btn sm" type="button" data-fup="${i}" aria-label="Move up">↑</button><button class="btn sm danger" type="button" data-fdel="${i}" aria-label="Delete field">✕</button></div>`).join('')
    + `<div class="frow"><input class="fi" id="fNew" placeholder="New field name…"><button class="btn sm dark" type="button" data-fadd>＋ Add</button></div>`;
}
function applyPop() { const o = clamp((S().pop || 100) / 100, .25, 1); panel.style.opacity = o; $('#bank').style.opacity = o; }
function applyOpts() {
  const s = S();
  PAGES.classList.toggle('ph-off', !s.phOn); PAGES.classList.toggle('tl-on', !!s.titleLines);
  PAGES.classList.toggle('mc1', String(s.metaCols) === '1'); PAGES.classList.toggle('hl-off', s.hline === 'off');
  applyPop(); updateCtx();
}
function syncPanel() {
  const s = S();
  $$('[data-seg]', panel).forEach(sg => $$('button', sg).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(sg.dataset.seg === 'pen' ? s.sig.pen : s[sg.dataset.seg])))));
  $('#hideEmpty', panel).checked = !!s.hideEmpty; $('#shareOn', panel).checked = !!s.share; $('#phOn', panel).checked = !!s.phOn; $('#titleLines', panel).checked = !!s.titleLines;
  $('#fit', panel).checked = !!(D && D.fit); $('#sigDefault', panel).checked = s.sigDefault !== false; $('#pop', panel).value = s.pop || 100;
  $('#penW', panel).value = s.sig.pw; $('#wmOn', panel).checked = !!s.wmOn; $('#wmOp', panel).value = s.wmOp;
  $$('[data-b]', panel).forEach(i => { const [a, b] = i.dataset.b.split('.'); i.value = (St.brand()[a] || {})[b] || ''; });
  const b = St.brand(), map = {logoLeft: (b.header || {}).logoLeft, logoRight: (b.header || {}).logoRight, wm: (b.watermark || {}).image, stamp: (b.stamp || {}).image};
  $$('[data-upl]', panel).forEach(u => { const src = map[u.dataset.upl], im = $('img', u); im.hidden = !src; if (src) im.src = src; });
  $('[data-add=ph]', panel).hidden = !s.phOn;
}
export function showTab(t) { panel.dataset.tab = t; if (t === 'page') renderFields(); $$('[data-tabbtn]', panel).forEach(b => b.classList.toggle('on', b.dataset.tabbtn === t)); $$('.tab', panel).forEach(s => s.classList.toggle('on', s.dataset.tab === t)); $$('.dk').forEach(d => d.classList.toggle('act', (panel.classList.contains('open') && d.dataset.open === t) || (d.dataset.open === 'bank' && bankOpen()))); }
function padBottom() { const h = panel.classList.contains('open') ? panel.offsetHeight : bankOpen() ? $('#bank').offsetHeight : 0; $('#viewport').style.paddingBottom = (h && innerWidth < 900) ? (h + 90) + 'px' : ''; }
export function openPanel(t) { closeBank(); panel.classList.add('open'); showTab(t); updateCtx(); padBottom(); }
export function closePanel() { panel.classList.remove('open'); showTab(panel.dataset.tab || 'xp'); updateCtx(); padBottom(); }
function openTab(t) { if (t === 'bank') { if (bankOpen()) { closeBank(); } else { panel.classList.remove('open'); openBank(study); } showTab(panel.dataset.tab); updateCtx(); padBottom(); return; } if (panel.classList.contains('open') && panel.dataset.tab === t) closePanel(); else openPanel(t); }
window.__bankChanged = () => { showTab(panel.dataset.tab || 'xp'); updateCtx(); padBottom(); };
$$('.dk').forEach(b => b.addEventListener('click', () => openTab(b.dataset.open)));
['pointerdown', 'mousedown'].forEach(ev => ['#dock', '#panel', '#ctxbar', '#bank'].forEach(s => $(s).addEventListener(ev, e => {
  if (e.target.closest('button, label, .seg, summary') && !e.target.closest('input, textarea')) e.preventDefault();
})));
panel.addEventListener('click', async e => {
  const t = e.target;
  if (t.closest('#pClose')) return closePanel();
  const tb = t.closest('[data-tabbtn]'); if (tb) return showTab(tb.dataset.tabbtn);
  const sg = t.closest('[data-seg] button');
  if (sg) {
    const key = sg.closest('[data-seg]').dataset.seg, v = sg.dataset.v;
    if (key === 'pen') { S().sig.pen = v; redraw(); } else S()[key] = v;
    St.saveSettings(); syncPanel(); applyOpts(); reflow(); return;
  }
  const f = t.closest('[data-fmt]'); if (f) return doFmt(f.dataset.fmt);
  const af = t.closest('[data-addf]'); if (af) return void addFloat(af.dataset.addf);
  const ad = t.closest('[data-add]');
  if (ad) { const k = ad.dataset.add; if (k === 'ph') { if (!document.activeElement || !document.activeElement.isContentEditable) return toast('Tap inside a text first'); document.execCommand('insertHTML', false, '<span class="ph">[ ]</span>&nbsp;'); touch(); return; } closePanel(); return addAtom(k); }
  const fa = t.closest('[data-fadd]');
  if (fa) { const inp = $('#fNew', panel), m = metaAtom(); if (!m) return; const lab = inp.value.trim() || 'Field'; $('.meta-grid', m).insertAdjacentHTML('beforeend', A.mf(lab)); touch(); reflow(); renderFields(); return; }
  const fd = t.closest('[data-fdel]'); if (fd) { const m = metaAtom(), rows = m ? $$('.mf', m) : [], r = rows[+fd.dataset.fdel]; if (r) { const snap = snapshot(); r.remove(); touch(); reflow(); renderFields(); toast('Field removed', () => { reload(snap); touch(); renderFields(); }); } return; }
  const fu = t.closest('[data-fup]'); if (fu) { const m = metaAtom(), rows = m ? $$('.mf', m) : [], i = +fu.dataset.fup; if (i > 0 && rows[i]) { rows[i - 1].before(rows[i]); touch(); renderFields(); } return; }
  const clr = t.closest('[data-clr]');
  if (clr) { setImage(clr.dataset.clr, ''); return; }
  const x = t.closest('[data-x]'); if (!x) return;
  const a = x.dataset.x;
  if (a === 'print') Exp.printReport(api, {prepOutput, endOutput}); else if (a === 'docx') Exp.exportDocx(api, readDoc, S()); else if (a === 'png') Exp.exportPng(api, {prepOutput, endOutput, pages}, S());
  else if (a === 'copy') Exp.copyText(readDoc(S().hideEmpty)); else if (a === 'zin') { S().zoom = clamp((S().zoom || 1) + .15, .5, 3); St.saveSettings(); scaleView(); }
  else if (a === 'zout') { S().zoom = clamp((S().zoom || 1) - .15, .5, 3); St.saveSettings(); scaleView(); } else if (a === 'zfit') { S().zoom = 1; St.saveSettings(); scaleView(); }
  else if (a === 'sigclr') { S().sig.strokes = []; redraw(); St.saveSettings(); toast('Drawing cleared'); }
  else if (a === 'sigreset') { S().sigText = null; St.saveSettings(); toast('New signature text will use the default wording'); }
});
panel.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'hideEmpty') S().hideEmpty = t.checked; else if (t.id === 'shareOn') S().share = t.checked;
  else if (t.id === 'phOn') { S().phOn = t.checked; syncPanel(); applyOpts(); } else if (t.id === 'titleLines') { S().titleLines = t.checked; applyOpts(); reflow(); }
  else if (t.id === 'sigDefault') S().sigDefault = t.checked;
  else if (t.id === 'fit') { D.fit = t.checked; touch(); reflow(); if (t.checked) { const k = parseFloat(PAGES.style.getPropertyValue('--k')) || 1; toast(k < 1 ? `Shrunk to ${Math.round(k * 100)}% to fit one page` : 'Already fits on one page'); } return; }
  else if (t.id === 'wmOn') { S().wmOn = t.checked; renderBrand(); }
  else if (t.type === 'file') { const u = t.closest('[data-upl]'); if (t.files[0]) setImage(u.dataset.upl, await readImg(t.files[0], u.dataset.upl === 'wm' ? 1400 : 700)); t.value = ''; return; }
  St.saveSettings();
});
panel.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.fi != null) { const m = metaAtom(), r = m && $$('.mf', m)[+t.dataset.fi]; if (r) { $('.ml', r).textContent = t.value; touch(); schedReflow(); } return; }
  if (t.dataset.b) { St.setBrand(t.dataset.b, t.value); renderBrand(); reflow(); }
  else if (t.id === 'penW') { S().sig.pw = +t.value; redraw(); St.saveSettings(); }
  else if (t.id === 'wmOp') { S().wmOp = +t.value; renderBrand(); St.saveSettings(); }
  else if (t.id === 'pop') { S().pop = +t.value; applyPop(); St.saveSettings(); }
});
function setImage(id, val) {
  const path = {logoLeft: 'header.logoLeft', logoRight: 'header.logoRight', wm: 'watermark.image', stamp: 'stamp.image'}[id];
  St.setBrand(path, val); if (id === 'wm') { S().wmOn = true; } renderBrand(); refreshStamps(); syncPanel(); reflow(); toast(val ? 'Saved' : 'Removed');
}
function doFmt(f) {
  const ae = document.activeElement; if (!ae || !ae.isContentEditable) return toast('Tap inside a text first');
  const map = {bold: 'bold', italic: 'italic', underline: 'underline', clear: 'removeFormat', undo: 'undo', redo: 'redo'};
  if (f === 'sz+' || f === 'sz-') { const c = parseInt(document.queryCommandValue('fontSize')) || 3; document.execCommand('fontSize', false, clamp(c + (f === 'sz+' ? 1 : -1), 1, 7)); }
  else document.execCommand(map[f], false, null);
  touch(); schedReflow();
}
api.setPop = v => { S().pop = v; applyPop(); St.saveSettings(); }; api.getPop = () => S().pop || 100;

/* ===== Top bar and menus ===== */
$('#abBack').onclick = () => { save(); if (history.state && history.state.rr) history.back(); else { location.hash = ''; window.dispatchEvent(new Event('popstate')); } };
$('#abVar').onclick = () => {
  choose('Choose template version', study.variants.map(v => ({label: v.label, sub: VAR_DESC[v.kind] || '', value: v.id, current: v.id === D.variantId})), vid => {
    if (vid === D.variantId && !D.edited) return;
    const go = () => switchVariant(vid);
    if (D.edited) confirmBox('Change version', 'The report body will be replaced by the selected version. Patient fields are kept, and you can undo.', 'Replace', go); else go();
  });
};
function switchVariant(vid) {
  const snap = snapshot(), oldV = D.variantId, wasEdited = D.edited, v = study.variants.find(x => x.id === vid);
  const m = metaAtom(), list = atomsFromVariant(v); if (m) list[0] = m.cloneNode(true).outerHTML;
  D.variantId = vid; reload(list); touch(); updateBar(); window.scrollTo(0, 0);
  toast('Version changed', () => { D.variantId = oldV; reload(snap); D.edited = wasEdited; touch(); updateBar(); });
}
$('#abMore').onclick = () => {
  choose('Report options', [
    {label: '📋 Copy report text', value: 'copy'}, {label: '＋ New report from the same study', sub: 'This report stays in My drafts', value: 'new'},
    {label: '🗑 Delete this draft', value: 'del'}], v => {
      if (v === 'copy') Exp.copyText(readDoc(S().hideEmpty));
      else if (v === 'new') { save(); window.dispatchEvent(new CustomEvent('rr:new', {detail: {studyId: D.studyId, variantId: D.variantId}})); }
      else if (v === 'del') confirmBox('Delete draft', 'This report will be deleted permanently.', 'Delete', () => { const id = D.id; D.edited = false; St.removeDraft(id); close(); window.dispatchEvent(new CustomEvent('rr:home')); });
    });
};
let lw = 0;
window.addEventListener('resize', () => { const w = innerWidth; if (isOpen() && w !== lw) { lw = w; scaleView(); } });
if (window.visualViewport) { const kb = () => { const k = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop); document.documentElement.style.setProperty('--kb', Math.round(k) + 'px'); }; visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb); }
window.__dbg = {get D() { return D; }, reflow, docAtoms, pages, api, readDoc, nextPh, addAtom, moveAtom, delAtom, addFloat, floatData};
