#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// main-health.mjs — is main's latest completed run a reason not to merge?
//
// — A RUN THAT COULD NOT ALLOCATE A RUNNER IS NOT A FAILING MAIN.
//
// Measured 2026-08-25 on the working home: run 32806587793, event `schedule`, SHA 31c31c09. Its macOS
// job started 03:49:04Z and completed 03:49:08Z — four seconds, no runner assigned, NO STEPS RECORDED
// AT ALL — every other job skipped because they gate on it, and the run's conclusion `failure`. The
// PUSH run on the same SHA thirty minutes earlier was green on every job.
//
// Nothing executed, so nothing can have regressed. But the lane's merge discipline reads "main's latest
// COMPLETED run must be green, and a red main blocks every merge but the fix" — a rule that is right,
// and that a red no fix can clear turns into a tax. The next person either stops, or learns to reason
// past a red main, and the second one is how a real regression gets merged over.
//
// THIS IS 's DISTINCTION ONE SUBSYSTEM OVER. There it was `systemctl --user` with no bus reported
// as "the unit is not there"; here it is an unallocated runner reported as "the suite failed". Both are
// could-not-look rendered as a finding, and both are fixed by refusing to answer rather than answering
// wrongly.
//
// COULD-NOT-LOOK IS NOT GREEN EITHER. It exits 0 — it does not block a merge — and it says so loudly,
// because a run that never ran has told you nothing about main and the reader must not carry away
// "main is fine". The exit code answers "may I merge"; the text answers "what do you know".
//
// Usage:
//   node scripts/main-health.mjs [--repo owner/name] [--branch main]
import { execFileSync } from "node:child_process";

import { executedSteps, jobName } from "./nightly-notice.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
// NOT `import.meta.url === \`file://${process.argv[1]}\``: that comparison is false for every installed
// user, because npm puts a SYMLINK at node_modules/.bin and argv[1] is the link while import.meta.url is
// the target. A guard in this repo forbids the raw form by name, and it caught this file.

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Classify a completed run from its own job list.
 *
 * `executedSteps` is IMPORTED, not re-implemented. nightly-notice.mjs states the rule this depends on —
 * zero is a reading, `null` is the absence of one — and its own header warns that two statements of one
 * rule drift together and get reported as agreement. One statement, two callers.
 *
 * @returns {{state: "green"|"red"|"could-not-look", failed: object[], unread: object[]}}
 */
export function classify({ conclusion, jobs = [] }) {
  if (conclusion === "success") return { state: "green", failed: [], unread: [] };

  const bad = jobs.filter((j) => j?.conclusion != null && j.conclusion !== "success" && j.conclusion !== "skipped");
  if (!bad.length) return { state: "green", failed: [], unread: [] };

  // A job that failed having executed steps looked and found a fault. One that failed having executed
  // NONE never started. `null` — no step list to count — is neither, and is treated as a real failure:
  // inventing an infrastructure diagnosis out of a payload we could not read would be the same lie in
  // the other direction, and the safe way to be wrong here is to block a merge rather than wave one on.
  const unread = bad.filter((j) => executedSteps(j) === 0);
  const failed = bad.filter((j) => executedSteps(j) !== 0);
  if (failed.length) return { state: "red", failed, unread };
  return { state: "could-not-look", failed: [], unread };
}

/** What a reader should be told, and whether it blocks. Pure, so the wording is testable without a run. */
export function report({ state, failed, unread }, { runUrl = "", sha = "" } = {}) {
  const where = `${sha ? ` ${sha.slice(0, 8)}` : ""}${runUrl ? ` — ${runUrl}` : ""}`;
  if (state === "green") return { block: false, text: `main is green${where}.` };
  if (state === "red") {
    return {
      block: true,
      text: `MAIN IS RED${where}. ${failed.length} job(s) failed having executed steps:\n`
        + failed.map((j) => `  ${jobName(j)} — ${executedSteps(j)} step(s) ran`).join("\n")
        + `\nA red main blocks every merge but its own fix.`,
    };
  }
  return {
    block: false,
    text: `MAIN'S LATEST RUN COULD NOT LOOK${where}. ${unread.length} job(s) reported failure having `
      + `executed ZERO steps — the runner never started them:\n`
      + unread.map((j) => `  ${jobName(j)} — no steps recorded`).join("\n")
      + `\nNothing ran, so nothing can have regressed and this does not block a merge. It also means `
      + `THIS RUN TOLD YOU NOTHING ABOUT MAIN: the last real answer is an earlier run, not this one.`,
  };
}

function main() {
  const repo = arg("--repo", "");
  const branch = arg("--branch", "main");
  const gh = (a) => JSON.parse(execFileSync("gh", a, { encoding: "utf8", maxBuffer: 1 << 26 }));
  const base = repo ? ["-R", repo] : [];
  const runs = gh(["api", ...(repo ? [] : []), `repos/${repo || "{owner}/{repo}"}/actions/runs?branch=${branch}&per_page=10`]);
  const run = (runs.workflow_runs ?? []).find((r) => r.status === "completed");
  if (!run) { console.log(`no completed run on ${branch} — that is not a green, it is an absence.`); process.exit(0); }
  const { jobs } = gh(["api", `repos/${repo || "{owner}/{repo}"}/actions/runs/${run.id}/jobs`]);
  const r = report(classify({ conclusion: run.conclusion, jobs }), { runUrl: run.html_url, sha: run.head_sha });
  console.log(r.text);
  process.exit(r.block ? 1 : 0);
}

if (isEntrypoint(import.meta.url)) main();
