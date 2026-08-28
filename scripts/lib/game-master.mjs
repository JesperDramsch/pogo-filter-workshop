// Shared access to the Niantic game master, and the parsers every fetcher
// that reads it needs.
//
// Why this file exists: four fetchers used to read pogoapi.net for species
// facts (types, stats, evolutions, rarity, generations, release status).
// pogoapi stopped publishing in November 2025 and carries no freshness signal
// of its own — no batch id, no fetchedAt, only an HTTP Last-Modified nobody
// was reading — so a nine-month-old dataset kept passing every reachability
// check while silently missing seventeen released species. The game master
// publishes the same facts first-hand and stamps every batch, so a stall here
// is visible. See docs/upstream-sources.md.
//
// Everything below is deliberately shape-tolerant. The mirrors publish the
// same Niantic template array but wrap it differently across generations of
// the dump ({ template: [...] } / { templates: [...] } / { itemTemplate:
// [...] } / a bare array), and a template node may or may not be nested under
// `data`. Normalizing once here is what lets each caller's parser be three
// lines of intent instead of three lines of defensive unwrapping.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Game-master mirrors, in preference order. Each publishes the same Niantic
// template array; they differ only in how current the dump is, so the first
// one that answers wins and the rest are pure fallback.
export const GAME_MASTER_MIRRORS = [
  {
    // Primary. Commits every one to three days — 57 times in the three months
    // before this was written — and carries the live post-Season-27 move values.
    // It is also, transitively, where DialgaDex's numbers come from: its
    // resource repo (mgrann03/pokemon-resources) regenerates from this file.
    name: "alexelgt/game_masters",
    gameMaster: "https://raw.githubusercontent.com/alexelgt/game_masters/refs/heads/master/GAME_MASTER.json",
    // {"batchId":"1787902550208","uploadTime":"..."} — ms since epoch, as a string.
    timestamp: "https://raw.githubusercontent.com/alexelgt/game_masters/refs/heads/master/timestamp.json",
    parseStamp: (text) => Number(JSON.parse(text).batchId),
  },
  {
    // Fallback. The better-known mirror, and the one every guide points at, but
    // it stalls: it served a 2026-04-17 batch for at least 133 days, still
    // carrying pre-Season-27 values for every move that rebalance touched.
    // Kept because a second source costs one request and a stalled mirror is
    // still better than no mechanics at all.
    name: "PokeMiners/game_masters",
    gameMaster: "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json",
    timestamp: "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/timestamp.txt",
    parseStamp: (text) => Number(text.trim()),
  },
];

// PvPoke's game master. The only source in the tree with a per-species
// `released` flag that tracks the live game rather than the presence of model
// data in a dump. fetch-pvp-rankings.mjs and fetch-game-master-watch.mjs
// already read it, so it adds no new upstream to the project.
export const PVPOKE_GAME_MASTER_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json";

// How stale the winning mirror may get before a sync says so out loud. Not a
// hard failure — stale data still beats none — but never silent.
export const GAME_MASTER_STALE_WARN_DAYS = 30;

// The game master is ~19 MB and ~19 000 templates. A mirror that answers with
// materially less than that answered with something that is not a game master.
const MIN_TEMPLATES = 5000;

async function fetchText(url, userAgent) {
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// ── Batch-stamped local cache ───────────────────────────────────────────────
//
// The game master is ~19 MB and five fetchers now read it. `npm run prebuild`
// runs them back to back, so without a cache one build pulls ~95 MB of the
// same bytes. The cache key is the mirror's own batch stamp, not a clock: the
// tiny timestamp endpoint is fetched every time and the big file is downloaded
// only when the batch id actually moved. That makes the cache
// correctness-preserving rather than a staleness window — a new batch is never
// served from cache, and an unreadable stamp falls through to a fresh
// download. Cache failures are non-fatal: they cost the download, nothing else.
const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../.cache/game-master");
const cacheFile = (name) => resolve(CACHE_DIR, `${name.replace(/[^a-z0-9]+/gi, "-")}.json`);

function readCache(name, batchMs) {
  if (batchMs == null) return null;
  try {
    const cached = JSON.parse(readFileSync(cacheFile(name), "utf8"));
    if (cached?.batchMs !== batchMs || !Array.isArray(cached.templates)) return null;
    return cached.templates;
  } catch {
    return null;
  }
}

function writeCache(name, batchMs, templates) {
  if (batchMs == null) return;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile(name), JSON.stringify({ batchMs, templates }), "utf8");
  } catch { /* a cache that cannot be written just costs the next download */ }
}

