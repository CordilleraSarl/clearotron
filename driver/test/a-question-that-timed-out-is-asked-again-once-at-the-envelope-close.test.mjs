// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A QUESTION THAT TIMED OUT AT THE GATEWAY IS ASKED AGAIN ONCE, AT THE ENVELOPE CLOSE.
//
// On a test run of a crowded matter, 11 questions timed out at the register's gateway 24 times, two minutes each: the
// unit's retry after its pass was parked, the envelope close and the review each sent them again, and only the envelope
// close's ask ever answered. A question that times out, after its one in-tool retry, is now deferred and marked as a
// timeout, so the repair ladder does not send it again; a later call on its axis, and a unit's retry after a park, carry
// its answer instead of sending it; and the envelope close's own dispatch, which a tool argument cannot reach, asks it
// once. Driven through the real executor against a stand-in register that records every request. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";
import { joinPlanToBands } from "../register-plan.mjs";

const AXIS = "transliteration-numeric";
const SLOW = "QZORVAK-CN", QUICK = "QZORVAK";
const GATEWAY = "HTTP 504: Error 504: Gateway time-out";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const ENTRIES = [
  { qid: `${AXIS}:exact:slow`, axis: AXIS, predicate: "exact", term: SLOW, nice_classes: [9], regions: ["CN"], expected_kind: "enumerate" },
  { qid: `${AXIS}:exact:quick`, axis: AXIS, predicate: "exact", term: QUICK, nice_classes: [9], regions: ["CN"], expected_kind: "enumerate" },
  { qid: `${AXIS}:count:slow`, axis: AXIS, predicate: "exact", term: `${SLOW} COUNT`, nice_classes: [9], regions: ["CN"], expected_kind: "count" },
];

function runFolder(t) {
  const run = mkdtempSync(join(tmpdir(), "timed-out-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "_driver"), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  const plan = join(run, "_driver", "register-plan.json");
  writeFileSync(plan, JSON.stringify({ regions: ["CN"], entries: ENTRIES }));
  return { plan, band: join(run, "register-units", `${AXIS}-band.json`), recordLog: join(run, "_driver", "register-record-bodies.jsonl") };
}

/** A stand-in register that times out on every question naming the slow term, or fails another way, and answers the rest. */
function register({ slowFails = "timeout" } = {}) {
  const asked = [];
  const failure = slowFails === "timeout" ? GATEWAY : "HTTP 500: Internal Server Error";
  const executePlan = makeExecutePlan({
    search: async (_a, p) => {
      asked.push(p.name);
      if (String(p.name).startsWith(SLOW)) return { type: "text", text: `ERROR: register_search ${failure}` };
      return ok({ total_hits: 1, results: [{ record_id: "/mark/cn/1" }], has_more: false });
    },
    enumerate: async (_a, p) => {
      asked.push(p.name);
      if (String(p.name).startsWith(SLOW)) return ok({ state: "incomplete", total_hits: 0, fetched: 0, sample: [], reason: `provider error during enumeration (page 0): ${failure}` });
      return ok({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: "/mark/cn/1", mark_text: QUICK, classes: [9], status: "Registered" }] });
    },
    capabilities: { id: "a-register-that-needs-no-office", nativeScriptIndex: true },
  });
  return { asked, slowAsks: () => asked.filter((n) => String(n).startsWith(SLOW)).length, executePlan };
}

const call = async (reg, f, { params = {}, tctx = {} } = {}) => {
  const r = await reg.executePlan("auth", { plan_path: f.plan, axis: AXIS, output_path: f.band, ...params }, { kind: "execute_plan", recordLog: f.recordLog, ...tctx });
  assert.ok(!String(r.text).startsWith("ERROR"), r.text);
  return JSON.parse(r.text);
};
const blockOf = (f, qid) => JSON.parse(readFileSync(f.band, "utf8")).find((b) => b.qid === qid);
const receipt = (f) => joinPlanToBands(JSON.parse(readFileSync(f.plan, "utf8")), { [AXIS]: JSON.parse(readFileSync(f.band, "utf8")) });

