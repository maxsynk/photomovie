/* PHOTO MOVIE - Service Worker (app instalável + funcionamento básico offline)
   Para forçar todo mundo a baixar uma versão nova, troque o número em VERSAO. */

// ▼▼▼ [INÍCIO] CONFIGURAÇÃO ▼▼▼
const VERSAO = 'pm-v11.1.0';
const ARQUIVOS = [
  './', 'index.html', 'config_evento.html', 'galeria_admin.html', 'camera.html', 'galeria.html', 'download.html',
  'app.css', 'pwa.js', 'manifest.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];
const EXTERNOS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
// ▲▲▲ [FIM] CONFIGURAÇÃO ▲▲▲

// ▼▼▼ [INÍCIO] INSTALAÇÃO E LIMPEZA ▼▼▼
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSAO).then(c => Promise.all(ARQUIVOS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => (k.startsWith('pm-') || k.startsWith('photomovie')) && k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// ▲▲▲ [FIM] INSTALAÇÃO E LIMPEZA ▲▲▲

// ▼▼▼ [INÍCIO] BUSCA DE ARQUIVOS ▼▼▼
const doCache = (req, opts) => caches.open(VERSAO).then(c => c.match(req, opts));
const guardar = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
  return res;
};

// Páginas, CSS e JS: tenta a internet primeiro (sempre a versão nova); sem internet, usa o guardado
function redePrimeiro(req) {
  const rede = fetch(req).then(res => guardar(req, res));
  const limite = new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 4000));
  return Promise.race([rede, limite]).catch(() =>
    doCache(req, { ignoreSearch: true }).then(r => r || rede.catch(() => null)).then(r => r || doCache('index.html'))
  );
}
// Ícones e capas: o que já está guardado primeiro
function cachePrimeiro(req) {
  return doCache(req).then(r => r || fetch(req).then(res => guardar(req, res)));
}
// Fontes e bibliotecas externas: mostra o guardado e atualiza por trás
function guardadoEAtualiza(req) {
  return doCache(req).then(r => {
    const rede = fetch(req).then(res => guardar(req, res)).catch(() => r);
    return r || rede;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;       // vídeo/áudio: direto da rede
  const url = new URL(req.url);
  if (url.hostname.endsWith('workers.dev')) return;                   // API e vídeos: nunca guardar
  if (url.origin !== self.location.origin) {
    if (EXTERNOS.includes(url.hostname)) e.respondWith(guardadoEAtualiza(req));
    return;
  }
  if (/\/(icons|splash)\//.test(url.pathname)) { e.respondWith(cachePrimeiro(req)); return; }
  e.respondWith(redePrimeiro(req));
});
// ▲▲▲ [FIM] BUSCA DE ARQUIVOS ▲▲▲
