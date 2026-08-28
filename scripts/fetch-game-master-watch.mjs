#!/usr/bin/env node
// Rebalance early-warning. Snapshots the PvP-relevant move stats and diffs them
// against the previous run, so a Niantic move rebalance shows up as a reviewable
// commit naming exactly which moves moved.
//
// WHY NOT PokeMiners, which is the obvious choice and what the research doc
// recommends: its mirror is stale. As of 2026-08-28, latest/timestamp.txt reads
// 1776386930700 (2026-04-17) and latest/latest.json still carries the
// PRE-Season-27 values for every move the Season 27 rebalance touched —
// Earthquake 110 (live: 120), Drill Run 80/45 (live: 70/40), Flash Cannon
// energy 70 (live: 65), Earth Power energy 55 (live: 50). A watch on that feed
// would never fire and would give false confidence, so PvPoke's game master —
// verified carrying all four current values — is the primary signal instead.
//
// PokeMiners is still probed, because it costs one HEAD request and it is the
// only feed that could ever give PRE-announcement lead time. We record its ETag
// and its timestamp so that a mirror waking up is itself visible as a diff. We
// deliberately do not download its 18.7 MB body: raw.githubusercontent serves no
// Last-Modified, so the ETag is the whole change signal, and the body is stale
// anyway.
//
// This file is NOT imported by the app — no filter string depends on it. It
// exists so a rebalance is visible in git days before it propagates into
// PvPoke's re-scored rankings, and so the generated skill reference can warn
// that the rankings may lag. Deliberately not in `prebuild`: a Pages deploy has
// no use for it.
//
// Flags: --offline-ok   tolerate fetch failures if cache exists.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, writeJson, readPreviousJson } from "./lib/json.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "src/data/game-master-watch.json");

const PVPOKE_GM = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json";
const POKEMINERS_GM = "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json";
const POKEMINERS_TS = "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/timestamp.txt";

// Only the fields a Trainer-Battle rebalance actually moves. Everything else in
// a move record (name, archetype, abbreviation) is cosmetic and would turn a
// copy-edit upstream into a false rebalance alert.
const TRACKED = ["power", "energy", "energyGain", "cooldown", "turns", "buffs", "buffTarget", "buffApplyChance"];
// Keep the log reviewable; a rebalance is a handful of entries a few times a year.
const MAX_HISTORY = 40;
// Refuse-to-shrink floor, the same guard every sibling fetcher carries
// (fetch-regional-forms `< 500`, fetch-rocket-grunt-quotes `< 1000`). The live
// game master carries ~349 tracked moves. A truncated parse that still yields a
// non-empty moves[] is the dangerous case: diffMoves would emit a `removed` row
// for every absent move, and those rows are unshifted onto `history` and sliced
// to MAX_HISTORY — wiping every real rebalance ever recorded, then publishing the
// fabricated mass-removal as this file's headline signal.
const MIN_MOVES = 200;

const UA = { "User-Agent": "pogo-filter-workshop gm-watch/1.0" };

async function fetchJson(url) {
  const res = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return (await res.text()).trim();
}

