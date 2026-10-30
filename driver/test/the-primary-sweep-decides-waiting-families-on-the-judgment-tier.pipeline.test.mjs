// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end, on both engines
//
// THE PRIMARY SWEEP DECIDES ITS WAITING FAMILIES ON THE JUDGMENT TIER, on both engines, by every route.
//
// The primary-sweep unit releases or withholds the plan's waiting families after reading the identical mark's
// list. That unit moved from the sweep tier to the judgment tier (PRIMARY_SWEEP_TIER in stages.mjs), keeping
// its adaptive thinking; the other register units keep their tiers. What is asserted is what a run sends and
// records, not the table read back to itself: the model flag each engine program was started with, and the
// model on every row of each unit's stage record. The unit reaches its model by several routes, and each is
// driven here: a fresh dispatch, a follow-up to its session, a retry after a failed attempt, a resumed run,
// and `--experiment`. On Codex the judgment tier is the configured judgment model, so one tier moves both.
//
// Run:  node scripts/test-run.mjs node --test driver/test/the-primary-sweep-decides-waiting-families-on-the-judgment-tier.pipeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, pinEnvAll, envFrom } from "../../shared/env-aliases.mjs";
import { claudeModel } from "../engine/anthropic-agent.mjs";
import { openaiModel } from "../engine/openai-agent.mjs";
import { resolveModel } from "../driver.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
// The offline mock run's settings, as pipeline.mock.test.mjs sets them and for its reasons.
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";   // the probe as a model turn, so its tier is on the record too

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG"];
// A box's own setting would move the models under the test, so every arm runs on the source's defaults.
const MODEL_SETTINGS = { CLEAROTRON_OPENAI_MODEL_JUDGMENT: undefined, CLEAROTRON_OPENAI_MODEL_SWEEP: undefined,
  CLEAROTRON_OPENAI_MODEL_CHEAP: undefined, ANTHROPIC_DEFAULT_OPUS_MODEL: undefined, ANTHROPIC_DEFAULT_SONNET_MODEL: undefined,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: undefined, CLEAROTRON_STAGE_THINKING: undefined };
// The skeptic re-runs the primary sweep, so that unit is also dispatched as a follow-up to its own session.
const ESCALATE = "- primary-sweep under-paged the NZ sub-query\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run the NZ sub-query";
// The primary sweep's opening dispatch names its axis, on both engines.
const OPENS = (axis) => `You are register UNIT mode, axis = "${axis}"`;

// Each engine's pins, the other engine's unset (pinEnvAll deletes on undefined): the variables are process-global.
const ENGINES = {
  "anthropic-agent": {
    env: (root) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, MOCK_CLAUDE_CALL_LOG: join(root, "calls.jsonl"),
      CLEAROTRON_CODEX_PATH: undefined, CLEAROTRON_AI_BILLING: undefined, CODEX_API_KEY: undefined, MOCK_CODEX_CALL_LOG: undefined }),
    flag: "--model", wire: claudeModel, recorded: resolveModel,
  },
  "openai-agent": {
    env: (root) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key",
      CODEX_API_KEY: "sk-codex-dummy", MOCK_CODEX_CALL_LOG: join(root, "calls.jsonl"), MOCK_CLAUDE_CALL_LOG: undefined }),
    flag: "-m", wire: openaiModel, recorded: openaiModel,
  },
};
const TIERS = {
  "primary-sweep": "opus",
  "transliteration-numeric": "sonnet",
  "incumbent-class": "sonnet",
  "saturation-probe": "haiku",
};

const jsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const codenameOf = (runDir) => basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "");
// The model flag one engine call was started with, or null.
const flagValue = (argv, flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? null : null; };

/**
 * One environment for a whole arm, so a resume and an experiment run where the first run ran. A held arm's
 * pool is a file, which refuses the publication, so its run stays live rather than archived (operability.test.mjs
 * holds a run the same way).
 */
function armOn(engine, { held = false, ...env } = {}) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-reading-tier-"));
  const pool = held ? join(root, "pool-is-a-file") : join(root, "pool");
  if (held) writeFileSync(pool, "");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...MODEL_SETTINGS, ...ENGINES[engine].env(root), CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: pool,
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env });
  return {
    calls: () => jsonl(join(root, "calls.jsonl")),
    rows: (runDir) => Object.fromEntries(Object.keys(TIERS).map((axis) => [axis, jsonl(driverDir(runDir, `register-unit:${axis}.jsonl`))])),
    pipelineModule: () => import(`../pipeline.mjs?bust=${Math.random()}`),
  };
}

/** Every row of every unit's record is on its tier, by what was asked and by what the engine resolved. */
function assertRowsOnTier(engine, rows) {
  const { recorded } = ENGINES[engine];
  for (const [axis, tier] of Object.entries(TIERS)) {
    assert.ok(rows[axis].length >= 1, `the ${axis} unit left no dispatch row`);
    for (const x of rows[axis]) {
      const what = `a ${axis} row (attempt ${x.attempt}${x.followup ? `, follow-up ${x.followup}` : ""})`;
      assert.equal(x.model, tier, `${what} asked for ${x.model}`);
      assert.equal(x.modelUsed, recorded(tier), `${what} records ${x.modelUsed} as the model it ran on`);
      // THE MODEL THE ENGINE REPORTS SERVING is on the row too. The Claude mock reports one per tier; the Codex
      // mock writes no session rollout, so there the engine reports none and the row says so.
      if (engine === "anthropic-agent") {
        assert.match(String(x.modelActual), new RegExp(tier), `${what} records ${x.modelActual} as served`);
        assert.equal(x.modelMismatch, false, `${what} was served by another family`);
      }
    }
  }
}

