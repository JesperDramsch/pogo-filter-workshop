// The Niantic game-master mirrors, and the one fetch that prefers the freshest.
//
// This started life inside fetch-meta-rankings.mjs, which needed PvE move
// mechanics and discovered the hard way that "the game master" is not one feed
// but several mirrors of the same Niantic dump, published at wildly different
// cadences. Three scripts now read it — the raid-attacker ranking, the
// species-meta pools, and the rebalance watch — so the mirror list and the
// preference loop live here rather than in three drifting copies.
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

// Every mirror below serves the same Niantic template array. `parseStamp` maps
// that mirror's own timestamp file to epoch millis; an unreadable stamp costs
// the staleness warning and nothing else, so it is never fatal.
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
    // better than no mechanics at all.
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

// First mirror that answers with a plausible template array wins; the rest are
// pure fallback. Returns { templates, mirror, batchMs, failures } — `failures`
// is the list of mirrors that were tried and rejected, so a caller can say out
// loud that it fell back. Throws only when every mirror failed.
export async function fetchGameMaster({
  userAgent = "pogo-filter-workshop game-master-fetcher/1.0",
  minTemplates = MIN_GAME_MASTER_TEMPLATES,
  mirrors = GAME_MASTER_MIRRORS,
  fetchText = (url) => defaultFetchText(url, userAgent),
} = {}) {
  const failures = [];
  for (const mirror of mirrors) {
    try {
      const [gmText, stampText] = await Promise.all([
        fetchText(mirror.gameMaster),
        fetchText(mirror.timestamp).catch(() => ""),
      ]);
      const parsed = JSON.parse(gmText);
      if (!Array.isArray(parsed) || parsed.length < minTemplates) {
        throw new Error(`parsed as ${Array.isArray(parsed) ? `${parsed.length} templates` : typeof parsed}`);
      }
      let batchMs = null;
      try {
        const ms = mirror.parseStamp(stampText);
        if (Number.isFinite(ms) && ms > 0) batchMs = ms;
      } catch { /* an unreadable stamp only costs the staleness warning */ }
      return { templates: parsed, mirror: mirror.name, batchMs, failures };
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
