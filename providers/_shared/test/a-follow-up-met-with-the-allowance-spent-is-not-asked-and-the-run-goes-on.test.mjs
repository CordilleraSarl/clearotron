// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOLLOW-UP MET WITH THE SAFETY NET FULL IS NOT SENT, KEEPS WHAT IT HAD, AND THE REST STILL RUNS.
//
// The net counts the follow-up searches a run's model adds, one per search sent, every worker and pass together;
// the plan's own questions and the identical mark's narrowing are never counted and never refused. Nothing in the
// executor's reply names the net. Driven through the real plan executor, against a stand-in register that answers
// each search with several requests, logged the way the providers log them. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeExecutePlan } from "../execute-plan.mjs";
import { makeLedger } from "../ledger.mjs";
import { FOLLOW_UP_SEARCH_LIMIT, SEARCHES_FILE, followUpSearchesSent, readOutstanding } from "../follow-up-searches.mjs";

const AXIS = "primary-sweep";
const LIMIT = FOLLOW_UP_SEARCH_LIMIT;
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const followUp = (qid, term, over = {}) => ({ qid, axis: AXIS, origin: "supplemental", predicate: "default", term,
  nice_classes: [9], regions: [], expected_kind: "enumerate", ...over });

/** A run folder with its record log and frozen plan, and `sent` follow-up searches already counted. */
function runFolder(t, { sent = 0 } = {}) {
  const run = mkdtempSync(join(tmpdir(), "follow-up-kernel-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const driver = join(run, "_driver");
  mkdirSync(driver, { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(join(driver, "register-plan.json"), JSON.stringify({ regions: [], entries: [
    { qid: `${AXIS}:exact:qzorvak`, axis: AXIS, predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9], expected_kind: "enumerate" },
  ] }));
  if (sent) writeFileSync(join(driver, SEARCHES_FILE), Array.from({ length: sent }, (_, i) => JSON.stringify({ qid: `earlier-${i}` })).join("\n") + "\n");
  return { run, driver, recordLog: join(driver, "register-record-bodies.jsonl") };
}

/** The executor against a stand-in register that answers each search with `requests` requests, some from memory. */
function executor({ requests = 3 } = {}) {
  const { logCall } = makeLedger("stand-in");
  const asked = [];
  const answer = (tctx, p) => {
    asked.push(p.name ?? (p.names ?? []).join("+"));
    for (let i = 0; i < requests; i++) logCall(tctx, { http_status: 200, ok: true, cache_hit: i % 2 === 1 });
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

test("the net fills partway through a turn's follow-ups: the rest are recorded as outstanding, not sent, and the reply names no net", async (t) => {
  const f = runFolder(t, { sent: LIMIT - 1 });
  const { executePlan, asked } = executor();
  const { reply, band } = await execute(executePlan, f, [
    followUp("sup:a", "QZORVA"), followUp("sup:b", "QZORVEK"), followUp("sup:c", "KORVAK"),
  ]);
  assert.deepEqual(asked, ["QZORVA"], "only the follow-up that met room in the net reached the register");
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT, "the search that took three requests counted once");
  assert.deepEqual(reply.outstanding, ["sup:b", "sup:c"]);
  assert.equal(JSON.stringify(reply).match(/limit|allowance|spent|paid|billing|\bcap\b/i), null, `the reply names the net: ${JSON.stringify(reply)}`);
  assert.deepEqual(band.map((b) => b.qid), ["sup:a"], "a question not sent gets no block, so nothing reads it as answered");
  const out = readOutstanding(f.driver);
  assert.deepEqual(out.map((r) => r.qid).sort(), ["sup:b", "sup:c"]);
  assert.ok(out.every((r) => r.reason === "follow-up-not-sent" && r.axis === AXIS && r.limit === LIMIT && typeof r.query === "string"));
});

test("a follow-up held back now keeps the answer it already had", async (t) => {
  const f = runFolder(t, { sent: LIMIT });
  const { executePlan, asked } = executor();
  const earlier = { qid: "sup:b", state: "enumerated", query: "QZORVEK", total_hits: 7, fetched: 7, sample: [] };
  const { reply, band } = await execute(executePlan, f, [followUp("sup:b", "QZORVEK")], { prior: [earlier] });
  assert.deepEqual(asked, []);
  assert.deepEqual(reply.outstanding, ["sup:b"]);
  assert.deepEqual(band, [earlier], "the earlier answer was dropped by a question that was never sent again");
});

test("with the net full, the plan's questions and the identical mark's narrowing still run, uncounted", async (t) => {
  const f = runFolder(t, { sent: LIMIT + 3 });
  const { executePlan, asked } = executor();
  const { reply } = await execute(executePlan, f, [
    { qid: `${AXIS}:default:qzorva`, axis: AXIS, predicate: "default", term: "QZORVA", nice_classes: [9], expected_kind: "enumerate" },
    { qid: `${AXIS}:wider:qzorvak`, axis: AXIS, predicate: "default", term: "QZORVAK GAMES", nice_classes: [9], expected_kind: "enumerate",
      provenance: "model", when: { awaits_reading_turn: true } },
    followUp("sup:goods", "Qzorvak", { predicate: "exact", goods_text: ["video games"] }),
    followUp("sup:goods-jp", "QZORVAK", { predicate: "exact", goods_text: ["video games"], regions: ["JP"] }),
    followUp("sup:wider", "QZORVAK", { predicate: "exact" }),
    followUp("sup:other", "KORVAK"),
  ]);
  assert.deepEqual(asked, ["QZORVA", "Qzorvak", "QZORVAK"],
    "the plan's question and the identical mark's two narrowing steps ran; the waiting family stayed unreleased");
  assert.deepEqual(reply.outstanding, ["sup:wider", "sup:other"], "a wider read of the identical mark counts like any follow-up");
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT + 3, "nothing uncounted was added to the count");
});

test("the identical mark is known from the frozen plan when the follow-ups' own file does not name it", async (t) => {
  const f = runFolder(t, { sent: LIMIT });
  const { executePlan, asked } = executor();
  const { reply } = await execute(executePlan, f, [followUp("sup:goods", "QZORVAK", { predicate: "exact", goods_text: ["video games"] })]);
  assert.deepEqual(asked, ["QZORVAK"]);
  assert.equal(reply.outstanding, undefined);
});

test("a search counts once whatever the register makes of it: one request or several, from memory or not", async (t) => {
  for (const requests of [1, 5]) {
    const f = runFolder(t);
    const { executePlan } = executor({ requests });
    await execute(executePlan, f, [followUp("sup:a", "QZORVA"), followUp("sup:b", "QZORVEK")]);
    assert.equal(followUpSearchesSent(f.driver).sent, 2, `${requests} request(s) a search counted other than once`);
  }
});

test("two workers sending at once share the one count, and none sends past it", async (t) => {
  const f = runFolder(t, { sent: LIMIT - 5 });
  const a = executor();
  const b = executor();
  const [ra, rb] = await Promise.all([
    execute(a.executePlan, f, Array.from({ length: 5 }, (_, i) => followUp(`sup:a${i}`, `QZORVA${i}`)), { file: "a-supplemental-plan.json" }),
    execute(b.executePlan, f, Array.from({ length: 5 }, (_, i) => followUp(`sup:b${i}`, `QZORVE${i}`)), { file: "b-supplemental-plan.json" }),
  ]);
  const ran = a.asked.length + b.asked.length;
  const notSent = (ra.reply.outstanding ?? []).length + (rb.reply.outstanding ?? []).length;
  assert.equal(ran + notSent, 10);
  assert.equal(ran, 5, "the net let through more or fewer searches than it had room for");
  assert.equal(followUpSearchesSent(f.driver).sent, LIMIT);
});
