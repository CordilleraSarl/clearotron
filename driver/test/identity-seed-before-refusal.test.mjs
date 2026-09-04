// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A RUN THAT DIES BEFORE THE SEED ORPHANS ITS ROUND, PERMANENTLY.
//
// `ref` is the ONLY field round discovery matches on. The round reader in e2e-rounds.mjs coerces a
// run's status `ref` to a string and tests the prefix; nothing else is consulted.
//
// (A note for whoever edits this header: gitleaks' generic-api-key rule fires on the shape
// "key" + colon + a quoted token, so a sentence like "the discovery key: <backticked name>" fails the
// secret scan on prose. Reworded rather than allowlisted — that allow list is POSITIONAL, so an entry
// added to excuse a comment goes on silencing whatever lands at that slot later, including a real
// finding.) A run whose
// status.json was created by the FAILURE writer carries no `ref`, so `findRunsByRef` never sees it,
// `roundSettlement` gets `runStates 0` + `markers 0`, the round settles "unknown" — and every re-read
// re-stamps unknown. The round can never close by report.
//
// The intent was already written down and unimplemented. `findRunsByRef`'s docstring: keyed on
// status.json rather than meta.json "so that failed runs stay discoverable", because meta.json is
// written at publish time and finds every run that SUCCEEDED and not one that FAILED. Defeated in
// precisely that case.
//
// TWO PREFLIGHTS reached the failure writer before the seed — the register-count refusal that produced
// the specimen, and the research-credential refusal above it. That is why the identity seed goes above
// every refusal rather than into one refusal's writer.
//
// ONE OF THE TWO IS GONE ( acceptance 6, 2026-08-20). The research-credential door no longer
// refuses: a screen with no research credential launches, delivers its register half and discloses the
// half that did not run, so there is no throw there to order against. 's guarantee is UNCHANGED
// and now rests on one door instead of two — which makes the remaining assertion more load-bearing,
// not less, and is why the arm below pins the refusal's ABSENCE rather than being deleted. A
// reintroduced throw at that door would be a silent return of the orphaning bug.

// ── WHAT THESE TESTS CANNOT SEE, SAID HERE RATHER THAN DISCOVERED LATER ─────────────────────────────
//
// Every assertion below is a SOURCE-TEXT assertion — it reads this module's own bytes and checks an
// ORDERING. That is the right thing to pin, because the ordering is the fix. It is also the whole of
// what they can do: a behavioural no-op would leave all four green. They cannot observe a run.
//
// So the acceptance is the run, and it is load-bearing rather than ceremonial: ONE fresh kill, with the
// register credential suppressed (dies at `knockout-register-count`, the specimen's own stage),
// zero-spend because the throw precedes any model call. It must produce a `status.json` carrying `ref`,
// and a round that settles by report with no hand intervention.
//
// THE SECOND KILL IS RETIRED, and its replacement is a different acceptance rather than one fewer: a
// run with the research credential suppressed no longer dies at all. It DELIVERS — register counts
// present, every mark carrying degraded:true and a manual-verification note, and the run-level
// skipped-capability sentence on the batch's standardCaveats. E2E owns both and records the deployed
// commit at launch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline-knockout.mjs"), "utf8");

const at = (needle) => {
  const i = SRC.indexOf(needle);
  assert.ok(i >= 0, `expected to find ${JSON.stringify(needle.slice(0, 60))} in pipeline-knockout.mjs`);
  return i;
};

test("#947 IDENTITY IS SEEDED BEFORE BOTH PREFLIGHTS — the ordering IS the fix", () => {
  const seed = at('state: "running", lane: "knockout",');
  const countRefusal = at("const refusal = countPreflight({");
  assert.ok(seed < countRefusal,
    "the register-count refusal — the one that produced the measured specimen — must not be able to "
    + "write status before identity exists");
});

test("#1223 the research-credential door does not refuse, and a reintroduced throw would be caught here", () => {
  // The arm that used to order this door against the seed. Pinned as an ABSENCE rather than deleted,
  // because deleting it would let the throw come back silently — and a throw here writes a status.json
  // with no `ref`, which is the orphaning bug exists to stop. An absence assertion is the only
  // thing that can still fail when the defect returns.
  assert.equal(SRC.indexOf("PERPLEXITY_API_KEY absent from the driver env"), -1,
    "the research-credential refusal is back. #1223 acceptance 6 rules that no capability refuses the "
    + "screen for want of a key: it degrades with a disclosure (ADR-0003). Return it to a skip.");
  // …and the skip that replaced it is still wired, so this pair cannot both pass on a lane that simply
  // stopped resolving a sweep at all.
  assert.match(SRC, /skipped: "common-law-no-credential"/,
    "the skip is gone too — the screen would now attempt a sweep it has no credential for, degrade "
    + "every mark per call, and die all-failed after the paid frame turn");
});

test("#947 the seed carries `ref`, which is the ONLY key discovery matches on", () => {
  const block = SRC.slice(at("writeRunStatus(ctx, {\n      schema: 1, id: job.id, runId,"), at('state: "running", lane: "knockout",') + 60);
  assert.match(block, /ref: job\.ref \?\? null/, "without this the run is invisible, not merely untokened");
  assert.match(block, /runId/);
  assert.match(block, /id: job\.id/);
});

test("#947 the seed claims NO progress it has not made", () => {
  // An identity seed that stamped a step, a verdict or a delivered state would be asserting work that
  // has not happened — trading an invisible run for a lying one.
  const block = SRC.slice(at("writeRunStatus(ctx, {\n      schema: 1, id: job.id, runId,"), at('state: "running", lane: "knockout",') + 60);
  for (const forbidden of ["verdict", "stepIndex", "deliveredAt", "url"])
    assert.ok(!block.includes(forbidden), `the identity seed must not carry \`${forbidden}\``);
});

test("#947 the full seat-flow seed still runs, and still after the preflights", () => {
  // The fix ADDS a seed; it does not move the existing one. The step flow depends on `probeWanted`,
  // which the register preflight computes, so hoisting the whole seed was never available.
  const identity = at('state: "running", lane: "knockout",');
  const fullSeed = at("const STEPS = ctx.koSteps = koSteps({ registerProbe: probeWanted });");
  assert.ok(identity < fullSeed, "identity first");
  assert.ok(at("const refusal = countPreflight({") < fullSeed,
    "and the full seed still follows the preflight that computes its steps");
});
