// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-pair-workflow.test.mjs — a PAIR (two rounds, one scenario, one commit) driven through the CLI.
//
// 's noise floor needs the same scenario run twice. Before the second `run` overwrote the only
// record of the first round's token, and `report` then described the second run — thirty seconds into a
// two-hour job — as though it were the only round, printing its in-flight state as FAILs that read like
// engine defects. This file drives the four things that must now be true, through `node scripts/e2e.mjs`
// rather than through an import, because two of them are about ARGV and about the ORDER output appears
// in, and neither survives being tested one function down.
//
// `--stale` is passed on every `run`: `reportCommit({paid:true})` refuses to start a paid run against a
// clone that is not current, and a test branch always is not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readReceipt, appendRound, receiptPath } from "../e2e-rounds.mjs";
import { roundSettlement, previousRoundNotice } from "../../scripts/e2e.mjs";

// — BOTH SPELLINGS, OR THE PARENT'S TRANSLATED COPY WINS IN THE CHILD.
//
// A child spawned with `{...process.env, ...ours}` inherits every name the PARENT holds, and this test
// process now translates on import (the harness entry it drives imports the alias loader). So the parent
// carries BOTH spellings of every renamed name it has set. Overriding only the old one leaves the
// parent's stale CLEAROTRON_* value in place beside it — and `applyEnvAliases` resolves that
// disagreement in favour of the NEW name, by design ("it is this release's name"). Measured: a job
// enqueued into the harness's own containment queue instead of the test's box, and the assertion that
// found it was about a MISSING WARNING three steps later.
//
// Derived through `currentName` rather than listed, for the reason test-run.mjs states about its own
// data-plane guard: a hand-written pair stops tracking the table the moment the table moves.
const bothSpellings = (env) => Object.fromEntries(
  Object.entries(env).flatMap(([k, v]) => [...new Set([k, k])].map((n) => [n, v])));


const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E = join(REPO, "scripts", "e2e.mjs");

// A scenario every door admits and that passes the store lint (a positive cost.wallMinutes, no
// requiresAck, no knockout-assessment.md without the four honesty ops) — a fixture that trips the lint
// refuses the whole invocation and the test would be measuring the lint.
const R1 = {
  id: "R1",
  title: "PAIR FIXTURE — synthetic mechanism probe",
  why: ["fixture for #514"],
  door: "cli",
  cost: { measured: true, wallMinutes: 1, note: "fixture" },
  job: { ref: "E2E-R1", markName: "E2E PAIR PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" },
  expect: { terminal: "delivered" },
};

const OLD = "1a2b3c4d";   // the round already on the box
const OLD_CASES = [{ id: "R1", ref: "E2E-R1", submittedRef: `E2E-R1-${OLD}`, agreed: true,
  answers: [{ door: "cli", accepted: true, reason: null }] }];

/**
 * The layout a deployment has: the pool and the queue share a parent, and the receipt sits BESIDE the
 * pool (`join(POOL_ROOT, "..", …)`), which is where both `run` and `report` look for it.
 */
function makeBox() {
  const root = mkdtempSync(join(tmpdir(), "e2e-pair-"));
  const store = join(root, "store");
  mkdirSync(join(store, "scenarios"), { recursive: true });
  mkdirSync(join(store, "baselines"), { recursive: true });
  writeFileSync(join(store, "scenarios", "R1.json"), JSON.stringify(R1, null, 2));
  const pool = join(root, "pool"), queue = join(root, "queue"), ws = join(root, "workspace");
  for (const d of [pool, queue, ws]) mkdirSync(d, { recursive: true });
  return { root, store, pool, queue, ws,
    env: bothSpellings({ CLEAROTRON_E2E_DIR: store, CLEAROTRON_REPORTS_DIR: pool, CLEAROTRON_QUEUE_DIR: queue, CLEAROTRON_WORK_DIR: ws }) };
}

function cli(box, args) {
  const r = spawnSync("node", [E2E, ...args], { encoding: "utf8",
    env: { ...process.env, ...box.env, E2E_VERBOSE: "" } });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A settled queue marker for one round, as the runner leaves one. */
function putMarker(box, name, { ref, suffix = "done" }) {
  writeFileSync(join(box.queue, `${name}.${suffix}`), JSON.stringify({ id: name, ref }));
}

/** A run dir as the engine leaves one; status.json carries the submitted ref verbatim. */
function putRun(box, name, { ref, startedAt, state = "delivered" }) {
  const dir = join(box.ws, "runs", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ schema: 1, runId: name, ref, state, startedAt }, null, 2));
  return dir;
}

