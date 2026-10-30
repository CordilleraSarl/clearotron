// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-refused-search-is-told-apart-from-an-unsupported-one.test.mjs — the lawyer's account of the searches a run left
// undone gives a search the register refused during the run, and one it does not support, a sentence each.
//
// THE DEFECT. A run whose register spent its daily limit had 45 searches left undone on one axis: 43 refused after the
// retries ran out, 13 on the daily credit cap and 30 on the rate limit, and 2 the register does not support. The
// report's front matter told the lawyer that no re-run could close any of them because the provider cannot express
// them, which was false for the 43; a run after the reset would ask them. Beside each search the coverage ledger
// printed the recorded line, in the engine's words ("slice", "recovery ladder"). Measured 2026-10-29 and 2026-10-30.
//
// The sentences are the owner's, word for word, and so are the three bracket fills. Every name here is invented.
//
// Run:  node --test driver/test/a-refused-search-is-told-apart-from-an-unsupported-one.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { PROVIDER_HARD_ERROR_PREFIX, PROVIDER_PERMANENT_ERROR_PREFIX, unsupportedPredicateReason, refusalCause,
  refusedSearchesSentence, UNSUPPORTED_SEARCHES_SENTENCE, refusedSearchSentence, undoneSearchesNote } from "../register-plan.mjs";
import { renderCoverageLedgerSection, coverageFormBrief } from "../coverage-form.mjs";

const REFUSED_DAILY = "These searches were not carried out because the register refused them during this run (its daily limit was reached); a later run can repeat them.";
const REFUSED_RATE = "These searches were not carried out because the register refused them during this run (it was rate-limited); a later run can repeat them.";
const REFUSED_DOWN = "These searches were not carried out because the register refused them during this run (it was not responding); a later run can repeat them.";
const REFUSED_PLAIN = "These searches were not carried out because the register refused them during this run; a later run can repeat them.";
const UNSUPPORTED = "These searches cannot be carried out because the register does not support this kind of search; no run can close this gap.";
const ENGINE_WORDS = /\bslices?\b|recovery ladder|cannot express|provider/i;

const hard = (cause) => PROVIDER_HARD_ERROR_PREFIX + `provider error (after one in-tool retry): ${cause}`;
const DAILY = hard("Error: register_search HTTP 429: used 1000 of 1000 daily credit cap. The cap resets at 2026-10-30T00:00Z");
const RATE = hard("Error: register_search HTTP 429: rate limit exceeded. Retry after 2 s.");

/** The run's shape: 45 searches on one axis, 13 refused on the daily cap, 30 on the rate limit, 2 not supported. */
const qids = Array.from({ length: 45 }, (_, i) => `primary-sweep:q${i}`);
const PLAN = { entries: [...qids.map((qid) => ({ qid, axis: "primary-sweep" })), { qid: "incumbent-class:q0", axis: "incumbent-class" }] };
const RECEIPT = { deferred: qids.map((qid, i) => ({ qid, reason: i < 13 ? DAILY : i < 43 ? RATE : unsupportedPredicateReason("owner-term", "invented-register") })) };

test("the run's account gives the refused searches and the unsupported ones a sentence each, in the owner's words", () => {
  const note = undoneSearchesNote(PLAN, RECEIPT, ["primary-sweep"]);
  assert.equal(note, `${REFUSED_DAILY} ${REFUSED_RATE} ${UNSUPPORTED}`);
  assert.doesNotMatch(note, ENGINE_WORDS, "the lawyer is still told the engine's words");
  assert.equal(refusedSearchesSentence("daily-limit"), REFUSED_DAILY);
  assert.equal(UNSUPPORTED_SEARCHES_SENTENCE, UNSUPPORTED);
});

