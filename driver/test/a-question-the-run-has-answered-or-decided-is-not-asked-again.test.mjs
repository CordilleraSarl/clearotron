// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A QUESTION THE RUN HAS ANSWERED, OR DECIDED NOT TO ASK, IS NOT PUT TO THE REGISTER AGAIN.
//
// The register workers run in parallel and do not see each other's questions. On a test run of a crowded matter,
// 178 follow-up proposals held 167 distinct questions, and the 11 copies cost 49 calls. A question another worker
// has answered now gets that answer; one the run withheld, or one its allowance of paid follow-up calls refused,
// gets that decision. And a follow-up the run's safety net held back leaves the plan the fold reads and stays an open
// question, with its markets. Offline: the executor is a stand-in that writes the band the way the real one does.
// Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { proposeSupplemental, OUTSTANDING_NOTE } from "../engine/mcp/supplemental.mjs";
import { deriveAsks } from "../ask-ledger.mjs";
import { heldAnswers, refuseHeldQuestions } from "../engine/mcp/held-answers.mjs";
import { blocksByQidOf } from "../register-plan.mjs";
import { verifyRegisterDirectiveClose } from "../close-verify.mjs";

const tctx = { kind: "propose_supplemental", sessionKey: "run-x" };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

function runFolder(t) {
  const run = mkdtempSync(join(tmpdir(), "held-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(driverDir(run, "register-plan.json"), JSON.stringify({ regions: ["JP", "KR"], nice_classes: ["9"], entries: [
    { qid: "primary-sweep:exact:qzorvak", axis: "primary-sweep", predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9] },
    { qid: "primary-sweep:wider:qzorvak-games", axis: "primary-sweep", predicate: "default", term: "QZORVAK GAMES", nice_classes: [9],
      provenance: "model", when: { awaits_reading_turn: true } },
  ] }));
  const band = (axis) => join(run, "register-units", `${axis}-band.json`);
  const plan = (axis) => join(run, "register-units", `${axis}-supplemental-plan.json`);
  return { run, band, plan };
}

/** The stand-in executor: answers each targeted question into the band, merging as the real one does. */
function stand({ refuse = new Set(), fail = new Set() } = {}) {
  const calls = [];
  const executePlan = async (params) => {
    calls.push(...params.qids);
    const supp = readJson(params.plan_path);
    const prior = readJson(params.output_path) ?? [];
    const outstanding = [];
    const blocks = [];
    for (const e of supp.entries.filter((x) => params.qids.includes(x.qid))) {
      if (refuse.has(e.term)) { outstanding.push(e.qid); continue; }
      blocks.push(fail.has(e.term)
        ? { state: "incomplete", qid: e.qid, query: e.term, total_hits: 0, fetched: 0, sample: [], error: true, reason: "provider error — 502" }
        : { state: "enumerated", qid: e.qid, query: e.term, total_hits: 3, count: 3, sample: [],
          records: [{ record_id: `/mark/jp/${e.term.toLowerCase()}-1`, mark_text: e.term, classes: [9], status: "Registered" }] });
    }
    const owned = new Set(params.qids.filter((q) => !outstanding.includes(q)));
    writeFileSync(params.output_path, JSON.stringify([...blocks, ...prior.filter((b) => !owned.has(b.qid))]));
    return { type: "text", text: JSON.stringify({ executed: blocks.length,
      ...(outstanding.length ? { outstanding } : {}) }) };
  };
  return { executePlan, calls };
}

const propose = async (f, axis, proposals, executePlan) =>
  JSON.parse((await proposeSupplemental({ axis, output_path: f.band(axis), proposals }, tctx, { executePlan })).text);

