// Offline checks for scripts/sync-summary.mjs and scripts/lib/stamp-only.mjs:
// the data commit's message and the sync job's summary.
// Run with: npx vite-node scripts/check-sync-summary.mjs
//
// Both only run inside the daily sync, against a working tree nothing in CI
// sees, so every case here is a synthetic mutation of the current snapshots,
// and each assertion is relative to whatever those snapshots hold today. The
// real working tree is only read: the git cases run in a throwaway repository
// under the OS temp directory.
//
// Covers:
//   Y1  stamp-only stripping, moved stamps, the three verdicts, missing files
//   Y2  the commit message (subject scopes, provenance-only lines, the
//       stamps-only subject, one line per new game-master history entry)
//   Y3  classify end to end in a temp git repo, a file missing from HEAD
//   Y4  the layer-B renderers for PvP, events, raids and the game-master watch
//   Y5  layer A (header, verdicts, rows, held back, failed steps, warnings,
//       escaping, and the fallback when a renderer throws)
//   Y6  render end to end in a temp git repo, with step logs on disk

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pokemonNameFor, POKEMON_NAMES_DICT } from "../src/data/species.js";
import { createChecker } from "./lib/check.mjs";
import { classifyChange, movedStamps, namedStamps, stripStamps } from "./lib/stamp-only.mjs";
import {
  PARTS,
  REFERENCE,
  classifyAll,
  classifyCli,
  commitMessage,
  md,
  newHistory,
  parseOutcomes,
  renderCli,
  renderEvents,
  renderPvp,
  renderRaids,
  renderSummary,
  renderWatch,
} from "./sync-summary.mjs";

const { check, done } = createChecker();
// For details too long to print on every passing run.
const checkQuiet = (label, cond, detail = "") => check(label, cond, cond ? "" : detail);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─── Fixtures: today's snapshots, as text, and helpers to mutate them ────────

const TRACKED = [...PARTS, REFERENCE].flatMap((p) => p.paths);
const CURRENT = Object.fromEntries(TRACKED.map((p) => [p, readFileSync(join(ROOT, p), "utf8")]));
const json = (path) => JSON.parse(CURRENT[path]);
const text = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
const P = Object.fromEntries([...PARTS, REFERENCE].map((p) => [p.id, p.paths[0]]));

// A reader over two in-memory trees; a path missing from a tree reads as null.
function memReader(base, head) {
  return { base: (p) => base[p] ?? null, head: (p) => head[p] ?? null };
}
// The current snapshots as the base, with `changes` (path → doc, text or null)
// applied to the head.
function mutated(changes, base = CURRENT) {
  const head = { ...base };
  for (const [p, v] of Object.entries(changes)) {
    if (v === null) delete head[p];
    else head[p] = typeof v === "string" ? v : text(v);
  }
  return memReader(base, head);
}
const kindOf = (results, id) => results.find((r) => r.part.id === id)?.kind;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const enName = (dex) => cap(pokemonNameFor(String(dex), "en"));

// A dex that resolves to a name and is in none of `lists`.
function freshDex(...lists) {
  const used = new Set(lists.flat().map(Number));
  return Number(Object.keys(POKEMON_NAMES_DICT).find((k) => /^\d+$/.test(k) && !used.has(Number(k)) && Number(k) > 150));
}

const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse("2026-10-13T12:54:49Z");
const DAY = 86400000;

// Mutations used across sections.
const pvpDoc = json(P.pvp);
const great = pvpDoc.leagues.great.species;
const greatLeaver = great[0];
const greatEntrant = freshDex(great.map((s) => s.dex));
const pvpMutated = structuredClone(pvpDoc);
pvpMutated.leagues.great.species = [...great.slice(1), { dex: greatEntrant, name: "x", speciesId: "x", score: 1, forms: ["x"] }];

const metaDoc = json(P.meta);
const metaStampOnly = structuredClone(metaDoc);
metaStampOnly.fetchedAt = "2099-01-02T03:04:05.000Z";
metaStampOnly.sources.rosterBatch = "2099-01-02 03:04:05";

