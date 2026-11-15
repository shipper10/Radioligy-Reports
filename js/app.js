// نقطة البداية: الشاشة الرئيسية + التوجيه + الإعدادات + PWA
import { $, $$, esc, toast, openSheet, closeSheet, confirmBox, debounce } from './util.js';
import * as St from './store.js';
import * as Data from './data.js';
import * as Editor from './editor.js';

const home = $('#home');
let index = null, pendingBank = null, deferredInstall = null;
const st = () => St.settings.ui;

/* ---------- التوجيه ---------- */
function showHome() { Editor.close(); home.hidden = false; document.body.classList.add('home-on'); renderDrafts(); renderList(); }
async function route() {
  const m = location.hash.match(/^#\/r\/(.+)$/);
  if (m) {
    const d = St.loadDraft(m[1]);
    if (!d) { history.replaceState(null, '', '#'); return showHome(); }
    try { await Editor.open(d, {bank: pendingBank}); } catch (e) { console.error(e); toast('تعذّر فتح التقرير'); history.replaceState(null, '', '#'); showHome(); }
    pendingBank = null;
  } else showHome();
}
function go(hash) { history.pushState({rr: 1}, '', hash); route(); }
window.addEventListener('popstate', route);

async function startReport(studyId, variantId, bank) {
  const study = await Data.loadStudy(studyId);
  const v = variantId || (study.variants.find(x => x.kind === 'template') || study.variants[0]).id;
  const d = Editor.makeDraft(study, v); St.saveDraft(d, false);
  pendingBank = bank || null; go('#/r/' + d.id);
}
window.addEventListener('rr:new', e => startReport(e.detail.studyId, e.detail.variantId));
window.addEventListener('rr:home', () => { history.replaceState(null, '', '#'); showHome(); });

/* ---------- بناء الصفحة الرئيسية ---------- */
function buildHome() {
  home.innerHTML = `<div class="hm-top"><h1>🩻 تقارير الأشعة</h1><p>قوالب جاهزة وبنوك تعابير لكتابة التقرير بسرعة — تعمل بدون إنترنت</p><button class="gear" type="button" id="gear" aria-label="الإعدادات">⚙</button></div>
  <div class="hm-body">
    <div class="searchbox"><span>🔎</span><input id="q" type="search" placeholder="ابحث عن نموذج أو تعبير…  (knee / ركبة / appendix)" autocomplete="off" enterkeyhint="search"><button type="button" id="qx" hidden aria-label="مسح">✕</button></div>
    <div id="hmDrafts"></div><div id="hmFilters"></div><div id="hmList"></div>
    <p class="note" id="hmNote"></p>
  </div>`;
  $('#q').addEventListener('input', debounce(e => { state.q = e.target.value.trim(); $('#qx').hidden = !state.q; if (state.q) Data.loadAll().then(renderList); renderFilters(); renderList(); }, 160));
  $('#q').addEventListener('focus', () => Data.loadAll().catch(() => {}));
  $('#qx').onclick = () => { $('#q').value = ''; state.q = ''; $('#qx').hidden = true; renderFilters(); renderList(); };
  $('#gear').onclick = openSettings;
  home.addEventListener('click', onHomeClick);
  home.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); e.target.click(); } });
}
const state = {q: ''};
function modalities() { return index.modalities; }
function renderFilters() {
  const box = $('#hmFilters'); if (state.q) { box.innerHTML = ''; return; }
  const u = st(), mods = modalities(); if (!u.modality || !mods.some(m => m.id === u.modality && !m.planned)) u.modality = (mods.find(m => !m.planned) || mods[0]).id;
  const groups = (index.groups[u.modality] || []).filter(g => index.studies.some(s => s.modality === u.modality && s.group === g.id));
  if (index.studies.some(s => s.modality === u.modality && !groups.some(g => g.id === s.group))) groups.push({id: 'other', name_ar: 'أخرى'});
  box.innerHTML = `<div class="sec-title">القسم</div><div class="chips">${mods.map(m => `<button type="button" class="chip${m.planned ? ' soon' : ''}" data-mod="${m.id}" aria-pressed="${m.id === u.modality}">${m.icon || ''} ${esc(m.name_ar || m.name)}${m.planned ? ' <small>قريباً</small>' : ` <small>${m.count}</small>`}</button>`).join('')}</div>
  <div class="sec-title">التصنيف</div><div class="chips"><button type="button" class="chip" data-grp="all" aria-pressed="${u.group === 'all' && !u.fav}">الكل</button><button type="button" class="chip" data-fav="1" aria-pressed="${!!u.fav}">⭐ المفضلة</button>${groups.map(g => `<button type="button" class="chip" data-grp="${g.id}" aria-pressed="${u.group === g.id && !u.fav}">${esc(g.name_ar)}</button>`).join('')}</div>`;
}
function card(s) {
  const fav = St.settings.fav.includes(s.id), g = (index.groups[s.modality] || []).find(x => x.id === s.group);
  return `<div class="card" role="button" tabindex="0" data-open="${s.id}"><div class="tx"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(s.title_ar)}</div><div class="meta">${s.variants.length} نماذج · ${s.bank_items} تعبير${g ? ' · ' + esc(g.name_ar) : ''}</div></div><button class="star${fav ? ' on' : ''}" type="button" data-star="${s.id}" aria-label="مفضلة">${fav ? '★' : '☆'}</button></div>`;
}
function renderList() {
  const box = $('#hmList'), u = st();
  if (state.q) {
    const studies = Data.searchStudies(state.q, index.studies);
    const {hits, total} = Data.searchPhrases(state.q);
    const loading = !Data.loadedStudies().length;
    box.innerHTML = `<div class="sec-title">النماذج <small>${studies.length}</small></div>` + (studies.length ? `<div class="cards">${studies.map(card).join('')}</div>` : '<div class="empty">لا توجد نماذج مطابقة.</div>')
      + `<div class="sec-title">التعابير <small>${loading ? 'جارٍ التحميل…' : total + (total > hits.length ? ' (يظهر أول ' + hits.length + ')' : '')}</small></div>`
      + (hits.length ? hits.map((h, i) => `<div class="hit" data-hi="${i}"><div class="where">${esc(h.study.title)} › ${esc(h.g.title)}${h.sub ? ' › ' + esc(h.sub.title) : ''}</div><div class="txt">${Data.highlight(h.text, state.q)}</div><div class="acts"><button class="mini go" type="button" data-hopen="${i}">فتح الدراسة وإدراجه</button><button class="mini" type="button" data-hcopy="${i}">نسخ</button></div></div>`).join('') : (loading ? '' : '<div class="empty">لا توجد تعابير مطابقة.</div>'));
    window.__hits = hits; return;
  }
  let list = index.studies.filter(s => s.modality === u.modality);
  if (u.fav) list = list.filter(s => St.settings.fav.includes(s.id)); else if (u.group !== 'all') list = list.filter(s => s.group === u.group);
  const mod = index.modalities.find(m => m.id === u.modality);
  if (!list.length) { box.innerHTML = `<div class="empty">${mod && mod.planned ? `قسم <b>${esc(mod.name_ar)}</b> قريباً.<br>لإضافته: ضع مجلداً باسم <b>${esc(mod.name)} REPORTS</b> يحوي ملفات التقارير في المستودع.` : u.fav ? 'لم تضف أي نموذج للمفضلة بعد. اضغط ☆ بجانب أي نموذج.' : 'لا توجد نماذج.'}</div>`; return; }
  if (u.group === 'all' && !u.fav) {
    const gs = index.groups[u.modality] || [], seen = new Set();
    box.innerHTML = gs.map(g => { const l = list.filter(s => s.group === g.id); l.forEach(s => seen.add(s.id)); return l.length ? `<div class="group-h">${esc(g.name_ar)} <small>${esc(g.name)}</small></div><div class="cards">${l.map(card).join('')}</div>` : ''; }).join('')
      + (list.some(s => !seen.has(s.id)) ? `<div class="group-h">أخرى</div><div class="cards">${list.filter(s => !seen.has(s.id)).map(card).join('')}</div>` : '');
  } else box.innerHTML = `<div class="cards" style="margin-top:12px">${list.map(card).join('')}</div>`;
}
function renderDrafts() {
  const box = $('#hmDrafts'), list = St.draftIndex().filter(d => index.studies.some(s => s.id === d.studyId));
  if (state.q || !list.length) { box.innerHTML = ''; return; }
  const fmt = t => new Date(t).toLocaleString('ar', {numberingSystem: 'latn', dateStyle: 'short', timeStyle: 'short'});
  box.innerHTML = `<div class="sec-title">مسوداتي <small>تُحفظ تلقائياً على هذا الجهاز</small></div><div class="drafts">${list.slice(0, 12).map(d => { const s = index.studies.find(x => x.id === d.studyId);
    return `<div class="draft" role="button" tabindex="0" data-draft="${d.id}"><button class="x" type="button" data-ddel="${d.id}" aria-label="حذف">✕</button><b>${esc(s.title)}</b><span>${d.patient ? '👤 ' + esc(d.patient) : 'بدون اسم مريض'}</span><span>${fmt(d.updated)}</span></div>`; }).join('')}</div>`;
}
function onHomeClick(e) {
  const t = e.target;
  const star = t.closest('[data-star]'); if (star) { e.stopPropagation(); const id = star.dataset.star, f = St.settings.fav, i = f.indexOf(id); if (i < 0) f.push(id); else f.splice(i, 1); St.saveSettings(); renderList(); return; }
  const mod = t.closest('[data-mod]'); if (mod) { const m = index.modalities.find(x => x.id === mod.dataset.mod); if (m.planned) { toast(`قسم ${m.name_ar} قريباً`); } st().modality = m.id; st().group = 'all'; st().fav = false; St.saveSettings(); renderFilters(); renderList(); return; }
  const grp = t.closest('[data-grp]'); if (grp) { st().group = grp.dataset.grp; st().fav = false; St.saveSettings(); renderFilters(); renderList(); return; }
  if (t.closest('[data-fav]')) { st().fav = !st().fav; St.saveSettings(); renderFilters(); renderList(); return; }
  const del = t.closest('[data-ddel]'); if (del) { e.stopPropagation(); confirmBox('حذف المسودة', 'سيتم حذف هذا التقرير نهائياً.', 'حذف', () => { St.removeDraft(del.dataset.ddel); renderDrafts(); }); return; }
  const dr = t.closest('[data-draft]'); if (dr) { go('#/r/' + dr.dataset.draft); return; }
  const op = t.closest('[data-open]'); if (op) { startReport(op.dataset.open); return; }
  const ho = t.closest('[data-hopen]'); if (ho) { const h = window.__hits[+ho.dataset.hopen]; startReport(h.study.id, null, state.q); return; }
  const hc = t.closest('[data-hcopy]'); if (hc) { const h = window.__hits[+hc.dataset.hcopy]; navigator.clipboard.writeText(h.text).then(() => toast('تم النسخ'), () => toast('تعذّر النسخ')); }
}

