// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline, intake to delivery packet: the one report, the instructed scope, the envelope and the closing loop
// Offline driver dry-run against a mock engine (no billable calls). The shared harness is pipeline-mock-harness.mjs.
import { CLAUDE, DEFERRED_SLICE, JOB, fieldGapExecutor, runPipeline, studioRootOf } from "./pipeline-mock-harness.mjs";
import { test } from "node:test";
import { pinEnv } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

// ── ONE report (spec 2026-07-30 §5): machine QC is telemetry, never a gate on who may read ─────────────
// A persistent QC defect (permission-prose — a false "tool was blocked" claim) used to close the client
// gate: the client export was withheld, the cover note grew a readiness block, and every delivery surface
// carried a readiness bit. All of that is deleted. The checks still RUN — their result lands on the audit
// workbook (a plain internal QC row), meta.json (the staff index's ⚠ QC pill) and the machine-qc-failed
// telemetry event — and the run delivers exactly like any other.
//
// A10 (addendum 2026-07-30, two-bit gate doctrine) fixes what ONE report alone would have left: with the
// readiness block gone, the reasons reached NO delivery surface at all — VENZY's failure exactly. The
// cover note now ENUMERATES them. The two rules are not in tension: what is deleted is the narration of
// a readiness BIT and the withholding it drove; what is required is that a recorded defect is never only
// a flag nobody reads. Warn beside the report link, never suppress the artifact.
//
// RULED 2026-07-31, and this test is where the ruling is pinned. An earlier arm asserted here that QC reasons
// "never ride the email"; a rebase flipped that to a bare match on the engine's own sentence, which
// asserts the leak rather than the contract. Neither is right. composeEmailHtml is NOT only the
// reviewer's reply: portal-service stamps forwarderEmail from the verified principal, so on a
// client-started run this mail lands in the client's inbox — the failure lane already sanitises for
// that exact recipient and the success lane never did. And even reviewer-only, ~90 words of engine
// prose is not lawyer language. So the contract asserted below is BOTH halves at once: the defect is
// enumerated (A10), AND the engine's wording is absent from the whole note (outward-language rules),
// judged by the audit workbook's own BANNED list so the two delivery surfaces cannot drift apart.
// The fix is ONE projected wording for both readers — never a client variant of this note.
test("one report + A10: failed machine QC delivers normally and its defects ride the reviewer's cover note; nothing withholds or narrates readiness", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_PERMISSION_PROSE: "1" });
  assert.equal(res.ok, true, `failed QC must not fail the run: ${JSON.stringify(res)}`);
  assert.ok(!existsSync(join(res.runDir, ".failed")), "no .failed — the run ended delivered");
  assert.ok(existsSync(join(res.runDir, ".delivered")), "the delivery sentinel exists");

  // status: terminal state is "delivered", full stop — no delivery{} second bit
  const s = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(s.state, "delivered");
  assert.equal(s.delivery, undefined, "the two-bit delivery is deleted");

  // telemetry: the machine-qc-failed event fired with the plain-language reasons + stable codes
  const qcEvent = events.find((e) => e.event === "machine-qc-failed");
  assert.ok(qcEvent && Array.isArray(qcEvent.reasons) && qcEvent.reasons.length, "machine-qc-failed telemetry event logged");
  assert.ok(qcEvent.reasons.some((d) => /blocked or lacked permission/.test(d)), `the plain-language reason: ${JSON.stringify(qcEvent.reasons)}`);
  assert.ok(!events.some((e) => e.event === "client-gate-closed"), "the old gate incident event is retired");

  // pool: report.html published; NO client twin exists to withhold; meta records the QC result
  const { config: poolCfg } = await import("../driver.config.mjs");
  const { dirname: pdir, basename: pbase } = await import("node:path");
  const poolDir = join(poolCfg.poolRoot, `${pbase(pdir(res.runDir))}-${pbase(res.runDir)}`);
  assert.ok(existsSync(join(poolDir, "report.html")), "the report reached the pool");
  assert.ok(!existsSync(join(poolDir, "report.client.html")), "no client twin is ever written");
  const meta = JSON.parse(readFileSync(join(poolDir, "meta.json"), "utf8"));
  assert.equal(meta.clientGate.released, false, "meta records the QC result (workbook + staff-pill surfaces)");

  // ZERO banners on the rendered report — the QC record lives on the workbook + telemetry only
  const html = readFileSync(join(poolDir, "report.html"), "utf8");
  assert.ok(!/Not client-ready|CLOSE.BEFORE.FILING/i.test(html), "the report document stays clean at every level");

  // the cover note narrates no readiness — but A10 requires the recorded defect to REACH the reviewer
  const email = readFileSync(join(res.runDir, "email-body.md"), "utf8");
  assert.doesNotMatch(email, /Not client-ready/, "the retired readiness block never renders");
  assert.doesNotMatch(email, /for your review only|withheld|clientReady/i, "no readiness narration survives anywhere on the note");
  // A10 put the sink's surviving failures on THIS note, and the note is the client's own inbox.
  // The defect still reaches the reviewer: the workbook's Machine Checks sheet and the run record both
  // carry the same projected line, and `machine-qc-failed` is logged above. What is gone is the client
  // reading an internal check they cannot act on. The gate is unchanged — it still never suppresses.
  assert.doesNotMatch(email, /Machine checks/, "THE DEFECT: an internal check enumerated to the client");
  assert.doesNotMatch(email, /describes a search as blocked or not permitted/, "…nor its projected line");
  assert.doesNotMatch(email, /permission-prose/, "…and never the internal check id");
  assert.match(email, /Open the full report/, "the deliverable is untouched");
  assert.doesNotMatch(email, /blocked or lacked permission|the supplemental lane|deterministic plan executor|register_enumerate/,
    "the check's own engine prose never rides the note — this mail is sent verbatim to forwarderEmail");
  // THE BLOCK IS GONE FROM THIS SURFACE, so what is pinned here is its absence and the absence
  // of everything it carried. The vocabulary sweep that used to run over the block moved to
  // client-surface-vocabulary.test.mjs, which runs a list calibrated for a WHOLE cover note: the
  // workbook's BANNED list is written for check LINES and legitimately matches a matter id and a report
  // link, so pointing it at the whole mail would fail on the deliverable itself.
  assert.equal(email.match(/<p style="[^"]*background:#fff8e6[\s\S]*?<\/p>/), null,
    "the amber machine-check block is rendered again on a QC-failed run");
  const { deliveryFlagLines } = await import("../predelivery-lint.mjs");
  const sinkChecks = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8")).checks ?? [];
  const projected = deliveryFlagLines(sinkChecks.filter((c) => !c.pass));
  assert.ok(projected.length, "premise: this run really does have a surviving failure, or this proves nothing");
  for (const line of projected)
    assert.ok(!email.includes(line), `a projected check line reached the client's mail: "${line}"`);

  // the outbox packet carries no readiness bits and the plain ping
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "delivery.json"), "utf8"));
  assert.ok(!("clientReady" in packet) && !("defects" in packet), "no readiness bits on the packet");
  assert.match(packet.whatsappText, /^✅/, "the plain completion ping — same message as every delivered run");
});

