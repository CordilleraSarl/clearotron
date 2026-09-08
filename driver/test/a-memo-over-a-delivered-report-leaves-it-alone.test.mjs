// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE LAWYER'S QUESTION THE PRODUCT REFUSED ──────────────────────────
//
// Asked "what if we treat the Korean application as expired?" about a delivered report, the product's
// only answer was "closed runs are read-only; commission a fresh Korean run". Both halves were true and
// there was nothing in between. A memo is the in-between: it reads the evidence already gathered,
// applies the stated assumption, and says what changes — dispatching no search and rating nothing anew.
//
// THE RULE THESE ARMS EXIST FOR: the delivered report and its archive are never modified. That is not a
// courtesy — immutability of a delivered record is what makes the memo safe to offer at all, and the
// feature exists precisely so nobody is ever tempted to relax it. The arm below hashes the parent before
// and after rather than trusting that a composer which "returns text" wrote nothing.
//
// BREAK MATRIX:
//   · a memo is allowed on a delivered run       → break: refuse it, arm 1 red
//   · a stage re-run is still refused there      → break: allow it, arm 2 red
//   · cancelled stays refused for BOTH kinds     → break: allow either, arm 3 red
//   · the parent is byte-identical after         → break: write anything, arm 4 red
//   · the envelope carries what a reader needs   → break: drop a field, arm 5 red
//   · a limit names the smallest search          → break: state a bare limit, arm 6 red
//   · it never reads as a report                 → break: drop the banner, arm 7 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whatIfRefusal } from "../whatif-queue.mjs";
import { decodeOp } from "../../mcp-server/lib/whatif.mjs";
import { composeMemo, MEMO_BANNER, REQUIRED } from "../whatif-memo.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const OK = {
  assumption: "treat the Align Networks Korean application as expired",
  parentRunId: "tmpx1-venqori-2026-09-01-jade-anvil",
  parentReport: "Full country search — VENQORI (KR)",
  date: "2026-09-04",
  body: "Finding 2 rests on that application being live. Under the assumption it stops driving the verdict,\nand the remaining on-field conflict is finding 5.",
  limits: [{ cannot: "Whether the application is in fact abandoned", smallestSearch: "a register status check on the single KR application" }],
  mark: "VENQORI",
  ratedUnder: "venqori",
};

// ── THE RATING AUTHORITY, IN THE ARTIFACT ────────────────────────────────────────────────────────────
//
// The seat is instructed to assess under a named framework — or told the run froze none and to stay with
// the house default — and until this was recorded the only thing that reached disk was the reasoning.
// A memo is a document a lawyer may act on; it has to say what it was rated under.
//
// THREE STATES, and separating the third is the point. A named key is one fact. The house default is a
// DIFFERENT fact rather than an absence, so it is written out. A caller that resolved no authority at
// all is neither, and it cannot compose: a memo silent about its own authority is the defect this
// closes, so it must not be reachable.

test("a named authority is written into the memo itself", () => {
  const memo = composeMemo({ ...OK, ratedUnder: "petcary" });
  assert.equal(memo.ok, true);
  assert.match(memo.text, /\*\*Rated under:\*\* petcary/,
    "the artifact does not say which authority it was reasoned under");
});

test("no frozen profile is RECORDED as the house default, not left blank", () => {
  const memo = composeMemo({ ...OK, ratedUnder: null });
  assert.equal(memo.ok, true);
  assert.match(memo.text, /\*\*Rated under:\*\* the house default/);
  assert.match(memo.text, /froze no customer profile/,
    "and it says WHY it is the house default, which is the fact a reader needs");
});

test("an authority nobody resolved REFUSES — absent is not the same fact as either", () => {
  const { ratedUnder, ...withoutIt } = OK;
  const r = composeMemo(withoutIt);
  assert.equal(r.ok, false, "a memo composed in silence about its authority is the defect itself");
  assert.deepEqual(r.missing, ["ratedUnder"]);
  assert.match(r.reason, /or null for a run that froze no customer profile/,
    "the refusal must name the answer for the null case, or a caller will invent a string");
});

/**
 * The parent's files, hashed BY NAME rather than by walking what happens to be there.
 *
 * A discovered walk would assert "nothing I found changed", which is weaker and quieter: it cannot tell
 * an untouched file from one it never looked at, and it would pass on a fixture that lost a file before
 * the hashing began. Naming them says what is being protected, and the count arm below refuses a fixture
 * that stopped carrying one.
 */
