// Wish-list share links: one friend's "collect for me" list, carried to another
// friend's app as a trade buddy.
//
// The two halves already existed. The sender's curated friend-collect list
// (config.friendCollectSpecies plus its gender / form / slot refinements) says
// what they still want; the receiver's trade buddy (config.buddies[].targetSpecies)
// turns a wish list into a "catch for <name>" filter and protects the promised
// #Trade-<name> tags. Before this, the receiver typed the sender's list in by hand.
//
// The link is `<app url>#wish/<token>`. Everything after `#` stays in the
// browser (it is never sent to GitHub Pages), so the list reaches no server.
// The token is base64url over a compact JSON payload:
//
//   { v: 1, id: <sender id>, n: <sender name>, t: [ { s, g?, f?, l? }, … ] }
//
//   s — the species as a dex key from pokemon-names.json ("25", "29"), never a
//       name: sender and receiver may play in different locales, and the
//       receiver's own pokemonNameFor() names it in theirs.
//   g — "m" | "f", a gender lock (Combee, Salandit).
//   f — regional-form keys the sender does NOT want (buddy dropForms semantics).
//   l — un-searchable slot keys the sender does NOT want (buddy dropSlots).
//
// What the link deliberately does not carry: whether the sender is after
// luckies or hundos. How the receiver sorts their own storage (keep old catches
// back for a lucky trade, or not) is the receiver's call, set in their own app.
//
// The sender id is generated once per install. The receiver's app uses it to
// preselect the buddy a second link should update (rankBuddyCandidates), and
// the receiver confirms or picks another. When the sender's lucky lands they
// send a fresh link and the species drops off; once nothing is left the link
// carries an empty list, which offers to remove the buddy.

import { resolveSpecies, resolveSpeciesInfo } from './data/species.js';

export const WISH_HASH_PREFIX = '#wish/';
export const WISH_VERSION = 1;
// Generous for a curated list, small enough that a pasted junk link cannot
// make the receiver's config huge.
export const WISH_MAX_TARGETS = 400;
export const WISH_MAX_TOKEN = 24000;
export const WISH_MAX_NAME = 40;
const WISH_MAX_ID = 64;

// ─── base64url over UTF-8 ──────────────────────────────────────────────────
// btoa/atob only take Latin-1, and a sender called "Jürgen" or "ユウキ" is the
// normal case in a seven-locale app, so the bytes go through TextEncoder first.

