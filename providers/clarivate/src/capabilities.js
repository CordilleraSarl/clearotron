// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Clarivate Compumark Content — the PER-PROVIDER CAPABILITY CONTRACT ─────────────────────────────
//
// See providers/corsearch/src/capabilities.js for what this file is and why (doctrine rules 1 + 2).
//
// This contract is what the plan compiler reads, and the core implements exactly what is declared here:
//
//   * classFilter is "native", NOT "fanout". INT_CLASS_NUMBER value "9 OR 28 OR 41 OR 42" = 18, byte-for-
//     byte the deduplicated result of the old per-class fan-out. The fan-out is DELETED (phase 4): N
//     classes now cost ONE call.
//   * predicates.default is a TRUE contains, expressed as an INFIX TERM WILDCARD (`*TERM*`) on
//     WORD_MARK_SPECIFICATION — NOT the bare EQUALS the old MATCH_MODE_TO_FIELD.default emitted (which
//     lost recall), and NOT the CONTAINS operator (supported on the mark field, but see the owner note).
//   * predicates.owner is APPLICANT_NAME with EQUALS (wildcards allowed in the value; "NIKE*" ≡
//     BEGINS_WITH). The CONTAINS operator is a HARD 400 on this field —
//     "Operator CONTAINS is not supported for search field APPLICANT_NAME" — never emit it.
//
// PURE: no node imports, no vendor HTTP.

// The 186-code registrationOfficeCode enum (the vendor's RegistrationOfficeCode definition). regions[] is
// REQUIRED on this provider, so a jurisdiction outside this set is a genuine coverage gap, not a filter
// we may quietly drop. NOTE "EM" — the EU office code is EM, NOT EU (the #1 translation footgun here).
export const CLARIVATE_OFFICE_CODES = Object.freeze([
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AP", "AR", "AT", "AU", "AW", "AZ", "BA", "BB", "BD",
  "BG", "BH", "BI", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BX", "BY", "BZ", "CA", "CD", "CH",
  "CL", "CN", "CO", "CR", "CU", "CV", "CW", "CY", "CZ", "DE", "DK", "DM", "DO", "DZ", "EC", "EE", "EG",
  "EM", "ES", "ET", "FI", "FJ", "FR", "GB", "GD", "GE", "GG", "GH", "GI", "GM", "GR", "GT", "GY", "HK",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE",
  "KG", "KH", "KN", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LV", "LY",
  "MA", "MC", "MD", "ME", "MG", "MK", "MM", "MN", "MO", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NG", "NI", "NO", "NP", "NZ", "OA", "OM", "PA", "PE", "PG", "PH", "PK", "PL", "PT", "PY", "QA",
  "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SI", "SK", "SL", "SR", "ST", "SV", "SX",
  "SY", "SZ", "TC", "TH", "TJ", "TM", "TN", "TO", "TR", "TT", "TW", "TZ", "UA", "UG", "US", "UY", "UZ",
  "VC", "VE", "VG", "VN", "WO", "WS", "XA", "XG", "XK", "XS", "XW", "YE", "ZA", "ZM", "ZW", "ZZ",
]);

