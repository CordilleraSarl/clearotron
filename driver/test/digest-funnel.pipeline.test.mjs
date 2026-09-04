// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end through the digest funnel
// (t1cd) — pipeline-level digest-trigger FUNNEL. Own file = own process + own workspace root
// (the repo convention for mock-pipeline scenarios). The funnel is UNCONDITIONAL (the
// CLEAROTRON_DIGEST_FUNNEL scaffolding flag and the legacy per-mechanism immediate re-digest paths were
// deleted post-E2E 2026-07-22, per the no-dormant-flags rule): the queue is the only re-digest path.
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot at FIRST import
// with a PRODUCTION default. Pin it to a throwaway root BEFORE any driver module loads —
// a static driver import above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
// provider-usage.DEFAULT_LEDGER_PATH freezes at FIRST import (module const) — pin the call ledger to a
// throwaway file BEFORE any pipeline import so the screen-gate's fetched-universe reads OUR ledger.
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "prelim-funnel-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
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
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";   // hermetic mock runs never dial the provider — the truth gate must not judge them
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-funnel", msgId: "<funnel@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8904", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// A recordFetcher faithful to the real plugin chokepoint: the fetch lands a record_fetch row in the
// call ledger under the run's session key, which is exactly what the gate's fetched-universe reads.
const landingFetcher = (fetched = []) => async (uri, { sessionKey }) => {
  fetched.push(uri);
  appendFileSync(LEDGER, JSON.stringify({
    ts: new Date().toISOString(), agentId: "clawdi", sessionKey: `agent:clawdi:${sessionKey}`,
    tool: "record_fetch", target: uri,
  }) + "\n");
  return { ok: true };
};