const watchDoc = json(P["game-master-watch"]);
const AT = "2099-01-01T12:00:00.000Z";
const watchWithHistory = structuredClone(watchDoc);
watchWithHistory.fetchedAt = AT;
watchWithHistory.history = [
  { at: AT, stream: "pve", summary: "1 move(s) changed", changes: [{ move: "V0013_MOVE_WRAP", field: "power", from: 60, to: 70 }] },
  { at: AT, stream: "pvp", summary: "2 move(s) changed", changes: [
    { move: "AIR_CUTTER", field: "power", from: 45, to: 60 },
    { move: "BRAND_NEW_MOVE", field: "*", from: null, to: "added" },
  ] },
  ...(watchDoc.history ?? []),
];

// ─── Y1 ──────────────────────────────────────────────────────────────────────
console.log("Y1: stamp-only stripping, moved stamps, verdicts");
{
  const stripped = stripStamps(metaDoc);
  check("strips fetchedAt and gameMasterTimestamp", !("fetchedAt" in stripped) && !("gameMasterTimestamp" in stripped));
  check("strips every sources.*Batch", !Object.keys(stripped.sources ?? {}).some((k) => k.endsWith("Batch")));
  check("keeps the mirror names", stripped.sources?.mechanics === metaDoc.sources?.mechanics);
  check("leaves the input untouched", "fetchedAt" in metaDoc);
  check("strips the reference's gameMasterWatch.checkedAt", !("checkedAt" in (stripStamps(json(P.reference)).gameMasterWatch ?? {})));

  const same = classifyChange(CURRENT[P.meta], CURRENT[P.meta]);
  check("identical text → none", same.kind === "none");
  check("reformatted, same content → none", classifyChange(CURRENT[P.meta], JSON.stringify(metaDoc)).kind === "none");

  const prov = classifyChange(CURRENT[P.meta], text(metaStampOnly));
  check("roster stamp + fetchedAt → provenance", prov.kind === "provenance", prov.kind);
  check("names rosterBatch, not the quiet fetchedAt",
    namedStamps(prov.stamps).map((s) => s.key).join() === "rosterBatch", namedStamps(prov.stamps).map((s) => s.key).join());

  const content = structuredClone(metaStampOnly);
  content.topAttackers = [...content.topAttackers].reverse();
  check("a stamp plus a content field → content", classifyChange(CURRENT[P.meta], text(content)).kind === "content");

  const quotes = json(P["rocket-quotes"]);
  quotes.sources.enKeys = (quotes.sources.enKeys ?? 0) + 1;
  check("grunt quotes enKeys only → provenance", classifyChange(CURRENT[P["rocket-quotes"]], text(quotes)).kind === "provenance");

  const ref = json(P.reference);
  ref.generatedAt = AT;
  if (ref.gameMasterWatch) ref.gameMasterWatch.checkedAt = AT;
  const refC = classifyChange(CURRENT[P.reference], text(ref));
  check("reference generatedAt + checkedAt → provenance", refC.kind === "provenance", refC.kind);
  check("only generatedAt moved → names the quiet stamp",
    namedStamps(movedStamps({ generatedAt: "a", x: 1 }, { generatedAt: "b", x: 1 })).map((s) => s.key).join() === "generatedAt");

  check("missing from the base → content", classifyChange(null, CURRENT[P.meta]).kind === "content");
  check("deleted from the working tree → content", classifyChange(CURRENT[P.meta], null).kind === "content");
  check("both missing → none", classifyChange(null, null).kind === "none");
  check("non-JSON change (META.md) → content", classifyChange("# a\n", "# b\n").kind === "content");
}

