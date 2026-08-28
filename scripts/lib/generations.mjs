// National-dex generation boundaries and their regions.
//
// This is a CONSTANT in this repo, deliberately. It replaces pogoapi's
// pokemon_generations.json, which stopped moving in November 2025 and whose
// payload shape had changed enough times that the parser it fed handled seven
// of them. A generation boundary is not a live fact: it is fixed the day a
// generation ships and never moves again, so pinning it costs one edit per
// new generation and buys the removal of an upstream that publishes no
// freshness signal at all. See docs/upstream-sources.md.
//
// Adding a generation: append an entry. The `max` of the last entry is the
// highest national dex number that generation introduced.

export const GENERATIONS = [
  { gen: 1, region: "kanto",  min:    1, max:  151 },
  { gen: 2, region: "johto",  min:  152, max:  251 },
  { gen: 3, region: "hoenn",  min:  252, max:  386 },
  { gen: 4, region: "sinnoh", min:  387, max:  493 },
  { gen: 5, region: "unova",  min:  494, max:  649 },
  { gen: 6, region: "kalos",  min:  650, max:  721 },
  { gen: 7, region: "alola",  min:  722, max:  809 },
  { gen: 8, region: "galar",  min:  810, max:  905 },
  { gen: 9, region: "paldea", min:  906, max: 1025 },
];

// The generation a dex number belongs to, or null past the last boundary —
// a species newer than this table is better reported as unknown than
// silently filed under Paldea.
export function generationOf(dex) {
  for (const g of GENERATIONS) if (dex >= g.min && dex <= g.max) return g.gen;
  return null;
}

// The region a species originates in — used to label a base form ("Kanto
// Meowth") against its regional variants. Falls back to "base" so a species
// past the last boundary still renders.
export function originRegion(dex) {
  for (const g of GENERATIONS) if (dex >= g.min && dex <= g.max) return g.region;
  return "base";
}

// The lowest `count` dex ids of each generation, skipping `excludeDex`.
// Exported separately from the starter rule that consumes it so the shape
// stays testable without a fetch.
export function lowestDexPerGeneration(count, excludeDex = new Set()) {
  const out = new Map();
  for (const g of GENERATIONS) {
    const ids = [];
    for (let dex = g.min; dex <= g.max && ids.length < count; dex++) {
      if (!excludeDex.has(dex)) ids.push(dex);
    }
    out.set(g.gen, ids);
  }
  return out;
}
