// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEARCH TAKEN OUT OF THE BAND IS NEVER READ AS ANSWERED, WHATEVER WROTE THE BAND SINCE.
//
// A slice a check could not prove ran is taken out of its band and delivered open, and the run's searches record names
// it. A unit re-run writes its axis's band whole, so the slice can come back with the records nobody could prove were
// searched. The pipeline's band readers already read the recorded slices out. These are the other readers that take a
// band's blocks as answers: the answers every worker shares, the counts an answered list leaves, the propose tool's
// check on a question a worker re-proposes, the safety net's check on a follow-up asked before, and the executor's
// check on a parent before it releases a child. Each reads the recorded slices out, and reads as before when the
// record names none. Every band below holds the slice's records, as a re-run leaves it. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { writePartNotCompleted } from "../parts-not-completed.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { heldAnswers, countedOnLists, questionKey } from "../engine/mcp/held-answers.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";
import { makeLedger } from "../../providers/_shared/ledger.mjs";
import { FOLLOW_UP_SEARCH_LIMIT, followUpSearchesSent } from "../../providers/_shared/follow-up-searches.mjs";

const AXIS = "primary-sweep";
const REGIONS = ["JP", "KR"];
const REASON = plainDeferralReason("not-verified-closed");
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const record = (id, text) => ({ record_id: `/mark/jp/${id}`, mark_text: text, classes: [9], status: "Registered" });
const ALONE = { qid: `${AXIS}:exact:qzorvak`, axis: AXIS, predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9] };
const LIST = { qid: `${AXIS}:exact:qzorv-list`, axis: AXIS, predicate: "exact", terms: ["QZORVA", "QZORVEK"], provenance: "mark", nice_classes: [9] };

/** A run folder with its frozen plan and its record log. */
function runFolder(t, entries = [ALONE, LIST]) {
  const run = mkdtempSync(join(tmpdir(), "taken-out-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(driverDir(run, "register-plan.json"), JSON.stringify({ regions: REGIONS, nice_classes: ["9"], entries }));
  return { run, band: join(run, "register-units", `${AXIS}-band.json`), recordLog: driverDir(run, "register-record-bodies.jsonl") };
}

/** The searches record naming `qids` on the axis, as the pipeline writes it when it takes them out of the band. */
const takeOut = (run, qids) => writePartNotCompleted(run, "searches", { stage: "fan-in", reason: "a check could not prove the slices ran",
  slices: qids.map((qid) => ({ axis: AXIS, qid, reason: REASON })) });

test("the answers every worker shares, and an answered list's counts, leave out a slice the searches record took out", (t) => {
  const f = runFolder(t);
  writeFileSync(f.band, JSON.stringify([
    { qid: ALONE.qid, state: "enumerated", total_hits: 1, count: 1, records: [record("qzorvak-1", "QZORVAK")] },
    { qid: LIST.qid, state: "enumerated", total_hits: 260, count: 2, term_counts: { QZORVA: 140, QZORVEK: 120 },
      records: [record("qzorva-1", "QZORVA"), record("qzorvek-1", "QZORVEK")] },
  ]));
  const key = questionKey(ALONE, REGIONS);
  assert.equal(heldAnswers(f.run, { planRegions: REGIONS }).get(key)?.decision, "answered", "guard: with nothing taken out, the answer is held");
  assert.deepEqual([...countedOnLists(f.run, { planRegions: REGIONS }).keys()].sort(), ["qzorva", "qzorvek"], "guard: with nothing taken out, the list's counts stand");

  takeOut(f.run, [ALONE.qid, LIST.qid]);
  assert.equal(heldAnswers(f.run, { planRegions: REGIONS }).get(key), undefined, "a slice taken out was held as an answer");
  assert.equal(countedOnLists(f.run, { planRegions: REGIONS }).size, 0, "a list taken out still counted its names");
});

test("a question a worker re-proposes is asked again when the slice holding its answer was taken out", async (t) => {
  const f = runFolder(t, [ALONE]);
  const asked = [];
  const answer = (p) => { asked.push(p.name); return ok({ state: "enumerated", total_hits: 1, count: 1, records: [record("qzorva-1", "QZORVA")] }); };
  const real = makeExecutePlan({ search: async (_a, p) => answer(p), enumerate: async (_a, p) => answer(p), capabilities: { id: "a-register-that-needs-no-office" } });
  const executePlan = (params, tctx) => real("auth", params, tctx);
  const propose = async () => JSON.parse((await proposeSupplemental({ axis: AXIS, output_path: f.band,
    proposals: [{ predicate: "default", term: "QZORVA", nice_classes: [9], rationale: "a romanised spelling of the mark" }] },
    { kind: "propose_supplemental", sessionKey: "run-x" }, { executePlan })).text);

  const first = await propose();
  assert.equal(first.minted?.length, 1, "guard: the first proposal is minted");
  const [qid] = first.minted;
  assert.deepEqual((await propose()).held_answer_kept, [qid], "guard: with nothing taken out, the re-proposal keeps its answer");
  assert.equal(asked.length, 1, "guard: the held answer cost no call");

  takeOut(f.run, [qid]);
  const again = await propose();
  assert.equal(again.held_answer_kept, undefined, "a re-proposed question whose slice was taken out kept the unproven answer");
  assert.equal(asked.length, 2, "the register was not asked the question again");
});

test("a follow-up whose slice was taken out counts again when sent again, so the full net holds it back", async (t) => {
  const f = runFolder(t, [ALONE]);
  writeFileSync(driverDir(f.run, "follow-up-searches.jsonl"),
    Array.from({ length: FOLLOW_UP_SEARCH_LIMIT - 1 }, (_, i) => JSON.stringify({ qid: `earlier-${i}` })).join("\n") + "\n");
  const { logCall } = makeLedger("stand-in");
  const asked = [];
  const answer = (tctx, p) => { asked.push(p.name); logCall(tctx, { http_status: 200, ok: true });
    return ok({ state: "enumerated", total_hits: 1, count: 1, records: [record("qzorva-1", "QZORVA")] }); };
  const executePlan = makeExecutePlan({ search: async (_a, p, tctx) => answer(tctx, p), enumerate: async (_a, p, tctx) => answer(tctx, p),
    capabilities: { id: "a-register-that-needs-no-office" } });
  const planPath = join(f.run, "register-units", `${AXIS}-supplemental-plan.json`);
  writeFileSync(planPath, JSON.stringify({ regions: [], entries: [{ qid: "sup:a", axis: AXIS, origin: "supplemental", predicate: "default",
    term: "QZORVA", nice_classes: [9], regions: [], expected_kind: "enumerate" }] }));
  const send = async () => JSON.parse((await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: f.band },
    { kind: "propose_supplemental", recordLog: f.recordLog })).text);

  await send();
  assert.equal(followUpSearchesSent(driverDir(f.run)).sent, FOLLOW_UP_SEARCH_LIMIT, "guard: the first asking filled the net");
  assert.equal((await send()).outstanding, undefined, "guard: with nothing taken out, the answered follow-up is sent again uncounted");
  assert.equal(asked.length, 2, "guard: the answered follow-up was asked again");

  takeOut(f.run, ["sup:a"]);
  assert.ok(JSON.parse(readFileSync(f.band, "utf8")).find((b) => b.qid === "sup:a")?.records?.length, "guard: the band still holds the slice's records");
  assert.deepEqual((await send()).outstanding, ["sup:a"], "a follow-up whose slice was taken out was read as answered, and the full net sent it");
  assert.equal(asked.length, 2, "the register was asked past the full net");
});

