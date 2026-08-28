// Integrity checks for the generated skill reference under
// skills/pokemon-go-filters/references/.
// Run with: npx vite-node scripts/check-meta-reference.mjs
//
// Separate from check-pvp-meta.mjs on purpose: that script is about clause
// SHAPE, this one is about whether a generated artifact still matches the data
// it was generated from.
//
// The failure this exists to catch is refreezing. The skill's meta reference was
// previously hand-maintained, and it went four months stale without any signal —
// its Great League S-tier had fallen out of the live top 30 while still reading
// as authoritative. Generating it only helps if the generated copy cannot drift
// from the snapshot, so M1 fails CI on a snapshot sync that skipped regeneration.
//
//   M1 — the reference was generated from the CURRENT snapshot
//   M2 — per league, its dex order matches the snapshot exactly
//   M3 — every dex in a fenced block in META.md exists in the snapshot
//   M4 — its filter strings are byte-identical to buildFilters' output
//   M5 — META.md still carries its provenance banner and its "does not cover" section
//   M6 — the cup set matches, and cup windows resolve

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFilters, mergeImportedConfig, DEFAULT_CONFIG } from "../src/App.jsx";
import { makeTFn } from "./lib/fixture.mjs";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = resolve(ROOT, "skills/pokemon-go-filters/references");

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

let meta;
try {
  meta = JSON.parse(readFileSync(resolve(REF, "pvp-meta.json"), "utf8"));
} catch (e) {
  console.error(`cannot read pvp-meta.json: ${e.message}`);
  console.error("  Run: npm run generate-pvp-meta-reference");
  process.exit(1);
}
const markdown = readFileSync(resolve(REF, "META.md"), "utf8");

console.log("\nM1 — the reference was generated from the current snapshot");
check(
  "pvp-meta.json fetchedAt matches pvp-rankings.json",
  meta.fetchedAt === PVP_RANKINGS.fetchedAt,
  meta.fetchedAt === PVP_RANKINGS.fetchedAt
    ? ""
    : `reference ${meta.fetchedAt} vs snapshot ${PVP_RANKINGS.fetchedAt} — run \`npm run generate-pvp-meta-reference\``,
);
check("topN matches", meta.topN === PVP_RANKINGS.topN);
check("source recorded", typeof meta.source === "string" && meta.source !== "unknown", meta.source);
check("META.md quotes the same snapshot date", markdown.includes(PVP_RANKINGS.fetchedAt));

console.log("\nM2 — per-league dex order matches the snapshot");
for (const [key, league] of Object.entries(PVP_RANKINGS.leagues || {})) {
  const want = (league.species || []).map((s) => s.dex).join(",");
  const got = (meta.leagues?.[key]?.species || []).map((s) => s.dex).join(",");
  check(`${key}: ${league.species?.length || 0} species, same order`, want === got);
  check(`${key}: cpCap carried through`, meta.leagues?.[key]?.cpCap === league.cpCap);
}

console.log("\nM3 — every dex in a fenced block of META.md exists in the snapshot");
{
  // This is the "META.md invented Azumarill 184" failure made mechanical: any
  // number in a code block that is not in the snapshot came from somewhere else.
  const known = new Set();
  for (const l of Object.values(PVP_RANKINGS.leagues || {})) for (const s of l.species || []) known.add(s.dex);
  for (const c of Object.values(PVP_RANKINGS.cups || {})) for (const s of c.species || []) known.add(s.dex);
  const fenced = [...markdown.matchAll(/```(?:[^\n]*)?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const dexBlocks = fenced.filter((b) => /^[\d,\s]+$/.test(b.trim()) && b.includes(","));
  check("META.md contains dex blocks to check", dexBlocks.length > 0, `${dexBlocks.length} block(s)`);
  const stray = [];
  for (const block of dexBlocks) {
    for (const tok of block.trim().split(",")) {
      const n = Number(tok.trim());
      if (Number.isFinite(n) && !known.has(n)) stray.push(n);
    }
  }
  check("no dex number appears that is absent from the snapshot", stray.length === 0, stray.join(", "));
}

console.log("\nM4 — filter strings are the app's own output, byte for byte");
for (const locale of ["de", "en"]) {
  const result = buildFilters([], [], mergeImportedConfig(DEFAULT_CONFIG), [], locale, makeTFn(locale));
  for (const key of Object.keys(PVP_RANKINGS.leagues || {})) {
    const want = result.pvpFilters?.[key]?.clause || "";
    const got = meta.leagues?.[key]?.filters?.[locale] || "";
    check(`${locale}/${key}: identical to buildFilters output`, want === got);
  }
  check(
    `${locale}: filter strings actually present in META.md`,
    Object.keys(PVP_RANKINGS.leagues || {}).every((k) => markdown.includes(result.pvpFilters?.[k]?.clause || " ")),
  );
}

console.log("\nM5 — META.md keeps its guard rails");
check("carries the do-not-hand-edit banner", /GENERATED, DO NOT HAND-EDIT/.test(markdown));
check("tells the reader how to refresh", markdown.includes("refresh-meta.py"));
check("keeps the 'what this file does not cover' section", markdown.includes("What this file deliberately does not cover"));
check("points at META-PVE.md for the unverified material", markdown.includes("META-PVE.md"));

console.log("\nM6 — cups match, and their windows resolve");
{
  const want = Object.keys(PVP_RANKINGS.cups || {}).sort().join(",");
  const got = Object.keys(meta.cups || {}).sort().join(",");
  check(`cup set matches (${want || "none"})`, want === got);
  const referenced = new Set();
  for (const e of PVP_RANKINGS.gblEvents || []) for (const id of e.cups || []) referenced.add(id);
  const dangling = [...referenced].filter((id) => !PVP_RANKINGS.cups?.[id]);
  check("no gblEvent references a cup missing from the snapshot", dangling.length === 0, dangling.join(", "));
  for (const [id, cup] of Object.entries(meta.cups || {})) {
    check(
      `${id}: species carried through`,
      (cup.species?.length || 0) === (PVP_RANKINGS.cups[id]?.species?.length || 0),
    );
  }
}

console.log(failures === 0 ? "\nAll meta-reference checks passed." : `\n${failures} meta-reference check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
