// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A push that moves the engine pins asks for a bench replay, and only such a push.
//
// The request is a `bench replay` status, pending and described `waiting`, on the pushed commit. Each arm
// below holds one path of the decision (scripts/bench-replay-request.mjs) with injected readers, so no
// repository or network is needed, and the last arms hold the workflow that runs it to what it may do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, pinsAt, CONTEXT, PIN_FILES } from "../../scripts/bench-replay-request.mjs";
import { pinState } from "../../scripts/engine-pins.mjs";
import { verdict } from "../../scripts/release-bench-replay-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "bench-replay.yml"), "utf8");
const SCRIPT = readFileSync(join(ROOT, "scripts", "bench-replay-request.mjs"), "utf8");

const state = (digest) => ({ digest, pins: {}, schema: 1 });
const readers = (byCommit) => (c) => {
  if (!(c in byCommit)) throw new Error(`could not look at ${c}`);
  return state(byCommit[c]);
};
const noSquash = async () => null;
const never = async () => { throw new Error("no replay should be read on this path"); };

test("pins equal to the parent's ask for nothing", async () => {
  assert.equal(await decide({ sha: "new", parent: "old", pins: readers({ new: "A", old: "A" }), squashHead: noSquash, replay: never }), null);
});

test("pins that moved ask: pending, described waiting", async () => {
  assert.deepEqual(await decide({ sha: "new", parent: "old", pins: readers({ new: "B", old: "A" }), squashHead: noSquash, replay: never }),
    { state: "pending", description: "waiting" });
});

test("a parent the rule cannot read asks too: could-not-tell is never unchanged", async () => {
  assert.deepEqual(await decide({ sha: "new", parent: "ancient", pins: readers({ new: "B" }), squashHead: noSquash, replay: never }),
    { state: "pending", description: "waiting" });
});

test("a squash whose pull-request head already has a final answer for the same pins carries that answer", async () => {
  for (const answer of [{ state: "success", description: "pass" }, { state: "failure", description: "flag" }]) {
    const got = await decide({ sha: "squash", parent: "old", pins: readers({ squash: "B", old: "A", head: "B" }),
      squashHead: async () => "head", replay: async (s) => (s === "head" ? answer : null) });
    assert.deepEqual(got, answer);
  }
});

test("a squash asks again when its head has no final answer, or answered for other pins", async () => {
  const waiting = { state: "pending", description: "waiting" };
  const pending = await decide({ sha: "squash", parent: "old", pins: readers({ squash: "B", old: "A", head: "B" }),
    squashHead: async () => "head", replay: async () => waiting });
  assert.deepEqual(pending, waiting, "a pending head is not an answer");
  const none = await decide({ sha: "squash", parent: "old", pins: readers({ squash: "B", old: "A", head: "B" }),
    squashHead: async () => "head", replay: async () => null });
  assert.deepEqual(none, waiting, "no status at all is not an answer");
  const other = await decide({ sha: "squash", parent: "old", pins: readers({ squash: "B", old: "A", head: "C" }),
    squashHead: async () => "head", replay: async () => ({ state: "success", description: "pass" }) });
  assert.deepEqual(other, waiting, "a pass for different pins does not carry over");
});

test("a commit is judged by the rule of the checkout it runs in", () => {
  assert.deepEqual(pinsAt("HEAD", { cwd: ROOT }), pinState(ROOT));
});

