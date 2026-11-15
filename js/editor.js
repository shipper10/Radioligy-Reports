// المحرر: صفحات A4 حقيقية، حقول، بنود، توقيع متحرك، نص حر، لوحة التحكم
import { $, $$, esc, clamp, r1, uid, toast, choose, confirmBox, openSheet, closeSheet, readImg, debounce } from './util.js';
import * as St from './store.js';
import * as Data from './data.js';
import { initBank, openBank, closeBank, bankOpen } from './bank.js';
import * as Exp from './export.js';

const VAR_DESC = {
  template: 'قالب جاهز: قيم طبيعية مكتوبة مسبقاً وحقول [ ] للتعديل (الأسرع)',
  blank: 'فارغ: العناوين فقط وتكتب كل شيء بنفسك',
  normal: 'مثال طبيعي كامل (دراسة سليمة) جاهز',
  limited: 'حالة محدودة / غير حاسمة',
  other: 'نسخة أخرى',
};
const KIND_AR = {template: 'قالب', blank: 'فارغ', normal: 'طبيعي', limited: 'محدود', other: 'نسخة'};
const STD_FIELDS = ['Patient Name', 'Date', 'Age / Sex', 'Referred By'];

/* ===== حالة المحرر ===== */
let D = null, study = null, sigEl = null, busy = false, tbd = null, lastW = 0;
const cur = {atom: null};
const PAGES = $('#pages'), stage = $('#stage'), scaler = $('#scaler'), panel = $('#panel');
const S = () => St.settings;
const pages = () => $$('.page', PAGES);
const atomsList = () => $$('.pg-body > .atom', PAGES);
const docAtoms = () => atomsList().filter(a => a.dataset.k !== 'sig');
const isOpen = () => !$('#editor').hidden;

