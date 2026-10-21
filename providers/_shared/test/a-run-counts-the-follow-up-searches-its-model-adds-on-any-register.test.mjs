// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN COUNTS THE FOLLOW-UP SEARCHES ITS MODEL ADDS, THE SAME WAY ON ANY REGISTER.
//
// A safety net in code, never how the engine decides it has searched enough: one count per run, every worker and
// pass together, of the follow-up searches the run sends. A search counts once whatever the register makes of it,
// and nothing about what a register charges enters the count. The plan's own questions, released families
// included, and the identical mark's own required read are never counted and never refused. These arms pin the
// count's file, its sharing across processes and how each entry stands against it. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  FOLLOW_UP_SEARCH_LIMIT, SEARCHES_FILE, runDriverDirOf, followUpSearchesSent, followUpRoom, recordFollowUpSearch,
  recordOutstanding, readOutstanding, identicalMarkTerms, followUpClass,
} from "../follow-up-searches.mjs";
import { makeLedger } from "../ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const runDriver = (t) => {
  const run = mkdtempSync(join(tmpdir(), "follow-ups-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const d = join(run, "_driver");
  mkdirSync(d, { recursive: true });
  return d;
};

test("the net is a number of follow-up searches, found from the run's record log, and there is none outside a run", () => {
  assert.ok(Number.isInteger(FOLLOW_UP_SEARCH_LIMIT) && FOLLOW_UP_SEARCH_LIMIT > 0);
  assert.equal(runDriverDirOf("/r/x/_driver/register-record-bodies.jsonl", {}), "/r/x/_driver");
  assert.equal(runDriverDirOf(null, { CLEAROTRON_REGISTER_RECORD_LOG: "/r/y/_driver/register-record-bodies.jsonl" }), "/r/y/_driver");
  assert.equal(runDriverDirOf("/srv/registers/telemetry/register-records.jsonl", {}), null, "the box-wide log is no run");
  assert.equal(runDriverDirOf(null, {}), null);
});

test("each follow-up search sent adds one, the limit closes the net, and an unreadable count reads as full", (t) => {
  const d = runDriver(t);
  assert.deepEqual(followUpSearchesSent(d), { sent: 0, unreadable: false });
  for (let i = 0; i < 3; i++) recordFollowUpSearch(d, { qid: `q${i}` });
  assert.equal(followUpSearchesSent(d).sent, 3);
  assert.equal(followUpRoom(d, 4).open, true);
  recordFollowUpSearch(d, { qid: "q3" });
  assert.deepEqual([followUpRoom(d, 4).open, followUpRoom(d, 4).sent], [false, 4]);
  const u = runDriver(t);
  writeFileSync(join(u, SEARCHES_FILE), "{}\n");
  chmodSync(join(u, SEARCHES_FILE), 0o000);
  if (process.getuid?.() !== 0) assert.deepEqual([followUpRoom(u).open, followUpRoom(u).unreadable], [false, true]);
});

test("the shared call ledger adds nothing to the count: what a register charges, or answers from memory, is not the measure", (t) => {
  const d = runDriver(t);
  const recordLog = join(d, "register-record-bodies.jsonl");
  const { logCall } = makeLedger("stand-in");
  logCall({ kind: "propose_supplemental", recordLog, qid: "a" }, { http_status: 200, ok: true, cache_hit: false });
  logCall({ kind: "propose_supplemental", recordLog, qid: "b" }, { http_status: 200, ok: true, cache_hit: true });
  assert.equal(existsSync(join(d, SEARCHES_FILE)), false);
});

test("several processes counting at once share one count and lose no search", async (t) => {
  const d = runDriver(t);
  const mod = join(HERE, "..", "follow-up-searches.mjs");
  const child = (n) => new Promise((res, rej) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e",
      `import { recordFollowUpSearch } from ${JSON.stringify(mod)}; for (let i = 0; i < ${n}; i++) recordFollowUpSearch(${JSON.stringify(d)}, { qid: "w" + process.pid + ":" + i });`]);
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`worker exited ${c}`))));
  });
  await Promise.all([child(120), child(120), child(120)]);
  assert.equal(followUpSearchesSent(d).sent, 360, "three workers' searches all landed in the one file");
});

test("outstanding questions are kept, the latest row for each, with a code and no sentence", (t) => {
  const d = runDriver(t);
  recordOutstanding(d, { qid: "q1", axis: "primary-sweep" });
  recordOutstanding(d, { qid: "q2", axis: "incumbent-class" });
  recordOutstanding(d, { qid: "q1", axis: "primary-sweep", sent: 452 });
  const rows = readOutstanding(d);
  assert.deepEqual(rows.map((r) => r.qid).sort(), ["q1", "q2"]);
  assert.equal(rows.find((r) => r.qid === "q1").sent, 452);
  assert.ok(rows.every((r) => r.reason === "follow-up-not-sent"));
});

test("only follow-ups count; the plan and the identical mark's required read never do", () => {
  const plan = { entries: [
    { qid: "primary-sweep:exact:qzorvak", predicate: "exact", term: "QZORVAK", provenance: "mark" },
    { qid: "primary-sweep:exact:qzorvak-games", predicate: "exact", term: "QZORVAK GAMES", provenance: "model", when: { awaits_reading_turn: true } },
  ] };
  const identicalTerms = identicalMarkTerms(plan);
  assert.deepEqual([...identicalTerms], ["qzorvak"]);
  const c = (e) => followUpClass(e, { identicalTerms });
  // the plan's own questions, a released family included
  assert.equal(c({ qid: "p1", predicate: "default", term: "QZOR" }), "plan");
  assert.equal(c(plan.entries[1]), "plan");
  // the identical mark's own read: its plan row, and the follow-ups that narrow it keeping the goods cut
  assert.equal(c(plan.entries[0]), "required");
  assert.equal(c({ origin: "supplemental", predicate: "exact", term: "Qzorvak", goods_text: ["video games"], nice_classes: ["9"] }), "required");
  assert.equal(c({ origin: "supplemental", predicate: "exact", term: "QZORVAK", goods_text: ["video games"], regions: ["JP"] }), "required");
  // a wider read of the identical mark, without the goods cut, counts, and so does every other follow-up
  assert.equal(c({ origin: "supplemental", predicate: "exact", term: "QZORVAK" }), "counted");
  assert.equal(c({ origin: "supplemental", predicate: "default", term: "QZORVAK", goods_text: ["video games"] }), "counted");
});