test("failed run → status.json failed + STATUS.md surfaces it (failure ping is best-effort, never masks the error)", async () => {
  // matter-frame is reliably caught by the mock (its message contains the skill path "skills/matter-frame/...").
  // The failure-ping's own message also contains "matter-frame", so the mock-send of the ping fails too — which
  // is exactly the gateway-wide-outage case: STATUS.md must STILL record the failure (written before the ping).
  const { res } = await runPipeline({ MOCK_FAIL_STAGE: "matter-frame", MOCK_VERDICT: "CLEAR" });
  assert.equal(res.ok, false);
  assert.equal(res.failedStage, "matter-frame");
  const s = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(s.state, "failed");
  assert.equal(s.failedStage, "matter-frame");
  const md = readFileSync(join(studioRootOf(res.runDir), "STATUS.md"), "utf8");
  assert.match(md, /TMP-2201 NOVAPULSE — ⚠️ FAILED at matter-frame/);
});

// ── Change B5 e2e ───────────────────────────────────────────────────────────────────────────────────────

test("applicant-unknown e2e: identity-band hit delivered as an ORDINARY finding with a neutral disregard note — no gate, no corrective", async () => {
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_CANDSELF: "1" },
    { customerUnknown: true },
  );
  assert.equal(res.ok, true, JSON.stringify(res));
  // the retired candidate-self gate must NOT fire — a missing applicant never re-synthesises or fails the run
  assert.ok(!events.some((e) => e.event === "candidate-self-violation"), "no candidate-self violation gate");
  assert.ok(!events.some((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "candidate-self"),
    "no candidate-self corrective followup");
  const narrative = readFileSync(join(res.runDir, "narrative.md"), "utf8");
  assert.doesNotMatch(narrative, /Candidate-self:|is this you\?/i, "retired 'is this you?' treatment is gone");
  assert.match(narrative, /own prior filing, disregard/i, "identity-band hit carries the neutral disregard note, counted as an ordinary finding");
});

test("B5b e2e: pre-seeded customer-bind.json folds at pre-matter-frame (normal path) + event logged", async () => {
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_SEAT_DEFERS", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_CL_MISSING_QUERIES", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);
  // create the run dir BEFORE the run and drop the bind — a thread reply that arrived pre-start.
  // driver.config freezes workspaceRoot at its FIRST import in this process, so derive the dir from the
  // (cached) config rather than this test's own root — correct in both full-file and solo runs.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { config } = await import("../driver.config.mjs");
  const runDir = join(config.studioRootForAgent("intake-agent"), "tmp2201-novapulse", "2026-01-01-bind-test");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "customer-bind.json"),
    JSON.stringify({ customer: "ACME Interactive", exclusions: ["BigCo"], ts: "2026-01-01T00:00:00Z", source: "<reply@x>" }));
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, customerUnknown: true }, { codename: "bind-test" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bind = events.find((e) => e.event === "customer-late-bind");
  assert.ok(bind, "customer-late-bind event logged");
  assert.equal(bind.phase, "pre-matter-frame");
  assert.equal(bind.action, "fold-job");
  assert.equal(bind.customer, "ACME Interactive");
  assert.ok(!events.some((e) => e.event === "candidate-self-violation"), "bound customer ⇒ candidate-self never polices");
});

