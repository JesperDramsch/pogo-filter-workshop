import React, { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { X, Plus, Copy, Check, ChevronDown, ChevronRight, RotateCcw, Sparkles, Settings, ArrowLeft, Download, Upload } from "lucide-react";
import {
  POKEMON_NAMES_DICT,
  resolveSpecies,
  resolveSpeciesInfo,
  pokemonNameFor,
} from "./data/species.js";
import { pogoKeywords, typeKeyFromKeyword, flagKeyFromKeyword } from "./i18n/pogo-keywords.js";
import RAID_BOSSES from "./data/raid-bosses.json";
import ROCKET_LINEUPS from "./data/rocket-lineups.json";
import ROCKET_GRUNT_QUOTES from "./data/rocket-grunt-quotes.json";
import RocketQuoteLookup from "./explain/RocketQuoteLookup.jsx";
import PVP_RANKINGS from "./data/pvp-rankings.json";
import META_RANKINGS from "./data/meta-rankings.json";
import { useTranslation } from "./i18n/I18nProvider.jsx";
import Landing from "./Landing.jsx";
import General from "./explain/General.jsx";
import Regional from "./explain/Regional.jsx";
import Trade from "./explain/Trade.jsx";
import Rules from "./explain/Rules.jsx";
import Algebra from "./explain/Algebra.jsx";
import {
  AppCredit,
  WorkshopNav,
  WORKSHOP_STEPS,
  STEP_KEY_BY_NUMBER,
  STEP_NUMBER_BY_KEY,
} from "./explain/Shell.jsx";

// Hash-driven routing.
//   ""                    → landing  (the marketing front door)
//   "#workshop"           → workshop (the actual tool)
//   "#explain/general"    → General  (storage triage chapter)
//   "#explain/regional"   → Regional
//   "#explain/trade"      → Trade
//   "#rules"              → Rules
//   "#explain/algebra"    → Algebra  (set-theory deep dive)
// Hash routing avoids the GitHub Pages 404-on-direct-load problem real paths
// would have without a 404.html shim. Everything is shareable/bookmarkable
// and the browser back/forward buttons work for free.
const VIEW_BY_HASH = {
  "": "landing",
  "#workshop": "workshop",
  "#explain/general": "general",
  "#explain/regional": "regional",
  "#explain/trade": "trade",
  "#rules": "rules",
  "#explain/algebra": "algebra",
};
const HASH_BY_VIEW = {
  landing: "",
  workshop: "#workshop",
  general: "#explain/general",
  regional: "#explain/regional",
  trade: "#explain/trade",
  rules: "#rules",
  algebra: "#explain/algebra",
};
// Step-keyed workshop hashes (#workshop/where, #workshop/what, ...) all map
// to the workshop view; the specific step is parsed by `stepFromHash`.
function viewFromHash() {
  if (typeof window === "undefined") return "landing";
  const hash = window.location.hash;
  if (hash.startsWith("#workshop/")) return "workshop";
  return VIEW_BY_HASH[hash] || "landing";
}
function stepFromHash() {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#workshop\/(\w+)$/);
  if (!m) return null;
  return STEP_NUMBER_BY_KEY[m[1]] ?? null;
}
function navigateView(target) {
  if (typeof window === "undefined") return;
  const hash = HASH_BY_VIEW[target] ?? "";
  if (hash === "") {
    if (window.location.hash) {
      window.history.pushState(null, "", window.location.pathname + window.location.search);
      // pushState doesn't fire hashchange, so dispatch a popstate-equivalent.
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

// ─── DATA ──────────────────────────────────────────────────────────────────

export const DEFAULT_HUNDOS = [];
// Personal "top raid attackers" — species the user trusts to bring to a raid
// regardless of typing. Used as an OR-allowlist alongside the type-resistor /
// SE-move clauses, so e.g. Mewtwo always surfaces even when its Psychic
// typing isn't a strict resistor for the boss. Stored as lowercase species
// names; canonicalized to the user's locale on load via `resolveSpecies`.
// Forms (Shadow / Mega / Primal) fold into the base species via family
// search — `mewtwo` covers Shadow Mewtwo and Mega Mewtwo Y both.
//
// Seed source: `src/data/meta-rankings.json` (regenerated daily by
// scripts/fetch-meta-rankings.mjs from pogoapi.net stats + moves). Score
// per (species, type) = base_attack × max charged-move power of that type;
// top-8 per type, deduped union, sorted by best-score-across-types. Killing
// the prior hand-curated tier-list constant: meta drifts every move
// rebalance, so a daily-refreshed data feed beats periodic manual updates.
export const DEFAULT_TOP_ATTACKERS = META_RANKINGS.topAttackers;

// Personal "top Max Battle attackers" — same idea but only relevant to
// Dynamax/Gigantamax encounters. Seed source: same meta-rankings.json,
// filtered through the Dynamax-eligibility seed in fetch-meta-rankings.mjs
// (pogoapi has no Dynamax flag, so the eligibility set is hand-maintained;
// ranking within it is data-driven). Forms fold into base species —
// `charizard` covers Gigantamax Charizard.
export const DEFAULT_TOP_MAX_ATTACKERS = META_RANKINGS.topMaxAttackers;

// Trade-evo families: dex-keyed identity, German base name as the user-facing
// config key (kept stable so persisted localStorage state ["abra", "machollo"]
// keeps working across locale changes). `baseDex` is the family head for
// `+Family` rendering; `memberDex` is the full evolution line for hundo-overlap
// detection.
const TRADE_EVO_FAMILIES = {
  abra:       { baseDex: 63,  memberDex: [63, 64, 65] },
  machollo:   { baseDex: 66,  memberDex: [66, 67, 68] },
  kleinstein: { baseDex: 74,  memberDex: [74, 75, 76] },
  nebulak:    { baseDex: 92,  memberDex: [92, 93, 94] },
  kiesling:   { baseDex: 524, memberDex: [524, 525, 526] },
  praktibalk: { baseDex: 532, memberDex: [532, 533, 534] },
  laukaps:    { baseDex: 588, memberDex: [588, 589] },
  schnuthelm: { baseDex: 616, memberDex: [616, 617] },
  paragoni:   { baseDex: 708, memberDex: [708, 709] },
  irrbis:     { baseDex: 710, memberDex: [710, 711] },
};

// Capitalized base species name in the user's PoGo *output* language —
// used in `+Family` filter syntax. Falls back to the German config key if
// the locale dictionary is missing the entry.
function teDisplay(baseKey, outputLocale = "de") {
  const family = TRADE_EVO_FAMILIES[baseKey];
  const fallback = baseKey.charAt(0).toUpperCase() + baseKey.slice(1);
  if (!family) return fallback;
  const name = pokemonNameFor(String(family.baseDex), outputLocale);
  if (!name) return fallback;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const DEFAULT_CONFIG = {
  // Mode
  expertMode: false,           // hides niche toggles in normal mode

  // PvP
  pvpMode: "strict",           // "loose" | "strict" | "none"

  // Universal protections (most always-on in normal mode; visible in expert)
  protectFavorites: true,
  protectFourStar: true,       // never toss any 4★ hundo (Regel 1) — expert can disable with confirmation
  protectTradeEvos: true,      // protect trade-evolution candidates from trash (free evos via tausch)
  protectAnyTag: true,         // protects ANY tagged Pokémon (catch-all !# clause)
  protectShinies: true,
  protectLuckies: true,
  protectLegendaries: true,
  protectMythicals: true,
  mythTooManyOf: ["meltan", "genesect"], // species you have spares of (canonicalized on load)
  protectUltraBeasts: true,
  protectShadows: true,        // Crypto in trash; trade ALWAYS excludes (untradeable)
  protectPurified: true,
  protectCostumes: true,
  protectBackgrounds: true,
  protectLegacyMoves: true,
  // Smeargle's Sketched moveset always carries the @special flag — without
  // a carve-out, every single Smeargle gets auto-protected. False (default)
  // adds `,smeargle` to the legacy-moves trash clause so regular Smeargles
  // still go in the bin. Expert users can flip this on to revert.
  protectSmeargleLegacy: false,
  protectBabies: true,
  protectXXL: true,
  protectXL: true,
  protectXXS: true,
  protectDoubleMoved: true,
  protectDynamax: true,
  protectNewEvolutions: true,  // (was protectMegaConditional — name simplified, mega0 logic preserved)
  protectBuddies: false,

  // Trade tags (both protected as TAGS in PoGo via #name syntax)
  basarTagName: "Trade",          // bulk trade tag (was hardcoded #)
  fernTauschTagName: "Fern-Tausch", // Niantic's official long-distance trade tag (Dec 2025)

  // Custom tag protections — comma-separated list of additional #tags to protect
  customProtectedTags: "",     // e.g. "pvpiv,keep,shiny-hunting"

  // League tags — configurable for users with different naming conventions
  leagueTags: "ⓤ,ⓖ,ⓛ",       // comma-separated; my default uses Unicode circles

  // Regional groups (populated by App init)
  regionalGroups: {},
  enabledTradeEvos: [],
  customCollectibles: [],      // user-added species to protect (lowercase German names)
  // Trade buddies — list of { id, name, tagPrefix, events: [event-names] }
  // tagPrefix matches any sub-tag (e.g. #Auri matches #Auri:hat-pika via PoGo prefix match).
  buddies: [],

  // Scope safety
  cpCap: 2000,
  ageScopeDays: 30,            // "Vor wie vielen Tagen gefangen — Filterumfang"
  distanceProtect: 100,        // km — Pilot medal protection
  // Lucky-trade protection: catches from this year or earlier are likely
  // guaranteed-lucky candidates (PoGo's lucky-trade window grows with age).
  // Emits `year{N}-` as an AND-clause so old untraded mons stay out of the
  // bulk trash/trade/gift/cheap-evolve outputs. Disable in expert mode by
  // flipping `protectLuckyEligible` off or setting the year to 0.
  protectLuckyEligible: true,
  luckyEligibleYear: 21,       // 2-digit year cutoff; mons caught in this year or later are still trashable

  // Shadows you'd never purify, even during take-over events. Acts as
  // belt-and-suspenders alongside !legendär — the legendary entries here
  // duplicate that protection so the list stays complete if the global
  // flag is ever toggled off. Non-legendary entries cover S / A+ / A tier
  // shadow raid attackers per the community / META.md tier lists, focusing
  // on species without a relevant Mega form (where Shadow IS the canonical
  // top form). Resolved via `resolveSpecies` so users can type in any
  // locale; expanded family-wide (+species) by shadowSafe.
  shadowKeeperSpecies: [
    // S tier shadows
    "dialga","palkia","heatran","groudon","rampardos","salamence","mewtwo",
    // A+ tier shadows
    "greninja","hydreigon","darkrai","toucannon","vikavolt","tyrantrum","conkeldurr",
    "darmanitan","chandelure","excadrill","regigigas","gigalith","kyogre","mamoswine",
    "electivire","magnezone","garchomp","rhyperior","metagross","tyranitar","blaziken",
    "ho-oh","raikou","gardevoir","swampert","dragonite","moltres","gengar","machamp",
    // A tier shadows
    "landorus","kingler","delphox","chesnaught","giratina","emboar","honchkrow","latios",
    "staraptor","weavile","crawdaunt","absol","hariyama","sceptile","entei","aerodactyl",
    "zapdos",
    // A tier non-Mega shadow attackers (Shadow is the top form for these)
    "togekiss","roserade","toxicroak","glaceon","espeon","sylveon",
  ],

  // Optional tag bookkeepers can use to manually flag a non-keeper shadow
  // for Frustration removal during a take-over (e.g. a high-IV gem they
  // want to keep but isn't on the meta-attacker list). Empty by default.
  removeFrustrationTagName: "",

  // Raid + max-battle counter filters. When true, appends `&!@3move` to
  // every per-boss filter, narrowing the result to attackers whose second
  // charge move is already unlocked. Default off so newer accounts still
  // see candidates worth investing in.
  raidRequireSecondMove: false,

  // The preset key the user last clicked, if they haven't tweaked anything
  // in ConfigPanel since. Cleared by any individual toggle change so the
  // marker reflects "what's currently in effect" rather than just history.
  lastAppliedPreset: null,
};

// ─── REGIONAL FORM CHECKS ───────────────────────────────────────────────────
//
// Each entry is grouped by collection theme. Type-checked entries protect a
// regional FORM (e.g. Hisui Typhlosion) without touching the regular form.
// Pure-name entries protect the species outright; if all members of a known
// "form trio" (e.g. all 3 Vivillon patterns) are enabled, we auto-collapse
// to "+Family" syntax to save chars and protect the whole evolution line.

const REGIONAL_GROUPS = {
  alolan: {
    labelKey: "app.regional.alolan.label",
    descriptionKey: "app.regional.alolan.description",
    typeChecks: [
      { species: "Raichu",     type: "psychic",  noteKey: "app.regional.alolan.notes.raichu_psychic" },
      { species: "Sandan",     type: "ice",      noteKey: "app.regional.alolan.notes.sandan_ice" },
      { species: "Vulpix",     type: "ice",      noteKey: "app.regional.alolan.notes.vulpix_ice" },
      { species: "Digda",      type: "steel",    noteKey: "app.regional.alolan.notes.digda_steel" },
      { species: "Mauzi",      type: "dark",     noteKey: "app.regional.alolan.notes.mauzi_dark" },
      { species: "Kleinstein", type: "electric", noteKey: "app.regional.alolan.notes.kleinstein_electric" },
      { species: "Kokowei",    type: "dragon",   noteKey: "app.regional.alolan.notes.kokowei_dragon" },
      { species: "Knogga",     type: "ghost",    noteKey: "app.regional.alolan.notes.knogga_ghost" },
    ],
    collectors: [],
  },
  galarian: {
    labelKey: "app.regional.galarian.label",
    descriptionKey: "app.regional.galarian.description",
    typeChecks: [
      { species: "Smogmog",  type: "fairy",    noteKey: "app.regional.galarian.notes.smogmog_fairy" },
      { species: "Pantimos", type: "ice",      noteKey: "app.regional.galarian.notes.pantimos_ice" },
      { species: "Makabaja", type: "ground",   noteKey: "app.regional.galarian.notes.makabaja_ground" },
      { species: "Porenta",  type: "fighting", noteKey: "app.regional.galarian.notes.porenta_fighting" },
      { species: "Corasonn", type: "ghost",    noteKey: "app.regional.galarian.notes.corasonn_ghost" },
    ],
    collectors: [],
  },
  hisuian: {
    labelKey: "app.regional.hisuian.label",
    descriptionKey: "app.regional.hisuian.description",
    typeChecks: [
      { species: "Tornupto",  type: "ghost",    noteKey: "app.regional.hisuian.notes.tornupto_ghost" },
      { species: "Admurai",   type: "dark",     noteKey: "app.regional.hisuian.notes.admurai_dark" },
      { species: "Dressella", type: "fighting", noteKey: "app.regional.hisuian.notes.dressella_fighting" },
      { species: "Arktilas",  type: "rock",     noteKey: "app.regional.hisuian.notes.arktilas_rock" },
      { species: "Silvarro",  type: "fighting", noteKey: "app.regional.hisuian.notes.silvarro_fighting" },
      { species: "Voltobal",  type: "grass",    noteKey: "app.regional.hisuian.notes.voltobal_grass" },
      { species: "Lektrobal", type: "grass",    noteKey: "app.regional.hisuian.notes.lektrobal_grass" },
      { species: "Sichlor",   type: "rock",     noteKey: "app.regional.hisuian.notes.sichlor_rock" },
    ],
    collectors: [],
  },
  paldean: {
    labelKey: "app.regional.paldean.label",
    descriptionKey: "app.regional.paldean.description",
    typeChecks: [
      { species: "Tauros", type: "fighting", noteKey: "app.regional.paldean.notes.tauros_fighting" },
      { species: "Tauros", type: "fire",     noteKey: "app.regional.paldean.notes.tauros_fire" },
      { species: "Tauros", type: "water",    noteKey: "app.regional.paldean.notes.tauros_water" },
    ],
    collectors: [],
  },
  regionals: {
    labelKey: "app.regional.regionals.label",
    descriptionKey: "app.regional.regionals.description",
    typeChecks: [],
    collectors: [
      // Kontinent-exklusiv (Type 1 polygons in KMZ)
      "Kangama", "Tauros", "Skaraborn", "Corasonn", "Qurtel",
      "Tropius", "Relicanth", "Pachirisu", "Plaudagei",
      "Venuflibis", "Maracamba", "Symvolara", "Bisofank", "Humanolith",
      "Resladero", "Clavion", "Curelei",
      // Type 3 paired (Zangoose/Seviper, Lunatone/Solrock — swap regions periodically)
      "Sengo", "Vipitis",     // Zangoose / Seviper
      "Lunastein", "Sonnfel", // Lunatone / Solrock
      // Type 4 hemispheric (Throh/Sawk, Heatmor/Durant)
      "Karadonis", "Jiutesto",   // Sawk / Throh
      "Furnifraß", "Fermicula",  // Heatmor / Durant
      // Type 5 Big-Three trios (3 continents — Lake Guardians, Elemental Monkeys)
      "Selfe", "Vesprit", "Tobutz",        // Uxie / Mesprit / Azelf
      "Vegimak", "Grillmak", "Sodamak",    // Pansage / Pansear / Panpour
    ],
  },
  collectibles: {
    labelKey: "app.regional.collectibles.label",
    descriptionKey: "app.regional.collectibles.description",
    typeChecks: [],
    collectors: [
      // Vivillon-line — flat collectors; collapses to +Purmel if all 3 selected
      "Purmel", "Puponcho", "Vivillon",
      // Letter / pattern collections
      "Icognito",
      // Rare research/PokéStop encounters with multiple forms
      "Pandir",        // Spinda — 9 patterns, monthly Field Research
      "Kecleon",       // PokéStop hide encounter (rare)
      // Multi-form Pokémon (forms aren't search-distinguishable, so we protect the species)
      "Coiffwaff",     // Furfrou — multiple trims
      "Nigiragi",      // Tatsugiri — Curly/Droopy/Stretchy
      "Schalellos", "Gastrodon",  // West/Ost forms not separately searchable
      "Barschuft",     // Basculin — red/blue stripe forms not separately searchable
    ],
  },
};

// Family expansion: when collectors include all members of a +family,
// collapse to "+Family" instead of repeated entries (saves chars + protects whole line).
const FAMILY_COLLAPSES = {
  "+Purmel": ["Purmel", "Puponcho", "Vivillon"],
};

// Default: all enabled, but each can be toggled or filtered down to specific species.
function defaultRegionalToggles() {
  const out = {};
  for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
    out[key] = {
      enabled: true,
      // null = all species in group are protected; if array, only listed species
      typeChecksEnabled: null,
      collectorsEnabled: null,
    };
  }
  return out;
}

// Pokémon name dictionary, resolvers, and reverse-lookup helpers live in
// src/data/species.js (multi-locale, generated from the published Google
// Sheet via scripts/fetch-translations.mjs at build time). Imported above.

// Normalize a raw config blob (from localStorage on load OR from a JSON
// import file) onto the current DEFAULT_CONFIG shape. Single source of
// truth so any future field rename / removal automatically migrates both
// returning users AND old export files.
//
// Pattern: spread DEFAULT_CONFIG first so missing fields back-fill, then
// the raw blob so user values win, then explicit cleanup for legacy keys
// and renames. Unknown forward-compat keys are preserved.
export function mergeImportedConfig(raw) {
  const merged = { ...DEFAULT_CONFIG, ...(raw || {}) };
  if (!merged.regionalGroups || Object.keys(merged.regionalGroups).length === 0) {
    merged.regionalGroups = defaultRegionalToggles();
  }
  if (!merged.enabledTradeEvos || merged.enabledTradeEvos.length === 0) {
    merged.enabledTradeEvos = Object.keys(TRADE_EVO_FAMILIES);
  }
  // Drop legacy keys (replaced or split)
  delete merged.protectRegionals;
  delete merged.protectSizes;        // split into XXL/XL/XXS
  delete merged.protectLeagueTags;   // replaced with leagueTags string
  delete merged.protectMegaConditional; // renamed to protectNewEvolutions
  delete merged.yearMin;
  // Migrate old field names (read from raw, write to merged)
  if (raw?.mythCarveOuts && !raw.mythTooManyOf) merged.mythTooManyOf = raw.mythCarveOuts;
  if (raw?.protectMegaConditional !== undefined && raw.protectNewEvolutions === undefined) {
    merged.protectNewEvolutions = raw.protectMegaConditional;
  }
  // Old `protectTagged` (catch-all !#) → new `protectAnyTag`
  if (raw?.protectTagged !== undefined && raw.protectAnyTag === undefined) {
    merged.protectAnyTag = raw.protectTagged;
  }
  delete merged.protectTagged;
  // Canonicalize seeded defaults to the storage locale so chips render
  // consistently. Idempotent on already-canonical user input.
  const canonicalize = (arr) => (arr || []).map(s => resolveSpecies(s) || s);
  merged.mythTooManyOf = canonicalize(merged.mythTooManyOf);
  merged.shadowKeeperSpecies = canonicalize(merged.shadowKeeperSpecies);
  return merged;
}

// Pure validator for import envelopes. Returns an error code (not a
// localized string) so the React consumer can render messages from the
// i18n bundle. Code is one of: "invalid_json" (parsed isn't an object),
// "wrong_schema" (no schema field or unrecognized prefix),
// "unsupported_version" (right prefix but unknown version).
//
// Kept module-scope + pure so it's directly testable without React state.
export const SCHEMA_PREFIX = "pogo-filter-workshop/";
export const SCHEMA_CURRENT = "pogo-filter-workshop/v1";
export function validateImportEnvelope(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: { code: "invalid_json" } };
  }
  if (typeof parsed.schema !== "string" || !parsed.schema.startsWith(SCHEMA_PREFIX)) {
    return { ok: false, error: { code: "wrong_schema" } };
  }
  if (parsed.schema !== SCHEMA_CURRENT) {
    return { ok: false, error: { code: "unsupported_version", params: { schema: parsed.schema } } };
  }
  return { ok: true, envelope: parsed };
}

// Pure "what state should the setters receive" computation. Mirrors the
// shape filtering inline in the previous applyImportEnvelope: only
// includes a key in the result if the envelope has a recognizable value.
// Caller uses `if ("hundos" in prepared)` etc. to gate setter calls.
export function prepareImport(envelope) {
  const d = (envelope && envelope.data) || {};
  const canonicalize = (arr) => (arr || []).map(s => resolveSpecies(s) || s);
  const out = {};
  if (Array.isArray(d.hundos))          out.hundos = d.hundos;
  if (Array.isArray(d.topAttackers))    out.topAttackers = canonicalize(d.topAttackers);
  if (Array.isArray(d.topMaxAttackers)) out.topMaxAttackers = canonicalize(d.topMaxAttackers);
  if (d.config && typeof d.config === "object") out.config = mergeImportedConfig(d.config);
  if (d.homeLocation === null || (Array.isArray(d.homeLocation) && d.homeLocation.length === 2)) {
    out.homeLocation = d.homeLocation;
  }
  if (Array.isArray(d.bazaarTags)) out.bazaarTags = d.bazaarTags;
  return out;
}

// ─── FILTER GENERATION (set-theoretic) ────────────────────────────────────

function deduppedTradeEvos(hundos, enabled) {
  // Locale-independent overlap detection: convert each hundo to its dex# (via
  // multi-locale resolver) and check intersection with each family's memberDex.
  // This way the function works regardless of which language the hundos are
  // stored in.
  const hundoDex = new Set();
  for (const h of hundos) {
    const info = resolveSpeciesInfo(h);
    if (info) hundoDex.add(info.dex);
  }
  const trimmed = [];
  const full = [];
  for (const base of enabled) {
    const family = TRADE_EVO_FAMILIES[base];
    if (!family) continue;
    full.push(base);
    const overlapsH = family.memberDex.some(d => hundoDex.has(d));
    if (!overlapsH) trimmed.push(base);
  }
  return { full, trimmed };
}

// Helper: split comma-separated tag list, returning array of trimmed tag names.
function parseTagList(s) {
  return (s || "").split(",").map(t => t.trim()).filter(Boolean);
}

// Helper: collapse collectors to family names where possible.
function collapseFamilies(speciesList, familyCollapses) {
  const remaining = new Set(speciesList);
  const out = [];
  for (const [familyTag, members] of Object.entries(familyCollapses)) {
    if (members.every(m => remaining.has(m))) {
      out.push(familyTag);
      members.forEach(m => remaining.delete(m));
    }
  }
  for (const sp of speciesList) {
    if (remaining.has(sp)) out.push(sp);
  }
  return out;
}

// Resolves a species name (in any locale) to its lowercase form in the output
// locale, ready for filter syntax. Falls back to the input lowercased if no
// match — keeps user-typed names working even if the dictionary is incomplete.
function speciesForOutput(name, outputLocale) {
  const resolved = resolveSpecies(name, outputLocale);
  if (resolved) return resolved;
  return String(name).toLowerCase();
}

// Capitalizes for + filter syntax (PoGo accepts case-insensitive but
// capitalized reads better in copy-pasted filters).
function capFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildFilters(hundos, cfg, homeLocals = [], outputLocale = "de", tFn = (k) => k) {
  const kw = pogoKeywords(outputLocale);

  // Hundos are stored in the user's output-locale lowercase form. Re-render in
  // case the locale changed since they were typed (resolveSpecies normalizes).
  const hundosOut = hundos.map(h => speciesForOutput(h, outputLocale));
  const H = hundosOut.map(h => `+${h}`).join(",");

  // Personal allowlists for the two PvE-counter contexts. Different rosters
  // because most raid meta attackers (Mewtwo, Rayquaza, Garchomp, …) aren't
  // Dynamax-capable, so a separate Max-Battle list avoids polluting the
  // Max filter with species that get filtered out by `dynaattacke1-`
  // anyway. Both emit bare-name OR-prefixes into each counter clause.
  const topAttackersList = (cfg.topAttackers || [])
    .map(s => speciesForOutput(s, outputLocale))
    .filter(Boolean);
  const topMaxAttackersList = (cfg.topMaxAttackers || [])
    .map(s => speciesForOutput(s, outputLocale))
    .filter(Boolean);

  const { full: TE_full, trimmed: TE_trim } = deduppedTradeEvos(hundos, cfg.enabledTradeEvos);
  const TE_full_str = TE_full.map(b => `+${teDisplay(b, outputLocale)}`).join(",");
  const TE_trim_str = TE_trim.map(b => `+${teDisplay(b, outputLocale)}`).join(",");

  // PoGo's IV-bucket filter accepts ranges like `0-2{atk}` but SILENTLY
  // IGNORES `!N` negation on IV tokens — so `!4{atk}` is a no-op. We encode
  // "atk ≠ 4" as the positive range `0-3{atk}` instead.
  // Buckets: 0 = 0 IV, 1 = 1-5, 2 = 6-10, 3 = 11-14, 4 = 15
  const ivK1Bad = `0-3${kw.iv.atk},0-3${kw.iv.def},0-2${kw.iv.hp}`;
  const ivK2Bad = `0-3${kw.iv.atk},0-2${kw.iv.def},0-3${kw.iv.hp}`;
  const ivK3Bad = `0-2${kw.iv.atk},0-3${kw.iv.def},0-3${kw.iv.hp}`;
  const ivPvPLoose  = `2-4${kw.iv.atk},0-2${kw.iv.def},0-2${kw.iv.hp}`;
  const ivPvPStrict = `1-4${kw.iv.atk},0-2${kw.iv.def},0-2${kw.iv.hp}`;

  const notP = cfg.pvpMode === "loose"  ? ivPvPLoose
            : cfg.pvpMode === "strict" ? ivPvPStrict
            : null;

  const S012 = "0*,1*,2*";

  // Configurable lists
  const leagueTags = parseTagList(cfg.leagueTags);
  const customTags = parseTagList(cfg.customProtectedTags);
  const basarTag = (cfg.basarTagName || "").trim();
  const fernTauschTag = (cfg.fernTauschTagName || "").trim();

  const trashClauses = [];
  const tradeClauses = [];
  const push = (arr, clause, why) => arr.push({ clause, why });

  // ── TRASH ──────────────────────────────────────────────────────────────
  push(trashClauses, [S012, H].filter(Boolean).join(","), tFn("app.clause_why.h_union_s012"));
  push(trashClauses, `${S012},${ivK1Bad}`, tFn("app.clause_why.not_k1"));
  push(trashClauses, `${S012},${ivK2Bad}`, tFn("app.clause_why.not_k2"));
  push(trashClauses, `${S012},${ivK3Bad}`, tFn("app.clause_why.not_k3"));
  if (notP) push(trashClauses, notP, tFn("app.clause_why.not_p", { params: { mode: cfg.pvpMode } }));

  if (cfg.protectTradeEvos && TE_full.length > 0) {
    for (const base of TE_full) {
      const display = teDisplay(base, outputLocale);
      push(trashClauses, `!+${display},${kw.flag.traded}`,
        tFn("app.clause_why.trade_evo_family", { params: { name: display } }));
    }
  }

  if (cfg.protectFourStar) {
    push(trashClauses, "!4*", tFn("app.clause_why.rule1_no_4star"));
  }

  // Tag protections
  const activeBuddies = (cfg.buddies || []).filter(b => b.active !== false && b.tagPrefix);
  if (cfg.protectAnyTag) {
    push(trashClauses, "!#", tFn("app.clause_why.any_tag_trash"));
  } else {
    if (basarTag) push(trashClauses, `!#${basarTag}`, tFn("app.clause_why.bazaar_tag", { params: { tag: basarTag } }));
    if (fernTauschTag) push(trashClauses, `!#${fernTauschTag}`, tFn("app.clause_why.fern_tausch_tag", { params: { tag: fernTauschTag } }));
    for (const t of customTags) push(trashClauses, `!#${t}`, tFn("app.clause_why.custom_tag", { params: { tag: t } }));
    for (const b of activeBuddies) {
      const prefix = b.tagPrefix.replace(/^#/, "");
      push(trashClauses, `!#${prefix}`, tFn("app.clause_why.buddy_tag", { params: { name: b.name, prefix } }));
    }
  }

  // Universal protections
  if (cfg.protectFavorites)    push(trashClauses, `!${kw.flag.favorite}`, tFn("app.clause_why.favorites"));
  if (cfg.protectShinies)      push(trashClauses, `!${kw.flag.shiny}`, tFn("app.clause_why.shinies"));
  if (cfg.protectLegendaries)  push(trashClauses, `!${kw.flag.legendary}`, tFn("app.clause_why.legendaries"));
  if (cfg.protectMythicals) {
    const carve = (cfg.mythTooManyOf || [])
      .map(s => speciesForOutput(s, outputLocale))
      .filter(Boolean)
      .join(",");
    push(trashClauses,
      carve ? `!${kw.flag.mythical},${carve}` : `!${kw.flag.mythical}`,
      carve
        ? tFn("app.clause_why.mythicals_carved", { params: { carve } })
        : tFn("app.clause_why.mythicals"));
  }
  if (cfg.protectUltraBeasts)  push(trashClauses, `!${kw.flag.ultra_beast}`, tFn("app.clause_why.ultra_beasts"));
  if (cfg.protectShadows)      push(trashClauses, `!${kw.flag.shadow}`, tFn("app.clause_why.shadows"));
  if (cfg.protectCostumes)     push(trashClauses, `!${kw.flag.costume}`, tFn("app.clause_why.costumes"));
  if (cfg.protectLuckies)      push(trashClauses, `!${kw.flag.lucky}`, tFn("app.clause_why.luckies"));
  if (cfg.protectBackgrounds)  push(trashClauses, `!${kw.flag.background}`, tFn("app.clause_why.backgrounds"));
  if (cfg.protectDynamax)      push(trashClauses, `!${kw.flag.dynamax_move}1-`, tFn("app.clause_why.dynamax"));
  if (cfg.protectNewEvolutions) push(trashClauses, `!${kw.flag.new_evo},${kw.flag.mega}0`, tFn("app.clause_why.new_evolutions"));
  if (cfg.protectLegacyMoves) {
    // Carve out Smeargle by default: every Smeargle has @special-flagged
    // Sketched moves, so without ',smeargle' the clause would protect them
    // all. With OR-binding-tighter precedence, `!@special,smeargle` parses
    // as (!@special ∪ smeargle) — i.e. keep is "@special AND NOT smeargle".
    //
    // Same OR trick peels off purified-Return junk and still-Frustration
    // shadows: `!@special,@return,@frustration` trashes them despite the
    // @special flag PoGo paints on Return/Frustration carriers.
    const smeargleName = pokemonNameFor("235", outputLocale)?.toLowerCase() || "smeargle";
    const legacySuffix = `,@${kw.flag.return},@${kw.flag.frustration}`;
    const clause = cfg.protectSmeargleLegacy
      ? `!@${kw.flag.special_move}${legacySuffix}`
      : `!@${kw.flag.special_move}${legacySuffix},${smeargleName}`;
    push(trashClauses, clause, tFn("app.clause_why.legacy_moves"));
  }
  if (cfg.protectBabies)       push(trashClauses, `!${kw.flag.baby}`, tFn("app.clause_why.babies"));
  if (cfg.distanceProtect && cfg.distanceProtect > 0)
    push(trashClauses, `!${kw.numeric.distance}${cfg.distanceProtect}-,${kw.flag.traded}`, tFn("app.clause_why.distance", { params: { km: cfg.distanceProtect } }));
  if (cfg.protectXXL)          push(trashClauses, `!${kw.flag.xxl}`, tFn("app.clause_why.xxl"));
  if (cfg.protectXL)           push(trashClauses, `!${kw.flag.xl}`,  tFn("app.clause_why.xl"));
  if (cfg.protectXXS)          push(trashClauses, `!${kw.flag.xxs}`, tFn("app.clause_why.xxs"));
  for (const t of leagueTags)  push(trashClauses, `!${t}`, tFn("app.clause_why.league_tag", { params: { tag: t } }));
  if (cfg.protectBuddies)      push(trashClauses, `!${kw.numeric.buddy}1-`, tFn("app.clause_why.buddies_were"));
  if (cfg.protectDoubleMoved)  push(trashClauses, "@3move", tFn("app.clause_why.double_moved_trash"));

  // Regional groups
  const groups = cfg.regionalGroups || {};
  const hundoOutSet = new Set(hundosOut);
  for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
    const state = groups[key];
    if (!state || !state.enabled) continue;
    for (const tc of group.typeChecks) {
      if (state.typeChecksEnabled !== null && !state.typeChecksEnabled.includes(tc.species)) continue;
      const speciesOut = speciesForOutput(tc.species, outputLocale);
      const speciesDisplay = capFirst(speciesOut);
      const typeOut = kw.type[tc.type] || tc.type;
      push(trashClauses, `!${speciesDisplay},!${typeOut}`, `${tFn(group.labelKey)}: ${tFn(tc.noteKey)}`);
    }
    // Collectors — resolve each to outputLocale, then collapse families
    const enabledCollectorsOut = group.collectors
      .filter(sp => state.collectorsEnabled === null || state.collectorsEnabled.includes(sp))
      .map(sp => speciesForOutput(sp, outputLocale))
      .filter(sp => !hundoOutSet.has(sp));
    const collapsed = collapseFamilies(enabledCollectorsOut, FAMILY_COLLAPSES);
    for (const entry of collapsed) {
      const groupLabel = tFn(group.labelKey);
      push(trashClauses, `!${entry}`,
        entry.startsWith("+")
          ? `${groupLabel}: ${entry} (${tFn("app.regional_editor.all_family_members")})`
          : `${groupLabel}: ${entry}`);
    }
  }
  // Custom collectibles
  const allRegionalCollectorsOut = new Set(
    Object.values(REGIONAL_GROUPS)
      .flatMap(g => g.collectors)
      .map(sp => speciesForOutput(sp, outputLocale))
  );
  for (const sp of (cfg.customCollectibles || [])) {
    const lower = speciesForOutput(sp, outputLocale);
    if (hundoOutSet.has(lower)) continue;
    if (allRegionalCollectorsOut.has(lower)) continue;
    const display = capFirst(lower);
    push(trashClauses, `!${display}`, tFn("app.clause_why.custom_collectible", { params: { name: display } }));
  }
  if (cfg.cpCap && cfg.cpCap > 0)
    push(trashClauses, `${kw.numeric.cp}-${cfg.cpCap}`, tFn("app.clause_why.cp_cap", { params: { cp: cfg.cpCap } }));
  if (cfg.ageScopeDays && cfg.ageScopeDays > 0)
    push(trashClauses, `${kw.numeric.age}-${cfg.ageScopeDays},${kw.flag.traded},${kw.flag.purified}`, tFn("app.clause_why.age_traded", { params: { days: cfg.ageScopeDays } }));
  if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
    push(trashClauses, `${kw.numeric.year}${cfg.luckyEligibleYear}-,${kw.flag.traded}`, tFn("app.clause_why.lucky_eligible", { params: { year: cfg.luckyEligibleYear } }));

  const trash = trashClauses.map(c => c.clause).join("&");

  // ── TRADE ──────────────────────────────────────────────────────────────
  push(tradeClauses, [S012, TE_trim_str, H].filter(Boolean).join(","), tFn("app.clause_why.h_s012_te"));
  push(tradeClauses, [S012, TE_full_str, ivK1Bad].filter(Boolean).join(","), tFn("app.clause_why.not_k1_te"));
  push(tradeClauses, [S012, TE_full_str, ivK2Bad].filter(Boolean).join(","), tFn("app.clause_why.not_k2_te"));
  push(tradeClauses, [S012, TE_full_str, ivK3Bad].filter(Boolean).join(","), tFn("app.clause_why.not_k3_te"));
  if (notP) push(tradeClauses, notP, tFn("app.clause_why.not_p", { params: { mode: cfg.pvpMode } }));

  // Mandatory trade constraints (physical game rules — always apply)
  push(tradeClauses, `!${kw.flag.traded}`, tFn("app.clause_why.must_traded"));
  push(tradeClauses, `!${kw.flag.shadow}`, tFn("app.clause_why.must_shadow"));
  push(tradeClauses, `!${kw.flag.lucky}`, tFn("app.clause_why.must_lucky_long"));
  push(tradeClauses, `!${kw.flag.mythical},808,809`, tFn("app.clause_why.must_mythical_long"));

  if (cfg.protectAnyTag) {
    push(tradeClauses, "!#", tFn("app.clause_why.any_tag_trade"));
  } else {
    if (basarTag) push(tradeClauses, `!#${basarTag}`,
      tFn("app.clause_why.bazaar_tag_trade", { params: { tag: basarTag } }));
    if (fernTauschTag) push(tradeClauses, `!#${fernTauschTag}`, tFn("app.clause_why.fern_tausch_tag_trade", { params: { tag: fernTauschTag } }));
    for (const t of customTags) push(tradeClauses, `!#${t}`, tFn("app.clause_why.custom_tag", { params: { tag: t } }));
  }

  if (cfg.protectLegendaries)  push(tradeClauses, `!${kw.flag.legendary}`, tFn("app.clause_why.legendaries"));
  if (cfg.protectUltraBeasts)  push(tradeClauses, `!${kw.flag.ultra_beast}`, tFn("app.clause_why.ultra_beasts"));
  if (cfg.protectShinies)      push(tradeClauses, `!${kw.flag.shiny}`, tFn("app.clause_why.shinies_trade"));
  if (cfg.protectCostumes)     push(tradeClauses, `!${kw.flag.costume}`, tFn("app.clause_why.costumes_trade"));
  if (cfg.protectPurified)     push(tradeClauses, `!${kw.flag.purified}`, tFn("app.clause_why.purified"));
  if (cfg.protectBackgrounds)  push(tradeClauses, `!${kw.flag.background}`, tFn("app.clause_why.backgrounds_trade"));
  if (cfg.protectFavorites)    push(tradeClauses, `!${kw.flag.favorite}`, tFn("app.clause_why.favorites"));
  push(tradeClauses, "!4*", tFn("app.clause_why.rule1_no_4star_trade"));
  for (const t of leagueTags)  push(tradeClauses, `!${t}`, tFn("app.clause_why.league_tag", { params: { tag: t } }));
  if (cfg.protectDoubleMoved)  push(tradeClauses, "@3move", tFn("app.clause_why.double_moved_trade"));
  if (cfg.protectDynamax)      push(tradeClauses, `!${kw.flag.dynamax_move}1-`, tFn("app.clause_why.dynamax"));
  if (cfg.protectXXL)          push(tradeClauses, `!${kw.flag.xxl}`, tFn("app.clause_why.xxl_trade"));
  if (cfg.protectXL)           push(tradeClauses, `!${kw.flag.xl}`,  tFn("app.clause_why.xl_trade"));
  if (cfg.protectLegacyMoves)  push(tradeClauses, `!@${kw.flag.special_move},@${kw.flag.return},@${kw.flag.frustration}`, tFn("app.clause_why.legacy_moves"));
  if (cfg.ageScopeDays && cfg.ageScopeDays > 0)
    push(tradeClauses, `${kw.numeric.age}-${cfg.ageScopeDays},${kw.flag.purified}`, tFn("app.clause_why.age_only", { params: { days: cfg.ageScopeDays } }));
  if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
    push(tradeClauses, `${kw.numeric.year}${cfg.luckyEligibleYear}-`, tFn("app.clause_why.lucky_eligible", { params: { year: cfg.luckyEligibleYear } }));
  push(tradeClauses, `${kw.numeric.distance}0-`, tFn("app.clause_why.distance_zero"));

  const trade = tradeClauses.map(c => c.clause).join("&");

  // ── PRE-STAGED TRADES ──────────────────────────────────────────────────
  const prestagedClauses = [];
  const tagList = [];
  if (basarTag)      tagList.push(`#${basarTag}`);
  if (fernTauschTag) tagList.push(`#${fernTauschTag}`);
  if (tagList.length > 0) {
    push(prestagedClauses, tagList.join(","), tFn("app.clause_why.prestaged_marked", { params: { tags: `#${basarTag}${fernTauschTag ? ` oder #${fernTauschTag}` : ""}` } }));
    push(prestagedClauses, `!${kw.flag.traded}`, tFn("app.clause_why.must_traded_short"));
    push(prestagedClauses, `!${kw.flag.shadow}`, tFn("app.clause_why.must_shadow_short"));
    push(prestagedClauses, `!${kw.flag.lucky}`, tFn("app.clause_why.must_lucky_short"));
    push(prestagedClauses, `!${kw.flag.mythical},808,809`, tFn("app.clause_why.must_mythical_short"));
  }
  const prestaged = prestagedClauses.map(c => c.clause).join("&");

  // ── BUDDY FILTERS ──────────────────────────────────────────────────────
  const buddyCatchFilters = [];
  for (const b of activeBuddies) {
    const prefix = b.tagPrefix.replace(/^#/, "");
    const targets = (b.targetSpecies || []).filter(Boolean).map(s => speciesForOutput(s, outputLocale));
    const wantsTE = !!b.wantsTradeEvos && TE_full.length > 0;
    if (targets.length === 0 && !wantsTE) continue;

    const catchClauses = [];
    const speciesParts = [
      ...targets.map(s => `+${s}`),
      ...(wantsTE ? TE_full.map(base => `+${teDisplay(base, outputLocale)}`) : []),
    ];
    const why = [
      targets.length > 0 ? tFn("app.clause_why.buddy_targets_count", { params: { count: targets.length } }) : null,
      wantsTE ? tFn("app.clause_why.buddy_te_count", { params: { count: TE_full.length } }) : null,
    ].filter(Boolean).join(" + ");
    push(catchClauses, speciesParts.join(","), `${b.name}: ${why}`);
    push(catchClauses, "0*,1*,2*", tFn("app.clause_why.trashable_stars"));
    push(catchClauses, "!#", tFn("app.clause_why.not_tagged"));
    push(catchClauses, `!${kw.flag.favorite}`, tFn("app.clause_why.favorites_protected"));
    push(catchClauses, `!${kw.flag.traded}`, tFn("app.clause_why.must_traded_short"));
    push(catchClauses, `!${kw.flag.shadow}`, tFn("app.clause_why.must_shadow_short"));
    push(catchClauses, `!${kw.flag.lucky}`, tFn("app.clause_why.must_lucky_short"));
    push(catchClauses, `!${kw.flag.mythical},808,809`, tFn("app.clause_why.must_mythical_short"));
    push(catchClauses, `!${kw.flag.shiny}`, tFn("app.clause_why.shinies_keep"));
    push(catchClauses, `!${kw.flag.legendary}`, tFn("app.clause_why.legendaries_keep"));
    buddyCatchFilters.push({
      buddyName: b.name,
      prefix,
      filter: catchClauses.map(c => c.clause).join("&"),
      clauses: catchClauses,
    });
  }

  // ── HUNDO-SORT ─────────────────────────────────────────────────────────
  const sortClauses = [];
  if (hundos.length > 0) {
    push(sortClauses, H, tFn("app.clause_why.all_hundo_families"));
    if (cfg.protectAnyTag)   push(sortClauses, "!#", tFn("app.clause_why.all_tags_protected"));
    if (cfg.protectFavorites) push(sortClauses, `!${kw.flag.favorite}`, tFn("app.clause_why.favorites_protected"));
    if (cfg.protectShinies)  push(sortClauses, `!${kw.flag.shiny}`, tFn("app.clause_why.shinies_protected"));
    if (cfg.protectLuckies)  push(sortClauses, `!${kw.flag.lucky}`, tFn("app.clause_why.luckies_protected"));
  }
  const sort = sortClauses.map(c => c.clause).join("&");

  // ── GIFT FILTER ────────────────────────────────────────────────────────
  const giftClauses = [];
  const valuables = [kw.flag.shiny, kw.flag.legendary, kw.flag.ultra_beast, kw.flag.costume, kw.flag.background];
  const homeLocalsList = (homeLocals || []).map(n => speciesForOutput(n, outputLocale)).filter(Boolean);
  const valueParts = [...valuables, ...homeLocalsList];
  if (valueParts.length > 0) {
    const valueWhy = homeLocalsList.length > 0
      ? tFn("app.clause_why.valuables_with_locals", { params: { count: homeLocalsList.length } })
      : tFn("app.clause_why.valuables_no_locals");
    push(giftClauses, valueParts.join(","), valueWhy);
  }
  push(giftClauses, `!${kw.flag.traded}`, tFn("app.clause_why.gift_must_traded"));
  push(giftClauses, `!${kw.flag.shadow}`, tFn("app.clause_why.gift_must_shadow"));
  push(giftClauses, `!${kw.flag.mythical},808,809`, tFn("app.clause_why.must_mythical_short"));
  push(giftClauses, `!${kw.flag.lucky}`, tFn("app.clause_why.gift_must_lucky"));
  push(giftClauses, "!4*", tFn("app.clause_why.never_gift_4star"));
  push(giftClauses, `!${kw.flag.favorite}`, tFn("app.clause_why.favorites_protected"));
  // Unconditional (unlike trash/trade which gate on cfg.protectLegacyMoves):
  // gifting transfers the mon away, so the legacy move is unrecoverable.
  // Same family as the mandatory !traded / !shadow / !lucky constraints above.
  push(giftClauses, `!@${kw.flag.special_move},@${kw.flag.return},@${kw.flag.frustration}`, tFn("app.clause_why.never_gift_legacy"));
  if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
    push(giftClauses, `${kw.numeric.year}${cfg.luckyEligibleYear}-`, tFn("app.clause_why.lucky_eligible", { params: { year: cfg.luckyEligibleYear } }));
  const tagAllowList = [];
  if (basarTag)      tagAllowList.push(`#${basarTag}`);
  if (fernTauschTag) tagAllowList.push(`#${fernTauschTag}`);
  if (tagAllowList.length > 0) {
    push(giftClauses, `!#,${tagAllowList.join(",")}`,
      tFn("app.clause_why.untagged_or_marked", { params: { tags: tagAllowList.join(", ") } }));
  } else {
    push(giftClauses, "!#", tFn("app.clause_why.other_tags_protected"));
  }
  const gift = giftClauses.map(c => c.clause).join("&");

  // ── AUX FILTERS — task-oriented pro tools, paste these into the search
  //    box to *find* candidates (positive search filters, not the inverted
  //    trash style). Grouped by game aspect: shadows / evos / trades.

  // -- SHADOW · cheap purify --------------------------------------------
  // Common-rarity shadows for level-up-task fodder. Cost on purify scales
  // with species rarity, not IV — so we filter by 1km-buddy-walk (the
  // common pool: Pidgey, Magikarp, Eevee line, ...). 1km walks naturally
  // exclude legendaries / mythicals / pseudo-legendaries (5km+).
  //
  // Investment gate: `@frustration` (positive) — only match shadows that
  // STILL have the default Frustration charged move. A shadow whose
  // Frustration was Charge-TM'd off (during a Rocket take-over) is a real
  // TM investment; purifying it loses the move and the +20% atk boost.
  // `!@special` would NOT catch this case: a TM'd shadow with no other
  // legacy (e.g. Tyranitar with Crunch+Stone Edge) has no @special flag
  // and would slip through. `@frustration` is the surgical positive gate.
  const shadowCheapClauses = [];
  push(shadowCheapClauses, kw.flag.shadow,                          tFn("app.clause_why.shadow_cheap_pool"));
  push(shadowCheapClauses, `${kw.numeric.candy_km}1`,               tFn("app.clause_why.shadow_cheap_common"));
  push(shadowCheapClauses, `!${kw.flag.shiny}`,                     tFn("app.clause_why.shinies_protected"));
  push(shadowCheapClauses, `@${kw.flag.frustration}`,               tFn("app.clause_why.frustration_unmoved", { params: { move: kw.flag.frustration } }));
  push(shadowCheapClauses, `!${kw.flag.favorite}`,                  tFn("app.clause_why.favorites"));
  push(shadowCheapClauses, "!#",                                    tFn("app.clause_why.tags_protected_short"));
  const shadowCheap = shadowCheapClauses.map(c => c.clause).join("&");

  // -- SHADOW · safe purify (mass purify, keep raid attackers) ---------
  // Excludes legendaries / mythicals / UBs / 4★ / shinies / costumes,
  // plus a user-curated list of top raid-attacker species
  // (`shadowKeeperSpecies`) family-wide via `+`.
  //
  // Investment gate: `@frustration` (same reasoning as shadowCheap above)
  // — only purify shadows still in default state. A Charge-TM'd shadow
  // is an investment; purifying it loses the TM and the +20% boost.
  const keeperResolved = (cfg.shadowKeeperSpecies || [])
    .map((s) => speciesForOutput(s, outputLocale))
    .filter(Boolean);
  const shadowSafeClauses = [];
  push(shadowSafeClauses, kw.flag.shadow,                           tFn("app.clause_why.shadow_safe_pool"));
  push(shadowSafeClauses, `!${kw.flag.legendary}`,                  tFn("app.clause_why.legendaries"));
  push(shadowSafeClauses, `!${kw.flag.mythical}`,                   tFn("app.clause_why.mythicals_short"));
  push(shadowSafeClauses, `!${kw.flag.ultra_beast}`,                tFn("app.clause_why.ultra_beasts"));
  push(shadowSafeClauses, "!4*",                                    tFn("app.clause_why.never_4star"));
  push(shadowSafeClauses, `!${kw.flag.shiny}`,                      tFn("app.clause_why.shinies_protected"));
  push(shadowSafeClauses, `!${kw.flag.costume}`,                    tFn("app.clause_why.costumes"));
  push(shadowSafeClauses, `@${kw.flag.frustration}`,                tFn("app.clause_why.frustration_unmoved", { params: { move: kw.flag.frustration } }));
  push(shadowSafeClauses, `!${kw.flag.favorite}`,                   tFn("app.clause_why.favorites"));
  push(shadowSafeClauses, "!#",                                     tFn("app.clause_why.tags_protected_short"));
  for (const sp of keeperResolved) {
    push(shadowSafeClauses, `!+${sp}`, tFn("app.clause_why.shadow_keeper_species", { params: { species: sp } }));
  }
  const shadowSafe = shadowSafeClauses.map(c => c.clause).join("&");

  // -- SHADOW · TM Frustration (take-over event) ------------------------
  // During take-over events, Charge TM removes Frustration. Surface the
  // shadows worth saving the TMs for: keeper-species attackers + anything
  // the user manually tagged for removal.
  const removeTag = (cfg.removeFrustrationTagName || "").trim();
  const keeperFamilyTerms = keeperResolved.map((sp) => `+${sp}`);
  const tagTerm = removeTag ? `#${removeTag}` : null;
  const includePool = [...keeperFamilyTerms, tagTerm].filter(Boolean).join(",");
  const shadowFrustrationClauses = [];
  if (includePool && kw.flag.frustration) {
    push(shadowFrustrationClauses, kw.flag.shadow,                  tFn("app.clause_why.shadow_only"));
    push(shadowFrustrationClauses, `@${kw.flag.frustration}`,       tFn("app.clause_why.frustration_move", { params: { move: kw.flag.frustration } }));
    push(shadowFrustrationClauses, includePool,
      removeTag
        ? tFn("app.clause_why.frustration_pool_with_tag", { params: { tag: removeTag } })
        : tFn("app.clause_why.frustration_pool_keepers_only"));
  }
  const shadowFrustration = shadowFrustrationClauses.map(c => c.clause).join("&");

  // -- SHADOW · purify-to-hundo candidates ------------------------------
  // PoGo's appraisal search is bucket-based: bucket 3 = IV 11-14, bucket
  // 4 = IV 15. `3-4{atk}&3-4{def}&3-4{hp}` matches IV ≥11 in every stat.
  // Purify adds +2 (capped at 15), so IV 13/14/15 → 15 (hundo) but IV
  // 11/12 → 13/14 (NOT hundo). This is therefore a *candidate* set —
  // review each match before purifying, since PoGo's bucket syntax can't
  // isolate IV ≥13. Excludes already-4★ shadows.
  //
  // Investment gate: `@frustration` — a high-IV shadow whose Frustration
  // was Charge-TM'd off is doubly valuable (TM investment + Shadow boost).
  // Purifying it would lose both. Only surface default-state shadows.
  const shadowHundoClauses = [];
  push(shadowHundoClauses, kw.flag.shadow,                          tFn("app.clause_why.shadow_only"));
  push(shadowHundoClauses, `@${kw.flag.frustration}`,               tFn("app.clause_why.frustration_unmoved", { params: { move: kw.flag.frustration } }));
  push(shadowHundoClauses, `3-4${kw.iv.atk}`,                       tFn("app.clause_why.iv_bucket_high_atk"));
  push(shadowHundoClauses, `3-4${kw.iv.def}`,                       tFn("app.clause_why.iv_bucket_high_def"));
  push(shadowHundoClauses, `3-4${kw.iv.hp}`,                        tFn("app.clause_why.iv_bucket_high_hp"));
  push(shadowHundoClauses, "!4*",                                   tFn("app.clause_why.exclude_already_4star"));
  const shadowHundoCandidates = shadowHundoClauses.map(c => c.clause).join("&");

  // -- EVOS · cheap full-evolve -----------------------------------------
  // Two paths combined via distribution to CNF (see Algebra chapter §8):
  //   cheap = (early ∪ TE_basics) ∩ (early ∪ traded) ∩ (modifiers)
  // `early` = low-candy XP lines; `TE_basics` = pre-final members of every
  // trade-evo family (drop the final form — Alakazam/Machamp/etc. — since
  // it doesn't evolve further). Resolved to locale-specific species names
  // so the filter reads naturally in the user's PoGo client.
  const dexToName = (d) => pokemonNameFor(String(d), outputLocale)?.toLowerCase();
  const earlyDexes = [10, 13, 16, 265, 293, 519];
  const teBasicsDexes = Object.values(TRADE_EVO_FAMILIES)
    .flatMap(f => f.memberDex.slice(0, -1));
  const earlyList = earlyDexes.map(dexToName).filter(Boolean).join(",");
  const teBasicsList = [...earlyDexes, ...teBasicsDexes].map(dexToName).filter(Boolean).join(",");
  const cheapEvolveClauses = [];
  push(cheapEvolveClauses, teBasicsList,                            tFn("app.clause_why.cheap_evolve_either"));
  push(cheapEvolveClauses, `${earlyList},${kw.flag.traded}`,        tFn("app.clause_why.cheap_evolve_traded_path"));
  push(cheapEvolveClauses, "0*,1*,2*",                              tFn("app.clause_why.cheap_evolve_low_iv"));
  push(cheapEvolveClauses, `!${kw.flag.shiny}`,                     tFn("app.clause_why.shinies_protected"));
  push(cheapEvolveClauses, `!${kw.flag.costume}`,                   tFn("app.clause_why.costumes_trade"));
  push(cheapEvolveClauses, `!@${kw.flag.special_move},@${kw.flag.return},@${kw.flag.frustration}`, tFn("app.clause_why.legacy_moves"));
  if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
    push(cheapEvolveClauses, `${kw.numeric.year}${cfg.luckyEligibleYear}-,${kw.flag.traded}`, tFn("app.clause_why.lucky_eligible", { params: { year: cfg.luckyEligibleYear } }));
  push(cheapEvolveClauses, "!#",                                    tFn("app.clause_why.tags_protected_short"));
  const cheapEvolve = cheapEvolveClauses.map(c => c.clause).join("&");

  // -- EVOS · Pokédex++ — pure new-dex pushes ---------------------------
  // Anything that can evolve into a new dex entry and is candy-evolvable
  // right now. Excludes evolve-quest species (those need quest completion,
  // not just candy — surfacing them is misleading for a "ready to evolve"
  // pile).
  const dexPlusClauses = [];
  push(dexPlusClauses, kw.flag.evolvable,                           tFn("app.clause_why.dex_plus_evolvable"));
  push(dexPlusClauses, kw.flag.new_evo,                             tFn("app.clause_why.dex_plus_new_evo"));
  push(dexPlusClauses, `!${kw.flag.evolve_quest}`,                  tFn("app.clause_why.dex_plus_skip_quest"));
  const dexPlus = dexPlusClauses.map(c => c.clause).join("&");

  // -- MEGAS · mega-evolve candidates -----------------------------------
  // User's pattern: mega-eligible Pokémon that have either prior mega
  // history (mega1-2, cheaper subsequent mega cost) OR are new evolutions
  // (filling the medal/dex). Skips already-mega3 entries (already maxed).
  const megaEvolveClauses = [];
  push(megaEvolveClauses, kw.flag.mega_evolve,                      tFn("app.clause_why.mega_eligible"));
  push(megaEvolveClauses, `${kw.flag.mega}1-2,${kw.flag.new_evo}`,  tFn("app.clause_why.mega_progress_or_new"));
  const megaEvolve = megaEvolveClauses.map(c => c.clause).join("&");

  // -- TRADES · Pilot 1000+ stash --------------------------------------
  // Extreme-distance catches not yet traded. The regular trade filter
  // covers ≥100km; this one is the ≥1000km deep stash.
  const pilotLongClauses = [];
  push(pilotLongClauses, `${kw.numeric.distance}1000-`,             tFn("app.clause_why.pilot_1000"));
  push(pilotLongClauses, `!${kw.flag.traded}`,                      tFn("app.clause_why.not_yet_traded"));
  push(pilotLongClauses, "!4*",                                     tFn("app.clause_why.never_4star"));
  push(pilotLongClauses, `!${kw.flag.legendary}`,                   tFn("app.clause_why.legendaries"));
  push(pilotLongClauses, `!${kw.flag.mythical}`,                    tFn("app.clause_why.mythicals_short"));
  push(pilotLongClauses, `!${kw.flag.shiny}`,                       tFn("app.clause_why.shinies_protected"));
  const pilotLong = pilotLongClauses.map(c => c.clause).join("&");

  // -- RAIDS / MAX BATTLES · per-boss counter filters ------------------
  // Each boss yields one filter: defenders that resist the boss's STAB
  // ANDed with attackers that carry a super-effective move type. The
  // `@<type>` syntax matches Pokémon with a move of that type — distinct
  // from `@<move-name>`. No IV gate — raid DPS is dominated by level +
  // moveset, so an IV cut would hide already-built workhorses.
  // Per-slot SE-move clauses. PoGo's `@1`/`@2`/`@3` prefixes target the
  // fast / first-charge / second-charge move slots respectively. `,` binds
  // tighter than `&` so we can drop the parens — the join order is what
  // matters. Result e.g. `@1ground,@1poison & @2ground,@2poison,@3ground,@3poison`
  // = "fast move is one of [ground/poison] AND at least one charge move
  // (slot 2 or 3) is one of [ground/poison]".
  const fastMoveClause = (typeKws) => typeKws.map(t => `@1${t}`).join(",");
  const chargeMoveClause = (typeKws) =>
    [...typeKws.map(t => `@2${t}`), ...typeKws.map(t => `@3${t}`)].join(",");
  // `,` binds tighter than `&`, so prepending the personal-attacker list to
  // a clause makes it an OR-allowlist alongside the existing terms.
  const prependList = (list, clause) =>
    list.length > 0 ? `${list.join(",")},${clause}` : clause;
  const withAllowlist    = (c) => prependList(topAttackersList, c);
  const withMaxAllowlist = (c) => prependList(topMaxAttackersList, c);

  // `!<TYPE` matches "not weak to TYPE attacks" — De Morgan'd into one
  // `&`-joined clause per boss-STAB type so an attacker can't sneak through
  // the allowlist with a chassis that takes SE from what the boss throws.
  // Returns "" when bossTypes is empty so callers can skip the push().
  const weaknessGuard = (bossTypes) =>
    (bossTypes || [])
      .map(t => kw.type[t])
      .filter(Boolean)
      .map(t => `!<${t}`)
      .join("&");
  const unionTypesOf = (pokemons) => {
    const set = new Set();
    for (const p of (pokemons || [])) for (const t of (p.types || [])) set.add(t);
    return [...set];
  };

  const buildBossEntry = (boss, { requiresDynamax = false } = {}) => {
    const resistorList = (boss.resistorTypes || [])
      .map(t => kw.type[t]).filter(Boolean);
    const seMoveList = (boss.seMoveTypes || [])
      .map(t => kw.type[t]).filter(Boolean);
    if (resistorList.length === 0 || seMoveList.length === 0) {
      return { id: boss.id, name: boss.names?.[outputLocale] || boss.names?.en || boss.id,
               clause: "", clauses: [], skipped: true };
    }
    // Per-context allowlist — different rosters for raids vs Max Battles.
    // (Rocket has its own builder and skips allowlists entirely.)
    const wrap = requiresDynamax ? withMaxAllowlist : withAllowlist;
    const clauses = [];
    push(clauses, wrap(resistorList.join(",")),       tFn("app.clause_why.raid_resistor_types"));
    push(clauses, wrap(fastMoveClause(seMoveList)),   tFn("app.clause_why.raid_se_fast"));
    push(clauses, wrap(chargeMoveClause(seMoveList)), tFn("app.clause_why.raid_se_charge"));
    // Max battles only let you bring Dynamax-capable Pokémon, so narrow to
    // species that have at least one Max move unlocked. PoGo's keyword is
    // `<dynamax-move>1-` — locale-aware via kw.flag.dynamax_move.
    if (requiresDynamax && kw.flag.dynamax_move) {
      push(clauses, `${kw.flag.dynamax_move}1-`, tFn("app.clause_why.max_battle_dynamax_only"));
    }
    if (cfg.raidRequireSecondMove) {
      push(clauses, `!@${kw.flag.three_move}`, tFn("app.clause_why.raid_second_move"));
    }
    // Boss-STAB weakness guardrail — applies to allowlisted top attackers
    // too (a Mewtwo shouldn't be raid-recommended into a fairy boss).
    const wGuard = weaknessGuard(boss.types);
    if (wGuard) push(clauses, wGuard, tFn("app.clause_why.raid_not_weak_to_boss"));
    return {
      id: boss.id,
      name: boss.names?.[outputLocale] || boss.names?.en || boss.id,
      clause: clauses.map(c => c.clause).join("&"),
      clauses,
      skipped: false,
    };
  };
  const buildBossTiers = (tieredBosses, opts) => {
    const out = {};
    for (const [tier, list] of Object.entries(tieredBosses || {})) {
      out[tier] = list.map(b => buildBossEntry(b, opts));
    }
    return out;
  };
  const raidFilters = buildBossTiers(RAID_BOSSES.raids);
  const maxBattleFilters = buildBossTiers(RAID_BOSSES.maxBattles, { requiresDynamax: true });
  const raidBossesFetchedAt = RAID_BOSSES.fetchedAt || null;

  // Event raids — short-window bosses (Raid Day / Raid Hour / etc.) sourced
  // from ScrapedDuck's events feed. Each entry carries its own start/end
  // window plus a parallel boss list with the same shape as the standing
  // tiers, so the UI can reuse FilterBox for each derived counter.
  const eventRaidFilters = (RAID_BOSSES.eventRaids || []).map(event => ({
    eventID: event.eventID,
    name: event.name,
    eventType: event.eventType,
    start: event.start,
    end: event.end,
    isShadow: !!event.isShadow,
    isMega: !!event.isMega,
    bosses: (event.bosses || []).map(b => buildBossEntry(b)),
  }));

  // -- MAX BATTLE TANKS / CHARGERS · universal 0.5s-fast-move filter ---
  // Max Battle meta hinges on Max Meter charging speed: only the 0.5s-tier
  // fast moves fill the meter optimally (per Pokémon GO Hub's per-attack
  // rounding floor — every fast-move tick generates 1 Max Energy regardless
  // of damage, so faster ticks win). This filter surfaces every Max-eligible
  // Pokémon that carries a 0.5s fast move, irrespective of typing — the user
  // can layer their own type/CP filter on top in-game. Move names are pulled
  // from META_RANKINGS.chargerMoves (data-derived from pogoapi fast_moves
  // duration ≤ 500ms) and localized via the move-name dictionary that the
  // existing fetch-translations sheet already populates.
  const localizedChargers = (META_RANKINGS.chargerMoves || []).map(m => {
    // Sheet keys use the move's canonical lowercase EN name; pogoapi
    // sometimes drops the hyphen ("Lock On" vs "Lock-On") — try the
    // hyphenated variant first since that's what the sheet usually has.
    const lower = m.name.toLowerCase();
    const hyphen = lower.replace(/\s+/g, "-");
    const localized = tFn(`move.${hyphen}`, {
      fallback: tFn(`move.${lower}`, { fallback: m.name }),
    });
    // PoGo's search treats spaces as token boundaries; collapse whitespace
    // so a multi-word move like "Mud Shot" matches as the substring
    // `@1mudshot`. Lowercase + leave hyphens (`@1lock-on` is valid).
    return localized.toLowerCase().replace(/\s+/g, "");
  }).filter(Boolean);
  const maxTankClauses = [];
  if (localizedChargers.length > 0) {
    push(maxTankClauses,
      localizedChargers.map(n => `@1${n}`).join(","),
      tFn("app.clause_why.max_tank_chargers"));
    if (kw.flag.dynamax_move) {
      push(maxTankClauses, `${kw.flag.dynamax_move}1-`,
        tFn("app.clause_why.max_battle_dynamax_only"));
    }
  }
  const maxTank = {
    clause: maxTankClauses.map(c => c.clause).join("&"),
    clauses: maxTankClauses,
    moveCount: localizedChargers.length,
  };

  // -- TEAM ROCKET · per-trainer counter filters -----------------------
  // Three trainer kinds, each with its own filter shape:
  //   leader        → 3 phase clauses (you swap Pokémon between phases)
  //   typed_grunt   → 1 aggregated clause across the whole lineup
  //   generic_grunt → offensive-only clause (top-3 SE move types) plus a
  //                   lineup hint, since the lineup is too varied for a
  //                   universal resistor.

  // ScrapedDuck stores Pokémon names in EN ("Persian", "Kangaskhan"); the
  // teaser/hint render layer surfaces these directly. Resolve to the user's
  // outputLocale via the existing species dictionary so a DE user sees
  // "Snobilikat, Kangama" instead of "Persian, Kangaskhan". Falls back to
  // the EN name if the dictionary doesn't have the entry. Capitalized for
  // display (resolveSpecies returns lowercase per the filter convention).
  const localizePokemonName = (name) => {
    const lower = resolveSpecies(name, outputLocale);
    if (!lower) return name;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  const localizePokemons = (list) =>
    (list || []).map(pk => ({ ...pk, name: localizePokemonName(pk.name) }));
  const localizePhases = (phases) =>
    (phases || []).map(p => ({ ...p, pokemons: localizePokemons(p.pokemons) }));

  const buildSecondMoveAndAppraise = () => {
    if (!cfg.raidRequireSecondMove) return null;
    return { clause: `!@${kw.flag.three_move}`, why: tFn("app.clause_why.raid_second_move") };
  };
  const buildLeaderPhase = (phase) => {
    const resistorList = (phase.resistorTypes || []).map(t => kw.type[t]).filter(Boolean);
    const seMoveList = (phase.seMoveTypes || []).map(t => kw.type[t]).filter(Boolean);
    const localizedPokemons = localizePokemons(phase.pokemons);
    if (resistorList.length === 0 || seMoveList.length === 0) {
      return { slot: phase.slot, pokemons: localizedPokemons, clause: "", clauses: [], skipped: true };
    }
    const clauses = [];
    push(clauses, resistorList.join(","),       tFn("app.clause_why.rocket_resistor_types"));
    push(clauses, fastMoveClause(seMoveList),   tFn("app.clause_why.rocket_se_fast"));
    push(clauses, chargeMoveClause(seMoveList), tFn("app.clause_why.rocket_se_charge"));
    const second = buildSecondMoveAndAppraise();
    if (second) push(clauses, second.clause, second.why);
    // Per-phase weakness guard from the union of types across the phase's
    // possible Pokémon — covers secondary types like flying on Charizard.
    const wGuard = weaknessGuard(unionTypesOf(phase.pokemons));
    if (wGuard) push(clauses, wGuard, tFn("app.clause_why.rocket_not_weak_to_lineup"));
    return { slot: phase.slot, pokemons: localizedPokemons,
             clause: clauses.map(c => c.clause).join("&"), clauses, skipped: false };
  };
  // ScrapedDuck names are like "Ice-type Female Grunt" / "Male Grunt" — pull
  // gender out of the EN string regardless of the user's outputLocale.
  const gruntGender = (rawName) => /female/i.test(rawName) ? "female" : "male";
  // Resolve a quote entry (locale-keyed; each value is either a plain string
  // or a `{female, male}` object when the locale's grunt speech diverges by
  // speaker). Falls back: outputLocale → en → null.
  const resolveQuote = (entry, gender) => {
    if (!entry) return null;
    const localized = entry[outputLocale] ?? entry.en;
    if (!localized) return null;
    if (typeof localized === "string") return localized;
    return localized[gender] ?? localized.male ?? localized.female ?? null;
  };

  // Localize the EN ScrapedDuck name "Fire-type Female Grunt" via existing
  // type-name i18n. Gender stays as a symbol (♂/♀) since it's universal.
  // Falls back to the raw EN name if either token is missing.
  const localizedGruntName = (trainer) => {
    const typeKw = kw.type[trainer.type];
    if (!typeKw) return trainer.name;
    const typeCap = typeKw.charAt(0).toUpperCase() + typeKw.slice(1);
    const isFemale = /female/i.test(trainer.name);
    const key = isFemale ? "app.filter.rocket_grunt_female" : "app.filter.rocket_grunt_male";
    return tFn(key, { params: { type: typeCap }, fallback: trainer.name });
  };
  const buildTypedGrunt = (trainer) => {
    const resistorList = (trainer.resistorTypes || []).map(t => kw.type[t]).filter(Boolean);
    const seMoveList = (trainer.seMoveTypes || []).map(t => kw.type[t]).filter(Boolean);
    const displayName = localizedGruntName(trainer);
    const localizedPhases = localizePhases(trainer.phases);
    const gender = gruntGender(trainer.name);
    const quote = resolveQuote(ROCKET_GRUNT_QUOTES.typed?.[trainer.type], gender);
    if (resistorList.length === 0 || seMoveList.length === 0) {
      return { name: displayName, type: trainer.type, phases: localizedPhases, quote,
               clause: "", clauses: [], skipped: true };
    }
    const clauses = [];
    push(clauses, resistorList.join(","),       tFn("app.clause_why.rocket_resistor_types"));
    push(clauses, fastMoveClause(seMoveList),   tFn("app.clause_why.rocket_se_fast"));
    push(clauses, chargeMoveClause(seMoveList), tFn("app.clause_why.rocket_se_charge"));
    const second = buildSecondMoveAndAppraise();
    if (second) push(clauses, second.clause, second.why);
    // Whole-lineup weakness guard. Includes secondary types from any
    // phase's roster (e.g. flying on a Fire grunt's Charizard).
    const allLineup = (trainer.phases || []).flatMap(p => p.pokemons || []);
    const wGuard = weaknessGuard(unionTypesOf(allLineup));
    if (wGuard) push(clauses, wGuard, tFn("app.clause_why.rocket_not_weak_to_lineup"));
    return { name: displayName, type: trainer.type, phases: localizedPhases, quote,
             clause: clauses.map(c => c.clause).join("&"), clauses, skipped: false };
  };
  // Capitalized localized type name for display ("Feuer", "Wasser"). The
  // raw kw.type value is lowercase since filter syntax wants it that way.
  const localizedTypeDisplay = (typeKey) => {
    const v = kw.type[typeKey];
    if (!v) return typeKey;
    return v.charAt(0).toUpperCase() + v.slice(1);
  };
  const buildGenericGrunt = (trainer) => {
    const seMoveList = (trainer.topOffensiveTypes || []).map(t => kw.type[t]).filter(Boolean);
    const localizedPhases = localizePhases(trainer.phases);
    // Attach localizedType so render-side teaser/hint helpers (which don't
    // see kw) can show "Kampf, Elektro" in DE instead of raw "fighting,
    // electric". Original h.type is preserved for keys / data lookups.
    const localizedTopHits = (trainer.topHits || []).map(h => ({
      ...h,
      localizedType: localizedTypeDisplay(h.type),
    }));
    // Generic grunts have 3 numbered pre-battle quotes (any of which may
    // appear). Surface all 3 in the matching speaker gender so the user can
    // recognize the encounter regardless of which line was rolled.
    const gender = gruntGender(trainer.name);
    const quotes = (ROCKET_GRUNT_QUOTES.generic || [])
      .map(e => resolveQuote(e, gender))
      .filter(Boolean);
    if (seMoveList.length === 0) {
      return { name: trainer.name, phases: localizedPhases, topHits: localizedTopHits, quotes,
               clause: "", clauses: [], skipped: true };
    }
    const clauses = [];
    push(clauses, fastMoveClause(seMoveList),   tFn("app.clause_why.rocket_top_offensive_fast"));
    push(clauses, chargeMoveClause(seMoveList), tFn("app.clause_why.rocket_top_offensive_charge"));
    const second = buildSecondMoveAndAppraise();
    if (second) push(clauses, second.clause, second.why);
    // Partial weakness guard: only STAB types that show up on enough of the
    // lineup to be worth excluding defenders weak to them. Rare lineup pulls
    // (e.g. a single Charizard's flying STAB) intentionally slip through so
    // we don't drop solid counters that happen to have one minority weakness.
    const wGuard = weaknessGuard(trainer.commonStabTypes || []);
    if (wGuard) push(clauses, wGuard, tFn("app.clause_why.rocket_not_weak_to_common_stab"));
    return { name: trainer.name, phases: localizedPhases, topHits: localizedTopHits, quotes,
             clause: clauses.map(c => c.clause).join("&"), clauses, skipped: false };
  };
  const rocketLeaders = [];
  const rocketTypedGrunts = [];
  const rocketGenericGrunts = [];
  for (const trainer of (ROCKET_LINEUPS.trainers || [])) {
    if (trainer.kind === "leader") {
      rocketLeaders.push({
        name: trainer.name,
        phases: (trainer.phases || []).map(buildLeaderPhase),
      });
    } else if (trainer.kind === "typed_grunt") {
      rocketTypedGrunts.push(buildTypedGrunt(trainer));
    } else if (trainer.kind === "generic_grunt") {
      rocketGenericGrunts.push(buildGenericGrunt(trainer));
    }
  }
  const rocketLineupsFetchedAt = ROCKET_LINEUPS.fetchedAt || null;
  // Localized, capitalized type names — used by the quote-lookup widget to
  // render match labels like "{type}-Rüpel" / "{type}-type grunt".
  const rocketTypeLabels = Object.fromEntries(
    Object.keys(kw.type || {}).map(k => [k, localizedTypeDisplay(k)])
  );

  // -- PVP · per-league meta filters ------------------------------------
  // For each league: family-search the top-N meta picks (deduped by base
  // dex), AND the league's CP cap, AND the loose PvP rank-1 IV pattern
  // (atk 0-1 OR'd, def 3-4, HP 3-4). Loose mirrors the pvpMode `loose`
  // semantic — wider than strict so the user keeps an attack-IV-1 candidate
  // they might still prefer for the bait power.
  // Master League has no CP cap, so rank-1 IV math doesn't apply — there
  // a high-attack hundo wins. Skip the IV clauses entirely for capless
  // leagues; the user filters Master picks by what they have.
  const buildLeagueFilter = (league) => {
    const speciesList = (league?.species || [])
      .map(s => pokemonNameFor(String(s.dex), outputLocale) || s.name?.toLowerCase())
      .filter(Boolean);
    if (speciesList.length === 0) return { clause: "", clauses: [], skipped: true };
    const familyPool = speciesList.map(n => `+${n}`).join(",");
    const clauses = [];
    push(clauses, familyPool, tFn("app.clause_why.pvp_meta_pool"));
    if (league.cpCap) {
      push(clauses, `${kw.numeric.cp}-${league.cpCap}`,
           tFn("app.clause_why.pvp_cp_cap", { params: { cap: league.cpCap } }));
      push(clauses, `0-1${kw.iv.atk}`, tFn("app.clause_why.pvp_loose_atk"));
      push(clauses, `3-4${kw.iv.def}`, tFn("app.clause_why.pvp_loose_def"));
      push(clauses, `3-4${kw.iv.hp}`,  tFn("app.clause_why.pvp_loose_hp"));
    }
    return { clause: clauses.map(c => c.clause).join("&"), clauses, skipped: false };
  };
  const pvpFilters = {};
  for (const [key, league] of Object.entries(PVP_RANKINGS.leagues || {})) {
    pvpFilters[key] = buildLeagueFilter(league);
  }
  const pvpRankingsFetchedAt = PVP_RANKINGS.fetchedAt || null;

  return { trash, trade, sort, prestaged, gift, buddyCatchFilters, TE_full, TE_trim,
           trashClauses, tradeClauses, sortClauses, prestagedClauses, giftClauses,
           // Aux pro-tools
           shadowCheap, shadowSafe, shadowHundoCandidates, shadowFrustration,
           cheapEvolve, dexPlus, megaEvolve, pilotLong,
           shadowCheapClauses, shadowSafeClauses, shadowHundoClauses, shadowFrustrationClauses,
           cheapEvolveClauses, dexPlusClauses, megaEvolveClauses, pilotLongClauses,
           // Per-boss raid + max-battle counters
           raidFilters, eventRaidFilters, maxBattleFilters, raidBossesFetchedAt, maxTank,
           // Team Rocket counters (leaders / typed grunts / generic grunts)
           rocketLeaders, rocketTypedGrunts, rocketGenericGrunts, rocketLineupsFetchedAt,
           rocketTypeLabels,
           // PvP league meta filters
           pvpFilters, pvpRankingsFetchedAt };
}

// ─── PARSER (for verification panel) ──────────────────────────────────────
//
// Locale-aware: parses filter syntax in whatever language the filter was
// generated in (matches the user's PoGo output locale).

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Maps a semantic flag key (kw.flag.*) → the property on `mon.flags`.
const FLAG_TO_MON = {
  favorite: "favorite", shiny: "shiny", lucky: "lucky",
  legendary: "legendary", mythical: "mythical", ultra_beast: "ultrabeast",
  shadow: "shadow", purified: "purified", costume: "costume",
  background: "background", traded: "traded", hatched: "hatched",
  baby: "eggOnly", new_evo: "newDexEvo", special_move: "legacyMove",
  xxl: "xxl", xl: "xl", xxs: "xxs",
};

export function evalFilter(filterStr, mon, outputLocale = "de") {
  const kw = pogoKeywords(outputLocale);
  const clauses = filterStr.split("&");
  return clauses.every(c => evalClause(c, mon, kw, outputLocale));
}
function evalClause(c, mon, kw, outputLocale) {
  for (const raw of c.split(",")) {
    const t = raw.trim();
    const negated = t.startsWith("!");
    const term = negated ? t.slice(1) : t;
    const v = evalTerm(term, mon, kw, outputLocale);
    if (v === null) continue;
    if ((negated ? !v : v)) return true;
  }
  return false;
}
function evalTerm(t, mon, kw, outputLocale) {
  if (t.startsWith("+")) {
    const name = t.slice(1).toLowerCase();
    return mon.families.includes(name);
  }
  // Universal: stars, year, dex#
  let m = t.match(/^(\d+)(?:-(\d+))?\*$/);
  if (m) { const lo=+m[1], hi=m[2]?+m[2]:lo; return mon.star>=lo && mon.star<=hi; }

  // Locale-driven IV ranges
  const ivAtkRe = new RegExp(`^(\\d+)(?:-(\\d+))?${escapeRegex(kw.iv.atk)}$`);
  m = t.match(ivAtkRe);
  if (m) { const lo=+m[1], hi=m[2]?+m[2]:lo; return mon.atk>=lo && mon.atk<=hi; }
  const ivDefRe = new RegExp(`^(\\d+)(?:-(\\d+))?${escapeRegex(kw.iv.def)}$`);
  m = t.match(ivDefRe);
  if (m) { const lo=+m[1], hi=m[2]?+m[2]:lo; return mon.def>=lo && mon.def<=hi; }
  const ivHpRe = new RegExp(`^(\\d+)?(-)?(\\d+)?${escapeRegex(kw.iv.hp)}$`);
  m = t.match(ivHpRe);
  if (m && (m[1]||m[3])) {
    const lo = m[1]?+m[1]:0; const hi = m[3]?+m[3]:(m[2]?99:lo);
    return mon.hp>=lo && mon.hp<=hi;
  }

  // Locale-driven numeric (distance, age, year, cp, buddy, mega, dynamax move)
  const distRe = new RegExp(`^${escapeRegex(kw.numeric.distance)}(\\d+)-?$`);
  m = t.match(distRe);  if (m) return (mon.distance||0) >= +m[1];
  const cpRe = new RegExp(`^${escapeRegex(kw.numeric.cp)}-?(\\d+)$`);
  m = t.match(cpRe);    if (m) return (mon.wp||9999) <= +m[1];
  const ageRe = new RegExp(`^${escapeRegex(kw.numeric.age)}-(\\d+)$`);
  m = t.match(ageRe);   if (m) return (mon.ageDays||9999) <= +m[1];
  const yearRe = new RegExp(`^${escapeRegex(kw.numeric.year)}(\\d+)-$`);
  m = t.match(yearRe);  if (m) return (mon.year||0) >= 2000 + +m[1];
  m = t.match(/^(\d+)$/);              if (m) return mon.dex === +m[1];

  // Locale-driven keyword tokens
  if (t === `${kw.numeric.buddy}1-`)        return !!mon.flags?.buddy;
  if (t === `${kw.flag.mega}1-`)            return !!mon.flags?.megaEvolved;
  if (t === `${kw.flag.mega}0`)             return !mon.flags?.megaEvolved;
  if (t === `${kw.flag.dynamax_move}1-`)    return !!mon.flags?.dynamaxCapable;
  if (t === "#")                            return !!mon.flags?.tagged;
  if (t === "@3move")                       return !mon.flags?.doubleMoved; // INVERTED per game
  if (t === `@${kw.flag.special_move}`)     return !!mon.flags?.legacyMove;

  // Universal league tags
  if (t === "ⓤ") return !!mon.flags?.leagueU;
  if (t === "ⓖ") return !!mon.flags?.leagueG;
  if (t === "ⓛ") return !!mon.flags?.leagueL;

  // Locale-driven flag tokens (favorite, shiny, lucky, legendary, mythical, ...)
  const flagKey = flagKeyFromKeyword(t, outputLocale);
  if (flagKey && FLAG_TO_MON[flagKey]) {
    return !!mon.flags?.[FLAG_TO_MON[flagKey]];
  }

  // Locale-driven type checks (psychic, ice, dark, ...)
  const typeKey = typeKeyFromKeyword(t, outputLocale);
  if (typeKey) {
    return (mon.types || []).includes(typeKey);
  }

  return null;
}

// ─── STORAGE ──────────────────────────────────────────────────────────────

const KEY_HUNDOS = "pogo:hundos";
const KEY_TOP_ATTACKERS = "pogo:topAttackers";
const KEY_TOP_MAX_ATTACKERS = "pogo:topMaxAttackers";
const KEY_CONFIG = "pogo:config";

// Storage shim: was window.storage in the Claude.ai artifact runtime.
// In the standalone app we use localStorage directly. Same async API for
// minimal code change.
async function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
async function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── REGIONAL MAP DATA (from KMZ — u/zoglandboy / u/Mattman243 / pokemoncalendar.com) ───

const VIEW_W = 800, VIEW_H = 400;

// Real polygon geometry from PoGo Regional Map KMZ. NOT rendered visually —
// used only for point-in-polygon hit testing when the user taps the map.
const POGO_REGIONS = JSON.parse(`[{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Pom-Pom Oricorio/Yellow Flabébé/Panpour/Azelf","english":["Pom-Pom Oricorio","Yellow Flabébé","Panpour","Azelf"],"german":["Choreogel (Cheerleading)","Flabébé (gelb)","Sodamak","Tobutz"],"geometry":{"type":"Polygon","coordinates":[[[179.9788423,85.0371116],[179.4930617,-84.9676454],[-26.1197931,-85.0824329],[-23.203125,85.0207077],[179.9788423,85.0371116]]]}},{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Sensu Oricorio/Blue Flabébé/Pansage/Uxie","english":["Sensu Oricorio","Blue Flabébé","Pansage","Uxie"],"german":["Choreogel (Buyo)","Flabébé (blau)","Vegimak","Selfe"],"geometry":{"type":"Polygon","coordinates":[[[90.9771923,85.0570722],[90.1036767,64.613503],[90.0457357,54.6777412],[89.9924066,48.9758687],[89.9896598,48.7599692],[89.9855392,48.6085576],[89.9842279,48.3717998],[90.0020807,22.0296934],[86.8261326,-85.0575818],[179.4930617,-84.9676454],[179.9788423,85.0371116],[90.9771923,85.0570722]]]}},{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Baile Oricorio/Red Flabébé/Pansear/Mesprit","english":["Baile Oricorio","Red Flabébé","Pansear","Mesprit"],"german":["Choreogel (Flamenco)","Flabébé (rot)","Grillmak","Vesprit"],"geometry":{"type":"Polygon","coordinates":[[[86.8261326,-85.0575818],[89.9918303,48.9656349],[90.0462269,56.2339545],[90.9771923,85.0570722],[-23.203125,85.0207077],[-23.1787953,84.9056643],[-24.2386427,65.8003482],[-26.1197931,-85.0824329],[86.8261326,-85.0575818]]]}},{"folder":"Type 4 [Hemispheric Regionals]","name":"Chatot - Type 4 [Hemispheric Regional]","english":["Chatot"],"german":["Plaudagei"],"geometry":{"type":"Polygon","coordinates":[[[78.4737327,-0.0655574],[77.0587661,-65.8269101],[83.4967544,-65.9536888],[92.0660904,-65.9536888],[102.4371841,-65.9536888],[114.7858169,-65.9536888],[125.6403091,-65.9536888],[137.4933308,-65.9705568],[171.7706746,-65.9705568],[-152.1941692,-65.9705568],[-114.4012004,-65.9705568],[-85.0457317,-65.9705568],[-49.0105754,-65.9705568],[-12.9754192,-65.9705568],[12.9523152,-65.7909809],[27.4542683,-65.7909809],[50.8331746,-65.718798],[77.0245808,-65.8269967],[78.4692215,-0.066183],[-28.6095949,-0.0750637],[-120.5886795,-0.0690087],[145.7979514,-0.0655574],[78.4737327,-0.0655574]]]}},{"folder":"Type 3 [Paired Regional Line]","name":"Type 3 [Paired Regional Line]","english":["Type 3 [Paired Regional Line]"],"german":["Type 3 [Paired Regional Line]"],"geometry":{"type":"LineString","coordinates":[[-29.0478436,85.0397427],[-29.1357322,33.3213485],[-21.3835305,33.3385554],[-14.5557243,33.3327905],[-6.5154841,33.496424],[1.1645508,33.5413946],[9.3965509,33.5230259],[17.5122071,33.3947592],[26.916504,33.3764123],[36.2400056,33.3935447],[43.59375,33.4497766],[49.5074177,33.4598794],[54.5800781,33.4864354],[53.437502,-85.0207077]]}},{"folder":"Type 3 [Paired Regional Line]","name":"Type 3 [Paired Meridian Line]","english":["Type 3 [Paired Meridian Line]"],"german":["Type 3 [Paired Meridian Line]"],"geometry":{"type":"LineString","coordinates":[[-0.0015,-85.051],[-0.0015,51.4779],[-0.0015,85.05]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Maractus/Heracross","english":["Maractus","Heracross"],"german":["Maracamba","Skaraborn"],"geometry":{"type":"Polygon","coordinates":[[[-28.7126839,-60.8079488],[-29.0003358,28.8387285],[-31.0039204,28.8426785],[-33.0184819,28.8445857],[-35.0099838,28.8333665],[-37.0025528,28.8387736],[-39.0055406,28.8446463],[-41.002899,28.8384495],[-43.0042338,28.8359558],[-45.0014522,28.8457198],[-46.9920227,28.8428544],[-49.0138632,28.8378503],[-51.0134117,28.8391466],[-53.0015012,28.8433519],[-56.9979247,28.8399738],[-57.9907668,28.8371582],[-59.0015822,28.8384688],[-60.005754,28.8350249],[-60.9975612,28.8427744],[-61.9998994,28.8399356],[-62.9998658,28.839383],[-63.9996692,28.8398557],[-65.0000689,28.8399257],[-65.9992077,28.8401876],[-67.0000958,28.8401086],[-68.0000649,28.8399587],[-68.9999796,28.8402988],[-70.0003426,28.8401009],[-71.4878807,28.844786],[-72.4378771,28.8476871],[-73.4042996,28.8390047],[-76.3887972,28.8366705],[-79.2558588,28.8595511],[-81.0000026,28.8405108],[-82.0008589,28.8382549],[-83.5955598,28.8437688],[-85.5989242,28.8407351],[-87.1683985,28.8478368],[-88.7602735,28.8450618],[-90.2696907,28.8437939],[-91.5015451,28.8435616],[-92.7155388,28.8431238],[-93.7681432,28.8423097],[-95.1296132,28.8414159],[-96.9952763,28.8486886],[-99.5711717,28.8373746],[-100.7334133,28.8302342],[-101.8403142,28.83693],[-103.0372329,28.8386833],[-104.0691416,28.8168433],[-106.1237099,28.838453],[-107.9099433,28.8397707],[-108.4255453,28.8395984],[-108.8930633,28.8433065],[-109.811583,28.8412668],[-111.6679274,28.8419586],[-113.4914062,28.8465438],[-116.0492626,28.8602196],[-117.6440143,28.8458629],[-119.1353522,28.845896],[-120.9994904,28.8407632],[-123.9999279,28.8391765],[-125.0000215,28.8373549],[-125.9963467,28.8409241],[-127.0080506,28.8337881],[-128.0006884,28.8302599],[-128.9933704,28.8288623],[-129.2406481,-60.4394174],[-123.3079167,-60.5951658],[-115.2413217,-60.6442764],[-106.8736263,-60.6542888],[-97.5777026,-60.6538503],[-91.1512129,-60.8224591],[-86.1420809,-60.8023277],[-78.4595209,-60.8445596],[-68.6119016,-60.8928151],[-61.8343977,-60.8234963],[-50.4218225,-60.7841079],[-40.5706879,-60.9342487],[-28.7126839,-60.8079488]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Kangaskhan","english":["Kangaskhan"],"german":["Kangama"],"geometry":{"type":"Polygon","coordinates":[[[154.6435546,-50.0359736],[154.2480469,-0.3955047],[139.7460938,-0.5273363],[139.7460938,-10.9196178],[124.9907865,-11.1567369],[118.1733601,-10.983058],[111.6210938,-11.0921659],[111.4453125,-50.0641917],[120.7617188,-50.0641917],[124.994723,-50.1057947],[129.3750001,-50.0641917],[136.7578125,-49.9512199],[144.6679688,-50.0641917],[150.6445313,-50.0641917],[154.6435546,-50.0359736]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Relicanth","english":["Relicanth"],"german":["Relicanth"],"geometry":{"type":"Polygon","coordinates":[[[154.6435546,-50.0359736],[158.0273438,-50.0641917],[162.3779297,-50.1768981],[165.1068748,-50.2661105],[168.0029297,-50.1768982],[171.5185547,-50.2893392],[175.78125,-50.2893393],[-179.1142346,-50.2654442],[-172.6369959,-50.3012819],[-167.1034055,-50.2131875],[-162.4912283,-50.2328883],[-156.4453165,-50.0641918],[-156.7749163,-13.132979],[-163.0334483,-13.1266564],[-167.4799992,-13.0095058],[-175.1374124,-13.0690463],[175.7153341,-12.9403221],[169.2334025,-12.8867798],[162.1911662,-12.8867798],[154.2919942,-12.8010882],[154.6435546,-50.0359736]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Torkoal","english":["Torkoal"],"german":["Qurtel"],"geometry":{"type":"Polygon","coordinates":[[[52.7453632,1.9661667],[60.3815883,1.8864211],[71.2804828,1.9915931],[79.7167969,1.845384],[91.3472203,1.8333542],[98.5787908,1.7590192],[100.4509769,1.7386207],[102.4442077,1.711366],[103.5193966,1.7166697],[104.4545042,1.7215441],[106.5938691,1.7132064],[109.9302184,1.7321508],[111.9561768,1.7067483],[112.1704141,44.4494676],[112.1173677,50.5577109],[105.4840983,50.5324609],[99.148713,50.5162291],[92.1655657,50.5085978],[86.3053298,50.4299745],[79.371408,50.3882202],[73.5753126,50.416405],[67.9900495,50.3808714],[62.567102,50.3851389],[57.6802124,50.3430302],[53.2122924,50.3769995],[52.7453632,1.9661667]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Tropius","english":["Tropius"],"german":["Tropius"],"geometry":{"type":"Polygon","coordinates":[[[-29.1432522,36.7850711],[-28.8147581,-49.4355627],[-21.433732,-49.5437028],[-12.8320312,-49.6107099],[-3.5617921,-49.7415299],[4.921875,-49.6107099],[15.6445313,-49.6107099],[23.203125,-49.2678046],[31.1132813,-49.2678046],[39.6936035,-49.3752201],[46.6918945,-49.4109732],[52.157406,-49.2734073],[53.0914729,36.6774152],[52.097168,36.7300795],[50.690918,36.7036596],[46.7028809,36.7388841],[43.2476807,36.7432861],[39.7595215,36.7388841],[36.0351563,36.7212739],[32.1459961,36.7212739],[29.0017068,36.7002903],[25.452919,36.7245761],[21.9946289,36.7388841],[17.7319336,36.7388841],[13.458252,36.7124672],[10.8764648,36.7476877],[7.0000631,36.7002758],[3.3837891,36.7124672],[-0.3405762,36.7300795],[-2.2638135,36.7122808],[-4.0934758,36.722256],[-5.6855589,36.7460958],[-7.2729492,36.7608913],[-10.5194092,36.7608913],[-13.5406494,36.782892],[-16.8035888,36.7960895],[-20.5718994,36.782892],[-24.3951416,36.7916906],[-29.1432522,36.7850711]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Farfetch'd","english":["Farfetch'd"],"german":["Porenta"],"geometry":{"type":"Polygon","coordinates":[[[112.2363707,21.0724084],[116.267753,21.041066],[120.2716707,21.0755242],[124.1547096,21.0782104],[128.3788226,21.0698857],[132.7239722,21.0913307],[137.2781571,21.1321598],[141.227315,21.1515131],[146.3094692,21.1897179],[149.8515658,21.2484025],[152.4695452,21.2458494],[154.7355133,21.2638365],[154.5874152,48.478032],[150.1594106,48.4052644],[145.6498147,48.3771996],[139.770296,48.3925578],[134.487265,48.3680023],[129.748832,48.367673],[124.9151903,48.3664688],[119.8363995,48.3635568],[116.0626359,48.3723472],[112.0959005,48.3707026],[112.2363707,21.0724084]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Sigilyph","english":["Sigilyph"],"german":["Symvolara"],"geometry":{"type":"Polygon","coordinates":[[[19.3452587,39.811537],[19.332032,38.8462217],[25.1577296,31.6611084],[25.0973048,31.6260348],[25.0780787,31.5535073],[24.8583521,31.4012506],[24.885818,31.2651819],[24.8693385,31.1712268],[25.0286402,30.7708791],[24.9297633,30.487273],[24.7100367,30.1458518],[24.9901881,29.2487944],[24.9943556,21.9964122],[31.3005079,22.0065984],[31.4488234,22.2406793],[31.5092482,22.1898253],[31.4048781,22.0065984],[37.0247159,21.9759484],[36.1375357,27.3199596],[35.9178091,29.5035957],[35.945275,31.5709639],[35.891936,31.9680917],[34.8616611,32.3582582],[31.5425417,33.8918277],[26.9118043,37.1918091],[26.4271827,37.8239696],[26.6455318,39.0216347],[26.4342401,40.1524457],[25.9672679,40.6711027],[26.3435497,40.9164648],[26.354536,41.2477097],[26.6182079,41.3302599],[26.6291942,41.5937186],[26.2227001,41.7496405],[26.0579051,41.729146],[25.816206,41.7332454],[25.4756298,41.7250464],[24.9592724,41.7332455],[24.6846142,41.7414435],[24.3330517,41.7250463],[23.5475292,41.7209464],[22.7674999,41.7209465],[22.2181835,41.7332455],[21.6242351,42.053723],[21.4222728,42.0567402],[20.8256664,41.8970075],[20.4977198,41.7584865],[20.0813427,41.7004428],[19.2024364,41.6963413],[19.1914501,41.3385092],[19.2024365,41.0988561],[19.1914501,40.8500155],[19.2134227,40.6335948],[19.2463817,40.5000631],[19.2683544,40.316022],[19.323286,40.0726541],[19.3452587,39.811537]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Tauros","english":["Tauros"],"german":["Tauros"],"geometry":{"type":"Polygon","coordinates":[[[-62.6981825,28.8445398],[-62.8481171,52.0054047],[-63.2573713,52.0037827],[-63.7378819,51.9994762],[-64.4194369,51.9990793],[-64.9109279,52.0016288],[-65.429802,52.0062566],[-66.4145651,51.9994221],[-67.6554899,51.9969],[-68.4822449,52.0026605],[-69.5116346,52.0133904],[-69.9579592,52.0137245],[-70.6946856,51.9932767],[-71.8748781,51.9975447],[-73.9580435,51.9804658],[-75.3060432,51.9804309],[-76.1178445,51.9878938],[-77.1583682,51.9957354],[-77.9075456,52.0016725],[-78.3071278,52.0001727],[-78.6905126,51.9981522],[-79.45816,52.0049625],[-80.3506581,52.0192006],[-81.0746939,52.0267377],[-82.0307286,52.0174783],[-82.8914443,52.0089162],[-83.7152743,52.0184946],[-84.9422433,52.0146625],[-85.924956,52.0034694],[-87.1295952,52.0017378],[-88.2514299,52.0117435],[-89.4583413,52.0204869],[-90.7548885,52.0101238],[-92.1496536,51.9931606],[-93.2990015,51.9993943],[-93.9371159,52.0044191],[-94.551186,51.9950674],[-94.9074249,51.9904954],[-95.582477,51.9973399],[-96.0395531,51.994354],[-96.6505118,51.9965269],[-97.5041855,52.0078736],[-98.6142635,52.0231562],[-99.9904715,52.0284745],[-100.5386593,52.0183937],[-100.9741831,52.0159875],[-101.5111785,52.0178867],[-101.7818663,52.0141983],[-102.5375993,52.0091147],[-103.478188,52.0134692],[-103.9638903,52.0104674],[-104.3410526,52.0128156],[-104.7649122,52.017303],[-105.1346408,52.0228441],[-105.4455277,52.0226371],[-105.8277341,52.0216675],[-106.3306878,52.0185641],[-106.663113,52.0182406],[-107.4608763,52.0178845],[-107.8954091,52.0197334],[-109.0594264,52.0064121],[-109.7367911,52.0090744],[-110.7663496,52.0099515],[-111.3946285,52.0068604],[-112.6145388,52.0085099],[-113.8198416,52.0185119],[-115.409954,52.0228131],[-116.9985247,52.0108539],[-118.9132609,52.0096775],[-120.9591053,52.0103634],[-124.1664122,52.0220991],[-126.4804707,52.0083551],[-129.406906,52.0470712],[-128.9843308,28.8320727],[-127.9916179,28.8335311],[-126.9989489,28.8371191],[-125.9872129,28.844315],[-124.9908547,28.8408038],[-123.9907278,28.8426825],[-120.9901869,28.8444342],[-119.9917111,28.8444044],[-118.9895013,28.8437919],[-117.9900646,28.8439095],[-116.9919012,28.8452754],[-115.9932549,28.8480304],[-114.9942208,28.8458381],[-113.9912996,28.8458027],[-109.9919722,28.8445069],[-105.9911669,28.8441653],[-103.9907051,28.8432564],[-99.990369,28.8417632],[-98.0287243,28.8486587],[-97.0061875,28.8470795],[-95.9901076,28.8452835],[-91.9897197,28.8446589],[-87.9894034,28.84468],[-83.9896595,28.8446139],[-82.0008589,28.8382549],[-81.0000026,28.8405108],[-77.9885192,28.8449496],[-73.9886869,28.8447182],[-70.0003426,28.8401009],[-65.9992077,28.8401876],[-65.9875305,28.8447962],[-63.9879039,28.8444177],[-62.6981825,28.8445398]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Pachirisu","english":["Pachirisu"],"german":["Pachirisu"],"geometry":{"type":"Polygon","coordinates":[[[-51.2465545,70.2484435],[-64.318617,70.3891648],[-73.3124088,70.4963258],[-83.0549535,70.498633],[-92.9226511,70.5052488],[-100.2965151,70.5568918],[-114.2409737,70.3642874],[-126.9825731,70.2723088],[-139.1951946,70.1513385],[-152.8194494,70.2245787],[-164.3310537,70.2225052],[-177.2391023,70.2155618],[169.8505556,70.2061816],[157.6624196,70.2417241],[146.9690404,70.2415726],[137.3397908,70.2083194],[129.301766,70.1948432],[119.8298713,70.1754445],[108.1946569,70.0935009],[97.1380316,69.9378562],[86.9395483,70.0742043],[79.1749259,70.1927158],[68.6184122,70.2211917],[60.8457833,70.2036538],[53.6408717,70.2347072],[53.2232787,51.7372346],[61.8584701,51.7334294],[69.8364621,51.720933],[76.9254962,51.6799256],[83.1343521,51.7040547],[89.4013995,51.6432551],[96.4844281,51.7116091],[101.0014975,51.657683],[106.3918914,51.6283886],[111.8448624,51.6665148],[116.5778169,51.7157428],[120.8849629,51.7813005],[125.7690167,51.72023],[130.5228836,51.7631141],[138.7502881,51.7933421],[144.3377356,51.8291829],[150.9179817,51.826963],[157.5879027,51.6997998],[166.25318,51.7300823],[175.249209,51.912705],[-176.4702637,51.9280344],[-168.7749605,52.031642],[-160.7222092,52.1029519],[-150.5437768,52.0746591],[-142.9613354,52.0542054],[-136.2307457,52.003468],[-129.406906,52.0470712],[-125.2192777,52.0625262],[-120.8680013,52.0422204],[-117.3698897,52.0471706],[-113.3858473,52.0687081],[-110.1157983,52.0559769],[-105.7257016,52.054004],[-100.5252026,52.0435328],[-94.4411182,52.0262978],[-88.5626004,52.0575712],[-84.542311,52.0543008],[-79.3380562,52.0328387],[-73.4900913,52.0057617],[-69.9579592,52.0137245],[-66.3853772,52.0143383],[-63.2573713,52.0037827],[-60.3623456,51.9494106],[-54.8736641,51.9172342],[-51.0543203,51.90911],[-51.2465545,70.2484435]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Mr Mime/Mime Jr.","english":["Mr Mime","Mime Jr."],"german":["Pantimos","Pam-Pam"],"geometry":{"type":"Polygon","coordinates":[[[-29.1405056,36.7850711],[-24.1671733,36.7784924],[-19.404602,36.7784924],[-14.6200562,36.7784924],[-10.5743409,36.7718924],[-7.9623413,36.7608913],[-6.7513612,36.7485787],[-5.5674779,36.7399849],[-4.79987,36.7291205],[-3.9561467,36.7178529],[-2.2391428,36.7040322],[-0.1730346,36.7124672],[4.2214966,36.7036596],[7.5723267,36.6948509],[12.9336548,36.6948509],[17.5369263,36.7124672],[21.0025277,36.7000656],[24.9964148,36.7326622],[28.7539673,36.7124672],[36.6531372,36.6948509],[43.1130982,36.7179913],[48.8699341,36.6948509],[53.0942195,36.6774152],[53.5557277,67.5813142],[47.9251099,67.6008493],[42.3220825,67.5547538],[37.0156861,67.5463631],[31.1929321,67.5337716],[25.8425904,67.5421667],[19.4155884,67.6050353],[12.9666138,67.6426763],[4.6060181,67.6593864],[-3.3082463,67.7418725],[-12.2909546,67.7261082],[-19.6847534,67.7011097],[-27.2323608,67.6802573],[-29.012146,67.7261082],[-29.1405056,36.7850711]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Bouffalant","english":["Bouffalant"],"german":["Bisofank"],"geometry":{"type":"Polygon","coordinates":[[[-73.8062973,42.7501784],[-77.7804633,42.7497062],[-77.7805706,38.299451],[-69.6122202,38.2765677],[-69.5682748,42.7692939],[-73.8062973,42.7501784]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Klefki","english":["Klefki"],"german":["Klefki"],"geometry":{"type":"Polygon","coordinates":[[[4.9043716,51.1396041],[2.5811475,51.1555567],[0.2602515,51.1479171],[-0.327061,51.139914],[-0.3253782,51.0626544],[-0.3194154,50.5075184],[-1.0124062,50.4947919],[-2.3486183,50.0100913],[-4.9414772,48.7116759],[-4.9854226,42.1948049],[-2.7442117,42.1948049],[-0.2832742,42.2110815],[0.8072301,42.2147195],[1.2569872,42.2171207],[1.4637488,42.5194975],[1.5735335,42.5176965],[1.9020399,42.2095219],[2.7709251,42.1948049],[8.5497337,42.3249009],[8.359721,49.6485873],[4.9043716,51.1396041]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Comfey","english":["Comfey"],"german":["Curelei"],"geometry":{"type":"Polygon","coordinates":[[[-160.9057817,23.0554244],[-161.015645,23.0503699],[-161.0376177,22.2239737],[-161.0705767,20.772501],[-161.0705767,19.0682984],[-161.081563,17.5560065],[-160.0598345,17.5036259],[-158.4887896,17.493148],[-156.4343462,17.493148],[-154.4018755,17.5350561],[-152.7539263,17.5560065],[-152.7978716,18.9020792],[-152.7868853,20.4434354],[-152.8198442,22.0204229],[-152.8198442,23.0857474],[-154.116231,23.0857474],[-155.2697954,23.0958536],[-156.5112505,23.0857474],[-158.1042681,23.0958536],[-159.4775591,23.0655328],[-160.9057817,23.0554244]]]}},{"folder":"Type 2 [Habitat-Based Regionals]","name":"Corsola/Pa’u Oricorio","english":["Corsola","Pa’u Oricorio"],"german":["Corasonn","Choreogel (Hula)"],"geometry":{"type":"Polygon","coordinates":[[[-9.8730602,31.1405201],[-15.9403397,30.9844594],[-20.189579,30.8801952],[-23.802537,30.9342908],[-28.64567,31.0092758],[-34.0963484,30.8901409],[-39.426738,30.828582],[-44.6014742,30.9156176],[-49.6031406,30.8120615],[-53.3472016,30.8296243],[-55.8638853,30.818043],[-58.8068607,30.7929712],[-61.8283727,30.7815837],[-64.1057336,30.8240551],[-66.2843656,30.8256618],[-68.3964003,30.8415856],[-71.1216886,30.8648288],[-73.8922327,30.9036423],[-76.6061928,30.9021854],[-79.6780482,30.930443],[-82.1168898,30.932255],[-84.2487434,30.9835443],[-86.8523484,30.9883056],[-89.2438965,31.0050124],[-91.0297149,31.0043649],[-92.8164803,31.0011573],[-94.2435175,30.9957742],[-95.4522558,30.9903655],[-97.4799473,30.9876793],[-98.7757055,30.9959298],[-100.9234648,27.0096587],[-100.0400649,22.3826332],[-101.2687294,20.9937268],[-104.2592833,24.474896],[-106.8102442,27.8625293],[-111.2273666,31.0519459],[-115.3513697,31.081647],[-117.3939438,31.0874676],[-119.1984618,31.1222558],[-122.3722559,31.1319945],[-126.1960924,31.1624648],[-131.4947178,31.1922318],[-139.8822028,31.2843323],[-145.4591375,31.2839777],[-155.2020422,31.312575],[-162.7126005,31.3995877],[-167.4612609,31.3617441],[-171.4315472,31.2318951],[-176.4400706,31.2135856],[179.1692626,31.173936],[174.0524992,31.2160826],[165.4890964,31.0286072],[160.4342741,30.9597223],[155.5141738,30.8661785],[150.0901759,30.8175575],[145.3815998,30.8292284],[141.4061321,30.8501124],[137.6676859,30.8552472],[133.9763724,30.866859],[130.1320517,30.895796],[126.6151981,30.9277537],[123.9974778,30.9565044],[121.7315405,30.9774533],[119.9762153,30.9791843],[119.4822065,29.2348055],[117.928279,27.1142978],[116.4967885,25.9576725],[115.2193979,24.7522335],[113.7492959,24.1417649],[111.7776431,23.7140653],[109.8817007,23.561248],[92.7431808,24.0928872],[90.3978269,24.4591837],[87.6307239,24.7685212],[85.6999548,24.1574274],[73.7226059,24.2159078],[72.0647136,24.9659701],[67.6514684,27.1955854],[62.3471546,27.9932575],[60.1037347,27.9522144],[57.2315282,28.561835],[54.176727,29.1549615],[52.5606432,31.0079201],[49.7380794,30.8439855],[44.7438127,30.7820179],[45.9741178,27.5570092],[48.768518,23.3022446],[52.2153465,21.1561647],[55.5309196,22.2955058],[54.6632579,20.3844527],[51.0451227,18.8237121],[45.8143578,16.948764],[44.8821521,18.0995502],[41.6638374,22.5410451],[38.6189052,26.0933813],[36.8434551,28.4869537],[35.258142,29.7517315],[33.5406249,31.1790328],[30.3539301,31.0598979],[27.6323001,31.1174246],[26.362672,31.192921],[23.704193,31.2472629],[21.0012214,31.2715175],[18.3919199,31.2726521],[15.8626621,31.2437797],[13.82018,31.2426341],[9.9582717,31.0975627],[11.8449804,30.8195168],[13.3757519,30.502565],[14.3954242,29.6490472],[16.1912139,29.0631292],[18.7789897,28.0479114],[20.6440146,28.0554983],[22.2545047,29.2621584],[22.8185884,30.4967223],[25.1016404,29.5437103],[28.9783511,28.8947811],[30.1158967,28.0202289],[32.0642181,23.9313349],[34.230276,20.1698059],[36.2115913,16.0309512],[41.2219555,8.5632616],[43.3809818,7.3593591],[44.090565,5.6629187],[40.0646189,2.7352649],[36.3951438,0.2568017],[35.8592962,-2.3905462],[36.8831946,-11.1572569],[37.0007472,-13.8184392],[33.8380723,-16.7348841],[31.7758851,-19.553338],[32.6872899,-22.6865188],[30.9055821,-23.9340014],[30.0281674,-25.7798741],[33.9431073,-25.8378162],[37.2509118,-25.8407001],[40.8028922,-25.8473073],[43.9081896,-25.8941862],[45.6245026,-25.9193263],[47.6947949,-25.9561292],[49.4898176,-25.9353591],[53.3486982,-25.9739475],[55.2132596,-26.0123918],[59.2452843,-26.0220039],[62.6465338,-26.011137],[66.299694,-25.8854081],[69.3405539,-25.9684893],[72.9738702,-25.7732303],[77.8478919,-25.7889412],[87.2241138,-25.9011762],[92.5305345,-26.1447776],[97.3919282,-26.2469562],[101.4153377,-26.0607277],[105.6521469,-26.1545034],[109.3609172,-26.1413373],[113.6090926,-26.0635771],[114.9633694,-26.0691184],[114.8896323,-22.9591519],[119.7889378,-21.3915166],[123.6841364,-17.9149865],[126.9228351,-15.9903977],[130.6806572,-15.9714886],[134.9236675,-15.5879592],[138.1647282,-17.6821249],[141.3681879,-18.4767463],[145.5715547,-18.7497148],[148.0921879,-21.7502209],[150.6500166,-24.1988793],[151.853642,-25.8026412],[153.0472339,-27.0721797],[156.873194,-27.0393387],[160.3934371,-27.0391951],[164.3315572,-27.1710527],[168.1206229,-27.1942641],[172.1627062,-27.0857387],[176.9902805,-26.9382684],[-172.2956982,-27.2560217],[-165.4342248,-27.0839054],[-157.1180891,-27.3828246],[-147.7651953,-27.2019117],[-133.7622327,-26.9706395],[-119.5669501,-26.7038461],[-106.9411339,-26.5642586],[-92.7051728,-26.6555626],[-82.2009483,-26.491401],[-77.0479595,-26.3582221],[-74.4724702,-26.3506146],[-70.4805681,-26.2021512],[-67.730384,-26.0516216],[-67.2426696,-22.0095771],[-67.699906,-16.22921],[-70.7117075,-13.7030529],[-74.6058639,-8.351967],[-76.3632214,-4.3242599],[-75.0591351,0.4602624],[-72.9448494,5.2373984],[-69.6291923,6.7288898],[-65.9274051,6.6565043],[-62.3645572,5.0828222],[-59.3131786,3.5354593],[-55.7854924,1.0547215],[-53.7318478,-1.1392688],[-50.8845203,-3.4198878],[-46.2468024,-4.6854824],[-37.4326971,-5.0147754],[-31.4062199,-5.0241429],[-25.30721,-5.0119669],[-18.7225409,-4.987044],[-13.3548468,-5.0002811],[-9.8725249,-4.8987376],[1.5368346,-4.5982864],[11.3112549,-4.4354411],[12.3565641,-4.4150876],[10.1557311,-1.0447361],[11.0848511,2.5290932],[10.1852768,5.8438644],[7.0741069,7.6479433],[2.7268913,9.0455965],[-4.4269965,6.9624321],[-10.0933303,9.2060823],[-12.0053514,11.0537785],[-12.8358667,13.4404954],[-13.1039698,14.3954109],[-13.110911,16.2011545],[-13.2036401,21.3364108],[-13.0046678,22.6730186],[-12.0904078,24.3326327],[-11.6732044,25.3200941],[-9.7877374,26.3047469],[-9.8730602,31.1405201]]]}},{"folder":"Type 2 [Habitat-Based Regionals]","name":"Carnivine","english":["Carnivine"],"german":["Venuflibis"],"geometry":{"type":"Polygon","coordinates":[[[-87.0406486,36.638558],[-87.2245764,24.8972135],[-79.8857092,24.777572],[-75.0956701,24.7775719],[-75.0216056,36.5591767],[-79.6907951,36.5503515],[-84.4039299,36.576824],[-87.0406486,36.638558]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Indian Ocean","english":["Indian Ocean"],"german":["Indian Ocean"],"geometry":{"type":"Polygon","coordinates":[[[52.8222675,1.9332268],[52.03125,-61.7731229],[59.765625,-61.7731229],[66.796875,-61.9389504],[74.53125,-61.9389504],[82.7929688,-61.9389505],[91.7578125,-61.7731229],[101.25,-61.7731229],[108.6328125,-61.6063964],[111.796875,-61.522695],[111.9561768,1.7067483],[103.0078125,1.7575368],[92.109375,1.9771466],[83.3203125,2.1088987],[76.3561664,2.0794282],[69.8737758,2.1060142],[61.2597656,1.9771466],[52.8222675,1.9332268]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Malay Archipelago","english":["Malay Archipelago"],"german":["Malay Archipelago"],"geometry":{"type":"Polygon","coordinates":[[[112.0222351,20.8938841],[111.6210938,-11.0921659],[118.1733601,-10.983058],[123.75,-11.0059045],[130.078125,-10.833306],[135.703125,-10.660608],[139.7460938,-10.9196178],[139.7460978,20.9614396],[133.7695333,20.9614396],[128.5620178,20.9409197],[123.0249063,20.9203969],[117.8173868,20.8177411],[112.0222351,20.8938841]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Greenland","english":["Greenland"],"german":["Greenland"],"geometry":{"type":"Polygon","coordinates":[[[-62.8899613,29.0921022],[-56.8652344,29.0753752],[-48.8671875,28.9216313],[-37.8768593,29.0766214],[-28.1397269,29.1436267],[-28.0780564,67.6930404],[-22.2964334,67.6464554],[-13.2877821,67.6968464],[-0.4255646,67.7617242],[9.4021206,67.6848782],[19.0294378,67.6281471],[27.8880865,67.5133968],[36.5751531,67.5613206],[44.9819703,67.5219765],[53.5529811,67.5813142],[51.9433614,85.0288468],[41.2207071,85.0359415],[29.8828125,85.0511288],[21.4453125,85.0207077],[11.6015625,85.0511288],[4.1524615,85.0806101],[-5.625,85.0511288],[-15.46875,85.0511288],[-23.203125,85.0207077],[-31.640625,85.0511288],[-39.2983701,85.0620929],[-49.5703125,85.0207077],[-56.25,85.0435409],[-62.9296875,85.0511288],[-62.8899613,29.0921022]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Eastern Pacific","english":["Eastern Pacific"],"german":["Eastern Pacific"],"geometry":{"type":"Polygon","coordinates":[[[-129.7049052,51.9163929],[-139.0429687,51.7270282],[-147.7001953,51.9442648],[-156.796875,52.0524905],[-172.7929687,51.5087425],[-177.1899046,51.6927994],[178.7695373,51.3443387],[179.4726563,-12.8546489],[-156.7749163,-13.132979],[-156.4453165,-50.0641918],[-143.0859375,-50.7364551],[-129.0234375,-50.7364552],[-129.7049052,51.9163929]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Western Pacific","english":["Western Pacific"],"german":["Western Pacific"],"geometry":{"type":"Polygon","coordinates":[[[178.7695373,51.3443387],[173.2763793,51.2344073],[167.3437521,51.3443387],[159.8730489,51.179343],[154.2476615,50.6799],[154.4676551,21.0836313],[139.7460958,20.9614396],[139.7460958,-0.5273363],[154.2480489,-0.3955047],[154.2919962,-12.8010882],[166.7147588,-12.8679333],[179.4726563,-12.8546489],[178.7695373,51.3443387]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Arctic","english":["Arctic"],"german":["Arctic"],"geometry":{"type":"Polygon","coordinates":[[[59.5656778,67.66648],[87.206391,67.5169917],[105.1411255,67.9642187],[123.4321834,67.9628762],[144.7952752,67.9310079],[154.8191355,68.0714537],[169.1494251,68.0950643],[-179.3346701,68.0662897],[-163.0147619,67.9028756],[-145.1916138,67.9678554],[-122.2691713,67.8123225],[-99.0510473,67.8127055],[-87.3749088,67.8100953],[-71.3334416,68.0944105],[-54.1980242,68.1040319],[-34.9641471,67.9635529],[-16.1833516,68.0693841],[-3.3109929,67.7418725],[6.8686002,68.0725594],[19.4128418,67.6050353],[37.0129395,67.5463631],[59.5656778,67.66648]]]}},{"folder":"Geoblock Region","name":"China Geoblock","english":["China Geoblock"],"german":["China Geoblock"],"geometry":{"type":"Polygon","coordinates":[[[118.599704,24.325883],[120.228212,24.0531],[120.395501,26.623242],[124.833977,26.249418],[124.361565,38.044059],[124.85595,38.044059],[125.482171,37.357356],[128.811028,39.550936],[98.408684,46.114308],[97.771477,44.975614],[96.431145,45.037754],[96.079582,43.877239],[94.255852,43.924735],[94.124016,42.693673],[85.12409,31.214182],[84.992254,28.624521],[87.27741,28.605232],[87.299382,27.811356],[92.682683,28.04432],[94.748113,29.316549],[96.37409,29.220711],[96.615789,28.566643],[97.714422,28.508734],[97.604558,23.676191],[100.59284,21.127004],[101.581609,22.939646],[104.503972,22.838434],[104.679754,23.625874],[106.789129,23.162048],[106.613347,21.842603],[114.090645,20.859728],[114.137337,21.872605],[113.474257,22.046109],[113.482031,22.258102],[113.592581,22.330529],[113.773842,22.469042],[113.94825,22.448102],[113.95855,22.515989],[114.041671,22.504941],[114.049224,22.502245],[114.055233,22.503118],[114.05755,22.505734],[114.057722,22.509382],[114.059352,22.513346],[114.062013,22.515329],[114.065189,22.516994],[114.068966,22.517152],[114.072055,22.517945],[114.074459,22.520244],[114.077841,22.529056],[114.079472,22.530563],[114.082004,22.531038],[114.084364,22.532109],[114.086896,22.534011],[114.088398,22.536192],[114.091531,22.537064],[114.093806,22.536271],[114.096123,22.534289],[114.097968,22.534289],[114.102346,22.534804],[114.104105,22.535121],[114.107667,22.533694],[114.109126,22.531356],[114.111787,22.529492],[114.114276,22.530523],[114.115993,22.531554],[114.116036,22.532902],[114.116422,22.534091],[114.117237,22.534447],[114.119297,22.534527],[114.120628,22.535478],[114.121786,22.537262],[114.125134,22.538926],[114.130687,22.541551],[114.138841,22.543216],[114.144248,22.54171],[114.14545,22.540838],[114.14854,22.542027],[114.148368,22.543374],[114.1506,22.546228],[114.151716,22.546704],[114.151458,22.547497],[114.150342,22.54718],[114.14957,22.548448],[114.149827,22.550905],[114.151544,22.550905],[114.15163,22.554948],[114.15635,22.554393],[114.159354,22.560576],[114.161586,22.562002],[114.163474,22.559228],[114.166049,22.559307],[114.167508,22.561368],[114.169654,22.561051],[114.170942,22.559387],[114.176521,22.560179],[114.177551,22.558515],[114.177722,22.555582],[114.181156,22.554234],[114.181842,22.555582],[114.18682,22.554551],[114.187078,22.555978],[114.195747,22.55582],[114.196433,22.557326],[114.201412,22.557564],[114.201669,22.556216],[114.207248,22.556533],[114.20905,22.557246],[114.213428,22.554948],[114.217977,22.555978],[114.221238,22.553045],[114.222097,22.55146],[114.227247,22.547814],[114.225616,22.545673],[114.226474,22.544167],[114.23716,22.545356],[114.246601,22.556097],[114.24952,22.5536],[114.299461,22.563223],[114.312164,22.578916],[114.426035,22.561983],[114.430155,22.389402],[114.511179,22.381783],[114.512553,21.760733],[114.144511,21.870378],[114.100848,20.857276],[118.451434,20.033746],[118.599704,24.325883]]]}},{"folder":"Confirmed Spawn Points","name":"Pansage Spawn","english":["Pansage Spawn"],"german":["Pansage Spawn"],"geometry":{"type":"Point","coordinates":[90.4858278,56.2348717]}},{"folder":"Confirmed Spawn Points","name":"Pansear Spawn","english":["Pansear Spawn"],"german":["Pansear Spawn"],"geometry":{"type":"Point","coordinates":[82.9378939,55.009464]}},{"folder":"Type 1 [Geographical Regionals]","name":"Hawlucha","english":["Hawlucha"],"german":["Hawlucha"],"geometry":{"type":"Polygon","coordinates":[[[-117.4,32.7],[-114.8,32.7],[-110.5,31.4],[-106.5,31.8],[-103.0,29.0],[-100.0,28.7],[-99.5,27.5],[-97.4,25.9],[-97.2,21.5],[-94.8,18.5],[-92.0,18.5],[-90.4,21.5],[-86.7,21.5],[-86.7,19.5],[-87.5,17.8],[-88.3,17.8],[-89.2,17.5],[-91.4,16.0],[-92.2,14.5],[-95.5,16.2],[-100.0,16.7],[-104.3,19.5],[-105.5,20.0],[-106.5,23.2],[-108.5,22.5],[-110.3,22.7],[-110.5,23.5],[-112.5,27.0],[-114.5,29.5],[-115.5,30.5],[-116.5,31.5],[-117.4,32.7]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Stonjourner","english":["Stonjourner"],"german":["Stonjourner"],"geometry":{"type":"Polygon","coordinates":[[[-7.6,55.2],[-5.5,54.3],[-6.0,50.0],[-3.0,50.6],[0.5,50.9],[1.8,52.5],[0.0,53.7],[-1.5,55.0],[-1.7,56.0],[-2.0,57.7],[-3.5,58.7],[-5.0,58.6],[-6.5,58.0],[-7.5,57.0],[-6.4,55.9],[-5.3,54.8],[-7.6,55.2]]]}}]`);

const KEY_LASTPIN = "pogo:lastpin";
const KEY_BAZAARTAGS = "pogo:bazaartags";
const KEY_HOME = "pogo:home";
const KEY_STEP = "pogo:step";

// Module-level point-in-polygon (handles antimeridian via unwrap).
// Used by both the App (homeLocals computation) and RegionalMap (matches).
function unwrapRing(ring) {
  if (!ring || ring.length === 0) return ring;
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const prevLon = out[out.length - 1][0];
    let curLon = ring[i][0];
    const curLat = ring[i][1];
    while (curLon - prevLon >  180) curLon -= 360;
    while (curLon - prevLon < -180) curLon += 360;
    out.push([curLon, curLat]);
  }
  return out;
}
function shiftPointToRing(pt, ring) {
  if (!ring.length) return pt;
  let lonMin = ring[0][0], lonMax = ring[0][0];
  for (const p of ring) {
    if (p[0] < lonMin) lonMin = p[0];
    if (p[0] > lonMax) lonMax = p[0];
  }
  let [x, y] = pt;
  while (x < lonMin - 0.5 && x + 360 <= lonMax + 0.5) x += 360;
  while (x > lonMax + 0.5 && x - 360 >= lonMin - 0.5) x -= 360;
  return [x, y];
}
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
function pointInRegionGeom(pt, geom) {
  if (geom.type === "Polygon") {
    const ring = unwrapRing(geom.coordinates[0]);
    return pointInRing(shiftPointToRing(pt, ring), ring);
  }
  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      const ring = unwrapRing(poly[0]);
      if (pointInRing(shiftPointToRing(pt, ring), ring)) return true;
    }
    return false;
  }
  return false;
}

// Inline TopoJSON → GeoJSON decoder (avoids needing topojson-client as a dep)
function decodeTopo(topology, objectName) {
  const obj = topology.objects[objectName];
  const { scale, translate } = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map((d) => {
      x += d[0]; y += d[1];
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const resolveArc = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ringPoints = (refs) => {
    const out = [];
    refs.forEach((r, i) => {
      const seg = resolveArc(r);
      if (i === 0) out.push(...seg);
      else out.push(...seg.slice(1));
    });
    return out;
  };
  const procGeom = (g) => {
    if (g.type === "Polygon") return { type: "Polygon", coordinates: g.arcs.map(ringPoints) };
    if (g.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: g.arcs.map((rs) => rs.map(ringPoints)) };
    return null;
  };
  return {
    type: "FeatureCollection",
    features: obj.geometries
      .map((g) => ({ type: "Feature", id: g.id, properties: g.properties || {}, geometry: procGeom(g) }))
      .filter((f) => f.geometry),
  };
}

// ─── UI ───────────────────────────────────────────────────────────────────

export default function App() {
  const { t, locale, outputLocale } = useTranslation();
  const [hundos, setHundos] = useState(DEFAULT_HUNDOS);
  const [topAttackers, setTopAttackers] = useState(DEFAULT_TOP_ATTACKERS);
  const [topMaxAttackers, setTopMaxAttackers] = useState(DEFAULT_TOP_MAX_ATTACKERS);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [newHundo, setNewHundo] = useState("");
  const [newTopAttacker, setNewTopAttacker] = useState("");
  const [newTopMaxAttacker, setNewTopMaxAttacker] = useState("");
  const [newMyth, setNewMyth] = useState("");
  const [newKeeper, setNewKeeper] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showSetTheory, setShowSetTheory] = useState(false);
  const [showAuxShadows, setShowAuxShadows] = useState(false);
  const [showAuxEvos, setShowAuxEvos] = useState(false);
  const [showAuxTrades, setShowAuxTrades] = useState(false);
  const [showAuxMegas, setShowAuxMegas] = useState(false);
  const [showAuxRaids, setShowAuxRaids] = useState(false);
  const [showAuxMaxBattles, setShowAuxMaxBattles] = useState(false);
  const [showAuxRocket, setShowAuxRocket] = useState(false);
  const [showAuxPvp, setShowAuxPvp] = useState(false);
  const [showRawClauses, setShowRawClauses] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [view, setView] = useState(viewFromHash);
  useEffect(() => {
    const onHashChange = () => {
      setView(viewFromHash());
      // If the hash points at a specific workshop step, sync currentStep.
      const step = stepFromHash();
      if (step !== null) setCurrentStep(step);
    };
    window.addEventListener("hashchange", onHashChange);
    // Run once on mount so #workshop/<key> on initial load picks up the step.
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [homeLocation, setHomeLocation] = useState(null);   // [lon, lat] — drives defaults
  const [lastPin, setLastPin] = useState(null);             // [lon, lat] — inspector
  const [bazaarTags, setBazaarTags] = useState([]);
  const [copied, setCopied] = useState({
    trash: false, trade: false, sort: false, prestaged: false, gift: false,
    // Aux pro-tools
    shadowCheap: false, shadowSafe: false, shadowHundoCandidates: false, shadowFrustration: false,
    cheapEvolve: false, dexPlus: false, megaEvolve: false, pilotLong: false,
  });
  const [resetArmed, setResetArmed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    if (!resetArmed) return;
    const t = setTimeout(() => setResetArmed(false), 3000);
    return () => clearTimeout(t);
  }, [resetArmed]);

  // Load from storage once
  useEffect(() => {
    (async () => {
      const h = await loadJSON(KEY_HUNDOS, DEFAULT_HUNDOS);
      const ta = await loadJSON(KEY_TOP_ATTACKERS, DEFAULT_TOP_ATTACKERS);
      const tma = await loadJSON(KEY_TOP_MAX_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS);
      const c = await loadJSON(KEY_CONFIG, DEFAULT_CONFIG);
      const home = await loadJSON(KEY_HOME, null);
      const p = await loadJSON(KEY_LASTPIN, null);
      const b = await loadJSON(KEY_BAZAARTAGS, []);
      const step = await loadJSON(KEY_STEP, 1);
      setHundos(h);
      setConfig(mergeImportedConfig(c));
      const canonicalize = (arr) => (arr || []).map(s => resolveSpecies(s) || s);
      setTopAttackers(canonicalize(ta));
      setTopMaxAttackers(canonicalize(tma));
      setHomeLocation(home);
      setLastPin(p);
      setBazaarTags(b);
      setCurrentStep(step);
      setLoaded(true);
    })();
  }, []);

  // Persist on change
  useEffect(() => { if (loaded) saveJSON(KEY_HUNDOS, hundos); }, [hundos, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_TOP_ATTACKERS, topAttackers); }, [topAttackers, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_TOP_MAX_ATTACKERS, topMaxAttackers); }, [topMaxAttackers, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_CONFIG, config); }, [config, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_HOME, homeLocation); }, [homeLocation, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_LASTPIN, lastPin); }, [lastPin, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_BAZAARTAGS, bazaarTags); }, [bazaarTags, loaded]);
  useEffect(() => { if (loaded) saveJSON(KEY_STEP, currentStep); }, [currentStep, loaded]);

  // Locals at home location (drives auto-drop from Regionals protection + bazaar suggestions)
  const homeLocals = useMemo(() => {
    if (!homeLocation) return [];
    const out = new Set();
    for (const r of POGO_REGIONS) {
      if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") continue;
      if (pointInRegionGeom(homeLocation, r.geometry)) {
        r.german.forEach(n => out.add(n));
      }
    }
    return [...out];
  }, [homeLocation]);

  // Build effective config: home-locals get auto-removed from collector protections
  // across ALL regional groups (so e.g. Sengo in collectibles also gets dropped if Bonn is home).
  const effectiveConfig = useMemo(() => {
    if (!homeLocals.length || !config.regionalGroups) return config;
    const newGroups = { ...config.regionalGroups };
    let changed = false;
    for (const [groupKey, groupDef] of Object.entries(REGIONAL_GROUPS)) {
      const groupState = newGroups[groupKey];
      if (!groupState || !groupState.enabled) continue;
      const baseList = groupDef.collectors;
      const explicitlyEnabled = groupState.collectorsEnabled === null ? baseList : groupState.collectorsEnabled;
      const filtered = explicitlyEnabled.filter(sp => !homeLocals.includes(sp));
      if (filtered.length !== explicitlyEnabled.length) {
        newGroups[groupKey] = { ...groupState, collectorsEnabled: filtered };
        changed = true;
      }
    }
    if (!changed) return config;
    return { ...config, regionalGroups: newGroups };
  }, [config, homeLocals]);

  // Output locale: follows UI locale unless expert mode is on and the user
  // explicitly picked a different one (e.g. their PoGo client is set to a
  // different language than their browser).
  const effectiveOutputLocale = effectiveConfig.expertMode ? outputLocale : locale;
  const { trash, trade, sort, prestaged, gift, buddyCatchFilters, TE_full, TE_trim,
          trashClauses, tradeClauses, sortClauses, prestagedClauses, giftClauses,
          shadowCheap, shadowSafe, shadowHundoCandidates, shadowFrustration,
          cheapEvolve, dexPlus, megaEvolve, pilotLong,
          shadowCheapClauses, shadowSafeClauses, shadowHundoClauses, shadowFrustrationClauses,
          cheapEvolveClauses, dexPlusClauses, megaEvolveClauses, pilotLongClauses,
          raidFilters, eventRaidFilters, maxBattleFilters, raidBossesFetchedAt, maxTank,
          rocketLeaders, rocketTypedGrunts, rocketGenericGrunts, rocketLineupsFetchedAt,
          rocketTypeLabels,
          pvpFilters, pvpRankingsFetchedAt } = useMemo(
    () => buildFilters(hundos, { ...effectiveConfig, topAttackers, topMaxAttackers }, homeLocals, effectiveOutputLocale, t),
    [hundos, effectiveConfig, homeLocals, effectiveOutputLocale, topAttackers, topMaxAttackers, t]
  );

  function addHundo() {
    // Accept comma/space/semicolon-separated lists. Each token can be:
    // - a dex number (e.g. "1", "201", "0666")
    // - an English name (e.g. "Bulbasaur", "venusaur")
    // - a German name (e.g. "bisasam", "Bisaflor")
    // Resolves each to canonical lowercase German via resolveSpecies().
    const tokens = newHundo.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(hundos);
    const unresolved = [];
    for (const tok of tokens) {
      const resolved = resolveSpecies(tok);
      if (resolved) {
        set.add(resolved);
      } else {
        unresolved.push(tok);
      }
    }
    setHundos([...set].sort());
    if (unresolved.length > 0) {
      // Keep unresolved tokens in the input so the user sees what didn't match
      setNewHundo(unresolved.join(", "));
    } else {
      setNewHundo("");
    }
  }
  function removeHundo(h) { setHundos(hundos.filter(x => x !== h)); }
  function addTopAttacker() {
    // Same parser as addHundo: comma/space/semicolon-split, multi-locale
    // species resolution, dupes silently ignored, unresolved tokens kept
    // in the input so the user can fix typos.
    const tokens = newTopAttacker.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(topAttackers);
    const unresolved = [];
    for (const tok of tokens) {
      const resolved = resolveSpecies(tok);
      if (resolved) set.add(resolved);
      else unresolved.push(tok);
    }
    setTopAttackers([...set].sort());
    setNewTopAttacker(unresolved.length > 0 ? unresolved.join(", ") : "");
  }
  function removeTopAttacker(s) { setTopAttackers(topAttackers.filter(x => x !== s)); }
  function addTopMaxAttacker() {
    const tokens = newTopMaxAttacker.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(topMaxAttackers);
    const unresolved = [];
    for (const tok of tokens) {
      const resolved = resolveSpecies(tok);
      if (resolved) set.add(resolved);
      else unresolved.push(tok);
    }
    setTopMaxAttackers([...set].sort());
    setNewTopMaxAttacker(unresolved.length > 0 ? unresolved.join(", ") : "");
  }
  function removeTopMaxAttacker(s) { setTopMaxAttackers(topMaxAttackers.filter(x => x !== s)); }
  // Generic add/remove for config-held species lists (mythTooManyOf,
  // shadowKeeperSpecies). Mirrors addHundo/addTopAttacker but writes back
  // through setConfig so the value persists alongside other config.
  function addToConfigList(fieldKey, raw, setRaw) {
    const tokens = raw.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const next = new Set(config[fieldKey] || []);
    const unresolved = [];
    for (const tok of tokens) {
      const r = resolveSpecies(tok);
      if (r) next.add(r);
      else unresolved.push(tok);
    }
    setConfig({ ...config, [fieldKey]: [...next].sort() });
    setRaw(unresolved.length > 0 ? unresolved.join(", ") : "");
  }
  function removeFromConfigList(fieldKey, item) {
    setConfig({ ...config, [fieldKey]: (config[fieldKey] || []).filter(x => x !== item) });
  }
  function copyToClipboard(which, text) {
    // Robust copy: try modern clipboard API, fall back to legacy execCommand,
    // surface errors so user knows to manually select.
    const flash = (state) => {
      setCopied(p => ({ ...p, [which]: state }));
      setTimeout(() => setCopied(p => ({ ...p, [which]: false })), 2000);
    };

    // Modern clipboard API — but it can throw or reject in iframes without permission
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => flash("ok"))
        .catch(() => fallbackCopy(text) ? flash("ok") : flash("err"));
      return;
    }
    // Legacy fallback
    if (fallbackCopy(text)) flash("ok"); else flash("err");
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  function resetAll() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setHundos(DEFAULT_HUNDOS);
    setTopAttackers(DEFAULT_TOP_ATTACKERS);
    setTopMaxAttackers(DEFAULT_TOP_MAX_ATTACKERS);
    setConfig(DEFAULT_CONFIG);
    setHomeLocation(null);
    setLastPin(null);
    setBazaarTags([]);
    setResetArmed(false);
    setShowSettings(false);
  }

  // Build the export envelope from current React state. Reads from React
  // (not localStorage) so a mid-edit export captures the live values.
  function buildExportEnvelope() {
    return {
      schema: "pogo-filter-workshop/v1",
      exportedAt: new Date().toISOString(),
      data: {
        hundos,
        topAttackers,
        topMaxAttackers,
        config,
        homeLocation,
        bazaarTags,
      },
    };
  }
  // Trigger a JSON file download. Synchronous — no preview, no confirm,
  // since exporting is non-destructive. Returns the filename used.
  function exportState() {
    const envelope = buildExportEnvelope();
    const today = new Date().toISOString().slice(0, 10);
    const filename = `pogo-filter-workshop-${today}.json`;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  }
  // Apply a previously-validated import envelope to React state. The
  // pure prepareImport helper does the migration / canonicalization and
  // returns only the keys it could parse; we then thread each one to its
  // setter. Keeping the shape filtering pure keeps the import path
  // testable without a React tree.
  function applyImportEnvelope(envelope) {
    const prepared = prepareImport(envelope);
    if ("hundos" in prepared)          setHundos(prepared.hundos);
    if ("topAttackers" in prepared)    setTopAttackers(prepared.topAttackers);
    if ("topMaxAttackers" in prepared) setTopMaxAttackers(prepared.topMaxAttackers);
    if ("config" in prepared)          setConfig(prepared.config);
    if ("homeLocation" in prepared)    setHomeLocation(prepared.homeLocation);
    if ("bazaarTags" in prepared)      setBazaarTags(prepared.bazaarTags);
  }

  // Step navigation helpers — labels/descs translated at render time
  const steps = [
    { n: 1, key: "where",  label: t("app.step.where.label"),  desc: t("app.step.where.desc") },
    { n: 2, key: "what",   label: t("app.step.what.label"),   desc: t("app.step.what.desc") },
    { n: 3, key: "have",   label: t("app.step.have.label"),   desc: t("app.step.have.desc") },
    { n: 4, key: "filter", label: t("app.step.filter.label"), desc: t("app.step.filter.desc") },
  ];
  function gotoStep(n) {
    setCurrentStep(n);
    // When in the workshop view, push the step-specific hash so the URL
    // is shareable. Other views (e.g. landing) just update internal state.
    if (view === "workshop") {
      const key = STEP_KEY_BY_NUMBER[n];
      if (key) {
        const desired = `#workshop/${key}`;
        if (typeof window !== "undefined" && window.location.hash !== desired) {
          window.location.hash = desired;
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#0F1419] text-[#E6EDF3]"
         style={{ fontFamily: "'IBM Plex Sans', 'IBM Plex Sans Devanagari', 'IBM Plex Sans JP', 'Noto Sans TC', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Devanagari:wght@400;500;600&family=IBM+Plex+Sans+JP:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
        /* Browser glyph fallback walks the family list until it finds one with
           the requested codepoint. Latin text stays in IBM Plex Sans; HI/JA/
           zh-TW fall through to the script-specific Plex/Noto faces. */
        body { font-family: 'IBM Plex Sans', 'IBM Plex Sans Devanagari', 'IBM Plex Sans JP', 'Noto Sans TC', sans-serif; }
        .mono { font-family: 'JetBrains Mono', 'IBM Plex Sans Devanagari', 'IBM Plex Sans JP', 'Noto Sans TC', monospace; }
        .grid-bg {
          background-image:
            linear-gradient(rgba(94,175,197,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(94,175,197,0.04) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        details > summary { list-style: none; cursor: pointer; }
        details > summary::-webkit-details-marker { display: none; }
        .chip-enter { animation: chipIn 0.18s ease-out; }
        @keyframes chipIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>

      {view === "landing"  && <Landing  onNavigate={navigateView} />}
      {view === "general"  && <General  onNavigate={navigateView} />}
      {view === "regional" && <Regional onNavigate={navigateView} />}
      {view === "trade"    && <Trade    onNavigate={navigateView} />}
      {view === "rules"    && <Rules    onNavigate={navigateView} />}
      {view === "algebra"  && <Algebra  onNavigate={navigateView} />}

      {view === "workshop" && (
      <div className="grid-bg min-h-screen">
        {/* Container matches the explainer's ChapterShell (max-w-4xl,
            px-4 sm:px-6, py-6 sm:py-8) so the brand mark + nav-bar sit at
            the same X/Y across landing, every chapter, and the workshop. */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

          {/* HEADER — same brand mark as the explainer chapters, but tabs
              are workshop steps and the primary action returns to the
              explainer landing. */}
          <WorkshopNav
            currentStepKey={STEP_KEY_BY_NUMBER[currentStep]}
            onStepClick={(key) => gotoStep(STEP_NUMBER_BY_KEY[key])}
            onSettingsClick={() => setShowSettings(true)}
            onNavigate={navigateView}
          />
          <div className="mb-6" />

          {/* STEP 1 — WHERE */}
          {currentStep === 1 && (
            <StepWrapper
              title={t("app.step.where.title")}
              hint={t("app.step.where.hint")}
              onNext={() => gotoStep(2)}
              nextLabel={t("app.step.where.next_label")}
            >
              <RegionalMap
                lastPin={lastPin}
                setLastPin={setLastPin}
                bazaarTags={bazaarTags}
                setBazaarTags={setBazaarTags}
                homeLocation={homeLocation}
                setHomeLocation={setHomeLocation}
                homeLocals={homeLocals}
                tradeTagName={config.basarTagName || "Trade"}
              />
            </StepWrapper>
          )}

          {/* STEP 2 — WHAT */}
          {currentStep === 2 && (
            <StepWrapper
              title={t("app.step.what.title")}
              hint={t("app.step.what.hint")}
              onBack={() => gotoStep(1)}
              onNext={() => gotoStep(3)}
              nextLabel={t("app.step.what.next_label")}
            >
              <ConfigPanel config={config} setConfig={setConfig} homeLocals={homeLocals} />
            </StepWrapper>
          )}

          {/* STEP 3 — HAVE */}
          {currentStep === 3 && (
            <StepWrapper
              title={t("app.step.have.title")}
              hint={t("app.step.have.hint")}
              onBack={() => gotoStep(2)}
              onNext={() => gotoStep(4)}
              nextLabel={t("app.step.have.next_label")}
            >
              <HundosEditor
                hundos={hundos}
                setHundos={setHundos}
                newHundo={newHundo}
                setNewHundo={setNewHundo}
                addHundo={addHundo}
                removeHundo={removeHundo}
              />
              {effectiveConfig.expertMode && (
                <>
                  {effectiveConfig.protectMythicals && (
                    <>
                      <hr className="my-8 border-[#1F2933]" />
                      <SpeciesListEditor
                        items={config.mythTooManyOf || []}
                        newItem={newMyth}
                        setNewItem={setNewMyth}
                        addItem={() => addToConfigList("mythTooManyOf", newMyth, setNewMyth)}
                        removeItem={(s) => removeFromConfigList("mythTooManyOf", s)}
                        titleKey="app.protect.myth_carve"
                        accent="#E91E63"
                      />
                    </>
                  )}
                  <hr className="my-8 border-[#1F2933]" />
                  <SpeciesListEditor
                    items={config.shadowKeeperSpecies || []}
                    newItem={newKeeper}
                    setNewItem={setNewKeeper}
                    addItem={() => addToConfigList("shadowKeeperSpecies", newKeeper, setNewKeeper)}
                    removeItem={(s) => removeFromConfigList("shadowKeeperSpecies", s)}
                    titleKey="app.protect.shadow_keepers"
                    accent="#9B59B6"
                  />
                  <hr className="my-8 border-[#1F2933]" />
                  <SpeciesListEditor
                    items={topAttackers}
                    newItem={newTopAttacker}
                    setNewItem={setNewTopAttacker}
                    addItem={addTopAttacker}
                    removeItem={removeTopAttacker}
                    titleKey="app.top_attackers"
                    accent="#5EAFC5"
                  />
                  <hr className="my-8 border-[#1F2933]" />
                  <SpeciesListEditor
                    items={topMaxAttackers}
                    newItem={newTopMaxAttacker}
                    setNewItem={setNewTopMaxAttacker}
                    addItem={addTopMaxAttacker}
                    removeItem={removeTopMaxAttacker}
                    titleKey="app.top_max_attackers"
                    accent="#F39C12"
                  />
                </>
              )}
            </StepWrapper>
          )}

          {/* STEP 4 — FILTER */}
          {currentStep === 4 && (
            <StepWrapper
              title={t("app.step.filter.title")}
              hint={t("app.step.filter.hint")}
              onBack={() => gotoStep(3)}
            >
              <div className="space-y-6">
                <FilterBox
                  label={t("app.filter.trash_label")}
                  accent="#E74C3C"
                  filterStr={trash}
                  copied={copied.trash}
                  onCopy={() => copyToClipboard("trash", trash)}
                  hint={t("app.filter.trash_hint")}
                />
                <FilterBox
                  label={t("app.filter.trade_label")}
                  accent="#5EAFC5"
                  filterStr={trade}
                  copied={copied.trade}
                  onCopy={() => copyToClipboard("trade", trade)}
                  hint={t("app.filter.trade_hint")}
                />
                {sort && (
                  <FilterBox
                    label={t("app.filter.sort_label")}
                    accent="#F5B82E"
                    filterStr={sort}
                    copied={copied.sort}
                    onCopy={() => copyToClipboard("sort", sort)}
                    hint={t("app.filter.sort_hint")}
                  />
                )}
                {buddyCatchFilters.length > 0 && (
                  <BuddyCatchSection
                    buddyCatchFilters={buddyCatchFilters}
                    copied={copied}
                    onCopy={(key, text) => copyToClipboard(key, text)}
                  />
                )}

                {/* Summary stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mono text-xs">
                  <StatBox label={t("app.stats.location")} value={homeLocation ? `${homeLocation[1].toFixed(1)}°,${homeLocation[0].toFixed(1)}°` : "—"} />
                  <StatBox label={t("app.stats.hundos")} value={hundos.length} />
                  <StatBox label={t("app.filter.trash_label")} value={`${trash.length}c`} />
                  <StatBox label={t("app.filter.trade_label")} value={`${trade.length}c`} />
                </div>

                {/* Aux pro-tools — task-oriented filters grouped by game aspect.
                    Order: solo workflows (trades / evos / megas) first, then
                    PvE encounters grouped by source. Within each PvE group
                    the more frequently-used surface sits on top. */}
                <div className="space-y-3 pt-2">
                  <Collapsible
                    icon="🛬"
                    label={t("app.collapsible.aux_trades")}
                    open={showAuxTrades}
                    onToggle={() => setShowAuxTrades((s) => !s)}>
                    <div className="space-y-4">
                      {prestaged && (
                        <FilterBox
                          label={t("app.filter.prestaged_label")}
                          accent="#9B59B6"
                          filterStr={prestaged}
                          copied={copied.prestaged}
                          onCopy={() => copyToClipboard("prestaged", prestaged)}
                          hint={t("app.filter.prestaged_hint", { params: { tags: [effectiveConfig.basarTagName, effectiveConfig.fernTauschTagName].filter(Boolean).map(tag => `#${tag}`).join(", ") } })}
                        />
                      )}
                      {gift && (
                        <FilterBox
                          label={t("app.filter.gift_label")}
                          accent="#27AE60"
                          filterStr={gift}
                          copied={copied.gift}
                          onCopy={() => copyToClipboard("gift", gift)}
                          hint={t("app.filter.gift_hint")}
                        />
                      )}
                      <FilterBox
                        label={t("app.filter.pilot_long_label")}
                        accent="#5EAFC5"
                        filterStr={pilotLong}
                        copied={copied.pilotLong}
                        onCopy={() => copyToClipboard("pilotLong", pilotLong)}
                        hint={t("app.filter.pilot_long_hint")}
                      />
                    </div>
                  </Collapsible>

                  <Collapsible
                    icon="🥚"
                    label={t("app.collapsible.aux_evos")}
                    open={showAuxEvos}
                    onToggle={() => setShowAuxEvos((s) => !s)}>
                    <div className="space-y-4">
                      {cheapEvolve ? (
                        <FilterBox
                          label={t("app.filter.cheap_evolve_label")}
                          accent="#27AE60"
                          filterStr={cheapEvolve}
                          copied={copied.cheapEvolve}
                          onCopy={() => copyToClipboard("cheapEvolve", cheapEvolve)}
                          hint={t("app.filter.cheap_evolve_hint")}
                        />
                      ) : (
                        <p className="text-xs italic text-[#8B98A5]">
                          {t("app.filter.cheap_evolve_empty")}
                        </p>
                      )}
                      <FilterBox
                        label={t("app.filter.dex_plus_label")}
                        accent="#27AE60"
                        filterStr={dexPlus}
                        copied={copied.dexPlus}
                        onCopy={() => copyToClipboard("dexPlus", dexPlus)}
                        hint={t("app.filter.dex_plus_hint")}
                      />
                    </div>
                  </Collapsible>

                  <Collapsible
                    icon="⚡"
                    label={t("app.collapsible.aux_megas")}
                    open={showAuxMegas}
                    onToggle={() => setShowAuxMegas((s) => !s)}>
                    <FilterBox
                      label={t("app.filter.mega_evolve_label")}
                      accent="#E91E63"
                      filterStr={megaEvolve}
                      copied={copied.megaEvolve}
                      onCopy={() => copyToClipboard("megaEvolve", megaEvolve)}
                      hint={t("app.filter.mega_evolve_hint")}
                    />
                  </Collapsible>
                </div>

                {/* Team Rocket section — encounters & their post-fight cleanup */}
                <div className="space-y-3 pt-4">
                  <h3 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
                    {t("app.collapsible.aux_section_team_rocket")}
                  </h3>
                  <RocketCollapsible
                    fetchedAt={rocketLineupsFetchedAt}
                    leaders={rocketLeaders}
                    typedGrunts={rocketTypedGrunts}
                    genericGrunts={rocketGenericGrunts}
                    typeLabels={rocketTypeLabels}
                    open={showAuxRocket}
                    onToggle={() => setShowAuxRocket((s) => !s)}
                    copied={copied}
                    copyToClipboard={copyToClipboard}
                    t={t}
                    outputLocale={effectiveOutputLocale}
                  />
                  <Collapsible
                    icon="🌑"
                    label={t("app.collapsible.aux_shadows")}
                    open={showAuxShadows}
                    onToggle={() => setShowAuxShadows((s) => !s)}>
                    <div className="space-y-4">
                      <FilterBox
                        label={t("app.filter.shadow_cheap_label")}
                        accent="#9B59B6"
                        filterStr={shadowCheap}
                        copied={copied.shadowCheap}
                        onCopy={() => copyToClipboard("shadowCheap", shadowCheap)}
                        hint={t("app.filter.shadow_cheap_hint")}
                      />
                      <FilterBox
                        label={t("app.filter.shadow_safe_label")}
                        accent="#9B59B6"
                        filterStr={shadowSafe}
                        copied={copied.shadowSafe}
                        onCopy={() => copyToClipboard("shadowSafe", shadowSafe)}
                        hint={t("app.filter.shadow_safe_hint")}
                      />
                      <FilterBox
                        label={t("app.filter.shadow_hundo_candidates_label")}
                        accent="#9B59B6"
                        filterStr={shadowHundoCandidates}
                        copied={copied.shadowHundoCandidates}
                        onCopy={() => copyToClipboard("shadowHundoCandidates", shadowHundoCandidates)}
                        hint={t("app.filter.shadow_hundo_candidates_hint")}
                      />
                      {shadowFrustration && (
                        <FilterBox
                          label={t("app.filter.shadow_frustration_label")}
                          accent="#9B59B6"
                          filterStr={shadowFrustration}
                          copied={copied.shadowFrustration}
                          onCopy={() => copyToClipboard("shadowFrustration", shadowFrustration)}
                          hint={t("app.filter.shadow_frustration_hint")}
                        />
                      )}
                    </div>
                  </Collapsible>
                </div>

                {/* Raids section — current bosses pulled from lily-dex-api;
                    run `npm run fetch-raid-bosses` to refresh the snapshot. */}
                <div className="space-y-3 pt-4">
                  <h3 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
                    {t("app.collapsible.aux_section_raids")}
                  </h3>
                  <BossCollapsible
                    icon="⚔️"
                    titleKey="app.collapsible.aux_raids"
                    fetchedAt={raidBossesFetchedAt}
                    bossesByTier={raidFilters}
                    eventGroups={eventRaidFilters}
                    tierOrder={["mega", "lvl5", "shadow_lvl5", "lvl3", "shadow_lvl3", "lvl1", "shadow_lvl1"]}
                    accent="#E74C3C"
                    open={showAuxRaids}
                    onToggle={() => setShowAuxRaids((s) => !s)}
                    copied={copied}
                    copyToClipboard={copyToClipboard}
                    keyPrefix="raid"
                    t={t}
                    locale={locale}
                  />

                  <MaxBattleCollapsible
                    fetchedAt={raidBossesFetchedAt}
                    maxTank={maxTank}
                    bossesByTier={maxBattleFilters}
                    tierOrder={["tier_3", "tier_2", "tier_1"]}
                    accent="#F39C12"
                    open={showAuxMaxBattles}
                    onToggle={() => setShowAuxMaxBattles((s) => !s)}
                    copied={copied}
                    copyToClipboard={copyToClipboard}
                    t={t}
                  />
                </div>

                {/* PvP section — top-30 meta picks per league with loose
                    PvP rank-1 IVs. Rankings pulled from lily-dex-api;
                    daily sync via .github/workflows/sync-pvp-rankings.yml. */}
                <div className="space-y-3 pt-4">
                  <h3 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
                    {t("app.collapsible.aux_section_pvp")}
                  </h3>
                  <PvpCollapsible
                    fetchedAt={pvpRankingsFetchedAt}
                    leagues={pvpFilters}
                    open={showAuxPvp}
                    onToggle={() => setShowAuxPvp((s) => !s)}
                    copied={copied}
                    copyToClipboard={copyToClipboard}
                    t={t}
                  />
                </div>

                {/* Internals — set theory / raw clauses / verify */}
                <div className="space-y-3 pt-4">
                  <h3 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
                    {t("app.collapsible.aux_section_nerd_stuff")}
                  </h3>
                  <Collapsible
                    icon="∑"
                    label={t("app.collapsible.set_theory")}
                    open={showSetTheory}
                    onToggle={() => setShowSetTheory(s => !s)}>
                    <SetTheory hundos={hundos} TE_full={TE_full} TE_trim={TE_trim} cfg={effectiveConfig} />
                  </Collapsible>

                  <Collapsible
                    icon="≡"
                    label={t("app.collapsible.raw_clauses")}
                    open={showRawClauses}
                    onToggle={() => setShowRawClauses(s => !s)}>
                    <RawClausesPanel trashClauses={trashClauses} tradeClauses={tradeClauses} sortClauses={sortClauses} prestagedClauses={prestagedClauses} giftClauses={giftClauses} buddyCatchFilters={buddyCatchFilters} />
                  </Collapsible>

                  <Collapsible
                    icon="✓"
                    label={t("app.collapsible.verify")}
                    open={showVerify}
                    onToggle={() => setShowVerify(s => !s)}>
                    <VerifyPanel trash={trash} trade={trade} hundos={hundos} TE_families={TRADE_EVO_FAMILIES} outputLocale={effectiveOutputLocale} />
                  </Collapsible>
                </div>
              </div>
            </StepWrapper>
          )}

          {/* FOOTER */}
          <footer className="mt-12 pt-6 border-t border-[#1F2933] mono text-xs text-[#8090A0] flex items-center gap-2 flex-wrap">
            <Sparkles size={11} className="text-[#5EAFC5]" />
            persistiert lokal · {hundos.length} hundos · trash {trash.length}c · trade {trade.length}c
            {homeLocation && <span> · home {homeLocation[1].toFixed(1)}°,{homeLocation[0].toFixed(1)}°</span>}
          </footer>
          <AppCredit />
        </div>
      </div>
      )}

      <SettingsModal
        open={showSettings}
        onClose={() => { setShowSettings(false); setResetArmed(false); }}
        config={config}
        setConfig={setConfig}
        onResetAll={resetAll}
        resetArmed={resetArmed}
        onExport={exportState}
        onImport={applyImportEnvelope}
      />
    </div>
  );
}

// ── Stepper-internal subcomponents ─────────────────────────────────────────

function StepWrapper({ title, hint, children, onBack, onNext, nextLabel }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-5">
      <div>
        <h2 className="mono text-xl font-bold text-[#E6EDF3]">{title}</h2>
        {hint && <p className="text-sm text-[#8B98A5] mt-1.5 max-w-2xl">{hint}</p>}
      </div>
      <div>{children}</div>
      <div className="flex items-center gap-2 pt-4 border-t border-[#1F2933]">
        {onBack && (
          <button onClick={onBack}
            className="mono text-sm bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] px-4 py-2 rounded transition">
            {t("app.step.back_button")}
          </button>
        )}
        <div className="flex-1" />
        {onNext && (
          <button onClick={onNext}
            className="mono text-sm bg-[#E74C3C] hover:bg-[#FF5A4A] text-white px-4 py-2 rounded transition">
            {nextLabel || t("app.step.next_default")}
          </button>
        )}
      </div>
    </section>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="border border-[#1F2933] rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[#8090A0]">{label}</div>
      <div className="text-[#E6EDF3] mt-0.5">{value}</div>
    </div>
  );
}

function BuddyCatchSection({ buddyCatchFilters, copied, onCopy }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#E67E22] flex items-baseline gap-2">
        <span>{t("app.buddy_catch.section_title")}</span>
        <span className="text-[#8090A0] normal-case">· {t("app.buddy_catch.section_subtitle")}</span>
      </div>
      {buddyCatchFilters.map(b => {
        const key = `buddyCatch:${b.prefix}`;
        return (
          <FilterBox
            key={b.prefix}
            label={t("app.buddy_catch.filter_label", { params: { name: b.buddyName } })}
            accent="#E67E22"
            filterStr={b.filter}
            copied={copied[key]}
            onCopy={() => onCopy(key, b.filter)}
          />
        );
      })}
    </div>
  );
}

function HundosEditor({ hundos, setHundos, newHundo, setNewHundo, addHundo, removeHundo }) {
  const { t } = useTranslation();
  // Live preview of what's about to be added: parse the input, resolve each token,
  // show a green chip for each resolved one + a red marker for unresolved tokens.
  const previewTokens = useMemo(() => {
    return newHundo.split(/[,;\s]+/).filter(Boolean).map(tok => {
      const info = resolveSpeciesInfo(tok);
      return { input: tok, info };
    });
  }, [newHundo]);

  const resolved = previewTokens.filter(p => p.info);
  const unresolved = previewTokens.filter(p => !p.info);
  const newResolved = resolved.filter(p => !hundos.includes(p.info.names.de.toLowerCase()));
  const dupes = resolved.filter(p => hundos.includes(p.info.names.de.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
        {t("app.hundos.count", { params: { count: hundos.length } })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {hundos.map(h => (
          <span key={h}
            className="chip-enter mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] pl-2.5 pr-1.5 py-1 rounded flex items-center gap-1.5 transition group">
            <span className="text-[#5EAFC5]">+</span>{h}
            <button onClick={() => removeHundo(h)}
              className="opacity-40 group-hover:opacity-100 hover:text-[#E74C3C] transition">
              <X size={12} />
            </button>
          </span>
        ))}
        {hundos.length === 0 && (
          <span className="mono text-xs text-[#8B98A5] italic">{t("app.hundos.empty")}</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newHundo}
          onChange={e => setNewHundo(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addHundo()}
          placeholder={t("app.hundos.input_placeholder")}
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addHundo}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          className="mono text-sm bg-[#E74C3C] hover:bg-[#FF5A4A] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> {t("app.hundos.add_button")}
        </button>
      </div>

      {/* Live preview of what would be added */}
      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            {t("app.hundos.preview_summary", { params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length } })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((tok, i) => {
              if (!tok.info) {
                return (
                  <span key={i} className="mono text-[11px] bg-[#E74C3C]/15 text-[#E74C3C] px-2 py-0.5 rounded"
                        title={t("app.hundos.unresolved_title")}>
                    ✗ {tok.input}
                  </span>
                );
              }
              const isDupe = hundos.includes(tok.info.names.de.toLowerCase());
              const labelByType = { number: "#", en: "EN", de: "DE", es: "ES", fr: "FR", "zh-TW": "ZH", hi: "HI", ja: "JA" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe
                      ? "bg-[#8090A0]/15 text-[#8B98A5]"
                      : "bg-[#27AE60]/15 text-[#27AE60]"
                  }`}
                  title={`#${tok.info.dex} · EN: ${tok.info.names.en} · DE: ${tok.info.names.de}${isDupe ? ` (${t("app.hundos.dupe_marker")})` : ""}`}>
                  <span className="text-[9px] opacity-60">{labelByType[tok.info.inputLocale]}</span>
                  {tok.info.names.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <p className="mono text-xs text-[#8090A0]">
        {t("app.hundos.input_help", { params: {
          numbers: t("app.hundos.input_help_numbers"),
          english: t("app.hundos.input_help_english"),
          german:  t("app.hundos.input_help_german"),
        } })}
      </p>
    </div>
  );
}

// Generic species-list editor — same multi-locale chip + preview UX as the
// hundos editor, but parameterized by `titleKey` so the i18n strings live
// under any namespace (e.g. `app.top_attackers.*`). Used for personal
// roster lists. Accent color drives the add-button hue.
function SpeciesListEditor({ items, newItem, setNewItem, addItem, removeItem, titleKey, accent }) {
  const { t } = useTranslation();
  const previewTokens = useMemo(() => {
    return newItem.split(/[,;\s]+/).filter(Boolean).map(tok => ({
      input: tok, info: resolveSpeciesInfo(tok),
    }));
  }, [newItem]);

  const resolved = previewTokens.filter(p => p.info);
  const unresolved = previewTokens.filter(p => !p.info);
  const newResolved = resolved.filter(p => !items.includes(p.info.names.de.toLowerCase()));
  const dupes = resolved.filter(p => items.includes(p.info.names.de.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
        {t(`${titleKey}.count`, { params: { count: items.length } })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {items.map(s => (
          <span key={s}
            className="chip-enter mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] pl-2.5 pr-1.5 py-1 rounded flex items-center gap-1.5 transition group">
            <span style={{ color: accent }}>+</span>{s}
            <button onClick={() => removeItem(s)}
              className="opacity-40 group-hover:opacity-100 hover:text-[#E74C3C] transition">
              <X size={12} />
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span className="mono text-xs text-[#8B98A5] italic">{t(`${titleKey}.empty`)}</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addItem()}
          placeholder={t(`${titleKey}.input_placeholder`)}
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addItem}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          style={{ backgroundColor: previewTokens.length === 0 || newResolved.length === 0 ? undefined : accent }}
          className="mono text-sm hover:brightness-110 disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> {t(`${titleKey}.add_button`)}
        </button>
      </div>

      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            {t(`${titleKey}.preview_summary`, { params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length } })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((tok, i) => {
              if (!tok.info) {
                return (
                  <span key={i} className="mono text-[11px] bg-[#E74C3C]/15 text-[#E74C3C] px-2 py-0.5 rounded"
                        title={t(`${titleKey}.unresolved_title`)}>
                    ✗ {tok.input}
                  </span>
                );
              }
              const isDupe = items.includes(tok.info.names.de.toLowerCase());
              const labelByType = { number: "#", en: "EN", de: "DE", es: "ES", fr: "FR", "zh-TW": "ZH", hi: "HI", ja: "JA" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe
                      ? "bg-[#8090A0]/15 text-[#8B98A5]"
                      : "bg-[#27AE60]/15 text-[#27AE60]"
                  }`}
                  title={`#${tok.info.dex} · EN: ${tok.info.names.en} · DE: ${tok.info.names.de}${isDupe ? ` (${t(`${titleKey}.dupe_marker`)})` : ""}`}>
                  <span className="text-[9px] opacity-60">{labelByType[tok.info.inputLocale]}</span>
                  {tok.info.names.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <p className="mono text-xs text-[#8090A0]">
        {t(`${titleKey}.input_help`, { params: {
          numbers: t(`${titleKey}.input_help_numbers`),
          english: t(`${titleKey}.input_help_english`),
          german:  t(`${titleKey}.input_help_german`),
        } })}
      </p>
    </div>
  );
}

function CustomCollectiblesEditor({ list, onChange }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  // Live preview using same resolver as hundo input
  const previewTokens = useMemo(() => {
    return input.split(/[,;\s]+/).filter(Boolean).map(tok => ({
      input: tok,
      info: resolveSpeciesInfo(tok),
    }));
  }, [input]);
  const resolved = previewTokens.filter(p => p.info);
  const newResolved = resolved.filter(p => !list.includes(p.info.names.de.toLowerCase()));
  const dupes = resolved.filter(p => list.includes(p.info.names.de.toLowerCase()));
  const unresolved = previewTokens.filter(p => !p.info);

  function addAll() {
    const tokens = input.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(list);
    const remaining = [];
    for (const tok of tokens) {
      const r = resolveSpecies(tok);
      if (r) set.add(r);
      else remaining.push(tok);
    }
    onChange([...set].sort());
    setInput(remaining.join(", "));
  }
  function remove(name) {
    onChange(list.filter(n => n !== name));
  }

  return (
    <div>
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
        {t("app.collectibles.title")}
      </div>
      <p className="mono text-xs text-[#8090A0] mb-3 leading-relaxed">
        {t("app.collectibles.description")}
      </p>

      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {list.map(sp => (
            <span key={sp}
              className="chip-enter mono text-xs bg-[#27AE60]/15 text-[#27AE60] border border-[#27AE60]/40 pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group">
              {sp}
              <button onClick={() => remove(sp)}
                className="opacity-50 group-hover:opacity-100 hover:text-[#FF6B5B] transition">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAll()}
          placeholder={t("app.collectibles.input_placeholder")}
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addAll}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          className="mono text-sm bg-[#27AE60] hover:bg-[#3FCF80] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> {t("app.collectibles.add_button")}
        </button>
      </div>

      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] mt-2 space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            {t("app.collectibles.preview_summary", { params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length } })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((tok, i) => {
              if (!tok.info) return (
                <span key={i} className="mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded">
                  ✗ {tok.input}
                </span>
              );
              const isDupe = list.includes(tok.info.names.de.toLowerCase());
              const labelByType = { number: "#", en: "EN", de: "DE", es: "ES", fr: "FR", "zh-TW": "ZH", hi: "HI", ja: "JA" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe
                      ? "bg-[#5C6975]/15 text-[#8090A0]"
                      : "bg-[#27AE60]/15 text-[#27AE60]"
                  }`}>
                  <span className="text-[9px] opacity-60">{labelByType[tok.info.inputLocale]}</span>
                  {tok.info.names.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SUBCOMPONENTS ────────────────────────────────────────────────────────

function FilterBox({ label, accent, filterStr, copied, onCopy, hint }) {
  const { t } = useTranslation();
  const len = filterStr.length;
  const pct = Math.min(100, (len / 5000) * 100);
  const codeRef = useRef(null);

  // Tap the filter text to select-all — on mobile this lets long-press → "Copy"
  // surface the system copy menu without needing the clipboard API at all.
  function selectAll() {
    const el = codeRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // copied tri-state: false | "ok" | "err"
  const buttonLabel =
    copied === "ok"  ? <><Check size={12} /> {t("app.filterbox.copied")}</> :
    copied === "err" ? <><X size={12} /> {t("app.filterbox.copy_error")}</> :
    <><Copy size={12} /> {t("app.filterbox.copy_button")}</>;
  const buttonColor =
    copied === "ok"  ? "#27AE60" :
    copied === "err" ? "#FF6B5B" :
    "#E6EDF3";

  return (
    <div className="border border-[#1F2933] rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1F2933] bg-[#141A21] gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="mono text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>
            {label}
          </span>
          <span className="mono text-xs text-[#8090A0]">
            {t("app.filterbox.length_label", { params: { len: len.toLocaleString() } })}
          </span>
          <div className="w-24 h-1 bg-[#1F2933] rounded-full overflow-hidden">
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: accent }} />
          </div>
        </div>
        <button
          onClick={onCopy}
          className="mono text-xs flex items-center gap-1.5 px-2.5 py-1 bg-[#1F2933] hover:bg-[#2D3A47] rounded transition"
          style={{ color: buttonColor }}>
          {buttonLabel}
        </button>
      </div>
      {hint && (
        <p className="px-4 py-2 text-xs italic text-[#8B98A5] leading-snug border-b border-[#1F2933] bg-[#0E141A]">
          {hint}
        </p>
      )}
      <div className="p-4 max-h-40 overflow-auto bg-[#0B0F14]">
        <code
          ref={codeRef}
          onClick={selectAll}
          className="mono text-xs text-[#E6EDF3] break-all leading-relaxed cursor-text select-all block"
          style={{ userSelect: "all", WebkitUserSelect: "all" }}
          title={t("app.filterbox.select_all_hint")}>
          {filterStr}
        </code>
      </div>
    </div>
  );
}

function Collapsible({ icon, label, open, onToggle, children }) {
  return (
    <details open={open} className="border border-[#1F2933] rounded">
      <summary onClick={e => { e.preventDefault(); onToggle(); }}
        className="px-4 py-3 flex items-center gap-3 hover:bg-[#141A21] transition">
        {open ? <ChevronDown size={14} className="text-[#5EAFC5]" /> : <ChevronRight size={14} className="text-[#8090A0]" />}
        <span className="mono text-sm text-[#5EAFC5]">{icon}</span>
        <span className="mono text-sm font-medium text-[#E6EDF3]">{label}</span>
      </summary>
      {open && <div className="px-4 pb-4 pt-2 border-t border-[#1F2933]">{children}</div>}
    </details>
  );
}

// "2h ago", "3d ago" — relative-age formatter used in the Raid/Max-Battle
// collapsible headers so users can tell when the boss snapshot was last synced.
function formatSyncAge(iso, t) {
  if (!iso) return null;
  const ageMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) return null;
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return t("app.filter.last_sync_minutes", { params: { minutes } });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("app.filter.last_sync_hours", { params: { hours } });
  const days = Math.floor(hours / 24);
  return t("app.filter.last_sync_days", { params: { days } });
}

// Formats a raid-event time window as a short teaser string for the
// accordion summary line. Three branches:
//   - active (now ∈ [start, end]):
//       same calendar day  → "today HH:MM–HH:MM"
//       multi-day          → "now → DOW HH:MM"
//   - upcoming today        → "starts HH:MM"
//   - upcoming this week    → "DOW HH:MM"
// Locale-aware via Intl: weekday short-name and 24h time both follow `locale`.
function formatEventWindow(start, end, t, locale) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";
  const now = Date.now();
  const fmtTime = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDow  = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const sameCalendarDay = (a, b) =>
    new Date(a).toDateString() === new Date(b).toDateString();

  if (now >= startMs && now <= endMs) {
    if (sameCalendarDay(startMs, endMs)) {
      return t("app.filter.event_window_active_today", {
        params: { start: fmtTime.format(startMs), end: fmtTime.format(endMs) },
      });
    }
    return t("app.filter.event_window_active_multiday", {
      params: { dow: fmtDow.format(endMs), end: fmtTime.format(endMs) },
    });
  }
  if (sameCalendarDay(startMs, now)) {
    return t("app.filter.event_window_upcoming_today", {
      params: { time: fmtTime.format(startMs) },
    });
  }
  return t("app.filter.event_window_upcoming_week", {
    params: { dow: fmtDow.format(startMs), time: fmtTime.format(startMs) },
  });
}

// Renders a single per-aspect boss collapsible (Raids or Max Battles). Each
// boss inside becomes one FilterBox; skipped bosses (no clean counter) get a
// short italic note instead. Header shows total boss count and last sync age.
//
// `eventGroups` (optional) renders short-window event raids as their own
// accordion rows above the standing tiers — currently-active events open
// by default, upcoming ones collapse with a window teaser.
function BossCollapsible({
  icon, titleKey, fetchedAt, bossesByTier, eventGroups, tierOrder, accent,
  open, onToggle, copied, copyToClipboard, keyPrefix, t, locale,
}) {
  const tierBosses = tierOrder.flatMap((tier) => bossesByTier?.[tier] || []);
  const eventBosses = (eventGroups || []).flatMap(g => g.bosses || []);
  const totalBosses = tierBosses.length + eventBosses.length;
  const age = formatSyncAge(fetchedAt, t);
  const headerLabel = t(titleKey);
  const countLabel = t("app.collapsible.aux_raids_count", { params: { count: totalBosses } });
  const footerLabel = age
    ? t("app.collapsible.aux_footer", { params: { count: countLabel, age } })
    : t("app.collapsible.aux_footer_no_age", { params: { count: countLabel } });
  if (totalBosses === 0) {
    return (
      <Collapsible icon={icon} label={headerLabel} open={open} onToggle={onToggle}>
        <p className="text-xs italic text-[#8B98A5]">{t("app.filter.aux_bosses_empty")}</p>
      </Collapsible>
    );
  }
  const renderBossBox = (boss, eventIdSuffix) => {
    if (boss.skipped) {
      return (
        <p key={boss.id} className="text-xs italic text-[#8B98A5] pl-2">
          {t("app.filter.boss_no_clean_counter", { params: { boss: boss.name } })}
        </p>
      );
    }
    // Distinct copy key per (event, boss) pair so an event-context Latios
    // and a standing-tier Latios don't share copy state.
    const copyKey = eventIdSuffix
      ? `${keyPrefix}_evt_${eventIdSuffix}_${boss.id}`
      : `${keyPrefix}_${boss.id}`;
    return (
      <FilterBox
        key={boss.id}
        label={t("app.filter.raid_counter_label", { params: { boss: boss.name } })}
        accent={accent}
        filterStr={boss.clause}
        copied={copied[copyKey]}
        onCopy={() => copyToClipboard(copyKey, boss.clause)}
        hint={t("app.filter.raid_counter_hint", { params: { boss: boss.name } })}
      />
    );
  };
  const hasEvents = (eventGroups || []).length > 0;
  return (
    <Collapsible icon={icon} label={headerLabel} open={open} onToggle={onToggle}>
      <div className="space-y-5">{/* tiers below; footer rendered at end */}
        {hasEvents && (
          <div className="space-y-3">
            <h4 className="mono text-xs uppercase tracking-wide text-[#8090A0]">
              {t("app.collapsible.aux_event_raids_heading")}
            </h4>
            {eventGroups.map((event) => {
              const startMs = Date.parse(event.start);
              const endMs = Date.parse(event.end);
              const isActive = Date.now() >= startMs && Date.now() <= endMs;
              const teaser = formatEventWindow(event.start, event.end, t, locale);
              return (
                <TrainerAccordion
                  key={event.eventID}
                  name={event.name}
                  teaser={teaser}
                  accent={accent}
                  highlight={isActive}
                >
                  {(event.bosses || []).map(b => renderBossBox(b, event.eventID))}
                </TrainerAccordion>
              );
            })}
          </div>
        )}
        {tierOrder.map((tier) => {
          const list = bossesByTier?.[tier];
          if (!list || list.length === 0) return null;
          const tierTeaser = t("app.collapsible.aux_raids_count", {
            params: { count: list.length },
          });
          return (
            <TrainerAccordion
              key={tier}
              name={t(`app.collapsible.aux_boss_tier.${tier}`)}
              teaser={tierTeaser}
              accent={accent}
              highlight={false}
            >
              {list.map((boss) => renderBossBox(boss))}
            </TrainerAccordion>
          );
        })}
      </div>
      <p className="mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]">
        {footerLabel}
      </p>
    </Collapsible>
  );
}

function lineupHint(phases, t) {
  if (!phases || phases.length === 0) return "";
  return phases
    .filter(p => (p.pokemons || []).length > 0)
    .map(p => {
      const names = p.pokemons.map(pk => pk.name).join(t("app.filter.rocket_lineup_or"));
      return t("app.filter.rocket_lineup_phase", { params: { slot: p.slot, names } });
    })
    .join(" ");
}

function topHitsHint(topHits, t) {
  if (!topHits || topHits.length === 0) return "";
  return topHits
    .map(h => t("app.filter.rocket_top_hit", {
      params: { type: h.localizedType || h.type, hits: h.hits, total: h.total },
    }))
    .join(" · ");
}

// Uncontrolled accordion row used both for Rocket trainers and for raid /
// Max Battle tiers. Native <details> handles its own open/close state — no
// React state plumbing needed, and multiple rows can stay open at once.
// Mirrors the visual rhythm of the parent Collapsible but a half-step smaller.
function TrainerAccordion({ name, teaser, accent, highlight, children }) {
  // `highlight` (used when the quote-lookup widget locks onto this card):
  // forces the accordion open and adds a colored ring so the user can see
  // the match instantly. Re-mounts the <details> via key={highlight} so the
  // browser respects the change of `open` after the user toggled it.
  return (
    <details
      key={highlight ? "open" : "auto"}
      open={highlight || undefined}
      className="border rounded bg-[#0E141A] transition"
      style={{
        borderColor: highlight ? "#5EAFC5" : "#1F2933",
        boxShadow: highlight ? "0 0 0 2px rgba(94, 175, 197, 0.25)" : "none",
      }}
    >
      <summary className="px-3 py-2 cursor-pointer flex items-center gap-3 hover:bg-[#141A21] transition list-none">
        <ChevronRight size={12} className="text-[#8090A0] details-arrow shrink-0" />
        <span className="mono text-sm font-medium" style={{ color: accent || "#E6EDF3" }}>{name}</span>
        {teaser && <span className="mono text-[11px] text-[#8090A0] truncate">· {teaser}</span>}
      </summary>
      <div className="px-3 pb-3 pt-2 border-t border-[#1F2933] space-y-3">{children}</div>
    </details>
  );
}

// Compact teaser strings for the closed accordion state. Keep these short —
// they share a row with the trainer name and ellipsize.
function leaderTeaser(leader, t) {
  const phases = (leader.phases || []).filter(p => !p.skipped);
  return t("app.filter.rocket_teaser_leader", { params: { count: phases.length } });
}
function typedGruntTeaser(g, t) {
  const allNames = (g.phases || []).flatMap(p => (p.pokemons || []).map(pk => pk.name));
  const sample = [...new Set(allNames)].slice(0, 3).join(", ");
  return sample;
}
function genericGruntTeaser(g, t) {
  if (!g.topHits || g.topHits.length === 0) return "";
  return t("app.filter.rocket_teaser_generic", {
    params: { types: g.topHits.map(h => h.localizedType || h.type).join(", ") },
  });
}

// Combines the universal charger filter and the per-boss Max Battle counters
// into one collapsible. The charger filter (0.5s fast moves & dynamax-eligible)
// applies regardless of boss, so it sits at the top above the per-tier boss
// fan-out. Footer shows the boss-snapshot age since that's what rotates;
// the charger move list is essentially static.
function MaxBattleCollapsible({
  fetchedAt, maxTank, bossesByTier, tierOrder, accent,
  open, onToggle, copied, copyToClipboard, t,
}) {
  const allBosses = tierOrder.flatMap(tier => bossesByTier?.[tier] || []);
  const totalBosses = allBosses.length;
  const hasCharger = !!maxTank?.clause;
  const filterCount = totalBosses + (hasCharger ? 1 : 0);
  const age = formatSyncAge(fetchedAt, t);
  const headerLabel = t("app.collapsible.aux_max_battles");
  const countLabel = t("app.collapsible.aux_max_battles_count", { params: { count: filterCount } });
  const footerLabel = age
    ? t("app.collapsible.aux_footer", { params: { count: countLabel, age } })
    : t("app.collapsible.aux_footer_no_age", { params: { count: countLabel } });
  if (filterCount === 0) {
    return (
      <Collapsible icon="💥" label={headerLabel} open={open} onToggle={onToggle}>
        <p className="text-xs italic text-[#8B98A5]">{t("app.filter.aux_bosses_empty")}</p>
      </Collapsible>
    );
  }
  const hasBosses = totalBosses > 0;
  return (
    <Collapsible icon="💥" label={headerLabel} open={open} onToggle={onToggle}>
      <div className="space-y-5">
        {hasCharger && (
          <div className="space-y-3">
            <h4 className="mono text-xs uppercase tracking-wide text-[#8090A0]">
              {t("app.collapsible.aux_max_tank")}
            </h4>
            <FilterBox
              label={t("app.filter.max_tank_label")}
              accent="#1ABC9C"
              filterStr={maxTank.clause}
              copied={copied.max_tank}
              onCopy={() => copyToClipboard("max_tank", maxTank.clause)}
              hint={t("app.filter.max_tank_hint")}
            />
          </div>
        )}
        {hasBosses && (
          <div className="space-y-4">
            <h4 className="mono text-xs uppercase tracking-wide text-[#8090A0]">
              {t("app.collapsible.aux_max_attacker")}
            </h4>
            {tierOrder.map((tier) => {
              const list = bossesByTier?.[tier];
              if (!list || list.length === 0) return null;
              const tierTeaser = t("app.collapsible.aux_raids_count", {
                params: { count: list.length },
              });
              return (
                <TrainerAccordion
                  key={tier}
                  name={t(`app.collapsible.aux_boss_tier.${tier}`)}
                  teaser={tierTeaser}
                  accent={accent}
                  highlight={false}
                >
                  {list.map((boss) => {
                    if (boss.skipped) {
                      return (
                        <p key={boss.id} className="text-xs italic text-[#8B98A5] pl-2">
                          {t("app.filter.boss_no_clean_counter", { params: { boss: boss.name } })}
                        </p>
                      );
                    }
                    const copyKey = `max_${boss.id}`;
                    return (
                      <FilterBox
                        key={boss.id}
                        label={t("app.filter.raid_counter_label", { params: { boss: boss.name } })}
                        accent={accent}
                        filterStr={boss.clause}
                        copied={copied[copyKey]}
                        onCopy={() => copyToClipboard(copyKey, boss.clause)}
                        hint={t("app.filter.raid_counter_hint", { params: { boss: boss.name } })}
                      />
                    );
                  })}
                </TrainerAccordion>
              );
            })}
          </div>
        )}
      </div>
      <p className="mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]">
        {footerLabel}
      </p>
    </Collapsible>
  );
}

// One filter per league (Great / Ultra / Master). Simpler than the boss /
// rocket collapsibles since each league is a single FilterBox — no
// nested accordion, no per-phase fan-out.
function PvpCollapsible({ fetchedAt, leagues, open, onToggle, copied, copyToClipboard, t }) {
  const order = ["great", "ultra", "master"];
  const accentByLeague = { great: "#3498DB", ultra: "#9B59B6", master: "#F1C40F" };
  const populated = order.filter(k => leagues?.[k] && !leagues[k].skipped);
  const age = formatSyncAge(fetchedAt, t);
  const headerLabel = t("app.collapsible.aux_pvp");
  const countLabel = t("app.collapsible.aux_pvp_count", { params: { count: populated.length } });
  const footerLabel = age
    ? t("app.collapsible.aux_footer", { params: { count: countLabel, age } })
    : t("app.collapsible.aux_footer_no_age", { params: { count: countLabel } });
  if (populated.length === 0) {
    return (
      <Collapsible icon="🥊" label={headerLabel} open={open} onToggle={onToggle}>
        <p className="text-xs italic text-[#8B98A5]">{t("app.filter.aux_pvp_empty")}</p>
      </Collapsible>
    );
  }
  return (
    <Collapsible icon="🥊" label={headerLabel} open={open} onToggle={onToggle}>
      <div className="space-y-4">
        {populated.map((key) => {
          const league = leagues[key];
          const copyKey = `pvp_${key}`;
          return (
            <FilterBox
              key={copyKey}
              label={t(`app.filter.pvp_${key}_label`)}
              accent={accentByLeague[key]}
              filterStr={league.clause}
              copied={copied[copyKey]}
              onCopy={() => copyToClipboard(copyKey, league.clause)}
              hint={t(`app.filter.pvp_${key}_hint`)}
            />
          );
        })}
      </div>
      <p className="mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]">
        {footerLabel}
      </p>
    </Collapsible>
  );
}

// Renders the in-game "Spruch" the grunt yells before battle, in the
// player's outputLocale. Displayed inside open trainer accordions so the
// user can match the encounter dialog they just saw in PoGo.
function GruntQuoteLine({ quote, t }) {
  return (
    <div className="mono italic text-[11.5px] leading-snug text-[#A8B3BD]">
      <span className="not-italic text-[#8090A0] mr-1.5">{t("app.filter.rocket_grunt_quote_label")}:</span>
      &ldquo;{quote}&rdquo;
    </div>
  );
}
function GruntQuoteList({ quotes, t }) {
  return (
    <div className="space-y-0.5">
      {quotes.map((q, i) => <GruntQuoteLine key={i} quote={q} t={t} />)}
    </div>
  );
}

function RocketCollapsible({
  fetchedAt, leaders, typedGrunts, genericGrunts, typeLabels,
  open, onToggle, copied, copyToClipboard, t, outputLocale,
}) {
  const [highlightedType, setHighlightedType] = useState(null);
  const totalFilters =
    leaders.reduce((a, l) => a + l.phases.filter(p => !p.skipped).length, 0) +
    typedGrunts.filter(g => !g.skipped).length +
    genericGrunts.filter(g => !g.skipped).length;
  const age = formatSyncAge(fetchedAt, t);
  const headerLabel = t("app.collapsible.aux_rocket");
  const countLabel = t("app.collapsible.aux_rocket_count", { params: { count: totalFilters } });
  const footerLabel = age
    ? t("app.collapsible.aux_footer", { params: { count: countLabel, age } })
    : t("app.collapsible.aux_footer_no_age", { params: { count: countLabel } });
  if (totalFilters === 0) {
    return (
      <Collapsible icon="🚀" label={headerLabel} open={open} onToggle={onToggle}>
        <p className="text-xs italic text-[#8B98A5]">{t("app.filter.aux_rocket_empty")}</p>
      </Collapsible>
    );
  }
  return (
    <Collapsible icon="🚀" label={headerLabel} open={open} onToggle={onToggle}>
      <div className="space-y-5">
        <RocketQuoteLookup
          data={ROCKET_GRUNT_QUOTES}
          outputLocale={outputLocale}
          t={t}
          onTypedMatch={setHighlightedType}
          localizedTypeDisplay={(k) => (typeLabels && typeLabels[k]) || k}
        />
        {leaders.length > 0 && (
          <div className="space-y-2">
            <h4 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
              {t("app.collapsible.aux_rocket_leaders")}
            </h4>
            <div className="space-y-1.5">
              {leaders.map(leader => (
                <TrainerAccordion
                  key={leader.name}
                  name={leader.name}
                  teaser={leaderTeaser(leader, t)}
                  accent="#C0392B"
                >
                  {leader.phases.map(phase => {
                    if (phase.skipped) return null;
                    const copyKey = `rocket_${leader.name}_${phase.slot}`;
                    return (
                      <FilterBox
                        key={copyKey}
                        label={t("app.filter.rocket_phase_label", { params: { slot: phase.slot } })}
                        accent="#C0392B"
                        filterStr={phase.clause}
                        copied={copied[copyKey]}
                        onCopy={() => copyToClipboard(copyKey, phase.clause)}
                        hint={t("app.filter.rocket_phase_hint", {
                          params: { names: phase.pokemons.map(p => p.name).join(t("app.filter.rocket_lineup_or")) },
                        })}
                      />
                    );
                  })}
                </TrainerAccordion>
              ))}
            </div>
          </div>
        )}

        {typedGrunts.length > 0 && (
          <div className="space-y-2">
            <h4 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
              {t("app.collapsible.aux_rocket_typed_grunts")}
            </h4>
            <div className="space-y-1.5">
              {typedGrunts.map(g => {
                if (g.skipped) return null;
                const copyKey = `rocket_typed_${g.type}`;
                return (
                  <TrainerAccordion
                    key={copyKey}
                    name={g.name}
                    teaser={typedGruntTeaser(g, t)}
                    accent="#9B59B6"
                    highlight={g.type === highlightedType}
                  >
                    {g.quote && <GruntQuoteLine quote={g.quote} t={t} />}
                    <FilterBox
                      label={t("app.filter.rocket_grunt_filter_label")}
                      accent="#9B59B6"
                      filterStr={g.clause}
                      copied={copied[copyKey]}
                      onCopy={() => copyToClipboard(copyKey, g.clause)}
                      hint={lineupHint(g.phases, t)}
                    />
                  </TrainerAccordion>
                );
              })}
            </div>
          </div>
        )}

        {genericGrunts.length > 0 && (
          <div className="space-y-2">
            <h4 className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">
              {t("app.collapsible.aux_rocket_generic_grunts")}
            </h4>
            <div className="space-y-1.5">
              {genericGrunts.map(g => {
                if (g.skipped) return null;
                const copyKey = `rocket_generic_${g.name}`;
                return (
                  <TrainerAccordion
                    key={copyKey}
                    name={g.name}
                    teaser={genericGruntTeaser(g, t)}
                    accent="#16A085"
                  >
                    {(g.quotes || []).length > 0 && <GruntQuoteList quotes={g.quotes} t={t} />}
                    <FilterBox
                      label={t("app.filter.rocket_grunt_filter_label")}
                      accent="#16A085"
                      filterStr={g.clause}
                      copied={copied[copyKey]}
                      onCopy={() => copyToClipboard(copyKey, g.clause)}
                      hint={`${topHitsHint(g.topHits, t)} — ${lineupHint(g.phases, t)}`}
                    />
                  </TrainerAccordion>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <p className="mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]">
        {footerLabel}
      </p>
    </Collapsible>
  );
}

function SetTheory({ hundos, TE_full, TE_trim, cfg }) {
  const { t } = useTranslation();
  const Pdesc = cfg.pvpMode === "loose" ? "(0-1, 3-4, 3-4)"
            : cfg.pvpMode === "strict" ? "(0, 3-4, 3-4)" : t("app.set_theory.p_disabled");
  // Rule-1 help splits around the bold {auto} marker so we keep it styled as <em>.
  const autoMarker = t("app.set_theory.rule1_help_auto");
  const ruleParts = t("app.set_theory.rule1_help", { params: { auto: autoMarker } }).split(autoMarker);
  return (
    <div className="mono text-xs text-[#A8B3BD] leading-relaxed space-y-3">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <span className="text-[#5EAFC5]">H</span>
        <span>= {`{${t("app.set_theory.h_value", { params: { count: hundos.length } })}}`} → {t("app.set_theory.h_note")} <code className="text-[#E6EDF3]">+species</code></span>
        <span className="text-[#5EAFC5]">K</span>
        <span>= (4,4,3-4) ∪ (4,3-4,4) ∪ (3-4,4,4) <span className="text-[#8090A0]">— {t("app.set_theory.k_note")}</span></span>
        <span className="text-[#5EAFC5]">P</span>
        <span>= {Pdesc} <span className="text-[#8090A0]">— {t("app.set_theory.p_note")}</span></span>
        <span className="text-[#5EAFC5]">S012</span>
        <span>= 0★ ∪ 1★ ∪ 2★</span>
        <span className="text-[#5EAFC5]">TE</span>
        <span>= {`{${t("app.set_theory.te_value", { params: { count: TE_full.length } })}}`} {t("app.set_theory.te_note", { params: { count: TE_trim.length } })}</span>
      </div>
      <hr className="border-[#1F2933]" />
      <div className="space-y-1.5">
        <div className="text-[#E74C3C]">{t("app.set_theory.trash_label")}<span className="text-[#8090A0]"> = (S012 ∪ (H ∩ ¬K)) ∩ ¬P ∩ ¬Prot</span></div>
        <div className="text-[#5EAFC5]">{t("app.set_theory.trade_label")}<span className="text-[#8090A0]"> = (S012 ∪ TE ∪ (H ∩ ¬K)) ∩ ¬P ∩ ¬S4 ∩ ¬Prot ∩ ¬Traded</span></div>
      </div>
      <div className="text-[#8090A0] text-[10.5px] leading-relaxed pt-2">
        <span className="text-[#F5B82E]">▲</span> {ruleParts[0]}<em>{autoMarker}</em>{ruleParts[1] || ""}
      </div>
    </div>
  );
}

function RawClausesPanel({ trashClauses, tradeClauses, sortClauses, prestagedClauses, giftClauses, buddyCatchFilters }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5 mono text-xs">
      <div className="text-[#8090A0] leading-relaxed">
        {t("app.clauses.intro")}
      </div>

      <ClauseList title={t("app.clauses.trash_title")} accent="#E74C3C" clauses={trashClauses} />
      <ClauseList title={t("app.clauses.trade_title")} accent="#5EAFC5" clauses={tradeClauses} />
      {sortClauses && sortClauses.length > 0 && (
        <ClauseList title={t("app.clauses.sort_title")} accent="#F5B82E" clauses={sortClauses} />
      )}
      {prestagedClauses && prestagedClauses.length > 0 && (
        <ClauseList title={t("app.clauses.prestaged_title")} accent="#9B59B6" clauses={prestagedClauses} />
      )}
      {giftClauses && giftClauses.length > 0 && (
        <ClauseList title={t("app.clauses.gift_title")} accent="#27AE60" clauses={giftClauses} />
      )}
      {buddyCatchFilters && buddyCatchFilters.length > 0 && buddyCatchFilters.map(b => (
        <ClauseList key={`catch:${b.prefix}`} title={t("app.buddy_catch.filter_label", { params: { name: b.buddyName } })} accent="#E67E22" clauses={b.clauses} />
      ))}
    </div>
  );
}

function ClauseList({ title, accent, clauses }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mono text-[10.5px] uppercase tracking-wider mb-2" style={{ color: accent }}>
        {title} · {t("app.clauses.count_suffix", { params: { count: clauses.length } })}
      </div>
      <div className="border border-[#1F2933] rounded divide-y divide-[#1F2933]">
        {clauses.map((c, i) => (
          <div key={i} className="px-3 py-2 hover:bg-[#141A21] transition">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-[#8090A0] flex-shrink-0">{i+1}.</span>
              <code className="text-[#E6EDF3] flex-1 break-all">{c.clause}</code>
            </div>
            <div className="text-[10.5px] text-[#8090A0] mt-1 ml-5 leading-tight">
              {c.why}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerifyPanel({ trash, trade, hundos, TE_families, outputLocale = "de" }) {
  const { t } = useTranslation();
  const [m, setM] = useState({
    family: "", star: 2, atk: 1, def: 1, hp: 1,
    flags: {}, types: [], dex: 0,
  });
  function setFlag(k, v) { setM({ ...m, flags: { ...m.flags, [k]: v } }); }

  // Build mon for parser. Family expansion uses the multi-locale resolver so
  // the user can type a family in any language.
  const mon = useMemo(() => {
    const fam = m.family.trim().toLowerCase().replace(/^\+/, "");
    let families = fam ? [fam] : [];
    if (fam) {
      const info = resolveSpeciesInfo(fam);
      if (info) {
        for (const [, family] of Object.entries(TE_families)) {
          if (family.memberDex && family.memberDex.includes(info.dex)) {
            const memberNames = family.memberDex
              .map(d => pokemonNameFor(String(d), outputLocale))
              .filter(Boolean);
            families = [...new Set([...families, ...memberNames])];
          }
        }
      }
    }
    return {
      ...m, families, dex: m.dex || 0,
      wp: 1500, ageDays: 5, distance: m.flags.farDistance ? 200 : 0,
      year: 2025,
    };
  }, [m, TE_families, outputLocale]);

  const inTrash = useMemo(() => evalFilter(trash, mon, outputLocale), [trash, mon, outputLocale]);
  const inTrade = useMemo(() => evalFilter(trade, mon, outputLocale), [trade, mon, outputLocale]);
  const inH = hundos.includes(mon.families[0] || "");

  const flagToggles = [
    ["favorite","app.verify.flag_fav"],["tagged","app.verify.flag_tag"],["shiny","app.verify.flag_shiny"],["lucky","app.verify.flag_lucky"],
    ["legendary","app.verify.flag_legend"],["mythical","app.verify.flag_myth"],["shadow","app.verify.flag_crypto"],["legacyMove","app.verify.flag_legacy"],
    ["megaEvolved","app.verify.flag_mega"],["dynamaxCapable","app.verify.flag_dyna"],["doubleMoved","app.verify.flag_double_move"],
    ["xxl","app.verify.flag_xxl"],["xl","app.verify.flag_xl"],["xxs","app.verify.flag_xxs"],["leagueU","app.verify.flag_league_u"],["buddy","app.verify.flag_buddy"],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FieldText label={t("app.verify.field_family")} value={m.family} onChange={v => setM({ ...m, family: v })} placeholder={t("app.verify.placeholder_family")} />
        <FieldNum label={t("app.verify.field_star")} value={m.star} onChange={v => setM({ ...m, star: +v })} min={0} max={4} />
        <FieldNum label={t("app.verify.field_atk")} value={m.atk} onChange={v => setM({ ...m, atk: +v })} min={0} max={4} />
        <FieldNum label={t("app.verify.field_def")} value={m.def} onChange={v => setM({ ...m, def: +v })} min={0} max={4} />
        <FieldNum label={t("app.verify.field_hp")} value={m.hp} onChange={v => setM({ ...m, hp: +v })} min={0} max={4} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {flagToggles.map(([k, labelKey]) => (
          <button key={k}
            onClick={() => setFlag(k, !m.flags[k])}
            className={`mono text-[11px] px-2 py-1 rounded transition ${
              m.flags[k]
                ? "bg-[#5EAFC5] text-[#0F1419]"
                : "bg-[#1F2933] text-[#8B98A5] hover:bg-[#2D3A47]"
            }`}>
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-2">
        <ResultBox label={t("app.filter.trash_label")} verdict={inTrash} accent="#E74C3C" />
        <ResultBox label={t("app.filter.trade_label")} verdict={inTrade} accent="#5EAFC5" />
      </div>
      <div className="mono text-[11px] text-[#8090A0]">
        {t("app.verify.family_in_h")} <span className={inH ? "text-[#5EAFC5]" : "text-[#8090A0]"}>{inH ? t("app.verify.yes") : t("app.verify.no")}</span>
        <span className="mx-2">·</span>
        {t("app.verify.iv_class")} {classifyIV(m.atk, m.def, m.hp, t)}
      </div>
    </div>
  );
}

function classifyIV(a, d, h, t) {
  const isP = a <= 1 && d >= 3 && h >= 3;
  const k1 = a === 4 && d === 4 && h >= 3;
  const k2 = a === 4 && d >= 3 && h === 4;
  const k3 = a >= 3 && d === 4 && h === 4;
  if (k1 || k2 || k3) return <span className="text-[#5EAFC5]">{t("app.verify.k_keeper")}</span>;
  if (isP) return <span className="text-[#F5B82E]">{t("app.verify.p_pvp")}</span>;
  return <span className="text-[#8090A0]">{t("app.verify.neither")}</span>;
}

function ResultBox({ label, verdict, accent }) {
  const { t } = useTranslation();
  return (
    <div className="border rounded p-3" style={{ borderColor: verdict ? accent : "#1F2933" }}>
      <div className="mono text-[11px] uppercase tracking-wider text-[#8090A0]">{label}</div>
      <div className="mono text-lg font-bold mt-1" style={{ color: verdict ? accent : "#8090A0" }}>
        {verdict ? t("app.verify.visible") : t("app.verify.hidden")}
      </div>
    </div>
  );
}

function FieldText({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] placeholder:text-[#8090A0] mt-1" />
    </div>
  );
}
function FieldNum({ label, value, onChange, min, max }) {
  return (
    <div>
      <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} min={min} max={max}
        className="mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1" />
    </div>
  );
}

// ─── PRESETS ────────────────────────────────────────────────────────────────

const PRESETS = {
  casual: {
    labelKey: "app.preset.casual.label",
    descriptionKey: "app.preset.casual.description",
    apply: (cfg) => ({
      ...cfg,
      pvpMode: "strict",
      protectFavorites: true, protectShinies: true, protectLuckies: true,
      protectLegendaries: true, protectMythicals: true,
      protectUltraBeasts: true, protectShadows: true, protectPurified: true,
      protectCostumes: true, protectBackgrounds: true, protectLegacyMoves: true,
      protectBabies: true,
      protectXXL: true, protectXL: true, protectXXS: true,
      protectDoubleMoved: true, protectDynamax: true, protectNewEvolutions: true,
      protectBuddies: true,
      protectLuckyEligible: true, luckyEligibleYear: 21,
      regionalGroups: defaultRegionalToggles(),
    }),
  },
  collector: {
    labelKey: "app.preset.collector.label",
    descriptionKey: "app.preset.collector.description",
    apply: (cfg) => {
      const groups = defaultRegionalToggles();
      for (const k of Object.keys(groups)) groups[k].enabled = true;
      return { ...cfg,
        pvpMode: "none",
        protectFavorites: true, protectShinies: true, protectLuckies: true,
        protectLegendaries: true, protectMythicals: true,
        protectUltraBeasts: true, protectShadows: true, protectPurified: true,
        protectCostumes: true, protectBackgrounds: true, protectLegacyMoves: true,
        protectBabies: true,
        protectXXL: true, protectXL: true, protectXXS: true,
        protectDoubleMoved: true, protectDynamax: true, protectNewEvolutions: true,
        protectBuddies: true,
        protectLuckyEligible: true, luckyEligibleYear: 21,
        regionalGroups: groups,
      };
    },
  },
  aggressive: {
    labelKey: "app.preset.aggressive.label",
    descriptionKey: "app.preset.aggressive.description",
    apply: (cfg) => {
      const groups = defaultRegionalToggles();
      for (const k of Object.keys(groups)) groups[k].enabled = false;
      return { ...cfg,
        pvpMode: "strict",
        protectFavorites: true, protectShinies: true, protectLuckies: true,
        protectLegendaries: true, protectMythicals: true,
        protectUltraBeasts: true, protectShadows: true, protectPurified: true,
        protectCostumes: true, protectBackgrounds: true, protectLegacyMoves: true,
        protectBabies: false,
        protectXXL: false, protectXL: false, protectXXS: false,
        protectDoubleMoved: true, protectDynamax: true, protectNewEvolutions: false,
        protectBuddies: false,
        protectLuckyEligible: true, luckyEligibleYear: 21,
        regionalGroups: groups,
      };
    },
  },
  pvpFocus: {
    labelKey: "app.preset.pvpFocus.label",
    descriptionKey: "app.preset.pvpFocus.description",
    apply: (cfg) => {
      const groups = defaultRegionalToggles();
      groups.alolan.enabled = false;
      groups.galarian.enabled = false;
      groups.hisuian.enabled = false;
      groups.paldean.enabled = false;
      return { ...cfg,
        pvpMode: "loose",
        protectFavorites: true, protectShinies: true, protectLuckies: true,
        protectLegendaries: true, protectMythicals: true,
        protectUltraBeasts: true, protectShadows: true, protectPurified: true,
        protectCostumes: false, protectBackgrounds: false, protectLegacyMoves: true,
        protectBabies: false,
        protectXXL: false, protectXL: false, protectXXS: false,
        protectDoubleMoved: true, protectDynamax: false, protectNewEvolutions: false,
        protectBuddies: false,
        protectLuckyEligible: true, luckyEligibleYear: 21,
        regionalGroups: groups,
      };
    },
  },
};

// Settings that are HIDDEN in normal mode and only show with expert toggle on.
// These are: things most people never want to touch (Ultrabestien, Mysteriös,
// Buddies, Distance/CP/age scope, Liga-Tag custom names, etc).
const EXPERT_ONLY_KEYS = new Set([
  "protectMythicals", "mythTooManyOf",
  "protectUltraBeasts",
  "protectPurified",
  "protectBuddies",
  "protectDynamax",
  "protectLuckyEligible",
  "leagueTags",
  "customProtectedTags",
  "cpCap",
  "ageScopeDays",
  "distanceProtect",
  "luckyEligibleYear",
]);

function ConfigPanel({ config, setConfig, homeLocals = [] }) {
  const { t, outputLocale } = useTranslation();
  // Any individual change in ConfigPanel clears the preset marker — the
  // marker means "this preset is currently in effect"; the moment the
  // user tweaks anything, that's no longer literally true.
  function set(k, v) { setConfig({ ...config, [k]: v, lastAppliedPreset: null }); }
  function setGroup(groupKey, partial) {
    const groups = { ...(config.regionalGroups || {}) };
    groups[groupKey] = { ...groups[groupKey], ...partial };
    set("regionalGroups", groups);
  }
  function applyPreset(presetKey) {
    setConfig({ ...PRESETS[presetKey].apply(config), lastAppliedPreset: presetKey });
  }

  const expert = !!config.expertMode;

  // Universal protections — shown in all modes (these are the "obviously yes" ones)
  // [configKey, translationKeyBase, extra?] — labels & whys resolve via t() at
  // render time. Translation keys live in src/locales/app/{locale}.json.
  // Single ordered list: simple-mode shows non-expert rows; expert mode adds
  // the `{ expertOnly: true }` rows in-place so related toggles stay
  // visually adjacent (e.g. Smeargle carve-out next to Legacy Moves).
  const settings = [
    ["protectFavorites",      "app.protect.favorites"],
    ["protectFourStar",       "app.protect.four_star",      { expertOnly: true, requireConfirmOff: true }],
    ["protectAnyTag",         "app.protect.any_tag"],
    ["protectTradeEvos",      "app.protect.trade_evos"],
    ["protectShinies",        "app.protect.shinies",        { expertOnly: true }],
    ["protectLuckies",        "app.protect.luckies",        { expertOnly: true }],
    ["protectLegendaries",    "app.protect.legendaries"],
    ["protectMythicals",      "app.protect.mythicals",      { expertOnly: true }],
    ["protectUltraBeasts",    "app.protect.ultra_beasts",   { expertOnly: true }],
    ["protectShadows",        "app.protect.shadows",        { expertOnly: true }],
    ["protectPurified",       "app.protect.purified",       { expertOnly: true }],
    ["protectCostumes",       "app.protect.costumes"],
    ["protectBackgrounds",    "app.protect.backgrounds"],
    ["protectLegacyMoves",    "app.protect.legacy_moves",   { expertOnly: true }],
    ["protectSmeargleLegacy", "app.protect.smeargle_legacy", { expertOnly: true }],
    ["protectBabies",         "app.protect.babies"],
    ["protectXXL",            "app.protect.xxl"],
    ["protectXL",             "app.protect.xl"],
    ["protectXXS",            "app.protect.xxs"],
    ["protectNewEvolutions",  "app.protect.new_evolutions", { expertOnly: true }],
    ["protectDoubleMoved",    "app.protect.double_moved",   { expertOnly: true }],
    ["protectDynamax",        "app.protect.dynamax",        { expertOnly: true }],
    ["protectBuddies",        "app.protect.buddies_protect", { expertOnly: true }],
    ["protectLuckyEligible",  "app.protect.lucky_eligible", { expertOnly: true }],
  ];

  return (
    <div className="space-y-6">
      {/* Home-locals banner */}
      {homeLocals.length > 0 && (() => {
        // Find all collector lists across all groups, intersect with homeLocals
        const allCollectors = Object.values(REGIONAL_GROUPS).flatMap(g => g.collectors);
        const autoRemoved = homeLocals.filter(l => allCollectors.includes(l));
        const removedNames = autoRemoved.length > 0 ? autoRemoved.join(", ") : t("app.protect.home_locals.none");
        return (
          <div className="border border-[#27AE60]/40 bg-[#27AE60]/5 rounded p-3 mono text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-[#27AE60]">⌂</span>
              <div className="flex-1">
                <div className="text-[#E6EDF3]">
                  {t("app.protect.home_locals.title_prefix")} <span className="text-[#27AE60]">{removedNames}</span>
                </div>
                <div className="text-[10.5px] text-[#8090A0] mt-1">
                  {t("app.protect.home_locals.note")}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PRESETS */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">{t("app.preset.section_title")}</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(PRESETS).map(([key, preset]) => {
            const active = config.lastAppliedPreset === key;
            return (
              <button key={key}
                onClick={() => applyPreset(key)}
                title={t(preset.descriptionKey)}
                className={`mono text-xs px-3 py-1.5 rounded transition ${
                  active
                    ? "bg-[#5EAFC5] text-[#0F1419]"
                    : "bg-[#1F2933] text-[#E6EDF3] hover:bg-[#5EAFC5] hover:text-[#0F1419]"
                }`}>
                {t(preset.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="mono text-[10.5px] text-[#8090A0] mt-1.5">
          {t("app.preset.section_hint")}
        </div>
      </div>

      <hr className="border-[#1F2933]" />

      {/* PvP MODE */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">{t("app.pvp.section_title")}</div>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["loose",  "app.pvp.loose_label",  "app.pvp.loose_desc"],
            ["strict", "app.pvp.strict_label", "app.pvp.strict_desc"],
            ["none",   "app.pvp.none_label",   "app.pvp.none_desc"],
          ].map(([m, labelKey, descKey]) => (
            <button key={m}
              onClick={() => set("pvpMode", m)}
              title={t(descKey)}
              className={`mono text-xs px-3 py-1.5 rounded transition ${
                config.pvpMode === m
                  ? "bg-[#5EAFC5] text-[#0F1419]"
                  : "bg-[#1F2933] text-[#8B98A5] hover:bg-[#2D3A47]"
              }`}>
              {t(labelKey)}
            </button>
          ))}
        </div>
        <p className="mono text-[11px] text-[#8B98A5] mt-2 leading-snug">
          {t(`app.pvp.help_${config.pvpMode}`)}
        </p>
      </div>

      <hr className="border-[#1F2933]" />

      {/* PROTECTIONS */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
          {t("app.protect.section_title")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
          {settings.map(([k, keyBase, extra]) => {
            if (extra?.expertOnly && !expert) return null;
            const { expertOnly: _eo, ...rowExtra } = extra || {};
            return (
              <ToggleRow key={k} k={k} label={t(`${keyBase}.label`)} why={t(`${keyBase}.why`)}
                expertBadge={!!extra?.expertOnly}
                checked={!!config[k]} onChange={v => set(k, v)} {...rowExtra} />
            );
          })}
        </div>
      </div>

      {/* RAID FILTERS (expert) — narrows per-boss counter filters */}
      {expert && (
        <div>
          <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
            {t("app.raids.section_title")}
          </div>
          <label className="flex items-start gap-2 cursor-pointer mono text-xs">
            <input
              type="checkbox"
              checked={!!config.raidRequireSecondMove}
              onChange={e => set("raidRequireSecondMove", e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <span className="text-[#E6EDF3]">{t("app.protect.raid_require_second_move.label")}</span>
              <p className="text-[#8B98A5] mt-0.5">{t("app.protect.raid_require_second_move.help")}</p>
            </div>
          </label>
        </div>
      )}


      <hr className="border-[#1F2933]" />

      {/* REGIONAL GROUPS */}
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
          {t("app.protect.regional_section_title")}
        </div>
        <div className="space-y-2">
          {Object.entries(REGIONAL_GROUPS).map(([key, group]) =>
            <RegionalGroupEditor
              key={key}
              groupKey={key}
              group={group}
              state={config.regionalGroups?.[key] || { enabled: true, typeChecksEnabled: null, collectorsEnabled: null }}
              setGroup={(partial) => setGroup(key, partial)}
              homeLocals={homeLocals}
            />
          )}
        </div>
      </div>

      <hr className="border-[#1F2933]" />

      {/* BUDDY EVENTS — only shows if buddies are configured */}
      {(config.buddies || []).filter(b => b.active !== false).length > 0 && (
        <>
          <BuddyEventsEditor
            buddies={(config.buddies || []).filter(b => b.active !== false)}
            onUpdateBuddy={(id, partial) => {
              const all = config.buddies || [];
              set("buddies", all.map(b => b.id === id ? { ...b, ...partial } : b));
            }}
          />
          <hr className="border-[#1F2933]" />
        </>
      )}

      {/* CUSTOM COLLECTIBLES */}
      <CustomCollectiblesEditor
        list={config.customCollectibles || []}
        onChange={list => set("customCollectibles", list)}
      />

      {expert && <hr className="border-[#1F2933]" />}

      {/* TRADE-EVO FAMILIES (expert) — fine-tune which families are protected */}
      {expert && (
      <div>
        <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
          {t("app.protect.te_section_title")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(TRADE_EVO_FAMILIES).map(b => {
            const on = (config.enabledTradeEvos || []).includes(b);
            return (
              <button key={b}
                onClick={() => set("enabledTradeEvos",
                  on
                    ? (config.enabledTradeEvos || []).filter(x => x !== b)
                    : [...(config.enabledTradeEvos || []), b])}
                title={t("app.protect.te_button_title", { params: { name: teDisplay(b, outputLocale) } })}
                className={`mono text-xs px-2.5 py-1 rounded transition ${
                  on ? "bg-[#5EAFC5] text-[#0F1419]" : "bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47]"
                }`}>
                +{teDisplay(b, outputLocale)}
              </button>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

function ToggleRow({ k, label, why, checked, onChange, expertBadge, requireConfirmOff }) {
  const { t } = useTranslation();
  // For dangerous toggles (e.g. "always protect 4★"), turning them OFF requires
  // a two-click confirmation. Turning them back ON is unrestricted.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  function handleChange(e) {
    const newValue = e.target.checked;
    if (requireConfirmOff && checked && !newValue) {
      // Trying to turn OFF a dangerous toggle
      if (!armed) {
        setArmed(true);
        // Don't fire change yet — keep checkbox on
        e.preventDefault?.();
        return;
      }
      // Second click within timeout — actually disable
      setArmed(false);
      onChange(false);
      return;
    }
    setArmed(false);
    onChange(newValue);
  }

  return (
    <label
      className={`mono text-xs flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 transition ${
        armed ? "bg-[#E74C3C]/15 border border-[#E74C3C]/40" : "hover:bg-[#141A21] border border-transparent"
      }`}
      title={why}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={handleChange}
        className="accent-[#E74C3C] mt-0.5" />
      <div className="flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[#E6EDF3]">{label}</span>
          {expertBadge && <span className="text-[9px] text-[#F5B82E]">{t("app.protect.expert_badge")}</span>}
          {armed && (
            <span className="text-[10px] text-[#FF6B5B] font-semibold">
              {t("app.protect.confirm_off")}
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#8090A0] leading-tight">{why}</div>
      </div>
    </label>
  );
}


function RegionalGroupEditor({ groupKey, group, state, setGroup, homeLocals = [] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const allTC = group.typeChecks.map(tc => tc.species);
  const allCol = group.collectors;
  const tcEnabled = state.typeChecksEnabled === null ? allTC : state.typeChecksEnabled;
  const colEnabled = state.collectorsEnabled === null ? allCol : state.collectorsEnabled;
  // Home-locals are auto-dropped by effectiveConfig — exclude them from the counter
  // so the displayed "X/Y aktiv" matches the actual filter output.
  const homeSet = new Set(homeLocals);
  const tcEffective = tcEnabled.filter(sp => !homeSet.has(sp));
  const colEffective = colEnabled.filter(sp => !homeSet.has(sp));
  const totalEffective = allTC.filter(sp => !homeSet.has(sp)).length
                       + allCol.filter(sp => !homeSet.has(sp)).length;
  const droppedByHome = (tcEnabled.length + colEnabled.length) - (tcEffective.length + colEffective.length);
  const enabledCount = state.enabled ? (tcEffective.length + colEffective.length) : 0;

  function toggleTC(species) {
    const cur = tcEnabled;
    const next = cur.includes(species) ? cur.filter(s => s !== species) : [...cur, species];
    setGroup({ typeChecksEnabled: next.length === allTC.length ? null : next });
  }
  function toggleCol(species) {
    const cur = colEnabled;
    const next = cur.includes(species) ? cur.filter(s => s !== species) : [...cur, species];
    setGroup({ collectorsEnabled: next.length === allCol.length ? null : next });
  }
  function selectAll() {
    setGroup({ enabled: true, typeChecksEnabled: null, collectorsEnabled: null });
  }
  function selectNone() {
    setGroup({ typeChecksEnabled: [], collectorsEnabled: [] });
  }

  return (
    <div className={`border rounded transition ${state.enabled ? "border-[#2D3A47]" : "border-[#1F2933] opacity-60"}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <input
          type="checkbox"
          checked={!!state.enabled}
          onChange={e => setGroup({ enabled: e.target.checked })}
          className="accent-[#E74C3C]"
        />
        <button onClick={() => setExpanded(x => !x)} className="flex-1 text-left flex items-center gap-2">
          {expanded
            ? <ChevronDown size={12} className="text-[#5EAFC5]" />
            : <ChevronRight size={12} className="text-[#8090A0]" />}
          <span className="mono text-sm text-[#E6EDF3]">{t(group.labelKey)}</span>
          <span className="mono text-[10px] text-[#8090A0]">
            {state.enabled
              ? t("app.regional_editor.active_count", { params: { count: enabledCount, total: totalEffective } })
              : t("app.regional_editor.disabled")}
            {droppedByHome > 0 && state.enabled && (
              <span className="text-[#27AE60] ml-1">
                {t("app.regional_editor.home_extra", { params: { count: droppedByHome } })}
              </span>
            )}
          </span>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[#1F2933]">
          <div className="mono text-[11px] text-[#8090A0] mb-1">{t(group.descriptionKey)}</div>
          <div className="flex gap-2">
            <button onClick={selectAll} className="mono text-[10px] text-[#5EAFC5] hover:text-[#7FCFE5] transition">
              {t("app.regional_editor.select_all")}
            </button>
            <span className="text-[#8090A0]">·</span>
            <button onClick={selectNone} className="mono text-[10px] text-[#8090A0] hover:text-[#E74C3C] transition">
              {t("app.regional_editor.select_none")}
            </button>
          </div>
          {group.typeChecks.length > 0 && (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1">
                {t("app.regional_editor.type_check_label")}
              </div>
              <div className="flex flex-wrap gap-1">
                {group.typeChecks.map(tc => {
                  const on = tcEnabled.includes(tc.species);
                  return (
                    <button key={`${tc.species}_${tc.type}`}
                      onClick={() => toggleTC(tc.species)}
                      title={t(tc.noteKey)}
                      disabled={!state.enabled}
                      className={`mono text-[11px] px-2 py-0.5 rounded transition ${
                        on
                          ? "bg-[#5EAFC5]/20 text-[#5EAFC5] border border-[#5EAFC5]/40"
                          : "bg-[#1F2933] text-[#8090A0] border border-transparent hover:bg-[#2D3A47]"
                      }`}>
                      {tc.species} <span className="opacity-70">/ !{tc.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {group.collectors.length > 0 && (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1">
                {t("app.regional_editor.collectors_label")}
              </div>
              <div className="flex flex-wrap gap-1">
                {group.collectors.map(sp => {
                  const on = colEnabled.includes(sp);
                  const isHomeLocal = homeLocals.includes(sp);
                  // Home-locals are auto-removed by effectiveConfig regardless of `on`,
                  // so render them as "off" visually with a ⌂ marker.
                  const effectivelyOn = on && !isHomeLocal;
                  return (
                    <button key={sp}
                      onClick={() => toggleCol(sp)}
                      disabled={!state.enabled || isHomeLocal}
                      title={isHomeLocal
                        ? t("app.regional_editor.home_local_title")
                        : undefined}
                      className={`mono text-[11px] px-2 py-0.5 rounded transition ${
                        effectivelyOn
                          ? "bg-[#F5B82E]/20 text-[#F5B82E] border border-[#F5B82E]/40"
                          : isHomeLocal
                            ? "bg-[#27AE60]/10 text-[#27AE60] border border-[#27AE60]/30 line-through opacity-60"
                            : "bg-[#1F2933] text-[#8090A0] border border-transparent hover:bg-[#2D3A47]"
                      }`}>
                      {isHomeLocal && <span className="not-italic no-underline mr-0.5">⌂</span>}
                      {sp}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegionalMap({ lastPin, setLastPin, bazaarTags, setBazaarTags, homeLocation, setHomeLocation, homeLocals, tradeTagName = "Trade" }) {
  const { t } = useTranslation();
  const [worldData, setWorldData] = useState(null);
  const [loadStatus, setLoadStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    const urls = [
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
      "https://unpkg.com/world-atlas@2/countries-110m.json",
    ];
    (async () => {
      for (const url of urls) {
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const topo = await r.json();
          const geo = decodeTopo(topo, "countries");
          setWorldData(geo);
          setLoadStatus("ready");
          return;
        } catch {}
      }
      setLoadStatus("error");
    })();
  }, []);

  // d3 equirectangular projection
  const projection = useMemo(
    () =>
      d3.geoEquirectangular()
        .scale(VIEW_W / (2 * Math.PI))
        .translate([VIEW_W / 2, VIEW_H / 2 + 20]),
    []
  );
  const pathGen = useMemo(() => d3.geoPath(projection), [projection]);

  const tropicN = projection([0, 26])[1];
  const tropicS = projection([0, -26])[1];
  const equator = projection([0, 0])[1];
  const meridian = projection([0, 0])[0];

  // SVG ref for click coord conversion
  const svgRef = useRef(null);
  // Hover preview pin — separate from lastPin (the locked one).
  // Updates continuously while mouse moves; cleared when mouse leaves the map.
  const [hoverPin, setHoverPin] = useState(null);

  function clientToLonLat(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return projection.invert([svgPt.x, svgPt.y]);
  }

  function handleMapMove(e) {
    if (loadStatus !== "ready") return;
    const lonLat = clientToLonLat(e.clientX, e.clientY);
    if (lonLat) setHoverPin(lonLat);
  }
  function handleMapLeave() { setHoverPin(null); }
  function handleMapClick(e) {
    if (loadStatus !== "ready") return;
    const lonLat = clientToLonLat(e.clientX, e.clientY);
    if (lonLat) setLastPin(lonLat);
  }

  // Preview matches (hover) + locked matches (lastPin) computed separately
  const previewMatches = useMemo(() => {
    if (!hoverPin) return null;
    const out = [];
    for (const r of POGO_REGIONS) {
      if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") continue;
      if (pointInRegionGeom(hoverPin, r.geometry)) out.push(r);
    }
    return out;
  }, [hoverPin]);

  const matches = useMemo(() => {
    if (!lastPin) return [];
    const out = [];
    for (const r of POGO_REGIONS) {
      if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") continue;
      if (pointInRegionGeom(lastPin, r.geometry)) out.push(r);
    }
    return out;
  }, [lastPin]);

  // Aggregate Pokémon names from matched regions, splitting into:
  //   - "wanted": at this pin but NOT already at home (worth bringing back)
  //   - "alreadyLocal": at this pin AND already at home (no need to tag — friends don't need them)
  const homeLocalsSet = useMemo(() => new Set(homeLocals || []), [homeLocals]);
  const { pokemonWanted, pokemonAlreadyLocal } = useMemo(() => {
    const all = new Set();
    matches.forEach(m => m.german.forEach(n => all.add(n)));
    const wanted = [], alreadyLocal = [];
    for (const n of all) {
      if (homeLocalsSet.has(n)) alreadyLocal.push(n);
      else wanted.push(n);
    }
    return { pokemonWanted: wanted, pokemonAlreadyLocal: alreadyLocal };
  }, [matches, homeLocalsSet]);
  // Combined list — kept for the count-only "n region(s) here" display
  const pokemonAtPin = useMemo(
    () => [...pokemonWanted, ...pokemonAlreadyLocal],
    [pokemonWanted, pokemonAlreadyLocal]
  );

  function addAllToBazaar() {
    // Only add the "wanted" ones — adding locals would just duplicate what
    // friends elsewhere already have access to via me.
    const merged = [...new Set([...bazaarTags, ...pokemonWanted])];
    setBazaarTags(merged);
  }
  // Confirm-state for the "löschen" button — confirm() is blocked in iframe artifacts,
  // so we do a two-click confirmation: first click arms it, second click clears.
  const [bazaarClearArmed, setBazaarClearArmed] = useState(false);
  useEffect(() => {
    if (!bazaarClearArmed) return;
    const t = setTimeout(() => setBazaarClearArmed(false), 3000);
    return () => clearTimeout(t);
  }, [bazaarClearArmed]);

  function addOneToBazaar(name) {
    if (!bazaarTags.includes(name)) setBazaarTags([...bazaarTags, name]);
  }
  function removeFromBazaar(name) {
    setBazaarTags(bazaarTags.filter(n => n !== name));
  }
  function clearBazaar() {
    if (bazaarTags.length === 0) return;
    if (!bazaarClearArmed) {
      setBazaarClearArmed(true);
      return;
    }
    setBazaarTags([]);
    setBazaarClearArmed(false);
  }
  function clearPin() { setLastPin(null); }

  // Pin position in SVG coords for rendering
  const pinXY = lastPin ? projection(lastPin) : null;
  const hoverXY = hoverPin ? projection(hoverPin) : null;

  // Folder color hint for matches (visual grouping only)
  const folderColor = (folder) => {
    if (folder.startsWith("Type 5")) return "#E74C3C";
    if (folder.startsWith("Type 4")) return "#9B59B6";
    if (folder.startsWith("Type 3")) return "#F5B82E";
    if (folder.startsWith("Type 2")) return "#27AE60";
    if (folder.startsWith("Type 1")) return "#5EAFC5";
    return "#8090A0";
  };

  return (
    <div className="space-y-4">
      {/* MAP — clean, no polygon overlays */}
      <div className="border border-[#1F2933] rounded bg-[#0B0F14] overflow-hidden relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-auto block"
          style={{ cursor: loadStatus === "ready" ? "crosshair" : "wait" }}
          onClick={handleMapClick}
          onMouseMove={handleMapMove}
          onMouseLeave={handleMapLeave}>

          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#5EAFC5" strokeWidth="0.3" opacity="0.12" />
            </pattern>
          </defs>
          <rect width={VIEW_W} height={VIEW_H} fill="url(#grid)" />

          <line x1="0" y1={equator} x2={VIEW_W} y2={equator} stroke="#5EAFC5" strokeWidth="0.4" strokeDasharray="2 4" opacity="0.4" />
          <line x1={meridian} y1="0" x2={meridian} y2={VIEW_H} stroke="#5EAFC5" strokeWidth="0.4" strokeDasharray="2 4" opacity="0.4" />
          <line x1="0" y1={tropicN} x2={VIEW_W} y2={tropicN} stroke="#F5B82E" strokeWidth="0.4" strokeDasharray="1 3" opacity="0.3" />
          <line x1="0" y1={tropicS} x2={VIEW_W} y2={tropicS} stroke="#F5B82E" strokeWidth="0.4" strokeDasharray="1 3" opacity="0.3" />

          {/* Countries — neutral fill, no continent grouping */}
          {loadStatus === "ready" && worldData && worldData.features.map((f) => (
            <path
              key={f.id ?? Math.random()}
              d={pathGen(f.geometry)}
              fill="#1F2933"
              stroke="#0B0F14"
              strokeWidth="0.3"
              className="transition-colors"
            />
          ))}

          {/* Home marker */}
          {homeLocation && loadStatus === "ready" && (() => {
            const [hx, hy] = projection(homeLocation);
            return (
              <g pointerEvents="none">
                <circle cx={hx} cy={hy} r="3.5" fill="#27AE60" stroke="#FFFFFF" strokeWidth="1" />
                <circle cx={hx} cy={hy} r="7" fill="none" stroke="#27AE60" strokeWidth="0.4" opacity="0.7" />
              </g>
            );
          })()}

          {/* Hover ghost pin — preview while mouse is over the map */}
          {hoverXY && loadStatus === "ready" && (
            <g pointerEvents="none">
              <circle cx={hoverXY[0]} cy={hoverXY[1]} r="3.5" fill="#E74C3C" opacity="0.5" stroke="#FFFFFF" strokeWidth="0.8" strokeOpacity="0.6" />
            </g>
          )}

          {/* Locked pin — committed via click */}
          {pinXY && loadStatus === "ready" && (
            <g pointerEvents="none">
              <circle cx={pinXY[0]} cy={pinXY[1]} r="14" fill="none" stroke="#E74C3C" strokeWidth="0.6" opacity="0.5">
                <animate attributeName="r" values="6;16;6" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={pinXY[0]} cy={pinXY[1]} r="4.5" fill="#E74C3C" stroke="#FFFFFF" strokeWidth="1.2" />
              <circle cx={pinXY[0]} cy={pinXY[1]} r="1.5" fill="#FFFFFF" />
            </g>
          )}

          {/* Loading / error overlay */}
          {loadStatus !== "ready" && (
            <g>
              <rect width={VIEW_W} height={VIEW_H} fill="#0B0F14" opacity="0.85" />
              <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" className="mono" fontSize="14" fill="#5EAFC5">
                {loadStatus === "loading" ? t("app.map.loading") : t("app.map.load_error")}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Home banner */}
      {homeLocation && (
        <div className="border border-[#27AE60]/40 bg-[#27AE60]/5 rounded p-3 flex items-baseline gap-3 mono text-xs">
          <span className="text-[#27AE60]">⌂</span>
          <div className="flex-1">
            <div className="text-[#E6EDF3]">
              {t("app.map.home_label")} {homeLocation[1].toFixed(2)}°{homeLocation[1] >= 0 ? "N" : "S"}
              , {homeLocation[0].toFixed(2)}°{homeLocation[0] >= 0 ? "E" : "W"}
            </div>
            {homeLocals.length > 0 && (
              <div className="text-[10.5px] text-[#8090A0] mt-1">
                {t("app.map.local_regionals_label", { params: { count: homeLocals.length } })} <span className="text-[#27AE60]">{homeLocals.join(" · ")}</span>
              </div>
            )}
          </div>
          <button onClick={() => setHomeLocation(null)}
            className="text-[#8090A0] hover:text-[#E74C3C] transition">
            {t("app.map.remove_home")}
          </button>
        </div>
      )}

      {/* Hover preview — live, replaces "tap somewhere" hint when hovering */}
      {hoverPin && previewMatches !== null && (
        <div className="border border-[#E74C3C]/30 rounded p-2.5 bg-[#E74C3C]/5">
          <div className="flex items-baseline gap-3 mono text-[11px]">
            <span className="text-[#8090A0]">{t("app.map.preview_label")}</span>
            <span className="text-[#E6EDF3]">
              {hoverPin[1].toFixed(1)}°{hoverPin[1] >= 0 ? "N" : "S"},
              {" "}{hoverPin[0].toFixed(1)}°{hoverPin[0] >= 0 ? "E" : "W"}
            </span>
            <span className="text-[#8090A0] flex-1" />
            <span className="text-[10.5px] text-[#8090A0]">{t("app.map.click_to_pin")}</span>
          </div>
          {previewMatches.length === 0 ? (
            <div className="mono text-[10.5px] text-[#8090A0] mt-1">
              {t("app.map.no_regionals_here")}
            </div>
          ) : (() => {
              const all = [...new Set(previewMatches.flatMap(m => m.german))];
              const wanted = all.filter(n => !homeLocalsSet.has(n));
              const local = all.filter(n => homeLocalsSet.has(n));
              return (
                <div className="mono text-[11px] mt-1.5 leading-relaxed">
                  {wanted.length > 0 && (
                    <span className="text-[#27AE60]">{wanted.join(" · ")}</span>
                  )}
                  {wanted.length > 0 && local.length > 0 && (
                    <span className="text-[#8090A0]"> · </span>
                  )}
                  {local.length > 0 && (
                    <span className="text-[#8090A0]" title={t("app.map.local_already_title")}>
                      {local.join(" · ")}
                    </span>
                  )}
                </div>
              );
            })()}
        </div>
      )}

      {/* Pin info */}
      {!lastPin && !hoverPin && (
        <div className="mono text-xs text-[#8090A0] text-center py-2">
          {homeLocation
            ? t("app.map.hint_with_home")
            : t("app.map.hint_no_home")}
        </div>
      )}

      {lastPin && (
        <div className="space-y-3">
          <div className="flex items-baseline gap-3 mono text-[11px]">
            <span className="text-[#8090A0]">{t("app.map.pin_label")}</span>
            <span className="text-[#E6EDF3]">
              {lastPin[1].toFixed(2)}°{lastPin[1] >= 0 ? "N" : "S"},
              {" "}{lastPin[0].toFixed(2)}°{lastPin[0] >= 0 ? "E" : "W"}
            </span>
            <span className="text-[#8090A0] flex-1" />
            <button
              onClick={() => setHomeLocation([lastPin[0], lastPin[1]])}
              className="mono text-[11px] bg-[#27AE60]/15 hover:bg-[#27AE60]/25 text-[#27AE60] px-2 py-0.5 rounded transition">
              {t("app.map.set_as_home")}
            </button>
            <button onClick={clearPin} className="text-[#8090A0] hover:text-[#E74C3C] transition">
              {t("app.map.clear_pin")}
            </button>
          </div>

          {/* Matched regions */}
          {matches.length === 0 ? (
            <div className="mono text-xs text-[#8090A0] py-2">
              {t("app.map.no_regionals_pin")}
              <span className="text-[#8090A0]/60"> {t("app.map.no_regionals_pin_note")}</span>
            </div>
          ) : (
            <div>
              <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                {matches.length === 1
                  ? t("app.map.region_count_singular", { params: { count: matches.length } })
                  : t("app.map.region_count_plural", { params: { count: matches.length } })}
              </div>
              <div className="space-y-1.5">
                {matches.map((m, i) => (
                  <div key={i} className="flex items-baseline gap-2 mono text-xs">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background: folderColor(m.folder) }} />
                    <div className="flex-1">
                      <div className="text-[#E6EDF3]">{m.german.join(" · ")}</div>
                      <div className="text-[10px] text-[#8090A0]">{m.folder}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add to bazaar — split into "wanted" (green) vs "already at home" (greyed) */}
          {(pokemonWanted.length > 0 || pokemonAlreadyLocal.length > 0) && (
            <div className="space-y-3">
              {pokemonWanted.length > 0 && (
                <div>
                  <div className="mono text-[10.5px] uppercase tracking-wider text-[#27AE60] mb-1.5">
                    {homeLocals.length > 0
                      ? t("app.map.bring_along", { params: { count: pokemonWanted.length } })
                      : t("app.map.found", { params: { count: pokemonWanted.length } })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pokemonWanted.map(name => {
                      const tagged = bazaarTags.includes(name);
                      return (
                        <button key={name}
                          onClick={() => tagged ? removeFromBazaar(name) : addOneToBazaar(name)}
                          className={`mono text-[11px] px-2 py-1 rounded transition ${
                            tagged
                              ? "bg-[#5EAFC5] text-[#0F1419]"
                              : "bg-[#27AE60]/15 text-[#27AE60] border border-[#27AE60]/40 hover:bg-[#27AE60]/25"
                          }`}>
                          {tagged ? "✓ " : "+ "}{name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {pokemonAlreadyLocal.length > 0 && (
                <div>
                  <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1.5">
                    {t("app.map.already_home", { params: { count: pokemonAlreadyLocal.length } })}
                    <span className="text-[#8090A0]/70 normal-case font-normal"> · {t("app.map.already_home_note")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pokemonAlreadyLocal.map(name => {
                      const tagged = bazaarTags.includes(name);
                      return (
                        <button key={name}
                          onClick={() => tagged ? removeFromBazaar(name) : addOneToBazaar(name)}
                          title={t("app.map.already_have_title")}
                          className={`mono text-[11px] px-2 py-1 rounded transition opacity-60 hover:opacity-100 ${
                            tagged
                              ? "bg-[#5EAFC5] text-[#0F1419]"
                              : "bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47] hover:text-[#E6EDF3]"
                          }`}>
                          {tagged ? "✓ " : "+ "}{name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {pokemonWanted.length > 0 && (
                <button onClick={addAllToBazaar}
                  className="mono text-[11px] text-[#27AE60] hover:text-[#5DD380] transition">
                  {t("app.map.add_all_to_bazaar", { params: { tag: tradeTagName } })}
                  {homeLocals.length > 0 && (
                    <span className="text-[#8090A0] ml-1">
                      {t("app.map.add_all_extra", { params: { count: pokemonWanted.length } })}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tradeable accumulator */}
      <div className="border border-[#5EAFC5]/40 rounded p-3 bg-[#5EAFC5]/5">
        <div className="flex items-baseline gap-2 mb-2">
          <div className="mono text-[10.5px] uppercase tracking-wider text-[#5EAFC5] flex-1">
            {t("app.map.bazaar_section_title", { params: { count: bazaarTags.length } })}
          </div>
          {bazaarTags.length > 0 && (
            <button onClick={clearBazaar}
              className={`mono text-[10.5px] transition ${
                bazaarClearArmed
                  ? "text-[#E74C3C] font-semibold"
                  : "text-[#8090A0] hover:text-[#E74C3C]"
              }`}>
              {bazaarClearArmed ? t("app.map.clear_armed") : t("app.map.clear_button")}
            </button>
          )}
        </div>
        {bazaarTags.length === 0 ? (
          <div className="mono text-[11px] text-[#8090A0]">
            {t("app.map.bazaar_empty_help", { params: { tag: `#${tradeTagName}` } })
              .split(`#${tradeTagName}`)
              .flatMap((part, i) => i === 0
                ? [<React.Fragment key={i}>{part}</React.Fragment>]
                : [<code key={`c${i}`} className="text-[#E6EDF3]">{`#${tradeTagName}`}</code>, <React.Fragment key={`p${i}`}>{part}</React.Fragment>])}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {bazaarTags.map(name => (
                <span key={name}
                  className="mono text-[11px] bg-[#5EAFC5]/20 text-[#E6EDF3] pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group">
                  {name}
                  <button onClick={() => removeFromBazaar(name)}
                    className="opacity-50 group-hover:opacity-100 hover:text-[#E74C3C] transition">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mono text-[10.5px] text-[#8090A0] mt-2">
              {t("app.map.bazaar_marked_help", { params: { tag: `#${tradeTagName}` } })
                .split(`#${tradeTagName}`)
                .flatMap((part, i) => i === 0
                  ? [<React.Fragment key={i}>{part}</React.Fragment>]
                  : [<code key={`c${i}`} className="text-[#E6EDF3]">{`#${tradeTagName}`}</code>, <React.Fragment key={`p${i}`}>{part}</React.Fragment>])}
            </div>
          </>
        )}
      </div>

      {/* Attribution */}
      <div className="mono text-[10px] text-[#8090A0] pt-1">
        {t("app.map.attribution")}
      </div>
    </div>
  );
}


function NumField({ label, value, onChange, text, hint }) {
  return (
    <div title={hint}>
      <label className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0]">{label}</label>
      <input type={text ? "text" : "number"} value={value} onChange={e => onChange(e.target.value)}
        className="mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1" />
      {hint && <div className="mono text-[10px] text-[#8090A0] mt-1 leading-tight">{hint}</div>}
    </div>
  );
}

// ─── SETTINGS MODAL ─────────────────────────────────────────────────────────
//
// Holds settings that aren't about "what to protect" but rather "how the tool
// behaves": expert mode, trade tag names, custom tags, league tags, scope
// safety nets, and the dangerous reset. Reachable via gear icon in header.

function SettingsModal({ open, onClose, config, setConfig, onResetAll, resetArmed, onExport, onImport }) {
  const { t, locale, setLocale, outputLocale, setOutputLocale, locales } = useTranslation();
  if (!open) return null;
  function set(k, v) { setConfig({ ...config, [k]: v }); }
  const expert = !!config.expertMode;
  const modeLabel = expert ? t("app.modal.settings.mode_expert") : t("app.modal.settings.mode_normal");
  // Only relevant when the user is in expert mode — otherwise the output
  // locale auto-follows the UI locale and there's no mismatch to surface.
  const localeMismatch = expert && outputLocale !== locale;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("app.modal.settings.title")}
      onClick={onClose}
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      className="fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: "#0F1419" }}
        className="border border-[#2D3A47] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div
          style={{ backgroundColor: "#0F1419" }}
          className="sticky top-0 border-b border-[#1F2933] px-5 py-3 flex items-center justify-between">
          <h2 className="mono text-base font-semibold text-[#E6EDF3]">{t("app.modal.settings.title")}</h2>
          <button
            onClick={onClose}
            aria-label={t("app.modal.settings.close_aria")}
            className="text-[#8090A0] hover:text-[#E6EDF3] transition p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Language */}
          <div>
            <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
              {t("app.modal.language.section_title")}
            </div>
            <div className={`grid gap-3 ${expert ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
              <div>
                <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                  {t("app.modal.language.ui_label")}
                </label>
                <select
                  value={locale}
                  onChange={e => setLocale(e.target.value)}
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]">
                  {Object.entries(locales).map(([code, info]) => (
                    <option key={code} value={code}>{info.label}</option>
                  ))}
                </select>
                <div className="mono text-[10px] text-[#8090A0] mt-1">{t("app.modal.language.ui_help")}</div>
              </div>
              {expert && (
                <div>
                  <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                    {t("app.modal.language.output_label")}
                  </label>
                  <select
                    value={outputLocale}
                    onChange={e => setOutputLocale(e.target.value)}
                    className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]">
                    {Object.entries(locales).map(([code, info]) => (
                      <option key={code} value={code}>{info.label}</option>
                    ))}
                  </select>
                  <div className="mono text-[10px] text-[#8090A0] mt-1">{t("app.modal.language.output_help")}</div>
                </div>
              )}
            </div>
            {localeMismatch && (
              <div className="mono text-[10.5px] text-[#F5B82E] mt-2 leading-relaxed">
                {t("app.modal.language.output_mismatch", { params: { ui: locales[locale]?.label || locale, output: locales[outputLocale]?.label || outputLocale } })}
              </div>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center justify-between border border-[#2D3A47] rounded p-3">
            <div>
              <div className="mono text-sm text-[#E6EDF3]">{t("app.modal.settings.mode_label", { params: { mode: modeLabel } })}</div>
              <div className="mono text-[11px] text-[#8090A0] mt-0.5">
                {expert ? t("app.modal.settings.mode_expert_help") : t("app.modal.settings.mode_normal_help")}
              </div>
            </div>
            <button
              onClick={() => set("expertMode", !expert)}
              className={`mono text-xs px-3 py-1.5 rounded transition ${
                expert ? "bg-[#F5B82E] text-[#0F1419]" : "bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47]"
              }`}>
              {expert ? t("app.modal.settings.mode_to_normal") : t("app.modal.settings.mode_to_expert")}
            </button>
          </div>

          {/* Trade tags */}
          <div>
            <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
              {t("app.modal.tags.section_title")}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                  {t("app.modal.tags.basar_label")}
                </label>
                <input
                  type="text"
                  value={config.basarTagName || ""}
                  onChange={e => set("basarTagName", e.target.value)}
                  placeholder={t("app.modal.tags.basar_placeholder")}
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">
                  {t("app.modal.tags.basar_clause")} <code className="text-[#5EAFC5]">!#{config.basarTagName || "?"}</code>
                </div>
              </div>
              <div>
                <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                  {t("app.modal.tags.fern_label")}
                </label>
                <input
                  type="text"
                  value={config.fernTauschTagName || ""}
                  onChange={e => set("fernTauschTagName", e.target.value)}
                  placeholder={t("app.modal.tags.fern_placeholder")}
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">{t("app.modal.tags.fern_help")}</div>
              </div>
              {expert && (
                <div>
                  <label className="mono text-[10.5px] text-[#8090A0] block mb-1">
                    {t("app.modal.tags.frustration_label")}
                  </label>
                  <input
                    type="text"
                    value={config.removeFrustrationTagName || ""}
                    onChange={e => set("removeFrustrationTagName", e.target.value)}
                    placeholder={t("app.modal.tags.frustration_placeholder")}
                    className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                  <div className="mono text-[10px] text-[#8090A0] mt-1">{t("app.modal.tags.frustration_help")}</div>
                </div>
              )}
            </div>
          </div>

          {expert && (
            <>
              {/* Custom tags */}
              <div>
                <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                  {t("app.modal.custom_tags.section_title")}
                </div>
                <input
                  type="text"
                  value={config.customProtectedTags || ""}
                  onChange={e => set("customProtectedTags", e.target.value)}
                  placeholder={t("app.modal.custom_tags.placeholder")}
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">
                  {t("app.modal.custom_tags.help")}
                </div>
              </div>

              {/* League tags */}
              <div>
                <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                  {t("app.modal.league.section_title")}
                </div>
                <input
                  type="text"
                  value={config.leagueTags || ""}
                  onChange={e => set("leagueTags", e.target.value)}
                  placeholder={t("app.modal.league.placeholder")}
                  className="mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]" />
                <div className="mono text-[10px] text-[#8090A0] mt-1">
                  {t("app.modal.league.help")}
                </div>
              </div>

              {/* Safety nets */}
              <div>
                <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
                  {t("app.modal.safety.section_title")}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <NumField
                    label={t("app.modal.safety.cp_label")}
                    value={config.cpCap}
                    onChange={v => set("cpCap", +v || 0)}
                    hint={t("app.modal.safety.cp_hint")} />
                  <NumField
                    label={t("app.modal.safety.age_label")}
                    value={config.ageScopeDays}
                    onChange={v => set("ageScopeDays", +v || 0)}
                    hint={t("app.modal.safety.age_hint")} />
                  <NumField
                    label={t("app.modal.safety.distance_label")}
                    value={config.distanceProtect}
                    onChange={v => set("distanceProtect", +v || 0)}
                    hint={t("app.modal.safety.distance_hint")} />
                  <NumField
                    label={t("app.modal.safety.lucky_year_label")}
                    value={config.luckyEligibleYear}
                    onChange={v => set("luckyEligibleYear", +v || 0)}
                    hint={t("app.modal.safety.lucky_year_hint")} />
                </div>
              </div>
            </>
          )}

          {/* Trade buddies */}
          <BuddyManager
            buddies={config.buddies || []}
            onChange={list => set("buddies", list)}
          />

          {/* Backup & Restore — JSON file round-trip for cross-device / browser-wipe recovery */}
          <BackupRestoreSection onExport={onExport} onImport={onImport} />

          {/* Danger zone */}
          <div className="pt-4 border-t border-[#1F2933]">
            <div className="mono text-[10.5px] uppercase tracking-wider text-[#FF6B5B] mb-2">
              {t("app.modal.danger.section_title")}
            </div>
            <button
              onClick={onResetAll}
              className={`mono text-xs px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
                resetArmed
                  ? "bg-[#E74C3C] text-white"
                  : "bg-[#1F2933] text-[#FF6B5B] hover:bg-[#2D3A47]"
              }`}>
              <RotateCcw size={11} />
              {resetArmed ? t("app.modal.danger.reset_armed") : t("app.modal.danger.reset_button")}
            </button>
            <div className="mono text-[10px] text-[#8090A0] mt-1.5">
              {t("app.modal.danger.reset_help")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BACKUP & RESTORE ───────────────────────────────────────────────────────

// Settings-modal section that lets users dump current state to a JSON file
// and restore from one. The restore flow is a two-step armed confirm —
// matches the "danger zone" pattern so users don't accidentally clobber
// their hundo list. Errors render inline (no toast inside modal).
function BackupRestoreSection({ onExport, onImport }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const [pending, setPending] = useState(null); // { envelope, summary }
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");
  const [exportedNote, setExportedNote] = useState("");

  function handleExportClick() {
    const filename = onExport();
    setExportedNote(t("app.modal.backup.export_done", { params: { filename } }));
    setTimeout(() => setExportedNote(""), 4000);
  }

  function summarize(env) {
    const d = env.data || {};
    return {
      hundos: Array.isArray(d.hundos) ? d.hundos.length : 0,
      topAttackers: Array.isArray(d.topAttackers) ? d.topAttackers.length : 0,
      topMaxAttackers: Array.isArray(d.topMaxAttackers) ? d.topMaxAttackers.length : 0,
      configFields: d.config && typeof d.config === "object" ? Object.keys(d.config).length : 0,
      hasHome: Array.isArray(d.homeLocation) && d.homeLocation.length === 2,
      bazaarTags: Array.isArray(d.bazaarTags) ? d.bazaarTags.length : 0,
    };
  }

  async function handleFilePick(e) {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    // Reset so picking the same file again still triggers onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function loadFile(file) {
    setError("");
    setPending(null);
    setArmed(false);
    let text;
    try {
      text = await file.text();
    } catch {
      setError(t("app.modal.backup.import_error_invalid_json"));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError(t("app.modal.backup.import_error_invalid_json"));
      return;
    }
    const result = validateImportEnvelope(parsed);
    if (!result.ok) {
      const { code, params } = result.error;
      setError(t(`app.modal.backup.import_error_${code}`, params ? { params } : undefined));
      return;
    }
    const { envelope } = result;
    setPending({ envelope, summary: summarize(envelope), exportedAt: envelope.exportedAt || null });
  }

  function applyPending() {
    if (!pending) return;
    if (!armed) { setArmed(true); return; }
    onImport(pending.envelope);
    setPending(null);
    setArmed(false);
    setError("");
  }

  function cancelPending() {
    setPending(null);
    setArmed(false);
    setError("");
  }

  const summaryParts = pending ? [
    t("app.modal.backup.summary_hundos", { params: { count: pending.summary.hundos } }),
    t("app.modal.backup.summary_attackers", { params: { count: pending.summary.topAttackers + pending.summary.topMaxAttackers } }),
    t("app.modal.backup.summary_config", { params: { count: pending.summary.configFields } }),
    pending.summary.hasHome ? t("app.modal.backup.summary_home") : null,
    pending.summary.bazaarTags > 0 ? t("app.modal.backup.summary_tags", { params: { count: pending.summary.bazaarTags } }) : null,
  ].filter(Boolean).join(" · ") : "";

  return (
    <div className="pt-4 border-t border-[#1F2933]">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
        {t("app.modal.backup.section_title")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleExportClick}
          className="mono text-xs bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47] px-3 py-1.5 rounded transition flex items-center gap-1.5">
          <Download size={11} />
          {t("app.modal.backup.export_button")}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mono text-xs bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47] px-3 py-1.5 rounded transition flex items-center gap-1.5">
          <Upload size={11} />
          {t("app.modal.backup.import_button")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFilePick}
          className="hidden"
        />
      </div>
      <div className="mono text-[10px] text-[#8090A0] mt-1.5">
        {t("app.modal.backup.help")}
      </div>
      {exportedNote && (
        <div className="mono text-[10.5px] text-[#5EAFC5] mt-2">{exportedNote}</div>
      )}
      {error && (
        <div className="mono text-[10.5px] text-[#FF6B5B] mt-2">{error}</div>
      )}
      {pending && (
        <div className="mt-3 border border-[#2D3A47] rounded p-3 space-y-2 bg-[#0E141A]">
          <div className="mono text-[11px] text-[#E6EDF3]">
            {pending.exportedAt
              ? t("app.modal.backup.import_preview_dated", { params: { date: pending.exportedAt.slice(0, 10) } })
              : t("app.modal.backup.import_preview_undated")}
          </div>
          <div className="mono text-[10.5px] text-[#8090A0]">{summaryParts}</div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={applyPending}
              className={`mono text-xs px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
                armed ? "bg-[#E74C3C] text-white" : "bg-[#1F2933] text-[#FF6B5B] hover:bg-[#2D3A47]"
              }`}>
              {armed ? t("app.modal.backup.import_armed") : t("app.modal.backup.import_apply")}
            </button>
            <button
              onClick={cancelPending}
              className="mono text-xs bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47] px-3 py-1.5 rounded transition">
              {t("app.modal.backup.import_cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BUDDY MANAGER ──────────────────────────────────────────────────────────

function BuddyManager({ buddies, onChange }) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");

  function addBuddy() {
    const name = newName.trim();
    if (!name) return;
    // Generate a default tag prefix from the name (alpha chars, capitalized)
    const tagPrefix = name.replace(/[^a-zA-ZäöüÄÖÜß0-9]/g, "");
    if (!tagPrefix) return;
    const id = tagPrefix.toLowerCase() + "-" + Date.now().toString(36);
    onChange([
      ...buddies,
      { id, name, tagPrefix, targetSpecies: [], wantsTradeEvos: false, active: true },
    ]);
    setNewName("");
  }
  function update(id, partial) {
    onChange(buddies.map(b => b.id === id ? { ...b, ...partial } : b));
  }
  function remove(id) {
    onChange(buddies.filter(b => b.id !== id));
  }

  return (
    <div className="pt-4 border-t border-[#1F2933]">
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2">
        {t("app.buddy.section_title")}
      </div>
      <p className="mono text-[11px] text-[#8090A0] mb-3 leading-relaxed">
        {t("app.buddy.section_help", { params: { tag1: "#Auri:hat-pika", tag2: "#Auri:meltan" } })
          .split(/(#Auri:[a-zA-Z0-9-]+)/)
          .map((part, i) => /^#Auri:/.test(part)
            ? <code key={i} className="text-[#E6EDF3]">{part}</code>
            : <React.Fragment key={i}>{part}</React.Fragment>
          )}
      </p>

      {buddies.length > 0 && (
        <div className="space-y-2 mb-3">
          {buddies.map(b => (
            <div key={b.id} className="border border-[#2D3A47] rounded p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={b.active !== false}
                  onChange={e => update(b.id, { active: e.target.checked })}
                  className="accent-[#E67E22]"
                  title={b.active !== false ? t("app.buddy.active_title") : t("app.buddy.inactive_title")} />
                <input
                  type="text"
                  value={b.name}
                  onChange={e => update(b.id, { name: e.target.value })}
                  placeholder={t("app.buddy.name_placeholder")}
                  className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3]" />
                <span className="mono text-[11px] text-[#8090A0]">#</span>
                <input
                  type="text"
                  value={b.tagPrefix}
                  onChange={e => update(b.id, { tagPrefix: e.target.value })}
                  placeholder={t("app.buddy.prefix_placeholder")}
                  className="mono text-sm w-32 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3]" />
                <button
                  onClick={() => remove(b.id)}
                  className="text-[#8090A0] hover:text-[#FF6B5B] transition p-1"
                  title={t("app.buddy.delete_title")}>
                  <X size={14} />
                </button>
              </div>
              <div className="mono text-[10px] text-[#8090A0]">
                {t("app.buddy.clause_label")} <code className="text-[#E67E22]">!#{b.tagPrefix}</code>
                {" "}{t("app.buddy.clause_match", { params: { a: `#${b.tagPrefix}`, b: `#${b.tagPrefix}:event1` } })
                  .split(/(#[A-Za-zäöüÄÖÜß0-9:-]+)/)
                  .map((part, i) => /^#[A-Za-zäöüÄÖÜß0-9]/.test(part)
                    ? <code key={i} className="text-[#E6EDF3]">{part}</code>
                    : <React.Fragment key={i}>{part}</React.Fragment>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addBuddy()}
          placeholder={t("app.buddy.add_placeholder")}
          className="mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-1.5 rounded text-[#E6EDF3]" />
        <button
          onClick={addBuddy}
          disabled={!newName.trim()}
          className="mono text-sm bg-[#E67E22] hover:bg-[#FF9544] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-3 py-1.5 rounded transition flex items-center gap-1.5">
          <Plus size={14} /> {t("app.buddy.add_button")}
        </button>
      </div>
    </div>
  );
}

// ─── BUDDY EVENTS EDITOR (in Step 2) ───────────────────────────────────────

function BuddyEventsEditor({ buddies, onUpdateBuddy }) {
  const { t } = useTranslation();
  const filterName = t("app.buddy_events.section_help_filter_name");
  return (
    <div>
      <div className="mono text-[10.5px] uppercase tracking-wider text-[#E67E22] mb-2">
        {t("app.buddy_events.section_title")}
      </div>
      <p className="mono text-xs text-[#8090A0] mb-3 leading-relaxed">
        {t("app.buddy_events.section_help", { params: { filter_name: filterName } })
          .split(filterName)
          .flatMap((part, i) => i === 0
            ? [<React.Fragment key={i}>{part}</React.Fragment>]
            : [<span key={`f${i}`} className="text-[#E67E22]">{filterName}</span>, <React.Fragment key={`p${i}`}>{part}</React.Fragment>]
          )}
      </p>

      <div className="space-y-2">
        {buddies.map(b => (
          <BuddyTargetsRow
            key={b.id}
            buddy={b}
            onChange={partial => onUpdateBuddy(b.id, partial)}
          />
        ))}
      </div>
    </div>
  );
}

function BuddyTargetsRow({ buddy, onChange }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const targets = buddy.targetSpecies || [];

  const previewTokens = useMemo(() => {
    return input.split(/[,;\s]+/).filter(Boolean).map(tok => ({
      input: tok,
      info: resolveSpeciesInfo(tok),
    }));
  }, [input]);
  const resolved = previewTokens.filter(p => p.info);
  const newResolved = resolved.filter(p => !targets.includes(p.info.names.de.toLowerCase()));
  const dupes = resolved.filter(p => targets.includes(p.info.names.de.toLowerCase()));
  const unresolved = previewTokens.filter(p => !p.info);

  function addAll() {
    const tokens = input.split(/[,;\s]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const set = new Set(targets);
    const remaining = [];
    for (const tok of tokens) {
      const r = resolveSpecies(tok);
      if (r) set.add(r);
      else remaining.push(tok);
    }
    onChange({ targetSpecies: [...set].sort() });
    setInput(remaining.join(", "));
  }
  function remove(name) {
    onChange({ targetSpecies: targets.filter(n => n !== name) });
  }

  return (
    <div className="border border-[#E67E22]/20 rounded p-2.5 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="mono text-sm text-[#E6EDF3] font-semibold">{buddy.name}</span>
        <span className="mono text-[10.5px] text-[#8090A0]">
          {t("app.buddy_targets.prefix_label")} <code className="text-[#E67E22]">#{buddy.tagPrefix}</code>
        </span>
        <span className="mono text-[10.5px] text-[#8090A0] ml-auto">
          {t("app.buddy_targets.count_label", { params: { count: targets.length } })}
        </span>
      </div>

      <label className="mono text-[11px] flex items-center gap-2 cursor-pointer text-[#E6EDF3] hover:bg-[#E67E22]/5 rounded px-1 py-0.5 transition w-fit"
        title={t("app.buddy_targets.te_toggle_title")}>
        <input
          type="checkbox"
          checked={!!buddy.wantsTradeEvos}
          onChange={e => onChange({ wantsTradeEvos: e.target.checked })}
          className="accent-[#E67E22]" />
        <span>{t("app.buddy_targets.te_toggle_label")}</span>
        <span className="text-[10px] text-[#8090A0]">{t("app.buddy_targets.te_toggle_examples")}</span>
      </label>

      {targets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {targets.map(sp => (
            <span key={sp}
              className="chip-enter mono text-[11px] bg-[#E67E22]/15 text-[#E67E22] border border-[#E67E22]/40 pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group">
              {sp}
              <button onClick={() => remove(sp)}
                className="opacity-50 group-hover:opacity-100 hover:text-[#FF6B5B] transition">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAll()}
          placeholder={t("app.buddy_targets.input_placeholder")}
          className="mono text-xs flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3] placeholder:text-[#8090A0]" />
        <button
          onClick={addAll}
          disabled={previewTokens.length === 0 || newResolved.length === 0}
          className="mono text-xs bg-[#E67E22]/20 hover:bg-[#E67E22]/30 disabled:bg-[#1F2933] disabled:text-[#8090A0] text-[#E67E22] px-2.5 py-1 rounded transition flex items-center gap-1">
          <Plus size={11} /> {t("app.buddy_targets.add_button")}
        </button>
      </div>

      {previewTokens.length > 0 && (
        <div className="border border-[#1F2933] rounded p-2 bg-[#0B0F14] space-y-1.5">
          <div className="mono text-[10px] uppercase tracking-wider text-[#8090A0]">
            {t("app.buddy_targets.preview_summary", { params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length } })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewTokens.map((tok, i) => {
              if (!tok.info) return (
                <span key={i} className="mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded">
                  ✗ {tok.input}
                </span>
              );
              const isDupe = targets.includes(tok.info.names.de.toLowerCase());
              const labelByType = { number: "#", en: "EN", de: "DE", es: "ES", fr: "FR", "zh-TW": "ZH", hi: "HI", ja: "JA" };
              return (
                <span key={i}
                  className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
                    isDupe ? "bg-[#5C6975]/15 text-[#8090A0]" : "bg-[#E67E22]/15 text-[#E67E22]"
                  }`}>
                  <span className="text-[9px] opacity-60">{labelByType[tok.info.inputLocale]}</span>
                  {tok.info.names.de}
                  {isDupe && <span className="opacity-60">✓</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
