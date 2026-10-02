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
// THE CURE IS THE ONE APPLIED ONE GATE OVER: the driver writes the row and the model fills in the judgment. The
// axis, the coverage unit, the open crowd blocks with their qids and hit counts, and the deferred slices
// with their per-qid receipt reasons are all facts the driver holds BEFORE the stage dispatches. It
// writes them. The seat sets `status` and `reason`, and nothing else in the file is the seat's to write.
// Nothing is transcribed, so a mistyped identifier is no longer a reachable failure.
//
// PURE — no node imports, so it tests offline, exactly like coverage-ledger.mjs and connotation-search.mjs
// (whose headers state the same rule for the same reason). `shortId` is IMPORTED from connotation-search
// rather than re-implemented: it is a generic fnv1a64 id stamp, and a second copy of an id function is
// two calculations kept in step, which is the defect.
//
// ONE CALCULATION, NOT TWO. `openBlocksByAxis` (register-plan.mjs) computes the open crowd blocks — the
// same C2..C7 conditions the deleted gate computed, unchanged — and it is called EXACTLY ONCE per pass,
// by buildCoverageForm. The gate below judges the rows in the form, never a second derivation of them.

import { REGISTER_AXES, COVERAGE_STATUSES, normalizeAxis, CROWD_RULING_TOKEN,
  CROWD_RULING_UNIT_GRAMMAR } from "./coverage-ledger.mjs";
import { shortId } from "./connotation-search.mjs";
import { openBlocksByAxis } from "./register-plan.mjs";
import { territoryLayerReport, unsearchedLayerReason } from "./binding-layers.mjs"; import { goodsTermsList } from "../providers/_shared/term-shape.mjs";

const STATUS_SET = new Set(COVERAGE_STATUSES);

/**
 * An axis the plan put no question to (owner, 2026-10-01): not asked, never clean. A state of the FORM only,
 * the run's own record. It is deliberately outside COVERAGE_STATUSES, so every render of the ledger — the
 * machine ledger, the table synthesis and the sceptic are shown, the workbook's coverage rows — leaves it
 * out: nothing was owed on the axis, and nothing about it reaches a reader or a model.
 */
export const NOT_ASKED = "not-asked";
const DRIVER_KINDS = new Set(["axis", "block", "deferred", "family"]);

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
// So the axis was the seat's, and every surface the seat read carried the four tokens VERBATIM. Those
// surfaces — the contract written into the form, the dispatch brief and the correction hints — left with
// the register digest, the one seat that added rows; an archived seat row is still read as it was written.
//
// BELT AND BRACES, FREE: the dictated `unit` label is `<axis> / <what you swept>`, the same shape
// `unitLabel` composes for driver rows, so `normalizeAxis(r.axis, r.unit)` in `seatRows` recovers the
// axis from the label when a re-emit drops the `axis` cell. That is repair of a lost field, never
// invention of a missing one — normalizeAxis leaves a genuinely unknown token unchanged, and
// rowIsSettled still refuses it.

const PROVENANCE = "driver-written form. Every field is computed by the driver from the frozen register "
  + "plan, the plan-execution receipt and the per-axis band files, and is REGENERATED on every pass; code "
  + "settles each row's status and reason from the run's own facts (settleCoverageRowsFromFacts). A row "
  + "marked `open` carries a slice the machine knows was never searched or never accounted for: it cannot "
  + "be confirmed-clean, and its own `open_because` says which of the two it is. EACH OPEN ROW IS "
  + "DISCHARGED ONLY BY ITSELF: a status on one row never accounts for another row's slice. A `reason` IS "
  + "PRINTED ON THE CLIENT'S REPORT.";

