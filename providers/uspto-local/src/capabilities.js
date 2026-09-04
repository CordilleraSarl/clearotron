// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// capabilities.js — what the LOCAL US register can and cannot do, declared.
//
// The contract every register provider satisfies. Its whole purpose is that a capability this
// source genuinely LACKS is declared `null` here, so the planner marks the slice `unsupported` and
// the gap is disclosed as a deferred coverage row — rather than silently degrading into a weaker
// search wearing the right answer's clothes.
//
// Dependency-free by contract: no node imports, no HTTP, no reading the index. It is read at plan
// time, when there may be no database at all.
//
// WHAT MAKES THIS ONE UNUSUAL. Every other provider is a remote API whose limits belong to somebody
// else's wire. Here the limits are ours, and they were measured rather than assumed — the numbers
// below cite the fixture they came from. That cuts both ways: nothing external will change them,
// and nothing external will tell us when they are wrong.

/** The offices this source holds. One, and it is not a guess. */
const USPTO_LOCAL_OFFICES = Object.freeze(["US"]);

export const CAPABILITIES = Object.freeze({
  id: "uspto-local",
  label: "USPTO (local index)",

  // limit/offset over a local table. Not a cursor and not single-shot.
  pagination: "page",

  // A true count-only call: `SELECT count(*)` fetches nothing and works at any magnitude. The shared
  // kernel's "cheap" means one billable metered search whose total rides the first page, which is
  // the remote-API shape and not this one.
  countProbe: "endpoint",

  // A count CAN be narrowed to live filings at the wire, because status is a classified column on
  // every row. The hit-count product ignores this divergence on purpose, so that one column does not
  // mean "live filings" on one deployment and "all filings" on another. Declaring it truthfully here
  // does not change that; it stops the contract lying about the source.
  countStatusFilter: "live",

  // WHAT THIS NUMBER IS ON THE OTHER PROVIDERS AND WHY IT IS DIFFERENT HERE. Elsewhere maxOrWidth is a
  // PROTOCOL limit: corsearch's 80 is a URI budget that 414s past it, clarivate's 500 a JSON nesting
  // cap, signa's 1 the absence of any OR surface. register-plan.mjs splits every OR-stack to it.
  //
  // There is a hard ceiling here too, and it is MEASURED — but it is a property of SQLite rather than
  // of the register, so no trademark data was needed to find it and none would change it: the four
  // LIKE-disjunction predicates (default, both wildcards, owner) throw
  //   "Expression tree is too large (maximum depth 1000)"
  // at width 1000 exactly. `exact` compiles to an IN-list instead and survives to 32000, failing at
  // 40000 on "too many SQL variables". So the honest bound is 999, set by the worst predicate.
  //
  // 25 IS NOT THAT BOUND. It is a conservative choice well beneath it, and the reasoning is a
  // direction rather than a benchmark:
  //   * below the ceiling, width here is a WALL-TIME question, not a correctness one. SQLite evaluates
  //     an unanchored LIKE per row, so the infix predicate costs roughly linearly in width; the three
  //     index-narrowed predicates do not. Nothing breaks when it is slow.
  //   * narrower chunks are STRICTLY SAFER for completeness. Each chunk is its own plan entry with its
  //     own qid, enumerated to completion and merged; the union is identical either way. But a wide
  //     chunk's combined hits are likelier to cross ceilingDefault and turn the whole entry into a
  //     crowd descriptor — an `incomplete` a lawyer must judge instead of a band they can read.
  //   * being too LOW costs local function calls. There is no round trip to pay for.
  // So the error direction is asymmetric, and this errs the safe way.
  //
  // The per-predicate latencies that used to justify a specific number here were extrapolated from a
  // synthetic fixture and are GONE rather than restated: they were measured before the class-spelling
  // and match_mode fixes, on queries that did not mean what they appeared to.
  //
  // THE INSTRUMENT NOW EXISTS AND THE MEASUREMENT DOES NOT. `providers/uspto-local/bench/bench.mjs`
  // (`npm run bench:uspto -- --db <index>`) prints the width curve, drives `doSearch` rather than
  // hand-written SQL, and carries every timing's hit count so a fast query over an empty result cannot
  // be quoted as a fast query. Run it against a REAL ingested register — a synthetic fixture cannot
  // settle this one, because the three index-narrowed predicates do not scale with row count the way
  // the scan does, which is precisely what the old extrapolation assumed.
  //
  // Until that run exists this number stays 25 on the reasoning above, and if the measurement moves it,
  // bias downward.
  maxOrWidth: 25,

  // Multi-class is one query — classes are a column on the row, so no fan-out.
  classFilter: "native",

  // Screening facts come off the search row itself: status, classes and owner are all stored, so
  // there is no second call and nothing to bill.
  screenSource: "search-row",

  // No hard result window. The index returns what matches; the kernel's own ceiling governs how much
  // of it becomes a crowd descriptor. An explicit null, not an omission.
  resultCeiling: null,

  // Every predicate the executor can actually run. A key here is a promise; see the agreement test
  // that executes each one rather than pinning the list as data — the earlier version of that test
  // let `owner` sit in the list with no implementation behind it.
  predicates: Object.freeze({
    exact: "text =",
    // The unanchored default IS the infix scan. It must never be substituted with a bare FTS MATCH,
    // which is TOKEN contains and misses a term buried inside a longer word.
    default: "text LIKE %term%",
    wildcardPrefix: "fts prefix + text LIKE term%",
    // Served by a second FTS index over a reversed mark-text column, then verified with an exact
    // LIKE. The verification is the predicate: FTS matches tokens, so the reversed-prefix candidate
    // set admits marks that merely START with the term.
    wildcardSuffix: "reversed-fts prefix + text LIKE %term",
    wildcardInfix: "text LIKE %term%",
    // No phonetic column exists. NOT mapped to anything fuzzier — the planner stamps the slice
    // unsupported and the gap is disclosed.
    phonetic: null,
    owner: "owner LIKE %term%",
  }),

  offices: Object.freeze({
    vocabulary: "iso-3166",
    // The plan normalises display names to codes before this runs, so `translate` only ever sees a
    // two-letter uppercase code. Anything that is not US is outside this source and becomes a
    // deferred jurisdiction — never a filter quietly dropped.
    translate: (code) => (String(code ?? "").toUpperCase() === "US" ? "US" : null),
    covered: USPTO_LOCAL_OFFICES,
    // WHICH BINDING LAYERS THIS OFFICE CODE ACTUALLY RETURNS.
    //
    // `national: "returns"` is established by construction — this provider IS the US register.
    // `regional: "excludes"` likewise: the US is bound by no regional register, so there is nothing
    // to reach and nothing to disclose. Stated rather than left absent, because absent means
    // unestablished and would disclose a missing layer that does not exist.
    //
    // `international: "unestablished"`, AND THAT IS A DELIBERATE REFUSAL TO CARRY A NUMBER I COULD NOT
    // RE-DERIVE. The feed is ingested with no filing-basis filter and a prior direct query reported
    // 454,523 serial-79 records of 14,248,452 (3.19%), which would make this "returns". That query
    // needs USPTO_LOCAL_DB and a built index; neither is reachable from a dev checkout, so it could not
    // be re-run here. A layer datum is a claim about what a client's clearance covered, and the
    // honest state for a claim nobody in this tree can check is `unestablished` — which discloses.
    //
    // TO SETTLE IT: run the serial-79 count against a built index and, if it holds, change this one
    // value to "returns" with the count and the date beside it. That is a one-line change and it
    // removes a disclosure line from every US matter, so it is worth doing — but on evidence.
    layers: Object.freeze({
      US: Object.freeze({ national: "returns", regional: "excludes", international: "unestablished" }),
    }),
  }),

  // Owner and mark text compose in a single WHERE, so the owner sweep never has to defer.
  ownerTermIntersection: true,

  // UNPROBED, and therefore null rather than false. The tri-state matters: `true` sends the
  // characters, `false` substitutes a romanisation, and `null` defers the slice and discloses it.
  // Guessing `false` here would silently romanise every non-Latin term against an index whose
  // tokenizer behaviour on those scripts nobody has tested. Settle it with a search against real
  // ingested data — a row count proves nothing, because the FTS narrower is exactly where a
  // tokenizer miss becomes a false negative the LIKE verification can never rescue.
  nativeScriptIndex: null,

  // No phoneme expansion surface. Like clarivate's, the tool is simply not mounted rather than
  // stubbed with something weaker.
  phonemeExpansion: false,

  // Opposition and TTAB proceedings are a separate USPTO bulk product, not in this index.
  oppositions: false,

  // TSDR publishes a public page per serial number, so every finding can cite an address.
  hasPublicRecordUrl: true,

  // The live seam settings, spread into makeEnumerate so there is no second source of truth.
  kernel: Object.freeze({
    countProbe: "endpoint",
    screenSource: "search-row",
    // Larger than the remote providers'. OFFSET re-evaluates from the start of the result set, so on
    // a local index paging is a re-scan rather than a round trip: measured 4x cheaper to take one
    // wide page than six narrow ones on a rare term. Above ceilingDefault on purpose, so any band
    // that can legally complete does so in one page.
    pageSize: 1000,
    pageGuard: 60,
    // The shared default, and a judgment contract rather than a cost budget — the crowd descriptor
    // a lawyer reads. "It is local so it is free" is not a reason to raise it.
    ceilingDefault: 600,
    namesChunkDefault: 25,
    providerWindow: null,
  }),
});

export default CAPABILITIES;
