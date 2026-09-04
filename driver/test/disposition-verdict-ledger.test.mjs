// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE REFUSAL REASON EXISTED, WAS CORRECT, AND WAS NEVER WRITTEN DOWN.
//
// R5 round `892dd88e`: a seat spent 163 typed calls on rows it could not discharge. 113 of 114 tool
// results said `refused`; 162 of 170 per-row refusals named ONE specific correct actionable cause. Every
// one of those reasons lived inside the seat's turn and nowhere else, and the single surviving trace was
// `obligationsNeverAddressed: 2` — the one description of that run that demonstrably did not happen.
//
// These tests are written against three properties, in the order they can fail:
//   1. the reason is PERSISTED at all;
//   2. the unit is the CALL, not the row's final state — the investigation nearly killed a true
//      hypothesis on exactly that collapse;
//   3. the audit can no longer call an addressed row "never addressed".
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { foldCallVerdicts, partitionUnruledByLedger, detectRulingDrift, validateDispositionCall,
  ledgerReasonHistogram, ledgerRows, CALL_REFUSALS, CALL_DROPS } from "../disposition-call.mjs";
import { recordCallVerdict, readCallVerdicts, callRecordPaths } from "../disposition-tool.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ct-1098-"));
const dispositionsPath = (root) => join(root, "common-law-dispositions.json");

// ── 1. THE REASON IS PERSISTED ──────────────────────────────────────────────────────────────────────

test("a refusal survives the turn: reason, remedy and the ruling the row CLAIMED all reach disk", () => {
  const root = tmp();
  const dp = dispositionsPath(root);
  const r = recordCallVerdict(dp, 1, {
    accepted: [{ row_id: "Q-AAA", ruling: "benign" }],
    refused: [{ row_id: "Q-BBB", reason: "anchor_unbound", ruling: "loaded",
      detail: "the anchor for row Q-BBB does not appear in the captured text of the receipt you ruled on (absent)" }],
    overflow: [], dropped: [],
  });
  assert.equal(r.ok, true, `the ledger did not write: ${r.why ?? "(no reason given)"}`);

  const back = readCallVerdicts(dp);
  assert.equal(back.length, 1, "the ledger is empty after a write — the reason is still nowhere");
  assert.equal(back[0].seq, 1);
  assert.deepEqual(back[0].accepted, [{ row_id: "Q-AAA", ruling: "benign" }]);
  assert.equal(back[0].refused[0].reason, "anchor_unbound");
  assert.match(back[0].refused[0].detail, /does not appear in the captured text/,
    "the REMEDY is what tells a later reader whether the instruction was actionable — a bare reason token cannot");
  assert.equal(back[0].refused[0].ruling, "loaded",
    "the ruling a REFUSED row claimed is the field that makes drift measurable; without it a refusal is only a cost record");
});

test("the ledger sits beside the capture, under the ONE function that knows the layout", () => {
  const root = tmp();
  const dp = dispositionsPath(root);
  const p = callRecordPaths(dp, 3);
  assert.equal(dirname(p.verdicts), p.dir, "the verdict ledger must live in the calls dir, not a second location");
  assert.equal(dirname(p.index), dirname(p.verdicts), "index and verdicts are the pre-work and post-work halves of one record");
  recordCallVerdict(dp, 1, { accepted: [], refused: [], overflow: [], dropped: [] });
  assert.ok(existsSync(p.verdicts), "nothing was written where callRecordPaths says it goes");
});

test("A MISSING LEDGER IS NOT AN EMPTY ONE — and an unparseable line does not destroy the others", () => {
  const root = tmp();
  const dp = dispositionsPath(root);
  assert.deepEqual(readCallVerdicts(dp), [], "no file yet — an absence, which the audit reports separately");

  const p = callRecordPaths(dp, 0);
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.verdicts, [
    JSON.stringify({ seq: 1, accepted: [], refused: [{ row_id: "Q-A", reason: "anchor_unbound", ruling: "benign" }] }),
    "{ this is not json",
    JSON.stringify({ seq: 3, accepted: [{ row_id: "Q-A", ruling: "benign" }], refused: [] }),
  ].join("\n") + "\n");

  const back = readCallVerdicts(dp);
  assert.equal(back.length, 2, "one bad line took the good ones with it — the evidence of every other call");
  assert.deepEqual(back.map((x) => x.seq), [1, 3], "the surviving lines keep their own sequence numbers");
});

