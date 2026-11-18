// Service worker de SyncFinanzas.
// Guarda la cáscara de la aplicación (HTML, JS, CSS, iconos) para que la
// versión instalada se abra rápido. Las llamadas a /api nunca se guardan:
// los datos siempre se consultan en línea, con la sesión del usuario.
//
// ACTUALIZACIONES: la versión cambia en cada despliegue (SW_VERSION, el
// mismo valor que APP_VERSION en client/src/version.ts). Cuando este
// archivo cambia, el navegador descarga el service worker nuevo, que queda
// en espera sin activarse solo. La app muestra entonces el aviso "Hay una
// nueva versión" con el botón Actualizar: al pulsarlo, la página le pide al
// worker en espera que se active (SKIP_WAITING) y recarga. La sesión y los
// datos no se tocan: viven en Supabase y la recarga solo cambia el código
// de la aplicación.
const SW_VERSION = "7fe38c6";
const CACHE = `syncfinanzas-${SW_VERSION}`;
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

// La instalación solo guarda la cáscara nueva; no se activa sola, para que
// la app pueda avisar primero con el botón Actualizar.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

// La página pide la activación solo cuando el usuario pulsa Actualizar.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API y autenticación: siempre en línea, nunca en caché.
  if (url.pathname.startsWith("/api/")) return;
  // Archivos del lector de comprobantes: siempre en línea, sin pasar por
  // la caché del service worker. El worker de Tesseract se crea desde
  // /tesseract/worker.min.js y carga el núcleo con importScripts; en
  // iPhone, servir esos archivos desde la caché del service worker puede
  // fallar. La caché del navegador (con revalidación) y la IndexedDB del
  // lector ya los guardan tras la primera lectura.
  if (url.pathname.startsWith("/tesseract/")) return;
  if (event.request.method !== "GET") return;
  // Navegación (la página principal): primero en línea, para que una
  // recarga tras una actualización traiga el HTML nuevo; sin conexión,
  // se usa la copia guardada.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});
