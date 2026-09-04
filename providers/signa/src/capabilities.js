// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Signa (signa.so) — the PER-PROVIDER CAPABILITY CONTRACT ────────────────────────────────────────
//
// See providers/corsearch/src/capabilities.js for what this file is and why (doctrine rules 1 + 2).
//
// Signa WAS the thin provider. This file recorded that thinness as five nulls and a `false`.
//
// A STALE CONTRACT IS NOT A TIDINESS PROBLEM, AND IT IS NOT SYMMETRICAL. Declaring LESS than the
// vendor serves makes the planner defer work it could have done: wasteful, disclosed, safe. Declaring
// MORE sends the executor at a surface that is not there. So the two directions get different
// evidence standards, and the one this file now takes is: every capability declared below was
// CONFIRMED AGAINST THE LIVE API before it was declared, and every one of
// them travels the wired path — `planPredicateParams` → `toSignaParams` → `buildSearchRequest` → the
// wire. This adapter's own contract test asserts that path per capability, because "the vendor supports
// it" and "our executor sends it" are two different claims and was the second one being false.
//
// WHAT IS STILL NULL, AND WHY IT IS DELIBERATE:
//
//   * predicates.wildcardInfix — `contains` would appear to serve it and does not. The kernel hands
//     the infix case its RAW pattern with the asterisks still in it, so the sweep would search the
//     punctuation. Declaring it would be declaring a capability the executor cannot serve, which is
//     the one thing 's criteria forbid. Stays null; the slice defers, disclosed.
//   * resultCeiling — there is no single number to put here, and the reason is worth the paragraph.
//     A plain term exhausts 685 rows, a class-filtered one 539, an
//     unanchored `contains` 2047 — no ceiling. But add `filters.owner_name` and the SAME term stops
//     dead at 400: "This cursor points beyond the 400 result pagination window." The bound is in ROWS
//     rather than pages (at limit 25 it stopped after 375, before the page that would cross 400), and
//     it applies to the owner-scoped shape only.
//
//     So the ceiling is a property of the QUERY SHAPE, not of the provider, and this field can hold
//     only one number for both. `null` with the fact written down beats 400, which would turn every
//     tractable band over 400 into a crowd and throw away the 2047 this vendor will happily page; and
//     it beats a number that is right for one shape and wrong for the other. See
//     OWNER_SCOPED_WINDOW below, which is the machine-readable half.
//
//     What IS observed about the total is separate: it saturates at 10000 and flags itself
//     approximate there — a fact about the count, not about the window.
//
// PURE: no node imports, no vendor HTTP.
import { SIGNA_OFFICE_SNAPSHOT } from "./offices.generated.js";

// DERIVED FROM THE COMMITTED SNAPSHOT, NOT TYPED.
//
// This was ten entries typed by hand. The vendor serves ELEVEN — UKIPO was
// live the whole time, 3.6M marks on a daily cadence, and a hand-typed list refused to search it. They
// are expanding, so a hand-typed list is not wrong once, it is wrong again every quarter.
//
// `bin/signa-sync.mjs` fetches GET /v1/offices and writes offices.generated.js; this derives from that.
// The import keeps this file PURE — a generated ES module, no node imports and no vendor HTTP, so
// register-capabilities.mjs can go on importing all six contracts at module load. It follows
// providers/free-tier/src/capabilities.js, which is already derived rather than declared for the same
// reason: nobody hand-typed its values, so it cannot fall behind what it is derived from.
//
// ONLY `live` OFFICES ARE COVERED, and that is the safety direction rather than a tidiness one:
//
//   the snapshot is NARROWER than the vendor → we under-claim, disclose the date, and are safe;
//   the snapshot is WIDER than the vendor    → we plan a slice against an office nobody serves, the
//                                              answer comes back thin, AND IT READS AS CLEAN.
//
// So the gate is each office's own `status`, not its presence in the file.
//
// Keys are LOWERCASE Signa office keys, NOT ISO codes. The value is the vendor's `jurisdiction_code`,
// which is what a matter names — note it is `EU` for EUIPO while the office's own `code` is `EM`, and
// the matter-facing side has always been the former.
export const SIGNA_OFFICE_KEYS = Object.freeze(Object.fromEntries(
  SIGNA_OFFICE_SNAPSHOT.offices
    .filter((o) => o.status === "live")
    .map((o) => [o.key, o.jurisdiction]),
));

