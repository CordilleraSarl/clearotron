// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEARCH THE CLIENT REFUSED BEFORE SENDING SAYS SO, AND IS NOT CALLED A PROVIDER ERROR.
//
// An exact phrase whose middle word is OR, AND or NOT cannot be stated in this register's query language, so the
// client refuses it before sending anything, and the slice is deferred as a capability gap. Its reason read
// "provider error (after one in-tool retry): provider error on the count probe before enumeration: capability-gap:
// …", and the lawyer's coverage ledger prints that reason beside the deferred row: an error from a register that
// was never asked. It now reads "refused before sending: capability-gap: …" with the client's own words, on the
// enumerate arm and the count arm. The marker stays, so every reader that classifies a deferral reads it as before.
//
// A query the register itself refused as written carries the marker too, but it was sent, so it keeps its words.
// So does an ordinary failure. Driven through the real executor with the network stubbed. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doExecutePlan } from "../src/core.js";
import { joinPlanToBands } from "../../../driver/register-plan.mjs";
import { isCapabilityGapReason } from "../../../driver/coverage-ledger.mjs";

// The provider's answer to a query its search service cannot take, in the shape the service gives it.
const WRAPPED = { errorMessage: "INTERNAL_SERVER_ERROR - 400  on POST request for \"http://search/search\": "
  + "\"{\\\"status\\\":400,\\\"error\\\":\\\"Bad Request\\\",\\\"path\\\":\\\"/search\\\"}\" (Error:500)" };

/** Run one axis of these entries against a register that answers every request with `status` and `body`. */
async function runPlan(t, entries, status = 200, body = { counts: { US: 0 }, ids: {}, totalResults: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), "refused-before-sending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const plan = { regions: ["US"], entries: entries.map((e) => ({ axis: "primary-sweep", nice_classes: [9], ...e })) };
  const planPath = join(dir, "register-plan.json"), outPath = join(dir, "primary-sweep-band.json");
  writeFileSync(planPath, JSON.stringify(plan));
  try {
    await doExecutePlan("k", "https://x", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, null);
  } finally { globalThis.fetch = real; }
  const blocks = JSON.parse(readFileSync(outPath, "utf8"));
  return { plan, blocks, sent, byQid: Object.fromEntries(blocks.map((b) => [b.qid, b])) };
}

test("an exact phrase with an operator word is refused before sending, in the client's words, on both arms", async (t) => {
  const { plan, blocks, sent, byQid } = await runPlan(t, [
    { qid: "q-enum", predicate: "exact", term: "MOSSEL AND FERNLY" },
    { qid: "q-count", predicate: "exact", term: "MOSSEL AND FERNLY", expected_kind: "count" },
  ]);
  assert.deepEqual(sent, [], "a refused slice reached the register");
  for (const qid of ["q-enum", "q-count"]) {
    const b = byQid[qid];
    assert.match(b.reason, /^refused before sending: capability-gap: term "MOSSEL AND FERNLY" contains a reserved boolean operator/, `${qid}: ${b.reason}`);
    assert.doesNotMatch(b.reason, /provider error/i, `${qid}: a refusal nobody sent still reads as the register's error`);
    assert.equal(b.error, true, `${qid}: a refused slice must never read as a crowd`);
    assert.equal(b.deferred, true, `${qid}: a refusal that cannot change was left to the recovery ladder`);
    assert.ok(isCapabilityGapReason(b.reason), `${qid}: the deferral no longer reads as a capability gap downstream`);
  }
  const join_ = joinPlanToBands(plan, { "primary-sweep": blocks });
  assert.deepEqual(join_.deferred.map((d) => d.qid).sort(), ["q-count", "q-enum"]);
  assert.deepEqual(join_.missing, []);
});

test("THE CONTROL: a query the register refused as written was sent, and keeps its words", async (t) => {
  const { byQid } = await runPlan(t, [{ qid: "q-wide", predicate: "exact", term: "LANTERNWICK" }], 500, WRAPPED);
  const b = byQid["q-wide"];
  assert.doesNotMatch(b.reason, /refused before sending/, b.reason);
  assert.match(b.reason, /capability-gap: register_refused_query: /);
  assert.equal(b.deferred, true);
});

test("THE CONTROL: an ordinary failure keeps its provider-error wording", async (t) => {
  const { byQid } = await runPlan(t, [{ qid: "q-down", predicate: "exact", term: "LANTERNWICK" }], 500,
    { errorMessage: "Count Failed - US - the index is rebuilding" });
  assert.match(byQid["q-down"].reason, /^provider error \(after one in-tool retry\): /, byQid["q-down"].reason);
  assert.notEqual(byQid["q-down"].deferred, true, "a transient failure lost its recovery ladder");
});
