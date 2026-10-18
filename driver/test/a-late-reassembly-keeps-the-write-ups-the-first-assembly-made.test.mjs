// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the report's reassembly after a late save, on invented records and files
//
// A LATE REASSEMBLY KEEPS THE WRITE-UPS THE FIRST ASSEMBLY MADE.
//
// On a graded product the first assembly gives each finding one of three write-ups: a full card, a short entry
// composed by code from the finding's own sentence, or a line in the grouped section. When a synthesis save after
// the cards moved the record, the delivery check's repair reassembled the report from every finding owed prose, with
// no grouped section: the report lost its "Also on the register" section, where the grouped findings are read by
// territory or by right, and each short entry kept the text composed from the record as it was before the save.
//
// Now the repair plans the write-ups from the record as it stands, the same way the first assembly does, composes the
// short entries again, and assembles with the grouped section. On a product that grades nothing, every finding owed
// prose is a full card, and the reassembly is byte for byte what it was.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../stages.mjs";
import { depthFor } from "../search-policy.mjs";
import { assembleReportMd, fullProseOrdinals, planWriteUps, reassembleFromTheRecord } from "../pipeline.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const MULTI = depthFor({ product: "multi-country-focus-search" });
const ONE = depthFor({ product: "full-country-search" });

// One conflict in the way, two more registered in one territory, and one in another: a full card, a grouped pair
// and a short entry on a multi-country product.
const ROWS = [
  ["Halvorne Works", "TESSARIN", "adversarial", "US"],
  ["Quillmere Ltd", "ODRAVEL", "distinguished", "GB"],
  ["Pennick Supply", "MARVETTE", "distinguished", "GB"],
  ["Brannick Tooling", "ORVANTE", "distinguished", "FR"],
];
function findings() {
  const base = JSON.parse(synthesisFindings(null)).findings[0];
  return ROWS.map(([owner, mark, disposition, jurisdiction], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.disposition = disposition;
    f.owner.registrations[0].uri = `/mark/us/9300000${i + 1}`;
    f.owner.registrations[0].jurisdiction = jurisdiction;
    f.net = `The invented finding sentence for ${mark}.`;
    return f;
  });
}

/** A run folder holding the record, the overview and the one full card the cards stage wrote. */
function run(list) {
  const dir = mkdtempSync(join(tmpdir(), "late-reassembly-"));
  dirs.push(dir);
  const P = paths(dir);
  mkdirSync(P.reportCardsDir, { recursive: true });
  writeFileSync(P.findings, JSON.stringify({ ...JSON.parse(synthesisFindings(null)), findings: list }, null, 2));
  writeFileSync(P.reportOverview, "---\ntitle: An invented matter\n---\n\n# Actions\n\nThe invented overview of the matter.\n");
  writeFileSync(P.reportCard("1"), "### Full detail\n\n- **Filing:** The invented card for TESSARIN.\n");
  return P;
}
const report = (P) => readFileSync(P.report, "utf8");
// The grouped section, as the first assembly writes it: its heading, then a line for each grouped finding.
const grouped = (md) => (md.split(/^# /m).find((s) => s.startsWith("Also on the register")) ?? "");

test("the plan gives a multi-country record a full card, a grouped pair and a short entry", () => {
  const plan = planWriteUps(findings(), MULTI, null);
  assert.deepEqual(plan.cardOrdinals, [1]);
  assert.deepEqual(plan.groupedMembers.map((f) => f.ordinal).sort(), [2, 3]);
  assert.deepEqual(plan.entrySingles.map((f) => f.ordinal), [4]);
  assert.deepEqual(plan.assembledOrdinals, [1, 4]);
});

test("after a late save, the reassembly keeps the grouped lines and the short entry the first assembly made", () => {
  const P = run(findings());
  reassembleFromTheRecord(P, findings(), MULTI);
  const first = report(P);
  for (const mark of ["ODRAVEL", "MARVETTE"]) assert.match(grouped(first), new RegExp(`\\*\\*#[23] ${mark}\\*\\*`), `premise: ${mark} is a grouped line`);
  assert.ok(first.includes("### In short\n\nRegistered in FR."), "premise: ORVANTE is a short entry");
  // the call the repair made before: every finding owed prose, and no grouped section
  assembleReportMd(P, findings(), fullProseOrdinals(findings()));
  assert.equal(grouped(report(P)), "", "the earlier call kept the grouped section");
  reassembleFromTheRecord(P, findings(), MULTI);
  assert.equal(report(P), first, "the reassembly is not the report the first assembly made");
});

test("after a late save that changes a short entry's sentence, the reassembled report carries the new sentence", () => {
  const P = run(findings());
  reassembleFromTheRecord(P, findings(), MULTI);
  const changed = findings();
  changed[3].net = "The corrected invented finding sentence for ORVANTE.";
  writeFileSync(P.findings, JSON.stringify({ ...JSON.parse(synthesisFindings(null)), findings: changed }, null, 2));
  // the call the repair made before composed no short entry, so it kept the one written before the save
  assembleReportMd(P, changed, fullProseOrdinals(changed));
  assert.ok(report(P).includes("### In short\n\nRegistered in FR. Class 9.\n\nThe invented finding sentence for ORVANTE."),
    "premise: the earlier call did not keep the short entry from before the save");
  reassembleFromTheRecord(P, changed, MULTI);
  assert.ok(report(P).includes("The corrected invented finding sentence for ORVANTE."), "the short entry does not carry the corrected sentence");
  assert.ok(!report(P).includes("The invented finding sentence for ORVANTE."), "the short entry still carries the sentence from before the save");
});

test("on a product that grades nothing, the reassembly is byte for byte the call the repair made before", () => {
  const P = run(findings());
  writeFileSync(P.reportCard("2"), "### Full detail\n\n- **Filing:** The invented card for ODRAVEL.\n");
  assert.deepEqual(planWriteUps(findings(), ONE, null).cardOrdinals, [1, 2, 3, 4], "premise: every finding owed prose is a full card");
  assembleReportMd(P, findings(), fullProseOrdinals(findings()));
  const before = report(P);
  reassembleFromTheRecord(P, findings(), ONE);
  assert.equal(report(P), before);
});