test("the judgment tier and the sweep tier are different models on both engines, or this file proves nothing", () => {
  for (const k of Object.keys(MODEL_SETTINGS)) delete process.env[k];
  assert.notEqual(claudeModel("opus"), claudeModel("sonnet"));
  assert.notEqual(openaiModel("opus"), openaiModel("sonnet"),
    "the Codex judgment and sweep models are one model, so a unit moving between them would not show");
});

for (const engine of Object.keys(ENGINES)) {
  const { flag, wire } = ENGINES[engine];

  test(`${engine}: a fresh dispatch, a follow-up, a resumed run and --experiment run the primary sweep on the judgment tier; the other units keep theirs`, async () => {
    // Held before publication, so the run stays live for the resume and the experiment that follow.
    const arm = armOn(engine, { held: true, MOCK_SKEPTIC: ESCALATE });
    const { pipeline, runExperiment } = await arm.pipelineModule();
    const res = await pipeline({ ...JOB });
    const codename = codenameOf(res.runDir);

    // WHAT EACH ENGINE PROGRAM WAS STARTED WITH, for every unit's opening turn.
    for (const [axis, tier] of Object.entries(TIERS)) {
      const opening = arm.calls().filter((c) => String(c.prompt ?? "").includes(OPENS(axis)));
      assert.ok(opening.length >= 1, `no ${engine} call opened the ${axis} unit — the arm cannot see its model`);
      for (const c of opening)
        assert.equal(flagValue(c.argv, flag), wire(tier), `the ${axis} unit was started on ${flagValue(c.argv, flag)}, not the ${tier} tier`);
    }
    // WHAT EACH UNIT'S RECORD SAYS, on every row, the follow-up's included.
    const rows = arm.rows(res.runDir);
    assertRowsOnTier(engine, rows);
    // A FLOOR ON THE POPULATION: the escalation is what sends the follow-up, and without one the follow-up
    // route, which resolves its model apart from a fresh dispatch, would pass here unseen.
    assert.ok(rows["primary-sweep"].some((x) => x.followup),
      `the primary-sweep unit was never dispatched as a follow-up: ${JSON.stringify(rows["primary-sweep"].map((x) => x.followup ?? null))}`);

    // THE RESUME: the operator's `--resume <codename> --from register-unit` on the same run.
    let before = arm.calls().length;
    const resumed = await (await arm.pipelineModule()).pipeline({ ...JOB }, { codename, fromStage: "register-unit" });
    assert.equal(codenameOf(resumed.runDir), codename, "the resume opened another run");
    const again = arm.calls().slice(before).filter((c) => String(c.prompt ?? "").includes(OPENS("primary-sweep")));
    assert.ok(again.length >= 1, "the resumed run never dispatched the primary-sweep unit — the arm cannot see the resume");
    for (const c of again) assert.equal(flagValue(c.argv, flag), wire("opus"), `the resumed run started the unit on ${flagValue(c.argv, flag)}`);
    assertRowsOnTier(engine, arm.rows(resumed.runDir));

    // --experiment WITHOUT --model: the saved run's unit, re-run in a sandbox, resolves the same selection.
    before = arm.calls().length;
    await runExperiment({ ...JOB }, { codename, experiment: "register-unit", axis: "primary-sweep" });
    const experiment = arm.calls().slice(before).filter((c) => String(c.prompt ?? "").includes(OPENS("primary-sweep")));
    assert.ok(experiment.length >= 1, "the experiment never dispatched the primary-sweep unit");
    for (const c of experiment)
      assert.equal(flagValue(c.argv, flag), wire("opus"), `the experiment ran the unit on ${flagValue(c.argv, flag)}`);
    const logged = jsonl(driverDir(res.runDir, "run.jsonl")).filter((e) => e.event === "experiment" && e.stage === "register-unit:primary-sweep");
    assert.equal(logged.length, 1, "the experiment left no record in the run's log");
    assert.equal(logged[0].modelTier, "opus", "the experiment's record names another tier");
  });

  test(`${engine}: a retry after a failed attempt keeps the primary sweep on the judgment tier`, async () => {
    // Every turn that opens the primary sweep fails while the knob is set: the attempt, then one retry.
    const arm = armOn(engine, { CLEAROTRON_MAX_RETRIES: "1", MOCK_FAIL_STAGE: OPENS("primary-sweep") });
    const res = await (await arm.pipelineModule()).pipeline({ ...JOB });
    const failed = arm.rows(res.runDir)["primary-sweep"];
    assert.ok(failed.length >= 2, `the primary sweep was not retried: ${failed.length} attempt row(s)`);
    for (const x of failed) {
      assert.equal(x.model, "opus", `attempt ${x.attempt} of the failing unit asked for ${x.model}`);
      assert.equal(x.modelUsed, ENGINES[engine].recorded("opus"), `attempt ${x.attempt} records ${x.modelUsed}`);
    }
    const calls = arm.calls().filter((c) => String(c.prompt ?? "").includes(OPENS("primary-sweep")));
    assert.ok(calls.length >= 2, `the engine was started ${calls.length} time(s) for the failing unit`);
    for (const c of calls) assert.equal(flagValue(c.argv, flag), wire("opus"), "a retry of the unit was started on another model");
  });
}
