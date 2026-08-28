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
//   M2 — every pool (league AND cup) matches the snapshot: dex order and names
//   M3 — META.md's dex blocks AND species tables match the reference
//   M4 — its filter strings are non-empty and byte-identical to buildFilters' output
//   M5 — META.md still carries its provenance banner and its "does not cover" section
//   M6 — the cup set, caps and event windows match the snapshot

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pokemonNameFor } from "../src/data/species.js";
import { buildResult } from "./lib/fixture.mjs";
import { createChecker } from "./lib/check.mjs";
import { REFERENCE_LOCALES } from "./lib/meta-reference.mjs";
import PVP_RANKINGS from "../src/data/pvp-rankings.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = resolve(ROOT, "skills/pokemon-go-filters/references");

const { check, done } = createChecker();

let meta;
try {
  meta = JSON.parse(readFileSync(resolve(REF, "pvp-meta.json"), "utf8"));
} catch (e) {
  console.error(`cannot read pvp-meta.json: ${e.message}`);
  console.error("  Run: npm run generate-pvp-meta-reference");
  process.exit(1);
}
const markdown = readFileSync(resolve(REF, "META.md"), "utf8");

// Leagues and cups are the same kind of thing to every check below — a named
// pool of ranked species — and cups are half the ranked species in the file.
// Validating only leagues left that half unguarded.
const snapshotPools = [
  ...Object.entries(PVP_RANKINGS.leagues || {}).map(([k, v]) => [`league:${k}`, v]),
  ...Object.entries(PVP_RANKINGS.cups || {}).map(([k, v]) => [`cup:${k}`, v]),
];
const metaPoolFor = (label) => {
  const [kind, key] = label.split(/:(.*)/s);
  return (kind === "league" ? meta.leagues : meta.cups)?.[key];
};

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
// Not just "a source is set": the reference must name the SAME upstream the
// snapshot came from, or a lily-dex fallback day is quoted as a PvPoke sync.
check("source matches the snapshot's", meta.source === PVP_RANKINGS.source,
  `reference ${meta.source} vs snapshot ${PVP_RANKINGS.source}`);
check("META.md quotes the same snapshot date", markdown.includes(PVP_RANKINGS.fetchedAt));

console.log("\nM2 — every pool matches the snapshot: dex order and names");
for (const [label, pool] of snapshotPools) {
  const mine = metaPoolFor(label);
  const want = (pool.species || []).map((s) => s.dex).join(",");
  const got = (mine?.species || []).map((s) => s.dex).join(",");
  check(`${label}: ${pool.species?.length || 0} species, same order`, want === got);
  check(`${label}: cpCap carried through`, mine?.cpCap === pool.cpCap);
  // Names are what a reader actually quotes out of the reference, and nothing
  // used to compare a single one of them — a dex could carry any name at all.
  const wrong = (mine?.species || [])
    .filter((s) => REFERENCE_LOCALES.some((loc) => s.names?.[loc] !== pokemonNameFor(String(s.dex), loc)))
    .map((s) => `${s.dex}=${REFERENCE_LOCALES.map((l) => s.names?.[l]).join("/")}`);
  check(`${label}: localized names resolve from the dex`, wrong.length === 0, wrong.slice(0, 5).join(", "));
}

