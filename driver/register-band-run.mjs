// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-band-run.mjs — the register band as a run builds it: the bands read and merged, the named band and its shape,
// the slices taken out, the plan's execution receipt, the supplemental searches folded in and asked again, and the
// saturation probe run in code.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { FOLLOW_UP_SEARCH_LIMIT, followUpSearchesSent, readOutstanding } from "../providers/_shared/follow-up-searches.mjs";
import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { bandWithSlicesOut, slicesTakenOutByAxis } from "../shared/slices-taken-out.mjs";
import { buildBandShape, deriveRegisterPositions } from "./band-shape.mjs";
import { stagesRefusingBand } from "./band-size.mjs";
import { planVsExecutedChannels } from "./commonlaw-carry.mjs";
import { coverageFormStamp, readCoverageForm } from "./coverage-form-io.mjs";
import { formRowUnitKey } from "./coverage-ledger.mjs";
import { plainDeferralReason } from "./deferral-row.mjs";
import { clientMarkets, narrowingMarkets, orderTerritories } from "./effective-scope.mjs";
import { withRejected } from "./engine/mcp/supplemental.mjs";
import { readStickyGaps } from "./envelope-settle.mjs";
import { dispatchedQueriesFromBand, formGapDirectives, parseFormNeighbourhoodJson } from "./form-neighbourhood.mjs";
import { deriveGoodsEvidence, GOODS_EVIDENCE_FILE, heldRecordProvenance, readRunCallRows, recordFetchOutcomes } from "./goods-evidence.mjs";
import { crowdLine, slimLine } from "./hit-list.mjs";
import { note, outputMeta, runLog, stageLog } from "./log.mjs";
import { withFrameClasses } from "./matter-frame-record.mjs";
import { mergeNamedBands, parseNamedBand, quarantineUnknownStates } from "./named-band.mjs";
import { deriveOwnerScreen } from "./owner-screen.mjs";
import { writePlacementDecisions } from "./placement-decisions.mjs";
import { setAsideKeysOf } from "./placement-form.mjs";
import { recordTransition } from "./progress.mjs";
import { DEFAULT_LEDGER_PATH } from "./provider-usage.mjs";
import { bandShapeGoods, goodsEvidence, instructedOrder, shapeGoodsTest } from "./record-goods.mjs";
import { recordDetailIndex } from "./register-digest-run.mjs";
import { blocksByQidOf, crowdNarrowing, deferExhaustedProviderErrors, deriveCoverageSkeleton, foldSupplementalEntries, joinPlanToBands, ladderExhaustedQids, marketStepMarkets } from "./register-plan.mjs";
import { readBandAccount, renderUnitNote } from "./register-unit-record.mjs";
import { registerCapabilities } from "./register-unreachable.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { retryCannotHelpWith } from "./repairs.mjs";
import { StageFailure, stageWallFields } from "./run-outcome.mjs";
import { atomicWrite } from "./run-record.mjs";
import { inScopeClassList } from "./run-scope.mjs";
import { forceFromActive, safeReadJson } from "./stage-dispatch.mjs";
import { journalStageInputs } from "./stage-runner.mjs";
import { paths, STAGES } from "./stages.mjs";
import { parseVariantManifestModel } from "./variant-manifest-model.mjs";
import { validators } from "./verify.mjs";
import { readWithheldFamilies, releasedFamilyQids } from "./withheld-families.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// The plan join's options, one place: the families the reading turn released, the follow-ups the run's
// safety net did not send, which join as questions not asked rather than missing (follow-up-searches.mjs), and the run's
// main markets, the one market list a crowd of the identical mark is read in (crowdNarrowing): the order's
// countries, else the customer's priority markets, else the markets the customer's field and brand point to, as the
// identical mark's market step used them (W8), else the major markets, where no market step ran.
export const mainMarketsOf = (ctx) => {   // @internal
  try {
    const { scope, priorities, major } = narrowingMarkets(instructedOrder(ctx.paths, ctx.job), ctx.profile);
    if (scope.length) return scope;
    if (priorities.length) return priorities;
    const used = marketStepMarkets(ctx.registerPlan);
    return used.length ? used : major;
  } catch { return []; }
};
export const joinOptions = (ctx) => ({ released: releasedFamilyQids(ctx.paths.runDir),
  outstanding: new Set(readOutstanding(driverDir(ctx.paths.runDir)).map((r) => String(r.qid))), mainMarkets: mainMarketsOf(ctx) });

// Fix-1 (deterministic common-law closure): the lanes that dictate a supplementary grid SPEC (the driver
// writes the spec, the plugin writes the ledger, the driver folds it in code). One tag per lane so
// concurrent supplementaries never clobber each other and readHalfLedger folds every sibling. The
// coverage-closure lane is the only cell-closing top-up; frame-reopen source-channel closure stays
// prose/byte-diff (its channels are model-resolved, not spec-shaped platforms), so it writes no supp ledger.
export const CL_SUPP_TAGS = ["closure"];

// THE BANDS ARE READ WITH THE RECORDED SLICES OUT, whatever wrote them since. A unit re-run after the fan-in, by the
// envelope, the escalation or the taint chain, writes its axis's band whole, and a slice the searches' record took
// out would come back with the records nobody could prove were searched. So the band's two readers, the merge and the
// plan join, take the recorded slices out of what they read, in memory and never by writing the file: a unit or the
// executor may be writing that band at the same moment. Every other reader of a band as answers does the same, from
// the one definition (shared/slices-taken-out.mjs).
const recordedSlicesByAxis = (P) => slicesTakenOutByAxis(P?.runDir);

// A band's text with the slices taken out, for a reader that parses text. Text that does not parse is handed on whole,
// for the reader's own parse to refuse. PURE.
function withSlicesOut(raw, slices) {
  if (!Array.isArray(slices) || !slices.length) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw;
    const { blocks, taken } = bandWithSlicesOut(parsed, slices);
    return taken.length ? JSON.stringify(blocks) : raw;
  } catch { return raw; }
}

/**
 * THE SLICES A RUN COULD NOT PROVE IT SEARCHED, TAKEN OUT OF ITS BAND. Each recorded slice's block becomes the
 * executor's own deferred block (providers/_shared/execute-plan.mjs), carrying the slice's reason, or is added as one
 * where the band holds none for it. The plan join files it as deferred, the coverage form gives it an open row the
 * write-up may not call clean, and the axis's other blocks stand. The band as it was is kept beside it the first time,
 * as evidence. An axis whose band is absent or unreadable is left to the band's own checks. Returns the slices taken
 * out on this call. IMPURE (rewrites the bands).
 */
export function takeSlicesOutOfTheBand(P, slices) {   // @internal
  const taken = [];
  const byAxis = new Map();
  for (const s of Array.isArray(slices) ? slices : []) {
    if (!s?.axis || (!s?.qid && !s?.query)) continue;
    if (!byAxis.has(s.axis)) byAxis.set(s.axis, []);
    byAxis.get(s.axis).push(s);
  }
  for (const [axis, list] of byAxis) {
    const at = P.registerBand(axis);
    let blocks;
    try { blocks = JSON.parse(readFileSync(at, "utf8")); } catch { continue; }
    if (!Array.isArray(blocks)) continue;
    const out = bandWithSlicesOut(blocks, list);
    if (!out.taken.length) continue;
    taken.push(...out.taken);
    try { if (!existsSync(`${at}.before-taken-out`)) copyFileSync(at, `${at}.before-taken-out`); } catch { /* the evidence is best-effort */ }
    atomicWrite(at, JSON.stringify(out.blocks, null, 2) + "\n");
  }
  return taken;
}

// ── judgment-relocation (2026-06-23): the COMPLETE NAMED BAND flow (lift the firewall) ───────────────
// The register-unit funnel writes register-units/<axis>-band.json (a JSON ARRAY of named-band blocks). The
// driver MERGES the per-axis bands into one complete band (register-named-band.json) and feeds it to Layer B
// (placement / digest / synthesis). Light VALIDATOR like the coverage-ledger one: parseNamedBand THROWS
// `named_band_*` tokens — a parse miss is a stage fail with the token, never a hard crash. mergeNamedBands
// de-dups enumerated records by record_id and preserves every crowd descriptor. Returns the merged band
// object {enumerated, crowds} plus { axes:[…], invalid:[{axis,reason}] } so the caller can flag a bad axis.
export function mergeRegisterBands(P, axes = [], { orderClasses = null, goodsTest = null } = {}) {   // @internal
  const recorded = recordedSlicesByAxis(P);
  const bands = [];
  const merged = [];
  const invalid = [];
  for (const a of (axes ?? [])) {
    const bandPath = P.registerBand(a);
    if (!existsSync(bandPath)) continue;   // an axis that found nothing may legitimately write no band
    try {
      const band = parseNamedBand(withSlicesOut(readFileSync(bandPath, "utf8"), recorded.get(a)));   // throws named_band_* on a malformed artifact
      bands.push(band);
      merged.push(a);
    } catch (e) {
      // T1 (J1c, merge/resume path): a VOCABULARY miss on a qid-less judgment block must not
      // send the WHOLE axis to invalid[] — that silently dropped every enumerated record the axis DID
      // carry (a recall loss worse than the hard-fail). Quarantine repairs the band durably (unknown
      // qid-less states → honest incomplete descriptors), then the strict parse re-runs. Any other
      // defect (unparseable, block-invalid, qid-stamped unknown state) still lands in invalid[].
      if (/named_band_state_invalid/.test(String(e.message))) {
        try {
          const { blocks, quarantined } = quarantineUnknownStates(readFileSync(bandPath, "utf8"));
          if (quarantined.length) {
            writeFileSync(`${bandPath}.tmp`, JSON.stringify(blocks, null, 2) + "\n");
            renameSync(`${bandPath}.tmp`, bandPath);
            runLog(P.runDir, { event: "named-band-state-quarantined", axis: a, states: quarantined.map((q) => q.state), site: "merge" });
            const band = parseNamedBand(withSlicesOut(readFileSync(bandPath, "utf8"), recorded.get(a)));
            bands.push(band);
            merged.push(a);
            continue;
          }
        } catch { /* fall through to invalid[] with the ORIGINAL token */ }
      }
      // do NOT hard-crash — record the token (mirrors the coverage-ledger validator) so the caller flags it.
      invalid.push({ axis: a, reason: String(e.message).slice(0, 120) });
    }
  }
  return { band: mergeNamedBands(bands, { orderClasses, goodsTest }), axes: merged, invalid };
}

