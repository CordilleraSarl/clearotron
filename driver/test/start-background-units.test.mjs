// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The background set: which units `clearotron start --background` may enable, and the one it never may.
//
//. PINNED, not derived, because enabling a unit is deliberateness territory: a
// derived enable-list fails OPEN — a new shipped unit would come up on every laptop the day it lands,
// nobody having decided that. So the pin is explicit, and the census below is what keeps the pin
// honest: every shipped unit is either pinned or excluded WITH ITS REASON, and a new unit reds this
// file until somebody decides which it is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_UNITS, BACKGROUND_EXCLUDED, BACKGROUND_RETIRED } from "../../bin/start.mjs";
import { CLIENT_DOOR_UNIT } from "../../shared/client-door.mjs";
import { UNIT_INVENTORY } from "../unit-inventory.mjs";

const SYSTEMD = join(dirname(fileURLToPath(import.meta.url)), "..", "systemd");
/** — read as source, because systemd cannot be observed from a unit test. */
const START = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "start.mjs");

test("2148: the client door IS in the background enable set, and its settings are written before it", () => {
  // ── SUPERSEDED 2026-09-03, AND REWRITTEN RATHER THAN DELETED ──────────────────────────────────
  //
  // This arm used to assert the exact opposite, and it was right under the ruling it cited (tracker
  // issues 1976/2082): starting the unit WAS the on-demand consent, because starting it turned on
  // client-account access, so an enable list containing it made that consent meaningless.
  //
  // The owner superseded that knowingly (, settled point 2): the door auto-starts
  // with the product and THE PER-ACCOUNT KEY IS THE GATE, not whether a process runs. A later reader
  // should meet a ruling that changed, not a guard somebody weakened.
  assert.ok(BACKGROUND_UNITS.includes(CLIENT_DOOR_UNIT),
    "the client door is not in the background enable set — a reader who logs in has nothing to connect to");
  // AND IT IS NOT STILL EXCLUDED. The two tables must partition, and a row left behind here would be
  // the same unit answering the same question twice with opposite answers.
  assert.ok(!(CLIENT_DOOR_UNIT in BACKGROUND_EXCLUDED),
    "the client door is pinned AND excluded — the superseded exclusion row was not removed");
  // ── THE HALF THAT MATTERS MORE THAN THE PIN ───────────────────────────────
  //
  // `http-server-client.mjs` refuses to start without CLIENT_MCP_TOKEN_ONLY=1 — it otherwise demands
  // an OIDC audience and an access team, which a local install has neither of — and token-only in turn
  // requires the fence, the secret and the allow-list. So installing the unit is only half the ruling:
  // a box that places it without those settings crash-loops a door, which settled point 2 forbids in
  // its own words ("never a unit failing at boot").
  //
  // READ AS SOURCE, because systemd cannot be observed from a unit test. What is asserted is that the
  // settings come from `enablePlan` and are computed BEFORE the install loop — not that a string
  // appears somewhere in the file.
  const src = readFileSync(START, "utf8");
  const planAt = src.indexOf("enablePlan({");
  const installAt = src.indexOf("for (const u of BACKGROUND_UNITS) {");
  assert.ok(planAt > 0, "--background no longer asks enablePlan for the door's settings");
  assert.ok(installAt > 0, "the background install loop moved — this arm's ordering read is measuring nothing");
  assert.ok(planAt < installAt,
    "the door's settings are resolved AFTER its unit is installed — the unit would be placed and started "
    + "before anything wrote what it refuses to start without");
  assert.match(src.slice(planAt, planAt + 400), /issuesKey:\s*false/,
    "--background asks for a plan that mints a key; an installer mints nothing and would refuse for want "
    + "of a signed-in identity");
});

