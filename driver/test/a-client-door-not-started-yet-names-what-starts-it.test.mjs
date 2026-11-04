// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLIENT DOOR NOT STARTED YET NAMES WHAT STARTS IT.
//
// Right after setup, before the first `clearotron start`, doctor told a newcomer that the client door was
// not set up, that `clearotron start` writes both of its halves, and that "since the 2026-09-03 ruling" an
// install places them, so the install "did not finish" (measured on a fresh install of a beta, 2026-11-04).
// The install had finished. A dated ruling means nothing to a reader. And a plain `clearotron start` writes
// neither half: it runs the door as one of its own children. Only `clearotron start --background` installs
// the service and writes the setting.
//
// The control is a door that is half configured: that one IS a door something began and did not finish,
// and it is still reported as a problem with its own remedy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clientDoorState, describeDoorState, CLIENT_DOOR_UNIT } from "../../shared/client-door.mjs";

const CMDS = { closeCmd: "CLOSE-CMD", startCmd: "START-CMD", connectCmd: "CONNECT-CMD" };
const fresh = (listening) => clientDoorState({ env: {}, unitDir: "/nowhere", exists: () => false, active: null, listening });

test("a fresh install's door is not called an unfinished install, and the sentence names what starts it", () => {
  // FALSE and NULL both: nothing answered, or nobody could ask. Neither is a door that answers.
  for (const listening of [false, null]) {
    const said = describeDoorState(fresh(listening), CMDS);
    assert.equal(said.level, "info", `a door nobody has started yet is a fault (listening=${listening})`);
    assert.doesNotMatch(said.text, /did not finish|ruling|\d{4}-\d{2}-\d{2}/,
      `the sentence still calls a fresh install unfinished, or cites a dated ruling:\n${said.text}`);
    assert.doesNotMatch(said.text, /\bbox\b/i, `the sentence uses an internal word:\n${said.text}`);
    assert.doesNotMatch(said.text, /`START-CMD` writes/,
      `the sentence says the foreground start writes the service and the setting, which it does not:\n${said.text}`);
    assert.match(said.text, /`START-CMD` starts it/, `the sentence does not say which command starts the door:\n${said.text}`);
    assert.match(said.text, /`START-CMD --background` sets up both/,
      `the sentence does not say which command installs the service and the setting:\n${said.text}`);
    // The two measured facts stay: which halves are missing.
    assert.match(said.text, new RegExp(`${CLIENT_DOOR_UNIT.replace(/\./g, "\\.")} is not installed`));
    assert.match(said.text, /account access \(CLIENT_MCP_ACCOUNT_ACCESS\) is off/);
  }
});

test("the control: a half-configured door is still a problem, and still says how to finish it", () => {
  const half = describeDoorState(clientDoorState({ env: { CLIENT_MCP_ACCOUNT_ACCESS: "1" }, unitDir: "/nowhere",
    exists: () => false, active: null, listening: false }), CMDS);
  assert.equal(half.level, "problem");
  assert.match(half.text, /HALF configured/);
  assert.match(half.text, /CONNECT-CMD/);
});
