// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: A PROTECTED FOLDER NAMED ANOTHER WAY IS STILL THE PROTECTED FOLDER.
//
// Windows reaches one file by more than one spelling. Beyond case and either separator, which the boundary
// already reads, there is the device form (`\\?\C:\…`, `\\.\C:\…`) and the 8.3 short name
// (`PROTEC~1`) a volume may keep beside a long one. A review inferred that the write boundary knows
// neither, so a write spelled either way into a protected folder would pass. These arms MEASURE that on
// Windows itself: the real hook, a real protected folder, and each spelling of a file inside it.
//
// A short name exists only where the volume generates them, which a machine may turn off. Where the
// folder has none, that arm says so and skips: the spelling cannot reach the folder there.
//
// Measured before the fix, 2026-09-23: the device form and the long name of a folder recorded short both
// reached the protected folder and were allowed (canonicalWindowsPath now reads every spelling as one).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authorityTrees } from "../authority-trees.mjs";

const ON_WINDOWS = process.platform === "win32" ? false : "these spellings exist only on Windows";
const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "deny-authority-write.mjs");

function hookSays(trees, filePath) {
  const payload = Buffer.from(JSON.stringify({ trees, runDir: null }), "utf8").toString("base64");
  const r = spawnSync(process.execPath, [HOOK, payload], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: filePath } }), encoding: "utf8" });
  const out = String(r.stdout ?? "").trim();
  return out ? JSON.parse(out).hookSpecificOutput?.permissionDecision ?? null : null;
}

function protectedFolder() {
  const base = mkdtempSync(join(tmpdir(), "spelling-"));
  const skills = join(base, "protected-skills-tree");
  mkdirSync(skills);
  return { skills, trees: authorityTrees({ skillsRoots: [skills] }) };
}

/** The folder's 8.3 short path, from cmd's own expansion; null where the volume keeps none. */
function shortPathOf(p) {
  // Verbatim, so Node does not escape the quotes cmd.exe needs around the path.
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"for %I in ("${p}") do @echo %~sI"`], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
  const s = String(r.stdout ?? "").trim();
  return s && s.toLowerCase() !== p.toLowerCase() && /~\d/.test(s) ? s : null;
}

test("a write into a protected folder spelled as a device path is refused", { skip: ON_WINDOWS }, () => {
  const { skills, trees } = protectedFolder();
  assert.equal(hookSays(trees, join(skills, "x.md")), "deny", "the control, the plain spelling, was not refused");
  for (const prefix of ["\\\\?\\", "\\\\.\\"]) {
    assert.equal(hookSays(trees, `${prefix}${join(skills, "x.md")}`), "deny",
      `a write spelled ${prefix}${join(skills, "x.md")} reaches the protected folder and the boundary let it through`);
  }
});

test("a write into a protected folder spelled by its short name is refused", { skip: ON_WINDOWS }, (t) => {
  const { skills, trees } = protectedFolder();
  const short = shortPathOf(skills);
  if (!short) { t.skip("this volume keeps no short names, so no short spelling reaches the folder"); return; }
  assert.equal(hookSays(trees, join(short, "x.md")), "deny",
    `a write spelled ${join(short, "x.md")} reaches the protected ${skills} and the boundary let it through`);
});

test("a write into a protected folder spelled by its long name is refused when the folder was named short", { skip: ON_WINDOWS }, (t) => {
  const { skills, trees } = protectedFolder();
  const long = realpathSync.native(skills);
  if (long.toLowerCase() === skills.toLowerCase()) { t.skip("the folder's path holds no short name here, so its long spelling is the same"); return; }
  assert.equal(hookSays(trees, join(long, "x.md")), "deny",
    `the protected folder was named ${skills}; a write spelled ${join(long, "x.md")} reaches it and the boundary let it through`);
});
