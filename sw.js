/* CuffedUpBoard service worker — offline shell only.
   Caches the four static files so the app opens with no signal. It never
   touches /api/sync: relay traffic is always live network, never cached,
   so a stale reply can never resurrect a deleted message. No board data,
   key material, or ciphertext passes through here — that all lives in the
   page's localStorage. */
const CACHE = 'cuffedup-v6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return;   // relay = network only
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(res=>{
        if (res.ok && url.origin === location.origin){
          const copy = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, copy));
        }
        return res;
      }).catch(()=>caches.match('./index.html'))
    )
  );
});