test("a ledger that cannot be written REPORTS it rather than throwing — the seat never loses a ruling to our journal", () => {
  // A path whose parent is a FILE: mkdirSync cannot create the dir, so the write must fail cleanly.
  const root = tmp();
  const blocker = join(root, "blocked");
  writeFileSync(blocker, "not a directory\n");
  const r = recordCallVerdict(join(blocker, "sub", "dispositions.json"), 1,
    { accepted: [{ row_id: "Q-A", ruling: "benign" }], refused: [], overflow: [], dropped: [] });
  assert.equal(r.ok, false, "this write was expected to fail — if it can succeed the test proves nothing");
  assert.ok(r.why, "the failure must be RETURNED: 'recorded' and 'could not record' are different facts");
});

// ── 2. THE UNIT IS THE CALL ─────────────────────────────────────────────────────────────────────────

test("THE UNIT IS THE CALL: 85 refusals of one row read as 85, not as one final state", () => {
  // This is the R5 shape in miniature, and the reason the fold returns histograms. The investigation that
  // first read this evidence joined distinct (row_id, anchor-present) pairs against each row's FINAL
  // state; a row sent 85 times with an anchor and once without appeared in both buckets and read as
  // uncorrelated, which REFUTED A TRUE HYPOTHESIS.
  const records = [];
  for (let seq = 1; seq <= 85; seq++)
    records.push({ seq, accepted: [], refused: [{ row_id: "Q-76BRN6YK", reason: "anchor_unbound", ruling: "benign" }] });
  records.push({ seq: 86, accepted: [], refused: [{ row_id: "Q-76BRN6YK", reason: "position_absent", ruling: "benign" }] });

  const f = foldCallVerdicts(records);
  assert.equal(f.calls, 86);
  const row = f.byRow["Q-76BRN6YK"];
  assert.equal(row.calls, 86, "the row's call count collapsed — the loop is the finding and it has to be countable");
  assert.equal(row.refused, 86);
  assert.deepEqual(row.reasons, { anchor_unbound: 85, position_absent: 1 },
    "84× anchor_unbound and 1× anchor_unbound are different facts about a seat, and only one is a loop");
  assert.equal(row.firstSeq, 1);
  assert.equal(row.lastSeq, 86);
});

test("one call naming a row twice counts ONCE — a repeated line must not inflate the number it reports", () => {
  // The second mention is `duplicate_row`, which is already its own refusal. Double-counting here would
  // inflate `calls` on exactly the rows a reader is trying to judge.
  const f = foldCallVerdicts([{ seq: 1, accepted: [], refused: [
    { row_id: "Q-A", reason: "anchor_unbound", ruling: "benign" },
    { row_id: "Q-A", reason: "duplicate_row", ruling: "benign" },
  ] }]);
  assert.equal(f.byRow["Q-A"].calls, 1, "one call, one increment");
  assert.equal(f.byRow["Q-A"].refused, 2, "both refusals are still recorded — it is `calls` that must not inflate");
});

test("NEGATIVE CONTROL — the fold is not a constant, and tolerates junk", () => {
  // — `unattributed` joined the shape, so the empty fold is three keys rather than two. Asserted
  // WHOLE rather than key by key, deliberately: this is the test that would catch a field quietly
  // appearing or disappearing, and loosening it to spot-checks would give that up to save one line.
  const EMPTY = { calls: 0, byRow: {}, unattributed: { refused: 0, dropped: 0, reasons: {} } };
  assert.deepEqual(foldCallVerdicts(null), EMPTY);
  assert.deepEqual(foldCallVerdicts([]), EMPTY);
  assert.deepEqual(foldCallVerdicts([null, 7, "x"]), EMPTY,
    "non-objects are not calls; counting them would make `calls` unreadable");
  const f = foldCallVerdicts([{ seq: 1, accepted: ["Q-BARE"], refused: [] }]);
  assert.equal(f.byRow["Q-BARE"].accepted, 1, "a bare string is still a row id — callAnswer states the same tolerance");
  assert.deepEqual(f.byRow["Q-BARE"].rulings, {}, "no ruling was supplied, so none is invented");
});