/* ===== بناء عناصر التقرير ===== */
const phHtml = t => esc(t).replace(/\[[^\]\n]{1,300}\]|_{3,}/g, m => `<span class="ph">${m}</span>`);
const ce = (cls, html, extra = '') => `<div class="c ${cls}" contenteditable="true" ${extra}>${html}</div>`;
const fmtDate = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
const A = {
  meta: (fields, vals = {}) => `<div class="atom a-meta" data-k="meta"><div class="meta-grid">${fields.map(f =>
    `<div class="mf"><b class="ml">${esc(f)}:</b>${ce('mv', esc(vals[f] ?? (/^date$/i.test(f) ? fmtDate() : '')), `dir="auto" data-lbl="${esc(f)}"`)}</div>`).join('')}</div></div>`,
  title: t => `<div class="atom a-title" data-k="title">${ce('', phHtml(t))}</div>`,
  h1: t => `<div class="atom a-h1" data-k="h1">${ce('', phHtml(t))}</div>`,
  h2: t => `<div class="atom a-h2" data-k="h2">${ce('', phHtml(t))}</div>`,
  li: (html = '') => `<div class="atom a-li" data-k="li">${ce('', html, 'data-ph="اكتب هنا"')}</div>`,
  p: (html = '') => `<div class="atom a-p" data-k="p">${ce('', html, 'data-ph="اكتب هنا"')}</div>`,
};
export function atomsFromVariant(v, vals) {
  const out = [A.meta(v.fields || STD_FIELDS, vals), A.title(v.title)];
  v.blocks.forEach(b => out.push(b.t === 'li' ? A.li(phHtml(b.x)) : b.t === 'h2' ? A.h2(b.x) : A.h1(b.x)));
  return out;
}
export function makeDraft(st, variantId) {
  const v = st.variants.find(x => x.id === variantId) || st.variants[0];
  return {id: St.newDraftId(), studyId: st.id, variantId: v.id, title: st.title, created: Date.now(), edited: false,
    atoms: atomsFromVariant(v), tb: [], sig: {mode: 'auto', on: true, p: 0, x: 52, y: 80, w: 34}, patient: ''};
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
function reflow() {
  if (busy || !D) return; busy = true;
  const sel = saveSel();
  try {
    if (!pages().length) PAGES.appendChild(makePage());
    ensurePages(1);
    let atoms = atomsList();
    if (sigEl && sigEl.classList.contains('a-sig') && sigEl.isConnected) atoms = atoms.filter(a => a !== sigEl).concat(sigEl);
    flags(atoms);
    let N = Math.max(1, pages().length), res = null;
    for (let it = 0; it < 5; it++) {
      ensurePages(N); applyPageVis(N);
      const hs = atoms.map(a => a.offsetHeight);
      res = assign(atoms, hs);
      if (res.count === N) break; N = res.count;
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
  $$('.sig-pad').forEach(fitPad);
}

/* ===== التوقيع (لوحة رسم + ختم) ===== */
const sigLines = () => { const b = St.brand().signature || {}, g = S().sig; return [g.line1 ?? b.line1 ?? 'Best Regards,', g.line2 ?? b.line2 ?? 'Dr. ..............................................']; };
const stampSrc = () => (St.brand().stamp || {}).image || '';
function buildSig() {
  const [l1, l2] = sigLines(), b = St.brand().signature || {};
  const el = newNode(`<div class="sigbox atom a-sig" data-k="sig" id="sigBox">
    <div class="fl-bar no-print" contenteditable="false"><button type="button" data-tb="mv" aria-label="تحريك التوقيع">✥ تحريك</button><button type="button" data-tb="rs" aria-label="حجم">↔</button><button type="button" data-act="sigauto">⇩ تلقائي</button></div>
    ${ce('sg-l1', esc(l1))}
    <div class="sig-pad no-stamp" data-pad>${b.image ? `<img src="${esc(b.image)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:0">` : ''}<canvas></canvas><div class="pad-hint">وقّع هنا</div>
      <div class="pad-tools no-print"><button type="button" data-act="pundo">↶</button><button type="button" data-act="pclr">مسح</button></div>
      <img class="stamp" alt="" draggable="false"></div>
    ${ce('sg-l2', esc(l2))}</div>`);
  return el;
}
function ensureSig() {
  const want = D.sig.on !== false;
  if (!want) { if (sigEl) { sigEl.remove(); } return; }
  if (!sigEl) { sigEl = buildSig(); initPad(); }
  refreshStamp();
  if (sigEl.isConnected) return;
  const sg = D.sig;
  if (sg.mode === 'free') {
    const pg = pages()[Math.min(sg.p || 0, pages().length - 1)] || pages()[0];
    sigEl.classList.remove('atom', 'a-sig'); delete sigEl.dataset.k; sigEl.classList.add('float', 'free');
    sigEl.style.cssText = `left:${sg.x}%;top:${sg.y}%;width:${sg.w}%`; pg.appendChild(sigEl);
  } else {
    sigEl.classList.add('atom', 'a-sig'); sigEl.classList.remove('float', 'free'); sigEl.dataset.k = 'sig'; sigEl.removeAttribute('style');
    $('.pg-body', pages().at(-1)).appendChild(sigEl);
  }
  $$('.sig-pad').forEach(fitPad);
}
function sigToFree() {
  if (!sigEl || sigEl.classList.contains('free')) return;
  const r = sigEl.getBoundingClientRect(), pgs = pages();
  const pg = pgs.find(p => { const pr = p.getBoundingClientRect(); return r.top >= pr.top - 2 && r.top < pr.bottom; }) || pgs.at(-1), pr = pg.getBoundingClientRect();
  sigEl.classList.remove('atom', 'a-sig'); delete sigEl.dataset.k; sigEl.classList.add('float', 'free');
  sigEl.style.cssText = `left:${r1((r.left - pr.left) / pr.width * 100)}%;top:${r1((r.top - pr.top) / pr.height * 100)}%;width:${r1(r.width / pr.width * 100)}%`;
  pg.appendChild(sigEl); D.sig.mode = 'free'; reflow(); touch();
}
function sigToAuto() {
  if (!sigEl) return; D.sig.mode = 'auto'; sigEl.classList.remove('float', 'free'); sigEl.classList.add('atom', 'a-sig'); sigEl.dataset.k = 'sig'; sigEl.removeAttribute('style');
  $('.pg-body', pages().at(-1)).appendChild(sigEl); reflow(); touch(); toast('عاد التوقيع إلى أسفل الصفحة الأخيرة');
}
function sigState() {
  if (!sigEl || !sigEl.classList.contains('free')) return {...D.sig, mode: sigEl && !sigEl.classList.contains('free') ? 'auto' : D.sig.mode};
  const pg = sigEl.closest('.page');
  return {mode: 'free', on: D.sig.on !== false, p: pages().indexOf(pg), x: parseFloat(sigEl.style.left), y: parseFloat(sigEl.style.top), w: parseFloat(sigEl.style.width)};
}
function refreshStamp() {
  if (!sigEl) return; const src = stampSrc(), pad = $('.sig-pad', sigEl), im = $('.stamp', pad), g = S().sig;
  pad.classList.toggle('no-stamp', !src); if (src) im.src = src;
  im.style.left = g.sx + '%'; im.style.top = g.sy + '%'; im.style.width = g.sw + 'mm';
}
// --- رسم التوقيع ---
let drawing = null;
const strokes = () => S().sig.strokes;
function fitPad() {
  if (!sigEl) return; const pad = $('.sig-pad', sigEl), cv = $('canvas', pad); if (!pad.clientWidth) return;
  const k = Math.min(3, (parseFloat(stage.dataset.k) || 1) * Math.max(1, devicePixelRatio || 1));
  const w = Math.round(pad.clientWidth * k), h = Math.round(pad.clientHeight * k);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  redraw();
}
function redraw() {
  const pad = $('.sig-pad', sigEl), cv = $('canvas', pad), ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = S().sig.pen; ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = S().sig.pw * cv.width / 234;
  const all = drawing ? [...strokes(), drawing] : strokes();
  all.forEach(s => { if (!s.length) return; ctx.beginPath(); ctx.moveTo(s[0][0] * cv.width, s[0][1] * cv.height);
    if (s.length < 3) s.forEach(p => ctx.lineTo(p[0] * cv.width, p[1] * cv.height));
    else { for (let i = 1; i < s.length - 1; i++) { const mx = (s[i][0] + s[i + 1][0]) / 2 * cv.width, my = (s[i][1] + s[i + 1][1]) / 2 * cv.height; ctx.quadraticCurveTo(s[i][0] * cv.width, s[i][1] * cv.height, mx, my); } const l = s.at(-1); ctx.lineTo(l[0] * cv.width, l[1] * cv.height); }
    ctx.stroke(); });
  pad.classList.toggle('has-ink', all.length > 0);
}
function initPad() {
  const pad = $('.sig-pad', sigEl), cv = $('canvas', pad);
  const pt = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = [pt(e)]; redraw(); });
  cv.addEventListener('pointermove', e => { if (!drawing) return; drawing.push(pt(e)); redraw(); });
  const end = () => { if (!drawing) return; if (drawing.length === 1) drawing.push([drawing[0][0] + .002, drawing[0][1]]); strokes().push(drawing); drawing = null; redraw(); St.saveSettings(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  // الختم
  const im = $('.stamp', pad); let sd = null;
  im.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); im.setPointerCapture(e.pointerId); sd = true; });
  im.addEventListener('pointermove', e => { if (!sd) return; const r = pad.getBoundingClientRect(); S().sig.sx = r1(clamp((e.clientX - r.left) / r.width * 100, 0, 100)); S().sig.sy = r1(clamp((e.clientY - r.top) / r.height * 100, 0, 100)); refreshStamp(); });
  const se = () => { if (sd) { sd = null; St.saveSettings(); } }; im.addEventListener('pointerup', se); im.addEventListener('pointercancel', se);
  new ResizeObserver(() => fitPad()).observe(pad);
}

