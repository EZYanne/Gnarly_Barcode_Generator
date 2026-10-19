"use strict";
/* ===================================================================
   ENCODERS — each returns { bits, quiet:[left,right], texts:[{x,s,w?}], value }
   bits  : string of modules, 1 = bar, 0 = space (1 module = narrowest bar)
   texts : human-readable text, x measured in modules from the first bar
   =================================================================== */

const digitsOnly = v => v.replace(/\D/g, "");
const inv = s => s.replace(/./g, b => 1 - b);

/* ---------- GS1 helpers (EAN-13, EAN-8, UPC-A, ITF-14) ---------- */
// Check digit: weights 3,1,3,1… counted from the right-most data digit.
function gs1check(d) {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += +d[d.length - 1 - i] * (i % 2 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}

// Accepts n-1 digits (check digit appended) or n digits (check digit verified).
function gtin(v, n, name) {
  if (!new RegExp(`^\\d{${n - 1},${n}}$`).test(v)) throw new Error(`${name}: enter ${n - 1} digits (check digit is added) or all ${n}.`);
  const c = gs1check(v.slice(0, n - 1));
  if (v.length === n && +v[n - 1] !== c) throw new Error(`Wrong check digit – it should be ${c}.`);
  return v.slice(0, n - 1) + c;
}

const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_P = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function ean13Bits(full) {                    // full = 13 digits; UPC-A reuses it as "0" + 12 digits
  const par = EAN_P[+full[0]];
  let b = "101";
  for (let i = 0; i < 6; i++) b += (par[i] === "L" ? EAN_L : EAN_G)[+full[i + 1]];
  b += "01010";
  for (let i = 7; i < 13; i++) b += inv(EAN_L[+full[i]]);
  return b + "101";
}

function ean13(v) {
  const f = gtin(v, 13, "EAN-13");
  return { bits: ean13Bits(f), quiet: [11, 7], value: f, texts: [
    { x: -5, s: f[0] }, { x: 24, s: f.slice(1, 7), w: 38 }, { x: 71, s: f.slice(7), w: 38 }] };
}

function upca(v) {
  const f = gtin(v, 12, "UPC-A");
  return { bits: ean13Bits("0" + f), quiet: [9, 9], value: f, texts: [
    { x: -5, s: f[0] }, { x: 27.5, s: f.slice(1, 6), w: 30 }, { x: 67.5, s: f.slice(6, 11), w: 30 }, { x: 100, s: f[11] }] };
}

function ean8(v) {
  const f = gtin(v, 8, "EAN-8");
  let b = "101";
  for (let i = 0; i < 4; i++) b += EAN_L[+f[i]];
  b += "01010";
  for (let i = 4; i < 8; i++) b += inv(EAN_L[+f[i]]);
  return { bits: b + "101", quiet: [8, 8], value: f, texts: [
    { x: 17, s: f.slice(0, 4), w: 24 }, { x: 50, s: f.slice(4), w: 24 }] };
}

/* ---------- Interleaved 2 of 5 / ITF-14 ---------- */
const ITF = ["00110","10001","01001","11000","00101","10100","01100","00011","10010","01010"]; // 1 = wide

function itfBits(d) {
  let b = "1010";                              // start: narrow bar, space, bar, space
  for (let i = 0; i < d.length; i += 2) {      // digit pair: first -> bars, second -> spaces
    const a = ITF[+d[i]], s = ITF[+d[i + 1]];
    for (let k = 0; k < 5; k++) b += (a[k] === "1" ? "111" : "1") + (s[k] === "1" ? "000" : "0");
  }
  return b + "11101";                          // stop: wide bar, narrow space, narrow bar
}

function itf(v) {
  if (!/^\d{2,30}$/.test(v) || v.length % 2) throw new Error("2 of 5: enter an even number of digits (2–30).");
  const bits = itfBits(v);
  return { bits, quiet: [10, 10], value: v, texts: [{ x: bits.length / 2, s: v }] };
}

function itf14(v) {
  const f = gtin(v, 14, "ITF-14");
  const bits = itfBits(f);
  return { bits, quiet: [10, 10], value: f, texts: [{ x: bits.length / 2, s: f }] };
}

/* ---------- Code 128 (full printable ASCII, digit runs packed with set C) ---------- */
const C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
"123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 " +
"131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 " +
"213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
"112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 " +
"421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(" ");

function widthsToBits(w) {
  let b = "", bar = true;
  for (const c of w) { b += (bar ? "1" : "0").repeat(+c); bar = !bar; }
  return b;
}

// Core Code 128 encoder. gs1 = true inserts the FNC1 symbol right after the start code and
// treats "\x1d" in the data as an FNC1 field separator (GS1-128).
function code128core(s, gs1) {
  const codes = [], n = s.length;
  let mode = null, i = 0;                      // mode: null | "B" | "C"
  const run = j => /^\d*/.exec(s.slice(j))[0].length;
  while (i < n) {
    if (s[i] === "\x1d") { codes.push(102); i++; continue; }   // FNC1 separator
    let r = run(i);
    if (r >= 4) {                              // long digit run: pack two digits per symbol
      if (mode !== "C") {
        if (r % 2) {                           // odd run: first digit goes in set B
          if (mode === null) codes.push(104);
          codes.push(16 + +s[i]); i++; r--;
          codes.push(99);
        } else codes.push(mode === null ? 105 : 99);
        mode = "C";
      }
      for (; r >= 2; r -= 2, i += 2) codes.push(+s.substr(i, 2));
    } else {
      if (mode !== "B") { codes.push(mode === null ? 104 : 100); mode = "B"; }
      codes.push(s.charCodeAt(i) - 32); i++;
    }
  }
  if (gs1) codes.splice(1, 0, 102);            // FNC1 in first position marks GS1-128
  let sum = codes[0];
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103, 106);
  return codes.map(c => widthsToBits(C128[c])).join("");
}

function code128(s) {
  if (!/^[\x20-\x7e]{1,40}$/.test(s)) throw new Error("Code 128: enter 1–40 letters, numbers or symbols.");
  const bits = code128core(s, false);
  return { bits, quiet: [10, 10], value: s, texts: [{ x: bits.length / 2, s }] };
}

