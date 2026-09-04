// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A REFUSAL THAT NAMES NO ROW IS STILL A REFUSAL, AND THE COUNT HAS TO SAY SO.
//
// 's first half — three seats folding one shared ledger — landed as `8efdb76e` and was verified on
// a three-half production round. Criterion 2 asks for the histogram to equal the ledger EXACTLY, and on
// that same round it was one short:
//
//     verdicts.jsonl      88 refusals over 6 tokens
//     refusalReasons      87, with unknown_row 25 against the ledger's 26
//
// Five of six tokens agreed exactly, so it was never an offset or a residue of the tripling. It was one
// record. THE CAUSE, measured on the artifact rather than reasoned about: one `unknown_row` refusal
// carries `row_id: ""`. `foldCallVerdicts` keys `byRow` by row id, `at("")` returns null, and `bump`
// returned before touching the histogram — the refusal, its reason and its ruling all dropped in
// silence. (The round's own read pointed at the park/release path across calls 33–35 as the place to
// look first, explicitly as a pointer and not a diagnosis. It is not that: park and release are not
// involved, and the same by-one reproduces on a fixture with no park in it at all.)
//
// THE ENTRY IS MINTED ON PURPOSE. `validateDispositionCall` records `row_id: ""` when the seat's
// `row_index` addresses no obligation in the list it was shown — refusing with an empty id rather than
// inventing one, so the fault stays on the record. Its header states the consequence it accepted: such a
// refusal "is invisible to the park bound ", because a row that cannot be named cannot be parked.
//
// THAT IS RIGHT FOR THE PARK AND WRONG FOR THE COUNT, and the difference is what this file pins. The
// fold now carries an `unattributed` bucket: counted, kept with its reason, and NOT keyed onto any row.
// So `refusalReasons` totals the ledger, and `byRow` — the park bound, the drift detector and the
// unruled partition — reads exactly the rows it read before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { recordCallVerdict, callRecordPaths, parkedRowIds, refusalCounts, readCallVerdicts } from "../disposition-tool.mjs";
import { foldCallVerdicts, ledgerReasonHistogram, ledgerRows, ledgerUnattributed, detectRulingDrift,
  partitionUnruledByLedger } from "../disposition-call.mjs";

const GRID = JSON.stringify({ cells: [], extras: { pr_risk: [{ query: "a meaning query", results: [] }] } });
const total = (h) => Object.values(h ?? {}).reduce((n, v) => n + v, 0);

function runDir(prefix) {
  const rd = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(driverDir(rd), { recursive: true });
  return {
    rd,
    P: {
      commonLaw: join(rd, "common-law-findings.md"),
      commonLawGrid: join(rd, "common-law-grid.json"),
      commonLawHalf: (h) => join(rd, `common-law-findings.half-${h}.md`),
      commonLawGridHalf: (h) => join(rd, `common-law-grid.half-${h}.json`),
      commonLawDispositions: join(rd, "common-law-dispositions.json"),
      commonLawDispositionsHalf: (h) => join(rd, `common-law-dispositions.half-${h}.json`),
    },
  };
}

// THE PRODUCTION SHAPE, SCALED DOWN. Named rows plus exactly one refusal that names none — the same
// one-in-N the round produced, so a fix that only works when the id-less entries are a large fraction
// would still fail here.
const REFUSALS = [
  { row_id: "Q-ONE", reason: "fragment_unbound" },
  { row_id: "Q-TWO", reason: "unknown_row" },
  { row_id: "", reason: "unknown_row" },        // the seat addressed an obligation that does not exist
  { row_id: "Q-ONE", reason: "fragment_unbound" },
];

/** @returns the number of refusal ENTRIES written — the number the histogram must reconcile against. */
function writeLedger(dispositionsPath, refusals = REFUSALS) {
  refusals.forEach((r, i) => recordCallVerdict(dispositionsPath, i + 1, {
    accepted: [], overflow: [], dropped: [],
    refused: [{ ...r, ruling: "benign", detail: "planted" }],
  }));
  return refusals.length;
}

async function audit(setUp, prefix) {
  const { recordConnotationAudit } = await import("../pipeline.mjs");
  const { rd, P } = runDir(prefix);
  const entries = setUp(P);
  recordConnotationAudit({ runDir: rd }, P);
  return { artifact: JSON.parse(readFileSync(driverDir(rd, "connotation-receipts.json"), "utf8")), entries, P };
}

// ── the defect, at the unit ──────────────────────────────────────────────────────────────────────────