// Fresh module graph + env per run. `reuse` re-enters an EXISTING run (same workspace root + codename)
// — the resume path the 13-pass defect lives on.
async function runMockPipeline(env, opts = {}, reuse = null) {
  const root = reuse?.root ?? mkdtempSync(join(tmpdir(), "prelim-funnel-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF",
    "MOCK_ESCALATION_NOOP", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CLAUDE_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(reuse?.codename ? { codename: reuse.codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}

const digestStageEvents = (events) => events.filter((e) => e.event === "stage" && e.stage === "register-digest");

// ── WHAT A FAILURE HERE MUST SAY, BECAUSE CI THROWS AWAY THE ONLY THING THAT COULD SAY IT ────────
//
// This file fails intermittently in CI and passes on re-run, and the assertion it fails on —
// `digest-queued` triggers deep-equal ["envelope","escalation","screen-gate"] — CANNOT DISTINGUISH
// TWO OPPOSITE CAUSES:
//
//   1. the screen-gate mechanism never minted. A real defect in the pipeline.
//   2. it minted and was DEDUPLICATED. mintDigestWork is idempotent by receiptKey
//      (`screen-gate:<uri-set-hash>`, pipeline.mjs:7427-7409) and the dedup path emits `digest-queue-noop`
//      instead of `digest-queued`. The queue is correct and THIS ASSERTION is wrong.
//
// Those want opposite fixes. The discriminator — which of the two happened — exists on disk in the
// mock run's `run.jsonl` at the moment of failure, and CI keeps no artifact of it. All that survives
// a red run is `expected 3, got 2`, which is why three separate reports of this failure have produced
// no diagnosis in a month.
//
// So the ASSERTION MESSAGE carries the discriminator. It travels with the failure, into the CI log,
// with no artifact upload and no infrastructure — and it works identically when somebody runs the
// file locally. Same principle as jx's degradedCause reaching the sentence and not only the field
// (/), one layer in: a diagnostic that does not reach the reader has not been produced.
//
//, ONE LAYER FURTHER IN. The above splits "never fired" from "fired and deduplicated". When the
// answer is "never fired" the next question is WHY, and that answer is the screen-gate's own zero: the
// gate found no violations, and until it could not say whether that was because the findings file
// was missing (a defect) or because there was genuinely nothing to flag (clean). Both wrote the same
// `{event:"screen-gate-clean"}`. `screenGateZeroCause` now names which, and it has to be CARRIED HERE
// for the same reason this whole block exists — the cause lands in run.jsonl, and CI keeps no artifact
// of run.jsonl. A discriminator that stops at the disk has not reached the reader.
const digestPicture = (events) => {
  const queued = events.filter((e) => e.event === "digest-queued");
  const noops = events.filter((e) => e.event === "digest-queue-noop");
  const clean = events.filter((e) => e.event === "screen-gate-clean");
  return "\n  queued : " + JSON.stringify(queued.map((e) => `${e.trigger}=${e.receiptKey}`))
    + "\n  noops  : " + JSON.stringify(noops.map((e) => e.receiptKey))
    + "\n  flushes: " + JSON.stringify(events.filter((e) => e.event === "digest-flush").map((e) => e.triggers))
    + "\n  gate0  : " + (clean.length
      // THREE writers share this event name and only one of them is a zero: the two `recovered` arms mean
      // violations existed and were healed, which is not a zero at all and carries no cause. Rendering
      // them as `undefined(...)` would put noise in the one line that exists to end the confusion.
      ? JSON.stringify(clean.map((e) => e.recovered
          ? `recovered${e.pass ? `(pass ${e.pass})` : ""} — violations existed and were healed, NOT a zero`
          : `${e.cause}(bytes=${e.findingsBytes} rows=${e.dropRows}/${e.dropRowsUnfiltered})`))
      : "[] — the gate never reached its clean branch, so screen-gate's silence is NOT a clean-zero")
    + "\n  → a trigger in NOOPS and not in QUEUED means it minted and deduplicated: the queue is right"
    + "\n    and this assertion is wrong. Absent from BOTH means the mechanism never fired, which is"
    + "\n    a pipeline defect. #739."
    + "\n  → if screen-gate is absent from both, GATE0 says why it minted nothing: findings-absent or"
    + "\n    findings-empty is the defect (the findings file the gate reads was never written);"
    + "\n    no-drop-rows / all-fetched / unnamed-drops-unarmed mean the gate was genuinely clean and"
    + "\n    the fault is upstream of it. #1215.";
};
// The skeptic escalates transliteration-numeric (NOT primary-sweep, whose unit the envelope close must
// still byte-change) — so escalation + envelope + screen-gate ALL fire in one run.
const ESCALATE_SKEPTIC = "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — sweep the extra script group";

test("multi-trigger settlement: escalation + envelope + screen-gate all MINT; exactly ONE consolidated flush carries all three sections + the full re-emission contract", async () => {
  const callLog = join(mkdtempSync(join(tmpdir(), "funnel-calllog-")), "argv.jsonl");
  const fetched = [];
  const { res, events } = await runMockPipeline(
    { MOCK_SKEPTIC: ESCALATE_SKEPTIC, MOCK_SCREEN_DROP: "1", MOCK_CLAUDE_CALL_LOG: callLog },
    { recordFetcher: landingFetcher(fetched) });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));

  // all three mechanisms minted durable queue items…
  const queued = events.filter((e) => e.event === "digest-queued");
  assert.deepEqual(queued.map((e) => e.trigger).sort(), ["envelope", "escalation", "screen-gate"],
    "three mints, one per mechanism" + digestPicture(events));
  for (const e of queued) assert.match(e.receiptKey, new RegExp(`^${e.trigger}:[0-9a-f]{12}$`));

  // …and exactly ONE settlement flush reconciled them (clean frame-diff ⇒ the standalone seam).
  const flushes = events.filter((e) => e.event === "digest-flush");
  assert.equal(flushes.length, 1, JSON.stringify(flushes));
  assert.equal(flushes[0].pass, "pre-synthesis");
  assert.deepEqual([...flushes[0].triggers].sort(), ["envelope", "escalation", "screen-gate"]);
  assert.equal(flushes[0].items.length, 3, "all three receipts flushed together");

  // digest passes: fresh + the settlement flush — NO per-mechanism opus passes.
  assert.deepEqual(digestStageEvents(events).map((e) => e.trigger), ["fresh", "settlement-flush"],
    "exactly two digest passes; escalation/envelope/screen-gate-refetch triggers are gone");

  // the screen-gate was cleared by the driver code-fetch ALONE (no immediate re-digest)…
  assert.ok(fetched.includes("/mark/cn/88001-42"), "the flagged URI was code-fetched");
  assert.ok(events.some((e) => e.event === "screen-gate-clean" && e.recovered === true), "gate clean after the code-fetch");
  // …and the envelope's closure verification ran POST-FLUSH over the re-digested ledger.
  const closed = events.find((e) => e.event === "envelope-closed");
  assert.ok(closed && closed.axes.includes("primary-sweep"), "envelope-closed verified after the flush landed");
  const flushIdx = events.findIndex((e) => e.event === "digest-flush");
  assert.ok(events.findIndex((e) => e.event === "envelope-closed") > flushIdx, "verification strictly after the flush");

  // the durable sidecar: every item receipted (flushedAt set) — a resume can never re-fire them.
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "digest-queue.json"), "utf8"));
  assert.equal(sidecar.items.length, 3);
  assert.ok(sidecar.items.every((i) => i.flushedAt), "all items flushed");

  // the FLUSH MESSAGE itself (captured from the mock's argv log): one followup, all three sections,
  // ending with the standard FULL re-emission contract — and never a partial-emission instruction.
  const msgs = readFileSync(callLog, "utf8").trim().split("\n").map((l) => JSON.parse(l).prompt ?? "");
  const flushMsgs = msgs.filter((m) => m.includes("=== section:"));
  assert.equal(flushMsgs.length, 1, "exactly ONE consolidated flush followup was dispatched");
  const fm = flushMsgs[0];
  for (const t of ["escalation", "envelope", "screen-gate"]) assert.ok(fm.includes(`=== section: ${t} ===`), `section ${t} present`);
  // ── THE RE-EMISSION CONTRACT INVERTED AT CONVERSION 11, AND THAT IS THE POINT OF IT ────────────
  //
  // This used to pin "reconcile … Coverage ledger included — the driver re-derives its JSON mirror from
  // your prose" and "TARGETED EDITS … using the Edit tool", and forbid any instruction to send only the
  // changed rows. All three were right for a seat that HAND-WROTE the document: a partial emission then
  // meant a truncated file, so the contract had to demand the whole thing.
  //
  // The seat sends values now and the driver renders, so the safe form is exactly the one the old rule
  // banned — a PATCH naming only what changed, with everything unnamed coming back byte-identical.
  // That guarantee is not free and is not decorative: it holds only because the patch merge keys every
  // list rather than replacing it, which is the defect that took a delivered round from 19 findings to
  // 4. So this arm pins the promise, and `register-digest-record.test.mjs` pins the merge that keeps it.
  assert.match(fm, /sending a PATCH call to `record_register_digest` \(patch: true\)/,
    "the repair is a call, not an edit");
  assert.match(fm, /carrying ONLY the rows and sections you are changing/,
    "…and a PARTIAL one — the exact instruction the pre-conversion contract had to forbid");
  assert.match(fm, /what you do not name comes back byte-identical/,
    "the promise that makes a partial safe, stated to the seat rather than assumed by it");
  assert.match(fm, /There is no file for you to write or edit/,
    "and said outright, so a seat cannot fall back on the habit the old contract taught it");
  assert.doesNotMatch(fm, /TARGETED EDITS|Edit tool|full file, not a diff/,
    "not one write order survives — a seat obeying one would be writing over the driver's render");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || res.runDir.includes("/archive/"), "run delivered");
});

