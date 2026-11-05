// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the recheck after a correction end to end on the mock pipeline, on both engines
//
// A REVIEW SAVED AS A FILE MEETS THE RULES THE TYPED ROUTE KEEPS.
//
// A recheck may save its review through the tool or by rewriting the file. Changed bytes show the review is fresh; they
// do not show it can be accepted. These drive the difference: a review the tool would refuse, written into the file, is
// not read as the review of the corrected record. It leaves no receipt and the entry verdict, and the earlier review's
// bytes stand. A review the tool would accept completes the cycle on either route, a legacy one with no tokens included.
// No review is added and no sentence reaches a client: the check is one read of the file.
import { test, after } from "node:test";
import { pinEnv, pinEnvAll, envFrom } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { shaOf } from "../stage-freshness.mjs";
import { acceptRefutation, acceptReviewFile, planAuditLines, recordRefutation, settleRecheckSave, REVIEW_FILE } from "../narrative-refutation-record.mjs";

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
const KNOBS = ["MOCK_RECHECK_SAVES_FILE", "MOCK_RECHECK_TYPED_FIRST"];
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};

const EARLIER = "an invented ground the review before the correction raised (mock)";
const SAVED = "An invented point of the review saved as a file (mock).";
const TYPED = "An invented point the typed save raised (mock).";
const HEADING = "#### Earlier review — correction not rechecked";   // an em dash, as approved
const flagged = (verdict, tokens = "[kind: fact] [on: 1]") => `${verdict}\n\n## Flags\n\n1. ${tokens} ${SAVED}\n\n{KEEP_AUDIT}`;
const UNLISTED = "[kind: fact] [on: -] [positions: /mark/zz/nowhere]";

async function runPipeline(body, { engine = "claude", typedFirst = false } = {}) {
  const root = tempDir("clearotron-recheck-file-");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", MOCK_VERDICT: "CONDITIONAL",
    MOCK_VERDICT_DEFECTS: `- ${EARLIER}`, MOCK_RECHECK_SAVES_FILE: body, ...(typedFirst ? { MOCK_RECHECK_TYPED_FIRST: "1" } : {}) });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
const recheckRecord = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "corrective-recheck.json"), "utf8"));
const reviewFile = (runDir) => join(runDir, "senior-eye-review.md");
const openPoints = (runDir) => readFileSync(driverDir(runDir, "reviewer-open-questions.md"), "utf8");
const REVIEWS = (e) => e.event === "stage" && e.stage === "narrative-refutation";

/** A review that could not be accepted: nothing about the recheck reads as done, and the run still delivers. */
function assertNotRead({ res, events }) {
  const rec = recheckRecord(res.runDir);
  assert.equal(rec.status, "unread");
  assert.equal(rec.verdict, "CONDITIONAL", "the entry verdict stands");
  assert.ok(!existsSync(driverDir(res.runDir, "corrective-cycle.json")), "a refused save wrote the completion receipt");
  assert.equal(events.find((e) => e.event === "verdict-2")?.read, false, "the verdict after it reads as verified");
  // THE EARLIER REVIEW'S OWN BYTES, not refused ones in their place.
  assert.equal(shaOf(reviewFile(res.runDir)), rec.reviewSha, "the refused bytes stayed in place of the earlier review");
  const review = readFileSync(reviewFile(res.runDir), "utf8");
  assert.ok(review.includes(EARLIER) && !review.includes(SAVED), "the review in place is not the earlier one");
  // The reviewing lawyer's record names that review's points as the earlier review's, and carries none of the refused ones.
  const open = openPoints(res.runDir);
  assert.ok(open.includes(HEADING) && open.includes(EARLIER) && !open.includes(SAVED), open);
  // ONE RECHECK, NO LOOP: the first review and its recheck, and the run delivers.
  assert.equal(events.filter(REVIEWS).length, 2, "an extra review was dispatched");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL");
  return rec;
}

