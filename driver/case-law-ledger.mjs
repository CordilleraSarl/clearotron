// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// case-law-ledger.mjs — the RETRIEVAL RECORD for the case-law path.
//
// THE DEFECT. `case-law-findings.md` is the only artifact case law produces, and its entire contract is
// `nonEmpty(c, 80)` — a non-empty check on prose. There is no citations ledger, no structured mirror, no
// per-proceeding record anywhere. So the per-record trace that exists for the register path and
// for common law (,) cannot be extended to case law at all: there is nothing on the other side
// of the join. That was found while scoping the record trace, and it is why closed into this issue.
//
// WHAT THAT COSTS. Two of the owner's three sign-off conditions for sending a case-law report to a
// client cannot be checked against prose:
//
//   "no false all-clear — the audit workbook shows the sweep RAN, with its queries"
//        There is nowhere the queries are written down. A report claiming no adverse case law is
//        indistinguishable from one where the sweep never dispatched.
//   "a paid dive cannot run thin — its run records show dispute documents ACTUALLY READ in its named
//    territory"
//        There are no run records of what was read. A dive that fetched nothing and a dive that read
//        forty decisions produce the same artifact.
//
// A scenario written against the markdown would be asserting on WORDING, which is the failure
// exists for: a gate that arms on a stock phrase rather than on what the run did. So the order is
// ledger first, scenario second — the design agent's ruling, 2026-08-06.
//
// WHAT THIS MODULE IS NOT. It never judges whether a proceeding is on point, whether a dive found
// enough, or whether the absence of adverse case law is good news. Those are the reviewing lawyer's.
// It records what was searched and what was read, so a later reader can tell an honest negative from an
// unrun sweep — the same job record-carry does for the register path, and the same rule: annotate,
// never gate on judgment.
//
// PURE (no node imports), like placement-carry.mjs and record-carry.mjs — the pipeline owns all IO.

// — TRUNCATION MARKS THE CUT. `abbrev` appends `…`; a bare slice does not, and a cut that lands
// mid-word produces something READABLE and wrong. Importing a pure sibling keeps this module's
// "no node imports → tests offline" invariant, exactly as connotation-search.mjs already does.
import { abbrev } from "./repair-contract.mjs";

export const CASE_LAW_LEDGER_SCHEMA_VERSION = 1;

/**
 * How far a proceeding got. `read` is the only state that discharges a depth dive, and the distinction
 * is the entire point: a hit LIST is not a read, and the sign-off condition is about documents actually
 * opened. `unreachable` is an honest, recordable outcome (paywalled, dead link) and never a silent drop.
 */
export const CASE_LAW_READ_STATES = Object.freeze(["read", "listed-not-read", "unreachable"]);

// CLOSED, and exported for the same reason CONNOTATION_REASONS is: a probe or a scenario that
// filters on a retyped string literal goes stale in silence the moment a reason is split or renamed,
// and prints an empty result that reads as a pass. Bind to this list; never retype it.
export const CASE_LAW_LEDGER_REASONS = Object.freeze([
  "no_queries",              // the ledger records no dispatched query — the sweep cannot be shown to have run
  "query_no_jurisdiction",   // a query with no territory: it cannot answer "was THIS territory swept"
  "query_no_text",           // a query row with no query text is a count, not a receipt
  "citation_no_url",         // a proceeding cited with no resolved link — nothing a reader can re-open
  "citation_no_proceeding",  // a link with no proceeding identity is not a citation
  "citation_read_state",     // a read state outside CASE_LAW_READ_STATES
  "dive_unread",             // proceedings were found and NONE was opened — the "ran thin" condition
  "no_citations",            // queries ran and nothing was recorded at all (ADVISORY — an honest negative)
]);

// Advisory reasons never withhold. `no_citations` is the honest no-on-point-precedent result, which the
// report is explicitly allowed to state; failing a run for it would manufacture citations. Everything
// else is structural — it says the ledger cannot answer the question it exists to answer.
export const CASE_LAW_ADVISORY_REASONS = Object.freeze(new Set(["no_citations"]));

export const isCaseLawBlocking = (v) => !CASE_LAW_ADVISORY_REASONS.has(v?.reason);

