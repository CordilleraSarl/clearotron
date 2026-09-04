// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// criterion 4 — the jx fold receipt names the MODEL that did the native-language work, not only
// the executor path that ran it.
//
// `executor` says `engine` / `fixtures:…` / `injected`. None of those names who did the Chinese
// reasoning, and "the model is derivable from the run's own attribution" is exactly the derivation the
// criterion asked to stop needing: the question is answered at summary level or it is answered by
// somebody reconstructing it from per-turn records.
//
// Two fields, because one cannot be honest on its own. `models` is every distinct model observed and is
// the truth; `model` is the single name a reader wants, set ONLY when there is exactly one. Lanes
// disagreeing is a real state — a resume under a different program, a per-lane override — and naming one
// of them would be a receipt that lies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value

const root = mkdtempSync(join(tmpdir(), "jx-model-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || root);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || join(root, "pool"));
const { runJxCandidateFold } = await import("../jx.mjs");

const CANDS = [{ term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "r" }];
const mkCtx = (jurisdictions = ["CN"]) => {
  const runDir = mkdtempSync(join(tmpdir(), "jx-run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  return { ctx: {
    run: { runDir }, paths: { registerPlan: driverDir(runDir, "register-plan.json") },
    job: { markName: "NOVAPULSE", jurisdictions, goods: "game software", classes: [9] },
    profile: {}, searchPolicy: { components: { jxLanes: true } },
    registerPlan: { schema_version: 1, plan_version: 1, job_key: "t", entries: [
      { qid: "primary-sweep:exact:novapulse", axis: "primary-sweep", predicate: "exact",
        term: "NOVAPULSE", nice_classes: ["9"], regions: ["CN"], expected_kind: "enumerate" }] },
  }, runDir };
};
const foldOf = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "jx-lanes.json"), "utf8")).fold;
const run = async (ctx, jxExecutor) =>
  runJxCandidateFold(ctx, ctx.job, { jxExecutor }, { inScopeClasses: ["9"] });

test("#1210 the model that served the lane is named in the fold, beside the executor", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  const { ctx, runDir } = mkCtx();
  await run(ctx, async () => ({ ok: true, candidates: CANDS, tookMs: 5, model: "claude-haiku-4-5-20251001" }));
  const fold = foldOf(runDir);
  assert.equal(fold.model, "claude-haiku-4-5-20251001",
    "the fold names no model, so the receipt still answers 'who did the zh work' only by derivation");
  assert.deepEqual(fold.models, ["claude-haiku-4-5-20251001"]);
  assert.ok(fold.executor, "the executor must still be there — this adds a field, it does not replace one");
});

test("#1210 an executor that runs NO model fabricates none — absence is recorded as absence", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  const { ctx, runDir } = mkCtx();
  await run(ctx, async () => ({ ok: true, candidates: CANDS, tookMs: 5 }));   // fixtures/injected: no turn
  const fold = foldOf(runDir);
  assert.equal(fold.model ?? null, null,
    "a model name appeared for an executor that ran no model — the receipt would name a tier nobody used");
  assert.ok(!fold.models?.length, `models is ${JSON.stringify(fold.models)} for a run with no model turn`);
});

test("#1210 lanes that DISAGREE are not resolved by picking one — the summary says null and lists both", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  const { ctx, runDir } = mkCtx(["CN", "JP"]);
  const byLane = { zh: "model-a", ja: "model-b" };
  await run(ctx, async ({ lane }) => ({ ok: true, candidates: CANDS, tookMs: 5, model: byLane[lane] ?? "model-a" }));
  const fold = foldOf(runDir);
  assert.ok(fold.models.length >= 2, `expected two models, got ${JSON.stringify(fold.models)} — if this run `
    + "produced one lane the fixture stopped exercising the disagreement case");
  assert.deepEqual(fold.models, [...fold.models].sort(), "models is unsorted, so the receipt is not stable");
  assert.equal(fold.model, null,
    `the fold named "${fold.model}" while ${JSON.stringify(fold.models)} actually ran. A summary that picks `
    + "one of two is a receipt that lies about who did the work.");
});

test("#1210 a DEGRADED lane still names its model — the turn ran, and it is part of who did the work", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  const { ctx, runDir } = mkCtx();
  await run(ctx, async () => ({ ok: false, cause: "upstream 500", model: "claude-haiku-4-5-20251001" }));
  const fold = foldOf(runDir);
  assert.deepEqual(fold.models, ["claude-haiku-4-5-20251001"],
    "a failed lane dropped its model, so a run whose lanes all degraded would name nobody at all — which "
    + "is precisely the run whose attribution someone will want to read");
});

test("#1210 a RESUME merges rather than replaces — #552's carry-forward, applied to this field", async () => {
  process.env.CLEAROTRON_JX_LANES = "1";
  const { ctx, runDir } = mkCtx();
  // a prior pass observed one model and settled no lane; this pass observes a different one
  writeFileSync(driverDir(runDir, "jx-lanes.json"), JSON.stringify({
    lanes: { zh: { depth: "candidates", jurisdictions: ["CN"] } },
    fold: { executor: "engine", lanes: {}, models: ["model-from-an-earlier-pass"], model: "model-from-an-earlier-pass" },
  }, null, 2));
  await run(ctx, async () => ({ ok: true, candidates: CANDS, tookMs: 5, model: "model-from-this-pass" }));
  const fold = foldOf(runDir);
  assert.ok(fold.models.includes("model-from-an-earlier-pass"),
    `the earlier pass's model was dropped — models is ${JSON.stringify(fold.models)}. Lanes fold across `
    + "resumes, so a pass carrying one pending lane must not erase what earlier passes recorded (#552).");
  assert.ok(fold.models.includes("model-from-this-pass"), "this pass's model was not recorded");
});
