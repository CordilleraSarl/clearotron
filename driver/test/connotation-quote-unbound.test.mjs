// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A RULED ROW REPORTED AS `no_ruling` KILLED A RUN, AND THE MESSAGE IS THE WHOLE FIX.
//
// R6 (Full country search into China) failed terminally at `common-law-half:b` after four dispatches,
// each byte-identical to the last: 25 dispatches, dead at step 2 of 9, never reaching the case-law pass
// it exists for. The token was
//
//     connotation_no_ruling:no_ruling=1;Q-1F4YWF87 [冰冻浆果 meaning]
//
// and that row was ruled — `benign`, a note, a receipt_id in its own candidate list, 72 of 72 rows
// carrying a ruling. Only `quoteJoins` refused, because the seat had quoted two adjacent numbered
// definitions of a dictionary entry with the ` 2. ` between them dropped. Both halves verbatim; the
// concatenation not.
//
// The corrective hint said "ensure EVERY row carries a ruling". The seat opened the form, found a
// ruling, and correctly changed nothing — which is why every retry was byte-identical and why the ladder
// was closed BY CONSTRUCTION. A retry loop can only escape a state the seat believes is wrong.
//
// THE OTHER SUB-CASE PROVES THE GATE MUST NOT BE LOOSENED. The same clause fired on a Cyrillic row four
// minutes later where the seat had written a gloss appearing in NO candidate at all — the paraphrase
// `quote_required` exists to stop — and a fresh attempt then quoted properly and the run recovered.
// Same clause, opposite fault, opposite outcome. So the fix is to name the state, never to accept more.
//
// THE BREAK MATRIX, and every arm below is one row of it:
//   · quoteJoins' answer is unchanged on every input          → break: loosen it, arm 5 goes red
//   · a ruled row with a split quote reports quote_unbound     → break: drop the branch, arm 6 goes red
//   · a genuinely unruled row still reports no_ruling          → break: widen the branch, arm 7 goes red
//   · the gate still REFUSES the split row                     → break: bind it, arm 9 goes red
//   · the residual stays visible to the convergence ledger     → break: drop the repairs entry, arm 10
//
// Text here is synthetic. 冰冻浆果 ("frozen berries") is the synthetic VIBRANTE FROSTPLUM matter's own
// category term; nothing in this file comes from a client matter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  quoteBinding, quoteJoins, isRuled, findConnotationViolations,
  connotationObligations, obligationRows, CONNOTATION_REASONS, CONNOTATION_FORM_REASONS,
} from "../connotation-search.mjs";
import { progressQuantity } from "../repairs.mjs";
import { warmEligible, warmPatchMessage } from "../gateway.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// A dictionary entry that ENUMERATES — the shape that makes this deterministic rather than occasional.
// CJK has no inter-word spaces, so nothing visually separates item 1 from item 2 once the " 2. " is
// dropped, and the join looks continuous to a reader and to a model.
const ENUMERATED = "1. 液體遇冷而凝結。如：「結凍」、「冰凍三尺」。 2. 食物湯汁或含有膠質的汁液等，經過冷卻，所凝結的半固體食品。";
const SPLIT_QUOTE = "液體遇冷而凝結。如：「結凍」、「冰凍三尺」。食物湯汁或含有膠質的汁液等，經過冷卻，所凝結的半固體食品。";
const CONTIGUOUS_QUOTE = "食物湯汁或含有膠質的汁液等，經過冷卻，所凝結的半固體食品。";
// A gloss that is in no snippet at all. Not a fragment problem — zero characters of it are present.
const FABRICATED = "surface of the body, skin, colour of the skin";

const CANDS = [{ receipt_id: "R-5T9SYVN3", title: "t", url: "https://example.invalid/a", snippet: ENUMERATED }];

test("#518 arm 1 — a contiguous quote binds, and names the receipt it bound against", () => {
  const b = quoteBinding(CONTIGUOUS_QUOTE, CANDS);
  assert.equal(b.state, "bound");
  assert.equal(b.receipt_id, "R-5T9SYVN3");
});

test("#518 arm 2 — R6's quote is SPLIT: both edges in one snippet, the whole of it in none", () => {
  // The exact mechanism that killed the run. Verify the premise before the verdict, so a future change
  // to normText cannot make this arm pass for the wrong reason.
  assert.ok(!ENUMERATED.includes(SPLIT_QUOTE), "premise: the concatenation is not contiguous in the snippet");
  assert.ok(ENUMERATED.includes(SPLIT_QUOTE.slice(0, 12)), "premise: the leading edge IS present");
  assert.ok(ENUMERATED.includes(SPLIT_QUOTE.slice(-12)), "premise: the trailing edge IS present");
  const b = quoteBinding(SPLIT_QUOTE, CANDS);
  assert.equal(b.state, "split");
  assert.equal(b.receipt_id, "R-5T9SYVN3", "the hint has to be able to say WHICH receipt it is in two pieces of");
});

