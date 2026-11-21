// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// floor-and-gap-checks.mjs — what the skeptic and the verdict gate read before they settle: the open floors and their
// breaches, the envelope and escalation notes, the screen gate's evidence, the late and refused records, the register
// gaps a verdict carries as conditions, and the findings' deadlines.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { ensureDriverDir } from "../shared/driver-dir.mjs";
import { coverageLedgerTableRows, splitDeferredByCloseability } from "./coverage-ledger.mjs";
import { parseFindingsJson, parseFindingsJsonLenient } from "./findings-model.mjs";
import { heldRecordProvenance, linesRead, readRunCallRows, recordFetchOutcomes, recordGoodsEvidence, recordReads, registerCallAccount } from "./goods-evidence.mjs";
import { note, runLog } from "./log.mjs";
import { ownerScreenNegative } from "./owner-screen.mjs";
import { readPlacementFormInput } from "./placement-form-io.mjs";
import { buildSelectionIndex, lineKey } from "./placement-form.mjs";
import { bandRecordIds } from "./placement-pass-record.mjs";
import { DEFAULT_LEDGER_PATH } from "./provider-usage.mjs";
import { parseFindingsEndings } from "./recall-reconciliation.mjs";
import { findingUris } from "./record-carry.mjs";
import { keptModelOrdinal, readFold } from "./record-fold.mjs";
import { bandShapeGoods } from "./record-goods.mjs";
import { readPlanExecution, refusedRecordsPath, stickyGapUnits } from "./register-band-run.mjs";
import { capabilitiesFor } from "./register-capabilities.mjs";
import { loadCoverageLedger, readOwnerScreen } from "./register-digest-run.mjs";
import { fullyDeferredAxes, rowOutsideProviderOffices } from "./register-plan.mjs";
import { collectOppositionDeadlines, normalizeRecordUri } from "./registry-fidelity.mjs";
import { atomicWrite } from "./run-record.mjs";
import { policedDropUris, screenGateEvidence } from "./screen-gate.mjs";
import { safeReadJson } from "./stage-dispatch.mjs";
import { writeFindings } from "./stage-freshness.mjs";
import { lines, paths } from "./stages.mjs";
import { driverReadsFor, rebaseSynthesis } from "./synthesis-record.mjs";
import { parseVariantManifestModel } from "./variant-manifest-model.mjs";
import { existsSync, readFileSync } from "node:fs";

/**
 * The records a refused merge left out that are still outside the named band: a record a later merge took in is read,
 * and is not counted as left out. Never throws.
 */
export function refusedRecordsLeftOut(P) {   // @internal — driven by its test with a run's own files
  const ids = safeReadJson(refusedRecordsPath(P))?.ids;
  if (!Array.isArray(ids) || !ids.length) return [];
  const inBand = new Set((safeReadJson(P.registerNamedBand)?.enumerated ?? []).map((r) => String(r?.record_id ?? "").toLowerCase()));
  return ids.map((x) => String(x).toLowerCase()).filter((id) => id && !inBand.has(id));
}

/**
 * The records the named band holds that the last placement pass that ran never read. [] when it read every one, and
 * when no pass recorded what it read (a run predating the record assesses nothing late). Ids, never the band's bytes:
 * a count that moved is not a record placement has not seen. PURE over the run's files.
 */
export function lateRecordIds(P) {   // @internal — driven by its test with a run's own files
  const seen = safeReadJson(paths(P.runDir).placementBandIds);
  if (!Array.isArray(seen?.ids)) return [];
  const had = new Set(seen.ids);
  return bandRecordIds(safeReadJson(P.registerNamedBand)).filter((id) => !had.has(id));
}

/**
 * THE LATE RECORDS THE REPORT DOES NOT ADDRESS: records the band holds that no placement pass read (`lateRecordIds`),
 * which neither the reading step's account nor the writer's findings name, and which no other clause names
 * (`alreadyNamed`, lowercased). A record either step names is addressed there, whatever placement did. Lowercased ids,
 * in the band's order. Never throws. PURE over the run's files.
 */
export function lateRecordsUnaddressed(P, alreadyNamed = new Set()) {   // @internal — driven by its test with a run's own files
  const late = lateRecordIds(P);
  if (!late.length) return [];
  let endings = { carried: new Set(), dropRows: new Set() };
  try { endings = parseFindingsEndings(readFileSync(P.registerFindings, "utf8")); } catch { /* no account from the reading step */ }
  let named = new Set();
  try { named = new Set([...findingUris(parseFindingsJsonLenient(readFileSync(P.findings, "utf8"))?.findings ?? []).keys()].map((u) => String(u).toLowerCase())); }
  catch { /* no findings from the writer */ }
  return late.filter((id) => !endings.carried.has(id) && !endings.dropRows.has(id) && !named.has(id) && !alreadyNamed.has(id));
}

