/* Service worker de VampiroV20.
   - index.html: primero la red (así las actualizaciones llegan solas al reabrir) y, sin internet, la copia guardada.
   - El resto de los archivos de la app y las tipografías: copia guardada al instante y se actualiza por detrás.
   - Las llamadas a los motores de IA (Groq, Anthropic, etc.) no se tocan. */
const VERSION = "v1";
const CACHE = "vampirov20-" + VERSION;
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const TIPOGRAFIAS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ARCHIVOS.map(a => c.add(a).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k.startsWith("vampirov20-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function primeroLaRed(req){
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req, {cache:"no-cache"});
    if(r.ok) c.put("./index.html", r.clone());
    return r;
  } catch(_){
    return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
  }
}
async function copiaYActualizar(req){
  const c = await caches.open(CACHE), vieja = await c.match(req);
  const nueva = fetch(req).then(r => { if(r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => null);
  return vieja || (await nueva) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin){
    if(req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) e.respondWith(primeroLaRed(req));
    else e.respondWith(copiaYActualizar(req));
  } else if(TIPOGRAFIAS.includes(url.hostname)){
    e.respondWith(copiaYActualizar(req));
  }
});
