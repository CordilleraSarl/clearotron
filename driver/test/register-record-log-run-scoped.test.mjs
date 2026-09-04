// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the register record log is run-scoped, and an empty one can never read as "verified".
//
// THE WHOLE POINT OF THIS FILE. Moving the record log into the run directory makes 's incident
// shape the DEFAULT rather than an accident: every run now starts with no record log at all, and
// `forEachLedgerLine` maps a missing file to `error: null` on purpose, because a run before its first
// fetch genuinely has none. So a run whose record bodies were written somewhere this reader never looks
// — a writer that was not handed `recordLog`, a resume pointed at a different directory — assembles
// ZERO records and produces an artifact identical to a clean run's. That is the delivered clearance
// with nineteen `verified-from-record` meters and not one record on disk.
//
// The CALL ledger is the independent witness and is why it deliberately did NOT move: it records that a
// record_fetch happened under this run's prefix whatever became of the body.
//
// The address move itself is pinned by test/register-ledger-rename.test.mjs; the writer seam by
// providers/_shared/test/kernel-seams.test.mjs. This file is the guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { assembleRunRecords } from "../registry-fidelity.mjs";
import { runRecordLogPath } from "../../providers/_shared/ledger-path.mjs";

const PREFIX = "prelim-tmp743-aa-";
const SK = `agent:clawdi:${PREFIX}register-unit-x`;
const BODY = { applicationNumber: "86272665", registrationNumber: "4641314" };

const recordRow = (target, body = BODY) => JSON.stringify({ ts: "t", sessionKey: SK, target, body }) + "\n";
const callRow = (target, ok = true) =>
  JSON.stringify({ ts: "t", provider: "euipo", sessionKey: SK, tool: "record_fetch", target, ok, http_status: ok ? 200 : 404 }) + "\n";

function scaffold({ records = null, calls = null } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "run743g-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  if (records !== null) writeFileSync(runRecordLogPath(runDir), records);
  const callLog = join(runDir, "calls.jsonl");
  writeFileSync(callLog, calls ?? "");
  return { runDir, callLog };
}

// ── the guard ───────────────────────────────────────────────────────────────────────────────────────

test("#743 fetches that succeeded with no record body in the run are a FAILURE, not a clean zero", () => {
  // The exact shape the move could ship: the run made two record fetches, both answered 200, and the
  // run's record log is empty because the bodies went to the old global address. Before this guard the
  // only observable was `records.size === 0`, which is also what an honest untouched run looks like.
  const { runDir, callLog } = scaffold({
    records: "",
    calls: callRow("/mark/us/86272665") + callRow("/mark/eu/018922211"),
  });
  const r = assembleRunRecords(runDir, PREFIX, runRecordLogPath(runDir), callLog);
  assert.equal(r.records.size, 0);
  assert.equal(r.ledgerError, null, "the log is readable and empty — this is NOT a read failure");
  assert.equal(r.fetchedWithoutRecord, 2, "…and that is precisely why the zero has to be contradicted from elsewhere");
  assert.deepEqual(r.unrecordedFetches, ["/mark/eu/018922211", "/mark/us/86272665"]);
});

test("#743 a run that fetched nothing at all is still a clean zero", () => {
  // The dual, and the reason the guard is keyed on the CALL ledger rather than on `records.size`. Most
  // runs legitimately fetch no records; a guard that fired on all of them would be turned off within a
  // week and the real case would go with it.
  const { runDir, callLog } = scaffold({ records: null, calls: "" });
  const r = assembleRunRecords(runDir, PREFIX, runRecordLogPath(runDir), callLog);
  assert.equal(r.records.size, 0);
  assert.equal(r.fetchedWithoutRecord, 0);
  assert.equal(r.ledgerError, null, "'no record log yet' is ordinary and must never be a fault");
});

test("#743 a fetch the register REFUSED is not counted — it has no body to file", () => {
  // A 404 or a provider refusal is disclosed on its own surfaces. Counting it here would report a
  // known, handled provider failure as an evidence-plumbing defect and bury the real one in noise.
  const { runDir, callLog } = scaffold({ records: "", calls: callRow("/mark/us/86272665", false) });
  const r = assembleRunRecords(runDir, PREFIX, runRecordLogPath(runDir), callLog);
  assert.equal(r.fetchedWithoutRecord, 0);
});

