// Verifies sync links (src/sync-link.js): one person's whole setup, carried to
// another of their own devices inside a #sync/ link, reviewed there and then
// applied through the same import path as a backup file.
//
//   Y1 — the link is a lossless carrier: what prepareImport makes of the
//        envelope is the same before and after the trip
//   Y2 — both codecs read back, and deflate is what keeps a real collection
//        inside a link
//   Y3 — junk links are refused with a code, never a throw, and a token that
//        inflates without bound is cut off
//   Y4 — a pasted link is found in whatever surrounds it
//   Y5 — the review: a device's own link changes nothing, and each kind of
//        difference is reported where the receiver will look for it
//   Y6 — the staleness warning fires only when the device is provably newer
//
// Run with: npm run test:synclink  (or npx vite-node scripts/check-sync-link.mjs)

import zlib from "node:zlib";
import { DEFAULT_CONFIG, mergeImportedConfig, prepareImport, validateImportEnvelope, SCHEMA_CURRENT, DEFAULT_TOP_ATTACKERS, DEFAULT_TOP_MAX_ATTACKERS } from "../src/App.jsx";
import names from "../src/locales/pokemon-names.json";
import {
  SYNC_HASH_PREFIX,
  SYNC_MAX_TOKEN,
  SYNC_MAX_JSON,
  encodeSyncToken,
  syncLinkFor,
  isSyncHash,
  extractSyncHash,
  parseSyncHash,
  diffSyncState,
  linkIsOlderThan,
} from "../src/sync-link.js";

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hashOf = (link) => link.slice(link.indexOf("#"));
const BASE = "https://example.test/app/";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Species as the app stores them: lowercase German names, by dex order.
const stored = Object.keys(names)
  .filter((k) => /^\d+$/.test(k))
  .sort((a, b) => a - b)
  .map((k) => names[k].de.toLowerCase());
const buddy = (id, name, species) => ({
  id,
  shareId: `share-${id}`,
  name,
  tagPrefix: `Trade-${name}`,
  targetSpecies: species.map((s) => ({ species: s, expand: false, gender: "any", dropForms: [], dropSlots: [] })),
  wantsTradeEvos: false,
  rawAppend: "",
  active: true,
});
const envelopeOf = (data, exportedAt = "2026-11-24T10:00:00.000Z") => ({ schema: SCHEMA_CURRENT, exportedAt, data });
const laptop = {
  hundos: stored.slice(0, 40),
  luckies: stored.slice(20, 120),
  topAttackers: DEFAULT_TOP_ATTACKERS,
  topMaxAttackers: DEFAULT_TOP_MAX_ATTACKERS,
  config: { ...mergeImportedConfig(DEFAULT_CONFIG), shareName: "ユウキ", buddies: [buddy("b1", "Jürgen", stored.slice(200, 230))] },
  homeLocation: [7.1, 50.73],
  bazaarTags: ["Tausch", "PvP"],
};

console.log("Y1 — the link carries the envelope unchanged");
{
  const env = envelopeOf(laptop);
  const made = await syncLinkFor(env, BASE);
  check("a link is produced under the app's own URL", made.ok && made.link.startsWith(`${BASE}${SYNC_HASH_PREFIX}`));
  check("the hash is recognised as a sync link", isSyncHash(hashOf(made.link)) && !isSyncHash("#wish/abc") && !isSyncHash(""));
  const parsed = await parseSyncHash(hashOf(made.link));
  check("it parses back", parsed.ok);
  check("the envelope is identical after the trip", same(parsed.envelope, env));
  const valid = validateImportEnvelope(parsed.envelope);
  check("it validates as a workshop export", valid.ok);
  check("prepareImport sees the same state as from the file", same(prepareImport(valid.envelope), prepareImport(env)));
  check("names outside Latin-1 survive (sender name, buddy name)", parsed.envelope.data.config.shareName === "ユウキ" && parsed.envelope.data.config.buddies[0].name === "Jürgen");
}

