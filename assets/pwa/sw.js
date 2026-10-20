/* GNARLY! PH Barcode Generator — service worker (offline support).
   Lives in assets/pwa/ and controls the whole app folder (two levels up). Browsers only allow that when the server sends
   "Service-Worker-Allowed: /" for this file — assets/.htaccess does it on Apache/XAMPP.
   • Install:  downloads the whole app once (HTML, CSS, JS, fonts, icons, 2D-code engine).
   • Code (page, CSS, JS, manifest): NETWORK FIRST — online you always get the newest files, so the page and its
     scripts/styles can never get out of step; offline (or if the network is slow) the saved copy is used.
   • Fonts, icons, images: cache first (they never change between versions).
   Bump VERSION whenever any listed file changes so installed copies refresh. */
const VERSION = "bc-v12";

const ROOT = new URL("../../", self.location.href).href;          // the folder that holds index.html
const INDEX = ROOT + "index.html";

const CORE = [
  "", "index.html",
  "assets/pwa/manifest.webmanifest",
  "assets/css/fonts.css",
  "assets/css/style.css",
  "assets/js/script.js",
  "assets/js/batch.js",
  "assets/js/modal.js",
  "assets/js/pwa.js",
  "assets/vendor/bwip-js/bwip-js.min.js",
  "assets/vendor/fontawesome/css/fontawesome.min.css",
  "assets/vendor/fontawesome/css/solid.min.css",
  "assets/vendor/fontawesome/webfonts/fa-solid-900.woff2",
  "assets/fonts/bebas-neue-latin-400-normal.woff2",
  "assets/fonts/space-grotesk-latin-400-normal.woff2",
  "assets/fonts/space-grotesk-latin-500-normal.woff2",
  "assets/fonts/space-grotesk-latin-600-normal.woff2",
  "assets/fonts/space-grotesk-latin-700-normal.woff2",
  "assets/fonts/ibm-plex-mono-latin-400-normal.woff2",
  "assets/fonts/ibm-plex-mono-latin-600-normal.woff2",
  "assets/fonts/ibm-plex-mono-latin-700-normal.woff2",
  "assets/img/slogo.png",
  "assets/icons/favicon-32.png",
  "assets/icons/favicon-64.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png"
].map(p => ROOT + p);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(CORE.map(url => new Request(url, { cache: "reload" }))))   // bypass the HTTP cache: always fresh files
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("bc-") && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isCode = (req, url) =>
  req.mode === "navigate" || ["document", "style", "script", "manifest"].includes(req.destination) || /\.(html|css|js|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // never touch other sites
  event.respondWith(isCode(req, url) ? networkFirst(req) : cacheFirst(req));
});

// Network first (always revalidated), saved copy when offline or when the network takes longer than 4 s.
function networkFirst(req) {
  const key = req.mode === "navigate" ? INDEX : req;              // every page address maps to the one saved page
  return new Promise(resolve => {
    let settled = false;
    const finish = r => { if (!settled && r) { settled = true; resolve(r); } };
    const saved = () => caches.match(key, { ignoreSearch: true });
    const timer = setTimeout(() => saved().then(finish), 4000);
    // always revalidate with the server (hosts like GitHub Pages let browsers reuse files for 10 minutes)
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then(res => {
        clearTimeout(timer);
        if (res.redirected && req.mode === "navigate") { finish(Response.redirect(res.url, 302)); return; }   // e.g. /app -> /app/ must stay a redirect
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
        finish(res);
      })
      .catch(() => { clearTimeout(timer); saved().then(r => finish(r || Response.error())); });
  });
}

function cacheFirst(req) {
  return caches.match(req, { ignoreSearch: true }).then(cached => {
    if (cached) return cached;
    return fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    });
  });
}