// ── THE CASES, ON THE MOCK PIPELINE ────────────────────────────────────────────────────────────────────────────────

for (const [name, body, token] of [
  ["a BLOCKING that names no defect", "BLOCKING\n\nNo flags raised.\n\n{KEEP_AUDIT}", "refutation_blocking_without_flags"],
  ["a flag on a position the writer's list does not give", flagged("CONDITIONAL", UNLISTED), "refutation_flag_position_unlisted"],
  ["audit words that appear only inside a flag", `CONDITIONAL\n\n## Flags\n\n1. [kind: fact] [on: 1] The PLAN-EXECUTION CHECK is named here. ${SAVED}\n`, "refutation_plan_audit_missing"],
  ["a CLEAR that would lift the condition", flagged("CLEAR", UNLISTED), "refutation_flag_position_unlisted"],
]) {
  test(`refused, on a stage that reads ok: ${name}`, async () => {
    const run = await runPipeline(body);
    assert.ok(run.events.some(REVIEWS) && run.events.filter(REVIEWS).at(-1)?.ok, "premise: the recheck's stage read ok");
    const rec = assertNotRead(run);
    assert.ok(rec.fail.startsWith(`file-save-refused:${token}`), rec.fail);
    assert.ok(run.events.some((e) => e.event === "verdict-recheck-unread" && e.fail === rec.fail), "the run's log does not name the refusal");
    // The workbook's row keeps its shipped words; the cause in the run's record names the refusal.
    const { NOT_COMPLETED } = await import("../degraded-parts.mjs");
    const checks = JSON.parse(readFileSync(driverDir(run.res.runDir, "degraded-parts.json"), "utf8")).parts.find((p) => p.part === "checks");
    assert.equal(checks?.reason, NOT_COMPLETED);
    assert.ok(String(checks?.cause).includes(`the review it saved as a file was refused (${token}`), String(checks?.cause));
  });
}

// The file's own validator already fails these two, and the stage reads failed. What is new is the bytes.
for (const [name, body] of [
  ["a fresh but invalid verdict", "SIGNED\n\nNo flags raised.\n\n{KEEP_AUDIT}"],
  ["no plan audit at all", "CONDITIONAL\n\nNo flags raised.\n"],
]) {
  test(`refused, on a stage that fails its validator: ${name}`, async () => {
    const run = await runPipeline(body);
    assert.equal(run.events.filter(REVIEWS).at(-1)?.ok, false, "premise: the recheck's stage failed");
    const rec = assertNotRead(run);
    assert.ok(rec.fail && !rec.fail.startsWith("file-save-refused:"), rec.fail);
  });
}

for (const [name, body] of [
  ["a typed review's file equivalent", flagged("CONDITIONAL")],
  ["a legacy review with no kind or finding token", `CONDITIONAL\n\n- ${SAVED}\n\n{KEEP_AUDIT}`],
]) {
  test(`completes the cycle: ${name}`, async () => {
    const { res, events } = await runPipeline(body);
    const rec = recheckRecord(res.runDir);
    assert.deepEqual([rec.status, rec.by, rec.seq, rec.verdict], ["read", "file", null, "CONDITIONAL"]);
    assert.ok(existsSync(driverDir(res.runDir, "corrective-cycle.json")), "a valid save wrote no receipt");
    assert.ok(readFileSync(reviewFile(res.runDir), "utf8").includes(SAVED), "a valid save was put back");
    assert.equal(events.filter(REVIEWS).length, 2);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok(!openPoints(res.runDir).includes(HEADING), "the earlier review's heading stands over a recheck that saved a review");
  });
}

test("a valid CLEAR saved as a file lifts the condition, as the same review does through the tool", async () => {
  const { res } = await runPipeline("CLEAR\n\nNo flags raised.\n\n{KEEP_AUDIT}");
  const rec = recheckRecord(res.runDir);
  assert.deepEqual([rec.status, rec.by, rec.verdict], ["read", "file", "CLEAR"]);
  assert.ok(existsSync(driverDir(res.runDir, "corrective-cycle.json")));
});