console.log("\nM3 — META.md's dex blocks and species tables match the reference");
{
  // This is the "META.md invented Azumarill 184" failure made mechanical. It
  // must cover the species TABLE as well as the fenced dex blocks: the table is
  // the half a model reads and quotes, and a fenced-blocks-only check let an
  // invented rank-1 row through with a dex that is nowhere in the snapshot.
  const known = new Set();
  for (const [, pool] of snapshotPools) for (const s of pool.species || []) known.add(s.dex);

  const fenced = [...markdown.matchAll(/```(?:[^\n]*)?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const dexBlocks = fenced.filter((b) => /^[\d,\s]+$/.test(b.trim()) && b.includes(","));
  check("META.md contains dex blocks to check", dexBlocks.length > 0, `${dexBlocks.length} block(s)`);
  const stray = [];
  for (const block of dexBlocks) {
    for (const tok of block.trim().split(",")) {
      const t = tok.trim();
      // Number("") is 0, which is in no snapshot — a trailing comma would report
      // a bogus stray dex nobody can find in the file. Skip empty segments.
      if (t === "") continue;
      const n = Number(t);
      if (Number.isFinite(n) && !known.has(n)) stray.push(n);
    }
  }
  check("no dex number appears that is absent from the snapshot", stray.length === 0, stray.join(", "));

  // Every `| rank | de | en | dex |` row must be a row the reference actually
  // carries, with the same rank and the same names. The header (`| # |`) and the
  // `|---:|` separator do not match, so only data rows are compared.
  // One entry per reference species. Kept as a list as well as a set, because
  // the same species legitimately appears at the same rank in several pools
  // (Lickilicky is rank 1 in both Great League and Mega Great) — deduping would
  // undercount the rows META.md is supposed to carry.
  const expectedRows = [];
  for (const [label] of snapshotPools) {
    for (const s of metaPoolFor(label)?.species || []) {
      expectedRows.push(`${s.rank}|${s.names?.de}|${s.names?.en}|${s.dex}`);
    }
  }
  const expected = new Set(expectedRows);
  const rows = [...markdown.matchAll(/^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|\s*(\d+)\s*\|/gm)]
    .map((m) => `${Number(m[1])}|${m[2].trim()}|${m[3].trim()}|${Number(m[4])}`);
  check("META.md contains species tables to check", rows.length > 0, `${rows.length} row(s)`);
  const invented = rows.filter((r) => !expected.has(r));
  check("every species table row matches the reference", invented.length === 0,
    invented.slice(0, 5).join("  ·  "));
  // A table that silently lost rows is drift too, not just an invented one.
  check("every reference species appears in a table", rows.length === expectedRows.length,
    rows.length === expectedRows.length ? "" : `${rows.length} table row(s) vs ${expectedRows.length} reference species`);
}

console.log("\nM4 — filter strings are the app's own output, byte for byte");
for (const locale of REFERENCE_LOCALES) {
  const result = buildResult(locale, { hundos: [], luckies: [] });
  for (const key of Object.keys(PVP_RANKINGS.leagues || {})) {
    const want = result.pvpFilters?.[key]?.clause ?? "";
    const got = meta.leagues?.[key]?.filters?.[locale] ?? "";
    // Non-empty first. `want === got` passes happily on two empty strings, so
    // the single worst regression — the app emitting no PvP filter at all — used
    // to read as green here.
    check(`${locale}/${key}: filter is non-empty`, want.length > 0);
    check(`${locale}/${key}: identical to buildFilters output`, want === got);
    // Guarded on non-empty for the same reason: `markdown.includes("")` is
    // vacuously true, exactly as the old `|| " "` fallback was.
    check(`${locale}/${key}: present verbatim in META.md`,
      want.length > 0 && markdown.includes(want));
  }
}

console.log("\nM5 — META.md keeps its guard rails");
check("carries the do-not-hand-edit banner", /GENERATED, DO NOT HAND-EDIT/.test(markdown));
check("tells the reader how to refresh", markdown.includes("refresh-meta.py"));
check("keeps the 'what this file does not cover' section", markdown.includes("What this file deliberately does not cover"));
check("points at META-PVE.md for the unverified material", markdown.includes("META-PVE.md"));

console.log("\nM6 — the cup set, caps and event windows match the snapshot");
{
  // Referential integrity between gblEvents and cups is asserted by
  // check-data-filters D2, which owns the snapshot. It read nothing from `meta`,
  // so a copy here tested nothing about the reference and only made one
  // invariant fail in two places with two different messages.
  const want = Object.keys(PVP_RANKINGS.cups || {}).sort().join(",");
  const got = Object.keys(meta.cups || {}).sort().join(",");
  check(`cup set matches (${want || "none"})`, want === got);

  // The window the generator derives from gblEvents, recomputed. Nothing used to
  // read these objects at all, despite the section heading promising it.
  const expectedWindow = {};
  for (const e of PVP_RANKINGS.gblEvents || []) {
    for (const id of e.cups || []) expectedWindow[id] = { eventName: e.name, start: e.start, end: e.end };
  }
  for (const [id, cup] of Object.entries(meta.cups || {})) {
    const w = expectedWindow[id] || null;
    const ok = JSON.stringify(cup.window ?? null) === JSON.stringify(w);
    check(`${id}: window resolves to its event`, ok,
      ok ? "" : `reference ${JSON.stringify(cup.window ?? null)} vs snapshot ${JSON.stringify(w)}`);
    check(`${id}: name carried through`, cup.name === PVP_RANKINGS.cups[id]?.name);
  }
}

done("All meta-reference checks passed.", (n) => `${n} meta-reference check(s) failed.`);
