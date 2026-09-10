// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — AN OFFICE THE RUN NEVER SEARCHED MUST REACH THE FORM A READER JUDGES FROM.
//
// WHAT SHIPPED, AND WHY NOTHING NOTICED. taught the plan compiler to SPLIT a multi-office scope
// when one member of a composed provider is unconfigured on this box: free-tier's US half with no
// `USPTO_LOCAL_DB` moves out of `regions` and onto the plan as a `deferred_coverage` entry, so the EU
// half still runs instead of the whole tier refusing. That part was correct and is not changed here.
//
// The disclosure was not. Probed directly against origin/main @ 0ae9431 — free-tier, EUIPO credentials
// present, no index, matter scoped ["EU","US"]:
//
//     PLAN      5 entries, regions ['EU'], deferred_coverage ["US"]
//     JOIN      executed 5   missing 0   deferred 0
//     SKELETON  primary-sweep: executed    incumbent-class: executed
//     COVERAGE FORM ROWS: 2 — both open:false, neither naming the US
//
// Every layer is telling the truth about what it saw. The US has no qid, because the office was split
// off BEFORE entries compiled; no qid means no band block, no `joinPlanToBands` deferral, and no
// deferred row — and the skeleton says `executed` on both axes because every entry that exists did
// execute. The reader gets an EU-only clean under a scope the deliverable states as EU+US.
//
// That is doctrine rule 2 reached by OMISSION, which is the failure this whole form was built to make
// structurally impossible, arriving through the fix for a different one. `pipeline.mjs:1830-1837` names
// this exact shape — it was closed for the whole-plan coverage-gap case and left open for the office
// split. `registerDeferredCoverage` does log it and does feed the jurisdiction-scope backstop, but a
// runLog event and a `note()` are not the artifact a lawyer reads, and that backstop is gated on an LLM
// stage succeeding AND parsing (the `if (parsed)` gate, pipeline.mjs:9231), with three non-fatal skips above it.
//
// WHAT THE TESTS BELOW PIN. Not "a row exists" — the pair that a bug can only pass by being fixed:
// the gap is DISCLOSED, and the disclosure cannot be discharged by a clean claim on anything else.

import { test } from "node:test";
import assert from "node:assert/strict";

import { coverageFormRows, formRowKey, rowIsSettled, findCoverageFormViolations } from "../coverage-form.mjs";
import { compileRegisterPlan, joinPlanToBands, deriveCoverageSkeleton } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { REGISTER_AXES, COVERAGE_STATUSES } from "../coverage-ledger.mjs";

const MODEL = {
  schema_version: 1, mark: "GLIMBEX", dominant_element: "GLIMBEX",
  elements: [{ value: "GLIMBEX", kind: "distinctive" }],
  variants: [{ value: "GLIMBECKS", category: "phonetic", rationale: "sound-alike" }],
  incumbent_classes: ["9"],
};

const FREE_TIER = capabilitiesFor("free-tier");
/** The US index unconfigured, EUIPO fine — the deployment the free tier exists for. */
const NO_INDEX = [{ office: "US", memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] }];

/**
 * The WHOLE path, compiled → executed → skeleton → form, not a hand-built plan object.
 *
 * Every intermediate layer here reports success, and that is the point: a test that fed
 * `coverageFormRows` a plan literal would prove the function reads a field, not that the field arrives.
 * The bug lived in the joins between these calls.
 */
function runToForm({ jurisdictions, unavailableOffices }) {
  const plan = compileRegisterPlan({
    manifest: parseVariantManifestModel(JSON.stringify(MODEL)),
    job: { jobKey: "t-660-ledger", classes: ["9"], jurisdictions },
    capabilities: FREE_TIER,
    unavailableOffices,
  });
  // Every entry executes CLEANLY. Nothing failed, so nothing downstream has an error to notice — the
  // state in which a missing disclosure is invisible.
  const bandBlocksByAxis = {};
  for (const e of plan.entries) {
    (bandBlocksByAxis[e.axis ?? "primary-sweep"] ??= [])
      .push({ qid: e.qid, state: "verified-zero", total_hits: 0, records: [] });
  }
  const skeleton = deriveCoverageSkeleton(plan, joinPlanToBands(plan, bandBlocksByAxis));
  const activeAxes = [...new Set(plan.entries.map((e) => e.axis).filter(Boolean))];
  return { plan, skeleton, ...coverageFormRows({ skeleton, plan, bandBlocksByAxis, activeAxes }) };
}

