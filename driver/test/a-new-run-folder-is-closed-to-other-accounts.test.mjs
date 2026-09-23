// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A new run folder is closed to other accounts.
//
// Run folders took whatever the umask gave, 775 on a real run, so on a machine whose home or data folder
// other accounts can enter, any of them could read client matter. They are now created 0750 through one
// constant, by a mode given to mkdir, which never changes a folder that already exists and keeps the
// set-GID bit a pool root passes down. A chmod would do neither: a chmod by an account outside the pool's
// group strips set-GID silently, and every report then answers 403.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDriverDir, RUN_DIR_MODE, DRIVER_DIR } from "../../shared/driver-dir.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mode = (p) => statSync(p).mode & 0o7777;
const octal = (m) => `0${m.toString(8)}`;
const POSIX = process.platform !== "win32";

/** Run `fn` under a umask that leaves other accounts in, as a real run's does (002). */
function underLooseUmask(fn) {
  const was = process.umask(0o002);
  try { return fn(); } finally { process.umask(was); }
}

test("a run folder created for a new run is owner and group only, and so is its record folder", { skip: !POSIX && "Windows has no mode bits" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "run-mode-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, "some-matter", "2026-09-23-sample-run");
  underLooseUmask(() => ensureDriverDir(runDir));
  assert.equal(RUN_DIR_MODE, 0o750);
  for (const dir of [join(root, "some-matter"), runDir, join(runDir, DRIVER_DIR)]) {
    assert.equal(mode(dir), 0o750, `${dir.slice(root.length)} was created ${octal(mode(dir))}, so another account can read it`);
  }
});

test("a folder that already exists keeps its mode: the change is made at creation, never by a chmod", { skip: !POSIX && "Windows has no mode bits" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "run-mode-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, "2026-09-23-sample-run");
  mkdirSync(runDir); chmodSync(runDir, 0o775);
  underLooseUmask(() => ensureDriverDir(runDir));
  assert.equal(mode(runDir), 0o775, "an existing run folder was changed; a chmod on a set-GID tree is what makes every report 403");
  assert.equal(mode(join(runDir, DRIVER_DIR)), 0o750, "the new record folder inside it was not created owner and group only");
});

test("a report folder created under a set-GID pool root keeps the set-GID bit and the group's read", { skip: !POSIX && "Windows has no mode bits" }, (t) => {
  const pool = mkdtempSync(join(tmpdir(), "pool-sgid-"));
  t.after(() => rmSync(pool, { recursive: true, force: true }));
  chmodSync(pool, 0o2775);   // our own temp folder, in our own group: the chmod keeps the bit here
  if (!(mode(pool) & 0o2000)) return t.skip("this filesystem will not hold a set-GID bit on a folder");
  const reportDir = join(pool, "some-matter-2026-09-23-sample-run");
  underLooseUmask(() => mkdirSync(reportDir, { recursive: true, mode: RUN_DIR_MODE }));
  assert.equal(mode(reportDir), 0o2750,
    `the report folder was created ${octal(mode(reportDir))}; it must inherit set-GID and keep the group's read, or reports 403`);
});

test("both publishers create the report folder with the run-folder mode, and neither chmods it", () => {
  for (const rel of ["driver/publish/index.mjs", "driver/publish/knockout.mjs"]) {
    // Code only: index.mjs names the old `grpRead(poolRunDir, …)` 403 bug in a comment, which is history, not a call.
    const src = readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const creates = src.match(/mkdirSync\(poolRunDir,[^)]*\)/g) ?? [];
    assert.equal(creates.length, 1, `${rel}: expected one place that creates the report folder, found ${creates.length}`);
    assert.match(creates[0], /mode: RUN_DIR_MODE/, `${rel} creates the report folder without the run-folder mode: ${creates[0]}`);
    assert.doesNotMatch(src, /chmodSync\(poolRunDir|grpRead\(poolRunDir/, `${rel} changes the report folder's mode after creating it`);
  }
});
