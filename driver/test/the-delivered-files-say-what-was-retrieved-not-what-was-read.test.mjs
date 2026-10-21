// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DELIVERED FILES SAY WHAT WAS RETRIEVED, NOT WHAT WAS READ.
//
// The report's Document coverage said that every record holding the register's document had its goods "read as
// written", and the workbook said a retrieved record was "Read from the register record". Holding a record is not
// reading it: on a register whose screen fetches every record's text, every record counts as held, and judging steps
// opened between 1 and 7 percent of them on the saved controls. The owner approved the corrected words (2026-10-18):
// the coverage sentence ends after "carry the document itself", keeping its singular and partial-total forms, and
// the workbook says "Retrieved from the register", "retrieved" in a mixed-country cell, and explains the column as
// whether the register entry itself was retrieved. Nothing else in either file moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDocumentCoverageSection } from "../document-coverage.mjs";
import { retrievedCell } from "../publish/xlsx.mjs";

const OPENING = "**Registry documents were retrieved for this search:**";

test("the coverage sentence says how many records carry the document, and claims no reading", () => {
  const at = (s) => renderDocumentCoverageSection({ findingsOnRecord: null, ...s });
  assert.equal(at({ recordsWithBody: 5, recordsTotal: 5 }), `## Document coverage\n\n${OPENING} 5 records carry the document itself.`);
  assert.equal(at({ recordsWithBody: 1, recordsTotal: 1 }), `## Document coverage\n\n${OPENING} 1 record carries the document itself.`);
  assert.equal(at({ recordsWithBody: 5, recordsTotal: 9 }), `## Document coverage\n\n${OPENING} 5 records of the 9 held for this matter carry the document itself.`);
  for (const n of [1, 5]) assert.doesNotMatch(at({ recordsWithBody: n, recordsTotal: 9 }), /read as written|inferred from their class numbers/);
});

test("the paragraph on findings resting on a retrieved document stays as it was", () => {
  const md = renderDocumentCoverageSection({ recordsWithBody: 5, recordsTotal: 5, findingsOnRecord: 2, findingsTotal: 3 });
  assert.equal(md, `## Document coverage\n\n${OPENING} 5 records carry the document itself. 2 of the 3 findings below rest on wording read from the retrieved document rather than on the class heading alone.`);
  assert.match(renderDocumentCoverageSection({ recordsWithBody: 0 }), /^## Document coverage\n\n\*\*No registry document was retrieved for this search\.\*\*/, "the none case is unchanged");
});

test("the workbook's record column says retrieved, and its explanation says what the column means", async () => {
  const f = (uris) => ({ owner: { registrations: uris.map((u) => ({ uri: u })) } });
  assert.equal(retrievedCell(f(["/mark/ca/1", "/mark/us/2"]), { "/mark/ca/1": "retrieved", "/mark/us/2": "retrieved" }), "Retrieved from the register");
  assert.equal(retrievedCell(f(["/mark/ca/1", "/mark/us/2", "/mark/au/3"]), { "/mark/ca/1": "retrieved", "/mark/us/2": "failed" }), "CA retrieved; US/AU not retrieved");
  assert.equal(retrievedCell(f(["/mark/us/2"]), { "/mark/us/2": "failed" }), "Not retrieved — details unverified", "the missing-record words are kept");
  assert.equal(retrievedCell(f(["/mark/us/2"]), {}), "Not individually retrieved");
  const { summaryRows } = await import("../publish/xlsx.mjs");
  const rows = summaryRows([], [], {}, { mark: "QZORVAK" });
  assert.equal(rows.find((r) => r.Field === "   Record retrieved?")?.Value,
    "whether the register entry itself was retrieved; where a record could not be retrieved, its details are shown unverified.");
});
