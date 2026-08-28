// Repairs Hindi strings that the upstream translation sheet delivers as mojibake
// from a legacy non-Unicode Devanagari font (see hi-pua-repair.json for the
// suspected font family and the codepoint table).
//
// WHY THIS IS NOT A PLAIN SEARCH-AND-REPLACE
// ------------------------------------------
// Legacy 8-bit Devanagari fonts store text in VISUAL order; Unicode stores it in
// LOGICAL order. Two marks are affected:
//
//   * the short-i matra `ि` renders to the LEFT of its consonant, so the legacy
//     stream holds it BEFORE that consonant — Unicode wants it after the
//     consonant's whole cluster.  ...ि ट ्र...  →  ...ट ्र ि...   (इलेक्ट्रिक)
//   * repha `र्` renders as a hook ABOVE the consonant that FOLLOWS it, so the
//     legacy stream holds it AFTER that consonant — Unicode wants it before.
//     पाट र्  →  पा र् ट   (पार्टनर)
//
// Substituting in place would produce `िसनोह` and `पाटर्नर`: valid codepoints,
// nonsense words, and nothing an Indic shaper would render as intended. So each
// table entry carries a placement `kind` and we reorder at the akshara level.
//
// The repair is a strict no-op when no changes are needed (no PUA substitutions
// and no stray visually-ordered `ि` to reorder), so it disappears once upstream ships real Unicode.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TABLE = JSON.parse(
  readFileSync(resolve(__dirname, "hi-pua-repair.json"), "utf8")
);

const VIRAMA = "्";
const NUKTA = "़";
const MATRA_I = "ि";

const isPua = (cp) =>
  (cp >= 0xe000 && cp <= 0xf8ff) ||
  (cp >= 0xf0000 && cp <= 0xffffd) ||
  (cp >= 0x100000 && cp <= 0x10fffd);

export const hex = (ch) =>
  "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

// Devanagari consonants, incl. the precomposed nukta forms (क़..य़) and the
// extended-for-Sindhi/Kashmiri block. Independent vowels are deliberately NOT
// consonants here: a matra never attaches to one.
function isConsonant(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x0915 && c <= 0x0939) ||
    (c >= 0x0958 && c <= 0x095f) ||
    (c >= 0x0978 && c <= 0x097f)
  );
}

// Dependent signs: matras, anusvara/candrabindu/visarga, nukta, virama, accents.
function isCombiningMark(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x0900 && c <= 0x0903) ||
    (c >= 0x093a && c <= 0x093c) ||
    (c >= 0x093e && c <= 0x094f) ||
    (c >= 0x0951 && c <= 0x0957) ||
    (c >= 0x0962 && c <= 0x0963)
  );
}

// Index just past the akshara beginning at `start`: a consonant, its nukta, and
// any `virama + consonant` conjunct tail (so `ट ् र` is consumed whole and the
// matra lands after the ra-phala, not inside the cluster).
function endOfAkshara(units, start) {
  const at = (i) => (units[i] && units[i].k === "c" ? units[i].v : null);
  let j = start;
  if (!at(j) || !isConsonant(at(j))) return -1;
  j++;
  if (at(j) === NUKTA) j++;
  while (at(j) === VIRAMA && at(j + 1) && isConsonant(at(j + 1))) {
    j += 2;
    if (at(j) === NUKTA) j++;
  }
  return j;
}

// Index of the first character of the akshara ending at `end`, walking back over
// dependent marks and any `consonant + virama` conjunct head, so a repha lands
// in front of the complete cluster.
function startOfAkshara(units, end) {
  const at = (i) => (units[i] && units[i].k === "c" ? units[i].v : null);
  let j = end;
  while (j >= 0 && at(j) && isCombiningMark(at(j))) j--;
  if (j < 0 || !at(j) || !isConsonant(at(j))) return -1;
  while (j - 2 >= 0 && at(j - 1) === VIRAMA && at(j - 2) && isConsonant(at(j - 2))) {
    j -= 2;
  }
  return j;
}

