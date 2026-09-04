// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-arm-can-reach-the-corrective-seam.test.mjs — and says which pass it reproduced.
//
//. `--dispatch-trigger` exists so an arm reproduces a SPECIFIC production pass, and
// `corrective` was not in the vocabulary — so the one pass the losses happen in was the one no arm could
// dispatch. On the motivating run, pass 1 lost nothing and pass 2 discarded 25 of 31 findings, five of
// them marks a reviewing lawyer had rated.
//
// THE PART THAT IS NOT A LABEL CHANGE: production's corrective pass RESUMES the synthesis session and
// sends only a followup. An arm builds a fresh key in a sandbox and cannot resume anything — and resuming
// the real session was rejected, because "canonical run untouched" is the arm's contract and an arm that
// breaks its contract to gain fidelity is measuring with a broken instrument. So the arm carries the same
// INPUTS on a cold turn, and the receipt says which of the three it was.

import { test } from "node:test";
import assert from "node:assert/strict";
import { correctiveReadiness, correctiveRefusalLine, correctivePassState } from "../corrective-arm.mjs";
import { DISPATCH_TRIGGERS } from "../pipeline.mjs";

test("1971 `corrective` is in the vocabulary, so the pass can be asked for at all", () => {
  assert.ok(DISPATCH_TRIGGERS.includes("corrective"),
    "the one pass the losses happen in is still the one no arm can dispatch");
  // The others are untouched — this widens the vocabulary, it does not redefine it.
  for (const t of ["fresh", "escalation", "envelope", "late-bind", "stale-repair", "settlement-flush"]) {
    assert.ok(DISPATCH_TRIGGERS.includes(t), `${t} fell out of the vocabulary`);
  }
});

test("1971 THREE states, and an arm never earns production's word", () => {
  assert.equal(correctivePassState({ trigger: "corrective", ready: true }), "dispatched-cold");
  assert.equal(correctivePassState({ trigger: "corrective", ready: false }), "refused-no-corrective-state");
  // A non-corrective arm says NOTHING here rather than claiming a pass it did not reproduce.
  assert.equal(correctivePassState({ trigger: "fresh", ready: true }), null);
  assert.equal(correctivePassState({}), null);
  // `dispatched-warm` is production's alone: no input to this function can produce it.
  for (const ready of [true, false, null]) {
    for (const trigger of ["corrective", "fresh", null]) {
      assert.notEqual(correctivePassState({ trigger, ready }), "dispatched-warm",
        "an arm claimed the warm pass — it cannot resume a session, so it can never have reproduced one");
    }
  }
});

test("1971 a run with no corrective pass is REFUSED BY NAME, never given a fresh one in its clothes", () => {
  const none = correctiveReadiness({});
  assert.equal(none.ready, false);
  assert.equal(none.missing.length, 2, "both absences are named, not just the first");

  const line = correctiveRefusalLine("synthesis", none.missing);
  assert.match(line, /THIS RUN HAS NO CORRECTIVE PASS TO REPRODUCE/);
  assert.match(line, /findings-pre-corrective\.json/, "the refusal names the artefact a reader can look for");
  assert.match(line, /senior-eye review/);
  assert.match(line, /quietly different prompt/,
    "it says WHY composing one anyway would be wrong — the same reason a typo is refused");
});

test("1971 either half missing is still a refusal — a corrective pass needs both", () => {
  assert.equal(correctiveReadiness({ preCorrective: true, reviewerVerdict: false }).ready, false);
  assert.equal(correctiveReadiness({ preCorrective: false, reviewerVerdict: true }).ready, false);
  assert.equal(correctiveReadiness({ preCorrective: true, reviewerVerdict: true }).ready, true);
  // And the refusal names only what is actually absent.
  const half = correctiveReadiness({ preCorrective: true });
  assert.equal(half.missing.length, 1);
  assert.match(half.missing[0], /reviewer/);
});

test("1971 the refusal and the dispatch are distinguishable WITHOUT inferring from wall time", () => {
  // Acceptance's third item. A reader must be able to tell which happened from the receipt alone.
  const dispatched = correctivePassState({ trigger: "corrective", ready: true });
  const refused = correctivePassState({ trigger: "corrective", ready: false });
  assert.notEqual(dispatched, refused);
  assert.ok(dispatched && refused, "both states must be NAMED — a null on either side is an inference");
});
