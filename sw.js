const CACHE_NAME = 'kl-checker-v4';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/css/theme.css',
  '/js/constants.js',
  '/js/state.js',
  '/js/utils.js',
  '/js/ui-updates.js',
  '/js/section-breakdown.js',
  '/js/results-table.js',
  '/js/pagination.js',
  '/js/downloads.js',
  '/js/sse.js',
  '/js/cloud-polling.js',
  '/js/run-control.js',
  '/js/complete-state.js',
  '/js/features/health.js',
  '/js/features/recheck.js',
  '/js/features/trend-chart.js',
  '/js/features/diff-report.js',
  '/js/features/auto-refresh.js',
  '/js/features/uptime.js',
  '/js/features/video-detail.js',
  '/js/features/watchlist.js',
  '/js/features/sound.js',
  '/js/features/section-recheck.js',
  '/js/features/comparison.js',
  '/js/features/shareable-report.js',
  '/js/features/heatmap.js',
  '/js/features/webhook.js',
  '/js/features/bulk-actions.js',
  '/js/features/schedule-config.js',
  '/js/features/push-notifications.js',
  '/js/init.js',
  '/js/theme.js',
  '/manifest.json',
];

// Install: cache static shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip SSE and API requests
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push notifications
self.addEventListener('push', (e) => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    e.waitUntil(
      self.registration.showNotification(data.title || 'Video Checker', {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/icon-96.png',
        tag: data.tag || 'video-checker',
        data: data.url || '/',
      })
    );
  } catch { /* ignore malformed push */ }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
