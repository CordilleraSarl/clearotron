// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT PAGE OPENS ITS AUDIT WORKBOOK, as the clearance does.
//
// The page cited "the audit workbook" and gave no way to open it. Its export menu now carries the clearance's own
// control, linking the portal's audit route the publisher hands in. A page published with no public address, as the
// demo is, links the workbook by its file name beside the page, as the clearance's control does. A run with no
// workbook, as when it could not be written, draws no control. Everything here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "audit-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const page = (auditHref, auditFile = null) => renderKnockoutHtml({ batch: { overall: "Slight", executiveSummary: "summary" },
  marks: [{ name: "TARNELLO", rating: "Slight", classesSearched: [9], findings: [] }] }, MANIFEST, { runId: "r1", overall: "Slight", auditHref, auditFile });
const CONTROL = /<a class="util" href="([^"]*)" download>⬇ Download full audit \(Excel\)<\/a>/;

test("with an audit route the export menu carries the clearance's workbook control, linking it", () => {
  const route = "https://reports.example.test/portal/report/r1/audit.xlsx";
  assert.equal(page(route).match(CONTROL)?.[1], route);
  assert.equal(page(route, "knockout-audit-r1.xlsx").match(CONTROL)?.[1], route, "the route gave way to the file name");
});

test("with no route, the control links the workbook beside the page by its file name", () => {
  assert.equal(page(null, "knockout-audit-r1.xlsx").match(CONTROL)?.[1], "knockout-audit-r1.xlsx");
  // the route is a web address or nothing: a file name handed in as the route is not a link
  assert.equal(page("knockout-audit-r1.xlsx", "knockout-audit-r1.xlsx").match(CONTROL)?.[1], "knockout-audit-r1.xlsx");
});

test("with no route and no workbook, or an address that is not a link, no control is drawn", () => {
  for (const [href, file] of [[null, null], ["", ""], ["knockout-audit-r1.xlsx", null], ["javascript:alert(1)", null], [null, "javascript:alert(1)"], [null, "//elsewhere.example/a.xlsx"]]) {
    assert.doesNotMatch(page(href, file), /Download full audit/, `a control was drawn for ${JSON.stringify([href, file])}`);
  }
});
