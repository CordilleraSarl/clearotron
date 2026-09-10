// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// the browser render check reported "I could not measure" as three failed measurements.
//
// When the in-frame probe never posted, three assertions failed with the ABSENCE as their observed value:
//
//   FAIL  the report has NO scrollbar of its own               (got "no-probe")
//   FAIL  the report does not scroll SIDEWAYS inside the frame (got "no-probe")
//   FAIL  the frame is 15-24px taller than its content         (got null)
//
// Same tree, same fixture, on an unloaded machine: all of them pass and the probe reports normally. So the
// red was the measurement never happening on a starved runner, not the layout being wrong — and nothing in
// those three names said so. A reader meeting that red goes and looks at the report's CSS, and there is
// nothing there to find.
//
// It is this repository's own rule turned on one of its instruments: an absence is a finding, and the
// harness records rather than judges. `no-probe` and `null` are not measurements that disagreed with the
// expectation; they are the expectation never being tested.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeVerdict } from "../../scripts/render-check.mjs";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "render-check.mjs"), "utf8");
const READ = { innerScrollbar: false, hOverflowPx: 0, slackPx: 18, heightMsgs: 3, probeMsgs: 8 };
const UNREAD = { innerScrollbar: "no-probe", hOverflowPx: "no-probe", slackPx: null };

test("a probe that posted is a measurement, and the check proceeds", () => {
  const v = probeVerdict(READ);
  assert.equal(v.measured, true, "a run whose probe reported normally was treated as unmeasured");
});

test("a probe that never posted is a could-not-look, not three failures", () => {
  assert.equal(probeVerdict({ ...UNREAD, heightMsgs: 3 }).measured, false,
    "the sentinel values were treated as measurements, so the assertions that read them report as failed");
});

test("and it says WHICH of the two causes the evidence names", () => {
  // The three assertions failed identically whatever the cause: the frame did not load, the frame loaded
  // and its scripts did not run, or the scripts ran and the message did not arrive. Those are different
  // repairs, and `heightMsgs` separates them — it was already being collected.
  const probeOnly = probeVerdict({ ...UNREAD, heightMsgs: 3 });
  assert.equal(probeOnly.cause, "probe-only");
  assert.match(probeOnly.why, /look at the probe, not at the report/,
    "a run where the frame demonstrably reached the shell does not say the probe is the thing to look at");

  const nothing = probeVerdict({ ...UNREAD, heightMsgs: 0 });
  assert.equal(nothing.cause, "nothing-from-inside");
  assert.match(nothing.why, /did not load|did not run/,
    "a run where nothing arrived from inside does not say so");
  assert.notEqual(probeOnly.why, nothing.why, "both causes produce the same sentence, so it separates nothing");
});

test("any one sentinel is enough — the three do not have to agree to be unread", () => {
  // A partially-arrived probe is still a probe nobody can rely on, and requiring all three to be sentinels
  // would let one real value carry two absent ones into the assertion list.
  for (const [k, v] of [["innerScrollbar", "no-probe"], ["hOverflowPx", "no-probe"], ["slackPx", null]]) {
    assert.equal(probeVerdict({ ...READ, [k]: v }).measured, false,
      `\`${k}\` alone reading its sentinel was still treated as measured`);
  }
});

test("the script exits 2 for it, which is the house meaning for could-not-look", () => {
  // Exit 2 still stops CI — nothing is waved through. What it stops doing is claiming the layout was
  // measured and found wrong, which is what sent a reader to the CSS.
  assert.match(SRC, /process\.exit\(2\)/, "the unmeasured path does not exit 2");
  assert.match(SRC, /failure to LOOK, not a finding about the report/,
    "nothing in the output distinguishes a failure to look from a finding");
  // AND IT MUST NOT BE COUNTED AS A LAYOUT FAILURE. One counter for both would make exit 1 and exit 2
  // interchangeable, which is the distinction this exists for.
  assert.match(SRC, /let unmeasured = 0;/, "the could-not-look is not counted apart from the failures");
});