test("#1241 the histogram totals the LEDGER, not only the rows it could name", () => {
  const ledger = foldCallVerdicts(REFUSALS.map((r) => ({ refused: [r] })));
  assert.equal(total(ledgerReasonHistogram(ledger)), REFUSALS.length,
    "one refusal named no row and vanished from the count — the by-one #1241 criterion 2 failed on");
  assert.equal(ledgerReasonHistogram(ledger).unknown_row, 2,
    "the token's own bucket is where the drop shows: two unknown_row refusals, one of them id-less");
});

test("#1241 BOTH id-less forms take the same path — an empty string and no key at all", () => {
  // The production artifact carried the empty-string form. The absent-key form is untested in the wild
  // and reaches `at()` identically, so it is pinned here rather than assumed.
  for (const [label, entry] of [["empty string", { row_id: "", reason: "unknown_row" }],
                                ["absent key", { reason: "unknown_row" }],
                                ["whitespace", { row_id: "   ", reason: "unknown_row" }]]) {
    const l = foldCallVerdicts([{ refused: [entry] }]);
    assert.equal(total(ledgerReasonHistogram(l)), 1, `${label}: the refusal was dropped from the count`);
    assert.equal(ledgerUnattributed(l).refused, 1, `${label}: not recorded as unattributed either`);
    assert.deepEqual(Object.keys(l.byRow), [], `${label}: an unnameable row was invented to hold it`);
  }
});

test("#1241 a DROP that names no row counts too, and says which it was", () => {
  const l = foldCallVerdicts([{ dropped: [{ reason: "duplicate_row" }], refused: [{ reason: "unknown_row" }] }]);
  assert.deepEqual(ledgerUnattributed(l), { refused: 1, dropped: 1, reasons: { unknown_row: 1, duplicate_row: 1 } });
});

test("#1241 an ACCEPTANCE with no row id is NOT counted — it never reached the form", () => {
  // Deliberate asymmetry. The union keys on row id, so an acceptance naming no row lands nowhere; giving
  // it a tally would assert work banked that did not. A refusal happened whatever it names.
  const l = foldCallVerdicts([{ accepted: [{ row_id: "", ruling: "benign" }] }]);
  assert.deepEqual(ledgerUnattributed(l), { refused: 0, dropped: 0, reasons: {} });
  assert.equal(l.calls, 1, "the CALL still happened and is still counted");
});

test("#1241 a ledger where every entry named a row says so, rather than saying nothing", () => {
  const l = foldCallVerdicts([{ refused: [{ row_id: "Q-ONE", reason: "fragment_unbound" }] }]);
  assert.deepEqual(ledgerUnattributed(l), { refused: 0, dropped: 0, reasons: {} },
    "an absent bucket and a bucket of zeros are different facts — the reader needs the second");
});

test("#1241 a fold from before the bucket existed still reads, and reads as zero", () => {
  // Archived runs and any caller holding an old fold. `{}` here is a fact about a ledger with no
  // unattributed entries, which is what those runs' folds are.
  assert.deepEqual(ledgerUnattributed({ calls: 3, byRow: {} }), { refused: 0, dropped: 0, reasons: {} });
  assert.deepEqual(ledgerUnattributed(null), { refused: 0, dropped: 0, reasons: {} });
});

// ── what must NOT have moved ─────────────────────────────────────────────────────────────────────────

test("#1241 the row-scoped readers see exactly the rows they saw before", () => {
  const ledger = foldCallVerdicts(REFUSALS.map((r) => ({ refused: [r] })));
  assert.deepEqual(Object.keys(ledger.byRow).sort(), ["Q-ONE", "Q-TWO"],
    "the id-less refusal was given a row of its own — inventing the row the seat could not name");
  assert.equal(ledgerRows(ledger).length, 2);
  assert.equal(ledgerRows(ledger).find((r) => r.row === "Q-ONE").refused, 2);
  // The drift detector and the unruled partition read `byRow` and nothing else, so pinning byRow pins
  // them. Asserted anyway, because "reads byRow" is a fact about today's code.
  assert.deepEqual(detectRulingDrift(ledger), [], "a single ruling per row is no drift");
  const split = partitionUnruledByLedger({ unruledTotal: 1, unruledRows: ["Q-ONE"], ledger });
  assert.equal(split.addressed, 1);
  assert.equal(split.neverAddressed, 0);
});

