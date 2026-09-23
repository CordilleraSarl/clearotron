// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: `clearotron start --background` HAS NOTHING TO INSTALL THERE, AND SAYS SO.
//
// The background form is a set of systemd units, and Windows has no systemd. Asked for it, `start` used to
// set out to install them and fail on systemctl, a program the machine does not have. It now answers in the
// owner's sentence (2026-09-23), before it writes anything or calls systemctl, and exits.
//
// The first arm pins the sentence and where it applies on every machine, through the platform parameter.
// The second runs the real command on Windows and holds that the sentence is ALL it prints: any step past
// the refusal, a systemctl attempt included, writes something of its own first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backgroundRefusal, backgroundManager } from "../../shared/os-advice.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SENTENCE = "Background mode isn't available on Windows. Run `clearotron start` and keep its window open.";

test("Windows is refused in the owner's sentence, and no other machine is", () => {
  assert.equal(backgroundRefusal({ platform: "win32" }), SENTENCE);
  // Not read off backgroundManager, which answers null on a Mac too: a Mac must not be told it is Windows.
  for (const platform of ["linux", "darwin"])
    assert.equal(backgroundRefusal({ platform }), null, `${platform} was refused as though it were Windows`);
  assert.equal(backgroundManager({ platform: "win32" }), null, "Windows would still be offered a background form");
});

test("on Windows, `start --background` prints the sentence and nothing else, and exits", {
  skip: process.platform !== "win32" && "the refusal is Windows's; on Linux the flag installs real units, which no test may do",
}, () => {
  const home = mkdtempSync(join(tmpdir(), "start-bg-"));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "start.mjs"), "--background"], {
      cwd: home, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, USERPROFILE: home, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" },
    });
    assert.equal(r.error, undefined, `start did not run: ${r.error?.message}`);
    assert.equal(r.status, 1, `start exited ${r.status}; a request it cannot honour must not read as done\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.stderr.trim(), SENTENCE, "start said something besides the sentence, so it went past the refusal");
    assert.equal(r.stdout.trim(), "", `start printed to the screen before refusing:\n${r.stdout}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
