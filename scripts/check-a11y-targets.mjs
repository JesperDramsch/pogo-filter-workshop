// Static check: the chip controls are big enough to hit, on a finger as well
// as a mouse (WCAG 2.5.8 Target Size (Minimum), 24×24 CSS px).
// Run with: npx vite-node scripts/check-a11y-targets.mjs
//
// The refinement badges render at 9px text in a 37×20 box, 2px apart, and for
// a long time that box WAS the whole hit target. Under a mouse the row is
// fine. Under a thumb — a ~40px contact patch — one press covers two badges
// and the browser picks whichever the centroid lands in, so tapping "Einall"
// toggled the Hisui badge beside it, every time, on every chip. The ✕ that
// deletes the species sat 6px past the last badge as a 10×10 target.
//
//   T1 — the badge row states a minimum target size, and grows it on touch
//   T2 — the coarse-pointer classes are LITERAL, so Tailwind emits them
//   T3 — every chip-remove ✕ goes through the shared target constant
//
// T2 is the subtle one and the reason this file exists rather than a comment.
// Tailwind builds its CSS by scanning source files for literal class names, so
// `${TOUCH}:min-h-[32px]` compiles, renders, ships — and does nothing at all,
// because no such rule was ever generated. It fails only on touch devices,
// which is exactly where nobody is running the checks. The first attempt at
// this fix shipped that bug; the measurement that caught it is not something a
// static check can repeat, so pin the property that made it possible instead.

import { readFileSync } from "node:fs";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const chips = readFileSync("src/refinements.jsx", "utf8");
const app = readFileSync("src/App.jsx", "utf8");

// WCAG 2.5.8 (AA) floor for any pointer; the touch bump sits above it.
const MIN_ANY = 24;
const MIN_COARSE = 32;
const COARSE = "[@media(pointer:coarse)]:";

// Pull `<n>` out of the `[<variant>:]<prop>-[<n>px]` utility in a class list.
// Tokenised rather than matched with a RegExp built from COARSE: that string is
// almost entirely regex metacharacters, so using it as a pattern needs escaping
// — and a hand-written escape that misses one (backslashes, in the first
// version of this file; CodeQL caught it) silently matches the wrong thing.
// Splitting on whitespace and comparing literal prefixes has no such failure
// mode, and says what a Tailwind class actually is.
// Split on the quote characters too: `classes` arrives as the raw right-hand
// side of a declaration, so the first token still carries the opening quote.
function sizeOf(classes, prop, variant = "") {
  const token = classes.split(/[\s'"`]+/).find((t) => t.startsWith(`${variant}${prop}-[`));
  return token ? Number(/\[(\d+)px\]/.exec(token)?.[1]) : NaN;
}

console.log("T1 — the badge row states a minimum target size, and grows it on touch");
{
  const target = chips.match(/const TOUCH_TARGET =\s*([\s\S]*?);\n/)?.[1] || "";
  check("TOUCH_TARGET exists", target.length > 0);
  for (const dim of ["min-h", "min-w"]) {
    // A bare `min-h-[…]` token cannot be confused with the variant one: the
    // latter starts with `[`, so the prefix test separates them on its own.
    const base = sizeOf(target, dim);
    check(`${dim} floor on every pointer is ≥ ${MIN_ANY}px`, base >= MIN_ANY, `got ${base}px`);
    const coarse = sizeOf(target, dim, COARSE);
    check(`${dim} on a coarse pointer is ≥ ${MIN_COARSE}px`, coarse >= MIN_COARSE, `got ${coarse}px`);
  }
  // Separation is half of what makes a target hittable: two 32px badges 2px
  // apart are still one smudge. The row has to widen with the badges.
  const gap = chips.match(/export const BADGE_ROW_GAP = '([^']+)'/)?.[1] || "";
  check("the row widens its gap on a coarse pointer", gap.includes(`${COARSE}gap-`), gap);
  // min-height only centres the label if the box is a flex container.
  check(
    "badges are inline-flex, so the taller box centres its label",
    /className=\{`\$\{dims\} \$\{TOUCH_TARGET\}[^`]*inline-flex items-center justify-center/.test(chips),
  );
}

console.log("\nT2 — the coarse-pointer classes are literal, so Tailwind emits them");
{
  // Every occurrence of the variant must be spelled out where the scanner can
  // see it. A `${…}` immediately before it means the class name only exists at
  // runtime, and the rule it names was never generated.
  const spliced = [...chips.matchAll(/\$\{[^}]+\}:\S*/g)].map((m) => m[0]);
  check("no variant prefix is spliced in through a template hole", spliced.length === 0, spliced.join(" "));
  const literal = (chips.match(/\[@media\(pointer:coarse\)\]:/g) || []).length;
  check(`${literal} literal coarse-pointer utilities`, literal >= 6);
  // The constants are interpolated INTO className strings, which is fine — the
  // class names themselves are literal. Guard the distinction stays true.
  for (const name of ["TOUCH_TARGET", "CHIP_REMOVE_TARGET", "BADGE_ROW_GAP"]) {
    const decl = chips.match(new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\n`))?.[1] || "";
    const holes = [...decl.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
    check(
      `${name} interpolates only whole constants, never a class prefix`,
      holes.every((h) => h === "TOUCH_TARGET"),
      holes.join(" "),
    );
  }
}

console.log("\nT3 — every chip-remove ✕ goes through the shared target constant");
{
  check("refinements.jsx exports CHIP_REMOVE_TARGET", /export const CHIP_REMOVE_TARGET/.test(chips));
  check("App.jsx imports it", /\bCHIP_REMOVE_TARGET,/.test(app));
  // The remove buttons are the ones named by the shared a11y label. Each must
  // carry the constant: they sit at the end of a badge row, and theirs is the
  // one mis-tap in these rows that destroys data.
  const buttons = [...app.matchAll(/<button\b[\s\S]{0,600}?<\/button>/g)]
    .map((m) => m[0])
    .filter((b) => b.includes("app.a11y.remove_species"));
  check(`${buttons.length} chip-remove buttons found`, buttons.length >= 6);
  const bare = buttons.filter((b) => !b.includes("CHIP_REMOVE_TARGET"));
  check("all of them use CHIP_REMOVE_TARGET", bare.length === 0, `${bare.length} bare`);
}

if (failures > 0) {
  console.error(`\n${failures} target-size check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ All target-size checks passed.");
