// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives both products' failure endings in a temporary studio
//
// THE RECOVERY LADDER, ON BOTH PRODUCTS.
//
// A Knockout once had no run-level recovery ladder: any validator exhaustion ended the run, dead until a human
// noticed. It then gained its own copy of the clearance's, and the copy drifted. Both products now end a failed run
// through one function, run-failed.mjs's `endTheFailedRun`, and differ only in the product data they hand it.
//
// So every arm below runs on both products. The clearance's ladder was reachable only by driving a whole pipeline, and
// these are its first focused arms; the Knockout's are the ones it already had. The rules that decide money: the
// failures a re-sample cannot fix buy nothing, an unknown one buys exactly one park, and a signature that already
// parked ends the run.
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "recovery-ladder-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));

import { test } from "node:test";
import assert from "node:assert/strict";

const { endTheFailedRun, CLEARANCE_ENDING } = await import("../run-failed.mjs");
const { KNOCKOUT_ENDING } = await import("../pipeline-knockout.mjs");
const { StageFailure } = await import("../run-outcome.mjs");
const { failureSignature, REFUSAL_TERMINAL_KIND } = await import("../repairs.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");

const PRODUCTS = [["clearance", CLEARANCE_ENDING], ["Knockout", KNOCKOUT_ENDING]];
const sentinel = (dir, name, obj) => writeFileSync(join(dir, name), JSON.stringify({ ts: new Date().toISOString(), ...obj }));
// The clearance hands in its meaning-gate audit and its taint renames; neither has anything to do in these arms.
const HELPERS = { clearance: { sentinel, recordConnotationAudit: () => {}, undoTaintRenames: () => {} }, Knockout: { sentinel } };

let n = 0;
const runFor = (status) => {
  const codename = `ladder-${++n}`;
  const runDir = join(ROOT, "runs", codename);
  mkdirSync(driverDir(runDir), { recursive: true });
  if (status !== null) writeFileSync(join(runDir, "status.json"), typeof status === "string" ? status : JSON.stringify(status ?? {}));
  return { runDir, codename, studioRoot: runDir, slug: "lanternwick", date: "2026-11-10" };
};
const JOB = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], ref: "T-1", forwarder: "jordan", msgId: "<ladder@x>" };

/** One failure handed to one product's ending: what it returned, and whether the run was left parked or failed. */
async function end(name, product, e, { status = undefined, env = {} } = {}) {
  const run = runFor(status);
  const saved = { ...process.env };
  Object.assign(process.env, { CLEAROTRON_RECOVERY_MAX: "3", ...env });
  try {
    const ctx = { run, job: JOB, agent: "intake-agent", paths: { runDir: run.runDir } };
    const r = await endTheFailedRun({ P: ctx.paths, agent: "intake-agent", ctx, e, job: JOB, run, product }, HELPERS[name]);
    return { r, run, parked: existsSync(join(run.runDir, ".postponed")), failed: existsSync(join(run.runDir, ".failed")) };
  } finally { process.env = saved; }
}
const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

