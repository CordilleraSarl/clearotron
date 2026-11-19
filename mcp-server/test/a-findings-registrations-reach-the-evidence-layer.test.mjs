// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FINDING'S REGISTRATIONS REACH THE EVIDENCE LAYER, WHICHEVER SHAPE THE RUN WROTE. The projection kept only
// string entries, and findings record each registration as its record URI, `{uri}`, so list_evidence told a
// client's assistant that every finding on a current run had no registrations. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceRecords } from "../lib/evidence.mjs";

test("a registration recorded as {uri} and one recorded as a string both reach the record", () => {
  const runDir = mkdtempSync(join(tmpdir(), "evidence-regs-"));
  try {
    writeFileSync(join(runDir, "findings.json"), JSON.stringify({ findings: [
      { ordinal: 1, mark: "QZXV", owner: { name: "Lanternwick Holdings", country: "US", registrations: [{ uri: "/mark/us/90000001" }, { note: "no uri" }] }, source: { source_type: "register" } },
      { ordinal: 2, mark: "SKARVEL", owner: { name: "Brisavel Acoustics", country: "ES", registrations: ["EUTM 018046213"] }, source: { source_type: "register" } },
    ] }));
    const { records } = evidenceRecords({ runDir, P: { audit: join(runDir, "audit.md") } });
    const regs = Object.fromEntries(records.map((r) => [r.mark, r.registrations]));
    assert.deepEqual(regs.QZXV, ["/mark/us/90000001"], "a registration recorded as {uri} was dropped");
    assert.deepEqual(regs.SKARVEL, ["EUTM 018046213"], "a registration recorded as a string changed");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// A FETCHED RECORD READS AS RETRIEVED THROUGH THE FINDING'S REGISTRATION. `retrieved` asked the archive about the
// finding's link alone, so a register finding with no link of its own, whose record the run fetched and saved under its
// registration's URI, told a client's assistant that it rested on the write-up.
test("a register finding whose record was saved under its registration reads as retrieved, with or without a link", () => {
  const runDir = mkdtempSync(join(tmpdir(), "evidence-retrieved-"));
  try {
    mkdirSync(join(runDir, "_records"));
    writeFileSync(join(runDir, "_records", "us-90000001.json"), JSON.stringify({ uri: "/mark/us/90000001", owner: "Lanternwick Holdings" }));
    writeFileSync(join(runDir, "findings.json"), JSON.stringify({ findings: [
      { ordinal: 1, mark: "QZXV", owner: { name: "Lanternwick Holdings", registrations: [{ uri: "/mark/us/90000001" }] }, source: { source_type: "register" } },
      { ordinal: 2, mark: "SKARVEL", owner: { name: "Brisavel Acoustics", registrations: [{ uri: "/mark/us/90000002" }] }, source: { source_type: "register" } },
      { ordinal: 3, mark: "TOLVANE", owner: { name: "Corvel Lighting", registrations: [] }, source: { source_type: "register", resolved_link: "https://records.example.test/mark/us/90000001" } },
    ] }));
    const { records } = evidenceRecords({ runDir, P: { audit: join(runDir, "audit.md") } });
    const retrieved = Object.fromEntries(records.map((r) => [r.mark, r.retrieved]));
    assert.equal(retrieved.QZXV, true, "a record saved under the finding's registration read as not retrieved");
    assert.equal(retrieved.SKARVEL, false, "a registration the run saved no record for read as retrieved");
    assert.equal(retrieved.TOLVANE, true, "a finding's link to a saved record no longer reads as retrieved");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
