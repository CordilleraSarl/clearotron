#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-approve-parked.mjs — approve the version pull request's parked CI run, so a cut does not wait
// on a person.
//
// WHY A PERSON HAS BEEN CLICKING. The version pull request is authored by the repository's own Actions
// bot, and a run triggered by a bot-authored pull request arrives `action_required`. Measured across the
// last forty `pull_request` CI runs: every parked one is on the version branch and no human-authored
// branch parks, so the thing that distinguishes them is the author, not a repository setting. The
// approval endpoint works on such a run — proved against a live parked run, which moved from
// `action_required` to `queued` — even though its documentation names fork pull requests only.
//
// AND WHY IT NEEDS A TOKEN RATHER THAN THE BUILT-IN ONE. `GITHUB_TOKEN` cannot approve a workflow run;
// GitHub blocks self-approval deliberately. So this reads a separate token with Actions read and write.
//
// WHAT THAT PERMISSION ACTUALLY BUYS, stated because the next person deciding whether to reuse this
// secret will read this sentence and not the permission page. Actions write is not "approve runs": it
// also creates workflow_dispatch events, cancels any run in the repository, and deletes run logs. This
// workflow carries `workflow_dispatch`, so the token can reach a PUBLISH by the same door a person
// uses. It cannot push code, open or merge a pull request, or authenticate to the registry — the
// publish credential is minted per run from this workflow's OIDC token and stored nowhere. So the
// boundary is real but it is not "it can only do what this script does".
//
// IT NEVER FAILS THE CUT. No token, no parked run, an API that refuses — each prints what happened and
// exits 0, because the cut's own wait still ends the way it always did: a person clicks, or the wait
// expires. A step that could turn a green cut red in order to save a click would be a worse trade than
// the click.
//
// BY SHA, AND ONLY THE CURRENT ONE. Approving a STALE parked run cancels the live one — CI's concurrency
// is workflow plus ref with cancel-in-progress on non-main refs — so this resolves the version branch's
// head at the moment it runs and approves only a run whose `head_sha` equals it.
//
// THE INTERVAL THAT MATTERS IS BETWEEN THE READ AND THE POST. Filtering the run list by head_sha and
// re-checking head_sha per row guards a case the API already guarantees; no row can disagree with the
// value it was queried by. The way this goes wrong is the HEAD going stale: the version step
// force-pushes that branch whenever it runs, so a push landing between the list and the approval leaves
// this approving the run on the superseded head — the exact act that cancels the live cut. The head is
// therefore re-read immediately before each approval, and a move aborts the whole pass rather than
// skipping one row, because if the branch moved then every id in the list is stale.
import { argv, env, exit } from "node:process";
import { pathToFileURL } from "node:url";

const REPO = env.GITHUB_REPOSITORY || "CordilleraSarl/clearotron";
const BRANCH = arg("--branch") || "changeset-release/main";
const TOKEN = env.ACTIONS_APPROVE_TOKEN || "";

function arg(name) { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; }
const say = (s) => process.stdout.write(`release-approve-parked: ${s}\n`);

async function api(path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  return r;
}

/**
 * THE DECISION, SEPARATED FROM THE NETWORK so it can be driven against a table rather than matched as
 * source text. Given the runs on a head and that head, which run ids should be approved?
 *
 * `event` AND `conclusion` both: the dispatched CI run on the same head is not the one the pull
 * request's rollup reads, and approving it would do nothing while reading as success. PURE.
 */
export function runsToApprove(runs, head) {
  return (Array.isArray(runs) ? runs : [])
    .filter((r) => r?.event === "pull_request" && r?.conclusion === "action_required" && r?.head_sha === head)
    .map((r) => r.id);
}