// ISO/matter code → Compumark office code. Only genuine DIVERGENCES are listed; everything else is an
// uppercase passthrough that then gets membership-checked against CLARIVATE_OFFICE_CODES.
//
// Review fix. Two classes of token were missing and BOTH were silently
// dropped by the compiler's partial-coverage path — a matter asking for the UK or the Netherlands was
// searched somewhere else and joined clean:
//   * NATIONAL CODES Compumark spells differently — the UK is GB, and there are NO national NL/BE/LU
//     registers (they are the Benelux office, BX). `driver/jurisdiction-systems.mjs` lists "UK", "NL"
//     and "BE" as first-class accepted matter codes, so these tokens demonstrably occur.
//   * PROSE. `driver/enqueue-schema.mjs` states the jurisdiction vocabulary is deliberately
//     PROSE-TOLERANT ("US", "United Kingdom") and that "none requires an ISO code". A translate()
//     that only understands 2-letter codes therefore defers ordinary matter input.
// The prose list below covers the territories the driver itself labels (jurisdiction-systems.mjs) plus
// the Madrid/regional unions. It is an ALIAS TABLE, not a guess: anything not listed still falls
// through to the uppercase passthrough → membership check → an honest deferral.
export const CLARIVATE_OFFICE_ALIASES = Object.freeze({
  EU: "EM",   // ← the EUIPO. This API expects "EM"; "EU" is not accepted.
  EUIPO: "EM",
  EUTM: "EM",
  "EUROPEAN UNION": "EM",
  "EUROPEAN UNION INTELLECTUAL PROPERTY OFFICE": "EM",
  BX: "BX",   // Benelux keeps its own code (not NL/BE/LU)
  BENELUX: "BX",
  NL: "BX", NETHERLANDS: "BX", "THE NETHERLANDS": "BX", HOLLAND: "BX",
  BE: "BX", BELGIUM: "BX",
  LU: "BX", LUXEMBOURG: "BX",
  UK: "GB", "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", GBR: "GB", ENGLAND: "GB", SCOTLAND: "GB", WALES: "GB",
  USA: "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "U.S.": "US", "U.S.A.": "US",
  SWITZERLAND: "CH", SUISSE: "CH", SCHWEIZ: "CH",
  GERMANY: "DE", DEUTSCHLAND: "DE",
  FRANCE: "FR", SPAIN: "ES", ITALY: "IT", AUSTRIA: "AT", PORTUGAL: "PT", IRELAND: "IE",
  SWEDEN: "SE", NORWAY: "NO", DENMARK: "DK", FINLAND: "FI", POLAND: "PL",
  "CZECH REPUBLIC": "CZ", CZECHIA: "CZ",
  CANADA: "CA", AUSTRALIA: "AU", "NEW ZEALAND": "NZ", INDIA: "IN", PHILIPPINES: "PH",
  CHINA: "CN", "PEOPLE'S REPUBLIC OF CHINA": "CN", JAPAN: "JP",
  "SOUTH KOREA": "KR", "REPUBLIC OF KOREA": "KR", KOREA: "KR",
  RUSSIA: "RU", "RUSSIAN FEDERATION": "RU", TURKEY: "TR", TURKIYE: "TR",
  BRAZIL: "BR", MEXICO: "MX", "SOUTH AFRICA": "ZA",
  OAPI: "OA",
  ARIPO: "AP",
  IR: "IR",   // Iran — NOT the Madrid International Register (that is WO)
  MADRID: "WO",
  "MADRID PROTOCOL": "WO",
  "INTERNATIONAL REGISTER": "WO",
  WIPO: "WO",
});

