#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// nightly-notice.mjs — say that a nightly went red, to somebody, without anyone choosing to look.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
//
// moved the macOS job off every pull request and onto a nightly on main. That trade is right and
// it introduced a failure mode the per-PR form did not have: on a pull request a red macOS job was in
// front of whoever opened the PR, on the page they were already looking at. A nightly is a row in
// `gh run list` that somebody has to think to check. Nothing in this repository performed that check on
// a cadence, so a red nightly reached nobody — 6,000 runner-minutes a year producing a row nobody opens.
//
// ── IT SAYS NOTHING WHEN THE NIGHTLY IS GREEN ───────────────────────────────────────────────────────
//
// The gate is the workflow's `if:`, and it is the ONLY gate — this file does not re-decide it. A second
// copy of that condition in JavaScript would be two statements of one rule, drifting together and
// reported as agreement; when this file runs, the decision to notify has already been made. An
// all-clear every morning trains the reader to ignore the channel, which is the same failure with extra
// steps.
//
// ── ONE THREAD, NOT ONE ISSUE PER NIGHT ─────────────────────────────────────────────────────────────
//
// Five red nights running is one problem, and five issues for it is a channel nobody reads by Friday.
// An open issue carrying the marker label is commented on; only its absence opens a new one.
//
// ── IT REPORTS THE WINDOW, WHICH IS THE PART THAT DEGRADES ──────────────────────────────────────────
//
// Per-PR, a macOS regression was attributed to one diff by construction. Nightly, a red covers
// everything merged in 24 hours, and two unread nightlies make it three days. The notice therefore
// leads with how long it has been since a scheduled run was last green, because that number is the
// reader's search space and it is the thing that gets worse while nobody looks.
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const MARKER_LABEL = "ci:nightly-red";

/** Whole hours between two ISO timestamps, or null when there is no earlier point to measure from. */
export function hoursSince(thenISO, nowISO) {
  if (!thenISO) return null;
  const then = Date.parse(thenISO), now = Date.parse(nowISO);
  if (!Number.isFinite(then) || !Number.isFinite(now) || now < then) return null;
  return Math.floor((now - then) / 3_600_000);
}

/** The job's name, whichever shape the caller had. A bare string is the pre- form. */
export function jobName(job) { return typeof job === "string" ? job : String(job?.name ?? "?"); }

/**
 * How many steps that job actually EXECUTED — or `null` when the payload did not carry a step list.
 *
 * THREE-STATE, AND THE THIRD IS THE POINT. A job that failed before running anything reports
 * `steps: []` — measured on run 32687965690, where the macOS job's payload carried an empty array and
 * every job that really ran carried 3, 5 or 6 entries. So zero is a READING, and it is the reading that
 * says "the runner never started this job": a platform or billing signature, not a test result.
 *
 * `null` is the different fact that a step list was not there to count. Returning 0 for it would invent
 * an infrastructure diagnosis out of a permissions error or a payload change, which is the same class
 * of lie as rendering an unreadable job list as "nothing failed". The decision lives HERE, in JS, and
 * NOT in the `--jq` that shapes the payload: `jq`'s `length` of `null` is 0, so an absent key would have
 * become "never started" one layer above every arm that could have caught it.
 */
export function executedSteps(job) {
  if (typeof job === "string" || !Array.isArray(job?.steps)) return null;
  // A step with no conclusion has not run; a skipped one was reached and declined. Neither is execution.
  return job.steps.filter((s) => s?.conclusion != null && s.conclusion !== "skipped").length;
}

/**
 * The notice, as markdown. PURE — every input is passed in, so the wording is testable without a run.
 *
 * `lastGreenAt` is null when no scheduled run has ever been green, which is NOT the same as "0 hours"
 * and must not render as it: an unknown window is a wider search space than a known short one, and
 * rounding it to zero would tell the reader the opposite of the truth.
 */
