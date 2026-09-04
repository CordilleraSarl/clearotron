// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Fixing a registration number must not make the report undeliverable.
//
// THE DEADLOCK. `autoCorrectRegistry` repairs a wrong registration identifier in `report.md` from the
// canonical record — code fixing what code can prove. But `report.md` is a declared INPUT of the
// client-summary stage (stages.mjs `stageInputs`), so that write moves a sha the delivery freshness gate
// is watching, and the gate blocks: "the report was assembled from material that has since changed".
//
// That is not a delay, it is a dead end. On resume `assembleReportMd` re-runs unconditionally from the
// UNCORRECTED card files, this corrector re-applies the byte-identical fix, the failure signature is
// identical — and `decideRecovery` makes the second identical occurrence `repeat-signature` TERMINAL for
// every class except transient. The client receives nothing, after a fully paid search, because we
// corrected a registration number on their behalf.
//
// Never observed on a delivered report. It needs a run where the lint's `registry-record-match` failure
// fires AND the correction lands — which is why it is worth closing before it happens rather than after.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { writeStamp, stageStaleness, restamp, staleOnPath } from "../stage-freshness.mjs";
import { applyRegistryCorrections } from "../registry-fidelity.mjs";

const runDir = () => { const d = mkdtempSync(join(tmpdir(), "regfresh-")); mkdirSync(driverDir(d), { recursive: true }); return d; };
const write = (p, s) => { writeFileSync(p, s); return p; };

// The record, and a report that misquotes its registration number. Both shapes are copied from
// registry-fidelity.test.mjs rather than invented: `recordsByUri` is a Map keyed by the onomatics URI, and
// the corrector only touches a block whose heading cites that URI. A fixture that drifts from the real
// shape would make every test here pass while correcting nothing, so the first assertion checks the
// fixture still bites before anything else is claimed.
const REC = {
  onomaticsUri: "/mark/us/86272665",
  applicationNumber: "86272665",
  applicationDate: "2014-05-15",
  registrationNumber: "4641314",
  registrationDate: "2014-11-18",
  onomaticsStatus: "Valid",
  corsearchStatusCode: "Registered",
};
const RECORDS = new Map([["/mark/us/86272665", REC]]);
const REPORT_WRONG = "---\ntype: prelim-clearance\n---\n\n# Marks\n"
  + "## H-1 — SATIN & BRONZE ([record](/mark/us/86272665))\n"
  + "US application 86272665, Reg. No. 4,349,603, registered 2013.\n";

test("THE DEADLOCK, REPRODUCED: correcting the report strands the delivery gate", () => {
  // Without the restamp this is what happens, and it is why the fix is not cosmetic.
  const d = runDir();
  const report = write(join(d, "report.md"), REPORT_WRONG);
  writeStamp(d, "client-summary", [report]);
  assert.equal(stageStaleness(d, "client-summary", [report]).stale, false, "fresh before the correction");

  const { text, corrections } = applyRegistryCorrections(readFileSync(report, "utf8"), RECORDS);
  assert.ok(corrections.length > 0, "the corrector has something to fix (fixture still valid)");
  writeFileSync(report, text);

  assert.equal(stageStaleness(d, "client-summary", [report]).stale, true,
    "the correction reads as staleness — this is the block that has no way out");
  assert.ok(staleOnPath(d, ["client-summary"], () => [report]).length > 0, "and it is on the delivery path");
  rmSync(d, { recursive: true, force: true });
});

test("THE FIX: restamping the corrected file settles it, without a pointless re-draft", () => {
  const d = runDir();
  const report = write(join(d, "report.md"), REPORT_WRONG);
  writeStamp(d, "client-summary", [report]);

  const { text } = applyRegistryCorrections(readFileSync(report, "utf8"), RECORDS);
  writeFileSync(report, text);
  assert.equal(restamp(d, report), 1, "one stamp touched");

  assert.equal(stageStaleness(d, "client-summary", [report]).stale, false, "delivery is no longer blocked");
  assert.match(readFileSync(report, "utf8"), /4,641,314/, "and the correction is still IN the report");
  assert.doesNotMatch(readFileSync(report, "utf8"), /4,349,603/, "the wrong number is gone");
  rmSync(d, { recursive: true, force: true });
});

test("it does NOT blind the gate to material that genuinely moved", () => {
  // The whole point of the gate. Restamping is scoped to the file the corrector touched; anything else
  // changing underneath still blocks, because that is a report assembled from material that really has
  // moved on.
  const d = runDir();
  const report = write(join(d, "report.md"), REPORT_WRONG);
  const findings = write(join(d, "findings.json"), `{"findings":[{"ord":1}]}`);
  writeStamp(d, "client-summary", [report, findings]);

  const { text } = applyRegistryCorrections(readFileSync(report, "utf8"), RECORDS);
  writeFileSync(report, text);
  restamp(d, report);
  assert.equal(stageStaleness(d, "client-summary", [report, findings]).stale, false, "the correction alone is settled");

  write(findings, `{"findings":[{"ord":1},{"ord":2}]}`);   // a real upstream change
  assert.equal(stageStaleness(d, "client-summary", [report, findings]).stale, true,
    "a genuinely changed input still blocks — the gate keeps its job");
  rmSync(d, { recursive: true, force: true });
});

test("THE CALL SITE EXISTS — the corrector restamps what it wrote", () => {
  // The two tests above pin the MECHANISM, which already worked; this pins that autoCorrectRegistry
  // actually uses it. Deleting the restamp call is precisely how this defect comes back, and without
  // this assertion every test in this file would still pass while the run died in production.
  const src = readFileSync(fileURLToPath(new URL("../pipeline.mjs", import.meta.url)), "utf8");
  const fn = src.slice(src.indexOf("const autoCorrectRegistry = ()"));
  const body = fn.slice(0, fn.indexOf("\n      };"));
  assert.ok(body.includes("writeFileSync(file, after)"), "found the corrector's write (anchor still valid)");
  // Matched WITHOUT the closing paren so the call may carry options ( added a projection hook) —
  // the thing being pinned is that the corrector restamps what it wrote, not the argument count.
  assert.ok(/restamp\(run\.runDir, file[,)]/.test(body),
    "autoCorrectRegistry must restamp the file it just rewrote, or the delivery gate deadlocks the run");
});

test("autoCorrectClientTiers is deliberately NOT restamped — it cannot strand anything", () => {
  // Worth pinning as a non-goal, because it looks like an omission. `client-summary.md` is not a declared
  // input of any stage in the stageInputs map, so rewriting it moves no watched sha. Adding a restamp
  // there would be cargo-cult; if client-summary.md ever BECOMES a declared input, this test fails and
  // whoever made that change gets told to look here.
  const stages = readFileSync(fileURLToPath(new URL("../stages.mjs", import.meta.url)), "utf8");
  const map = stages.slice(stages.indexOf("stageInputs"));
  const declared = map.slice(0, map.indexOf("\n}"));
  assert.ok(!/P\.clientSummary/.test(declared),
    "client-summary.md is not a stage input — if that changed, autoCorrectClientTiers now needs a restamp too");
});
