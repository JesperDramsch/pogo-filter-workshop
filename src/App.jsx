import React, { useState, useEffect, useMemo, useRef, useId, Fragment } from 'react';
import { Dialog } from './Dialog.jsx';
import * as d3 from 'd3';
import {
	X,
	Plus,
	Copy,
	Check,
	ChevronDown,
	ChevronRight,
	RotateCcw,
	Sparkles,
	Settings,
	ArrowLeft,
	Download,
	Upload,
} from 'lucide-react';
import { POKEMON_NAMES_DICT, resolveSpecies, resolveSpeciesInfo, pokemonNameFor } from './data/species.js';
import { pogoKeywords, typeKeyFromKeyword, flagKeyFromKeyword } from './i18n/pogo-keywords.js';
import RAID_BOSSES from './data/raid-bosses.json';
import EVENTS from './data/events.json';
import ROCKET_LINEUPS from './data/rocket-lineups.json';
import ROCKET_GRUNT_QUOTES from './data/rocket-grunt-quotes.json';
import RocketQuoteLookup from './explain/RocketQuoteLookup.jsx';
import PVP_RANKINGS from './data/pvp-rankings.json';
import META_RANKINGS from './data/meta-rankings.json';
import EVOLUTION_COSTS from './data/evolution-costs.json';
import SPECIES_META from './data/species-meta.json';
import REGIONAL_FORMS from './data/regional-forms.json';
import CHANGELOG from './data/changelog.json';
import { useTranslation } from './i18n/I18nProvider.jsx';
import { useAnnounce } from './Announcer.jsx';
import Landing from './Landing.jsx';
import General from './explain/General.jsx';
import Regional from './explain/Regional.jsx';
import Trade from './explain/Trade.jsx';
import Rules from './explain/Rules.jsx';
import Algebra from './explain/Algebra.jsx';
import SwipeOnboarding from './SwipeOnboarding.jsx';
import { AppCredit, WorkshopNav, WORKSHOP_STEPS, STEP_KEY_BY_NUMBER, STEP_NUMBER_BY_KEY } from './explain/Shell.jsx';

// Hash-driven routing.
//   ""                    → landing  (the marketing front door)
//   "#workshop"           → workshop (the actual tool)
//   "#explain/general"    → General  (storage triage chapter)
//   "#explain/regional"   → Regional
//   "#explain/trade"      → Trade
//   "#rules"              → Rules
//   "#explain/algebra"    → Algebra  (set-theory deep dive)
// Hash routing avoids the GitHub Pages 404-on-direct-load problem real paths
// would have without a 404.html shim. Everything is shareable/bookmarkable
// and the browser back/forward buttons work for free.
const VIEW_BY_HASH = {
	'': 'landing',
	'#workshop': 'workshop',
	'#explain/general': 'general',
	'#explain/regional': 'regional',
	'#explain/trade': 'trade',
	'#rules': 'rules',
	'#explain/algebra': 'algebra',
	'#onboard': 'onboard',
};
const HASH_BY_VIEW = {
	landing: '',
	workshop: '#workshop',
	general: '#explain/general',
	regional: '#explain/regional',
	trade: '#explain/trade',
	rules: '#rules',
	algebra: '#explain/algebra',
	onboard: '#onboard',
};
// Step-keyed workshop hashes (#workshop/where, #workshop/what, ...) all map
// to the workshop view; the specific step is parsed by `stepFromHash`.
function viewFromHash() {
	if (typeof window === 'undefined') return 'landing';
	const hash = window.location.hash;
	if (hash.startsWith('#workshop/')) return 'workshop';
	return VIEW_BY_HASH[hash] || 'landing';
}
function stepFromHash() {
	if (typeof window === 'undefined') return null;
	const m = window.location.hash.match(/^#workshop\/(\w+)$/);
	if (!m) return null;
	return STEP_NUMBER_BY_KEY[m[1]] ?? null;
}
function navigateView(target) {
	if (typeof window === 'undefined') return;
	const hash = HASH_BY_VIEW[target] ?? '';
	if (hash === '') {
		if (window.location.hash) {
			window.history.pushState(null, '', window.location.pathname + window.location.search);
			// pushState doesn't fire hashchange, so dispatch a popstate-equivalent.
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		}
	} else if (window.location.hash !== hash) {
		window.location.hash = hash;
	}
}

// ─── DATA ──────────────────────────────────────────────────────────────────

export const DEFAULT_HUNDOS = [];
// Personal "lucky Pokémon" roster — species the user has at least one
// lucky of. Where this overlaps with DEFAULT_HUNDOS, duplicate copies
// have no remaining purpose (neither IV-chasing nor lucky-friend
// trading) and get swept into trash, never trade. L \ H still keeps
// the standard trash/trade behaviour. Stored as lowercase species
// names; canonicalized on load via `resolveSpecies`.
export const DEFAULT_LUCKIES = [];
// Personal "top raid attackers" — species the user trusts to bring to a raid
// regardless of typing. Used as an OR-allowlist alongside the type-resistor /
// SE-move clauses, so e.g. Mewtwo always surfaces even when its Psychic
// typing isn't a strict resistor for the boss. Stored as lowercase species
// names; canonicalized to the user's locale on load via `resolveSpecies`.
// Forms (Shadow / Mega / Primal) fold into the base species via family
// search — `mewtwo` covers Shadow Mewtwo and Mega Mewtwo Y both.
//
// Seed source: `src/data/meta-rankings.json` (regenerated daily by
// scripts/fetch-meta-rankings.mjs from pogoapi.net stats + moves). Score
// per (species, type) = base_attack × max charged-move power of that type;
// top-8 per type, deduped union, sorted by best-score-across-types. Killing
// the prior hand-curated tier-list constant: meta drifts every move
// rebalance, so a daily-refreshed data feed beats periodic manual updates.
export const DEFAULT_TOP_ATTACKERS = META_RANKINGS.topAttackers;

// Personal "top Max Battle attackers" — same idea but only relevant to
// Dynamax/Gigantamax encounters. Seed source: same meta-rankings.json,
// filtered through the Dynamax-eligibility seed in fetch-meta-rankings.mjs
// (pogoapi has no Dynamax flag, so the eligibility set is hand-maintained;
// ranking within it is data-driven). Forms fold into base species —
// `charizard` covers Gigantamax Charizard.
export const DEFAULT_TOP_MAX_ATTACKERS = META_RANKINGS.topMaxAttackers;

// Mythical dex numbers that can NEVER be traded — used to keep untradeable
// species out of the friend-collect suggestion sets (they'd be inert against
// the `!mythical` trade guard anyway, just noise in the chips). Meltan (808)
// and Melmetal (809) are mythical but tradeable, so they're deliberately NOT
// in this set — mirrors the `!mythical,808,809` guard carve-out.
const UNTRADEABLE_MYTHICAL_DEX = new Set([
	151, // Mew
	251, // Celebi
	385, // Jirachi
	386, // Deoxys
	489, // Phione
	490, // Manaphy
	491, // Darkrai
	492, // Shaymin
	493, // Arceus
	494, // Victini
	647, // Keldeo
	648, // Meloetta
	649, // Genesect
	719, // Diancie
	720, // Hoopa
	721, // Volcanion
	801, // Magearna
	802, // Marshadow
	807, // Zeraora
	893, // Zarude
	1025, // Pecharunt
]);

// Species that only move in a Special Trade (legendaries, mythicals, Ultra
// Beasts) — they never belong in a regular-trade friend-collect pack. Derived
// snapshot from pogoapi (rarity Legendary ∪ Mythic ∪ raid-exclusives),
// regenerated daily by scripts/fetch-species-meta.mjs — no hand-maintained
// list here. Note Meltan/Melmetal ARE in this set: tradeable (unlike other
// mythicals, hence the `!mythical,808,809` wishlist guard keeps them), but
// only as a Special Trade — so packs never suggest them. The same snapshot
// supplies the starter, "power line" and mega pack pools below.
const SPECIAL_TRADE_DEX = new Set(SPECIES_META.specialTradeDex);

// Baby stages (Pichu, Riolu, Toxel & co.) — the fixed 19-species game
// mechanic, hand-maintained like TRADE_EVO_FAMILIES (no feed carries a baby
// flag). Used by collectibleBaseDex below: a friend-collect pack should ask
// for the stage ABOVE the baby (Pikachu, not Pichu) — babies are egg-centric
// rare catches, and a lucky/hundo baby still has to be evolved out of the
// baby stage before it's the thing the user actually wanted.
const BABY_DEX = new Set([
	172, // Pichu
	173, // Cleffa
	174, // Igglybuff
	175, // Togepi
	236, // Tyrogue
	238, // Smoochum
	239, // Elekid
	240, // Magby
	298, // Azurill
	360, // Wynaut
	406, // Budew
	433, // Chingling
	438, // Bonsly
	439, // Mime Jr.
	440, // Happiny
	446, // Munchlax
	447, // Riolu
	458, // Mantyke
	848, // Toxel
]);

// Child dex → parent dex for every evolution step (species-meta feed, GM +
// pogoapi union). Old snapshots without the field degrade gracefully: every
// species counts as its own base and the packs behave as before.
const EVO_PARENT_BY_DEX = SPECIES_META.evoParentByDex || {};
// Inverse (parent → children), for the one walk the parent map can't do:
// hopping DOWN from a baby that is itself the candidate.
const EVO_CHILDREN_BY_DEX = (() => {
	const m = new Map();
	for (const [child, parent] of Object.entries(EVO_PARENT_BY_DEX)) {
		const key = String(parent);
		if (!m.has(key)) m.set(key, []);
		m.get(key).push(parseInt(child, 10));
	}
	return m;
})();

// Species where the GENDER of an owned lucky/hundo decides whether the
// collection slot is really filled. The value lists the gender(s) that unlock
// something the other gender cannot — so it is a Map, not a Set: clicking ♀ on
// Wadribie completes it, clicking ♂ does not. Two mechanically distinct groups
// share one shape. No feed carries either fact, so this is hand-maintained
// alongside BABY_DEX and TRADE_EVO_FAMILIES.
//
// Deliberately NOT here: Burmy 412, whose gender and cloak interact (♀ carries
// the cloak into Burmadame, ♂ becomes Moterpel regardless) — it needs one
// combined slot group, which belongs with the un-searchable form work. And
// Salmagnis 902, which is not released in PoGo.
//
// Every dex below is absent from regional-forms.json, so a have-list chip can
// never render a gender group AND a form group at once (asserted in
// scripts/check-lucky-logic.mjs).
const GENDER_SLOT_DEX = new Map([
	// (a) gender-LOCKED evolutions — the other gender is a dead end
	[415, ['female']], // Wadribie → Honweisel (♂ has no evolution at all)
	[757, ['female']], // Molunk → Amfira (♂ dead end; only 12.5% of catches are ♀)
	[361, ['female']], // Schneppke → Frosdedje (either gender → Firnontor)
	[280, ['male']], // Trasla → … → Galagladi (either gender → Guardevoir)
	[281, ['male']], // Kirlia → Galagladi
	// (b) gender-DETERMINED forms — both genders are distinct dex entries
	[678, ['female', 'male']], // Psiaugon (different charged moves per gender)
	[876, ['female', 'male']], // Servol (different base stats + moves)
	[916, ['female', 'male']], // Fragrunz (different base stats)
	[668, ['female', 'male']], // Pyroleo
	[592, ['female', 'male']], // Quabbel
	[593, ['female', 'male']], // Apoquallyp
]);

// Species carrying several collection slots that PoGo search CANNOT tell
// apart: every form shares one dex entry AND one type combination, and there
// is no form keyword. Nothing here can ever become a filter guard — these are
// tracked purely so the app knows the species isn't finished, and the friend
// wishlists keep asking for it until every slot is ticked.
//
// No upstream feed carries this (Sesokitz isn't even in pogoapi's types
// dataset), so it is hand-maintained. The bar for entry is deliberately high:
// forms that DO differ by type belong in regional-forms.json instead, where
// they become real search guards — that is where Burmadame's cloaks and
// Choreogel's styles now live.
const INVISIBLE_FORM_SLOTS = {
	585: { axis: 'season', slots: ['spring', 'summer', 'autumn', 'winter'] }, // Sesokitz
	586: { axis: 'season', slots: ['spring', 'summer', 'autumn', 'winter'] }, // Kronjuwild
	421: { axis: 'cherrim', slots: ['overcast', 'sunny'] }, // Kinoso — fixed at evolution
	// Burmy: gender and cloak interact rather than stacking — ♀ carries the
	// cloak into Burmadame, ♂ becomes Moterpel and the cloak is discarded. So
	// it is ONE four-slot group, not a gender group plus a cloak group, and the
	// chip still renders a single row. (Burmadame itself is type-searchable.)
	412: { axis: 'burmy', slots: ['male', 'plant', 'sandy', 'trash'] },
	925: { axis: 'maushold', slots: ['family3', 'family4'] }, // ~99:1 roll
	982: { axis: 'dudunsparce', slots: ['twoseg', 'threeseg'] }, // ~99:1 roll
};

// Evolution lines whose branch is decided by an UNCONTROLLABLE 50:50 roll, so
// owning one tip says nothing about the other. PoGo's `+` is the CANDY family,
// which makes the usual `!+family` exclusion far too coarse here: `!+Schaloko`
// also hides the friend's whole Panekon/Pudox branch — the very thing the
// wishlist still wants. Members get bare (non-`+`) selectors instead, and the
// line only collapses back to `!+base` once every branch is covered.
//
// Tyrogue is deliberately absent: its three-way split is decided by the highest
// IV, which the player controls. (A hundo Tyrogue ties on all three and does
// roll randomly — a rounding error against the cost of a wrong exclusion.)
// Maushold and Dudunsparce are same-dex FORM splits rather than separate
// species, so they cannot be enumerated by name at all.
const SPLIT_FAMILIES = [
	// Waumpel → Schaloko → Papinella | Panekon → Pudox
	{ baseDex: 265, branches: [[266, 267], [268, 269]] },
	// Perlu → Aalabyss | Saganabyss (both pure Water — no type predicate exists)
	{ baseDex: 366, branches: [[367], [368]] },
];
// dex → its SPLIT_FAMILIES entry, for the base and every branch member alike.
const SPLIT_FAMILY_BY_DEX = (() => {
	const m = new Map();
	for (const fam of SPLIT_FAMILIES) {
		m.set(fam.baseDex, fam);
		for (const branch of fam.branches) for (const d of branch) m.set(d, fam);
	}
	return m;
})();

// Baby stages whose `eggsonly` membership is NOT confirmed against the live
// Game Master: its baby flag lists 18 species, and Toxel is absent even though
// the species debuted egg-only. Widening an exclusion with `eggsonly` here
// would risk HIDING the friend's copy — the exact failure the widening exists
// to prevent — so these fall back to exact-name enumeration instead.
const EGGSONLY_UNVERIFIED_DEX = new Set([848]); // Toxel

// The stage a friend-collect pack should actually suggest for a species:
// the base of its evolution line — trades re-roll IVs and luckiness sticks,
// so the base covers the whole line by evolving, while an evolved copy can
// never become the base (a lucky Greedent is not a lucky Skwovet). Two
// exceptions. Per the babies rule above: when the line bottoms out in a baby,
// the collectible base is the stage directly above it (Raichu → Pikachu, not
// Pichu). A candidate that IS a baby hops down to its child when that child
// is unambiguous; Tyrogue (three children) stays put — the pack preview
// toggles let the user drop it by hand. And per SPLIT_FAMILIES: the walk stops
// at the branch's own base, so a pack that wants Papinella asks for Schaloko
// rather than a 50/50 Waumpel. Exported for the offline checks in
// scripts/check-friend-collect.mjs.
export function collectibleBaseDex(dex) {
	const path = [dex];
	let cur = dex;
	// Cycle-guarded walk to the root of the line (real lines are ≤4 hops).
	while (EVO_PARENT_BY_DEX[String(cur)] !== undefined && path.length < 10) {
		const parent = EVO_PARENT_BY_DEX[String(cur)];
		// Don't walk down INTO a coin flip — the branch base is as low as a
		// suggestion can go and still be the thing the user asked for.
		const fam = SPLIT_FAMILY_BY_DEX.get(parent);
		if (fam && fam.baseDex === parent) break;
		cur = parent;
		if (path.includes(cur)) break;
		path.push(cur);
	}
	if (!BABY_DEX.has(cur)) return cur;
	if (path.length >= 2) return path[path.length - 2];
	const children = EVO_CHILDREN_BY_DEX.get(String(cur)) || [];
	return children.length === 1 ? children[0] : cur;
}

// The baby stage at the root of a line, when the line HAS one and it isn't the
// species itself. Babies only hatch from eggs and can never be de-evolved, so
// an owned adult says nothing about the baby slot: a lucky Magmar is not a
// lucky Magby. Returns null for lines without a baby, and for a baby itself
// (evolving a lucky baby upward IS free, so the relation is directional).
// Exported for the offline checks in scripts/check-lucky-logic.mjs.
export function babyStageDex(dex) {
	let cur = dex;
	const seen = new Set([cur]);
	while (EVO_PARENT_BY_DEX[String(cur)] !== undefined && seen.size < 10) {
		cur = EVO_PARENT_BY_DEX[String(cur)];
		if (seen.has(cur)) break;
		seen.add(cur);
	}
	return cur !== dex && BABY_DEX.has(cur) ? cur : null;
}

// The root of a species' evolution line — the plain walk, with none of
// collectibleBaseDex's baby / coin-flip special-casing. Two species share a
// PoGo candy family exactly when they share this root, which is what `+name`
// expands to.
function lineRootDex(dex) {
	let cur = dex;
	const seen = new Set([cur]);
	while (EVO_PARENT_BY_DEX[String(cur)] !== undefined && seen.size < 10) {
		cur = EVO_PARENT_BY_DEX[String(cur)];
		if (seen.has(cur)) break;
		seen.add(cur);
	}
	return cur;
}

// The species plus everything it can still evolve into — exactly the set one
// owned lucky/hundo genuinely covers, since luckiness and IVs both survive
// evolution but nothing can ever be de-evolved.
function selfAndDescendants(dex) {
	const out = [dex];
	for (let i = 0; i < out.length && out.length < 10; i++)
		for (const child of EVO_CHILDREN_BY_DEX.get(String(out[i])) || [])
			if (!out.includes(child)) out.push(child);
	return out;
}

// Every name that `+X` could use to select this species — i.e. the species plus
// every other member of its candy family, lowercased in the output locale.
// `+name` selects on the candy family, so owning a hundo Pikachu makes the
// filter's `+pikachu` term match a Raichu too; anything modelling a mon for
// evalFilter has to know that. Returns [] for unresolvable input.
// Exported for VerifyPanel and scripts/check-verify.mjs.
export function candyFamilyNames(species, outputLocale = 'de') {
	const info = resolveSpeciesInfo(species);
	if (!info) return [];
	return [
		...new Set(
			selfAndDescendants(lineRootDex(info.dex))
				.map((d) => pokemonNameFor(String(d), outputLocale))
				.filter(Boolean)
				.map((n) => n.toLowerCase()),
		),
	];
}

// Does any hundo sit in the same candy family as `species`? A raw string
// compare gets this wrong twice over: hundos are stored in whatever output
// locale was active when they were typed (an imported "Charizard" and a typed
// "glurak" are the same mon), and the filter's `+name` term selects the whole
// candy family, so a hundo Pikachu covers a Raichu. Compare on the line root —
// the same identity `+name` itself uses. Mirrors the canonKey idea in
// buildFilters, one level up from names to families.
// Exported for scripts/check-verify.mjs.
export function hundoFamilyMatch(hundos, species) {
	const info = resolveSpeciesInfo(species);
	if (!info) return false;
	const root = lineRootDex(info.dex);
	return (hundos || []).some((h) => {
		const hi = resolveSpeciesInfo(h);
		return !!hi && lineRootDex(hi.dex) === root;
	});
}

// Trade-evo families: dex-keyed identity, German base name as the user-facing
// config key (kept stable so persisted localStorage state ["abra", "machollo"]
// keeps working across locale changes). `baseDex` is the family head for
// `+Family` rendering; `memberDex` is the full evolution line for hundo-overlap
// detection.
const TRADE_EVO_FAMILIES = {
	abra: { baseDex: 63, memberDex: [63, 64, 65] },
	machollo: { baseDex: 66, memberDex: [66, 67, 68] },
	kleinstein: { baseDex: 74, memberDex: [74, 75, 76] },
	nebulak: { baseDex: 92, memberDex: [92, 93, 94] },
	kiesling: { baseDex: 524, memberDex: [524, 525, 526] },
	praktibalk: { baseDex: 532, memberDex: [532, 533, 534] },
	laukaps: { baseDex: 588, memberDex: [588, 589] },
	schnuthelm: { baseDex: 616, memberDex: [616, 617] },
	paragoni: { baseDex: 708, memberDex: [708, 709] },
	irrbis: { baseDex: 710, memberDex: [710, 711] },
};

// Capitalized base species name in the user's PoGo *output* language —
// used in `+Family` filter syntax. Falls back to the German config key if
// the locale dictionary is missing the entry.
function teDisplay(baseKey, outputLocale = 'de') {
	const family = TRADE_EVO_FAMILIES[baseKey];
	const fallback = baseKey.charAt(0).toUpperCase() + baseKey.slice(1);
	if (!family) return fallback;
	const name = pokemonNameFor(String(family.baseDex), outputLocale);
	if (!name) return fallback;
	return name.charAt(0).toUpperCase() + name.slice(1);
}

export const DEFAULT_CONFIG = {
	// Mode
	expertMode: false, // hides niche toggles in normal mode

	// PvP
	pvpMode: 'strict', // "loose" | "intelligent" | "strict" | "none"
	// "Intelligent" splits the PvP carve-out in two: everything gets the base
	// tier (strict by default — a perfect 0/3-4/3-4 spread is cheap insurance
	// against a future buff), and the species you actually play get the wider
	// meta tier. The list starts EMPTY on purpose; one tap seeds it from the
	// Superliga/Hyperliga packs (pvpMetaPacks), and it is curated from there.
	// With an empty list, intelligent is byte-identical to the base tier.
	pvpMetaSpecies: [],
	pvpMetaTier: 'loose', // IV tier for the curated list — "loose" | "strict"
	pvpBaseTier: 'strict', // IV tier for everything else — "loose" | "strict" | "none"

	// Universal protections (most always-on in normal mode; visible in expert)
	protectFavorites: true,
	protectFourStar: true, // never toss any 4★ hundo (Regel 1) — expert can disable with confirmation
	// Treat 0/0/0 IV catches as collectibles: AND-guards in trash/trade/shadow
	// keep them safe, and an nundoSort FilterBox surfaces them for browsing.
	// Default off — most users don't care; expert opt-in only.
	protectNundos: false,
	protectTradeEvos: true, // protect trade-evolution candidates from trash (free evos via tausch)
	// Once a regional has been traded, the "keep it for trade" rationale is
	// spent — bad-IV traded Alolan Raichu (Psychic) etc. fall into trash like
	// any other dupe. Mirrors the trade-evo carve-out above (`,traded` token).
	// Trade-buddy stockpiles tagged with a configured buddy's prefix (e.g.
	// #Auri:abra) are still auto-protected by the per-buddy `!#${prefix}`
	// clause; ad-hoc keepers use #Trade / #Fern-Tausch / custom tags. Off =
	// legacy unconditional protection for every regional form.
	trashTradedRegionals: true,
	protectAnyTag: true, // protects ANY tagged Pokémon (catch-all !# clause)
	protectShinies: true,
	protectLuckies: true,
	protectLegendaries: true,
	protectMythicals: true,
	// Species you have spares of, carved OUT of `!mythical` as `!mythical,<name>`
	// (comma = OR, so a listed species stops being protected). Ships EMPTY on
	// purpose: a non-empty default silently strips mythical protection from
	// someone else's limited research/Mystery-Box catch. Opt in per account.
	mythTooManyOf: [], // (canonicalized on load)
	protectUltraBeasts: true,
	protectShadows: true, // Crypto in trash; trade ALWAYS excludes (untradeable)
	// Narrow floor for the shadow carve-out (mirrors protectGigantamax under
	// protectDynamax): only bites when protectShadows is OFF. Keeps purify-worthy
	// shadows (purify-hundo IVs / cheap-to-purify / TM'd) out of trash and lets
	// expensive low-IV junk go. Default true but suppressed while the broad flag
	// is on, so default output stays byte-identical.
	protectShadowPurifyOnly: true,
	protectPurified: true,
	protectCostumes: true,
	protectBackgrounds: true,
	protectLegacyMoves: true,
	// Smeargle's Sketched moveset always carries the @special flag — without
	// a carve-out, every single Smeargle gets auto-protected. False (default)
	// adds `,smeargle` to the legacy-moves trash clause so regular Smeargles
	// still go in the bin. Expert users can flip this on to revert.
	protectSmeargleLegacy: false,
	protectBabies: true,
	protectXXL: true,
	protectXL: true,
	protectXXS: true,
	protectDoubleMoved: true,
	protectDynamax: true,
	// Gigantamax floor. Default ON but suppressed (never emitted) whenever
	// protectDynamax is on, since Gigantamax-capable is a subset of Dynamax-
	// capable. Only bites when broad Dynamax protection is off: keeps the rare
	// Giga species while ordinary Dynamax commons become releasable.
	protectGigantamax: true,
	protectNewEvolutions: true, // (was protectMegaConditional — name simplified, mega0 logic preserved)
	protectBuddies: false,

	// Trade tags (both protected as TAGS in PoGo via #name syntax)
	basarTagName: 'Trade', // bulk trade tag (was hardcoded #)
	fernTauschTagName: 'Fern-Tausch', // Niantic's official long-distance trade tag (Dec 2025)
	// EvoSwap tag — used by the trade-buddy purified-dex coordination filter
	// in the Team Rocket aux section. Renaming lets you run multiple parallel
	// swap campaigns ("EvoSwap-Maja", "EvoSwap-Tom") without overlap.
	evoSwapTagName: 'EvoSwap',

	// Custom tag protections — comma-separated list of additional #tags to protect
	customProtectedTags: '', // e.g. "pvpiv,keep,shiny-hunting"

	// League tags — configurable for users with different naming conventions
	leagueTags: 'ⓤ,ⓖ,ⓛ', // comma-separated; my default uses Unicode circles

	// Regional groups (populated by App init)
	regionalGroups: {},
	enabledTradeEvos: [],
	customCollectibles: [], // user-added species to protect (lowercase German names)
	// "Have friends collect for me" — curated species list for the positive
	// friend-collect wishlist (lowercase German names, like customCollectibles).
	// Entries stay stored even once found; the string just stops emitting them
	// (mode switches or resets bring them back without retyping).
	friendCollectSpecies: [],
	// Which goal prunes the curated wishlist: 'lucky' (default) | 'hundo' |
	// 'both' ('both' = covered only once lucky AND hundo are owned).
	friendCollectMode: 'lucky',
	// Restrict the curated wishlist string to guaranteed-lucky old catches
	// (lucky mode only). Persisted config rather than per-session UI state —
	// it's a curation setting like the mode above.
	friendCollectGuaranteedOnly: false,
	// Coverage overrides: curated species that stay in the string even though
	// the current focus counts them as owned (e.g. keep hunting the hundo on a
	// species whose lucky already landed). Subset of friendCollectSpecies.
	friendCollectForced: [],
	// Per-target refinements — click-only (chip pickers; typed input never
	// sets these). Keys are canonical storage-locale species names, kept a
	// subset of friendCollectSpecies on merge.
	//   friendCollectGenders:   { species: 'male' | 'female' } — emits a
	//     scoped `!species,<gender>` guard (Combee/Salandit gender locks).
	//   friendCollectDropForms: { species: [formKey, …] } — regional forms
	//     the friend should NOT collect, buddy dropForms semantics; emits one
	//     `!species,<De Morgan types>` guard per dropped form. Only species
	//     in the regional-forms catalog.
	friendCollectGenders: {},
	friendCollectDropForms: {},
	// Form annotations for the have-lists: which regional form(s) the owned
	// lucky/hundo actually is ({ species: [formKey, …] }). Click-only badges
	// on the step-3 chips; absent key = form unknown → exactly today's
	// species-level behavior everywhere. Consumed by (a) the friend-collect
	// coverage predicate and (b) form-scoped `!+family` exclusions in the
	// fallback wishlists. hundos/luckies live outside config, so stale keys
	// are pruned in the chip handlers and ignored by consumers, not in merge.
	hundoForms: {},
	luckyForms: {},
	// Gender annotations for the have-lists, the exact sibling of the form maps
	// above ({ species: ['female' | 'male', …] }). Only for GENDER_SLOT_DEX
	// species, where the wrong gender is a dead end (a ♂ Wadribie never becomes
	// Honweisel) or where gender picks a distinct dex entry (Psiaugon). Absent
	// key = gender unknown → exactly today's species-level behavior. Same
	// stale-key rule as the form maps: pruned in the chip handlers, not in merge.
	hundoGenders: {},
	luckyGenders: {},
	// Un-searchable slot annotations ({ species: [slotKey, …] }) for the
	// INVISIBLE_FORM_SLOTS species. PoGo search cannot express these, so they
	// never become a guard — their ONLY effect is that the friend wishlists
	// keep asking for the species until every slot is ticked, instead of
	// excluding the whole family the moment one copy lands.
	hundoSlots: {},
	luckySlots: {},
	// Sesokitz / Kronjuwild spawn in the season matching your hemisphere. The
	// app infers it from your home pin plus the live in-game Season window and
	// highlights the slot you can actually fill right now. Purely a UI hint —
	// it never reaches buildFilters, because a clock inside a pure function
	// would make the golden fixture non-deterministic. seasonAuto turns the
	// inference off; seasonOverride pins a season by hand and wins over both.
	seasonAuto: true,
	seasonOverride: null,
	// Trade buddies — list of { id, name, tagPrefix, events: [event-names] }
	// tagPrefix matches any sub-tag (e.g. #Auri matches #Auri:hat-pika via PoGo prefix match).
	buddies: [],

	// Scope safety
	cpCap: 2000,
	ageScopeDays: 30, // "Vor wie vielen Tagen gefangen — Filterumfang"
	distanceProtect: 100, // km — Pilot medal protection
	// Lucky-trade protection: catches from this year or earlier are likely
	// guaranteed-lucky candidates (PoGo's lucky-trade window grows with age).
	// Emits `year{N}-` as an AND-clause so old untraded mons stay out of the
	// bulk trash/trade/gift/cheap-evolve outputs. Disable in expert mode by
	// flipping `protectLuckyEligible` off or setting the year to 0.
	protectLuckyEligible: true,
	luckyEligibleYear: 21, // 2-digit year cutoff; mons caught in this year or later are still trashable

	// Shadows you'd never purify, even during take-over events. Acts as
	// belt-and-suspenders alongside !legendär — the legendary entries here
	// duplicate that protection so the list stays complete if the global
	// flag is ever toggled off. Non-legendary entries cover S / A+ / A tier
	// shadow raid attackers per the community / META.md tier lists, focusing
	// on species without a relevant Mega form (where Shadow IS the canonical
	// top form). Resolved via `resolveSpecies` so users can type in any
	// locale; expanded family-wide (+species) by shadowSafe.
	shadowKeeperSpecies: [
		// S tier shadows
		'dialga',
		'palkia',
		'heatran',
		'groudon',
		'rampardos',
		'salamence',
		'mewtwo',
		// A+ tier shadows
		'greninja',
		'hydreigon',
		'darkrai',
		'toucannon',
		'vikavolt',
		'tyrantrum',
		'conkeldurr',
		'darmanitan',
		'chandelure',
		'excadrill',
		'regigigas',
		'gigalith',
		'kyogre',
		'mamoswine',
		'electivire',
		'magnezone',
		'garchomp',
		'rhyperior',
		'metagross',
		'tyranitar',
		'blaziken',
		'ho-oh',
		'raikou',
		'gardevoir',
		'swampert',
		'dragonite',
		'moltres',
		'gengar',
		'machamp',
		// A tier shadows
		'landorus',
		'kingler',
		'delphox',
		'chesnaught',
		'giratina',
		'emboar',
		'honchkrow',
		'latios',
		'staraptor',
		'weavile',
		'crawdaunt',
		'absol',
		'hariyama',
		'sceptile',
		'entei',
		'aerodactyl',
		'zapdos',
		// A tier non-Mega shadow attackers (Shadow is the top form for these)
		'togekiss',
		'roserade',
		'toxicroak',
		'glaceon',
		'espeon',
		'sylveon',
	],

	// Optional tag bookkeepers can use to manually flag a non-keeper shadow
	// for Frustration removal during a take-over (e.g. a high-IV gem they
	// want to keep but isn't on the meta-attacker list). Empty by default.
	removeFrustrationTagName: '',

	// Raid + max-battle counter filters. When true, appends `&!@3move` to
	// every per-boss filter, narrowing the result to attackers whose second
	// charge move is already unlocked. Default off so newer accounts still
	// see candidates worth investing in.
	raidRequireSecondMove: false,

	// Team Rocket lenient fallback. When true, each leader phase / typed grunt
	// gets a SECOND "broad" counter FilterBox next to the strict one: any
	// super-effective move in ANY slot OR a high-CP bulky pick, still guarded
	// against the lineup's weaknesses. The strict filter often collapses to a
	// handful of mons (it demands an SE fast AND SE charge move on one species),
	// so this surfaces more of the user's box. Default on; toggle visible in
	// normal mode too.
	rocketLenientCounters: true,

	// The preset key the user last clicked, if they haven't tweaked anything
	// in ConfigPanel since. Cleared by any individual toggle change so the
	// marker reflects "what's currently in effect" rather than just history.
	lastAppliedPreset: null,
};

// ─── REGIONAL FORM CHECKS ───────────────────────────────────────────────────
//
// Each entry is grouped by collection theme. Type-checked entries protect a
// regional FORM (e.g. Hisui Typhlosion) without touching the regular form.
// Pure-name entries protect the species outright; if all members of a known
// "form trio" (e.g. all 3 Vivillon patterns) are enabled, we auto-collapse
// to "+Family" syntax to save chars and protect the whole evolution line.
//
// `tier` controls the "Recommended" default:
//   "S" — genuinely chase-worthy (regional locks, sub-1% spawns, evolution-gated rares)
//   "A" — worth keeping good ones (event-locked starters, soft regionals, meta attackers)
//   "C" — common base-form Alolan/Galarian junk most collectors don't bother with
// Entries without a tier are treated as "A" (default-on).

const REGIONAL_GROUPS = {
	alolan: {
		labelKey: 'app.regional.alolan.label',
		descriptionKey: 'app.regional.alolan.description',
		typeChecks: [
			{ species: 'Raichu', type: 'psychic', tier: 'A', noteKey: 'app.regional.alolan.notes.raichu_psychic' },
			{ species: 'Sandan', type: 'ice', tier: 'C', noteKey: 'app.regional.alolan.notes.sandan_ice' },
			{ species: 'Vulpix', type: 'ice', tier: 'C', noteKey: 'app.regional.alolan.notes.vulpix_ice' },
			{ species: 'Digda', type: 'steel', tier: 'C', noteKey: 'app.regional.alolan.notes.digda_steel' },
			{ species: 'Mauzi', type: 'dark', tier: 'C', noteKey: 'app.regional.alolan.notes.mauzi_dark' },
			{
				species: 'Kleinstein',
				type: 'electric',
				tier: 'C',
				noteKey: 'app.regional.alolan.notes.kleinstein_electric',
			},
			{ species: 'Kokowei', type: 'dragon', tier: 'A', noteKey: 'app.regional.alolan.notes.kokowei_dragon' },
			{ species: 'Knogga', type: 'ghost', tier: 'A', noteKey: 'app.regional.alolan.notes.knogga_ghost' },
		],
		collectors: [],
	},
	galarian: {
		labelKey: 'app.regional.galarian.label',
		descriptionKey: 'app.regional.galarian.description',
		typeChecks: [
			{ species: 'Smogmog', type: 'fairy', tier: 'A', noteKey: 'app.regional.galarian.notes.smogmog_fairy' },
			{ species: 'Pantimos', type: 'ice', tier: 'S', noteKey: 'app.regional.galarian.notes.pantimos_ice' },
			{ species: 'Makabaja', type: 'ground', tier: 'C', noteKey: 'app.regional.galarian.notes.makabaja_ground' },
			{
				species: 'Porenta',
				type: 'fighting',
				tier: 'A',
				noteKey: 'app.regional.galarian.notes.porenta_fighting',
			},
			{ species: 'Corasonn', type: 'ghost', tier: 'A', noteKey: 'app.regional.galarian.notes.corasonn_ghost' },
		],
		collectors: [],
	},
	hisuian: {
		labelKey: 'app.regional.hisuian.label',
		descriptionKey: 'app.regional.hisuian.description',
		typeChecks: [
			{ species: 'Tornupto', type: 'ghost', tier: 'A', noteKey: 'app.regional.hisuian.notes.tornupto_ghost' },
			{ species: 'Admurai', type: 'dark', tier: 'S', noteKey: 'app.regional.hisuian.notes.admurai_dark' },
			{
				species: 'Dressella',
				type: 'fighting',
				tier: 'A',
				noteKey: 'app.regional.hisuian.notes.dressella_fighting',
			},
			{ species: 'Arktilas', type: 'rock', tier: 'A', noteKey: 'app.regional.hisuian.notes.arktilas_rock' },
			{
				species: 'Silvarro',
				type: 'fighting',
				tier: 'A',
				noteKey: 'app.regional.hisuian.notes.silvarro_fighting',
			},
			{ species: 'Voltobal', type: 'grass', tier: 'A', noteKey: 'app.regional.hisuian.notes.voltobal_grass' },
			{ species: 'Lektrobal', type: 'grass', tier: 'A', noteKey: 'app.regional.hisuian.notes.lektrobal_grass' },
			{ species: 'Sichlor', type: 'rock', tier: 'A', noteKey: 'app.regional.hisuian.notes.sichlor_rock' },
		],
		collectors: [],
	},
	paldean: {
		labelKey: 'app.regional.paldean.label',
		descriptionKey: 'app.regional.paldean.description',
		typeChecks: [
			{
				species: 'Tauros',
				type: 'fighting',
				excludeTypes: ['fire', 'water'],
				tier: 'S',
				noteKey: 'app.regional.paldean.notes.tauros_fighting',
			},
			{ species: 'Tauros', type: 'fire', tier: 'S', noteKey: 'app.regional.paldean.notes.tauros_fire' },
			{ species: 'Tauros', type: 'water', tier: 'S', noteKey: 'app.regional.paldean.notes.tauros_water' },
		],
		collectors: [],
	},
	regionals: {
		labelKey: 'app.regional.regionals.label',
		descriptionKey: 'app.regional.regionals.description',
		// Base Tauros uses a typeCheck (Normal type) instead of a bare-species
		// collector so it doesn't umbrella-protect the Paldean forms (which the
		// paldean group handles with their own Fighting/Fire/Water typeChecks).
		// Auto-drops for US/Canada users via the Tauros KMZ polygon's typeChecks.
		typeChecks: [
			{ species: 'Tauros', type: 'normal', tier: 'S', noteKey: 'app.regional.regionals.notes.tauros_normal' },
		],
		collectors: [
			// Kontinent-exklusiv (Type 1 polygons in KMZ)
			'Kangama',
			'Skaraborn',
			'Corasonn',
			'Qurtel',
			'Tropius',
			'Relicanth',
			'Pachirisu',
			'Plaudagei',
			'Venuflibis',
			'Maracamba',
			'Symvolara',
			'Bisofank',
			'Humanolith',
			'Resladero',
			'Clavion',
			'Curelei',
			'Pantimos',
			'Pantimimi',
			'Porenta', // Mr. Mime / Mime Jr. / Farfetch'd
			'Volbeat',
			'Illumise', // Type 3 paired (E/W)
			'Muramura',
			'Kopplosio', // Stakataka / Blacephalon (E/W)
			'Katagami',
			'Kaguron', // Kartana / Celesteela (N/S)
			// Type 3 paired (Zangoose/Seviper, Lunatone/Solrock — swap regions periodically)
			'Sengo',
			'Vipitis', // Zangoose / Seviper
			'Lunastein',
			'Sonnfel', // Lunatone / Solrock
			// Type 4 hemispheric (Throh/Sawk, Heatmor/Durant)
			'Karadonis',
			'Jiutesto', // Sawk / Throh
			'Furnifraß',
			'Fermicula', // Heatmor / Durant
			// Type 5 Big-Three trios (3 continents — Lake Guardians, Elemental Monkeys)
			'Selfe',
			'Vesprit',
			'Tobutz', // Uxie / Mesprit / Azelf
			'Vegimak',
			'Grillmak',
			'Sodamak', // Pansage / Pansear / Panpour
		],
	},
	collectibles: {
		labelKey: 'app.regional.collectibles.label',
		descriptionKey: 'app.regional.collectibles.description',
		typeChecks: [],
		// Per-collector notes. Used as the tooltip on the editor toggle so the user
		// can see WHY this species is in collectibles (typically: forms can't be
		// distinguished in PoGo's search syntax, so we protect the whole species
		// and the user trades local-form duplicates to friends).
		collectorNotes: {
			Coiffwaff: 'app.regional.collectibles.notes.furfrou_forms',
			Nigiragi: 'app.regional.collectibles.notes.tatsugiri_forms',
			Schalellos: 'app.regional.collectibles.notes.shellos_forms',
			Gastrodon: 'app.regional.collectibles.notes.shellos_forms',
			Barschuft: 'app.regional.collectibles.notes.basculin_forms',
			Flabébé: 'app.regional.collectibles.notes.flabebe_forms',
			Floette: 'app.regional.collectibles.notes.flabebe_forms',
			Florges: 'app.regional.collectibles.notes.flabebe_forms',
			Choreogel: 'app.regional.collectibles.notes.oricorio_forms',
			Krawalloro: 'app.regional.collectibles.notes.squawkabilly_forms',
			Sesokitz: 'app.regional.collectibles.notes.deerling_forms',
			Kronjuwild: 'app.regional.collectibles.notes.deerling_forms',
			Kikugi: 'app.regional.collectibles.notes.cherrim_forms',
			Kinoso: 'app.regional.collectibles.notes.cherrim_forms',
			Burmy: 'app.regional.collectibles.notes.burmy_forms',
		},
		collectors: [
			// Vivillon-line — flat collectors; collapses to +Purmel if all 3 selected
			'Purmel',
			'Puponcho',
			'Vivillon',
			// Letter / pattern collections
			'Icognito',
			// Rare research/PokéStop encounters with multiple forms
			'Pandir', // Spinda — 9 patterns, monthly Field Research
			'Kecleon', // PokéStop hide encounter (rare)
			// Multi-form Pokémon (forms aren't search-distinguishable, so we protect the species)
			'Coiffwaff', // Furfrou — multiple trims
			'Nigiragi', // Tatsugiri — Curly/Droopy/Stretchy
			'Schalellos',
			'Gastrodon', // West/Ost forms not separately searchable
			'Barschuft', // Basculin — red/blue stripe forms not separately searchable
			// Regional-by-form species we *can't* distinguish in PoGo's search syntax —
			// even when home is in the region of one form, the bag holds all forms under
			// the same name. Better to keep the whole species and trade duplicates to
			// friends than to trash a rare remote form by accident. (Bring flowers.)
			'Flabébé',
			'Floette',
			'Florges', // Red/Yellow/Blue flowers
			'Choreogel', // Oricorio (Pom-Pom/Sensu/Baile/Pa'u)
			'Krawalloro', // Squawkabilly (Green E / Blue W / Yellow + White worldwide)
			// Same-dex, same-type multi-form species — invisible to search, so the
			// slot badges on the step-3 chips are the only way to track them.
			'Sesokitz',
			'Kronjuwild', // Deerling / Sawsbuck — form locked at catch, 4 seasons
			'Kikugi',
			'Kinoso', // Cherubi / Cherrim — Overcast vs Sunny fixed at evolution
			'Burmy', // three cloaks, all pure Bug (Burmadame's DO differ by type)
		],
	},
};

// Resolve a buddy-target species (any-locale name or dex) to its regional-form
// catalog entry from src/data/regional-forms.json — the ordered list of forms
// (Kanto base / Alola / Galar / Hisui / Paldea) each carrying the {include,
// exclude} type predicate that isolates it in PoGo search. Returns null for
// species with no type-distinguishable regional forms (single-form species, or
// forms search can't separate) — those fall back to the plain exact/+family
// target. Keyed by dex so the lookup is locale-independent.
export function regionalFormsFor(species) {
	if (!species) return null;
	const info = resolveSpeciesInfo(species);
	if (!info) return null;
	return REGIONAL_FORMS.species[String(info.dex)]?.forms || null;
}

// Gender slots for a species, or null when gender is not a collection
// dimension for it (the overwhelming majority). Dex-keyed like
// regionalFormsFor, so the lookup is locale-independent. Exported for the
// offline checks in scripts/check-lucky-logic.mjs.
export function genderSlotsFor(species) {
	if (!species) return null;
	const info = resolveSpeciesInfo(species);
	if (!info) return null;
	return GENDER_SLOT_DEX.get(info.dex) || null;
}

// Un-searchable collection slots for a species, or null when it has none.
// Exported for the offline checks in scripts/check-lucky-logic.mjs.
export function invisibleSlotsFor(species) {
	if (!species) return null;
	const info = resolveSpeciesInfo(species);
	if (!info) return null;
	return INVISIBLE_FORM_SLOTS[String(info.dex)] || null;
}

// Localized label for a regional form (chip text + clause-why): "Base",
// "Alola", "Paldea (Combat)" — region plus optional Paldean breed variant.
function formRegionLabel(form, tFn) {
	// Non-regional axes (Burmadame cloaks, Choreogel styles) have no region to
	// name — the variant IS the whole label ("Pflanzenumhang", not
	// "Sinnoh (Pflanze)").
	if (form.axis) return tFn(`app.buddy_targets.form_variant.${form.variant}`);
	const region = tFn(`app.buddy_targets.form_region.${form.region}`);
	if (form.variant) return `${region} (${tFn(`app.buddy_targets.form_variant.${form.variant}`)})`;
	return region;
}

// Family expansion: when collectors include all members of a +family,
// collapse to "+Family" instead of repeated entries (saves chars + protects whole line).
const FAMILY_COLLAPSES = {
	'+Purmel': ['Purmel', 'Puponcho', 'Vivillon'],
};

// Tier filter: which typeCheck species count as "recommended" defaults.
// "C" tier (common Alolan/Galarian base-form junk like Diglett/Yamask) is
// off by default — collectors typically don't bother. Entries without a
// `tier` field are treated as "A" (default-on).
function recommendedTypeCheckSpecies(group) {
	return group.typeChecks.filter((tc) => (tc.tier || 'A') !== 'C').map((tc) => tc.species);
}

// Default: all groups enabled, typeChecks default to the "recommended" set
// (S + A tier — S = chase-worthy regional locks; A = worth-keeping rares).
// Collectors default to all (null) — the regionals/collectibles groups
// don't have tiering since those are uniformly worth protecting.
function defaultRegionalToggles() {
	const out = {};
	for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
		const recommended = recommendedTypeCheckSpecies(group);
		const allSpecies = group.typeChecks.map((tc) => tc.species);
		// If every typeCheck is recommended (no C-tier entries), use null
		// sentinel so "select all" stays the canonical "all on" state.
		const typeChecksEnabled = recommended.length === allSpecies.length ? null : recommended;
		out[key] = {
			enabled: true,
			// null = all species in group are protected; if array, only listed species
			typeChecksEnabled,
			collectorsEnabled: null,
		};
	}
	return out;
}

// Flat fingerprint of the regional catalog: every group key plus one token per
// typeCheck / collector species ("alolan", "alolan>tc>Kokowei",
// "collectibles>col>Coiffwaff"). Stored on the config as `regionalCatalogSeen`
// at every merge, so the NEXT load can tell a genuinely-new catalog entry
// apart from one the user deselected.
export function regionalCatalogTokens() {
	const out = [];
	for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
		out.push(key);
		for (const tc of group.typeChecks) out.push(`${key}>tc>${tc.species}`);
		for (const sp of group.collectors) out.push(`${key}>col>${sp}`);
	}
	return out.sort();
}

// Which enabled regional groups currently protect this species (as a typeCheck
// or collector)? Used by the hundo adder to warn that a freshly-added hundo of
// a regional does NOT surface its duplicates — regional protection wins over
// the hundo carve-out, and unchecking the species in the regionals step is the
// explicit opt-out. Species is matched canonically, so any input locale works.
export function regionalProtectionsFor(species, cfg) {
	const canon = resolveSpecies(species) || String(species).toLowerCase();
	const same = (sp) => (resolveSpecies(sp) || String(sp).toLowerCase()) === canon;
	const groups = cfg?.regionalGroups || {};
	const out = [];
	for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
		const state = groups[key];
		if (!state || !state.enabled) continue;
		const tcOn = group.typeChecks.some(
			(tc) => same(tc.species) && (state.typeChecksEnabled === null || state.typeChecksEnabled.includes(tc.species)),
		);
		const colOn = group.collectors.some(
			(sp) => same(sp) && (state.collectorsEnabled === null || state.collectorsEnabled.includes(sp)),
		);
		if (tcOn || colOn) out.push(key);
	}
	return out;
}

// Pokémon name dictionary, resolvers, and reverse-lookup helpers live in
// src/data/species.js (multi-locale, generated from the published Google
// Sheet via scripts/fetch-translations.mjs at build time). Imported above.

// The 18 semantic type keys ("dark", "normal", …). Keys are locale-independent;
// only the localized value (kw.type.dark = "unlicht") changes by locale.
const BUDDY_TYPE_KEYS = new Set(Object.keys(pogoKeywords('de').type));

// Normalize one buddy target onto the structured shape
//   { species, expand, dropForms, gender }
// where `species` is a canonical lowercase name, `expand` toggles +family
// expansion (default off → exact species), `dropForms` is an array of
// regional-form keys to EXCLUDE from the catch list (default [] → catch every
// form), and `gender` is 'male' | 'female' | 'any' (default 'any' → both).
// Legacy string entries become exact, catch-all targets. Legacy `{type}`
// entries (the old single-form picker) migrate by keeping only the form whose
// predicate includes that type and dropping the rest. Idempotent — a
// normalized target re-runs unchanged. Returns null for junk so the caller
// can drop it.
export function normalizeBuddyTarget(entry) {
	if (typeof entry === 'string') {
		const species = resolveSpecies(entry) || entry.toLowerCase();
		return species ? { species, expand: false, dropForms: [], gender: 'any' } : null;
	}
	if (entry && typeof entry === 'object' && entry.species != null) {
		const species = resolveSpecies(entry.species) || String(entry.species).toLowerCase();
		if (!species) return null;
		let dropForms = [];
		if (Array.isArray(entry.dropForms)) {
			// Keep only keys that still exist in the catalog (it can change over time).
			const valid = new Set((regionalFormsFor(species) || []).map((f) => f.key));
			dropForms = entry.dropForms.filter((k) => typeof k === 'string' && valid.has(k));
		} else if (typeof entry.type === 'string' && entry.type) {
			const key = BUDDY_TYPE_KEYS.has(entry.type) ? entry.type : typeKeyFromKeyword(entry.type, 'de');
			const forms = regionalFormsFor(species) || [];
			const keep = key && forms.find((f) => (f.include || []).includes(key));
			if (keep) dropForms = forms.filter((f) => f.key !== keep.key).map((f) => f.key);
		}
		const gender = entry.gender === 'male' || entry.gender === 'female' ? entry.gender : 'any';
		return { species, expand: !!entry.expand, dropForms, gender };
	}
	return null;
}

// Normalize a raw config blob (from localStorage on load OR from a JSON
// import file) onto the current DEFAULT_CONFIG shape. Single source of
// truth so any future field rename / removal automatically migrates both
// returning users AND old export files.
//
// Pattern: spread DEFAULT_CONFIG first so missing fields back-fill, then
// the raw blob so user values win, then explicit cleanup for legacy keys
// and renames. Unknown forward-compat keys are preserved.
//
// `notices` (optional) collects catalog-sync events the caller may surface to
// the user: one { kind: 'group'|'typeCheck'|'collector', group, species? }
// entry per regional that was newly added to their protections (see the
// catalog-sync block below).
export function mergeImportedConfig(raw, notices = []) {
	const merged = { ...DEFAULT_CONFIG, ...(raw || {}) };
	if (!merged.regionalGroups || Object.keys(merged.regionalGroups).length === 0) {
		merged.regionalGroups = defaultRegionalToggles();
	}
	// ── Regional catalog sync ─────────────────────────────────────────────
	// The regional catalog grows over time (new game generations, synced form
	// data). A stored config is a snapshot: without this block a returning
	// user's filter silently skips every regional added after their last visit
	// (missing group key → whole group skipped in buildFilters; a
	// typeChecksEnabled/collectorsEnabled ARRAY never gains new species).
	// New entries become protected BY DEFAULT — same rules as a fresh install
	// (C-tier stays off) — and each addition lands in `notices` so the UI can
	// tell the user their state was updated. `regionalCatalogSeen` (the
	// fingerprint from the last merge) distinguishes "new to this user" from
	// "user turned it off"; configs predating the field are grandfathered to
	// the current catalog so nobody gets a retroactive popup.
	{
		const seen = new Set(
			Array.isArray(raw?.regionalCatalogSeen) ? raw.regionalCatalogSeen : regionalCatalogTokens(),
		);
		const defaults = defaultRegionalToggles();
		const groups = { ...merged.regionalGroups };
		for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
			if (!groups[key]) {
				groups[key] = defaults[key];
				if (!seen.has(key)) notices.push({ kind: 'group', group: key });
				continue;
			}
			const state = { ...groups[key] };
			// Prune species that left the catalog (renames, delistings) so stale
			// selections can't linger in the editor or the share/export payload.
			const tcSpecies = new Set(group.typeChecks.map((tc) => tc.species));
			if (Array.isArray(state.typeChecksEnabled)) {
				state.typeChecksEnabled = state.typeChecksEnabled.filter((sp) => tcSpecies.has(sp));
			}
			const colSpecies = new Set(group.collectors);
			if (Array.isArray(state.collectorsEnabled)) {
				state.collectorsEnabled = state.collectorsEnabled.filter((sp) => colSpecies.has(sp));
			}
			for (const tc of group.typeChecks) {
				if (seen.has(`${key}>tc>${tc.species}`)) continue;
				// null = "all on" already covers it; an array only gains
				// recommended-tier entries (C-tier stays off, like fresh defaults).
				const protects =
					state.typeChecksEnabled === null ||
					((tc.tier || 'A') !== 'C' && !state.typeChecksEnabled.includes(tc.species));
				if (Array.isArray(state.typeChecksEnabled) && protects) {
					state.typeChecksEnabled = [...state.typeChecksEnabled, tc.species];
				}
				// A notice claims "this is now protected" — only true if the group
				// itself is on. Disabled groups still get the array updated above so
				// re-enabling later picks the new species up.
				if (protects && state.enabled) notices.push({ kind: 'typeCheck', group: key, species: tc.species });
			}
			for (const sp of group.collectors) {
				if (seen.has(`${key}>col>${sp}`)) continue;
				if (Array.isArray(state.collectorsEnabled) && !state.collectorsEnabled.includes(sp)) {
					state.collectorsEnabled = [...state.collectorsEnabled, sp];
				}
				if (state.enabled) notices.push({ kind: 'collector', group: key, species: sp });
			}
			groups[key] = state;
		}
		merged.regionalGroups = groups;
		merged.regionalCatalogSeen = regionalCatalogTokens();
	}
	if (!merged.enabledTradeEvos || merged.enabledTradeEvos.length === 0) {
		merged.enabledTradeEvos = Object.keys(TRADE_EVO_FAMILIES);
	}
	// Drop legacy keys (replaced or split)
	delete merged.protectRegionals;
	delete merged.protectSizes; // split into XXL/XL/XXS
	delete merged.protectLeagueTags; // replaced with leagueTags string
	delete merged.protectMegaConditional; // renamed to protectNewEvolutions
	delete merged.yearMin;
	// Migrate old field names (read from raw, write to merged)
	if (raw?.mythCarveOuts && !raw.mythTooManyOf) merged.mythTooManyOf = raw.mythCarveOuts;
	if (raw?.protectMegaConditional !== undefined && raw.protectNewEvolutions === undefined) {
		merged.protectNewEvolutions = raw.protectMegaConditional;
	}
	// Old `protectTagged` (catch-all !#) → new `protectAnyTag`
	if (raw?.protectTagged !== undefined && raw.protectAnyTag === undefined) {
		merged.protectAnyTag = raw.protectTagged;
	}
	delete merged.protectTagged;
	// protectGigantamax is new: a config that predates it back-fills the default
	// (true). For the one cohort that explicitly saved protectDynamax:false, that
	// would newly emit `!gigadynamax` (strictly safer, but a behavior change), so
	// pin the floor off to keep their output byte-identical until they opt in.
	if (raw?.protectGigantamax === undefined && raw?.protectDynamax === false) {
		merged.protectGigantamax = false;
	}
	// Same story for the shadow purify-floor: a config predating it back-fills the
	// default (true). For users who explicitly saved protectShadows:false (release
	// ALL shadows), the floor would newly keep purify-worthy shadows — pin it off to
	// preserve their output until they opt in.
	if (raw?.protectShadowPurifyOnly === undefined && raw?.protectShadows === false) {
		merged.protectShadowPurifyOnly = false;
	}
	// Canonicalize seeded defaults to the storage locale so chips render
	// consistently. Idempotent on already-canonical user input.
	const canonicalize = (arr) => (arr || []).map((s) => resolveSpecies(s) || s);
	merged.mythTooManyOf = canonicalize(merged.mythTooManyOf);
	merged.shadowKeeperSpecies = canonicalize(merged.shadowKeeperSpecies);
	// Deduped as well as canonicalized: an import carrying the same species under
	// two locale names ("Medicham" + "meditalis") collapses to one entry, so it
	// cannot emit the same carve-out clause twice.
	merged.pvpMetaSpecies = [...new Set(canonicalize(merged.pvpMetaSpecies))];
	// PvP knobs: coerce junk (and hand-edited imports) to the defaults. A config
	// predating `intelligent` simply never selects it, so the two tier fields stay
	// inert — no back-fill pin needed the way protectShadowPurifyOnly needed one.
	if (!['loose', 'intelligent', 'strict', 'none'].includes(merged.pvpMode)) merged.pvpMode = 'strict';
	if (!['loose', 'strict'].includes(merged.pvpMetaTier)) merged.pvpMetaTier = 'loose';
	if (!['loose', 'strict', 'none'].includes(merged.pvpBaseTier)) merged.pvpBaseTier = 'strict';
	merged.friendCollectSpecies = canonicalize(merged.friendCollectSpecies);
	if (!['lucky', 'hundo', 'both'].includes(merged.friendCollectMode)) merged.friendCollectMode = 'lucky';
	// Legacy configs (and junk values) coerce to the off default.
	merged.friendCollectGuaranteedOnly = merged.friendCollectGuaranteedOnly === true;
	// Coverage overrides ride on the curated list: canonicalize, then drop
	// anything no longer curated (junk / hand-edited imports included).
	const friendCollectSet = new Set(merged.friendCollectSpecies);
	merged.friendCollectForced = canonicalize(
		Array.isArray(merged.friendCollectForced) ? merged.friendCollectForced : [],
	).filter((sp) => friendCollectSet.has(sp));
	// Species-keyed side-band maps: canonicalize keys, validate values, and
	// never let a hand-edited import smuggle junk into the emitters. Maps are
	// opaque to the resolver on purpose — annotations are click-only, so no
	// name parsing happens here beyond plain species canonicalization.
	const canonMapKeys = (obj, validate) => {
		const out = {};
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
		for (const [rawKey, rawVal] of Object.entries(obj)) {
			const key = resolveSpecies(rawKey) || String(rawKey).toLowerCase();
			const val = validate(key, rawVal);
			if (val !== undefined && !(key in out)) out[key] = val;
		}
		return out;
	};
	// Regional-form annotation values: dedupe against the species' catalog
	// forms; unknown keys drop, empty results drop the entry entirely.
	const validFormKeys = (species, rawVal) => {
		const catalog = (regionalFormsFor(species) || []).map((f) => f.key);
		if (catalog.length === 0 || !Array.isArray(rawVal)) return undefined;
		const keep = [...new Set(rawVal.filter((k) => catalog.includes(k)))];
		return keep.length > 0 ? keep : undefined;
	};
	merged.friendCollectGenders = canonMapKeys(merged.friendCollectGenders, (key, v) =>
		friendCollectSet.has(key) && (v === 'male' || v === 'female') ? v : undefined,
	);
	merged.friendCollectDropForms = canonMapKeys(merged.friendCollectDropForms, (key, v) => {
		if (!friendCollectSet.has(key)) return undefined;
		const keep = validFormKeys(key, v);
		if (!keep) return undefined;
		// Dropping every form would make the target catch nothing — the picker
		// blocks it, so a full drop here can only be import junk.
		const catalog = (regionalFormsFor(key) || []).map((f) => f.key);
		return keep.length < catalog.length ? keep : undefined;
	});
	merged.hundoForms = canonMapKeys(merged.hundoForms, validFormKeys);
	merged.luckyForms = canonMapKeys(merged.luckyForms, validFormKeys);
	// Gender annotation values. The map records which genders you OWN, so both
	// are valid for any gender-slot species — owning the ♂ Wadribie is exactly
	// the state worth recording. Which genders COUNT as filling a slot is
	// GENDER_SLOT_DEX's job, applied at emission time. Species outside the
	// catalog drop entirely.
	const validGenderKeys = (species, rawVal) => {
		if (!genderSlotsFor(species) || !Array.isArray(rawVal)) return undefined;
		const keep = [...new Set(rawVal.filter((g) => g === 'male' || g === 'female'))];
		return keep.length > 0 ? keep : undefined;
	};
	merged.hundoGenders = canonMapKeys(merged.hundoGenders, validGenderKeys);
	merged.luckyGenders = canonMapKeys(merged.luckyGenders, validGenderKeys);
	// Un-searchable slot values: dedupe against the species' own slot list.
	const validSlotKeys = (species, rawVal) => {
		const entry = invisibleSlotsFor(species);
		if (!entry || !Array.isArray(rawVal)) return undefined;
		const keep = [...new Set(rawVal.filter((k) => entry.slots.includes(k)))];
		return keep.length > 0 ? keep : undefined;
	};
	merged.hundoSlots = canonMapKeys(merged.hundoSlots, validSlotKeys);
	merged.luckySlots = canonMapKeys(merged.luckySlots, validSlotKeys);
	if (typeof merged.seasonAuto !== 'boolean') merged.seasonAuto = true;
	if (!['spring', 'summer', 'autumn', 'winter'].includes(merged.seasonOverride))
		merged.seasonOverride = null;
	// Buddy targets: migrate legacy string[] → structured Target[] and backfill
	// the per-buddy raw escape hatch. `rawAppend` first so an existing value wins.
	// Dedupe by species|type so a hand-edited import can't yield colliding lines.
	// Drop non-object junk entries (null holes / scalars from a corrupt config or
	// hand-edited import) up front so the map below can't throw on `b.targetSpecies`.
	merged.buddies = (merged.buddies || [])
		.filter((b) => b && typeof b === 'object')
		.map((b) => {
			const seen = new Set();
			const targetSpecies = (b.targetSpecies || [])
				.map(normalizeBuddyTarget)
				.filter(Boolean)
				.filter((t) => {
					// One target per species now (form selection lives in dropForms).
					if (seen.has(t.species)) return false;
					seen.add(t.species);
					return true;
				});
			return { rawAppend: '', ...b, targetSpecies };
		});
	return merged;
}

// Pure validator for import envelopes. Returns an error code (not a
// localized string) so the React consumer can render messages from the
// i18n bundle. Code is one of: "invalid_json" (parsed isn't an object),
// "wrong_schema" (no schema field or unrecognized prefix),
// "unsupported_version" (right prefix but unknown version).
//
// Kept module-scope + pure so it's directly testable without React state.
export const SCHEMA_PREFIX = 'pogo-filter-workshop/';
export const SCHEMA_CURRENT = 'pogo-filter-workshop/v1';
export function validateImportEnvelope(parsed) {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, error: { code: 'invalid_json' } };
	}
	if (typeof parsed.schema !== 'string' || !parsed.schema.startsWith(SCHEMA_PREFIX)) {
		return { ok: false, error: { code: 'wrong_schema' } };
	}
	if (parsed.schema !== SCHEMA_CURRENT) {
		return { ok: false, error: { code: 'unsupported_version', params: { schema: parsed.schema } } };
	}
	return { ok: true, envelope: parsed };
}

// Pure "what state should the setters receive" computation. Mirrors the
// shape filtering inline in the previous applyImportEnvelope: only
// includes a key in the result if the envelope has a recognizable value.
// Caller uses `if ("hundos" in prepared)` etc. to gate setter calls.
export function prepareImport(envelope) {
	const d = (envelope && envelope.data) || {};
	const canonicalize = (arr) => (arr || []).map((s) => resolveSpecies(s) || s);
	const out = {};
	if (Array.isArray(d.hundos)) out.hundos = d.hundos;
	if (Array.isArray(d.luckies)) out.luckies = canonicalize(d.luckies);
	if (Array.isArray(d.topAttackers)) out.topAttackers = canonicalize(d.topAttackers);
	if (Array.isArray(d.topMaxAttackers)) out.topMaxAttackers = canonicalize(d.topMaxAttackers);
	if (d.config && typeof d.config === 'object') out.config = mergeImportedConfig(d.config);
	if (d.homeLocation === null || (Array.isArray(d.homeLocation) && d.homeLocation.length === 2)) {
		out.homeLocation = d.homeLocation;
	}
	if (Array.isArray(d.bazaarTags)) out.bazaarTags = d.bazaarTags;
	return out;
}

// ─── FILTER GENERATION (set-theoretic) ────────────────────────────────────

function deduppedTradeEvos(hundos, enabled) {
	// Locale-independent overlap detection: convert each hundo to its dex# (via
	// multi-locale resolver) and check intersection with each family's memberDex.
	// This way the function works regardless of which language the hundos are
	// stored in.
	const hundoDex = new Set();
	for (const h of hundos) {
		const info = resolveSpeciesInfo(h);
		if (info) hundoDex.add(info.dex);
	}
	const trimmed = [];
	const full = [];
	for (const base of enabled) {
		const family = TRADE_EVO_FAMILIES[base];
		if (!family) continue;
		full.push(base);
		const overlapsH = family.memberDex.some((d) => hundoDex.has(d));
		if (!overlapsH) trimmed.push(base);
	}
	return { full, trimmed };
}

// Object copy without one key — the species-keyed side-band maps (forced /
// gender / form annotations) shed entries this way when a chip is removed.
function omitKey(obj, key) {
	const { [key]: _dropped, ...rest } = obj || {};
	return rest;
}

// Helper: split comma-separated tag list, returning array of trimmed tag names.
function parseTagList(s) {
	return (s || '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
}

// Helper: collapse collectors to family names where possible.
function collapseFamilies(speciesList, familyCollapses) {
	const remaining = new Set(speciesList);
	const out = [];
	for (const [familyTag, members] of Object.entries(familyCollapses)) {
		if (members.every((m) => remaining.has(m))) {
			out.push(familyTag);
			members.forEach((m) => remaining.delete(m));
		}
	}
	for (const sp of speciesList) {
		if (remaining.has(sp)) out.push(sp);
	}
	return out;
}

// Resolves a species name (in any locale) to its lowercase form in the output
// locale, ready for filter syntax. Falls back to the input lowercased if no
// match — keeps user-typed names working even if the dictionary is incomplete.
function speciesForOutput(name, outputLocale) {
	const resolved = resolveSpecies(name, outputLocale);
	if (resolved) return resolved;
	return String(name).toLowerCase();
}

// Capitalizes for + filter syntax (PoGo accepts case-insensitive but
// capitalized reads better in copy-pasted filters).
function capFirst(s) {
	if (!s) return s;
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildFilters(
	hundos,
	luckies,
	cfg,
	homeLocals = [],
	outputLocale = 'de',
	tFn = (k) => k,
	homeLocalTypeChecks = [],
	bazaarSpecies = [],
) {
	const kw = pogoKeywords(outputLocale);

	// Hundos are stored in the user's output-locale lowercase form. Re-render in
	// case the locale changed since they were typed (resolveSpecies normalizes).
	const hundosOut = hundos.map((h) => speciesForOutput(h, outputLocale));
	const H = hundosOut.map((h) => `+${h}`).join(',');

	// Lucky-hundo intersection: species the user has BOTH a hundo AND a lucky
	// of. Duplicates of these families have no remaining purpose — neither
	// IV-chasing nor lucky-friend-trading — so they belong in trash but NOT
	// in trade. Members of L \ H stay tradeable (the user might still chase
	// a hundo). Members of H \ L stay tradeable for lucky-friend trades.
	// Canonicalize both sides before the H/L set math — matching how hundoOutSet
	// and the regional drops resolve via resolveSpecies. Plain lowercasing breaks
	// when a hundo and its lucky were stored in different locales (e.g. imported
	// hundo "Charizard" + lucky "glurak" are the same species): they'd no longer
	// match and the lucky-hundo would leak into trade. luckyHundoSet still holds
	// raw `hundos` entries so the identity filter on the next line stays correct.
	const canonKey = (s) => resolveSpecies(s) || String(s).toLowerCase();
	const luckySet = new Set((luckies || []).map(canonKey));
	const luckyHundoSet = new Set(hundos.filter((h) => luckySet.has(canonKey(h))));
	const hundosForTrade = hundos.filter((h) => !luckyHundoSet.has(h));
	const H_trade = hundosForTrade.map((h) => `+${speciesForOutput(h, outputLocale)}`).join(',');

	// Shared De Morgan encoding for a form predicate's NEGATION — same idiom as the
	// buddy drop-form guards: ¬(inc₁∧inc₂∧¬exc) = ¬inc₁ ∨ ¬inc₂ ∨ exc, rendered as
	// comma-OR type terms in the output locale. Empty string means the form carries no
	// type predicate (shouldn't happen with catalog data). Hoisted above the sort
	// blocks so the browse-sort form-scoping (below) can reuse it.
	const formDropTerms = (f) =>
		[
			...(f.include || []).map((ty) => `!${kw.type[ty] || ty}`),
			...(f.exclude || []).map((ty) => kw.type[ty] || ty),
		].join(',');

	// Non-owned regional forms to HIDE from a `+family` browse-sort member, so the
	// sort surfaces only the annotated form's duplicates. Returns [] for the
	// whole-family cases (unannotated, every form owned, or no type-separable forms).
	// Forms whose predicate renders empty are skipped (can't be isolated in search).
	// Gender is the same shape of refinement as a regional form, one axis over:
	// the "predicate" isolating a gender is just the keyword, so its De Morgan
	// negation is a single `!male` / `!female` term. Both call sites below keep
	// the exact shape of their form-scoped twins — note they iterate OPPOSITE
	// sets, which is correct and easy to misread:
	//   wishlist → the genders you OWN   (hide those, keep what you lack visible)
	//   sorts    → the genders you LACK  (hide those, surface your duplicates)
	const genderDropTerms = (g) => (kw.flag[g] ? `!${kw.flag[g]}` : '');
	// Slot genders still missing (i.e., still chase-worthy) to HIDE from a `+family`
	// browse-sort member. [] when the species has no gender slots, is unannotated,
	// or all slot genders are already owned.
	const genderScopedSortGuards = (canonName, ownedGenders) => {
		const slots = genderSlotsFor(canonName);
		if (!slots) return [];
		if (!Array.isArray(ownedGenders) || ownedGenders.length === 0) return [];
		const owned = new Set(ownedGenders);
		return slots.filter((g) => !owned.has(g) && genderDropTerms(g));
	};

	const formScopedSortGuards = (canonName, ownedKeys) => {
		const catalog = regionalFormsFor(canonName) || [];
		if (catalog.length === 0 || !Array.isArray(ownedKeys) || ownedKeys.length === 0) return [];
		const ownedSet = new Set(ownedKeys);
		const owned = catalog.filter((f) => ownedSet.has(f.key));
		if (owned.length === 0 || owned.length >= catalog.length) return [];
		return catalog.filter((f) => !ownedSet.has(f.key) && formDropTerms(f).length > 0);
	};

	// Lucky-hundo-sort intersection: the regional forms where BOTH the hundo and the
	// lucky chase are done (an unannotated side counts as every form). null → keep the
	// whole family (no separable forms, or every form jointly done); a non-empty Form[]
	// → scope the union to those forms; [] → NO jointly-done form → drop the species.
	const jointlyDoneForms = (canonName) => {
		const catalog = regionalFormsFor(canonName) || [];
		if (catalog.length === 0) return null;
		const allKeys = catalog.map((f) => f.key);
		const annSet = (ann) =>
			new Set(Array.isArray(ann?.[canonName]) && ann[canonName].length > 0 ? ann[canonName] : allKeys);
		const hSet = annSet(cfg.hundoForms);
		const lSet = annSet(cfg.luckyForms);
		const done = catalog.filter((f) => hSet.has(f.key) && lSet.has(f.key));
		return done.length >= catalog.length ? null : done;
	};

	// Personal allowlists for the two PvE-counter contexts. Different rosters
	// because most raid meta attackers (Mewtwo, Rayquaza, Garchomp, …) aren't
	// Dynamax-capable, so a separate Max-Battle list avoids polluting the
	// Max filter with species that get filtered out by `dynaattacke1-`
	// anyway. Both emit bare-name OR-prefixes into each counter clause.
	const topAttackersList = (cfg.topAttackers || []).map((s) => speciesForOutput(s, outputLocale)).filter(Boolean);
	const topMaxAttackersList = (cfg.topMaxAttackers || [])
		.map((s) => speciesForOutput(s, outputLocale))
		.filter(Boolean);
	// EvoSwap candidate pools — base species only (the +species operator
	// expands to the whole family in PoGo's search). Filtered through
	// speciesForOutput so the resulting clause reads in the user's PoGo locale.
	const evoCandyList = (EVOLUTION_COSTS.candyHeavy || [])
		.map((s) => speciesForOutput(s, outputLocale))
		.filter(Boolean);
	const evoItemList = (EVOLUTION_COSTS.itemGated || []).map((s) => speciesForOutput(s, outputLocale)).filter(Boolean);

	const { full: TE_full, trimmed: TE_trim } = deduppedTradeEvos(hundos, cfg.enabledTradeEvos);
	const TE_full_str = TE_full.map((b) => `+${teDisplay(b, outputLocale)}`).join(',');
	const TE_trim_str = TE_trim.map((b) => `+${teDisplay(b, outputLocale)}`).join(',');

	// PoGo's IV-bucket filter accepts ranges like `0-2{atk}` but SILENTLY
	// IGNORES `!N` negation on IV tokens — so `!4{atk}` is a no-op. We encode
	// "atk ≠ 4" as the positive range `0-3{atk}` instead.
	// Buckets: 0 = 0 IV, 1 = 1-5, 2 = 6-10, 3 = 11-14, 4 = 15
	const ivK1Bad = `0-3${kw.iv.atk},0-3${kw.iv.def},0-2${kw.iv.hp}`;
	const ivK2Bad = `0-3${kw.iv.atk},0-2${kw.iv.def},0-3${kw.iv.hp}`;
	const ivK3Bad = `0-2${kw.iv.atk},0-3${kw.iv.def},0-3${kw.iv.hp}`;
	const ivPvPLoose = `2-4${kw.iv.atk},0-2${kw.iv.def},0-2${kw.iv.hp}`;
	const ivPvPStrict = `1-4${kw.iv.atk},0-2${kw.iv.def},0-2${kw.iv.hp}`;
	const IV_PVP_TIER = { loose: ivPvPLoose, strict: ivPvPStrict, none: null };
	// Protection width, so we can tell when a carve-out would be redundant.
	const PVP_TIER_RANK = { none: 0, strict: 1, loose: 2 };

	// `intelligent` splits the carve-out into two configurable tiers; the legacy
	// modes collapse onto the same two knobs with both tiers equal, which keeps
	// their output byte-identical.
	const pvpBaseTier =
		cfg.pvpMode === 'intelligent'
			? cfg.pvpBaseTier || 'strict'
			: cfg.pvpMode === 'loose' || cfg.pvpMode === 'strict'
				? cfg.pvpMode
				: 'none';
	const pvpMetaTier = cfg.pvpMode === 'intelligent' ? cfg.pvpMetaTier || 'loose' : pvpBaseTier;
	const notP = IV_PVP_TIER[pvpBaseTier];

	// The curated "relevant now" list — species you actually battle with, seeded
	// one tap at a time from the league packs. Rendered into the user's PoGo
	// locale, same as shadowKeeperSpecies (`keeperResolved`).
	const pvpMetaList =
		cfg.pvpMode === 'intelligent'
			? [
					...new Set(
						(cfg.pvpMetaSpecies || [])
							.map((sp) => speciesForOutput(sp, outputLocale))
							.filter(Boolean),
					),
				]
			: [];
	// Widening a tier for SOME species needs one clause per species, not one
	// clause listing them all: clauses are comma-OR, so `!+a,!+b,…` is satisfied
	// by any species you are NOT and would go vacuously true for everyone. The
	// per-species shape mirrors the trade-evo carve-out below. Skipped entirely
	// when the meta tier is not strictly wider than the base tier — then the base
	// clause already implies every carve-out (`2-4atk` ⟹ `1-4atk`).
	const pvpMetaWidens =
		pvpMetaList.length > 0 && PVP_TIER_RANK[pvpMetaTier] > PVP_TIER_RANK[pvpBaseTier];
	const pushPvPMetaClauses = (arr) => {
		if (!pvpMetaWidens) return;
		for (const name of pvpMetaList) {
			push(
				arr,
				`!+${name},${IV_PVP_TIER[pvpMetaTier]}`,
				tFn('app.clause_why.not_p_meta', { params: { name } }),
			);
		}
	};

	const S012 = '0*,1*,2*';

	// Configurable lists
	const leagueTags = parseTagList(cfg.leagueTags);
	const customTags = parseTagList(cfg.customProtectedTags);
	const basarTag = (cfg.basarTagName || '').trim();
	const fernTauschTag = (cfg.fernTauschTagName || '').trim();

	const trashClauses = [];
	const tradeClauses = [];
	const push = (arr, clause, why) => arr.push({ clause, why });

	// Legacy-move protection clause, shared by trash / trade / buddy-catch so the
	// Smeargle carve-out stays consistent across all three (it used to live only
	// in trash, so trade/buddy over-protected every Smeargle). Each Smeargle has
	// @special-flagged Sketched moves, so without the trailing species name the
	// clause umbrella-protects all of them. With OR-binding-tighter precedence,
	// `!@special,smeargle` parses as (!@special ∪ smeargle) — keep is "@special
	// AND NOT smeargle". The same OR trick peels off purified-Return junk and
	// still-Frustration shadows. protectSmeargleLegacy (default false) keeps
	// regular Smeargles releasable/tradeable.
	const smeargleName = pokemonNameFor('235', outputLocale)?.toLowerCase() || 'smeargle';
	const legacyMovesClause = () => {
		const suffix = `,@${kw.flag.return},@${kw.flag.frustration}`;
		return cfg.protectSmeargleLegacy
			? `!@${kw.flag.special_move}${suffix}`
			: `!@${kw.flag.special_move}${suffix},${smeargleName}`;
	};

	// Single source of truth for the Max-protection clause shared by trash /
	// trade / gift, so the three sites can never diverge. Broad Dynamax
	// protection emits the collision-safe `!dynaattacke1-` (the leveled Max-move
	// keyword — NOT bare `!dynamax`, which self-expands and breaks `@Dynamax
	// Cannon` searches). The Gigantamax floor is a strict subset, so the else-if
	// is suppressed whenever broad protection is on — keeping the compact
	// combined default byte-identical — and only emits the narrow `!gigadynamax`
	// when broad is off, protecting rare Gigas while ordinary Dynamax commons
	// stay releasable. Returns [clause, why] or null.
	const maxProtectClause = () => {
		if (cfg.protectDynamax) return [`!${kw.flag.dynamax_move}1-`, tFn('app.clause_why.dynamax')];
		if (cfg.protectGigantamax && kw.flag.gigantamax)
			return [`!${kw.flag.gigantamax}`, tFn('app.clause_why.gigantamax')];
		return null;
	};

	// ── TRASH ──────────────────────────────────────────────────────────────
	push(trashClauses, [S012, H].filter(Boolean).join(','), tFn('app.clause_why.h_union_s012'));
	push(trashClauses, `${S012},${ivK1Bad}`, tFn('app.clause_why.not_k1'));
	push(trashClauses, `${S012},${ivK2Bad}`, tFn('app.clause_why.not_k2'));
	push(trashClauses, `${S012},${ivK3Bad}`, tFn('app.clause_why.not_k3'));
	if (notP) push(trashClauses, notP, tFn('app.clause_why.not_p', { params: { mode: cfg.pvpMode } }));
	pushPvPMetaClauses(trashClauses);

	if (cfg.protectTradeEvos && TE_full.length > 0) {
		for (const base of TE_full) {
			const display = teDisplay(base, outputLocale);
			push(
				trashClauses,
				`!+${display},${kw.flag.traded}`,
				tFn('app.clause_why.trade_evo_family', { params: { name: display } }),
			);
		}
	}

	if (cfg.protectFourStar) {
		push(trashClauses, '!4*', tFn('app.clause_why.rule1_no_4star'));
	}
	if (cfg.protectNundos) {
		// ANDed into trash → must have at least one non-zero IV bucket → 0/0/0
		// slips past every trash clause. Uses positive contrapositive because
		// PoGo silently ignores !N negation on IV tokens (see line 646 comment).
		push(
			trashClauses,
			`1-4${kw.iv.atk},1-4${kw.iv.def},1-4${kw.iv.hp}`,
			tFn('app.clause_why.protect_nundos_trash'),
		);
	}

	// Tag protections
	const activeBuddies = (cfg.buddies || []).filter((b) => b.active !== false && b.tagPrefix);
	if (cfg.protectAnyTag) {
		push(trashClauses, '!#', tFn('app.clause_why.any_tag_trash'));
	} else {
		if (basarTag)
			push(trashClauses, `!#${basarTag}`, tFn('app.clause_why.bazaar_tag', { params: { tag: basarTag } }));
		if (fernTauschTag)
			push(
				trashClauses,
				`!#${fernTauschTag}`,
				tFn('app.clause_why.fern_tausch_tag', { params: { tag: fernTauschTag } }),
			);
		for (const t of customTags)
			push(trashClauses, `!#${t}`, tFn('app.clause_why.custom_tag', { params: { tag: t } }));
		for (const b of activeBuddies) {
			const prefix = b.tagPrefix.replace(/^#/, '');
			push(trashClauses, `!#${prefix}`, tFn('app.clause_why.buddy_tag', { params: { name: b.name, prefix } }));
		}
	}

	// Universal protections
	if (cfg.protectFavorites) push(trashClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites'));
	if (cfg.protectShinies) push(trashClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies'));
	if (cfg.protectLegendaries) push(trashClauses, `!${kw.flag.legendary}`, tFn('app.clause_why.legendaries'));
	if (cfg.protectMythicals) {
		const carve = (cfg.mythTooManyOf || [])
			.map((s) => speciesForOutput(s, outputLocale))
			.filter(Boolean)
			.join(',');
		push(
			trashClauses,
			carve ? `!${kw.flag.mythical},${carve}` : `!${kw.flag.mythical}`,
			carve ? tFn('app.clause_why.mythicals_carved', { params: { carve } }) : tFn('app.clause_why.mythicals'),
		);
	}
	if (cfg.protectUltraBeasts) push(trashClauses, `!${kw.flag.ultra_beast}`, tFn('app.clause_why.ultra_beasts'));
	// Shadow carve-out (trash-only; trade always excludes crypto). Broad-wins /
	// narrow-floor split, mirroring maxProtectClause: protectShadows keeps ALL
	// shadows out of trash; when it's off, the protectShadowPurifyOnly floor keeps
	// only the purify-worthy ones and lets expensive low-IV junk go. Each floor
	// clause is a scoped implication `!crypto,X` = keep unless X (OR binds tighter
	// than `&`, same trick as legacyMovesClause): a shadow is releasable only if it
	// has a low IV somewhere (not a purify-hundo candidate) AND costs ≥3km-candy to
	// purify (not a cheap event-task purify) AND still has Frustration (not a
	// Charge-TM'd investment).
	if (cfg.protectShadows) {
		push(trashClauses, `!${kw.flag.shadow}`, tFn('app.clause_why.shadows'));
	} else if (cfg.protectShadowPurifyOnly) {
		push(
			trashClauses,
			`!${kw.flag.shadow},0-2${kw.iv.atk},0-2${kw.iv.def},0-2${kw.iv.hp}`,
			tFn('app.clause_why.shadow_purify_hundo'),
		);
		push(
			trashClauses,
			`!${kw.flag.shadow},${kw.numeric.candy_km}3-`,
			tFn('app.clause_why.shadow_purify_cheap'),
		);
		if (kw.flag.frustration)
			push(
				trashClauses,
				`!${kw.flag.shadow},@${kw.flag.frustration}`,
				tFn('app.clause_why.shadow_purify_frustration'),
			);
	}
	if (cfg.protectCostumes) push(trashClauses, `!${kw.flag.costume}`, tFn('app.clause_why.costumes'));
	if (cfg.protectLuckies) push(trashClauses, `!${kw.flag.lucky}`, tFn('app.clause_why.luckies'));
	if (cfg.protectBackgrounds) push(trashClauses, `!${kw.flag.background}`, tFn('app.clause_why.backgrounds'));
	// Purification costs stardust + candy, so the toggle sits with the other
	// universal protections in ConfigPanel. It used to reach only trade/buddy,
	// which left the trash filter free to release purified mons — and the age
	// safety net below ORs `purified` in, so the flag the user believed was
	// protective was the one widening scope. The age clause keeps its `purified`
	// term for the protectPurified:false case.
	if (cfg.protectPurified) push(trashClauses, `!${kw.flag.purified}`, tFn('app.clause_why.purified'));
	{
		const mp = maxProtectClause();
		if (mp) push(trashClauses, mp[0], mp[1]);
	}
	if (cfg.protectNewEvolutions)
		push(trashClauses, `!${kw.flag.new_evo},${kw.flag.mega}0`, tFn('app.clause_why.new_evolutions'));
	if (cfg.protectLegacyMoves) push(trashClauses, legacyMovesClause(), tFn('app.clause_why.legacy_moves'));
	if (cfg.protectBabies) push(trashClauses, `!${kw.flag.baby}`, tFn('app.clause_why.babies'));
	if (cfg.distanceProtect && cfg.distanceProtect > 0)
		push(
			trashClauses,
			`!${kw.numeric.distance}${cfg.distanceProtect}-,${kw.flag.traded}`,
			tFn('app.clause_why.distance', { params: { km: cfg.distanceProtect } }),
		);
	if (cfg.protectXXL) push(trashClauses, `!${kw.flag.xxl}`, tFn('app.clause_why.xxl'));
	if (cfg.protectXL) push(trashClauses, `!${kw.flag.xl}`, tFn('app.clause_why.xl'));
	if (cfg.protectXXS) push(trashClauses, `!${kw.flag.xxs}`, tFn('app.clause_why.xxs'));
	for (const t of leagueTags) push(trashClauses, `!${t}`, tFn('app.clause_why.league_tag', { params: { tag: t } }));
	if (cfg.protectBuddies) push(trashClauses, `!${kw.numeric.buddy}1-`, tFn('app.clause_why.buddies_were'));
	if (cfg.protectDoubleMoved) push(trashClauses, '@3move', tFn('app.clause_why.double_moved_trash'));

	// Regional groups
	const groups = cfg.regionalGroups || {};
	const hundoOutSet = new Set(hundosOut);
	for (const [key, group] of Object.entries(REGIONAL_GROUPS)) {
		const state = groups[key];
		if (!state || !state.enabled) continue;
		for (const tc of group.typeChecks) {
			if (state.typeChecksEnabled !== null && !state.typeChecksEnabled.includes(tc.species)) continue;
			// Auto-drop type-form protection when home is in this form's region —
			// e.g. Madrid user catches Paldean Tauros (Combat = Fighting) locally,
			// so the fighting clause shouldn't sit in trash. Mirrors the
			// homeLocals-based auto-drop for bare collectors.
			if (homeLocalTypeChecks.some((l) => l.species === tc.species && l.type === tc.type)) continue;
			const speciesOut = speciesForOutput(tc.species, outputLocale);
			// NO hundo carve-out here (deliberately): a regional stays excluded from
			// trash even once you own its hundo — a regional dupe is trade bait for
			// friends, not junk. The user opts OUT explicitly by unchecking the
			// species in the regionals step; the hundo adder tells them so when they
			// add a protected regional (HundoRegionalNotice).
			const speciesDisplay = capFirst(speciesOut);
			const typeOut = kw.type[tc.type] || tc.type;
			// Optional excludeTypes carves additional negative-type modifiers into the
			// clause, e.g. Paldean Combat = Fighting only (not Fire, not Water):
			//   !Tauros,!fighting,fire,water  →  protect (Tauros AND Fighting AND NOT Fire AND NOT Water)
			// Without this, the bare !Tauros,!fighting clause would umbrella-protect
			// Blaze and Aqua too (both have Fighting), defeating their own region-aware drops.
			const excludeParts = (tc.excludeTypes || []).map((t) => kw.type[t] || t);
			const excludePart = excludeParts.length > 0 ? `,${excludeParts.join(',')}` : '';
			// OR-binds-tighter: appending `,traded` keeps anything that isn't this
			// regional form OR has already been traded — i.e. the clause only
			// protects *untraded* regionals. Traded duplicates fall through to the
			// rest of the trash pipeline (bad-IV checks, etc.).
			const tradedCarve = cfg.trashTradedRegionals ? `,${kw.flag.traded}` : '';
			const whyCarve = cfg.trashTradedRegionals ? ` (${tFn('app.clause_why.except_traded_short')})` : '';
			push(
				trashClauses,
				`!${speciesDisplay},!${typeOut}${excludePart}${tradedCarve}`,
				`${tFn(group.labelKey)}: ${tFn(tc.noteKey)}${whyCarve}`,
			);
		}
		// Collectors — resolve each to outputLocale, then collapse families.
		// Same as the typeChecks above: hundo ownership does NOT drop the
		// protection — unchecking the collector chip is the explicit opt-out.
		const enabledCollectorsOut = group.collectors
			.filter((sp) => state.collectorsEnabled === null || state.collectorsEnabled.includes(sp))
			.map((sp) => speciesForOutput(sp, outputLocale));
		const collapsed = collapseFamilies(enabledCollectorsOut, FAMILY_COLLAPSES);
		for (const entry of collapsed) {
			const groupLabel = tFn(group.labelKey);
			push(
				trashClauses,
				`!${entry}`,
				entry.startsWith('+')
					? `${groupLabel}: ${entry} (${tFn('app.regional_editor.all_family_members')})`
					: `${groupLabel}: ${entry}`,
			);
		}
	}
	// Custom collectibles
	const allRegionalCollectorsOut = new Set(
		Object.values(REGIONAL_GROUPS)
			.flatMap((g) => g.collectors)
			.map((sp) => speciesForOutput(sp, outputLocale)),
	);
	for (const sp of cfg.customCollectibles || []) {
		const lower = speciesForOutput(sp, outputLocale);
		// No hundo gate here either — a custom collectible is explicit user
		// intent; removing it from the list is the opt-out.
		if (allRegionalCollectorsOut.has(lower)) continue;
		const display = capFirst(lower);
		push(trashClauses, `!${display}`, tFn('app.clause_why.custom_collectible', { params: { name: display } }));
	}
	// Map-marked trade candidates (the RegionalMap bazaar list). The !#<basarTag>
	// clause above only protects mons the user has ALREADY tagged in-game — a
	// fresh travel catch is untagged until they get around to it, and the species
	// may carry no collector protection at all (form-regionals like Choreogel are
	// auto-dropped from collectibles when home has a local form). Protecting the
	// species here makes marking on the map immediately safe. Deliberately NOT
	// gated on hundos/homeLocals: the mark is explicit user intent (bring these
	// back for friends), which outranks every redundancy carve-out. Region names
	// may carry a form suffix PoGo search can't express ("Choreogel (Buyo)") —
	// strip it and protect the whole species.
	const bazaarSpeciesSeen = new Set();
	for (const raw of bazaarSpecies || []) {
		const base = String(raw).replace(/\s*\(.*?\)\s*$/, '');
		const lower = speciesForOutput(base, outputLocale);
		if (!lower || bazaarSpeciesSeen.has(lower)) continue;
		bazaarSpeciesSeen.add(lower);
		const display = capFirst(lower);
		// Skip if an identical species clause already exists (enabled collector or
		// custom collectible) — clause case differs between the two, so compare
		// case-insensitively.
		if (trashClauses.some((c) => c.clause.toLowerCase() === `!${lower}`)) continue;
		push(trashClauses, `!${display}`, tFn('app.clause_why.bazaar_species', { params: { name: display } }));
	}
	if (cfg.cpCap && cfg.cpCap > 0)
		push(
			trashClauses,
			`${kw.numeric.cp}-${cfg.cpCap}`,
			tFn('app.clause_why.cp_cap', { params: { cp: cfg.cpCap } }),
		);
	if (cfg.ageScopeDays && cfg.ageScopeDays > 0)
		push(
			trashClauses,
			`${kw.numeric.age}-${cfg.ageScopeDays},${kw.flag.traded},${kw.flag.purified}`,
			tFn('app.clause_why.age_traded', { params: { days: cfg.ageScopeDays } }),
		);
	if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
		push(
			trashClauses,
			`${kw.numeric.year}${cfg.luckyEligibleYear}-,${kw.flag.traded}`,
			tFn('app.clause_why.lucky_eligible', { params: { year: cfg.luckyEligibleYear } }),
		);

	const trash = trashClauses.map((c) => c.clause).join('&');

	// "Traded trash review" — narrows the trash filter to traded mons only,
	// so the user can flip through traded candidates before bulk-trashing
	// them. Effectively `trash & traded`. Mostly useful with
	// trashTradedRegionals on (otherwise the only traded mons in trash come
	// through the age/distance/lucky scope clauses).
	const tradedTrashSort = trash ? `${trash}&${kw.flag.traded}` : '';

	// ── TRADE ──────────────────────────────────────────────────────────────
	// H_trade = H − (H ∩ L). Species the user has both a hundo and a lucky of
	// fall out here: trash still surfaces them via the full H clause, but
	// trade skips them — every duplicate is already redundant.
	push(
		tradeClauses,
		[S012, TE_trim_str, H_trade].filter(Boolean).join(','),
		luckyHundoSet.size > 0 ? tFn('app.clause_why.h_s012_te_lucky_excluded') : tFn('app.clause_why.h_s012_te'),
	);
	push(tradeClauses, [S012, TE_full_str, ivK1Bad].filter(Boolean).join(','), tFn('app.clause_why.not_k1_te'));
	push(tradeClauses, [S012, TE_full_str, ivK2Bad].filter(Boolean).join(','), tFn('app.clause_why.not_k2_te'));
	push(tradeClauses, [S012, TE_full_str, ivK3Bad].filter(Boolean).join(','), tFn('app.clause_why.not_k3_te'));
	if (notP) push(tradeClauses, notP, tFn('app.clause_why.not_p', { params: { mode: cfg.pvpMode } }));
	pushPvPMetaClauses(tradeClauses);

	// Mandatory trade constraints (physical game rules — always apply)
	push(tradeClauses, `!${kw.flag.traded}`, tFn('app.clause_why.must_traded'));
	push(tradeClauses, `!${kw.flag.shadow}`, tFn('app.clause_why.must_shadow'));
	push(tradeClauses, `!${kw.flag.lucky}`, tFn('app.clause_why.must_lucky_long'));
	push(tradeClauses, `!${kw.flag.mythical},808,809`, tFn('app.clause_why.must_mythical_long'));

	if (cfg.protectAnyTag) {
		push(tradeClauses, '!#', tFn('app.clause_why.any_tag_trade'));
	} else {
		if (basarTag)
			push(tradeClauses, `!#${basarTag}`, tFn('app.clause_why.bazaar_tag_trade', { params: { tag: basarTag } }));
		if (fernTauschTag)
			push(
				tradeClauses,
				`!#${fernTauschTag}`,
				tFn('app.clause_why.fern_tausch_tag_trade', { params: { tag: fernTauschTag } }),
			);
		for (const t of customTags)
			push(tradeClauses, `!#${t}`, tFn('app.clause_why.custom_tag', { params: { tag: t } }));
		// Buddy stockpiles are staged for a *specific* friend — keep them out of the
		// general trade filter (mirrors the trash protection at L711-714 and makes
		// buddy tags behave exactly like the basar/fern trade tags above). The
		// prestaged filter surfaces them for the actual hand-off.
		for (const b of activeBuddies) {
			const prefix = b.tagPrefix.replace(/^#/, '');
			push(tradeClauses, `!#${prefix}`, tFn('app.clause_why.buddy_tag', { params: { name: b.name, prefix } }));
		}
	}

	if (cfg.protectLegendaries) push(tradeClauses, `!${kw.flag.legendary}`, tFn('app.clause_why.legendaries'));
	if (cfg.protectUltraBeasts) push(tradeClauses, `!${kw.flag.ultra_beast}`, tFn('app.clause_why.ultra_beasts'));
	if (cfg.protectShinies) push(tradeClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_trade'));
	if (cfg.protectCostumes) push(tradeClauses, `!${kw.flag.costume}`, tFn('app.clause_why.costumes_trade'));
	if (cfg.protectPurified) push(tradeClauses, `!${kw.flag.purified}`, tFn('app.clause_why.purified'));
	if (cfg.protectBackgrounds) push(tradeClauses, `!${kw.flag.background}`, tFn('app.clause_why.backgrounds_trade'));
	if (cfg.protectFavorites) push(tradeClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites'));
	push(tradeClauses, '!4*', tFn('app.clause_why.rule1_no_4star_trade'));
	if (cfg.protectNundos) {
		push(
			tradeClauses,
			`1-4${kw.iv.atk},1-4${kw.iv.def},1-4${kw.iv.hp}`,
			tFn('app.clause_why.protect_nundos_trade'),
		);
	}
	for (const t of leagueTags) push(tradeClauses, `!${t}`, tFn('app.clause_why.league_tag', { params: { tag: t } }));
	// Trading away a former buddy forfeits the walked-distance/affection history;
	// mirror the trash protection (search for cfg.protectBuddies above).
	if (cfg.protectBuddies) push(tradeClauses, `!${kw.numeric.buddy}1-`, tFn('app.clause_why.buddies_were'));
	if (cfg.protectDoubleMoved) push(tradeClauses, '@3move', tFn('app.clause_why.double_moved_trade'));
	{
		const mp = maxProtectClause();
		if (mp) push(tradeClauses, mp[0], mp[1]);
	}
	// Trading away a would-be new-dex evolution costs you the registration; mirror
	// the trash protection (L738) so it isn't bulk-traded.
	if (cfg.protectNewEvolutions)
		push(tradeClauses, `!${kw.flag.new_evo},${kw.flag.mega}0`, tFn('app.clause_why.new_evolutions'));
	if (cfg.protectXXL) push(tradeClauses, `!${kw.flag.xxl}`, tFn('app.clause_why.xxl_trade'));
	if (cfg.protectXL) push(tradeClauses, `!${kw.flag.xl}`, tFn('app.clause_why.xl_trade'));
	// XXS completes the size-medal triplet — trash (L760) and buddyCatch already
	// protect it; trade protected only XXL/XL. Reuses the shared `xxs` why-key.
	if (cfg.protectXXS) push(tradeClauses, `!${kw.flag.xxs}`, tFn('app.clause_why.xxs'));
	if (cfg.protectLegacyMoves) push(tradeClauses, legacyMovesClause(), tFn('app.clause_why.legacy_moves'));
	if (cfg.ageScopeDays && cfg.ageScopeDays > 0)
		push(
			tradeClauses,
			`${kw.numeric.age}-${cfg.ageScopeDays},${kw.flag.purified}`,
			tFn('app.clause_why.age_only', { params: { days: cfg.ageScopeDays } }),
		);
	if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
		push(
			tradeClauses,
			`${kw.numeric.year}${cfg.luckyEligibleYear}-`,
			tFn('app.clause_why.lucky_eligible', { params: { year: cfg.luckyEligibleYear } }),
		);
	push(tradeClauses, `${kw.numeric.distance}0-`, tFn('app.clause_why.distance_zero'));
	// Deliberate trash/trade asymmetry: babies (cfg.protectBabies) and regional
	// collectibles/customCollectibles are protected in trash but intentionally
	// NOT mirrored here — trading duplicates away (including regional dupes to a
	// friend who needs the dex entry) is a feature, not a loss. Size medals,
	// new-dex evolutions, and the other keepers above ARE mirrored because
	// trading them away forfeits something unrecoverable.

	const trade = tradeClauses.map((c) => c.clause).join('&');

	// ── PRE-STAGED TRADES ──────────────────────────────────────────────────
	const prestagedClauses = [];
	const tagList = [];
	if (basarTag) tagList.push(`#${basarTag}`);
	if (fernTauschTag) tagList.push(`#${fernTauschTag}`);
	// Buddy stockpiles are the hand-off pile: once a mon is tagged #buddyname the
	// buddy *catch* filter (which gates on `!#`) no longer surfaces it, so without
	// this it would never appear in any filter for the actual meet-up trade.
	// Including the prefixes here makes #buddyname behave like the basar/fern
	// trade tags — protected in trade, surfaced here when staged.
	for (const b of activeBuddies) tagList.push(`#${b.tagPrefix.replace(/^#/, '')}`);
	if (tagList.length > 0) {
		push(
			prestagedClauses,
			tagList.join(','),
			tFn('app.clause_why.prestaged_marked', { params: { tags: tagList.join(', ') } }),
		);
		push(prestagedClauses, `!${kw.flag.traded}`, tFn('app.clause_why.must_traded_short'));
		push(prestagedClauses, `!${kw.flag.shadow}`, tFn('app.clause_why.must_shadow_short'));
		push(prestagedClauses, `!${kw.flag.lucky}`, tFn('app.clause_why.must_lucky_short'));
		push(prestagedClauses, `!${kw.flag.mythical},808,809`, tFn('app.clause_why.must_mythical_short'));
	}
	const prestaged = prestagedClauses.map((c) => c.clause).join('&');

	// ── BUDDY FILTERS ──────────────────────────────────────────────────────
	const buddyCatchFilters = [];
	// One combined catch filter per buddy: a single species OR-list selects every
	// wished species, and form-restricted targets add per-species type guards.
	// The guard clauses below are shared by that filter, so factor them out.
	const pushBuddyGuards = (clauses) => {
		push(clauses, '!#', tFn('app.clause_why.not_tagged'));
		push(clauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites_protected'));
		push(clauses, `!${kw.flag.traded}`, tFn('app.clause_why.must_traded_short'));
		push(clauses, `!${kw.flag.shadow}`, tFn('app.clause_why.must_shadow_short'));
		push(clauses, `!${kw.flag.lucky}`, tFn('app.clause_why.must_lucky_short'));
		push(clauses, `!${kw.flag.mythical},808,809`, tFn('app.clause_why.must_mythical_short'));
		push(clauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_keep'));
		push(clauses, `!${kw.flag.legendary}`, tFn('app.clause_why.legendaries_keep'));
		if (cfg.protectUltraBeasts) push(clauses, `!${kw.flag.ultra_beast}`, tFn('app.clause_why.ultra_beasts'));
		if (cfg.protectCostumes) push(clauses, `!${kw.flag.costume}`, tFn('app.clause_why.costumes_trade'));
		if (cfg.protectPurified) push(clauses, `!${kw.flag.purified}`, tFn('app.clause_why.purified'));
		if (cfg.protectBackgrounds) push(clauses, `!${kw.flag.background}`, tFn('app.clause_why.backgrounds_trade'));
		if (cfg.protectNundos) {
			push(clauses, `1-4${kw.iv.atk},1-4${kw.iv.def},1-4${kw.iv.hp}`, tFn('app.clause_why.protect_nundos_trade'));
		}
		if (cfg.protectDoubleMoved) push(clauses, '@3move', tFn('app.clause_why.double_moved_trade'));
		{
			const mp = maxProtectClause();
			if (mp) push(clauses, mp[0], mp[1]);
		}
		if (cfg.protectXXL) push(clauses, `!${kw.flag.xxl}`, tFn('app.clause_why.xxl_trade'));
		if (cfg.protectXL) push(clauses, `!${kw.flag.xl}`, tFn('app.clause_why.xl_trade'));
		if (cfg.protectXXS) push(clauses, `!${kw.flag.xxs}`, tFn('app.clause_why.xxs'));
		if (cfg.protectLegacyMoves) push(clauses, legacyMovesClause(), tFn('app.clause_why.legacy_moves'));
	};
	// Stars-to-trash line, with the spare-hundo carve-out: if the buddy wants a
	// species you already own a hundo of, surface its 3★+ copies too (you don't
	// need them once the 4★ is in the bag), guarded by `!4*` so you never give
	// away the hundo itself. Lucky copies stay protected by the `!lucky` guard.
	// `spareSelectors` are the species selectors (bare or +family, matching the
	// target's own expand flag) to OR into the stars line.
	const pushStarsOrSpare = (clauses, spareSelectors) => {
		if (spareSelectors.length > 0) {
			push(clauses, ['0*,1*,2*', ...spareSelectors].join(','), tFn('app.clause_why.buddy_catch_or_spare'));
			push(clauses, '!4*', tFn('app.clause_why.never_gift_4star'));
		} else {
			push(clauses, '0*,1*,2*', tFn('app.clause_why.trashable_stars'));
		}
	};

	for (const b of activeBuddies) {
		const prefix = b.tagPrefix.replace(/^#/, '');
		// targetSpecies entries are structured Targets { species, expand, dropForms,
		// gender } (legacy strings / typed targets are migrated to this shape on
		// load). Resolve each to an output-locale display name. Whole-species
		// targets (dropForms empty) and form-restricted targets both feed ONE
		// combined filter: every species joins the union OR-list, and each dropped
		// form / gender pick adds a per-species guard below.
		const allTargets = (b.targetSpecies || [])
			.filter((t) => t && t.species)
			.map((t) => ({
				species: t.species,
				display: speciesForOutput(t.species, outputLocale),
				expand: !!t.expand,
				dropForms: Array.isArray(t.dropForms) ? t.dropForms : [],
				gender: t.gender === 'male' || t.gender === 'female' ? t.gender : 'any',
			}));
		const plainTargets = allTargets.filter((t) => t.dropForms.length === 0);
		const formTargets = allTargets.filter((t) => t.dropForms.length > 0);
		const wantsTE = !!b.wantsTradeEvos && TE_full.length > 0;
		const rawAppend = (b.rawAppend || '').trim();
		const hasRaw = !!cfg.expertMode && rawAppend.length > 0;
		if (plainTargets.length === 0 && formTargets.length === 0 && !wantsTE && !hasRaw) continue;

		// Selector string for one target, honoring its +family expansion toggle.
		// expand=false → bare name (only that species); expand=true → +family.
		const sel = (t) => (t.expand ? `+${t.display}` : t.display);

		// Form-restricted targets that still keep ≥1 form. They join the union AND
		// contribute drop guards. (A target with every form dropped catches nothing,
		// so it's omitted entirely; the UI's picker won't let you drop the last form,
		// but a hand-edited import could.) dropForms keys are pre-validated against
		// the catalog in normalizeBuddyTarget, so any non-empty dropForms here means
		// ≥1 real dropped form.
		const liveFormTargets = formTargets.filter((t) => {
			const forms = regionalFormsFor(t.species) || [];
			return forms.some((f) => !new Set(t.dropForms).has(f.key));
		});

		// ── One combined catch filter per buddy ────────────────────────────────
		// The species OR-list selects the union of every wished species (whole-
		// species + form-restricted + trade-evo families). Each form-restricted
		// target then adds, per dropped form, a guard of the shape
		// `!<species>,<drop-types>` = "NOT this species OR NOT the dropped form" —
		// an implication that constrains ONLY that species and leaves the rest of
		// the union untouched (same `!+name,…` idiom the trash filter uses at L790).
		// PoGo's comma-tighter-than-& precedence keeps each guard self-contained.
		// Examples: drop Galar Mauzi {include:[steel]} → `!mauzi,!stahl`; drop Paldea
		// combat Tauros {include:[fighting],exclude:[fire,water]} → `!tauros,!kampf,feuer,wasser`.
		const unionTargets = [...plainTargets, ...liveFormTargets];
		const speciesParts = [
			...unionTargets.map(sel),
			...(wantsTE ? TE_full.map((base) => `+${teDisplay(base, outputLocale)}`) : []),
		];
		if (speciesParts.length > 0 || hasRaw) {
			const catchClauses = [];
			if (speciesParts.length > 0) {
				const why = [
					unionTargets.length > 0
						? tFn('app.clause_why.buddy_targets_count', { params: { count: unionTargets.length } })
						: null,
					wantsTE ? tFn('app.clause_why.buddy_te_count', { params: { count: TE_full.length } }) : null,
				]
					.filter(Boolean)
					.join(' + ');
				push(catchClauses, speciesParts.join(','), `${b.name}: ${why}`);
			}
			pushStarsOrSpare(catchClauses, unionTargets.filter((t) => hundoOutSet.has(t.display)).map(sel));
			// Per-species form guards — one comma-OR `&`-clause per dropped form.
			for (const t of liveFormTargets) {
				const forms = regionalFormsFor(t.species) || [];
				const dropSet = new Set(t.dropForms);
				for (const f of forms.filter((x) => dropSet.has(x.key))) {
					const deMorgan = [
						...(f.include || []).map((ty) => `!${kw.type[ty] || ty}`),
						...(f.exclude || []).map((ty) => kw.type[ty] || ty),
					].join(',');
					if (!deMorgan) continue;
					push(
						catchClauses,
						`!${sel(t)},${deMorgan}`,
						tFn('app.clause_why.buddy_drop_form', {
							params: { species: capFirst(t.display), region: formRegionLabel(f, tFn) },
						}),
					);
				}
			}
			// Per-species gender guards — same scoped implication as the form
			// guards: `!<species>,<gender-kw>` = "NOT this species OR the wanted
			// gender" constrains only that species and leaves the union untouched.
			for (const t of unionTargets) {
				if (t.gender !== 'male' && t.gender !== 'female') continue;
				push(
					catchClauses,
					`!${sel(t)},${kw.flag[t.gender]}`,
					tFn(`app.clause_why.buddy_gender_${t.gender}`, { params: { species: capFirst(t.display) } }),
				);
			}
			pushBuddyGuards(catchClauses);
			// ── Expert raw append — extra `&`-clauses on the SAME filter ─────────
			// Verbatim, split on `&` only so each piece shows up as its own clause
			// in the explain panel; the `&`-join below reconstructs the input
			// exactly. Comma binds tighter than `&`, so each comma-group (e.g.
			// `!361,weiblich,female`) stays a self-contained guard.
			if (hasRaw) {
				for (const part of rawAppend.split('&')) {
					push(catchClauses, part, tFn('app.clause_why.buddy_raw_append'));
				}
			}
			buddyCatchFilters.push({
				buddyName: b.name,
				prefix,
				filter: catchClauses.map((c) => c.clause).join('&'),
				clauses: catchClauses,
			});
		}
	}

	// ── HUNDO-SORT ─────────────────────────────────────────────────────────
	const sortClauses = [];
	if (hundos.length > 0) {
		push(sortClauses, H, tFn('app.clause_why.all_hundo_families'));
		// Regional form-scoping: when a hundo is annotated to specific form(s),
		// narrow its `+family` term to only the owned form's duplicates so the
		// other regional forms (still chase-worthy) stay hidden.
		for (const h of hundos) {
			const key = canonKey(h);
			const hide = formScopedSortGuards(key, cfg.hundoForms?.[key]);
			const hideGenders = genderScopedSortGuards(key, cfg.hundoGenders?.[key]);
			if (hide.length === 0 && hideGenders.length === 0) continue;
			const out = speciesForOutput(h, outputLocale);
			for (const f of hide)
				push(
					sortClauses,
					`!+${out},${formDropTerms(f)}`,
					tFn('app.clause_why.sort_form_scope', {
						params: { species: capFirst(out), region: formRegionLabel(f, tFn) },
					}),
				);
			for (const g of hideGenders)
				push(
					sortClauses,
					`!+${out},${genderDropTerms(g)}`,
					tFn('app.clause_why.sort_gender_scope', { params: { species: capFirst(out) } }),
				);
		}
		if (cfg.protectAnyTag) push(sortClauses, '!#', tFn('app.clause_why.all_tags_protected'));
		if (cfg.protectFavorites) push(sortClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites_protected'));
		if (cfg.protectShinies) push(sortClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
		if (cfg.protectLuckies) push(sortClauses, `!${kw.flag.lucky}`, tFn('app.clause_why.luckies_protected'));
	}
	const sort = sortClauses.map((c) => c.clause).join('&');

	// ── LUCKY-HUNDO-SORT ───────────────────────────────────────────────────
	// Narrower variant of HUNDO-SORT for the H ∩ L set: species where both
	// the IV chase and the lucky-friend chase are done. Surface duplicates
	// so the user can bulk-review and trash. Same protections — the original
	// hundo/lucky copies stay hidden (they carry favorite / lucky / shiny flags).
	// Regional forms: a species qualifies only for the form(s) where BOTH a hundo
	// AND a lucky are owned (jointlyDoneForms); a mismatched form (e.g. Alolan
	// hundo + Kanto lucky) drops out entirely. Derives a SEPARATE member list —
	// luckyHundoSet itself feeds hundosForTrade/the trade filter and must stay
	// species-level. Gates on the surviving members, not luckyHundoSet.size, so an
	// all-mismatched set emits nothing (not a guards-only string over the whole box).
	const luckySortClauses = [];
	const luckySortMembers = [];
	const luckySortGuards = [];
	for (const h of luckyHundoSet) {
		const key = canonKey(h);
		const done = jointlyDoneForms(key); // null | Form[] | []
		if (Array.isArray(done) && done.length === 0) continue; // no jointly-done form → drop
		const out = speciesForOutput(h, outputLocale);
		luckySortMembers.push(out);
		if (Array.isArray(done)) {
			const doneSet = new Set(done.map((f) => f.key));
			for (const f of regionalFormsFor(key) || [])
				if (!doneSet.has(f.key) && formDropTerms(f)) luckySortGuards.push({ out, form: f });
		}
	}
	if (luckySortMembers.length > 0) {
		push(
			luckySortClauses,
			luckySortMembers.map((o) => `+${o}`).join(','),
			tFn('app.clause_why.all_lucky_hundo_families'),
		);
		for (const g of luckySortGuards)
			push(
				luckySortClauses,
				`!+${g.out},${formDropTerms(g.form)}`,
				tFn('app.clause_why.lucky_hundo_form_scope', {
					params: { species: capFirst(g.out), region: formRegionLabel(g.form, tFn) },
				}),
			);
		if (cfg.protectAnyTag) push(luckySortClauses, '!#', tFn('app.clause_why.all_tags_protected'));
		if (cfg.protectFavorites)
			push(luckySortClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites_protected'));
		if (cfg.protectShinies) push(luckySortClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
		if (cfg.protectLuckies) push(luckySortClauses, `!${kw.flag.lucky}`, tFn('app.clause_why.luckies_protected'));
	}
	const luckySort = luckySortClauses.map((c) => c.clause).join('&');

	// ── LUCKY-SORT ─────────────────────────────────────────────────────────
	// Lucky analogue of HUNDO-SORT keyed on the luckies list: surface every member
	// of your lucky families so you can pin/review them. Unlike the two sorts above
	// it emits NO !lucky guard — the whole point is to see the lucky copies. Regional
	// form-scoped via cfg.luckyForms, exactly like the hundo-sort.
	const luckyFamilySortClauses = [];
	if (luckies.length > 0) {
		const L = luckies.map((l) => `+${speciesForOutput(l, outputLocale)}`).join(',');
		push(luckyFamilySortClauses, L, tFn('app.clause_why.all_lucky_families'));
		for (const l of luckies) {
			const key = canonKey(l);
			const hide = formScopedSortGuards(key, cfg.luckyForms?.[key]);
			const hideGenders = genderScopedSortGuards(key, cfg.luckyGenders?.[key]);
			if (hide.length === 0 && hideGenders.length === 0) continue;
			const out = speciesForOutput(l, outputLocale);
			for (const f of hide)
				push(
					luckyFamilySortClauses,
					`!+${out},${formDropTerms(f)}`,
					tFn('app.clause_why.sort_form_scope', {
						params: { species: capFirst(out), region: formRegionLabel(f, tFn) },
					}),
				);
			for (const g of hideGenders)
				push(
					luckyFamilySortClauses,
					`!+${out},${genderDropTerms(g)}`,
					tFn('app.clause_why.sort_gender_scope', { params: { species: capFirst(out) } }),
				);
		}
		if (cfg.protectAnyTag) push(luckyFamilySortClauses, '!#', tFn('app.clause_why.all_tags_protected'));
		if (cfg.protectFavorites)
			push(luckyFamilySortClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites_protected'));
		if (cfg.protectShinies)
			push(luckyFamilySortClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
	}
	const luckyFamilySort = luckyFamilySortClauses.map((c) => c.clause).join('&');

	// ── NUNDO-SORT ─────────────────────────────────────────────────────────
	// Surface every 0/0/0 IV catch. PoGo's storage UI doesn't expose appraisal
	// results as a filter, so this is the only way to bulk-browse Nundos for
	// the collection wall. No favorite/tag exclusions — the whole point is
	// finding every 0/0/0, including ones already starred or tagged.
	const nundoSortClauses = [];
	if (cfg.protectNundos) {
		push(nundoSortClauses, `0${kw.iv.atk}`, tFn('app.clause_why.nundo_atk_zero'));
		push(nundoSortClauses, `0${kw.iv.def}`, tFn('app.clause_why.nundo_def_zero'));
		push(nundoSortClauses, `0${kw.iv.hp}`, tFn('app.clause_why.nundo_hp_zero'));
	}
	const nundoSort = nundoSortClauses.map((c) => c.clause).join('&');

	// ── GIFT FILTER ────────────────────────────────────────────────────────
	const giftClauses = [];
	const valuables = [kw.flag.shiny, kw.flag.legendary, kw.flag.ultra_beast, kw.flag.costume, kw.flag.background];
	const homeLocalsList = (homeLocals || []).map((n) => speciesForOutput(n, outputLocale)).filter(Boolean);
	const valueParts = [...valuables, ...homeLocalsList];
	if (valueParts.length > 0) {
		const valueWhy =
			homeLocalsList.length > 0
				? tFn('app.clause_why.valuables_with_locals', { params: { count: homeLocalsList.length } })
				: tFn('app.clause_why.valuables_no_locals');
		push(giftClauses, valueParts.join(','), valueWhy);
	}
	push(giftClauses, `!${kw.flag.traded}`, tFn('app.clause_why.gift_must_traded'));
	push(giftClauses, `!${kw.flag.shadow}`, tFn('app.clause_why.gift_must_shadow'));
	push(giftClauses, `!${kw.flag.mythical},808,809`, tFn('app.clause_why.must_mythical_short'));
	push(giftClauses, `!${kw.flag.lucky}`, tFn('app.clause_why.gift_must_lucky'));
	push(giftClauses, '!4*', tFn('app.clause_why.never_gift_4star'));
	push(giftClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites_protected'));
	// Unconditional (unlike trash/trade which gate on cfg.protectLegacyMoves):
	// gifting transfers the mon away, so the legacy move is unrecoverable.
	// Same family as the mandatory !traded / !shadow / !lucky constraints above.
	push(
		giftClauses,
		`!@${kw.flag.special_move},@${kw.flag.return},@${kw.flag.frustration}`,
		tFn('app.clause_why.never_gift_legacy'),
	);
	if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
		push(
			giftClauses,
			`${kw.numeric.year}${cfg.luckyEligibleYear}-`,
			tFn('app.clause_why.lucky_eligible', { params: { year: cfg.luckyEligibleYear } }),
		);
	const tagAllowList = [];
	if (basarTag) tagAllowList.push(`#${basarTag}`);
	if (fernTauschTag) tagAllowList.push(`#${fernTauschTag}`);
	if (tagAllowList.length > 0) {
		push(
			giftClauses,
			`!#,${tagAllowList.join(',')}`,
			tFn('app.clause_why.untagged_or_marked', { params: { tags: tagAllowList.join(', ') } }),
		);
	} else {
		push(giftClauses, '!#', tFn('app.clause_why.other_tags_protected'));
	}
	const gift = giftClauses.map((c) => c.clause).join('&');

	// ── FRIEND WISHLIST ──────────────────────────────────────────────────────
	// A search string the user hands to a FRIEND. The friend pastes it into
	// THEIR OWN storage; it surfaces their tradeable Pokémon of species the user
	// still lacks as a lucky / as a hundo, so the friend can trade them over.
	//
	// Encoded as a BLACKLIST (exclude the species the user already owns) using
	// family-expanded NAME selectors (`!+glurak`) rendered in outputLocale — the
	// share panel's locale picker sets that to the FRIEND's PoGo language.
	// Family expansion because lucky status and IVs both survive evolution: one
	// family member covers the whole line, and `+name` is the only family
	// syntax PoGo has (there is no `+dex`). Only the species names and the flag
	// keywords (!traded / !shadow / !mythical) are locale-sensitive. Blacklist
	// also scales with the (smaller) owned set rather than the ~1000 missing
	// species, keeping the string well under PoGo's ~5000-char box.
	//
	// Trade guards mirror the GIFT filter (the proven inverse pattern), in two
	// tiers:
	//   can't be traded AT ALL —
	//   !traded            — a mon can be traded only ONCE; already-traded = dead end
	//   !shadow            — shadows can never be traded
	//   !mythical,808,809  — mythicals untradeable except Meltan / Melmetal
	//   copy would be a SPECIAL trade (wishlists are regular-trade workflows) —
	//   !shiny             — shinies always trigger a Special Trade
	//   !costume           — costumes do when the exact costume is unregistered
	//   !background        — special/location backgrounds always do
	//   !purified          — purified always do
	// Species-level special trades (a curated legendary, blacklist-style
	// legendaries in the fallbacks) deliberately remain — those are the user's
	// explicit asks; the suggestion packs already filter them via
	// SPECIAL_TRADE_DEX.
	// The HUNDO list has NO 4* clause on purpose: trading re-rolls IVs, so a
	// friend can't send a finished hundo — any untraded specimen is a valid roll
	// (best odds in a lucky trade: 12/12/12 floor). The LUCKY list has an
	// optional "guaranteed-lucky" variant restricting to old catches (jahr-N)
	// that are guaranteed Lucky on trade.

	// Canonical-name HAVE-list → sorted, de-duplicated output-locale species
	// names to negate. resolveSpeciesInfo collapses forms (mega/regional) to
	// their base dex; unresolvable entries are dropped rather than emitting a
	// broken selector.
	// Each entry carries its dex as well as its name, so the exclusion planner
	// below can reason about the LINE (baby stage, coin-flip branch) rather than
	// just the string.
	const ownedSpeciesNames = (names) => {
		const seen = new Map();
		for (const n of names || []) {
			const dex = resolveSpeciesInfo(n)?.dex;
			const out = dex ? pokemonNameFor(String(dex), outputLocale) : null;
			if (out) seen.set(out.toLowerCase(), dex);
		}
		return [...seen]
			.map(([out, dex]) => ({ out, dex }))
			.sort((a, b) => a.out.localeCompare(b.out));
	};
	// Every dex the have-list actually holds — the lookup the planner needs to
	// answer "is the baby stage / the other branch already covered?".
	const ownedDexSet = (names) =>
		new Set((names || []).map((n) => resolveSpeciesInfo(n)?.dex).filter(Boolean));

	// Shared trade-eligibility guards appended to every friend wishlist.
	const pushFriendTradeGuards = (clauses) => {
		push(clauses, `!${kw.flag.traded}`, tFn('app.clause_why.gift_must_traded'));
		push(clauses, `!${kw.flag.shadow}`, tFn('app.clause_why.gift_must_shadow'));
		push(clauses, `!${kw.flag.mythical},808,809`, tFn('app.clause_why.must_mythical_short'));
		push(clauses, `!${kw.flag.shiny}`, tFn('app.clause_why.friend_no_shiny'));
		push(clauses, `!${kw.flag.costume}`, tFn('app.clause_why.friend_no_costume'));
		push(clauses, `!${kw.flag.background}`, tFn('app.clause_why.friend_no_background'));
		push(clauses, `!${kw.flag.purified}`, tFn('app.clause_why.friend_no_purified'));
	};

	// Form-scoped exclusion plans for the fallback wishlists. An owned entry
	// annotated to specific regional form(s) (cfg.luckyForms / cfg.hundoForms,
	// click-only badges on the step-3 chips) excludes only those forms — the
	// un-owned forms stay visible to the friend: a lucky Kanto Vulpix must not
	// hide their Alolan one. Keyed by OUTPUT-locale name to match
	// ownedSpeciesNames; annotation covering every catalog form (or any form
	// without a usable type predicate) falls back to the plain `!+family`
	// exclusion — same clause as today, safe over-exclusion.
	const formScopedExclusions = (ann) => {
		const map = new Map();
		for (const [key, ownedKeys] of Object.entries(ann || {})) {
			if (!Array.isArray(ownedKeys) || ownedKeys.length === 0) continue;
			const catalog = regionalFormsFor(key) || [];
			if (catalog.length === 0) continue;
			const owned = catalog.filter((f) => ownedKeys.includes(f.key));
			if (owned.length === 0 || owned.length >= catalog.length) continue;
			if (owned.some((f) => !formDropTerms(f))) continue;
			const out = speciesForOutput(key, outputLocale);
			if (out) map.set(out, owned);
		}
		return map;
	};
	const luckyScopedExclusions = formScopedExclusions(cfg.luckyForms);
	const hundoScopedExclusions = formScopedExclusions(cfg.hundoForms);
	// PoGo's `+` expands to the CANDY family, which is coarser than a collection
	// slot in two ways — so a flat `!+family` over-excludes:
	//
	//   babies      `+Magmar` includes Magby, but a lucky Magmar is NOT a lucky
	//               Magby: babies only hatch from eggs and can never be
	//               de-evolved. Widen the clause with the `eggsonly` keyword so
	//               the friend's baby survives it — `!+magmar,nurauseiern` reads
	//               ¬(Magmar family) ∨ eggsonly, since comma binds tighter
	//               than `&`. The reverse needs nothing: a lucky Magby evolves
	//               into a lucky Magmar, so the relation is directional.
	//   coin flips  `+Schaloko` includes the Panekon branch, which a lucky
	//               Schaloko says nothing about (SPLIT_FAMILIES). Enumerate the
	//               owned branch's members with bare selectors instead, and
	//               collapse back to `!+base` only once EVERY branch is covered
	//               — otherwise a finished line starts being offered again.
	//
	// Both are pure widenings of a clause that already exists, so a have-list
	// with neither a baby line nor a split line emits byte-identical output.
	//
	// The keyword is only embeddable in a comma group when it is a single
	// token. The hi locale ships `eggsonly` with a space in it, and a spaced
	// term has never been proven inside an OR group (it works standalone today
	// via cfg.protectBabies). Those locales take the enumeration path instead —
	// the same safe fallback Toxel uses.
	const babyKeyword = kw.flag.baby && !/\s/.test(kw.flag.baby) ? kw.flag.baby : null;
	const exclusionPlanFor = (dex, ownedDex) => {
		const fam = SPLIT_FAMILY_BY_DEX.get(dex);
		if (fam) {
			if (fam.branches.every((b) => b.some((d) => ownedDex.has(d))))
				return { kind: 'family', collapseTo: fam.baseDex };
			const branch = fam.branches.find((b) => b.includes(dex));
			// Only the coin-flip base is owned: one specimen fills ONE branch at
			// random, so nothing in the line is settled and nothing is excluded.
			return branch ? { kind: 'members', members: branch } : { kind: 'none' };
		}
		const baby = babyStageDex(dex);
		if (baby === null || ownedDex.has(baby)) return { kind: 'family' };
		if (!babyKeyword || EGGSONLY_UNVERIFIED_DEX.has(baby))
			return { kind: 'members', members: selfAndDescendants(dex) };
		return { kind: 'family', extra: `,${babyKeyword}` };
	};

	// Emit the owned-line exclusions for one whole have-list. Deduplicated by
	// clause text: a fully-covered split family collapses to a single `!+base`
	// that every member would otherwise repeat, and two owned members of one
	// branch enumerate that branch once.
	// Gender widening for the wishlists, the mirror of the baby one above: an
	// annotation that does not yet cover every slot for the species keeps the
	// still-wanted gender visible to the friend. Emits the negation of each
	// gender you OWN — `!+wadribie,!männlich` reads ¬(family) ∨ ¬male, so your
	// friend's ♀ Wadribie survives while their ♂ (a dead end) is hidden.
	// Unannotated, or every slot gender owned → '' → exactly today's clause.
	const genderExtraFor = (canonSpecies, genderAnn) => {
		const slots = genderSlotsFor(canonSpecies);
		if (!slots) return '';
		const owned = genderAnn?.[canonSpecies];
		if (!Array.isArray(owned) || owned.length === 0) return '';
		if (slots.every((g) => owned.includes(g))) return '';
		return owned
			.map(genderDropTerms)
			.filter(Boolean)
			.map((term) => `,${term}`)
			.join('');
	};

	// Output-locale-keyed plan, built exactly like formScopedExclusions so the
	// lookup key matches ownedSpeciesNames' entries.
	const genderScopedExclusions = (ann) => {
		const map = new Map();
		for (const key of Object.keys(ann || {})) {
			const extra = genderExtraFor(key, ann);
			if (!extra) continue;
			const out = speciesForOutput(key, outputLocale);
			if (out) map.set(out, extra);
		}
		return map;
	};

	// Un-searchable slots can't be expressed as a guard, so the only honest
	// move is to withhold the exclusion entirely: keep asking the friend for
	// Sesokitz until all four seasons are ticked. Unannotated behaves exactly
	// as before — one owned copy still excludes the family — so this only bites
	// once the user has opted in by clicking a slot badge.
	const invisibleSlotsIncomplete = (canonSpecies, slotAnn) => {
		const entry = invisibleSlotsFor(canonSpecies);
		if (!entry) return false;
		const owned = slotAnn?.[canonSpecies];
		if (!Array.isArray(owned) || owned.length === 0) return false;
		return !entry.slots.every((s) => owned.includes(s));
	};

	const pushOwnedExclusions = (clauses, names, scopedMap, genderAnn, slotAnn, whyKeys) => {
		const genderExtras = genderScopedExclusions(genderAnn);
		const ownedDex = ownedDexSet(names);
		const emitted = new Set();
		const once = (clause, why) => {
			if (emitted.has(clause)) return;
			emitted.add(clause);
			push(clauses, clause, why);
		};
		// Evolution-line ROOTS with an un-searchable slot still unfilled. Keyed by
		// root rather than by species name because `!+X` expands to the whole
		// candy family: owning a Kronjuwild would otherwise emit `!+kronjuwild`
		// and hide the Sesokitz whose seasons are still incomplete, defeating the
		// withholding entirely. One unfilled slot suppresses the exclusion for
		// every member of that family.
		const slotIncompleteRoots = new Set();
		for (const key of Object.keys(slotAnn || {})) {
			if (!invisibleSlotsIncomplete(key, slotAnn)) continue;
			const d = resolveSpeciesInfo(key)?.dex;
			if (d) slotIncompleteRoots.add(lineRootDex(d));
		}
		for (const { out: sp, dex } of ownedSpeciesNames(names)) {
			// Search can't separate these forms, so no guard can be written —
			// withhold the exclusion instead and keep the species on the ask.
			if (slotIncompleteRoots.has(lineRootDex(dex))) continue;
			const plan = exclusionPlanFor(dex, ownedDex);
			if (plan.kind === 'none') continue;
			if (plan.kind === 'members') {
				const whyKey = SPLIT_FAMILY_BY_DEX.has(dex) ? whyKeys.branch : whyKeys.baby;
				for (const d of plan.members) {
					const name = pokemonNameFor(String(d), outputLocale);
					if (!name) continue;
					once(`!${name.toLowerCase()}`, tFn(whyKey, { params: { species: capFirst(name) } }));
				}
				continue;
			}
			const target = plan.collapseTo
				? (pokemonNameFor(String(plan.collapseTo), outputLocale) || sp).toLowerCase()
				: sp;
			// Baby and gender widenings are independent comma terms on the same
			// clause. No species carries both today (no GENDER_SLOT_DEX line
			// bottoms out in a baby), but they compose if that ever changes.
			const babyExtra = plan.extra || '';
			const genderExtra = genderExtras.get(target) || '';
			const extra = `${babyExtra}${genderExtra}`;
			const whyPlain = babyExtra ? whyKeys.baby : genderExtra ? whyKeys.gender : whyKeys.plain;
			const scoped = scopedMap.get(target);
			if (!scoped) {
				once(`!+${target}${extra}`, tFn(whyPlain, { params: { species: capFirst(target) } }));
				continue;
			}
			// Gender and regional forms are disjoint catalogs, so the form
			// branch only ever carries the baby widening.
			for (const f of scoped)
				once(
					`!+${target},${formDropTerms(f)}${extra}`,
					tFn(babyExtra ? whyKeys.babyForm : whyKeys.form, {
						params: { species: capFirst(target), region: formRegionLabel(f, tFn) },
					}),
				);
		}
	};

	// Lucky wishlist — exclude every family the user already has a lucky in
	// (form-scoped where the lucky is annotated to specific regional forms).
	const friendLuckyClauses = [];
	pushOwnedExclusions(friendLuckyClauses, luckies, luckyScopedExclusions, cfg.luckyGenders, cfg.luckySlots, {
		plain: 'app.clause_why.friend_have_lucky',
		form: 'app.clause_why.friend_have_lucky_form',
		baby: 'app.clause_why.friend_have_lucky_baby',
		babyForm: 'app.clause_why.friend_have_lucky_baby_form',
		branch: 'app.clause_why.friend_have_lucky_branch',
		gender: 'app.clause_why.friend_have_lucky_gender',
	});
	pushFriendTradeGuards(friendLuckyClauses);
	const friendLuckyWishlist = friendLuckyClauses.map((c) => c.clause).join('&');

	// Guaranteed-lucky variant: AND an "old enough" year floor. luckyEligibleYear
	// is the first NON-eligible (still-trashable) 2-digit year, so the guaranteed
	// window is everything caught in the year BEFORE it (e.g. 21 → jahr-20).
	const oldLuckyYear = cfg.luckyEligibleYear > 1 ? cfg.luckyEligibleYear - 1 : 0;
	const friendLuckyGuaranteedClauses = friendLuckyClauses.slice();
	if (oldLuckyYear > 0)
		push(
			friendLuckyGuaranteedClauses,
			`${kw.numeric.year}-${oldLuckyYear}`,
			tFn('app.clause_why.friend_guaranteed_lucky', { params: { year: oldLuckyYear } }),
		);
	const friendLuckyWishlistGuaranteed = friendLuckyGuaranteedClauses.map((c) => c.clause).join('&');

	// Hundo wishlist — exclude every family the user already has a hundo in
	// (form-scoped where annotated, same as the lucky wishlist above).
	// No 4* clause: IVs re-roll on trade, so any untraded specimen is fair game.
	const friendHundoClauses = [];
	pushOwnedExclusions(friendHundoClauses, hundos, hundoScopedExclusions, cfg.hundoGenders, cfg.hundoSlots, {
		plain: 'app.clause_why.friend_have_hundo',
		form: 'app.clause_why.friend_have_hundo_form',
		baby: 'app.clause_why.friend_have_hundo_baby',
		babyForm: 'app.clause_why.friend_have_hundo_baby_form',
		branch: 'app.clause_why.friend_have_hundo_branch',
		gender: 'app.clause_why.friend_have_hundo_gender',
	});
	pushFriendTradeGuards(friendHundoClauses);
	const friendHundoWishlist = friendHundoClauses.map((c) => c.clause).join('&');

	// ── FRIEND COLLECT — curated "have friends collect for me" list ─────────
	// The blacklist wishlists above are the "everything I still lack" fallback.
	// This is the deliberate version: the user curates a target list (suggested
	// sets + manual input), picks a trading focus (lucky by default, or hundo),
	// and hands the friend ONE positive filter.
	//
	// Shape: `target,… & trade guards` — a singular string driven purely by
	// the selection, with each target a bare EXACT-species term (same
	// convention as buddy unions and what the verify-tab evaluator resolves).
	// No `+` family expansion: a curated Pichu asks for Pichu, not the whole
	// Pikachu line — friends should collect exactly what was picked, and egg
	// babies must never fan out into their evolved families. The
	// have-collection is NOT encoded as `!+owned` guards: that's the fallback
	// wishlists' job, it makes the string scale with the collection instead
	// of the selection (hundreds of luckies ≈ thousands of chars, toward
	// PoGo's ~5000 cap), and family-wide subtraction would silently override
	// an explicit pick — lucky/hundo dex entries are per-species, so a lucky
	// Raichu must NOT cancel a curated Pikachu. Exact-species ownership is
	// pruned app-side instead (the dimmed ✓ chip and the drop from the
	// positives below), so the string still shrinks as new luckies / hundos
	// land in the have-lists. cfg.friendCollectForced overrides that pruning
	// per species: a forced target stays in the string although the focus
	// counts it as owned (the lucky landed, the hundo hunt continues).
	// Focus: 'lucky' | 'hundo' | 'both'. 'both' means the user wants each
	// species as a lucky AND as a hundo — a target only counts as covered
	// (and drops from the string / prunes the packs) once BOTH goals are met.
	const friendCollectMode = ['hundo', 'both'].includes(cfg.friendCollectMode)
		? cfg.friendCollectMode
		: 'lucky';
	const friendCollectHundoSet = new Set((hundos || []).map(canonKey));
	// luckySet (canonKey'd luckies) already exists above for the lucky/hundo
	// intersection logic — reuse it here.
	//
	// Form-aware ownership: a target restricted to specific regional forms
	// (friendCollectDropForms) only counts as covered when the owned lucky's /
	// hundo's form annotation overlaps the forms the target still wants.
	// Unannotated ownership stays species-level (covers everything — exactly
	// today's behavior), so annotations opt IN to finer pruning and absence
	// changes nothing.
	//
	// Gender works the same way now that the have-lists carry it: a target
	// gender-locked to ♀ is NOT covered by a have-entry annotated ♂-only,
	// because that specimen can never become the thing the target is after (a
	// ♂ Wadribie never becomes Honweisel). An UNannotated have-entry still
	// counts as covered — same opt-in rule as forms — so this only ever
	// narrows coverage for users who clicked a badge. The two checks AND
	// together; neither can override the other.
	const friendCollectGenderMap = cfg.friendCollectGenders || {};
	const friendCollectDropMap = cfg.friendCollectDropForms || {};
	// Kept-form keys for a restricted target; null = unrestricted (species
	// without catalog forms, nothing dropped, or junk that dropped every form).
	const friendCollectKeptForms = (canonName) => {
		const catalog = regionalFormsFor(canonName) || [];
		if (catalog.length === 0) return null;
		const dropped = new Set(
			Array.isArray(friendCollectDropMap[canonName]) ? friendCollectDropMap[canonName] : [],
		);
		if (dropped.size === 0) return null;
		const kept = catalog.filter((f) => !dropped.has(f.key)).map((f) => f.key);
		return kept.length > 0 && kept.length < catalog.length ? kept : null;
	};
	const friendCollectGoalOwned = (canonName, ownedSpecies, formAnn, keptFormKeys, genderAnn, wantedGender) => {
		if (!ownedSpecies) return false;
		// Gender gate: an annotated owner missing the target's locked gender
		// cannot satisfy it. Unannotated stays covered (opt-in rule).
		if (wantedGender) {
			const ownedGenders = genderAnn?.[canonName];
			if (Array.isArray(ownedGenders) && ownedGenders.length > 0 && !ownedGenders.includes(wantedGender))
				return false;
		}
		if (!keptFormKeys) return true;
		const owned = formAnn?.[canonName];
		if (!Array.isArray(owned) || owned.length === 0) return true;
		return owned.some((k) => keptFormKeys.includes(k));
	};
	const friendCollectWantedGender = (canonName) => {
		const g = friendCollectGenderMap[canonName];
		return g === 'male' || g === 'female' ? g : null;
	};
	const friendCollectCovered = (canonName, keptFormKeys = null) => {
		const wanted = friendCollectWantedGender(canonName);
		const l = friendCollectGoalOwned(
			canonName,
			luckySet.has(canonName),
			cfg.luckyForms,
			keptFormKeys,
			cfg.luckyGenders,
			wanted,
		);
		const h = friendCollectGoalOwned(
			canonName,
			friendCollectHundoSet.has(canonName),
			cfg.hundoForms,
			keptFormKeys,
			cfg.hundoGenders,
			wanted,
		);
		if (friendCollectMode === 'lucky') return l;
		if (friendCollectMode === 'hundo') return h;
		return l && h;
	};
	// Coverage overrides: a curated species the user explicitly re-activated
	// even though the focus counts it as owned — the lucky Furfrou is in, but
	// the hundo hunt on it continues. Overrides keep the target in the string;
	// pack pruning is untouched (a forced species is curated, so packs skip it
	// via the curated set anyway).
	const friendCollectForcedSet = new Set((cfg.friendCollectForced || []).map(canonKey));
	const friendCollectTargets = (cfg.friendCollectSpecies || []).map((sp) => {
		const key = canonKey(sp);
		const kept = friendCollectKeptForms(key);
		const gender = friendCollectWantedGender(key);
		return {
			species: sp,
			display: speciesForOutput(sp, outputLocale),
			ownedLucky: friendCollectGoalOwned(key, luckySet.has(key), cfg.luckyForms, kept, cfg.luckyGenders, gender),
			ownedHundo: friendCollectGoalOwned(
				key,
				friendCollectHundoSet.has(key),
				cfg.hundoForms,
				kept,
				cfg.hundoGenders,
				gender,
			),
			owned: friendCollectCovered(key, kept),
			forced: friendCollectForcedSet.has(key),
			gender: gender === 'male' || gender === 'female' ? gender : null,
			keptForms: kept,
		};
	});
	const friendCollectClauses = [];
	const friendCollectActive = friendCollectTargets.filter((tg) => !tg.owned || tg.forced);
	if (friendCollectActive.length > 0) {
		push(
			friendCollectClauses,
			friendCollectActive.map((tg) => tg.display).join(','),
			tFn('app.clause_why.friend_collect_targets'),
		);
		// Per-target refinement guards — the same scoped implication the buddy
		// filters use: `!<species>,<terms>` constrains only that species inside
		// the OR-union. One clause per dropped form, one per gender pick.
		for (const tg of friendCollectActive) {
			const key = canonKey(tg.species);
			if (tg.keptForms) {
				const catalog = regionalFormsFor(key) || [];
				const keptSet = new Set(tg.keptForms);
				for (const f of catalog.filter((x) => !keptSet.has(x.key))) {
					const terms = formDropTerms(f);
					if (!terms) continue;
					push(
						friendCollectClauses,
						`!${tg.display},${terms}`,
						tFn('app.clause_why.friend_collect_drop_form', {
							params: { species: capFirst(tg.display), region: formRegionLabel(f, tFn) },
						}),
					);
				}
			}
			if (tg.gender)
				push(
					friendCollectClauses,
					`!${tg.display},${kw.flag[tg.gender]}`,
					tFn(`app.clause_why.friend_collect_gender_${tg.gender}`, {
						params: { species: capFirst(tg.display) },
					}),
				);
		}
		pushFriendTradeGuards(friendCollectClauses);
	}
	const friendCollectWishlist = friendCollectClauses.map((c) => c.clause).join('&');
	// Guaranteed-lucky variant — lucky mode only (a hundo hunt gains nothing
	// from the age floor; IVs re-roll on every trade regardless of catch year).
	let friendCollectWishlistGuaranteed = friendCollectWishlist;
	if (friendCollectMode === 'lucky' && friendCollectWishlist && oldLuckyYear > 0) {
		const guaranteed = friendCollectClauses.slice();
		push(
			guaranteed,
			`${kw.numeric.year}-${oldLuckyYear}`,
			tFn('app.clause_why.friend_guaranteed_lucky', { params: { year: oldLuckyYear } }),
		);
		friendCollectWishlistGuaranteed = guaranteed.map((c) => c.clause).join('&');
	}

	// Suggested sets for the curated list. Candidates resolve to the storage
	// locale, then — unless the pack opts out via keepStages — collapse to
	// their COLLECTIBLE BASE (collectibleBaseDex: base of the line, or the
	// stage above a baby). Friends collect toward luckies/hundos, and only the
	// base can grow into the whole line — a meta-pack Greedent must arrive as
	// Skwovet, and then prune against an already-lucky Skwovet instead of
	// sneaking in beside it. Egg pools keep their stages: eggs hatch exactly
	// what they hatch, and a "hatch it for me" ask for Pichu can't be
	// fulfilled with a Pikachu filter. After the remap, drop what's already
	// curated or already owned in the current mode, so the "add" counts stay
	// honest. Untradeable mythicals AND special-trade-only species
	// (legendaries / Ultra Beasts) are skipped — these packs are strictly
	// regular-trade material. `display` mirrors `species` in the output
	// locale for the pack-preview chips in the editor.
	const friendCollectCuratedSet = new Set((cfg.friendCollectSpecies || []).map(canonKey));
	const friendCollectSuggestions = [];
	// timeLimited (event/egg packs): covered and curated species stay in the
	// pack, flagged via parallel `owned` / `curated` arrays, instead of pruning
	// it — a roster that owns or already hunts every spawn would otherwise
	// silently swallow an event pack, indistinguishable from "no event". Owned
	// entries queue behind the addable ones and curated ones last, so a cap
	// never costs an addable species its slot; curated entries are purely
	// informational (an Add never touches them — re-adding is a no-op union).
	// Evergreen/meta packs keep prune-to-vanish: consumed means done.
	const pushFriendCollectSuggestion = (kind, id, title, meta, inputs, { cap = Infinity, keepStages = false, timeLimited = false } = {}) => {
		const seen = new Set();
		const picked = [];
		const ownedQueue = [];
		const curatedQueue = [];
		for (const input of inputs || []) {
			const info = resolveSpeciesInfo(input);
			if (!info) continue;
			const dex = keepStages ? info.dex : collectibleBaseDex(info.dex);
			if (UNTRADEABLE_MYTHICAL_DEX.has(dex)) continue;
			if (SPECIAL_TRADE_DEX.has(dex)) continue;
			const stored = pokemonNameFor(String(dex));
			if (!stored || seen.has(stored)) continue;
			seen.add(stored);
			const curated = friendCollectCuratedSet.has(stored);
			const covered = !curated && friendCollectCovered(stored);
			if ((curated || covered) && !timeLimited) continue;
			const entry = { stored, disp: pokemonNameFor(String(dex), outputLocale) || stored, covered, curated };
			if (curated) curatedQueue.push(entry);
			else if (covered) ownedQueue.push(entry);
			else {
				picked.push(entry);
				if (picked.length >= cap) break;
			}
		}
		for (const entry of [...ownedQueue, ...curatedQueue]) {
			if (picked.length >= cap) break;
			picked.push(entry);
		}
		if (picked.length === 0) return;
		const suggestion = {
			kind,
			id,
			title,
			...meta,
			species: picked.map((e) => e.stored),
			display: picked.map((e) => e.disp),
		};
		if (timeLimited) {
			suggestion.owned = picked.map((e) => e.covered);
			suggestion.curated = picked.map((e) => e.curated);
		}
		friendCollectSuggestions.push(suggestion);
	};
	// Event spawns — running or upcoming events only; one suggestion per event
	// so the set can be refreshed for the latest event as feeds update.
	const friendCollectNowMs = Date.now();
	for (const ev of EVENTS.events || []) {
		const endMs = Date.parse(ev.end);
		if (Number.isFinite(endMs) && endMs < friendCollectNowMs) continue;
		pushFriendCollectSuggestion(
			'event',
			ev.id,
			ev.title,
			{ start: ev.start, end: ev.end },
			(ev.spawnDex || []).map(String),
			{ timeLimited: true },
		);
	}
	// Egg pools — Season pools run for months, event pools for days; hatched
	// Pokémon trade fine, so "hatch it for me" is a legit friend-collect ask.
	// Deliberately NOT part of the rare-set gate below: a Season pool is
	// near-always live and would otherwise permanently suppress the rare set,
	// which exists to cover WILD-spawn lulls.
	// keepStages: eggs hatch exactly what they hatch — babies included — so
	// the collectible-base remap must not touch these pools.
	for (const pool of EVENTS.eggPools || []) {
		const endMs = Date.parse(pool.end);
		if (Number.isFinite(endMs) && endMs < friendCollectNowMs) continue;
		pushFriendCollectSuggestion(
			'eggs',
			pool.id,
			pool.title,
			{ start: pool.start, end: pool.end },
			(pool.eggDex || []).map(String),
			{ cap: 25, keepStages: true, timeLimited: true },
		);
	}
	// Evergreen packs — always on offer (no event gate: they shrink as they're
	// consumed and re-fill as the feeds drift). All pools are data-derived:
	// trade-evo lines are the fixed game mechanic, everything else comes from
	// the synced snapshots.
	//
	// Trade evolutions: the family bases — the trade discount sticks to the
	// traded mon through every later evolution, so a traded base finishes
	// Machamp/Gengar/Alakazam & co. with the 0-candy final step intact. (Mids
	// like Machoke would collapse to the base in the remap anyway.)
	pushFriendCollectSuggestion(
		'tradeevo',
		'trade-evos',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_tradeevo' },
		Object.values(TRADE_EVO_FAMILIES).map((f) => String(f.baseDex)),
	);
	// Candy-heavy lines (evolution-costs feed): 400-single-jump and
	// high-cumulative chains — every traded copy is transfer+trade candy
	// toward an expensive evolution.
	pushFriendCollectSuggestion(
		'candy',
		'candy-heavy',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_candy' },
		EVOLUTION_COSTS.candyHeavy || [],
		{ cap: 25 },
	);
	// Power lines (species-meta feed): pseudo-legendary-style strong 3-stage
	// lines — rare spawns whose finals carry raids and Master League.
	pushFriendCollectSuggestion(
		'powerlines',
		'power-lines',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_powerlines' },
		(SPECIES_META.powerLineDex || []).map(String),
		{ cap: 25 },
	);
	// Starter bases (species-meta feed): Community-Day royalty — their
	// exclusive-move finals are prime regular trades.
	pushFriendCollectSuggestion(
		'starters',
		'starters',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_starters' },
		(SPECIES_META.starterDex || []).map(String),
	);
	// Mega-capable species (species-meta feed, derived from the game master's
	// own temporary-evolution data): everything that can Mega Evolve. Mega
	// Energy is per-species and a Mega is only worth building on a good copy,
	// so spare copies from friends are exactly the supply this needs. The pool
	// updates itself — a Mega released upstream joins this pack on the next
	// species-meta sync, no code change. Uncapped: "all the ones that can
	// mega" is the whole point, and the preview toggles handle the rest.
	// The collectible-base remap runs as everywhere else, so the pack asks for
	// the Charmander that becomes a Mega Charizard, not the Charizard itself.
	pushFriendCollectSuggestion(
		'mega',
		'mega-evos',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_mega' },
		(SPECIES_META.megaDex || []).map(String),
	);
	// Valuable keepers — the user's raid-meta roster (score-sorted, so the cap
	// keeps the strongest) and the current PvP league metas, split per league
	// because the lucky-trade IV floor cuts opposite ways in each (see hints).
	pushFriendCollectSuggestion(
		'raids',
		'meta-raids',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_raids' },
		cfg.topAttackers || [],
		{ cap: 25 },
	);
	pushFriendCollectSuggestion(
		'pvp-great',
		'meta-pvp-great',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_gl', warn: true },
		(PVP_RANKINGS.leagues?.great?.species || []).map((s) => String(s.dex)),
		{ cap: 25 },
	);
	pushFriendCollectSuggestion(
		'pvp-ultra',
		'meta-pvp-ultra',
		null,
		{ hintKey: 'app.filter.friend_collect_hint_ul' },
		(PVP_RANKINGS.leagues?.ultra?.species || []).map((s) => String(s.dex)),
		{ cap: 25 },
	);

	// ── AUX FILTERS — task-oriented pro tools, paste these into the search
	//    box to *find* candidates (positive search filters, not the inverted
	//    trash style). Grouped by game aspect: shadows / evos / trades.

	// -- SHADOW · cheap purify --------------------------------------------
	// Common-rarity shadows for level-up-task fodder. Cost on purify scales
	// with species rarity, not IV — so we filter by 1km-buddy-walk (the
	// common pool: Pidgey, Magikarp, Eevee line, ...). 1km walks naturally
	// exclude legendaries / mythicals / pseudo-legendaries (5km+).
	//
	// Investment gate: `@frustration` (positive) — only match shadows that
	// STILL have the default Frustration charged move. A shadow whose
	// Frustration was Charge-TM'd off (during a Rocket take-over) is a real
	// TM investment; purifying it loses the move and the +20% atk boost.
	// `!@special` would NOT catch this case: a TM'd shadow with no other
	// legacy (e.g. Tyranitar with Crunch+Stone Edge) has no @special flag
	// and would slip through. `@frustration` is the surgical positive gate.
	const shadowCheapClauses = [];
	push(shadowCheapClauses, kw.flag.shadow, tFn('app.clause_why.shadow_cheap_pool'));
	push(shadowCheapClauses, `${kw.numeric.candy_km}1`, tFn('app.clause_why.shadow_cheap_common'));
	push(shadowCheapClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
	push(
		shadowCheapClauses,
		`@${kw.flag.frustration}`,
		tFn('app.clause_why.frustration_unmoved', { params: { move: kw.flag.frustration } }),
	);
	push(shadowCheapClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites'));
	push(shadowCheapClauses, '!#', tFn('app.clause_why.tags_protected_short'));
	if (cfg.protectNundos) {
		push(
			shadowCheapClauses,
			`1-4${kw.iv.atk},1-4${kw.iv.def},1-4${kw.iv.hp}`,
			tFn('app.clause_why.protect_nundos_shadow'),
		);
	}
	const shadowCheap = shadowCheapClauses.map((c) => c.clause).join('&');

	// -- SHADOW · safe purify (mass purify, keep raid attackers) ---------
	// Excludes legendaries / mythicals / UBs / 4★ / shinies / costumes,
	// plus a user-curated list of top raid-attacker species
	// (`shadowKeeperSpecies`) family-wide via `+`.
	//
	// Investment gate: `@frustration` (same reasoning as shadowCheap above)
	// — only purify shadows still in default state. A Charge-TM'd shadow
	// is an investment; purifying it loses the TM and the +20% boost.
	const keeperResolved = (cfg.shadowKeeperSpecies || [])
		.map((s) => speciesForOutput(s, outputLocale))
		.filter(Boolean);
	const shadowSafeClauses = [];
	push(shadowSafeClauses, kw.flag.shadow, tFn('app.clause_why.shadow_safe_pool'));
	push(shadowSafeClauses, `!${kw.flag.legendary}`, tFn('app.clause_why.legendaries'));
	push(shadowSafeClauses, `!${kw.flag.mythical}`, tFn('app.clause_why.mythicals_short'));
	push(shadowSafeClauses, `!${kw.flag.ultra_beast}`, tFn('app.clause_why.ultra_beasts'));
	push(shadowSafeClauses, '!4*', tFn('app.clause_why.never_4star'));
	push(shadowSafeClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
	push(shadowSafeClauses, `!${kw.flag.costume}`, tFn('app.clause_why.costumes'));
	push(
		shadowSafeClauses,
		`@${kw.flag.frustration}`,
		tFn('app.clause_why.frustration_unmoved', { params: { move: kw.flag.frustration } }),
	);
	push(shadowSafeClauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites'));
	push(shadowSafeClauses, '!#', tFn('app.clause_why.tags_protected_short'));
	for (const sp of keeperResolved) {
		push(shadowSafeClauses, `!+${sp}`, tFn('app.clause_why.shadow_keeper_species', { params: { species: sp } }));
	}
	if (cfg.protectNundos) {
		push(
			shadowSafeClauses,
			`1-4${kw.iv.atk},1-4${kw.iv.def},1-4${kw.iv.hp}`,
			tFn('app.clause_why.protect_nundos_shadow'),
		);
	}
	const shadowSafe = shadowSafeClauses.map((c) => c.clause).join('&');

	// -- SHADOW · TM Frustration (take-over event) ------------------------
	// During take-over events, Charge TM removes Frustration. Surface the
	// shadows worth saving the TMs for: keeper-species attackers + anything
	// the user manually tagged for removal.
	const removeTag = (cfg.removeFrustrationTagName || '').trim();
	const keeperFamilyTerms = keeperResolved.map((sp) => `+${sp}`);
	const tagTerm = removeTag ? `#${removeTag}` : null;
	const includePool = [...keeperFamilyTerms, tagTerm].filter(Boolean).join(',');
	const shadowFrustrationClauses = [];
	if (includePool && kw.flag.frustration) {
		push(shadowFrustrationClauses, kw.flag.shadow, tFn('app.clause_why.shadow_only'));
		push(
			shadowFrustrationClauses,
			`@${kw.flag.frustration}`,
			tFn('app.clause_why.frustration_move', { params: { move: kw.flag.frustration } }),
		);
		push(
			shadowFrustrationClauses,
			includePool,
			removeTag
				? tFn('app.clause_why.frustration_pool_with_tag', { params: { tag: removeTag } })
				: tFn('app.clause_why.frustration_pool_keepers_only'),
		);
	}
	const shadowFrustration = shadowFrustrationClauses.map((c) => c.clause).join('&');

	// -- SHADOW · purify-to-hundo candidates ------------------------------
	// PoGo's appraisal search is bucket-based: bucket 3 = IV 11-14, bucket
	// 4 = IV 15. `3-4{atk}&3-4{def}&3-4{hp}` matches IV ≥11 in every stat.
	// Purify adds +2 (capped at 15), so IV 13/14/15 → 15 (hundo) but IV
	// 11/12 → 13/14 (NOT hundo). This is therefore a *candidate* set —
	// review each match before purifying, since PoGo's bucket syntax can't
	// isolate IV ≥13. Excludes already-4★ shadows.
	//
	// Investment gate: `@frustration` — a high-IV shadow whose Frustration
	// was Charge-TM'd off is doubly valuable (TM investment + Shadow boost).
	// Purifying it would lose both. Only surface default-state shadows.
	const shadowHundoClauses = [];
	push(shadowHundoClauses, kw.flag.shadow, tFn('app.clause_why.shadow_only'));
	push(
		shadowHundoClauses,
		`@${kw.flag.frustration}`,
		tFn('app.clause_why.frustration_unmoved', { params: { move: kw.flag.frustration } }),
	);
	push(shadowHundoClauses, `3-4${kw.iv.atk}`, tFn('app.clause_why.iv_bucket_high_atk'));
	push(shadowHundoClauses, `3-4${kw.iv.def}`, tFn('app.clause_why.iv_bucket_high_def'));
	push(shadowHundoClauses, `3-4${kw.iv.hp}`, tFn('app.clause_why.iv_bucket_high_hp'));
	push(shadowHundoClauses, '!4*', tFn('app.clause_why.exclude_already_4star'));
	const shadowHundoCandidates = shadowHundoClauses.map((c) => c.clause).join('&');

	// -- EVOSWAP · candy-heavy / item-gated trade-buddy candidates ---------
	// Surfaces shadows of species worth coordinating with a trade buddy:
	// each player evolves+purifies *one* expensive species, then special-
	// trades the result. Candy-heavy = chains with a 400-jump or cumulative
	// ≥150 candy (Magikarp, Wailmer, Swablu, Larvesta, Noibat, Stufful,
	// Wimpod, Meltan, Toxel, Sinistea, Snom, Poltchageist, Roggenrola,
	// Timburr, Karrablast, Shelmet, Phantump, Pumpkaboo, Type:Null, Poipole,
	// Kubfu, Mankey, Teddiursa, Pawniard, Applin). Item-gated = chains
	// requiring Sinnoh/Unova/Sun Stone, King's Rock, Metal Coat, Dragon
	// Scale, Up-Grade, an Apple variant, or any of the four lure modules.
	// Whole-family inclusion via +species so an already-evolved trash Crypto
	// Garados surfaces too (offer to buddy as their purified-dex pickup).
	// !traded covers !lucky (lucky requires trade by definition).
	const evoSwapBaseClauses = (familyList, poolWhyKey) => {
		const clauses = [];
		// Shadow OR purified — both states are valid swap material. A user who
		// already evolved+purified a candidate themselves still wants to find
		// the resulting (now-purified) mon to ship to their buddy.
		push(clauses, `${kw.flag.shadow},${kw.flag.purified}`, tFn('app.clause_why.shadow_or_purified'));
		if (familyList.length > 0) {
			push(clauses, familyList.map((sp) => `+${sp}`).join(','), tFn(poolWhyKey));
		}
		push(clauses, `!${kw.flag.traded}`, tFn('app.clause_why.evo_swap_not_traded'));
		push(clauses, '!4*', tFn('app.clause_why.never_4star'));
		push(clauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
		push(clauses, `!${kw.flag.favorite}`, tFn('app.clause_why.favorites'));
		push(clauses, '!#', tFn('app.clause_why.tags_protected_short'));
		return clauses;
	};
	const evoSwapCandyClauses =
		evoCandyList.length > 0 ? evoSwapBaseClauses(evoCandyList, 'app.clause_why.evo_swap_candy_pool') : [];
	const evoSwapCandy = evoSwapCandyClauses.map((c) => c.clause).join('&');
	const evoSwapItemClauses =
		evoItemList.length > 0 ? evoSwapBaseClauses(evoItemList, 'app.clause_why.evo_swap_item_pool') : [];
	const evoSwapItem = evoSwapItemClauses.map((c) => c.clause).join('&');

	// -- EVOS · cheap full-evolve -----------------------------------------
	// Two paths combined via distribution to CNF (see Algebra chapter §8):
	//   cheap = (early ∪ TE_basics) ∩ (early ∪ traded) ∩ (modifiers)
	// `early` = low-candy XP lines; `TE_basics` = pre-final members of every
	// trade-evo family (drop the final form — Alakazam/Machamp/etc. — since
	// it doesn't evolve further). Resolved to locale-specific species names
	// so the filter reads naturally in the user's PoGo client.
	const dexToName = (d) => pokemonNameFor(String(d), outputLocale)?.toLowerCase();
	const earlyDexes = [10, 13, 16, 265, 293, 519];
	const teBasicsDexes = Object.values(TRADE_EVO_FAMILIES).flatMap((f) => f.memberDex.slice(0, -1));
	const earlyList = earlyDexes.map(dexToName).filter(Boolean).join(',');
	const teBasicsList = [...earlyDexes, ...teBasicsDexes].map(dexToName).filter(Boolean).join(',');
	const cheapEvolveClauses = [];
	push(cheapEvolveClauses, teBasicsList, tFn('app.clause_why.cheap_evolve_either'));
	push(cheapEvolveClauses, `${earlyList},${kw.flag.traded}`, tFn('app.clause_why.cheap_evolve_traded_path'));
	push(cheapEvolveClauses, '0*,1*,2*', tFn('app.clause_why.cheap_evolve_low_iv'));
	push(cheapEvolveClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
	push(cheapEvolveClauses, `!${kw.flag.costume}`, tFn('app.clause_why.costumes_trade'));
	push(
		cheapEvolveClauses,
		`!@${kw.flag.special_move},@${kw.flag.return},@${kw.flag.frustration}`,
		tFn('app.clause_why.legacy_moves'),
	);
	if (cfg.protectLuckyEligible && cfg.luckyEligibleYear && cfg.luckyEligibleYear > 0)
		push(
			cheapEvolveClauses,
			`${kw.numeric.year}${cfg.luckyEligibleYear}-,${kw.flag.traded}`,
			tFn('app.clause_why.lucky_eligible', { params: { year: cfg.luckyEligibleYear } }),
		);
	push(cheapEvolveClauses, '!#', tFn('app.clause_why.tags_protected_short'));
	const cheapEvolve = cheapEvolveClauses.map((c) => c.clause).join('&');

	// -- EVOS · Pokédex++ — pure new-dex pushes ---------------------------
	// Anything that can evolve into a new dex entry and is candy-evolvable
	// right now. Excludes evolve-quest species (those need quest completion,
	// not just candy — surfacing them is misleading for a "ready to evolve"
	// pile).
	const dexPlusClauses = [];
	push(dexPlusClauses, kw.flag.evolvable, tFn('app.clause_why.dex_plus_evolvable'));
	push(dexPlusClauses, kw.flag.new_evo, tFn('app.clause_why.dex_plus_new_evo'));
	push(dexPlusClauses, `!${kw.flag.evolve_quest}`, tFn('app.clause_why.dex_plus_skip_quest'));
	const dexPlus = dexPlusClauses.map((c) => c.clause).join('&');

	// -- MEGAS · mega-evolve candidates -----------------------------------
	// User's pattern: mega-eligible Pokémon that have either prior mega
	// history (mega1-2, cheaper subsequent mega cost) OR are new evolutions
	// (filling the medal/dex). Skips already-mega3 entries (already maxed).
	const megaEvolveClauses = [];
	push(megaEvolveClauses, kw.flag.mega_evolve, tFn('app.clause_why.mega_eligible'));
	push(megaEvolveClauses, `${kw.flag.mega}1-2,${kw.flag.new_evo}`, tFn('app.clause_why.mega_progress_or_new'));
	const megaEvolve = megaEvolveClauses.map((c) => c.clause).join('&');

	// -- TRADES · Pilot 1000+ stash --------------------------------------
	// Extreme-distance catches not yet traded. The regular trade filter
	// covers ≥100km; this one is the ≥1000km deep stash.
	const pilotLongClauses = [];
	push(pilotLongClauses, `${kw.numeric.distance}1000-`, tFn('app.clause_why.pilot_1000'));
	push(pilotLongClauses, `!${kw.flag.traded}`, tFn('app.clause_why.not_yet_traded'));
	push(pilotLongClauses, '!4*', tFn('app.clause_why.never_4star'));
	push(pilotLongClauses, `!${kw.flag.legendary}`, tFn('app.clause_why.legendaries'));
	push(pilotLongClauses, `!${kw.flag.mythical}`, tFn('app.clause_why.mythicals_short'));
	push(pilotLongClauses, `!${kw.flag.shiny}`, tFn('app.clause_why.shinies_protected'));
	const pilotLong = pilotLongClauses.map((c) => c.clause).join('&');

	// -- RAIDS / MAX BATTLES · per-boss counter filters ------------------
	// Each boss yields one filter: defenders that resist the boss's STAB
	// ANDed with attackers that carry a super-effective move type. The
	// `@<type>` syntax matches Pokémon with a move of that type — distinct
	// from `@<move-name>`. No IV gate — raid DPS is dominated by level +
	// moveset, so an IV cut would hide already-built workhorses.
	// Per-slot SE-move clauses. PoGo's `@1`/`@2`/`@3` prefixes target the
	// fast / first-charge / second-charge move slots respectively. `,` binds
	// tighter than `&` so we can drop the parens — the join order is what
	// matters. Result e.g. `@1ground,@1poison & @2ground,@2poison,@3ground,@3poison`
	// = "fast move is one of [ground/poison] AND at least one charge move
	// (slot 2 or 3) is one of [ground/poison]".
	const fastMoveClause = (typeKws) => typeKws.map((t) => `@1${t}`).join(',');
	const chargeMoveClause = (typeKws) => [...typeKws.map((t) => `@2${t}`), ...typeKws.map((t) => `@3${t}`)].join(',');
	// `,` binds tighter than `&`, so prepending the personal-attacker list to
	// a clause makes it an OR-allowlist alongside the existing terms.
	const prependList = (list, clause) => (list.length > 0 ? `${list.join(',')},${clause}` : clause);
	const withAllowlist = (c) => prependList(topAttackersList, c);
	const withMaxAllowlist = (c) => prependList(topMaxAttackersList, c);

	// `!<TYPE` matches "not weak to TYPE attacks" — De Morgan'd into one
	// `&`-joined clause per boss-STAB type so an attacker can't sneak through
	// the allowlist with a chassis that takes SE from what the boss throws.
	// Returns "" when bossTypes is empty so callers can skip the push().
	const weaknessGuard = (bossTypes) =>
		(bossTypes || [])
			.map((t) => kw.type[t])
			.filter(Boolean)
			.map((t) => `!<${t}`)
			.join('&');
	const unionTypesOf = (pokemons) => {
		const set = new Set();
		for (const p of pokemons || []) for (const t of p.types || []) set.add(t);
		return [...set];
	};

	// Lenient fallback pool for the Rocket counter boxes. The strict builders
	// AND a super-effective FAST move with a super-effective CHARGE move; for a
	// single-seMoveType trainer that collapses to the ~6 species carrying that
	// type on both slots. This relaxes it to "an SE move in ANY slot OR a
	// high-CP bulky pick", still gated by the SAME lineup weakness guard so
	// nothing surfaced loses the matchup. Rendered as a second FilterBox when
	// cfg.rocketLenientCounters is on. `,` binds tighter than `&`, so the move
	// tokens + CP floor form one OR group, then each `!<type` is ANDed.
	const ROCKET_LENIENT_CP_FLOOR = 3500; // user-chosen "WP over 3500" escape hatch
	const buildLenientCounters = (seMoveList, lineupTypes) => {
		const clauses = [];
		const pool = [
			fastMoveClause(seMoveList),
			chargeMoveClause(seMoveList),
			`${kw.numeric.cp}${ROCKET_LENIENT_CP_FLOOR}-`,
		].join(',');
		push(clauses, pool, tFn('app.clause_why.rocket_lenient_pool'));
		const wGuard = weaknessGuard(lineupTypes);
		if (wGuard) push(clauses, wGuard, tFn('app.clause_why.rocket_not_weak_to_lineup'));
		return { clause: clauses.map((c) => c.clause).join('&'), clauses };
	};

	const buildBossEntry = (boss, { requiresDynamax = false } = {}) => {
		const resistorList = (boss.resistorTypes || []).map((t) => kw.type[t]).filter(Boolean);
		const seMoveList = (boss.seMoveTypes || []).map((t) => kw.type[t]).filter(Boolean);
		if (resistorList.length === 0 || seMoveList.length === 0) {
			return {
				id: boss.id,
				name: boss.names?.[outputLocale] || boss.names?.en || boss.id,
				clause: '',
				clauses: [],
				skipped: true,
			};
		}
		// Per-context allowlist — different rosters for raids vs Max Battles.
		// Rocket builders use `withAllowlist` directly on their resistor clause
		// (same soft-bypass shape as raids).
		const wrap = requiresDynamax ? withMaxAllowlist : withAllowlist;
		const clauses = [];
		// Resistor-type allowlist is *soft* (top attackers bypass) so picks like
		// Machamp/Lucario surface even though Fighting/Steel aren't resistant
		// typings vs e.g. Steel bosses. The SE-move clauses are *hard* (no wrap)
		// — without them, top attackers like Mewtwo (psychic) get OR-allowed
		// into a Steel-boss filter where their STAB is fully resisted.
		push(clauses, wrap(resistorList.join(',')), tFn('app.clause_why.raid_resistor_types'));
		push(clauses, fastMoveClause(seMoveList), tFn('app.clause_why.raid_se_fast'));
		push(clauses, chargeMoveClause(seMoveList), tFn('app.clause_why.raid_se_charge'));
		// Max battles only let you bring Dynamax-capable Pokémon, so narrow to
		// species that have at least one Max move unlocked. PoGo's keyword is
		// `<dynamax-move>1-` — locale-aware via kw.flag.dynamax_move.
		if (requiresDynamax && kw.flag.dynamax_move) {
			push(clauses, `${kw.flag.dynamax_move}1-`, tFn('app.clause_why.max_battle_dynamax_only'));
		}
		if (cfg.raidRequireSecondMove) {
			push(clauses, `!@${kw.flag.three_move}`, tFn('app.clause_why.raid_second_move'));
		}
		// Boss-STAB weakness guardrail — applies to allowlisted top attackers
		// too (a Mewtwo shouldn't be raid-recommended into a fairy boss).
		const wGuard = weaknessGuard(boss.types);
		if (wGuard) push(clauses, wGuard, tFn('app.clause_why.raid_not_weak_to_boss'));
		return {
			id: boss.id,
			name: boss.names?.[outputLocale] || boss.names?.en || boss.id,
			clause: clauses.map((c) => c.clause).join('&'),
			clauses,
			skipped: false,
		};
	};
	const buildBossTiers = (tieredBosses, opts) => {
		const out = {};
		for (const [tier, list] of Object.entries(tieredBosses || {})) {
			out[tier] = list.map((b) => buildBossEntry(b, opts));
		}
		return out;
	};
	const raidFilters = buildBossTiers(RAID_BOSSES.raids);
	const maxBattleFilters = buildBossTiers(RAID_BOSSES.maxBattles, { requiresDynamax: true });
	const raidBossesFetchedAt = RAID_BOSSES.fetchedAt || null;

	// Event raids — short-window bosses (Raid Day / Raid Hour / etc.) sourced
	// from ScrapedDuck's events feed. Each entry carries its own start/end
	// window plus a parallel boss list with the same shape as the standing
	// tiers, so the UI can reuse FilterBox for each derived counter.
	const eventRaidFilters = (RAID_BOSSES.eventRaids || []).map((event) => ({
		eventID: event.eventID,
		name: event.name,
		eventType: event.eventType,
		start: event.start,
		end: event.end,
		isShadow: !!event.isShadow,
		isMega: !!event.isMega,
		bosses: (event.bosses || []).map((b) => buildBossEntry(b)),
	}));

	// -- EVENT WILD SPAWNS · per-event curation workflow -----------------
	// Each event's spawn species render as family-expanded German names
	// (+taubsi,+habitak,…) and become a comma-OR clause that intersects the
	// user's collection. We hang a small set of lenses off that intersection:
	// an overview, souvenirs, one exact IV-keeper filter, what's still unsorted,
	// and the trashable rest. Reuses the existing IV/flag tokens and the already-
	// built `trash` string so event filters stay consistent with the main output.
	const eventCollectibles = (cfg.customCollectibles || [])
		.map((s) => speciesForOutput(s, outputLocale))
		.filter(Boolean);
	const eventsFetchedAt = EVENTS.fetchedAt || null;
	const eventFilters = (EVENTS.events || [])
		.map((ev) => {
			// "+name" expands to the whole evolution family; names localised from dex.
			const fams = (ev.spawnDex || [])
				.map((d) => pokemonNameFor(String(d), outputLocale))
				.filter(Boolean)
				.map((n) => `+${n}`)
				.join(',');
			if (!fams) return null;
			// Souvenirs — single-token collectible flags (shiny / costume / background)
			// plus the user's custom collectibles. Hundos now live in the IV filter.
			const souvenirTokens = [kw.flag.shiny, kw.flag.costume, kw.flag.background, ...eventCollectibles].filter(
				Boolean,
			);
			// One exact IV-keeper filter = hundos ∪ "two 15s + one 11-14" keepers.
			// "≥2 of three stats are 15" is the CNF threshold (a∨b)∧(a∨c)∧(b∨c); the
			// three 3-4 clauses force every bar ≥11. Together that is exactly hundo ∪
			// keeper. Nundo (opposite extreme) and PvP (wants low attack) can't share
			// this flat clause, so by design they get no event box.
			const a = `4${kw.iv.atk}`,
				d = `4${kw.iv.def}`,
				h = `4${kw.iv.hp}`;
			const keepIv = `${fams}&${a},${d}&${a},${h}&${d},${h}` + `&3-4${kw.iv.atk}&3-4${kw.iv.def}&3-4${kw.iv.hp}`;
			return {
				id: ev.id,
				title: ev.title,
				category: ev.category,
				start: ev.start,
				end: ev.end,
				isLocalTime: !!ev.isLocalTime,
				spawnDex: ev.spawnDex || [],
				// overview — every event spawn family, no other constraint
				overview: fams,
				// ① keep
				souvenirs: `${fams}&${souvenirTokens.join(',')}`,
				keepIv,
				// ② still to sort — spawns you haven't favourited or tagged yet
				sort: `${fams}&!${kw.flag.favorite}&!#`,
				// ③ trash — your full trash logic, scoped to this event's spawns
				trash: `${fams}&${trash}`,
			};
		})
		.filter(Boolean);

	// -- MAX BATTLE TANKS / CHARGERS · universal 0.5s-fast-move filter ---
	// Max Battle meta hinges on Max Meter charging speed: only the 0.5s-tier
	// fast moves fill the meter optimally (per Pokémon GO Hub's per-attack
	// rounding floor — every fast-move tick generates 1 Max Energy regardless
	// of damage, so faster ticks win). This filter surfaces every Max-eligible
	// Pokémon that carries a 0.5s fast move, irrespective of typing — the user
	// can layer their own type/CP filter on top in-game. Move names are pulled
	// from META_RANKINGS.chargerMoves (data-derived from pogoapi fast_moves
	// duration ≤ 500ms) and localized via the move-name dictionary that the
	// existing fetch-translations sheet already populates.
	const localizedChargers = (META_RANKINGS.chargerMoves || [])
		.map((m) => {
			// Sheet keys use the move's canonical lowercase EN name; pogoapi
			// sometimes drops the hyphen ("Lock On" vs "Lock-On") — try the
			// hyphenated variant first since that's what the sheet usually has.
			const lower = m.name.toLowerCase();
			const hyphen = lower.replace(/\s+/g, '-');
			const localized = tFn(`move.${hyphen}`, {
				fallback: tFn(`move.${lower}`, { fallback: m.name }),
			});
			// PoGo's search treats spaces as token boundaries; collapse whitespace
			// so a multi-word move like "Mud Shot" matches as the substring
			// `@1mudshot`. Lowercase + leave hyphens (`@1lock-on` is valid).
			return localized.toLowerCase().replace(/\s+/g, '');
		})
		.filter(Boolean);
	const maxTankClauses = [];
	if (localizedChargers.length > 0) {
		push(maxTankClauses, localizedChargers.map((n) => `@1${n}`).join(','), tFn('app.clause_why.max_tank_chargers'));
		if (kw.flag.dynamax_move) {
			push(maxTankClauses, `${kw.flag.dynamax_move}1-`, tFn('app.clause_why.max_battle_dynamax_only'));
		}
	}
	const maxTank = {
		clause: maxTankClauses.map((c) => c.clause).join('&'),
		clauses: maxTankClauses,
		moveCount: localizedChargers.length,
	};

	// -- TEAM ROCKET · per-trainer counter filters -----------------------
	// Three trainer kinds, each with its own filter shape:
	//   leader        → 3 phase clauses (you swap Pokémon between phases)
	//   typed_grunt   → 1 aggregated clause across the whole lineup
	//   generic_grunt → offensive-only clause (top-3 SE move types) plus a
	//                   lineup hint, since the lineup is too varied for a
	//                   universal resistor.

	// ScrapedDuck stores Pokémon names in EN ("Persian", "Kangaskhan"); the
	// teaser/hint render layer surfaces these directly. Resolve to the user's
	// outputLocale via the existing species dictionary so a DE user sees
	// "Snobilikat, Kangama" instead of "Persian, Kangaskhan". Falls back to
	// the EN name if the dictionary doesn't have the entry. Capitalized for
	// display (resolveSpecies returns lowercase per the filter convention).
	const localizePokemonName = (name) => {
		const lower = resolveSpecies(name, outputLocale);
		if (!lower) return name;
		return lower.charAt(0).toUpperCase() + lower.slice(1);
	};
	const localizePokemons = (list) => (list || []).map((pk) => ({ ...pk, name: localizePokemonName(pk.name) }));
	const localizePhases = (phases) => (phases || []).map((p) => ({ ...p, pokemons: localizePokemons(p.pokemons) }));

	const buildSecondMoveAndAppraise = () => {
		if (!cfg.raidRequireSecondMove) return null;
		return { clause: `!@${kw.flag.three_move}`, why: tFn('app.clause_why.raid_second_move') };
	};
	const buildLeaderPhase = (phase) => {
		const resistorList = (phase.resistorTypes || []).map((t) => kw.type[t]).filter(Boolean);
		const seMoveList = (phase.seMoveTypes || []).map((t) => kw.type[t]).filter(Boolean);
		const localizedPokemons = localizePokemons(phase.pokemons);
		if (resistorList.length === 0 || seMoveList.length === 0) {
			return {
				slot: phase.slot,
				pokemons: localizedPokemons,
				clause: '',
				clauses: [],
				lenient: null,
				skipped: true,
			};
		}
		const clauses = [];
		// Soft resistor allowlist — narrow lineups like Landorus (resistorTypes:
		// ["flying"]) would otherwise gate the filter to Flying-only attackers,
		// which leaves Gyarados as the lone real candidate and gets melted by
		// Stone Edge. Letting top attackers OR-bypass surfaces Glaceon, Galarian
		// Darmanitan, Kyogre etc. who still have to clear the SE-move and
		// weakness-guard hard gates below.
		push(clauses, withAllowlist(resistorList.join(',')), tFn('app.clause_why.rocket_resistor_types'));
		push(clauses, fastMoveClause(seMoveList), tFn('app.clause_why.rocket_se_fast'));
		push(clauses, chargeMoveClause(seMoveList), tFn('app.clause_why.rocket_se_charge'));
		const second = buildSecondMoveAndAppraise();
		if (second) push(clauses, second.clause, second.why);
		// Per-phase weakness guard from the union of types across the phase's
		// possible Pokémon — covers secondary types like flying on Charizard.
		const wGuard = weaknessGuard(unionTypesOf(phase.pokemons));
		if (wGuard) push(clauses, wGuard, tFn('app.clause_why.rocket_not_weak_to_lineup'));
		return {
			slot: phase.slot,
			pokemons: localizedPokemons,
			clause: clauses.map((c) => c.clause).join('&'),
			clauses,
			lenient: buildLenientCounters(seMoveList, unionTypesOf(phase.pokemons)),
			skipped: false,
		};
	};
	// ScrapedDuck names are like "Ice-type Female Grunt" / "Male Grunt" — pull
	// gender out of the EN string regardless of the user's outputLocale.
	const gruntGender = (rawName) => (/female/i.test(rawName) ? 'female' : 'male');
	// Resolve a quote entry (locale-keyed; each value is either a plain string
	// or a `{female, male}` object when the locale's grunt speech diverges by
	// speaker). Falls back: outputLocale → en → null.
	const resolveQuote = (entry, gender) => {
		if (!entry) return null;
		const localized = entry[outputLocale] ?? entry.en;
		if (!localized) return null;
		if (typeof localized === 'string') return localized;
		return localized[gender] ?? localized.male ?? localized.female ?? null;
	};

	// Localize the EN ScrapedDuck name "Fire-type Female Grunt" via existing
	// type-name i18n. Gender stays as a symbol (♂/♀) since it's universal.
	// Falls back to the raw EN name if either token is missing.
	const localizedGruntName = (trainer) => {
		const typeKw = kw.type[trainer.type];
		if (!typeKw) return trainer.name;
		const typeCap = typeKw.charAt(0).toUpperCase() + typeKw.slice(1);
		const isFemale = /female/i.test(trainer.name);
		const key = isFemale ? 'app.filter.rocket_grunt_female' : 'app.filter.rocket_grunt_male';
		return tFn(key, { params: { type: typeCap }, fallback: trainer.name });
	};
	const buildTypedGrunt = (trainer) => {
		const resistorList = (trainer.resistorTypes || []).map((t) => kw.type[t]).filter(Boolean);
		const seMoveList = (trainer.seMoveTypes || []).map((t) => kw.type[t]).filter(Boolean);
		const displayName = localizedGruntName(trainer);
		const localizedPhases = localizePhases(trainer.phases);
		const gender = gruntGender(trainer.name);
		const quote = resolveQuote(ROCKET_GRUNT_QUOTES.typed?.[trainer.type], gender);
		if (resistorList.length === 0 || seMoveList.length === 0) {
			return {
				name: displayName,
				type: trainer.type,
				phases: localizedPhases,
				quote,
				clause: '',
				clauses: [],
				lenient: null,
				skipped: true,
			};
		}
		const clauses = [];
		// Soft resistor allowlist — see buildLeaderPhase for the rationale.
		push(clauses, withAllowlist(resistorList.join(',')), tFn('app.clause_why.rocket_resistor_types'));
		push(clauses, fastMoveClause(seMoveList), tFn('app.clause_why.rocket_se_fast'));
		push(clauses, chargeMoveClause(seMoveList), tFn('app.clause_why.rocket_se_charge'));
		const second = buildSecondMoveAndAppraise();
		if (second) push(clauses, second.clause, second.why);
		// Whole-lineup weakness guard. Includes secondary types from any
		// phase's roster (e.g. flying on a Fire grunt's Charizard).
		const allLineup = (trainer.phases || []).flatMap((p) => p.pokemons || []);
		const wGuard = weaknessGuard(unionTypesOf(allLineup));
		if (wGuard) push(clauses, wGuard, tFn('app.clause_why.rocket_not_weak_to_lineup'));
		return {
			name: displayName,
			type: trainer.type,
			phases: localizedPhases,
			quote,
			clause: clauses.map((c) => c.clause).join('&'),
			clauses,
			lenient: buildLenientCounters(seMoveList, unionTypesOf(allLineup)),
			skipped: false,
		};
	};
	// Capitalized localized type name for display ("Feuer", "Wasser"). The
	// raw kw.type value is lowercase since filter syntax wants it that way.
	const localizedTypeDisplay = (typeKey) => {
		const v = kw.type[typeKey];
		if (!v) return typeKey;
		return v.charAt(0).toUpperCase() + v.slice(1);
	};
	const buildGenericGrunt = (trainer) => {
		const seMoveList = (trainer.topOffensiveTypes || []).map((t) => kw.type[t]).filter(Boolean);
		const localizedPhases = localizePhases(trainer.phases);
		// Attach localizedType so render-side teaser/hint helpers (which don't
		// see kw) can show "Kampf, Elektro" in DE instead of raw "fighting,
		// electric". Original h.type is preserved for keys / data lookups.
		const localizedTopHits = (trainer.topHits || []).map((h) => ({
			...h,
			localizedType: localizedTypeDisplay(h.type),
		}));
		// Generic grunts have 3 numbered pre-battle quotes (any of which may
		// appear). Surface all 3 in the matching speaker gender so the user can
		// recognize the encounter regardless of which line was rolled.
		const gender = gruntGender(trainer.name);
		const quotes = (ROCKET_GRUNT_QUOTES.generic || []).map((e) => resolveQuote(e, gender)).filter(Boolean);
		if (seMoveList.length === 0) {
			return {
				name: trainer.name,
				phases: localizedPhases,
				topHits: localizedTopHits,
				quotes,
				clause: '',
				clauses: [],
				skipped: true,
			};
		}
		const clauses = [];
		push(clauses, fastMoveClause(seMoveList), tFn('app.clause_why.rocket_top_offensive_fast'));
		push(clauses, chargeMoveClause(seMoveList), tFn('app.clause_why.rocket_top_offensive_charge'));
		const second = buildSecondMoveAndAppraise();
		if (second) push(clauses, second.clause, second.why);
		// Partial weakness guard: only STAB types that show up on enough of the
		// lineup to be worth excluding defenders weak to them. Rare lineup pulls
		// (e.g. a single Charizard's flying STAB) intentionally slip through so
		// we don't drop solid counters that happen to have one minority weakness.
		const wGuard = weaknessGuard(trainer.commonStabTypes || []);
		if (wGuard) push(clauses, wGuard, tFn('app.clause_why.rocket_not_weak_to_common_stab'));
		return {
			name: trainer.name,
			phases: localizedPhases,
			topHits: localizedTopHits,
			quotes,
			clause: clauses.map((c) => c.clause).join('&'),
			clauses,
			skipped: false,
		};
	};
	const rocketLeaders = [];
	const rocketTypedGrunts = [];
	const rocketGenericGrunts = [];
	for (const trainer of ROCKET_LINEUPS.trainers || []) {
		if (trainer.kind === 'leader') {
			rocketLeaders.push({
				name: trainer.name,
				phases: (trainer.phases || []).map(buildLeaderPhase),
			});
		} else if (trainer.kind === 'typed_grunt') {
			rocketTypedGrunts.push(buildTypedGrunt(trainer));
		} else if (trainer.kind === 'generic_grunt') {
			rocketGenericGrunts.push(buildGenericGrunt(trainer));
		}
	}
	const rocketLineupsFetchedAt = ROCKET_LINEUPS.fetchedAt || null;
	// Localized, capitalized type names — used by the quote-lookup widget to
	// render match labels like "{type}-Rüpel" / "{type}-type grunt".
	const rocketTypeLabels = Object.fromEntries(Object.keys(kw.type || {}).map((k) => [k, localizedTypeDisplay(k)]));

	// -- PVP · per-league meta filters ------------------------------------
	// For each league: family-search the top-N meta picks (deduped by base
	// dex), AND the league's CP cap, AND the loose PvP rank-1 IV pattern
	// (atk 0-1 OR'd, def 3-4, HP 3-4). Loose mirrors the pvpMode `loose`
	// semantic — wider than strict so the user keeps an attack-IV-1 candidate
	// they might still prefer for the bait power.
	// Master League has no CP cap, so rank-1 IV math doesn't apply — there
	// a high-attack hundo wins. Skip the IV clauses entirely for capless
	// leagues; the user filters Master picks by what they have.
	const buildLeagueFilter = (league) => {
		const speciesList = (league?.species || [])
			.map((s) => pokemonNameFor(String(s.dex), outputLocale) || s.name?.toLowerCase())
			.filter(Boolean);
		if (speciesList.length === 0) return { clause: '', clauses: [], skipped: true };
		const familyPool = speciesList.map((n) => `+${n}`).join(',');
		const clauses = [];
		push(clauses, familyPool, tFn('app.clause_why.pvp_meta_pool'));
		if (league.cpCap) {
			push(
				clauses,
				`${kw.numeric.cp}-${league.cpCap}`,
				tFn('app.clause_why.pvp_cp_cap', { params: { cap: league.cpCap } }),
			);
			push(clauses, `0-1${kw.iv.atk}`, tFn('app.clause_why.pvp_loose_atk'));
			push(clauses, `3-4${kw.iv.def}`, tFn('app.clause_why.pvp_loose_def'));
			push(clauses, `3-4${kw.iv.hp}`, tFn('app.clause_why.pvp_loose_hp'));
		}
		return { clause: clauses.map((c) => c.clause).join('&'), clauses, skipped: false };
	};
	const pvpFilters = {};
	for (const [key, league] of Object.entries(PVP_RANKINGS.leagues || {})) {
		pvpFilters[key] = buildLeagueFilter(league);
	}
	const pvpRankingsFetchedAt = PVP_RANKINGS.fetchedAt || null;

	// One-tap seeds for the intelligent-mode list. `species` holds STORAGE-locale
	// names (what resolveSpecies produces) so they compare against the curated
	// list directly; `display` is the same set rendered for the user's PoGo
	// locale. pokemonNameFor(dex) collapses form suffixes ("Mimikyu (Busted)",
	// "Quagsire (Shadow)") to the base species, which is what a +family search
	// wants anyway — the Set drops the dupes that fall out of that.
	//
	// Meisterliga is deliberately NOT offered: it has no CP cap, so a low-attack
	// PvP spread is actively WORSE there than a hundo. Seeding it would protect
	// spreads the user would never play. Hand-adding a Master species still works.
	const PVP_META_PACK_LEAGUES = ['great', 'ultra'];
	const pvpMetaPacks = PVP_META_PACK_LEAGUES.flatMap((key) => {
		const league = PVP_RANKINGS.leagues?.[key];
		if (!league?.species?.length) return [];
		const stored = [
			...new Set(league.species.map((sp) => pokemonNameFor(String(sp.dex))).filter(Boolean)),
		];
		if (stored.length === 0) return [];
		return [
			{
				id: key,
				labelKey: `app.pvp.meta_pack_${key}`,
				species: stored,
				display: stored.map((sp) => speciesForOutput(sp, outputLocale) || sp),
			},
		];
	});

	// Active GBL cups — pair lily-dex's cup rankings with the ScrapedDuck
	// event windows that mention each cup. Filter clauses reuse the league
	// pipeline (species OR-list + cup CP cap + loose IV pattern), so the
	// user's existing buildLeagueFilter machinery handles the math. Card is
	// emitted with start/end metadata so the UI can hide itself outside the
	// active window.
	const nowMs = Date.now();
	const cupFilters = [];
	for (const event of PVP_RANKINGS.gblEvents || []) {
		const startMs = Date.parse(event.start);
		const endMs = Date.parse(event.end);
		if (!(startMs <= nowMs && nowMs <= endMs)) continue;
		for (const cupId of event.cups || []) {
			const cup = PVP_RANKINGS.cups?.[cupId];
			if (!cup) continue;
			const filter = buildLeagueFilter(cup);
			if (filter.skipped) continue;
			cupFilters.push({
				id: cup.id,
				name: cup.name,
				cpCap: cup.cpCap,
				eventName: event.name,
				start: event.start,
				end: event.end,
				clause: filter.clause,
				clauses: filter.clauses,
			});
		}
	}

	return {
		trash,
		tradedTrashSort,
		trade,
		sort,
		luckySort,
		luckyFamilySort,
		nundoSort,
		prestaged,
		gift,
		buddyCatchFilters,
		TE_full,
		TE_trim,
		luckyHundoSet,
		// Friend wishlists (blacklist of owned dex numbers + trade guards)
		friendLuckyWishlist,
		friendLuckyWishlistGuaranteed,
		friendHundoWishlist,
		friendLuckyClauses,
		friendHundoClauses,
		// Curated friend-collect wishlist (positive targets − owned families)
		friendCollectMode,
		friendCollectTargets,
		friendCollectWishlist,
		friendCollectWishlistGuaranteed,
		friendCollectClauses,
		friendCollectSuggestions,
		trashClauses,
		tradeClauses,
		sortClauses,
		luckySortClauses,
		luckyFamilySortClauses,
		nundoSortClauses,
		prestagedClauses,
		giftClauses,
		// Aux pro-tools
		shadowCheap,
		shadowSafe,
		shadowHundoCandidates,
		shadowFrustration,
		evoSwapCandy,
		evoSwapItem,
		cheapEvolve,
		dexPlus,
		megaEvolve,
		pilotLong,
		shadowCheapClauses,
		shadowSafeClauses,
		shadowHundoClauses,
		shadowFrustrationClauses,
		evoSwapCandyClauses,
		evoSwapItemClauses,
		cheapEvolveClauses,
		dexPlusClauses,
		megaEvolveClauses,
		pilotLongClauses,
		// Per-boss raid + max-battle counters
		raidFilters,
		eventRaidFilters,
		maxBattleFilters,
		raidBossesFetchedAt,
		maxTank,
		// Event wild-spawn curation filters
		eventFilters,
		eventsFetchedAt,
		// Team Rocket counters (leaders / typed grunts / generic grunts)
		rocketLeaders,
		rocketTypedGrunts,
		rocketGenericGrunts,
		rocketLineupsFetchedAt,
		rocketTypeLabels,
		// PvP league meta filters
		pvpFilters,
		pvpRankingsFetchedAt,
		pvpMetaPacks,
		cupFilters,
	};
}

// ─── PARSER (for verification panel) ──────────────────────────────────────
//
// Locale-aware: parses filter syntax in whatever language the filter was
// generated in (matches the user's PoGo output locale).

function escapeRegex(s) {
	return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Maps a semantic flag key (kw.flag.*) → the property on `mon.flags`.
const FLAG_TO_MON = {
	favorite: 'favorite',
	shiny: 'shiny',
	lucky: 'lucky',
	legendary: 'legendary',
	mythical: 'mythical',
	ultra_beast: 'ultrabeast',
	shadow: 'shadow',
	purified: 'purified',
	costume: 'costume',
	background: 'background',
	traded: 'traded',
	hatched: 'hatched',
	female: 'female',
	male: 'male',
	baby: 'eggOnly',
	new_evo: 'newDexEvo',
	special_move: 'legacyMove',
	xxl: 'xxl',
	xl: 'xl',
	xxs: 'xxs',
	gigantamax: 'gigantamaxCapable',
};

// Boolean façade over evalFilterDetailed — "is this mon DEFINITELY a match".
// Indeterminate collapses to false here, which is what the offline checks in
// scripts/check-carveouts.mjs already assume. UI that shows a verdict to a human
// about to mass-transfer must use evalFilterDetailed instead, so it can say
// "I don't know" rather than a confident, wrong "not in trash".
export function evalFilter(filterStr, mon, outputLocale = 'de') {
	return evalFilterDetailed(filterStr, mon, outputLocale).verdict === true;
}

// Three-valued evaluation: true / false / null (= can't tell).
//
// This evaluator only models the slice of PoGo's search grammar that
// buildFilters emits, so it WILL meet terms it cannot parse. It used to treat
// those as "skip", which quietly turned an all-unknown clause into `false` and,
// through the AND across clauses, made the whole filter false for every
// conceivable Pokémon. A single `!#Trade` clause was enough to make the verify
// panel report "not in trash" for a shiny, a lucky and a hundo alike.
//
// Returns { verdict, unknown } where `unknown` lists the terms that forced an
// indeterminate result (empty whenever the verdict is definite).
export function evalFilterDetailed(filterStr, mon, outputLocale = 'de') {
	const kw = pogoKeywords(outputLocale);
	const unknown = [];
	let indeterminate = false;
	for (const c of String(filterStr).split('&')) {
		const v = evalClause(c, mon, kw, outputLocale, unknown);
		// Clauses are ANDed: one clause that is definitely false settles the whole
		// filter, no matter what the other clauses could not parse.
		if (v === false) return { verdict: false, unknown: [] };
		if (v === null) indeterminate = true;
	}
	return indeterminate ? { verdict: null, unknown } : { verdict: true, unknown: [] };
}

// A clause is a comma-OR. One satisfied term settles it as true even if siblings
// were unparseable. Only when NOTHING known matched does an unknown term matter:
// it might have been the term that matched, so the clause is null, not false.
function evalClause(c, mon, kw, outputLocale, unknown) {
	const unresolved = [];
	for (const raw of c.split(',')) {
		const t = raw.trim();
		if (!t) continue; // dangling/doubled separators carry no predicate
		const negated = t.startsWith('!');
		const term = negated ? t.slice(1) : t;
		const v = evalTerm(term, mon, kw, outputLocale);
		if (v === null) {
			unresolved.push(t);
			continue;
		}
		if (negated ? !v : v) return true;
	}
	if (unresolved.length === 0) return false;
	if (unknown) unknown.push(...unresolved);
	return null;
}
function evalTerm(t, mon, kw, outputLocale) {
	if (t.startsWith('+')) {
		const name = t.slice(1).toLowerCase();
		return mon.families.includes(name);
	}
	// Universal: stars, year, dex#
	let m = t.match(/^(\d+)(?:-(\d+))?\*$/);
	if (m) {
		const lo = +m[1],
			hi = m[2] ? +m[2] : lo;
		return mon.star >= lo && mon.star <= hi;
	}

	// Locale-driven IV ranges
	const ivAtkRe = new RegExp(`^(\\d+)(?:-(\\d+))?${escapeRegex(kw.iv.atk)}$`);
	m = t.match(ivAtkRe);
	if (m) {
		const lo = +m[1],
			hi = m[2] ? +m[2] : lo;
		return mon.atk >= lo && mon.atk <= hi;
	}
	const ivDefRe = new RegExp(`^(\\d+)(?:-(\\d+))?${escapeRegex(kw.iv.def)}$`);
	m = t.match(ivDefRe);
	if (m) {
		const lo = +m[1],
			hi = m[2] ? +m[2] : lo;
		return mon.def >= lo && mon.def <= hi;
	}
	const ivHpRe = new RegExp(`^(\\d+)?(-)?(\\d+)?${escapeRegex(kw.iv.hp)}$`);
	m = t.match(ivHpRe);
	if (m && (m[1] || m[3])) {
		const lo = m[1] ? +m[1] : 0;
		const hi = m[3] ? +m[3] : m[2] ? 99 : lo;
		return mon.hp >= lo && mon.hp <= hi;
	}

	// Locale-driven numeric (distance, age, year, cp, buddy, mega, dynamax move)
	const distRe = new RegExp(`^${escapeRegex(kw.numeric.distance)}(\\d+)-?$`);
	m = t.match(distRe);
	if (m) return (mon.distance || 0) >= +m[1];
	const cpRe = new RegExp(`^${escapeRegex(kw.numeric.cp)}-?(\\d+)$`);
	m = t.match(cpRe);
	if (m) return (mon.wp || 9999) <= +m[1];
	// CP floor (>= N) — trailing dash. Disjoint from cpRe (which ends in a
	// digit), so ordering is safe. Used by the Rocket lenient pool (cp3500-).
	// Default 0 so an unknown-CP fixture FAILS the floor (mirror of the <= 9999).
	const cpFloorRe = new RegExp(`^${escapeRegex(kw.numeric.cp)}(\\d+)-$`);
	m = t.match(cpFloorRe);
	if (m) return (mon.wp || 0) >= +m[1];
	const ageRe = new RegExp(`^${escapeRegex(kw.numeric.age)}-(\\d+)$`);
	m = t.match(ageRe);
	if (m) return (mon.ageDays || 9999) <= +m[1];
	const yearRe = new RegExp(`^${escapeRegex(kw.numeric.year)}(\\d+)-$`);
	m = t.match(yearRe);
	if (m) return (mon.year || 0) >= 2000 + +m[1];
	m = t.match(/^(\d+)$/);
	if (m) return mon.dex === +m[1];

	// Locale-driven keyword tokens
	if (t === `${kw.numeric.buddy}1-`) return !!mon.flags?.buddy;
	if (t === `${kw.flag.mega}1-`) return !!mon.flags?.megaEvolved;
	if (t === `${kw.flag.mega}0`) return !mon.flags?.megaEvolved;
	if (t === `${kw.flag.dynamax_move}1-`) return !!mon.flags?.dynamaxCapable;
	// `#` = carries ANY tag; `#name` = carries a tag starting with `name`. The
	// prefix semantics are what buildFilters itself banks on when it emits a
	// per-buddy `!#<prefix>` guard. Without this branch every named-tag clause
	// (`!#Trade`, league tags, custom protected tags, buddy prefixes) was
	// unparseable — see evalFilterDetailed.
	if (t === '#') return !!mon.flags?.tagged || (mon.tags || []).length > 0;
	if (t.startsWith('#')) {
		const want = t.slice(1).toLowerCase();
		if (!want) return !!mon.flags?.tagged || (mon.tags || []).length > 0;
		return (mon.tags || []).some((tag) => String(tag).toLowerCase().startsWith(want));
	}
	if (t === '@3move') return !mon.flags?.doubleMoved; // INVERTED per game
	if (t === `@${kw.flag.special_move}`) return !!mon.flags?.legacyMove;

	// Universal league tags
	if (t === 'ⓤ') return !!mon.flags?.leagueU;
	if (t === 'ⓖ') return !!mon.flags?.leagueG;
	if (t === 'ⓛ') return !!mon.flags?.leagueL;

	// Locale-driven flag tokens (favorite, shiny, lucky, legendary, mythical, ...)
	const flagKey = flagKeyFromKeyword(t, outputLocale);
	if (flagKey && FLAG_TO_MON[flagKey]) {
		return !!mon.flags?.[FLAG_TO_MON[flagKey]];
	}

	// Locale-driven type checks (psychic, ice, dark, ...)
	const typeKey = typeKeyFromKeyword(t, outputLocale);
	if (typeKey) {
		return (mon.types || []).includes(typeKey);
	}

	// Bare species-name literal — the EXACT-species selector that buddy unions
	// ("corasonn,dratini"), regional collector protections ("!corasonn"), and
	// scoped guards ("!Corasonn,!geist") emit. Went unrecognized (→ null-skip,
	// clause always false) since exact targets stopped being +family selectors.
	// Resolve in any locale, then compare identity: dex when the mon carries
	// one, else canonical name against the mon's own species (families[0] in
	// the verify tester). Checked LAST so localized flag/type keywords that
	// shadow a species name keep their filter meaning.
	const speciesInfo = resolveSpeciesInfo(t);
	if (speciesInfo) {
		if (mon.dex) return mon.dex === speciesInfo.dex;
		const own = mon.species || (mon.families || [])[0] || '';
		return own !== '' && (resolveSpecies(own) || String(own).toLowerCase()) === (resolveSpecies(t) || t.toLowerCase());
	}

	return null;
}

// ─── STORAGE ──────────────────────────────────────────────────────────────

const KEY_HUNDOS = 'pogo:hundos';
const KEY_LUCKIES = 'pogo:luckies';
const KEY_TOP_ATTACKERS = 'pogo:topAttackers';
const KEY_TOP_MAX_ATTACKERS = 'pogo:topMaxAttackers';
const KEY_CONFIG = 'pogo:config';
const KEY_ONBOARDED = 'pogo:onboarded';
const KEY_CHANGELOG_SEEN = 'pogo:changelogSeen';

// iOS Safari (regular tab) refuses Storage API persistence at the WebKit
// level: navigator.storage.persist() resolves with false immediately, no
// prompt. The only durable-storage path on iOS is Add to Home Screen
// (standalone), which switches WebKit to a different storage policy.
// iPadOS in desktop-mode reports as "Macintosh" but exposes touch — that's
// why we also probe maxTouchPoints.
function isIOSNonStandalone() {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
	if (!isIOS) return false;
	const standalone =
		window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
	return !standalone;
}

// Storage shim: was window.storage in the Claude.ai artifact runtime.
// In the standalone app we use localStorage directly. Same async API for
// minimal code change.
async function loadJSON(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		return raw == null ? fallback : JSON.parse(raw);
	} catch {
		return fallback;
	}
}
async function saveJSON(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

// ─── REGIONAL MAP DATA (from KMZ — u/zoglandboy / u/Mattman243 / pokemoncalendar.com) ───

const VIEW_W = 800,
	VIEW_H = 400;

// Real polygon geometry from PoGo Regional Map KMZ. NOT rendered visually —
// used only for point-in-polygon hit testing when the user taps the map.
const POGO_REGIONS_KMZ = JSON.parse(
	`[{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Pom-Pom Oricorio/Yellow Flabébé/Panpour/Azelf","english":["Pom-Pom Oricorio","Yellow Flabébé","Panpour","Azelf"],"german":["Choreogel (Cheerleading)","Flabébé (gelb)","Sodamak","Tobutz"],"geometry":{"type":"Polygon","coordinates":[[[179.9788423,85.0371116],[179.4930617,-84.9676454],[-26.1197931,-85.0824329],[-23.203125,85.0207077],[179.9788423,85.0371116]]]}},{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Sensu Oricorio/Blue Flabébé/Pansage/Uxie","english":["Sensu Oricorio","Blue Flabébé","Pansage","Uxie"],"german":["Choreogel (Buyo)","Flabébé (blau)","Vegimak","Selfe"],"geometry":{"type":"Polygon","coordinates":[[[90.9771923,85.0570722],[90.1036767,64.613503],[90.0457357,54.6777412],[89.9924066,48.9758687],[89.9896598,48.7599692],[89.9855392,48.6085576],[89.9842279,48.3717998],[90.0020807,22.0296934],[86.8261326,-85.0575818],[179.4930617,-84.9676454],[179.9788423,85.0371116],[90.9771923,85.0570722]]]}},{"folder":"Type 5 [Trios (Big Three Regions)]","name":"Baile Oricorio/Red Flabébé/Pansear/Mesprit","english":["Baile Oricorio","Red Flabébé","Pansear","Mesprit"],"german":["Choreogel (Flamenco)","Flabébé (rot)","Grillmak","Vesprit"],"geometry":{"type":"Polygon","coordinates":[[[86.8261326,-85.0575818],[89.9918303,48.9656349],[90.0462269,56.2339545],[90.9771923,85.0570722],[-23.203125,85.0207077],[-23.1787953,84.9056643],[-24.2386427,65.8003482],[-26.1197931,-85.0824329],[86.8261326,-85.0575818]]]}},{"folder":"Type 4 [Hemispheric Regionals]","name":"Chatot - Type 4 [Hemispheric Regional]","english":["Chatot"],"german":["Plaudagei"],"geometry":{"type":"Polygon","coordinates":[[[78.4737327,-0.0655574],[77.0587661,-65.8269101],[83.4967544,-65.9536888],[92.0660904,-65.9536888],[102.4371841,-65.9536888],[114.7858169,-65.9536888],[125.6403091,-65.9536888],[137.4933308,-65.9705568],[171.7706746,-65.9705568],[-152.1941692,-65.9705568],[-114.4012004,-65.9705568],[-85.0457317,-65.9705568],[-49.0105754,-65.9705568],[-12.9754192,-65.9705568],[12.9523152,-65.7909809],[27.4542683,-65.7909809],[50.8331746,-65.718798],[77.0245808,-65.8269967],[78.4692215,-0.066183],[-28.6095949,-0.0750637],[-120.5886795,-0.0690087],[145.7979514,-0.0655574],[78.4737327,-0.0655574]]]}},{"folder":"Type 3 [Paired Regional Line]","name":"Type 3 [Paired Regional Line]","english":["Type 3 [Paired Regional Line]"],"german":["Type 3 [Paired Regional Line]"],"geometry":{"type":"LineString","coordinates":[[-29.0478436,85.0397427],[-29.1357322,33.3213485],[-21.3835305,33.3385554],[-14.5557243,33.3327905],[-6.5154841,33.496424],[1.1645508,33.5413946],[9.3965509,33.5230259],[17.5122071,33.3947592],[26.916504,33.3764123],[36.2400056,33.3935447],[43.59375,33.4497766],[49.5074177,33.4598794],[54.5800781,33.4864354],[53.437502,-85.0207077]]}},{"folder":"Type 3 [Paired Regional Line]","name":"Type 3 [Paired Meridian Line]","english":["Type 3 [Paired Meridian Line]"],"german":["Type 3 [Paired Meridian Line]"],"geometry":{"type":"LineString","coordinates":[[-0.0015,-85.051],[-0.0015,51.4779],[-0.0015,85.05]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Maractus/Heracross","english":["Maractus","Heracross"],"german":["Maracamba","Skaraborn"],"geometry":{"type":"Polygon","coordinates":[[[-28.7126839,-60.8079488],[-29.0003358,28.8387285],[-31.0039204,28.8426785],[-33.0184819,28.8445857],[-35.0099838,28.8333665],[-37.0025528,28.8387736],[-39.0055406,28.8446463],[-41.002899,28.8384495],[-43.0042338,28.8359558],[-45.0014522,28.8457198],[-46.9920227,28.8428544],[-49.0138632,28.8378503],[-51.0134117,28.8391466],[-53.0015012,28.8433519],[-56.9979247,28.8399738],[-57.9907668,28.8371582],[-59.0015822,28.8384688],[-60.005754,28.8350249],[-60.9975612,28.8427744],[-61.9998994,28.8399356],[-62.9998658,28.839383],[-63.9996692,28.8398557],[-65.0000689,28.8399257],[-65.9992077,28.8401876],[-67.0000958,28.8401086],[-68.0000649,28.8399587],[-68.9999796,28.8402988],[-70.0003426,28.8401009],[-71.4878807,28.844786],[-72.4378771,28.8476871],[-73.4042996,28.8390047],[-76.3887972,28.8366705],[-79.2558588,28.8595511],[-81.0000026,28.8405108],[-82.0008589,28.8382549],[-83.5955598,28.8437688],[-85.5989242,28.8407351],[-87.1683985,28.8478368],[-88.7602735,28.8450618],[-90.2696907,28.8437939],[-91.5015451,28.8435616],[-92.7155388,28.8431238],[-93.7681432,28.8423097],[-95.1296132,28.8414159],[-96.9952763,28.8486886],[-99.5711717,28.8373746],[-100.7334133,28.8302342],[-101.8403142,28.83693],[-103.0372329,28.8386833],[-104.0691416,28.8168433],[-106.1237099,28.838453],[-107.9099433,28.8397707],[-108.4255453,28.8395984],[-108.8930633,28.8433065],[-109.811583,28.8412668],[-111.6679274,28.8419586],[-113.4914062,28.8465438],[-116.0492626,28.8602196],[-117.6440143,28.8458629],[-119.1353522,28.845896],[-120.9994904,28.8407632],[-123.9999279,28.8391765],[-125.0000215,28.8373549],[-125.9963467,28.8409241],[-127.0080506,28.8337881],[-128.0006884,28.8302599],[-128.9933704,28.8288623],[-129.2406481,-60.4394174],[-123.3079167,-60.5951658],[-115.2413217,-60.6442764],[-106.8736263,-60.6542888],[-97.5777026,-60.6538503],[-91.1512129,-60.8224591],[-86.1420809,-60.8023277],[-78.4595209,-60.8445596],[-68.6119016,-60.8928151],[-61.8343977,-60.8234963],[-50.4218225,-60.7841079],[-40.5706879,-60.9342487],[-28.7126839,-60.8079488]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Kangaskhan","english":["Kangaskhan"],"german":["Kangama"],"geometry":{"type":"Polygon","coordinates":[[[154.6435546,-50.0359736],[154.2480469,-0.3955047],[139.7460938,-0.5273363],[139.7460938,-10.9196178],[124.9907865,-11.1567369],[118.1733601,-10.983058],[111.6210938,-11.0921659],[111.4453125,-50.0641917],[120.7617188,-50.0641917],[124.994723,-50.1057947],[129.3750001,-50.0641917],[136.7578125,-49.9512199],[144.6679688,-50.0641917],[150.6445313,-50.0641917],[154.6435546,-50.0359736]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Relicanth","english":["Relicanth"],"german":["Relicanth"],"geometry":{"type":"Polygon","coordinates":[[[154.6435546,-50.0359736],[158.0273438,-50.0641917],[162.3779297,-50.1768981],[165.1068748,-50.2661105],[168.0029297,-50.1768982],[171.5185547,-50.2893392],[175.78125,-50.2893393],[-179.1142346,-50.2654442],[-172.6369959,-50.3012819],[-167.1034055,-50.2131875],[-162.4912283,-50.2328883],[-156.4453165,-50.0641918],[-156.7749163,-13.132979],[-163.0334483,-13.1266564],[-167.4799992,-13.0095058],[-175.1374124,-13.0690463],[175.7153341,-12.9403221],[169.2334025,-12.8867798],[162.1911662,-12.8867798],[154.2919942,-12.8010882],[154.6435546,-50.0359736]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Torkoal","english":["Torkoal"],"german":["Qurtel"],"geometry":{"type":"Polygon","coordinates":[[[52.7453632,1.9661667],[60.3815883,1.8864211],[71.2804828,1.9915931],[79.7167969,1.845384],[91.3472203,1.8333542],[98.5787908,1.7590192],[100.4509769,1.7386207],[102.4442077,1.711366],[103.5193966,1.7166697],[104.4545042,1.7215441],[106.5938691,1.7132064],[109.9302184,1.7321508],[111.9561768,1.7067483],[112.1704141,44.4494676],[112.1173677,50.5577109],[105.4840983,50.5324609],[99.148713,50.5162291],[92.1655657,50.5085978],[86.3053298,50.4299745],[79.371408,50.3882202],[73.5753126,50.416405],[67.9900495,50.3808714],[62.567102,50.3851389],[57.6802124,50.3430302],[53.2122924,50.3769995],[52.7453632,1.9661667]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Tropius","english":["Tropius"],"german":["Tropius"],"geometry":{"type":"Polygon","coordinates":[[[-29.1432522,36.7850711],[-28.8147581,-49.4355627],[-21.433732,-49.5437028],[-12.8320312,-49.6107099],[-3.5617921,-49.7415299],[4.921875,-49.6107099],[15.6445313,-49.6107099],[23.203125,-49.2678046],[31.1132813,-49.2678046],[39.6936035,-49.3752201],[46.6918945,-49.4109732],[52.157406,-49.2734073],[53.0914729,36.6774152],[52.097168,36.7300795],[50.690918,36.7036596],[46.7028809,36.7388841],[43.2476807,36.7432861],[39.7595215,36.7388841],[36.0351563,36.7212739],[32.1459961,36.7212739],[29.0017068,36.7002903],[25.452919,36.7245761],[21.9946289,36.7388841],[17.7319336,36.7388841],[13.458252,36.7124672],[10.8764648,36.7476877],[7.0000631,36.7002758],[3.3837891,36.7124672],[-0.3405762,36.7300795],[-2.2638135,36.7122808],[-4.0934758,36.722256],[-5.6855589,36.7460958],[-7.2729492,36.7608913],[-10.5194092,36.7608913],[-13.5406494,36.782892],[-16.8035888,36.7960895],[-20.5718994,36.782892],[-24.3951416,36.7916906],[-29.1432522,36.7850711]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Farfetch'd","english":["Farfetch'd"],"german":["Porenta"],"geometry":{"type":"Polygon","coordinates":[[[112.2363707,21.0724084],[116.267753,21.041066],[120.2716707,21.0755242],[124.1547096,21.0782104],[128.3788226,21.0698857],[132.7239722,21.0913307],[137.2781571,21.1321598],[141.227315,21.1515131],[146.3094692,21.1897179],[149.8515658,21.2484025],[152.4695452,21.2458494],[154.7355133,21.2638365],[154.5874152,48.478032],[150.1594106,48.4052644],[145.6498147,48.3771996],[139.770296,48.3925578],[134.487265,48.3680023],[129.748832,48.367673],[124.9151903,48.3664688],[119.8363995,48.3635568],[116.0626359,48.3723472],[112.0959005,48.3707026],[112.2363707,21.0724084]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Sigilyph","english":["Sigilyph"],"german":["Symvolara"],"geometry":{"type":"Polygon","coordinates":[[[19.3452587,39.811537],[19.332032,38.8462217],[25.1577296,31.6611084],[25.0973048,31.6260348],[25.0780787,31.5535073],[24.8583521,31.4012506],[24.885818,31.2651819],[24.8693385,31.1712268],[25.0286402,30.7708791],[24.9297633,30.487273],[24.7100367,30.1458518],[24.9901881,29.2487944],[24.9943556,21.9964122],[31.3005079,22.0065984],[31.4488234,22.2406793],[31.5092482,22.1898253],[31.4048781,22.0065984],[37.0247159,21.9759484],[36.1375357,27.3199596],[35.9178091,29.5035957],[35.945275,31.5709639],[35.891936,31.9680917],[34.8616611,32.3582582],[31.5425417,33.8918277],[26.9118043,37.1918091],[26.4271827,37.8239696],[26.6455318,39.0216347],[26.4342401,40.1524457],[25.9672679,40.6711027],[26.3435497,40.9164648],[26.354536,41.2477097],[26.6182079,41.3302599],[26.6291942,41.5937186],[26.2227001,41.7496405],[26.0579051,41.729146],[25.816206,41.7332454],[25.4756298,41.7250464],[24.9592724,41.7332455],[24.6846142,41.7414435],[24.3330517,41.7250463],[23.5475292,41.7209464],[22.7674999,41.7209465],[22.2181835,41.7332455],[21.6242351,42.053723],[21.4222728,42.0567402],[20.8256664,41.8970075],[20.4977198,41.7584865],[20.0813427,41.7004428],[19.2024364,41.6963413],[19.1914501,41.3385092],[19.2024365,41.0988561],[19.1914501,40.8500155],[19.2134227,40.6335948],[19.2463817,40.5000631],[19.2683544,40.316022],[19.323286,40.0726541],[19.3452587,39.811537]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Tauros","english":["Tauros"],"german":["Tauros"],"geometry":{"type":"Polygon","coordinates":[[[-62.6981825,28.8445398],[-62.8481171,52.0054047],[-63.2573713,52.0037827],[-63.7378819,51.9994762],[-64.4194369,51.9990793],[-64.9109279,52.0016288],[-65.429802,52.0062566],[-66.4145651,51.9994221],[-67.6554899,51.9969],[-68.4822449,52.0026605],[-69.5116346,52.0133904],[-69.9579592,52.0137245],[-70.6946856,51.9932767],[-71.8748781,51.9975447],[-73.9580435,51.9804658],[-75.3060432,51.9804309],[-76.1178445,51.9878938],[-77.1583682,51.9957354],[-77.9075456,52.0016725],[-78.3071278,52.0001727],[-78.6905126,51.9981522],[-79.45816,52.0049625],[-80.3506581,52.0192006],[-81.0746939,52.0267377],[-82.0307286,52.0174783],[-82.8914443,52.0089162],[-83.7152743,52.0184946],[-84.9422433,52.0146625],[-85.924956,52.0034694],[-87.1295952,52.0017378],[-88.2514299,52.0117435],[-89.4583413,52.0204869],[-90.7548885,52.0101238],[-92.1496536,51.9931606],[-93.2990015,51.9993943],[-93.9371159,52.0044191],[-94.551186,51.9950674],[-94.9074249,51.9904954],[-95.582477,51.9973399],[-96.0395531,51.994354],[-96.6505118,51.9965269],[-97.5041855,52.0078736],[-98.6142635,52.0231562],[-99.9904715,52.0284745],[-100.5386593,52.0183937],[-100.9741831,52.0159875],[-101.5111785,52.0178867],[-101.7818663,52.0141983],[-102.5375993,52.0091147],[-103.478188,52.0134692],[-103.9638903,52.0104674],[-104.3410526,52.0128156],[-104.7649122,52.017303],[-105.1346408,52.0228441],[-105.4455277,52.0226371],[-105.8277341,52.0216675],[-106.3306878,52.0185641],[-106.663113,52.0182406],[-107.4608763,52.0178845],[-107.8954091,52.0197334],[-109.0594264,52.0064121],[-109.7367911,52.0090744],[-110.7663496,52.0099515],[-111.3946285,52.0068604],[-112.6145388,52.0085099],[-113.8198416,52.0185119],[-115.409954,52.0228131],[-116.9985247,52.0108539],[-118.9132609,52.0096775],[-120.9591053,52.0103634],[-124.1664122,52.0220991],[-126.4804707,52.0083551],[-129.406906,52.0470712],[-128.9843308,28.8320727],[-127.9916179,28.8335311],[-126.9989489,28.8371191],[-125.9872129,28.844315],[-124.9908547,28.8408038],[-123.9907278,28.8426825],[-120.9901869,28.8444342],[-119.9917111,28.8444044],[-118.9895013,28.8437919],[-117.9900646,28.8439095],[-116.9919012,28.8452754],[-115.9932549,28.8480304],[-114.9942208,28.8458381],[-113.9912996,28.8458027],[-109.9919722,28.8445069],[-105.9911669,28.8441653],[-103.9907051,28.8432564],[-99.990369,28.8417632],[-98.0287243,28.8486587],[-97.0061875,28.8470795],[-95.9901076,28.8452835],[-91.9897197,28.8446589],[-87.9894034,28.84468],[-83.9896595,28.8446139],[-82.0008589,28.8382549],[-81.0000026,28.8405108],[-77.9885192,28.8449496],[-73.9886869,28.8447182],[-70.0003426,28.8401009],[-65.9992077,28.8401876],[-65.9875305,28.8447962],[-63.9879039,28.8444177],[-62.6981825,28.8445398]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Pachirisu","english":["Pachirisu"],"german":["Pachirisu"],"geometry":{"type":"Polygon","coordinates":[[[-51.2465545,70.2484435],[-64.318617,70.3891648],[-73.3124088,70.4963258],[-83.0549535,70.498633],[-92.9226511,70.5052488],[-100.2965151,70.5568918],[-114.2409737,70.3642874],[-126.9825731,70.2723088],[-139.1951946,70.1513385],[-152.8194494,70.2245787],[-164.3310537,70.2225052],[-177.2391023,70.2155618],[169.8505556,70.2061816],[157.6624196,70.2417241],[146.9690404,70.2415726],[137.3397908,70.2083194],[129.301766,70.1948432],[119.8298713,70.1754445],[108.1946569,70.0935009],[97.1380316,69.9378562],[86.9395483,70.0742043],[79.1749259,70.1927158],[68.6184122,70.2211917],[60.8457833,70.2036538],[53.6408717,70.2347072],[53.2232787,51.7372346],[61.8584701,51.7334294],[69.8364621,51.720933],[76.9254962,51.6799256],[83.1343521,51.7040547],[89.4013995,51.6432551],[96.4844281,51.7116091],[101.0014975,51.657683],[106.3918914,51.6283886],[111.8448624,51.6665148],[116.5778169,51.7157428],[120.8849629,51.7813005],[125.7690167,51.72023],[130.5228836,51.7631141],[138.7502881,51.7933421],[144.3377356,51.8291829],[150.9179817,51.826963],[157.5879027,51.6997998],[166.25318,51.7300823],[175.249209,51.912705],[-176.4702637,51.9280344],[-168.7749605,52.031642],[-160.7222092,52.1029519],[-150.5437768,52.0746591],[-142.9613354,52.0542054],[-136.2307457,52.003468],[-129.406906,52.0470712],[-125.2192777,52.0625262],[-120.8680013,52.0422204],[-117.3698897,52.0471706],[-113.3858473,52.0687081],[-110.1157983,52.0559769],[-105.7257016,52.054004],[-100.5252026,52.0435328],[-94.4411182,52.0262978],[-88.5626004,52.0575712],[-84.542311,52.0543008],[-79.3380562,52.0328387],[-73.4900913,52.0057617],[-69.9579592,52.0137245],[-66.3853772,52.0143383],[-63.2573713,52.0037827],[-60.3623456,51.9494106],[-54.8736641,51.9172342],[-51.0543203,51.90911],[-51.2465545,70.2484435]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Mr Mime/Mime Jr.","english":["Mr Mime","Mime Jr."],"german":["Pantimos","Pantimimi"],"geometry":{"type":"Polygon","coordinates":[[[-29.1405056,36.7850711],[-24.1671733,36.7784924],[-19.404602,36.7784924],[-14.6200562,36.7784924],[-10.5743409,36.7718924],[-7.9623413,36.7608913],[-6.7513612,36.7485787],[-5.5674779,36.7399849],[-4.79987,36.7291205],[-3.9561467,36.7178529],[-2.2391428,36.7040322],[-0.1730346,36.7124672],[4.2214966,36.7036596],[7.5723267,36.6948509],[12.9336548,36.6948509],[17.5369263,36.7124672],[21.0025277,36.7000656],[24.9964148,36.7326622],[28.7539673,36.7124672],[36.6531372,36.6948509],[43.1130982,36.7179913],[48.8699341,36.6948509],[53.0942195,36.6774152],[53.5557277,67.5813142],[47.9251099,67.6008493],[42.3220825,67.5547538],[37.0156861,67.5463631],[31.1929321,67.5337716],[25.8425904,67.5421667],[19.4155884,67.6050353],[12.9666138,67.6426763],[4.6060181,67.6593864],[-3.3082463,67.7418725],[-12.2909546,67.7261082],[-19.6847534,67.7011097],[-27.2323608,67.6802573],[-29.012146,67.7261082],[-29.1405056,36.7850711]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Bouffalant","english":["Bouffalant"],"german":["Bisofank"],"geometry":{"type":"Polygon","coordinates":[[[-73.8062973,42.7501784],[-77.7804633,42.7497062],[-77.7805706,38.299451],[-69.6122202,38.2765677],[-69.5682748,42.7692939],[-73.8062973,42.7501784]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Klefki","english":["Klefki"],"german":["Clavion"],"geometry":{"type":"Polygon","coordinates":[[[4.9043716,51.1396041],[2.5811475,51.1555567],[0.2602515,51.1479171],[-0.327061,51.139914],[-0.3253782,51.0626544],[-0.3194154,50.5075184],[-1.0124062,50.4947919],[-2.3486183,50.0100913],[-4.9414772,48.7116759],[-4.9854226,42.1948049],[-2.7442117,42.1948049],[-0.2832742,42.2110815],[0.8072301,42.2147195],[1.2569872,42.2171207],[1.4637488,42.5194975],[1.5735335,42.5176965],[1.9020399,42.2095219],[2.7709251,42.1948049],[8.5497337,42.3249009],[8.359721,49.6485873],[4.9043716,51.1396041]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Comfey","english":["Comfey"],"german":["Curelei"],"geometry":{"type":"Polygon","coordinates":[[[-160.9057817,23.0554244],[-161.015645,23.0503699],[-161.0376177,22.2239737],[-161.0705767,20.772501],[-161.0705767,19.0682984],[-161.081563,17.5560065],[-160.0598345,17.5036259],[-158.4887896,17.493148],[-156.4343462,17.493148],[-154.4018755,17.5350561],[-152.7539263,17.5560065],[-152.7978716,18.9020792],[-152.7868853,20.4434354],[-152.8198442,22.0204229],[-152.8198442,23.0857474],[-154.116231,23.0857474],[-155.2697954,23.0958536],[-156.5112505,23.0857474],[-158.1042681,23.0958536],[-159.4775591,23.0655328],[-160.9057817,23.0554244]]]}},{"folder":"Type 2 [Habitat-Based Regionals]","name":"Corsola/Pa’u Oricorio","english":["Corsola","Pa’u Oricorio"],"german":["Corasonn","Choreogel (Hula)"],"geometry":{"type":"Polygon","coordinates":[[[-9.8730602,31.1405201],[-15.9403397,30.9844594],[-20.189579,30.8801952],[-23.802537,30.9342908],[-28.64567,31.0092758],[-34.0963484,30.8901409],[-39.426738,30.828582],[-44.6014742,30.9156176],[-49.6031406,30.8120615],[-53.3472016,30.8296243],[-55.8638853,30.818043],[-58.8068607,30.7929712],[-61.8283727,30.7815837],[-64.1057336,30.8240551],[-66.2843656,30.8256618],[-68.3964003,30.8415856],[-71.1216886,30.8648288],[-73.8922327,30.9036423],[-76.6061928,30.9021854],[-79.6780482,30.930443],[-82.1168898,30.932255],[-84.2487434,30.9835443],[-86.8523484,30.9883056],[-89.2438965,31.0050124],[-91.0297149,31.0043649],[-92.8164803,31.0011573],[-94.2435175,30.9957742],[-95.4522558,30.9903655],[-97.4799473,30.9876793],[-98.7757055,30.9959298],[-100.9234648,27.0096587],[-100.0400649,22.3826332],[-101.2687294,20.9937268],[-104.2592833,24.474896],[-106.8102442,27.8625293],[-111.2273666,31.0519459],[-115.3513697,31.081647],[-117.3939438,31.0874676],[-119.1984618,31.1222558],[-122.3722559,31.1319945],[-126.1960924,31.1624648],[-131.4947178,31.1922318],[-139.8822028,31.2843323],[-145.4591375,31.2839777],[-155.2020422,31.312575],[-162.7126005,31.3995877],[-167.4612609,31.3617441],[-171.4315472,31.2318951],[-176.4400706,31.2135856],[179.1692626,31.173936],[174.0524992,31.2160826],[165.4890964,31.0286072],[160.4342741,30.9597223],[155.5141738,30.8661785],[150.0901759,30.8175575],[145.3815998,30.8292284],[141.4061321,30.8501124],[137.6676859,30.8552472],[133.9763724,30.866859],[130.1320517,30.895796],[126.6151981,30.9277537],[123.9974778,30.9565044],[121.7315405,30.9774533],[119.9762153,30.9791843],[119.4822065,29.2348055],[117.928279,27.1142978],[116.4967885,25.9576725],[115.2193979,24.7522335],[113.7492959,24.1417649],[111.7776431,23.7140653],[109.8817007,23.561248],[92.7431808,24.0928872],[90.3978269,24.4591837],[87.6307239,24.7685212],[85.6999548,24.1574274],[73.7226059,24.2159078],[72.0647136,24.9659701],[67.6514684,27.1955854],[62.3471546,27.9932575],[60.1037347,27.9522144],[57.2315282,28.561835],[54.176727,29.1549615],[52.5606432,31.0079201],[49.7380794,30.8439855],[44.7438127,30.7820179],[45.9741178,27.5570092],[48.768518,23.3022446],[52.2153465,21.1561647],[55.5309196,22.2955058],[54.6632579,20.3844527],[51.0451227,18.8237121],[45.8143578,16.948764],[44.8821521,18.0995502],[41.6638374,22.5410451],[38.6189052,26.0933813],[36.8434551,28.4869537],[35.258142,29.7517315],[33.5406249,31.1790328],[30.3539301,31.0598979],[27.6323001,31.1174246],[26.362672,31.192921],[23.704193,31.2472629],[21.0012214,31.2715175],[18.3919199,31.2726521],[15.8626621,31.2437797],[13.82018,31.2426341],[9.9582717,31.0975627],[11.8449804,30.8195168],[13.3757519,30.502565],[14.3954242,29.6490472],[16.1912139,29.0631292],[18.7789897,28.0479114],[20.6440146,28.0554983],[22.2545047,29.2621584],[22.8185884,30.4967223],[25.1016404,29.5437103],[28.9783511,28.8947811],[30.1158967,28.0202289],[32.0642181,23.9313349],[34.230276,20.1698059],[36.2115913,16.0309512],[41.2219555,8.5632616],[43.3809818,7.3593591],[44.090565,5.6629187],[40.0646189,2.7352649],[36.3951438,0.2568017],[35.8592962,-2.3905462],[36.8831946,-11.1572569],[37.0007472,-13.8184392],[33.8380723,-16.7348841],[31.7758851,-19.553338],[32.6872899,-22.6865188],[30.9055821,-23.9340014],[30.0281674,-25.7798741],[33.9431073,-25.8378162],[37.2509118,-25.8407001],[40.8028922,-25.8473073],[43.9081896,-25.8941862],[45.6245026,-25.9193263],[47.6947949,-25.9561292],[49.4898176,-25.9353591],[53.3486982,-25.9739475],[55.2132596,-26.0123918],[59.2452843,-26.0220039],[62.6465338,-26.011137],[66.299694,-25.8854081],[69.3405539,-25.9684893],[72.9738702,-25.7732303],[77.8478919,-25.7889412],[87.2241138,-25.9011762],[92.5305345,-26.1447776],[97.3919282,-26.2469562],[101.4153377,-26.0607277],[105.6521469,-26.1545034],[109.3609172,-26.1413373],[113.6090926,-26.0635771],[114.9633694,-26.0691184],[114.8896323,-22.9591519],[119.7889378,-21.3915166],[123.6841364,-17.9149865],[126.9228351,-15.9903977],[130.6806572,-15.9714886],[134.9236675,-15.5879592],[138.1647282,-17.6821249],[141.3681879,-18.4767463],[145.5715547,-18.7497148],[148.0921879,-21.7502209],[150.6500166,-24.1988793],[151.853642,-25.8026412],[153.0472339,-27.0721797],[156.873194,-27.0393387],[160.3934371,-27.0391951],[164.3315572,-27.1710527],[168.1206229,-27.1942641],[172.1627062,-27.0857387],[176.9902805,-26.9382684],[-172.2956982,-27.2560217],[-165.4342248,-27.0839054],[-157.1180891,-27.3828246],[-147.7651953,-27.2019117],[-133.7622327,-26.9706395],[-119.5669501,-26.7038461],[-106.9411339,-26.5642586],[-92.7051728,-26.6555626],[-82.2009483,-26.491401],[-77.0479595,-26.3582221],[-74.4724702,-26.3506146],[-70.4805681,-26.2021512],[-67.730384,-26.0516216],[-67.2426696,-22.0095771],[-67.699906,-16.22921],[-70.7117075,-13.7030529],[-74.6058639,-8.351967],[-76.3632214,-4.3242599],[-75.0591351,0.4602624],[-72.9448494,5.2373984],[-69.6291923,6.7288898],[-65.9274051,6.6565043],[-62.3645572,5.0828222],[-59.3131786,3.5354593],[-55.7854924,1.0547215],[-53.7318478,-1.1392688],[-50.8845203,-3.4198878],[-46.2468024,-4.6854824],[-37.4326971,-5.0147754],[-31.4062199,-5.0241429],[-25.30721,-5.0119669],[-18.7225409,-4.987044],[-13.3548468,-5.0002811],[-9.8725249,-4.8987376],[1.5368346,-4.5982864],[11.3112549,-4.4354411],[12.3565641,-4.4150876],[10.1557311,-1.0447361],[11.0848511,2.5290932],[10.1852768,5.8438644],[7.0741069,7.6479433],[2.7268913,9.0455965],[-4.4269965,6.9624321],[-10.0933303,9.2060823],[-12.0053514,11.0537785],[-12.8358667,13.4404954],[-13.1039698,14.3954109],[-13.110911,16.2011545],[-13.2036401,21.3364108],[-13.0046678,22.6730186],[-12.0904078,24.3326327],[-11.6732044,25.3200941],[-9.7877374,26.3047469],[-9.8730602,31.1405201]]]}},{"folder":"Type 2 [Habitat-Based Regionals]","name":"Carnivine","english":["Carnivine"],"german":["Venuflibis"],"geometry":{"type":"Polygon","coordinates":[[[-87.0406486,36.638558],[-87.2245764,24.8972135],[-79.8857092,24.777572],[-75.0956701,24.7775719],[-75.0216056,36.5591767],[-79.6907951,36.5503515],[-84.4039299,36.576824],[-87.0406486,36.638558]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Indian Ocean","english":["Indian Ocean"],"german":["Indian Ocean"],"geometry":{"type":"Polygon","coordinates":[[[52.8222675,1.9332268],[52.03125,-61.7731229],[59.765625,-61.7731229],[66.796875,-61.9389504],[74.53125,-61.9389504],[82.7929688,-61.9389505],[91.7578125,-61.7731229],[101.25,-61.7731229],[108.6328125,-61.6063964],[111.796875,-61.522695],[111.9561768,1.7067483],[103.0078125,1.7575368],[92.109375,1.9771466],[83.3203125,2.1088987],[76.3561664,2.0794282],[69.8737758,2.1060142],[61.2597656,1.9771466],[52.8222675,1.9332268]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Malay Archipelago","english":["Malay Archipelago"],"german":["Malay Archipelago"],"geometry":{"type":"Polygon","coordinates":[[[112.0222351,20.8938841],[111.6210938,-11.0921659],[118.1733601,-10.983058],[123.75,-11.0059045],[130.078125,-10.833306],[135.703125,-10.660608],[139.7460938,-10.9196178],[139.7460978,20.9614396],[133.7695333,20.9614396],[128.5620178,20.9409197],[123.0249063,20.9203969],[117.8173868,20.8177411],[112.0222351,20.8938841]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Greenland","english":["Greenland"],"german":["Greenland"],"geometry":{"type":"Polygon","coordinates":[[[-62.8899613,29.0921022],[-56.8652344,29.0753752],[-48.8671875,28.9216313],[-37.8768593,29.0766214],[-28.1397269,29.1436267],[-28.0780564,67.6930404],[-22.2964334,67.6464554],[-13.2877821,67.6968464],[-0.4255646,67.7617242],[9.4021206,67.6848782],[19.0294378,67.6281471],[27.8880865,67.5133968],[36.5751531,67.5613206],[44.9819703,67.5219765],[53.5529811,67.5813142],[51.9433614,85.0288468],[41.2207071,85.0359415],[29.8828125,85.0511288],[21.4453125,85.0207077],[11.6015625,85.0511288],[4.1524615,85.0806101],[-5.625,85.0511288],[-15.46875,85.0511288],[-23.203125,85.0207077],[-31.640625,85.0511288],[-39.2983701,85.0620929],[-49.5703125,85.0207077],[-56.25,85.0435409],[-62.9296875,85.0511288],[-62.8899613,29.0921022]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Eastern Pacific","english":["Eastern Pacific"],"german":["Eastern Pacific"],"geometry":{"type":"Polygon","coordinates":[[[-129.7049052,51.9163929],[-139.0429687,51.7270282],[-147.7001953,51.9442648],[-156.796875,52.0524905],[-172.7929687,51.5087425],[-177.1899046,51.6927994],[178.7695373,51.3443387],[179.4726563,-12.8546489],[-156.7749163,-13.132979],[-156.4453165,-50.0641918],[-143.0859375,-50.7364551],[-129.0234375,-50.7364552],[-129.7049052,51.9163929]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Western Pacific","english":["Western Pacific"],"german":["Western Pacific"],"geometry":{"type":"Polygon","coordinates":[[[178.7695373,51.3443387],[173.2763793,51.2344073],[167.3437521,51.3443387],[159.8730489,51.179343],[154.2476615,50.6799],[154.4676551,21.0836313],[139.7460958,20.9614396],[139.7460958,-0.5273363],[154.2480489,-0.3955047],[154.2919962,-12.8010882],[166.7147588,-12.8679333],[179.4726563,-12.8546489],[178.7695373,51.3443387]]]}},{"folder":"Type 1 [Geographical Regionals] (Future Region Predictions)","name":"Arctic","english":["Arctic"],"german":["Arctic"],"geometry":{"type":"Polygon","coordinates":[[[59.5656778,67.66648],[87.206391,67.5169917],[105.1411255,67.9642187],[123.4321834,67.9628762],[144.7952752,67.9310079],[154.8191355,68.0714537],[169.1494251,68.0950643],[-179.3346701,68.0662897],[-163.0147619,67.9028756],[-145.1916138,67.9678554],[-122.2691713,67.8123225],[-99.0510473,67.8127055],[-87.3749088,67.8100953],[-71.3334416,68.0944105],[-54.1980242,68.1040319],[-34.9641471,67.9635529],[-16.1833516,68.0693841],[-3.3109929,67.7418725],[6.8686002,68.0725594],[19.4128418,67.6050353],[37.0129395,67.5463631],[59.5656778,67.66648]]]}},{"folder":"Geoblock Region","name":"China Geoblock","english":["China Geoblock"],"german":["China Geoblock"],"geometry":{"type":"Polygon","coordinates":[[[118.599704,24.325883],[120.228212,24.0531],[120.395501,26.623242],[124.833977,26.249418],[124.361565,38.044059],[124.85595,38.044059],[125.482171,37.357356],[128.811028,39.550936],[98.408684,46.114308],[97.771477,44.975614],[96.431145,45.037754],[96.079582,43.877239],[94.255852,43.924735],[94.124016,42.693673],[85.12409,31.214182],[84.992254,28.624521],[87.27741,28.605232],[87.299382,27.811356],[92.682683,28.04432],[94.748113,29.316549],[96.37409,29.220711],[96.615789,28.566643],[97.714422,28.508734],[97.604558,23.676191],[100.59284,21.127004],[101.581609,22.939646],[104.503972,22.838434],[104.679754,23.625874],[106.789129,23.162048],[106.613347,21.842603],[114.090645,20.859728],[114.137337,21.872605],[113.474257,22.046109],[113.482031,22.258102],[113.592581,22.330529],[113.773842,22.469042],[113.94825,22.448102],[113.95855,22.515989],[114.041671,22.504941],[114.049224,22.502245],[114.055233,22.503118],[114.05755,22.505734],[114.057722,22.509382],[114.059352,22.513346],[114.062013,22.515329],[114.065189,22.516994],[114.068966,22.517152],[114.072055,22.517945],[114.074459,22.520244],[114.077841,22.529056],[114.079472,22.530563],[114.082004,22.531038],[114.084364,22.532109],[114.086896,22.534011],[114.088398,22.536192],[114.091531,22.537064],[114.093806,22.536271],[114.096123,22.534289],[114.097968,22.534289],[114.102346,22.534804],[114.104105,22.535121],[114.107667,22.533694],[114.109126,22.531356],[114.111787,22.529492],[114.114276,22.530523],[114.115993,22.531554],[114.116036,22.532902],[114.116422,22.534091],[114.117237,22.534447],[114.119297,22.534527],[114.120628,22.535478],[114.121786,22.537262],[114.125134,22.538926],[114.130687,22.541551],[114.138841,22.543216],[114.144248,22.54171],[114.14545,22.540838],[114.14854,22.542027],[114.148368,22.543374],[114.1506,22.546228],[114.151716,22.546704],[114.151458,22.547497],[114.150342,22.54718],[114.14957,22.548448],[114.149827,22.550905],[114.151544,22.550905],[114.15163,22.554948],[114.15635,22.554393],[114.159354,22.560576],[114.161586,22.562002],[114.163474,22.559228],[114.166049,22.559307],[114.167508,22.561368],[114.169654,22.561051],[114.170942,22.559387],[114.176521,22.560179],[114.177551,22.558515],[114.177722,22.555582],[114.181156,22.554234],[114.181842,22.555582],[114.18682,22.554551],[114.187078,22.555978],[114.195747,22.55582],[114.196433,22.557326],[114.201412,22.557564],[114.201669,22.556216],[114.207248,22.556533],[114.20905,22.557246],[114.213428,22.554948],[114.217977,22.555978],[114.221238,22.553045],[114.222097,22.55146],[114.227247,22.547814],[114.225616,22.545673],[114.226474,22.544167],[114.23716,22.545356],[114.246601,22.556097],[114.24952,22.5536],[114.299461,22.563223],[114.312164,22.578916],[114.426035,22.561983],[114.430155,22.389402],[114.511179,22.381783],[114.512553,21.760733],[114.144511,21.870378],[114.100848,20.857276],[118.451434,20.033746],[118.599704,24.325883]]]}},{"folder":"Confirmed Spawn Points","name":"Pansage Spawn","english":["Pansage Spawn"],"german":["Pansage Spawn"],"geometry":{"type":"Point","coordinates":[90.4858278,56.2348717]}},{"folder":"Confirmed Spawn Points","name":"Pansear Spawn","english":["Pansear Spawn"],"german":["Pansear Spawn"],"geometry":{"type":"Point","coordinates":[82.9378939,55.009464]}},{"folder":"Type 1 [Geographical Regionals]","name":"Hawlucha","english":["Hawlucha"],"german":["Resladero"],"geometry":{"type":"Polygon","coordinates":[[[-117.4,32.7],[-114.8,32.7],[-110.5,31.4],[-106.5,31.8],[-103.0,29.0],[-100.0,28.7],[-99.5,27.5],[-97.4,25.9],[-97.2,21.5],[-94.8,18.5],[-92.0,18.5],[-90.4,21.5],[-86.7,21.5],[-86.7,19.5],[-87.5,17.8],[-88.3,17.8],[-89.2,17.5],[-91.4,16.0],[-92.2,14.5],[-95.5,16.2],[-100.0,16.7],[-104.3,19.5],[-105.5,20.0],[-106.5,23.2],[-108.5,22.5],[-110.3,22.7],[-110.5,23.5],[-112.5,27.0],[-114.5,29.5],[-115.5,30.5],[-116.5,31.5],[-117.4,32.7]]]}},{"folder":"Type 1 [Geographical Regionals]","name":"Stonjourner","english":["Stonjourner"],"german":["Humanolith"],"geometry":{"type":"Polygon","coordinates":[[[-7.6,55.2],[-5.5,54.3],[-6.0,50.0],[-3.0,50.6],[0.5,50.9],[1.8,52.5],[0.0,53.7],[-1.5,55.0],[-1.7,56.0],[-2.0,57.7],[-3.5,58.7],[-5.0,58.6],[-6.5,58.0],[-7.5,57.0],[-6.4,55.9],[-5.3,54.8],[-7.6,55.2]]]}}]`,
);

// Hemispheric regionals not covered by a KMZ polygon. Two families:
//   - Type 3 paired (Zangoose/Seviper, Lunatone/Solrock) + Type 4 hemispheric
//     (Sawk/Throh, Heatmor/Durant) — KMZ ships only a LineString. Species
//     assignments here track the current Niantic rotation; update when Niantic
//     announces a swap (Leek Duck / GO Hub post the day-of). Last verified May 2026.
//   - Fixed hemispheric (Volbeat/Illumise + Ultra Beasts). No rotation —
//     Volbeat/Illumise + Stakataka/Blacephalon ride the same E/W L-line,
//     Celesteela/Kartana ride a N/S split at the equator.
// Polygons add intermediate vertices along the top/bottom edges so every
// consecutive lon step stays under 180° — otherwise unwrapRing flips the
// polygon inside-out across the antimeridian.

// Exact KMZ "Type 3 [Paired Regional Line]" vertices, traced top→south so the
// polygons below can splice them in either order without resampling. Source:
// POGO_REGIONS_KMZ entry of the same name (community KMZ by u/zoglandboy /
// u/Mattman243 / pokemoncalendar.com). DO NOT round — these are the canonical
// dividing-line coordinates and anyone right on the Mediterranean coast or in
// eastern Iran lands differently for a tenth of a degree.
const PAIRED_LINE_VERTICES = [
	[-29.0478436, 85.0397427],
	[-29.1357322, 33.3213485],
	[-21.3835305, 33.3385554],
	[-14.5557243, 33.3327905],
	[-6.5154841, 33.496424],
	[1.1645508, 33.5413946],
	[9.3965509, 33.5230259],
	[17.5122071, 33.3947592],
	[26.916504, 33.3764123],
	[36.2400056, 33.3935447],
	[43.59375, 33.4497766],
	[49.5074177, 33.4598794],
	[54.5800781, 33.4864354],
	[53.437502, -85.0207077],
];
const PAIRED_LINE_REV = [...PAIRED_LINE_VERTICES].reverse();
const PAIRED_LINE = {
	// Europe (above the line from -29°W to +54°E) + Asia + Oceania (east of the
	// line from +54°E south). Traces the KMZ vertices, then wraps back via the
	// antimeridian. Intermediate vertices on the top edge keep every consecutive
	// lon step under 180°.
	east: [...PAIRED_LINE_VERTICES, [180, -85], [180, 85], [90, 85], [0, 85], PAIRED_LINE_VERTICES[0]],
	// Complement: Americas + Greenland (west of the line above 33°N) + Africa +
	// S. Atlantic (west of the line below 33°N). Walks the KMZ line bottom→top
	// (so winding stays consistent), then wraps back via the antimeridian.
	west: [...PAIRED_LINE_REV, [-180, 85], [-180, -85], [-100, -85], [-30, -85], PAIRED_LINE_REV[0]],
};
// KMZ Chatot polygon top edge, traced verbatim. Used as the canonical N/S
// boundary for hemispheric Ultra Beasts (Celesteela south / Kartana north)
// so the dividing line matches the same KMZ source as everything else.
// Slight variation (±0.01°) — DO NOT round.
const EQUATOR_KMZ_VERTICES = [
	[-180, -0.0655574],
	[-120.5886795, -0.0690087],
	[-28.6095949, -0.0750637],
	[78.4737327, -0.0655574],
	[145.7979514, -0.0655574],
	[180, -0.0655574],
];
const EQUATOR_KMZ_VERTICES_REV = [...EQUATOR_KMZ_VERTICES].reverse();
const EQUATOR_SPLIT = {
	// Northern hemisphere — above the Chatot top edge to lat 85.
	north: [...EQUATOR_KMZ_VERTICES, [180, 85], [90, 85], [0, 85], [-90, 85], [-180, 85], EQUATOR_KMZ_VERTICES[0]],
	// Southern hemisphere — below the Chatot top edge to lat -85.
	south: [
		...EQUATOR_KMZ_VERTICES_REV,
		[-180, -85],
		[-90, -85],
		[0, -85],
		[90, -85],
		[180, -85],
		EQUATOR_KMZ_VERTICES_REV[0],
	],
};
// Iberian Peninsula ring — used standalone for Paldean Combat AND as a hole in
// the "Eastern minus Iberian" polygon below so Paldean Blaze auto-drops for
// Europe/Asia/Oceania users except in Iberian (where Combat takes priority).
const IBERIAN_RING = [
	[-9.6, 43.8], // NW Spain (Galicia)
	[-1.8, 43.5], // Bay of Biscay (Bilbao)
	[0.5, 42.9], // Pyrenees / Andorra
	[3.3, 42.5], // NE Spain (Costa Brava)
	[0.2, 39.0], // Valencia
	[-0.9, 37.6], // SE Spain
	[-2.0, 36.7], // Almeria
	[-5.4, 36.0], // Gibraltar
	[-7.4, 37.0], // S Portugal (Faro)
	[-9.0, 37.0], // SW Portugal (Sagres)
	[-9.6, 38.5], // Lisbon coast (Cabo Espichel)
	[-9.6, 41.0], // W Portugal coast
	[-9.0, 43.0], // NW Portugal
	[-9.6, 43.8], // close
];

// Squawkabilly's Green/Blue plumage split runs along the LITERAL prime
// meridian (0° longitude) — NOT the paired/hemispheric KMZ L-line above.
// London straddles it; Madrid and Lisbon land WEST (Blue side). Intermediate
// vertices keep every consecutive lon step under 180° for the antimeridian
// unwrap in pointInRegionGeom.
const PRIME_MERIDIAN_SPLIT = {
	east: [
		[0, 85],
		[90, 85],
		[180, 85],
		[180, -85],
		[90, -85],
		[0, -85],
		[0, 85],
	],
	west: [
		[0, 85],
		[0, -85],
		[-90, -85],
		[-180, -85],
		[-180, 85],
		[-90, 85],
		[0, 85],
	],
};

const POGO_REGIONS_ROTATING = [
	{
		folder: 'Type 4 [Hemispheric E/W, prime meridian] (manually maintained)',
		name: 'Eastern Hemisphere (0° meridian) — Green Plumage Squawkabilly',
		english: ['Green Plumage Squawkabilly'],
		german: ['Krawalloro (Grünfedrig)'],
		// Yellow + White Plumage spawn worldwide, so they carry no polygon —
		// only the two region-locked plumages appear on the map.
		geometry: { type: 'Polygon', coordinates: [PRIME_MERIDIAN_SPLIT.east] },
	},
	{
		folder: 'Type 4 [Hemispheric E/W, prime meridian] (manually maintained)',
		name: 'Western Hemisphere (0° meridian) — Blue Plumage Squawkabilly',
		english: ['Blue Plumage Squawkabilly'],
		german: ['Krawalloro (Blaufedrig)'],
		geometry: { type: 'Polygon', coordinates: [PRIME_MERIDIAN_SPLIT.west] },
	},
	{
		folder: 'Type 3/4 [Paired/Hemispheric] (E side, manually maintained)',
		name: 'Eastern paired/hemispheric (Europe + Asia + Oceania)',
		english: ['Zangoose', 'Sawk', 'Solrock', 'Heatmor', 'Volbeat', 'Stakataka'],
		german: ['Sengo', 'Karadonis', 'Sonnfel', 'Furnifraß', 'Volbeat', 'Muramura'],
		// Paired/hemispheric species DO cover Iberian per the canonical table —
		// Madrid catches Sengo/Karadonis/etc. locally. No Iberian carve-out here.
		geometry: { type: 'Polygon', coordinates: [PAIRED_LINE.east] },
	},
	{
		folder: 'Type 4 [Paldean Blaze region] (manually maintained)',
		name: 'Eastern Hemisphere minus Iberian — Paldean Tauros (Blaze)',
		english: [],
		german: [],
		// Paldean Blaze (Fighting/Fire) is locally caught throughout Eastern
		// Hemisphere EXCEPT Iberian Peninsula, where Combat takes priority. The
		// Iberian ring sits as an inner ring (hole) so Madrid/Lisbon land in the
		// outer-but-not-inner band and don't drop Blaze protection.
		typeChecks: [{ species: 'Tauros', type: 'fire' }],
		geometry: { type: 'Polygon', coordinates: [PAIRED_LINE.east, IBERIAN_RING] },
	},
	{
		folder: 'Type 3/4 [Paired/Hemispheric] (W side, manually maintained)',
		name: 'Western paired/hemispheric (Americas + Africa)',
		english: ['Seviper', 'Throh', 'Lunatone', 'Durant', 'Illumise', 'Blacephalon'],
		german: ['Vipitis', 'Jiutesto', 'Lunastein', 'Fermicula', 'Illumise', 'Kopplosio'],
		// Paldean Tauros (Aqua, Fighting/Water) — western hemisphere local. No
		// sub-regional carve-out for the Americas (the base Tauros region IS
		// inside, but base Tauros uses {Tauros, normal} not {Tauros, water}, so
		// there's no typeCheck conflict — both drop independently for a NY user).
		typeChecks: [{ species: 'Tauros', type: 'water' }],
		geometry: { type: 'Polygon', coordinates: [PAIRED_LINE.west] },
	},
	{
		folder: 'Ultra Beast [Hemispheric N/S] (manually maintained)',
		name: 'Northern Hemisphere Ultra Beast',
		english: ['Kartana'],
		german: ['Katagami'],
		geometry: { type: 'Polygon', coordinates: [EQUATOR_SPLIT.north] },
	},
	{
		folder: 'Ultra Beast [Hemispheric N/S] (manually maintained)',
		name: 'Southern Hemisphere Ultra Beast',
		english: ['Celesteela'],
		german: ['Kaguron'],
		geometry: { type: 'Polygon', coordinates: [EQUATOR_SPLIT.south] },
	},
	{
		folder: 'Type 1 [Sub-regional] (manually maintained)',
		name: 'Iberian Peninsula — Paldean Tauros (Combat)',
		english: [],
		german: [],
		// Paldean Tauros (Combat, Fighting only) — Iberian-local. No bare-species
		// entry: the base "Tauros" lives as a typeCheck {Tauros, normal} in the
		// regionals group, region-aware via the Tauros KMZ polygon below.
		typeChecks: [{ species: 'Tauros', type: 'fighting' }],
		geometry: { type: 'Polygon', coordinates: [IBERIAN_RING] },
	},
];

// Inject form-by-type typeChecks onto specific KMZ entries so the bare-species
// collector for that region can be replaced with a region-aware typeCheck.
// Keyed by KMZ "name" field — see POGO_REGIONS_KMZ above.
const KMZ_TYPE_CHECKS = {
	// Base Tauros (Normal type) is local in the US+Canada Tauros polygon; this
	// lets us protect it via a typeCheck {Tauros, normal} in the regionals group
	// instead of a bare "Tauros" collector that would over-protect Paldean forms.
	Tauros: [{ species: 'Tauros', type: 'normal' }],
};
const POGO_REGIONS_KMZ_TAGGED = POGO_REGIONS_KMZ.map((r) =>
	KMZ_TYPE_CHECKS[r.name] ? { ...r, typeChecks: KMZ_TYPE_CHECKS[r.name] } : r,
);
// Exported for scripts/check-a11y-keyboard.mjs, which asserts the map's
// keyboard region-jump can produce a valid centroid for every region.
export const POGO_REGIONS = [...POGO_REGIONS_KMZ_TAGGED, ...POGO_REGIONS_ROTATING];

// ─── Coiffwaff (Furfrou) trim regions ──────────────────────────────────────
// The in-game form change (25 candy + 10,000 stardust) offers the
// region-locked trims only while you are PHYSICALLY inside the region — but
// the cut sticks when you fly home, which makes it a travel to-do just like
// tagging regionals for trade. Debutante/Diamond/Star ride the same Big-Three
// trio polygons as the lake guardians; La Reine reuses the Klefki (France)
// polygon. Japan (Kabuki) and Egypt (Pharaoh) have no KMZ polygon, so they
// get hand-drawn coastal rings — loose traces that stay clear of Busan,
// Ulleungdo, and Sakhalin on the Japan side and hug Egypt's borders + Sinai
// on the other. Good enough for a travel tip, not a border treaty.
// (Natural/Matron/Dandy are global and Heart is event-only — no polygons.)
const JAPAN_MAIN_RING = [
	[129.2, 32.0], // west of Kyushu
	[129.5, 34.75], // Tsushima Strait — east of Busan
	[131.2, 38.3], // Sea of Japan — east of Ulleungdo
	[136.0, 41.5],
	[139.4, 44.3],
	[141.9, 45.65], // La Pérouse Strait — south of Sakhalin
	[145.9, 44.4], // NE Hokkaido — inside the Kuril line
	[146.3, 42.3],
	[142.5, 35.5], // Pacific side
	[140.5, 32.5], // Izu Islands
	[136.0, 32.5],
	[130.8, 30.0], // south of Kyushu
	[129.2, 32.0],
];
const RYUKYU_RING = [
	[122.6, 23.9], // east of Taiwan (Yonaguni)
	[130.5, 26.5],
	[131.0, 28.6], // Amami Islands
	[128.0, 28.6],
	[122.6, 25.3],
	[122.6, 23.9],
];
const EGYPT_RING = [
	[24.7, 31.9], // Mediterranean coast, Libyan border
	[34.25, 31.3], // Sinai Mediterranean coast, short of Gaza
	[34.9, 29.6], // Gulf of Aqaba
	[34.9, 27.7],
	[36.9, 22.0], // Red Sea coast down to the Sudan line
	[24.7, 22.0], // southern border
	[24.7, 31.9],
];
const kmzGeometry = (name) => POGO_REGIONS_KMZ.find((r) => r.name === name)?.geometry || null;
const FURFROU_TRIM_REGIONS = [
	{ trim: 'debutante', geometry: kmzGeometry('Pom-Pom Oricorio/Yellow Flabébé/Panpour/Azelf') },
	{ trim: 'diamond', geometry: kmzGeometry('Baile Oricorio/Red Flabébé/Pansear/Mesprit') },
	{ trim: 'star', geometry: kmzGeometry('Sensu Oricorio/Blue Flabébé/Pansage/Uxie') },
	{ trim: 'lareine', geometry: kmzGeometry('Klefki') },
	{ trim: 'kabuki', geometry: { type: 'MultiPolygon', coordinates: [[JAPAN_MAIN_RING], [RYUKYU_RING]] } },
	{ trim: 'pharaoh', geometry: { type: 'Polygon', coordinates: [EGYPT_RING] } },
].filter((e) => e.geometry);

// Trim keys locally unlockable at a location. Exported so
// scripts/verify-regionals.mjs can pin the boundaries (Paris vs Berlin,
// Cairo vs Athens, Tokyo vs Seoul).
export function computeFurfrouTrims(lonLat) {
	if (!lonLat) return [];
	return FURFROU_TRIM_REGIONS.filter((e) => pointInRegionGeom(lonLat, e.geometry)).map((e) => e.trim);
}

// Which hemisphere home sits in — 'north' | 'south', or null with no home set.
// Reuses the EQUATOR_SPLIT polygons rather than a bare `lat >= 0` so it agrees
// with the app's own equator (PoGo's Chatot KMZ line sits a hair below 0°).
// Exported for the city-table checks in scripts/verify-regionals.mjs.
export function computeHomeHemisphere(homeLocation) {
	if (!homeLocation) return null;
	if (pointInRegionGeom(homeLocation, { type: 'Polygon', coordinates: [EQUATOR_SPLIT.north] })) return 'north';
	if (pointInRegionGeom(homeLocation, { type: 'Polygon', coordinates: [EQUATOR_SPLIT.south] })) return 'south';
	return null;
}

// Which seasonal form Sesokitz / Kronjuwild currently SPAWN as. The form is
// locked at catch and never re-rolls, so this only tells you which slot is
// fillable right now — it is a hint, never a filter term.
//
// Driven by the live in-game Season window from the events feed rather than
// hardcoded month bands: PoGo rotates Deerling with its Season, whose
// boundaries (e.g. 2 Jun – 8 Sep) don't line up with calendar months. The
// window's midpoint month names the season; the southern hemisphere is six
// months out of phase. Falls back to a plain meteorological band when no
// Season entry covers the date, so a stale feed degrades to roughly-right
// rather than to nothing.
const SEASON_BY_MONTH = [
	'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
	'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
];
const OPPOSITE_SEASON = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };

// Exported for the offline table checks in scripts/verify-regionals.mjs.
export function currentSeasonWindow(now, pools = EVENTS.eggPools || []) {
	const t = now.getTime();
	for (const pool of pools) {
		if (pool.category !== 'Season' || !pool.start || !pool.end) continue;
		const start = new Date(pool.start).getTime();
		const end = new Date(pool.end).getTime();
		if (Number.isNaN(start) || Number.isNaN(end) || t < start || t > end) continue;
		return { title: pool.title || null, start, end, mid: new Date((start + end) / 2) };
	}
	return null;
}

export function deerlingSeasonFor(now, hemisphere, pools = EVENTS.eggPools || []) {
	if (hemisphere !== 'north' && hemisphere !== 'south') return null;
	const window = currentSeasonWindow(now, pools);
	const northern = SEASON_BY_MONTH[(window ? window.mid : now).getMonth()];
	return hemisphere === 'north' ? northern : OPPOSITE_SEASON[northern];
}

// Exported so scripts/verify-regionals.mjs can run the exact production code
// path against the canonical regional table.
export function computeHomeLocals(homeLocation) {
	if (!homeLocation) return [];
	const out = new Set();
	for (const r of POGO_REGIONS) {
		if (r.geometry.type !== 'Polygon' && r.geometry.type !== 'MultiPolygon') continue;
		if (pointInRegionGeom(homeLocation, r.geometry)) {
			r.german.forEach((n) => out.add(n));
		}
	}
	return [...out];
}

// Locally-active typeCheck identities ({species, type} pairs) at home.
// Used to auto-drop region-specific form protections — e.g. Paldean Tauros
// (Combat = Fighting) is local on the Iberian Peninsula but remote elsewhere,
// so a Spanish user keeps protection on Blaze/Aqua but lets Combat go to trash.
export function computeHomeLocalTypeChecks(homeLocation) {
	if (!homeLocation) return [];
	const out = [];
	const seen = new Set();
	for (const r of POGO_REGIONS) {
		if (!r.typeChecks || r.typeChecks.length === 0) continue;
		if (r.geometry.type !== 'Polygon' && r.geometry.type !== 'MultiPolygon') continue;
		if (!pointInRegionGeom(homeLocation, r.geometry)) continue;
		for (const tc of r.typeChecks) {
			const key = `${tc.species}|${tc.type}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ species: tc.species, type: tc.type });
		}
	}
	return out;
}

const KEY_LASTPIN = 'pogo:lastpin';
const KEY_BAZAARTAGS = 'pogo:bazaartags';
const KEY_HOME = 'pogo:home';
const KEY_STEP = 'pogo:step';

// Module-level point-in-polygon (handles antimeridian via unwrap).
// Used by both the App (homeLocals computation) and RegionalMap (matches).
function unwrapRing(ring) {
	if (!ring || ring.length === 0) return ring;
	const out = [[ring[0][0], ring[0][1]]];
	for (let i = 1; i < ring.length; i++) {
		const prevLon = out[out.length - 1][0];
		let curLon = ring[i][0];
		const curLat = ring[i][1];
		while (curLon - prevLon > 180) curLon -= 360;
		while (curLon - prevLon < -180) curLon += 360;
		out.push([curLon, curLat]);
	}
	return out;
}
function shiftPointToRing(pt, ring) {
	if (!ring.length) return pt;
	let lonMin = ring[0][0],
		lonMax = ring[0][0];
	for (const p of ring) {
		if (p[0] < lonMin) lonMin = p[0];
		if (p[0] > lonMax) lonMax = p[0];
	}
	let [x, y] = pt;
	while (x < lonMin - 0.5 && x + 360 <= lonMax + 0.5) x += 360;
	while (x > lonMax + 0.5 && x - 360 >= lonMin - 0.5) x -= 360;
	return [x, y];
}
function pointInRing(pt, ring) {
	const [x, y] = pt;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
			inside = !inside;
		}
	}
	return inside;
}
function pointInRegionGeom(pt, geom) {
	// GeoJSON Polygon: coordinates[0] is the outer ring, coordinates[1..] are holes.
	// Point is "inside" iff it's inside the outer ring AND not inside any hole.
	if (geom.type === 'Polygon') {
		const rings = geom.coordinates;
		if (!rings.length) return false;
		const outer = unwrapRing(rings[0]);
		if (!pointInRing(shiftPointToRing(pt, outer), outer)) return false;
		for (let i = 1; i < rings.length; i++) {
			const hole = unwrapRing(rings[i]);
			if (pointInRing(shiftPointToRing(pt, hole), hole)) return false;
		}
		return true;
	}
	if (geom.type === 'MultiPolygon') {
		for (const poly of geom.coordinates) {
			if (!poly.length) continue;
			const outer = unwrapRing(poly[0]);
			if (!pointInRing(shiftPointToRing(pt, outer), outer)) continue;
			let inHole = false;
			for (let i = 1; i < poly.length; i++) {
				const hole = unwrapRing(poly[i]);
				if (pointInRing(shiftPointToRing(pt, hole), hole)) {
					inHole = true;
					break;
				}
			}
			if (!inHole) return true;
		}
		return false;
	}
	return false;
}

// Inline TopoJSON → GeoJSON decoder (avoids needing topojson-client as a dep)
function decodeTopo(topology, objectName) {
	const obj = topology.objects[objectName];
	const { scale, translate } = topology.transform;
	const arcs = topology.arcs.map((arc) => {
		let x = 0,
			y = 0;
		return arc.map((d) => {
			x += d[0];
			y += d[1];
			return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
		});
	});
	const resolveArc = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
	const ringPoints = (refs) => {
		const out = [];
		refs.forEach((r, i) => {
			const seg = resolveArc(r);
			if (i === 0) out.push(...seg);
			else out.push(...seg.slice(1));
		});
		return out;
	};
	const procGeom = (g) => {
		if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.arcs.map(ringPoints) };
		if (g.type === 'MultiPolygon')
			return { type: 'MultiPolygon', coordinates: g.arcs.map((rs) => rs.map(ringPoints)) };
		return null;
	};
	return {
		type: 'FeatureCollection',
		features: obj.geometries
			.map((g) => ({ type: 'Feature', id: g.id, properties: g.properties || {}, geometry: procGeom(g) }))
			.filter((f) => f.geometry),
	};
}

// ─── UI ───────────────────────────────────────────────────────────────────

export default function App() {
	const { t, locale, outputLocale } = useTranslation();
	const announce = useAnnounce();
	const [hundos, setHundos] = useState(DEFAULT_HUNDOS);
	const [luckies, setLuckies] = useState(DEFAULT_LUCKIES);
	const [topAttackers, setTopAttackers] = useState(DEFAULT_TOP_ATTACKERS);
	const [topMaxAttackers, setTopMaxAttackers] = useState(DEFAULT_TOP_MAX_ATTACKERS);
	const [config, setConfig] = useState(DEFAULT_CONFIG);
	const [newHundo, setNewHundo] = useState('');
	const [newLucky, setNewLucky] = useState('');
	const [newTopAttacker, setNewTopAttacker] = useState('');
	const [newTopMaxAttacker, setNewTopMaxAttacker] = useState('');
	const [newMyth, setNewMyth] = useState('');
	const [newKeeper, setNewKeeper] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [onboarded, setOnboarded] = useState(false);
	const [showSetTheory, setShowSetTheory] = useState(false);
	const [showAuxShadows, setShowAuxShadows] = useState(false);
	const [showAuxEvos, setShowAuxEvos] = useState(false);
	const [showBrowseSort, setShowBrowseSort] = useState(false);
	const [showAuxTrades, setShowAuxTrades] = useState(false);
	const [showFriendWishlist, setShowFriendWishlist] = useState(false);
	// Friend lucky wishlist: restrict to old catches guaranteed Lucky on trade.
	// (The curated friend-collect list's equivalent toggle lives in config as
	// `friendCollectGuaranteedOnly` — it's a persisted curation setting.)
	const [friendGuaranteedLucky, setFriendGuaranteedLucky] = useState(false);
	const [showAuxMegas, setShowAuxMegas] = useState(false);
	const [showAuxEvents, setShowAuxEvents] = useState(false);
	const [showAuxRaids, setShowAuxRaids] = useState(false);
	const [showAuxMaxBattles, setShowAuxMaxBattles] = useState(false);
	const [showAuxRocket, setShowAuxRocket] = useState(false);
	const [showAuxPvp, setShowAuxPvp] = useState(false);
	const [showRawClauses, setShowRawClauses] = useState(false);
	const [showVerify, setShowVerify] = useState(false);
	const [currentStep, setCurrentStep] = useState(1);
	const [view, setView] = useState(viewFromHash);
	useEffect(() => {
		const onHashChange = () => {
			setView(viewFromHash());
			// If the hash points at a specific workshop step, sync currentStep.
			const step = stepFromHash();
			if (step !== null) setCurrentStep(step);
		};
		window.addEventListener('hashchange', onHashChange);
		// Run once on mount so #workshop/<key> on initial load picks up the step.
		onHashChange();
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);
	// Quietly request persistent storage the first time the user enters the
	// workshop in a session. Skip the call when already-persisted (don't burn
	// a prompt on a no-op) and skip the landing-page view (the user hasn't
	// committed to using the app yet — no point asking). Failures stay
	// silent; the Settings → "browser storage" row is the visible fallback
	// for retry. The browser caches its decision per-origin, so subsequent
	// sessions won't re-prompt once granted or denied.
	const persistRequestedRef = useRef(false);
	useEffect(() => {
		if (view !== 'workshop') return;
		if (persistRequestedRef.current) return;
		persistRequestedRef.current = true;
		if (!navigator.storage?.persist || !navigator.storage?.persisted) return;
		if (isIOSNonStandalone()) return;
		(async () => {
			try {
				const already = await navigator.storage.persisted();
				if (already) return;
				await navigator.storage.persist();
			} catch {
				/* user can retry via Settings */
			}
		})();
	}, [view]);
	const [homeLocation, setHomeLocation] = useState(null); // [lon, lat] — drives defaults
	const [lastPin, setLastPin] = useState(null); // [lon, lat] — inspector
	const [bazaarTags, setBazaarTags] = useState([]);
	const [copied, setCopied] = useState({
		trash: false,
		trade: false,
		sort: false,
		luckySort: false,
		luckyFamilySort: false,
		nundoSort: false,
		prestaged: false,
		gift: false,
		// Aux pro-tools
		tradedTrashSort: false,
		shadowCheap: false,
		shadowSafe: false,
		shadowHundoCandidates: false,
		shadowFrustration: false,
		evoSwapCandy: false,
		evoSwapItem: false,
		cheapEvolve: false,
		dexPlus: false,
		megaEvolve: false,
		pilotLong: false,
	});
	const [resetArmed, setResetArmed] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	// Regionals added to the user's protections by the catalog sync in
	// mergeImportedConfig on this load — non-empty triggers the one-time popup.
	const [regionalNotices, setRegionalNotices] = useState([]);
	// Hundos just added via the adder that are ALSO protected regionals — the
	// popup explains that protection wins and where the opt-out lives.
	const [hundoRegionalNotice, setHundoRegionalNotice] = useState([]);
	// Curated friend-collect targets newly covered by a step-3 hundo/lucky add.
	const [friendCollectCoveredNotice, setFriendCollectCoveredNotice] = useState([]);
	const [showChangelog, setShowChangelog] = useState(false);
	// Number of changelog entries the user has already opened the panel for —
	// drives the "new" dot on the footer link.
	const [changelogSeen, setChangelogSeen] = useState(CHANGELOG.length);
	useEffect(() => {
		if (!resetArmed) return;
		const t = setTimeout(() => setResetArmed(false), 3000);
		return () => clearTimeout(t);
	}, [resetArmed]);

	// Load from storage once
	useEffect(() => {
		(async () => {
			const h = await loadJSON(KEY_HUNDOS, DEFAULT_HUNDOS);
			const l = await loadJSON(KEY_LUCKIES, DEFAULT_LUCKIES);
			const ta = await loadJSON(KEY_TOP_ATTACKERS, DEFAULT_TOP_ATTACKERS);
			const tma = await loadJSON(KEY_TOP_MAX_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS);
			const c = await loadJSON(KEY_CONFIG, DEFAULT_CONFIG);
			const home = await loadJSON(KEY_HOME, null);
			const p = await loadJSON(KEY_LASTPIN, null);
			const b = await loadJSON(KEY_BAZAARTAGS, []);
			const step = await loadJSON(KEY_STEP, 1);
			const ob = await loadJSON(KEY_ONBOARDED, false);
			const clSeen = await loadJSON(KEY_CHANGELOG_SEEN, 0);
			setHundos(h);
			const catalogNotices = [];
			setConfig(mergeImportedConfig(c, catalogNotices));
			if (catalogNotices.length > 0) setRegionalNotices(catalogNotices);
			setChangelogSeen(clSeen);
			const canonicalize = (arr) => (arr || []).map((s) => resolveSpecies(s) || s);
			setLuckies(canonicalize(l));
			setTopAttackers(canonicalize(ta));
			setTopMaxAttackers(canonicalize(tma));
			setHomeLocation(home);
			setLastPin(p);
			setBazaarTags(b);
			setCurrentStep(step);
			setOnboarded(ob);
			setLoaded(true);
			// First-run: nudge brand-new visitors into the swipe onboarding instead
			// of the marketing landing. Only when they actually arrived at "" (not a
			// shared deep link), and only once — we flip the flag immediately so a
			// reload or a later visit goes straight to the normal front door.
			if (!ob && viewFromHash() === 'landing') {
				setOnboarded(true);
				if (typeof window !== 'undefined') window.location.hash = '#onboard';
			}
		})();
	}, []);

	// Persist on change
	useEffect(() => {
		if (loaded) saveJSON(KEY_HUNDOS, hundos);
	}, [hundos, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_LUCKIES, luckies);
	}, [luckies, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_TOP_ATTACKERS, topAttackers);
	}, [topAttackers, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_TOP_MAX_ATTACKERS, topMaxAttackers);
	}, [topMaxAttackers, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_CONFIG, config);
	}, [config, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_HOME, homeLocation);
	}, [homeLocation, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_LASTPIN, lastPin);
	}, [lastPin, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_BAZAARTAGS, bazaarTags);
	}, [bazaarTags, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_STEP, currentStep);
	}, [currentStep, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_ONBOARDED, onboarded);
	}, [onboarded, loaded]);
	useEffect(() => {
		if (loaded) saveJSON(KEY_CHANGELOG_SEEN, changelogSeen);
	}, [changelogSeen, loaded]);

	// ── Multi-instance safety ────────────────────────────────────────────────
	// Every persist effect above writes its slice whole, and state is read from
	// localStorage exactly once at mount — so a second tab or a suspended PWA
	// window holds stale state in memory, and its next save silently reverts
	// anything changed elsewhere since it loaded ("XL and costumed came back").
	// Two listeners close the gap:
	//   - 'storage' applies keys as OTHER live tabs write them (a tab never
	//     receives events for its own writes, so these are genuinely remote)
	//   - visibility/pageshow re-hydrates a waking instance from disk before
	//     the user can interact — suspended pages don't get storage events
	// Per-key last-write-wins remains, which is fine: the failure mode was
	// whole-slice clobber from stale memory, not field-level races.
	// KEY_STEP is deliberately NOT synced — wizard position is per-tab.
	useEffect(() => {
		if (!loaded) return undefined;
		const canonicalize = (arr) => (arr || []).map((s) => resolveSpecies(s) || s);
		const apply = (key, value) => {
			switch (key) {
				case KEY_HUNDOS:
					setHundos(Array.isArray(value) ? value : DEFAULT_HUNDOS);
					break;
				case KEY_LUCKIES:
					setLuckies(canonicalize(Array.isArray(value) ? value : DEFAULT_LUCKIES));
					break;
				case KEY_TOP_ATTACKERS:
					setTopAttackers(canonicalize(Array.isArray(value) ? value : DEFAULT_TOP_ATTACKERS));
					break;
				case KEY_TOP_MAX_ATTACKERS:
					setTopMaxAttackers(canonicalize(Array.isArray(value) ? value : DEFAULT_TOP_MAX_ATTACKERS));
					break;
				case KEY_CONFIG:
					// mergeImportedConfig is idempotent, so the echo write settles:
					// re-merging an already-merged config emits the same JSON and
					// same-value setItem calls fire no further storage events.
					setConfig(mergeImportedConfig(value));
					break;
				case KEY_HOME:
					setHomeLocation(value ?? null);
					break;
				case KEY_LASTPIN:
					setLastPin(value ?? null);
					break;
				case KEY_BAZAARTAGS:
					setBazaarTags(Array.isArray(value) ? value : []);
					break;
				case KEY_ONBOARDED:
					setOnboarded(value === true);
					break;
				case KEY_CHANGELOG_SEEN:
					setChangelogSeen(typeof value === 'number' ? value : 0);
					break;
				default:
					break;
			}
		};
		const onStorage = (e) => {
			if (e.storageArea !== localStorage || !e.key || e.newValue == null) return;
			try {
				apply(e.key, JSON.parse(e.newValue));
			} catch {
				/* foreign or corrupt value — ignore */
			}
		};
		// Full re-hydrate for a waking instance. The tab was idle while
		// suspended, so there are no in-flight local edits to race with.
		const rehydrate = async () => {
			apply(KEY_HUNDOS, await loadJSON(KEY_HUNDOS, DEFAULT_HUNDOS));
			apply(KEY_LUCKIES, await loadJSON(KEY_LUCKIES, DEFAULT_LUCKIES));
			apply(KEY_TOP_ATTACKERS, await loadJSON(KEY_TOP_ATTACKERS, DEFAULT_TOP_ATTACKERS));
			apply(KEY_TOP_MAX_ATTACKERS, await loadJSON(KEY_TOP_MAX_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS));
			apply(KEY_CONFIG, await loadJSON(KEY_CONFIG, DEFAULT_CONFIG));
			apply(KEY_HOME, await loadJSON(KEY_HOME, null));
			apply(KEY_LASTPIN, await loadJSON(KEY_LASTPIN, null));
			apply(KEY_BAZAARTAGS, await loadJSON(KEY_BAZAARTAGS, []));
			apply(KEY_ONBOARDED, await loadJSON(KEY_ONBOARDED, false));
			apply(KEY_CHANGELOG_SEEN, await loadJSON(KEY_CHANGELOG_SEEN, 0));
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') rehydrate();
		};
		const onPageShow = (e) => {
			if (e.persisted) rehydrate(); // restored from bfcache with old memory
		};
		window.addEventListener('storage', onStorage);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pageshow', onPageShow);
		return () => {
			window.removeEventListener('storage', onStorage);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pageshow', onPageShow);
		};
	}, [loaded]);

	// Locals at home location (drives auto-drop from Regionals protection + bazaar suggestions)
	const homeLocals = useMemo(() => computeHomeLocals(homeLocation), [homeLocation]);
	const homeLocalTypeChecks = useMemo(() => computeHomeLocalTypeChecks(homeLocation), [homeLocation]);

	// Build effective config: home-locals get auto-removed from collector protections
	// across ALL regional groups (so e.g. Sengo in collectibles also gets dropped if Bonn is home).
	const effectiveConfig = useMemo(() => {
		if (!homeLocals.length || !config.regionalGroups) return config;
		const newGroups = { ...config.regionalGroups };
		let changed = false;
		for (const [groupKey, groupDef] of Object.entries(REGIONAL_GROUPS)) {
			const groupState = newGroups[groupKey];
			if (!groupState || !groupState.enabled) continue;
			const baseList = groupDef.collectors;
			const explicitlyEnabled = groupState.collectorsEnabled === null ? baseList : groupState.collectorsEnabled;
			const filtered = explicitlyEnabled.filter((sp) => !homeLocals.includes(sp));
			if (filtered.length !== explicitlyEnabled.length) {
				newGroups[groupKey] = { ...groupState, collectorsEnabled: filtered };
				changed = true;
			}
		}
		if (!changed) return config;
		return { ...config, regionalGroups: newGroups };
	}, [config, homeLocals]);

	// Season inference lives HERE, not in buildFilters: it reads the clock, and a
	// clock inside the pure filter function would make the golden fixture
	// non-deterministic. It only ever highlights a slot and renders a note.
	const homeHemisphere = useMemo(() => computeHomeHemisphere(homeLocation), [homeLocation]);
	const seasonWindow = useMemo(() => currentSeasonWindow(new Date()), []);
	// The note only appears when a seasonal species is actually on a have-list.
	const seasonRelevant = useMemo(
		() => [...(hundos || []), ...(luckies || [])].some((sp) => invisibleSlotsFor(sp)?.axis === 'season'),
		[hundos, luckies],
	);
	const activeSeason = useMemo(() => {
		if (effectiveConfig.seasonOverride) return effectiveConfig.seasonOverride;
		if (effectiveConfig.seasonAuto === false) return null;
		return deerlingSeasonFor(new Date(), homeHemisphere);
	}, [effectiveConfig.seasonOverride, effectiveConfig.seasonAuto, homeHemisphere]);

	// Output locale: follows UI locale unless expert mode is on and the user
	// explicitly picked a different one (e.g. their PoGo client is set to a
	// different language than their browser).
	const effectiveOutputLocale = effectiveConfig.expertMode ? outputLocale : locale;
	const {
		trash,
		tradedTrashSort,
		trade,
		sort,
		luckySort,
		luckyFamilySort,
		nundoSort,
		prestaged,
		gift,
		buddyCatchFilters,
		TE_full,
		TE_trim,
		luckyHundoSet,
		friendLuckyWishlist,
		friendLuckyWishlistGuaranteed,
		friendHundoWishlist,
		friendCollectMode,
		friendCollectTargets,
		friendCollectWishlist,
		friendCollectWishlistGuaranteed,
		friendCollectSuggestions,
		trashClauses,
		tradeClauses,
		sortClauses,
		luckySortClauses,
		luckyFamilySortClauses,
		nundoSortClauses,
		prestagedClauses,
		giftClauses,
		shadowCheap,
		shadowSafe,
		shadowHundoCandidates,
		shadowFrustration,
		evoSwapCandy,
		evoSwapItem,
		cheapEvolve,
		dexPlus,
		megaEvolve,
		pilotLong,
		shadowCheapClauses,
		shadowSafeClauses,
		shadowHundoClauses,
		shadowFrustrationClauses,
		evoSwapCandyClauses,
		evoSwapItemClauses,
		cheapEvolveClauses,
		dexPlusClauses,
		megaEvolveClauses,
		pilotLongClauses,
		raidFilters,
		eventRaidFilters,
		maxBattleFilters,
		raidBossesFetchedAt,
		maxTank,
		eventFilters,
		eventsFetchedAt,
		rocketLeaders,
		rocketTypedGrunts,
		rocketGenericGrunts,
		rocketLineupsFetchedAt,
		rocketTypeLabels,
		pvpFilters,
		pvpRankingsFetchedAt,
		pvpMetaPacks,
		cupFilters,
	} = useMemo(
		() =>
			buildFilters(
				hundos,
				luckies,
				{ ...effectiveConfig, topAttackers, topMaxAttackers },
				homeLocals,
				effectiveOutputLocale,
				t,
				homeLocalTypeChecks,
				bazaarTags,
			),
		[
			hundos,
			luckies,
			effectiveConfig,
			homeLocals,
			homeLocalTypeChecks,
			effectiveOutputLocale,
			topAttackers,
			topMaxAttackers,
			bazaarTags,
			t,
		],
	);

	// Newly-added haves that touch curated friend-collect targets → purple
	// popup (mirrors the regional-hundo notice pattern below). `added` holds
	// canonical storage-locale names, same shape as config.friendCollectSpecies,
	// so plain equality works. Under 'both' focus a one-goal add is reported as
	// partial progress (target stays in the string until the other goal lands).
	function detectFriendCollectCovered(added, goal) {
		const curated = new Set(config.friendCollectSpecies || []);
		if (curated.size === 0) return [];
		const mode = ['hundo', 'both'].includes(config.friendCollectMode) ? config.friendCollectMode : 'lucky';
		if (goal === 'hundo' && mode === 'lucky') return [];
		if (goal === 'lucky' && mode === 'hundo') return [];
		const otherSet = new Set(goal === 'hundo' ? luckies : hundos);
		// Mirror buildFilters' gender gate so the popup can't claim coverage the
		// filter itself won't grant. Badges are click-only, so a freshly typed
		// entry is unannotated (→ covered, unchanged); but an IMPORTED config can
		// carry an annotation before its have-entry exists, which makes this
		// reachable.
		const genderSatisfied = (ann, sp) => {
			const wanted = (config.friendCollectGenders || {})[sp];
			if (wanted !== 'male' && wanted !== 'female') return true;
			const owned = ann?.[sp];
			return !Array.isArray(owned) || owned.length === 0 || owned.includes(wanted);
		};
		const thisAnn = goal === 'hundo' ? config.hundoGenders : config.luckyGenders;
		const otherAnn = goal === 'hundo' ? config.luckyGenders : config.hundoGenders;
		const notices = [];
		for (const sp of added) {
			if (!curated.has(sp)) continue;
			if (!genderSatisfied(thisAnn, sp)) continue;
			const nowFullyCovered =
				mode === 'both' ? otherSet.has(sp) && genderSatisfied(otherAnn, sp) : true;
			notices.push({ species: sp, goal, nowFullyCovered });
		}
		return notices;
	}

	function addHundo() {
		// Accept comma/space/semicolon-separated lists. Each token can be:
		// - a dex number (e.g. "1", "201", "0666")
		// - an English name (e.g. "Bulbasaur", "venusaur")
		// - a German name (e.g. "bisasam", "Bisaflor")
		// Resolves each to canonical lowercase German via resolveSpecies().
		const tokens = newHundo.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const set = new Set(hundos);
		const unresolved = [];
		const added = [];
		for (const tok of tokens) {
			const resolved = resolveSpecies(tok);
			if (resolved) {
				if (!set.has(resolved)) added.push(resolved);
				set.add(resolved);
			} else {
				unresolved.push(tok);
			}
		}
		setHundos([...set].sort());
		// A hundo of a protected regional does NOT surface its duplicates (the
		// regional clauses win) — tell the user right away instead of letting
		// them wonder why the dupes never showed up in trash.
		const regionalAdds = added
			.map((sp) => ({ species: sp, groups: regionalProtectionsFor(sp, config) }))
			.filter((x) => x.groups.length > 0);
		if (regionalAdds.length > 0) setHundoRegionalNotice(regionalAdds);
		const covered = detectFriendCollectCovered(added, 'hundo');
		if (covered.length > 0) setFriendCollectCoveredNotice(covered);
		if (unresolved.length > 0) {
			// Keep unresolved tokens in the input so the user sees what didn't match
			setNewHundo(unresolved.join(', '));
		} else {
			setNewHundo('');
		}
	}
	function removeHundo(h) {
		setHundos(hundos.filter((x) => x !== h));
		// Shed the form annotation with the entry (config map keys must not
		// outlive their have-list species).
		// Shed EVERY annotation with the entry, in ONE setConfig: each call
		// spreads the closure's `config`, so two sequential calls would drop the
		// first one's edit on the floor.
		setConfig((prev) => {
			const next = { ...prev };
			if (prev.hundoForms?.[h]) next.hundoForms = omitKey(prev.hundoForms, h);
			if (prev.hundoGenders?.[h]) next.hundoGenders = omitKey(prev.hundoGenders, h);
			if (prev.hundoSlots?.[h]) next.hundoSlots = omitKey(prev.hundoSlots, h);
			return next;
		});
	}
	function addLucky() {
		// Same parser as addHundo: comma/space/semicolon-split, multi-locale
		// species resolution, dupes silently ignored, unresolved tokens kept
		// in the input so the user can fix typos.
		const tokens = newLucky.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const set = new Set(luckies);
		const unresolved = [];
		const added = [];
		for (const tok of tokens) {
			const resolved = resolveSpecies(tok);
			if (resolved) {
				if (!set.has(resolved)) added.push(resolved);
				set.add(resolved);
			} else unresolved.push(tok);
		}
		setLuckies([...set].sort());
		const covered = detectFriendCollectCovered(added, 'lucky');
		if (covered.length > 0) setFriendCollectCoveredNotice(covered);
		setNewLucky(unresolved.length > 0 ? unresolved.join(', ') : '');
	}
	function removeLucky(s) {
		setLuckies(luckies.filter((x) => x !== s));
		// Same single-call rule as removeHundo above.
		setConfig((prev) => {
			const next = { ...prev };
			if (prev.luckyForms?.[s]) next.luckyForms = omitKey(prev.luckyForms, s);
			if (prev.luckyGenders?.[s]) next.luckyGenders = omitKey(prev.luckyGenders, s);
			if (prev.luckySlots?.[s]) next.luckySlots = omitKey(prev.luckySlots, s);
			return next;
		});
	}
	function addTopAttacker() {
		// Same parser as addHundo: comma/space/semicolon-split, multi-locale
		// species resolution, dupes silently ignored, unresolved tokens kept
		// in the input so the user can fix typos.
		const tokens = newTopAttacker.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const set = new Set(topAttackers);
		const unresolved = [];
		for (const tok of tokens) {
			const resolved = resolveSpecies(tok);
			if (resolved) set.add(resolved);
			else unresolved.push(tok);
		}
		setTopAttackers([...set].sort());
		setNewTopAttacker(unresolved.length > 0 ? unresolved.join(', ') : '');
	}
	function removeTopAttacker(s) {
		setTopAttackers(topAttackers.filter((x) => x !== s));
	}
	function addTopMaxAttacker() {
		const tokens = newTopMaxAttacker.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const set = new Set(topMaxAttackers);
		const unresolved = [];
		for (const tok of tokens) {
			const resolved = resolveSpecies(tok);
			if (resolved) set.add(resolved);
			else unresolved.push(tok);
		}
		setTopMaxAttackers([...set].sort());
		setNewTopMaxAttacker(unresolved.length > 0 ? unresolved.join(', ') : '');
	}
	function removeTopMaxAttacker(s) {
		setTopMaxAttackers(topMaxAttackers.filter((x) => x !== s));
	}
	// Generic add/remove for config-held species lists (mythTooManyOf,
	// shadowKeeperSpecies). Mirrors addHundo/addTopAttacker but writes back
	// through setConfig so the value persists alongside other config.
	function addToConfigList(fieldKey, raw, setRaw) {
		const tokens = raw.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const next = new Set(config[fieldKey] || []);
		const unresolved = [];
		for (const tok of tokens) {
			const r = resolveSpecies(tok);
			if (r) next.add(r);
			else unresolved.push(tok);
		}
		setConfig({ ...config, [fieldKey]: [...next].sort() });
		setRaw(unresolved.length > 0 ? unresolved.join(', ') : '');
	}
	function removeFromConfigList(fieldKey, item) {
		setConfig({ ...config, [fieldKey]: (config[fieldKey] || []).filter((x) => x !== item) });
	}
	function copyToClipboard(which, text) {
		// Robust copy: try modern clipboard API, fall back to legacy execCommand,
		// surface errors so user knows to manually select.
		// Every copy in the app funnels through here, so announcing at this one
		// point covers all 35 call sites. The visible feedback is a 2s icon+label
		// swap on the button, which a screen reader never reports: pressing Copy
		// used to produce complete silence either way.
		const flash = (state) => {
			setCopied((p) => ({ ...p, [which]: state }));
			setTimeout(() => setCopied((p) => ({ ...p, [which]: false })), 2000);
			announce(
				state === 'ok' ? t('app.a11y.announce.copied') : t('app.a11y.announce.copy_failed'),
				// A failed copy needs acting on (select the text manually), so it
				// interrupts; a success is a confirmation and can wait.
				{ assertive: state !== 'ok' },
			);
		};

		// Modern clipboard API — but it can throw or reject in iframes without permission
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard
				.writeText(text)
				.then(() => flash('ok'))
				.catch(() => (fallbackCopy(text) ? flash('ok') : flash('err')));
			return;
		}
		// Legacy fallback
		if (fallbackCopy(text)) flash('ok');
		else flash('err');
	}
	function fallbackCopy(text) {
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch {
			return false;
		}
	}
	function resetAll() {
		if (!resetArmed) {
			setResetArmed(true);
			// The most destructive action in the app — it drops the hundo list, every
			// protection, tags and home location. Arming it only turned the button
			// red and swapped its label, which a screen reader never reported.
			announce(`${t('app.modal.danger.reset_button')} — ${t('app.modal.danger.reset_armed')}`, {
				assertive: true,
			});
			return;
		}
		setHundos(DEFAULT_HUNDOS);
		setLuckies(DEFAULT_LUCKIES);
		setTopAttackers(DEFAULT_TOP_ATTACKERS);
		setTopMaxAttackers(DEFAULT_TOP_MAX_ATTACKERS);
		// DEFAULT_CONFIG is a PRE-migration blob: regionalGroups is {} and
		// enabledTradeEvos is []. Only mergeImportedConfig back-fills them, and it
		// runs on the load and import paths — not here. Assigning it raw left the
		// app in a state the load path can never produce, dropping every regional
		// and trade-evo guard from the filter (89 clauses) while ConfigPanel still
		// rendered them as active, until the next reload.
		setConfig(mergeImportedConfig(DEFAULT_CONFIG));
		setHomeLocation(null);
		setLastPin(null);
		setBazaarTags([]);
		setResetArmed(false);
		setShowSettings(false);
	}

	// Build the export envelope from current React state. Reads from React
	// (not localStorage) so a mid-edit export captures the live values.
	function buildExportEnvelope() {
		return {
			schema: 'pogo-filter-workshop/v1',
			exportedAt: new Date().toISOString(),
			data: {
				hundos,
				luckies,
				topAttackers,
				topMaxAttackers,
				config,
				homeLocation,
				bazaarTags,
			},
		};
	}
	// Trigger a JSON file download. Synchronous — no preview, no confirm,
	// since exporting is non-destructive. Returns the filename used.
	function exportState() {
		const envelope = buildExportEnvelope();
		const today = new Date().toISOString().slice(0, 10);
		const filename = `pogo-filter-workshop-${today}.json`;
		const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		return filename;
	}
	// Apply a previously-validated import envelope to React state. The
	// pure prepareImport helper does the migration / canonicalization and
	// returns only the keys it could parse; we then thread each one to its
	// setter. Keeping the shape filtering pure keeps the import path
	// testable without a React tree.
	function applyImportEnvelope(envelope) {
		const prepared = prepareImport(envelope);
		if ('hundos' in prepared) setHundos(prepared.hundos);
		if ('luckies' in prepared) setLuckies(prepared.luckies);
		if ('topAttackers' in prepared) setTopAttackers(prepared.topAttackers);
		if ('topMaxAttackers' in prepared) setTopMaxAttackers(prepared.topMaxAttackers);
		if ('config' in prepared) setConfig(prepared.config);
		if ('homeLocation' in prepared) setHomeLocation(prepared.homeLocation);
		if ('bazaarTags' in prepared) setBazaarTags(prepared.bazaarTags);
	}

	// Onboarding → workshop hand-off. completeOnboarding applies the swipe
	// decisions (a patch of protect* booleans) onto the live config and drops
	// the user straight on the filter-output step; skip just bails to the
	// workshop with defaults. Both set the first-run flag so it won't re-show.
	function completeOnboarding(patch, dest = 'filter') {
		if (patch && Object.keys(patch).length) {
			setConfig((prev) => ({ ...prev, ...patch, lastAppliedPreset: null }));
		}
		setOnboarded(true);
		// Drop into the workshop on the chosen step — "filter" for instant payoff,
		// or "where" to pin the home location on the map. The hashchange listener
		// resolves the hash to view=workshop + the matching currentStep.
		const stepKey = dest === 'where' ? 'where' : 'filter';
		if (typeof window !== 'undefined') window.location.hash = `#workshop/${stepKey}`;
	}
	function skipOnboarding() {
		setOnboarded(true);
		navigateView('workshop');
	}

	// Step navigation helpers — labels/descs translated at render time
	const steps = [
		{ n: 1, key: 'where', label: t('app.step.where.label'), desc: t('app.step.where.desc') },
		{ n: 2, key: 'what', label: t('app.step.what.label'), desc: t('app.step.what.desc') },
		{ n: 3, key: 'have', label: t('app.step.have.label'), desc: t('app.step.have.desc') },
		{ n: 4, key: 'filter', label: t('app.step.filter.label'), desc: t('app.step.filter.desc') },
	];
	function gotoStep(n) {
		setCurrentStep(n);
		// When in the workshop view, push the step-specific hash so the URL
		// is shareable. Other views (e.g. landing) just update internal state.
		if (view === 'workshop') {
			const key = STEP_KEY_BY_NUMBER[n];
			if (key) {
				const desired = `#workshop/${key}`;
				if (typeof window !== 'undefined' && window.location.hash !== desired) {
					window.location.hash = desired;
				}
			}
		}
	}

	return (
		<div
			className='min-h-screen bg-[#0F1419] text-[#E6EDF3]'
			style={{
				fontFamily:
					"'IBM Plex Sans', 'IBM Plex Sans Devanagari', 'IBM Plex Sans JP', 'Noto Sans TC', sans-serif",
			}}
		>
			<style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Devanagari:wght@400;500;600&family=IBM+Plex+Sans+JP:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
        /* Browser glyph fallback walks the family list until it finds one with
           the requested codepoint. Latin text stays in IBM Plex Sans; HI/JA/
           zh-TW fall through to the script-specific Plex/Noto faces. */
        body { font-family: 'IBM Plex Sans', 'IBM Plex Sans Devanagari', 'IBM Plex Sans JP', 'Noto Sans TC', sans-serif; }
        .mono { font-family: 'JetBrains Mono', 'IBM Plex Sans Devanagari', 'IBM Plex Sans JP', 'Noto Sans TC', monospace; }
        .grid-bg {
          background-image:
            linear-gradient(rgba(94,175,197,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(94,175,197,0.04) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        details > summary { list-style: none; cursor: pointer; }
        details > summary::-webkit-details-marker { display: none; }
        .chip-enter { animation: chipIn 0.18s ease-out; }
        @keyframes chipIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>

			{view === 'landing' && <Landing onNavigate={navigateView} />}
			{view === 'onboard' && (
				<SwipeOnboarding onComplete={completeOnboarding} onSkip={skipOnboarding} onNavigate={navigateView} />
			)}
			{view === 'general' && <General onNavigate={navigateView} />}
			{view === 'regional' && <Regional onNavigate={navigateView} />}
			{view === 'trade' && <Trade onNavigate={navigateView} />}
			{view === 'rules' && <Rules onNavigate={navigateView} />}
			{view === 'algebra' && <Algebra onNavigate={navigateView} />}

			{view === 'workshop' && (
				<div className='grid-bg min-h-screen'>
					{/* Container matches the explainer's ChapterShell (max-w-4xl,
            px-4 sm:px-6, py-6 sm:py-8) so the brand mark + nav-bar sit at
            the same X/Y across landing, every chapter, and the workshop. */}
					<div className='max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8'>
						{/* HEADER — same brand mark as the explainer chapters, but tabs
              are workshop steps and the primary action returns to the
              explainer landing. */}
						<WorkshopNav
							currentStepKey={STEP_KEY_BY_NUMBER[currentStep]}
							onStepClick={(key) => gotoStep(STEP_NUMBER_BY_KEY[key])}
							onSettingsClick={() => setShowSettings(true)}
							onNavigate={navigateView}
						/>
						<div className='mb-6' />

						{/* STEP 1 — WHERE */}
						{currentStep === 1 && (
							<StepWrapper
								title={t('app.step.where.title')}
								hint={t('app.step.where.hint')}
								onNext={() => gotoStep(2)}
								nextLabel={t('app.step.where.next_label')}
							>
								<RegionalMap
									lastPin={lastPin}
									setLastPin={setLastPin}
									bazaarTags={bazaarTags}
									setBazaarTags={setBazaarTags}
									homeLocation={homeLocation}
									setHomeLocation={setHomeLocation}
									homeLocals={homeLocals}
									tradeTagName={config.basarTagName || 'Trade'}
								/>
							</StepWrapper>
						)}

						{/* STEP 2 — WHAT */}
						{currentStep === 2 && (
							<StepWrapper
								title={t('app.step.what.title')}
								hint={t('app.step.what.hint')}
								onBack={() => gotoStep(1)}
								onNext={() => gotoStep(3)}
								nextLabel={t('app.step.what.next_label')}
							>
								<ConfigPanel
									config={config}
									setConfig={setConfig}
									homeLocals={homeLocals}
									homeLocalTypeChecks={homeLocalTypeChecks}
									friendCollectTargets={friendCollectTargets}
									friendCollectSuggestions={friendCollectSuggestions}
									pvpMetaPacks={pvpMetaPacks}
								/>
							</StepWrapper>
						)}

						{/* STEP 3 — HAVE */}
						{currentStep === 3 && (
							<StepWrapper
								title={t('app.step.have.title')}
								hint={t('app.step.have.hint')}
								onBack={() => gotoStep(2)}
								onNext={() => gotoStep(4)}
								nextLabel={t('app.step.have.next_label')}
							>
								<div className='space-y-12'>
									<div>
										<h3 className='mono text-xs uppercase tracking-widest text-[#5EAFC5] font-semibold mb-4'>
											{t('app.step.have.section_completions')}
										</h3>
										<HundosEditor
											hundos={hundos}
											setHundos={setHundos}
											newHundo={newHundo}
											setNewHundo={setNewHundo}
											addHundo={addHundo}
											removeHundo={removeHundo}
											formsAnn={config.hundoForms || {}}
											onFormsAnnChange={(next) => setConfig({ ...config, hundoForms: next })}
											gendersAnn={config.hundoGenders || {}}
											onGendersAnnChange={(next) => setConfig({ ...config, hundoGenders: next })}
											slotsAnn={config.hundoSlots || {}}
											onSlotsAnnChange={(next) => setConfig({ ...config, hundoSlots: next })}
											activeSlot={activeSeason}
										/>
										<hr className='my-8 border-[#1F2933]' />
										<SpeciesListEditor
											items={luckies}
											newItem={newLucky}
											setNewItem={setNewLucky}
											addItem={addLucky}
											removeItem={removeLucky}
											titleKey='app.luckies'
											accent='#F5B82E'
											formsAnn={config.luckyForms || {}}
											onFormsAnnChange={(next) => setConfig({ ...config, luckyForms: next })}
											gendersAnn={config.luckyGenders || {}}
											onGendersAnnChange={(next) => setConfig({ ...config, luckyGenders: next })}
											slotsAnn={config.luckySlots || {}}
											onSlotsAnnChange={(next) => setConfig({ ...config, luckySlots: next })}
											activeSlot={activeSeason}
										/>
										<SeasonNote
											hemisphere={homeHemisphere}
											season={activeSeason}
											window={seasonWindow}
											auto={config.seasonAuto !== false}
											overridden={!!config.seasonOverride}
											relevant={seasonRelevant}
											onAuto={() => setConfig({ ...config, seasonAuto: true, seasonOverride: null })}
											onOverride={(sn) =>
												setConfig({
													...config,
													seasonOverride: config.seasonOverride === sn ? null : sn,
												})
											}
											t={t}
										/>
									</div>
									{effectiveConfig.expertMode && effectiveConfig.protectMythicals && (
										<div>
											<h3 className='mono text-xs uppercase tracking-widest text-[#5EAFC5] font-semibold mb-4'>
												{t('app.step.have.section_carve_outs')}
											</h3>
											<SpeciesListEditor
												items={config.mythTooManyOf || []}
												newItem={newMyth}
												setNewItem={setNewMyth}
												addItem={() => addToConfigList('mythTooManyOf', newMyth, setNewMyth)}
												removeItem={(s) => removeFromConfigList('mythTooManyOf', s)}
												titleKey='app.protect.myth_carve'
												accent='#E91E63'
											/>
										</div>
									)}
									{effectiveConfig.expertMode && (
										<div>
											<h3 className='mono text-xs uppercase tracking-widest text-[#5EAFC5] font-semibold mb-4'>
												{t('app.step.have.section_purify_policy')}
											</h3>
											<SpeciesListEditor
												items={config.shadowKeeperSpecies || []}
												newItem={newKeeper}
												setNewItem={setNewKeeper}
												addItem={() =>
													addToConfigList('shadowKeeperSpecies', newKeeper, setNewKeeper)
												}
												removeItem={(s) => removeFromConfigList('shadowKeeperSpecies', s)}
												titleKey='app.protect.shadow_keepers'
												accent='#9B59B6'
											/>
										</div>
									)}
									{effectiveConfig.expertMode && (
										<div>
											<h3 className='mono text-xs uppercase tracking-widest text-[#5EAFC5] font-semibold mb-4'>
												{t('app.step.have.section_raid_roster')}
											</h3>
											<SpeciesListEditor
												items={topAttackers}
												newItem={newTopAttacker}
												setNewItem={setNewTopAttacker}
												addItem={addTopAttacker}
												removeItem={removeTopAttacker}
												titleKey='app.top_attackers'
												accent='#5EAFC5'
											/>
											<hr className='my-8 border-[#1F2933]' />
											<SpeciesListEditor
												items={topMaxAttackers}
												newItem={newTopMaxAttacker}
												setNewItem={setNewTopMaxAttacker}
												addItem={addTopMaxAttacker}
												removeItem={removeTopMaxAttacker}
												titleKey='app.top_max_attackers'
												accent='#F39C12'
											/>
										</div>
									)}
								</div>
							</StepWrapper>
						)}

						{/* STEP 4 — FILTER */}
						{currentStep === 4 && (
							<StepWrapper
								title={t('app.step.filter.title')}
								hint={t('app.step.filter.hint')}
								onBack={() => gotoStep(3)}
							>
								<div className='space-y-6'>
									<FilterBox
										label={t('app.filter.trash_label')}
										accent='#E74C3C'
										filterStr={trash}
										copied={copied.trash}
										onCopy={() => copyToClipboard('trash', trash)}
										hint={t('app.filter.trash_hint')}
									/>
									<FilterBox
										label={t('app.filter.trade_label')}
										accent='#5EAFC5'
										filterStr={trade}
										copied={copied.trade}
										onCopy={() => copyToClipboard('trade', trade)}
										hint={t('app.filter.trade_hint')}
									/>
									{buddyCatchFilters.length > 0 && (
										<BuddyCatchSection
											buddyCatchFilters={buddyCatchFilters}
											copied={copied}
											onCopy={(key, text) => copyToClipboard(key, text)}
										/>
									)}

									{/* Summary stats */}
									<div className='grid grid-cols-2 md:grid-cols-4 gap-2 mono text-xs'>
										<StatBox
											label={t('app.stats.location')}
											value={
												homeLocation
													? `${homeLocation[1].toFixed(1)}°,${homeLocation[0].toFixed(1)}°`
													: '—'
											}
										/>
										<StatBox label={t('app.stats.hundos')} value={hundos.length} />
										<StatBox label={t('app.filter.trash_label')} value={`${trash.length}c`} />
										<StatBox label={t('app.filter.trade_label')} value={`${trade.length}c`} />
									</div>

									{/* Aux pro-tools — task-oriented filters grouped by game aspect.
                    Order: solo workflows (trades / evos / megas) first, then
                    PvE encounters grouped by source. Within each PvE group
                    the more frequently-used surface sits on top. */}
									<div className='space-y-3 pt-2'>
										{(sort || luckySort || luckyFamilySort || nundoSort) && (
											<Collapsible
												icon='✨'
												label={t('app.collapsible.browse_sort')}
												open={showBrowseSort}
												onToggle={() => setShowBrowseSort((s) => !s)}
											>
												<div className='space-y-4'>
													{sort && (
														<FilterBox
															label={t('app.filter.sort_label')}
															accent='#F5B82E'
															filterStr={sort}
															copied={copied.sort}
															onCopy={() => copyToClipboard('sort', sort)}
															hint={t('app.filter.sort_hint')}
														/>
													)}
													{luckySort && (
														<FilterBox
															label={t('app.filter.lucky_sort_label')}
															accent='#F5B82E'
															filterStr={luckySort}
															copied={copied.luckySort}
															onCopy={() => copyToClipboard('luckySort', luckySort)}
															hint={t('app.filter.lucky_sort_hint')}
														/>
													)}
													{luckyFamilySort && (
														<FilterBox
															label={t('app.filter.lucky_family_sort_label')}
															accent='#F5B82E'
															filterStr={luckyFamilySort}
															copied={copied.luckyFamilySort}
															onCopy={() => copyToClipboard('luckyFamilySort', luckyFamilySort)}
															hint={t('app.filter.lucky_family_sort_hint')}
														/>
													)}
													{nundoSort && (
														<FilterBox
															label={t('app.filter.nundo_sort_label')}
															accent='#F5B82E'
															filterStr={nundoSort}
															copied={copied.nundoSort}
															onCopy={() => copyToClipboard('nundoSort', nundoSort)}
															hint={t('app.filter.nundo_sort_hint')}
														/>
													)}
												</div>
											</Collapsible>
										)}
										<Collapsible
											icon='🛬'
											label={t('app.collapsible.aux_trades')}
											open={showAuxTrades}
											onToggle={() => setShowAuxTrades((s) => !s)}
										>
											<div className='space-y-4'>
												{prestaged && (
													<FilterBox
														label={t('app.filter.prestaged_label')}
														accent='#9B59B6'
														filterStr={prestaged}
														copied={copied.prestaged}
														onCopy={() => copyToClipboard('prestaged', prestaged)}
														hint={t('app.filter.prestaged_hint', {
															params: {
																tags: [
																	effectiveConfig.basarTagName,
																	effectiveConfig.fernTauschTagName,
																]
																	.filter(Boolean)
																	.map((tag) => `#${tag}`)
																	.join(', '),
															},
														})}
													/>
												)}
												{tradedTrashSort && (
													<FilterBox
														label={t('app.filter.traded_trash_sort_label')}
														accent='#E67E22'
														filterStr={tradedTrashSort}
														copied={copied.tradedTrashSort}
														onCopy={() =>
															copyToClipboard('tradedTrashSort', tradedTrashSort)
														}
														hint={t('app.filter.traded_trash_sort_hint')}
													/>
												)}
												{gift && (
													<FilterBox
														label={t('app.filter.gift_label')}
														accent='#27AE60'
														filterStr={gift}
														copied={copied.gift}
														onCopy={() => copyToClipboard('gift', gift)}
														hint={t('app.filter.gift_hint')}
													/>
												)}
												<FilterBox
													label={t('app.filter.pilot_long_label')}
													accent='#5EAFC5'
													filterStr={pilotLong}
													copied={copied.pilotLong}
													onCopy={() => copyToClipboard('pilotLong', pilotLong)}
													hint={t('app.filter.pilot_long_hint')}
												/>
											</div>
										</Collapsible>

										<Collapsible
											icon='🤝'
											label={t('app.collapsible.friend_wishlist')}
											open={showFriendWishlist}
											onToggle={() => setShowFriendWishlist((s) => !s)}
										>
											<div className='space-y-4'>
												{/* Curated "collect for me" string — renders alongside the
                            fallback wishlists below, since all friend-facing strings
                            live in this section. Its target list is edited in the
                            step-2 config panel. */}
												{friendCollectTargets.length > 0 &&
													(friendCollectWishlist ? (
														<div>
															<FilterBox
																label={t('app.filter.friend_collect_label')}
																accent='#27AE60'
																filterStr={
																	friendCollectMode === 'lucky' &&
																	effectiveConfig.friendCollectGuaranteedOnly
																		? friendCollectWishlistGuaranteed
																		: friendCollectWishlist
																}
																copied={copied.friendCollect}
																onCopy={() =>
																	copyToClipboard(
																		'friendCollect',
																		friendCollectMode === 'lucky' &&
																			effectiveConfig.friendCollectGuaranteedOnly
																			? friendCollectWishlistGuaranteed
																			: friendCollectWishlist,
																	)
																}
																hint={
																	friendCollectMode === 'lucky' &&
																	effectiveConfig.friendCollectGuaranteedOnly
																		? `${t('app.filter.friend_collect_hint')} (${t('app.filter.friend_guaranteed_label')})`
																		: t('app.filter.friend_collect_hint')
																}
															/>
															<p className='mono text-[10.5px] text-[#8090A0] mt-1'>
																{t('app.filter.friend_collect_edit_pointer')}
															</p>
														</div>
													) : (
														<p className='mono text-xs text-[#27AE60]'>
															{t('app.filter.friend_collect_all_owned')}
														</p>
													))}

												{/* Fallback wishlists — blacklist of everything already owned. */}
												<p
													className={`mono text-xs text-[#8B98A5] leading-relaxed ${
														friendCollectTargets.length > 0 ? 'pt-3 border-t border-[#1F2933]' : ''
													}`}
												>
													{t('app.filter.friend_wishlist_intro')}
												</p>
												<div>
													<FilterBox
														label={t('app.filter.friend_lucky_label')}
														accent='#F5B82E'
														filterStr={
															friendGuaranteedLucky
																? friendLuckyWishlistGuaranteed
																: friendLuckyWishlist
														}
														copied={copied.friendLucky}
														onCopy={() =>
															copyToClipboard(
																'friendLucky',
																friendGuaranteedLucky
																	? friendLuckyWishlistGuaranteed
																	: friendLuckyWishlist,
															)
														}
														hint={t('app.filter.friend_lucky_hint')}
													/>
													<label className='flex items-start gap-2 cursor-pointer mono text-xs mt-2'>
														<input
															type='checkbox'
															checked={friendGuaranteedLucky}
															onChange={(e) => setFriendGuaranteedLucky(e.target.checked)}
															className='mt-0.5'
														/>
														<div>
															<span className='text-[#E6EDF3]'>
																{t('app.filter.friend_guaranteed_label')}
															</span>
															<p className='text-[#8B98A5] mt-0.5'>
																{t('app.filter.friend_guaranteed_help')}
															</p>
														</div>
													</label>
												</div>
												<FilterBox
													label={t('app.filter.friend_hundo_label')}
													accent='#5EAFC5'
													filterStr={friendHundoWishlist}
													copied={copied.friendHundo}
													onCopy={() => copyToClipboard('friendHundo', friendHundoWishlist)}
													hint={t('app.filter.friend_hundo_hint')}
												/>
											</div>
										</Collapsible>

										<Collapsible
											icon='🥚'
											label={t('app.collapsible.aux_evos')}
											open={showAuxEvos}
											onToggle={() => setShowAuxEvos((s) => !s)}
										>
											<div className='space-y-4'>
												{cheapEvolve ? (
													<FilterBox
														label={t('app.filter.cheap_evolve_label')}
														accent='#27AE60'
														filterStr={cheapEvolve}
														copied={copied.cheapEvolve}
														onCopy={() => copyToClipboard('cheapEvolve', cheapEvolve)}
														hint={t('app.filter.cheap_evolve_hint')}
													/>
												) : (
													<p className='text-xs italic text-[#8B98A5]'>
														{t('app.filter.cheap_evolve_empty')}
													</p>
												)}
												<FilterBox
													label={t('app.filter.dex_plus_label')}
													accent='#27AE60'
													filterStr={dexPlus}
													copied={copied.dexPlus}
													onCopy={() => copyToClipboard('dexPlus', dexPlus)}
													hint={t('app.filter.dex_plus_hint')}
												/>
											</div>
										</Collapsible>

										<Collapsible
											icon='⚡'
											label={t('app.collapsible.aux_megas')}
											open={showAuxMegas}
											onToggle={() => setShowAuxMegas((s) => !s)}
										>
											<FilterBox
												label={t('app.filter.mega_evolve_label')}
												accent='#E91E63'
												filterStr={megaEvolve}
												copied={copied.megaEvolve}
												onCopy={() => copyToClipboard('megaEvolve', megaEvolve)}
												hint={t('app.filter.mega_evolve_hint')}
											/>
										</Collapsible>
									</div>

									{/* Team Rocket section — encounters & their post-fight cleanup */}
									<div className='space-y-3 pt-4'>
										<h3 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
											{t('app.collapsible.aux_section_team_rocket')}
										</h3>
										<RocketCollapsible
											fetchedAt={rocketLineupsFetchedAt}
											leaders={rocketLeaders}
											typedGrunts={rocketTypedGrunts}
											genericGrunts={rocketGenericGrunts}
											typeLabels={rocketTypeLabels}
											lenientCounters={effectiveConfig.rocketLenientCounters !== false}
											open={showAuxRocket}
											onToggle={() => setShowAuxRocket((s) => !s)}
											copied={copied}
											copyToClipboard={copyToClipboard}
											t={t}
											outputLocale={effectiveOutputLocale}
										/>
										<Collapsible
											icon='🌑'
											label={t('app.collapsible.aux_shadows')}
											open={showAuxShadows}
											onToggle={() => setShowAuxShadows((s) => !s)}
										>
											<div className='space-y-4'>
												<FilterBox
													label={t('app.filter.shadow_cheap_label')}
													accent='#9B59B6'
													filterStr={shadowCheap}
													copied={copied.shadowCheap}
													onCopy={() => copyToClipboard('shadowCheap', shadowCheap)}
													hint={t('app.filter.shadow_cheap_hint')}
												/>
												<FilterBox
													label={t('app.filter.shadow_safe_label')}
													accent='#9B59B6'
													filterStr={shadowSafe}
													copied={copied.shadowSafe}
													onCopy={() => copyToClipboard('shadowSafe', shadowSafe)}
													hint={t('app.filter.shadow_safe_hint')}
												/>
												<FilterBox
													label={t('app.filter.shadow_hundo_candidates_label')}
													accent='#9B59B6'
													filterStr={shadowHundoCandidates}
													copied={copied.shadowHundoCandidates}
													onCopy={() =>
														copyToClipboard('shadowHundoCandidates', shadowHundoCandidates)
													}
													hint={t('app.filter.shadow_hundo_candidates_hint')}
												/>
												{shadowFrustration && (
													<FilterBox
														label={t('app.filter.shadow_frustration_label')}
														accent='#9B59B6'
														filterStr={shadowFrustration}
														copied={copied.shadowFrustration}
														onCopy={() =>
															copyToClipboard('shadowFrustration', shadowFrustration)
														}
														hint={t('app.filter.shadow_frustration_hint')}
													/>
												)}
												{evoSwapCandy && (
													<FilterBox
														label={t('app.filter.evo_swap_candy_label')}
														accent='#9B59B6'
														filterStr={evoSwapCandy}
														copied={copied.evoSwapCandy}
														onCopy={() => copyToClipboard('evoSwapCandy', evoSwapCandy)}
														hint={t('app.filter.evo_swap_candy_hint', {
															params: {
																tag: effectiveConfig.evoSwapTagName || 'EvoSwap',
															},
														})}
													/>
												)}
												{evoSwapItem && (
													<FilterBox
														label={t('app.filter.evo_swap_item_label')}
														accent='#9B59B6'
														filterStr={evoSwapItem}
														copied={copied.evoSwapItem}
														onCopy={() => copyToClipboard('evoSwapItem', evoSwapItem)}
														hint={t('app.filter.evo_swap_item_hint', {
															params: {
																tag: effectiveConfig.evoSwapTagName || 'EvoSwap',
															},
														})}
													/>
												)}
											</div>
										</Collapsible>
									</div>

									{/* Events section — wild spawns during current / upcoming
                    events, pulled from leak-duck; run `npm run fetch-events`
                    to refresh the snapshot. */}
									<div className='space-y-3 pt-4'>
										<h3 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
											{t('app.collapsible.aux_section_events')}
										</h3>
										<EventSpawnCollapsible
											icon='🌿'
											fetchedAt={eventsFetchedAt}
											events={eventFilters}
											accent='#27AE60'
											open={showAuxEvents}
											onToggle={() => setShowAuxEvents((s) => !s)}
											copied={copied}
											copyToClipboard={copyToClipboard}
											t={t}
											locale={locale}
										/>
									</div>

									{/* Raids section — current bosses pulled from lily-dex-api;
                    run `npm run fetch-raid-bosses` to refresh the snapshot. */}
									<div className='space-y-3 pt-4'>
										<h3 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
											{t('app.collapsible.aux_section_raids')}
										</h3>
										<BossCollapsible
											icon='⚔️'
											titleKey='app.collapsible.aux_raids'
											fetchedAt={raidBossesFetchedAt}
											bossesByTier={raidFilters}
											eventGroups={eventRaidFilters}
											tierOrder={[
												'mega',
												'lvl5',
												'shadow_lvl5',
												'lvl3',
												'shadow_lvl3',
												'lvl1',
												'shadow_lvl1',
											]}
											accent='#E74C3C'
											open={showAuxRaids}
											onToggle={() => setShowAuxRaids((s) => !s)}
											copied={copied}
											copyToClipboard={copyToClipboard}
											keyPrefix='raid'
											t={t}
											locale={locale}
										/>

										<MaxBattleCollapsible
											fetchedAt={raidBossesFetchedAt}
											maxTank={maxTank}
											bossesByTier={maxBattleFilters}
											tierOrder={['tier_3', 'tier_2', 'tier_1']}
											accent='#F39C12'
											open={showAuxMaxBattles}
											onToggle={() => setShowAuxMaxBattles((s) => !s)}
											copied={copied}
											copyToClipboard={copyToClipboard}
											t={t}
										/>
									</div>

									{/* PvP section — top-30 meta picks per league with loose
                    PvP rank-1 IVs. Rankings pulled from lily-dex-api;
                    daily sync via .github/workflows/sync-pvp-rankings.yml. */}
									<div className='space-y-3 pt-4'>
										<h3 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
											{t('app.collapsible.aux_section_pvp')}
										</h3>
										<PvpCollapsible
											fetchedAt={pvpRankingsFetchedAt}
											leagues={pvpFilters}
											cupFilters={cupFilters}
											open={showAuxPvp}
											onToggle={() => setShowAuxPvp((s) => !s)}
											copied={copied}
											copyToClipboard={copyToClipboard}
											t={t}
											locale={locale}
										/>
									</div>

									{/* Internals — set theory / raw clauses / verify */}
									<div className='space-y-3 pt-4'>
										<h3 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
											{t('app.collapsible.aux_section_nerd_stuff')}
										</h3>
										<Collapsible
											icon='∑'
											label={t('app.collapsible.set_theory')}
											open={showSetTheory}
											onToggle={() => setShowSetTheory((s) => !s)}
										>
											<SetTheory
												hundos={hundos}
												luckies={luckies}
												luckyHundoSet={luckyHundoSet}
												TE_full={TE_full}
												TE_trim={TE_trim}
												cfg={effectiveConfig}
											/>
										</Collapsible>

										<Collapsible
											icon='≡'
											label={t('app.collapsible.raw_clauses')}
											open={showRawClauses}
											onToggle={() => setShowRawClauses((s) => !s)}
										>
											<RawClausesPanel
												trashClauses={trashClauses}
												tradeClauses={tradeClauses}
												sortClauses={sortClauses}
												luckySortClauses={luckySortClauses}
												nundoSortClauses={nundoSortClauses}
												prestagedClauses={prestagedClauses}
												giftClauses={giftClauses}
												buddyCatchFilters={buddyCatchFilters}
											/>
										</Collapsible>

										<Collapsible
											icon='✓'
											label={t('app.collapsible.verify')}
											open={showVerify}
											onToggle={() => setShowVerify((s) => !s)}
										>
											<VerifyPanel
												trash={trash}
												trade={trade}
												hundos={hundos}
												outputLocale={effectiveOutputLocale}
											/>
										</Collapsible>
									</div>
								</div>
							</StepWrapper>
						)}

						{/* FOOTER */}
						<footer className='mt-12 pt-6 border-t border-[#1F2933] mono text-xs text-[#8090A0] flex items-center gap-2 flex-wrap'>
							<Sparkles size={11} className='text-[#5EAFC5]' />
							persistiert lokal · {hundos.length} hundos · trash {trash.length}c · trade {trade.length}c
							{homeLocation && (
								<span>
									{' '}
									· home {homeLocation[1].toFixed(1)}°,{homeLocation[0].toFixed(1)}°
								</span>
							)}
							<button
								onClick={() => {
									setShowChangelog(true);
									setChangelogSeen(CHANGELOG.length);
								}}
								className='ml-auto flex items-center gap-1.5 hover:text-[#E6EDF3] transition underline decoration-dotted underline-offset-2'
							>
								{t('app.changelog.footer_link')}
								{changelogSeen < CHANGELOG.length && (
									<span className='w-1.5 h-1.5 rounded-full bg-[#E67E22] inline-block' aria-hidden='true' />
								)}
							</button>
						</footer>
						<AppCredit />
					</div>
				</div>
			)}

			<SettingsModal
				open={showSettings}
				onClose={() => {
					setShowSettings(false);
					setResetArmed(false);
				}}
				config={config}
				setConfig={setConfig}
				onResetAll={resetAll}
				resetArmed={resetArmed}
				onExport={exportState}
				onImport={applyImportEnvelope}
			/>
			<HundoRegionalNotice notices={hundoRegionalNotice} onClose={() => setHundoRegionalNotice([])} />
			{/* Sequential, not stacked: the regional notice (if any) shows first. */}
			{hundoRegionalNotice.length === 0 && (
				<FriendCollectCoveredNotice
					notices={friendCollectCoveredNotice}
					onClose={() => setFriendCollectCoveredNotice([])}
				/>
			)}
			<RegionalSyncNotice
				notices={regionalNotices}
				onClose={() => setRegionalNotices([])}
				onShowChangelog={() => {
					setRegionalNotices([]);
					setShowChangelog(true);
					setChangelogSeen(CHANGELOG.length);
				}}
			/>
			<ChangelogModal open={showChangelog} onClose={() => setShowChangelog(false)} />
		</div>
	);
}

// ── Stepper-internal subcomponents ─────────────────────────────────────────

// Each step is its own conditionally-rendered <StepWrapper>, so moving between
// steps UNMOUNTS one and MOUNTS another — which means a "skip the first render"
// guard inside the component would never fire. Module-level instead: the first
// step mounted in a session is a page load, where stealing focus would be
// hostile; every later mount is the result of a deliberate navigation.
let stepMountedOnce = false;

function StepWrapper({ title, hint, children, onBack, onNext, nextLabel }) {
	const { t } = useTranslation();
	const headingRef = useRef(null);
	useEffect(() => {
		// Navigating swapped the whole panel and unmounted the control that was
		// activated (Next / Back / a nav tab), so focus fell to <body>: a keyboard
		// user restarted from the top of the document and a screen-reader user was
		// told nothing had happened. Send focus to the new step's heading instead.
		if (!stepMountedOnce) {
			stepMountedOnce = true;
			return;
		}
		headingRef.current?.focus({ preventScroll: false });
	}, []);
	return (
		<section className='space-y-5'>
			<div>
				<h2 ref={headingRef} tabIndex={-1} className='mono text-xl font-bold text-[#E6EDF3]'>
					{title}
				</h2>
				{hint && <p className='text-sm text-[#8B98A5] mt-1.5 max-w-2xl'>{hint}</p>}
			</div>
			<div>{children}</div>
			<div className='flex items-center gap-2 pt-4 border-t border-[#1F2933]'>
				{onBack && (
					<button
						onClick={onBack}
						className='mono text-sm bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] px-4 py-2 rounded transition'
					>
						{t('app.step.back_button')}
					</button>
				)}
				<div className='flex-1' />
				{onNext && (
					<button
						onClick={onNext}
						className='mono text-sm bg-[#E74C3C] hover:bg-[#FF5A4A] text-white px-4 py-2 rounded transition'
					>
						{nextLabel || t('app.step.next_default')}
					</button>
				)}
			</div>
		</section>
	);
}

function StatBox({ label, value }) {
	return (
		<div className='border border-[#1F2933] rounded px-3 py-2'>
			<div className='text-[10px] uppercase tracking-wider text-[#8090A0]'>{label}</div>
			<div className='text-[#E6EDF3] mt-0.5'>{value}</div>
		</div>
	);
}

function BuddyCatchSection({ buddyCatchFilters, copied, onCopy }) {
	const { t } = useTranslation();
	return (
		<div className='space-y-3'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#E67E22] flex items-baseline gap-2'>
				<span>{t('app.buddy_catch.section_title')}</span>
				<span className='text-[#8090A0] normal-case'>· {t('app.buddy_catch.section_subtitle')}</span>
			</div>
			{buddyCatchFilters.map((b) => {
				const key = `buddyCatch:${b.prefix}`;
				return (
					<FilterBox
						key={b.prefix}
						label={t('app.buddy_catch.filter_label', { params: { name: b.buddyName } })}
						accent='#E67E22'
						filterStr={b.filter}
						copied={copied[key]}
						onCopy={() => onCopy(key, b.filter)}
					/>
				);
			})}
		</div>
	);
}

// Shared chip add-on for the have-list editors: regional-form annotation
// badges. Click-only — marks WHICH form(s) the owned lucky/hundo actually is
// for the ~51 catalog species; no badge active = form unknown = species-level
// behavior everywhere (exactly the pre-annotation semantics). Feeds the
// friend-collect coverage predicate and the form-scoped wishlist exclusions.
function HaveFormBadges({ species, formsAnn, onFormsAnnChange, t }) {
	if (!onFormsAnnChange) return null;
	const catalog = regionalFormsFor(species) || [];
	if (catalog.length === 0) return null;
	const owned = new Set(formsAnn?.[species] || []);
	const toggle = (formKey) => {
		const next = new Set(owned);
		if (next.has(formKey)) next.delete(formKey);
		else next.add(formKey);
		if (next.size > 0) onFormsAnnChange({ ...(formsAnn || {}), [species]: [...next] });
		else onFormsAnnChange(omitKey(formsAnn, species));
	};
	return (
		<span className='flex items-center gap-0.5' title={t('app.have_forms.help')}>
			{catalog.map((f) => (
				<button
					key={f.key}
					onClick={() => toggle(f.key)}
					aria-pressed={owned.has(f.key)}
					className={`text-[9px] px-1 py-px rounded border transition ${
						owned.has(f.key)
							? 'bg-[#5EAFC5]/25 border-[#5EAFC5]/50 text-[#5EAFC5]'
							: 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
					}`}
				>
					{formRegionLabel(f, t)}
				</button>
			))}
		</span>
	);
}

// ♀/♂ click-only badges on a have-list chip, the exact sibling of
// HaveFormBadges. Renders only for GENDER_SLOT_DEX species, which are disjoint
// from the regional-form catalog — so a chip never shows two badge groups.
// Records which genders you OWN; GENDER_SLOT_DEX decides which of them close
// the slot. A slot-closing pick is tinted amber so "done" reads differently
// from "recorded but still hunting".
function HaveGenderBadges({ species, gendersAnn, onGendersAnnChange, t }) {
	if (!onGendersAnnChange) return null;
	const slots = genderSlotsFor(species);
	if (!slots) return null;
	const owned = new Set(gendersAnn?.[species] || []);
	const complete = slots.every((g) => owned.has(g));
	const toggle = (g) => {
		const next = new Set(owned);
		if (next.has(g)) next.delete(g);
		else next.add(g);
		if (next.size > 0) onGendersAnnChange({ ...(gendersAnn || {}), [species]: [...next] });
		else onGendersAnnChange(omitKey(gendersAnn, species));
	};
	return (
		<span className='flex items-center gap-0.5' title={t('app.have_genders.help')}>
			{['female', 'male'].map((g) => {
				const on = owned.has(g);
				const tint = complete ? '#E2B93B' : '#5EAFC5';
				return (
					<button
						key={g}
						onClick={() => toggle(g)}
						aria-pressed={on}
						aria-label={t(`app.buddy_targets.gender_${g}`)}
						title={t(`app.buddy_targets.gender_${g}`)}
						className={`text-[9px] px-1 py-px rounded border transition ${
							on ? '' : 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
						}`}
						style={on ? { background: `${tint}40`, borderColor: `${tint}80`, color: tint } : undefined}
					>
						{g === 'female' ? '♀' : '♂'}
					</button>
				);
			})}
		</span>
	);
}

// Slot badges for species PoGo search cannot separate at all. Same shape as
// the form and gender badges, and disjoint from both — so a chip still renders
// exactly one refinement row. Unlike those two this can never become a filter
// guard: ticking every slot is what finally lets the wishlist exclude the
// family, which is the whole mechanism.
function HaveSlotBadges({ species, slotsAnn, onSlotsAnnChange, activeSlot, t }) {
	if (!onSlotsAnnChange) return null;
	const entry = invisibleSlotsFor(species);
	if (!entry) return null;
	const owned = new Set(slotsAnn?.[species] || []);
	const complete = entry.slots.every((s) => owned.has(s));
	const toggle = (slot) => {
		const next = new Set(owned);
		if (next.has(slot)) next.delete(slot);
		else next.add(slot);
		if (next.size > 0) onSlotsAnnChange({ ...(slotsAnn || {}), [species]: [...next] });
		else onSlotsAnnChange(omitKey(slotsAnn, species));
	};
	return (
		<span className='flex items-center gap-0.5' title={t('app.have_slots.help')}>
			{entry.slots.map((slot) => {
				const on = owned.has(slot);
				const tint = complete ? '#E2B93B' : '#5EAFC5';
				return (
					<button
						key={slot}
						onClick={() => toggle(slot)}
						aria-pressed={on}
						title={slot === activeSlot ? t('app.have_slots.spawning_now') : undefined}
						className={`text-[9px] px-1 py-px rounded border transition ${
							on ? '' : 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
						} ${slot === activeSlot ? 'ring-1 ring-[#E2B93B]/70' : ''}`}
						style={on ? { background: `${tint}40`, borderColor: `${tint}80`, color: tint } : undefined}
					>
						{t(`app.have_slots.${entry.axis}.${slot}`)}
					</button>
				);
			})}
		</span>
	);
}

// Explains the inferred Sesokitz season and lets the user override or switch
// it off. Rendered once under the have-list editors rather than per chip.
function SeasonNote({ hemisphere, season, window, auto, onAuto, onOverride, overridden, relevant, t }) {
	const { locale } = useTranslation();
	// Show it exactly when a seasonal species is on a have-list — otherwise it is
	// noise for the ~everyone who owns no Sesokitz. Crucially it must NOT hide
	// when auto is on but no season could be derived (no home pin): the auto
	// toggle and the manual override live in here, so hiding then strands the
	// user with no way to reach either.
	if (!relevant) return null;
	const until =
		window && window.end
			? new Date(window.end).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
			: null;
	return (
		<div className='mt-4 rounded border border-[#2D3A47] bg-[#141C24] px-3 py-2'>
			<p className='mono text-[10px] leading-relaxed text-[#8B98A5]'>
				{season
					? t(overridden ? 'app.have_slots.season_note_manual' : 'app.have_slots.season_note', {
							params: {
								hemisphere: t(`app.have_slots.hemisphere.${hemisphere || 'unknown'}`),
								season: t(`app.have_slots.season.${season}`),
								until: until || '—',
							},
						})
					: auto
						? t('app.have_slots.season_note_unknown')
						: t('app.have_slots.season_note_off')}
			</p>
			<div className='mt-1.5 flex flex-wrap items-center gap-1'>
				<button
					onClick={onAuto}
					aria-pressed={auto && !overridden}
					className={`text-[9px] px-1 py-px rounded border transition ${
						auto && !overridden
							? 'bg-[#5EAFC5]/25 border-[#5EAFC5]/50 text-[#5EAFC5]'
							: 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
					}`}
				>
					{t('app.have_slots.season_auto')}
				</button>
				{['spring', 'summer', 'autumn', 'winter'].map((sn) => (
					<button
						key={sn}
						onClick={() => onOverride(sn)}
						aria-pressed={overridden && season === sn}
						className={`text-[9px] px-1 py-px rounded border transition ${
							overridden && season === sn
								? 'bg-[#E2B93B]/25 border-[#E2B93B]/50 text-[#E2B93B]'
								: 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
						}`}
					>
						{t(`app.have_slots.season.${sn}`)}
					</button>
				))}
			</div>
		</div>
	);
}

function HundosEditor({
	hundos,
	setHundos,
	newHundo,
	setNewHundo,
	addHundo,
	removeHundo,
	formsAnn,
	onFormsAnnChange,
	gendersAnn,
	onGendersAnnChange,
	slotsAnn,
	onSlotsAnnChange,
	activeSlot,
}) {
	const { t } = useTranslation();
	// Live preview of what's about to be added: parse the input, resolve each token,
	// show a green chip for each resolved one + a red marker for unresolved tokens.
	const previewTokens = useMemo(() => {
		return newHundo
			.split(/[,;\s]+/)
			.filter(Boolean)
			.map((tok) => {
				const info = resolveSpeciesInfo(tok);
				return { input: tok, info };
			});
	}, [newHundo]);

	const resolved = previewTokens.filter((p) => p.info);
	const unresolved = previewTokens.filter((p) => !p.info);
	const newResolved = resolved.filter((p) => !hundos.includes(p.info.names.de.toLowerCase()));
	const dupes = resolved.filter((p) => hundos.includes(p.info.names.de.toLowerCase()));

	return (
		<div className='space-y-4'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
				{t('app.hundos.count', { params: { count: hundos.length } })}
			</div>

			<div className='flex flex-wrap gap-1.5'>
				{hundos.map((h) => (
					<span
						key={h}
						className='chip-enter mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] pl-2.5 pr-1.5 py-1 rounded flex items-center gap-1.5 transition group'
					>
						<span className='text-[#5EAFC5]'>+</span>
						{h}
						<HaveFormBadges species={h} formsAnn={formsAnn} onFormsAnnChange={onFormsAnnChange} t={t} />
						<HaveGenderBadges
							species={h}
							gendersAnn={gendersAnn}
							onGendersAnnChange={onGendersAnnChange}
							t={t}
						/>
						<HaveSlotBadges
							species={h}
							slotsAnn={slotsAnn}
							onSlotsAnnChange={onSlotsAnnChange}
							activeSlot={activeSlot}
							t={t}
						/>
						<button
							onClick={() => removeHundo(h)}
							aria-label={t('app.a11y.remove_species', { params: { name: h } })}
							className='opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[#E74C3C] transition'
						>
							<X size={12} />
						</button>
					</span>
				))}
				{hundos.length === 0 && (
					<span className='mono text-xs text-[#8B98A5] italic'>{t('app.hundos.empty')}</span>
				)}
			</div>

			<div className='flex gap-2'>
				<input
					type='text'
					value={newHundo}
					onChange={(e) => setNewHundo(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && addHundo()}
					aria-label={t('app.a11y.species_input')}
					placeholder={t('app.hundos.input_placeholder')}
					className='mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]'
				/>
				<button
					onClick={addHundo}
					disabled={previewTokens.length === 0 || newResolved.length === 0}
					className='mono text-sm bg-[#E74C3C] hover:bg-[#FF5A4A] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5'
				>
					<Plus size={14} /> {t('app.hundos.add_button')}
				</button>
			</div>

			{/* Live preview of what would be added */}
			{previewTokens.length > 0 && (
				<div className='border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] space-y-1.5'>
					<div className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.hundos.preview_summary', {
							params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length },
						})}
					</div>
					<div className='flex flex-wrap gap-1.5'>
						{previewTokens.map((tok, i) => {
							if (!tok.info) {
								return (
									<span
										key={i}
										className='mono text-[11px] bg-[#E74C3C]/15 text-[#E74C3C] px-2 py-0.5 rounded'
										title={t('app.hundos.unresolved_title')}
									>
										✗ {tok.input}
									</span>
								);
							}
							const isDupe = hundos.includes(tok.info.names.de.toLowerCase());
							const labelByType = {
								number: '#',
								en: 'EN',
								de: 'DE',
								es: 'ES',
								fr: 'FR',
								'zh-TW': 'ZH',
								hi: 'HI',
								ja: 'JA',
							};
							return (
								<span
									key={i}
									className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
										isDupe ? 'bg-[#8090A0]/15 text-[#8B98A5]' : 'bg-[#27AE60]/15 text-[#27AE60]'
									}`}
									title={`#${tok.info.dex} · EN: ${tok.info.names.en} · DE: ${tok.info.names.de}${isDupe ? ` (${t('app.hundos.dupe_marker')})` : ''}`}
								>
									<span className='text-[9px] opacity-60'>{labelByType[tok.info.inputLocale]}</span>
									{tok.info.names.de}
									{isDupe && <span className='opacity-60'>✓</span>}
								</span>
							);
						})}
					</div>
				</div>
			)}

			<p className='mono text-xs text-[#8090A0]'>
				{t('app.hundos.input_help', {
					params: {
						numbers: t('app.hundos.input_help_numbers'),
						english: t('app.hundos.input_help_english'),
						german: t('app.hundos.input_help_german'),
					},
				})}
			</p>
		</div>
	);
}

// Generic species-list editor — same multi-locale chip + preview UX as the
// hundos editor, but parameterized by `titleKey` so the i18n strings live
// under any namespace (e.g. `app.top_attackers.*`). Used for personal
// roster lists. Accent color drives the add-button hue.
// One-tap seeds for a curated species list. Plain actions, not toggles — the
// label IS the accessible name, so no aria-pressed here. The counter reports
// what an Add would actually add, so a second tap on an exhausted pack reads as
// "0/30" and disables rather than silently no-opping.
function PackAddButtons({ packs, items, onAddPack, accent }) {
	const { t } = useTranslation();
	if (!packs?.length || !onAddPack) return null;
	return (
		<div className='flex flex-wrap gap-1.5'>
			{packs.map((pack) => {
				const fresh = pack.species.filter((sp) => !items.includes(sp));
				return (
					<button
						key={pack.id}
						onClick={() => onAddPack(pack)}
						disabled={fresh.length === 0}
						title={pack.display?.join(', ')}
						className='mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] disabled:opacity-40 disabled:hover:bg-[#1F2933] text-[#E6EDF3] px-2.5 py-1 rounded flex items-center gap-1.5 transition'
					>
						<Plus size={12} style={{ color: accent }} />
						{t(pack.labelKey)}
						<span className='text-[#8090A0]'>
							{fresh.length}/{pack.species.length}
						</span>
					</button>
				);
			})}
		</div>
	);
}

function SpeciesListEditor({
	items,
	newItem,
	setNewItem,
	addItem,
	removeItem,
	titleKey,
	accent,
	formsAnn,
	onFormsAnnChange,
	gendersAnn,
	onGendersAnnChange,
	slotsAnn,
	onSlotsAnnChange,
	activeSlot,
	packs = [],
	onAddPack,
}) {
	const { t } = useTranslation();
	const previewTokens = useMemo(() => {
		return newItem
			.split(/[,;\s]+/)
			.filter(Boolean)
			.map((tok) => ({
				input: tok,
				info: resolveSpeciesInfo(tok),
			}));
	}, [newItem]);

	const resolved = previewTokens.filter((p) => p.info);
	const unresolved = previewTokens.filter((p) => !p.info);
	const newResolved = resolved.filter((p) => !items.includes(p.info.names.de.toLowerCase()));
	const dupes = resolved.filter((p) => items.includes(p.info.names.de.toLowerCase()));

	return (
		<div className='space-y-4'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
				{t(`${titleKey}.count`, { params: { count: items.length } })}
			</div>

			<PackAddButtons packs={packs} items={items} onAddPack={onAddPack} accent={accent} />

			<div className='flex flex-wrap gap-1.5'>
				{items.map((s) => (
					<span
						key={s}
						className='chip-enter mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] text-[#E6EDF3] pl-2.5 pr-1.5 py-1 rounded flex items-center gap-1.5 transition group'
					>
						<span style={{ color: accent }}>+</span>
						{s}
						<HaveFormBadges species={s} formsAnn={formsAnn} onFormsAnnChange={onFormsAnnChange} t={t} />
						<HaveGenderBadges
							species={s}
							gendersAnn={gendersAnn}
							onGendersAnnChange={onGendersAnnChange}
							t={t}
						/>
						<HaveSlotBadges
							species={s}
							slotsAnn={slotsAnn}
							onSlotsAnnChange={onSlotsAnnChange}
							activeSlot={activeSlot}
							t={t}
						/>
						<button
							onClick={() => removeItem(s)}
							aria-label={t('app.a11y.remove_species', { params: { name: s } })}
							className='opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[#E74C3C] transition'
						>
							<X size={12} />
						</button>
					</span>
				))}
				{items.length === 0 && (
					<span className='mono text-xs text-[#8B98A5] italic'>{t(`${titleKey}.empty`)}</span>
				)}
			</div>

			<div className='flex gap-2'>
				<input
					type='text'
					value={newItem}
					onChange={(e) => setNewItem(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && addItem()}
					aria-label={t('app.a11y.species_input')}
					placeholder={t(`${titleKey}.input_placeholder`)}
					className='mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]'
				/>
				<button
					onClick={addItem}
					disabled={previewTokens.length === 0 || newResolved.length === 0}
					style={{
						backgroundColor: previewTokens.length === 0 || newResolved.length === 0 ? undefined : accent,
					}}
					className='mono text-sm hover:brightness-110 disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5'
				>
					<Plus size={14} /> {t(`${titleKey}.add_button`)}
				</button>
			</div>

			{previewTokens.length > 0 && (
				<div className='border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] space-y-1.5'>
					<div className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
						{t(`${titleKey}.preview_summary`, {
							params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length },
						})}
					</div>
					<div className='flex flex-wrap gap-1.5'>
						{previewTokens.map((tok, i) => {
							if (!tok.info) {
								return (
									<span
										key={i}
										className='mono text-[11px] bg-[#E74C3C]/15 text-[#E74C3C] px-2 py-0.5 rounded'
										title={t(`${titleKey}.unresolved_title`)}
									>
										✗ {tok.input}
									</span>
								);
							}
							const isDupe = items.includes(tok.info.names.de.toLowerCase());
							const labelByType = {
								number: '#',
								en: 'EN',
								de: 'DE',
								es: 'ES',
								fr: 'FR',
								'zh-TW': 'ZH',
								hi: 'HI',
								ja: 'JA',
							};
							return (
								<span
									key={i}
									className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
										isDupe ? 'bg-[#8090A0]/15 text-[#8B98A5]' : 'bg-[#27AE60]/15 text-[#27AE60]'
									}`}
									title={`#${tok.info.dex} · EN: ${tok.info.names.en} · DE: ${tok.info.names.de}${isDupe ? ` (${t(`${titleKey}.dupe_marker`)})` : ''}`}
								>
									<span className='text-[9px] opacity-60'>{labelByType[tok.info.inputLocale]}</span>
									{tok.info.names.de}
									{isDupe && <span className='opacity-60'>✓</span>}
								</span>
							);
						})}
					</div>
				</div>
			)}

			<p className='mono text-xs text-[#8090A0]'>
				{t(`${titleKey}.input_help`, {
					params: {
						numbers: t(`${titleKey}.input_help_numbers`),
						english: t(`${titleKey}.input_help_english`),
						german: t(`${titleKey}.input_help_german`),
					},
				})}
			</p>
		</div>
	);
}

function CustomCollectiblesEditor({ list, onChange }) {
	const { t } = useTranslation();
	const [input, setInput] = useState('');

	// Live preview using same resolver as hundo input
	const previewTokens = useMemo(() => {
		return input
			.split(/[,;\s]+/)
			.filter(Boolean)
			.map((tok) => ({
				input: tok,
				info: resolveSpeciesInfo(tok),
			}));
	}, [input]);
	const resolved = previewTokens.filter((p) => p.info);
	const newResolved = resolved.filter((p) => !list.includes(p.info.names.de.toLowerCase()));
	const dupes = resolved.filter((p) => list.includes(p.info.names.de.toLowerCase()));
	const unresolved = previewTokens.filter((p) => !p.info);

	function addAll() {
		const tokens = input.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const set = new Set(list);
		const remaining = [];
		for (const tok of tokens) {
			const r = resolveSpecies(tok);
			if (r) set.add(r);
			else remaining.push(tok);
		}
		onChange([...set].sort());
		setInput(remaining.join(', '));
	}
	function remove(name) {
		onChange(list.filter((n) => n !== name));
	}

	return (
		<div>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
				{t('app.collectibles.title')}
			</div>
			<p className='mono text-xs text-[#8090A0] mb-3 leading-relaxed'>{t('app.collectibles.description')}</p>

			{list.length > 0 && (
				<div className='flex flex-wrap gap-1.5 mb-3'>
					{list.map((sp) => (
						<span
							key={sp}
							className='chip-enter mono text-xs bg-[#27AE60]/15 text-[#27AE60] border border-[#27AE60]/40 pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group'
						>
							{sp}
							<button
								onClick={() => remove(sp)}
								aria-label={t('app.a11y.remove_species', { params: { name: sp } })}
								className='opacity-50 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[#FF6B5B] transition'
							>
								<X size={10} />
							</button>
						</span>
					))}
				</div>
			)}

			<div className='flex gap-2'>
				<input
					type='text'
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && addAll()}
					placeholder={t('app.collectibles.input_placeholder')}
					aria-label={t('app.a11y.species_input')}
					className='mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]'
				/>
				<button
					onClick={addAll}
					disabled={previewTokens.length === 0 || newResolved.length === 0}
					className='mono text-sm bg-[#27AE60] hover:bg-[#3FCF80] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5'
				>
					<Plus size={14} /> {t('app.collectibles.add_button')}
				</button>
			</div>

			{previewTokens.length > 0 && (
				<div className='border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] mt-2 space-y-1.5'>
					<div className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.collectibles.preview_summary', {
							params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length },
						})}
					</div>
					<div className='flex flex-wrap gap-1.5'>
						{previewTokens.map((tok, i) => {
							if (!tok.info)
								return (
									<span
										key={i}
										className='mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded'
									>
										✗ {tok.input}
									</span>
								);
							const isDupe = list.includes(tok.info.names.de.toLowerCase());
							const labelByType = {
								number: '#',
								en: 'EN',
								de: 'DE',
								es: 'ES',
								fr: 'FR',
								'zh-TW': 'ZH',
								hi: 'HI',
								ja: 'JA',
							};
							return (
								<span
									key={i}
									className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
										isDupe ? 'bg-[#5C6975]/15 text-[#8090A0]' : 'bg-[#27AE60]/15 text-[#27AE60]'
									}`}
								>
									<span className='text-[9px] opacity-60'>{labelByType[tok.info.inputLocale]}</span>
									{tok.info.names.de}
									{isDupe && <span className='opacity-60'>✓</span>}
								</span>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

// Two-click list clear: the first click arms (label flips to a confirm prompt
// for 3 s), the second click clears. Mirrors the Settings full-reset arming
// pattern at list scope so one stray tap can't wipe a curated list. Renders
// nothing while the list is empty.
function ClearListButton({ count, onClear }) {
	const { t } = useTranslation();
	const announce = useAnnounce();
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const timer = setTimeout(() => setArmed(false), 3000);
		return () => clearTimeout(timer);
	}, [armed]);
	if (!count) return null;
	return (
		<button
			onClick={() => {
				if (!armed) {
					setArmed(true);
					// The armed state is a label swap plus a red fill, and it silently
					// disarms after 3s. Announce BOTH what the button does and that it
					// is now armed — "really clear?" on its own says nothing about what.
					announce(`${t('app.clear_list.label')} — ${t('app.clear_list.confirm')}`, { assertive: true });
					return;
				}
				setArmed(false);
				onClear();
			}}
			title={t('app.clear_list.title')}
			className={`mono text-[10.5px] px-2 py-0.5 rounded border transition flex items-center gap-1 ${
				armed
					? 'bg-[#FF6B5B]/15 border-[#FF6B5B]/50 text-[#FF6B5B]'
					: 'bg-transparent border-[#2D3A47] text-[#8090A0] hover:text-[#E6EDF3]'
			}`}
		>
			<RotateCcw size={10} />
			{armed ? t('app.clear_list.confirm') : t('app.clear_list.label')}
		</button>
	);
}

// Curated "have friends collect for me" editor: trading-focus switch,
// one-tap suggested sets (event spawns / raid meta / PvP meta, pre-pruned of
// owned + already-added species in buildFilters) with a per-pack species
// preview (tap to exclude before adding), the curated chips (owned entries
// dim with a ✓ instead of vanishing — the string already skips them; tapping
// a dimmed chip forces it back into the string), and the usual multi-locale
// species input.
function FriendCollectEditor({
	list,
	onChange,
	mode,
	onModeChange,
	guaranteedOnly = false,
	onGuaranteedChange,
	targets,
	suggestions,
	forced = [],
	onForcedChange,
	genders = {},
	onGendersChange,
	dropForms = {},
	onDropFormsChange,
}) {
	const { t } = useTranslation();
	const [input, setInput] = useState('');
	// Packs disclosure: open for first-run discovery (nothing curated yet),
	// collapsed once a list exists — the pack rows are tall and the chips are
	// the primary surface after that.
	const packsPanelId = useId();
	const [showPacks, setShowPacks] = useState(list.length === 0);
	// Pack preview state — session-only UI state, keyed by pack id: which
	// packs show their species, and which species the user tapped out of the
	// upcoming add. Not persisted: once added, curation lives in `list`.
	const [openPreviews, setOpenPreviews] = useState({});
	const [packDeselected, setPackDeselected] = useState({});

	const previewTokens = useMemo(() => {
		return input
			.split(/[,;\s]+/)
			.filter(Boolean)
			.map((tok) => ({
				input: tok,
				info: resolveSpeciesInfo(tok),
			}));
	}, [input]);
	const resolved = previewTokens.filter((p) => p.info);
	const newResolved = resolved.filter((p) => !list.includes(p.info.names.de.toLowerCase()));
	const dupes = resolved.filter((p) => list.includes(p.info.names.de.toLowerCase()));
	const unresolved = previewTokens.filter((p) => !p.info);

	function addAll() {
		const tokens = input.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const set = new Set(list);
		const remaining = [];
		for (const tok of tokens) {
			const r = resolveSpecies(tok);
			if (r) set.add(r);
			else remaining.push(tok);
		}
		onChange([...set].sort());
		setInput(remaining.join(', '));
	}
	function addSet(species) {
		onChange([...new Set([...list, ...species])].sort());
	}
	function remove(name) {
		onChange(list.filter((n) => n !== name));
		// Side-band maps ride on the curated list — no orphaned entries.
		if (onForcedChange && forced.includes(name)) onForcedChange(forced.filter((n) => n !== name));
		if (onGendersChange && name in genders) onGendersChange(omitKey(genders, name));
		if (onDropFormsChange && name in dropForms) onDropFormsChange(omitKey(dropForms, name));
	}
	function clearAll() {
		onChange([]);
		if (onForcedChange && forced.length > 0) onForcedChange([]);
		if (onGendersChange && Object.keys(genders).length > 0) onGendersChange({});
		if (onDropFormsChange && Object.keys(dropForms).length > 0) onDropFormsChange({});
	}
	// Click-only refinements — same semantics as the buddy target pickers.
	// Gender: click ♀ or ♂ to lock, click the active one again to clear.
	function toggleGender(name, g) {
		if (!onGendersChange) return;
		if (genders[name] === g) onGendersChange(omitKey(genders, name));
		else onGendersChange({ ...genders, [name]: g });
	}
	// Forms: every form collected by default; click to drop one (the picker
	// never lets the LAST kept form drop — a target that catches nothing).
	function toggleDropForm(name, formKey) {
		if (!onDropFormsChange) return;
		const dropped = new Set(dropForms[name] || []);
		if (dropped.has(formKey)) {
			dropped.delete(formKey);
		} else {
			const catalog = regionalFormsFor(name) || [];
			if (catalog.filter((f) => !dropped.has(f.key)).length <= 1) return;
			dropped.add(formKey);
		}
		if (dropped.size > 0) onDropFormsChange({ ...dropForms, [name]: [...dropped] });
		else onDropFormsChange(omitKey(dropForms, name));
	}
	// Owned chips toggle their coverage override: forced targets re-enter the
	// string (keep hunting the hundo although the lucky already landed).
	function toggleForced(name) {
		if (!onForcedChange) return;
		if (forced.includes(name)) onForcedChange(forced.filter((n) => n !== name));
		else onForcedChange([...forced, name].sort());
	}
	function togglePreview(id) {
		setOpenPreviews((prev) => ({ ...prev, [id]: !prev[id] }));
	}
	// Species the user already covers (lucky/hundo per mode) ride along in
	// time-limited packs, flagged via `owned`. They start deselected — the Add
	// count stays honest — but a tap opts them back in (re-hunt during an
	// event). Already-curated species (`curated`) ride along too, purely for
	// the full event picture: inert, dimmed, never part of an Add.
	function packDefaultOff(s) {
		return s.species.filter((_, i) => (s.owned || [])[i] || (s.curated || [])[i]);
	}
	function togglePackSpecies(pack, name, index) {
		if ((pack.curated || [])[index]) return;
		setPackDeselected((prev) => {
			const next = new Set(prev[pack.id] ?? packDefaultOff(pack));
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return { ...prev, [pack.id]: [...next] };
		});
	}
	// What an Add would actually add, after the preview de-selections.
	function packSelection(s) {
		const off = new Set(packDeselected[s.id] ?? packDefaultOff(s));
		return s.species.filter((name, i) => !(s.curated || [])[i] && !off.has(name));
	}

	const suggestionLabel = (s) => {
		if (s.kind === 'event') return `✨ ${s.title}`;
		if (s.kind === 'eggs')
			return `🥚 ${t('app.filter.friend_collect_suggest_eggs', { params: { title: s.title } })}`;
		if (s.kind === 'tradeevo') return `🧬 ${t('app.filter.friend_collect_suggest_tradeevo')}`;
		if (s.kind === 'candy') return `🍬 ${t('app.filter.friend_collect_suggest_candy')}`;
		if (s.kind === 'powerlines') return `🐲 ${t('app.filter.friend_collect_suggest_powerlines')}`;
		if (s.kind === 'starters') return `🌱 ${t('app.filter.friend_collect_suggest_starters')}`;
		if (s.kind === 'mega') return `💠 ${t('app.filter.friend_collect_suggest_mega')}`;
		if (s.kind === 'raids') return `⚔️ ${t('app.filter.friend_collect_suggest_raid')}`;
		if (s.kind === 'pvp-great') return `🥇 ${t('app.filter.friend_collect_suggest_pvp_great')}`;
		return `🥈 ${t('app.filter.friend_collect_suggest_pvp_ultra')}`;
	};
	// Pack grouping: time-limited feeds first, evergreen collections, then the
	// meta-driven pools. Groups render only when they have surviving packs.
	const SUGGESTION_GROUPS = [
		{ key: 'live', kinds: ['event', 'eggs'] },
		{ key: 'evergreen', kinds: ['tradeevo', 'candy', 'powerlines', 'starters', 'mega'] },
		{ key: 'meta', kinds: ['raids', 'pvp-great', 'pvp-ultra'] },
	];

	return (
		<div className='space-y-3'>
			<div className='flex items-center gap-2 flex-wrap'>
				<span className='mono text-xs text-[#8090A0]'>{t('app.filter.friend_collect_mode_label')}</span>
				<div className='flex rounded overflow-hidden border border-[#2D3A47]'>
					{['lucky', 'hundo', 'both'].map((m) => {
						// Accent language matches the chip badges: amber = lucky,
						// purple = hundo (4★), green = both goals.
						const activeCls = {
							lucky: 'bg-[#F5B82E]/20 text-[#F5B82E]',
							hundo: 'bg-[#9B59B6]/20 text-[#9B59B6]',
							both: 'bg-[#27AE60]/20 text-[#27AE60]',
						}[m];
						return (
							<button
								key={m}
								onClick={() => onModeChange(m)}
								className={`mono text-xs px-3 py-1 transition ${
									mode === m ? activeCls : 'bg-[#1F2933] text-[#8090A0] hover:text-[#E6EDF3]'
								}`}
							>
								{t(`app.filter.friend_collect_mode_${m}`)}
							</button>
						);
					})}
				</div>
				<span className='ml-auto'>
					<ClearListButton count={list.length} onClear={clearAll} />
				</span>
			</div>
			<p className='mono text-xs text-[#8090A0] leading-relaxed'>
				{t('app.filter.friend_collect_mode_help')}
			</p>
			{mode === 'lucky' && onGuaranteedChange && (
				<label className='flex items-start gap-2 cursor-pointer mono text-xs'>
					<input
						type='checkbox'
						checked={guaranteedOnly}
						onChange={(e) => onGuaranteedChange(e.target.checked)}
						className='mt-0.5'
					/>
					<div>
						<span className='text-[#E6EDF3]'>{t('app.filter.friend_guaranteed_label')}</span>
						<p className='text-[#8B98A5] mt-0.5'>{t('app.filter.friend_guaranteed_help')}</p>
					</div>
				</label>
			)}
			<p className='mono text-[10.5px] text-[#8090A0] leading-relaxed'>
				{t('app.filter.friend_collect_xl_note')}
			</p>

			{suggestions.length > 0 && (
				<div className='border border-[#1F2933] rounded'>
					<button
						onClick={() => setShowPacks((s) => !s)}
						// Custom disclosure, not <details> — nothing conveys open/closed
						// but the chevron glyph, which AT does not read as state.
						aria-expanded={showPacks}
						aria-controls={packsPanelId}
						className='w-full px-2.5 py-2 flex items-center gap-2 hover:bg-[#141A21] transition'
					>
						{showPacks ? (
							<ChevronDown size={12} className='text-[#5EAFC5]' />
						) : (
							<ChevronRight size={12} className='text-[#8090A0]' />
						)}
						<span className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
							{t('app.filter.friend_collect_suggest_title')} · {suggestions.length}
						</span>
					</button>
					{showPacks && (
						<div id={packsPanelId} className='px-2.5 pb-2.5 space-y-2.5 border-t border-[#1F2933] pt-2'>
							{SUGGESTION_GROUPS.map((group) => {
								const packs = suggestions.filter((s) => group.kinds.includes(s.kind));
								if (packs.length === 0) return null;
								return (
									<div key={group.key} className='space-y-1.5'>
										<div className='mono text-[10px] uppercase tracking-wider text-[#5C6975]'>
											{t(`app.filter.friend_collect_group_${group.key}`)}
										</div>
										{packs.map((s) => {
											const selected = packSelection(s);
											const offNames = new Set(packDeselected[s.id] ?? packDefaultOff(s));
											return (
											<div key={s.id} className='border border-[#1F2933] rounded px-2.5 py-1.5 bg-[#0B0F14]'>
												<div className='flex items-center justify-between gap-2'>
													<div className='mono text-xs text-[#E6EDF3] min-w-0'>
														<span className='break-words'>{suggestionLabel(s)}</span>
														<span className='text-[#8090A0] ml-1.5 whitespace-nowrap'>
															{t('app.filter.friend_collect_suggest_count', {
																params: { count: s.species.length },
															})}
														</span>
													</div>
													<button
														onClick={() => addSet(selected)}
														disabled={selected.length === 0}
														className='mono text-xs bg-[#27AE60] hover:bg-[#3FCF80] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-2.5 py-1 rounded transition flex items-center gap-1 shrink-0'
													>
														<Plus size={12} /> {t('app.collectibles.add_button')}
														{selected.length < s.species.length &&
															` ${selected.length}/${s.species.length}`}
													</button>
												</div>
												{/* Species preview: what would this Add actually add? Open the
												    list and tap a chip to leave that species out. */}
												<button
													onClick={() => togglePreview(s.id)}
													aria-expanded={!!openPreviews[s.id]}
													aria-controls={`fc-pack-preview-${s.id}`}
													className='mono text-[10px] mt-1 flex items-center gap-1 text-[#5EAFC5] hover:text-[#8FD4E8] transition'
												>
													{openPreviews[s.id] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
													{t(
														openPreviews[s.id]
															? 'app.filter.friend_collect_preview_hide'
															: 'app.filter.friend_collect_preview_show',
													)}
												</button>
												{openPreviews[s.id] && (
													<div id={`fc-pack-preview-${s.id}`} className='mt-1.5 space-y-1'>
														<p className='mono text-[10px] text-[#5C6975]'>
															{t('app.filter.friend_collect_preview_help')}
														</p>
														{(s.owned || []).some(Boolean) && (
															<p className='mono text-[10px] text-[#5C6975]'>
																{t('app.filter.friend_collect_preview_owned_help')}
															</p>
														)}
														{(s.curated || []).some(Boolean) && (
															<p className='mono text-[10px] text-[#5C6975]'>
																{t('app.filter.friend_collect_preview_curated_help')}
															</p>
														)}
														<div className='flex flex-wrap gap-1'>
															{s.species.map((name, i) => {
																const isCurated = !!(s.curated || [])[i];
																const isOwned = !!(s.owned || [])[i];
																const off = offNames.has(name);
																return (
																	<button
																		key={name}
																		onClick={() => togglePackSpecies(s, name, i)}
																		aria-pressed={!off}
																		className={`mono text-[11px] px-2 py-0.5 rounded border transition ${
																			isCurated
																				? 'bg-[#5EAFC5]/10 text-[#5EAFC5]/60 border-[#5EAFC5]/25 cursor-default'
																				: off
																					? isOwned
																						? 'bg-[#F5B82E]/10 text-[#F5B82E]/70 border-[#F5B82E]/30 line-through'
																						: 'bg-[#5C6975]/10 text-[#5C6975] border-[#2D3A47] line-through'
																					: 'bg-[#27AE60]/15 text-[#27AE60] border-[#27AE60]/40'
																		}`}
																	>
																		{isCurated ? '≡ ' : isOwned ? '✓ ' : ''}
																		{(s.display || [])[i] || name}
																	</button>
																);
															})}
														</div>
													</div>
												)}
												{s.hintKey &&
													(s.warn && mode === 'lucky' ? (
														<p className='mono text-[10.5px] text-[#F5B82E] mt-1 leading-relaxed'>
															⚠ {t(s.hintKey)}
														</p>
													) : (
														<p className='mono text-[10.5px] text-[#8090A0] mt-1 leading-relaxed'>
															{t(s.hintKey)}
														</p>
													))}
											</div>
											);
										})}
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

			{targets.length > 0 ? (
				<div className='flex flex-wrap gap-1.5'>
				{targets.map((tg) => {
					// Three chip states: active (green), owned-and-dimmed (grey, the
					// string skips it), owned-but-FORCED (green with a dashed border —
					// the user tapped it back into the string, e.g. hundo hunt on an
					// already-lucky species). Tapping the name toggles the override.
					const overridden = tg.owned && tg.forced;
					const dimmed = tg.owned && !tg.forced;
					return (
						<span
							key={tg.species}
							title={
								overridden
									? t('app.filter.friend_collect_forced_active')
									: dimmed
										? t(`app.filter.friend_collect_owned_${mode}`)
										: undefined
							}
							className={`chip-enter mono text-xs pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group border ${
								dimmed
									? 'bg-[#8090A0]/10 text-[#8B98A5] border-[#2D3A47]'
									: overridden
										? 'bg-[#27AE60]/15 text-[#27AE60] border-dashed border-[#27AE60]/60'
										: 'bg-[#27AE60]/15 text-[#27AE60] border-[#27AE60]/40'
							}`}
						>
							{tg.owned && <span>✓</span>}
							{tg.owned && onForcedChange ? (
								<button
									onClick={() => toggleForced(tg.species)}
									aria-pressed={!dimmed}
									title={t(
										overridden
											? 'app.filter.friend_collect_forced_off_tip'
											: 'app.filter.friend_collect_forced_on_tip',
									)}
									className={`transition hover:text-[#3FCF80] ${
										dimmed ? 'line-through decoration-[#8090A0]/60' : ''
									}`}
								>
									{tg.display}
								</button>
							) : (
								<span className={dimmed ? 'line-through decoration-[#8090A0]/60' : ''}>{tg.display}</span>
							)}
							{/* Per-goal coverage badges — amber = owned as lucky, purple =
							    owned as hundo. Shown regardless of focus so partial progress
							    in 'both' mode (and cross-goal ownership) stays visible. */}
							{tg.ownedLucky && (
								<span
									title={t('app.filter.friend_collect_badge_lucky')}
									className='text-[9px] px-1 py-px rounded bg-[#F5B82E]/20 text-[#F5B82E] border border-[#F5B82E]/40'
								>
									✦
								</span>
							)}
							{tg.ownedHundo && (
								<span
									title={t('app.filter.friend_collect_badge_hundo')}
									className='text-[9px] px-1 py-px rounded bg-[#9B59B6]/20 text-[#9B59B6] border border-[#9B59B6]/40'
								>
									4★
								</span>
							)}
							{/* Click-only refinements — buddy-target semantics, but the QUIET
							    have-list badge styling (gray at rest, blue when deliberately
							    set) so a big chip cloud stays calm: untouched chips show dim
							    gray tags, and color only appears where the user made a pick.
							    ♀/♂ locks the wanted gender (scoped `!species,<gender>` guard;
							    Combee/Salandit gender-locked evolutions). Form tags drop
							    regional forms the friend should skip (one scoped De-Morgan
							    guard per dropped form; kept forms turn blue once a restriction
							    exists); hidden for species without catalog forms. */}
							{onGendersChange && (
								<span className='flex items-center gap-0.5' title={t('app.filter.friend_collect_gender_help')}>
									{['female', 'male'].map((g) => {
										const on = genders[tg.species] === g;
										return (
											<button
												key={g}
												onClick={() => toggleGender(tg.species, g)}
												aria-pressed={on}
												// The visible content is a bare ♀/♂ glyph, which screen
												// readers announce as a symbol or not at all. Matches the
												// two sibling implementations (HaveGenderBadges,
												// BuddyTargetsEditor), which already name theirs.
												aria-label={t(`app.buddy_targets.gender_${g}`)}
												className={`text-[9px] px-1 py-px rounded border transition ${
													on
														? 'bg-[#5EAFC5]/25 border-[#5EAFC5]/50 text-[#5EAFC5]'
														: 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
												}`}
											>
												{g === 'female' ? '♀' : '♂'}
											</button>
										);
									})}
								</span>
							)}
							{onDropFormsChange &&
								(regionalFormsFor(tg.species) || []).length > 0 && (
									<span
										className='flex items-center gap-0.5 flex-wrap'
										title={t('app.filter.friend_collect_forms_help')}
									>
										{(regionalFormsFor(tg.species) || []).map((f) => {
											const droppedHere = (dropForms[tg.species] || []).includes(f.key);
											const restricted = (dropForms[tg.species] || []).length > 0;
											return (
												<button
													key={f.key}
													onClick={() => toggleDropForm(tg.species, f.key)}
													aria-pressed={restricted && !droppedHere}
													className={`text-[9px] px-1 py-px rounded border transition ${
														droppedHere
															? 'bg-transparent border-[#2D3A47] text-[#3E4854] line-through'
															: restricted
																? 'bg-[#5EAFC5]/25 border-[#5EAFC5]/50 text-[#5EAFC5]'
																: 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
													}`}
												>
													{formRegionLabel(f, t)}
												</button>
											);
										})}
									</span>
								)}
							<button
								onClick={() => remove(tg.species)}
								aria-label={t('app.a11y.remove_species', { params: { name: tg.display } })}
								className='opacity-50 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[#FF6B5B] transition'
							>
								<X size={10} />
							</button>
						</span>
					);
				})}
				</div>
			) : (
				<p className='mono text-xs text-[#8B98A5] italic'>{t('app.filter.friend_collect_empty')}</p>
			)}

			<div className='flex gap-2'>
				<input
					type='text'
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && addAll()}
					placeholder={t('app.filter.friend_collect_input_placeholder')}
					aria-label={t('app.a11y.species_input')}
					className='mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-2 rounded text-[#E6EDF3] placeholder:text-[#8090A0]'
				/>
				<button
					onClick={addAll}
					disabled={previewTokens.length === 0 || newResolved.length === 0}
					className='mono text-sm bg-[#27AE60] hover:bg-[#3FCF80] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-4 py-2 rounded transition flex items-center gap-1.5'
				>
					<Plus size={14} /> {t('app.collectibles.add_button')}
				</button>
			</div>

			{previewTokens.length > 0 && (
				<div className='border border-[#1F2933] rounded p-2.5 bg-[#0B0F14] space-y-1.5'>
					<div className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.collectibles.preview_summary', {
							params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length },
						})}
					</div>
					<div className='flex flex-wrap gap-1.5'>
						{previewTokens.map((tok, i) => {
							if (!tok.info)
								return (
									<span
										key={i}
										className='mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded'
									>
										✗ {tok.input}
									</span>
								);
							const isDupe = list.includes(tok.info.names.de.toLowerCase());
							return (
								<span
									key={i}
									className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
										isDupe ? 'bg-[#5C6975]/15 text-[#8090A0]' : 'bg-[#27AE60]/15 text-[#27AE60]'
									}`}
								>
									{tok.info.names.de}
									{isDupe && <span className='opacity-60'>✓</span>}
								</span>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

// ─── SUBCOMPONENTS ────────────────────────────────────────────────────────

function FilterBox({ label, accent, filterStr, copied, onCopy, hint }) {
	const { t } = useTranslation();
	const len = filterStr.length;
	const pct = Math.min(100, (len / 5000) * 100);
	const codeRef = useRef(null);

	// Tap the filter text to select-all — on mobile this lets long-press → "Copy"
	// surface the system copy menu without needing the clipboard API at all.
	function selectAll() {
		const el = codeRef.current;
		if (!el) return;
		const range = document.createRange();
		range.selectNodeContents(el);
		const sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}

	// copied tri-state: false | "ok" | "err"
	const buttonLabel =
		copied === 'ok' ? (
			<>
				<Check size={12} /> {t('app.filterbox.copied')}
			</>
		) : copied === 'err' ? (
			<>
				<X size={12} /> {t('app.filterbox.copy_error')}
			</>
		) : (
			<>
				<Copy size={12} /> {t('app.filterbox.copy_button')}
			</>
		);
	const buttonColor = copied === 'ok' ? '#27AE60' : copied === 'err' ? '#FF6B5B' : '#E6EDF3';

	return (
		<div className='border border-[#1F2933] rounded'>
			<div className='flex items-center justify-between px-4 py-2.5 border-b border-[#1F2933] bg-[#141A21] gap-3 flex-wrap'>
				<div className='flex items-baseline gap-3 flex-wrap'>
					<span className='mono text-xs font-semibold uppercase tracking-wider' style={{ color: accent }}>
						{label}
					</span>
					<span className='mono text-xs text-[#8090A0]'>
						{t('app.filterbox.length_label', { params: { len: len.toLocaleString() } })}
					</span>
					<div className='w-24 h-1 bg-[#1F2933] rounded-full overflow-hidden'>
						<div className='h-full transition-all' style={{ width: `${pct}%`, background: accent }} />
					</div>
				</div>
				<button
					onClick={onCopy}
					className='mono text-xs flex items-center gap-1.5 px-2.5 py-1 bg-[#1F2933] hover:bg-[#2D3A47] rounded transition'
					style={{ color: buttonColor }}
				>
					{buttonLabel}
				</button>
			</div>
			{hint && (
				<p className='px-4 py-2 text-xs italic text-[#8B98A5] leading-snug border-b border-[#1F2933] bg-[#0E141A]'>
					{hint}
				</p>
			)}
			<div className='p-4 max-h-40 overflow-auto bg-[#0B0F14]'>
				<code
					ref={codeRef}
					onClick={selectAll}
					// `userSelect: all` means a keyboard user cannot drag-select this
					// either, so without a key handler the select-all shortcut was
					// pointer-only. The Copy button remains the primary path; this is
					// the manual-selection escape hatch, so it gets a name and a
					// handler rather than being left as a dead click target.
					tabIndex={0}
					role='button'
					aria-label={t('app.filterbox.select_all_hint')}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							selectAll();
						}
					}}
					className='mono text-xs text-[#E6EDF3] break-all leading-relaxed cursor-text select-all block'
					style={{ userSelect: 'all', WebkitUserSelect: 'all' }}
					title={t('app.filterbox.select_all_hint')}
				>
					{filterStr}
				</code>
			</div>
		</div>
	);
}

function Collapsible({ icon, label, open, onToggle, children }) {
	return (
		<details open={open} className='border border-[#1F2933] rounded'>
			<summary
				onClick={(e) => {
					e.preventDefault();
					onToggle();
				}}
				className='px-4 py-3 flex items-center gap-3 hover:bg-[#141A21] transition'
			>
				{open ? (
					<ChevronDown size={14} className='text-[#5EAFC5]' />
				) : (
					<ChevronRight size={14} className='text-[#8090A0]' />
				)}
				<span className='mono text-sm text-[#5EAFC5]'>{icon}</span>
				<span className='mono text-sm font-medium text-[#E6EDF3]'>{label}</span>
			</summary>
			{open && <div className='px-4 pb-4 pt-2 border-t border-[#1F2933]'>{children}</div>}
		</details>
	);
}

// "2h ago", "3d ago" — relative-age formatter used in the Raid/Max-Battle
// collapsible headers so users can tell when the boss snapshot was last synced.
function formatSyncAge(iso, t) {
	if (!iso) return null;
	const ageMs = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(ageMs) || ageMs < 0) return null;
	const minutes = Math.floor(ageMs / 60000);
	if (minutes < 60) return t('app.filter.last_sync_minutes', { params: { minutes } });
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return t('app.filter.last_sync_hours', { params: { hours } });
	const days = Math.floor(hours / 24);
	return t('app.filter.last_sync_days', { params: { days } });
}

// Formats a raid-event time window as a short teaser string for the
// accordion summary line. Three branches:
//   - active (now ∈ [start, end]):
//       same calendar day  → "today HH:MM–HH:MM"
//       multi-day          → "now → DOW HH:MM"
//   - upcoming today        → "starts HH:MM"
//   - upcoming this week    → "DOW HH:MM"
// Locale-aware via Intl: weekday short-name and 24h time both follow `locale`.
function formatEventWindow(start, end, t, locale) {
	const startMs = Date.parse(start);
	const endMs = Date.parse(end);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '';
	const now = Date.now();
	const fmtTime = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
	const fmtDow = new Intl.DateTimeFormat(locale, { weekday: 'short' });
	const sameCalendarDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

	if (now >= startMs && now <= endMs) {
		if (sameCalendarDay(startMs, endMs)) {
			return t('app.filter.event_window_active_today', {
				params: { start: fmtTime.format(startMs), end: fmtTime.format(endMs) },
			});
		}
		return t('app.filter.event_window_active_multiday', {
			params: { dow: fmtDow.format(endMs), end: fmtTime.format(endMs) },
		});
	}
	if (sameCalendarDay(startMs, now)) {
		return t('app.filter.event_window_upcoming_today', {
			params: { time: fmtTime.format(startMs) },
		});
	}
	return t('app.filter.event_window_upcoming_week', {
		params: { dow: fmtDow.format(startMs), time: fmtTime.format(startMs) },
	});
}

// Renders a single per-aspect boss collapsible (Raids or Max Battles). Each
// boss inside becomes one FilterBox; skipped bosses (no clean counter) get a
// short italic note instead. Header shows total boss count and last sync age.
//
// `eventGroups` (optional) renders short-window event raids as their own
// accordion rows above the standing tiers — currently-active events open
// by default, upcoming ones collapse with a window teaser.
function BossCollapsible({
	icon,
	titleKey,
	fetchedAt,
	bossesByTier,
	eventGroups,
	tierOrder,
	accent,
	open,
	onToggle,
	copied,
	copyToClipboard,
	keyPrefix,
	t,
	locale,
}) {
	const tierBosses = tierOrder.flatMap((tier) => bossesByTier?.[tier] || []);
	const eventBosses = (eventGroups || []).flatMap((g) => g.bosses || []);
	const totalBosses = tierBosses.length + eventBosses.length;
	const age = formatSyncAge(fetchedAt, t);
	const headerLabel = t(titleKey);
	const countLabel = t('app.collapsible.aux_raids_count', { params: { count: totalBosses } });
	const footerLabel = age
		? t('app.collapsible.aux_footer', { params: { count: countLabel, age } })
		: t('app.collapsible.aux_footer_no_age', { params: { count: countLabel } });
	if (totalBosses === 0) {
		return (
			<Collapsible icon={icon} label={headerLabel} open={open} onToggle={onToggle}>
				<p className='text-xs italic text-[#8B98A5]'>{t('app.filter.aux_bosses_empty')}</p>
			</Collapsible>
		);
	}
	const renderBossBox = (boss, eventIdSuffix) => {
		if (boss.skipped) {
			return (
				<p key={boss.id} className='text-xs italic text-[#8B98A5] pl-2'>
					{t('app.filter.boss_no_clean_counter', { params: { boss: boss.name } })}
				</p>
			);
		}
		// Distinct copy key per (event, boss) pair so an event-context Latios
		// and a standing-tier Latios don't share copy state.
		const copyKey = eventIdSuffix ? `${keyPrefix}_evt_${eventIdSuffix}_${boss.id}` : `${keyPrefix}_${boss.id}`;
		return (
			<FilterBox
				key={boss.id}
				label={t('app.filter.raid_counter_label', { params: { boss: boss.name } })}
				accent={accent}
				filterStr={boss.clause}
				copied={copied[copyKey]}
				onCopy={() => copyToClipboard(copyKey, boss.clause)}
				hint={t('app.filter.raid_counter_hint', { params: { boss: boss.name } })}
			/>
		);
	};
	const hasEvents = (eventGroups || []).length > 0;
	return (
		<Collapsible icon={icon} label={headerLabel} open={open} onToggle={onToggle}>
			<div className='space-y-5'>
				{/* tiers below; footer rendered at end */}
				{hasEvents && (
					<div className='space-y-3'>
						<h4 className='mono text-xs uppercase tracking-wide text-[#8090A0]'>
							{t('app.collapsible.aux_event_raids_heading')}
						</h4>
						{eventGroups.map((event) => {
							const startMs = Date.parse(event.start);
							const endMs = Date.parse(event.end);
							const isActive = Date.now() >= startMs && Date.now() <= endMs;
							const teaser = formatEventWindow(event.start, event.end, t, locale);
							return (
								<TrainerAccordion
									key={event.eventID}
									name={event.name}
									teaser={teaser}
									accent={accent}
									highlight={isActive}
								>
									{(event.bosses || []).map((b) => renderBossBox(b, event.eventID))}
								</TrainerAccordion>
							);
						})}
					</div>
				)}
				{tierOrder.map((tier) => {
					const list = bossesByTier?.[tier];
					if (!list || list.length === 0) return null;
					const tierTeaser = t('app.collapsible.aux_raids_count', {
						params: { count: list.length },
					});
					return (
						<TrainerAccordion
							key={tier}
							name={t(`app.collapsible.aux_boss_tier.${tier}`)}
							teaser={tierTeaser}
							accent={accent}
							highlight={false}
						>
							{list.map((boss) => renderBossBox(boss))}
						</TrainerAccordion>
					);
				})}
			</div>
			<p className='mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]'>{footerLabel}</p>
		</Collapsible>
	);
}

// Renders the event wild-spawn curation card. Each in-window event becomes a
// TrainerAccordion (active ones open by default, just-ended ones flagged for
// tidy-up) holding a three-step triage: ① keepers to favourite, ② what's still
// unsorted, ③ the trashable rest. Mirrors BossCollapsible's shape so the aux
// section stays visually consistent.
function EventSpawnCollapsible({
	icon,
	fetchedAt,
	events,
	accent,
	open,
	onToggle,
	copied,
	copyToClipboard,
	t,
	locale,
}) {
	const list = events || [];
	const age = formatSyncAge(fetchedAt, t);
	const headerLabel = t('app.collapsible.aux_events');
	const countLabel = t('app.collapsible.aux_events_count', { params: { count: list.length } });
	const footerLabel = age
		? t('app.collapsible.aux_footer', { params: { count: countLabel, age } })
		: t('app.collapsible.aux_footer_no_age', { params: { count: countLabel } });
	if (list.length === 0) {
		return (
			<Collapsible icon={icon} label={headerLabel} open={open} onToggle={onToggle}>
				<p className='text-xs italic text-[#8B98A5]'>{t('app.events.empty')}</p>
			</Collapsible>
		);
	}
	const fmtDow = new Intl.DateTimeFormat(locale, { weekday: 'short' });
	return (
		<Collapsible icon={icon} label={headerLabel} open={open} onToggle={onToggle}>
			<div className='space-y-5'>
				{list.map((ev) => {
					const startMs = Date.parse(ev.start);
					const endMs = Date.parse(ev.end);
					const now = Date.now();
					const isActive = now >= startMs && now <= endMs;
					const isEnded = now > endMs;
					const teaser = isEnded
						? t('app.events.window_ended', { params: { dow: fmtDow.format(endMs) } })
						: formatEventWindow(ev.start, ev.end, t, locale);
					// One FilterBox per non-null triage string; copy keys namespaced per
					// event so two events sharing a species don't share copy state.
					const box = (suffix, labelKey, hintKey, str, params) => {
						if (!str) return null;
						const copyKey = `event_${ev.id}_${suffix}`;
						const opts = params ? { params } : undefined;
						return (
							<FilterBox
								key={suffix}
								label={t(labelKey, opts)}
								accent={accent}
								filterStr={str}
								copied={copied[copyKey]}
								onCopy={() => copyToClipboard(copyKey, str)}
								hint={t(hintKey, opts)}
							/>
						);
					};
					const subHeading = (key) => (
						<h5 className='mono text-[11px] uppercase tracking-wide text-[#8090A0]'>{t(key)}</h5>
					);
					return (
						<TrainerAccordion
							key={ev.id}
							name={ev.title}
							teaser={teaser}
							accent={accent}
							highlight={isActive}
						>
							{box('overview', 'app.events.overview_label', 'app.events.overview_hint', ev.overview)}
							{subHeading('app.events.group_keep')}
							{box('souvenirs', 'app.events.souvenirs_label', 'app.events.souvenirs_hint', ev.souvenirs)}
							{box('keep_iv', 'app.events.keep_iv_label', 'app.events.keep_iv_hint', ev.keepIv)}
							{subHeading('app.events.group_sort')}
							{box('sort', 'app.events.sort_label', 'app.events.sort_hint', ev.sort)}
							{subHeading('app.events.group_trash')}
							{box('trash', 'app.events.trash_label', 'app.events.trash_hint', ev.trash)}
						</TrainerAccordion>
					);
				})}
			</div>
			<p className='mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]'>{footerLabel}</p>
		</Collapsible>
	);
}

function lineupHint(phases, t) {
	if (!phases || phases.length === 0) return '';
	return phases
		.filter((p) => (p.pokemons || []).length > 0)
		.map((p) => {
			const names = p.pokemons.map((pk) => pk.name).join(t('app.filter.rocket_lineup_or'));
			return t('app.filter.rocket_lineup_phase', { params: { slot: p.slot, names } });
		})
		.join(' ');
}

function topHitsHint(topHits, t) {
	if (!topHits || topHits.length === 0) return '';
	return topHits
		.map((h) =>
			t('app.filter.rocket_top_hit', {
				params: { type: h.localizedType || h.type, hits: h.hits, total: h.total },
			}),
		)
		.join(' · ');
}

// Uncontrolled accordion row used both for Rocket trainers and for raid /
// Max Battle tiers. Native <details> handles its own open/close state — no
// React state plumbing needed, and multiple rows can stay open at once.
// Mirrors the visual rhythm of the parent Collapsible but a half-step smaller.
function TrainerAccordion({ name, teaser, accent, highlight, children }) {
	// `highlight` (used when the quote-lookup widget locks onto this card):
	// forces the accordion open and adds a colored ring so the user can see
	// the match instantly. Re-mounts the <details> via key={highlight} so the
	// browser respects the change of `open` after the user toggled it.
	return (
		<details
			key={highlight ? 'open' : 'auto'}
			open={highlight || undefined}
			className='border rounded bg-[#0E141A] transition'
			style={{
				borderColor: highlight ? '#5EAFC5' : '#1F2933',
				boxShadow: highlight ? '0 0 0 2px rgba(94, 175, 197, 0.25)' : 'none',
			}}
		>
			<summary className='px-3 py-2 cursor-pointer flex items-center gap-3 hover:bg-[#141A21] transition list-none'>
				<ChevronRight size={12} className='text-[#8090A0] details-arrow shrink-0' />
				<span className='mono text-sm font-medium' style={{ color: accent || '#E6EDF3' }}>
					{name}
				</span>
				{teaser && <span className='mono text-[11px] text-[#8090A0] truncate'>· {teaser}</span>}
			</summary>
			<div className='px-3 pb-3 pt-2 border-t border-[#1F2933] space-y-3'>{children}</div>
		</details>
	);
}

// Compact teaser strings for the closed accordion state. Keep these short —
// they share a row with the trainer name and ellipsize.
function leaderTeaser(leader, t) {
	const phases = (leader.phases || []).filter((p) => !p.skipped);
	return t('app.filter.rocket_teaser_leader', { params: { count: phases.length } });
}
function typedGruntTeaser(g, t) {
	const allNames = (g.phases || []).flatMap((p) => (p.pokemons || []).map((pk) => pk.name));
	const sample = [...new Set(allNames)].slice(0, 3).join(', ');
	return sample;
}
function genericGruntTeaser(g, t) {
	if (!g.topHits || g.topHits.length === 0) return '';
	return t('app.filter.rocket_teaser_generic', {
		params: { types: g.topHits.map((h) => h.localizedType || h.type).join(', ') },
	});
}

// Combines the universal charger filter and the per-boss Max Battle counters
// into one collapsible. The charger filter (0.5s fast moves & dynamax-eligible)
// applies regardless of boss, so it sits at the top above the per-tier boss
// fan-out. Footer shows the boss-snapshot age since that's what rotates;
// the charger move list is essentially static.
function MaxBattleCollapsible({
	fetchedAt,
	maxTank,
	bossesByTier,
	tierOrder,
	accent,
	open,
	onToggle,
	copied,
	copyToClipboard,
	t,
}) {
	const allBosses = tierOrder.flatMap((tier) => bossesByTier?.[tier] || []);
	const totalBosses = allBosses.length;
	const hasCharger = !!maxTank?.clause;
	const filterCount = totalBosses + (hasCharger ? 1 : 0);
	const age = formatSyncAge(fetchedAt, t);
	const headerLabel = t('app.collapsible.aux_max_battles');
	const countLabel = t('app.collapsible.aux_max_battles_count', { params: { count: filterCount } });
	const footerLabel = age
		? t('app.collapsible.aux_footer', { params: { count: countLabel, age } })
		: t('app.collapsible.aux_footer_no_age', { params: { count: countLabel } });
	if (filterCount === 0) {
		return (
			<Collapsible icon='💥' label={headerLabel} open={open} onToggle={onToggle}>
				<p className='text-xs italic text-[#8B98A5]'>{t('app.filter.aux_bosses_empty')}</p>
			</Collapsible>
		);
	}
	const hasBosses = totalBosses > 0;
	return (
		<Collapsible icon='💥' label={headerLabel} open={open} onToggle={onToggle}>
			<div className='space-y-5'>
				{hasCharger && (
					<div className='space-y-3'>
						<h4 className='mono text-xs uppercase tracking-wide text-[#8090A0]'>
							{t('app.collapsible.aux_max_tank')}
						</h4>
						<FilterBox
							label={t('app.filter.max_tank_label')}
							accent='#1ABC9C'
							filterStr={maxTank.clause}
							copied={copied.max_tank}
							onCopy={() => copyToClipboard('max_tank', maxTank.clause)}
							hint={t('app.filter.max_tank_hint')}
						/>
					</div>
				)}
				{hasBosses && (
					<div className='space-y-4'>
						<h4 className='mono text-xs uppercase tracking-wide text-[#8090A0]'>
							{t('app.collapsible.aux_max_attacker')}
						</h4>
						{tierOrder.map((tier) => {
							const list = bossesByTier?.[tier];
							if (!list || list.length === 0) return null;
							const tierTeaser = t('app.collapsible.aux_raids_count', {
								params: { count: list.length },
							});
							return (
								<TrainerAccordion
									key={tier}
									name={t(`app.collapsible.aux_boss_tier.${tier}`)}
									teaser={tierTeaser}
									accent={accent}
									highlight={false}
								>
									{list.map((boss) => {
										if (boss.skipped) {
											return (
												<p key={boss.id} className='text-xs italic text-[#8B98A5] pl-2'>
													{t('app.filter.boss_no_clean_counter', {
														params: { boss: boss.name },
													})}
												</p>
											);
										}
										const copyKey = `max_${boss.id}`;
										return (
											<FilterBox
												key={boss.id}
												label={t('app.filter.raid_counter_label', {
													params: { boss: boss.name },
												})}
												accent={accent}
												filterStr={boss.clause}
												copied={copied[copyKey]}
												onCopy={() => copyToClipboard(copyKey, boss.clause)}
												hint={t('app.filter.raid_counter_hint', {
													params: { boss: boss.name },
												})}
											/>
										);
									})}
								</TrainerAccordion>
							);
						})}
					</div>
				)}
			</div>
			<p className='mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]'>{footerLabel}</p>
		</Collapsible>
	);
}

// One filter per league (Great / Ultra / Master) plus zero-or-more
// active-cup filters (Fantasy / Jungle / Catch / etc.) when a themed
// rotation is currently running. Cups inherit the league filter shape
// (species OR-list + CP cap + loose IV pattern), so the only visual
// difference is the active-window teaser borrowed from the event-raids
// strip.
function PvpCollapsible({ fetchedAt, leagues, cupFilters, open, onToggle, copied, copyToClipboard, t, locale }) {
	const order = ['great', 'ultra', 'master'];
	const accentByLeague = { great: '#3498DB', ultra: '#9B59B6', master: '#F1C40F' };
	const populated = order.filter((k) => leagues?.[k] && !leagues[k].skipped);
	const cups = (cupFilters || []).filter((c) => c?.clause);
	const totalCount = populated.length + cups.length;
	const age = formatSyncAge(fetchedAt, t);
	const headerLabel = t('app.collapsible.aux_pvp');
	const countLabel = t('app.collapsible.aux_pvp_count', { params: { count: totalCount } });
	const footerLabel = age
		? t('app.collapsible.aux_footer', { params: { count: countLabel, age } })
		: t('app.collapsible.aux_footer_no_age', { params: { count: countLabel } });
	if (totalCount === 0) {
		return (
			<Collapsible icon='🥊' label={headerLabel} open={open} onToggle={onToggle}>
				<p className='text-xs italic text-[#8B98A5]'>{t('app.filter.aux_pvp_empty')}</p>
			</Collapsible>
		);
	}
	return (
		<Collapsible icon='🥊' label={headerLabel} open={open} onToggle={onToggle}>
			<div className='space-y-4'>
				{populated.map((key) => {
					const league = leagues[key];
					const copyKey = `pvp_${key}`;
					return (
						<FilterBox
							key={copyKey}
							label={t(`app.filter.pvp_${key}_label`)}
							accent={accentByLeague[key]}
							filterStr={league.clause}
							copied={copied[copyKey]}
							onCopy={() => copyToClipboard(copyKey, league.clause)}
							hint={t(`app.filter.pvp_${key}_hint`)}
						/>
					);
				})}
				{cups.length > 0 && (
					<div className='space-y-3 pt-3 border-t border-[#1F2933]'>
						<h4 className='mono text-xs uppercase tracking-wide text-[#8090A0]'>
							{t('app.collapsible.aux_pvp_cups_heading')}
						</h4>
						{cups.map((cup) => {
							const copyKey = `pvp_cup_${cup.id}`;
							const teaser = formatEventWindow(cup.start, cup.end, t, locale);
							return (
								<FilterBox
									key={copyKey}
									label={t('app.filter.pvp_cup_label', { params: { name: cup.name, teaser } })}
									accent='#1ABC9C'
									filterStr={cup.clause}
									copied={copied[copyKey]}
									onCopy={() => copyToClipboard(copyKey, cup.clause)}
									hint={t('app.filter.pvp_cup_hint', { params: { name: cup.name, cap: cup.cpCap } })}
								/>
							);
						})}
					</div>
				)}
			</div>
			<p className='mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]'>{footerLabel}</p>
		</Collapsible>
	);
}

// Renders the in-game "Spruch" the grunt yells before battle, in the
// player's outputLocale. Displayed inside open trainer accordions so the
// user can match the encounter dialog they just saw in PoGo.
function GruntQuoteLine({ quote, t }) {
	return (
		<div className='mono italic text-[11.5px] leading-snug text-[#A8B3BD]'>
			<span className='not-italic text-[#8090A0] mr-1.5'>{t('app.filter.rocket_grunt_quote_label')}:</span>
			&ldquo;{quote}&rdquo;
		</div>
	);
}
function GruntQuoteList({ quotes, t }) {
	return (
		<div className='space-y-0.5'>
			{quotes.map((q, i) => (
				<GruntQuoteLine key={i} quote={q} t={t} />
			))}
		</div>
	);
}

function RocketCollapsible({
	fetchedAt,
	leaders,
	typedGrunts,
	genericGrunts,
	typeLabels,
	lenientCounters,
	open,
	onToggle,
	copied,
	copyToClipboard,
	t,
	outputLocale,
}) {
	const [highlightedType, setHighlightedType] = useState(null);
	const totalFilters =
		leaders.reduce((a, l) => a + l.phases.filter((p) => !p.skipped).length, 0) +
		typedGrunts.filter((g) => !g.skipped).length +
		genericGrunts.filter((g) => !g.skipped).length;
	const age = formatSyncAge(fetchedAt, t);
	const headerLabel = t('app.collapsible.aux_rocket');
	const countLabel = t('app.collapsible.aux_rocket_count', { params: { count: totalFilters } });
	const footerLabel = age
		? t('app.collapsible.aux_footer', { params: { count: countLabel, age } })
		: t('app.collapsible.aux_footer_no_age', { params: { count: countLabel } });
	if (totalFilters === 0) {
		return (
			<Collapsible icon='🚀' label={headerLabel} open={open} onToggle={onToggle}>
				<p className='text-xs italic text-[#8B98A5]'>{t('app.filter.aux_rocket_empty')}</p>
			</Collapsible>
		);
	}
	return (
		<Collapsible icon='🚀' label={headerLabel} open={open} onToggle={onToggle}>
			<div className='space-y-5'>
				<RocketQuoteLookup
					data={ROCKET_GRUNT_QUOTES}
					outputLocale={outputLocale}
					t={t}
					onTypedMatch={setHighlightedType}
					localizedTypeDisplay={(k) => (typeLabels && typeLabels[k]) || k}
				/>
				{leaders.length > 0 && (
					<div className='space-y-2'>
						<h4 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
							{t('app.collapsible.aux_rocket_leaders')}
						</h4>
						<div className='space-y-1.5'>
							{leaders.map((leader) => (
								<TrainerAccordion
									key={leader.name}
									name={leader.name}
									teaser={leaderTeaser(leader, t)}
									accent='#C0392B'
								>
									{leader.phases.map((phase) => {
										if (phase.skipped) return null;
										const copyKey = `rocket_${leader.name}_${phase.slot}`;
										const lenientKey = `${copyKey}_lenient`;
										return (
											<Fragment key={copyKey}>
												<FilterBox
													label={t('app.filter.rocket_phase_label', {
														params: { slot: phase.slot },
													})}
													accent='#C0392B'
													filterStr={phase.clause}
													copied={copied[copyKey]}
													onCopy={() => copyToClipboard(copyKey, phase.clause)}
													hint={t('app.filter.rocket_phase_hint', {
														params: {
															names: phase.pokemons
																.map((p) => p.name)
																.join(t('app.filter.rocket_lineup_or')),
														},
													})}
												/>
												{lenientCounters && phase.lenient?.clause && (
													<FilterBox
														label={t('app.filter.rocket_phase_label_lenient', {
															params: { slot: phase.slot },
														})}
														accent='#E08E0B'
														filterStr={phase.lenient.clause}
														copied={copied[lenientKey]}
														onCopy={() => copyToClipboard(lenientKey, phase.lenient.clause)}
														hint={t('app.filter.rocket_lenient_hint')}
													/>
												)}
											</Fragment>
										);
									})}
								</TrainerAccordion>
							))}
						</div>
					</div>
				)}

				{typedGrunts.length > 0 && (
					<div className='space-y-2'>
						<h4 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
							{t('app.collapsible.aux_rocket_typed_grunts')}
						</h4>
						<div className='space-y-1.5'>
							{typedGrunts.map((g) => {
								if (g.skipped) return null;
								const copyKey = `rocket_typed_${g.type}`;
								return (
									<TrainerAccordion
										key={copyKey}
										name={g.name}
										teaser={typedGruntTeaser(g, t)}
										accent='#9B59B6'
										highlight={g.type === highlightedType}
									>
										{g.quote && <GruntQuoteLine quote={g.quote} t={t} />}
										<FilterBox
											label={t('app.filter.rocket_grunt_filter_label')}
											accent='#9B59B6'
											filterStr={g.clause}
											copied={copied[copyKey]}
											onCopy={() => copyToClipboard(copyKey, g.clause)}
											hint={lineupHint(g.phases, t)}
										/>
										{lenientCounters && g.lenient?.clause && (
											<FilterBox
												label={t('app.filter.rocket_grunt_filter_label_lenient')}
												accent='#E08E0B'
												filterStr={g.lenient.clause}
												copied={copied[`${copyKey}_lenient`]}
												onCopy={() => copyToClipboard(`${copyKey}_lenient`, g.lenient.clause)}
												hint={t('app.filter.rocket_lenient_hint')}
											/>
										)}
									</TrainerAccordion>
								);
							})}
						</div>
					</div>
				)}

				{genericGrunts.length > 0 && (
					<div className='space-y-2'>
						<h4 className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
							{t('app.collapsible.aux_rocket_generic_grunts')}
						</h4>
						<div className='space-y-1.5'>
							{genericGrunts.map((g) => {
								if (g.skipped) return null;
								const copyKey = `rocket_generic_${g.name}`;
								return (
									<TrainerAccordion
										key={copyKey}
										name={g.name}
										teaser={genericGruntTeaser(g, t)}
										accent='#16A085'
									>
										{(g.quotes || []).length > 0 && <GruntQuoteList quotes={g.quotes} t={t} />}
										<FilterBox
											label={t('app.filter.rocket_grunt_filter_label')}
											accent='#16A085'
											filterStr={g.clause}
											copied={copied[copyKey]}
											onCopy={() => copyToClipboard(copyKey, g.clause)}
											hint={`${topHitsHint(g.topHits, t)} — ${lineupHint(g.phases, t)}`}
										/>
									</TrainerAccordion>
								);
							})}
						</div>
					</div>
				)}
			</div>
			<p className='mono text-[10.5px] text-[#8090A0] mt-4 pt-3 border-t border-[#1F2933]'>{footerLabel}</p>
		</Collapsible>
	);
}

function SetTheory({ hundos, luckies, luckyHundoSet, TE_full, TE_trim, cfg }) {
	const { t } = useTranslation();
	const Pdesc =
		cfg.pvpMode === 'loose'
			? '(0-1, 3-4, 3-4)'
			: cfg.pvpMode === 'strict'
				? '(0, 3-4, 3-4)'
				: cfg.pvpMode === 'intelligent'
					? t('app.set_theory.p_intelligent')
					: t('app.set_theory.p_disabled');
	// Rule-1 help splits around the bold {auto} marker so we keep it styled as <em>.
	const autoMarker = t('app.set_theory.rule1_help_auto');
	const ruleParts = t('app.set_theory.rule1_help', { params: { auto: autoMarker } }).split(autoMarker);
	const luckyCount = (luckies || []).length;
	const hlCount = luckyHundoSet ? luckyHundoSet.size : 0;
	return (
		<div className='mono text-xs text-[#A8B3BD] leading-relaxed space-y-3'>
			<div className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5'>
				<span className='text-[#5EAFC5]'>H</span>
				<span>
					= {`{${t('app.set_theory.h_value', { params: { count: hundos.length } })}}`} →{' '}
					{t('app.set_theory.h_note')} <code className='text-[#E6EDF3]'>+species</code>
				</span>
				<span className='text-[#F5B82E]'>L</span>
				<span>
					= {`{${t('app.set_theory.l_value', { params: { count: luckyCount } })}}`}{' '}
					<span className='text-[#8090A0]'>— {t('app.set_theory.l_note')}</span>
				</span>
				<span className='text-[#F5B82E]'>H ∩ L</span>
				<span>
					= {`{${t('app.set_theory.hl_value', { params: { count: hlCount } })}}`}{' '}
					<span className='text-[#8090A0]'>— {t('app.set_theory.hl_note')}</span>
				</span>
				<span className='text-[#5EAFC5]'>K</span>
				<span>
					= (4,4,3-4) ∪ (4,3-4,4) ∪ (3-4,4,4){' '}
					<span className='text-[#8090A0]'>— {t('app.set_theory.k_note')}</span>
				</span>
				<span className='text-[#5EAFC5]'>P</span>
				<span>
					= {Pdesc} <span className='text-[#8090A0]'>— {t('app.set_theory.p_note')}</span>
				</span>
				<span className='text-[#5EAFC5]'>S012</span>
				<span>= 0★ ∪ 1★ ∪ 2★</span>
				<span className='text-[#5EAFC5]'>TE</span>
				<span>
					= {`{${t('app.set_theory.te_value', { params: { count: TE_full.length } })}}`}{' '}
					{t('app.set_theory.te_note', { params: { count: TE_trim.length } })}
				</span>
			</div>
			<hr className='border-[#1F2933]' />
			<div className='space-y-1.5'>
				<div className='text-[#E74C3C]'>
					{t('app.set_theory.trash_label')}
					<span className='text-[#8090A0]'> = (S012 ∪ (H ∩ ¬K)) ∩ ¬P ∩ ¬Prot</span>
				</div>
				<div className='text-[#5EAFC5]'>
					{t('app.set_theory.trade_label')}
					<span className='text-[#8090A0]'>
						{' '}
						= (S012 ∪ TE ∪ ((H − (H ∩ L)) ∩ ¬K)) ∩ ¬P ∩ ¬S4 ∩ ¬Prot ∩ ¬Traded
					</span>
				</div>
			</div>
			<div className='text-[#8090A0] text-[10.5px] leading-relaxed pt-2'>
				<span className='text-[#F5B82E]'>▲</span> {ruleParts[0]}
				<em>{autoMarker}</em>
				{ruleParts[1] || ''}
			</div>
		</div>
	);
}

function RawClausesPanel({
	trashClauses,
	tradeClauses,
	sortClauses,
	luckySortClauses,
	nundoSortClauses,
	prestagedClauses,
	giftClauses,
	buddyCatchFilters,
}) {
	const { t } = useTranslation();
	return (
		<div className='space-y-5 mono text-xs'>
			<div className='text-[#8090A0] leading-relaxed'>{t('app.clauses.intro')}</div>

			<ClauseList title={t('app.clauses.trash_title')} accent='#E74C3C' clauses={trashClauses} />
			<ClauseList title={t('app.clauses.trade_title')} accent='#5EAFC5' clauses={tradeClauses} />
			{sortClauses && sortClauses.length > 0 && (
				<ClauseList title={t('app.clauses.sort_title')} accent='#F5B82E' clauses={sortClauses} />
			)}
			{luckySortClauses && luckySortClauses.length > 0 && (
				<ClauseList title={t('app.clauses.lucky_sort_title')} accent='#F5B82E' clauses={luckySortClauses} />
			)}
			{nundoSortClauses && nundoSortClauses.length > 0 && (
				<ClauseList title={t('app.clauses.nundo_sort_title')} accent='#F5B82E' clauses={nundoSortClauses} />
			)}
			{prestagedClauses && prestagedClauses.length > 0 && (
				<ClauseList title={t('app.clauses.prestaged_title')} accent='#9B59B6' clauses={prestagedClauses} />
			)}
			{giftClauses && giftClauses.length > 0 && (
				<ClauseList title={t('app.clauses.gift_title')} accent='#27AE60' clauses={giftClauses} />
			)}
			{buddyCatchFilters &&
				buddyCatchFilters.length > 0 &&
				buddyCatchFilters.map((b) => (
					<ClauseList
						key={`catch:${b.prefix}`}
						title={t('app.buddy_catch.filter_label', { params: { name: b.buddyName } })}
						accent='#E67E22'
						clauses={b.clauses}
					/>
				))}
		</div>
	);
}

function ClauseList({ title, accent, clauses }) {
	const { t } = useTranslation();
	return (
		<div>
			<div className='mono text-[10.5px] uppercase tracking-wider mb-2' style={{ color: accent }}>
				{title} · {t('app.clauses.count_suffix', { params: { count: clauses.length } })}
			</div>
			<div className='border border-[#1F2933] rounded divide-y divide-[#1F2933]'>
				{clauses.map((c, i) => (
					<div key={i} className='px-3 py-2 hover:bg-[#141A21] transition'>
						<div className='flex items-baseline gap-2'>
							<span className='text-[10px] text-[#8090A0] flex-shrink-0'>{i + 1}.</span>
							<code className='text-[#E6EDF3] flex-1 break-all'>{c.clause}</code>
						</div>
						<div className='text-[10.5px] text-[#8090A0] mt-1 ml-5 leading-tight'>{c.why}</div>
					</div>
				))}
			</div>
		</div>
	);
}

function VerifyPanel({ trash, trade, hundos, outputLocale = 'de' }) {
	const { t } = useTranslation();
	// Raw 0-15 IVs (what the in-game appraisal screen shows). Bars and star
	// rating are DERIVED — see ivToBar/starFromIVs — so the tester can't
	// represent an impossible mon. Default 10/10/10 = 2/2/2 bars, 2★.
	const [m, setM] = useState({
		family: '',
		tags: '',
		ivAtk: 10,
		ivDef: 10,
		ivHp: 10,
		flags: {},
		types: [],
	});
	function setFlag(k, v) {
		setM({ ...m, flags: { ...m.flags, [k]: v } });
	}

	// Build mon for parser. Family expansion uses the multi-locale resolver so
	// the user can type a family in any language.
	const mon = useMemo(() => {
		const fam = m.family.trim().toLowerCase().replace(/^\+/, '');
		let families = fam ? [fam] : [];
		let dex = 0;
		if (fam) {
			const info = resolveSpeciesInfo(fam);
			if (info) {
				dex = info.dex;
				// Widen to the whole candy family. This used to widen only across the
				// 10 TRADE_EVO_FAMILIES, which left the hundo union clause
				// (`0*,1*,2*,+pikachu`) reporting a Raichu as safe even though the
				// real search matches it through `+pikachu`.
				families = [...new Set([...families, ...candyFamilyNames(fam, outputLocale)])];
			}
		}
		return {
			...m,
			// Free-text tag list, so `#Trade` / league / buddy-prefix clauses are
			// evaluated against something real instead of coming back unparseable.
			tags: m.tags
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
			// Filter terms consume bars (0attack..4attack) and stars — both
			// derived from the raw IVs so they can never contradict each other.
			atk: ivToBar(m.ivAtk),
			def: ivToBar(m.ivDef),
			hp: ivToBar(m.ivHp),
			star: starFromIVs(m.ivAtk, m.ivDef, m.ivHp),
			families,
			// Derived from the typed species, never user-set: bare species literals
			// (`!Corasonn`, the Meltan/Melmetal trade carve-out) compare on dex first.
			dex,
			// Gigantamax-capable is physically a subset of Dynamax-capable, so a mon
			// marked Giga in the tester is implicitly Dyna too — otherwise the
			// verifier could represent an impossible giga-but-not-dyna state.
			flags: { ...m.flags, dynamaxCapable: m.flags.dynamaxCapable || m.flags.gigantamaxCapable },
			wp: 1500,
			ageDays: 5,
			distance: m.flags.farDistance ? 200 : 0,
			year: 2025,
		};
	}, [m, outputLocale]);

	const inTrash = useMemo(() => evalFilterDetailed(trash, mon, outputLocale), [trash, mon, outputLocale]);
	const inTrade = useMemo(() => evalFilterDetailed(trade, mon, outputLocale), [trade, mon, outputLocale]);
	// Keyed on the typed species alone, as a string. `mon` is rebuilt whenever any
	// field changes and hands back a fresh `families` array each time, so keying on
	// the array would re-resolve every hundo on every IV/flag/tag keystroke.
	const familyKey = mon.families[0] || '';
	const inH = useMemo(() => hundoFamilyMatch(hundos, familyKey), [hundos, familyKey]);

	const flagToggles = [
		['favorite', 'app.verify.flag_fav'],
		['tagged', 'app.verify.flag_tag'],
		['shiny', 'app.verify.flag_shiny'],
		['lucky', 'app.verify.flag_lucky'],
		['legendary', 'app.verify.flag_legend'],
		['mythical', 'app.verify.flag_myth'],
		['shadow', 'app.verify.flag_crypto'],
		['legacyMove', 'app.verify.flag_legacy'],
		['megaEvolved', 'app.verify.flag_mega'],
		['dynamaxCapable', 'app.verify.flag_dyna'],
		['gigantamaxCapable', 'app.verify.flag_giga'],
		['doubleMoved', 'app.verify.flag_double_move'],
		['xxl', 'app.verify.flag_xxl'],
		['xl', 'app.verify.flag_xl'],
		['xxs', 'app.verify.flag_xxs'],
		['leagueU', 'app.verify.flag_league_u'],
		['buddy', 'app.verify.flag_buddy'],
	];

	return (
		<div className='space-y-4'>
			<div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
				<FieldText
					label={t('app.verify.field_family')}
					value={m.family}
					onChange={(v) => setM({ ...m, family: v })}
					placeholder={t('app.verify.placeholder_family')}
				/>
				<FieldText
					label={t('app.verify.field_tags')}
					value={m.tags}
					onChange={(v) => setM({ ...m, tags: v })}
					placeholder={t('app.verify.placeholder_tags')}
				/>
				<FieldNum
					label={t('app.verify.field_atk')}
					value={m.ivAtk}
					onChange={(v) => setM({ ...m, ivAtk: Math.max(0, Math.min(15, +v || 0)) })}
					min={0}
					max={15}
				/>
				<FieldNum
					label={t('app.verify.field_def')}
					value={m.ivDef}
					onChange={(v) => setM({ ...m, ivDef: Math.max(0, Math.min(15, +v || 0)) })}
					min={0}
					max={15}
				/>
				<FieldNum
					label={t('app.verify.field_hp')}
					value={m.ivHp}
					onChange={(v) => setM({ ...m, ivHp: Math.max(0, Math.min(15, +v || 0)) })}
					min={0}
					max={15}
				/>
				{/* Star + bars are read-only: PoGo derives them from the IVs, so the
				    tester does too (no impossible 4★-with-1/1/1 states). */}
				<div title={t('app.verify.star_derived_help')}>
					<label className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.verify.field_star')}
					</label>
					<div className='mono text-xs w-full bg-[#0B0F14] border border-[#1F2933] px-2 py-1.5 rounded text-[#E6EDF3] mt-1'>
						{mon.star}★ <span className='text-[#8090A0]'>· {mon.atk}/{mon.def}/{mon.hp}</span>
					</div>
				</div>
			</div>

			<div className='flex flex-wrap gap-1.5'>
				{flagToggles.map(([k, labelKey]) => (
					<button
						key={k}
						onClick={() => setFlag(k, !m.flags[k])}
						aria-pressed={!!m.flags[k]}
						className={`mono text-[11px] px-2 py-1 rounded transition ${
							m.flags[k]
								? 'bg-[#5EAFC5] text-[#0F1419]'
								: 'bg-[#1F2933] text-[#8B98A5] hover:bg-[#2D3A47]'
						}`}
					>
						{t(labelKey)}
					</button>
				))}
			</div>

			<div className='grid grid-cols-2 gap-3 mt-2'>
				<ResultBox label={t('app.filter.trash_label')} result={inTrash} accent='#E74C3C' />
				<ResultBox label={t('app.filter.trade_label')} result={inTrade} accent='#5EAFC5' />
			</div>
			<div className='mono text-[11px] text-[#8090A0]'>
				{t('app.verify.family_in_h')}{' '}
				<span className={inH ? 'text-[#5EAFC5]' : 'text-[#8090A0]'}>
					{inH ? t('app.verify.yes') : t('app.verify.no')}
				</span>
				<span className='mx-2'>·</span>
				{t('app.verify.iv_class')} {classifyIV(mon.atk, mon.def, mon.hp, t)}
			</div>
		</div>
	);
}

// PoGo derives the appraisal star rating FROM the IVs — they are not
// independently settable in the game, so the verify tester must not allow
// impossible combinations (a 4★ with 1/1/1 bars). Raw per-stat IVs are 0-15;
// the search-syntax "bars" (0attack..4attack) bucket each stat, and the star
// rating buckets the total: 0-22 → 0★, 23-29 → 1★, 30-36 → 2★, 37-44 → 3★,
// 45 → 4★ (the hundo).
export const ivToBar = (iv) => (iv >= 15 ? 4 : iv >= 11 ? 3 : iv >= 6 ? 2 : iv >= 1 ? 1 : 0);
export function starFromIVs(atk, def, hp) {
	const total = atk + def + hp;
	return total === 45 ? 4 : total >= 37 ? 3 : total >= 30 ? 2 : total >= 23 ? 1 : 0;
}

function classifyIV(a, d, h, t) {
	const isP = a <= 1 && d >= 3 && h >= 3;
	const k1 = a === 4 && d === 4 && h >= 3;
	const k2 = a === 4 && d >= 3 && h === 4;
	const k3 = a >= 3 && d === 4 && h === 4;
	if (k1 || k2 || k3) return <span className='text-[#5EAFC5]'>{t('app.verify.k_keeper')}</span>;
	if (isP) return <span className='text-[#F5B82E]'>{t('app.verify.p_pvp')}</span>;
	return <span className='text-[#8090A0]'>{t('app.verify.neither')}</span>;
}

// Three states, because the evaluator has three answers. The amber "can't tell"
// is deliberately louder than the grey "hidden": a user reads this box seconds
// before a permanent mass transfer, so an honest "I don't know" has to be
// impossible to mistake for an all-clear.
const VERDICT_UNKNOWN_ACCENT = '#D9A441';
function ResultBox({ label, result, accent }) {
	const { t } = useTranslation();
	const verdict = result?.verdict ?? false;
	const unknown = result?.unknown || [];
	const isUnknown = verdict === null;
	const color = isUnknown ? VERDICT_UNKNOWN_ACCENT : verdict ? accent : '#8090A0';
	return (
		<div
			className='border rounded p-3'
			style={{ borderColor: isUnknown || verdict ? color : '#1F2933' }}
			role={isUnknown ? 'alert' : undefined}
		>
			<div className='mono text-[11px] uppercase tracking-wider text-[#8090A0]'>{label}</div>
			<div className='mono text-lg font-bold mt-1' style={{ color }}>
				{isUnknown ? t('app.verify.unknown') : verdict ? t('app.verify.visible') : t('app.verify.hidden')}
			</div>
			{isUnknown && (
				<div className='mono text-[10.5px] mt-1 leading-snug' style={{ color: VERDICT_UNKNOWN_ACCENT }}>
					{t('app.verify.unknown_hint', { params: { terms: [...new Set(unknown)].join(', ') } })}
				</div>
			)}
		</div>
	);
}

// The label is a sibling rather than a wrapper, so it needs an explicit
// htmlFor/id pair to name the input — without one the accessible name falls
// back to the placeholder, which is example text, not the field's purpose (and
// vanishes once the user types). useId keeps the pair unique across the many
// instances of these fields on one screen.
function FieldText({ label, value, onChange, placeholder }) {
	const id = useId();
	return (
		<div>
			<label htmlFor={id} className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>{label}</label>
			<input
				id={id}
				type='text'
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className='mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] placeholder:text-[#8090A0] mt-1'
			/>
		</div>
	);
}
function FieldNum({ label, value, onChange, min, max }) {
	const id = useId();
	return (
		<div>
			<label htmlFor={id} className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>{label}</label>
			<input
				id={id}
				type='number'
				value={value}
				onChange={(e) => onChange(e.target.value)}
				min={min}
				max={max}
				className='mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1'
			/>
		</div>
	);
}

// ─── PRESETS ────────────────────────────────────────────────────────────────

const PRESETS = {
	casual: {
		labelKey: 'app.preset.casual.label',
		descriptionKey: 'app.preset.casual.description',
		apply: (cfg) => ({
			...cfg,
			pvpMode: 'strict',
			protectFavorites: true,
			protectShinies: true,
			protectLuckies: true,
			protectLegendaries: true,
			protectMythicals: true,
			protectUltraBeasts: true,
			protectShadows: true,
			protectPurified: true,
			protectCostumes: true,
			protectBackgrounds: true,
			protectLegacyMoves: true,
			protectBabies: true,
			protectXXL: true,
			protectXL: true,
			protectXXS: true,
			protectDoubleMoved: true,
			protectDynamax: true,
			protectGigantamax: true,
			protectNewEvolutions: true,
			protectBuddies: true,
			protectLuckyEligible: true,
			luckyEligibleYear: 21,
			regionalGroups: defaultRegionalToggles(),
		}),
	},
	collector: {
		labelKey: 'app.preset.collector.label',
		descriptionKey: 'app.preset.collector.description',
		apply: (cfg) => {
			// Maximalist preset: every regional form on, including C-tier base
			// Alolan/Galarian junk that the recommended default skips.
			const groups = defaultRegionalToggles();
			for (const k of Object.keys(groups)) {
				groups[k].enabled = true;
				groups[k].typeChecksEnabled = null;
				groups[k].collectorsEnabled = null;
			}
			return {
				...cfg,
				pvpMode: 'none',
				protectFavorites: true,
				protectShinies: true,
				protectLuckies: true,
				protectLegendaries: true,
				protectMythicals: true,
				protectUltraBeasts: true,
				protectShadows: true,
				protectPurified: true,
				protectCostumes: true,
				protectBackgrounds: true,
				protectLegacyMoves: true,
				protectBabies: true,
				protectXXL: true,
				protectXL: true,
				protectXXS: true,
				protectDoubleMoved: true,
				protectDynamax: true,
				protectGigantamax: true,
				protectNewEvolutions: true,
				protectBuddies: true,
				protectLuckyEligible: true,
				luckyEligibleYear: 21,
				regionalGroups: groups,
			};
		},
	},
	aggressive: {
		labelKey: 'app.preset.aggressive.label',
		descriptionKey: 'app.preset.aggressive.description',
		apply: (cfg) => {
			const groups = defaultRegionalToggles();
			for (const k of Object.keys(groups)) groups[k].enabled = false;
			return {
				...cfg,
				pvpMode: 'strict',
				protectFavorites: true,
				protectShinies: true,
				protectLuckies: true,
				protectLegendaries: true,
				protectMythicals: true,
				protectUltraBeasts: true,
				protectShadows: true,
				protectPurified: true,
				protectCostumes: true,
				protectBackgrounds: true,
				protectLegacyMoves: true,
				protectBabies: false,
				protectXXL: false,
				protectXL: false,
				protectXXS: false,
				protectDoubleMoved: true,
				protectDynamax: true,
				protectGigantamax: true,
				protectNewEvolutions: false,
				protectBuddies: false,
				protectLuckyEligible: true,
				luckyEligibleYear: 21,
				regionalGroups: groups,
			};
		},
	},
	pvpFocus: {
		labelKey: 'app.preset.pvpFocus.label',
		descriptionKey: 'app.preset.pvpFocus.description',
		apply: (cfg) => {
			const groups = defaultRegionalToggles();
			groups.alolan.enabled = false;
			groups.galarian.enabled = false;
			groups.hisuian.enabled = false;
			groups.paldean.enabled = false;
			return {
				...cfg,
				pvpMode: 'loose',
				protectFavorites: true,
				protectShinies: true,
				protectLuckies: true,
				protectLegendaries: true,
				protectMythicals: true,
				protectUltraBeasts: true,
				protectShadows: true,
				protectPurified: true,
				protectCostumes: false,
				protectBackgrounds: false,
				protectLegacyMoves: true,
				protectBabies: false,
				protectXXL: false,
				protectXL: false,
				protectXXS: false,
				protectDoubleMoved: true,
				protectDynamax: false,
				protectGigantamax: false,
				protectNewEvolutions: false,
				protectBuddies: false,
				protectLuckyEligible: true,
				luckyEligibleYear: 21,
				regionalGroups: groups,
			};
		},
	},
};

// Settings that are HIDDEN in normal mode and only show with expert toggle on.
// These are: things most people never want to touch (Ultrabestien, Mysteriös,
// Buddies, Distance/CP/age scope, Liga-Tag custom names, etc).
const EXPERT_ONLY_KEYS = new Set([
	'protectMythicals',
	'mythTooManyOf',
	'protectUltraBeasts',
	'protectPurified',
	'protectBuddies',
	'protectLuckyEligible',
	'trashTradedRegionals',
	'leagueTags',
	'customProtectedTags',
	'cpCap',
	'ageScopeDays',
	'distanceProtect',
	'luckyEligibleYear',
	'protectNundos',
]);

// Intelligent-PvP controls, rendered under the mode radio when that mode is
// active. Two audiences share it: a normal user gets the one-tap league packs
// and a live count (the mode is inert with an empty list, so hiding the packs
// entirely would make "Intelligent" silently mean "Strict"), while expert mode
// adds the full curated chip list, free-text adding, and both IV tiers.
function PvpMetaPanel({ config, set, expert, packs, newItem, setNewItem }) {
	const { t } = useTranslation();
	const items = config.pvpMetaSpecies || [];
	const metaTier = config.pvpMetaTier || 'loose';
	const baseTier = config.pvpBaseTier || 'strict';
	// Same rank order buildFilters uses to decide whether the carve-out is
	// redundant — surfaced here so the UI can say so instead of the user
	// wondering why the string did not move.
	const RANK = { none: 0, strict: 1, loose: 2 };
	const redundant = items.length > 0 && RANK[metaTier] <= RANK[baseTier];

	function addPack(pack) {
		set('pvpMetaSpecies', [...new Set([...items, ...pack.species])].sort());
	}
	function addTyped() {
		const tokens = newItem.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const next = new Set(items);
		const unresolved = [];
		for (const tok of tokens) {
			const r = resolveSpecies(tok);
			if (r) next.add(r);
			else unresolved.push(tok);
		}
		set('pvpMetaSpecies', [...next].sort());
		setNewItem(unresolved.length > 0 ? unresolved.join(', ') : '');
	}
	function removeOne(name) {
		set(
			'pvpMetaSpecies',
			items.filter((x) => x !== name),
		);
	}

	const tierSelect = (key, value, options) => (
		<label className='mono text-[11px] text-[#8B98A5] flex flex-col gap-1'>
			{t(`app.pvp.${key === 'pvpMetaTier' ? 'meta' : 'base'}_tier_label`)}
			<select
				value={value}
				onChange={(e) => set(key, e.target.value)}
				className='mono text-xs bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
			>
				{options.map((o) => (
					<option key={o} value={o}>
						{t(`app.pvp.tier_${o}`)}
					</option>
				))}
			</select>
		</label>
	);

	return (
		<div className='mt-3 space-y-3 border border-[#1F2933] rounded p-3 bg-[#0B0F14]'>
			{items.length === 0 && (
				<p className='mono text-[11px] text-[#D9A441] leading-snug'>{t('app.pvp.meta_empty_hint')}</p>
			)}
			{redundant && (
				<p className='mono text-[11px] text-[#D9A441] leading-snug'>
					{t('app.pvp.meta_redundant_hint')}
				</p>
			)}
			{expert ? (
				<>
					<div className='flex flex-wrap gap-3'>
						{tierSelect('pvpMetaTier', metaTier, ['loose', 'strict'])}
						{tierSelect('pvpBaseTier', baseTier, ['loose', 'strict', 'none'])}
					</div>
					<SpeciesListEditor
						items={items}
						newItem={newItem}
						setNewItem={setNewItem}
						addItem={addTyped}
						removeItem={removeOne}
						titleKey='app.pvp.meta_list'
						accent='#F5B82E'
						packs={packs}
						onAddPack={addPack}
					/>
				</>
			) : (
				<>
					<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.pvp.meta_list.count', { params: { count: items.length } })}
					</div>
					<div className='flex flex-wrap gap-1.5 items-start'>
						<PackAddButtons packs={packs} items={items} onAddPack={addPack} accent='#F5B82E' />
						{items.length > 0 && (
							<button
								onClick={() => set('pvpMetaSpecies', [])}
								className='mono text-xs bg-[#1F2933] hover:bg-[#2D3A47] text-[#8B98A5] hover:text-[#E74C3C] px-2.5 py-1 rounded transition'
							>
								{t('app.pvp.meta_clear')}
							</button>
						)}
					</div>
					<p className='mono text-[10.5px] text-[#5C6975] leading-snug'>
						{t('app.pvp.meta_expert_hint')}
					</p>
				</>
			)}
		</div>
	);
}

function ConfigPanel({
	config,
	setConfig,
	homeLocals = [],
	homeLocalTypeChecks = [],
	friendCollectTargets = [],
	friendCollectSuggestions = [],
	pvpMetaPacks = [],
}) {
	const { t, outputLocale } = useTranslation();
	// "Lass Freunde für dich sammeln" — collapsed by default; the target lists
	// get long, and the section is a sibling of the buddy wish-species cards.
	const [showFriendCollect, setShowFriendCollect] = useState(false);
	// Free-text species input for the intelligent-PvP list (expert only) — the
	// raw string lives here so unresolved tokens survive a failed add, same as
	// the other SpeciesListEditor call sites in App.
	const [newPvpMeta, setNewPvpMeta] = useState('');
	// Any individual change in ConfigPanel clears the preset marker — the
	// marker means "this preset is currently in effect"; the moment the
	// user tweaks anything, that's no longer literally true.
	function set(k, v) {
		setConfig({ ...config, [k]: v, lastAppliedPreset: null });
	}
	function setGroup(groupKey, partial) {
		const groups = { ...(config.regionalGroups || {}) };
		groups[groupKey] = { ...groups[groupKey], ...partial };
		set('regionalGroups', groups);
	}
	function applyPreset(presetKey) {
		setConfig({ ...PRESETS[presetKey].apply(config), lastAppliedPreset: presetKey });
	}

	const expert = !!config.expertMode;

	// Universal protections — shown in all modes (these are the "obviously yes" ones)
	// [configKey, translationKeyBase, extra?] — labels & whys resolve via t() at
	// render time. Translation keys live in src/locales/app/{locale}.json.
	// Single ordered list: simple-mode shows non-expert rows; expert mode adds
	// the `{ expertOnly: true }` rows in-place so related toggles stay
	// visually adjacent (e.g. Smeargle carve-out next to Legacy Moves).
	const settings = [
		['protectFavorites', 'app.protect.favorites'],
		['protectFourStar', 'app.protect.four_star', { expertOnly: true, requireConfirmOff: true }],
		['protectNundos', 'app.protect.nundos', { expertOnly: true, requireConfirmOff: true }],
		['protectAnyTag', 'app.protect.any_tag'],
		['protectTradeEvos', 'app.protect.trade_evos'],
		['trashTradedRegionals', 'app.protect.trash_traded_regionals', { expertOnly: true }],
		['protectShinies', 'app.protect.shinies', { expertOnly: true }],
		['protectLuckies', 'app.protect.luckies', { expertOnly: true }],
		['protectLegendaries', 'app.protect.legendaries'],
		['protectMythicals', 'app.protect.mythicals', { expertOnly: true }],
		['protectUltraBeasts', 'app.protect.ultra_beasts', { expertOnly: true }],
		['protectShadows', 'app.protect.shadows', { expertOnly: true }],
		['protectShadowPurifyOnly', 'app.protect.shadow_purify_only', { expertOnly: true }],
		['protectPurified', 'app.protect.purified', { expertOnly: true }],
		['protectCostumes', 'app.protect.costumes'],
		['protectBackgrounds', 'app.protect.backgrounds'],
		['protectLegacyMoves', 'app.protect.legacy_moves', { expertOnly: true }],
		['protectSmeargleLegacy', 'app.protect.smeargle_legacy', { expertOnly: true }],
		['protectBabies', 'app.protect.babies'],
		['protectXXL', 'app.protect.xxl'],
		['protectXL', 'app.protect.xl'],
		['protectXXS', 'app.protect.xxs'],
		['protectNewEvolutions', 'app.protect.new_evolutions', { expertOnly: true }],
		['protectDoubleMoved', 'app.protect.double_moved', { expertOnly: true }],
		['protectDynamax', 'app.protect.dynamax', { requireConfirmOff: true }],
		['protectGigantamax', 'app.protect.gigantamax', { expertOnly: true, requireConfirmOff: true }],
		['protectBuddies', 'app.protect.buddies_protect', { expertOnly: true }],
		['protectLuckyEligible', 'app.protect.lucky_eligible', { expertOnly: true }],
	];

	return (
		<div className='space-y-6'>
			{/* Home-locals banner */}
			{homeLocals.length > 0 &&
				(() => {
					// Find all collector lists across all groups, intersect with homeLocals
					const allCollectors = Object.values(REGIONAL_GROUPS).flatMap((g) => g.collectors);
					const autoRemoved = homeLocals.filter((l) => allCollectors.includes(l));
					const removedNames =
						autoRemoved.length > 0 ? autoRemoved.join(', ') : t('app.protect.home_locals.none');
					return (
						<div className='border border-[#27AE60]/40 bg-[#27AE60]/5 rounded p-3 mono text-xs'>
							<div className='flex items-baseline gap-2'>
								<span className='text-[#27AE60]'>⌂</span>
								<div className='flex-1'>
									<div className='text-[#E6EDF3]'>
										{t('app.protect.home_locals.title_prefix')}{' '}
										<span className='text-[#27AE60]'>{removedNames}</span>
									</div>
									<div className='text-[10.5px] text-[#8090A0] mt-1'>
										{t('app.protect.home_locals.note')}
									</div>
								</div>
							</div>
						</div>
					);
				})()}

			{/* PRESETS */}
			<div>
				<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
					{t('app.preset.section_title')}
				</div>
				<div className='flex flex-wrap gap-1.5'>
					{Object.entries(PRESETS).map(([key, preset]) => {
						const active = config.lastAppliedPreset === key;
						return (
							<button
								key={key}
								onClick={() => applyPreset(key)}
								title={t(preset.descriptionKey)}
								className={`mono text-xs px-3 py-1.5 rounded transition ${
									active
										? 'bg-[#5EAFC5] text-[#0F1419]'
										: 'bg-[#1F2933] text-[#E6EDF3] hover:bg-[#5EAFC5] hover:text-[#0F1419]'
								}`}
							>
								{t(preset.labelKey)}
							</button>
						);
					})}
				</div>
				<div className='mono text-[10.5px] text-[#8090A0] mt-1.5'>{t('app.preset.section_hint')}</div>
			</div>

			<hr className='border-[#1F2933]' />

			{/* PvP MODE */}
			<div>
				<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
					{t('app.pvp.section_title')}
				</div>
				{/* Mutually exclusive, so radio semantics rather than aria-pressed:
				    the selection was conveyed by cyan fill alone, which told a screen
				    reader neither which option was active nor that these three belong
				    to one choice. */}
				<div className='flex flex-wrap gap-1.5' role='radiogroup' aria-label={t('app.pvp.section_title')}>
					{[
						['loose', 'app.pvp.loose_label', 'app.pvp.loose_desc'],
						['intelligent', 'app.pvp.intelligent_label', 'app.pvp.intelligent_desc'],
						['strict', 'app.pvp.strict_label', 'app.pvp.strict_desc'],
						['none', 'app.pvp.none_label', 'app.pvp.none_desc'],
					].map(([m, labelKey, descKey]) => (
						<button
							key={m}
							onClick={() => set('pvpMode', m)}
							role='radio'
							aria-checked={config.pvpMode === m}
							title={t(descKey)}
							className={`mono text-xs px-3 py-1.5 rounded transition ${
								config.pvpMode === m
									? 'bg-[#5EAFC5] text-[#0F1419]'
									: 'bg-[#1F2933] text-[#8B98A5] hover:bg-[#2D3A47]'
							}`}
						>
							{t(labelKey)}
						</button>
					))}
				</div>
				<p className='mono text-[11px] text-[#8B98A5] mt-2 leading-snug'>
					{t(`app.pvp.help_${config.pvpMode}`)}
				</p>
				{config.pvpMode === 'intelligent' && (
					<PvpMetaPanel
						config={config}
						set={set}
						expert={expert}
						packs={pvpMetaPacks}
						newItem={newPvpMeta}
						setNewItem={setNewPvpMeta}
					/>
				)}
			</div>

			<hr className='border-[#1F2933]' />

			{/* PROTECTIONS */}
			<div>
				<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
					{t('app.protect.section_title')}
				</div>
				<div className='grid grid-cols-1 md:grid-cols-2 gap-1'>
					{settings.map(([k, keyBase, extra]) => {
						if (extra?.expertOnly && !expert) return null;
						const { expertOnly: _eo, ...rowExtra } = extra || {};
						return (
							<ToggleRow
								key={k}
								k={k}
								label={t(`${keyBase}.label`)}
								why={t(`${keyBase}.why`)}
								expertBadge={!!extra?.expertOnly}
								checked={!!config[k]}
								onChange={(v) => set(k, v)}
								{...rowExtra}
							/>
						);
					})}
				</div>
				{!config.protectDynamax && config.protectGigantamax && (
					<div className='border border-[#F5B82E]/40 bg-[#F5B82E]/5 rounded p-3 mono text-[10.5px] mt-2 leading-tight text-[#E6EDF3]'>
						{t('app.protect.dynamax_off_note')}
					</div>
				)}
				{!config.protectShadows && config.protectShadowPurifyOnly && (
					<div className='border border-[#F5B82E]/40 bg-[#F5B82E]/5 rounded p-3 mono text-[10.5px] mt-2 leading-tight text-[#E6EDF3]'>
						{t('app.protect.shadows_off_note')}
					</div>
				)}
			</div>

			{/* RAID FILTERS (expert) — narrows per-boss counter filters */}
			{expert && (
				<div>
					<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
						{t('app.raids.section_title')}
					</div>
					<label className='flex items-start gap-2 cursor-pointer mono text-xs'>
						<input
							type='checkbox'
							checked={!!config.raidRequireSecondMove}
							onChange={(e) => set('raidRequireSecondMove', e.target.checked)}
							className='mt-0.5'
						/>
						<div>
							<span className='text-[#E6EDF3]'>{t('app.protect.raid_require_second_move.label')}</span>
							<p className='text-[#8B98A5] mt-0.5'>{t('app.protect.raid_require_second_move.help')}</p>
						</div>
					</label>
				</div>
			)}

			{/* TEAM ROCKET — counter filter options (visible in normal mode) */}
			<div>
				<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
					{t('app.collapsible.aux_section_team_rocket')}
				</div>
				<label className='flex items-start gap-2 cursor-pointer mono text-xs'>
					<input
						type='checkbox'
						checked={config.rocketLenientCounters !== false}
						onChange={(e) => set('rocketLenientCounters', e.target.checked)}
						className='mt-0.5'
					/>
					<div>
						<span className='text-[#E6EDF3]'>{t('app.protect.rocket_lenient_counters.label')}</span>
						<p className='text-[#8B98A5] mt-0.5'>{t('app.protect.rocket_lenient_counters.help')}</p>
					</div>
				</label>
			</div>

			<hr className='border-[#1F2933]' />

			{/* REGIONAL GROUPS */}
			<div>
				<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
					{t('app.protect.regional_section_title')}
				</div>
				<div className='space-y-2'>
					{Object.entries(REGIONAL_GROUPS).map(([key, group]) => (
						<RegionalGroupEditor
							key={key}
							groupKey={key}
							group={group}
							state={
								config.regionalGroups?.[key] || {
									enabled: true,
									typeChecksEnabled: null,
									collectorsEnabled: null,
								}
							}
							setGroup={(partial) => setGroup(key, partial)}
							homeLocals={homeLocals}
							homeLocalTypeChecks={homeLocalTypeChecks}
						/>
					))}
				</div>
			</div>

			<hr className='border-[#1F2933]' />

			{/* BUDDY EVENTS — only shows if buddies are configured */}
			{(config.buddies || []).filter((b) => b.active !== false).length > 0 && (
				<>
					<BuddyEventsEditor
						buddies={(config.buddies || []).filter((b) => b.active !== false)}
						expertMode={!!config.expertMode}
						onUpdateBuddy={(id, partial) => {
							const all = config.buddies || [];
							set(
								'buddies',
								all.map((b) => (b.id === id ? { ...b, ...partial } : b)),
							);
						}}
					/>
					<hr className='border-[#1F2933]' />
				</>
			)}

			{/* FRIEND COLLECT — "have friends collect for me": the mirror image of
		    the buddy wish-species above (what YOU collect for THEM). Curates
		    config.friendCollectSpecies; the resulting filter string renders as
		    a top-level box in step 4. Collapsible — the pack + target lists
		    get long. */}
			<Collapsible
				icon='🤝'
				label={`${t('app.filter.friend_collect_section')} · ${friendCollectTargets.length}`}
				open={showFriendCollect}
				onToggle={() => setShowFriendCollect((s) => !s)}
			>
				<div className='space-y-4'>
					<p className='mono text-xs text-[#8B98A5] leading-relaxed'>
						{t('app.filter.friend_collect_intro')}
					</p>
					<FriendCollectEditor
						list={config.friendCollectSpecies || []}
						onChange={(next) => set('friendCollectSpecies', next)}
						mode={['hundo', 'both'].includes(config.friendCollectMode) ? config.friendCollectMode : 'lucky'}
						onModeChange={(m) => set('friendCollectMode', m)}
						guaranteedOnly={!!config.friendCollectGuaranteedOnly}
						onGuaranteedChange={(v) => set('friendCollectGuaranteedOnly', v)}
						targets={friendCollectTargets}
						suggestions={friendCollectSuggestions}
						forced={config.friendCollectForced || []}
						onForcedChange={(next) => set('friendCollectForced', next)}
						genders={config.friendCollectGenders || {}}
						onGendersChange={(next) => set('friendCollectGenders', next)}
						dropForms={config.friendCollectDropForms || {}}
						onDropFormsChange={(next) => set('friendCollectDropForms', next)}
					/>
				</div>
			</Collapsible>

			<hr className='border-[#1F2933]' />

			{/* CUSTOM COLLECTIBLES */}
			<CustomCollectiblesEditor
				list={config.customCollectibles || []}
				onChange={(list) => set('customCollectibles', list)}
			/>

			{expert && <hr className='border-[#1F2933]' />}

			{/* TRADE-EVO FAMILIES (expert) — fine-tune which families are protected */}
			{expert && (
				<div>
					<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
						{t('app.protect.te_section_title')}
					</div>
					<div className='flex flex-wrap gap-1.5'>
						{Object.keys(TRADE_EVO_FAMILIES).map((b) => {
							const on = (config.enabledTradeEvos || []).includes(b);
							return (
								<button
									key={b}
									onClick={() =>
										set(
											'enabledTradeEvos',
											on
												? (config.enabledTradeEvos || []).filter((x) => x !== b)
												: [...(config.enabledTradeEvos || []), b],
										)
									}
									aria-pressed={on}
									title={t('app.protect.te_button_title', {
										params: { name: teDisplay(b, outputLocale) },
									})}
									className={`mono text-xs px-2.5 py-1 rounded transition ${
										on
											? 'bg-[#5EAFC5] text-[#0F1419]'
											: 'bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47]'
									}`}
								>
									+{teDisplay(b, outputLocale)}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

function ToggleRow({ k, label, why, checked, onChange, expertBadge, requireConfirmOff }) {
	const { t } = useTranslation();
	const announce = useAnnounce();
	// For dangerous toggles (e.g. "always protect 4★"), turning them OFF requires
	// a two-click confirmation. Turning them back ON is unrestricted.
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const timer = setTimeout(() => setArmed(false), 3000);
		return () => clearTimeout(timer);
	}, [armed]);

	function handleChange(e) {
		const newValue = e.target.checked;
		if (requireConfirmOff && checked && !newValue) {
			// Trying to turn OFF a dangerous toggle
			if (!armed) {
				setArmed(true);
				// The checkbox stays visually ON and a red "really?" appears beside it.
				// Without this a screen-reader user hears the checkbox refuse to change
				// and gets no reason why. Name the protection so the confirm has a
				// subject, and interrupt — this guards turning a safety net OFF.
				announce(`${label} — ${t('app.protect.confirm_off')}`, { assertive: true });
				// Don't fire change yet — keep checkbox on
				e.preventDefault?.();
				return;
			}
			// Second click within timeout — actually disable
			setArmed(false);
			onChange(false);
			return;
		}
		setArmed(false);
		onChange(newValue);
	}

	return (
		<label
			className={`mono text-xs flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 transition ${
				armed ? 'bg-[#E74C3C]/15 border border-[#E74C3C]/40' : 'hover:bg-[#141A21] border border-transparent'
			}`}
			title={why}
		>
			<input type='checkbox' checked={!!checked} onChange={handleChange} className='accent-[#E74C3C] mt-0.5' />
			<div className='flex-1'>
				<div className='flex items-baseline gap-1.5 flex-wrap'>
					<span className='text-[#E6EDF3]'>{label}</span>
					{expertBadge && <span className='text-[9px] text-[#F5B82E]'>{t('app.protect.expert_badge')}</span>}
					{armed && (
						<span className='text-[10px] text-[#FF6B5B] font-semibold'>{t('app.protect.confirm_off')}</span>
					)}
				</div>
				<div className='text-[10px] text-[#8090A0] leading-tight'>{why}</div>
			</div>
		</label>
	);
}

function RegionalGroupEditor({
	groupKey,
	group,
	state,
	setGroup,
	homeLocals = [],
	homeLocalTypeChecks = [],
}) {
	const { t } = useTranslation();
	const groupPanelId = useId();
	const [expanded, setExpanded] = useState(false);
	const allTC = group.typeChecks.map((tc) => tc.species);
	const allCol = group.collectors;
	const tcEnabled = state.typeChecksEnabled === null ? allTC : state.typeChecksEnabled;
	const colEnabled = state.collectorsEnabled === null ? allCol : state.collectorsEnabled;
	// Auto-drops are excluded from the counter so the displayed "X/Y aktiv"
	// matches the actual filter output. One mechanism, mirroring buildFilters:
	//   home — this species spawns locally (species string for collectors,
	//          {species,type} pair for typeChecks — same species with different
	//          types, e.g. Paldean Tauros Combat vs Blaze, is the wrong
	//          granularity for the pair check)
	// Hundo ownership deliberately does NOT drop a chip: regional protection
	// wins over the hundo carve-out, and unchecking here is the manual opt-out
	// (see the no-hundo-carve-out comments in the buildFilters regional loop).
	const homeSet = new Set(homeLocals);
	const tcLocalSet = new Set(homeLocalTypeChecks.map((l) => `${l.species}|${l.type}`));
	const tcDropReason = (tc) =>
		homeSet.has(tc.species) || tcLocalSet.has(`${tc.species}|${tc.type}`) ? 'home' : null;
	const colDropReason = (sp) => (homeSet.has(sp) ? 'home' : null);
	const tcEntriesEnabled = group.typeChecks.filter((tc) => tcEnabled.includes(tc.species));
	const droppedByHome =
		tcEntriesEnabled.filter((tc) => tcDropReason(tc) === 'home').length +
		colEnabled.filter((sp) => colDropReason(sp) === 'home').length;
	const totalEffective =
		group.typeChecks.filter((tc) => !tcDropReason(tc)).length + allCol.filter((sp) => !colDropReason(sp)).length;
	const enabledCount = state.enabled
		? tcEntriesEnabled.filter((tc) => !tcDropReason(tc)).length +
			colEnabled.filter((sp) => !colDropReason(sp)).length
		: 0;

	function toggleTC(species) {
		const cur = tcEnabled;
		const next = cur.includes(species) ? cur.filter((s) => s !== species) : [...cur, species];
		setGroup({ typeChecksEnabled: next.length === allTC.length ? null : next });
	}
	function toggleCol(species) {
		const cur = colEnabled;
		const next = cur.includes(species) ? cur.filter((s) => s !== species) : [...cur, species];
		setGroup({ collectorsEnabled: next.length === allCol.length ? null : next });
	}
	function selectAll() {
		setGroup({ enabled: true, typeChecksEnabled: null, collectorsEnabled: null });
	}
	function selectRecommended() {
		const recommended = recommendedTypeCheckSpecies(group);
		const typeChecksEnabled = recommended.length === allTC.length ? null : recommended;
		setGroup({ enabled: true, typeChecksEnabled, collectorsEnabled: null });
	}
	function selectNone() {
		setGroup({ typeChecksEnabled: [], collectorsEnabled: [] });
	}
	const hasTiers = group.typeChecks.some((tc) => tc.tier === 'C');

	return (
		<div
			className={`border rounded transition ${state.enabled ? 'border-[#2D3A47]' : 'border-[#1F2933] opacity-60'}`}
		>
			<div className='flex items-center gap-3 px-3 py-2'>
				<input
					type='checkbox'
					checked={!!state.enabled}
					onChange={(e) => setGroup({ enabled: e.target.checked })}
					aria-label={t('app.a11y.regional_group_enable', { params: { group: t(group.labelKey) } })}
					className='accent-[#E74C3C]'
				/>
				<button
					onClick={() => setExpanded((x) => !x)}
					aria-expanded={expanded}
					aria-controls={groupPanelId}
					className='flex-1 text-left flex items-center gap-2'
				>
					{expanded ? (
						<ChevronDown size={12} className='text-[#5EAFC5]' />
					) : (
						<ChevronRight size={12} className='text-[#8090A0]' />
					)}
					<span className='mono text-sm text-[#E6EDF3]'>{t(group.labelKey)}</span>
					<span className='mono text-[10px] text-[#8090A0]'>
						{state.enabled
							? t('app.regional_editor.active_count', {
									params: { count: enabledCount, total: totalEffective },
								})
							: t('app.regional_editor.disabled')}
						{droppedByHome > 0 && state.enabled && (
							<span className='text-[#27AE60] ml-1'>
								{t('app.regional_editor.home_extra', { params: { count: droppedByHome } })}
							</span>
						)}
					</span>
				</button>
			</div>
			{expanded && (
				<div id={groupPanelId} className='px-3 pb-3 pt-1 space-y-2 border-t border-[#1F2933]'>
					<div className='mono text-[11px] text-[#8090A0] mb-1'>{t(group.descriptionKey)}</div>
					<div className='flex gap-2'>
						<button
							onClick={selectAll}
							className='mono text-[10px] text-[#5EAFC5] hover:text-[#7FCFE5] transition'
						>
							{t('app.regional_editor.select_all')}
						</button>
						{hasTiers && (
							<>
								<span className='text-[#8090A0]'>·</span>
								<button
									onClick={selectRecommended}
									title={t('app.regional_editor.select_recommended_title')}
									className='mono text-[10px] text-[#F5B82E] hover:text-[#F8C95B] transition'
								>
									{t('app.regional_editor.select_recommended')}
								</button>
							</>
						)}
						<span className='text-[#8090A0]'>·</span>
						<button
							onClick={selectNone}
							className='mono text-[10px] text-[#8090A0] hover:text-[#E74C3C] transition'
						>
							{t('app.regional_editor.select_none')}
						</button>
					</div>
					{group.typeChecks.length > 0 && (
						<div>
							<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1'>
								{t('app.regional_editor.type_check_label')}
							</div>
							<div className='flex flex-wrap gap-1'>
								{group.typeChecks.map((tc) => {
									const on = tcEnabled.includes(tc.species);
									const dropReason = tcDropReason(tc);
									const isHomeLocal = dropReason === 'home';
									const tierBadge = tc.tier === 'S' ? '★' : tc.tier === 'C' ? '·' : null;
									const tierColor =
										tc.tier === 'S'
											? 'text-[#F5B82E]'
											: tc.tier === 'C'
												? 'text-[#8090A0]'
												: 'text-[#5EAFC5]';
									return (
										<button
											key={`${tc.species}_${tc.type}`}
											onClick={() => toggleTC(tc.species)}
											aria-pressed={on && !dropReason}
											title={isHomeLocal ? t('app.regional_editor.home_local_title') : t(tc.noteKey)}
											disabled={!state.enabled || !!dropReason}
											className={`mono text-[11px] px-2 py-0.5 rounded transition ${
												isHomeLocal
													? 'bg-[#27AE60]/10 text-[#27AE60] border border-[#27AE60]/30 line-through opacity-60'
													: on
														? 'bg-[#5EAFC5]/20 text-[#5EAFC5] border border-[#5EAFC5]/40'
														: 'bg-[#1F2933] text-[#8090A0] border border-transparent hover:bg-[#2D3A47]'
											}`}
										>
											{isHomeLocal && <span className='not-italic no-underline mr-0.5'>⌂</span>}
											{tierBadge && !dropReason && (
												<span className={`${tierColor} mr-0.5`}>{tierBadge}</span>
											)}
											{tc.species} <span className='opacity-70'>/ !{tc.type}</span>
										</button>
									);
								})}
							</div>
						</div>
					)}
					{group.collectors.length > 0 && (
						<div>
							<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1'>
								{t('app.regional_editor.collectors_label')}
							</div>
							<div className='flex flex-wrap gap-1'>
								{group.collectors.map((sp) => {
									const on = colEnabled.includes(sp);
									const dropReason = colDropReason(sp);
									const isHomeLocal = dropReason === 'home';
									// Home-dropped chips (via effectiveConfig) are removed regardless
									// of `on`, so render them as "off" visually with a ⌂ marker.
									const effectivelyOn = on && !dropReason;
									const noteKey = group.collectorNotes?.[sp];
									return (
										<button
											key={sp}
											onClick={() => toggleCol(sp)}
											aria-pressed={effectivelyOn}
											disabled={!state.enabled || !!dropReason}
											title={
												isHomeLocal
													? t('app.regional_editor.home_local_title')
													: noteKey
														? t(noteKey)
														: undefined
											}
											className={`mono text-[11px] px-2 py-0.5 rounded transition ${
												effectivelyOn
													? 'bg-[#F5B82E]/20 text-[#F5B82E] border border-[#F5B82E]/40'
													: isHomeLocal
														? 'bg-[#27AE60]/10 text-[#27AE60] border border-[#27AE60]/30 line-through opacity-60'
														: 'bg-[#1F2933] text-[#8090A0] border border-transparent hover:bg-[#2D3A47]'
											}`}
										>
											{isHomeLocal && <span className='not-italic no-underline mr-0.5'>⌂</span>}
											{sp}
											{noteKey && !dropReason && (
												<span
													className='not-italic no-underline ml-1 opacity-60'
													aria-hidden='true'
												>
													ⓘ
												</span>
											)}
										</button>
									);
								})}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function RegionalMap({
	lastPin,
	setLastPin,
	bazaarTags,
	setBazaarTags,
	homeLocation,
	setHomeLocation,
	homeLocals,
	tradeTagName = 'Trade',
}) {
	const { t } = useTranslation();
	const announce = useAnnounce();
	const [worldData, setWorldData] = useState(null);
	const [loadStatus, setLoadStatus] = useState('loading'); // loading | ready | error

	useEffect(() => {
		const urls = [
			'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
			'https://unpkg.com/world-atlas@2/countries-110m.json',
		];
		(async () => {
			for (const url of urls) {
				try {
					const r = await fetch(url);
					if (!r.ok) continue;
					const topo = await r.json();
					const geo = decodeTopo(topo, 'countries');
					setWorldData(geo);
					setLoadStatus('ready');
					return;
				} catch {}
			}
			setLoadStatus('error');
		})();
	}, []);

	// d3 equirectangular projection
	const projection = useMemo(
		() =>
			d3
				.geoEquirectangular()
				.scale(VIEW_W / (2 * Math.PI))
				.translate([VIEW_W / 2, VIEW_H / 2 + 20]),
		[],
	);
	const pathGen = useMemo(() => d3.geoPath(projection), [projection]);

	const tropicN = projection([0, 26])[1];
	const tropicS = projection([0, -26])[1];
	const equator = projection([0, 0])[1];
	const meridian = projection([0, 0])[0];

	// SVG ref for click coord conversion
	const svgRef = useRef(null);
	// Hover preview pin — separate from lastPin (the locked one).
	// Updates continuously while mouse moves; cleared when mouse leaves the map.
	const [hoverPin, setHoverPin] = useState(null);

	function clientToLonLat(clientX, clientY) {
		const svg = svgRef.current;
		if (!svg) return null;
		const pt = svg.createSVGPoint();
		pt.x = clientX;
		pt.y = clientY;
		const ctm = svg.getScreenCTM();
		if (!ctm) return null;
		const svgPt = pt.matrixTransform(ctm.inverse());
		return projection.invert([svgPt.x, svgPt.y]);
	}

	function handleMapMove(e) {
		if (loadStatus !== 'ready') return;
		const lonLat = clientToLonLat(e.clientX, e.clientY);
		if (lonLat) setHoverPin(lonLat);
	}
	function handleMapLeave() {
		setHoverPin(null);
	}
	function handleMapClick(e) {
		if (loadStatus !== 'ready') return;
		const lonLat = clientToLonLat(e.clientX, e.clientY);
		if (lonLat) setLastPin(lonLat);
	}

	// ── Keyboard path to the pin ──────────────────────────────────────────
	// Clicking the svg was the ONLY way to reach setLastPin, and setHomeLocation
	// is only offered once a pin exists — so without a pointer, step 1 could not
	// be completed at all, and with it every home-local trim, the hemisphere and
	// season inference, and the Coiffwaff travel tips silently never engaged.
	const coordId = useId();
	const [latInput, setLatInput] = useState('');
	const [lonInput, setLonInput] = useState('');
	const [coordError, setCoordError] = useState('');

	// Keep the fields showing wherever the pin actually is, however it got set,
	// so the two input paths never disagree.
	useEffect(() => {
		if (!lastPin) return;
		setLonInput(String(Math.round(lastPin[0] * 1000) / 1000));
		setLatInput(String(Math.round(lastPin[1] * 1000) / 1000));
	}, [lastPin]);

	function submitCoords(e) {
		e.preventDefault();
		const latRaw = latInput.trim().replace(',', '.');
		const lonRaw = lonInput.trim().replace(',', '.');
		// Number('') is 0, so an empty field would otherwise pin 0°,0° — the
		// Atlantic — instead of reporting that nothing was entered.
		if (latRaw === '' || lonRaw === '') {
			setCoordError(t('app.map.coord_error'));
			return;
		}
		const lat = Number(latRaw);
		const lon = Number(lonRaw);
		if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
			setCoordError(t('app.map.coord_error'));
			return;
		}
		setCoordError('');
		setLastPin([lon, lat]);
	}

	// Region jump: drop the pin at the region's centroid. Sorted by localized
	// label so the list is navigable by type-ahead in a native select.
	const regionOptions = useMemo(
		() =>
			POGO_REGIONS.filter((r) => r.geometry?.type === 'Polygon' || r.geometry?.type === 'MultiPolygon')
				.map((r) => ({ name: r.name, centroid: d3.geoCentroid(r.geometry) }))
				.filter((r) => Number.isFinite(r.centroid?.[0]) && Number.isFinite(r.centroid?.[1]))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[],
	);

	// Preview matches (hover) + locked matches (lastPin) computed separately
	const previewMatches = useMemo(() => {
		if (!hoverPin) return null;
		const out = [];
		for (const r of POGO_REGIONS) {
			if (r.geometry.type !== 'Polygon' && r.geometry.type !== 'MultiPolygon') continue;
			if (pointInRegionGeom(hoverPin, r.geometry)) out.push(r);
		}
		return out;
	}, [hoverPin]);

	const matches = useMemo(() => {
		if (!lastPin) return [];
		const out = [];
		for (const r of POGO_REGIONS) {
			if (r.geometry.type !== 'Polygon' && r.geometry.type !== 'MultiPolygon') continue;
			if (pointInRegionGeom(lastPin, r.geometry)) out.push(r);
		}
		return out;
	}, [lastPin]);

	// Coiffwaff trim travel tip: region-locked cuts unlockable at the pin that
	// home does NOT offer. The form change must happen while physically inside
	// the region, but the cut persists afterwards — worth doing on a trip.
	const pinTrims = useMemo(() => computeFurfrouTrims(lastPin), [lastPin]);
	const homeTrims = useMemo(() => computeFurfrouTrims(homeLocation), [homeLocation]);
	const newTrims = useMemo(() => pinTrims.filter((k) => !homeTrims.includes(k)), [pinTrims, homeTrims]);

	// Aggregate Pokémon names from matched regions, splitting into:
	//   - "wanted": at this pin but NOT already at home (worth bringing back)
	//   - "alreadyLocal": at this pin AND already at home (no need to tag — friends don't need them)
	const homeLocalsSet = useMemo(() => new Set(homeLocals || []), [homeLocals]);
	const { pokemonWanted, pokemonAlreadyLocal } = useMemo(() => {
		const all = new Set();
		matches.forEach((m) => m.german.forEach((n) => all.add(n)));
		const wanted = [],
			alreadyLocal = [];
		for (const n of all) {
			if (homeLocalsSet.has(n)) alreadyLocal.push(n);
			else wanted.push(n);
		}
		return { pokemonWanted: wanted, pokemonAlreadyLocal: alreadyLocal };
	}, [matches, homeLocalsSet]);
	// Combined list — kept for the count-only "n region(s) here" display
	const pokemonAtPin = useMemo(
		() => [...pokemonWanted, ...pokemonAlreadyLocal],
		[pokemonWanted, pokemonAlreadyLocal],
	);

	function addAllToBazaar() {
		// Only add the "wanted" ones — adding locals would just duplicate what
		// friends elsewhere already have access to via me.
		const merged = [...new Set([...bazaarTags, ...pokemonWanted])];
		setBazaarTags(merged);
	}
	// Confirm-state for the "löschen" button — confirm() is blocked in iframe artifacts,
	// so we do a two-click confirmation: first click arms it, second click clears.
	const [bazaarClearArmed, setBazaarClearArmed] = useState(false);
	useEffect(() => {
		if (!bazaarClearArmed) return;
		const t = setTimeout(() => setBazaarClearArmed(false), 3000);
		return () => clearTimeout(t);
	}, [bazaarClearArmed]);

	function addOneToBazaar(name) {
		if (!bazaarTags.includes(name)) setBazaarTags([...bazaarTags, name]);
	}
	function removeFromBazaar(name) {
		setBazaarTags(bazaarTags.filter((n) => n !== name));
	}
	function clearBazaar() {
		if (bazaarTags.length === 0) return;
		if (!bazaarClearArmed) {
			setBazaarClearArmed(true);
			announce(`${t('app.map.clear_button')} — ${t('app.map.clear_armed')}`, { assertive: true });
			return;
		}
		setBazaarTags([]);
		setBazaarClearArmed(false);
	}
	function clearPin() {
		setLastPin(null);
	}

	// Pin position in SVG coords for rendering
	const pinXY = lastPin ? projection(lastPin) : null;
	const hoverXY = hoverPin ? projection(hoverPin) : null;

	// Folder color hint for matches (visual grouping only)
	const folderColor = (folder) => {
		if (folder.startsWith('Type 5')) return '#E74C3C';
		if (folder.startsWith('Type 4')) return '#9B59B6';
		if (folder.startsWith('Type 3')) return '#F5B82E';
		if (folder.startsWith('Type 2')) return '#27AE60';
		if (folder.startsWith('Type 1')) return '#5EAFC5';
		return '#8090A0';
	};

	return (
		<div className='space-y-4'>
			{/* MAP — clean, no polygon overlays */}
			<div className='border border-[#1F2933] rounded bg-[#0B0F14] overflow-hidden relative'>
				{/* The map is a POINTER convenience. Everything it can do is also
				    reachable from the coordinate/region form below it, which is the
				    keyboard and screen-reader path — so the svg names itself and hides
				    its decorative interior rather than exposing hundreds of paths.
				    The loading/error message lives inside the svg for layout reasons,
				    so role='img' would swallow it; it is mirrored into a live region
				    below (where it is also announced, which it never was before). */}
				<svg
					ref={svgRef}
					role='img'
					aria-label={t('app.map.svg_alt')}
					viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
					className='w-full h-auto block'
					style={{ cursor: loadStatus === 'ready' ? 'crosshair' : 'wait' }}
					onClick={handleMapClick}
					onMouseMove={handleMapMove}
					onMouseLeave={handleMapLeave}
				>
					<defs>
						<pattern id='grid' width='40' height='40' patternUnits='userSpaceOnUse'>
							<path d='M 40 0 L 0 0 0 40' fill='none' stroke='#5EAFC5' strokeWidth='0.3' opacity='0.12' />
						</pattern>
					</defs>
					<rect width={VIEW_W} height={VIEW_H} fill='url(#grid)' />

					<line
						x1='0'
						y1={equator}
						x2={VIEW_W}
						y2={equator}
						stroke='#5EAFC5'
						strokeWidth='0.4'
						strokeDasharray='2 4'
						opacity='0.4'
					/>
					<line
						x1={meridian}
						y1='0'
						x2={meridian}
						y2={VIEW_H}
						stroke='#5EAFC5'
						strokeWidth='0.4'
						strokeDasharray='2 4'
						opacity='0.4'
					/>
					<line
						x1='0'
						y1={tropicN}
						x2={VIEW_W}
						y2={tropicN}
						stroke='#F5B82E'
						strokeWidth='0.4'
						strokeDasharray='1 3'
						opacity='0.3'
					/>
					<line
						x1='0'
						y1={tropicS}
						x2={VIEW_W}
						y2={tropicS}
						stroke='#F5B82E'
						strokeWidth='0.4'
						strokeDasharray='1 3'
						opacity='0.3'
					/>

					{/* Countries — neutral fill, no continent grouping */}
					{loadStatus === 'ready' &&
						worldData &&
						worldData.features.map((f) => (
							<path
								key={f.id ?? Math.random()}
								d={pathGen(f.geometry)}
								fill='#1F2933'
								stroke='#0B0F14'
								strokeWidth='0.3'
								className='transition-colors'
							/>
						))}

					{/* Home marker */}
					{homeLocation &&
						loadStatus === 'ready' &&
						(() => {
							const [hx, hy] = projection(homeLocation);
							return (
								<g pointerEvents='none'>
									<circle cx={hx} cy={hy} r='3.5' fill='#27AE60' stroke='#FFFFFF' strokeWidth='1' />
									<circle
										cx={hx}
										cy={hy}
										r='7'
										fill='none'
										stroke='#27AE60'
										strokeWidth='0.4'
										opacity='0.7'
									/>
								</g>
							);
						})()}

					{/* Hover ghost pin — preview while mouse is over the map */}
					{hoverXY && loadStatus === 'ready' && (
						<g pointerEvents='none'>
							<circle
								cx={hoverXY[0]}
								cy={hoverXY[1]}
								r='3.5'
								fill='#E74C3C'
								opacity='0.5'
								stroke='#FFFFFF'
								strokeWidth='0.8'
								strokeOpacity='0.6'
							/>
						</g>
					)}

					{/* Locked pin — committed via click */}
					{pinXY && loadStatus === 'ready' && (
						<g pointerEvents='none'>
							<circle
								cx={pinXY[0]}
								cy={pinXY[1]}
								r='14'
								fill='none'
								stroke='#E74C3C'
								strokeWidth='0.6'
								opacity='0.5'
							>
								<animate attributeName='r' values='6;16;6' dur='1.6s' repeatCount='indefinite' />
								<animate
									attributeName='opacity'
									values='0.7;0;0.7'
									dur='1.6s'
									repeatCount='indefinite'
								/>
							</circle>
							<circle
								cx={pinXY[0]}
								cy={pinXY[1]}
								r='4.5'
								fill='#E74C3C'
								stroke='#FFFFFF'
								strokeWidth='1.2'
							/>
							<circle cx={pinXY[0]} cy={pinXY[1]} r='1.5' fill='#FFFFFF' />
						</g>
					)}

					{/* Loading / error overlay */}
					{loadStatus !== 'ready' && (
						<g>
							<rect width={VIEW_W} height={VIEW_H} fill='#0B0F14' opacity='0.85' />
							<text
								x={VIEW_W / 2}
								y={VIEW_H / 2}
								textAnchor='middle'
								className='mono'
								fontSize='14'
								fill='#5EAFC5'
							>
								{loadStatus === 'loading' ? t('app.map.loading') : t('app.map.load_error')}
							</text>
						</g>
					)}
				</svg>
			</div>

			{/* Map status, mirrored out of the svg so it is actually announced. */}
			<div className='sr-only' role='status'>
				{loadStatus === 'loading' ? t('app.map.loading') : loadStatus === 'error' ? t('app.map.load_error') : ''}
			</div>

			{/* Keyboard/AT path to the pin — see the note by submitCoords. */}
			<form onSubmit={submitCoords} className='border border-[#1F2933] rounded p-3 space-y-2'>
				<div className='mono text-[10.5px] text-[#8090A0]'>{t('app.map.coord_help')}</div>
				<div className='flex flex-wrap items-end gap-2'>
					<div>
						<label htmlFor={`${coordId}-lat`} className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] block'>
							{t('app.map.lat_label')}
						</label>
						<input
							id={`${coordId}-lat`}
							type='text'
							inputMode='decimal'
							value={latInput}
							onChange={(e) => setLatInput(e.target.value)}
							aria-invalid={coordError ? 'true' : undefined}
							aria-describedby={coordError ? `${coordId}-err` : undefined}
							className='mono text-xs w-24 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1'
						/>
					</div>
					<div>
						<label htmlFor={`${coordId}-lon`} className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] block'>
							{t('app.map.lon_label')}
						</label>
						<input
							id={`${coordId}-lon`}
							type='text'
							inputMode='decimal'
							value={lonInput}
							onChange={(e) => setLonInput(e.target.value)}
							aria-invalid={coordError ? 'true' : undefined}
							aria-describedby={coordError ? `${coordId}-err` : undefined}
							className='mono text-xs w-24 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1'
						/>
					</div>
					<button
						type='submit'
						className='mono text-xs bg-[#5EAFC5] hover:bg-[#7FC7DB] text-[#0F1419] px-3 py-1.5 rounded transition'
					>
						{t('app.map.set_pin')}
					</button>
					<div className='ml-auto'>
						<label htmlFor={`${coordId}-region`} className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] block'>
							{t('app.map.region_select_label')}
						</label>
						<select
							id={`${coordId}-region`}
							value=''
							onChange={(e) => {
								const r = regionOptions.find((x) => x.name === e.target.value);
								if (r) {
									setCoordError('');
									setLastPin(r.centroid);
								}
							}}
							className='mono text-xs bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1 max-w-[14rem]'
						>
							<option value=''>{t('app.map.region_select_placeholder')}</option>
							{regionOptions.map((r) => (
								<option key={r.name} value={r.name}>
									{r.name}
								</option>
							))}
						</select>
					</div>
				</div>
				{coordError && (
					<div id={`${coordId}-err`} role='alert' className='mono text-[10.5px] text-[#E74C3C]'>
						{coordError}
					</div>
				)}
			</form>

			{/* Home banner */}
			{homeLocation && (
				<div className='border border-[#27AE60]/40 bg-[#27AE60]/5 rounded p-3 flex items-baseline gap-3 mono text-xs'>
					<span className='text-[#27AE60]'>⌂</span>
					<div className='flex-1'>
						<div className='text-[#E6EDF3]'>
							{t('app.map.home_label')} {homeLocation[1].toFixed(2)}°{homeLocation[1] >= 0 ? 'N' : 'S'},{' '}
							{homeLocation[0].toFixed(2)}°{homeLocation[0] >= 0 ? 'E' : 'W'}
						</div>
						{homeLocals.length > 0 && (
							<div className='text-[10.5px] text-[#8090A0] mt-1'>
								{t('app.map.local_regionals_label', { params: { count: homeLocals.length } })}{' '}
								<span className='text-[#27AE60]'>{homeLocals.join(' · ')}</span>
							</div>
						)}
					</div>
					<button
						onClick={() => setHomeLocation(null)}
						className='text-[#8090A0] hover:text-[#E74C3C] transition'
					>
						{t('app.map.remove_home')}
					</button>
				</div>
			)}

			{/* Hover preview — live, replaces "tap somewhere" hint when hovering */}
			{hoverPin && previewMatches !== null && (
				<div className='border border-[#E74C3C]/30 rounded p-2.5 bg-[#E74C3C]/5'>
					<div className='flex items-baseline gap-3 mono text-[11px]'>
						<span className='text-[#8090A0]'>{t('app.map.preview_label')}</span>
						<span className='text-[#E6EDF3]'>
							{hoverPin[1].toFixed(1)}°{hoverPin[1] >= 0 ? 'N' : 'S'}, {hoverPin[0].toFixed(1)}°
							{hoverPin[0] >= 0 ? 'E' : 'W'}
						</span>
						<span className='text-[#8090A0] flex-1' />
						<span className='text-[10.5px] text-[#8090A0]'>{t('app.map.click_to_pin')}</span>
					</div>
					{previewMatches.length === 0 ? (
						<div className='mono text-[10.5px] text-[#8090A0] mt-1'>{t('app.map.no_regionals_here')}</div>
					) : (
						(() => {
							const all = [...new Set(previewMatches.flatMap((m) => m.german))];
							const wanted = all.filter((n) => !homeLocalsSet.has(n));
							const local = all.filter((n) => homeLocalsSet.has(n));
							// The two groups used to differ ONLY by green-vs-grey text, joined
							// by the same ' · ' that separates names WITHIN a group — so
							// "which of these do I still need?" was answerable by colour
							// alone. Label each run, reusing the wording the pinned view
							// already uses for exactly this distinction.
							return (
								<div className='mono text-[11px] mt-1.5 leading-relaxed'>
									{wanted.length > 0 && (
										<span className='text-[#27AE60]'>
											<span className='text-[#8090A0]'>
												{t('app.map.bring_along', { params: { count: wanted.length } })}:{' '}
											</span>
											{wanted.join(' · ')}
										</span>
									)}
									{wanted.length > 0 && local.length > 0 && <span className='text-[#8090A0]'> · </span>}
									{local.length > 0 && (
										<span className='text-[#8090A0]' title={t('app.map.local_already_title')}>
											{t('app.map.already_home', { params: { count: local.length } })}:{' '}
											{local.join(' · ')}
										</span>
									)}
								</div>
							);
						})()
					)}
				</div>
			)}

			{/* Pin info */}
			{!lastPin && !hoverPin && (
				<div className='mono text-xs text-[#8090A0] text-center py-2'>
					{homeLocation ? t('app.map.hint_with_home') : t('app.map.hint_no_home')}
				</div>
			)}

			{lastPin && (
				<div className='space-y-3'>
					<div className='flex items-baseline gap-3 mono text-[11px]'>
						<span className='text-[#8090A0]'>{t('app.map.pin_label')}</span>
						<span className='text-[#E6EDF3]'>
							{lastPin[1].toFixed(2)}°{lastPin[1] >= 0 ? 'N' : 'S'}, {lastPin[0].toFixed(2)}°
							{lastPin[0] >= 0 ? 'E' : 'W'}
						</span>
						<span className='text-[#8090A0] flex-1' />
						<button
							onClick={() => setHomeLocation([lastPin[0], lastPin[1]])}
							className='mono text-[11px] bg-[#27AE60]/15 hover:bg-[#27AE60]/25 text-[#27AE60] px-2 py-0.5 rounded transition'
						>
							{t('app.map.set_as_home')}
						</button>
						<button onClick={clearPin} className='text-[#8090A0] hover:text-[#E74C3C] transition'>
							{t('app.map.clear_pin')}
						</button>
					</div>

					{/* Matched regions */}
					{matches.length === 0 ? (
						<div className='mono text-xs text-[#8090A0] py-2'>
							{t('app.map.no_regionals_pin')}
							<span className='text-[#8090A0]/60'> {t('app.map.no_regionals_pin_note')}</span>
						</div>
					) : (
						<div>
							<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
								{matches.length === 1
									? t('app.map.region_count_singular', { params: { count: matches.length } })
									: t('app.map.region_count_plural', { params: { count: matches.length } })}
							</div>
							<div className='space-y-1.5'>
								{matches.map((m, i) => (
									<div key={i} className='flex items-baseline gap-2 mono text-xs'>
										<span
											className='w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0'
											style={{ background: folderColor(m.folder) }}
										/>
										<div className='flex-1'>
											<div className='text-[#E6EDF3]'>{m.german.join(' · ')}</div>
											<div className='text-[10px] text-[#8090A0]'>{m.folder}</div>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Add to bazaar — split into "wanted" (green) vs "already at home" (greyed) */}
					{(pokemonWanted.length > 0 || pokemonAlreadyLocal.length > 0) && (
						<div className='space-y-3'>
							{pokemonWanted.length > 0 && (
								<div>
									<div className='mono text-[10.5px] uppercase tracking-wider text-[#27AE60] mb-1.5'>
										{homeLocals.length > 0
											? t('app.map.bring_along', { params: { count: pokemonWanted.length } })
											: t('app.map.found', { params: { count: pokemonWanted.length } })}
									</div>
									<div className='flex flex-wrap gap-1.5'>
										{pokemonWanted.map((name) => {
											const tagged = bazaarTags.includes(name);
											return (
												<button
													key={name}
													onClick={() =>
														tagged ? removeFromBazaar(name) : addOneToBazaar(name)
													}
													aria-pressed={tagged}
													className={`mono text-[11px] px-2 py-1 rounded transition ${
														tagged
															? 'bg-[#5EAFC5] text-[#0F1419]'
															: 'bg-[#27AE60]/15 text-[#27AE60] border border-[#27AE60]/40 hover:bg-[#27AE60]/25'
													}`}
												>
													{tagged ? '✓ ' : '+ '}
													{name}
												</button>
											);
										})}
									</div>
								</div>
							)}
							{pokemonAlreadyLocal.length > 0 && (
								<div>
									<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-1.5'>
										{t('app.map.already_home', { params: { count: pokemonAlreadyLocal.length } })}
										<span className='text-[#8090A0]/70 normal-case font-normal'>
											{' '}
											· {t('app.map.already_home_note')}
										</span>
									</div>
									<div className='flex flex-wrap gap-1.5'>
										{pokemonAlreadyLocal.map((name) => {
											const tagged = bazaarTags.includes(name);
											return (
												<button
													key={name}
													onClick={() =>
														tagged ? removeFromBazaar(name) : addOneToBazaar(name)
													}
													aria-pressed={tagged}
													title={t('app.map.already_have_title')}
													className={`mono text-[11px] px-2 py-1 rounded transition opacity-60 hover:opacity-100 ${
														tagged
															? 'bg-[#5EAFC5] text-[#0F1419]'
															: 'bg-[#1F2933] text-[#8090A0] hover:bg-[#2D3A47] hover:text-[#E6EDF3]'
													}`}
												>
													{tagged ? '✓ ' : '+ '}
													{name}
												</button>
											);
										})}
									</div>
								</div>
							)}
							{pokemonWanted.length > 0 && (
								<button
									onClick={addAllToBazaar}
									className='mono text-[11px] text-[#27AE60] hover:text-[#5DD380] transition'
								>
									{t('app.map.add_all_to_bazaar', { params: { tag: tradeTagName } })}
									{homeLocals.length > 0 && (
										<span className='text-[#8090A0] ml-1'>
											{t('app.map.add_all_extra', { params: { count: pokemonWanted.length } })}
										</span>
									)}
								</button>
							)}
						</div>
					)}

					{/* Coiffwaff trim travel tip — cuts unlockable here but not at home */}
					{newTrims.length > 0 && (
						<div className='border border-[#9B59B6]/40 rounded p-3 bg-[#9B59B6]/5'>
							<div className='mono text-[10.5px] uppercase tracking-wider text-[#9B59B6] mb-1'>
								{t('app.map.furfrou_tip_title')}
							</div>
							<div className='mono text-[11px] text-[#8090A0]'>
								{t('app.map.furfrou_tip_body', {
									params: {
										trims: newTrims.map((k) => t(`app.map.furfrou_trim.${k}`)).join(' · '),
									},
								})}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Tradeable accumulator */}
			<div className='border border-[#5EAFC5]/40 rounded p-3 bg-[#5EAFC5]/5'>
				<div className='flex items-baseline gap-2 mb-2'>
					<div className='mono text-[10.5px] uppercase tracking-wider text-[#5EAFC5] flex-1'>
						{t('app.map.bazaar_section_title', { params: { count: bazaarTags.length } })}
					</div>
					{bazaarTags.length > 0 && (
						<button
							onClick={clearBazaar}
							className={`mono text-[10.5px] transition ${
								bazaarClearArmed
									? 'text-[#E74C3C] font-semibold'
									: 'text-[#8090A0] hover:text-[#E74C3C]'
							}`}
						>
							{bazaarClearArmed ? t('app.map.clear_armed') : t('app.map.clear_button')}
						</button>
					)}
				</div>
				{bazaarTags.length === 0 ? (
					<div className='mono text-[11px] text-[#8090A0]'>
						{t('app.map.bazaar_empty_help', { params: { tag: `#${tradeTagName}` } })
							.split(`#${tradeTagName}`)
							.flatMap((part, i) =>
								i === 0
									? [<React.Fragment key={i}>{part}</React.Fragment>]
									: [
											<code key={`c${i}`} className='text-[#E6EDF3]'>{`#${tradeTagName}`}</code>,
											<React.Fragment key={`p${i}`}>{part}</React.Fragment>,
										],
							)}
					</div>
				) : (
					<>
						<div className='flex flex-wrap gap-1.5'>
							{bazaarTags.map((name) => (
								<span
									key={name}
									className='mono text-[11px] bg-[#5EAFC5]/20 text-[#E6EDF3] pl-2 pr-1 py-0.5 rounded flex items-center gap-1.5 group'
								>
									{name}
									<button
										onClick={() => removeFromBazaar(name)}
										aria-label={t('app.a11y.remove_species', { params: { name: name } })}
										className='opacity-50 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[#E74C3C] transition'
									>
										<X size={10} />
									</button>
								</span>
							))}
						</div>
						<div className='mono text-[10.5px] text-[#8090A0] mt-2'>
							{t('app.map.bazaar_marked_help', { params: { tag: `#${tradeTagName}` } })
								.split(`#${tradeTagName}`)
								.flatMap((part, i) =>
									i === 0
										? [<React.Fragment key={i}>{part}</React.Fragment>]
										: [
												<code
													key={`c${i}`}
													className='text-[#E6EDF3]'
												>{`#${tradeTagName}`}</code>,
												<React.Fragment key={`p${i}`}>{part}</React.Fragment>,
											],
								)}
						</div>
					</>
				)}
			</div>

			{/* Attribution */}
			<div className='mono text-[10px] text-[#8090A0] pt-1'>{t('app.map.attribution')}</div>
		</div>
	);
}

function NumField({ label, value, onChange, text, hint }) {
	const id = useId();
	const hintId = `${id}-hint`;
	return (
		<div title={hint}>
			<label htmlFor={id} className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0]'>{label}</label>
			<input
				id={id}
				type={text ? 'text' : 'number'}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				// The hint was previously reachable only as a title tooltip, i.e. not
				// at all on touch and inconsistently in AT. Point at the rendered copy.
				aria-describedby={hint ? hintId : undefined}
				className='mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3] mt-1'
			/>
			{hint && <div id={hintId} className='mono text-[10px] text-[#8090A0] mt-1 leading-tight'>{hint}</div>}
		</div>
	);
}

// ─── SETTINGS MODAL ─────────────────────────────────────────────────────────
//
// Holds settings that aren't about "what to protect" but rather "how the tool
// behaves": expert mode, trade tag names, custom tags, league tags, scope
// safety nets, and the dangerous reset. Reachable via gear icon in header.

// Popup after adding a hundo of a species that's currently protected as a
// regional: the protection stays (dupes will NOT surface in trash), and the
// opt-out is unchecking the species in the regionals step. Fired from
// addHundo; purely informational, nothing to confirm.
function HundoRegionalNotice({ notices, onClose }) {
	const { t } = useTranslation();
	if (!notices || notices.length === 0) return null;
	return (
		<Dialog onClose={onClose} label={t('app.hundo_regional.title')} className='border border-[#2D3A47] rounded-lg w-full max-w-md max-h-[80vh] overflow-y-auto shadow-2xl p-5 space-y-4'>
				<h2 className='mono text-base font-semibold text-[#E6EDF3]'>{t('app.hundo_regional.title')}</h2>
				<ul className='space-y-1'>
					{notices.map((n) => (
						<li key={n.species} className='mono text-xs text-[#E6EDF3] flex items-baseline gap-2'>
							<span className='text-[#F5B82E]'>4★</span>
							{capFirst(n.species)}
							<span className='text-[#8090A0]'>
								({n.groups.map((g) => t(REGIONAL_GROUPS[g]?.labelKey || g)).join(', ')})
							</span>
						</li>
					))}
				</ul>
				<p className='mono text-xs text-[#8090A0] leading-relaxed'>{t('app.hundo_regional.body')}</p>
				<div className='flex justify-end'>
					<button
						onClick={onClose}
						className='mono text-xs bg-[#E67E22]/20 hover:bg-[#E67E22]/30 text-[#E67E22] px-3 py-1.5 rounded transition'
					>
						{t('app.regional_sync.ok')}
					</button>
				</div>
		</Dialog>
	);
}

// Popup when a step-3 hundo/lucky add covers a curated friend-collect target:
// fully covered targets drop out of the friend string automatically, and under
// 'both' focus a one-goal add is reported as partial progress (target stays
// until the other goal lands). Same event-driven pattern as
// HundoRegionalNotice above, purple-themed to match the 4★ badge language.
function FriendCollectCoveredNotice({ notices, onClose }) {
	const { t } = useTranslation();
	if (!notices || notices.length === 0) return null;
	const anyFull = notices.some((n) => n.nowFullyCovered);
	const anyPartial = notices.some((n) => !n.nowFullyCovered);
	return (
		<Dialog onClose={onClose} label={t('app.friend_covered.title')} className='border border-[#9B59B6]/40 rounded-lg w-full max-w-md max-h-[80vh] overflow-y-auto shadow-2xl p-5 space-y-4'>
				<h2 className='mono text-base font-semibold text-[#9B59B6]'>{t('app.friend_covered.title')}</h2>
				<ul className='space-y-1 border border-[#9B59B6]/40 rounded p-3 bg-[#9B59B6]/5'>
					{notices.map((n) => (
						<li key={`${n.species}-${n.goal}`} className='mono text-xs text-[#E6EDF3] flex items-baseline gap-2'>
							<span className={n.goal === 'hundo' ? 'text-[#9B59B6]' : 'text-[#F5B82E]'}>
								{n.goal === 'hundo' ? '4★' : '✦'}
							</span>
							{capFirst(n.species)}
							{!n.nowFullyCovered && (
								<span className='text-[#8090A0]'>{t('app.friend_covered.partial_tag')}</span>
							)}
						</li>
					))}
				</ul>
				{anyFull && <p className='mono text-xs text-[#8090A0] leading-relaxed'>{t('app.friend_covered.body')}</p>}
				{anyPartial && (
					<p className='mono text-xs text-[#8090A0] leading-relaxed'>{t('app.friend_covered.body_partial')}</p>
				)}
				<div className='flex justify-end'>
					<button
						onClick={onClose}
						className='mono text-xs bg-[#9B59B6]/20 hover:bg-[#9B59B6]/30 text-[#9B59B6] px-3 py-1.5 rounded transition'
					>
						{t('app.regional_sync.ok')}
					</button>
				</div>
		</Dialog>
	);
}

// One-time popup after the regional catalog sync added protections to a
// returning user's config (see mergeImportedConfig). Lists what changed so the
// "magic behind the scenes" stays visible; the entries are already active, the
// user only decides whether to review them in the regionals step.
function RegionalSyncNotice({ notices, onClose, onShowChangelog }) {
	const { t } = useTranslation();
	if (!notices || notices.length === 0) return null;
	return (
		<Dialog onClose={onClose} label={t('app.regional_sync.title')} className='border border-[#2D3A47] rounded-lg w-full max-w-md max-h-[80vh] overflow-y-auto shadow-2xl p-5 space-y-4'>
				<h2 className='mono text-base font-semibold text-[#E6EDF3]'>{t('app.regional_sync.title')}</h2>
				<p className='mono text-xs text-[#8090A0] leading-relaxed'>{t('app.regional_sync.body')}</p>
				<ul className='space-y-1'>
					{notices.map((n, i) => (
						<li key={i} className='mono text-xs text-[#E6EDF3] flex items-baseline gap-2'>
							<span className='text-[#E67E22]'>+</span>
							<span className='text-[#8090A0]'>{t(REGIONAL_GROUPS[n.group]?.labelKey || n.group)}:</span>
							{n.kind === 'group' ? t('app.regional_sync.whole_group') : capFirst(n.species)}
						</li>
					))}
				</ul>
				<div className='flex gap-2 justify-end'>
					<button
						onClick={onShowChangelog}
						className='mono text-xs text-[#8090A0] hover:text-[#E6EDF3] px-3 py-1.5 rounded border border-[#2D3A47] transition'
					>
						{t('app.regional_sync.changelog_button')}
					</button>
					<button
						onClick={onClose}
						className='mono text-xs bg-[#E67E22]/20 hover:bg-[#E67E22]/30 text-[#E67E22] px-3 py-1.5 rounded transition'
					>
						{t('app.regional_sync.ok')}
					</button>
				</div>
		</Dialog>
	);
}

// "What's new" panel fed by src/data/changelog.json (ids + dates only — the
// user-facing text lives in the app locale bundles under
// app.changelog.entry.<id>.*, so entries localize like everything else).
function ChangelogModal({ open, onClose }) {
	const { t } = useTranslation();
	if (!open) return null;
	return (
		<Dialog onClose={onClose} label={t('app.changelog.title')} className='border border-[#2D3A47] rounded-lg w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl'>
				<div
					style={{ backgroundColor: '#0F1419' }}
					className='sticky top-0 border-b border-[#1F2933] px-5 py-3 flex items-center justify-between'
				>
					<h2 className='mono text-base font-semibold text-[#E6EDF3]'>{t('app.changelog.title')}</h2>
					<button
						onClick={onClose}
						aria-label={t('app.modal.changelog.close_aria')}
						className='text-[#8090A0] hover:text-[#E6EDF3] transition p-1'
					>
						<X size={18} />
					</button>
				</div>
				<div className='p-5 space-y-4'>
					{CHANGELOG.map((entry) => (
						<div key={entry.id} className='border border-[#1F2933] rounded p-3 space-y-1'>
							<div className='flex items-baseline gap-2'>
								<span className='mono text-sm text-[#E6EDF3] font-semibold'>
									{t(`app.changelog.entry.${entry.id}.title`)}
								</span>
								<span className='mono text-[10px] text-[#8090A0] ml-auto'>{entry.date}</span>
							</div>
							<p className='mono text-xs text-[#8090A0] leading-relaxed'>
								{t(`app.changelog.entry.${entry.id}.body`)}
							</p>
						</div>
					))}
				</div>
		</Dialog>
	);
}

function SettingsModal({ open, onClose, config, setConfig, onResetAll, resetArmed, onExport, onImport }) {
	// Base for the htmlFor/id pairs below: every label in this modal is a
	// sibling of its control, so none of them named anything without one.
	const fid = useId();
	const { t, locale, setLocale, outputLocale, setOutputLocale, locales } = useTranslation();
	if (!open) return null;
	function set(k, v) {
		setConfig({ ...config, [k]: v });
	}
	const expert = !!config.expertMode;
	const modeLabel = expert ? t('app.modal.settings.mode_expert') : t('app.modal.settings.mode_normal');
	// Only relevant when the user is in expert mode — otherwise the output
	// locale auto-follows the UI locale and there's no mismatch to surface.
	const localeMismatch = expert && outputLocale !== locale;

	return (
		<Dialog onClose={onClose} label={t('app.modal.settings.title')} className='border border-[#2D3A47] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl'>
				<div
					style={{ backgroundColor: '#0F1419' }}
					className='sticky top-0 border-b border-[#1F2933] px-5 py-3 flex items-center justify-between'
				>
					<h2 className='mono text-base font-semibold text-[#E6EDF3]'>{t('app.modal.settings.title')}</h2>
					<button
						onClick={onClose}
						aria-label={t('app.modal.settings.close_aria')}
						className='text-[#8090A0] hover:text-[#E6EDF3] transition p-1'
					>
						<X size={18} />
					</button>
				</div>

				<div className='p-5 space-y-6'>
					{/* Language */}
					<div>
						<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
							{t('app.modal.language.section_title')}
						</div>
						<div className={`grid gap-3 ${expert ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
							<div>
								<label htmlFor={`${fid}-ui`} className='mono text-[10.5px] text-[#8090A0] block mb-1'>
									{t('app.modal.language.ui_label')}
								</label>
								<select id={`${fid}-ui`}
									value={locale}
									onChange={(e) => setLocale(e.target.value)}
									className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
								>
									{Object.entries(locales).map(([code, info]) => (
										<option key={code} value={code}>
											{info.label}
										</option>
									))}
								</select>
								<div className='mono text-[10px] text-[#8090A0] mt-1'>
									{t('app.modal.language.ui_help')}
								</div>
							</div>
							{expert && (
								<div>
									<label htmlFor={`${fid}-out-lang`} className='mono text-[10.5px] text-[#8090A0] block mb-1'>
										{t('app.modal.language.output_label')}
									</label>
									<select
										id={`${fid}-out-lang`}
										value={outputLocale}
										onChange={(e) => setOutputLocale(e.target.value)}
										className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
									>
										{Object.entries(locales).map(([code, info]) => (
											<option key={code} value={code}>
												{info.label}
											</option>
										))}
									</select>
									<div className='mono text-[10px] text-[#8090A0] mt-1'>
										{t('app.modal.language.output_help')}
									</div>
								</div>
							)}
						</div>
						{localeMismatch && (
							<div className='mono text-[10.5px] text-[#F5B82E] mt-2 leading-relaxed'>
								{t('app.modal.language.output_mismatch', {
									params: {
										ui: locales[locale]?.label || locale,
										output: locales[outputLocale]?.label || outputLocale,
									},
								})}
							</div>
						)}
					</div>

					{/* Mode toggle */}
					<div className='flex items-center justify-between border border-[#2D3A47] rounded p-3'>
						<div>
							<div className='mono text-sm text-[#E6EDF3]'>
								{t('app.modal.settings.mode_label', { params: { mode: modeLabel } })}
							</div>
							<div className='mono text-[11px] text-[#8090A0] mt-0.5'>
								{expert
									? t('app.modal.settings.mode_expert_help')
									: t('app.modal.settings.mode_normal_help')}
							</div>
						</div>
						<button
							onClick={() => set('expertMode', !expert)}
							aria-pressed={!!expert}
							className={`mono text-xs px-3 py-1.5 rounded transition ${
								expert
									? 'bg-[#F5B82E] text-[#0F1419]'
									: 'bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47]'
							}`}
						>
							{expert ? t('app.modal.settings.mode_to_normal') : t('app.modal.settings.mode_to_expert')}
						</button>
					</div>

					{/* Trade tags */}
					<div>
						<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
							{t('app.modal.tags.section_title')}
						</div>
						<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
							<div>
								<label htmlFor={`${fid}-basar`} className='mono text-[10.5px] text-[#8090A0] block mb-1'>
									{t('app.modal.tags.basar_label')}
								</label>
								<input id={`${fid}-basar`}
									type='text'
									value={config.basarTagName || ''}
									onChange={(e) => set('basarTagName', e.target.value)}
									placeholder={t('app.modal.tags.basar_placeholder')}
									className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
								/>
								<div className='mono text-[10px] text-[#8090A0] mt-1'>
									{t('app.modal.tags.basar_clause')}{' '}
									<code className='text-[#5EAFC5]'>!#{config.basarTagName || '?'}</code>
								</div>
							</div>
							<div>
								<label htmlFor={`${fid}-fern`} className='mono text-[10.5px] text-[#8090A0] block mb-1'>
									{t('app.modal.tags.fern_label')}
								</label>
								<input id={`${fid}-fern`}
									type='text'
									value={config.fernTauschTagName || ''}
									onChange={(e) => set('fernTauschTagName', e.target.value)}
									placeholder={t('app.modal.tags.fern_placeholder')}
									className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
								/>
								<div className='mono text-[10px] text-[#8090A0] mt-1'>
									{t('app.modal.tags.fern_help')}
								</div>
							</div>
							{expert && (
								<div>
									<label htmlFor={`${fid}-frustration`} className='mono text-[10.5px] text-[#8090A0] block mb-1'>
										{t('app.modal.tags.frustration_label')}
									</label>
									<input id={`${fid}-frustration`}
										type='text'
										value={config.removeFrustrationTagName || ''}
										onChange={(e) => set('removeFrustrationTagName', e.target.value)}
										placeholder={t('app.modal.tags.frustration_placeholder')}
										className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
									/>
									<div className='mono text-[10px] text-[#8090A0] mt-1'>
										{t('app.modal.tags.frustration_help')}
									</div>
								</div>
							)}
							{expert && (
								<div>
									<label htmlFor={`${fid}-evoswap`} className='mono text-[10.5px] text-[#8090A0] block mb-1'>
										{t('app.modal.tags.evo_swap_label')}
									</label>
									<input id={`${fid}-evoswap`}
										type='text'
										value={config.evoSwapTagName || ''}
										onChange={(e) => set('evoSwapTagName', e.target.value)}
										placeholder={t('app.modal.tags.evo_swap_placeholder')}
										className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
									/>
									<div className='mono text-[10px] text-[#8090A0] mt-1'>
										{t('app.modal.tags.evo_swap_help')}
									</div>
								</div>
							)}
						</div>
					</div>

					{expert && (
						<>
							{/* Custom tags */}
							<div>
								<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
									{t('app.modal.custom_tags.section_title')}
								</div>
								<input
									type='text'
									value={config.customProtectedTags || ''}
									onChange={(e) => set('customProtectedTags', e.target.value)}
									placeholder={t('app.modal.custom_tags.placeholder')}
									aria-label={t('app.modal.custom_tags.section_title')}
									className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
								/>
								<div className='mono text-[10px] text-[#8090A0] mt-1'>
									{t('app.modal.custom_tags.help')}
								</div>
							</div>

							{/* League tags */}
							<div>
								<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
									{t('app.modal.league.section_title')}
								</div>
								<input
									type='text'
									value={config.leagueTags || ''}
									onChange={(e) => set('leagueTags', e.target.value)}
									placeholder={t('app.modal.league.placeholder')}
									aria-label={t('app.modal.league.section_title')}
									className='mono text-sm w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1.5 rounded text-[#E6EDF3]'
								/>
								<div className='mono text-[10px] text-[#8090A0] mt-1'>{t('app.modal.league.help')}</div>
							</div>

							{/* Safety nets */}
							<div>
								<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
									{t('app.modal.safety.section_title')}
								</div>
								<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
									<NumField
										label={t('app.modal.safety.cp_label')}
										value={config.cpCap}
										onChange={(v) => set('cpCap', +v || 0)}
										hint={t('app.modal.safety.cp_hint')}
									/>
									<NumField
										label={t('app.modal.safety.age_label')}
										value={config.ageScopeDays}
										onChange={(v) => set('ageScopeDays', +v || 0)}
										hint={t('app.modal.safety.age_hint')}
									/>
									<NumField
										label={t('app.modal.safety.distance_label')}
										value={config.distanceProtect}
										onChange={(v) => set('distanceProtect', +v || 0)}
										hint={t('app.modal.safety.distance_hint')}
									/>
									<NumField
										label={t('app.modal.safety.lucky_year_label')}
										value={config.luckyEligibleYear}
										onChange={(v) => set('luckyEligibleYear', +v || 0)}
										hint={t('app.modal.safety.lucky_year_hint')}
									/>
								</div>
							</div>
						</>
					)}

					{/* Trade buddies */}
					<BuddyManager buddies={config.buddies || []} onChange={(list) => set('buddies', list)} />

					{/* Storage persistence — request "permanent" storage status so the
              browser doesn't evict our localStorage under pressure or on
              "delete site data on quit" settings. Hidden when the Storage
              API isn't available. */}
					<StoragePersistenceSection />

					{/* Home screen — surface PWA install when the browser exposes
              beforeinstallprompt, otherwise point to the manual install
              menu. Sits next to Storage Persistence because both help
              Firefox Mobile keep state across sessions. */}
					<HomeScreenSection />

					{/* Backup & Restore — JSON file round-trip for cross-device / browser-wipe recovery */}
					<BackupRestoreSection onExport={onExport} onImport={onImport} />

					{/* Danger zone */}
					<div className='pt-4 border-t border-[#1F2933]'>
						<div className='mono text-[10.5px] uppercase tracking-wider text-[#FF6B5B] mb-2'>
							{t('app.modal.danger.section_title')}
						</div>
						<button
							onClick={onResetAll}
							className={`mono text-xs px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
								resetArmed
									? 'bg-[#E74C3C] text-white'
									: 'bg-[#1F2933] text-[#FF6B5B] hover:bg-[#2D3A47]'
							}`}
						>
							<RotateCcw size={11} />
							{resetArmed ? t('app.modal.danger.reset_armed') : t('app.modal.danger.reset_button')}
						</button>
						<div className='mono text-[10px] text-[#8090A0] mt-1.5'>{t('app.modal.danger.reset_help')}</div>
					</div>
				</div>
		</Dialog>
	);
}

// ─── STORAGE PERSISTENCE ────────────────────────────────────────────────────

// Surfaces and triggers the Storage API's persist() request. Some browsers
// (notably Firefox with "Persistent storage = ask to allow") will keep
// localStorage durable across sessions only if we explicitly ask. Without
// the request, our state is "best effort" — eligible for eviction under
// pressure, or wiped by "delete site data on quit"-style settings.
//
// `persist()` is a request, not a guarantee. Firefox may prompt, may grant
// silently, or may defer until storage is under pressure — we just call it
// and reflect whatever comes back. Chrome auto-grants based on heuristics
// (bookmarks, install-as-PWA), so the button is mostly a no-op there but
// harmless. The whole row hides itself when the Storage API is absent
// (Safari ≤14, very old browsers) — no point showing a control we can't
// drive.
function StoragePersistenceSection() {
	const { t } = useTranslation();
	// null = API unsupported or check pending; true/false = current state.
	const [persisted, setPersisted] = useState(null);
	const [requesting, setRequesting] = useState(false);

	useEffect(() => {
		if (!navigator.storage?.persisted) return;
		navigator.storage.persisted().then(setPersisted, () => setPersisted(null));
	}, []);

	async function request() {
		if (!navigator.storage?.persist) return;
		setRequesting(true);
		try {
			const granted = await navigator.storage.persist();
			if (typeof granted === 'boolean') setPersisted(granted);
		} catch {
			// browser-level rejection just leaves the row showing the request button
		} finally {
			setRequesting(false);
		}
	}

	if (persisted === null) return null;

	return (
		<div className='pt-4 border-t border-[#1F2933]'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
				{t('app.modal.storage.section_title')}
			</div>
			{persisted ? (
				<div className='mono text-xs text-[#3FB67A]'>{t('app.modal.storage.persisted_status')}</div>
			) : isIOSNonStandalone() ? (
				<div className='mono text-xs text-[#D89A4A]'>{t('app.modal.storage.ios_safari_hint')}</div>
			) : (
				<>
					<button
						onClick={request}
						disabled={requesting}
						className='mono text-xs px-3 py-1.5 rounded transition bg-[#1F2933] text-[#5EAFC5] hover:bg-[#2D3A47] disabled:opacity-50'
					>
						{requesting ? t('app.modal.storage.requesting') : t('app.modal.storage.request_button')}
					</button>
					<div className='mono text-[10px] text-[#8090A0] mt-1.5'>{t('app.modal.storage.help')}</div>
				</>
			)}
		</div>
	);
}

// Mirrors StoragePersistenceSection: surfaces the PWA install affordance
// when the browser fires beforeinstallprompt (Chromium / Edge / Android
// Chrome). iOS Safari and desktop Firefox never fire the event, so we fall
// back to a one-line pointer at the browser's own install menu. Listening
// for `appinstalled` lets us flip to the success state without a reload.
function HomeScreenSection() {
	const { t } = useTranslation();
	const [installed, setInstalled] = useState(
		() =>
			(typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
			window.navigator.standalone === true,
	);
	const [installPrompt, setInstallPrompt] = useState(null);
	const [installing, setInstalling] = useState(false);

	useEffect(() => {
		function onBeforeInstallPrompt(e) {
			e.preventDefault();
			setInstallPrompt(e);
		}
		function onAppInstalled() {
			setInstalled(true);
			setInstallPrompt(null);
		}
		window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
		window.addEventListener('appinstalled', onAppInstalled);
		return () => {
			window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
			window.removeEventListener('appinstalled', onAppInstalled);
		};
	}, []);

	async function install() {
		if (!installPrompt) return;
		setInstalling(true);
		try {
			await installPrompt.prompt();
			await installPrompt.userChoice;
		} catch {
			// user dismiss / browser-level reject — nothing to recover, the
			// event is single-use either way
		} finally {
			setInstalling(false);
			setInstallPrompt(null);
		}
	}

	return (
		<div className='pt-4 border-t border-[#1F2933]'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
				{t('app.modal.home_screen.section_title')}
			</div>
			{installed ? (
				<div className='mono text-xs text-[#3FB67A]'>{t('app.modal.home_screen.installed_status')}</div>
			) : installPrompt ? (
				<>
					<button
						onClick={install}
						disabled={installing}
						className='mono text-xs px-3 py-1.5 rounded transition bg-[#1F2933] text-[#5EAFC5] hover:bg-[#2D3A47] disabled:opacity-50'
					>
						{installing ? t('app.modal.home_screen.installing') : t('app.modal.home_screen.install_button')}
					</button>
					<div className='mono text-[10px] text-[#8090A0] mt-1.5'>
						{t('app.modal.home_screen.install_help')}
					</div>
				</>
			) : (
				<div className='mono text-[10px] text-[#8090A0]'>{t('app.modal.home_screen.fallback_help')}</div>
			)}
		</div>
	);
}

// ─── BACKUP & RESTORE ───────────────────────────────────────────────────────

// Settings-modal section that lets users dump current state to a JSON file
// and restore from one. The restore flow is a two-step armed confirm —
// matches the "danger zone" pattern so users don't accidentally clobber
// their hundo list. Errors render inline (no toast inside modal).
function BackupRestoreSection({ onExport, onImport }) {
	const { t } = useTranslation();
	// This whole section renders INSIDE SettingsModal, which inerts #root while
	// open — the announcer's live regions are portalled to <body> precisely so
	// these still reach assistive tech. See src/Announcer.jsx.
	const announce = useAnnounce();
	const fileInputRef = useRef(null);
	const [pending, setPending] = useState(null); // { envelope, summary }
	const [armed, setArmed] = useState(false);
	const [error, setError] = useState('');
	const [exportedNote, setExportedNote] = useState('');

	// Import validation failures render as red text below the file picker with no
	// focus move, so nothing reported them. They are errors the user must act on,
	// hence assertive.
	function failWith(message) {
		setError(message);
		announce(message, { assertive: true });
	}

	function handleExportClick() {
		const filename = onExport();
		const note = t('app.modal.backup.export_done', { params: { filename } });
		setExportedNote(note);
		// The note appears below the button and self-clears after 4s; focus never
		// moves, so nothing reported that the export happened at all.
		announce(note);
		setTimeout(() => setExportedNote(''), 4000);
	}

	function summarize(env) {
		const d = env.data || {};
		return {
			hundos: Array.isArray(d.hundos) ? d.hundos.length : 0,
			luckies: Array.isArray(d.luckies) ? d.luckies.length : 0,
			topAttackers: Array.isArray(d.topAttackers) ? d.topAttackers.length : 0,
			topMaxAttackers: Array.isArray(d.topMaxAttackers) ? d.topMaxAttackers.length : 0,
			configFields: d.config && typeof d.config === 'object' ? Object.keys(d.config).length : 0,
			hasHome: Array.isArray(d.homeLocation) && d.homeLocation.length === 2,
			bazaarTags: Array.isArray(d.bazaarTags) ? d.bazaarTags.length : 0,
		};
	}

	async function handleFilePick(e) {
		const file = e.target.files?.[0];
		if (file) await loadFile(file);
		// Reset so picking the same file again still triggers onChange.
		if (fileInputRef.current) fileInputRef.current.value = '';
	}

	async function loadFile(file) {
		setError('');
		setPending(null);
		setArmed(false);
		let text;
		try {
			text = await file.text();
		} catch {
			failWith(t('app.modal.backup.import_error_invalid_json'));
			return;
		}
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			failWith(t('app.modal.backup.import_error_invalid_json'));
			return;
		}
		const result = validateImportEnvelope(parsed);
		if (!result.ok) {
			const { code, params } = result.error;
			failWith(t(`app.modal.backup.import_error_${code}`, params ? { params } : undefined));
			return;
		}
		const { envelope } = result;
		setPending({ envelope, summary: summarize(envelope), exportedAt: envelope.exportedAt || null });
	}

	function applyPending() {
		if (!pending) return;
		if (!armed) {
			setArmed(true);
			// The most destructive confirm in the app — the second press replaces
			// every list, protection and tag with the file's contents. Arming it
			// only swapped the button label and turned it red.
			announce(`${t('app.modal.backup.import_apply')} — ${t('app.modal.backup.import_armed')}`, {
				assertive: true,
			});
			return;
		}
		onImport(pending.envelope);
		setPending(null);
		setArmed(false);
		setError('');
	}

	function cancelPending() {
		setPending(null);
		setArmed(false);
		setError('');
	}

	const summaryParts = pending
		? [
				t('app.modal.backup.summary_hundos', { params: { count: pending.summary.hundos } }),
				pending.summary.luckies > 0
					? t('app.modal.backup.summary_luckies', { params: { count: pending.summary.luckies } })
					: null,
				t('app.modal.backup.summary_attackers', {
					params: { count: pending.summary.topAttackers + pending.summary.topMaxAttackers },
				}),
				t('app.modal.backup.summary_config', { params: { count: pending.summary.configFields } }),
				pending.summary.hasHome ? t('app.modal.backup.summary_home') : null,
				pending.summary.bazaarTags > 0
					? t('app.modal.backup.summary_tags', { params: { count: pending.summary.bazaarTags } })
					: null,
			]
				.filter(Boolean)
				.join(' · ')
		: '';

	return (
		<div className='pt-4 border-t border-[#1F2933]'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
				{t('app.modal.backup.section_title')}
			</div>
			<div className='flex flex-wrap items-center gap-2'>
				<button
					onClick={handleExportClick}
					className='mono text-xs bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47] px-3 py-1.5 rounded transition flex items-center gap-1.5'
				>
					<Download size={11} />
					{t('app.modal.backup.export_button')}
				</button>
				<button
					onClick={() => fileInputRef.current?.click()}
					className='mono text-xs bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47] px-3 py-1.5 rounded transition flex items-center gap-1.5'
				>
					<Upload size={11} />
					{t('app.modal.backup.import_button')}
				</button>
				<input
					ref={fileInputRef}
					type='file'
					accept='.json,application/json'
					onChange={handleFilePick}
					className='hidden'
				/>
			</div>
			<div className='mono text-[10px] text-[#8090A0] mt-1.5'>{t('app.modal.backup.help')}</div>
			{exportedNote && <div className='mono text-[10.5px] text-[#5EAFC5] mt-2'>{exportedNote}</div>}
			{error && <div className='mono text-[10.5px] text-[#FF6B5B] mt-2'>{error}</div>}
			{pending && (
				<div className='mt-3 border border-[#2D3A47] rounded p-3 space-y-2 bg-[#0E141A]'>
					<div className='mono text-[11px] text-[#E6EDF3]'>
						{pending.exportedAt
							? t('app.modal.backup.import_preview_dated', {
									params: { date: pending.exportedAt.slice(0, 10) },
								})
							: t('app.modal.backup.import_preview_undated')}
					</div>
					<div className='mono text-[10.5px] text-[#8090A0]'>{summaryParts}</div>
					<div className='flex items-center gap-2 pt-1'>
						<button
							onClick={applyPending}
							className={`mono text-xs px-3 py-1.5 rounded transition flex items-center gap-1.5 ${
								armed ? 'bg-[#E74C3C] text-white' : 'bg-[#1F2933] text-[#FF6B5B] hover:bg-[#2D3A47]'
							}`}
						>
							{armed ? t('app.modal.backup.import_armed') : t('app.modal.backup.import_apply')}
						</button>
						<button
							onClick={cancelPending}
							className='mono text-xs bg-[#1F2933] text-[#E6EDF3] hover:bg-[#2D3A47] px-3 py-1.5 rounded transition'
						>
							{t('app.modal.backup.import_cancel')}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

// ─── BUDDY MANAGER ──────────────────────────────────────────────────────────

function BuddyManager({ buddies, onChange }) {
	const { t } = useTranslation();
	const [newName, setNewName] = useState('');

	function addBuddy() {
		const name = newName.trim();
		if (!name) return;
		// Generate a default tag prefix from the name (alpha chars, capitalized)
		const tagPrefix = name.replace(/[^a-zA-ZäöüÄÖÜß0-9]/g, '');
		if (!tagPrefix) return;
		const id = tagPrefix.toLowerCase() + '-' + Date.now().toString(36);
		onChange([
			...buddies,
			{ id, name, tagPrefix, targetSpecies: [], wantsTradeEvos: false, rawAppend: '', active: true },
		]);
		setNewName('');
	}
	function update(id, partial) {
		onChange(buddies.map((b) => (b.id === id ? { ...b, ...partial } : b)));
	}
	function remove(id) {
		onChange(buddies.filter((b) => b.id !== id));
	}

	return (
		<div className='pt-4 border-t border-[#1F2933]'>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#8090A0] mb-2'>
				{t('app.buddy.section_title')}
			</div>
			<p className='mono text-[11px] text-[#8090A0] mb-3 leading-relaxed'>
				{t('app.buddy.section_help', { params: { tag1: '#Auri:hat-pika', tag2: '#Auri:meltan' } })
					.split(/(#Auri:[a-zA-Z0-9-]+)/)
					.map((part, i) =>
						/^#Auri:/.test(part) ? (
							<code key={i} className='text-[#E6EDF3]'>
								{part}
							</code>
						) : (
							<React.Fragment key={i}>{part}</React.Fragment>
						),
					)}
			</p>

			{buddies.length > 0 && (
				<div className='space-y-2 mb-3'>
					{buddies.map((b) => (
						<div key={b.id} className='border border-[#2D3A47] rounded p-2.5 space-y-2'>
							<div className='flex items-center gap-2'>
								<input
									type='checkbox'
									checked={b.active !== false}
									onChange={(e) => update(b.id, { active: e.target.checked })}
									aria-label={t('app.a11y.buddy_active', { params: { name: b.name } })}
									className='accent-[#E67E22]'
									title={
										b.active !== false ? t('app.buddy.active_title') : t('app.buddy.inactive_title')
									}
								/>
								<input
									type='text'
									value={b.name}
									onChange={(e) => update(b.id, { name: e.target.value })}
									aria-label={t('app.a11y.buddy_name')}
									placeholder={t('app.buddy.name_placeholder')}
									className='mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3]'
								/>
								<span className='mono text-[11px] text-[#8090A0]'>#</span>
								<input
									type='text'
									value={b.tagPrefix}
									onChange={(e) => update(b.id, { tagPrefix: e.target.value })}
									aria-label={t('app.a11y.buddy_prefix')}
									placeholder={t('app.buddy.prefix_placeholder')}
									className='mono text-sm w-32 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3]'
								/>
								<button
									onClick={() => remove(b.id)}
									aria-label={t('app.a11y.remove_buddy', { params: { name: b.name } })}
									className='text-[#8090A0] hover:text-[#FF6B5B] transition p-1'
									title={t('app.buddy.delete_title')}
								>
									<X size={14} />
								</button>
							</div>
							<div className='mono text-[10px] text-[#8090A0]'>
								{t('app.buddy.clause_label')} <code className='text-[#E67E22]'>!#{b.tagPrefix}</code>{' '}
								{t('app.buddy.clause_match', {
									params: { a: `#${b.tagPrefix}`, b: `#${b.tagPrefix}:event1` },
								})
									.split(/(#[A-Za-zäöüÄÖÜß0-9:-]+)/)
									.map((part, i) =>
										/^#[A-Za-zäöüÄÖÜß0-9]/.test(part) ? (
											<code key={i} className='text-[#E6EDF3]'>
												{part}
											</code>
										) : (
											<React.Fragment key={i}>{part}</React.Fragment>
										),
									)}
							</div>
						</div>
					))}
				</div>
			)}

			<div className='flex gap-2'>
				<input
					type='text'
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && addBuddy()}
					aria-label={t('app.a11y.buddy_name')}
					placeholder={t('app.buddy.add_placeholder')}
					className='mono text-sm flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-3 py-1.5 rounded text-[#E6EDF3]'
				/>
				<button
					onClick={addBuddy}
					disabled={!newName.trim()}
					className='mono text-sm bg-[#E67E22] hover:bg-[#FF9544] disabled:bg-[#2D3A47] disabled:text-[#8090A0] text-white px-3 py-1.5 rounded transition flex items-center gap-1.5'
				>
					<Plus size={14} /> {t('app.buddy.add_button')}
				</button>
			</div>
		</div>
	);
}

// ─── BUDDY EVENTS EDITOR (in Step 2) ───────────────────────────────────────

function BuddyEventsEditor({ buddies, onUpdateBuddy, expertMode }) {
	const { t } = useTranslation();
	const filterName = t('app.buddy_events.section_help_filter_name');
	return (
		<div>
			<div className='mono text-[10.5px] uppercase tracking-wider text-[#E67E22] mb-2'>
				{t('app.buddy_events.section_title')}
			</div>
			<p className='mono text-xs text-[#8090A0] mb-3 leading-relaxed'>
				{t('app.buddy_events.section_help', { params: { filter_name: filterName } })
					.split(filterName)
					.flatMap((part, i) =>
						i === 0
							? [<React.Fragment key={i}>{part}</React.Fragment>]
							: [
									<span key={`f${i}`} className='text-[#E67E22]'>
										{filterName}
									</span>,
									<React.Fragment key={`p${i}`}>{part}</React.Fragment>,
								],
					)}
			</p>

			<div className='space-y-2'>
				{buddies.map((b) => (
					<BuddyTargetsRow
						key={b.id}
						buddy={b}
						expertMode={expertMode}
						onChange={(partial) => onUpdateBuddy(b.id, partial)}
					/>
				))}
			</div>
		</div>
	);
}

function BuddyTargetsRow({ buddy, onChange, expertMode }) {
	const { t, locale } = useTranslation();
	// The raw-filter field's label is a sibling, and its help text was reachable
	// only visually — pair both to the input explicitly. Also used for the
	// accordion's aria-controls target.
	const rawId = useId();
	const panelId = `${rawId}-panel`;
	const [input, setInput] = useState('');
	// targetSpecies entries are structured Targets { species, expand, dropForms }.
	const targets = buddy.targetSpecies || [];
	// Per-buddy disclosure: the wish-species lists get long, so each card
	// collapses to its header (name + count). Open by default only while the
	// list is empty, so adding the first species stays frictionless.
	const [open, setOpen] = useState(targets.length === 0);

	const previewTokens = useMemo(() => {
		return input
			.split(/[,;\s]+/)
			.filter(Boolean)
			.map((tok) => ({
				input: tok,
				info: resolveSpeciesInfo(tok),
			}));
	}, [input]);
	// One target per species now; a token is "new" only if that species isn't
	// already a target.
	const hasSpecies = (name) => targets.some((x) => x.species === name);
	const resolved = previewTokens.filter((p) => p.info);
	const newResolved = resolved.filter((p) => !hasSpecies(p.info.names.de.toLowerCase()));
	const dupes = resolved.filter((p) => hasSpecies(p.info.names.de.toLowerCase()));
	const unresolved = previewTokens.filter((p) => !p.info);

	const keyOf = (tg) => tg.species;
	function addAll() {
		const tokens = input.split(/[,;\s]+/).filter(Boolean);
		if (tokens.length === 0) return;
		const map = new Map(targets.map((tg) => [tg.species, tg]));
		const remaining = [];
		for (const tok of tokens) {
			const r = resolveSpecies(tok);
			if (r) {
				if (!map.has(r)) map.set(r, { species: r, expand: false, dropForms: [], gender: 'any' });
			} else remaining.push(tok);
		}
		const next = [...map.values()].sort((a, b) => a.species.localeCompare(b.species));
		onChange({ targetSpecies: next });
		setInput(remaining.join(', '));
	}
	function updateAt(i, patch) {
		const next = targets.map((tg, idx) => (idx === i ? { ...tg, ...patch } : tg));
		// Dedupe by species (defensive — edits shouldn't create collisions).
		const seen = new Set();
		onChange({
			targetSpecies: next.filter((tg) => {
				if (seen.has(tg.species)) return false;
				seen.add(tg.species);
				return true;
			}),
		});
	}
	function removeAt(i) {
		onChange({ targetSpecies: targets.filter((_, idx) => idx !== i) });
	}
	// Toggle a regional form in/out of the catch list. Never drops the last kept
	// form (that would catch nothing — the family toggle covers "whole species").
	function toggleForm(i, formKey) {
		const tg = targets[i];
		const drop = new Set(tg.dropForms || []);
		if (drop.has(formKey)) {
			drop.delete(formKey);
		} else {
			const forms = regionalFormsFor(tg.species) || [];
			if (forms.filter((f) => !drop.has(f.key)).length <= 1) return;
			drop.add(formKey);
		}
		updateAt(i, { dropForms: [...drop] });
	}

	return (
		<div className='border border-[#E67E22]/20 rounded p-2.5 space-y-2'>
			{/* The toggle is a real <button> rather than a clickable <div>: the whole
			    editor was unreachable by keyboard otherwise. The count + clear control
			    is a SIBLING, not a child — nesting a button inside a button is invalid
			    and was the reason this needed an onClick stopPropagation hack. */}
			<div className='flex items-baseline gap-2 flex-wrap'>
				<button
					type='button'
					onClick={() => setOpen((s) => !s)}
					aria-expanded={open}
					aria-controls={panelId}
					className='flex items-baseline gap-2 flex-wrap select-none hover:bg-[#E67E22]/5 -m-1 p-1 rounded transition text-left'
				>
					{open ? (
						<ChevronDown size={12} className='text-[#E67E22] self-center shrink-0' />
					) : (
						<ChevronRight size={12} className='text-[#8090A0] self-center shrink-0' />
					)}
					<span className='mono text-sm text-[#E6EDF3] font-semibold'>{buddy.name}</span>
					<span className='mono text-[10.5px] text-[#8090A0]'>
						{t('app.buddy_targets.prefix_label')} <code className='text-[#E67E22]'>#{buddy.tagPrefix}</code>
					</span>
				</button>
				<span className='mono text-[10.5px] text-[#8090A0] ml-auto flex items-center gap-2'>
					{t('app.buddy_targets.count_label', { params: { count: targets.length } })}
					<ClearListButton count={targets.length} onClear={() => onChange({ targetSpecies: [] })} />
				</span>
			</div>

			{open && (
				<div id={panelId} className='space-y-2'>
			<label
				className='mono text-[11px] flex items-center gap-2 cursor-pointer text-[#E6EDF3] hover:bg-[#E67E22]/5 rounded px-1 py-0.5 transition w-fit'
				title={t('app.buddy_targets.te_toggle_title')}
			>
				<input
					type='checkbox'
					checked={!!buddy.wantsTradeEvos}
					onChange={(e) => onChange({ wantsTradeEvos: e.target.checked })}
					className='accent-[#E67E22]'
				/>
				<span>{t('app.buddy_targets.te_toggle_label')}</span>
				<span className='text-[10px] text-[#8090A0]'>{t('app.buddy_targets.te_toggle_examples')}</span>
			</label>

			{targets.length > 0 && (
				<div className='flex flex-col gap-1.5'>
					{targets.map((tg, i) => {
						const forms = regionalFormsFor(tg.species);
						const dropSet = new Set(tg.dropForms || []);
						return (
							<div
								key={tg.species}
								className='chip-enter mono text-[11px] bg-[#E67E22]/10 border border-[#E67E22]/30 rounded px-2 py-1 flex items-center gap-2 flex-wrap group'
							>
								<span className='text-[#E6EDF3]'>{capFirst(tg.species)}</span>
								{/* Family-expansion toggle: exact species vs entire +family. */}
								<button
									onClick={() => updateAt(i, { expand: !tg.expand })}
									title={t('app.buddy_targets.expand_toggle_title')}
									className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
										tg.expand
											? 'bg-[#E67E22]/25 border-[#E67E22]/50 text-[#E67E22]'
											: 'bg-transparent border-[#2D3A47] text-[#8090A0] hover:text-[#E6EDF3]'
									}`}
								>
									{tg.expand
										? t('app.buddy_targets.expand_family')
										: t('app.buddy_targets.expand_exact')}
								</button>
								{/* Gender picker: ♀/♂ — click to catch only that gender, click the
                    active one again to go back to both. Emits the scoped
                    `!<species>,<gender>` guard. */}
								<span className='flex items-center gap-1' title={t('app.buddy_targets.gender_help')}>
									{['female', 'male'].map((g) => {
										const on = tg.gender === g;
										return (
											<button
												key={g}
												onClick={() => updateAt(i, { gender: on ? 'any' : g })}
												aria-pressed={on}
												aria-label={t(`app.buddy_targets.gender_${g}`)}
												className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
													on
														? 'bg-[#E67E22]/25 border-[#E67E22]/50 text-[#E67E22]'
														: 'bg-transparent border-[#2D3A47] text-[#8090A0] hover:text-[#E6EDF3]'
												}`}
											>
												{g === 'female' ? '♀' : '♂'}
											</button>
										);
									})}
								</span>
								{/* Regional-form picker: every form is catch-on by default; click
                    a chip to drop that form (struck through). Hidden for species
                    with no type-distinguishable regional forms. */}
								{forms && forms.length > 0 && (
									<span
										className='flex items-center gap-1 flex-wrap'
										title={t('app.buddy_targets.forms_help')}
									>
										{forms.map((f) => {
											const dropped = dropSet.has(f.key);
											return (
												<button
													key={f.key}
													onClick={() => toggleForm(i, f.key)}
													aria-pressed={!dropped}
													className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
														dropped
															? 'bg-transparent border-[#2D3A47] text-[#5A6673] line-through'
															: 'bg-[#E67E22]/25 border-[#E67E22]/50 text-[#E67E22]'
													}`}
												>
													{formRegionLabel(f, t)}
												</button>
											);
										})}
									</span>
								)}
								<button
									onClick={() => removeAt(i)}
									aria-label={t('app.a11y.remove_species', { params: { name: capFirst(tg.species) } })}
									className='ml-auto opacity-50 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-[#FF6B5B] transition text-[#E67E22]'
								>
									<X size={10} />
								</button>
							</div>
						);
					})}
				</div>
			)}

			<div className='flex gap-2'>
				<input
					type='text'
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && addAll()}
					placeholder={t('app.buddy_targets.input_placeholder')}
					aria-label={t('app.a11y.species_input')}
					className='mono text-xs flex-1 bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3] placeholder:text-[#8090A0]'
				/>
				<button
					onClick={addAll}
					disabled={previewTokens.length === 0 || newResolved.length === 0}
					className='mono text-xs bg-[#E67E22]/20 hover:bg-[#E67E22]/30 disabled:bg-[#1F2933] disabled:text-[#8090A0] text-[#E67E22] px-2.5 py-1 rounded transition flex items-center gap-1'
				>
					<Plus size={11} /> {t('app.buddy_targets.add_button')}
				</button>
			</div>

			{previewTokens.length > 0 && (
				<div className='border border-[#1F2933] rounded p-2 bg-[#0B0F14] space-y-1.5'>
					<div className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.buddy_targets.preview_summary', {
							params: { new: newResolved.length, dupes: dupes.length, unresolved: unresolved.length },
						})}
					</div>
					<div className='flex flex-wrap gap-1.5'>
						{previewTokens.map((tok, i) => {
							if (!tok.info)
								return (
									<span
										key={i}
										className='mono text-[11px] bg-[#FF6B5B]/15 text-[#FF6B5B] px-2 py-0.5 rounded'
									>
										✗ {tok.input}
									</span>
								);
							const isDupe = hasSpecies(tok.info.names.de.toLowerCase());
							const labelByType = {
								number: '#',
								en: 'EN',
								de: 'DE',
								es: 'ES',
								fr: 'FR',
								'zh-TW': 'ZH',
								hi: 'HI',
								ja: 'JA',
							};
							return (
								<span
									key={i}
									className={`mono text-[11px] px-2 py-0.5 rounded flex items-center gap-1 ${
										isDupe ? 'bg-[#5C6975]/15 text-[#8090A0]' : 'bg-[#E67E22]/15 text-[#E67E22]'
									}`}
								>
									<span className='text-[9px] opacity-60'>{labelByType[tok.info.inputLocale]}</span>
									{tok.info.names.de}
									{isDupe && <span className='opacity-60'>✓</span>}
								</span>
							);
						})}
					</div>
				</div>
			)}

			{/* Expert escape hatch: a verbatim, UNGUARDED filter line for this buddy. */}
			{expertMode && (
				<div className='border-t border-[#1F2933] pt-2 space-y-1'>
					<label htmlFor={rawId} className='mono text-[10px] uppercase tracking-wider text-[#8090A0]'>
						{t('app.buddy_targets.raw_label')}
					</label>
					<input
						id={rawId}
						type='text'
						value={buddy.rawAppend || ''}
						onChange={(e) => onChange({ rawAppend: e.target.value })}
						placeholder={t('app.buddy_targets.raw_placeholder')}
						aria-describedby={`${rawId}-help`}
						className='mono text-xs w-full bg-[#1F2933] border border-[#2D3A47] focus:border-[#5EAFC5] outline-none px-2 py-1 rounded text-[#E6EDF3] placeholder:text-[#8090A0]'
					/>
					<p id={`${rawId}-help`} className='mono text-[10px] text-[#8090A0] leading-relaxed'>
						{t('app.buddy_targets.raw_help')}
					</p>
				</div>
			)}
				</div>
			)}
		</div>
	);
}
