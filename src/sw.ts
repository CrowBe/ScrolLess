/// <reference lib="webworker" />
// Service worker — built to dist/client/sw.js (no hashing) via build-sw.mjs

declare const self: ServiceWorkerGlobalScope;

const CACHE = 'scrolless-v1';
const APP_SHELL = ['/', '/manifest.json', '/icons/icon-192.png'];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: serve shell from cache for navigations, network-first for API
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Pass API and agent requests through to network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/agent/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Navigation: serve cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => cached ?? fetch(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request))
  );
});

// Push: show notification
self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() as {
    title: string;
    body: string;
    source: string;
    count: number;
    url: string;
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `feed-${data.source}`,
      data: { url: data.url ?? '/' },
    })
  );
});

// Notification click: focus or open PWA
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target: string = event.notification.data?.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return (client as WindowClient).focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