const officeRows = (rows) => rows.filter((r) => r.kind === "deferred" && /register — not searched/.test(r.unit));

// ── the defect ──────────────────────────────────────────────────────────────────────────────────────

test("the unsearched US office reaches the form — the whole defect, end to end", () => {
  const { plan, skeleton, rows } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX });

  // The premise, asserted rather than assumed: this really is the silent state. If a later change makes
  // the plan refuse, or the skeleton report `unexecuted`, this test would pass for the wrong reason.
  assert.deepEqual(plan.deferred_coverage.map((d) => d.jurisdiction), ["US"]);
  assert.deepEqual([...new Set(plan.entries.flatMap((e) => e.regions ?? []))], ["EU"]);
  assert.ok(skeleton.every((s) => s.state === "executed"),
    "the premise: every axis reads `executed`, because every entry that exists did execute");

  const mine = officeRows(rows);
  assert.ok(mine.length > 0, "no row names the US — a lawyer reads an EU-only clean under an EU+US scope");
  for (const r of mine) {
    assert.equal(r.open, true, "a slice nobody searched cannot be claimed clean");
    assert.match(r.unit, /US/, "the row must name the territory, or the reader cannot act on it");
  }
});

test("EVERY active axis carries the gap — one clean axis must not read clean", () => {
  // The alternative design was a single row on one axis. A reader working down `incumbent-class` would
  // then reach a clean claim without ever meeting the US gap, and `rowIsSettled` is explicit that a
  // sibling row's status discharges nothing.
  const { rows } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX });
  const axesWithAnAxisRow = rows.filter((r) => r.kind === "axis").map((r) => r.axis);
  const axesWithTheGap = officeRows(rows).map((r) => r.axis);
  assert.ok(axesWithAnAxisRow.length >= 2, "the fixture must activate more than one axis or this proves nothing");
  assert.deepEqual([...axesWithTheGap].sort(), [...axesWithAnAxisRow].sort());
});

test("the row names the variable an operator has to set", () => {
  const { rows } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX });
  const r = officeRows(rows)[0];
  assert.match(r.receipt_reason, /USPTO_LOCAL_DB/,
    "the plan's own reason names the member and the unset variable. A gap nobody can act on is a dead end");
  assert.match(r.receipt_reason, /uspto-local/, "and which source serves the office");
  assert.match(r.open_because, /never searched/,
    "`open_because` is what verify.mjs reads when it judges the bytes on disk without unioning first");
});

// ── the rule must not fire where there is no gap ─────────────────────────────────────────────────────

test("a fully wired box emits NO office row — a rule that fires on the normal case gets deleted", () => {
  const { rows } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: [] });
  assert.deepEqual(officeRows(rows), []);
  assert.ok(rows.some((r) => r.kind === "axis"), "and the ordinary rows are unchanged");
});

test("an EU-only matter on the same unwired box has nothing to disclose", () => {
  // The US was never asked for, so it is not a gap. Disclosing it would train a reader to skip the row.
  const { plan, rows } = runToForm({ jurisdictions: ["EU"], unavailableOffices: NO_INDEX });
  assert.equal(plan.deferred_coverage, undefined);
  assert.deepEqual(officeRows(rows), []);
});

// ── the identity the union de-dupes on, which is where this row nearly vanished ──────────────────────

test("two office rows on different axes are DIFFERENT rows", () => {
  // `formRowKey` returned `${kind}:${qid}` for every driver row. These rows have no qid — there is no
  // query to point at, which is the fact they carry — so every one of them keyed to the string
  // `deferred:`. The union de-dupes by key: eleven gaps would have become one, silently, on a form that
  // then looks complete.
  const a = { kind: "deferred", axis: "primary-sweep", unit: "US register — not searched", qid: null };
  const b = { kind: "deferred", axis: "incumbent-class", unit: "US register — not searched", qid: null };
  const c = { kind: "deferred", axis: "primary-sweep", unit: "CN register — not searched", qid: null };
  assert.notEqual(formRowKey(a), formRowKey(b), "same office, different axes");
  assert.notEqual(formRowKey(a), formRowKey(c), "same axis, different offices");
});

