// تحميل البيانات (فهرس + دراسات) والبحث
import { norm, esc } from './util.js';
let index = null; const cache = new Map();
export async function loadIndex() {
  if (index) return index;
  const r = await fetch('data/index.json'); if (!r.ok) throw new Error('index');
  index = await r.json(); return index;
}
export const getIndex = () => index;
export async function loadStudy(id) {
  if (cache.has(id)) return cache.get(id);
  const s = (await loadIndex()).studies.find(x => x.id === id); if (!s) throw new Error('missing study');
  const r = await fetch('data/' + s.file); if (!r.ok) throw new Error('study');
  const d = await r.json(); cache.set(id, d); return d;
}
let allP = null;
export function loadAll() {            // يحمّل كل الدراسات مرة واحدة (للبحث في التعابير ولتخزينها دون اتصال)
  if (!allP) allP = (async () => { const ix = await loadIndex(); await Promise.all(ix.studies.map(s => loadStudy(s.id).catch(() => null))); return true; })();
  return allP;
}
export const loadedStudies = () => [...cache.values()];

const tokens = q => norm(q).split(' ').filter(Boolean);
export function searchStudies(q, list) {
  const t = tokens(q); if (!t.length) return list;
  return list.filter(s => {
    const h = norm([s.title, s.title_ar, ...(s.keywords || []), ...s.variants.map(v => v.label)].join(' '));
    return t.every(x => h.includes(x));
  });
}
export function searchPhrases(q, limit = 60) {
  const t = tokens(q); if (!t.length) return {hits: [], total: 0};
  const hits = []; let total = 0;
  for (const st of loadedStudies()) {
    st.bank.forEach((g, gi) => {
      const each = (items, sub) => items.forEach(text => {
        const h = norm(text + ' ' + g.title + ' ' + (sub ? sub.title : ''));
        if (t.every(x => h.includes(x))) { total++; if (hits.length < limit) hits.push({study: st, g, gi, sub, text}); }
      });
      each(g.items, null); g.subs.forEach(s => each(s.items, s));
    });
  }
  return {hits, total};
}
export function highlight(text, q) {
  let h = esc(text);
  tokens(q).filter(x => /^[a-z0-9.%/-]{2,}$/.test(x)).forEach(x => {
    h = h.replace(new RegExp('(' + x.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
  });
  return h;
}
