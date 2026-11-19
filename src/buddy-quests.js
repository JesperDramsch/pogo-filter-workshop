// "Which quest evolution is worth a buddy this week?"
//
// src/data/evolution-quests.json (scripts/fetch-evolution-costs.mjs, from the
// game master) lists every evolution gated on a quest: Pancham catching 32
// Dark types, Kubfu winning 30 Dark or Water raids, Galarian Slowpoke catching
// Poison or Psychic types. Most of those quests are cheap in one week and slow
// in the next, depending on what spawns and which bosses are in raids. This
// module puts each quest next to the week's data and says which are easy now.
//
// Sources, each read from data the app already syncs:
//   - wild    events.json `events[].spawnForms` (types per spawn), within the
//             horizon and applying at the home pin (bonusAppliesAtHome), for
//             catch quests
//   - raid    raid-bosses.json: the standing rotation (`raids`, `maxBattles`,
//             no window: it is what is up now) and the dated `eventRaids` /
//             `eventMaxBattles`, for raid-win and defeat quests. Max Battles
//             count only for a quest whose `max` is set (Kubfu)
//   - rocket  rocket-lineups.json typed grunts, for defeat quests. Always
//             there, so it is reported but scores nothing: it does not make
//             this week better than the next
//   - hearts  an event bonus that classifies as `buddy_hearts`
//             (src/bonus-nudges.js), for heart quests
//
// The score is a heuristic for ordering, never shown. A wild event scores
// matches × (1 + 20 × share²), where share is the matching fraction of that
// event's spawns: a Community Day of a Dark type (share 1) is worth far more
// than four Dark types among forty spawns. A raid boss scores 1, a 1★ boss 2
// (soloable). A hearts bonus scores 10. The sum is divided by the quest's
// target, so seven Dragon catches with three Dragon spawns outranks thirty
// raid wins with three bosses. Pure functions, no React.

import { bonusAppliesAtHome, classifyBonus } from './bonus-nudges.js';

export const BUDDY_QUEST_HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Quests no week makes easier or harder: listed under "any time".
export const ANYTIME_ACTIONS = new Set(['walk', 'treats', 'throw', 'incense']);

const SOLO_TIERS = new Set(['lvl1', 'shadow_lvl1']);

const overlaps = (start, end, now, until) => {
	const s = Date.parse(start);
	const e = Date.parse(end);
	return Number.isFinite(s) && Number.isFinite(e) && e >= now && s <= until;
};
const hits = (types, wanted) => (types || []).some((t) => wanted.includes(t));

// Stable id for a quest row (Kubfu has two quests on one dex).
export const questKey = (q) => `${q.dex}|${q.region ?? ''}|${q.quest}`;

