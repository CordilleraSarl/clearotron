// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The closing line of a seat dispatch names the file that is actually CHECKED.
//
// THE FAULT WAS EMPHASIS, NOT OMISSION, and that is what makes it hard to test honestly. Every
// form-bearing seat already described its form — in the middle of the prompt — and then closed with
// "Write your output to: <the prose .md>", singular and definite, in the last position. A seat that
// reads the closing instruction as the definition of the task writes the .md and returns. That is
// `form_untouched`, and on one measured run the meaning seat came back with 0 of 73 rows ruled.
//
// So it is not enough to assert the form is mentioned. These tests assert it WINS: first in the list,
// the only capitalised sentence, and the last word — because the last word is what the old text got
// wrong. And the other half matters just as much: 15 of the 21 dispatches have no form and must not
// have changed by a single byte, which is asserted against a literal copy of the old string rather than
// against the current implementation, so the two cannot drift into agreement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { writeReturn } from "../stages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The text as it stood before this change, pasted, not imported. If the no-form path ever drifts, this
// literal is what notices — a comparison against the implementation would move with it.
const OLD = (out) =>
  `Write your output to this ABSOLUTE path (create parent dirs if needed): ${out}\n`
  + `Then return ONLY: the absolute output path + a 2-3 line summary. Do NOT spawn any sub-agents.`;

test("a seat with NO form gets byte-identical text — 15 of 21 dispatches must not move", () => {
  const out = "/run/abc/findings.md";
  assert.equal(writeReturn(out), OLD(out));
  assert.equal(writeReturn(out, []), OLD(out), "an empty list is not a form");
  assert.equal(writeReturn(out, null), OLD(out));
  assert.equal(writeReturn(out, [null, undefined, ""]), OLD(out), "nor is a list of nothings");
});

test("a form-bearing seat is told the FORM is what gets checked", () => {
  const s = writeReturn("/run/abc/common-law.md", ["/run/abc/common-law-dispositions.json"]);
  assert.match(s, /common-law-dispositions\.json/);
  assert.match(s, /common-law\.md/);
  assert.match(s, /WHAT GETS CHECKED/);
  assert.match(s, /ALREADY WRITTEN this form/);
  assert.match(s, /the file the validator reads/);
});

test("THE FORM WINS THE EMPHASIS — first in the list, and the last word", () => {
  // Three positions, because the defect was positional. Mentioning the form somewhere in the middle is
  // exactly what the old dispatches already did.
  const form = "/run/abc/common-law-dispositions.json";
  const prose = "/run/abc/common-law.md";
  const s = writeReturn(prose, [form]);
  const lines = s.split("\n");

  assert.ok(s.indexOf(form) < s.indexOf(prose), "the form is named BEFORE the write-up");
  assert.match(lines[0], /^YOU OWE 2 FILES, AND THE FORM IS WHAT GETS CHECKED\.$/,
    "the headline states the contract, in the first position");
  assert.match(lines[lines.length - 1], /Fill the form FIRST\. If you write only one file, write the form\./,
    "and the LAST line is about the form — the position the old text spent on the prose file");
  assert.match(s, /does not stand in for the form/,
    "and the substitution the seat actually made is refused in so many words");
});

test("the plural reads correctly when a seat owes more than one form", () => {
  // Not cosmetic: "a dispatch whose form are unfilled" is the kind of sentence that makes a careful
  // reader distrust the whole instruction, and 's own singular/plural slip is why this is asserted.
  const s = writeReturn("/run/o.md", ["/run/a.json", "/run/b.json"]);
  assert.match(s, /^YOU OWE 3 FILES, AND THE FORMS ARE WHAT GETS CHECKED\./);
  assert.match(s, /whose forms are unfilled/);
  assert.match(s, /Fill the forms FIRST\./);
  assert.ok(!/form is unfilled/.test(s));
  assert.ok(!/ 1 files|whose form are /.test(s));
});

test("the files are numbered, and the write-up is numbered LAST", () => {
  const s = writeReturn("/run/o.md", ["/run/a.json", "/run/b.json"]);
  assert.match(s, /^ {2}1\. \/run\/a\.json$/m);
  assert.match(s, /^ {2}2\. \/run\/b\.json$/m);
  assert.match(s, /^ {2}3\. Your write-up .*\/run\/o\.md$/m);
});

