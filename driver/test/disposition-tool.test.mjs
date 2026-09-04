// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// B — THE TOOL SURFACE, exercised against real files on disk.
//
// disposition-call.mjs is pure and tested offline. This is the half that writes, so these tests write:
// a real ledger, a real accumulator, a real capture directory. Fixtures are built from the shapes the
// driver actually produces, never invented — a made-up row id once blessed a validator that refused all
// real work while formatting the refusal beautifully.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { recordDispositions, captureCall, callsSoFar, callRecordPaths, outstandingWithAnchors } from "../disposition-tool.mjs";
import { obligationRows, connotationObligations } from "../connotation-search.mjs";
import { formSidecarPath } from "../disposition-union.mjs";

const SNIPPET = "The 1871 Meridian race riot was a violent episode recorded in contemporary newspapers.";
// The PARSED projection — what parsePrRiskResults returns and what connotationObligations consumes.
// No `id` field anywhere: receipt ids are MINTED by the driver from url/title, and a fixture carrying
// invented ids would be testing a dataplane that does not exist.
const LEDGER = [
  { query: "a meaning query", results: [
    { title: "first", url: "https://e.test/1", snippet: SNIPPET },
    { title: "second", url: "https://e.test/2", snippet: "y".repeat(240) }] },
  { query: "a second meaning query", results: [
    { title: "only", url: "https://e.test/3", snippet: "z".repeat(240) }] },
];
// …and the ON-DISK shape it comes from: a batch array, meaning queries under `extras.pr_risk`. Read off
// parsePrRiskResults rather than imagined, because the first version of this fixture WAS imagined and
// every acceptance test failed with "the ledger records no meaning queries".
const ON_DISK = [{ extras: { pr_risk: LEDGER } }];
const FRAGMENT = "1871 Meridian race riot";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prelim-disp-tool-"));
  const runDir = join(root, "studio", "prelim-search", "tmp9001-novapulse", "2026-08-16-quiet-harbour");
  mkdirSync(driverDir(runDir), { recursive: true });
  const output_path = join(runDir, "common-law-grid.half-m.json");
  writeFileSync(output_path, JSON.stringify(ON_DISK, null, 2));
  const dispositions_path = join(runDir, "common-law-dispositions.half-m.form.json");
  return { root, runDir, spec: { output_path, half: "m", connotation: { dispositions_path } }, dispositions_path };
}

const rowsOf = () => obligationRows(connotationObligations(LEDGER));
const rowId = (i) => rowsOf()[i].row_id;
// — a call row is addressed by its POSITION in the driver's obligation list. `rowId` survives for
// the assertions that read the ACCUMULATOR, which is still keyed by the driver's own row id: what moved
// is what the seat types, not what the driver stores.
const at = (i) => i + 1;
const idOf = (r, c) => rowsOf()[r].candidates[c].receipt_id;

// ── THE HAPPY PATH, END TO END ──────────────────────────────────────────────────────────────────────

test("a typed call is recorded, and the driver writes the document", () => {
  const f = fixture();
  const r = recordDispositions(f.spec, { rows: [
    { row_index: at(0), ruling: "benign", note: "a dictionary entry", receipt_index: 1, segment_index: 1, fragment: FRAGMENT },
  ] });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.accepted, 1);
  assert.equal(r.refused, 0);

  // The accumulator carries the row, with the DRIVER's id — never a string the seat typed.
  const accum = JSON.parse(readFileSync(formSidecarPath(f.dispositions_path), "utf8"));
  const row = accum.rows.find((x) => x.row_id === rowId(0));
  assert.equal(row.ruling, "benign");
  assert.equal(row.receipt_id, idOf(0, 0));
  assert.ok(row.quote, "the driver's extract, copied out of its own captured snippet");
  // B — and there is NO seat-facing copy: the accumulator is the one file. A mirror nothing reads is a
  // second writer waiting to drift, and the seat never opens any dispositions file.
  assert.ok(!existsSync(f.dispositions_path), "no seat-facing mirror is written");
});

