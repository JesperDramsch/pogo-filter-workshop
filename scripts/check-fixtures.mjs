// Compares current buildFilters output against the committed snapshot.
// Fails CI if anything drifts. Run with: npx vite-node scripts/check-fixtures.mjs

import { readFileSync } from "node:fs";
import { buildFilters, DEFAULT_CONFIG, DEFAULT_HUNDOS } from "../src/App.jsx";
import { LOCALES } from "../src/i18n/index.js";

function makeTFn(locale) {
  const messages = LOCALES[locale]?.messages || LOCALES.en.messages;
  return (key, opts) => {
    let str = messages[key];
    if (str === undefined && locale !== "en") str = LOCALES.en.messages[key];
    if (str === undefined) return opts && "fallback" in opts ? opts.fallback : key;
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

const expected = JSON.parse(readFileSync("src/__fixtures__/default-filter-output.json", "utf8"));

let failures = 0;
for (const locale of Object.keys(LOCALES)) {
  const tFn = makeTFn(locale);
  const result = buildFilters(DEFAULT_HUNDOS, DEFAULT_CONFIG, [], locale, tFn);
  const actual = {
    trash: result.trash,
    trade: result.trade,
    sort: result.sort,
    prestaged: result.prestaged,
    gift: result.gift,
    trashClauseCount: result.trashClauses.length,
    tradeClauseCount: result.tradeClauses.length,
  };
  const exp = expected[locale];
  if (!exp) {
    console.error(`✗ ${locale}: no fixture entry`);
    failures++;
    continue;
  }
  for (const field of Object.keys(actual)) {
    if (actual[field] !== exp[field]) {
      console.error(`✗ ${locale}.${field} mismatch`);
      console.error(`  expected: ${JSON.stringify(exp[field])}`);
      console.error(`  actual:   ${JSON.stringify(actual[field])}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} fixture mismatch(es). If intentional, regenerate with:`);
  console.error(`  npx vite-node scripts/generate-fixtures.mjs`);
  process.exit(1);
}
console.log(`✓ All fixtures match across ${Object.keys(LOCALES).length} locales.`);
