// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RUN HAS ONE ALLOWANCE OF PAID REGISTER CALLS FOR THE SEARCHES THE MODEL ADDS.
//
// Ruled 2026-10-21: 250 paid follow-up register calls per run, every worker and pass together. The plan's own
// questions, released families included, and the identical mark's own required read are never counted and never
// refused. These arms pin the allowance's file, its sharing across processes and how each entry stands against
// it. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  RUN_CALL_LIMIT, runDriverDirOf, spentCalls, allowanceOpen, recordCountedCall, recordOutstanding, readOutstanding,
  identicalMarkTerms, allowanceClass,
} from "../call-allowance.mjs";
import { makeLedger } from "../ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const runDriver = (t) => {
  const run = mkdtempSync(join(tmpdir(), "allowance-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const d = join(run, "_driver");
  mkdirSync(d, { recursive: true });
  return d;
};

test("the allowance is 250 paid follow-up calls, found from the run's record log, and none outside a run", () => {
  assert.equal(RUN_CALL_LIMIT, 250);
  assert.equal(runDriverDirOf("/r/x/_driver/register-record-bodies.jsonl", {}), "/r/x/_driver");
  assert.equal(runDriverDirOf(null, { CLEAROTRON_REGISTER_RECORD_LOG: "/r/y/_driver/register-record-bodies.jsonl" }), "/r/y/_driver");
  assert.equal(runDriverDirOf("/srv/registers/telemetry/register-records.jsonl", {}), null, "the box-wide log is no run");
  assert.equal(runDriverDirOf(null, {}), null);
});

test("each counted call adds one, the limit closes it, and an unreadable file counts as spent", (t) => {
  const d = runDriver(t);
  assert.deepEqual(spentCalls(d), { spent: 0, unreadable: false });
  for (let i = 0; i < 3; i++) recordCountedCall(d, { provider: "clarivate", qid: `q${i}` });
  assert.equal(spentCalls(d).spent, 3);
  assert.equal(allowanceOpen(d, 4).open, true);
  recordCountedCall(d, { provider: "clarivate", qid: "q3" });
  assert.deepEqual([allowanceOpen(d, 4).open, allowanceOpen(d, 4).spent], [false, 4]);
  const u = runDriver(t);
  writeFileSync(join(u, "register-call-allowance.jsonl"), "{}\n");
  chmodSync(join(u, "register-call-allowance.jsonl"), 0o000);
  if (process.getuid?.() !== 0) assert.deepEqual([allowanceOpen(u).open, allowanceOpen(u).unreadable], [false, true]);
});

test("the shared call ledger counts a paid call marked counted, and nothing else", (t) => {
  const d = runDriver(t);
  const recordLog = join(d, "register-record-bodies.jsonl");
  const { logCall } = makeLedger("clarivate");
  logCall({ kind: "propose_supplemental", recordLog, countedCall: true, qid: "a" }, { http_status: 200, ok: true, cache_hit: false });
  logCall({ kind: "propose_supplemental", recordLog, countedCall: true, qid: "b" }, { http_status: 200, ok: true, cache_hit: true });
  logCall({ kind: "propose_supplemental", recordLog, countedCall: true, qid: "c" }, { http_status: 0, ok: false, cache_hit: false });
  logCall({ kind: "execute_plan", recordLog, qid: "d" }, { http_status: 200, ok: true, cache_hit: false });
  assert.equal(spentCalls(d).spent, 1, "only the paid, answered, counted call is counted");
});

test("several processes counting at once share one allowance and lose no call", async (t) => {
  const d = runDriver(t);
  const mod = join(HERE, "..", "call-allowance.mjs");
  const child = (n) => new Promise((res, rej) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e",
      `import { recordCountedCall } from ${JSON.stringify(mod)}; for (let i = 0; i < ${n}; i++) recordCountedCall(${JSON.stringify(d)}, { qid: "w" + process.pid + ":" + i });`]);
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`worker exited ${c}`))));
  });
  await Promise.all([child(120), child(120), child(120)]);
  assert.equal(spentCalls(d).spent, 360, "three workers' calls all landed in the one file");
});

test("outstanding questions are kept, the latest row for each", (t) => {
  const d = runDriver(t);
  recordOutstanding(d, { qid: "q1", axis: "primary-sweep" });
  recordOutstanding(d, { qid: "q2", axis: "incumbent-class" });
  recordOutstanding(d, { qid: "q1", axis: "primary-sweep", spent: 452 });
  const rows = readOutstanding(d);
  assert.deepEqual(rows.map((r) => r.qid).sort(), ["q1", "q2"]);
  assert.equal(rows.find((r) => r.qid === "q1").spent, 452);
  assert.ok(rows.every((r) => r.reason === "run-call-limit"));
});

test("only follow-ups count; the plan and the identical mark's required read never do", () => {
  const plan = { entries: [
    { qid: "primary-sweep:exact:qzorvak", predicate: "exact", term: "QZORVAK", provenance: "mark" },
    { qid: "primary-sweep:exact:qzorvak-games", predicate: "exact", term: "QZORVAK GAMES", provenance: "model", when: { awaits: "reading-turn" } },
  ] };
  const identicalTerms = identicalMarkTerms(plan);
  assert.deepEqual([...identicalTerms], ["qzorvak"]);
  const c = (e) => allowanceClass(e, { identicalTerms });
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
