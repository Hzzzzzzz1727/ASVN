// sw.js - Service Worker đơn giản
const CACHE_NAME = 'bhtv-danang-v2';
const RUNTIME_CACHE = 'bhtv-danang-runtime-v2';

// Danh sách assets để cache khi install
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  console.log('[SW] Installing...')
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell')
      return cache.addAll(urlsToCache)
    }).catch(err => {
      console.error('[SW] Install error:', err)
    })
  )
  self.skipWaiting() // Activate immediately
})

self.addEventListener('activate', event => {
  console.log('[SW] Activating...')
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  self.clients.claim() // Take control immediately
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return
  }

  // Skip external APIs (Supabase, Nominatim, OSRM, v.v)
  if (url.hostname !== self.location.hostname && 
      !url.hostname.includes('localhost')) {
    event.respondWith(fetch(request))
    return
  }

  // Cache-first for assets (JS, CSS, images)
  if (request.destination === 'style' || 
      request.destination === 'script' || 
      request.destination === 'image' ||
      request.destination === 'font') {
    event.respondWith(
      caches.match(request).then(response => {
        if (response) return response
        return fetch(request).then(response => {
          // Cache successful responses
          if (response.ok) {
            const responseToCache = response.clone()
            caches.open(RUNTIME_CACHE).then(cache => {
              cache.put(request, responseToCache)
            })
          }
          return response
        })
      })
    )
    return
  }

  // Network-first for HTML & API calls
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const responseToCache = response.clone()
          caches.open(RUNTIME_CACHE).then(cache => {
            cache.put(request, responseToCache)
          })
        }
        return response
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(request).then(response => {
          return response || new Response('Offline - không có dữ liệu cache', {
            status: 503,
            statusText: 'Service Unavailable'
          })
        })
      })
  )
})