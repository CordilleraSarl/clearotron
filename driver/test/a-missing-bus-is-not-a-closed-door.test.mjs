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
import { CAPTURE_STDERR } from "../../shared/systemd-failure.mjs";
import { unitIsHealthy, showUnit, looksLikeBusFailure, systemdSaid, systemdFailure,
  secretForMint, withSecret } from "../../bin/connect.mjs";
import { describeChange } from "../../shared/client-door.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONNECT = join(REPO, "bin", "connect.mjs");
const noPause = () => {};

/** A `show` that failed the way a bus-less shell fails, with systemd's own words on stderr. */
const busFailure = () => ({ fields: null,
  error: Object.assign(new Error("Command failed: systemctl --user show clearotron-client-mcp.service"),
    { stderr: "Failed to connect to bus: No medium found\n" }) });

test("a bus failure at the health read is RAISED, never rendered as a shut door", () => {
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

test("a unit systemd DID answer about and calls dead is still not healthy", () => {
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

test("the reader asks with the bus filled in and keeps what systemd said", () => {
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

test("one authority decides what a bus failure looks like", () => {
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

test("no read site asks systemd directly, which is how this defect arrived", () => {
  // WHAT INJECTION CANNOT SEE. Every arm above holds `unitIsHealthy` and `showUnit` to their contracts,
  // and all of them stay green against a NEW reader written straight onto execFileSync — which is
  // exactly what happened: the writers were repaired, and two reads sat one screen away untouched.
  const src = readFileSync(CONNECT, "utf8");
  const direct = src.split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /execFileSync\(\s*"systemctl"/.test(line));
  // TWO SPELLINGS OF ONE FACT, and the named one is now the definition. `CAPTURE_STDERR` in
  // shared/systemd-failure.mjs IS `stdio: ["ignore", "ignore", "pipe"], encoding: "utf8"` — the arm
  // below holds it to that, so widening here cannot be satisfied by a constant that stopped piping.
  // Matching only the literal made this guard fire on a call that had lost nothing.
  const captures = (line) => /stdio: \["ignore", "ignore", "pipe"\]/.test(line) || /\.\.\.CAPTURE_STDERR/.test(line);
  const wrapped = direct.filter(({ line }) => captures(line) && /env: userBusEnv\(\)/.test(line));
  const bare = direct.filter((d) => !wrapped.includes(d));
  assert.deepEqual(bare.map((d) => d.n), [],
    "a `systemctl` call in this file neither goes through `showUnit` nor carries the derived bus and "
    + "captured stderr itself. That is the shape the third criterion names "
    + `found, one screen from where it was repaired: ${bare.map((d) => `${d.n}: ${d.line.trim()}`).join(" | ")}`);
  assert.ok(direct.length >= 2,
    "the `systemctl` writers have gone from this file, so this arm is watching nothing");
  // And the wrapper itself is the only other way in.
  assert.equal((src.match(/run\("systemctl"/g) ?? []).length, 1,
    "there is more than one wrapped runner, so `showUnit` is no longer the single read authority");
});

test("the constant the guard above accepts by name really does pipe stderr", () => {
  // The guard one arm up now accepts `...CAPTURE_STDERR` as proof a call captures systemd's words. That
  // is only true while the constant says so, and a constant is exactly the thing that can be edited
  // somewhere else. Held to its value here, so the two cannot drift apart silently.
  assert.deepEqual(CAPTURE_STDERR, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
    "CAPTURE_STDERR no longer captures stderr, so every call site spelled with it is discarding the "
    + "one thing a reader needs — and the source guard above is reading it as compliant");
});

test("the raise says what a half-finished connect already wrote", () => {
  // The health read fires AFTER the units are placed, so a reader who hits it needs the same
  // half-applied inventory every other failure on this path gives them.
  const e = systemdFailure({ stderr: "Failed to connect to bus: No medium found" },
    { step: "health-check", unit: "clearotron-client-mcp.service" });
  assert.match(e.message, /HALF APPLIED/);
  assert.match(e.message, /clearotron doctor/, "the reader is not told what can tell them which half stands");
});

// ── The three further defects the same drive found, on the same verb ────────────────────────────────

test("the plan and the mint read ONE install, not two", () => {
  // The defect: the plan asked the install's ENV FILE whether a signing secret existed and said yes;
  // `mintToken` then read `process.env` and threw "TRADEMARK_MCP_TOKEN_SECRET unset" about a secret
  // that IS set. On a hosted install that is the ordinary case — the installer writes the file and the
  // operator's shell never exported anything — and the failure lands AFTER the units are placed.
  const envFile = "CLEAROTRON_WORK_DIR=/var/lib/clearotron\nTRADEMARK_MCP_TOKEN_SECRET=from-the-file\n";
  const io = { exists: () => true, read: () => envFile };
  assert.equal(secretForMint({ shellEnv: {}, envPath: "/x/.env", ...io }), "from-the-file",
    "the mint has nothing to sign with on a box where the installer wrote the secret and the shell did not");
  assert.equal(secretForMint({ shellEnv: { TRADEMARK_MCP_TOKEN_SECRET: "from-the-shell" }, envPath: "/x/.env", ...io }), "",
    "a shell that already carries the secret must be left alone — supplying a second value here is how "
    + "a key gets signed with something the door does not verify against");
  // Quoting is how an env file is allowed to be written, and a quoted secret signed nothing before.
  for (const [line, want] of [['TRADEMARK_MCP_TOKEN_SECRET="quoted"', "quoted"],
                              ["TRADEMARK_MCP_TOKEN_SECRET='single'", "single"],
                              ["TRADEMARK_MCP_TOKEN_SECRET=  spaced  ", "spaced"]]) {
    assert.equal(secretForMint({ shellEnv: {}, envPath: "/x/.env", exists: () => true, read: () => `${line}\n` }), want);
  }
  assert.equal(secretForMint({ shellEnv: {}, envPath: "/x/.env", exists: () => true, read: () => "TRADEMARK_MCP_TOKEN_SECRET=\n" }), "",
    "an EMPTY row was read as a secret, which signs a key with nothing and reports success");
  assert.equal(secretForMint({ shellEnv: {}, envPath: "/x/.env", exists: () => false, read: () => "" }), "",
    "a file that is not there was read anyway");
});

test("a secret supplied for one mint does not outlive it", () => {
  // `connect` spawns systemctl. A secret left in the environment after the call that needed it reaches
  // every child from then on, which is a worse defect than the one being repaired.
  const env = { PATH: "/usr/bin" };
  assert.equal(withSecret("s3cret", () => env.TRADEMARK_MCP_TOKEN_SECRET, { env }), "s3cret");
  assert.equal(Object.hasOwn(env, "TRADEMARK_MCP_TOKEN_SECRET"), false, "the secret was left in the environment");

  const kept = { TRADEMARK_MCP_TOKEN_SECRET: "original" };
  withSecret("temporary", () => null, { env: kept });
  assert.equal(kept.TRADEMARK_MCP_TOKEN_SECRET, "original", "a value that was already there was overwritten");

  // ON A THROW TOO, which is the case that matters: minting is what throws.
  assert.throws(() => withSecret("s3cret", () => { throw new Error("mint failed"); }, { env }), /mint failed/);
  assert.equal(Object.hasOwn(env, "TRADEMARK_MCP_TOKEN_SECRET"), false,
    "a failed mint left the signing secret in the environment of every process spawned afterwards");
});

test("a loopback address is never called reachable from outside", () => {
  // The paragraph above this branch says a wrong answer in this direction is the dangerous one: an
  // operator told their door is loopback-only stops thinking about who else can reach it. The claim was
  // made from the VARIABLE being non-empty, and a loopback value is a thing operators set.
  const plan = { possible: true, blockers: [], settings: {}, route: "public-http", steps: [] };
  const said = (publicAddress) => describeChange(plan, { applied: true, publicAddress }).join(" ");
  for (const addr of ["http://127.0.0.1:18822", "http://localhost:18822", "http://[::1]:18822"]) {
    const text = said(addr);
    assert.equal(/IS reachable from outside this machine/.test(text), false,
      `${addr} was announced as reachable from outside this machine`);
    assert.match(text, /this machine talking to itself/,
      `${addr} produced no honest sentence at all — silence would be safe, a wrong claim is not`);
  }
  assert.match(said("https://clients-mcp.example.com/mcp"), /IS reachable from outside this machine/,
    "a genuinely public address stopped being announced, which is the opposite over-correction");
});
