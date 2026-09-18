// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-failed-run-resumes-from-the-command-line.test.mjs — `--resume <codename>` with no `--job` reaches the
// rebuild, from the command line an operator actually types.
//
// THE DEFECT. The rebuild of a failed run's job from its own status.json was built and unit-tested, and could
// never be reached: the CLI printed its usage text and exited 2 whenever `--job` was absent, three lines
// before the branch that handles exactly that case. Every arm called the rebuild's functions directly, so
// all of them passed around a door that was shut. These arms spawn the CLI.
//
// NOTHING HERE RUNS A CLEARANCE: every arm stops at a refusal the resume branch makes before any stage.
//
// Run:  node --test driver/test/a-failed-run-resumes-from-the-command-line.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

import { resumeJobRefusal } from "../pipeline.mjs";

const PIPELINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs");

function resumeCli(codename, status) {
  const root = mkdtempSync(join(tmpdir(), "resume-cli-"));
  const work = join(root, "workspace"), pool = join(root, "pool");
  mkdirSync(pool, { recursive: true });
  if (status) {
    const runDir = join(work, "workspace-clawdi", "studio", "clearance-search", "invented-matter", `2026-09-18-${codename}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "status.json"), JSON.stringify(status));
  } else mkdirSync(join(work, "workspace-clawdi", "studio", "clearance-search"), { recursive: true });
  const env = { ...process.env };
  pinEnv(env, "CLEAROTRON_WORK_DIR", work);
  pinEnv(env, "CLEAROTRON_REPORTS_DIR", pool);
  const r = spawnSync(process.execPath, [PIPELINE, "--resume", codename], { env, encoding: "utf8", timeout: 60_000 });
  rmSync(root, { recursive: true, force: true });
  return { code: r.status, err: `${r.stderr ?? ""}` };
}

test("--resume with no --job is not answered with the usage text", () => {
  const r = resumeCli("amber-nothing", null);
  assert.doesNotMatch(r.err, /^usage:/m, "the CLI stopped before the resume branch, as it did for every operator");
  assert.match(r.err, /no run directory for --resume amber-nothing/, "it reached the branch and looked for the run");
});

test("a status.json missing an identifying field is refused by name, from the command line", () => {
  const r = resumeCli("amber-partial", { id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9] });
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.err, /^usage:/m);
  assert.match(r.err, /carries no forwarder/, "the refusal names the field it would otherwise have guessed");
});

test("the rebuild refuses each missing identifying field, and names every one", () => {
  const whole = { id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9], forwarder: "staff-a" };
  for (const k of ["id", "markName", "forwarder"]) {
    assert.match(resumeJobRefusal({ ...whole, [k]: null }, "irrelevant") ?? "", new RegExp(`carries no .*${k}`), `${k} missing is refused`);
  }
  assert.match(resumeJobRefusal({ ...whole, classes: null }, "irrelevant") ?? "", /carries no classes/);
  assert.match(resumeJobRefusal({ ...whole, id: null, forwarder: null }, "irrelevant") ?? "", /id, forwarder/, "all of them, not the first");
  // An empty class list is a recorded answer, not a missing one.
  assert.doesNotMatch(resumeJobRefusal({ ...whole, classes: [] }, "irrelevant") ?? "", /carries no/);
});