// ─── Y2 ──────────────────────────────────────────────────────────────────────
console.log("\nY2: the commit message");
{
  check("nothing moved → no commit", commitMessage(classifyAll(memReader(CURRENT, CURRENT))) === null);

  const mixed = commitMessage(classifyAll(mutated({ [P.pvp]: pvpMutated, [P.meta]: metaStampOnly })));
  check("subject names only the content change", mixed?.subject === "chore(data): sync pvp", mixed?.subject);
  check("pvp line names the snapshot's source", mixed?.body.includes(`- pvp: ranking snapshot from ${pvpDoc.source}`));
  check("provenance-only part keeps a body line", mixed?.body.includes("- meta: provenance only (rosterBatch)"), mixed?.body.join(" / "));
  check("provenance-only file is still committed", mixed?.paths.includes(P.meta) && mixed?.paths.includes(P.pvp));
  check("text is subject, blank line, body", mixed?.text.startsWith("chore(data): sync pvp\n\n- pvp: "));

  const species = json(P["species-meta"]);
  species.sources.gameMasterBatch = AT;
  species.fetchedAt = AT;
  const watchStamp = structuredClone(watchDoc);
  watchStamp.sources.pveBatch = AT;
  watchStamp.fetchedAt = AT;
  const stamps = commitMessage(classifyAll(mutated({ [P["species-meta"]]: species, [P["game-master-watch"]]: watchStamp })));
  check("stamps only → refresh subject", stamps?.subject === "chore(data): refresh provenance stamps", stamps?.subject);
  check("…with one line per part", stamps?.body.join("|") === "- species-meta: provenance only (gameMasterBatch)|- game-master: provenance only (pveBatch)",
    stamps?.body.join("|"));

  const lineups = json(P["rocket-lineups"]);
  lineups.trainers = lineups.trainers.slice(1);
  const quotes = json(P["rocket-quotes"]);
  quotes.typed = { ...quotes.typed, zz: { en: "test" } };
  const rocket = commitMessage(classifyAll(mutated({ [P["rocket-lineups"]]: lineups, [P["rocket-quotes"]]: quotes })));
  check("two parts sharing a scope name it once", rocket?.subject === "chore(data): sync rocket", rocket?.subject);
  check("…with a body line each", rocket?.body.length === 2 && rocket.body[1] === "- rocket: grunt quotes from holoholo-text");

  const watch = commitMessage(classifyAll(mutated({ [P["game-master-watch"]]: watchWithHistory })));
  check("new history entries → one line each, with stream",
    watch?.body.join("|") === "- game-master: pve 1 move(s) changed|- game-master: pvp 2 move(s) changed", watch?.body.join("|"));
  check("history entries sharing a timestamp are both new", newHistory(watchDoc, watchWithHistory).length === 2);

  const moves = structuredClone(watchDoc);
  moves.moves = { ...moves.moves, ZZ_TEST: { power: 1 } };
  const plain = commitMessage(classifyAll(mutated({ [P["game-master-watch"]]: moves })));
  check("content change with no new history → move stats", plain?.body.join() === "- game-master: move stats", plain?.body.join());

  // classify runs inside the commit step: a malformed history must cost the
  // line its detail, not the day's commit.
  for (const [label, history] of [["an object", {}], ["a string", "x"], ["null entries", [null, 1]]]) {
    const bad = structuredClone(moves);
    bad.history = history;
    let msg;
    try { msg = commitMessage(classifyAll(mutated({ [P["game-master-watch"]]: bad }))); } catch (e) { msg = { body: [`threw: ${e.message}`] }; }
    check(`history as ${label} → move stats, no throw`, msg?.body.join() === "- game-master: move stats", msg?.body.join());
  }

  const fresh = commitMessage(classifyAll(memReader({ ...CURRENT, [P.events]: undefined }, CURRENT)));
  check("a file missing from the base is a content change", fresh?.subject === "chore(data): sync events", fresh?.subject);
}

