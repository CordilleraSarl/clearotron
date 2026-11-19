// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FINDING'S REGISTRATIONS REACH THE EVIDENCE LAYER, WHICHEVER SHAPE THE RUN WROTE. The projection kept only
// string entries, and findings record each registration as its record URI, `{uri}`, so list_evidence told a
// client's assistant that every finding on a current run had no registrations. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

