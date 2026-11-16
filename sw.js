// Service Worker: يعمل دون اتصال. الشبكة أولاً (لتصلك التحديثات فوراً) ثم النسخة المخزنة.
const V = 'rr-v2';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/editor.js', 'js/bank.js', 'js/export.js', 'js/data.js', 'js/store.js', 'js/util.js',
  'data/index.json', 'data/branding.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(async c => { await c.addAll(SHELL); try { await c.add('vendor/docx.iife.js'); } catch (_) {} }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(ca => ca.put(r, c)); } return res; })
    .catch(() => caches.match(r, {ignoreSearch: true}).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
