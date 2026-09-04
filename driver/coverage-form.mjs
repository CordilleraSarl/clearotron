// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-form.mjs — the register-digest COVERAGE FORM.
//
// THE DEFECT THIS CLOSES. The coverage gate asked whether a sentence the model typed CONTAINED a query
// id, or a crowd block's exact hit count as a standalone number (register-plan.blockIsDisclosed, deleted
// by this change). Both accept-forms were substring matches against text the model authored, and there
// was no machine-fed arm at all. Worse, the skill taught a shape the gate rejects — digest.md modelled a
// reason cell reading `returned ~N,NNN hits` — while the word `qid` appeared nowhere in the Coverage
// ledger section it governs. So the gate fired on the first dispatch BY CONSTRUCTION and cleared only
// through the corrective ladder, which for this stage is cold: the one measured three-attempt profile in
// the repo is this stage's (repair-contract.mjs:10-18 — 105,747 out FAIL, 137,519 out FAIL, 36,362 out
// PASS; ~86% of emitted tokens landed in no artifact, and the attempt that passed is the one that
// PATCHED). A cold ladder never patches.
//
// THE CURE IS 's, one gate over: the driver writes the row and the model fills in the judgment. The
// axis, the coverage unit, the open crowd blocks with their qids and hit counts, and the deferred slices
// with their per-qid receipt reasons are all facts the driver holds BEFORE the stage dispatches. It
// writes them. The seat sets `status` and `reason`, and nothing else in the file is the seat's to write.
// Nothing is transcribed, so a mistyped identifier is no longer a reachable failure.
//
// PURE — no node imports, so it tests offline, exactly like coverage-ledger.mjs and connotation-search.mjs
// (whose headers state the same rule for the same reason). `shortId` is IMPORTED from connotation-search
// rather than re-implemented: it is a generic fnv1a64 id stamp, and a second copy of an id function is
// two calculations kept in step, which is 's defect.
//
// ONE CALCULATION, NOT TWO. `openBlocksByAxis` (register-plan.mjs) computes the open crowd blocks — the
// same C2..C7 conditions the deleted gate computed, unchanged — and it is called EXACTLY ONCE per pass,
// by buildCoverageForm. The gate below judges the rows in the form, never a second derivation of them.

import { REGISTER_AXES, COVERAGE_STATUSES, normalizeAxis, CROWD_RULING_TOKEN,
  CROWD_RULING_UNIT_GRAMMAR } from "./coverage-ledger.mjs";
import { shortId } from "./connotation-search.mjs";
import { openBlocksByAxis } from "./register-plan.mjs";
import { territoryLayerReport, unsearchedLayerReason } from "./binding-layers.mjs";

const STATUS_SET = new Set(COVERAGE_STATUSES);
const DRIVER_KINDS = new Set(["axis", "block", "deferred"]);

// ── SEAT ROWS — WHAT THE FORM DOES NOT TAKE AWAY ────────────────────────────────────────────────────
//
// The driver knows every axis, every open crowd block and every deferred slice. It does NOT know the
// per-jurisdiction reconciliation slice, the cross-class merch check or any other
// coverage unit the digest reasons its way to — those are judgment about what was covered, and the
// ledger a lawyer reads has always carried them. A form that admitted only driver rows would silently
// shrink that ledger from a per-slice reconciliation to four axis lines, which is a product regression
// dressed as a contract.
//
// So the seat may ADD rows, and only rows: `kind: "seat"`, its own `unit` label, its own status and
// reason. It cannot add, drop or alter a DRIVER row — those are regenerated from the plan on every
// pass, and a seat row whose key collides with one is dropped rather than allowed to override it. A
// seat row carries no identifier anything joins on, which is the whole rule this build enforces: the
// machine writes everything that must be exact, and the model writes the judgment.
//
// A seat row can DISCHARGE an axis exactly as a model-authored `coverage-limited` row does today —
// that is the axis-scoped rule preserved, not a hole opened.
//
// ── AND IT CARRIES AN AXIS, WHICH THE SEAT SUPPLIES AND IS SHOWN ────────────────────────────────────
//
// The first cut of this build asserted, in digest.md, that "you never author an axis token, so an axis
// cell can no longer be wrong." That was false and it was false ON THE FIRST DISPATCH: `rowIsSettled`
// refuses any row whose axis is outside REGISTER_AXES, a seat row's axis is whatever the seat wrote (or
// did not write), and three of the four seat-row examples the skill names — the per-jurisdiction
// reconciliation, the counted dominant-element crowd — normalise to "" and were
// REFUSED. The skill taught a shape the gate rejects, which is the defect the form was built to
// remove, recreated one field over.
//
// THE DRIVER DOES NOT ASSIGN IT, AND THAT IS A DECISION, NOT AN OMISSION. The axis of a driver row is
// derived (the plan entry says which axis it is). The axis of a seat row is not derivable from anything
// the driver holds: the seat is adding a coverage unit the plan does not contain, labelled with a phrase
// the seat invented. A machine that guessed would be guessing on a cell with teeth — NON_MATERIAL_AXES
// exempts `saturation-probe` from the CLEAR→CONDITIONAL clamp, so a material limitation mis-filed there
// silently drops the clamp. A wrong guess fails OPEN. A model choosing from a set it is shown does not.
//
// So the axis is the seat's, and every surface the seat reads carries the four tokens VERBATIM: this
// form's own `seat_row_contract` (below — the machine writes the allowed set into the file being
// edited), the dispatch brief, the skill, and the correction hint. A value a model must supply and is
// never shown is the defect; a value it must supply and is shown on every surface is a choice.
//
// BELT AND BRACES, FREE: the dictated `unit` label is `<axis> / <what you swept>`, the same shape
// `unitLabel` composes for driver rows, so `normalizeAxis(r.axis, r.unit)` in `seatRows` recovers the
// axis from the label when a re-emit drops the `axis` cell. That is repair of a lost field, never
// invention of a missing one — normalizeAxis leaves a genuinely unknown token unchanged and the gate
// still refuses it.

/**
 * THE FIELDS A SEAT ROW OWES — the single list every surface that teaches the shape is measured against.
 *
 * THIS IS NOT A DECLARATION, IT IS A MEASUREMENT, and the difference is the whole of round 4. Three
 * rounds of this build each fixed one site where the skill taught a shape the gate refuses; the cure is
 * not a fourth fix but a list the machine can check the skill against. So `skill-contract-enumerations`
 * drops each of these fields IN TURN from an otherwise-compliant seat row, drives it through the live
 * path (union → bytes → validator), and asserts the row is refused or lost. A field that does not
 * belong here fails that test; a field the gate starts requiring and this list omits fails it too. The
 * list cannot drift from the gate without CI saying so, and the skill cannot drift from the list.
 *
 * WHAT EACH ONE COSTS IF OMITTED, measured (not asserted) by that test:
 *   kind    — parseCoverageForm defaults an absent `kind` to "axis", a DRIVER kind, and seatRows drops
 *             driver-kind rows: the row VANISHES from the form, silently, taking its judgment with it.
 *   axis    — rowIsSettled refuses any row outside REGISTER_AXES → `coverage_form_axis_invalid`.
 *   unit    — defaults to the bare axis, which is survivable for a general row and FATAL for the
 *             counted-crowd row below: the crowd token lives in this cell and nowhere else.
 *   status  — refused, `coverage_no_status`.
 *   reason  — refused, `coverage_no_status`. It is also the sentence the lawyer reads.
 */
export const SEAT_ROW_FIELDS = Object.freeze(["kind", "axis", "unit", "status", "reason"]);

/**
 * WHAT A SEAT ROW OWES, written INTO the accumulator (and told to the seat in the dispatch brief and
 * the tool's own refusals — the seat no longer opens this file). The allowed axis set is not prose
 * about the file, it is a field OF the file: 's finding was "a fact obeyed as a failure and
 * ignored as an input", and a closed vocabulary the seat must hit and is never shown is exactly that.
 * PURE data.
 *
 * `fields` and `counted_crowd` are new in round 4. The first makes the required set a value OF the file
 * rather than something reconstructed by counting bullets in prose. The second carries the ONE seat row
 * the digest is compelled to write — the counted dominant-element crowd, whose absence blocks delivery —
 * with the exact cell its count must land in, because that count is read out of `unit` and NOWHERE else.
 */