test("the seat never types a document, so a typographic quote cannot void anything", () => {
  // The 2026-08-15 failure in one line: a curly quote in a note is now just text in a JSON string the
  // DRIVER serializes. Under the old transport this exact character stopped the file parsing at char 2535
  // and 74 correct rulings were judged as "not one edit".
  const f = fixture();
  const r = recordDispositions(f.spec, { rows: [
    { row_index: at(0), ruling: "benign", note: "the entry reads “wholly historical” here", receipt_index: 1, segment_index: 1, fragment: FRAGMENT },
  ] });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.accepted, 1);
  const accum = JSON.parse(readFileSync(formSidecarPath(f.dispositions_path), "utf8"));
  assert.match(accum.rows.find((x) => x.row_id === rowId(0)).note, /wholly historical/);
});

// ── DECISION 3 — THE CAPTURE. The constraint most likely to be "simplified" away later. ─────────────

test("the payload is captured AS RECEIVED, before anything is decided about it", () => {
  const f = fixture();
  // Two rows: one that will be accepted, one that will be refused by name. BOTH must appear in the
  // capture — a payload pruned to what we accepted is not evidence about what was sent.
  recordDispositions(f.spec, { rows: [
    { row_index: at(0), ruling: "benign", note: "ok", receipt_index: 1, segment_index: 1, fragment: FRAGMENT },
    { row_index: at(1), ruling: "benign", note: "n", receipt_id: "R-RECEIPT" },
  ] });
  const { payload } = callRecordPaths(f.dispositions_path, 1);
  const cap = JSON.parse(readFileSync(payload, "utf8"));
  assert.equal(cap.rowCount, 2);
  assert.equal(cap.rows.length, 2, "the refused row is in the capture too");
  assert.equal(cap.rows[1].receipt_id, "R-RECEIPT",
    "including the field this transport does NOT accept — what was sent, not what we kept");
});

test("the index is written by the RECEIVER, and it names the payload", () => {
  // 's three snapshot sites all discard their return, so no attempt row names its snapshot and
  // correlation is by mtime — which is how the union discard had to be diagnosed by hand. The line is
  // written here, by the process that received the call.
  const f = fixture();
  recordDispositions(f.spec, { rows: [{ row_index: at(0), ruling: "benign", note: "ok", receipt_index: 1, segment_index: 1, fragment: FRAGMENT }] });
  const { index, payload } = callRecordPaths(f.dispositions_path, 1);
  const line = JSON.parse(readFileSync(index, "utf8").trim().split("\n")[0]);
  assert.equal(line.seq, 1);
  assert.equal(line.rowCount, 1);
  assert.ok(existsSync(payload), "the payload the index names must exist");
  assert.equal(line.payload, "call-001.json");
});

test("a capture written BEFORE the work means a payload with no verdict is a FACT, not an inference", () => {
  // captureCall is called on its own here, exactly as the handler calls it first: the record exists
  // before any decision. If the process died at this instant the payload and its index line would both
  // stand, which is the only way "a call arrived and never returned" can be told from "no call was made".
  const f = fixture();
  const cap = captureCall(f.dispositions_path, 1, { rows: [{ row_index: 1 }] });
  assert.equal(cap.ok, true);
  assert.ok(existsSync(cap.payload));
  assert.equal(callsSoFar(f.dispositions_path), 1, "and it counts toward the ceremony budget immediately");
});

// SKIPPED under root rather than returned early: root ignores a directory's write bit, so the 0o500 below
// refuses nothing, the capture lands and `cap.ok` is correctly true — the red is this harness's, not the
// receiver's. An early `return` would report `ok` for a test that asserted nothing, so the reason is
// declared on the line where a reader of the output can see it.
test("a capture that cannot be written does not cost the seat its call",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  // Best-effort by construction, and REPORTED rather than swallowed: "captured" and "capture failed" are
  // different facts. The rows are real work either way.
  const f = fixture();
  const dDir = driverDir(f.runDir);
  chmodSync(dDir, 0o500);                       // no writing inside _driver/
  try {
    const cap = captureCall(f.dispositions_path, 1, { rows: [] });
    assert.equal(cap.ok, false);
    assert.ok(cap.why, "the failure is named, not silent");
  } finally { chmodSync(dDir, 0o700); }
});