// Merge the per-axis bands and write the UNION to register-named-band.json (atomic temp+rename) so Layer B's
// declared stage input (stages.mjs stageInputs) is on disk. A run with no band files at all writes an empty
// {enumerated:[],crowds:[]} so the input always exists (a legacy/archived run, or a clean run where no axis
// surfaced a named band, still delivers).
// T3 (H3, an owner-approved doctrine flip — the code is its own record;): a band file that STILL will not parse after
// the T1 recovery ladder (warm re-emit + vocabulary quarantine, both already attempted upstream and again
// inside mergeRegisterBands) is a MACHINERY DEFECT — the run FAILS here instead of shipping a
// finished-looking CONDITIONAL over receipts judgment could not read (the retired WS-A "never-kill" /
// artifact-clamp behaviour; the rule is: machinery fails, CONDITIONAL is for lawyer-judged residue).

// ── copper-lattice re-route: supplemental-plan fold + receipt refresh ────────────────────────────────
// The propose-supplemental tool persists model-proposed entries per axis
// (register-units/<axis>-supplemental-plan.json — one writer per file, axes run in parallel) and
// executes them itself. The DRIVER folds them into the run plan here (single-threaded), so every
// supplemental is skeleton-tracked and receipt-durable exactly like a dictated entry — the taint
// chain, the clean-gates, and dispatchPlanQids cover them with zero extra code. Run-local only: the
// slug store is never written (clearances run once; senior lawyer 2026-07-10).
export function readRegisterBands(P, axes) {   // @internal
  const recorded = recordedSlicesByAxis(P);
  const byAxis = {};
  for (const a of axes ?? []) {
    if (!existsSync(P.registerBand(a))) continue;
    try {
      const parsed = JSON.parse(readFileSync(P.registerBand(a), "utf8"));
      byAxis[a] = bandWithSlicesOut(Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : []), recorded.get(a)).blocks;
    } catch { byAxis[a] = []; }
  }
  return byAxis;
}
/** The plan-execution receipt in hand (ctx first, then the on-disk copy). Never throws. */
export function readPlanExecution(ctx) {   // @internal
  if (ctx?.planExecution) return ctx.planExecution;
  const p = ctx?.paths?.planExecution;
  try { return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; }
}
/**
 * A qid this run has accepted as a capability gap (envelope-settle.mjs stickyGapsAfter) leaves `missing`
 * for `deferred`, with the reason it was accepted under, so no re-join can put it back on the ladder.
 * Returns the join unchanged when nothing is held. PURE.
 */
export function holdStickyGapsIn(join, sticky) {   // @internal
  const held = (join?.missing ?? []).filter((q) => sticky?.has(q));
  if (!held.length) return join;
  return { ...join, missing: join.missing.filter((q) => !sticky.has(q)),
    deferred: [...(join.deferred ?? []), ...held.map((q) => ({ qid: q, reason: String(sticky.get(q)?.reason ?? "").slice(0, 300) }))] };
}

/**
 * The coverage units of this run's sticky capability gaps, as ledgerUnitKey()s, found through the coverage
 * form's own deferred rows (the driver writes each with its qid). The envelope, the escalation and the
 * skeptic's ledger split then hold those rows whatever reason the seat wrote for them. A run with no form,
 * or no sticky gap, holds nothing extra, exactly as before.
 */
export function stickyGapUnits(P) {   // @internal
  const sticky = readStickyGaps(P);
  if (!sticky.size) return new Set();
  const stamp = coverageFormStamp(P.runDir);
  const rows = stamp.required ? (readCoverageForm(P.runDir, stamp.formName).rows ?? []) : [];
  return new Set(rows.filter((r) => r?.kind === "deferred" && sticky.has(String(r.qid ?? ""))).map(formRowUnitKey));
}

// `reasked` names questions the run has just asked again by code (reaskFollowUpErrors) and `unsent` the ones it tried to
// and could not send. The first are counted as through the ladder; the second never are, wherever the last receipt
// listed them, so a receipt written again after a dispatch that sent nothing defers nothing.
export function writePlanExecutionReceipt(ctx, joinRes, { reasked = [], unsent = [] } = {}) {   // @internal
  const P = ctx.paths;
  joinRes = holdStickyGapsIn(joinRes, readStickyGaps(P));
  // — the ONE place the receipt is written is the one place this decision is taken. The
  // reclassification is keyed off the receipt already on disk (ladderExhaustedQids), so every writer
  // agrees without any of them knowing about it: the fan-in, the envelope's re-join after its close
  // attempt, and refreshSupplementalExecution's post-followup accounting. Doing it at the fan-in alone
  // would have let the very next re-join put a deferred slice back into `missing` and record it
  // "closed: ok" — a slice disclosed as a gap on one line and claimed closed on the next.
  // Deliberately NOT gated on plan_version. A qid is the same slice whichever plan version carries it,
  // and a supplemental fold bumps the version — gating on it would hand a hard-errored slice back to
  // `missing` the moment the plan grew, which is the one moment a run is least able to notice.
  const prior = readPlanExecution(ctx);
  {
    // The predicate is the SAME test the fan-in throw below uses to stamp `deterministic` and refuse the
    // ladder. Passing it here is what closes the regression: an error the run will not ride the
    // ladder for can no longer be required to have ridden it. See register-plan.mjs's header.
    //
    // — it was `(reason) => !TRANSIENT_RE.test(reason)`, and that read the STATUS CODE over the
    // SENTENCE. A provider that answers `HTTP 500 … Near/Adj queries with sub queries that can return a
    // huge amount of results are not allowed` has read the request and rejected its shape; the refusal
    // will recur byte-identically forever. `\bhttp\s?5\d\d\b` matched it, so seven slices on one axis
    // were filed ladder-spent with `permanent: 0` — a structural refusal recorded as weather.
    // `retryCannotHelpWith` keeps the old rule and adds the one that outranks it.
    const exhausted = ladderExhaustedQids(prior);
    for (const q of reasked ?? []) exhausted.add(String(q));
    for (const q of unsent ?? []) exhausted.delete(String(q));
    const { join, converted } = deferExhaustedProviderErrors(
      joinRes, readRegisterBands(P, ctx.axes ?? []), exhausted,
      retryCannotHelpWith);
    if (converted.length) {
      joinRes = join;
      const permanent = converted.filter((c) => c.path === "permanent");
      // — THE ROW NOW CARRIES THE THING IT IS A DECISION ABOUT.
      //
      // Its keys were `ts, event, count, permanent, qids`. A reader who saw `permanent: 0` had nothing
      // to audit that against: the classification was recorded and the string it was made from was not,
      // so the one row that says "this refusal is weather" could never be checked from the record. The
      // causes are already in hand — `converted[]` carries both — so this is a field, not plumbing.
      //
      // `qids_omitted` for the same reason one level down: `slice(0, 8)` dropped the ninth qid onward
      // with no marker and no count, which is the pathology this issue is about, in this very line.
      // Naming the number is the whole fix — a reader can now tell a list of eight from a list of
      // eight-of-nineteen.
      runLog(P.runDir, { event: "plan-qids-provider-hard-error-deferred", count: converted.length,
        permanent: permanent.length, qids: converted.slice(0, 8).map((c) => c.qid),
        qids_omitted: Math.max(0, converted.length - 8),
        reasons: [...new Set(converted.map((c) => String(c.cause ?? "").slice(0, 160)))].slice(0, 4) });
      // The two paths get their own sentence: one says the ladder was spent, the other says the ladder
      // could not have helped. A note claiming the wrong one makes the run's own record of WHY a slice
      // went unsearched wrong, which is the thing this whole mechanism is for.
      for (const [path, rows] of [["ladder-spent", converted.filter((c) => c.path === "ladder-spent")], ["permanent", permanent]]) {
        if (!rows.length) continue;
        note(`register plan: ${rows.length} dictated slice(s) DEFERRED `
          + (path === "permanent"
            ? `without riding the recovery ladder — the provider accepted them and then failed with an error this run cannot classify as transient, so retrying is futile and they were never searched: `
            : `after the full recovery ladder — the provider accepted them and then hard-errored, so they were never searched and cannot be read as clean: `)
          + rows.slice(0, 3).map((c) => `${c.qid} ← ${c.cause.slice(0, 120)}`).join("; "));
      }
    }
  }
  const skeleton = deriveCoverageSkeleton(ctx.registerPlan, joinRes);
  const supplemental = ctx.registerPlan.entries.filter((e) => e.origin === "supplemental" || /^(supp:|xcheck-)/.test(e.qid)).map((e) => e.qid);
  // — EXECUTED IS NOT ANSWERED, and the receipt stated only the first. `joinPlanToBands` pushes to
  // `executed` any block that is neither error nor deferred, carrying its `state` through — so a row
  // reading `{"qid":"…","state":"incomplete"}` sits in `executed`, and a receipt of
  // `executed: 146, missing: []` reads as "the plan ran" when it means "146 slices own a block".
  //
  // A reader — human or gate — had to open the band files to get the number the field name promised.
  // `answered` is that number, derived from rows the receipt already carries, so nothing new is measured
  // and the two cannot disagree. `incomplete` is stated beside it rather than left to subtraction: a
  // crowd descriptor is a legitimate, disclosed NON-answer, and the honest receipt says how many there
  // are instead of letting `missing: []` imply none.
  const answeredRows = (joinRes.executed ?? []).filter((e) => String(e?.state ?? "").toLowerCase() !== "incomplete");
  const census = { answered: answeredRows.length, incomplete: (joinRes.executed ?? []).length - answeredRows.length };
  // THE SAFETY NET UNDER THE FOLLOW-UP SEARCHES (follow-up-searches.mjs), on the run log and nowhere a model reads: the
  // limit, the follow-up searches sent and how many follow-ups it did not send. Logged once each time those figures move.
  try {
    const { sent } = followUpSearchesSent(driverDir(P.runDir));
    // a question held back once and asked later (a count file unreadable for a moment) was asked
    const answered = new Set((joinRes.executed ?? []).map((e) => String(e?.qid)));
    const notSent = readOutstanding(driverDir(P.runDir)).filter((r) => !answered.has(String(r.qid))).length;
    if (sent > 0 || notSent > 0) {
      const net = { limit: FOLLOW_UP_SEARCH_LIMIT, sent: Number.isFinite(sent) ? sent : null, reached: !Number.isFinite(sent) || sent >= FOLLOW_UP_SEARCH_LIMIT, not_sent: notSent };
      const seen = `${net.sent}:${net.not_sent}`;
      if (ctx.followUpNetLogged !== seen) { runLog(P.runDir, { event: "register-follow-up-searches", ...net }); ctx.followUpNetLogged = seen; }
    }
  } catch { /* the run log line is a record only */ }
  // the run's main markets, the one market list its crowd endings were read against: a run constant the coverage form reads
  const receipt = { plan_version: ctx.registerPlan.plan_version, ...joinRes, ...census, ...(supplemental.length ? { supplemental } : {}),
    main_markets: mainMarketsOf(ctx), skeleton };
  writeFileSync(`${P.planExecution}.tmp`, JSON.stringify(receipt, null, 2) + "\n");
  renameSync(`${P.planExecution}.tmp`, P.planExecution);
  ctx.planExecution = receipt;
  return skeleton;
}

