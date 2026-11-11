// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REDONE REGISTER READING ASKS NOTHING ALREADY ANSWERED, ON EVERY REGISTER (2026-11-11). A register answer is paid
// for, and it does not change within the run, so the run never pays for it twice.
//
// A Knockout's register reading runs again on a resume only when something it read has changed: the order's words, the
// plan, a count it reads, or its own record of what it read. The redone reading asks through the same propose tool and
// executor as the first. Every answer the run holds is reused, and only a question the run never got an answer to is
// sent, as finishing the run would send it. These arms count every question put to a stand-in register, through the
// real tool and executor, once for each register this build knows. They prove what is sent, not what a model would
// choose to ask.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { executeQuestionsWithLister, knockoutAxis, knockoutBandBlocks, knockoutBandPath, knockoutQuestionPlan, questionPlanPath } from "../knockout-register-read.mjs";

const NAME = "QUILLBRAE";
const REGISTERS = ["corsearch", "clarivate", "signa", "euipo", "uspto-local", "free-tier"];
const row = (id) => ({ record_id: `/mark/em/${id}`, mark_text: NAME, owner_name: `Owner ${id}`, status: "Registered", classes: [9], office: "em" });

/** A stand-in register that answers every question with one filing, and counts each question it is sent. */
function standIn({ failFirst = null } = {}) {
  const sent = [];
  let failed = false;
  const lister = async (term, q = {}) => {
    sent.push({ term, classes: q.classes ?? [], goods: q.goods ?? null, mode: q.matchMode ?? null });
    if (failFirst && !failed && failFirst(term, q)) { failed = true; return { ok: false, records: null, reason: "the register did not answer" }; }
    return { ok: true, total: 1, records: [row(`${term}-${(q.classes ?? []).join("+")}-${(q.goods ?? []).join("+")}`)] };
  };
  return { sent, lister };
}

/** A run folder holding one name's question plan, for register `id`. */
function runFor(id) {
  const capabilities = capabilitiesFor(id);
  const dir = mkdtempSync(join(tmpdir(), `redone-reading-${id}-`));
  mkdirSync(driverDir(dir), { recursive: true });
  const scope = { marks: [{ name: NAME, classes: [9] }], classes: [9], jurisdictions: ["EU", "US"], provider: id, capabilities };
  writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ marks: [NAME] }));
  writeFileSync(questionPlanPath(dir), JSON.stringify(knockoutQuestionPlan(scope)));
  return { dir, capabilities };
}

/** One reading's questions, through the real propose tool and the real executor. */
const read = ({ dir, capabilities }, lister, proposals) => proposeSupplemental({ axis: knockoutAxis(NAME), output_path: knockoutBandPath(dir, NAME), proposals },
  { kind: "propose_supplemental", recordLog: driverDir(dir, "register-record-bodies.jsonl") },
  { executePlan: (params) => executeQuestionsWithLister(lister, params), capabilities });

const OWN_LIST = { predicate: "exact", term: NAME, nice_classes: [9], rationale: "the name's own list" };
const NARROWED = { predicate: "exact", term: NAME, nice_classes: [9], goods_words: ["tonic"], rationale: "the client's goods" };
const ADDED_CLASS = { predicate: "exact", term: NAME, nice_classes: [32], rationale: "a class the client's goods add" };
const FIRST = [OWN_LIST, NARROWED, ADDED_CLASS];
/** The same questions, asked again with other words around them, as a redone reading asks them. */
const AGAIN = FIRST.map((p) => ({ ...p, rationale: `${p.rationale}, read again after the resume` }));

for (const id of REGISTERS) {
  test(`${id}: a redone reading asks the register nothing it already answered, whatever made it run again`, async () => {
    const run = runFor(id);
    const { sent, lister } = standIn();
    await read(run, lister, FIRST);
    const firstSent = sent.length;
    assert.ok(firstSent > 0, `premise: the first reading asked ${id} something`);
    const answered = knockoutBandBlocks(run.dir, NAME).size;
    assert.ok(answered > 0, "premise: the run holds the answers");
    // The order's words, the plan, a count or the reading's own record changed: the redone reading asks again.
    sent.length = 0;
    const reply = JSON.parse((await read(run, lister, AGAIN)).text);
    assert.deepEqual(sent, [], `${id}: a question already answered was sent again: ${JSON.stringify(sent)}`);
    assert.equal(knockoutBandBlocks(run.dir, NAME).size, answered, "and every held answer stands");
    assert.ok(reply.minted.length === 0, `${id}: nothing new was minted: ${JSON.stringify(reply.minted)}`);
  });

  test(`${id}: a redone reading that asks something new sends only that`, async () => {
    const run = runFor(id);
    const { sent, lister } = standIn();
    await read(run, lister, FIRST);
    sent.length = 0;
    const fresh = { predicate: "exact", term: NAME, nice_classes: [33], rationale: "a class the changed plan adds" };
    const onItsOwn = standIn();
    await read(runFor(id), onItsOwn.lister, [fresh]);
    await read(run, lister, [...AGAIN, fresh]);
    assert.deepEqual(sent, onItsOwn.sent, `${id}: the redone reading sent more than the one question it never asked: ${JSON.stringify(sent)}`);
  });

  test(`${id}: a question whose answer failed is asked again, as finishing the run would ask it, and nothing else is`, async () => {
    const run = runFor(id);
    const { sent, lister } = standIn({ failFirst: (_term, q) => (q.classes ?? []).map(String).includes("32") });
    await read(run, lister, FIRST);
    const failedAt = sent.filter((s) => s.classes.map(String).includes("32")).length;
    assert.ok(failedAt > 0, `premise: the added class's question was sent to ${id} and failed`);
    sent.length = 0;
    await read(run, lister, AGAIN);
    assert.equal(sent.length, failedAt, `${id}: the failed question is asked again, once: ${JSON.stringify(sent)}`);
    assert.ok(sent.every((s) => s.classes.map(String).includes("32")), `${id}: and nothing that was answered: ${JSON.stringify(sent)}`);
  });
}