/* ===== العناصر الحرة (نص حر + التوقيع الحر) ===== */
function createTbox(pg, o) {
  const d = newNode(`<div class="float tbox" style="left:${o.x}%;top:${o.y}%;width:${o.w}%"><div class="fl-bar no-print" contenteditable="false"><button type="button" data-tb="mv" aria-label="تحريك">✥</button><button type="button" data-tb="rs" aria-label="عرض">↔</button><button type="button" data-act="fdel" aria-label="حذف">✕</button></div>${ce('tb-c', o.html || '', 'data-ph="نص حر…"')}</div>`);
  setLo(d); pg.appendChild(d); return d;
}
const setLo = d => d.classList.toggle('lo', parseFloat(d.style.top) < 7);
const collectTb = () => pages().flatMap((pg, i) => $$('.tbox', pg).map(d => ({p: i, x: r1(parseFloat(d.style.left)), y: r1(parseFloat(d.style.top)), w: r1(parseFloat(d.style.width)), html: $('.tb-c', d).innerHTML})));
function addTbox() {
  const pgs = pages(), mid = innerHeight * .35, pg = pgs.find(p => { const r = p.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || pgs[0], r = pg.getBoundingClientRect();
  const d = createTbox(pg, {x: 15, y: clamp((mid - r.top) / r.height * 100, 10, 85), w: 60, html: ''});
  closePanel(); touch(); $('.tb-c', d).focus();
}
function delFloat(d) {
  const pg = d.parentElement, o = {x: parseFloat(d.style.left), y: parseFloat(d.style.top), w: parseFloat(d.style.width), html: $('.tb-c', d).innerHTML};
  d.remove(); touch(); toast('تم حذف صندوق النص', () => { createTbox(pg.isConnected ? pg : pages()[0], o); touch(); });
}
document.addEventListener('pointerdown', e => {
  if (!isOpen()) return;
  const f = e.target.closest && e.target.closest('.float, .a-sig');
  $$('.float.sel, .a-sig.sel').forEach(x => { if (x !== f) x.classList.remove('sel'); }); if (f) f.classList.add('sel');
  const b = e.target.closest && e.target.closest('[data-tb]'); if (!b) return;
  e.preventDefault();
  const box = b.closest('.float, .a-sig'); if (box.classList.contains('a-sig')) sigToFree();
  const r = box.getBoundingClientRect();
  tbd = {box, mode: b.dataset.tb, ox: e.clientX - r.left, oy: e.clientY - r.top, x0: e.clientX, w0: parseFloat(box.style.width)};
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
    box.style.width = r1(clamp(tbd.w0 + (e.clientX - tbd.x0) / r.width * 100, 14, 100 - parseFloat(box.style.left))) + '%';
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
  D.tb = collectTb(); D.sig = sigState();
  const pn = $('.mv[data-lbl="Patient Name"]', PAGES); D.patient = pn ? pn.textContent.trim() : '';
  if (!St.saveDraft(D)) toast('تعذّر الحفظ: مساحة التخزين ممتلئة. نزّل نسخة احتياطية.');
}
document.addEventListener('visibilitychange', () => { if (document.hidden && isOpen()) save(); });
window.addEventListener('pagehide', () => { if (isOpen()) save(); });

/* ===== تحميل محتوى التقرير ===== */
function loadAtoms(list) {
  if (sigEl) sigEl.remove(); $$('.float', PAGES).forEach(f => f.remove());
  pages().slice(1).forEach(p => p.remove());
  if (!pages().length) PAGES.appendChild(makePage());
  $('.pg-body', pages()[0]).innerHTML = list.join('');
  ensureSig(); reflow();
}
function restoreFloats() {
  (D.tb || []).forEach(o => createTbox(pages()[Math.min(o.p || 0, pages().length - 1)], o));
  if (sigEl && D.sig.mode === 'free' && sigEl.classList.contains('free')) { const pg = pages()[Math.min(D.sig.p || 0, pages().length - 1)]; if (sigEl.parentElement !== pg) pg.appendChild(sigEl); }
}
function reload(list) { D.tb = collectTb(); D.sig = sigState(); loadAtoms(list); restoreFloats(); }
const snapshot = () => docAtoms().map(a => a.cloneNode(true).outerHTML);

export async function open(draft, opts = {}) {
  D = draft; study = await Data.loadStudy(D.studyId);
  $('#home').hidden = true; $('#editor').hidden = false; document.body.classList.remove('home-on');
  PAGES.innerHTML = ''; sigEl = null; brandDirty = true;
  buildPanel(); closePanel(); closeBank();
  $('#abTitle').textContent = study.title; updateBar();
  PAGES.appendChild(makePage());
  loadAtoms(D.atoms); ensureSig(); reflow(); restoreFloats(); reflow();
  window.scrollTo(0, 0); cur.atom = null; updateCtx();
  initBank(api); if (opts.bank) openBank(study, {query: opts.bank});
}
export function close() {
  if (!D) return; save(); clearTimeout(saveT); closePanel(); closeBank();
  $('#editor').hidden = true; PAGES.innerHTML = ''; sigEl = null; D = null; study = null;
}
export const current = () => D;
function updateBar() {
  const v = study.variants.find(x => x.id === D.variantId) || study.variants[0];
  $('#abSub').textContent = (study.title_ar ? study.title_ar + ' · ' : '') + v.label;
  $('#abVar').textContent = (KIND_AR[v.kind] || 'النسخة') + ' ▾';
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
  if (!a || ['meta', 'title', 'sig'].includes(kind(a))) return toast('هذا العنصر لا يُحذف');
  const snap = snapshot(), grp = sectionOf(a), list = docAtoms(), prev = list[list.indexOf(a) - 1], nextA = list[list.indexOf(grp.at(-1)) + 1];
  grp.forEach(x => x.remove()); touch(); reflow();
  const f = prev || nextA; if (f) focusAtom(f);
  toast(grp.length > 1 ? `حُذف القسم (${grp.length} بنود)` : 'تم الحذف', () => { reload(snap); touch(); });
}
function moveAtom(a, dir) {
  const k = kind(a); if (!a || ['meta', 'title', 'sig'].includes(k)) return;
  const list = docAtoms(), grp = sectionOf(a), i0 = list.indexOf(grp[0]), i1 = list.indexOf(grp.at(-1));
  let ref;
  if (k === 'li' || k === 'p') ref = dir < 0 ? list[i0 - 1] : list[i1 + 1];
  else {
    const same = x => kind(x) === k;
    if (dir < 0) { let s = i0 - 1; while (s >= 0 && !same(list[s]) && !(k === 'h2' && kind(list[s]) === 'h1')) s--; if (s < 0 || !same(list[s])) return toast('هذا أول قسم'); ref = list[s]; }
    else { const n = list[i1 + 1]; if (!n || !same(n)) return toast('هذا آخر قسم'); ref = sectionOf(n).at(-1); }
  }
  if (!ref || ['meta', 'title'].includes(kind(ref))) return toast('لا يمكن النقل أكثر');
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
  choose('اختر', [...opts.map(o => ({label: o, value: o, ltr: true})), {label: '✎ كتابة يدوية', value: null}], v => {
    if (v == null) { selectNode(ph); return; }
    const t = document.createTextNode(v); ph.replaceWith(t);
    const r = document.createRange(); r.setStartAfter(t); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    touch(); reflow();
  });
}
function nextPh() {
  const all = $$('.ph', PAGES).filter(p => p.offsetParent !== null); if (!all.length) return toast('لا توجد حقول [ ] متبقية ✓');
  const s = getSelection(); let t = all[0];
  if (s.rangeCount) { const a = s.getRangeAt(0); const f = all.find(p => (p.compareDocumentPosition(a.endContainer) & Node.DOCUMENT_POSITION_PRECEDING) && !p.contains(a.endContainer)); if (f) t = f; }
  phAction(t);
}
const unfilled = () => $$('.ph', PAGES).length;

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
    else if (k === 'meta') { const all = $$('.mv', atom), i = all.indexOf(c); const nx = all[i + 1]; if (nx) nx.focus(); else { const nxa = docAtoms()[docAtoms().indexOf(atom) + 2]; if (nxa) focusAtom(nxa); } }
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
  if (c && c.matches('.sg-l1,.sg-l2')) { S().sig[c.matches('.sg-l1') ? 'line1' : 'line2'] = c.textContent; St.saveSettings(); }
});
PAGES.addEventListener('click', e => {
  const ph = e.target.closest && e.target.closest('.ph'); if (ph) { phAction(ph); return; }
  const b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'fdel') delFloat(b.closest('.float')); else if (a === 'sigauto') sigToAuto();
  else if (a === 'pundo') { strokes().pop(); redraw(); St.saveSettings(); } else if (a === 'pclr') { S().sig.strokes = []; redraw(); St.saveSettings(); }
});
document.addEventListener('focusin', e => {
  if (!isOpen()) return;
  const a = atomOf(e.target); if (a) cur.atom = a; else if (e.target.closest && e.target.closest('.float, .a-sig')) cur.atom = null;
  setTimeout(updateCtx, 0);
});
document.addEventListener('focusout', () => { if (isOpen()) setTimeout(updateCtx, 80); });
function updateCtx() {
  const ae = document.activeElement, inBody = !!(ae && ae.isContentEditable && atomOf(ae)) && kind(atomOf(ae)) !== 'sig';
  const k = cur.atom && kind(cur.atom), movable = !['meta', 'title', 'sig', undefined, null].includes(k);
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
  const where = useSection ? $('.c', useSection).textContent.replace(/[:：]/g, '') : 'الموضع الحالي';
  toast('تمت الإضافة ← ' + where);
}
function applyCase(g) {
  const parts = {};
  g.subs.forEach(s => { if (s.kind && s.items.length) parts[s.kind] = s.items; });
  if (!Object.keys(parts).length) { toast('هذه المجموعة عبارات منفصلة – اضغط على أي عبارة لإدراجها'); return false; }
  const snap = snapshot(); let done = 0;
  for (const k of ['indication', 'technique', 'findings', 'impression']) {
    if (!parts[k]) continue; const h = findSection(k); if (!h) continue;
    const grp = sectionOf(h); grp.slice(1).forEach(x => x.remove());
    let ref = h; parts[k].forEach(t => { const n = newNode(A.li(phHtml(t))); ref.after(n); ref = n; }); done++;
  }
  if (!done) { toast('لا توجد أقسام مطابقة في هذا النموذج'); return false; }
  touch(); reflow(); window.scrollTo({top: 0, behavior: 'smooth'});
  toast('تم تطبيق الحالة على التقرير', () => { reload(snap); touch(); }); return true;
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
  const out = {fields: [], title: '', items: [], free: [], sig: null, brand: St.brand(), settings: S()};
  docAtoms().forEach(a => {
    const k = kind(a); if (a.dataset.hide) return;
    if (k === 'meta') $$('.mf', a).forEach(m => out.fields.push({l: $('.ml', m).textContent.replace(/:$/, ''), v: $('.mv', m).textContent.trim()}));
    else if (k === 'title') out.title = $('.c', a).textContent.trim();
    else out.items.push({t: k, html: $('.c', a).innerHTML, text: $('.c', a).textContent.trim()});
  });
  pages().forEach((pg, i) => $$('.tbox', pg).forEach(d => { const t = $('.tb-c', d).textContent.trim(); if (t) out.free.push({p: i, y: parseFloat(d.style.top), html: $('.tb-c', d).innerHTML, text: t}); }));
  if (D.sig.on !== false && sigEl) { const sg = sigState(), [l1, l2] = sigLines(); out.sig = {mode: sg.mode, x: sg.x, line1: l1, line2: l2, strokes: S().sig.strokes, pen: S().sig.pen, pw: S().sig.pw, stamp: stampSrc(), sx: S().sig.sx, sy: S().sig.sy, sw: S().sig.sw, image: (St.brand().signature || {}).image || ''}; }
  markEmpties(false); return out;
}
let prepared = false;
export function prepOutput() { if (prepared) return; prepared = true; markEmpties(S().hideEmpty); document.body.classList.add('printing'); $$('.sel').forEach(x => x.classList.remove('sel')); reflow(); }
export function endOutput() { if (!prepared) return; prepared = false; markEmpties(false); document.body.classList.remove('printing'); reflow(); }
window.addEventListener('beforeprint', () => { if (isOpen()) prepOutput(); });
window.addEventListener('afterprint', () => { if (isOpen()) endOutput(); });

