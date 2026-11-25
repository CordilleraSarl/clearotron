// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the fold at the delivery seam, on invented records
//
// A COVERAGE ROW IS READ IN THE WRITER'S NUMBERING.
//
// An open coverage row citing a finding the review withdrew goes to the writer's repair. The row is the writer's prose,
// and the delivery seam's fold renumbers the findings, the actions and the four answers but copies the rows as written.
// Judged against the folded record, a row naming the writer's finding 4 read as citing a finding the run lacks, and one
// naming a live finding 3 read as citing the withdrawn finding the fold had moved to 3: the writer would have been told
// the review withdrew a finding it never withdrew. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldRecord } from "../record-fold.mjs";
import { runLint } from "../predelivery-lint.mjs";
import { writersCitationFaults } from "../repair-targets.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

/** A record whose findings are `[owner, mark, disposition]`, each on its own registration. */
function record(rows) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, findings: rows.map(([owner, mark, disposition], i) => {
    const f = structuredClone(base);
    Object.assign(f, { ordinal: i + 1, mark, disposition: disposition ?? f.disposition });
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9300000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    return f;
  }) };
}
// The second finding is a second filing of the first, so the fold keeps three: 1 and 2 become 1, 3 becomes 2, 4 becomes 3.
const WRITTEN = record([["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"],
  ["Selmora Labs", "KESTRIN", "withdrawn"]]);
const ROWS = [
  { area: "Selmora Labs — prior position", state: "open", note: "The position in finding 4 remains unresolved." },
  { area: "Brannick Tooling — use evidence", state: "open", note: "Use evidence for finding 3 was not reached." },
];

test("a row citing the writer's withdrawn finding is found in the writer's numbering, and a row citing a live one is not", () => {
  const { doc: folded, map } = foldRecord(WRITTEN);
  assert.ok(map, "the scenario folds");
  assert.equal(folded.findings.length, 3);
  assert.deepEqual(folded.coverage, WRITTEN.coverage, "the fold copies the coverage rows as written");
  const lint = runLint({ reportMd: "# Report\n", findings: folded.findings, narrativeFindings: WRITTEN.findings, coverageRegister: ROWS });
  const c = lint.checks.find((x) => x.id === "coverage-citations");
  assert.equal(c?.pass, false);
  assert.deepEqual(c.cites.map((x) => [x.row, x.ordinal, x.withdrawn]), [[0, 4, true]],
    "judged in the folded numbering, finding 4 read as absent and the live finding 3 as withdrawn");
  const lines = writersCitationFaults(c, (o) => ({ 3: 4, 2: 3, 1: 1 })[o] ?? null);
  assert.deepEqual(lines.map((l) => l.detail), ["Your text cites finding 4, which the review withdrew. Remove that citation. "
    + "Check the affected statement against the surviving assessment, and correct or remove it if unsupported. Keep unaffected text unchanged."],
    "the number reached the writer mapped as if it were in the folded numbering");
});

test("with no fold in force the delivered record is the writer's, and is read as before", () => {
  const lint = runLint({ reportMd: "# Report\n", findings: WRITTEN.findings, coverageRegister: ROWS });
  assert.deepEqual(lint.checks.find((x) => x.id === "coverage-citations").cites.map((x) => [x.row, x.ordinal, x.withdrawn]), [[0, 4, true]]);
});
