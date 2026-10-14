// The Niantic game-master mirrors, the one fetch that prefers the freshest, and
// the parsers every reader of that dump needs.
//
// This started life inside fetch-meta-rankings.mjs, which needed PvE move
// mechanics and discovered the hard way that "the game master" is not one feed
// but several mirrors of the same Niantic dump, published at wildly different
// cadences. Seven scripts now read it — the raid-attacker ranking, the
// species-meta pools, the rebalance watch, the evolution-cost pools, the
// regional-form catalog, the raid-boss name index and the Rocket tank flags —
// so the mirror list and the preference loop live here rather than in seven
// drifting copies.
//
// The last four of those arrived when pogoapi.net was retired in August 2026.
// It had stopped publishing in November 2025 and carried no freshness signal of
// its own — no batch id, no fetchedAt, only an HTTP Last-Modified nobody was
// reading — so a nine-month-old dataset kept passing every reachability check
// while silently missing seventeen released species. The game master publishes
// the same species facts first-hand and stamps every batch, so a stall here is
// visible. See docs/upstream-sources.md.
//
// The parsers in the second half are shape-tolerant on purpose. The mirrors
// wrap the template array differently across generations of the dump
// ({ template: [...] } / { templates: [...] } / { itemTemplate: [...] } / a
// bare array), and a template node may or may not be nested under `data`.
// Normalizing once here is what lets each caller's parser be three lines of
// intent instead of three lines of defensive unwrapping.
//
// THE MIRRORS, and why the order is what it is. Both publish the identical
// template array; they differ only in how current the dump is. Verified
// 2026-08-28, alexelgt batch 2026-08-28 against PokeMiners batch 2026-04-17:
// the `battleSettings` block and the whole CPM table are byte-identical, and
// not one `moveSettings` field differs between them. The stall cost ADDITIONS,
// never changed values:
//   - 19 more moveSettings templates: six genuinely new moves (Plasma Fists,
//     Glaive Rush, Snipe Shot, Dive, and both Gulp Missiles) plus thirteen
//     Mega-form movesets.
//   - 130 more species-shaped `breadOverrides` templates, which is 32 more
//     Dynamax-capable species — Rhyperior, Hydreigon, Magmortar, Electivire,
//     Milotic, Weavile, Gyarados, Registeel, Starmie, Centiskorch and the rest.
//   - 661 more templates overall (18,813 vs 18,152).
// The Season 27 rebalance is invisible in both, because it touched `combatMove`
// (PvP) only — 14 templates there differ — and PvE `moveSettings` did not move
// at all. That distinction matters for anything that claims the stale mirror
// carries "pre-rebalance values": for raids it does not, it carries pre-release
// gaps. scripts/fetch-game-master-watch.mjs is where the PvP side is watched.
//
// A mirror that answers with something unparsable — HTML from a rate limit, a
// truncated body, an object where an array belongs — counts as a FAILURE and
// falls through to the next one. Publishing a hole is the one outcome worse
// than using the fallback, which is what MIN_GAME_MASTER_TEMPLATES guards.
//
// So does a mirror whose batch is OLDER than the one the caller's snapshot was
// already built from, when the caller passes that batch as `minBatchMs`. An
// older dump parses, passes every size check and every downstream validation,
// and is still a rollback. See fetchGameMaster below.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPreviousJson } from "./json.mjs";

// Every mirror below serves the same Niantic template array. `parseStamp` maps
// that mirror's own timestamp file to epoch millis. Without a batch floor an
// unreadable stamp costs the staleness warning and the cache, nothing else;
// under one it disqualifies the mirror (see fetchGameMaster).
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
    // it stalls: it served a 2026-04-17 batch for at least 133 days. Kept
    // because a second source costs one request and a stalled mirror is still
    // better than no mechanics at all. It is not better than a snapshot already
    // built from something newer, though: on 2026-10-13 it served 2026-08-28
    // against alexelgt's 2026-10-10, which is what `minBatchMs` is for.
    name: "PokeMiners/game_masters",
    gameMaster: "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json",
    timestamp: "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/timestamp.txt",
    parseStamp: (text) => Number(text.trim()),
  },
];