test("a deferred row WITH a qid keys exactly as it always did", () => {
  // The qid-less branch is additive. Changing the key of an existing row would orphan every settled
  // judgment in every in-flight run — the loss this file's subject exists to prevent, caused by fixing it.
  assert.equal(formRowKey({ kind: "deferred", axis: "primary-sweep", unit: "whatever", qid: "q7" }), "deferred:q7");
  assert.equal(formRowKey({ kind: "block", axis: "primary-sweep", unit: "whatever", qid: "q7" }), "block:q7");
  assert.equal(formRowKey({ kind: "axis", axis: "primary-sweep" }), "axis:primary-sweep");
});

test("a row's id says WHAT it is about, not where it sits in the list", () => {
  // Re-running the identical inputs proves nothing here — any id derivation is stable against that,
  // including a positional one. The property that matters is stability when the SURROUNDING rows
  // change, because that is what actually happens: a supplemental sweep adds entries and the form is
  // regenerated. A positional id would hand the US row a new identity, the union would not recognise
  // it as the row a reader already judged, and that settled judgment is silently lost — the exact loss
  // `formRowKey`'s own doc block says this build exists to end.
  const { plan, skeleton, rows } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX });
  const bandBlocksByAxis = {};
  for (const e of plan.entries) {
    (bandBlocksByAxis[e.axis ?? "primary-sweep"] ??= [])
      .push({ qid: e.qid, state: "verified-zero", total_hits: 0, records: [] });
  }
  const activeAxes = [...new Set(plan.entries.map((e) => e.axis).filter(Boolean))];
  const idOfUS = (deferred) => officeRows(coverageFormRows({
    skeleton, plan: { ...plan, deferred_coverage: deferred }, bandBlocksByAxis, activeAxes,
  }).rows).filter((r) => /^US /.test(r.unit)).map((r) => r.row_id);

  const alone = idOfUS([{ jurisdiction: "US", reason: "no index" }]);
  const second = idOfUS([{ jurisdiction: "CN", reason: "not covered" }, { jurisdiction: "US", reason: "no index" }]);
  assert.ok(alone.length > 0, "the fixture must produce a US row");
  assert.deepEqual(second, alone, "the US row keeps its id when another office joins the list ahead of it");

  // And the plain reproducibility property, which is cheap and also required.
  const again = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX }).rows;
  assert.deepEqual(again.map((r) => r.row_id), rows.map((r) => r.row_id));
  assert.deepEqual(again.map(formRowKey), rows.map(formRowKey));
});

// ── what the seat may and may not do with it ─────────────────────────────────────────────────────────

test("the seat cannot call it confirmed-clean, and CAN discharge it by judging it", () => {
  const { rows } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX });
  const canonical = officeRows(rows)[0];

  assert.ok(REGISTER_AXES.includes(canonical.axis),
    "the axis must be inside the closed vocabulary — rowIsSettled refuses anything else outright, and a "
    + "row that can never be settled blocks every run instead of disclosing one gap");

  const judged = (status) => rowIsSettled({ ...canonical, status, reason: "US index not built on this box" }, canonical);
  assert.equal(judged("confirmed-clean"), false,
    "a clean claim over a register nobody searched is the exact judgment this row exists to refuse");
  assert.equal(judged("deferred"), true, "but it is dischargeable — a reader states the gap and moves on");
  assert.equal(rowIsSettled({ ...canonical, status: "deferred", reason: "" }, canonical), false,
    "with a reason, always: `deferred` alone is a label, not a judgment");
  assert.ok(COVERAGE_STATUSES.includes("deferred"), "and `deferred` is in the vocabulary the seat is given");
});

test("the receipt counts the two deferral shapes separately", () => {
  // A deferred qid is a query the provider cannot express ANYWHERE; an unreached office is a variable
  // an operator can set on THIS box. Same row kind, different repair — and a receipt that conflates
  // them tells a reader to go fix the wrong thing.
  const { derived_from } = runToForm({ jurisdictions: ["EU", "US"], unavailableOffices: NO_INDEX });
  assert.equal(derived_from.deferred_offices, 1);
  assert.ok(derived_from.deferred_qids >= 2, "one row per active axis");
});

