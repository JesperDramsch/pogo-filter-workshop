#!/usr/bin/env node
// The sync job's two reports on what moved, built from one table of what it
// tracks: the data commit's message (`classify`) and the job summary
// (`render`).
//
// Why a summary at all: the run page listed step names, and the last step
// printed only which fetches failed. Finding out what a sync changed meant
// reading a 679-line pvp-rankings.json diff and a 1,009-line pvp-meta.json diff
// for what was, on 2026-10-13, two Great/Ultra swaps and a four-name Mega Ultra
// change, while the fetchers' warnings sat in step logs nobody opens. The
// summary puts the status of every part, the deltas of the four parts a person
// actually reads (PvP, events, raids, the move-stat watch) and the folded
// warnings on the run page.
//
// Both modes compare each tracked file between a base commit and the working
// tree. classify runs before the commit with base HEAD; render runs at the end
// with base = the commit the job checked out, so it is right after a push and
// equally right when validation held the push back.
//
// render must never be what turns a run red. The workflow runs it with
// `|| true`, and every per-part renderer falls back to the plain
// changed / provenance only / no change row when it throws, so a snapshot
// whose shape moved costs detail, not the summary.
//
// Species names come from pokemonNameFor over the dex numbers the snapshots
// carry, never from a list written here (CLAUDE.md). That is why this runs
// under vite-node: src/data/species.js imports JSON, which plain node will not
// load.
//
//   npx vite-node scripts/sync-summary.mjs classify --base HEAD --out <dir>
//   npx vite-node scripts/sync-summary.mjs render --base <sha> --logs <dir>

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pokemonNameFor } from "../src/data/species.js";
import { canonicalStringify } from "./lib/json.mjs";
import { classifyChange, namedStamps } from "./lib/stamp-only.mjs";
import { gameMasterAgeDays, GAME_MASTER_STALE_WARN_DAYS } from "./lib/game-master.mjs";

const REF = "skills/pokemon-go-filters/references";

// One row per fetch step, in workflow order. `id` is the step id, the
// workflow_dispatch input and the name of the step's log; `scope` and `what`
// make the commit line "- <scope>: <what>", as they did when this table was a
// list of track() calls in the workflow. `source` names the upstream in the
// summary row where the fetcher can fall back to another one.
export const PARTS = [
  { id: "raids", scope: "raids", label: "Raids",
    what: () => "boss snapshot from lily-dex-api", paths: ["src/data/raid-bosses.json"] },
  { id: "rocket-lineups", scope: "rocket", label: "Rocket lineups",
    what: () => "lineup snapshot", paths: ["src/data/rocket-lineups.json"],
    source: (doc) => doc?.source },
  { id: "rocket-quotes", scope: "rocket", label: "Rocket quotes",
    what: () => "grunt quotes from holoholo-text", paths: ["src/data/rocket-grunt-quotes.json"] },
  // Name the upstream the PvP snapshot actually came from. The fetcher falls
  // back to lily-dex whenever PvPoke is unreachable, and that snapshot is
  // materially different (no speciesId, score or forms, so the reference's
  // "Ranked form" and "Score" columns collapse to "—"). The git log is the
  // provenance trail CLAUDE.md points at.
  { id: "pvp", scope: "pvp", label: "PvP rankings",
    what: (doc) => `ranking snapshot from ${doc?.source ?? "an unknown source"}`, paths: ["src/data/pvp-rankings.json"],
    source: (doc) => doc?.source },
  { id: "meta", scope: "meta", label: "Raid attackers (meta)",
    what: () => "raid-attacker + shadow-keeper rankings from the game master", paths: ["src/data/meta-rankings.json"] },
  { id: "species-meta", scope: "species-meta", label: "Species meta",
    what: () => "special-trade/starter/power-line/mega pools", paths: ["src/data/species-meta.json"] },
  { id: "events", scope: "events", label: "Events",
    what: () => "wildspawn snapshot from leak-duck", paths: ["src/data/events.json"] },
  { id: "regional-forms", scope: "forms", label: "Regional forms",
    what: () => "regional-form catalog from the game master", paths: ["src/data/regional-forms.json"] },
  // The watch's history IS the rebalance notification, so its commit line names
  // each new entry and its stream rather than a generic "move stats".
  { id: "game-master-watch", scope: "game-master", label: "Game-master watch",
    what: () => "move stats", paths: ["src/data/game-master-watch.json"],
    commitLines: (r) => {
      const fresh = newHistory(r.before, r.after);
      return fresh.length ? fresh.map((h) => `${h.stream ?? "pvp"} ${h.summary}`) : null;
    } },
];