// How stale the winning mirror may get before a sync says so out loud. Not a
// hard failure — stale mechanics still beat none — but never silent.
export const GAME_MASTER_STALE_WARN_DAYS = 30;

// A parse that lands below this is treated as a failed fetch, not as a small
// game master. The real dump is ~18,800 templates; anything under five thousand
// is a truncated body or an error page that happened to parse.
export const MIN_GAME_MASTER_TEMPLATES = 5000;

async function defaultFetchText(url, userAgent) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// ── Batch-stamped download cache ────────────────────────────────────────────
//
// The dump is ~19 MB and seven fetchers read it. `npm run prebuild` runs six of
// them back to back, so without a cache one build pulls the same bytes six
// times. The key is the mirror's OWN batch stamp, never a clock: the tiny
// timestamp file is fetched on every call and the big one only when the batch
// id actually moved. That makes this correctness-preserving rather than a
// staleness window — a new batch is never served from cache, and an unreadable
// stamp falls through to a fresh download (or, under a batch floor, to the next
// mirror). Every cache failure is non-fatal: it costs the download and nothing
// else.
//
// Fetching the stamp FIRST is what buys this, and it is why the two requests
// are no longer issued in parallel. One extra round-trip on a small file, in
// exchange for skipping 19 MB.
const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../.cache/game-master");
const cacheFile = (dir, name) => resolve(dir, `${name.replace(/[^a-z0-9]+/gi, "-")}.json`);

function readCache(dir, name, batchMs) {
  if (batchMs == null) return null;
  try {
    const cached = JSON.parse(readFileSync(cacheFile(dir, name), "utf8"));
    if (cached?.batchMs !== batchMs || !Array.isArray(cached.templates)) return null;
    return cached.templates;
  } catch {
    return null;
  }
}

function writeCache(dir, name, batchMs, templates) {
  if (batchMs == null) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(cacheFile(dir, name), JSON.stringify({ batchMs, templates }), "utf8");
  } catch { /* a cache that cannot be written just costs the next download */ }
}

// A batch stamp as a calendar day, for messages; the full instant when two
// stamps share a day, so a same-day rejection does not read "X older than X".
function batchLabels(batchMs, floorMs) {
  const iso = (ms) => new Date(ms).toISOString();
  const [a, b] = [iso(batchMs).slice(0, 10), iso(floorMs).slice(0, 10)];
  return a === b ? [iso(batchMs), iso(floorMs)] : [a, b];
}