export const CAPABILITIES = Object.freeze({
  id: "clarivate",
  label: "Clarivate Compumark",

  // POST /search has NO pagination and needs none: it returns the COMPLETE guid set in one shot, or
  // fails loud with tooManyResults past 30000. There is no partial mode and no cursor.
  pagination: "single-shot",
  // …which is exactly why the enumerate ceiling must be tested BEFORE the search, via the cheap
  // POST /count — it works at ANY magnitude (209012 returned without complaint) and returns per-office
  // counts in one call.
  countProbe: "endpoint",
  // A count CAN be narrowed to live filings here — queryOptions.activeOnly (buildSearchRequest's
  // `active_only`). Declared because it diverges from corsearch, which has no status clause at all;
  // Stage 0.5 uses it on NEITHER, so the number means the same thing on every deployment. See the
  // matching note in providers/corsearch/src/capabilities.js and driver/register-count.mjs.
  countStatusFilter: "live",
  // JSON body, not a URI: the bound is the parser's document-nesting cap. 80/200/500 terms all HTTP 200;
  // 1000 → HTTP 500 "Document nesting depth (1001) exceeds the maximum allowed (1000)". Safe chunk = 500.
  maxOrWidth: 500,
  // ONE call: INT_CLASS_NUMBER value "9 OR 28 OR 41 OR 42" (or "9,28,41,42") = the deduplicated union.
  classFilter: "native",
  // POST /text, EXACTLY 100 ids per call (101+ → HTTP 400), and the call is BILLED — screening an
  // enumerated band also fully hydrates it. (test:true is obfuscated + unbilled + NOT persisted to the
  // record ledger: dev only, it can never back a real finding.)
  screenSource: "billed-record-fetch",
  // FAILS LOUD, never truncates: HTTP 400 "tooManyResults - The search returned N results. Maximum
  // number of results is 30000." That is a CROWD DESCRIPTOR (state:"incomplete"), never an error.
  resultCeiling: 30000,
  // ── — THE THIRD WAY THIS PROVIDER SAYS "THAT WOULD MATCH TOO MUCH" ──────────────────────────
  //
  // Two limits above are modelled and defended. This one arrives on a different channel and was not:
  //
  //   HTTP 500 "Count Failed - <JX> - Near/Adj queries with sub queries that can return a huge amount
  //             of results are not allowed"
  //
  // Semantically it is the SAME CONDITION as `resultCeiling` — this query would match too much — and the
  // engine already knows what to do with that: record a count+sample descriptor and hand it to judgment.
  // It arrives as a 500 on the COUNT PROBE instead of a 400 on the search, so it landed in the generic
  // provider-error arm and became a hard coverage hole: 7 of 161 slices on one delivered run, all
  // `incumbent-class`, every one of them an owner or owner×term slice against a very large portfolio.
  //
  // AND THE EXISTING WIDTH DEFENCE CANNOT HELP, which is why nobody noticed the gap. `maxOrWidth`
  // chunks against NESTING DEPTH. Splitting a wide OR-stack into narrower ones does nothing about
  // result cardinality — each single Near/Adj term against a portfolio that size still matches too
  // much. One limit, one defence, aimed at the other limit.
  //
  // Declared as the provider's verbatim signature so the recognition lives beside the other two limits
  // rather than in the kernel, and so a vendor rewording is a one-line change here.
  cardinalityRefusal: /Near\/Adj queries with sub queries that can return a huge amount of results are not allowed/i,
  // regions[] is MANDATORY on every request path here (buildSearchRequest throws without it) — unlike
  // corsearch, where an absent region clause is simply a worldwide sweep. Declared so the shared
  // execute-plan seam can backfill an entry that carries none from the FROZEN PLAN's own regions
  // (the matter's scope) instead of hard-erroring: several internally-minted lanes (recall probes,
  // common-law→register cross-checks, frame-diff remedies, model-proposed supplementals) mint
  // `regions: []` because that is harmless on corsearch. See providers/_shared/execute-plan.mjs.
  regionsRequired: true,

  predicates: Object.freeze({
    // searchFields[].name + operator. Boolean OR/AND/NOT, the ADJ adjacency operator and `*`/`?`
    // wildcards live INSIDE the value string. A bare space is an implicit AND, so a multi-word term is
    // compiled to an ADJ chain — `*CORAL ADJ PUP*` — which is an ordered phrase match.
    exact:          "EXACT_WORD_MARK_SPECIFICATION",           // case-insensitive but PUNCTUATION-SENSITIVE → strip punctuation client-side
    default:        "WORD_MARK_SPECIFICATION:*TERM*",          // a TRUE contains via the term wildcard, not the recall-losing bare EQUALS
    wildcardPrefix: "WORD_MARK_SPECIFICATION:TERM*",           // native `*` in the value (NIK* = 128)
    wildcardSuffix: "WORD_MARK_SPECIFICATION:*TERM",           // (*NIKE = 36)
    wildcardInfix:  "WORD_MARK_SPECIFICATION:*TERM*",          // (*NIK* = 806)
    phonetic:       "PHONETIC_WORD_MARK_SPECIFICATION",
    owner:          "APPLICANT_NAME",                          // EQUALS (+ wildcards); CONTAINS is a hard 400 — never emit it
  }),

  offices: Object.freeze({
    vocabulary: "compumark-registration-office-code",
    translate: (code) => {
      // whitespace-collapsed so prose input ("  United   Kingdom ") resolves like its canonical form
      const c = String(code ?? "").trim().replace(/\s+/g, " ").toUpperCase();
      if (!c) return null;
      return CLARIVATE_OFFICE_ALIASES[c] ?? c;
    },
    covered: CLARIVATE_OFFICE_CODES,
    // WHICH BINDING LAYERS AN OFFICE CODE ACTUALLY RETURNS — and for this provider the answer
    // is mostly NOT KNOWN, which is itself the finding.
    //
    // Compumark declares `US` and `WO` as SEPARATE registration-office codes, and nothing in this
    // repository establishes whether a search scoped to a national code returns the international
    // registrations designating that country. It is a question about a vendor's behaviour, and reading
    // more of our own source cannot answer it.
    //
    // So only the national layer is asserted, and only for codes that ARE national registers. The
    // regional and international layers are left absent — which `layerCoverageFor` reads as
    // `unestablished`, which discloses. Guessing "returns" here would silently re-create the exact
    // over-claim exists to remove, on the provider production actually runs.
    //
    // EM and WO are listed because Compumark carries them as their own codes: a matter that ORDERS the
    // EU, or a plan that searches WO directly, does reach those layers. What is unestablished is
    // whether a national code reaches them WITHOUT being ordered separately.
    layers: Object.freeze({
      // `"*"` — a registration-office code returns THAT office's register. 186 codes are covered here
      // and eight were written down, so every other one disclosed "the national register was not
      // searched" about a register the plan had just searched: a false caveat on CH, GB, JP, CN, AU
      // and 170-odd more. Enumerating them by hand would be the same claim typed 178 times, and it
      // would fall behind the next sync.
      //
      // It asserts only the narrow thing — a code returns its own register, which is what
      // `registrationOfficeCodes` MEANS. The cross-layer question stays open exactly where it was:
      // `US` keeps its own entry, so `US` + `international` is still `unestablished`, and a named
      // entry is never topped up from here.
      "*": Object.freeze({ national: "returns" }),
      US: Object.freeze({ national: "returns", regional: "excludes" }),
      EM: Object.freeze({ regional: "returns" }),
      WO: Object.freeze({ international: "returns" }),
      BX: Object.freeze({ national: "returns" }),
      FR: Object.freeze({ national: "returns" }),
      DE: Object.freeze({ national: "returns" }),
      ES: Object.freeze({ national: "returns" }),
      IT: Object.freeze({ national: "returns" }),
    }),
  }),

  // F1 (PR-1): a mark-text entry may carry an `owner` SCOPE FIELD — the owner×term intersection in
  // ONE call. Native here: buildSearchRequest AND-joins searchFields, so a WORD_MARK_SPECIFICATION
  // clause and an APPLICANT_NAME clause compose in a single request (EQUALS + wildcards on the
  // owner value, CONTAINS never emitted). The owner-resolution machinery
  // (expandOwnerTerms → assertSearchableTerm → degrade-to-unresolved) applies to the owner value on
  // this path exactly as on a bare owner sweep — resolution stays additive-only.
  ownerTermIntersection: true,
  // ── WHICH FORM OF A NON-LATIN MARK DOES THE INDEX HOLD? ──────────────────────────────────────────
  // `false` = the TRANSLITERATION ONLY. The characters are not indexed, so searching them returns 0
  // with no error — the exact false-clean shape a reader calls CLEAN:
  //   华威豹 → 0    HUA WEI BAO → 32 (and the 32 CONTAIN 华威豹)
  //   小米   → 0    XIAOMI      → 57632
  //   스타벅스 → 0
  // Universal, not a CJK-specific behaviour: non-Latin records across CN/TW/JP/KR/TH/GR/UA/EG/IL/SA
  // carried a populated markTransliteration.
  //
  // This declaration is what makes the refusal a CONTRACT rather than one vendor file's hand-written
  // check: the shared executor (providers/_shared/execute-plan.mjs, via script-form.mjs) reads it and
  // defers a native-script slice on ANY provider that does not declare a character index. core.js
  // keeps its own buildSearchRequest guard as the deepest backstop, for the paths that never go through
  // the plan executor at all (ad-hoc gather calls, a client-supplied mark in Cyrillic).
  //
  // The entry-level RESCUE is the other half and it comes first: substituteRomanizedNames swaps the
  // plan entry's `romanizedTerms` in (and relaxes the predicate to contains, because `exact` on a
  // transliteration is itself a silent zero — GR "POLITIKI PROSTASIA" exact 0 / contains 10). A slice
  // rescued that way is answerable and is never refused; only a native term with no romanisation defers.
  nativeScriptIndex: false,
  // No phoneme expansion knob: PHONETIC_WORD_MARK_SPECIFICATION is the whole surface; the client cannot
  // hand it a variant list. (/similarity/word/* — which would be the expansion surface — is genuinely
  // not available on this provider; the endpoint answers 403. Do NOT wire it.)
  phonemeExpansion: false,
  // The vendor's schema DEFINES Trademark.markRecords[].{oppositionPeriodEndDate,oppositionPeriodText}, but /text
  // does not populate them on EM records, while sparse fields seniorities and priorities DO appear,
  // proving the full schema is delivered. So
  // oppositions stay null and the doc must say "not available" — NEVER "none found".
  oppositions: false,
  // Compumark Content exposes no public per-record URL — cite the office register.
  hasPublicRecordUrl: false,

  // WIRED: providers/clarivate/src/core.js builds its enumerate from
  // makeEnumerate({ capabilities: {...CAPABILITIES.kernel} }) — these values are the LIVE seam settings,
  // no longer a design note. pageGuard is 1 because /search is single-shot: there is no page 2 to
  // fetch, so the guard can only ever be a backstop. namesChunkDefault = maxOrWidth (500): the kernel
  // chunks a wide OR-stack to the parser's probed nesting bound before it reaches the wire.
  kernel: Object.freeze({
    countProbe: "endpoint",
    screenSource: "billed-record-fetch",
    pageSize: 100,
    pageGuard: 1,                          // single-shot: there is no page 2
    ceilingDefault: 600,
    namesChunkDefault: 500,
    providerWindow: "30000-result hard ceiling (tooManyResults, fails loud)",
    // POST /search returns BARE GUIDS — the search row carries no mark text, classes, status or owner.
    // POST /text (the screen call) is therefore the SOLE content source for an enumerated band, which
    // breaks the kernel's default "screening is best-effort, the search rows still carry their fields"
    // assumption in two ways the kernel must handle explicitly (review findings 7/8/9/15):
    //   * the screen row's fields must be LIFTED onto the flat record, or every consumer written
    //     against the documented band contract reads null;
    //   * a screen FAILURE is total content loss, not a degraded extra — it can never ship as
    //     state:"enumerated".
    contentFromScreen: true,
  }),
});

export default CAPABILITIES;
