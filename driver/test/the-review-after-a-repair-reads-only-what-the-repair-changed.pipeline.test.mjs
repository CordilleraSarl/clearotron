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
import { repairBasePath, writePostRepairRecord } from "../repair-scope.mjs";

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
  "MOCK_NARRATIVE_OVER_CAP", "MOCK_POST_REPAIR_FLAGS", "MOCK_POST_REPAIR_VERDICT", "MOCK_LINT_REPAIR_SAME_VALUES",
  "MOCK_POST_REPAIR_UNREAD", "MOCK_WHOLE_FALLBACK_FLAGS", "MOCK_WHOLE_FALLBACK_VERDICT", "MOCK_LATE_SAVE_ADDS"];

// The Codex run pins its own billing; every Claude run puts back what the suite started with.
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};

async function runPipeline(env, engine = "claude", { codename = null } = {}) {
  const root = codename ? process.env.CLEAROTRON_WORK_DIR : tempDir("clearotron-post-repair-");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", ...env });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, codename ? { codename } : {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
const stageEvents = (events, stage, trigger) => events.filter((e) => e.event === "stage" && e.stage === stage && e.trigger === trigger);
/** Every message a stage was sent this run, the superseded ones included. */
const dispatches = (runDir, stage) => readdirSync(driverDir(runDir)).filter((f) => f.startsWith(`${stage}.attempt`) && f.includes(".dispatch.txt"))
  .map((f) => readFileSync(driverDir(runDir, f), "utf8"));
const REVIEW_OPENS = "This is a review of a repair, not a full review.";
const CORRECTION_OPENS = "After the delivery check, that record was repaired, and an independent review then read only what the repair changed and what rests on it.";
// The same correction, after a whole review (design's wording, 2026-10-18).
const WHOLE_CORRECTION_OPENS = "After the delivery check, that record was repaired, and the full independent review ran again.";

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

test("a findings-only change whose review cannot be read falls back to the whole review, and its flags go to the same one correction", async () => {
  const flags = [{ kind: "fact", text: "An invented point the whole review raised about the changed finding." }];
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_LINT_REPAIR_SAME_VALUES: "finding",
    MOCK_POST_REPAIR_UNREAD: "narrowed", MOCK_WHOLE_FALLBACK_FLAGS: JSON.stringify(flags) });
  const reads = events.filter((e) => e.event === "post-repair-review");
  assert.deepEqual(reads.map((e) => [e.read, e.whole ?? false]), [[false, false], [true, true]], `the two reads: ${JSON.stringify(reads)}`);
  assert.equal(stageEvents(events, "synthesis", "post-repair-corrective").length, 1, "the whole review's flags go to the one correction");
  const msg = dispatches(res.runDir, "synthesis").find((m) => m.includes(WHOLE_CORRECTION_OPENS));
  assert.ok(msg?.includes(flags[0].text), "the correction carries the whole review's flag, under the whole review's opening");
  assert.ok(!msg.includes(CORRECTION_OPENS), "the correction says a whole review read only the change");
  // …and its verdict is decided by the late-review rule every review here goes through: its CONDITIONAL hardens the run.
  assert.ok(events.some((e) => e.event === "verdict-hardened-by-repair" && e.now === "CONDITIONAL"), "the whole review's verdict never reached the late-review rule");
  assert.equal(res.verdict, "CONDITIONAL");
  assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8")).status, "read");
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
});

test("when neither review of a findings-only change can be read, the change is recorded unreviewed and the run still delivers", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_LINT_REPAIR_SAME_VALUES: "finding",
    MOCK_POST_REPAIR_UNREAD: "both" });
  const rec = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8"));
  assert.deepEqual([rec.status, rec.findingOnly, rec.whole], ["unread", true, true], "the record says the changed findings were not reviewed");
  assert.equal(stageEvents(events, "synthesis", "post-repair-corrective").length, 0, "nothing was reviewed, so nothing is corrected");
  // A RUN IS NEVER HELD ON AN UNREAD REVIEW: it delivers, as the released engine delivers it (owner's ruling, 2026-10-19).
  assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), `the guard held the run: ${JSON.stringify(events.map((e) => e.event).slice(-12))}`);
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
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

