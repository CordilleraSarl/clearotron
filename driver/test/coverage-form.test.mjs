// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the register-digest coverage form: what the driver writes, what the seat owes, what the gate
// refuses.
//
// The gate this replaces asked whether a sentence the model TYPED contained a query id, or a crowd
// block's exact hit count as a standalone number. Both accept-forms were substring matches against the
// model's own prose, the skill taught a shape neither could match (`returned ~N,NNN hits`), and the word
// `qid` appeared nowhere in the Coverage-ledger section that governs the row. These tests pin the four
// properties requires of the replacement (non-circularity, axis scope, accept-form equivalence,
// fail-closed on empty) plus the two the form adds (every row carries a status; an `open` row cannot be
// claimed clean).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverageForm, coverageFormRows, parseCoverageForm, rowIsSettled, findCoverageFormViolations,
  formLedgerRows, renderCoverageLedgerSection, spliceCoverageLedger, renderCoverageLedgerJsonFromForm,
  coverageFormBrief, coverageFormSidecarName, formRowKey, seatRows, COVERAGE_REASONS, COVERAGE_CAUSES, SEAT_BANNED_TOKENS } from "../coverage-form.mjs";
import { parseCoverageLedgerJson, classTokensFromScopeText } from "../coverage-ledger.mjs";

// ── THE FIXTURE ────────────────────────────────────────────────────────────────────────────────────
// Shaped after the 2026-08-05 refused run and the 2026-07-22 unclearable run — an unaccounted CLASS leg
// on an owner slice, and an unaccounted TERM in a multi-term OR-stack — with every mark, owner and qid
// replaced by invented tokens. This repo is de-identified by design and a fixture is code.
const PLAN = {
  entries: [
    { qid: "ps:exact:glimmer+form", axis: "primary-sweep", predicate: "exact",
      terms: ["GLIMMER", "GLIMMR", "GLYMMER"], nice_classes: ["9", "42"], expected_kind: "enumerate" },
    { qid: "ic:owner:glimmer+holdings", axis: "incumbent-class", predicate: "owner",
      term: "GLIMMER", owner: "Incumbent Holdings", nice_classes: ["5", "30"], expected_kind: "enumerate" },
    { qid: "tn:translit:glimmer+cyr", axis: "transliteration-numeric", predicate: "default",
      term: "ГЛИММЕР", nice_classes: ["9"], expected_kind: "enumerate" },
    { qid: "sp:count:glimmer", axis: "saturation-probe", predicate: "default",
      term: "GLIMMER", nice_classes: ["9"], expected_kind: "count" },
  ],
};
const SKELETON = [
  { axis: "primary-sweep", state: "incomplete", entries: 1, executed: 1, crowds: 1, skipped: 0, missing: [] },
  { axis: "incumbent-class", state: "incomplete", entries: 1, executed: 1, crowds: 1, skipped: 0, missing: [] },
  { axis: "transliteration-numeric", state: "deferred", deferred: ["tn:translit:glimmer+cyr"], missing: [] },
  { axis: "saturation-probe", state: "complete", entries: 1, executed: 1, crowds: 1, skipped: 0, missing: [] },
];
const BANDS = {
  "primary-sweep": [{ state: "incomplete", qid: "ps:exact:glimmer+form", total_hits: 6862,
    term_counts: { GLIMMER: { disposition: "crowd" }, GLIMMR: { disposition: "unenumerated" }, GLYMMER: { disposition: "verified-zero" } } }],
  "incumbent-class": [{ state: "incomplete", qid: "ic:owner:glimmer+holdings", total_hits: 703,
    class_counts: { 5: { disposition: "crowd" }, 30: { disposition: "unenumerated" } } }],
};
const DEFERRED_REASONS = { "tn:translit:glimmer+cyr": "the active register provider indexes non-latin filings by their transliteration" };
const INPUT = { skeleton: SKELETON, plan: PLAN, bandBlocksByAxis: BANDS, deferredReasons: DEFERRED_REASONS,
  activeAxes: ["saturation-probe", "primary-sweep", "transliteration-numeric", "incumbent-class"] };

