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
