// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// With no AI chosen, the program and payment rows are the default AI's, which nobody chose. `doctor` listed that
// program's path among what a search needs, and a person who has not picked an AI has no reason to set it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rowsToName } from "../run-requirements.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const row = (name, about) => ({ name, about, why: "w" });

test("with no AI chosen, the rows for the default AI's program and payment are not named", () => {
  const rows = [row("A_REGISTER", "register"), row("AN_AI", "ai"), row("A_PROGRAM", "program"), row("A_PAYMENT", "payment")];
  assert.deepEqual(rowsToName(rows).map((r) => r.name), ["A_REGISTER", "AN_AI"]);
});

test("with an AI chosen, a missing program is still named", () => {
  const rows = [row("A_PROGRAM", "program")];
  assert.deepEqual(rowsToName(rows), rows);
});

test("doctor on an install with no AI chosen names the choice and not the program's path", () => {
  const home = mkdtempSync(join(tmpdir(), "doctor-no-ai-"));
  const out = execFileSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"], { encoding: "utf8", cwd: home, env: { PATH: process.env.PATH, HOME: home, TERM: "dumb", NO_COLOR: "1" } });
  const line = out.split("\n").find((l) => l.includes("a search is refused until"));
  assert.ok(line, `premise: this install is refused a search\n${out.slice(0, 600)}`);
  assert.match(line, /CLEAROTRON_AI/);
  assert.doesNotMatch(line, /CLEAROTRON_CLAUDE_PATH/);
});
