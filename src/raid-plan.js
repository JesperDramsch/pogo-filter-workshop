// "Which Mega and which buddy for this raid?"
//
// A Mega in a raid can be picked for two things, and the planner lets the
// player choose which one leads:
//
//   candy   the Mega shares a type with the boss, so catching the boss after
//           the win counts as a matching catch and drops the Mega's bonus
//           candy (the same catch bonus src/mega-boost.js ranks for wild
//           spawns; a Primal boosts its `boostTypes`)
//   damage  the Mega's own type is one of the move types that hit the boss
//           super-effectively (raid-bosses.json `seMoveTypes`, from the type
//           chart), so it is an attacker for the fight itself
//
// A Mega that is both (a Ghost-type Mega against a Ghost boss, a Dragon-type
// against a Dragon boss) is the top pick in either mode. Within a mode, a Mega
// that also boosts the wild spawns running right now ranks first: one Mega
// that pays on the raid boss and on the walk between raids. This is a type
// question only: whether the player's Mega carries a move of that type is for
// the raid counter filters in the Battle area.
//
// Bosses in one tier that get exactly the same answer (Galarian Yamask and
// Sandygast are both Ghost/Ground) are folded into one line, so a tier reads
// as a handful of decisions rather than one row per boss.
//
// Two readers: every boss under its counter filter in the Battle area's raid
// panels, and each raid day or raid hour in the Mega planner.
// Pure functions over the snapshots, no React: scripts/check-raid-plan.mjs.

import { outingBuddyQuests } from './buddy-quests.js';

export const RAID_MODES = ['candy', 'damage'];

const shares = (a, b) => (a || []).some((t) => (b || []).includes(t));
const candyTypes = (m) => m.boostTypes || m.types || [];

// One boss → { candy: [mega…], damage: [mega…], both: Set(key) }, each list
// already ordered for its mode: both first, then wild-spawn coverage, then dex.
export function raidMegas(boss, megaForms, wildPool = []) {
	const wildHits = new Map();
	for (const m of megaForms || []) {
		const boost = candyTypes(m);
		wildHits.set(m.key, wildPool.filter((s) => shares(s.types, boost)).length);
	}
	const candy = (megaForms || []).filter((m) => shares(candyTypes(m), boss.types));
	const damage = (megaForms || []).filter((m) => shares(m.types, boss.seMoveTypes));
	const both = new Set(candy.filter((m) => damage.includes(m)).map((m) => m.key));
	const order = (a, b) =>
		Number(both.has(b.key)) - Number(both.has(a.key)) ||
		wildHits.get(b.key) - wildHits.get(a.key) ||
		a.dex - b.dex ||
		a.key.localeCompare(b.key);
	return { candy: candy.sort(order), damage: damage.sort(order), both, wildHits };
}

// The Megas worth naming first in `mode`: the both-group if there is one,
// otherwise every Mega tied at the top wild-spawn coverage.
export function topMegas(megas, mode) {
	const list = megas[mode] || [];
	if (!list.length) return [];
	const inBoth = list.filter((m) => megas.both.has(m.key));
	if (inBoth.length) return inBoth;
	const best = megas.wildHits.get(list[0].key);
	return list.filter((m) => megas.wildHits.get(m.key) === best);
}

// The lines of one raid outing: its bosses, folded where the answer is the
// same. `bosses` are raid-bosses.json bosses ({ id, form, names, types,
// seMoveTypes }). Returns
// [{ key, bosses: [boss…], megas: raidMegas(…), buddies: outingBuddyQuests(…) }].
export function raidLines(bosses, { megaForms = [], quests = [], wildPool = [] } = {}) {
	const lines = new Map();
	const seen = new Set();
	for (const boss of bosses || []) {
		const name = boss.names?.en || boss.id;
		if (seen.has(name)) continue; // Deoxys's four formes are one boss here
		seen.add(name);
		const megas = raidMegas(boss, megaForms, wildPool);
		const buddies = outingBuddyQuests(quests, { kind: 'raid', spawnForms: [{ dex: 0, region: null, types: boss.types || [] }] });
		const sig = [
			megas.candy.map((m) => m.key).join(','),
			megas.damage.map((m) => m.key).join(','),
			buddies.map((b) => b.key).join(','),
		].join('|');
		if (!lines.has(sig)) lines.set(sig, { key: sig, bosses: [], megas, buddies });
		lines.get(sig).bosses.push(boss);
	}
	return [...lines.values()];
}
