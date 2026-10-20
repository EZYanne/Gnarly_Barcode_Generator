"use strict";
window.BC_MODAL_BUILD = "2026.10.20-12";            // read by the self-heal check in index.html
/* ═══════════════════════════════════════════════════════════════════
   Download confirmation dialog:  ask  →  loading  →  success (or error / cancelled)
   dlFlow({ icon, title, desc, files:[{name,meta?}], okLabel, workTitle, cancelable, run(progress, ctl) })
     run() does the real work: call progress(done, total) as it goes, check ctl.cancelled() in loops,
     and return { message, note } (or throw to show the error screen with a Retry button).
   Accessible: role="dialog", focus moves in and is trapped, Esc closes, focus returns to the button that opened it.
   ═══════════════════════════════════════════════════════════════════ */
(() => {
  const MIN_LOADING_MS = 700;                         // so the loading state is always seen, even for tiny files
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc2 = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let root = null, state = "idle", opts = null, cancelled = false, opener = null, resolveFlow = null, lastResult = null;

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "dlm"; root.id = "dlm"; root.hidden = true;
    root.innerHTML =
      '<div class="dlm-back" data-act="back"></div>' +
      '<div class="dlm-card" role="dialog" aria-modal="true" aria-labelledby="dlm-title" aria-describedby="dlm-desc" tabindex="-1">' +
        '<div class="dlm-ico" id="dlm-ico" aria-hidden="true"></div>' +
        '<h2 class="dlm-title" id="dlm-title"></h2>' +
        '<p class="dlm-desc" id="dlm-desc" aria-live="polite"></p>' +
        '<div class="dlm-progress" id="dlm-progress" hidden><div class="dlm-bar"><i id="dlm-fill"></i></div><span id="dlm-count"></span></div>' +
        '<ul class="dlm-files" id="dlm-files" hidden></ul>' +
        '<p class="dlm-note" id="dlm-note" hidden></p>' +
        '<div class="dlm-actions" id="dlm-actions"></div>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "ok") start();
      else if (a === "retry") start();
      else if (a === "stop") { cancelled = true; $("dlm-stop") && ($("dlm-stop").disabled = true); }
      else if (a === "close" || (a === "back" && state !== "work")) close();
    });
    root.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); if (state === "work") { if (opts.cancelable) cancelled = true; } else close(); }
      else if (e.key === "Tab") {                                   // keep the focus inside the dialog
        const f = [...root.querySelectorAll("button:not([disabled])")].filter(b => b.offsetParent !== null);
        if (!f.length) { e.preventDefault(); root.querySelector(".dlm-card").focus(); return; }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.querySelector(".dlm-card"))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  const $ = id => document.getElementById(id);
  const btn = (act, cls, icon, label, id) => `<button type="button" class="btn ${cls}"${id ? ` id="${id}"` : ""} data-act="${act}"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}</button>`;

  function files(list, mark) {
    const ul = $("dlm-files");
    if (!list || !list.length) { ul.hidden = true; ul.innerHTML = ""; return; }
    const shown = list.slice(0, 5);
    ul.innerHTML = shown.map((f, i) => `<li style="--i:${i}"><i class="fa-solid ${mark || "fa-file"}" aria-hidden="true"></i><span class="n">${esc2(f.name)}</span>${f.meta ? `<span class="m">${esc2(f.meta)}</span>` : ""}</li>`).join("") +
      (list.length > shown.length ? `<li class="more">+ ${list.length - shown.length} more</li>` : "");
    ul.hidden = false;
  }

  // one place that draws every state
  function show(next, extra) {
    state = next;
    const card = root.querySelector(".dlm-card"), ico = $("dlm-ico"), prog = $("dlm-progress"), note = $("dlm-note");
    card.dataset.state = next;
    note.hidden = true; prog.hidden = true;
    let actions = "";
    if (next === "ask") {
      ico.innerHTML = `<i class="fa-solid ${opts.icon || "fa-download"}"></i>`;
      $("dlm-title").textContent = opts.title; $("dlm-desc").textContent = opts.desc || "";
      files(opts.files);
      actions = btn("close", "btn-ghost", "fa-xmark", "CANCEL") + btn("ok", "", "fa-download", opts.okLabel || "DOWNLOAD", "dlm-ok");
    } else if (next === "work") {
      ico.innerHTML = '<div class="dlm-spin"><i></i><i></i><i></i><i></i></div>';
      $("dlm-title").textContent = opts.workTitle || "Preparing your download…";
      $("dlm-desc").textContent = "Please keep this page open.";
      files(opts.files);
      prog.hidden = false; setProgress(null);
      actions = opts.cancelable ? btn("stop", "btn-ghost", "fa-hand", "STOP", "dlm-stop") : "";
    } else if (next === "done") {
      ico.innerHTML = '<svg class="dlm-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27.5l8 8 15-17"/></svg>' +
        '<div class="dlm-burst">' + Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2, d = 58 + (i % 3) * 14; return `<i style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d)}px;--r:${(i * 47) % 180}deg"></i>`; }).join("") + "</div>";
      $("dlm-title").textContent = "Downloaded!";
      $("dlm-desc").textContent = (extra && extra.message) || "Your download is ready.";
      files(opts.files, "fa-circle-check");
      if (extra && extra.note) { note.textContent = extra.note; note.hidden = false; }
      actions = btn("close", "", "fa-check", "DONE", "dlm-done");
    } else if (next === "error") {
      ico.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
      $("dlm-title").textContent = "Something went wrong";
      $("dlm-desc").textContent = (extra && extra.message) || "The file could not be created.";
      files(null);
      actions = btn("close", "btn-ghost", "fa-xmark", "CLOSE") + btn("retry", "", "fa-rotate-right", "TRY AGAIN", "dlm-retry");
    } else if (next === "cancel") {
      ico.innerHTML = '<i class="fa-solid fa-hand"></i>';
      $("dlm-title").textContent = "Cancelled";
      $("dlm-desc").textContent = "Nothing was downloaded.";
      files(null);
      actions = btn("close", "", "fa-check", "CLOSE", "dlm-done");
    }
    $("dlm-actions").innerHTML = actions;
    // restart the entrance animation of the icon on every state change
    ico.classList.remove("swap"); void ico.offsetWidth; ico.classList.add("swap");
    const f = $("dlm-ok") || $("dlm-retry") || $("dlm-done") || $("dlm-stop");
    (f || card).focus({ preventScroll: true });
  }

  function setProgress(done, total) {
    const fill = $("dlm-fill"), count = $("dlm-count");
    if (done == null || !total) { fill.style.width = ""; fill.parentNode.classList.add("indet"); count.textContent = ""; return; }
    fill.parentNode.classList.remove("indet");
    fill.style.width = Math.max(4, Math.round(done / total * 100)) + "%";
    count.textContent = `${done} / ${total}`;
  }

  async function start() {
    cancelled = false;
    show("work");
    const t0 = Date.now();
    let res = null, err = null;
    try { res = await opts.run(setProgress, { cancelled: () => cancelled }); } catch (e) { err = e; }
    await sleep(Math.max(0, MIN_LOADING_MS - (Date.now() - t0)));
    if (cancelled) { show("cancel"); lastResult = "cancel"; }
    else if (err) { show("error", { message: err && err.message && err.message !== "png" ? err.message : "The file could not be created. Please try again." }); lastResult = "error"; }
    else { setProgress(1, 1); await sleep(180); show("done", res || {}); lastResult = "done"; }
  }

  function open() {
    root.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => root.classList.add("is-open"));
  }
  function close() {
    root.classList.remove("is-open");
    const finish = () => { if (state !== "idle") return; root.hidden = true; document.body.classList.remove("modal-open"); };   // a new dialog may already be open
    setTimeout(finish, 180);
    state = "idle";
    if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    const r = resolveFlow; resolveFlow = null;
    if (r) r(lastResult || "dismissed");
  }

  // if focus ever leaves while the dialog is open (e.g. screen-reader virtual cursor), pull it back in
  document.addEventListener("focusin", e => {
    if (root && !root.hidden && state !== "idle" && !root.contains(e.target)) root.querySelector(".dlm-card").focus({ preventScroll: true });
  });

  window.dlFlow = function (o) {
    return new Promise(resolve => {
      if (state !== "idle") { resolve("busy"); return; }
      build();
      opts = o; lastResult = null; resolveFlow = resolve; opener = document.activeElement;
      open();                                   // visible first, so the focus() inside show() really lands in the dialog
      show("ask");
    });
  };
})();