// First mirror that answers with a plausible template array wins; the rest are
// pure fallback. Returns { templates, mirror, batchMs, failures, fromCache } —
// `failures` is the list of mirrors that were tried and rejected, so a caller
// can say out loud that it fell back. Throws only when every mirror failed.
//
// `minBatchMs` is the rollback guard: the batch the caller's committed snapshot
// was built from (batchMsFromIso() turns the recorded ISO batch back into one).
// A mirror stamped older than that goes into `failures` like an outage would,
// and the next mirror is tried. If none qualifies the call throws exactly as an
// outage does, so every caller's outage path applies unchanged: `--offline-ok`
// keeps the cache, the sync step goes red, and the soft readers (the Rocket
// bulk figures, the watch's PvE half) keep their previous data. Without it, the
// fallback that exists for an alexelgt outage would answer that outage with a
// dump weeks older than the one already committed, and the snapshots rebuilt
// from it would pass validation and be committed green. Omitted or null means
// no floor; fetch-raid-bosses passes none on purpose, because there an older
// batch only costs event-boss name resolution, which already warns, while a
// throw would take the whole raid rotation down with it.
//
// Under a floor an UNREADABLE stamp disqualifies the mirror too, rather than
// falling through to a download as it does without one. The floor is a claim
// that the dump is no older than the snapshot, and an unstamped dump cannot
// back it: waving it through would make "the timestamp request failed" the one
// path on which the guard silently does nothing. The price is a red step on a
// day when only the stamp request flakes, which the next run heals. A silent
// rollback gets committed and deployed, and writes a false PvE "change" into
// the rebalance watch's permanent history on the way.
//
// `cacheDir` exists for the offline checks, which must not touch the real cache.
export async function fetchGameMaster({
  userAgent = "pogo-filter-workshop game-master-fetcher/1.0",
  minTemplates = MIN_GAME_MASTER_TEMPLATES,
  mirrors = GAME_MASTER_MIRRORS,
  fetchText = (url) => defaultFetchText(url, userAgent),
  cache = true,
  cacheDir = CACHE_DIR,
  minBatchMs = null,
} = {}) {
  const floor = Number.isFinite(minBatchMs) && minBatchMs > 0 ? minBatchMs : null;
  const failures = [];
  for (const mirror of mirrors) {
    try {
      let stampError = null;
      const stampText = await fetchText(mirror.timestamp).catch((e) => { stampError = e; return ""; });
      let batchMs = null;
      try {
        const ms = mirror.parseStamp(stampText);
        if (Number.isFinite(ms) && ms > 0) batchMs = ms;
      } catch { /* an unreadable stamp costs the staleness warning and the cache */ }

      // Before the cache read, and that order is load-bearing: the cache only
      // ever serves the batch this stamp names, so rejecting the stamp here is
      // also what keeps a cached dump older than the floor from being served.
      if (floor != null && batchMs == null) {
        const why = stampError ? `unreachable (${stampError.message})` : "unreadable";
        throw new Error(`batch stamp ${why}, so it cannot be checked against snapshot's ` +
          `${new Date(floor).toISOString().slice(0, 10)}`);
      }
      if (floor != null && batchMs < floor) {
        const [batch, snapshot] = batchLabels(batchMs, floor);
        throw new Error(`batch ${batch} older than snapshot's ${snapshot}`);
      }

      const cached = cache ? readCache(cacheDir, mirror.name, batchMs) : null;
      if (cached && cached.length >= minTemplates) {
        return { templates: cached, mirror: mirror.name, batchMs, failures, fromCache: true };
      }

      const parsed = JSON.parse(await fetchText(mirror.gameMaster));
      if (!Array.isArray(parsed) || parsed.length < minTemplates) {
        throw new Error(`parsed as ${Array.isArray(parsed) ? `${parsed.length} templates` : typeof parsed}`);
      }
      if (cache) writeCache(cacheDir, mirror.name, batchMs, parsed);
      return { templates: parsed, mirror: mirror.name, batchMs, failures, fromCache: false };
    } catch (err) {
      failures.push(`${mirror.name}: ${err.message}`);
    }
  }
  throw new Error(`all game-master mirrors failed — ${failures.join("; ")}`);
}

// Whole days between a batch stamp and now; null when the stamp was unreadable.
export function gameMasterAgeDays(batchMs, now = Date.now()) {
  if (!Number.isFinite(batchMs) || batchMs <= 0) return null;
  return Math.floor((now - batchMs) / 86400000);
}

// The provenance block every snapshot fed by the game master carries, so a
// reader can tell which mirror answered and how old its dump was without
// re-deriving it from the script. `stale` is the flag the README's freshness
// claim rests on; `null` means the stamp could not be read at all.
export function gameMasterProvenance({ mirror, batchMs }, now = Date.now()) {
  const ageDays = gameMasterAgeDays(batchMs, now);
  return {
    mirror: mirror ?? null,
    batch: Number.isFinite(batchMs) && batchMs > 0 ? new Date(batchMs).toISOString() : null,
    ageDays,
    stale: ageDays == null ? null : ageDays > GAME_MASTER_STALE_WARN_DAYS,
  };
}