const build = () => buildCoverageForm(INPUT);
const rowOf = (form, kind, qid = null) =>
  form.rows.find((r) => r.kind === kind && (qid == null || r.qid === qid));
const settle = (form, status = "confirmed-clean", reason = "judged") => {
  for (const r of form.rows) { r.status = status; r.reason = reason; }
  return form;
};

// ── WHAT THE DRIVER WRITES ─────────────────────────────────────────────────────────────────────────

test("the driver writes the qid AND the hit count into the row — both accept-forms, by construction", () => {
  // §2 property 3. Under the deleted join a block was disclosable by its qid OR by its total_hits as a
  // standalone number, and a model had to reproduce one of them. Both are now machine-written fields on
  // the row, so the equivalence the join had to test for is structural. This is the trivial case, which
  // is exactly the one nobody tests.
  const ps = rowOf(build(), "block", "ps:exact:glimmer+form");
  assert.equal(ps.qid, "ps:exact:glimmer+form");
  assert.equal(ps.total_hits, 6862);
  const ic = rowOf(build(), "block", "ic:owner:glimmer+holdings");
  assert.equal(ic.total_hits, 703);
  assert.deepEqual(ic.unaccounted_classes, ["30"]);
  assert.deepEqual(rowOf(build(), "block", "ps:exact:glimmer+form").unaccounted_terms, ["GLIMMR"]);
});

test("a deferred slice becomes its own row carrying ITS OWN receipt reason", () => {
  // The block this replaces printed the first six qids per axis and ONE reason for all of them. R1
  // carried fourteen, and the reasons differ per qid.
  const d = rowOf(build(), "deferred", "tn:translit:glimmer+cyr");
  assert.equal(d.axis, "transliteration-numeric");
  assert.match(d.receipt_reason, /indexes non-latin filings/);
  assert.equal(d.open, true, "a slice that was never searched cannot be claimed clean");
});