/**
 * The name of the DRIVER'S copy of the form — since the typed-transport conversion, the ONLY live
 * copy. Two names still resolve (coverage-form-io.coverageFormPaths), and the asymmetry is now the
 * whole story:
 *
 *   · THE SEAT-FACING COPY IS DEAD. No seat records coverage any more: code settles every row from the
 *     run's facts. The name survives only so archived runs' seat copies stay addressable.
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
// seat invents and never one it has to reproduce. `<axis> / <predicate>: <term(s)> [cl <classes>] goods: <words>`, the
// same left-of-slash-is-the-axis shape every downstream coverage consumer keys on (coverage-ledger.mjs
// normalizeAxis, scope-facts, the taint join). Terms are bounded so an OR-stack of forty cannot make one
// table cell unreadable; the qid rides its own column, so nothing identifying is lost to the cut.
const MAX_TERMS_IN_LABEL = 4;
export function unitLabel(axis, entry) {
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
  return `${axis} / ${scope || String(entry.qid ?? "")}${cls}${goodsTermsList(entry).length ? ` goods: ${goodsTermsList(entry).join(" OR ")}` : ""}`;   // the goods words are part of the question (ruled for the client's table 2026-09-22): a goods slice shares predicate, term and classes with the identical one
}

// THE QUESTIONS READ IN A CROWD'S PLACE: every plan entry whose `narrows` names the crowd's qid, in the
// plan's order. The reading turn names the crowd a narrowing replaces, and nothing read that link, so the
// digest had no way to say what answered a crowd and what it left unread. PURE.
export function narrowingsOf(plan, qid) {
  if (typeof qid !== "string" || !qid) return [];
  return (plan?.entries ?? []).filter((e) => e && typeof e.narrows === "string" && e.narrows.trim() === qid);
}

// A question in plain words, for a sentence the digest seat reads and may carry into its reason: no axis
// and no qid, nothing the reason gate refuses as engine vocabulary. PURE.
const PLAIN_PREDICATE = { contains: "containing ", owner: "owned by " };
function plainQuestion(e) {
  const terms = Array.isArray(e?.terms) && e.terms.length
    ? e.terms : (typeof e?.term === "string" && e.term.trim() ? [e.term] : []);
  const shown = terms.slice(0, MAX_TERMS_IN_LABEL).map((t) => `"${String(t).trim()}"`);
  const more = terms.length > shown.length ? ` and ${terms.length - shown.length} more` : "";
  const cls = Array.isArray(e?.nice_classes) && e.nice_classes.length ? ` in class ${e.nice_classes.join(", ")}` : "";
  const goods = goodsTermsList(e);
  const regions = Array.isArray(e?.regions) && e.regions.length ? ` in ${e.regions.join(", ")}` : "";
  return `${PLAIN_PREDICATE[String(e?.predicate ?? "")] ?? ""}${shown.join(" or ")}${more}${cls}`
    + `${goods.length ? ` limited to goods: ${goods.join(" or ")}` : ""}${regions}`;
}

// WHY A CROWD BLOCK IS OPEN, in the driver's words and carrying the block's own facts: the count, the
// spellings and classes left unread, and the questions read in its place. It is the one text on the row
// that reaches the seat on every path (the form's parser and the recording tool both keep it), so the
// facts ride in it rather than in fields a projection would drop. What was counted and not read is set
// aside, never clean (ruled 2026-09-26). PURE.
export function blockOpenBecause(b, narrowings = []) {
  const counted = Number.isInteger(b?.total_hits) ? ` (${b.total_hits} counted)` : "";
  const legs = [
    b?.unaccounted?.length ? `spellings not read: ${b.unaccounted.join(", ")}` : "",
    b?.unaccounted_classes?.length ? `classes not read: ${b.unaccounted_classes.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  const instead = narrowings.length ? `; read in its place: ${narrowings.slice(0, 6).map(plainQuestion).join("; ")}` : "";
  return `the search RAN and counted more than it read${counted}${legs ? `, ${legs}` : ""}. What was not read is `
    + `set aside, never clean: say what was read instead and what was left, with the count${instead}. No row `
    + `about another slice discharges it`;
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
  orderedTerritories = [], capabilities = null, awaiting = [], withheld = {} } = {}) {
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

  // A COUNT THE PLAN ASKED FOR THAT CAME BACK WITH NO NUMBER. A planned count is sanctioned crowd context, so
  // it opens no block row, and an axis whose only open question was such a count read clean over a count
  // that never came back. Each one rides its axis row, so the axis cannot be settled clean on it.
  const countsNotTaken = (axis) => (plan?.entries ?? [])
    .filter((e) => e?.axis === axis && e?.expected_kind === "count")
    .filter((e) => {
      const b = (bandBlocksByAxis?.[axis] ?? []).find((x) => x && x.qid === e.qid);
      if (!b || b.error === true) return false;            // no block, or an error: the missing and deferred gates own it
      return b.total_hits === null || b.total_hits === undefined || !Number.isFinite(Number(b.total_hits));
    })
    .map((e) => e.qid);
  const rows = [];
  for (const axis of axes) {
    const s = skel.find((x) => String(x.axis ?? "").trim() === axis) ?? null;
    const state = String(s?.state ?? "").trim() || null;
    const notTaken = countsNotTaken(axis);
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
      ...(notTaken.length ? { counts_not_taken: notTaken } : {}),
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
        open_because: blockOpenBecause(b, narrowingsOf(plan, b.qid)),
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
    // ── A WAITING FAMILY THE READING TURN DID NOT ASK (withheld-families.mjs) ─────────────────────
    //
    // It was never searched, and the one honest judgment of it is the turn's: withheld, with the reason
    // it was not asked. The row arrives settled when the turn recorded that, and open when nobody did,
    // so an unjudged family is an obligation the digest's gate refuses to pass. `family` rows stay out of
    // the ledger the report is built from; the reason is the run's record and the audit workbook's.
    for (const f of (Array.isArray(awaiting) ? awaiting : [])) {
      const qid = String(f?.qid ?? "").trim();
      if (!qid || String(f?.axis ?? "").trim() !== axis) continue;
      const w = withheld?.[qid];
      rows.push({
        row_id: shortId("CF", `family:${qid}`),
        axis, kind: "family",
        unit: unitLabel(axis, entriesByQid.get(qid)),
        qid,
        open: true,
        open_because: "a waiting family the reading turn did not ask — it was never searched, and its only judgment is withheld-by-judgment with the reason it was not asked",
        status: w?.reason ? "withheld-by-judgment" : null, reason: w?.reason ? String(w.reason) : null,
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
      // contributes NO open-block rows, exactly as the pre-change gate's per-axis catch did — a band
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
 * The sentence a lawyer reads where the ledger would be. NEVER an empty section: the lesson one lane
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
 * The empty form for a run — every row present, both settled fields null. Written before the step that
 * settles it, and regenerated whenever it is needed again. PURE.
 */