test("B5b ack: every consumed bind writes the plain-language confirmation packet (event logged)", async () => {
  // piggybacks the bind-fold flow: the ack is a best-effort outbox packet, written by code.
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_SEAT_DEFERS", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_CL_MISSING_QUERIES", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { config } = await import("../driver.config.mjs");
  const runDir = join(config.studioRootForAgent("intake-agent"), "tmp2201-novapulse", "2026-01-02-ack-test");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "customer-bind.json"),
    JSON.stringify({ customer: "ACME Interactive", exclusions: [], ts: "2026-01-02T00:00:00Z", source: "<reply@x>" }));
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, customerUnknown: true }, { codename: "ack-test" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ack = events.find((e) => e.event === "customer-late-bind-ack");
  assert.ok(ack, "ack event logged");
  assert.equal(ack.sent, true);
});

// ── spec-48 WS2: the plan path end-to-end (ALWAYS ON since the flag removal — every mock run mints) ──
test("spec-48 plan mode: frozen plan → dictated units → clean identity join → audited refutation → store minted", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const dr = driverDir(res.runDir);
  assert.ok(existsSync(join(dr, "register-plan.json")), "frozen plan rides the run dir");
  assert.ok(existsSync(join(dr, "instructed-scope.json")), "code-authoritative scope receipt written");
  const exec = JSON.parse(readFileSync(join(dr, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.missing, [], "every dictated qid owns a band block");
  assert.ok(exec.executed.length > 0, "entries executed");
  assert.ok(exec.skeleton.every((s) => s.state !== "unexecuted"), "no axis unexecuted");
  // minted on a cold store; REUSED byte-identical when the shared mock studio already carries the
  // slug store from an earlier flag-on test in this process (either way, THE F2 property: the plan
  // came from the deterministic compile/freeze path, never a re-improvisation). The store round-trip
  // decision itself is covered by the pure resolvePlanAgainstStore tests.
  assert.ok(events.some((e) => e.event === "register-plan" && (e.source === "minted" || e.source === "reused")), "plan attached via mint/reuse");
  // the refutation was fed the deterministic table and carries the audited section (validator-enforced)
  assert.match(readFileSync(join(res.runDir, "senior-eye-review.md"), "utf8"), /PLAN-EXECUTION CHECK/);
});

// ── spec-48 WS2 (B3) rider — the geography stamp rides the instructed-scope receipt ──────────────────
// The receipt is "what the JOB said, written before any model breathes on it" — and the job says WHERE
// as a typed stamp (enqueue-schema.mjs, "the GEOGRAPHY STAMP": {mode, origin}, written at the door).
// foldRecipeScope mutates job.jurisdictions on later passes (and re-stamps origin "saved-search" when
// it does), so by read time the stamp is the only surviving record of where the territories came from.
// A receipt without it forces the matter frame to reconstruct that provenance from the request prose —
// a reconstruction the paraphrase-drift validator (validators.matterContext) cannot check.
test("spec-48 receipt: the geography stamp is copied verbatim into instructed-scope.json; a pre-stamp job records null, never a missing key", async () => {
  // stamped job — the door's own shape, copied verbatim, never recomputed at write time
  const stamped = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { geography: { mode: "account-default", origin: "account-default" } });
  assert.equal(stamped.res.ok, true, JSON.stringify(stamped.res));
  const withStamp = JSON.parse(readFileSync(driverDir(stamped.res.runDir, "instructed-scope.json"), "utf8"));
  assert.deepEqual(withStamp.geography, { mode: "account-default", origin: "account-default" },
    "the stamp arrives in the receipt exactly as the job carried it");
  // pre-stamp job (queued before the field existed): the receipt states the absence ITSELF —
  // "unrecorded" arrives as an explicit null (the same `?? null` posture as goods and customer beside
  // it), never as a key a reader has to notice is missing.
  const bare = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(bare.res.ok, true, JSON.stringify(bare.res));
  const noStamp = JSON.parse(readFileSync(driverDir(bare.res.runDir, "instructed-scope.json"), "utf8"));
  assert.ok(Object.hasOwn(noStamp, "geography"), "the key is written on every receipt — a missing key is a silent gap, null is a state");
  assert.equal(noStamp.geography, null);
});

test("spec-48 plan mode: a dictated qid with no band block → ONE warm followup recovers it; the run proceeds", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DROP_QID: "+merch" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "plan-qids-missing"), "the identity join saw the hole");
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.missing, [], "the warm followup closed it — nothing dictated stays unexecuted");
  assert.ok(exec.executed.some((x) => x.qid.endsWith("+merch")), "the dropped slice now owns a block");
});

