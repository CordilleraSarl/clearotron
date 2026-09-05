// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-assertions.test.mjs — pins the E2E suite's own assertion engine.
//
// Why this file exists: scripts/e2e.mjs shipped with no tests and no exports, so the one part that
// decides whether a paid run PASSED was the only part nobody could check. That is worse than an
// untested stage: a stage that mis-reads an artifact fails loudly, while an assertion op that
// mis-reads one reports PASS while doing it. Two ops encode real findings and both are pinned here.
//
// FIXTURES ARE REAL. Every shape below was lifted from an artifact an actual run wrote — the degraded
// jx fold from an E2E-R1 run and the handoff status from an E2E-R3 run, both 2026-07-30. Invented
// fixtures are how a test ends up certifying the bug it was written to catch.
//
// The codenames are NOT the real ones: `no-client-identifiers.test.mjs` forbids any <adj>-<noun> pair
// from phase0.mjs's generator vocabulary anywhere in this repo, because such a pair is either a real run
// or indistinguishable from one. `fixture-one`/`fixture-two` are deliberately disjoint from both lists,
// which is the convention that guard's own comment asks for. Nothing here depends on the real names.
// Likewise the healthy-lane variant keeps a field shape verified against a real successful fold but
// carries the E2E scenario's OWN mark, never a production matter.

import { test } from "node:test";
import { pinEnv } from "../../shared/env-aliases.mjs";   // Refs tracker issue 1838 — a fixture pins EVERY spelling
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   // #1336
import { tmpdir } from "node:os";
import { createServer as createTcpServer } from "node:net";   // #1865 — a real closed port
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

import { evalAssertion, investigate, runLedger, secs } from "../../scripts/e2e.mjs";

// ── real artifact shapes ──────────────────────────────────────────────────────────────────────────────

// From an E2E-R1 run, verbatim: the lane was routed and frozen, then the fold degraded because the
// driver env carried no API key. Note `accepted: []` — the run still DELIVERS (never-kill), so nothing
// else in the pipeline reports a problem. This artifact is the only evidence the lane produced nothing.
// PRE-#858, and kept verbatim as such: `lanes.zh.executes` and its origin suffix are no longer minted
// (they asserted at freeze time that slices 2–3 do not exist). Nothing in this file asserts on them.
const JX_DEGRADED = {
  schema: 1,
  lanes: { zh: { depth: "full", executes: "candidates", jurisdictions: ["CN"],
    origin: "profile jxPolicy.laneDepth.zh; depth full accepted but slice 1 EXECUTES candidates only" } },
  scope: ["CN"],
  fold: { executor: "anthropic-completions", foldedAt: "2026-07-30T07:39:18.179Z",
    lanes: { zh: { degraded: true, degradedCause: "ANTHROPIC_API_KEY absent from driver env",
      attempts: 1, degradedAt: "2026-07-30T07:39:18.179Z", accepted: [], refused: [] } } },
};

// Same shape with the fold having succeeded. Field names (qid/term/kind/rationale) and the placement of
// candidates under fold.lanes.<lane>.accepted were both verified against a real successful fold.
const JX_HEALTHY = {
  ...JX_DEGRADED,
  fold: { executor: "anthropic-completions", foldedAt: "2026-07-30T07:39:18.179Z",
    lanes: { zh: { degraded: false, degradedCause: null, attempts: 1, refused: [], accepted: [
      { qid: "jx-zh-维布兰特", term: "维布兰特", kind: "phonetic", rationale: "sound-based rendering of the mark" },
      { qid: "jx-zh-冻莓", term: "冻莓", kind: "semantic", rationale: "frozen-berry reading of the second element" },
    ] } } },
};

// From an E2E-R3 run, the fields that matter: handoff delivery leaves sendPending TRUE and writes
// <runId>.pending. This is the SETTLED terminal state on the test instance, not a hang.
const STATUS_HANDOFF = {
  state: "delivered", verdict: "Medium", sendPending: true,
  runId: "tmpe2er3-project-halcyon-2026-07-30-fixture-two",
};

function withRun(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-assert-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const p = join(dir, rel);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v === null) delete process.env[k]; else pinEnv(process.env, k, v); }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { pinEnv(process.env, k, v); }
  }
}

// ── the jx assertion path (finding 2.1) ───────────────────────────────────────────────────────────────

test("jx candidates live at fold.lanes.zh.accepted — the path R1 asserted (lanes.zh.candidates) is not in the artifact at all", () => {
  withRun({ "_driver/jx-lanes.json": JX_HEALTHY }, (dir) => {
    const good = evalAssertion({ op: "non-empty", path: "_driver/jx-lanes.json:fold.lanes.zh.accepted" }, dir);
    assert.equal(good.ok, true, "the corrected path finds the candidates");

    // The regression this pins: the old path reads `undefined` on a PERFECTLY HEALTHY lane, so the
    // assertion failed every run regardless of whether the lane worked.
    const old = evalAssertion({ op: "non-empty", path: "_driver/jx-lanes.json:lanes.zh.candidates" }, dir);
    assert.equal(old.ok, false, "the old path cannot pass even when the lane succeeded");
  });
});

test("a DEGRADED zh lane is caught: accepted is empty and degraded carries the cause", () => {
  withRun({ "_driver/jx-lanes.json": JX_DEGRADED }, (dir) => {
    assert.equal(evalAssertion({ op: "non-empty", path: "_driver/jx-lanes.json:fold.lanes.zh.accepted" }, dir).ok, false);
    assert.equal(evalAssertion({ op: "falsy", path: "_driver/jx-lanes.json:fold.lanes.zh.degraded" }, dir).ok, false,
      "the degradation reason is present, so `falsy` must fail");
    // And the file-exists assertion passes on a degraded lane — which is why it was never enough alone.
    assert.equal(evalAssertion({ op: "exists", path: "_driver/jx-lanes.json" }, dir).ok, true);
  });
});

// RENAMED at #525 (was: "a HEALTHY zh lane has no degraded key, so the falsy guard passes"). The old
// name described the DEFECT — the lane wrote no key at all — and it stayed green through the fix
// because `falsy` accepts `false` just as happily as absent. A test whose name states the bug it was
// meant to catch is worse than no test: it reads as coverage.
test("a HEALTHY zh lane states degraded:false, and the falsy guard still passes on it", () => {
  withRun({ "_driver/jx-lanes.json": JX_HEALTHY }, (dir) => {
    assert.equal(evalAssertion({ op: "falsy", path: "_driver/jx-lanes.json:fold.lanes.zh.degraded" }, dir).ok, true);
    // and the value really is the stated boolean, not the absence the old name described
    assert.equal(evalAssertion({ op: "equals", value: false, path: "_driver/jx-lanes.json:fold.lanes.zh.degraded" }, dir).ok, true,
      "the healthy lane STATES false — `equals: false` passes, which it could not do on an absent key");
  });
});

test("#525 OPS.falsy CANNOT tell `false` from absent — the assert layer stays blind where the printed line no longer is", () => {
  // Named so nobody reads a green scenario as proof #525 is closed. A scenario asserting `falsy` on
  // fold.lanes.zh.degraded passes on a healthy lane AND on a run whose fold never happened. Moving the
  // scenario to `equals: false` is the fix, and those files live in the config repo — a handover item.
  withRun({ "_driver/jx-lanes.json": JX_HEALTHY }, (dir) => {
    assert.equal(evalAssertion({ op: "falsy", path: "_driver/jx-lanes.json:fold.lanes.zh.degraded" }, dir).ok, true, "stated false ⇒ passes");
  });
  const NO_FOLD = { schema: 1, lanes: { zh: { depth: "candidates", jurisdictions: ["CN"] } }, scope: ["CN"] };
  withRun({ "_driver/jx-lanes.json": NO_FOLD }, (dir) => {
    assert.equal(evalAssertion({ op: "falsy", path: "_driver/jx-lanes.json:fold.lanes.zh.degraded" }, dir).ok, true,
      "AND an absent fold passes the same guard — this is the blindness, pinned deliberately");
    assert.equal(evalAssertion({ op: "equals", value: false, path: "_driver/jx-lanes.json:fold.lanes.zh.degraded" }, dir).ok, false,
      "`equals: false` is the op that tells them apart — it fails here, where `falsy` passed");
  });
});

// ── delivery-settled (finding 2.3) ────────────────────────────────────────────────────────────────────

test("delivery-settled: handoff + an outbox packet is SETTLED (the old `sendPending == false` could never pass on test)", () => {
  withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
    const outbox = mkdtempSync(join(tmpdir(), "e2e-outbox-"));
    try {
      writeFileSync(join(outbox, `${STATUS_HANDOFF.runId}.pending`), "{}");
      withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: outbox }, () => {
        const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
        assert.equal(r.ok, true, r.saw);
        assert.match(r.saw, /packet=/);
      });
      // The literal assertion that used to be here, on the same real artifact:
      withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: outbox }, () => {
        assert.equal(evalAssertion({ op: "equals", path: "status.json:sendPending", value: false }, dir).ok, false,
          "proves the old assertion failed a correctly-delivered run");
      });
    } finally { rmSync(outbox, { recursive: true, force: true }); }
  });
});

test("delivery-settled: handoff with NO packet written FAILS — strictly more than the boolean ever checked", () => {
  withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
    const outbox = mkdtempSync(join(tmpdir(), "e2e-outbox-"));
    try {
      withEnv({ CLEAROTRON_DELIVERY: "handoff", CLEAROTRON_OUTBOX_DIR: outbox }, () => {
        const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
        assert.equal(r.ok, false);
        assert.match(r.saw, /NONE WRITTEN/);
      });
    } finally { rmSync(outbox, { recursive: true, force: true }); }
  });
});

