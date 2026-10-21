// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery repair end to end on the mock pipeline, on both engines, with invented names
//
// A FAULT INSIDE A CARD IS REPAIRED IN THAT CARD.
//
// Most of the delivery check's prose checks name no finding, and a fault that names none went to the overview's
// repair. The overview step cannot edit a card, so a fault in a card's own prose shipped after a repair that could not
// reach it, and the overview was rewritten for nothing. The fault is now located by its own check run on each part
// (repair-targets.mjs), and the card that holds it is rendered again with that card's own detail.
//
// The scenario, from mock knobs: two findings, each with its card; the second card's first rendering states a search
// count in its own prose, which the delivery check refuses as `scope-numbers-in-prose`, a fault that names no
// finding; any later rendering of that card is clean (MOCK_CARD_SCOPE_COUNT). MOCK_OVERVIEW_SCOPE_COUNT does the same for the
// overview's first rendering. MOCK_SENTENCE_SCOPE_COUNT puts the count in a finding's own sentence, which the report
// composes from the writer's record: no card or overview repair can change it, so it goes to the writer's.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const ENGINE_KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY"];
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_CARD_SCOPE_COUNT", "MOCK_OVERVIEW_SCOPE_COUNT", "MOCK_SENTENCE_SCOPE_COUNT"];
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "2" };
const SENTENCE = "The search ran 14 queries across the register.";

async function runPipeline(engine, knobs) {
  const root = tempDir("clearotron-card-fault-");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a fault in a card's own prose that names no finding is repaired in that card, and the overview is left alone`, async () => {
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_CARD_SCOPE_COUNT: "2" });
    // CONTROLS — the scenario is the one described.
    const lintFailed = events.findIndex((e) => e.event === "predelivery-lint-failed");
    assert.ok(lintFailed >= 0 && events[lintFailed].failures.includes("scope-numbers-in-prose"),
      "the delivery check did not find the search count in the card");
    assert.deepEqual(events.filter((e) => e.event === "stage" && /^report-card:/.test(String(e.stage)) && e.trigger === "fresh")
      .map((e) => e.stage).sort(), ["report-card:1", "report-card:2"], "the two cards were not built");
    // THE CLAIMS.
    const repairs = events.slice(lintFailed).filter((e) => e.event === "stage" && e.trigger === "lint-repair").map((e) => e.stage);
    assert.deepEqual(repairs, ["report-card:2"], "the repair did not reach the card that holds the fault, or reached another part");
    assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes(SENTENCE), "the delivered report still carries the card's faulty sentence");
    const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
    assert.ok(!receipt.failures.includes("scope-numbers-in-prose"), "the delivery check still finds the fault after the repair");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  // The overview's own fault went to the overview before this change too: this arm pins that it still does.
  test(`${engine}: a fault in the overview's own prose is repaired in the overview, and no card is rendered again`, async () => {
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_OVERVIEW_SCOPE_COUNT: "1" });
    const lintFailed = events.findIndex((e) => e.event === "predelivery-lint-failed");
    assert.ok(lintFailed >= 0 && events[lintFailed].failures.includes("scope-numbers-in-prose"),
      "the delivery check did not find the search count in the overview");
    const repairs = events.slice(lintFailed).filter((e) => e.event === "stage" && e.trigger === "lint-repair").map((e) => e.stage);
    assert.deepEqual(repairs, ["report-overview"], "the repair did not reach the overview alone");
    assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes(SENTENCE), "the delivered report still carries the overview's faulty sentence");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: one fault held by a card and by the overview is repaired in each part that holds it`, async () => {
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_CARD_SCOPE_COUNT: "2", MOCK_OVERVIEW_SCOPE_COUNT: "1" });
    const lintFailed = events.findIndex((e) => e.event === "predelivery-lint-failed");
    assert.ok(lintFailed >= 0, "the delivery check found no fault");
    const targets = events.find((e) => e.event === "report-repair-targets");
    assert.deepEqual([targets?.cards, targets?.overview], [[2], ["scope-numbers-in-prose"]], "the fault was not placed in both parts");
    const repairs = events.slice(lintFailed).filter((e) => e.event === "stage" && e.trigger === "lint-repair").map((e) => e.stage).sort();
    assert.deepEqual(repairs, ["report-card:2", "report-overview"], "the repair did not reach each part that holds the fault");
    assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes(SENTENCE), "the delivered report still carries the faulty sentence");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: a fault in a finding's own sentence goes to the writer's one repair, named by its finding, and its change is reviewed`, async () => {
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_SENTENCE_SCOPE_COUNT: "2" });
    const lintFailed = events.findIndex((e) => e.event === "predelivery-lint-failed");
    assert.ok(lintFailed >= 0 && events[lintFailed].failures.includes("scope-numbers-in-prose"),
      "the delivery check did not find the search count in the finding's sentence");
    const targets = events.find((e) => e.event === "report-repair-targets");
    assert.deepEqual([targets?.cards, targets?.overview, targets?.stamped], [[], [], ["scope-numbers-in-prose"]],
      "the fault was not placed in the line composed from the record alone");
    // THE CLAIMS.
    const repairs = events.slice(lintFailed).filter((e) => e.event === "stage" && e.trigger === "lint-repair").map((e) => e.stage);
    assert.deepEqual(repairs, ["synthesis"], "the repair did not go to the writer alone");
    const msg = readdirSync(driverDir(res.runDir)).filter((f) => f.startsWith("synthesis.attempt") && f.includes(".dispatch.txt"))
      .map((f) => readFileSync(driverDir(res.runDir, f), "utf8")).find((m) => m.includes("The deterministic pre-delivery checks found these faults"));
    assert.ok(msg, "the writer's repair was not sent its own opening");
    assert.match(msg, /^This is a fresh session: your earlier synthesis work is not in your context\. The driver wrote \S+ and \S*narrative\.md from your `record_synthesis` call\. The deterministic pre-delivery checks found these faults in content rendered from that record:$/m);
    assert.match(msg, /^- finding 2: .*14 queries/m, "the fault is not named by the finding that owns it");
    assert.match(msg, /^Read \S+ and \S*narrative\.md, then correct the finding or narrative section that owns each fault\.$/m);
    assert.ok(msg.includes("Apply the fix in ONE `record_synthesis` PATCH call"), "the save line is not the writer's");
    assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes(SENTENCE), "the delivered report still carries the finding's faulty sentence");
    const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
    assert.ok(!receipt.failures.includes("scope-numbers-in-prose"), "the delivery check still finds the fault after the repair");
    assert.ok(events.some((e) => e.event === "post-repair-review" && e.read === true), "the change to the record was not reviewed");
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}