export const SEAT_ROW_CONTRACT = Object.freeze({
  what: "Rows you ADD, for coverage units the plan does not contain — the per-jurisdiction "
    + "reconciliation, a cross-class merch check, a counted dominant-element crowd. "
    + "Those are judgment and the ledger a lawyer reads has always carried them.",
  fields: [...SEAT_ROW_FIELDS],
  kind: "seat",
  axis: [...REGISTER_AXES],
  axis_rule: "REQUIRED on a row you add, and EXACTLY one bare token of the `axis` list above — the "
    + "vocabulary is CLOSED. Choose the axis whose coverage the row qualifies: a per-jurisdiction "
    + "reconciliation or a cross-class / cross-check / merch sweep is `primary-sweep`; an owner, "
    + "incumbent, watchlist-owner or stealth-filer sweep is `incumbent-class`; a counted "
    + "dominant-element or meaning-token crowd is `saturation-probe`; a transliteration or numeric-form "
    + "slice is `transliteration-numeric`. Never a jurisdiction, a class, a sweep name or a phrase.",
  unit: "<axis> / <what you swept> — the same shape the driver's own rows use.",
  status: [...COVERAGE_STATUSES],
  reason: "The sentence the lawyer reads.",
  counted_crowd: {
    when: "The dominant-element reconciliation left residual POSITIONS you did not end individually. "
      + "This is the ONE row you are compelled to add, and the only seat row under a delivery-blocking "
      + "gate: a residual position with no finding row and no drop row is covered ONLY by membership of "
      + "a ruled, COUNTED crowd, and a position ending nowhere blocks the run.",
    unit: CROWD_RULING_UNIT_GRAMMAR,
    token: CROWD_RULING_TOKEN,
    count_cell: "unit",
    count_rule: "The member count is read out of the `unit` cell and NOWHERE ELSE — a count that sits "
      + "in `reason` parses as ZERO, the crowd then covers no position, and delivery blocks over a "
      + "ruling you did make. Write it as a bare integer in `(<N> members)`, counted in POSITIONS, at "
      + "least the number of residual positions you did not end individually.",
  },
  note: "The axis on a row the DRIVER wrote is the driver's and is regenerated every pass. This "
    + "contract governs rows YOU add, and nothing else in this file.",
});

const PROVENANCE = "driver-written form (#476; typed transport). Every field except `status` and "
  + "`reason` is computed by the driver from the frozen register plan, the plan-execution receipt and "
  + "the per-axis band files — the same calculation the validator judges with — and is REGENERATED on "
  + "every pass. The statuses and reasons arrive ONLY through the `record_coverage` tool, validated "
  + "per row at call time; no seat opens or edits this file, and no hand-written bytes are read. A row "
  + "marked `open` carries a slice the machine knows was never searched or never accounted for: it "
  + "cannot be confirmed-clean, and its own `open_because` says which of the two it is — a "
  + "never-searched slice is `deferred`, a crowd block that ran and saturated is `coverage-limited`. "
  + "EACH OPEN ROW IS DISCHARGED ONLY BY ITSELF: a status on one row never accounts for another row's "
  + "slice. Statuses accumulate across attempts: a row settled once stays settled. Seat-added rows "
  + "(`kind: \"seat\"`) arrive through the same tool — `seat_row_contract` carries their closed axis "
  + "vocabulary. A `reason` IS PRINTED ON THE CLIENT'S REPORT, so it is refused if it names an engine "
  + "identifier (primary-sweep, saturation-probe, transliteration-numeric, incumbent-class, "
  + "crowd-context).";

/**
 * The name of the DRIVER'S copy of the form — since the typed-transport conversion, the ONLY live
 * copy. Two names still resolve (coverage-form-io.coverageFormPaths), and the asymmetry is now the
 * whole story:
 *
 *   · THE SEAT-FACING COPY IS DEAD. The seat records statuses through the `record_coverage` tool and
 *     never opens a coverage file; repairs order tool calls, not file edits (gateway's warm-patch
 *     coverage branch). The name survives only so archived runs' seat copies stay addressable.
 *   · THE `_driver/` COPY is the ACCUMULATOR and the ERA STAMP's object. It survives an attempt, a
 *     recovery park and a process restart. And because the seat holds no writer onto `_driver/`, it
 *     can be neither forged nor deleted into a pass.
 *
 * PURE: string work only, no path module.
 */
export function coverageFormSidecarName(formPath) {
  const base = String(formPath ?? "").split(/[\\/]/).pop();
  if (!base) return "";
  return `${base.replace(/\.json$/i, "")}.form.json`;
}

/** The seat's two fields, trimmed. Anything else on a submitted row is the driver's and is ignored. */
export function seatFields(row) {
  return {
    status: String(row?.status ?? "").trim().toLowerCase(),
    reason: String(row?.reason ?? "").trim(),
  };
}

/**
 * Which obligation a form row answers. Rows are found by the driver's row id FIRST and by this key
 * second — the second exists because a seat that re-emits the file from its own reading may drop the id,
 * and losing a settled judgment over a field the seat was told not to touch is the shape this build
 * exists to end. Both identifiers are the driver's; neither was ever the seat's to type. PURE.
 */
