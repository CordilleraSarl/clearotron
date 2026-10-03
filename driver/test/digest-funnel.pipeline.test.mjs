// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end through the re-judgement funnel
// (t1cd) — pipeline-level FUNNEL for step 3's re-judgements. Own file = own process + own workspace root
// (the repo convention for mock-pipeline scenarios). The funnel is UNCONDITIONAL: the queue is the only
// path to a re-judgement besides the sites digest-queue.mjs declares. It was built for the register
// digest; step 3 judges the pile by owner now (owner-judgment.mjs), and the funnel queues re-judgements
// of that step exactly as it queued re-digests.
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot at FIRST import
// with a PRODUCTION default. Pin it to a throwaway root BEFORE any driver module loads —
// a static driver import above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
// provider-usage.DEFAULT_LEDGER_PATH freezes at FIRST import (module const) — pin the call ledger to a
// throwaway file BEFORE any pipeline import, so nothing a run records reaches a shared one.
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-funnel-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// pin the ENGINE BINARY too — the engine path is frozen at first import, and its default is the REAL
// CLI on PATH; with the mock pinned here, an early driver import
// can never reach production even by accident.
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";   // hermetic mock runs never dial the provider — the truth gate must not judge them
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-funnel", msgId: "<funnel@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8904", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// Fresh module graph + env per run. `reuse` re-enters an EXISTING run (same workspace root + codename)
// — the resume path the 13-pass defect lives on.
async function runMockPipeline(env, opts = {}, reuse = null) {
  const root = reuse?.root ?? mkdtempSync(join(tmpdir(), "clearotron-funnel-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE",
    "MOCK_ESCALATION_NOOP", "MOCK_SEARCH_FLOOR", "MOCK_CLAUDE_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(reuse?.codename ? { codename: reuse.codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}

// One `owner-judgment` event per pass of step 3, whatever its trigger; the two judges' own dispatches
// (or skips, when nothing they read moved) are `stage`/`skip` events labelled owner-judgment:1 and :2.
const judgmentPasses = (events) => events.filter((e) => e.event === "owner-judgment");
const judgeDispatches = (events) => events.filter((e) => e.event === "stage" && /^owner-judgment:\d$/.test(String(e.stage)));
const judgeSkips = (events) => events.filter((e) => e.event === "skip" && /^owner-judgment:\d$/.test(String(e.stage)));

// ── WHAT A FAILURE HERE MUST SAY, BECAUSE CI THROWS AWAY THE ONLY THING THAT COULD SAY IT ────────
//
// An assertion on the queued triggers cannot tell "the mechanism never minted" (a pipeline defect) from
// "it minted and was deduplicated" (mintDigestWork is idempotent by receiptKey and the dedup path emits
// `digest-queue-noop` instead of `digest-queued` — the queue is right and the assertion is wrong). The
// discriminator is in the run's run.jsonl and CI keeps no artifact of it, so the message carries it.
const digestPicture = (events) => {
  const queued = events.filter((e) => e.event === "digest-queued");
  const noops = events.filter((e) => e.event === "digest-queue-noop");
  return "\n  queued : " + JSON.stringify(queued.map((e) => `${e.trigger}=${e.receiptKey}`))
    + "\n  noops  : " + JSON.stringify(noops.map((e) => e.receiptKey))
    + "\n  flushes: " + JSON.stringify(events.filter((e) => e.event === "digest-flush").map((e) => e.triggers))
    + "\n  → a trigger in NOOPS and not in QUEUED means it minted and deduplicated: the queue is right"
    + "\n    and this assertion is wrong. Absent from BOTH means the mechanism never fired, which is"
    + "\n    a pipeline defect.";
};
// The skeptic escalates transliteration-numeric, so the escalation re-runs that unit and mints.
const ESCALATE_SKEPTIC = "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — sweep the extra script group";

test("settlement: the escalation MINTS, exactly ONE settlement flush re-judges, and a judge whose inputs did not move is not paid for again", async () => {
  const { res, events } = await runMockPipeline({ MOCK_SKEPTIC: ESCALATE_SKEPTIC }, {});
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));

  // the escalation minted a durable queue item instead of re-judging on its own…
  const queued = events.filter((e) => e.event === "digest-queued");
  assert.deepEqual(queued.map((e) => e.trigger), ["escalation"], "one mint, from the escalation" + digestPicture(events));
  assert.match(queued[0].receiptKey, /^escalation:[0-9a-f]{12}$/);

  // …and exactly ONE settlement flush settled it, before synthesis.
  const flushes = events.filter((e) => e.event === "digest-flush");
  assert.equal(flushes.length, 1, JSON.stringify(flushes));
  assert.equal(flushes[0].pass, "pre-synthesis");
  assert.deepEqual(flushes[0].triggers, ["escalation"]);
  assert.ok(events.findIndex((e) => e.event === "digest-flush")
    < events.findIndex((e) => e.event === "stage" && e.stage === "synthesis"), "the flush lands before synthesis reads the decisions");

  // step 3 ran twice — the first pass and the settlement flush — and nothing else re-judged.
  assert.deepEqual(judgmentPasses(events).map((e) => e.trigger), ["fresh", "settlement-flush"],
    "the fresh pass and the one settlement flush; no mechanism re-judges on its own");
  // The escalation re-ran a unit whose band came back the same, so nothing either judge reads moved:
  // the flush re-merged and re-settled without paying for a second judging.
  assert.equal(judgeDispatches(events).length, 2, "two judges dispatched, on the fresh pass only");
  // ONE JUDGE ON A RE-RUN (owner, 2026-10-01): the flush dispatched one judge, which was fresh and skipped,
  // and merged the other judge's last accepted answer without dispatching it.
  assert.equal(judgeSkips(events).length, 1, "the flush dispatched one judge, not both");
  const flushPass = judgmentPasses(events).find((e) => e.trigger === "settlement-flush");
  assert.deepEqual(flushPass.judges.map((j) => [j.ran, j.ok, j.answer_from]).sort(),
    [[false, true, "an earlier pass"], [true, true, "an earlier pass"]],
    "one judge dispatched and skipped, the other kept on its accepted answer");

  // the durable sidecar: the item receipted (flushedAt set) — a resume can never re-fire it.
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "digest-queue.json"), "utf8"));
  assert.equal(sidecar.items.length, 1);
  assert.ok(sidecar.items.every((i) => i.flushedAt), "the item is flushed");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || res.runDir.includes("/archive/"), "run delivered");
});

