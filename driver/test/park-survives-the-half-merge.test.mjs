// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A PARK SURVIVES THE HALF-TO-CANONICAL MERGE.
//
// THE INCIDENT, and it is the P0's promise broken at a third seam. A run died deterministically on three
// rows the seat had correctly declared unquotable: it took 's obstacle exit, the park was written
// properly into the half's form — `parked: true`, `parked_kind: "declared"`, the seat's own sentence,
// two refusals — and the MERGE cleared all four fields. The canonical validator then read three ruled
// rows still owing a quote, refused the document, and the run ended with no recovery by class.
//
// THE DEFECT WAS THE CALL SITE, NOT THE UNION. `unionDispositionForm` reconstructs a park from `s.obstacle`
// — a LIVE submission field never persisted into a form — or from `p.parked`. pipeline.mjs handed it an
// EMPTY prior and the halves' PERSISTED rows on the seat side, so both sources missed. The same function
// is park-correct at its two other call sites. A module-level reader enumeration cannot see that: it
// counts modules, and this module was on the list. So the assertions below come in two kinds — the
// behaviour, and the CALL SITE that decides which mode the behaviour runs in.
//
// EVERYTHING ROUND-TRIPS THROUGH `parseDispositionForm`, because that is what the merge actually reads.
// A park that survives the union in memory and is dropped by the parse whitelist is the same outage with
// a different owner, and only the round trip can tell the two apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connotationObligations, obligationRows, findConnotationViolations, parseDispositionForm,
  connotationAuditCounts } from "../connotation-search.mjs";
import { unionDispositionForm } from "../disposition-union.mjs";
import { validateDispositionCall } from "../disposition-call.mjs";

const SNIP = "A long enough passage of captured text to be usable for a spot check on this row.";
const RECORDED = [{ query: "a meaning query", results: [
  { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIP }] }];
const OB = connotationObligations(RECORDED);
const ID = obligationRows(OB)[0].row_id;
const AT = 1;
const DOC = ["## Connotation / meaning", "Meaning sweep ran; nothing loaded.",
  "- **Connotation-search source:** https://e.test/1"].join("\n");

const census = (form) => findConnotationViolations(DOC, 1, { recorded: RECORDED, form: form.rows });

/** A half's own union — the shape disposition-tool.mjs produces before it writes the sidecar. */
const half = (submitted, opts = {}) =>
  unionDispositionForm({ rows: [] }, { rows: submitted }, OB, { half: "b", ...opts });

/** The seat declaring it cannot evidence the row: 's honest exit. */
const declaredRow = () => validateDispositionCall([{ row_index: AT, ruling: "loaded", note: "n",
  receipt_index: 1, obstacle: "every passage is an elision marker" }], RECORDED).accepted;

/**
 * Persist a half form and read it back exactly as pipeline.mjs does, then merge. `refusals` is applied
 * the way disposition-tool.mjs applies it — after the union, on the row it parked — so the fixture
 * carries a count no hand-written row would have to be trusted for.
 */
function mergeOf(halfUnion, { refusals = 0, legacyArgumentOrder = false } = {}) {
  for (const r of halfUnion.form.rows) if (r.parked && refusals > (Number(r.parked_refusals) || 0)) r.parked_refusals = refusals;
  const onDisk = JSON.stringify(halfUnion.form, null, 2) + "\n";
  const halfRows = parseDispositionForm(onDisk).rows ?? [];
  assert.ok(halfRows.length, "the half form did not survive its own round trip — the fixture is broken");
  return legacyArgumentOrder
    ? unionDispositionForm({ rows: [] }, { rows: halfRows }, OB, { generatedFrom: "common-law-grid.json" })
    : unionDispositionForm({ rows: halfRows }, { rows: null }, OB, { generatedFrom: "common-law-grid.json" });
}

const parkedRow = (u) => u.form.rows.find((r) => r.row_id === ID);

// ── the two park kinds, each across the boundary ─────────────────────────────────────────────────────

test("#1277 a DECLARED park survives the merge with its kind, its sentence and its count", () => {
  const h = half(declaredRow());
  assert.equal(h.parked, 1, "the fixture did not park in the half — the merge below would prove nothing");
  const m = mergeOf(h, { refusals: 2 });
  const row = parkedRow(m);
  assert.equal(m.parked, 1, "the merge lost the park — this is the outage");
  assert.equal(row.parked, true);
  assert.equal(row.parked_kind, "declared", "the merge kept the park and lost which kind it was");
  assert.match(row.parked_reason, /elision marker/, "the seat's own account of why the row is undecided was dropped");
  assert.equal(row.parked_refusals, 2, "the cost the run really spent was reset to zero");
});