// ── AN ANSWER STANDS ONLY FOR THE QUESTION IT ANSWERED ───────────────────────────────────────────────────────────────
// The plan is written again on every pass from the framed names, and a name's own questions keep their ids when the
// frame changes what they ask. A held answer is reused only where the question now sends what it sent then.
const planOf = (dir) => JSON.parse(readFileSync(questionPlanPath(dir), "utf8"));
const ownQuestions = (dir) => planOf(dir).entries.filter((e) => e.axis === knockoutAxis(NAME)).map((e) => e.qid);
const askPlan = (run, lister) => executeQuestionsWithLister(lister, { plan_path: questionPlanPath(run.dir), axis: knockoutAxis(NAME),
  output_path: knockoutBandPath(run.dir, NAME), qids: ownQuestions(run.dir) });
function rewritePlan(dir, change) {
  const plan = planOf(dir);
  change(plan.entries.find((e) => e.axis === knockoutAxis(NAME)));
  writeFileSync(questionPlanPath(dir), JSON.stringify(plan));
}

for (const id of REGISTERS) {
  test(`${id}: a question whose words changed under the same id is asked again, and nothing else is`, async () => {
    const run = runFor(id);
    const { sent, lister } = standIn();
    await askPlan(run, lister);
    assert.ok(sent.length > 0, `premise: the plan's own question was put to ${id}`);
    const [qid] = ownQuestions(run.dir);
    rewritePlan(run.dir, (e) => { e.term = `${NAME} TONIC`; });
    sent.length = 0;
    await askPlan(run, lister);
    assert.deepEqual(sent.map((s) => s.term), [`${NAME} TONIC`], `${id}: the changed question is asked, once: ${JSON.stringify(sent)}`);
    const block = JSON.parse(readFileSync(knockoutBandPath(run.dir, NAME), "utf8")).find((b) => b.qid === qid);
    assert.equal(block.query.term, `${NAME} TONIC`, "and its answer replaces the old question's");
  });
}

test("a plan written again in the same words asks nothing", async () => {
  const run = runFor("signa");
  const { sent, lister } = standIn();
  await askPlan(run, lister);
  assert.ok(sent.length > 0, "premise: the plan's own question was asked");
  rewritePlan(run.dir, (e) => { e.origin = "plan"; });
  sent.length = 0;
  await askPlan(run, lister);
  assert.deepEqual(sent, [], `a question asking what it asked before was sent again: ${JSON.stringify(sent)}`);
});

test("a question asked over other goods or regions under the same id is asked again", async () => {
  for (const [what, change] of [["goods", (e) => { e.goods_text = ["tonic water"]; }], ["regions", (e) => { e.regions = ["EM"]; }]]) {
    const run = runFor("signa");
    const { sent, lister } = standIn();
    await askPlan(run, lister);
    rewritePlan(run.dir, change);
    sent.length = 0;
    await askPlan(run, lister);
    assert.equal(sent.length, 1, `${what}: the changed question is asked, once: ${JSON.stringify(sent)}`);
  }
});

test("an answer that records nothing of what was asked is asked again, once", async () => {
  const run = runFor("signa");
  const { sent, lister } = standIn();
  await askPlan(run, lister);
  const band = JSON.parse(readFileSync(knockoutBandPath(run.dir, NAME), "utf8"));
  assert.ok(band.length > 0 && band.every((b) => typeof b.sent === "string"), "premise: every answer records what was sent for it");
  writeFileSync(knockoutBandPath(run.dir, NAME), JSON.stringify(band.map(({ sent: _s, ...b }) => b)));
  const before = sent.length;
  sent.length = 0;
  await askPlan(run, lister);
  assert.equal(sent.length, before, "a held answer that cannot show its question is asked again");
  sent.length = 0;
  await askPlan(run, lister);
  assert.deepEqual(sent, [], "and once answered with its question recorded, it is not asked a third time");
});
