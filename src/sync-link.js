// Sync links: one person's whole setup, carried to another of their own
// devices.
//
// The app has no backend, so a laptop, a tablet and a phone each hold their own
// copy in localStorage. A sync link is the Settings backup file in a URL: the
// same envelope (`pogo-filter-workshop/v1`: hundos, luckies, attacker lists,
// config with buddies, home location, tags), so the receiving device runs it
// through the same validateImportEnvelope / prepareImport path and gets the
// same migrations a file import gets.
//
// The link is `<app url>#sync/<codec><payload>`. Everything after `#` stays in
// the browser, so the setup reaches no server.
//
//   codec `z` — base64url over deflate-raw over the UTF-8 JSON envelope
//   codec `j` — base64url over the UTF-8 JSON envelope, written only by a
//               browser without CompressionStream (Safari before 16.4)
//
// Compression is what makes this a link at all: a collection of 500 hundos and
// 900 luckies is about 34,000 characters plain and about 11,500 deflated.
//
// A sync link REPLACES the receiver's data; it does not merge. With plain
// lists, "removed on the laptop" and "not yet added on the phone" look the
// same, so a merge would bring back entries the sender released. The receiver
// therefore reviews the difference first (diffSyncState), and is warned when
// the device has changes newer than the link (linkIsOlderThan).

export const SYNC_HASH_PREFIX = '#sync/';
// Room for a large collection with many buddies (about 16,000 characters
// deflated), small enough that a junk link is refused before it is decoded.
export const SYNC_MAX_TOKEN = 60000;
// Ceiling on the inflated envelope, so a crafted token cannot expand without
// bound. A heavy real envelope is under 100 kB.
export const SYNC_MAX_JSON = 1_000_000;

const CODEC_DEFLATE = 'z';
const CODEC_PLAIN = 'j';

const hasStream = (name) => typeof globalThis[name] === 'function';

