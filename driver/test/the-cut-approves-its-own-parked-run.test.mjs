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
import { fileURLToPath } from "node:url";
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

test("IT APPROVES ONLY THE CURRENT HEAD, because a stale approval cancels the live run", () => {
  // CI's concurrency is workflow plus ref with cancel-in-progress on non-main refs, so approving a run
  // parked on an earlier head starts it and cancels the one testing the head that matters.
  assert.match(SRC, /head_sha=\$\{head\}/, "the run list is not filtered by the branch's head");
  assert.match(SRC, /r\.head_sha !== head/, "there is no per-row re-check of the head before approving");
  assert.match(SRC, /LEFT ALONE/, "a run on another head is not named as left alone");
  // AND THE EVENT, because the dispatched CI run on the same head never enters the pull request's
  // rollup — approving that one does nothing while reading as success.
  assert.match(SRC, /r\.event === "pull_request"/, "it does not distinguish the pull_request run from the dispatched one");
});