/* ---------- Code 39 ---------- */
const C39_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*";
const C39 = ["101000111011101","111010001010111","101110001010111","111011100010101","101000111010111","111010001110101","101110001110101","101000101110111","111010001011101","101110001011101","111010100010111","101110100010111","111011101000101","101011100010111","111010111000101","101110111000101","101010001110111","111010100011101","101110100011101","101011100011101","111010101000111","101110101000111","111011101010001","101011101000111","111010111010001","101110111010001","101010111000111","111010101110001","101110101110001","101011101110001","111000101010111","100011101010111","111000111010101","100010111010111","111000101110101","100011101110101","100010101110111","111000101011101","100011101011101","100010001000101","100010001010001","100010100010001","101000100010001","1000101110111010"];

function code39(v) {
  v = v.toUpperCase();
  if (!/^[0-9A-Z\-. $\/+%]{1,30}$/.test(v)) throw new Error("Code 39: use A–Z, 0–9 and - . space $ / + % (1–30 characters).");
  const enc = c => C39[C39_CHARS.indexOf(c)];
  const bits = enc("*") + [...v].map(c => enc(c) + "0").join("") + enc("*");
  return { bits, quiet: [10, 10], value: v, texts: [{ x: bits.length / 2, s: v }] };
}

/* ---------- Codabar ---------- */
const CODABAR = {"0":"101010011","1":"101011001","2":"101001011","3":"110010101","4":"101101001","5":"110101001","6":"100101011","7":"100101101","8":"100110101","9":"110100101","-":"101001101","$":"101100101",":":"1101011011","/":"1101101011",".":"1101101101","+":"1011011011","A":"1011001001","B":"1001001011","C":"1010010011","D":"1010011001"};

function codabar(v) {
  v = v.toUpperCase();
  if (/^[0-9\-$:./+]{1,30}$/.test(v)) v = "A" + v + "A";           // default start/stop = A
  if (!/^[A-D][0-9\-$:./+]{1,30}[A-D]$/.test(v)) throw new Error("Codabar: use digits and - $ : . / + (optional A–D start/stop).");
  const bits = [...v].map(c => CODABAR[c]).join("0");
  return { bits, quiet: [10, 10], value: v, texts: [{ x: bits.length / 2, s: v.slice(1, -1) }] };
}

/* ---------- UPC-E (zero-suppressed UPC-A) ---------- */
// Parity pattern by [check digit][number system]; O = odd (L code), E = even (G code).
const UPCE_PAR = [["EEEOOO","OOOEEE"],["EEOEOO","OOEOEE"],["EEOOEO","OOEEOE"],["EEOOOE","OOEEEO"],["EOEEOO","OEOOEE"],["EOOEEO","OEEOOE"],["EOOOEE","OEEEOO"],["EOEOEO","OEOEOE"],["EOEOOE","OEOEEO"],["EOOEOE","OEEOEO"]];

function upceToUpca(ns, d) {                   // d = the 6 UPC-E digits; returns the 11-digit UPC-A body
  const l = +d[5];
  if (l <= 2) return ns + d[0] + d[1] + d[5] + "0000" + d[2] + d[3] + d[4];
  if (l === 3) return ns + d.slice(0, 3) + "00000" + d.slice(3, 5);
  if (l === 4) return ns + d.slice(0, 4) + "00000" + d[4];
  return ns + d.slice(0, 5) + "0000" + d[5];
}

function upce(v) {
  if (!/^\d{6,8}$/.test(v)) throw new Error("UPC-E: enter 7 digits (number system 0 or 1 + 6 digits) – check digit is added – or all 8.");
  let ns = "0", six = v, given;
  if (v.length > 6) {
    ns = v[0]; six = v.slice(1, 7); given = v[7];
    if (ns !== "0" && ns !== "1") throw new Error("UPC-E: the first digit (number system) must be 0 or 1.");
  }
  const c = gs1check(upceToUpca(ns, six));
  if (given !== undefined && +given !== c) throw new Error(`Wrong check digit – it should be ${c}.`);
  const par = UPCE_PAR[c][+ns];
  let b = "101";
  for (let i = 0; i < 6; i++) b += (par[i] === "O" ? EAN_L : EAN_G)[+six[i]];
  return { bits: b + "010101", quiet: [9, 9], value: ns + six + c, texts: [
    { x: -5, s: ns }, { x: 24, s: six, w: 34 }, { x: 56, s: String(c) }] };
}

/* ---------- EAN-5 / EAN-2 add-ons ---------- */
const EAN5_PAR = ["GGLLL","GLGLL","GLLGL","GLLLG","LGGLL","LLGGL","LLLGG","LGLGL","LGLLG","LLGLG"];
const EAN2_PAR = ["LL","LG","GL","GG"];

function addon(v, par) {
  let b = "1011";                              // start guard, then digits separated by "01"
  for (let i = 0; i < v.length; i++) b += (i ? "01" : "") + (par[i] === "L" ? EAN_L : EAN_G)[+v[i]];
  return { bits: b, quiet: [10, 6], value: v, texts: [{ x: b.length / 2, s: v }] };
}
function ean5(v) {
  if (!/^\d{5}$/.test(v)) throw new Error("EAN-5: enter exactly 5 digits.");
  const d = [...v].map(Number);
  return addon(v, EAN5_PAR[(3 * (d[0] + d[2] + d[4]) + 9 * (d[1] + d[3])) % 10]);
}
function ean2(v) {
  if (!/^\d{2}$/.test(v)) throw new Error("EAN-2: enter exactly 2 digits.");
  return addon(v, EAN2_PAR[+v % 4]);
}

/* ---------- ISBN / ISSN (printed as EAN-13) ---------- */
function isbn(v) {
  let f;
  if (/^\d{9}[\dX]?$/.test(v)) {               // ISBN-10 (check digit optional)
    let s = 0;
    for (let i = 0; i < 9; i++) s += +v[i] * (10 - i);
    const c = (11 - (s % 11)) % 11, ch = c === 10 ? "X" : String(c);
    if (v.length === 10 && v[9] !== ch) throw new Error(`Wrong ISBN-10 check digit – it should be ${ch}.`);
    const body = "978" + v.slice(0, 9);
    f = body + gs1check(body);
  } else if (/^\d{12,13}$/.test(v)) {          // ISBN-13
    if (!/^97[89]/.test(v)) throw new Error("ISBN-13 must start with 978 or 979.");
    f = gtin(v, 13, "ISBN-13");
  } else throw new Error("ISBN: enter 9–10 characters (ISBN-10, last may be X) or 12–13 digits (ISBN-13).");
  return ean13(f);
}

