// Static check: asynchronous results are announced to assistive tech.
// Run with: npx vite-node scripts/check-a11y-live.mjs
//
// The app had no aria-live region anywhere, so every async outcome was conveyed
// purely by a visual swap — a copy flashed an icon, an import error appeared in
// red, "press again to confirm" flipped a label. A screen-reader user pressed
// Copy and was told nothing.
//
//   L1 — the announcer exists and is wired correctly
//   L2 — it portals to <body>, NOT inside #root
//   L3 — the async paths that matter announce
//   L4 — announcement strings resolve in all 7 locales
//
// L2 is the subtle one and the reason this file exists. src/Dialog.jsx sets
// `inert` + `aria-hidden` on #root while any modal is open. A live region
// rendered inside #root would therefore go silent exactly where it is needed
// most: BackupRestoreSection (import errors, export confirmation) renders INSIDE SettingsModal.

import { readFileSync } from "node:fs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const announcer = readFileSync("src/Announcer.jsx", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const main = readFileSync("src/main.jsx", "utf8");

console.log("L1 — the announcer exists and is wired");
{
  check("exports AnnouncerProvider and useAnnounce",
    /export function AnnouncerProvider/.test(announcer) && /export function useAnnounce/.test(announcer));
  check("mounted in main.jsx around <App />", /<AnnouncerProvider>/.test(main));
  check("has a polite region", /aria-live=['"]polite['"]/.test(announcer));
  check("has an assertive region", /aria-live=['"]assertive['"]/.test(announcer));
  check("both regions are visually hidden", (announcer.match(/className=['"]sr-only['"]/g) || []).length >= 2);
  // A live region only fires on CHANGE, so setting identical text twice must
  // blank it first or the second announcement is silent.
  check("re-announces identical consecutive messages",
    /set\(['"]['"]\)/.test(announcer) && /requestAnimationFrame/.test(announcer));
  check("clears stale text after a delay", /CLEAR_AFTER_MS|setTimeout\(\(\) => set\(''\)/.test(announcer));
}

console.log("\nL2 — regions portal OUT of the inert subtree");
{
  check("uses createPortal", /createPortal/.test(announcer));
  check("portal target is document.body", /document\.body/.test(announcer));
  check("does NOT portal into #root (Dialog inerts it)",
    !/createPortal\([\s\S]{0,400}getElementById\(['"]root['"]\)/.test(announcer));
  // If Dialog ever stops inerting #root this check becomes less critical, but
  // the coupling should stay visible.
  const dialog = readFileSync("src/Dialog.jsx", "utf8");
  check("Dialog still inerts #root (the reason for the portal)",
    /getElementById\(['"]root['"]\)/.test(dialog) && /setAttribute\(['"]inert['"]/.test(dialog));
}

console.log("\nL3 — the async paths that matter announce");
{
  // One funnel covers all 35 copy call sites.
  const copyFn = app.slice(app.indexOf("function copyToClipboard"), app.indexOf("function fallbackCopy"));
  check("copyToClipboard announces", /announce\(/.test(copyFn));
  check("...on both the ok and the error path",
    /announce\([\s\S]*state === 'ok'[\s\S]*copy_failed/.test(copyFn) ||
      (copyFn.match(/announce\(/g) || []).length >= 2);
  check("copy failure is assertive (the user must act)", /assertive: state !== 'ok'/.test(copyFn));

  // Destructive two-step confirms: arming is a colour + label swap only.
  // All five are listed here on purpose. The armed-restore one was described in
  // this file's header and in Announcer.jsx before it was actually wired —
  // documentation claiming a behaviour that did not exist — so the check now
  // enumerates every confirm rather than trusting the prose.
  for (const [label, marker] of [
    ["reset everything", "app.modal.danger.reset_armed"],
    ["clear list", "app.clear_list.confirm"],
    ["clear trade marks", "app.map.clear_armed"],
    ["turn a protection off", "app.protect.confirm_off"],
    ["apply an imported backup", "app.modal.backup.import_armed"],
  ]) {
    const idx = app.indexOf(marker);
    const near = idx === -1 ? "" : app.slice(Math.max(0, idx - 700), idx + 300);
    check(`armed confirm announces: ${label}`, idx !== -1 && /announce\(/.test(near));
  }

  check("import errors announce", /function failWith\([\s\S]{0,200}announce\(/.test(app));
  check("import errors are assertive", /function failWith\([\s\S]{0,200}assertive: true/.test(app));
  check("export confirmation announces",
    /function handleExportClick\(\)[\s\S]{0,400}announce\(/.test(app));
}

console.log("\nL4 — announcement strings resolve in all 7 locales");
{
  const keys = [...new Set([...app.matchAll(/t\('(app\.a11y\.announce\.[a-z0-9_.]+)'\)/g)].map((m) => m[1]))];
  check(`${keys.length} announce key(s) referenced`, keys.length > 0, keys.join(", "));
  const missing = [];
  for (const loc of ["en", "de", "es", "fr", "hi", "ja", "zh-TW"]) {
    const j = JSON.parse(readFileSync(`src/locales/app/${loc}.json`, "utf8"));
    for (const k of keys) if (j[k] === undefined) missing.push(`${loc}:${k}`);
    // No English fallback: a non-en locale must not reuse the en string verbatim.
    if (loc !== "en") {
      const en = JSON.parse(readFileSync("src/locales/app/en.json", "utf8"));
      for (const k of keys) if (j[k] !== undefined && j[k] === en[k]) missing.push(`${loc}:${k} (== en)`);
    }
  }
  check("every announce key is present and translated", missing.length === 0, missing.slice(0, 6).join(", "));
}

console.log(`\n${failures === 0 ? "✓ All live-region checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
