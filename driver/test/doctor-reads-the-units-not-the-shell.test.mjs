// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F34. `clearotron doctor` stated facts about the units while reading the
// operator's shell, and BOTH problems it reported on a correctly-running install were false. One told
// the owner that a working install returns 502 on every clearance, minutes after `--background` had
// written the value it said was missing.
//
// The acceptance criterion is an arm that runs doctor from a shell with NONE of the variables set,
// against units that have them all, and finds no reported problem. That criterion quantifies — "no
// problem" is a claim about a whole class — so it is paired here with a PLANT: the same units with one
// genuinely-false value, asserting doctor reports THAT ONE and only that one. Without the plant, a
// doctor that reported zero problems for an unrelated reason would pass the criterion while measuring
// nothing, which is the shape this suite has been bitten by before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unitEnvironment, unitValue, couldNotDetermine } from "../unit-environment.mjs";
import { handRunEnv } from "./drive-env.mjs";   // — the drive names the two variables that would make it read no file at all

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");

// ── THE PURE HALF: three-valued, and the third value is the one that matters ────────────────────────

test("2176-F34 a name the units carry reads as SET, and one they do not carry reads as UNSET", () => {
  const units = [{ name: "u.service", text: "EnvironmentFile=/etc/x.env\n" }];
  const r = unitEnvironment({ units, readEnvFile: () => "PORTAL_MCP_URL=http://127.0.0.1:18790\n" });
  assert.equal(r.known, true);
  assert.deepEqual(unitValue(r, "PORTAL_MCP_URL"), { state: "set", value: "http://127.0.0.1:18790", why: null });
  assert.equal(unitValue(r, "NOT_THERE").state, "unset",
    "a name genuinely absent from a file we DID read is a real finding and must stay reportable");
});

test("2176-F34 an unreadable REQUIRED environment file is UNKNOWN — never the 'unset' that reads as a fault", () => {
  // The whole finding in one arm. The units exist, the file they require cannot be read, and the
  // tempting answer — "the name is not set" — is an assertion about the world made by a reader that
  // failed. Every name must come back unknown, including ones we happened to see in another file.
  const units = [{ name: "u.service", text: "EnvironmentFile=/etc/x.env\n" }];
  const r = unitEnvironment({ units, readEnvFile: () => null });
  assert.equal(r.known, false, "a hole in the picture is not a whole picture");
  assert.equal(unitValue(r, "PORTAL_MCP_URL").state, "unknown");
  assert.match(couldNotDetermine("PORTAL_MCP_URL", r), /could not determine/);
  // The claim to avoid is the ASSERTION "<name> is not set", not the word "missing" — the sentence
  // says "this is not a report that it is missing", which is the disclaimer, not the assertion.
  assert.doesNotMatch(couldNotDetermine("PORTAL_MCP_URL", r), /PORTAL_MCP_URL is (not set|missing)/,
    "the could-not-look sentence must not assert the absence it exists to avoid asserting");
});

test("2176-F34 an OPTIONAL missing file is not a hole, but an UNRESOLVED specifier is", () => {
  const optional = unitEnvironment({
    units: [{ name: "u.service", text: "Environment=A=1\nEnvironmentFile=-/etc/gone.env\n" }],
    readEnvFile: () => null });
  assert.equal(optional.known, true, "systemd was told it could do without this file, so we can too");
  assert.equal(unitValue(optional, "A").value, "1");

  // %h with no home to expand it, and an unimplemented specifier, are both READER gaps. Passing the
  // literal through would open nothing and report every name absent — F34 arriving by a second route.
  for (const text of ["EnvironmentFile=%h/.env\n", "EnvironmentFile=%t/x.env\n"]) {
    const r = unitEnvironment({ units: [{ name: "u.service", text }], readEnvFile: () => "A=1\n" });
    assert.equal(r.known, false, `${text.trim()} must not silently read as an absence`);
    assert.match(r.why, /unresolved systemd specifier/);
  }
});

test("2176-F34 %h expands to the unit's home, and later assignments win as systemd applies them", () => {
  const r = unitEnvironment({
    units: [{ name: "u.service", text: "EnvironmentFile=%h/.env\nEnvironment=B=from-unit C=3\n" }],
    readEnvFile: (p) => (p === "/srv/example/.env" ? "A=1\nB=from-file\n" : null),
    home: "/srv/example" });
  assert.equal(r.known, true, r.why ?? "");
  assert.equal(unitValue(r, "A").value, "1");
  assert.equal(unitValue(r, "C").value, "3");
  assert.equal(unitValue(r, "B").value, "from-unit",
    "Environment= appears after EnvironmentFile= here, and systemd lets the later assignment win");
});

