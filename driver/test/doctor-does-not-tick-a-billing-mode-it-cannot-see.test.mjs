// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// DOCTOR DOES NOT TICK A BILLING MODE ON A MACHINE WITH NO ENGINE.
//
// Measured on a clean `node:22` container against the published 0.3.2-beta.10: no reasoning CLI, no
// settings file. The Engine block said demo mode, no program on PATH, nothing to probe — and then:
//
//     ✓ billing: subscription — charged to the signed-in subscription, not per token
//
// A green tick for a billing mode on a machine with no engine and no `.env`. `billingOf` answers from
// the DEFAULT when nothing is set, and the default is not a fact about this machine. Everything else in
// that run read honestly, which is what made this line stand out: "Nothing is MISconfigured … Nothing
// was written", and the three missing settings named.
//
// A tick is a claim about something that resolved. Where no engine program resolves, the same words are
// information. Not a warning either — nothing is wrong, and a caution would be its own false note.
//
// DRIVEN AS A READER MEETS IT: the real verb, in an environment with no engine on PATH and no settings
// file, reading the line off stdout. Asserting on `billingOf` alone would not have caught this, because
// `billingOf` was answering correctly — it is the marker its answer was printed under that was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

/** `clearotron doctor` on a machine with nothing: no engine on PATH, no settings file. */
function doctorOnABareMachine() {
  const home = mkdtempSync(join(tmpdir(), "doctor-bare-"));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"], {
      encoding: "utf8",
      // env -i: the engine binaries are found on PATH, so a PATH carrying this box's own tools would
      // resolve one and the case under test would never arise.
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1" },
    });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  } finally { rmSync(home, { recursive: true, force: true }); }
}

const OUT = doctorOnABareMachine();
const billingLine = () => OUT.split("\n").find((l) => /billing:/.test(l)) ?? "";

test("the run this arm reads is the one it means to read", () => {
  // Without this the assertions below pass on an empty string, which is the shape of a check that
  // reported on a run that never happened.
  assert.ok(OUT.length > 200, `doctor said almost nothing, so nothing below reads it:\n${OUT.slice(0, 400)}`);
  assert.ok(billingLine(), `doctor printed no billing line at all:\n${OUT.slice(0, 600)}`);
});

test("the billing line is not ticked when no engine program resolves", () => {
  // THE DEFECT, as the assertion.
  assert.doesNotMatch(billingLine(), /✓/,
    `doctor ticked a billing mode on a machine with no engine: ${billingLine()}`);
});

test("it is still said, and still says the same thing", () => {
  // Removing the line would also pass the arm above and would take away a fact the reader wants: what
  // this install WOULD be billed as, once an engine is there.
  assert.match(billingLine(), /billing: /, "the billing line is gone rather than un-ticked");
  assert.match(billingLine(), /·/, "the billing line is neither a tick nor information");
});

test("it is not raised to a problem or a warning either", () => {
  // Nothing is misconfigured on this machine. A caution here would be a second false note replacing
  // the first, and the rest of this run is explicit that nothing is wrong.
  assert.doesNotMatch(billingLine(), /✗|⚠/, `a bare machine's billing line was raised as a fault: ${billingLine()}`);
});

test("the rest of the bare run still reads honestly", () => {
  // The control on the change: these were already right, and a fix that disturbed them would be worse
  // than the defect.
  assert.match(OUT, /Nothing was written/, "the run no longer says it changed nothing");
  assert.doesNotMatch(OUT, /✓ billing/, "some other billing line is still ticked");
});
