// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real setup wizard in a terminal twice, with stand-in programs only
//
// A READER WHO DECLINES THE TEST TURN IS STILL SHOWN HOW TO SIGN IN.
//
// The quickstart says setup "shows you how to sign it in", and on a subscription setup showed the sign-in commands
// only after a turn that ran and failed. A reader who answered no to the test turn went straight to "Continue with
// no engine configured?" and never saw one. They now get the same lines a failed turn prints, in the same words,
// and then the question those lines name. Answering no to it goes on as a decline did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE, NO_TERMINAL as SKIP, MENU, ANY, CTRL_C, machine } from "./helpers/setup-terminal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROVE = "\\[Y/n\\] $";
const RETRY = "Run the turn again \\[y/N\\] $";
const WAITS = "setup waits in this terminal, so run the commands below in a second one:";

test("declining the turn on a subscription shows the sign-in, asks the retry, and a no goes on as before", { skip: SKIP }, () => {
  const m = machine({ claude: true });
  try {
    const out = m.setup([[MENU, "1\r"], [MENU, "\r"], [PROVE, "n\r"], [RETRY, "\r"], ["Continue with no engine configured\\? \\[Y/n\\] $", CTRL_C]]);
    assert.ok(out.includes(WAITS), `the failed turn's opening line is missing:\n${out}`);
    assert.match(out, /if it is signed out: .*, then answer yes to "Run the turn again"\./, `the sign-in command is missing:\n${out}`);
    assert.doesNotMatch(out, /Running one turn/, `the reader said no, and a turn ran:\n${out}`);
  } finally { m.done(); }
});

test("a yes to the retry after a decline runs the turn the reader now wants", { skip: SKIP }, () => {
  const m = machine({ claude: true });
  try {
    const out = m.setup([[MENU, "1\r"], [MENU, "\r"], [PROVE, "n\r"], [RETRY, "y\r"], [ANY, CTRL_C]]);
    assert.match(out, /Running one turn/, out);
    assert.match(out, new RegExp(`${CLAUDE.product} completed a turn`), out);
  } finally { m.done(); }
});

test("under a key or a cloud account there is no sign-in to show, and the decline is unchanged", () => {
  const src = readFileSync(join(HERE, "..", "..", "bin", "onboard.mjs"), "utf8");
  const at = src.indexOf("if (!await confirm(proveQuestion(");
  assert.ok(at > 0, "the proof question is not where this arm reads it");
  assert.match(src.slice(at, at + 900), /if \(authPick\.id === "subscription"\) \{\s*for \(const line of signInHandOff\(eng, bin, authPick\.id\)\.lines\) info\(line\);/,
    "the sign-in lines are no longer limited to a subscription");
});