/** The records the writer was owed, by id: the population its duty is out of. Null without a spec. Never throws. */
export function owedUrisFor(runDir) {
  try {
    const owed = driverReadsFor(runDir).owed;
    // An entry's row owes every record it holds.
    return Array.isArray(owed) ? owed.flatMap((row) => (Array.isArray(row?.uris) && row.uris.length ? row.uris : [row?.uri ?? row?.record_id]))
      .map((u) => String(normalizeRecordUri(u) ?? "").toLowerCase()).filter(Boolean) : null;
  } catch { return null; }
}

// ── — THE SEARCH FLOOR, REBUILT AS A TYPED DESIGNATION ────────────────────────────────────────
//
// The ⭐ marker was retired at and stays retired. What comes back is the MECHANISM it carried: the
// worker who missed the work does not also get to write the label that excuses it.
//
// The old `findFloorBreaches` read ⭐-marked lines out of the manifest TEXT, tokenised them, dropped
// generic words and matched the remainder against coverage-row text. That join is why it needed free text
// at all, and it is what conversion 3 made unreachable. This one reads `search_floor` — axis names, closed
// against REGISTER_AXES, designated by clearance-variants in an earlier turn — and joins on `axis`, which
// both sides type. No tokens, no matching, nothing to go quietly wrong.
//
// A BREACH IS: an axis this mark's floor obliges, carrying a row labelled `coverage-limited`. That label
// says "an accepted structural limit"; on floor work it is the seat grading its own miss. `deferred` is
// NOT a breach — it is honest outstanding work, and `computeOpenFloors` already discloses it.
//
// NO DESIGNATION ⇒ NO BREACH, and that is load-bearing rather than incidental: a floor that defaulted to
// on would manufacture the hold on every run, which is worse than the widening closes.
export function findFloorBreaches(ledger, floorAxes) {   // @internal
  const floors = new Set((floorAxes ?? []).map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean));
  if (!floors.size) return [];
  return (ledger ?? [])
    .filter((r) => floors.has(String(r?.axis ?? "").toLowerCase()) && r?.status === "coverage-limited")
    .map((r) => ({ axis: String(r.axis).toLowerCase(), unit: r.unit, reason: r.reason ?? "" }));
}

/**
 * The floor axes this run's manifest designates, or `[]`.
 *
 * READ FROM THE VALIDATED MODEL, never from the rendered manifest. The rendered file is a projection and
 * a reader of it would be back to matching text — the thing that killed the original. Every failure is
 * `[]`: no manifest, unreadable, unparseable. That is the honest default here and not an absence read as
 * a pass, because the whole mechanism is opt-in — a run with no designation owes no floor, and a run whose
 * manifest cannot be read has no designation to honour. The refusal for an absent or unparseable manifest
 * belongs to the stage that writes it and already exists there — validators.variantManifest in verify.mjs runs the same parser
 * through `checkSiblingJson` and fails clearance-variants with `variantmodel_missing`. Checked, because
 * "something else refuses it" is exactly the assumption that turns a swallowed error into a silent pass.
 */
export function readFloorAxes(paths) {   // @internal
  try { return parseVariantManifestModel(readFileSync(paths.variantManifestModel, "utf8")).search_floor ?? []; }
  catch { return []; }
}

// A never-active axis self-writes a harmless "not applicable" digest — the skill MANDATES the exact
// scope wording (skills/clearance-register/unit.md: `query:"<axis> not applicable"`,
// `reason:"not applicable — <why>"`), so the coverage-ledger row lands as `<axis> / axis not applicable`.
// It is `deferred` only because a non-search must not be dressed as a clean — it is NOT floor work left
// open. Keyed on the self-digest scope (deterministic, skill-dictated), never a genuine floor's
// substantive scope, so a real open floor can never be swept out.
export function isInactiveAxisRow(r) {   // @internal
  return /\bnot[\s-]?applicable\b/i.test(String(r?.unit ?? r?.scope ?? ""));
}

// Open floors at delivery = `deferred` coverage rows, MINUS never-active axes (an inactive axis had no
// floor work to leave open, so it must not leak a floor row onto the disclosure). Pure + testable.
//
// restores the BREACH half, and the second argument is now the typed designation rather than the
// manifest text the retired version scanned. Two disclosable states, kept apart because they are
// different facts about the run:
//
//   deferred          planned, not run, said so. Honest outstanding work.
//   floor breach      obliged by this mark's floor, and labelled an accepted limit instead of executed.
//
// The breach line names WHY it is disclosed, because "unit X" on a disclosure a client reads is not a
// finding — it is a word.
export function computeOpenFloors(ledger, floorAxes) {   // @internal
  return (ledger ?? []).filter((r) => r.status === "deferred" && !isInactiveAxisRow(r)).map((r) => r.unit)
    .concat(findFloorBreaches(ledger, floorAxes)
      .map((b) => `${b.unit} (labelled coverage-limited — search-floor work on a designated axis, without a found/not-found result)`));
}