export function buildCoverageForm(input) {
  const { rows, derived_from } = coverageFormRows(input);
  return { _provenance: PROVENANCE, generated_from: derived_from, rows };
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
  if (canonical.open === true && status === "confirmed-clean") return false; if (canonical.kind === "family" && status !== "withheld-by-judgment") return false;   // a waiting family never ran: withheld is its only judgment
  return true;
}

/** The settled rows of a form, in the shape every coverage consumer reads: {axis, status, unit, reason}. */
export function formLedgerRows(rows) {
  return (rows ?? [])
    .filter((r) => r && r.kind !== "family" && STATUS_SET.has(String(r.status ?? "").trim().toLowerCase()))
    .map((r) => ({
      axis: String(r.axis ?? "").trim().toLowerCase(),
      status: String(r.status).trim().toLowerCase(),
      unit: String(r.unit ?? r.axis ?? "").trim(),
      reason: String(r.reason ?? "").trim(),
    }));
}

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

// ── THE DRIVER RENDERS THE TABLE ────────────────────────────────────────────────────────────────────
//
// `## Coverage ledger` stops being an INPUT. It was model-authored prose that the driver parsed back into
// rows and then judged; it is now rendered FROM the form, so the document a lawyer reads is unchanged in
// kind and nothing in it is a string the model had to copy. parseCoverageLedgerFull survives, but only as
// the ARCHIVED-RUN reader (loadCoverageLedger's prose fallback): no gate parses this table any more.

const cell = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The `## Coverage ledger` section, rendered from the form's rows. "" when nothing is settled. PURE. */
export function renderCoverageLedgerSection(rows) {
  const usable = (rows ?? []).filter((r) => r && r.kind !== "family" && STATUS_SET.has(String(r.status ?? "").trim().toLowerCase()));
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
      const detail = coverageRowFacts(r);
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
  const usable = (rows ?? []).filter((r) => r && r.kind !== "family" && STATUS_SET.has(String(r.status ?? "").trim().toLowerCase()));
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
      // THE COUNT AND THE PLAN KEY THE SOURCE ROW ALREADY HOLDS (ruling 551). The table two functions up
      // prints `total_hits` as "N hits" and this render dropped it, so the two renders of one form
      // disagreed about whether the run knew the size of what it left. A row without either — a seat-added
      // row — emits neither, which says "this row has no count" rather than "the count was lost here".
      ...(Number.isInteger(r.total_hits) ? { total_hits: r.total_hits } : {}),
      ...(r.qid ? { qid: String(r.qid) } : {}),
    };
  }));
}

