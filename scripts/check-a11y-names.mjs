// Static check: every interactive control has an accessible name.
// Run with: npx vite-node scripts/check-a11y-names.mjs
//
// A control with no accessible name announces as "button" or "edit text" and is
// unusable by screen-reader and voice-control users. This repo accumulated
// dozens of them because the two easiest patterns to write — a button whose
// only child is a lucide icon, and an <input> with a *sibling* <label> — both
// produce an empty name and look completely fine on screen.
//
// Heuristic, not a parser: it scans JSX opening tags and the text up to the
// matching close. It is deliberately conservative — a control counts as named
// if ANY plausible source is present. False negatives are possible; false
// positives should be fixed rather than allowlisted.

import { readFileSync, readdirSync } from "node:fs";

const FILES = [
  "src/App.jsx",
  "src/Landing.jsx",
  "src/SwipeOnboarding.jsx",
  ...readdirSync("src/explain").filter((f) => f.endsWith(".jsx")).map((f) => `src/explain/${f}`),
];

let failures = 0;
const report = [];

// Attribute text of an opening tag starting at `i`, plus the index just past it.
function openingTag(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return { attrs: src.slice(i, j), end: j + 1, selfClosing: src[j - 1] === "/" };
  }
  return null;
}

const NAMED_BY = /aria-label(?:ledby)?[=\s]|title=|htmlFor=/;

for (const file of FILES) {
  const src = readFileSync(file, "utf8");
  const lineOf = (idx) => src.slice(0, idx).split("\n").length;

  // Collect ids that a <label htmlFor> points at, so id-paired controls pass.
  // Capture either a template literal (e.g. `${fid}-ui`) or a simple identifier (e.g. `id`).
  const labelled = new Set(
    [...src.matchAll(/htmlFor=\{`([^`]+)`\}|htmlFor=\{([A-Za-z_$][\w$]*)\}/g)].map((m) => (m[1] ?? m[2]).trim()),
  );
  const hasPairedLabel = (attrs) => {
    const m = attrs.match(/\bid=\{`([^`]+)`\}|\bid=\{([A-Za-z_$][\w$]*)\}/);
    if (!m) return false;
    const idExpr = (m[1] ?? m[2]).trim();
    return labelled.has(idExpr);
  };

  // ── form controls ────────────────────────────────────────────────────────
  for (const m of src.matchAll(/<(input|select|textarea)\b/g)) {
    const tag = openingTag(src, m.index);
    if (!tag) continue;
    const { attrs } = tag;
    if (NAMED_BY.test(attrs) || hasPairedLabel(attrs)) continue;
    // display:none controls are not in the accessibility tree at all — e.g. the
    // hidden file input that a visible "Import" button clicks for you.
    if (/className='hidden'|className="hidden"/.test(attrs)) continue;
    // A control wrapped directly in a <label> is named by it. Compare the
    // nearest preceding <label> against the nearest preceding </label>: if the
    // opener is closer, we are still inside it. (A fixed-size lookback window
    // miscounts whenever an earlier, unrelated label closed inside it.)
    const before = src.slice(0, m.index);
    if (before.lastIndexOf("<label") > before.lastIndexOf("</label>")) continue;
    report.push(`${file}:${lineOf(m.index)}  <${m[1]}> has no accessible name`);
    failures++;
  }

  // ── icon-only buttons ────────────────────────────────────────────────────
  for (const m of src.matchAll(/<button\b/g)) {
    const tag = openingTag(src, m.index);
    if (!tag || tag.selfClosing) continue;
    if (NAMED_BY.test(tag.attrs)) continue;
    // Body up to the matching </button>.
    const close = src.indexOf("</button>", tag.end);
    if (close === -1) continue;
    const body = src.slice(tag.end, close);
    // Strip JSX comments and self-closing icon elements, then see what's left.
    const rest = body
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/<[A-Z]\w*\b[^>]*\/>/g, "")
      .replace(/\s+/g, "");
    if (rest === "") {
      report.push(`${file}:${lineOf(m.index)}  <button> renders only an icon and has no accessible name`);
      failures++;
    }
  }
}

for (const r of report) console.log(`  ✗ ${r}`);
if (failures === 0) {
  console.log(`✓ Every control in ${FILES.length} files has an accessible name.`);
  process.exit(0);
}
console.log(`\n✗ ${failures} control(s) with no accessible name.`);
console.log("  Add aria-label={t('app.a11y....')}, or pair a <label htmlFor> with an id.");
process.exit(1);
