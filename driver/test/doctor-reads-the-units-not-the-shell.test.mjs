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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unitEnvironment, unitValue, couldNotDetermine } from "../unit-environment.mjs";
import { handRunEnv } from "./drive-env.mjs";   // — the drive names the two variables that would make it read no file at all

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");

// ── THE PURE HALF: three-valued, and the third value is the one that matters ────────────────────────

test("a name the units carry reads as SET, and one they do not carry reads as UNSET", () => {
  const units = [{ name: "u.service", text: "EnvironmentFile=/etc/x.env\n" }];
  const r = unitEnvironment({ units, readEnvFile: () => "PORTAL_MCP_URL=http://127.0.0.1:18790\n" });
  assert.equal(r.known, true);
  assert.deepEqual(unitValue(r, "PORTAL_MCP_URL"), { state: "set", value: "http://127.0.0.1:18790", why: null });
  assert.equal(unitValue(r, "NOT_THERE").state, "unset",
    "a name genuinely absent from a file we DID read is a real finding and must stay reportable");
});

test("an unreadable REQUIRED environment file is UNKNOWN — never the 'unset' that reads as a fault", () => {
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

test("an OPTIONAL missing file is not a hole, but an UNRESOLVED specifier is", () => {
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

test("%h expands to the unit's home, and later assignments win as systemd applies them", () => {
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

test("no units at all is UNKNOWN, and says so in words a reader can act on", () => {
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

function doctor(home, extraEnv = {}) {
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
      env: handRunEnv({ HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...extraEnv }, {}),
    });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
}

const UNITS = await (async () => {
  const { BACKGROUND_UNITS } = await import(pathToFileURL(join(REPO, "bin", "start.mjs")).href);
  return BACKGROUND_UNITS;
})();

const GOOD_ENV = [
  "PORTAL_MCP_URL=http://127.0.0.1:18790",
  "CLIENT_MCP_ACCOUNT_ACCESS=1",
].join("\n") + "\n";

test("doctor run from a shell with NOTHING set does not report the units' values as missing", () => {
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
    assert.match(r.out, /Start-button path/, "the start-button path section should still be reported");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── THE REGISTER, READ WHERE THE SERVICES READ IT ───────────────────────────────────────────────────────
//
// Measured on the test instance: the env file the units read named the register, its key and the research
// key, knockout runs used that register the same day, and doctor in a fresh terminal said "no register is
// selected", one screen above "nothing a search is refused for is missing from the units' environment".
// The register section read the shell. These arms hold it to the units, and to the order-time check.
const REGISTER_NAMES = ["CLEAROTRON_DATABASE=clarivate", "CLARIVATE_API_KEY=fixture-key", "PERPLEXITY_API_KEY=fixture-key"];
const REGISTERED_ENV = GOOD_ENV + REGISTER_NAMES.join("\n") + "\n";
/** One section of doctor's report: from its heading to the next. */
const sectionOf = (out, heading) => (out.split(`\n  ${heading}\n`)[1] ?? "").split(/\n  (?=[A-Z])/)[0];
/** The order-time check's own line, which reads the units through the same reader. */
const orderTimeOf = (out) => sectionOf(out, "Will a search run?");

test("a register the units carry is reported from the units' environment, in a shell with nothing set", () => {
  const home = installedHome(REGISTERED_ENV);
  try {
    const r = doctor(home);
    // THE FLOOR: the order-time check read the units, so this doctor took the hosted path, and the lines
    // below are about the units rather than about a file this command happened to find.
    assert.match(orderTimeOf(r.out), /the units' environment/, `the fixture did not reach the hosted path:\n${r.out}`);
    const register = sectionOf(r.out, "Register provider");
    assert.match(register, /clarivate — .*\(the units' environment\)/, `the register was not read from the units:\n${register}`);
    assert.match(register, /CLARIVATE_API_KEY present \(the units' environment\)/);
    assert.doesNotMatch(r.out, /no register is selected/, "the units name a register and doctor said none was selected");
    assert.match(sectionOf(r.out, "Research provider"), /PERPLEXITY_API_KEY present \(the units' environment\)/);
    assert.doesNotMatch(orderTimeOf(r.out), /CLEAROTRON_DATABASE|CLARIVATE_API_KEY/, "and the order-time check agrees");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE CONTROL — with no units, a register in the process environment is reported from there", () => {
  const home = mkdtempSync(join(tmpdir(), "f34-bare-"));
  try {
    const r = doctor(home, Object.fromEntries(REGISTER_NAMES.map((l) => l.split("="))));
    assert.match(sectionOf(r.out, "Register provider"), /clarivate — .*\(environment\)/, r.out);
    assert.doesNotMatch(r.out, /no register is selected/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE PLANT — units that name no register are reported as selecting none, and both lines say so", () => {
  const home = installedHome(GOOD_ENV);
  try {
    // A register in the SHELL only: the services will not see it, so it must not rescue the report.
    const r = doctor(home, { CLEAROTRON_DATABASE: "" });
    assert.match(sectionOf(r.out, "Register provider"), /no register is selected/, r.out);
    assert.match(orderTimeOf(r.out), /refused until[\s\S]*CLEAROTRON_DATABASE/, "the order-time check names the same absence");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("units whose environment cannot be read are a could-not-look for the register, never an absence", () => {
  const home = installedHome(REGISTERED_ENV);
  try {
    for (const u of UNITS) writeFileSync(join(home, ".config", "systemd", "user", u), "[Service]\nEnvironmentFile=/nonexistent/clearotron.env\nExecStart=/bin/true\n");
    const r = doctor(home);
    const register = sectionOf(r.out, "Register provider");
    assert.match(register, /could not be read[\s\S]*not judged here/, register);
    assert.doesNotMatch(register, /no register is selected/, "a register this command could not look for was reported absent");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE PLANT — with the value genuinely absent from the units, doctor DOES report it", () => {
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

test("an ops token the UNITS carry is not reported missing to a reader with an empty shell", () => {
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

test("THE PLANT — with the token genuinely absent from the units, doctor still says so", () => {
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

test("units installed and lingering OFF is named, with the command that fixes it", () => {
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

test("lingering ON is reported and manufactures no finding", () => {
  const home = installedHome(GOOD_ENV);
  try {
    const r = doctorWithLoginctl(home, "#!/bin/sh\necho Linger=yes\n");
    assert.match(r.out, /lingering is on/, "the ordinary hosted box must read as fine");
    assert.doesNotMatch(r.out, /lingering is OFF/, "and carry none of the finding above");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a loginctl that cannot answer is a could-not-look, never an 'it is off'", () => {
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
// `{"role":"staff"}` for the local user. The units' file carried the setting that then admitted
// `<user>@localhost` — a staff-domain rule, since deleted — so the running service admitted it on every
// request. Doctor read the CLI's own `.env`, where that setting did not appear.
//
// What admits a person now is their own entry in the grants file, and the units' file is still the only
// place that names WHICH grants file — so the property is unchanged: the fact that admits the local user
// is reachable only through the file the units load.
//
// BOTH DIRECTIONS ARE DRIVEN HERE, and that pairing is the acceptance rather than a courtesy: a fix
// that only satisfies the quiet direction is indistinguishable from deleting the check, and the check
// guards a real incident — 2026-08-26, a leftover setting locked the owner out of his own portal while
// every surface looked healthy.

const LOCKOUT = /NOBODY can use this portal/;

function homeWithGrants(envLines, grants = { tenants: {} }) {
  const home = installedHome("");   // units + an ~/.env we are about to rewrite
  const grantsPath = join(home, "grants.json");
  writeFileSync(grantsPath, JSON.stringify(grants));
  writeFileSync(join(home, ".env"),
    [...envLines, `CLEAROTRON_ACCESS_FILE=${grantsPath}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  return home;
}

test("a local install whose UNITS name a grants file admitting its user is not reported as locking everybody out", () => {
  // The measured shape, in today's terms: local sign-in, one user, no tenant rows, and the entry that
  // admits them in a grants file only the units' environment names.
  const home = homeWithGrants([
    "PORTAL_AUTH_MODE=local",
    "PORTAL_LOCAL_USER=op@localhost",
  ], { tenants: {}, people: { "op@localhost": { run: true, manage: true, everything: true } } });
  try {
    const r = doctor(home);
    assert.doesNotMatch(r.out, LOCKOUT,
      `doctor claimed nobody can use a portal whose grants file gives op@localhost access to everything:\n${r.out}`);
    assert.match(r.out, /op@localhost is one of them/,
      `the local user's own entry was not recognised, so the quiet result above measured nothing:\n${r.out}`);
    // AND IT SAYS WHERE IT LOOKED. The old text disclaimed itself in a `·` — "what THIS environment
    // implies, not what the running service serves" — directly above the ✗. A caveat does not repair a
    // false claim standing beside it; naming the file does, because the reader can check it.
    assert.match(r.out, /the file the units load/,
      "the door section does not say which file it read, so a reader cannot tell a real lockout from a misread file");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE PLANT — a genuine lockout still fires, or the fix is a silencer", () => {
  // Nobody in the grants file, and a mode that is not local: nothing here admits anybody, and this is
  // the 2026-08-26 incident's shape. If this goes quiet the check has been deleted, not repaired.
  const home = homeWithGrants(["PORTAL_AUTH_MODE=auth-proxy"]);
  try {
    const r = doctor(home);
    assert.match(r.out, LOCKOUT,
      `the real lockout stopped being reported — the fix silenced the check rather than aiming it:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a local install whose grants file admits nobody is still reported — the mode is not an exemption", () => {
  // The fix originally filed was "exempt PORTAL_AUTH_MODE=local". It would have been wrong twice: the
  // variable was absent from the file being read, AND a local install genuinely admitting nobody is a
  // real lockout. `portal-service.mjs:4461-4462` states the rule — a local sign-in produces an email
  // and nothing else, and the roster still decides.
  const home = homeWithGrants(["PORTAL_AUTH_MODE=local", "PORTAL_LOCAL_USER=op@localhost"]);
  try {
    const r = doctor(home);
    assert.match(r.out, LOCKOUT,
      `a local install that admits nobody was let through on its mode alone:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("units whose environment cannot be read withhold the verdict rather than guessing it", () => {
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
// zephyr, aurora and generic throughout. The last `✓` endorsed the wrong half.

function hostedHomeWith(envLines, extraDirs = []) {
  const home = installedHome("");
  for (const d of extraDirs) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(home, ".env"), [...envLines, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  return home;
}

test("a units-configured customer store is not reported as the bundled demo roster", () => {
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

test("THE CONTRADICTION — no line calls the variable unset while another reports its value", () => {
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

test("custom instructions the UNITS name are not reported as nothing configured", () => {
  const home = hostedHomeWith([], ["doctrine"]);
  writeFileSync(join(home, ".env"),
    [`CLEAROTRON_INSTRUCTIONS_DIR=${join(home, "doctrine")}`, ...GOOD_ENV.trim().split("\n")].join("\n") + "\n");
  try {
    const r = doctor(home);
    assert.match(r.out, /the services read custom instructions this process does not/,
      `doctor claims this install overrides nothing while the units name an overlay:\n${r.out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the agreement line says which environment it compared, and what it cannot catch", () => {
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

// ── WHICH ACCOUNTS DOCTOR SAYS THIS INSTALL HAS ─────────────────────────────────────────────────────
//
// Measured on a fresh 0.2.2 install: `1 brand owner(s) resolve here: demo-brand-owner (DEMO DATA)`, and
// `generic` named nowhere. Both halves wrong from one list. The demo account ships, so it resolved; it
// was counted as an onboarded brand owner, so a reader was told they had a customer they had never
// onboarded — and was not told the name of the account their runs would actually be rated under.
//
// Three states, because they mean three different things to whoever is reading:
//   · the house default alone            — a clean install, and `generic` is the answer
//   · the house default plus the demo    — what a fresh install with the demo installed really has
//   · an onboarded roster                — brand owners, with the demo named separately if present
//
// The demo account keeps its DEMO DATA marking wherever it appears. That marking is not decoration: a
// real clearance under it is refused at the admission wall, and an operator should meet that here.


/**
 * A profile store built from the product's OWN profiles, with `name`/`demoData` overridden per arm.
 *
 * A hand-built stub does not load: the schema requires real fields, and a refusal to load prints no
 * accounts line at all — which every assertion below would then read as silence rather than as a
 * refusal. Copying the shipped file makes the fixture a profile rather than a shape that looks like one.
 */
function profileStore(home, sub, entries) {
  const dir = join(home, sub);
  mkdirSync(dir, { recursive: true });
  const base = JSON.parse(readFileSync(join(HERE, "..", "profiles", "generic.json"), "utf8"));
  for (const [key, over] of Object.entries(entries))
    writeFileSync(join(dir, `${key}.json`), JSON.stringify({ ...base, ...over }));
  return dir;
}

const accountsLine = (out) => out.split("\n").find((l) => /generic|brand owner\(s\)/.test(l)) ?? "";

test("a store with only the house default names `generic`, and claims no brand owner", () => {
  const home = installedHome(GOOD_ENV);
  const store = profileStore(home, "profiles-house", { generic: { name: "Generic" } });
  // THROUGH THE CHILD ENV, NOT THE .env FILE. The suite runner sets `CLEAROTRON_NO_ENV_FILE` for every
  // child, so a store written into `.env` here is ignored and the BUNDLED roster answers instead — and
  // two of these three arms passed on it before this line existed, for a reason neither of them names.
  const out = doctor(home, { CLEAROTRON_CUSTOMERS_DIR: store }).out;
  assert.match(out, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "doctor did not resolve the store this arm wrote — every assertion below would be about the bundled roster");
  assert.doesNotMatch(out, /the roster did not load/,
    "the roster refused to load, so no accounts line printed at all and every assertion below is about silence");
  const line = accountsLine(out);
  assert.match(line, /`generic` is the account this install rates under/,
    "a clean install must name the account its runs are rated under");
  assert.doesNotMatch(line, /brand owner\(s\) resolve here/,
    "and must not report a brand owner nobody onboarded");
});

test("the demo account is named as the demo's, never counted as an onboarded owner", () => {
  const home = installedHome(GOOD_ENV);
  const store = profileStore(home, "profiles-demo", {
    generic: { name: "Generic" }, "demo-brand-owner": { name: "Demo Brand Owner", demoData: true },
  });
  // THROUGH THE CHILD ENV, NOT THE .env FILE. The suite runner sets `CLEAROTRON_NO_ENV_FILE` for every
  // child, so a store written into `.env` here is ignored and the BUNDLED roster answers instead — and
  // two of these three arms passed on it before this line existed, for a reason neither of them names.
  const out = doctor(home, { CLEAROTRON_CUSTOMERS_DIR: store }).out;
  assert.match(out, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "doctor did not resolve the store this arm wrote — every assertion below would be about the bundled roster");
  assert.doesNotMatch(out, /the roster did not load/,
    "the roster refused to load, so no accounts line printed at all and every assertion below is about silence");
  const line = accountsLine(out);
  assert.match(line, /`generic` is the account this install rates under/, "generic is still the answer");
  // RULING 2026-09-08 hides the BUNDLED demo account from a fresh install. It does not reach into
  // a store somebody configured: this arm writes its own store, so the account in it is that
  // deployment's choice and stays disclosed. The two readings of `demoData` are told apart by the layer
  // the file is in, not by the flag — see the gate in profiles.mjs.
  assert.match(line, /demo-brand-owner/, "an account this deployment's own store carries is still disclosed");
  assert.match(line, /DEMO DATA/, "…with the marking that says a real clearance under it is refused");
  assert.doesNotMatch(line, /1 brand owner\(s\) resolve here/,
    "the exact sentence measured on a fresh install: a customer the reader never onboarded");
});

test("where a demo account DOES resolve, doctor still names it and marks it", () => {
  // The grant half. The two arms above prove doctor stops naming an account this install does not
  // offer; on their own they are satisfied by a doctor that can no longer name a demo account at all,
  // which would hide it from the one context where it is real. Asked for by environment, the way the
  // demo asks.
  const home = installedHome(GOOD_ENV);
  const store = profileStore(home, "profiles-demo-asked", {
    generic: { name: "Generic" }, "demo-brand-owner": { name: "Demo Brand Owner", demoData: true },
  });
  const out = doctor(home, { CLEAROTRON_CUSTOMERS_DIR: store, CLEAROTRON_DEMO_PROFILES: "1" }).out;
  assert.match(out, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "doctor did not resolve the store this arm wrote — the assertions below would be about the bundled roster");
  const line = accountsLine(out);
  assert.match(line, /demo-brand-owner/, "the demo's own account, where it genuinely resolves");
  assert.match(line, /DEMO DATA/, "…with the marking that says a real clearance under it is refused");
  assert.doesNotMatch(line, /1 brand owner\(s\) resolve here/,
    "still never counted as somebody's onboarded customer");
});

test("an onboarded owner IS counted, and the demo is named beside it rather than among it", () => {
  const home = installedHome(GOOD_ENV);
  const store = profileStore(home, "profiles-both", {
    generic: { name: "Generic" }, "demo-brand-owner": { name: "Demo Brand Owner", demoData: true },
    acme: { name: "Acme" },
  });
  // THROUGH THE CHILD ENV, NOT THE .env FILE. The suite runner sets `CLEAROTRON_NO_ENV_FILE` for every
  // child, so a store written into `.env` here is ignored and the BUNDLED roster answers instead — and
  // two of these three arms passed on it before this line existed, for a reason neither of them names.
  const out = doctor(home, { CLEAROTRON_CUSTOMERS_DIR: store }).out;
  assert.match(out, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "doctor did not resolve the store this arm wrote — every assertion below would be about the bundled roster");
  assert.doesNotMatch(out, /the roster did not load/,
    "the roster refused to load, so no accounts line printed at all and every assertion below is about silence");
  const line = accountsLine(out);
  assert.match(line, /1 brand owner\(s\) resolve here: acme/, "one real owner, counted as one");
  assert.match(line, /demo-brand-owner/, "the demo named separately, not counted among the owners");
  assert.doesNotMatch(line, /2 brand owner\(s\)/, "the demo must never be counted into the total");
});

// ── SAVED SEARCHES, JUDGED BY THE PORTAL'S OWN RULE ─────────────────────────────────────────────────────
//
// The portal switches saved searches off when the store sits outside the repository its saves commit to,
// and says so only in its boot log. Doctor passed that install; it names it now, and a store holding a
// file that cannot be read, which fails every company's saved searches the same way.

test("doctor names why saved searches are off, and says when they are on", () => {
  const home = installedHome(GOOD_ENV);
  const repo = mkdtempSync(join(tmpdir(), "rec-repo-"));
  const outside = mkdtempSync(join(tmpdir(), "rec-outside-"));
  const inside = join(repo, "recipes");
  mkdirSync(inside, { recursive: true });
  try {
    const off = doctor(home, { CLEAROTRON_RECIPES_DIR: outside, RECIPE_REPO_ROOT: repo }).out;
    assert.match(off, /saved searches are OFF/, `doctor said nothing about a store the portal refuses:\n${off}`);
    assert.match(off, /CLEAROTRON_RECIPES_DIR/, "the line names the variable to fix");
    // THE CONTROL: the same repository with the store inside it. The refusal goes, and the store is named.
    const on = doctor(home, { CLEAROTRON_RECIPES_DIR: inside, RECIPE_REPO_ROOT: repo }).out;
    assert.doesNotMatch(on, /saved searches are OFF/, "a store inside its repository is not off");
    assert.match(on, /saved searches are read from/);
    // And a file that cannot be read, in a store that is otherwise fine, is named as that.
    mkdirSync(join(inside, "acme"));
    writeFileSync(join(inside, "acme", "broken.json"), "{ not json");
    const bad = doctor(home, { CLEAROTRON_RECIPES_DIR: inside, RECIPE_REPO_ROOT: repo }).out;
    assert.match(bad, /saved searches cannot be read from/, `doctor passed a store that fails to load:\n${bad}`);
  } finally { for (const d of [home, repo, outside]) rmSync(d, { recursive: true, force: true }); }
});

// THE CONTROL FOR THE LOCAL-INSTALL ARMS BELOW. This home has units, so it is a hosted box, where a store
// nobody named really is off. With no units the services are `clearotron start`'s children, and it hands
// every one of them a store, so there "off" would be false.
test("doctor says saved searches are off when no store is named", () => {
  const home = installedHome(GOOD_ENV);
  try {
    assert.match(doctor(home).out, /saved searches are off: CLEAROTRON_RECIPES_DIR is not set/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── A LOCAL INSTALL: NO UNITS, THE SERVICES ARE `clearotron start`'s CHILDREN ─────────────────────────

const { startPaths } = await import(pathToFileURL(join(REPO, "bin", "start.mjs")).href);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("with no units, doctor reports the store `clearotron start` hands the portal, never off", () => {
  const home = mkdtempSync(join(tmpdir(), "local-home-"));
  try {
    const never = doctor(home).out;
    assert.match(never, /saved searches switch on at the first `clearotron start`/,
      `an install that has never started was not told where its saved searches will come from:\n${never}`);
    assert.doesNotMatch(never, /saved searches are off|saved searches cannot be read/i,
      "a store that does not exist yet is neither off nor broken");

    // Started before `start` recorded the store in the env file: the layout is there, the file names nothing.
    const handed = startPaths({ env: {}, base: join(home, "trademark") });
    mkdirSync(join(handed.configStore, ".git"), { recursive: true });
    mkdirSync(handed.recipes, { recursive: true });
    const started = doctor(home).out;
    assert.match(started, new RegExp(`saved searches are read from ${esc(handed.recipes)} — where \`clearotron start\` puts them, `
      + `and saves are committed in ${esc(handed.configStore)}`),
      `doctor did not report the store start hands its children:\n${started}`);
    assert.doesNotMatch(started, /saved searches are off/i, "THE REPORTED CASE: a working store was reported off");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("with no units, a store the env file names is where profiles resolve from, said once", () => {
  const home = mkdtempSync(join(tmpdir(), "local-home-"));
  const envFile = join(home, ".config", "clearotron", ".env");
  try {
    const store = profileStore(home, "profiles-local", { acme: { name: "Acme" } });
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, `CLEAROTRON_CUSTOMERS_DIR=${store}\n`);
    const out = doctor(home).out;
    assert.match(out, new RegExp(`the services resolve profiles from ${esc(store)} \\(your environment file\\)`),
      `doctor did not report the store the env file names:\n${out}`);
    assert.doesNotMatch(out.split("this command's own process")[0], /THE BUNDLED DEMO ROSTER/,
      "THE REPORTED CASE: the variable read as set on one line and unset on the next");

    // THE CONTROL: nothing names a store, and the bundled roster is then the one answer.
    rmSync(envFile);
    const bare = doctor(home).out;
    assert.match(bare, /THE BUNDLED DEMO ROSTER, because CLEAROTRON_CUSTOMERS_DIR is unset/);
    assert.doesNotMatch(bare, /the services resolve profiles from/, "no store is named, so none is reported");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