test("multi-resume re-entry (the 13-pass probe): an unretrievable drop no longer parks the run at the gate — it discloses, the flush settles in-pass, and a resume re-mint NO-OPS with the disclosure intact", async () => {
  // pass 1: all three mechanisms mint. The screen-gate's terminal is now DISCLOSE-AND-CONTINUE (owner
  // decision 2026-07-22 — the fetch fails, the drop cannot be examined, and pre-decision this arm
  // fail-louded the whole run here), so the run reaches the settlement point IN THIS PASS and the ONE
  // consolidated flush lands; the park is scripted AFTER synthesis (report-overview) instead, the shape
  // a real mid-delivery crash leaves behind.
  const failingFetcher = async () => ({ ok: false, cause: "record 404 (mock — unretrievable)" });
  const p1 = await runMockPipeline(
    { MOCK_SKEPTIC: ESCALATE_SKEPTIC, MOCK_SCREEN_DROP: "persist", MOCK_FAIL_STAGE: "record_report_overview" },
    { recordFetcher: failingFetcher });
  assert.equal(p1.res.ok, false, "pass 1 parks at report-overview");
  assert.notEqual(p1.res.failedStage, "screen-gate", "NOT at the screen-gate — disclose-and-continue, never a dead run");
  assert.deepEqual(p1.events.filter((e) => e.event === "digest-queued").map((e) => e.trigger).sort(),
    ["envelope", "escalation", "screen-gate"], "all three minted" + digestPicture(p1.events));
  // the unexamined drop was disclosed, not fatal — and the durable sidecar survives the park
  assert.ok(p1.events.some((e) => e.event === "screen-gate-unresolved" && e.action === "disclose-clamp"
    && e.uris.includes("/mark/cn/88001-42")), "disclose-clamp recorded for the unretrievable URI");
  const sgSidecar1 = JSON.parse(readFileSync(driverDir(p1.res.runDir, "screen-gate-unresolved.json"), "utf8"));
  assert.equal(sgSidecar1.unresolved[0].mark, "KINETIC");
  const flushes1 = p1.events.filter((e) => e.event === "digest-flush");
  assert.equal(flushes1.length, 1, "the settlement flush landed IN pass 1 (the gate no longer blocks the seam)");
  assert.deepEqual([...flushes1[0].triggers].sort(), ["envelope", "escalation", "screen-gate"]);
  assert.deepEqual(digestStageEvents(p1.events).map((e) => e.trigger), ["fresh", "settlement-flush"], "two digest passes, pass 1");
  const sgKey = p1.events.find((e) => e.event === "digest-queued" && e.trigger === "screen-gate").receiptKey;

  // pass 2 (fresh-session resume, record STILL unretrievable): the gate re-enters with the SAME violating
  // row ⇒ re-mint is a no-op (the flushed receipt survived the resume: the 13-pass fix), NOTHING re-fires,
  // and the run delivers CONDITIONAL carrying the re-disclosed unexamined mark.
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline(
    { MOCK_SKEPTIC: ESCALATE_SKEPTIC, MOCK_SCREEN_DROP: "persist" },
    { recordFetcher: failingFetcher },
    { root: p1.root, codename });
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(n1);   // this session's events only (run.jsonl is append-only across passes)

  assert.ok(ev2.some((e) => e.event === "digest-queue-noop" && e.receiptKey === sgKey),
    "the resumed screen-gate re-mint NO-OPS on the pass-1 receipt");
  assert.equal(ev2.filter((e) => e.event === "digest-queued").length, 0, "no NEW mints on the resume (same firing sets)");
  assert.equal(ev2.filter((e) => e.event === "digest-flush").length, 0, "nothing pending — no second flush");
  // the 13-pass shape stays collapsed: two sessions, three mechanisms, TWO digest passes total.
  assert.equal(digestStageEvents(p2.events).length, 2, "fresh + settlement-flush (both pass 1) — nothing else, ever");
  const sidecar2 = JSON.parse(readFileSync(driverDir(p2.res.runDir, "digest-queue.json"), "utf8"));
  assert.equal(sidecar2.items.length, 3, "no duplicate items across the resume");
  assert.ok(sidecar2.items.every((i) => i.flushedAt), "every receipt flushed");
  // the disclosure held across the park: delivered CONDITIONAL, never CLEAR over an unexamined mark
  assert.equal(p2.res.verdict, "CONDITIONAL", "the unexamined drop clamps the delivered verdict");
  assert.ok(ev2.some((e) => e.event === "coverage-floor-clamp" && e.screenGate === 1), "the floor's screenGateGap arm fired");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "resume delivered");
});

