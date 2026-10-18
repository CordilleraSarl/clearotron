// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW AFTER A DELIVERY-CHECK REPAIR, END TO END ON THE MOCK PIPELINE, ON BOTH ENGINES.
//
// The delivery check finds a narrative that breaks a rule, the writer repairs its record, and the reviewer
// reads stale. It used to be sent the whole first review again, cold, under trigger `stale-repair`, and
// nothing applied what it then flagged. These drive the change: the reviewer is sent only what the repair
// changed and what rests on it (trigger `post-repair-review`); a rewrite with the same values sends nothing;
// its flags go to ONE writer correction (trigger `post-repair-corrective`) that nothing reviews; a narrowed
// CLEAR cannot soften a BLOCKING run; and when the scope is not certain the review stays whole, as before.
import { test, after } from "node:test";
import { pinEnv, pinEnvAll, envFrom } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisCallPaths } from "../synthesis-record.mjs";
import { repairBasePath } from "../repair-scope.mjs";

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
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const KNOBS = ["MOCK_VERDICT", "MOCK_VERDICT_DEFECTS", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_ACTIONS",
  "MOCK_LINT_REPAIR_TOUCH_FINDINGS", "MOCK_LINT_REPAIR_TOUCH_FINDING", "MOCK_REVIEW_BLOCKS_AFTER_VERDICT",
  "MOCK_NARRATIVE_OVER_CAP", "MOCK_POST_REPAIR_FLAGS", "MOCK_POST_REPAIR_VERDICT", "MOCK_LINT_REPAIR_SAME_VALUES"];

// The Codex run pins its own billing; every Claude run puts back what the suite started with.
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};