/** The snapshot's own date, so a disclosure can say how old our coverage claim is. */
export const SIGNA_OFFICES_FETCHED_AT = SIGNA_OFFICE_SNAPSHOT.fetched_at;

/**
 * The row bound past which an OWNER-SCOPED band cannot be paged — 400.
 *
 * The owner sweep is the query shape that hits it, and it is the one an owner-heavy matter leans on:
 * an owner with more than 400 filings in scope cannot be enumerated to exhaustion here at all. The
 * behaviour today is safe but ugly — the loop pages to 400, the next request is an HTTP 400, and the
 * band returns `incomplete` with a transport error for its reason. That is never a clean, which is
 * what matters most; it is also not the crowd descriptor judgment should be reading, because the
 * enumerate ceiling is global (600) and cannot be told that this one shape stops sooner.
 *
 * Exported rather than inlined so the follow-up that teaches the kernel about per-shape ceilings has
 * one number to key on, and so a reader who finds the 400 in a log can find its cause in one grep.
 */
export const OWNER_SCOPED_WINDOW = 400;

// ISO/matter code → Signa office key. Whatever the snapshot says is live, full stop: any other
// jurisdiction is a genuine coverage gap the plan must record as deferred, never a filter it may
// quietly drop.
export const SIGNA_OFFICE_BY_ISO = Object.freeze(
  Object.fromEntries(Object.entries(SIGNA_OFFICE_KEYS).map(([key, iso]) => [iso, key])),
);

