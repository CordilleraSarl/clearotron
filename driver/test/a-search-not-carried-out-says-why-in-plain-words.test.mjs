// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-search-not-carried-out-says-why-in-plain-words.test.mjs — beside each search a run left undone, the lawyer's
// coverage ledger gives the owner's sentence for why, and the run's record keeps the line the run wrote.
//
// THE DEFECT. Beside every search left undone for a reason other than a refusal during the run, the ledger printed
// the recorded line, written for the run's record: "capability-gap:", a provider's id, the plan's own words. Measured
// 2026-10-30 over the test install's plan receipts: eight kinds of reason, the commonest in 29 runs.
//
// The sentences are the owner's, word for word. Each reason below is made by the code that records it, wrapped the
// way the plan executor wraps it. Every name, term and register here is invented.
//
// Run:  node --test driver/test/a-search-not-carried-out-says-why-in-plain-words.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { notSearchedSentence, refusedSearchSentence, PROVIDER_HARD_ERROR_PREFIX, unsupportedPredicateReason,
  uncoveredJurisdictionReason, officeUnavailableReason, ownerIntersectionUnsupportedReason, goodsTextUnsupportedReason,
  variantTermIssue } from "../register-plan.mjs";
import { renderCoverageLedgerSection, coverageFormBrief } from "../coverage-form.mjs";
import { parseCoverageLedgerFull, isCapabilityGapReason, coerceToolAbsenceDeferred } from "../coverage-ledger.mjs";
import { CAPABILITY_GAP_MARKER, REFUSED_BEFORE_SENDING, refusedBeforeSendingReason, unresolvedOwnerCountReason } from "../../providers/_shared/execute-plan.mjs";
import { GATEWAY_STALL } from "../../providers/_shared/enumerate.mjs";
import { nativeScriptIndexGap } from "../../providers/_shared/script-form.mjs";
import { clipProviderText } from "../../providers/_shared/provider-text.mjs";
import { assertSearchableTerm, assertSingleMarkShape, countFailureReason } from "../../providers/clarivate/src/core.js";
import { resolvePredicate, renderTerm, buildRsql } from "../../providers/euipo/src/core.js";

const OTHER_ALPHABET = "Not searched: this register files marks in other alphabets under a Latin spelling, so a term written in its own alphabet cannot be searched here. It was set aside and is disclosed here.";
const KIND_OF_SEARCH = "Not searched: this register does not offer this kind of search. It was set aside and is disclosed here.";
const OWNER_NOT_RECOGNISED = "Not counted: the register did not recognise this owner's name, so a count of zero for the owner would prove nothing. It was set aside and is disclosed here.";
const KEPT_TIMING_OUT = "Not searched: the register kept timing out on this search, even when asked one territory at a time. It was set aside and is disclosed here.";
const SEARCH_COMMAND_WORD = "Not searched: the term contains the word AND, OR or NOT, which this register treats as a search command, so it cannot be searched as written. It was set aside and is disclosed here.";
const PHRASE_TOO_LONG = "Not searched: the phrase is longer than this register can search as one phrase. It was set aside and is disclosed here.";
const TOO_MANY_NAMES = "Not searched: the register refused this search because it asked for too many names at once. It was set aside and is disclosed here.";
const WILDCARD_MID_PHRASE = "Not searched: a wildcard in the middle of a phrase cannot be searched on this register. It was set aside and is disclosed here.";
const CANNOT_RUN = "Not searched: this register cannot run this search; the reason is recorded in the run. It was set aside and is disclosed here.";

const REGISTER = "invented-register";
const thrown = (fn) => { try { fn(); } catch (e) { return e.message; } assert.fail("the producer refused nothing"); };
/** A client refusal before sending, as the executor records it: Clarivate's request builder throws a bare message, and
 *  the EU register's builder throws one already marked. */
