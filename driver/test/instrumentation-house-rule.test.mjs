// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// AD-4 (2026-07-30 addendum) — the instrumentation house rule at the gateway: every telemetry field is
// written unconditionally, so "did not happen" stays distinguishable from "not recorded".
//
//   (1) `attempt` lands on run.jsonl — ADDITIVE beside the per-stage logs ('s harness reads those and
//       keeps doing so): one lean {event:"attempt"} row per model dispatch, with its outcome and cause.
//       run.jsonl previously carried one "stage" event with attempts:N and no causes (and, on the knockout
//       lane, no stage events at all), so run.jsonl alone could not distinguish "no retries happened" from
//       "retries not recorded here" — the exact ambiguity the deleted `no-stage-retried` assertion died of.
//   (2) emitted-vs-landed PER DISPATCH: the attempt row's `output` (what LANDED after this attempt) is
//       recorded on failure too, and `wrote` says whether THIS dispatch emitted it — a failed attempt's
//       mid-write artifact and an inherited artifact are different facts and now journal differently.
//   (3) the reads gauge threads through: rows carry `reads` ([] = ran and read nothing; null = the engine
//       cannot observe reads), so "read no inputs" never masquerades as "reads not recorded".
//
// Driven through registered fake engines (the exit1-artifact-rescue harness pattern) — fully offline, $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { runStage, registerEngine, tokensPerSec, toolGauge } from "../gateway.mjs";
import { journalStageInputs } from "../pipeline.mjs";

async function withEngine(name, runTurn, fn) {
  registerEngine({ name, runTurn });
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS };
  process.env.CLEAROTRON_AI = name;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const okTurn = (extra = {}) => ({
  code: 0, killed: false, wall: 2, stdout: "ok", stderr: "", laneWaitMs: 0,
  json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "done" }] }, summary: "done" },
  usage: { input: 5, output: 9, cacheRead: 0, cacheWrite: 0, total: 14 }, sessionRef: "s-ok",
  ...extra,
});
const failTurn = (extra = {}) => ({
  code: 1, killed: false, wall: 1, stdout: "", stderr: "boom", laneWaitMs: 0,
  json: null, usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, total: 4 }, sessionRef: "s-fail",
  ...extra,
});

const readRunEvents = (dir) => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n")
  .map((l) => JSON.parse(l)).filter((e) => e.event === "attempt");
