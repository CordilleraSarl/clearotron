// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT'S RATING STEP KEEPS EACH NAME'S FULL OPENING. Reviewing the knockout against the lawyer's original
// instructions, design kept the per-name opening whole: written for a client reading that name's report alone, at its
// established depth and a broadly consistent scale, structured to scan, with the typed fields' requirements unchanged
// (2026-11-06). Every chunk's dispatch carries that instruction once, word for word. An earlier proposal to shorten the
// opening said there was no requirement for similar lengths; it was withdrawn, and the manual's length rule and the
// validators' minimums that the instruction relies on are still there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPENING = "Give each name a complete opening assessment for a client reading that name's report alone. Explain the relevant landscape, what drives the rating, and what matters for the client's decision. Preserve the established depth and a broadly consistent scale across the batch. Use sub-headings, short paragraphs and bullets to make the assessment easy to scan. Keep the existing structured fields and their requirements. Do not invent observations or repeat a point merely to fill space; preserve the material supporting and contrary facts, goods and class distinctions, implications and search limitations needed to understand the advice. The batch summary compares the names separately and does not replace any name's own opening assessment.";
const WITHDRAWN = /no requirement for names to have similar-length/i;

const dispatch = (chunkNo) => {
  const runDir = mkdtempSync(join(tmpdir(), "ko-opening-"));
  try {
    return String(KO_STAGES["knockout-assess"].message({
      K: koPaths(runDir), chunkNo, chunkMarks: [{ name: "QUILLBRAE" }], chunkTotal: 2, probeNote: "",
      framework: { bands: [{ label: "High" }, { label: "Manageable" }] }, frameworkPath: null,
    }));
  } finally { rmSync(runDir, { recursive: true, force: true }); }
};

test("every chunk's rating dispatch carries the opening instruction once, word for word", () => {
  for (const chunkNo of [0, 1]) {
    const text = dispatch(chunkNo);
    assert.match(text, chunkNo === 0 ? /As the FIRST chunk/ : /As a CONTINUATION chunk/, "premise: the chunk's own branch rendered");
    assert.equal(text.split(OPENING).length - 1, 1, `chunk ${chunkNo + 1}: the opening instruction is not in the dispatch once, word for word`);
    assert.doesNotMatch(text, WITHDRAWN, `chunk ${chunkNo + 1}: the withdrawn sentence reached the rating step`);
  }
});

test("what the instruction keeps is still there: the manual's length rule and the typed fields' minimums", () => {
  const manual = readFileSync(join(DRIVER, "skills", "knockout-assess", "SKILL.md"), "utf8");
  assert.match(manual, /\*\*Keep the length; make it consistent\.\*\*/, "the manual's length rule is gone");
  assert.match(manual, /^- `factors`: 2-4 strings/m);
  assert.match(manual, /^- `counterFactors`: 1-3 strings/m);
  assert.doesNotMatch(manual, WITHDRAWN, "the withdrawn sentence reached the manual");
  const record = readFileSync(join(DRIVER, "knockout-assess-record.mjs"), "utf8");
  for (const rule of ["isStrArray(m?.bullets, 1, 5)", "isStrArray(m?.factors, 2, 4)", "isStrArray(m?.counterFactors, 1, 3)"])
    assert.ok(record.includes(rule), `the validator no longer holds ${rule}`);
});
