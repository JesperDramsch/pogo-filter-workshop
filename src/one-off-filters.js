// One-off tool strings: where to spend a Silver or Gold Bottle Cap, which
// special Pokémon to swap with a friend for fresh IVs, who still needs a
// third move, an Elite TM or a Max Move upgrade.
//
// Pure clause builders only. buildFilters (App.jsx) resolves every species
// name, move keyword and have-list clause in the output locale and hands them
// in, so scripts/check-one-offs.mjs can drive these with literal inputs and an
// evaluator, and nothing here reads a data file or the clock.
//
// Every builder returns a CNF chain as an array of clauses (comma = OR inside
// a clause, the caller joins clauses with `&`), or [] when there is nothing to
// look for.
//
// Spelling notes, the same rules the rest of the app follows:
//   - IV tokens take appraisal BARS 0-4, not IVs: `4attack` is a full bar.
//   - PoGo ignores `!` on IV tokens, so "bar not full" is the positive `0-3`.
//   - `!4*` (star token, not an IV token) negates fine; the trash uses it.

// Every way to pick `size` of `n` indices, in order.
function combinations(n, size) {
	const out = [];
	const pick = (start, acc) => {
		if (acc.length === size) return void out.push(acc);
		for (let i = start; i <= n - (size - acc.length); i++) pick(i + 1, [...acc, i]);
	};
	pick(0, []);
	return out;
}

// "At least k of these groups hold", each group an OR of terms, in CNF: every
// choice of n-k+1 groups must contain a true one. k=1 is one clause naming
// every term; k=2 is n clauses, each leaving out one group. null when fewer
// than k groups exist (nothing can satisfy it).
export function atLeastOf(groups, k) {
	const g = groups.map((x) => (x || []).filter(Boolean)).filter((x) => x.length > 0);
	if (k <= 0) return [];
	if (g.length < k) return null;
	return combinations(g.length, g.length - k + 1).map((combo) => combo.flatMap((i) => g[i]).join(','));
}

// Exactly two full bars: every pair of stats holds a full one (so at least
// two do), and the third is not full because the Pokémon is not a hundo.
export function twoFullBars(kw) {
	const { atk, def, hp } = kw.iv;
	return [`4${atk},4${def}`, `4${atk},4${hp}`, `4${def},4${hp}`, '!4*'];
}

// At most one full bar: no pair of stats is full together. Excludes every
// silver-cap candidate and every hundo by construction.
export function underTwoFullBars(kw) {
	const { atk, def, hp } = kw.iv;
	return [`0-3${atk},0-3${def}`, `0-3${atk},0-3${hp}`, `0-3${def},0-3${hp}`];
}

// The special properties a cap or a re-roll is worth spending on, one OR-group
// each: shiny, background, costume, legendary, mythical, and the user's own
// custom collectibles (species names, all one group).
export function specialGroups(kw, collectibles = []) {
	const { flag } = kw;
	return [[flag.shiny], [flag.background], [flag.costume], [flag.legendary], [flag.mythical], [...new Set(collectibles)]];
}

// Hyper Training (both caps) needs a Good Buddy or higher and refuses Shadow
// Pokémon and 15/15/15 ones; one already in training can't take another.
// The buddy level is the user's job (the gold hint says so), not a clause:
// the point of the string is what to start building towards.
function capBase(kw) {
	return [`!${kw.flag.shadow}`, `!${kw.flag.hyper_training}`];
}

