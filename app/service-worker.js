/* Версию бампаем при КАЖДОЙ выкладке — иначе у установленных приложений
   останется старый кеш, и правки увидят не сразу. */
const CACHE_NAME = 'ffdrop-v5';   // не «ff-v»: так звался кеш старого SW в корне, его стирает самоудаляющийся SW

/* Всё, что нужно приложению для полностью автономной работы: оболочка,
   иконки, сканер штрихкодов, генератор QR и шрифты. Раньше сканер, QR и
   шрифты грузились с CDN и в кеш не попадали (кросс-доменные ответы
   приходят opaque, со status 0) — без сети приложение оставалось без
   камеры и без печати этикеток.

   Страница лежит под './' и НЕ под './index.html': Cloudflare отвечает на
   /index.html перенаправлением на /, а ответ с перенаправлением нельзя ни
   положить в кеш, ни отдать в ответ на переход. */
const ASSETS = [
  './',
  './manifest.json',
  './icon-192.png',
  './logo-mark.svg',
  './icon-512.png',
  './apple-touch-icon.png',
  './splash.jpg',
  './vendor/zxing.min.js',
  './vendor/qrcode.min.js',
  './vendor/supabase.min.js',
  './vendor/xlsx.full.min.js',
  /* Свои скрипты и стили — с номером версии в адресе (его поднимает
     выкладка вместе с CACHE_NAME): новая страница никогда не получит из
     кеша старый кусок кода, а старая — новый. */
  './css/app.css?v=5',
  './sync-config.js?v=5',
  './js/db.js?v=5',
  './js/cells.js?v=5',
  './js/ff-data.js?v=5',
  './js/sync-ui.js?v=5',
  './js/input.js?v=5',
  './js/returns-scan.js?v=5',
  './js/sounds.js?v=5',
  './js/stock-history.js?v=5',
  './js/finance.js?v=5',
  './js/balance.js?v=5',
  './js/analytics.js?v=5',
  './js/settings-roles.js?v=5',
  './js/roles.js?v=5',
  './js/suppliers.js?v=5',
  './js/stock-ff.js?v=5',
  './js/cells-ui.js?v=5',
  './js/moves.js?v=5',
  './js/receipts.js?v=5',
  './js/shipments.js?v=5',
  './js/photos.js?v=5',
  './js/supplier-home.js?v=5',
  './js/incoming.js?v=5',
  './js/excel-import.js?v=5',
  './js/sell.js?v=5',
  './js/supplier-analysis.js?v=5',
  './js/review.js?v=5',
  './js/history-ff.js?v=5',
  './js/scan-ff.js?v=5',
  './js/demo.js?v=5',
  './js/subscription.js?v=5',
  './js/tariffs.js?v=5',
  './js/admin.js?v=5',
  './js/backup-labels.js?v=5',
  './sync.js?v=5',
  './js/layout.js?v=5',
  './fonts/fonts.css',
  './fonts/Saira-700i-wide-latin.woff2',
  './fonts/Inter-400-cyrillic.woff2',
  './fonts/Inter-400-latin.woff2',
  './fonts/Inter-500-cyrillic.woff2',
  './fonts/Inter-500-latin.woff2',
  './fonts/Inter-600-cyrillic.woff2',
  './fonts/Inter-600-latin.woff2',
  './fonts/Inter-700-cyrillic.woff2',
  './fonts/Inter-700-latin.woff2',
  './fonts/JetBrainsMono-500-cyrillic.woff2',
  './fonts/JetBrainsMono-500-latin.woff2',
  './fonts/JetBrainsMono-600-cyrillic.woff2',
  './fonts/JetBrainsMono-600-latin.woff2',
  './fonts/JetBrainsMono-700-cyrillic.woff2',
  './fonts/JetBrainsMono-700-latin.woff2',
  './fonts/SpaceGrotesk-500-latin.woff2',
  './fonts/SpaceGrotesk-600-latin.woff2',
  './fonts/SpaceGrotesk-700-latin.woff2'
];

/* Ответ, доехавший через перенаправление, помечен redirected. Такой ответ
   cache.put отвергает, а Safari на переходе показывает белый экран с
   «Response served by service worker has redirections». Пересобираем его
   начисто — тело и заголовки те же, метки перенаправления нет. */
async function cleanResponse(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* Кладём по одному, а не addAll: раньше один сбойный ответ валил всю
       установку целиком, новая версия не вставала, и на устройстве
       продолжала работать старая. Качаем при этом разом, а кладём по
       очереди — одновременные записи в один кеш браузер отвергает. */
    const loaded = await Promise.all(ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload', redirect: 'follow' });
        if (res && res.ok) return { url, res: await cleanResponse(res) };
      } catch (err) { /* нет файла или нет сети — переживём */ }
      return null;
    }));
    for (const item of loaded) {
      if (!item) continue;
      try { await cache.put(item.url, item.res); } catch (err) { /* один файл не повод падать */ }
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  /* Саму страницу берём из сети и только при её отсутствии — из кеша.
     Иначе после выкладки правок пользователь видел бы старую версию
     до второго запуска. Запрос делаем по адресу, а не по самому объекту
     запроса: у переходов режим перенаправления «manual», и ответ на них
     приходит непрозрачным. */
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith((async () => {
      try {
        /* no-store: GitHub Pages отдаёт index.html с Cache-Control: max-age=600 —
           без этого браузер мог десять минут отдавать страницу из своего
           обычного HTTP-кеша, даже не сходив в сеть, и правки не появлялись
           «после закрытия и открытия», пока это окно не истекало. */
        const res = await cleanResponse(
          await fetch(e.request.url, { redirect: 'follow', credentials: 'same-origin', cache: 'no-store' })
        );
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./', copy)).catch(() => {});
        }
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./'))
            || (await cache.match(e.request))
            || Response.error();
      }
    })());
    return;
  }

  /* Остальная статика (шрифты, скрипты, иконки) меняется редко и весит
     много: отдаём из кеша сразу, а свежую версию подтягиваем фоном. */
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then(async (res) => {
          if (res && res.status === 200) {
            const fresh = await cleanResponse(res);
            const copy = fresh.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy)).catch(() => {});
            return fresh;
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