// ── 3. THE AUDIT CAN NO LONGER SAY "NEVER ADDRESSED" ────────────────────────────────────────────────

test("THE MISCLASSIFICATION: two unruled rows addressed 163 times stop reading as never-addressed", () => {
  const ledger = foldCallVerdicts([
    ...Array.from({ length: 85 }, (_, i) => ({ seq: i + 1, accepted: [],
      refused: [{ row_id: "Q-76BRN6YK", reason: "anchor_unbound", ruling: "benign" }] })),
    ...Array.from({ length: 78 }, (_, i) => ({ seq: 86 + i, accepted: [],
      refused: [{ row_id: "Q-1ECSGAB7", reason: "anchor_unbound", ruling: "benign" }] })),
  ]);
  assert.equal(ledger.calls, 163, "the fixture is the R5 call count — if this is not 163 the rest measures something else");

  const split = partitionUnruledByLedger({ unruledTotal: 2, unruledRows: ["Q-76BRN6YK", "Q-1ECSGAB7"], ledger });
  assert.equal(split.addressed, 2, "both rows were addressed — this is the number that did not exist");
  assert.equal(split.neverAddressed, 0,
    "`obligationsNeverAddressed` still reports 2 — the field that misdescribed the run has not been fixed");
  assert.equal(split.total, 2);
  assert.equal(split.neverAddressed + split.addressed, split.total,
    "the parts must sum to the total, or a headline number can drift to zero unnoticed (#592)");
  assert.equal(split.populationUnnamed, false, "these rows were nameable, so this is a measured intersection");
  assert.deepEqual(split.rows.map((r) => r.calls).sort((a, b) => a - b), [78, 85]);
});

test("WITH NO LEDGER THE SPLIT IS INERT — every archived run keeps the number it had", () => {
  // The property that makes this safe to land: no evidence ⇒ no restatement. Without it, every historical
  // run would silently acquire a finer answer nothing on disk supports.
  for (const ledger of [null, undefined, { calls: 0, byRow: {} }]) {
    const split = partitionUnruledByLedger({ unruledTotal: 75, unruledRows: ["Q-A", "Q-B"], ledger });
    assert.equal(split.neverAddressed, 75, "the old number must come back unchanged when there is no ledger");
    assert.equal(split.addressed, 0);
    assert.deepEqual(split.rows, []);
  }
});

test("a row addressed but NOT among the unruled is not counted — a discharged row is not an outstanding one", () => {
  const ledger = foldCallVerdicts([
    { seq: 1, accepted: [], refused: [{ row_id: "Q-DONE", reason: "anchor_unbound", ruling: "benign" }] },
    { seq: 2, accepted: [{ row_id: "Q-DONE", ruling: "benign" }], refused: [] },
    { seq: 3, accepted: [], refused: [{ row_id: "Q-STUCK", reason: "anchor_unbound", ruling: "benign" }] },
  ]);
  const split = partitionUnruledByLedger({ unruledTotal: 1, unruledRows: ["Q-STUCK"], ledger });
  assert.equal(split.addressed, 1, "only the row that is still owed counts");
  assert.deepEqual(split.rows.map((r) => r.row_id), ["Q-STUCK"]);
  assert.equal(split.neverAddressed, 0);
});

