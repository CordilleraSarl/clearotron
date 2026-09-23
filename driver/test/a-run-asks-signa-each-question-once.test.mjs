// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-run-asks-signa-each-question-once.test.mjs — the run memory, and the knockout's one request per term.
//
// THE DEFECT. Signa bills every search page, and a run paid again and again for questions it had already
// asked: a repair re-sent a whole axis, a re-attempt re-asked questions that had answered, and a knockout
// counted each term and then listed the same term. In testing (2026-09-23) the largest current-design run repeated about half its searches.
//
// THE CHANGE, and what each arm below holds it to:
//   · a memory at the one HTTP chokepoint, in the run's `_driver/` folder, so the driver and the tool
//     servers share it; one attempt long; `off` by default, `watch` asks every time and records whether
//     the held answer matched (total, id set and id order apart), `on` answers from it;
//   · only complete answers are kept, and never a failure;
//   · a knockout lists first and takes the identical and close counts from the listing's totals, because
//     this register declares that its listing carries them; the memory switch does not decide that.
//
// The marks are neutral dictionary words on purpose.
//
// Run:  node scripts/test-run.mjs node --test driver/test/a-run-asks-signa-each-question-once.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

// driver.config reads the register and the pool root once, at load, and the ledger captures its call
// log path at load, so all of it is pinned before any product module is imported.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "answer-memory-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
// The knockout arms run the real lane, whose frame turn is a model dispatch: the repo's mock CLI, at $0.
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  ANSWER_MEMORY_DIR, ANSWER_WATCH_LOG, NEXT_PAGE_FRESH_MS, ATTEMPT_MAX_AGE_MS, answerMemoryMode, beginAnswerMemory,
  endAnswerMemory, openAnswerMemory, answerKey, rememberAnswer, recallAnswer, compareAnswers,
} = await import("../../providers/_shared/answer-memory.mjs");
const { runRecordLogPath } = await import("../../providers/_shared/ledger-path.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");
const { signaFetch, rememberableAnswer } = await import("../../providers/signa/src/core.js");
const { capabilitiesFor } = await import("../register-capabilities.mjs");
const { countRegisterHits, listingAnswers } = await import("../register-count.mjs");
const { PROVIDERS } = await import("../driver.config.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");

const SIGNA = capabilitiesFor("signa");
const BASE = "https://register.test";

/** A run folder as a run has it: `_driver/` exists, and the record log path locates the run. */
function runDir(mode = null) {
  const d = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(d), { recursive: true });
  if (mode) beginAnswerMemory(d, "signa", { env: { CLEAROTRON_SIGNA_ANSWER_MEMORY: mode } });
  return d;
}
const tctxFor = (d) => ({ kind: "search", recordLog: runRecordLogPath(d) });
const watchRows = (d) => {
  const p = driverDir(d, ANSWER_WATCH_LOG);
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const page = (ids, { total = ids.length, more = false } = {}) =>
  ({ data: ids.map((id) => ({ id })), has_more: more, pagination: { total_count: total, ...(more ? { cursor: "c1" } : {}) } });

/** A stand-in register: answers from `answers` in turn (the last one repeats), and counts what it was sent. */
function register(answers) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const a = answers[Math.min(sent.length - 1, answers.length - 1)];
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
  };
  return sent;
}
const SEARCH = { query: "TIMBER", strategies: ["exact"], filters: { nice_classes: [9] }, limit: 100, options: { include_total: true } };
const ask = (d, body = SEARCH) => signaFetch("key", BASE, "/v1/trademarks", { method: "POST", body, tctx: tctxFor(d) });

// ── the switch and the attempt ──────────────────────────────────────────────────────────────────────

test("the switch: unset is off, the three words are themselves, anything else is off and named", () => {
  assert.deepEqual(answerMemoryMode({}), { mode: "off", unknown: null });
  for (const m of ["off", "watch", "on"]) assert.equal(answerMemoryMode({ CLEAROTRON_SIGNA_ANSWER_MEMORY: m.toUpperCase() }).mode, m);
  assert.deepEqual(answerMemoryMode({ CLEAROTRON_SIGNA_ANSWER_MEMORY: "yes" }), { mode: "off", unknown: "yes" });
  assert.equal(answerMemoryMode({ CLEAROTRON_SIGNA_ANSWER_MEMORY: "on" }, "corsearch").mode, "off", "another register has no memory");
});