// Escalation risk tag — pure and testable. Reads the
// dictated `risk: <category>` field off an axis's ESCALATE line. Fail-safe by construction: a missing or
// A2 (addendum 2026-07-30) — `heldAxes` are floor obligations NO amount of time can close: the active
// provider cannot express those slices at all, so a re-run re-derives the identical refusal. They are
// removed from the arithmetic BEFORE the clock is consulted (the rule lives here, beside the "no
// deadline given" branch that closed two of them on the evidence run) and reported back so the caller
// can log them and leave them standing. They are NOT resolved, NOT relabelled and NOT quietly dropped:
// a held row stays `deferred`, keeps its open-floor status, and ships disclosed with its mechanical
// cause. The coverage floor's right to refuse a clean verdict over that slice is exactly the point.
export function envelopeDecision({ deferredAxes, deadline, now, estCloseSec, heldAxes = [] }) {   // @internal
  const held = [...new Set((heldAxes ?? []).map((a) => String(a)))];
  const closeable = (deferredAxes ?? []).filter((a) => !held.includes(String(a)));
  const heldNote = held.length
    ? ` (${held.length} axis/axes held: a capability-gap deferral is never closeable by time — ${held.join(", ")})`
    : "";
  if (!closeable.length) {
    return held.length
      ? { close: false, closeable, held, reason: `no closeable floor obligations${heldNote}` }
      : { close: false, closeable, held, reason: "no deferred floor obligations" };
  }
  if (!deadline) return { close: true, closeable, held, reason: `no deadline given — time permits closing in-loop${heldNote}` };
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return { close: true, closeable, held, reason: `unparseable deadline "${deadline}" — treated as permissive${heldNote}` };
  const availSec = (t - now) / 1000;
  const marginSec = availSec - estCloseSec - 3600;
  return marginSec > 0
    ? { close: true, closeable, held, reason: `deadline permits: ~${Math.round(estCloseSec / 60)} min to close, ${Math.round(availSec / 60)} min available${heldNote}` }
    : { close: false, closeable, held, reason: `deadline does not permit: ~${Math.round(estCloseSec / 60)} min to close vs ${Math.round(availSec / 60)} min to deadline (incl. 60-min delivery reserve)${heldNote}` };
}

/**
 * Whether a coverage row names an office the plan's provider cannot express, as a predicate for the closeability split.
 * A plan with no provider, or one the capability contract does not know, names nothing outside. PURE.
 */
export function officeGapOf(plan) {   // @internal
  let capabilities = null;
  try { capabilities = plan?.provider ? capabilitiesFor(plan.provider) : null; } catch { capabilities = null; }
  return capabilities ? (row) => rowOutsideProviderOffices(row, capabilities) : () => false;
}

// WHAT A RE-RUN CANNOT CLOSE, in the words the review's table, the review's manual and both re-run follow-ups share, so
// the unit that is told to leave a row and the review that is told not to send it back read one reason.
export const NOT_CLOSEABLE_KINDS = "the provider cannot express the slice, the envelope close has already asked it again, it was not asked in this run, or it names no search at all";   // @internal
const heldRowLines = (rows) => rows.map((r) => `| ${r.unit} | deferred | ${r.reason} |`).join("\n");
/** The rows an escalated unit must leave as they are, and why; empty when there are none. @internal */
export function escalationHeldNote(rows) {
  return rows?.length ? `\n\nNOT YOURS TO CLOSE — a re-run cannot close these: ${NOT_CLOSEABLE_KINDS}. Leave these Coverage-ledger rows exactly as they are (\`deferred\`, same reason), and do not restate them as searched or clean:\n${heldRowLines(rows)}` : "";
}
/** The rows a unit the envelope re-opens must leave as they are, and why; empty when there are none. @internal */
export function envelopeHeldNote(rows) {
  return rows?.length ? `\n\nThese rows on this axis are NOT yours to close and must stay exactly as they are — a re-run cannot close them: ${NOT_CLOSEABLE_KINDS}. Leave them \`deferred\`, keep their reason, and do not restate them as searched or clean:\n${heldRowLines(rows)}` : "";
}

/**
 * Whether a deferred coverage row names a question a re-run can still send, read off the plan-execution receipt as a
 * predicate for the closeability split. An axis's `missing` questions are the ones a re-run sends: planned and never
 * sent, or failed at the provider. A capability gap is not among them, and neither is a follow-up the safety net
 * refused (joinPlanToBands). A row carrying its question's qid can be sent when that question is missing. The axis's
 * own row, which names the axis and no slice of it, stands for the axis's planned questions, and can be sent when the
 * axis holds a missing one. Any other row that names no question names no search: a re-run has nothing to send for
 * it, whatever else its axis holds. Null for an axis the receipt does not cover, or with no receipt, so the split keeps
 * its old answer. PURE.
 */