function issn(v) {
  if (!/^\d{7}[\dX]?$/.test(v)) throw new Error("ISSN: enter 7 digits (check digit is added) or 8 (last may be X).");
  let s = 0;
  for (let i = 0; i < 7; i++) s += +v[i] * (8 - i);
  const c = (11 - (s % 11)) % 11, ch = c === 10 ? "X" : String(c);
  if (v.length === 8 && v[7] !== ch) throw new Error(`Wrong ISSN check digit – it should be ${ch}.`);
  const body = "977" + v.slice(0, 7) + "00";    // 977 prefix + ISSN + 2-digit price code (00)
  return ean13(body + gs1check(body));
}

/* ---------- Code 93 (full ASCII through shift symbols) ---------- */
const C93_SYM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%abcd";   // a b c d = ($) (%) (/) (+) shifts
const C93_BIN = ["100010100","101001000","101000100","101000010","100101000","100100100","100100010","101010000","100010010","100001010","110101000","110100100","110100010","110010100","110010010","110001010","101101000","101100100","101100010","100110100","100011010","101011000","101001100","101000110","100101100","100010110","110110100","110110010","110101100","110100110","110010110","110011010","101101100","101100110","100110110","100111010","100101110","111010100","111010010","111001010","101101110","101110110","110101110","100100110","111011010","111010110","100110010","101011110"]; // 0-46 symbols, 47 = start/stop
const C93_ASCII = "bU|aA|aB|aC|aD|aE|aF|aG|aH|aI|aJ|aK|aL|aM|aN|aO|aP|aQ|aR|aS|aT|aU|aV|aW|aX|aY|aZ|bA|bB|bC|bD|bE| |cA|cB|cC|$|%|cF|cG|cH|cI|cJ|+|cL|-|.|/|0|1|2|3|4|5|6|7|8|9|cZ|bF|bG|bH|bI|bJ|bV|A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z|bK|bL|bM|bN|bO|bW|dA|dB|dC|dD|dE|dF|dG|dH|dI|dJ|dK|dL|dM|dN|dO|dP|dQ|dR|dS|dT|dU|dV|dW|dX|dY|dZ|bP|bQ|bR|bS|bT".split("|");

function code93(v) {
  if (!/^[\x20-\x7e]{1,30}$/.test(v)) throw new Error("Code 93: enter 1–30 letters, numbers or symbols.");
  const sym = [...v].flatMap(c => [...C93_ASCII[c.charCodeAt(0)]]);
  const val = s => C93_SYM.indexOf(s);
  const check = (arr, max) => {                // weighted mod-47 checksum, weights 1..max from the right
    let sum = 0;
    arr.slice().reverse().forEach((s, i) => { sum += val(s) * (i % max + 1); });
    return C93_SYM[sum % 47];
  };
  const c = check(sym, 20), k = check([...sym, c], 15);
  const bits = C93_BIN[47] + [...sym, c, k].map(s => C93_BIN[val(s)]).join("") + C93_BIN[47] + "1";
  return { bits, quiet: [10, 10], value: v, texts: [{ x: bits.length / 2, s: v }] };
}

/* ---------- MSI Plessey (Mod 10 check digit added) ---------- */
function msi(v) {
  if (!/^\d{1,20}$/.test(v)) throw new Error("MSI: enter 1–20 digits (a Mod 10 check digit is added).");
  let sum = 0;
  for (let i = 0; i < v.length; i++) {         // double every digit starting at the right-most
    const d = +v[v.length - 1 - i] * (i % 2 ? 1 : 2);
    sum += d > 9 ? d - 9 : d;
  }
  const full = v + (10 - (sum % 10)) % 10;
  let bits = "110";
  for (const ch of full) bits += (+ch).toString(2).padStart(4, "0").replace(/./g, b => (b === "0" ? "100" : "110"));
  bits += "1001";
  return { bits, quiet: [10, 10], value: full, texts: [{ x: bits.length / 2, s: full }] };
}

/* ---------- Pharmacode ---------- */
function pharmacode(v) {
  let z = +v;
  if (!/^\d{1,6}$/.test(v) || z < 3 || z > 131070) throw new Error("Pharmacode: enter a whole number from 3 to 131070.");
  let bits = "";                               // narrow bar = 1 module, wide bar = 3, gap = 2
  while (z > 0) {
    if (z % 2) { bits = "100" + bits; z = (z - 1) / 2; } else { bits = "11100" + bits; z = (z - 2) / 2; }
  }
  bits = bits.slice(0, -2);
  return { bits, quiet: [10, 10], value: String(+v), texts: [{ x: bits.length / 2, s: String(+v) }] };
}

/* ---------- Code 11 ---------- */
const C11 = { "0":"00001","1":"10001","2":"01001","3":"11000","4":"00101","5":"10100","6":"01100","7":"00011","8":"10010","9":"10000","-":"00100","S":"00110" }; // 1 = wide; S = start/stop

function code11(v) {
  if (!/^[0-9-]{1,20}$/.test(v)) throw new Error("Code 11: enter 1–20 digits or dashes (check digits are added).");
  const val = c => (c === "-" ? 10 : +c);
  const chk = (arr, max) => {
    let sum = 0;
    arr.slice().reverse().forEach((c, i) => { sum += val(c) * (i % max + 1); });
    return sum % 11;
  };
  const ch = n => (n === 10 ? "-" : String(n));
  let data = [...v];
  data.push(ch(chk(data, 10)));                // C check digit
  if (v.length >= 10) data.push(ch(chk(data, 9)));   // K check digit for longer codes
  const el = c => {
    let b = "", bar = true;
    for (const w of C11[c]) { b += (bar ? "1" : "0").repeat(w === "1" ? 3 : 1); bar = !bar; }
    return b;
  };
  const bits = ["S", ...data, "S"].map(el).join("0");
  return { bits, quiet: [10, 10], value: data.join(""), texts: [{ x: bits.length / 2, s: data.join("") }] };
}

