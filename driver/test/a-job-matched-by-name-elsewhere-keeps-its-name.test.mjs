// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A JOB ANOTHER CHECK MATCHES BY NAME KEEPS THAT NAME, OR THE RENAME SAYS SO HERE.
//
// One job in this workflow is identified elsewhere by a SUBSTRING of its name. A check outside this
// repository asks a completed CI run whether that job ran and how much of it was skipped, and it finds
// the job by matching that substring — which is the only thing joining the two. Rename the job and the
// match silently finds nothing.
//
// WHY THAT IS WORSE THAN AN ORDINARY BREAKAGE. The check's own answer for "no such job" is not "this is
// broken": absent, it reads as a repository that does not define such a job at all, which is a legitimate
// state for other repositories and a false one for this one. So a rename does not red where it happens.
// It surfaces later, somewhere else, as a check reporting a fact about the world when it is reporting the
// limit of its own reach — and whoever meets it debugs it from the wrong end.
//
// So this arm exists to make the rename red HERE, in the change that causes it, where the person holding
// it can see both halves at once and decide whether the other check needs the new name.
//
// IT ASSERTS THE SUBSTRING, NOT THE FULL NAME. The job's full name carries more than the match needs, and
// pinning all of it would refuse an ordinary edit to the descriptive tail for no reason. What must not
// move is the part another check reads.
//
// It deliberately names neither the check nor where it lives. That is not this repository's business and
// a public test is not the place to describe another one; what a reader needs is that the substring is
// load-bearing beyond this file, which the sentence above says without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI = join(ROOT, ".github", "workflows", "ci.yml");

/** The substring another check matches this job by. Changing it is the thing this arm exists to catch. */
const MATCHED = "Build the portal";

test("the portal build job's name still carries the substring another check matches it by", () => {
  const yaml = readFileSync(CI, "utf8");
  const names = [...yaml.matchAll(/^\s*name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
  const hit = names.filter((n) => n.includes(MATCHED));
  assert.equal(hit.length, 1,
    `exactly one job name must carry ${JSON.stringify(MATCHED)}; found ${hit.length}: ${JSON.stringify(hit)}.\n`
    + "  A check outside this repository finds that job by this substring and reports a fact about the\n"
    + "  world when it cannot find it. If the rename is deliberate, the other check needs the new name\n"
    + "  in the same change — it will not red on its own.");
});

test("CONTROL — the arm reads real job names, so it cannot pass over a file it failed to parse", () => {
  // Without this, a workflow this regex stopped matching would yield an empty list, the arm above would
  // fail for the right reason by accident, and a rewritten `ci.yml` that broke the read would look like a
  // rename. The count is a floor rather than a figure: jobs are added and removed, and an exact number
  // would be a second thing to maintain for no gain.
  const yaml = readFileSync(CI, "utf8");
  const names = [...yaml.matchAll(/^\s*name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
  assert.ok(names.length >= 5, `only ${names.length} name(s) read from the workflow — the read is broken, not the names`);
});