// ── NO CHANGE GOES UNREVIEWED, AND NO POINT IS LOST ─────────────────────────────────────────────────────
const codenameOf = (runDir) => runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
const openQuestions = (runDir) => (existsSync(driverDir(runDir, "reviewer-open-questions.md")) ? readFileSync(driverDir(runDir, "reviewer-open-questions.md"), "utf8") : "");

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a narrative repair whose review cannot be read falls back to the whole review, and when neither is read the run still delivers`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_UNREAD: "both" }, engine);
    assert.equal(stageEvents(events, "synthesis", "lint-repair").length, 1, "premise: the writer repaired the narrative");
    const reads = events.filter((e) => e.event === "post-repair-review");
    assert.deepEqual(reads.map((e) => [e.read, e.whole ?? false]), [[false, false], [false, true]], `the two reads: ${JSON.stringify(reads)}`);
    const rec = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8"));
    assert.deepEqual([rec.status, rec.findingOnly], ["unread", false], "the record does not say the narrative change went unreviewed");
    assert.ok(!events.some((e) => e.event === "delivery-stale-blocked"), `the guard held the run: ${JSON.stringify(events.map((e) => e.event).slice(-12))}`);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: a point that hardened the verdict stays in the reviewing lawyer's record after the correction changes what it names`, async () => {
    const flags = [{ kind: "fact", text: "An invented point the review after the repair raised about finding 1.", on: [1] }];
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_LINT_REPAIR_SAME_VALUES: "finding",
      MOCK_POST_REPAIR_FLAGS: JSON.stringify(flags) }, engine);
    assert.ok(events.some((e) => e.event === "verdict-hardened-by-repair" && e.now === "CONDITIONAL"), "premise: the review after the repair hardened the verdict");
    assert.equal(stageEvents(events, "synthesis", "post-repair-corrective").length, 1, "premise: its one correction ran");
    const doc = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-corrections.json"), "utf8"));
    assert.equal(doc.grounds, true, "the correction's record does not say its points are the verdict's grounds");
    assert.equal(doc.rows[0].outcome, "findings-changed", "premise: the correction changed the finding the point names");
    const open = openQuestions(res.runDir);
    assert.ok(open.includes(flags[0].text), "the CONDITIONAL label shipped with no visible ground");
    assert.ok(open.includes("the run could not check whether this was addressed"), "the changed point is not marked unchecked");
    assert.ok(!open.includes("the report did not change in response"), "the observed change is relabelled as unchanged");
    assert.ok(!readFileSync(join(res.runDir, "report.md"), "utf8").includes(flags[0].text), "the point reached the client's report");
    assert.equal(res.verdict, "CONDITIONAL");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });
}

test("a finding the correction after the review adds gets its card, and the delivered report carries it", async () => {
  const flags = [{ kind: "fact", text: "An invented point about finding 1.", on: [1] }];
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_LINT_REPAIR_SAME_VALUES: "finding",
    MOCK_POST_REPAIR_FLAGS: JSON.stringify(flags), MOCK_LATE_SAVE_ADDS: "1" });
  const fix = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "post-repair-corrective");
  assert.ok(fix >= 0, "premise: the correction ran");
  const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.ok(doc.findings.some((f) => f.owner?.name === "Mystery Owner 2 LLC"), "premise: the correction's save added a finding");
  assert.ok(events.slice(fix).some((e) => e.event === "stage" && e.stage === "report-card:2" && e.ok === true), "no card was built for the added finding");
  assert.ok(readFileSync(join(res.runDir, "report.md"), "utf8").includes("Mock filing detail for Mystery Owner 2 LLC."),
    "the delivered report does not carry the added finding's card");
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
});

test("a narrative repair whose review is refused, on a stage that still reads ok, is reviewed whole before it is delivered", async () => {
  // The refused call leaves the earlier review's file standing, so the stage reads ok: only the accepted call counts.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: "[]", MOCK_POST_REPAIR_VERDICT: "BLOCKING" });
  const reads = events.filter((e) => e.event === "post-repair-review");
  assert.deepEqual(reads.map((e) => [e.read, e.whole ?? false]), [[false, false], [true, true]], `the two reads: ${JSON.stringify(reads)}`);
  assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8")).status, "read");
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
});

