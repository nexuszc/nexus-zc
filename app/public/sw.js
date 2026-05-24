const CACHE = 'roofing-os-v1'
const OFFLINE_URLS = ['/roofing/jobs', '/roofing/canvass', '/']

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/']))
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Skip non-GET and Supabase API calls — always network
  if (request.method !== 'GET' || url.hostname.includes('supabase')) return

  // HTML nav requests: network-first, fallback to cache
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
          return res
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/')))
    )
    return
  }

  // Static assets: cache-first
  if (url.pathname.match(/\.(js|css|svg|png|ico|woff2?)$/)) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone()))
          return res
        })
      })
    )
  }
})
