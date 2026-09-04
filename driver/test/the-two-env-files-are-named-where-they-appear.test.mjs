// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F33 and F31.
//
// F33: a first `--background` leaves the install with TWO environment files — `~/.env`, which the units
// load, and the checkout's own `.env`, which the CLI reads — and neither output mentioned the other's
// existence. That silence is the substrate under F34 and F40, and under every future "I edited the
// config and nothing changed".
//
// F31: the foreground path printed commands and then held the terminal, so not one of them could be
// typed from where the reader was sitting. `--background` was named two paragraphs on as a property,
// never as the answer to "how do I run what you just told me to run".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "..", "bin", "start.mjs"), "utf8");

/** The block that runs after the units' env file is written, where a reader is looking at file two. */
const envBlock = (() => {
  const at = SRC.indexOf("already carries everything the units need");
  assert.ok(at > 0, "the env-file report moved; this file's arms are reading the wrong block");
  return SRC.slice(at, at + 1400);
})();

test("2176-F33 the moment the second env file appears, BOTH are named and distinguished", () => {
  assert.match(envBlock, /TWO environment files/,
    "the reader must be told there are two, at the point the second one appears");
  assert.match(envBlock, /the UNITS load this one/,
    "which file the RUNNING product reads is the fact that matters");
  assert.match(envBlock, /the CLI reads this one/,
    "and which one a typed command reads is the other half");
});

test("2176-F33 it says editing one does not change the other, which is the actual surprise", () => {
  // Naming two paths without saying they are independent just moves the confusion one step later.
  assert.match(envBlock, /Editing one does not change the other/, envBlock);
  assert.match(envBlock, /restart the units/,
    "and the remedy — a value the running product has already loaded needs a restart to take");
});

test("2176-F33 the notice is conditional, so a box with one file is not told it has two", () => {
  assert.match(envBlock, /if \(ENV_PATH !== HOME_ENV\)/,
    "on an install where the two paths coincide there is no second file and no surprise to warn about");
});

test("2176-F31 the foreground path says the printed commands need another terminal", () => {
  const at = SRC.indexOf("This terminal is now the product");
  assert.ok(at > 0, "the closing block must say what this terminal now is");
  const closing = SRC.slice(at, at + 700);
  assert.match(closing, /need a SECOND terminal/,
    "the commands above cannot be typed here, and that is the thing the reader needs to know");
  assert.match(closing, /--background/,
    "and the alternative that gives the prompt back must be named as the ANSWER, not as a property");
});

test("2176-F31 the answer is given where the commands are, not two paragraphs later", () => {
  // The finding was not that --background went unmentioned. It was mentioned, in the wrong role and in
  // the wrong place, so the ordering is the fix and the ordering is what this asserts.
  const connectAt = SRC.indexOf("Connect your assistant to this install");
  const terminalAt = SRC.indexOf("This terminal is now the product");
  assert.ok(connectAt > 0 && terminalAt > connectAt,
    "the note about where to type belongs after the commands it is about, in the same closing block");
  assert.ok(terminalAt - connectAt < 1200,
    "it must sit with those commands, not paragraphs away where it reads as a property of the flag");
});