test("the plan-join follow-up hands the tool only the missing qids", async () => {
  // Without qids, register_execute_plan runs every entry on the axis again and re-fetches every record the
  // axis already holds; the follow-up exists for one missing slice. Read off the prompt the run dispatched.
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DROP_QID: "+merch" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const prompts = readdirSync(driverDir(res.runDir)).filter((f) => /\.dispatch\.txt(\.prev-[0-9a-f]+)?$/.test(f))   // a later dispatch keeps an earlier one as .prev-<hash>
    .map((f) => readFileSync(driverDir(res.runDir, f), "utf8")).filter((t) => t.includes("have no band block yet"));
  assert.equal(prompts.length, 1, "one warm plan-join follow-up was dispatched, and its text recorded");
  const m = prompts[0].match(/register_execute_plan ONCE with (\{[^\n]*?\]\})/);
  assert.ok(m, `the follow-up gives the call with its qids: ${prompts[0].slice(0, 600)}`);
  const call = JSON.parse(m[1]);
  assert.equal(call.qids.length, 1, `exactly the missing slice: ${JSON.stringify(call.qids)}`);
  assert.ok(call.qids[0].endsWith("+merch"));
  assert.match(prompts[0], /do not call it without qids/);
});

test("envelope-settle: a provider-refused slice is DECIDED at the fan-in — before placement, before any digest", async () => {
  // MOCK_SEAT_DEFERS gives the envelope a row to close on an axis the receipt does not cover, so the run takes the
  // settlement flush whose dispatch the last arm reads.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DEFERRED: DEFERRED_SLICE, MOCK_SEAT_DEFERS: "incumbent-class" });
  assert.equal(res.ok, true, JSON.stringify(res));   // a disclosed gap is delivered, never a halt
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.equal(exec.deferred.length, 1, "the refusal joined the receipt's deferred bucket");
  assert.deepEqual(exec.missing, [], "a deterministic refusal is NOT a hole — no repair ladder fires on it");
  const gap = exec.deferred[0];
  assert.ok(gap.qid.endsWith(DEFERRED_SLICE), "the refusal is qid-stamped");

  // THE ORDERING CLAIM. The decision must precede every stage that reads the coverage it decides about.
  // findIndex takes the FIRST occurrence of each, which is the one that matters: a later frame-reopen can
  // emit a second placement-inquiry, and the settlement flush a second register-digest.
  const iEarly = events.findIndex((e) => e.event === "envelope-decision-early");
  const iPlacement = events.findIndex((e) => e.event === "stage" && e.stage === "placement-inquiry");
  const iDigest = events.findIndex((e) => e.event === "stage" && e.stage === "register-digest");
  assert.ok(iEarly >= 0, "the run decided about its deferrals at all");
  assert.equal(events[iEarly].source, "fan-in", "and decided at the fan-in seam — the moment the receipt exists");
  assert.equal(events[iEarly].deferred, 1);
  assert.ok(iPlacement >= 0 && iEarly < iPlacement, "decided BEFORE placement-inquiry (626s on the evidence run)");
  assert.ok(iDigest >= 0 && iEarly < iDigest, "decided BEFORE the first register-digest (810s, doomed at dispatch)");

  // and the decision is honest about WHAT it decided
  const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
  assert.deepEqual(decision.accepted.map((a) => a.qid), [gap.qid], "the refused slice is recorded as accepted");
  assert.equal(decision.accepted[0].decision, "accepted-capability-gap");
  assert.equal(decision.accepted[0].axis, "primary-sweep");
  const { isCapabilityGapReason } = await import("../coverage-ledger.mjs");
  assert.ok(isCapabilityGapReason(decision.accepted[0].reason),
    "acceptance rests on the executor's own reason — the axis still has entries that ran, so nothing else could grant it");
  const skeleton = exec.skeleton.find((s) => s.axis === "primary-sweep");
  assert.equal(skeleton.state, "deferred");
  assert.ok(skeleton.executed > 0, "the axis is NOT deferred end to end — the fullyDeferred shortcut is not in play here");
  assert.deepEqual(decision.closed, [], "a capability gap is never retried, so nothing was closed");

  // …and the settled facts reach the FLUSH pass, which is the one a fresh-dispatch hint cannot reach
  // (stageOnce ignores `extra` when opts.followup is set). The mock records one line per carrying dispatch.
  assert.ok(events.some((e) => e.event === "stage" && e.stage === "register-digest" && e.trigger === "settlement-flush"),
    "the run did take a flush pass");
  const carried = readFileSync(driverDir(res.runDir, "mock-settled-facts.log"), "utf8").trim().split("\n");
  assert.ok(carried.length >= 1, "at least one digest dispatch carried the settled coverage facts");
});

test("envelope-settle: the decision artifact records a zero the same way it records a one (all four arrays, always)", async () => {
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DEFERRED: DEFERRED_SLICE });
  assert.equal(res.ok, true, JSON.stringify(res));
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
  assert.equal(decision.schema_version, 1, "the artifact is versioned — a reader can tell which shape it holds");
  assert.equal(decision.plan_version, exec.plan_version,
    "the decision names the plan version it decided about; a supplemental fold that moves it un-settles the receipt");
  assert.ok(decision.decided_at, "and when");
  assert.equal(decision.deferred_total, exec.deferred.length);
  // AD-4 instrumentation house rule: a reader must distinguish "zero" from "nobody looked".
  for (const k of ["accepted", "closed", "close_failed", "history"])
    assert.ok(Array.isArray(decision[k]), `${k} is present as an array even when it is empty`);
  assert.deepEqual(decision.close_failed, []);
  assert.deepEqual(decision.history, []);
});

