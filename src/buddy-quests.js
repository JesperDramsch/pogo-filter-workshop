// "Which quest evolution should come along on this outing?"
//
// src/data/evolution-quests.json (scripts/fetch-evolution-costs.mjs, from the
// game master) lists every evolution gated on a quest: Pancham catching 32
// Dark types, Kubfu beating 30 Dark-type Pokémon in raids, Galarian Slowpoke
// catching Poison or Psychic types. An outing in the Mega planner (an event's
// wild spawns, a raid day or raid hour) moves some of those quests a long way
// and others not at all. This ranks the quests one outing helps, the same way
// the planner ranks Megas for it: the best buddy first, then the others that
// are good too, so a player whose Pancham are all evolved still gets an answer.
//
// What an outing counts for, by quest action:
//   wild outing  catch    a spawn of one of the quest's types
//   raid outing  catch    a boss of one of the types (every win ends in a catch)
//                raid_win a boss of one of the types (Max-only quests excepted:
//                         the planner's raid outings are raids)
//                defeat   a boss of one of the types
// Walking, hearts, treats, throws and Incense do not depend on where you go,
// so no outing ranks them.
//
// Order: share / target, where share is the fraction of the outing's spawns
// or bosses that count. A Community Day of a Dark type (share 1) puts the
// 32-catch Pancham far ahead of four Dark types among fifty spawns, and among
// quests one outing helps equally, the shorter quest wins: fifteen raid wins
// for Bisharp before thirty for Kubfu. Pure functions, no React.

const hits = (types, wanted) => (types || []).some((t) => wanted.includes(t));

// Stable id for a quest row (Kubfu has two quests on one dex).
export const questKey = (q) => `${q.dex}|${q.region ?? ''}|${q.quest}`;

// Does this quest count `form` ({ types }) on an outing of `kind`?
function counts(q, kind) {
	const types = q.types || [];
	if (!types.length) return false;
	if (q.action === 'catch') return true;
	if (kind !== 'raid') return false;
	return q.action === 'raid_win' || q.action === 'defeat';
}

// The quests one outing helps, best first:
// [{ key, quest, matches: [spawnForm…], share }]. `outing` is a Mega planner
// row: { kind: 'wild' | 'raid', spawnForms: [{ dex, region, types }] }.
export function outingBuddyQuests(quests, outing) {
	const pool = outing?.spawnForms || [];
	if (!pool.length) return [];
	const rows = [];
	const seen = new Set();
	for (const q of quests || []) {
		if (!counts(q, outing.kind)) continue;
		const matches = pool.filter((f) => hits(f.types, q.types));
		if (!matches.length) continue;
		const key = questKey(q);
		if (seen.has(key)) continue;
		seen.add(key);
		const share = matches.length / pool.length;
		rows.push({ key, quest: q, matches, share, score: share / Math.max(1, q.target || 1) });
	}
	return rows.sort((a, b) => b.score - a.score || a.quest.target - b.quest.target || a.quest.dex - b.quest.dex);
}
