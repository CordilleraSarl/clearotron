// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REGISTER UNIT RUN AGAIN BUYS NO ANSWER THE RUN HOLDS.
//
// A register unit sends its plan's questions through the executor. It runs again when its pass was parked (its band is
// renamed `<band>.tainted-<n>`), when its stage's record of what it read is missing, or when a call is made twice. Each
// of those sent every question again, answered or not: measured on this executor, 5 of 5. A register answer is paid
// for, and it does not change within the run, so the executor now reuses an answer the run holds to the same question,
// from the band or from a band a parked pass left. A failed answer, and a slice a check took out of the band, are
// unfinished work and are asked again.
//
// Every question is counted at a stand-in register, through the real executor. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { notCompletedPath } from "../../shared/slices-taken-out.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";
import { SEARCHES_FILE } from "../../providers/_shared/follow-up-searches.mjs";

const AXIS = "primary-sweep";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const TERMS = ["QZORVAK", "QZORVAC", "KZORVAK", "QZORVAX"];
const PLAN = () => [
  ...TERMS.map((term, i) => ({ qid: `${AXIS}:exact:q${i}`, axis: AXIS, predicate: "exact", term, provenance: "mark", nice_classes: [9] })),
  { qid: `${AXIS}:count:crowd`, axis: AXIS, predicate: "exact", term: "QZOR", provenance: "mark", nice_classes: [9], expected_kind: "count" },
  { qid: `${AXIS}:supp:qzorvok`, axis: AXIS, predicate: "default", term: "QZORVOK", nice_classes: [9], origin: "supplemental" },
];

/** A run folder with a frozen plan, and a stand-in register that counts every question and may fail named terms. */
function standIn(t, { entries = PLAN(), provider = "a-register-that-needs-no-office" } = {}) {
  const run = mkdtempSync(join(tmpdir(), "unit-run-again-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  const planPath = driverDir(run, "register-plan.json");
  writeFileSync(planPath, JSON.stringify({ regions: ["EM"], nice_classes: ["9"], entries }));
  const band = join(run, "register-units", `${AXIS}-band.json`);
  const sent = [];
  const failing = new Set();
  const answer = (p) => {
    sent.push(p.name);
    if (failing.has(p.name)) return { type: "text", text: "ERROR: provider 502", isError: true };
    return ok({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: `/mark/em/${p.name}`, mark_text: p.name, classes: [9], status: "Registered" }] });
  };
  const counted = (p) => { sent.push(`count:${p.name}`); return ok({ total_hits: 12000, results: [] }); };
  const executorFor = (id) => makeExecutePlan({ search: async (_a, p) => counted(p), enumerate: async (_a, p) => answer(p), capabilities: { id } });
  let exec = executorFor(provider);
  const tctx = { kind: "execute_plan", sessionKey: `clearance-x-register-unit:${AXIS}`, recordLog: driverDir(run, "register-record-bodies.jsonl") };
  const go = async () => {
    sent.length = 0;
    const r = await exec("auth", { plan_path: planPath, axis: AXIS, output_path: band }, tctx);
    assert.ok(!String(r?.text ?? "").startsWith("ERROR"), `the executor refused: ${r?.text}`);
    return [...sent];
  };
  const blocks = () => JSON.parse(readFileSync(band, "utf8"));
  const switchTo = (id) => { exec = executorFor(id); };
  return { run, planPath, band, go, blocks, failing, switchTo };
}
const followUps = (run) => (existsSync(driverDir(run, SEARCHES_FILE)) ? readFileSync(driverDir(run, SEARCHES_FILE), "utf8").trim().split("\n").filter(Boolean).length : 0);
const answersOf = (blocks) => blocks.filter((b) => b.qid).map(({ qid, state, total_hits, records }) => ({ qid, state, total_hits, records })).sort((a, b) => a.qid.localeCompare(b.qid));

test("a unit run again over its own band asks the register nothing it holds", async (t) => {
  const u = standIn(t);
  const first = await u.go();
  assert.equal(first.length, PLAN().length, `premise: the first pass asked every question once: ${first}`);
  const held = answersOf(u.blocks());
  assert.deepEqual(await u.go(), [], "a question the run holds an answer to was asked again");
  assert.deepEqual(answersOf(u.blocks()), held, "and every held answer stands as it was");
});

test("a unit run again after its pass was parked takes the parked band's answers, and asks nothing", async (t) => {
  const u = standIn(t);
  await u.go();
  const held = answersOf(u.blocks());
  renameSync(u.band, `${u.band}.tainted-1`);
  assert.deepEqual(await u.go(), [], "an answer in the parked band was bought again");
  assert.deepEqual(answersOf(u.blocks()), held, "the unit's new band holds the answers the parked band held");
  assert.ok(existsSync(`${u.band}.tainted-1`), "and the parked band is kept as it was");
});

test("a failed answer is asked again, once, and nothing answered is", async (t) => {
  const u = standIn(t);
  u.failing.add("QZORVAC");
  const first = await u.go();
  assert.ok(first.filter((n) => n === "QZORVAC").length >= 1, "premise: the failing question was asked");
  assert.equal(u.blocks().find((b) => b.qid === `${AXIS}:exact:q1`)?.error, true, "premise: its answer is a failure");
  u.failing.clear();
  renameSync(u.band, `${u.band}.tainted-1`);
  assert.deepEqual(await u.go(), ["QZORVAC"], "only the failed question is asked again");
  assert.equal(u.blocks().find((b) => b.qid === `${AXIS}:exact:q1`)?.state, "enumerated", "and its answer now stands");
});

test("a slice a check took out of the band is asked again, and nothing else is", async (t) => {
  const u = standIn(t);
  await u.go();
  mkdirSync(driverDir(u.run, "not-completed"), { recursive: true });
  writeFileSync(notCompletedPath(u.run, "searches"), JSON.stringify({ slices: [{ axis: AXIS, qid: `${AXIS}:exact:q2`, reason: "a check could not prove this slice ran" }] }));
  renameSync(u.band, `${u.band}.tainted-1`);
  assert.deepEqual(await u.go(), ["KZORVAK"], "the slice taken out is asked again, alone");
});

test("a question that would now send something else is a new question, whatever its id", async (t) => {
  const u = standIn(t);
  await u.go();
  const entries = PLAN();
  entries[0].nice_classes = [9, 42];
  writeFileSync(u.planPath, JSON.stringify({ regions: ["EM"], nice_classes: ["9"], entries }));
  assert.deepEqual(await u.go(), ["QZORVAK"], "the question asked over other classes is asked; the others are held");
  u.switchTo("another-register");
  assert.equal((await u.go()).length, PLAN().length, "another register's answers are no answer to this one's questions");
});

test("an answer that records nothing of what was sent is asked again, once", async (t) => {
  const u = standIn(t);
  await u.go();
  writeFileSync(u.band, JSON.stringify(u.blocks().map(({ sent: _s, ...b }) => b)));
  assert.equal((await u.go()).length, PLAN().length, "an answer that cannot show its question is asked again");
  assert.deepEqual(await u.go(), [], "and, recorded with its question, it is not asked a third time");
});

test("a reused answer counts nothing against the follow-up allowance", async (t) => {
  const u = standIn(t);
  await u.go();
  const counted = followUps(u.run);
  assert.equal(counted, 1, "premise: the one follow-up question was counted once when it was asked");
  renameSync(u.band, `${u.band}.tainted-1`);
  await u.go();
  await u.go();
  assert.equal(followUps(u.run), counted, "a run whose unit ran again counts its follow-ups as an uninterrupted run does");
});
