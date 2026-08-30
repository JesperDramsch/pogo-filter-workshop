// Per-species collection REFINEMENTS — the badge row that hangs off a species
// chip and narrows it from "the species" to "this particular copy of it".
//
// Five chip surfaces grew their own copy of this row (the two have-lists in
// step 3, the friend-collect targets, and the buddy catch-targets), each with
// slightly different markup, tinting and ARIA. This module is the one place
// that knows:
//
//   • WHICH refinement axis a species has (a species has at most one — the
//     three catalogs are asserted disjoint in scripts/check-lucky-logic.mjs,
//     which is why a chip never renders two badge groups),
//   • what its options are called in the user's locale, and
//   • how a badge row looks and announces itself.
//
// The SEMANTICS stay at the call site, because they genuinely differ: a
// have-list badge records what you OWN (additive, multi-select), a wishlist
// badge narrows what a friend should CATCH (drop-based, or a single lock).
// Call sites express that through `stateFor`/`onToggle`; everything else —
// catalog, labels, aria-pressed, tinting, sizing — comes from here.

import React from 'react';
import { resolveSpeciesInfo } from './data/species.js';
import REGIONAL_FORMS from './data/regional-forms.json';

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
// No upstream carries this as a searchable distinction — Sesokitz's four
// seasonal forms are all Normal/Grass in the game master, so no type predicate
// can separate them — and so it is hand-maintained. The bar for entry is deliberately high:
// forms that DO differ by type belong in regional-forms.json instead, where
// they become real search guards — that is where Burmadame's cloaks and
// Choreogel's styles now live.
//
// `types` is the ONE type combination every form of the species shares — the
// very property that makes the slots un-searchable. It is not a guard (nothing
// here can ever be isolated by type); it exists so a form-scoped exclusion
// emitted for a SIBLING can be proven harmless to this species. See
// formGuardHides below.
const INVISIBLE_FORM_SLOTS = {
	585: { axis: 'season', slots: ['spring', 'summer', 'autumn', 'winter'], types: ['normal', 'grass'] }, // Sesokitz
	586: { axis: 'season', slots: ['spring', 'summer', 'autumn', 'winter'], types: ['normal', 'grass'] }, // Kronjuwild
	421: { axis: 'cherrim', slots: ['overcast', 'sunny'], types: ['grass'] }, // Kinoso — fixed at evolution
	// Burmy: gender and cloak interact rather than stacking — ♀ carries the
	// cloak into Burmadame, ♂ becomes Moterpel and the cloak is discarded. So
	// it is ONE four-slot group, not a gender group plus a cloak group, and the
	// chip still renders a single row. (Burmadame itself is type-searchable —
	// and all four Burmy slots are pure Bug, which is what lets Burmadame's
	// cloak guards coexist with an unfinished Burmy.)
	412: { axis: 'burmy', slots: ['male', 'plant', 'sandy', 'trash'], types: ['bug'] },
	925: { axis: 'maushold', slots: ['family3', 'family4'], types: ['normal'] }, // ~99:1 roll
	982: { axis: 'dudunsparce', slots: ['twoseg', 'threeseg'], types: ['normal'] }, // ~99:1 roll
};

// Would the form guard `f` (an entry from regional-forms.json, applied inside a
// `!+family,<terms>` clause) actually hide a species whose type combination is
// `types`? The clause hides exactly the family members matching the form
// predicate — every `include` type present and no `exclude` type present — so a
// species missing any include type, or carrying an exclude type, walks straight
// through it. Unknown types answer "yes": absence of proof is not proof of
// absence, and over-excluding is the failure this check exists to prevent.
// Exported for the offline checks in scripts/check-lucky-logic.mjs.
export function formGuardHides(f, types) {
	if (!Array.isArray(types) || types.length === 0) return true;
	const has = new Set(types);
	if (!(f.include || []).every((ty) => has.has(ty))) return false;
	return !(f.exclude || []).some((ty) => has.has(ty));
}

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
export function formRegionLabel(form, tFn) {
	// Non-regional axes (Burmadame cloaks, Choreogel styles) have no region to
	// name — the variant IS the whole label ("Pflanzenumhang", not
	// "Sinnoh (Pflanze)").
	if (form.axis) return tFn(`app.buddy_targets.form_variant.${form.variant}`);
	const region = tFn(`app.buddy_targets.form_region.${form.region}`);
	if (form.variant) return `${region} (${tFn(`app.buddy_targets.form_variant.${form.variant}`)})`;
	return region;
}


// ── The unified axis model ───────────────────────────────────────────────────
//
// The three catalogs above answer the same question in three ways, so callers
// that only want "what can I refine this chip by?" get one lookup instead of a
// three-way if-chain repeated per surface.
//
// AXIS_FORM and AXIS_GENDER are SEARCHABLE: PoGo can express them, so a
// wishlist pick becomes a real scoped guard. AXIS_SLOT is not — nothing the
// user clicks there can ever reach the filter string. Its only power is to
// keep a species on the ask until every slot is ticked, which is exactly why
// `searchable` is part of the descriptor rather than something each call site
// re-derives from the catalog it happened to hit.
export const AXIS_FORM = 'form';
export const AXIS_GENDER = 'gender';
export const AXIS_SLOT = 'slot';

