// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOLLOW-UP MET WITH THE RUN'S ALLOWANCE SPENT IS NOT ASKED, KEEPS WHAT IT HAD, AND THE REST STILL RUNS.
//
// Ruled 2026-10-21: 250 paid follow-up register calls per run, every worker and pass together; the plan's own
// questions and the identical mark's narrowing are never counted and never refused. Driven through the real plan
// executor and the real shared call ledger, against a stand-in register that logs each call it answers the way the
// providers do. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeExecutePlan } from "../execute-plan.mjs";
import { makeLedger } from "../ledger.mjs";
import { RUN_CALL_LIMIT, ALLOWANCE_FILE, spentCalls, readOutstanding } from "../call-allowance.mjs";

const AXIS = "primary-sweep";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const followUp = (qid, term, over = {}) => ({ qid, axis: AXIS, origin: "supplemental", predicate: "default", term,
  nice_classes: [9], regions: [], expected_kind: "enumerate", ...over });

/** A run folder with its record log and frozen plan, and the allowance already spent down to `spent`. */
function runFolder(t, { spent = 0 } = {}) {
  const run = mkdtempSync(join(tmpdir(), "allowance-kernel-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const driver = join(run, "_driver");
  mkdirSync(driver, { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(join(driver, "register-plan.json"), JSON.stringify({ regions: [], entries: [
    { qid: `${AXIS}:exact:qzorvak`, axis: AXIS, predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9], expected_kind: "enumerate" },
  ] }));
  if (spent) writeFileSync(join(driver, ALLOWANCE_FILE), Array.from({ length: spent }, (_, i) => JSON.stringify({ qid: `earlier-${i}` })).join("\n") + "\n");
  return { run, driver, recordLog: join(driver, "register-record-bodies.jsonl") };
}

/** The executor against a stand-in register that logs every call it answers through the shared ledger. */
function executor({ cacheHit = false } = {}) {
  const { logCall } = makeLedger("stand-in");
  const asked = [];
  const answer = (tctx, p) => {
    asked.push(p.name ?? (p.names ?? []).join("+"));
    logCall(tctx, { http_status: 200, ok: true, cache_hit: cacheHit });
  };
  const executePlan = makeExecutePlan({
    search: async (_a, p, tctx) => { answer(tctx, p); return ok({ total_hits: 0, results: [], has_more: false }); },
    enumerate: async (_a, p, tctx) => { answer(tctx, p); return ok({ state: "enumerated", total_hits: 0, count: 0, records: [] }); },
    capabilities: { id: "a-register-that-needs-no-office" },
  });
  return { executePlan, asked };
}

async function execute(executePlan, f, entries, { prior = null, file = `${AXIS}-supplemental-plan.json` } = {}) {
  const planPath = join(f.run, "register-units", file);
  const outPath = join(f.run, "register-units", `${AXIS}-band.json`);
  writeFileSync(planPath, JSON.stringify({ regions: [], entries }));
  if (prior) writeFileSync(outPath, JSON.stringify(prior));
  const res = await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: outPath }, { kind: "propose_supplemental", recordLog: f.recordLog });
  assert.ok(!String(res.text).startsWith("ERROR"), res.text);
  return { reply: JSON.parse(res.text), band: JSON.parse(readFileSync(outPath, "utf8")) };
}

test("the allowance runs out partway through a turn's follow-ups: the rest are recorded as outstanding, not asked", async (t) => {
  const f = runFolder(t, { spent: RUN_CALL_LIMIT - 1 });
  const { executePlan, asked } = executor();
  const { reply, band } = await execute(executePlan, f, [
    followUp("sup:a", "QZORVA"), followUp("sup:b", "QZORVEK"), followUp("sup:c", "KORVAK"),
  ]);
  assert.deepEqual(asked, ["QZORVA"], "only the follow-up that met an open allowance reached the register");
  assert.equal(spentCalls(f.driver).spent, RUN_CALL_LIMIT);
  assert.deepEqual(reply.outstanding, ["sup:b", "sup:c"]);
  assert.deepEqual(reply.allowance, { spent: RUN_CALL_LIMIT, limit: RUN_CALL_LIMIT, reason: "run-call-limit" });
  assert.deepEqual(band.map((b) => b.qid), ["sup:a"], "a question not asked gets no block, so nothing reads it as answered");
  const out = readOutstanding(f.driver);
  assert.deepEqual(out.map((r) => r.qid).sort(), ["sup:b", "sup:c"]);
  assert.ok(out.every((r) => r.reason === "run-call-limit" && r.axis === AXIS && r.limit === RUN_CALL_LIMIT && typeof r.query === "string"));
});

test("a follow-up refused now keeps the answer it already had", async (t) => {
  const f = runFolder(t, { spent: RUN_CALL_LIMIT });
  const { executePlan, asked } = executor();
  const earlier = { qid: "sup:b", state: "enumerated", query: "QZORVEK", total_hits: 7, fetched: 7, sample: [] };
  const { reply, band } = await execute(executePlan, f, [followUp("sup:b", "QZORVEK")], { prior: [earlier] });
  assert.deepEqual(asked, []);
  assert.deepEqual(reply.outstanding, ["sup:b"]);
  assert.deepEqual(band, [earlier], "the earlier answer was dropped by a question that was never re-asked");
});

test("with the allowance spent, the plan's questions and the identical mark's narrowing still run, uncounted", async (t) => {
  const f = runFolder(t, { spent: RUN_CALL_LIMIT + 3 });
  const { executePlan, asked } = executor();
  const { reply } = await execute(executePlan, f, [
    { qid: `${AXIS}:default:qzorva`, axis: AXIS, predicate: "default", term: "QZORVA", nice_classes: [9], expected_kind: "enumerate" },
    { qid: `${AXIS}:wider:qzorvak`, axis: AXIS, predicate: "default", term: "QZORVAK GAMES", nice_classes: [9], expected_kind: "enumerate",
      provenance: "model", when: { awaits: "reading-turn" } },
    followUp("sup:goods", "Qzorvak", { predicate: "exact", goods_text: ["video games"] }),
    followUp("sup:goods-jp", "QZORVAK", { predicate: "exact", goods_text: ["video games"], regions: ["JP"] }),
    followUp("sup:wider", "QZORVAK", { predicate: "exact" }),
    followUp("sup:other", "KORVAK"),
  ]);
  assert.deepEqual(asked, ["QZORVA", "Qzorvak", "QZORVAK"],
    "the plan's question and the identical mark's two narrowing steps ran; the waiting family stayed unreleased");
  assert.deepEqual(reply.outstanding, ["sup:wider", "sup:other"], "a wider read of the identical mark counts like any follow-up");
  assert.equal(spentCalls(f.driver).spent, RUN_CALL_LIMIT + 3, "nothing uncounted was added to the allowance");
});

test("the identical mark is known from the frozen plan when the follow-ups' own file does not name it", async (t) => {
  const f = runFolder(t, { spent: RUN_CALL_LIMIT });
  const { executePlan, asked } = executor();
  const { reply } = await execute(executePlan, f, [followUp("sup:goods", "QZORVAK", { predicate: "exact", goods_text: ["video games"] })]);
  assert.deepEqual(asked, ["QZORVAK"]);
  assert.equal(reply.outstanding, undefined);
});

test("an answer the run's memory serves costs nothing and is not counted", async (t) => {
  const f = runFolder(t, { spent: RUN_CALL_LIMIT - 1 });
  const { executePlan, asked } = executor({ cacheHit: true });
  const { reply } = await execute(executePlan, f, [followUp("sup:a", "QZORVA"), followUp("sup:b", "QZORVEK")]);
  assert.deepEqual(asked, ["QZORVA", "QZORVEK"]);
  assert.equal(reply.outstanding, undefined);
  assert.equal(spentCalls(f.driver).spent, RUN_CALL_LIMIT - 1);
});

test("two workers spending at once share the one allowance: every answered call is counted, and the overrun is what was in flight", async (t) => {
  const f = runFolder(t, { spent: RUN_CALL_LIMIT - 5 });
  const a = executor();
  const b = executor();
  const [ra, rb] = await Promise.all([
    execute(a.executePlan, f, Array.from({ length: 5 }, (_, i) => followUp(`sup:a${i}`, `QZORVA${i}`)), { file: "a-supplemental-plan.json" }),
    execute(b.executePlan, f, Array.from({ length: 5 }, (_, i) => followUp(`sup:b${i}`, `QZORVE${i}`)), { file: "b-supplemental-plan.json" }),
  ]);
  const ran = a.asked.length + b.asked.length;
  const notAsked = (ra.reply.outstanding ?? []).length + (rb.reply.outstanding ?? []).length;
  assert.equal(ran + notAsked, 10);
  assert.equal(spentCalls(f.driver).spent, RUN_CALL_LIMIT - 5 + ran, "a call answered was lost from the count");
  assert.ok(ran >= 5, "the allowance closed before it was spent");
  assert.ok(spentCalls(f.driver).spent <= RUN_CALL_LIMIT + 1, "the overrun is more than the one call the other worker had in flight");
});
