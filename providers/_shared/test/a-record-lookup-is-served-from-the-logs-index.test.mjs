// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-record-lookup-is-served-from-the-logs-index.test.mjs — a record the run has fetched is found without re-reading the
// whole run record log.
//
// The band server answered a `_records/` miss by reading and parsing the whole log, every time: a median 0.80 s and up
// to 147 s a lookup on production's 0.4.x clearances, inside serial stages. It now asks the log's own index. The answer
// rule must not move with it: per record key, the last line that carries a body wins, a later line without one hides
// nothing, and a full provider URL finds the record its `/mark/` path names. The old whole-log read is kept below as the
// oracle, and every arm asks both.
//
// NO VENDOR RECORD AND NO REAL MARK live here. Bodies are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordBodyFromLog } from "../ledger.mjs";
import { RUN_RECORD_LOG_FILE } from "../ledger-path.mjs";
import { normalizeRecordUri } from "../record-uri.mjs";

/** The band server's lookup before the index, verbatim in its rule: read every line, keep the last body. */
function wholeLogLookup(p, uri) {
  const want = normalizeRecordUri(uri) || String(uri).toLowerCase();
  let found = null;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const t = normalizeRecordUri(row?.target) || String(row?.target ?? "").toLowerCase();
    if (t && t === want && row?.body) found = row.body;
  }
  return found;
}

function runLog(rows) {
  const dir = mkdtempSync(join(tmpdir(), "record-index-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const path = join(dir, "_driver", RUN_RECORD_LOG_FILE);
  writeFileSync(path, rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
  return { dir, path, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
const both = (path, uri) => [JSON.stringify(recordBodyFromLog(path, uri)), JSON.stringify(wholeLogLookup(path, uri))];

test("the last line with a body wins, a later line without one hides nothing, and a full URL finds its record", () => {
  const log = runLog([
    { target: "/mark/us/1", body: { status: "pending" } },
    { target: "https://register.example.test/mark/US/1", body: { status: "registered" } },
    { target: "/mark/us/1", status: "error" },
    "{ a torn line",
    { target: "/mark/eu/7", body: { status: "registered" } },
    { target: "/mark/eu/8" },
  ]);
  try {
    for (const uri of ["/mark/us/1", "https://another.example.test/mark/us/1?x=1", "/MARK/EU/7", "/mark/eu/8", "/mark/zz/404", "not a uri"]) {
      const [index, whole] = both(log.path, uri);
      assert.equal(index, whole, `${uri}: the index answered differently from a whole read`);
    }
    assert.deepEqual(recordBodyFromLog(log.path, "/mark/us/1"), { status: "registered" });
    assert.equal(recordBodyFromLog(log.path, "/mark/eu/8"), null, "a record fetched with no body is not held");
  } finally { log.clean(); }
});

test("a line appended after the first lookup is found by the next", () => {
  const log = runLog([{ target: "/mark/us/1", body: { v: 1 } }]);
  try {
    assert.deepEqual(recordBodyFromLog(log.path, "/mark/us/1"), { v: 1 });
    appendFileSync(log.path, `${JSON.stringify({ target: "/mark/us/1", body: { v: 2 } })}\n${JSON.stringify({ target: "/mark/us/2", body: { v: 3 } })}\n`);
    assert.deepEqual(recordBodyFromLog(log.path, "/mark/us/1"), { v: 2 });
    assert.deepEqual(recordBodyFromLog(log.path, "/mark/us/2"), { v: 3 });
  } finally { log.clean(); }
});

test("a log rewritten in place, a new file or a shorter one, is read again from the start", () => {
  const log = runLog([{ target: "/mark/us/1", body: { v: 1 } }, { target: "/mark/us/2", body: { v: 2 } }]);
  try {
    assert.deepEqual(recordBodyFromLog(log.path, "/mark/us/2"), { v: 2 });
    // Renamed over, as an in-place replacement is written: a new inode, and here a shorter file too.
    const next = `${log.path}.next`;
    writeFileSync(next, `${JSON.stringify({ target: "/mark/us/1", body: { v: 9 } })}\n`);
    renameSync(next, log.path);
    for (const uri of ["/mark/us/1", "/mark/us/2"]) assert.equal(...both(log.path, uri), `${uri} after the rewrite`);
    assert.equal(recordBodyFromLog(log.path, "/mark/us/2"), null, "a record the rewritten log no longer holds was still served");
  } finally { log.clean(); }
});

test("over an interleaved log of many records, every answer equals the whole read", () => {
  const rows = [];
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let k = 0; k < 600; k++) {
    const id = rand(80);
    const target = rand(3) === 0 ? `https://register.example.test/mark/us/${id}` : `/mark/us/${id}`;
    rows.push(rand(4) === 0 ? { target, status: "error" } : { target, body: { id, at: k } });
  }
  const log = runLog(rows);
  try {
    for (let id = 0; id < 90; id++) assert.equal(...both(log.path, `/mark/us/${id}`), `/mark/us/${id}`);
  } finally { log.clean(); }
});

test("only a run's own record log is read: any other file answers nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-index-"));
  try {
    const other = join(dir, "register-calls.jsonl");
    writeFileSync(other, `${JSON.stringify({ target: "/mark/us/1", body: { v: 1 } })}\n`);
    assert.equal(recordBodyFromLog(other, "/mark/us/1"), null);
    assert.equal(recordBodyFromLog(join(dir, RUN_RECORD_LOG_FILE), "/mark/us/1"), null, "a log that does not exist");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