test("resume re-entry: a run parked after the flush resumes without a second flush or a second judging", async () => {
  const p1 = await runMockPipeline({ MOCK_SKEPTIC: ESCALATE_SKEPTIC, MOCK_FAIL_STAGE: "record_report_overview" }, {});
  assert.equal(p1.res.ok, false, "pass 1 parks at report-overview");
  assert.deepEqual(p1.events.filter((e) => e.event === "digest-queued").map((e) => e.trigger), ["escalation"],
    "the escalation minted" + digestPicture(p1.events));
  assert.equal(p1.events.filter((e) => e.event === "digest-flush").length, 1, "the settlement flush landed IN pass 1");

  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({ MOCK_SKEPTIC: ESCALATE_SKEPTIC }, {}, { root: p1.root, codename });
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(n1);   // this session's events only (run.jsonl is append-only across passes)

  assert.equal(ev2.filter((e) => e.event === "digest-queued").length, 0, "no NEW mints on the resume");
  assert.equal(ev2.filter((e) => e.event === "digest-flush").length, 0, "nothing pending — no second flush");
  assert.equal(judgeDispatches(ev2).length, 0, "and no judge was dispatched again");
  const sidecar2 = JSON.parse(readFileSync(driverDir(p2.res.runDir, "digest-queue.json"), "utf8"));
  assert.equal(sidecar2.items.length, 1, "no duplicate items across the resume");
  assert.ok(sidecar2.items.every((i) => i.flushedAt), "every receipt flushed");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "resume delivered");
});

// The C2 FAILURE corner — a late flush that fails after the dispatch arm released its closes — is not
// drivable here any more. The flush re-judges, and the resume's own pass of step 3 has already re-judged
// on the swept band (above), so the flush re-dispatches nothing a mock message could fail; the demotion
// it guarded (pipeline.mjs, frameReopenFlushDemote) still fires on a re-judgement that fails.

test("LATE flush (resume past synthesis): a durable pending item gets AT MOST ONE bounded late flush, and the run delivers without a stale-block", async () => {
  // pass 1: synthesis runs, then the run dies at report-overview — narrative.md exists, so the NEXT pass
  // is digest-LOCKED (escalation stays locked out exactly as today).
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "record_report_overview" }, {});
  assert.equal(p1.res.ok, false, "pass 1 dies after synthesis");
  assert.ok(existsSync(join(p1.res.runDir, "narrative.md")), "narrative exists — the digest is locked on resume");
  // Plant a pending item in the durable sidecar — the shape a prior session's envelope mint leaves
  // behind when its settlement never landed.
  const scPath = driverDir(p1.res.runDir, "digest-queue.json");
  // nothing minted in pass 1, so the sidecar may not exist yet: the queue's own empty shape
  const sidecar = existsSync(scPath) ? JSON.parse(readFileSync(scPath, "utf8")) : { schema_version: 1, items: [] };
  sidecar.items.push({
    id: `dq${sidecar.items.length + 1}`, trigger: "envelope", receiptKey: "envelope:feedfacecafe",
    mintedAt: new Date().toISOString(), flushedAt: null,
  });
  writeFileSync(scPath, JSON.stringify(sidecar, null, 2) + "\n");

  // pass 2: resume — digest locked ⇒ the pending item rides ONE bounded LATE flush at the settlement
  // seam, BEFORE the back half's skip evaluation, so a back half the flush moved recomputes in-pass
  // instead of stale-blocking delivery into another park cycle.
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({}, {}, { root: p1.root, codename });
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(n1);
  const flushes2 = ev2.filter((e) => e.event === "digest-flush");
  assert.equal(flushes2.length, 1, "exactly ONE late flush");
  assert.equal(flushes2[0].pass, "late");
  assert.deepEqual(flushes2[0].items, ["envelope:feedfacecafe"]);
  assert.deepEqual(judgmentPasses(ev2).map((e) => e.trigger).filter((t) => t !== "fresh"), ["late-flush"], "one re-judgement on the resume — the late flush");
  // The flush re-judged and nothing the judges read had moved, so the decisions came back byte-identical
  // and synthesis, which reads them, was not re-run for nothing. Had they moved, the staleness contract
  // would re-run it here, in-pass — never a stale-block that parks the run into another cycle.
  assert.equal(judgeDispatches(ev2).length, 0, "no judge was dispatched: the flush found both fresh");
  assert.ok(!ev2.some((e) => e.event === "stage" && e.stage === "synthesis"), "synthesis was not re-run over unchanged decisions");
  assert.ok(!ev2.some((e) => e.event === "delivery-stale-blocked"), "no stale-block park cycle");
  const sidecar2 = JSON.parse(readFileSync(driverDir(p2.res.runDir, "digest-queue.json"), "utf8"));
  assert.ok(sidecar2.items.every((i) => i.flushedAt), "the late-flushed item is receipted — it can never re-fire");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "delivered");
});

