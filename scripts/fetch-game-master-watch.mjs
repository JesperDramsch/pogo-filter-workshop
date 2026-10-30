#!/usr/bin/env node
// Rebalance early-warning, on two independent streams. Snapshots the move stats
// a rebalance can move and diffs them against the previous run, so a Niantic
// change shows up as a reviewable commit naming exactly which moves moved.
//
// TWO STREAMS, because a Pokémon GO move has two disjoint stat blocks and no
// single feed carries both:
//
//   PvP  — PvPoke's game master. `power`, `energy`, `energyGain`, `cooldown`,
//          `turns` and the buff fields: the turn-based Trainer-Battle numbers.
//          PvPoke rebuilds daily and re-scores its rankings off exactly these,
//          so this stream is also the leading indicator for the PvP rankings in
//          src/data/pvp-rankings.json going stale. It is the stream the
//          generated skill reference renders.
//   PvE  — the Niantic game master's own `moveSettings`. `power`, `durationMs`
//          and `energyDelta`: the real-time raid and gym numbers, which decide
//          the whole damage model in scripts/fetch-meta-rankings.mjs. PvPoke's
//          game master does not carry them at all.
//
// WHY THE PvE STREAM EXISTS NOW, AND WHY IT DID NOT BEFORE. The previous version
// of this file argued that the game master was useless for rebalance detection
// because PokeMiners — the mirror it had in mind — was stale: it served a
// 2026-04-17 batch for at least 133 days, so a watch on it would never fire and
// would give false confidence. That was right about PokeMiners and wrong about
// the option set. alexelgt/game_masters publishes the same Niantic dump every
// one to three days, and scripts/lib/game-master.mjs now prefers it. So the PvE
// block is both current and watchable, and this file downloads it rather than
// HEAD-probing a corpse for an ETag. PokeMiners is still reachable as that
// module's fallback mirror, and `sources.pve` records when it answered — which
// is strictly more than the old probe told us, since a fallback means the
// primary was down rather than merely that a stale ETag moved.
//
// The two streams are kept SEPARATE rather than merged, deliberately. They key
// differently — PvPoke by `moveId` ("EARTHQUAKE"), the game master by template
// id ("V0031_MOVE_EARTHQUAKE") — so merging would mean reconciling two id
// namespaces for no gain. More to the point, they answer different questions:
// the Season 27 rebalance changed 14 `combatMove` templates and not one PvE
// `moveSettings` value, and a reader of the history should be able to see that
// at a glance instead of inferring it from which field names appear. Every
// history entry carries a `stream` tag for that reason, and the skill reference
// filters on it so a PvE change is never captioned as a Trainer-Battle one.
//
// This file is NOT imported by the app — no filter string depends on it. It
// exists so a rebalance is visible in git days before it propagates into
// PvPoke's re-scored rankings or into the raid-attacker ranking, and so the
// generated skill reference can warn that the rankings may lag. Deliberately
// not in `prebuild`: a Pages deploy has no use for it, and it now pulls a
// 19 MB body.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";
import { fetchGameMaster, warnIfStale, gameMasterProvenance, batchMsFromIso, pokemonTemplates } from "./lib/game-master.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "src/data/game-master-watch.json");
const WATCH_MOVES_PATH = resolve(dirname(OUT_PATH), "watch-moves.json");

const PVPOKE_GM = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json";

// Only the fields a Trainer-Battle rebalance actually moves. Everything else in
// a move record (name, archetype, abbreviation) is cosmetic and would turn a
// copy-edit upstream into a false rebalance alert.
const TRACKED = ["power", "energy", "energyGain", "cooldown", "turns", "buffs", "buffTarget", "buffApplyChance"];

// The PvE equivalent. `power`, `durationMs` and `energyDelta` are the three
// numbers scripts/fetch-meta-rankings.mjs feeds into its cycle-DPS model, so a
// change to any of them moves the raid-attacker ranking; `pokemonType` is here
// because a retyped move changes STAB and therefore the ranking too.
// Deliberately NOT tracked: damageWindowStartMs / damageWindowEndMs (animation
// timing, not damage), and accuracyChance / criticalChance, which are constant
// across the whole PvE move set and unused by the model.
const TRACKED_PVE = ["power", "durationMs", "energyDelta", "pokemonType"];

