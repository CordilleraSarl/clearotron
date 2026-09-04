// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A correction hint is composed into `Fix exactly this: ensure <hint>.` — so the clause right after
// `ensure` must name the state the model MUST REACH, never the state it is in.
//
// Three branches named the state it was in. Read whole, each told the model to reproduce the defect:
//
//   "Fix exactly this: ensure recorded meaning-sweep receipts are UNDISPOSED …"
//   "Fix exactly this: ensure a recorded meaning-sweep result that recurred … is cited nowhere …"
//   "Fix exactly this: ensure your PR / reputational section claims a clean meaning … but the grid
//    ledger's extras.pr_risk recorded ZERO connotation searches …"
//
// The first is verbatim from a delivered R2 clearance, 2026-08-06 @d90d9bd — the corrective dispatch the
// stage was handed after it failed with cite_absent=34. The remedy that FOLLOWS each opening was correct
// and detailed, and the seat evidently followed the remedy: the residual set moved on every attempt
// (34 → 5 → 26 → 6 → 6 → 2 → 1 → 0). So this has never been shown to kill a run, and the fix is not
// claimed to make one converge.
//
// It is worth pinning anyway, because a corrective dispatch whose opening contradicts its own remedy
// spends the seat's attention reconciling them — and this is the one text in the engine we call the fix
// for exactly this class of defect (,: the instruction asserted the wrong thing).
//
// These tests compose through `warmPatchMessage`, the shipped composer, not through a prefix retyped
// here. If the template ever stops saying "ensure", they stop testing the right thing loudly rather than
// silently, because the extraction below finds nothing and fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { warmPatchMessage, correctionHint } from "../gateway.mjs";
import { rulingsProse } from "../connotation-search.mjs";

const FILE = "/w/run/common-law-findings.half-b.md";
const TOK = (payload) => `invalid_file:run/common-law-findings.half-b.md:${payload}`;

/** The clause the model is told to ensure: everything after `ensure `, up to the first full stop. */
function ensured(message) {
  const m = /Fix exactly this: ensure (.+?)(?:\. |\.\n|$)/s.exec(message);
  assert.ok(m, "the composed dispatch no longer reads `Fix exactly this: ensure …` — these tests are pinned to that template");
  return m[1];
}

test("unruled rows: the model is told to ensure they ARE recorded — through the tool, never a file", () => {
  // B: `no_ruling` is a form-era token this engine no longer mints, kept actionable for runs parked
  // under the previous engine. The requirement it states is the tool route.
  const msg = warmPatchMessage(TOK("connotation_no_ruling:no_ruling=34;Q-ABCDEFGH [Q gang],X-JKMNPQRS [https://e.example/a]"), [FILE]);
  const clause = ensured(msg);
  assert.match(clause, /every remaining meaning obligation is recorded through the `record_dispositions` tool/,
    "names the end state the model must reach — and the ROUTE, which is the one thing R6 was never told");
  assert.ok(!/rows are UNRULED|carries no ruling/.test(clause),
    "the clause after `ensure` must not be the defect — that shipped once and read as an instruction to leave them unruled");
  assert.match(msg, /already recorded is KEPT/i, "the seat is told its earlier work is kept");
  assert.match(msg, /Record rulings ONLY by calling/, "and the patch orders the call, never a file edit");
});

test("a damaged row: the model is told to ensure the receipts come from the row's own candidates", () => {
  const msg = warmPatchMessage(TOK("connotation_form_damaged:form_damaged=1;receipt_id R-ZZZZZZZZ is not a candidate of row Q-ABCDEFGH"), [FILE]);
  const clause = ensured(msg);
  assert.match(clause, /every recorded row's receipt is one of THAT ROW's own listed candidates/,
    "the requirement, not the complaint");
  assert.ok(!/does not parse|is not one of/.test(clause), "`ensure … is not one of` instructs the model to break it");
});

test("a clean-meaning claim with no sweep: the model is told to ensure the claim HAS the sweep behind it", () => {
  const clause = ensured(warmPatchMessage(TOK("connotation_search_missing"), [FILE]));
  assert.match(clause, /clean-meaning claim has the sweep behind it/, "the requirement leads");
  assert.ok(!/^your PR \/ reputational section claims a clean meaning/.test(clause),
    "`ensure your section claims a clean meaning` instructs the model to make the unbacked claim");
});

test("no composed hint opens by asserting its own defect", () => {
  // The three shapes that shipped inverted. A regression on any of them is the same bug returning.
  const INVERTED = [
    /\bare UNRULED\b/,
    /rows? (?:carries|carry) no ruling/,
    /^the meaning-sweep disposition form does not parse/,
    /^your PR \/ reputational section claims a clean meaning/,
  ];
  const TOKENS = [
    "connotation_no_ruling:no_ruling=4;Q-ABCDEFGH [Q gang]",
    "connotation_no_ruling:no_ruling=62;Q-ABCDEFGH [Q gang],X-JKMNPQRS [https://e.example/c] (+60 more)",
    "connotation_form_damaged:form_damaged=1;receipt_id R-ZZZZZZZZ is not a candidate of row Q-ABCDEFGH",
    "connotation_search_missing",
  ];
  for (const t of TOKENS) {
    const clause = ensured(warmPatchMessage(TOK(t), [FILE]));
    for (const bad of INVERTED) {
      assert.ok(!bad.test(clause), `"${t}" opens by asserting its defect: ${clause.slice(0, 140)}`);
    }
  }
});

test("the caller's full stop is not doubled", () => {
  // — the multi-family composition is gone with the six causes it composed: one token, one remedy.
  // The property that outlived it is the one that produced a live dispatch reading two sentences run
  // together — the caller composes `… ensure ${hint}.` and owns the final stop.
  for (const t of ["connotation_no_ruling:no_ruling=1;Q-ABCDEFGH [Q gang]",
                   "connotation_form_damaged:form_damaged=1;bad row",
                   "connotation_search_missing"]) {
    const h = correctionHint(TOK(t));
    assert.ok(!/[.]$/.test(h), `hint for "${t}" ends in a full stop — the caller adds one, giving ".."`);
    assert.ok(!/\.\.\s*$/.test(warmPatchMessage(TOK(t), [FILE]).split("\n")[1]), "doubled full stop in the composed dispatch");
  }
});