test("a question another worker has answered is handed that answer, and the register is not asked", async (t) => {
  const f = runFolder(t);
  const { executePlan, calls } = stand();
  const a = await propose(f, "primary-sweep", [{ predicate: "exact", term: "QZORVEK", nice_classes: [9] }], executePlan);
  assert.equal(calls.length, 1);
  const b = await propose(f, "incumbent-class", [{ predicate: "exact", term: "QZORVEK", nice_classes: [9], regions: ["KR", "JP"] }], executePlan);
  assert.equal(calls.length, 1, "the same question, its markets the plan's, was put to the register a second time");
  assert.deepEqual(b.minted, []);
  assert.equal(b.executed, false);
  assert.equal(b.held.length, 1);
  assert.equal(b.held[0].decision, "answered");
  assert.equal(b.held[0].answered_by, a.minted[0]);
  assert.equal(b.held[0].axis, "primary-sweep");
  assert.equal(b.held[0].total_hits, 3);
  assert.equal(b.held[0].records_preview[0].record_id, "/mark/jp/qzorvek-1", "the worker gets the records, not just a pointer");
  assert.equal(b.outstanding_note, undefined, "an answered question carries the refusal's sentence");
  assert.ok(!(readJson(f.plan("incumbent-class"))?.entries ?? []).length, "the held question was minted into a second plan");
});

test("a different scope is a different question, and a failed answer is no answer: both are asked", async (t) => {
  const f = runFolder(t);
  const { executePlan, calls } = stand({ fail: new Set(["KORVAK"]) });
  await propose(f, "primary-sweep", [{ predicate: "exact", term: "QZORVEK", nice_classes: [9] }, { predicate: "exact", term: "KORVAK", nice_classes: [9] }], executePlan);
  assert.equal(calls.length, 2);
  const b = await propose(f, "incumbent-class", [
    { predicate: "exact", term: "QZORVEK", nice_classes: [9, 42] },
    { predicate: "exact", term: "QZORVEK", nice_classes: [9], regions: ["JP"] },
    { predicate: "exact", term: "KORVAK", nice_classes: [9] },
  ], executePlan);
  assert.equal(b.minted.length, 3);
  assert.equal(calls.length, 5);
  assert.equal(b.held, undefined);
});

test("a family the run withheld is not asked by a follow-up either; the decision is handed back", async (t) => {
  const f = runFolder(t);
  writeFileSync(driverDir(f.run, "withheld-families-primary-sweep.json"), JSON.stringify({ axis: "primary-sweep",
    families: { "primary-sweep:wider:qzorvak-games": { reason: "the wider read would not change what the client is told" } } }));
  const { executePlan, calls } = stand();
  const b = await propose(f, "incumbent-class", [{ predicate: "default", term: "QZORVAK GAMES", nice_classes: [9] }], executePlan);
  assert.equal(calls.length, 0);
  assert.deepEqual(b.held.map((h) => [h.decision, h.answered_by]), [["withheld", "primary-sweep:wider:qzorvak-games"]]);
});

test("a re-proposed question this worker has answered keeps its answer and is not re-run; a failed one is re-run", async (t) => {
  const f = runFolder(t);
  const { executePlan, calls } = stand({ fail: new Set(["KORVAK"]) });
  const p = [{ predicate: "exact", term: "QZORVEK", nice_classes: [9] }, { predicate: "exact", term: "KORVAK", nice_classes: [9] }];
  const first = await propose(f, "primary-sweep", p, executePlan);
  const again = await propose(f, "primary-sweep", p, executePlan);
  assert.deepEqual(again.reused.sort(), [...first.minted].sort());
  assert.deepEqual(again.held_answer_kept, [first.minted[0]]);
  assert.deepEqual(calls, [...first.minted, first.minted[1]], "only the failed question went back to the register");
  assert.equal(again.results[first.minted[0]].total_hits, 3);
});

