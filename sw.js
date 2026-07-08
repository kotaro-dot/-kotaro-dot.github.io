// 散歩ルートメーカー用のシンプルなService Worker
// 役割: アプリの「見た目」をオフラインでも開けるようにキャッシュする
// (地図タイルやAPI通信そのものはオンラインが必要です)

const CACHE_NAME = 'walk-route-maker-v7';
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // アプリ本体ファイルはキャッシュ優先、それ以外(API通信等)は素通りさせる
  const isAppFile = PRECACHE_URLS.some((url) => event.request.url.includes(url.replace('./', '')));
  if (!isAppFile) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
