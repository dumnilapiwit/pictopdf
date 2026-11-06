// Offline cache for the static app. Bump VERSION whenever any file changes.
const VERSION='pictopdf-v12';
const FILES=['./','index.html','style.css','detector.js','app.js','nav.js','tools.html','tools.js','manifest.webmanifest','icon-192.png','icon-512.png','icon-180.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
// network first (so updates show up), fall back to cache when offline
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{const copy=res.clone();caches.open(VERSION).then(c=>c.put(e.request,copy));return res})));return}
  e.respondWith(fetch(e.request).then(res=>{if(res.ok){const copy=res.clone();caches.open(VERSION).then(c=>c.put(e.request,copy))}return res}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