// One HEAD, zero bytes of body. This is the entire PokeMiners probe.
async function headEtag(url) {
  const res = await fetch(url, { method: "HEAD", headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.headers.get("etag");
}

function trackedFields(move) {
  const out = {};
  for (const k of TRACKED) if (move[k] !== undefined) out[k] = move[k];
  return out;
}

function extractMoves(gm) {
  const out = {};
  for (const m of gm?.moves || []) {
    if (typeof m?.moveId !== "string") continue;
    out[m.moveId] = trackedFields(m);
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
function diffMoves(before, after) {
  const changes = [];
  for (const [id, now] of Object.entries(after)) {
    const was = before?.[id];
    if (!was) { changes.push({ move: id, field: "*", from: null, to: "added" }); continue; }
    for (const f of TRACKED) {
      if (was[f] === undefined && now[f] === undefined) continue;
      if (!same(was[f], now[f])) changes.push({ move: id, field: f, from: was[f] ?? null, to: now[f] ?? null });
    }
  }
  for (const id of Object.keys(before || {})) {
    if (!after[id]) changes.push({ move: id, field: "*", from: "present", to: "removed" });
  }
  return changes;
}

// PokeMiners publishes epoch millis, despite its README documenting a
// "gm gm_version apk_version date time" string. Tolerate both.
function parsePokeminersTimestamp(raw) {
  const ms = Number(String(raw).trim().split(/\s+/)[0]);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const offlineOk = args.has("--offline-ok");
  const prev = readPreviousJson(OUT_PATH);

  let moves;
  try {
    console.log("→ PvPoke game master (move stats)");
    moves = extractMoves(await fetchJson(PVPOKE_GM));
  } catch (e) {
    console.error(`✗ Fetch failed: ${e.message}`);
    if (offlineOk && existsSync(OUT_PATH)) {
      console.warn(`⚠  --offline-ok and cached ${OUT_PATH} exists; keeping cache.`);
      return;
    }
    process.exit(1);
  }
  const moveCount = Object.keys(moves).length;
  const prevCount = Object.keys(prev?.moves || {}).length;
  if (moveCount < MIN_MOVES || (prevCount > 0 && moveCount < prevCount / 2)) {
    throw new Error(
      `game master carried ${moveCount} moves (previous ${prevCount || "none"}, floor ${MIN_MOVES}) ` +
      "— refusing to overwrite cache",
    );
  }
  console.log(`  ${moveCount} moves tracked`);

  // Secondary probe. Never fatal — the primary signal does not depend on it.
  //
  // Seeded from the cache, not from nulls: a probe that 503s must not erase the
  // ETag and timestamp we already had. Overwriting them with nulls disarmed the
  // "mirror is stale" signal this file exists to make visible, produced a churn
  // commit on the flake and another on recovery, and — worst — made an ETag that
  // genuinely changed during the outage indistinguishable from the restored one.
  const pokeminers = {
    sourceEtag: prev?.pokeminers?.sourceEtag ?? null,
    gameMasterAt: prev?.pokeminers?.gameMasterAt ?? null,
  };
  try {
    pokeminers.sourceEtag = await headEtag(POKEMINERS_GM);
    pokeminers.gameMasterAt = parsePokeminersTimestamp(await fetchText(POKEMINERS_TS));
  } catch (e) {
    console.warn(`  ⚠  PokeMiners probe failed (${e.message}) — keeping previously recorded values`);
  }
  if (pokeminers.gameMasterAt) {
    // Reported, never stored: an age is derived from the clock, so writing it
    // into the snapshot would flip a committed field on the day it crosses the
    // threshold with byte-identical upstream data — a churn commit whose entire
    // diff is `"stale": false → true`. A reader has gameMasterAt and a clock.
    const ageDays = Math.round((Date.now() - Date.parse(pokeminers.gameMasterAt)) / 86400000);
    console.log(
      `  PokeMiners mirror: ${pokeminers.gameMasterAt.slice(0, 10)} ` +
      `(${ageDays}d old)${ageDays > 45 ? " — STALE, not used as a signal" : ""}`,
    );
  }

  const changes = prev?.moves ? diffMoves(prev.moves, moves) : [];
  const now = new Date().toISOString();
  let history = prev?.history || [];
  if (changes.length > 0) {
    const names = [...new Set(changes.map(c => c.move))];
    console.log(`  ⚑ ${changes.length} field change(s) across ${names.length} move(s): ${names.slice(0, 8).join(", ")}`);
    history = [{ at: now, summary: `${names.length} move(s) changed`, changes }, ...history].slice(0, MAX_HISTORY);
  } else if (prev?.moves) {
    console.log("  ↺ no move stats changed");
  }

  // No derived fields: `moveCount` restated a number the reader can count from
  // the `moves` object below it, and `trackedFields` restated a constant that
  // lives in this script. Both were read by nothing, and each was one more field
  // a reader of the snapshot had to decide whether to trust as authoritative or
  // as a stale copy.
  const newContent = {
    source: "pvpoke-gamemaster",
    pokeminers,
    history,
    moves,
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

main().catch(e => { console.error(e); process.exit(1); });