// ── C2 (PR-6): the digest lock no longer strands a post-synthesis frame-reopen ────────────────────
// The 2026-07-28 E2E postmortem run: nine directives fired on a resume past synthesis and ALL deferred as
// digest-locked-resume — the lock protected the audit spine from WARM re-runs, but it also blocked
// the PURE-CODE dispatch arm that only writes band/plan receipts. Now: the dispatch arm runs UNDER
// the lock (mint → fold → deterministic executor → per-directive verify → placement refresh), its
// reconcile segment is MINTED into the durable queue, and it rides the ONE bounded late flush at the
// standalone settlement seam; the back half recomputes once, in-pass. Warm arms stay locked.
test("C2: a digest-locked resume runs the pure-code dispatch arm under the lock; the reconcile rides the late flush; the run delivers with the gap genuinely closed", async () => {
  // pass 1: clean frame-diff, dies at report-overview — narrative.md exists ⇒ the resume is digest-locked.
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "record_report_overview" }, {});
  assert.equal(p1.res.ok, false, "pass 1 dies after synthesis");
  assert.ok(existsSync(join(p1.res.runDir, "narrative.md")), "narrative exists — the digest is locked on resume");
  assert.ok(!existsSync(driverDir(p1.res.runDir, "frame-reopen.json")), "clean diff — no reopen receipt to arm the already-attempted guard");

  // Between passes the blind re-derivation surfaces a NEW dominant-element field class-gap (the
  // post-synthesis-ask shape). Script it on disk AND via the fixture env so the pass-2 frame-diff
  // parse sees it whether the stage skips or re-runs.
  const fdPath = join(p1.res.runDir, "frame-diff.json");
  writeFileSync(fdPath, JSON.stringify({
    schema_version: 1, dominant_element: "NOVAPULSE",
    directives: [{ layer: "field", item: "Cl. 35 (retail/online-retail) and Cl. 38 (online comms)",
      observation: "scope-ledger marks 35/38 applied but no query was ever class-pinned to 35 or 38", severity: "dominant-element" }],
    dominant_element_gap: true,
  }));

  // The injected executor IS the dispatch arm's lane (opts.planExecutor beats CLEAROTRON_PLAN_DISPATCH=off):
  // it lands correctly-scoped enumerated blocks for the minted qids — a genuine close.
  const dispatches = [];
  const planExecutor = async ({ outputPath, qids }) => {
    dispatches.push(qids);
    const blocks = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : [];
    for (const qid of qids) {
      const block = { state: "enumerated", qid, query: `exact NOVAPULSE [cl 35,38]`, total_hits: 1,
        records: [{ record_id: `/mark/us/${qid.slice(-6)}`, mark_text: "NOVAPULSE", classes: [35, 38], status: "Registered", owner_name: "Owner", owner_country: "US", screen_verdict: "surface:in-scope-live" }] };
      const i = blocks.findIndex((b) => b && b.qid === qid);
      if (i >= 0) blocks[i] = block; else blocks.push(block);
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };

  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({ MOCK_FRAME_DIFF: "field-classgap" }, { planExecutor }, { root: p1.root, codename });
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(n1);

  // the dispatch arm RAN under the lock — never the digest-locked-resume blanket deferral
  const fr = ev2.find((e) => e.event === "frame-reopen");
  assert.ok(fr, "frame-reopen ran on the locked resume (dispatch arm)");
  assert.ok(fr.swept >= 1, "the directive was genuinely swept (verified per-directive)");
  assert.equal(fr.domClosed, true, "the dominant-element gap CLOSED — a locked resume can now end its asks");
  assert.ok(!ev2.some((e) => e.event === "frame-reopen-skipped" && e.reason === "digest-locked-resume"),
    "the blanket digest-locked-resume skip is gone when the pure-code lane exists");
  assert.ok(dispatches.length >= 1, "the deterministic executor dispatched the minted qids");

  // the reconcile segment was MINTED, not inline-flushed — and rode the ONE bounded late flush
  assert.ok(ev2.some((e) => e.event === "digest-queued" && e.trigger === "frame-reopen"), "the reconcile segment is a durable queue item");
  const flushes = ev2.filter((e) => e.event === "digest-flush");
  assert.equal(flushes.length, 1, "exactly one flush on the resume");
  assert.equal(flushes[0].pass, "late", "…and it is the LATE flush at the standalone settlement seam");
  assert.ok(flushes[0].triggers.includes("frame-reopen"));
  // — the "fresh" pass ahead of the late flush is stage-freshness doing its job, NOT a regression to
  // fix back. The frame-settling block moved above placement-inquiry, so the dispatch arm's sweep now lands
  // UPSTREAM of the register-digest seam instead of downstream of it: the band it rewrites is a declared
  // digest input, the digest is therefore stale when the pass reaches that seam, and it re-runs on the
  // settled band. The minted reconcile still rides the existing late flush (the PR-6 mechanism is
  // untouched). Net on THIS path — a digest-locked resume that also fires a reopen — is one extra digest
  // pass; net on a FRESH run, which is what is about, is one placement dispatch instead of two.
  // What must NOT appear here is an inline pre-synthesis flush under the lock, and it does not.
  assert.deepEqual(digestStageEvents(ev2).map((e) => e.trigger), ["fresh", "late-flush"],
    "the freshness-forced digest, then the ONE bounded late flush — never an inline pre-synthesis flush under the lock");
  assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "synthesis"), "the back half recomputed once, in-pass, off the flushed findings");

  // the receipt carries the ask ledger's substrates: per-directive minted qids (executed is COMPUTED)
  const receipt = JSON.parse(readFileSync(driverDir(p2.res.runDir, "frame-reopen.json"), "utf8"));
  const qidLists = Object.values(receipt.directive_qids ?? {});
  assert.ok(qidLists.length >= 1 && qidLists[0].length >= 1, "the receipt records which qids each directive minted");

  // …and the ask ledger ends the frame ask EXECUTED via the plan-execution join, never by assertion
  const asksDoc = JSON.parse(readFileSync(driverDir(p2.res.runDir, "asks.json"), "utf8"));
  const frameAsk = asksDoc.asks.find((a) => a.born.place === "frame-diff");
  assert.ok(frameAsk, "the frame directive is an ask row");
  assert.equal(frameAsk.ending?.kind, "executed");
  assert.equal(frameAsk.ending?.by, "plan-execution-join", "executed is computed from the join");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "delivered");
});

