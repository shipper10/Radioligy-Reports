// أدوات عامة صغيرة
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r1 = x => Math.round(x * 10) / 10;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// تطبيع النص للبحث (عربي + إنجليزي)
export const norm = s => String(s ?? '').toLowerCase()
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}.%/ -]+/gu, ' ').replace(/\s+/g, ' ').trim();

// ---------- رسالة سريعة ----------
let toastT;
export function toast(msg, undo, ms) {
  const t = $('#toast'); t.innerHTML = '';
  const sp = document.createElement('span'); sp.textContent = msg; t.appendChild(sp);
  if (undo) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Undo';
    b.onclick = () => { t.hidden = true; undo(); }; t.appendChild(b);
  }
  t.hidden = false; clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms || (undo ? 7000 : 2400));
}

// ---------- نافذة سفلية ----------
let sheetClose = null;
export function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; const f = sheetClose; sheetClose = null; if (f) f(); }
export function openSheet(title, bodyHtml, onClose) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sh-card" role="dialog"><div class="sh-h"><b>${esc(title)}</b><button type="button" data-x aria-label="Close">✕</button></div><div class="sh-b">${bodyHtml}</div></div>`;
  s.hidden = false; sheetClose = onClose || null;
  s.onclick = e => { if (e.target === s || e.target.closest('[data-x]')) closeSheet(); };
  return $('.sh-b', s);
}
// قائمة خيارات: options = [{label, sub, value, ltr, current}]
export function choose(title, options, onPick) {
  const body = openSheet(title, options.map((o, i) =>
    `<button type="button" class="opt${o.ltr ? ' ltr' : ''}" data-i="${i}"${o.current ? ' aria-current="true"' : ''}>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join(''));
  body.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const o = options[+b.dataset.i]; closeSheet(); onPick(o.value, o); };
}
export function confirmBox(title, msg, okText, onOk, cancelText = 'Cancel') {
  const body = openSheet(title, `<div class="hint" style="font-size:14px">${msg}</div><div class="g2"><button class="btn danger" data-ok type="button">${esc(okText)}</button><button class="btn" data-no type="button">${esc(cancelText)}</button></div>`);
  body.onclick = e => { if (e.target.closest('[data-ok]')) { closeSheet(); onOk(); } else if (e.target.closest('[data-no]')) closeSheet(); };
}
// قراءة صورة (مع تصغيرها إن كانت كبيرة)
export function readImg(file, max = 1100) {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onerror = rej;
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        if (k === 1 && file.size < 400e3) return res(fr.result);
        const cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        res(/jpe?g/.test(file.type) ? cv.toDataURL('image/jpeg', .9) : cv.toDataURL('image/png'));
      };
      im.onerror = () => res(fr.result); im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
// تحويل أي مصدر صورة إلى data: (للتصدير)
export async function toDataUrl(src) {
  if (!src || src.startsWith('data:')) return src || '';
  try {
    const r = await fetch(src); const b = await r.blob();
    return await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
  } catch (e) { return ''; }
}
