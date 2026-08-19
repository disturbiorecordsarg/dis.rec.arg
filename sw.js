// Service worker mínimo para Disturbio Records — Gestión de Entradas.
// Objetivo principal: cumplir el requisito técnico para que el navegador
// ofrezca "Instalar app" / generar el APK con PWABuilder.
// Los datos (entradas, tickets, escaneos) siempre se leen en vivo desde
// Supabase, así que este service worker NO cachea datos, solo el shell
// de la app para que abra más rápido.

const CACHE_NAME = "disturbio-gestion-v2";
const APP_SHELL = [
  "/app-gestion.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear llamadas a Supabase (auth, datos, storage, functions):
  // siempre tienen que ir a la red para que la info esté al día.
  if (url.hostname.endsWith(".supabase.co")) {
    return;
  }

  // Para el resto (el shell de la app): red primero, y si no hay
  // conexión, se sirve la copia cacheada.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