export function foldSupplementalProposals(ctx) {   // @internal
  if (!ctx.registerPlan) return [];
  const P = ctx.paths;
  const entries = [];
  for (const a of ctx.axes ?? []) {
    const p = join(P.runDir, "register-units", `${a}-supplemental-plan.json`);
    if (!existsSync(p)) continue;
    try {
      const supp = JSON.parse(readFileSync(p, "utf8"));
      for (const e of Array.isArray(supp?.entries) ? supp.entries : []) if (e?.qid && e?.axis === a) entries.push(e);
    } catch (e) { note(`supplemental plan ${a} unreadable (${String(e.message).slice(0, 60)}) — its qids stay tool-side until repaired`); }
  }
  if (!entries.length) return [];
  const { plan, added, refused } = foldSupplementalEntries(ctx.registerPlan, entries);
  if (added.length) {
    writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(plan, null, 2) + "\n");
    renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
    ctx.registerPlan = plan;
    runLog(P.runDir, { event: "supplemental-fold", added: added.length, version: plan.plan_version });
    note(`supplemental fold: ${added.length} model-proposed register entr${added.length === 1 ? "y" : "ies"} joined the plan (v${plan.plan_version})`);
  }
  // — the model-set `term_literal` path. The propose-supplemental tool screens at mint, but the
  // flag is a field the MODEL fills in, and it used to suppress every term rule; a markup term wearing
  // it passed the mint, landed in this sidecar and folded here unexamined. The refusal goes back into
  // the axis sidecar's own `rejected[]` — the surface the authoring stage already reads — rather than
  // into a new file nobody opens.
  if (refused.length) {
    runLog(P.runDir, { event: "supplemental-fold-refused", refused: refused.length,
      rows: refused.slice(0, 6).map((r) => ({ qid: r.qid, term: String(r.term).slice(0, 60) })) });
    note(`supplemental fold: ${refused.length} model-proposed entr${refused.length === 1 ? "y" : "ies"} REFUSED — ${refused.map((r) => r.qid).join(", ")}`);
    for (const a of ctx.axes ?? []) {
      const rows = refused.filter((r) => entries.find((e) => e.qid === r.qid)?.axis === a);
      if (!rows.length) continue;
      const p = join(P.runDir, "register-units", `${a}-supplemental-plan.json`);
      try {
        const doc = JSON.parse(readFileSync(p, "utf8"));
        const next = withRejected(doc, rows.map((r) => ({ issue: r.issue, proposal: { qid: r.qid, term: r.term } })),
          { ts: new Date().toISOString(), origin: "supplemental-fold" });
        writeFileSync(`${p}.tmp`, JSON.stringify(next, null, 2) + "\n");
        renameSync(`${p}.tmp`, p);
      } catch (e) { note(`supplemental fold: rejected[] write failed for ${a} (non-fatal): ${String(e.message).slice(0, 80)}`); }
    }
  }
  return added;
}
// Post-followup accounting: escalation/envelope/reopen turns may have proposed new supplementals —
// fold them and refresh the receipt so plan-execution.json (the not-finished substrate every gate
// reads) always includes them. NEVER-KILL: accounting must not fail a run the followup just repaired.
export function refreshSupplementalExecution(ctx) {   // @internal
  if (!ctx.registerPlan) return;
  try {
    const added = foldSupplementalProposals(ctx);
    const stale = ctx.planExecution && ctx.planExecution.plan_version !== ctx.registerPlan.plan_version;
    if (added.length || stale) {
      writePlanExecutionReceipt(ctx, joinPlanToBands(ctx.registerPlan, readRegisterBands(ctx.paths, ctx.axes ?? []), joinOptions(ctx)));
      runLog(ctx.paths.runDir, { event: "plan-execution-refresh", added: added.length });
    }
  } catch (e) { note(`supplemental receipt refresh skipped (${String(e.message).slice(0, 80)}) — never-kill`); }
}

/**
 * The questions to ask again after a follow-up turn: each `missing` from the bands as they stand that holds a provider
 * error the run reads as passing (an outage, a 5xx). Read off the bands, not off the last receipt's `missing`, because
 * the refresh above writes a follow-up's new questions there without asking any of them again. Left out: a question
 * with no answer of any kind (no error block), a sticky gap, a refusal retrying cannot help (deferred at once, by the
 * writer's own test), and anything the receipt already defers. PURE but for the reads.
 */
function followUpErrorsToReask(ctx, bands) {
  const P = ctx.paths;
  const deferredNow = new Set((readPlanExecution(ctx)?.deferred ?? []).map((d) => String(d?.qid ?? "")));
  const joined = holdStickyGapsIn(joinPlanToBands(ctx.registerPlan, bands, joinOptions(ctx)), readStickyGaps(P));
  const { join: open } = deferExhaustedProviderErrors(joined, bands, new Set(), retryCannotHelpWith);
  const causeOf = new Map();
  for (const arr of Object.values(bands ?? {}))
    for (const b of arr ?? []) if (b && typeof b.qid === "string" && b.qid && b.error === true && b.deferred !== true && b.reason) causeOf.set(b.qid, String(b.reason));
  const axisOf = new Map((ctx.registerPlan.entries ?? []).map((e) => [e.qid, e.axis]));
  return (open.missing ?? []).filter((q) => causeOf.has(q) && !deferredNow.has(q) && axisOf.get(q))
    .map((q) => ({ qid: q, axis: axisOf.get(q), cause: causeOf.get(q) }));
}

