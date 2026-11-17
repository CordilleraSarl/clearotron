// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A run assembles its record set 8 to 14 times. Each assembly used to parse the record log twice, parse
// every line of the machine's shared call log, and rewrite every file under `_records/`. These arms hold
// the three savings to the answers the old readers gave:
//   · bodies and receipts come from one pass over the record log;
//   · a line naming none of the run's prefix spellings is skipped before it is parsed;
//   · a record file that already holds what would be written is left alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, statSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleRunRecords, collectRecordBodies, collectRecordReceipts, collectRecordBodiesAndReceipts,
  collectFetchCallMeta, readRecordArtifacts,
} from "../registry-fidelity.mjs";
import { readRunCallRows } from "../goods-evidence.mjs";

const PREFIX = "clearance-quillmere-";
const row = (target, body, extra = {}) => JSON.stringify({
  ts: extra.ts ?? "2026-11-11T10:00:00Z", sessionKey: `agent:main:${extra.prefix ?? PREFIX}register-unit-a`, target, body,
});
const FULL = (n) => ({ mark_text: "QUILLMERE", registrationNumber: String(n), status: "Registered" });
const PLACEHOLDER = { provider: "demo", statusClass: "unknown" };

const tmp = () => mkdtempSync(join(tmpdir(), "records-once-"));

// Every parse of a ledger row, counted. JSON.parse is the one global both the readers and this test see.
function countingRowParses(fn) {
  const real = JSON.parse;
  let rows = 0;
  JSON.parse = function (text, ...rest) { if (typeof text === "string" && text.includes('"sessionKey"')) rows++; return real.call(this, text, ...rest); };
  try { return { result: fn(), rows }; } finally { JSON.parse = real; }
}

