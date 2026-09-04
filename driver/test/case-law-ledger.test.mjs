// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// case-law-ledger.test.mjs —, the retrieval record case law never had.
//
// ON FIXTURES, STATED PLAINLY. Every other ledger in this suite is tested against a preserved artifact,
// because an invented fixture certifies the bug it was invented from. There is no preserved case-law
// ledger and there cannot be one: this artifact has never been produced by any run, which is the whole
// defect — `case-law-findings.md` was the only thing the stage emitted and its contract was
// `nonEmpty(c, 80)`. So the shapes below are authored, and they are authored to the DISPATCH in
// stages.mjs rather than to what would make the code pass. The first real run is what validates the
// shape; until then this file proves the gate's LOGIC, not that the model can hit it. Said here so the
// next reader does not mistake a green suite for a working case-law path.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCaseLawLedger, findCaseLawLedgerViolations, caseLawRetrievalCensus, caseLawLedgerFail,
  isCaseLawBlocking, CASE_LAW_LEDGER_REASONS, CASE_LAW_ADVISORY_REASONS, CASE_LAW_READ_STATES,
} from "../case-law-ledger.mjs";

const q = (query, jurisdiction, results = 3) => ({ query, jurisdiction, results });
const c = (proceeding, read = "read", jurisdiction = "US") =>
  ({ proceeding, forum: "TTAB", jurisdiction, decided: "2021-04-02", url: `https://ttabvue.uspto.gov/${proceeding}`, read, ord: 1, bearing: "enforcer posture" });

const GOOD = JSON.stringify({
  schema_version: 1,
  queries: [q("VELTRA opposition", "US"), q("VELTRA cancellation", "US", 0)],
  citations: [c("91250001"), c("91250002", "listed-not-read")],
});

test("#263 a well-formed ledger parses and yields no blocking violation", () => {
  const { ledger, error } = parseCaseLawLedger(GOOD);
  assert.equal(error, null);
  assert.equal(caseLawLedgerFail(findCaseLawLedgerViolations(ledger)), "");
});

test("#263 the census counts what was swept and what was OPENED — a hit list is not a read", () => {
  const { ledger } = parseCaseLawLedger(GOOD);
  const cen = caseLawRetrievalCensus(ledger);
  assert.equal(cen.queries, 2);
  assert.equal(cen.citations, 2);
  assert.equal(cen.read, 1);
  assert.equal(cen.listedNotRead, 1);
  assert.deepEqual(cen.territoriesSwept, ["US"]);
  assert.deepEqual(cen.readByTerritory, { US: 1 });
  // A query that returned nothing still counts as swept — that is the point of recording it.
  assert.equal(ledger.queries.filter((x) => x.results === 0).length, 1);
});

// ── the two sign-off conditions this artifact exists to make checkable ────────────────────────────

test("#263 NO FALSE ALL-CLEAR: a ledger with no queries cannot show the sweep ran, and blocks", () => {
  const { ledger } = parseCaseLawLedger(JSON.stringify({ queries: [], citations: [] }));
  const v = findCaseLawLedgerViolations(ledger);
  assert.ok(v.some((x) => x.reason === "no_queries"));
  assert.match(caseLawLedgerFail(v), /^caselaw_ledger:no_queries=1/);
});

test("#263 the HONEST NEGATIVE is advisory — queries ran, nothing on point, and the run continues", () => {
  const { ledger } = parseCaseLawLedger(JSON.stringify({ queries: [q("VELTRA opposition", "US", 0)], citations: [] }));
  const v = findCaseLawLedgerViolations(ledger);
  assert.deepEqual(v.map((x) => x.reason), ["no_citations"]);
  assert.equal(caseLawLedgerFail(v), "", "a sweep that ran and found nothing must never withhold — that manufactures citations");
});