export function askableOf(receipt) {   // @internal
  const missingByAxis = new Map();
  for (const s of Array.isArray(receipt?.skeleton) ? receipt.skeleton : []) {
    const ax = String(s?.axis ?? "").toLowerCase();
    if (!ax) continue;
    const set = missingByAxis.get(ax) ?? new Set();
    for (const q of Array.isArray(s?.missing) ? s.missing : []) set.add(String(q?.qid ?? q));
    missingByAxis.set(ax, set);
  }
  return (row) => {
    const missing = missingByAxis.get(String(row?.axis ?? "").toLowerCase());
    if (!missing) return null;
    if (row?.qid) return missing.has(String(row.qid));
    return !String(row?.scope ?? "").trim() && missing.size > 0;
  };
}

/**
 * The axes the plan-execution receipt indicts with >=1 DETERMINISTIC deferral (joinPlanToBands'
 * `deferred` bucket — the executor's own client-side refusals), plus the axes the frozen plan says are
 * deferred end to end. The AUTHORITY half of the capability-gap split; prose only ever narrows inside
 * an axis this set already names. PURE.
 */
export function capabilityGapAxes(plan, receipt) {   // @internal
  const axisOf = new Map((plan?.entries ?? []).map((e) => [String(e?.qid ?? ""), String(e?.axis ?? "").toLowerCase()]));
  const out = new Set();
  for (const d of receipt?.deferred ?? []) {
    const ax = axisOf.get(String(d?.qid ?? ""));
    if (ax) out.add(ax);
  }
  for (const s of receipt?.skeleton ?? []) {
    if (s?.state === "deferred" && (s.deferred?.length ?? 0) > 0) out.add(String(s.axis ?? "").toLowerCase());
  }
  return out;
}

/**
 * THE CONDITIONS THE RECORD'S ACTIONS STATE, AS THE RECORD NOW STANDS. A repair can rewrite, withdraw or add a forward
 * legal step, and the list follows it: the entries the record's actions put there (`fromRecord`, by reason) are
 * replaced by the steps it states now (`now`, each `{ reason, clause }`, in the record's order), at the place the first
 * of them stood, or at the end where none stood. Every other entry keeps its place, and a step whose reason another
 * entry carries is left to that entry. Returns the index-aligned arrays as they now stand, the reasons the record now
 * holds there (`held`), and which reasons went and came. PURE.
 */
export function conditionsFollowingTheRecord({ reasons = [], clauses = [], fromRecord = new Set(), now = [] } = {}) {   // @internal — driven by its test
  const kept = [];
  let at = -1;
  for (const [i, r] of reasons.entries()) {
    if (fromRecord.has(r)) { if (at < 0) at = kept.length; continue; }
    kept.push([r, clauses[i]]);
  }
  const others = new Set(kept.map(([r]) => r));
  const placed = [];
  for (const n of now) {
    if (others.has(n.reason) || placed.some(([r]) => r === n.reason)) continue;
    placed.push([n.reason, n.clause ?? n.reason]);
  }
  const pos = at < 0 ? kept.length : at;
  const rows = [...kept.slice(0, pos), ...placed, ...kept.slice(pos)];
  const before = reasons.filter((r) => fromRecord.has(r));
  const clauseWas = new Map(reasons.map((r, i) => [r, clauses[i]]));
  const held = placed.map(([r]) => r);
  return { reasons: rows.map(([r]) => r), clauses: rows.map(([, c]) => c), held: new Set(held),
    withdrawn: before.filter((r) => !held.includes(r)), added: held.filter((r) => !before.includes(r)),
    restated: placed.filter(([r, c]) => before.includes(r) && clauseWas.get(r) !== c).map(([r]) => r) };
}

// (T3a, ruling 2026-08-26 — "Deliver always, with open points printed. The refusal on a blocking
// review goes." That REVERSES T3, which had retired "delivered-with-open-questions" and deleted
// the extra this comment used to be a tombstone for. Both decisions are the owner's; this is the standing
// one. The open points are no longer a dispatch extra a seat writes up: `buildReviewerOpenPointsSection`
// renders them at assembly, code-built from senior-eye-review.md through the shipped parsers, on the
// "code wins" doctrine — the one seat that must not be asked to summarise the reviewer's
// objections is the seat the reviewer objected to.)