test("#743 a fetch whose body IS in the run's log passes the guard", () => {
  const { runDir, callLog } = scaffold({
    records: recordRow("/mark/us/86272665"),
    calls: callRow("/mark/us/86272665"),
  });
  const r = assembleRunRecords(runDir, PREFIX, runRecordLogPath(runDir), callLog);
  assert.equal(r.fromLedger, 1);
  assert.equal(r.fetchedWithoutRecord, 0);
  assert.equal(r.records.get("/mark/us/86272665").registrationNumber, "4641314");
});

test("#743 an inherited _records/ artifact satisfies the guard — the fork case", () => {
  // A resumed or forked run carries `_records/` and may re-cite a record it never re-fetched this
  // session. The guard asks whether the RUN can show the record, not whether this session wrote the row.
  const { runDir, callLog } = scaffold({ records: "", calls: callRow("/mark/us/86272665") });
  mkdirSync(join(runDir, "_records"), { recursive: true });
  writeFileSync(join(runDir, "_records", "us-86272665.json"),
    JSON.stringify({ ...BODY, _uri: "/mark/us/86272665" }) + "\n");
  const r = assembleRunRecords(runDir, PREFIX, runRecordLogPath(runDir), callLog);
  assert.equal(r.fromRunDir, 1);
  assert.equal(r.fetchedWithoutRecord, 0);
});

test("#743 losing the WITNESS is its own finding — an unreadable call ledger is reported", () => {
  // Without this the guard is worthless in exactly the situation it exists for: no readable call ledger
  // means no fetch rows, which means `fetchedWithoutRecord === 0` on every run it could ever fail.
  const { runDir } = scaffold({ records: "" });
  const callLog = join(runDir, "unreadable-calls.jsonl");
  writeFileSync(callLog, callRow("/mark/us/86272665"));
  chmodSync(callLog, 0o000);
  const r = assembleRunRecords(runDir, PREFIX, runRecordLogPath(runDir), callLog);
  chmodSync(callLog, 0o644);
  // Running as root reads a 000 file regardless, and then there is no failure to assert on. Say which
  // of the two happened rather than passing quietly either way.
  if (r.callLedgerError === null) {
    assert.equal(r.fetchedWithoutRecord, 1, "the ledger WAS readable here (root?), so the guard must have fired instead");
  } else {
    assert.match(r.callLedgerError, /EACCES|read failed/);
    assert.equal(r.ledgerError, null, "the RECORD log read fine — the two verdicts are separate facts");
  }
});

// ── the address ─────────────────────────────────────────────────────────────────────────────────────

test("#743 the record log's default address is derived from the run dir the caller already passed", () => {
  // No second argument, no env var, no home directory: the run dir is the only input, which is what
  // makes concurrent runs in one driver process safe.
  const { runDir } = scaffold({ records: recordRow("/mark/us/86272665") });
  const r = assembleRunRecords(runDir, PREFIX);
  assert.equal(r.fromLedger, 1, "assembleRunRecords found the log without being told where it is");
  assert.equal(runRecordLogPath(runDir), driverDir(runDir, "register-record-bodies.jsonl"));
});

test("#743 the log's name cannot be confused with the knockout lane's register-records.json", () => {
  // `<run>/_driver/register-records.json` already exists and is a completely different artifact — the
  // knockout filings listing. Two files one character apart in one directory, holding different things,
  // is a mis-read waiting for an incident.
  assert.doesNotMatch(runRecordLogPath("/x"), /register-records\.jsonl$/);
  assert.match(runRecordLogPath("/x"), /register-record-bodies\.jsonl$/);
});

// ── 's route: a composite's rows name the MEMBER that answered ───────────────────────────────────

test("#743/#546 free-tier exports a ledger binding it must never call — a member's own core writes the row", () => {
  // free-tier's members are searched through their OWN cores, so a composite run's record rows say
  // `euipo` / `uspto-local` and a free-tier count can be audited against the source that produced it.
  // The binding at providers/free-tier/src/core.js is exported and never called; the moment anyone uses
  // it — reasonably, since every sibling core calls its own — every composite row starts saying
  // "free-tier" and 's attribution route closes with no error anywhere.
  const src = readFileSync(new URL("../../providers/free-tier/src/core.js", import.meta.url), "utf8");
  const live = src.split("\n")
    .map((ln, i) => [i + 1, ln])
    .filter(([, ln]) => /\b(logRecordBody|logCall)\s*\(/.test(ln) && !/^\s*(\/\/|\*|\/\*)/.test(ln));
  assert.deepEqual(live, [],
    "free-tier must never write a ledger row under its own id — the member's core does, and that member "
    + "id is the only thing that says which register answered");
});
