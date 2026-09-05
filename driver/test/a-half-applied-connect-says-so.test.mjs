// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A connect that stops half-way says what failed and what it already changed — tracker issue 121.
//
// The whole output of a failed connect was: `connect: Command failed: systemctl --user daemon-reload`.
// No cause, no remedy, and nothing saying that the settings file, the denylist and BOTH unit files were
// already on disk. The reader is left unable to tell a half-applied install from one that never began,
// which is the state `doctor` then reported as complete.
//
// TWO DEFECTS AT ONE SITE, and each hides the other:
//
//   · the calls ran with `stdio: "ignore"`, so systemd's own explanation was discarded before anyone
//     could read it — which is why the message could only name a command;
//   · the missing-bus remedy was appended to EVERY failure, so a unit that would not start for any
//     other reason (a bound port, a bad ExecStart) told the reader to export XDG_RUNTIME_DIR. A
//     confident remedy for somebody else's cause costs more than no remedy at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { systemdFailure } from "../../bin/connect.mjs";

/** What execFileSync throws once stderr is captured rather than discarded. */
const failure = (stderr) => Object.assign(new Error("Command failed: systemctl --user daemon-reload"), { stderr, status: 1 });

test("tracker issue 121 — a missing session bus is named, with the two exports", () => {
  const e = systemdFailure(failure("Failed to connect to bus: No medium found"), { step: "daemon-reload" });
  assert.match(e.message, /Failed to connect to bus/, "systemd's own words are still being thrown away");
  assert.match(e.message, /XDG_RUNTIME_DIR/, "the bus remedy is missing from the failure it is actually for");
});

test("tracker issue 121 — a failure that is NOT the bus does not get the bus remedy", () => {
  // THE DEFECT'S OTHER HALF. This message went out over a bound port and a bad unit alike.
  const e = systemdFailure(failure("Job for clearotron-client-mcp.service failed because the control process exited"),
    { step: "enable", unit: "clearotron-client-mcp.service" });
  assert.match(e.message, /control process exited/, "the real reason is not shown");
  assert.doesNotMatch(e.message, /XDG_RUNTIME_DIR/,
    "a unit that failed to start still tells the reader to export a bus variable — a confident remedy for the wrong cause");
  // And it points at where the real reason lives, naming the unit rather than a placeholder.
  assert.match(e.message, /journalctl --user -u clearotron-client-mcp\.service/,
    "the reader is not told how to read what systemd actually said");
});

test("tracker issue 121 — both failures say what is ALREADY on disk, and how to get out", () => {
  for (const step of ["daemon-reload", "enable"]) {
    const e = systemdFailure(failure("Failed to connect to bus: No medium found"), { step, unit: "u.service" });
    assert.match(e.message, /HALF APPLIED/, `${step}: the reader is not told the install is half-applied`);
    assert.match(e.message, /denylist/, `${step}: what was written is not named`);
    assert.match(e.message, /unit files were copied/, `${step}: the unit files that were placed are not named`);
    // Both ways out, because "run it again" is wrong advice for somebody who wants to back out.
    assert.match(e.message, /clearotron connect/, `${step}: no way to finish`);
    assert.match(e.message, /clearotron disconnect/, `${step}: no way to undo`);
  }
});

test("tracker issue 121 — the two stages describe DIFFERENT states, because they are different", () => {
  // The old text said the same thing at both points: true and incomplete at the first, misleading at
  // the second, where a unit may already be enabled. A single shared sentence is how that happened.
  const reload = systemdFailure(failure("bus"), { step: "daemon-reload" }).message;
  const enable = systemdFailure(failure("bus"), { step: "enable", unit: "u.service" }).message;
  assert.notEqual(reload, enable, "both stages print one sentence again, so one of them is wrong");
  assert.match(reload, /neither has been enabled/, "the reload stage overstates what has happened");
  assert.match(enable, /may be enabled but is not running/, "the enable stage understates what has happened");
});

test("tracker issue 121 — a thrown error with no stderr still says something useful", () => {
  // The could-not-look: if stderr is empty the message is all there is, and it must not become blank.
  const e = systemdFailure(Object.assign(new Error("Command failed: systemctl --user daemon-reload"), { stderr: "" }),
    { step: "daemon-reload" });
  assert.match(e.message, /Command failed/, "an empty stderr swallowed the only description there was");
  assert.match(e.message, /HALF APPLIED/, "the state is not reported when systemd said nothing");
});