test("envelope-settle: a resume that finds no decision on disk re-settles the receipt before the expensive stages", async () => {
  // run 1 dies at synthesis — the first FATAL post-digest stage — so the run dir stays LIVE and resumable
  // (a delivered run is archived and pipeline() refuses to resume it).
  const { res: r1 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_PLAN_DEFERRED: DEFERRED_SLICE, MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(r1.postponed, true, JSON.stringify(r1));
  assert.equal(JSON.parse(readFileSync(join(r1.runDir, "status.json"), "utf8")).failedStage, "synthesis");
  const decisionPath = driverDir(r1.runDir, "envelope-decision.json");
  assert.ok(existsSync(decisionPath), "run 1 decided at its fan-in");

  // …and the artifact is lost (a torn write, a hand-cleaned _driver, a fork that never held it).
  const { rmSync } = await import("node:fs");
  rmSync(decisionPath);
  // The receipt is now UNSETTLED, and this is the exact predicate assertReceiptSettled keys on — pinned
  // through the exported piece because the guard itself cannot be provoked from this harness: the fan-in
  // seam runs on every resume, before both guard sites, so it always re-settles first and `unsettled-inputs`
  // never gets to fire. What the guard would have seen is asserted here; what actually heals is below.
  const { receiptSettled } = await import("../envelope-settle.mjs");
  const { paths } = await import("../stages.mjs");
  const receipt = JSON.parse(readFileSync(driverDir(r1.runDir, "plan-execution.json"), "utf8"));
  const state = receiptSettled(paths(r1.runDir), receipt);
  assert.equal(state.settled, false, "a recorded deferral with no recorded decision is unsettled");
  assert.equal(state.cause, "no-decision");
  assert.equal(state.unsettled.length, 1, "and it names what is open");
  assert.ok(state.unsettled[0].reason, "with the reason, not just the qid");

  delete process.env.MOCK_FAIL_STAGE;
  const codename = r1.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const r2 = await pipeline(JOB, { codename });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const events2 = readFileSync(driverDir(r2.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const resettled = events2.filter((e) => e.event === "envelope-decision-early").at(-1);
  assert.equal(resettled?.source, "receipt-reuse", "the resume re-decided at the seam it sails through — the reused clean receipt");
  const rewritten = JSON.parse(readFileSync(driverDir(r2.runDir, "envelope-decision.json"), "utf8"));
  assert.equal(rewritten.accepted.length, 1, "the decision is a durable artifact again, not a log line from a run that ended");
  assert.equal(rewritten.plan_version, receipt.plan_version);
  assert.equal(receiptSettled(paths(r2.runDir), receipt).settled, true, "the receipt the later stages read is settled");
});

test("envelope-settle: a run with NO refusal still records the decision — the zero is looked at, not skipped", async () => {
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.deferred, [], "nothing was refused on this run");
  const decision = JSON.parse(readFileSync(driverDir(res.runDir, "envelope-decision.json"), "utf8"));
  assert.equal(decision.deferred_total, 0);
  for (const k of ["accepted", "closed", "close_failed", "history"]) assert.deepEqual(decision[k], [], `${k} recorded empty`);
  assert.ok(events.some((e) => e.event === "envelope-decision-early" && e.source === "fan-in" && e.deferred === 0),
    "the fan-in still decided — a run that recorded nothing to decide is not the same as a run nobody asked");
  assert.ok(!events.some((e) => e.event === "unsettled-inputs"), "and no stage was reached on unsettled inputs");
  assert.ok(!existsSync(driverDir(res.runDir, "mock-settled-facts.log")),
    "with nothing accepted there is no settled-facts section to carry — the section returns null, never an empty heading");
});

// ── repair-first A1 (2026-07-05): direct executor dispatch at the fan-in plan join ─────────────────────
test("repair-first A1: a missing dictated qid is closed by DIRECT executor dispatch — no agent turn spent", async () => {
  const calls = [];
  const planExecutor = async ({ planPath, axis, outputPath, qids }) => {
    calls.push({ axis, qids });
    // simulate the tool: land the missing dictated blocks into the band (merge-preserving)
    const { qidBlocks } = await import("./mock-stage-fixtures.mjs");
    const blocks = JSON.parse(readFileSync(outputPath, "utf8"));
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    for (const qid of qids) {
      const e = plan.entries.find((x) => x.qid === qid);
      blocks.push(...qidBlocks(qid, e?.expected_kind === "count" ? "count" : "enumerate"));
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_PLAN_DROP_QID: "+merch" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(calls.length >= 1 && calls[0].qids.some((q) => q.endsWith("+merch")), "the dispatch targeted exactly the missing qids");
  const acts = events.filter((e) => e.event === "plan-qids-missing").map((e) => e.action);
  assert.ok(acts.includes("plan-direct-execute"), "the code repair ran first");
  assert.ok(!acts.includes("warm-followup") && !acts.includes("fresh-execute-plan"), "no agent turn spent on the repair");
  assert.ok(events.some((e) => e.event === "repair-attempted" && e.repair === "plan-direct-execute" && e.outcome === "ok"), "the repair ledger recorded the attempt");
  const exec = JSON.parse(readFileSync(driverDir(res.runDir, "plan-execution.json"), "utf8"));
  assert.deepEqual(exec.missing, [], "the dispatch closed every dictated hole");
});

test("repair-first A1: a 414-shaped dispatch failure buys no recovery: its slices are taken out at once, and the record quotes the provider error", async () => {
  // The production 414-wedge shape end-to-end: dispatch fails deterministically (URI too long), the LLM
  // followup can't close it either (sticky drop) → ONE enriched fan-in failure and no recovery parks despite
  // budget. The run no longer ends on it: the slices are the searches not completed, taken out of the band and
  // delivered open on the resumed pass (a-search-a-check-cannot-prove-is-delivered-as-not-searched), and the
  // provider's verbatim error rides on that record.
  const planExecutor = async () => ({ ok: false, cause: "provider error during enumeration (page 0): ERROR: corsearch_search HTTP 414 URI Too Long" });
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
      MOCK_PLAN_DROP_QID: "+merch", MOCK_PLAN_DROP_STICKY: "1", CLEAROTRON_RECOVERY_MAX: "3" }, {}, { planExecutor });
    assert.equal(res.postponed, true, `the slices were not taken out for the delivery: ${JSON.stringify(res).slice(0, 300)}`);
    assert.ok(!existsSync(join(res.runDir, ".failed")), "the run ended over slices it can deliver open");
    const record = JSON.parse(readFileSync(driverDir(res.runDir, "not-completed", "searches.json"), "utf8"));
    assert.equal(record.terminalKind, "deterministic");
    assert.match(record.reason, /HTTP 414/, "the provider's verbatim error reaches the record");
    assert.match(record.reason, /direct dispatch \+ followup/);
    assert.ok(record.slices.length > 0 && record.slices.every((x) => x.qid.endsWith("+merch")), `the record names a slice that landed: ${JSON.stringify(record.slices)}`);
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.recoveryAttempts ?? 0, 0, "no recovery attempt was burned");
  } finally { delete process.env.MOCK_PLAN_DROP_STICKY; delete process.env.CLEAROTRON_RECOVERY_MAX; }
});

