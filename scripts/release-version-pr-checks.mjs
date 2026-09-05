// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-version-pr-checks.mjs — did anything actually START on the standing version pull request?
//
// AUTO-MERGE WAITS FOR REQUIRED CHECKS, AND A CHECK THAT NEVER STARTS IS NOT A CHECK THAT FAILED.
// The step before this one enables auto-merge on the version pull request: GitHub merges it once its
// checks pass, and that merge is what cuts the version. Nobody clicks anything. So the checks are the
// only thing standing between a merge to `main` and a publish to the registry, and the question this
// asks is the one nobody thinks to ask — not "did they pass" but "did they run at all".
//
// MEASURED, 2026-09-05, ON THIS REPOSITORY, TWICE. The fork-pull-request approval policy was set to
// "all external contributors" that morning. GitHub counts `github-actions[bot]` — the author of the
// version pull request — as external, so the run for that pull request was created in `action_required`
// and waited for a person who did not know they were being waited for. The pull request carried ZERO
// check runs. Auto-merge had nothing to wait for and nothing to refuse on; the version sat unmerged, the
// release notes stayed pending, and the next push would have tried to publish a version already on the
// registry.
//
// The policy was narrowed to `first_time_contributors` and it happened AGAIN the same afternoon: being
// merged is not what takes an author off that list, and the bot's pull requests are consumed by the
// pipeline rather than merged by a person. It was narrowed again, to
// `first_time_contributors_new_to_github`.
//
// SO THE FINDING PRINTS THE POLICY IT READS, NOT THE ONE THIS COMMENT REMEMBERS. Three values in one
// day is what a setting looks like when it is being tuned, and a guard that names a stale one sends the
// next reader to check something that has already changed.
//
// TWO SHAPES, BOTH REFUSED, AND COUNTING CHECK RUNS SEES ONLY ONE OF THEM. `action_required` lives on
// the WORKFLOW RUN, not on the check runs — a run waiting for approval publishes no check runs at all.
// So a bare "is the count above zero" does refuse the run above, but it refuses it as "nothing started",
// which sends the next reader hunting a broken trigger when the answer is a repository setting. And it
// passes the shape one step along: checks running for one workflow while a second sits parked, where the
// count is not zero and the pull request still never merges. "Nothing has started" and "something is
// waiting for a person" are different findings, read off different surfaces, and get different words.
//
// A PERSON IS NOT WAITED OUT. `action_required` returns immediately rather than polling: the blocker is
// somebody clicking a button, and no amount of waiting inside a job resolves it.
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

/** Something is executing. The pull request will merge or it will not, and either is an answer. */
export const RUNNING = "running";
/** No check run exists for this head. The empty state that reads as a pass and is not one. */
export const NOTHING_STARTED = "nothing-started";
/** A run is parked pending an approval. Auto-merge will wait for it forever. */
export const WAITING_FOR_A_PERSON = "waiting-for-a-person";

const ACTION_REQUIRED = "action_required";

const parked = (r) => r?.status === ACTION_REQUIRED || r?.conclusion === ACTION_REQUIRED;
const nameOf = (r) => r?.name ?? "(unnamed)";

/**
 * Two runs of the SAME workflow. By id where the surface carries one, by displayed name otherwise —
 * a name is what a hand-written fixture has, and the id is what a rename cannot break.
 */
const sameWorkflow = (a, b) => (a?.workflowId != null && b?.workflowId != null)
  ? a.workflowId === b.workflowId
  : nameOf(a) === nameOf(b);

/**
 * Is this parked run's work already being done by another run of the same workflow on this commit?
 *
 * THE PARK IS REAL AND IT IS INERT, AND ONLY THE SECOND HALF IS NEW. The version job dispatches
 * `ci.yml` on the version branch precisely because the `pull_request` run for that branch parks: a
 * dispatch is not a fork event and needs no approval. Both runs are the same workflow, so they publish
 * the same check names on the same commit, which is what branch protection matches on. Auto-merge is
 * therefore satisfied by the dispatched run while the parked one sits there forever, producing nothing.
 *
 * WITHOUT THIS THE GUARD REFUSES THE MECHANISM IT WAS BUILT TO SERVE. Measured on run 33978047936,
 * 2026-09-05: the dispatch had already created run 33978067528 and its first required check had gone
 * green, and this script still reported "waiting for somebody to approve it" because the parked run was
 * on the same commit. It read a true fact and drew a false conclusion from it.
 *
 * A PARK BESIDE AN UNRELATED GREEN RUN IS STILL A REFUSAL, which is the case this must not weaken: a
 * parked `Release` beside a green `CI` means nothing is producing `Release`'s contexts and auto-merge
 * waits for them forever. The question is not "is something else running" — it is "is something else
 * running THIS", and only the second one is evidence.
 */
const supersededBy = (run, runs) => runs.some((o) => o !== run && !parked(o) && sameWorkflow(o, run));

