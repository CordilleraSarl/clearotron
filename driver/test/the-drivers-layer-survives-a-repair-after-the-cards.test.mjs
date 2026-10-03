// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery repair end to end on the mock pipeline, with invented names
//
// THE DRIVER'S WRITES ARE A LAYER OVER THE MODEL'S RECORD, APPLIED AGAIN AFTER EVERY ACCEPTED SAVE (design,
// 2026-10-03).
//
// At the delivery seam the driver stamps the coverage-judgment rows from the coverage ledger and the plan's
// receipt, replacing the model's. A synthesis save after the cards — the pre-delivery lint's narrative repair
// here — rewrote the record from the model's own base, and nothing stamped the rows again: on a test run, 19
// rows at the seam and 0 delivered, and those rows feed the scope line the client reads. And a card is owed for
// every delivered finding: a finding a save adds after the cards gets its card built.
//
// The scenario, from mock knobs: the model judges coverage insufficient and the plan defers a slice, so the
// stamp writes rows (MOCK_COVERAGE_INSUFFICIENT, MOCK_PLAN_DEFERRED); finding 1's write-up is over the cap, so
// the pre-delivery lint re-runs synthesis after the cards are built (MOCK_NARRATIVE_OVER_CAP); and that repair
// may add a finding (MOCK_REDO_ADDS_FINDING).
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
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8442", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_NARRATIVE_OVER_CAP", "MOCK_COVERAGE_INSUFFICIENT",
  "MOCK_PLAN_DEFERRED", "MOCK_REDO_ADDS_FINDING"];

async function runPipeline(env) {
  const root = tempDir("clearotron-layer-");
  for (const k of MOCK_KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...env })) pinEnv(process.env, k, v);
  const { pipeline, fullProseOrdinals } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  for (const k of MOCK_KNOBS) delete process.env[k];
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, fullProseOrdinals, doc: JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8")) };
}
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_NARRATIVE_OVER_CAP: "1" };
const repairedAfterTheCards = (events) => {
  const firstCard = events.findIndex((e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage)));
  const repair = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
  return firstCard >= 0 && repair > firstCard;
};

test("the coverage-judgment rows the seam stamped are the rows delivered after a repair saves the record again", async () => {
  const { res, events, doc } = await runPipeline({ ...SCENARIO, MOCK_COVERAGE_INSUFFICIENT: "1", MOCK_PLAN_DEFERRED: "+merch" });
  // CONTROLS — the stamp wrote rows at the seam, and a repair saved the record after the cards
  const stamp = events.find((e) => e.event === "coverage-judgment-rows");
  assert.equal(stamp?.changed, true, "premise: the stamp wrote rows at the seam");
  assert.ok(repairedAfterTheCards(events), "premise: a repair saved the record after the cards were built");
  // THE CLAIM
  assert.deepEqual((doc.coverage_judgment?.rows ?? []).map((r) => r.note), ["coverage-limited", "deferred"],
    `the delivered record lost the rows the seam stamped: ${JSON.stringify(doc.coverage_judgment)}`);
  assert.ok(events.some((e) => e.event === "layer-reapplied"), "no rebuild of the driver's layer was recorded");
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("a finding a repair adds after the cards gets its card", async () => {
  const { res, events, doc, fullProseOrdinals } = await runPipeline({ ...SCENARIO, MOCK_FINDINGS_N: "2", MOCK_REDO_ADDS_FINDING: "1" });
  assert.ok(repairedAfterTheCards(events), "premise: a repair saved the record after the cards were built");
  assert.equal(doc.findings.length, 3, "premise: the repair added a third finding");
  const cards = readdirSync(join(res.runDir, "report-cards"));
  assert.deepEqual(fullProseOrdinals(doc.findings).filter((o) => !cards.includes(`${o}.md`)), [],
    `a delivered finding has no card: ${cards.join(", ")}`);
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "report-card:3" && e.ok === true), "no card was built for the added finding");
  assert.equal(res.ok, true, JSON.stringify(res));
});
