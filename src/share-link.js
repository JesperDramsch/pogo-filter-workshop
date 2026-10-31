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
// The sender id is generated once per install and lets a second link from the
// same friend UPDATE their buddy instead of adding a duplicate. When their lucky
// lands they send a fresh link and the species drops off the receiver's list.

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
	if (targets.length === 0) return { ok: false, code: 'empty' };
	return { ok: true, wish: { id, name, targets, unresolved } };
}

// Default tag prefix for a new buddy, the same `Trade-<letters>` scheme the
// buddy manager uses for one typed in by hand.
export function buddyTagPrefixFor(name) {
	const bare = String(name).replace(/[^\p{L}\p{N}]/gu, '');
	return bare ? `Trade-${bare}` : 'Trade-Friend';
}

// Which existing buddy a wish link lands on: the one carrying the sender's id,
// else a hand-made buddy (no id yet) with the same name, so a friend you already
// set up by hand is updated rather than doubled. null → a new buddy.
export function matchSharedBuddy(buddies, wish) {
	const list = Array.isArray(buddies) ? buddies : [];
	if (wish.id) {
		const byId = list.find((b) => b && b.shareId === wish.id);
		if (byId) return byId;
	}
	const lower = wish.name.toLocaleLowerCase();
	return list.find((b) => b && !b.shareId && String(b.name || '').toLocaleLowerCase() === lower) || null;
}

// Apply a parsed wish to the buddy list. Returns { buddies, buddyId, created }.
// On an update the wish list REPLACES the buddy's targets (the link is the
// sender's whole current list, so a species they got drops off) and everything
// the receiver set up stays: name, tag prefix, trade-evo toggle, raw append.
// `normalize` is normalizeBuddyTarget, passed in to keep this module free of
// the App.jsx import graph.
export function applyWishToBuddies(buddies, wish, normalize, now = Date.now()) {
	const list = Array.isArray(buddies) ? buddies : [];
	const targetSpecies = wish.targets.map(normalize).filter(Boolean);
	const hit = matchSharedBuddy(list, wish);
	if (hit) {
		const next = { ...hit, targetSpecies, active: true };
		if (wish.id) next.shareId = wish.id;
		return { buddies: list.map((b) => (b === hit ? next : b)), buddyId: hit.id, created: false };
	}
	// Two friends who both go by "Alex" must not share a tag: a #Trade-Alex
	// promised to one would read as promised to the other. Number the newcomer.
	const taken = new Set(list.map((b) => String(b?.tagPrefix || '').toLocaleLowerCase()));
	const basePrefix = buddyTagPrefixFor(wish.name);
	let tagPrefix = basePrefix;
	for (let n = 2; taken.has(tagPrefix.toLocaleLowerCase()); n++) tagPrefix = `${basePrefix}${n}`;
	const id = `${tagPrefix.slice('Trade-'.length).toLowerCase()}-${now.toString(36)}`;
	const buddy = { id, name: wish.name, tagPrefix, targetSpecies, wantsTradeEvos: false, rawAppend: '', active: true };
	if (wish.id) buddy.shareId = wish.id;
	return { buddies: [...list, buddy], buddyId: id, created: true };
}