// A CHANGE AN EARLIER PASS LEFT UNREVIEWED, ON A RUN THAT STOPPED BEFORE DELIVERY FOR ANOTHER CAUSE. A run is never
// held on an unread review, so only a stop for some other cause leaves such a change to a resume: pass 1 stops at the
// report overview, after the first full review, and the record an earlier repair would have left is written beside
// it, with the mock's mark that the narrowed review of that repair went unread.
const STOP_AT_OVERVIEW = "record_report_overview";
async function stoppedWithAnUnreadChange(engine) {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: STOP_AT_OVERVIEW }, engine);
  assert.notEqual(res.ok, true, "premise: pass 1 stopped before delivery");
  assert.equal(res.failedStage, "report-overview", `premise: pass 1 stopped at the overview, after the first full review (stopped at ${res.failedStage})`);
  writePostRepairRecord(res.runDir, { status: "unread", whole: true, findingOnly: false, fail: "no-accepted-call" });
  writeFileSync(`${res.runDir}.mock-post-repair-unread`, "1\n");
  return { res, events };
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a resume's whole review that is refused does not mark the unreviewed change read, and the resume still delivers`, async () => {
    const { res: r1, events: e1 } = await stoppedWithAnUnreadChange(engine);
    const codename = codenameOf(r1.runDir);
    // The resume runs no repair of its own: the record queues the reviewer, and its whole review is a call the tool
    // refuses, on a stage that reads ok on the earlier review's file.
    const { res: r2, events: all2 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_POST_REPAIR_UNREAD: "narrowed", MOCK_WHOLE_FALLBACK_FLAGS: "[]",
      MOCK_WHOLE_FALLBACK_VERDICT: "BLOCKING" }, engine, { codename });
    const e2 = all2.slice(e1.length);   // the run log carries every pass: this one's rows only
    assert.ok(e2.some((e) => e.event === "post-repair-review-queued" && /went unreviewed/.test(e.why)), "premise: the record queued the reviewer");
    assert.equal(stageEvents(e2, "synthesis", "lint-repair").length, 0, "premise: the resume ran no repair of its own");
    assert.ok(stageEvents(e2, "narrative-refutation", "stale-repair").some((e) => e.ok === true), "premise: the whole review's stage read ok");
    assert.equal(JSON.parse(readFileSync(driverDir(r2.runDir, "post-repair-review.json"), "utf8")).status, "unread",
      "a whole review the tool refused marked the change read");
    // …and the resume delivers all the same: a run is never held on an unread review. A whole review that is read
    // closes the record (the next test).
    assert.ok(!e2.some((e) => e.event === "delivery-stale-blocked"), "the guard held the resume");
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 300));
  });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a resume's whole review of an unreviewed change sends its flags to the one correction`, async () => {
    const { res: r1, events: e1 } = await stoppedWithAnUnreadChange(engine);
    const flags = [{ kind: "fact", text: "An invented point the resumed whole review raised about the repaired narrative." }];
    const { res: r2, events: all2 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_POST_REPAIR_UNREAD: "narrowed", MOCK_WHOLE_FALLBACK_FLAGS: JSON.stringify(flags) },
      engine, { codename: codenameOf(r1.runDir) });
    const e2 = all2.slice(e1.length);
    assert.deepEqual(e2.filter((e) => e.event === "post-repair-review").map((e) => [e.read, e.whole ?? false]), [[true, true]], "the resume's review is not the whole review, read once");
    assert.equal(stageEvents(e2, "synthesis", "post-repair-corrective").length, 1, "the whole review's flags went to no correction");
    const msg = dispatches(r2.runDir, "synthesis").find((m) => m.includes(WHOLE_CORRECTION_OPENS) && m.includes(flags[0].text));
    assert.ok(msg, "the correction does not carry the whole review's flag");
    assert.ok(e2.some((e) => e.event === "verdict-hardened-by-repair" && e.now === "CONDITIONAL"), "its verdict never reached the late-review rule");
    const rec = JSON.parse(readFileSync(driverDir(r2.runDir, "post-repair-review.json"), "utf8"));
    assert.equal(rec.status, "read");
    assert.equal(rec.findingOnly, false, "the resume relabelled a narrative change as a change to the findings alone");
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 300));
  });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a change no review read is reviewed whole on a resume, even when the resume's own repair could be narrowed`, async () => {
    const { res: r1, events: e1 } = await stoppedWithAnUnreadChange(engine);
    assert.equal(JSON.parse(readFileSync(driverDir(r1.runDir, "post-repair-review.json"), "utf8")).status, "unread", "premise: the change is on record unreviewed");
    // Between the passes the record's first finding gains a search count in its own sentence, so the resume's delivery
    // check sends a fault of its own to the writer, and that repair alone could be reviewed narrowed.
    const SENTENCE = " The search ran 14 queries across the register.";
    const { accepted } = synthesisCallPaths(r1.runDir);
    const acc = JSON.parse(readFileSync(accepted, "utf8"));
    acc.params.findings.findings[0].net = `${acc.params.findings.findings[0].net}${SENTENCE}`;
    writeFileSync(accepted, JSON.stringify(acc, null, 2) + "\n");
    const fj = JSON.parse(readFileSync(join(r1.runDir, "findings.json"), "utf8"));
    fj.findings[0].net = `${fj.findings[0].net}${SENTENCE}`;
    writeFileSync(join(r1.runDir, "findings.json"), JSON.stringify(fj, null, 2) + "\n");
    const { res: r2, events: all2 } = await runPipeline({ MOCK_VERDICT: "CLEAR" }, engine, { codename: codenameOf(r1.runDir) });
    const e2 = all2.slice(e1.length);
    assert.equal(stageEvents(e2, "synthesis", "lint-repair").length, 1, "premise: the resume repaired a fault of its own");
    assert.deepEqual(e2.filter((e) => e.event === "post-repair-review").map((e) => [e.read, e.whole ?? false]), [[true, true]],
      "the resume reviewed only its own change, and called the earlier change read");
    assert.equal(stageEvents(e2, "narrative-refutation", "post-repair-review").length, 0, "the resume sent the review of its own repair alone");
    const rec = JSON.parse(readFileSync(driverDir(r2.runDir, "post-repair-review.json"), "utf8"));
    assert.deepEqual([rec.status, rec.whole], ["read", true]);
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 300));
  });
}