// The single refinement axis a species carries, or null for the vast majority
// that carry none. Order matters only as documentation: the catalogs are
// disjoint, so at most one branch can ever match.
export function refinementAxisFor(species) {
	const forms = regionalFormsFor(species);
	if (forms && forms.length > 0)
		return { axis: AXIS_FORM, keys: forms.map((f) => f.key), forms, searchable: true };
	const closing = genderSlotsFor(species);
	if (closing) return { axis: AXIS_GENDER, keys: ['female', 'male'], closing, searchable: true };
	const entry = invisibleSlotsFor(species);
	if (entry) return { axis: AXIS_SLOT, keys: entry.slots, group: entry.axis, searchable: false };
	return null;
}

// The gender axis as a WISHLIST lock rather than an ownership record. Any
// species can be asked for as ♀ or ♂ — PoGo's gender keyword is universal —
// so the wishlist surfaces do not gate this on GENDER_SLOT_DEX the way the
// have-lists do. (The catalog only answers "does gender decide whether MY
// slot is filled", which is a different question.)
export const GENDER_LOCK_AXIS = {
	axis: AXIS_GENDER,
	keys: ['female', 'male'],
	closing: ['female', 'male'],
	searchable: true,
};

// Visible badge text for one option of an axis.
export function refinementLabel(entry, key, tFn) {
	if (!entry) return key;
	if (entry.axis === AXIS_FORM) {
		const form = entry.forms.find((f) => f.key === key);
		return form ? formRegionLabel(form, tFn) : key;
	}
	if (entry.axis === AXIS_GENDER) return key === 'female' ? '♀' : '♂';
	return tFn(`app.have_slots.${entry.group}.${key}`);
}

// Accessible name, where the visible text can't serve as one. ♀/♂ announce as
// a symbol or not at all, so the gender axis always names its badges; form and
// slot badges carry real words and are named by their own text.
export function refinementAriaLabel(entry, key, tFn) {
	if (entry?.axis === AXIS_GENDER) return tFn(`app.buddy_targets.gender_${key}`);
	return undefined;
}

// ── Wishlist picking: what you WANT, stored as what you DON'T ────────────────
//
// The wishlist surfaces STORE the dropped options — the complement of the ask —
// because that is the shape the config and every emitter speak: an absent entry
// means "every form", so a target that dropped nothing is indistinguishable
// from one nobody ever touched, which is exactly right.
//
// The user CLICKS the form they want ("collect me the Kanto one"), the same way
// they click the ♀/♂ lock sitting right above it on the very same chip. These
// two helpers are the whole translation between the two directions, kept here
// so no surface re-derives the inversion by hand: reading it backwards is a
// silent, entirely plausible-looking bug — the chip lights up, the string is
// well-formed, and it asks a friend for precisely the form you already have.
//
// Not shared with the buddy catch-targets on purpose: those render every form
// lit at rest, so "all of them, minus the ones I struck out" is what the row
// visibly says, and a drop-click is the honest affordance there.

// Is `key` part of what the target currently asks for? An empty `dropped` means
// no pick has been made, which asks for EVERY option — rendered as nothing lit
// rather than everything lit, so a tint on this row only ever means "I picked
// this one".
export function optionPicked(dropped, key) {
	return Array.isArray(dropped) && dropped.length > 0 && !dropped.includes(key);
}

// The next stored drop-list after a click on `key`, or null when the ask is
// unrestricted again. The first click on an untouched row picks that option
// alone; further clicks widen the ask; clicking a picked option takes it back
// out. Un-picking the last one — and its mirror image, picking every option —
// both land on "asks for everything", which the config expresses as absence.
// No click is ever a no-op: the old drop-based row silently refused to drop
// the last kept form, which read as a dead button.
export function togglePickedOption(keys, dropped, key) {
	const current = keys.filter((k) => optionPicked(dropped, k));
	const picked = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
	if (picked.length === 0 || picked.length === keys.length) return null;
	return keys.filter((k) => !picked.includes(k));
}

// Is a set of ticked options complete for this axis? For the gender axis
// "complete" means every gender that CLOSES the slot is owned — owning the ♂
// Wadribie is worth recording but does not finish it.
export function refinementComplete(entry, ticked) {
	if (!entry) return false;
	const owned = new Set(ticked || []);
	const required = entry.axis === AXIS_GENDER ? entry.closing : entry.keys;
	return required.every((k) => owned.has(k));
}

// ── The badge row ────────────────────────────────────────────────────────────

// Per-option render state, decided by the call site:
//   'on'      — ticked: owned (have-lists) / wanted (wishlists). Tinted.
//   'off'     — untouched. Neutral outline.
//   'dropped' — deliberately excluded from an otherwise all-in ask. Struck
//               through and dimmer than 'off', so "I turned this one off"
//               never reads the same as "I have not been here yet".