/* ---------- GS1-128 (Application Identifiers in brackets) ---------- */
const AI_FIXED = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
const AI_VAR = { "10": 20, "21": 20, "30": 8, "37": 8, "240": 30, "241": 30, "400": 30, "420": 20, "421": 15 };

function gs1128(v) {
  if (!/^(\(\d{2,4}\)[^()\s]+)+$/.test(v))
    throw new Error("GS1-128: use bracketed AIs, e.g. (01)12345678901231(10)LOT42");
  const parts = [...v.matchAll(/\((\d{2,4})\)([^()]+)/g)];
  let data = "";
  parts.forEach(([, ai, d], i) => {
    if (AI_FIXED[ai]) {
      if (!/^\d+$/.test(d) || d.length !== AI_FIXED[ai]) throw new Error(`AI (${ai}) needs exactly ${AI_FIXED[ai]} digits.`);
      if (["00", "01", "02"].includes(ai) && +d[d.length - 1] !== gs1check(d.slice(0, -1)))
        throw new Error(`AI (${ai}): wrong check digit – it should be ${gs1check(d.slice(0, -1))}.`);
      data += ai + d;
    } else if (AI_VAR[ai]) {
      if (d.length > AI_VAR[ai]) throw new Error(`AI (${ai}) allows at most ${AI_VAR[ai]} characters.`);
      data += ai + d + (i < parts.length - 1 ? "\x1d" : "");   // FNC1 ends a variable-length field
    } else throw new Error(`AI (${ai}) is not supported here (supported: ${[...Object.keys(AI_FIXED), ...Object.keys(AI_VAR)].join(", ")}).`);
  });
  if (data.length > 70) throw new Error("GS1-128: data is too long (max 70 characters).");
  const bits = code128core(data, true);
  return { bits, quiet: [10, 10], value: v, texts: [{ x: bits.length / 2, s: v }] };
}

/* ---------- 2D symbols (QR, Data Matrix, PDF417, Aztec) via the bwip-js engine ---------- */
// The ~1 MB engine is only fetched the first time a 2D format is chosen.
const BWIP_SRC = "assets/js/vendor/bwip-js.min.js";
let bwipState = typeof bwipjs !== "undefined" ? "ready" : "idle";      // idle | loading | ready | failed
let onBwipReady = () => {};

function need2d() {
  if (bwipState === "ready") return;
  if (bwipState === "failed") throw new Error("The 2D engine failed to load – check that " + BWIP_SRC + " exists.");
  if (bwipState === "idle") {
    bwipState = "loading";
    const sc = document.createElement("script");
    sc.src = BWIP_SRC;
    sc.onload = () => { bwipState = "ready"; onBwipReady(); };
    sc.onerror = () => { bwipState = "failed"; onBwipReady(); };
    document.head.appendChild(sc);
  }
  const e = new Error("loading"); e.loading = true; throw e;
}

function twoD(id, name, quiet, mult, extra) {
  return v => {
    if (!/^[\x20-\x7e]{1,200}$/.test(v)) throw new Error(`${name}: enter 1–200 letters, numbers or symbols.`);
    need2d();
    let r;
    try { r = bwipjs.raw({ bcid: id, text: v, ...extra })[0]; }
    catch (err) { throw new Error(`${name}: ${String(err.message || err).replace(/^.*?:\s*/, "")}`); }
    const cols = r.pixx, nrows = r.pixs.length / cols, rep = Math.max(1, Math.round(r.pixy / nrows));
    const rows = [];
    for (let y = 0; y < nrows; y++) rows.push(r.pixs.slice(y * cols, (y + 1) * cols).join(""));
    return { rows, cols, rep, quiet: [quiet, quiet], qv: quiet, mult, value: v,
      texts: v.length <= 40 ? [{ x: cols / 2, s: v }] : [] };
  };
}
const qrcode = twoD("qrcode", "QR Code", 4, 3, { eclevel: "M" });
const datamatrix = twoD("datamatrix", "Data Matrix", 2, 3, {});
const pdf417 = twoD("pdf417", "PDF417", 2, 1, {});
const azteccode = twoD("azteccode", "Aztec", 2, 3, {});

/* ===================================================================
   FORMAT CATALOGUE (drives the picker, input rules and auto-generate)
   cat: which picker tab the card lives in · height: bar-height setting applies · numeric: digit keypad
   =================================================================== */
const randDigits = n => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, x => x % 10).join("");
};
const num = max => v => digitsOnly(v).slice(0, max);
const ascii = max => v => v.replace(/[^\x20-\x7e]/g, "").slice(0, max);
const gtin14 = () => { const b = "1" + randDigits(12); return b + gs1check(b); };

const CATS = { retail: "RETAIL", industrial: "INDUSTRIAL", special: "SPECIALTY", twod: "2D CODES" };

