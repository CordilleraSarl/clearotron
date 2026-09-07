// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DRAW IS WORK ON THIS BOX, AND THE DEPLOY GUARD HAS TO BE ABLE TO SEE IT.
//
// `pipeline()` takes a run slot, so a clearance is visible to `deployRefusal` and the hourly deploy defers
// over it. An `--experiment` draw is a direct invocation and took nothing: not queued, not claimed, no
// slot. So the guard saw an idle box and a tick could fast-forward the checkout, reinstall and restart
// the units under a running experiment.
//
// The cost was not the blast radius — a draw runs from its own pinned checkout and does not use those
// units. It was that the ONLY protection was somebody stopping the deploy timer by hand, which made that
// hold load-bearing without anyone having decided it should be.
//
// IT TAKES ITS OWN LOCK, NOT A RUN SLOT. A run slot is admission-controlled against `maxConcurrentRuns`,
// so acquiring one would make a draw wait behind clearances and clearances wait behind draws — changing
// what a draw IS in order to fix what a guard can see. `draw` is a separate prefix in the same directory:
// the deploy guard counts it, and nothing else does.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { liveRunHolds, deployRefusal } from "../deploy-live-run-guard.mjs";
import { acquireSlot, releaseSlot, freeSlots } from "../slot-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const lockDir = () => mkdtempSync(join(tmpdir(), "draw-lock-"));

test("A LIVE DRAW REFUSES A DEPLOY, exactly as a live clearance does", () => {
  const dir = lockDir();
  // `process.pid` is alive by construction — the guard tests liveness, so a made-up pid would prove
  // nothing about whether it counts the lock.
  writeFileSync(join(dir, "draw-1.lock"), `${process.pid}:draw`);
  const holds = liveRunHolds({ queueDirs: [], lockDir: dir });
  assert.equal(holds.slots.length, 1, "the draw lock must be seen by the enumeration");
  const v = deployRefusal(holds);
  assert.equal(v.refuse, true, "a box running a draw is a busy box");
  assert.match(v.reason, /run slot\(s\) held by a live pid/);
  rmSync(dir, { recursive: true, force: true });
});

test("…and a draw lock whose process is GONE does not", () => {
  // The counterpart, and the reason liveness is tested rather than presence: a crashed draw must not
  // wedge the hourly deploy forever. pid 2^22 is above every Linux default pid_max.
  const dir = lockDir();
  writeFileSync(join(dir, "draw-1.lock"), "4194304:draw");
  const holds = liveRunHolds({ queueDirs: [], lockDir: dir });
  assert.deepEqual(holds.slots, [], "a dead pid's lock is debris, not a hold");
  assert.equal(deployRefusal(holds).refuse, false);
  rmSync(dir, { recursive: true, force: true });
});

test("A DRAW LOCK IS NOT A RUN SLOT — it must not consume clearance admission", () => {
  // The design decision, asserted rather than described. If a draw ate a run slot, a box at
  // maxConcurrentRuns would make the next clearance WAIT on an experiment — fixing what the guard sees
  // by changing what a draw does to everything else.
  const dir = lockDir();
  writeFileSync(join(dir, "draw-1.lock"), `${process.pid}:draw`);
  writeFileSync(join(dir, "draw-2.lock"), `${process.pid}:draw`);
  assert.equal(freeSlots({ dir, cap: 1, prefix: "slot" }), 1,
    "two live draws must leave a cap-1 box with its run slot still free");
  rmSync(dir, { recursive: true, force: true });
});

test("the two prefixes are counted together and reported as one fact", () => {
  // A reader deciding whether to deploy does not care which kind of work is running, only that some is.
  const dir = lockDir();
  writeFileSync(join(dir, "slot-1.lock"), `${process.pid}:run`);
  writeFileSync(join(dir, "draw-1.lock"), `${process.pid}:draw`);
  const holds = liveRunHolds({ queueDirs: [], lockDir: dir });
  assert.equal(holds.slots.length, 2);
  assert.match(deployRefusal(holds).reason, /2 run slot\(s\) held by a live pid/);
  rmSync(dir, { recursive: true, force: true });
});

test("a file that is neither prefix is ignored, so the directory is not a catch-all", () => {
  const dir = lockDir();
  writeFileSync(join(dir, "notes.txt"), `${process.pid}`);
  writeFileSync(join(dir, "draw-1.lockfile"), `${process.pid}`);
  assert.deepEqual(liveRunHolds({ queueDirs: [], lockDir: dir }).slots, [],
    "only `slot-*.lock` and `draw-*.lock` are holds; anything else in that directory is not");
  rmSync(dir, { recursive: true, force: true });
});

test("acquire then release leaves nothing behind, so a finished draw stops refusing", async () => {
  const dir = lockDir();
  const lock = await acquireSlot({ dir, cap: 1024, prefix: "draw" });
  const held = liveRunHolds({ queueDirs: [], lockDir: dir });
  assert.equal(held.slots.length, 1, "the acquire must be visible to the guard");
  assert.equal(deployRefusal(held).refuse, true);
  releaseSlot(lock);
  const after = liveRunHolds({ queueDirs: [], lockDir: dir });
  assert.deepEqual(after.slots, [], "and the release must clear it");
  assert.equal(deployRefusal(after).refuse, false, "a finished draw must not keep deferring the deploy");
  rmSync(dir, { recursive: true, force: true });
});

test("runExperiment wraps its body so a THROW still releases the lock", () => {
  // Asserted on the source because driving runExperiment needs a run directory and a stage. What matters
  // is the shape: the acquire is outside the try and the release is in a `finally`, which is the same
  // idiom `pipeline()`/`pipelineInner()` already uses in that file. Without the finally, a draw that
  // throws leaves a live-pid lock behind and the next hourly deploy defers on a draw that ended.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const i = src.indexOf("export async function runExperiment(job, opts) {");
  assert.ok(i > 0, "runExperiment must still be the exported entry point");
  const body = src.slice(i, src.indexOf("\n}\n", i));
  assert.match(body, /acquireSlot\(\{ dir: config\.runLockDir, cap: \d+, prefix: "draw" \}\)/);
  assert.match(body, /try \{[\s\S]*runExperimentInner\(job, opts\)[\s\S]*\} finally \{[\s\S]*releaseSlot/);
  assert.ok(!/acquireRunSlot/.test(body),
    "a draw must not take a RUN slot — that is admission-controlled and would make it wait behind clearances");
});
