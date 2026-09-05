// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A missing session bus is not a closed door — tracker issue 130, criterion 3.
//
// ── the regression this exists to stop coming back ──────────────────────────────────────────────────
//
// Tracker issue 121 fixed `connect` under `su`/`sudo -u`, where `XDG_RUNTIME_DIR` and
// `DBUS_SESSION_BUS_ADDRESS` are unset and `systemctl --user` dies with "Failed to connect to bus". The
// fix reached the two WRITERS — daemon-reload and enable — and missed the two READERS, which asked
// systemd the same question with neither the derived bus nor captured stderr.
//
// That left the product WORSE on this path than before the fix, which is the part worth remembering.
// The old message named systemd and gave no remedy. The new one named the DOOR: the health read
// returned `false`, the caller rendered "the door is not open, so no key was issued", and the door was
// `active` the whole time. A wrong cause stated confidently costs more than no cause at all.
//
// It is reachable on the ordinary path, not an exotic one. A box whose door is already installed and
// running never reloads or enables anything, so the two reads are the ONLY things that touch the bus
// and the writers' remedy never fires. The test lane met it on a real box.
//
// ── what each arm can and cannot see ────────────────────────────────────────────────────────────────
//
// The branch is driven through an injected reader, which is honest here because the defect IS in the
// callee: `unitIsHealthy` translated its own could-not-look into its ordinary negative answer.
//
// What injection CANNOT see is a caller that stops passing what it was handed — the lesson of tracker
// issue 179. Here that shape is a NEW read site added straight onto `execFileSync`, bypassing the
// wrapper entirely, which is precisely how this defect arrived. The last arm is aimed at that and reads
// the file rather than the function.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unitIsHealthy, showUnit, looksLikeBusFailure, systemdSaid, systemdFailure } from "../../bin/connect.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONNECT = join(REPO, "bin", "connect.mjs");
const noPause = () => {};

/** A `show` that failed the way a bus-less shell fails, with systemd's own words on stderr. */
const busFailure = () => ({ fields: null,
  error: Object.assign(new Error("Command failed: systemctl --user show clearotron-client-mcp.service"),
    { stderr: "Failed to connect to bus: No medium found\n" }) });