// Keep the log reviewable; a rebalance is a handful of entries a few times a year.
const MAX_HISTORY = 40;
// Refuse-to-shrink floor, the same guard every sibling fetcher carries
// (fetch-regional-forms `< 500`, fetch-rocket-grunt-quotes `< 1000`). The live
// game master carries ~349 tracked PvP moves and ~403 PvE ones. A truncated
// parse that still yields a non-empty result is the dangerous case: diffMoves
// would emit a `removed` row for every absent move, and those rows are
// unshifted onto `history` and sliced to MAX_HISTORY — wiping every real
// rebalance ever recorded, then publishing the fabricated mass-removal as this
// file's headline signal.
const MIN_MOVES = 200;
const MIN_PVE_MOVES = 250;

const UA = { "User-Agent": "pogo-filter-workshop gm-watch/2.0" };

async function fetchJson(url) {
  const res = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function trackedFields(move, fields) {
  const out = {};
  for (const k of fields) if (move[k] !== undefined) out[k] = move[k];
  return out;
}

export function extractMoves(gm) {
  const out = {};
  for (const m of gm?.moves || []) {
    if (typeof m?.moveId !== "string") continue;
    out[m.moveId] = trackedFields(m, TRACKED);
  }
  return out;
}

// The game master's PvE side. Keyed by template id, which is what the dump
// itself keys by — see the two-streams note in the header for why this is not
// re-keyed to match PvPoke's `moveId`.
export function extractPveMoves(templates) {
  const out = {};
  for (const t of templates || []) {
    const ms = t?.data?.moveSettings;
    if (!ms || typeof t.templateId !== "string") continue;
    out[t.templateId] = trackedFields(ms, TRACKED_PVE);
  }
  return out;
}

// Compared through canonicalStringify, not JSON.stringify: it sorts object keys,
// so a field that upstream reorders cannot register as a rebalance. No tracked
// field is object-valued today (buffs is an array, where order IS significant
// and canonicalStringify preserves it), so this is insurance against a future
// one rather than a live bug — but a false rebalance alert is exactly the kind
// of churn this file exists to avoid.
const same = (a, b) => canonicalStringify(a) === canonicalStringify(b);

// Field-level diff so the commit message can say "Earthquake power 110 → 120"
// rather than "12 moves changed".
export function diffMoves(before, after, fields = TRACKED) {
  const changes = [];
  for (const [id, now] of Object.entries(after)) {
    const was = before?.[id];
    if (!was) { changes.push({ move: id, field: "*", from: null, to: "added" }); continue; }
    for (const f of fields) {
      if (was[f] === undefined && now[f] === undefined) continue;
      if (!same(was[f], now[f])) changes.push({ move: id, field: f, from: was[f] ?? null, to: now[f] ?? null });
    }
  }
  for (const id of Object.keys(before || {})) {
    if (!after[id]) changes.push({ move: id, field: "*", from: "present", to: "removed" });
  }
  return changes;
}

// The same refuse-to-shrink shape for both streams: an absolute floor, plus a
// halving guard against whatever the last good sync recorded.
function assertNotShrunken(label, count, prevCount, floor) {
  if (count < floor || (prevCount > 0 && count < prevCount / 2)) {
    throw new Error(
      `${label} carried ${count} moves (previous ${prevCount || "none"}, floor ${floor}) ` +
      "— refusing to overwrite cache",
    );
  }
}

// A fetched PvE dump, accepted or refused as a whole: its move stats and its
// templates come back together only once the shrink guard has passed, so
// nothing downstream (pveMoves, and the watchlist's learners, which read the
// templates' movepools) can be built from a dump the guard refused. A
// truncated mirror would otherwise empty every signature move's learner list
// and rewrite watch-moves.json without them.
export function acceptPveDump(templates, mirror, prevPveMoves, floor = MIN_PVE_MOVES) {
  const pveMoves = extractPveMoves(templates);
  assertNotShrunken(mirror, Object.keys(pveMoves).length, Object.keys(prevPveMoves || {}).length, floor);
  return { pveMoves, templates };
}

// Turns a diff into one history entry, and says what it found out loud. Shared
// by both streams so a PvE rebalance is reported exactly like a PvP one. The
// `stream` tag is what lets a consumer tell them apart — see the header.
function recordChanges(stream, changes, history, now) {
  if (changes.length === 0) return history;
  const names = [...new Set(changes.map(c => c.move))];
  console.log(`  ⚑ ${stream}: ${changes.length} field change(s) across ${names.length} move(s): ` +
    names.slice(0, 8).join(", "));
  return [{ at: now, stream, summary: `${names.length} move(s) changed`, changes }, ...history]
    .slice(0, MAX_HISTORY);
}

// Which species learn each move the history names: the sorting workflow's
// watchlist keeps a few of every species whose move just changed. Movepools
// come from the game master (quick, charged and both elite lists, any form)
// and PvPoke's roster, which sometimes lists a new move first.
// PvPoke names a fast move without the game master's _FAST suffix, so both
// spellings count. A temporary-evolution entry
// (VM_MOVE_TEMP_EVOLUTION_MEGA_V0609_POKEMON_CHANDELURE) names its species in
// the id. Returns { MOVE: [dex, …] } for the moves anyone learns.
export function learnersOf(templates, moveIds, pvpokePokemon = []) {
  const byMove = new Map();
  for (const p of pvpokePokemon) {
    for (const mv of [...(p?.fastMoves || []), ...(p?.chargedMoves || [])]) {
      if (!Number.isInteger(p?.dex)) continue;
      if (!byMove.has(mv)) byMove.set(mv, new Set());
      byMove.get(mv).add(p.dex);
    }
  }
  for (const { dex, settings } of pokemonTemplates(templates)) {
    for (const list of [settings.quickMoves, settings.cinematicMoves, settings.eliteQuickMove, settings.eliteCinematicMove]) {
      for (const mv of Array.isArray(list) ? list : []) {
        if (!byMove.has(mv)) byMove.set(mv, new Set());
        byMove.get(mv).add(dex);
      }
    }
  }
  const out = {};
  for (const id of [...new Set(moveIds)].sort()) {
    // The PvE stream names a move by its template id (V0288_MOVE_PSYCHO_BOOST);
    // movepools use the bare name.
    const name = id.replace(/^V\d{4}_MOVE_/, "");
    const dex = new Set([...(byMove.get(name) || []), ...(byMove.get(`${name}_FAST`) || [])]);
    const temp = /^VM_MOVE_TEMP_EVOLUTION_\w+?_V(\d{4})_POKEMON_/.exec(id);
    if (temp) dex.add(Number(temp[1]));
    if (dex.size > 0) out[id] = [...dex].sort((a, b) => a - b);
  }
  return out;
}

// The watchlist's move tier (docs/sorting-workflow-spec.md, "Meta and
// watchlist"): a move ADDED to either stream (a new move, a new Mega, a _PLUS
// move), and a CHANGED move only when it is a signature move, learned by at
// most WATCH_SIGNATURE_LEARNERS species. A rebalance of Bite or Body Slam
// touches a hundred species and would put half the dex on the watchlist.
// One entry per move and day; the app applies the time window.
export const WATCH_SIGNATURE_LEARNERS = 5;
export function watchMovesFrom(history, learnedBy) {
  const out = new Map();
  for (const h of history || []) {
    for (const c of h.changes || []) {
      const learners = learnedBy[c.move] || [];
      const added = c.to === "added";
      if (!added && (learners.length === 0 || learners.length > WATCH_SIGNATURE_LEARNERS)) continue;
      const key = `${c.move}|${h.at.slice(0, 10)}`;
      if (out.has(key)) continue;
      out.set(key, { move: c.move, change: added ? "added" : "changed", at: h.at, learners });
    }
  }
  return [...out.values()].sort((a, b) => b.at.localeCompare(a.at) || a.move.localeCompare(b.move));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const prev = readPreviousJson(OUT_PATH);

  let moves;
  let pvpokePokemon = [];
  try {
    console.log("→ PvPoke game master (PvP move stats)");
    const pvpokeGm = await fetchJson(PVPOKE_GM);
    moves = extractMoves(pvpokeGm);
    pvpokePokemon = Array.isArray(pvpokeGm?.pokemon) ? pvpokeGm.pokemon : [];
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; keeping cache.`);
      return;
    }
    process.exit(1);
  }
  assertNotShrunken("PvPoke game master", Object.keys(moves).length,
    Object.keys(prev?.moves || {}).length, MIN_MOVES);
  console.log(`  ${Object.keys(moves).length} PvP moves tracked`);

  // The PvE stream. Never fatal on its own: the PvP signal does not depend on
  // it, and a failed fetch keeps the previous PvE snapshot rather than
  // publishing an empty one — which would read as "every move was removed" on
  // the next diff and then as "every move was added" on the one after.
  //
  // `sources.pve` is seeded from the cache for the same reason #58 seeded the
  // PokeMiners probe from it: a mirror that 503s must not erase the record of
  // which mirror last answered and when.
  //
  // The fetch is floored at that recorded batch. A fallback mirror that is
  // behind would otherwise be diffed against a newer snapshot and land in the
  // permanent history as a PvE "change", and again as its reversal once the
  // primary came back. Rejected, it takes the soft path below like an outage.
  let pveMoves = prev?.pveMoves || null;
  let pveSource = {
    mirror: prev?.sources?.pve ?? null,
    batch: prev?.sources?.pveBatch ?? null,
  };
  let pveFresh = false;
  let gmTemplates = null;
  try {
    console.log("→ Niantic game master (PvE move mechanics)");
    const gm = await fetchGameMaster({
      userAgent: UA["User-Agent"],
      minBatchMs: batchMsFromIso(pveSource.batch),
    });
    const accepted = acceptPveDump(gm.templates, gm.mirror, pveMoves);
    pveMoves = accepted.pveMoves;
    gmTemplates = accepted.templates;
    pveFresh = true;
    const prov = gameMasterProvenance({ mirror: gm.mirror, batchMs: gm.batchMs });
    pveSource = { mirror: prov.mirror, batch: prov.batch };
    if (gm.failures.length > 0) {
      console.warn(`⚠  fell back to ${gm.mirror} after ${gm.failures.join("; ")}`);
    }
    console.log(`  ${Object.keys(pveMoves).length} PvE moves tracked from ${gm.mirror}`);
    warnIfStale({ mirror: gm.mirror, batchMs: gm.batchMs },
      "A PvE rebalance would not show up here until the mirror moves.");
  } catch (e) {
    console.warn(`  ⚠  PvE stream failed (${e.message}) — keeping the previous PvE snapshot`);
  }

  const now = new Date().toISOString();
  const priorHistory = prev?.history || [];
  let history = priorHistory;
  history = recordChanges("pvp", prev?.moves ? diffMoves(prev.moves, moves) : [], history, now);
  if (pveFresh && prev?.pveMoves) {
    history = recordChanges("pve", diffMoves(prev.pveMoves, pveMoves, TRACKED_PVE), history, now);
  }
  if (history.length === priorHistory.length && prev?.moves) {
    console.log("  ↺ no move stats changed on either stream");
  }
  // The watchlist's move tier, written to its own small snapshot so the app
  // does not bundle this file. Kept as is when the game master is unreachable.
  if (gmTemplates) {
    const named = history.flatMap((h) => (h.changes || []).map((c) => c.move));
    const learnedBy = learnersOf(gmTemplates, named, pvpokePokemon);
    const nobody = [...new Set(named)].filter((m) => !learnedBy[m]);
    if (nobody.length) console.log(`  moves in the history no species learns yet: ${nobody.join(", ")}`);
    const watchMoves = watchMovesFrom(history, learnedBy);
    const prevWatch = readPreviousJson(WATCH_MOVES_PATH);
    const content = { signatureLearners: WATCH_SIGNATURE_LEARNERS, moves: watchMoves };
    const same = prevWatch?.fetchedAt &&
      canonicalStringify({ signatureLearners: prevWatch.signatureLearners, moves: prevWatch.moves }) === canonicalStringify(content);
    writeJson(WATCH_MOVES_PATH, { fetchedAt: same ? prevWatch.fetchedAt : now, ...content });
    console.log(`✓ wrote ${WATCH_MOVES_PATH} (${watchMoves.length} watch moves)`);
  }

  // No derived fields, per #58: `moveCount` and `trackedFields` restated a
  // number the reader can count and a constant that lives in this script, and
  // each was one more field a reader had to decide whether to trust. `sources`
  // is not derived — it names which upstream answered, which nothing else
  // records — but for the same reason it carries no age or `stale` flag: those
  // come from the clock, and a committed field that flips on the day it crosses
  // a threshold is a churn commit whose whole diff is `false → true`. The
  // staleness warning goes to the console, where it does not get committed.
  const newContent = {
    sources: {
      pvp: "pvpoke-gamemaster",
      pve: pveSource.mirror,
      pveBatch: pveSource.batch,
    },
    history,
    moves,
    pveMoves: pveMoves || {},
  };

  let fetchedAt = now;
  if (prev) {
    const { fetchedAt: _p, ...prevContent } = prev;
    if (canonicalStringify(prevContent) === canonicalStringify(newContent) && prev.fetchedAt) {
      fetchedAt = prev.fetchedAt;
      console.log("  ↺ content unchanged — preserving previous fetchedAt");
    }
  }

  writeJson(OUT_PATH, { fetchedAt, ...newContent });
  console.log(`✓ wrote ${OUT_PATH}`);
}

// Importable for offline tests without firing the fetch.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(e => { console.error(e); process.exit(1); });
}