export function noticeBody({ runUrl, sha, subject, failedJobs = [], lastGreenAt, nowISO, event, ref,
  macosExecuted = null, macosOutcome = null }) {
  const h = hoursSince(lastGreenAt, nowISO);
  const window = h === null
    ? "**No scheduled run has ever been green**, so the window this covers is the whole history of the schedule."
    : `**${h}h since a scheduled run was last green.** Everything merged in that window is in scope.`;
  // THREE STATES, NOT TWO. `null` means the job list could not be READ; `[]` means it was read and
  // nothing reported `failure`. Collapsing them would tell the reader "nothing failed" on the one page
  // whose entire job is to say something did — and it would hide a broken lookup as a quiet run.
  const jobs = failedJobs === null
    ? "- (the job list could not be read — open the run; the notice is sent anyway, because a notice "
      + "withheld until it is complete is a notice nobody gets)"
    : failedJobs.length
      ? failedJobs.map((j) => {
        // — "FAILED" AND "NEVER STARTED" ARE DIFFERENT FINDINGS WITH DIFFERENT READERS. A reader
        // told only "macOS failed" opens the run to learn whether the platform is broken or the bill is
        // unpaid. Told that it executed no steps, they already know it is the second kind.
        const n = executedSteps(j);
        if (n === null) return `- \`${jobName(j)}\` — (no step list in the payload, so this cannot say whether it ran)`;
        if (n === 0) return `- \`${jobName(j)}\` — **did not run**: it reported failure having executed no steps, `
          + "which is a runner or platform signature rather than a test result. Nothing in the repository ran.";
        return `- \`${jobName(j)}\` — failed after ${n} executed step${n === 1 ? "" : "s"}`;
      }).join("\n")
      : "- (the run failed with no job reporting `failure` — read the run itself)";
  // AND THE CLOSING INSTRUCTION HAS TO AGREE WITH THAT. "Close it once the platform is green again"
  // asks for something that cannot happen when nothing tested the platform — the thread would then be
  // tracking an infrastructure outage under a title that reads as a code regression.
  const nothingRan = Array.isArray(failedJobs) && failedJobs.length
    && failedJobs.every((j) => executedSteps(j) === 0);
  // ── — THE macOS JOB'S OWN WORD, because the API's may not be readable ────────
  //
  // That job now carries `continue-on-error: true` so an allocation failure cannot red `main`. What
  // GitHub then reports as its `conclusion` is a behaviour this file must not guess at — if it reports
  // `success`, the job vanishes from `failedJobs` and the paragraphs above go quiet on exactly the job
  // this notice exists for.
  //
  // So the job states its own case and the value is PASSED here: `executed` is empty when no runner was
  // ever allocated, because the step that sets it never ran. An absence is the one thing a job that
  // never started cannot fake, and it does not depend on how the API chooses to render the conclusion.
  const macosLine = macosExecuted == null ? null
    : String(macosExecuted) !== "true"
      ? "**The macOS job never started** — no runner was allocated, so no step ran and nothing about the "
        + "platform was measured. This is a COULD-NOT-LOOK, not a finding: it is an allocation or billing "
        + "state, and there is no code change that clears it. The run is deliberately NOT red, because a "
        + "red `main` blocks every merge and no fix-forward exists for a run that tested nothing."
      : String(macosOutcome) === "failure"
        ? "**The macOS job ran and failed** — it was allocated a runner and executed steps, so this IS a "
          + "finding about the platform and wants reading as one."
        : null;

  return [
    // NAME THE REF IT ACTUALLY RAN ON. This said "on `main`" unconditionally and the proof run — which
    // ran on a branch — reported itself as a red main. A notice that misnames what broke sends whoever
    // reads it to the wrong tree, and the schedule is not the only event that reaches this file.
    `A ${event === "schedule" ? "nightly" : "manually dispatched"} run went red on \`${ref || "main"}\`.`,
    "",
    window,
    "",
    `**Run:** ${runUrl}`,
    `**Commit:** \`${String(sha).slice(0, 8)}\` ${subject ?? ""}`.trimEnd(),
    "",
    "**Jobs that failed:**",
    jobs,
    "",
    ...(macosLine ? [macosLine, ""] : []),
    nothingRan
      ? "**No job in this run executed a single step**, so nothing here tested the platform and nothing "
        + "in the repository was exercised. Read this as an infrastructure or billing failure until "
        + "something says otherwise — there is no code regression to look for yet."
      : "macOS falsifies three things a Linux-only pipeline cannot see — `node:sqlite`, executable "
        + "resolution across PATH, and spawning a child with a modified environment (#777). A red here "
        + "is one of those, or it is the platform gate itself breaking; both need a person.",
    "",
    nothingRan
      ? "This thread is reused for every red night. Close it once a scheduled run actually executes and "
        + "passes — a run that never started cannot make the platform green."
      : "This thread is reused for every red night. Close it once the platform is green again — the next "
        + "red opens a new one.",
    "",
    "Agent: role-dev · bergface",
  ].join("\n");
}

