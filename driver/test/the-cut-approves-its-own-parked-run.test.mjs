// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CUT APPROVES THE VERSION PULL REQUEST'S OWN PARKED RUN.
//
// A run triggered by a bot-authored pull request arrives `action_required`, and the version pull request
// is authored by this repository's own Actions bot. Until somebody approves it the checks never complete,
// auto-merge never fires, and the cut's wait expires watching a merge that could not happen. Four cuts in
// a row were finished by a person clicking.
//
// WHAT THESE CHECKS ARE FOR is the shape of the step rather than the approval itself: the approval needs a
// live parked run and a token, and neither exists in a test. So they hold the three properties that decide
// whether it is safe to have at all — it cannot fail the cut, it reads a token that is not the built-in
// one, and it approves only the current head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const YML = readFileSync(join(REPO, ".github/workflows/release.yml"), "utf8");
const SCRIPT = join(REPO, "scripts/release-approve-parked.mjs");
const SRC = readFileSync(SCRIPT, "utf8");

test("the step is wired into the cut, and reads a token that is NOT the built-in one", () => {
  assert.match(YML, /- name: Approve the version pull request's own parked run/,
    "the cut no longer approves its own parked run");
  assert.match(YML, /ACTIONS_APPROVE_TOKEN: \$\{\{ secrets\.ACTIONS_APPROVE_TOKEN \}\}/,
    "the step does not read the approval token from a secret");
  // THE FLOOR UNDER THE WHOLE CHANGE. `GITHUB_TOKEN` cannot approve a workflow run — GitHub blocks
  // self-approval — so a step wired to it would be inert and would read as working.
  const step = YML.slice(YML.indexOf("Approve the version pull request's own parked run"));
  const body = step.slice(0, step.indexOf("- name:", 10));
  assert.ok(!/GITHUB_TOKEN/.test(body), "the approval step is wired to GITHUB_TOKEN, which cannot approve a run");
});

test("IT CANNOT FAIL THE CUT — no token is an ordinary outcome, not a refusal", () => {
  // Driven, not read: the script is run with the variable empty and must exit 0 saying what it did not do.
  const out = execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ACTIONS_APPROVE_TOKEN: "" }, encoding: "utf8",
  });
  assert.match(out, /no ACTIONS_APPROVE_TOKEN/, "it does not say why it approved nothing");
  assert.match(out, /waits for a person/, "it does not say what happens instead");
  // execFileSync throws on a non-zero exit, so reaching here IS the exit-0 assertion. Said out loud
  // because a reader looking for an explicit status check would otherwise think one was missing.
});

test("IT APPROVES ONLY THE CURRENT HEAD — driven, not matched", async () => {
  // CI's concurrency is workflow plus ref with cancel-in-progress on non-main refs, so approving a run
  // parked on an earlier head starts it and CANCELS the one testing the head that matters.
  //
  // DRIVEN AGAINST A TABLE rather than matched against source text. The earlier version of this arm
  // asserted the string `r.head_sha !== head` was present, which pinned a check the API already
  // guarantees, stayed green with the real defect (a stale `head`) present, and would have reddened on
  // a rename that changed nothing. The decision is pure — given a head and a list of runs, which ids
  // get approved — so drive that.
  const { runsToApprove } = await import(pathToFileURL(SCRIPT).href);
  const HEAD = "a".repeat(40), OLD = "b".repeat(40);
  const run = (id, over = {}) => ({ id, event: "pull_request", conclusion: "action_required", head_sha: HEAD, ...over });

  const table = [
    ["the parked run on the current head is approved", [run(1)], [1]],
    ["a run parked on an EARLIER head is not", [run(2, { head_sha: OLD })], []],
    ["the dispatched run on the same head is not — it never enters the rollup",
      [run(3, { event: "workflow_dispatch" })], []],
    ["a pull_request run that is not parked is not", [run(4, { conclusion: "success" })], []],
    ["a run still in flight (no conclusion) is not", [run(5, { conclusion: null })], []],
    ["the current head is picked out of a mixed list",
      [run(6, { head_sha: OLD }), run(7), run(8, { event: "push" })], [7]],
    ["nothing at all is an empty set, not a throw", [], []],
    ["a malformed row does not take the pass down with it", [null, undefined, {}, run(9)], [9]],
  ];
  for (const [what, runs, want] of table) {
    assert.deepEqual(runsToApprove(runs, HEAD), want, what);
  }

  // THE PLANT: move the head and the chosen set must empty. A decision that ignored the head entirely
  // would pass every row above and fail here.
  assert.deepEqual(runsToApprove([run(1), run(2)], OLD), [],
    "moving the head left runs selected — the head is not actually deciding anything");
});

test("THE HEAD IS RE-READ IMMEDIATELY BEFORE THE APPROVAL, because that is the interval that can go stale", () => {
  // The version step force-pushes the version branch whenever it runs. A push landing between the run
  // list and the POST leaves this approving the run on the SUPERSEDED head — which is the act that
  // cancels the live cut. No row ever disagrees with the head it was queried by; the head is what moves.
  //
  // This one stays a source read because the alternative is a fake HTTP layer for one ordering
  // property, and says so rather than pretending it drives anything.
  const loop = SRC.slice(SRC.indexOf("for (const id of ids)"));
  assert.match(loop, /await branchHead\(\)/,
    "the head is not re-read inside the approval loop — a force-push between the list and the POST would go unnoticed");
  assert.ok(loop.indexOf("await branchHead()") < loop.indexOf("/approve"),
    "the head is re-read AFTER the approve call, which is too late to prevent anything");
  assert.match(loop, /return 0;/,
    "a moved head does not abort the pass — if the branch moved, every id in the list is stale, not just this one");
});
