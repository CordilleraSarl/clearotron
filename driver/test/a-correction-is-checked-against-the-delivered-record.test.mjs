// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the corrections-delivered record, on invented records
//
// A CORRECTION IS CHECKED AGAINST THE RECORD THE REPORT WAS BUILT FROM.
//
// corrections-applied.json says what the corrective pass changed, flag by flag, at the pass. Whether the change
// is still there when the report is assembled is another question: later saves re-send the record, the delivery
// seam folds it, and the report is built after all of them. The corrective pass now keeps a basis — what each
// flag changed in the fields a report prints from the record — and every assembly reads it against the
// delivered record, writing `_driver/corrections-delivered.json` and one run-log row. corrections-applied.json
// and the open points built from it are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths as stagePaths } from "../stages.mjs";
import { assembleReportMd } from "../pipeline.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE } from "../reviewer-open-points.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const delivered = async () => {
  try { return await import("../corrections-delivered.mjs"); }
  catch (e) { assert.fail(`the corrections-delivered module cannot be loaded: ${String(e?.message ?? e).slice(0, 120)}`); }
};

const THREE = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
/** A parsed-shape record whose findings are `[owner, mark]` pairs. */
function record(rows = THREE) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc,
    coverage: [{ area: "the invented register", state: "coverage-limited", note: "Searched to the second page only." }],
    actions: [{ id: 1, kind: "condition", text: "Ask the applicant whether the earlier mark is still in use.", ordinals: [1] }],
    findings: rows.map(([owner, mark], i) => {
      const f = structuredClone(base);
      f.ordinal = i + 1;
      f.mark = mark;
      f.owner.name = owner;
      f.net = `${owner}'s ${mark} is unlikely to prevail against the applied-for mark in the searched class.`;
      f.legal_position = `The legal position on ${mark} as first written.`;
      f.practical_position = `The practical position on ${mark} as first written.`;
      return f;
    }) };
}
const flag = (n, over) => ({ n, kind: "fact", typed: true, text: "an invented flag", ordinals: null, targets: [], removed: [], ...over });

test("each field a correction changed is found where the delivered record carries it", async () => {
  const { correctionTargets, deliveredOutcomes } = await delivered();
  const pre = record();
  const post = structuredClone(pre);
  post.findings[1].net = "Quillmere Ltd's ODRAVEL is more likely than not to prevail in the searched class.";
  post.findings[1].legal_position = "The corrected legal position on ODRAVEL.";
  post.coverage[0].note = "Searched to completeness on the named band.";
  post.actions[0].text = "Ask the applicant for the date the earlier mark was last used.";
  const rows = [
    flag(1, { ordinals: [2], targets: ["ODRAVEL"], outcome: "findings-changed" }),
    flag(2, { text: "the coverage line for \"the invented register\" overstates the search", outcome: "line-changed" }),
    flag(3, { text: "the action \"1\" asks the wrong question", outcome: "line-changed" }),
  ];
  const basis = correctionTargets(rows, pre, post);
  assert.deepEqual(basis[0].changes.map((c) => c.field), ["net", "legal_position"], "the basis does not hold what the flag changed");
  const out = deliveredOutcomes({ basis, deliveredDoc: post, reportMd: `- net: ${post.findings[1].net}\n${post.actions[0].text}\n` });
  assert.deepEqual(out.map((r) => r.outcome), ["delivered", "delivered", "delivered"]);
  assert.deepEqual(out[0].changes.map((c) => [c.field, c.inReportMd]), [["net", true], ["legal_position", null]],
    "report.md is consulted for the finding sentence alone among a finding's fields");
  assert.equal(out[2].changes[0].inReportMd, true, "report.md is not consulted for an action's text");
});

test("a correction a later save did not carry is not found, and the outcome says which field", async () => {
  const { correctionTargets, deliveredOutcomes } = await delivered();
  const pre = record();
  const post = structuredClone(pre);
  post.findings[1].net = "Quillmere Ltd's ODRAVEL is more likely than not to prevail in the searched class.";
  const basis = correctionTargets([flag(1, { ordinals: [2], targets: ["ODRAVEL"], outcome: "findings-changed" })], pre, post);
  const later = structuredClone(pre);   // a later whole re-send put the first sentence back
  const [row] = deliveredOutcomes({ basis, deliveredDoc: later, reportMd: `- net: ${pre.findings[1].net}\n` });
  assert.equal(row.outcome, "not-found");
  assert.deepEqual(row.changes.map((c) => [c.ordinal, c.field, c.inRecord, c.inReportMd]), [[2, "net", false, false]]);
});

