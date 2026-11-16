// App entry: home screen (sticky search + collapsed sections), router, settings, PWA
import { $, $$, esc, toast, openSheet, closeSheet, confirmBox, debounce } from './util.js';
import * as St from './store.js';
import * as Data from './data.js';
import * as Editor from './editor.js';

const home = $('#home');
let index = null, pendingBank = null, deferredInstall = null;
const state = {q: ''}, openSet = new Set();       // open sections are remembered only until the page is reloaded (all closed by default)
const st = () => St.settings.ui;

/* ---------- Router ---------- */
function showHome() { Editor.close(); home.hidden = false; document.body.classList.add('home-on'); renderList(); }
async function route() {
  const m = location.hash.match(/^#\/r\/(.+)$/);
  if (m) {
    const d = St.loadDraft(m[1]);
    if (!d) { history.replaceState(null, '', '#'); return showHome(); }
    try { await Editor.open(d, {bank: pendingBank}); } catch (e) { console.error(e); toast('Could not open the report'); history.replaceState(null, '', '#'); showHome(); }
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

/* ---------- Home ---------- */
function buildHome() {
  home.innerHTML = `<div class="hm-top" id="hmTop">
    <div class="hm-row rowT"><h1>🩻 Radiology Reports</h1><button class="gear" type="button" id="gear" aria-label="Settings">⚙</button></div>
    <div class="searchbox"><span>🔎</span><input id="q" type="search" placeholder="Search templates or phrases…" autocomplete="off" enterkeyhint="search"><button type="button" id="qx" hidden aria-label="Clear">✕</button></div>
    <div class="chips" id="hmChips"></div>
  </div><div class="hm-body"><div id="hmList"></div><p class="note" id="hmNote"></p></div>`;
  $('#q').addEventListener('input', debounce(e => { state.q = e.target.value.trim(); $('#qx').hidden = !state.q; window.scrollTo(0, 0); if (state.q) Data.loadAll().then(renderList).catch(() => {}); renderList(); }, 160));
  $('#q').addEventListener('focus', () => Data.loadAll().catch(() => {}));
  $('#qx').onclick = () => { $('#q').value = ''; state.q = ''; $('#qx').hidden = true; window.scrollTo(0, 0); renderList(); $('#q').focus(); };
  $('#gear').onclick = openSettings;
  home.addEventListener('click', onHomeClick);
  home.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.acc) { d.open ? openSet.add(d.dataset.acc) : openSet.delete(d.dataset.acc); } }, true);
  home.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.row,.draft')) { e.preventDefault(); e.target.click(); } });
  let compact = false;
  window.addEventListener('scroll', () => { if (home.hidden) return; const y = window.scrollY; if (!compact && y > 90) { compact = true; $('#hmTop').classList.add('compact'); } else if (compact && y < 20) { compact = false; $('#hmTop').classList.remove('compact'); } }, {passive: true});
}
function renderChips() {
  const u = st(), mods = index.modalities;
  if (!u.modality || !mods.some(m => m.id === u.modality && !m.planned)) u.modality = (mods.find(m => !m.planned) || mods[0]).id;
  $('#hmChips').innerHTML = mods.map(m => `<button type="button" class="chip${m.planned ? ' soon' : ''}" data-mod="${m.id}" aria-pressed="${m.id === u.modality}">${m.icon || ''} ${esc(m.name)}${m.planned ? ' <small>soon</small>' : ` <small>${m.count}</small>`}</button>`).join('');
  $('#hmChips').hidden = !!state.q;
}
const row = s => { const fav = St.settings.fav.includes(s.id);
  return `<div class="row" role="button" tabindex="0" data-open="${s.id}"><div class="t1">${esc(s.title)}<small>${s.variants.length} versions · ${s.bank_items} phrases</small></div><button class="star${fav ? ' on' : ''}" type="button" data-star="${s.id}" aria-label="Favorite">${fav ? '★' : '☆'}</button></div>`; };
