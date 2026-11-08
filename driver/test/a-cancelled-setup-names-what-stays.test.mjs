// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real setup wizard in a terminal five times, with stand-in programs only
//
// A CANCELLED SETUP SAYS WHAT STAYS ON THE MACHINE.
//
// Measured on a stranger install of 0.5.1-beta.0, 2026-11-07: Ctrl-C in setup printed "setup: cancelled.
// Nothing was written." By then setup had put its own copy under `~/.local`, and, after a yes, the AI's
// program into the engines folder. A test turn also leaves the AI program's own files. The settings file is
// only ever written at the end, so "No settings were written" is true; the rest of the line now names what
// stays, in the owner's words. "Nothing was written." is kept for
// the cancel where it is still true.
//
// DRIVEN AS A READER MEETS IT: the real wizard, in a terminal of its own (Python's `pty`, since Node has
// none), in a home of its own, on a PATH holding only stand-ins and the system's tools. Ctrl-C is the byte
// a terminal sends, so the cancel takes the path a reader's does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cancelledLine, whatSetupLeft } from "../../bin/onboard.mjs";
import { ownVersion } from "../../shared/permanent-install.mjs";
import { CLAUDE, NO_TERMINAL as SKIP, MENU, ANY, CTRL_C, machine } from "./helpers/setup-terminal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the cancel line names what setup left, in the owner's words", () => {
  const copy = { version: "0.5.1-beta.1", prefix: "/srv/reader/.local" };
  const engine = { vendor: "Anthropic", dir: "/srv/reader/.local/share/clearotron/engines" };
  assert.equal(cancelledLine({}), "cancelled. Nothing was written.");
  assert.equal(cancelledLine({ turnRan: true }), "cancelled. Clearotron wrote nothing; the AI program's test turn keeps its own files.");
  assert.equal(cancelledLine({ copy }), "cancelled. No settings were written. clearotron 0.5.1-beta.1 stays installed in /srv/reader/.local.");
  assert.equal(cancelledLine({ engine }), "cancelled. No settings were written. Anthropic's CLI stays installed in /srv/reader/.local/share/clearotron/engines.");
  assert.equal(cancelledLine({ copy, engine }), "cancelled. No settings were written. clearotron 0.5.1-beta.1 stays installed in /srv/reader/.local, and Anthropic's CLI in /srv/reader/.local/share/clearotron/engines.");
  assert.equal(cancelledLine({ copy, engine, turnRan: true }), "cancelled. No settings were written. clearotron 0.5.1-beta.1 stays installed in /srv/reader/.local, and Anthropic's CLI in /srv/reader/.local/share/clearotron/engines. The AI program's test turn keeps its own files.");
});

test("setup's two refusals after the engine step say what it left, in the same words", () => {
  const copy = { version: "0.5.2", prefix: "/srv/reader/.local" };
  const engine = { vendor: "Anthropic", dir: "/srv/reader/engines" };
  assert.equal(whatSetupLeft({}), null, "with nothing left, the refusals keep today's words");
  assert.equal(whatSetupLeft({ turnRan: true }), "Clearotron wrote nothing; the AI program's test turn keeps its own files.");
  assert.equal(whatSetupLeft({ copy, engine, turnRan: true }),
    "No settings were written. clearotron 0.5.2 stays installed in /srv/reader/.local, and Anthropic's CLI in /srv/reader/engines. The AI program's test turn keeps its own files.");
  // Both refusals ask it. Read as source: reaching them needs a real register's refusal.
  const src = readFileSync(join(HERE, "..", "..", "bin", "onboard.mjs"), "utf8");
  assert.ok(src.includes('say(`\\n  ${whatSetupLeft(leftSoFar()) ?? "Nothing has been written."} Re-run setup with a working credential.`);'),
    "the EUIPO refusal does not say what setup left");
  assert.ok(src.includes('say(`\\n  ${whatSetupLeft(leftSoFar()) ?? "Nothing has been written."}`);'),
    "the register check's refusal does not say what setup left");
});

/** The line setup printed after the cancel, and its exit code. */
const cancelled = (out) => ({ line: /^setup: cancelled\..*$/m.exec(out)?.[0] ?? null, exit: /__EXIT__ (\d+)/.exec(out)?.[1] });

test("cancelled at the first question, with nothing installed and no turn, setup still says nothing was written", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, CTRL_C]]);
    assert.deepEqual(cancelled(out), { line: "setup: cancelled. Nothing was written.", exit: "2" }, out);
  } finally { m.done(); }
});

test("run from the copy setup installed from npx, a cancel names that copy and where it is", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, CTRL_C]], { CLEAROTRON_RELOCATED: "1" });
    assert.deepEqual(cancelled(out), {
      line: `setup: cancelled. No settings were written. clearotron ${ownVersion()} stays installed in ${join(m.home, ".local")}.`, exit: "2" }, out);
  } finally { m.done(); }
});

test("after setup installed the AI's program, a cancel names the program and its folder", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, "1\r"], ["now\\? \\[y/N\\] $", "y\r"], [MENU, CTRL_C]]);
    assert.match(out, /✓ installed: /, `the stand-in npm did not install the program, so this arm proves nothing:\n${out}`);
    assert.deepEqual(cancelled(out), {
      line: `setup: cancelled. No settings were written. ${CLAUDE.vendor}'s CLI stays installed in ${m.engines}.`, exit: "2" }, out);
  } finally { m.done(); }
});

test("after a test turn, with nothing installed, a cancel says the turn's files stay", { skip: SKIP }, () => {
  const m = machine({ claude: true });
  try {
    const out = m.setup([[MENU, "1\r"], [MENU, "\r"], ["\\[Y/n\\] $", "\r"], [ANY, CTRL_C]]);
    assert.match(out, /completed a turn/, `no turn ran, so this arm proves nothing:\n${out}`);
    assert.deepEqual(cancelled(out), {
      line: "setup: cancelled. Clearotron wrote nothing; the AI program's test turn keeps its own files.", exit: "2" }, out);
  } finally { m.done(); }
});

test("with setup's copy, the AI's program and a test turn, a cancel names all three", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, "1\r"], ["now\\? \\[y/N\\] $", "y\r"], [MENU, "\r"], ["\\[Y/n\\] $", "\r"], [ANY, CTRL_C]],
      { CLEAROTRON_RELOCATED: "1" });
    assert.match(out, /completed a turn/, `no turn ran, so this arm proves nothing:\n${out}`);
    assert.deepEqual(cancelled(out), {
      line: `setup: cancelled. No settings were written. clearotron ${ownVersion()} stays installed in ${join(m.home, ".local")}, `
        + `and ${CLAUDE.vendor}'s CLI in ${m.engines}. The AI program's test turn keeps its own files.`, exit: "2" }, out);
  } finally { m.done(); }
});