// ── Tap targets, which are not the same thing as paint ───────────────────────
//
// The badges are deliberately tiny: a chip cloud with fifty species has to stay
// calm, and 9px text in a 37×20 box does that. But the painted box was also the
// whole hit target, and the row set them 2px apart — so a fingertip (~40px of
// contact) covered two badges at once and the browser handed the press to
// whichever one its centroid landed in. Under a mouse the row was flawless;
// under a thumb "Einall" reliably toggled the Hisui badge beside it, and the
// last badge sat 6px from the ✕ that deletes the whole species.
//
// So the visual size stays and the target grows underneath it. `min-h`/`min-w`
// clear WCAG 2.5.8's 24×24 CSS px on every pointer — which the old 20px-tall,
// 15px-wide ♀/♂ badges did not — and the coarse-pointer branch takes both to
// 32, with roomier padding and readable text on the devices that need it.
//
// 32 and not the 44 of Apple's HIG and WCAG 2.5.5 (AAA): these badges live
// INSIDE an inline chip beside the species name, and at 44 the row stops
// fitting a phone — it wraps into a two-by-two block with the name stranded
// alongside, trading a mis-tap for an unreadable chip. 32px is ~8.5mm, inside
// the 7–10mm a fingertip wants, and keeps the chip on one line.
//
// The row widens its gap to match, because separation is the other half of a
// hittable target: two 32px badges 2px apart are one unbroken 66px run, and a
// press landing on the seam is still ambiguous however big each half is.
//
// `[@media(pointer:coarse)]:` rather than a stylesheet rule on purpose — as a
// Tailwind arbitrary variant it lands in the utilities layer, so it beats the
// `px-1` sitting next to it instead of losing a specificity race to it.
//
// Every class below is written out in full, and has to be: Tailwind generates
// CSS by scanning these files for literal class names, so a prefix spliced in
// through `${…}` produces markup referring to a rule that was never emitted —
// silently, and only on the devices the variant targets. Repeating
// `[@media(pointer:coarse)]:` is the price of the utility actually existing.
const TOUCH_TARGET =
	'min-h-[24px] min-w-[24px] [@media(pointer:coarse)]:min-h-[32px] [@media(pointer:coarse)]:min-w-[32px]';

// The same rule for the ✕ that removes a chip: a 10px icon in a button with no
// padding is a 10×10 target, and it is the one control in these rows whose
// mis-tap is destructive. Exported so the six chip lists in App.jsx state it
// once rather than each growing their own idea of a touch target.
export const CHIP_REMOVE_TARGET = `inline-flex items-center justify-center ${TOUCH_TARGET}`;

// Row spacing — the separation half of the rule above, kept beside the sizes it
// has to stay in step with.
export const BADGE_ROW_GAP = 'gap-0.5 [@media(pointer:coarse)]:gap-2';

const BADGE_SIZE = {
	xs: 'text-[9px] px-1 py-px [@media(pointer:coarse)]:text-[11px] [@media(pointer:coarse)]:px-2.5',
	sm: 'text-[10px] px-1.5 py-0.5 [@media(pointer:coarse)]:text-[11px] [@media(pointer:coarse)]:px-2.5',
};

// One refinement row for one species chip. Pure presentation plus ARIA: it
// holds no state and takes no opinion on what a click means.
//
//   entry     — from refinementAxisFor(); null renders nothing
//   stateFor  — (optionKey) => 'on' | 'off' | 'dropped'
//   onToggle  — (optionKey) => void; absent renders nothing (read-only chips)
//   tint      — accent for the 'on' state; tintFor overrides it per option
//               (the have-lists go amber once an axis is complete)
//   ringFor   — optional per-option emphasis ring (the season spawning now)
//   titleFor  — optional per-option tooltip
export function RefinementBadges({
	entry,
	t,
	title,
	size = 'xs',
	tint = '#5EAFC5',
	stateFor,
	onToggle,
	tintFor,
	ringFor,
	titleFor,
}) {
	if (!entry || !onToggle) return null;
	const dims = BADGE_SIZE[size] || BADGE_SIZE.xs;
	return (
		<span className={`flex items-center flex-wrap ${BADGE_ROW_GAP}`} title={title}>
			{entry.keys.map((key) => {
				const state = stateFor(key);
				const on = state === 'on';
				const shade = (tintFor && tintFor(key)) || tint;
				return (
					<button
						key={key}
						onClick={() => onToggle(key)}
						aria-pressed={on}
						aria-label={refinementAriaLabel(entry, key, t)}
						title={titleFor ? titleFor(key) : undefined}
						className={`${dims} ${TOUCH_TARGET} inline-flex items-center justify-center rounded border transition ${
							on
								? ''
								: state === 'dropped'
									? 'bg-transparent border-[#2D3A47] text-[#3E4854] line-through'
									: 'bg-transparent border-[#2D3A47] text-[#5A6673] hover:text-[#E6EDF3]'
						} ${ringFor && ringFor(key) ? 'ring-1 ring-[#E2B93B]/70' : ''}`}
						style={on ? { background: `${shade}40`, borderColor: `${shade}80`, color: shade } : undefined}
					>
						{refinementLabel(entry, key, t)}
					</button>
				);
			})}
		</span>
	);
}
