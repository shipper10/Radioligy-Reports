// التخزين المحلي: الإعدادات + المسودات (كل شيء على جهاز المستخدم)
import { uid } from './util.js';
const P = 'rr:';
export const lsGet = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } };
export const lsDel = k => { try { localStorage.removeItem(P + k); } catch (e) {} };

export const defaultSettings = () => ({
  hdr: 'all', ftr: 'all', pn: 'off', pnPos: 'r', fline: 'auto', hline: 'on', zoom: 1,
  phOn: false, titleLines: true, metaCols: '2', place: 'end', pop: 100, sigDefault: true, sigText: null,
  hideEmpty: true, wmOn: true, wmOp: 8, share: false, xmode: 'one', xq: '2',
  brand: {},                       // تعديلات المستخدم على الهوية (تتغلّب على data/branding.json)
  sig: {strokes: [], pen: '#0b1a4a', pw: 2.2},
  fav: [], ui: {modality: null, open: []},
});
export const defaultBrand = {header: {}, footer: {}, watermark: {}, stamp: {}, signature: {}};
export let settings = defaultSettings();
export function loadSettings() {
  const d = defaultSettings(), s = lsGet('settings', {});
  settings = {...d, ...s, sig: {...d.sig, ...(s.sig || {})}, ui: {...d.ui, ...(s.ui || {})}, brand: s.brand || {}, fav: s.fav || []};
  return settings;
}
export const saveSettings = () => lsSet('settings', settings);

// دمج عميق بسيط: قيم المستخدم تغلب الافتراضي (حتى لو فارغة)
const merge = (a, b) => { const o = {...a}; for (const k of Object.keys(b || {})) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? merge(a?.[k] || {}, b[k]) : b[k]; return o; };
export const brand = () => merge(defaultBrand, settings.brand);
export function setBrand(path, val) {          // path مثل 'header.line1'
  const parts = path.split('.'); let o = settings.brand;
  parts.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; });
  o[parts.at(-1)] = val; saveSettings();
}
export function loadDefaultBrand(json) { Object.assign(defaultBrand, merge(defaultBrand, json || {})); }

// ---------- المسودات ----------
export const draftIndex = () => lsGet('drafts', []);
const saveIndex = list => lsSet('drafts', list);
export function newDraftId() { return uid(); }
export const loadDraft = id => lsGet('d:' + id, null);
export function saveDraft(d, edited) {
  d.updated = Date.now();
  const ok = lsSet('d:' + d.id, d);
  const list = draftIndex().filter(x => x.id !== d.id);
  if (edited || d.edited) {
    d.edited = true;
    list.unshift({id: d.id, studyId: d.studyId, variantId: d.variantId, title: d.title || '', patient: d.patient || '', updated: d.updated});
    saveIndex(list.slice(0, 60));
  }
  return ok;
}
export function removeDraft(id) { lsDel('d:' + id); saveIndex(draftIndex().filter(x => x.id !== id)); }
export function cleanupOrphans() {          // مسودات فُتحت ولم تُعدَّل
  const keep = new Set(draftIndex().map(x => x.id));
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(P + 'd:')) { const id = k.slice(P.length + 2); if (!keep.has(id)) localStorage.removeItem(k); }
    }
  } catch (e) {}
}
export function exportAll() {
  const drafts = draftIndex().map(x => loadDraft(x.id)).filter(Boolean);
  return {app: 'radiology-reports', v: 1, date: new Date().toISOString(), settings, drafts};
}
export function importAll(o) {
  if (!o || o.app !== 'radiology-reports') throw new Error('bad');
  lsSet('settings', o.settings || {}); loadSettings();
  (o.drafts || []).forEach(d => { if (d && d.id) { d.edited = true; saveDraft(d, true); } });
}
