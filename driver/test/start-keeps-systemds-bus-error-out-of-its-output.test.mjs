// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// START KEEPS SYSTEMD'S BUS ERROR OUT OF ITS OUTPUT.
//
// `start` reads the client door's unit with `systemctl --user show`, and after a background start it reads
// each unit's state the same way. Where the user bus cannot be reached (a fresh login with no session bus,
// a container), systemctl writes "Failed to connect to bus: No medium found" to its stderr. The reads let
// that stderr through to the terminal, so a newcomer saw the line in start's output with nothing around it
// (measured in testing, 2026-11-17). The read's answer was right: a failed read is a could-not-look. Only
// the stray line was wrong.
//
// Each case runs the read in a child process against a stand-in `systemctl` first on PATH, and reads the
// child's own stderr, because a line the read let through goes to the process's stderr, not to a value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const START = pathToFileURL(join(import.meta.dirname, "..", "..", "bin", "start.mjs")).href;
const SHELL_STAND_IN = process.platform === "win32" && "the stand-in systemctl is a shell script";
const BUS = "Failed to connect to bus: No medium found";

/** Run `body` (an async function's source, given the imported module as `m`) with a stand-in systemctl. */
function withSystemctl(script, body) {
  const dir = mkdtempSync(join(tmpdir(), "systemctl-stand-in-"));
  try {
    const bin = join(dir, "systemctl");
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o755);
    const code = `const m = await import(${JSON.stringify(START)}); ${body}`;
    return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, HOME: dir },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("an unreachable bus: the client door's read answers could-not-look and prints nothing", { skip: SHELL_STAND_IN }, () => {
  const r = withSystemctl(`echo "${BUS}" >&2; exit 1`,
    `console.log(JSON.stringify(m.liveClientDoor(${JSON.stringify(join(tmpdir(), "no-such-units.env"))})));`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes("Failed to connect to bus"), `the bus error reached the output:\n${r.stderr}`);
  assert.equal(JSON.parse(r.stdout.trim()).unitActive, null, "a failed read stays a could-not-look");
});

test("an unreachable bus: a unit's state read throws to its caller and prints nothing", { skip: SHELL_STAND_IN }, () => {
  const r = withSystemctl(`echo "${BUS}" >&2; exit 1`,
    `try { m.systemctlShow("clearotron-worker.service", ["ActiveState"]); console.log("read"); } catch { console.log("threw"); }`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes("Failed to connect to bus"), `the bus error reached the output:\n${r.stderr}`);
  assert.equal(r.stdout.trim(), "threw");
});

test("a reachable bus: the properties are read as before", { skip: SHELL_STAND_IN }, () => {
  const r = withSystemctl(`printf 'ActiveState=active\\nSubState=running\\nNRestarts=0\\n'`,
    `console.log(JSON.stringify(m.systemctlShow("clearotron-worker.service", ["ActiveState", "SubState", "NRestarts"])));`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { ActiveState: "active", SubState: "running", NRestarts: "0" });
});