const PARENT_FILES = ["report.md", "findings.json", "register-findings.md", "status.json", join("_driver", "run.jsonl")];
const hashes = (dir) => new Map(PARENT_FILES.map((rel) => [rel, createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex")]));

/** A delivered run's archived evidence — the population a memo reasons over. */
function deliveredRun() {
  const dir = mkdtempSync(join(tmpdir(), "memo-parent-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "report.md"), "# Report\nOverall: CONDITIONAL\n");
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [{ ordinal: 2, mark: "ALIGN" }] }));
  writeFileSync(join(dir, "register-findings.md"), "## Findings\n| Mark | Owner |\n|---|---|\n| ALIGN | Align Networks |\n");
  writeFileSync(join(dir, "status.json"), JSON.stringify({ schema: 1, state: "delivered", deliveredAt: "2026-09-01T09:00:00Z" }));
  writeFileSync(join(dir, "_driver", "run.jsonl"), JSON.stringify({ event: "stage", stage: "synthesis" }) + "\n");
  return dir;
}

test("2166 a MEMO is allowed on a delivered report — the refusal was answering a narrower question", () => {
  // THE DEFECT, REPRODUCED: the old refusal covered both kinds, so the lawyer's question met a wall.
  const asStage = whatIfRefusal({ location: "archive", state: "delivered" });
  assert.match(asStage, /what-if runs on live runs only/, "the fixture no longer reproduces the refusal this issue is about");

  for (const shape of [{ state: "delivered" }, { location: "archive" }, { markers: [".delivered"] }]) {
    assert.equal(whatIfRefusal({ ...shape, kind: "memo" }), null,
      `a memo was refused on a finished run (${JSON.stringify(shape)}) — this is the defect`);
  }
});

test("2166 a STAGE re-run is still refused on a finished run — the live path is unchanged", () => {
  // The half that must NOT move. A memo is not a licence to recompute a delivered report's own stages.
  for (const shape of [{ state: "delivered" }, { location: "archive" }, { markers: [".delivered"] }]) {
    assert.match(whatIfRefusal({ ...shape }), /live runs only/, `a stage re-run was allowed on ${JSON.stringify(shape)}`);
    assert.match(whatIfRefusal({ ...shape, kind: "stage" }), /live runs only/);
  }
  // And an unfinished run is still open to both — a failed run is how somebody investigates a failure.
  assert.equal(whatIfRefusal({ state: "failed" }), null);
  assert.equal(whatIfRefusal({ state: "failed", kind: "memo" }), null);
});

test("2166 a CANCELLED run refuses both kinds, and says why for each", () => {
  // Reasoning over a record its owner stopped mid-gather is how a memo comes to say more than the run
  // ever knew — a different failure from re-running a stage, and it gets a different sentence.
  const stage = whatIfRefusal({ state: "cancelled" });
  const memo = whatIfRefusal({ state: "cancelled", kind: "memo" });
  assert.match(stage, /nothing here to re-run/);
  assert.match(memo, /never finished/);
  assert.notEqual(stage, memo, "both kinds got one sentence, so a reader cannot tell which was refused");
});

test("2166 composing a memo leaves the delivered run BYTE-IDENTICAL", () => {
  const parent = deliveredRun();
  const before = hashes(parent);
  assert.equal(before.size, PARENT_FILES.length, "the fixture stopped carrying a file this arm protects");

  const memo = composeMemo({ ...OK, parentRunId: "x", parentReport: "y" });
  assert.equal(memo.ok, true, memo.reason);

  const after = hashes(parent);
  for (const [k, v] of nonEmpty([...before], "the parent's hashed files"))
    assert.equal(after.get(k), v, `${k} changed — a memo modified the delivered run`);
  // AND NOTHING NEW APPEARED beside them: a memo that wrote a file into the parent would leave the five
  // above identical and still have modified a delivered record.
  assert.deepEqual(readdirSync(parent).sort(), ["_driver", "findings.json", "register-findings.md", "report.md", "status.json"],
    "a file appeared in or vanished from the delivered run");
});

test("2166 the memo carries what a reader needs, and refuses rather than degrade without it", () => {
  const memo = composeMemo(OK);
  assert.equal(memo.ok, true, memo.reason);
  assert.ok(memo.text.startsWith(MEMO_BANNER), "the banner is not the first thing a reader meets");
  assert.match(memo.text, /treat the Align Networks Korean application as expired/, "the assumption is not carried verbatim");
  assert.match(memo.text, /tmpx1-venqori-2026-09-01-jade-anvil/, "the parent run is not named");
  assert.match(memo.text, /Full country search — VENQORI \(KR\)/, "the parent report is not named");
  assert.match(memo.text, /2026-09-04/, "the memo is undated");

  // EVERY required field, dropped one at a time. A memo missing its assumption cannot tell a reader what
  // was assumed; one missing its parent is an orphan opinion about a report nobody can identify.
  for (const field of nonEmpty(REQUIRED, "the memo's required fields")) {
    const r = composeMemo({ ...OK, [field]: "" });
    assert.equal(r.ok, false, `a memo composed with no ${field}`);
    assert.ok(r.missing.includes(field), `the refusal does not name ${field}`);
  }
});

test("2166 a limit names the smallest search that would settle it, or the memo refuses", () => {
  const bare = composeMemo({ ...OK, limits: [{ cannot: "Whether the application is abandoned" }] });
  assert.equal(bare.ok, false, "a limit with no named search was accepted — that tells a reader they need "
    + "more without telling them what to buy");
  assert.match(bare.reason, /smallest search/);

  const good = composeMemo(OK);
  assert.match(good.text, /register status check on the single KR application/);
  assert.equal(good.limitsStated, 1);

  // AN EMPTY LIST IS A CLAIM, NOT A SILENCE. It must read as one, and the count must record which claim
  // was made — otherwise "no limits" and "nobody looked" are the same document.
  const none = composeMemo({ ...OK, limits: [] });
  assert.equal(none.ok, true);
  assert.equal(none.limitsStated, 0);
  assert.match(none.text, /no part of the answer above is waiting on a search/);
});

test("2166 a memo never reads as a report", () => {
  const memo = composeMemo(OK);
  assert.match(memo.text, /not a clearance report, and not an update to one/i);
  assert.match(memo.text, /No new searching/i);
  assert.match(memo.text, /the report it derives from is unchanged/i);
  // The heading a reader skims must not say "report" on its own line either.
  const heading = memo.text.split("\n").find((l) => l.startsWith("# "));
  assert.match(heading, /Supplementary memo/, "the memo's own title does not say what it is");
});

// ---- the token, which is what the two doors actually act on ------------------------------------

const token = (op) => Buffer.from(JSON.stringify(op)).toString("base64url");

test("2166 a memo token decodes on its own terms — no stage, and the assumption is required", () => {
  const good = decodeOp(token({ runId: "tmpx1-venqori-2026-09-01-jade-anvil", kind: "memo", instructions: OK.assumption }));
  assert.equal(good.kind, "memo");
  assert.equal(good.instructions, OK.assumption);
  assert.equal(good.stage, undefined, "a memo token carries a stage, which is a lie about what it does");

  // THE ASSUMPTION IS THE WHOLE INPUT. A memo without one has nothing to apply and would compose a
  // document whose reader cannot tell what was assumed — refused at the door rather than downstream.
  assert.throws(() => decodeOp(token({ runId: "r", kind: "memo" })), /needs the assumption/);
  assert.throws(() => decodeOp(token({ runId: "r", kind: "memo", instructions: "   " })), /needs the assumption/);
  assert.throws(() => decodeOp(token({ kind: "memo", instructions: "x" })), /missing runId/);

  // A token that names a stage was not planned as a memo, whatever its kind says. Two fields disagreeing
  // about what an op IS, is the shape that lets one door act on a different op from the other.
  assert.throws(() => decodeOp(token({ runId: "r", kind: "memo", instructions: "x", stage: "synthesis" })),
    /re-runs no stage/);
});

test("2166 the live token contract is untouched — a stage op still validates exactly as before", () => {
  // Criterion 4 in one arm: the memo branch returns early, and must not have loosened anything behind it.
  assert.throws(() => decodeOp(token({ runId: "r" })), /missing runId/);
  assert.throws(() => decodeOp(token({ runId: "r", stage: "not-a-stage" })), /unknown stage/);
  assert.throws(() => decodeOp(token({ runId: "r", stage: "register-unit" })), /requires a valid axis/);
  assert.throws(() => decodeOp(token({ runId: "r", stage: "synthesis", axis: "primary-sweep" })), /axis only applies/);
  const ok = decodeOp(token({ runId: "r", stage: "synthesis" }));
  assert.equal(ok.stage, "synthesis");
  assert.equal(ok.kind, undefined, "a stage op grew a kind it never had");
});

// ── A MEMO MAY WRITE ONLY WHERE IT WAS INVITED ───────────────────────────────────────────────────────
//
// The immutability check above fired on every successful memo, not only on a misbehaving one, because a
// memo's DISPATCH leaves driver telemetry on the parent — `_driver/whatif-memo.*` and an appended line
// in `_driver/run.jsonl`. That is the parent gaining a RECORD of the memo, which is correct and is the
// same rule the experiment path lives by. Recorded as a violation, it made the byte-identical criterion
// unsatisfiable on the real path and buried the one write that WAS a violation.
//
// Driven on the footprint an archived client run actually carries. `memo-osler-coexistence.json` at that
// run's root is the seat's reply written to a path of its own choosing instead of to the `expectFile` it
// was handed — which is also why the attempt before it failed looking for a reply that was not there.
import { splitMemoFootprint } from "../whatif-memo-run.mjs";

test("the memo's own record is not a violation; a write anywhere else is", () => {
  const { own, foreign } = splitMemoFootprint([
    { path: "_driver/whatif-memo.attempt1.dispatch.txt", before: null, after: "a:10" },
    { path: "_driver/whatif-memo.attempt2.dispatch.txt", before: null, after: "b:10" },
    { path: "_driver/whatif-memo.jsonl", before: null, after: "c:20" },
    { path: "_driver/run.jsonl", before: "d:100", after: "e:180" },      // appended to — a dispatch does this
    { path: "memo-osler-coexistence.json", before: null, after: "f:900" }, // the seat, off its path
  ]);
  assert.deepEqual(own.map((m) => m.path),
    ["_driver/whatif-memo.attempt1.dispatch.txt", "_driver/whatif-memo.attempt2.dispatch.txt",
      "_driver/whatif-memo.jsonl", "_driver/run.jsonl"]);
  assert.deepEqual(foreign.map((m) => m.path), ["memo-osler-coexistence.json"]);
});

test("a scored artifact is foreign however it moved — the record is what this protects", () => {
  // The direction that matters for a client. A memo that rewrote findings.json would be the archive
  // being altered, and no naming convention may excuse it.
  const { foreign } = splitMemoFootprint([
    { path: "findings.json", before: "x:10", after: "y:12" },
    { path: "report.md", before: "p:1", after: null },
  ]);
  assert.deepEqual(foreign.map((m) => m.path), ["findings.json", "report.md"]);
});

test("run.jsonl may only GROW — a shrink or a rewrite is not an append", () => {
  const shrank = splitMemoFootprint([{ path: "_driver/run.jsonl", before: "a:500", after: "b:100" }]);
  assert.deepEqual(shrank.foreign.map((m) => m.path), ["_driver/run.jsonl"], "a truncation must not pass as a dispatch's append");
  const same = splitMemoFootprint([{ path: "_driver/run.jsonl", before: "a:500", after: "b:500" }]);
  assert.deepEqual(same.foreign.map((m) => m.path), ["_driver/run.jsonl"], "same length with different bytes is a rewrite");
  // …and the size check is only as good as the sizes being readable. An unreadable digest is foreign,
  // because a check that cannot look must not answer "fine".
  const unreadable = splitMemoFootprint([{ path: "_driver/run.jsonl", before: "UNREADABLE", after: "UNREADABLE" }]);
  assert.deepEqual(unreadable.foreign.map((m) => m.path), ["_driver/run.jsonl"]);
});

test("a name that merely starts like the memo's telemetry is not excused", () => {
  // The exclusion is a prefix on the memo's own dispatch files inside `_driver/`. A file at the run root
  // whose name begins the same way is not that, and reading it as the memo's own would be the hole.
  const { foreign } = splitMemoFootprint([
    { path: "whatif-memo.jsonl", before: null, after: "a:1" },
    { path: "_memos-decoy/whatif-memo.jsonl", before: null, after: "a:1" },
  ]);
  assert.equal(foreign.length, 2, "only `_driver/whatif-memo.*` is the memo's own record");
});
