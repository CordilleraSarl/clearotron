// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-rounds.test.mjs — the receipt is a HISTORY, and a round nobody looked for is not a round that
// is not there.
//
// The defect: `run` wrote `_e2e-doors-<ID>.json` holding ONE token, so the second run of a
// noise-floor pair overwrote the only record of the first round's token and the first half became
// unreportable — silently. Every test below is written so that undoing the fix turns it red; where a
// weaker property would have stayed green (the field exists, a count is non-zero) the assertion is on a
// value that only the working mechanism can produce.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  RECEIPT_VERSION, receiptPath, readReceipt, appendRound, stampRound, tokenFromRef, scenarioRefs,
  findRunsByRef, roundsFromRuns, mergeRounds, selectRound, previousRunDir, roundLetters,
  firstWriteWins,
} from "../e2e-rounds.mjs";
// The REAL token minter and the REAL ref composers, so the parser is tested against what `run` actually
// submits rather than against a literal somebody typed here.
import { newRunToken, refForRun, refForDoor } from "../../scripts/e2e.mjs";

/** A pool laid out as the deployment lays it out: the receipt sits BESIDE the pool, not inside it. */
function makePool() {
  const root = mkdtempSync(join(tmpdir(), "e2e-rounds-"));
  const pool = join(root, "pool");
  mkdirSync(pool, { recursive: true });
  return { root, pool };
}

const CASES_A = [{ id: "R2a-case", ref: "E2E-R2", submittedRef: "E2E-R2-aaaaaaaa", agreed: true,
  answers: [{ door: "cli", accepted: false, reason: "round A: the door said no, and this is the only record of why" }] }];
const CASES_B = [{ id: "R2b-case", ref: "E2E-R2", submittedRef: "E2E-R2-bbbbbbbb", agreed: true,
  answers: [{ door: "cli", accepted: true, reason: null }] }];

// ── the issue itself ──────────────────────────────────────────────────────────────────────────────

