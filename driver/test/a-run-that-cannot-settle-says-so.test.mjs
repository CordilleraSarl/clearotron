// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE CLI MAY NOT RUN FROM A TOP-LEVEL AWAIT, AND A RUN THAT CANNOT SETTLE MUST STILL SPEAK.
//
// ── WHAT THIS IS GUARDING, AND WHY IT IS A SOURCE TEST ──────────────────────────────────────────────
//
// `clearotron run --job` on a knockout product died with exit 13, no diagnostic, no status.json and a
// dead pid holding a run slot. Nothing threw: it was a deadlock, and a deadlock is not a failure any
// catch can see.
//
//   pipeline.mjs ran the whole run inside a TOP-LEVEL await, so its module evaluation never completed
//     → the run reached the knockout branch
//       → await import("./pipeline-knockout.mjs")        the lazy import that "breaks the static cycle"
//         → that module statically imports pipeline.mjs
//           → whose evaluation cannot complete until the run returns
//             → which cannot happen until the import settles
//
// THE BEHAVIOURAL PROOF IS A SPAWNED RUN and it lives in the issue: a knockout job in a temp workspace
// reproduced it 1/1 before the fix and fails honestly at its first stage after. That proof costs a real
// run directory and a mock engine turn, which is why the regression guard here is a SOURCE test — it is
// the half that can run on every commit, in every workspace, in milliseconds.
//
// A source test is the weaker instrument and it is the right one here for a specific reason: what
// regressed is a SHAPE, not a value. Somebody re-introducing `await` at this entry would restore the
// deadlock exactly, and no assertion about run behaviour would fire until a knockout run was attempted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");

test("#1858 the CLI entry does not run from a top-level await", () => {
  const entry = /^if \(isEntrypoint\(import\.meta\.url\)\)\s*(\S+)/m.exec(SRC);
  assert.ok(entry, "the entry guard moved — find it before assuming this is still held");
  assert.notEqual(entry[1], "{",
    "the CLI entry opens a BLOCK again, which puts the run back inside this module's evaluation. That is "
    + "the #1858 deadlock: a module lazily imported during a run cannot import this one back, because "
    + "this one has not finished evaluating. It fails as exit 13 with no error, not as a test failure.");
  assert.match(entry[1], /^void$/,
    "the entry is detached with `void (async () => {`, so module evaluation completes before the run starts");
});

test("#1858 the detached entry still reports a throw the way the inner catch does", () => {
  // Without this, a throw BEFORE the try block — argument parsing, a retired-flag refusal — would exit
  // through Node's default unhandled-rejection path with a different code than every other failure here.
  assert.match(SRC, /\}\)\(\)\.catch\(\(e\) => \{[^\n]*process\.exit\(2\)/,
    "the detached entry has no .catch, so a throw outside its try block exits by a different door");
});

test("#1858 a run that never settles writes a terminal status and releases its slot", () => {
  const net = SRC.slice(SRC.indexOf('process.on("beforeExit"'));
  assert.ok(net.length > 0, "the unsettled-run net is gone — nothing speaks for a run that deadlocks");
  assert.match(net, /if \(settled\) return;/,
    "the net must not fire for a run that already recorded its own outcome — overwriting a settled run's "
    + "status would be a worse lie than the silence it replaces");
  assert.match(net, /!existsSync\(join\(dir, "status\.json"\)\)/,
    "the net must write a terminal status ONLY where the run left none");
  assert.match(net, /releaseSlot\(liveRunSlot\)/,
    "the slot's own finally never runs on this path, so a dead pid would hold it until something reaped it");
  assert.match(net, /process\.exitCode = 1/, "an unsettled run must not exit 0");
});

test("#1858 the live slot is exposed for the net, and cleared on the normal path", () => {
  assert.match(SRC, /export let liveRunSlot = null;/);
  assert.match(SRC, /liveRunSlot = slot;/, "acquire must record it, or the net has nothing to release");
  assert.match(SRC, /releaseSlot\(slot\);\s*\n\s*liveRunSlot = null;/,
    "the normal path must clear it, or the net could release a slot that was already returned");
});
