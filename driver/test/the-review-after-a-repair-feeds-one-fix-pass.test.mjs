// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the delivery stale-repair end to end on the mock pipeline, with invented names
//
// THE REVIEW A REPAIR RE-RUNS FEEDS ONE FIX PASS (owner, ruling 718, 2026-10-02).
//
// A delivery-check repair that rewrites the narrative makes the review stale, and the stale-repair runs it
// again. Its flags used to go nowhere: on two of five saved runs it raised 18 and 11 flags after a repair
// and nothing applied them. Now, when the re-run review raises a flag about a finding the repair changed,
// ONE corrective pass applies the review's flags — the corrective cycle's own body, resuming the session
// that wrote the record — before the overview and the cards are rebuilt, and the review is not run again.
// A flag about no changed finding triggers nothing, which is what keeps the extra call rare.
//
// The scenario, from mock knobs: finding 1's write-up is over the cap, so the narrative redo rewrites
// narrative.md and the review goes stale (MOCK_NARRATIVE_OVER_CAP); that redo also changes finding 1
// (MOCK_REDO_TOUCHES_FINDING); the re-run review comes back BLOCKING (MOCK_REVIEW_BLOCKS_AFTER_VERDICT),
// with its flag on finding 1 (MOCK_LATE_REVIEW_ON) or on no finding.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
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
  ref: "TMP8440", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_REDO_TOUCHES_FINDING",
  "MOCK_NARRATIVE_OVER_CAP", "MOCK_REVIEW_BLOCKS_AFTER_VERDICT", "MOCK_LATE_REVIEW_ON", "MOCK_LATE_REVIEW_EXTRA_ON",
  "MOCK_VERDICT_DEFECTS"];

async function runPipeline(env) {
  const root = tempDir("clearotron-fix-pass-");
  for (const k of MOCK_KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_REDO_TOUCHES_FINDING: "1",
  MOCK_NARRATIVE_OVER_CAP: "1", MOCK_REVIEW_BLOCKS_AFTER_VERDICT: "1" };

test("a re-run review that flags a finding the repair changed gets ONE corrective pass before the tail is rebuilt, and the run still delivers", async () => {
  const { res, events } = await runPipeline({ ...SCENARIO, MOCK_LATE_REVIEW_ON: "1", MOCK_LATE_REVIEW_EXTRA_ON: "2" });
  // CONTROLS — the scenario is the one described, or the arm below proves nothing.
  const repair = events.find((e) => e.event === "delivery-stale-repair");
  assert.ok(repair && (repair.stages ?? []).includes("narrative-refutation"), `the repair re-ran the reviewer: ${JSON.stringify(repair)}`);
  assert.match(readFileSync(join(res.runDir, "senior-eye-review.md"), "utf8"), /\[on: 1\]/, "the re-run review flagged finding 1");

  // THE CLAIM.
  const fix = events.filter((e) => e.event === "post-repair-fix-pass");
  assert.equal(fix.length, 1, `exactly one fix pass, got ${fix.length}`);
  assert.ok(fix[0].touched.includes(1), `the repair touched finding 1: ${JSON.stringify(fix[0])}`);
  const dispatched = events.filter((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "post-repair-corrective");
  assert.ok(dispatched.length >= 1, "no post-repair corrective dispatch ran");
  // the fix pass ran before the tail, which then rendered once (the order the stale-repair now takes)
  const order = events.find((e) => e.event === "delivery-stale-repair")?.order ?? [];
  assert.ok(order.indexOf("narrative-refutation") < order.indexOf("report-card:1"), `the reviewer must come before the card: ${order.join(" → ")}`);
  // the review is not run again after the fix pass
  const reviewRuns = events.filter((e) => e.event === "stage" && e.stage === "narrative-refutation" && e.trigger === "stale-repair");
  assert.equal(reviewRuns.length, 1, "the review ran again after the fix pass — the ruling is one corrective pass, not a loop");
  // and delivery was not blocked by a review the fix pass left stale
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "the fix pass left a stage stale and delivery blocked");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(existsSync(join(res.runDir, ".delivered")));
  // RULING 719 — the pass is handed ONLY the flags on findings the repair changed. The late review carries
  // two: one on finding 1 (changed) and one on finding 2 (left alone). The fix pass's own dispatch, kept
  // verbatim in the run, carries the first and not the second.
  const sent = readdirSync(driverDir(res.runDir)).filter((n) => n.startsWith("synthesis.attempt1."))
    .map((n) => readFileSync(driverDir(res.runDir, n), "utf8"))
    .filter((t) => /registration date printed in the narrative contradicts/.test(t));
  assert.equal(sent.length, 1, `exactly one synthesis dispatch carries the late flag, found ${sent.length}`);
  assert.doesNotMatch(sent[0], /a second point about a finding the repair left alone/,
    "the fix pass was handed a flag on a finding the repair did not change");
  // the open points read the applied table: it holds the flag the pass was handed, and not the one it
  // never saw, which would otherwise read as an objection the run tried and could not close
  const applied = JSON.parse(readFileSync(driverDir(res.runDir, "corrections-applied.json"), "utf8"));
  assert.ok(Array.isArray(applied.rows) && applied.rows.some((r) => /registration date/.test(String(r.text ?? ""))),
    `the applied table is not the late review's: ${JSON.stringify(applied).slice(0, 300)}`);
  assert.ok(!applied.rows.some((r) => /a second point about a finding the repair left alone/.test(String(r.text ?? ""))),
    "the table records a flag the fix pass was never handed");
});

test("the fix pass ADDS to the corrective cycle's table: an objection the cycle could not close stays in the open points", async () => {
  const { res, events } = await runPipeline({ ...SCENARIO, MOCK_VERDICT: "CONDITIONAL", MOCK_NARRATIVE_OVER_CAP: "until-verdict",
    MOCK_VERDICT_DEFECTS: "- the narrative misstates the filing route of the earlier mark (mock)", MOCK_LATE_REVIEW_ON: "1" });
  // CONTROL — the corrective cycle ran on the first review and wrote its table before the repair
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "corrective"), "the first review fed no corrective cycle");
  assert.equal(events.filter((e) => e.event === "post-repair-fix-pass").length, 1, "the fix pass did not run");
  const rows = JSON.parse(readFileSync(driverDir(res.runDir, "corrections-applied.json"), "utf8")).rows ?? [];
  assert.ok(rows.some((r) => /misstates the filing route/.test(String(r.text ?? ""))),
    `the fix pass replaced the cycle's table and its objection left the open points: ${JSON.stringify(rows).slice(0, 300)}`);
  assert.ok(rows.some((r) => /registration date/.test(String(r.text ?? ""))), "the fix pass's own flag is missing");
  assert.equal(res.ok, true, JSON.stringify(res));
});

test("CONTROL — a re-run review whose flag names no changed finding triggers no fix pass", async () => {
  const { res, events } = await runPipeline(SCENARIO);
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "narrative-refutation" && e.trigger === "stale-repair" && e.ok === true),
    "the reviewer re-ran, so a fix pass was possible");
  assert.equal(events.filter((e) => e.event === "post-repair-fix-pass").length, 0, "a fix pass ran for a flag about no changed finding");
  assert.equal(res.ok, true, JSON.stringify(res));
});