export const CAPABILITIES = Object.freeze({
  id: "signa",
  label: "Signa",

  // POST /v1/trademarks returns `pagination.cursor` + has_more — cursor paging, no page numbers.
  pagination: "cursor",
  // ── "none" → "cheap": a total EXISTS, it just had to be asked for ────────────────────────────────
  // `options.include_total` returns `pagination.total_count` on the ordinary search response, so the
  // count rides page 0 exactly as it does on corsearch: one billable call, no second round trip. It is
  // opt-in, which is why two months of responses carried no total and this contract concluded there
  // was none — the flag is now set by buildSearchRequest on EVERY call, where no call site can forget
  // it, because under this seam a response without a total cannot support a completeness claim.
  //
  // Nine queries return exact totals throughout (685, 220, 363, 830, 2047, 21, 101, 18),
  // and an empty band answering `total_count: 0, approximate: false` — an exact zero, the only kind
  // this repository may render. `limit: 1` returns the same total as the paged query, which is what
  // makes the cheap probe cheap.
  //
  // The vendor also flags some totals `total_count_approximate` — always at exactly 10000, so it is a
  // saturation marker rather than an estimate. normalizeSearchResponse reports those as UNKNOWN, never
  // as 10000: under this seam the number travels into the column that mints `enumerated`, and a figure
  // that is not a count must not travel there.
  countProbe: "cheap",
  // The count is an ordinary search, so every filter the search takes narrows it — including status.
  // `filters.status_primary` (pending|active|inactive|unknown) narrows the count like any other filter.
  // NOTE the key. `filters.status` does not exist and the API rejects unknown filter keys outright
  // (`HTTP 400 Unrecognized key: status`) — which is what core.js was sending until this issue.
  countStatusFilter: "native",
  // The request carries ONE `query` string. There is no OR-stack surface at all — an N-name band is N
  // calls, so the planner must emit one term per entry.
  maxOrWidth: 1,
  // filters.nice_classes[] is a top-level OR filter — one call, no fan-out.
  classFilter: "native",
  // Search rows already carry status / nice_classes / owner_name → screening is inline, zero extra calls.
  screenSource: "search-row",
  // No documented or observed hard result ceiling, and no total to compare one against.
  resultCeiling: null,

  // ── the predicates, and WHICH REQUEST SHAPE each one rides ──────────────────────────────────────
  //
  // Two shapes answer "how does this term match", and the specification forbids sending both:
  // "Deterministic modes require a query and disallow strategies/ranking_profile." Confirmed live —
  // sending both is an HTTP 400, not a preference. So these values are not all drawn from one enum,
  // and that is the point:
  //
  //   strategies[]  exact | phonetic | fuzzy | prefix                        — ranked, several per call
  //   match         similar | exact | starts_with | ends_with | contains     — deterministic, one only
  //
  // Every value below was run against the live API with the resulting total recorded.
  predicates: Object.freeze({
    exact:          "exact",        // strategies[] — the deterministic shape, the ranked one for audit continuity
    // `contains` IS the unanchored mode this contract said did not exist. The old header
    // was right that `fuzzy` is not a mapping for it — fuzzy is edit distance over the whole term, a
    // contains slice is a substring sweep, and they return different sets. It never needed to be
    // fuzzy; it needed the deterministic shape, which nothing here had.
    //
    // ONE LIVE CONSTRAINT NOT IN THE PUBLISHED SPECIFICATION: deterministic modes take a
    // query of 1 character or more. `contains` in fact demands THREE — "match=contains requires q to
    // be at least 3 characters (after case/accent folding) to avoid an over-broad substring scan."
    // A one- or two-character element therefore cannot ride this predicate, and it fails loud (400)
    // rather than quietly returning a narrower set. Recorded because it is the second place in this
    // file where the document and the wire disagree, and the wire is the one that answers queries.
    default:        "contains",
    // `starts_with`, NOT the `prefix` strategy. Both exist and the executor uses this one:
    // planPredicateParams emits `match_mode: "starts_with"` for a trailing-`*` entry and never emits
    // `prefix`, so naming `prefix` here described a call this engine does not make.
    wildcardPrefix: "starts_with",
    wildcardSuffix: "ends_with",    // the suffix operator this contract declared absent
    wildcardInfix:  null,           // see the header: `contains` cannot serve the raw `*foo*` pattern
    phonetic:       "phonetic",     // strategies[]
    // `filters.owner_name`, which composes with a text query in the SAME request — the "owner sweep
    // must fail loudly and defer" doctrine was correct about the consequence and wrong about the fact.
    //
    // IT IS A TEXT MATCH, NOT AN IDENTIFIER, and the difference decides how a result may be read.
    // An owner term is case-insensitive: "NIKE, INC." → 1097, identical for "nike, inc."; the
    // shorter "NIKE" → 3642; the bare fragment "INC." → over ten thousand. So it widens on a shorter
    // string rather than failing to match, which is the SAFE direction for a clearance — an owner
    // sweep sees more than the named entity, never fewer. It must not be read as "this entity's
    // portfolio": that is `filters.owner_id`, which takes a resolved `own_…` id and 400s on an unknown
    // one rather than answering zero.
    //
    // A zero here is a real zero and not a filter failing silently. Verified by the case that looked
    // like one: `query: NIKE` × owner "Nike Innovate" × USPTO returns 0 while the bare owner returns
    // 1984 and the bare term 169 — because the exactly-NIKE USPTO marks are held by "NIKE, Inc.",
    // which does intersect (131). Both clauses are applied; the empty set is the answer.
    owner:          "owner_name",
  }),

  offices: Object.freeze({
    vocabulary: "signa-office-key",
    translate: (code) => {
      const raw = String(code ?? "").trim();
      if (!raw) return null;
      const lower = raw.toLowerCase();
      if (lower in SIGNA_OFFICE_KEYS) return lower;            // already a Signa key — passthrough
      return SIGNA_OFFICE_BY_ISO[raw.toUpperCase()] ?? null;   // ISO → key, or null (genuinely uncovered)
    },
    covered: Object.freeze(Object.keys(SIGNA_OFFICE_KEYS)),

    // ── WHICH BINDING LAYERS DOES A SEARCH SCOPED TO THIS OFFICE ACTUALLY RETURN? ──────────
    //
    // 's first task, answered for this provider by measurement rather than by reading. Same
    // query, same limit, three scopings of France:
    //
    //   filters.offices: ["FR"]                              19 rows — ALL FR/direct_national
    //   filters.jurisdictions: ["FR"], territory_match direct 21 rows — FR national + WO/madrid_ir
    //   filters.jurisdictions: ["FR"], territory_match protection
    //                                                       101 rows — FR national + EM/direct_regional + WO
    //
    // and the control that proves `protection` adds a REGIONAL layer rather than simply more rows:
    // Switzerland, which sits under no regional register, returns 47 either way.
    //
    // STAGE 2 MOVED THE TABLE, BECAUSE IT MOVED THE QUERY. `toSignaParams` now sends
    // `filters.jurisdictions` + `territory_match: "protection"` instead of `filters.offices`, so a
    // territory's whole stack of rights comes back in ONE call. The per-territory breakdown that
    // justifies every cell below — same term, `filing_route` asked directly rather than sampled:
    //
    //          national   regional   madrid          national   regional   madrid
    //   US      10000+       0        2263      FR      6898     10000+     2708
    //   GB      10000+       0         523      SE      1994     10000+     2622
    //   CH       2694        0        2254      EU         0     10000+     2196
    //   CA       9894        0         814      WO         0        0       9150
    //   AU      10000+       0        1734      SG      2899        0       1323
    //   NO       1354        0        1149
    //
    // A `regional` zero is not a gap: no regional register binds Switzerland or Canada, so there is no
    // regional layer for `bindingLayersFor` to ask about. Every territory reaches its Madrid layer, and
    // every EU member reaches the EU register — which is the whole of what Stage 2 asked for.
    //
    // WHAT THE OFFICE FILTER DID, kept because it is why the change was necessary and because the day
    // someone reverts the query shape this table becomes false rather than merely stale:
    //   filters.offices: ["inpi-fr"] → national 6898, regional 0, MADRID 0. France's national register
    //   alone, with the EU trade mark that blocks use in France sitting in a register nobody queried.
    //
    // (The office filter is not uniform either — `uspto` and `ipi` return madrid-derived rows because
    // those registers hold the national legs of IRs themselves, while `inpi-fr` and `ukipo` return
    // none. A single per-office table could not have told that truth, which is a second reason the
    // territory shape is the right one to scope by.)
    layers: Object.freeze(Object.fromEntries(
      Object.keys(SIGNA_OFFICE_KEYS).map((key) => [key.toUpperCase(), Object.freeze({
        national: "returns",
        regional: "returns",
        international: "returns",
      })]),
    )),
  }),

  // ── the vendor's own office identifiers, and which one is primary ────────────────────────────────
  //
  // The API returns an ISO-style `code` (EM, FR, US, WO) with our lowercase keys demoted to
  // `legacy_code`. asks for `code` to be primary, and it now is, in the one place it decides
  // anything: `SIGNA_OFFICE_CODES` is what a reader and a future translate() should reach for.
  //
  // THE MIGRATION IS NOT URGENT AND THE REASON IS MEASURED, not assumed. All eleven legacy keys were
  // sent to the live wire beside their ISO codes, and every pair returned an identical
  // total (cipo/CA 83, euipo/EM 80, inpi-fr/FR 19, ipau/AU 72, ipi/CH 46, ipos/SG 58, nipo/NO 42,
  // prv/SE 22, ukipo/GB 96, uspto/US 169, wipo/WO 68). Nothing on the wire moves if `translate` keeps
  // emitting keys, so it does — a vocabulary swap under the executor buys nothing and risks a live
  // office lookup.
  //
  // ONE FRAGILITY WORTH THE LINE, because it is the shape a silent break would take: the validation
  // error for an unknown office advertises ISO codes ONLY — "Valid codes: AU, CA, CH, EM, FR, GB, NO,
  // SE, SG, US, WO." The legacy keys work but are no longer documented, so the day they stop working
  // the failure is an HTTP 400 per office. Loud, not silent — which is why this is a note and not a
  // migration.
  officeCodes: Object.freeze(Object.fromEntries(
    SIGNA_OFFICE_SNAPSHOT.offices.filter((o) => o.status === "live").map((o) => [o.key, o.code]),
  )),

  // `phonetic` is native and takes no client-supplied variant list.
  phonemeExpansion: false,
  // The owner surface exists (predicates.owner above) and composes with a text query in ONE request,
  // so the intersection is the vendor's rather than something reassembled here from two sweeps.
  //
  // EVIDENCED ON THE DETERMINISTIC SHAPE, AND ONLY THERE, on purpose. `match: contains` for a term
  // returned 2047; the same term with `filters.owner_name` returned 689 — a proper subset, which is
  // what an intersection has to be. The ranked shape does NOT show that: the same term under
  // `strategies` returned 238 alone and 1054 with an owner filter applied, i.e. MORE with the extra
  // clause. Recall under `similar` is not fixed, so ranked totals are not comparable across two
  // different requests and cannot evidence a set relation in either direction.
  //
  // Recorded because the ranked pair is the measurement a reader would take first, and taken alone it
  // would look like the filter being ignored — a wrong conclusion, reached from real numbers.
  ownerTermIntersection: true,
  // ── WHICH FORM OF A NON-LATIN MARK DOES THE INDEX HOLD? — SETTLED, `true` ───────────────────────
  //
  // Closed by running the procedure this comment used to describe, which is the only
  // reason it is a value and not still a null: fetch a record whose script is non-Latin, read its
  // mark text verbatim, search those exact characters back.
  //
  //   record  Singapore, `mark_text_script: "Hans"`, `mark_text_language: "zh"`, 8 characters
  //   query   the record's own mark_text, `match: "exact"`
  //   result  total_count 1, and the recalled id is the SAME record
  //
  // The characters are the index key, so `true`. providers/_shared/script-form.mjs may now send a
  // native-script slice here instead of deferring it.
  //
  // ONE THING THIS DOES NOT SAY, and the distinction is why the probe was done this way round: it
  // does not say a ROMANISATION would also recall that record. Character recall is what an
  // undeclared index put at risk — a native-script slice answering 0 and reading as a clean — and
  // that risk is now gone. Whether the transliteration is ALSO indexed is a second question, and
  // guessing at it here would put the shrug back in a different field.
  //
  // The blind spot to note for the reader who comes to widen this: the search ROW carries no script
  // field at all (38 keys); `mark_text_script` is a FULL-RECORD field (60 keys). A sweep over
  // search rows therefore finds no scripts anywhere and reads as "the index holds none" — which is
  // how this probe failed on its first attempt, and it failed by returning an empty set, not an error.
  nativeScriptIndex: true,
  // Opposition data IS on the record, and in three places: `opposition_window` on every search row,
  // `proceedings_count` on the full record, and the filters `has_proceedings`,
  // `opposition_status` and `opposition_closes_before/after`. GET /v1/trademarks/{id}/proceedings
  // carries the per-proceeding detail and remains an unwired tool — declared true for what the
  // contract governs (whether opposition state is available at all), with the unwired depth stated on
  // the record's own `_provenance` rather than hidden behind a `false` that would read as "none".
  oppositions: true,
  // No per-record public URL — cite the office register.
  hasPublicRecordUrl: false,

  // EXERCISED as of — core.js constructs makeEnumerate and makeExecutePlan from these values.
  // They were a design note under test for two months; they are now the bounds a real page loop runs
  // against, and driver/test/register-capabilities.test.mjs asserts by value which cores reach the
  // kernel so this claim cannot quietly become false again.
  //
  // `countProbe` is the load-bearing one and moved it from "none" to "cheap": the total was
  // always there, behind an opt-in flag nobody had set. What that changes in the kernel is WHERE the
  // enumerate ceiling is tested — off page 0's total instead of by accumulating rows until the cutoff
  // — which also turns on the count-first per-term and per-class rescues, both of which were dead code
  // for this provider (`countFirst` is gated on `countProbe !== "none"`).
  //
  // `pageSize: 100` is not a preference: the API rejects anything larger — "limit must be at most
  // 100" — the ceiling is enforced server-side, not a client-side preference.
  //
  // The zero rule is unchanged and is what makes the move safe: total_hits is null unless the vendor
  // counted exactly, so the only 0 that can reach a report is one the register itself returned as an
  // exact 0. Never 0 from a failure, never a figure invented to fill the column.
  kernel: Object.freeze({
    countProbe: "cheap",
    screenSource: "search-row",
    pageSize: 100,
    pageGuard: 60,
    ceilingDefault: 600,
    namesChunkDefault: 1,
    providerWindow: "cursor window; exact total via options.include_total (approximate totals saturate at 10000 and are reported UNKNOWN, never as a count)",
  }),
});

export default CAPABILITIES;