// #1014 — THIS ARM ASSERTED THE OTHER MODE AND IS INVERTED, not deleted. It used to set
// `CLEAROTRON_DELIVERY=email` and require `sendPending === false`, because under a mode that sent directly
// a run still marked pending had genuinely not been delivered. There is no such mode: the variable is
// retired and the assertion no longer reads it, so a stale value in a harness environment must not be
// able to steer the check. That is worth an arm of its own — the old code would have taken the
// send-directly branch on ANY value that was not "handoff", and an unset variable defaulted to "email".
test("delivery-settled: a retired delivery variable in the environment cannot steer the assertion", () => {
  const ob = mkdtempSync(join(tmpdir(), "e2e-outbox-"));
  try {
    withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
      writeFileSync(join(ob, `${STATUS_HANDOFF.runId}.pending`), "agent\n");
      // Every one of these used to select the send-directly branch. All three must now read the SAME
      // contract: pending, with a packet on disk.
      for (const stale of ["email", "stage", "anything-at-all"]) {
        withEnv({ CLEAROTRON_DELIVERY: stale, CLEAROTRON_OUTBOX_DIR: ob }, () => {
          const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
          assert.equal(r.ok, true, `a stale CLEAROTRON_DELIVERY=${stale} changed the verdict: ${r.saw}`);
          assert.match(r.saw, /mode=handoff/, "and the reported mode is the only one there is");
        });
      }
    });
    // TEETH, unchanged in substance: pending with NOTHING in the outbox is still the delivery defect.
    withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
      rmSync(join(ob, `${STATUS_HANDOFF.runId}.pending`), { force: true });
      withEnv({ CLEAROTRON_DELIVERY: "email", CLEAROTRON_OUTBOX_DIR: ob }, () => {
        const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
        assert.equal(r.ok, false, "still pending with no packet is a real failure whatever the environment says");
        assert.match(r.saw, /NONE WRITTEN/);
      });
    });
  } finally { rmSync(ob, { recursive: true, force: true }); }
});

// ── the wildcard/exact plan defect (F1) ───────────────────────────────────────────────────────────────

test("no-wildcard-exact-pair catches the F1 shape and passes a correctly compiled plan", () => {
  const bad = { entries: [{ qid: "primary-sweep:exact:tiki#2", predicate: "exact", term: "TIKI*" }] };
  withRun({ "_driver/register-plan.json": bad }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false);
    assert.match(r.saw, /TIKI\*/);
  });
  const good = { entries: [
    { qid: "primary-sweep:wildcard:vibrant", predicate: "wildcard", term: "VIBRANT*" },
    { qid: "primary-sweep:exact:vibrante", predicate: "exact", term: "VIBRANTE" },
  ] };
  withRun({ "_driver/register-plan.json": good }, (dir) => {
    assert.equal(evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir).ok, true);
  });
});

// ── #324: the same op, made lane-aware ────────────────────────────────────────────────────────────────
//
// The knockout lane freezes no register plan, so the check above reported `[FAIL] register-plan.json
// absent` on EVERY knockout run — a tripwire that is red every day is one nobody reads. It now declines
// on that lane and says why. NOT PROBED is a third state, not a pass, and these tests exist to keep it
// from decaying into one.
//
// The policy fixtures carry the SHAPE of a real frozen sidecar (schema/level/pipeline/components), read
// off a delivered knockout-register run. Marks and codenames are the suite's neutral fixtures, per this
// file's header.
const POLICY_KNOCKOUT = {
  schema: 1, level: "knockout-search", pipeline: "knockout", stageLabel: "Knockout search",
  components: { registerProbe: true, jxLanes: false, commonLawGrid: false },
  recipe: null, extras: null, origins: { level: "job.product" }, caseLaw: false,
};
const POLICY_CLEARANCE = {
  schema: 1, level: "global-preliminary-search", pipeline: "clearance", stageLabel: "Depth 4",
  components: { registerProbe: false, jxLanes: false, commonLawGrid: true },
  recipe: null, extras: null, origins: { level: "job.product" }, caseLaw: false,
};

test("#324: on the knockout lane an absent register plan is NOT PROBED with its reason — and notProbed is not ok-by-another-name", () => {
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.notProbed, true, "the third state is set, so cmdReport can print it as its own thing");
    assert.match(r.saw, /NOT PROBED/, "the reader is told nothing was examined");
    assert.match(r.saw, /not a pass/i, "and told that is not a pass");
    assert.match(r.saw, /count of the mark string/, "and told WHY this lane can never mispair a wildcard");
  });
});

test("#324: on the clearance lane an absent register plan is still a FAIL — there the missing plan IS the defect", () => {
  withRun({ "_driver/search-policy.json": POLICY_CLEARANCE }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false);
    assert.ok(!r.notProbed, "not-probed must never reach a lane that writes the file");
    assert.match(r.saw, /clearance lane/);
  });
});

test("#324: an unreadable lane FAILS — 'cannot tell which lane ran' is an absence, and an absence is a finding", () => {
  // No sidecar at all: the shape that would let "missing ⇒ not probed" generalise to every lane.
  withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false);
    assert.ok(!r.notProbed, "an unknown lane must never be reported as not-probed");
  });
  // Present but naming no pipeline — the same question, unanswered a different way.
  withRun({ "_driver/search-policy.json": { schema: 1, level: "knockout-search" } }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false);
    assert.ok(!r.notProbed);
  });
});

test("#324: the short circuit is (knockout AND absent), never the lane alone — a knockout that DID write a plan is read normally", () => {
  const bad = { entries: [{ qid: "primary-sweep:exact:fixture#2", predicate: "exact", term: "FIXTURE*" }] };
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "_driver/register-plan.json": bad }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false, "the defect is still caught on the knockout lane when the artifact exists");
    assert.ok(!r.notProbed, "the lane may not switch the check off");
    assert.match(r.saw, /FIXTURE\*/);
  });
});

test("#324: an unparseable plan is a FAIL on the knockout lane too — present-but-broken is not absent", () => {
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "_driver/register-plan.json": "{not json" }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false);
    assert.ok(!r.notProbed);
    assert.match(r.saw, /unparseable/);
  });
});

// "Provably never writes the file" is a claim about SOURCE, so it is checked against source. If a future
// knockout stage starts freezing a register plan, the not-probed branch becomes a lie — and this is the
// test that says so, rather than a comment that used to be true.
test("#324: the knockout lane provably writes no register-plan.json — the premise of the not-probed branch", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["pipeline-knockout.mjs", "stages-knockout.mjs", "publish/knockout.mjs"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /register-plan\.json/,
      `${f} now references register-plan.json — if this lane writes one, the NOT PROBED branch in `
      + `scripts/e2e.mjs is asserting something false and must be removed`);
  }
});

// ── #324 fix 3: the report asserts nothing it did not examine ─────────────────────────────────────────

test("#324: names-configured-depth passes a surface naming the configured depth and fails one naming another", () => {
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "status.json": { ...STATUS_HANDOFF, stageLabel: "Knockout search" } }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "status.json" }, dir);
    assert.equal(r.ok, true, r.saw);
    assert.match(r.saw, /Knockout search/);
  });
  // The failure with teeth: a knockout run whose surface names a different product. Observed on a real
  // run whose frame prose opened with the wrong rung while the sidecar and status agreed on another.
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "knockout-frame.md": "A Global preliminary search of one instructed mark." }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "knockout-frame.md" }, dir);
    assert.equal(r.ok, false);
    assert.match(r.saw, /names Global preliminary search while the run was configured as Knockout search/);
  });
});

// #463 — THE OP READS THE FIELD THE DOCUMENT PRINTS.
//
// Both halves of this op derived from `.stageLabel` while every renderer moved to `.identity`
// (render.mjs, render-knockout.mjs). For the four orderable products the two are equal, so the op
// passed — but only because search-policy.test.mjs asserts that equality for orderable rows, in another
// file. On a RETIRED row they diverge, and the op reported "names no search at all" against a document
// naming its product exactly right. That is the tautology shape: the op derived its expectation from the
// field it was not checking, so it would have gone on passing if a renderer went back to the internal
// face.
//
// The retired rows are also where product names NEST — "Knockout review with register hit-counts"
// contains "Knockout review" — which the rung numbers never did. A document naming the longer product
// must not read as naming two.
const POLICY_RETIRED_KO = { ...POLICY_KNOCKOUT, level: "knockout", stageLabel: "Depth 1" };
const POLICY_RETIRED_KOREG = { ...POLICY_KNOCKOUT, level: "knockout-register", stageLabel: "Depth 2" };

test("#463: names-configured-depth checks the name the renderers print, on a retired row too", () => {
  // The line the knockout renderer actually emits for this level — `.identity`, no rung (#463).
  withRun({ "_driver/search-policy.json": POLICY_RETIRED_KO, "report.html": "<b>Knockout review</b> — screens each name" }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "report.html" }, dir);
    assert.equal(r.ok, true, r.saw);
    assert.match(r.saw, /names Knockout review, and no other search/);
  });
  // A retired row whose surface names the CURRENT product instead is still caught — the teeth stay.
  withRun({ "_driver/search-policy.json": POLICY_RETIRED_KO, "report.html": "<b>Knockout search</b> — screens each name" }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "report.html" }, dir);
    assert.equal(r.ok, false);
    assert.match(r.saw, /names Knockout search while the run was configured as Knockout review/);
  });
});

test("#463: a product name that CONTAINS another product's name is one search, not two", () => {
  withRun({ "_driver/search-policy.json": POLICY_RETIRED_KOREG,
            "report.html": "<b>Knockout review with register hit-counts</b> — screens each name" }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "report.html" }, dir);
    assert.equal(r.ok, true, r.saw);
    assert.match(r.saw, /names Knockout review with register hit-counts, and no other search/);
  });
  // And the containment rule does not swallow a real second product: the shorter name standing ALONE,
  // beside the longer one, is a genuine second search and must still fail.
  withRun({ "_driver/search-policy.json": POLICY_RETIRED_KOREG,
            "report.html": "<b>Knockout review with register hit-counts</b>. Compare a Full country search." }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "report.html" }, dir);
    assert.equal(r.ok, false);
    assert.match(r.saw, /names Full country search while the run was configured as Knockout review with register hit-counts/);
  });
});

test("#324: names-configured-depth fails a surface that names no depth, and fails when the depth is unreadable", () => {
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "knockout-assessment.md": "PROJECT HALCYON is rated Medium (low) for Classes 9 and 41." }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "knockout-assessment.md" }, dir);
    assert.equal(r.ok, false, "silence is not transparency — a surface that never says which depth ran cannot be checked");
  });
  withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
    const r = evalAssertion({ op: "names-configured-depth", path: "status.json" }, dir);
    assert.equal(r.ok, false, "no sidecar ⇒ the configured depth is unreadable ⇒ a finding");
  });
});