// ── ACCUMULATION ACROSS CALLS ───────────────────────────────────────────────────────────────────────

test("a second call ADDS to the first — chunking never costs a seat its earlier rows", () => {
  // The old transport's whole disease was all-or-nothing. A transport that loses call 1 when call 2
  // arrives has re-created it one layer down.
  const f = fixture();
  const a = recordDispositions(f.spec, { rows: [{ row_index: at(0), ruling: "benign", note: "first", receipt_index: 1, segment_index: 1, fragment: FRAGMENT }] });
  assert.equal(a.accepted, 1);
  const b = recordDispositions(f.spec, { rows: [{ row_index: at(1), ruling: "benign", note: "second", receipt_index: 1, segment_index: 1, fragment: "z".repeat(40) }] });
  assert.equal(b.accepted, 1, b.text);
  const accum = JSON.parse(readFileSync(formSidecarPath(f.dispositions_path), "utf8"));
  assert.equal(accum.rows.find((x) => x.row_id === rowId(0)).note, "first", "call 1's row survived call 2");
  assert.equal(accum.rows.find((x) => x.row_id === rowId(1)).note, "second");
  assert.equal(b.seq, 2, "and the calls are numbered in sequence");
  assert.equal(b.outstanding, 0, "nothing left owed");
});

// ── THE ANSWER CARRIES EVIDENCE-OWED, OR A SEAT IS JUDGED ON WHAT IT WAS NEVER SHOWN ───────────────

test("the answer names which outstanding rows owe a POINTER and a PROOF", () => {
  // The obligations block never names `quote_required`, and B removes the form the seat used to read it
  // from. This answer is the ONLY place a seat can learn it.
  const f = fixture();
  const r = recordDispositions(f.spec, { rows: [{ row_index: at(0), ruling: "benign", note: "ok", receipt_index: 1, segment_index: 1, fragment: FRAGMENT }] });
  // — named by its NUMBER. The id was a token the seat had never been shown anywhere, so the one
  // message whose job is "here is what is left" was written in a vocabulary its reader did not have.
  assert.match(r.text, new RegExp(`row ${at(1)} .*needs \`segment_index\`.*\`fragment\``),
    "the row still owed must name BOTH fields — a seat told only 'evidence' supplies one of them, and a seat told only 'outstanding' re-rules a row it already judged");
});

test("a row RULED without the evidence it owes is named as ruled-but-owing, not as unanswered", () => {
  // Different work: a seat told only "outstanding" would re-rule a row it had already judged. This is
  // also the shape a mid-turn top-up produces, where an accepted row GROWS an evidence obligation.
  const rows = rowsOf();
  const owing = rows.filter((r) => r.quote_required);
  assert.ok(owing.length, "VOID CONTROL: the fixture must produce at least one evidence-owing row");
  const left = outstandingWithAnchors(rows, [{ row_id: owing[0].row_id, ruling: "benign", note: "n", receipt_id: "R-X", quote: "" }]);
  const hit = left.find((l) => l.row_id === owing[0].row_id);
  assert.ok(hit?.row_index, "#1173 — the answer carries the number the seat counts off, not only the driver's id");
  assert.ok(hit, "a ruled row that owes unmet evidence is still outstanding");
  assert.equal(hit.evidence_owed, true);
  assert.equal(hit.ruled, true, "and it is marked as already ruled, so the seat adds the evidence rather than re-ruling");
});

// ── REFUSALS REACH THE SEAT AS SENTENCES IT CAN ACT ON ──────────────────────────────────────────────