test("a typed save followed by a refused rewrite: the typed review stands, and the refused bytes are gone", async () => {
  const { res, events } = await runPipeline("BLOCKING\n\nNo flags raised.\n\n{KEEP_AUDIT}", { typedFirst: true });
  const rec = recheckRecord(res.runDir);
  assert.deepEqual([rec.status, rec.by, rec.verdict], ["read", "tool", "CONDITIONAL"]);
  assert.ok(rec.seq >= rec.seq0, "the recorded call is not this recheck's");
  const review = readFileSync(reviewFile(res.runDir), "utf8");
  assert.ok(review.startsWith("CONDITIONAL") && review.includes(TYPED), "the typed review is not in place");
  assert.equal(events.find((e) => e.event === "verdict-recheck-file-save-refused")?.refused, "refutation_blocking_without_flags");
  assert.ok(existsSync(driverDir(res.runDir, "corrective-cycle.json")), "the accepted typed review completes the cycle");
});

test("a typed save followed by a valid rewrite: the file is the review, and it is recorded as saved that way", async () => {
  const { res } = await runPipeline(flagged("CONDITIONAL"), { typedFirst: true });
  const rec = recheckRecord(res.runDir);
  assert.deepEqual([rec.status, rec.by, rec.seq], ["read", "file", null]);
  assert.ok(readFileSync(reviewFile(res.runDir), "utf8").includes(SAVED));
});

test("codex: a refused save and a valid save take the same paths", async () => {
  const refused = await runPipeline(flagged("CONDITIONAL", UNLISTED), { engine: "codex" });
  assert.ok(assertNotRead(refused).fail.startsWith("file-save-refused:refutation_flag_position_unlisted"));
  const valid = await runPipeline(flagged("CONDITIONAL"), { engine: "codex" });
  assert.deepEqual([recheckRecord(valid.res.runDir).status, recheckRecord(valid.res.runDir).by], ["read", "file"]);
  assert.ok(existsSync(driverDir(valid.res.runDir, "corrective-cycle.json")));
});

// ── THE TWO ROUTES AGREE ───────────────────────────────────────────────────────────────────────────────────────────

const POSITION = "/mark/zz/invented1";
const positionsListed = new Map([[POSITION, POSITION]]);
const typedReview = {
  verdict: "CONDITIONAL",
  flags: [
    { kind: "rating", text: "An invented point about a finding.", on: [2, 3] },
    { kind: "narrative", text: "An invented point about the document." },
    { kind: "coverage-disposition", text: "An invented point about a position.", positions: [POSITION] },
  ],
  plan_audit: ["Audited the receipt: every slice ran.", "No clean claim rests on a missing slice."],
};

test("a typed review and its file read back to the same verdict, flags, targets and audit", () => {
  const rules = { receiptPresent: true, positionsListed };
  const typed = acceptRefutation(typedReview, rules);
  assert.equal(typed.ok, true, typed.reason);
  const file = acceptReviewFile(typed.content, rules);
  assert.equal(file.ok, true, file.reason);
  assert.equal(file.verdict, typedReview.verdict);
  assert.deepEqual(file.flags.map((f) => [f.kind, f.ordinals, f.positions ?? null, f.text]), [
    ["rating", [2, 3], null, typedReview.flags[0].text],
    ["narrative", [], null, typedReview.flags[1].text],
    ["coverage-disposition", [], [POSITION], typedReview.flags[2].text],
  ]);
  assert.deepEqual(file.planAudit, typedReview.plan_audit);
});

