// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repair-contract.mjs — the write-mode decision for every corrective turn. Pure, so pin it directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { editRepairTail, fullWriteTail, failingTarget, abbrev, ABBREVIATED_VALUE_NOTE } from "../repair-contract.mjs";

test("the edit tail orders a patch, forbids the whole-file rewrite, and still covers an absent file", () => {
  const t = editRepairTail("/r/x/register-findings.md");
  assert.match(t, /TARGETED EDITS to \/r\/x\/register-findings\.md using the Edit tool/);
  assert.match(t, /change ONLY what the correction/);
  assert.match(t, /leave every other line of the file byte-identical/);
  assert.match(t, /Do NOT rewrite, re-emit or re-type the whole file/);
  // the reason, not just the rule — a full rewrite of valid prose is the risk being avoided
  assert.match(t, /risks degrading it/);
  // the one branch the model still has to handle itself
  assert.match(t, /does not exist, create it in full with the Write tool/);
  // no caller may end up with a bare "the stage output" when it knows the path
  assert.match(editRepairTail(null), /the stage output/);
});

test("the full-write tail is reserved for a file that was never written", () => {
  const t = fullWriteTail("/r/x/out.md");
  assert.match(t, /Write the COMPLETE file now at \/r\/x\/out\.md/);
  assert.match(t, /from the work already in your context/, "a resumed session must not redo the work");
  assert.doesNotMatch(t, /Edit tool/);
});

test("failingTarget picks the member the invalid_file token names", () => {
  const files = ["/r/prelim-search/x/common-law-findings.half-a.md", "/r/prelim-search/x/common-law-findings.half-b.md"];
  assert.equal(failingTarget("invalid_file:x/common-law-findings.half-b.md:platforms_missing:etsy", files), files[1]);
  assert.equal(failingTarget("invalid_file:x/common-law-findings.half-a.md:connotation_undisposed:q", files), files[0]);
  // single-file stages: the only expect file IS the target, whatever display path the token carries
  assert.equal(failingTarget("invalid_file:anything.md:tok", ["/r/x/out.md"]), "/r/x/out.md");
  // an absent or non-invalid_file token identifies nothing — the caller falls back
  assert.equal(failingTarget("missing_file:x/out.md", files), null);
  assert.equal(failingTarget(undefined, files), null);
  assert.equal(failingTarget("invalid_file:x/unknown.md:tok", files), null,
    "a token naming no known member must not silently aim at the first file");
});

// ── — a value a model must reproduce is complete, or visibly marked as incomplete ───────────────
// A 114-character ledger URL was rendered into the recurrence failure token through a bare
// `.slice(0, 80)`. The model copied what it was shown — exactly 80 characters — and `lineCitesResult`
// needs the WHOLE url as a substring, so the citation could never bind. The token re-rendered the same
// cut string and the model wrote the same line again: a byte-identical stall with no exit.
test("#434: abbrev marks a cut value, leaves a fitting one byte-identical, and never exceeds its bound", () => {
  const url = "https://www.venture-leaders.ch/Bioveltrin-Therapeutics-The-Venture-Leader-Biotech-developing-targeted-cancer-drugs";
  assert.equal(url.length, 114);
  const cut = abbrev(url, 80);
  assert.equal(cut.length, 80, "the marker rides INSIDE the bound, so 80 keeps meaning 80");
  assert.ok(cut.endsWith("…"), "a cut value is visibly marked");
  assert.ok(!url.includes(cut), "the marked form is NOT a copyable prefix of the original — that is the point");
  // the silent form was: an 80-char prefix that IS a substring of the real URL, so it looks complete
  assert.ok(url.includes(url.slice(0, 80)), "the pre-#434 rendering was indistinguishable from a whole URL");
  // a value that fits is untouched — every short receipt in the archive renders exactly as before
  for (const v of ["https://dictionary.com/browse/offensive", "DELPHI gang", "", null, undefined])
    assert.equal(abbrev(v, 80), String(v ?? ""), `unchanged when it fits: ${v}`);
  assert.equal(abbrev("abcdef", 6), "abcdef", "exactly at the bound is not a cut");
  assert.equal(abbrev("abcdefg", 6), "abcde…");
  assert.equal(abbrev("abc", 0), "…", "a zero bound still marks rather than lying");
});

test("#434: the marker has a stated meaning wherever it appears", () => {
  assert.match(ABBREVIATED_VALUE_NOTE, /…/, "the note names the character it explains");
  assert.match(ABBREVIATED_VALUE_NOTE, /ledger/i, "and says where the full value is");
  assert.match(ABBREVIATED_VALUE_NOTE, /NOT what you must write/i);
});