test("#324: register-claims-within-counts allows a count and a labelled expectation, and refuses a swept or crowded register", () => {
  // Both sentences are REAL, from a delivered knockout-register run: the standing caveat and the
  // register estimate, the latter self-labelled as an expectation.
  const honest = "Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.\n"
    + "Register search pending — a moderate to substantial volume of coexisting filings should be expected. This is an expectation only, not a search result.\n"
    + "Register filings (class 9): 0 identical, 0 containing.";
  withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "knockout-assessment.md": honest }, (dir) => {
    const r = evalAssertion({ op: "register-claims-within-counts", path: "knockout-assessment.md" }, dir);
    assert.equal(r.ok, true, r.saw);
  });
  for (const claim of [
    "No conflicting registrations were identified on the register.",
    "The register is crowded with formative filings for this element.",
    "A register search found nothing of concern.",
  ]) {
    withRun({ "_driver/search-policy.json": POLICY_KNOCKOUT, "knockout-assessment.md": claim }, (dir) => {
      const r = evalAssertion({ op: "register-claims-within-counts", path: "knockout-assessment.md" }, dir);
      assert.equal(r.ok, false, `a count lane may not assert: ${claim}`);
    });
  }
});

test("#324: register-claims-within-counts declines on a lane that enumerates, and FAILS when the lane is unreadable", () => {
  withRun({ "_driver/search-policy.json": POLICY_CLEARANCE, "report.md": "The register is crowded." }, (dir) => {
    const r = evalAssertion({ op: "register-claims-within-counts", path: "report.md" }, dir);
    assert.equal(r.notProbed, true, "enumerated language is supported where the lane enumerates");
    assert.match(r.saw, /NOT PROBED/);
  });
  withRun({ "knockout-assessment.md": "The register is crowded." }, (dir) => {
    const r = evalAssertion({ op: "register-claims-within-counts", path: "knockout-assessment.md" }, dir);
    assert.equal(r.ok, false);
    assert.ok(!r.notProbed, "an unreadable configuration is a finding, never a reason to decline");
  });
});

test("#324: survivor-not-clear catches a clear verdict and leaves correct comparative prose alone", () => {
  // Real prose from two delivered knockout runs. Neither ends a matter, and both contain words a blunt
  // /\bclear\b/ would have flagged — a noise generator on a client deliverable gets read once, then never.
  const fine = "PROJECT HALCYON rates Medium (low), driven by Classes 9 and 42, with the remaining classes reading materially clearer.\n"
    + "The knockout screen surfaced no prominent brand or exact-name commercial use that would read as an obvious blocker in the client's channels.";
  withRun({ "knockout-assessment.md": fine }, (dir) => {
    const r = evalAssertion({ op: "survivor-not-clear", path: "knockout-assessment.md" }, dir);
    assert.equal(r.ok, true, r.saw);
  });
  for (const verdict of [
    "PROJECT HALCYON is clear for Classes 9 and 41.",
    "The mark reads as clean across the searched classes.",
    "No conflicts were found.",
    "The name is clear to proceed.",
  ]) {
    withRun({ "knockout-assessment.md": verdict }, (dir) => {
      const r = evalAssertion({ op: "survivor-not-clear", path: "knockout-assessment.md" }, dir);
      assert.equal(r.ok, false, `a survivor is not a clear: ${verdict}`);
      assert.match(r.saw, /not knocked out at the configured depth/);
    });
  }
});

