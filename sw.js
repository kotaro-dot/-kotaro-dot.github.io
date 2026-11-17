// 散歩ルートMAKER Service Worker
// - アプリ本体(index.html): 電波があれば毎回最新を取得、なければ保存版を表示
// - ライブラリ・フォント・アイコン: 保存版を優先
// - 地図タイル: 一度表示したものを保存（上限あり、古いものから削除）
// - ルート計算・天気などのAPI: 保存しない(そのまま通信)
const APP_CACHE = 'walk-app-v1';
const TILE_CACHE = 'walk-tiles-v1';
const TILE_LIMIT = 2000;
const NETWORK_TIMEOUT_MS = 5000;

const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-120.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];
const LIB_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // 1つ失敗しても他は保存する
    await Promise.all(APP_FILES.map(u =>
      fetch(u, {cache: 'no-store'}).then(r => { if (r.ok) return cache.put(u, r); }).catch(() => {})
    ));
    await Promise.all(LIB_FILES.map(u =>
      fetch(u, {mode: 'cors', credentials: 'omit'}).then(r => { if (r.ok) return cache.put(u, r); }).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, TILE_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isTile(url){
  return url.hostname === 'server.arcgisonline.com' && url.pathname.includes('/tile/');
}
function isStaticLib(url){
  return url.hostname === 'cdnjs.cloudflare.com' ||
         url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com';
}

// アプリ本体: ネット優先(タイムアウトあり) → 失敗時は保存版
async function networkFirstPage(request){
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await Promise.race([
      fetch(request, {cache: 'no-store'}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NETWORK_TIMEOUT_MS))
    ]);
    if (res && res.ok){
      cache.put('./index.html', res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    const cached = await cache.match('./index.html') || await cache.match('./');
    if (cached) return cached;
    throw e;
  }
}

// 同じサイト内のファイル(アイコン等): ネット優先 → 保存版
async function networkFirstAsset(request){
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cached = await cache.match(request, {ignoreSearch: true});
    if (cached) return cached;
    throw e;
  }
}

// ライブラリ・フォント: 保存版優先
async function cacheFirst(request){
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')){
    cache.put(request.url, res.clone()).catch(() => {});
  }
  return res;
}

// 地図タイル: 保存版優先 → なければ取得して保存
let tileWrites = 0;
async function tileHandler(request){
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  let res;
  try {
    // CORSで取得できれば保存(容量を正しく計算できる)
    res = await fetch(request.url, {mode: 'cors', credentials: 'omit'});
  } catch (e) {
    // CORS不可なら通常取得(保存はしない)
    return fetch(request);
  }
  if (res && res.ok){
    await cache.put(request.url, res.clone()).catch(() => {});
    tileWrites++;
    if (tileWrites % 50 === 0) trimTiles();
  }
  return res;
}

async function trimTiles(){
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys(); // 追加順(古い順)
    const over = keys.length - TILE_LIMIT;
    for (let i = 0; i < over; i++) await cache.delete(keys[i]);
  } catch (e) {}
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin){
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (isTile(url)){
    event.respondWith(tileHandler(request));
    return;
  }
  if (isStaticLib(url)){
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin){
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(networkFirstAsset(request));
    return;
  }
  // それ以外(ルート計算・天気・地名検索など)は何もしない = 通常どおり通信
});
