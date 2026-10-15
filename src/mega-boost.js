// Which Mega (or Primal) to have active for a given wild-spawn pool.
//
// An active Mega boosts every catch that shares a type with it: bonus Candy at
// every Mega level, plus a Candy XL chance and bonus XP from level 2 (the
// game master's megaEvoLevelSettings). A Primal boosts its own fixed type set
// instead (species-meta's `boostTypes`). The question "which one is worth it"
// is therefore a coverage question: how many of the species spawning right now
// would the Mega boost?
//
// Spawn rates are not published anywhere this repo reads, so every spawn
// species counts once. That ranks a Mega by how much of the pool it covers,
// not by how many catches it boosts; for event pools, where every listed
// species is boosted, the two are close.
//
// Pure functions over the two snapshots, no React: scripts/check-mega-boost.mjs
// runs them under vite-node.

// Distinct spawns of the events live at `now`, the "current spawn pool".
// `events` are events.json records ({ start, end, spawnForms }); `start` and
// `end` are local wall-clock strings, read the same way the event card reads
// them (Date.parse without a zone = the viewer's local time).
export function liveSpawnPool(events, now = Date.now()) {
	const live = (events || []).filter((ev) => {
		const start = Date.parse(ev.start);
		const end = Date.parse(ev.end);
		return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
	});
	return { events: live, spawnForms: mergeSpawnForms(live.map((ev) => ev.spawnForms)) };
}

// Union of several events' spawnForms, one entry per dex + region + types.
export function mergeSpawnForms(lists) {
	const out = new Map();
	for (const list of lists || []) {
		for (const f of list || []) {
			const k = spawnKey(f);
			if (!out.has(k)) out.set(k, f);
		}
	}
	return [...out.values()].sort((a, b) => a.dex - b.dex || String(a.region).localeCompare(String(b.region)));
}

const spawnKey = (f) => `${f.dex}|${f.region}|${(f.types || []).join('/')}`;

// Ranks the Mega forms against a spawn pool.
//
// Megas whose boost covers exactly the same spawns are interchangeable for this
// pool, so they are grouped: "any of Mega Pidgeot, Mega Charizard Y" beats
// listing both as separate ties, and a bigger group is likelier to hold a Mega
// the player actually has energy for. Groups are ordered by spawns covered,
// then by group size, then by the lowest dex in the group, so the order is
// stable across renders.
//
// Returns [{ megas: [megaForm], matched: [spawnForm], types: [type] }], where
// `types` are the boosted types the pool actually hits. Megas that boost
// nothing in the pool are left out.
export function rankMegaGroups(spawnForms, megaForms) {
	const pool = spawnForms || [];
	const groups = new Map();
	for (const mega of megaForms || []) {
		const boost = new Set(mega.boostTypes || mega.types || []);
		const matched = pool.filter((s) => (s.types || []).some((t) => boost.has(t)));
		if (matched.length === 0) continue;
		const sig = matched.map(spawnKey).join(',');
		let g = groups.get(sig);
		if (!g) groups.set(sig, (g = { megas: [], matched, types: new Set() }));
		g.megas.push(mega);
		for (const s of matched) for (const t of s.types) if (boost.has(t)) g.types.add(t);
	}
	return [...groups.values()]
		.map((g) => ({
			...g,
			megas: [...g.megas].sort((a, b) => a.dex - b.dex || a.key.localeCompare(b.key)),
			types: [...g.types].sort(),
		}))
		.sort(
			(a, b) =>
				b.matched.length - a.matched.length ||
				b.megas.length - a.megas.length ||
				a.megas[0].dex - b.megas[0].dex,
		);
}