// Not a fetch step: regenerated from pvp and game-master-watch every run.
export const REFERENCE = {
  id: "reference", scope: "reference", label: "Skill reference",
  what: () => "regenerated PvP meta reference", paths: [`${REF}/pvp-meta.json`, `${REF}/META.md`],
};

const RANK = { none: 0, provenance: 1, content: 2 };
const parseOrNull = (text) => { try { return text == null ? null : JSON.parse(text); } catch { return null; } };

// read = { base(path), head(path) }, each returning the file's text or null.
export function classifyAll(read) {
  return [...PARTS, REFERENCE].map((part) => {
    const files = part.paths.map((path) => {
      const before = read.base(path), after = read.head(path);
      return { path, before, after, ...classifyChange(before, after) };
    });
    const kind = files.reduce((k, f) => (RANK[f.kind] > RANK[k] ? f.kind : k), "none");
    return {
      part,
      kind,
      stamps: files.flatMap((f) => f.stamps),
      changedPaths: files.filter((f) => f.kind !== "none").map((f) => f.path),
      before: parseOrNull(files[0].before),
      after: parseOrNull(files[0].after),
    };
  });
}

// History entries in `after` that `before` does not have, newest first. Keyed by
// the whole entry: on 2026-09-09 a pvp and a pve entry shared one timestamp.
export function newHistory(before, after) {
  const seen = new Set((before?.history ?? []).map(canonicalStringify));
  return (after?.history ?? []).filter((h) => !seen.has(canonicalStringify(h)));
}

const stampKeys = (stamps) => [...new Set(namedStamps(stamps).map((s) => s.key))];

// The data commit. Every file that moved is committed, provenance-only ones
// too (check-meta-rankings needs the roster stamp to keep advancing), but only
// parts whose content changed reach the subject.
export function commitMessage(results) {
  const scopes = [], body = [], paths = [];
  for (const r of results) {
    if (r.kind === "none") continue;
    paths.push(...r.changedPaths);
    if (r.kind === "provenance") {
      body.push(`- ${r.part.scope}: provenance only (${stampKeys(r.stamps).join(", ")})`);
      continue;
    }
    if (!scopes.includes(r.part.scope)) scopes.push(r.part.scope);
    for (const line of r.part.commitLines?.(r) ?? [r.part.what(r.after)]) body.push(`- ${r.part.scope}: ${line}`);
  }
  if (!paths.length) return null;
  const subject = scopes.length ? `chore(data): sync ${scopes.join(", ")}` : "chore(data): refresh provenance stamps";
  return { subject, body, paths, text: `${subject}\n\n${body.join("\n")}\n` };
}

// ─── Markdown helpers ─────────────────────────────────────────────────────────

// Anything that came from upstream (titles, names, log lines) goes through this:
// one line, capped, with the characters that would start markup escaped.
export function md(value, max = 120) {
  let s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s.replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const monthDay = (iso) => String(iso ?? "").slice(5, 10) || "?";
const dateOnly = (iso) => String(iso ?? "").slice(0, 10) || "?";

// "2026-10-13 01:07:13" and "2026-10-13T01:07:13.000Z" both read "10-13 01:07".
function stampValue(v) {
  const m = /^\d{4}-(\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v));
  return m ? `${m[1]} ${m[2]}` : String(v);
}

