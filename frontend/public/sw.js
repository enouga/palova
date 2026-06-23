self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Palova';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '', data: { url: data.url || '/' }, icon: '/icon-192.png', badge: '/icon-192.png',
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if ('focus' in w) { w.focus(); if ('navigate' in w) w.navigate(url); return; } }
    return clients.openWindow(url);
  }));
});