test("a correction that changed no printed field is not applicable, and one with no record before the pass is not checkable", async () => {
  const { correctionTargets, deliveredOutcomes } = await delivered();
  const pre = record();
  const post = structuredClone(pre);
  post.findings[0].band = "Low";   // a rating moved; no sentence did
  const rows = [
    flag(1, { text: "the narrative's second paragraph overstates the crowd", outcome: "not-entity-scoped" }),
    flag(2, { ordinals: [3], targets: ["MARVETTE"], outcome: "findings-unchanged" }),
    flag(3, { ordinals: [1], targets: ["TESSARIN"], outcome: "findings-changed" }),
  ];
  const out = deliveredOutcomes({ basis: correctionTargets(rows, pre, post), deliveredDoc: post });
  assert.deepEqual(out.map((r) => r.outcome), ["not-applicable", "not-applicable", "not-applicable"]);
  const blind = deliveredOutcomes({ basis: correctionTargets(rows, null, post), deliveredDoc: post });
  assert.deepEqual(blind.map((r) => r.outcome), ["not-checkable", "not-checkable", "not-checkable"]);
  assert.equal(deliveredOutcomes({ basis: correctionTargets(rows, pre, post), deliveredDoc: null }), null,
    "an unreadable delivered record was answered as if it had been read");
});

test("after the delivery seam a correction is found through the fold's map, and one on a folded-away filing is not", async () => {
  const { correctionTargets, deliveredOutcomes } = await delivered();
  const pre = record([["Qorvalen Holdings", "PRUNDELIQ"], ["Qorvalen Holdings", "PRUNDELIQ"], ["Brannick Tooling", "ORVANTE"]]);
  const post = structuredClone(pre);
  post.findings[2].legal_position = "The corrected legal position on ORVANTE.";
  post.findings[1].legal_position = "A correction made on the second filing, which the fold drops.";
  const basis = correctionTargets([flag(1, { ordinals: [3], outcome: "findings-changed" }), flag(2, { ordinals: [2], outcome: "findings-changed" })], pre, post);
  // the delivered record: model 1 and 2 folded into 1 (model 1 kept), model 3 renumbered 2
  const deliveredDoc = { ...post, findings: [{ ...post.findings[0], ordinal: 1 }, { ...post.findings[2], ordinal: 2 }] };
  const foldMap = { modelToFolded: { 1: 1, 2: 1, 3: 2 }, foldedToModel: { 1: [1, 2], 2: [3] } };
  const [renumbered, foldedAway] = deliveredOutcomes({ basis, deliveredDoc, foldMap });
  assert.equal(renumbered.outcome, "delivered", "a correction on a renumbered finding was not found at its folded ordinal");
  assert.equal(renumbered.changes[0].deliveredAs, 2);
  assert.equal(foldedAway.outcome, "not-found", "a correction the fold dropped read as delivered");
});

// ── THROUGH THE ASSEMBLY ─────────────────────────────────────────────────────────────────────────────

function assembledRun() {
  const dir = mkdtempSync(join(tmpdir(), "corrections-delivered-"));
  const P = stagePaths(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "report-cards"), { recursive: true });
  const doc = record();
  doc.findings[1].net = "Quillmere Ltd's ODRAVEL is more likely than not to prevail in the searched class.";
  writeFileSync(P.findings, JSON.stringify(doc, null, 2) + "\n");
  for (const f of doc.findings) writeFileSync(P.reportCard(String(f.ordinal)), `## ${f.mark} — ${f.owner.name}\n- ord: ${f.ordinal}\n\nThe card's own words.\n`);
  // the review and the applied table the open points are built from
  writeFileSync(P.seniorEyeReview, "VERDICT: CONDITIONAL\n\n## Corrections\n1. [kind: fact] ODRAVEL's sentence overstates the risk.\n");
  writeFileSync(P.correctionsApplied, JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", verdict: "CONDITIONAL",
    rows: [flag(1, { ordinals: [2], targets: ["ODRAVEL"], outcome: "findings-unchanged" })] }, null, 2) + "\n");
  return { dir, P, doc };
}
const runLogRows = (dir) => (existsSync(driverDir(dir, "run.jsonl")) ? readFileSync(driverDir(dir, "run.jsonl"), "utf8") : "")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === "corrections-delivered");