function stampLabel(key) {
  if (key === "rosterBatch") return "PvPoke roster stamp";
  if (key === "enKeys") return "holoholo-text key count";
  if (key === "checkedAt") return "watch check";
  if (/Batch$/.test(key)) return "game-master batch";
  return key;
}

const describeStamps = (stamps) => namedStamps(stamps)
  .filter((s, i, all) => all.findIndex((t) => t.key === s.key) === i)
  .map((s) => `${stampLabel(s.key)} ${md(stampValue(s.from), 40)} → ${md(stampValue(s.to), 40)}`)
  .join("; ");

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Lowercase is how pokemonNameFor returns names (PoGo search syntax); the
// capital is for display only.
function speciesName(dex) {
  const n = pokemonNameFor(String(dex), "en");
  return n ? md(capitalise(n), 40) : `#${md(dex, 12)}`;
}

function capList(items, max) {
  return items.length > max ? [...items.slice(0, max), `+${items.length - max} more`] : items;
}

// ─── Layer B: what moved inside the four parts a person reads ────────────────

// Entrants and leavers per league and cup, keyed by dex.
export function renderPvp(before, after) {
  const groups = (j) => ({ ...(j?.leagues ?? {}), ...(j?.cups ?? {}) });
  const A = groups(before), B = groups(after);
  const label = (key, g) => md(g?.name ? g.name.replace(/ (League|Cup)$/, "") : capitalise(key), 40);
  const lines = [], reordered = [], unchanged = [];
  for (const key of new Set([...Object.keys(B), ...Object.keys(A)])) {
    const a = A[key], b = B[key];
    if (!a) { lines.push(`- ${label(key, b)}: new, ${b.species?.length ?? 0} ranked`); continue; }
    if (!b) { lines.push(`- ${label(key, a)}: dropped`); continue; }
    const oldDex = (a.species ?? []).map((s) => s.dex), newDex = (b.species ?? []).map((s) => s.dex);
    const inn = newDex.map((d, i) => [d, i + 1]).filter(([d]) => !oldDex.includes(d));
    const out = oldDex.map((d, i) => [d, i + 1]).filter(([d]) => !newDex.includes(d));
    if (!inn.length && !out.length) {
      (canonicalStringify(a) === canonicalStringify(b) ? unchanged : reordered).push(label(key, b));
      continue;
    }
    const sides = [
      capList(inn.map(([d, r]) => `+${speciesName(d)} (#${r})`), 4).join(", "),
      capList(out.map(([d, r]) => `−${speciesName(d)} (was #${r})`), 4).join(", "),
    ].filter(Boolean);
    lines.push(`- ${label(key, b)}: ${sides.join(" · ")}`);
  }
  const quiet = [
    reordered.length && `reordered only: ${reordered.join(", ")}`,
    unchanged.length && `unchanged: ${unchanged.join(", ")}`,
  ].filter(Boolean);
  if (quiet.length) lines.push(`- ${quiet.join(" · ")}`);

  const ev = (j) => new Map((j?.gblEvents ?? []).map((e) => [e.eventID, e]));
  const oldEv = ev(before), newEv = ev(after);
  const win = (e) => `${monthDay(e.start)} → ${monthDay(e.end)}`;
  for (const [id, e] of newEv) {
    const p = oldEv.get(id);
    if (!p) lines.push(`- GBL: +${md(e.name, 80)} (${win(e)})`);
    else if (canonicalStringify(p) !== canonicalStringify(e)) lines.push(`- GBL: ${md(e.name, 80)} now ${win(e)}`);
  }
  for (const [id, e] of oldEv) if (!newEv.has(id)) lines.push(`- GBL: −${md(e.name, 80)} (was ${win(e)})`);

  const src = before?.source && before.source !== after?.source
    ? `${md(before.source, 20)} → ${md(after?.source, 20)}` : md(after?.source, 20);
  const depth = after?.topN ? `, top ${md(after.topN, 6)}` : "";
  return { title: `**PvP** (${src}${depth})`, lines };
}