// Fetch the game master from the first mirror that answers with something
// parsable. Returns { templates, batchMs, mirrorName, ageDays, fromCache } —
// ageDays is null when the mirror's stamp was unreadable, which costs the
// staleness warning and the batch cache, and nothing else.
//
// A mirror that returns something unparsable counts as a failure, not as an
// empty result: publishing a hole is the one outcome worse than falling back.
export async function fetchGameMaster({
  userAgent = "pogo-filter-workshop game-master-fetcher/1.0",
  minTemplates = MIN_TEMPLATES,
  staleWarnDays = GAME_MASTER_STALE_WARN_DAYS,
  label = "game master",
} = {}) {
  const failures = [];
  for (const mirror of GAME_MASTER_MIRRORS) {
    let templates, batchMs = null, fromCache = false;
    try {
      const stampText = await fetchText(mirror.timestamp, userAgent).catch(() => "");
      try {
        const ms = mirror.parseStamp(stampText);
        if (Number.isFinite(ms) && ms > 0) batchMs = ms;
      } catch { /* an unreadable stamp costs the staleness warning and the cache */ }

      const cached = readCache(mirror.name, batchMs);
      if (cached && cached.length >= minTemplates) {
        templates = cached;
        fromCache = true;
      } else {
        const parsed = templateList(JSON.parse(await fetchText(mirror.gameMaster, userAgent)));
        if (parsed.length < minTemplates) {
          throw new Error(`parsed as ${parsed.length} templates (expected ≥ ${minTemplates})`);
        }
        templates = parsed;
        writeCache(mirror.name, batchMs, parsed);
      }
    } catch (err) {
      failures.push(`${mirror.name}: ${err.message}`);
      continue;
    }
    if (failures.length > 0) {
      console.warn(`⚠  fell back to ${mirror.name} after ${failures.join("; ")}`);
    }
    const ageDays = batchMs != null ? Math.floor((Date.now() - batchMs) / 86400000) : null;
    if (ageDays != null && ageDays > staleWarnDays) {
      console.warn(`⚠  ${mirror.name} batch is ${ageDays} days old ` +
        `(${new Date(batchMs).toISOString().slice(0, 10)}) — ${label} may predate a game update. ` +
        `See scripts/fetch-game-master-watch.mjs.`);
    }
    return { templates, batchMs, mirrorName: mirror.name, ageDays, fromCache };
  }
  throw new Error(`all game-master mirrors failed — ${failures.join("; ")}`);
}

// PvPoke's game master, parsed. Returns null on failure rather than throwing:
// every caller uses it as an overlay on top of the Niantic dump, so an outage
// should degrade the release gate, not fail the sync.
export async function fetchPvpokeGameMaster({
  userAgent = "pogo-filter-workshop game-master-fetcher/1.0",
} = {}) {
  try {
    return JSON.parse(await fetchText(PVPOKE_GAME_MASTER_URL, userAgent));
  } catch (e) {
    console.warn(`⚠  PvPoke game master unavailable (${e.message})`);
    return null;
  }
}

// Dex numbers PvPoke marks released. This is the replacement for pogoapi's
// released_pokemon.json, which was missing 17 live species when it was
// measured. Returns an empty set for a missing or unparsable payload — callers
// must treat an empty set as "no release information", never as "nothing is
// released".
export function releasedDexFromPvpoke(gamemaster) {
  const dex = new Set();
  for (const p of gamemaster?.pokemon || []) {
    if (Number.isInteger(p?.dex) && p.released) dex.add(p.dex);
  }
  return dex;
}

// ── Template normalization ──────────────────────────────────────────────────

// Every game-master payload shape collapses to one array here.
export function templateList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.template || payload?.templates || payload?.itemTemplate || [];
}

// The node carrying templateId/pokemonSettings, whether or not it is nested.
export function templateNode(entry) {
  return entry?.data || entry || null;
}

// Species dex out of a template id ("V0052_POKEMON_MEOWTH_ALOLA" → 52).
// Prefixed variants (EXTENDED_, SPAWN_, FORMS_, EVOLUTION_) are a different
// template family and deliberately do NOT match: their payloads carry
// different fields, and a caller that wants them should say so.
export function dexFromTemplateId(templateId) {
  const m = /^V(\d+)_POKEMON_/.exec(templateId || "");
  return m ? parseInt(m[1], 10) : null;
}

