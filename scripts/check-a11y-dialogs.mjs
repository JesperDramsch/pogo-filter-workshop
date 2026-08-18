// Static check: every modal overlay routes through the shared Dialog primitive.
// Run with: npx vite-node scripts/check-a11y-dialogs.mjs
//
// The repo had six hand-rolled overlays. Five carried role="dialog",
// aria-modal and an accessible name — the parts that are easy to remember — and
// none had the parts that make a dialog usable: nothing took focus on open, Tab
// walked out into the page behind, Escape did nothing, focus never returned to
// the opener, and the background stayed scrollable and exposed to AT. The sixth
// (SwipeOnboarding's destructive toss confirmation) had none of it at all.
//
// The fix was one primitive, so the thing worth guarding is that new overlays
// use it rather than growing a seventh copy of the old pattern.
//
//   D1 — Dialog implements the full contract
//   D2 — no fixed-inset overlay hand-rolls role="dialog" outside Dialog.jsx
//   D3 — every dialog has an accessible name, and they are distinct

import { readFileSync, readdirSync } from "node:fs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const dialogSrc = readFileSync("src/Dialog.jsx", "utf8");
const FILES = [
  "src/App.jsx",
  "src/Landing.jsx",
  "src/SwipeOnboarding.jsx",
  ...readdirSync("src/explain").filter((f) => f.endsWith(".jsx")).map((f) => `src/explain/${f}`),
];

console.log("D1 — the primitive implements the whole contract");
for (const [label, re] of [
  ["Escape closes", /['"]Escape['"]/],
  ["focus trap on Tab", /['"]Tab['"]/],
  ["initial focus", /initialFocusRef/],
  ["focus restore to the opener", /restoreRef/],
  ["scroll lock", /body\.style\.overflow/],
  ["background inert", /setAttribute\(['"]inert['"]/],
  ["background aria-hidden", /aria-hidden['"]?,\s*['"]true['"]/],
  ["portals out of the inert subtree", /createPortal/],
  ["stacking-safe background release", /backgroundCounts/],
]) {
  check(label, re.test(dialogSrc));
}

console.log("\nD2 — no overlay hand-rolls the old pattern");
{
  const offenders = [];
  const usesHook = [];
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    const usesBehaviorHook = /\buseDialogBehavior\s*\(/.test(src);
    for (const m of src.matchAll(/role=["']dialog["']|role=["']alertdialog["']/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      const lt = src.lastIndexOf("<", m.index);
      const gt = src.lastIndexOf(">", m.index);
      const inDialogComponentTag = lt > gt && /<Dialog\b/.test(src.slice(lt, m.index));
      if (inDialogComponentTag) continue;
      // Legitimate iff this file also invokes the shared behaviour.
      if (usesBehaviorHook) {
        usesHook.push(`${f}:${line}`);
        continue;
      }
      offenders.push(`${f}:${line}`);
    }
  }
  check("every role=dialog/alertdialog outside Dialog.jsx uses useDialogBehavior",
    offenders.length === 0, offenders.join(", "));
  console.log(`  · ${usesHook.length} overlay(s) borrow the hook with their own markup: ${usesHook.join(", ") || "none"}`);

  // The old shape: a fixed-inset backdrop that closes on a bare onClick and
  // relies on stopPropagation to keep inner clicks from dismissing it.
  // Comments are stripped first — prose ABOUT the removed hack is not the hack.
  const stripComments = (src) =>
    src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const stop = FILES.filter((f) => /stopPropagation/.test(stripComments(readFileSync(f, "utf8"))));
  check("no overlay still needs a stopPropagation hack", stop.length === 0, stop.join(", "));
}

console.log("\nD3 — dialogs are named, and distinctly");
{
  const app = readFileSync("src/App.jsx", "utf8");
  const labels = [...app.matchAll(/<Dialog\b[^>]*?label=\{t\('([^']+)'\)\}/g)].map((m) => m[1]);
  check(`all ${labels.length} <Dialog> usages carry a translated label`,
    labels.length >= 5 && labels.every(Boolean), labels.join(", "));
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  check("dialog names are distinct", dupes.length === 0, dupes.join(", "));

  // Close buttons announced identically across two dialogs is the same problem
  // one level down.
  const closeKeys = [...app.matchAll(/aria-label=\{t\('([a-z0-9_.]*close[a-z0-9_.]*)'\)\}/g)].map((m) => m[1]);
  const closeDupes = closeKeys.filter((k, i) => closeKeys.indexOf(k) !== i);
  check("close buttons do not share one string across dialogs",
    closeDupes.length === 0, [...new Set(closeDupes)].join(", "));

  // Every referenced key must exist in all 7 locales.
  const missing = [];
  for (const loc of ["en", "de", "es", "fr", "hi", "ja", "zh-TW"]) {
    const j = JSON.parse(readFileSync(`src/locales/app/${loc}.json`, "utf8"));
    for (const k of [...labels, ...closeKeys]) if (j[k] === undefined) missing.push(`${loc}:${k}`);
  }
  check("every dialog name resolves in all 7 locales", missing.length === 0, missing.slice(0, 6).join(", "));
}

console.log(`\n${failures === 0 ? "✓ All dialog checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