// ─── Y3 ──────────────────────────────────────────────────────────────────────
console.log("\nY3: classify end to end in a temp git repo");
const TMP = mkdtempSync(join(tmpdir(), "sync-summary-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.invalid", ...args],
  { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// A repo holding today's snapshots except events.json, which only exists in
// the working tree: a file missing from HEAD.
function tempRepo(name) {
  const dir = join(TMP, name);
  for (const p of TRACKED) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), CURRENT[p]);
  }
  git(dir, "init", "-q");
  git(dir, "add", "--", ...TRACKED.filter((p) => p !== P.events));
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}
{
  const dir = tempRepo("classify");
  writeFileSync(join(dir, P.pvp), text(pvpMutated));
  writeFileSync(join(dir, P.meta), text(metaStampOnly));
  const out = join(TMP, "classify-out");
  const printed = classifyCli(["--root", dir, "--base", "HEAD", "--out", out]);
  const paths = readFileSync(join(out, "commit-paths.txt"), "utf8").trim().split("\n");
  const message = readFileSync(join(out, "commit-message.txt"), "utf8");
  check("commit-paths lists every moved file", [P.pvp, P.meta, P.events].every((p) => paths.includes(p)), paths.join(" "));
  check("…and nothing that did not move", paths.length === 3, String(paths.length));
  check("events.json, missing from HEAD, reaches the subject", message.startsWith("chore(data): sync pvp, events\n"), message.split("\n")[0]);
  check("printed text is the message", printed === message);

  const clean = tempRepo("clean");
  const out2 = join(TMP, "clean-out");
  git(clean, "add", "--", P.events);
  git(clean, "commit", "-q", "-m", "events");
  classifyCli(["--root", clean, "--base", "HEAD", "--out", out2]);
  check("nothing moved → both files empty",
    readFileSync(join(out2, "commit-paths.txt"), "utf8") === "" && readFileSync(join(out2, "commit-message.txt"), "utf8") === "");

  // Once through the real entry point, as the workflow calls it: vite-node
  // passes no script path, so the mode is what makes it run.
  const out3 = join(TMP, "cli-out");
  const cli = execFileSync(join(ROOT, "node_modules/.bin/vite-node"),
    [join(ROOT, "scripts/sync-summary.mjs"), "classify", "--root", dir, "--base", "HEAD", "--out", out3],
    { cwd: ROOT, encoding: "utf8" });
  check("the CLI runs classify and prints the message", cli.startsWith("chore(data): sync pvp, events"), cli.split("\n")[0]);
}