// C2 review fix (2026-07-29) — the FAILURE corner of the locked path: the dispatch arm verifies its
// closes and releases the clamp BEFORE the late flush that reconciles them into the findings. If that
// flush FAILS, the redigest-fail demotion invariant (the unlocked path's inline demotion) must hold:
// verified-closed directives demote back to disclosed deferrals, the receipt rewrites domClosed:false,
// ctx.frameReopenGap re-arms, and the delivered verdict carries the unreconciled gap — never a CLEAR
// shipped over records the findings/narrative have not seen.
test("C2 failure corner: the late flush FAILS under the lock — verified closes demote to deferrals, the receipt rewrites, the clamp holds, and the eventual delivery is CONDITIONAL", async () => {
  // pass 1: clean diff, dies at report-overview — narrative.md exists ⇒ the resume is digest-locked.
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "record_report_overview" }, {});
  assert.equal(p1.res.ok, false, "pass 1 dies after synthesis");
  assert.ok(existsSync(join(p1.res.runDir, "narrative.md")), "narrative exists — the digest is locked on resume");

  // between passes the blind re-derivation surfaces the dominant-element field class-gap (same shape
  // as the success test — only the flush outcome differs).
  writeFileSync(join(p1.res.runDir, "frame-diff.json"), JSON.stringify({
    schema_version: 1, dominant_element: "NOVAPULSE",
    directives: [{ layer: "field", item: "Cl. 35 (retail/online-retail) and Cl. 38 (online comms)",
      observation: "scope-ledger marks 35/38 applied but no query was ever class-pinned to 35 or 38", severity: "dominant-element" }],
    dominant_element_gap: true,
  }));
  const planExecutor = async ({ outputPath, qids }) => {
    const blocks = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : [];
    for (const qid of qids) {
      const block = { state: "enumerated", qid, query: `exact NOVAPULSE [cl 35,38]`, total_hits: 1,
        records: [{ record_id: `/mark/us/${qid.slice(-6)}`, mark_text: "NOVAPULSE", classes: [35, 38], status: "Registered", owner_name: "Owner", owner_country: "US", screen_verdict: "surface:in-scope-live" }] };
      const i = blocks.findIndex((b) => b && b.qid === qid);
      if (i >= 0) blocks[i] = block; else blocks.push(block);
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };

  // pass 2: the dispatch arm runs under the lock and verifies its close, but the LATE flush turn
  // FAILS (the mock kills any turn carrying the frame-reopen flush section — a non-timeout failure,
  // so no in-flush retry).
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline(
    { MOCK_FRAME_DIFF: "field-classgap", MOCK_FAIL_STAGE: "=== section: frame-reopen ===" },
    { planExecutor }, { root: p1.root, codename });
  const ev2 = p2.events.slice(n1);

  // the arm verified its close first (receipt-swept, dom closed)…
  const fr = ev2.find((e) => e.event === "frame-reopen");
  assert.ok(fr && fr.swept >= 1 && fr.domClosed === true, "the dispatch arm verified its close before the flush");
  // …then the late flush failed and the demotion hook fired
  const ff = ev2.find((e) => e.event === "digest-flush-failed");
  assert.ok(ff && ff.pass === "late", "the late flush failed (non-fatal — items stay pending)");
  const dem = ev2.find((e) => e.event === "frame-reopen-redigest-failed");
  assert.ok(dem && dem.pass === "late" && (dem.demoted ?? []).length >= 1, "the verified closes were DEMOTED on the flush failure");
  assert.ok(ev2.findIndex((e) => e.event === "frame-reopen-redigest-failed") > ev2.findIndex((e) => e.event === "frame-reopen"),
    "demotion strictly after the receipt released the closes — the hook, not the inline path");

  // the receipt now discloses: nothing swept, dom gap OPEN, deferrals carry the redigest-fail reason
  const receipt = JSON.parse(readFileSync(driverDir(p2.res.runDir, "frame-reopen.json"), "utf8"));
  assert.deepEqual(receipt.swept, [], "no directive stays 'swept' over an unreconciled digest");
  assert.equal(receipt.domClosed, false);
  assert.ok(receipt.deferrals.length >= 1 && receipt.deferrals.every((d) => /^redigest-fail:/.test(d.reason)),
    "every demoted directive carries the honest redigest-fail reason");
  const qidLists = Object.values(receipt.directive_qids ?? {});
  assert.ok(qidLists.length >= 1 && qidLists[0].length >= 1, "the receipt keeps its qid substrate through the demotion");

  // the clamp re-armed IN THIS PASS: the CLEAR entry verdict was clamped CONDITIONAL over the frame gap
  const clamp = ev2.find((e) => e.event === "coverage-floor-clamp" && e.frameGap === true);
  assert.ok(clamp, "the frameReopenGap clamp stands — the verdict carries the unreconciled gap");
  // …and the ask ledger ends the frame ask as a disclosed RECOVERY, never a false 'executed'
  const asksDoc = JSON.parse(readFileSync(driverDir(p2.res.runDir, "asks.json"), "utf8"));
  const frameAsk = asksDoc.asks.find((a) => a.born.place === "frame-diff");
  assert.ok(frameAsk, "the frame directive is an ask row");
  assert.equal(frameAsk.ending?.kind, "recovery", "demoted ⇒ a loud handover, not a claimed execution");
  assert.match(frameAsk.ending?.reasons?.[0] ?? "", /^redigest-fail:/);

  // the reconcile item stays PENDING (durable) — the failure residue the design names
  const sidecar2 = JSON.parse(readFileSync(driverDir(p2.res.runDir, "digest-queue.json"), "utf8"));
  const frItem = sidecar2.items.find((i) => i.trigger === "frame-reopen");
  assert.ok(frItem && !frItem.flushedAt, "the reconcile item stays pending for the next resume");
  // whatever this pass's terminal, a CLEAR never shipped over the gap.
  //
  // — THIS PASS NOW DELIVERS, and the third pass this test used to need is gone with the reason it
  // existed. Before the move the digest ran ahead of the reopen, so a failed reconcile flush left
  // register-findings.md never having seen the swept band: delivery stale-blocked and the run parked into
  // another resume to get its one more flush. Now the sweep lands upstream of the digest seam, the
  // freshness-forced digest above has ALREADY read the settled band, and the failed flush costs the
  // reconcile segment rather than the delivery. So the demotion is what rides to the client — the closes
  // demote to disclosed deferrals and the run ships CONDITIONAL in ONE pass instead of two.
  //
  // Worth naming because it is the conservative direction and not obviously right: the fresh digest DID
  // absorb those closes into the findings, and the demotion disclaims them anyway (its trigger is still
  // "the flush that was promised did not land"). That over-discloses — CONDITIONAL where the evidence
  // would now support CLEAR — which is the safe way to be wrong here. Tightening the demotion's trigger
  // to "did any digest pass read this band" belongs with the reopen receipt writer, not here.
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.equal(p2.res.verdict, "CONDITIONAL", "the demoted deferral rides to delivery as a disclosed CONDITIONAL — never CLEAR over the gap");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"),
    "the failed reconcile flush no longer parks the run: it delivers, carrying the demotion");
  const receipt3 = JSON.parse(readFileSync(driverDir(p2.res.runDir, "frame-reopen.json"), "utf8"));
  assert.deepEqual(receipt3.swept, [], "the demotion is durable — nothing silently re-promotes the close before delivery");
});

