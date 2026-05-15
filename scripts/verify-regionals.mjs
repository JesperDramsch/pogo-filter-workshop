// scripts/verify-regionals.mjs — exhaustive verification of regional-Pokemon
// hit-testing against the canonical list. Run with: npx vite-node scripts/verify-regionals.mjs
//
// For each entry from the canonical regional-locations table, this checks
// whether computeHomeLocals() (the exact production code path) returns the
// expected German name at one or more representative cities INSIDE the
// region, and (where applicable) does NOT return it at cities OUTSIDE.
//
// Output is one line per Pokemon: PASS / FAIL / NOT-IN-DATA, with details
// on any mismatch so we can fix the underlying polygon or rotation entry.

import { computeHomeLocals, computeHomeLocalTypeChecks } from "../src/App.jsx";

// Representative cities — [lon, lat] matches the App's homeLocation shape.
const C = {
  // Europe
  Berlin:        [13.40,  52.52],
  Munich:        [11.58,  48.14],
  Madrid:        [-3.70,  40.42],
  London:        [-0.13,  51.51],
  Paris:         [ 2.35,  48.86],
  Athens:        [23.73,  37.98],
  Stockholm:     [18.07,  59.33],
  Lisbon:        [-9.14,  38.72],
  Rome:          [12.50,  41.90],
  // North America (excl. southern Florida)
  NewYork:       [-74.01, 40.71],
  LosAngeles:    [-118.24, 34.05],
  Toronto:       [-79.38, 43.65],
  Atlanta:       [-84.39, 33.75],
  Chicago:       [-87.63, 41.88],
  Anchorage:     [-149.90, 61.22],
  Vancouver:     [-123.12, 49.28],
  // Southern Florida + Mexico + Central America + Caribbean
  Miami:         [-80.19, 25.76],
  MexicoCity:    [-99.13, 19.43],
  Cancun:        [-86.85, 21.16],
  Havana:        [-82.38, 23.13],
  SanJose_CR:    [-84.08,  9.93],
  // South America
  SaoPaulo:      [-46.63, -23.55],
  BuenosAires:   [-58.38, -34.61],
  Lima:          [-77.04, -12.05],
  Bogota:        [-74.07,   4.71],
  // Africa
  Cairo:         [31.24, 30.04],
  Lagos:         [ 3.38,  6.52],
  Nairobi:       [36.82, -1.29],
  CapeTown:      [18.42, -33.92],
  Johannesburg:  [28.05, -26.20],
  // Asia
  Tokyo:         [139.69, 35.69],
  Beijing:       [116.41, 39.90],
  Seoul:         [126.98, 37.57],
  Mumbai:        [72.88, 19.08],
  Delhi:         [77.21, 28.61],
  Bangkok:       [100.50, 13.76],
  Singapore:     [103.85,  1.35],
  Manila:        [120.98, 14.60],
  Jakarta:       [106.85, -6.21],
  // Oceania
  Sydney:        [151.21, -33.87],
  Auckland:      [174.76, -36.85],
  Wellington:    [174.78, -41.29],
  Perth:         [115.86, -31.95],
  // Special
  Honolulu:      [-157.86, 21.31],
  Reykjavik:     [-21.94,  64.13],
  Nuuk:          [-51.74,  64.18],
  Moscow:        [37.62,  55.76],
  Yakutsk:       [129.74, 62.04],
  // Boundary-zone cities — within the precision band of the KMZ L-line vertices
  // (lat 33.32-33.49°N, lon 53.4-54.6°E). If we ever round the polygon back
  // down to simple integers, these should flip side.
  Tunis:         [10.18, 36.81],   // Mediterranean coast just N of line — must be East
  Algiers:       [ 3.06, 36.75],   // Mediterranean coast just N of line — must be East
  Tripoli:       [13.19, 32.89],   // Libyan coast just S of line — must be West (Africa)
  Casablanca:    [-7.59, 33.57],   // Just N of line at -7°W (KMZ 33.50) — must be East
  Marrakech:     [-7.99, 31.63],   // S of line — must be West (Africa)
};