// The suite's own report must be able to SHOW the third state. Wiring, not behaviour: a notProbed result
// that cmdReport prints as `[ ok ]` would be exactly the silent pass this issue exists to remove.
test("#324: cmdReport prints NOT PROBED as its own state, keeps it out of INVESTIGATE, and never lets it close as a clean sweep", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  assert.match(src, /r\.notProbed \? "n\/p " : r\.ok \? " ok " : "FAIL"/, "three print states, and not-probed is not ok");
  assert.match(src, /if \(r\.notProbed\) notProbed\.push/, "not-probed is collected");
  assert.match(src, /else if \(!r\.ok\) \{ failures\+\+; toInvestigate\.push/,
    "and is NOT counted as a failure — a check that could not apply is not a defect");
  assert.match(src, /NOT PROBED IS NOT A PASS/, "the report says so in words");
  assert.match(src, /Nothing FLAGGED\$\{notProbed\.length \? ` — of the checks that RAN/,
    "and 'Nothing FLAGGED' can never be the last word about a check that declined to look");
});

// ── the no-silent-pass doctrine ───────────────────────────────────────────────────────────────────────

test("an unknown op is reported UNIMPLEMENTED and never passes by omission", () => {
  withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
    const r = evalAssertion({ op: "op-nobody-wrote", path: "status.json" }, dir);
    assert.equal(r.ok, false);
    assert.equal(r.unimplemented, true);
  });
});

test("a missing artifact fails rather than passing vacuously", () => {
  withRun({ "status.json": STATUS_HANDOFF }, (dir) => {
    assert.equal(evalAssertion({ op: "no-permission-prose", path: "report.md" }, dir).ok, false,
      "this is the R3 shape: the knockout lane writes no report.md, and 'absent' must not read as clean");
  });
});

// ── the run ledger: report what happened, never grade it ──────────────────────────────────────────────
//
// `no-stage-retried` used to assert here and is gone. It read run.jsonl, where attempts are not recorded
// (the knockout lane writes no stage events there at all), so it printed "every stage first-attempt" for
// a run that had retried. Reading the right file would not have saved it: the retry observed 2026-07-30
// was a validator rejecting a banned tone word and the retry coming back clean — a guard WORKING. As a
// boolean that correct self-correction reads as failure. So retries are FACTS the ledger reports, with
// their cause and duration, and a reader judges. Shapes below are real.

const RETRY_FAIL = 'invalid_file:prelim-search/tmpe2er3-project-halcyon/2026-07-30-fixture-two/_driver/'
  + 'knockout-assess-0.json:mark "PROJECT HALCYON": banned tone "Massive" — measured tone only (the band colour carries urgency)';

test("investigate SHOUTS a retry and keeps the cause, which lives at the END of a driver failure string", () => {
  const flags = investigate({
    st: { state: "delivered" },
    attempts: [
      { stage: "knockout-frame", attempt: 1, wall: 53, fail: null },
      { stage: "knockout-assess#0", attempt: 1, wall: 146, fail: RETRY_FAIL },
      { stage: "knockout-assess#0", attempt: 2, wall: 199, fail: null },
    ],
    degraded: [],
  });
  assert.equal(flags.length, 1);
  assert.match(flags[0], /knockout-assess#0 retried \(attempt 2\)/);
  assert.match(flags[0], /banned tone "Massive"/, "a head-truncate would have dropped the only useful part");
});

test("a wall-clock kill whose retry was FASTER is flagged as a stall, not as too little time", () => {
  const flags = investigate({
    st: { state: "delivered" },
    attempts: [
      { stage: "register-unit:primary-sweep", attempt: 1, wall: 1560, code: 137, signals: { hardWall: true }, fail: "timeout" },
      { stage: "register-unit:primary-sweep", attempt: 2, wall: 369, fail: null },
    ],
    degraded: [],
  });
  assert.match(flags[0], /killed at its 26m00s wall/);
  assert.match(flags[0], /reads as a stall/, "26 min killed vs 6 min succeeded is the signal worth naming");
});

// ── post-merge audit 2 (a): the retry-cause lookup searches BACKWARDS from the retry row ────────────
// Rows VERBATIM (fields the ledger reads) from a real run's _driver/synthesis.jsonl: an earlier
// round's clean attempt-1, the 137/hardWall kill, its retry — and the warm resume's FRESH attempt-1
// appended AFTER the retry. A forward first-match resolved "previous attempt" to the FIRST attempt-1
// row (the shadowing ok), printed "cause not recorded on the previous attempt" over a recorded kill,
// and the 137/hardWall heuristic never fired on the very run that motivated it.
const SYNTHESIS_ROWS = [
  { stage: "synthesis", attempt: 1, wall: 1517.457, fail: null, model: "opus", status: "ok", code: 0, signals: {}, usage: { total: 10294713 } },
  { stage: "synthesis", attempt: 1, wall: 1560.578, fail: "timeout", model: "opus", status: "timeout", code: 137, signals: { hardWall: true }, usage: null },
  { stage: "synthesis", attempt: 2, wall: 1710.025, fail: null, model: "opus", status: "ok", code: 0, signals: {}, usage: { total: 10616714 } },
  { stage: "synthesis", attempt: 1, wall: 969.313, fail: null, model: "opus", status: "ok", code: 0, signals: {}, usage: { total: 1975970 } },
];

test("audit 2 (a): shadowing attempt-1 rows — the NEAREST PRIOR row carries the cause and the 137/hardWall heuristic fires with the wall time", () => {
  const flags = investigate({ st: { state: "delivered" }, attempts: SYNTHESIS_ROWS, degraded: [] });
  assert.equal(flags.length, 1);
  assert.match(flags[0], /synthesis retried \(attempt 2\) — killed at its 26m01s wall/,
    "the kill row is the nearest prior attempt-1, never the first-match shadowing ok row");
  assert.ok(!/cause not recorded/.test(flags[0]), "a recorded kill must never read as an unrecorded cause");
  assert.ok(!/reads as a stall/.test(flags[0]), "this retry took LONGER than the killed attempt — no stall claim");
});

test("audit 2 (a): the stall sub-clause still fires through the shadowing shape when the retry was faster", () => {
  const rows = SYNTHESIS_ROWS.map((r) => (r.attempt === 2 ? { ...r, wall: 369 } : r));
  const flags = investigate({ st: { state: "delivered" }, attempts: rows, degraded: [] });
  assert.match(flags[0], /killed at its 26m01s wall, but the retry took only 6m09s — reads as a stall/);
});

test("a degraded lane and a non-delivered terminal state are each flagged", () => {
  const flags = investigate({
    st: { state: "failed", failedStage: "knockout-frame", reason: "status_overloaded" },
    attempts: [{ stage: "knockout-frame", attempt: 1, wall: 206, fail: "status_overloaded" }],
    // rows now name their own KIND — units degrade for different reasons than lanes do, so the
    // "lane degraded —" prefix investigate() used to hardcode would mislabel every unit row (#525)
    degraded: ['lane zh: ANTHROPIC_API_KEY absent from driver env (accepted 0)'],
  });
  assert.ok(flags.some((f) => /degraded — lane zh/.test(f)));
  assert.ok(flags.some((f) => /terminal state is "failed" at knockout-frame/.test(f)));
});

test("#525 the ledger prints the CAUSE, never the boolean — for lanes and for units", () => {
  // THE SILENT TRAP. runLedger interpolated `row.degraded` directly. With `degraded` now the boolean,
  // leaving it would print "zh: true": no exception, no failing test, and the cause gone from the E2E
  // ledger entirely — the one place an investigator looks to find out what broke.
  withRun({
    "_driver/jx-lanes.json": JX_DEGRADED,
    "_driver/jx/units.json": { schema: 1, units: {
      "serp-grid:zh": { degraded: true, degradedCause: "63/63 cells gapped — below the coverage floor; a resume retries. Dominant cause (63/63): SERPAPI_API_KEY absent from driver env", attempts: 1 },
      "nativeread:zh": { done: true, degraded: false, degradedCause: null },
    } },
    "status.json": { state: "delivered", startedAt: "2026-08-08T00:00:00Z", deliveredAt: "2026-08-08T00:10:00Z" },
  }, (dir) => {
    const facts = runLedger(dir);
    const line = facts.degraded.join("\n");
    assert.match(line, /ANTHROPIC_API_KEY/, "the lane's cause reaches the ledger");
    assert.ok(!/zh: true/.test(line), "and the boolean never lands where the cause belongs");
    assert.match(line, /unit serp-grid:zh: .*SERPAPI_API_KEY absent/, "the degraded unit is listed with its cause");
    assert.ok(!/nativeread/.test(line), "a HEALTHY unit is not an investigation item — degraded:false pushes nothing");

    const flags = investigate(facts);
    assert.ok(flags.some((f) => /degraded — lane zh: ANTHROPIC_API_KEY/.test(f)), "investigate() surfaces the lane");
    assert.ok(flags.some((f) => /degraded — unit serp-grid:zh: .*SERPAPI_API_KEY absent/.test(f)), "and the unit, under its own name");
  });
});

test("a clean run flags NOTHING — and that is not the same as success", () => {
  const flags = investigate({
    st: { state: "delivered" },
    attempts: [{ stage: "knockout-frame", attempt: 1, wall: 53, fail: null }],
    degraded: [],
  });
  assert.deepEqual(flags, [], "nothing to investigate; the caller still must not print PASS");
});

test("ZERO attempt records is flagged — an empty ledger cannot describe a run", () => {
  const flags = investigate({ st: { state: "delivered" }, attempts: [], degraded: [] });
  assert.match(flags[0], /cannot describe this run/);
});

test("secs renders the durations a reader compares at a glance", () => {
  assert.equal(secs(53), "53s");
  assert.equal(secs(1560), "26m00s");
  assert.equal(secs(3852), "1h04m");
  assert.equal(secs(null), "?");
});

// ── refusals: read the queue marker, do not infer from an absent run dir ───────────────────────────────
//
// A refusal happens in claimAndPrep, BEFORE a run dir exists, so `findRunsByRef` finds nothing for a case
// that behaved perfectly — and cmdReport counted "no run found" as a failure, which is why R0 could never
// pass. The terminal state IS the marker suffix. These pin the two things I got wrong writing it.

import { queueOutcomes, TERMINAL_BY_SUFFIX, brief } from "../../scripts/e2e.mjs";

function withQueue(files, fn) {
  const q = mkdtempSync(join(tmpdir(), "e2e-queue-"));
  const ob = mkdtempSync(join(tmpdir(), "e2e-ob-"));
  const savedQ = process.env.CLEAROTRON_QUEUE_DIR, savedO = process.env.CLEAROTRON_OUTBOX_DIR;
  try {
    for (const [name, body] of Object.entries(files)) {
      const dir = name.startsWith("outbox/") ? ob : q;
      writeFileSync(join(dir, name.replace(/^outbox\//, "")), typeof body === "string" ? body : JSON.stringify(body));
    }
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", ob);
    return fn(q);
  } finally {
    pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", savedQ);
    pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", savedO);
    rmSync(q, { recursive: true, force: true }); rmSync(ob, { recursive: true, force: true });
  }
}

test("the marker SUFFIX is the terminal state — failed=clarify, duplicate, done=delivered", () => {
  assert.equal(TERMINAL_BY_SUFFIX.failed, "clarify");
  assert.equal(TERMINAL_BY_SUFFIX.duplicate, "duplicate");
  assert.equal(TERMINAL_BY_SUFFIX.done, "delivered");
});

test("queueOutcomes matches by PREFIX and returns EVERY door — an exact match finds nothing", () => {
  // `run` appends the door to the ref for a multi-door case. Matching E2E-R0a exactly would miss both of
  // these, and returning only the first would hide the other door, which is the entire point of R0.
  //
  // #428 — THE FIXTURE IS UNCHANGED, and the second door's answer moved instead. `opsmcp-ms1.failed` has
  // no sidecar beside it, and `.failed` means "refused at intake" when no run started and "the run broke"
  // when one did. The harness now says UNDETERMINED for that rather than picking the intake reading, so
  // this row reads `undetermined`. Inventing an `opsmcp-ms1.failed.reason` to keep the old word would be
  // editing the evidence to match the check — the exact move this issue exists to stop.
  withQueue({
    "cli-ms0.failed": { id: "cli-ms0", ref: "E2E-R0a-cli" },
    "cli-ms0.failed.reason": "resolved no routing territory\nnotify: packet intake-cli-ms0.failed.pending\n",
    "opsmcp-ms1.failed": { id: "opsmcp-ms1", ref: "E2E-R0a-opsmcp" },
    "outbox/intake-cli-ms0.failed.pending": { kind: "intake-rejected" },
  }, (q) => {
    const rows = queueOutcomes("E2E-R0a", q);
    assert.equal(rows.length, 2, "both doors must come back");
    assert.deepEqual(rows.map((r) => r.ref).sort(), ["E2E-R0a-cli", "E2E-R0a-opsmcp"]);
    assert.equal(queueOutcomes("E2E-R0a-cli", q).length, 1, "a more specific prefix narrows correctly");
    assert.equal(queueOutcomes("E2E-R9z", q).length, 0, "an unknown ref matches nothing");
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
    assert.equal(byRef["E2E-R0a-cli"].terminal, "clarify", "the door with a .reason beside it parked at intake");
    assert.equal(byRef["E2E-R0a-opsmcp"].terminal, "undetermined", "the door with no sidecar is not guessed");
    assert.equal(byRef["E2E-R0a-opsmcp"].undetermined, true);
  });
});

test("a refusal reason keeps the rule it fired on, which is what reasonMatches checks", () => {
  const reason = 'a native-script deepening (prelim-jx) resolved no routing territory from ["United States"]';
  assert.ok(reason.toLowerCase().includes("routing territor"), "R0a's reasonMatches must find its own rule");
  assert.equal(brief(reason, 200), reason, "a reason inside the budget is never mangled");
});

// ── dedupe is a SET property across doors, not a per-door one ──────────────────────────────────────────
//
// R0d submits the SAME matter through every door to prove it runs ONCE, and its own note says the first
// submission is expected to ADMIT. Comparing each door against `expect.terminal: "duplicate"` therefore
// flags the admitting door as a defect — a false positive in the one report that has to be trusted.
import { dedupeAcrossDoors } from "../../scripts/e2e.mjs";

// #428 widened the return: `undetermined` and `inFlight` are counted separately, because the old
// `admitted = t !== "duplicate" && t !== "clarify"` counted a job still `.processing`, and a terminal that
// could not be read, as admissions — and two of those under one ref read as "2 doors ADMITTED the same
// matter", an engine defect that never happened. See e2e-state-not-shape.test.mjs.
test("one admission plus one park is CORRECT dedupe, not a defect", () => {
  const d = dedupeAcrossDoors(["delivered", "duplicate"]);
  assert.deepEqual(d, { parked: 1, admitted: 1, undetermined: 0, inFlight: 0, ranMoreThanOnce: false, neverFired: false });
});

test("two admissions means it RAN TWICE — the defect dedupe exists to prevent", () => {
  assert.equal(dedupeAcrossDoors(["delivered", "delivered"]).ranMoreThanOnce, true);
});

test("no park at all means dedupe never fired", () => {
  assert.equal(dedupeAcrossDoors(["delivered"]).neverFired, true);
});

test("a clarify is neither an admission nor a park — a refused door says nothing about dedupe", () => {
  const d = dedupeAcrossDoors(["clarify", "duplicate"]);
  assert.equal(d.admitted, 0);
  assert.equal(d.parked, 1);
  assert.equal(d.ranMoreThanOnce, false);
});

// ── post-merge audit of #172, problem 7: the harness's own rationale must stay TRUE ────────────────────
// The `no-stage-retried` deletion note is the only record of why that assertion is gone, and it opened
// with a mechanical claim — "run.jsonl carries no `attempt` field" — that #172 made false in the very file
// the PR body promised to keep working. A rationale whose stated premise is provably wrong is an invitation
// to re-add the assertion "now that the data is there", which is exactly the wrong conclusion: the reason
// it was deleted is that a retry is a JUDGMENT, not a pass/fail, and that reason did not change.
test("the deleted-assertion rationale in scripts/e2e.mjs does not carry a claim #172 falsified", () => {
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /run\.jsonl carries no `attempt` field/,
    "run.jsonl HAS carried per-dispatch `attempt` rows since #172 — the note must not say otherwise");
  assert.match(src, /SINCE #172[\s\S]{0,400}?not to take that as an invitation|SINCE #172[\s\S]{0,400}?Do not take that as an invitation/,
    "…and it must say so, while keeping the deletion's real reason standing");
  assert.match(src, /A retry is not pass or fail/,
    "the judgment argument is the load-bearing half of the note and must survive the correction");
});

// ── the harness must not break the test it is running ────────────────────────────────────────────────
//
// R0d's whole subject is "the same matter submitted twice runs once". The harness door-suffixes each
// case's ref so it can tell one door's queue marker from another's — and `matterSignature` INCLUDES the
// ref, so that suffix made each door a different matter and the duplicate could never occur. Both doors
// admitted on every run and `report` flagged two INVESTIGATE entries naming an engine defect that was
// entirely the harness's own doing.
//
// The suffix stays for every other case, because attribution is real and R0e in particular REQUIRES it.

import { refForDoor } from "../../scripts/e2e.mjs";

const DOORS2 = ["cli", "ops-mcp"];

test("R0d opts out of the door suffix, so both doors submit ONE matter and dedupe can fire", () => {
  const refs = DOORS2.map((d) => refForDoor("E2E-R0d", d, { doors: DOORS2, oneMatterAcrossDoors: true }));
  assert.deepEqual(refs, ["E2E-R0d", "E2E-R0d"]);
  assert.equal(new Set(refs).size, 1, "matterSignature includes the ref — two refs means two matters means no duplicate");
});

test("every other multi-door case KEEPS the suffix — R0e expects delivered at BOTH doors and a shared ref would park the second", () => {
  const refs = DOORS2.map((d) => refForDoor("E2E-R0e", d, { doors: DOORS2, oneMatterAcrossDoors: false }));
  assert.deepEqual(refs, ["E2E-R0e-cli", "E2E-R0e-opsmcp"]);
  assert.equal(new Set(refs).size, 2, "distinct refs are what let R0e be admitted at both doors");
});

test("a single-door scenario is never suffixed, opted out or not", () => {
  for (const flag of [true, false]) {
    assert.equal(refForDoor("E2E-R2", "client-mcp", { doors: ["client-mcp"], oneMatterAcrossDoors: flag }), "E2E-R2");
  }
});

test("the suffixed ref still prefix-matches the base, which is what queueOutcomes relies on", () => {
  assert.ok(refForDoor("E2E-R0a", "ops-mcp", { doors: DOORS2 }).startsWith("E2E-R0a"));
});

// ── declared and never asked ─────────────────────────────────────────────────────────────────────────
//
// Two keys were written into the scenario files and read by nothing: `expect.artifacts` (six filenames
// each in R1/R2/R3) and case-level `expect.assert`. R0 has no scenario-level asserts at all, so R0 ran
// ZERO assertions and R0e's `profileKey == "generic"` — the entire point of the #83 case — was dead.
// Both are the "absence read as SUCCESS" shape this suite exists to prevent, sitting inside the suite.

const OPS_NAMES = ["equals", "falsy", "exists", "non-empty", "length"];

// The content rules that lived here as tests over the bundled scenario files moved into the harness
// when the bundled suite was deleted (one suite, owner ruling 2026-08-07): `lintScenarios` in
// scripts/e2e.mjs runs them against the REAL store on every list/run, and
// e2e-scenario-store.test.mjs pins each rule through fixtures.

// Guard the wiring itself: cmdReport must read BOTH lists, not just the scenario one.
test("cmdReport evaluates case-level asserts alongside scenario-level ones", () => {
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  assert.match(src, /\[\s*\.\.\.\(s\.expect\?\.assert \?\? \[\]\),\s*\.\.\.\(kase\?\.expect\?\.assert \?\? \[\]\)\s*\]/,
    "the assert loop must consume kase.expect.assert too — R0 has no scenario-level asserts at all");
});

// ── Ordered artifacts live in TWO places, and the scope path was never real (E2E R2, 2026-07-31) ─────

test("the report's artifact lookup searches run dir AND pool AND the runId-prefixed pool name", async () => {
  const src = await import("node:fs").then((m) => m.readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8"));
  const fn = src.slice(src.indexOf("const artifactPresent"), src.indexOf("const missing = (s.expect?.artifacts"));
  assert.ok(/join\(runDir, f\)/.test(fn), "still checks the run dir");
  assert.ok(/join\(poolDir, f\)/.test(fn), "also checks the published pool");
  assert.ok(/\$\{runId\}-\$\{f\}/.test(fn), "and the pool's renamed <runId>-<name> form (the workbook)");
});

test("the run command no longer refuses on a missing acknowledgement flag", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  // The flag may still be MENTIONED — it is accepted and ignored, and a comment explains why — but
  // nothing may branch on it and nothing may exit because of it.
  assert.ok(!/process\.argv\.includes\(\s*["']--yes-i-know-the-cost["']\s*\)/.test(src),
    "no code path may test for the acknowledgement flag");
  assert.ok(!/\bneedsAck\b/.test(src), "the gate is removed, not renamed");
});

test("a measured cost always states a wall, so `run` can never print an empty number", async (t) => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../e2e/", import.meta.url);
  const cases = readdirSync(dir).filter((x) => x.endsWith(".json"));
  // #1010 FOUND THIS: `driver/e2e/` carries a README and no JSON in the product tree, so this loop has
  // been walking an empty set and reporting a green over zero files. A SKIP is not a pass — it is
  // visible in the run and countable — and it is the honest state until the fixtures are here or the
  // guard is retired. Silently iterating nothing is the one option that is not on the table.
  if (cases.length === 0) return t.skip("no e2e case files in driver/e2e/ — this guard has no corpus in this tree");
  for (const f of cases) {
    const c = JSON.parse(readFileSync(new URL(f, dir), "utf8")).cost ?? {};
    if (c.measured) assert.ok(Number(c.wallMinutes) > 0, `${f} claims measured with no wallMinutes`);
  }
});

// ── settled-before-placement / no-attempt-fail-token ──────────────────────────────────────────────
// Both encode the ordering defect the 2026-07-30 run paid 1,436s for. Shapes taken from that run's own
// run.jsonl and register-digest.jsonl; codenames and marks are the suite's neutral fixtures, per the
// no-client-identifiers convention this file's header describes.
const writeRun = (dir, rows) =>
  writeFileSync(driverDir(dir, "run.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

test("settled-before-placement: passes only when the decision precedes placement, and names each way it fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-settled-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const decision = { event: "envelope-decision-early", source: "fan-in", deferred: 3, accepted: 3, closed: 0, close_failed: 0 };
  const placement = { event: "stage", stage: "placement-inquiry", ok: true };

  writeRun(dir, [{ event: "plan-execution", executed: 128 }, decision, placement]);
  assert.equal(evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir).ok, true);

  // the 2026-07-30 shape: placement ran first, the decision came 44 minutes later
  writeRun(dir, [{ event: "plan-execution", executed: 128 }, placement, decision]);
  const late = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir);
  assert.equal(late.ok, false);
  assert.match(late.saw, /BEFORE the decision/);

  // never decided at all — must fail, never read as "nothing to decide"
  writeRun(dir, [{ event: "plan-execution", executed: 128 }, placement]);
  const never = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir);
  assert.equal(never.ok, false);
  assert.match(never.saw, /never decided/);

  // #428 — a scenario that never reaches placement is NOT PROBED, not FAIL. It must still not pass
  // silently, and the third state is what makes that possible: the check declines out loud, is counted
  // and printed under NOT PROBED, and never enters INVESTIGATE. It used to return `ok: false` with a
  // message that said in its own words that the assert did not belong there, which scored an ordering
  // defect against a run that never reached the ordering.
  writeRun(dir, [{ event: "plan-execution", executed: 1 }, decision]);
  const noPlacement = evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir);
  assert.equal(noPlacement.notProbed, true);
  assert.match(noPlacement.saw, /NOT PROBED/);
  assert.match(noPlacement.saw, /never reached the stage/);

  // an absent log is a failure, not an absence of evidence
  rmSync(driverDir(dir, "run.jsonl"));
  assert.equal(evalAssertion({ op: "settled-before-placement", path: "_driver/run.jsonl" }, dir).ok, false);
  rmSync(dir, { recursive: true, force: true });
});

test("no-attempt-fail-token: a stage that logged nothing fails, and a real failed attempt is named", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-token-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const p = driverDir(dir, "register-digest.jsonl");
  const path = "_driver/register-digest.jsonl:coverage_no_status";   // #476 — the live token R1/R2 assert on

  // absent telemetry is the "absence read as success" shape — it must FAIL
  assert.equal(evalAssertion({ op: "no-attempt-fail-token", path }, dir).ok, false);

  writeFileSync(p, [JSON.stringify({ attempt: 1, ok: true, wall: 812 })].join("\n") + "\n");
  assert.equal(evalAssertion({ op: "no-attempt-fail-token", path }, dir).ok, true);

  writeFileSync(p, [
    JSON.stringify({ attempt: 1, fail: "invalid_file:x/register-findings.md:coverage_no_status:no_status=14;CD-A1B2C3D4 [primary-sweep / exact: Q0] (+13 more)" }),
    JSON.stringify({ attempt: 2, ok: true }),
  ].join("\n") + "\n");
  const hit = evalAssertion({ op: "no-attempt-fail-token", path }, dir);
  assert.equal(hit.ok, false);
  assert.match(hit.saw, /attempt 1/, "the reader is told which attempt, not just that something failed");

  // an unrelated failure must not trip this token's assert
  writeFileSync(p, [JSON.stringify({ attempt: 1, fail: "timeout" })].join("\n") + "\n");
  assert.equal(evalAssertion({ op: "no-attempt-fail-token", path }, dir).ok, true);
  rmSync(dir, { recursive: true, force: true });
});

// ── #354 · the run's own stamped URL ──────────────────────────────────────────────────────────────────
//
// R4 delivered with `…/tmpe2er4-arbora-…/report.html` in its meta and its handoff packet, and that URL
// returned 404 on the only instance the suite may run on, while the identical shape worked on prod. The
// suite noticed nothing, because nothing looked. A delivered run reporting a dead address is the
// absence-reads-as-success shape this harness was rebuilt to stop.
import { createServer } from "node:http";
import { probeStampedUrl } from "../../scripts/e2e.mjs";

// A stand-in edge: it answers by PATH, exactly as Caddy's routing table does, and records the Host header
// it was given — which is the whole mechanism, since one loopback listener serves several hostnames.
function edge(routes) {
  return new Promise((ready) => {
    const seen = [];
    const srv = createServer((req, res) => {
      seen.push({ host: req.headers.host, path: req.url, method: req.method });
      res.statusCode = routes[req.url] ?? 404;
      res.end();
    });
    srv.listen(0, "127.0.0.1", () => ready({ srv, seen, origin: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("#354: the probe carries the stamped URL's HOST to the loopback edge, and asks only for headers", async () => {
  const { srv, seen, origin } = await edge({ "/tmpe2er4-arbora/report.html": 401 });
  process.env.CLEAROTRON_EDGE_ORIGIN = origin;
  try {
    const r = await probeStampedUrl("https://test-trademark.example.com/tmpe2er4-arbora/report.html");
    assert.equal(r.status, 401, "401 is the healthy loopback answer: the route resolves, the portal wants a JWT");
    assert.equal(seen[0].host, "test-trademark.example.com",
      "the Host header is the mechanism — one listener serves several hostnames, and the path alone picks the wrong one");
    assert.equal(seen[0].method, "HEAD", "a status is all this asks for; it never downloads a client report");
  } finally { srv.close(); delete process.env.CLEAROTRON_EDGE_ORIGIN; }
});

test("#354: a 404 on the stamped URL is distinguishable from every other answer", async () => {
  const { srv, origin } = await edge({ "/live/report.html": 200 });
  process.env.CLEAROTRON_EDGE_ORIGIN = origin;
  try {
    assert.equal((await probeStampedUrl("https://test-trademark.example.com/live/report.html")).status, 200);
    assert.equal((await probeStampedUrl("https://test-trademark.example.com/dead/report.html")).status, 404,
      "the exact state #354 reports: the route shape does not exist on this host");
  } finally { srv.close(); delete process.env.CLEAROTRON_EDGE_ORIGIN; }
});

test("#354: an unreachable edge is NOT PROBED, never a pass and never a 404", async () => {
  // The distinction is load-bearing. "could not ask" and "asked, and the route is missing" send a reader
  // to two different places, and the harness records, it does not judge.
  const { srv, origin } = await edge({});
  srv.close();
  process.env.CLEAROTRON_EDGE_ORIGIN = origin;
  try {
    const r = await probeStampedUrl("https://test-trademark.example.com/x/report.html");
    assert.equal(r.status, undefined, "no status is claimed");
    assert.ok(r.error, `the reason is carried: ${JSON.stringify(r)}`);
  } finally { delete process.env.CLEAROTRON_EDGE_ORIGIN; }
});

test("#354: an unusable URL says so rather than throwing mid-report", async () => {
  const r = await probeStampedUrl("not a url");
  assert.match(r.error, /unparseable/);
  assert.equal(r.status, undefined);
});

// ── #356 — R0's probes must not leave fake product on the staff surface ──────────────────────────
//
// R0d's first submission MUST admit so the second can be caught as a duplicate, and R0e's expected
// terminal is `delivered`. Admitting means publishing, so every round adds two reports titled
// "E2E … PROBE" to the pool a person reads. Teardown is what removes them — and it used to destroy the
// run directory along with the artifact, which is the evidence the next round reads to say WHY a probe
// behaved as it did. Operator instructions told a human to tar them first; a step that exists only in
// prose is the step skipped on the round where it mattered.
test("#356: preserveRunDir writes a tarball and reports the ENTRY COUNT read back off the archive", async () => {
  const { preserveRunDir } = await import("../../scripts/e2e.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "e2e-preserve-"));
  try {
    const runDir = join(tmp, "tmpe2er0d-e2e-duplicate-probe-2026-01-01-synthetic-probe");
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "delivered" }));
    writeFileSync(driverDir(runDir, "run.jsonl"), '{"event":"start"}\n');
    const ev = join(tmp, "evidence");

    const r = preserveRunDir(runDir, "R0", { evidenceDir: ev, stamp: "20260101T000000" });
    assert.equal(r.ok, true, r.why ?? "");
    assert.ok(existsSync(r.path), "the tarball is on disk");
    // THE LISTING IS THE PROOF. "the file exists" would be satisfied by an empty archive and would
    // satisfy nobody else — the acceptance asks that the tarball prove it is not empty.
    assert.ok(r.entries >= 3, `the archive lists its contents (${r.entries} entries)`);
    assert.match(r.path, /R0-.*-teardown-20260101T000000\.tgz$/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("#356: a preservation that cannot run REPORTS why and never claims success — it is what stops the purge", async () => {
  const { preserveRunDir } = await import("../../scripts/e2e.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "e2e-preserve-fail-"));
  try {
    // a run dir that is not there: tar fails, and the caller must learn that rather than read ok:true
    const r = preserveRunDir(join(tmp, "does-not-exist"), "R0", { evidenceDir: join(tmp, "ev"), stamp: "s" });
    assert.equal(r.ok, false);
    assert.equal(r.entries, 0);
    assert.ok(r.why && r.why.length > 0, "the reason travels with the refusal — a bare false is a silence");
    // and it never throws: a teardown that crashed halfway would leave a partly-purged round with no
    // report of what it managed and what it did not.
    assert.doesNotThrow(() => preserveRunDir(join(tmp, "also-absent"), "R0", { evidenceDir: join(tmp, "ev2"), stamp: "s" }));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ── #508: A DOOR REFUSAL LEAVES NOTHING ON DISK, AND IS NOT NOTHING KNOWN ────────────────────────────
//
// `enqueue` refuses before a queue file is written — earlier than the claimAndPrep refusal, which at
// least leaves `.failed` + `.reason`. So `findRunsByRef` and the marker sweep both come back empty for a
// case that behaved exactly as ordered, and `report` used to call that "nothing can be said about it".
// On R0, seven of nine cases are that shape: a PERFECT R0 printed an INVESTIGATE block that was
// seven-eighths false, which is how a reader learns to skip the block a real finding shows up in.
import { doorRefusal } from "../../scripts/e2e.mjs";

const REFUSED = (reason) => ({
  cases: [{ id: "R0h", ref: "E2E-R0h", agreed: true, answers: [
    { door: "cli", accepted: false, reason }, { door: "ops-mcp", accepted: false, reason }] }],
});

test("#508: every door refused ⇒ the receipt answers, and it names the doors", () => {
  const r = doorRefusal(REFUSED('job rejected — product "prelim-register-only" names no search we offer'), "E2E-R0h",
    { terminal: "clarify", reasonMatches: "no search we offer" });
  assert.deepEqual(r.doors, ["cli", "ops-mcp"]);
  assert.equal(r.reasonRecorded, true);
  assert.deepEqual(r.missed, [], "both doors carry the expected reason");
  assert.equal(r.orderedAdmission, false);
});

test("#508: a refusal for the WRONG reason does not read as the right one", () => {
  // The whole value of recording the reason. Without it these two cases are indistinguishable.
  const r = doorRefusal(REFUSED("job rejected — 9 names exceeds the 8-name limit"), "E2E-R0h",
    { terminal: "clarify", reasonMatches: "no search we offer" });
  assert.deepEqual(r.missed, ["cli", "ops-mcp"], "both doors refused, neither for the ordered reason");
});

test("#508: a receipt with no reason is NOT PROBED, never a pass", () => {
  // Written by an older round. `missed` must stay empty — computing it against nothing would report
  // "every door said the right thing" about a receipt that recorded nothing at all.
  const r = doorRefusal(REFUSED(null), "E2E-R0h", { terminal: "clarify", reasonMatches: "no search we offer" });
  assert.equal(r.reasonRecorded, false);
  assert.deepEqual(r.missed, [], "nothing was compared, so nothing may be claimed either way");
});

test("#508: the receipt settles NOTHING unless every door refused — absence keeps its meaning", () => {
  const mixed = { cases: [{ ref: "E2E-R0d", answers: [
    { door: "cli", accepted: true }, { door: "ops-mcp", accepted: false, reason: "duplicate" }] }] };
  assert.equal(doorRefusal(mixed, "E2E-R0d"), null, "one door admitted — this is the dedupe shape, read from the queue");
  assert.equal(doorRefusal(REFUSED("x"), "E2E-NOSUCH"), null, "no entry for this ref");
  assert.equal(doorRefusal(null, "E2E-R0h"), null, "no receipt at all");
  assert.equal(doorRefusal({ cases: [{ ref: "E2E-R0h", answers: [] }] }, "E2E-R0h"), null, "an entry recording no doors");
});

test("#508: ordering an ADMISSION and getting a refusal is still a defect, however cleanly it reads", () => {
  const r = doorRefusal(REFUSED("job rejected — something"), "E2E-R0h", { terminal: "delivered" });
  assert.equal(r.orderedAdmission, true);
  for (const want of ["clarify", "reject", "refused", "duplicate"])
    assert.equal(doorRefusal(REFUSED("x"), "E2E-R0h", { terminal: want }).orderedAdmission, false, want);
});

// ── absent (#519's config half) ───────────────────────────────────────────────────────────────────────
// The one op where a missing file is PASS, because absence is the asserted contract: an enforced
// never-produce (a case-law artifact on a non-Full-country run). Everywhere else absence stays a
// failure; these pins hold both directions so the op can never drift into a general missing-file pass.

test("absent: a file that does not exist is the asserted state, and says so", () => {
  withRun({ "status.json": { runId: "x" } }, (dir) => {
    const r = evalAssertion({ op: "absent", path: "case-law-findings.md" }, dir);
    assert.equal(r.ok, true);
    assert.match(r.saw, /absent/, "the pass names the absence rather than passing silently");
  });
});

test("absent: a file that exists FAILS, with its size on the row", () => {
  withRun({ "case-law-findings.md": "ten kilobytes of findings the product does not carry" }, (dir) => {
    const r = evalAssertion({ op: "absent", path: "case-law-findings.md" }, dir);
    assert.equal(r.ok, false, "presence is the defect this op exists to name");
    assert.match(r.saw, /present/, "the failure names what it saw");
  });
});

test("absent: field ops on a missing file still FAIL — the op does not leak absence-as-pass sideways", () => {
  withRun({ "status.json": { runId: "x" } }, (dir) => {
    assert.equal(evalAssertion({ op: "falsy", path: "case-law-findings.md:anything" }, dir).ok, false,
      "a field op on an absent file reports the absence as failure, unchanged");
    assert.equal(evalAssertion({ op: "exists", path: "case-law-findings.md" }, dir).ok, false);
  });
});

// ── #516: the op that watched two label rows and reported "none mispaired" ─────────────────────────
//
// R2b's plan carried 145 rows, two of them the common-law sweep's own section headings under
// `predicate=default`. This assertion ran over it and reported `144 entries, none mispaired` — true of
// the wildcard/exact pairing it was looking at, and worthless. The op is WIDENED rather than renamed:
// scenario files live in the config repo, so a renamed op is never invoked and the check ships inert,
// green while examining nothing — the same failure it committed.
test("#516 the op reports the label row a wildcard/exact check cannot see", () => {
  const incident = { entries: [
    { qid: "primary-sweep:default:core-bioveltrin", predicate: "default", term: "**Core (BIOVELTRIN, BIO VELTRIN, BIO-VELTRIN, etc.)**" },
    { qid: "primary-sweep:default:formative-root", predicate: "default", term: "**Formative root (VELTRIN, DELPHIN, DELPHINUS, etc.)**" },
    { qid: "primary-sweep:exact:bioveltrin", predicate: "exact", term: "BIOVELTRIN" },
  ] };
  withRun({ "_driver/register-plan.json": incident }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false, "the run that died at fan-in must not be reported as a clean plan");
    assert.match(r.saw, /2 un-dispatchable plan row\(s\)/);
    assert.match(r.saw, /\*\*Core \(BIOVELTRIN/, "and the row is named");
  });
});

test("#516 a parenthesised OWNER row still passes — the harness inherits the binding trap's answer too", () => {
  // The op imports the driver's own screen rather than restating a rule here, so `predicate:"owner"`
  // stays exempt in both places by construction. A bracket rule would report the register lane broken
  // on every run that cross-checks a company name.
  const owners = { entries: [
    { qid: "primary-sweep:owner:delphi", predicate: "owner", term: "Delphi Technologies (BorgWarner Inc.)" },
    { qid: "primary-sweep:exact:bioveltrin", predicate: "exact", term: "BIOVELTRIN" },
    { qid: "primary-sweep:exact:slogan", predicate: "exact", term: "I CAN'T BELIEVE IT'S NOT BUTTER", term_literal: true },
  ] };
  withRun({ "_driver/register-plan.json": owners }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, true);
    assert.match(r.saw, /3 entries, none mispaired and none label\/markup-shaped/);
  });
  // …and the F1 shape it was originally written for is still caught, with its reason distinguishable.
  withRun({ "_driver/register-plan.json": { entries: [{ qid: "q", predicate: "exact", term: "TIKI*" }] } }, (dir) => {
    const r = evalAssertion({ op: "no-wildcard-exact-pair", path: "_driver/register-plan.json" }, dir);
    assert.equal(r.ok, false);
    assert.match(r.saw, /wildcard under exact/);
  });
});

// ── #757: THE 429 THAT INDICTED THE DOOR THAT BEHAVED ───────────────────────────────────────────────
//
// Round finding F1, 2026-08-12, R0e anthropic arm. The `cli` door accepted; the `ops-mcp` door answered
// `MCP initialize refused (429): ops principal rate limit exceeded`. The #98 asymmetry rule fired and
// named the CLI — the door that behaved — as the defect, because the ops door never reached the scope
// question and a bare `.ok` comparison cannot tell "refused this job" from "never saw this job".
{
  const { doorAnswerClass, doorAsymmetry, DOOR_ANSWER } = await import("../../scripts/e2e.mjs");

  const cliAccepted = { door: "cli", ok: true, out: "queued" };
  const ops429 = { door: "ops-mcp", ok: false, status: 429, transport: true,
    out: "MCP initialize refused (429): ops principal rate limit exceeded — retry shortly" };

  test("#757 R0e reproduced: a 429 on one of two doors is NOT a disagreement", () => {
    const v = doorAsymmetry([cliAccepted, ops429]);
    assert.equal(doorAnswerClass(ops429), DOOR_ANSWER.INFRA_UNAVAILABLE);
    assert.equal(v.agreed, true,
      "the ops door never reached the scope question, so it holds no opinion to disagree with — "
      + "reporting this as a disagreement blames the only door that did its job");
    assert.equal(v.compared.length, 1);
    assert.equal(v.reducedCoverage, true, "and it is never silent: the case lost a door");
  });

  test("#757 the exclusion does NOT extend to a door that actually judged the case", () => {
    const opsScopeRefusal = { door: "ops-mcp", ok: false, status: 400, transport: true,
      out: "start_run refused: mark is outside the product scope for this customer" };
    assert.equal(doorAnswerClass(opsScopeRefusal), DOOR_ANSWER.ANSWERED,
      "a 400 is the service DECIDING something — that is the judgment the comparison exists to compare");
    const v = doorAsymmetry([cliAccepted, opsScopeRefusal]);
    assert.equal(v.agreed, false, "#98 must still fire here — this is the case the rule was written for");
    assert.equal(v.reducedCoverage, false);
  });

  test("#757 5xx is infrastructure; 4xx other than 429 is an answer", () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(doorAnswerClass({ door: "ops-mcp", ok: false, status, transport: true }),
        DOOR_ANSWER.INFRA_UNAVAILABLE, `${status} is the door dying, not deciding`);
    }
    for (const status of [400, 401, 403, 404, 409, 422]) {
      assert.equal(doorAnswerClass({ door: "ops-mcp", ok: false, status, transport: true }),
        DOOR_ANSWER.ANSWERED,
        `${status} must stay in the comparison — a rule that excuses every refusal it cannot classify is worth nothing`);
    }
  });

  test("#757 BOTH doors lost to infrastructure is not a silent pass", () => {
    const v = doorAsymmetry([{ door: "cli", ok: false, status: 503, transport: true }, ops429]);
    assert.equal(v.compared.length, 0);
    assert.equal(v.agreed, true, "zero opinions cannot disagree");
    assert.equal(v.reducedCoverage, true,
      "but the case proved NOTHING about the doors, and reducedCoverage is the only thing that says so");
  });

  test("#757 a product refusal both doors make still reads as agreement", () => {
    const v = doorAsymmetry([
      { door: "cli", ok: false, status: null, out: "refused: out of scope" },
      { door: "ops-mcp", ok: false, status: 400, transport: true, out: "refused: out of scope" },
    ]);
    assert.equal(v.agreed, true);
    assert.equal(v.reducedCoverage, false, "nothing was lost here — both doors judged the case");
  });

  // ── #1865: A DOOR THAT IS NOT CONFIGURED WAS NEVER ASKED ────────────────────────────────────────
  //
  // R0, 2026-08-25, rebuilt box. The MCP face is not installed, so every ops-MCP submission answered
  // `no TRADEMARK_MCP_HTTP_PORT in scope`. That is the harness saying it could not reach the door, and
  // it was recorded as a verdict. #757 built the exclusion for a door that died MID-REQUEST; this is the
  // same fact one step earlier, before any request goes out, and it was the one transport failure the
  // rule did not reach.
  //
  // The two consequences are opposite in shape and both wrong:
  //   refusal cases — "refused at the door by cli, ops-mcp" when ops-MCP refused nothing. A correctly
  //                   refusing door and an absent one produce the SAME line, so the whole point of
  //                   running every case against every door is lost silently.
  //   admit cases   — #98 fires "the one that ACCEPTED is the defect" at the door that behaved.

  test("#1865 the not-configured branch marks itself unavailable — driven, not read off the source", async () => {
    // No TRADEMARK_MCP_HTTP_PORT in this process, which IS the state the finding is about.
    assert.equal(process.env.TRADEMARK_MCP_HTTP_PORT ?? "", "", "this arm is only meaningful with no MCP port in scope");
    const { enqueueViaMcp } = await import("../../scripts/e2e.mjs");
    const a = { door: "ops-mcp", ...(await enqueueViaMcp({ ref: "E2E-ARM" })) };
    assert.equal(a.ok, false);
    assert.match(a.out, /not configured on this deployment/, "and it says which kind of unavailable it is");
    assert.equal(doorAnswerClass(a), DOOR_ANSWER.INFRA_UNAVAILABLE,
      "an absent door holds no opinion — recorded as a refusal it manufactures agreement and misfires #98");
  });

  test("#1865 admit case: an absent second door is NOT a disagreement (R0d/R0e)", () => {
    const opsAbsent = { door: "ops-mcp", ok: false, transport: true, status: null,
      out: "no TRADEMARK_MCP_HTTP_PORT in scope — this door is not configured on this deployment, so it was never asked" };
    const v = doorAsymmetry([cliAccepted, opsAbsent]);
    assert.equal(v.agreed, true, "#98 must not indict the CLI door for delivering exactly as ordered");
    assert.equal(v.compared.length, 1);
    assert.equal(v.reducedCoverage, true, "single-door coverage, and it is said out loud");
  });

  test("#1865 refusal case: an absent door is not listed as a refuser, and the loss is named (R0a-c/f)", async () => {
    const { doorRefusal } = await import("../../scripts/e2e.mjs");
    const receipt = { cases: [{ ref: "E2E-R0a", answers: [
      { door: "cli", accepted: false, answerClass: "answered", status: null, reason: "clarify: the mark is ambiguous" },
      { door: "ops-mcp", accepted: false, answerClass: "infra-unavailable", status: null,
        reason: "no TRADEMARK_MCP_HTTP_PORT in scope — this door is not configured on this deployment, so it was never asked" },
    ] }] };
    const r = doorRefusal(receipt, "E2E-R0a", { reasonMatches: "clarify" });
    assert.deepEqual(r.doors, ["cli"], "the absent door refused nothing — listing it manufactures agreement");
    assert.deepEqual(r.excluded, ["ops-mcp"], "and the case is not silently reported as full coverage");
    assert.deepEqual(r.missed, [], "the door that DID answer carried the ordered reason");
  });

  test("#1865 the exclusion does not weaken a case both doors actually refused", async () => {
    const { doorRefusal } = await import("../../scripts/e2e.mjs");
    const receipt = { cases: [{ ref: "E2E-R0b", answers: [
      { door: "cli", accepted: false, answerClass: "answered", reason: "clarify: out of scope" },
      { door: "ops-mcp", accepted: false, answerClass: "answered", status: 400, reason: "clarify: out of scope" },
    ] }] };
    const r = doorRefusal(receipt, "E2E-R0b", { reasonMatches: "clarify" });
    assert.deepEqual(r.doors, ["cli", "ops-mcp"], "two real refusals are still two real refusals");
    assert.deepEqual(r.excluded, [], "and full coverage still reads as full coverage");
  });

  test("#1865 a case where EVERY door was unavailable refuses to read as a refusal at all", async () => {
    const { doorRefusal } = await import("../../scripts/e2e.mjs");
    const receipt = { cases: [{ ref: "E2E-R0c", answers: [
      { door: "cli", accepted: false, answerClass: "infra-unavailable", reason: "spawn failed" },
      { door: "ops-mcp", accepted: false, answerClass: "infra-unavailable", reason: "not configured" },
    ] }] };
    assert.equal(doorRefusal(receipt, "E2E-R0c", null), null,
      "nothing judged this case, so calling it 'refused at the door' would be the original defect at full strength");
  });

  // ── #1865, SECOND HALF: THE PORT IS RIGHT AND NOTHING IS LISTENING ─────────────────────────────
  //
  // The first half covered a door that was never configured — env unset, first run on a fresh box. The
  // operational case is the other one: the port is correct and the face behind it crashed, or was not
  // restarted, or the unit is on a different port. A verification round hit it and ALL FOUR criteria
  // failed, because `connect ECONNREFUSED` is a plain Error with a `.code` and no `.status`, so the
  // harness recorded `transport: false` and the door read as having refused on the merits.
  //
  // Two facts that made it invisible rather than merely wrong, and that these arms exist to keep fixed:
  // the not-configured round and the connection-refused round produced LINE-FOR-LINE IDENTICAL reports,
  // and the word "transport" appeared ZERO times across eighteen ops-mcp receipt entries in both — not
  // even as `false`, so nothing on the receipt showed that classification had been attempted at all.

  /** A port that was bound and released, so connecting to it is refused rather than merely slow. */
  const closedPort = () => new Promise((resolve, reject) => {
    const srv = createTcpServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });

  test("#1865 a closed socket is a transport failure — driven against a real dead port", async () => {
    // A hand-built `{ code: "ECONNREFUSED" }` would assert that the classifier handles the object I
    // decided to write. The subject is what node actually throws, so the arm has to make node throw it.
    const { mcpToolCall } = await import("../../driver/portal-mcp-client.mjs");
    const port = await closedPort();
    let err = null;
    try {
      await mcpToolCall({ url: `http://127.0.0.1:${port}`, token: "", tool: "start_run", args: {}, timeoutMs: 5000 });
    } catch (e) { err = e; }
    assert.ok(err, `connecting to closed port ${port} succeeded — the plant is inert, not the code fixed`);
    assert.match(err.message, /ECONNREFUSED/, "this arm did not reach a closed socket, so it proves nothing");
    assert.equal(err.transport, true,
      "a connection that was never established is not an answer about the request it was carrying");
    assert.equal(err.status ?? null, null, "there is no status, because nothing replied");
    const { doorAnswerClass, DOOR_ANSWER } = await import("../../scripts/e2e.mjs");
    assert.equal(doorAnswerClass({ ok: false, transport: err.transport === true, status: err.status ?? null }),
      DOOR_ANSWER.INFRA_UNAVAILABLE, "and the classifier has to agree, or the receipt still says refused");
  });

  test("#1865 the ops door reports a dead port as unavailable, end to end", async () => {
    // In a CHILD, because the door's URL is read once at module load: setting the port after importing
    // would drive a module that never saw it. This is the same reason the not-configured arm above runs
    // in a process with no port in scope rather than deleting the variable.
    const port = await closedPort();
    const src = `const { enqueueViaMcp, doorAnswerClass } = await import(${JSON.stringify(join(REPO_ROOT, "scripts/e2e.mjs"))});
      const a = await enqueueViaMcp({ ref: "E2E-ARM-1865" });
      console.log("RESULT " + JSON.stringify({ ...a, cls: doorAnswerClass({ door: "ops-mcp", ...a }) }));`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", src], {
      encoding: "utf8", timeout: 120000,
      env: { ...process.env, TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", TRADEMARK_MCP_HTTP_PORT: String(port) },
    });
    const line = out.split("\n").find((l) => l.startsWith("RESULT "));
    assert.ok(line, `the child printed no result:\n${out.slice(0, 400)}`);
    const a = JSON.parse(line.slice(7));
    assert.equal(a.ok, false);
    assert.equal(a.transport, true, "the door was never reached, so it holds no opinion about the case");
    assert.equal(a.status, null);
    assert.equal(a.cls, "infra-unavailable",
      "a door with nothing listening behind it is being recorded as having REFUSED the case");
    assert.doesNotMatch(String(a.out), /not configured on this deployment/,
      "a dead port and an unset port must not produce the same sentence — they are different faults with "
      + "different fixes, and reports that read identically are how this went unnoticed");
  });

  test("#1865 every receipt answer carries its transport classification, including when it is false", async () => {
    const { receiptAnswerClassification } = await import("../../scripts/e2e.mjs");
    const dead = receiptAnswerClassification({ ok: false, transport: true, status: null });
    assert.deepEqual(dead, { answerClass: "infra-unavailable", status: null, transport: true });
    // The CLI door has no transport concept at all, and that is exactly why the field must be written:
    // a reader cannot distinguish "classified as not-a-transport-failure" from "never classified".
    for (const answer of [{ ok: false, status: 400, out: "clarify: out of scope" }, { ok: true, id: "j-1" }]) {
      assert.ok("transport" in receiptAnswerClassification(answer),
        "an absent field records nothing — `transport` appeared zero times across eighteen entries");
      assert.equal(receiptAnswerClassification(answer).transport, false);
    }
  });

  test("#1865 the widening does not excuse a door that actually answered", async () => {
    const { doorAnswerClass, DOOR_ANSWER } = await import("../../scripts/e2e.mjs");
    const { isSocketFailure } = await import("../../driver/portal-mcp-client.mjs");
    assert.equal(doorAnswerClass({ ok: false, transport: true, status: 400 }), DOOR_ANSWER.ANSWERED,
      "a 400 is the service deciding something about this request — the judgment the comparison wants");
    assert.equal(isSocketFailure({ code: "ECONNREFUSED" }), true);
    assert.equal(isSocketFailure({ code: "ECONNRESET" }), false,
      "a reset can arrive after a service has begun sending an opinion, so it is not a never-asked");
    assert.equal(isSocketFailure(new Error("MCP error: start_run refused upstream")), false,
      "an upstream refusal is an answer, whatever it says");
  });

  test("#1865 an OLD receipt still reads as it did — no retrospective unavailability", async () => {
    const { doorRefusal } = await import("../../scripts/e2e.mjs");
    const receipt = { cases: [{ ref: "E2E-R0f", answers: [
      { door: "cli", accepted: false, reason: "clarify: ambiguous" },
      { door: "ops-mcp", accepted: false, reason: "MCP initialize refused (429): ops principal rate limit exceeded" },
    ] }] };
    const r = doorRefusal(receipt, "E2E-R0f", null);
    assert.deepEqual(r.doors, ["cli", "ops-mcp"],
      "a receipt with no answerClass carries no evidence of a transport failure — inventing one rewrites what past rounds concluded");
    assert.deepEqual(r.excluded, []);
  });

  test("#757 an old receipt with no answerClass reads exactly as it did before", () => {
    // Receipts written before this change carry {door, accepted, reason} only. The fallback must
    // reproduce the previous reading rather than retrospectively inventing infrastructure failures in
    // rounds nobody can re-run.
    const legacy = { door: "ops-mcp", accepted: false, reason: "MCP initialize refused (429): ops principal rate limit exceeded" };
    assert.equal(doorAnswerClass(legacy), DOOR_ANSWER.ANSWERED,
      "no status field means no evidence — and inventing one would rewrite what past rounds concluded");
  });
}

