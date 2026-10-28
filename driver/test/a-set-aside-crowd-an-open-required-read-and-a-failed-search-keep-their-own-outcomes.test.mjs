// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SET-ASIDE CROWD, AN OPEN REQUIRED READ AND A FAILED SEARCH KEEP THEIR OWN OUTCOMES.
//
// The reading step's manual told it that an immaterial crowd could be cleared as confirmed-clean. The coverage form and
// its tool hold the opposite: a crowd that was counted and not read is never clean. A crowd the narrowing closed is
// withheld by judgment, finished work with its count kept, and an unanswered slice that matters is a material gap.
// Design ruled the manual's line on 2026-10-28. This holds the ruled line, and holds the message, the tool and the
// coverage judgment together on three outcomes on one axis:
//   · a wider crowd that a narrowed list answered;
//   · the identical mark's crowd, still not covered in one main market;
//   · a search the register failed after its retries.
// Each keeps its own row and its own status through to the judgment.
//
// The failed search found a second fault. A slice the register could not run outranks a crowd in the axis's state, so
// an axis holding both read `deferred`, and the form gave its crowds no row at all: no ruling, and nothing on the ledger.
// Every mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinPlanToBands, deriveCoverageSkeleton, deferExhaustedProviderErrors } from "../register-plan.mjs";
import { coverageFormRows, coverageFormBrief, formLedgerRows } from "../coverage-form.mjs";
import { validateCoverageCall } from "../coverage-call.mjs";
import { deriveCoverageStatus, coerceToolAbsenceDeferred } from "../coverage-ledger.mjs";
import { STAGES } from "../stages.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(join(DRIVER, rel), "utf8").replace(/\s+/g, " ");

const RULED = "An incomplete crowd descriptor is a count, not a finding or a clean search. Carry forward the recorded crowd "
  + "decision. Where a narrowed list that was read answered the question, or the reading step validly set the crowd aside "
  + "with its count and reason, apply the coverage form's withheld-by-judgment status: that is finished work. An unanswered "
  + "slice that matters remains a material gap under the coverage rules. Never label an unenumerated crowd confirmed-clean "
  + "merely because it is immaterial, or reopen a settled crowd merely because its descriptor remains in the evidence.";

const AXIS = "primary-sweep";
const GOODS = ["video games", "joysticks"];
const IDENTICAL = "primary-sweep:exact:qzorvak", WIDER = "primary-sweep:contains:qzorv", FAILED = "primary-sweep:exact:qzorvakk";
const e = (qid, term, over = {}) => ({ qid, axis: AXIS, predicate: "exact", term, nice_classes: ["9"], regions: [], expected_kind: "enumerate", ...over });
const sup = (qid, term, narrows, over = {}) => e(qid, term, { origin: "supplemental", narrows, ...over });
const crowd = (qid) => ({ qid, state: "incomplete", total_hits: 900, fetched: 0, records: [], reason: "total_hits 900 exceeds the enumerate ceiling 600 — this is a CROWD" });
const listed = (qid) => ({ qid, state: "enumerated", total_hits: 2, count: 2, records: [{ record_id: `/mark/jp/${qid.length}`, mark_text: "QZORVAK", classes: [9] }] });

// The identical mark's crowd was narrowed to the client's goods in one of the two main markets only; the wider crowd was
// narrowed to a list that was retrieved; the third search failed at the register, and its retries were spent.
const PLAN = { regions: ["JP", "KR"], nice_classes: ["9"], entries: [
  e(IDENTICAL, "QZORVAK", { provenance: "mark" }),
  sup("supp:goods-jp", "QZORVAK", IDENTICAL, { goods_text: GOODS, regions: ["JP"] }),
  e(WIDER, "QZORV", { predicate: "contains" }),
  sup("supp:contains-jp", "QZORV", WIDER, { predicate: "contains", regions: ["JP"] }),
  e(FAILED, "QZORVAKK", { regions: ["KR"] }),
] };
const BANDS = { [AXIS]: [crowd(IDENTICAL), listed("supp:goods-jp"), crowd(WIDER), listed("supp:contains-jp"),
  { qid: FAILED, state: "incomplete", error: true, total_hits: null, fetched: 0, records: [], reason: "HTTP 500 from the register" }] };

function form() {
  const mainMarkets = ["JP", "KR"];
  const { join: joined } = deferExhaustedProviderErrors(joinPlanToBands(PLAN, BANDS, { mainMarkets }), BANDS, new Set([FAILED]));
  const { rows } = coverageFormRows({ skeleton: deriveCoverageSkeleton(PLAN, joined), plan: PLAN, bandBlocksByAxis: BANDS,
    deferredReasons: Object.fromEntries((joined.deferred ?? []).map((x) => [x.qid, x.reason])), mainMarkets });
  const row = (qid) => rows.find((r) => r.qid === qid);
  return { rows, row };
}