test("THE CLOSING LINE IS A DICTATED SHAPE WITH A CONSUMER — the prose path stays extractable", () => {
  // This is not a style assertion. The harness mock finds a stage's output path by matching this exact
  // phrasing against the dispatch (mock-stage-fixtures.mjs applyStageWrites). A first draft of this
  // change dropped "ABSOLUTE path" from the form-bearing branch; the mock then located no output, wrote
  // nothing, and 191 tests reported `form_untouched` on seats that had never been asked for anything.
  //
  // The pattern is copied here deliberately rather than imported: if the mock's own regex changes, this
  // fails and someone reads both, which is the entire point of pinning a cross-file contract.
  const EXTRACTOR = /ABSOLUTE path[^:]*:\s*(\/\S+)/;
  const prose = "/run/abc/common-law.md";
  const form = "/run/abc/common-law-dispositions.json";

  assert.equal((writeReturn(prose, [form]).match(EXTRACTOR) ?? [])[1], prose,
    "the FIRST match must be the write-up, never the form — otherwise the prose is written into the form");
  assert.equal((writeReturn(prose).match(EXTRACTOR) ?? [])[1], prose,
    "and the no-form path, which is the one 15 dispatches take");
  assert.equal((writeReturn(prose, [form, "/run/abc/second.json"]).match(EXTRACTOR) ?? [])[1], prose,
    "…and it survives a second form being added ahead of it");
});

// ── the wiring, which is the half a unit test cannot see ────────────────────────────────────────────

test("EVERY driver-written form is wired into a writeReturn call", (t) => {
  // The guard that matters when a fourth form-bearing seat is added. `paths()` is where a form is
  // declared; this asserts that every declared form reaches the closing line of some dispatch. A new
  // form added to paths() and handed to a seat, but never wired here, fails on this assertion — which
  // is the only place it would fail, because a dispatch that omits it still renders perfectly well.
  const src = readFileSync(join(ROOT, "stages.mjs"), "utf8");

  // Read the form names from paths() rather than listing them here: a hand-kept list is the second copy
  // that drifts, and this round has deleted four of those.
  // B — the dispositions paths are DELIBERATELY excluded: since the typed transport they are path
  // ANCHORS for the tool-written `_driver/` accumulator (dispositions_path in the spec), not files any
  // seat fills, and wiring one into a closing line would tell a seat to write a file nobody reads.
  // The typed transports shrank this population on purpose: the dispositions paths went with B, and the
  // coverage form's path went with the register-digest conversion (statuses ride record_coverage into a
  // `_driver/` accumulator no closing line may name). placement-form is the one seat-filled form left.
  const declared = [...src.matchAll(/^\s{4}(\w*(?:Form|Dispositions|DispositionsHalf))\s*:/gm)].map((m) => m[1])
    .filter((f) => !/^commonLawDispositions/.test(f));
  assert.ok(declared.length >= 1,
    `expected the declared forms from paths(), found ${JSON.stringify(declared)} — the reader is broken, not the wiring`);

  const calls = [...src.matchAll(/writeReturn\([^)]*\)[^)]*\)/g)].map((m) => m[0]);
  // 19 -> 16: the three send stages each closed with a `writeReturn(<their receipt>)`, and all
  // three are deleted with the delivery mode that was their only caller. Nothing about the remaining
  // dispatches changed — this floor moved because the population did.
  // 20 -> 19 at conversion 6: doubt-closure's `writeReturn(P.doubtClosure)` is gone, because its dispatch
  // names no output path at all now — the driver renders the artifact off the record call. The floor moves
  // with the population rather than being loosened: it is a floor on DISPATCHES THAT STILL CLOSE WITH A
  // WRITE, and each conversion removes exactly one.
  // 16 -> 15 at conversion 9: narrative-refutation's `writeReturn(P.seniorEyeReview)` is gone for the same
  // reason doubt-closure's was — its dispatch names no output path, because the driver renders the review
  // off `record_narrative_refutation`. One conversion, one call, exactly as the paragraph above predicts.
  // 15 -> 14 at conversion 11: register-digest's closing write-return is gone for the same reason the two
  // above it are — its dispatch names no output path, because the driver renders the findings document
  // off `record_register_digest`. One conversion, one call, exactly as the paragraph above predicts, and
  // the floor is lowered by that one rather than re-fitted to the current count.
  assert.ok(calls.length >= 14, `expected every dispatch's closing call, found ${calls.length}`);

  const unwired = declared.filter((f) => !calls.some((c) => c.includes(`P.${f}`)));
  assert.deepEqual(unwired, [],
    `these forms are declared in paths() but reach no dispatch's closing line: ${unwired.join(", ")}`);
});