function toBase64Url(str) {
	const bytes = new TextEncoder().encode(str);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token) {
	const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// Control characters and bidi overrides out, whitespace collapsed, length
// capped. The name ends up as a buddy name and, letters only, in a tag prefix.
const UNSAFE_NAME_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;
export function cleanShareName(raw) {
	return String(raw ?? '')
		.replace(UNSAFE_NAME_CHARS, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, WISH_MAX_NAME);
}

export function newShareId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ─── sender side ───────────────────────────────────────────────────────────

// The wire targets for the sender's curated list. `targets` is buildFilters'
// friendCollectTargets; only the ones still asked for travel (the same
// `!owned || forced` rule that decides what reaches the sender's own string),
// so the link and the sender's filter can never disagree about what is wanted.
export function wishTargetsFromConfig(cfg, targets) {
	const out = [];
	const seen = new Set();
	for (const tg of targets || []) {
		if (tg.owned && !tg.forced) continue;
		const sp = tg.species;
		const dexKey = resolveSpeciesInfo(sp)?.dexKey;
		if (!dexKey || seen.has(dexKey)) continue;
		seen.add(dexKey);
		const entry = { s: dexKey };
		const g = cfg.friendCollectGenders?.[sp];
		if (g === 'male') entry.g = 'm';
		else if (g === 'female') entry.g = 'f';
		const f = cfg.friendCollectDropForms?.[sp];
		if (Array.isArray(f) && f.length) entry.f = [...f];
		const l = cfg.friendCollectDropSlots?.[sp];
		if (Array.isArray(l) && l.length) entry.l = [...l];
		out.push(entry);
	}
	return out;
}

export function encodeWishToken({ id, name, targets }) {
	return toBase64Url(JSON.stringify({ v: WISH_VERSION, id, n: cleanShareName(name), t: targets }));
}

export function wishLinkFor(payload, baseUrl) {
	return `${baseUrl}${WISH_HASH_PREFIX}${encodeWishToken(payload)}`;
}

// ─── receiver side ─────────────────────────────────────────────────────────

export function isWishHash(hash) {
	return typeof hash === 'string' && hash.startsWith(WISH_HASH_PREFIX);
}

// Hash → { ok: true, wish: { id, name, targets, unresolved } } or { ok: false, code }.
// `targets` come out in buddy shape ({ species, expand, gender, dropForms,
// dropSlots }) with species as canonical storage-locale names; the caller still
// runs them through normalizeBuddyTarget, which drops form and slot keys the
// receiver's catalog does not know. Codes: 'not_wish', 'too_long', 'garbled',
// 'unsupported_version', 'no_name', 'empty'.
export function parseWishHash(hash) {
	if (!isWishHash(hash)) return { ok: false, code: 'not_wish' };
	const token = hash.slice(WISH_HASH_PREFIX.length).trim();
	if (token.length > WISH_MAX_TOKEN) return { ok: false, code: 'too_long' };
	if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, code: 'garbled' };
	let payload;
	try {
		payload = JSON.parse(fromBase64Url(token));
	} catch {
		return { ok: false, code: 'garbled' };
	}
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, code: 'garbled' };
	if (payload.v !== WISH_VERSION) return { ok: false, code: 'unsupported_version' };
	const name = cleanShareName(payload.n);
	if (!name) return { ok: false, code: 'no_name' };
	const id = typeof payload.id === 'string' && payload.id && payload.id.length <= WISH_MAX_ID ? payload.id : null;
	if (!Array.isArray(payload.t)) return { ok: false, code: 'garbled' };

	const targets = [];
	const seen = new Set();
	let unresolved = 0;
	const strings = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === 'string').slice(0, 32) : []);
	for (const e of payload.t.slice(0, WISH_MAX_TARGETS)) {
		const raw = e && typeof e === 'object' ? e.s : null;
		// Only dex keys are accepted. A name would resolve too, but then the link
		// format would quietly depend on the name dictionaries never colliding.
		const species = typeof raw === 'string' && /^\d{1,4}(_[A-Za-z0-9]+)?$/.test(raw) ? resolveSpecies(raw) : null;
		if (!species) {
			unresolved++;
			continue;
		}
		if (seen.has(species)) continue;
		seen.add(species);
		targets.push({
			species,
			expand: false,
			gender: e.g === 'm' ? 'male' : e.g === 'f' ? 'female' : 'any',
			dropForms: strings(e.f),
			dropSlots: strings(e.l),
		});
	}
	// An empty list is a valid link: the sender has everything and wants their
	// buddy cleared. A list whose entries ALL failed to resolve is not; that is
	// an older app reading a newer roster, and clearing on it would be wrong.
	if (targets.length === 0 && unresolved > 0) return { ok: false, code: 'empty' };
	return { ok: true, wish: { id, name, targets, unresolved } };
}

// Default tag prefix for a buddy: `Trade-<letters and digits of the name>`.
// Any script's letters count, so "ユウキ" gives `Trade-ユウキ` rather than an
// empty tag. The buddy manager uses this too, for buddies typed in by hand.
export function buddyTagPrefixFor(name) {
	const bare = String(name ?? '').replace(/[^\p{L}\p{N}]/gu, '');
	return bare ? `Trade-${bare}` : '';
}

// Pokémon GO matches `#tags` by prefix: a search for #Trade-Alex also lists
// #Trade-Alex2 and #Trade-Alexander. Two buddy prefixes clash when either is a
// prefix of the other (case-insensitive), because a search for one then finds
// the other's promised trades.
export function tagPrefixesClash(a, b) {
	const x = String(a || '').toLocaleLowerCase();
	const y = String(b || '').toLocaleLowerCase();
	if (!x || !y) return false;
	return x.startsWith(y) || y.startsWith(x);
}

// Existing prefixes that clash with `prefix`, excluding the buddy `exceptId`
// (the one being edited or updated).
export function clashingPrefixes(prefix, buddies, exceptId = null) {
	return (Array.isArray(buddies) ? buddies : [])
		.filter((b) => b && b.id !== exceptId && tagPrefixesClash(prefix, b.tagPrefix))
		.map((b) => b.tagPrefix);
}

// Every pair of buddies whose prefixes clash, as [prefixA, prefixB] in buddy
// order. The tagging scheme's "promised" row lists these: a hand-edited
// prefix can collide with another buddy's even though a generated one never
// does. Two buddies with the same prefix clash too (they share every tag).
export function buddyPrefixClashPairs(buddies) {
	const list = (Array.isArray(buddies) ? buddies : []).filter((b) => b && b.tagPrefix);
	const pairs = [];
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			if (tagPrefixesClash(list[i].tagPrefix, list[j].tagPrefix)) pairs.push([list[i].tagPrefix, list[j].tagPrefix]);
		}
	}
	return pairs;
}