test("#263 RAN THIN: proceedings found and not one opened blocks, and is distinct from finding nothing", () => {
  const thin = JSON.stringify({
    queries: [q("VELTRA opposition", "US")],
    citations: [c("91250001", "listed-not-read"), c("91250002", "listed-not-read")],
  });
  const { ledger } = parseCaseLawLedger(thin);
  const v = findCaseLawLedgerViolations(ledger);
  const hit = v.find((x) => x.reason === "dive_unread");
  assert.ok(hit, "a hit list nobody opened reads as a completed dive today — this is the condition that refuses it");
  assert.equal(hit.cited, 2);
  assert.equal(hit.read, 0);
  assert.match(caseLawLedgerFail(v), /dive_unread/);
  // `unreachable` is an honest outcome but it is still not a read: a dive of dead links ran thin.
  const dead = parseCaseLawLedger(JSON.stringify({ queries: [q("x", "US")], citations: [c("9125", "unreachable")] })).ledger;
  assert.ok(findCaseLawLedgerViolations(dead).some((x) => x.reason === "dive_unread"));
});

// ── structural: a row that cannot be re-opened is not a receipt ───────────────────────────────────

test("#263 a citation with no url, no proceeding, or an off-enum read state is refused by name", () => {
  const bad = JSON.stringify({
    queries: [q("VELTRA opposition", "US")],
    citations: [
      { proceeding: "91250001", url: "", read: "read" },
      { proceeding: "", url: "https://x/y", read: "read" },
      { proceeding: "91250003", url: "https://x/z", read: "skimmed" },
    ],
  });
  const v = findCaseLawLedgerViolations(parseCaseLawLedger(bad).ledger);
  for (const r of ["citation_no_url", "citation_no_proceeding", "citation_read_state"])
    assert.ok(v.some((x) => x.reason === r), `missing ${r}`);
});

test("#263 a query with no territory cannot answer 'was THIS territory swept'", () => {
  const v = findCaseLawLedgerViolations(parseCaseLawLedger(JSON.stringify({
    queries: [q("VELTRA opposition", ""), q("", "US")], citations: [c("91250001")],
  })).ledger);
  assert.ok(v.some((x) => x.reason === "query_no_jurisdiction"));
  assert.ok(v.some((x) => x.reason === "query_no_text"));
});

// ── absence and malformation are FINDINGS, never empty passes ─────────────────────────────────────

test("#263 a malformed ledger fails with a name — it never degrades to 'no violations'", () => {
  assert.match(parseCaseLawLedger("{").error, /unparseable json/);
  assert.match(parseCaseLawLedger("[]").error, /top level must be an object/);
  assert.match(parseCaseLawLedger(JSON.stringify({ citations: [] })).error, /no queries\[\] array/);
  assert.match(parseCaseLawLedger(JSON.stringify({ queries: [] })).error, /no citations\[\] array/);
  // null is "no ledger offered", which the VALIDATOR decides about — the parser must not invent one.
  assert.deepEqual(parseCaseLawLedger(null), { ledger: null, error: null });
  assert.deepEqual(findCaseLawLedgerViolations(null), []);
});

test("#263 the reason vocabulary is closed, exported, and every reason is reachable", () => {
  // The property, applied here at birth rather than after a probe has gone stale on it.
  const advisory = [...CASE_LAW_ADVISORY_REASONS];
  for (const r of advisory) assert.ok(CASE_LAW_LEDGER_REASONS.includes(r), `advisory reason not in the vocabulary: ${r}`);
  for (const r of CASE_LAW_LEDGER_REASONS) assert.equal(isCaseLawBlocking({ reason: r }), !CASE_LAW_ADVISORY_REASONS.has(r), r);
  // An unknown reason is BLOCKING — the fail-closed direction. A probe treating it as advisory would
  // report a withheld run as a clean one.
  assert.equal(isCaseLawBlocking({ reason: "invented" }), true);
  assert.equal(isCaseLawBlocking({}), true);
  assert.deepEqual(CASE_LAW_READ_STATES, ["read", "listed-not-read", "unreachable"]);
});

test("#263 the failure token carries the count PER CAUSE before the detail", () => {
  const v = findCaseLawLedgerViolations(parseCaseLawLedger(JSON.stringify({
    queries: [q("", "US"), q("", "US")], citations: [c("91250001", "listed-not-read")],
  })).ledger);
  const tok = caseLawLedgerFail(v);
  assert.match(tok, /^caselaw_ledger:/);
  assert.match(tok, /query_no_text=2/, "the census must name how many of each cause, the shape every other hint branches on");
  assert.match(tok, /dive_unread=1/);
});