console.log("\nY2 — codecs and size");
{
  const env = envelopeOf(laptop);
  const packed = await encodeSyncToken(env);
  const plain = await encodeSyncToken(env, { compress: false });
  check("deflate is the default codec", packed[0] === "z" && plain[0] === "j");
  check("the plain codec reads back too", same((await parseSyncHash(SYNC_HASH_PREFIX + plain)).envelope, env));
  check("deflate at least halves the link", packed.length * 2 < plain.length, `${packed.length} vs ${plain.length}`);
  const heavy = envelopeOf({
    ...laptop,
    hundos: stored.slice(0, 500),
    luckies: stored.slice(0, 900),
    config: { ...laptop.config, buddies: [1, 2, 3, 4, 5, 6].map((i) => buddy(`b${i}`, `Friend${i}`, stored.slice(i * 100, i * 100 + 120))) },
  });
  const heavyLink = await syncLinkFor(heavy, BASE);
  check("500 hundos, 900 luckies and six buddies still fit a link", heavyLink.ok, heavyLink.ok ? `${heavyLink.link.length} characters` : heavyLink.code);
  const oversized = await syncLinkFor(heavy, BASE, { compress: false });
  check("a setup too large for a link is refused at the sender", !oversized.ok && oversized.code === "too_long");
}

console.log("\nY3 — junk is refused with a code");
{
  const codeOf = async (hash) => {
    try {
      const r = await parseSyncHash(hash);
      return r.ok ? "ok" : r.code;
    } catch (err) {
      return `threw ${err.message}`;
    }
  };
  const good = hashOf((await syncLinkFor(envelopeOf(laptop), BASE)).link);
  check("not a sync hash", (await codeOf("#workshop")) === "not_sync" && (await codeOf(undefined)) === "not_sync");
  check("empty token", (await codeOf(SYNC_HASH_PREFIX)) === "garbled");
  check("characters outside base64url", (await codeOf(`${SYNC_HASH_PREFIX}z%20abc`)) === "garbled");
  check("unknown codec", (await codeOf(`${SYNC_HASH_PREFIX}q${good.slice(SYNC_HASH_PREFIX.length + 1)}`)) === "garbled");
  check("a link cut off on the way", (await codeOf(good.slice(0, Math.floor(good.length / 2)))) === "garbled");
  check("deflated bytes that are not JSON", (await codeOf(`${SYNC_HASH_PREFIX}z${b64url(zlib.deflateRawSync(Buffer.from("not json")))}`)) === "garbled");
  check("plain bytes that are not UTF-8", (await codeOf(`${SYNC_HASH_PREFIX}j${b64url(Buffer.from([0xff, 0xfe, 0xfd]))}`)) === "garbled");
  check("JSON that is not an object", (await codeOf(`${SYNC_HASH_PREFIX}j${b64url(Buffer.from("[1,2,3]"))}`)) === "garbled");
  check("a token over the length cap", (await codeOf(`${SYNC_HASH_PREFIX}z${"A".repeat(SYNC_MAX_TOKEN)}`)) === "too_long");
  const bomb = `${SYNC_HASH_PREFIX}z${b64url(zlib.deflateRawSync(Buffer.alloc(SYNC_MAX_JSON * 4, 0x20)))}`;
  check("a small token that inflates past the ceiling is cut off", bomb.length < SYNC_MAX_TOKEN && (await codeOf(bomb)) === "too_long", `${bomb.length} characters`);
  const foreign = await parseSyncHash(`${SYNC_HASH_PREFIX}j${b64url(Buffer.from(JSON.stringify({ schema: "something-else/v1", data: {} })))}`);
  check("another app's JSON parses but fails envelope validation", foreign.ok && !validateImportEnvelope(foreign.envelope).ok);
}

console.log("\nY4 — finding the link in pasted text");
{
  const link = (await syncLinkFor(envelopeOf(laptop), BASE)).link;
  const hash = hashOf(link);
  check("a whole link", extractSyncHash(link) === hash);
  check("the hash alone", extractSyncHash(hash) === hash);
  check("surrounding spaces and a trailing newline", extractSyncHash(`  ${link}\n`) === hash);
  check("a link a messenger wrapped over lines", extractSyncHash(`${link.slice(0, 80)}\n${link.slice(80, 300)}\r\n ${link.slice(300)}`) === hash);
  check("text with no link in it", extractSyncHash("hello there") === null && extractSyncHash("") === null && extractSyncHash(null) === null);
  check("a wish link is not a sync link", extractSyncHash(`${BASE}#wish/abc`) === null);
}

