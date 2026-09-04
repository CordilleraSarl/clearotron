// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-activity.test.mjs — the non-report runtime activity ledger (quality-checks etc.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordActivity, readActivity } from "../run-activity.mjs";

test("a check's waiting→running→done collapse to ONE row (latest state); separate ids stay distinct", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "run-activity.jsonl");
  recordActivity(p, { id: "novapulse@t1", kind: "quality-check", label: "NOVA PULSE", state: "waiting" });
  recordActivity(p, { id: "novapulse@t1", kind: "quality-check", label: "NOVA PULSE", state: "running" });
  recordActivity(p, { id: "novapulse@t1", kind: "quality-check", label: "NOVA PULSE", state: "done", costUsd: 7.05 });
  recordActivity(p, { id: "aura@t2", kind: "quality-check", label: "AURA", state: "running" });
  const rows = readActivity(p);
  assert.equal(rows.length, 2);                                  // two invocations
  const novapulse = rows.find((r) => r.id === "novapulse@t1");
  assert.equal(novapulse.state, "done");                         // latest state wins
  assert.equal(novapulse.costUsd, 7.05);
});

test("missing / garbled ledger → [] (never throws)", () => {
  assert.deepEqual(readActivity("/no/such/ledger.jsonl"), []);
});

test("limit caps to the newest by ts", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "a.jsonl");
  for (let i = 0; i < 5; i++) recordActivity(p, { id: `c${i}`, ts: `2026-06-2${i}T00:00:00Z`, state: "done" });
  const rows = readActivity(p, { limit: 2 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "c4");                                // newest first
});

// STALE-REAP — a check whose worker died before writing a terminal record (reboot/SIGKILL/OOM/throw) must
// never stay pinned at a live "running"/"waiting"; the reader reaps it once its ts is older than the window.
test("a stale non-terminal record (older than the threshold) is reaped to failed + stale", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "a.jsonl");
  recordActivity(p, { id: "satin@2026-07-05T02:22:50.225Z", ts: "2026-07-05T02:22:50.225Z", kind: "quality-check", label: "Satin & Steel", state: "running" });
  const now = Date.parse("2026-07-05T23:00:00Z");                // ~20h later — well past the 2h window
  const [row] = readActivity(p, { now });
  assert.equal(row.state, "failed");                             // no terminal record ever landed
  assert.equal(row.stale, true);
  assert.match(row.note, /interrupted/);
});

test("a fresh 'running' check (within the threshold) is NOT reaped", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "a.jsonl");
  recordActivity(p, { id: "live@x", ts: "2026-07-05T22:50:00Z", state: "running" });
  const [row] = readActivity(p, { now: Date.parse("2026-07-05T23:00:00Z") });  // only 10 min old
  assert.equal(row.state, "running");
  assert.ok(!row.stale);
});

test("a completed check is never reaped, even if old (terminal wins the collapse)", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "a.jsonl");
  recordActivity(p, { id: "done@old", ts: "2026-07-01T00:00:00Z", state: "running" });
  recordActivity(p, { id: "done@old", ts: "2026-07-01T00:15:00Z", state: "done", costUsd: 6.9 });
  const [row] = readActivity(p, { now: Date.parse("2026-07-05T00:00:00Z") });  // days later
  assert.equal(row.state, "done");
  assert.ok(!row.stale);
});

test("a stale 'waiting' (never got a slot, then died) is reaped too", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "a.jsonl");
  recordActivity(p, { id: "wait@old", ts: "2026-07-05T02:00:00Z", state: "waiting" });
  const [row] = readActivity(p, { now: Date.parse("2026-07-05T23:00:00Z") });
  assert.equal(row.state, "failed");
  assert.equal(row.stale, true);
});

test("staleAfterMs is configurable (same record: reaped under a tight window, live under a wide one)", () => {
  const p = join(mkdtempSync(join(tmpdir(), "act-")), "a.jsonl");
  recordActivity(p, { id: "cfg@x", ts: "2026-07-05T12:00:00Z", state: "running" });
  const now = Date.parse("2026-07-05T12:10:00Z");                // 10 min later
  assert.equal(readActivity(p, { now, staleAfterMs: 5 * 60 * 1000 })[0].state, "failed");   // > 5 min → reaped
  assert.equal(readActivity(p, { now, staleAfterMs: 60 * 60 * 1000 })[0].state, "running"); // < 60 min → live
});

// Presentation retire (2026-07-06): retire-by-APPEND — the ledger stays append-only; a later record
// with the same id carrying retired:true hides the row; another append without it resurfaces it.
test("readActivity: a retired-by-append row is hidden; a later un-retire append resurfaces it", () => {
  const p2 = join(mkdtempSync(join(tmpdir(), "act-retire-")), "ledger.jsonl");
  recordActivity(p2, { id: "chk-1", state: "failed", ts: "2026-07-05T02:22:00Z", label: "Satin & Steel" });
  recordActivity(p2, { id: "chk-2", state: "done", ts: "2026-07-05T03:00:00Z", label: "Other" });
  recordActivity(p2, { id: "chk-1", state: "failed", ts: "2026-07-05T02:22:00Z", label: "Satin & Steel", retired: true });
  const rows = readActivity(p2, { now: "2026-07-05T04:00:00Z" });
  assert.deepEqual(rows.map((r) => r.id), ["chk-2"], "the retired row is hidden from every activity surface");
  recordActivity(p2, { id: "chk-1", state: "failed", ts: "2026-07-05T02:22:00Z", label: "Satin & Steel" });
  assert.equal(readActivity(p2, { now: "2026-07-05T04:00:00Z" }).length, 2, "an un-retire append resurfaces it");
});