const beforeSending = (msg) => refusedBeforeSendingReason(msg.startsWith(CAPABILITY_GAP_MARKER) ? msg : `${CAPABILITY_GAP_MARKER} ${REFUSED_BEFORE_SENDING} ${msg}`);
/** The same refusal as older runs recorded it, behind the count probe's provider-error framing. */
const olderCountProbe = (msg) => `provider error (after one in-tool retry): provider error on the count probe before enumeration: ${clipProviderText(`${CAPABILITY_GAP_MARKER} ${msg}`, 240)}`;
const REFUSED_WRAP = 'INTERNAL_SERVER_ERROR - 400 on POST request for "/search"';
const orStack = (n) => ({ searchFields: [{ value: Array.from({ length: n }, (_, i) => `LANTERNWICK${i}`).join(" OR ") }] });

const KINDS = [
  [OTHER_ALPHABET, "a term in another alphabet, on a register that files it under a Latin spelling", [
    `${CAPABILITY_GAP_MARKER} ${nativeScriptIndexGap({ id: REGISTER, nativeScriptIndex: false }, ["蓝灯芯"])}`,
  ]],
  [KIND_OF_SEARCH, "a kind of search the register does not offer", [unsupportedPredicateReason("phonetic", REGISTER)]],
  [OWNER_NOT_RECOGNISED, "an owner's count the register could not verify", [unresolvedOwnerCountReason("INVENTED HOLDINGS", [])]],
  [KEPT_TIMING_OUT, "a search that timed out down to one territory", [
    `provider error (not asked again): provider error — ${GATEWAY_STALL}: after a gateway timeout the question was asked again in `
      + "region halves down to the one region XA, which timed out alone too, so it is not answered this run. The gateway's words: 504",
  ]],
  [SEARCH_COMMAND_WORD, "a term holding AND, OR or NOT", [
    beforeSending(thrown(() => assertSearchableTerm("LANTERN OR WICK"))),
    olderCountProbe(thrown(() => assertSearchableTerm("LANTERN OR WICK"))),
  ]],
  [PHRASE_TOO_LONG, "a phrase past the register's word bound", [
    beforeSending(thrown(() => assertSingleMarkShape("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE"))),
  ]],
  [TOO_MANY_NAMES, "a query the register refused as malformed, with several names in it", [countFailureReason(500, REFUSED_WRAP, orStack(30))]],
  [WILDCARD_MID_PHRASE, "a wildcard in the middle of a phrase", [variantTermIssue("LANTERN * WICK")]],
  [CANNOT_RUN, "the kinds only the code records", [
    `${CAPABILITY_GAP_MARKER} ${nativeScriptIndexGap({ id: REGISTER }, ["蓝灯芯"])}`,
    uncoveredJurisdictionReason(["XA"], REGISTER),
    officeUnavailableReason(["XA"], REGISTER, { memberId: "invented-index", missing: ["INVENTED_DB"] }),
    ownerIntersectionUnsupportedReason(REGISTER),
    goodsTextUnsupportedReason(REGISTER),
    beforeSending(thrown(() => resolvePredicate({ match_mode: "telepathic" }))),
    beforeSending(thrown(() => renderTerm("", "exact"))),
    beforeSending(thrown(() => renderTerm("*LANTERN", "exact"))),
    beforeSending(thrown(() => renderTerm("**", "contains"))),
    beforeSending(thrown(() => buildRsql({ term: "LANTERN", regions: ["XA"] }))),
  ]],
];

test("each kind of reason a run records reads as the owner's sentence for it", () => {
  for (const [sentence, kind, reasons] of KINDS)
    for (const reason of reasons) assert.equal(notSearchedSentence(reason), sentence, `${kind}: ${reason}`);
});

test("a sentence stands only where it is true of the search", () => {
  // A register whose index form nobody has declared may hold the characters: the Latin-spelling sentence would be false.
  assert.equal(notSearchedSentence(`${CAPABILITY_GAP_MARKER} ${nativeScriptIndexGap({ id: REGISTER }, ["蓝灯芯"])}`), CANNOT_RUN);
  // One name sent is not too many names.
  assert.equal(notSearchedSentence(countFailureReason(500, REFUSED_WRAP, orStack(1))), CANNOT_RUN);
  // A line clipped past the count of names sent cannot say how many were asked for.
  const clipped = `provider error on the count probe (after one in-tool retry): ${clipProviderText(countFailureReason(500, REFUSED_WRAP, orStack(30)), 100)}`;
  assert.doesNotMatch(clipped, /Sent \d+ OR terms/);
  assert.equal(notSearchedSentence(clipped), CANNOT_RUN);
  // A timeout not yet split down to one territory is not "even when asked one territory at a time".
  assert.equal(notSearchedSentence(`provider error (not asked again): provider error — ${GATEWAY_STALL}: the gateway timed out`), null);
});

