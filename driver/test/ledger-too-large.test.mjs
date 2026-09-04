// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the fetch ledger outgrew Node's maximum string length, and the read that failed was discarded.
//
// THE INCIDENT, 2026-08-10. The record ledger (then named `corsearch-records.jsonl`; renamed it
// to `register-records.jsonl`) is append-only and nothing
// rotates it:
//
//     MAX_STRING_LENGTH   536,870,888
//     the ledger          641,539,069     readFileSync(…, "utf8") ⇒ ERR_STRING_TOO_LONG
//
// All three readers did `try { readFileSync(path, "utf8") } catch { return map }`, so from that moment
// every one returned EMPTY — on a file that existed, was readable, and held exactly the right rows.
// 2,117 of them for the run that first showed it, each with a well-formed target and body under a
// matching sessionKey. Not one was ever examined.
//
// The blast radius was not the ledger. `assembleRunRecords` unions the ledger leg with `_records/`, and
// `_records/` is populated BY THAT UNION on a previous session — so a fresh run lost both legs at once
// and assembled ZERO records. `joinEvidenceStatus` then had an empty record set, raised no
// "presented as assumed" flag on any meter, and a delivered clearance shipped nineteen
// `verified-from-record` claims with not one record on disk and no flag anywhere.
//
// Run:  node --test driver/test/ledger-too-large.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { forEachLedgerLine, collectRecordBodies, collectRecordReceipts, collectFetchCallMeta,
  assembleRunRecords, ledgerReadError } from "../registry-fidelity.mjs";

const KEY = "prelim-slug-codename-register-unit-primary";
const PREFIX = "prelim-slug-codename-";
const row = (i) => JSON.stringify({ ts: `2026-08-10T0${i % 10}:00:00Z`, sessionKey: KEY,
  target: `/mark/us/U${i}`, body: { record_id: `/mark/us/U${i}`, mark_text: `MARK${i}` } });

const withLedger = (fn, { lines = 5, pad = 0 } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const p = join(dir, "register-records.jsonl");
  // `pad` inflates each row so the file can be pushed past a size threshold without minting rows.
  const filler = pad ? `,"_pad":"${"x".repeat(pad)}"` : "";
  writeFileSync(p, Array.from({ length: lines }, (_, i) =>
    row(i).replace(/}$/, `${filler}}`)).join("\n") + "\n");
  try { return fn(p, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("#582 the walk never materialises the file as one string — that is the whole defect", () => {
  // The guard is structural rather than a 600 MB fixture: a test that had to build one would be skipped
  // on any box that could not afford it, which is exactly the box the defect appears on.
  const src = readFileSync(new URL("../registry-fidelity.mjs", import.meta.url), "utf8");
  const readers = src.slice(src.indexOf("export function collectRecordBodies"), src.indexOf("export function writeRecordArtifacts"));
  assert.doesNotMatch(readers, /readFileSync\([^)]*"utf8"\)/,
    "a ledger reader that reads the whole file as a string has a hard ceiling at MAX_STRING_LENGTH "
    + `(${bufferConstants.MAX_STRING_LENGTH.toLocaleString()} bytes) and fails silently above it`);
  assert.match(src, /const LEDGER_CHUNK = /, "it is walked in chunks");
});

test("#582 a line split ACROSS chunk boundaries survives — the carry is the whole trick", () => {
  // The failure this prevents: a row torn in half by the chunk edge parses as two invalid fragments and
  // is dropped. Silently, and only for records whose row happens to straddle an 8 MB boundary.
  const dir = mkdtempSync(join(tmpdir(), "ledger-carry-"));
  const p = join(dir, "l.jsonl");
  try {
    const rows = Array.from({ length: 400 }, (_, i) => row(i).replace(/}$/, `,"_pad":"${"y".repeat(40_000)}"}`));
    writeFileSync(p, rows.join("\n") + "\n");   // ~16 MB ⇒ several chunk boundaries, mid-row
    const got = collectRecordBodies(p, PREFIX);
    assert.equal(got.size, 400, "every row survived, including the ones the chunk edge cut in half");
    for (let i = 0; i < 400; i++)
      assert.ok(got.has(`/mark/us/u${i}`), `row ${i} is present and parsed`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#582 all three readers walk the same way and agree on the same ledger", () => {
  withLedger((p) => {
    assert.equal(collectRecordBodies(p, PREFIX).size, 5);
    assert.equal(collectRecordReceipts(p, PREFIX).size, 5);
    // The call ledger keys on tool:"record_fetch"; these rows are bodies, so it correctly finds none.
    assert.equal(collectFetchCallMeta(p, PREFIX).size, 0);
    // …and the prefix filter still filters.
    assert.equal(collectRecordBodies(p, "prelim-other-run-").size, 0);
  });
});

test("#582 a MISSING ledger is not an error — a run before any fetch has none, and that is ordinary", () => {
  const r = forEachLedgerLine(join(tmpdir(), "no-such-ledger-582.jsonl"), () => {
    assert.fail("nothing to walk");
  });
  assert.equal(r.lines, 0);
  assert.equal(r.error, null, "absence is the ordinary state here, and must not read as a fault");
});

test("#582 a ledger that EXISTS and cannot be read is a reported fault, never an empty map", () => {
  // The distinction the old `catch { return map }` erased. A directory where a file should be is the
  // portable stand-in for the real case (EISDIR rather than ERR_STRING_TOO_LONG) — what matters is that
  // a read which fails on a path that IS there produces a reason, not a silent zero.
  const dir = mkdtempSync(join(tmpdir(), "ledger-bad-"));
  const p = join(dir, "l.jsonl");
  mkdirSync(p);
  try {
    let seen = 0;
    const r = forEachLedgerLine(p, () => { seen++; });
    assert.equal(seen, 0);
    assert.ok(r.error, "the failure has a REASON attached — this is the line that would have caught #582 in an hour");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#582 assembleRunRecords reports the ledger's verdict, so a caller cannot mistake one zero for the other", () => {
  const runDir = mkdtempSync(join(tmpdir(), "assemble-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const bad = join(runDir, "as-a-dir.jsonl");
  mkdirSync(bad);
  try {
    const r = assembleRunRecords(runDir, PREFIX, bad, join(runDir, "calls.jsonl"));
    assert.equal(r.records.size, 0);
    assert.ok(r.ledgerError, "'nothing was fetched' and 'the ledger could not be read' are different facts");
    // …and the good path reports no fault at all, so the field means something when it is set.
    withLedger((p) => {
      const ok = assembleRunRecords(runDir, PREFIX, p, join(runDir, "calls.jsonl"));
      assert.equal(ok.records.size, 5);
      assert.equal(ok.ledgerError, null);
      assert.equal(ledgerReadError(), null, "and the module-level verdict is reset per assembly, not inherited");
    });
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
