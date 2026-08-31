// Static check: toggle state is exposed, not just coloured.
// Run with: npx vite-node scripts/check-a11y-state.mjs
//
// Toggle chips across the app conveyed on/off purely through a conditional
// background-colour class. They announce as a plain "button", identically
// whether on or off, so a screen-reader user could not tell a protected species
// from an unprotected one — or which of three mutually-exclusive modes was
// selected.
//
//   S1 — two-state toggles expose aria-pressed
//   S2 — mutually-exclusive groups use radio semantics
//   S3 — custom disclosures expose aria-expanded, and point at a real panel
//   S4 — the current nav tab is exposed as aria-current
//
// Deliberately NOT checked: <details>/<summary>. React sets the `open`
// attribute and the summary's expanded state derives from it natively, so
// Collapsible (which backs 20 call sites) needs no ARIA — the audit claimed
// otherwise and its own verifier refuted it.

import { readFileSync, readdirSync } from "node:fs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const app = readFileSync("src/App.jsx", "utf8");
const shell = readFileSync("src/explain/Shell.jsx", "utf8");
const chips = readFileSync("src/refinements.jsx", "utf8");
// The species refinement badge rows moved out of App.jsx into their own
// module, so the toggle audit has to follow them there. Counting over both
// keeps the threshold measuring the same set of controls it always did.
const appChips = app + chips;
const FILES = [
  "src/App.jsx",
  "src/refinements.jsx",
  "src/Landing.jsx",
  "src/SwipeOnboarding.jsx",
  ...readdirSync("src/explain").filter((f) => f.endsWith(".jsx")).map((f) => `src/explain/${f}`),
];

console.log("S1 — two-state toggles expose aria-pressed");
{
  // Toggle SURFACES, not raw attributes: a <RefinementBadges> call site is a
  // whole group of toggles whose pressed state the shared row guarantees (see
  // the structural checks below). Counting it as one keeps the ratchet at the
  // same height it stood at when all five refinement rows were written out by
  // hand in App.jsx.
  const attrs = (appChips.match(/aria-pressed=/g) || []).length;
  const groups = (app.match(/<RefinementBadges\b/g) || []).length;
  const n = attrs + groups;
  check(`${n} toggle surfaces (${attrs} aria-pressed + ${groups} badge rows)`, n >= 15);
  // The specific toggles this slice wired, by their handler.
  for (const [handler, label] of [
    ["setFlag(k, !m.flags[k])", "VerifyPanel flag chips"],
    ["togglePackSpecies(s, name, i)", "FriendCollect pack species"],
    ["toggleForced(tg.species)", "FriendCollect forced override"],
    ["toggleTC(tc.species)", "regional type-check chips"],
    ["toggleCol(sp)", "regional collector chips"],
    ["set('expertMode', !expert)", "expert-mode switch"],
  ]) {
    const i = app.indexOf(`onClick={() => ${handler}}`);
    check(label, i !== -1 && app.slice(i, i + 300).includes("aria-pressed"));
  }
  // The species refinement rows (two have-lists, friend-collect gender + axis,
  // buddy gender + forms + slots) all render through RefinementBadges, so the
  // per-handler audit above is replaced by one check on the shared row plus a
  // check that every call site actually drives it.
  {
    const i = chips.indexOf("export function RefinementBadges");
    const body = i === -1 ? "" : chips.slice(i);
    check("RefinementBadges emits aria-pressed", /onClick=\{\(\) => onToggle\(key\)\}[\s\S]{0,200}aria-pressed=\{on\}/.test(body));
    check("RefinementBadges derives `on` from the call site's stateFor",
      /const state = stateFor\(key\);[\s\S]{0,80}const on = state === 'on';/.test(body));
    const rows = [...app.matchAll(/<RefinementBadges\b[\s\S]{0,900}?\/>/g)].map((m) => m[0]);
    check(`${rows.length} RefinementBadges call site(s)`, rows.length >= 4);
    const unwired = rows.filter((r) => !/stateFor=/.test(r) || !/onToggle=/.test(r));
    check("every call site passes stateFor + onToggle", unwired.length === 0, `${unwired.length} unwired`);
  }
  const bazaar = [...app.matchAll(/tagged \? removeFromBazaar\(name\) : addOneToBazaar\(name\)/g)];
  check(`both bazaar chip lists (${bazaar.length}) expose pressed state`,
    bazaar.length === 2 && bazaar.every((m) => app.slice(m.index, m.index + 300).includes("aria-pressed")));
}

console.log("\nS2 — mutually-exclusive groups use radio semantics");
{
  const groups = (app.match(/role='radiogroup'/g) || []).length;
  check(`${groups} radiogroup(s)`, groups >= 1);
  check("radiogroups are named", (app.match(/role='radiogroup' aria-label=/g) || []).length === groups);
  check("radio children carry aria-checked",
    (app.match(/role='radio'/g) || []).length === (app.match(/aria-checked=/g) || []).length);
}

console.log("\nS3 — custom disclosures expose aria-expanded and a real panel");
{
  const pairs = [...app.matchAll(/aria-expanded=\{[^}]+\}\s*\n\s*aria-controls=\{([^}]+)\}/g)];
  check(`${pairs.length} disclosure(s) with aria-expanded + aria-controls`, pairs.length >= 3);
  // Every aria-controls target must actually be rendered as an id somewhere.
  const missing = [];
  for (const m of pairs) {
    const target = m[1].trim();
    if (!app.includes(`id={${target}}`)) missing.push(target);
  }
  check("every aria-controls points at a rendered id", missing.length === 0, missing.join(", "));

  // A chevron disclosure with no aria-expanded is the regression shape.
  const bad = [];
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/<button\b[\s\S]{0,600}?<\/button>/g)) {
      const b = m[0];
      if (!/Chevron(Down|Right)/.test(b)) continue;
      if (/aria-expanded/.test(b)) continue;
      // <summary>-based disclosures and non-toggle chevrons (e.g. a "next"
      // affordance) are out of scope; require a paired Down/Right to catch the
      // open/closed idiom specifically.
      if (!(/ChevronDown/.test(b) && /ChevronRight/.test(b))) continue;
      bad.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  check("no chevron disclosure lacks aria-expanded", bad.length === 0, bad.join(", "));
}

console.log("\nS4 — the current nav tab is exposed");
{
  check("NavChip accepts a semantic `current` prop", /function NavChip\([^)]*current/.test(shell));
  check("NavChip renders aria-current", /aria-current=\{current \? ['"]page['"]/.test(shell));
  check("AppNav forwards it from currentKey", /current=\{tab\.key === currentKey\}/.test(shell));
  // tone is a visual concern and must not be the only signal.
  check("`active` tone is no longer the sole indicator",
    /tone=\{tab\.key === currentKey[\s\S]{0,120}current=\{tab\.key === currentKey\}/.test(shell));
}

console.log(`\n${failures === 0 ? "✓ All ARIA-state checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