// Every `V####_POKEMON_*` template with a pokemonSettings payload, as
// { dex, templateId, form, settings }. `form` is the raw form enum
// ("MEOWTH_ALOLA") or null; use formSuffix() for the part that names the form.
export function pokemonTemplates(templates) {
  const out = [];
  for (const entry of templateList(templates)) {
    const node = templateNode(entry);
    const settings = node?.pokemonSettings;
    if (!settings) continue;
    const templateId = node?.templateId || entry?.templateId || "";
    const dex = dexFromTemplateId(templateId);
    if (dex == null) continue;
    out.push({
      dex,
      templateId,
      form: typeof settings.form === "string" ? settings.form : null,
      settings,
    });
  }
  return out;
}

// The form-naming tail of a form enum: MEOWTH_ALOLA → "ALOLA",
// TAUROS_PALDEA_COMBAT → "PALDEA_COMBAT", a base form → "NORMAL", and a
// species with no form template at all → null.
export function formSuffix({ form, settings }) {
  if (!form) return null;
  const id = settings?.pokemonId;
  if (id && form.startsWith(`${id}_`)) return form.slice(id.length + 1);
  return form === id ? "NORMAL" : form;
}

// "POKEMON_TYPE_DARK" → "dark". Returns null for anything that isn't a type.
export function typeSlug(value) {
  if (typeof value !== "string") return null;
  const m = /^POKEMON_TYPE_(.+)$/.exec(value);
  return m ? m[1].toLowerCase() : null;
}

// A form's types, in slot order, lowercased. Always 1 or 2 entries for a real
// species template.
export function typesOf(settings) {
  return [typeSlug(settings?.type), typeSlug(settings?.type2)].filter(Boolean);
}

// ── Species-level parsers ───────────────────────────────────────────────────

// pokemonId enum name → dex, from every pokemonSettings template. Evolution
// branches name their target by enum, so resolving them needs this first.
// Lowest dex wins where an enum somehow appears twice — deterministic output
// beats feed ordering.
export function dexByPokemonId(templates) {
  const map = new Map();
  for (const { dex, settings } of pokemonTemplates(templates)) {
    const id = settings?.pokemonId;
    if (!id) continue;
    if (!map.has(id) || dex < map.get(id)) map.set(id, dex);
  }
  return map;
}

// Every evolution step in the game master, at FORM granularity, as
// { parentDex, parentForm, childDex, childForm, candyCost, itemRequired,
//   lureRequired }.
//
// Replaces pogoapi's pokemon_evolutions.json for both consumers (chain candy
// costs and child→parent links). Notes:
//
//   - Form granularity is load-bearing, not decoration. Collapsing a step onto
//     its dex pair merges paths that do not exist in the game: Zigzagoon's
//     Galarian form evolves for 25 candy and only that form goes on to
//     Obstagoon for 100, while the Kanto form costs 50 and stops at Linoone.
//     Keeping the cheapest of the two would drop Antique Sinistea's 400-candy
//     jump; keeping the dearest would invent a 150-candy Zigzagoon line that
//     no player can walk. Keeping both, as separate nodes, is the only answer
//     that is true for every form.
//
//   - A form node is the template's `form` enum ("ZIGZAGOON_GALARIAN"), or the
//     bare `pokemonId` for the species-level template that carries no form.
//     Branch targets name their form the same way, so a chain walk over these
//     nodes follows the paths the game actually offers.
//
//   - Mega/Primal branches carry `temporaryEvolution` instead of a target
//     species and are not evolution steps in the line-walking sense.
//
//   - Same-dex form changes never appear: a step is emitted only when parent
//     and child dex differ, which is what "walk this species down to its base"
//     asks about.
export function evolutionStepsFromGameMaster(templates) {
  const dexById = dexByPokemonId(templates);
  const steps = new Map(); // `${parentForm}>${childForm}` → step
  for (const { dex: parentDex, form, settings } of pokemonTemplates(templates)) {
    if (!Array.isArray(settings?.evolutionBranch)) continue;
    const parentForm = form || settings.pokemonId;
    if (!parentForm) continue;
    for (const branch of settings.evolutionBranch) {
      if (!branch?.evolution) continue;
      const childDex = dexById.get(branch.evolution);
      if (!childDex || childDex === parentDex) continue;
      const childForm = (typeof branch.form === "string" && branch.form) || branch.evolution;
      const key = `${parentForm}>${childForm}`;
      const candyCost = Number.isFinite(branch.candyCost) ? branch.candyCost : 0;
      // pogoapi called these item_required / lure_required. Time-of-day,
      // buddy-walk, gender and upside-down conditions are deliberately not
      // flags here — the EvoSwap feature that consumes them is scoped to
      // candy and items only.
      const itemRequired = Boolean(branch.evolutionItemRequirement);
      const lureRequired = Boolean(branch.lureItemRequirement);
      const prev = steps.get(key);
      if (prev) {
        if (candyCost > prev.candyCost) prev.candyCost = candyCost;
        prev.itemRequired ||= itemRequired;
        prev.lureRequired ||= lureRequired;
      } else {
        steps.set(key, {
          parentDex, parentForm, childDex, childForm,
          candyCost, itemRequired, lureRequired,
        });
      }
    }
  }
  return [...steps.values()].sort(
    (a, b) => a.parentDex - b.parentDex || a.childDex - b.childDex ||
      a.parentForm.localeCompare(b.parentForm) || a.childForm.localeCompare(b.childForm),
  );
}