test("every assembly records whether each correction reached the record it was built from", () => {
  const { dir, P, doc } = assembledRun();
  try {
    // the basis the corrective pass kept: the second finding's sentence, as the pass left it
    writeFileSync(driverDir(dir, "corrections-delivered.json"), JSON.stringify({
      basisAt: "2026-01-01T00:00:00.000Z",
      basis: [{ n: 1, kind: "fact", applied: "findings-changed", changes: [{ ordinal: 2, field: "net", text: doc.findings[1].net }] }],
    }, null, 2) + "\n");
    assembleReportMd(P, doc.findings, [1, 2, 3]);
    const held = JSON.parse(readFileSync(driverDir(dir, "corrections-delivered.json"), "utf8"));
    assert.ok(Array.isArray(held.rows), "the assembly wrote no delivery record");
    assert.deepEqual(held.rows.map((r) => r.outcome), ["delivered"]);
    assert.deepEqual(held.rows[0].changes.map((c) => [c.field, c.inRecord, c.inReportMd]), [["net", true, true]]);
    assert.deepEqual(runLogRows(dir).map((e) => [e.ok, e.flags, e.outcomes]), [[true, 1, { delivered: 1 }]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an assembly with no corrective basis writes no delivery record, and the open points are built as they were", () => {
  const { dir, P, doc } = assembledRun();
  try {
    const appliedBefore = readFileSync(P.correctionsApplied, "utf8");
    assembleReportMd(P, doc.findings, [1, 2, 3]);
    assert.equal(existsSync(driverDir(dir, "corrections-delivered.json")), false);
    assert.deepEqual(runLogRows(dir), []);
    assert.equal(readFileSync(P.correctionsApplied, "utf8"), appliedBefore, "the assembly changed corrections-applied.json");
    const openPoints = readdirOpenPoints(dir);
    assert.notEqual(openPoints, null, "premise: the assembly built the open points from the review and the applied table");
    // the same assembly with a basis present builds the same open points
    writeFileSync(driverDir(dir, "corrections-delivered.json"), JSON.stringify({ basisAt: "x", basis: [] }) + "\n");
    assembleReportMd(P, doc.findings, [1, 2, 3]);
    assert.equal(readdirOpenPoints(dir), openPoints, "the open points changed when a delivery basis was present");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
function readdirOpenPoints(dir) {
  const at = driverDir(dir, REVIEWER_OPEN_QUESTIONS_FILE);
  return existsSync(at) ? readFileSync(at, "utf8") : null;
}

test("the corrective pass keeps its basis beside the applied table, never inside it", async () => {
  const { recordCorrectionsBasis } = await import("../pipeline.mjs");
  assert.equal(typeof recordCorrectionsBasis, "function", "the corrective pass has no way to keep a delivery basis");
  const { dir, P } = assembledRun();
  try {
    const appliedBefore = readFileSync(P.correctionsApplied, "utf8");
    const pre = record(), post = structuredClone(pre);
    post.findings[1].net = "Quillmere Ltd's ODRAVEL is more likely than not to prevail in the searched class.";
    recordCorrectionsBasis(dir, [flag(1, { ordinals: [2], targets: ["ODRAVEL"], outcome: "findings-changed" })], pre, post);
    const held = JSON.parse(readFileSync(driverDir(dir, "corrections-delivered.json"), "utf8"));
    assert.deepEqual(held.basis[0].changes, [{ ordinal: 2, field: "net", text: post.findings[1].net }]);
    assert.equal(readFileSync(P.correctionsApplied, "utf8"), appliedBefore, "keeping the basis changed corrections-applied.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
