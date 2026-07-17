// Checks the curated "have friends collect for me" wishlist: positive targets,
// family-aware pruning via !+owned guards, lucky/hundo focus, suggestion sets,
// and the config merge/canonicalization path.
// Run with: npx vite-node scripts/check-friend-collect.mjs

import {
	buildFilters,
	DEFAULT_CONFIG,
	DEFAULT_TOP_ATTACKERS,
	mergeImportedConfig,
} from '../src/App.jsx';
import EVENTS from '../src/data/events.json';
import { pokemonNameFor } from '../src/data/species.js';

const t = (key, opts) => (opts && 'fallback' in opts ? opts.fallback : key);

let failures = 0;
function check(label, cond, detail = '') {
	const mark = cond ? '✓' : '✗';
	console.log(`  ${mark} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
	if (!cond) failures++;
}

// Base scenario: curated dratini/lapras/larvitar; user owns lucky dragonite
// (stored in DE as "dragoran") and lucky lapras, plus a charizard hundo.
const cfg = {
	...DEFAULT_CONFIG,
	topAttackers: DEFAULT_TOP_ATTACKERS,
	friendCollectSpecies: ['dratini', 'lapras', 'larvitar'],
	friendCollectMode: 'lucky',
};
const luckies = ['dragoran', 'lapras'];
const hundos = ['glurak'];

console.log('Scenario 1: lucky focus — exact-owned drops, singular selection-driven string');
{
	const r = buildFilters(hundos, luckies, cfg, [], 'en', t);
	check("mode defaults to 'lucky'", r.friendCollectMode === 'lucky');
	check(
		'targets carry exact-owned flags',
		JSON.stringify(r.friendCollectTargets.map((x) => [x.display, x.owned])) ===
			JSON.stringify([
				['dratini', false],
				['lapras', true],
				['larvitar', false],
			]),
		JSON.stringify(r.friendCollectTargets),
	);
	check(
		'string = selection + trade guards, nothing else',
		r.friendCollectWishlist === '+dratini,+larvitar&!traded&!shadow&!mythical,808,809',
		r.friendCollectWishlist,
	);
	// The have-collection must NOT be encoded as !+family guards — that's the
	// fallback wishlists' job, it scales the string with the collection instead
	// of the selection, and a family-wide !+dragonite would silently cancel a
	// curated dratini (lucky dex entries are per-species).
	check('no !+owned family guards in the string', !r.friendCollectWishlist.includes('!+'));
	check(
		'guaranteed variant appends year floor',
		r.friendCollectWishlistGuaranteed.endsWith('&year-20') &&
			r.friendCollectWishlistGuaranteed !== r.friendCollectWishlist,
		r.friendCollectWishlistGuaranteed,
	);
}

console.log('\nScenario 2: hundo focus — prunes exact-owned against hundos, no year floor');
{
	const r = buildFilters(
		hundos,
		luckies,
		{ ...cfg, friendCollectSpecies: ['glurak', 'dratini'], friendCollectMode: 'hundo' },
		[],
		'en',
		t,
	);
	check('exact-owned charizard dropped from positives', r.friendCollectWishlist.startsWith('+dratini&'));
	check('no !+owned family guards in the string', !r.friendCollectWishlist.includes('!+'));
	check(
		'string = selection + trade guards, nothing else',
		r.friendCollectWishlist === '+dratini&!traded&!shadow&!mythical,808,809',
		r.friendCollectWishlist,
	);
	check(
		'guaranteed variant === base (IVs re-roll regardless of age)',
		r.friendCollectWishlistGuaranteed === r.friendCollectWishlist,
	);
}

console.log('\nScenario 3: fully-owned list yields an empty string');
{
	const r = buildFilters(hundos, ['lapras'], { ...cfg, friendCollectSpecies: ['lapras'] }, [], 'en', t);
	check('string is empty', r.friendCollectWishlist === '');
	check('target still listed as owned', r.friendCollectTargets[0]?.owned === true);
}

console.log('\nScenario 4: suggestion sets');
{
	const r = buildFilters(hundos, luckies, cfg, [], 'en', t);
	const sug = r.friendCollectSuggestions;
	check(
		'raid + pvp sets present',
		sug.some((s) => s.kind === 'raids') && sug.some((s) => s.kind === 'pvp'),
		JSON.stringify(sug.map((s) => s.kind)),
	);
	const raids = sug.find((s) => s.kind === 'raids');
	check('raid set capped at 25', raids && raids.species.length <= 25);
	check(
		'no untradeable mythicals in any set',
		!sug.some((s) => s.species.some((sp) => ['mew', 'deoxys', 'darkrai', 'genesect'].includes(sp))),
	);
	check(
		'already-curated and owned species pruned',
		!sug.some(
			(s) => s.species.includes('dratini') || s.species.includes('lapras') || s.species.includes('dragoran'),
		),
	);
	check(
		'candidates canonical in the storage locale (lowercase)',
		sug.every((s) => s.species.every((sp) => typeof sp === 'string' && sp === sp.toLowerCase())),
	);
	// Event sets depend on the events.json snapshot: every emitted set must
	// belong to a non-past event window (past events never suggest).
	const now = Date.now();
	check(
		'event sets only for running/upcoming events',
		sug.filter((s) => s.kind === 'event').every((s) => !(Date.parse(s.end) < now)),
	);
}

console.log('\nScenario 5: rare-species fallback set');
{
	// Gate invariant, independent of the events snapshot's freshness: with
	// nothing curated/owned, the rare set appears exactly when no event set
	// survives.
	const base = buildFilters([], [], { ...cfg, friendCollectSpecies: [] }, [], 'en', t);
	const hasEvent = base.friendCollectSuggestions.some((s) => s.kind === 'event');
	const hasRare = base.friendCollectSuggestions.some((s) => s.kind === 'rare');
	check('rare set present exactly when no event set is', hasEvent !== hasRare);

	// Curate every active event spawn → event sets vanish (fully consumed) →
	// the rare set steps in as the rotation fallback.
	const now = Date.now();
	const activeDex = (EVENTS.events || [])
		.filter((ev) => !(Number.isFinite(Date.parse(ev.end)) && Date.parse(ev.end) < now))
		.flatMap((ev) => ev.spawnDex || []);
	const curated = [...new Set(activeDex.map((d) => pokemonNameFor(String(d))).filter(Boolean))];
	const r = buildFilters([], [], { ...cfg, friendCollectSpecies: curated }, [], 'en', t);
	const rare = r.friendCollectSuggestions.find((s) => s.kind === 'rare');
	check(
		'event sets consumed → no event suggestion',
		!r.friendCollectSuggestions.some((s) => s.kind === 'event'),
	);
	check('rare set offered as rotation fallback', !!rare);
	check('rare set capped at 25', !!rare && rare.species.length <= 25);
	check('rare set contains a fossil (omanyte)', !!rare && rare.species.includes(pokemonNameFor('138')));
	check(
		'rare set pruned of curated species',
		!!rare && !rare.species.some((sp) => curated.includes(sp)),
	);
}

console.log('\nScenario 6: egg-pool sets');
{
	const now = Date.now();
	const r = buildFilters([], [], { ...cfg, friendCollectSpecies: [] }, [], 'en', t);
	const eggSug = r.friendCollectSuggestions.filter((s) => s.kind === 'eggs');
	const activePools = (EVENTS.eggPools || []).filter(
		(p) => !(Number.isFinite(Date.parse(p.end)) && Date.parse(p.end) < now) && (p.eggDex || []).length > 0,
	);
	// Snapshot-agnostic: each active pool yields a set (nothing curated/owned to
	// prune it away), never more sets than pools, and past pools never surface.
	check(
		'one egg set per active pool',
		eggSug.length === activePools.length,
		`${eggSug.length} sets vs ${activePools.length} active pools`,
	);
	check('egg sets capped at 25', eggSug.every((s) => s.species.length <= 25));
	check(
		'egg set ids map to pool ids',
		eggSug.every((s) => activePools.some((p) => p.id === s.id)),
	);
	// Egg sets must NOT count toward the rare-set gate (a Season pool is
	// near-always live and would permanently suppress it) — consume all event
	// spawns: rare appears even while egg sets are still on offer.
	const activeEventDex = (EVENTS.events || [])
		.filter((ev) => !(Number.isFinite(Date.parse(ev.end)) && Date.parse(ev.end) < now))
		.flatMap((ev) => ev.spawnDex || []);
	const curatedEv = [...new Set(activeEventDex.map((d) => pokemonNameFor(String(d))).filter(Boolean))];
	const r2 = buildFilters([], [], { ...cfg, friendCollectSpecies: curatedEv }, [], 'en', t);
	check(
		'egg sets do not suppress the rare fallback',
		r2.friendCollectSuggestions.some((s) => s.kind === 'rare'),
	);
}

console.log('\nScenario 7: output locale rendering');
{
	const r = buildFilters(hundos, luckies, cfg, [], 'de', t);
	check(
		'DE output renders German names and keywords',
		r.friendCollectWishlist.startsWith('+dratini,+larvitar&') && r.friendCollectWishlist.includes('!getauscht'),
		r.friendCollectWishlist,
	);
}

console.log('\nScenario 8: config merge');
{
	const m = mergeImportedConfig({ friendCollectSpecies: ['Dragonite', '131'], friendCollectMode: 'weird' });
	check(
		'species canonicalized to storage locale',
		JSON.stringify(m.friendCollectSpecies) === JSON.stringify(['dragoran', 'lapras']),
		JSON.stringify(m.friendCollectSpecies),
	);
	check("unknown mode falls back to 'lucky'", m.friendCollectMode === 'lucky');
	const legacy = mergeImportedConfig({});
	check(
		'legacy configs back-fill the defaults',
		Array.isArray(legacy.friendCollectSpecies) &&
			legacy.friendCollectSpecies.length === 0 &&
			legacy.friendCollectMode === 'lucky',
	);
}

if (failures > 0) {
	console.error(`\n${failures} friend-collect check(s) failed.`);
	process.exit(1);
}
console.log('\n✓ All friend-collect checks passed.');
