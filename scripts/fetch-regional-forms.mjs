#!/usr/bin/env node
// Builds a regional-form catalog from pogoapi's pokemon_types dataset and writes
// a slim artifact at src/data/regional-forms.json that App.jsx imports at build
// time. Powers the buddy catch-target form picker: pick which regional forms of
// a species (Kanto base / Alola / Galar / Hisui / Paldea) to catch for a friend.
//
// Per form we precompute a "discriminating type predicate" {include, exclude}:
// the minimal set of has-type / lacks-type conditions that isolates exactly that
// form from its siblings. PoGo search can only filter by TYPE, never by form
// name, so e.g. Alolan Meowth is "Mauzi & Dark" and the Kanto base is
// "Mauzi & !Dark & !Steel". Dropping a form from the catch list then becomes one
// De Morgan clause in App.jsx (drop Galar = `&!stahl`).
//
// Flags:
//   --offline-ok   tolerate fetch failures if src/data/regional-forms.json exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "regional-forms.json");

const TYPES_URL = "https://pogoapi.net/api/v1/pokemon_types.json";

// Stable form key + region from a pogoapi `form` string. Returns null for
// non-regional forms (costumes, weather, Unown letters, Deoxys, …) so they're
// filtered out — only true regional variants reach the picker. The base form's
// region is overwritten with its origin region (from dex) in buildCatalog.
function regionForForm(form) {
  if (form === "Normal") return { key: "base", region: "base" };
  if (form === "Alola") return { key: "alola", region: "alola" };
  if (form === "Galarian") return { key: "galar", region: "galar" };
  if (form === "Hisuian") return { key: "hisui", region: "hisui" };
  if (form === "Paldea") return { key: "paldea", region: "paldea" };
  if (form.startsWith("Paldea_")) {
    const variant = form.slice("Paldea_".length).toLowerCase(); // combat / blaze / aqua
    return { key: `paldea:${variant}`, region: "paldea", variant };
  }
  return null;
}

// Render order: the base/origin form first, then the regional variants.
const REGION_ORDER = { alola: 1, galar: 2, hisui: 3, paldea: 4 };
const formOrder = (f) => (f.key === "base" ? 0 : (REGION_ORDER[f.region] ?? 9));

