// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Rate-limit POSTPONE regression (2026-06-22 incident). Two prelim runs (NOVAPULSE, BIOVELTRIN) hard-FAILED on a
// register-stage 429 (Claude subscription 5h cap), stranding ~1.5h of completed stages — even though the driver
// ships a designed postpone+auto-resume path. ROOT CAUSE: pipelineInner's terminal catch wrapped the ENTIRE
// stage sequence and swallowed the rate-limited StageFailure (writing .failed + firing notify-fail) before it
// could reach pipeline()'s outer catch, which is the ONLY place that postpones. The fix re-throws rate-limited
// StageFailures from that catch. SECONDARY: a 429 with no reset timestamp parked with resetsAt=null, which
// claimDuePostponed resumed immediately → hot-loop; postponedDueAt() now applies a default backoff.
//
// This test proves (1) a mid-run register-sweep 429 POSTPONES the run (resumable) instead of failing it, with
// every earlier stage intact, and (2) the postpone resume-timing honors resetsAt and backs off when it's absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
// NB: runner.mjs (for postponedDueAt) is imported DYNAMICALLY inside its test — a top-level import would
// evaluate driver.config.mjs at load time, before the pipeline test sets CLEAROTRON_WORK_DIR, freezing the
// run-lock dir to the real home path. The pipeline test likewise dynamic-imports pipeline.mjs after env setup.

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_MOCK = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE_MOCK, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-rl", msgId: "<test-rl@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// A fixed, far-future epoch (SECONDS) so the engine's ISO conversion (resetsAt*1000) is deterministic.
const RESET_EPOCH_SEC = 2000000000;                       // 2033-05-18T03:33:20Z
const RESET_ISO = new Date(RESET_EPOCH_SEC * 1000).toISOString();

test("a mid-run register-sweep 429 POSTPONES the run (resumable) — never writes .failed / notify-fail", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-rl-"));
  for (const k of ["MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED", "MOCK_CANDSELF"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent",
    CLEAROTRON_CLAUDE_PATH: CLAUDE_MOCK,
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    // 429 ONLY on the register-unit sweeps (they read prelim-register/unit.md). matter-frame + prelim-variants
    // run and succeed first, so this is a genuine MID-RUN rate-limit — the incident's shape.
    MOCK_CLAUDE_RATELIMIT: String(RESET_EPOCH_SEC),
    MOCK_CLAUDE_RATELIMIT_MATCH: "prelim-register/unit.md",
  })) pinEnv(process.env, k, v);

  try {
    const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
    const res = await pipeline({ ...JOB });

    // The run is POSTPONED, not failed — the headline behavior change.
    assert.equal(res.postponed, true, `expected postponed, got ${JSON.stringify(res)}`);
    assert.equal(res.ok, false, "a postpone is not a success");
    assert.equal(res.resetsAt, RESET_ISO, "the cap's reset time is surfaced (ISO) for the runner to wait on");
    assert.ok(String(res.fromStage).startsWith("register-unit"), `postponed at a register sweep, got ${res.fromStage}`);
    assert.ok(res.runDir && existsSync(res.runDir), "runDir returned and present (parked, not deleted)");

    // No terminal-failure artifacts: the postpone path must NOT write .failed nor deliver.
    assert.ok(!existsSync(join(res.runDir, ".failed")), "NO .failed sentinel on a postpone");
    assert.ok(!existsSync(join(res.runDir, ".delivered")), "NO .delivered on a postpone");
    assert.ok(existsSync(join(res.runDir, ".postponed")), ".postponed sentinel written (the resume source of truth)");
    const sentinel = JSON.parse(readFileSync(join(res.runDir, ".postponed"), "utf8"));
    assert.equal(sentinel.resetsAt, RESET_ISO, ".postponed carries the reset time");
    assert.equal(sentinel.kind, "rate-limit", "A4: the rate-limit sentinel says what it is (the recovery park says kind: recovery)");

    // status.json flipped to postponed (the dashboard state), and earlier stages are intact.
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    assert.equal(status.state, "postponed", "status.json state = postponed (not failed)");

    const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.event === "postponed"), "run.jsonl records the postpone");
    assert.ok(!events.some((e) => e.event === "failed"), "run.jsonl has NO failed event");
    // Earlier stages completed BEFORE the 429 — proves it's a mid-run postpone with work preserved (resume reuses it).
    const okStages = events.filter((e) => e.event === "stage" && e.ok).map((e) => e.stage);
    assert.ok(okStages.includes("matter-frame") && okStages.includes("prelim-variants"),
      `early stages completed before the 429 (got ${okStages.join(", ")})`);
    // The failure-notify one-shot must never run on a postpone (the incident fired it — and it too 429'd).
    assert.ok(!events.some((e) => e.event === "stage" && e.stage === "notify-fail-chat"), "notify-fail-chat NOT run on a postpone");

    // A park is where spend hides: the stages before the 429 burned tokens, and a park that is never
    // resumed is consumption nothing else would ever record. Both the run-level stamp and the
    // cross-run ledger row must land here — the ledger row rides `opts.__ctx` through postponeRun, a
    // thread thin enough that losing it would silently skip the row rather than fail anything.
    const rollup = events.filter((e) => e.event === "token-rollup").at(-1);
    assert.ok(rollup, "the postpone stamps a token-rollup event");
    assert.equal(rollup.phase, "postponed", "the rollup names the terminal that wrote it");
    const stamped = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).tokens;
    assert.ok(stamped?.total, "status.json carries the tokens a parked run already spent");
    const ledger = readFileSync(join(res.studioRoot ?? join(res.runDir, "..", ".."), ".consumption-ledger.jsonl"), "utf8")
      .trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(ledger.at(-1).phase, "postponed", "the park writes a cross-run consumption row");
    assert.ok(ledger.at(-1).tokens, "the consumption row carries the measured tokens");
  } finally {
    for (const k of ["MOCK_CLAUDE_RATELIMIT", "MOCK_CLAUDE_RATELIMIT_MATCH"]) delete process.env[k];
  }
});

