"use strict";
window.BC_BATCH_BUILD = "2026.10.20-12";         // read by the self-heal check in index.html
/* ═══════════════════════════════════════════════════════════════════
   BATCH & LABEL SHEETS
   Many barcodes at once → preview on a label sheet → print, or download everything as a ZIP.
   Re-uses the encoders / renderer / helpers from script.js ($, FORMATS, render, esc, store, toast,
   save, svgToPng, customSelect, dropdowns, restart …). Wrapped in a function so nothing leaks.
   ═══════════════════════════════════════════════════════════════════ */
(() => {
  const MAX_ITEMS = 500;            // values per batch
  const MAX_LABELS = 2000;          // labels per print job (values × copies)
  const MM = 96 / 25.4;             // CSS pixels per millimetre
  const PAPERS = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } };
  // labels per page · columns · rows (portrait)
  const GRIDS = [[65, 5, 13], [48, 4, 12], [40, 4, 10], [30, 3, 10], [24, 3, 8], [21, 3, 7], [18, 3, 6], [15, 3, 5],
    [14, 2, 7], [12, 3, 4], [10, 2, 5], [8, 2, 4], [6, 2, 3], [4, 2, 2], [2, 1, 2], [1, 1, 1]];
  // sensible starting sequence per format (prefix + zero-padded number must give a valid value)
  const SEQ = {
    ean13: ["20", 1, 10], upca: ["2", 1, 10], ean8: ["2", 1, 6], upce: ["0", 1, 6], isbn: ["978", 1, 9], issn: ["", 1, 7],
    ean5: ["", 10000, 5], ean2: ["", 10, 2], code128: ["GNR-", 1, 4], letters: ["ANCHOR", 1, 3], gs1128: ["(10)LOT", 1, 4], code39: ["GNR", 1, 4],
    code93: ["GNR-", 1, 4], itf14: ["1", 1, 12], itf: ["", 1, 10], codabar: ["", 1, 6], msi: ["", 1, 8], pharma: ["", 100, 0],
    code11: ["", 1, 8], qr: ["GNR-", 1, 4], datamatrix: ["GNR-", 1, 4], pdf417: ["GNR-", 1, 4], aztec: ["GNR-", 1, 4]
  };

  const els = {};
  let items = [];                   // [{ raw, value, full, ok, msg, loading }]
  let randValues = [];
  let page = 0, pages = [], layout = null, dirty = true, zipping = false, cancelZip = false;
  let refreshTimer = 0, saveTimer = 0;
  const svgCache = new Map();

  const fitMode = () => matchMedia("(min-width:901px) and (min-height:600px)").matches;
  const fmtKey = () => $("bformat").value;
  const isBatch = () => document.body.classList.contains("mode-batch");

  /* ───────── small helpers ───────── */
  const numVal = (id, min, max, def) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const intVal = (id, min, max, def) => Math.round(numVal(id, min, max, def));
  const mm = n => (+n).toFixed(2) + "mm";
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  function setSelect(id, value) {
    const s = $(id); s.value = value;
    const d = dropdowns.find(x => x.sel === s);
    if (d) d.sync();
  }
  function blobToBytes(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(blob);
    });
  }

  /* ───────── values: list / sequence / random ───────── */
  function seqValues(cfg, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const n = cfg.start + i * cfg.step;
      out.push(cfg.prefix + (cfg.pad > 0 ? String(n).padStart(cfg.pad, "0") : String(n)) + cfg.suffix);
    }
    return out;
  }
  function readSeq() {
    return {
      prefix: $("bs-prefix").value, suffix: $("bs-suffix").value,
      start: intVal("bs-start", 0, 9e14, 1), step: intVal("bs-step", 1, 1e9, 1), pad: intVal("bs-pad", 0, 15, 0)
    };
  }
  function randomSet(key, count) {
    const f = FORMATS[key], set = new Set();
    for (let tries = 0; set.size < count && tries < count * 30; tries++) set.add(f.gen());
    return [...set];
  }
  function collect() {
    const src = els.src;
    let values;
    if (src === "list") values = $("blist").value.split(/\r?\n/).map(s => s.split("\t")[0].trim()).filter(Boolean);   // pasted spreadsheet rows: first cell only
    else if (src === "seq") values = seqValues(readSeq(), intVal("bs-count", 1, MAX_ITEMS, 1));
    else values = randValues.slice();
    const truncated = values.length > MAX_ITEMS;
    return { values: values.slice(0, MAX_ITEMS), truncated, total: values.length };
  }
  function validate(key, values) {
    const f = FORMATS[key];
    return values.map(raw => {
      const value = f.clean(raw);
      try {
        const e = f.encode(value);
        return { raw, value, full: e.value, ok: true, adjusted: value !== raw };
      } catch (err) {
        if (err && err.loading) return { raw, value, ok: false, loading: true, msg: "Loading 2D engine…" };
        return { raw, value, ok: false, msg: (err && err.message) || "Invalid value" };
      }
    });
  }

  /* ───────── spreadsheet-style value list ───────── */
  const rowH = () => parseFloat(getComputedStyle($("btable")).getPropertyValue("--lh")) || 28;
  function syncTable() {
    const t = "translateY(" + (-$("blist").scrollTop) + "px)";
    $("bt-gutter").style.transform = t; $("bt-rows").style.transform = t;
  }
  // neutral = true while typing (status not known yet); false after validation
  function renderTable(neutral) {
    if (els.src !== "list") return;
    const lines = $("blist").value.split(/\r?\n/);
    const need = Math.max(lines.length, Math.ceil(($("bt-body").clientHeight || 0) / rowH()) + 1);
    let k = 0, g = "", r = "";
    for (let i = 0; i < need; i++) {
      let cls = "", msg = "";
      const text = i < lines.length ? lines[i].split("\t")[0].trim() : "";
      if (text) {
        const it = neutral ? null : items[k];
        k++;
        if (k > MAX_ITEMS) { cls = "bad"; msg = "over the " + MAX_ITEMS + " limit"; }
        else if (it && it.ok) { cls = "ok"; msg = it.full !== it.raw ? it.full : ""; }
        else if (it && !it.loading) { cls = "bad"; msg = it.msg; }
      }
      g += `<div class="bt-g ${cls}">${i + 1}</div>`;
      r += `<div class="bt-r ${cls}" ${cls === "bad" ? `title="${esc(msg)}"` : ""}>${msg ? `<span>${esc(msg)}</span>` : ""}${cls === "ok" ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : cls === "bad" ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>' : ""}</div>`;
    }
    $("bt-gutter").innerHTML = g; $("bt-rows").innerHTML = r;
    syncTable();
  }

  /* ───────── page geometry ───────── */
  function computeLayout() {
    const paper = PAPERS[$("bpaper").value], land = $("borient").value === "l";
    const pw = land ? paper.h : paper.w, ph = land ? paper.w : paper.h;
    const margin = numVal("bmargin", 0, 40, 8), gap = numVal("bgap", 0, 20, 2);
    const key = $("blayout").value;
    let cols, rows, cw, ch;
    if (key === "custom") {
      cols = intVal("bcols", 1, 20, 3); rows = intVal("brows", 1, 40, 8);
      cw = numVal("blw", 8, 300, 60); ch = numVal("blh", 8, 300, 30);
    } else {
      const g = GRIDS.find(x => x[0] === +key) || GRIDS[4];
      cols = land ? g[2] : g[1]; rows = land ? g[1] : g[2];
      cw = (pw - 2 * margin - (cols - 1) * gap) / cols;
      ch = (ph - 2 * margin - (rows - 1) * gap) / rows;
    }
    let err = "";
    const usedW = cols * cw + (cols - 1) * gap + 2 * margin, usedH = rows * ch + (rows - 1) * gap + 2 * margin;
    if (cw < 8 || ch < 8) err = "Labels would be under 8 mm — pick fewer labels per page or reduce the margin / gap.";
    else if (usedW > pw + 0.01 || usedH > ph + 0.01) err = `The grid (${usedW.toFixed(1)} × ${usedH.toFixed(1)} mm) is bigger than the paper (${pw} × ${ph} mm) — reduce columns, rows, label size, gap or margin.`;
    return { pw, ph, cols, rows, cw, ch, gap, x0: margin, y0: margin, per: cols * rows, err };
  }

  function buildPages() {
    layout = computeLayout();
    const valid = items.filter(i => i.ok);
    const copies = intVal("bcopies", 1, 99, 1);
    let rows = [];
    for (const it of valid) for (let c = 0; c < copies; c++) rows.push(it);
    let capped = false;
    if (rows.length > MAX_LABELS) { rows = rows.slice(0, MAX_LABELS); capped = true; }
    const startAt = Math.min(layout.per, intVal("bstart", 1, 9999, 1));
    const slots = Array(startAt - 1).fill(null).concat(rows);
    pages = [];
    for (let i = 0; i < slots.length; i += layout.per) pages.push(slots.slice(i, i + layout.per));
    if (!pages.length) pages.push([]);
    return { capped, labels: rows.length };
  }

  function labelSVG(value) {
    const o = { scale: 1, height: +$("bheight").value, text: $("bshowtext").checked };
    const key = `${fmtKey()}|${value}|${o.height}|${o.text}`;
    let svg = svgCache.get(key);
    if (svg === undefined) {
      try { svg = render(fmtKey(), value, o).svg; } catch (e) { svg = ""; }
      if (svgCache.size > 1500) svgCache.clear();
      svgCache.set(key, svg);
    }
    return svg;
  }

  // One sheet as HTML. forPrint: drop empty slots and size the page a hair under the paper (avoids a blank extra page).
  function pageHTML(slots, forPrint) {
    const L = layout;
    let cells = "";
    for (let i = 0; i < L.per; i++) {
      const it = slots[i];
      if (forPrint && !it) continue;
      const x = L.x0 + (i % L.cols) * (L.cw + L.gap), y = L.y0 + Math.floor(i / L.cols) * (L.ch + L.gap);
      cells += `<div class="lcell${it ? "" : " is-empty"}" style="left:${mm(x)};top:${mm(y)};width:${mm(L.cw)};height:${mm(L.ch)}">${it ? labelSVG(it.value) : ""}</div>`;
    }
    const h = forPrint ? L.ph - 0.4 : L.ph;
    return `<div class="lpage${$("bguides").checked ? " guides" : ""}" style="width:${mm(L.pw)};height:${mm(h)}">${cells}</div>`;
  }

  /* ───────── screen: preview, list, status ───────── */
  function fitPreview() {
    if (!layout || $("bsheetview").hidden || $("batch").hidden) return;
    const box = $("bpreview"), wrap = $("bpaperwrap"), paper = $("bsheet");
    const pwPx = layout.pw * MM, phPx = layout.ph * MM;
    const availW = box.clientWidth - 8;
    const availH = fitMode() ? box.clientHeight - 8 : Infinity;
    if (availW <= 0 || availH <= 0) return;
    const k = Math.max(0.05, Math.min(availW / pwPx, availH / phPx, 1.5));
    paper.style.transform = `scale(${k})`;
    wrap.style.width = (pwPx * k) + "px";
    wrap.style.height = (phPx * k) + "px";
  }

  function renderSheet() {
    page = Math.min(page, pages.length - 1);
    $("bsheet").innerHTML = pageHTML(pages[page], false);
    $("bpage").textContent = `Page ${page + 1} of ${pages.length}`;
    $("bprev").disabled = page <= 0;
    $("bnext").disabled = page >= pages.length - 1;
    fitPreview();
  }

  function renderList() {
    $("blistrows").innerHTML = items.map((it, i) =>
      `<li class="${it.ok ? "ok" : "bad"}"><span class="bi">${i + 1}</span><code>${esc(it.raw)}</code>` +
      (it.ok && it.full !== it.raw ? `<span class="ba">→ ${esc(it.full)}</span>` : "") +
      `<span class="bs">${it.ok ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${esc(it.msg)}`}</span></li>`).join("")
      || '<li class="empty-row">Nothing yet — add values on the left.</li>';
  }

  function render2dUI() {
    const twod = FORMATS[fmtKey()].cat === "twod";
    $("bheight").disabled = twod;
    const d = dropdowns.find(x => x.sel === $("bheight")); if (d) d.sync();
    document.querySelector('label[for="bscale"]').textContent = twod ? "Module size (ZIP)" : "Bar width (ZIP)";
  }

  function refresh() {
    if (!els.ready) return;
    if (!isBatch()) { dirty = true; return; }
    dirty = false;
    const key = fmtKey(), c = collect();
    items = validate(key, c.values);
    const ok = items.filter(i => i.ok).length, bad = items.length - ok, loading = items.some(i => i.loading);
    $("blist-count").textContent = els.src === "list" ? `${items.length}${c.truncated ? ` of ${c.total}` : ""}` : "";
    const info = buildPages();
    // sequence hint: first → last, as they will really be encoded
    if (els.src === "seq") {
      const f = items[0], l = items[items.length - 1];
      $("bs-hint").textContent = !f ? "" : f.ok
        ? `First ${f.full}${l && l !== f && l.ok ? "  ·  Last " + l.full : ""}${l && !l.ok ? "  ·  Last: " + l.msg : ""}`
        : f.msg;
    }
    // status line
    const parts = [`${items.length} value${items.length === 1 ? "" : "s"}`, `${ok} valid`];
    if (bad) parts.push(`${bad} need fixing`);
    const lines = [parts.join(" · ")];
    if (ok) lines.push(`${info.labels} label${info.labels === 1 ? "" : "s"} on ${pages.length} page${pages.length === 1 ? "" : "s"}`);
    if (c.truncated) lines.push(`Only the first ${MAX_ITEMS} values are used.`);
    if (info.capped) lines.push(`Limited to ${MAX_LABELS} labels per print job.`);
    if (loading) lines.push("Loading the 2D engine…");
    const st = $("bstatus");
    st.textContent = lines.join(" — ");
    st.classList.toggle("has-bad", bad > 0);
    $("blayout-msg").textContent = layout.err;
    $("bcustom").hidden = $("blayout").value !== "custom";
    render2dUI();
    renderSheet();
    renderList();
    renderTable(false);
    const canOut = ok > 0 && !layout.err;
    $("bprint").disabled = !canOut || zipping;
    $("bpdf").disabled = !canOut || zipping;
    $("bzip-png").disabled = ok === 0 || (zipping && !els.zipKind);
    $("bzip-svg").disabled = ok === 0 || (zipping && !els.zipKind);
    queueSave();
  }
  function queueRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }

  /* ───────── persistence ───────── */
  function snapshot() {
    return {
      fmt: fmtKey(), src: els.src, list: $("blist").value, seq: readSeq(), scount: $("bs-count").value, rcount: $("br-count").value,
      paper: $("bpaper").value, layout: $("blayout").value, orient: $("borient").value, margin: $("bmargin").value, gap: $("bgap").value,
      copies: $("bcopies").value, cols: $("bcols").value, rows: $("brows").value, lw: $("blw").value, lh: $("blh").value,
      show: $("bshowtext").checked, guides: $("bguides").checked, height: $("bheight").value, scale: $("bscale").value
    };
  }
  function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set("bc-batch", JSON.stringify(snapshot())), 400); }
  function restore() {
    let s = null;
    try { s = JSON.parse(store.get("bc-batch") || "null"); } catch (e) { s = null; }
    return s && typeof s === "object" ? s : null;
  }

  /* ───────── source / view tabs ───────── */
  function setSrc(src) {
    els.src = src;
    document.querySelectorAll("#bsrc .cat").forEach(b => { const on = b.dataset.src === src; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    document.querySelectorAll(".bpanel").forEach(p => { p.hidden = p.dataset.panel !== src; });
    if (src === "rand" && !randValues.length) randValues = randomSet(fmtKey(), intVal("br-count", 1, MAX_ITEMS, 24));
    queueRefresh();
  }
  function setView(view) {
    document.querySelectorAll("#bview .cat").forEach(b => { const on = b.dataset.view === view; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    $("bsheetview").hidden = view !== "sheet";
    $("blistview").hidden = view !== "list";
    if (view === "sheet") requestAnimationFrame(fitPreview);
  }
  function applySeqDefaults(key) {
    const d = SEQ[key] || ["", 1, 6];
    $("bs-prefix").value = d[0]; $("bs-start").value = d[1]; $("bs-pad").value = d[2];
    $("bs-suffix").value = ""; $("bs-step").value = 1;
  }

  /* ───────── export: ZIP (no compression: PNG is already compressed, SVG is tiny) ───────── */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), size = f.data.length, crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  function exportZip(kind) {
    if (zipping) return;
    const valid = items.filter(i => i.ok);
    if (!valid.length) return;
    const key = fmtKey();
    const zipName = `barcodes-${FORMATS[key].name.replace(/\W+/g, "").toLowerCase()}-${valid.length}.zip`;
    const nameOf = (it, i) => `${String(i + 1).padStart(3, "0")}-${(it.full.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "code")}.${kind}`;
    const o = { scale: +$("bscale").value, height: +$("bheight").value, text: $("bshowtext").checked };
    dlFlow({
      icon: "fa-file-zipper",
      title: `Download ${kind.toUpperCase()} ZIP?`,
      desc: `${valid.length} barcode${valid.length === 1 ? "" : "s"} will be created as ${kind.toUpperCase()} images and packed into one ZIP file.`,
      files: [{ name: zipName, meta: `${valid.length} files` }, ...valid.slice(0, 3).map((it, i) => ({ name: nameOf(it, i) }))],
      okLabel: "DOWNLOAD ZIP",
      workTitle: `Creating ${valid.length} ${kind.toUpperCase()} file${valid.length === 1 ? "" : "s"}…`,
      cancelable: true,
      async run(progress, ctl) {
        zipping = true; els.zipKind = kind;
        const files = [], enc = new TextEncoder();
        try {
          for (let i = 0; i < valid.length; i++) {
            if (ctl.cancelled()) return null;
            const r = render(key, valid[i].value, o);
            const data = kind === "svg" ? enc.encode(r.svg) : await blobToBytes(await svgToPng(r.svg));
            files.push({ name: nameOf(valid[i], i), data });
            progress(i + 1, valid.length);
            if (i % 3 === 2) await nextFrame();                    // keep the page responsive
          }
          if (ctl.cancelled()) return null;
          save(zipName, makeZip(files));
          return { message: `${files.length} ${kind.toUpperCase()} file${files.length === 1 ? "" : "s"} saved in one ZIP.`, note: "Look in your Downloads folder." };
        } finally { zipping = false; els.zipKind = null; refresh(); }
      }
    });
  }

  /* ───────── print ───────── */
  // Called by script.js's fillPrint(); returns true when batch mode produced the pages.
  function batchFillPrint() {
    const st = $("page-size");
    if (!isBatch()) { st.textContent = ""; return false; }
    if (dirty) refresh();
    buildPages();
    const ok = items.some(i => i.ok) && !layout.err;
    $("print-area").innerHTML = ok ? pages.map(p => pageHTML(p, true)).join("") : "";
    st.textContent = `@page{size:${layout.pw}mm ${layout.ph}mm;margin:0}`;
    return true;
  }

  /* Print the label sheets from a clean, dedicated document. Its @page rule (size + zero margin) is read when the
     document loads, so the browser has no margin to draw its date / title / address / page-number header and footer in. */
  function printLabels() {
    if (!batchFillPrint()) return;
    const pagesHtml = $("print-area").innerHTML;
    if (!pagesHtml) return;
    const w = window.open("", "_blank");
    if (!w) { window.print(); return; }                          // pop-up blocked: print from this page instead (same margins)
    const css = `@page{size:${layout.pw}mm ${layout.ph}mm;margin:0}` +
      "*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}" +
      ".lpage{position:relative;overflow:hidden;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".lpage:last-child{break-after:auto;page-break-after:auto}" +
      ".lcell{position:absolute;padding:1mm;display:flex;align-items:center;justify-content:center}" +
      ".lcell svg{display:block;width:100%;height:100%}" +
      ".lpage.guides .lcell{outline:.2mm dashed #777;outline-offset:-.1mm}";
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title> </title><style>${css}</style></head><body>${pagesHtml}</body></html>`);
    w.document.close();
    w.addEventListener("afterprint", () => w.close());
    setTimeout(() => { w.focus(); w.print(); }, 350);
    toast("Date or page number still showing? Untick “Headers and footers” in the print window — or use the PDF button.", false, 7000);
  }

  /* ───────── PDF of the label sheets ─────────
     A real PDF file made right here (vector bars + Helvetica text), so printing it from any PDF viewer can never
     add a browser date / address / page-number header or footer. */
  const HELV_W = "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584".split(" ").map(Number);
  const BOLD_W = "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584".split(" ").map(Number);
  const PT = 72 / 25.4;                                          // PDF points per millimetre
  const pdfNum = n => (Math.round(n * 1000) / 1000).toString();
  const pdfStr = t => "(" + t.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1") + ")";
  const textW = (t, bold, size) => { let w = 0; for (const ch of t) w += (bold ? BOLD_W : HELV_W)[Math.min(94, Math.max(0, ch.charCodeAt(0) - 32))]; return w * size / 1000; };
  const geoCache = new Map();

  // bars + captions of one label, in the SVG's own units
  function labelGeometry(value) {
    const svg = labelSVG(value);
    let g = geoCache.get(svg);
    if (g) return g;
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml"), root = doc.documentElement;
    const vb = root.getAttribute("viewBox").split(" ").map(Number);
    g = { W: vb[2], H: vb[3], rects: [], texts: [] };
    doc.querySelectorAll("g[shape-rendering] rect").forEach(r => g.rects.push([+r.getAttribute("x"), +r.getAttribute("y"), +r.getAttribute("width"), +r.getAttribute("height")]));
    doc.querySelectorAll("text").forEach(t => {
      const p = t.parentNode;
      g.texts.push({ x: +t.getAttribute("x"), y: +t.getAttribute("y"), len: t.getAttribute("textLength") ? +t.getAttribute("textLength") : 0,
        fs: +p.getAttribute("font-size"), bold: p.getAttribute("font-weight") === "700", s: t.textContent });
    });
    if (geoCache.size > 3000) geoCache.clear();
    geoCache.set(svg, g);
    return g;
  }

  function buildPdf() {
    const L = layout, guides = $("bguides").checked, objs = [];
    const add = body => { objs.push(body); return objs.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>");                    // 1
    add("");                                                      // 2 (filled below)
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");       // 3
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");  // 4
    const kids = [];
    for (const slots of pages) {
      let c = "0 g\n";
      slots.forEach((it, i) => {
        if (!it) return;
        const geo = labelGeometry(it.value);
        const cx = L.x0 + (i % L.cols) * (L.cw + L.gap), cy = L.y0 + Math.floor(i / L.cols) * (L.ch + L.gap);
        const bw = L.cw - 2, bh = L.ch - 2;                       // 1 mm padding inside the label
        const k = Math.min(bw / geo.W, bh / geo.H);
        const ox = cx + 1 + (bw - geo.W * k) / 2, oy = cy + 1 + (bh - geo.H * k) / 2;
        const X = x => (ox + x * k) * PT, Y = y => (L.ph - (oy + y * k)) * PT;
        if (guides) c += `q [2 2] 0 d 0.4 w 0.45 G ${pdfNum(cx * PT)} ${pdfNum((L.ph - cy - L.ch) * PT)} ${pdfNum(L.cw * PT)} ${pdfNum(L.ch * PT)} re S Q\n`;
        for (const r of geo.rects) c += `${pdfNum(X(r[0]))} ${pdfNum(Y(r[1] + r[3]))} ${pdfNum(r[2] * k * PT)} ${pdfNum(r[3] * k * PT)} re\n`;
        if (geo.rects.length) c += "f\n";
        for (const t of geo.texts) {
          const size = t.fs * k * PT, natural = textW(t.s, t.bold, size), n = [...t.s].length;
          let tc = 0, width = natural;
          if (t.len && n > 1) { width = t.len * k * PT; tc = (width - natural) / (n - 1); }   // SVG textLength = even letter spacing
          c += `BT /F${t.bold ? 2 : 1} ${pdfNum(size)} Tf ${pdfNum(tc)} Tc ${pdfNum(X(t.x) - width / 2)} ${pdfNum(Y(t.y))} Td ${pdfStr(t.s)} Tj ET\n`;
        }
      });
      const content = add(`<< /Length ${c.length} >>\nstream\n${c}endstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(L.pw * PT)} ${pdfNum(L.ph * PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map(n => n + " 0 R").join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n", offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;      // all ASCII
    return new Blob([bytes], { type: "application/pdf" });
  }

  function downloadPdf() {
    buildPages();
    if (!items.some(i => i.ok) || layout.err) return;
    const n = items.filter(i => i.ok).length, labels = pages.reduce((a, p) => a + p.filter(Boolean).length, 0);
    const name = `labels-${FORMATS[fmtKey()].name.replace(/\W+/g, "").toLowerCase()}-${n}.pdf`;
    const paper = $("bpaper").value === "letter" ? "Letter" : "A4";
    dlFlow({
      icon: "fa-file-pdf",
      title: "Download PDF?",
      desc: `${labels} label${labels === 1 ? "" : "s"} on ${pages.length} ${paper} page${pages.length === 1 ? "" : "s"}, ready to print with no browser header or footer.`,
      files: [{ name, meta: `${pages.length} page${pages.length === 1 ? "" : "s"}` }],
      okLabel: "DOWNLOAD PDF",
      workTitle: "Building your PDF…",
      async run() {
        await nextFrame();
        save(name, buildPdf());
        return { message: "Your PDF was saved.", note: "Open it and print — no date, address or page number is added." };
      }
    });
  }

  /* ───────── mode switch (single ⇄ batch) ───────── */
  function setMode(mode) {
    const batch = mode === "batch";
    $("single").hidden = batch;
    $("batch").hidden = !batch;
    document.body.classList.toggle("mode-batch", batch);
    document.querySelectorAll("#modes .mode").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    store.set("bc-mode", mode);
    try { history.replaceState(null, "", batch ? "#batch" : location.pathname + location.search); } catch (e) { /* file:// or blocked */ }
    $("page-size").textContent = "";
    if (batch) { refresh(); requestAnimationFrame(fitPreview); }
    if (typeof queueJump === "function") queueJump();
    scrollTo(0, 0);
  }

  /* ───────── init ───────── */
  function init() {
    // format dropdown + layout dropdown (filled here, then enhanced like every other dropdown)
    $("bformat").innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${esc(f.name)} · ${esc(f.desc)}</option>`).join("");
    $("blayout").innerHTML = GRIDS.map(g => `<option value="${g[0]}">${g[0]} per page · ${g[1]}×${g[2]}</option>`).join("") +
      '<option value="custom">Custom · exact size</option>';
    customSelect($("bformat")); customSelect($("blayout"));
    document.querySelectorAll("#batch .sel-wrap select:not([data-lazy])").forEach(s => { if (!dropdowns.some(d => d.sel === s)) customSelect(s); });

    const saved = restore();
    const set = (id, v) => { if (v !== undefined && v !== null) $(id).value = v; };
    $("bformat").value = saved && FORMATS[saved.fmt] ? saved.fmt : (FORMATS[store.get("bc-format")] ? store.get("bc-format") : "ean13");
    applySeqDefaults(fmtKey());
    set("bs-count", 24); set("br-count", 24); set("bmargin", 8); set("bgap", 2); set("bcopies", 1); set("bstart", 1);
    set("bcols", 3); set("brows", 8); set("blw", 63.5); set("blh", 33.9);
    $("blayout").value = "24";
    if (saved) {
      if (saved.seq) { set("bs-prefix", saved.seq.prefix); set("bs-suffix", saved.seq.suffix); set("bs-start", saved.seq.start); set("bs-step", saved.seq.step); set("bs-pad", saved.seq.pad); }
      set("bs-count", saved.scount); set("br-count", saved.rcount); set("bpaper", saved.paper);
      if ([...$("blayout").options].some(o => o.value === saved.layout)) $("blayout").value = saved.layout;
      set("borient", saved.orient); set("bmargin", saved.margin); set("bgap", saved.gap); set("bcopies", saved.copies);
      set("bcols", saved.cols); set("brows", saved.rows); set("blw", saved.lw); set("blh", saved.lh);
      if (typeof saved.show === "boolean") $("bshowtext").checked = saved.show;
      if (typeof saved.guides === "boolean") $("bguides").checked = saved.guides;
      set("bheight", saved.height); set("bscale", saved.scale);
      $("blist").value = typeof saved.list === "string" ? saved.list : "";
    }
    if (!$("blist").value.trim()) $("blist").value = seqValues({ ...readSeq(), prefix: SEQ[fmtKey()] ? SEQ[fmtKey()][0] : "", suffix: "" }, 12).join("\n");   // first visit: a ready-made sample
    dropdowns.forEach(d => d.sync());
    els.ready = true;
    els.src = "list";
    setSrc(saved && ["list", "seq", "rand"].includes(saved.src) ? saved.src : "list");

    // events
    $("bsrc").addEventListener("click", e => { const b = e.target.closest(".cat"); if (b) setSrc(b.dataset.src); });
    $("bview").addEventListener("click", e => { const b = e.target.closest(".cat"); if (b) setView(b.dataset.view); });
    $("bformat").addEventListener("change", () => {
      applySeqDefaults(fmtKey());
      if (els.src === "rand" || randValues.length) randValues = randomSet(fmtKey(), intVal("br-count", 1, MAX_ITEMS, 24));
      svgCache.clear(); page = 0; queueRefresh();
    });
    ["blist", "bs-prefix", "bs-start", "bs-count", "bs-step", "bs-pad", "bs-suffix", "bmargin", "bgap", "bcopies", "bstart", "bcols", "brows", "blw", "blh"]
      .forEach(id => $(id).addEventListener("input", queueRefresh));
    ["bpaper", "blayout", "borient", "bheight", "bscale", "bshowtext", "bguides"].forEach(id => $(id).addEventListener("change", () => { page = 0; svgCache.clear(); queueRefresh(); }));
    $("br-count").addEventListener("input", queueSave);
    $("blist").addEventListener("input", () => renderTable(true));       // rows follow the typing at once, colours follow after validation
    $("blist").addEventListener("scroll", syncTable, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(() => renderTable(false)).observe($("bt-body"));
    $("br-go").onclick = () => { randValues = randomSet(fmtKey(), intVal("br-count", 1, MAX_ITEMS, 24)); restart($("br-go"), "spin"); refresh(); };
    $("bsample").onclick = () => { $("blist").value = seqValues({ ...readSeq(), prefix: SEQ[fmtKey()] ? SEQ[fmtKey()][0] : "", suffix: "" }, 12).join("\n"); queueRefresh(); };
    $("bclear").onclick = () => { $("blist").value = ""; $("blist").focus(); queueRefresh(); };
    $("bprev").onclick = () => { if (page > 0) { page--; renderSheet(); restart($("bsheet"), "flip"); } };
    $("bnext").onclick = () => { if (page < pages.length - 1) { page++; renderSheet(); restart($("bsheet"), "flip"); } };
    $("bprint").onclick = printLabels;
    $("bpdf").onclick = downloadPdf;
    $("bzip-png").onclick = () => exportZip("png");
    $("bzip-svg").onclick = () => exportZip("svg");
    $("modes").addEventListener("click", e => { const b = e.target.closest(".mode"); if (b) setMode(b.dataset.mode); });
    window.addEventListener("hashchange", () => { const m = location.hash === "#batch" ? "batch" : location.hash === "#single" ? "single" : null; if (m && m !== (isBatch() ? "batch" : "single")) setMode(m); });
    window.addEventListener("resize", () => requestAnimationFrame(fitPreview));
    if ("ResizeObserver" in window) new ResizeObserver(() => requestAnimationFrame(fitPreview)).observe($("bpreview"));
    window.batchRefresh = refresh;
    window.batchFillPrint = batchFillPrint;

    const hash = location.hash === "#batch" ? "batch" : location.hash === "#single" ? "single" : null;
    setMode(hash || (store.get("bc-mode") === "batch" ? "batch" : "single"));
  }

  init();
})();