const FORMATS = {
  // ── Retail ──
  ean13:   { cat: "retail", height: 1, numeric: 1, name: "EAN-13",  icon: "fa-cart-shopping", desc: "Retail products worldwide",    hint: "12 digits – the check digit is added for you (or type all 13).", ph: "201234567890",  max: 13, clean: num(13), gen: () => "20" + randDigits(10), encode: ean13 },
  upca:    { cat: "retail", height: 1, numeric: 1, name: "UPC-A",   icon: "fa-store",         desc: "Retail in USA & Canada",       hint: "11 digits – the check digit is added for you (or type all 12).", ph: "21234567890",   max: 12, clean: num(12), gen: () => "2" + randDigits(10),  encode: upca },
  ean8:    { cat: "retail", height: 1, numeric: 1, name: "EAN-8",   icon: "fa-box",           desc: "Small retail packages",        hint: "7 digits – the check digit is added for you (or type all 8).",   ph: "2123456",       max: 8,  clean: num(8),  gen: () => "2" + randDigits(6),   encode: ean8 },
  upce:    { cat: "retail", height: 1, numeric: 1, name: "UPC-E",   icon: "fa-compress",      desc: "Compressed UPC for tiny packs", hint: "7 digits: number system 0 or 1 + 6 digits (check added), or all 8.", ph: "0123456",     max: 8,  clean: num(8),  gen: () => "0" + randDigits(6),   encode: upce },
  isbn:    { cat: "retail", height: 1, numeric: 0, name: "ISBN",    icon: "fa-book",          desc: "Books (ISBN-10 or ISBN-13)",   hint: "ISBN-10 (last may be X) or ISBN-13 starting 978/979 – dashes are ignored.", ph: "978030640615", max: 13, clean: v => v.toUpperCase().replace(/[^0-9X]/g, "").slice(0, 13), gen: () => "978" + randDigits(9), encode: isbn },
  issn:    { cat: "retail", height: 1, numeric: 0, name: "ISSN",    icon: "fa-newspaper",     desc: "Magazines & journals",         hint: "7 digits – the check digit is added – or all 8 (last may be X).", ph: "0317847",      max: 8,  clean: v => v.toUpperCase().replace(/[^0-9X]/g, "").slice(0, 8), gen: () => randDigits(7), encode: issn },
  ean5:    { cat: "retail", height: 1, numeric: 1, name: "EAN-5",   icon: "fa-tag",           desc: "Book price add-on",            hint: "Exactly 5 digits (price add-on, e.g. 52495 = $24.95).",           ph: "52495",         max: 5,  clean: num(5),  gen: () => randDigits(5),         encode: ean5 },
  ean2:    { cat: "retail", height: 1, numeric: 1, name: "EAN-2",   icon: "fa-calendar-day",  desc: "Magazine issue add-on",        hint: "Exactly 2 digits (issue number).",                                ph: "05",            max: 2,  clean: num(2),  gen: () => randDigits(2),         encode: ean2 },
  // ── Industrial ──
  code128: { cat: "industrial", height: 1, numeric: 0, name: "Code 128", icon: "fa-barcode",    desc: "Shipping, logistics, SKUs",    hint: "Letters, numbers and symbols, up to 40 characters.",              ph: "GNR-0001",      max: 40, clean: ascii(40), gen: () => randDigits(12), encode: code128 },
  gs1128:  { cat: "industrial", height: 1, numeric: 0, name: "GS1-128",  icon: "fa-truck-ramp-box", desc: "Pallet & shipping labels", hint: "Bracketed AIs, e.g. (01)GTIN-14 (17)YYMMDD (10)LOT. Check digits are verified.", ph: "(01)12345678901231(10)LOT42", max: 70, clean: v => v.replace(/[^\x21-\x7e]/g, "").slice(0, 70), gen: () => `(01)${gtin14()}(10)${randDigits(6)}`, encode: gs1128 },
  code39:  { cat: "industrial", height: 1, numeric: 0, name: "Code 39",  icon: "fa-industry",   desc: "Industrial & inventory",       hint: "A–Z, 0–9 and - . space $ / + %, up to 30 characters.",            ph: "GNR0001",       max: 30, clean: v => v.toUpperCase().replace(/[^0-9A-Z\-. $\/+%]/g, "").slice(0, 30), gen: () => randDigits(10), encode: code39 },
  code93:  { cat: "industrial", height: 1, numeric: 0, name: "Code 93",  icon: "fa-grip-lines-vertical", desc: "Compact, full ASCII", hint: "Letters, numbers and symbols, up to 30 characters (two check characters added).", ph: "GNR-0001", max: 30, clean: ascii(30), gen: () => randDigits(10), encode: code93 },
  itf14:   { cat: "industrial", height: 1, numeric: 1, name: "ITF-14",   icon: "fa-pallet",     desc: "Cartons & wholesale cases",    hint: "13 digits – the check digit is added for you (or type all 14).", ph: "1234567890123", max: 14, clean: num(14), gen: () => "1" + randDigits(12),  encode: itf14 },
  itf:     { cat: "industrial", height: 1, numeric: 1, name: "2 of 5",   icon: "fa-warehouse",  desc: "Interleaved 2 of 5, digits",   hint: "An even number of digits, 2–30.",                                 ph: "1234567890",    max: 30, clean: num(30), gen: () => randDigits(10),        encode: itf },
  // ── Specialty ──
  codabar: { cat: "special", height: 1, numeric: 0, name: "Codabar", icon: "fa-book-medical",  desc: "Libraries, labs, blood banks", hint: "Digits and - $ : . / + (start/stop A is added, or type A–D yourself).", ph: "1234567890", max: 32, clean: v => v.toUpperCase().replace(/[^0-9A-D\-$:./+]/g, "").slice(0, 32), gen: () => randDigits(10), encode: codabar },
  msi:     { cat: "special", height: 1, numeric: 1, name: "MSI",     icon: "fa-boxes-stacked", desc: "Warehouse & shelf labels",     hint: "1–20 digits – a Mod 10 check digit is added.",                    ph: "123456789",     max: 20, clean: num(20), gen: () => randDigits(9),         encode: msi },
  pharma:  { cat: "special", height: 1, numeric: 1, name: "Pharmacode", icon: "fa-pills",      desc: "Pharmaceutical packaging",     hint: "A whole number from 3 to 131070.",                                ph: "12345",         max: 6,  clean: num(6),  gen: () => String(3 + (+randDigits(7) % 131068)), encode: pharmacode },
  code11:  { cat: "special", height: 1, numeric: 0, name: "Code 11", icon: "fa-tower-cell",    desc: "Telecom equipment",            hint: "Digits and dashes, up to 20 (one or two check digits are added).", ph: "123-45",       max: 20, clean: v => v.replace(/[^0-9-]/g, "").slice(0, 20), gen: () => randDigits(8), encode: code11 },
  // ── 2D ──
  qr:      { cat: "twod", height: 0, numeric: 0, name: "QR Code",     icon: "fa-qrcode",       desc: "Phones, links, payments",      hint: "Any text or numbers, up to 200 characters.",                      ph: "https://example.com", max: 200, clean: ascii(200), gen: () => randDigits(12), encode: qrcode },
  datamatrix: { cat: "twod", height: 0, numeric: 0, name: "Data Matrix", icon: "fa-border-all", desc: "Tiny parts & electronics", hint: "Any text or numbers, up to 200 characters.",                      ph: "GNR-0001",      max: 200, clean: ascii(200), gen: () => randDigits(12), encode: datamatrix },
  pdf417:  { cat: "twod", height: 0, numeric: 0, name: "PDF417",      icon: "fa-id-card",      desc: "IDs & boarding passes",        hint: "Any text or numbers, up to 200 characters.",                      ph: "GNR-0001",      max: 200, clean: ascii(200), gen: () => randDigits(12), encode: pdf417 },
  aztec:   { cat: "twod", height: 0, numeric: 0, name: "Aztec",       icon: "fa-ticket",       desc: "Transit & event tickets",      hint: "Any text or numbers, up to 200 characters.",                      ph: "GNR-0001",      max: 200, clean: ascii(200), gen: () => randDigits(12), encode: azteccode }
};

