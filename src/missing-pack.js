// The friend-collect "missing" packs: a handful of species the user still
// lacks as a lucky (or hundo) that no other pack ever suggests.
//
// Pure, so scripts/check-friend-collect.mjs can drive it with plain dex lists.
// The pack is the long tail: species missing on the goal and outside every
// other pack's pool (those packs already ask for theirs). Once the whole goal
// is down to MISSING_PACK_SIZE or fewer, the pack simply offers all of it.
//
// Otherwise the tail is split by buddy candy distance, a loose commonness
// proxy, into 1 / 3 / 5 km queues of MISSING_PACK_SIZE / 3 slots each; 20 km
// only gets slots once those three queues are empty. Within a queue the
// generation with the fewest missing species goes first, then dex order.
//
// Stability: species the user already curated out of the tail stay put and
// count toward their queue's share, so a pack that was added refills one
// slot at a time as luckies land, instead of reshuffling. Free slots go to
// whichever 1/3/5 km queue is furthest below its share (ties to the lower
// distance), which covers both an emptied queue spilling into the others and
// a skewed curated list drifting back toward an even split.

import { generationOf } from '../scripts/lib/generations.mjs';

export const MISSING_PACK_SIZE = 33;
const QUEUE_KM = [1, 3, 5];
const LONG_SHOT_KM = 20;

// Order within one queue: generations with the fewest missing species first
// (ties to the older generation), then dex.
function queueOrder(dexList) {
	const perGen = new Map();
	for (const dex of dexList) {
		const g = generationOf(dex) ?? Infinity;
		perGen.set(g, (perGen.get(g) || 0) + 1);
	}
	const genOf = (dex) => generationOf(dex) ?? Infinity;
	return [...dexList].sort(
		(a, b) => perGen.get(genOf(a)) - perGen.get(genOf(b)) || genOf(a) - genOf(b) || a - b,
	);
}

// missingDex:    every collectible base still missing on the goal.
// otherPackDex:  every species another pack's pool holds (bases included).
// curatedDex:    the user's curated list, as dex.
// kmByDex:       { dex: 1 | 3 | 5 | 20 }.
// Returns the dex to offer, in display order. Curated species never appear.
export function pickMissingPack({ missingDex, otherPackDex, curatedDex, kmByDex, size = MISSING_PACK_SIZE }) {
	const curated = new Set(curatedDex);
	const km = (dex) => kmByDex[dex] ?? kmByDex[String(dex)];
	const byQueue = (list) => {
		const out = new Map([...QUEUE_KM, LONG_SHOT_KM].map((k) => [k, []]));
		for (const dex of list) (out.get(km(dex)) || out.get(LONG_SHOT_KM)).push(dex);
		for (const [k, v] of out) out.set(k, queueOrder(v));
		return out;
	};
	const flatten = (queues) => [...QUEUE_KM, LONG_SHOT_KM].flatMap((k) => queues.get(k));

	const missing = [...new Set(missingDex)];
	if (missing.length <= size) return flatten(byQueue(missing.filter((d) => !curated.has(d))));

	const other = new Set(otherPackDex);
	const tail = missing.filter((d) => !other.has(d));
	const sticky = tail.filter((d) => curated.has(d));
	// Order is decided over the whole tail (sticky included): a generation's
	// count is how much of it is still missing, curated or not.
	const order = byQueue(tail);
	const queues = new Map([...order].map(([k, v]) => [k, v.filter((d) => !curated.has(d))]));

	const share = size / QUEUE_KM.length;
	const filled = new Map(QUEUE_KM.map((k) => [k, 0]));
	for (const dex of sticky) if (filled.has(km(dex))) filled.set(km(dex), filled.get(km(dex)) + 1);
	const picked = new Map([...QUEUE_KM, LONG_SHOT_KM].map((k) => [k, []]));
	for (let free = size - sticky.length; free > 0; free--) {
		const open = QUEUE_KM.filter((k) => queues.get(k).length > 0);
		let k = LONG_SHOT_KM;
		if (open.length > 0) {
			k = open.reduce((best, q) => (share - filled.get(q) > share - filled.get(best) ? q : best));
			filled.set(k, filled.get(k) + 1);
		} else if (queues.get(LONG_SHOT_KM).length === 0) break;
		picked.get(k).push(queues.get(k).shift());
	}
	return flatten(picked);
}
