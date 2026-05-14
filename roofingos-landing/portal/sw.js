const CACHE = "portal-v1";
const ASSETS = ["/portal/index.html", "/portal/sw.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/portal") && e.request.method === "GET" && !url.pathname.includes("supabase")) {
    e.respondWith(
      caches.match("/portal/index.html").then(cached => cached || fetch(e.request))
    );
    return;
  }
  if (e.request.method === "GET") {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok && !url.hostname.includes("supabase")) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
  }
});

self.addEventListener("push", e => {
  const data = e.data?.json() || { title: "Project Update", body: "Your roof project has an update." };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/portal/icon-192.png",
      badge: "/portal/icon-192.png",
      data: data.url
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data || "/portal/"));
});