/* ===================================================================
   SVG RENDERING (units = modules; integer pixel scale keeps bars crisp)
   1D symbols use e.bits; 2D symbols use e.rows (each row repeated e.rep times).
   =================================================================== */
const TEXT_H = 14;
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(key, raw, o) {
  const e = FORMATS[key].encode(raw), [ql, qr] = e.quiet;
  const is2d = !!e.rows, u = 1 / (e.mult || 1);                  // u keeps text the same pixel size on 2D symbols
  const symW = is2d ? e.cols : e.bits.length;
  const barH = is2d ? e.rows.length * e.rep + 2 * e.qv : o.height;
  const showText = o.text && e.texts.length;
  const padT = is2d ? 0 : 6;                                      // white margin above 1D bars (2D has its own quiet zone)
  const H = padT + barH + (showText ? (TEXT_H + 3) * u : (is2d ? 0 : 6));   // room for the text (or a bottom margin)
  const W = symW + ql + qr;
  const px = o.scale * (e.mult || 1);                              // pixels per module
  let rects = "";
  if (is2d) {
    e.rows.forEach((row, y) => {
      for (let i = 0; i < row.length;) {
        if (row[i] === "0") { i++; continue; }
        let j = i; while (row[j] === "1") j++;
        rects += `<rect x="${ql + i}" y="${padT + e.qv + y * e.rep}" width="${j - i}" height="${e.rep}"/>`;
        i = j;
      }
    });
  } else {
    for (let i = 0; i < e.bits.length;) {                          // merge each run of bars into one rect
      if (e.bits[i] === "0") { i++; continue; }
      let j = i; while (e.bits[j] === "1") j++;
      rects += `<rect x="${ql + i}" y="${padT}" width="${j - i}" height="${barH}"/>`;
      i = j;
    }
  }
  const text = showText ? e.texts.map(t =>
    `<text x="${ql + t.x}" y="${padT + barH + 11 * u}" text-anchor="middle"${t.w ? ` textLength="${t.w}" lengthAdjust="spacing"` : ""}>${esc(t.s)}</text>`).join("") : "";
  return {
    value: e.value, hasText: !!showText, modules: is2d ? `${e.cols}×${e.rows.length}` : e.bits.length,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * px}" height="${H * px}">` +
      `<rect width="${W}" height="${H}" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects}</g>` +
      `<g fill="#000" font-family="Arial,Helvetica,sans-serif" font-size="${10 * u}">${text}</g></svg>`
  };
}

/* ===================================================================
   UI
   =================================================================== */
const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: ignore */ } }
};
let fmt = FORMATS[store.get("bc-format")] ? store.get("bc-format") : "ean13";
let current = null;                              // last successful render

// Picker: category tabs + one panel per category. All panels share one grid cell, so the
// picker is always as tall as the biggest category and the page never jumps when switching.
$("cats").innerHTML = Object.entries(CATS).map(([c, label]) =>
  `<button type="button" class="cat" role="tab" data-cat="${c}" aria-selected="false">${label}</button>`).join("");
$("formats").innerHTML = Object.keys(CATS).map(c =>
  `<div class="cat-panel" data-cat="${c}">` + Object.entries(FORMATS).filter(([, f]) => f.cat === c).map(([k, f], i) =>
    `<label class="fmt" style="--i:${i}"><input type="radio" name="fmt" value="${k}"><span class="fmt-body">` +
    `<i class="fa-solid ${f.icon}"></i><b>${f.name}</b><small>${f.desc}</small></span></label>`).join("") + `</div>`).join("");

function showCat(c) {
  document.querySelectorAll(".cat").forEach(b => {
    const on = b.dataset.cat === c;
    b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on);
    b.classList.toggle("has-pick", b.dataset.cat === FORMATS[fmt].cat);   // dot marks the tab holding the chosen format
  });
  document.querySelectorAll(".cat-panel").forEach(p => p.classList.toggle("is-active", p.dataset.cat === c));
}

// Animation helpers: restart a CSS animation class on demand (barcode reveal, KPI flash, button icon spin)
let animateNext = false;                         // set when the barcode was just generated / format changed
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

const opts = () => ({ scale: +$("scale").value, height: +$("height").value, text: $("showtext").checked });
onBwipReady = () => draw();                      // 2D engine finished loading (or failed): redraw

function draw() {
  const f = FORMATS[fmt], inp = $("num"), twod = f.cat === "twod";
  inp.value = f.clean(inp.value);
  $("count").textContent = `${inp.value.length}/${f.max}`;
  $("encoded").textContent = "—"; $("modules").textContent = "—";
  try {
    if (!inp.value) throw null;
    current = render(fmt, inp.value, opts());
    $("out").innerHTML = current.svg;
    if (animateNext) { restart($("out"), "reveal"); document.querySelectorAll(".kpi-val").forEach(k => restart(k, "flash")); animateNext = false; }
    $("msg").textContent = "";
    $("encoded").textContent = current.value; $("modules").textContent = current.modules;
  } catch (e) {
    current = null;
    if (e && e.loading) {
      $("out").innerHTML = `<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>LOADING 2D ENGINE…</div>`;
      $("msg").textContent = "";
    } else {
      $("out").innerHTML = `<div class="empty"><i class="fa-solid ${twod ? "fa-qrcode" : "fa-barcode"}"></i>${e ? "WAITING FOR VALID INPUT" : "TYPE OR AUTO-GENERATE A NUMBER"}</div>`;
      $("msg").textContent = e ? e.message : "";
    }
  }
  for (const id of ["png", "svg", "prt", "cpy"]) $(id).disabled = !current;
}

