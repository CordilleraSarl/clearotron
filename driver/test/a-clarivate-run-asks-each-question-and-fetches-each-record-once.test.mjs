// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-clarivate-run-asks-each-question-and-fetches-each-record-once.test.mjs
//
// THE DEFECT. Nothing on the Clarivate path remembered anything within a run. Every repair, re-attempt and
// follow-up that asked a question again sent the count, the search and the record fetch again, and an owner
// name was looked up once per question that named it. In production, 7–22 September, 47% of the records a
// run fetched were records it already held.
//
// THE CHANGE, which these arms hold it to:
//   · the run memory is ON for this register unless its switch says otherwise;
//   · an identical /count, /search or /resolution/company request inside a run is answered from memory, and
//     only a complete answer is ever kept;
//   · before /text, a record the run already holds is not fetched again: it is screened from its stored raw
//     copy, and yields the row a fresh fetch would, addressed the way this request addresses it;
//   · the run's usage counts a record fetched twice, whatever tool fetched it, and the records reused.
//
// The marks and ids are invented.
//
// Run:  node scripts/test-run.mjs node --test driver/test/a-clarivate-run-asks-each-question-and-fetches-each-record-once.test.mjs
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

// The ledger captures its call-log path at load, so it is pinned before any product module is imported.
const ROOT = mkdtempSync(join(tmpdir(), "clarivate-memory-"));
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_CLARIVATE_ANSWER_MEMORY", undefined);

import { test } from "node:test";
import assert from "node:assert/strict";

const { beginAnswerMemory, answerMemoryMode, ANSWER_WATCH_LOG } = await import("../../providers/_shared/answer-memory.mjs");
const { runRecordLogPath } = await import("../../providers/_shared/ledger-path.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");
const { clarivateFetch, doBatchScreen, doRecordFetch, resolveCompany, rememberableAnswer } = await import("../../providers/clarivate/src/core.js");
const { tallyRegisterCalls } = await import("../provider-usage.mjs");

const BASE = "https://register.test";
const raw = (id, office = "US") => ({ id, registrationOfficeCode: office,
  wordMarkSpecification: { markVerbalElementText: `MARK ${id}` }, markCurrentStatus: "Registered", niceClassifications: [9] });

