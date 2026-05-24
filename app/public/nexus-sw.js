const CACHE = 'nexus-v1'
const STATIC = ['/', '/roofing/dashboard', '/roofing/marketing', '/roofing/sales', '/roofing/finance', '/roofing/customers', '/roofing/system']

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/'])))
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

  if (request.method !== 'GET' || url.hostname.includes('supabase') || url.hostname.includes('anthropic')) return

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(request, res.clone()))
          return res
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/')))
    )
    return
  }

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
