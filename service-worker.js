/* Fulbro: приложение переехало в /app/. Этот service worker снимает старый с корня сайта. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (/^ff-v\d+$/.test(k)) await caches.delete(k);   // только старые; кеш приложения в app/ — ffdrop-v
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