console.log("\nY5 — the review");
{
  // A device looks at its own link: both sides through prepareImport, as the dialog does.
  const here = prepareImport({ data: laptop });
  const own = diffSyncState(here, prepareImport(envelopeOf(laptop)));
  check("a device's own link changes nothing", own.identical, JSON.stringify({ ...own, hundos: own.hundos.added.length, luckies: own.luckies.added.length }));
  const fresh = prepareImport({ data: { hundos: [], luckies: [], topAttackers: DEFAULT_TOP_ATTACKERS, topMaxAttackers: DEFAULT_TOP_MAX_ATTACKERS, config: DEFAULT_CONFIG, homeLocation: null, bazaarTags: [] } });
  check("a fresh install against its own defaults is identical", diffSyncState(fresh, prepareImport(envelopeOf({ hundos: [], luckies: [], config: DEFAULT_CONFIG, homeLocation: null, bazaarTags: [] }))).identical);

  // The phone has drifted from the laptop in every way the review reports.
  const phone = {
    ...laptop,
    hundos: [...stored.slice(2, 40), stored[300]],
    luckies: stored.slice(20, 118),
    config: {
      ...laptop.config,
      expertMode: !laptop.config.expertMode,
      regionalCatalogSeen: ["something-only-this-device-has-seen"],
      buddies: [buddy("b1", "Jürgen", stored.slice(200, 229)), buddy("b9", "Phone-only", [stored[5]])],
    },
    homeLocation: [13.4, 52.5],
    bazaarTags: ["Tausch", "Raid"],
  };
  const withNew = { ...laptop, config: { ...laptop.config, buddies: [...laptop.config.buddies, buddy("b2", "Alexa", [stored[6]])] } };
  const d = diffSyncState(prepareImport({ data: phone }), prepareImport(envelopeOf(withNew)));
  check("not identical", !d.identical);
  check("hundos the link adds", same(d.hundos.added, stored.slice(0, 2)), d.hundos.added.join(","));
  check("hundos only on this device", same(d.hundos.removed, [stored[300]]), d.hundos.removed.join(","));
  check("luckies the link adds", same(d.luckies.added, stored.slice(118, 120)) && d.luckies.removed.length === 0);
  check("tags added and removed", same(d.tags.added, ["PvP"]) && same(d.tags.removed, ["Raid"]));
  check("a buddy the link adds, by name", same(d.buddies.added, ["Alexa"]));
  check("a buddy only on this device, by name", same(d.buddies.removed, ["Phone-only"]));
  check("a buddy whose list changes, by name", same(d.buddies.changed, ["Jürgen"]));
  check("the one setting that differs is counted, buddies and bookkeeping are not", same(d.settings, ["expertMode"]), d.settings.join(","));
  check("home location differs", d.home === true);
  check("unchanged attacker lists report nothing", d.attackers.added === 0 && d.attackers.removed === 0);

  const fewer = diffSyncState(here, prepareImport(envelopeOf({ ...laptop, topAttackers: DEFAULT_TOP_ATTACKERS.slice(1) })));
  check("an attacker the link lacks is counted as removed", fewer.attackers.removed === 1 && fewer.attackers.added === 0 && !fewer.identical);

  // A link that carries only part of the state leaves the rest alone.
  const partial = diffSyncState(prepareImport({ data: phone }), prepareImport(envelopeOf({ hundos: laptop.hundos })));
  check("keys the link does not carry are not reported", partial.luckies.removed.length === 0 && partial.tags.removed.length === 0 && partial.settings.length === 0 && !partial.home && partial.buddies.removed.length === 0);
  check("and the key it does carry still is", partial.hundos.added.length === 2 && partial.hundos.removed.length === 1);

  const reordered = Object.fromEntries(Object.entries(here.config).reverse());
  check("config key order is not a difference", diffSyncState({ ...here, config: reordered }, here).identical);
  check("tolerates an empty device", diffSyncState(undefined, prepareImport(envelopeOf(laptop))).hundos.added.length === 40);
}

console.log("\nY6 — is the link older than this device's last change?");
{
  const made = "2026-11-24T10:00:00.000Z";
  check("a later local change is newer than the link", linkIsOlderThan(made, "2026-11-24T10:00:01.000Z"));
  check("an earlier local change is not", !linkIsOlderThan(made, "2026-11-24T09:59:59.000Z"));
  check("the same moment is not (a device that just applied this link)", !linkIsOlderThan(made, made));
  check("time zones are compared as instants", !linkIsOlderThan(made, "2026-11-24T10:30:00+01:00"));
  check("no local stamp: no warning", !linkIsOlderThan(made, null) && !linkIsOlderThan(made, undefined));
  check("an undated or unreadable link: no warning", !linkIsOlderThan(undefined, made) && !linkIsOlderThan("yesterday", made));
}

console.log(`\n${failures === 0 ? "✓ All sync-link tests passed." : `✗ ${failures} test(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
