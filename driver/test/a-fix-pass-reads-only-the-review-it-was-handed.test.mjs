// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the post-repair fix pass's review readers, on a run directory of invented names
//
// A FIX PASS READS ONLY THE REVIEW IT WAS HANDED (owner, ruling 719; design, 2026-10-02).
//
// The fix pass applies the review's points on what a repair changed: a point on a finding when that finding
// changed, and a point about the document, which names no finding, when the narrative's prose was
// rewritten. Three
// checks inside the corrective
// body also read "the review": which findings the flags name by number, by name and by quoted line. They
// decide whether a removal was asked for or is restored, and whether an unchanged record must be re-sent.
// Read from the first review's call, or from the whole re-run review on disk, they judge the pass against
// flags it never saw. Given the handed review, each reads that and nothing else.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { renderRefutation } from "../narrative-refutation-record.mjs";
import { handedReview, correctionNamedOrdinals, correctionNamedSet } from "../pipeline.mjs";

const runDir = mkdtempSync(join(tmpdir(), "handed-review-"));
after(() => rmSync(runDir, { recursive: true, force: true }));
const calls = driverDir(runDir, "refutation-calls");
mkdirSync(calls, { recursive: true });
const call = (n, flags) => writeFileSync(join(calls, `call-00${n}.json`),
  JSON.stringify({ seq: n, accepted: true, params: { verdict: "CONDITIONAL", flags, plan_audit: [] } }));
const FIRST = [{ kind: "fact", on: [3], text: "Norvell Instruments is described as live in the narrative." }];
const LATE = [{ kind: "fact", on: [1], text: "Veltrin Holdings' renewal date contradicts its record." },
  { kind: "fact", on: [2], text: "Zorendik Group's goods are paraphrased too widely." },
  { kind: "narrative", text: "The overview restates the band in its first sentence." }];
const reach = (ordinals, prose = false) => ({ ordinals: new Set(ordinals), prose });
call(1, FIRST);
call(2, LATE);
const P = { runDir, seniorEyeReview: join(runDir, "senior-eye-review.md") };
writeFileSync(P.seniorEyeReview, renderRefutation("CONDITIONAL", LATE, []));
const DOC = { findings: [
  { ordinal: 1, mark: "VELTRIN", owner: { name: "Veltrin Holdings" } },
  { ordinal: 2, mark: "ZORENDIK", owner: { name: "Zorendik Group" } },
  { ordinal: 3, mark: "NORVELL", owner: { name: "Norvell Instruments" } }] };

test("the handed review is the latest accepted review's points on what the repair changed, in the reviewer's words", () => {
  const handed = handedReview(P, reach([1]));
  assert.deepEqual(handed.flags, [LATE[0]], "the first review, the point on finding 2 or the point about the document was handed over");
  assert.match(handed.text, /\[on: 1\] Veltrin Holdings' renewal date contradicts its record\./);
  assert.doesNotMatch(handed.text, /Zorendik|Norvell|restates the band/);
  assert.equal(handedReview(P, reach([4])), null, "no point is on finding 4, so there is nothing to hand over");
});

test("a point about the document is handed when the narrative's prose was rewritten, and only then", () => {
  assert.deepEqual(handedReview(P, reach([], true)).flags, [LATE[2]]);
  assert.deepEqual(handedReview(P, reach([1], true)).flags, [LATE[0], LATE[2]]);
  assert.equal(handedReview(P, reach([], false)), null, "the prose was not rewritten, so its points are not the repair's");
});

test("given the handed review, the removal and freshness checks name only what it names", () => {
  const handed = handedReview(P, reach([1]));
  assert.deepEqual(correctionNamedOrdinals(P, handed), [1]);
  assert.deepEqual(correctionNamedSet(P, DOC, handed.text).sort(), ["VELTRIN", "Veltrin Holdings"].sort());
});

test("CONTROL — without it they read as before: the first review's call by number, the review on disk by name", () => {
  assert.deepEqual(correctionNamedOrdinals(P), [3], "the corrective cycle reads the review that fed it");
  const named = correctionNamedSet(P, DOC);
  assert.ok(named.includes("Zorendik Group") && named.includes("Veltrin Holdings"), `the review on disk names both: ${named}`);
});