test("a rewrite that lists the flags it answered reads back to the flags it raised, and a refusal prints only those", () => {
  const rules = { receiptPresent: true, positionsListed };
  const typed = acceptRefutation(typedReview, rules);
  const answered = ["## Prior flags rechecked", "", "- An invented earlier flag, answered.", "- Another invented earlier flag, answered.", ""].join("\n");
  const file = typed.content.replace("## PLAN-EXECUTION CHECK", `${answered}\n## PLAN-EXECUTION CHECK`);
  const read = acceptReviewFile(file, rules);
  assert.equal(read.ok, true, read.reason);
  assert.deepEqual(read.flags.map((f) => f.text), typedReview.flags.map((f) => f.text));
});

test("what the tool refuses, the file refuses with the same token", () => {
  const rules = { receiptPresent: true, positionsListed };
  const audit = "\n## PLAN-EXECUTION CHECK\n\nAudited the receipt.\n";
  for (const [params, file] of [
    [{ verdict: "BLOCKING", flags: [], plan_audit: ["x"] }, `BLOCKING\n\nNo flags raised.\n${audit}`],
    [{ verdict: "SIGNED", flags: [], plan_audit: ["x"] }, `SIGNED\n\nNo flags raised.\n${audit}`],
    [{ verdict: "CONDITIONAL", flags: [{ kind: "fact", text: "An invented point.", positions: ["/mark/zz/nowhere"] }], plan_audit: ["x"] },
      `CONDITIONAL\n\n1. [kind: fact] [positions: /mark/zz/nowhere] An invented point.\n${audit}`],
    [{ verdict: "CONDITIONAL", flags: [{ kind: "fact", text: "An invented point.", on: [0] }], plan_audit: ["x"] },
      `CONDITIONAL\n\n1. [kind: fact] [on: 0] An invented point.\n${audit}`],
    [{ verdict: "CONDITIONAL", flags: [{ kind: "fact", text: " " }], plan_audit: ["x"] }, `CONDITIONAL\n\n1. [kind: fact] [on: 1] \n${audit}`],
    [{ verdict: "CONDITIONAL", flags: [] }, "CONDITIONAL\n\nNo flags raised.\n"],
  ]) {
    const token = (r) => r.reason.split(/[: ]/)[0];
    const typed = acceptRefutation(params, rules);
    const read = acceptReviewFile(file, rules);
    assert.equal(typed.ok, false, JSON.stringify(params));
    assert.equal(read.ok, false, file);
    assert.equal(token(read), token(typed), file);
  }
  // Where no list was written, a flag naming a position is refused on both routes rather than guessed at.
  assert.equal(acceptReviewFile(`CONDITIONAL\n\n1. [kind: fact] [positions: ${POSITION}] An invented point.\n`, { positionsListed: null }).ok, false);
});

test("a difference of form is not refused: no tokens, an unknown kind, other enumeration, and an audit written in its own way", () => {
  const rules = { receiptPresent: true, positionsListed };
  const audit = "\n## PLAN-EXECUTION CHECK\n\nAudited the receipt.\n";
  for (const file of [
    `CONDITIONAL\n\n- An invented point with no tokens.\n${audit}`,
    `CONDITIONAL\n\n**A. [kind: nonsense]** An invented point of an unknown kind.\n${audit}`,
    `BLOCKING\n\n**1. [kind: fact] [on: 2]** An invented ground.\n${audit}`,
    `BLOCKING\n\n## Flagged corrections\n\n- An invented ground with no tokens.\n${audit}`,
    "CLEAR\n\nNo flags raised.\n\nPLAN-EXECUTION CHECK: every slice ran.\n",
    "CLEAR\n\nNo flags raised.\n\n**PLAN-EXECUTION CHECK**\n\nEvery slice ran.\n",
    "CLEAR\n\nNo flags raised.\n\n## PLAN-EXECUTION CHECK\n\n## The receipt, read\n\n### One band\n\nEvery slice ran.\n",
  ]) {
    const read = acceptReviewFile(file, rules);
    assert.equal(read.ok, true, `${read.reason}\n${file}`);
    assert.ok(planAuditLines(file).length > 0, file);
  }
  // A heading with nothing under it, or with only the flags under it, audits nothing.
  for (const file of ["CLEAR\n\nNo flags raised.\n\n## PLAN-EXECUTION CHECK\n", "CONDITIONAL\n\n## PLAN-EXECUTION CHECK\n\n## Flags\n\n1. [kind: fact] [on: 1] An invented point.\n"]) {
    assert.deepEqual(planAuditLines(file), [], file);
    assert.equal(acceptReviewFile(file, rules).reason, "refutation_plan_audit_missing", file);
  }
  // A run with no receipt owes no audit.
  assert.equal(acceptReviewFile("CLEAR\n\nNo flags raised.\n", { receiptPresent: false }).ok, true);
});

