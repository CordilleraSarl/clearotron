// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F23 — A FICTIONAL CLEARANCE IN A CUSTOMER'S REAL POOL ────────────────
//
// Owner, in session, on his first real start: "critical, it started and I still see a demo report in
// the actual product. Should not be there — should ONLY be in demo. Proper product should have no
// previous reports."
//
// Measured on that box: `tmp0001-venqori-…-sample-capture` sat in /home/clearotron/trademark/pool —
// the directory that install publishes REAL CLIENT MATTERS into — written the moment `start` first ran.
//
// The seeding's own guard was EMPTINESS, which answers "has this pool been seeded already" and never
// answered "is this pool a customer's". A fresh real install has an empty pool, which is precisely why
// the sample landed in it.
//
// DORMANT RATHER THAN DELETED, because the ruling puts the sample in one place and takes it out of the
// other: `--demo` is the deployment whose whole purpose is having something to look at with no
// credentials, and deleting the path would take that away to fix a problem it does not have.
//
// BREAK MATRIX:
//   · a real start seeds NOTHING                  → break: ungate it, arm 1 red
//   · the demo start still seeds                  → break: delete the path, arm 2 red
//   · a real start SAYS the archive is empty      → break: skip silently, arm 3 red
//   · and names what to run instead               → break: drop the pointer, arm 3 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), "..", "bin", "start.mjs"), "utf8");

/** The seeding block, from the demo gate to the end of its catch. Sliced so the arms read one region. */
function seedRegion() {
  const gate = SRC.indexOf("if (!DEMO) {");
  assert.ok(gate > 0, "the demo gate around the seeding is gone — a real install seeds a customer's pool again");
  const end = SRC.indexOf("the example report could not be seeded", gate);
  assert.ok(end > gate, "the seeding block moved away from its gate; this arm can no longer see the seam");
  return SRC.slice(gate, end);
}

test("a real start reaches no seeding path at all", () => {
  const region = seedRegion();
  const seedCall = region.indexOf("seedPool({");
  const elseBranch = region.indexOf("} else try {");
  assert.ok(seedCall > 0, "seedPool is gone entirely — the demo has nothing to show");
  assert.ok(elseBranch > 0 && elseBranch < seedCall,
    "seedPool is reachable without passing the demo gate — a customer's pool gets a fictional clearance");
});

test("the demo posture still seeds, because that is the deployment it exists for", () => {
  assert.match(SRC, /seedPool\(\{ pool: paths\.pool/,
    "the seeding path was deleted rather than gated — `clearotron start --demo` now comes up with nothing to look at");
  assert.match(SRC, /Real engine output for a fictional mark/,
    "the demo lost the sentence that tells a viewer what the document is");
});

test("a real start SAYS the archive is empty, and names what to run instead", () => {
  const region = seedRegion();
  const notSeeded = region.slice(0, region.indexOf("} else try {"));
  // NEVER A SILENT SKIP. "The archive is empty" and "the archive is empty and nobody said why" look
  // identical in a browser — the same argument the seeding path already made for its own warnings.
  assert.match(notSeeded, /empty, which is what a real install starts with/,
    "a real start says nothing about its empty archive, so an operator reads it as a fault");
  assert.match(notSeeded, /clearotron demo/,
    "the reader is told the archive is empty and not what shows them an example instead");
});

// ── tracker issue 277: a stale demo pool is topped up to the package's set ────────────────────────────
//
// `seedPool` returned early on any non-empty pool. That was invisible while `demo/` shipped one child —
// seeding one and seeding all were the same act — and became a defect the day the other three landed:
// every box seeded before that kept its single demo through every upgrade, because the pool was no longer
// empty and nothing looked at what the package now carried.
import { seedPool, poolRunIds } from "../publish/seed-pool.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo");
/** A stub publisher that actually lands the run, so `poolRunIds` can see it on the next pass. */
const publishInto = async ({ runId, pool }) => {
  const d = join(pool, runId);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "meta.json"), JSON.stringify({ runId }));
};
const freshPool = () => mkdtempSync(join(tmpdir(), "seed-pool-arm-"));

test("277 a pool seeded before the other demos shipped is brought up to the package's set", async () => {
  const pool = freshPool();
  // EXACTLY THE SHAPE THAT WAS FOUND: one run, published when `demo/` held one child, under a runId this
  // package no longer ships.
  const stale = join(pool, "tmp0001-venqori-2026-08-11-sample-capture");
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, "meta.json"), JSON.stringify({ runId: "tmp0001-venqori-2026-08-11-sample-capture" }));

  const r = await seedPool({ pool, examplesDir: DEMO_DIR, republish: publishInto });
  assert.ok(r.seeded.length >= 4,
    `a stale pool seeded ${r.seeded.length} of the package's examples — before this it seeded none, and `
    + `skipped with "the pool already holds 1 run(s)"`);
  assert.deepEqual(r.problems, [], `seeding reported problems: ${r.problems.join("; ")}`);
  // NOTHING IS REMOVED. A demo pool may hold a run this package does not ship, and deleting it would make
  // an upgrade destructive on a directory the reader was told is safe to keep.
  assert.ok(poolRunIds(pool).includes("tmp0001-venqori-2026-08-11-sample-capture"),
    "the run that was already published was removed — an upgrade must add, never delete");
});

test("277 an upgrade that has nothing to add says so, rather than reporting a bare zero", async () => {
  const pool = freshPool();
  await seedPool({ pool, examplesDir: DEMO_DIR, republish: publishInto });
  const again = await seedPool({ pool, examplesDir: DEMO_DIR, republish: publishInto });
  assert.equal(again.seeded.length, 0, "the same examples were published twice");
  assert.ok(again.already.length >= 4, `nothing was reported as already present: ${JSON.stringify(again.already)}`);
  assert.match(String(again.skipped ?? ""), /already holds all/,
    `"seeded 0" was returned with no sentence saying why — the number is true and reads as a failure`);
});

test("277 every product the package ships gets an example, not just the first", async () => {
  // The count is derived from the container rather than written down: a fifth demo landing must not need
  // this arm edited, and must not pass it by accident either.
  const { frozenSamples } = await import("../publish/seed-pool.mjs");
  const shipped = frozenSamples(DEMO_DIR);
  assert.ok(shipped.samples.length >= 4,
    `the tree ships ${shipped.samples.length} frozen example(s); this arm is about there being several`);
  const pool = freshPool();
  const r = await seedPool({ pool, examplesDir: DEMO_DIR, republish: publishInto });
  assert.equal(r.seeded.length, shipped.samples.length,
    `${shipped.samples.length} example(s) ship and ${r.seeded.length} were seeded`);
});
