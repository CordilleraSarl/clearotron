// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real run-dir watcher and the real resume-door predicate
//
// — A RUN AN OPERATOR CANCELLED RESUMES ITSELF.
//
// MEASURED, the R6 round this issue was filed from, 2026-09-03. Cancelled by setting `status.json` to `state: cancelled` with
// a reason and renaming the queue marker `.postponed` -> `.cancelled`. Both writes confirmed on disk.
// The runner self-resumed it from the run dir on each of the next two worker starts, ran anthropic
// stages inside a codex run, and produced a confounded two-engine artifact.
//
// WHY THE EXISTING ARMS WERE ALL GREEN THROUGH IT. `scanDueRunDirOrphans` already skipped `.cancelled`
// and `.cancel` in the RUN DIR, and runner.self-resume.test.mjs planted exactly that member and passed.
// A cancel has THREE expressions — a run-dir marker, a terminal `status.json`, a retired queue marker —
// and the watcher read one. So every arm below plants ONE expression ALONE. An arm that plants all
// three at once passes on the broken code, which is the "asserts a class, tests one member" shape this
// tree has been bitten by repeatedly, and is the precise reason this defect shipped.
//
// AND THE INVERSION THAT MADE IT WORSE: retiring the queue marker takes its `.postponed.meta` out of
// queueOwnedCodenames, so cancelling in the queue was the act that HANDED the run to the run-dir
// watcher. The strongest stop an operator could write made the resurrection more likely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// Set the workspace root BEFORE driver.config.mjs loads (via the dynamic imports below), so
// config.workspaceRoot and config.queueDirs freeze to our temp tree and never see the real box.
const ROOT = mkdtempSync(join(tmpdir(), "prelim-2155-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const STUDIO = (agent) => join(ROOT, `workspace-${agent}`, "studio", "prelim-search");
const mkRun = (slug, run, agent = "clawdi") => {
  const d = join(STUDIO(agent), slug, run);
  mkdirSync(d, { recursive: true });
  return d;
};
const mkQueue = (agent = "clawdi") => {
  const q = join(STUDIO(agent), "queue");
  mkdirSync(q, { recursive: true });
  return q;
};

const past = new Date(Date.now() - 60_000).toISOString();
// A DUE rate-limit park with a complete resume payload — i.e. a run the watcher SHOULD pick up, so
// that anything skipped below is skipped for the reason under test and not for a malformed sentinel.
const duePark = (codename) => JSON.stringify({
  kind: "rate-limit", resetsAt: past, postponedAt: past, fromStage: "common-law-half:a",
  codename, job: { markName: "M", classes: [9] }, agent: "clawdi",
});
const statusFile = (runDir, state, extra = {}) =>
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ schema: 1, state, ...extra }, null, 2));

const { scanDueRunDirOrphans } = await import("../runner.mjs");
const { resumeStopRefusal } = await import("../pipeline.mjs");
const codenamesDue = () => scanDueRunDirOrphans().map((o) => o.codename).sort();

// ── THE NEGATIVE CONTROL, FIRST ───────────────────────────────────────────────────────────────────
// Everything below asserts a run is NOT resumed, and an arm set like that passes completely if the
// watcher simply stopped working. This is the arm that says it still does.

test("2155 CONTROL: a genuine rate-limit park with an elapsed window still resumes", () => {
  const d = mkRun("mark-control", "2026-09-03-control-one");
  writeFileSync(join(d, ".postponed"), duePark("control-one"));
  statusFile(d, "postponed");   // exactly what the park writer leaves — a LIVE state, not a terminal
  assert.ok(codenamesDue().includes("control-one"),
    "a crash/rate-limit park must still resume — this fix must not turn every park into a dead run");
});

// ── EXPRESSION 1: A TERMINAL status.json, ALONE ───────────────────────────────────────────────────
// Half of what the operator actually wrote. No run-dir marker anywhere: on the broken code this run
// is indistinguishable from the control above, and was resumed.

for (const state of ["cancelled"]) {
  test(`2155 a terminal status.json ALONE stops the resume — state: ${state}`, () => {
    const d = mkRun(`mark-status-${state}`, `2026-09-03-status-${state}`);
    writeFileSync(join(d, ".postponed"), duePark(`status-${state}`));
    statusFile(d, state, { reason: "stopped by the operator", failedStage: "parked" });
    assert.ok(!codenamesDue().includes(`status-${state}`),
      `status.json says ${state} and nothing else does — the watcher must read the run's own record`);
  });
}