/* ===== لوحة التحكم ===== */
const TABS = [['xp', 'تصدير'], ['add', 'إضافة'], ['fmt', 'تنسيق'], ['page', 'الصفحة'], ['sig', 'التوقيع'], ['brand', 'الهوية']];
const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
const upl = (id, label) => `<div class="upl" data-upl="${id}"><img alt="" hidden><span class="nm">${label}</span><label class="btn sm fileb">رفع<input type="file" accept="image/*"></label><button class="btn sm danger" type="button" data-clr="${id}">حذف</button></div>`;
function buildPanel() {
  panel.innerHTML = `<button class="p-x" type="button" id="pClose" aria-label="إغلاق">✕</button>
  <div class="tabs">${TABS.map(([k, l]) => `<button type="button" data-tabbtn="${k}">${l}</button>`).join('')}</div>
  <section class="tab" data-tab="xp">
    <button class="btn dark" type="button" data-x="print">🖨 طباعة / حفظ PDF</button>
    <button class="btn" type="button" data-x="docx">📄 تصدير ملف Word (.docx)</button>
    <button class="btn" type="button" data-x="png">🖼 حفظ كصورة PNG</button>
    <button class="btn" type="button" data-x="copy">📋 نسخ نص التقرير (للصق في أي نظام)</button>
    <div class="lbl">صورة PNG</div>
    ${seg('xmode', [['one', 'صورة واحدة طويلة'], ['each', 'صورة لكل صفحة']])}
    ${seg('xq', [['1', 'عادية'], ['2', 'عالية'], ['3', 'عالية جداً']])}
    <label class="sw"><span>مشاركة الملف بدل التنزيل (الهاتف)</span><input type="checkbox" id="shareOn"></label>
    <div class="hint">يتم تجاهل البنود الفارغة تلقائياً في الطباعة والتصدير (يمكن تعطيل ذلك من تبويب «الصفحة»). تنبيه: ملف Word لا يحفظ مواضع النص الحر بدقة، بل يضعها بعد المحتوى.</div>
  </section>
  <section class="tab" data-tab="add">
    <div class="g3">
      <button class="tbtn" type="button" data-add="li"><span class="ic">•</span><span>بند جديد</span></button>
      <button class="tbtn" type="button" data-add="h2"><span class="ic">▪</span><span>عنوان فرعي</span></button>
      <button class="tbtn" type="button" data-add="h1"><span class="ic">▪▪</span><span>عنوان قسم</span></button>
      <button class="tbtn" type="button" data-add="p"><span class="ic">¶</span><span>فقرة نص</span></button>
      <button class="tbtn" type="button" data-add="tb"><span class="ic">⬚</span><span>نص حر في أي مكان</span></button>
      <button class="tbtn" type="button" data-add="ph"><span class="ic">[ ]</span><span>حقل للتعبئة</span></button>
    </div>
    <div class="hint">يُضاف العنصر بعد البند الذي تقف عليه الآن. استخدم شريط (＋ بند / ↑ / ↓ / حذف) الذي يظهر فوق الأزرار أثناء الكتابة. «حقل للتعبئة» يضع [ ] ليسهل القفز إليه بزر «التالي».</div>
  </section>
  <section class="tab" data-tab="fmt">
    <div class="g4">
      <button class="tbtn" type="button" data-fmt="bold"><span class="ic"><b>B</b></span><span>غامق</span></button>
      <button class="tbtn" type="button" data-fmt="italic"><span class="ic"><i>I</i></span><span>مائل</span></button>
      <button class="tbtn" type="button" data-fmt="underline"><span class="ic"><u>U</u></span><span>تسطير</span></button>
      <button class="tbtn" type="button" data-fmt="clear"><span class="ic">⌫</span><span>مسح التنسيق</span></button>
      <button class="tbtn" type="button" data-fmt="sz+"><span class="ic">A+</span><span>أكبر</span></button>
      <button class="tbtn" type="button" data-fmt="sz-"><span class="ic">A−</span><span>أصغر</span></button>
      <button class="tbtn" type="button" data-fmt="undo"><span class="ic">↶</span><span>تراجع</span></button>
      <button class="tbtn" type="button" data-fmt="redo"><span class="ic">↷</span><span>إعادة</span></button>
    </div>
    <div class="hint">حدّد النص أولاً ثم اضغط. العناوين غامقة تلقائياً.</div>
  </section>
  <section class="tab" data-tab="page">
    <div class="lbl">حجم العرض</div>
    <div class="g3"><button class="btn" type="button" data-x="zout">− تصغير</button><button class="btn" type="button" data-x="zfit">ملاءمة</button><button class="btn" type="button" data-x="zin">+ تكبير</button></div>
    <div class="lbl">ترقيم الصفحات</div>
    ${seg('pn', [['off', 'بدون'], ['n', '1'], ['nofm', '1 / 3'], ['page', 'Page 1 of 3']])}
    ${seg('pnPos', [['l', 'يسار'], ['r', 'يمين']])}
    <div class="lbl">الترويسة (إن وُجدت)</div>
    ${seg('hdr', [['all', 'كل الصفحات'], ['first', 'الأولى فقط'], ['none', 'إخفاء']])}
    <div class="lbl">التذييل (إن وُجد)</div>
    ${seg('ftr', [['all', 'كل الصفحات'], ['last', 'الأخيرة فقط'], ['none', 'إخفاء']])}
    <div class="lbl">الخط الفاصل أعلى التذييل / الترقيم</div>
    ${seg('fline', [['auto', 'تلقائي'], ['on', 'دائماً'], ['off', 'إخفاء']])}
    <label class="sw"><span>إخفاء البنود الفارغة عند الطباعة والتصدير</span><input type="checkbox" id="hideEmpty"></label>
  </section>
  <section class="tab" data-tab="sig">
    <label class="sw"><span>إظهار التوقيع في التقرير</span><input type="checkbox" id="sigOn"></label>
    <div class="g2"><button class="btn" type="button" data-x="sigauto">⇩ أسفل آخر صفحة (تلقائي)</button><button class="btn danger" type="button" data-x="sigclr">مسح التوقيع المرسوم</button></div>
    <div class="hint">للتحريك: اضغط على التوقيع ثم اسحب زر «✥ تحريك» إلى أي مكان في أي صفحة – حتى لو بقي جزء صغير في آخر الصفحة. زر «↔» يغيّر حجمه. التوقيع المرسوم والاسم يُحفظان على جهازك ويظهران في كل تقرير جديد.</div>
    <div class="lbl">لون القلم</div>
    ${seg('pen', [['#0b1a4a', 'كحلي'], ['#000000', 'أسود'], ['#1740c8', 'أزرق']])}
    <div class="lbl">سمك الخط</div><input type="range" id="penW" min="1" max="5" step=".2">
    ${upl('stamp', 'صورة الختم')}
    <div class="lbl">حجم الختم</div><input type="range" id="stampW" min="12" max="60" step="1">
    <div class="hint">الختم يُسحب داخل مربع التوقيع. لا يظهر ختم افتراضي.</div>
  </section>
  <section class="tab" data-tab="brand">
    <div class="hint">الهوية (ترويسة، تذييل، شعارات، علامة مائية) فارغة افتراضياً لأن النموذج غير مخصص لجهة معيّنة. عبّئ ما تريد وسيظهر في كل التقارير على هذا الجهاز.</div>
    <div class="lbl">الترويسة</div>
    <input class="fi" data-b="header.line1" placeholder="السطر 1 (اسم المستشفى / المركز)"><input class="fi" data-b="header.line2" placeholder="السطر 2 (القسم)"><input class="fi" data-b="header.line3" placeholder="السطر 3 (عنوان / هاتف)">
    ${upl('logoLeft', 'شعار اليسار')}${upl('logoRight', 'شعار اليمين')}
    <div class="lbl">التذييل</div>
    <input class="fi" data-b="footer.line1" placeholder="سطر التذييل 1"><input class="fi" data-b="footer.line2" placeholder="سطر التذييل 2">
    <div class="lbl">العلامة المائية</div>
    ${upl('wm', 'صورة العلامة المائية')}
    <label class="sw"><span>إظهار العلامة المائية</span><input type="checkbox" id="wmOn"></label>
    <div class="lbl">شفافية العلامة المائية</div><input type="range" id="wmOp" min="3" max="25" step="1">
  </section>`;
  syncPanel();
}
function syncPanel() {
  const s = S();
  $$('[data-seg]', panel).forEach(sg => $$('button', sg).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(sg.dataset.seg === 'pen' ? s.sig.pen : s[sg.dataset.seg])))));
  $('#hideEmpty', panel).checked = !!s.hideEmpty; $('#shareOn', panel).checked = !!s.share; $('#sigOn', panel).checked = D && D.sig.on !== false;
  $('#penW', panel).value = s.sig.pw; $('#stampW', panel).value = s.sig.sw; $('#wmOn', panel).checked = !!s.wmOn; $('#wmOp', panel).value = s.wmOp;
  $$('[data-b]', panel).forEach(i => { const [a, b] = i.dataset.b.split('.'); i.value = (St.brand()[a] || {})[b] || ''; });
  const b = St.brand(), map = {logoLeft: (b.header || {}).logoLeft, logoRight: (b.header || {}).logoRight, wm: (b.watermark || {}).image, stamp: (b.stamp || {}).image};
  $$('[data-upl]', panel).forEach(u => { const src = map[u.dataset.upl], im = $('img', u); im.hidden = !src; if (src) im.src = src; });
}
export function showTab(t) { panel.dataset.tab = t; $$('[data-tabbtn]', panel).forEach(b => b.classList.toggle('on', b.dataset.tabbtn === t)); $$('.tab', panel).forEach(s => s.classList.toggle('on', s.dataset.tab === t)); $$('.dk').forEach(d => d.classList.toggle('act', (panel.classList.contains('open') && d.dataset.open === t) || (d.dataset.open === 'bank' && bankOpen()))); }
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
    St.saveSettings(); syncPanel(); reflow(); return;
  }
  const f = t.closest('[data-fmt]'); if (f) return doFmt(f.dataset.fmt);
  const ad = t.closest('[data-add]');
  if (ad) { const k = ad.dataset.add; if (k === 'tb') return addTbox(); if (k === 'ph') { if (!document.activeElement || !document.activeElement.isContentEditable) return toast('اضغط داخل نص أولاً'); document.execCommand('insertHTML', false, '<span class="ph">[ ]</span>&nbsp;'); touch(); return; } closePanel(); return addAtom(k); }
  const clr = t.closest('[data-clr]');
  if (clr) { setImage(clr.dataset.clr, ''); return; }
  const x = t.closest('[data-x]'); if (!x) return;
  const a = x.dataset.x;
  if (a === 'print') Exp.printReport(api, {prepOutput, endOutput}); else if (a === 'docx') Exp.exportDocx(api, readDoc, S()); else if (a === 'png') Exp.exportPng(api, {prepOutput, endOutput, pages}, S());
  else if (a === 'copy') Exp.copyText(readDoc(S().hideEmpty)); else if (a === 'zin') { S().zoom = clamp((S().zoom || 1) + .15, .5, 3); St.saveSettings(); scaleView(); }
  else if (a === 'zout') { S().zoom = clamp((S().zoom || 1) - .15, .5, 3); St.saveSettings(); scaleView(); } else if (a === 'zfit') { S().zoom = 1; St.saveSettings(); scaleView(); }
  else if (a === 'sigauto') sigToAuto(); else if (a === 'sigclr') { S().sig.strokes = []; redraw(); St.saveSettings(); }
});
panel.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'hideEmpty') S().hideEmpty = t.checked; else if (t.id === 'shareOn') S().share = t.checked;
  else if (t.id === 'wmOn') { S().wmOn = t.checked; renderBrand(); } else if (t.id === 'sigOn') { D.sig.on = t.checked; if (!t.checked && sigEl) sigEl.remove(); else ensureSig(); reflow(); touch(); }
  else if (t.type === 'file') { const u = t.closest('[data-upl]'); if (t.files[0]) setImage(u.dataset.upl, await readImg(t.files[0], u.dataset.upl === 'wm' ? 1400 : 700)); t.value = ''; return; }
  St.saveSettings();
});
panel.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.b) { St.setBrand(t.dataset.b, t.value); renderBrand(); reflow(); }
  else if (t.id === 'penW') { S().sig.pw = +t.value; redraw(); St.saveSettings(); } else if (t.id === 'stampW') { S().sig.sw = +t.value; refreshStamp(); St.saveSettings(); }
  else if (t.id === 'wmOp') { S().wmOp = +t.value; renderBrand(); St.saveSettings(); }
});
function setImage(id, val) {
  const path = {logoLeft: 'header.logoLeft', logoRight: 'header.logoRight', wm: 'watermark.image', stamp: 'stamp.image'}[id];
  St.setBrand(path, val); if (id === 'wm') { S().wmOn = true; } renderBrand(); refreshStamp(); syncPanel(); reflow(); toast(val ? 'تم الحفظ' : 'تم الحذف');
}
function doFmt(f) {
  const ae = document.activeElement; if (!ae || !ae.isContentEditable) return toast('اضغط داخل نص أولاً');
  const map = {bold: 'bold', italic: 'italic', underline: 'underline', clear: 'removeFormat', undo: 'undo', redo: 'redo'};
  if (f === 'sz+' || f === 'sz-') { const c = parseInt(document.queryCommandValue('fontSize')) || 3; document.execCommand('fontSize', false, clamp(c + (f === 'sz+' ? 1 : -1), 1, 7)); }
  else document.execCommand(map[f], false, null);
  touch(); schedReflow();
}