// A tag prefix for a new buddy called `name` that clashes with no existing
// buddy. The number goes in FRONT of the name (`Trade-2Alex`), because a
// number at the end (`Trade-Alex2`) still starts with `Trade-Alex` and so
// clashes by construction. Editable afterwards like any other prefix.
export function freeTagPrefix(name, buddies) {
	const base = buddyTagPrefixFor(name) || 'Trade-Friend';
	if (clashingPrefixes(base, buddies).length === 0) return base;
	const bare = base.slice('Trade-'.length);
	for (let n = 2; n < 1000; n++) {
		const candidate = `Trade-${n}${bare}`;
		if (clashingPrefixes(candidate, buddies).length === 0) return candidate;
	}
	return `Trade-${newShareId().slice(0, 6)}${bare}`;
}

// The receiver chooses which buddy a link lands on; this ranks the guesses.
// Returns [{ buddy, match }] with match 'certain' (same sender id), 'likely'
// (same name, set up by hand, no sender id yet) or null, best first, then the
// rest in their own order. `best` is the preselection: the top candidate when
// it is certain or likely, else null for "add as a new buddy".
export function rankBuddyCandidates(buddies, wish) {
	const list = (Array.isArray(buddies) ? buddies : []).filter((b) => b && typeof b === 'object');
	const lower = wish.name.toLocaleLowerCase();
	const matchOf = (b) => {
		if (wish.id && b.shareId === wish.id) return 'certain';
		if (!b.shareId && String(b.name || '').toLocaleLowerCase() === lower) return 'likely';
		return null;
	};
	const rank = { certain: 0, likely: 1 };
	// Once the sender id settles it, a same-name guess on another buddy is only
	// noise: that buddy is offered, just not flagged.
	const certain = list.some((b) => matchOf(b) === 'certain');
	const ranked = list
		.map((buddy, i) => {
			const match = matchOf(buddy);
			return { buddy, match: certain && match === 'likely' ? null : match, i };
		})
		.sort((a, b) => (rank[a.match] ?? 2) - (rank[b.match] ?? 2) || a.i - b.i)
		.map(({ buddy, match }) => ({ buddy, match }));
	const best = ranked[0]?.match ? ranked[0].buddy.id : null;
	return { candidates: ranked, best };
}

// What the receiver's dialog offers for a link, so the choice logic is tested
// here rather than living untested inside the component.
//   options    — candidates to list, best first
//   preselect  — buddy id, 'new', or null (nothing checked)
//   nothingToDo — true when the dialog has nothing to offer but "OK"
// A list goes anywhere the receiver points it: every buddy plus "new", with a
// guess preselected or "new". An EMPTY list ("I have everything") is
// destructive (it empties or removes a buddy), so it only ever offers buddies
// the link actually matches. A done link from someone the receiver never added
// must not land on an unrelated buddy; that buddy can still be cleared by hand.
export function wishDialogOptions(buddies, wish) {
	const ranked = rankBuddyCandidates(buddies, wish);
	if (wish.targets.length === 0) {
		const options = ranked.candidates.filter((c) => c.match);
		return { options, preselect: ranked.best, nothingToDo: options.length === 0 };
	}
	return { options: ranked.candidates, preselect: ranked.best ?? 'new', nothingToDo: false };
}

// Apply a parsed wish to the buddy list as the receiver chose:
//   choice = { mode: 'update', buddyId }        replace that buddy's wish list
//   choice = { mode: 'new', tagPrefix? }       add a buddy (prefix defaults to
//                                               freeTagPrefix)
//   choice = { mode: 'remove', buddyId }       the sender has everything: drop it
// Returns { buddies, buddyId, action }. An update keeps everything the receiver
// set up (name, tag prefix, trade-evo toggle, raw append) and from then on
// remembers the sender's id. New buddies get a random internal id; the name
// and tag are only labels. `normalize` is normalizeBuddyTarget, passed in to
// keep this module free of the App.jsx import graph.
export function applyWishToBuddies(buddies, wish, normalize, choice) {
	const list = Array.isArray(buddies) ? buddies : [];
	const targetSpecies = wish.targets.map(normalize).filter(Boolean);
	if (choice?.mode === 'remove') {
		return { buddies: list.filter((b) => b?.id !== choice.buddyId), buddyId: choice.buddyId, action: 'removed' };
	}
	if (choice?.mode === 'update') {
		const hit = list.find((b) => b?.id === choice.buddyId);
		if (hit) {
			const next = { ...hit, targetSpecies, active: true };
			if (wish.id) next.shareId = wish.id;
			return { buddies: list.map((b) => (b === hit ? next : b)), buddyId: hit.id, action: 'updated' };
		}
	}
	const typed = String(choice?.tagPrefix ?? '').trim().replace(/^#/, '');
	const tagPrefix = typed || freeTagPrefix(wish.name, list);
	const id = newShareId();
	const buddy = { id, name: wish.name, tagPrefix, targetSpecies, wantsTradeEvos: false, rawAppend: '', active: true };
	if (wish.id) buddy.shareId = wish.id;
	return { buddies: [...list, buddy], buddyId: id, action: 'added' };
}
