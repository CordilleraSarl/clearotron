// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE TABLE IN driver/doc-constants.mjs BINDS A DOC'S FIGURE TO THE CONSTANT IT RESTATES, AND NOTHING RAN IT.
//
// CONTRIBUTING.md and the table's own header both say a test fails CI when a shipping doc and a constant
// disagree. No test read `DOC_CONSTANTS` (found 2026-11-04, when all 28 rows were run by hand and passed),
// so a moved constant or a deleted sentence went unnoticed. This is that test, one arm per row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_CONSTANTS, checkRestatement } from "../doc-constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("the table holds rows, so the arms below are not a loop over nothing", () => {
  assert.ok(DOC_CONSTANTS.length >= 28, `only ${DOC_CONSTANTS.length} rows; a row retired on purpose lowers this number with it`);
});

for (const row of DOC_CONSTANTS) {
  test(`${row.doc} quotes ${row.constant}`, () => {
    // A row names a file in driver/ by its bare name, and one outside it from the repository's root.
    assert.ok([ROOT, join(ROOT, "driver")].some((d) => existsSync(join(d, row.source.file))),
      `the row names a source that is gone: ${row.source.file}`);
    const r = checkRestatement(row, read(row.doc));
    assert.ok(r.ok, r.reason === "stale"
      ? `${row.doc}:${r.line} says ${r.found}, and ${row.source.symbol} in ${row.source.file} says ${r.expected}`
      : `${row.doc} no longer restates ${row.constant}. Keep the sentence on one line, or retire its row on purpose`);
  });
}

test("the check tells a wrong figure from a deleted sentence", () => {
  const row = DOC_CONSTANTS[0];
  const text = read(row.doc);
  const good = checkRestatement(row, text);
  assert.ok(good.ok, "the control: the real doc passes");
  const m = row.pattern.exec(text);
  const wrong = text.slice(0, m.index) + m[0].replace(m[1], "not-the-figure") + text.slice(m.index + m[0].length);
  // A pattern that accepts only digits refuses the plant outright, which reads as a deleted sentence; both refuse.
  assert.equal(checkRestatement(row, wrong).ok, false, "a changed figure passed");
  const gone = checkRestatement(row, text.slice(0, m.index) + text.slice(m.index + m[0].length));
  assert.equal(gone.reason, "absent", "a deleted sentence did not read as absent");
});