/**
 * The jq that shapes the jobs payload: a name and the step CONCLUSIONS, never a count.
 *
 * SHAPED, NOT DECIDED — `executedSteps` above has to be able to tell an empty step list from an
 * absent one, and two ordinary jq forms destroy that distinction on the way out: `length` of `null` is
 * `0`, and `[.steps[]?|…]` swallows an absent key into `[]`. Either would have turned a payload change
 * into the sentence "nothing in the repository ran", one layer above every arm that could catch it.
 * Hence the explicit type test, and hence this being a named export the suite can run real payloads
 * through instead of grepping the source for it.
 */
export const FAILED_JOBS_JQ = '[.jobs[]|select(.conclusion=="failure")'
  + '|{name, steps: (if (.steps|type) == "array" then [.steps[]|{conclusion}] else null end)}]';

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

/**
 * A `gh` read whose FAILURE MUST NOT STOP THE NOTICE. Returns null and says so on stderr.
 *
 * The proof dispatch for died here with HTTP 403 — the job's `permissions:` block had omitted
 * `actions: read`, and listing a block sets every unlisted scope to none. The permission is fixed, but
 * the shape was the real defect: a notifier that throws while gathering DETAIL never posts the notice,
 * so a token change, an API blip or a rate limit silently converts "main is red" into total silence.
 * Detail is best-effort. The notice is not.
 */
const ghSoft = (args) => {
  try { return gh(args); }
  catch (e) { console.error(`nightly-notice: could not read ${args[1] ?? args[0]} — ${e?.message?.split("\n")[0]}`); return null; }
};

/**
 * argv -> the run's context. THE SCRIPT IS HANDED ITS CONTEXT, IT DOES NOT REACH FOR IT.
 *
 * These values were read from the ambient GITHUB_* variables at first, and ``/`-10` turned CI
 * red for it: the env audit registers every environment read in the tree as a product variable needing
 * a `.env.example` row and a line of documentation. `GITHUB_RUN_ID` is not a product variable — no
 * deployer ever sets one — so cataloguing them would have been a lie told to satisfy a guard, and
 * exempting them would have put a hole in a ratchet whose whole value is having none.
 *
 * Passing them as arguments removes them from that population honestly rather than by exception, and
 * it makes this function testable: its inputs are visible in the call.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = String(argv[i]).match(/^--([a-z-]+)$/);
    if (m) out[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i] ?? "";
  }
  return out;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const repo = a.repo, runId = a.runId;
  const event = a.event || "schedule";
  const sha = a.sha || "";
  if (!repo || !runId) {
    console.error("nightly-notice: --repo and --run-id are required.");
    process.exit(2);
  }
  const runUrl = `${a.serverUrl || "https://github.com"}/${repo}/actions/runs/${runId}`;

  const jobsRaw = ghSoft(["api", `repos/${repo}/actions/runs/${runId}/jobs`, "--paginate",
    "--jq", FAILED_JOBS_JQ]);
  let failedJobs = null;
  if (jobsRaw !== null) { try { failedJobs = JSON.parse(jobsRaw || "[]"); } catch { failedJobs = null; } }
  const greenRaw = ghSoft(["api", `repos/${repo}/actions/runs?event=schedule&status=success&per_page=1`,
    "--jq", '.workflow_runs[0].created_at // ""']);
  const lastGreenAt = (greenRaw ?? "").trim() || null;

  const body = noticeBody({ runUrl, sha, subject: (a.subject || "").trim(), failedJobs, lastGreenAt,
    macosExecuted: a.macosExecuted ?? null, macosOutcome: a.macosOutcome ?? null,
    nowISO: new Date().toISOString(), event, ref: a.ref });

  // Idempotent: `--force` updates the label if it is already there, so this never fails on a second run.
  try { gh(["label", "create", MARKER_LABEL, "--repo", repo, "--color", "B60205", "--force",
    "--description", "A scheduled run on main went red and has not been cleared"]); }
  catch { /* the label exists and could not be updated; creating the issue below is what matters */ }

  const open = JSON.parse(gh(["issue", "list", "--repo", repo, "--label", MARKER_LABEL,
    "--state", "open", "--limit", "1", "--json", "number"]) || "[]");

  if (open.length) {
    gh(["issue", "comment", String(open[0].number), "--repo", repo, "--body", body]);
    console.log(`nightly-notice: commented on the open #${open[0].number}`);
    return;
  }
  const url = gh(["issue", "create", "--repo", repo, "--label", MARKER_LABEL,
    "--title", `A scheduled run on ${a.ref || "main"} went red (${String(sha).slice(0, 8)})`,
    "--body", body]).trim();
  console.log(`nightly-notice: opened ${url}`);
}

if (isEntrypoint(import.meta.url)) main();