test("Fix2 #1: a wrong-class 0/0 dispatch does NOT sweep the directive — the dominant gap stands, verdict clamps CLEAR→CONDITIONAL", async () => {
  // every dispatch searches the matter's OWN classes (9/28/41/42), never the intended Cl.35/38 → 0/0.
  const { planExecutor, calls } = fieldGapExecutor(() => ({ cls: [9, 28, 41, 42], hasRecords: false }));
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  // the mint dispatched NOVAPULSE in the INTENDED classes (Part A): the plan entries carry [35,38], not the item string.
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  const supp = plan.entries.filter((e) => e.origin === "supplemental");
  assert.ok(supp.length >= 1, "Part A minted supplemental register entries from the structured remedy");
  assert.ok(supp.every((e) => e.term === "NOVAPULSE"), "term is the DOMINANT ELEMENT, never the item class-description string");
  assert.ok(supp.every((e) => JSON.stringify(e.nice_classes) === JSON.stringify(["35", "38"])), "classes are the parsed Cl.35/38, never inScope");
  // the executor searched the wrong scope → the directive is NOT swept, the dominant gap is NOT closed.
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.ok(fr, "frame-reopen ran (dispatch arm)");
  assert.equal(fr.domClosed, false, "the wrong-scope 0/0 did NOT close the dominant-element gap");
  assert.equal(fr.swept, 0, "the wrong-class block swept NOTHING");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.equal(receipt.domClosed, false);
  assert.ok(receipt.deferrals.some((d) => d.layer === "field"), "the field directive stays a disclosed deferral");
  // re-attempt-once fired (bounded), then disclosed honestly.
  assert.ok(events.some((e) => e.event === "frame-reopen-reattempt"), "one bounded re-attempt fired");
  assert.ok(calls.length === 2, `exactly two dispatches (attempt + one re-attempt), got ${calls.length}`);
  // the unclosed dominant gap honestly clamps the verdict (never a false CLEAR).
  assert.equal(res.verdict, "CONDITIONAL", "the standing dominant-element gap clamped CLEAR→CONDITIONAL");

  // THE WIRING — the remedy term ledger reaches the receipt, and a term that ran and returned
  // nothing carries its EXECUTED QUERY next to the zero. This is the pipeline half of it: the pure
  // module is unit-tested elsewhere, and this asserts the field is actually written by the run.
  assert.ok(Array.isArray(receipt.remedy_terms) && receipt.remedy_terms.length >= 1,
    `the receipt carries per-term rows, not just qid strings: ${JSON.stringify(receipt.remedy_terms)}`);
  const empty = receipt.remedy_terms.find((r) => r.class === "searched-empty");
  assert.ok(empty, `the wrong-scope 0/0 term is searched-empty: ${receipt.remedy_terms.map((r) => `${r.term}=${r.class}`).join(", ")}`);
  assert.equal(empty.term, "NOVAPULSE");
  assert.ok(empty.slices.length >= 1 && /^exact NOVAPULSE \[cl /.test(empty.slices[0].query),
    "the executed query is on the row — the trace that did not exist before #248");
  assert.equal(empty.slices[0].total_hits, 0, "a counted zero");
  assert.equal(empty.slices[0].records, 0, "an empty records array, stated");
  const acct = events.find((e) => e.event === "remedy-accounting");
  assert.ok(acct && acct.computable === true, "the run.jsonl accounting row fired");
  assert.equal(acct.searched_empty >= 1, true);
  assert.equal(acct.unaccounted, 0, "nothing unaccounted here — the slice ran, it was simply wrong-scoped");
});

test("Fix2 #1: the re-attempt with the correct classes CLOSES the gap — attempt 1 wrong-scope, attempt 2 right", async () => {
  // attempt 1 searches the wrong classes (0/0); the ONE bounded re-attempt searches the intended Cl.35/38 with records.
  const { planExecutor, calls } = fieldGapExecutor((n) => n === 1
    ? { cls: [9, 28, 41, 42], hasRecords: false }
    : { cls: [35, 38], hasRecords: true });
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "frame-reopen-reattempt"), "the re-attempt fired after attempt 1 failed verification");
  assert.equal(calls.length, 2, "bounded to exactly one re-attempt");
  assert.ok(calls[1].cls.join(",") === "35,38", "the re-attempt carried the CORRECT intended classes");
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.equal(fr.domClosed, true, "the correctly-scoped re-attempt closed the dominant-element gap");
  assert.ok(fr.swept >= 1, "the field directive was swept once genuinely searched");
  assert.equal(res.verdict, "CLEAR", "a genuinely-closed gap does not clamp");
});

