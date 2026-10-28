// What a game-master form suffix means to this app: "ALOLA" is the Alola form,
// "PALDEA_BLAZE" Paldea's Blaze Breed, "PLANT" Wormadam's Plant Cloak.
//
// Two readers, one table. scripts/fetch-regional-forms.mjs builds
// src/data/regional-forms.json from it, and the app names an event raid boss's
// regional form with it (its {region, variant} is what formRegionLabel in
// src/refinements.jsx renders). It lives under src/ because the app cannot
// import a fetcher, and it imports nothing so plain node can run that fetcher.

// Stable form key + region from a game-master form suffix ("MEOWTH_ALOLA" has
// suffix "ALOLA"). Returns null for non-regional forms (costumes, weather,
// Unown letters, Deoxys, …) so they're filtered out — only true regional
// variants reach the picker. The base form's region is overwritten with its
// origin region (from dex) in buildCatalog.
export function regionForForm(form) {
  if (form === "NORMAL") return { key: "base", region: "base" };
  if (form === "ALOLA") return { key: "alola", region: "alola" };
  if (form === "GALARIAN") return { key: "galar", region: "galar" };
  if (form === "HISUIAN") return { key: "hisui", region: "hisui" };
  if (form === "PALDEA") return { key: "paldea", region: "paldea" };
  if (form.startsWith("PALDEA_")) {
    const variant = form.slice("PALDEA_".length).toLowerCase(); // combat / blaze / aqua
    return { key: `paldea:${variant}`, region: "paldea", variant };
  }
  return NON_REGIONAL_AXES[form] || null;
}

// Form axes that are NOT regional but ARE type-separable, so the same
// {include, exclude} predicate machinery isolates them in PoGo search. They
// carry `axis` instead of a meaningful region, which refinements.jsx's formRegionLabel
// uses to render the variant alone ("Pflanzenumhang") rather than inventing a
// region for it.
//
// Wormadam's cloaks really do differ: Plant Bug/Grass, Sandy Bug/Ground, Trash
// Bug/Steel. Oricorio's four styles differ too (Fire / Electric / Psychic /
// Ghost, all Flying) — the app previously blanket-protected Oricorio on the
// stated grounds that "styles aren't separately searchable", which is wrong.
//
// Burmy's own cloaks are listed here on purpose even though all three are pure
// Bug: predicateFor then reports them indistinct and buildCatalog drops the
// species with a loud warning, which is the correct outcome and self-healing
// if Niantic ever splits the types.
//
// Basculin's three stripes are here for the same reason and with the same
// outcome today — red, blue and white all publish POKEMON_TYPE_WATER and
// nothing else. Listing them is what makes that a checked fact rather than a
// comment: the day any stripe gains a second type — White-Striped is the one
// Basculegion evolves from, and Basculegion is not in PoGo at all yet — this
// file starts emitting a real predicate instead of a warning, and the stripes
// become searchable on their own. Whoever sees that happen must also drop dex
// 550 from INVISIBLE_FORM_SLOTS (src/refinements.jsx) and add the form_variant
// labels the picker will need — scripts/check-lucky-logic.mjs fails until they
// do, because one chip may only ever render one badge group.
const NON_REGIONAL_AXES = {
  PLANT: { key: "cloak:plant", axis: "cloak", variant: "plant" },
  SANDY: { key: "cloak:sandy", axis: "cloak", variant: "sandy" },
  TRASH: { key: "cloak:trash", axis: "cloak", variant: "trash" },
  BAILE: { key: "style:baile", axis: "style", variant: "baile" },
  POMPOM: { key: "style:pompom", axis: "style", variant: "pompom" },
  PAU: { key: "style:pau", axis: "style", variant: "pau" },
  SENSU: { key: "style:sensu", axis: "style", variant: "sensu" },
  RED_STRIPED: { key: "stripe:red", axis: "stripe", variant: "redstriped" },
  BLUE_STRIPED: { key: "stripe:blue", axis: "stripe", variant: "bluestriped" },
  WHITE_STRIPED: { key: "stripe:white", axis: "stripe", variant: "whitestriped" },
};