test("a reason of no known kind, and a refusal during the run, keep their own account", () => {
  for (const reason of ["the session could not be resumed", "national (XA-NAT): not searched", "", null])
    assert.equal(notSearchedSentence(reason), null, String(reason));
  const refused = PROVIDER_HARD_ERROR_PREFIX + "provider error (after one in-tool retry): HTTP 429: rate limit exceeded";
  assert.equal(notSearchedSentence(refused), null, "a refusal during the run took another kind's sentence");
  assert.ok(refusedSearchSentence(refused));
});

test("the lawyer's ledger prints the owner's sentence, and the run's record and the writer's list keep the recorded line", () => {
  const recorded = [
    unsupportedPredicateReason("phonetic", REGISTER), variantTermIssue("LANTERN * WICK"), uncoveredJurisdictionReason(["XA"], REGISTER),
    "the session could not be resumed", PROVIDER_HARD_ERROR_PREFIX + "provider error (after one in-tool retry): HTTP 503: Service Unavailable",
  ];
  const rows = recorded.map((reason, i) => ({ row_id: `CD${i}`, kind: "deferred", axis: "primary-sweep", unit: `primary-sweep / unit ${i}`,
    qid: `primary-sweep:q${i}`, receipt_reason: reason, open: true, status: "deferred", reason: "Not searched in this run." }));
  const before = JSON.stringify(rows);
  const table = renderCoverageLedgerSection(rows).split("\n");
  const at = (lines, i) => lines.find((l) => l.includes(`unit ${i} `) || l.endsWith(`unit ${i}`)) ?? "";
  assert.ok(at(table, 0).includes(`receipt: ${KIND_OF_SEARCH}`), at(table, 0));
  assert.ok(at(table, 1).includes(`receipt: ${WILDCARD_MID_PHRASE}`), at(table, 1));
  assert.ok(at(table, 2).includes(`receipt: ${CANNOT_RUN}`), at(table, 2));
  for (const i of [0, 1, 2]) assert.doesNotMatch(at(table, i), /capability|provider|plan language|invented-register/i, at(table, i));
  assert.ok(at(table, 3).includes("receipt: the session could not be resumed"), "a line of no known kind was rewritten");
  assert.ok(at(table, 4).includes("receipt: These searches were not carried out because the register refused them during this run"), at(table, 4));
  assert.equal(JSON.stringify(rows), before, "the run's record lost its recorded line");
  const brief = coverageFormBrief({ rows }).split("\n");
  assert.ok(at(brief, 0).includes(`receipt: ${recorded[0].slice(0, 60)}`), "the writer's list lost the recorded line");
});

test("a ledger read back from its rendered table reads each sentence as the recorded line was read", () => {
  for (const [, kind, reasons] of KINDS) for (const reason of reasons) {
    const row = { row_id: "CD0", kind: "deferred", axis: "primary-sweep", unit: "primary-sweep / unit 0", qid: "primary-sweep:q0",
      receipt_reason: reason, open: true, status: "coverage-limited", reason: "Not searched in this run." };
    const [back] = parseCoverageLedgerFull(renderCoverageLedgerSection([row])).rows;
    assert.ok(back && !/capability-gap|register provider/.test(back.reason), `${kind}: the table still prints the recorded line`);
    assert.equal(isCapabilityGapReason(back.reason), isCapabilityGapReason(reason), `${kind}, capability gap: ${reason}`);
    // Every sentence says the search was set aside and is disclosed: a gap, never a limit accepted as covered.
    assert.equal(coerceToolAbsenceDeferred([back])[0].status, "deferred", `${kind}: ${back.reason}`);
  }
});
