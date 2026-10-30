// Static check: the seven locale files agree on the UI keys that the
// workshop renders through t().
// Run with: npm run test:localeparity  (or npx vite-node directly).
//
// A key added to en.json alone renders as its raw key in the other six
// locales, and a key left behind in one locale after a rename is dead weight
// nobody reviews. check-piles already holds the pile wording per locale; this
// check holds every key under the prefixes that carry the help panels, the
// pile cards, the sorting intro, the area tabs and the event piles.
//
//   L1 — every matching key in en.json exists in each other locale
//   L2 — no other locale has a matching key that en.json lacks
//   L3 — no matching value is empty in any locale

import { readFileSync } from "node:fs";

const LOCALES = ["en", "de", "es", "fr", "zh-TW", "hi", "ja"];
const SCOPE = /^app\.(help|pile|sort|area|events)\./;

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const summarise = (list) => (list.length > 6 ? `${list.slice(0, 6).join(", ")} … (+${list.length - 6})` : list.join(", "));

const bundles = Object.fromEntries(
  LOCALES.map((loc) => [loc, JSON.parse(readFileSync(new URL(`../src/locales/app/${loc}.json`, import.meta.url), "utf8"))]),
);
const scoped = (loc) => Object.keys(bundles[loc]).filter((k) => SCOPE.test(k));
const enKeys = scoped("en");
const enSet = new Set(enKeys);

console.log(`L1 — every scoped key in en.json exists in each other locale (${enKeys.length} keys)`);
check("en.json has scoped keys", enKeys.length > 0);
for (const loc of LOCALES.slice(1)) {
  const missing = enKeys.filter((k) => !(k in bundles[loc]));
  check(`${loc}.json has every key`, missing.length === 0, summarise(missing));
}

console.log("\nL2 — no locale carries a scoped key that en.json lacks");
for (const loc of LOCALES.slice(1)) {
  const extra = scoped(loc).filter((k) => !enSet.has(k));
  check(`${loc}.json has no extra key`, extra.length === 0, summarise(extra));
}

console.log("\nL3 — no scoped value is empty");
for (const loc of LOCALES) {
  const empty = scoped(loc).filter((k) => typeof bundles[loc][k] !== "string" || bundles[loc][k].trim() === "");
  check(`${loc}.json has no empty value`, empty.length === 0, summarise(empty));
}

if (failures === 0) {
  console.log(`\n✓ ${LOCALES.length} locales agree on ${enKeys.length} scoped keys.`);
  process.exit(0);
}
console.log(`\n✗ ${failures} locale parity failure(s).`);
process.exit(1);