test("#1277 an EXHAUSTED park survives the merge too — this is not specific to the declared exit", () => {
  // `wasParked` reads only the prior, so ANY park erased at the merge. An exhausted park at the bound
  // vanished identically from the day the park shipped; the declared exit only made it reachable in one
  // call instead of thirty refusals.
  const h = half([], { parkedIds: [ID] });
  assert.equal(h.parked, 1);
  const m = mergeOf(h, { refusals: 30 });
  const row = parkedRow(m);
  assert.equal(m.parked, 1, "the merge lost an exhausted park");
  assert.equal(row.parked_kind, "exhausted");
  assert.equal(row.parked_refusals, 30);
});

test("#1277 the merged census reports the row as PARKED, not as a ruled row owing a quote", () => {
  // The failure the run actually died of: `connotation_quote_unbound`. The row must be surfaced as
  // undecided — un-owing it silently is 's lying receipt and the opposite defect.
  const m = mergeOf(half(declaredRow()), { refusals: 2 });
  const reasons = census(m.form).map((v) => v.reason);
  assert.deepEqual(reasons, ["parked"], `the merged census said ${JSON.stringify(reasons)}`);
  const counts = connotationAuditCounts(census(m.form));
  assert.equal(counts.parked, 1);
  assert.equal(counts.parkedDeclared, 1, "the declared:exhausted ratio cannot be read across the merge");
});

// ── the void control: this is what the outage looked like ───────────────────────────────────────────

test("#1277 VOID CONTROL — the old argument order still loses the park, so these tests can fail", () => {
  // Halves on the SEAT side with an empty prior: `s.obstacle` is absent (a form never carries it) and
  // `p.parked` has nothing to read. Both miss and all four fields clear. If this ever stops losing the
  // park, the assertions above have stopped distinguishing anything and this file is decorative.
  const m = mergeOf(half(declaredRow()), { refusals: 2, legacyArgumentOrder: true });
  const row = parkedRow(m);
  assert.equal(m.parked, 0, "the legacy order no longer reproduces the outage — the tests above prove nothing");
  assert.equal(row.parked, false);
  assert.equal(row.parked_kind, "");
  assert.deepEqual(census(m.form).map((v) => v.reason), ["quote_unbound"],
    "the outage's own signature changed — connotation_quote_unbound is what killed the run");
});

// ── the property that forbids the easy fix ──────────────────────────────────────────────────────────

test("#1277 a SUBMISSION cannot park a row by claiming it — the seat may not widen its own state", () => {
  // The one-line fix — read `s.parked` — would let a model park any row it found inconvenient by typing
  // the field. The whole module is built on the seat being unable to widen what it has done, so the
  // trusted carry is the CALL SITE's job and this pins that it stayed that way.
  const claimed = [{ row_id: ID, parked: true, parked_kind: "declared", parked_reason: "I say so",
    parked_refusals: 99 }];
  const u = unionDispositionForm({ rows: [] }, { rows: claimed }, OB, { generatedFrom: "common-law-grid.json" });
  assert.equal(u.parked, 0, "a submission parked a row by asserting it — the seat can now retire its own obligations");
  assert.equal(parkedRow(u).parked, false);
});

// ── the call site, because the union was never the thing that was wrong ──────────────────────────────

test("#1277 pipeline's merge passes the halves through the PRIOR channel", () => {
  // The behaviour tests above all pass against a pipeline.mjs still calling the broken way — they union
  // by hand. Only this reads the caller, which is where the defect lived. Anchored to code: the comment
  // beside the fix necessarily quotes the old shape, and an unanchored grep would fail on the
  // explanation of the very bug it is guarding.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  //
  // The argument pattern is DELIBERATELY LOOSE — `[^}]*` rather than an identifier — so that a wrong
  // call still MATCHES and fails by naming what it found. The first draft required an identifier, so the
  // broken shape on main (`{ rows: [] }`) did not match at all and the guard failed with "watching
  // nothing": true, useless, and indistinguishable from the call having been deleted. A guard has to
  // fail for the right reason, not merely fail.
  const call = /unionDispositionForm\(\s*\{\s*rows:\s*([^}]*?)\s*\}\s*,\s*\{\s*rows:\s*([^}]*?)\s*\}/.exec(src);
  assert.ok(call, "no `unionDispositionForm({rows: …}, {rows: …})` call in pipeline.mjs — the merge moved "
    + "or was rewritten, and this guard is watching nothing");
  assert.equal(call[1], "halfRows",
    `the halves are on the ${call[1] === "[]" ? "SEAT" : "wrong"} side (prior is \`${call[1]}\`) — every park in a half `
    + "will be erased at the merge and its row will reach the canonical validator owing a quote (#1277)");
  assert.equal(call[2], "null",
    `a submission (\`${call[2]}\`) is being passed at the merge — there is no seat at a merge, and a persisted `
    + "form on the seat side is exactly how the parks were lost");
});
