// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end against the veto
//
// THE VETO, PINNED ON THE STATE IT EXISTS FOR — not on any failure-token vocabulary.
//
// The veto's one job: a corrective retry must not RESUME a session that ruled none of its meaning
// rows. A resumed session re-reads its own output; it cannot produce rulings it did not produce the
// first time (R6's measured 1007 seconds, byte-identical and discarded). So when the whole population
// is unruled, attempt 2 must dispatch FRESH.
//
// THIS FILE IS DELIBERATELY TRANSPORT-AGNOSTIC. It asserts the BEHAVIOUR — ruled-none ⇒ no resume —
// not the mechanism that detects it. That is what makes it a guard rather than a pin of today's
// implementation: it was written RED against the 2026-08-16 activation branch, where arming
// `disposition_call_required` moved the failure token out of TOTAL_DEFECT_TOKENS' closed two-member
// form-path list and the veto silently stood down (gateway.mjs:2508 — no `call_*` token was in the
// list, so under the tool path the veto had no reachable trigger at all). A veto keyed on the counted
// rulings state passes this test on every transport; a veto keyed on an enumerated token list fails it
// the day a new token forgets to enrol.
//
// THE FAILURE DIRECTION, STATED HERE BECAUSE THE FIX ENCODES IT: when the rulings count is missing or
// uncountable, the veto FIRES — absence reads as ZERO, deliberately. That inverts the house
// absence-is-a-finding rule, and it is correct in exactly this one place: the veto's failure direction
// is resuming-when-it-shouldn't, and reading an unknown count as "some rows were ruled" resumes a
// session that may have ruled nothing (the 2026-08-15 shape). Reading it as zero costs one fresh
// dispatch. The unit arm of that rider lives with the veto's own predicate tests; this file drives the
// end-to-end behaviour.
//
// Mirrors pipeline.mock.test.mjs's harness (own process, own root); every run is billable-call-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { MEANING_SEAT } from "../common-law-receipts.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8440", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// config.workspaceRoot freezes at FIRST import — every run in this file lands under ROOT.
const ROOT = mkdtempSync(join(tmpdir(), "prelim-veto-"));

async function runPipeline(env, jobPatch = {}, opts = {}) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "CLEAROTRON_MAX_RETRIES"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("#589 veto: a corrective retry over a ruled-none meaning population dispatches FRESH, never a resume", async () => {
  // MOCK_CL_UNDISPOSED leaves the owning half's whole meaning population unruled on attempt 1 — the
  // seat did the other work and ruled ZERO of its rows. Whatever token names that failure, and
  // whichever transport carries the rulings, attempt 2 must not resume that session.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PR_RESULTS: "novapulse meaning slang", MOCK_CL_UNDISPOSED: "1", CLEAROTRON_MAX_RETRIES: "1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const owner = events.find((e) => e.event === "stage" && e.stage === `common-law-half:${MEANING_SEAT}` && e.trigger === "fresh");
  assert.ok(owner, "the meaning seat ran fresh");
  assert.equal(owner.ok, true, "the corrective ladder healed the seat");
  assert.equal(owner.attempts, 2, "attempt 1 failed over its whole unruled population; attempt 2 healed it");
  assert.equal(owner.warm, false,
    "#589: attempt 2 must be a FRESH dispatch — a resumed session that ruled none of its rows re-reads its own output and cannot rule what it did not rule");
});
