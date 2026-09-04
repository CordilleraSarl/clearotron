// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the documented install placed two units, and neither was one a server needs.
//
// `render-units.mjs --apply` iterated the units carrying an `@PLACEHOLDER@`, because its job is
// resolving what configuration cannot reach. The generic units take `${VAR}` from their EnvironmentFile
// and carry no placeholder, so a renderer correctly skipped them — and the documented hosted install
// therefore placed a retired queue watcher and a bridge no box runs under that name, exiting 0 having
// written two files. It read as an install that worked.
//
// The arms below are mostly about what must NOT be installed, because that is the half a green run
// cannot show you: an installer that places three correct units and one wrong one looks identical to a
// correct one until the wrong one starts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_INSTALL_SET, ON_DEMAND_UNITS } from "../../shared/server-units.mjs";
import { SERVER_UNITS, BACKGROUND_UNITS } from "../../bin/start.mjs";
import { trackedUnits } from "../systemd/render-units.mjs";
import { UNIT_INVENTORY } from "../unit-inventory.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDER = join(REPO, "driver", "systemd", "render-units.mjs");

// ── WHAT AN INSTALL THIS RUNS ON LOOKS LIKE ──────────────────────────────────
//
// `CLEAROTRON_ACCESS_FILE` joined this fixture on 2026-09-03 and it is not a convenience: since settled
// point 2 the install set contains the CLIENT DOOR, which refuses to start without a guest list to
// scope a client identity against, so the installer refuses to place it without one. INSTALL.md §8
// names that variable among the four an operator sets at install time and the deployment env example
// ships the row, so this fixture is the documented install and not a special case — the arm below
// drives the box that has NOT set it.
const STARTED_ENV = "CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\nCLEAROTRON_WORK_DIR=/var/lib/clearotron\n"
  + "CLEAROTRON_ACCESS_FILE=/var/lib/clearotron/grants.json\n";

/** Run the real CLI against a scratch destination. Nothing here touches this box's own unit directory. */
function apply(envBody = STARTED_ENV) {
  const dir = mkdtempSync(join(tmpdir(), "render-units-"));
  const env = join(dir, "env");
  writeFileSync(env, envBody);
  const dest = join(dir, "dest");
  const out = execFileSync(process.execPath, [RENDER, "--apply", "--dest", dest, "--env", env],
    { encoding: "utf8", timeout: 60_000 });
  return { dir, dest, env, out, placed: readdirSync(dest).sort() };
}