test("an attempt begins a folder for watch or on, only for this register, and drops what an earlier one held", () => {
  const d = runDir();
  const folder = driverDir(d, ANSWER_MEMORY_DIR);
  assert.deepEqual(beginAnswerMemory(d, "corsearch", { env: { CLEAROTRON_SIGNA_ANSWER_MEMORY: "on" } }), { mode: "off", unknown: null, applies: false, switch: null });
  assert.equal(existsSync(folder), false, "another register's run folder is exactly as before");
  assert.equal(beginAnswerMemory(d, "signa", { env: { CLEAROTRON_SIGNA_ANSWER_MEMORY: "watch" } }).mode, "watch");
  writeFileSync(join(folder, "left-by-the-last-attempt.json.gz"), "x");
  assert.equal(beginAnswerMemory(d, "signa", { env: {} }).mode, "off");
  assert.equal(existsSync(folder), false, "a new attempt never inherits an earlier attempt's answers");
});

test("a process finds the memory from the run's record log, from its environment, and from nothing else", () => {
  const d = runDir("on");
  assert.equal(openAnswerMemory(runRecordLogPath(d))?.mode, "on", "the driver passes the path per call");
  assert.equal(openAnswerMemory(null, { env: { CLEAROTRON_REGISTER_RECORD_LOG: runRecordLogPath(d) } })?.mode, "on",
    "a spawned tool server has it in its environment");
  assert.equal(openAnswerMemory(join(driverDir(d), "register-records.jsonl")), null, "the machine-wide ledger's name locates no run");
  assert.equal(openAnswerMemory(null, { env: {} }), null);
  assert.equal(openAnswerMemory(runRecordLogPath(d), { now: () => Date.now() + ATTEMPT_MAX_AGE_MS + 1 }), null,
    "an attempt that died without cleaning up is ignored a day later");
  endAnswerMemory(d);
  assert.equal(openAnswerMemory(runRecordLogPath(d)), null, "an ended attempt has no memory");
});

test("an answer pointing at a next page goes stale after the window; one that does not, does not", () => {
  const d = runDir("on");
  const mem = openAnswerMemory(runRecordLogPath(d));
  const t0 = Date.now();
  rememberAnswer(mem, "k1", { status: 200, raw: "{}", summary: { total: 5, ids: [], next_page: true } }, { now: () => t0 });
  rememberAnswer(mem, "k2", { status: 200, raw: "{}", summary: { total: 5, ids: [], next_page: false } }, { now: () => t0 });
  assert.equal(recallAnswer(mem, "k1", { now: () => t0 + NEXT_PAGE_FRESH_MS - 1 }).stale, false);
  assert.equal(recallAnswer(mem, "k1", { now: () => t0 + NEXT_PAGE_FRESH_MS + 1 }).stale, true);
  assert.equal(recallAnswer(mem, "k2", { now: () => t0 + NEXT_PAGE_FRESH_MS * 50 }).stale, false);
});

test("a comparison keeps total, id set and id order apart", () => {
  const held = { total: 3, ids: ["a", "b", "c"] };
  assert.deepEqual(compareAnswers(held, { total: 3, ids: ["a", "b", "c"] }), { same_total: true, same_ids: true, same_order: true });
  assert.deepEqual(compareAnswers(held, { total: 3, ids: ["b", "a", "c"] }), { same_total: true, same_ids: true, same_order: false },
    "a tie broken the other way is the same answer in a different order");
  assert.deepEqual(compareAnswers(held, { total: 4, ids: ["a", "b", "d"] }), { same_total: false, same_ids: false, same_order: false });
});

// ── the chokepoint ──────────────────────────────────────────────────────────────────────────────────

test("off: every request goes to the register and nothing is written", async () => {
  const d = runDir();
  const sent = register([{ body: page(["a", "b"]) }]);
  for (let i = 0; i < 3; i++) await ask(d);
  assert.equal(sent.length, 3);
  assert.equal(existsSync(driverDir(d, ANSWER_MEMORY_DIR)), false);
  assert.deepEqual(watchRows(d), []);
});

