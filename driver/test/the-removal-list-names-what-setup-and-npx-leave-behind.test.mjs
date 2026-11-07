// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REMOVAL LIST NAMES WHAT SETUP AND NPX LEAVE BEHIND, AND NOTHING THE DEMO DOES NOT.
//
// The install guide's removal section said "Everything it writes is listed here", and a newcomer who
// removed a beta by it found more on disk (measured 2026-11-04): the reasoning program setup installed,
// in a folder of its own; the settings that program wrote for itself during setup's engine check; and
// npx's copy of the package. The same section said the demo leaves the program under `~/.local`, and the
// demo left nothing there.
//
// The folder setup installs into and the folder the demo keeps its own copy in are read from the code that
// chooses them, as the sibling arm in the-install-guide-says-how-to-remove-it reads every other path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { enginesFolder, ENGINES_DIR_ENV } from "../driver.config.mjs";
import { demoProgramPrefix, permanentPrefix } from "../../shared/permanent-install.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const HOME = "~";
const asWritten = (p) => p.split(sep).join("/");

function removalSection() {
  const text = readFileSync(join(ROOT, "INSTALL.md"), "utf8");
  const from = text.indexOf("## 2a. Removing it");
  assert.notEqual(from, -1, "INSTALL.md has no removal section");
  const next = text.indexOf("\n## ", from + 1);
  return text.slice(from, next === -1 ? undefined : next);
}

test("the removal section names the folder setup installs the reasoning program into, and its setting", () => {
  const section = removalSection();
  const folder = asWritten(enginesFolder({ env: {}, home: HOME }));
  assert.ok(section.includes(folder), `the removal section does not name ${folder}`);
  assert.ok(section.includes(ENGINES_DIR_ENV), `nor the setting that moves it, ${ENGINES_DIR_ENV}`);
  // Each program setup can install is named, so a reader knows what the folder holds.
  assert.match(section, /Claude Code/);
  assert.match(section, /Codex CLI/);
});

test("it names what the reasoning program keeps for itself, as that program's, and npx's copy", () => {
  const section = removalSection();
  for (const p of ["~/.claude`", "~/.claude.json", "~/.codex", "~/.npm/_npx"]) assert.ok(section.includes(p), `the removal section does not name ${p}`);
  assert.match(section.replace(/\s+/g, " "), /They belong to that program, not to Clearotron/,
    "the section does not say those files are the program's own, so a reader may delete a sign-in other tools use");
});

test("it says nothing about the demo leaving the program under ~/.local, because the demo keeps its own copy", () => {
  const section = removalSection();
  const local = asWritten(permanentPrefix({ HOME }));
  const demoCopy = asWritten(demoProgramPrefix(join(HOME, "trademark-demo")));
  assert.ok(!demoCopy.startsWith(local), `the demo's copy (${demoCopy}) lives under ${local}, which this arm says it does not`);
  assert.ok(section.includes(demoCopy), `the removal section does not name the demo's own copy, ${demoCopy}`);
  assert.doesNotMatch(section.replace(/\s+/g, " "), /what a demo run from `npx` leaves behind/, "the section still says a demo leaves the program under ~/.local");
});