test("#518 arm 3 — a fabricated quote is ABSENT, and names no receipt", () => {
  const b = quoteBinding(FABRICATED, CANDS);
  assert.equal(b.state, "absent");
  assert.equal(b.receipt_id, null,
    "naming a nearest receipt here would send the seat to a receipt its text was never in");
});

test("#518 arm 4 — too_short and missing are their own states, not 'absent'", () => {
  assert.equal(quoteBinding("結凍", CANDS).state, "too_short");
  assert.equal(quoteBinding("", CANDS).state, "missing");
  assert.equal(quoteBinding(null, CANDS).state, "missing");
  // Edges out of order are NOT a split: a snippet holding the tail before the head is not this passage
  // in two pieces, and calling it split would tell the seat to look for something never there.
  const reversed = [{ receipt_id: "R-X", snippet: `${SPLIT_QUOTE.slice(-12)}${"—".repeat(40)}${SPLIT_QUOTE.slice(0, 12)}` }];
  assert.equal(quoteBinding(SPLIT_QUOTE, reversed).state, "absent");
});

test("#518 arm 5 — quoteJoins' ANSWER IS UNCHANGED. Nothing that did not bind before binds now", () => {
  // The loosening option was withdrawn on the issue and this is the arm that keeps it withdrawn. The
  // strict join caught a fabricated quote on a real run and the retry loop then corrected it; softening
  // it would trade a working guard for a message bug.
  for (const q of [CONTIGUOUS_QUOTE, SPLIT_QUOTE, FABRICATED, "結凍", "", null]) {
    assert.equal(quoteJoins(q, CANDS), quoteBinding(q, CANDS).state === "bound",
      `quoteJoins and quoteBinding disagree on ${JSON.stringify(String(q).slice(0, 20))} — one gate, one answer`);
  }
  assert.equal(quoteJoins(SPLIT_QUOTE, CANDS), false, "the split quote is still REFUSED — this is not a loosening");
  assert.equal(quoteJoins(FABRICATED, CANDS), false);
  assert.equal(quoteJoins(CONTIGUOUS_QUOTE, CANDS), true);
});

// ---- the gate ----------------------------------------------------------------------------------
// One recorded query with one enumerated result. obligationRows makes it quote-required because its
// candidate carries a usable snippet, which is the only way to reach the clause under test.
const RECORDED = [{
  query: "冰冻浆果 meaning",
  results: [{ title: "凍 — dictionary", url: "https://example.invalid/a", snippet: ENUMERATED }],
}];
const SECTION = "## Connotation and meaning sweep\n\nrows follow\n";

function gate(patch) {
  const rows = obligationRows(connotationObligations(RECORDED));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quote_required, true, "premise: the row must be quote-required or this proves nothing");
  const filled = rows.map((r) => ({ ...r, receipt_id: r.candidates[0].receipt_id, ...patch }));
  return findConnotationViolations(SECTION, RECORDED.length, { recorded: RECORDED, form: filled });
}

test("#518 arm 6 — a RULED row whose quote splits reports quote_unbound, and names the nearest miss", () => {
  const v = gate({ ruling: "benign", note: "a straightforward product-category term, no loaded reading", quote: SPLIT_QUOTE });
  assert.equal(v.length, 1);
  assert.equal(v[0].reason, "quote_unbound",
    "THE DEFECT: this row is ruled. Reporting it as no_ruling is what closed R6's ladder by construction");
  assert.equal(v[0].quote_state, "split");
  // The id is MINTED BY THE DRIVER from the result, so it is read rather than retyped — a hardcoded one
  // would pin this arm to today's hash instead of to the property.
  const minted = obligationRows(connotationObligations(RECORDED))[0].candidates[0].receipt_id;
  assert.match(minted, /^R-[A-Z0-9]{8}$/);
  assert.equal(v[0].near_receipt, minted);
  assert.match(v[0].detail, /two pieces/, "the message must name the near miss, not the class");
  assert.ok(CONNOTATION_REASONS.includes(v[0].reason));
});

test("#518 arm 6b — a ruled row whose quote is absent reports quote_unbound with the OTHER remedy", () => {
  const v = gate({ ruling: "loaded", note: "reads as a slur in this market", quote: FABRICATED });
  assert.equal(v[0].reason, "quote_unbound");
  assert.equal(v[0].quote_state, "absent");
  assert.match(v[0].detail, /none of that row's receipts/,
    "'quote one continuous passage' would be wrong here — zero characters of it are present");
});