test("2155 ONLY `cancelled` stops a resume — `failed` is the runner's own word and stays resumable", () => {
  // THE ARM THAT CAME FROM BEING WRONG. The first cut refused every TERMINAL_STATE, and CI refused
  // sixty-odd resume arms for it — rightly: `failed` is a terminal the RUNNER writes about itself, and
  // a failed run coming back is the recovery this whole path exists to perform. The runner's
  // REPARK_MAX breaker and its reclaim-exhausted path both write `failed` WITH a reason, so
  // "terminal + has a reason" cannot separate a machine's verdict from a person's. The state word can.
  //
  // `parked-for-human` is deliberately non-terminal (progress.mjs): a grace-exit park is a visible
  // pause a deploy restart is SUPPOSED to resume without ceremony.
  for (const state of ["running", "postponed", "parked-for-human", "failed"]) {
    const d = mkRun(`mark-live-${state}`, `2026-09-03-live-${state}`);
    writeFileSync(join(d, ".postponed"), duePark(`live-${state}`));
    statusFile(d, state);
    assert.ok(codenamesDue().includes(`live-${state}`), `state ${state} is not terminal and must still resume`);
  }
});

// ── EXPRESSION 2: A RETIRED QUEUE MARKER, ALONE ───────────────────────────────────────────────────
// The other half. The run dir is untouched and its status.json is absent, so the ONLY thing saying
// this run is over sits in the queue — which is the surface the watcher never consulted.

test("2155 a terminal QUEUE marker ALONE stops the resume", () => {
  const q = mkQueue();
  const d = mkRun("mark-queue", "2026-09-03-queue-one");
  writeFileSync(join(d, ".postponed"), duePark("queue-one"));
  writeFileSync(join(q, "job-queue-one.cancelled.meta"), JSON.stringify({ codename: "queue-one", runDir: d }));
  assert.ok(!codenamesDue().includes("queue-one"),
    "the operator retired the queue marker — the run-dir watcher must not undo that decision");
});

test("2155 every terminal queue suffix counts, not just .cancelled", async () => {
  // The queue's terminal vocabulary is `done`, `failed`, `cancelled`, `duplicate` and it is OWNED by
  // queue-markers.mjs. Asking the module rather than retyping the list is the point: a fifth terminal
  // added there must not silently become a resumable state here.
  const { TERMINAL_QUEUE_SUFFIXES } = await import("../queue-markers.mjs");
  const q = mkQueue();
  for (const sfx of TERMINAL_QUEUE_SUFFIXES) {
    const d = mkRun(`mark-q-${sfx}`, `2026-09-03-q-${sfx}`);
    writeFileSync(join(d, ".postponed"), duePark(`q-${sfx}`));
    writeFileSync(join(q, `job-q-${sfx}.${sfx}.meta`), JSON.stringify({ codename: `q-${sfx}` }));
    assert.ok(!codenamesDue().includes(`q-${sfx}`), `queue suffix .${sfx} is terminal and must stop the resume`);
  }
});

test("2155 a LIVE queue marker is not a stop — the ownership check keeps its own meaning", () => {
  // queueOwnedCodenames and queueTerminalCodenames answer different questions ("another lane will
  // drive this" vs "nobody will"), and collapsing them would be a lie that happens to behave. A live
  // `.postponed.meta` must still read as OWNED — skipped, but for the double-fire reason.
  const q = mkQueue();
  const d = mkRun("mark-owned", "2026-09-03-owned-one");
  writeFileSync(join(d, ".postponed"), duePark("owned-one"));
  writeFileSync(join(q, "job-owned-one.postponed.meta"), JSON.stringify({ codename: "owned-one" }));
  assert.ok(!codenamesDue().includes("owned-one"), "the queue owns this resume — the watcher must not double-fire it");
});

// ── EXPRESSION 3: THE RUN-DIR MARKER, ALONE — THE REGRESSION FLOOR ────────────────────────────────
// This one already passed before the fix. It is here so that it keeps passing.

test("2155 REGRESSION FLOOR: a run-dir .cancel ALONE still stops the resume", () => {
  const d = mkRun("mark-marker", "2026-09-03-marker-one");
  writeFileSync(join(d, ".postponed"), duePark("marker-one"));
  writeFileSync(join(d, ".cancel"), JSON.stringify({ ts: past, via: "cli/cancel", by: "ops:someone" }));
  assert.ok(!codenamesDue().includes("marker-one"), "the surface that already worked must keep working");
});

// ── THE PLANT: IT STAYS SETTLED ACROSS A WORKER RESTART ───────────────────────────────────────────
//
// The defect was not one resurrection, it was TWO: the first resume cleared the run dir's terminal
// markers and reset its record, so the second pass arrived at a run that no longer said it was over.
// Scanning once proves the first refusal. Scanning AGAIN, and checking the evidence is still on disk
// to refuse with, is the arm that would have caught the clearing.

