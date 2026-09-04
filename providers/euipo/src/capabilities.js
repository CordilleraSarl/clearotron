// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// capabilities.js — what the EUIPO register can and cannot do, declared.
//
// The contract every register provider satisfies. Its whole purpose is that a capability this source
// genuinely LACKS is declared `null` here, so the planner marks the slice `unsupported` and the gap is
// disclosed as a deferred coverage row — rather than silently degrading into a weaker search wearing
// the right answer's clothes.
//
// Dependency-free by contract: no node imports, no HTTP, no credentials. It is read at plan time.
//
// ── EVERY FIELD BELOW DESCRIBES OBSERVED BEHAVIOUR, NOT THE SPEC ─────────────────────────────────
// providers/README.md forbids inheriting an operator or composition claim by analogy, because a prior
// provider doc was written by mirroring another and inherited a claim that was true there and false
// here. So each value states what this API actually does, rather than what a neighbouring adapter's
// doc claims. These are behaviours of the live query engine, not of a stub.
//
// TWO CAVEATS ON THAT, both stated rather than smoothed over:
//   * sandbox and production are different deployments. Query SYNTAX is unlikely to diverge, but any
//     count-shaped value here describes the sandbox corpus, not production's.
//   * one probe round produced four confident, wrong answers because `size` was set below the API's
//     minimum of 10. Every request 400s on the size, and a 400 on a request whose QUERY you are
//     testing reads exactly like "the query is unsupported". It nearly cost this file a
//     `nativeScriptIndex: false` and a `wildcardSuffix: null`, both of which are the opposite of the
//     truth. If you re-probe, keep a known-good control query in the run and check it first.

const EUIPO_OFFICES = Object.freeze(["EU"]);

