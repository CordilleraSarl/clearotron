// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine-build-at-run-start.test.mjs —: a run says which engine it loaded, in its own artifacts.
//
// THE DEFECT THIS CLOSES IS A JOIN, not a missing field. `engineCommit()` has stamped the sha into the
// POOL COPY since, and everything downstream of a PUBLISHED run could read it. What could not:
// a run that failed, a run that was aborted, and — the one that cost rulings — the ARCHIVED RUN DIR,
// which is a different population from the pool copy. So attribution was reconstructed by joining a
// checkout's reflog against each run's `startedAt`, and that reconstruction decided three
// certifications in one morning (,) with two near-misses in two days.
//
// ── WHAT EACH ARM IS FOR, because "it writes a field" is not the claim ─────────────────────────────
//
// The interesting failures are not "the sha is absent". They are:
//   · the sha is present and names a commit the run did not execute (a dirty tree);
//   · the sha is present and is the WRONG REPOSITORY's (`run.jsonl` already carries a `head`, and it
//     is the doctrine store's — reading it as the engine's is the confusion  was filed about);
//   · git cannot answer and the absence reads as clean.
//
// Each of those gets an arm. The plain happy path gets one line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");

// ── the pure half: the classifier, over real git checkouts ────────────────────────────────────────
//
// Driven against a REAL repository rather than a stubbed `git`, because every property here is a
// property of git's answers — what `rev-parse` prints on a detached HEAD, what `status --porcelain`
// says about an untracked file — and a stub would be asserting my model of git, not git.

const mkRepo = () => {
  const d = mkdtempSync(join(tmpdir(), "eng-prov-"));
  const g = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t.test");
  g("config", "user.name", "t");
  writeFileSync(join(d, "a.txt"), "one\n");
  g("add", "-A");
  g("commit", "-q", "-m", "first");
  return { dir: d, git: g, head: g("rev-parse", "HEAD").trim() };
};

/**
 * The classifier over an explicit root.
 *
 * THE FIRST VERSION OF THIS HELPER WAS THE BUG. It copied engine-build.mjs INTO the repo under test to
 * move the module's `HERE`, and the copy registered as untracked dirt — so the arm asserting "clean"
 * measured its own instrument and failed. `classifyEngineCheckout(root)` exists because of that, and
 * this helper is now one line.
 */
const provenanceIn = async (dir) => (await import("../engine-build.mjs")).classifyEngineCheckout(dir);

