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
  // This arm used to assert the exact opposite, and it was right under the ruling it cited:
  // starting the unit WAS the on-demand consent, because starting it turned on
  // client-account access, so an enable list containing it made that consent meaningless.
  //
  // The owner superseded that knowingly (settled point 2): the door auto-starts
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
  // FLOOR LOWERED 10 -> 6 BECAUSE THE TREE LOST SIX FILES, not because the walker got weaker. The
  // retired path-watcher and timer units were deleted by ruling, taking twelve shipped files to six.
  // The floor's job is unchanged: it catches a walker that returns nothing or a handful, which is the
  // failure that would make every assertion below vacuously true.
  assert.ok(shipped.length >= 6, `only ${shipped.length} unit files found — the walker broke, not the tree`);
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
  // ANCHORED ON THE CALL, NOT ON THE LOOP AROUND IT — and both weaker anchors were tried and failed
  // here, which is worth writing down. It first matched `for (const u of BACKGROUND_UNITS) execFileSync`
  // and lost its subject when that loop grew a body, which it did when the enable step learned to catch
  // a systemd refusal instead of throwing a stack trace. Matching the loop HEADER
  // instead was worse: three loops in that file open with those exact words, `indexOf` found the first
  // — the one that renders the unit files, which is legitimately BEFORE the disarm — and the ordering
  // assertion failed over code that is correctly ordered.
  //
  // The property is about when the units are ENABLED, so the anchor is the enable itself. The arm said
  // "aimed at nothing" both times rather than passing, which is the assertion earning its place.
  const enable = src.indexOf('"--user", "enable", "--now", u');
  assert.ok(disarm > 0, "nothing disarms the retired units — an armed timer beside the worker is a second claimant");
  assert.ok(enable > 0, "the enable call moved; this arm is aimed at nothing");
  assert.equal(src.indexOf('"--user", "enable", "--now", u', enable + 1), -1,
    "there is more than one enable call now, so reading the first one decides nothing about the rest");
  assert.ok(disarm < enable,
    "the retired units are disarmed AFTER the replacement is enabled, so there is a window with both "
    + "the old timer and the new worker draining one queue");
});

// ── a stop that could not stop must not report that it did ─────────────────────────
//
// `clearotron stop` exited 0, printed "stopped and removed" for three units and "The background product
// is stopped and the box runs nothing again", and left all four services active on unchanged pids holding
// all three ports. The only thing it changed was deleting three unit files — leaving running services
// with no unit file to stop them by, which is strictly worse than leaving both alone.
//
// The mechanism was a comment standing in for a check: `catch { /* already down */ }` guessed why the
// call failed, the next line deleted the file regardless, and the line after announced success.
import { mkdtempSync as mkdtemp270, mkdirSync as mkdir270, writeFileSync as write270 } from "node:fs";
import { readdirSync as readdir270 } from "node:fs";
import { execFileSync as exec270 } from "node:child_process";
import { tmpdir as tmp270 } from "node:os";

// The file had no repo root of its own — it reads modules by relative import rather than by path.
const REPO270 = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STOP = join(REPO270, "bin", "stop.mjs");

/** A HOME carrying unit files, with the session bus stripped so systemd cannot be reached. */
function stopWithNoBus(units) {
  const home = mkdtemp270(join(tmp270(), "stop-nobus-"));
  const dir = join(home, ".config", "systemd", "user");
  mkdir270(dir, { recursive: true });
  for (const u of units) write270(join(dir, u), "[Unit]\n");
  const env = { HOME: home, PATH: "/usr/bin:/bin" };
  try {
    const out = exec270(process.execPath, [STOP], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out, dir };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}`, dir };
  }
}

test("270 a stop that could not reach systemd leaves the unit files in place", () => {
  const units = ["clearotron-portal.service", "clearotron-worker.service"];
  const r = stopWithNoBus(units);
  const left = readdir270(r.dir);
  assert.equal(left.length, units.length,
    `${units.length - left.length} unit file(s) were deleted by a stop that could not stop anything. A `
    + `running service with no unit file cannot be stopped by any ordinary means.\n${r.out}`);
});

test("270 it says it could not, rather than that it did", () => {
  const r = stopWithNoBus(["clearotron-portal.service"]);
  assert.ok(!/stopped and removed/.test(r.out),
    `it reported "stopped and removed" for a unit it did not stop\n${r.out}`);
  assert.ok(!/runs nothing again/.test(r.out),
    `it reported the box idle after failing to stop a service\n${r.out}`);
  assert.match(r.out, /COULD NOT STOP/, `nothing named the unit it failed on\n${r.out}`);
  // AND THE REMEDY, because "could not reach systemd" without it sends a reader nowhere.
  assert.match(r.out, /XDG_RUNTIME_DIR/, `the refusal does not say how to reach systemd\n${r.out}`);
});

test("270 and it exits non-zero — the printed refusal is not enough on its own", () => {
  // The refusal was printed AND the command exited 0 in the first cut of this fix, because a bare
  // `process.exit(0)` on the last line discarded the code set above it. A script calling this would have
  // read success while the text said otherwise.
  const r = stopWithNoBus(["clearotron-portal.service"]);
  assert.notEqual(r.code, 0, `it printed a refusal and exited 0\n${r.out}`);
});