// New events, changed spawns and windows, and what dropped out. Returns the
// titles whose unresolved names it printed, so the folded warnings can skip
// the fetcher's line saying the same thing.
export function renderEvents(before, after, now = Date.now()) {
  const lines = [], shownUnresolved = new Set();
  const byId = (list) => new Map((list ?? []).map((e) => [e.id, e]));
  const names = (dexes) => capList((dexes ?? []).map(speciesName), 6).join(", ");
  const unresolved = (e) => {
    const u = e.unresolved ?? [];
    if (!u.length) return "";
    shownUnresolved.add(e.title);
    return ` · ⚠ ${u.length} unresolved: ${capList(u.map((x) => `"${md(x, 60)}"`), 3).join(", ")}`;
  };
  const oldE = byId(before?.events), newE = byId(after?.events);
  for (const [id, e] of newE) {
    if (oldE.has(id)) continue;
    lines.push(`- new: ${md(e.title, 80)} (${monthDay(e.start)} → ${monthDay(e.end)}): ${names(e.spawnDex) || "no spawns resolved"}${unresolved(e)}`);
  }
  for (const [id, e] of newE) {
    const p = oldE.get(id);
    if (!p) continue;
    const add = (e.spawnDex ?? []).filter((d) => !(p.spawnDex ?? []).includes(d));
    const rem = (p.spawnDex ?? []).filter((d) => !(e.spawnDex ?? []).includes(d));
    const parts = capList([...add.map((d) => `+${speciesName(d)}`), ...rem.map((d) => `−${speciesName(d)}`)], 6);
    if (p.start !== e.start || p.end !== e.end) parts.push(`now ${monthDay(e.start)} → ${monthDay(e.end)}`);
    if (canonicalStringify(p.unresolved ?? []) !== canonicalStringify(e.unresolved ?? [])) {
      const u = unresolved(e);
      if (u) parts.push(u.replace(/^ · /, ""));
    }
    if (parts.length) lines.push(`- ${md(e.title, 80)}: ${parts.join(", ")}`);
  }
  const gone = [...oldE.values()].filter((e) => !newE.has(e.id));
  const ended = gone.filter((e) => Date.parse(e.end) <= now), withdrawn = gone.filter((e) => !ended.includes(e));
  if (ended.length) {
    const ends = [...new Set(ended.map((e) => monthDay(e.end)))].join(", ");
    lines.push(`- aged out (ended ${ends}): ${capList(ended.map((e) => md(e.title, 80)), 4).join(", ")}`);
  }
  if (withdrawn.length) lines.push(`- dropped by the feed before ending: ${capList(withdrawn.map((e) => md(e.title, 80)), 4).join(", ")}`);

  const oldP = byId(before?.eggPools), newP = byId(after?.eggPools);
  for (const [id, e] of newP) {
    const p = oldP.get(id);
    if (!p) { lines.push(`- egg pool: +${md(e.title, 80)} (${(e.eggDex ?? []).length} species)`); continue; }
    const add = (e.eggDex ?? []).filter((d) => !(p.eggDex ?? []).includes(d));
    const rem = (p.eggDex ?? []).filter((d) => !(e.eggDex ?? []).includes(d));
    if (add.length || rem.length) {
      lines.push(`- egg pool ${md(e.title, 80)}: ${capList([...add.map((d) => `+${speciesName(d)}`), ...rem.map((d) => `−${speciesName(d)}`)], 6).join(", ")}`);
    }
  }
  for (const [id, e] of oldP) if (!newP.has(id)) lines.push(`- egg pool: −${md(e.title, 80)}`);
  return { title: "**Events**", lines, shownUnresolved };
}