test("#1423 a CLEAN checkout reports its sha, its branch, and no dirt", async () => {
  const r = mkRepo();
  try {
    const p = await provenanceIn(r.dir);
    assert.equal(p.outcome, "clean", p.detail);
    assert.equal(p.engineHead, r.head, "the full 40-char sha, not an abbreviation");
    assert.equal(p.engineHead.length, 40);
    assert.equal(p.engineBranch, "main");
    assert.deepEqual(p.engineDirt, []);
    assert.match(p.detail, /working tree clean/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("#1423 A DIRTY TREE IS SAID TO BE DIRTY — the sha alone would name code the run did not execute", async () => {
  const r = mkRepo();
  try {
    writeFileSync(join(r.dir, "a.txt"), "one\ntwo\n");   // tracked, modified
    const p = await provenanceIn(r.dir);
    assert.equal(p.outcome, "dirty", p.detail);
    assert.equal(p.engineHead, r.head, "the sha is still reported — it is the BASE, and a reader needs it");
    assert.equal(p.engineDirt.length, 1);
    assert.match(p.detail, /did NOT execute/,
      "the detail has to say the run did not execute that commit — a `dirty: true` flag beside a sha is "
      + "read as a sha by anybody skimming, which is how the fix-is-ancestor test gets a wrong answer");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("#1423 AN UNTRACKED FILE IS DIRT — `--untracked-files=no` hides exactly the hand-dropped file", async () => {
  // The doctrine store's classifier learned this the expensive way (driver/stray-artifacts.mjs exists
  // because files appeared in a tree no commit knew about). Same rule, same reason, one repo over.
  const r = mkRepo();
  try {
    writeFileSync(join(r.dir, "hand-edit.mjs"), "// dropped in by hand on a test box\n");
    const p = await provenanceIn(r.dir);
    assert.equal(p.outcome, "dirty", `an untracked file must count as dirt — ${p.detail}`);
    assert.ok(p.engineDirt.some((l) => l.includes("hand-edit.mjs")), p.engineDirt.join("; "));
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("#1423 A DETACHED HEAD reports the commit it is ON, with branch null — a pinned box is the normal case", async () => {
  const r = mkRepo();
  try {
    writeFileSync(join(r.dir, "a.txt"), "one\ntwo\n");
    r.git("add", "-A"); r.git("commit", "-q", "-m", "second");
    r.git("checkout", "-q", r.head);            // detach onto the first commit
    const p = await provenanceIn(r.dir);
    assert.equal(p.engineHead, r.head, "a pinned deployment reports the commit it RUNS, not the branch tip");
    assert.equal(p.engineBranch, null, "detached is null, not the string \"HEAD\"");
    assert.match(p.detail, /detached/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("#1423 NOT A CHECKOUT is BLOCKED, which is not clean — could-not-determine is its own answer", async () => {
  const d = mkdtempSync(join(tmpdir(), "eng-prov-nogit-"));
  try {
    const p = await provenanceIn(d);
    assert.equal(p.outcome, "blocked",
      "a directory with no git is not a clean tree. `classifySkillsStore` states the rule this copies: "
      + "could-not-determine is not a pass, and collapsing it into `clean` is how a source zip reports "
      + "provenance it does not have");
    assert.equal(p.engineHead, null, "and it names no commit rather than guessing one");
    assert.match(p.detail, /not the same as it being fine/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── the wiring: the stamp is at run START, in the run's own directory ──────────────────────────────

test("#1423 the stamp is written where a FAILED run keeps it — the run dir, not the pool copy", () => {
  const src = read("driver/pipeline.mjs");
  const at = src.indexOf('event: "engine-build"');
  assert.ok(at > 0, "pipeline.mjs no longer logs the engine-build event");

  // BEFORE the first dispatch. Measured by position against the run-start record it sits beside, not
  // by reading the comment: an aborted run keeps only what was written before it aborted.
  const startAt = src.indexOf('runLog(run.runDir, { event: "start"');
  assert.ok(startAt > at,
    "the engine-build row must be written BEFORE the run's own start record and every dispatch after it "
    + "— a stamp written at the end is a stamp an aborted run does not have, which is the population "
    + "#1423 exists for");

  // and it is a runLog into the RUN DIR, which is what survives into archive/<YYYY-MM>/.
  assert.match(src.slice(at - 200, at + 60), /runLog\(run\.runDir, \{ event: "engine-build"/);
});

test("#1423 THE KEY NAMES ITS REPOSITORY — `run.jsonl` already carries a different repo's `head`", () => {
  const src = read("driver/pipeline.mjs");
  // The doctrine store's row is the one that was mistaken for the engine's. Both must exist, and the
  // engine's must not use the bare key.
  assert.match(src, /event: "skills-store".*head: s\.head/s, "the doctrine store's row still carries `head`");
  const eb = src.slice(src.indexOf('event: "engine-build"'), src.indexOf('event: "engine-build"') + 260);
  assert.match(eb, /engineHead: e\.engineHead/, "the engine's row must key its commit as `engineHead`");
  assert.doesNotMatch(eb, /(^|[^a-zA-Z])head:/,
    "the engine-build row uses a bare `head:` — that is the doctrine store's key, and one run record "
    + "carrying two repositories' commits under one name is the confusion this issue was filed about");
});

test("#1423 engineCommit()'s CONTRACT IS UNTOUCHED — four consumers read a bare string", async () => {
  // pins the import line and the literal call in the publisher; report-data.json, both meta.json
  // writers and /portal/health read a string. The new answer is a SIBLING, and this is what says so.
  const m = await import("../engine-build.mjs");
  assert.equal(typeof m.engineCommit, "function");
  const v = m.engineCommit();
  assert.ok(v === null || typeof v === "string", `engineCommit() must stay string|null, got ${typeof v}`);
  assert.equal(typeof m.engineProvenance, "function", "the new answer is a separate export");
  const p = m.engineProvenance();
  assert.ok(["clean", "dirty", "blocked"].includes(p.outcome), `three-valued outcome, got ${p.outcome}`);
  // The two must agree about the sha when both can answer — two functions asking git the same question
  // and disagreeing is worse than one function.
  if (v && p.engineHead) assert.equal(p.engineHead, v, "the sibling and engineCommit() disagree about HEAD");
});

test("#1423 the e2e report READS it and prints an absence as an absence", () => {
  const src = read("scripts/e2e.mjs");
  assert.match(src, /export function engineBuildOf\(runDir\)/, "the reader is exported for its own test");
  assert.match(src, /engine build: NOT RECORDED/,
    "a run predating the stamp must be reported as unattributable rather than silently omitted — the "
    + "reflog reconstruction it replaces is exactly what fills a silent gap with a wrong answer");
  assert.match(src, /engineBuildOf\(run\.runDir\)/, "and the report actually calls it per run");
});

test("#1423 engineBuildOf: the LAST segment wins, and a mid-run engine change is visible", async () => {
  const { engineBuildOf } = await import("../../scripts/e2e.mjs");
  const d = mkdtempSync(join(tmpdir(), "eb-read-"));
  try {
    mkdirSync(join(d, "_driver"), { recursive: true });
    const rows = [
      { event: "start", resume: false },
      { event: "engine-build", outcome: "clean", engineHead: "a".repeat(40), engineBranch: "main", detail: "clean" },
      { event: "start", resume: true },
      { event: "engine-build", outcome: "dirty", engineHead: "b".repeat(40), engineBranch: null, detail: "1 uncommitted change(s)" },
    ];
    writeFileSync(join(d, "_driver", "run.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const eb = engineBuildOf(d);
    assert.equal(eb.head, "b".repeat(40), "the LAST row produced the delivered artifact");
    assert.equal(eb.outcome, "dirty");
    assert.equal(eb.segments, 2);
    assert.deepEqual(eb.heads, ["a".repeat(40), "b".repeat(40)],
      "both commits are kept: a run resumed across an engine change is a FACT about that run, and "
      + "averaging it away is how a certification joins a fix to a segment that never carried it");

    // A journal with no row at all: null, not a fabricated answer.
    writeFileSync(join(d, "_driver", "run.jsonl"), JSON.stringify({ event: "start" }) + "\n");
    assert.equal(engineBuildOf(d), null, "no engine-build row ⇒ null, so the caller says NOT RECORDED");
    // No journal at all: also null, and never a throw — one unreadable run must not take out the report.
    rmSync(join(d, "_driver", "run.jsonl"));
    assert.equal(engineBuildOf(d), null);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("#1423 the freeze does NOT carry the stamp into a public worked example", () => {
  // Non-obvious interaction, checked rather than assumed: freezes a real run into a shippable
  // example, and a public example carrying an internal commit would be a leak. `run.jsonl` is on
  // freeze-example-run.mjs's DELIBERATELY DROPPED list, so the stamp cannot reach one.
  const src = read("scripts/freeze-example-run.mjs");
  const dropped = src.slice(src.indexOf("WHAT IS DELIBERATELY DROPPED"), src.indexOf("WHAT THIS SCRIPT DOES NOT DO"));
  assert.match(dropped, /_driver\/run\.jsonl/,
    "run.jsonl left the freeze's dropped list — the engine-build stamp would then ship inside a public "
    + "worked example. Either keep it dropped, or scrub the row explicitly.");
  assert.ok(existsSync(join(REPO, "scripts", "freeze-example-run.mjs")));
});
