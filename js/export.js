// التصدير: طباعة/PDF، Word، صورة PNG، نسخ النص
import { $, esc, toast, openSheet, closeSheet, toDataUrl } from './util.js';

function guard(api, go) {
  const n = api.unfilled(); if (!n) return go();
  const body = openSheet('Unfilled fields', `<div class="hint" style="font-size:14px">There are <b>${n}</b> highlighted [ ] fields still unfilled. Continue anyway?</div><div class="g2"><button class="btn danger" type="button" data-go>Continue anyway</button><button class="btn" type="button" data-no>Back to editing</button></div>`);
  body.onclick = e => { if (e.target.closest('[data-go]')) { closeSheet(); go(); } else if (e.target.closest('[data-no]')) closeSheet(); };
}
const slug = s => String(s || 'report').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'report';
const stamp = () => new Date().toISOString().slice(0, 10);
const nameOf = doc => { const pn = (doc.fields.find(f => /patient/i.test(f.l)) || {}).v; return `${slug(doc.title).slice(0, 40)}_${slug(pn || 'patient')}_${stamp()}`; };

export function printReport(api, {prepOutput, endOutput}) {
  guard(api, () => { prepOutput(); setTimeout(() => { window.print(); document.addEventListener('pointerdown', () => endOutput(), {once: true}); }, 150); });
}
export async function copyText(doc) {
  const L = [];
  doc.fields.forEach(f => L.push(`${f.l}: ${f.v}`)); L.push('', doc.title, '');
  doc.items.forEach(it => { if (it.t === 'h1') L.push('', '▪ ' + it.text); else if (it.t === 'h2') L.push('  ▪ ' + it.text); else if (it.t === 'li') L.push('- ' + it.text); else L.push(it.text); });
  doc.free.forEach(f => L.push('', f.text));
  const text = L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  try { await navigator.clipboard.writeText(text); } catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
  toast('Report text copied');
}
async function deliver(files, s) {
  if (s.share && navigator.canShare && navigator.canShare({files})) { try { await navigator.share({files}); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  files.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, i * 350));
  toast(files.length > 1 ? `Downloading ${files.length} files` : 'File downloaded');
}

