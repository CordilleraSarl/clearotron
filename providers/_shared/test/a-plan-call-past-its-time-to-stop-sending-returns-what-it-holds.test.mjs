// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLAN CALL PAST ITS TIME TO STOP SENDING RETURNS WHAT IT HOLDS.
//
// A plan call runs inside a model's turn. When the call outlasted the turn, the two ended together and the unit could
// not write what the call had answered: on a production run on 2026-10-21 a unit's plan search ran into the register's
// gateway timeouts on every attempt and never wrote its result. The driver now hands each turn's tool servers a time
// to stop sending. Past it, the executor sends no new question, and a question the gateway timed out is not split
// into region halves again: the call returns what it holds, names the questions it did not reach, and leaves their
// blocks in the band as they were. A call with no such time runs as it always did.
//
// Driven through the real executor and the real enumeration against stand-in registers. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "send-until-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");
const { makeExecutePlan } = await import("../execute-plan.mjs");
const { makeEnumerate } = await import("../enumerate.mjs");
const { pastSendUntil, sendReserveMs, sendUntilFromEnv } = await import("../send-until.mjs");

const AXIS = "primary-sweep";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const question = (qid, term) => ({ qid, axis: AXIS, origin: "supplemental", predicate: "default", term, nice_classes: [9], regions: [], expected_kind: "enumerate" });
const answered = (term) => ok({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: `/mark/jp/${term.toLowerCase()}-1`, mark_text: term, classes: [9], status: "Registered" }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setUp(t, terms, prior = []) {
  const run = mkdtempSync(join(tmpdir(), "send-until-run-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "register-units"), { recursive: true });
  const planPath = join(run, "register-units", `${AXIS}-supplemental-plan.json`);
  const outPath = join(run, "register-units", `${AXIS}-band.json`);
  writeFileSync(planPath, JSON.stringify({ regions: [], entries: terms.map(([qid, term]) => question(qid, term)) }));
  writeFileSync(outPath, JSON.stringify(prior));
  return { planPath, outPath, qids: terms.map(([qid]) => qid) };
}

test("the reserve is a quarter of the turn and never more than five minutes, and a call with no time runs as before", () => {
  assert.equal(sendReserveMs(1500), 300_000);
  assert.equal(sendReserveMs(600), 150_000);
  assert.equal(sendReserveMs(undefined), 0);
  assert.equal(pastSendUntil(null), false, "a call with no context was stopped");
  assert.equal(pastSendUntil({}), false, "a call with no time to stop sending was stopped");
  assert.equal(pastSendUntil({ sendUntilMs: 1000 }, 999), false);
  assert.equal(pastSendUntil({ sendUntilMs: 1000 }, 1000), true);
  assert.equal(sendUntilFromEnv({ CLEAROTRON_GATHER_SEND_UNTIL_MS: "1234" }), 1234);
  assert.equal(sendUntilFromEnv({}), null);
});

test("past its time to stop sending, the call sends no question, names each, and leaves their blocks as they were", async (t) => {
  const prior = [{ qid: "sup:b", state: "enumerated", total_hits: 0, count: 0, records: [] }, { qid: "other:x", state: "enumerated", total_hits: 0, count: 0, records: [] }];
  const { planPath, outPath, qids } = setUp(t, [["sup:a", "QZORVA"], ["sup:b", "QZORVEK"]], prior);
  let sent = 0;
  const executePlan = makeExecutePlan({ search: async (_a, p) => { sent++; return answered(p.name); }, enumerate: async (_a, p) => { sent++; return answered(p.name); },
    capabilities: { id: "a-register-that-needs-no-office" } });
  const out = JSON.parse((await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: outPath, qids }, { sendUntilMs: Date.now() - 1 })).text);
  assert.equal(sent, 0, "a question was sent past the time to stop sending");
  assert.deepEqual(out.not_reached, qids, "the questions the call did not reach are not named");
  const band = JSON.parse(readFileSync(outPath, "utf8"));
  assert.deepEqual(band.map((b) => b.qid).sort(), ["other:x", "sup:b"], "a block the band held was dropped, or one was added for a question never sent");
});

test("a call that reaches its time to stop sending part-way keeps what it answered and names the rest", async (t) => {
  const { planPath, outPath, qids } = setUp(t, [["sup:a", "QZORVA"], ["sup:b", "QZORVEK"], ["sup:c", "QZORVIX"]]);
  const slow = async (_a, p) => { await sleep(150); return answered(p.name); };
  const executePlan = makeExecutePlan({ search: slow, enumerate: slow, capabilities: { id: "a-register-that-needs-no-office" } });
  const out = JSON.parse((await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: outPath, qids }, { sendUntilMs: Date.now() + 75 })).text);
  assert.deepEqual(out.not_reached, ["sup:b", "sup:c"], "the call did not stop at its time to stop sending");
  const band = JSON.parse(readFileSync(outPath, "utf8"));
  assert.deepEqual(band.map((b) => b.qid), ["sup:a"], "the answer the call had was not kept, or a question past the time has a block");
  assert.equal(band[0].state, "enumerated");
});

test("with no time to stop sending, every question is sent and nothing is named as not reached", async (t) => {
  const { planPath, outPath, qids } = setUp(t, [["sup:a", "QZORVA"], ["sup:b", "QZORVEK"]]);
  const executePlan = makeExecutePlan({ search: async (_a, p) => answered(p.name), enumerate: async (_a, p) => answered(p.name),
    capabilities: { id: "a-register-that-needs-no-office" } });
  const out = JSON.parse((await executePlan("auth", { plan_path: planPath, axis: AXIS, output_path: outPath, qids }, {})).text);
  assert.equal("not_reached" in out, false);
  assert.deepEqual(JSON.parse(readFileSync(outPath, "utf8")).map((b) => b.qid), qids);
});

// The gateway's own answer to a question slower than it waits.
const GATEWAY = "ERROR: register_search HTTP 504: " + JSON.stringify({ title: "Error 504: Gateway time-out", status: 504, detail: "The origin web server timed out responding to this request." });
function slowRegister() {
  const asked = [];
  const { enumerate } = makeEnumerate({
    search: async (_auth, params) => { asked.push(params.regions.length); return params.regions.length > 1 ? { type: "text", text: GATEWAY } : ok({ total_hits: 1, results: [{ record_id: `/mark/${params.regions[0].toLowerCase()}/1` }], has_more: false }); },
    capabilities: { countProbe: "cheap", screenSource: "search-row", ceilingDefault: 600 },
    rowScreen: () => ({ verdict: "live" }),
  });
  return { enumerate: (params, tctx) => enumerate({}, params, tctx), asked };
}

test("past its time to stop sending, a question the gateway timed out is not split into region halves", async () => {
  const before = slowRegister();
  await before.enumerate({ names: ["QZXV"], regions: ["AA", "BB", "CC", "DD"] }, { sendUntilMs: Date.now() + 600_000 });
  assert.ok(before.asked.length > 1, `premise: with time left, the timed-out question is split (asked ${JSON.stringify(before.asked)})`);
  const past = slowRegister();
  await past.enumerate({ names: ["QZXV"], regions: ["AA", "BB", "CC", "DD"] }, { sendUntilMs: Date.now() - 1 });
  assert.ok(past.asked.every((n) => n === 4), `the question was split past its time to stop sending: ${JSON.stringify(past.asked)}`);
});