// The inverse of gameMasterProvenance().batch: the ISO batch a snapshot
// recorded, back as the epoch millis fetchGameMaster's `minBatchMs` takes.
// Null for a missing or unparsable value, so a first run, or a snapshot that
// predates the field, fetches with no floor exactly as before.
export function batchMsFromIso(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// The floor for the fetchers whose own snapshot records no batch
// (regional-forms, rocket-lineups, evolution-costs): the batch meta-rankings.json
// was built from. It is the sibling read from the same dump in the same sync
// job and the same prebuild, and it runs before every one of them except
// rocket-lineups, so the floor is either the committed batch or the one this
// run just advanced it to; it can never be lowered, because meta-rankings is
// floored by its own value. A missing file or field means no floor.
export const MECHANICS_SNAPSHOT_PATH =
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/data/meta-rankings.json");

export function mechanicsBatchFloor(path = MECHANICS_SNAPSHOT_PATH) {
  return batchMsFromIso(readPreviousJson(path)?.sources?.mechanicsBatch);
}

// One place that decides how a stale mirror is announced, so all three readers
// word it the same way. Returns true when the warning fired.
export function warnIfStale({ mirror, batchMs }, note = "") {
  const ageDays = gameMasterAgeDays(batchMs);
  if (ageDays == null || ageDays <= GAME_MASTER_STALE_WARN_DAYS) return false;
  console.warn(
    `⚠  ${mirror} batch is ${ageDays} days old (${new Date(batchMs).toISOString().slice(0, 10)}).` +
    (note ? ` ${note}` : ""),
  );
  return true;
}

// PvPoke's game master. The only source in the tree with a per-species
// `released` flag that tracks the live game rather than the presence of model
// data in a dump. fetch-pvp-rankings.mjs and fetch-game-master-watch.mjs
// already read it, so it adds no new upstream to the project.
export const PVPOKE_GAME_MASTER_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json";

// PvPoke's game master, parsed. Returns null on failure rather than throwing:
// every caller uses it as an overlay on top of the Niantic dump, so an outage
// should degrade the release gate, not fail the sync.
export async function fetchPvpokeGameMaster({
  userAgent = "pogo-filter-workshop game-master-fetcher/1.0",
} = {}) {
  try {
    return JSON.parse(await defaultFetchText(PVPOKE_GAME_MASTER_URL, userAgent));
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

// dex → the form enum a species' `FORMS_V####_POKEMON_*` template lists first
// ("ZACIAN_HERO"), which is the form the game treats as the species when
// nothing names another: in the 2026-10-13 alexelgt batch, of the 1024 species
// with a form list, every one that has a NORMAL form lists it first. The
// form-less template usually carries the same types, but not always: Zacian's
// and Zamazenta's carry the Crowned types, and Urshifu's drops the second type
// both its real forms have. A reader that wants the default form should ask
// this rather than trust the bare template. dexFromTemplateId() deliberately
// does not match the FORMS_ family, hence the pattern here.
export function defaultFormByDex(templates) {
  const out = new Map();
  for (const entry of templateList(templates)) {
    const node = templateNode(entry);
    const m = /^FORMS_V(\d+)_POKEMON_/.exec(node?.templateId || entry?.templateId || "");
    const first = node?.formSettings?.forms?.[0]?.form;
    if (m && typeof first === "string") out.set(parseInt(m[1], 10), first);
  }
  return out;
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

// movementId → type slug ("THUNDER_SHOCK_FAST" → "electric") for every
// moveSettings template. Species templates name their moves by movementId.
export function moveTypesById(templates) {
  const map = new Map();
  for (const entry of templateList(templates)) {
    const move = templateNode(entry)?.moveSettings;
    const type = typeSlug(move?.pokemonType);
    if (move?.movementId != null && type) map.set(move.movementId, type);
  }
  return map;
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