/* ---------- الإعدادات ---------- */
function openSettings() {
  const body = openSheet('الإعدادات', `
    ${deferredInstall ? '<button class="btn dark" type="button" data-s="install">📲 تثبيت التطبيق على الجهاز</button>' : '<div class="hint">لتثبيته كتطبيق: من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية» (آيفون: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»).</div>'}
    <button class="btn" type="button" data-s="backup">⬇ نسخة احتياطية (مسودات + إعدادات + توقيع)</button>
    <label class="btn fileb">⬆ استرجاع نسخة احتياطية<input type="file" accept="application/json" data-s="restore" hidden></label>
    <button class="btn" type="button" data-s="refresh">🔄 تحديث النماذج والبيانات الآن</button>
    <button class="btn danger" type="button" data-s="clear">🗑 حذف كل المسودات</button>
    <div class="hint">كل بياناتك (المسودات، التوقيع، الهوية) محفوظة على جهازك فقط. نسخة النماذج: ${esc(index.version)} · ${index.studies.length} دراسة.</div>`);
  body.onclick = async e => {
    const a = e.target.closest('[data-s]'); if (!a) return; const k = a.dataset.s;
    if (k === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; closeSheet(); }
    else if (k === 'backup') { const blob = new Blob([JSON.stringify(St.exportAll())], {type: 'application/json'}); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'radiology-reports-backup-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(l); l.click(); l.remove(); toast('تم تنزيل النسخة'); }
    else if (k === 'refresh') { try { const ks = await caches.keys(); await Promise.all(ks.map(x => caches.delete(x))); const rg = await navigator.serviceWorker.getRegistrations(); await Promise.all(rg.map(r => r.unregister())); } catch (er) {} location.reload(); }
    else if (k === 'clear') confirmBox('حذف كل المسودات', 'لن يمكن التراجع عن ذلك.', 'حذف الكل', () => { St.draftIndex().forEach(d => St.removeDraft(d.id)); renderDrafts(); closeSheet(); toast('تم الحذف'); });
  };
  body.onchange = async e => { if (e.target.dataset.s !== 'restore') return; const f = e.target.files[0]; if (!f) return; try { St.importAll(JSON.parse(await f.text())); closeSheet(); renderFilters(); renderDrafts(); renderList(); toast('تم الاسترجاع'); } catch (er) { toast('ملف غير صالح'); } };
}

/* ---------- التشغيل ---------- */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
(async function init() {
  St.loadSettings();
  try { St.loadDefaultBrand(await (await fetch('data/branding.json')).json()); } catch (e) {}
  try { index = await Data.loadIndex(); } catch (e) {
    home.innerHTML = '<div class="empty" style="padding-top:80px">تعذّر تحميل البيانات.<br>تأكد من الاتصال بالإنترنت لأول مرة فقط، ثم أعد المحاولة.<br><br><button class="btn dark" onclick="location.reload()">إعادة المحاولة</button></div>'; return;
  }
  St.cleanupOrphans(); buildHome(); renderFilters();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  await route();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  (window.requestIdleCallback || (f => setTimeout(f, 2500)))(() => Data.loadAll().catch(() => {}));     // يحفظ كل الدراسات للعمل دون اتصال
})();
