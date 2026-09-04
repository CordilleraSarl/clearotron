// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
//, T3b — THE CORRECTIVE WORKLIST'S SOURCE.
//
// `correctionsExtra` built its worklist with `parseCorrections(review)` — re-reading the document the
// driver had just RENDERED from the reviewer's typed values. Its own comment claimed "the flags arrive as
// a typed worklist"; they arrived as prose that was parsed back into rows.
//
// That is the exact parse conversion 9 removed the need for. A flag the parse misses is a defect the
// reviewer named and the corrective pass never sees — and the parse CAN miss, which is why the seat stopped
// choosing the enumeration style in the first place ('s lettered flags were invisible; records
// a second walk that could not see `**1.`).
//
// ── HOW THESE ARMS PROVE THE SOURCE, RATHER THAN THE OUTCOME ────────────────────────────────────────
//
// A test that records a call and checks the worklist contains its flags passes under BOTH sources — the
// document renders from the same values, so both agree. The discriminator is to make them DISAGREE: write
// an accepted call, then tamper with the rendered document so the parse would return something different.
// Whatever the worklist then carries names which source it read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordRefutation, readAcceptedFlags } from "../narrative-refutation-record.mjs";
import { parseCorrections } from "../verify.mjs";
import { correctionsExtra } from "../pipeline.mjs";
import { paths as stagePaths } from "../stages.mjs";

const FLAGS = [
  { kind: "fact", on: [9], text: "narrative.md states 1 March 2011; the fetched record reads 25 February 2011." },
  { kind: "rating", on: [6, 12], text: "both marks are rated MANAGEABLE against an identical-goods overlap." },
  { kind: "narrative", text: "the summary leads with the clean axis." },
];

const withRun = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "t3b-source-"));
  try { return fn(dir, stagePaths(dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("#1889 T3b: the worklist reads the CALL — a tampered document does not change it", () => {
  withRun((dir, P) => {
    const r = recordRefutation(dir, { verdict: "CONDITIONAL", flags: FLAGS });
    assert.equal(r.refused, null, `the fixture call was refused: ${r.refused}`);
    assert.equal(readAcceptedFlags(dir).length, 3, "the fixture must land three typed flags");

    // TAMPER: strip the flags out of the rendered document, leaving the verdict. The parse now finds
    // NOTHING, so the two sources disagree by three — which is the only way to tell them apart.
    const before = parseCorrections(readFileSync(P.seniorEyeReview, "utf8")).length;
    assert.equal(before, 3, "the rendered document must start out parseable, or the tamper proves nothing");
    writeFileSync(P.seniorEyeReview, "CONDITIONAL\n\nNo flags raised.\n");
    assert.equal(parseCorrections(readFileSync(P.seniorEyeReview, "utf8")).length, 0,
      "the tamper must actually blind the parse");

    const extra = correctionsExtra(P);
    const text = typeof extra === "string" ? extra : JSON.stringify(extra);
    // Every flag's own text must reach the worklist. If the pass were still reading the document it would
    // now be given an empty worklist and would re-emit against nothing.
    for (const f of FLAGS) {
      assert.ok(text.includes(f.text),
        `the worklist lost "${f.text.slice(0, 40)}…". It is being built from the rendered document, which `
        + "this arm has blinded — so a flag the parse cannot see is a defect the corrective pass never "
        + "receives, which is the whole failure conversion 9 closed one layer up");
    }
    assert.ok(/THE FLAGS, TYPED \(3/.test(text),
      "the worklist must count three flags from the call, not zero from the document");
  });
});

test("#1889 T3b: with no accepted call the parse is still the source — the fallback is real", () => {
  withRun((dir, P) => {
    // No tool call at all: an archived run, or one resumed across the conversion. The document is the only
    // evidence there is, and the old parse reads it correctly. Deleting that path would break resume.
    writeFileSync(P.seniorEyeReview,
      "CONDITIONAL\n\n## Flags\n\n1. [kind: fact] [on: 4] a date the record contradicts.\n");
    assert.equal(readAcceptedFlags(dir), null, "there must be no accepted call, or this arm tests nothing");

    const extra = correctionsExtra(P);
    const text = typeof extra === "string" ? extra : JSON.stringify(extra);
    assert.ok(text.includes("a date the record contradicts"),
      "with no typed call the worklist must fall back to the rendered document — a run that predates the "
      + "conversion still has to be repairable");
  });
});

test("#1889 T3b: a REFUSED call falls back rather than repairing against a rejected review", () => {
  withRun((dir, P) => {
    // The dangerous case. A BLOCKING citing nothing is refused where it is typed, and the payload is
    // still written — complete, well-formed, and indistinguishable from an accepted one but for the
    // outcome field. If the worklist read it, the pass would repair against objections the tool rejected.
    const r = recordRefutation(dir, { verdict: "BLOCKING", flags: [] });
    assert.ok(r.refused, "the fixture must actually be refused");
    assert.equal(readAcceptedFlags(dir), null, "a refused call must not present as accepted");

    writeFileSync(P.seniorEyeReview,
      "CONDITIONAL\n\n## Flags\n\n1. [kind: narrative] the summary buries the contested axis.\n");
    const extra = correctionsExtra(P);
    const text = typeof extra === "string" ? extra : JSON.stringify(extra);
    assert.ok(text.includes("the summary buries the contested axis"),
      "a refused call must send the worklist to the document, not to the rejected payload");
  });
});