test("the UNTOUCHED-FORM branch is bounded and FLAGGED, never blended with a measured one", () => {
  // `form_untouched` is one aggregate violation carrying its population in a count and naming no rows. An
  // empty name list beside a non-zero total is a real state, and a reader must be able to tell an
  // inference from an intersection.
  const ledger = foldCallVerdicts([
    { seq: 1, accepted: [], refused: [{ row_id: "Q-A", reason: "anchor_unbound", ruling: "benign" }] },
    { seq: 2, accepted: [], refused: [{ row_id: "Q-B", reason: "anchor_unbound", ruling: "benign" }] },
  ]);
  const split = partitionUnruledByLedger({ unruledTotal: 72, unruledRows: [], ledger });
  assert.equal(split.populationUnnamed, true, "the flag is the difference between a measurement and a bound");
  assert.equal(split.addressed, 2);
  assert.equal(split.neverAddressed, 70);
  assert.equal(split.neverAddressed + split.addressed, split.total);

  // And it cannot exceed the total it partitions.
  const over = partitionUnruledByLedger({ unruledTotal: 1, unruledRows: [], ledger });
  assert.equal(over.addressed, 1, "the intersection is clamped to the population it splits");
  assert.equal(over.neverAddressed, 0);
});

// ── 4. THE DRIFT DETECTOR — THE CORRECTNESS HALF ────────────────────────────────────────────────────

test("DRIFT: a seat that moves benign → loaded → benign over 106 calls is FLAGGED, in order", () => {
  // R5's shape: A1+A2 benign (41 calls), A3 loaded (85 refused calls), resume benign and accepted. Had one
  // A3 call been accepted, the contradiction would have banked against the 41 earlier benign calls.
  const records = [
    ...Array.from({ length: 41 }, (_, i) => ({ seq: i + 1, accepted: [],
      refused: [{ row_id: "Q-A", reason: "anchor_unbound", ruling: "benign" }] })),
    ...Array.from({ length: 85 }, (_, i) => ({ seq: 42 + i, accepted: [],
      refused: [{ row_id: "Q-A", reason: "anchor_unbound", ruling: "loaded" }] })),
    { seq: 127, accepted: [{ row_id: "Q-A", ruling: "benign" }], refused: [] },
  ];
  const drift = detectRulingDrift(foldCallVerdicts(records));
  assert.equal(drift.length, 1, "the movement was not detected — the gravest find of the round is invisible");
  assert.deepEqual(drift[0].rulingSeq, ["benign", "loaded", "benign"],
    "the ORDER is the finding: a histogram cannot tell a seat correcting itself from a seat drifting away");
  assert.deepEqual(drift[0].rulings, { benign: 42, loaded: 85 });
  assert.equal(drift[0].accepted, 1, "the row was ultimately discharged — a detector scoped to outstanding rows would miss this entirely");
  assert.equal(drift[0].calls, 127);
});

test("DRIFT NEGATIVE CONTROL — one conclusion held over many calls is NOT movement", () => {
  const steady = foldCallVerdicts(Array.from({ length: 85 }, (_, i) => ({ seq: i + 1, accepted: [],
    refused: [{ row_id: "Q-A", reason: "anchor_unbound", ruling: "benign" }] })));
  assert.deepEqual(detectRulingDrift(steady), [],
    "85 refusals of one unchanging ruling is a cost defect, not a correctness one — a detector that flags it flags every loop");
  assert.deepEqual(detectRulingDrift(null), []);
  assert.deepEqual(detectRulingDrift({ byRow: {} }), []);
  // A row with no ruling recorded at all cannot drift.
  assert.deepEqual(detectRulingDrift(foldCallVerdicts([{ seq: 1, accepted: ["Q-BARE"], refused: [] }])), []);
});

test("the detector does NOT normalise, rank or resolve — it reports both conclusions", () => {
  const drift = detectRulingDrift(foldCallVerdicts([
    { seq: 1, accepted: [], refused: [{ row_id: "Q-A", reason: "anchor_unbound", ruling: "off-topic" }] },
    { seq: 2, accepted: [{ row_id: "Q-A", ruling: "benign" }], refused: [] },
  ]));
  assert.deepEqual(drift[0].rulingSeq, ["off-topic", "benign"],
    "both conclusions survive: choosing between two legal rulings in code is exactly what this must not do");
});

// ── 5. THE REFUSAL CARRIES THE RULING AT SOURCE ─────────────────────────────────────────────────────