function selectFormat(k, generate) {
  fmt = k; store.set("bc-format", k);
  const f = FORMATS[k], twod = f.cat === "twod";
  document.querySelector(`input[name=fmt][value="${k}"]`).checked = true;
  showCat(f.cat);
  $("hint").textContent = f.hint; $("num").placeholder = f.ph;
  $("num").inputMode = f.numeric ? "numeric" : "text";
  $("scale-label").textContent = twod ? "Module size" : "Bar width";
  $("modules-label").textContent = twod ? "Grid (cols×rows)" : "Bar modules";
  $("height").disabled = !f.height;              // bar height does not apply to 2D symbols
  dropdowns.forEach(d => d.sync());
  if (generate) { $("num").value = f.gen(); animateNext = true; }
  draw();
}

function toast(msg, error) {
  const t = $("toast");
  t.innerHTML = `<i class="fa-solid ${error ? "fa-triangle-exclamation" : "fa-circle-check"}"></i> ${msg}`;
  t.className = "toast show" + (error ? " error" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = "toast"), 2200);
}

// Save one file (callers show a single toast for the whole batch).
function save(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// What printing and exporting produce, driven by the "Show number" checkbox:
//   unchecked -> just the barcode alone (1 page / 1 file)
//   checked   -> the barcode with its number, then the barcode alone (2 pages / 2 files)
// If the symbol has no text to show (e.g. a long 2D payload) both versions would be identical, so only one is returned.
function variants() {
  const o = opts(), v = $("num").value;
  const plain = { tag: "", svg: render(fmt, v, { ...o, text: false }).svg };
  if (!o.text) return [plain];
  const withNum = render(fmt, v, { ...o, text: true });
  if (!withNum.hasText) return [plain];
  return [{ tag: "-with-number", svg: withNum.svg }, { tag: "-barcode-only", svg: plain.svg }];
}

// Print sheets are built at print time (button or Ctrl+P): one page per version.
function fillPrint() {
  $("print-area").innerHTML = current ? variants().map(x => `<div class="sheet">${x.svg}</div>`).join("") : "";
}
window.addEventListener("beforeprint", fillPrint);

const fileBase = () => `${FORMATS[fmt].name.replace(/\W+/g, "").toLowerCase()}-${current.value.replace(/\W+/g, "_").slice(0, 30)}`;

$("formats").addEventListener("change", e => selectFormat(e.target.value, true));
$("cats").addEventListener("click", e => { const b = e.target.closest(".cat"); if (b) showCat(b.dataset.cat); });
$("num").addEventListener("input", draw);
for (const id of ["scale", "height", "showtext"]) $(id).addEventListener("change", draw);
$("rnd").onclick = () => { $("num").value = FORMATS[fmt].gen(); animateNext = true; restart($("rnd"), "spin"); draw(); };
function svgToPng(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = 2, c = document.createElement("canvas");   // 2x keeps bar edges on whole pixels
      c.width = img.width * k; c.height = img.height * k;
      const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
      x.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => (b ? resolve(b) : reject(new Error("png"))));
    };
    img.onerror = () => reject(new Error("png"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// PNG / SVG download: two files (with number, barcode only).
async function exportFiles(ext) {
  if (!current) return;
  const base = fileBase(), list = variants();
  try {
    for (let i = 0; i < list.length; i++) {
      const blob = ext === "png" ? await svgToPng(list[i].svg) : new Blob([list[i].svg], { type: "image/svg+xml" });
      save(base + list[i].tag + "." + ext, blob);
      if (i < list.length - 1) await new Promise(r => setTimeout(r, 400));   // spacing so browsers accept the 2nd download
    }
    toast(list.length > 1 ? `2 ${ext.toUpperCase()} files downloaded` : `${base}.${ext} downloaded`);
  } catch (err) { toast("Could not create " + ext.toUpperCase(), true); }
}
$("svg").onclick = () => exportFiles("svg");
$("png").onclick = () => exportFiles("png");
$("prt").onclick = () => window.print();
$("cpy").onclick = () => {
  const done = () => toast("Number copied"), fail = () => toast("Copy blocked by browser", true);
  if (navigator.clipboard) navigator.clipboard.writeText(current.value).then(done, fail); else fail();
};

function setDark(on) {
  document.body.classList.toggle("dark-mode", on);
  $("dark").setAttribute("aria-checked", on);     // the switch's look is driven by this attribute
  store.set("bc-dark", on ? "1" : "0");
}

/* ---------- Theme change: pixel wave ----------
   A canvas of square "pixels" pops in as a wave spreading out from the switch, the theme is swapped
   while the screen is fully covered, then the pixels shrink away in the same wave. */
const PX_MS = 1150, PX_COVER = 0.58, PX_POP = 0.12;
let pixelBusy = false;

function makePixels(w, h, ox, oy, toDark) {
  const size = Math.max(16, Math.round(Math.max(w, h) / 44));
  const cols = Math.ceil(w / size), rows = Math.ceil(h / size);
  const far = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)) || 1;
  const base = toDark ? ["#0D0D0D", "#141416", "#1a1a1e", "#222228"] : ["#ffffff", "#f8f6f0", "#f0ede4", "#fffbe0"];
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot(c * size + size / 2 - ox, r * size + size / 2 - oy) / far;   // 0 at the switch .. 1 at the far corner
      const accent = Math.random() < 0.12;
      cells.push({
        x: c * size, y: r * size,
        s: d * 0.4 + Math.random() * 0.06,                  // when it pops in
        e: PX_COVER + d * 0.34 + Math.random() * 0.08,      // when it starts to go away
        color: accent ? (Math.random() < 0.5 ? "#E8C31A" : "#F5D84A") : base[(Math.random() * base.length) | 0]
      });
    }
  }
  return { cells, size };
}

// Paint the frame at progress t (0..1+). Squares grow from the centre of their cell and are snapped to whole pixels.
function drawPixelFrame(ctx, w, h, px, t) {
  ctx.clearRect(0, 0, w, h);
  for (const c of px.cells) {
    let k;
    if (t < c.s) continue;
    else if (t < c.s + PX_POP) k = (t - c.s) / PX_POP;
    else if (t < c.e) k = 1;
    else if (t < c.e + PX_POP) k = 1 - (t - c.e) / PX_POP;
    else continue;
    const sz = Math.ceil(px.size * k), off = Math.floor((px.size - sz) / 2);
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x + off, c.y + off, sz, sz);
  }
}

