// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engagement-receipt — R.1 reasoning-integrity primitive #3. A NON-BLOCKING presence receipt over narrative.md:
// does each Composite≥3 finding cite any of its own anchors? Observability only (Goodhart guard): it
// records, it never gates. Pure: empty input → [], never throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findEngagementReceipts } from "../engagement-receipt.mjs";

const ANCHORS = {
  owners: ["plesner advokatpartnerselskab"],
  classes: ["9", "41"],
  dominantElements: ["lumengarde", "ever", "light"],
  marks: ["lumengarde"],
  jurisdictions: ["eu"],
  sector: "lighting",
  goodsServices: ["led lighting fixtures"],
};

const NARRATIVE = `# Joint synthesis

## Finding 1 — LUMENGARDE (Plesner)
**Composite — 4 (High).** The LUMENGARDE registration owned by Plesner in class 9 is the headline conflict.

## Finding 2 — DARKMODE (unrelated)
**Composite — 3 (Medium).** A generic unrelated mark with no field connection at all.

## Finding 3 — SPARK
**Composite — 2 (Manageable).** Low concern, below the receipt threshold.

## Actions
Composite scores above should be confirmed with the client.
`;

test("receipts: Composite≥3 findings only; cites-anchor flagged per finding", () => {
  const r = findEngagementReceipts(NARRATIVE, ANCHORS);
  assert.equal(r.length, 2, "Finding 3 (Composite 2) and the Actions block are excluded");
  const byOrd = Object.fromEntries(r.map((x) => [x.finding.split("—")[0].trim(), x]));
  const f1 = byOrd["Finding 1"], f2 = byOrd["Finding 2"];
  assert.equal(f1.composite, 4);
  assert.equal(f1.citesOwnAnchor, true);
  assert.ok(f1.anchorsHit.includes("lumengarde") || f1.anchorsHit.includes("plesner") || f1.anchorsHit.includes("class-mention"));
  assert.equal(f2.composite, 3);
  assert.equal(f2.citesOwnAnchor, false, "no field anchor cited → flagged for Alex");
  assert.deepEqual(f2.anchorsHit, []);
});

test("receipts: the Actions paraphrase never counts as a finding", () => {
  const r = findEngagementReceipts(NARRATIVE, ANCHORS);
  assert.ok(!r.some((x) => /Actions/.test(x.finding)));
});

test("receipts: pure — empty/garbled input → [], never throws; no anchors → cites:false", () => {
  assert.deepEqual(findEngagementReceipts("", ANCHORS), []);
  assert.deepEqual(findEngagementReceipts(null, ANCHORS), []);
  let r;
  assert.doesNotThrow(() => { r = findEngagementReceipts("## Finding 1 — X\n**Composite — 5.** text", {}); });
  assert.equal(r.length, 1);
  assert.equal(r[0].citesOwnAnchor, false, "no anchors supplied → nothing to cite");
  assert.doesNotThrow(() => findEngagementReceipts(NARRATIVE));
});