test("watch: every request goes to the register, and each says whether the held answer matched", async () => {
  const d = runDir("watch");
  const sent = register([{ body: page(["a", "b"]) }, { body: page(["a", "b"]) }, { body: page(["b", "a"]) }, { body: page(["a", "c"], { total: 3 }) }]);
  for (let i = 0; i < 4; i++) await ask(d);
  assert.equal(sent.length, 4, "watch never answers from the memory");
  const rows = watchRows(d);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].held, false);
  assert.equal(rows[0].stored, true);
  assert.deepEqual([rows[1].same_total, rows[1].same_ids, rows[1].same_order], [true, true, true]);
  assert.deepEqual([rows[2].same_total, rows[2].same_ids, rows[2].same_order], [true, true, false], "a reorder alone");
  assert.deepEqual([rows[3].same_total, rows[3].same_ids], [false, false], "a different answer is a mismatch");
  assert.ok(rows.every((r) => r.mode === "watch" && r.key === rows[0].key), "one question, one key");
  assert.ok(rows.every((r) => r.via === "driver"), "the driver's calls carry the run's record log");
});

test("on: a held answer is returned and the register is not asked; the ledger marks it a cache hit", async () => {
  const d = runDir("on");
  const sent = register([{ body: page(["a", "b"]) }]);
  const first = await ask(d);
  const second = await ask(d);
  assert.equal(sent.length, 1);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.status, 200);
  assert.equal(watchRows(d)[1].served, true);
  const ledger = readFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(ledger.some((r) => r.cache_hit === true && r.attempts === 0), "the served request is on the ledger, unpaid");
  // A different question is a different answer.
  await ask(d, { ...SEARCH, query: "LIMBER" });
  assert.equal(sent.length, 2);
});

test("on: a failure is never remembered — each is asked again", async () => {
  const failures = [
    { status: 500, body: { error: { type: "server_error" } } },
    { status: 429, body: { error: { type: "rate_limited" } } },
    { status: 401, body: { error: { type: "unauthorized" } } },
    { status: 400, body: { error: { type: "cursor_window_exceeded" } } },
    { status: 200, body: "{\"data\": [" },
    { status: 200, body: { error: { type: "server_error" } } },
    { status: 200, body: { data: [] } },
  ];
  for (const f of failures) {
    const d = runDir("on");
    const sent = register([f]);
    await ask(d);
    const once = sent.length;   // a server error is retried once inside the fetch, so one ask can be two requests
    await ask(d);
    assert.equal(sent.length, 2 * once, `${f.status} ${JSON.stringify(f.body).slice(0, 60)} was served from the memory`);
    assert.equal(rememberableAnswer("POST", f.status, typeof f.body === "string" ? null : f.body, typeof f.body === "string" ? "unparsed" : null), null);
  }
});

test("on: a validation error is remembered — the register says the question itself is malformed", async () => {
  const d = runDir("on");
  const sent = register([{ status: 400, body: { error: { type: "validation_error", detail: "too short" } } }]);
  const a = await ask(d, { ...SEARCH, query: "x" });
  const b = await ask(d, { ...SEARCH, query: "x" });
  assert.equal(sent.length, 1);
  assert.equal(b.status, 400);
  assert.equal(b.ok, false);
  assert.deepEqual(b.body, a.body);
});

test("on: a record is remembered, and a spawned server finds the memory through its environment", async () => {
  const d = runDir("on");
  const sent = register([{ body: { data: { id: "tm_1", mark_text: "TIMBER" } } }]);
  const prior = process.env.CLEAROTRON_REGISTER_RECORD_LOG;
  process.env.CLEAROTRON_REGISTER_RECORD_LOG = runRecordLogPath(d);
  try {
    for (let i = 0; i < 2; i++) await signaFetch("key", BASE, "/v1/trademarks/tm_1", { tctx: { kind: "record_fetch" } });
  } finally {
    if (prior === undefined) delete process.env.CLEAROTRON_REGISTER_RECORD_LOG; else process.env.CLEAROTRON_REGISTER_RECORD_LOG = prior;
  }
  assert.equal(sent.length, 1);
  assert.ok(watchRows(d).every((r) => r.via === "tool-server"), "a spawned server's rows say so, which is how the watch log shows it found the run");
});

