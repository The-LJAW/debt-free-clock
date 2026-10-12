/*
 * Debt-Free Clock — service worker. It keeps a copy of the page so the installed app opens
 * without a connection. build.py writes this file to the site root as sw.js and stamps
 * VERSION with a hash of the build, so every deploy installs a fresh copy.
 *
 *  - The page itself: network first, so updates show up right away; the saved copy is
 *    used only when offline.
 *  - Icons and other files from this site, and Google Fonts: cached after first use.
 *  - Everything else (Lemon Squeezy license checks, checkout) goes straight to the network.
 * Nobody's numbers pass through here: they live in the page's own storage.
 */
var VERSION = '916cd546b528';
var CACHE = 'dfc-' + VERSION;
var CORE = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('dfc-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./', copy); }); }
      return res;
    }).catch(function () {
      return caches.match('./').then(function (hit) { return hit || Response.error(); });
    }));
    return;
  }

  var fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin === self.location.origin || fonts) {
    event.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
      return hit || net;
    }));
  }
});