// ── acceptance 2: the launch says so, and says it BEFORE anything queues ──────────────────────────

test("run: a previous round with an UNREPORTED TERMINAL is announced, and announced BEFORE the queue", () => {
  const box = makeBox();
  try {
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: OLD_CASES });
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}` });
    const dir = putRun(box, "run-old", { ref: `E2E-R1-${OLD}`, startedAt: "2026-08-07T22:00:00.000Z" });

    const { out } = cli(box, ["run", "R1", "--stale"]);
    const warn = out.indexOf("HAS NOT BEEN REPORTED");
    assert.ok(warn >= 0, `the launch must say the previous round is an unreported terminal:\n${out}`);
    assert.match(out, new RegExp(`report R1 --round ${OLD}`), "…and hand over the exact command that reads it");
    assert.ok(out.includes(dir), "…and name the run dir, so score.mjs can be pointed at it");

    // POSITION, not presence. A block printed after the enqueue loop still "says so" and says it too
    // late — the operator has already spent the round.
    const queued = out.indexOf("queued.");
    const accepted = out.indexOf("  queued R1");
    assert.ok(queued > warn, `the warning must precede "queued." (warn ${warn}, queued ${queued})\n${out}`);
    assert.ok(accepted === -1 || accepted > warn, "…and precede the per-case acceptance line too");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("run: a round still IN FLIGHT is said differently, and is never called an unreported terminal", () => {
  const box = makeBox();
  try {
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: OLD_CASES });
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}`, suffix: "processing" });
    const { out } = cli(box, ["run", "R1", "--stale"]);
    assert.match(out, /IS STILL IN FLIGHT/);
    assert.doesNotMatch(out, /HAS NOT BEEN REPORTED/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("run: with NOTHING to look in, the previous round's state is UNKNOWN and never `settled`", () => {
  // `queueOutcomes` returns [] when the queue dir is absent and `findRunsByRef` returns [] when the
  // workspace root is unset. Both mean "could not look" and both look exactly like "nothing there" — a
  // round nobody searched for must not be announced as a finished terminal.
  const box = makeBox();
  try {
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: OLD_CASES });
    rmSync(box.queue, { recursive: true, force: true });
    const { out } = cli(box, ["run", "R1", "--stale"]);
    assert.match(out, /COULD NOT BE ESTABLISHED/);
    assert.match(out, /NOT SEARCHED/);
    assert.doesNotMatch(out, /HAS NOT BEEN REPORTED/, "not-searched must never be reported as a settled terminal");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("run: the round it launches is APPENDED — the first half's token and door answers survive", () => {
  const box = makeBox();
  try {
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: OLD_CASES });
    const { out } = cli(box, ["run", "R1", "--stale"]);
    const minted = /round token: ([0-9a-f]{8})/.exec(out)?.[1];
    assert.ok(minted, `the launch prints the round token it minted:\n${out}`);
    const rounds = readReceipt(box.pool, "R1").rounds;
    assert.deepEqual(rounds.map((r) => r.token), [OLD, minted], "both halves of the pair are on record");
    assert.equal(rounds[0].cases[0].answers[0].door, "cli", "…and the first half's door answers are untouched");
    assert.match(out, /2 round\(s\) of R1 now on record/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

// ── acceptance 1 + 4: report names every round, and can read the earlier one ──────────────────────

test("report: names EVERY round with its token and terminal, then reads exactly one", () => {
  const box = makeBox();
  try {
    const NEW = "9f8e7d6c";
    for (const [t, at] of [[OLD, "2026-08-07T22:00:00.000Z"], [NEW, "2026-08-07T22:20:00.000Z"]]) {
      appendRound(box.pool, "R1", { token: t, startedAt: at, startedAtSource: "run", doors: ["cli"],
        cases: [{ id: "R1", ref: "E2E-R1", submittedRef: `E2E-R1-${t}`, agreed: true, answers: [{ door: "cli", accepted: true, reason: null }] }] });
    }
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}` });
    putMarker(box, "new-cli", { ref: `E2E-R1-${NEW}`, suffix: "processing" });
    const oldDir = putRun(box, "run-old", { ref: `E2E-R1-${OLD}`, startedAt: "2026-08-07T22:00:00.000Z" });
    putRun(box, "run-new", { ref: `E2E-R1-${NEW}`, startedAt: "2026-08-07T22:20:00.000Z", state: "running" });

    const dflt = cli(box, ["report", "R1"]);
    assert.match(dflt.out, /ROUNDS of R1 — 2 known/);
    assert.match(dflt.out, new RegExp(`R1a  token ${OLD}\\s+settled`), "the earlier round is NAMED, with its state");
    assert.match(dflt.out, new RegExp(`R1b  token ${NEW}\\s+in-flight`), "and the newest is labelled in-flight, not presented as the only round");
    assert.ok(dflt.out.includes(oldDir), "the earlier round's run dir is on the page, so it can be scored");
    assert.match(dflt.out, new RegExp(`round: token ${NEW}`), "no flag ⇒ the newest round is read — the #388 scoping does not move");

    const older = cli(box, ["report", "R1", "--round", OLD]);
    assert.match(older.out, new RegExp(`round: token ${OLD}`), "--round reads the EARLIER round");
    assert.match(older.out, new RegExp(`E2E-R1-${OLD}\\s+delivered`), "…and reports its terminal, from its own marker");
    assert.doesNotMatch(older.out, new RegExp(`round: token ${NEW}`));
    assert.match(older.out, /belong to OTHER rounds of this ref/, '"other", not "earlier" — under --round the excluded round is the NEWER one');
    assert.doesNotMatch(older.out, /`teardown R1` clears them/, "and it never points at deleting the half still needed");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("report --round: the flag's VALUE is not swallowed into a positional and silently dropped", () => {
  // `slice(2).filter((a) => !a.startsWith("--"))` left the token as a third positional that the
  // `[cmd, arg]` destructure discarded — the newest round was reported and nothing said so. Both the
  // spaced and the `=` form are driven, and an extra positional now errors rather than vanishing.
  const box = makeBox();
  try {
    const NEW = "9f8e7d6c";
    for (const [t, at] of [[OLD, "2026-08-07T22:00:00.000Z"], [NEW, "2026-08-07T22:20:00.000Z"]]) {
      appendRound(box.pool, "R1", { token: t, startedAt: at, startedAtSource: "run", doors: ["cli"], cases: [] });
    }
    for (const args of [["report", "R1", "--round", OLD], ["report", "R1", `--round=${OLD}`]]) {
      const r = cli(box, args);
      assert.match(r.out, new RegExp(`round: token ${OLD}`), `${args.join(" ")} must read ${OLD}`);
    }
    const bad = cli(box, ["report", "R1", "--round", "deadbeef"]);
    assert.equal(bad.code, 2, "an unknown token is an ERROR, never a fall-back to the newest round");
    assert.match(bad.out, new RegExp(OLD), "…and it names every token it does know");
    assert.match(bad.out, new RegExp(NEW));

    assert.equal(cli(box, ["report", "R1", "--round"]).code, 2, "a flag with no value dies rather than being ignored");
    const extra = cli(box, ["report", "R1", "R2"]);
    assert.equal(extra.code, 2, "a leftover positional is an error, not a silent discard");
    assert.match(extra.out, /unexpected argument "R2"/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("report stamps the round it read WITH THE STATE IT WAS IN, and reading mid-flight does not silence the launch", () => {
  // The exact sequence the issue's operator ran: `report R1` at 22:20, thirty seconds into the next
  // round. Keying the launch warning on `reportedAt != null` would mark that round read and silence the
  // warning for the terminal it reaches two hours later.
  const box = makeBox();
  try {
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: OLD_CASES });
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}`, suffix: "processing" });
    cli(box, ["report", "R1"]);
    const mid = readReceipt(box.pool, "R1").rounds[0];
    assert.equal(mid.reportedState, "in-flight", "the stamp records the state the round was READ in");
    assert.ok(mid.reportedAt, "…and that it was read at all");

    // It settles. The launch must still call it unreported.
    rmSync(join(box.queue, `old-cli.processing`), { force: true });
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}` });
    const { out } = cli(box, ["run", "R1", "--stale"]);
    assert.match(out, /HAS NOT BEEN REPORTED/, "a round read while in flight is NOT a reported terminal");

    // Read once settled, it goes quiet.
    cli(box, ["report", "R1", "--round", OLD]);
    assert.equal(readReceipt(box.pool, "R1").rounds[0].reportedState, "settled");
    const quiet = cli(box, ["run", "R1", "--stale"]);
    assert.doesNotMatch(quiet.out, /HAS NOT BEEN REPORTED/, "…and once it IS read settled, the warning stops");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("report --round: a refused case shows THAT round's door answers, not the newest round's", () => {
  // A door refusal is decided inside `enqueue`, before any queue file exists, so the receipt is the only
  // record of it — and each round records its own. Reading the scenario's newest answers under an
  // earlier round's report would print one round's refusal reason as another's, which is the same
  // substitution as reporting the newest round's state as the only round's: it reads correct and is
  // about the wrong run.
  const box = makeBox();
  try {
    const job = { markName: "E2E PAIR PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" };
    writeFileSync(join(box.store, "scenarios", "R0.json"), JSON.stringify({
      id: "R0", title: "PAIR FIXTURE — a refused case", why: ["fixture for #514"], door: "cli",
      cost: { measured: true, wallMinutes: 1 },
      cases: [{ id: "R0b-refused", job: { ...job, ref: "E2E-R0b", searchLevel: "prelim-jx" }, expect: { terminal: "clarify" } }],
    }, null, 2));
    const NEW = "9f8e7d6c";
    const refusal = (t, reason) => ({ token: t, startedAt: t === OLD ? "2026-08-07T22:00:00.000Z" : "2026-08-07T22:20:00.000Z",
      startedAtSource: "run", doors: ["cli"],
      cases: [{ id: "R0b-refused", ref: "E2E-R0b", submittedRef: `E2E-R0b-${t}`, agreed: true,
        answers: [{ door: "cli", accepted: false, reason }] }] });
    appendRound(box.pool, "R0", refusal(OLD, "REASON-FROM-THE-EARLIER-ROUND: retired vocabulary"));
    appendRound(box.pool, "R0", refusal(NEW, "REASON-FROM-THE-NEWER-ROUND: something else entirely"));

    const older = cli(box, ["report", "R0", "--round", OLD]);
    assert.match(older.out, /REASON-FROM-THE-EARLIER-ROUND/, "the earlier round's own reason");
    assert.doesNotMatch(older.out, /REASON-FROM-THE-NEWER-ROUND/, "and never the newer round's, which would be a different run's answer");

    const newest = cli(box, ["report", "R0"]);
    assert.match(newest.out, /REASON-FROM-THE-NEWER-ROUND/);
    assert.doesNotMatch(newest.out, /REASON-FROM-THE-EARLIER-ROUND/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("report: a case of a round the receipt LOST is NOT PROBED, never `left no trace`", () => {
  // The 2026-08-07 shape: a later `run` overwrote the single-token receipt the earlier round had
  // written, so that round exists on disk and nowhere in the receipt.
  //
  // A DOOR REFUSAL LEAVES NOTHING ON DISK — `enqueue` refuses before any queue file is written — so for
  // a refused case the receipt is the ONLY record, and with the entry gone `doorRefusal` returns null.
  // Falling through to "left no trace" would push one INVESTIGATE line per refused case; on R0, seven of
  // nine cases are that shape, which is exactly the false block removed. It is NOT PROBED, and it
  // says the answers were overwritten rather than never given.
  const box = makeBox();
  try {
    // Two cases: one the doors admit (its run dir is what makes the round discoverable at all) and one
    // they refuse at the door.
    const job = { markName: "E2E PAIR PROBE", classes: [9], product: "knockout-search", forwarder: "e2e" };
    writeFileSync(join(box.store, "scenarios", "R0.json"), JSON.stringify({
      id: "R0", title: "PAIR FIXTURE — two cases", why: ["fixture for #514"], door: "cli",
      cost: { measured: true, wallMinutes: 1 },
      cases: [
        { id: "R0a-admitted", job: { ...job, ref: "E2E-R0a" }, expect: { terminal: "delivered" } },
        // `searchLevel` is retired vocabulary every door refuses by name — a refusal decided inside
        // `enqueue`, which is the case shape this branch exists for.
        { id: "R0b-refused", job: { ...job, ref: "E2E-R0b", searchLevel: "prelim-jx" }, expect: { terminal: "clarify" } },
      ],
    }, null, 2));
    const NEW = "9f8e7d6c";
    appendRound(box.pool, "R0", { token: NEW, startedAt: "2026-08-07T22:20:00.000Z", startedAtSource: "run", doors: ["cli"], cases: [] });
    putRun(box, "run-old", { ref: `E2E-R0a-${OLD}`, startedAt: "2026-08-07T22:00:00.000Z" });   // on disk, not in the receipt

    const r = cli(box, ["report", "R0", "--round", OLD]);
    assert.match(r.out, /no receipt entry/, "the ROUNDS block says which round the receipt lost");
    assert.match(r.out, /NOT PROBED/, "and the refused case's missing door answers decline honestly");
    assert.match(r.out, /\?\s+E2E-R0b: this round's door answers are unrecoverable/, "…and the NOT PROBED row names the case");
    assert.doesNotMatch(r.out, /left no trace/, "a round whose record was overwritten did not leave no trace");
    assert.doesNotMatch(r.out, /E2E-R0b:.*(INVESTIGATE|left no trace|nothing can be said)/,
      "…so the refused case names no defect the report cannot support");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("a round the receipt never held can still be READ QUIET — the warning has an off switch", () => {
  // The receipt holds only an OLDER round; a NEWER one exists on disk alone (a later round overwrote
  // its entry, or `run`'s own append failed — `run` says so at the time). Reading it must stop the
  // launch warning, or the warning fires forever with no command that ends it, and the operator learns
  // to skip the block a real one appears in. Teardown is not the answer: it purges run dirs, and a
  // purge that declines leaves the round discoverable.
  const ORPHAN = "9f8e7d6c";
  // Two boxes, because a `run` appends its OWN round and that round is then the previous one. The
  // before/after halves have to start from the same state.
  const orphanBox = () => {
    const box = makeBox();
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run",
      doors: ["cli"], cases: OLD_CASES, reportedAt: "2026-08-07T23:00:00.000Z", reportedState: "settled" });
    putMarker(box, "orphan-cli", { ref: `E2E-R1-${ORPHAN}` });
    putRun(box, "run-orphan", { ref: `E2E-R1-${ORPHAN}`, startedAt: "2026-08-07T22:20:00.000Z" });
    return box;
  };

  const a = orphanBox();
  try {
    const before = cli(a, ["run", "R1", "--stale"]);
    assert.match(before.out, /HAS NOT BEEN REPORTED/, "it warns first");
    assert.match(before.out, /receipt holds NO ENTRY for this round/, "…and says the record of its doors is gone");
  } finally { rmSync(a.root, { recursive: true, force: true }); }

  const b = orphanBox();
  try {
    const rep = cli(b, ["report", "R1", "--round", ORPHAN]);
    assert.match(rep.out, /held no entry for round/, "reading it says an entry was created");
    assert.match(rep.out, /nothing about what its doors answered/, "…and what that entry does NOT record");

    const stub = readReceipt(b.pool, "R1").rounds.find((r) => r.token === ORPHAN);
    assert.equal(stub.reportedState, "settled");
    assert.equal(stub.recorded, false, "the entry keeps the two facts apart: read, yes; door answers, never recorded");

    const after = cli(b, ["run", "R1", "--stale"]);
    assert.doesNotMatch(after.out, /HAS NOT BEEN REPORTED/, "the warning stops");
    assert.match(after.out, /already reported/);

    // And the report has not gone quiet about the part it genuinely cannot answer.
    const again = cli(b, ["report", "R1", "--round", ORPHAN]);
    assert.match(again.out, /no receipt entry/, "the ROUNDS block still says the door answers are unrecoverable");
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

// ── the pure judgments, driven where a spawn cannot reach the edge cases ──────────────────────────

test("roundSettlement: not-searched is UNKNOWN, and positive in-flight evidence beats it", () => {
  const box = makeBox();
  try {
    const round = { token: OLD, runs: [] };
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}` });
    assert.equal(roundSettlement(round, ["E2E-R1"], { queueDir: box.queue, workspaceSearched: true }).state, "settled");
    assert.equal(roundSettlement(round, ["E2E-R1"], { queueDir: box.queue, workspaceSearched: false }).state, "unknown",
      "an unsearched workspace can never yield `settled`");
    assert.equal(roundSettlement(round, ["E2E-R1"], { queueDir: join(box.root, "no-queue"), workspaceSearched: true }).state, "unknown",
      "and neither can an absent queue dir");
    // A run dir saying `running` settles the question in the one direction an incomplete search cannot
    // make wrong.
    assert.equal(roundSettlement({ token: OLD, runs: [{ status: { state: "running" } }] }, ["E2E-R1"],
      { queueDir: join(box.root, "no-queue"), workspaceSearched: false }).state, "in-flight");
    // Another round's marker is not this round's evidence.
    assert.equal(roundSettlement({ token: "aaaaaaaa", runs: [] }, ["E2E-R1"], { queueDir: box.queue, workspaceSearched: true }).state,
      "unknown", "nothing found for THIS round is unknown, not settled");
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("previousRoundNotice: teardown's clearedAt stops the warning; nothing else does", () => {
  const settled = () => ({ state: "settled", terminals: ["delivered"], why: "fixture" });
  const rounds = [{ token: OLD, reportedState: null, clearedAt: null, runs: [] }];
  assert.equal(previousRoundNotice(rounds, settled).kind, "unreported-terminal");
  assert.equal(previousRoundNotice([{ ...rounds[0], reportedState: "in-flight", reportedAt: "x" }], settled).kind,
    "unreported-terminal", "read while in flight is not read");
  assert.equal(previousRoundNotice([{ ...rounds[0], reportedState: "settled", reportedAt: "x" }], settled).kind, "reported");
  assert.equal(previousRoundNotice([{ ...rounds[0], clearedAt: "2026-08-08T00:00:00.000Z" }], settled), null,
    "a round whose evidence teardown removed drives no warning — one that is always on is one nobody reads");
  assert.equal(previousRoundNotice([], settled), null);
});

test("teardown marks every round as cleared, so the launch stops warning about evidence it deleted", () => {
  const box = makeBox();
  try {
    appendRound(box.pool, "R1", { token: OLD, startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: OLD_CASES });
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}` });
    const td = cli(box, ["teardown", "R1"]);
    assert.match(td.out, /marked 1 round\(s\) as torn down/, td.out);
    const after = readReceipt(box.pool, "R1").rounds[0];
    assert.ok(after.clearedAt, "the round is stamped");
    assert.equal(after.cases[0].answers[0].door, "cli",
      "STAMPED, NOT PRUNED — the door answers exist nowhere else and teardown deletes run dirs, not the record of what each door said");
    const { out } = cli(box, ["run", "R1", "--stale"]);
    assert.doesNotMatch(out, /HAS NOT BEEN REPORTED/);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});

test("a v1 receipt written by the CURRENT shipped harness still reports, and the next run appends to it", () => {
  // The test box --ff-only's from origin/main hourly: a round launched before the deploy has this exact
  // file on disk. Dropping the migration would make it unreportable AT the deploy — this issue's own
  // defect, recreated by its fix.
  const box = makeBox();
  try {
    writeFileSync(receiptPath(box.pool, "R1"),
      JSON.stringify({ scenario: "R1", token: OLD, doors: ["cli"], cases: OLD_CASES }, null, 2) + "\n");
    putMarker(box, "old-cli", { ref: `E2E-R1-${OLD}` });
    const rep = cli(box, ["report", "R1"]);
    assert.match(rep.out, new RegExp(`round: token ${OLD}`), "the pre-deploy round is still reportable");
    assert.match(rep.out, /v1 receipt/, "…and the report says the start time came from the file, not the round");

    const run = cli(box, ["run", "R1", "--stale"]);
    const minted = /round token: ([0-9a-f]{8})/.exec(run.out)?.[1];
    assert.deepEqual(readReceipt(box.pool, "R1").rounds.map((r) => r.token), [OLD, minted],
      "the migrated round is kept when the next round is appended");
    assert.equal(JSON.parse(readFileSync(receiptPath(box.pool, "R1"), "utf8")).version, 2);
  } finally { rmSync(box.root, { recursive: true, force: true }); }
});
