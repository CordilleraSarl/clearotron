// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE GROUNDS CHECK IS INVOKED. That is the assertion; the classifier already has its own file.
//
// `grounds-grammar.mjs` and `grounds-grammar.test.mjs` landed together and are good: the negative arm is
// validated against the 24 real `loaded` notes e2e READ (not keyword-probed), and the checker is proven
// to fire on a planted violation before first use, exactly as the design spec asked.
//
// AND NOTHING CALLED IT. `grep` for `classifyGroundsNote` outside the test directory returned the module
// that defines it and nothing else — correct, tested, and reachable by no run. This repo has paid for
// that shape before: `compareWatches` was correct, tested and invoked by nothing for five days.
// A guard that has to be remembered is not a guard.
//
// So the load-bearing test here is the WIRING one: a run whose seat writes a describing note must come
// out of `recordConnotationAudit` with that verdict in the artifact. It fails if the call is deleted,
// which the classifier's own tests cannot do.
//
// IT RECORDS, IT DOES NOT REFUSE, and the tests pin that too. The module's header states that its
// `grounds` arm has no real example behind it — "the corpus contains no example of a note that states
// what could not be established" — so a refusal built on it would refuse the first seat that complies,
// and a permanently refused row is the live-lock. The run must still deliver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { formSidecarPath } from "../disposition-union.mjs";
import { DECLINED_RULING } from "../connotation-search.mjs";

const GRID = JSON.stringify({ cells: [], extras: { pr_risk: [{ query: "a meaning query", results: [] }] } });

// VERBATIM FROM THE CORPUS. Both are true statements about third-party web content and carry
// no identity. Neither says what could not be established, and that is the entire defect.
const DESCRIBES = "Article about real gang member sentenced for federal drug trafficking offense";
// What doctrine actually asks for: "state plainly what you could not establish and what a human should
// look at". No such note exists in the corpus — which is why this one is constructed and says so.
const STATES_GROUNDS = "Could not establish whether this refers to the applicant or an unrelated "
  + "namesake of the same surname; no source ties the conviction to the mark holder.";

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

const row = (row_id, ruling, note) => ({ row_id, kind: "connotation", query: `q for ${row_id}`,
  receipt_id: `r-${row_id}`, ruling, note });

/** The form the audit reads — `connotationAuditSeats` resolves it through `formSidecarPath`. */
function writeForm(dispositionsPath, rows) {
  const p = formSidecarPath(dispositionsPath);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify({ _provenance: "driver", rows }));
}

async function audit(setUp, prefix) {
  const { recordConnotationAudit } = await import("../pipeline.mjs");
  const { rd, P } = runDir(prefix);
  setUp(P);
  recordConnotationAudit({ runDir: rd }, P);
  return JSON.parse(readFileSync(driverDir(rd, "connotation-receipts.json"), "utf8"));
}

const merged = (rows) => (P) => {
  writeFileSync(P.commonLaw, "merged\n");
  writeFileSync(P.commonLawGrid, GRID);
  writeForm(P.commonLawDispositions, rows);
};

// ── the wiring — the assertion this file exists for ──────────────────────────────────────────────────

test("#919 THE CHECK RUNS: a describing note on a DECLINED row reaches the artifact as `description`", async () => {
  const a = await audit(merged([row("Q-ONE", DECLINED_RULING, DESCRIBES)]), "ct-919-wired-");
  assert.deepEqual(a.chargedNotes, { declined: 1, grounds: 0, description: 1, unclear: 0 },
    "the grounds grammar is not being invoked by the audit — the module is correct and unreachable");
});

test("#919 a note that STATES what could not be established reads as grounds", async () => {
  const a = await audit(merged([row("Q-ONE", DECLINED_RULING, STATES_GROUNDS)]), "ct-919-grounds-");
  assert.deepEqual(a.chargedNotes, { declined: 1, grounds: 1, description: 0, unclear: 0 });
});

test("#919 the corpus's real notes, carried on DECLINED rows: zero grounds", async () => {
  // What e2e measured by reading every note in three runs. If this ever comes out non-zero on these
  // inputs the classifier moved, not the seat — and 's premise needs re-reading before anyone
  // celebrates.
  //
  // THE CORPUS ITSELF CANNOT BE RE-MEASURED, and that is a fact about the archive, not a gap here. Every
  // one of those notes was written when `loaded` meant BOTH "this is charged" and "I could not tell" —
  // so no archived row can be sorted into the two now, by this test or by anything else. What survives
  // the split is the shape of the notes, which is what this arm pins: carried on rows that DO declare a
  // declination, real corpus prose still states no grounds. The population that answers honestly
  // is runs ruled under the four-value vocabulary, and there are none yet.
  const a = await audit(merged([row("Q-ONE", DECLINED_RULING, DESCRIBES),
    row("Q-TWO", DECLINED_RULING, "Wikipedia article documenting 1871 race riot, negative historical violence event")]),
  "ct-919-corpus-");
  assert.equal(a.chargedNotes.declined, 2);
  assert.equal(a.chargedNotes.grounds, 0, "a corpus note passed the grounds arm — re-read #919 before trusting it");
});

// ── scope: only charged rows, only once each ─────────────────────────────────────────────────────────