test("the workflow runs on the line's branches, on the pin files, with nothing but the request's rights", () => {
  for (const branch of ["main", "'beta-*'", "'next-*'"]) assert.match(WORKFLOW, new RegExp(`branches: \\[[^\\]]*${branch.replace(/[*]/g, "\\*")}`), branch);
  for (const path of [...PIN_FILES, "scripts/engine-pins.mjs", "scripts/bench-replay-request.mjs"]) {
    assert.match(WORKFLOW, new RegExp(`^ {6}- ${path.replace(/[.]/g, "\\.")}$`, "m"), `${path} is watched`);
  }
  assert.match(WORKFLOW, /^permissions: \{\}$/m, "nothing by default");
  const job = WORKFLOW.match(/^ {4}permissions:\n((?: {6}[a-z-]+: \S+.*\n)+)/m)?.[1] ?? "";
  assert.deepEqual(job.trim().split("\n").map((l) => l.trim().split(/\s+#/)[0].trim()).sort(),
    ["contents: read", "pull-requests: read", "statuses: write"]);
  assert.match(WORKFLOW, /fetch-depth: 0/, "the parent must be in the checkout to be judged");
  assert.match(WORKFLOW, /run: node scripts\/bench-replay-request\.mjs$/m);
});

test("the status it sets carries the context and one word, never a link", () => {
  assert.equal(CONTEXT, "bench replay");
  assert.doesNotMatch(SCRIPT, /target_url/, "no link from a public commit to anything");
  assert.match(SCRIPT, /JSON\.stringify\(\{ state: decision\.state, context: CONTEXT, description: decision\.description \}\)/);
});

// ── THE CUT READS THE ANSWER ────────────────────────────────────────────────────────────────────────
// scripts/release-bench-replay-check.mjs, with injected readers: the pins of each commit, main's own line
// since the last cut (newest first), and the latest `bench replay` state on a commit.

const cutOf = (pinsBy, lineCommits, answers = {}) => verdict({
  head: lineCommits[0] ?? "head", since: "tag", pins: readers(pinsBy),
  line: () => lineCommits, replay: async (s) => answers[s] ?? null,
});

test("a cut with no pin moved since the last one reads nothing and goes ahead", async () => {
  const v = await cutOf({ head: "A", tag: "A" }, ["head"], { head: { state: "failure", description: "flag" } });
  assert.equal(v.hold, false);
  assert.match(v.why, /no engine pin moved since tag/);
});

test("a moved pin goes ahead on a pass carried by any commit with today's pins", async () => {
  const v = await cutOf({ head: "B", mid: "B", move: "B", old: "A", tag: "A" }, ["head", "mid", "move", "old"],
    { move: { state: "success", description: "pass" } });
  assert.equal(v.hold, false);
  assert.match(v.why, /bench replay: pass on move/);
});

test("a pass for older pins does not carry a newer move", async () => {
  const v = await cutOf({ head: "C", old: "B", tag: "A" }, ["head", "old"], { old: { state: "success", description: "pass" } });
  assert.equal(v.hold, true);
  assert.match(v.why, /not reported/);
});

test("a flag holds the cut and says how it is lifted", async () => {
  const v = await cutOf({ head: "B", tag: "A" }, ["head"], { head: { state: "failure", description: "flag" } });
  assert.equal(v.hold, true);
  assert.match(v.why, /flagged on head — fix it, or explain it on the change's issue and set pass by hand/);
});

test("waiting, or no answer at all, holds the cut as not reported", async () => {
  const waiting = await cutOf({ head: "B", tag: "A" }, ["head"], { head: { state: "pending", description: "waiting" } });
  assert.equal(waiting.hold, true);
  assert.match(waiting.why, /not reported .*\(still waiting\)/);
  const silent = await cutOf({ head: "B", tag: "A" }, ["head"]);
  assert.equal(silent.hold, true);
  assert.match(silent.why, /not reported/);
});

test("a last cut the rule cannot read is a move, never no change", async () => {
  const v = await cutOf({ head: "B" }, ["head"]);
  assert.equal(v.hold, true, "an unreadable tag must not read as equal pins");
});

test("the release workflow reads it on every cut, before the notes are consumed", () => {
  const release = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const step = release.indexOf("- name: A moved engine pin has a passing bench replay");
  assert.ok(step > 0, "the step exists");
  assert.ok(step < release.indexOf("changesets/action"), "it runs before the version step consumes the notes");
  assert.match(release.slice(step, step + 400), /run: node scripts\/release-bench-replay-check\.mjs/);
});
