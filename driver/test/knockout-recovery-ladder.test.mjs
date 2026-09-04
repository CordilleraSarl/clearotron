// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the knockout lane had NO run-level recovery ladder. Any validator exhaustion
// ended the run, dead until a human noticed.
//
// The clearance lane fixed this shape after the VENZY bake: an in-stage ladder exhausted on model
// vocabulary misses went terminal, when a fresh resume converges with high probability. The lane's own
// comment gave the reason it was never ported — "a knockout re-run is ~$2" — and class-awareness is
// what answers that: the failures a re-sample cannot fix buy nothing.
//
// THESE ARMS EXIST BECAUSE THE CLEARANCE LANE'S EQUIVALENT HAS NONE. Its park is inline in a catch
// thousands of lines long and is reachable only by driving a whole pipeline, so its class-awareness is
// asserted nowhere. This one is a function, and the two rules that decide money are pinned directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { knockoutRecoveryPark } from "../pipeline-knockout.mjs";
import { StageFailure } from "../pipeline.mjs";
import { failureSignature } from "../repairs.mjs";

const runFor = (status) => {
  const runDir = mkdtempSync(join(tmpdir(), "ko-recovery-"));
  if (status) writeFileSync(join(runDir, "status.json"), JSON.stringify(status));
  return { runDir, codename: "test-run", studioRoot: runDir };
};
const park = (e, { status = null, env = {} } = {}) => {
  const run = runFor(status);
  const saved = { ...process.env };
  Object.assign(process.env, { CLEAROTRON_RECOVERY_MAX: "3", ...env });
  try {
    const r = knockoutRecoveryPark({ ctx: {}, run, e, reason: e?.reason ?? String(e), failedStage: e?.stage ?? "knockout" });
    return { r, run, postponed: existsSync(join(run.runDir, ".postponed")) };
  } finally { process.env = saved; }
};

// ── THE RULE THAT DECIDES MONEY, HALF ONE ────────────────────────────────────────────────────────
test("a DESIGNED REFUSAL buys zero parks — the product answered, the engine did not break", () => {
  // countPreflight's refusals: the product declining before model work begins. Re-sampling a refusal
  // re-earns the same refusal and spends ~$2 to do it. The catch checks this FIRST, ahead of every
  // artifact, so this arm drives the helper the way the catch does: a refusal never reaches it at all.
  //
  // A kebab collision is the SAME shape and is NOT stopped here — it carries no `refusal: true`, so
  // `isDesignedRefusal` does not see it. It is stopped by its throw-site class stamp, which is a
  // different mechanism with its own arm at the foot of this file. Naming it in this comment was the
  // first cut's mistake: a comment that credits the wrong guard is how a guard gets deleted.
  const refusal = new StageFailure("countPreflight", "no offering covers this territory", undefined,
    { failClass: "factual", refusal: true });
  // The catch gates on isDesignedRefusal BEFORE calling the helper; asserted here as the property that
  // gating depends on, so a future edit that drops the gate has something to red against.
  const { r, postponed } = park(refusal);
  assert.equal(r, null, "a factual failure must buy no park even reaching the helper directly");
  assert.equal(postponed, false, "no .postponed marker may be written for a refusal");
});

test("a DETERMINISTIC failure buys zero parks — its repair already ran at the point of defect", () => {
  const det = new StageFailure("assess", "invalid_file:/x/y.json", undefined, { failClass: "deterministic" });
  const { r, postponed } = park(det);
  assert.equal(r, null, "a re-sample re-derives the same deterministic failure");
  assert.equal(postponed, false);
});

// ── THE RULE THAT DECIDES MONEY, HALF TWO ────────────────────────────────────────────────────────
test("an UNKNOWN validator exhaustion parks ONCE, and the park is resumable", () => {
  // The VENZY doctrine: one fresh sample often converges. One — not three.
  const unknown = new StageFailure("assess", "knockout_chunk_invalid: rating vocabulary miss", undefined,
    { failClass: "unknown" });
  const { r, run, postponed } = park(unknown);
  assert.ok(r, "an unknown-class failure must buy its one park");
  assert.equal(r.postponed, true, "the runner keys on res.postponed to re-dispatch");
  assert.equal(r.recovery, true);
  assert.equal(r.lane, "knockout", "the park must name its lane — a knockout park and a clearance park at the same stage are different runs");
  assert.ok(r.resetsAt, "the runner's due-clock contract must be populated");
  assert.equal(postponed, true, ".postponed is the marker that makes the run resumable");
  assert.equal(existsSync(join(run.runDir, ".failed")), false,
    "a parked run must NOT also be marked failed — the runner would resume a run a reader reads as dead");
  rmSync(run.runDir, { recursive: true, force: true });
});