test("1863 the documented install places the units a server needs", () => {
  const { dir, placed } = apply();
  try {
    assert.deepEqual(placed, [...SERVER_INSTALL_SET].sort(),
      "the install placed a different set than the one this repo states a server runs");
    assert.ok(placed.includes("clearotron-worker.service"),
      "the queue drainer is not installed, which is the defect this issue was filed for: the box comes "
      + "up with its portal and its door and nothing draining, and reports itself healthy");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1863 it places NEITHER the retired watcher NOR the bridge that was installed instead", () => {
  // The two units the old path actually wrote. This is the arm that would have caught the defect, and
  // it is stated as a negative because the positive was never wrong — two files really were written.
  const { dir, placed } = apply();
  try {
    for (const wrong of ["prelim-driver.path", "courtlistener-mcp.service"]) {
      assert.ok(!placed.includes(wrong),
        `${wrong} was installed. It carries a placeholder, which is why the old path chose it — being `
        + "renderable is not a reason to run something");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("2148 the client door IS placed now, and the superseded ruling is named", () => {
  // SUPERSEDED 2026-09-03, and this arm is rewritten rather than deleted so the change is legible.
  //
  // Until today this asserted the opposite, citing the owner's 2026-08-31 "On demand is fine": starting
  // the door WAS the consent that opened client-account access, so an installer placing it would have
  // made that consent meaningless. That reasoning was right under that ruling.
  //
  // He superseded it knowingly (, settled point 2): the door auto-starts and THE
  // PER-ACCOUNT KEY IS THE GATE, not whether a process runs. A door with no key issued refuses
  // everything — the same protection by a mechanism that does not depend on a reader finding a verb.
  const { dir, placed } = apply();
  try {
    assert.ok(placed.includes("clearotron-client-mcp.service"),
      "the client door is not installed, so a reader who logs in has nothing to connect to — which is "
      + "the state the 2148 ruling exists to end");
    assert.deepEqual(ON_DEMAND_UNITS, [],
      "the on-demand exclusion list is non-empty again. It is kept EMPTY rather than deleted so that "
      + "'no unit is currently in that class' stays a claim a reader can check; a unit appearing here "
      + "needs a ruling behind it, not a commit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1863 a unit with no placeholder is COPIED, byte for byte, not skipped", () => {
  // The whole cause in one property: the generic units need no rendering, and needing no rendering used
  // to mean not being installed.
  const { dir, dest } = apply();
  try {
    const name = "clearotron-worker.service";
    assert.equal(readFileSync(join(dest, name), "utf8"), readFileSync(join(REPO, "driver", "systemd", name), "utf8"),
      "a placeholder-free unit was altered on the way in");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("1863 the install list names only units this tree ships", () => {
  // A list naming a missing file installs nothing and reads as done — the absence-as-a-pass shape the
  // inventory's own ratchets refuse. The CLI refuses too; this catches it before anyone runs it.
  const shipped = new Set(trackedUnits().map((u) => u.name));
  for (const u of [...SERVER_INSTALL_SET, ...ON_DEMAND_UNITS]) {
    assert.ok(shipped.has(u), `${u} is named for install and is not in the tree`);
  }
});

test("1863 the DETECTOR and the INSTALLER are separate lists, and must stay separate", () => {
  // They are one word apart and answer opposite questions. `SERVER_UNITS` recognises what IS on a box —
  // so it deliberately still names a retired unit, because a box carrying the old posture is just as
  // much a server. `SERVER_INSTALL_SET` places what SHOULD be. Merging them makes one answer wrong, and
  // the tempting merge is the wrong direction: a detector that dropped the retired name would let
  // `clearotron start` run a second portal beside a deployed one.
  assert.ok(SERVER_UNITS.includes("prelim-driver.service"),
    "the detector stopped recognising the retired posture, so a box running it is no longer seen as a server");
  assert.ok(!SERVER_INSTALL_SET.includes("prelim-driver.service"),
    "the installer would place a retired unit");
  assert.notDeepEqual([...SERVER_UNITS].sort(), [...SERVER_INSTALL_SET].sort(),
    "the two lists are identical, which means one of the two questions is now being answered wrongly");
});

test("1863 --background and the documented install place the SAME set", () => {
  // One authority, two callers. A list kept in two places is how the documented install came to place
  // two units while `--background` placed three.
  assert.deepEqual([...BACKGROUND_UNITS].sort(), [...SERVER_INSTALL_SET].sort(),
    "the two install paths disagree about what a server runs");
});

test("1863 every unit named for install is declared in the inventory", () => {
  // The inventory is what a reader consults to learn what a unit is for. An installed unit it does not
  // declare is exactly the condition unit-inventory.mjs was written to make impossible.
  const declared = new Set(UNIT_INVENTORY.flatMap((u) => u.tracked ?? []));
  for (const u of [...SERVER_INSTALL_SET, ...ON_DEMAND_UNITS]) {
    assert.ok(declared.has(u), `${u} is installed by a documented path and no inventory entry claims it`);
  }
});

// ── the submit lane the installed units read ───────────────────────────────────

import { mcpOriginFor, laneValuesFor } from "../../shared/lane-address.mjs";
import { mergeEnvFile } from "../../shared/env-file-merge.mjs";

/** Run the CLI against a scratch dest with a starting env body, and return what the env file became. */
function applyWithEnv(startingBody) {
  const dir = mkdtempSync(join(tmpdir(), "render-lane-"));
  const env = join(dir, "env");
  // The access file rides on every one of these bodies for the reason STARTED_ENV gives: without it the
  // installer refuses before it reaches the lane question these arms are about.
  writeFileSync(env, `CLEAROTRON_ACCESS_FILE=/var/lib/clearotron/grants.json\n${startingBody}`);
  execFileSync(process.execPath, [RENDER, "--apply", "--dest", join(dir, "dest"), "--env", env],
    { encoding: "utf8", timeout: 60_000 });
  const after = readFileSync(env, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return after;
}

test("2128 the install SETS the submit lane, so the portal it just placed has an engine to call", () => {
  const after = applyWithEnv("CLEAROTRON_CHECKOUT_DIR=/opt/c\n");
  assert.match(after, /^PORTAL_MCP_URL=http:\/\/127\.0\.0\.1:\d+$/m,
    "the installer placed the portal and left it with no engine-door address — which is the box the "
    + "owner met: a 502 on submit, a dead Stop control, and every health surface green");
});

test("2128 an EMPTY row is filled, because that is what the deployment example ships", () => {
  // THE CASE THAT MATTERS MOST, not an edge. An operator copying the deployment env example has exactly
  // this line. My first version treated it as present, left it blank, and reported "already carries
  // the address" — the original defect, with a reassuring sentence over it.
  const after = applyWithEnv("CLEAROTRON_CHECKOUT_DIR=/opt/c\nPORTAL_MCP_URL=\n");
  assert.match(after, /^PORTAL_MCP_URL=http:\/\/127\.0\.0\.1:\d+$/m, "the shipped empty row was left empty");
  assert.equal(after.match(/^PORTAL_MCP_URL=/gm).length, 1,
    "a second assignment was appended under the first — last-wins, silently");
});

test("2128 a value the OPERATOR set is never overwritten", () => {
  const after = applyWithEnv("PORTAL_MCP_URL=http://operator-chose:9999\n");
  assert.match(after, /^PORTAL_MCP_URL=http:\/\/operator-chose:9999$/m, "an operator's own address was replaced");
  assert.equal(after.match(/^PORTAL_MCP_URL=/gm).length, 1, "a second assignment was added beside theirs");
});

test("2128 the origin carries no path — the portal's client appends /mcp itself", () => {
  // A doubled path is a 404 at submit time and nothing wrong anywhere else. This is why the expression
  // has one author rather than being written at each call site.
  const origin = mcpOriginFor({ port: 18821 });
  assert.equal(new URL(origin).pathname, "/", "the origin carries a path, so the client will double it");
  assert.doesNotMatch(origin, /\/mcp/);
  assert.equal(laneValuesFor({ ports: { mcp: 18821 } }).PORTAL_MCP_URL, origin, "the two disagree about the same value");
});

test("2128 a nonsense port is refused rather than composed into an address", () => {
  for (const bad of [0, 70000, "18821", null, undefined, 1.5]) {
    assert.throws(() => mcpOriginFor({ port: bad }), /port must be/, `port ${JSON.stringify(bad)} was accepted`);
  }
});

test("2128 mergeEnvFile still never writes an empty value, and still names its writer", () => {
  // The move to shared/ must not have changed the contract every existing caller relies on.
  const { text, added } = mergeEnvFile("A=1\n", { B: "", C: null, D: "d" }, { by: "`a test`" });
  assert.deepEqual(added, ["D"], "an empty or nullish value was written as a blank assignment");
  assert.match(text, /# Added by `a test`\./, "the writer is not named, so a reader cannot tell what put the line there");
  assert.match(text, /^A=1$/m, "an existing line was disturbed");
});

// ── the client door's own settings, written by the same install ────────────────
//
// Settled point 2 put the client door in the install set. `http-server-client.mjs` refuses to start
// without CLIENT_MCP_TOKEN_ONLY=1 — it otherwise demands an OIDC audience and a CF Access team, which a
// local install has neither of — and token-only in turn requires the fence, the signing secret and the
// allow-list. So an install that places the unit and not these settings hands systemd a unit it has
// already decided cannot run, and `Restart=on-failure` makes that a crash loop rather than one error.
// The ruling forbids exactly that outcome in its own words: "never a unit failing at boot."

import { enablePlan } from "../../shared/client-door.mjs";

/** The env file as the installer left it, parsed the way systemd reads it. */
function appliedEnv(envBody = STARTED_ENV) {
  const { dir, env, out } = apply(envBody);
  const after = readFileSync(env, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { after, out, values: Object.fromEntries(after.split("\n")
    .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()])) };
}

test("2148 the install writes every setting the client door refuses to start without", () => {
  const { values } = appliedEnv();
  // NOT A LIST RESTATED HERE. The expectation comes from `enablePlan`, which is the same authority
  // `clearotron connect` calls — a second list in this file would go stale against the door the day
  // somebody adds a seventh name, and go stale silently, because a list that agrees with itself passes.
  const plan = enablePlan({ env: { TRADEMARK_MCP_TOKEN_SECRET: "x" }, address: null, identity: null,
    issuesKey: false, checkoutDir: "/opt/clearotron", unitEnvHasSecret: true,
    accessFile: "/var/lib/clearotron/grants.json" });
  assert.ok(plan.possible, `the reference plan refused, so this arm compares nothing: ${JSON.stringify(plan.blockers)}`);
  const want = plan.settings;
  for (const name of Object.keys(want)) {
    assert.ok(String(values[name] ?? "").trim(),
      `${name} is not in the installed env file — the door's unit was placed and it refuses to start without this`);
  }
  // The two that decide whether the process comes up at all, by value and not merely by presence.
  assert.equal(values.CLIENT_MCP_TOKEN_ONLY, "1",
    "without token-only the door demands an OIDC audience and an access team, and a local install has neither");
  assert.equal(values.CLIENT_MCP_ACCOUNT_ACCESS, "1",
    "token-only requires the account principal; with the fence off the door refuses to start");
});

test("2148 the installer and `connect` derive the SAME settings from the same port", () => {
  // The compliance this arm proves is "do not re-derive the six names". Both paths call one function,
  // so the only way they can disagree is if one of them started writing its own — and this is what
  // catches that, because a hand-written copy passes every other arm in this file.
  const base = { env: { TRADEMARK_MCP_TOKEN_SECRET: "x", CLIENT_MCP_HTTP_PORT: "18999" },
    address: null, checkoutDir: "/opt/clearotron", unitEnvHasSecret: true,
    accessFile: "/var/lib/clearotron/grants.json" };
  const installer = enablePlan({ ...base, identity: null, issuesKey: false });
  const connect = enablePlan({ ...base, identity: "lawyer@acme.example" });
  assert.ok(installer.possible && connect.possible, "one of the two plans refused, so this compares nothing");
  assert.deepEqual(installer.settings, connect.settings,
    "the installer and connect write different settings for the same door on the same port");
  // And the plans differ where they SHOULD: one mints, one does not.
  assert.ok(!installer.steps.some((s) => s.id === "key"), "the installer's plan orders a key it will not mint");
  assert.ok(connect.steps.some((s) => s.id === "key"), "connect's plan no longer orders the key it exists to issue");
});

test("2148 the allow-list follows the operator's port, not the default", () => {
  // A DIFFERENT MEMBER OF THE SET than the arm above pins by value, deliberately: CLIENT_MCP_ALLOWED_HOSTS
  // is the one that fails silently. It arms DNS-rebinding protection and names host:port, so a port
  // written in one place and an allow-list in another produce a door that starts and turns every request
  // away — which reads as a dead door, not as a misconfiguration.
  const { values } = appliedEnv(`${STARTED_ENV}CLIENT_MCP_HTTP_PORT=18999\n`);
  assert.equal(values.CLIENT_MCP_HTTP_PORT, "18999", "the operator's port was overwritten");
  assert.equal(values.CLIENT_MCP_ALLOWED_HOSTS, "127.0.0.1:18999,localhost:18999",
    "the allow-list names a different port than the door listens on — every request would be refused");
});

test("2148 a box with NO guest list is refused, and not one unit is placed", () => {
  // The install must not be completable on a box where the door cannot come up. Refusing before any
  // write is what the units-missing branch already does, and this is the same rule for the same reason:
  // a half-installed box reports itself installed.
  const dir = mkdtempSync(join(tmpdir(), "render-noaccess-"));
  const env = join(dir, "env");
  const dest = join(dir, "dest");
  writeFileSync(env, "CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\n");
  const before = readFileSync(env, "utf8");
  let status = null, stderr = "";
  try {
    execFileSync(process.execPath, [RENDER, "--apply", "--dest", dest, "--env", env],
      { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { status = e.status; stderr = String(e.stderr ?? ""); }
  try {
    assert.equal(status, 1, "the installer completed on a box where the client door cannot start");
    assert.match(stderr, /no access file/i, "the refusal does not name what is missing");
    assert.match(stderr, /clearotron start/, "the refusal names no remedy, so the operator is told to stop and nothing else");
    // BOTH READERS, because the deployment env example ships this row EMPTY and the hosted operator who
    // copied it is the likeliest person to see this message. The blockers' own remedy is written for the
    // laptop reader `connect` serves; a refusal that names only their way out strands the other one.
    assert.match(stderr, /INSTALL\.md/, "the refusal points a hosted operator at nothing they can edit");
    // NOTHING WRITTEN, both halves. An absence here is the finding: a dest directory that was never
    // created is the proof, and an env file that gained a fence with no door behind it would be worse
    // than either.
    assert.ok(!existsSync(dest), "unit files were placed by a run that refused");
    assert.equal(readFileSync(env, "utf8"), before, "the env file was written by a run that refused");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("2148 the signing secret is generated, announced, and never printed", () => {
  // Q4, owner-confirmed 2026-09-03 ("on q4 yes"). Generate-if-absent, and the act says so in the output
  // — an installer that begins minting cryptographic material announces it rather than leaving it to be
  // discovered in a file. What must NOT be in the output is the value.
  const { out, values } = appliedEnv();
  assert.match(out, /GENERATED a signing secret/, "the installer minted a secret without saying so");
  const secret = values.TRADEMARK_MCP_TOKEN_SECRET;
  assert.match(secret ?? "", /^[0-9a-f]{64}$/, "no 32-byte signing secret was written, so the door cannot verify a key");
  assert.ok(!out.includes(secret), "the signing secret was printed to stdout");
});

test("2148 a live secret is never replaced — every key already issued is signed with it", () => {
  const mine = "a".repeat(64);
  const { values } = appliedEnv(`${STARTED_ENV}TRADEMARK_MCP_TOKEN_SECRET=${mine}\n`);
  assert.equal(values.TRADEMARK_MCP_TOKEN_SECRET, mine,
    "the installer replaced a live signing secret, which invalidates every key already issued");
});
