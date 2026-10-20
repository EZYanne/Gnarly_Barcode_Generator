# GNARLY! PH — Barcode Generator

A fast, offline-capable barcode and QR-code generator. Pure HTML, CSS and JavaScript — **no server, no database, no PHP**.

## Features

- **23 formats** — EAN-13, UPC-A, EAN-8, UPC-E, ISBN, ISSN, EAN-5, EAN-2, Code 128, Letters (names / asset tags such as `ANCHOR2XS`), GS1-128, Code 39, Code 93, ITF-14, 2 of 5, Codabar, MSI, Pharmacode, Code 11, QR Code, Data Matrix, PDF417, Aztec.
- **Single mode** — pick a format, type or auto-generate a number (check digits added/verified), preview, then download PNG/SVG, print, or copy.
- **Batch & Labels mode**
  - Values from a pasted **list**, a **sequence** (prefix + start + count + step + zero-padding + suffix, e.g. `GNR-0001 … GNR-0050`) or a **random** set.
  - Live validation per value, with the reason when one is wrong.
  - **Label sheets**: 1–65 labels per page on A4 or Letter (portrait / landscape), custom grid with exact label size, margin, gap, copies per value, "start at label" for partly used sheets, optional cut guides, page-by-page preview.
  - **Print** the sheets, or download everything as a **ZIP** of PNG or SVG files.
- **Install & offline** — installable as an app (Chrome/Edge/Android: "Install" button; iPhone/iPad: Share → Add to Home Screen). After the first visit everything works without internet: fonts, icons and the 2D-code engine are all bundled.
- Light / dark theme, responsive from 280 px phones to desktop, keyboard and screen-reader friendly, honours "reduce motion".

## Run it

Any static web server works (it is only files):

```
XAMPP:        put the folder in htdocs  →  http://localhost/barcode_system/
Python:       python -m http.server 8000   →  http://localhost:8000/
GitHub Pages: push the folder, enable Pages → https://<user>.github.io/<repo>/
```

Install-as-app and offline mode need **HTTPS or localhost** (a browser rule). On a plain `http://192.168.x.x` address the page still works, just without install/offline.

## Folder layout

```
index.html              the only file outside assets/
assets/
  .htaccess             Apache: always revalidate css/js, allow the offline helper to cover the app (ignored by GitHub Pages)
  css/                  style.css (all styling) · fonts.css (self-hosted fonts)
  js/                   script.js (encoders, single mode, theme) · batch.js (batch & labels) · modal.js (download dialog) · pwa.js
  pwa/                  manifest.webmanifest (install support) · sw.js (offline helper)
  vendor/               bwip-js (QR / Data Matrix / PDF417 / Aztec, loaded only when needed) · fontawesome
  docs/                 this README
  fonts/  icons/  img/  (img/originals = source artwork)
```

## Updating (important after you change a file)

1. In `index.html` bump the `?v=` number on the changed CSS/JS file.
2. In `assets/pwa/sw.js` change `VERSION` (for example `bc-v2`) so installed copies refresh.
   If you add a file the app needs offline, add it to the `CORE` list in `assets/pwa/sw.js`.

## Notes

- Offline mode: `assets/pwa/sw.js` needs the `Service-Worker-Allowed: /` header, which `assets/.htaccess` sends on Apache/XAMPP. GitHub Pages cannot send it, so there copy `assets/pwa/sw.js` to the root as `sw.js` and change its `ROOT` line to `new URL("./", self.location.href).href`; the page already falls back to it. Everything else works without it.

- Barcodes are always drawn black on white with the quiet zones scanners need. Printed numbers use the standard layout for each format.
- Needs a browser from about 2021 or newer (Chrome/Edge 84+, Safari/iOS 14.5+, Firefox 90+).

## Credits and licenses

- [bwip-js](https://github.com/metafloor/bwip-js) (MIT) — 2D symbols. License in `assets/vendor/bwip-js/`.
- [Font Awesome Free 6.7.2](https://fontawesome.com) — icons CC BY 4.0, fonts SIL OFL 1.1, code MIT. License in `assets/vendor/fontawesome/`.
- Bebas Neue, Space Grotesk, IBM Plex Mono via [Fontsource](https://fontsource.org) — SIL Open Font License 1.1. Licenses in `assets/fonts/`.