// A `ि` is misplaced when it does not sit directly behind a consonant (allowing
// an intervening nukta). That happens when the sheet's legacy slot for one of
// the matra's width variants happened to land on the real codepoint instead of a
// private-use one — `स् ि प` in मैक्सस्पिरिट. Correctly-ordered text never trips
// this, which is what keeps the pass safe to run unconditionally.
function isMisplacedMatraI(units, i) {
  let j = i - 1;
  if (units[j] && units[j].k === "c" && units[j].v === NUKTA) j--;
  const prev = units[j];
  return !(prev && prev.k === "c" && isConsonant(prev.v));
}

function toUnits(str, entries, onUnmapped) {
  const units = [];
  let touched = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (!isPua(cp)) {
      units.push({ k: "c", v: ch });
      continue;
    }
    const entry = entries[hex(ch)];
    if (!entry) {
      onUnmapped(hex(ch));
      units.push({ k: "c", v: ch }); // keep it, so assertNoPuaSurvives() sees it
      continue;
    }
    touched = true;
    if (entry.kind === "prebase") units.push({ k: "pre", v: entry.to });
    else if (entry.kind === "repha") units.push({ k: "repha", v: entry.to });
    else for (const c of entry.to) units.push({ k: "c", v: c });
  }
  for (let i = 0; i < units.length; i++) {
    if (units[i].k === "c" && units[i].v === MATRA_I && isMisplacedMatraI(units, i)) {
      units[i] = { k: "pre", v: MATRA_I };
      touched = true;
    }
  }
  return { units, touched };
}

// Move each pre-base matra to the far side of the akshara it precedes.
//
// Consecutive pre-base matras stack up in front of a run of consonants rather than
// alternating with them, so a run of N distributes one matra per following akshara:
// Fezandipiti arrives as फ़ेज़ं-[ि][ि]-ड-प-ट-ी and has to come out as फ़ेज़ंडिपिटी,
// not फ़ेज़ंिडिपटी.
function applyPrebase(units) {
  const out = [];
  for (let i = 0; i < units.length; i++) {
    if (units[i].k !== "pre") {
      out.push(units[i]);
      continue;
    }
    let runEnd = i;
    while (runEnd < units.length && units[runEnd].k === "pre") runEnd++;

    let cursor = runEnd;
    let placed = 0;
    for (let m = i; m < runEnd; m++) {
      const end = endOfAkshara(units, cursor);
      if (end === -1) break; // no consonant left to carry it
      for (let j = cursor; j < end; j++) out.push(units[j]);
      for (const c of units[m].v) out.push({ k: "c", v: c });
      cursor = end;
      placed++;
    }
    // Any matra with no consonant to attach to stays literal rather than being guessed at.
    for (let m = i + placed; m < runEnd; m++) {
      for (const c of units[m].v) out.push({ k: "c", v: c });
    }
    i = cursor - 1;
  }
  return out;
}

// Move each repha in front of the akshara it follows.
function applyRepha(units) {
  const out = [];
  for (const u of units) {
    if (u.k !== "repha") {
      out.push(u);
      continue;
    }
    const start = startOfAkshara(out, out.length - 1);
    if (start === -1) {
      for (const c of u.v) out.push({ k: "c", v: c });
      continue;
    }
    out.splice(start, 0, ...[...u.v].map((c) => ({ k: "c", v: c })));
  }
  return out;
}

/**
 * Repair one Hindi string. Returns the input unchanged when it holds no
 * private-use codepoints.
 *
 * @param {string} str
 * @param {(cp: string) => void} [onUnmapped] called with each unmapped PUA codepoint
 */