// ── #1561 — A DELIVERY CONTRACT A RUN NEVER ENTERED ──────────────────────────────────────────────────
//
// `sendPending` is written on the delivery paths only — measured 25 of 25 delivered runs, 0 of 29 failed,
// parked or cancelled. So this assertion, run against a failed round, compared behaviour to a contract
// that never applied. It was the ONLY failing line in the harness's ledger for such a round, where it
// read as one more consequence of the run failing rather than as a check that could never have passed.
//
// Owner ruling, 2026-08-22, verbatim: "clean up the failed runs. they owe the client nothing."
const DELIVERED = { state: "delivered", sendPending: true, runId: "2026-08-22-x" };

test("#1561 a non-delivered terminal run is NOT ASSERTED, and the line says so", () => {
  for (const state of ["failed", "parked", "cancelled"]) {
    withRun({ "status.json": { state, runId: "2026-08-22-x" } }, (dir) => {
      const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
      assert.equal(r.ok, true, `${state}: the contract never applied, so nothing is flagged`);
      assert.match(r.saw, /NOT ASSERTED/,
        `${state}: it must SAY it did not assert — a bare green line reads as a delivery that was checked`);
      assert.match(r.saw, new RegExp(`state=${state}`), "naming the state that put it out of scope");
    });
  }
});

