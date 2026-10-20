"use strict";
/* Progressive-web-app glue: offline service worker, "Install" button, online / offline notices.
   Needs HTTPS or localhost (browser rule); on plain http://192.168.x.x the page still works, just without install/offline. */
(() => {
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  if ("serviceWorker" in navigator && secure) {
    const hadController = !!navigator.serviceWorker.controller;   // false on the very first visit
    window.addEventListener("load", () => {
      // The helper lives in assets/pwa/ but must control the whole app, which needs the "Service-Worker-Allowed" header
      // (assets/.htaccess sends it on Apache / XAMPP). Static hosts that cannot send headers (e.g. GitHub Pages) refuse it;
      // then a copy of the file placed next to index.html (sw.js) is used instead. Offline support is optional either way.
      navigator.serviceWorker.register("assets/pwa/sw.js", { scope: "./" })
        .catch(() => navigator.serviceWorker.register("sw.js", { scope: "./" }))
        .catch(() => { /* no offline support here: the app still works online */ });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;                                  // first install: nothing to refresh
      try { if (sessionStorage.getItem("bc-updated")) return; sessionStorage.setItem("bc-updated", "1"); } catch (e) { /* storage blocked */ }
      toast("Updated — loading the newest version…", false, 2500);
      setTimeout(() => location.reload(), 600);                    // once per tab, so page and scripts always match
    });
  }

  const btn = document.getElementById("install");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferred = null;

  if (btn && !standalone) {
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; btn.hidden = false; });
    if (ios) btn.hidden = false;                                   // iOS has no install prompt: the button explains how
    btn.addEventListener("click", async () => {
      if (deferred) {
        deferred.prompt();
        try { await deferred.userChoice; } catch (err) { /* dismissed */ }
        deferred = null; btn.hidden = true;
      } else if (ios) {
        toast("Tap the Share button, then “Add to Home Screen”", false, 7000);
      }
    });
  }
  window.addEventListener("appinstalled", () => { if (btn) btn.hidden = true; toast("Installed! Open it from your home screen"); });

  window.addEventListener("offline", () => toast("You're offline — everything still works", false, 3500));
  window.addEventListener("online", () => toast("Back online"));
})();
