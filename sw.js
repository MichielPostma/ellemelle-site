// Ellemel admin service worker — Web Push
const SW_VERSION = '1';
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Ellemel', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Ellemel';
  const options = {
    body: data.body || '',
    icon: data.icon || '/assets/icons/icon-192.png',
    badge: data.badge || '/assets/icons/icon-192.png',
    tag: data.tag || 'order',
    renotify: true,
    data: { url: data.url || '/bestellingen' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/bestellingen';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus existing tab if same origin
    for (const c of allClients) {
      if (c.url.includes(self.location.origin)) {
        await c.focus();
        if ('navigate' in c) try { await c.navigate(url); } catch (e) {}
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
