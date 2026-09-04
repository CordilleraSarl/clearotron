// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// §11 acceptance 1 — the one-country report is byte-identical under the ladder, AND THE GUARD IS
// SHOWN ABLE TO FAIL.
//
// A comparison that passes because both sides were built the same way proves nothing, so the last arm
// forces the one-country assembly through the graded path and asserts the bytes MOVE. Without it, this
// file would keep passing if `assembleReportMd` ignored its new options entirely.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleReportMd } from "../pipeline.mjs";
import { writeUpForm } from "../write-up-form.mjs";
import { depthFor } from "../search-policy.mjs";

const finding = (ordinal, mark, owner, jx = ["FR"], disposition = "coexistence-partner") => ({
  ordinal, mark, disposition, net: `${mark} sits beside the applied-for mark`,
  band: "Manageable", source: { source_type: "register" },
  owner: { name: owner, registrations: jx.map((j) => ({ jurisdiction: j, classes: ["25"] })) },
});
const FINDINGS = [finding(1, "ACME", "Acme Holdings"), finding(2, "ACMER", "Beta SA"),
  finding(3, "BOREAL", "Boreal SA", ["DE"]), finding(4, "CEDAR", "Cedar Ltd", ["DE"])];

function fixture() {
  const runDir = mkdtempSync(join(tmpdir(), "one-country-"));
  mkdirSync(join(runDir, "cards"), { recursive: true });
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  const P = {
    runDir, report: join(runDir, "report.md"), reportOverview: join(runDir, "overview.md"),
    findings: join(runDir, "findings.json"), reportCardsDir: join(runDir, "cards"),
    reportCard: (ord) => join(runDir, "cards", `${ord}.md`),
  };
  writeFileSync(P.reportOverview, "---\ntitle: t\n---\n\n# Scope\n\nA scope paragraph.\n");
  writeFileSync(P.findings, JSON.stringify({ schema_version: 6, findings: FINDINGS }));
  for (const f of FINDINGS) writeFileSync(P.reportCard(String(f.ordinal)), `### Full detail\n\n- Source: x\n`);
  return P;
}
const build = (P, ordinals, opts) => { assembleReportMd(P, FINDINGS, ordinals, opts); return readFileSync(P.report, "utf8"); };

test("#1503 ONE COUNTRY: every finding is a full card, so the ladder selects the same set", () => {
  const one = depthFor({ product: "full-country-search" });
  const forms = FINDINGS.map((f) => writeUpForm(one, f));
  assert.deepEqual(forms, ["full", "full", "full", "full"],
    "a one-country finding was graded to an entry — the card set moved, and product 4's report with it");
});

test("#1503 the assembled bytes are IDENTICAL to the pre-ladder call on one country", () => {
  const ords = FINDINGS.map((f) => f.ordinal);
  const before = build(fixture(), ords);                                   // the 3-argument call, as it was
  const after = build(fixture(), ords, { grouped: [], byRight: false });   // one country: nothing graded
  assert.equal(after, before,
    "the ladder's options changed the assembled report on a run where nothing is graded. Product 4's "
    + "output may not move, and this is that guarantee at the byte level rather than as an argument.");
  assert.doesNotMatch(after, /# Also on the register/,
    "the grouped section rendered on a one-country report — it has no members there and must be absent, "
    + "not present-and-empty");
});

test("#1503 THE GUARD CAN FAIL — force the graded path and the same bytes move", () => {
  const ords = [FINDINGS[0].ordinal];
  const baseline = build(fixture(), ords);
  const graded = build(fixture(), ords, { grouped: FINDINGS.slice(1), byRight: false });
  assert.notEqual(graded, baseline,
    "forcing three findings through the grouped path produced a byte-identical report. Then the arm "
    + "above passes for the wrong reason: it is comparing two runs of the same code path, and it would "
    + "keep passing if assembleReportMd ignored its options entirely.");
  assert.match(graded, /# Also on the register/, "the graded report must carry the section");
  assert.match(graded, /- \*\*#3 BOREAL\*\*/, "and its members, in the shipped line grammar");
});