test("#518 arm 7 — a genuinely unruled row is STILL unruled. The split is strictly narrower", () => {
  // The load-bearing property. connotation-search.mjs's own warning: the gate must never destroy a
  // completed clearance by conflating "did not do the work" with "wrote the answer in a shape that did
  // not bind". quote_unbound is reachable ONLY on a row that already passes ruling, note and receipt_id,
  // so it cannot mask missing work.
  //
  // SPLIT THE OTHER SIDE OF THIS ARM AND THE PROPERTY IS UNCHANGED: each of these rows is still
  // refused, and each now names WHICH clause refused it. Nothing that failed here passes.
  assert.equal(gate({ ruling: null, note: null, quote: SPLIT_QUOTE })[0].reason, "token_absent");
  assert.equal(gate({ ruling: "TBD", note: "n", quote: CONTIGUOUS_QUOTE })[0].reason, "token_absent",
    "an off-enum ruling is missing work");
  assert.equal(gate({ ruling: "benign", note: "", quote: CONTIGUOUS_QUOTE })[0].reason, "no_ruling",
    "an empty note is missing work, whatever the quote does — and it is the residual, which is why the residual is kept");
});

test("#518 arm 8 — a row that is ruled AND quotes continuously is clean, as it was before", () => {
  assert.deepEqual(gate({ ruling: "benign", note: "product category term", quote: CONTIGUOUS_QUOTE }), []);
});

test("#518 arm 9 — the GATE still refuses the split row. Only the message changed", () => {
  const rows = obligationRows(connotationObligations(RECORDED));
  const c = rows[0];
  const seat = { ...c, receipt_id: c.candidates[0].receipt_id, ruling: "benign", note: "n", quote: SPLIT_QUOTE };
  assert.equal(isRuled(seat, c), false,
    "if this ever returns true the fix became the loosening that was withdrawn, and a fabricated quote ships");
});

test("#518 arm 10 — the residual stays visible to the convergence ledger", () => {
  // Without an entry in repairs.mjs PROGRESS_TOKENS the quantity is null, progress.kind becomes
  // "unknown", and a run converging 3 → 1 → 0 reads as stuck. Silent, and on the one token added since
  // that table was written.
  const q = progressQuantity("invalid_file:common-law-findings.half-b.md:connotation_quote_unbound:quote_unbound=3;Q-1F4YWF87 [x] split R-5T9SYVN3");
  assert.deepEqual(q, { token: "connotation_quote_unbound", value: 3 });
});

test("#518 arm 11 — verify.mjs emits the token this test pins, read off its own source", () => {
  // The vocabulary test's pattern: a literal retyped in a test is a literal that can go stale in silence.
  const src = readFileSync(join(HERE, "..", "verify.mjs"), "utf8");
  assert.match(src, /connotation_quote_unbound:quote_unbound=\$\{/,
    "the token verify builds no longer matches the shape repairs.mjs counts and gateway.mjs routes on");
  const gw = readFileSync(join(HERE, "..", "gateway.mjs"), "utf8");
  assert.match(gw, /connotation_quote_unbound/, "no corrective-hint arm routes on the new token — the loop stays closed");
  // — THIS ASSERTION WAS THE LITERAL IT WARNS ABOUT. It pinned the retyped alternation
  // `connotation_(no_ruling|quote_unbound|form_damaged)` in gateway.mjs's SOURCE, so it went red when
  // that alternation was replaced by the interpolated vocabulary — the change that makes the retyping
  // impossible. Asserted on BEHAVIOUR instead: every form reason the validator can emit must be
  // warm-eligible and must route the repair at the TOOL (B: the seat records rulings only through
  // `record_dispositions`, aimed at the failing member's OWN spec). That holds across a rename and
  // fails on the real defect, which is a reason nothing routes.
  const fail = (reason) => `invalid_file:common-law-findings.half-b.md:connotation_${reason}:${reason}=1;Q-1F4YWF87 [x]`;
  for (const reason of CONNOTATION_FORM_REASONS) {
    assert.equal(warmEligible(fail(reason), { status: "ok" }), true,
      `connotation_${reason} is not warm-eligible — the repair is cold, and nothing said so`);
    const patch = warmPatchMessage(fail(reason), ["/run/common-law-findings.half-b.md"]);
    assert.match(patch, /record_dispositions/,
      `connotation_${reason} does not route to the recording tool, so the repair aims at a file`);
    assert.match(patch, /\/run\/_driver\/grid-spec\.half-b\.json/,
      `connotation_${reason}'s patch does not name the failing member's own spec — a warm resume has no base prompt to fall back on`);
    assert.doesNotMatch(patch, /EDIT that file|Edit tool|re-save/i,
      `connotation_${reason}'s patch orders a file write — the one route a ruling cannot take any more`);
  }
});
