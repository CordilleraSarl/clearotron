// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Setup's ending took back what setup had just said. With no AI chosen it printed "No AI chosen. The demo
// works without one; a real search needs one, so run setup again when you're ready.", and with no register
// "Set it by re-running `clearotron install`"; then it ended "Setup finished. Nothing here needs running
// again." Its summary of what the install has listed the register, the keys and the folders, and left out
// the AI. And its heading, and the case-law note under it, called the reader's computer by our own word for one.
//
// WHY THIS READS THE SOURCE. The closing screen is composed inside the wizard, behind its terminal check,
// with no seam to call; onboard-wizard.test.mjs reads the same screen the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NO_AI_CHOSEN } from "../../bin/onboard.mjs";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "onboard.mjs"), "utf8");
const AT = SRC.indexOf('style.bold("Setup finished.")');
/** From the closing line to the end of the summary's list. */
const SUMMARY = AT < 0 ? "" : SRC.slice(AT, SRC.indexOf("]) say(", AT));
/** From the closing line to the end of the wizard: everything the ending prints. */
const ENDING = AT < 0 ? "" : SRC.slice(AT, SRC.indexOf("} catch (e) {", AT));

test("the anchors are where this file looks for them", () => {
  // A moved anchor must stop the tests below, not hand them an empty string that every match fails on.
  assert.ok(AT > 0, 'the closing line `style.bold("Setup finished.")` is not in bin/onboard.mjs');
  assert.ok(SUMMARY.includes("stateLine("), "the summary's list no longer follows the closing line");
});

test("setup says nothing needs running again only when an AI and a register are both chosen", () => {
  assert.match(NO_AI_CHOSEN, /run setup again/, "the sentence the ending must agree with");
  const closing = SUMMARY.slice(0, SUMMARY.indexOf("\n"));
  assert.match(closing, /\$\{aiChosen && registerSelected \? " Nothing here needs running again\." : ""\}/,
    `the ending says nothing needs running again after setup has said to run it again: ${closing}`);
  assert.match(SRC.slice(Math.max(0, AT - 800), AT), /const aiChosen = ENGINE_BINARIES\[candidate\.CLEAROTRON_AI\]\?\.product \?\? "";/,
    "the AI the ending reads is the one setup proved, by the name the engine question gives it");
});

test("the summary names the AI, set or not, and says what having none means", () => {
  const line = /stateLine\("AI", aiChosen, "([^"]*)"\)/.exec(SUMMARY);
  assert.ok(line, "the summary of what the install has leaves out the AI");
  assert.match(line[1], /demo works without one/, "the summary takes NO_AI_CHOSEN's words for what still works");
  assert.match(line[1], /real search needs one/, "and for what does not");
});

test("the ending calls the reader's computer an install, not by our own word for it", () => {
  const said = [...ENDING.matchAll(/say\((["`])(.*?)\1\)/g)].map((m) => m[2]);
  assert.ok(said.some((s) => s.includes("What this ")), "the summary's heading was not found among what the ending prints");
  assert.deepEqual(said.filter((s) => /\bbox\b/.test(s)), [], "a printed line calls the reader's computer by our own word for it");
});

test("setup sends the reader to re-run it, never to a page that cannot change a setting", () => {
  // The Installation settings page shows each setting's state; nothing on it can set one. Setup said to set the
  // register "there" twice, and the ending said "or on the Installation settings page".
  const said = [...SRC.matchAll(/(?:say|info|warn)\((["`])(.*?)\1\)/g)].map((m) => m[2]);
  assert.ok(said.some((s) => s.includes("Installation settings page says it too. Re-run setup when you have a credential.")),
    "the register step no longer says the page shows the gap, and to re-run setup");
  assert.deepEqual(said.filter((s) => /\bset (it|them) there\b|\bon the Installation settings page\b/.test(s)), [],
    "a printed line sends the reader to set something on the Installation settings page");
  assert.ok(ENDING.includes("Set it by re-running \\`${invocationPrefix()}clearotron install\\`.`"), "the ending's register line changed shape");
});

test("with no register chosen, the ending suggests the demo and no first real clearance", () => {
  // The closing lines suggested `run --job` a few lines above the warning that `run` will refuse at its door.
  const also = ENDING.indexOf("Also: ");
  assert.ok(also > 0, "the ending's Also line is not where this arm reads it");
  const block = ENDING.slice(ENDING.lastIndexOf("if (registerSelected) {", also), ENDING.indexOf("\n", ENDING.indexOf("} else say(", also)) + 1);
  assert.match(block, /^if \(registerSelected\) \{\n[^\n]*no model calls;`\)\}`\);\n[^\n]*run --job[^\n]*\n\s*\} else say\([^\n]*replays a finished report with no keys and no model calls\.`\)\}`\);/,
    `the first-clearance line is no longer printed only when a register is chosen: ${block}`);
});

test("setup's opening promises only what it does", () => {
  // A paid register key is written on the reader's word, unchecked: checking it would cost them. And the
  // organisation's name cannot be skipped.
  assert.ok(SRC.includes("Nothing is written until each credential you give has been checked, except a paid register key: checking it would cost you, so it is written on your word."));
  assert.ok(SRC.includes('subtitle: "one pass, and everything here but your organisation\'s name is skippable"'));
  assert.ok(!SRC.includes("every credential you give has been checked against the real service"), "the old promise is back");
});