const acc = (id, title, n, inner, cls = '') => `<details class="acc ${cls}" data-acc="${id}"${openSet.has(id) ? ' open' : ''}><summary>${title}<span class="n">${n}</span></summary><div class="rows">${inner}</div></details>`;
function draftsHtml() {
  const list = St.draftIndex().filter(d => index.studies.some(s => s.id === d.studyId)); if (!list.length) return '';
  const fmt = t => new Date(t).toLocaleString('en-GB', {dateStyle: 'short', timeStyle: 'short'});
  return acc('drafts', '📝 My drafts', list.length, list.map(d => { const s = index.studies.find(x => x.id === d.studyId);
    return `<div class="draft" role="button" tabindex="0" data-draft="${d.id}"><div class="tx"><b>${esc(s.title)}</b><span>${d.patient ? '👤 ' + esc(d.patient) + ' · ' : ''}${fmt(d.updated)}</span></div><button class="x" type="button" data-ddel="${d.id}" aria-label="Delete draft">✕</button></div>`; }).join(''));
}
function renderList() {
  renderChips();
  const box = $('#hmList'), u = st();
  if (state.q) {
    const studies = Data.searchStudies(state.q, index.studies);
    const {hits, total} = Data.searchPhrases(state.q), loading = !Data.loadedStudies().length;
    box.innerHTML = `<div class="sec-title">Templates <small>${studies.length}</small></div>` + (studies.length ? `<div class="acc"><div class="rows">${studies.map(row).join('')}</div></div>` : '<div class="empty">No matching templates.</div>')
      + `<div class="sec-title">Phrases <small>${loading ? 'loading…' : total + (total > hits.length ? ` (showing first ${hits.length})` : '')}</small></div>`
      + (hits.length ? hits.map((h, i) => `<div class="hit"><div class="where">${esc(h.study.title)} › ${esc(h.g.title)}${h.sub ? ' › ' + esc(h.sub.title) : ''}</div><div class="txt">${Data.highlight(h.text, state.q)}</div><div class="acts"><button class="mini go" type="button" data-hopen="${i}">Open study &amp; insert</button><button class="mini" type="button" data-hcopy="${i}">Copy</button></div></div>`).join('') : (loading ? '' : '<div class="empty">No matching phrases.</div>'));
    window.__hits = hits; return;
  }
  const mod = index.modalities.find(m => m.id === u.modality);
  const list = index.studies.filter(s => s.modality === u.modality);
  let html = draftsHtml();
  const favs = list.filter(s => St.settings.fav.includes(s.id));
  if (favs.length) html += acc('fav', '⭐ Favorites', favs.length, favs.map(row).join(''), 'fav');
  if (!list.length) html += `<div class="empty">${mod && mod.planned ? `<b>${esc(mod.name)}</b> is coming soon.<br>To add it, create a folder named <b>${esc(mod.name.toUpperCase())} REPORTS</b> with the report files in the repository.` : 'No templates yet.'}</div>`;
  else {
    const gs = index.groups[u.modality] || [], seen = new Set();
    gs.forEach(g => { const l = list.filter(s => s.group === g.id); l.forEach(s => seen.add(s.id)); if (l.length) html += acc(u.modality + ':' + g.id, esc(g.name), l.length, l.map(row).join('')); });
    const rest = list.filter(s => !seen.has(s.id)); if (rest.length) html += acc(u.modality + ':other', 'Other', rest.length, rest.map(row).join(''));
  }
  box.innerHTML = html;
}
function onHomeClick(e) {
  const t = e.target;
  const star = t.closest('[data-star]'); if (star) { e.stopPropagation(); const id = star.dataset.star, f = St.settings.fav, i = f.indexOf(id); if (i < 0) f.push(id); else f.splice(i, 1); St.saveSettings(); renderList(); return; }
  const mod = t.closest('[data-mod]'); if (mod) { const m = index.modalities.find(x => x.id === mod.dataset.mod); if (m.planned) toast(`${m.name} is coming soon`); st().modality = m.id; St.saveSettings(); window.scrollTo(0, 0); renderList(); return; }
  const del = t.closest('[data-ddel]'); if (del) { e.stopPropagation(); e.preventDefault(); confirmBox('Delete draft', 'This report will be deleted permanently.', 'Delete', () => { St.removeDraft(del.dataset.ddel); renderList(); }); return; }
  const dr = t.closest('[data-draft]'); if (dr) { go('#/r/' + dr.dataset.draft); return; }
  const op = t.closest('[data-open]'); if (op) { startReport(op.dataset.open); return; }
  const ho = t.closest('[data-hopen]'); if (ho) { const h = window.__hits[+ho.dataset.hopen]; startReport(h.study.id, null, state.q); return; }
  const hc = t.closest('[data-hcopy]'); if (hc) { const h = window.__hits[+hc.dataset.hcopy]; navigator.clipboard.writeText(h.text).then(() => toast('Copied'), () => toast('Could not copy')); }
}

