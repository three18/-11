// Простейший Service Worker для поддержки PWA
const CACHE_NAME = 'map-app-v1';
const ASSETS = [
    'index.html',
    'style.css',
    'script.js',
    'places.json',
    'manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => response || fetch(event.request))
    );
});
