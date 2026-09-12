// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// running the demo from a clone edited the clone.
//
// Publishing writes a receipt into the run directory, on purpose: it records that the publish happened,
// and where the store is read-only it does not land. `demo/` is not a store — it is a TRACKED directory
// in this repository — so replaying it rewrote a committed file. A reader who only READ the demo, by
// running the command the front page gives them, was left with a dirty checkout and an engine reporting
// `engineState: dirty`, which is the signal they use to decide whether they are running the shipped
// thing. Invisible in an installed package, where there is no git; visible to exactly the audience most
// likely to be evaluating the code.
//
// THE ARM DRIVES THE PLAYER THE WAY A READER RUNS IT — against the tracked demo, not a copy, because a
// copy is the fix and an arm that made one first would be testing itself. It records the bytes it is
// protecting and puts them back if they move, so a regression is reported rather than committed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { demoChildren, prepareSample, publishContainer, publishSource } from "../demo-container.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";   // tracker issue 235

const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const GUARD = "reading-the-demo";
const DEMO = join(REPO, "demo");
const RECEIPT = "run/_driver/predelivery-lint.json";

test("reading the demo leaves the repository exactly as it found it", { timeout: 300_000 }, (ctx) => {
  const children = demoChildren(DEMO);
  nonEmpty(children, "the demo products in this tree");
  // The knockout lane is the one that was measured writing back; drive that one when it is here, and
  // fall back to whatever this tree does have rather than skipping.
  const product = children.includes("knockout-search") ? "knockout-search" : children[0];

  // Every tracked file under the child, by content. The receipt is the one that moved, and naming only
  // it would miss the next file the publisher learns to write.
  // Through the helper. It drops `-z`, and that costs nothing here: a path this
  // pathspec can reach is publisher-written under demo/, and git only quotes on characters no such
  // path carries. What it buys is the stated skip below instead of a throw off a checkout.
  const listed = trackedFiles(GUARD, { root: REPO, pathspec: [join("demo", product)] });
  if (listed === null) return ctx.skip(skipReason(GUARD));
  nonEmpty(listed, `the tracked files under demo/${product}`);
  assert.ok(listed.some((f) => f.endsWith(RECEIPT)) || true, "the receipt need not exist yet — its absence is not the subject");
  const before = new Map(listed.map((f) => [f, readFileSync(join(REPO, f))]));

  const pool = mkdtempSync(join(tmpdir(), "demo-pool-"));
  let out = "";
  try {
    out = execFileSync(process.execPath, [join(REPO, "bin", "example.mjs"), "--once", "--product", product, "--pool", pool],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } finally {
    const moved = [];
    for (const [f, bytes] of before) {
      const now = existsSync(join(REPO, f)) ? readFileSync(join(REPO, f)) : null;
      if (now === null || !now.equals(bytes)) {
        moved.push(f);
        writeFileSync(join(REPO, f), bytes);   // put it back, so a regression is reported and not committed
      }
    }
    rmSync(pool, { recursive: true, force: true });
    assert.deepEqual(moved, [], `running the demo edited the repository: ${moved.join(", ")}`);
  }

  // AND IT ACTUALLY PUBLISHED. Without this the arm passes on a player that refused before writing
  // anything, which is a clean tree for the wrong reason.
  assert.match(out, /published:/, `the demo did not publish, so a clean tree proves nothing:\n${out}`);
  assert.match(out, /report:/, "the demo published without naming a report");
});


test("both publishers of the shipped demos read the same rule", () => {
  // FIXING THE PLAYER LEFT THE LAUNCHER, and the launcher is the path a reader takes: `clearotron demo`
  // hands over to `start --demo`, which SEEDS the pool from the whole container on every start. The
  // player's arm above passed the whole time that second publisher went on rewriting the tracked
  // receipt — caught by driving the launcher under a wiped home and reading `git status` afterwards.
  //
  // So the rule has one home and this refuses a caller that grows its own copy of it. Both callers reach
  // publishSource's rule one sample at a time, so one unreadable sample cannot take the others down: the
  // player through prepareSample, the launcher through publishContainer.
  for (const [rel, call] of [["bin/example.mjs", /prepareSample\(/], ["bin/start.mjs", /publishContainer\(/]]) {
    const src = readFileSync(join(REPO, rel), "utf8");
    assert.match(src, call, `${rel} publishes a shipped demo without asking publishSource where to read it from`);
  }
  // AND THE PLAYER'S ROUTE IS publishSource's RULE, driven rather than read: a shipped sample prepareSample
  // prepares is published from a copy outside the tree, never from the tracked directory.
  const [first] = demoChildren(DEMO);
  const prepared = prepareSample(join(DEMO, first), { repoRoot: REPO });
  assert.ok(prepared.sample, `the shipped sample ${first} could not be prepared: ${prepared.why}`);
  assert.ok(!prepared.sample.publishFrom.startsWith(REPO + "/"), `the player publishes ${first} from inside the tree: ${prepared.sample.publishFrom}`);
  rmSync(dirname(prepared.sample.publishFrom), { recursive: true, force: true });
  // AND THE LAUNCHER'S: the whole shipped container is published from a copy outside the tree, all of it.
  const whole = publishContainer(DEMO, { repoRoot: REPO });
  assert.ok(!whole.dir.startsWith(REPO + "/"), `the launcher seeds from inside the tree: ${whole.dir}`);
  assert.deepEqual(whole.unusable, [], "a shipped sample was left out of the launcher's copy");
  assert.deepEqual(demoChildren(whole.dir), demoChildren(DEMO), "the launcher's copy does not hold every shipped sample");
  rmSync(dirname(whole.dir), { recursive: true, force: true });

  // And the rule itself: inside the tree is copied, outside it is left alone.
  const outside = "/somewhere/else/demo";
  assert.equal(publishSource(outside, { repoRoot: REPO }), outside,
    "a demo that is not part of this tree was copied — that is somebody's own directory");
  const copy = publishSource(join(REPO, "demo"), { repoRoot: REPO });
  assert.notEqual(copy, join(REPO, "demo"), "a demo inside this tree was published from the tracked directory");
  assert.ok(!copy.startsWith(REPO + "/"), `the copy is still inside the tree: ${copy}`);
  rmSync(dirname(copy), { recursive: true, force: true });
});
