// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN FROM BEFORE STEP 3 WAS JUDGED BY OWNER IS NOT TRACED BY THE JUDGED STEP'S SEAMS.
//
// The record trace joins each retrieved record to the discard ledger, where the step that set a record
// aside wrote down that it did. Step 3 used to be two steps, placement and the register digest, and a
// ledger written then holds their rows. The ledger now reads the judges' rows and synthesis's, and skips
// the old two. So on a run from before the change, every record placement or the digest set aside traced
// as one that no step spoke about: the defect this artifact exists to report, on a run that never had it.
// Measured on an archived test run's records with a ledger of that era: 11 records unaccounted, and the
// lint's unaccounted-drop check failing.
//
// Such a run is now not traced, and the artifact says why. A trace is written at publish, so this is
// reached only by a run started before the change that publishes after it. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { deriveRecordCarry } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { DISCARD_LEDGER_NAME } from "../record-discard.mjs";

const RECORDS = ["/mark/aa/0000-01", "/mark/aa/0000-02", "/mark/aa/0000-03"].map((record_id, i) => ({
  record_id, mark_text: `EXAMPLE ${i + 1}`, owner_name: `Example Holder ${i + 1}`, office: "aa", classes: [9],
  status: "REGISTERED", screen: { screen_verdict: "surface:in-scope-live" },
}));
const row = (seam, verdict, uri) => JSON.stringify({ seam, verdict, uri, stage: seam, pass: 1, trigger: "first" });

function trace(ledgerRows) {
  const dir = mkdtempSync(join(tmpdir(), "pre-judged-trace-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "register-named-band.json"), JSON.stringify({ enumerated: RECORDS, crowds: [] }));
    writeFileSync(driverDir(dir, DISCARD_LEDGER_NAME), ledgerRows.join("\n") + "\n");
    deriveRecordCarry({ paths: paths(dir) }, "publish", { findings: [] });
    return JSON.parse(readFileSync(driverDir(dir, "record-carry.json"), "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a ledger holding the placement and digest steps' rows is not traced, and the artifact says why", () => {
  const a = trace([
    row("placement", "discarded", RECORDS[0].record_id),
    row("digest", "discarded", RECORDS[1].record_id),
    row("synthesis", "carried", RECORDS[2].record_id),
  ]);
  assert.equal(a.computable, false,
    `a run from before the judged step was traced by its seams: ${a.totals?.unreasoned ?? "?"} record(s) read as unaccounted`);
  assert.match(String(a.reason ?? ""), /before step 3 was judged by owner/);
  assert.match(String(a.reason ?? ""), /2 row\(s\) from the placement and digest steps/);
});

test("THE CONTROL: a ledger of the judged step's own seams is traced on its record", () => {
  const a = trace([
    row("judgment", "discarded", RECORDS[0].record_id),
    row("judgment", "carried", RECORDS[1].record_id),
    row("synthesis", "carried", RECORDS[1].record_id),
  ]);
  assert.equal(a.computable, true);
  assert.equal(a.basis, "recorded");
});