// Everything a quest could draw on this week, before matching: the parts of
// events.json and raid-bosses.json inside the horizon, in one shape.
export function questSources({ events = [], bonuses = [], raidBosses = {}, rocketTrainers = [] } = {}, now = Date.now(), {
	horizonDays = BUDDY_QUEST_HORIZON_DAYS,
	homeLocation = null,
} = {}) {
	const until = now + horizonDays * DAY_MS;
	const wild = [];
	for (const ev of events) {
		if (!overlaps(ev.start, ev.end, now, until) || !(ev.spawnForms || []).length) continue;
		if (!bonusAppliesAtHome(ev, homeLocation)) continue;
		wild.push({ id: ev.id || ev.title, title: ev.title, category: ev.category || null, start: ev.start, end: ev.end, spawnForms: ev.spawnForms });
	}
	const raids = [];
	// Deoxys's four formes are four bosses of one name and one window: one row.
	const seen = new Set();
	const addRaid = (r) => {
		const key = `${r.name}|${r.title ?? r.tier}`;
		if (seen.has(key)) return;
		seen.add(key);
		raids.push(r);
	};
	const standing = (byTier, max) => {
		for (const [tier, list] of Object.entries(byTier || {})) {
			for (const b of list || []) addRaid({ name: b.names?.en || b.id, names: b.names || {}, id: b.id, form: b.form, types: b.types || [], tier, max, start: null, end: null, title: null });
		}
	};
	standing(raidBosses.raids, false);
	standing(raidBosses.maxBattles, true);
	const dated = (list, max) => {
		for (const r of list || []) {
			if (!overlaps(r.start, r.end, now, until)) continue;
			for (const b of r.bosses || []) addRaid({ name: b.names?.en || b.id, names: b.names || {}, id: b.id, form: b.form, types: b.types || [], tier: null, max, start: r.start, end: r.end, title: r.name });
		}
	};
	dated(raidBosses.eventRaids, false);
	dated(raidBosses.eventMaxBattles, true);
	const grunts = (rocketTrainers || [])
		.filter((t) => t.kind === 'typed_grunt' && t.type)
		.map((t) => t.type);
	const hearts = [];
	for (const rec of bonuses) {
		if (!overlaps(rec.start, rec.end, now, until) || !bonusAppliesAtHome(rec, homeLocation)) continue;
		if ((rec.bonuses || []).some((b) => classifyBonus(b)?.kind === 'buddy_hearts')) {
			hearts.push({ id: rec.id || rec.title, title: rec.title, start: rec.start, end: rec.end });
		}
	}
	return { now, wild, raids, grunts: [...new Set(grunts)], hearts };
}

// One quest against the sources → { score, wild:[…], raids:[…], grunts:[…], hearts:[…] }.
export function matchQuest(q, src) {
	const out = { score: 0, wild: [], raids: [], grunts: [], hearts: [] };
	const types = q.types || [];
	if (q.action === 'catch' && types.length) {
		for (const ev of src.wild) {
			const m = ev.spawnForms.filter((f) => hits(f.types, types));
			if (!m.length) continue;
			const share = m.length / ev.spawnForms.length;
			out.wild.push({ id: ev.id, title: ev.title, category: ev.category, start: ev.start, end: ev.end, matches: m, total: ev.spawnForms.length });
			out.score += m.length * (1 + 20 * share * share);
		}
	}
	if (q.action === 'raid_win' || q.action === 'defeat') {
		// A raid quest with no type counts any raid: there is always one, so it
		// is an any-time quest and scores nothing here.
		if (types.length) {
			for (const r of src.raids) {
				if (r.max && !(q.action === 'raid_win' && q.max)) continue;
				if (!hits(r.types, types)) continue;
				out.raids.push(r);
				out.score += SOLO_TIERS.has(r.tier) ? 2 : 1;
			}
		}
	}
	if (q.action === 'defeat') out.grunts = src.grunts.filter((g) => types.includes(g));
	if (q.action === 'hearts' && src.hearts.length) {
		out.hearts = src.hearts;
		out.score += 10;
	}
	if (q.target > 0) out.score /= q.target;
	return out;
}

// The card's three lists:
//   ranked  quests something this week helps, best first
//   anytime quests no week changes (walk, treats, throws, Incense, untyped
//           raid wins, hearts without a bonus)
//   quiet   typed quests nothing this week helps (Dragon catches in a week
//           with no Dragon spawns)
export function buddyQuestPlan(quests, sources) {
	const ranked = [];
	const anytime = [];
	const quiet = [];
	for (const q of quests || []) {
		const m = matchQuest(q, sources);
		const row = { key: questKey(q), quest: q, ...m };
		if (m.score > 0) ranked.push(row);
		else if (ANYTIME_ACTIONS.has(q.action) || q.action === 'hearts' || (q.action === 'raid_win' && !(q.types || []).length)) anytime.push(row);
		else quiet.push(row);
	}
	ranked.sort((a, b) => b.score - a.score || a.quest.target - b.quest.target || a.quest.dex - b.quest.dex);
	const byTarget = (a, b) => a.quest.target - b.quest.target || a.quest.dex - b.quest.dex;
	return { ranked, anytime: anytime.sort(byTarget), quiet: quiet.sort(byTarget) };
}
