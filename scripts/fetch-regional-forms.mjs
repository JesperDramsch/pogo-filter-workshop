#!/usr/bin/env node
// Builds a regional-form catalog from the Niantic game master's per-form type
// data and writes a slim artifact at src/data/regional-forms.json that App.jsx
// imports at build time. Powers the buddy catch-target form picker: pick which
// regional forms of a species (Kanto base / Alola / Galar / Hisui / Paldea) to
// catch for a friend.
//
// Per form we precompute a "discriminating type predicate" {include, exclude}:
// the minimal set of has-type / lacks-type conditions that isolates exactly that
// form from its siblings. PoGo search can only filter by TYPE, never by form
// name, so e.g. Alolan Meowth is "Mauzi & Dark" and the Kanto base is
// "Mauzi & !Dark & !Steel". Dropping a form from the catch list then becomes one
// De Morgan clause in App.jsx (drop Galar = `&!stahl`).
//
// Source note: this read pogoapi.net's pokemon_types.json until August 2026.
// That feed had not moved since November 2025 and published no freshness signal
// of its own, so a form retype or a newly released regional variant would have
// gone unnoticed indefinitely. The game master carries `type`/`type2` per form
// template first-hand and stamps every batch — see scripts/lib/game-master.mjs
// and docs/upstream-sources.md. Species names come from
// src/locales/pokemon-names.json, keyed by dex.
//
// Flags:
//   --offline-ok   tolerate fetch failures if src/data/regional-forms.json exists.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson } from "./lib/json.mjs";
import {
  fetchGameMaster,
  formSuffix,
  gameMasterAgeDays,
  pokemonTemplates,
  typesOf,
  warnIfStale,
} from "./lib/game-master.mjs";
import { originRegion } from "./lib/generations.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "regional-forms.json");
const NAMES_PATH = resolve(ROOT, "src/locales/pokemon-names.json");

// Stable form key + region from a game-master form suffix ("MEOWTH_ALOLA" has
// suffix "ALOLA"). Returns null for non-regional forms (costumes, weather,
// Unown letters, Deoxys, …) so they're filtered out — only true regional
// variants reach the picker. The base form's region is overwritten with its
// origin region (from dex) in buildCatalog.
function regionForForm(form) {
  if (form === "NORMAL") return { key: "base", region: "base" };
  if (form === "ALOLA") return { key: "alola", region: "alola" };
  if (form === "GALARIAN") return { key: "galar", region: "galar" };
  if (form === "HISUIAN") return { key: "hisui", region: "hisui" };
  if (form === "PALDEA") return { key: "paldea", region: "paldea" };
  if (form.startsWith("PALDEA_")) {
    const variant = form.slice("PALDEA_".length).toLowerCase(); // combat / blaze / aqua
    return { key: `paldea:${variant}`, region: "paldea", variant };
  }
  return NON_REGIONAL_AXES[form] || null;
}

// Form axes that are NOT regional but ARE type-separable, so the same
// {include, exclude} predicate machinery isolates them in PoGo search. They
// carry `axis` instead of a meaningful region, which App.jsx's formRegionLabel
// uses to render the variant alone ("Pflanzenumhang") rather than inventing a
// region for it.
//
// Wormadam's cloaks really do differ: Plant Bug/Grass, Sandy Bug/Ground, Trash
// Bug/Steel. Oricorio's four styles differ too (Fire / Electric / Psychic /
// Ghost, all Flying) — the app previously blanket-protected Oricorio on the
// stated grounds that "styles aren't separately searchable", which is wrong.
//
// Burmy's own cloaks are listed here on purpose even though all three are pure
// Bug: predicateFor then reports them indistinct and buildCatalog drops the
// species with a loud warning, which is the correct outcome and self-healing
// if Niantic ever splits the types.
const NON_REGIONAL_AXES = {
  PLANT: { key: "cloak:plant", axis: "cloak", variant: "plant" },
  SANDY: { key: "cloak:sandy", axis: "cloak", variant: "sandy" },
  TRASH: { key: "cloak:trash", axis: "cloak", variant: "trash" },
  BAILE: { key: "style:baile", axis: "style", variant: "baile" },
  POMPOM: { key: "style:pompom", axis: "style", variant: "pompom" },
  PAU: { key: "style:pau", axis: "style", variant: "pau" },
  SENSU: { key: "style:sensu", axis: "style", variant: "sensu" },
};

// Render order: the base/origin form first, then the regional variants.
const REGION_ORDER = { alola: 1, galar: 2, hisui: 3, paldea: 4 };
const formOrder = (f) => (f.key === "base" ? 0 : (REGION_ORDER[f.region] ?? 9));