test("a held answer whose next-page cursor is too old is asked again, and the watch says it was held", async () => {
  const d = runDir("on");
  const sent = register([{ body: page(["a"], { total: 150, more: true }) }]);
  await ask(d);
  // Age the held answer past the window, as a long gap in a run would.
  const mem = openAnswerMemory(runRecordLogPath(d));
  const file = join(mem.dir, `${answerKey({ base: BASE, method: "POST", path: "/v1/trademarks", body: SEARCH })}.json.gz`);
  const held = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  writeFileSync(file, gzipSync(JSON.stringify({ ...held, stored_ms: held.stored_ms - NEXT_PAGE_FRESH_MS - 1000 })));
  await ask(d);
  assert.equal(sent.length, 2);
  const last = watchRows(d).at(-1);
  assert.equal(last.held_stale, true);
  assert.equal(last.same_ids, true);
});

// ── the knockout ────────────────────────────────────────────────────────────────────────────────────

// The territories as both lanes hold them after translation into this register's office keys.
const { resolveRegions } = await import("../register-plan.mjs");
const EU = resolveRegions(["EU"], SIGNA).regions;
const LISTED = {
  scope: { regions: EU },
  marks: [{ name: "TIMBER", classes: [9], terms: [
    { term: "TIMBER", basis: "identical", ok: true, fetched: 5, total: 12 },
    { term: "TIMBERR", basis: "close", ok: true, fetched: 0, total: 0 },
    { term: "TIMBRE", basis: "close", ok: true, fetched: 5, total: null, approximate: true, floor: 10000 },
    { term: "TMBER", basis: "close", ok: false, fetched: 0, total: null, reason: "failed" },
    { term: "TIMBEER", basis: "close", ok: false, fetched: 0, total: null, notAsked: true },
  ] }],
};

test("the count lane takes the identical and close figures the listing answered, and asks the rest", async () => {
  const asked = [];
  const counter = async (term, p) => { asked.push(`${p.key}:${term}`); return { ok: true, total: 7 }; };
  const doc = await countRegisterHits({ marks: [{ name: "TIMBER", classes: [9] }], jurisdictions: ["EU"], provider: "signa",
    capabilities: SIGNA, counter, variantCap: 12, listed: LISTED });
  const m = doc.marks[0];
  assert.equal(m.counts.identical.total, 12);
  assert.equal(m.counts.identical.source, "listing");
  assert.ok(asked.includes("containing:TIMBER"), "the listing never asks `containing`, so the count lane does");
  assert.ok(!asked.includes("identical:TIMBER"));
  const forms = Object.fromEntries(m.counts.close.forms.map((f) => [f.form, f]));
  if (forms.TIMBERR) { assert.equal(forms.TIMBERR.source, "listing"); assert.equal(forms.TIMBERR.total, 0); }
  if (forms.TIMBRE) { assert.equal(forms.TIMBRE.approximate, true); assert.equal(forms.TIMBRE.floor, 10000); }
  for (const f of ["TMBER", "TIMBEER"]) if (forms[f]) assert.ok(asked.includes(`close:${f}`), `${f} was not answered by the listing, so it is counted`);
  assert.ok(asked.some((a) => a.startsWith("close:")), "the fixture reaches forms the listing did not answer");
});

test("a listing over a different scope answers nothing", async () => {
  assert.ok(listingAnswers(LISTED, { regions: EU }), "the same territories answer");
  assert.equal(listingAnswers({ ...LISTED, scope: { regions: resolveRegions(["US"], SIGNA).regions } }, { regions: EU }), null);
  const asked = [];
  const counter = async (term, p) => { asked.push(`${p.key}:${term}`); return { ok: true, total: 1 }; };
  await countRegisterHits({ marks: [{ name: "TIMBER", classes: [25] }], jurisdictions: ["EU"], provider: "signa",
    capabilities: SIGNA, counter, listed: LISTED });
  assert.ok(asked.includes("identical:TIMBER"), "class 25 was not the question the listing asked");
});