/** A stand-in register: answers by path, and records every request it was sent. */
function register({ refuse = null } = {}) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    sent.push({ path, body });
    if (refuse && refuse.path === path) return new Response(JSON.stringify(refuse.body), { status: refuse.status });
    if (path === "/count") return new Response(JSON.stringify({ counts: { US: 3, EM: 1 } }), { status: 200 });
    if (path === "/search") return new Response(JSON.stringify({ ids: { US: ["G1", "G2"] } }), { status: 200 });
    if (path === "/resolution/company") return new Response(JSON.stringify({ companies: [{ applicantName: "TIMBER WORKS LTD", registrationOfficeCode: "US", confidenceScore: 90, numberOfTrademarksFound: 4 }] }), { status: 200 });
    if (path === "/text") return new Response(JSON.stringify({ trademarks: body.ids.map((id) => raw(id)), nonTrademarks: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  return sent;
}

function run(mode) {
  const d = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(d), { recursive: true });
  const m = beginAnswerMemory(d, "clarivate", { env: mode ? { CLEAROTRON_CLARIVATE_ANSWER_MEMORY: mode } : {} });
  return { d, mode: m.mode, tctx: { kind: "execute_plan", sessionKey: `clearance-timber-${d.slice(-6)}-register-unit-eu`, recordLog: runRecordLogPath(d) } };
}
const COUNT_BODY = { registrationOfficeCodes: ["US"], searchFields: [{ operator: "EQUALS", name: "EXACT_WORD_MARK_SPECIFICATION", value: "TIMBER" }] };
const ledgerRows = () => readFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("the memory is on for this register unless its switch says otherwise", () => {
  assert.equal(answerMemoryMode({}, "clarivate").mode, "on");
  assert.equal(answerMemoryMode({ CLEAROTRON_CLARIVATE_ANSWER_MEMORY: "off" }, "clarivate").mode, "off");
  assert.equal(run(null).mode, "on");
});

test("an identical count or search is answered from memory; a different one is asked", async () => {
  const { tctx } = run(null);
  const sent = register();
  for (let i = 0; i < 3; i++) await clarivateFetch("key", BASE, "/count", { body: COUNT_BODY, tctx });
  for (let i = 0; i < 2; i++) await clarivateFetch("key", BASE, "/search", { body: COUNT_BODY, tctx });
  assert.deepEqual(sent.map((x) => x.path), ["/count", "/search"]);
  const second = await clarivateFetch("key", BASE, "/count", { body: COUNT_BODY, tctx });
  assert.deepEqual(second.body, { counts: { US: 3, EM: 1 } }, "the remembered answer is the register's own");
  await clarivateFetch("key", BASE, "/count", { body: { ...COUNT_BODY, registrationOfficeCodes: ["EM"] }, tctx });
  assert.equal(sent.length, 3, "a different question is a different answer");
});

test("an owner name looked up again is answered from memory", async () => {
  const { tctx } = run(null);
  const sent = register();
  const a = await resolveCompany("key", BASE, { companyName: "Timber Works", regions: ["US"] }, tctx);
  const b = await resolveCompany("key", BASE, { companyName: "Timber Works", regions: ["US"] }, tctx);
  assert.equal(sent.filter((x) => x.path === "/resolution/company").length, 1);
  assert.deepEqual(b, a);
});

test("only a complete answer is kept: a refusal, a failure or an error envelope is asked again", async () => {
  const refusals = [
    { path: "/search", status: 400, body: { errorMessage: "tooManyResults - The search returned 41234 results." } },
    { path: "/count", status: 500, body: { errorMessage: "400 on POST request" } },
    { path: "/count", status: 200, body: { errorMessage: "something went wrong" } },
    { path: "/search", status: 200, body: { errorMessage: "something went wrong" } },
  ];
  for (const refuse of refusals) {
    const { tctx } = run(null);
    const sent = register({ refuse });
    await clarivateFetch("key", BASE, refuse.path, { body: COUNT_BODY, tctx, retries: 0 });
    await clarivateFetch("key", BASE, refuse.path, { body: COUNT_BODY, tctx, retries: 0 });
    assert.equal(sent.length, 2, `${refuse.status} ${JSON.stringify(refuse.body)} was answered from memory`);
    assert.equal(rememberableAnswer(refuse.path, refuse.status, refuse.body, null), null);
  }
});

test("a record the run already holds is screened from its stored copy, and only the rest go to /text", async () => {
  const { d, tctx } = run(null);
  const sent = register();
  const first = JSON.parse((await doBatchScreen("key", BASE, { uris: ["/mark/us/G1", "/mark/us/G2"], in_scope_classes: [9] }, tctx)).text);
  const second = JSON.parse((await doBatchScreen("key", BASE, { uris: ["/mark/us/G1", "/mark/us/G2", "/mark/us/G3"], in_scope_classes: [9] }, tctx)).text);
  const texts = sent.filter((x) => x.path === "/text").map((x) => x.body.ids);
  assert.deepEqual(texts, [["G1", "G2"], ["G3"]], "the second screen fetched only the record the run did not hold");
  assert.equal(second.held, 2);
  const byUri = (rows) => Object.fromEntries(rows.map((r) => [r.uri, r]));
  const a = byUri(first.rows), b = byUri(second.rows);
  for (const uri of Object.keys(a)) assert.deepEqual(b[uri], a[uri], `${uri}: the held record's row is the row a fetch gave`);
  assert.equal(second.rows.length, 3);
  // The record log still holds each record once.
  const logged = readFileSync(runRecordLogPath(d), "utf8").trim().split("\n").map((l) => JSON.parse(l).target);
  assert.deepEqual([...logged].sort(), ["/mark/us/G1", "/mark/us/G2", "/mark/us/G3"].sort());
});

test("a held record is addressed the way the request addresses it", async () => {
  const { tctx } = run(null);
  const sent = register();
  await doRecordFetch("key", BASE, { record_ids: ["/mark/us/G1"] }, tctx);
  const again = JSON.parse((await doRecordFetch("key", BASE, { record_ids: ["/mark/em/G1"] }, tctx)).text);
  assert.equal(sent.filter((x) => x.path === "/text").length, 1, "the record was not fetched twice");
  assert.equal(again.records[0].uri, "/mark/em/G1", "the office segment is this request's, as a fresh fetch would give it");
});

// The screen gate reads the record log by exact address. A record first fetched under one office's
// address and then reused under another's was logged only under the first, so a drop citing the second
// read as a record nobody examined, and the gate's recovery re-fetch was served from memory without a
// line, so the violation survived it.
test("a held record reused under another address is logged under that address too, and only once", async () => {
  const { d, tctx } = run(null);
  const sent = register();
  await doBatchScreen("key", BASE, { uris: ["/mark/us/G1"], in_scope_classes: [9] }, tctx);
  await doBatchScreen("key", BASE, { uris: ["/mark/em/G1"], in_scope_classes: [9] }, tctx);
  await doRecordFetch("key", BASE, { record_ids: ["/mark/ch/G1"] }, tctx);
  await doBatchScreen("key", BASE, { uris: ["/mark/em/G1"], in_scope_classes: [9] }, tctx);
  assert.equal(sent.filter((x) => x.path === "/text").length, 1, "the record was fetched once");
  const { collectRecordBodies } = await import("../registry-fidelity.mjs");
  const examined = collectRecordBodies(runRecordLogPath(d), tctx.sessionKey.split("-register-unit")[0]);
  assert.deepEqual([...examined.keys()].sort(), ["/mark/ch/g1", "/mark/em/g1", "/mark/us/g1"],
    "every address the run screened or fetched it under is on record for the gate");
  const logged = readFileSync(runRecordLogPath(d), "utf8").trim().split("\n").map((l) => JSON.parse(l).target);
  assert.equal(logged.length, 3, "a held record already logged under an address writes nothing more");
});

test("the run's usage counts a record fetched twice, and the records reused", async () => {
  for (const mode of ["off", null]) {
    const { tctx } = run(mode);
    register();
    await doBatchScreen("key", BASE, { uris: ["/mark/us/G1", "/mark/us/G2"] }, tctx);
    await doRecordFetch("key", BASE, { record_ids: ["/mark/us/G1"] }, { ...tctx, kind: "record_fetch" });
    const prefix = tctx.sessionKey.split("-register-unit")[0] + "-";
    const t = tallyRegisterCalls(process.env.CLEAROTRON_REGISTER_CALL_LOG, prefix);
    if (mode === "off") {
      assert.equal(t.duplicate_fetches, 1, "with the memory off, G1 was fetched twice, by a screen and then a record fetch");
      assert.equal(t.records_reused, 0);
    } else {
      assert.equal(t.duplicate_fetches, 0, "with the memory on, nothing was fetched twice");
      assert.equal(t.records_reused, 1, "G1 came from the run's own store");
    }
  }
  assert.ok(ledgerRows().some((r) => r.cache_hit === true && Array.isArray(r.records)), "a reused record rides a cache-hit row that names it");
});

test("with the memory off every request goes to the register, as before", async () => {
  const { d, tctx } = run("off");
  const sent = register();
  for (let i = 0; i < 2; i++) await clarivateFetch("key", BASE, "/count", { body: COUNT_BODY, tctx });
  for (let i = 0; i < 2; i++) await doBatchScreen("key", BASE, { uris: ["/mark/us/G1"] }, tctx);
  assert.deepEqual(sent.map((x) => x.path), ["/count", "/count", "/text", "/text"]);
  let watch = null;
  try { watch = readFileSync(driverDir(d, ANSWER_WATCH_LOG), "utf8"); } catch { /* none written */ }
  assert.equal(watch, null, "nothing is recorded when the memory is off");
});
