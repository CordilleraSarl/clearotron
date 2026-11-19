// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RECORD SET READS ONLY WHAT WAS APPENDED, AND GIVES WHAT A READ FROM THE START GIVES. A run assembles its record
// set 8 to 14 times, and each assembly read its whole record log and the box's whole call log again. The driver now
// keeps what it folded and reads on from where it stopped. Each arm here compares that answer with a read of the
// same bytes at a path the driver has never read, which is a read from the start: after appends, a line half
// written, a complete line with no newline yet, a rewrite in place, a rewrite through a rename, a truncation and a
// removal. Every mark, owner and run here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRecordBodiesAndReceipts, collectFetchCallMeta, ledgerReadError } from "../registry-fidelity.mjs";

const RUN = "clearance-tarnello-2026-11-19-oak";
const OTHER = "clearance-brisvane-2026-11-19-elm";
let n = 0;
const row = (run, target, body, extra = {}) => JSON.stringify({ sessionKey: `agent:main:${run}:register`, target, ts: `2026-11-19T07:${String(n++ % 60).padStart(2, "0")}:00Z`, body, ...extra }) + "\n";
const body = (mark, owner) => ({ mark, owner, goods: "Café and crème goods", status: "Registered" });

function dir(t) {
  const d = mkdtempSync(join(tmpdir(), "record-set-append-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
let fresh = 0;
/** What a read from the start gives: the same bytes, at a path never read before. */
function fromStart(d, path, read) {
  const copy = join(d, `fresh-${++fresh}.jsonl`);
  copyFileSync(path, copy);
  return read(copy);
}
const bodies = (p) => collectRecordBodiesAndReceipts(p, RUN);
const plain = (r) => ({ bodies: [...r.bodies], receipts: [...r.receipts] });
const same = (d, path, why) => assert.deepEqual(plain(bodies(path)), plain(fromStart(d, path, bodies)), why);

test("after each append, and with a line half written, the answer is a read from the start", (t) => {
  const d = dir(t);
  const log = join(d, "register-record-bodies.jsonl");
  writeFileSync(log, row(RUN, "/mark/eu/001", body("TARNELLO", "Invented Holdings")) + row(OTHER, "/mark/eu/009", body("BRISVANE", "Another Ltd")));
  same(d, log, "the first read");
  appendFileSync(log, row(RUN, "/mark/eu/002", body("TARNELO", "Second Invented SA")) + row(RUN, "/mark/eu/001", {}));
  same(d, log, "an append, with a placeholder that must not replace a body");
  appendFileSync(log, row(RUN, "/mark/eu/001", body("TARNELLO", "Invented Holdings AG")).slice(0, 40));
  same(d, log, "a line half written");
  appendFileSync(log, row(RUN, "/mark/eu/001", body("TARNELLO", "Invented Holdings AG")).slice(40));
  same(d, log, "the half line completed");
  appendFileSync(log, row(RUN, "/mark/eu/003", body("TARNELLY", "Third Invented")).trimEnd());
  same(d, log, "a complete line with no newline yet");
  appendFileSync(log, "\n" + row(RUN, "/mark/eu/004", body("TARNELLI", "Fourth Invented")));
  same(d, log, "its newline and the next line");
  assert.equal(bodies(log).bodies.size, 4);
});

test("a log rewritten in place, through a rename, cut short or removed is read again from the start", (t) => {
  const d = dir(t);
  const log = join(d, "register-record-bodies.jsonl");
  writeFileSync(log, row(RUN, "/mark/eu/001", body("TARNELLO", "Invented Holdings")));
  same(d, log, "the first read");
  writeFileSync(log, row(RUN, "/mark/eu/005", body("TARNEL", "Rewritten In Place")) + row(RUN, "/mark/eu/006", body("TARNELLE", "Longer Than Before")));
  same(d, log, "a rewrite in place that grew the file");
  writeFileSync(join(d, "next.jsonl"), row(RUN, "/mark/eu/007", body("TARNELLA", "Renamed In")) + row(RUN, "/mark/eu/005", body("TARNEL", "Renamed In Too")) + row(RUN, "/mark/eu/008", body("TARNELLU", "Third Row")));
  renameSync(join(d, "next.jsonl"), log);
  same(d, log, "a rewrite through a rename");
  writeFileSync(log, row(RUN, "/mark/eu/007", body("TARNELLA", "Cut Short")));
  same(d, log, "a truncation");
  rmSync(log);
  assert.deepEqual(plain(bodies(log)), { bodies: [], receipts: [] });
  assert.equal(ledgerReadError(), null, "a log not there yet is not a read failure");
});

test("what a caller is given is a copy: changing it changes nothing the next caller reads", (t) => {
  const d = dir(t);
  const log = join(d, "register-record-bodies.jsonl");
  writeFileSync(log, row(RUN, "/mark/eu/001", body("TARNELLO", "Invented Holdings")));
  const first = bodies(log);
  first.bodies.get("/mark/eu/001").owner = "CHANGED";
  first.receipts.get("/mark/eu/001").context = "CHANGED";
  first.bodies.clear();
  same(d, log, "after a caller changed what it was given");
  assert.equal(bodies(log).bodies.get("/mark/eu/001").owner, "Invented Holdings");
});

test("the call log's fetch rows read on from where they stopped, for the run asked about only", (t) => {
  const d = dir(t);
  const log = join(d, "register-calls.jsonl");
  const call = (run, target, ok) => JSON.stringify({ sessionKey: `agent:main:${run}:register`, tool: "record_fetch", target, ok, http_status: ok ? 200 : 404 }) + "\n";
  const read = (p) => [...collectFetchCallMeta(p, RUN)];
  writeFileSync(log, call(RUN, "/mark/eu/001", true) + call(OTHER, "/mark/eu/009", true));
  assert.deepEqual(read(log), fromStart(d, log, read));
  appendFileSync(log, call(RUN, "/mark/eu/002", false) + call(RUN, "/mark/eu/001", false).slice(0, 30));
  assert.deepEqual(read(log), fromStart(d, log, read));
  appendFileSync(log, call(RUN, "/mark/eu/001", false).slice(30));
  assert.deepEqual(read(log), fromStart(d, log, read));
  assert.equal(read(log).length, 2);
});