test("the re-attempt re-sends only the directives that failed, never one that already closed", async () => {
  // Two class-gap directives. The Cl.16 one closes on the first dispatch; the Cl.35/38 one comes back
  // wrong-scoped the first time. Re-sending the closed directive's entries would ask the register again
  // for records the run already holds, and on a register that bills per request pay for them twice.
  const calls = [];
  const planExecutor = async ({ planPath, axis, outputPath, qids }) => {
    const n = calls.length + 1;
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const intendedOf = new Map(plan.entries.map((e) => [e.qid, (e.nice_classes ?? []).map(String)]));
    calls.push({ n, axis, qids: [...qids] });
    const blocks = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : [];
    for (const qid of qids) {
      const intended = intendedOf.get(qid) ?? [];
      const wrong = n === 1 && intended.includes("35");
      const cls = wrong ? ["9", "28", "41", "42"] : intended;
      const block = { state: "enumerated", qid, query: `exact NOVAPULSE [cl ${cls.join(",")}]`, total_hits: wrong ? 0 : 2,
        records: wrong ? [] : [{ record_id: `/mark/us/${qid.slice(-6)}`, mark_text: "NOVAPULSE", classes: cls.map(Number), status: "Registered", owner_name: "Owner", owner_country: "US", screen_verdict: "surface:in-scope-live" }] };
      const i = blocks.findIndex((b) => b && b.qid === qid);
      if (i >= 0) blocks[i] = block; else blocks.push(block);
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap-two" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 2, `one dispatch and one re-attempt: ${JSON.stringify(calls)}`);
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  const classesOf = (q) => (plan.entries.find((e) => e.qid === q)?.nice_classes ?? []).map(String);
  assert.ok(calls[0].qids.some((q) => classesOf(q).includes("16")) && calls[0].qids.some((q) => classesOf(q).includes("35")),
    `the first dispatch carried both directives: ${JSON.stringify(calls[0].qids)}`);
  assert.ok(calls[1].qids.length > 0 && calls[1].qids.every((q) => classesOf(q).includes("35")),
    `the re-attempt carried only the failing directive: ${JSON.stringify(calls[1].qids)}`);
  const re = events.find((e) => e.event === "frame-reopen-reattempt");
  assert.deepEqual(re?.qids, calls[1].qids, "the log names what was re-sent");
});

test("Fix2 #1: a genuine close on the FIRST dispatch sweeps with NO re-attempt (no over-fire, no infinite re-open)", async () => {
  const { planExecutor, calls } = fieldGapExecutor(() => ({ cls: [35, 38], hasRecords: true }));
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" }, {}, { planExecutor });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 1, "a verified close on attempt 1 spends no re-attempt");
  assert.ok(!events.some((e) => e.event === "frame-reopen-reattempt"), "no re-attempt on a genuine first-pass close");
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.equal(fr.domClosed, true);
  assert.ok(fr.swept >= 1);
  assert.equal(res.verdict, "CLEAR");

  // THE WIRING — the closure gate must not manufacture a clamp on a genuine close. Every remedy term
  // here is accounted (`found`: the slice landed with records), so domClosed stays true and the
  // verdict stays CLEAR. Paired with the pure-module test that a single unaccounted term blocks it,
  // this is the gate answering both ways through the real pipeline.
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.ok(Array.isArray(receipt.remedy_terms) && receipt.remedy_terms.length >= 1, "per-term rows written");
  assert.ok(receipt.remedy_terms.every((r) => ["found", "searched-empty"].includes(r.class)),
    `every term accounted: ${receipt.remedy_terms.map((r) => `${r.term}=${r.class}`).join(", ")}`);
  assert.ok(receipt.remedy_terms.some((r) => r.class === "found"), "the slice with records is `found`");
  assert.equal(receipt.remedy_accounting.totals.unaccounted, 0);
  assert.equal(receipt.domClosed, true, "a fully-accounted dominant directive still closes — no manufactured clamp");
});

test("Fix2 #1-resume: the warm-resume arm does NOT close a dominant-element gap on a bare unit byte-diff (planExec null — clarivate/signa/PLAN_DISPATCH=off)", async () => {
  // The dispatch arm's precondition includes `&& planExec`; with no injected planExecutor and
  // CLEAROTRON_PLAN_DISPATCH=off (the harness default, and the live shape for a provider with no executePlan
  // adapter — clarivate/signa), planExec is null so control falls to the warm-RESUME arm. The resumed
  // register-unit re-emits the unit .md byte-changed (the mock stamps a frame-reopen marker) but the band
  // never enumerates NOVAPULSE×[35,38] — exactly the RUN1 wrong-scope false-close, on the un-dispatched arm.
  // Pre-fix: regChanged (byte-diff) swept the dominant-element directive → domClosed:true → false CLEAR.
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FRAME_DIFF: "field-classgap" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const fr = events.find((e) => e.event === "frame-reopen");
  assert.ok(fr, "frame-reopen ran (resume arm)");
  assert.equal(fr.domClosed, false, "a bare unit byte-diff must NOT close an unverifiable dominant-element gap in the resume arm");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "frame-reopen.json"), "utf8"));
  assert.equal(receipt.domClosed, false, "the receipt records the dominant gap as unclosed");
  // pin the MECHANISM, not just the outcome: the deferral must cite unverifiable searched-scope, NOT a
  // record-class read (the co-classification trap — the band's records carry 35/38 from 9/28/41/42
  // co-classification even though 35/38 were never searched, so a records-based verifier would false-close).
  const domDefer = receipt.deferrals.find((d) => d.layer === "field");
  assert.ok(domDefer, "the dominant-element field directive stays a disclosed deferral");
  assert.match(domDefer.reason, /resume-arm-unverifiable/, "deferred because the resume arm cannot verify searched scope (not on a byte-diff / record-class read)");
  assert.equal(res.verdict, "CONDITIONAL", "the standing dominant-element gap clamps CLEAR→CONDITIONAL (never a false CLEAR)");
});