test("tracker issue 130 — a bus failure at the health read is RAISED, never rendered as a shut door", () => {
  assert.throws(() => unitIsHealthy("clearotron-client-mcp.service", { show: busFailure, pause: noPause }),
    (e) => {
      // The remedy has to travel with it. A raise that says "Command failed" has moved the defect
      // rather than repaired it — that sentence is what tracker issue 121 was filed about.
      assert.match(e.message, /Failed to connect to bus/, "systemd's own words were discarded again");
      assert.match(e.message, /XDG_RUNTIME_DIR=\/run\/user\//, "the two exports the reader needs are not in it");
      assert.match(e.message, /DBUS_SESSION_BUS_ADDRESS=unix:path=/);
      return true;
    },
    "the health read still answers `false` for a bus it could not reach, so the caller will tell the "
    + "operator the door is not open while the door is running");
});

test("tracker issue 130 — a unit systemd DID answer about and calls dead is still not healthy", () => {
  // The other half, and the one that keeps the raise from swallowing the ordinary answer. A door that
  // systemd knows about and reports as failed must stay a plain `false` — turning that into an
  // exception would take down a path that is meant to report a state, not blow up on it.
  const dead = () => ({ fields: { ActiveState: "failed", SubState: "failed", NRestarts: "3" }, error: null });
  assert.equal(unitIsHealthy("x.service", { show: dead, pause: noPause }), false);

  const up = () => ({ fields: { ActiveState: "active", SubState: "running", NRestarts: "7" }, error: null });
  assert.equal(unitIsHealthy("x.service", { show: up, pause: noPause }), true,
    "a recovered door with a lifetime restart count above zero was called unhealthy — the defect "
    + "tracker issue 2203 already repaired once on this path");

  // A failure that is NOT about the bus keeps the old answer too: systemd was reachable and said no.
  const noSuchUnit = () => ({ fields: null,
    error: Object.assign(new Error("Command failed"), { stderr: "Unit x.service could not be found.\n" }) });
  assert.equal(unitIsHealthy("x.service", { show: noSuchUnit, pause: noPause }), false,
    "a unit that does not exist was raised as a bus problem, which sends the reader to export two "
    + "variables that will not help");
});

test("tracker issue 130 — the reader asks with the bus filled in and keeps what systemd said", () => {
  // The two properties the missed sites lacked, driven by recording what the runner was handed rather
  // than asserted from the source. Both are invisible in the return value and both are the whole fix.
  let seen = null;
  showUnit("x.service", ["ActiveState"], { run: (cmd, args, opts) => { seen = { cmd, args, opts }; return "ActiveState=active\n"; } });
  assert.equal(seen.cmd, "systemctl");
  assert.deepEqual(seen.args, ["--user", "show", "x.service", "-p", "ActiveState"]);
  assert.deepEqual(seen.opts.stdio, ["ignore", "pipe", "pipe"],
    "stderr is not captured, so systemd's own explanation reaches the operator raw with no remedy "
    + "beside it — or is discarded entirely, which is how this printed a command name and nothing else");
  assert.ok(seen.opts.env && seen.opts.env !== process.env,
    "the reader was not given a derived environment, so it fails in exactly the shell tracker issue "
    + "121 was filed about while the writers one screen away succeed");
});

test("tracker issue 130 — one authority decides what a bus failure looks like", () => {
  // The classifier is shared by the failure text and the health read. A second copy is how the two
  // would come to disagree about which failures deserve the remedy.
  assert.equal(looksLikeBusFailure("Failed to connect to bus: No medium found"), true);
  assert.equal(looksLikeBusFailure("Failed to connect to the bus: Permission denied"), true);
  assert.equal(looksLikeBusFailure("DBUS_SESSION_BUS_ADDRESS is not set"), true);
  assert.equal(looksLikeBusFailure("Unit clearotron-client-mcp.service could not be found."), false);
  assert.equal(looksLikeBusFailure("Job for clearotron-client-mcp.service failed"), false);
  assert.equal(looksLikeBusFailure(null), false, "a missing message was read as a bus failure");
  // And the words come from systemd, not from Node's wrapper, whenever systemd said anything.
  assert.equal(systemdSaid({ stderr: "  real reason  ", message: "Command failed" }), "real reason");
  assert.equal(systemdSaid({ message: "Command failed" }), "Command failed");
});

test("tracker issue 130 — no read site asks systemd directly, which is how this defect arrived", () => {
  // WHAT INJECTION CANNOT SEE. Every arm above holds `unitIsHealthy` and `showUnit` to their contracts,
  // and all of them stay green against a NEW reader written straight onto execFileSync — which is
  // exactly what happened: the writers were repaired, and two reads sat one screen away untouched.
  const src = readFileSync(CONNECT, "utf8");
  const direct = src.split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /execFileSync\(\s*"systemctl"/.test(line));
  const wrapped = direct.filter(({ line }) => /stdio: \["ignore", "ignore", "pipe"\]/.test(line) && /env: userBusEnv\(\)/.test(line));
  const bare = direct.filter((d) => !wrapped.includes(d));
  assert.deepEqual(bare.map((d) => d.n), [],
    "a `systemctl` call in this file neither goes through `showUnit` nor carries the derived bus and "
    + "captured stderr itself. That is the shape of the defect tracker issue 130's third criterion "
    + `found, one screen from where it was repaired: ${bare.map((d) => `${d.n}: ${d.line.trim()}`).join(" | ")}`);
  assert.ok(direct.length >= 2,
    "the `systemctl` writers have gone from this file, so this arm is watching nothing");
  // And the wrapper itself is the only other way in.
  assert.equal((src.match(/run\("systemctl"/g) ?? []).length, 1,
    "there is more than one wrapped runner, so `showUnit` is no longer the single read authority");
});

test("tracker issue 130 — the raise says what a half-finished connect already wrote", () => {
  // The health read fires AFTER the units are placed, so a reader who hits it needs the same
  // half-applied inventory every other failure on this path gives them.
  const e = systemdFailure({ stderr: "Failed to connect to bus: No medium found" },
    { step: "health-check", unit: "clearotron-client-mcp.service" });
  assert.match(e.message, /HALF APPLIED/);
  assert.match(e.message, /clearotron doctor/, "the reader is not told what can tell them which half stands");
});