test("APPEND, NOT OVERWRITE: the second half of a pair leaves the first half's token AND door answers", () => {
  const { pool } = makePool();
  assert.equal(appendRound(pool, "R2", { token: "aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: CASES_A }).ok, true);
  assert.equal(appendRound(pool, "R2", { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z", startedAtSource: "run", doors: ["cli"], cases: CASES_B }).ok, true);

  const r = readReceipt(pool, "R2");
  assert.equal(r.state, "present");
  assert.deepEqual(r.rounds.map((x) => x.token), ["aaaaaaaa", "bbbbbbbb"], "BOTH rounds survive the second run");
  // Not "the round exists" — the door answers are the part that exists nowhere else on disk, because a
  // door refusal happens inside `enqueue` before any queue file is written.
  assert.equal(r.rounds[0].cases[0].answers[0].reason, CASES_A[0].answers[0].reason,
    "round A's door REASON is intact — the thing the overwrite destroyed");
  assert.equal(r.rounds[0].startedAt, "2026-08-07T22:00:00.000Z");
  assert.equal(JSON.parse(readFileSync(receiptPath(pool, "R2"), "utf8")).version, RECEIPT_VERSION);
});

test("V1 MIGRATION: the exact bytes main writes today still parse, as one round, marked as migrated", () => {
  // Verbatim the shape scripts/e2e.mjs wrote before this change. The test box --ff-only's hourly, so a
  // round launched before the deploy has this file on disk; dropping the migration would make it
  // unreportable AT the deploy — the defect, recreated by its own fix.
  const { pool } = makePool();
  const v1 = { scenario: "R2", token: "2328c0a8", doors: ["cli"],
    cases: [{ id: "R2-case", ref: "E2E-R2", submittedRef: "E2E-R2-2328c0a8", agreed: true,
      answers: [{ door: "cli", accepted: false, reason: "v1 recorded this reason and nothing else holds it" }] }] };
  writeFileSync(receiptPath(pool, "R2"), JSON.stringify(v1, null, 2) + "\n");

  const r = readReceipt(pool, "R2");
  assert.equal(r.state, "present");
  assert.equal(r.migrated, true, "and it SAYS it migrated — the start time below is the file's, not the round's");
  assert.equal(r.rounds.length, 1);
  assert.equal(r.rounds[0].token, "2328c0a8");
  assert.deepEqual(r.rounds[0].doors, ["cli"]);
  assert.equal(r.rounds[0].cases[0].answers[0].reason, v1.cases[0].answers[0].reason);
  assert.equal(r.rounds[0].startedAtSource, "receipt-mtime", "never presented as the round's own record of when it started");
  assert.match(r.why, /v1 receipt/);

  // And appending to a v1 file KEEPS the migrated round rather than replacing it.
  assert.equal(appendRound(pool, "R2", { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z", startedAtSource: "run", doors: ["cli"], cases: CASES_B }).ok, true);
  assert.deepEqual(readReceipt(pool, "R2").rounds.map((x) => x.token), ["2328c0a8", "bbbbbbbb"]);
});

test("ABSENT, TORN and EMPTY are three different answers, and none of them is the others", () => {
  const { pool } = makePool();
  const absent = readReceipt(pool, "R2");
  assert.equal(absent.state, "absent");
  assert.deepEqual(absent.rounds, []);
  assert.match(absent.why, /no receipt at/);

  writeFileSync(receiptPath(pool, "R2"), JSON.stringify({ version: 2, scenario: "R2", rounds: [] }) + "\n");
  const empty = readReceipt(pool, "R2");
  assert.equal(empty.state, "present", "a receipt that exists and records zero rounds is NOT an absent receipt");
  assert.deepEqual(empty.rounds, []);

  writeFileSync(receiptPath(pool, "R2"), "{not json at all, forty-ish bytes here}");
  const torn = readReceipt(pool, "R2");
  assert.equal(torn.state, "torn");
  assert.match(torn.why, /does not parse as JSON/);

  writeFileSync(receiptPath(pool, "R2"), JSON.stringify({ hello: "world" }));
  assert.equal(readReceipt(pool, "R2").state, "torn", "JSON that is not a receipt is torn, never an empty history");
});

test("A TORN RECEIPT IS PRESERVED BEFORE ANYTHING IS WRITTEN, and appendRound names where the bytes went", () => {
  const { pool } = makePool();
  const bytes = "{\"scenario\":\"R2\",\"token\":\"2328c0a8\",\"cases\":[  <-- truncated mid-write";
  writeFileSync(receiptPath(pool, "R2"), bytes);

  const res = appendRound(pool, "R2", { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z", startedAtSource: "run", doors: ["cli"], cases: CASES_B });
  assert.equal(res.ok, true);
  assert.ok(res.preserved, "the caller is TOLD where the old bytes went");
  assert.equal(readFileSync(res.preserved, "utf8"), bytes, "…and they are byte-for-byte what was there");
  assert.match(res.why, /preserved/);
  assert.deepEqual(readReceipt(pool, "R2").rounds.map((x) => x.token), ["bbbbbbbb"]);
});

// ── the token parser ──────────────────────────────────────────────────────────────────────────────

test("tokenFromRef ROUND-TRIPS the real token through the real ref composers", () => {
  // Not a literal: composed exactly as cmdRun composes it (refForRun, then refForDoor), with a token
  // from the real minter. A change to the token's shape would otherwise make round discovery return
  // zero rounds and read as "there are no earlier rounds".
  for (let i = 0; i < 50; i++) {
    const token = newRunToken();
    const base = "E2E-R0e";
    const doors = ["cli", "ops-mcp"];
    for (const door of doors) {
      const ref = refForDoor(refForRun(base, token), door, { doors, oneMatterAcrossDoors: false });
      assert.equal(tokenFromRef(base, ref), token, `${ref} must yield ${token}`);
    }
    assert.equal(tokenFromRef("E2E-R2", refForRun("E2E-R2", token)), token, "and a single-door ref with no suffix at all");
  }
});

test("tokenFromRef REJECTS what is not a token — a door suffix, a sibling case, an untokened round", () => {
  assert.equal(tokenFromRef("E2E-R0e", "E2E-R0e-cli"), null, "a door suffix is not a round token");
  assert.equal(tokenFromRef("E2E-R0e", "E2E-R0e-clientmcp"), null);
  assert.equal(tokenFromRef("E2E-R0e", "E2E-R0e-opsmcp"), null);
  assert.equal(tokenFromRef("E2E-R2", "E2E-R2b-2328c0a8"), null, "ANCHORED: R2b is a different ref, not round 2328c0a8 of R2");
  assert.equal(tokenFromRef("E2E-R0", "E2E-R0d-2328c0a8"), null, "…so R0's five cases cannot cross-contaminate each other's history");
  assert.equal(tokenFromRef("E2E-R0e", "E2E-R0e"), null, "a pre-#388 untokened round belongs to no nameable round");
  assert.equal(tokenFromRef("E2E-R2", "E2E-R2-2328C0A8"), null, "the token is lower-case hex; upper case is something else");
  assert.equal(tokenFromRef("E2E-R2", "E2E-R2-2328c0a"), null, "seven characters is not four bytes");
  assert.equal(tokenFromRef("E2E-R2", "E2E-R2-2328c0a89"), null, "nine is not four bytes either");
  assert.equal(tokenFromRef("", "E2E-R2-2328c0a8"), null);
  assert.equal(tokenFromRef("E2E-R2", null), null);
});

test("scenarioRefs reads a single-job scenario and a multi-case one, and drops nothing silently", () => {
  assert.deepEqual(scenarioRefs({ job: { ref: "E2E-R2" } }), ["E2E-R2"]);
  assert.deepEqual(scenarioRefs({ cases: [{ job: { ref: "E2E-R0a" } }, { job: {} }, { job: { ref: "E2E-R0b" } }] }),
    ["E2E-R0a", "E2E-R0b"]);
  assert.deepEqual(scenarioRefs({}), []);
});

// ── discovery on disk ─────────────────────────────────────────────────────────────────────────────

/** A run dir the way the engine leaves one: status.json carries the submitted ref, verbatim. */
function putRun(workspace, name, { ref, startedAt = null, state = "delivered", mtimeMs = null }) {
  const dir = join(workspace, "runs", name);
  mkdirSync(dir, { recursive: true });
  const st = { schema: 1, runId: name, ref, state, ...(startedAt ? { startedAt } : {}) };
  const p = join(dir, "status.json");
  writeFileSync(p, JSON.stringify(st, null, 2));
  if (mtimeMs !== null) utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  return dir;
}

test("roundsFromRuns GROUPS BY TOKEN and ORDERS BY startedAt — not by mtime, which is set backwards here", () => {
  const ws = mkdtempSync(join(tmpdir(), "e2e-rounds-ws-"));
  // Round A started first; its file is touched LAST. Sorting by mtime would invert the pair.
  putRun(ws, "runA", { ref: "E2E-R2-aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z", mtimeMs: 3_000_000_000_000 });
  putRun(ws, "runB", { ref: "E2E-R2-bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z", mtimeMs: 2_000_000_000_000 });
  putRun(ws, "foreign", { ref: "E2E-R3-cccccccc", startedAt: "2026-08-07T23:00:00.000Z" });

  const d = roundsFromRuns(["E2E-R2"], ws);
  assert.equal(d.searched, true);
  assert.deepEqual([...d.byToken.keys()].sort(), ["aaaaaaaa", "bbbbbbbb"], "another scenario's run is not this scenario's round");
  const ordered = mergeRounds({ receiptRounds: [], diskRounds: d.byToken });
  assert.deepEqual(ordered.map((r) => r.token), ["bbbbbbbb", "aaaaaaaa"], "newest first, by the run's OWN startedAt");
  assert.equal(ordered[0].startedAtSource, "status");
  assert.equal(ordered[0].runs.length, 1);
});

test("a run with NO startedAt is still discovered, ordered by mtime, and SAYS the time came from the mtime", () => {
  const ws = mkdtempSync(join(tmpdir(), "e2e-rounds-nostart-"));
  putRun(ws, "runA", { ref: "E2E-R2-aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z" });
  putRun(ws, "runB", { ref: "E2E-R2-bbbbbbbb", mtimeMs: Date.parse("2026-08-07T22:20:00.000Z") });

  const d = roundsFromRuns(["E2E-R2"], ws);
  const b = d.byToken.get("bbbbbbbb");
  assert.equal(b.startedAtSource, "mtime", "an mtime is never presented as the run's own record");
  assert.equal(b.startedAt, "2026-08-07T22:20:00.000Z");
  assert.deepEqual(mergeRounds({ receiptRounds: [], diskRounds: d.byToken }).map((r) => r.token), ["bbbbbbbb", "aaaaaaaa"]);
});

test("a round whose start time is UNKNOWN sorts last and never compares as NaN", () => {
  // Date.parse(null) is NaN, and NaN comparisons sort arbitrarily with nothing thrown — so the order
  // itself is asserted, not just the field.
  const rounds = mergeRounds({ receiptRounds: [
    { token: "nnnnnnnn" },                                            // no startedAt at all
    { token: "aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z" },
    { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z" },
  ], diskRounds: new Map() });
  assert.deepEqual(rounds.map((r) => r.token), ["bbbbbbbb", "aaaaaaaa", "nnnnnnnn"]);
  assert.equal(rounds[2].startedAt, null);
  assert.equal(rounds[2].startedAtSource, null);
});

test("NOT SEARCHED IS NOT EMPTY: an unset or unreadable workspace root is an answer with a reason", () => {
  for (const [root, pattern] of [[null, /unset/], ["", /unset/], ["/nonexistent/workspace", /unreadable/]]) {
    const f = findRunsByRef("E2E-R2", root);
    assert.equal(f.searched, false, `${JSON.stringify(root)} must not read as a completed search`);
    assert.deepEqual(f.runs, []);
    assert.match(f.why, pattern);
    const d = roundsFromRuns(["E2E-R2"], root);
    assert.equal(d.searched, false);
    assert.match(d.why, pattern);
  }
});

test("roundsFromRuns COUNTS the runs it cannot name, rather than dropping them", () => {
  const ws = mkdtempSync(join(tmpdir(), "e2e-rounds-untok-"));
  putRun(ws, "pre388", { ref: "E2E-R2", startedAt: "2026-08-01T09:00:00.000Z" });
  putRun(ws, "runA", { ref: "E2E-R2-aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z" });
  const d = roundsFromRuns(["E2E-R2"], ws);
  assert.equal(d.untokened, 1, "a pre-#388 run belongs to no nameable round, and the count says so");
  assert.deepEqual([...d.byToken.keys()], ["aaaaaaaa"]);
});

// ── merge and selection ───────────────────────────────────────────────────────────────────────────

test("mergeRounds keeps the RECEIPT's start time, and adds rounds the receipt never recorded", () => {
  const ws = mkdtempSync(join(tmpdir(), "e2e-rounds-merge-"));
  putRun(ws, "runA", { ref: "E2E-R2-aaaaaaaa", startedAt: "2026-08-07T23:59:00.000Z" });   // a LATER run of round A
  putRun(ws, "runC", { ref: "E2E-R2-cccccccc", startedAt: "2026-08-07T21:00:00.000Z" });   // a round the receipt lost
  const disk = roundsFromRuns(["E2E-R2"], ws);

  const rounds = mergeRounds({
    receiptRounds: [{ token: "aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "run", doors: ["cli"], cases: CASES_A }],
    diskRounds: disk.byToken,
  });
  assert.deepEqual(rounds.map((r) => r.token), ["aaaaaaaa", "cccccccc"], "the receipt's own start time orders round A, not its run's");
  assert.equal(rounds[0].startedAt, "2026-08-07T22:00:00.000Z");
  assert.equal(rounds[0].inReceipt, true);
  assert.equal(rounds[0].onDisk, true);
  assert.equal(rounds[0].runs.length, 1);
  assert.equal(rounds[1].inReceipt, false, "a round only the workspace remembers is still a round, and is marked as one");
  assert.deepEqual(rounds[1].cases, [], "…and it carries no door answers, because nothing recorded them");
  assert.deepEqual(roundLetters(rounds), ["b", "a"], "the OLDEST round is `a`; the letters are printed beside the tokens, never instead");
});

test("a receipt round with no run dir survives the merge — R0's rounds are mostly door refusals", () => {
  const rounds = mergeRounds({
    receiptRounds: [{ token: "aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z", doors: ["cli", "ops-mcp"], cases: CASES_A }],
    diskRounds: new Map(),
  });
  assert.equal(rounds.length, 1, "a run-dir-only history would show R0 as having almost no rounds at all");
  assert.equal(rounds[0].onDisk, false);
  assert.equal(rounds[0].cases[0].answers[0].reason, CASES_A[0].answers[0].reason);
});

test("selectRound NEVER FALLS BACK: an unknown token errors and names every token it knows", () => {
  const rounds = mergeRounds({ receiptRounds: [
    { token: "aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z" },
    { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z" },
  ], diskRounds: new Map() });

  assert.equal(selectRound(rounds).round.token, "bbbbbbbb", "no flag ⇒ the newest round, which is exactly today's behaviour");
  assert.equal(selectRound(rounds, "aaaaaaaa").round.token, "aaaaaaaa");
  const bad = selectRound(rounds, "aaaaaaab");
  assert.ok(bad.error, "a mistyped token must not silently report the newest round — that is this issue wearing a flag");
  assert.equal(bad.round, undefined);
  assert.match(bad.error, /aaaaaaaa/);
  assert.match(bad.error, /bbbbbbbb/);

  const none = selectRound([], null);
  assert.equal(none.round, null, "no rounds at all ⇒ null, which the caller reports UNSCOPED — the pre-#388 reading, kept");
  assert.ok(selectRound([], "aaaaaaaa").error, "…but a NAMED round that does not exist is still an error");
});

// ── the other half of a pair ──────────────────────────────────────────────────────────────────────

test("previousRunDir finds the earlier round's run, matched on the SAME DOOR by equality", () => {
  const ws = mkdtempSync(join(tmpdir(), "e2e-rounds-prev-"));
  // Two rounds, two doors each. `cli` is a PREFIX of `clientmcp`: a startsWith pairing hands the cli
  // door the client-mcp door's run and scores the wrong pair with nothing thrown.
  const dirs = {};
  for (const [token, at] of [["aaaaaaaa", "2026-08-07T22:00:00.000Z"], ["bbbbbbbb", "2026-08-07T22:20:00.000Z"]]) {
    for (const door of ["cli", "clientmcp"]) {
      dirs[`${token}-${door}`] = putRun(ws, `run-${token}-${door}`, { ref: `E2E-R0e-${token}-${door}`, startedAt: at });
    }
  }
  const refs = ["E2E-R0e"];
  const cli = previousRunDir({ refs, workspaceRoot: ws, runDir: dirs["bbbbbbbb-cli"] });
  assert.equal(cli.dir, dirs["aaaaaaaa-cli"], "the cli door of round B pairs with the cli door of round A");
  assert.equal(cli.token, "aaaaaaaa");
  assert.equal(cli.ref, "E2E-R0e-aaaaaaaa-cli");
  const client = previousRunDir({ refs, workspaceRoot: ws, runDir: dirs["bbbbbbbb-clientmcp"] });
  assert.equal(client.dir, dirs["aaaaaaaa-clientmcp"], "…and the client-mcp door with the client-mcp door");
});

test("previousRunDir REFUSES rather than guessing, and every refusal says what it saw", () => {
  const ws = mkdtempSync(join(tmpdir(), "e2e-rounds-prev1-"));
  const only = putRun(ws, "runA", { ref: "E2E-R2-aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z" });

  const alone = previousRunDir({ refs: ["E2E-R2"], workspaceRoot: ws, runDir: only });
  assert.ok(alone.error, "one round is not a pair");
  assert.match(alone.error, /aaaaaaaa/, "and the refusal names the round it did see");
  assert.equal(alone.dir, undefined);

  const notSearched = previousRunDir({ refs: ["E2E-R2"], workspaceRoot: null, runDir: only });
  assert.match(notSearched.error, /NOT SEARCHED/, 'an unset workspace root is never "there is no previous round"');

  const untokened = putRun(ws, "runPre", { ref: "E2E-R2", startedAt: "2026-08-01T09:00:00.000Z" });
  assert.match(previousRunDir({ refs: ["E2E-R2"], workspaceRoot: ws, runDir: untokened }).error, /no round token/);

  const foreign = putRun(ws, "runX", { ref: "E2E-R9-dddddddd", startedAt: "2026-08-07T22:00:00.000Z" });
  assert.match(previousRunDir({ refs: ["E2E-R2"], workspaceRoot: ws, runDir: foreign }).error, /declared refs/);

  const noStatus = mkdtempSync(join(tmpdir(), "e2e-rounds-nostatus-"));
  assert.match(previousRunDir({ refs: ["E2E-R2"], workspaceRoot: ws, runDir: noStatus }).error, /status\.json/);
});

// ── stamping ──────────────────────────────────────────────────────────────────────────────────────

test("stampRound patches ONE round by token, leaves the others, and reports a token it does not know", () => {
  const { pool } = makePool();
  appendRound(pool, "R2", { token: "aaaaaaaa", startedAt: "2026-08-07T22:00:00.000Z", doors: ["cli"], cases: CASES_A });
  appendRound(pool, "R2", { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z", doors: ["cli"], cases: CASES_B });

  assert.equal(stampRound(pool, "R2", "aaaaaaaa", { reportedAt: "2026-08-07T23:00:00.000Z", reportedState: "settled" }).ok, true);
  const after = readReceipt(pool, "R2").rounds;
  assert.equal(after[0].reportedState, "settled");
  assert.equal(after[1].reportedState, null, "the other half of the pair is untouched");
  assert.equal(after[0].cases[0].answers[0].reason, CASES_A[0].answers[0].reason, "and the stamp does not eat the door answers");

  assert.equal(stampRound(pool, "R2", null, {}).ok, false, "a round with no token cannot be created");
});

test("stampRound can mark a round the receipt NEVER HELD as read, without claiming to know its door answers", () => {
  // Otherwise the launch pre-flight warns forever about a round discovered only on disk — a later round
  // overwrote its entry, or `run`'s own append failed — and no command stops it. Teardown does not
  // either: it stamps receipt rounds and purges run dirs, and a purge that declines leaves the round
  // discoverable. A warning with no off switch is one the operator learns to skip.
  const { pool } = makePool();
  appendRound(pool, "R2", { token: "bbbbbbbb", startedAt: "2026-08-07T22:20:00.000Z", doors: ["cli"], cases: CASES_B });

  const res = stampRound(pool, "R2", "aaaaaaaa", { startedAt: "2026-08-07T22:00:00.000Z", startedAtSource: "status",
    reportedAt: "2026-08-07T23:00:00.000Z", reportedState: "settled" });
  assert.equal(res.ok, true);
  assert.equal(res.appended, true, "…and it SAYS it created the entry rather than patching one");
  assert.match(res.why, /nothing about what its doors answered/);

  const rounds = mergeRounds({ receiptRounds: readReceipt(pool, "R2").rounds, diskRounds: new Map() });
  const stub = rounds.find((r) => r.token === "aaaaaaaa");
  assert.equal(stub.reportedState, "settled", "the round is now markable as read — the warning has an off switch");
  assert.equal(stub.inReceipt, false,
    "…and it is STILL not a round whose door answers were recorded, so the report keeps declining that question");
  assert.deepEqual(stub.cases, []);
  assert.deepEqual(rounds.map((r) => r.token), ["bbbbbbbb", "aaaaaaaa"], "the stamped start time orders it correctly");

  // The default is the other way: everything `run` ever appended, and every v1 receipt, stays recorded.
  assert.equal(rounds.find((r) => r.token === "bbbbbbbb").inReceipt, true);
});

test("stampRound refuses a TORN receipt outright — a stamp is not worth the risk to bytes it cannot preserve", () => {
  const { pool } = makePool();
  const bytes = "{\"scenario\":\"R2\",\"token\":\"2328c0a8\",\"cases\":[  <-- truncated";
  writeFileSync(receiptPath(pool, "R2"), bytes);
  const res = stampRound(pool, "R2", "aaaaaaaa", { reportedState: "settled" });
  assert.equal(res.ok, false);
  assert.match(res.why, /does not parse as JSON/);
  assert.equal(readFileSync(receiptPath(pool, "R2"), "utf8"), bytes, "and the bytes are untouched");
});

// ── FIRST-READ IS A FACT ABOUT THE ROUND; LAST-CHECK IS NOT (, 2026-08-14) ──────────────────────
//
// `stampRound` merged `{ ...r, ...patch }` with the patch winning, and `report`'s call site passes a
// fresh timestamp unconditionally — so every re-read destroyed the original first-read stamp. Measured
// on test: 43 rounds carried both stamps and were destroyable, gaps up to 160.6 hours.
//
// It could not be deferred because it does not degrade to an ABSENCE — an instrument catches those. It
// degrades to a CREDIBLE WRONG NUMBER: a round noticed 34 hours late reads as noticed a week late, and
// nothing separates the artefact from the real thing.

test("#922 reportedAt is FIRST-WRITE-WINS, and lastReadAt carries the latest", () => {
  const first = firstWriteWins({}, { reportedAt: "2026-08-13T00:00:00Z", reportedState: "unknown" });
  assert.equal(first.reportedAt, "2026-08-13T00:00:00Z");
  assert.equal(first.lastReadAt, "2026-08-13T00:00:00Z", "a first read is also the latest read");

  const again = firstWriteWins({ reportedAt: "2026-08-13T00:00:00Z" },
    { reportedAt: "2026-08-14T12:00:00Z", reportedState: "settled" });
  assert.equal(again.reportedAt, "2026-08-13T00:00:00Z", "the original first-read stamp SURVIVES");
  assert.equal(again.lastReadAt, "2026-08-14T12:00:00Z", "and the re-check is recorded, not lost");
});

test("#922 THE SETTLEMENT WORD IS STILL OVERWRITTEN — the warning gate must not change", () => {
  // The stale-terminal warning keys on `reportedState`, never on `reportedAt != null`, precisely so a
  // thirty-second-early read cannot permanently silence it. That design is why this bug hid — one
  // field doing two jobs, and only the timestamp job was damaged — and it must survive the fix.
  const r = firstWriteWins({ reportedAt: "T1", reportedState: "in-flight" },
    { reportedAt: "T2", reportedState: "settled" });
  assert.equal(r.reportedState, "settled", "the newest settlement word always wins");
});

test("#922 a patch that carries no read stamp is untouched", () => {
  // `clearedAt` stamps and any future patch must not acquire a lastReadAt they never asked for.
  assert.deepEqual(firstWriteWins({ reportedAt: "T1" }, { clearedAt: "C" }), { clearedAt: "C" });
});