// Base-form region = the species' origin generation's region (National Dex
// ranges), so the picker shows "Kanto Meowth", "Johto Typhlosion", "Alola
// Decidueye" instead of a generic "Base".
const GEN_REGIONS = [
  [151, "kanto"], [251, "johto"], [386, "hoenn"], [493, "sinnoh"],
  [649, "unova"], [721, "kalos"], [809, "alola"], [905, "galar"], [1025, "paldea"],
];
function originRegion(dex) {
  for (const [max, region] of GEN_REGIONS) if (dex <= max) return region;
  return "base";
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop regional-forms-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Predicate that uniquely matches `form` among its `siblings`. A Pokémon matches
// iff it HAS every `include` type and LACKS every `exclude` type. Strategy:
//   1. If the form owns a type no sibling has, that single include disambiguates.
//   2. Otherwise greedily add discriminators (a type the form has & a sibling
//      lacks → include; a type a sibling has & the form lacks → exclude) until
//      no sibling still matches.
// Returns null when a sibling shares an identical type-set (no predicate can
// separate them) — the caller marks that species indistinct.
function predicateFor(form, siblings) {
  const has = (set, t) => set.has(t);
  const matches = (s, include, exclude) =>
    include.every(t => has(s.types, t)) && exclude.every(t => !has(s.types, t));

  // 1. Unique-type shortcut.
  const formTypes = [...form.types];
  const unique = formTypes.find(t => siblings.every(s => !has(s.types, t)));
  if (unique) return { include: [unique], exclude: [] };

  // 2. Greedy discrimination.
  const include = [];
  const exclude = [];
  let ambiguous = siblings.filter(s => matches(s, include, exclude));
  while (ambiguous.length > 0) {
    const s = ambiguous[0];
    const incCand = formTypes.find(t => !has(s.types, t) && !include.includes(t));
    if (incCand !== undefined) {
      include.push(incCand);
    } else {
      const excCand = [...s.types].find(t => !has(form.types, t) && !exclude.includes(t));
      if (excCand === undefined) return null; // identical type-set → indistinct
      exclude.push(excCand);
    }
    ambiguous = siblings.filter(x => matches(x, include, exclude));
  }
  return { include, exclude };
}

// Collapse pogoapi rows into per-species regional-form catalogs.
function buildCatalog(rows) {
  // dex → Map(formKey → { key, region, variant?, types:Set })
  const byDex = new Map();
  const names = new Map();
  for (const row of rows) {
    const reg = regionForForm(row.form);
    if (!reg) continue;
    const dex = row.pokemon_id;
    if (!Array.isArray(row.type) || row.type.length === 0) continue;
    if (!byDex.has(dex)) byDex.set(dex, new Map());
    names.set(dex, row.pokemon_name);
    byDex.get(dex).set(reg.key, {
      key: reg.key,
      region: reg.key === "base" ? originRegion(dex) : reg.region,
      ...(reg.variant ? { variant: reg.variant } : {}),
      types: new Set(row.type.map(t => t.toLowerCase())),
    });
  }

  const species = {};
  let indistinctCount = 0;
  for (const [dex, formMap] of byDex) {
    const forms = [...formMap.values()];
    // Need at least two forms AND at least one non-base form to be worth a
    // picker. Guard on key, not region (base region is now an origin region).
    if (forms.length < 2 || !forms.some(f => f.key !== "base")) continue;

    let indistinct = false;
    const out = [];
    for (const form of forms) {
      const siblings = forms.filter(f => f !== form);
      const pred = predicateFor(form, siblings);
      if (!pred) { indistinct = true; break; }
      out.push({
        key: form.key,
        region: form.region,
        ...(form.variant ? { variant: form.variant } : {}),
        include: pred.include,
        exclude: pred.exclude,
      });
    }
    if (indistinct) {
      indistinctCount++;
      console.warn(`  ⚠ ${names.get(dex)} (${dex}): forms not type-distinguishable — skipped (family toggle only)`);
      continue;
    }
    out.sort((a, b) =>
      (formOrder(a) - formOrder(b)) ||
      (a.variant || "").localeCompare(b.variant || ""));
    species[String(dex)] = { name: names.get(dex), forms: out };
  }
  return { species, indistinctCount };
}

// Self-check against hand-verified cases so a pogoapi shape/data change fails the
// run loudly instead of silently shipping wrong predicates.
function validate(species) {
  const find = (dex, key) => (species[String(dex)]?.forms || []).find(f => f.key === key);
  const eq = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...b].sort());
  const check = (dex, key, inc, exc) => {
    const f = find(dex, key);
    return f && eq(f.include, inc) && eq(f.exclude, exc);
  };
  const checks = [
    ["Meowth base",    () => check(52, "base", ["normal"], [])],
    ["Meowth alola",   () => check(52, "alola", ["dark"], [])],
    ["Meowth galar",   () => check(52, "galar", ["steel"], [])],
    ["Tauros combat",  () => check(128, "paldea:combat", ["fighting"], ["fire", "water"])],
    ["Raichu alola",   () => check(26, "alola", ["psychic"], [])],
    ["Raichu base",    () => check(26, "base", [], ["psychic"])],
    ["Slowpoke galar", () => check(79, "galar", [], ["water"])],
    ["Growlithe hisui",() => check(58, "hisui", ["rock"], [])],
    ["Meowth base region",    () => find(52, "base")?.region === "kanto"],
    ["Typhlosion base region",() => find(157, "base")?.region === "johto"],
    ["Decidueye base region", () => find(724, "base")?.region === "alola"],
  ];
  const failures = checks.filter(([, fn]) => !fn()).map(([name]) => name);
  if (failures.length) {
    throw new Error(`Regional-form validation failed: ${failures.join(", ")}. Upstream data may have changed.`);
  }
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Order-independent stringify for content comparison (mirrors fetch-raid-bosses.mjs).
function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let rows;
  try {
    console.log("→ Fetching pogoapi pokemon_types");
    rows = await fetchJson(TYPES_URL);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  if (!Array.isArray(rows) || rows.length < 500) {
    throw new Error(`pokemon_types.json missing or too short (got ${rows?.length ?? 0} rows)`);
  }

  const { species, indistinctCount } = buildCatalog(rows);
  const count = Object.keys(species).length;
  if (count === 0) {
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn("⚠  No regional-form species resolved; --offline-ok keeps existing cache.");
      return;
    }
    throw new Error("No regional-form species resolved — refusing to overwrite cache");
  }
  validate(species);

  // Preserve fetchedAt when the catalog content is unchanged so the weekly sync
  // doesn't open a PR just because the timestamp moved.
  const newContent = { species };
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      if (canonicalStringify({ species: prev.species }) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  species: ${count} with type-distinguishable regional forms · ${indistinctCount} indistinct (skipped)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