test("the Signa listing carries the register's total and its approximation", async () => {
  const prior = process.env.SIGNA_API_KEY;
  process.env.SIGNA_API_KEY = "key";
  try {
    register([{ body: page(["tm_1", "tm_2"], { total: 559 }) }]);
    const r = await PROVIDERS.signa.listRecords({ name: "TIMBER", classes: [9], regions: ["EU"], limit: 5 }, { recordLog: null });
    assert.equal(r.ok, true);
    assert.equal(r.total, 559);
    register([{ body: { data: [{ id: "tm_1" }], has_more: true, pagination: { total_count: 10000, total_count_approximate: true, cursor: "c" } } }]);
    const s = await PROVIDERS.signa.listRecords({ name: "TIMBER", classes: [9], regions: ["EU"], limit: 5 }, { recordLog: null });
    assert.equal(s.total, null, "an approximation is never a count");
    assert.equal(s.approximate, true);
    assert.equal(s.floor, 10000);
  } finally {
    if (prior === undefined) delete process.env.SIGNA_API_KEY; else process.env.SIGNA_API_KEY = prior;
  }
});

// ── the knockout, run end to end ────────────────────────────────────────────────────────────────────

async function knockout(mode, codename) {
  const prior = process.env.CLEAROTRON_SIGNA_ANSWER_MEMORY;
  process.env.CLEAROTRON_SIGNA_ANSWER_MEMORY = mode;
  const researchKey = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    const id = `ko-${codename}`;
    const studioRoot = join(ROOT, "studio", id);
    const dir = join(studioRoot, "clearance-search", "runs", "timber", `2026-09-23-${codename}`);
    mkdirSync(driverDir(dir), { recursive: true });
    const run = { runDir: dir, studioRoot, slug: "timber", date: "2026-09-23", codename, archiveDir: join(studioRoot, "archive", `2026-09-23-${codename}`) };
    const job = { id, markName: "TIMBER", marks: [{ name: "TIMBER" }], classes: [9], jurisdictions: ["EU"],
      forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
    const ctx = { run, job, agent: "clawdi", paths: { runDir: dir }, profile: {},
      searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
    const order = [];
    const res = await knockoutInner(ctx, job, {
      countExecutor: async (term, p) => { order.push(`count:${p.key}:${term}`); return { ok: true, total: 3 }; },
      recordLister: async (term) => { order.push(`list:${term}`); return { ok: true, total: 3, records: [] }; },
    });
    return { res, order, ctx };
  } finally {
    if (prior === undefined) delete process.env.CLEAROTRON_SIGNA_ANSWER_MEMORY; else process.env.CLEAROTRON_SIGNA_ANSWER_MEMORY = prior;
    if (researchKey !== undefined) process.env.PERPLEXITY_API_KEY = researchKey;
  }
}
const events = (d) => readFileSync(driverDir(d, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a knockout lists first and counts only what the listing never asks", async () => {
  const { res, order } = await knockout("on", "birch-beacon");
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  const firstCount = order.findIndex((o) => o.startsWith("count:"));
  const lastList = order.map((o) => o.startsWith("list:")).lastIndexOf(true);
  assert.ok(firstCount > lastList, `the listing ran first: ${order.join(" → ")}`);
  assert.deepEqual(order.filter((o) => o.startsWith("count:")), ["count:containing:TIMBER"],
    "identical and close came from the listing's totals");
  assert.ok(events(res.runDir).some((e) => e.event === "answer-memory" && e.mode === "on"));
  assert.equal(existsSync(driverDir(res.runDir, ANSWER_MEMORY_DIR)), false, "the held answers did not travel into the archive");
});

test("with the memory switch off the knockout still lists first, and the run holds no memory", async () => {
  const { res, order } = await knockout("off", "teal-quill");
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  assert.deepEqual(order.filter((o) => o.startsWith("count:")), ["count:containing:TIMBER"],
    "the register's declaration decides the order, not the memory switch");
  const ev = events(res.runDir);
  assert.ok(ev.some((e) => e.event === "answer-memory" && e.mode === "off"));
  assert.deepEqual(readdirSync(driverDir(res.runDir)).filter((f) => f.startsWith("register-answer")), []);
});