function pixelTransition(ox, oy, toDark, swap) {
  if (pixelBusy || matchMedia("(prefers-reduced-motion: reduce)").matches) { swap(); return; }
  const w = innerWidth, h = innerHeight, cv = document.createElement("canvas");
  cv.className = "px-fx"; cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d"), px = makePixels(w, h, ox, oy, toDark);
  document.body.appendChild(cv);
  pixelBusy = true;
  let swapped = false, t0 = null;
  const done = () => { cv.remove(); pixelBusy = false; if (!swapped) swap(); };
  const tick = now => {
    if (t0 === null) t0 = now;
    const t = (now - t0) / PX_MS;
    if (!swapped && t >= PX_COVER) { swapped = true; swap(); }     // screen is fully covered: change theme underneath
    if (t >= 1.2) { done(); return; }
    drawPixelFrame(ctx, w, h, px, t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

$("dark").onclick = () => {
  const sw = $("dark"), on = sw.getAttribute("aria-checked") !== "true", r = sw.getBoundingClientRect();
  sw.setAttribute("aria-checked", on);              // the switch itself responds instantly
  pixelTransition(r.left + r.width / 2, r.top + r.height / 2, on, () => setDark(on));
};
setDark(store.get("bc-dark") === "1");

/* ===================================================================
   CUSTOM DROPDOWN — themed listbox layered over a native <select>.
   The <select> stays in the DOM as the source of truth (value + change event),
   so the rest of the app and no-JS fallback keep working.
   =================================================================== */
const dropdowns = [];

function customSelect(sel) {
  const wrap = sel.closest(".sel-wrap");
  const label = document.querySelector(`label[for="${sel.id}"]`);
  const btn = document.createElement("button");
  const list = document.createElement("ul");
  const items0 = [...sel.options];
  let active = sel.selectedIndex, typed = "", typedTimer;

  btn.type = "button"; btn.className = "dd-btn";
  btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", sel.id + "-list");
  if (label) btn.setAttribute("aria-labelledby", label.id || (label.id = sel.id + "-lbl"));
  list.id = sel.id + "-list"; list.className = "dd-list"; list.setAttribute("role", "listbox"); list.tabIndex = -1;

  list.innerHTML = items0.map((o, i) => {
    const [main, sub] = o.textContent.split(" · ");
    return `<li class="dd-opt" role="option" id="${sel.id}-o${i}" data-i="${i}">` +
      `<span class="dd-main">${esc(main)}</span>${sub ? `<span class="dd-sub">${esc(sub)}</span>` : ""}` +
      `<i class="fa-solid fa-check dd-check"></i></li>`;
  }).join("");

  sel.classList.add("dd-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
  wrap.classList.add("is-custom");
  wrap.insertBefore(btn, sel.nextSibling); wrap.appendChild(list);
  if (label) label.addEventListener("click", e => { e.preventDefault(); btn.focus(); });

  const items = () => [...list.children];
  const isOpen = () => wrap.classList.contains("is-open");

  function paint() {
    btn.textContent = items0[sel.selectedIndex].textContent;
    items().forEach((li, i) => {
      li.classList.toggle("is-selected", i === sel.selectedIndex);
      li.classList.toggle("is-active", i === active);
      li.setAttribute("aria-selected", i === sel.selectedIndex);
    });
    btn.setAttribute("aria-activedescendant", isOpen() ? `${sel.id}-o${active}` : "");
  }
  function setActive(i) {
    active = (i + items0.length) % items0.length;
    paint(); items()[active].scrollIntoView({ block: "nearest" });
  }
  function open() {
    if (sel.disabled) return;
    dropdowns.forEach(d => d !== api && d.close());
    wrap.classList.add("is-open"); btn.setAttribute("aria-expanded", "true");
    wrap.classList.remove("dd-up", "dd-right");           // flip when there is no room below / to the right
    const r = btn.getBoundingClientRect(), h = list.offsetHeight, w = list.offsetWidth;
    if (r.bottom + h + 8 > innerHeight && r.top > h + 8) wrap.classList.add("dd-up");
    if (r.left + w > innerWidth - 8 && r.right - w >= 8) wrap.classList.add("dd-right");
    active = sel.selectedIndex; paint();
  }
  function close() { wrap.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false"); paint(); }
  function choose(i) {
    close();
    if (i !== sel.selectedIndex) { sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    paint(); btn.focus();
  }

  btn.addEventListener("click", () => (isOpen() ? close() : open()));
  btn.addEventListener("keydown", e => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (!isOpen()) open(); else setActive(active + (k === "ArrowDown" ? 1 : -1));
    } else if (k === "Home" || k === "End") {
      if (isOpen()) { e.preventDefault(); setActive(k === "Home" ? 0 : items0.length - 1); }
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (isOpen()) choose(active); else open();
    } else if (k === "Escape") {
      if (isOpen()) { e.preventDefault(); close(); }
    } else if (k === "Tab") {
      if (isOpen()) close();
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {   // type-ahead
      typed += k.toLowerCase(); clearTimeout(typedTimer); typedTimer = setTimeout(() => (typed = ""), 600);
      const hit = items0.findIndex(o => o.textContent.toLowerCase().startsWith(typed));
      if (hit >= 0) { if (isOpen()) setActive(hit); else choose(hit); }
    }
  });
  list.addEventListener("pointermove", e => {
    const li = e.target.closest(".dd-opt");
    if (li && +li.dataset.i !== active) { active = +li.dataset.i; paint(); }
  });
  list.addEventListener("mousedown", e => e.preventDefault());         // keep focus on the button
  list.addEventListener("click", e => { const li = e.target.closest(".dd-opt"); if (li) choose(+li.dataset.i); });
  btn.addEventListener("blur", () => setTimeout(() => { if (!wrap.contains(document.activeElement)) close(); }, 0));

  // sync(): mirror the native <select>'s disabled state onto the custom control
  const api = { close, sync() { close(); btn.disabled = sel.disabled; wrap.classList.toggle("is-disabled", sel.disabled); } };
  dropdowns.push(api);
  paint();
}

document.addEventListener("pointerdown", e => dropdowns.forEach(d => { if (!e.target.closest(".sel-wrap.is-open")) d.close(); }));
document.querySelectorAll(".sel-wrap select").forEach(customSelect);

selectFormat(fmt, true);