// Run refutation. narrative-refutation is opus-primary (Phase-4); the standard cross-provider chain (stage())
// handles route fallback automatically — opus → Azure → Google — each on a fresh `-fbN` key, so this needs no
// bespoke fallback wiring. Returns {ok, verdict, key, model, thinking} — key/model/thinking
// identify the WINNING attempt so the verdict-gate re-check can RESUME it warm (A1) rather than cold-restart
// on the base key / re-try the known-bad route. (--from is auto-honored inside stageOnce's forceFromActive.)
// WS2 (B4) — the DETERMINISTIC PLAN-EXECUTION CHECK (the B2 pre-check precedent): in plan
// mode the reviewer receives the frozen plan's execution receipt as a table and MUST audit it.
// T1 (J3): the section DEMAND is UNCONDITIONAL whenever the receipt exists — the validator
// keys on receipt existence, so the old best-effort demand that silently dropped guaranteed a 3×
// plan_audit_missing fail (copper-spire). Only the receipt TABLE stays best-effort.
//
// review — WHAT AN UNPARSEABLE RECEIPT ACTUALLY DOES, corrected. This said it "fails loud (the
// attachProfile posture)". It does not, and never did on either path: the throw below is a
// StageFailure and `composeDispatchExtra` catches every builder throw, so the block silently vanished
// from the dispatch while the prompt kept promising it. The throw stays — it is the honest signal —
// but the loudness now lands where it changes an outcome: the composer RECORDS the failure in `failed`
// instead of only logging it, the stage's own prompt names the fault and forbids reading the missing
// table as a clean register, and the dispatch receipt distinguishes a block that broke from one that
// never existed. Loud to the seat and to the reader of the receipt, without losing a production
// dispatch over one additive prompt block.
//
// Shared by the fresh refutation AND every recheck path that rewrites the review — the
// validator judges each rewrite identically, so each rewrite must carry the demand.
// ── A2 (addendum 2026-07-30): the skeptic receives the coverage ledger and the plan-execution
// receipt as DATA ─────────────────────────────────────────────────────────────────────────────────
//
// The skeptic's job includes deciding which axes to ESCALATE, and escalation spends money. It was
// given the two findings files and the manifest, and nothing else — so on the 2026-07-30 evidence run
// it re-derived the Coverage ledger out of a 103 KB prose document, spent 28,592 thinking tokens (95%
// of its emission) doing it, got it wrong, and escalated two axes whose slices the provider cannot
// express at all. Both artifacts existed on disk the whole time, machine-written and exact.
//
// The charter's principle in one function: computed things reach the next stage as DATA, not prose.
// The block is a TABLE, not an instruction to go and read files — the paths are named as the
// authority (stages.mjs also lists them as inputs) but the rows are already here, so nothing has to
// be re-derived to answer the escalation question. Best-effort by construction: the skeptic is
// non-fatal and a missing block only returns it to the prose it reads anyway.
export function skepticDeferralExtra(ctx) {   // @internal
  const P = ctx.paths;
  try {
    const rows = loadCoverageLedger(P.runDir).rows;
    const receipt = readPlanExecution(ctx);
    if (!rows.length && !receipt) return "";
    const gapAxes = capabilityGapAxes(ctx.registerPlan, receipt);
    const fullyDeferred = new Set((ctx.registerPlan ? fullyDeferredAxes(ctx.registerPlan) : []).map((a) => String(a.axis).toLowerCase()));
    const axes = [...new Set(rows.map((r) => String(r.axis ?? "").toLowerCase()).filter(Boolean))];
    const heldUnits = stickyGapUnits(P);
    const ledgerLines = coverageLedgerTableRows(rows);
    const held = [], closeable = [];
    for (const a of axes) {
      const s = splitDeferredByCloseability(rows, a, gapAxes, { fullyDeferred: fullyDeferred.has(a), heldUnits, uncovered: officeGapOf(ctx.registerPlan), askable: askableOf(receipt) });
      for (const r of s.held) held.push(`${a} / ${r.unit} — ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
      for (const r of s.closeable) closeable.push(`${a} / ${r.unit} — ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
    }
    const deferredList = Array.isArray(receipt?.deferred) ? receipt.deferred : [];
    const deferredQids = deferredList.slice(0, 24)
      .map((d) => `- ${d.qid} — ${String(d.reason ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
    const more = deferredList.length > 24 ? [`- …and ${deferredList.length - 24} more (read ${P.planExecution} for the rest)`] : [];
    // THE CLASSES THE FRAME ADDED, AND WHAT EACH RETURNED. This block names what was refused and what is
    // open, and nothing that ran, so a class the frame added beyond the instructed ones — asked and
    // answered with its records listed — was absent from it, and the skeptic reported it as never swept.
    const addedClassRows = (ctx.registerPlan?.entries ?? []).filter((e) => e?.added_class_reason).map((e) => {
      const ran = (receipt?.executed ?? []).find((x) => x.qid === e.qid);
      const answer = ran ? `${ran.state}${Number.isFinite(ran.records) ? `, ${ran.records} records` : ""}`
        : (receipt?.deferred ?? []).some((d) => d.qid === e.qid) ? "refused (listed above)"
        : (receipt?.missing ?? []).includes(e.qid) ? "not run (missing)" : "not in the receipt";
      return `- ${e.qid} (class ${(e.nice_classes ?? []).join(", ")}) — ${answer}`;
    });
    const ownerNegative = ownerScreenNegative(readOwnerScreen(P));
    return lines(
      `COVERAGE + EXECUTION, DRIVER-COMPUTED — do NOT re-derive any of this from the findings prose. These rows come from ${P.registerCoverageLedger} and ${P.planExecution}, the machine artifacts the driver wrote; both are also yours to read directly, but the answer to "what is still open, and can a re-run close it" is already below.`,
      "",
      "Coverage ledger (axis | unit | status | reason):",
      ...(ledgerLines.length ? ledgerLines : ["| (no machine ledger rows — the ledger is prose-only this run) |"]),
      "",
      deferredQids.length
        ? lines(`Plan-execution receipt — queries the ACTIVE PROVIDER REFUSED deterministically (${deferredList.length} of ${(receipt.executed?.length ?? 0) + deferredList.length + (receipt.missing?.length ?? 0)} planned), with the mechanical reason per query:`, ...deferredQids, ...more)
        : "Plan-execution receipt: no query was deterministically refused by the provider this run.",
      addedClassRows.length ? lines("", "Classes the frame added beyond the instructed ones — each question, and what it returned:", ...addedClassRows) : "",
      "",
      closeable.length
        ? `CLOSEABLE floor obligations (a warm re-run reaches these — escalate them if they are material): ${closeable.join("; ")}.`
        : "CLOSEABLE floor obligations: none.",
      held.length
        ? `NOT CLOSEABLE — a re-run cannot close these: ${NOT_CLOSEABLE_KINDS}: ${held.join("; ")}. Do NOT emit ESCALATE for these. They stay open, disclosed gaps for the lawyer, and the coverage floor is right to refuse a clean verdict over them — say so in a flag if the findings read them as clean, but never as an escalation.`
        : "NOT CLOSEABLE: none.",
      // the owner screen's own receipt rides the same block — the audit claim it replaces ("no record
      // anywhere in the band carries an incumbent-class qid") was false on the evidence run.
      ownerNegative ? `\n${ownerNegative}` : "",
    );
  } catch (e) {
    note(`skeptic deferral data skipped (non-fatal): ${String(e.message).slice(0, 80)}`);
    return "";
  }
}

/**
 * WHAT EACH POLICED GOODS DROP RESTS ON, recorded beside the screen gate (screen-gate.mjs `screenGateEvidence`).
 * Taken in two halves: `screenGateSnapshot` at the moment the gate judges, before it fetches anything (the findings
 * it judged, each policed drop's goods evidence, and the reading log), and the record after the gate's fetches,
 * which reads each drop's goods again only where the gate fetched. Disclosure only: the gate's rule and its
 * outcome are decided above and nothing here changes them.
 */
export function goodsEvidenceOfDrops(P, runPrefix, uris, gateFetched = null) {
  const out = new Map();
  if (!uris.length) return out;
  const calls = readRunCallRows(DEFAULT_LEDGER_PATH, runPrefix);
  const held = heldRecordProvenance(P.runDir);
  // Each drop's own band row, so that a goods reader which reads a row's goods reads this one's too.
  const band = safeReadJson(P.registerNamedBand);
  const bandRows = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const rowOf = new Map(bandRows.map((r) => [normalizeRecordUri(r?.record_id), r]));
  const goods = bandShapeGoods(P, bandRows).goods;
  const fetches = recordFetchOutcomes(calls.rows, { runPrefix });
  // The gate's own fetches are this run's too, recorded by the gate whatever the register's ledger kept of them.
  for (const [u, r] of gateFetched ?? []) {
    const key = normalizeRecordUri(u) || String(u ?? "").toLowerCase();
    const o = fetches.get(key) ?? { sent: 0, from_memory: 0, failed: 0, ok: false, last_status: null };
    if (r?.ok === true) o.ok = true; else o.failed = Math.max(o.failed, 1);
    fetches.set(key, o);
  }
  for (const uri of uris) {
    const e = recordGoodsEvidence(rowOf.get(normalizeRecordUri(uri)) ?? { record_id: uri }, { goods, held, fetches });
    // A register page the research saved is named by the question that saved it, which the write-up's label carries.
    out.set(uri, { goods: e.state, source: e.source, ...(e.question != null ? { question: e.question } : {}) });
  }
  return out;
}

export function screenGateSnapshot(ctx, runPrefix) {
  const P = ctx.paths;
  try {
    const findings = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
    let readingLog = "";
    try { readingLog = readFileSync(P.readingLog, "utf8"); } catch { readingLog = ""; }
    return { findings, readingLog, goods: goodsEvidenceOfDrops(P, runPrefix, policedDropUris(findings)) };
  } catch (e) {
    return { findings: "", readingLog: "", goods: new Map(), error: String(e?.message ?? e).slice(0, 160) };
  }
}

export function recordScreenGateEvidence(ctx, { runPrefix, before, heldBeforeGate, heldAfterGate, gateFetched }) {
  const P = ctx.paths;
  try {
    const uris = policedDropUris(before.findings);
    const after = gateFetched.size ? goodsEvidenceOfDrops(P, runPrefix, uris, gateFetched) : before.goods;
    // The line each drop's record sits on, as placement's fate count joins it, so a part of the shape or a page
    // of a group that served the line counts as the goods words shown.
    let lineOf = () => null, lineReads = "read";
    try {
      const index = buildSelectionIndex(readPlacementFormInput(P.runDir));
      lineOf = (uri) => lineKey(index.resolve(uri));
    } catch (e) { lineReads = `the band shape's lines could not be read, so only record opens and lookups count: ${String(e?.message ?? e).slice(0, 100)}`; }
    const ev = screenGateEvidence({ findingsContent: before.findings, heldBefore: heldBeforeGate, heldAfter: heldAfterGate,
      before: (uri) => before.goods.get(uri), after: (uri) => after.get(uri),
      reads: recordReads(before.readingLog), lines: linesRead(before.readingLog), lineOf, readerStage: "register-digest", gateFetched });
    const calls = readRunCallRows(DEFAULT_LEDGER_PATH, runPrefix);
    const gateCalls = registerCallAccount(calls.rows.filter((r) => String(r?.sessionKey ?? "").includes("screen-gate-refetch")));
    const doc = { schema_version: 2, ...ev, gate_calls: gateCalls, line_reads: lineReads,
      reading_note: "A drop with no recorded read has no band_record open or search-answer serve, and no lookup, part of the shape or page of a group serving its line, in the reading log for the reading step. The log is best-effort: this does not show the goods were never read.",
      ...(before.error ? { snapshot_error: before.error } : {}), ...(calls.error ? { call_ledger_error: calls.error } : {}) };
    ensureDriverDir(P.runDir);
    atomicWrite(paths(P.runDir).screenGateEvidence, JSON.stringify({ ts: new Date().toISOString(), ...doc }, null, 2) + "\n");
    runLog(P.runDir, { event: "screen-gate-evidence", ...ev.counts, unnamed: ev.unnamed, fetches: ev.fetches,
      alternatives: ev.alternatives, gate_calls: gateCalls });
  } catch (e) {
    runLog(P.runDir, { event: "screen-gate-evidence-failed", fail: String(e?.message ?? e).slice(0, 160) });
  }
}

// ── screen-gate unexamined-disclosure readers ────────────────────────────────────────────────────────
// The screen-gate's disclose-and-continue terminal writes _driver/screen-gate-unresolved.json (atomic,
// the receipt idiom) the moment its post-repair re-check still fails, so the disclosure survives a
// crash between the gate and delivery. This reader prefers the in-process ctx rows (this session
// produced them); the sidecar is the resume shape — a pass that reaches the coverage floor without
// having re-entered the gate still owes the clamp. Exported for the unit tests.
export function loadScreenGateUnresolved(runDir, ctx = {}) {   // @internal
  if (Array.isArray(ctx.screenGateUnresolved) && ctx.screenGateUnresolved.length) return ctx.screenGateUnresolved;
  try {
    const rows = JSON.parse(readFileSync(paths(runDir).screenGateUnresolved, "utf8"))?.unresolved;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }   // absent/corrupt sidecar ⇒ no disclosure owed on this path
}

// spec 64 (B3) — within-run deadline propagation (the DEMVENZY drop): the register bands carried
// oppositionEndDate 2026-07-13 two days before the window closed, and it never reached the delivered
// findings/prose. Deterministic join: a finding whose registration matches a band/record opposition
// window INSIDE the action window ([now-graceDays, now+withinDays], the findDeadlineUrgencyMiss
// constants) and that lacks a structured deadline gets deadline:{kind:"opposition", date} injected —
// the EARLIEST qualifying window end. Code fills ABSENCE only (an authored deadline always wins);
// out-of-window dates never inject (an archived 2015 window is history, not urgency). Receipt:
// _driver/deadline-enrich.json. NEVER-KILL: any defect leaves findings.json untouched.
export function enrichFindingDeadlines(P, runDir, note, { nowMs = Date.now(), withinDays = 60, graceDays = 14 } = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    const deadlines = collectOppositionDeadlines(runDir);
    if (!deadlines.size) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.findings)) return;
    const inWindow = (d) => {
      const days = Math.round((Date.parse(d) - nowMs) / 86400000);
      return Number.isFinite(days) && days <= withinDays && days >= -graceDays;
    };
    const enriched = [];
    for (const f of doc.findings) {
      if (f?.deadline?.date) continue;
      const dates = (Array.isArray(f?.owner?.registrations) ? f.owner.registrations : [])
        .map((r) => deadlines.get(normalizeRecordUri(r?.uri ?? "")))
        .filter(Boolean).filter(inWindow).sort();
      if (!dates.length) continue;
      f.deadline = { kind: "opposition", date: dates[0] };
      enriched.push({ ordinal: f.ordinal, mark: f.mark, date: dates[0] });
    }
    if (!enriched.length) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "finding-deadlines", settles: [] });   // B5 — a crash mid-write must never leave a truncated findings.json
    const base = rebaseEnrichedDeadlines(runDir, enriched);   // a later patch keeps what the file now carries
    atomicWrite(paths(runDir).deadlineEnrich, JSON.stringify({ schema_version: 1, ts: new Date().toISOString(), judged_at: new Date(nowMs).toISOString(), enriched, base }, null, 2) + "\n");
    note(`[deadline-enrich] ${enriched.length} finding(s) gained the register's own opposition window (${enriched.map((e) => `${e.mark}: ${e.date}`).join("; ").slice(0, 140)}) — a recorded deadline never silently disappears`);
  } catch (e) {
    note(`[deadline-enrich] skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
  }
}

// ── — WHY THIS IMPORT IS AT THE BOTTOM OF THE FILE ─────────────────────────────────────────────
//
// `import` is hoisted, so its position is free — and at the top of THIS file it is not free. 61
// line-citations across 35 tracked files point into this file and its sibling; one line added at the
// top repoints every one of them by one. `scripts/citation-line-check.mjs` would catch only the few
// that landed on a blank line: it says so itself — "a citation that drifted onto a different REAL line
// reads as correct to it". So the choice was a 61-number sweep with a silent-error mode, or one import
// placed where it shifts nothing. This is the second.
//
// Move it to the top the day those citations name symbols instead of numbers — which is what
// CONTRIBUTING.md asks for, and what makes them checkable at all.

/**
 * The verdict conditions for an unfinished register search: the run record's sentence, and the client's.
 *
 * THE CLIENT'S CLAUSE IS THE SAME SENTENCE WITH THE ENGINE TOKEN TAKEN OUT (ruled 2026-09-18). The axis
 * names — `primary-sweep`, `incumbent-class` — are how the engine files a register slice, and they reached
 * the verdict a client reads as "register coverage deferred on primary-sweep". Nothing is written in their
 * place: the client reads the remaining words, and the run record keeps the axes for whoever repairs the run.
 * PURE.
 *
 * @returns {{ reason: string, clause: string }[]}
 */
export function registerGapConditions(regGap) {   // @internal
  const out = [];
  const deferredAxes = [...new Set((regGap?.deferred ?? []).map((g) => g?.axis).filter(Boolean))];
  if ((regGap?.deferred ?? []).length) out.push({
    reason: `register coverage deferred on ${deferredAxes.join(", ")} — the search did not finish and must be re-run before this can be relied on`,
    clause: "register coverage deferred — the search did not finish and must be re-run before this can be relied on",
  });
  if ((regGap?.taintAxes ?? []).length) out.push({
    reason: `the ${regGap.taintAxes.join(", ")} register pass was cut down at the timeout wall and its self-reported coverage is unverified`,
    clause: "the register pass was cut down at the timeout wall and its self-reported coverage is unverified",
  });
  return out;
}

/**
 * THE MERGE BASE TAKES THE ENRICHED DEADLINES. A patch after the enrichment is merged onto
 * `_driver/synthesis-calls/accepted.json` and re-renders every finding from there, so a deadline written to the
 * findings file alone was dropped by the next patch, and a card built with it was rebuilt without it. In the model's
 * numbering: under a fold, a deadline lands on the member the fold kept, whose object the folded finding is, and the
 * fold carries it again. Only a finding the base holds with no deadline of its own takes one, as in the file. The
 * edit is judged as a call is; a refusal leaves the base as it was, and the receipt says what happened. Never throws.
 */
function rebaseEnrichedDeadlines(runDir, enriched) {
  const fold = readFold(runDir);
  const byOrdinal = new Map(enriched.map((e) => [keptModelOrdinal(fold, e.ordinal), e.date]).filter(([o]) => o != null));
  if (!byOrdinal.size) return "unmapped";
  const r = rebaseSynthesis(runDir, (held) => ({ ...held, findings: (Array.isArray(held?.findings) ? held.findings : [])
    .map((f) => (byOrdinal.has(f?.ordinal) && !f?.deadline?.date ? { ...f, deadline: { kind: "opposition", date: byOrdinal.get(f.ordinal) } } : f)) }));
  return r.ok ? (r.changed ? "enriched" : "unchanged") : /^no_base:/.test(String(r.reason)) ? "no-base" : "refused";
}
