// Shared contract between generate-pvp-meta-reference.mjs and
// check-meta-reference.mjs.
//
// The generator cannot be imported by the checker — it writes its output files
// at module scope — so the one constant they must agree on lives here instead.
// When they each spelled `["de", "en"]` out separately, adding a third reference
// locale would publish an unverified filter string to the skill: the generator
// would emit it and the checker would keep iterating the old two, leaving the
// byte-equality guarantee that is the checker's whole purpose silently unenforced.

// The skill is German-first, so DE is what gets quoted. EN rides along because
// a mis-localized string is obvious the moment you can see both.
export const REFERENCE_LOCALES = ["de", "en"];
