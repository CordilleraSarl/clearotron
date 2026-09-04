// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE UNION HAS THREE CALL MODES, AND THE PARK ARRIVES BY A DIFFERENT ROUTE IN EACH.
//
// enumerated the modules that read disposition row state and built a tripwire so a fifteenth could
// not arrive silently. `unionDispositionForm` was in that enumeration, and the enumeration was right —
// and still happened, because a MODULE is not the unit of this question.
//
// The same function is park-aware in two of its three call modes and was blind in the third. Module-level
// presence cannot see that, and the suite could not either: the tests exercised the modes that worked.
//
// ── THE THREE MODES, AND WHICH ARGUMENT CARRIES THE STATE ────────────────────────────────────────────
//
//   disposition-tool.mjs   prior = accumulator   submitted = this call's accepted   → `parkedIds` OPTION
//   gateway.mjs            prior = accumulator   submitted = null                   → PRIOR ROWS' `parked`
//   pipeline.mjs           prior = half rows     submitted = null                   → PRIOR ROWS' `parked`
//
// Two routes, and which one is live depends on the mode. The tool computes `parkedIds` from the ledger
// (including the call in flight, so a row crossing the bound parks now rather than one call late) and
// hands them in as an option. The other two have no ledger in scope and no submission: the park is already
// ON the prior rows, and the union's job is to not lose it. was the third mode losing it.
//
// ── SO THIS FILE ASSERTS PER CALL SITE, NOT PER MODULE ───────────────────────────────────────────────
//
// Two arms, and both are needed. The CENSUS makes a fourth call site impossible to add silently — the
// failure mode that produced this issue. The BEHAVIOURAL arm plants a park in each declared mode and
// requires it to survive, so a site can be present, declared, and still wrong.
//
// A census alone would have passed the whole time: the call site existed and was declared. A
// behavioural test alone covers the three modes someone thought of. Neither is the guard on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unionDispositionForm } from "../disposition-union.mjs";
import { connotationObligations, obligationRows } from "../connotation-search.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "disposition union call sites";

// EVERY CALL SITE, WITH THE ROUTE ITS STATE TRAVELS BY. Adding a row is how a new mode enters the guard;
// it is not an exemption list — every row is also exercised below, so a row cannot buy silence.
const CALL_SITES = [
  { file: "disposition-tool.mjs", route: "parkedIds",
    why: "the only mode with the ledger in scope, so the park is DECIDED here — before the union, and "
       + "including this call's refusals, so a row crossing the bound parks now rather than one call late" },
  { file: "gateway.mjs", route: "prior-rows",
    why: "prior-only regeneration on every attempt: no submission and no ledger, so the park is already on "
       + "the accumulator rows and the union's whole job is to carry it" },
  { file: "pipeline.mjs", route: "prior-rows",
    why: "#1277 — the half→canonical merge, same prior-only mode. It passed the halves as the SUBMITTED "
       + "argument, which is not a trusted prior, and every park on them was erased at the merge" },
];

// ── ARM 1 · the census ───────────────────────────────────────────────────────────────────────────────

test("#1277 every call site of the union is declared, with the route its park travels by", (ctx) => {
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const tracked = trackedFiles(GUARD, { root: ROOT, pathspec: ["*.mjs"] });
  if (tracked === null) return ctx.skip(skipReason(GUARD));
  const files = tracked.map((f) => f.trim()).filter(Boolean).filter((f) => !f.startsWith("test/"));
  const read = (f) => readFileSync(new URL(f, new URL("../", import.meta.url)), "utf8");
  // Comments stripped first: this file and the union's own header discuss the call sites at length, and
  // counting a comment as a call site is the inversion 's tripwire already had to fix once.
  const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  const found = [];
  for (const f of files) {
    const code = codeOf(read(f));
    // The call's own argument text, to the matching close paren — the route is an ARGUMENT, so a check
    // that stops at the call name cannot tell the modes apart, which is this issue in one sentence.
    for (const m of code.matchAll(/unionDispositionForm\(/g)) {
      if (/export function unionDispositionForm/.test(code.slice(Math.max(0, m.index - 40), m.index + 30))) continue;
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < code.length; i++) {
        if (code[i] === "(") depth += 1;
        else if (code[i] === ")") { depth -= 1; if (depth === 0) break; }
      }
      const args = code.slice(m.index, i + 1);
      found.push({ file: f.split("/").pop(), route: /\bparkedIds\b/.test(args) ? "parkedIds" : "prior-rows" });
    }
  }

  const key = (r) => `${r.file}:${r.route}`;
  assert.deepEqual(found.map(key).sort(), CALL_SITES.map(key).sort(),
    "a call site of the union is undeclared, or the route its park travels by changed. Both are the #1277 "
    + "shape: the module was enumerated and park-aware in two of its three modes. Declare it above AND "
    + "give it an arm below — a row here without an arm buys silence, which is what this guard refuses.");
});

// ── ARM 2 · the behaviour, per mode ──────────────────────────────────────────────────────────────────

// Built through `connotationObligations` rather than hand-shaped: the union derives its canonical rows
// from this object, and a fixture that guesses its shape tests a form the production path never produces.
const SNIP = "A long enough passage of captured text to be usable for a spot check on this row.";
const RECORDED = [{ query: "a meaning query", results: [
  { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIP }] }];
const OB = connotationObligations(RECORDED);
const ID = obligationRows(OB)[0].row_id;
const PARKED = {
  row_id: ID, parked: true, parked_kind: "exhausted", parked_refusals: 30,
  parked_reason: "refused 30 times without binding (bound 30) — parked unresolvable so the stage can complete",
};
const parkOf = (form) => (form?.rows ?? []).find((r) => String(r.row_id) === ID);

test("#1277 MODE `parkedIds` — the park the ledger decided reaches the form", () => {
  const u = unionDispositionForm({ rows: [] }, { rows: [] }, OB, { half: "m", parkedIds: [ID] });
  assert.equal(parkOf(u.form)?.parked, true, "the option route stopped carrying the park");
});

test("#1277 MODE `prior-rows`, prior-only — a park already on the prior survives with no submission", () => {
  // gateway.mjs's mode, and pipeline.mjs's after. `{ rows: null }` submitted is the whole point:
  // there is nothing to merge in, so anything lost here was lost by the union rather than overwritten.
  const u = unionDispositionForm({ rows: [PARKED] }, { rows: null }, OB, { generatedFrom: "common-law-grid.json" });
  const r = parkOf(u.form);
  assert.equal(r?.parked, true, "#1277: the park was erased at a merge that had nothing to merge");
  assert.equal(r?.parked_kind, "exhausted", "the park survived as a bare flag with its provenance dropped");
  assert.equal(r?.parked_refusals, 30, "the count behind the park did not survive");
  assert.match(String(r?.parked_reason), /bound 30/, "the sentence a reader acts on did not survive");
});

test("#1277 THE MODE THAT WAS WRONG — halves passed as SUBMITTED lose their park", () => {
  // The defect, kept executable. This is what pipeline.mjs did: the halves went in as the submitted
  // argument, which is not a trusted prior, and all four park fields came out cleared. If this ever
  // starts preserving the park, the union's trust model changed and the fix above needs re-reading —
  // it is pinned as a KNOWN DIFFERENCE between the two channels, not as desired behaviour.
  const u = unionDispositionForm({ rows: [] }, { rows: [PARKED] }, OB, { generatedFrom: "common-law-grid.json" });
  assert.notEqual(parkOf(u.form)?.parked, true,
    "the submitted channel now carries parks too — re-read #1277 before trusting either route");
});