// ─── Y4 ──────────────────────────────────────────────────────────────────────
console.log("\nY4: the layer-B renderers");
{
  const pvp = renderPvp(pvpDoc, pvpMutated);
  const greatLine = pvp.lines.find((l) => l.startsWith("- Great: ")) ?? "";
  check("PvP entrant named via pokemonNameFor with its rank", greatLine.includes(`+${enName(greatEntrant)} (#${great.length})`), greatLine);
  check("PvP leaver with its old rank", greatLine.includes(`−${enName(greatLeaver.dex)} (was #1)`), greatLine);
  check("other leagues and cups listed as unchanged", pvp.lines.some((l) => l.includes("unchanged: ") && l.includes("Ultra")));
  check("title carries source and depth", pvp.title === `**PvP** (${pvpDoc.source}, top ${pvpDoc.topN})`, pvp.title);

  const reordered = structuredClone(pvpDoc);
  const u = reordered.leagues.ultra.species;
  [u[0], u[1]] = [u[1], u[0]];
  check("swapped ranks → reordered only", renderPvp(pvpDoc, reordered).lines.some((l) => l.includes("reordered only: Ultra")));

  const switched = structuredClone(pvpDoc);
  switched.source = "lily-dex";
  check("source change in the title", renderPvp(pvpDoc, switched).title.includes(`${pvpDoc.source} → lily-dex`));

  const many = structuredClone(pvpDoc);
  const extra = [];
  for (let i = 0; i < 6; i++) extra.push(freshDex(great.map((s) => s.dex), extra));
  many.leagues.great.species = [...great.slice(0, -6), ...extra.map((dex) => ({ dex, name: "x" }))];
  check("long lists are capped", renderPvp(pvpDoc, many).lines.some((l) => l.includes("+2 more")));

  const gbl = structuredClone(pvpDoc);
  gbl.gblEvents = [...(gbl.gblEvents ?? []), { eventID: "zz-test", name: "Test Cup | <b>", start: "2099-10-20T20:00:00.000Z", end: "2099-10-27T20:00:00.000Z", cups: [], leagues: ["great"] }];
  const gblLine = renderPvp(pvpDoc, gbl).lines.find((l) => l.startsWith("- GBL: ")) ?? "";
  check("new GBL window, name escaped", gblLine === "- GBL: +Test Cup \\| \\<b\\> (10-20 → 10-27)", gblLine);

  // Events: two synthetic events on top of today's snapshot, one ended a week
  // ago and one running, so the case holds whatever the feed shows today.
  const evBase = json(P.events);
  const [d1, d2, d3] = [freshDex(), freshDex([freshDex()]), freshDex([freshDex(), freshDex([freshDex()])])];
  const ended = { id: "zz-ended", title: "Ended Event", start: iso(NOW - 10 * DAY), end: iso(NOW - 7 * DAY), spawnDex: [d1], spawns: [], unresolved: [] };
  const running = { id: "zz-running", title: "Running Event", start: iso(NOW - DAY), end: iso(NOW + DAY), spawnDex: [d1], spawns: [], unresolved: [] };
  const withdrawn = { id: "zz-withdrawn", title: "Withdrawn Event", start: iso(NOW + 2 * DAY), end: iso(NOW + 4 * DAY), spawnDex: [d1], spawns: [], unresolved: [] };
  evBase.events = [...evBase.events, ended, running, withdrawn];
  const evHead = structuredClone(evBase);
  evHead.events = evHead.events.filter((e) => !["zz-ended", "zz-withdrawn"].includes(e.id));
  evHead.events.find((e) => e.id === "zz-running").spawnDex = [d1, d2];
  evHead.events.push({ id: "zz-new", title: "New *Event*", start: "2099-10-27T10:00:00", end: "2099-11-01T10:00:00", spawnDex: [d3], spawns: [], unresolved: ["Pikachu | wearing <a hat>"] });
  const ev = renderEvents(evBase, evHead, NOW);
  const evText = ev.lines.join("\n");
  checkQuiet("new event with window and pokemonNameFor spawns",
    ev.lines.some((l) => l.startsWith(`- new: New \\*Event\\* (10-27 → 11-01): ${enName(d3)}`)), evText);
  checkQuiet("unresolved count, names escaped", evText.includes('⚠ 1 unresolved: "Pikachu \\| wearing \\<a hat\\>"'), evText);
  check("…and reported back for the warning fold", ev.shownUnresolved.has("New *Event*"));
  checkQuiet("changed spawns", evText.includes(`- Running Event: +${enName(d2)}`), evText);
  checkQuiet("aged out with its end date", evText.includes(`- aged out (ended ${iso(NOW - 7 * DAY).slice(5, 10)}): Ended Event`), evText);
  checkQuiet("withdrawn before ending is not called aged out", evText.includes("- dropped by the feed before ending: Withdrawn Event"), evText);
  check("new events come first", ev.lines[0].startsWith("- new: "));

  // Raids: a synthetic boss swap in one tier and a new event raid.
  const boss = (id, en) => ({ id, names: { en }, types: ["normal"], resistorTypes: [], seMoveTypes: [] });
  const rBase = json(P.raids);
  rBase.raids = { ...rBase.raids, zz_tier: [boss("ZZ_OLD", "Oldmon")] };
  const rHead = structuredClone(rBase);
  rHead.raids.zz_tier = [boss("ZZ_NEW", "Newmon")];
  rHead.eventRaids = [...(rHead.eventRaids ?? []), { eventID: "zz-raid", name: "Newmon in 5-star Raid Battles", start: "2099-10-14T06:00:00.000", end: "2099-10-20T22:00:00.000", bosses: [boss("ZZ_NEW", "Newmon")] }];
  const raids = renderRaids(rBase, rHead).lines;
  checkQuiet("raid tier swap with the snapshot's own names", raids.includes("- zz\\_tier: +Newmon · −Oldmon"), raids.join(" / "));
  checkQuiet("new event raid", raids.includes("- event raids: +Newmon in 5-star Raid Battles (10-14 → 10-20)"), raids.join(" / "));
  check("untouched tiers are not listed", raids.length === 2, String(raids.length));

  const watch = renderWatch(watchDoc, watchWithHistory).lines;
  check("one line per new history entry", watch.length === 2, String(watch.length));
  check("stream, date, summary and changes",
    watch[1] === "- pvp 2099-01-01: 2 move(s) changed (AIR\\_CUTTER power 45→60, BRAND\\_NEW\\_MOVE added)", watch[1]);
}