test("a child is not released by a parent whose slice was taken out", async (t) => {
  const PARENT = { qid: "sup:parent", axis: AXIS, origin: "supplemental", predicate: "default", term: "QZORV", nice_classes: [9], regions: [], expected_kind: "enumerate" };
  const CHILD = { qid: "sup:child", axis: AXIS, origin: "supplemental", predicate: "default", term: "QZORVIN", nice_classes: [9], regions: [],
    expected_kind: "enumerate", when: { runs_if_enumerated: PARENT.qid } };
  const f = runFolder(t, [ALONE]);
  const asked = [];
  const answer = (p) => { asked.push(p.name); return ok({ state: "enumerated", total_hits: 0, count: 0, records: [] }); };
  const executePlan = makeExecutePlan({ search: async (_a, p) => answer(p), enumerate: async (_a, p) => answer(p), capabilities: { id: "a-register-that-needs-no-office" } });
  const planPath = join(f.run, "register-units", `${AXIS}-supplemental-plan.json`);
  writeFileSync(planPath, JSON.stringify({ regions: [], entries: [PARENT, CHILD] }));
  writeFileSync(f.band, JSON.stringify([{ qid: PARENT.qid, state: "enumerated", total_hits: 1, count: 1, records: [record("qzorv-1", "QZORV")] }]));
  const runChild = async () => JSON.parse((await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: f.band, qids: [CHILD.qid] },
    { kind: "propose_supplemental" })).text);

  assert.equal((await runChild()).skipped?.includes(CHILD.qid), false, "guard: with nothing taken out, the parent's answer releases the child");
  assert.deepEqual(asked, ["QZORVIN"], "guard: the child was asked");

  takeOut(f.run, [PARENT.qid]);
  assert.deepEqual((await runChild()).skipped, [CHILD.qid], "a parent whose slice was taken out released its child");
  assert.deepEqual(asked, ["QZORVIN"], "the register was asked a child of a slice taken out");
});

test("every band reader reads the searches record the pipeline writes, by axis, by qid or by query", async (t) => {
  const { slicesTakenOutByAxis } = await import("../../shared/slices-taken-out.mjs");
  const f = runFolder(t, [ALONE]);
  assert.equal(slicesTakenOutByAxis(f.run).size, 0, "a run with no record took a slice out");
  writePartNotCompleted(f.run, "searches", { stage: "fan-in", reason: "a check could not prove the slices ran", slices: [
    { axis: AXIS, qid: "q1", reason: REASON }, { axis: AXIS, query: "primary-sweep / exact near-name slice", reason: REASON },
    { axis: "incumbent-class", qid: "q2", reason: REASON }, { axis: "", qid: "q3", reason: REASON }, { axis: AXIS, reason: REASON },
  ] });
  const byAxis = slicesTakenOutByAxis(f.run);
  assert.deepEqual([...byAxis.keys()].sort(), ["incumbent-class", AXIS], "a slice with no axis, or with neither qid nor query, was read");
  assert.deepEqual(byAxis.get(AXIS).map((s) => s.qid ?? s.query), ["q1", "primary-sweep / exact near-name slice"]);
  writeFileSync(driverDir(f.run, "not-completed", "searches.json"), "{ torn");
  assert.equal(slicesTakenOutByAxis(f.run).size, 0, "a damaged record named a slice");
});
