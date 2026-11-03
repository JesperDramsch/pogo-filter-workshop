// Upstream move name or id → the canonical key App.jsx localises moves by
// (`move.<lowercase EN name>` in src/locales/en.json), or null.
//
// Two upstreams name moves differently from the dictionary:
//   - PvPoke's display names carry a type suffix on typed variants
//     ("Weather Ball (Fire)", "Techno Blast (Douse)", "Hidden Power (Ice)") and
//     a plain apostrophe ("Nature's Madness") where the dictionary has ’;
//   - Niantic's movementIds are SHOUTY_SNAKE ("WEATHER_BALL_FIRE",
//     "MUD_SLAP_FAST") and lose the hyphen ("mud-slap") entirely.
// So: drop a `(…)` suffix and a `_FAST` suffix, then compare letters and
// digits only (spaces, hyphens and apostrophes all vary between the two), and
// failing that, the name without a trailing type or Techno Blast drive word
// (WEATHER_BALL_FIRE → "weather ball"). Only those words: dropping any last
// word would turn a missing THUNDER_PUNCH into Thunder. PoGo's `@move` search
// matches the typeless name, so a typed variant resolving to it loses nothing.
// A move nothing resolves is the caller's to drop: a dead `@term` matches
// nothing in every locale, silently.

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const indexCache = new WeakMap();

// squashed name → canonical dictionary name, built once per dictionary.
function moveIndex(enMessages) {
	let idx = indexCache.get(enMessages);
	if (!idx) {
		idx = new Map();
		for (const k of Object.keys(enMessages)) {
			if (!k.startsWith('move.')) continue;
			const name = k.slice(5);
			if (!idx.has(squash(name))) idx.set(squash(name), name);
		}
		indexCache.set(enMessages, idx);
	}
	return idx;
}

export function canonicalMoveName(raw, enMessages) {
	const idx = moveIndex(enMessages);
	const base = String(raw || '')
		.replace(/\s*\([^)]*\)\s*$/, '')
		.replace(/_FAST$/, '')
		.replace(/_/g, ' ')
		.toLowerCase()
		.trim();
	if (!base) return null;
	const words = base.split(/\s+/);
	const names = [base];
	if (words.length > 1 && VARIANT_WORDS.has(words[words.length - 1])) names.push(words.slice(0, -1).join(' '));
	for (const name of names) if (idx.has(squash(name))) return idx.get(squash(name));
	return null;
}

const VARIANT_WORDS = new Set([
	'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
	'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
	'burn', 'chill', 'douse', 'shock',
]);