// Canonical regional table from the user, normalized into:
//   german: the German species name we expect computeHomeLocals to return
//   in:     cities INSIDE the canonical region (must all match)
//   out:    cities OUTSIDE the region (must all NOT match)
//   note:   optional comment shown next to the result
//
// `status: "skip-not-in-code"` flags entries the user listed but which are
// not present in any POGO_REGION (no polygon → can't be detected at all).
const TESTS = [
  // #0083 Farfetch'd — Asia
  { id: "0083", german: "Porenta",     in: ["Tokyo", "Beijing", "Seoul"], out: ["Berlin", "NewYork", "Sydney"] },
  // #0115 Kangaskhan — Oceania
  { id: "0115", german: "Kangama",     in: ["Sydney", "Perth"], out: ["Berlin", "Tokyo", "NewYork"] },
  // #0122 Mr. Mime — Europe
  { id: "0122", german: "Pantimos",    in: ["Berlin", "Paris", "Madrid", "London"], out: ["NewYork", "Tokyo", "Cairo"] },
  // #0128 Tauros — USA+Canada (excl. southern Florida)
  { id: "0128", german: "Tauros",      in: ["NewYork", "LosAngeles", "Chicago", "Toronto"], out: ["Miami", "MexicoCity", "Berlin"] },
  // #0214 Heracross — Central + South America (incl. southern Florida)
  { id: "0214", german: "Skaraborn",   in: ["MexicoCity", "SaoPaulo", "Miami", "Cancun", "BuenosAires"], out: ["NewYork", "Berlin", "Tokyo"] },
  // #0222 Corsola — equatorial band (KMZ polygon covers latitude ~22-31)
  { id: "0222", german: "Corasonn",    in: ["Cancun", "Honolulu"], out: ["Berlin", "Sydney", "SaoPaulo"] },
  // #0313 Volbeat — Europe/Asia/Oceania
  { id: "0313", german: "Volbeat",     in: ["Berlin", "Tokyo", "Sydney"], out: ["NewYork", "SaoPaulo", "Cairo"] },
  // #0314 Illumise — NA/SA/Africa
  { id: "0314", german: "Illumise",    in: ["NewYork", "SaoPaulo", "Cairo"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0324 Torkoal — India / SE Asia
  // (Singapore at 1.35°N falls just south of the KMZ polygon's ~1.7°N southern edge — known KMZ limit.)
  { id: "0324", german: "Qurtel",      in: ["Mumbai", "Delhi", "Bangkok"], out: ["Berlin", "NewYork", "Sydney"] },
  // #0335 Zangoose — Europe/Asia/Oceania (rotating, East). Boundary-zone cities:
  // Tunis/Algiers (just N of L-line, Mediterranean), Casablanca (33.57°N) are East;
  // Tripoli (32.89°N, Libya) + Marrakech (31.63°N, S. Morocco) are West (Africa).
  { id: "0335", german: "Sengo",       in: ["Berlin", "Tokyo", "Sydney", "Mumbai", "Tunis", "Algiers", "Casablanca"], out: ["NewYork", "SaoPaulo", "Cairo", "Lagos", "Tripoli", "Marrakech"] },
  // #0336 Seviper — NA/SA/Africa (rotating, West). Inverse of Sengo on the boundary.
  { id: "0336", german: "Vipitis",     in: ["NewYork", "SaoPaulo", "Cairo", "Lagos", "Tripoli", "Marrakech"], out: ["Berlin", "Tokyo", "Sydney", "Tunis", "Algiers", "Casablanca"] },
  // #0337 Lunatone — Europe/Asia/Oceania (rotating, East)
  { id: "0337", german: "Lunastein",   in: ["Berlin", "Tokyo", "Sydney"], out: ["NewYork", "SaoPaulo", "Cairo"] },
  // #0338 Solrock — NA/SA/Africa (rotating, West)
  { id: "0338", german: "Sonnfel",     in: ["NewYork", "SaoPaulo", "Cairo"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0357 Tropius — Africa
  { id: "0357", german: "Tropius",     in: ["Lagos", "Nairobi", "Cairo", "CapeTown"], out: ["Berlin", "NewYork", "Tokyo"] },
  // #0369 Relicanth — NZ
  { id: "0369", german: "Relicanth",   in: ["Auckland", "Wellington"], out: ["Sydney", "Berlin", "NewYork"] },
  // #0417 Pachirisu — Northern Canada, Russia, Alaska
  { id: "0417", german: "Pachirisu",   in: ["Anchorage", "Yakutsk"], out: ["NewYork", "Berlin", "Tokyo"] },
  // #0439 Mime Jr. — Europe
  { id: "0439", german: "Pantimimi",   in: ["Berlin", "Paris", "Madrid", "London"], out: ["NewYork", "Tokyo", "Cairo"] },
  // #0441 Chatot — Southern Hemisphere
  { id: "0441", german: "Plaudagei",   in: ["Sydney", "SaoPaulo", "CapeTown", "BuenosAires"], out: ["Berlin", "NewYork", "Tokyo"] },
  // #0455 Carnivine — SE USA
  { id: "0455", german: "Venuflibis",  in: ["Atlanta", "Miami"], out: ["NewYork", "LosAngeles", "Berlin"] },
  // #0480 Uxie — Asia-Pacific
  { id: "0480", german: "Selfe",       in: ["Tokyo", "Beijing", "Sydney"], out: ["Berlin", "NewYork", "Cairo"] },
  // #0481 Mesprit — Europe & Africa
  { id: "0481", german: "Vesprit",     in: ["Berlin", "Paris", "Cairo", "Lagos"], out: ["NewYork", "Tokyo", "Sydney"] },
  // #0482 Azelf — Americas
  { id: "0482", german: "Tobutz",      in: ["NewYork", "LosAngeles", "SaoPaulo"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0511 Pansage — Asia-Pacific
  { id: "0511", german: "Vegimak",     in: ["Tokyo", "Beijing", "Sydney"], out: ["Berlin", "NewYork", "Cairo"] },
  // #0513 Pansear — Europe & Africa
  { id: "0513", german: "Grillmak",    in: ["Berlin", "Paris", "Cairo", "Lagos"], out: ["NewYork", "Tokyo", "Sydney"] },
  // #0515 Panpour — Americas
  { id: "0515", german: "Sodamak",     in: ["NewYork", "LosAngeles", "SaoPaulo"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0538 Throh — NA/SA/Africa
  { id: "0538", german: "Jiutesto",    in: ["NewYork", "SaoPaulo", "Cairo", "Lagos"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0539 Sawk — Europe/Asia/Australia
  { id: "0539", german: "Karadonis",   in: ["Berlin", "Tokyo", "Sydney"], out: ["NewYork", "SaoPaulo", "Cairo"] },
  // #0556 Maractus — Southern US, Mexico, C.America, Caribbean, S.America
  { id: "0556", german: "Maracamba",   in: ["MexicoCity", "SaoPaulo", "Cancun", "BuenosAires", "Miami"], out: ["NewYork", "Berlin", "Tokyo"] },
  // #0561 Sigilyph — Egypt, Greece
  { id: "0561", german: "Symvolara",   in: ["Cairo", "Athens"], out: ["Berlin", "NewYork", "Tokyo", "Lagos"] },
  // #0626 Bouffalant — NYC
  { id: "0626", german: "Bisofank",    in: ["NewYork"], out: ["LosAngeles", "Atlanta", "Berlin"] },
  // #0631 Heatmor — Eastern Hemisphere
  { id: "0631", german: "Furnifraß",   in: ["Berlin", "Tokyo", "Sydney"], out: ["NewYork", "SaoPaulo", "Cairo"] },
  // #0632 Durant — Western Hemisphere
  { id: "0632", german: "Fermicula",   in: ["NewYork", "SaoPaulo", "Cairo", "Lagos"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0701 Hawlucha — Mexico
  { id: "0701", german: "Resladero",   in: ["MexicoCity", "Cancun"], out: ["NewYork", "Berlin", "Tokyo"] },
  // #0707 Klefki — France
  { id: "0707", german: "Clavion",     in: ["Paris"], out: ["Berlin", "London", "NewYork"] },
  // #0764 Comfey — Hawaii
  { id: "0764", german: "Curelei",     in: ["Honolulu"], out: ["LosAngeles", "Berlin", "Tokyo"] },
  // #0797 Celesteela — Southern Hemisphere (Ultra Beast, fixed)
  { id: "0797", german: "Kaguron",     in: ["Sydney", "SaoPaulo", "CapeTown", "BuenosAires"], out: ["Berlin", "NewYork", "Tokyo"] },
  // #0798 Kartana — Northern Hemisphere (Ultra Beast, fixed)
  { id: "0798", german: "Katagami",    in: ["Berlin", "NewYork", "Tokyo"], out: ["Sydney", "SaoPaulo", "CapeTown"] },
  // #0805 Stakataka — Eastern Hemisphere (Ultra Beast, fixed)
  { id: "0805", german: "Muramura",    in: ["Berlin", "Tokyo", "Sydney"], out: ["NewYork", "SaoPaulo", "Cairo"] },
  // #0806 Blacephalon — Western Hemisphere (Ultra Beast, fixed)
  { id: "0806", german: "Kopplosio",   in: ["NewYork", "SaoPaulo", "Cairo"], out: ["Berlin", "Tokyo", "Sydney"] },
  // #0874 Stonjourner — UK
  { id: "0874", german: "Humanolith",  in: ["London"], out: ["Paris", "Berlin", "NewYork"] },
];

let passed = 0, failed = 0, skipped = 0;
const failures = [];

for (const t of TESTS) {
  if (t.status === "skip-not-in-code") {
    skipped++;
    console.log(`⊘  #${t.id} ${t.german.padEnd(12)}  SKIP — not in POGO_REGIONS (regional missing from codebase)`);
    continue;
  }
  const errors = [];
  for (const city of t.in) {
    const locals = computeHomeLocals(C[city]);
    if (!locals.includes(t.german)) {
      errors.push(`  MISSING: ${t.german} not in homeLocals(${city}=${C[city].join(",")})`);
      errors.push(`           got: [${locals.join(", ") || "∅"}]`);
    }
  }
  for (const city of (t.out || [])) {
    const locals = computeHomeLocals(C[city]);
    if (locals.includes(t.german)) {
      errors.push(`  LEAKED:  ${t.german} unexpectedly in homeLocals(${city}=${C[city].join(",")})`);
    }
  }
  if (errors.length === 0) {
    passed++;
    console.log(`✓  #${t.id} ${t.german.padEnd(12)}  PASS  (${t.in.length} in, ${(t.out || []).length} out)`);
  } else {
    failed++;
    failures.push({ id: t.id, german: t.german, errors });
    console.log(`✗  #${t.id} ${t.german.padEnd(12)}  FAIL`);
    for (const e of errors) console.log(e);
  }
}

// ─── Paldean Tauros region-aware typeCheck tests ──────────────────────────
// The Paldean group uses {species, type} typeChecks. Each of the 3 forms
// (Combat = Fighting, Blaze = Fighting+Fire, Aqua = Fighting+Water) is local
// in exactly one region. We expect computeHomeLocalTypeChecks to return the
// matching {species, type} when home is inside that region and nothing for
// that pair when home is outside.
const PALDEAN_TESTS = [
  // Combat — Iberian Peninsula
  { id: "0128", form: "Combat",  type: "fighting", in: ["Madrid", "Lisbon"], out: ["Paris", "Berlin", "NewYork", "Tokyo", "Sydney", "Casablanca"] },
  // Blaze — Eastern Hemisphere (excl. Iberian since Combat takes priority there)
  { id: "0128", form: "Blaze",   type: "fire",     in: ["Berlin", "Tokyo", "Sydney", "Athens"], out: ["NewYork", "SaoPaulo", "Cairo", "Lagos"] },
  // Aqua — Western Hemisphere
  { id: "0128", form: "Aqua",    type: "water",    in: ["NewYork", "SaoPaulo", "Cairo", "Lagos", "Marrakech"], out: ["Berlin", "Tokyo", "Sydney", "Madrid"] },
];

let paldeanPassed = 0, paldeanFailed = 0;
for (const t of PALDEAN_TESTS) {
  const errors = [];
  for (const city of t.in) {
    const tcs = computeHomeLocalTypeChecks(C[city]);
    const hit = tcs.some(tc => tc.species === "Tauros" && tc.type === t.type);
    if (!hit) errors.push(`  MISSING: Tauros+${t.type} not in typeChecks(${city})`);
  }
  for (const city of t.out) {
    const tcs = computeHomeLocalTypeChecks(C[city]);
    const leak = tcs.some(tc => tc.species === "Tauros" && tc.type === t.type);
    if (leak) errors.push(`  LEAKED:  Tauros+${t.type} unexpectedly in typeChecks(${city})`);
  }
  if (errors.length === 0) {
    paldeanPassed++;
    console.log(`✓  #${t.id} Paldean ${t.form.padEnd(7)} (fighting+${t.type.padEnd(5)})  PASS  (${t.in.length} in, ${t.out.length} out)`);
  } else {
    paldeanFailed++;
    console.log(`✗  #${t.id} Paldean ${t.form.padEnd(7)} (fighting+${t.type.padEnd(5)})  FAIL`);
    for (const e of errors) console.log(e);
  }
}

console.log();
console.log(`Summary: ${passed} pass, ${failed} fail, ${skipped} skip (not in code) | Paldean typeChecks: ${paldeanPassed} pass, ${paldeanFailed} fail`);
if (failed > 0 || paldeanFailed > 0) {
  if (failed > 0) {
    console.log(`\nCollector/typeCheck failures:`);
    for (const f of failures) console.log(`  #${f.id} ${f.german}: ${f.errors.length} issue(s)`);
  }
  process.exit(1);
}
