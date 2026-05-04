#!/usr/bin/env node
// Pulls Pokémon stats + moves from pogoapi.net and derives the meta-attacker
// allowlists (topAttackers + topMaxAttackers) that App.jsx uses as default
// seeds for the Step-3 chip editors. Replaces the hand-curated tier-list
// constants — meta drifts every move-rebalance, so a data-derived list keeps
// the seeds current without code changes.
//
// Score per (species, type) = base_attack × max_charge_move_power_of_type.
// Top-N per type, unioned + deduped → topAttackers (~70-100 species). Same
// list filtered to a Dynamax-eligibility seed → topMaxAttackers.
//
// Also emits chargerMoves: fast moves with duration ≤ 500ms (the in-game
// "0.5s tier" — the Max-Battle charger requirement). Consumed by App.jsx's
// Max Tank filter (App.jsx:1159), which localizes each move name through
// the move-name dictionary populated by fetch-translations.mjs.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "src/data");
const OUT_PATH = resolve(DATA_DIR, "meta-rankings.json");

const ENDPOINTS = {
  stats:    "https://pogoapi.net/api/v1/pokemon_stats.json",
  moves:    "https://pogoapi.net/api/v1/current_pokemon_moves.json",
  fast:     "https://pogoapi.net/api/v1/fast_moves.json",
  charged:  "https://pogoapi.net/api/v1/charged_moves.json",
  released: "https://pogoapi.net/api/v1/released_pokemon.json",
};

const TYPES = [
  "normal", "fighting", "flying", "poison", "ground", "rock",
  "bug", "ghost", "steel", "fire", "water", "grass",
  "electric", "psychic", "ice", "dragon", "dark", "fairy",
];

// Tunables. 8 per type × 18 types = 144 raw, deduped to ~70-100.
const TOP_PER_TYPE = 8;
const MAX_CHARGER_DURATION_MS = 500;

// Bootstrap of Dynamax/Gigantamax-eligible species (lowercase, hyphens for
// hyphenated names — matches pogoapi `pokemon_name` after normalize). Pulled
// from the user's Apr 2026 meta reference (S/A/B/C tiers across attackers,
// tanks, healers). New Dynamax forms can be appended by editing this set —
// won't auto-update from pogoapi since pogoapi has no Dynamax flag.
const DYNAMAX_ELIGIBLE_SEED = new Set([
  // attackers
  "zacian", "zamazenta", "cinderace", "inteleon", "rillaboom", "gengar",
  "charizard", "machamp", "urshifu", "darmanitan", "eternatus", "metagross",
  "excadrill", "latios", "latias", "ho-oh", "raikou", "zapdos", "moltres",
  "toxtricity", "venusaur", "snorlax", "blastoise", "kingler", "lapras",
  "grimmsnarl", "alakazam", "hatterene", "kabutops", "glaceon", "espeon",
  "sylveon", "jolteon", "entei", "vaporeon",
  // healers / tanks
  "wailord", "chansey", "blissey", "regice", "regirock", "registeel",
  "lugia", "articuno", "suicune", "tsareena", "falinks", "butterfree",
  "corviknight", "gardevoir", "gallade", "omastar", "cryogonal", "sableye",
  "greedent", "garbodor", "dubwool", "shuckle", "flareon", "eevee",
  "wooloo", "stonjourner", "centiskorch", "krabby", "melmetal", "duraludon",
]);

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "pogo-filter-workshop meta-rankings-fetcher/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Lowercase + replace special chars with the convention the app's
// resolveSpecies expects: hyphens for hyphenated names (Ho-Oh → ho-oh),
// spaces collapsed (Mr. Mime → mr-mime), apostrophes/periods dropped
// (Farfetch'd → farfetchd). The chip-editor reload pass canonicalizes
// these via resolveSpecies anyway, so close-enough is fine.
function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/[♂]/g, "-m")
    .replace(/[♀]/g, "-f")
    .replace(/\s+/g, "-");
}

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