test("validateDispositionCall puts the CLAIMED ruling on every refusal, whatever the refusal is about", () => {
  // The ledger can only record what the validator hands it. A refusal about the anchor still asserted a
  // legal conclusion, and that is the field the drift detector reads.
  const recorded = [{ query: "meridian thistle meaning", result: "a page about it",
    receipt_id: "R-AAAAAAAA", snippet: "Meridian Thistle is a long-established mark used in trade" }];
  const { refused } = validateDispositionCall([
    { row_id: "nope", ruling: "loaded", note: "x" },
  ], recorded);
  assert.equal(refused.length, 1, "expected one refusal");
  assert.ok(Object.hasOwn(refused[0], "ruling"),
    "the refusal carries no ruling — every drift measurement downstream is then blind by construction");
  assert.equal(refused[0].ruling, "loaded");
  assert.ok(CALL_REFUSALS.includes(refused[0].reason), `unknown refusal token ${refused[0].reason}`);
});

test("the two vocabularies stay apart — a seat-fixable refusal is never a driver drop", () => {
  // One reason, one cause, one remedy. `accepted_not_folded` demands the opposite response to every token
  // in CALL_REFUSALS: stop re-sending, it is ours.
  for (const d of CALL_DROPS)
    assert.ok(!CALL_REFUSALS.includes(d), `${d} is in both vocabularies — a reader cannot tell whose fault it is`);
  assert.ok(CALL_DROPS.includes("accepted_not_folded"));
});

test("a driver DROP folds under its own field, not among the refusals", () => {
  const f = foldCallVerdicts([{ seq: 1, accepted: [], refused: [],
    dropped: [{ row_id: "Q-A", reason: "accepted_not_folded", ruling: "benign" }] }]);
  assert.equal(f.byRow["Q-A"].dropped, 1);
  assert.equal(f.byRow["Q-A"].refused, 0,
    "a row the driver lost must never be counted as a row the seat got wrong");
  assert.deepEqual(f.byRow["Q-A"].reasons, { accepted_not_folded: 1 });
});

// ── 6. THE WIRING — THE AUDIT ACTUALLY READS THE LEDGER ─────────────────────────────────────────────
//
// Every test above exercises a pure function. None of them proves the AUDIT calls any of them, and "the
// recording was fixed and the misclassification left in place" is the specific way this change fails.
// `connotationAuditSeats` was already exported for exactly this reason; the numbers it feeds were not.

