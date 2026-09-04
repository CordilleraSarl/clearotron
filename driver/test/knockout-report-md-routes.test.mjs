// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — report.md names the documents it summarises.
//
// The defect was reported as "no register count reaches the report" and that was false: report.html
// carries the counts, and "Register search pending" appears zero times in any delivered file. The real
// defect was thinner and only visible on a MULTI-MARK run — there is no `report.html` there at all, the
// documents are `report-<slug>.html` one per mark, and report.md (the only file naming every mark
// together) said nothing about them. A reader who looked for the conventional filename found nothing.
//
// So these assertions are about a ROUTE, and one of them is about what must NOT appear: the counts are
// rendered once, in the documents, and a summary restating a number it does not compute is the next
// thing to go stale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { knockoutDocumentRoutes } from "../publish/knockout.mjs";

const MULTI = [
  { mark: "CORAL FREEZE", slug: "coral-freeze", file: "report-coral-freeze.html", band: "Medium" },
  { mark: "CINDER LANTERN", slug: "cinder-lantern", file: "report-cinder-lantern.html", band: "Manageable" },
];

test("#706 a multi-mark summary names EVERY per-mark document by its real filename", () => {
  const out = knockoutDocumentRoutes(MULTI, { auditFile: "knockout-audit-mockrun.xlsx" }).join("\n");
  // The exact names, because the defect was that a reader could not learn these files exist. A generic
  // "see the individual reports" would leave the same reader in the same place.
  assert.match(out, /report-coral-freeze\.html/);
  assert.match(out, /report-cinder-lantern\.html/);
  assert.match(out, /CORAL FREEZE/);
  assert.match(out, /CINDER LANTERN/);
  assert.match(out, /knockout-audit-mockrun\.xlsx/, "and the workbook, which holds the receipts");
});

test("#706 it says there is NO combined report, because that is the fact that surprised a reader", () => {
  const out = knockoutDocumentRoutes(MULTI).join("\n");
  assert.match(out, /no combined report/i);
  assert.match(out, /only place the marks appear together/i);
});

test("#706 the counts are NOT restated here — they are rendered once, in the documents", () => {
  const out = knockoutDocumentRoutes(MULTI, { auditFile: "a.xlsx" }).join("\n");
  assert.ok(!/\d+\s+identical/.test(out), "no counts sentence");
  assert.ok(!/\d+\s+containing/.test(out));
  assert.ok(!/Register search pending/.test(out), "and never the workbook-only estimate wording");
});

test("#706 a single-mark run points at its one document and does not talk about others", () => {
  const out = knockoutDocumentRoutes([MULTI[0]], { auditFile: "a.xlsx" }).join("\n");
  assert.match(out, /report-coral-freeze\.html/);
  assert.match(out, /in that document/);
  assert.ok(!/no combined report/i.test(out), "there is nothing to combine — the sentence would be noise");
});

test("#706 NO DOCUMENTS ⇒ NO SECTION — an empty heading would assert an absence it cannot explain", () => {
  // The silent-absence rule, at the one place this composer can produce one: a "## Documents" heading
  // over an empty list reads as "there are none", which is a claim. Returning nothing makes no claim.
  assert.deepEqual(knockoutDocumentRoutes([]), []);
  assert.deepEqual(knockoutDocumentRoutes(null), []);
  assert.deepEqual(knockoutDocumentRoutes(undefined), []);
  assert.deepEqual(knockoutDocumentRoutes([{ mark: "X", band: "Low" }]), [],
    "a row with no FILE is not a document — it cannot be routed to");
});

test("#706 the audit workbook line is omitted when there is no workbook, not printed empty", () => {
  const out = knockoutDocumentRoutes(MULTI).join("\n");
  assert.ok(!/audit workbook/.test(out));
  assert.ok(!/undefined|null/.test(out), "and no placeholder leaks into a delivered file");
});

test("#706 a band-less document still routes — the route is not gated on the rating", () => {
  const out = knockoutDocumentRoutes([{ mark: "NO BAND", file: "report-no-band.html", band: null }]).join("\n");
  assert.match(out, /report-no-band\.html/);
  assert.match(out, /NO BAND/);
  assert.ok(!/— null|— undefined/.test(out));
});
