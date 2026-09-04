// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Corsearch — the PER-PROVIDER CAPABILITY CONTRACT ───────────────────────────────────────────────
//
// One declarative object per provider, read at COMPILE time by driver/register-plan.mjs (via
// driver/register-capabilities.mjs) and at RUN time by the shared kernel's two seams
// (providers/_shared/enumerate.mjs `capabilities.{countProbe,screenSource,…}`).
//
// WHY IT EXISTS (doctrine rules 1 + 2): every provider must satisfy the SAME contract. A capability a
// provider genuinely LACKS is declared `null` here so the planner can mark the slice `unsupported` and
// the executor can emit an error:true / deferred block — it must NEVER silently degrade into a weaker
// search wearing the right answer's clothes. This file is therefore the ONE place a "we can't do that"
// is allowed to be recorded, and it is recorded as data, not as prose.
//
// PURE: no node imports, no vendor HTTP. Safe to import from the driver, the plugin core and tests.

// Corsearch's query language is a single flat string of backtick-quoted clauses; the match mode is a
// PREFIX on the clause (core.js MATCH_MODE_PREFIX). The mode strings below are exactly those keys, so
// execute-plan.mjs's planPredicateParams({match_mode}) consumes them unchanged.
export const CAPABILITIES = Object.freeze({
  id: "corsearch",
  label: "Corsearch",

  // The search returns rows + totalHitCount and a nextRequest cursor token → classic paging.
  pagination: "page",
  // The page-0 search IS the count probe (totalHitCount rides the first 100 rows) — a pre-loop count
  // call would DOUBLE the billable calls and change the crowd descriptor payload.
  countProbe: "cheap",
  // Can a COUNT be narrowed to live filings at the wire? No: assembleQuery has no status clause —
  // `corsearchStatusCode` arrives on the ROW, which is a screening fact, not a filter. So a count here
  // is filings of every status.
  //
  // Declared as data because it DIVERGES from clarivate (which has queryOptions.activeOnly), and
  // Stage 0.5 deliberately does not use it on either provider: one product, one meaning. A column
  // reading "live filings" on one deployment and "all filings" on another is wrong, not degraded —
  // and nobody comparing two reports would ever see the difference. If that decision is ever revisited
  // it changes on BOTH providers or on neither. See driver/register-count.mjs.
  countStatusFilter: "none",
  // HTTP-414 URI guard: the whole query is a GET query string, so ~80 backtick-quoted names (≈2–4KB
  // encoded) is the safe OR-stack. This MIRRORS the executor's ENUMERATE_NAMES_CHUNK_DEFAULT — the
  // planner must never dictate an OR-stack the executor would have to chunk-rescue (Wilderness 414).
  maxOrWidth: 80,
  // `nice-class` clauses ride the same query string (implicit OR within the field) — one call, no fan-out.
  classFilter: "native",
  // brand-json hydrates 100 candidate uris per POST — a separate CHEAP endpoint, not the billed record call.
  screenSource: "bulk-endpoint",
  // Paging silently stops being able to reach records past ~5000 (cap_warning in normalizeSearchResponse).
  // It does NOT fail loud, which is exactly why the kernel's pageGuard exists.
  resultCeiling: 5000,

  predicates: Object.freeze({
    exact:          "exact",        // `=`  anchored identical
    default:        "default",      // ``   the provider default (contains-style) — the crowd-gate parent
    wildcardPrefix: "starts_with",  // `^`  TERM*  → starts-with
    wildcardSuffix: "ends_with",    // `$`  *TERM  → ends-with
    wildcardInfix:  "default",      // *TERM* / an unanchored pattern → the provider default over the raw pattern
    phonetic:       "phonetic",     // `*`  sound-alike, with optional client-supplied phonetic_variants
    owner:          "owner",        // a dedicated `owner:` clause — a real owner FIELD, not mark text
  }),

  offices: Object.freeze({
    vocabulary: "iso-3166",
    // ISO passthrough: Corsearch takes the matter's jurisdiction codes as-is (`region:` clauses).
    //
    // ONE ALIAS, and it is the inverse of clarivate's. `EM` is the WIPO ST.3 code for the EU register;
    // this provider's vocabulary is ISO, where the EU is `EU`. territory-codes.mjs states the rule the
    // alias follows — "provider translate owns provider-specific spelling, e.g. EU→EM on clarivate" —
    // and the binding-layer pass in register-plan.mjs names the EU register `EM` because that is the
    // canonical office code, so without this the region clause would carry a value Corsearch answers
    // with an HTTP 500 rather than a 400 (the copper-bastion shape: a malformed region reads as
    // transient and burns the park budget).
    translate: (code) => {
      const c = String(code ?? "").trim().toUpperCase();
      if (!c) return null;
      return c === "EM" ? "EU" : c;
    },
    // null = NO declared restriction (the provider is a global aggregator; there is no enumerable
    // covered set to check a jurisdiction against). Never read as "covers nothing".
    covered: null,
    // WHICH BINDING LAYERS AN OFFICE CODE RETURNS.
    //
    // THE QUESTION CHANGED, WHICH IS WHY THIS TABLE IS NO LONGER EMPTY. It used to ask whether a
    // NATIONAL code reaches the EU and Madrid layers on its own — unanswerable from this repository,
    // so every entry was absent and every territory disclosed every layer as unsearched. The plan now
    // adds `EM` and `WO` to the region list for each ordered territory (register-plan.mjs), so the
    // question each entry answers is the narrow one: does a search scoped to THIS register return THAT
    // register's rights? That is what a `region:` clause is, on any provider.
    //
    // Three entries, and each is a fact about which register was queried rather than a claim about the
    // vendor's cross-layer behaviour:
    //   · `"*"` — any ISO region code returns that country's national register. `covered: null` means
    //     the national offices cannot be enumerated here, so this is the only form the datum can take.
    //   · `EU` — the EU-wide register returns EU-wide rights.
    //   · `WO` — the international register returns international registrations.
    //
    // Nothing here asserts that a national code reaches the other two, and nothing needs it to: the
    // plan reaches them by querying them. If that ever regresses the disclosure comes straight back,
    // because the coverage form checks the offices the plan ACTUALLY carries, not this table alone.
    layers: Object.freeze({
      "*": Object.freeze({ national: "returns" }),
      EU: Object.freeze({ regional: "returns" }),
      WO: Object.freeze({ international: "returns" }),
    }),
  }),

  // F1 (PR-1): a mark-text entry may carry an `owner` SCOPE FIELD — the owner×term intersection in
  // ONE call. Native here: assembleQuery space-joins clauses (implicit AND), and `owner:` is a real
  // field, so {name, owner} compose ("the six mega-owners collapse below any ceiling once intersected
  // with the term"). Declared as data so the planner/mint/executor hang off the declaration, never the
  // vendor name.
  ownerTermIntersection: true,
  // ── WHICH FORM OF A NON-LATIN MARK DOES THE INDEX HOLD? ──────────────────────────────────────────
  // `true` = the CHARACTERS. A native-script term is a legitimate, productive query here and MUST be
  // sent — the shared executor's script-form refusal (providers/_shared/script-form.mjs) is switched
  // off by this declaration, and switching it on would convert evidenced coverage into deferrals.
  //
  // Carried in driver/jx.mjs as the provider comparison: 小米 = 553 exact /
  // 127414 contains, 华威豹 = 6, 스타벅스 = 15 — where the same three terms answer 0/0/0 on clarivate.
  // Corroborated by archived executed bands, which returned non-zero hit counts on native characters
  // across Han, Katakana, Cyrillic and Greek. Structurally corroborated too: `name` and
  // `nameTransliteration` are TWO SEPARATE fields on a row (core.js returns both), so `name:` holds the
  // mark AS FILED and the transliteration is an extra returned field, not the search key. assembleQuery
  // has no transliteration clause at all.
  //
  // This is the OPPOSITE declaration to clarivate's, and that is a genuine provider difference, not a
  // bug on one side — which is exactly why the plan carries BOTH forms (term + romanizedTerms) and each
  // provider expresses the one it can answer. The predicate stays `exact` here: widening it takes 小米
  // past this provider's own 5000-result ceiling and turns a usable slice into an unusable crowd.
  //
  // RESIDUAL, stated rather than hidden: the recorded evidence covers Han, Katakana, Cyrillic and
  // Greek. Arabic, Devanagari and Thai are not covered here. The declaration is `true` for
  // the whole provider because the probes read on the INDEX (two fields, one of them the mark as
  // filed), not on any one script — but a recall-back in those three scripts (fetch one record from an
  // office that files in them, read its name verbatim, search that string back) is the cheap check that
  // would close it.
  nativeScriptIndex: true,
  // `phonetic_variants` may be supplied alongside a phonetic clause — the provider expands phonemes.
  phonemeExpansion: true,
  // Opposition data is present on the detail record.
  oppositions: true,
  // tm.corsearch.com/mark/<jur>/<id> is a working public link (driver.config publicRecordOrigin).
  hasPublicRecordUrl: true,

  // The shared-kernel seam values (providers/_shared/enumerate.mjs `capabilities`). LIVE, not a note:
  // core.js spreads this very object into makeEnumerate, so there are no literals anywhere that could
  // drift from it, and an agreement test pins namesChunkDefault to the kernel's own constant.
  kernel: Object.freeze({
    countProbe: "cheap",
    screenSource: "bulk-endpoint",
    pageSize: 100,
    pageGuard: 60,
    ceilingDefault: 600,
    namesChunkDefault: 80,
    providerWindow: "5000-record cap",
  }),
});

export default CAPABILITIES;