test("postponedDueAt: resetsAt is an UPPER BOUND, not the authority; backs off when reset is unknown; fail-open otherwise", async () => {
  const { postponedDueAt } = await import("../runner.mjs");
  const BACKOFF = 20 * 60 * 1000;                          // 20 min
  const t0 = Date.parse("2026-06-22T18:00:00.000Z");
  const PROBE = { probeMs: 10 * 60 * 1000, probeCeilingMs: 40 * 60 * 1000 };

  // 1) — resetsAt present → the run wakes at the EARLIER of that reset and its next probe.
  //    This assertion used to read "resetsAt wins when present", and that is the defect: a cap lifted
  //    ahead of its stated reset left the run parked against a record that was no longer true, and only
  //    a hand-edit of two files freed it. The stated reset still bounds the wait from above — we never
  //    sleep longer than the provider said — but it no longer decides that we sleep at all.
  assert.equal(postponedDueAt({ resetsAt: RESET_ISO, postponedAt: "2026-06-22T18:00:00.000Z" }, BACKOFF, PROBE),
    t0 + PROBE.probeMs, "a far-off reset does not hold the run past its next probe");
  // A reset SOONER than the next probe is honoured exactly — never wait longer than the provider said.
  const soon = new Date(t0 + 60 * 1000).toISOString();
  assert.equal(postponedDueAt({ resetsAt: soon, postponedAt: "2026-06-22T18:00:00.000Z" }, BACKOFF, PROBE),
    Date.parse(soon), "a near reset still wins — the bound is an upper one");
  // The interval GROWS per refused probe, so a genuinely long cap costs a handful of rejected dispatches
  // rather than one every interval — and it is ceilinged, so it can never grow back into sleeping on the
  // record.
  assert.equal(postponedDueAt({ resetsAt: RESET_ISO, postponedAt: "2026-06-22T18:00:00.000Z", probeAttempt: 2 }, BACKOFF, PROBE),
    t0 + 4 * PROBE.probeMs, "each refused probe doubles the interval");
  assert.equal(postponedDueAt({ resetsAt: RESET_ISO, postponedAt: "2026-06-22T18:00:00.000Z", probeAttempt: 99 }, BACKOFF, PROBE),
    t0 + PROBE.probeCeilingMs, "and the growth is ceilinged");

  // 2) A RECOVERY park keeps its exact clock: it is OUR backoff, not an external party's deadline, so
  //    there is no third party who could lift it early and nothing that can go stale.
  const rec = new Date(t0 + 5 * 60 * 60 * 1000).toISOString();
  assert.equal(postponedDueAt({ recoveryResumesAt: rec, postponedAt: "2026-06-22T18:00:00.000Z" }, BACKOFF, PROBE),
    Date.parse(rec), "a recovery park is not probed — there is no external record to contradict");

  // 2) resetsAt absent (the hard-429 case) → postponedAt + backoff, NOT due-now (prevents the hot-loop).
  assert.equal(postponedDueAt({ postponedAt: "2026-06-22T18:00:00.000Z" }, BACKOFF), t0 + BACKOFF,
    "no reset timestamp → wait a backoff window from postponedAt");

  // 3) resetsAt null AND no postponedAt → 0 (due now; fail-open so a meta hiccup never strands a parked run).
  assert.equal(postponedDueAt({}, BACKOFF), 0, "no usable timing meta → due now (fail-open)");
  assert.equal(postponedDueAt(null, BACKOFF), 0, "missing meta → due now (fail-open)");

  // 4) an invalid resetsAt string must not poison the decision — fall through to the postponedAt backoff.
  assert.equal(postponedDueAt({ resetsAt: "not-a-date", postponedAt: "2026-06-22T18:00:00.000Z" }, BACKOFF),
    t0 + BACKOFF, "invalid resetsAt falls through to the postponedAt backoff");
});