test("a change to the findings record alone is owed a review unless it saves the same values, even when it cannot be narrowed", async () => {
  const { recordChangeOwesReview } = await import("../pipeline.mjs");
  const runDir = tempDir("post-repair-owed-");
  const record = (over = {}) => ({ narrative: { verdict: "V.", spine: "S." }, findings: { schema_version: 7, rated_under_framework: "house-default", findings: [{ ordinal: 1, mark: "NOVA" }], ...over } });
  const { dir, accepted } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(repairBasePath(runDir), JSON.stringify({ params: record() }));
  writeFileSync(accepted, JSON.stringify({ params: record() }));
  assert.equal(recordChangeOwesReview(runDir), false, "the same values saved again");
  writeFileSync(accepted, JSON.stringify({ params: record({ findings: [{ ordinal: 1, mark: "NOVA", net: "A new sentence." }] }) }));
  assert.equal(recordChangeOwesReview(runDir), true, "a changed finding");
  writeFileSync(accepted, JSON.stringify({ params: record({ schema_version: 6 }) }));
  assert.equal(recordChangeOwesReview(runDir), true, "a change the scope cannot narrow went unqueued");
  rmSync(repairBasePath(runDir));
  assert.equal(recordChangeOwesReview(runDir), true, "a record that cannot be compared went unqueued");
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
  for (const upstream of ["placement-inquiry", "register-digest", "skeptic"])
    assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true, staleRepaired: [upstream] }).mode, "whole", `${upstream} re-ran ahead of the review`);
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true, staleRepaired: ["report-card:2", "report-overview"] }).mode, "narrowed",
    "a rebuilt card or overview is no upstream change");
  const narrowed = postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true });
  assert.equal(narrowed.mode, "narrowed");
  assert.deepEqual(narrowed.changed.sections.map((x) => x.title), ["Verdict"]);
  writeFileSync(accepted, JSON.stringify({ params: record(" V. ") }));
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true }).mode, "none", "the same values, re-spaced");
  writeFileSync(accepted, JSON.stringify({ params: { ...record("V."), findings: { ...record("V.").findings, schema_version: 6 } } }));
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true }).mode, "whole", "a changed version");
});
