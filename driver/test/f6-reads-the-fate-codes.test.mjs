// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// f6-reads-the-fate-codes.test.mjs — F6 asks the codes what judgment did, not the disk what survives.
//
//, the reader half. The seam contract: a picked line with no record is the fetch
// failure worth alerting on; an unpicked line stays out of the denominator.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoredFetched } from "../gate-metrics.mjs";
import { FATES } from "../hit-list.mjs";

// UPPERCASE ON PURPOSE. Measured on the R14 archive: 1,937 of 1,937 band record_ids and 37 of 37
// finding uris carry uppercase. A fixture written in lowercase would pass while the product failed,
// because the join would be comparing already-matching strings — the arm would test nothing.
const A = "/mark/US/AAA111", B = "/mark/US/BBB222";
const FINDINGS = { findings: [
  { band: "High", owner: { registrations: [{ uri: A }] } },
  { band: "Medium", owner: { registrations: [{ uri: B }] } },
] };

function run({ lines = null, records = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), "f6fc-"));
  writeFileSync(join(d, "findings.json"), JSON.stringify(FINDINGS));
  if (lines) writeFileSync(join(d, "register-hit-list.json"), JSON.stringify({ schema_version: 1, lines }));
  if (records) {
    mkdirSync(join(d, "_records"), { recursive: true });
    for (const u of records) writeFileSync(
      join(d, "_records", u.replace(/^\/mark\//, "").replace(/\//g, "-").toLowerCase() + ".json"),
      JSON.stringify({ _uri: u }));
  }
  return d;
}

test("2039 F6 reads the fate codes, and the JOIN survives the case the real data carries", () => {
  const r = scoredFetched(run({ lines: [
    { id: A, fate: FATES.OPENED_DISMISSED }, { id: B, fate: FATES.REPORTED }] }));
  assert.deepEqual(r, { total: 2, fetched: 2 },
    "both lines were opened; a zero here is the un-normalised join, which misses ALL of them, not some");
});

test("2039 AN UNPICKED LINE LEAVES THE DENOMINATOR — the seam contract, measured", () => {
  // A record the run deliberately never opened is not a fetch that failed. Counting it as one would
  // make this metric fall as the conversion works BETTER, which is the reading the contract forbids.
  assert.deepEqual(scoredFetched(run({ lines: [
    { id: A, fate: FATES.OPENED_DISMISSED }, { id: B, fate: FATES.NOT_PICKED, ground: "territory" }] })),
  { total: 1, fetched: 1 }, "the unpicked line stayed in the denominator");

  // And when every citation is unpicked there is nothing to measure — not a perfect score, not a zero.
  assert.equal(scoredFetched(run({ lines: [
    { id: A, fate: FATES.NOT_PICKED, ground: "sign" }, { id: B, fate: FATES.NOT_PICKED, ground: "territory" }] })),
  null, "a run with nothing to measure reported a score");
});

test("2039 a citation the list does not know STAYS in the denominator", () => {
  // This is the alert half. A scored finding resting on a registration the hit list never enumerated is
  // a claim this metric cannot vouch for, and going quiet about it would be the silence F6 exists to break.
  assert.deepEqual(scoredFetched(run({ lines: [{ id: A, fate: FATES.REPORTED }] })),
    { total: 2, fetched: 1 }, "an unknown citation was dropped instead of counted as unvouched");
});

test("2039 the FALLBACK holds: no hit list falls back to _records/, neither surface is null", () => {
  // Now the long-term shape rather than a transition: the pile keeps existing until retention is ruled.
  assert.deepEqual(scoredFetched(run({ records: [A] })), { total: 2, fetched: 1 },
    "a pre-conversion run stopped measuring");
  assert.equal(scoredFetched(run({})), null, "neither surface must be no-surface, not a false zero");
});

test("2039 the picked fates are ENUMERATED, so a new fate is not opened by arithmetic", () => {
  // `fate >= 1` would read any future fate as opened. A fate this file does not know must fall OUT of
  // the numerator — that shrinks the score and raises this metric's own alarm, where counting it in
  // would inflate the score and say nothing. Loud beats plausible.
  const r = scoredFetched(run({ lines: [{ id: A, fate: FATES.REPORTED }, { id: B, fate: 99 }] }));
  assert.deepEqual(r, { total: 2, fetched: 1 },
    "an unrecognised fate was counted as opened — a threshold, not an enumeration");
});
