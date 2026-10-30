// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-audit-says-why-a-search-was-not-carried-out.test.mjs — the audit's ask ledger, under "Questions the run asked
// itself", gives the owner's sentence for why a search was not carried out in place of the line the run recorded.
//
// THE DEFECT. The audit is delivered with the report, and its ask ledger quoted each recorded reason as written for the
// run's record: "capability-gap:", a provider's id, "is not in Latin script". Measured 2026-10-30 on the test install:
// 89 such lines in 50 of 145 audits, the only delivered file found printing them. The coverage ledger already gives the
// same nine sentences (a-search-not-carried-out-says-why-in-plain-words.test.mjs); this is the delivered surface.
//
// The sentences are the owner's, word for word. Every name, term and register here is invented.
//
// Run:  node --test driver/test/the-audit-says-why-a-search-was-not-carried-out.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAuditMd } from "../publish/audit-from-spine.mjs";
import { unsupportedPredicateReason, uncoveredJurisdictionReason } from "../register-plan.mjs";
import { notSearchedSentence as fromThePlan, NOT_SEARCHED_SENTENCES } from "../register-plan.mjs";
import { notSearchedSentence } from "../not-searched-sentences.mjs";
import { CAPABILITY_GAP_MARKER, REFUSED_BEFORE_SENDING, refusedBeforeSendingReason } from "../../providers/_shared/execute-plan.mjs";
import { nativeScriptIndexGap } from "../../providers/_shared/script-form.mjs";
import { assertSearchableTerm } from "../../providers/clarivate/src/core.js";

const KIND_OF_SEARCH = "Not searched: this register does not offer this kind of search. It was set aside and is disclosed here.";
const OTHER_ALPHABET = "Not searched: this register files marks in other alphabets under a Latin spelling, so a term written in its own alphabet cannot be searched here. It was set aside and is disclosed here.";
const SEARCH_COMMAND_WORD = "Not searched: the term contains the word AND, OR or NOT, which this register treats as a search command, so it cannot be searched as written. It was set aside and is disclosed here.";
const CANNOT_RUN = "Not searched: this register cannot run this search; the reason is recorded in the run. It was set aside and is disclosed here.";

const REGISTER = "invented-register";
const operatorWord = (() => { try { assertSearchableTerm("LANTERN OR WICK"); } catch (e) { return refusedBeforeSendingReason(`${CAPABILITY_GAP_MARKER} ${REFUSED_BEFORE_SENDING} ${e.message}`); } })();
const RECORDED = {
  "kind-of-search": unsupportedPredicateReason("phonetic", REGISTER),
  "other-alphabet": `${CAPABILITY_GAP_MARKER} ${nativeScriptIndexGap({ id: REGISTER, nativeScriptIndex: false }, ["蓝灯芯"])}`,
  "search-command-word": operatorWord,
  "cannot-run": uncoveredJurisdictionReason(["XA"], REGISTER),
};
/** An ask the plan-execution join ended as a recovery, with the receipt's recorded reason, as ask-ledger.mjs mints it. */
const deferredAsk = (i, reason) => ({ ask_id: `ask:frame:variant-${i}`, born: { place: "frame-diff", artifact: "_driver/frame-reopen.json", ref: `variant:${i}`, ts: null },
  ask: { text: `blind frame-diff omission: variant:lanternwick-${i} — sweep it or say why not`, owner: "register", structured: null },
  qids: [`supp:primary-sweep:exact:lanternwick-${i}:aa11bb2${i}`],
  ending: { kind: "recovery", by: "plan-execution-join", evidence: `qid(s) deferred per plan-execution receipt: supp:primary-sweep:exact:lanternwick-${i}`, reasons: [reason.slice(0, 300)], ts: null },
  handoff: null });
const ledgerOf = (asks) => {
  const { md } = buildAuditMd("", "", { asks, doubts: [] });
  return md.slice(md.indexOf("## Ask Ledger"));
};

test("each recorded reason a search was not carried out reads, in the audit's ask ledger, as the owner's sentence, whole", () => {
  const asks = Object.values(RECORDED).map((r, i) => deferredAsk(i, r));
  const ledger = ledgerOf(asks);
  for (const sentence of [KIND_OF_SEARCH, OTHER_ALPHABET, SEARCH_COMMAND_WORD, CANNOT_RUN])
    assert.ok(ledger.includes(` — recovery — ${sentence}\n`), `the ledger does not print the sentence whole: ${sentence}`);
  assert.doesNotMatch(ledger, /capability-gap|register provider|Latin script|invented-register/, "the ledger still prints the engine's words");
  // The run's record, the ask itself, keeps the recorded line.
  assert.equal(asks[0].ending.reasons[0], RECORDED["kind-of-search"].slice(0, 300));
});

test("a reason of no known kind, and the run's own judgments, stand as recorded", () => {
  const asks = [deferredAsk(0, "the session could not be resumed"),
    { ...deferredAsk(1, "x"), ending: { kind: "recovery", by: "envelope-decision", evidence: null, reasons: ["deadline pressure"], ts: null }, handoff: "the open coverage rows" }];
  const ledger = ledgerOf(asks);
  assert.ok(ledger.includes(" — recovery — the session could not be resumed\n"));
  assert.ok(ledger.includes(" — recovery — deadline pressure — handed over: the open coverage rows\n"));
});

test("the audit and the coverage ledger read a reason the same way", () => {
  for (const r of Object.values(RECORDED)) assert.equal(notSearchedSentence(r), fromThePlan(r));
  assert.equal(Object.keys(NOT_SEARCHED_SENTENCES).length, 9);
});