export function formRowKey(row) {
  const kind = String(row?.kind ?? "").trim() || "axis";
  const axis = String(row?.axis ?? "").trim().toLowerCase();
  const qid = String(row?.qid ?? "").trim();
  if (kind === "axis") return `axis:${axis}`;
  // A seat row has no qid to key on — its identity is its axis and the label it chose, normalised so a
  // re-emit that changes only spacing or case is the same row and keeps its status.
  if (!DRIVER_KINDS.has(kind)) return `seat:${axis}:${String(row?.unit ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  // A DRIVER ROW WITH NO QID IS NOT A CONTRADICTION — it is the unreached-office row, whose whole
  // content is that there is no query to point at. Keyed on axis and unit like a seat row, because
  // `deferred:` — which is what `${kind}:${qid}` produces for every one of them — is ONE key: the union
  // de-dupes by key, so four unreached offices across two axes would carry a single row and the other
  // seven would vanish, silently, into a form that looks complete.
  if (!qid) return `${kind}:${axis}:${String(row?.unit ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  return `${kind}:${qid}`;
}

/** The seat rows of a submitted form, normalised and de-duped. Never driver rows. PURE. */
export function seatRows(rows, driverKeys) {
  const out = [], seen = new Set(driverKeys ?? []);
  for (const r of (rows ?? [])) {
    if (!r || DRIVER_KINDS.has(String(r.kind ?? "").trim())) continue;
    // normalize-then-validate at the ingest boundary, exactly as the prose parser did: repair markdown /
    // qualifier / transposition noise on the axis, and let a genuinely unknown axis through so the strict
    // ledger contract still refuses it with its own token rather than this module inventing an axis.
    const axis = normalizeAxis(r.axis, r.unit);
    const unit = String(r.unit ?? "").replace(/\s+/g, " ").trim() || axis;
    const row = { row_id: "", axis, kind: "seat", unit, qid: null, open: false,
      status: String(r.status ?? "").trim().toLowerCase(), reason: String(r.reason ?? "").trim() };
    row.row_id = shortId("CS", formRowKey(row));
    const key = formRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// The coverage unit label, composed by the machine from the plan entry it is about — never a string the
// seat invents and never one it has to reproduce. `<axis> / <predicate>: <term(s)> [cl <classes>]`, the
// same left-of-slash-is-the-axis shape every downstream coverage consumer keys on (coverage-ledger.mjs
// normalizeAxis, scope-facts, the taint join). Terms are bounded so an OR-stack of forty cannot make one
// table cell unreadable; the qid rides its own column, so nothing identifying is lost to the cut.
const MAX_TERMS_IN_LABEL = 4;
function unitLabel(axis, entry) {
  if (!entry) return String(axis);
  const terms = Array.isArray(entry.terms) && entry.terms.length
    ? entry.terms
    : (typeof entry.term === "string" && entry.term.trim() ? [entry.term] : []);
  const shown = terms.slice(0, MAX_TERMS_IN_LABEL).map((t) => String(t).trim()).filter(Boolean);
  const more = terms.length > shown.length ? ` +${terms.length - shown.length} more` : "";
  const cls = Array.isArray(entry.nice_classes) && entry.nice_classes.length
    ? ` [cl ${entry.nice_classes.join(", ")}]` : "";
  const scope = [
    String(entry.predicate ?? "").trim(),
    shown.length ? `${shown.join(" OR ")}${more}` : "",
  ].filter(Boolean).join(": ");
  return `${axis} / ${scope || String(entry.qid ?? "")}${cls}`;
}

/**
 * THE FORM'S ROWS, computed from driver facts alone. Three kinds, and the kind decides what the row owes:
 *
 *   `axis`     — one per axis the run activated or the plan-execution skeleton names. It is the axis's
 *                overall coverage statement and it is what keeps `coverage_axis_missing` satisfiable:
 *                every active axis owns at least one row BY CONSTRUCTION rather than by the model
 *                remembering. `open` only in the skeleton-contradiction case below.
 *   `block`    — one per OPEN crowd block: a block on an `incomplete` axis whose per-term or per-class
 *                accounting is not resolved (openBlocksByAxis — C2..C7, unchanged). It carries the qid,
 *                the hit count and the unaccounted terms/classes: BOTH of the things that used to have to
 *                be typed to discharge it, written by the machine that computed them.
 *   `deferred` — one per deferred qid, carrying that qid's OWN receipt reason. The old hint printed the
 *                first six per axis and one reason for all of them; R1 carried fourteen. Every qid ships.
 *
 * `open` is the driver's verdict that a row's slice was never searched or never accounted for, so the
 * seat may not call it confirmed-clean. It is set on `deferred` rows; on `block` rows; and on the AXIS
 * row of an axis whose skeleton state is `deferred` while carrying NO deferred qids — a skeleton
 * contradiction the builder cannot produce, which the pre-form code fired on with `missing: []` and
 * which must keep firing. Each open row carries its OWN `open_because`, because `open` covers two
 * different facts and the repair differs: a deferred slice was NEVER SEARCHED and no re-run can reach
 * it; an open crowd block RAN and came back unaccounted.
 *
 * BLOCK ROWS ARE `open`, AND THAT IS THE GATE THIS REPLACES, NOT A TIGHTENING OF IT. The first cut of
 * this build left them open:false, on the reading that the old gate was "axis-scoped" so any non-clean
 * row on the axis discharged every block on it. That reading was wrong and it came from the design
 * document, which has since been corrected. The HAYSTACK was per axis; the JOIN was per block.
 * `blockIsDisclosed` (register-plan.mjs, restored there for archived runs — read its doc block) asks
 * whether THAT BLOCK'S OWN evidence appears in the axis's disclosure text: its qid verbatim, or its
 * `total_hits` as a standalone number. A row about slice A discharged block B only where A's text
 * happened to name B. Its own words: disclosure joins on block-specific evidence, "never on the mere
 * presence of some non-clean row, which would reopen the FROSTBERRY hole through an unrelated slice's
 * disclosure".
 *
 * So the invariant is: A BLOCK IS DISCHARGED ONLY BY EVIDENCE NAMING THAT BLOCK. The driver writes that
 * block its own row, carrying the qid and the hit count it used to take a transcription to supply, so
 * "a non-clean row naming this block" becomes "this block's row is non-clean" — the same judgment with
 * the typing removed, which is exactly the cure already applied to `deferred` rows. What this build
 * deletes is the STRING MATCHING. It never deletes the BLOCK SPECIFICITY.
 *
 * @param {{skeleton?: Array, activeAxes?: string[], plan?: object, bandBlocksByAxis?: object,
 *          deferredReasons?: object}} input
 * @returns {{rows: Array, derived_from: object}} — PURE; never throws.
 */
export function coverageFormRows({ skeleton = [], activeAxes = null, plan = null,
  bandBlocksByAxis = {}, deferredReasons = {}, bandsUnreadable = [],
  orderedTerritories = [], capabilities = null } = {}) {
  const skel = Array.isArray(skeleton) ? skeleton.filter((s) => s && typeof s === "object") : [];
  const entriesByQid = new Map((plan?.entries ?? []).map((e) => [e.qid, e]));
  const open = openBlocksByAxis(skel, bandBlocksByAxis, plan);
  // Axis order is the run's, not a set's iteration order: the plan-execution skeleton first (the order
  // the plan dictated), then any active axis the skeleton does not name, then the canonical axis list as
  // the final tie-break. Deterministic ⇒ the same run regenerates a byte-identical form every pass.
  const axes = [];
  for (const s of skel) { const a = String(s.axis ?? "").trim(); if (a && !axes.includes(a)) axes.push(a); }
  for (const a of (activeAxes ?? [])) { const ax = String(a).trim().toLowerCase(); if (ax && !axes.includes(ax)) axes.push(ax); }
  for (const a of REGISTER_AXES) if (Object.keys(open).includes(a) && !axes.includes(a)) axes.push(a);

  // Every office code this plan will actually query, across every ordered territory. A binding layer
  // counts as searched when SOME searched office is ESTABLISHED to return it — see binding-layers.mjs
  // on why `unestablished` never counts.
  const searchedOffices = [...new Set((plan?.entries ?? [])
    .flatMap((e) => (Array.isArray(e?.regions) ? e.regions : []))
    .map((r) => String(r ?? "").toUpperCase()).filter(Boolean))];

  const rows = [];
  for (const axis of axes) {
    const s = skel.find((x) => String(x.axis ?? "").trim() === axis) ?? null;
    const state = String(s?.state ?? "").trim() || null;
    const deferredQids = Array.isArray(s?.deferred)
      ? s.deferred.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim()) : [];
    const contradiction = state === "deferred" && !deferredQids.length;
    rows.push({
      row_id: shortId("CA", `axis:${axis}`),
      axis, kind: "axis",
      unit: axis,
      qid: null,
      skeleton_state: state,
      open: contradiction,
      ...(contradiction
        ? { open_because: "the plan-execution skeleton calls this axis deferred and names no deferred qid — a contradiction the builder cannot produce, so this axis cannot be claimed clean" }
        : {}),
      status: null, reason: null,
    });
    for (const b of (open[axis] ?? [])) {
      rows.push({
        row_id: shortId("CB", `block:${b.qid}`),
        axis, kind: "block",
        unit: unitLabel(axis, entriesByQid.get(b.qid)),
        qid: b.qid,
        // BOTH accept-forms of the gate this replaces ride the row, written by the machine: the qid
        // above, and the hit count here. The equivalence the old join had to test for is now structural.
        ...(Number.isInteger(b.total_hits) ? { total_hits: b.total_hits } : {}),
        ...(b.unaccounted?.length ? { unaccounted_terms: b.unaccounted } : {}),
        ...(b.unaccounted_classes?.length ? { unaccounted_classes: b.unaccounted_classes } : {}),
        // The block's OWN row is the naming the deleted join required. A clean claim HERE is the
        // silent swallow; a clean claim on a sibling slice never discharged this block and does not now.
        open: true,
        open_because: "the band left this slice neither verified-zero nor individually enumerated nor a"
          + " ruled crowd, so part of it is unaccounted — the search RAN, and this block is what it did"
          + " not close. It cannot be confirmed-clean, and no row about another slice discharges it",
        status: null, reason: null,
      });
    }
    for (const qid of deferredQids) {
      rows.push({
        row_id: shortId("CD", `deferred:${qid}`),
        axis, kind: "deferred",
        unit: unitLabel(axis, entriesByQid.get(qid)),
        qid,
        receipt_reason: String(deferredReasons?.[qid] ?? "").replace(/\s+/g, " ").trim(),
        // The active provider cannot express this query at all. It was never searched and nothing can
        // make it run, so a clean claim over it is not a judgment the seat gets to make.
        open: true,
        open_because: "the active register provider cannot express this query — it was never searched and no re-run can reach it",
        status: null, reason: null,
      });
    }
    // ── AN OFFICE THIS DEPLOYMENT COULD NOT REACH ────────────────────────────────────────
    //
    // The one deferral shape that arrives WITHOUT A QID, which is why every row above missed it.
    //
    // taught the compiler to split a multi-office scope when one member of a composed provider is
    // unconfigured here — free-tier's US half with no `USPTO_LOCAL_DB`, say. The unreachable office is
    // moved OUT of `regions` before entries compile, so the EU half still runs. Nothing fails. There is
    // no qid for the US, so no band block, so no `joinPlanToBands` deferral, so no row above — and the
    // skeleton reads `executed` on every axis because every entry that exists did execute.
    //
    // Probed on origin/main @ 0ae9431: an EU+US matter on a box with no index compiled 5 EU entries and
    // `deferred_coverage: ["US"]`, executed all 5, and produced TWO rows, both `open:false`, neither
    // naming the US. A lawyer read an EU-only clean under a scope the deliverable states as EU+US.
    // Doctrine rule 2 by omission, which is the shape this whole form exists to make impossible.
    // `pipeline.mjs`'s own comment predicted it: closed for the whole-plan case, left open for this one.
    //
    // ONE ROW PER AXIS, and that is a decision rather than a convenience. The deferral is per-TERRITORY
    // and the axes are the vocabulary — `rowIsSettled` refuses any row whose axis is outside the closed
    // REGISTER_AXES, so a territory row cannot have an axis of its own without widening that set and
    // every ledger contract downstream of it. Repeating it per axis is also the safer disclosure: a
    // reader working down one axis cannot reach a clean claim without meeting the gap, and no sibling
    // axis's row discharges another's. The cost is N rows for N active axes, which for the free tier is
    // two.
    for (const [i, d] of (Array.isArray(plan?.deferred_coverage) ? plan.deferred_coverage : []).entries()) {
      // A DEFERRAL WE CANNOT NAME IS MORE ALARMING THAN ONE WE CAN, so it is disclosed rather than
      // skipped. The first cut of this loop did `if (!jurisdiction) continue`, which reports a malformed
      // entry as a pass — the exact shape everything else in this file exists to refuse. The compiler
      // does not produce one today; that is a reason to keep the branch cheap, not a reason to make an
      // absence silent. Over-disclosure a reader resolves beats a clean over a territory nobody queried.
      const named = String(d?.jurisdiction ?? "").trim();
      const jurisdiction = named || `unnamed deferral #${i + 1}`;
      rows.push({
        row_id: shortId("CO", `deferred-office:${axis}:${jurisdiction}`),
        axis, kind: "deferred",
        unit: named ? `${named} register — not searched` : `${jurisdiction} — territory not recorded`,
        // No qid, deliberately: there is no query to point at. That is the whole fact. `formRowKey`
        // keys a qid-less driver row on its axis and unit, or every one of these would collapse onto
        // the single key `deferred:` and the union would carry exactly one of them.
        qid: null,
        receipt_reason: String(d?.reason ?? "").replace(/\s+/g, " ").trim(),
        open: true,
        open_because: named
          ? `the ${named} register was never searched on this run — the plan compiled without it because `
            + `this deployment cannot reach that office. It is a deferred coverage gap for judgment, `
            + `never a clean negative, and no result from another territory discharges it`
          : `the plan carries a deferred coverage entry whose territory is not recorded, so something was `
            + `not searched and this run cannot say what. Read _driver/register-plan.json's `
            + `deferred_coverage before any clean claim — an unnameable gap is a wider gap, not a smaller one`,
        status: null, reason: null,
      });
    }
  }

  // ── STAGE 1 — the binding layers a territory has, and which of them were searched ───────────
  //
  // THE GAP THIS FILLS IS NOT A COVERAGE GAP, IT IS A DISCLOSURE ONE. Every row above describes a
  // territory the compiler recorded as UNREACHABLE. The defect on is the opposite shape: the
  // territory WAS reached, one of its binding registers was searched, and the other two were never
  // considered — so nothing was recorded as missing and there was no row to render. A France order
  // searched the French national register and presented as a complete France clearance, while an EU
  // trade mark blocking use in France sat in a register nobody queried.
  //
  // DRIVER-WRITTEN, LIKE ITS NEIGHBOURS, because the owner's ruling is that the report must state it
  // plainly and a model must not be able to omit it. The row is computed from what the plan DID.
  //
  // The reason is written in a lawyer's words and carries no axis token — the gate refuses a row whose
  // reason contains one, and the reader has no use for the engine's vocabulary anyway.
  for (const territory of (orderedTerritories ?? [])) {
    let report;
    try { report = territoryLayerReport(territory, searchedOffices, capabilities); }
    catch { continue; }   // an unnameable territory is already disclosed by the deferred loop above
    if (report.complete) continue;
    rows.push({
      row_id: shortId("CL", `layers:${report.territory}`),
      axis: "primary-sweep", kind: "deferred",
      unit: `${report.territory} — binding registers not all searched`,
      qid: null,
      receipt_reason: report.unsearched
        .map((u) => `${u.layer} (${u.office}): ${u.state}`).join("; "),
      open: true,
      open_because: unsearchedLayerReason(report),
      status: null, reason: null,
    });
  }

  return {
    rows,
    derived_from: {
      skeleton_axes: skel.map((s) => String(s.axis ?? "")).filter(Boolean),
      plan_entries: (plan?.entries ?? []).length,
      open_blocks: Object.values(open).reduce((n, arr) => n + arr.length, 0),
      deferred_qids: rows.filter((r) => r.kind === "deferred").length,
      // Counted separately from `deferred_qids`, which counts the same rows: the two shapes have
      // different causes and different repairs — a deferred qid is a query the provider cannot express
      // anywhere, an unreached office is a variable an operator can set on THIS box — and a reader of
      // the receipt should be able to tell which of the two a run carried.
      deferred_offices: (Array.isArray(plan?.deferred_coverage) ? plan.deferred_coverage : []).length,
      // AN ABSENCE IS A FINDING, RECORDED IN THE ARTIFACT. An axis whose band would not parse
      // contributes NO open-block rows, exactly as the pre- gate's per-axis catch did — a band
      // parse defect is refused one stage earlier by validators.registerUnit. Naming the axes here
      // means the gap is visible on the form a reader opens instead of being a silent zero.
      bands_unreadable: [...(bandsUnreadable ?? [])],
    },
  };
}

// ── M6 — THE ABSENCE IS AN ARTIFACT, NOT A MISSING ONE ──────────────────────────────────────────
//
// A run whose plan apparatus is out of reach can carry no coverage ROWS: there is no frozen plan to
// derive them from. Before M6 that run was handed no form at all and the dispatch told the seat to
// write the `## Coverage ledger` table itself — one contract per runtime condition, and the model's
// prose became the source of truth every coverage gate read, which is the exact arrangement
// existed to end. It survived in the one branch could not reach.
//
// M6 writes the artifact either way. When there are no rows to compute, the form DECLARES that, names
// the cause from a closed vocabulary, and carries `rows: []` — which is a true statement about the run,
// where a model-authored table was a guess about it.
//
// THE CAUSE IS A CLOSED ENUM AND THAT IS THE WHOLE GATE. `verify.mjs` refuses a zero-row form as
// `coverage_form_empty` — "an empty form is an ABSENCE of coverage judgement, never a complete one" —
// and M6 does not soften that: it adds ONE exception, a form that says why it is empty in a word the
// vocabulary contains. Zero rows with no cause, or with a cause nobody declared, stays the driver bug
// it is today under its own token. An absence that cannot say what caused it is indistinguishable from
// a driver that forgot to write, which is the one thing this file may never let pass.
export const COVERAGE_ABSENCE_CAUSES = Object.freeze([
  "no_plan_execution_receipt",   // _driver/plan-execution.json absent or carrying no skeleton
  "no_frozen_plan",              // _driver/register-plan.json absent or carrying no entries
]);

export const isCoverageAbsenceCause = (c) => COVERAGE_ABSENCE_CAUSES.includes(String(c ?? "").trim());

const ABSENCE_PROVENANCE = "driver-written declaration (#850 M6). This run's coverage form carries NO "
  + "rows because the material they are computed from was not in reach — the cause is named in "
  + "`absence.cause`. You are not asked to fill anything in, and you must NOT write a `## Coverage "
  + "ledger` table into your findings: the driver renders this declaration into the report, so the "
  + "report says what is true about this run rather than what a model reconstructed about it.";

/**
 * The form for a run that can carry no rows. PURE.
 *
 * @param {{cause:string, detail?:string}} absence
 */
export function buildCoverageAbsenceForm({ cause, detail = "" } = {}) {
  return {
    _provenance: ABSENCE_PROVENANCE,
    absence: { cause: String(cause ?? "").trim(), detail: String(detail ?? "").trim() },
    rows: [],
  };
}

/**
 * The declared absence on a parsed form, or null. Returns the cause ONLY when the vocabulary contains
 * it: an off-enum cause reads as no declaration at all, so it falls to the fail-closed arm rather than
 * excusing the run on a word nobody defined.
 *
 * @returns {{cause:string, detail:string}|null}
 */
export function coverageFormAbsence(parsed) {
  const a = parsed?.absence;
  if (!a || typeof a !== "object") return null;
  const cause = String(a.cause ?? "").trim();
  if (!isCoverageAbsenceCause(cause)) return null;
  return { cause, detail: String(a.detail ?? "").trim() };
}

/**
 * A declared absence, as a MATERIAL GAP for the status-honesty surface.
 *
 * ASK WHAT THE ZERO MEANS — and this is the place it nearly went wrong. A declared absence carries no
 * rows, `deriveCoverageStatus([])` returns `{complete: true}`, and every downstream reader of the
 * ledger would have seen a run with no material coverage gaps: an absence reading as a pass, in the
 * artifact built to stop absences reading as passes. The declaration says the right thing to the
 * lawyer and would have said nothing at all to the machine.
 *
 * Shaped like `frameResidualGaps` and the unsearched-jurisdiction rows beside it — a free-text `unit`
 * and a non-register status — because it is the same kind of fact: something the run could not account
 * for, disclosed rather than withheld, and never a clamp on the verdict.
 *
 * @returns {Array<{unit:string, status:string, reason:string}>} one row, or none when rows exist
 */
export function coverageAbsenceGaps(parsed) {
  const a = coverageFormAbsence(parsed);
  if (!a) return [];
  return [{
    unit: "coverage ledger unavailable",
    status: "frame-gap",
    reason: `no coverage ledger could be computed for this run (${a.cause}) — no clean, limited or `
      + `deferred claim is made over any slice, and none should be inferred`,
  }];
}

/**
 * The sentence a lawyer reads where the ledger would be. NEVER an empty section: 's lesson one lane
 * over — a heading with nothing under it asserts an absence it cannot explain, and a reader cannot tell
 * it from a run that swept nothing. This says which material was missing and, therefore, exactly what
 * the rest of the report does and does not rest on.
 */
export function renderCoverageAbsenceSection({ cause, detail } = {}) {
  const why = {
    no_plan_execution_receipt: "no plan-execution receipt was written for this run, so there is no record of which slices were dispatched",
    no_frozen_plan: "no frozen register plan was written for this run, so there is no set of slices to account for",
  }[cause] ?? `an undeclared cause (${cause || "none stated"})`;
  return "## Coverage ledger\n\n"
    + `**No coverage ledger is available for this run.** The driver computes this table from the frozen `
    + `register plan and the plan-execution receipt; ${why}. No coverage claim — clean, limited or `
    + `deferred — is made anywhere in this report, and none should be read into its silence.`
    + (detail ? `\n\n${detail}` : "");
}

/**
 * The empty form for a run — every row present, both seat fields null. Written before the digest
 * dispatches and regenerated whenever it is needed again. PURE.
 */
export function buildCoverageForm(input) {
  const { rows, derived_from } = coverageFormRows(input);
  // `seat_row_contract` rides on BOTH builders — here and in unionCoverageForm — or it would appear on
  // the pre-dispatch form and vanish from every pass after it, i.e. be absent from exactly the file a
  // corrective attempt opens. parseCoverageForm reads `rows` and ignores every other top-level key, so
  // it round-trips through the seat's copy untouched.
  return { _provenance: PROVENANCE, seat_row_contract: SEAT_ROW_CONTRACT, generated_from: derived_from, rows };
}

/**
 * Parse a coverage form. Never throws. Returns {rows, error} — `error` is a short reason when the bytes
 * were present but unusable, so a malformed file reads as a NAMED defect rather than as an absent one
 * (an absence is a finding; a silently-empty parse is not).
 *
 * PARSED LENIENTLY, JUDGED STRICTLY, exactly like parseDispositionForm: a rejected parse costs a whole
 * paid dispatch, so the array is taken from `rows` or from a bare top level and per-row fields are read in
 * either case convention. Nothing about that widens what BINDS — every driver field below is re-stamped
 * by the union before the gate ever sees it. PURE.
 */
export function parseCoverageForm(raw) {
  if (raw == null) return { rows: null, error: null, parsed: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return { rows: null, error: `unparseable json (${String(e.message).slice(0, 60)})`, parsed: null }; }
  const arr = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(arr)) return { rows: null, error: "no rows[] array at the top level or under `rows`", parsed };
  const rows = [];
  for (const d of arr) {
    if (!d || typeof d !== "object") continue;
    const kind = String(d.kind ?? "").trim() || "axis";
    rows.push({
      row_id: String(d.row_id ?? d.rowId ?? "").trim(),
      axis: String(d.axis ?? "").trim().toLowerCase(),
      // Anything that is not one of the three DRIVER kinds is a seat row, whatever it called itself.
      // A seat cannot promote its own row to a driver kind either: the union regenerates every driver
      // row from the plan and drops a seat row whose key collides with one.
      kind: DRIVER_KINDS.has(kind) ? kind : "seat",
      unit: String(d.unit ?? "").trim(),
      qid: String(d.qid ?? "").trim() || null,
      open: d.open === true,
      // normalize-then-validate at the parse boundary: case and padding on a closed-enum cell are
      // cosmetic and are repaired here, once. What the gate BINDS on is unchanged — rowIsSettled reads
      // the same closed set, and an off-enum value still fails it.
      status: String(d.status ?? "").trim().toLowerCase(),
      reason: String(d.reason ?? "").trim(),
      ...(Number.isInteger(d.total_hits) ? { total_hits: d.total_hits } : {}),
      ...(Array.isArray(d.unaccounted_classes) ? { unaccounted_classes: d.unaccounted_classes.map(String) } : {}),
      ...(Array.isArray(d.unaccounted_terms) ? { unaccounted_terms: d.unaccounted_terms.map(String) } : {}),
      ...(typeof d.receipt_reason === "string" ? { receipt_reason: d.receipt_reason } : {}),
      // CARRIED, because verify.mjs judges the bytes on disk WITHOUT unioning first, and this string is
      // what makes the failure detail say which kind of `open` a row is — a never-searched slice or a
      // crowd block that ran and saturated. Dropping it here would leave the repair instruction generic
      // on the one path where it is actually read.
      ...(typeof d.open_because === "string" && d.open_because.trim() ? { open_because: d.open_because.trim() } : {}),
      // / — THE PARK SURVIVES THE ROUND TRIP, and it does so because this projection names it.
      // This parser builds each row from an explicit field list, so a field the union writes and this
      // does not read is DROPPED on the next pass — silently, with the union and the tool both looking
      // correct. The park evaporated exactly that way before this line existed: written on call 30, gone
      // by call 31, and the row read as merely unsettled again.
      ...(d.parked === true ? { parked: true } : {}),
      ...(Number.isInteger(d.parked_refusals) ? { parked_refusals: d.parked_refusals } : {}),
      ...(typeof d.parked_reason === "string" && d.parked_reason.trim() ? { parked_reason: d.parked_reason.trim() } : {}),
    });
  }
  return { rows, error: null, parsed };
}

/**
 * Is ONE form row SETTLED? The single definition of a discharged coverage obligation, used by the gate
 * below AND by coverage-union.mjs — the union may only carry forward what this function would accept, or
 * the two disagree about what work is done and the outstanding count stops meaning anything.
 *
 * `row` is the seat's row (its fields may be anything); `canonical` is the DRIVER's regenerated row for
 * the same obligation, and every driver fact — the axis, the qid, `open` — is read from the canonical
 * side. A seat that clears its own `open` flag cannot widen what binds. PURE; never throws.
 */
export function rowIsSettled(row, canonical) {
  if (!row || !canonical) return false;
  const { status, reason } = seatFields(row);
  if (!STATUS_SET.has(status)) return false;
  if (!reason) return false;
  // THE AXIS IS PART OF THE JUDGMENT, and on a SEAT row it is the one identifier the seat still supplies.
  // normalizeAxis repairs cosmetic noise and deliberately leaves a genuinely-unknown token unchanged
  // (its anti-fail-open rule: repair formatting, never invent an axis), so an off-vocabulary axis has to
  // be refused HERE. Without this it would sail through the gate and die downstream in
  // parseCoverageLedgerJson, which drops the machine ledger for the whole run and can no longer be
  // repaired by anything the seat is asked to do — the job `coverage_axis_invalid` used to have.
  if (!REGISTER_AXES.includes(String(canonical.axis ?? "").trim().toLowerCase())) return false;
  // A slice the machine knows was never searched, or a crowd block it computed as unaccounted, cannot be
  // claimed clean. This is the exact analogue of BOTH deleted joins — undisclosedDeferredQids' verbatim
  // qid and blockIsDisclosed' qid-or-hit-count — because the driver's own row for that obligation IS the
  // naming, so requiring THAT row to be non-clean asks for precisely what "named by a non-clean row on
  // its own axis" asked for. Per row, never per axis: a sibling row's status discharges nothing.
  if (canonical.open === true && status === "confirmed-clean") return false;
  return true;
}

/** The settled rows of a form, in the shape every coverage consumer reads: {axis, status, unit, reason}. */
export function formLedgerRows(rows) {
  return (rows ?? [])
    .filter((r) => r && STATUS_SET.has(String(r.status ?? "").trim().toLowerCase()))
    .map((r) => ({
      axis: String(r.axis ?? "").trim().toLowerCase(),
      status: String(r.status).trim().toLowerCase(),
      unit: String(r.unit ?? r.axis ?? "").trim(),
      reason: String(r.reason ?? "").trim(),
    }));
}

// ── THE GATE ────────────────────────────────────────────────────────────────────────────────────────
//
// TWO REASONS, CLOSED, EXPORTED. THREE judgment tokens collapse into them —
// `coverage_clean_unverified_incomplete`, `coverage_deferred_unaccounted` and `coverage_clean_deferred`,
// the three that carried a disclosure join over text the model typed. What is NOT touched, and still
// fires: the six-token `coverage_*` STRUCTURE family on the derived JSON (ledger_unparseable /
// ledger_empty / axis_invalid / axis_missing / key_unknown / status_*, plus classes_invalid), and the
// three never-searched tokens (`coverage_clean_unexecuted` / `_skipped` / `_tainted`), which mean the
// slice was never searched rather than never disclosed. `coverage_form_missing` is the driver's own
// failure and lives in verify.mjs, not here — this gate never reaches a form that is not there.
// Exported because
//: an external probe filtered on a string literal that had stopped existing and printed
// "0 undisposed" over evidence carrying thirteen — a vocabulary nobody can enumerate is one every
// external reader gets wrong in silence. coverage-form.test.mjs ("the reason vocabulary is CLOSED and
// matches what the gate can emit") breaks CI if this list drifts from what findCoverageFormViolations
// can actually put in `reason`.
export const COVERAGE_REASONS = Object.freeze([
  "no_status",         // a row carries no status this gate accepts
  "form_damaged",      // the form does not parse
  // — the row's REASON carries an engine identifier. A separate reason and not a `no_status`
  // cause, deliberately: the row's status is fine and the seat has complied with everything
  // `no_status` asks. Folding it in would produce the unactionable hint this file's own 2026-08-05
  // block records the cost of — `set a status on every row` to a seat that already has.
  "engine_vocabulary",
]);

// The tokens a seat may not put in a reason a client reads. CLOSED, and every member is a HYPHENATED
// COMPOUND — that is the whole selection rule, not an accident of which ones leaked.
//
// is why: `axis` -> `group` as a render-time substitution turned "AXIS Bank filed in class 36"
// into "group Bank filed in class 36" on a report that was clearing AXIS. The ban list and the
// trademark register overlap. A hyphenated compound cannot be a single-word mark, so refusing one is
// safe in a way that refusing `slice` or `axis` never is — and a REFUSAL that cannot tell a mark from
// engine vocabulary would block a clearance on the mark SLICE, which is the same defect one level in.
//
// WHAT IS DELIBERATELY NOT HERE: the bare nouns `slice` / `axis`. They are taught in the dictation
// below and not mechanically enforced, and that gap is stated rather than papered over —.
export const SEAT_BANNED_TOKENS = Object.freeze([...REGISTER_AXES, "crowd-context"]);
const SEAT_BANNED_RE = new RegExp(`\\b(?:${SEAT_BANNED_TOKENS.map((t) => t.replace(/[-]/g, "[- ]")).join("|")})\\b`, "i");

/** The banned engine identifiers a reason carries, in the order they appear. PURE. */
export function seatBannedTokens(reason) {
  const t = String(reason ?? "");
  const hits = [];
  for (const tok of SEAT_BANNED_TOKENS) {
    const re = new RegExp(`\\b${tok.replace(/[-]/g, "[- ]")}\\b`, "i");
    if (re.test(t) && !hits.includes(tok)) hits.push(tok);
  }
  return hits;
}

/**
 * WHY a `no_status` row was refused. `reason` is what the TOKEN is named after and stays a closed pair
 * above; `cause` discriminates the three defects that share it, and it is why this exists at all.
 *
 * The 2026-08-05 block in verify.mjs records the cost of the alternative: a token that named the axis
 * and nothing else, four identical repair attempts, "THE TOKEN NAMED THE AXIS AND NOTHING ELSE, AND THE
 * AXIS IS NOT THE DEFECT". One reason string over three defects has the same failure mode one level in:
 * the hint opens with "row(s) with no status this gate accepts" and orders the seat to set a status on
 * every row — unactionable when every row already carries one and what is wrong is that a status the
 * enum accepts was put on a row the machine marked `open`. The seat then burns a warm attempt complying
 * with an instruction it has already complied with.
 *
 * These ride the fail token as a MULTI-TERM CAUSE CENSUS (`no_status=2,open_clean=1;…`), which
 * repairs.mjs CENSUS_RE already parses and sums — it accepts comma-joined `<name>=<n>` terms. The terms
 * PARTITION the violations, so the sum is still the exact outstanding count and `progressQuantity`
 * cannot read a converging run as stuck.
 */
export const COVERAGE_CAUSES = Object.freeze([
  "no_status",     // no status at all, or one outside the closed enum
  "open_clean",    // an enum-valid `confirmed-clean` on a row the DRIVER marked `open`
  "axis_invalid",  // the row's axis is outside the register-axis vocabulary
]);

/**
 * Which coverage obligations the seat has not settled. TWO CLAUSES, BOTH PER ROW — and the reason there
 * is no third is the whole correction this file carries.
 *
 *   (1) EVERY ROW CARRIES A STATUS the enum accepts and a non-empty reason (rowIsSettled). The form's
 *       own contract; it has NO prose analogue, since no archived run carries a form, so it cannot make
 *       an existing verdict move. It is the `connotation_no_ruling` of this lane.
 *   (2) AN `open` ROW MAY NOT BE CONFIRMED-CLEAN (also rowIsSettled), and `open` now covers BOTH kinds
 *       of undischarged obligation:
 *         · a `deferred` row — the exact analogue of undisclosedDeferredQids, which demanded every
 *           deferred qid appear VERBATIM in a non-clean row on its own axis. The driver writes one row
 *           per deferred qid, so "the row naming that qid is non-clean" is the same requirement with
 *           the typing removed.
 *         · a `block` row — the exact analogue of blockIsDisclosed, which demanded THAT BLOCK'S own
 *           qid or hit count inside the axis's non-clean disclosure text. The driver writes one row per
 *           open crowd block carrying both, so "the row naming that block is non-clean" is, again, the
 *           same requirement with the typing removed.
 *         · the AXIS row of a skeleton contradiction (state `deferred`, no deferred qids), which the
 *           pre-join code fired on with `missing: []` and which must keep firing.
 *       NON-CIRCULAR by construction: a row never discharges itself, and no row discharges another.
 *
 * THE THIRD CLAUSE WAS DELETED, AND NOT BECAUSE IT WAS UNREACHABLE. It read: an axis with open blocks
 * and a clean claim and no non-clean row anywhere on it owes disclosure. Trace it against clause 2 and
 * it fires only when `blocks ≥ 1 ∧ clean ≥ 1 ∧ nonClean === 0` — which, with block rows `open`, means
 * every block row on that axis is either settled-non-clean (so nonClean ≥ 1, and it does not fire) or
 * unsettled (so clause 1 ALREADY fired on it, by row id). It is reachable, and all it can do is add a
 * SECOND violation for a defect already named: inflating the census, inflating `quantity`, and emitting
 * an entry with no row id that degenerates in the fail token to `<axis> [<axis>]` — the axis named
 * twice and the defect named not at all.
 *
 * It was also the clause that made this gate wrong. Scoped to the axis, it discharged every open block
 * on an axis the moment ANY non-clean row existed there — including a row about an unrelated slice. See
 * the block above coverageFormRows: that is the FROSTBERRY hole, and the join it replaced never did it.
 *
 * @param {Array|null} rows        the form's rows (already unioned + re-stamped by the driver)
 * @param {string|null} formError  a named parse defect, or null
 * @returns {Array<{reason:"no_status"|"form_damaged", cause?:string, row?:string, axis?:string,
 *                  unit?:string, detail?:string}>}
 * PURE; never throws.
 */
export function findCoverageFormViolations(rows, formError = null) {
  const out = [];
  // Present-and-unparseable is a NAMED defect, never an absence. Reported once, for the file — not once
  // per row it could not carry, and never mixed with counts drawn from rows nobody can read.
  if (formError) return [{ reason: "form_damaged", detail: String(formError).slice(0, 120) }];
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    // — checked on SETTLED rows too, and that is the point: an unsettled row is refused by
    // `no_status` anyway, while a row the seat considers finished is exactly the one whose reason
    // reaches the page. Reported per row so the seat repairs the sentence it wrote, not "the form".
    const banned = seatBannedTokens(seatFields(r).reason ?? r?.reason);
    if (banned.length) out.push({
      reason: "engine_vocabulary",
      row: String(r?.row_id ?? ""), axis: String(r?.axis ?? ""), unit: String(r?.unit ?? ""),
      tokens: banned,
      detail: `reason names ${banned.join(", ")} — the reader's page prints this sentence; the coverage unit already carries the identifier`,
    });
    if (rowIsSettled(r, r)) continue;
    const { status } = seatFields(r);
    const axisOk = REGISTER_AXES.includes(String(r?.axis ?? "").trim().toLowerCase());
    const openClean = axisOk && r?.open === true && STATUS_SET.has(status);
    out.push({
      reason: "no_status",
      cause: !axisOk ? "axis_invalid" : openClean ? "open_clean" : "no_status",
      row: String(r?.row_id ?? ""), axis: String(r?.axis ?? ""), unit: String(r?.unit ?? ""),
      // The DRIVER's own sentence for why this row is open, never a generic one: `open` covers a slice
      // that was never searched AND a crowd block that ran and came back unaccounted, and the seat's
      // repair differs between them.
      detail: !axisOk
        ? `axis "${String(r?.axis ?? "")}" is not one of ${REGISTER_AXES.join(" / ")}`
        : openClean
          ? `status "${status}" — ${String(r?.open_because ?? "this row cannot be confirmed-clean").slice(0, 200)}`
          : (status ? `status "${status}" is not one of ${COVERAGE_STATUSES.join(" / ")}` : "no status"),
    });
  }
  return out;
}

// ── THE DRIVER RENDERS THE TABLE ────────────────────────────────────────────────────────────────────
//
// `## Coverage ledger` stops being an INPUT. It was model-authored prose that the driver parsed back into
// rows and then judged; it is now rendered FROM the form, so the document a lawyer reads is unchanged in
// kind and nothing in it is a string the model had to copy. parseCoverageLedgerFull survives, but only as
// the ARCHIVED-RUN reader (loadCoverageLedger's prose fallback): no gate parses this table any more.

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The `## Coverage ledger` section, rendered from the form's rows. "" when nothing is settled. PURE. */
export function renderCoverageLedgerSection(rows) {
  const usable = (rows ?? []).filter((r) => r && STATUS_SET.has(String(r.status ?? "").trim().toLowerCase()));
  if (!usable.length) return "";
  return [
    "## Coverage ledger",
    "",
    "Driver-rendered from the coverage form. The coverage unit, the query id and the hit count of every",
    "open crowd block, and every deferred slice with its receipt reason, are computed by the driver from",
    "the frozen register plan and the plan-execution receipt; the status and the reason are the digest's.",
    "",
    "| Coverage unit | Status | Reason | Query id |",
    "|---|---|---|---|",
    ...usable.map((r) => {
      const detail = [
        Number.isInteger(r.total_hits) ? `${r.total_hits} hits` : "",
        r.unaccounted_classes?.length ? `classes unaccounted: ${r.unaccounted_classes.join(", ")}` : "",
        r.unaccounted_terms?.length ? `terms unaccounted: ${r.unaccounted_terms.join(", ")}` : "",
        r.receipt_reason ? `receipt: ${r.receipt_reason}` : "",
      ].filter(Boolean).join("; ");
      const reason = [cell(r.reason), detail ? `(${cell(detail)})` : ""].filter(Boolean).join(" ");
      return `| ${cell(r.unit)} | ${cell(String(r.status).trim().toLowerCase())} | ${reason} | ${cell(r.qid ?? "—")} |`;
    }),
  ].join("\n");
}

const LEDGER_HEADING_RE = /^#{2,4}\s+[^\n]*coverage ledger[^\n]*$/im;

/**
 * Put the rendered section into the findings document, replacing any section already there.
 * IDEMPOTENT — runDigest re-renders on every pass, so a second render must produce the same document
 * rather than a second table. Inserted before the Audit trail heading when one exists, so the document's
 * section order is the one digest.md describes; appended otherwise. PURE.
 */
export function spliceCoverageLedger(md, section) {
  const doc = String(md ?? "");
  if (!section) return doc;
  const lines = doc.split("\n");
  const start = lines.findIndex((ln) => LEDGER_HEADING_RE.test(ln));
  if (start >= 0) {
    // ── — THE NEXT HEADING OF ANY LEVEL ENDS THIS SECTION, NOT THE NEXT SHALLOWER ONE ──────────
    //
    // The old scan stopped at a heading of level ≤ the ledger's own, so a DEEPER heading after it was not
    // a boundary and everything from the ledger to the end of the document was replaced. That is not
    // hypothetical: this function's own fallback inserts the section immediately before `### Audit trail`,
    // and runDigest re-renders on every pass — so the SECOND render of any findings document with that
    // shape deleted the audit trail and its rows. Reproduced directly:
    //
    //   render 1   ## Coverage ledger … + ### Audit trail (rows)
    //   render 2   ## Coverage ledger … and NOTHING after it
    //
    // Safe because neither renderer emits a sub-heading: renderCoverageLedgerSection is a paragraph and a
    // table, renderCoverageAbsenceSection is a paragraph. Nothing deeper belongs to this section, so
    // nothing deeper should be swallowed by it. Found from the sibling splice in document-coverage.mjs
    //, which copied this shape and was caught by its own re-render arm.
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#+\s/.test(lines[i])) { end = i; break; }
    }
    return [...lines.slice(0, start), ...section.split("\n"), "", ...lines.slice(end)].join("\n");
  }
  const audit = lines.findIndex((ln) => /^#{2,4}\s+[^\n]*audit trail/i.test(ln));
  if (audit >= 0) return [...lines.slice(0, audit), ...section.split("\n"), "", ...lines.slice(audit)].join("\n");
  return `${doc.replace(/\s*$/, "")}\n\n${section}\n`;
}

/**
 * The machine coverage ledger, derived FROM THE FORM rather than from the prose. This INVERTS the
 * direction Map #3 established: the JSON used to be code-derived from the model's table, which made a
 * model-authored document the source of truth for every coverage gate downstream. The form is the source
 * now and both the table and this JSON are renders of it, so they agree by construction and neither can
 * be the thing that drifts.
 *
 * @param {Array} rows the form's rows
 * @param {(text:string)=>string[]} classTokens the Nice-class extractor (injected so this stays pure)
 * @returns {string} a JSON ARRAY string that round-trips through parseCoverageLedgerJson
 */
export function renderCoverageLedgerJsonFromForm(rows, classTokens) {
  const usable = (rows ?? []).filter((r) => r && STATUS_SET.has(String(r.status ?? "").trim().toLowerCase()));
  return JSON.stringify(usable.map((r) => {
    const unit = String(r.unit ?? r.axis ?? "");
    const i = unit.indexOf("/");
    const scope = i >= 0 ? unit.slice(i + 1).trim() : "";
    const reason = String(r.reason ?? "");
    const classes = classTokens ? classTokens(`${scope} ${reason}`) : [];
    return {
      axis: String(r.axis ?? "").trim().toLowerCase(),
      scope, status: String(r.status).trim().toLowerCase(), reason,
      ...(classes.length ? { classes } : {}),
    };
  }));
}

// ── WHAT THE SEAT IS TOLD ───────────────────────────────────────────────────────────────────────────
//
// This replaced gateway.deferredSlicesRequiredRows (: nothing is retyped — the obligations ride as
// driver rows), and the typed-transport conversion then replaced the OPEN-IT instruction: the seat no
// longer touches any coverage file. The rows are ENUMERATED HERE, complete, because the dispatch is now
// the seat's only sight of them (the seat-facing form copy is dead — writeCoverageForm's doc block), and
// the recording route is the `record_coverage` tool, whose every answer re-lists what is outstanding.
// B's shape exactly: obligations told in-turn, values sent back, the driver holding the pen.

/** One obligation row, rendered for the dispatch. The row_id leads because it is what the seat sends back. */
function briefRow(r) {
  const facts = [
    Number.isInteger(r.total_hits) ? `${r.total_hits} hits` : "",
    r.unaccounted_classes?.length ? `classes unaccounted: ${r.unaccounted_classes.join(", ")}` : "",
    r.unaccounted_terms?.length ? `terms unaccounted: ${r.unaccounted_terms.join(", ")}` : "",
    r.receipt_reason ? `receipt: ${String(r.receipt_reason).slice(0, 160)}` : "",
  ].filter(Boolean).join("; ");
  const settled = String(r.status ?? "").trim() ? ` [settled: ${String(r.status).trim()}]` : "";
  return `  ${r.row_id}  (${r.kind}) ${r.unit}${facts ? ` — ${facts}` : ""}${r.open === true ? " — OPEN: never confirmed-clean" : ""}${settled}`;
}

/**
 * The dispatch block carrying the obligations and the recording route. "" when the run has no rows.
 * PURE.
 *
 * THE TWO OPEN SETS ARE DISJOINT HERE, DELIBERATELY. `open` is true on block rows AND on deferred rows,
 * and the two need OPPOSITE instructions: a deferred slice never ran and nothing can make it run
 * (`deferred`), while a crowd block ran and saturated (`coverage-limited`). Describing them together
 * would give one count for two facts and steer half the rows to the wrong status — and the status is
 * not cosmetic: decideRegisterGap clamps the verdict CLEAR→CONDITIONAL on `deferred` rows and leaves
 * `coverage-limited` alone, so mislabelling a saturated crowd downgrades the whole run's verdict.
 */
export function coverageFormBrief(form) {
  const rows = form?.rows ?? [];
  if (!rows.length) return "";
  const blocks = rows.filter((r) => r.kind === "block");
  const open = rows.filter((r) => r.open === true && r.kind !== "block");
  return [
    "YOUR COVERAGE LEDGER IS A SET OF OBLIGATIONS THE DRIVER HAS ALREADY COMPUTED, LISTED BELOW —",
    "and you record your judgment on them ONLY by calling the `record_coverage` tool. Never write or",
    "edit any coverage file and never hand-write a `## Coverage ledger` table: the driver validates each",
    "row as it arrives, holds the record itself, and renders the table and the coverage JSON from it —",
    "nothing you write into any file is read.",
    "",
    `There are ${rows.length} row(s) — one per axis, one per unaccounted crowd block, one per deferred slice —`,
    "and every identifier is computed: the coverage unit, the query id, the hit count, the unaccounted",
    "classes and terms, and each deferred slice's own receipt reason. This is the complete list: nothing is",
    "abbreviated, truncated or elided, and there is nothing owed that is not a row below.",
    "",
    "For EVERY row, call `record_coverage` with `row_id` (as listed), `status` — exactly one bare token of",
    "confirmed-clean / coverage-limited / deferred — and `reason`, the sentence the lawyer reads: a",
    "lawyer's words, never the engine's (a reason naming primary-sweep, saturation-probe,",
    "transliteration-numeric, incumbent-class or crowd-context is REFUSED, because the coverage unit",
    "already carries the identifier and your sentence is printed on the client's report). A call carries a",
    "batch; refused rows name what to change and the rest of the call is KEPT; statuses accumulate across",
    "attempts, so a row settled once stays settled. The answer lists every obligation still outstanding.",
    "",
    "THE ROWS:",
    ...rows.map(briefRow),
    "",
    // The seat-row shape, on the surface the seat reads at DISPATCH. Stating it only in the skill would
    // leave the one closed-vocabulary value the seat must supply named on a page it may not re-read.
    "YOU MAY ADD ROWS OF YOUR OWN for coverage units the plan does not contain — the per-jurisdiction",
    "reconciliation, a cross-class merch check, a counted dominant-element crowd. Send",
    'each through the same tool as `{"kind":"seat", "axis", "unit", "status", "reason"}` — no row_id; the',
    'driver mints it. `unit` reads "<axis> / <what you swept>", and `axis` is EXACTLY one bare token of:',
    `${REGISTER_AXES.join(" / ")}.`,
    "That vocabulary is CLOSED — a row whose axis is outside it is refused. A per-jurisdiction",
    "reconciliation or a cross-class / cross-check / merch sweep is `primary-sweep`; an owner, incumbent,",
    "watchlist-owner or stealth-filer sweep is `incumbent-class`; a counted dominant-element or",
    "meaning-token crowd is `saturation-probe`; a transliteration or numeric-form slice is",
    "`transliteration-numeric`. To withdraw a row you added, send `{\"retract\":\"<its row_id>\"}` —",
    "silence never removes anything.",
    ...(open.length ? [
      "",
      `${open.length} row(s) are NEVER-SEARCHED slices. The active register provider cannot express them at all,`,
      "so nothing can make them run. They cannot be confirmed-clean: mark each `deferred`, carry the",
      "SUBSTANCE of its receipt reason IN THE READER'S WORDS — never the receipt's own identifiers, which",
      "name axes and query ids the reader does not have and which the gate refuses — and treat the gap as",
      "an OPEN, disclosed question for the lawyer, never a clean negative.",
    ] : []),
    ...(blocks.length ? [
      "",
      `${blocks.length} row(s) are UNACCOUNTED CROWD BLOCKS: the band left part of that slice neither verified-zero`,
      "nor individually enumerated nor itself a ruled crowd. That search RAN and saturated, so the honest status",
      "is `coverage-limited` — NOT `deferred`, which means a slice that could not run at all and which clamps the",
      "run's verdict to CONDITIONAL. Say in the reason what stayed open.",
      "",
      "EACH OF THESE ROWS IS DISCHARGED ONLY BY ITSELF. A coverage-limited row about one slice does NOT account",
      "for a different slice's block, however plainly it discusses the axis — so set the status on the block's",
      "OWN row. Rows about slices that genuinely enumerated to has_more:false STAY confirmed-clean: do not",
      "downgrade those, that trades one false claim for another.",
    ] : []),
    "",
    "The driver renders the `## Coverage ledger` table into your findings file from what the tool records,",
    "so do not hand-write that table. Your findings, negative-results matrix and audit trail are unchanged",
    "and yours.",
  ].join("\n");
}