/**
 * A FOLLOW-UP TURN'S QUESTION THAT CAME BACK A PROVIDER ERROR IS ASKED AGAIN BY CODE BEFORE THE RUN GOES ON.
 *
 * An escalation, an envelope close or a frame reopen can propose register questions, and the tool that takes them asks
 * them at once. When the register answers one with an error the run reads as passing, the question joins the receipt as
 * `missing`, and the receipt defers a provider error only after the run has asked it again. Nothing asked it again
 * before the reading step: the fan-in had already run its ladder. So the axis read `unexecuted`, the reading step's
 * clean rows on that axis were refused on each attempt, and the run parked to have a resume ask what one code call
 * could ask in the same pass. Measured on a test run of 2026-11-12: two axes, six questions, three asked per axis in
 * 20 requests; the run spent 318 more across two resumes (120, 46 and 152) and still delivered with the gap.
 *
 * Each such question is now sent once more through the executor (code, no model turn), axis by axis, and the attempt
 * and what it brought back are logged before the receipt is written. The receipt then counts the questions it sent as
 * asked again: one the register now answers is executed; one that still errors is deferred with its error as the stated
 * reason, under the rule every deferral of a provider error follows. A question the executor could not send (no
 * executor, its repair budget spent, a dispatch that failed before the register answered) is not counted and stays
 * `missing`. `reasked` names questions the caller has already asked again by code in this pass (the frame reopen
 * re-attempts its own), counted without a third ask. A run on which no follow-up question errored sends nothing more.
 * NEVER-KILL: returns null when there was nothing to ask, else what was sent and what came back.
 */
export async function reaskFollowUpErrors(ctx, dispatchPlanQids, site, { reasked = [] } = {}) {   // @internal
  if (!ctx.registerPlan) return null;
  refreshSupplementalExecution(ctx);
  const P = ctx.paths;
  try {
    const pending = followUpErrorsToReask(ctx, readRegisterBands(P, ctx.axes ?? []));
    if (!pending.length) return null;
    const before = new Set((reasked ?? []).map(String));
    const sent = pending.filter((q) => before.has(q.qid)).map((q) => q.qid);
    const unsent = [];
    const byAxis = new Map();
    for (const q of pending) if (!before.has(q.qid)) { if (!byAxis.has(q.axis)) byAxis.set(q.axis, []); byAxis.get(q.axis).push(q.qid); }
    const dispatches = [];
    for (const [axis, qids] of byAxis) {
      const dispatch = typeof dispatchPlanQids === "function" ? await dispatchPlanQids(axis, qids, `follow-up-reask:${site}`, 1) : null;
      (dispatch === "ok" ? sent : unsent).push(...qids);
      dispatches.push({ axis, qids, dispatch: dispatch ?? "not sent: no executor at this seam, or its repair budget is spent" });
    }
    // What came back, read off the bands before the receipt is written: the record of the attempt is the run log's.
    const answeredNow = new Set(), errorNow = new Map();
    for (const arr of Object.values(readRegisterBands(P, ctx.axes ?? [])))
      for (const b of arr ?? []) {
        if (!b || typeof b.qid !== "string" || !b.qid) continue;
        if (b.error === true) errorNow.set(b.qid, String(b.reason ?? ""));
        else answeredNow.add(b.qid);
      }
    const sentSet = new Set(sent);
    const rows = [...new Set(pending.map((q) => q.axis))].map((axis) => {
      const mine = pending.filter((q) => q.axis === axis).map((q) => q.qid);
      const d = dispatches.find((x) => x.axis === axis);
      const went = mine.filter((q) => sentSet.has(q));
      return { axis, qids: mine.slice(0, 8), qids_omitted: Math.max(0, mine.length - 8),
        dispatch: d ? String(d.dispatch).slice(0, 160) : "asked again by the caller in this pass",
        sent: went.length, answered: went.filter((q) => answeredNow.has(q)).length,
        still_erroring: went.filter((q) => errorNow.has(q) && !answeredNow.has(q)).length,
        causes: [...new Set(went.filter((q) => errorNow.has(q)).map((q) => errorNow.get(q).slice(0, 160)))].slice(0, 3) };
    });
    runLog(P.runDir, { event: "follow-up-reask", site, rows });
    if (!sent.length) return { site, sent, unsent, rows };
    remergeIfBandsMoved(ctx, `follow-up-reask:${site}`);
    writePlanExecutionReceipt(ctx, joinPlanToBands(ctx.registerPlan, readRegisterBands(P, ctx.axes ?? []), joinOptions(ctx)), { reasked: sent, unsent });
    runLog(P.runDir, { event: "plan-execution-refresh", added: 0, reasked: sent.length, site });
    return { site, sent, unsent, rows };
  } catch (e) {
    note(`follow-up re-ask (${site}) skipped (${String(e?.message ?? e).slice(0, 80)}) — never-kill`);
    return null;
  }
}

/** One axis band's bytes, or null where it has none: what a re-run's change is measured against. */
export function bandBytesOf(P, axis) { try { return readFileSync(P.registerBand(axis), "utf8"); } catch { return null; } }

/** A fingerprint of every axis band file, in axis order: what a merge read. */
function axisBandsFingerprint(P, axes = []) {
  const h = createHash("sha256");
  for (const a of axes ?? []) { h.update(`${a}\0`); h.update(bandBytesOf(P, a) ?? "\0absent"); h.update("\0"); }
  return h.digest("hex");
}

/**
 * THE NAMED BAND MERGED AGAIN WHEN AN AXIS BAND MOVED SINCE THE LAST MERGE. A unit re-run in its own session after the
 * fan-in (the cross-check's questions, a frame-reopen sweep, the skeptic's escalation, the envelope close) can add blocks
 * to its axis band whatever it does to its notes, and placement, the reading step and the writer read the named band.
 * Only the code-side recheck merged again, so the records those re-runs found reached none of the three. Code only:
 * nothing is dispatched. Returns whether the band was merged again.
 *
 * A BAND A READING STAGE WOULD REFUSE IS NOT ADOPTED. Placement, the reading step and the writer each refuse a band past
 * the size ceiling before they dispatch, and that refusal ends the run with no report. These re-runs alone can grow a
 * band the first merge kept under it past it, where without this merge the run would have gone on reading the band as
 * first merged. So the band is measured before it is adopted, by the test each stage applies at dispatch, and a band any
 * of the three would refuse is not adopted: the earlier merge stands, and the records the re-runs found stay unread. They
 * are not lost silently: the records the refused band held and the band standing does not are kept, and the recall gate
 * counts them into its approved sentence for records neither addressed nor set aside. `refusing` is that test,
 * injectable so a test can drive a refusal without a band of that size.
 */
export function remergeIfBandsMoved(ctx, why, { refusing = (bytes) => stagesRefusingBand(bytes, (s) => STAGES[s]?.timeoutSec) } = {}) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  if (ctx.bandsMergedAt == null) return false;   // nothing merged yet this pass: the fan-in merge reads every band
  const now = axisBandsFingerprint(P, ctx.axes);
  if (now === ctx.bandsMergedAt || now === ctx.bandsRefusedAt) return false;   // unmoved, or already refused as it stands
  try {
    const merged = mergeRegisterBands(P, ctx.axes ?? [], bandTrim(ctx));
    if (!merged.invalid.length) {
      const bytes = Buffer.byteLength(namedBandText(merged.band));
      const stages = refusing(bytes);
      if (stages.length) {
        ctx.bandsRefusedAt = now;
        const left = recordRefusedRecords(P, merged.band);
        runLog(P.runDir, { event: "named-band-remerge-over-ceiling", why, bytes, stages, records: left });
        note(`${why}: the band merged again would be ${(bytes / (1024 * 1024)).toFixed(1)} MB, more than ${stages.join(", ")} can be dispatched over — the earlier merge stands, and the records the re-run found stay unread`);
        return false;
      }
    }
    deriveNamedBand(ctx, merged); runLog(P.runDir, { event: "named-band-remerged", why }); return true;
  }
  catch (e) { note(`${why}: the named band could not be merged again (${String(e?.message ?? e).slice(0, 100)}) — the earlier merge stands`); return false; }
}

/** Where the records a refused merge left out are kept, for the recall gate. */
export const refusedRecordsPath = (P) => paths(P.runDir).bandRefusedRecords;

/**
 * THE RECORDS A REFUSED MERGE LEAVES OUT: the ids the band merged again holds and the band standing does not, added to
 * those an earlier refusal left out. Returns how many are kept, or null when they could not be written, which the run
 * record names. Never throws.
 */
function recordRefusedRecords(P, band) {
  try {
    const key = (r) => String(r?.record_id ?? "").toLowerCase();
    const standing = new Set((safeReadJson(P.registerNamedBand)?.enumerated ?? []).map(key));
    const ids = [...new Set([...(safeReadJson(refusedRecordsPath(P))?.ids ?? []),
      ...(band?.enumerated ?? []).map(key).filter((id) => id && !standing.has(id))])];
    atomicWrite(refusedRecordsPath(P), JSON.stringify({ ids, count: ids.length }, null, 2) + "\n");
    return ids.length;
  } catch (e) {
    runLog(P.runDir, { event: "band-refused-records-failed", reason: String(e?.message ?? e).slice(0, 160) });
    return null;
  }
}