/** What the sentence says about the policy, given whatever could be read about it. */
const policySentence = (policy) => policy
  ? `The repository's fork-pull-request approval policy is currently \`${policy}\`, and it counts `
    + "github-actions[bot] as a contributor who needs approving."
  : "The repository's fork-pull-request approval policy could not be read from here, and it is the "
    + "setting to look at: it counts github-actions[bot] as a contributor who needs approving.";

/**
 * What the two surfaces say about one commit. PURE.
 *
 * @param {{checkRuns?: Array, workflowRuns?: Array}} seen
 *   `checkRuns` from `commits/{sha}/check-runs`, `workflowRuns` from `actions/runs?head_sha=`.
 * @returns {{state: string, blocked: string[], reason: string}}
 *
 * The order is deliberate. A parked run reports ZERO check runs, so asking about emptiness first would
 * answer "nothing started" to a question whose real answer is "somebody has to click approve" — true,
 * useless, and it sends the next reader to look for a broken trigger.
 */
export function checksVerdict({ checkRuns = [], workflowRuns = [], policy = null } = {}) {
  const blocked = [
    ...workflowRuns.filter((r) => parked(r) && !supersededBy(r, workflowRuns)),
    ...checkRuns.filter(parked),
  ].map(nameOf);
  if (blocked.length) {
    return {
      state: WAITING_FOR_A_PERSON,
      blocked,
      reason: `${blocked.join(", ")} is waiting for somebody to approve it. Auto-merge waits for a check `
        + "that will never finish on its own, so the version cannot be cut. " + policySentence(policy),
    };
  }
  if (!checkRuns.length) {
    return {
      state: NOTHING_STARTED,
      blocked: [],
      reason: "no check run exists for this commit. Auto-merge is enabled and has nothing to wait for, "
        + "so either the required checks will never arrive or they are not required at all — and an "
        + "empty list is what both look like.",
    };
  }
  return {
    state: RUNNING,
    blocked: [],
    reason: `${checkRuns.length} check(s) started: ${checkRuns.map(nameOf).join(", ")}.`,
  };
}

/**
 * Poll until something starts, or until the window runs out.
 *
 * `sleep` and `read` are injected so the waiting is drivable without a clock or a network. The window is
 * generous on purpose: a check row can land minutes after the event that fired it during a GitHub
 * incident, and this is the difference between a false red on the version job — cheap, loud, retried by
 * the next push — and a red that means what it says.
 */
export async function waitForChecks({ read, sleep, attempts = 32, everyMs = 15000 } = {}) {
  if (typeof read !== "function") throw new Error("release-version-pr-checks: waitForChecks needs a read()");
  let seen = null;
  for (let i = 1; i <= attempts; i++) {
    seen = { ...checksVerdict(await read()), attempts: i };
    if (seen.state !== NOTHING_STARTED) return seen;
    if (i < attempts) await sleep(everyMs);
  }
  return seen;
}

const gh = (args) => JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8" }));

/**
 * The repository's current fork-pull-request approval policy, or null when it cannot be read.
 *
 * FAILS SOFT ON PURPOSE. This is read while explaining why a release has stopped; a guard that threw
 * here would replace a useful finding with a stack trace about a permission. The endpoint needs
 * `administration: read`, which the version job grants for this one sentence.
 */
export function approvalPolicy(repo, api = gh) {
  try {
    return api([`repos/${repo}/actions/permissions/fork-pr-contributor-approval`]).approval_policy ?? null;
  } catch {
    return null;
  }
}

/** The two surfaces, read for one commit. Field names are trimmed to what the verdict reads. */
export function surfacesFor(repo, sha, api = gh) {
  const checkRuns = (api([`repos/${repo}/commits/${sha}/check-runs`]).check_runs ?? [])
    .map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
  // `workflow_id` travels because a parked run and the run superseding it are the same workflow under
  // two events, and an id says so where a display name only suggests it.
  const workflowRuns = (api([`repos/${repo}/actions/runs?head_sha=${sha}`]).workflow_runs ?? [])
    .map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, workflowId: r.workflow_id }));
  return { checkRuns, workflowRuns };
}

async function main() {
  const pr = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  if (!pr || !repo) {
    console.error("usage: release-version-pr-checks.mjs <pull-request-number>   (GITHUB_REPOSITORY must be set)");
    process.exitCode = 2;
    return;
  }
  let sha;
  try {
    sha = gh([`repos/${repo}/pulls/${pr}`]).head.sha;
  } catch (e) {
    console.error(`release-version-pr-checks: could not read pull request ${pr}: ${e.message}`);
    process.exitCode = 2;   // could-not-look, never a pass
    return;
  }
  console.log(`Waiting for the version pull request's checks to start on ${sha}.`);
  const seen = await waitForChecks({
    read: () => ({ ...surfacesFor(repo, sha), policy: approvalPolicy(repo) }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  if (seen.state === RUNNING) {
    console.log(seen.reason);
    return;
  }
  console.error(`::error::The version pull request (#${pr}) will not merge itself: ${seen.reason}`);
  process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) await main();