test("2083: every shipped unit file is PINNED or EXCLUDED WITH A REASON — a new unit is a decision, not a default", () => {
  const shipped = readdirSync(SYSTEMD).filter((f) => /\.(service|timer|path)$/.test(f));
  assert.ok(shipped.length >= 10, `only ${shipped.length} unit files found — the walker broke, not the tree`);
  const undecided = shipped.filter((f) => !BACKGROUND_UNITS.includes(f) && !(f in BACKGROUND_EXCLUDED));
  assert.deepEqual(undecided, [],
    "shipped unit(s) neither pinned for --background nor excluded with a reason — decide, in the pin or the exclusion table");
  // Reasons are sentences, not placeholders.
  for (const [u, why] of Object.entries(BACKGROUND_EXCLUDED)) {
    assert.ok(typeof why === "string" && why.length > 20, `${u}'s exclusion reason is not a sentence`);
    assert.ok(!BACKGROUND_UNITS.includes(u), `${u} is both pinned and excluded — the two must partition`);
  }
});

test("2083: `stop` on a box running nothing says so plainly and changes nothing", async () => {
  // Same acceptance shape as disconnect's closed-door line. Spawned with a scratch HOME so the real
  // box's units (if any) are invisible; fate before text (the 2064 discipline).
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const home = mkdtempSync(join(tmpdir(), "stop-home-"));
  try {
    const child = spawnSync(process.execPath, [join(SYSTEMD, "..", "..", "bin", "stop.mjs")], {
      encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH, HOME: home },
    });
    assert.ok(!child.error && child.status === 0,
      `stop did not come back clean (status=${child.status} signal=${child.signal} error=${child.error?.message ?? "none"})\n${child.stderr}`);
    assert.match(child.stdout, /Nothing was running in the background/, "the empty box is stated, not implied");
    assert.match(child.stdout, /nothing was changed/i, "and the no-change claim is explicit");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── the retirement's upgrade path ──────────────────────────────────────────────

test("1863 a retired unit is still MANAGED, or the flag refuses on every box it previously worked on", () => {
  // THE REGRESSION THIS CATCHES, found by being asked whether the timer and the worker can coexist.
  // Removing the three prelim-driver units from BACKGROUND_UNITS makes them FOREIGN to the carve in
  // `start`, which reads any foreign installed unit as proof the box is a real server and refuses.
  // A box that ran --background before the retirement has exactly those three installed — so the flag
  // would refuse on precisely the boxes it had already worked on. That is the failure the carve's own
  // comment records being found by driving the flag twice, arriving by a new route.
  for (const u of BACKGROUND_RETIRED) {
    assert.ok(!BACKGROUND_UNITS.includes(u), `${u} is retired and must not also be pinned for start`);
    assert.ok(u in BACKGROUND_EXCLUDED,
      `${u} is retired but carries no exclusion reason — the 2083 partition would not see it either`);
  }
});

test("1863 every retired unit is a unit this repo actually ships", () => {
  // A retirement naming a file that does not exist disarms nothing and reads as done. Same shape as an
  // inventory entry claiming a tracked file the tree does not have.
  const shipped = new Set(readdirSync(SYSTEMD).filter((f) => /\.(service|timer|path)$/.test(f)));
  for (const u of BACKGROUND_RETIRED) {
    assert.ok(shipped.has(u), `${u} is retired but is not in driver/systemd/ — the name is stale`);
  }
});

test("1863 the disarm runs BEFORE the enable, so the box never holds both drainers at once", () => {
  // Ordering is the whole safety property here and it is invisible to any arm that only reads the
  // tables. Read from the source, because there is no way to observe systemd from a unit test.
  const src = readFileSync(START, "utf8");
  const disarm = src.indexOf("for (const u of BACKGROUND_RETIRED)");
  const enable = src.indexOf("for (const u of BACKGROUND_UNITS) execFileSync");
  assert.ok(disarm > 0, "nothing disarms the retired units — an armed timer beside the worker is a second claimant");
  assert.ok(enable > 0, "the enable loop moved; this arm is aimed at nothing");
  assert.ok(disarm < enable,
    "the retired units are disarmed AFTER the replacement is enabled, so there is a window with both "
    + "the old timer and the new worker draining one queue");
});