test("2176-F34 no units at all is UNKNOWN, and says so in words a reader can act on", () => {
  const r = unitEnvironment({ units: [] });
  assert.equal(r.known, false);
  assert.equal(unitValue(r, "ANY").state, "unknown");
  assert.match(r.why, /no units are installed/);
});

// ── THE ACCEPTANCE ARM, AND ITS PLANT ───────────────────────────────────────────────────────────────

/** A home with the background units installed, all reading %h/.env, and that file's contents. */
function installedHome(envText) {
  const home = mkdtempSync(join(tmpdir(), "f34-home-"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const u of UNITS)
    writeFileSync(join(unitDir, u), `[Service]\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n`);
  writeFileSync(join(home, ".env"), envText);
  return home;
}

/** The exact interpreter running this suite, and nothing that happens to sit beside it. */
const NODE_BIN = (() => {
  const d = mkdtempSync(join(tmpdir(), "f34-node-"));
  symlinkSync(process.execPath, join(d, "node"));
  return d;
})();

function doctor(home) {
  try {
    // THE SHELL IS EMPTY ON PURPOSE. This is the criterion: none of the names doctor reports on are in
    // this environment, and all of them are in the units'. A doctor that reads the shell fails here.
    const out = execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: "pipe", timeout: 120_000,
      // ── NAMED, NOT MERELY ABSENT (drive-env-check) ────────────────────────────────────────────────
      //
      // `CLEAROTRON_NO_ENV_FILE=1` — which the suite runner sets for every child — and `INVOCATION_ID`,
      // inherited from any systemd unit above the run including a CI job, each make the command ignore
      // the file this test just wrote and fall back to built-in defaults, with no error. A drive that
      // does not say which of them it holds is a drive that can silently stop reading its own fixture.
      //
      // `handRunEnv` over an EMPTY base rather than over `process.env`, which is what it usually takes:
      // the empty shell is this file's whole criterion — none of the names doctor reports on may be in
      // this environment — so inheriting the real one would defeat the arms while satisfying the guard.
      env: handRunEnv({ HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
    });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}

const UNITS = await (async () => {
  const { BACKGROUND_UNITS } = await import(join(REPO, "bin", "start.mjs"));
  return BACKGROUND_UNITS;
})();

const GOOD_ENV = [
  "PORTAL_MCP_URL=http://127.0.0.1:18790",
  "CLIENT_MCP_ACCOUNT_ACCESS=1",
].join("\n") + "\n";

test("2176-F34 doctor run from a shell with NOTHING set does not report the units' values as missing", () => {
  assert.ok(UNITS.length > 0, "the background unit set should not be empty — this arm needs units to install");
  const home = installedHome(GOOD_ENV);
  try {
    const r = doctor(home);
    // The two sentences the owner was handed, verbatim enough to catch a reword that keeps the defect.
    assert.doesNotMatch(r.out, /PORTAL_MCP_URL is not set for the units/,
      `doctor claimed a value was unset for the units while ~/.env sets it:\n${r.out}`);
    assert.doesNotMatch(r.out, /the client door is HALF configured/,
      `doctor reported a half-configured door while ~/.env configures it:\n${r.out}`);
    // And it must not have quietly gone silent instead: the value it read has to appear somewhere.
    assert.match(r.out, /Submit lane/, "the submit lane section should still be reported");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2176-F34 THE PLANT — with the value genuinely absent from the units, doctor DOES report it", () => {
  // Why this arm exists: the one above asserts an absence of output, and an absence of output is what
  // a doctor that stopped checking would also produce. This plants the real fault — units installed,
  // env file present, PORTAL_MCP_URL genuinely not in it — and requires the message back. The pair is
  // what makes either one worth its green.
  const home = installedHome("CLIENT_MCP_ACCOUNT_ACCESS=1\n");
  try {
    const r = doctor(home);
    assert.match(r.out, /PORTAL_MCP_URL is not set for the units/,
      `the value really is absent from the units and doctor stayed quiet — the check is not looking:\n${r.out}`);
    // ...and only that one: the door value IS set, so its message must not ride along.
    assert.doesNotMatch(r.out, /the client door is HALF configured/,
      `doctor reported the door as half-configured while ~/.env sets its value:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 2196: THE SAME FAULT, ONE NAME OVER ─────────────────────────────────────────────────────────────
//
// PORTAL_MCP_URL was read from the units and PORTAL_OPS_TOKEN from `process.env`, three lines apart in
// the same block. `start --background` writes the token into the file the units load and exports it
// into nobody's shell, so `doctor` afterwards said "no ops token is set ... The Start button fails at
// the door" while the door answered 200. Same shape as F34 above, which is why it belongs beside it.

const ENV_WITH_TOKEN = [
  "PORTAL_MCP_URL=http://127.0.0.1:18790",
  "CLIENT_MCP_ACCOUNT_ACCESS=1",
  "PORTAL_OPS_TOKEN=v1.not-a-real-token.for-this-arm",
].join("\n") + "\n";

test("2196 an ops token the UNITS carry is not reported missing to a reader with an empty shell", () => {
  const home = installedHome(ENV_WITH_TOKEN);
  try {
    const r = doctor(home);
    assert.doesNotMatch(r.out, /no ops token is set/,
      "the token is in the file the units load and in no shell — reporting it missing is an assertion "
      + "about the units made from the operator's environment, and it told the owner a working install "
      + "fails at the door");
    assert.doesNotMatch(r.out, /The Start button fails at the door/, r.out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2196 THE PLANT — with the token genuinely absent from the units, doctor still says so", () => {
  // Without this, the arm above is satisfied by a doctor that stopped checking the token at all.
  const home = installedHome(GOOD_ENV);   // PORTAL_MCP_URL, deliberately no PORTAL_OPS_TOKEN
  try {
    const r = doctor(home);
    assert.match(r.out, /no ops token is set/,
      "a genuinely half-wired lane must still be reported — the fix is reading the right place, not "
      + "reporting less");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 2192 F9: LINGERING, THE PREREQUISITE THAT FAILS WITHOUT WRITING ANYTHING ────────────────────────
//
// `--background` installs USER units. Without lingering, systemd tears this account's user manager down
// at logout and the units stop — no unit failure, no journal line, no port. The box reads healthy until
// nobody is logged in. `start --background` refuses when the manager is UNREACHABLE, but a manager that
// answers in this session says nothing about whether it survives the session.
//
// `loginctl` is shimmed rather than trusted, so both answers are driven on any host — the runner's own
// lingering state must not decide what these arms measure.

/** A doctor run whose `loginctl` is a script we wrote, placed ahead of the real one on PATH. */
function doctorWithLoginctl(home, script) {
  const shim = mkdtempSync(join(tmpdir(), "f9-shim-"));
  writeFileSync(join(shim, "loginctl"), script, { mode: 0o755 });
  try {
    const out = execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: "pipe", timeout: 120_000,
      env: { HOME: home, PATH: [shim, NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" },
    });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  finally { rmSync(shim, { recursive: true, force: true }); }
}

test("2192-F9 units installed and lingering OFF is named, with the command that fixes it", () => {
  const home = installedHome(GOOD_ENV);
  try {
    const r = doctorWithLoginctl(home, "#!/bin/sh\necho Linger=no\n");
    assert.match(r.out, /lingering is OFF/,
      "this is the prerequisite that fails without writing anything — if doctor does not say it, nothing does");
    assert.match(r.out, /loginctl enable-linger/, "and a finding a reader cannot act on is half a finding");
    assert.match(r.out, /no unit failure and no journal line/,
      "the silent failure mode is the point: a reader who is told only 'lingering is off' does not know "
      + "what it costs them");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2192-F9 lingering ON is reported and manufactures no finding", () => {
  const home = installedHome(GOOD_ENV);
  try {
    const r = doctorWithLoginctl(home, "#!/bin/sh\necho Linger=yes\n");
    assert.match(r.out, /lingering is on/, "the ordinary hosted box must read as fine");
    assert.doesNotMatch(r.out, /lingering is OFF/, "and carry none of the finding above");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2192-F9 a loginctl that cannot answer is a could-not-look, never an 'it is off'", () => {
  const home = installedHome(GOOD_ENV);
  try {
    const r = doctorWithLoginctl(home, "#!/bin/sh\necho 'Failed to connect to bus: No medium found' >&2\nexit 1\n");
    assert.match(r.out, /could not tell whether lingering is on/,
      "reporting a prerequisite as unmet because the question could not be asked is the same lie in the "
      + "other direction");
    assert.doesNotMatch(r.out, /lingering is OFF/, r.out);
    assert.doesNotMatch(r.out, /^Failed to connect to bus/m,
      "and the shim's raw stderr must not reach the report any more than systemctl's did");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 226 · THE DOOR SECTION IS THE THIRD SECTION THAT READ THE WRONG FILE ─────────────────
//
// F34 fixed two sections that claimed facts about the units while reading the operator's shell. The
// door check was a third, and it made the loudest claim in the command: a hard ✗ reading "NOBODY can
// use this portal … Any identity that signs in is refused at the door on every page", present
// indicative, about the live box, with a non-zero exit.
//
// MEASURED 2026-09-06 on a healthy packaged install: that ✗ printed while `GET /portal/api/me` returned
// `{"role":"staff"}` for the local user. The units' file carried `PORTAL_STAFF_DOMAINS=localhost` and
// the identity was `<user>@localhost`, so the running service admitted it as staff on every request.
// Doctor read the CLI's own `.env`, where that name does not appear.
//
// BOTH DIRECTIONS ARE DRIVEN HERE, and that pairing is the acceptance rather than a courtesy: a fix
// that only satisfies the quiet direction is indistinguishable from deleting the check, and the check
// guards a real incident — 2026-08-26, a leftover PORTAL_STAFF_DOMAINS locked the owner out of his own
// portal while every surface looked healthy.

const LOCKOUT = /NOBODY can use this portal/;

function homeWithGrants(envLines, grants = { tenants: {} }) {
  const home = installedHome("");   // units + an ~/.env we are about to rewrite
  const grantsPath = join(home, "grants.json");
  writeFileSync(grantsPath, JSON.stringify(grants));
  writeFileSync(join(home, ".env"),
    [...envLines, `CLEAROTRON_ACCESS_FILE=${grantsPath}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  return home;
}

test("226 a local install whose UNITS name a staff domain is not reported as locking everybody out", () => {
  // The measured shape: local sign-in, one user, no guest-list rows, and the staff domain that admits
  // them living in the file the units load and nowhere else.
  const home = homeWithGrants([
    "PORTAL_AUTH_MODE=local",
    "PORTAL_STAFF_DOMAINS=localhost",
    "PORTAL_LOCAL_USER=op@localhost",
  ]);
  try {
    const r = doctor(home);
    assert.doesNotMatch(r.out, LOCKOUT,
      `doctor claimed nobody can use a portal whose units admit op@localhost as staff:\n${r.out}`);
    // AND IT SAYS WHERE IT LOOKED. The old text disclaimed itself in a `·` — "what THIS environment
    // implies, not what the running service serves" — directly above the ✗. A caveat does not repair a
    // false claim standing beside it; naming the file does, because the reader can check it.
    assert.match(r.out, /the file the units load/,
      "the door section does not say which file it read, so a reader cannot tell a real lockout from a misread file");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("226 THE PLANT — a genuine lockout still fires, or the fix is a silencer", () => {
  // No staff domain, no rows, and a mode that is not local: nothing here admits anybody, and this is
  // the 2026-08-26 incident's shape. If this goes quiet the check has been deleted, not repaired.
  const home = homeWithGrants(["PORTAL_AUTH_MODE=auth-proxy"]);
  try {
    const r = doctor(home);
    assert.match(r.out, LOCKOUT,
      `the real lockout stopped being reported — the fix silenced the check rather than aiming it:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("226 a local install with NO staff domain and no rows is still reported — the mode is not an exemption", () => {
  // The fix originally filed was "exempt PORTAL_AUTH_MODE=local". It would have been wrong twice: the
  // variable was absent from the file being read, AND a local install genuinely admitting nobody is a
  // real lockout. `portal-service.mjs:4438` states the rule — a local sign-in produces an email and
  // nothing else, and the roster still decides.
  const home = homeWithGrants(["PORTAL_AUTH_MODE=local", "PORTAL_LOCAL_USER=op@localhost"]);
  try {
    const r = doctor(home);
    assert.match(r.out, LOCKOUT,
      `a local install that admits nobody was let through on its mode alone:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("226 units whose environment cannot be read withhold the verdict rather than guessing it", () => {
  // Every name resolves empty when the read fails, which is indistinguishable from a box that has
  // configured nothing — and would print the loudest ✗ in this command on no evidence at all. This is
  // F34's own lesson applied to the section F34 did not reach.
  const home = installedHome("");
  try {
    const unitDir = join(home, ".config", "systemd", "user");
    for (const u of UNITS)
      writeFileSync(join(unitDir, u), `[Service]\nEnvironmentFile=%h/gone.env\nExecStart=/bin/true\n`);
    const r = doctor(home);
    assert.doesNotMatch(r.out, LOCKOUT,
      `doctor asserted a lockout from a read that failed:\n${r.out}`);
    assert.match(r.out, /could not be read|not judged here/,
      "the failure to look is not stated, so silence here is indistinguishable from a clean box");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 223 · ONE RUN REPORTED THE SAME VARIABLE SET AND UNSET, AND CALLED PRODUCTION A DEMO ────────────
//
// Measured on the 0.1.6 production box:
//
//   ✓ CLEAROTRON_CUSTOMERS_DIR=/home/clearotron/trademark/config/profiles (.env)
//   · profiles resolve from …/node_modules/clearotron/driver/profiles — THE BUNDLED DEMO ROSTER,
//     because CLEAROTRON_CUSTOMERS_DIR is unset.
//   · 1 brand owner(s) resolve here: demo-brand-owner (DEMO DATA)
//   ✓ the settings surface serves the same store as the runs (…/driver/profiles)
//
// Every line honest about its own source and none of them saying what it was. The deployment served
// celsius, microsoft and generic throughout. The last `✓` endorsed the wrong half.

function hostedHomeWith(envLines, extraDirs = []) {
  const home = installedHome("");
  for (const d of extraDirs) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, ".env"), [...envLines, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  return home;
}

test("223 a units-configured customer store is not reported as the bundled demo roster", () => {
  const home = hostedHomeWith([], ["profiles"]);
  writeFileSync(join(home, ".env"),
    [`CLEAROTRON_CUSTOMERS_DIR=${join(home, "profiles")}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  try {
    const r = doctor(home);
    assert.match(r.out, /the services resolve profiles from/,
      `doctor never says what the SERVICES resolve, so a hosted box only gets this process's answer:\n${r.out}`);
    assert.ok(!/THE BUNDLED DEMO ROSTER/.test(r.out.split("this command's own process")[0] ?? r.out),
      `the demo-roster verdict is still printed as the box's answer on a configured deployment:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("223 THE CONTRADICTION — no line calls the variable unset while another reports its value", () => {
  // This is the acceptance in the issue's own words. A reader cannot act on a report that says both.
  //
  // THE FIXTURE HAS TO CARRY BOTH FILES, and the first cut of this arm did not — so it passed against
  // the unfixed code by never reaching the state it was named after. The production report's `(.env)`
  // provenance tag is the tell: the value was in the CLI's own file, which is what `effective()` reads
  // and reports, while the resolution read this process's environment and found nothing. Writing only
  // the units' file reproduces neither half.
  const home = hostedHomeWith([], ["profiles"]);
  const store = join(home, "profiles");
  writeFileSync(join(home, ".env"), [`CLEAROTRON_CUSTOMERS_DIR=${store}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), `CLEAROTRON_CUSTOMERS_DIR=${store}\n`);
  try {
    const r = doctor(home);
    const reportsValue = /CLEAROTRON_CUSTOMERS_DIR=/.test(r.out);
    const callsItUnset = /because CLEAROTRON_CUSTOMERS_DIR is unset/.test(r.out);
    assert.ok(!(reportsValue && callsItUnset),
      `doctor reports CLEAROTRON_CUSTOMERS_DIR as both set and unset in one run:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("223 a doctrine overlay the UNITS name is not reported as nothing configured", () => {
  const home = hostedHomeWith([], ["doctrine"]);
  writeFileSync(join(home, ".env"),
    [`CLEAROTRON_INSTRUCTIONS_DIR=${join(home, "doctrine")}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  try {
    const r = doctor(home);
    assert.match(r.out, /the services read a doctrine overlay this process does not/,
      `doctor claims this install overrides nothing while the units name an overlay:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("223 the agreement line says which environment it compared, and what it cannot catch", () => {
  // The old `✓` read "the settings surface serves the same store as the runs" — a claim a reader takes
  // as "production is configured". Both sides derive from one variable, so it cannot catch two
  // environments disagreeing, which is exactly what had gone wrong above it.
  const home = hostedHomeWith([], ["profiles"]);
  writeFileSync(join(home, ".env"),
    [`CLEAROTRON_CUSTOMERS_DIR=${join(home, "profiles")}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  try {
    const r = doctor(home);
    if (/resolve to one store/.test(r.out)) {
      assert.match(r.out, /they share a variable/,
        "the agreement line still implies it verified two environments agree, which it cannot do");
    } else {
      assert.ok(!/serves the same store as the runs/.test(r.out),
        `the old unqualified agreement claim is still printed:\n${r.out}`);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