test("a deferral whose territory is not recorded is DISCLOSED, not skipped", () => {
  // The branch that read `if (!jurisdiction) continue`. The compiler does not produce a blank entry
  // today — every one is a `String(region)` off a region list — so this is about the direction the code
  // fails in, not about a bug in flight. Skipping reports a malformed deferral as a pass, which is the
  // shape this whole file exists to refuse; and a gap nobody can NAME is wider than one they can, so
  // the honest row is louder, not quieter.
  const skeleton = [{ axis: "primary-sweep", state: "executed", deferred: [] }];
  const plan = { entries: [], deferred_coverage: [{ jurisdiction: "  ", reason: "something went wrong" }] };
  const { rows } = coverageFormRows({ skeleton, plan, activeAxes: ["primary-sweep"] });
  const mine = rows.filter((r) => r.kind === "deferred");
  assert.equal(mine.length, 1, "the entry must produce a row rather than vanish");
  assert.equal(mine[0].open, true);
  assert.match(mine[0].unit, /not recorded/, "and say plainly that the territory is unknown");
  assert.match(mine[0].open_because, /cannot say what/,
    "the reader has to learn that something was unsearched AND that the run cannot name it");
});

test("a blank entry does not collide with a named one, or the union carries one of them", () => {
  const skeleton = [{ axis: "primary-sweep", state: "executed", deferred: [] }];
  const plan = { entries: [], deferred_coverage: [
    { jurisdiction: "", reason: "a" }, { jurisdiction: "", reason: "b" }, { jurisdiction: "US", reason: "c" }] };
  const { rows } = coverageFormRows({ skeleton, plan, activeAxes: ["primary-sweep"] });
  const keys = rows.filter((r) => r.kind === "deferred").map(formRowKey);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 3, "three deferrals, three rows, three keys");
});

// ── THE ROW HAS TO SURVIVE THE UNION, WHICH IS WHERE IT WOULD HAVE BEEN LOST SILENTLY ───────────────
//
// Twice today was "fixed" and did not work, both times in the same shape: everything upstream
// correct, nothing downstream happening. So the last assertion is not that `coverageFormRows` emits the
// row — it is that the row is still there in the artifact the seat opens, after the union has
// regenerated the driver rows and de-duped them by key.

import { unionCoverageForm } from "../coverage-union.mjs";

test("the office row survives the union, and a seat cannot clear it by clearing another row", () => {
  const plan = { entries: [], deferred_coverage: [{ jurisdiction: "US", reason: "USPTO_LOCAL_DB unset" }] };
  const skeleton = [
    { axis: "primary-sweep", state: "executed", deferred: [] },
    { axis: "incumbent-class", state: "executed", deferred: [] },
  ];
  const input = { skeleton, plan, bandBlocksByAxis: {}, activeAxes: ["primary-sweep", "incumbent-class"] };

  const { form } = unionCoverageForm(null, null, input);
  const mine = form.rows.filter((r) => r.kind === "deferred" && /US register/.test(r.unit));
  assert.equal(mine.length, 2, "one per axis, both present after the union");
  assert.ok(mine.every((r) => r.open === true && !r.status), "unsettled and open — the seat owes a judgment");

  // The seat marks EVERY row confirmed-clean, including the US ones.
  const submitted = { rows: form.rows.map((r) => ({ ...r, status: "confirmed-clean", reason: "swept" })) };
  const after = unionCoverageForm(null, submitted, input).form;
  const usAfter = after.rows.filter((r) => r.kind === "deferred" && /US register/.test(r.unit));
  assert.equal(usAfter.length, 2, "still there — nothing removes an open driver row");

  // The seat's WORDS are carried onto the row — deliberately, so a reader sees what was claimed rather
  // than a blank. What the seat cannot do is make the claim STICK. The gate is where that is refused,
  // and it refuses per row with the DRIVER's own sentence, so the repair instruction is specific.
  const violations = findCoverageFormViolations(after.rows);
  for (const r of usAfter) {
    const v = violations.find((x) => x.row === r.row_id);
    assert.ok(v, `no violation raised for ${r.unit} — a clean claim over an unsearched register stuck`);
    assert.equal(v.cause, "open_clean");
    assert.match(v.detail, /never searched/,
      "the refusal quotes the row's own open_because, so the seat is told what it actually did wrong");
  }
  assert.ok(after.rows.filter((r) => r.kind === "axis").every((r) => !violations.some((x) => x.row === r.row_id)),
    "and the axis rows the seat legitimately settled are NOT flagged — a gate that fires on everything "
    + "teaches a reader to clear the whole form");
});