export const CAPABILITIES = Object.freeze({
  id: "euipo",
  label: "EUIPO",

  // `page` + `size`, with `totalElements` / `totalPages` in the envelope. PROBED: size below 10 or
  // above 100 is a 400; 10 and 100 are accepted.
  pagination: "page",

  // `totalElements` rides page 0, so the count is one ordinary search — cheap, not free. Same meaning
  // as corsearch's: a metered call whose total comes back with the first page. Not "endpoint", which
  // is a true count-only surface this API does not have.
  countProbe: "cheap",

  // A count CAN be narrowed by status at the wire (`status=in=(…)`). The hit-count product ignores that
  // divergence on purpose, so one column does not mean "live filings" on one deployment and "all
  // filings" on another.
  countStatusFilter: "live",

  // ── MEASURED, and the number is NOT the boundary ────────────────────────────────────────────────
  // The binding constraint is a URL budget, not a clause count — this is a GET with the whole RSQL
  // expression in the query string, exactly corsearch's shape. Clauses that fit, by mark length:
  //
  //     mark length   8 chars ->  90 clauses      mark length  25 chars ->  70 clauses
  //     mark length  15 chars ->  80 clauses      mark length  40 chars ->  60 clauses
  //
  // A clause carries the field name `wordMarkSpecification.verbalElement` — 34 characters before the
  // term — so a long mark eats the budget fast. 100 four-character terms were accepted; 110 were not.
  //
  // 50 is chosen BENEATH the worst measured case rather than at the best, because the plan speaks
  // clause counts and cannot know how long the terms will be. A slogan mark is not exotic. Overshoot
  // and the whole entry 400s; undershoot and the cost is more chunks, each its own qid, enumerated to
  // completion, with the union identical — and against a 25,000-request daily allowance those chunks
  // are affordable. The error direction is asymmetric, so this errs the safe way.
  maxOrWidth: 50,

  // `niceClasses=in=(9,42)` — one query, no fan-out. PROBED.
  classFilter: "native",

  // The search row carries status, niceClasses and applicants (normItem), so screening needs no
  // second call and nothing is billed for it.
  screenSource: "search-row",

  // No result window. PROBED to page 137,000 of a 1.37M-hit result set, still 200. An explicit null,
  // not an omission.
  resultCeiling: null,

  predicates: Object.freeze({
    exact: 'verbalElement=="term"',
    // The unanchored contains. RSQL has no separate operator for it — the wildcard lives inside the
    // quoted value.
    default: 'verbalElement=="*term*"',
    wildcardPrefix: 'verbalElement=="term*"',
    // PROBED, and worth stating because it is the predicate most sources cannot serve: EUIPO matches a
    // LEADING wildcard natively. No reversed index, no verification pass, no gap.
    wildcardSuffix: 'verbalElement=="*term"',
    wildcardInfix: 'verbalElement=="*term*"',
    // PROBED AS ABSENT, not assumed. `=phonetic=`, `=fuzzy=` and RSQL's own `~=` all return 400 with a
    // valid size. There is no sound-alike surface here, so the slice is stamped unsupported and
    // disclosed — never mapped to a contains, which would be a different search under the right name.
    phonetic: null,
    owner: 'applicants.name=="*term*"',
  }),

  offices: Object.freeze({
    vocabulary: "iso-3166-plus-eu",
    // EU trade marks and international registrations designating the EU. Anything else — a German-only
    // DPMA filing, a French INPI one — is a different register this source does not hold, and becomes
    // a deferred jurisdiction rather than a filter quietly dropped.
    translate: (code) => {
      const c = String(code ?? "").toUpperCase();
      return c === "EU" || c === "EM" ? "EU" : null;
    },
    covered: EUIPO_OFFICES,
    // WHICH BINDING LAYERS THIS OFFICE CODE ACTUALLY RETURNS. ESTABLISHED, not assumed: the
    // EUIPO register is definitionally the EU-wide register, and it holds international registrations
    // designating the EU — which is what the translate() comment above already says this source is.
    //
    // `national: "excludes"` is the load-bearing one. An EUIPO-only install can never reach the German
    // or French national register, and saying so here is what makes a France order disclose rather than
    // present as searched. It is an ESTABLISHED exclusion, not an unestablished gap.
    layers: Object.freeze({
      EU: Object.freeze({ national: "excludes", regional: "returns", international: "returns" }),
    }),
  }),

  // PROBED: `verbalElement=="*A*" and applicants.name=="*SA*"` returns 104,171 against 1,378,666 for
  // the mark clause alone — so the clauses genuinely AND-compose and the owner×term slice runs in one
  // call rather than deferring.
  ownerTermIntersection: true,

  // ── TRUE, AND PROBED RATHER THAN GUESSED ────────────────────────────────────────────────────────
  // The index holds the CHARACTERS. A Greek contains returned 9 marks and a Han contains returned 1,
  // against an ASCII control of 709 in the same run — so the query was accepted and matched, not
  // merely tolerated. This is the tri-state that decides whether a non-Latin term is sent as itself
  // (true), replaced by its romanisation (false), or deferred and disclosed (null). Getting it wrong
  // in the `false` direction would silently substitute a transliteration for the mark the client
  // actually needs cleared.
  //
  // The first probe round said the opposite, because `size` was below the API minimum and every
  // request 400d. See the header.
  nativeScriptIndex: true,

  // No phoneme-expansion surface, and no phonetic search to preview variants of.
  phonemeExpansion: false,

  // TRUE, and it is this provider's edge — but it was nearly declared on a spec-reading, and a probe
  // of ONE registered record made it look false: `oppositions[] / cancellations[] / appeals[] /
  // decisions[]` were all ABSENT. They are OMITTED WHEN EMPTY. Probing a record whose STATUS says it
  // is contested settled it: OPPOSITION_PENDING carries oppositions[1], APPEALED carries appeals[1]
  // and decisions[3], CANCELLATION_PENDING carries cancellations[1].
  //
  // TWO CONDITIONS RIDE ON THIS AND THE SECOND IS EASY TO LOSE:
  //   (1) corsearch and clarivate both declare it false, so their silence must never be rendered as
  //       "none found". Here an empty list IS a real answer.
  //   (2) …but only on the DETAIL RECORD. A search row carries no proceedings at any value, so an
  //       empty list there means nothing at all. providers/euipo/src/row.js keeps the two apart —
  //       `null` on a band row, `[]` on a fetched record — and collapsing them would turn "we did not
  //       ask" into "there are none" on precisely the axis this source is best at.
  oppositions: true,

  // The 16 status tokens the API will ACCEPT in a filter, which is NOT the spec's 18. `status==
  // "APPEALABLE"` and `status=="ACCEPTANCE_PENDING"` both return HTTP 400 at a valid `size` — probed
  // one token at a time — while the other sixteen answer. Sending either 400s the WHOLE query.
  //
  // Declared here because it is a QUERY capability, not a vocabulary detail: the classifier in row.js
  // still recognises all eighteen, since a status that cannot be filtered ON can still come back ON a
  // row. Keeping the two sets in one file would invite exactly the collapse that breaks one of them.
  queryableStatuses: Object.freeze([
    "ACCEPTED", "APPEALED", "APPLICATION_PUBLISHED", "CANCELLATION_PENDING", "CANCELLED", "EXPIRED",
    "OPPOSITION_PENDING", "RECEIVED", "REFUSED", "REGISTERED", "REGISTRATION_PENDING",
    "REMOVED_FROM_REGISTER", "START_OF_OPPOSITION_PERIOD", "SURRENDERED", "UNDER_EXAMINATION",
    "WITHDRAWN",
  ]),

  // EUIPO publishes a public page per application number (eSearch), so a finding can cite an address
  // the reader can open.
  hasPublicRecordUrl: true,

  // The live seam settings, spread into the shared kernels so there is no second source of truth.
  kernel: Object.freeze({
    countProbe: "cheap",
    screenSource: "search-row",
    // The API's own maximum. Fewer, larger pages is strictly better here: each page is one request
    // against the daily allowance.
    pageSize: 100,
    pageGuard: 60,
    ceilingDefault: 600,
    namesChunkDefault: 50,
    providerWindow: null,
  }),
});

export default CAPABILITIES;
