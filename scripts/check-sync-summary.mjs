// Offline checks for scripts/sync-summary.mjs and scripts/lib/stamp-only.mjs:
// the data commit's message.
// Run with: npx vite-node scripts/check-sync-summary.mjs
//
// It only runs inside the daily sync, against a working tree nothing in CI
// sees, so every case here is a synthetic mutation of the current snapshots,
// and each assertion is relative to whatever those snapshots hold today. The
// real working tree is only read: the git cases run in a throwaway repository
// under the OS temp directory.
//
// Covers:
//   Y1 — stamp-only: stripping, moved stamps, the three verdicts, missing files
//   Y2 — the commit message: subject scopes, provenance-only lines, the
//        stamps-only subject, one line per new game-master history entry
//   Y3 — classify end to end in a temp git repo, a file missing from HEAD

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChecker } from "./lib/check.mjs";
import { classifyChange, movedStamps, namedStamps, stripStamps } from "./lib/stamp-only.mjs";
import { PARTS, REFERENCE, classifyAll, classifyCli, commitMessage, newHistory } from "./sync-summary.mjs";

const { check, done } = createChecker();
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

// Mutations used across sections.
const pvpDoc = json(P.pvp);
const great = pvpDoc.leagues.great.species;
const pvpMutated = structuredClone(pvpDoc);
pvpMutated.leagues.great.species = great.slice(1);

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
console.log("Y1 — stamp-only: stripping, moved stamps, verdicts");
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
console.log("\nY2 — the commit message");
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

  const fresh = commitMessage(classifyAll(memReader({ ...CURRENT, [P.events]: undefined }, CURRENT)));
  check("a file missing from the base is a content change", fresh?.subject === "chore(data): sync events", fresh?.subject);
}

// ─── Y3 ──────────────────────────────────────────────────────────────────────
console.log("\nY3 — classify end to end in a temp git repo");
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

done("All sync-summary checks passed.", (n) => `${n} sync-summary check(s) failed.`);