test("the coverage unit is composed by the machine from the plan entry", () => {
  const ic = rowOf(build(), "block", "ic:owner:glimmer+holdings");
  assert.match(ic.unit, /^incumbent-class \//, "left of the first slash is the axis every consumer keys on");
  assert.match(ic.unit, /owner: GLIMMER/);
  assert.match(ic.unit, /\[cl 5, 30\]/);
});

test("every active axis owns a row, so the completeness contract cannot be missed by forgetting", () => {
  const axes = build().rows.filter((r) => r.kind === "axis").map((r) => r.axis).sort();
  assert.deepEqual(axes, ["incumbent-class", "primary-sweep", "saturation-probe", "transliteration-numeric"]);
});

test("a sanctioned crowd is not an open block — count-kind and resolved legs never fire", () => {
  // C6 and C7, unchanged from the gate this replaces: a plan-dictated count descriptor is sanctioned
  // doctrine (crowd = dilution), and a block whose every term/class is verified-zero, enumerated or
  // itself a ruled crowd is accounted for.
  const resolved = coverageFormRows({ ...INPUT, bandBlocksByAxis: {
    "primary-sweep": [{ state: "incomplete", qid: "ps:exact:glimmer+form", total_hits: 6862,
      term_counts: { GLIMMER: { disposition: "crowd" }, GLIMMR: { disposition: "enumerated" }, GLYMMER: { disposition: "verified-zero" } } }],
  } });
  assert.equal(resolved.rows.filter((r) => r.kind === "block").length, 0);
});

test("the form regenerates byte-identically from the same inputs", () => {
  // The union rewrites the form before every judgement; a non-deterministic builder would make every
  // pass look like a change and the convergence ledger would stop meaning anything.
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

test("an unreadable band is RECORDED on the form, not swallowed", () => {
  // An absence is a finding. The axis contributes no open-block rows — the same per-axis behaviour the
  // deleted gate had, because a band parse defect is refused one stage earlier by validators.registerUnit
  // (named_band_invalid) — but the form says which axis it happened to.
  const f = buildCoverageForm({ ...INPUT, bandsUnreadable: ["incumbent-class"] });
  assert.deepEqual(f.generated_from.bands_unreadable, ["incumbent-class"]);
});

// ── WHAT THE GATE REFUSES ──────────────────────────────────────────────────────────────────────────

test("a fully settled form is refused nothing", () => {
  const f = build();
  for (const r of f.rows) {
    r.status = r.open ? "deferred" : "confirmed-clean";
    r.reason = "judged";
  }
  // The two open-block axes need a non-clean row (clause 3) — give each one a seat row.
  f.rows.push({ row_id: "CS-1", axis: "primary-sweep", kind: "seat", unit: "primary-sweep / OR-stack",
    open: false, status: "coverage-limited", reason: "one term of the stack stayed open" });
  f.rows.push({ row_id: "CS-2", axis: "incumbent-class", kind: "seat", unit: "incumbent-class / owner slice",
    open: false, status: "coverage-limited", reason: "class 30 counted, not enumerated" });
  assert.deepEqual(findCoverageFormViolations(f.rows), []);
});

test("FAIL-CLOSED ON EMPTY: a row with no status is refused, and discharges nothing", () => {
  // §2 property 4. blockIsDisclosed returned false on empty text; an unfilled row is the form's empty
  // text, and it must never default to disclosed.
  const f = build();
  const v = findCoverageFormViolations(f.rows);
  assert.ok(v.length >= f.rows.length, "every unfilled row is a violation");
  assert.ok(v.every((x) => x.reason === "no_status"));
});

test("NON-CIRCULARITY: a clean claim over an open row never discharges it", () => {
  // §2 property 1, and disclosureTextByAxis' own rule: "letting it supply its own disclosure would be
  // circular". A form that let a clean row discharge its own obligation would make the gate never fire.
  // Every open row is refused BY ROW ID — one violation per obligation, never one per axis.
  const f = settle(build(), "confirmed-clean");
  const v = findCoverageFormViolations(f.rows);
  const openRows = f.rows.filter((r) => r.open === true);
  assert.ok(openRows.length >= 3, "the fixture carries two open blocks and one deferred slice");
  assert.deepEqual(v.map((x) => x.row).sort(), openRows.map((r) => r.row_id).sort(),
    "exactly the open rows fire, each named by its own row id");
  assert.ok(v.every((x) => x.cause === "open_clean"));
});

test("BLOCK SCOPE: a disclosure about one slice does NOT discharge another slice's block", () => {
  // THE BLOCKER. The design of record said the opposite until 2026-08-07 — "axis scope, not block
  // scope … binding disclosure to a specific block would be stricter" — and the first cut of this build
  // implemented that sentence, which reopened the FROSTBERRY hole. The HAYSTACK was per axis; the JOIN
  // was per block. `blockIsDisclosed` asked whether THAT block's own qid or hit count appeared in it, so
  // a row about slice A discharged block B only where A's text named B. Its doc block, verbatim:
  // disclosure joins on block-specific evidence, "never on the mere presence of some non-clean row".
  //
  // Two open blocks on primary-sweep. One unrelated coverage-limited seat row on the axis, naming
  // neither. Under the loose reading BOTH blocks were discharged and the gate returned nothing.
  const plan2 = { entries: [...PLAN.entries, { qid: "ps:exact:glimmer+second", axis: "primary-sweep",
    predicate: "exact", term: "GLIMMER", nice_classes: ["9"], expected_kind: "enumerate" }] };
  const rows = coverageFormRows({ ...INPUT, plan: plan2, bandBlocksByAxis: {
    "primary-sweep": [BANDS["primary-sweep"][0],
      { state: "incomplete", qid: "ps:exact:glimmer+second", total_hits: 40, class_counts: { 9: { disposition: "unenumerated" } } }],
    "incumbent-class": BANDS["incumbent-class"] } }).rows;
  const psBlocks = rows.filter((r) => r.kind === "block" && r.axis === "primary-sweep");
  assert.equal(psBlocks.length, 2);
  for (const r of rows) { r.status = r.kind === "deferred" ? "deferred" : "confirmed-clean"; r.reason = "judged"; }
  // ONE coverage-limited row on primary-sweep — about neither block, by name or by number.
  rows.push({ row_id: "CS-9", axis: "primary-sweep", kind: "seat", unit: "primary-sweep / jurisdiction reconciliation",
    open: false, status: "coverage-limited", reason: "CH yield ring-fenced" });
  rows.push({ row_id: "CS-8", axis: "incumbent-class", kind: "seat", unit: "incumbent-class / owner",
    open: false, status: "deferred", reason: "owner surface absent" });
  const v = findCoverageFormViolations(rows);
  assert.deepEqual(v.map((x) => x.row).sort(), psBlocks.map((r) => r.row_id).concat(
    rows.filter((r) => r.kind === "block" && r.axis === "incumbent-class").map((r) => r.row_id)).sort(),
    "every open block is refused on its OWN row — the unrelated disclosure discharges none of them");
  // And the cure is per block: settle THAT block's row and only THAT block clears.
  const target = psBlocks[0];
  target.status = "coverage-limited"; target.reason = "the OR-stack saturated; GLIMMR was never enumerated";
  const after = findCoverageFormViolations(rows).map((x) => x.row);
  assert.ok(!after.includes(target.row_id), "the block whose own row was settled clears");
  assert.ok(after.includes(psBlocks[1].row_id), "its sibling on the same axis does not");
});

test("an `open` row cannot be confirmed-clean, whatever else the axis says", () => {
  // The exact analogue of undisclosedDeferredQids: every deferred qid had to be named by a NON-CLEAN row
  // on its own axis, and the driver's row for that qid is the naming. A sibling row saying something
  // else on the same axis never disclosed it and still does not.
  const f = settle(build(), "confirmed-clean");
  const d = rowOf(f, "deferred", "tn:translit:glimmer+cyr");
  assert.equal(rowIsSettled(d, d), false);
  const v = findCoverageFormViolations(f.rows).filter((x) => x.row === d.row_id);
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /never searched/);
});

test("`open` carries TWO facts and the detail says which — a block is not a never-searched slice", () => {
  // The repair differs: a never-searched slice is `deferred` and nothing can make it run; a crowd block
  // RAN and saturated, so it is `coverage-limited` — and calling it `deferred` clamps the run's verdict
  // to CONDITIONAL (decideRegisterGap clamps on deferred rows only). A single generic "never searched"
  // detail over both would steer half the open rows to the status that misreports the run.
  const f = settle(build(), "confirmed-clean");
  const v = findCoverageFormViolations(f.rows);
  const blockV = v.find((x) => x.row === rowOf(f, "block", "ps:exact:glimmer+form").row_id);
  const defV = v.find((x) => x.row === rowOf(f, "deferred", "tn:translit:glimmer+cyr").row_id);
  assert.match(blockV.detail, /the search RAN/);
  assert.doesNotMatch(blockV.detail, /never searched/);
  assert.match(defV.detail, /never searched/);
  assert.doesNotMatch(defV.detail, /the search RAN/);
});

test("the skeleton contradiction still fires: state `deferred` with no qids", () => {
  // undisclosedDeferredQids returned [] (fire, naming nothing) rather than null for this shape, and its
  // doc block called silently passing it "the one way this join could turn a gate into a hole". The
  // contradiction now rides the AXIS row's own `open` flag.
  const rows = coverageFormRows({ ...INPUT,
    skeleton: [{ axis: "transliteration-numeric", state: "deferred", deferred: [] }],
    bandBlocksByAxis: {}, activeAxes: ["transliteration-numeric"] }).rows;
  const ax = rows.find((r) => r.kind === "axis");
  assert.equal(ax.open, true);
  ax.status = "confirmed-clean"; ax.reason = "clean";
  assert.equal(findCoverageFormViolations(rows).length, 1);
});

test("a damaged form is ONE named defect, never an absence and never a per-row count", () => {
  const v = findCoverageFormViolations(null, "register-coverage-form.form.json unparseable json (x)");
  assert.deepEqual(v.map((x) => x.reason), ["form_damaged"]);
  assert.match(v[0].detail, /unparseable json/);
});

test("the reason vocabulary is CLOSED and matches what the gate can emit", () => {
  //: an external probe filtered on a string literal that had stopped existing and printed
  // "0 undisposed" over evidence carrying thirteen.
  // added `engine_vocabulary` — the row's status is fine and its REASON carries an engine
  // identifier the client would read. A third reason and not a fourth `no_status` cause, because the
  // seat has already complied with everything `no_status` asks and a hint that repeats that demand is
  // the unactionable shape the 2026-08-05 block records the cost of.
  assert.deepEqual([...COVERAGE_REASONS].sort(), ["engine_vocabulary", "form_damaged", "no_status"]);
  const emitted = new Set([
    ...findCoverageFormViolations(build().rows).map((v) => v.reason),
    ...findCoverageFormViolations(null, "damaged").map((v) => v.reason),
    ...findCoverageFormViolations([{ row_id: "CS-9", axis: "primary-sweep", kind: "seat",
      unit: "primary-sweep / EU", open: false, status: "confirmed-clean",
      reason: "the primary-sweep enumerated to zero" }]).map((v) => v.reason),
  ]);
  for (const r of emitted) assert.ok(COVERAGE_REASONS.includes(r), `${r} is not in the closed vocabulary`);
});

test("the CAUSE vocabulary is closed too, and every cause is reachable", () => {
  // `reason` names the token; `cause` discriminates the three defects that share it, and the fail token
  // carries them as a partitioned census so the corrective hint can lead with the right one. A cause
  // nobody can reach is a hint branch nobody can trigger; a cause the list does not name is a census
  // term repairs.mjs sums without anyone having declared it.
  assert.deepEqual([...COVERAGE_CAUSES].sort(), ["axis_invalid", "no_status", "open_clean"]);
  const causesOf = (rows) => findCoverageFormViolations(rows).map((v) => v.cause);
  // no status at all
  assert.ok(causesOf(build().rows).every((c) => c === "no_status"));
  // an off-enum status is the same cause — the seat wrote something, the enum refuses it
  assert.ok(causesOf(settle(build(), "clean-ish").rows).every((c) => c === "no_status"));
  // an enum-VALID clean on a row the driver marked open
  assert.ok(causesOf(settle(build(), "confirmed-clean").rows).every((c) => c === "open_clean"));
  // an axis outside the register vocabulary
  assert.deepEqual(causesOf([{ row_id: "CS-1", axis: "made-up-axis", kind: "seat", unit: "x",
    open: false, status: "confirmed-clean", reason: "r" }]), ["axis_invalid"]);
  // and the closed list is exactly what the gate can put there
  const all = new Set([...causesOf(build().rows), ...causesOf(settle(build(), "confirmed-clean").rows),
    ...causesOf([{ row_id: "CS-1", axis: "made-up-axis", kind: "seat", unit: "x", open: false, status: "confirmed-clean", reason: "r" }])]);
  for (const c of all) assert.ok(COVERAGE_CAUSES.includes(c), `${c} is not in the closed cause vocabulary`);
});

// ── PARSING, SEAT ROWS, RENDERING ──────────────────────────────────────────────────────────────────

test("PARSED LENIENTLY, JUDGED STRICTLY — and a seat cannot promote its own row to a driver kind", () => {
  const { rows } = parseCoverageForm(JSON.stringify({ rows: [
    { rowId: "CD-X", axis: "Transliteration-Numeric", kind: "deferred", qid: "q", status: " Deferred ", reason: "r" },
    { row_id: "X", axis: "primary-sweep", kind: "invented", unit: "primary-sweep / mine", status: "confirmed-clean", reason: "r" },
  ] }));
  assert.equal(rows[0].status, "deferred", "case and padding are repaired at the parse boundary");
  assert.equal(rows[0].axis, "transliteration-numeric");
  assert.equal(rows[1].kind, "seat", "an unknown kind is a seat row, whatever it called itself");
  assert.deepEqual(parseCoverageForm("{ nope").rows, null);
  assert.match(parseCoverageForm("{ nope").error, /unparseable json/);
  assert.match(parseCoverageForm("{}").error, /rows/);
  assert.deepEqual(parseCoverageForm(null), { rows: null, error: null, parsed: null });
});

test("seat rows keep their identity across a re-emit that changes only spacing", () => {
  const a = seatRows([{ axis: "primary-sweep", kind: "seat", unit: "primary-sweep / NZ  (material)", status: "deferred", reason: "not run" }], []);
  const b = seatRows([{ axis: "primary-sweep", kind: "seat", unit: "primary-sweep /  NZ (material) ", status: "deferred", reason: "not run" }], []);
  assert.equal(formRowKey(a[0]), formRowKey(b[0]));
  assert.equal(a[0].row_id, b[0].row_id);
});

test("a seat row cannot displace a driver row", () => {
  const driverKeys = new Set(build().rows.map(formRowKey));
  const out = seatRows([{ axis: "transliteration-numeric", kind: "deferred", qid: "tn:translit:glimmer+cyr",
    status: "confirmed-clean", reason: "mine now" }], driverKeys);
  assert.deepEqual(out, [], "a submitted row claiming a driver kind is not a seat row at all");
});

test("the rendered table carries the identifiers the model no longer types", () => {
  const f = settle(build(), "coverage-limited", "an honest gap");
  const md = renderCoverageLedgerSection(f.rows);
  assert.match(md, /^## Coverage ledger$/m);
  assert.match(md, /ps:exact:glimmer\+form/, "the qid, machine-written");
  assert.match(md, /6862 hits/);
  assert.match(md, /indexes non-latin filings/, "the deferred slice's receipt reason reaches the reader");
});

test("the render is idempotent — a second pass updates the table, never appends a second one", () => {
  const doc = "# Register findings\n\n## Findings\n\nbody\n\n## Audit trail\n\n| a |\n";
  const one = spliceCoverageLedger(doc, renderCoverageLedgerSection(settle(build(), "confirmed-clean").rows));
  const two = spliceCoverageLedger(one, renderCoverageLedgerSection(settle(build(), "confirmed-clean").rows));
  assert.equal((two.match(/^## Coverage ledger$/gm) ?? []).length, 1);
  assert.equal(one, two);
  assert.ok(two.indexOf("## Coverage ledger") < two.indexOf("## Audit trail"),
    "the ledger lands before the audit trail, the order digest.md describes");
});

test("the machine ledger derives FROM the form and round-trips through its own strict parser", () => {
  const f = settle(build(), "coverage-limited", "class 30 counted, not enumerated");
  const json = renderCoverageLedgerJsonFromForm(f.rows, classTokensFromScopeText);
  const rows = parseCoverageLedgerJson(json, { activeAxes: INPUT.activeAxes });
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((r) => ["confirmed-clean", "coverage-limited", "deferred"].includes(r.status)));
  const ic = rows.find((r) => r.axis === "incumbent-class" && r.scope.includes("owner"));
  assert.deepEqual(ic.classes, ["5", "30"], "classes are computed from the machine-written unit, not from prose");
});

test("an unfilled row renders nowhere — outstanding work is a count, not a table row reading dash", () => {
  assert.equal(renderCoverageLedgerSection(build().rows), "");
  assert.deepEqual(formLedgerRows(build().rows), []);
});

test("formLedgerRows gives every downstream coverage consumer the shape it already reads", () => {
  const form = settle(build(), "deferred", "open");
  const rows = formLedgerRows(form.rows);
  // CARDINALITY FIRST. `.every()` over an empty array is TRUE, so this assertion alone passed for a
  // formLedgerRows that always returned [] — and the test beside it asserts the empty case deepEquals
  // [], so the pair pinned nothing at all. An assertion that cannot fail is not a regression test.
  assert.equal(rows.length, form.rows.length, "every settled row reaches the consumers, none is dropped");
  assert.ok(rows.length >= 5);
  assert.ok(rows.every((r) => r.axis && r.status && typeof r.unit === "string" && typeof r.reason === "string"));
});

test("the sidecar name is derived from the seat-facing path and from nothing else", () => {
  assert.equal(coverageFormSidecarName("register-coverage-form.json"), "register-coverage-form.form.json");
  assert.equal(coverageFormSidecarName("/run/dir/register-coverage-form.json"), "register-coverage-form.form.json");
  assert.equal(coverageFormSidecarName(""), "");
});

test("the dispatch brief names the TOOL and the two fields, and recites no qid", () => {
  // Typed transport: the brief names no file — the rows are enumerated INTO the dispatch (the seat's
  // only sight of them) and the recording route is the record_coverage call.
  const brief = coverageFormBrief(build());
  assert.match(brief, /record_coverage/);
  assert.ok(!brief.includes("register-coverage-form.json"), "no coverage file is named to the seat");
  assert.match(brief, /THE ROWS:/);
  assert.match(brief, /`status`/);
  assert.match(brief, /`reason`/);
  assert.ok(!brief.includes("ps:exact:glimmer+form"),
    "the qids are IN the form; reciting them into the dispatch is the transcription lane this build removes");
  // THE TWO OPEN SETS ARE DISJOINT AND COUNTED SEPARATELY. Block rows are `open` too now, so a single
  // "N rows are marked open" line would count them twice and describe both with the never-searched
  // wording — which is false for a crowd block and steers it to `deferred`, the status that clamps the
  // verdict. One deferred slice, two crowd blocks, two paragraphs.
  assert.match(brief, /1 row\(s\) are NEVER-SEARCHED slices/);
  assert.match(brief, /2 row\(s\) are UNACCOUNTED CROWD BLOCKS/);
  assert.match(brief, /is `coverage-limited` — NOT `deferred`/);
  assert.match(brief, /EACH OF THESE ROWS IS DISCHARGED ONLY BY ITSELF/);
  assert.equal(coverageFormBrief({ rows: [] }, "/x.json"), "", "no form ⇒ no block, never an empty alarming one");
});

// ── — THE SEAT IS REFUSED THE ENGINE'S WORDS WHERE IT WRITES THEM ───────────────────────────────
//
// fixed this at the render seam with find-and-replace over the client's page, and is what
// that cost: `axis` -> `group` turned "AXIS Bank filed in class 36" into "group Bank filed in class 36"
// on the report that was clearing AXIS. The ban list and the trademark register overlap.
//
// A refusal has neither failure mode, because it goes to the thing that can rewrite the sentence.
test("#669 the seat's reason may not carry an engine identifier — refused per row, with the token named", () => {
  const row = (reason) => ({ row_id: "CS-1", axis: "primary-sweep", kind: "seat",
    unit: "primary-sweep / EU", open: false, status: "confirmed-clean", reason });
  const v = findCoverageFormViolations([row("all fifteen primary-sweep queries enumerated to zero")]);
  assert.deepEqual(v.map((x) => x.reason), ["engine_vocabulary"]);
  assert.deepEqual(v[0].tokens, ["primary-sweep"]);
  assert.equal(v[0].row, "CS-1", "the seat repairs the sentence it wrote, not 'the form'");
  assert.match(v[0].detail, /the coverage unit already carries the identifier/);
  // every closed token, and the spaced spelling of each
  for (const tok of SEAT_BANNED_TOKENS) {
    assert.equal(findCoverageFormViolations([row(`x ${tok} y`)]).length, 1, `${tok} must be refused`);
    assert.equal(findCoverageFormViolations([row(`x ${tok.replace(/-/g, " ")} y`)]).length, 1,
      `${tok} spelled with spaces must be refused too`);
  }
  // a clean sentence passes, and a SETTLED row is still checked — that is the row whose reason ships
  assert.deepEqual(findCoverageFormViolations([row("the EU leg enumerated completely and returned no live marks")]), []);
});

test("#669 the ban list is HYPHENATED COMPOUNDS ONLY — a one-word mark is never refused", () => {
  // The selection rule, asserted rather than described. A refusal that cannot tell engine vocabulary
  // from a mark would block a clearance on the mark SLICE, which is one level in. Every banned
  // token must be a compound; the bare nouns are taught in the dictation and NOT enforced.
  for (const tok of SEAT_BANNED_TOKENS)
    assert.match(tok, /-/, `${tok} is a single word and could be a trademark`);
  const row = (reason) => ({ row_id: "CS-2", axis: "primary-sweep", kind: "seat",
    unit: "primary-sweep / EU", open: false, status: "confirmed-clean", reason });
  for (const mark of ["AXIS", "Axis", "axis", "SLICE", "Slice", "slice", "GROUP", "sweep"])
    assert.deepEqual(findCoverageFormViolations([row(`${mark} enumerated to zero on the EU leg`)]), [],
      `the mark ${mark} must survive a reason the client reads`);
});
