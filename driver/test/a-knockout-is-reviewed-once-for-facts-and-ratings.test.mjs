// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT IS REVIEWED ONCE, for its facts against their sources and the ratings of its findings on registered marks, in design's
// approved words, and nothing reads the corrected record again. The review reads the carried filings as a table, not the whole
// register record, and does not chase a thin web lead. Names here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";

const SCOPE = "Read the opinions, their cited sources, and the carried-filings table. Check material factual claims against the sources and the ratings of findings on registered marks against the filing, its goods, status and territory, the proposed use and the risk framework.";
const THIN = "A thin unregistered mention or isolated listing with no evidence of trade does not warrant a separate finding or follow-up.";

test("the review checks facts against sources and the ratings on registered marks, and leaves supported judgments alone", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-review-scope-")));
  const review = KO_STAGES["knockout-review"].message({ K, evidenceLines: [], firstReadLines: [] });
  assert.ok(review.includes(SCOPE), "the review's scope, verbatim");
  assert.ok(review.includes("A difference in another name's band alone is no defect. Leave supported judgments and wording alone."));
  assert.ok(review.includes(THIN), "a thin web lead is not chased");
  assert.doesNotMatch(review, /Check this as a knockout/, "the wider check it replaces is gone");
  assert.doesNotMatch(review, /read again|second look|recheck/i, "no step reads the record after the correction");
});

test("the review reads the carried filings as a table where one was written, and the whole record only where none was", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-review-table-")));
  const withTable = KO_STAGES["knockout-review"].message({ K, registerTableFile: "/run/_driver/register-table.review.json" });
  assert.ok(withTable.includes("The carried-filings table: /run/_driver/register-table.review.json."));
  assert.doesNotMatch(withTable, /The register record behind it/);
});

test("there is one review: a second pass's label writes the same file, and nothing dispatches one", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-review-once-")));
  assert.equal(KO_STAGES["knockout-review"].out(K, 1), K.review);
  assert.equal(KO_STAGES["knockout-review"].out(K), K.review);
});

test("the correction answers the stated defect in the approved words, and the rating is told a thin web lead gets no card", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-correct-scope-")));
  const work = { defects: [{ n: 1, kind: "band", mark: "QUILLBRAE", chunk: 0, problem: "The first conflict is rated too low." }] };
  const correction = KO_STAGES["knockout-correct"].message({ K, chunkNo: 0, work, chunkMarks: [{ name: "QUILLBRAE" }] });
  assert.ok(correction.includes("Address the review’s stated defect for the affected name using the cited source or filing and the relevant part of the framework. Correct the factual statement or finding rating and any conclusion that depends on it. Preserve supported material elsewhere. If the source leaves a material fact uncertain, state that limit."));
  const rating = KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo: 0, chunkMarks: [{ name: "QUILLBRAE" }], chunkTotal: 1,
    framework: { bands: [{ label: "High" }, { label: "Low" }] }, frameworkPath: null, probeNote: "" });
  assert.ok(rating.includes("Give a marketplace lead its own finding when the source supports a relevant commercial use. " + THIN));
});