function writeJson(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");

  let stats, moves, fast, charged, released;
  try {
    console.log("→ Fetching pogoapi.net endpoints");
    [stats, moves, fast, charged, released] = await Promise.all([
      fetchJson(ENDPOINTS.stats),
      fetchJson(ENDPOINTS.moves),
      fetchJson(ENDPOINTS.fast),
      fetchJson(ENDPOINTS.charged),
      fetchJson(ENDPOINTS.released),
    ]);
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; build will use cache.`);
      return;
    }
    process.exit(1);
  }

  // released_pokemon.json is an object keyed by pokemon_id string; presence
  // == released. Build a numeric set for fast lookup.
  const releasedSet = new Set();
  for (const key of Object.keys(released || {})) {
    const id = parseInt(key, 10);
    if (!Number.isNaN(id)) releasedSet.add(id);
  }

  // Move-name → entry lookups for the per-Pokémon score loop.
  const chargedByName = Object.fromEntries(charged.map(m => [m.name, m]));

  // Restrict to base form ("Normal") on the moves side so we score Charizard
  // proper rather than Mega-Charizard-Y separately. Forms like Galarian
  // Darmanitan-Crown / Zacian-Crowned-Sword *are* base species in pogoapi
  // (different pokemon_id), so they're already first-class.
  const movesByPokemon = new Map();
  for (const m of moves) {
    if (m.form !== "Normal") continue;
    movesByPokemon.set(m.pokemon_id, m);
  }

  // Score per (species, type). Skip species not yet released, or with no
  // moves entry (Niantic-pending species, costume forms, etc.).
  const perTypeRankings = Object.fromEntries(TYPES.map(t => [t, []]));

  for (const p of stats) {
    if (p.form !== "Normal") continue;
    if (!releasedSet.has(p.pokemon_id)) continue;
    const mvs = movesByPokemon.get(p.pokemon_id);
    if (!mvs) continue;

    // Pool charged + elite-charged moves; elite TM access is realistic for
    // serious raid attackers (the user already plans Bullet Punch Metagross
    // etc. per their reference doc).
    const allCharged = [
      ...(mvs.charged_moves || []),
      ...(mvs.elite_charged_moves || []),
    ].map(n => chargedByName[n]).filter(Boolean);

    if (allCharged.length === 0) continue;

    const speciesId = normalizeName(p.pokemon_name);

    for (const t of TYPES) {
      const movesOfType = allCharged.filter(m => m.type.toLowerCase() === t);
      if (movesOfType.length === 0) continue;
      const bestPower = Math.max(...movesOfType.map(m => m.power));
      const score = p.base_attack * bestPower;
      perTypeRankings[t].push({ id: speciesId, dex: p.pokemon_id, score });
    }
  }

  // Per-type top-N (deduped, since a species could appear twice if multiple
  // forms collapsed to the same speciesId — defensive).
  const topByType = {};
  for (const [t, list] of Object.entries(perTypeRankings)) {
    list.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const out = [];
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
      if (out.length >= TOP_PER_TYPE) break;
    }
    topByType[t] = out;
  }

  // Union + dedupe → topAttackers, sorted by best-score-across-types so the
  // resulting list has S-tier picks at the head.
  const speciesBestScore = new Map();
  const speciesDex = new Map();
  for (const list of Object.values(topByType)) {
    for (const e of list) {
      const cur = speciesBestScore.get(e.id) || 0;
      if (e.score > cur) speciesBestScore.set(e.id, e.score);
      speciesDex.set(e.id, e.dex);
    }
  }
  const topAttackers = [...speciesBestScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // topMaxAttackers: Dynamax-eligibility seed, ranked by base attack
  // (descending). Why not the same per-type top-8 filter as topAttackers:
  // pogoapi's `current_pokemon_moves.json` only carries each species's
  // *normal* moveset, not its G-Max move. G-Max moves add ~100 BP, so a
  // species like Cinderace (regular base_attack=233) loses to Mewtwo on
  // raw raid-DPS scoring even though Gigantamax Cinderace is the premier
  // Fire Max attacker. Ranking the seed by ATK puts the heavy hitters
  // (Eternatus 332, Zacian/Zamazenta 332, etc.) at the top while still
  // including all viable G-Max picks (Cinderace 233, Charizard 223, …).
  // Per-species stats lookup. Some Gen 8+ species (Zacian, Zamazenta, Urshifu,
  // Galarian Darmanitan, Toxtricity, …) have no "Normal" form — pogoapi
  // distinguishes them by form (Crowned_sword, Galarian_standard, etc.).
  // Pick the highest-ATK form as the species representative since the score
  // we care about is attacker viability (Crowned Zacian > Hero Zacian).
  const statsBySpecies = new Map();
  for (const p of stats) {
    // Skip costume/event variants — they share base species stats anyway.
    if (/^Costume_|^Gofest_|_2020$|_2021$|_2022$|_2023$|_2024$/.test(p.form)) continue;
    // No released-filter here: pogoapi's released_pokemon.json lags behind
    // (e.g. Toxtricity #849 is in PoGo but not yet flagged released here).
    // The Dynamax-seed *is* a release-vetted curation, so trust it.
    const id = normalizeName(p.pokemon_name);
    const prev = statsBySpecies.get(id);
    if (!prev || p.base_attack > prev.base_attack) statsBySpecies.set(id, p);
  }
  const missingFromStats = [];
  for (const id of DYNAMAX_ELIGIBLE_SEED) {
    if (!statsBySpecies.has(id)) missingFromStats.push(id);
  }
  if (missingFromStats.length > 0) {
    console.warn(`⚠  Dynamax seed species not in pogoapi stats: ${missingFromStats.join(", ")}`);
  }
  const topMaxAttackers = [...DYNAMAX_ELIGIBLE_SEED]
    .filter(id => statsBySpecies.has(id))
    .sort((a, b) => statsBySpecies.get(b).base_attack - statsBySpecies.get(a).base_attack);

  // 0.5s fast moves — the "charger" tier. Data-driven source for the
  // Max-Tank filter (App.jsx:1159), emitted as `@1<move>,@1<move>...` after
  // localization through the move-name dictionary. Sorted by name for diff
  // stability.
  const chargerMoves = fast
    .filter(m => m.duration <= MAX_CHARGER_DURATION_MS)
    .map(m => ({ name: m.name, type: m.type.toLowerCase(), duration: m.duration }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const newContent = {
    topPerType: TOP_PER_TYPE,
    maxChargerDurationMs: MAX_CHARGER_DURATION_MS,
    topAttackers,
    topMaxAttackers,
    chargerMoves,
  };

  // Preserve fetchedAt when content didn't change, so a no-op sync doesn't
  // create a noisy commit. Mirror the pattern from fetch-pvp-rankings.mjs.
  let fetchedAt = new Date().toISOString();
  if (existsSync(OUT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(OUT_PATH, "utf8"));
      const { fetchedAt: _prevAt, ...prevContent } = prev;
      if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
        fetchedAt = prev.fetchedAt;
        console.log("  ↺ content unchanged — preserving previous fetchedAt");
      }
    } catch { /* ignore parse errors; fall through to fresh write */ }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
  console.log(`  top attackers:     ${topAttackers.length} species`);
  console.log(`  top max attackers: ${topMaxAttackers.length} species`);
  console.log(`  charger moves:     ${chargerMoves.length} ≤${MAX_CHARGER_DURATION_MS}ms`);
  console.log(`  sample top-5: ${topAttackers.slice(0, 5).join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