test("2155 THE PLANT: a settled run stays settled across repeated worker starts, evidence intact", () => {
  const q = mkQueue();
  const d = mkRun("mark-plant", "2026-09-03-plant-one");
  writeFileSync(join(d, ".postponed"), duePark("plant-one"));
  statusFile(d, "cancelled", { reason: "stopped by the operator: codex cap reached", failedStage: "parked" });
  writeFileSync(join(q, "job-plant-one.cancelled.meta"), JSON.stringify({ codename: "plant-one", runDir: d }));

  for (let start = 1; start <= 3; start += 1) {
    assert.ok(!codenamesDue().includes("plant-one"), `worker start ${start} resurrected a cancelled run`);
    // THE HALF THAT WOULD HAVE CAUGHT IT. A refusal that consumes the reason it refused with is a
    // refusal that works exactly once — which is the whole difference between one bad resume and the
    // two that were measured.
    const st = JSON.parse(readFileSync(join(d, "status.json"), "utf8"));
    assert.equal(st.state, "cancelled", `worker start ${start} reopened the terminal state`);
    assert.equal(st.reason, "stopped by the operator: codex cap reached",
      `worker start ${start} blanked the operator's reason — the record must survive being refused with`);
    assert.ok(existsSync(join(q, "job-plant-one.cancelled.meta")), `worker start ${start} cleared the queue terminal`);
  }
});

// ── THE RESUME DOOR ITSELF ────────────────────────────────────────────────────────────────────────
// The watcher is one of three paths into a resume (the queue lane and a hand-typed `--resume` are the
// others), so the door the pipeline opens has to refuse independently rather than trusting its callers.

test("2155 the resume door refuses a .cancel REQUEST and a terminal SETTLEMENT alike", () => {
  const req = mkRun("mark-door", "2026-09-03-door-req");
  writeFileSync(join(req, ".cancel"), JSON.stringify({ ts: past, via: "mcp/stop_run", by: "someone@example.test" }));
  assert.match(resumeStopRefusal(req), /operator asked it to stop/,
    "stop_run writes ONLY .cancel for a run that was still executing — the door must refuse on it");

  const c = mkRun("mark-door-cancelled", "2026-09-03-door-cancelled");
  statusFile(c, "cancelled");
  assert.match(resumeStopRefusal(c), /cancelled/, "a run a person cancelled must not be re-driven");
  // AND THE OTHER TERMINALS MUST NOT REFUSE HERE. `failed` is resumable by design; `delivered` is
  // refused EARLIER, by the branch that names which of three delivery markers it found — repeating it
  // here would be unreachable code carrying a worse message than the one that actually fires.
  for (const state of ["failed", "delivered"]) {
    const d = mkRun(`mark-door-${state}`, `2026-09-03-door-${state}`);
    statusFile(d, state);
    assert.equal(resumeStopRefusal(d), null, `${state} must not be refused by THIS guard`);
  }
});

test("2155 the door lets a resumable run through — including one whose record cannot be read", () => {
  const live = mkRun("mark-door-live", "2026-09-03-door-live");
  statusFile(live, "postponed");
  assert.equal(resumeStopRefusal(live), null, "a rate-limit park is resumable and must stay resumable");

  // ABSENCE IS NOT A TERMINAL, and the polarity is chosen rather than inherited. This predicate answers
  // "has it PROVABLY ended" — an unreadable byte must not strand a live run for ever, and the run-dir
  // markers are the other half of the question the watcher asks alongside it.
  const bare = mkRun("mark-door-bare", "2026-09-03-door-bare");
  assert.equal(resumeStopRefusal(bare), null, "no status.json at all is not evidence that a run ended");
  writeFileSync(join(bare, "status.json"), "{ this is not json");
  assert.equal(resumeStopRefusal(bare), null, "a corrupt record is a missing answer, never a terminal one");
  assert.equal(resumeStopRefusal(null), null, "a caller with no run dir gets null, never a throw");
});

// ── THE ORDER, WHICH IS THE ACTUAL FIX ────────────────────────────────────────────────────────────