test("the form-bearing seats are wired, and the coverage form is UNCONDITIONAL", () => {
  const src = readFileSync(join(ROOT, "stages.mjs"), "utf8");
  // B — the meaning seats are NOT form-bearing any more: rulings ride `record_dispositions`, so their
  // closing lines are the BARE shape and must stay it (a form list here would re-teach the dead file).
  assert.ok(src.includes("writeReturn(P.commonLaw)"), "meaning lane, whole run — bare");
  assert.ok(src.includes("writeReturn(P.commonLawHalf(half))"), "meaning lane, halves — bare");
  assert.ok(!src.includes("[P.commonLawDispositions]") && !src.includes("[P.commonLawDispositionsHalf(half)]"),
    "no dispatch may name the retired dispositions file as a checked form");
  assert.ok(src.includes("writeReturn(P.placement, [P.placementForm])"), "placement seat");
  // Typed transport (the register-digest coverage conversion — B's pattern one lane over): the digest
  // seat is NOT form-bearing any more. Statuses ride `record_coverage` into the `_driver/` accumulator,
  // the seat-facing form copy is dead, and the closing line is the BARE shape and must stay it — a form
  // list here would re-teach the dead file. ( M6's unconditional-form assertion stood here between
  // 2026-08-14 and the conversion; the premise it rested on — the seat fills a file — is gone.)
  // CONVERSION 11 — the digest seat's closing line is GONE, not bare. It asserted
  // `writeReturn(P.registerFindings)`; the document is the driver's now, so the dispatch names no file
  // at all and this arm asserts the absence instead. Keeping the positive assertion would have required
  // re-adding the very line the conversion removed.
  assert.ok(!src.includes("writeReturn(P.registerFindings)"),
    "the digest dispatch still closes with writeReturn — register-findings.md's only writer is the driver, "
    + "so a closing line that names it is the superseded path the golden rule bans");
  assert.ok(!src.includes("[P.registerCoverageForm]"),
    "no dispatch may name the retired seat-facing coverage form as a checked form");
});

test("no dispatch names a form it was not given — the no-form path stays reachable", () => {
  const src = readFileSync(join(ROOT, "stages.mjs"), "utf8");
  const bare = (src.match(/writeReturn\(P\.\w+(?:\([^)]*\))?\),/g) ?? []).length;
  // 10 -> 9: `notify`'s bare `writeReturn(P.notifyReceipt)` went with the stage. The floor is
  // a floor rather than an equality precisely so a stage leaving does not read as the no-form path
  // breaking — but it has to move when the population does, or it stops being a measurement.
  // 9 -> 8 at conversion 9: narrative-refutation's bare call went with its output path. The reviewer was
  // one of the seats this arm counted as taking the untouched path; it now takes no path at all.
  // 8 -> 7 at conversion 10: synthesis's bare `writeReturn(P.narrative)` went the
  // same way. The writer owes no file — narrative.md and findings.json are both rendered by the driver
  // from the record — so the seat that was counted here as taking the untouched path now takes no path.
  // 7 -> 6 at conversion 11: register-digest's bare `writeReturn(P.registerFindings)` went the same way.
  // The floor is lowered by the ONE call that moved, in the same commit, never re-derived from the
  // current count — a floor re-fitted to whatever the tree happens to say would ratify a silent drop.
  assert.ok(bare >= 6,
    `most seats have no form and must still take the untouched path — found ${bare} bare calls`);
});