function bytesToBase64Url(bytes) {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(token) {
	const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Pipe bytes through a (De)CompressionStream, refusing output over `limit`.
async function pipeBytes(bytes, transform, limit = Infinity) {
	const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > limit) {
			await reader.cancel();
			throw new RangeError('sync payload too large');
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

// ─── sender side ───────────────────────────────────────────────────────────

// `compress: false` forces the plain codec; the check script uses it to cover
// the path an old Safari takes.
export async function encodeSyncToken(envelope, { compress = true } = {}) {
	const bytes = new TextEncoder().encode(JSON.stringify(envelope));
	if (compress && hasStream('CompressionStream')) {
		const packed = await pipeBytes(bytes, new CompressionStream('deflate-raw'));
		return CODEC_DEFLATE + bytesToBase64Url(packed);
	}
	return CODEC_PLAIN + bytesToBase64Url(bytes);
}

// → { ok: true, link } or { ok: false, code: 'too_long' }. A setup too large
// for a link still has the backup file.
export async function syncLinkFor(envelope, baseUrl, options) {
	const token = await encodeSyncToken(envelope, options);
	if (token.length > SYNC_MAX_TOKEN) return { ok: false, code: 'too_long' };
	return { ok: true, link: `${baseUrl}${SYNC_HASH_PREFIX}${token}` };
}

// ─── receiver side ─────────────────────────────────────────────────────────

export function isSyncHash(hash) {
	return typeof hash === 'string' && hash.startsWith(SYNC_HASH_PREFIX);
}

// The `#sync/…` part of whatever was pasted: a whole link, the hash alone, or
// a link a messenger wrapped over several lines. null when there is none.
export function extractSyncHash(text) {
	const flat = String(text ?? '').replace(/\s+/g, '');
	const at = flat.indexOf(SYNC_HASH_PREFIX);
	return at === -1 ? null : flat.slice(at);
}

// Hash → { ok: true, envelope } or { ok: false, code }. The envelope is parsed
// JSON and nothing more: the caller still runs validateImportEnvelope and
// prepareImport, exactly as for a backup file. Codes: 'not_sync', 'too_long',
// 'garbled', 'unsupported_browser' (a deflated link in a browser that cannot
// inflate it).
export async function parseSyncHash(hash) {
	if (!isSyncHash(hash)) return { ok: false, code: 'not_sync' };
	const token = hash.slice(SYNC_HASH_PREFIX.length).trim();
	if (token.length > SYNC_MAX_TOKEN) return { ok: false, code: 'too_long' };
	if (!/^[A-Za-z0-9_-]{2,}$/.test(token)) return { ok: false, code: 'garbled' };
	const codec = token[0];
	if (codec !== CODEC_DEFLATE && codec !== CODEC_PLAIN) return { ok: false, code: 'garbled' };
	if (codec === CODEC_DEFLATE && !hasStream('DecompressionStream')) return { ok: false, code: 'unsupported_browser' };
	try {
		let bytes = base64UrlToBytes(token.slice(1));
		if (codec === CODEC_DEFLATE) bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'), SYNC_MAX_JSON);
		else if (bytes.length > SYNC_MAX_JSON) return { ok: false, code: 'too_long' };
		const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return { ok: false, code: 'garbled' };
		return { ok: true, envelope };
	} catch (err) {
		return { ok: false, code: err instanceof RangeError ? 'too_long' : 'garbled' };
	}
}

// ─── review ────────────────────────────────────────────────────────────────

// Key-order-independent JSON, so two configs that differ only in the order
// their keys were written compare equal.
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

function listDiff(before, after) {
	const keyOf = (x) => (typeof x === 'string' ? x : canonical(x));
	const had = new Set((before || []).map(keyOf));
	const has = new Set((after || []).map(keyOf));
	const once = (list, other) => {
		const seen = new Set();
		return (list || []).filter((x) => {
			const k = keyOf(x);
			if (other.has(k) || seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	};
	return { added: once(after, had), removed: once(before, has) };
}

// Bookkeeping the app writes for itself (which catalog entries a device has
// already been told about). It differs between devices without the user having
// changed anything, so it is not counted as a setting that differs.
const isBookkeeping = (key) => /Seen$/.test(key);

// What applying `incoming` would change on a device holding `current`. Both
// are { hundos, luckies, topAttackers, topMaxAttackers, config, homeLocation,
// bazaarTags }; `incoming` is prepareImport's output, where a key the link
// does not carry is absent and stays as it is on the device.
//
//   hundos, luckies, tags — { added, removed } entries, as stored
//   attackers             — { added, removed } counts over both rosters
//   buddies               — { added, removed, changed } buddy names
//   settings              — config keys whose value differs (buddies and
//                           bookkeeping aside)
//   home                  — true when the home location differs
//   identical             — true when none of the above differs
export function diffSyncState(current, incoming) {
	const cur = current || {};
	const inc = incoming || {};
	const has = (k) => Object.prototype.hasOwnProperty.call(inc, k);
	const lists = (k) => (has(k) ? listDiff(cur[k], inc[k]) : { added: [], removed: [] });

	const hundos = lists('hundos');
	const luckies = lists('luckies');
	const tags = lists('bazaarTags');
	const ta = lists('topAttackers');
	const tma = lists('topMaxAttackers');
	const attackers = { added: ta.added.length + tma.added.length, removed: ta.removed.length + tma.removed.length };

	const buddies = { added: [], removed: [], changed: [] };
	const settings = [];
	if (has('config')) {
		const a = cur.config || {};
		const b = inc.config || {};
		for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
			if (key === 'buddies' || isBookkeeping(key)) continue;
			if (canonical(a[key]) !== canonical(b[key])) settings.push(key);
		}
		const list = (cfg) => (Array.isArray(cfg.buddies) ? cfg.buddies.filter((x) => x && typeof x === 'object') : []);
		const label = (x) => String(x.name || x.tagPrefix || x.id || '');
		const before = new Map(list(a).map((x) => [x.id, x]));
		const after = new Map(list(b).map((x) => [x.id, x]));
		for (const [id, x] of after) {
			if (!before.has(id)) buddies.added.push(label(x));
			else if (canonical(before.get(id)) !== canonical(x)) buddies.changed.push(label(x));
		}
		for (const [id, x] of before) if (!after.has(id)) buddies.removed.push(label(x));
	}

	const home = has('homeLocation') && canonical(cur.homeLocation ?? null) !== canonical(inc.homeLocation ?? null);
	const identical =
		!home &&
		settings.length === 0 &&
		[hundos, luckies, tags].every((d) => d.added.length === 0 && d.removed.length === 0) &&
		attackers.added === 0 &&
		attackers.removed === 0 &&
		buddies.added.length + buddies.removed.length + buddies.changed.length === 0;
	return { hundos, luckies, tags, attackers, buddies, settings, home, identical };
}

// True when the device's last change (`changedAt`) is later than the moment
// the link was made (`exportedAt`), both ISO timestamps. False when either is
// missing or unreadable: an unknown age is no reason to warn.
export function linkIsOlderThan(exportedAt, changedAt) {
	const made = Date.parse(exportedAt ?? '');
	const changed = Date.parse(changedAt ?? '');
	if (Number.isNaN(made) || Number.isNaN(changed)) return false;
	return changed > made;
}