const str = (s) => String(s ?? "").trim();
/** Territory compare that survives casing and stray punctuation without folding non-Latin to nothing. */
export const normTerritory = (s) => str(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Strict-parse the ledger. Returns `{ ledger, error }` — `error` is a STRING a failure token can carry,
 * never a throw: a malformed sibling must fail the stage with a name, not crash the run.
 *
 * Tolerant in exactly one direction: unknown keys on a row are kept and ignored. A closed key set would
 * make every future field a breaking change to archived runs, and the validator below judges the fields
 * it needs rather than the shape of the whole object.
 */
export function parseCaseLawLedger(raw) {
  if (raw == null) return { ledger: null, error: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return { ledger: null, error: `unparseable json (${abbrev(String(e.message), 60)})` }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ledger: null, error: "top level must be an object" };
  const queries = Array.isArray(parsed.queries) ? parsed.queries : null;
  const citations = Array.isArray(parsed.citations) ? parsed.citations : null;
  if (!queries) return { ledger: null, error: "no queries[] array" };
  if (!citations) return { ledger: null, error: "no citations[] array" };
  return {
    error: null,
    ledger: {
      schema_version: Number(parsed.schema_version) || CASE_LAW_LEDGER_SCHEMA_VERSION,
      queries: queries.filter((q) => q && typeof q === "object").map((q) => ({
        query: str(q.query),
        jurisdiction: str(q.jurisdiction),
        results: Number.isFinite(Number(q.results)) ? Number(q.results) : null,
      })),
      citations: citations.filter((c) => c && typeof c === "object").map((c) => ({
        proceeding: str(c.proceeding),
        forum: str(c.forum),
        jurisdiction: str(c.jurisdiction),
        decided: str(c.decided),
        url: str(c.url),
        read: str(c.read) || "listed-not-read",
        ord: Number.isFinite(Number(c.ord)) ? Number(c.ord) : null,
        bearing: str(c.bearing),
      })),
    },
  };
}

/**
 * The census a reader (and a scenario) asks the ledger for. PURE, and it never judges.
 *
 * `readByTerritory` is the one that answers the depth-dive condition: a dive names ONE territory
 * (/), so "did this dive read anything in its own territory" is a lookup, not an inference.
 */
export function caseLawRetrievalCensus(ledger) {
  const queries = ledger?.queries ?? [];
  const citations = ledger?.citations ?? [];
  const readByTerritory = new Map();
  const citedByTerritory = new Map();
  for (const c of citations) {
    const t = normTerritory(c.jurisdiction);
    if (!t) continue;
    citedByTerritory.set(t, (citedByTerritory.get(t) ?? 0) + 1);
    if (c.read === "read") readByTerritory.set(t, (readByTerritory.get(t) ?? 0) + 1);
  }
  return {
    queries: queries.length,
    territoriesSwept: [...new Set(queries.map((q) => normTerritory(q.jurisdiction)).filter(Boolean))].sort(),
    citations: citations.length,
    read: citations.filter((c) => c.read === "read").length,
    listedNotRead: citations.filter((c) => c.read === "listed-not-read").length,
    unreachable: citations.filter((c) => c.read === "unreachable").length,
    readByTerritory: Object.fromEntries([...readByTerritory].sort()),
    citedByTerritory: Object.fromEntries([...citedByTerritory].sort()),
  };
}

/**
 * What is wrong with this ledger, as a list. EVERY violation ships — no head(), no "…and N more" (the
 * rule: a value a reader must act on is complete, or it is visibly marked as cut).
 *
 * THE DIVE IS THE RUN. The issue body asks for "breadth plus at least one single-territory depth dive",
 * but that schema was ruled OUT on 2026-08-05 — "case-law work is single-territory only" —,
 * and were closed as ruled out rather than shipped. `scope-rules.mjs` enforces it: case law is
 * carried by the Full country search alone (products.mjs), and the only scope that names a Full country
 * search is exactly ONE country. So there is no breadth sweep and no per-dive territory list to join
 * against; the run itself is the dive and its one country is the run's scope.
 *
 * That makes the owner's third condition — "a paid dive cannot run thin; its run records show dispute
 * documents ACTUALLY READ" — a property of this ledger alone, needing no scope read: proceedings were
 * found and not one of them was opened. Zero proceedings is the honest negative and is advisory; a hit
 * list nobody opened is the failure, and it is the one that reads as a completed dive today.
 *
 * @param {object|null} ledger  parseCaseLawLedger().ledger
 */
export function findCaseLawLedgerViolations(ledger) {
  const out = [];
  if (!ledger) return out;
  const { queries, citations } = ledger;

  if (!queries.length) out.push({ reason: "no_queries" });
  for (const q of queries) {
    if (!q.query) out.push({ reason: "query_no_text", jurisdiction: q.jurisdiction });
    else if (!q.jurisdiction) out.push({ reason: "query_no_jurisdiction", query: q.query });
  }
  for (const c of citations) {
    if (!c.proceeding) out.push({ reason: "citation_no_proceeding", url: c.url });
    else if (!c.url) out.push({ reason: "citation_no_url", proceeding: c.proceeding });
    if (!CASE_LAW_READ_STATES.includes(c.read))
      out.push({ reason: "citation_read_state", proceeding: c.proceeding, read: c.read });
  }
  // The honest negative, recorded as advisory so it is VISIBLE and never withholds. A sweep that ran and
  // found nothing on point is a legitimate, reportable result; a sweep that never ran is `no_queries`.
  if (queries.length && !citations.length) out.push({ reason: "no_citations" });

  const census = caseLawRetrievalCensus(ledger);
  // Proceedings were found and not one was opened. A run that reaches here has a case-law findings file
  // written from hit-list metadata, which is indistinguishable in the report from one written from the
  // decisions themselves — that is exactly the state the sign-off condition refuses.
  if (census.citations > 0 && census.read === 0)
    out.push({ reason: "dive_unread", cited: census.citations, read: 0 });
  return out;
}

/**
 * The failure token for the stage validator — the blocking violations, named, with the count per cause
 * ahead of the detail (the shape correctionHint branches on for every other family).
 * Returns "" when nothing blocking fired.
 */
export function caseLawLedgerFail(violations) {
  const blocking = (violations ?? []).filter(isCaseLawBlocking);
  if (!blocking.length) return "";
  const byReason = new Map();
  for (const v of blocking) byReason.set(v.reason, (byReason.get(v.reason) ?? 0) + 1);
  const census = [...byReason].map(([r, n]) => `${r}=${n}`).join(",");
  const first = blocking[0];
  const detail = first.jurisdiction ? `${first.reason}:${first.jurisdiction}`
    : first.proceeding ? `${first.reason}:${first.proceeding}`
    : first.query ? `${first.reason}:${first.query}`
    : first.reason;
  return `caselaw_ledger:${census};${detail}`;
}
