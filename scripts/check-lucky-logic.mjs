import { buildFilters, DEFAULT_CONFIG, prepareImport, validateImportEnvelope, SCHEMA_CURRENT } from "../src/App.jsx";

const t = (key, opts) => key;

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

console.log("Scenario 1: pikachu in hundos AND luckies");
{
  const r = buildFilters(["pikachu"], ["pikachu"], DEFAULT_CONFIG, [], "en", t);
  check("trash contains +pikachu", r.trash.includes("+pikachu"));
  check("trade does NOT contain +pikachu", !r.trade.includes("+pikachu"));
  check("luckySort rendered", typeof r.luckySort === "string" && r.luckySort.length > 0);
  check("luckySort contains +pikachu", r.luckySort.includes("+pikachu"));
  check("luckyHundoSet size === 1", r.luckyHundoSet.size === 1);
}

console.log("\nScenario 2: pikachu in hundos only");
{
  const r = buildFilters(["pikachu"], [], DEFAULT_CONFIG, [], "en", t);
  check("trash contains +pikachu", r.trash.includes("+pikachu"));
  check("trade contains +pikachu", r.trade.includes("+pikachu"));
  check("luckySort is empty", r.luckySort === "");
  check("luckyHundoSet size === 0", r.luckyHundoSet.size === 0);
}

console.log("\nScenario 3: hundos=[pikachu], luckies=[charizard]");
{
  const r = buildFilters(["pikachu"], ["charizard"], DEFAULT_CONFIG, [], "en", t);
  check("trash contains +pikachu", r.trash.includes("+pikachu"));
  check("trade contains +pikachu (only lucky-hundos excluded)", r.trade.includes("+pikachu"));
  check("luckySort is empty (no intersection)", r.luckySort === "");
  check("luckyHundoSet size === 0", r.luckyHundoSet.size === 0);
}

console.log("\nScenario 4: empty lists is no-op");
{
  const r = buildFilters([], [], DEFAULT_CONFIG, [], "en", t);
  check("luckySort empty", r.luckySort === "");
  check("luckyHundoSet empty", r.luckyHundoSet.size === 0);
}

console.log("\nScenario 5: export envelope with luckies round-trips through prepareImport");
{
  const envelope = {
    schema: SCHEMA_CURRENT,
    exportedAt: "2026-05-16T08:00:00.000Z",
    data: { hundos: ["pikachu"], luckies: ["pikachu", "charizard"] },
  };
  const v = validateImportEnvelope(envelope);
  check("validates", v.ok === true);
  const prepared = prepareImport(v.envelope);
  check("luckies key present", "luckies" in prepared);
  check("luckies length === 2", prepared.luckies.length === 2);
}

console.log("\nScenario 6: legacy export without luckies → prepared.luckies absent");
{
  const envelope = {
    schema: SCHEMA_CURRENT,
    exportedAt: "2025-01-01T00:00:00.000Z",
    data: { hundos: ["pikachu"] },
  };
  const v = validateImportEnvelope(envelope);
  check("validates", v.ok === true);
  const prepared = prepareImport(v.envelope);
  check("luckies key absent (caller's setter skipped)", !("luckies" in prepared));
}

console.log(`\n${failures === 0 ? "✓ All lucky-logic checks passed." : `✗ ${failures} failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
