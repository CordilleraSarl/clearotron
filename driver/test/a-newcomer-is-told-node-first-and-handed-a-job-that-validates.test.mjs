// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The two pages a newcomer reads first, held to what they hand over.
//
// README said "with nothing installed" before it said which Node the demo needs, so the first command failed with
// "npx: command not found" or the version refusal on a page that had not yet named the floor. And QUICKSTART's job put
// its reference only on the mark: the run's folder name, matter, status and email subject read the job's own `ref`,
// so the reference a newcomer typed reached none of them. `clearotron run` does not pass through the intake schema,
// so nothing caught the example drifting from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateJob } from "../enqueue-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLOOR = "Node 22.13 or newer, on macOS, Linux or Windows.";

test("README names the Node floor once, before the demo command", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.equal(readme.split(FLOOR).length - 1, 1, "the floor is not stated exactly once");
  const demo = readme.indexOf("npx clearotron demo");
  assert.ok(demo > 0, "README no longer gives the demo command");
  assert.ok(readme.indexOf(FLOOR) < demo, "the floor comes after the demo command it applies to");
});

test("QUICKSTART's job passes the intake schema with a reference of its own", () => {
  const quickstart = readFileSync(join(ROOT, "QUICKSTART.md"), "utf8");
  const block = /Write `job\.json`:\n\n```json\n([\s\S]*?)\n```/.exec(quickstart);
  assert.ok(block, "QUICKSTART no longer carries the job block after \"Write `job.json`:\"");
  const job = JSON.parse(block[1]);
  assert.equal(job.ref, job.marks?.[0]?.ref, "the job's reference is not the mark's, so the example is two matters");
  const { ok, errors, warnings } = validateJob(job);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
  // The example comes from no email thread, so its one expected warning is the missing msgId.
  assert.deepEqual(warnings.filter((w) => !/^no msgId\b/.test(w)), [], "the schema warns about the example job");
});