// Per tier, by boss id, named with the snapshot's own names: raid bosses carry
// no dex number, so pokemonNameFor has nothing to look up.
export function renderRaids(before, after) {
  const lines = [];
  const bossName = (b) => md(b?.names?.en ?? b?.id, 40);
  const tiers = (prefix, a = {}, b = {}) => {
    for (const tier of new Set([...Object.keys(b), ...Object.keys(a)])) {
      const oldIds = (a[tier] ?? []).map((x) => x.id), newIds = (b[tier] ?? []).map((x) => x.id);
      const add = (b[tier] ?? []).filter((x) => !oldIds.includes(x.id));
      const rem = (a[tier] ?? []).filter((x) => !newIds.includes(x.id));
      if (!add.length && !rem.length) continue;
      const sides = [
        capList(add.map((x) => `+${bossName(x)}`), 6).join(", "),
        capList(rem.map((x) => `−${bossName(x)}`), 6).join(", "),
      ].filter(Boolean);
      lines.push(`- ${prefix}${md(tier, 30)}: ${sides.join(" · ")}`);
    }
  };
  tiers("", before?.raids, after?.raids);
  tiers("max ", before?.maxBattles, after?.maxBattles);
  const byId = (j) => new Map((j?.eventRaids ?? []).map((e) => [e.eventID, e]));
  const oldE = byId(before), newE = byId(after);
  for (const [id, e] of newE) {
    if (!oldE.has(id)) lines.push(`- event raids: +${md(e.name, 80)} (${monthDay(e.start)} → ${monthDay(e.end)})`);
  }
  for (const [id, e] of oldE) if (!newE.has(id)) lines.push(`- event raids: −${md(e.name, 80)}`);
  return { title: "**Raids**", lines };
}

// Every history entry the base did not have, with its stream: PvP entries are
// what the skill reference captions as a rebalance, PvE ones move raid damage.
export function renderWatch(before, after) {
  const change = (c) => (c.field === "*"
    ? `${md(c.move, 60)} ${md(c.to ?? "removed", 20)}`
    : `${md(c.move, 60)} ${md(c.field, 20)} ${md(c.from, 20)}→${md(c.to, 20)}`);
  const lines = newHistory(before, after).map((h) =>
    `- ${md(h.stream ?? "pvp", 10)} ${dateOnly(h.at)}: ${md(h.summary, 60)} (${capList((h.changes ?? []).map(change), 4).join(", ")})`);
  return { title: "**Game-master watch**", lines };
}

const RENDERERS = { pvp: renderPvp, events: renderEvents, raids: renderRaids, "game-master-watch": renderWatch };

// ─── Layer A: one row per part, the verdict, upstreams, warnings ─────────────