export function repairHindi(str, onUnmapped = () => {}) {
  if (typeof str !== "string" || !str) return str;

  const { units, touched } = toUnits(str, TABLE.entries, onUnmapped);
  // Nothing was substituted and no matra was stranded in visual order: hand the input
  // back untouched, so the day upstream ships real Unicode this module becomes a no-op.
  // The test is "did we change anything", not "does the string contain a PUA char" —
  // 20 Hindi values carry no mojibake at all yet still have their ि in visual order
  // (पिकाचू arrives as ि-प-क-ा-च-ू), and those need repairing too.
  if (!touched) return str;

  const ordered = applyRepha(applyPrebase(units));
  return fixNuktaOrder(ordered.map((u) => u.v).join(""));
}

// A half-form whose base carries a nukta arrives as `फ ् ़` (the legacy stream
// holds the nukta separately, after the half-form). Canonical order is nukta
// first — ccc 7 before ccc 9. Deliberately narrower than a full NFC pass: the
// sheet mixes precomposed फ़ (U+095E) and decomposed फ+़ in its *clean* strings
// too, and NFC would silently decompose all 85 precomposed letters in the
// corpus for no benefit.
function fixNuktaOrder(str) {
  // ् virama + ़ nukta  ->  ़ nukta + ् virama
  return str.replace(/़्/g, "़्");
}

// Decompose the eight precomposed nukta letters WITHOUT reordering anything, so
// two strings can be compared for character equality while staying sensitive to
// mark-ordering bugs (which a plain NFC comparison would hide, since NFC
// canonically reorders nukta ahead of virama).
const NUKTA_DECOMPOSITION = {
  "क़": "क़", // क़
  "ख़": "ख़", // ख़
  "ग़": "ग़", // ग़
  "ज़": "ज़", // ज़
  "ड़": "ड़", // ड़
  "ढ़": "ढ़", // ढ़
  "फ़": "फ़", // फ़
  "य़": "य़", // य़
};
export function canonForCompare(str) {
  return String(str).replace(/[क़-य़]/g, (c) => NUKTA_DECOMPOSITION[c]);
}


/** Every private-use codepoint left in `str`, with occurrence counts. */
export function findPua(str) {
  const found = new Map();
  for (const ch of String(str)) {
    if (isPua(ch.codePointAt(0))) found.set(hex(ch), (found.get(hex(ch)) || 0) + 1);
  }
  return found;
}

/**
 * Self-check: every `example` in the table must repair to its stated result.
 * Guards the table against edits that silently change unrelated words.
 *
 * @returns {string[]} human-readable failures; empty when the table is sound
 */
export function validateTable() {
  const failures = [];
  for (const [cp, entry] of Object.entries(TABLE.entries)) {
    if (!entry.example) {
      failures.push(`${cp}: table entry has no example to verify against`);
      continue;
    }
    const { from, to } = entry.example;
    const got = repairHindi(from);
    if (got.normalize("NFC") !== to.normalize("NFC")) {
      failures.push(`${cp}: example "${from}" repaired to "${got}", expected "${to}"`);
    }
  }
  return failures;
}

/**
 * Hard gate. Throws if any private-use codepoint survived the repair, naming the
 * codepoints and the keys that carry them so the table can be extended.
 *
 * @param {Array<{key: string, value: string}>} repaired
 */
export function assertNoPuaSurvives(repaired) {
  const offenders = new Map();
  for (const { key, value } of repaired) {
    for (const [cp] of findPua(value)) {
      if (!offenders.has(cp)) offenders.set(cp, []);
      offenders.get(cp).push(key);
    }
  }
  if (offenders.size === 0) return;

  const lines = [...offenders.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([cp, keys]) => `  ${cp} — ${keys.length} value(s), e.g. ${keys.slice(0, 4).join(", ")}`);
  throw new Error(
    `Encoding check failed: ${offenders.size} private-use codepoint(s) in the ` +
      `text about to be written.\n` +
      lines.join("\n") +
      `\n\nUpstream has emitted legacy-font mojibake. A private-use codepoint has\n` +
      `no meaning outside the font that produced it, so it cannot be rendered and\n` +
      `must not ship: find what the upstream bundle publishes for these keys and\n` +
      `fix the source, not the symptom.`
  );
}
