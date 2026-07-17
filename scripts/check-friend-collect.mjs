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

console.log('Scenario 1: lucky focus — exact-owned drops, families excluded');
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
		'positives = non-owned targets only',
		r.friendCollectWishlist.startsWith('+dratini,+larvitar&'),
		r.friendCollectWishlist,
	);
	check('owned lucky family excluded (!+dragonite)', r.friendCollectWishlist.includes('!+dragonite'));
	check('owned lucky family excluded (!+lapras)', r.friendCollectWishlist.includes('!+lapras'));
	check(
		'trade guards present',
		r.friendCollectWishlist.includes('!traded') &&
			r.friendCollectWishlist.includes('!shadow') &&
			r.friendCollectWishlist.includes('!mythical,808,809'),
	);
	check(
		'guaranteed variant appends year floor',
		r.friendCollectWishlistGuaranteed.endsWith('&year-20') &&
			r.friendCollectWishlistGuaranteed !== r.friendCollectWishlist,
		r.friendCollectWishlistGuaranteed,
	);
	// hundo ownership must NOT leak into the lucky-focused string
	check('hundo have-list ignored in lucky focus', !r.friendCollectWishlist.includes('!+charizard'));
}

console.log('\nScenario 2: hundo focus — prunes against hundos, no year floor');
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
	check('hundo families excluded (!+charizard)', r.friendCollectWishlist.includes('!+charizard'));
	check('lucky families NOT excluded', !r.friendCollectWishlist.includes('!+dragonite'));
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

console.log('\nScenario 5: output locale rendering');
{
	const r = buildFilters(hundos, luckies, cfg, [], 'de', t);
	check(
		'DE output renders German names',
		r.friendCollectWishlist.startsWith('+dratini,+larvitar') && r.friendCollectWishlist.includes('!+dragoran'),
		r.friendCollectWishlist,
	);
}

console.log('\nScenario 6: config merge');
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
