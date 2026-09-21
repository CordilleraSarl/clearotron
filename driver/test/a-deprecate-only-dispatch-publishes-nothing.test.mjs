// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A DISPATCH THAT ONLY DEPRECATES PUBLISHES NOTHING.
//
// Measured on the public repo, 2026-09-21: the release workflow was dispatched with only
// `deprecate-below` filled in, after 0.3.2 was published. The deprecations applied and read back
// correctly — and the run went RED, because the publish job also ran and npm refused it: "cannot
// publish over the previously published versions: 0.3.2".
//
// THE `cut` DEFAULT IS WHY. `cut` is a choice input defaulting to `rehearse`, so an operator who fills
// in only `deprecate-below` sends `cut: rehearse` without asking for anything of the sort. The publish
// jobs took that at face value and ran their rehearsal branch, and `npm publish --dry-run` is not inert:
// it contacts the registry, and the registry refuses a version already out. A red run for a step that
// worked, and a publish attempt nobody asked for.
//
// So every rehearsal branch requires that no deprecation was asked for. This arm holds that for EVERY
// job rather than the two that had it, because the failure arrives again the moment a third publish path
// is added with the branch copied from one of these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const WF = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");

/** Each top-level job and the text of its `if:`, read off the indentation this file uses. */
function jobsWithConditions(text) {
  const out = new Map();
  const lines = text.split("\n");
  let job = null, cond = null;
  for (const line of lines) {
    const head = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (head) { job = head[1]; cond = null; continue; }
    if (!job) continue;
    if (/^ {4}if:/.test(line)) { cond = line.replace(/^ {4}if:\s*>?-?\s*/, ""); out.set(job, cond); continue; }
    // A continuation is indented PAST the key, by any amount — the operands of a folded condition sit at
    // six spaces and their parenthesised branches deeper still. Matching exactly six read one line of
    // each multi-line condition and stopped, which made the arms below pass on half a condition.
    if (cond !== null && /^ {6,}\S/.test(line)) { out.set(job, `${out.get(job)} ${line.trim()}`); continue; }
    if (cond !== null && /^ {4}\S/.test(line)) cond = null;   // the condition ended; keep what was read
  }
  return out;
}

const CONDITIONS = jobsWithConditions(WF);

test("the workflow's jobs and their conditions can be read at all", () => {
  // Without this the arms below would pass on an empty map, which is the shape of a check that reports
  // on a file it could not parse.
  assert.ok(CONDITIONS.size >= 6, `expected the release jobs to be readable, found ${CONDITIONS.size}`);
  for (const j of ["publish", "publish-awaited", "deprecate"])
    assert.ok(CONDITIONS.has(j), `the ${j} job's condition could not be read`);
});

test("every rehearsal branch requires that no deprecation was asked for", () => {
  // THE DEFECT, as the assertion, over every job rather than the two it was found on.
  const rehearsing = [...CONDITIONS].filter(([, c]) => c.includes("inputs.cut == 'rehearse'"));
  assert.ok(rehearsing.length >= 2, `expected the publish jobs to carry a rehearsal branch, found ${rehearsing.length}`);
  for (const [job, cond] of rehearsing)
    assert.match(cond, /inputs\.cut == 'rehearse' && inputs\.deprecate-below == ''/,
      `${job} runs on a dispatch that only asked to deprecate — its rehearsal branch does not exclude one`);
});

test("the deprecate job itself is untouched and depends on nothing", () => {
  // The other direction: the fix must not have narrowed the job that does the work. It has no `needs:`,
  // so it cannot be skipped by another job's state, and it runs on the input alone.
  assert.equal(CONDITIONS.get("deprecate"),
    "github.event_name == 'workflow_dispatch' && inputs.deprecate-below != ''",
    "the deprecate job's own condition changed");
  const block = WF.slice(WF.indexOf("\n  deprecate:"));
  const body = block.slice(0, block.indexOf("\n  ", 3) > 0 ? undefined : undefined).split(/\n {2}[a-z]/)[0];
  assert.doesNotMatch(body, /^\s{4}needs:/m, "the deprecate job gained a dependency it can be skipped by");
});

test("a genuine rehearsal still rehearses", () => {
  // A rehearsal with no deprecation asked for must still reach the publish jobs — the guard is on the
  // deprecation input, not on rehearsing.
  for (const job of ["publish", "publish-awaited"])
    assert.match(CONDITIONS.get(job), /inputs\.cut == 'rehearse'/,
      `${job} no longer runs for a rehearsal at all, so the rehearsal stopped covering it`);
});

test("`cut` still defaults to rehearse, which is what makes the guard necessary", () => {
  // If the default ever changes, the reasoning above changes with it: a deprecate-only dispatch would
  // then carry whatever the new default is, and this guard would be aimed at the wrong value.
  const inputs = WF.slice(WF.indexOf("    inputs:"), WF.indexOf("\njobs:"));
  const cut = inputs.slice(inputs.indexOf("      cut:"));
  assert.match(cut.slice(0, 400), /default:\s*rehearse/,
    "`cut` no longer defaults to rehearse — re-read what a deprecate-only dispatch now sends");
});