const readStageRows = (dir, stage) => readFileSync(driverDir(dir, `${stage}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);

test("attempt events land on run.jsonl per dispatch — cause on the failed row, ok on the winner (additive: per-stage rows keep the detail)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-attempt-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  let calls = 0;
  try {
    const r = await withEngine("fake-fail-then-ok", async () => {
      calls++;
      if (calls === 1) return failTurn();               // attempt 1: hard turn failure, nothing written
      writeFileSync(out, "# real work\n");              // attempt 2: writes and succeeds
      return okTurn();
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-ihr", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /real work/.test(text) }), runDir: dir, maxRetries: 2,
    }));
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2);

    const attempts = readRunEvents(dir);
    assert.equal(attempts.length, 2, "one run.jsonl attempt event PER dispatch");
    assert.deepEqual(attempts.map((a) => a.attempt), [1, 2]);
    assert.equal(attempts[0].ok, false);
    assert.equal(attempts[0].fail, "nonzero_exit_1", "the retry CAUSE is on run.jsonl now — no per-stage-log join needed to read it");
    assert.equal(attempts[0].wrote, false, "attempt 1 emitted nothing");
    assert.equal(attempts[1].ok, true);
    assert.equal(attempts[1].fail, null, "explicit null — 'did not fail', not 'not recorded'");
    assert.equal(attempts[1].wrote, true, "attempt 2 emitted the artifact");

    // ADDITIVE: the per-stage rows ('s harness substrate) still carry the full per-attempt detail
    const rows = readStageRows(dir, "teststage");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].attempt, 1);
    assert.equal(rows[1].attempt, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1456 the BILLING stamp is written even when false — a subscription run states its mode, it does not omit it", async () => {
  // The house rule at the top of this file, in the wild. `apiBilled` read `auth.apiBilled || undefined`,
  // which elides exactly the value a subscription run has — and every run this repo has archived is a
  // subscription run. A sweep of every August run looking for the stamp found it nowhere, and the CONTROL
  // showed no run carried one at all, so the absence could not distinguish "billed subscription" from
  // "this build does not record billing". needed that question answered and could not answer it.
  const dir = mkdtempSync(join(tmpdir(), "ihr-billing-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    await withEngine("fake-billing", async () => { writeFileSync(out, "# real work\n"); return okTurn(); },
      () => runStage("teststage", {
        agent: "clawdi", sessionKey: "prelim-test-billing", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: () => ({ ok: true }), runDir: dir, maxRetries: 1,
      }));
    // BOTH LOGS. The per-stage row is where auth.mjs says the stamp lands; run.jsonl's spine is what a
    // sweep across archived runs actually reads, and it carried no billing pair at all — which is why
    // 's sweep came back empty and the control came back empty with it.
    for (const [what, row] of [["run.jsonl spine", readRunEvents(dir)[0]], ["per-stage row", readStageRows(dir, "teststage")[0]]]) {
    // PRESENT, and false. `in` and the value are asserted separately on purpose: a key that is absent and
    // a key whose value is falsy read the same through `row.apiBilled`, and the whole defect was the
    // difference between them.
      assert.ok("apiBilled" in row,
        `the ${what} carries no apiBilled key at all — which is the state that made #1456's sweep `
        + "unreadable: no run can then be SHOWN to have billed the way it claims");
      assert.equal(row.apiBilled, false, `${what}: a subscription dispatch must state false, not omit it`);
      assert.equal(typeof row.apiBilled, "boolean", `${what}: undefined-or-true is the shape this arm refuses`);
      // THE MODE IS STATED, WHATEVER IT IS. This fixture's engine is a fake one auth.mjs does not know, so
      // it resolves `unknown` — and that is the same rule, not an exception to it: a mode the resolver
      // could not determine is RECORDED as undeterminable rather than left off the row. A reader can tell
      // "this box could not say" from "this build does not record it"; the elision could not.
      assert.equal(typeof row.authMode, "string", `${what}: the billing mode is not stated at all`);
      assert.ok(row.authMode.length > 0, `${what}: an empty mode reads as a record nobody wrote`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("emitted-vs-landed: a FAILED attempt that mid-wrote its artifact journals output+wrote (was invisible: output success-only)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-midwrite-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-midwrite-fail", async () => {
      writeFileSync(out, "partial garbage");            // the turn wrote, then died
      return failTurn({ killed: true, code: 137, wall: 700, signals: { stalled: true } });
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-ihr-mw", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /real work/.test(text) }), runDir: dir, maxRetries: 0,
    }));
    assert.equal(r.ok, false);
    const rows = readStageRows(dir, "teststage");
    assert.ok(rows[0].output && rows[0].output.size > 0, "what LANDED is recorded even on failure — the mid-write/taint shape is visible");
    assert.equal(rows[0].output.present, true, "…and it says so explicitly (see the absent-output test below)");
    assert.equal(rows[0].wrote, true, "…and attributed to THIS dispatch (emitted), not read as inherited");
    assert.equal(r.wrote, true, "the settled attempt's emitted flag rides the runStage result");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── post-merge audit of ──────────────────────────────────────────────────────────────────────────
// Making `output` unconditional was right; putting fileMeta behind it was not. fileMeta answers an INPUT
// question ("fingerprint this path, forgivingly") and returns {sha:null,size:0} for a path that is not
// there — so an attempt that emitted NOTHING journalled a record where there is no file, and the MCP
// babysit surface (the one the E2E protocol polls) projected it as an output. Absence rendered as a
// record, on the exact surface the package exists to keep honest.
test("AUDIT #172/1 — an attempt that emitted NOTHING journals output {present:false}, never a zero-size record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-absent-"));
  const out = join(dir, "register-findings.md");   // declared, and the turn never writes it
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-emits-nothing", async () => failTurn(),
      () => runStage("register-digest", { agent: "clawdi", sessionKey: "prelim-ihr-absent", message: "m",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, false);
    const row = readStageRows(dir, "register-digest")[0];
    assert.equal(row.output.present, false, "the artifact was EXPECTED and is not on disk — unmistakably absent");
    assert.equal(row.output.sha, null);
    assert.equal(row.output.size, null, "not 0: nobody measured a byte count, and 0 is a real file's size");
    assert.equal(row.output.name, "register-findings.md", "what was expected is still named — absence with an address");
    assert.equal(row.wrote, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The other half of the same finding, from the run the audit was written against. On 2026-07-29
// `register-digest` succeeded at run.jsonl idx 51 emitting register-findings.md @
// sha 1ba8feb88bef, and then FAILED status_overloaded three times (idx 84/131/159) with the earlier
// pass's file still sitting on disk. Under those rows carry that file's real sha and size, which is
// correct — it IS what was on disk — but only if the reader can also see it was not written by that
// dispatch. `outputWritten` is that discriminator, and it must reach every surface that shows `output`.
test("AUDIT #172/1 — a failed dispatch over an INHERITED artifact journals present:true + wrote:false (landed ≠ emitted)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-inherited-"));
  const out = join(dir, "register-findings.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    writeFileSync(out, "# register findings\nthe earlier successful pass's artifact\n");   // idx-51 stand-in
    const r = await withEngine("fake-overloaded", async () => failTurn({ code: 0, json: { status: "overloaded" } }),
      () => runStage("register-digest", { agent: "clawdi", sessionKey: "prelim-ihr-inh", message: "m",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, false);
    assert.equal(r.fail, "status_overloaded", "the idx 84/131/159 failure class on that run");
    const row = readStageRows(dir, "register-digest")[0];
    assert.equal(row.output.present, true, "the file IS on disk — recording that is the point of the unconditional field");
    assert.ok(row.output.sha, "…with its real fingerprint, so a reader can tell WHICH artifact it is");
    assert.equal(row.wrote, false, "…but THIS dispatch did not emit it — the discriminator between landed and emitted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A capped reads list reads as a complete one — the same shape the PR retires elsewhere. The engine says
// whether its gauge was truncated; the gateway must carry that fact instead of dropping it.
test("AUDIT #172/5 — a truncated reads gauge is journalled as truncated, and is null when there is no gauge", async () => {
  const dirA = mkdtempSync(join(tmpdir(), "ihr-trunc-"));
  const dirB = mkdtempSync(join(tmpdir(), "ihr-untrunc-"));
  const dirC = mkdtempSync(join(tmpdir(), "ihr-nogauge-"));
  const outA = join(dirA, "o.md"), outB = join(dirB, "o.md"), outC = join(dirC, "o.md");
  for (const d of [dirA, dirB, dirC]) mkdirSync(driverDir(d), { recursive: true });
  try {
    const rA = await withEngine("fake-capped-gauge", async () => { writeFileSync(outA, "x"); return okTurn({ reads: ["/a", "/b"], readsTruncated: true }); },
      () => runStage("s", { agent: "clawdi", sessionKey: "k-a", message: "m", model: "opus", thinking: "medium",
        timeoutSec: 600, expectFile: outA, runDir: dirA, maxRetries: 0 }));
    assert.equal(readStageRows(dirA, "s")[0].readsTruncated, true, "the cap is VISIBLE — this list is a prefix");
    assert.equal(rA.readsTruncated, true, "…and rides the runStage result, where the stage row reads it");

    const rB = await withEngine("fake-complete-gauge", async () => { writeFileSync(outB, "x"); return okTurn({ reads: ["/a"] }); },
      () => runStage("s", { agent: "clawdi", sessionKey: "k-b", message: "m", model: "opus", thinking: "medium",
        timeoutSec: 600, expectFile: outB, runDir: dirB, maxRetries: 0 }));
    assert.equal(readStageRows(dirB, "s")[0].readsTruncated, false, "explicit false — 'complete', not 'not recorded'");
    assert.equal(rB.readsTruncated, false);

    const rC = await withEngine("fake-no-gauge-at-all", async () => { writeFileSync(outC, "x"); return okTurn(); },
      () => runStage("s", { agent: "clawdi", sessionKey: "k-c", message: "m", model: "opus", thinking: "medium",
        timeoutSec: 600, expectFile: outC, runDir: dirC, maxRetries: 0 }));
    assert.equal(readStageRows(dirC, "s")[0].readsTruncated, null, "no gauge ⇒ nothing to truncate ⇒ no claim");
    assert.equal(rC.readsTruncated, null);
  } finally {
    for (const d of [dirA, dirB, dirC]) rmSync(d, { recursive: true, force: true });
  }
});

// inputs[].read is what AD-4 added to answer "what did the stage actually READ". A WARM PATCH resumes the
// failed session and is not re-offered its files, so a turn that opens nothing is the normal warm shape —
// and `false` there is a manufactured finding in the very record the charter routes into P2-A. Same for a
// capped gauge, where an absent path proves nothing.
//
// A-1 CHANGED ONE ARM OF THIS TEST, deliberately, and the reason is not "the change needed it to pass".
// The original assert read "a followup re-offered nothing" — but a followup dispatch is a NEW stage() call,
// i.e. attempt 1, and `resumeRef` is passed only on a warm retry (gateway.mjs); neither engine reads
// `sessionKey`. So a followup never resumed anything and its inputs WERE offered. The old assert was
// pinning the premise the audit found false, and honouring it meant discarding the one measurement that
// shows a corrective pass reaching its evidence. The warm arm below is untouched — that one was always
// right, and it is the arm that keeps a real resume from manufacturing a finding.
test("AUDIT #172/2 + A-1 — a warm patch or a capped gauge downgrades read:false to null; a COLD FOLLOWUP does not; an observed read stays true", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-reads-flag-"));
  try {
    const opened = join(dir, "matter-context.md");
    const untouched = join(dir, "skeptic-flags.md");   // declared and never named in any stage message
    writeFileSync(opened, "ctx");
    writeFileSync(untouched, "flags");
    const paths = [opened, untouched];

    const fresh = journalStageInputs(paths, { reads: [opened], readsTruncated: false });
    assert.deepEqual(fresh.map((i) => i.read), [true, false], "a FRESH dispatch offered both — 'offered and not opened' is earned");

    // A-1 — a COLD followup is a fresh session that was offered its declared inputs, so `false` is earned
    // there too. `followup` is no longer a parameter of this function at all: it is journalled on the row
    // by the caller (so the two populations stay separable) but it never suppresses the gauge.
    const coldFollowup = journalStageInputs(paths, { reads: [opened], readsTruncated: false, warm: false });
    assert.deepEqual(coldFollowup.map((i) => i.read), [true, false],
      "a cold followup was offered both: 'offered and not opened' is earned, and it is the measurement A-1 exists to make");

    const capped = journalStageInputs(paths, { reads: [opened], readsTruncated: true });
    assert.deepEqual(capped.map((i) => i.read), [true, null], "a prefix list cannot prove a path was not opened");

    const noGauge = journalStageInputs(paths, { reads: null, readsTruncated: null });
    assert.deepEqual(noGauge.map((i) => i.read), [null, null], "no gauge ⇒ nothing claimed either way (unchanged)");

    // post-merge audit of (N1): a WARM PATCH is a session resume the CALLER never asked for — the
    // gateway's retry ladder turned attempt N of a fresh dispatch into one. It is the ONLY arm that is a
    // real resume, and it must fire on its own: readsTruncated:false + warm:true.
    const warm = journalStageInputs(paths, { reads: [opened], readsTruncated: false, warm: true });
    assert.deepEqual(warm.map((i) => i.read), [true, null],
      "a warm patch re-offered nothing: the open is still evidence, the absence is no longer a finding");

    // the fingerprint half of the row is untouched by any of this
    assert.deepEqual(fresh.map((i) => i.name), ["matter-context.md", "skeptic-flags.md"]);
    assert.ok(fresh.every((i) => typeof i.sha === "string" && i.size > 0));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── post-merge audit, N1 — the fix's own affirmative claim, on the warm-patch retry ──────────
// The two-attempt shape, end to end. Attempt 1 is FRESH and demonstrably opens both declared inputs, then
// fails its validator on a warm-eligible token. Attempt 2 is the WARM PATCH: it resumes that session with
// only the fix instruction, is re-offered nothing, and opens nothing — so `runStage` settles on reads:[]
// with a COMPLETE gauge. Before `warm` rode the return tuple the stage row read:
//     followup:false  readsTruncated:false  inputs[].read: [false, false]
// — `read:false` for a file the same run can prove it opened one attempt earlier, and (new in AD-4) an
// affirmative "the gauge was trustworthy" stamped beside it, on a row whose own comment promises a reader
// never has to join another file to learn why. The token is `connotation_no_ruling` — warm-eligible, and
// 7 of the 12 non-clean dispatches in the 2026-08-02 round, so this is the common path. (It used to be
// `coverage_status_offenum`, which moved to the in-dispatch form repair: that token no longer reaches
// the ladder at all, so it can no longer produce a settled WARM attempt for this rule to be read on.)
test("AUDIT #175/N1 — the settled attempt was a WARM PATCH: absence journals null, and the row carries the reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-warmpatch-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const out = join(dir, "register-findings.md");
  const matterContext = join(dir, "matter-context.md");
  const skepticFlags = join(dir, "skeptic-flags.md");
  writeFileSync(matterContext, "ctx");
  writeFileSync(skepticFlags, "flags");
  const savedWarm = process.env.CLEAROTRON_WARM_RETRY;
  process.env.CLEAROTRON_WARM_RETRY = "1";
  try {
    let calls = 0;
    const r = await withEngine("fake-warm-patch", async () => {
      calls++;
      if (calls === 1) {
        writeFileSync(out, "# digest\nstatus: withdrawn-but-cleared\n");        // trips the validator below
        return okTurn({ reads: [matterContext, skepticFlags] });               // …having opened BOTH inputs
      }
      writeFileSync(out, "# digest\nrepaired\n");                              // the one-cell warm relabel
      return okTurn({ reads: [] });                                            // resumed session: opens nothing
    }, () => runStage("register-digest", {
      agent: "clawdi", sessionKey: "prelim-ihr-warmpatch", message: "m", model: "opus", thinking: "medium",
      timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 1,
      // a warm-eligible WORK-class token from WARM_ELIGIBLE_RE — a clean turn whose recorded meaning
      // receipts are undisposed ( owns it; the in-dispatch form repair never touches it)
      validate: (f, text) => (/repaired/.test(text) ? { ok: true } : { ok: false, reason: "connotation_no_ruling:no_ruling=2;Q-ABCDEFGH [a gang]" }),
    }));
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2);

    const attempts = readRunEvents(dir);
    assert.equal(attempts[0].warm, undefined, "attempt 1 was fresh");
    assert.equal(attempts[1].warm, true, "attempt 2 was the warm patch — #172 already journalled this fact");
    assert.equal(r.warm, true, "…and it now rides the settled tuple, which is the only place the stage row can read it");
    assert.deepEqual(r.reads, [], "the settled (warm) attempt opened nothing");
    assert.equal(r.readsTruncated, false,
      "…on a COMPLETE gauge — which is precisely why the manufactured `false` looked so well-founded");

    // the stage row's rule, called exactly as stageOnce calls it
    const journalled = journalStageInputs([matterContext, skepticFlags],
      { reads: r.reads, readsTruncated: r.readsTruncated, warm: r.warm });
    assert.deepEqual(journalled.map((i) => i.read), [null, null],
      "neither input is claimed unread: one was PROVABLY opened on attempt 1, and the warm patch re-offered neither");
    assert.deepEqual(journalled.map((i) => i.name), ["matter-context.md", "skeptic-flags.md"],
      "the fingerprint half of the row is untouched — absence is qualified, not erased");
  } finally {
    if (savedWarm === undefined) delete process.env.CLEAROTRON_WARM_RETRY; else process.env.CLEAROTRON_WARM_RETRY = savedWarm;
    rmSync(dir, { recursive: true, force: true });
  }
});

// The two tests above prove the tuple and the RULE. This one proves the WIRE between them. A warm patch
// through stageOnce needs a warm-eligible mock failure that the pipeline harnesses do not produce (they
// run at CLEAROTRON_MAX_RETRIES=0, so no attempt 2 exists to be warm), so the connection is pinned the way
// this repo already pins the turnaround terminals (run-quote.test.mjs, "every terminal … actually calls
// the writer"): the behaviour is proven above, this asserts the call site exists. Without it, deleting
// `warm: r.warm` from either line passes every suite while the reviewer's finding walks straight back in.
test("AUDIT #175/N1 — stageOnce's stage row actually FORWARDS warm: to journalStageInputs, and writes it", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  // anchor on stageOnce's call (the code-side lane's passes a path array, not stageInputs()), then take
  // its options object — a flat literal, so "up to the first }" is exactly that argument and no more.
  const call = src.match(/journalStageInputs\(stageInputs\([\s\S]*?\{\s*reads:[^}]*\}/);
  assert.ok(call, "stageOnce still journals its inputs through journalStageInputs with an options object");
  assert.match(call[0], /\bwarm:\s*r\.warm\b/,
    "the settled attempt's warm flag reaches the rule — otherwise a warm patch's absence is journalled as an earned false");
  assert.match(src, /^\s*warm: r\.warm \?\? null,$/m,
    "…and the row carries `warm` unconditionally, so its null `read` flags explain themselves in place");
});

test("AUDIT #175/N1 — a FRESH settled attempt still earns its `false`: threading warm must not blunt the finding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-fresh-earned-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const out = join(dir, "o.md");
  const offered = join(dir, "matter-context.md");
  writeFileSync(offered, "ctx");
  try {
    const r = await withEngine("fake-fresh-ignores-input", async () => { writeFileSync(out, "x"); return okTurn({ reads: [] }); },
      () => runStage("s", { agent: "clawdi", sessionKey: "k-fresh", message: "m", model: "opus", thinking: "medium",
        timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, true);
    assert.equal(r.warm, false, "a single fresh attempt is not a warm patch — explicit false, never an omitted key");
    assert.deepEqual(journalStageInputs([offered], { reads: r.reads, readsTruncated: r.readsTruncated, warm: r.warm })
      .map((i) => i.read), [false], "offered on a fresh dispatch and demonstrably not opened — the finding survives");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reads three-valuedness: an engine without a reads gauge journals reads:null; one with an empty gauge journals []", async () => {
  const dirA = mkdtempSync(join(tmpdir(), "ihr-reads-null-"));
  const dirB = mkdtempSync(join(tmpdir(), "ihr-reads-empty-"));
  const outA = join(dirA, "out.md"), outB = join(dirB, "out.md");
  mkdirSync(driverDir(dirA), { recursive: true });
  mkdirSync(driverDir(dirB), { recursive: true });
  try {
    // engine that CANNOT observe reads (no `reads` key on the tuple — the openai-agent shape)
    const rA = await withEngine("fake-no-reads-gauge", async () => { writeFileSync(outA, "x"); return okTurn(); },
      () => runStage("teststage", { agent: "clawdi", sessionKey: "prelim-ihr-ra", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, expectFile: outA, runDir: dirA, maxRetries: 0 }));
    assert.equal(rA.ok, true);
    assert.equal(readStageRows(dirA, "teststage")[0].reads, null, "cannot-observe journals null — nothing is claimed");
    assert.equal(rA.reads, null);

    // engine that observed the turn and saw NO reads ([] — the recorded fact)
    const rB = await withEngine("fake-empty-reads-gauge", async () => { writeFileSync(outB, "x"); return okTurn({ reads: [] }); },
      () => runStage("teststage", { agent: "clawdi", sessionKey: "prelim-ihr-rb", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, expectFile: outB, runDir: dirB, maxRetries: 0 }));
    assert.equal(rB.ok, true);
    assert.deepEqual(readStageRows(dirB, "teststage")[0].reads, [], "'ran and read nothing' is recorded, distinct from null");
    assert.deepEqual(rB.reads, []);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("a stage with NO expected files journals wrote:null — 'nothing to emit' is not 'did not write'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-nofile-"));
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-no-expect", async () => okTurn(),
      () => runStage("teststage", { agent: "clawdi", sessionKey: "prelim-ihr-nf", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, true);
    const row = readStageRows(dir, "teststage")[0];
    assert.equal(row.wrote, null);
    assert.equal(row.output, null, "output is present-and-null, never omitted");
    assert.equal(readRunEvents(dir)[0].wrote, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// — THE GENERATION RATE, ON BOTH ROWS
//
// register-unit:transliteration-numeric spent 24.5 min to emit FEWER output tokens than a 6.8-min run of
// the same stage — 44.9 tok/s against 10.5 — and finished 31 seconds inside its timeout. Both operands
// were already recorded; the ratio was not, so establishing it meant reading two archived runs by hand.
// The spine carried NEITHER operand, so run.jsonl could not answer "which stage generated slowly" at all.
//
// The house rule is the point of these assertions: written UNCONDITIONALLY, and NULL IS NOT ZERO. A
// killed turn has a null usage envelope, and reporting 0 tok/s for it would say "generated nothing"
// about exactly the 485-second-opus-killed class that has to stay visible as UNMEASURED.

test("#1111 a measured dispatch records its rate on the stage row AND on the run.jsonl spine", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-rate-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-rate", async () => { writeFileSync(out, "x"); return okTurn(); },
      () => runStage("teststage", { agent: "clawdi", sessionKey: "prelim-ihr-rate", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, expectFile: out, runDir: dir, maxRetries: 0 }));
    assert.equal(r.ok, true);
    // okTurn is wall 2 s / 9 output tokens.
    const row = readStageRows(dir, "teststage")[0];
    assert.equal(row.usage.output, 9, "premise: the usage envelope IS populated — the comment that said otherwise was stale");
    assert.equal(row.wall, 2);
    assert.equal(row.tokensPerSec, 4.5, "the stage row carries the ratio, not just the two operands");

    const spine = readRunEvents(dir)[0];
    assert.equal(spine.wall, 2, "the spine carried no wall at all before #1111");
    assert.equal(spine.outputTokens, 9, "…nor any token count, so no rate was derivable from run.jsonl");
    assert.equal(spine.tokensPerSec, 4.5, "and the spine agrees with the stage row — one derivation, two rows");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1111 an UNMEASURED dispatch records null, never 0 — 'we could not measure' is not 'it generated nothing'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ihr-rate-null-"));
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    // The real shape: a hard-kill with a NULL usage envelope (the teal-bastion signature isLaneWedge keys on).
    await withEngine("fake-killed-null-usage",
      async () => failTurn({ killed: true, code: 137, wall: 700, usage: null, signals: { hardWall: true } }),
      () => runStage("teststage", { agent: "clawdi", sessionKey: "prelim-ihr-rate-null", message: "m", model: "opus",
        thinking: "medium", timeoutSec: 600, runDir: dir, maxRetries: 0 })).catch(() => {});
    const row = readStageRows(dir, "teststage")[0];
    assert.equal(row.tokensPerSec, null, "a turn that measured nothing has no rate");
    assert.notEqual(row.tokensPerSec, 0, "…and 0 would read as 700 seconds of silence — the field is present-and-null");
    assert.ok("tokensPerSec" in row, "present on the row: the house rule is unconditional writing");
    const spine = readRunEvents(dir)[0];
    assert.equal(spine.outputTokens, null, "same on the spine");
    assert.equal(spine.tokensPerSec, null);
    assert.ok("outputTokens" in spine && "tokensPerSec" in spine);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1111 tokensPerSec — an honest zero survives, and every unmeasurable operand returns null", () => {
  const u = (output) => ({ input: 1, output, cacheRead: 0, cacheWrite: 0, total: 1 });
  assert.equal(tokensPerSec(u(18374), 408.585), 44.97, "#1111's baseline run — its table says 44.9");
  assert.equal(tokensPerSec(u(15493), 1468.828), 10.55, "#1111's subject run — its table says 10.5");
  assert.equal(tokensPerSec(u(0), 12), 0, "a measured turn that emitted nothing IS zero — that is a real observation");
  assert.equal(tokensPerSec(null, 12), null, "no envelope ⇒ unmeasured");
  assert.equal(tokensPerSec(u(9), 0), null, "a zero wall cannot carry a rate");
  assert.equal(tokensPerSec(u(9), null), null);
  assert.equal(tokensPerSec(u(undefined), 12), null, "a present envelope with no output count is still unmeasured");
  assert.equal(tokensPerSec(u(-1), 12), null, "a negative count is not a rate");
});

test("#1111 an engine that CANNOT REPORT tool time records null, never 0 — silence is not 'called no tools'", async () => {
  // `openai-agent` carries no tool references at all, so every codex attempt is unmeasured. A 0 there
  // would read as "this turn called no tools", and a cross-engine comparison would conclude tool wait is
  // an Anthropic-only phenomenon — from an instrument that had simply gone quiet. Same rule, same reason
  // as the rate arm above; this is the arm that was missing when the fields shipped.
  const dir = mkdtempSync(join(tmpdir(), "ihr-tool-null-"));
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    await withEngine("fake-no-tool-gauge",
      async () => okTurn(),                      // an ok turn that reports NEITHER field — the codex shape
      () => runStage("teststage", { agent: "clawdi", sessionKey: "prelim-ihr-tool-null", message: "m",
        model: "opus", thinking: "medium", timeoutSec: 600, runDir: dir, maxRetries: 0 })).catch(() => {});
    const row = readStageRows(dir, "teststage")[0];
    assert.equal(row.toolCalls, null, "an engine that cannot report has no tool count");
    assert.notEqual(row.toolCalls, 0, "…and 0 would read as a turn that called no tools");
    assert.ok("toolCalls" in row, "present on the row: the house rule is unconditional writing, and an "
      + "ABSENT field cannot be told from a record that predates the gauge");
    assert.equal(row.toolWaitMs, null);
    assert.ok("toolWaitMs" in row);
    const spine = readRunEvents(dir)[0];
    assert.equal(spine.toolCalls, null, "same on the spine");
    assert.equal(spine.toolWaitMs, null);
    assert.ok("toolCalls" in spine && "toolWaitMs" in spine);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// — `toolWaitUnmeasurable` joins the gauge and therefore joins this shape. An engine
// that reports nothing reports null for it too: "cannot report" and "measured, nothing unmeasurable"
// (`[]`) are different answers, which is the whole distinction the field exists to draw.
const NO_GAUGE = { toolCalls: null, toolWaitMs: null, activeMs: null, toolWaitByTool: null,
  toolWaitUnmeasurable: null };

test("#1111 toolGauge — an honest zero survives, and every unmeasurable operand returns null", () => {
  assert.deepEqual(toolGauge({ toolCalls: 3, toolWaitMs: 5400, activeMs: 12000, toolWaitByTool: { Read: 5400 } }),
    { toolCalls: 3, toolWaitMs: 5400, activeMs: 12000, toolWaitByTool: { Read: 5400 },
      toolWaitUnmeasurable: null });
  assert.deepEqual(toolGauge({ toolCalls: 0, toolWaitMs: 0, activeMs: 0, toolWaitByTool: {} }),
    { toolCalls: 0, toolWaitMs: 0, activeMs: 0, toolWaitByTool: {}, toolWaitUnmeasurable: null },
    "a turn that genuinely called no tools must keep its 0 and its EMPTY map — both are measurements, not silences");
  assert.deepEqual(toolGauge({}), NO_GAUGE, "an engine that reports none of them");
  assert.deepEqual(toolGauge(undefined), NO_GAUGE, "no turn at all");
  assert.deepEqual(toolGauge({ toolCalls: -1, toolWaitMs: -1, activeMs: -1 }), NO_GAUGE,
    "a negative count or duration is impossible; recording it would put a wrong number in a comparison");
  assert.deepEqual(toolGauge({ toolCalls: "3", toolWaitMs: "5400", activeMs: "1" }), NO_GAUGE,
    "a string that looks like a number is an adapter that changed shape, not a measurement");
  // The map is a MEASUREMENT or a null, never a coerced shape: an array or a string here is an adapter that
  // changed, and copying it through would put a thing that is not an attribution into an attribution field.
  assert.equal(toolGauge({ toolWaitByTool: ["Read"] }).toolWaitByTool, null);
  assert.equal(toolGauge({ toolWaitByTool: "Read=5" }).toolWaitByTool, null);
  // Copied, never aliased — a caller mutating the record must not reach back into the engine's own tally.
  const live = { Read: 1 };
  const out = toolGauge({ toolWaitByTool: live });
  out.toolWaitByTool.Read = 999;
  assert.equal(live.Read, 1, "the gauge handed out its own map by reference");
  // — the same two rules for the new field: a measurement or a null, never a coerced
  // shape, and copied rather than aliased.
  assert.deepEqual(toolGauge({ toolWaitUnmeasurable: [] }).toolWaitUnmeasurable, [],
    "an empty array is the measurement `nothing was unmeasurable`, not a silence");
  assert.equal(toolGauge({ toolWaitUnmeasurable: {} }).toolWaitUnmeasurable, null,
    "an object here is an adapter that changed shape, not a list of unmeasurable asks");
  const liveU = [{ tool: "Read" }];
  const outU = toolGauge({ toolWaitUnmeasurable: liveU });
  outU.toolWaitUnmeasurable.push({ tool: "x" });
  assert.equal(liveU.length, 1, "the gauge handed out its own list by reference");
});
