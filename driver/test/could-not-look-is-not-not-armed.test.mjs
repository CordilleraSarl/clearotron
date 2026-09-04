// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `drain-preflight` must not report NOTHING DRAINS THE QUEUE when it merely could not look.
//
// THE FAILURE THIS PINS, measured before the fix: on a box whose timer was armed and had fired 26ms
// earlier, running the tool from a non-login shell printed
//
//   prelim-driver.timer  enabled=not-found active=not-found scope=(not found in user or system scope)
//   ! NOTHING DRAINS THE QUEUE.
//
// `systemctl --user` needs a session bus; a non-login shell has no XDG_RUNTIME_DIR. The tool folded
// "could not reach a manager" into "the unit is not there", and the verdict built on it was definite,
// alarming and wrong. The same silence would have produced a false GREEN just as readily — the code
// could not tell the two apart, which is why the answer has to be a refusal rather than a guess.
//
// WHY THIS DRIVES A STUB rather than the real systemctl: a process that HAS a bus cannot be made not to
// have one from inside itself, so the branch is unreachable from a normal run. That is precisely how it
// came to be wrong — it could only ever be exercised by hand.
import { test } from "node:test";
import assert from "node:assert/strict";

import { unitState } from "../../scripts/drain-preflight.mjs";

const busUnreachable = () => ({ ok: false, out: "", err: "Failed to connect to bus: No medium found", status: 1 });
const reachableAbsent = () => ({ ok: true, out: "not-found", err: "", status: 0 });
const reachableActive = (args) => args.includes("is-enabled")
  ? { ok: true, out: "enabled", err: "", status: 0 }
  : { ok: true, out: "active", err: "", status: 0 };

test("#1864 an unreachable bus answers UNKNOWN, never not-found", () => {
  const u = unitState("prelim-driver.timer", busUnreachable);
  assert.equal(u.enabled, "unknown", "an unreadable manager reported a unit state it never read");
  assert.equal(u.active, "unknown");
  assert.equal(u.unreadable, true, "nothing downstream can tell this from a real absence without the flag");
  assert.match(u.why ?? "", /bus/i, "the reason systemctl gave is dropped, so the operator cannot act on it");
});

test("#1864 a REACHABLE manager that finds nothing still answers not-found — the fix must not blanket-unknown", () => {
  // THE CONTROL. Turning every negative into "unknown" would silence the true finding this tool exists
  // to make: a box where the units genuinely are not installed must still be told so.
  const u = unitState("prelim-driver.timer", reachableAbsent);
  assert.equal(u.enabled, "not-found");
  assert.notEqual(u.unreadable, true, "a clean read was reported as unreadable — the tool now never says anything");
});

test("#1864 a reachable manager that finds the unit reports it, and is not marked unreadable", () => {
  const u = unitState("prelim-driver.timer", reachableActive);
  assert.equal(u.active, "active");
  assert.equal(u.scope, "user");
  assert.notEqual(u.unreadable, true);
});