test("the reading step's manual carries the ruled line, and keeps the identical mark's residual-crowd rule", () => {
  assert.ok(STAGES["register-digest"].skillReads.includes("skills/clearance-register/digest.md"), "guard: the reading step reads this manual");
  const manual = flat("skills/clearance-register/digest.md");
  assert.ok(manual.includes(`- ${RULED}`), "the ruled line is not in the manual word for word");
  assert.ok(!manual.includes("**cleared** (immaterial noise, `confirmed-clean`)"), "the old line that cleared an immaterial crowd is still there");
  assert.ok(manual.includes("A crowd left by the identical mark's own narrowing is not this kind: one still a crowd after the last step, "
    + "or in a country its market step did not read, is an unaccounted crowd block."), "the identical mark's residual-crowd rule is gone");
});

test("each outcome has its own open row, and the message lists all three with what keeps each open", () => {
  const { rows, row } = form();
  assert.deepEqual([row(WIDER)?.kind, row(WIDER)?.narrowing, row(WIDER)?.lists], ["block", "list-retrieved", ["supp:contains-jp"]],
    "the wider crowd has no row of its own");
  assert.deepEqual([row(IDENTICAL)?.kind, row(IDENTICAL)?.narrowing, row(IDENTICAL)?.not_covered], ["block", "required-not-covered", ["9/KR"]],
    "the identical mark's open crowd has no row of its own");
  assert.equal(row(FAILED)?.kind, "deferred", "the failed search has no row of its own");
  assert.ok([WIDER, IDENTICAL, FAILED].every((q) => row(q).open === true), "a row the reading step owns was decided for it");
  const brief = coverageFormBrief({ rows });
  for (const q of [WIDER, IDENTICAL, FAILED]) assert.match(brief, new RegExp(`^ {2}${row(q).row_id} .* — OPEN`, "m"), `the message does not list ${q}`);
  assert.ok(brief.includes("the status is `withheld-by-judgment` with that reason: that is finished work, not a gap."));
  assert.ok(brief.replace(/\s+/g, " ").includes("A crowd the identical mark's own narrowing left, still a crowd after the last step or in a country "
    + "its market step did not read, stays `coverage-limited`."));
});

test("the tool refuses a clean on each, and takes each one's own status", () => {
  const { rows, row } = form();
  assert.ok([WIDER, IDENTICAL, FAILED].every((q) => row(q)), "an outcome has no row for the tool to take");
  const call = (status) => [WIDER, IDENTICAL, FAILED].map((q) => ({ row_id: row(q).row_id, status: status[q], reason: "The lawyer's reason for this slice." }));
  const clean = validateCoverageCall(call({ [WIDER]: "confirmed-clean", [IDENTICAL]: "confirmed-clean", [FAILED]: "confirmed-clean" }), rows);
  assert.deepEqual([clean.accepted.length, clean.refused.map((r) => r.reason)], [0, ["open_clean", "open_clean", "open_clean"]],
    "a crowd counted and not read, or a search that never answered, was taken as clean");
  const own = validateCoverageCall(call({ [WIDER]: "withheld-by-judgment", [IDENTICAL]: "coverage-limited", [FAILED]: "deferred" }), rows);
  assert.deepEqual([own.accepted.length, own.refused], [3, []]);
});

test("the coverage judgment keeps the three apart: a finished set-aside, a material gap, and a search to run again", () => {
  const { row } = form();
  assert.ok([WIDER, IDENTICAL, FAILED].every((q) => row(q)), "an outcome has no row to reach the judgment");
  const ruled = [
    { ...row(WIDER), status: "withheld-by-judgment", reason: "A narrowed list was read and answered this crowd; its count stays on the record." },
    { ...row(IDENTICAL), status: "coverage-limited", reason: "The identical mark's crowd in Korea was not narrowed to a list that could be read." },
    { ...row(FAILED), status: "deferred", reason: "The register failed this search, so it was never answered." },
  ];
  const ledger = coerceToolAbsenceDeferred(formLedgerRows(ruled));
  assert.deepEqual(ledger.map((r) => r.status), ["withheld-by-judgment", "coverage-limited", "deferred"], "two outcomes were merged on the ledger");
  const { complete, materialGaps } = deriveCoverageStatus(ledger);
  assert.equal(complete, false);
  assert.deepEqual(materialGaps.map((g) => [g.unit, g.status]), [[row(IDENTICAL).unit, "coverage-limited"], [row(FAILED).unit, "deferred"]],
    "the set-aside crowd was counted as a gap, or a gap was lost");
});
