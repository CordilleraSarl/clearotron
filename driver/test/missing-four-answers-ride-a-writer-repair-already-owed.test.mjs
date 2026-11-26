// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline on both engines, a writer record without its four answers
//
// MISSING FOUR ANSWERS RIDE A WRITER REPAIR ALREADY OWED, AND ONLY ONE (design's decision of 2026-11-26).
//
// A clearance shipped with no four answers: the writer left the block out, and the check that saw it is marked
// structural, so no repair was ever sent. Design ruled: where the writer is repaired for another fault, the same turn
// is told the answers are missing, in the approved words; with no other writer repair the run keeps the check's flag
// for the reviewer and delivers; and a grounded partial block satisfies the check, an unsupported answer being omitted
// honestly. Here the writer's first record has no answers, once beside a narrative fault that owes it a repair and once
// alone. The engine is the mock; every name is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, rmSync } from "node:fs";
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

const { FOUR_ANSWERS_CHECK, FOUR_ANSWERS_REPAIR_LINE, contentModelChecks } = await import("../predelivery-lint.mjs");

const JOB = { id: "test-job", msgId: "<four-answers@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8442", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const ENGINE_KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG"];
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_NO_FOUR_ANSWERS", "MOCK_NARRATIVE_OVER_CAP"];

async function runPipeline(engine, knobs) {
  const root = tempDir("clearotron-four-answers-");
  const calls = join(root, "calls.jsonl");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_CLAUDE_CALL_LOG: calls, MOCK_CODEX_CALL_LOG: calls, ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  let prompts = [];
  try { prompts = readFileSync(calls, "utf8").trim().split("\n").map((l) => String(JSON.parse(l).prompt ?? "")); } catch { /* no call logged */ }
  return { res, events, prompts };
}
const writerRepairs = (events) => events.filter((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
const answersOf = (runDir) => JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).four_answers ?? null;

test("a grounded partial block satisfies the check; a block with no grounded answer does not", () => {
  const check = (fourAnswers) => contentModelChecks({ findings: [], fourAnswers, expected: true }).find((c) => c.id === FOUR_ANSWERS_CHECK);
  assert.equal(check({ registrability: { read: "Inherently distinctive for the filed goods.", token: "registrable", basis: "the assessment of the mark" } })?.pass, true,
    "one grounded answer, the other three honestly omitted, failed the check");
  assert.equal(check(null)?.pass, false);
  assert.equal(check({ registrability: { read: "  ", token: "registrable" } })?.pass, false);
  assert.equal(check(null)?.structural, true, "the check started a repair of its own");
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a missing block rides the writer's repair for another fault, in the approved words, and the answers it grounds ship`, async () => {
    const { res, events, prompts } = await runPipeline(engine, { MOCK_NO_FOUR_ANSWERS: "1", MOCK_NARRATIVE_OVER_CAP: "1" });
    assert.equal(writerRepairs(events).length, 1, "premise: the narrative fault owed the writer one repair");
    const repair = prompts.find((p) => p.includes(FOUR_ANSWERS_REPAIR_LINE));
    assert.ok(repair, "the writer's repair was not told the four answers are missing");
    assert.match(repair, new RegExp(`^- ${FOUR_ANSWERS_REPAIR_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "the line is not one of the repair's listed faults");
    assert.ok(events.some((e) => e.event === "four-answers-handed"), "the run does not record that it handed the block");
    assert.equal(answersOf(res.runDir)?.registrability?.token, "registrable", "the answer the repair grounded did not reach the delivered record");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: with no other writer repair, the run keeps the check's flag and delivers, and sends no repair for it`, async () => {
    const { res, events, prompts } = await runPipeline(engine, { MOCK_NO_FOUR_ANSWERS: "1" });
    assert.equal(writerRepairs(events).length, 0, "a writer repair was started for the missing block alone");
    assert.ok(!prompts.some((p) => p.includes(FOUR_ANSWERS_REPAIR_LINE)));
    const lint = events.filter((e) => e.event === "predelivery-lint-failed").at(-1);
    assert.ok(lint?.failures?.includes(FOUR_ANSWERS_CHECK), "the flag for the reviewer is gone");
    assert.equal(answersOf(res.runDir), null);
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}
