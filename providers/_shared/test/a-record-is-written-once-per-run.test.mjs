// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-record-is-written-once-per-run.test.mjs — the run's register record ledger holds each record once.
//
// THE DEFECT. A record that several queries return was appended once per query: measured on a delivered run,
// 2,898 lines for 2,098 distinct records, 800 of them repeats and 786 of those byte-identical. The band server
// reads the whole file on a cache miss, and nothing reads the repeats.
//
// NO VENDOR RECORD AND NO REAL MARK live here. Bodies are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeLedger } from "../ledger.mjs";
import { RUN_RECORD_LOG_FILE } from "../ledger-path.mjs";

const { logRecordBody } = makeLedger("invented");
const lines = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function runLedger() {
  const dir = mkdtempSync(join(tmpdir(), "record-once-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  return { dir, path: join(dir, "_driver", RUN_RECORD_LOG_FILE) };
}
const tctx = (path, stage = "register-unit-primary-sweep") => ({ recordLog: path, agentId: "a", sessionKey: `clearance-x-y-${stage}` });
const body = (status) => ({ uri: "/mark/us/1", markText: "INVENTED", statusText: status, _raw: { status: { primary: status } } });

test("the same record returned by three queries is one line", () => {
  const { dir, path } = runLedger();
  try {
    for (const stage of ["register-unit-primary-sweep", "register-unit-incumbent-class", "crowd-context"])
      logRecordBody(tctx(path, stage), "/mark/us/1", body("active"));
    logRecordBody(tctx(path), "/mark/us/2", { ...body("active"), uri: "/mark/us/2" });
    const rows = lines(path);
    assert.equal(rows.length, 2, "line count equals distinct record count");
    assert.deepEqual(rows.map((r) => r.target), ["/mark/us/1", "/mark/us/2"]);
    assert.ok(rows[0].body._raw, "every field stays, the vendor's raw copy included");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record returned again with a changed status is one line, the newer body, marked refreshed", () => {
  const { dir, path } = runLedger();
  try {
    logRecordBody(tctx(path), "/mark/us/1", body("pending"));
    const first = lines(path)[0];
    logRecordBody(tctx(path), "/MARK/US/1", body("active"));   // readers match case-insensitively; so does this
    const rows = lines(path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body.statusText, "active", "the newer body replaces the one written");
    assert.equal(rows[0].refreshed, true, "and says it was refreshed");
    assert.equal(rows[0].refreshed_from, first.ts, "naming when the body it replaced was written");
    // ONCE: a third, different answer does not rewrite the file again.
    logRecordBody(tctx(path), "/mark/us/1", body("expired"));
    assert.equal(lines(path).length, 1);
    assert.equal(lines(path)[0].body.statusText, "active");
    assert.ok(!existsSync(`${path}.lock`), "the lock is released");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record another process already wrote is not written again", () => {
  // Several processes write one run's ledger. "Already written" must be read off the file, not off memory.
  const { dir, path } = runLedger();
  try {
    logRecordBody(tctx(path), "/mark/us/9", { ...body("active"), uri: "/mark/us/9" });
    appendFileSync(path, JSON.stringify({ ts: "2026-09-18T00:00:00Z", provider: "invented", target: "/mark/gb/5", body: { uri: "/mark/gb/5" } }) + "\n");
    logRecordBody(tctx(path), "/mark/gb/5", { uri: "/mark/gb/5" });
    assert.equal(lines(path).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the box-wide fallback ledger is untouched by this: it holds many runs, and appends as before", () => {
  const dir = mkdtempSync(join(tmpdir(), "record-global-"));
  const path = join(dir, "register-records.jsonl");
  try {
    logRecordBody({ recordLog: path }, "/mark/us/1", body("active"));
    logRecordBody({ recordLog: path }, "/mark/us/1", body("active"));
    assert.equal(lines(path).length, 2, "a record one run fetched is not a record another run holds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