test("a follow-up the safety net holds back leaves the plan, keeps its markets and goods, and stays an open question", async (t) => {
  const f = runFolder(t);
  const { executePlan } = stand({ refuse: new Set(["QZORVEX"]) });
  const narrow = { predicate: "exact", term: "QZORVEX", nice_classes: [9], goods_words: ["video games"] };
  const first = await propose(f, "primary-sweep", [{ ...narrow, regions: ["JP"] }], executePlan);
  assert.deepEqual(first.minted, []);
  assert.equal(first.outstanding.length, 1);
  assert.equal(/allowance|limit|spent|paid|\bcap\b/i.test(JSON.stringify(first)), false, `the reply names the net: ${JSON.stringify(first)}`);
  assert.equal(first.outstanding_note, "Not asked in this run. Keep it as an open question with your reason, and continue with what you have read.");
  assert.equal(first.outstanding_note, OUTSTANDING_NOTE);
  // the same question for the other market, asked later when a call was free
  const later = stand();
  await propose(f, "primary-sweep", [{ ...narrow, regions: ["KR"] }], later.executePlan);
  const supp = readJson(f.plan("primary-sweep"));
  assert.ok(!supp.entries.some((e) => first.outstanding.includes(e.qid)), "a question never asked would be read as a planned question gone missing");
  const row = supp.rejected.find((r) => r.issue === "follow-up-not-sent");
  assert.deepEqual([row.proposal.regions, row.proposal.goods_text], [["JP"], ["video games"]]);
  const asks = deriveAsks({ supplementalPlans: [{ axis: "primary-sweep", ...supp }] });
  const open = asks.filter((a) => a.ask_id.startsWith("ask:supplemental-rejected:") && a.ending === null);
  assert.equal(open.length, 1, "the market refused was buried under the market asked");
  // asked again, it would be refused again: the decision is handed back and no call is made
  const third = stand();
  const re = await propose(f, "incumbent-class", [{ ...narrow, regions: ["JP"] }], third.executePlan);
  assert.equal(third.calls.length, 0);
  assert.deepEqual(re.held.map((h) => h.decision), ["outstanding"]);
  assert.equal(re.outstanding_note, OUTSTANDING_NOTE, "a question held back earlier is not given the line");
});

test("second framing's re-sweep does not ask again a question another worker answered: it is checked on that worker's row", async (t) => {
  const f = runFolder(t);
  const { executePlan } = stand();
  const a = await propose(f, "primary-sweep", [{ predicate: "exact", term: "QZORVEK", nice_classes: [9] }], executePlan);
  const resweep = { qid: "supp:incumbent-class:exact:qzorvek:00000009", axis: "incumbent-class", predicate: "exact", term: "QZORVEK",
    nice_classes: [9], regions: [], origin: "supplemental" };
  const other = { ...resweep, qid: "supp:incumbent-class:exact:qzorvex:0000000a", term: "QZORVEX" };
  const regions = ["JP", "KR"];
  const { kept, refused } = refuseHeldQuestions([resweep, other], heldAnswers(f.run, { planRegions: regions }), regions);
  assert.deepEqual(kept.map((e) => e.qid), [other.qid], "a question nobody answered was refused");
  assert.deepEqual(refused.map((r) => [r.qid, r.kind, r.twin]), [[resweep.qid, "duplicate-question", a.minted[0]]]);
  const v = verifyRegisterDirectiveClose({ qids: [resweep.qid], intendedClasses: ["9"], executedQids: new Set([a.minted[0]]),
    blocksByQid: blocksByQidOf({ "primary-sweep": readJson(f.band("primary-sweep")) }), foldRefusals: new Map(refused.map((r) => [r.qid, r])) });
  assert.deepEqual([v.closed, v.answered_by], [true, [{ qid: resweep.qid, twin: a.minted[0] }]], "the directive did not close on the row that answered it");
});

test("a family waiting for the reading turn is no held answer until it is released, whatever block its row carries", (t) => {
  const f = runFolder(t);
  // the waiting family's row carries a block, as a stand-in band can; the plan join still reads it as not asked
  writeFileSync(f.band("primary-sweep"), JSON.stringify([{ qid: "primary-sweep:wider:qzorvak-games", state: "enumerated", total_hits: 1, records: [] }]));
  const regions = ["JP", "KR"];
  const ask = { qid: "supp:incumbent-class:default:qzorvak-games:0000000b", axis: "incumbent-class", predicate: "default", term: "QZORVAK GAMES", nice_classes: [9], regions: [] };
  assert.deepEqual(refuseHeldQuestions([ask], heldAnswers(f.run, { planRegions: regions }), regions).kept.map((e) => e.qid), [ask.qid],
    "a question repeating an unreleased family was refused as already answered");
  const released = heldAnswers(f.run, { planRegions: regions, released: new Set(["primary-sweep:wider:qzorvak-games"]) });
  assert.deepEqual(refuseHeldQuestions([ask], released, regions).refused.map((r) => r.twin), ["primary-sweep:wider:qzorvak-games"]);
});
