// PepTrak Service Worker v1
var CACHE = 'peptrak-v1';
var STATIC = [
  '/', '/protocol', '/tracker', '/chat', '/library', '/tools',
  '/manifest.json'
];

// Install — cache core pages
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(STATIC); }).catch(function(){})
  );
});

// Activate — clean old caches
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Fetch — network first, fall back to cache for navigation
self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);

  // Always go network for API calls
  if(url.pathname.startsWith('/api/')) return;

  // Navigation requests — network first, cache fallback
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request)
        .then(function(res){
          var clone = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
          return res;
        })
        .catch(function(){
          return caches.match(e.request).then(function(cached){
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // Everything else — cache first
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(res){
        if(res.ok){
          var clone = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return res;
      });
    }).catch(function(){ return new Response('Offline', {status: 503}); })
  );
});

// Push notifications
self.addEventListener('push', function(e){
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}
  var title = data.title || 'PepTrak';
  var body  = data.body  || "Time to log today's doses.";
  var url   = data.url   || '/tracker';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'peptrak-dose-reminder',
      renotify: true,
      data: { url: url },
      actions: [
        { action: 'log', title: 'Log dose' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

// Notification click
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/tracker';
  if(e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for(var i = 0; i < list.length; i++){
        if(list[i].url.includes('peptrak') || list[i].url.includes('localhost')){
          return list[i].focus().then(function(c){ return c.navigate(url); });
        }
      }
      return clients.openWindow(url);
    })
  );
});