test("a refused row is refused BY NAME and the rest of the call is kept", () => {
  const f = fixture();
  const r = recordDispositions(f.spec, { rows: [
    { row_index: at(0), ruling: "benign", note: "ok", receipt_index: 1, segment_index: 1, fragment: FRAGMENT },
    { row_index: at(1), ruling: "benign", note: "n", receipt_id: "R-RECEIPT" },
  ] });
  assert.equal(r.accepted, 1, "the good row landed");
  assert.equal(r.refused, 1);
  assert.match(r.text, /POSITION/, "and the refusal says what to do instead");
  const accum = JSON.parse(readFileSync(formSidecarPath(f.dispositions_path), "utf8"));
  assert.equal(accum.rows.find((x) => x.row_id === rowId(0)).note, "ok");
});

// ── DRIVER FAULTS ARE NAMED AS OURS ─────────────────────────────────────────────────────────────────

test("a half that owns no form says so, instead of failing obscurely", () => {
  const f = fixture();
  const r = recordDispositions({ ...f.spec, connotation: {} }, { rows: [] });
  assert.equal(r.ok, false);
  assert.match(r.text, /owns no disposition form/);
});

test("a ledger that is not on disk yet is named as such, and not as a bad call", () => {
  const f = fixture();
  const r = recordDispositions({ ...f.spec, output_path: join(f.runDir, "absent.json") }, { rows: [] });
  assert.equal(r.ok, false);
  assert.match(r.text, /Run the grid first/);
});

// ── VOID CONTROLS ───────────────────────────────────────────────────────────────────────────────────

test("VOID CONTROL: the fixture's ledger really does produce obligations", () => {
  // Every acceptance test above would pass identically against a ledger yielding no rows, because an
  // empty obligation set accepts nothing and refuses nothing.
  const rows = rowsOf();
  assert.ok(rows.length >= 2, `the fixture must produce at least two obligation rows; got ${rows.length}`);
  assert.ok(rows.some((r) => r.quote_required), "and at least one that owes a pointer and a proof");
  assert.ok(rows[0].candidates.length >= 2, "and one row with a real choice to make");
});

test("VOID CONTROL: nothing was recorded before the first call", () => {
  const f = fixture();
  assert.equal(callsSoFar(f.dispositions_path), 0);
  assert.equal(existsSync(formSidecarPath(f.dispositions_path)), false,
    "the accumulator must not pre-exist, or the accumulation tests are measuring a file they did not write");
});

// ── — THE RECORDER IS HANDED THE WHOLE CALL, AND THE ARCHIVE CARRIES IT BACK ─────
//
// The server destructured `{ grid_spec_path, rows }` and then passed a freshly built `{ rows }` on, so
// the field was gone one line before the capture ran. The capture wrote what it was given and stamped it
// "the typed call as RECEIVED" — true of the tool, false of the call. 38 of 38 archived payloads carried
// no `grid_spec_path`, and an audit replaying them read that as a transport omitting a field its own
// acceptor refuses a call without. The archive was never lossy; the call was narrowed before it arrived.
test("2026: a field the recorder was handed reaches the archived payload", () => {
  const f = fixture();
  const r = recordDispositions(f.spec, {
    grid_spec_path: "/run/_driver/grid-spec.json",
    rows: [{ row_index: at(0), ruling: "benign", note: "a dictionary entry", receipt_index: 1, segment_index: 1, fragment: FRAGMENT }],
  });
  assert.equal(r.ok, true, r.text);

  const dir = callRecordPaths(f.spec.connotation.dispositions_path, 1).dir;
  const payload = JSON.parse(readFileSync(join(dir, "call-001.json"), "utf8"));
  assert.equal(payload.grid_spec_path, "/run/_driver/grid-spec.json",
    "a field carried on the call did not reach the archive. That is what made 38 archived payloads look "
    + "like a transport omitting a required field, when the field had been dropped before the capture");
  assert.ok(Array.isArray(payload.rows) && payload.rows.length === 1, "…and the rows still land, unchanged");
});