test("THE AUDIT READS THE LEDGER: the written artifact carries the calls and the drift", async () => {
  const { recordConnotationAudit } = await import("../pipeline.mjs");
  const rd = mkdtempSync(join(tmpdir(), "ct-1098-audit-"));
  mkdirSync(driverDir(rd), { recursive: true });
  const P = {
    commonLaw: join(rd, "common-law-findings.md"),
    commonLawGrid: join(rd, "common-law-grid.json"),
    commonLawHalf: (h) => join(rd, `common-law-findings.half-${h}.md`),
    commonLawGridHalf: (h) => join(rd, `common-law-grid.half-${h}.json`),
    commonLawDispositions: join(rd, "common-law-dispositions.json"),
    commonLawDispositionsHalf: (h) => join(rd, `common-law-dispositions.half-${h}.json`),
  };
  writeFileSync(P.commonLaw, "merged findings\n");
  // — a REAL one-batch ledger rather than "{}", so the audit has query strings to name. The first
  // entry is phrase-quoted on purpose: it is 's own input, and it makes this pin fail if a quote
  // transform is ever reintroduced on this path.
  writeFileSync(P.commonLawGrid, JSON.stringify({ cells: [], extras: { pr_risk: [
    { query: '"Project Sable" video game controversy', results: [] },
    { query: "chroma meaning slang", results: [] },
  ] } }));

  // The ledger the R5 seat would have left: one row refused repeatedly, its ruling moving under it.
  for (let seq = 1; seq <= 3; seq++)
    recordCallVerdict(P.commonLawDispositions, seq, {
      accepted: [], overflow: [], dropped: [],
      refused: [{ row_id: "Q-DRIFT", reason: "anchor_unbound", ruling: seq === 2 ? "loaded" : "benign",
        detail: "the anchor does not appear in the captured text of the receipt you ruled on (absent)" }],
    });

  recordConnotationAudit({ runDir: rd }, P);

  const artifact = JSON.parse(readFileSync(driverDir(rd, "connotation-receipts.json"), "utf8"));
  assert.equal(artifact.ledger.calls, 3,
    "the audit did not read the verdict ledger — the reasons are persisted and still invisible where anyone looks");
  assert.equal(artifact.ledger.seatsWithLedger, 1);
  assert.equal(artifact.rulingDrift.length, 1, "the drift detector is not wired into the audit");
  assert.deepEqual(artifact.rulingDrift[0].rulingSeq, ["benign", "loaded", "benign"]);
  assert.equal(artifact.rulingDrift[0].seat, "merged", "a two-half run needs to know WHICH seat moved");
  // — THE ORIGINAL PIN, UNDER THE NAME THAT SAYS WHAT IT COUNTS. The assertion is unchanged in
  // substance: the unruled-scoped histogram is empty here because nothing is outstanding, and that was
  // always correct. What changed is that it no longer occupies the name `refusalReasons`, which promised
  // every refusal and delivered a subset — the reading that cost 's criterion C a false MET.
  assert.equal(artifact.unruledRefusalReasons.anchor_unbound ?? 0, 0,
    "no obligation is outstanding in this fixture, so the addressed-but-unruled histogram must stay empty — it counts unruled rows, not every refusal");
  assert.equal(artifact.refusalReasons.anchor_unbound, 3,
    "and the LEDGER-wide histogram must carry all three refusals — this is the arm that fails on the old code");
  // The fields a reader of an archived run needs in order to tell an absence from a zero.
  for (const k of ["obligationsUnruled", "obligationsAddressedNotDischarged", "obligationsNeverAddressed"])
    assert.ok(Object.hasOwn(artifact, k), `the artifact is missing ${k}`);
  assert.equal(artifact.obligationsNeverAddressed + artifact.obligationsAddressedNotDischarged,
    artifact.obligationsUnruled, "the parts must sum to the total in the artifact, not only in the unit test");

  // ── — THE AUDIT NAMES WHAT IT COUNTED ──────────────────────────────────────────────────────
  //
  // This artifact reported `recordedQueries: 61` and no queries, so certifying a sanitizer defect from
  // it meant joining `_driver/grid-spec.json` and `common-law-grid*.json` first. The strings were never
  // lost; the file a reviewer opens simply did not carry them. The phrase-quoted entry rides verbatim —
  // that is the shape was about, and a peel anywhere on this path breaks this assertion.
  assert.deepEqual(artifact.queries,
    ['"Project Sable" video game controversy', "chroma meaning slang"],
    "the audit counts queries it does not name — a reviewer cannot certify #862 from the artifact it writes");
  assert.equal(artifact.queries.length, artifact.recordedQueries,
    "the count and the list are the same fact, or one of them is wrong");
  assert.deepEqual(artifact.seats[0].queries, artifact.queries,
    "per seat too — a two-half run needs to know WHICH half issued which query");
  assert.equal(artifact.seats[0].queries.length, artifact.seats[0].recordedQueries);
});

test("WITH NO LEDGER the artifact says so — an absence is not a zero", async () => {
  const { recordConnotationAudit } = await import("../pipeline.mjs");
  const rd = mkdtempSync(join(tmpdir(), "ct-1098-noledger-"));
  mkdirSync(driverDir(rd), { recursive: true });
  const P = {
    commonLaw: join(rd, "common-law-findings.md"),
    commonLawGrid: join(rd, "common-law-grid.json"),
    commonLawHalf: (h) => join(rd, `common-law-findings.half-${h}.md`),
    commonLawGridHalf: (h) => join(rd, `common-law-grid.half-${h}.json`),
    commonLawDispositions: join(rd, "common-law-dispositions.json"),
    commonLawDispositionsHalf: (h) => join(rd, `common-law-dispositions.half-${h}.json`),
  };
  writeFileSync(P.commonLaw, "merged findings\n");
  writeFileSync(P.commonLawGrid, "{}");

  recordConnotationAudit({ runDir: rd }, P);
  const artifact = JSON.parse(readFileSync(driverDir(rd, "connotation-receipts.json"), "utf8"));
  assert.equal(artifact.ledger.seatsWithLedger, 0,
    "a run with no ledger must report zero seats WITH one — otherwise 'nothing was refused' and 'we were not recording' read alike");
  assert.equal(artifact.ledger.calls, 0);
  assert.deepEqual(artifact.rulingDrift, []);
  assert.equal(artifact.obligationsAddressedNotDischarged, 0, "no evidence ⇒ no restatement");
});