/* ---------- Settings ---------- */
function openSettings() {
  const body = openSheet('Settings', `
    ${deferredInstall ? '<button class="btn dark" type="button" data-s="install">📲 Install the app on this device</button>' : '<div class="hint">To install as an app: browser menu → “Add to Home screen” (iPhone: Share button → “Add to Home Screen”).</div>'}
    <button class="btn" type="button" data-s="backup">⬇ Backup (drafts + settings + signature)</button>
    <label class="btn fileb">⬆ Restore a backup<input type="file" accept="application/json" data-s="restore" hidden></label>
    <button class="btn" type="button" data-s="refresh">🔄 Refresh templates &amp; data now</button>
    <button class="btn danger" type="button" data-s="clear">🗑 Delete all drafts</button>
    <div class="hint">All your data (drafts, signature, letterhead) is stored on this device only. Data version ${esc(index.version)} · ${index.studies.length} studies.</div>`);
  body.onclick = async e => {
    const a = e.target.closest('[data-s]'); if (!a) return; const k = a.dataset.s;
    if (k === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; closeSheet(); }
    else if (k === 'backup') { const blob = new Blob([JSON.stringify(St.exportAll())], {type: 'application/json'}); const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'radiology-reports-backup-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(l); l.click(); l.remove(); toast('Backup downloaded'); }
    else if (k === 'refresh') { try { const ks = await caches.keys(); await Promise.all(ks.map(x => caches.delete(x))); const rg = await navigator.serviceWorker.getRegistrations(); await Promise.all(rg.map(r => r.unregister())); } catch (er) {} location.reload(); }
    else if (k === 'clear') confirmBox('Delete all drafts', 'This cannot be undone.', 'Delete all', () => { St.draftIndex().forEach(d => St.removeDraft(d.id)); renderList(); closeSheet(); toast('Deleted'); });
  };
  body.onchange = async e => { if (e.target.dataset.s !== 'restore') return; const f = e.target.files[0]; if (!f) return; try { St.importAll(JSON.parse(await f.text())); closeSheet(); renderList(); toast('Restored'); } catch (er) { toast('Invalid file'); } };
}

/* ---------- Start ---------- */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
(async function init() {
  St.loadSettings();
  try { St.loadDefaultBrand(await (await fetch('data/branding.json')).json()); } catch (e) {}
  try { index = await Data.loadIndex(); } catch (e) {
    home.innerHTML = '<div class="empty" style="padding-top:80px">Could not load the data.<br>Connect to the internet the first time only, then try again.<br><br><button class="btn dark" onclick="location.reload()">Retry</button></div>'; return;
  }
  St.cleanupOrphans(); buildHome();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  await route();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  (window.requestIdleCallback || (f => setTimeout(f, 2500)))(() => Data.loadAll().catch(() => {}));
})();