test("#919 a benign row is not classified — the instruction is about declined ratings", async () => {
  const a = await audit(merged([row("Q-ONE", "benign", "Dictionary sense, nothing adverse"),
    row("Q-TWO", "off-topic", "A different industry entirely")]), "ct-919-benign-");
  assert.deepEqual(a.chargedNotes, { declined: 0, grounds: 0, description: 0, unclear: 0 });
});

// ── THE SPLIT: `loaded` and the declination were one token, and the number graded both ───────────────

test("#919 A CONFIDENT `loaded` ROW IS NOT CLASSIFIED — its note answers a different contract", async () => {
  // THE DEFECT, DIRECTLY. `classifyGroundsNote` asks "does this note say what could not be established".
  // A confident charged ruling's note is supposed to say what the material IS — so every compliant one
  // scored `description`, and the count that was meant to measure declination notes was measuring the
  // right answer to another question. On origin/main this same input returns
  // { loaded: 1, grounds: 0, description: 1, unclear: 0 }.
  //
  // The grammar is untouched ( criterion 4 — the detector is NOT widened). Only its population is.
  const a = await audit(merged([row("Q-ONE", "loaded", DESCRIBES)]), "ct-919-confident-");
  assert.deepEqual(a.chargedNotes, { declined: 0, grounds: 0, description: 0, unclear: 0 },
    "a confident charged ruling is still being graded against the declination note contract");
});

test("#919 the two live side by side and only the declination is counted", async () => {
  const a = await audit(merged([row("Q-ONE", "loaded", DESCRIBES),
    row("Q-TWO", DECLINED_RULING, STATES_GROUNDS)]), "ct-919-both-");
  assert.deepEqual(a.chargedNotes, { declined: 1, grounds: 1, description: 0, unclear: 0 },
    "the mixed population is what made the old number unreadable");
});

test("#919 the declination ruling is a MEMBER of the closed set, so a seat can actually record it", async () => {
  // A code-side population no dictated vocabulary teaches is a population that stays empty forever.
  // `isRuled` accepts only RULINGS members, so this is what stands between the split and a dead arm.
  const { RULINGS } = await import("../connotation-search.mjs");
  assert.ok(RULINGS.includes(DECLINED_RULING),
    `the recorder filters on ${DECLINED_RULING}, which the validator would refuse on every row`);
});

test("#919 a run with no charged rating says so, rather than saying nothing", async () => {
  const a = await audit(merged([row("Q-ONE", "benign", "nothing adverse")]), "ct-919-zero-");
  assert.ok(Object.hasOwn(a, "chargedNotes"),
    "omitting the key makes 'no declined rating this run' unreadable from 'nobody looked' — #919's own history");
  // AND IT WILL READ ZERO ON EVERY RUN UNTIL DOCTRINE SHIPS. No archived run could emit the declination
  // ruling, so `declined: 0` means "no seat has used it yet", not "no seat declined". Written down here
  // because a zero on a fresh field is the reading that gets mistaken for a clean result.
  assert.equal(a.chargedNotes.declined, 0);
});

test("#919 THE SAME ROW IN TWO FORMS IS ONE ROW", async () => {
  // Every meaning row appears in the merged form AND in half-m's. e2e had to dedupe by (run, row_id) to
  // measure the corpus at all — "a raw count double-reports" — and an audit that double-counts would
  // report two charged rulings for one, which is the shape one field over.
  const rows = [row("Q-ONE", DECLINED_RULING, DESCRIBES)];
  const a = await audit((P) => {
    for (const h of ["a", "b", "m"]) {
      writeFileSync(P.commonLawGridHalf(h), GRID);
      writeFileSync(P.commonLawHalf(h), `half ${h}\n`);
      writeForm(P.commonLawDispositionsHalf(h), rows);
    }
  }, "ct-919-dedupe-");
  assert.equal(a.seats.length, 3, "the fixture did not produce three seats — it cannot exercise the double-count");
  assert.deepEqual(a.chargedNotes, { declined: 1, grounds: 0, description: 1, unclear: 0 },
    "one row carried by three forms was counted once per form");
});

test("#919 two charged rows that name no id are two rows, not one", async () => {
  // Deduping on a blank key would collapse them into one bucket and under-report the population. Both
  // are skipped instead — an unnameable row cannot be deduped against anything, and guessing is worse
  // than the gap it leaves.
  const a = await audit(merged([{ ...row("", DECLINED_RULING, DESCRIBES) }, { ...row("", DECLINED_RULING, DESCRIBES) }]),
    "ct-919-noid-");
  assert.equal(a.chargedNotes.declined, 0, "an unnameable declined row was counted as if it had an identity");
});

// ── it observes; it must not refuse ──────────────────────────────────────────────────────────────────

test("#919 a describing note does NOT become a defect, a refusal, or an unruled row", async () => {
  // The sequencing decision, pinned. The `grounds` arm has no real example behind it yet, so enforcing
  // on it would refuse the first seat that complies and park the row forever. Recording it makes
  // the next real round the evidence, at no risk to the run that produces it.
  const a = await audit(merged([row("Q-ONE", DECLINED_RULING, DESCRIBES)]), "ct-919-observes-");
  assert.equal(a.chargedNotes.description, 1);
  assert.deepEqual(a.formDefects, [], "the grounds verdict was routed into the defect list");
  assert.equal(a.obligationsUnruled, 0, "a declined row with a describing note is still RULED — it has a ruling");
});