/**
 * The named band as it is written to disk: what a dispatch over it measures.
 *
 * WRITTEN WITHOUT INDENTATION. Every reader parses it, but one: the form-gap check (`mechanicalFormGapDirectives`)
 * also searches its text for each near-form term. A term holds no JSON punctuation, so it matches inside one token
 * or not at all, and the indentation between tokens changes nothing it finds. Indented, the band was an eighth
 * whitespace: measured in testing, 2026-11-17, a 25,677,439-byte band was 22,026,521 bytes compact, with the
 * check's answer the same for every one of the run's 345 near-form terms.
 */
export const namedBandText = (band) => JSON.stringify(band) + "\n";   // @internal — driven by its test

export function deriveNamedBand(ctx, merged = null) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  const axes = ctx.axes ?? [];
  const { band, axes: ok, invalid } = merged ?? mergeRegisterBands(P, axes, bandTrim(ctx));   // a caller that measured the merge first hands it in
  const mergedFrom = axisBandsFingerprint(P, axes);
  if (invalid.length) {
    const detail = invalid.map((x) => `${x.axis}:${x.reason}`).join("; ");
    runLog(P.runDir, { event: "named-band-invalid", invalid });
    throw new StageFailure("fan-in", `register band artifact malformed for: ${invalid.map((x) => x.axis).join(", ")} (${detail.slice(0, 200)}) — judgment cannot read the funnel's own receipts; a report never ships over them`, undefined, { failClass: "deterministic" });
  }
  try {
    const tmp = P.registerNamedBand + ".tmp";
    writeFileSync(tmp, namedBandText(band));
    renameSync(tmp, P.registerNamedBand);
    ctx.bandsMergedAt = mergedFrom;
    runLog(P.runDir, { event: "named-band-merged", axes: ok, enumerated: band.enumerated.length, crowds: band.crowds.length });
  } catch (e) {
    note(`named-band merge write failed (non-fatal): ${String(e.message).slice(0, 100)}`);
  }
  // PR-8 — the reading layer's shape rides EVERY re-merge: the band never changes without the shape
  // following it in the same pass, so a stage can never read a shape older than its band.
  deriveBandShape(ctx, band);
  // P2-B — the owner screen's own receipt rides the same re-merge, for the same reason: the screen's
  // attribution is a function of the band, and a stale receipt is exactly how "produced no records"
  // outlived the records.
  deriveOwnerScreenArtifact(ctx, band);
  // — THE HIT LIST RIDES THE SAME RE-MERGE, for the same reason its two siblings do.
  // It is a projection of the band and nothing else, so a list older than its band would be a list that
  // disagrees with the archive about what was enumerated.
  deriveHitList(ctx, band);
  return band;
}

/**
 * — write `register-hit-list.json`: one slim line per enumerated record.
 *
 * THE LIST IS THE WORKING OBJECT AND THE BAND IS THE ARCHIVE. Judgment reads this; the band stays
 * whole, preserved, and unread by the stages that used to pay per-record attention to it.
 *
 * Best-effort like its siblings — a derivation failure removes a projection, it does not kill a run.
 * The BAND is the witness of what was enumerated; this file is how the run works through it, and a
 * missing one is visible immediately (every downstream reader takes it as its input).
 *
 * `read` rides where the band row carries the office's own reading of the mark. On the run measured,
 * 558 of 1,937 records had one on the normalised record and lost it at the band row — the adapter-side
 * half of that is cause 1, and this projection carries it the moment it is there.
 */
function deriveHitList(ctx, band) {
  const P = ctx.paths;
  try {
    // The reading lives on the row's SCREEN object — that is the shape the adapter builds and the
    // band row copies its top-level fields from. Measured on the archived round: every one of the
    // 1,937 rows carries a screen, and every populated `mark_text` came from it. Top level is read
    // as a fallback so a provider that promotes the field is not silently ignored.
    const lines = (band?.enumerated ?? []).map((r) =>
      slimLine(r, r?.screen?.mark_transliteration ?? r?.mark_transliteration ?? null));
    // ── CROWDS RIDE BESIDE THE LINES (Option A, as ruled) ─────────────────────────────────────────
    //
    // A crowd is a zone that could NOT be enumerated. Without it on the list, `band_lookup` answering
    // from the list returns nothing for a crowded zone — and nothing is indistinguishable from
    // "searched and clean". That is the silent-clean defect the whole programme exists to remove, so
    // the crowds land BEFORE the downstream swap can drop the band read.
    //
    // Written ALWAYS, empty when the run had none: an absent key means a list minted before crowds
    // rode, an empty array means this run had no crowd. Different facts, stated differently.
    //
    // ✕ WHAT THE SWAP STILL HAS TO CHECK BEFORE IT DROPS A BAND READ. `sample`, `term_counts` and
    // `class_counts` are deliberately NOT on the list — the first two are 82% of crowd bytes, and the
    // ruled field set excludes all three. Their consumers (crowd-context.mjs, coverage-ledger.mjs)
    // read register-named-band.json, which keeps being written, so nothing breaks today. But a swap
    // that repoints one of those readers at the list would silently lose the per-term and per-class
    // truth — named-band.mjs's own note says dropping class_counts hides WHICH class leg stayed open.
    // Census those three keys' readers before repointing anything, not after.
    const crowds = (band?.crowds ?? []).map(crowdLine);
    const tmp = P.registerHitList + ".tmp";
    writeFileSync(tmp, JSON.stringify({ schema_version: 1, lines, crowds }, null, 2) + "\n");
    renameSync(tmp, P.registerHitList);
    runLog(P.runDir, { event: "hit-list-minted", lines: lines.length, crowds: crowds.length,
      // a crowd whose count could not be taken is not a crowd that found nothing; the receipt says
      // how many of each, so a reader diagnosing coverage does not have to open the list to find out.
      crowds_uncounted: crowds.filter((c) => c.total_hits === null).length,
      with_reading: lines.filter((l) => l.read).length });
    return lines;
  } catch (e) {
    note(`hit-list mint failed (non-fatal): ${String(e.message).slice(0, 100)}`);
    return null;
  }
}

