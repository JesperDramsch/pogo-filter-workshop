// Compares current buildFilters output against the committed snapshot.
// Fails CI if anything drifts. Run with: npx vite-node scripts/check-fixtures.mjs
//
// The snapshot is built by scripts/lib/fixture.mjs, shared with
// generate-fixtures.mjs. That sharing is load-bearing: this script used to
// rebuild its own 7-field subset and iterate `Object.keys(actual)`, so the
// other 15 fields the generator wrote were never compared and could be
// overwritten with anything without failing CI.

import { readFileSync } from "node:fs";
import { buildFixture, diffFixture, countLeaves } from "./lib/fixture.mjs";

const FIXTURE_PATH = "src/__fixtures__/default-filter-output.json";
const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const actual = buildFixture();

const diffs = diffFixture(expected, actual);
const trunc = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s !== undefined && s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

for (const d of diffs.slice(0, 40)) {
  console.error(`✗ ${d.path}`);
  console.error(`  expected: ${trunc(d.expected)}`);
  console.error(`  actual:   ${trunc(d.actual)}`);
}
if (diffs.length > 40) console.error(`… and ${diffs.length - 40} more`);

if (diffs.length > 0) {
  console.error(`\n${diffs.length} fixture mismatch(es). If intentional, regenerate with:`);
  console.error(`  npx vite-node scripts/generate-fixtures.mjs`);
  process.exit(1);
}

const locales = Object.keys(actual);
console.log(
  `✓ All fixtures match across ${locales.length} locales ` +
  `— ${countLeaves(actual)} pinned values, ${Object.keys(actual[locales[0]]).length} fields per locale.`
);