// ── 2026-07-04 production doctrine: AUTOMATIC RUN-LEVEL RECOVERY ────────────────────────────────────────
// A business-critical report converges to an honest delivery WITHOUT a human re-trigger: a recoverable
// failure PARKS (self-contained .postponed the runner watcher resumes), the resume skips valid stages,
// re-runs the broken segment fresh, and passes the SAME gates — recovery can converge, never bypass.
test("auto-recovery: a recoverable failure PARKS (no .failed, no notice) and the automatic resume DELIVERS", async () => {
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FAIL_STAGE: "matter-frame", CLEAROTRON_RECOVERY_MAX: "3" });
    assert.equal(res.ok, false);
    assert.equal(res.postponed, true, JSON.stringify(res));
    assert.equal(res.recovery, true);
    assert.equal(res.attempt, 1);
    assert.ok(!existsSync(join(res.runDir, ".failed")), "NOT terminal — no .failed sentinel");
    assert.ok(!existsSync(driverDir(res.runDir, "failure.json")), "no failure notice on a recoverable park");
    const sent = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    assert.equal(sent.kind, "recovery");
    assert.ok(sent.job && sent.agent && sent.codename, "self-contained payload — the runner watcher re-invokes from this");
    // A4 field split: the recovery park's clock is recoveryResumesAt — resetsAt stays the rate-limit
    // cap's name and must NOT appear on a recovery park (the 2026-07-28 postmortem misread).
    assert.ok(sent.recoveryResumesAt > sent.postponedAt, "backoff window set");
    assert.equal(sent.resetsAt, undefined, "the recovery sentinel no longer overloads the rate-limit field");
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.state, "recovering");
    assert.equal(status.recoveryAttempts, 1);
    assert.ok(status.recoveryResumesAt > sent.postponedAt, "status carries the same split clock");
    assert.equal(status.resetsAt, null, "any lingering rate-limit clock is actively cleared");
    // …the backoff elapses; the runner's self-resume watcher re-invokes pipeline() with the payload.
    // Simulate exactly that (same workspace, transient cause gone):
    delete process.env.MOCK_FAIL_STAGE;
    const { pipeline: resume } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res2 = await resume({ ...JOB }, { codename: sent.codename });
    assert.equal(res2.ok, true, JSON.stringify(res2));
    assert.ok(existsSync(join(res2.runDir, ".delivered")), "the report DELIVERED with zero human involvement");
    assert.ok(!existsSync(join(res2.runDir, ".postponed")), "the recovery sentinel is consumed on resume");
  } finally { delete process.env.CLEAROTRON_RECOVERY_MAX; }
});