/* ===== الشريط العلوي والقوائم ===== */
$('#abBack').onclick = () => { save(); if (history.state && history.state.rr) history.back(); else { location.hash = ''; window.dispatchEvent(new Event('popstate')); } };
$('#abVar').onclick = () => {
  choose('اختر نسخة النموذج', study.variants.map(v => ({label: v.label, sub: VAR_DESC[v.kind] || '', value: v.id, current: v.id === D.variantId})), vid => {
    if (vid === D.variantId && !D.edited) return;
    const go = () => switchVariant(vid);
    if (D.edited) confirmBox('تغيير النسخة', 'سيتم استبدال محتوى التقرير الحالي بالنسخة المختارة (تُحفظ بيانات المريض في الأعلى، ويمكنك التراجع).', 'استبدال', go); else go();
  });
};
function switchVariant(vid) {
  const snap = snapshot(), oldV = D.variantId, wasEdited = D.edited, v = study.variants.find(x => x.id === vid);
  const vals = {}; $$('.mv', PAGES).forEach(m => { vals[m.dataset.lbl] = m.textContent; });
  D.variantId = vid; reload(atomsFromVariant(v, vals)); touch(); updateBar(); window.scrollTo(0, 0);
  toast('تم تغيير النسخة', () => { D.variantId = oldV; reload(snap); D.edited = wasEdited; touch(); updateBar(); });
}
$('#abMore').onclick = () => {
  choose('خيارات التقرير', [
    {label: '📋 نسخ نص التقرير', value: 'copy'}, {label: '＋ تقرير جديد من نفس الدراسة', sub: 'يُحفظ هذا التقرير في المسودات', value: 'new'},
    {label: '🗑 حذف هذه المسودة', value: 'del'}], v => {
      if (v === 'copy') Exp.copyText(readDoc(S().hideEmpty));
      else if (v === 'new') { save(); window.dispatchEvent(new CustomEvent('rr:new', {detail: {studyId: D.studyId, variantId: D.variantId}})); }
      else if (v === 'del') confirmBox('حذف المسودة', 'سيتم حذف هذا التقرير نهائياً.', 'حذف', () => { const id = D.id; D.edited = false; St.removeDraft(id); close(); window.dispatchEvent(new CustomEvent('rr:home')); });
    });
};
let lw = 0;
window.addEventListener('resize', () => { const w = innerWidth; if (isOpen() && w !== lw) { lw = w; scaleView(); } });
if (window.visualViewport) { const kb = () => { const k = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop); document.documentElement.style.setProperty('--kb', Math.round(k) + 'px'); }; visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb); }
window.__dbg = {get D() { return D; }, reflow, docAtoms, pages, api, readDoc, nextPh, addAtom, moveAtom, delAtom, sigToFree, get sigEl() { return sigEl; }};