const ANSI = /\x1b\[[0-9;]*m/g;
const logLines = (text) => String(text ?? "").replace(ANSI, "").split("\n").map((l) => l.trim()).filter(Boolean);

// The line a person needs from a failed step: its last ✗, else the first
// thrown error. A step killed by its timeout has neither.
export function lastError(log) {
  const lines = logLines(log);
  const line = lines.filter((l) => l.includes("✗")).at(-1) ?? lines.find((l) => /^\w*Error\b/.test(l));
  return line ? line.replace(/^✗\s*/, "") : null;
}

// Fetcher ⚠ lines, and the validation's "!" and ⚠ lines with their section
// (D5, M2...). Upstream-derived, so escaped and capped; the em dash the
// fetchers print reads as a comma in a list item.
export function collectWarnings(logs, skip = () => false) {
  const out = [];
  const tidy = (s) => md(s.replace(/^⚠\s*/, "").replace(/\s+—\s+/g, ", "), 200);
  for (const part of PARTS) {
    for (const l of logLines(logs[part.id])) {
      if (!l.startsWith("⚠") || skip(part.id, l)) continue;
      out.push(`${part.id}: ${tidy(l)}`);
    }
  }
  let section = null;
  for (const l of logLines(logs.validate)) {
    const head = /^([DM]\d+) — /.exec(l);
    if (head) { section = head[1]; continue; }
    if (l.startsWith("! ") || l.startsWith("⚠")) {
      out.push(`validate${section ? ` (${section})` : ""}: ${tidy(l.replace(/^!\s*/, ""))}`);
    }
  }
  return out;
}

// The newest game-master batch any of the three game-master snapshots now
// holds, and which mirror served it.
function upstreamLine(results, now) {
  const doc = (id) => results.find((r) => r.part.id === id)?.after;
  const meta = doc("meta")?.sources, species = doc("species-meta")?.sources, watch = doc("game-master-watch")?.sources;
  const batches = [
    [meta?.mechanics, meta?.mechanicsBatch],
    [species?.gameMaster, species?.gameMasterBatch],
    [watch?.pve, watch?.pveBatch],
  ].filter(([m, b]) => m && Number.isFinite(Date.parse(b)));
  const parts = [];
  if (batches.length) {
    const [mirror, batch] = batches.sort((x, y) => Date.parse(y[1]) - Date.parse(x[1]))[0];
    const age = gameMasterAgeDays(Date.parse(batch), now);
    const stale = age != null && age > GAME_MASTER_STALE_WARN_DAYS ? " ⚠ stale" : "";
    parts.push(`game master ${md(mirror, 60)}, batch ${dateOnly(batch)} (${age} d old)${stale}`);
  }
  const pvp = doc("pvp")?.source;
  if (pvp) parts.push(`PvP ${md(pvp, 20)}`);
  return parts.length ? `Upstreams: ${parts.join(" · ")}` : null;
}

function triggerText(event, inputs) {
  if (event === "schedule") return "scheduled run";
  if (event !== "workflow_dispatch") return `${md(event, 30)} run`;
  const ticked = Object.keys(inputs ?? {}).filter((k) => inputs[k] === true);
  return ticked.length ? `manual run, ticked: ${ticked.map((k) => md(k, 30)).join(", ")}` : "manual run, nothing ticked → all parts";
}

// Mirrors SYNC_ALL in the workflow: a part runs on a schedule, on a manual run
// with no part ticked, or when it was ticked.
function selectedParts(event, inputs) {
  if (event !== "workflow_dispatch") return new Set(PARTS.map((p) => p.id));
  const ticked = PARTS.filter((p) => inputs?.[p.id] === true).map((p) => p.id);
  return new Set(ticked.length ? ticked : PARTS.map((p) => p.id));
}

function partRow(r, outcome, selected, log) {
  const src = r.part.source?.(r.after);
  const via = src ? ` (${md(src, 20)})` : "";
  const what = r.kind === "content" ? `**changed**${via}`
    : r.kind === "provenance" ? `provenance only (${describeStamps(r.stamps)})`
    : `no change${via}`;
  if (outcome === "success") return `✅ ${what}`;
  if (outcome === "failure") {
    const err = lastError(log);
    const why = err ? `failed: ${md(err, 160)}` : "failed (no ✗ line in its log)";
    if (r.kind === "none") return `❌ ${why} · kept the committed snapshot (last changed ${dateOnly(r.before?.fetchedAt)})`;
    return `❌ ${why} · wrote its snapshot anyway: ${what}`;
  }
  if (!selected) return "— not selected";
  return `— did not run${outcome ? ` (${md(outcome, 20)})` : ""}`;
}

function referenceLine(results) {
  const ref = results.find((r) => r.part === REFERENCE);
  if (!ref) return null;
  let what = "unchanged";
  if (ref.kind === "provenance") what = `provenance only (${describeStamps(ref.stamps)})`;
  if (ref.kind === "content") {
    const moved = (id) => results.find((r) => r.part.id === id)?.kind === "content";
    const from = [moved("pvp") && "the PvP snapshot", moved("game-master-watch") && "the game-master watch"].filter(Boolean);
    what = from.length ? `regenerated from ${from.join(" and ")}` : "regenerated";
  }
  return `Skill reference (META.md, pvp-meta.json): ${what}.`;
}

function formatWhen(now) {
  const d = new Date(now);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

// ctx: { results, outcomes: {id: outcome}, validate, commit, commitSha, event,
// inputs, repoUrl, ref, logs: {id|"validate": text}, now }
export function renderSummary(ctx) {
  const { results, outcomes = {}, logs = {}, now = Date.now() } = ctx;
  const out = [];
  const selected = selectedParts(ctx.event, ctx.inputs);
  const partResults = results.filter((r) => r.part !== REFERENCE);

  out.push(`## Sync data · ${formatWhen(now)} · ${triggerText(ctx.event, ctx.inputs)}`);

  const ran = PARTS.filter((p) => ["success", "failure"].includes(outcomes[p.id]));
  const failed = PARTS.filter((p) => outcomes[p.id] === "failure");
  const changed = partResults.filter((r) => r.kind === "content").length;
  const prov = partResults.filter((r) => r.kind === "provenance").length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const scopeText = ran.length === PARTS.length ? "" : "selected ";
  const ranText = failed.length
    ? `❌ ${failed.length} of ${plural(ran.length, `${scopeText}part`, `${scopeText}parts`)} failed`
    : `✅ All ${plural(ran.length, `${scopeText}part`, `${scopeText}parts`)} ran`;
  const moved = [changed && plural(changed, "snapshot changed", "snapshots changed"), prov && `${prov} provenance only`]
    .filter(Boolean).join(", ") || "no snapshot changes";
  const anyMoved = results.some((r) => r.kind !== "none");
  let heldBack = false;
  if (ctx.validate === "failure") {
    heldBack = true;
    out.push(`⛔ Held back because validation failed, nothing pushed · ${ranText.replace(/^\S+ /, "")} · ${moved}`);
  } else if (ctx.validate !== "success" && ctx.validate !== undefined) {
    heldBack = true;
    out.push(`⛔ Held back because a step before validation failed, nothing pushed · ${ranText.replace(/^\S+ /, "")}`);
  } else if (ctx.commitSha) {
    const sha = md(ctx.commitSha.slice(0, 7), 7);
    const link = ctx.repoUrl ? `[\`${sha}\`](${ctx.repoUrl}/commit/${encodeURIComponent(ctx.commitSha)})` : `\`${sha}\``;
    out.push(`${ranText} · ${moved} · pushed ${link} to ${md(ctx.ref || "main", 40)}`);
  } else if (ctx.commit === "failure") {
    out.push(`❌ ${ranText.replace(/^\S+ /, "")} · ${moved} · the commit or push failed, nothing landed (see "Commit + push")`);
  } else if (!anyMoved) {
    out.push(`${ranText} · no snapshot changes, nothing to push`);
  } else {
    out.push(`${ranText} · ${moved} · not pushed`);
  }
  out.push("");

  out.push("| Part | Result |", "|---|---|");
  for (const r of partResults) {
    let row;
    try { row = partRow(r, outcomes[r.part.id], selected.has(r.part.id), logs[r.part.id]); }
    catch { row = { content: "**changed**", provenance: "provenance only", none: "no change" }[r.kind]; }
    out.push(`| ${r.part.label} | ${row} |`);
  }
  out.push("");
  try {
    const line = referenceLine(results);
    if (line) out.push(line, "");
  } catch { /* the table already says what moved */ }

  // Layer B. A renderer that throws, or finds nothing it knows how to name,
  // leaves the part with its table row.
  const sections = [];
  let shownUnresolved = new Set();
  for (const r of partResults) {
    const render = RENDERERS[r.part.id];
    if (!render || r.kind !== "content") continue;
    try {
      const s = render(r.before, r.after, now);
      if (s.shownUnresolved) shownUnresolved = s.shownUnresolved;
      if (s.lines.length) sections.push([s.title, ...s.lines].join("\n"));
    } catch { /* layer-A row stands */ }
  }
  if (sections.length) {
    if (heldBack) out.push("Not pushed. This is what would have landed:", "");
    out.push(sections.join("\n\n"), "");
  }

  try {
    const up = upstreamLine(results, now);
    if (up) out.push(up, "");
  } catch { /* optional */ }

  try {
    const skip = (id, line) => id === "events" && [...shownUnresolved].some((t) => line.includes(`"${t}": unresolved spawns`));
    const warnings = collectWarnings(logs, skip);
    if (warnings.length) {
      const shown = capList(warnings, 40);
      out.push(`<details><summary>${plural(warnings.length, "other warning", "other warnings")}</summary>`, "");
      out.push(...shown.map((w) => `- ${w}`));
      out.push("</details>", "");
    }
  } catch { /* optional */ }

  return `${out.join("\n").trimEnd()}\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

// --name value pairs; nothing here takes a bare flag.
function args(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument "${argv[i]}"`);
    opts[argv[i].slice(2)] = argv[i + 1];
  }
  return opts;
}

