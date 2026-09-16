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
// GitHub blocks self-approval deliberately. So this reads a separate token with Actions write, and the
// whole of what it can do is start a run that a person would otherwise start by hand.
//
// IT NEVER FAILS THE CUT. No token, no parked run, an API that refuses — each prints what happened and
// exits 0, because the cut's own wait still ends the way it always did: a person clicks, or the wait
// expires. A step that could turn a green cut red in order to save a click would be a worse trade than
// the click.
//
// BY SHA, AND ONLY THE CURRENT ONE. Approving a STALE parked run cancels the live one — CI's concurrency
// is workflow plus ref with cancel-in-progress on non-main refs — so this resolves the version branch's
// head at the moment it runs and approves only a run whose `head_sha` equals it. A run parked on an
// earlier head is left alone and named, because it is somebody else's problem and cancelling the live
// run to tidy it up is the failure this rule exists to prevent.
import { argv, env, exit } from "node:process";

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

async function main() {
  // THE ABSENT SECRET IS THE ORDINARY CASE UNTIL THE TOKEN IS MINTED, and it must read as ordinary.
  if (!TOKEN) {
    say("no ACTIONS_APPROVE_TOKEN — nothing approved; the version run waits for a person, as before.");
    return 0;
  }

  const br = await api(`/repos/${REPO}/branches/${encodeURIComponent(BRANCH)}`);
  if (!br.ok) { say(`could not read ${BRANCH} (${br.status}) — nothing approved.`); return 0; }
  const head = (await br.json())?.commit?.sha;
  if (!head) { say(`${BRANCH} named no head commit — nothing approved.`); return 0; }
  say(`${BRANCH} is at ${head.slice(0, 7)}`);

  const rr = await api(`/repos/${REPO}/actions/runs?head_sha=${head}&per_page=50`);
  if (!rr.ok) { say(`could not list runs for ${head.slice(0, 7)} (${rr.status}) — nothing approved.`); return 0; }
  const runs = (await rr.json())?.workflow_runs ?? [];

  // `event` AND `conclusion` BOTH, because the dispatched CI run on the same head is not the one the
  // pull request's rollup reads, and approving it would do nothing while reading as success.
  const parked = runs.filter((r) => r.event === "pull_request" && r.conclusion === "action_required");
  if (!parked.length) {
    const others = runs.filter((r) => r.conclusion === "action_required").length;
    say(`no parked pull_request run on ${head.slice(0, 7)}${others ? ` (${others} parked on another event, left alone)` : ""} — nothing to approve.`);
    return 0;
  }

  for (const r of parked) {
    // A BELT-AND-BRACES RE-READ OF THE SHA. The list was filtered by head_sha, and this asserts it on the
    // row itself, because approving a run on any other head cancels the live one.
    if (r.head_sha !== head) { say(`run ${r.id} is on ${r.head_sha.slice(0, 7)}, not ${head.slice(0, 7)} — LEFT ALONE.`); continue; }
    const a = await api(`/repos/${REPO}/actions/runs/${r.id}/approve`, { method: "POST" });
    say(a.ok ? `approved run ${r.id} on ${head.slice(0, 7)}.` : `run ${r.id} refused approval (${a.status}) — the cut still waits for a person.`);
  }
  return 0;
}

if (argv[1] && argv[1].endsWith("release-approve-parked.mjs")) main().then((c) => exit(c)).catch((e) => { say(`could not run (${e?.message ?? e}) — nothing approved.`); exit(0); });
