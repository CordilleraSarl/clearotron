// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPORT IS REPUBLISHED ONLY BY THE BUILD THAT MADE IT.
//
// `pool-admin republish` re-rendered any archived run through today's publisher, a run from an earlier build
// included, and that kept the publisher's guards for older records alive. Design ruled on 2026-11-11 that the
// operational command refuses a run created by another build, in an approved sentence, and the stored page stays.
// The demo's player and the bench call the publisher directly and are not this door.
//
// SAFETY: pool-admin reads CLEAROTRON_REPORTS_DIR at module load, so every run of it here gets a throwaway pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crossBuildRepublishRefusal } from "../one-build-per-run.mjs";
import { engineProvenance } from "../engine-build.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REFUSAL = "This report was created by a different Clearotron build. Its saved report remains available; this build cannot republish it.";
const runDirWith = (root, head) => {
  const dir = join(root, "run");
  mkdirSync(join(dir, "_driver"), { recursive: true });
  if (head !== undefined) writeFileSync(join(dir, "_driver", "run.jsonl"), `${JSON.stringify({ event: "engine-build", engineHead: head })}\n`);
  return dir;
};

test("a run made by another build, or by one that recorded none, is refused in the approved sentence", () => {
  const root = mkdtempSync(join(tmpdir(), "republish-build-"));
  try {
    const current = "a".repeat(40);
    assert.equal(crossBuildRepublishRefusal(runDirWith(join(root, "other"), "b".repeat(40)), { current }), REFUSAL);
    assert.equal(crossBuildRepublishRefusal(runDirWith(join(root, "none")), { current }), REFUSAL, "a run with no build record");
    assert.equal(crossBuildRepublishRefusal(runDirWith(join(root, "same"), current), { current: null }), REFUSAL,
      "an install that cannot name its own build cannot show the run was made on it");
    // THE CONTROL: the build that made the run may re-render it.
    assert.equal(crossBuildRepublishRefusal(runDirWith(join(root, "same2"), current), { current }), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("`pool-admin republish` refuses a run from an earlier build and leaves its stored page as it was", () => {
  const root = mkdtempSync(join(tmpdir(), "republish-cli-"));
  try {
    const pool = join(root, "pool");
    const runId = "tmp0775-2026-11-11-quillmere";
    mkdirSync(join(pool, runId), { recursive: true });
    writeFileSync(join(pool, runId, "meta.json"), JSON.stringify({ runId, codename: "quillmere", date: "2026-11-11", markName: "QUILLMERE" }));
    const stored = "<html><body>the page the client was sent</body></html>";
    writeFileSync(join(pool, runId, "report.html"), stored);
    const runDir = runDirWith(root, "0".repeat(40));
    const r = spawnSync(process.execPath, [join(REPO, "driver", "publish", "pool-admin.mjs"), "republish", runId, "--run-dir", runDir], {
      encoding: "utf8", timeout: 60000,
      env: { PATH: process.env.PATH, HOME: root, CLEAROTRON_NO_ENV_FILE: "1", CLEAROTRON_REPORTS_DIR: pool,
        CLEAROTRON_WORK_DIR: join(root, "work") },
    });
    const said = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, said);
    assert.ok(said.includes(REFUSAL), `the refusal is not the approved sentence:\n${said}`);
    assert.equal(readFileSync(join(pool, runId, "report.html"), "utf8"), stored, "the stored page was rewritten");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("THE CONTROL: this checkout names its own build, so a run it made is not refused by the arm above's rule", () => {
  const current = engineProvenance().engineHead;
  if (!current) return;   // off a checkout with no build record the refusal is right, and the first arm covers it
  const root = mkdtempSync(join(tmpdir(), "republish-same-"));
  try { assert.equal(crossBuildRepublishRefusal(runDirWith(root, current)), null); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