test("2155 WIRING: the door refuses BEFORE it clears any marker", async () => {
  // Stated as what it is: an ORDER assertion over the source, because the two behaviours it separates
  // are a throw and three rmSync calls in one function, and no return value distinguishes them. The
  // order is the entire fix — the refusal is worth nothing if it runs after the evidence is gone.
  const { readFileSync: rd } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");
  const src = rd(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  const refusal = src.indexOf("const stopped = resumeStopRefusal(run.runDir);");
  const clearing = src.indexOf('rmSync(join(run.runDir, ".failed"))');
  assert.ok(refusal > 0, "the resume door stopped consulting resumeStopRefusal");
  assert.ok(clearing > 0, "the marker clearing moved — re-check this arm rather than deleting it");
  assert.ok(refusal < clearing,
    "the stop refusal must precede the clearing: refusing after the evidence is erased is how the SECOND resume happened");
});

// ── THE OPERATOR'S WAY IN ─────────────────────────────────────────────────────────────────────────

test("2155 an operator can stop ONE run from the box, and it is a real verb", async () => {
  // Item 3 of the issue: there was no documented way to stop a run without stopping the worker.
  // `.cancel` had exactly one caller — the MCP's stop_run — so a person at a shell could not write the
  // one surface every resume path honours, and reached for the two that nothing read.
  const { VERBS, SUMMARY } = await import("../../bin/clearotron.mjs");
  assert.equal(VERBS.cancel?.[0], "bin/cancel.mjs", "the cancel verb left the table");
  assert.ok(SUMMARY.cancel, "a verb with no summary is a verb nobody finds");

  const src = readFileSync(join(dirnameOf(import.meta.url), "..", "..", "bin", "cancel.mjs"), "utf8");
  assert.match(src, /requestCancel\(/,
    "the verb must write the marker through requestCancel — the surface the queue lane, the watcher, "
    + "the gateway and both pipelines already honour");
  assert.match(src, /by: `ops:\$\{userInfo\(\)\.username\}`/,
    "the marker travels into the archived matter record: a verb a human typed must not record UNATTRIBUTED");
});

// ── ITEM 4: A RUN THAT SPANS TWO ENGINES SAYS SO ─────────────────────────────────────────────────
//
// The issue asks for a resume across an engine change to be "refused, or at minimum stated". STATED is
// the reading taken: a refusal is a new way to withhold a client's report, which is the owner's call.
//
// WHY IT WAS NOT ALREADY STATED, and this is measured off the R6 artifact rather than reasoned: the
// byEngine rollup fires at TERMINALS only. it resumed twice and reached no terminal (it was
// stopped by moving its directory), so its status.json still reports openai-agent/openai/code summing
// exactly to `total` — a clean codex run — with none of the anthropic work the two resumes did. The
// issue predicted byEngine "will show both". It does not. Nothing re-stamped it.

test("2155 item 4: a resume re-states the engines the run has used, so a two-engine run is visible", async () => {
  const { stampTokenRollup } = await import("../tokens.mjs");
  const d = mkRun("mark-engine", "2026-09-03-engine-one");
  mkdirSync(join(d, "_driver"), { recursive: true });
  // The shape rollupTokens reads: stage-attempt records carrying a model, a usage block and an engine.
  // Two engines on ONE run — exactly the artifact the issue calls confounded.
  writeFileSync(join(d, "_driver", "common-law-half:a.jsonl"),
    JSON.stringify({ model: "gpt-5", engine: "openai-agent", usage: { input: 10, output: 2 } }) + "\n"
    + JSON.stringify({ model: "claude-opus-5", engine: "anthropic", usage: { input: 30, output: 4 } }) + "\n");
  statusFile(d, "running");

  stampTokenRollup(d, "resumed");

  const st = JSON.parse(readFileSync(join(d, "status.json"), "utf8"));
  const engines = Object.keys(st.tokens?.byEngine ?? {}).sort();
  assert.deepEqual(engines, ["anthropic", "openai-agent"],
    "a run that used two engines must SAY both on the record a reader opens — this is the whole of item 4");
  assert.equal(st.tokens.total.input, 40, "byEngine must still sum to total, or the split is decoration");
});

test("2155 item 4 WIRING: the resume path re-stamps, and does so AFTER the stop refusal", async () => {
  // Order matters here too, for a different reason than arm 13: stamping a run we are about to refuse
  // would write to the record of a run nobody is resuming.
  const { readFileSync: rd } = await import("node:fs");
  const src = rd(join(dirnameOf(import.meta.url), "..", "pipeline.mjs"), "utf8");
  const refusal = src.indexOf("const stopped = resumeStopRefusal(run.runDir);");
  const stamp = src.indexOf('stampTokenRollup(run.runDir, "resumed")');
  assert.ok(stamp > 0, "the resume stopped re-stating its engines — a two-engine run goes invisible again");
  assert.ok(refusal < stamp, "a run being refused must not have its record re-stamped");
});

function dirnameOf(url) {
  return new URL(".", url).pathname;
}