// ─── Y5 ──────────────────────────────────────────────────────────────────────
console.log("\nY5: layer A (header, verdicts, rows, warnings)");
{
  const ALL = Object.fromEntries(PARTS.map((p) => [p.id, "success"]));
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const base = {
    outcomes: ALL, validate: "success", commit: "success", push: "success", commitSha: SHA, event: "schedule", inputs: {},
    repoUrl: "https://github.com/owner/repo", ref: "main", logs: {}, now: NOW,
  };
  const results = classifyAll(mutated({ [P.pvp]: pvpMutated, [P.meta]: metaStampOnly, [P.events]: null }));
  check("a file deleted from the working tree is a change", kindOf(results, "events") === "content");
  const resultsPvpMeta = classifyAll(mutated({ [P.pvp]: pvpMutated, [P.meta]: metaStampOnly }));
  const s = renderSummary({ ...base, results: resultsPvpMeta });
  const lines = s.split("\n");
  check("header names the trigger", lines[0] === "## Sync data · 13 Oct 12:54 UTC · scheduled run", lines[0]);
  check("verdict: all ran, counts, commit link",
    lines[1] === `✅ All 9 parts ran · 1 snapshot changed, 1 provenance only · pushed [\`0123456\`](https://github.com/owner/repo/commit/${SHA}) to main`, lines[1]);
  check("changed row with its source", s.includes(`| PvP rankings | ✅ **changed** (${pvpDoc.source}) |`));
  check("provenance row names the stamp and its move",
    s.includes(`| Raid attackers (meta) | ✅ provenance only (PvPoke roster stamp ${String(metaDoc.sources.rosterBatch).slice(5, 10)}`) && s.includes("→ 01-02 03:04) |"));
  check("unchanged row", s.includes("| Raids | ✅ no change |"));
  check("one row per part", PARTS.every((p) => s.includes(`| ${p.label} | `)));
  check("reference line", s.includes("Skill reference (META.md, pvp-meta.json): unchanged."));
  check("PvP section rendered", s.includes(`**PvP** (${pvpDoc.source}`));
  // Today's clock, not NOW: the snapshot's batch moves forward every day.
  const live = renderSummary({ ...base, results: resultsPvpMeta, now: Date.now() });
  check("upstream line: newest batch, its age, the PvP source",
    /^Upstreams: game master .+, batch \d{4}-\d{2}-\d{2} \(\d+ d old\)/m.test(live) && live.includes(`· PvP ${pvpDoc.source}`));

  const manual = renderSummary({ ...base, results: resultsPvpMeta, event: "workflow_dispatch", inputs: { raids: false, pvp: false, translations: false } });
  check("manual, nothing ticked", manual.split("\n")[0].endsWith("· manual run, nothing ticked → all parts"));
  const raidsOnly = { ...Object.fromEntries(PARTS.map((p) => [p.id, "skipped"])), raids: "success" };
  const partial = renderSummary({
    ...base, results: classifyAll(memReader(CURRENT, CURRENT)), commitSha: "", outcomes: raidsOnly,
    event: "workflow_dispatch", inputs: { raids: true, translations: true },
  });
  check("manual with ticks names them", partial.split("\n")[0].endsWith("· manual run, ticked: raids, translations"), partial.split("\n")[0]);
  check("…counts only selected parts, nothing to push", partial.split("\n")[1] === "✅ All 1 selected part ran · no snapshot changes, nothing to push", partial.split("\n")[1]);
  check("…and the rest read not selected", partial.includes("| PvP rankings | ➖ not selected |") && partial.includes("| Raids | ✅ no change |"));

  const failLog = "> npm run fetch-events\n✗ Fetch failed: HTTP 503 from <leak-duck>\nError: boom\n";
  const failed = renderSummary({ ...base, results: resultsPvpMeta, outcomes: { ...ALL, events: "failure" }, logs: { events: failLog } });
  check("failure verdict", failed.split("\n")[1].startsWith("❌ 1 of 9 parts failed · "), failed.split("\n")[1]);
  check("failed row: last ✗ line, escaped, and the kept snapshot",
    failed.includes(`| Events | ❌ failed: Fetch failed: HTTP 503 from \\<leak-duck\\> · kept the committed snapshot (last changed ${json(P.events).fetchedAt.slice(0, 10)}) |`));
  const timedOut = renderSummary({ ...base, results: resultsPvpMeta, outcomes: { ...ALL, raids: "failure" }, logs: { raids: "> fetching\n" } });
  check("failed row with no ✗ line says so", timedOut.includes("| Raids | ❌ failed (no ✗ line in its log) · kept the committed snapshot"));
  const wrote = renderSummary({ ...base, results: resultsPvpMeta, outcomes: { ...ALL, pvp: "failure" }, logs: { pvp: "✗ takeover read failed\n" } });
  check("a failed step that still wrote its snapshot says so", wrote.includes("| PvP rankings | ❌ failed: takeover read failed · wrote its snapshot anyway: **changed**"));

  const held = renderSummary({ ...base, results: resultsPvpMeta, validate: "failure", commit: "skipped", push: "skipped", commitSha: "" });
  check("held back when validation failed", held.split("\n")[1].startsWith("⛔ Held back because validation failed, nothing pushed · All 9 parts ran · 1 snapshot changed"), held.split("\n")[1]);
  check("…shows what would have landed", held.includes("Not pushed. This is what would have landed:") && held.includes("**PvP**"));
  check("…and links no commit", !held.includes("/commit/"));
  const commitFail = renderSummary({ ...base, results: resultsPvpMeta, commit: "failure", push: "skipped", commitSha: "" });
  check("commit failure names the commit step",
    commitFail.split("\n")[1].includes('the commit failed, nothing landed (see "Commit the snapshots that moved")'), commitFail.split("\n")[1]);
  // The workflow folds a failed mint into PUSH: no token, no push.
  const pushFail = renderSummary({ ...base, results: resultsPvpMeta, commit: "success", push: "failure", commitSha: "" });
  check("push failure says it was committed but not pushed",
    pushFail.split("\n")[1].includes("committed but not pushed, nothing landed"), pushFail.split("\n")[1]);

  // Warnings: fetcher ⚠ lines and validation "!" lines, folded and escaped;
  // the events line about a new event's unresolved names is already shown.
  const evBase = json(P.events);
  const evHead = structuredClone(evBase);
  evHead.events = [...evHead.events, { id: "zz-new", title: "Zz Event", start: "2099-10-27T10:00:00", end: "2099-11-01T10:00:00", spawnDex: [], spawns: [], unresolved: ["Zubat wearing a top hat"] }];
  const logs = {
    raids: '  ⚠ event "X": cannot resolve boss "Y" — skipped\n',
    events: '  ⚠ "Zz Event": unresolved spawns — Zubat wearing a top hat\n  ⚠ "Other": unresolved spawns — <script>\n',
    validate: "D5 — filter families that are entirely empty\n  ! maxBattleFilters is empty — check raid-bosses.json maxBattles ({})\nD6 — next\n  ✓ fine\n",
  };
  const warned = renderSummary({ ...base, results: classifyAll(mutated({ [P.events]: evHead })), logs });
  checkQuiet("warnings folded with a count", warned.includes("<details><summary>3 other warnings</summary>"), warned);
  check("fetcher warning, dash read as a comma", warned.includes('- raids: event "X": cannot resolve boss "Y", skipped'));
  check("validate warning carries its section", warned.includes("- validate (D5): maxBattleFilters is empty, check raid-bosses.json maxBattles ({})"));
  check("upstream text escaped inside <details>", warned.includes('- events: "Other": unresolved spawns, \\<script\\>'));
  check("a warning the events section already shows is not repeated", !warned.includes('"Zz Event": unresolved spawns'));
  check("no warnings → no <details>", !s.includes("<details>"));

  // A snapshot whose shape moved: the renderer throws, the row stands.
  const broken = structuredClone(pvpDoc);
  broken.leagues.great.species = "not a list";
  let fallback = "";
  try { fallback = renderSummary({ ...base, results: classifyAll(mutated({ [P.pvp]: broken })) }); } catch (e) { fallback = `threw: ${e.message}`; }
  checkQuiet("a throwing renderer keeps its layer-A row", fallback.includes(`| PvP rankings | ✅ **changed** (${pvpDoc.source}) |`), fallback.slice(0, 80));
  check("…and drops only its section", !fallback.includes("**PvP**"));

  check("md escapes markup and flattens newlines", md("a|b*c_d<e>[f]`g\\h\ni") === "a\\|b\\*c\\_d\\<e\\>\\[f\\]\\`g\\\\h i", md("a|b*c_d<e>[f]`g\\h\ni"));
  check("md caps length", md("x".repeat(300), 50) === `${"x".repeat(49)}…`);
  check("parseOutcomes reads the OUTCOMES env", JSON.stringify(parseOutcomes(" raids=success pvp=\n meta=failure ")) === '{"raids":"success","pvp":"","meta":"failure"}');
}