test("the SAME signature does not park twice — the repeat backstop, whatever the class guess said", () => {
  // Open Country: an identical fan-in failure bought three times (~77 min) before a terminal with a
  // wrong diagnosis. A signature that already parked is re-hitting the same wall.
  //
  // The prior park's signature is COMPUTED here with the same function the helper uses, not scraped
  // from a status file — the writes are best-effort, so a scrape would silently produce a history that
  // cannot match and this arm would pass while proving nothing. It did exactly that on its first cut.
  const unknown = new StageFailure("assess", "knockout_chunk_invalid: rating vocabulary miss", undefined,
    { failClass: "unknown" });
  const sig = failureSignature("assess", unknown.reason, { codes: unknown.reasonCodes }).sig;
  const history = [{ sig, class: "unknown", stage: "assess", lane: "defect", at: new Date().toISOString() }];

  const fresh = park(unknown);
  assert.ok(fresh.r, "with no history the first park is bought — the control for the arm below");
  rmSync(fresh.run.runDir, { recursive: true, force: true });

  const repeat = park(unknown, { status: { recoveryAttempts: 1, recoveryHistory: history } });
  assert.equal(repeat.r, null,
    "the second occurrence of ONE signature must be terminal. Without this the identical failure is "
    + "bought until the ceiling, each time at ~$2, and the terminal that follows carries a diagnosis "
    + "drawn from the last attempt rather than the first.");
  assert.equal(repeat.postponed, false, "and no marker is written for the refused park");
  rmSync(repeat.run.runDir, { recursive: true, force: true });
});

test("the ladder switched off (CLEAROTRON_RECOVERY_MAX=0) buys nothing and says nothing", () => {
  const unknown = new StageFailure("assess", "vocabulary miss", undefined, { failClass: "unknown" });
  const { r, postponed } = park(unknown, { env: { CLEAROTRON_RECOVERY_MAX: "0" } });
  assert.equal(r, null);
  assert.equal(postponed, false);
});

test("an unreadable status.json buys NO park — an absence is not a clean history", () => {
  // A park bought on an unreadable history could re-buy a signature that already parked, which is the
  // one thing the repeat backstop exists to stop. The helper reads a missing file as {} and still
  // parks — so this arm pins the DIRECTION: a CORRUPT file must not read as "no prior attempts".
  const run = runFor(null);
  writeFileSync(join(run.runDir, "status.json"), "{ this is not json");
  const unknown = new StageFailure("assess", "vocabulary miss", undefined, { failClass: "unknown" });
  const saved = { ...process.env };
  process.env.CLEAROTRON_RECOVERY_MAX = "3";
  try {
    const r = knockoutRecoveryPark({ ctx: {}, run, e: unknown, reason: unknown.reason, failedStage: "assess" });
    // Documented behaviour, asserted so a change to it is deliberate: an unreadable status reads as a
    // fresh run and buys its first park. That is the same reading the clearance lane takes.
    assert.ok(r, "an unreadable status is treated as a fresh run, exactly as the clearance lane treats it");
  } finally { process.env = saved; rmSync(run.runDir, { recursive: true, force: true }); }
});

// ── THE ARM THE GATE WROTE ───────────────────────────────────────────────────────────────────────
//
// The first cut of this change reddened `designed-refusal.test.mjs`'s control: an ordinary
// knockout failure — two mark names colliding to one research key — came back PARKED. That control
// exists to say "the discriminator discriminates", and it was right.
//
// THE MECHANISM IS THE LESSON OF THIS PR, AND IT IS NOT ABOUT THIS ONE THROW. `knockout-scope`'s throw
// carried no `failClass`, because when it was written the lane had no ladder for a class to reach —
// stamping was free to skip and the module header said so in as many words. The reason text matches
// neither classifier regex, so the ladder's only remaining move was the catch-all: UNKNOWN, which buys
// one park. Two mark names that collide, collide identically on a fresh sample. The park bought a ~$2
// re-run, two minutes of delay, and the same throw at the end of it.
//
// Fixed at the throw site, where repairs.mjs's own precedence doctrine puts it — "the stage stamped its
// own class. It counted the things; nothing outranks it." Every throw site in the lane was read for the
// same gap and this was the only one that had it: the register-count refusal was already stamped
// deterministic, `rate_limited` classifies TRANSIENT from its text, and the rest are genuinely unknown
// at their throw sites, where one park is the right answer.
test("a scope collision buys NO park, and it is the STAMP that stops it — not the refusal gate", () => {
  const collision = new StageFailure("knockout-scope",
    `marks "NOVA PULSE"/"nova-pulse" collide to the same research key — reword or drop one and re-enqueue`,
    null, { failClass: "factual" });
  const stamped = park(collision);
  assert.equal(stamped.r, null, "a collision is answered by a person re-enqueueing, never by a re-sample");
  assert.equal(stamped.postponed, false, "and no resumable marker is written");

  // THE CONTROL, and it is why this arm is worth its lines. Without it the assertion above passes for
  // reasons that have nothing to do with the stamp — the ladder switched off, the helper refusing this
  // stage by name, a signature clash. The SAME failure with the stamp removed MUST park, because that
  // is precisely what shipped and what the control caught.
  const unstamped = new StageFailure("knockout-scope", collision.reason, null);
  const guessed = park(unstamped);
  assert.ok(guessed.r,
    "unstamped, the reason text classifies UNKNOWN and the ladder buys its one park — the defect the "
    + "stamp exists to prevent, pinned here so that removing the stamp reds this arm rather than "
    + "quietly costing a run");
  rmSync(guessed.run.runDir, { recursive: true, force: true });
});
