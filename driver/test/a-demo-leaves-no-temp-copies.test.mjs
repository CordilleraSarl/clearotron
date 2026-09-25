// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO LEAVES NO TEMP COPIES BEHIND.
//
// The demo publishes from copies of the shipped samples, made in the system temp directory, and nothing
// removed them: four per `demo --once`, one per demo start, some a full replayed run, 36 GB on one machine
// (measured 2026-09-19). They now go as soon as their publish is done, and at exit whatever happened; a
// run stopped by a signal is driven by hand and recorded on the change that added this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { publishSource, releaseDemoCopies } from "../demo-container.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const copiesIn = (dir) => readdirSync(dir).filter((n) => n.startsWith("clearotron-demo-"));

test("a copy made to publish from is released on demand", () => {
  const tmp = mkdtempSync(join(tmpdir(), "demo-copies-"));
  try {
    const sample = readdirSync(join(REPO, "demo"), { withFileTypes: true }).find((e) => e.isDirectory())?.name;
    assert.ok(sample, "the tree ships no demo to copy");
    const copy = publishSource(join(REPO, "demo", sample), { repoRoot: REPO, tmp });
    assert.ok(existsSync(copy) && copiesIn(tmp).length === 1, "no copy was made to publish from");
    releaseDemoCopies();
    assert.deepEqual(copiesIn(tmp), [], "the copy outlived its release");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("demo --once publishes every sample and leaves no copy in the temp directory", { timeout: 180000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "demo-once-"));
  const tmp = join(root, "tmp"), pool = join(root, "pool");
  mkdirSync(tmp);
  try {
    const r = spawnSync(process.execPath, [join(REPO, "bin", "example.mjs"), "--once", "--pool", pool], {
      encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: tmp } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(readdirSync(pool).some((n) => existsSync(join(pool, n, "report.html"))), "nothing was published, so this proves nothing");
    assert.deepEqual(copiesIn(tmp), [], "demo --once left its copies in the temp directory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