// ── THE ROWS SETTLED BY CODE, FROM WHAT THE RUN DID ──────────────────────────────────────────────
//
// The register digest ruled every row of this form. Step 3 now judges owners and says nothing about
// coverage (owner-judgment.mjs), so code settles the rows from the facts each row already carries. Measured
// against the digest's rulings on the saved runs (2026-10-01): every open crowd block, deferred slice and
// waiting family agree (99 rows), and 14 of 20 axis rows. Of the other 6, code is stricter on 3, and looser on
// 3: two planned-count axes and one axis the plan asked nothing of, which the digest called limited.
//
//   · an open crowd block ran and saturated, so it is `coverage-limited` — disclosed, never clamping;
//   · a deferred slice never ran and nothing can make it run, so it is `deferred` — the status the
//     verdict clamp reads (decideRegisterGap), so a run with an unsearched slice still cannot read CLEAR;
//   · an axis is `confirmed-clean` only on positive evidence that nothing on it is open: every slice listed
//     (`executed`), or counted where the plan asked only for a count (`incomplete` with no open block — a
//     planned count is sanctioned by doctrine, `openBlocksByAxis()` in register-plan.mjs) and every such
//     count came back with a number. A count that came back with none makes the axis `deferred`. The
//     skeleton is built from the plan's entries, so an axis with no skeleton state is one the plan put no
//     question to (a mark with no common element has no crowd to probe, a matter with no owner to probe asks
//     no owner question): nothing was owed and nothing was searched, so it is `not-asked` (NOT_ASKED) —
//     never clean, and never a limitation (owner, 2026-10-01). A state this rule does not name is no
//     evidence, and reads `deferred`.
//     It is `deferred` when the execution skeleton contradicts itself about it, when a slice on it never
//     ran (`unexecuted`), when its band could not be read, or when it is not a register axis at all (a stray
//     file in register-units, which no search stands behind). It is `coverage-limited` when any of its
//     blocks or slices is open, or when every entry on it was skipped behind a crowded parent. An axis whose
//     every entry is a waiting family takes the families' own judgment (`withheld-by-judgment` when the
//     reading turn withheld each one, and `deferred` while any is undecided). These are the states a clean
//     claim was always refused over (register-plan.mjs, findUnexecutedCleanClaims);
//   · a waiting family is the reading turn's to judge: a family it decided arrives settled, and one it did
//     not stays open, as it always has.
//
// A row the form's builder already settled (a waiting family the reading turn withheld) keeps that
// ruling; every other row is settled here, afresh on every pass, from that pass's facts. The reason is the
// row's own facts, in the words the ledger already prints beside every row (`coverageRowFacts`): code
// writes no new sentence about coverage.

/** The facts a row carries, as the ledger prints them: the hit count, what is unaccounted, the receipt. */
export function coverageRowFacts(r) {
  return [
    Number.isInteger(r?.total_hits) ? `${r.total_hits} hits` : "",
    r?.unaccounted_classes?.length ? `classes unaccounted: ${r.unaccounted_classes.join(", ")}` : "",
    r?.unaccounted_terms?.length ? `terms unaccounted: ${r.unaccounted_terms.join(", ")}` : "",
    r?.receipt_reason ? `receipt: ${r.receipt_reason}` : "",
  ].filter(Boolean).join("; ");
}

/**
 * Every row the form carries, settled from its facts by the rule above. `bandsUnreadable` is the form's
 * own record of the axes whose band would not parse (`generated_from.bands_unreadable`); `unknownAxes`
 * the unit files that are not register axes (coverage-form-io.mjs, `unknownAxisUnits`). PURE.
 */
export function settleCoverageRowsFromFacts(rows, { bandsUnreadable = [], unknownAxes = [] } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const openIn = new Set(list.filter((r) => (r?.kind === "block" || r?.kind === "deferred") && r.open === true).map((r) => r.axis));
  const key = (a) => String(a ?? "").trim().toLowerCase();
  const unreadable = new Set([...(bandsUnreadable ?? []), ...(unknownAxes ?? [])].map(key));
  const axisStatus = (r) => {
    if (r.open === true) return "deferred";
    if (r.skeleton_state === "unexecuted" || unreadable.has(key(r.axis))) return "deferred";
    if (openIn.has(r.axis)) return "coverage-limited";
    if (r.skeleton_state === "skipped") return "coverage-limited";
    if (r.skeleton_state === "awaiting-judgment") {
      const families = list.filter((f) => f?.kind === "family" && f.axis === r.axis);
      return families.length && families.every((f) => String(f.status ?? "").trim() === "withheld-by-judgment")
        ? "withheld-by-judgment" : "deferred";
    }
    // A count the plan asked for came back with no number: nothing says what the count was.
    if (r.counts_not_taken?.length) return "deferred";
    // An axis with no recorded state is one the plan put no question to. Nothing was owed, and nothing was
    // searched either: it is NOT ASKED, never clean, and never a limitation.
    if (r.skeleton_state == null) return NOT_ASKED;
    // CLEAN ONLY ON POSITIVE EVIDENCE: every slice listed, or counted where the plan asked only for a count
    // (`incomplete` with no open block). A state this rule does not know is not evidence of anything.
    if (r.skeleton_state === "executed" || r.skeleton_state === "incomplete") return "confirmed-clean";
    return "deferred";
  };
  return list.map((r) => {
    if (!r || String(r.status ?? "").trim()) return r;
    if (r.kind === "block") return { ...r, status: "coverage-limited", reason: coverageRowFacts(r) };
    if (r.kind === "deferred") return { ...r, status: "deferred", reason: coverageRowFacts(r) };
    if (r.kind === "axis") return { ...r, status: axisStatus(r), reason: "" };
    return r;   // a family the reading turn did not decide stays open: its judgment was never this step's
  });
}