test("LATE flush (resume past synthesis): a durable pending item gets AT MOST ONE bounded late flush; the staleness recompute of the back half happens once, in-pass, and the run delivers", async () => {
  // pass 1: funnel ON, envelope mints + settles pre-synthesis, synthesis runs, then the run dies at
  // report-overview — narrative.md exists, so the NEXT pass is digest-LOCKED (escalation stays locked
  // out exactly as today).
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "record_report_overview" }, {});
  assert.equal(p1.res.ok, false, "pass 1 dies after synthesis");
  assert.ok(existsSync(join(p1.res.runDir, "narrative.md")), "narrative exists — the digest is locked on resume");
  // Plant a POST-SYNTHESIS-CLASS pending item in the durable sidecar — the shape a prior session's
  // screen-gate mint leaves behind when its settlement never landed (segment text mirrors the real
  // re-decide segment; invented mark/URI).
  const scPath = driverDir(p1.res.runDir, "digest-queue.json");
  const sidecar = JSON.parse(readFileSync(scPath, "utf8"));
  sidecar.items.push({
    id: `dq${sidecar.items.length + 1}`, trigger: "screen-gate", receiptKey: "screen-gate:feedfacecafe",
    followupSegment: "The driver has record_fetched the marks below — their REAL goods/services are in the run's record set.\nRE-DECIDE EACH on its fetched goods: keep it as a conflict/finding if in-field; otherwise record the drop with a fetched-goods justification (never a name/owner-inferred guess).\n- /mark/nz/70000123 (GLASS LANTERN)",
    mintedAt: new Date().toISOString(), flushedAt: null,
  });
  writeFileSync(scPath, JSON.stringify(sidecar, null, 2) + "\n");

  // pass 2: resume — digest locked ⇒ the pending item rides ONE bounded LATE flush at the settlement
  // seam, BEFORE the back half's skip evaluation, so synthesis recomputes in-pass off the flushed
  // findings instead of stale-blocking delivery into another park cycle.
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({}, {}, { root: p1.root, codename });
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(n1);
  const flushes2 = ev2.filter((e) => e.event === "digest-flush");
  assert.equal(flushes2.length, 1, "exactly ONE late flush");
  assert.equal(flushes2[0].pass, "late");
  assert.deepEqual(flushes2[0].items, ["screen-gate:feedfacecafe"]);
  assert.deepEqual(digestStageEvents(ev2).map((e) => e.trigger), ["late-flush"], "one digest pass on the resume — the late flush");
  // the staleness contract fired ONCE, in-pass: synthesis re-RAN (not skipped) over the flushed findings
  assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "synthesis"), "synthesis recomputed in-pass");
  assert.ok(!ev2.some((e) => e.event === "delivery-stale-blocked"), "no stale-block park cycle");
  const sidecar2 = JSON.parse(readFileSync(driverDir(p2.res.runDir, "digest-queue.json"), "utf8"));
  assert.ok(sidecar2.items.every((i) => i.flushedAt), "the late-flushed item is receipted — it can never re-fire");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "delivered");
});

