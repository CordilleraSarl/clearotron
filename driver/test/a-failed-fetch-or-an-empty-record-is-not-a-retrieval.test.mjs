// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FAILED FETCH, OR A BODY THAT CARRIES NO RECORD, IS NOT A RETRIEVAL.
//
// The screen gate asks whether the run holds, or has fetched, the official record a goods drop rests on. It read
// every record-fetch target in the call ledger as fetched, whether the register answered or refused, and every
// object body as a record, whatever it held. A failed attempt then answered the gate, so the drop was never sent
// to the gate's own recovery fetch and never disclosed (ruled 2026-10-18). Now only a fetch that succeeded counts,
// and only a body that carries the record's own content is the record; a valid copy the run holds is never
// replaced by a later placeholder, and neither is its receipt. Every record id here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fetchedRecordUris } from "../provider-usage.mjs";
import { recordBodyHasContent, assembleRunRecords, collectRecordReceipts } from "../registry-fidelity.mjs";

const PREFIX = "clearance-acme-bluejay-";
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("only a record fetch that succeeded is a fetched record; one success among a target's attempts is enough", () => {
  const dir = mkdtempSync(join(tmpdir(), "c-fetched-"));
  const ledger = join(dir, "calls.jsonl");
  writeFileSync(ledger, jsonl([
    { tool: "record_fetch", target: "/mark/eu/a1", ok: true, sessionKey: `${PREFIX}register-digest` },
    { tool: "record_fetch", target: "/mark/eu/b1", ok: false, http_status: 404, sessionKey: `${PREFIX}register-digest` },
    { tool: "record_fetch", target: "/mark/eu/c1", ok: false, http_status: 503, sessionKey: `${PREFIX}register-digest` },
    { tool: "record_fetch", target: "/mark/eu/c1", ok: true, sessionKey: `${PREFIX}screen-gate-refetch` },
    { tool: "record_fetch", target: "/mark/eu/d1", ok: true, cache_hit: true, sessionKey: `${PREFIX}register-digest` },
    { tool: "record_fetch", target: "/mark/eu/d1", ok: false, http_status: 503, sessionKey: `${PREFIX}screen-gate-refetch` },
    { tool: "record_fetch", target: "/mark/eu/e1", ok: true, sessionKey: "clearance-other-run-register-digest" },
    { tool: "band_search", target: "/mark/eu/f1", ok: true, sessionKey: `${PREFIX}register-digest` },
  ]));
  assert.deepEqual([...fetchedRecordUris(ledger, PREFIX)].sort(), ["/mark/eu/a1", "/mark/eu/c1", "/mark/eu/d1"],
    "a refused fetch counted, a later success did not resolve it, a later failure erased an earlier success, or another run's fetch leaked in");
});

test("a body is the record only where it carries something beside its identity", () => {
  assert.equal(recordBodyHasContent({}), false);
  assert.equal(recordBodyHasContent(null), false);
  assert.equal(recordBodyHasContent({ _uri: "/mark/eu/a1", _receipt: { fetched_at: "2026-10-01T00:00:00Z" } }), false, "plumbing alone is not a record");
  assert.equal(recordBodyHasContent({ uri: "/mark/eu/a1", mark_text: "", statusText: null, classList: [], _raw: {} }), false, "an all-empty normalisation is a placeholder");
  assert.equal(recordBodyHasContent({ uri: "/mark/eu/a1", statusText: "Registered" }), true);
  assert.equal(recordBodyHasContent({ _raw: { classifications: [{ nice_class: 9 }] } }), true, "the register's raw record is content");
  assert.equal(recordBodyHasContent([{ classList: ["9"] }]), true, "a one-record array is read as its record, as the ledger reads it");
});

test("a later placeholder never replaces the record the run holds, nor its receipt; a record held only as a placeholder is no record", () => {
  const runDir = mkdtempSync(join(tmpdir(), "c-assemble-"));
  const recordLog = join(runDir, "_driver", "register-record-bodies.jsonl");
  mkdirSync(dirname(recordLog), { recursive: true });
  writeFileSync(recordLog, jsonl([
    { ts: "2026-10-01T10:00:00Z", sessionKey: `${PREFIX}register-digest`, target: "/mark/eu/a1", body: { statusText: "Registered", classList: ["9"] } },
    { ts: "2026-10-01T11:00:00Z", sessionKey: `${PREFIX}screen-gate-refetch`, target: "/mark/eu/a1", body: { statusText: null, classList: [] } },
    { ts: "2026-10-01T12:00:00Z", sessionKey: `${PREFIX}screen-gate-refetch`, target: "/mark/eu/b1", body: { statusText: null } },
    { ts: "2026-10-01T13:00:00Z", sessionKey: `${PREFIX}register-digest`, target: "/mark/eu/c1", body: { statusText: "Expired" } },
    { ts: "2026-10-01T14:00:00Z", sessionKey: `${PREFIX}register-digest`, target: "/mark/eu/c1", body: { statusText: "Registered" } },
  ]));
  const { records } = assembleRunRecords(runDir, PREFIX, recordLog, join(runDir, "no-call-ledger.jsonl"));
  assert.equal(records.get("/mark/eu/a1")?.statusText, "Registered", "the later placeholder replaced the record the run held");
  assert.equal(records.get("/mark/eu/c1")?.statusText, "Registered", "between two records the later still wins");
  assert.equal(recordBodyHasContent(records.get("/mark/eu/b1")), false, "guard: a placeholder held alone stays a placeholder, which the gate does not count");
  const receipts = collectRecordReceipts(recordLog, PREFIX);
  assert.equal(receipts.get("/mark/eu/a1")?.fetched_at, "2026-10-01T10:00:00Z", "the placeholder's attempt took the record's receipt");
  assert.equal(receipts.get("/mark/eu/c1")?.fetched_at, "2026-10-01T14:00:00Z");
});
