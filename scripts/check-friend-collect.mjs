// Checks the curated "have friends collect for me" wishlist: positive
// EXACT-species targets (no + family expansion), lucky/hundo focus, the
// data-derived suggestion packs (special-trade filtering included), and the
// config merge/canonicalization path.
// Run with: npx vite-node scripts/check-friend-collect.mjs

import {
	buildFilters,
	collectibleBaseDex,
	DEFAULT_CONFIG,
	DEFAULT_TOP_ATTACKERS,
	mergeImportedConfig,
} from '../src/App.jsx';
import EVENTS from '../src/data/events.json';
import SPECIES_META from '../src/data/species-meta.json';
import PVP_RANKINGS from '../src/data/pvp-rankings.json';
import { pokemonNameFor, resolveSpeciesInfo } from '../src/data/species.js';
import {
	evoParentsFromGameMaster,
	specialTradeDexFromGameMaster,
	starterDexFromGenerations,
} from './fetch-species-meta.mjs';

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
		'string = exact-species selection + trade guards, nothing else',
		r.friendCollectWishlist === 'dratini,larvitar&!traded&!shadow&!mythical,808,809&!shiny&!costume&!background&!purified',
		r.friendCollectWishlist,
	);
	// Targets are bare exact-species terms: `+dratini` would ask the friend for
	// the entire evolution family — wrong in general and disastrous for egg
	// babies (a curated Pichu must not fan out into Pikachu/Raichu).
	check('no + family expansion anywhere in the string', !r.friendCollectWishlist.includes('+'));
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
	check('exact-owned charizard dropped from positives', r.friendCollectWishlist.startsWith('dratini&'));
	check('no + family expansion anywhere in the string', !r.friendCollectWishlist.includes('+'));
	check(
		'string = selection + trade guards, nothing else',
		r.friendCollectWishlist === 'dratini&!traded&!shadow&!mythical,808,809&!shiny&!costume&!background&!purified',
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

console.log('\nScenario 4: egg babies emitted bare (the original bug)');
{
	const r = buildFilters([], [], { ...cfg, friendCollectSpecies: ['pichu'] }, [], 'en', t);
	check(
		'curated Pichu asks for Pichu only, not the Pikachu family',
		r.friendCollectWishlist === 'pichu&!traded&!shadow&!mythical,808,809&!shiny&!costume&!background&!purified',
		r.friendCollectWishlist,
	);
}

console.log('\nScenario 5: suggestion packs — lineup, caps, hygiene');
{
	const r = buildFilters(hundos, luckies, cfg, [], 'en', t);
	const sug = r.friendCollectSuggestions;
	const kinds = new Set(sug.map((s) => s.kind));
	for (const kind of ['tradeevo', 'candy', 'powerlines', 'starters', 'raids', 'pvp-great', 'pvp-ultra']) {
		check(`'${kind}' pack present`, kinds.has(kind), JSON.stringify([...kinds]));
	}
	check("gated 'rare' pack retired", !kinds.has('rare'));
	check("combined 'pvp' pack retired (split per league)", !kinds.has('pvp'));
	check(
		'capped packs stay ≤ 25',
		sug.filter((s) => ['candy', 'powerlines', 'raids', 'pvp-great', 'pvp-ultra', 'eggs'].includes(s.kind))
			.every((s) => s.species.length <= 25),
	);
	check(
		'no untradeable mythicals in any pack',
		!sug.some((s) => s.species.some((sp) => ['mew', 'deoxys', 'darkrai', 'genesect'].includes(sp))),
	);
	// The regular-trade guarantee: nothing from the special-trade snapshot may
	// surface in ANY pack. DEFAULT_TOP_ATTACKERS is legendary-heavy, so the
	// raids pack is the real regression test here.
	const specialNames = new Set(
		(SPECIES_META.specialTradeDex || []).map((dex) => pokemonNameFor(String(dex))).filter(Boolean),
	);
	const leaked = [];
	for (const s of sug)
		for (const sp of s.species) if (specialNames.has(sp)) leaked.push(`${s.kind}:${sp}`);
	check('no special-trade species (legendary/UB) in any pack', leaked.length === 0, leaked.join(', '));
	check(
		'raids pack survives the special-trade filter with real picks',
		(sug.find((s) => s.kind === 'raids')?.species.length || 0) > 0,
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
	const now = Date.now();
	check(
		'event packs only for running/upcoming events',
		sug.filter((s) => s.kind === 'event').every((s) => !(Date.parse(s.end) < now)),
	);
	// GL/UL packs derive strictly from the per-league PvP snapshots — modulo
	// the collectible-base remap: a snapshot Greedent surfaces as Skwovet.
	for (const [kind, league] of [
		['pvp-great', 'great'],
		['pvp-ultra', 'ultra'],
	]) {
		const pack = sug.find((s) => s.kind === kind);
		const leagueBaseNames = new Set(
			(PVP_RANKINGS.leagues?.[league]?.species || [])
				.map((s) => pokemonNameFor(String(collectibleBaseDex(s.dex))))
				.filter(Boolean),
		);
		check(
			`'${kind}' pack ⊆ collectible bases of the ${league}-league snapshot`,
			!!pack && pack.species.every((sp) => leagueBaseNames.has(sp)),
		);
	}
	// Every non-egg pack suggests collectible bases ONLY (eggs keep their
	// stages — they hatch exactly what they hatch).
	const nonBase = [];
	for (const s of sug) {
		if (s.kind === 'eggs') continue;
		for (const sp of s.species) {
			const dex = resolveSpeciesInfo(sp)?.dex;
			if (dex && collectibleBaseDex(dex) !== dex) nonBase.push(`${s.kind}:${sp}`);
		}
	}
	check('non-egg packs contain only collectible-base species', nonBase.length === 0, nonBase.join(', '));
	check(
		'packs carry display names aligned with species',
		sug.every((s) => Array.isArray(s.display) && s.display.length === s.species.length),
	);
	// GL carries the lucky-IV-floor warning; UL deliberately does not.
	check(
		'GL pack flagged with the lucky-floor warning',
		sug.find((s) => s.kind === 'pvp-great')?.warn === true &&
			!sug.find((s) => s.kind === 'pvp-ultra')?.warn,
	);
	check(
		'packs carry hint keys for the UI',
		['tradeevo', 'candy', 'powerlines', 'starters', 'raids', 'pvp-great', 'pvp-ultra'].every(
			(kind) => typeof sug.find((s) => s.kind === kind)?.hintKey === 'string',
		),
	);
}

console.log('\nScenario 6: evergreen packs — no event gate, prune-to-vanish');
{
	// Nothing curated/owned → the evergreen packs are always on offer,
	// regardless of the events snapshot (the old rare set was event-gated).
	const base = buildFilters([], [], { ...cfg, friendCollectSpecies: [] }, [], 'en', t);
	for (const kind of ['tradeevo', 'candy', 'powerlines', 'starters'])
		check(`'${kind}' offered with nothing curated`, base.friendCollectSuggestions.some((s) => s.kind === kind));

	// Curating a pack's entire pool consumes it (prune still works). The pool
	// goes through the collectible-base remap first — Togepi's power line
	// surfaces as Togetic, so the curated names must match the remapped set.
	const powerNames = [
		...new Set(
			(SPECIES_META.powerLineDex || [])
				.map((d) => pokemonNameFor(String(collectibleBaseDex(d))))
				.filter(Boolean),
		),
	];
	const r = buildFilters([], [], { ...cfg, friendCollectSpecies: powerNames }, [], 'en', t);
	check(
		'fully-curated power-lines pack disappears',
		!r.friendCollectSuggestions.some((s) => s.kind === 'powerlines'),
	);
}

console.log('\nScenario 7: egg-pool sets');
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
}

console.log('\nScenario 8: output locale rendering');
{
	const r = buildFilters(hundos, luckies, cfg, [], 'de', t);
	check(
		'DE output renders German names and keywords',
		r.friendCollectWishlist.startsWith('dratini,larvitar&') && r.friendCollectWishlist.includes('!getauscht'),
		r.friendCollectWishlist,
	);
	check(
		'DE output localizes the special-copy guards (shiny → schillernd)',
		r.friendCollectWishlist.includes('!schillernd'),
		r.friendCollectWishlist,
	);
}

console.log("\nScenario 8b: 'both' focus — covered only when lucky AND hundo are owned");
{
	// dragoran: lucky + hundo → fully covered, drops. glurak: hundo only →
	// stays in the string. dratini: neither → stays.
	const r = buildFilters(
		['dragoran', 'glurak'],
		['dragoran'],
		{ ...cfg, friendCollectSpecies: ['dragoran', 'glurak', 'dratini'], friendCollectMode: 'both' },
		[],
		'en',
		t,
	);
	check("mode resolves to 'both'", r.friendCollectMode === 'both');
	check(
		'per-goal flags are exact',
		JSON.stringify(r.friendCollectTargets.map((x) => [x.display, x.ownedLucky, x.ownedHundo, x.owned])) ===
			JSON.stringify([
				['dragonite', true, true, true],
				['charizard', false, true, false],
				['dratini', false, false, false],
			]),
		JSON.stringify(r.friendCollectTargets),
	);
	check(
		'only the fully-covered target drops from the string',
		r.friendCollectWishlist.startsWith('charizard,dratini&'),
		r.friendCollectWishlist,
	);
	check(
		"guaranteed variant === base in 'both' (year floor is lucky-focus only)",
		r.friendCollectWishlistGuaranteed === r.friendCollectWishlist,
	);

	// Suggestion pruning follows the same predicate: a species owned only as
	// lucky is still suggestible under 'both' (not yet fully covered) but
	// pruned under 'lucky'. Dratini sits in the power-lines pack.
	const luckyOnly = buildFilters([], ['dratini'], { ...cfg, friendCollectSpecies: [], friendCollectMode: 'both' }, [], 'en', t);
	const powerBoth = luckyOnly.friendCollectSuggestions.find((s) => s.kind === 'powerlines');
	check("lucky-only species still suggested under 'both'", !!powerBoth && powerBoth.species.includes('dratini'));
	const luckyMode = buildFilters([], ['dratini'], { ...cfg, friendCollectSpecies: [], friendCollectMode: 'lucky' }, [], 'en', t);
	const powerLucky = luckyMode.friendCollectSuggestions.find((s) => s.kind === 'powerlines');
	check("same species pruned from packs under 'lucky'", !!powerLucky && !powerLucky.species.includes('dratini'));
}

console.log('\nScenario 8c: collectible-base remap — packs suggest what a friend should actually catch');
{
	// The unit rule: base of the line; baby-headed lines yield the stage
	// above the baby; a baby with several children (Tyrogue) stays put.
	check('Greedent (820) → Skwovet (819)', collectibleBaseDex(820) === 819);
	check('Dragonite (149) → Dratini (147)', collectibleBaseDex(149) === 147);
	check('Raichu (26) → Pikachu (25), hopping over baby Pichu', collectibleBaseDex(26) === 25);
	check('Pichu (172) itself → Pikachu (25)', collectibleBaseDex(172) === 25);
	check('Azumarill (184) → Marill (183), not baby Azurill', collectibleBaseDex(184) === 183);
	check('Tyrogue (236) stays — three children, no unambiguous hop', collectibleBaseDex(236) === 236);
	check('Lucario (448) stays — the stage above baby Riolu IS the target', collectibleBaseDex(448) === 448);
	check('a base stays a base', collectibleBaseDex(147) === 147 && collectibleBaseDex(1) === 1);

	// The live regression (the original complaint): Greedent sits in the GL
	// snapshot, so the pack must offer Skwovet — and a lucky Skwovet ("raffel"
	// in the DE storage locale) must prune it instead of coexisting with a
	// pack-added Greedent.
	const fresh = buildFilters([], [], { ...cfg, friendCollectSpecies: [] }, [], 'en', t);
	const gl = fresh.friendCollectSuggestions.find((s) => s.kind === 'pvp-great');
	check('GL pack never offers schlaraffel (Greedent) — evolved stages stay out',
		!!gl && !gl.species.includes('schlaraffel'),
		JSON.stringify(gl?.species));
	check('GL pack offers raffel (Skwovet) instead, unless the 25-cap cut the line entirely',
		!!gl && (gl.species.includes('raffel') || gl.species.length === 25),
		JSON.stringify(gl?.species));
	check('GL pack offers marill, not azumarill / baby azurill',
		!!gl && gl.species.includes('marill') && !gl.species.includes('azumarill') && !gl.species.includes('azurill'));
	const pruned = buildFilters([], ['raffel'], { ...cfg, friendCollectSpecies: [] }, [], 'en', t);
	const glPruned = pruned.friendCollectSuggestions.find((s) => s.kind === 'pvp-great');
	check('lucky Skwovet prunes the whole line from the GL pack',
		!glPruned || (!glPruned.species.includes('raffel') && !glPruned.species.includes('schlaraffel')));
}

console.log('\nScenario 8d: coverage overrides — forced targets stay in the string');
{
	const base = { ...cfg, friendCollectSpecies: ['lapras', 'dratini'], friendCollectMode: 'lucky' };
	const plain = buildFilters([], ['lapras'], base, [], 'en', t);
	check('without an override the owned target drops', plain.friendCollectWishlist.startsWith('dratini&'));
	const forced = buildFilters([], ['lapras'], { ...base, friendCollectForced: ['lapras'] }, [], 'en', t);
	check('forced target re-enters the positives',
		forced.friendCollectWishlist.startsWith('lapras,dratini&'),
		forced.friendCollectWishlist);
	check('targets carry the forced flag',
		JSON.stringify(forced.friendCollectTargets.map((x) => [x.display, x.owned, x.forced])) ===
			JSON.stringify([
				['lapras', true, true],
				['dratini', false, false],
			]),
		JSON.stringify(forced.friendCollectTargets));
	// A fully-owned single-target list with an override: the string must NOT
	// collapse to empty (the whole point of the override).
	const solo = buildFilters([], ['lapras'], { ...cfg, friendCollectSpecies: ['lapras'], friendCollectForced: ['lapras'] }, [], 'en', t);
	check('fully-owned + forced still emits a string', solo.friendCollectWishlist.startsWith('lapras&'));
	// Packs are pruned by the curated set, not by the override — forcing a
	// species never resurfaces it as a suggestion.
	check('forced species never resurfaces in packs',
		!forced.friendCollectSuggestions.some((s) => s.species.includes('lapras')));
}

console.log('\nScenario 9: config merge');
{
	const m = mergeImportedConfig({ friendCollectSpecies: ['Dragonite', '131'], friendCollectMode: 'weird' });
	check(
		'species canonicalized to storage locale',
		JSON.stringify(m.friendCollectSpecies) === JSON.stringify(['dragoran', 'lapras']),
		JSON.stringify(m.friendCollectSpecies),
	);
	check("unknown mode falls back to 'lucky'", m.friendCollectMode === 'lucky');
	check(
		"'both' mode survives the merge",
		mergeImportedConfig({ friendCollectMode: 'both' }).friendCollectMode === 'both',
	);
	const legacy = mergeImportedConfig({});
	check(
		'legacy configs back-fill the defaults',
		Array.isArray(legacy.friendCollectSpecies) &&
			legacy.friendCollectSpecies.length === 0 &&
			legacy.friendCollectMode === 'lucky' &&
			legacy.friendCollectGuaranteedOnly === false,
	);
	check(
		'guaranteed-only: true survives the merge',
		mergeImportedConfig({ friendCollectGuaranteedOnly: true }).friendCollectGuaranteedOnly === true,
	);
	check(
		'guaranteed-only: junk coerces to false',
		mergeImportedConfig({ friendCollectGuaranteedOnly: 'yes' }).friendCollectGuaranteedOnly === false,
	);
	const mf = mergeImportedConfig({
		friendCollectSpecies: ['Dragonite', '131'],
		friendCollectForced: ['Dragonite', 'Pikachu'],
	});
	check(
		'forced overrides canonicalized and filtered to the curated list',
		JSON.stringify(mf.friendCollectForced) === JSON.stringify(['dragoran']),
		JSON.stringify(mf.friendCollectForced),
	);
	const legacyForced = mergeImportedConfig({}).friendCollectForced;
	check('legacy configs back-fill an empty forced list', Array.isArray(legacyForced) && legacyForced.length === 0);
	check(
		'junk forced value coerces to empty',
		mergeImportedConfig({ friendCollectForced: 'yes' }).friendCollectForced.length === 0,
	);
}

console.log('\nScenario 10: species-meta snapshot shape (bad syncs must not silently empty the packs)');
{
	const special = new Set(SPECIES_META.specialTradeDex || []);
	check('specialTradeDex non-empty', special.size > 0);
	check('starterDex non-empty, whole trios (3 per gen)', (SPECIES_META.starterDex || []).length >= 27 && SPECIES_META.starterDex.length % 3 === 0);
	check('powerLineDex non-empty', (SPECIES_META.powerLineDex || []).length > 0);
	check('Nihilego (Ultra Beast) is special-trade', special.has(793));
	check('Mewtwo is special-trade', special.has(150));
	check('Meltan is special-trade (tradeable, but never a regular trade)', special.has(808) && special.has(809));
	check(
		'specialTradeDex ∩ starterDex = ∅',
		(SPECIES_META.starterDex || []).every((dex) => !special.has(dex)),
	);
	check(
		'specialTradeDex ∩ powerLineDex = ∅',
		(SPECIES_META.powerLineDex || []).every((dex) => !special.has(dex)),
	);
	// evoParentByDex: the collectible-base remap dies silently (every species
	// counts as its own base) if a bad sync empties this — so gate the shape.
	const parents = SPECIES_META.evoParentByDex || {};
	check('evoParentByDex present and populated (>400 steps)', Object.keys(parents).length > 400);
	check('Ivysaur → Bulbasaur (2 → 1)', parents['2'] === 1);
	check('Greedent → Skwovet (820 → 819)', parents['820'] === 819);
	check('Pikachu → Pichu (25 → 172): babies are real parents in the raw map', parents['25'] === 172);
	check('bases have no parent entry', parents['1'] === undefined && parents['147'] === undefined);
	let cyclic = false;
	for (const start of Object.keys(parents)) {
		let cur = parseInt(start, 10);
		for (let hops = 0; parents[String(cur)] !== undefined; hops++) {
			if (hops >= 10) { cyclic = true; break; }
			cur = parents[String(cur)];
		}
		if (cyclic) break;
	}
	check('parent walks always terminate (no cycles)', !cyclic);
}

console.log('\nScenario 11b: game-master evolutionBranch parser (offline sample)');
{
	// Shape mirrors latest.json. Must map branch targets via pokemonId → dex,
	// skip mega temp-evos, dedupe per-form repeats, and catch cross-dex
	// regional-form evolutions (Galarian Meowth → Perrserker).
	const sample = [
		{ templateId: 'V0001_POKEMON_BULBASAUR', data: { templateId: 'V0001_POKEMON_BULBASAUR', pokemonSettings: { pokemonId: 'BULBASAUR', evolutionBranch: [{ evolution: 'IVYSAUR', candyCost: 25 }] } } },
		{ templateId: 'V0001_POKEMON_BULBASAUR_NORMAL', data: { templateId: 'V0001_POKEMON_BULBASAUR_NORMAL', pokemonSettings: { pokemonId: 'BULBASAUR', evolutionBranch: [{ evolution: 'IVYSAUR', candyCost: 25, form: 'IVYSAUR_NORMAL' }] } } },
		{ templateId: 'V0002_POKEMON_IVYSAUR', data: { templateId: 'V0002_POKEMON_IVYSAUR', pokemonSettings: { pokemonId: 'IVYSAUR', evolutionBranch: [{ evolution: 'VENUSAUR', candyCost: 100 }] } } },
		{ templateId: 'V0003_POKEMON_VENUSAUR', data: { templateId: 'V0003_POKEMON_VENUSAUR', pokemonSettings: { pokemonId: 'VENUSAUR', evolutionBranch: [{ temporaryEvolution: 'TEMP_EVOLUTION_MEGA' }] } } },
		{ templateId: 'V0052_POKEMON_MEOWTH_GALARIAN', data: { templateId: 'V0052_POKEMON_MEOWTH_GALARIAN', pokemonSettings: { pokemonId: 'MEOWTH', evolutionBranch: [{ evolution: 'PERRSERKER', candyCost: 50 }] } } },
		{ templateId: 'V0863_POKEMON_PERRSERKER', data: { templateId: 'V0863_POKEMON_PERRSERKER', pokemonSettings: { pokemonId: 'PERRSERKER' } } },
		{ templateId: 'COMBAT_V0001_MOVE_WRAP', data: { templateId: 'COMBAT_V0001_MOVE_WRAP' } },
		null,
	];
	const p = evoParentsFromGameMaster(sample);
	check('Ivysaur → Bulbasaur', p.get(2) === 1);
	check('Venusaur → Ivysaur', p.get(3) === 2);
	check('Perrserker → Meowth (cross-dex regional-form evo)', p.get(863) === 52);
	check('mega temp-evo branch ignored, per-form repeats deduped', p.size === 3, JSON.stringify([...p]));
	check('empty/absent game master yields empty map', evoParentsFromGameMaster(null).size === 0);
	for (const wrapper of ['template', 'templates', 'itemTemplate']) {
		const wrapped = evoParentsFromGameMaster({ [wrapper]: sample });
		check(
			`wrapped game master shape '{ ${wrapper}: [...] }' parses identically`,
			wrapped.size === 3 && wrapped.get(2) === 1 && wrapped.get(863) === 52,
		);
	}
}

console.log('\nScenario 11: game-master pokemonClass parser (offline sample)');
{
	// Shape mirrors PokeMiners latest.json: [{ templateId, data: { templateId,
	// pokemonSettings } }]. The parser must catch all three special classes,
	// ignore classless species, and survive malformed entries.
	const sample = [
		{ templateId: 'V0793_POKEMON_NIHILEGO', data: { templateId: 'V0793_POKEMON_NIHILEGO', pokemonSettings: { pokemonId: 'NIHILEGO', pokemonClass: 'POKEMON_CLASS_ULTRA_BEAST' } } },
		{ templateId: 'V0150_POKEMON_MEWTWO', data: { templateId: 'V0150_POKEMON_MEWTWO', pokemonSettings: { pokemonId: 'MEWTWO', pokemonClass: 'POKEMON_CLASS_LEGENDARY' } } },
		{ templateId: 'V0808_POKEMON_MELTAN', data: { templateId: 'V0808_POKEMON_MELTAN', pokemonSettings: { pokemonId: 'MELTAN', pokemonClass: 'POKEMON_CLASS_MYTHIC' } } },
		{ templateId: 'V0147_POKEMON_DRATINI', data: { templateId: 'V0147_POKEMON_DRATINI', pokemonSettings: { pokemonId: 'DRATINI' } } },
		{ templateId: 'COMBAT_V0001_MOVE_WRAP', data: { templateId: 'COMBAT_V0001_MOVE_WRAP' } },
		null,
	];
	const ids = specialTradeDexFromGameMaster(sample);
	check('Ultra Beast class → 793', ids.has(793));
	check('Legendary class → 150', ids.has(150));
	check('Mythic class → 808 (Meltan stays special-trade)', ids.has(808));
	check('classless species ignored', !ids.has(147));
	check('exactly the three special entries', ids.size === 3, JSON.stringify([...ids]));
	check('empty/absent game master yields empty set', specialTradeDexFromGameMaster(null).size === 0);
	// Wrapped payload shapes ({ template: [...] } etc.) must parse identically.
	for (const wrapper of ['template', 'templates', 'itemTemplate']) {
		const wrapped = specialTradeDexFromGameMaster({ [wrapper]: sample });
		check(
			`wrapped game master shape '{ ${wrapper}: [...] }' parses identically`,
			wrapped.size === 3 && wrapped.has(793) && wrapped.has(150) && wrapped.has(808),
		);
	}
	check('unrecognized object payload yields empty set', specialTradeDexFromGameMaster({ foo: 1 }).size === 0);
}

console.log('\nScenario 12: generations parser — every plausible pogoapi shape yields the starter bases');
{
	// Gen-1 (dex 1-12 sample) must always yield bases 1/4/7; gen-2 sample
	// (152-160) must yield 152/155/158. One fixture per handled shape.
	const gen1ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
	const gen2ids = [152, 153, 154, 155, 156, 157, 158, 159, 160];
	const expect = (label, generations) => {
		const s = starterDexFromGenerations(generations);
		check(
			label,
			[1, 4, 7, 152, 155, 158].every((d) => s.has(d)) && !s.has(2) && !s.has(3) && !s.has(10),
			JSON.stringify([...s].sort((a, b) => a - b)),
		);
	};
	const entry = (id) => ({ pokemon_id: id, pokemon_name: `p${id}` });
	expect('A: array of {pokemon_id, generation_number}', [
		...gen1ids.map((id) => ({ pokemon_id: id, generation_number: 1 })),
		...gen2ids.map((id) => ({ pokemon_id: id, generation_number: 2 })),
	]);
	expect('B: object generation → entry list', {
		generation_1: gen1ids.map(entry),
		generation_2: gen2ids.map(entry),
	});
	// B-live: the REAL feed shape captured from the 2026-07-18 sync log —
	// "Generation 1" keys and entries with `id` (NOT pokemon_id) fields.
	expect('B-live: { "Generation 1": [{ generation_number, id, name }] } (actual pogoapi shape)', {
		'Generation 1': gen1ids.map((id) => ({ generation_number: 1, id, name: `p${id}` })),
		'Generation 2': gen2ids.map((id) => ({ generation_number: 2, id, name: `p${id}` })),
	});
	expect('C: object generation → keyed-by-id', {
		generation_1: Object.fromEntries(gen1ids.map((id) => [id, { name: `p${id}` }])),
		generation_2: Object.fromEntries(gen2ids.map((id) => [id, { name: `p${id}` }])),
	});
	expect('D: object generation → dex range', {
		generation_1: { min_dex: 1, max_dex: 12 },
		generation_2: { min_dex: 152, max_dex: 160 },
	});
	expect('E: object pokemon-id → generation', {
		...Object.fromEntries(gen1ids.map((id) => [id, 'generation_1'])),
		...Object.fromEntries(gen2ids.map((id) => [id, 2])),
	});
	// F: name-keyed payloads need the stats-derived name→dex lookup.
	const nameToDex = new Map([...gen1ids, ...gen2ids].map((id) => [`mon-${id}`, id]));
	const named = starterDexFromGenerations(
		{
			...Object.fromEntries(gen1ids.map((id) => [`Mon ${id}`, 'generation_1'])),
			...Object.fromEntries(gen2ids.map((id) => [`Mon ${id}`, 2])),
		},
		9,
		nameToDex,
	);
	check(
		'F: object pokemon-name → generation (via name→dex lookup)',
		[1, 4, 7, 152, 155, 158].every((d) => named.has(d)) && !named.has(2),
		JSON.stringify([...named].sort((a, b) => a - b)),
	);
	expect('G: object pokemon-id → entry with generation field', {
		...Object.fromEntries(gen1ids.map((id) => [id, { generation_number: 1, name: `p${id}` }])),
		...Object.fromEntries(gen2ids.map((id) => [id, { generation_number: 2, name: `p${id}` }])),
	});
	expect('A2: per-generation array entries with nested species lists', [
		{ generation_number: 1, pokemon_species: gen1ids.map(entry) },
		{ generation_number: 2, pokemon_species: gen2ids.map(entry) },
	]);
	check('unrecognized payload yields empty set (assertion will trip loudly)', starterDexFromGenerations({ weird: true }).size === 0);
	// The Victini case (caught live): Unova's dex opens with a mythical at 494
	// before the starter trios — special-trade species are skipped before the
	// 0/3/6 trio pattern applies.
	const gen5 = starterDexFromGenerations(
		{ 'Generation 5': Array.from({ length: 10 }, (_, i) => ({ generation_number: 5, id: 494 + i, name: `p${494 + i}` })) },
		9,
		new Map(),
		new Set([494]),
	);
	check(
		'gen-5 starters skip Victini (494) and land on 495/498/501',
		gen5.has(495) && gen5.has(498) && gen5.has(501) && !gen5.has(494) && !gen5.has(497) && !gen5.has(500),
		JSON.stringify([...gen5].sort((a, b) => a - b)),
	);
}

if (failures > 0) {
	console.error(`\n${failures} friend-collect check(s) failed.`);
	process.exit(1);
}
console.log('\n✓ All friend-collect checks passed.');