// Walk the form-level evolution graph and report, per BASE dex, what the whole
// line costs. Returns Map(baseDex → { maxCumulativeCandy, maxSingleCandy,
// maxStages, itemGated, finalDex:Set }).
//
// A base is a dex that appears as a parent and never as a child. The walk
// explores every form node of that base independently, so a per-form branch
// that dead-ends does not truncate a sibling path (the bug the pogoapi
// name-keyed walk carried: one shared visited-set across sibling branches made
// the second path stop at the first shared node).
export function evolutionChainsFromSteps(steps) {
  const outgoing = new Map();   // parentForm → step[]
  const nodesByDex = new Map(); // dex → Set(form node)
  const childDexes = new Set();
  const parentDexes = new Set();
  const addNode = (dex, node) => {
    if (!nodesByDex.has(dex)) nodesByDex.set(dex, new Set());
    nodesByDex.get(dex).add(node);
  };
  for (const step of steps) {
    if (!outgoing.has(step.parentForm)) outgoing.set(step.parentForm, []);
    outgoing.get(step.parentForm).push(step);
    addNode(step.parentDex, step.parentForm);
    addNode(step.childDex, step.childForm);
    parentDexes.add(step.parentDex);
    childDexes.add(step.childDex);
  }

  // Depth-first from one form node. `visited` is per-path, so a diamond in the
  // graph costs a revisit rather than a truncated sibling.
  function walk(node, dex, candySoFar, stages, visited) {
    const result = {
      maxCumulativeCandy: candySoFar,
      maxSingleCandy: 0,
      maxStages: stages,
      itemGated: false,
      finalDex: new Set(),
    };
    const next = outgoing.get(node) || [];
    if (next.length === 0 || visited.has(node)) {
      result.finalDex.add(dex);
      return result;
    }
    const seen = new Set(visited).add(node);
    for (const step of next) {
      if (step.candyCost > result.maxSingleCandy) result.maxSingleCandy = step.candyCost;
      if (step.itemRequired || step.lureRequired) result.itemGated = true;
      const sub = walk(step.childForm, step.childDex, candySoFar + step.candyCost, stages + 1, seen);
      if (sub.maxCumulativeCandy > result.maxCumulativeCandy) result.maxCumulativeCandy = sub.maxCumulativeCandy;
      if (sub.maxSingleCandy > result.maxSingleCandy) result.maxSingleCandy = sub.maxSingleCandy;
      if (sub.maxStages > result.maxStages) result.maxStages = sub.maxStages;
      if (sub.itemGated) result.itemGated = true;
      for (const d of sub.finalDex) result.finalDex.add(d);
    }
    return result;
  }

  const chains = new Map();
  for (const dex of parentDexes) {
    if (childDexes.has(dex)) continue; // not a base
    const merged = {
      maxCumulativeCandy: 0, maxSingleCandy: 0, maxStages: 1,
      itemGated: false, finalDex: new Set(),
    };
    for (const node of nodesByDex.get(dex) || []) {
      const r = walk(node, dex, 0, 1, new Set());
      if (r.maxCumulativeCandy > merged.maxCumulativeCandy) merged.maxCumulativeCandy = r.maxCumulativeCandy;
      if (r.maxSingleCandy > merged.maxSingleCandy) merged.maxSingleCandy = r.maxSingleCandy;
      if (r.maxStages > merged.maxStages) merged.maxStages = r.maxStages;
      if (r.itemGated) merged.itemGated = true;
      for (const d of r.finalDex) merged.finalDex.add(d);
    }
    chains.set(dex, merged);
  }
  return chains;
}

// child dex → parent dex, for walking any species down to the base of its
// line. Where two parents ever claim one child the lowest parent dex wins —
// deterministic output beats feed ordering.
export function evoParentsFromSteps(steps) {
  const parents = new Map();
  for (const { parentDex, childDex } of steps) {
    const prev = parents.get(childDex);
    if (prev === undefined || parentDex < prev) parents.set(childDex, parentDex);
  }
  return parents;
}
