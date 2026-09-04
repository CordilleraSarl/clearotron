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
      env: { HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" },
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