// git show <base>:<path>, or null when the path does not exist at that commit.
export function gitReader(root, base) {
  return {
    base(path) {
      try {
        return execFileSync("git", ["show", `${base}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 256e6, stdio: ["ignore", "pipe", "ignore"] });
      } catch { return null; }
    },
    head(path) {
      const p = join(root, path);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    },
  };
}

// "raids=success rocket-lineups=skipped ..." as the workflow's OUTCOMES env.
export function parseOutcomes(text) {
  return Object.fromEntries(String(text ?? "").split(/\s+/).filter(Boolean).map((kv) => {
    const i = kv.indexOf("=");
    return [kv.slice(0, i), kv.slice(i + 1)];
  }));
}

// Writes <out>/commit-message.txt and <out>/commit-paths.txt (one path per
// line), both empty when nothing moved, and returns the message text.
export function classifyCli(argv) {
  const opts = args(argv);
  if (!opts.out) throw new Error("classify needs --out <dir>");
  const root = resolve(opts.root ?? process.cwd());
  const msg = commitMessage(classifyAll(gitReader(root, opts.base ?? "HEAD")));
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "commit-paths.txt"), msg ? `${msg.paths.join("\n")}\n` : "");
  writeFileSync(join(opts.out, "commit-message.txt"), msg ? msg.text : "");
  return msg ? msg.text : "No snapshot changes.\n";
}

// The rest of the run's state comes from the env the workflow step sets:
// OUTCOMES, VALIDATE, COMMIT, COMMIT_SHA, INPUTS and GitHub's own GITHUB_*.
export function renderCli(argv, env = process.env) {
  const opts = args(argv);
  const root = resolve(opts.root ?? process.cwd());
  const logs = {};
  if (opts.logs) {
    for (const id of [...PARTS.map((p) => p.id), "validate"]) {
      const p = join(opts.logs, `${id}.log`);
      if (existsSync(p)) logs[id] = readFileSync(p, "utf8");
    }
  }
  let inputs = {};
  try { inputs = JSON.parse(env.INPUTS || "{}") ?? {}; } catch { /* read as nothing ticked */ }
  return renderSummary({
    results: classifyAll(gitReader(root, opts.base ?? "HEAD")),
    outcomes: parseOutcomes(env.OUTCOMES),
    validate: env.VALIDATE,
    commit: env.COMMIT,
    commitSha: env.COMMIT_SHA,
    event: env.GITHUB_EVENT_NAME,
    inputs,
    repoUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : null,
    ref: env.GITHUB_REF_NAME,
    logs,
    now: opts.now ? Date.parse(opts.now) : Date.now(),
  });
}

// vite-node hands a script its arguments but not its own path, so the usual
// `argv[1] === this file` guard cannot tell "run" from "imported". The mode
// decides instead: the workflow always names one, and
// scripts/check-sync-summary.mjs imports this with no arguments at all.
const CLI = { classify: classifyCli, render: renderCli };
const mode = process.argv[2];
if (CLI[mode]) {
  try {
    process.stdout.write(CLI[mode](process.argv.slice(3)));
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