test("one pass gives the same bodies and receipts as the two readers, placeholders included", () => {
  const dir = tmp();
  try {
    const log = join(dir, "record.jsonl");
    writeFileSync(log, [
      row("/mark/us/1", FULL(1)),
      row("/mark/us/1", PLACEHOLDER, { ts: "2026-11-11T11:00:00Z" }),   // a later placeholder replaces neither
      row("/mark/us/2", PLACEHOLDER),
      row("/mark/us/2", FULL(2), { ts: "2026-11-11T12:00:00Z" }),
      row("/MARK/US/3", [FULL(3)]),
      row("/mark/us/4", FULL(4), { prefix: "clearance-another-run-" }),
      row("/mark/us/5", FULL(5), { prefix: "prelim-quillmere-" }),        // the pre-rename spelling of this run
      "not json",
    ].join("\n") + "\n");
    const both = collectRecordBodiesAndReceipts(log, PREFIX);
    assert.deepEqual([...both.bodies], [...collectRecordBodies(log, PREFIX)]);
    assert.deepEqual([...both.receipts], [...collectRecordReceipts(log, PREFIX)]);
    assert.deepEqual([...both.bodies.keys()].sort(), ["/mark/us/1", "/mark/us/2", "/mark/us/3", "/mark/us/5"]);
    assert.equal(both.bodies.get("/mark/us/1").registrationNumber, "1", "the placeholder did not replace the record");
    assert.equal(both.receipts.get("/mark/us/1").fetched_at, "2026-11-11T10:00:00Z", "nor its receipt");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an assembly parses each of the run's record-log rows once", () => {
  const dir = tmp();
  try {
    const log = join(dir, "record.jsonl");
    writeFileSync(log, [1, 2, 3, 4, 5].map((n) => row(`/mark/us/${n}`, FULL(n))).join("\n") + "\n");
    const { result, rows } = countingRowParses(() => assembleRunRecords(dir, PREFIX, log, join(dir, "no-call-log.jsonl")));
    assert.equal(result.records.size, 5);
    assert.equal(result.receipts, 5);
    assert.equal(rows, 5, "five rows, one parse each: the bodies and the receipts share the pass");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("call-log lines of other runs are skipped before they are parsed, and the answer is the same", () => {
  const dir = tmp();
  try {
    const calls = join(dir, "calls.jsonl");
    const call = (prefix, target, extra = {}) => JSON.stringify({ sessionKey: `agent:main:${prefix}unit`, tool: "record_fetch", target, ok: true, ...extra });
    const others = Array.from({ length: 200 }, (_, i) => call("clearance-another-run-", `/mark/us/${100 + i}`));
    writeFileSync(calls, [...others, call(PREFIX, "/mark/us/1", { http_status: 200 }), call("prelim-quillmere-", "/mark/us/2")].join("\n") + "\n");
    const { result, rows } = countingRowParses(() => collectFetchCallMeta(calls, PREFIX));
    assert.deepEqual([...result.keys()].sort(), ["/mark/us/1", "/mark/us/2"]);
    assert.deepEqual(result.get("/mark/us/1"), { http_status: 200, ok: true });
    assert.equal(rows, 2, "only the two lines that name this run were parsed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the goods reader's pass over the call log skips other runs' lines too, and still reads every row without a prefix", () => {
  const dir = tmp();
  try {
    const calls = join(dir, "calls.jsonl");
    const call = (prefix, target) => JSON.stringify({ sessionKey: `agent:main:${prefix}unit`, tool: "record_fetch", target, ok: true });
    writeFileSync(calls, [...Array.from({ length: 50 }, (_, i) => call("clearance-another-run-", `/mark/us/${100 + i}`)),
      call(PREFIX, "/mark/us/1")].join("\n") + "\n");
    const { result, rows } = countingRowParses(() => readRunCallRows(calls, PREFIX));
    assert.deepEqual(result.rows.map((r) => r.target), ["/mark/us/1"]);
    assert.equal(result.error, null);
    assert.equal(rows, 1, "only the line that names this run was parsed");
    assert.equal(readRunCallRows(calls, "").rows.length, 51, "no prefix: every row is the run's, as before");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a prefix JSON might escape is matched by parsing every line, as before", () => {
  const dir = tmp();
  try {
    const log = join(dir, "record.jsonl");
    // Written the way an ASCII-only writer would: the é escaped, so the raw prefix is not in the line.
    const escaped = row("/mark/us/1", FULL(1), { prefix: "clearance-café-" }).replace("é", "\\u00e9");
    writeFileSync(log, escaped + "\n");
    assert.ok(!readFileSync(log, "utf8").includes("café"));
    assert.equal(collectRecordBodies(log, "clearance-café-").size, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a second assembly with nothing new rewrites no record file; a changed or legacy one is rewritten", () => {
  const dir = tmp();
  try {
    const log = join(dir, "record.jsonl");
    writeFileSync(log, [1, 2].map((n) => row(`/mark/us/${n}`, FULL(n))).join("\n") + "\n");
    // An inherited record this session never fetched, and a legacy file written before files carried `_uri`.
    mkdirSync(join(dir, "_records"), { recursive: true });
    writeFileSync(join(dir, "_records", "us-9.json"), JSON.stringify({ ...FULL(9), _uri: "/mark/us/9", _receipt: { fetched_at: "t0", context: null } }, null, 2) + "\n");
    writeFileSync(join(dir, "_records", "us-8.json"), JSON.stringify(FULL(8)) + "\n");
    const noCalls = join(dir, "no-call-log.jsonl");
    assembleRunRecords(dir, PREFIX, log, noCalls);

    const files = () => readdirSync(join(dir, "_records")).sort();
    const old = new Date("2001-01-01T00:00:00Z");
    for (const f of files()) utimesSync(join(dir, "_records", f), old, old);
    const before = Object.fromEntries(files().map((f) => [f, readFileSync(join(dir, "_records", f), "utf8")]));
    const touched = () => files().filter((f) => statSync(join(dir, "_records", f)).mtimeMs !== old.getTime());

    assembleRunRecords(dir, PREFIX, log, noCalls);
    assert.deepEqual(touched(), [], "nothing changed, so nothing was written");
    for (const f of files()) assert.equal(readFileSync(join(dir, "_records", f), "utf8"), before[f]);

    writeFileSync(log, readFileSync(log, "utf8") + row("/mark/us/2", { ...FULL(2), status: "Expired" }, { ts: "2026-11-11T13:00:00Z" }) + "\n");
    const { records } = assembleRunRecords(dir, PREFIX, log, noCalls);
    assert.deepEqual(touched(), ["us-2.json"], "only the record whose content changed was written");
    assert.equal(readRecordArtifacts(dir).get("/mark/us/2").status, "Expired");
    assert.equal(records.size, 4);

    // The control: a legacy file is rewritten with its `_uri`, as every assembly did before.
    assert.equal(JSON.parse(before["us-8.json"])._uri, "/mark/us/8", "the first assembly gave the legacy file its _uri");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