// ─── Y6 ──────────────────────────────────────────────────────────────────────
console.log("\nY6: render end to end in a temp git repo");
{
  const dir = tempRepo("render");
  const baseSha = git(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, P.pvp), text(pvpMutated));
  // Pushed: the commit exists and the base is the commit before it.
  git(dir, "add", "--", P.pvp);
  git(dir, "commit", "-q", "-m", "sync");
  const logDir = join(TMP, "render-logs");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "regional-forms.log"), "  ⚠ Burmy (412): forms not type-distinguishable — skipped\n");
  writeFileSync(join(logDir, "events.log"), "✗ Fetch failed: timeout\n");
  const env = {
    OUTCOMES: PARTS.map((p) => `${p.id}=${p.id === "events" ? "failure" : "success"}`).join(" "),
    VALIDATE: "success", COMMIT: "success", PUSH: "success", COMMIT_SHA: git(dir, "rev-parse", "HEAD"),
    GITHUB_EVENT_NAME: "workflow_dispatch", INPUTS: "not json",
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_REF_NAME: "main",
  };
  const out = renderCli(["--root", dir, "--base", baseSha, "--logs", logDir, "--now", "2026-10-13T12:54:49Z"], env);
  check("compares against the base, not HEAD", out.includes("| PvP rankings | ✅ **changed**"));
  check("events.json, missing from the base, reads changed", out.includes("| Events | ❌ failed: Fetch failed: timeout · wrote its snapshot anyway: **changed**"));
  check("reads step logs from disk", out.includes("- regional-forms: Burmy (412): forms not type-distinguishable, skipped"));
  check("unparsable INPUTS reads as nothing ticked", out.split("\n")[0].endsWith("manual run, nothing ticked → all parts"));
  check("commit link built from the GitHub env", out.includes(`(https://github.com/o/r/commit/${env.COMMIT_SHA})`));
}

done("All sync-summary checks passed.", (n) => `${n} sync-summary check(s) failed.`);