/* ---------- PNG ---------- */
let cssText = null;
async function pageToCanvas(pg, q) {
  if (!cssText) cssText = await (await fetch('css/app.css')).text();
  const w = pg.offsetWidth, h = pg.offsetHeight, clone = pg.cloneNode(true);
  clone.querySelectorAll('.no-print,.fl-bar,.pad-tools,.pad-hint').forEach(x => x.remove());
  const src = pg.querySelectorAll('canvas'), dst = clone.querySelectorAll('canvas');
  src.forEach((c, i) => { const im = document.createElement('img'); im.src = c.toDataURL('image/png'); im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; dst[i].replaceWith(im); });
  for (const im of clone.querySelectorAll('img')) { if (im.getAttribute('src') && !im.src.startsWith('data:')) im.setAttribute('src', await toDataUrl(im.src)); }
  clone.querySelectorAll('.sig-pad').forEach(p => { p.style.background = 'none'; p.style.outline = '0'; });
  clone.querySelectorAll('.c').forEach(c => c.removeAttribute('contenteditable'));
  clone.style.boxShadow = 'none';
  const wrap = document.createElementNS('http://www.w3.org/1999/xhtml', 'div'); wrap.setAttribute('class', document.getElementById('pages').className); wrap.setAttribute('style', `width:${w}px;height:${h}px;direction:ltr;--navy:#0f3d5e;--k:${document.getElementById('pages').style.getPropertyValue('--k') || 1};display:block`);
  const style = document.createElementNS('http://www.w3.org/1999/xhtml', 'style'); style.textContent = cssText.replace(/@media print\s*\{[\s\S]*$/, ''); wrap.appendChild(style); wrap.appendChild(clone);
  const xml = new XMLSerializer().serializeToString(wrap);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
  const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('svg')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const cv = document.createElement('canvas'); cv.width = w * q; cv.height = h * q; const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
const toBlob = cv => new Promise(ok => cv.toBlob(ok, 'image/png'));
export function exportPng(api, {prepOutput, endOutput, pages}, s) {
  guard(api, async () => {
    toast('Creating image…', null, 6000); prepOutput();
    try {
      await new Promise(r => setTimeout(r, 120));
      const q = Math.min(3, +s.xq || 2), pgs = pages(), cvs = [];
      for (const pg of pgs) cvs.push(await pageToCanvas(pg, q));
      const nm = nameOf(api.readDocForName ? api.readDocForName() : {fields: [], title: 'report'});
      let files = [];
      if (s.xmode === 'one' && cvs.length > 1) {
        const all = document.createElement('canvas'); all.width = cvs[0].width; all.height = cvs.reduce((a, c) => a + c.height, 0);
        const ctx = all.getContext('2d'); let y = 0; cvs.forEach(c => { ctx.drawImage(c, 0, y); y += c.height; });
        files = [new File([await toBlob(all)], nm + '.png', {type: 'image/png'})];
      } else files = await Promise.all(cvs.map(async (c, i) => new File([await toBlob(c)], cvs.length > 1 ? `${nm}_p${i + 1}.png` : nm + '.png', {type: 'image/png'})));
      await deliver(files, s);
    } catch (e) { console.error(e); toast('Could not create the image in this browser – use Print / PDF'); }
    finally { endOutput(); }
  });
}

/* ---------- Word ---------- */
let docxP = null;
const loadDocx = () => docxP || (docxP = new Promise((ok, no) => { if (window.docx) return ok(window.docx); const s = document.createElement('script'); s.src = 'vendor/docx.iife.js'; s.onload = () => ok(window.docx); s.onerror = () => { docxP = null; no(new Error('docx')); }; document.head.appendChild(s); }));
const AR = /[؀-ۿ]/;
const dataMime = d => (/^data:image\/(png|jpe?g|gif|bmp)/i.exec(d) || [])[1] || 'png';
const dataBytes = d => Uint8Array.from(atob(d.split(',')[1]), c => c.charCodeAt(0));
function loadImg(src) { return new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }); }
async function padPng(pad) {
  const W = 480, H = Math.round(W * 24 / 62), cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
  if (pad.image) { const im = await loadImg(await toDataUrl(pad.image)); if (im) ctx.drawImage(im, 0, 0, W, H); }
  ctx.strokeStyle = pad.pen; ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = pad.pw * W / 234;
  pad.strokes.forEach(s => { if (!s.length) return; ctx.beginPath(); ctx.moveTo(s[0][0] * W, s[0][1] * H); s.forEach(p => ctx.lineTo(p[0] * W, p[1] * H)); ctx.stroke(); });
  if (!pad.strokes.length && !pad.image) return null;
  return dataBytes(cv.toDataURL('image/png'));
}
export function exportDocx(api, readDoc, s) {
  guard(api, async () => {
    toast('Creating Word file…', null, 5000);
    try {
      const X = await loadDocx(), doc = readDoc(s.hideEmpty), b = doc.brand;
      const {Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ImageRun, Header, Footer, PageNumber, LevelFormat} = X;
      const F = 'Arial', none = {style: BorderStyle.NONE, size: 0, color: 'FFFFFF'}, noB = {top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none};
      const runs = (html, base = {}) => {
        const d = document.createElement('div'); d.innerHTML = html; const out = []; let first = true;
        (function walk(n, st) { n.childNodes.forEach(c => {
          if (c.nodeType === 3) { if (c.nodeValue) out.push(new TextRun({text: c.nodeValue, font: F, size: base.size || 20, bold: st.b || base.bold, italics: st.i, underline: st.u ? {} : undefined, rightToLeft: AR.test(c.nodeValue)})); }
          else if (c.nodeType === 1) { const t = c.tagName; if (t === 'BR') out.push(new TextRun({break: 1})); else { if (t === 'DIV' && !first) out.push(new TextRun({break: 1})); walk(c, {b: st.b || t === 'B' || t === 'STRONG', i: st.i || t === 'I' || t === 'EM', u: st.u || t === 'U'}); } }
          first = false; }); })(d, {});
        return out.length ? out : [new TextRun({text: '', font: F, size: base.size || 20})];
      };
      const bidi = t => AR.test(t) ? {bidirectional: true} : {};
      const kids = [];
      // patient fields
      const K = doc.fitK || 1, Z = n => Math.max(12, Math.round(n * K));
      const fl = doc.fields, one = String(doc.settings.metaCols) === '1', per = one ? 1 : 2, cw = one ? 9800 : 4900, rows = [];
      for (let i = 0; i < fl.length; i += per) rows.push(new TableRow({children: fl.slice(i, i + per).concat(per === 2 && fl.length - i < 2 ? [null] : []).map(f => new TableCell({borders: noB, width: {size: cw, type: WidthType.DXA}, margins: {top: 30, bottom: 30},
        children: [new Paragraph({children: f ? [new TextRun({text: f.l + ': ', bold: true, font: F, size: Z(20)}), new TextRun({text: f.v, font: F, size: Z(20), rightToLeft: AR.test(f.v)})] : []})]}))}));
      if (rows.length) kids.push(new Table({rows, width: {size: 9800, type: WidthType.DXA}, columnWidths: one ? [9800] : [4900, 4900], borders: noB}));
      const tl = doc.settings.titleLines ? {top: {style: BorderStyle.SINGLE, size: 8, color: '000000', space: 4}, bottom: {style: BorderStyle.SINGLE, size: 8, color: '000000', space: 4}} : undefined;
      kids.push(new Paragraph({alignment: AlignmentType.CENTER, spacing: {before: 160, after: 120}, border: tl, children: [new TextRun({text: doc.title, bold: true, font: F, size: Z(24)})]}));
      doc.items.forEach(it => {
        if (it.t === 'h1') kids.push(new Paragraph({keepNext: true, spacing: {before: 200, after: 40}, ...bidi(it.text), children: [new TextRun({text: '▪ ' + it.text, bold: true, font: F, size: Z(21)})]}));
        else if (it.t === 'h2') kids.push(new Paragraph({keepNext: true, indent: {left: 280}, spacing: {before: 120, after: 30}, ...bidi(it.text), children: [new TextRun({text: '▪ ' + it.text, bold: true, font: F, size: Z(20)})]}));
        else if (it.t === 'li') kids.push(new Paragraph({numbering: {reference: 'bul', level: 0}, spacing: {before: 20, after: 20}, ...bidi(it.text), children: runs(it.html, {size: Z(20)})}));
        else kids.push(new Paragraph({spacing: {before: 40, after: 40}, ...bidi(it.text), children: runs(it.html, {size: Z(20)})}));
      });
      // free blocks (text / signature text / drawing box / stamp): in reading order, aligned by horizontal position
      const padBytes = doc.free.some(f => f.t === 'pad') ? await padPng(doc.pad) : null;
      let stampD = null; if (doc.stamp && doc.free.some(f => f.t === 'stamp')) { stampD = await toDataUrl(doc.stamp); }
      for (const f of doc.free) {
        const c = f.x + f.w / 2, al = c < 38 ? AlignmentType.LEFT : c > 62 ? AlignmentType.RIGHT : AlignmentType.CENTER, pxw = Math.round(f.w / 100 * 210 * 3.78);
        if (f.t === 'text') kids.push(new Paragraph({alignment: al, spacing: {before: 160, after: 40}, keepNext: false, ...bidi(f.text), children: runs(f.html, {size: Z(20)})}));
        else if (f.t === 'pad' && padBytes) kids.push(new Paragraph({alignment: al, spacing: {before: 60, after: 60}, children: [new ImageRun({type: 'png', data: padBytes, transformation: {width: pxw, height: Math.round(pxw * 24 / 62)}})]}));
        else if (f.t === 'stamp' && stampD) { const im = await loadImg(stampD), t = dataMime(stampD); if (im) kids.push(new Paragraph({alignment: al, spacing: {before: 60, after: 60}, children: [new ImageRun({type: t === 'jpeg' ? 'jpg' : t, data: dataBytes(stampD), transformation: {width: pxw, height: Math.round(pxw * im.height / im.width)}})]})); }
      }
      // header / footer
      const h = b.header || {}, ft = b.footer || {}, st = doc.settings, hasHdr = (h.line1 || h.line2 || h.line3 || h.logoLeft || h.logoRight) && st.hdr !== 'none';
      const logo = async src => { if (!src) return []; const d = await toDataUrl(src), im = await loadImg(d); if (!im) return []; const hh = 56, ww = Math.min(110, Math.round(im.width * hh / im.height)); return [new ImageRun({type: dataMime(d) === 'jpg' || dataMime(d) === 'jpeg' ? 'jpg' : dataMime(d), data: dataBytes(d), transformation: {width: ww, height: Math.round(ww * im.height / im.width)}})]; };
      const mk = (txt, bold, size) => new Paragraph({alignment: AlignmentType.CENTER, children: [new TextRun({text: txt, bold, font: F, size})]});
      let header;
      if (hasHdr) {
        const mid = [h.line1 && mk(h.line1, true, 28), h.line2 && mk(h.line2, true, 24), h.line3 && mk(h.line3, false, 20)].filter(Boolean);
        header = new Header({children: [new Table({width: {size: 9800, type: WidthType.DXA}, columnWidths: [1800, 6200, 1800], borders: noB, rows: [new TableRow({children: [
          new TableCell({borders: noB, width: {size: 1800, type: WidthType.DXA}, children: [new Paragraph({children: await logo(h.logoLeft)})]}),
          new TableCell({borders: noB, width: {size: 6200, type: WidthType.DXA}, children: mid.length ? mid : [new Paragraph({})]}),
          new TableCell({borders: noB, width: {size: 1800, type: WidthType.DXA}, children: [new Paragraph({alignment: AlignmentType.RIGHT, children: await logo(h.logoRight)})]})]})]}),
          ...(st.hline !== 'off' ? [new Paragraph({border: {bottom: {style: BorderStyle.SINGLE, size: 12, color: '0F3D5E', space: 1}}, children: []})] : [])]});
      }
      const fch = [];
      if ((ft.line1 || ft.line2) && st.ftr !== 'none') { if (ft.line1) fch.push(mk(ft.line1, true, 20)); if (ft.line2) fch.push(mk(ft.line2, false, 20)); }
      if (st.pn !== 'off') {
        const pr = st.pn === 'n' ? [PageNumber.CURRENT] : st.pn === 'nofm' ? [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] : ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES];
        fch.push(new Paragraph({alignment: st.pnPos === 'l' ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({children: pr, font: F, size: 20, bold: true})]}));
      }
      const section = {properties: {titlePage: hasHdr && st.hdr === 'first', page: {size: {width: 11906, height: 16838}, margin: {top: 600, bottom: 600, left: 680, right: 680, header: 300, footer: 300}}}, children: kids};
      if (hasHdr) { if (st.hdr === 'first') section.headers = {first: header, default: new Header({children: [new Paragraph({})]})}; else section.headers = {default: header}; }
      if (fch.length) section.footers = {default: new Footer({children: fch}), first: new Footer({children: fch})};
      const wd = new Document({creator: 'Radiology Reports', title: doc.title, styles: {default: {document: {run: {font: F, size: 20}}}},
        numbering: {config: [{reference: 'bul', levels: [{level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: {paragraph: {indent: {left: 360, hanging: 260}}}}]}]}, sections: [section]});
      const blob = await Packer.toBlob(wd);
      await deliver([new File([blob], nameOf(doc) + '.docx', {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})], s);
    } catch (e) { console.error(e); toast('Could not create Word file: ' + (e.message || '')); }
  });
}