// The run list is PAGED, and a silent truncation here reads as "nothing parked". 100 is the API maximum;
// the loop stops when a page comes back short, and says so if it ever hits the cap, because a cut that
// was not approved because the list was cut off should not look like a cut with nothing to approve.
async function allRunsOn(head) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await api(`/repos/${REPO}/actions/runs?head_sha=${head}&per_page=100&page=${page}`);
    if (!r.ok) return { ok: false, status: r.status, runs: out };
    const batch = (await r.json())?.workflow_runs ?? [];
    out.push(...batch);
    if (batch.length < 100) return { ok: true, runs: out };
  }
  say(`more than 500 runs on this head — reading the first 500 only.`);
  return { ok: true, runs: out };
}

// One reading of "where is the version branch now", used twice: once to choose, once immediately before
// the approval. Null means the question could not be answered, which is never treated as "unchanged".
async function branchHead() {
  const br = await api(`/repos/${REPO}/branches/${encodeURIComponent(BRANCH)}`);
  if (!br.ok) return null;
  return (await br.json())?.commit?.sha ?? null;
}

async function main() {
  // THE ABSENT SECRET IS THE ORDINARY CASE UNTIL THE TOKEN IS MINTED, and it must read as ordinary.
  if (!TOKEN) {
    say("no ACTIONS_APPROVE_TOKEN — nothing approved; the version run waits for a person, as before.");
    return 0;
  }

  const head = await branchHead();
  if (!head) { say(`could not read ${BRANCH} — nothing approved.`); return 0; }
  say(`${BRANCH} is at ${head.slice(0, 7)}`);

  const rr = await allRunsOn(head);
  if (!rr.ok) { say(`could not list runs for ${head.slice(0, 7)} (${rr.status}) — nothing approved.`); return 0; }
  const ids = runsToApprove(rr.runs, head);
  if (!ids.length) {
    const others = rr.runs.filter((r) => r?.conclusion === "action_required").length;
    say(`no parked pull_request run on ${head.slice(0, 7)}${others ? ` (${others} parked on another event or head, left alone)` : ""} — nothing to approve.`);
    return 0;
  }

  for (const id of ids) {
    // ── THE INTERVAL THAT MATTERS IS BETWEEN THE READ AND THE POST, NOT INSIDE THE LIST ──────────────
    //
    // Filtering the list by head_sha and then re-checking head_sha on each row guards a case the API
    // already guarantees: no row can disagree with the value it was queried by. What can actually go
    // wrong is `head` itself going stale — the version step force-pushes this branch whenever it runs,
    // so a push landing between the list and this POST leaves us approving the run on the SUPERSEDED
    // head. That is precisely the act that cancels the live cut, because CI's concurrency is workflow
    // plus ref with cancel-in-progress on non-main refs.
    //
    // So the head is re-read immediately before each approval, and a move aborts rather than skips: if
    // the branch has moved, every id in this list is stale, not just this one.
    const now = await branchHead();
    if (now == null) { say(`could not re-read ${BRANCH} before approving — nothing approved.`); return 0; }
    if (now !== head) {
      say(`${BRANCH} moved ${head.slice(0, 7)} -> ${now.slice(0, 7)} since the run list was taken — ` +
        `NOTHING APPROVED. Approving a run on the superseded head would cancel the live one; the cut ` +
        `waits for a person, or for the next dispatch.`);
      return 0;
    }
    const a = await api(`/repos/${REPO}/actions/runs/${id}/approve`, { method: "POST" });
    say(a.ok ? `approved run ${id} on ${head.slice(0, 7)}.` : `run ${id} refused approval (${a.status}) — the cut still waits for a person.`);
  }
  return 0;
}

// RUN WHEN INVOKED, whatever the file is called. The old guard compared argv[1] to this file's NAME, so
// a rename made the step print nothing and exit 0 — a script that never ran, wearing the face of a
// successful no-op. Comparing the resolved URLs asks the real question instead.
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) main().then((c) => exit(c)).catch((e) => { say(`could not run (${e?.message ?? e}) — nothing approved.`); exit(0); });