test("#1241 THE PARK BOUND CANNOT SEE THIS CHANGE — it does not read the fold at all", () => {
  // The load-bearing safety claim. `parkedRowIds` and `refusalCounts` walk the raw verdict records with
  // their own `if (id)` guard; neither calls `foldCallVerdicts`. So counting an id-less refusal in the
  // histogram cannot move a park decision, and 's cap is untouched by construction rather than by
  // inspection. A future refactor that routes the cap through the fold reddens here.
  const { rd, P } = runDir("ct-1241-park-");
  // 31 refusals of one row — one past the bound — beside id-less refusals that must never contribute.
  const many = [...Array(31)].map(() => ({ row_id: "Q-ONE", reason: "fragment_unbound" }));
  writeLedger(P.commonLawDispositions, [...many, { row_id: "", reason: "unknown_row" },
    { row_id: "", reason: "unknown_row" }]);
  const verdicts = readCallVerdicts(P.commonLawDispositions);

  assert.deepEqual(parkedRowIds(verdicts), ["Q-ONE"], "the bound stopped seeing the row it must park");
  assert.equal(refusalCounts(verdicts)["Q-ONE"], 31);
  assert.equal(Object.keys(refusalCounts(verdicts)).length, 1,
    "an id-less refusal reached the park's own evidence, where it cannot name a row to park");
  // …while the histogram counts all 33.
  assert.equal(total(ledgerReasonHistogram(foldCallVerdicts(verdicts))), 33);
  assert.ok(rd);
});

// ── the artifact ─────────────────────────────────────────────────────────────────────────────────────

test("#1241 SINGLE-half: the receipt reconciles against its own ledger", async () => {
  const { artifact, entries } = await audit((P) => {
    writeFileSync(P.commonLaw, "merged\n");
    writeFileSync(P.commonLawGrid, GRID);
    return writeLedger(P.commonLawDispositions);
  }, "ct-1241-by1-one-");
  assert.equal(artifact.ledger.seatsWithLedger, 1, "the fixture is not the single-seat shape it claims to be");
  assert.equal(total(artifact.refusalReasons), entries,
    `the receipt totals ${total(artifact.refusalReasons)} against a ledger of ${entries} refusals`);
  assert.deepEqual(artifact.unattributedRefusals, { refused: 1, dropped: 0, reasons: { unknown_row: 1 } });
});

test("#1241 THREE-half: criterion 2, on the shape the issue specifies", async () => {
  // A single-half run multiplies by one and proves nothing about the fold's scope — the issue says so in
  // as many words — so the exactness criterion is asserted where BOTH defects can show.
  const { artifact, entries, P } = await audit((P) => {
    for (const h of ["a", "b", "m"]) {
      writeFileSync(P.commonLawGridHalf(h), GRID);
      writeFileSync(P.commonLawHalf(h), `half ${h}\n`);
    }
    return writeLedger(P.commonLawDispositionsHalf("m"));
  }, "ct-1241-by1-three-");
  assert.equal(artifact.seats.length, 3, "the fixture did not produce three seats");
  const lines = readFileSync(callRecordPaths(P.commonLawDispositionsHalf("m"), 0).verdicts, "utf8")
    .split("\n").filter((l) => l.trim()).length;
  assert.equal(artifact.ledger.calls, lines, "#1241's first half: three seats folding one ledger");
  assert.equal(total(artifact.refusalReasons), entries, "#1241 criterion 2: EXACTLY, not approximately");
  assert.deepEqual(artifact.unattributedRefusals, { refused: 1, dropped: 0, reasons: { unknown_row: 1 } });
});

test("#1241 the receipt's two totals reconcile ON THE PAGE, by subtraction", async () => {
  // The point of the field. was filed because a reader met a scalar beside a map that disagreed
  // with it and had nothing to explain the difference. `refusalReasons` totals the ledger, `callRows`
  // totals the rows, and the gap between them is now a named number rather than a discrepancy.
  const { artifact } = await audit((P) => {
    writeFileSync(P.commonLaw, "merged\n");
    writeFileSync(P.commonLawGrid, GRID);
    return writeLedger(P.commonLawDispositions);
  }, "ct-1241-recon-");
  const rowTotal = artifact.callRows.reduce((n, r) => n + total(r.reasons), 0);
  const u = artifact.unattributedRefusals;
  assert.equal(total(artifact.refusalReasons) - rowTotal, u.refused + u.dropped,
    "the difference between the ledger's total and the rows' total is not what the artifact says it is");
});

test("#1241 the field is written on a clean run too, as zeros", async () => {
  const { artifact } = await audit((P) => {
    writeFileSync(P.commonLaw, "merged\n");
    writeFileSync(P.commonLawGrid, GRID);
    return writeLedger(P.commonLawDispositions, [{ row_id: "Q-ONE", reason: "fragment_unbound" }]);
  }, "ct-1241-clean-");
  assert.deepEqual(artifact.unattributedRefusals, { refused: 0, dropped: 0, reasons: {} },
    "omitting the key on a clean run makes 'nothing was unattributed' unreadable from 'nobody looked'");
});