// ── 7. — AN EMPTY HISTOGRAM BESIDE A LEDGER FULL OF REFUSALS ──────────────────────────────────
//
// R5 round `7a30934b`, TERMINAL, delivered CONDITIONAL. The receipts artifact:
//
//     "distinctReasons": 14, "refusalReasons": {}, "ledger": { "calls": 85 }
//
// against `verdicts.jsonl` holding 193 reason tokens over 8 distinct types, 85 of 85 records carrying a
// reason. `obligationsUnruled` was 0 — everything had been discharged by the end — so the partition
// returned no rows and the map the audit built from those rows was empty.
//
// **The number was right and the name was wrong.** `refusalReasons: {}` reads as "nothing was refused" on
// a run that refused 193 times, and 's pre-registered criterion C — which checked that the fields
// were PRESENT and that `ledger.calls` was non-zero — read MET while the histogram it exists to check was
// empty. Presence tested, content not.
//
// What the two arms below pin, and they are different questions:
//   · `refusalReasons`        — every refusal and drop the LEDGER recorded. Fails on the old code.
//   · `unruledRefusalReasons` — the reasons met by rows STILL UNRULED. Empty here, and correctly so;
//                               this is the old field's exact population under a name that says it.
test("#1171 — a discharged run still records what the seat MET, and the two populations are named apart", async () => {
  const { recordConnotationAudit } = await import("../pipeline.mjs");
  const rd = mkdtempSync(join(tmpdir(), "ct-1171-audit-"));
  mkdirSync(driverDir(rd), { recursive: true });
  const P = {
    commonLaw: join(rd, "common-law-findings.md"),
    commonLawGrid: join(rd, "common-law-grid.json"),
    commonLawHalf: (h) => join(rd, `common-law-findings.half-${h}.md`),
    commonLawGridHalf: (h) => join(rd, `common-law-grid.half-${h}.json`),
    commonLawDispositions: join(rd, "common-law-dispositions.json"),
    commonLawDispositionsHalf: (h) => join(rd, `common-law-dispositions.half-${h}.json`),
  };
  writeFileSync(P.commonLaw, "merged findings\n");
  writeFileSync(P.commonLawGrid, JSON.stringify({ cells: [], extras: { pr_risk: [
    { query: "novapulse offensive", results: [] },
    { query: "novapulse urban dictionary", results: [] },
  ] } }));

  // R5's shape in miniature: a heavy refusal loop over two rows, a third row ACCEPTED, one driver drop —
  // and nothing left outstanding at the end, which is the condition that emptied the old map.
  let seq = 0;
  for (let i = 0; i < 6; i++)
    recordCallVerdict(P.commonLawDispositions, ++seq, { accepted: [], overflow: [], dropped: [],
      refused: [{ row_id: "Q-1", reason: "fragment_unbound", ruling: "benign", detail: "d" }] });
  for (let i = 0; i < 4; i++)
    recordCallVerdict(P.commonLawDispositions, ++seq, { accepted: [], overflow: [], dropped: [],
      refused: [{ row_id: "Q-2", reason: "position_absent", ruling: "benign", detail: "d" }] });
  recordCallVerdict(P.commonLawDispositions, ++seq, { accepted: [], overflow: [],
    dropped: [{ row_id: "Q-2", reason: "accepted_not_folded", ruling: "benign" }], refused: [] });
  recordCallVerdict(P.commonLawDispositions, ++seq, { overflow: [], dropped: [], refused: [],
    accepted: [{ row_id: "Q-3", ruling: "benign" }] });

  recordConnotationAudit({ runDir: rd }, P);
  const a = JSON.parse(readFileSync(driverDir(rd, "connotation-receipts.json"), "utf8"));

  // THE ARM THAT FAILS ON THE OLD CODE.
  assert.deepEqual(a.refusalReasons, { fragment_unbound: 6, position_absent: 4, accepted_not_folded: 1 },
    "the artifact must carry every reason the ledger recorded — an empty map here is the R5 defect");

  // AND IT MATCHES THE LEDGER INDEPENDENTLY DERIVED, so the assertion is not just the code restated.
  const fold = foldCallVerdicts(readCallVerdicts(P.commonLawDispositions));
  assert.deepEqual(a.refusalReasons, ledgerReasonHistogram(fold),
    "the artifact's histogram and the ledger's own fold must agree — this is criterion 2");
  assert.equal(a.ledger.calls, 12);

  // CARDINALITY, AGAINST THE RIGHT NUMBER. The issue asked for this to equal `distinctReasons`; it must
  // not. `distinctReasons` is 's count of distinct executed query SHAPES (2 here — two dictated
  // shapes), and it is unrelated to refusal tokens (3 here). Asserting they agree would assert something
  // false, and the run that produced this issue is the proof: 14 shapes, 8 refusal types.
  assert.equal(a.distinctRefusalReasons, Object.keys(a.refusalReasons).length);
  assert.equal(a.distinctRefusalReasons, 3);
  assert.equal(a.distinctReasons, 2, "the query-shape scale is a different measurement and stays itself");
  assert.notEqual(a.distinctRefusalReasons, a.distinctReasons,
    "the two counts are unrelated by construction — pinning that stops the next reader conflating them again");

  // THE ROWS. `addressedRows` is legitimately empty (nothing outstanding); `callRows` is what "what did
  // the seat call, and how did it end" actually asks for, and it carries the accepted row.
  assert.deepEqual(a.addressedRows, [],
    "no obligation is outstanding, so the undischarged-evidence list is EMPTY and that is correct");
  assert.deepEqual(a.unruledRefusalReasons, {}, "same population, same emptiness, honest name");
  assert.equal(a.callRows.length, 3, "three rows were called — Q-1, Q-2, Q-3");
  assert.equal(a.callRows[0].row, "Q-1", "sorted by call volume: the loop is the first thing a reader sees");
  assert.equal(a.callRows[0].calls, 6);
  const accepted = a.callRows.find((r) => r.row === "Q-3");
  assert.equal(accepted.accepted, 1, "a run with accepted rows must show them — the artifact recorded none before");
  assert.deepEqual(ledgerRows(fold).map((r) => r.row), a.callRows.map((r) => r.row));

  // THE NEGATIVE CONTROL, and it is what proves the two populations genuinely differ rather than the
  // rename being cosmetic: the old fold's population is empty on this exact ledger.
  const split = partitionUnruledByLedger({ unruledTotal: 0, unruledRows: [], ledger: fold });
  assert.deepEqual(split.rows, [],
    "the old source of the histogram yields nothing here — which is why the old field read {} on R5");
  assert.ok(Object.keys(ledgerReasonHistogram(fold)).length > 0,
    "while the ledger it was folded from holds three reason types the whole time");
});

test("#1171 — the ledger helpers report an absence as an absence", () => {
  assert.deepEqual(ledgerReasonHistogram(null), {}, "no ledger is an empty histogram, never a throw");
  assert.deepEqual(ledgerReasonHistogram({ calls: 0, byRow: {} }), {});
  assert.deepEqual(ledgerRows(null), []);
  // A ledger with only ACCEPTED rows has no reasons and still has rows — the two are independent, and
  // collapsing them is how "nothing was refused" and "nothing happened" became the same sentence.
  const clean = foldCallVerdicts([{ seq: 1, accepted: [{ row_id: "Q-A", ruling: "benign" }], refused: [], dropped: [] }]);
  assert.deepEqual(ledgerReasonHistogram(clean), {});
  assert.deepEqual(ledgerRows(clean), [{ row: "Q-A", calls: 1, accepted: 1, refused: 0, dropped: 0, reasons: {} }]);
});
