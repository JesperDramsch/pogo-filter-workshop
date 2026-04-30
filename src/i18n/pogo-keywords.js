import { LOCALES } from "./index.js";

// Returns lowercased PoGo search-keyword for a given message key. PoGo's search
// box is case-insensitive but the filter output looks cleaner consistently
// lowercased. Spaces in some locales are kept as-is (PoGo accepts them).
function k(messages, key, fallback = "") {
  const v = messages[`ingame.${key}`];
  return (v ?? fallback).toLowerCase().trim();
}

// Builds a structured PoGo-keyword bundle for the given output locale. The
// output locale is the language of the user's *PoGo client* — typically same
// as UI locale, but expert mode lets them differ (browser language ≠ phone
// language). Any locale missing from LOCALES falls back to en.
export function pogoKeywords(outputLocale) {
  const messages = LOCALES[outputLocale]?.messages || LOCALES.en.messages;

  return {
    iv: {
      atk: k(messages, "filter_key_attack"),
      def: k(messages, "filter_key_defense"),
      hp:  k(messages, "general_hp"),
    },
    flag: {
      favorite:     k(messages, "favorite_filter_group_key"),
      shiny:        k(messages, "filter_key_shiny"),
      lucky:        k(messages, "filter_key_lucky"),
      legendary:    k(messages, "filter_key_legendary"),
      mythical:     k(messages, "filter_key_mythical"),
      ultra_beast:  k(messages, "filter_key_ultra_beasts", k(messages, "filter_key_ultra_beast")),
      shadow:       k(messages, "filter_key_shadow"),
      purified:     k(messages, "filter_key_purified"),
      costume:      k(messages, "filter_key_costume"),
      background:   k(messages, "filter_key_any_background"),
      traded:       k(messages, "filter_key_traded"),
      hatched:      k(messages, "filter_key_hatched"),
      baby:         k(messages, "filter_key_baby"),
      new_evo:      k(messages, "filter_key_evolve_to_new"),
      evolvable:    k(messages, "pokemon_info_evolve_button"),
      evolve_quest: k(messages, "filter_key_evolve_with_quest"),
      special_move: k(messages, "filter_key_special_move"),
      mega:         k(messages, "filter_key_mega_level"),
      mega_evolve:  k(messages, "filter_key_evolve_mega"),
      dynamax_move: k(messages, "filter_key_bread_move_a"),
      // PoGo's `@3move` matches Pokémon that still need a 3rd-move TM (i.e.,
      // NOT yet double-moved). Currently a literal English keyword in PoGo
      // even on localized clients; fallback to "3move" in case a localized
      // key gets added to the in-game sheet later.
      three_move:   k(messages, "filter_key_3rd_move", "3move"),
      // Frustration is a move name, not a flag, but PoGo's `@move-name`
      // search treats it the same way for filter-builder purposes.
      frustration:  (messages["move.frustration"] || "Frustration").toLowerCase().trim(),
      xxl:          k(messages, "general_xxl"),
      xl:           k(messages, "general_xl"),
      xxs:          k(messages, "general_xxs"),
    },
    numeric: {
      cp:       k(messages, "general_cp"),
      distance: k(messages, "filter_key_distance"),
      age:      k(messages, "filter_key_age"),
      year:     k(messages, "filter_key_year"),
      buddy:    k(messages, "buddy_level_0"),
      // Buddy-walk distance per candy (1km/3km/5km/20km tiers). Used to find
      // common-rarity species — e.g. `candykm1` matches the cheap-purify pool.
      candy_km: k(messages, "filter_key_candy_km"),
    },
    type: {
      bug:      k(messages, "pokemon_type_bug"),
      dark:     k(messages, "pokemon_type_dark"),
      dragon:   k(messages, "pokemon_type_dragon"),
      electric: k(messages, "pokemon_type_electric"),
      fairy:    k(messages, "pokemon_type_fairy"),
      fighting: k(messages, "pokemon_type_fighting"),
      fire:     k(messages, "pokemon_type_fire"),
      flying:   k(messages, "pokemon_type_flying"),
      ghost:    k(messages, "pokemon_type_ghost"),
      grass:    k(messages, "pokemon_type_grass"),
      ground:   k(messages, "pokemon_type_ground"),
      ice:      k(messages, "pokemon_type_ice"),
      normal:   k(messages, "pokemon_type_normal"),
      poison:   k(messages, "pokemon_type_poison"),
      psychic:  k(messages, "pokemon_type_psychic"),
      rock:     k(messages, "pokemon_type_rock"),
      steel:    k(messages, "pokemon_type_steel"),
      water:    k(messages, "pokemon_type_water"),
    },
  };
}

// Reverse-lookup: returns the semantic type key (e.g. "psychic") for a
// localized type name (e.g. "psycho" or "psy" or "Psy"). Used by evalTerm
// when parsing user-pasted filters back into a verifiable AST.
export function typeKeyFromKeyword(value, outputLocale) {
  const kw = pogoKeywords(outputLocale);
  const lower = String(value).toLowerCase();
  for (const [semantic, localized] of Object.entries(kw.type)) {
    if (localized === lower) return semantic;
  }
  return null;
}

// Reverse-lookup: returns the semantic flag key (e.g. "favorite") for a
// localized flag value (e.g. "favorit"). Returns null if no match.
export function flagKeyFromKeyword(value, outputLocale) {
  const kw = pogoKeywords(outputLocale);
  const lower = String(value).toLowerCase();
  for (const [semantic, localized] of Object.entries(kw.flag)) {
    if (localized === lower) return semantic;
  }
  return null;
}