test("the bracket is the register's recorded answer, and any other answer gets none", () => {
  const cases = [
    [DAILY, "daily-limit", REFUSED_DAILY],
    // Signa's own error types on a 429, as its client records them.
    [hard('HTTP 429: {"error":{"type":"daily_credit_cap_exceeded"}}'), "daily-limit", REFUSED_DAILY],
    [hard('HTTP 429: {"error":{"type":"rate_limited"}}'), "rate-limited", REFUSED_RATE],
    [hard('HTTP 429: {"error":{"type":"insufficient_credits"}}'), "daily-limit", REFUSED_DAILY],
    [hard("HTTP 429: Too Many Requests"), "rate-limited", REFUSED_RATE],
    [hard("rate limited by the register, retry later"), "rate-limited", REFUSED_RATE],
    [hard("HTTP 503: Service Unavailable"), "not-responding", REFUSED_DOWN],
    [hard("Error: register_search http 502: bad gateway"), "not-responding", REFUSED_DOWN],
    [hard("fetch failed"), "not-responding", REFUSED_DOWN],
    [PROVIDER_PERMANENT_ERROR_PREFIX + "HTTP 500: INTERNAL_SERVER_ERROR", "not-responding", REFUSED_DOWN],
    [hard("HTTP 400: Bad Request"), null, REFUSED_PLAIN],
  ];
  for (const [reason, cause, sentence] of cases) {
    assert.equal(refusalCause(reason), cause, reason);
    assert.equal(refusedSearchSentence(reason), sentence, reason);
  }
  assert.equal(refusedSearchSentence(unsupportedPredicateReason("owner-term", "invented-register")), null, "an unsupported search's own line was rewritten");
  assert.equal(refusedSearchSentence("the session could not be resumed"), null, "a line that is not a refusal was rewritten");
});

test("refused searches with different answers on one axis keep a sentence each, and the unsupported ones close it", () => {
  const receipt = { deferred: [
    { qid: qids[0], reason: hard("HTTP 503: Service Unavailable") }, { qid: qids[1], reason: DAILY },
    { qid: qids[2], reason: hard("HTTP 400: Bad Request") }, { qid: qids[3], reason: hard("HTTP 429: Too Many Requests") },
    { qid: qids[4], reason: unsupportedPredicateReason("owner-term", "invented-register") },
  ] };
  assert.equal(undoneSearchesNote(PLAN, receipt, ["primary-sweep"]), [REFUSED_DAILY, REFUSED_RATE, REFUSED_DOWN, REFUSED_PLAIN, UNSUPPORTED].join(" "));
  // A refused search on an axis the account is not about does not enter it.
  assert.equal(undoneSearchesNote(PLAN, { deferred: [{ qid: "incumbent-class:q0", reason: DAILY }] }, ["primary-sweep"]), UNSUPPORTED);
});

test("beside each refused search the coverage ledger, and the write-up's list it is built from, print the owner's sentence", () => {
  const row = (i, reason) => ({ row_id: `CD${i}`, kind: "deferred", axis: "primary-sweep", unit: `primary-sweep / unit ${i}`, qid: qids[i],
    receipt_reason: reason, open: true, status: "deferred", reason: "Not searched in this run." });
  const rows = [row(0, DAILY), row(1, unsupportedPredicateReason("owner-term", "invented-register")), row(2, "the session could not be resumed")];
  const table = renderCoverageLedgerSection(rows).split("\n");
  const brief = coverageFormBrief({ rows }).split("\n");
  for (const lines of [table, brief]) {
    const at = (i) => lines.find((l) => l.includes(`unit ${i}`)) ?? "";
    assert.ok(at(0).includes(`receipt: ${REFUSED_DAILY}`), `the refused search reads as recorded: ${at(0)}`);
    assert.doesNotMatch(at(0), /\bslices?\b|recovery ladder/i);
    // An unsupported search keeps its own line, which names what the register lacks; so does any other line.
    assert.ok(at(1).includes("is not supported by the active register provider (invented-register)"), `the unsupported search lost its line: ${at(1)}`);
    assert.ok(at(2).includes("receipt: the session could not be resumed"), "a line that is not a refusal was rewritten");
  }
});
