// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN INSTALL OF YOUR OWN IS NOT ASKED TO NAME ITSELF.
//
// After `clearotron start --background`, doctor warned a newcomer that no CLEAROTRON_BOX was set, so
// nothing below it could be read as a statement about this deployment (measured on a fresh install of a
// beta, 2026-11-04). The setting is undocumented, setup never writes it, the warning ended on an internal
// word, and it gave the reader nothing to do. Only the publisher's own deployments set it; on anyone
// else's machine nothing reads it but the health report.
//
// The line stays, because doctor cannot tell those deployments from a newcomer's background install and an
// unset name there must still be visible. It is an `·` now, in plain words, and says nothing needs doing.
// The control is the same units with the name set: the section still runs and still names it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handRunEnv } from "./drive-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");
const { BACKGROUND_UNITS: UNITS } = await import(pathToFileURL(join(REPO, "bin", "start.mjs")).href);

/** A home with the background units installed, all reading %h/.env, as `start --background` leaves it. */
function backgroundHome(envText) {
  const home = mkdtempSync(join(tmpdir(), "own-install-"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const u of UNITS) writeFileSync(join(unitDir, u), "[Service]\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n");
  writeFileSync(join(home, ".env"), envText);
  return home;
}

const NODE_BIN = (() => {
  const d = mkdtempSync(join(tmpdir(), "own-install-node-"));
  symlinkSync(process.execPath, join(d, "node"));
  return d;
})();

/** `clearotron doctor`, from an empty shell, so every value it reports comes from the units' file. */
function doctor(home) {
  try {
    return execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: "pipe", timeout: 120_000,
      env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
    });
  } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
}

test("an unset deployment name after `start --background` is said in plain words, with nothing to do", () => {
  assert.ok(UNITS.length > 0, "no background units to install, so this arm would measure a machine without them");
  const home = backgroundHome("PORTAL_AUTH_MODE=local\nPORTAL_MCP_URL=http://127.0.0.1:18790\n");
  try {
    const out = doctor(home);
    const line = out.split("\n").find((l) => l.includes("CLEAROTRON_BOX"));
    assert.ok(line, `the unset name is no longer said at all, which is not what this arm is about:\n${out}`);
    assert.match(line, /^ {2}· /, `an unset name on a machine of the reader's own is a warning:\n${line}`);
    assert.doesNotMatch(line.replace(/CLEAROTRON_BOX/g, ""), /\bbox\b/i, `the line still uses an internal word:\n${line}`);
    assert.doesNotMatch(line, /nothing below|statement about/, `the line still says the rest of the report cannot be trusted:\n${line}`);
    assert.match(line, /an install of your own leaves it unset/i, `the line does not say that this needs nothing doing:\n${line}`);
    assert.doesNotMatch(out, /\bprod\b|\bpreprod\b/, "the publisher's deployment names are offered to the reader");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the control: a name that is set is still read and named, so the plain line is the unset case", () => {
  const home = backgroundHome("PORTAL_AUTH_MODE=local\nCLEAROTRON_BOX=test\n");
  try {
    const out = doctor(home);
    assert.match(out, /names itself "test", from the units' environment/);
    assert.doesNotMatch(out, /an install of your own leaves it unset/i, "the unset sentence is printed whatever the file says");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
