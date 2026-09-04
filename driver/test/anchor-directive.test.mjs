// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The evidence order lives in ONE place, and both composers serve the same order. ( split the
// ordered field into a locator and a proof; the one-definition property is unchanged.)
//
// THESE TESTS PIN THE INTENT, NOT THE WORDING, and that is deliberate. A test asserting the exact
// sentence would be a change-detector: it would go red on an honest rewrite and stay green on the
// defect it exists to prevent, which is precisely what 's test did for weeks before anyone read it.
// So what is asserted here is the three properties the sentence must have, and one property of the
// codebase — that there is only one of it.
//
// THE MEASURED DEFECT. The brief gives the meaning seat four fields. Three were imperatives and were
// written on 74 of 74 rows. The fourth read "a row marked `quote_required` also WANTS `anchor`" — the
// only one phrased as a property of the row rather than an order to the seat, the only one that never
// said what happens if it is skipped, and the only one written zero times: 0 of 9 attempt-1 anchors
// across every run reachable, each written promptly once a failure message demanded it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderConnotationObligations, meaningSweepReceiptsInstruction } from "../connotation-search.mjs";

const OB = {
  queries: [{ query: "a meaning query", results: [{ id: "R-AAAA1111", title: "t", url: "https://e.test/1", snippet: "x".repeat(200) }] }],
  recurrent: [],
  floor: 1,
};
const served = () => [
  String(renderConnotationObligations(OB, { dispositionsPath: "/run/common-law-dispositions.half-m.json" })),
  String(meaningSweepReceiptsInstruction("/run/common-law-dispositions.half-m.json", { half: "m" })),
];

test("both composers serve the evidence order, and neither serves it as a preference", () => {
  // — the ordered field became TWO (`segment_index` + `fragment`), and 's property is unchanged
  // by that: whatever is ordered must be ordered as an IMPERATIVE, in BOTH composers. The 0-of-9 defect
  // was phrasing a required field as something the row "wants".
  for (const text of served()) {
    for (const field of ["segment_index", "fragment"]) {
      assert.doesNotMatch(text, new RegExp(`\\b(?:also\\s+)?wants?\\s+\`?${field}\`?`, "i"),
        `\`${field}\` must not be described as something a row wants — that phrasing was written 0 of 9 times`);
      assert.match(text, new RegExp(`\\b(?:set|write|give|supply|copy)\\b[^.]{0,200}\`${field}\`|\`${field}\`[^.]{0,200}\\b(?:set|write|give|supply|copy)\\b`, "i"),
        `\`${field}\` must be carried by an imperative, like the three fields that are written 74 of 74`);
    }
    // AND THE RETIRED ORDER IS GONE FROM BOTH. A dictation is a code path: leaving the anchor sentence
    // beside its replacement would keep a seat choosing between an order that works and one that cannot.
    assert.doesNotMatch(text, /`anchor`/,
      "the retired order must be deleted in the same change, not left beside its replacement");
  }
});

test("the order states a consequence — the omission that was never priced", () => {
  for (const text of served()) {
    assert.match(text, /\bnot\s+counted\s+as\s+ruled\b|\bfails?\s+while\s+any\s+remain\b/i,
      "the seat must be told what happens if the anchor is absent; the old text never said");
  }
});

test("the consequence is TRUE — it does not claim the ordered route is the only accepted one", () => {
  // `spotCheckBinds` also accepts a seat-typed `quote` that binds — the route archived and replay forms
  // travel. A stronger sentence ("you MUST point or the row fails") would be false there, and a composer
  // that ships a falsehood is the exact fault the surrounding work is correcting. Still true under:
  // the ORDER is one shape, and the PARSER still reads the archived ones.
  for (const text of served()) {
    assert.doesNotMatch(text, /only\s+way|the\s+only\s+field|must\s+(?:write|give|supply)\s+a\s+`?(?:fragment|segment_index)`?\s+or\b/i,
      "pointing is the ordered route, not the only accepted one — do not tell the seat otherwise");
  }
});

test("ONE definition: the two composers cannot drift apart", () => {
  const [a, b] = served();
  // Both are built from the same constant, so the whole directive appears verbatim in each. Asserted on
  // a distinctive interior span rather than the full block, so reflowing the lines does not fail this —
  // the property is "identical in both", not "formatted this way".
  const span = "The number says WHICH passage; the characters show you read it";
  assert.ok(a.includes(span), "the obligations brief serves it");
  assert.ok(b.includes(span), "the receipts instruction serves it");

  // And the sentence that carries the consequence, likewise in both.
  const owed = "not counted as ruled";
  assert.ok(a.includes(owed) && b.includes(owed),
    "fixed-at-one-composer-forgotten-at-the-other is the defect class this change belongs to");
});
