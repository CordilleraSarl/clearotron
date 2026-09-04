// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// case B — a fail token declared three rows, named two, and elided the third:
//
//   quote_unbound:quote_unbound=3;<row-1> missing,<row-2> missing (+1 more)
//
// The elided row is the only one a fixer would need. As in case A the surviving text reads as complete:
// a consumer counting names gets 2, a consumer reading the declared count gets 3, and neither can tell.
//
// The cause was not the budget. The loop broke on the PROSPECTIVE next entry and never charged
// ` (+N more)` against the budget at all — so a list that fit could still lose a member, and then spend
// ten characters saying so. That is the property under test here: ELIDING MUST BUY SPACE.

import test from "node:test";
import assert from "node:assert/strict";

import { boundedSample, SAMPLE_BUDGET } from "../verify.mjs";

/** The reported case: three rows, realistic row-id lengths, no query bracket. */
const THREE = [
  "conn-row-0f3a91c4-6b2e-4d18-9a77-c1e5 [thistle connotation in Hebrew] missing",
  "conn-row-7c40de52-19bb-42a6-8f03-2d91 [thistle connotation in Arabic] missing",
  "conn-row-a81f6b03-5e77-4c90-b2de-98aa [thistle connotation in Greek] missing",
];

test("#1126 THE REPORTED CASE: three rows that fit are all three named", () => {
  const out = boundedSample(THREE);
  assert.ok(out.length <= SAMPLE_BUDGET, `it fits: ${out.length} <= ${SAMPLE_BUDGET}`);
  assert.equal(out.includes("more)"), false, "nothing was elided, so nothing announces an elision");
  for (const row of THREE) assert.ok(out.includes(row), `${row} must be named`);
  assert.equal(out.split(",").length, 3, "and the count of names equals the count of rows");
});

test("#1126 THE PREDECESSOR, MEASURED — its break test was right and its budget was too small", () => {
  // Reproduced exactly, because the obvious reading of this issue is wrong and the commit says so.
  // `len + e.length > 150` is, precisely, "the joined list would exceed 150": `len` after k entries is
  // sum+k, and the joined length after k+1 is sum+k too. It never dropped an entry that fit.
  const old = (rows) => {
    const entries = []; let listed = 0, len = 0;
    for (const e of rows) {
      if (len + e.length > 150 && listed) break;
      entries.push(e); listed += 1; len += e.length + 1;
    }
    const overflow = rows.length - listed;
    return `${entries.join(",")}${overflow > 0 ? ` (+${overflow} more)` : ""}`;
  };
  // So the defect is not the arithmetic — it is that 150 cannot hold a three-row census, which is the
  // census this token actually reports.
  assert.ok(THREE.join(",").length > 150, `three labelled rows are ${THREE.join(",").length} characters`);
  assert.match(old(THREE), / \(\+2 more\)$/, "at 150 only the FIRST row is named — two of three dropped");
  assert.equal(boundedSample(THREE).includes("more)"), false, "at 300 it is named");

  // The one real arithmetic fault, small and worth closing: the marker was appended OUTSIDE the budget,
  // so the value could exceed the bound the loop was enforcing.
  // 49-character entries, so the predecessor fills to 149 and then appends its marker on top.
  const wide = Array.from({ length: 40 }, (_, i) => `row-${String(i).padStart(3, "0")}-${"a".repeat(41)}`);
  assert.ok(old(wide).length > 150, `the predecessor overshoots its own budget: ${old(wide).length}`);
  assert.ok(boundedSample(wide, 150).length <= 150, "the marker is inside the budget now");
});

test("#1126 when the list genuinely does not fit, the marker is COUNTED", () => {
  const many = Array.from({ length: 12 }, (_, i) => `conn-row-${String(i).padStart(4, "0")}-aaaa-bbbb-cccc missing`);
  const out = boundedSample(many);
  assert.ok(out.length <= SAMPLE_BUDGET, `the budget is a real bound: ${out.length}`);
  assert.match(out, / \(\+(\d+) more\)$/, "and the omission is declared");
  const omitted = Number(/ \(\+(\d+) more\)$/.exec(out)[1]);
  assert.equal(out.split(" (+")[0].split(",").length + omitted, many.length,
    "named + omitted must equal the population — the count and the names cannot disagree");
});

test("#1126 at least one entry is always named, however long the entries are", () => {
  // A token that named nothing would push the whole diagnosis into a count: the purest form of the
  // defect this file is about.
  const huge = [ "x".repeat(400), "y".repeat(400), "z".repeat(400) ];
  const out = boundedSample(huge);
  assert.ok(out.startsWith("x".repeat(400)), "the first entry survives even when it alone blows the budget");
  assert.equal(out, `${"x".repeat(400)} (+2 more)`, "and the rest are counted rather than silently gone");
});

test("#1126 the boundary is exact — a list that fits by one character is not elided", () => {
  const budget = 20;
  assert.equal(boundedSample(["abcd", "efghijklmnopq"], budget), "abcd,efghijklmnopq", "18 chars, fits");
  const over = boundedSample(["abcd", "efghijklmnopqrstuv"], budget);
  assert.ok(over.length <= budget, `${over} is within ${budget}`);
  assert.equal(over, "abcd (+1 more)");
});

test("#1126 an empty population is an empty string, not a marker for nothing", () => {
  assert.equal(boundedSample([]), "");
  assert.equal(boundedSample(["only"]), "only");
});
