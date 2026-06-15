const CACHE_NAME = "nz-trip-offline-v30";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./data.encrypted.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./assets/image1.png",
  "./assets/image2.png",
  "./assets/image2.jpg",
  "./assets/image3.png",
  "./assets/image3.jpg",
  "./assets/image4.png",
  "./assets/image4.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