// ── THE ONE DECISION, STATE BY STATE ───────────────────────────────────────────────────────────────────────────────

function settledRun({ now, calls = [] }) {
  const dir = tempDir("clearotron-recheck-settle-");
  mkdirSync(driverDir(dir), { recursive: true });
  const before = "CONDITIONAL\n\n1. [kind: fact] [on: 1] An invented earlier point.\n";
  writeFileSync(join(dir, REVIEW_FILE), before);
  for (const c of calls) assert.ok(recordRefutation(dir, c).written, "premise: the typed save was accepted");
  if (now === null) rmSync(join(dir, REVIEW_FILE));
  else if (now !== undefined) writeFileSync(join(dir, REVIEW_FILE), now === "before" ? before : now);
  return { dir, before };
}
const SAVE = { verdict: "CONDITIONAL", flags: [{ kind: "fact", text: TYPED }] };
const rendered = acceptRefutation(SAVE).content;
const VALID = "CLEAR\n\nNo flags raised.\n";
const INVALID = "BLOCKING\n\nNo flags raised.\n";

test("settleRecheckSave: each state reads what it should, and leaves the right review in place", () => {
  const settle = ({ dir, before }, stageOk = true) => settleRecheckSave(dir, { before, stageOk, seq0: 1 });
  const none = (extra) => ({ read: null, fail: null, refused: null, restore: null, ...extra });
  // Nothing saved.
  assert.deepEqual(settle(settledRun({})), none({ fail: "no-accepted-call" }));
  // Through the tool, and through the tool with the same bytes as the earlier review.
  assert.deepEqual(settle(settledRun({ calls: [SAVE] })), none({ read: { by: "tool", seq: 1 } }));
  // As a file: valid, and refused with nothing to give way to but the earlier review.
  assert.deepEqual(settle(settledRun({ now: VALID })), none({ read: { by: "file", seq: null } }));
  const refused = settledRun({ now: INVALID });
  assert.deepEqual(settle(refused), none({ fail: "file-save-refused:refutation_blocking_without_flags", refused: "refutation_blocking_without_flags", restore: refused.before }));
  // Both: a valid rewrite is the review, a refused one gives way to the call, and the earlier bytes put back do too.
  assert.deepEqual(settle(settledRun({ calls: [SAVE], now: VALID })), none({ read: { by: "file", seq: null } }));
  assert.deepEqual(settle(settledRun({ calls: [SAVE], now: INVALID })), none({ read: { by: "tool", seq: 1 }, refused: "refutation_blocking_without_flags", restore: rendered }));
  assert.deepEqual(settle(settledRun({ calls: [SAVE], now: "before" })), none({ read: { by: "tool", seq: 1 }, restore: rendered }));
  // A file that went missing gives way the same way.
  const gone = settledRun({ now: null });
  assert.deepEqual(settle(gone), none({ fail: "no-accepted-call", restore: gone.before }));
  // A stage that failed reads nothing, even over an accepted call, and whatever it left gives way to the earlier review.
  const failedCall = settledRun({ calls: [SAVE] });
  assert.deepEqual(settle(failedCall, false), none({ restore: failedCall.before }));
  const failedFile = settledRun({ now: VALID });
  assert.deepEqual(settle(failedFile, false), none({ restore: failedFile.before }));
  assert.deepEqual(settle(settledRun({}), false), none());
});
