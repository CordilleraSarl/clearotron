// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end, on both engines
//
// THE REGISTER UNITS THAT DECIDE WAITING FAMILIES RUN ON THE JUDGMENT TIER, on both engines.
//
// The units on `primary-sweep` and `transliteration-numeric` hold the plan's waiting families and release or
// withhold each one. That decision moved from the sweep tier to the judgment tier (READING_UNIT_TIER in
// stages.mjs); the incumbent unit and the saturation probe keep their tiers. What is asserted is what a run
// sends and records, not the table read back to itself: the model flag each engine program was started with
// for a unit's opening turn, and the model on every row of the unit's stage record, a follow-up included.
// On Codex the judgment tier is the judgment model, so one tier moves both engines.
//
// Run:  node scripts/test-run.mjs node --test driver/test/the-units-that-decide-waiting-families-run-on-the-judgment-tier.pipeline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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
const KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG"];
// A box's own setting would move the Codex models under the test, so every arm runs on the source's defaults.
const MODEL_SETTINGS = { CLEAROTRON_OPENAI_MODEL_JUDGMENT: undefined, CLEAROTRON_OPENAI_MODEL_SWEEP: undefined,
  CLEAROTRON_OPENAI_MODEL_CHEAP: undefined, ANTHROPIC_DEFAULT_OPUS_MODEL: undefined, ANTHROPIC_DEFAULT_SONNET_MODEL: undefined };
// The skeptic re-runs the primary sweep, so that unit is also dispatched as a follow-up to its own session.
const ESCALATE = "- primary-sweep under-paged the NZ sub-query\n\n## Escalation decisions\nESCALATE: primary-sweep — re-run the NZ sub-query";

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
  "transliteration-numeric": "opus",
  "incumbent-class": "sonnet",
  "saturation-probe": "haiku",
};

async function runOn(engine) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-reading-tier-"));
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...MODEL_SETTINGS, ...ENGINES[engine].env(root), CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: ESCALATE });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const jsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const rows = Object.fromEntries(Object.keys(TIERS).map((axis) => [axis, jsonl(driverDir(res.runDir, `register-unit:${axis}.jsonl`))]));
  return { res, rows, calls: jsonl(join(root, "calls.jsonl")) };
}

// The model flag one engine call was started with, or null.
const flagValue = (argv, flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? null : null; };
// The opening turn of a register unit names its axis in the dispatch, on both engines.
const openingTurnOf = (calls, axis) => calls.filter((c) => String(c.prompt ?? "").includes(`You are register UNIT mode, axis = "${axis}"`));

test("the judgment tier and the sweep tier are different models on both engines, or this file proves nothing", () => {
  assert.notEqual(claudeModel("opus"), claudeModel("sonnet"));
  for (const k of Object.keys(MODEL_SETTINGS)) delete process.env[k];
  assert.notEqual(openaiModel("opus"), openaiModel("sonnet"),
    "the Codex judgment and sweep models are one model, so a unit moving between them would not show");
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: the two units that decide waiting families run on the judgment tier, follow-up included; the other two keep theirs`, async () => {
    const { flag, wire, recorded } = ENGINES[engine];
    const r = await runOn(engine);
    assert.equal(r.res.ok, true, JSON.stringify(r.res));
    for (const [axis, tier] of Object.entries(TIERS)) {
      // WHAT THE ENGINE PROGRAM WAS STARTED WITH, for the unit's opening turn.
      const opening = openingTurnOf(r.calls, axis);
      assert.ok(opening.length >= 1, `no ${engine} call opened the ${axis} unit — the arm cannot see its model`);
      for (const c of opening)
        assert.equal(flagValue(c.argv, flag), wire(tier), `the ${axis} unit was started on ${flagValue(c.argv, flag)}, not the ${tier} tier`);
      // WHAT THE UNIT'S RECORD SAYS, on every row it holds.
      const rows = r.rows[axis];
      assert.ok(rows.length >= 1, `the ${axis} unit left no dispatch row`);
      for (const x of rows) {
        assert.equal(x.model, tier, `a ${axis} row asked for ${x.model}${x.followup ? ` on a follow-up (${x.followup})` : ""}`);
        assert.equal(x.modelUsed, recorded(tier), `a ${axis} row records ${x.modelUsed} as the model it ran on`);
      }
    }
    // A FLOOR ON THE POPULATION: the escalation is what sends the follow-up, and without one the follow-up
    // path, which resolves its model apart from a fresh dispatch, would pass here unseen.
    assert.ok(r.rows["primary-sweep"].some((x) => x.followup),
      `the primary-sweep unit was never dispatched as a follow-up: ${JSON.stringify(r.rows["primary-sweep"].map((x) => x.followup ?? null))}`);
  });
}
