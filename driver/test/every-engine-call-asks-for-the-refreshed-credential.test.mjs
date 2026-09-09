// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every engine call the portal makes asks for the credential re-taken against the roster as it stands.
//
// WHY THIS EXISTS RATHER THAN A SECOND TEST OF opsTokenFor. That function was already correct and
// already covered: it re-takes the cap, it refuses to widen on an empty roster, and it falls back to
// the boot credential when the mint throws. What nothing asserted is that anybody ASKS it. `stop_run`
// went on passing the boot credential, so a company created after the portal started could begin a
// clearance and could not stop it, and could not cancel a queued job before any spend — the same defect
// the refresh was written to remove, surviving on the other call.
//
// A test of a helper proves the helper obeys. It does not prove the code that should be using it does.
//
// WHY IT READS THE SOURCE. `trigger` and `stopRun` are built inside the process bootstrap, closing over
// the URL and the boot credential, and the service takes them as injected parameters — which is exactly
// why a suite that exercises the service cannot see which credential the real ones pass. There is no
// seam to drive here, so the property is asserted where it is written. It stops short in the way every
// source check does: it holds while the calls look like this. If the bootstrap is ever restructured so
// the two calls share one site, this check is satisfied by construction and can go.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("no engine call passes the credential minted at boot", () => {
  const src = readFileSync(new URL("../portal-service.mjs", import.meta.url), "utf8");

  // Each `mcpToolCall({ ... })` the bootstrap makes, with the tool it names and the credential it hands
  // over. Matched per call rather than as one blob, so a file with two calls cannot pass on the strength
  // of the one that is right.
  const calls = [...src.matchAll(/mcpToolCall\(\{([^}]*)\}\)/g)].map((m) => {
    const argsText = m[1];
    return {
      tool: (argsText.match(/tool:\s*"([^"]+)"/) ?? [, "(unnamed)"])[1],
      token: (argsText.match(/token:\s*([^,]+),/) ?? [, "(none)"])[1].trim(),
    };
  });

  // THE FLOOR. A regular expression that stopped matching — a reformatted call, a renamed helper, a
  // wrapper moved in front of it — finds nothing, and "no call passes the boot credential" is perfectly
  // true of no calls at all. That reads as a clean sweep and is the state this whole change is about.
  // Two is what the file holds today: one to start a run, one to stop one.
  assert.ok(calls.length >= 2,
    `only ${calls.length} engine call(s) were found in portal-service.mjs, so this check is no longer `
    + `reading what it names. Repair the match, do not delete the assertion.`);

  // Both directions of the same fact, because they fail differently. A call naming the boot credential
  // is the defect that shipped; a call naming neither is a third state this check must not pass over.
  const stale = calls.filter((c) => c.token === "OPS_TOKEN");
  assert.deepEqual(stale, [],
    `these engine calls pass the credential minted at boot, so an account created since the portal `
    + `started is refused at the door: ${stale.map((c) => c.tool).join(", ")}`);

  const refreshed = calls.filter((c) => c.token === "await currentOpsToken()");
  assert.equal(refreshed.length, calls.length,
    `every engine call must take the re-taken credential; these do not: `
    + `${calls.filter((c) => c.token !== "await currentOpsToken()").map((c) => `${c.tool} (${c.token})`).join(", ")}`);

  // The two the file is known to make, by name — so a call quietly disappearing is not silence.
  assert.deepEqual(calls.map((c) => c.tool).sort(), ["start_run", "stop_run"],
    "the engine calls this file makes have changed; check the new one takes the re-taken credential too");
});