// Silver Bottle Cap: one stat trained to full, so the target is a Pokémon two
// bars short of nothing, i.e. exactly one bar short of a hundo. Three
// strings, best first:
//   two_special  ≥2 special properties, family not on the hundo list
//   one_special  ≥1 special property,  family not on the hundo list
//   any_family   ≥2 special properties, hundo list ignored
// `hundoGaps` is the have-list clause chain (`!+root` / `!name`) that drops
// families the hundo list already covers; empty when the list is empty, and
// then any_family would repeat two_special, so it is left out.
export function silverCapFilters(kw, { collectibles = [], hundoGaps = [] } = {}) {
	const groups = specialGroups(kw, collectibles);
	const bars = twoFullBars(kw);
	const base = capBase(kw);
	const two = atLeastOf(groups, 2);
	const one = atLeastOf(groups, 1);
	const out = [
		{ key: 'two_special', clauses: [...bars, ...base, ...hundoGaps, ...two] },
		{ key: 'one_special', clauses: [...bars, ...base, ...hundoGaps, ...one] },
	];
	if (hundoGaps.length > 0) out.push({ key: 'any_family', clauses: [...bars, ...base, ...two] });
	return out;
}

// Gold Bottle Cap: every stat can be trained, so it goes where a silver one
// can't finish the job: ≥2 special properties with at most one full bar.
export function goldCapFilter(kw, { collectibles = [] } = {}) {
	return [...underTwoFullBars(kw), ...capBase(kw), ...atLeastOf(specialGroups(kw, collectibles), 2)];
}

// Re-roll trades: a traded Pokémon gets new IVs, so a special one with a poor
// roll is worth swapping with a friend for theirs. The game's trade rules
// (never traded before, not shadow, not lucky, not a mythical other than
// Meltan/Melmetal, not in Hyper Training), at most two stars, and fewer than
// two full bars: those go to a silver cap instead. `keeps` are the trade
// filter's own "never trade this one" clauses (tags, favourites, nundos,
// league tags, former buddies, PvP keepers, invested moves), so a Pokémon the
// user kept out of trading is never offered here either.
export function rerollTradeFilter(kw, { collectibles = [], keeps = [] } = {}) {
	const { flag } = kw;
	return [
		`!${flag.traded}`,
		`!${flag.shadow}`,
		`!${flag.lucky}`,
		`!${flag.mythical},808,809`,
		`!${flag.hyper_training}`,
		'0*,1*,2*',
		...underTwoFullBars(kw),
		...atLeastOf(specialGroups(kw, collectibles), 1),
		...keeps,
	];
}

// Third move: the named species that still have only one charged move
// (`@3move` matches exactly those), narrowed by `extra` (a league's CP cap and
// IV pattern, or a star floor).
export function thirdMoveFilter(kw, names, extra = []) {
	const pool = [...new Set(names.filter(Boolean))];
	if (pool.length === 0) return [];
	return [pool.join(','), `@${kw.flag.three_move}`, ...extra];
}

// Elite TM targets: species whose best moveset needs an Elite TM move, and
// which lack at least one of those moves. One clause per species,
// `!name,!@move…` = "if it is this species, it is missing one of its moves";
// the pool clause in front limits the string to those species. `targets` is
// [{ name, moves: [@-keyword…] }]; a target with no moves is skipped. The same
// name twice (two ranked forms folded together) keeps the moves both share.
export function eliteTmFilter(targets, extra = []) {
	const byName = new Map();
	for (const t of targets || []) {
		const moves = [...new Set((t.moves || []).filter(Boolean))];
		if (!t.name || moves.length === 0) continue;
		const prev = byName.get(t.name);
		byName.set(t.name, prev ? prev.filter((m) => moves.includes(m)) : moves);
	}
	const kept = [...byName].filter(([, moves]) => moves.length > 0);
	if (kept.length === 0) return [];
	return [kept.map(([name]) => name).join(','), ...kept.map(([name, moves]) => [`!${name}`, ...moves.map((m) => `!@${m}`)].join(',')), ...extra];
}

// Max Move upgrades: Max Moves go to level 3, so a Dynamax attacker on level
// 1 or 2 still has upgrades to buy. `names` are the Max attacker roster.
export function maxMoveUpgradeFilter(kw, names, extra = []) {
	const pool = [...new Set(names.filter(Boolean))];
	if (pool.length === 0) return [];
	return [pool.join(','), `${kw.flag.dynamax_move}1-2`, ...extra];
}
