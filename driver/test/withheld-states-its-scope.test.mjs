// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `withheld 0` READ AS "NO SEAM DEFECT" OVER A ROUND THE REVIEWER BLOCKED.
//
// On R2 round `ed1d7248` the reviewer returned BLOCKING on a carry-through failure: two live, in-class
// rights that the run's own `register-findings` carried reached neither `findings.json`, nor
// `narrative.md`, nor `placements.json`. Its summary: "The search ran; the carry-through failed."
//
// The scorer scored the same run `withheld 0`.
//
// Both numbers are correct. `scoreRecall` iterates REFERENCE ENTRIES — `retrieved` is consulted only
// from inside that loop, to ask "was this reference entry retrieved and then dropped". Neither dropped
// mark is among the nine reference marks, so neither was ever examined, and `withheld` could not have
// risen for them however many there were.
//
// WHY THAT MATTERS MORE THAN THE DEFECT IT HID. `role-e2e` calls `withheld` "the bucket that changes
// what you fix — a mark the run retrieved and then dropped before the findings list is a
// gather-to-judgment seam defect, not a recall one". A bare `0` beside that sentence reads as "no seam
// defect this round". And the run's own coverage ledger said `confirmed-clean`, "every right found is
// reported" — so a reader found two independent-looking surfaces agreeing, because both are scoped to
// the same nine marks. The only thing that broke the agreement was a reviewer that reads the register.
//
// THE DIRECTION IS THE DANGEROUS ONE: it reads clean. A `withheld` that over-counted would have been
// investigated the first round it appeared.
//
// ── WHAT THIS CHANGE IS, AND WHAT IT IS NOT ─────────────────────────────────────────────────────────
//
// It is 's acceptance 3 and nothing else: the scope goes ON THE LINE. It does NOT compute
// carry-through — that is acceptance 1, it needs the run's SCREENED set rather than its band, and the
// measurements for why that is a separate job are on the issue.
//
// The precedent is one screenful up in the same file: the scorer already refuses to print a bare `0`
// when there is no `_driver/`, because "both must SAY they collapsed it, rather than print
// `withheld: 0`, which reads as 'nothing was dropped'". This is that same refusal, for the case that
// reads clean instead of the case that is absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withheldScope, scoreRecall } from "../reference-score.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The round's own shape, scaled down. Two retrieved-then-dropped marks the reference does not name —
// the population `withheld` is structurally blind to.
const REFERENCE = [{ mark: "MIRANTHEAA" }, { mark: "DELPHI GENETICS" }];
const RETRIEVED = [
  { mark: "MIRANTHEAA", record_id: "r1" },
  { mark: "DELPHIC RESEARCH", record_id: "r2" },
  { mark: "DELPHIN & EMERENCE", record_id: "r3" },
  { mark: "DELPHIC RESEARCH", record_id: "r4" },   // same mark, second record
];

// ── the defect, restated as a measurement ────────────────────────────────────────────────────────────

test("#1322 THE BLIND SPOT IS REAL: withheld stays 0 while two retrieved marks never reach the findings", () => {
  const buckets = scoreRecall({
    reference: REFERENCE,
    findings: [{ mark: "MIRANTHEAA", source_type: "register" }],
    retrieved: RETRIEVED,
  });
  assert.equal(buckets.withheld.length, 0,
    "the fixture no longer reproduces the round — withheld rose, so the blind spot is not what is being measured");
  const seen = new Set([...buckets.found, ...buckets.withheld, ...buckets.lost, ...buckets.excluded]
    .map((e) => e.mark ?? e.name));
  for (const m of ["DELPHIC RESEARCH", "DELPHIN & EMERENCE"])
    assert.equal(seen.has(m), false, `${m} reached a bucket — the loop is no longer reference-driven`);
});

test("#1322 …and the scope measure NAMES them, on the same inputs", () => {
  const ws = withheldScope({ reference: REFERENCE, retrieved: RETRIEVED });
  assert.equal(ws.outside, 2, "the two marks the reference does not name are not being counted");
  assert.match(ws.note, /2 other retrieved marks are outside this measure entirely/);
  assert.match(ws.note, /of 2 reference marks/, "the line must say what the 0 IS scoped to, not only what it misses");
});

test("#1322 DISTINCT MARKS, not records — one mark on six records is one thing unseen", () => {
  // `DELPHIC RESEARCH` appears on two records above. Counting records would inflate the blind spot by
  // the register's own duplication, and a number that moves with record volume invites a conclusion.
  const ws = withheldScope({ reference: REFERENCE, retrieved: RETRIEVED });
  assert.equal(ws.retrievedMarks, 3, "distinct mark texts, not record rows");
  assert.equal(RETRIEVED.length, 4, "the fixture must carry a duplicate for this assertion to mean anything");
});

// ── three answers, never two ─────────────────────────────────────────────────────────────────────────

test("#1322 an EMPTY corpus is its own answer, not the reassuring one", () => {
  // The trap inside the fix. "Nothing sits outside this measure" is vacuously true of an empty corpus
  // and reads as a clean result — which is this issue's defect, recreated one layer in.
  const ws = withheldScope({ reference: REFERENCE, retrieved: [] });
  assert.equal(ws.outside, 0);
  assert.match(ws.note, /EMPTY/);
  assert.match(ws.note, /rests on nothing; it is not a clean result/);
  assert.doesNotMatch(ws.note, /nothing sits outside it/,
    "an empty corpus is reading as the everything-is-accounted-for case");
});

test("#1322 a corpus the reference fully names says so, with the count", () => {
  const ws = withheldScope({ reference: [{ mark: "MIRANTHEAA" }], retrieved: [{ mark: "MIRANTHEAA" }] });
  assert.equal(ws.outside, 0);
  assert.match(ws.note, /all 1 retrieved mark is named by the reference/);
});

test("#1322 register-only says NOTHING rather than a scope it cannot compute", () => {
  // The caller already prints the collapse reason on that row. A second sentence claiming a scope would
  // contradict the one that says the measure could not run at all.
  assert.equal(withheldScope({ reference: REFERENCE, retrieved: RETRIEVED, registerOnly: true }).note, "");
});

test("#1322 junk in, no throw — this is a harness", () => {
  for (const args of [{}, { reference: null, retrieved: null }, { retrieved: [null, 7, { mark: "" }] }])
    assert.doesNotThrow(() => withheldScope(args), JSON.stringify(args));
  assert.equal(withheldScope({ retrieved: [null, 7, { mark: "  " }] }).retrievedMarks, 0,
    "blank and unreadable rows are not marks");
});

// ── the line itself ──────────────────────────────────────────────────────────────────────────────────

test("#1322 the scorer prints the scope ON the withheld row, not in a footnote", () => {
  // Asserted on the source: driving the CLI needs a run directory and a reference. The claim made here
  // is the one that can be made honestly — the row is built from the measure rather than from a bare
  // count, which is the property whose absence is the whole issue.
  const src = readFileSync(join(ROOT, "scripts", "score.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(code, /withheldScope\(\{/, "score.mjs does not compute the scope at all");
  assert.doesNotMatch(code,
    /row\("withheld", B\.withheld\.length, "retrieved by this run, then dropped before the findings"\)/,
    "the bare row is back — the count prints with no scope beside it");
});