for (const [name, product] of PRODUCTS) {
  // ── THE RULE THAT DECIDES MONEY, HALF ONE ──────────────────────────────────────────────────────────────────────
  test(`${name}: a DESIGNED REFUSAL buys zero parks and no classification — the product answered, the engine did not break`, async () => {
    // A preflight declining an order before any spend. Re-sampling a refusal re-earns the same refusal. The ending asks
    // the refusal question first, so a refusal reaches no recovery path at all: not the ladder, not its journal row.
    //
    // A kebab collision is the SAME shape and is NOT stopped by this — it carries no `refusal: true`. It is stopped by
    // its throw-site class stamp, a different mechanism with its own arm at the foot of this file.
    const refusal = new StageFailure("countPreflight", "no offering covers this territory", undefined,
      { failClass: "factual", refusal: true });
    const { r, run, parked, failed } = await end(name, product, refusal);
    assert.equal(r.postponed, undefined, "a refusal must buy no park");
    assert.equal(parked, false, "no .postponed marker may be written for a refusal");
    assert.equal(failed, true, "it ends the run");
    assert.equal(r.terminalKind, REFUSAL_TERMINAL_KIND, "with its own kind, never the ladder's");
    assert.equal(journal(run.runDir).some((row) => row.event === "recovery-classified"), false,
      "the ladder was never consulted, so it records nothing");
  });

  test(`${name}: a DETERMINISTIC failure buys zero parks — its repair already ran at the point of defect`, async () => {
    const det = new StageFailure("assess", "invalid_file:/x/y.json", undefined, { failClass: "deterministic" });
    const { r, parked } = await end(name, product, det);
    assert.equal(r.postponed, undefined, "a re-sample re-derives the same deterministic failure");
    assert.equal(parked, false);
    assert.equal(r.terminalKind, "deterministic");
  });

  // ── THE RULE THAT DECIDES MONEY, HALF TWO ──────────────────────────────────────────────────────────────────────
  test(`${name}: an UNKNOWN validator exhaustion parks ONCE, and the park carries what resumes it`, async () => {
    // The VENZY doctrine: one fresh sample often converges. One — not three.
    const unknown = new StageFailure("assess", "knockout_chunk_invalid: rating vocabulary miss", undefined,
      { failClass: "unknown" });
    const { r, run, parked, failed } = await end(name, product, unknown);
    assert.equal(r.postponed, true, "the runner keys on res.postponed to re-dispatch");
    assert.equal(r.recovery, true);
    assert.equal(r.attempt, 1);
    assert.ok(r.resetsAt, "the runner's due-clock contract must be populated");
    assert.equal(parked, true, ".postponed is the marker that makes the run resumable");
    assert.equal(failed, false, "a parked run must NOT also be marked failed — the runner would resume a run a reader reads as dead");
    const marker = JSON.parse(readFileSync(join(run.runDir, ".postponed"), "utf8"));
    assert.equal(marker.kind, "recovery");
    assert.equal(marker.lane, "defect", "the marker names the recovery lane the park was charged to");
    assert.equal(marker.attempt, 1);
    assert.equal(marker.class, "unknown");
    assert.ok(marker.job && marker.agent && marker.codename, "the run-folder watcher resumes a marker by these three");
    const status = JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8"));
    assert.equal(status.state, "recovering");
    assert.equal(status.recoveryAttempts, 1);
    const [row] = status.recoveryHistory;
    assert.ok(Date.parse(row.ts), "the history row is stamped `ts`, the field the repair digest reads by");
    assert.equal(row.sig, failureSignature("assess", unknown.reason).sig);
    assert.equal(journal(run.runDir).filter((x) => x.event === "auto-recovery-parked").length, 1);
  });

  test(`${name}: the SAME signature does not park twice — the repeat backstop, whatever the class guess said`, async () => {
    // Open Country: an identical fan-in failure bought three times (~77 min) before a terminal with a wrong diagnosis.
    //
    // The prior park's signature is COMPUTED here with the same function the ending uses, not scraped from a status
    // file — a scrape could silently produce a history that cannot match, and this arm would pass proving nothing.
    const unknown = new StageFailure("assess", "knockout_chunk_invalid: rating vocabulary miss", undefined,
      { failClass: "unknown" });
    const sig = failureSignature("assess", unknown.reason, { codes: unknown.reasonCodes }).sig;
    const history = [{ sig, class: "unknown", stage: "assess", lane: "defect", ts: new Date().toISOString() }];

    const fresh = await end(name, product, unknown);
    assert.equal(fresh.r.postponed, true, "with no history the first park is bought — the control for the arm below");

    const repeat = await end(name, product, unknown, { status: { recoveryAttempts: 1, recoveryHistory: history } });
    assert.equal(repeat.r.postponed, undefined,
      "the second occurrence of ONE signature must end the run. Without this the identical failure is bought until "
      + "the ceiling, and the terminal that follows carries a diagnosis drawn from the last attempt, not the first.");
    assert.equal(repeat.parked, false, "and no marker is written for the refused park");
    assert.equal(repeat.r.terminalKind, "repeat-signature");
  });

  test(`${name}: a credential or configuration cause buys no park — no wait can supply a setting`, async () => {
    const config = new StageFailure("assess", "missing register credential SIGNA_API_KEY", undefined);
    const { r, parked } = await end(name, product, config);
    assert.equal(parked, false);
    assert.equal(r.terminalKind, "non-recoverable");
  });

  test(`${name}: the ladder switched off (CLEAROTRON_RECOVERY_MAX=0) buys nothing`, async () => {
    const unknown = new StageFailure("assess", "vocabulary miss", undefined, { failClass: "unknown" });
    const { r, parked } = await end(name, product, unknown, { env: { CLEAROTRON_RECOVERY_MAX: "0" } });
    assert.equal(r.postponed, undefined);
    assert.equal(parked, false);
  });

  test(`${name}: an unreadable status.json reads as a fresh run, and buys its first park`, async () => {
    // Documented behaviour, asserted so a change to it is deliberate: the ending reads an unreadable status as no
    // prior attempts. The repeat backstop then has no history to match, so this is the one park it cannot refuse.
    const unknown = new StageFailure("assess", "vocabulary miss", undefined, { failClass: "unknown" });
    const { r } = await end(name, product, unknown, { status: "{ this is not json" });
    assert.equal(r.postponed, true);
  });

  test(`${name}: a cap names its wait in the park's history, so the notice can say how long the run waited`, async () => {
    const cap = new StageFailure("assess", "provider usage limit reached for this plan", undefined);
    const { r, run } = await end(name, product, cap);
    assert.equal(r.postponed, true);
    const [row] = JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8")).recoveryHistory;
    assert.equal(row.capPark, true);
    assert.ok(row.recoveryWaitMin > 0);
  });

  // ── THE ARM THE GATE WROTE ─────────────────────────────────────────────────────────────────────────────────────
  //
  // An ordinary Knockout failure, two mark names colliding to one research key, once came back PARKED: its throw
  // carried no `failClass`, the reason text matched neither classifier pattern, and the catch-all UNKNOWN buys one
  // park. Two names that collide collide identically on a fresh sample. Fixed at the throw site, where the precedence
  // doctrine in repairs.mjs puts it: "the stage stamped its own class. It counted the things; nothing outranks it."
  test(`${name}: a scope collision buys NO park, and it is the STAMP that stops it — not the refusal gate`, async () => {
    const collision = new StageFailure("knockout-scope",
      `marks "NOVA PULSE"/"nova-pulse" collide to the same research key — reword or drop one and re-enqueue`,
      null, { failClass: "factual" });
    const stamped = await end(name, product, collision);
    assert.equal(stamped.r.postponed, undefined, "a collision is answered by a person re-enqueueing, never by a re-sample");
    assert.equal(stamped.parked, false, "and no resumable marker is written");

    // THE CONTROL. Without it the assertion above passes for reasons that have nothing to do with the stamp: the
    // ladder switched off, a signature clash. The SAME failure with the stamp removed MUST park.
    const unstamped = new StageFailure("knockout-scope", collision.reason, null);
    const guessed = await end(name, product, unstamped);
    assert.equal(guessed.r.postponed, true,
      "unstamped, the reason text classifies UNKNOWN and the ladder buys its one park — the defect the stamp exists "
      + "to prevent, pinned here so that removing the stamp reds this arm rather than quietly costing a run");
  });
}

test("the two products differ only in what they hand the ending: the stage a nameless failure is named at, and the stop's", async () => {
  const nameless = new Error("something broke with no stage on it");
  const clearance = await end("clearance", CLEARANCE_ENDING, nameless, { env: { CLEAROTRON_RECOVERY_MAX: "0" } });
  const knockout = await end("Knockout", KNOCKOUT_ENDING, nameless, { env: { CLEAROTRON_RECOVERY_MAX: "0" } });
  assert.equal(clearance.r.failedStage, "pipeline");
  assert.equal(knockout.r.failedStage, "knockout", "the stage a Knockout's notice names when the error names none");
  assert.equal(CLEARANCE_ENDING.stopStage("assess"), "assess");
  assert.equal(KNOCKOUT_ENDING.stopStage("assess"), "assess (knockout)", "a Knockout's stop reason names its product");
});

test.after(() => rmSync(ROOT, { recursive: true, force: true }));
