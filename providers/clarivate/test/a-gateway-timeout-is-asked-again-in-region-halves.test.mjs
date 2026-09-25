// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GATEWAY TIMEOUT ON THIS REGISTER: THE QUESTION IS ASKED AGAIN IN REGION HALVES, AND THE BODY IS KEPT.
//
// The register sits behind a gateway that answers HTTP 504 when a question runs longer than it waits. One
// question across 186 regions got that answer on every attempt, and every record of it stopped part-way
// through the gateway's own sentence. Driven through the real enumerate arm with the network stubbed: the
// question is asked again on each half of its offices, each call's row keeps a failed body whole, and a
// slice that ends incomplete reports each office's count from the part that counted it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "clarivate-gateway-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");

const { doEnumerate, doExecutePlan } = await import("../src/core.js");
const { joinPlanToBands } = await import("../../../driver/register-plan.mjs");
const { plainDeferralReason } = await import("../../../driver/deferral-row.mjs");

// The gateway's answer, in the shape it gives: a JSON problem document, longer than any clip downstream.
const GATEWAY_BODY = JSON.stringify({
  type: "https://gateway.example.test/errors/504", title: "Error 504: Gateway time-out", status: 504,
  detail: "The origin web server timed out responding to this request. " + "x".repeat(700) + " END-OF-BODY",
});

async function withRegister(timesOut, fn) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}");
    const offices = body.registrationOfficeCodes ?? [];
    const path = new URL(String(url)).pathname;
    asked.push(`${path} ${offices.join(",")}`);
    if (timesOut(offices)) return new Response(GATEWAY_BODY, { status: 504, headers: { "content-type": "application/json" } });
    const answer = path.endsWith("/count") ? { counts: Object.fromEntries(offices.map((o) => [o, 0])) } : { ids: {} };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  try { return { out: await fn(), asked }; } finally { globalThis.fetch = real; }
}

const calls = () => (existsSync(process.env.CLEAROTRON_REGISTER_CALL_LOG)
  ? readFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "utf8").trim().split("\n").map(JSON.parse) : []);

test("a count the gateway times out is asked again on each half of the offices, and the parts merge", async () => {
  const { out, asked } = await withRegister((offices) => offices.length > 2, () =>
    doEnumerate("k", "https://register.example.test", { names: ["QZXV"], regions: ["US", "CH", "GB", "DE"], match_mode: "exact" }, null));
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.state, "enumerated", parsed.reason);
  assert.deepEqual(parsed.region_split.parts, [2, 2]);
  assert.match(parsed.region_split.cause, /HTTP 504/);
  assert.deepEqual(asked.filter((a) => a.startsWith("/count")).map((a) => a.split(" ")[1]),
    ["US,CH,GB,DE", "US,CH,GB,DE", "US,CH", "GB,DE"], "the whole question (and its one in-call retry), then each half");
});

test("a failed call's row keeps the gateway's body whole; an answered call's row carries none", async () => {
  const before = calls().length;
  await withRegister((offices) => offices.length > 1, () =>
    doEnumerate("k", "https://register.example.test", { names: ["QZXV"], regions: ["US", "CH"], match_mode: "exact" }, null));
  const rows = calls().slice(before);
  const failed = rows.filter((r) => r.http_status === 504);
  assert.ok(failed.length > 0, "no failed call was logged");
  for (const r of failed) assert.equal(r.error_body, GATEWAY_BODY, "the body on the call's row was not the whole body");
  const answered = rows.filter((r) => r.http_status === 200);
  assert.ok(answered.length > 0 && answered.every((r) => !("error_body" in r)));
});

test("a slice that ends incomplete after a split reports each office's count from the part that counted it", async () => {
  // DE times out even alone and slows any question that asks it; US, CH and GB were each counted in a part.
  const { out } = await withRegister((offices) => offices.includes("DE"), () =>
    doEnumerate("k", "https://register.example.test", { names: ["QZXV"], regions: ["US", "CH", "GB", "DE"], match_mode: "exact" }, null));
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.state, "incomplete");
  assert.match(parsed.reason, /^after a gateway timeout the question was asked again in region halves, and the 2-region half GB…DE came back incomplete: /);
  assert.ok(parsed.reason.includes("END-OF-BODY") || parsed.reason.includes("HTTP 504"), parsed.reason);
  assert.deepEqual(parsed.per_office_counts, { US: 0, CH: 0, GB: 0 }, "the counts of every part, not only the first");
});

// THE PATH THE SLOW QUESTION CAME THROUGH: a frozen plan's entry, run by the plan executor.
async function executeOne(timesOut) {
  const dir = mkdtempSync(join(tmpdir(), "clarivate-plan-"));
  const plan = { regions: ["US", "CH", "GB", "DE"], entries: [
    { qid: "q-slow", axis: "transliteration-numeric", predicate: "exact", terms: ["QZXV"], nice_classes: [9], regions: ["US", "CH", "GB", "DE"] },
  ] };
  const planPath = join(dir, "register-plan.json"), outPath = join(dir, "band.json");
  writeFileSync(planPath, JSON.stringify(plan));
  const { asked } = await withRegister(timesOut, () =>
    doExecutePlan("k", "https://register.example.test", { plan_path: planPath, axis: "transliteration-numeric", output_path: outPath }, null));
  const blocks = JSON.parse(readFileSync(outPath, "utf8"));
  return { plan, block: blocks.find((b) => b.qid === "q-slow"), blocks, asked };
}

test("through the plan executor, a split question that answers is an executed slice, not an error", async () => {
  const { plan, block, blocks } = await executeOne((offices) => offices.length > 2);
  assert.equal(block.state, "enumerated", JSON.stringify(block));
  assert.equal(block.error, undefined);
  const joined = joinPlanToBands(plan, { "transliteration-numeric": blocks });
  assert.deepEqual(joined.missing, []);
  assert.ok(joined.executed.some((e) => (e.qid ?? e) === "q-slow"));
});

test("through the plan executor, a question that timed out on both halves is deferred and not asked again", async () => {
  const { plan, block, blocks, asked } = await executeOne((offices) => offices.length > 1);
  assert.equal(block.error, true);
  assert.equal(block.deferred, true, "a stall left to the recovery ladder would meet the same wall again");
  assert.match(block.reason, /^provider error \(not asked again\): provider error — mechanical-fail:timeout: after a gateway timeout/);
  const joined = joinPlanToBands(plan, { "transliteration-numeric": blocks });
  assert.deepEqual(joined.deferred.map((d) => d.qid), ["q-slow"]);
  assert.deepEqual(joined.missing, [], "the run goes on with the gap disclosed");
  assert.equal(plainDeferralReason(block.reason), "the source timed out this run", "the reader's line for it is the one the report already prints");
  // The whole question, then each half once, each with the fetch's own one retry: 6 counts, and no second
  // round from the executor.
  assert.equal(asked.filter((a) => a.startsWith("/count")).length, 6, asked.join(" · "));
});