// P2-B (charter P2b) — write _driver/owner-screen.json: which owner slice ran, what it returned, and
// when it did not run, the mechanical reason. A projection of the frozen plan × the plan-execution
// receipt × the merged band; it decides nothing (the Coverage ledger stays the authority on status)
// and it is best-effort like its siblings — a derivation failure only removes a receipt.
export function deriveOwnerScreenArtifact(ctx, band) {
  const P = ctx.paths;
  if (!ctx.registerPlan) return null;
  try {
    const blocks = Object.values(readRegisterBands(P, ctx.axes ?? [])).flat();
    const deferredByQid = new Map((readPlanExecution(ctx)?.deferred ?? [])
      .map((d) => [String(d?.qid ?? ""), String(d?.reason ?? "")]).filter(([q]) => q));
    let caps = null;
    try { caps = registerCapabilities(ctx.register); } catch { /* unknown provider — the screen still reports states */ }
    const screen = deriveOwnerScreen(ctx.registerPlan.entries ?? [], blocks, band?.enumerated ?? [],
      { deferredByQid, capabilities: caps });
    if (!screen.owners.length) return null;   // no incumbent lane on this matter — nothing to receipt
    atomicWrite(P.ownerScreen, JSON.stringify({ ts: new Date().toISOString(), ...screen }, null, 2) + "\n");
    // unconditional counts (AD-4): every field on every run, so a zero is a recorded zero.
    runLog(P.runDir, { event: "owner-screen-derived", ...screen.totals,
      owner_surface: screen.owner_surface, provider: screen.provider });
    return screen;
  } catch (e) {
    runLog(P.runDir, { event: "owner-screen-failed", fail: String(e?.message ?? e).slice(0, 160) });
    note(`owner-screen derivation failed (non-fatal — the band and the coverage ledger stand): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

// PR-8 (Thread D1) — derive the deterministic band SHAPE (band-shape.mjs) from the freshly merged band:
// _driver/band-shape.json + the readable band-shape.md the band tools serve. Targets = the mark under
// search + its manifest variants (the structured model when it parsed; the job's mark always). BEST-
// EFFORT, never a gate: a shape derivation failure is logged loudly and the run proceeds — judgment
// still holds band_lookup over the band itself, and every machine check reads the complete band anyway.
export function deriveBandShape(ctx, band) {
  const P = ctx.paths;
  let evidenceDoc = null;
  try {
    const targets = [];
    const markNames = Array.isArray(ctx.job?.marks)
      ? ctx.job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean)
      : [ctx.job?.markName ?? ctx.job?.name].filter(Boolean);
    targets.push(...markNames);
    try {
      if (existsSync(P.variantManifestModel)) {
        const model = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"));
        targets.push(model.mark, model.dominant_element,
          ...model.elements.filter((e) => e.kind === "distinctive").map((e) => e.value),
          ...model.variants.map((v) => v.value));
      }
    } catch { /* prose-only manifest — the job's mark still classifies */ }
    let crowdContext = null;
    try { if (existsSync(P.crowdContext)) crowdContext = JSON.parse(readFileSync(P.crowdContext, "utf8")); }
    catch { /* evidence artifact unreadable — the shape's crowds simply carry no join */ }
    // The instructed classes and those the frame added for the client's own goods (decision 18, ruled 2026-09-21): a live identical record in either is a floor.
    const inScopeClasses = bandClasses(ctx);
    // P2-A (charter P2d) — the exact-identity POSITIONS projection rides every shape derivation, so
    // the identity collapse exists BEFORE any digest reads the band. The detail index (registration
    // numbers, IR-base linkage, Madrid designations) comes from _records/ — the fields search rows
    // cannot carry. Best-effort inside the shape's own best-effort: a positions failure only omits
    // the projection (the per-registration band and floors are untouched).
    let positions = null;
    try {
      positions = deriveRegisterPositions(band?.enumerated ?? [], recordDetailIndex(P.runDir));
      atomicWrite(P.registerPositions, JSON.stringify({ ts: new Date().toISOString(), ...positions }, null, 2) + "\n");
      // counts only — never a cost, never a client identity (telemetry contract)
      runLog(P.runDir, { event: "register-positions-derived", records: positions.totals.records,
        positions: positions.totals.positions, bridges: positions.totals.bridges });
    } catch (e) {
      runLog(P.runDir, { event: "register-positions-failed", fail: String(e?.message ?? e).slice(0, 160) });
      note(`register-positions derivation failed (non-fatal — the per-registration band stands): ${String(e?.message ?? e).slice(0, 100)}`);
    }
    const shapeGoods = bandShapeGoods(P, band?.enumerated ?? []);
    // What each record's goods rest on, derived first so the shape says it of each line the goods test could not
    // place; the same record is written beside the shape below.
    try { evidenceDoc = goodsEvidenceDocFor(ctx, band, shapeGoods.goods); } catch { evidenceDoc = null; }
    const evidenceBy = evidenceDoc ? new Map(evidenceDoc.records.map((r) => [r.uri, r])) : null;
    const evidenceOf = evidenceBy ? (r) => evidenceBy.get(normalizeRecordUri(r?.record_id) || String(r?.record_id ?? "")) ?? null : null;
    // what was retrieved under each crowd, from the per-axis blocks on disk now: the shape never carries a record older than its band
    const endings = (() => {
      if (!ctx.registerPlan || !(band?.crowds?.length)) return [];
      try { return crowdNarrowing(ctx.registerPlan, blocksByQidOf(readRegisterBands(P, ctx.axes ?? [])), { mainMarkets: mainMarketsOf(ctx) }).rows; } catch { return []; }
    })();
    const { shape, md } = buildBandShape(band, { crowdNarrowing: endings, targets: targets.slice(0, 64), inScopeClasses, crowdContext, positions, ...shapeGoods, markets: clientMarkets(instructedOrder(P, ctx.job), ctx.profile), territories: orderTerritories(instructedOrder(P, ctx.job), ctx.profile), keysOf: setAsideKeysOf(positions?.positions ?? null), evidenceOf });
    mkdirSync(dirname(P.bandShape), { recursive: true });
    atomicWrite(P.bandShape, JSON.stringify(shape, null, 2) + "\n");
    atomicWrite(P.bandShapeMd, md + "\n");
    const tested = shape.groups?.goods_test ?? { source: "none", words: [] };
    runLog(P.runDir, { event: "band-shape-derived", records: shape.totals.records, crowds: shape.totals.crowds,
      tiers: shape.totals.by_tier, floors: shape.floors.in_class_identical_or_near.length,
      goods_test: tested.source, goods_test_words: tested.words.length,
      // what each record's goods rest on: a held body, its band row's whole statements, statements cut short, or none
      goods_evidence: goodsEvidence(band?.enumerated ?? [], shapeGoods.goods),
      blind_spots: shape.blind_spots.map((b) => ({ kind: b.kind, count: b.count })) });
    // The goods test falls back where the variants stage named no product words; the run says so.
    if (tested.source !== "product_words")
      note(`band shape: no product words named — the goods test reads ${tested.source === "goods_words" ? "the words the register search was narrowed by" : "no words, so every line it would place is listed as not tested on goods"}`);
  } catch (e) {
    runLog(P.runDir, { event: "band-shape-failed", fail: String(e?.message ?? e).slice(0, 200) });
    note(`band-shape derivation failed (non-fatal — judgment still holds band_lookup over the band; machine checks read the complete band): ${String(e?.message ?? e).slice(0, 120)}`);
  }
  recordGoodsEvidenceFor(ctx, band, evidenceDoc);
  // Placement's standing decisions are read off the shape, so a shape derived again can change them with no placement
  // pass: a group's row checked again on the new shape may cover other lines, or stand no longer, and the floors it
  // leaves can grow. The decisions file the reading step, the writer and the review declare is written again with the
  // shape, so such a change makes a stage that already read them stale. Only once placement has written it.
  if (existsSync(P.placementDecisions)) {
    try { writePlacementDecisions(P); }
    catch (e) { runLog(P.runDir, { event: "placement-decisions-failed", at: "band-shape", reason: String(e?.message ?? e).slice(0, 120) }); }
  }
}

/**
 * WHAT EACH BAND RECORD'S GOODS REST ON, written beside the shape after every derivation (goods-evidence.mjs): the
 * goods reader the shape tests with, given the band's records so that a reader which reads a band row's own goods
 * reads them here too; the official records the run holds, with where each came from; and this run's record fetches,
 * from the register call ledger. The shape says the same of each line from the same derivation (its goods cell and
 * `goods_evidence`); the file itself is served by no band tool, gates nothing, and a failure costs the run this
 * record and nothing else.
 */
function goodsEvidenceDocFor(ctx, band, goods = null) {
  const P = ctx.paths;
  const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
  const calls = runPrefix ? readRunCallRows(DEFAULT_LEDGER_PATH, runPrefix) : { rows: [], error: null };
  const records = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const doc = deriveGoodsEvidence({ records, goods: goods ?? bandShapeGoods(P, records).goods, held: heldRecordProvenance(P.runDir),
    fetches: recordFetchOutcomes(calls.rows, { runPrefix }) });
  // Whether fetches could be read is part of the record: without the ledger, "not held" may hide a failed fetch.
  doc.fetches_read = runPrefix ? (calls.error ? `the register call ledger could not be read: ${calls.error}` : true) : "no run prefix";
  return doc;
}

function recordGoodsEvidenceFor(ctx, band, derived = null) {
  const P = ctx.paths;
  try {
    const doc = derived ?? goodsEvidenceDocFor(ctx, band);
    ensureDriverDir(P.runDir);
    atomicWrite(driverDir(P.runDir, GOODS_EVIDENCE_FILE), JSON.stringify(doc, null, 2) + "\n");
    runLog(P.runDir, { event: "goods-evidence", records: doc.totals.records, by_state: doc.totals.by_state,
      by_source: doc.totals.by_source, unreadable: doc.totals.unreadable, fetches_read: doc.fetches_read });
  } catch (e) {
    runLog(P.runDir, { event: "goods-evidence-failed", fail: String(e?.message ?? e).slice(0, 160) });
  }
}

// FORM-axis regrounding (Property 1, mechanical): a deterministically-generated form near-form the funnel never
// DISPATCHED is a completeness gap (NOT a sufficiency call). Emit it as a `variant` frame-diff directive so it
// rides the SAME supplemental-sweep + clamp channel as the blind frame-diff — the form axis stops depending on a
// peer model to NOTICE the gap (two LLMs share the same blind spot; the oracle does not). NEVER-KILL: any
// missing/unparseable artifact → [] (the blind frame-diff still runs).
export function mechanicalFormGapDirectives(ctx) {   // @internal
  const P = ctx.paths;
  try {
    if (!existsSync(P.formNeighbourhood) || !existsSync(P.registerNamedBand)) return [];
    const elements = parseFormNeighbourhoodJson(readFileSync(P.formNeighbourhood, "utf8"));
    if (!elements.length) return [];
    const bandText = readFileSync(P.registerNamedBand, "utf8");
    const dispatched = dispatchedQueriesFromBand(bandText);
    // LENIENCY (bias toward "dispatched" — a false gap only wastes a self-heal sweep / over-clamps; it can
    // never ship a false clean): a near-form ALSO counts as dispatched if it appears anywhere in the band
    // artifact — a query the funnel described in prose, or a returned mark_text — so a prose query summary
    // does not manufacture gaps. Only a near-form that appears NOWHERE (truly unsearched) stays a gap.
    const lower = bandText.toLowerCase();
    for (const el of elements) {
      for (const q of el.band.exactQueries) if (lower.includes(String(q).toLowerCase())) dispatched.push(q);
      for (const w of (el.band.wildcardPatterns ?? [])) if (lower.includes(String(w).toLowerCase())) dispatched.push(w); // phonetic family dispatched-in-prose
    }
    // A WITHHELD FAMILY IS AN EXPLAINED ABSENCE. The reading turn withholds a waiting family with its reason
    // (withheld-families.mjs), and the wildcard fringe is one. Counted as unsearched, it would be ordered
    // searched anyway, or clamp the verdict, over a decision the run recorded.
    const withheld = readWithheldFamilies(P.runDir);
    const explained = (ctx.registerPlan?.entries ?? []).filter((e) => withheld[e.qid])
      .flatMap((e) => [e.term, ...(Array.isArray(e.terms) ? e.terms : [])]).filter(Boolean);
    return formGapDirectives(elements, { dispatched, explained });
  } catch { return []; }
}

// ── — the common-law path's trace, and the jx zh slice on the same tracer ────────────────────
//
// A SIBLING of deriveRecordCarry, deliberately. The register path joins on a canonical `/mark` uri; a
// common-law candidate has no uri at all — it carries `{title, url}` and nothing else — so this joins on
// the canonicalised URL plus the structural cell key. The house URL normalizer is rejected on evidence:
// it discards the query, and on the real 2026-07-29 grid it collapses 143 URLs to 139 keys and merges two
// DIFFERENT Play Store apps. That collision concentrates in the non-Latin population this exists for,
// because a Han-script marketplace query returns `?q=…` search URLs.
//
// This is the path that lost WAVO TWIST and WAVO TROPICS on R3 — both sat in the run's own records and
// reached no findings list. It has already cost a round.
//
// Derived at publish, like the register trace and for the same reason: everything it joins is final by
// then. Disclosure only — annotate, never gate.
// ── part 2 — ONE READ OF THE ORDERED CHANNEL LIST, USED AT BOTH SEAMS ────────────────────────
//
// established the source and its reason: the plan is `_driver/grid-spec.json`'s `platforms`, NOT
// `ctx.profile.platforms`. The two diverge on a generic profile, where the channels come from the matter
// frame's `Search channels:` line — reading the profile would compare the grid against a plan the grid
// was never given, silently, on exactly the regulated matters the fallback exists to serve.
//
// It is a function now because there are two callers: the publish-time carry trace, and the stage-exit
// check below. Two copies of a rule this specific is how one of them ends up reading the profile again.
//
// ABSENT ⇒ null ⇒ "unknown", never a clean 1. A register-only run and a run whose grid spec never landed
// both genuinely cannot say what was ordered, and a coverage question that was never asked must not
// answer itself in the affirmative.
export function plannedChannelsFor(P) {
  try {
    if (!existsSync(P.gridSpec)) return null;
    const spec = JSON.parse(readFileSync(P.gridSpec, "utf8"));
    return Array.isArray(spec?.platforms) && spec.platforms.length ? spec.platforms : null;
  } catch (e) {
    note(`commonlaw-carry: grid spec unreadable, channel coverage stays unknown (${String(e?.message ?? e).slice(0, 60)})`);
    return null;
  }
}

// ── part 2 — THE CHANNEL COMPARISON, AT SEARCH-STAGE EXIT ────────────────────────────────────
//
// Part 1 shipped the comparison and wired the plan into it (), and it runs at PUBLISH —
// where the rest of the carry trace is derived, about two hours after the sweep it describes. The issue
// asked whether plan-vs-executed is knowable earlier. It is: the merged grid has just been written and
// the spec has been on disk since dispatch, so both inputs exist at this instant and neither changes.
//
// So this reports a coverage hole while the run can still act on it, instead of after delivery.
//
// IT ANNOTATES AND DOES NOT GATE, deliberately. A profile legitimately lists a platform a given grid
// skipped, so promoting this to a floor on arrival is the shape — a grammar killing paid work.
// The publish-time artifact remains the record; this is the early word, and the two derive from the same
// function over the same two inputs, so they cannot disagree about what was ordered.
//
// THE `unknown` STATE SURVIVES THE MOVE, which is the whole point rather than a detail: this seam runs
// on runs whose spec never landed, and those must say they cannot answer rather than score clean.
export function noteChannelCoverageAtStageExit(P, mergedGrid) {
  try {
    const channels = planVsExecutedChannels({
      planned: plannedChannelsFor(P),
      cells: mergedGrid?.cells ?? [],
      gaps: mergedGrid?.gaps ?? [],
    });
    runLog(P.runDir, { event: "channel-coverage", at: "search-stage-exit", ...channels });
    if (channels.state === "unknown")
      note(`channel coverage: UNKNOWN at grid exit — ${channels.why}`);
    else if (channels.never_searched?.length)
      note(`channel coverage: ${channels.never_searched.length} planned channel(s) never searched — ${channels.never_searched.join(", ")} (reported, not gated: #1066)`);
  } catch (e) {
    // A coverage NOTE that fails a run it is only describing is worse than the gap it reports.
    note(`channel coverage at grid exit could not be computed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`);
  }
}

// ── A REGISTER UNIT THAT COULD NOT FINISH IS DELIVERED AS ITS BAND STANDS ─────────────────────────────
//
// A unit that wrote no result once its attempts were spent ended the run, though the run held every other unit: on a
// production run on 2026-10-21 one unit's plan search timed out at the register on every attempt, and the client got
// nothing. Such a unit now fails as the searches not completed (the gather barrier below), naming itself and the planned
// slices its band never reached. Once its recovery is spent, the run-level catch records both, and the resumed pass
// takes the unit as it stands rather than sending it again: its band is what the kept answers left, or empty, and its
// note is the driver's own account of that band, with no word from the seat. The band merge then takes the recorded
// slices out as deferred blocks, so they are delivered as open rows.

/**
 * The planned slices of `axis` that its band holds no block for, each `{axis, qid, reason}` with the shipped reason for a
 * search that never reached the register. A slice with a block, a timed-out one included, is not among them: the band
 * already accounts for it. A guarded child is left to the plan join, which reads it off its parent. PURE but for the read.
 */
export function slicesUnitNeverReached(P, plan, axis, reason = plainDeferralReason("slice-not-landed")) {   // @internal
  let band = [];
  try { const parsed = JSON.parse(readFileSync(P.registerBand(axis), "utf8")); band = Array.isArray(parsed) ? parsed : []; } catch { band = []; }
  const held = new Set(band.map((b) => b?.qid).filter(Boolean).map(String));
  return (plan?.entries ?? []).filter((e) => e?.axis === axis && e?.qid && !e.when && !held.has(String(e.qid)))
    .map((e) => ({ axis, qid: String(e.qid), reason }));
}

/** The unit a run records as unfinished, taken as its band stands: its note rendered from it, nothing dispatched. */
export function unfinishedUnitAsItStands(ctx) {   // @internal
  const P = ctx.paths, a = ctx.axis, label = `register-unit:${a}`;
  const t0 = Date.now();
  mkdirSync(join(P.runDir, "register-units"), { recursive: true });
  const bandPath = P.registerBand(a);
  if (!existsSync(bandPath)) { writeFileSync(`${bandPath}.tmp`, "[]\n"); renameSync(`${bandPath}.tmp`, bandPath); }
  const out = P.registerUnit(a);
  writeFileSync(`${out}.tmp`, renderUnitNote({ axis: a, account: readBandAccount(P.runDir, a) }));
  renameSync(`${out}.tmp`, out);
  runLog(P.runDir, { event: "unit-not-completed-delivery", stage: label, output: outputMeta(out), ...stageWallFields(t0) });
  note(`[${label}] could not be completed once its recovery was spent — taken as its band stands and not sent again`);
  (ctx.skippedStages ??= []).push(label);
  recordTransition(ctx, "register-unit");
  return { ok: true, skipped: true, notCompleted: true, sessionKey: null, model: null };
}

// ── saturation-probe runs CODE-SIDE (2026-07-14, fabricated-band root cause) ────────────────────────
// The axis is fully dictated (count-only crowd descriptors; judgment proposes nothing on it), yet it was
// staffed by the cheapest model whose ONLY job was one register_execute_plan call — and the provider
// call-log proved that call was silently skipped ~1/3 of runs since, each time with a
// hand-fabricated band shipped in its place (ashen-causeway 07-06, teal-lattice 07-07, teal-foundry
// 07-13; copper-keystone 07-14 died at fan-in when the model deleted its own forgery). The driver now runs
// the frozen entries itself through the SAME provider executor the fan-in repair kit uses and templates
// the audit note; the band stays executor-written and qid-stamped, byte-compatible with the agent path.
// The agent stage remains the VERBATIM fallback when no executor lane exists (CLEAROTRON_PLAN_DISPATCH=off,
// a provider without executePlan, or no frozen plan) — that branch is the rollback path, and it is the
// one the offline mock harness exercises.
// Returns the stageOnce result shape. sessionKey is ALWAYS null: there is no live session to
// warm-resume, so the escalation/envelope arms and the plan-join treat the axis as resumed-past and use
// their code/fresh lanes (they already must — resumed-past axes have had a null unitKey since).
export async function runSaturationProbeCodeSide(ctx, planExec) {   // @internal
  const P = ctx.paths;
  const a = "saturation-probe";
  const label = `register-unit:${a}`;
  const out = P.registerUnit(a);
  const bandPath = P.registerBand(a);
  const sessionKey = `clearance-${ctx.run.slug}-${ctx.run.codename}-register-unit-${a}`;
  // crash-resume idempotency — mirrors stageOnce's skip: output present + valid ⇒ never re-execute.
  const forced = forceFromActive(ctx, "register-unit");
  // — hoisted above the skip return. Below it, this member's dispatch row carries boundaries and its
  // SKIP row does not, which is a hole in the wave at the one member that is code-side and fast.
  const t0 = Date.now();
  if (!forced && existsSync(out) && existsSync(bandPath) && validators.registerUnit(out, readFileSync(out, "utf8")).ok) {
    note(`[${label}] skip — output already present and valid (code-side)`);
    // outputMeta, NOT fileMeta — a skip row lands on the SAME get_run stages[] surface as a stage row, and
    // that surface's contract is `present`-bearing (see the census note above the stageOnce skip below).
    runLog(P.runDir, { event: "skip", stage: label, trigger: "skip", model: "code:execute-plan", output: outputMeta(out), ...stageWallFields(t0) });
    (ctx.skippedStages ??= []).push(label);
    recordTransition(ctx, "register-unit");
    return { ok: true, skipped: true, sessionKey: null, model: "code:execute-plan" };
  }
  mkdirSync(join(P.runDir, "register-units"), { recursive: true });
  const entries = (ctx.registerPlan?.entries ?? []).filter((e) => e?.axis === a);
  let summary = null, fail = null;
  if (!entries.length) {
    // vacuous axis (no element flagged saturated — the VENZY shape): the executor refuses an empty
    // axis, so the driver writes the honest empty band itself. Not a hand-authored data block — there
    // is no data; fan-in's plan⇄band join sees zero dictated entries and zero blocks, consistently.
    writeFileSync(`${bandPath}.tmp`, "[]\n");
    renameSync(`${bandPath}.tmp`, bandPath);
    summary = { executed: 0, states: {} };
  } else {
    // one in-driver retry for transport weather; the executor already retries each provider call once
    // in-tool, so two outer attempts is plenty — beyond that the recovery ladder parks the run.
    for (let attempt = 1; attempt <= 2 && !summary; attempt++) {
      const r = await planExec({ planPath: P.registerPlan, axis: a, outputPath: bandPath },
        { agentId: ctx.agent, sessionKey, recordLog: runRecordLogPath(P.runDir) });
      if (r?.ok) { summary = r; fail = null; }
      else {
        fail = `saturation-probe direct execution failed: ${String(r?.cause ?? "unknown").slice(0, 160)}`;
        note(`[${label}] executor attempt ${attempt}/2 failed — ${String(r?.cause ?? "unknown").slice(0, 120)}`);
      }
    }
  }
  if (summary) {
    try {
      writeSatProbeAuditNote({ ctx, out, bandPath, entries });
      const v = validators.registerUnit(out, readFileSync(out, "utf8"));
      if (!v.ok) fail = `code-side unit failed its own validator: ${v.reason}`;
    } catch (e) { fail = `code-side audit note failed: ${String(e?.message ?? e).slice(0, 120)}`; }
  }
  const ok = Boolean(summary) && !fail;
  stageLog(P.runDir, label, {
    attempt: 1, key: sessionKey, agent: ctx.agent, model: "code", modelUsed: "code:execute-plan",
    code: ok ? 0 : 1, wall: (Date.now() - t0) / 1000, status: ok ? "ok" : "error", fail: fail ?? null,
    laneWaitMs: 0, summary: summary ? `direct-executed ${summary.executed ?? entries.length}/${entries.length} dictated entr${entries.length === 1 ? "y" : "ies"}` : null,
    // UNCONDITIONAL outputMeta, matching the runLog row this function writes 20 lines down and the
    // contract the comment below states. It read `ok ? fileMeta(out): undefined` until: half the
    // described fix had landed (null → undefined) and the half that mattered had not. Both halves of
    // the old shape lied — `undefined` OMITS the key, which is the absent-means-false shape this
    // package exists to kill, and fileMeta renders a missing or mid-write output as {sha:null,size:0},
    // a plausible record where there is no file. outputMeta says {present:false} and refuses a byte
    // count nobody measured. Note the babysit guard could not have caught this: it projects run.jsonl,
    // and this row goes to the per-attempt <stage>.jsonl, a surface nothing was asserting.
    output: outputMeta(out),
  });
  // This row lands on get_run stages[] beside stageOnce's, so it owes that surface the SAME contract —
  // it was writing a shape of its own (post-merge audit N2):
  //   · output was `ok ? fileMeta(out) : null`. Under AD-4's vocabulary `null` means "this stage declares
  //     NO output", and this stage plainly declares one — the honest failure value is {present:false}.
  //     Unconditional outputMeta also makes a code-side MID-WRITE (band written, audit note or validator
  //     failed after it) visible instead of erased, exactly as it is on the agent path.
  //   · inputs were bare fileMeta, i.e. no `read` key at all — an OMITTED key, which is the absent-means-
  //     false shape this package exists to kill (and which babysit-output-honesty.test.mjs forbids).
  //     journalStageInputs with no gauge yields read:null: this lane is pure code, it never observes reads,
  //     and null is the honest answer. `.filter(Boolean)` stays OUTSIDE — journalStageInputs preserves a
  //     null element rather than dropping it, so the guard has to run on the path list.
  //   · followup / readsTruncated / warm were absent; they are written unconditionally (false/null/false)
  //     so the null `read`s explain themselves without a join, as on every other row.
  runLog(P.runDir, {
    event: "stage", stage: label, trigger: "fresh", ok, attempts: 1, fail,
    model: "code:execute-plan",
    inputs: journalStageInputs([P.registerPlan].filter(Boolean), { reads: null, readsTruncated: null, warm: false }),
    followup: false, readsTruncated: null, warm: false,
    output: outputMeta(out), summary: ok ? "direct-executed" : undefined,
    ...stageWallFields(t0),   //
  });
  if (ok) recordTransition(ctx, "register-unit");
  return ok ? { ok: true, sessionKey: null, model: "code:execute-plan" } : { ok: false, fail, sessionKey: null, model: "code:execute-plan" };
}

// The templated audit note for the code-side unit. Rendered FROM the executor-written band (the real
// material), never from model prose — the table is the read-back of what actually executed. Wording
// stays clear of the validator's declared_not_executed vocabulary by construction.
function writeSatProbeAuditNote({ ctx, out, bandPath, entries }) {
  let blocks = [];
  try { const parsed = JSON.parse(readFileSync(bandPath, "utf8")); if (Array.isArray(parsed)) blocks = parsed; } catch { /* empty/unreadable band renders as zero blocks; the band validator holds the line */ }
  const cell = (s) => String(s ?? "—").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 70);
  const rows = blocks.map((b) => `| ${cell(b.qid)} | ${cell(b.query)} | ${cell(b.state)}${b.error ? " ⚠ provider error" : ""} | ${b.total_hits ?? "—"} | ${b.fetched ?? 0} |`);
  const md = [
    `# Register unit: saturation-probe axis audit`,
    ``,
    `**Mark:** ${ctx.job?.markName ?? ctx.run.slug} | **Axis:** saturation-probe | **Run:** ${ctx.run.codename}`,
    ``,
    `**Mode:** deterministic code execution — the driver ran the frozen plan's dictated saturation-probe entries directly through the provider executor (the register_execute_plan lane). No model turn was involved; the band file is executor-written with every block qid-stamped.`,
    ``,
    ...(entries.length
      ? [`## Dictated entries executed (${entries.length})`, ``,
        `| qid | query | state | total_hits | fetched |`, `|---|---|---|---|---|`, ...rows]
      : [`## Scope`, ``,
        `The frozen plan carries no saturation-probe entries for this mark (no element flagged saturation: high/very-high) — the axis is vacuous this run and the band is an honest empty array.`]),
    ``,
    `## Coverage`,
    ``,
    `- Blocks in band: ${blocks.length} (${blocks.filter((b) => b?.state === "incomplete").length} incomplete descriptor(s), ${blocks.filter((b) => b?.state === "enumerated").length} enumerated)`,
    `- Band artifact: \`${basename(bandPath)}\` (executor-written, qid-stamped)`,
    ``,
    `Counts are dilution signals for Layer B judgment; the funnel makes no clearance calls.`,
    ``,
  ].join("\n");
  writeFileSync(`${out}.tmp`, md);
  renameSync(`${out}.tmp`, out);
}
// The matter's FULL in-scope Nice-class set (incl. services 42/44) — declared classes (top-level OR per-mark)
// else the profile defaults. The dangerous-band floor + its coverage gate must span ALL of these, never a
// goods-only subset (the VELTRIPHEN services-class miss). Strings, deduped.
/**
 * The classes this run's band is read in: the instructed ones, then those the frame added for the client's own goods
 * (decision 18). One answer for two readers: the band shape, where a live identical mark in any of them is a floor, and
 * the merged band, which carries goods text for these classes only (named-band.mjs `rowAsHanded`). IMPURE: reads the
 * accepted frame.
 */
// What the merge needs to set goods text aside: the order's classes, and the shape's goods-test words, whose answer
// for the set-aside wording the merge keeps (named-band.mjs `rowAsHanded`). IMPURE: reads the run's frame and manifest.
const bandTrim = (ctx) => ({ orderClasses: bandClasses(ctx), goodsTest: ctx?.paths ? shapeGoodsTest(ctx.paths) : null });

export function bandClasses(ctx) {   // @internal — driven by its test
  let classes = [];
  try { classes = inScopeClassList(ctx?.job, ctx?.profile).map(String); } catch { classes = (ctx?.job?.classes ?? []).map(String); }
  return withFrameClasses(classes, ctx?.paths?.runDir);
}
