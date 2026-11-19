// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT PAGE OPENS ITS AUDIT WORKBOOK, as the clearance does.
//
// The page cited "the audit workbook" and gave no way to open it. Its export menu now carries the clearance's own
// control, linking the portal's audit route the publisher hands in, and draws nothing when there is no route, as when
// the workbook could not be written. Everything here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "audit-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const page = (auditHref) => renderKnockoutHtml({ batch: { overall: "Slight", executiveSummary: "summary" },
  marks: [{ name: "TARNELLO", rating: "Slight", classesSearched: [9], findings: [] }] }, MANIFEST, { runId: "r1", overall: "Slight", auditHref });
const CONTROL = /<a class="util" href="([^"]*)" download>⬇ Download full audit \(Excel\)<\/a>/;

test("with an audit route the export menu carries the clearance's workbook control, linking it", () => {
  const route = "https://reports.example.test/portal/report/r1/audit.xlsx";
  assert.equal(page(route).match(CONTROL)?.[1], route);
});

test("with no route, or one that is not a web address, no control is drawn", () => {
  for (const href of [null, "", "knockout-audit-r1.xlsx", "javascript:alert(1)"]) {
    assert.doesNotMatch(page(href), /Download full audit/, `a control was drawn for ${JSON.stringify(href)}`);
  }
});