async function runPipeline(env, engine = "claude") {
  const root = tempDir("clearotron-post-repair-");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", ...env });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
const stageEvents = (events, stage, trigger) => events.filter((e) => e.event === "stage" && e.stage === stage && e.trigger === trigger);
/** Every message a stage was sent this run, the superseded ones included. */
const dispatches = (runDir, stage) => readdirSync(driverDir(runDir)).filter((f) => f.startsWith(`${stage}.attempt`) && f.includes(".dispatch.txt"))
  .map((f) => readFileSync(driverDir(runDir, f), "utf8"));
const REVIEW_OPENS = "This is a review of a repair, not a full review.";
const CORRECTION_OPENS = "After the delivery check, that record was repaired, and an independent review then read only what the repair changed and what rests on it.";

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: the review after a repair is sent only what the repair changed and what rests on it`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1" }, engine);
    // CONTROL: the delivery check failed and the writer's repair ran, or nothing below is about a repair.
    assert.ok(events.some((e) => e.event === "predelivery-lint-failed"), "the delivery check failed on the over-cap narrative");
    assert.equal(stageEvents(events, "synthesis", "lint-repair").length, 1, "the writer repaired its record");
    const narrowed = stageEvents(events, "narrative-refutation", "post-repair-review");
    assert.equal(narrowed.length, 1, "one review after the repair");
    assert.equal(narrowed[0].ok, true);
    assert.equal(stageEvents(events, "narrative-refutation", "stale-repair").length, 0, "and not the whole review again");
    const msg = dispatches(res.runDir, "narrative-refutation").find((m) => m.includes(REVIEW_OPENS));
    assert.ok(msg, "the review after the repair was dispatched with its own opening");
    assert.ok(msg.includes("WHAT THE REPAIR CHANGED. The driver worked this out from the writer's saved record before and after the repair."));
    assert.match(msg, /\n- the narrative's "The spine" section\. Before: .+ After: /, "the rewritten section, before and after");
    assert.ok(msg.includes("WHAT RESTS ON THESE CHANGES, as it reads now. Check that each still holds:"));
    assert.ok(msg.includes("- the narrative's \"Verdict\" section: "), "an unchanged section rests on the change");
    assert.ok(msg.includes("- For a narrative section: the source files in your declared inputs, below."));
    // The writer's whole re-save can also move a finding (it may restate a value the driver had settled), so
    // the line names the narrative and, when the record moved too, the findings record.
    assert.match(msg, /Since this run's last review, the repair has changed \S*narrative\.md( and \S*findings\.json)? where listed above; your other inputs have not changed\./);
    assert.ok(!msg.includes("Adversarially refute the narrative"), "never the order to review everything again");
    assert.ok(!msg.includes("PLAIN WORDS ON WHAT THE READER SEES FIRST"), "the plain-words list is not sent");
    // a CLEAR review with no flags sends nothing to the writer
    assert.equal(stageEvents(events, "synthesis", "post-repair-corrective").length, 0);
    const rec = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8"));
    assert.equal(rec.status, "read");
    assert.deepEqual(rec.changed.sections, ["The spine"]);
    assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "freshness is restored");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });
}

test("a repair that saves the same values again is no change: no review runs and delivery is not blocked", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_LINT_REPAIR_SAME_VALUES: "1" });
  assert.equal(stageEvents(events, "synthesis", "lint-repair").length, 1, "the writer's repair ran");
  assert.ok(events.some((e) => e.event === "post-repair-review-not-needed"), "the run says why no review ran");
  assert.ok(events.some((e) => e.event === "one-shot-stamp-settled" && e.stage === "narrative-refutation" && e.why === "repair-changed-no-content"),
    "the reviewer's stamp takes the rewrite as accounted for");
  assert.equal(stageEvents(events, "narrative-refutation", "post-repair-review").length, 0);
  assert.equal(stageEvents(events, "narrative-refutation", "stale-repair").length, 0);
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"));
  assert.equal(res.ok, true);
});

test("a repair that changed only the findings record still has its change reviewed, and the review says which file moved", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_LINT_REPAIR_SAME_VALUES: "finding" });
  assert.ok(events.some((e) => e.event === "post-repair-review-queued"), "the reviewer is queued although the narrative did not move");
  assert.equal(stageEvents(events, "narrative-refutation", "post-repair-review").length, 1);
  const msg = dispatches(res.runDir, "narrative-refutation").find((m) => m.includes(REVIEW_OPENS));
  assert.match(msg, /\n- Finding 1: legal_position changed\. Before: .+ After: .+The repair restates the specification\./);
  assert.match(msg, /the repair has changed \S*findings\.json where listed above; your other inputs have not changed\./,
    "the findings record, and only it");
  assert.ok(msg.includes("- For a finding: the records it cites, through band_record, and its row in placements.json."));
  assert.equal(res.ok, true);
});

test("the review's flags go to one correction by the writer; nothing reviews it, and what it did not close stays visible", async () => {
  const flags = [
    { kind: "narrative", text: "the narrative's \"The spine\" section: it still states the registration twice" },
    { kind: "fact", text: "A point the reviewer could not place on any listed item." },
  ];
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(flags) });
  assert.equal(stageEvents(events, "narrative-refutation", "post-repair-review").length, 1);
  const pass = stageEvents(events, "synthesis", "post-repair-corrective");
  assert.equal(pass.length, 1, "exactly one correction");
  assert.equal(stageEvents(events, "narrative-refutation", "post-repair-review").length + stageEvents(events, "narrative-refutation", "stale-repair").length, 1,
    "and no second review of it");
  const msg = dispatches(res.runDir, "synthesis").find((m) => m.includes(CORRECTION_OPENS));
  assert.ok(msg, "the correction was dispatched with its own opening");
  assert.ok(msg.includes("THE FLAGS NAME THESE ITEMS: the narrative's \"The spine\" section. Change only the items the flags are about"));
  assert.ok(msg.includes("A flag that names no item is applied to the item it is about;"));
  assert.ok(msg.includes("leave it standing; the point is recorded for the reviewing lawyer."));
  assert.ok(msg.includes(flags[0].text) && msg.includes(flags[1].text), "the flags, as recorded");
  assert.ok(!msg.includes("verify-flag for re-check"));
  const rec = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8"));
  assert.deepEqual(rec.points.map((p) => p.class), ["mapped", "unresolved"]);
  const applied = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-corrections.json"), "utf8")).rows;
  assert.equal(applied.length, 2);
  assert.match(applied[0].outcome, /^section-(changed|unchanged)$/, "a flag on a section is checked against the section");
  // EVERY POINT NOT SHOWN CLOSED PRINTS in the run's open-questions record, through the existing rule.
  const open = readFileSync(driverDir(res.runDir, "reviewer-open-questions.md"), "utf8");
  assert.ok(open.includes(flags[1].text), "the unplaced point is printed");
  assert.ok(!/raised by the review after/.test(open), "no new sentence is added to the record");
  // NOTHING RE-FIRES ON A RESUME: the reviewer is not left stale by the correction, and the first cycle's
  // receipt now fingerprints the bytes the correction left, so it reads as settled.
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), "the reviewer is not left stale by the correction");
  const { correctiveCycleSettledDecision } = await import("../pipeline.mjs");
  const { shaOf } = await import("../stage-freshness.mjs");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "corrective-cycle.json"), "utf8"));
  assert.equal(receipt.settledBy, "post-repair-cycle");
  assert.equal(correctiveCycleSettledDecision(receipt, { review: shaOf(join(res.runDir, "senior-eye-review.md")), narrative: shaOf(join(res.runDir, "narrative.md")) }), true);
  assert.equal(res.ok, true);
});

test("a narrowed CLEAR does not soften a BLOCKING run: the whole review stays the run's review", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "BLOCKING", MOCK_VERDICT_DEFECTS: "- the coined element is misquoted in the spine (mock)",
    MOCK_NARRATIVE_OVER_CAP: "until-lint-repair", MOCK_POST_REPAIR_FLAGS: "[]" });
  assert.equal(stageEvents(events, "narrative-refutation", "post-repair-review").length, 1, "the review after the repair ran");
  assert.ok(events.some((e) => e.event === "verdict-softening-not-adopted" && e.reviewSays === "CLEAR"), "its softer verdict is logged");
  assert.equal(res.verdict, "BLOCKING", "and not adopted");
  assert.match(readFileSync(join(res.runDir, "senior-eye-review.md"), "utf8"), /^BLOCKING/, "senior-eye-review.md is the whole review");
  assert.match(readFileSync(driverDir(res.runDir, "review-after-repair.md"), "utf8"), /^CLEAR/, "the narrowed one is kept under _driver/");
  assert.match(readFileSync(driverDir(res.runDir, "reviewer-open-questions.md"), "utf8"), /coined element is misquoted/,
    "the open questions still carry the whole review's grounds");
});

// ── WHEN THE SCOPE IS NOT CERTAIN THE REVIEW STAYS WHOLE ────────────────────────────────────────────────
test("the scope decision: no base, another input moved or a re-synthesis keeps the review whole; the same values need none", async () => {
  const { postRepairScope } = await import("../pipeline.mjs");
  const runDir = tempDir("post-repair-scope-");
  const P = { narrative: join(runDir, "narrative.md"), findings: join(runDir, "findings.json") };
  const record = (verdict) => ({ narrative: { verdict, spine: "S." }, findings: { schema_version: 7, rated_under_framework: "house-default", findings: [{ ordinal: 1, mark: "NOVA" }] } });
  const { dir, accepted } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(repairBasePath(runDir), JSON.stringify({ params: record("V.") }));
  writeFileSync(accepted, JSON.stringify({ params: record("A new verdict.") }));
  const s2 = (names) => ({ label: "narrative-refutation", changed: names.map((name) => ({ name })) });
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: false }).mode, "whole", "no base kept");
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md", "register-findings.md"]), { baseKept: true }).mode, "whole", "another input moved");
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true, staleRepaired: ["synthesis"] }).mode, "whole", "a whole re-synthesis ran");
  const narrowed = postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true });
  assert.equal(narrowed.mode, "narrowed");
  assert.deepEqual(narrowed.changed.sections.map((x) => x.title), ["Verdict"]);
  writeFileSync(accepted, JSON.stringify({ params: record(" V. ") }));
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true }).mode, "none", "the same values, re-spaced");
  writeFileSync(accepted, JSON.stringify({ params: { ...record("V."), findings: { ...record("V.").findings, schema_version: 6 } } }));
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true }).mode, "whole", "a changed version");
});
