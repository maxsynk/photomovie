const V='pm-v3.2.0',SHELL=['./','index.html','camera.html','config_evento.html','galeria.html','galeria_admin.html','download.html','app.css','pwa.js','manifest.json','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.hostname.endsWith('workers.dev'))return;           // API, vídeos e telão sempre ao vivo
  const own=u.origin===location.origin,cdn=u.hostname==='cdnjs.cloudflare.com';
  if(!own&&!cdn)return;
  if(own&&(r.mode==='navigate'||u.pathname.endsWith('.html'))){            // telas: rede primeiro, cache se offline
    e.respondWith(fetch(r).then(x=>{const c=x.clone();caches.open(V).then(h=>h.put(r,c));return x}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))));return;}
  e.respondWith(caches.match(r).then(m=>{const n=fetch(r).then(x=>{if(x.ok){const c=x.clone();caches.open(V).then(h=>h.put(r,c))}return x}).catch(()=>m);return m||n}));
});