// Base-form region ("Kanto Meowth", "Johto Typhlosion", "Alola Decidueye"
// instead of a generic "Base") comes from the national-dex generation table in
// scripts/lib/generations.mjs — see originRegion there.

// Flatten the game master into the per-form rows this catalog is built from:
// { dex, name, form, types }, one per species form template that carries a
// form enum. Templates with no form (the species-level entry a form template
// duplicates) are skipped — they carry no form to key a predicate off, and
// every species with regional variants also publishes an explicit NORMAL.
function rowsFromGameMaster(templates, names) {
  const rows = [];
  for (const template of pokemonTemplates(templates)) {
    const form = formSuffix(template);
    if (!form) continue;
    const types = typesOf(template.settings);
    if (types.length === 0) continue;
    const name = names[String(template.dex)]?.en;
    if (!name) continue;
    rows.push({ dex: template.dex, name, form, types });
  }
  return rows;
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

// Collapse per-form rows into per-species regional-form catalogs.
export function buildCatalog(rows) {
  // dex → Map(formKey → { key, region, variant?, types:Set })
  const byDex = new Map();
  const names = new Map();
  for (const row of rows) {
    const reg = regionForForm(row.form);
    if (!reg) continue;
    const dex = row.dex;
    if (!Array.isArray(row.types) || row.types.length === 0) continue;
    if (!byDex.has(dex)) byDex.set(dex, new Map());
    names.set(dex, row.name);
    byDex.get(dex).set(reg.key, {
      key: reg.key,
      // Axis forms (cloak / style) have no meaningful region — carry the axis
      // instead so the label renders the variant on its own.
      ...(reg.axis
        ? { axis: reg.axis }
        : { region: reg.key === "base" ? originRegion(dex) : reg.region }),
      ...(reg.variant ? { variant: reg.variant } : {}),
      types: new Set(row.types.map(t => t.toLowerCase())),
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
        ...(form.axis ? { axis: form.axis } : { region: form.region }),
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

// Self-check against hand-verified cases so an upstream shape or data change
// fails the run loudly instead of silently shipping wrong predicates.
export function validate(species) {
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
    // Non-regional but type-separable axes. Wormadam's cloaks and Oricorio's
    // styles are real search targets; a silent drop here would ship the old
    // "not separately searchable" claim back into the UI.
    ["Wormadam plant",  () => check(413, "cloak:plant", ["grass"], [])],
    ["Wormadam sandy",  () => check(413, "cloak:sandy", ["ground"], [])],
    ["Wormadam trash",  () => check(413, "cloak:trash", ["steel"], [])],
    ["Wormadam axis",   () => find(413, "cloak:plant")?.axis === "cloak"],
    ["Oricorio baile",  () => check(741, "style:baile", ["fire"], [])],
    ["Oricorio sensu",  () => check(741, "style:sensu", ["ghost"], [])],
    // Burmy's three cloaks are all pure Bug, so it must stay OUT of the
    // catalog — if this ever starts resolving, the types changed upstream.
    ["Burmy stays indistinct", () => species["412"] === undefined],
  ];
  const failures = checks.filter(([, fn]) => !fn()).map(([name]) => name);
  if (failures.length) {
    throw new Error(`Regional-form validation failed: ${failures.join(", ")}. Upstream data may have changed.`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let templates, mirrorName, ageDays;
  try {
    console.log("→ Fetching game master (per-form type source)");
    const gm = await fetchGameMaster({
      userAgent: "pogo-filter-workshop regional-forms-fetcher/1.0",
    });
    templates = gm.templates;
    mirrorName = gm.mirror;
    ageDays = gameMasterAgeDays(gm.batchMs);
    if (gm.failures.length > 0) {
      console.warn(`⚠  fell back to ${gm.mirror} after ${gm.failures.join("; ")}`);
    }
    warnIfStale(gm, "A newly released regional form may be missing from the picker.");
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  const names = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
  const rows = rowsFromGameMaster(templates, names);
  if (rows.length < 500) {
    throw new Error(`game master yielded only ${rows.length} typed form rows (expected ≥ 500)`);
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
  console.log(`  source: ${mirrorName}${ageDays != null ? ` (${ageDays}d old)` : " (unstamped)"} · ${rows.length} typed form rows`);
  console.log(`  species: ${count} with type-distinguishable regional forms · ${indistinctCount} indistinct (skipped)`);
}

// Only run when executed directly — scripts/check-regional-catalog.mjs imports
// buildCatalog/validate above without triggering a 19 MB fetch.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