test("a question that timed out after its in-tool retry is deferred as a timeout, so no rung of the repair ladder sends it again", async (t) => {
  const f = runFolder(t), reg = register();
  await call(reg, f);
  assert.equal(reg.slowAsks(), 4, "guard: each slow question was sent twice, its one in-tool retry included");
  for (const qid of [`${AXIS}:exact:slow`, `${AXIS}:count:slow`]) {
    const b = blockOf(f, qid);
    assert.deepEqual([b.error, b.deferred, b.gateway_timeout], [true, true, true], `${qid} is not a deferred timeout: ${JSON.stringify(b)}`);
  }
  assert.match(blockOf(f, `${AXIS}:exact:slow`).reason, /^provider error \(after one in-tool retry\): /, "the block's words changed");
  const r = receipt(f);
  assert.ok(!r.missing.some((q) => String(q?.qid ?? q).endsWith(":slow")), `a timed-out question is still missing, so the ladder sends it again: ${JSON.stringify(r.missing)}`);
  assert.ok(r.deferred.some((d) => d.qid === `${AXIS}:exact:slow`), "the timed-out question is not among the deferrals");
});

test("a later call on the axis, and a unit's retry after its pass was parked, carry the timeout and do not send it", async (t) => {
  const f = runFolder(t), reg = register();
  await call(reg, f);
  const before = reg.slowAsks();
  await call(reg, f);
  assert.equal(reg.slowAsks(), before, "a later call on the axis sent a timed-out question again");
  assert.ok(reg.asked.filter((n) => n === QUICK).length >= 2, "guard: the later call ran the axis's other questions");
  renameSync(f.band, `${f.band}.tainted-0`);   // the park: the band renamed, so the unit runs again from an empty one
  await call(reg, f);
  assert.equal(reg.slowAsks(), before, "the retry after the park sent a timed-out question again");
  assert.deepEqual([blockOf(f, `${AXIS}:exact:slow`).gateway_timeout, blockOf(f, `${AXIS}:exact:slow`).deferred], [true, true],
    "the retry's band does not carry the timeout, so the question would join the missing ones");
  assert.ok(receipt(f).deferred.some((d) => d.qid === `${AXIS}:exact:slow`), "after the park the timed-out question is not deferred");
});

test("the envelope close's dispatch asks a timed-out question again, once, and a tool argument cannot", async (t) => {
  const f = runFolder(t), reg = register();
  await call(reg, f);
  const before = reg.slowAsks();
  await call(reg, f, { params: { reaskTimedOut: true, reask_timed_out: true } });
  assert.equal(reg.slowAsks(), before, "a tool argument asked a timed-out question again");
  await call(reg, f, { params: { qids: [`${AXIS}:exact:slow`] }, tctx: { reaskTimedOut: true } });
  assert.equal(reg.slowAsks(), before + 2, "the envelope close's ask is not one call with its in-tool retry");
});

test("a question that failed some other way is still sent again", async (t) => {
  const f = runFolder(t), reg = register({ slowFails: "server" });
  await call(reg, f);
  const before = reg.slowAsks();
  assert.ok(!blockOf(f, `${AXIS}:exact:slow`).gateway_timeout, "a server error was marked a timeout");
  await call(reg, f);
  assert.ok(reg.slowAsks() > before, "a question that failed without timing out was held");
});

test("the envelope close's dispatch, and only it, carries the driver's re-ask through every register's adapter", () => {
  const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
  const config = readFileSync(join(DRIVER, "driver.config.mjs"), "utf8");
  const adapters = (config.match(/async executePlan\(\{ planPath, axis, outputPath, qids \}, \{[^}]*\}\)/g) ?? []);
  assert.ok(adapters.length >= 6, `guard: the registers' adapters were not found (${adapters.length})`);
  assert.ok(adapters.every((a) => a.includes("reaskTimedOut = false")), "an adapter does not take the re-ask");
  assert.equal((config.match(/recordLog, \.\.\.\(reaskTimedOut \? \{ reaskTimedOut: true \} : \{\}\) \}\);/g) ?? []).length, adapters.length,
    "an adapter does not hand the re-ask to its executor");
  const pipeline = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  assert.ok(pipeline.includes('...(repairId === "early-envelope-close" ? { reaskTimedOut: true } : {})'), "the envelope close's dispatch does not ask again");
  assert.equal((pipeline.match(/reaskTimedOut: true/g) ?? []).length, 1, "another dispatch asks a timed-out question again");
});