test("#1561 a DELIVERED run is still held to the whole contract", () => {
  // The scoping must not become a way for a real delivery defect to pass. A delivered run with the flag
  // and no packet still fails, which is the case the assertion was rewritten for in the first place.
  withRun({ "status.json": DELIVERED }, (dir) => {
    const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
    assert.equal(r.ok, false, "delivered + flag but NO packet is still a failure");
    assert.match(r.saw, /sendPending=true/);
    assert.doesNotMatch(r.saw, /NOT ASSERTED/, "a delivered run is never scoped out");
  });
  // and a delivered run that never set the flag still fails
  withRun({ "status.json": { state: "delivered", runId: "2026-08-22-x" } }, (dir) => {
    assert.equal(evalAssertion({ op: "delivery-settled", path: "status.json" }, dir).ok, false);
  });
});

test("#1561 a status with NO state is still asserted — absence is not evidence of failure", () => {
  // The scope test keys on a state that positively says otherwise. A missing state must not become a
  // silent exemption, or every unreadable status.json stops being checked.
  withRun({ "status.json": { sendPending: true, runId: "2026-08-22-x" } }, (dir) => {
    const r = evalAssertion({ op: "delivery-settled", path: "status.json" }, dir);
    assert.doesNotMatch(r.saw, /NOT ASSERTED/, "no state is not a scope-out");
  });
});
