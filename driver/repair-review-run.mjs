// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// repair-review-run.mjs — a repair and the review after it, as a run carries them out: the corrections' files and their
// snapshot, what a repair left stale and which stage runs it again, the review of the record after a repair, the
// restore of the record that passed, and the saves and withdrawals the verdict gate makes.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { composeDispatchExtra, prepareDeclinationSpec } from "./dispatch-extras.mjs";
import { note, runLog } from "./log.mjs";
import { nextRefutationSeq, readAcceptedReviewSince } from "./narrative-refutation-record.mjs";
import { placementFloorDecisionLines } from "./placement-decisions.mjs";
import { recordPlacementPass } from "./placement-pass-record.mjs";
import { foldAfterSave, modelRecordPath, readFold, snapshotFold } from "./record-fold.mjs";
import { runDigest } from "./register-digest-run.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { changedContent, changedInputsOf, classifyPoints, isEmptyChange, listForReview, postRepairRecordPath, readRepairBase, repairBasePath, restingOn, scopeItems, writePostRepairRecord } from "./repair-scope.mjs";
import { writeReviewAddresses } from "./review-addresses.mjs";
import { atomicWrite } from "./run-record.mjs";
import { stage, writerExclusionBlock } from "./stage-dispatch.mjs";
import { writeFindings } from "./stage-freshness.mjs";
import { paths } from "./stages.mjs";
import { acceptSynthesis, driverReadsFor, lastAcceptedCall, restoreSynthesisBase, snapshotSynthesisBase } from "./synthesis-record.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

// AD-2 A1 (E2E-R2, recovery granularity) — is the corrective cycle already SETTLED for the bytes on
// disk? Pure decision over the completion receipt + the current shas so it tests offline. Settled
// means: a receipt exists AND the review + narrative bytes are exactly the ones the completed cycle
// left behind (both non-null — an absent file is never "settled"). Either file moving re-arms the
// cycle: a recomputed narrative or a fresh review is new work, never a replay.
export function correctiveCycleSettledDecision(receipt, current) {   // @internal
  return Boolean(receipt?.shas
    && receipt.shas.review != null && receipt.shas.review === current?.review
    && receipt.shas.narrative != null && receipt.shas.narrative === current?.narrative);
}

// — ONE DISPATCHER FOR EVERY REPAIR ARM, BECAUSE THE ENTRIES CANNOT BE TRUSTED TO REMEMBER.
//
// measured the principle and applied it to exactly one entry: a repair dispatch that skips the
// stage's driver-computed blocks came out 3,017 bytes THINNER than the fresh one, so composing the same
// blocks is what makes the two passes identical rather than what makes them differ. That argument is not
// specific to synthesis, and the other two arms that declare blocks never got it.
//
// `narrative-refutation` declares TWO. `plan-audit` is the one the issue was filed about; `refute-registry-check`
// is the deterministic comparison of the narrative's claims against the fetched records in `_records`, and it
// is reachable ONLY through this composer. So on a repair pass the reviewer was re-asked with the
// driver's own contradiction check absent — the class of error that was delivered on the run behind.
//
// A HELPER RATHER THAN THREE FIXES, because three fixes leave the fourth entry free to repeat it. Stages
// that declare nothing compose "" and dispatch exactly as before.
const repairStage = (name) => (ctx) => {
  const { text } = composeDispatchExtra(name, ctx);
  return stage(name, ctx, { force: true, trigger: "stale-repair", ...(text ? { extra: text } : {}) });
};

export const UPSTREAM_STALE_REPAIR = {
  "register-digest": (ctx) => runDigest(ctx, { force: true, trigger: "stale-repair" }),
  // A-4 rides here: declaring plan-execution.json on stageInputs.skeptic is only safe once a stale
  // skeptic can be refreshed in place. Without this entry the declaration parks every reopen-shaped run.
  // — its `skeptic-deferral-extra` is passed on the FRESH dispatch and was dropped here.
  skeptic: repairStage("skeptic"),
  // review — THIS IS A COLD DISPATCH AND IT CARRIES THE BLOCKS. It re-authors narrative.md and
  // findings.json, the delivered opinion, and it renders `def.message(ctx)` in full; without the extra
  // the seat ruled over the coverage claim with the receipt and the ledger withheld, on a prompt that
  // told it both were tabulated below. The refutation's equivalent gap fails closed on verify.mjs's
  // `plan_audit_missing`; synthesis has no such validator, so it succeeded silently — measured.
  //
  // The original justification was that a repair must not carry a different prompt from the pass it
  // repairs. The measurement inverts it: the repair dispatch came out 3,017 bytes THINNER than the
  // fresh one, so composing the same blocks is what makes the two passes identical rather than what
  // makes them differ.
  //
  // THE LIST OF RECORDS IT MUST ANSWER IS RE-PREPARED FIRST, as the corrective pass re-prepares it. This
  // repair runs because an input moved, register-findings.md among them, and that file is what the list
  // is read from. Skipped, the repair was dispatched with no DECLINATIONS block at all, while the
  // recorder still held the seat to the list the fresh pass had written: the order missing from the
  // prompt, and enforced against records the digest may since have moved.
  synthesis: (ctx) => { prepareDeclinationSpec(ctx, ctx.paths); return repairStage("synthesis")(ctx); },
  // — composed NEITHER of its two declared blocks; see the dispatcher comment above.
  "narrative-refutation": repairStage("narrative-refutation"),
  // — placement declares register-named-band.json and the per-axis register-units/*.md, and the
  // escalation recheck, the skeptic escalation and the envelope close all rewrite those AFTER it. On a
  // resume where placement skips as LEGITIMATELY fresh (no kill involved — removed the wall route,
  // not the exposure) it joins ctx.skippedStages and therefore deliveryPathStages, one of those arms moves
  // its inputs, and the delivery precondition read it stale with no in-pass remedy. The run parked.
  //
  // Ruled to option 1. It costs ONE placement dispatch on affected resumes — 87k + 113k output tokens,
  // ~27 minutes for the second, and removing that dispatch is what was for, so this is a cost
  // decision rather than a mechanical fix. The other side is now measured: the same rule fired on a
  // different pair with no entry and cost 496,327 output tokens, 43 dispatches of which 33 were repeats,
  // and 1h29m — a third of that run's output and 29% of its wall clock. One targeted re-dispatch
  // to avoid re-deriving everything downstream is the cheaper side by a wide margin, and the safer one.
  //
  // settleOneShotStamp IS REFUSED HERE, and this is the part most likely to be got wrong in a hurry.
  // Blessing frame-diff's stamp is safe because nothing consumes the diff by the time the gate asks.
  // Placement is the opposite: placement.md and placements.json are declared inputs of register-digest,
  // synthesis and narrative-refutation, all of which run after the mutation. Blessing placement's stamp
  // would hide staleness from three live consumers — the exact thing the freshness gate exists to catch.
  // Same defect shape, opposite correct answer.
  //
  // A bare stage() is right here, unlike register-digest above: placement has no machine-ledger sibling a
  // re-run could leave outvoting its prose, and it is re-runnable by contract (no one-shot receipt — the
  // assertReceiptSettled call ahead of its normal dispatch settles the plan receipt, which is already
  // settled by the time the delivery gate asks).
  "placement-inquiry": async (ctx) => recordPlacementPass(ctx, await stage("placement-inquiry", ctx, { force: true, trigger: "stale-repair" }), "stale-repair"),
  // frame-diff is DELIBERATELY ABSENT and must stay absent. It is one-shot by contract (no in-process
  // re-diff), so an entry here would re-dispatch a stage the design says runs once, for a model call
  // that cannot change anything: nothing declares frame-diff's outputs as a stage input, so by the time
  // the delivery gate asks, every consumer of the diff — the reopen gate, runSupplementalSweeps, the
  // dominant-element clamp — has already run. Its answer to a sanctioned in-pass rewrite is
  // settleOneShotStamp above, not a re-run.
};

export const DELIVERY_TAIL_LABEL_RE = /^(report-overview|report-card:.+)$/;   // @internal
export function partitionDeliveryStale(staleStages) {   // @internal
  const tail = [], upstream = [];
  for (const s of staleStages ?? []) (DELIVERY_TAIL_LABEL_RE.test(String(s?.label ?? "")) ? tail : upstream).push(s);
  return { tail, upstream };
}

// A1 — driver-side freshness gate: after a corrective pass, verify the reviewer's named
// entities actually reached findings.json (the file every client surface renders from). Deterministic:
// proper-name candidates from the review ∩ the findings' marks/owner names = the named set; if the
// file is byte-unchanged (or every named finding's object is) and no corrections marker landed, fire
// ONE followup demanding the re-emit; a terminal miss NEVER withholds (never-withhold) — it logs,
// flags the internal review bar, and closes the CLIENT export via _driver/corrections-state.json.
export function snapshotFindingsForCorrections(P, runDir) {   // @internal
  let raw = null;
  try { raw = readFileSync(P.findings, "utf8"); } catch { /* legacy / not-yet-populated */ }
  if (raw == null) return null;
  const sha = createHash("sha256").update(raw).digest("hex");
  // THE RECORD IN THE MODEL'S NUMBERING, beside the one on disk. The review's flags name findings in the
  // model's numbering, so the corrective body compares the record the model wrote; once the delivered
  // record is folded the two differ (record-fold.mjs). The fold is held too, for a rollback to put back,
  // and so are narrative.md and the transport's merge base (`base`): a rollback that put back findings.json
  // alone left the next patch to merge onto the failed pass's record.
  const modelAt = modelRecordPath(runDir, P.findings);
  let modelRaw = raw;
  if (modelAt !== P.findings) { try { modelRaw = readFileSync(modelAt, "utf8"); } catch { modelRaw = raw; } }
  const model = { raw: modelRaw, sha: modelRaw === raw ? sha : createHash("sha256").update(modelRaw).digest("hex") };
  const fold = snapshotFold(runDir);
  try {
    const tmp = paths(runDir).findingsPreCorrectiveJson;
    // PR-4 (snapshot-before-overwrite): store the FULL pre-corrective text, not just its sha — a
    // sha proves the file changed but cannot show WHAT the corrective pass changed; that run's
    // pre-corrective findings were unrecoverable for exactly this reason. Findings are small (KBs);
    // the audit value of the diff dwarfs the bytes.
    writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), sha, text: raw }, null, 2));
    renameSync(tmp, paths(runDir).findingsPreCorrective);
  } catch { /* advisory sidecar */ }
  return { raw, sha, model, fold, base: snapshotSynthesisBase(runDir) };
}
/**
 * THE REPAIR'S RUN-LOG ROW, built from what `repairUnnamedRemovals` returned. PURE.
 *
 * `base` says what the merge base took, in the words the basis derivation's row uses for the same edit:
 * `restored`, or `unchanged` where the base already held what came back; `refused` where the acceptance boundary
 * refused the edit and the base was left as it was, so the next accepted patch drops the restore again; and
 * `no-base` where the run holds no base, so a later patch is refused for having none. The sidecar keeps the reason.
 */
export function removalRepairedRow(repaired) {   // @internal
  const b = repaired?.base;
  const base = !b ? null : b.ok ? (b.changed ? "restored" : "unchanged") : /^no_base:/.test(String(b.reason)) ? "no-base" : "refused";
  return { event: "corrective-unnamed-removal-repaired", defect: true,
    restored: repaired.restoredFindings.length, keys: repaired.restoredKeys.length,
    rows: repaired.restoredRows.length,
    leftRemoved: repaired.leftRemoved.length,
    findings: repaired.restoredFindings.map((f) => `${f.ordinal}:${f.mark}`), ...(base ? { base } : {}) };
}

/**
 * The ordinals the reviewer's flags name, from the typed call where the run has one and the rendered
 * parse where it does not — the same two sources, in the same order, that `correctionsExtra` uses to
 * build the worklist. A flag with no `on` names no ordinal and is matched by MARK instead.
 */
/**
 * WHAT THE DRIVER PUT BACK, for the reviewer's re-read.
 *
 * Every other row in the findings document is the seat's judgment. A restored row is not: the corrective
 * pass removed it with no flag naming it, and the driver put it back whole from the pre-corrective
 * snapshot. A reviewer that cannot tell those apart weighs a driver-restored finding as the author's
 * corrected judgment — the one reading that would make the repair worse than the loss it fixes.
 *
 * "" WHEN NOTHING WAS RESTORED, which is every ordinary run: `lines()` drops an empty string, so the
 * dispatch is byte-identical to the one before this existed unless the repair actually fired.
 */
export function restoredFindingsTable(repair) {   // @internal
  const rows = repair?.restoredFindings ?? [];
  // A RESTORED ROW IS THE DRIVER'S DOING TOO, and this read only findings — so a coverage note or an
  // action the driver put back reached the reviewer as the pass's own work, which is the one reading
  // this section exists to prevent. Same repair, same snapshot, same sentence (found in review).
  const lines = repair?.restoredRows ?? [];
  if (!rows.length && !lines.length) return "";
  if (!rows.length) return [
    "RESTORED BY THE DRIVER, NOT BY THE AUTHOR — read these before anything else.",
    "The corrective pass removed the line(s) below and no flag of yours named them, so the driver put them",
    "back exactly as you last read them. They carry NONE of this round's corrections, and they are not the",
    "author's judgment about anything. If a removal here was in fact right, say so in your review and name",
    "the ground — that is the statement the pass failed to make.",
    "",
    ...lines.map((l) => `  ${l.label} — restored: removed by the corrective pass with no flag naming it`),
    "",
    "These lines MOVED, whatever the scope note above says about what did not.",
  ].join("\n");
  return [
    "RESTORED BY THE DRIVER, NOT BY THE AUTHOR — read these before anything else.",
    "The corrective pass removed the finding(s) below and no flag of yours named them, so the driver put",
    "them back exactly as you last read them. They carry NONE of this round's corrections, and they are",
    "not the author's judgment about anything. If a removal here was in fact right, say so in your review",
    "and name the ground — that is the statement the pass failed to make.",
    "",
    ...rows.map((f) => `  #${f.ordinal} ${f.mark} — restored: removed by the corrective pass with no flag naming it`),
    ...lines.map((l) => `  ${l.label} — restored: removed by the corrective pass with no flag naming it`),
    "",
    "These rows MOVED, whatever the scope note above says about findings that did not.",
  ].join("\n");
}

// ── THE REVIEW AFTER A DELIVERY-CHECK REPAIR, AND ITS ONE CORRECTION ─────────────────────────────────────
//
// When the delivery check finds a fault in the narrative, the writer repairs its record and the narrative's
// bytes move, so the reviewer reads stale. It used to be sent the whole review again, cold, and nothing applied
// what it flagged then. Now, where the scope can be established, it reads what the repair changed and every
// statement resting on it, worked out by value from the writer's record before and after the repair
// (repair-scope.mjs), and its flags go to ONE correction by the writer that nothing reviews again.
//
// THE FIRST REVIEW STAYS WHOLE, and so does this one whenever the scope is not certain: no record kept from
// before the repair, another of the reviewer's inputs moved, a whole re-synthesis ran in this pass, or the
// record's version or framework changed. A rewrite with the same values is no change and no review runs.

/** Which review the reviewer's staleness after a delivery-check repair calls for. Reads the run; never throws. */
/**
 * A SAVE TRIED AGAIN BEFORE IT IS GIVEN UP. Calls `save` up to `attempts` times, waiting `waitMs` between tries, and
 * says how it went: `{ ok, attempts, error }`. Never throws. `wait` is injectable so a test does not sleep.
 */
export function saveWithRetries(save, { attempts = 3, waitMs = 250, wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {   // @internal — driven by its test
  let error = null;
  for (let n = 1; n <= attempts; n++) {
    try { save(); return { ok: true, attempts: n, error }; }
    catch (e) { error = e; if (n < attempts) wait(waitMs); }
  }
  return { ok: false, attempts, error };
}

/**
 * THE STAGES STALE ON WHAT PLACEMENT WROTE, which join the chain of a changed decision whoever moved it: the delivery
 * check's own repeat, the decisions written again when the shape is derived again, or a late pass whose readers had
 * already run. `names` are the base names of placement's files. PURE.
 */
export function stagesStaleOnPlacement(stale = [], names = new Set()) {   // @internal — driven by its test
  return stale.filter((x) => (x?.changed ?? []).some((c) => names.has(String(c?.name ?? "")))).map((x) => x.label);
}

/**
 * A CLAUSE JUDGED AGAIN REPLACES THE ONE IT REPEATS, BY ITS KIND. Withdraws every entry whose reason opens with
 * `<token>:` from the index-aligned reasons and clauses, and a withdrawn clause from the guard set once no entry left
 * carries it. Returns the arrays as they now stand and how many entries went. PURE.
 */
export function withdrawByToken(reasons = [], clauses = [], guard = new Set(), token) {   // @internal — driven by its test
  const keep = reasons.map((r) => !String(r ?? "").startsWith(`${token}:`));
  const out = { reasons: reasons.filter((_, i) => keep[i]), clauses: clauses.filter((_, i) => keep[i]), withdrawn: keep.filter((k) => !k).length };
  for (const [i, c] of clauses.entries()) if (!keep[i] && !out.clauses.includes(c)) guard.delete(c);
  return out;
}

/**
 * IS THE RECORD'S ACTIONS REGISTER A LIST? The one positive sign that a record holding no forward legal step has
 * withdrawn them, rather than lost them: an unreadable record, a missing register and one that is not a list are not a
 * withdrawal. Entries dropped as unreadable are the caller's to weigh. PURE.
 */
export function actionsRegisterListed(raw) {   // @internal — driven by its test
  try { return Array.isArray(JSON.parse(String(raw ?? ""))?.actions); } catch { return false; }
}

/**
 * WHAT A REPAIR IN THE DELIVERY CHECK LEFT STALE, AND WHAT OF IT IS QUEUED. A stage is this repair's when it is stale now
 * and was not before the repair, or is stale on an input that has moved since; a stage stale before for the same reasons
 * is not, and stays the guard's. Every stage the repair left stale joins the chain, so its own re-run is followed in turn.
 * Of those, a stage already queued ahead runs where it stands, and one this pass already re-did is re-done once more at
 * most. PURE.
 */
export function whatTheRepairLeftStale({ before = [], after = [], repaired, ahead = new Set(), processed = new Set(), requeued = new Set() }) {   // @internal — driven by its test
  const keys = (x) => (x?.changed ?? []).map((c) => `${c?.name}@${c?.now}`);
  const was = new Map(before.map((x) => [x.label, new Set(keys(x))]));
  const chain = [], queue = [], requeue = [];
  for (const x of after) {
    if (x.label === repaired) continue;
    const prior = was.get(x.label);
    if (prior && keys(x).every((k) => prior.has(k))) continue;   // stale before, for the same reasons: not this repair's
    chain.push(x.label);
    if (ahead.has(x.label)) continue;
    if (processed.has(x.label)) { if (requeued.has(x.label)) continue; requeue.push(x.label); }
    queue.push(x);
  }
  return { chain, queue, requeue };
}

export function postRepairScope(runDir, P, s2, { staleRepaired = [], baseKept = false } = {}) {   // @internal
  if (!baseKept) return { mode: "whole", why: "no-repair-base" };
  const narrative = basename(String(P?.narrative ?? "narrative.md"));
  const moved = (s2?.changed ?? []).filter((c) => c?.via !== "repair-record" && basename(String(c?.name ?? "")) !== narrative);
  if (moved.length) return { mode: "whole", why: "another-input-moved", moved: moved.map((c) => String(c?.name ?? "")) };
  if (staleRepaired.includes("synthesis")) return { mode: "whole", why: "re-synthesised" };
  // Any other step this loop re-ran ahead of the reviewer (the digest, placement, the skeptic) moved what the review
  // stands on beyond the repair's own change, so the scope the queue captured no longer says what changed.
  const upstream = staleRepaired.filter((l) => l !== "narrative-refutation" && !/^report-(overview|card:)/.test(l));
  if (upstream.length) return { mode: "whole", why: "upstream-re-run", upstream };
  let before = null, after = null;
  try { before = readRepairBase(runDir); after = lastAcceptedCall(runDir); } catch { /* read as no base */ }
  const changed = changedContent(before, after);
  if (changed.whole) return { mode: "whole", why: changed.why };
  if (isEmptyChange(changed)) return { mode: "none", why: "repair-changed-no-content" };
  return { mode: "narrowed", changed, after, findingOnly: queuedForTheRecordOnly(s2) };
}

/**
 * Whether the delivery-check repair's change to the findings record is owed a review when the narrative did not move:
 * any change but the same values saved again. A change the scope cannot narrow (a moved version or framework, or a
 * record that could not be compared) is owed one too, and the loop gives it the whole review. Never throws.
 */
export function recordChangeOwesReview(runDir) {   // @internal
  let c = null;
  try { c = changedContent(readRepairBase(runDir), lastAcceptedCall(runDir)); } catch { c = null; }
  return !isEmptyChange(c);
}

/**
 * An open ask as the closure step is shown it: its id, where it was raised and its text, and for a request kept as
 * parts, which part it is and the questions that part holds, so two parts of one request never read as one line.
 */
export function openAskForClosure(a) {   // @internal — driven by its test
  return { ask_id: a.ask_id, born: a.born, ask: a.ask,
    ...(a.part ? { part: a.part, qids: Array.isArray(a.qids) ? a.qids : [] } : {}), ...(a.family ? { family: a.family } : {}) };
}

/** The change a whole review's record lists when its scope could not be compared: none. */
export const NO_CHANGE = Object.freeze({ findings: [], lines: [], registers: [], sections: [], whole: true, why: "not-compared" });

/** Whether the reviewer was queued for a change to the findings record only: its narrative did not move. */
export function queuedForTheRecordOnly(s2) {
  const changed = s2?.changed ?? [];
  return changed.length > 0 && changed.every((c) => c?.via === "repair-record");
}

/** What the record of an unread review says its change was: findings only, or more. null with no unread record. */
export function unreadRecordFindingOnly(runDir) {
  try {
    const r = JSON.parse(readFileSync(postRepairRecordPath(runDir), "utf8"));
    return r?.status === "unread" && typeof r.findingOnly === "boolean" ? r.findingOnly : null;
  } catch { return null; }
}

/**
 * A review after a repair that could not be read, ON RECORD. Its change went unreviewed, and the reviewer's own stamp
 * cannot be trusted to say so: a findings-only change does not move the files the reviewer declares, and a stage
 * that ends with no accepted call still reads ok whenever the earlier review's file stands, so its stamp is
 * refreshed over the repaired narrative. This record is never handed to the delivery guard: a run is not held on an
 * unread review (owner's ruling, 2026-10-19), and such a run delivers as the released engine delivers it. The one
 * boundary is the released engine's own: a reviewer whose re-run fails outright leaves its stamp stale on a changed
 * narrative, and the freshness guard decides that, as it always has. The record keeps what went unreviewed, and a
 * resume for any other cause reviews that change whole, until a review that is read replaces the record.
 */
export function unreadRecordReview(runDir) {   // @internal
  try { return JSON.parse(readFileSync(postRepairRecordPath(runDir), "utf8"))?.status === "unread"; }
  catch { return false; }
}

export const reviewBeforeRepairPath = (runDir) => paths(runDir).reviewBeforeRepair;
export const reviewAfterRepairPath = (runDir) => paths(runDir).reviewAfterRepair;
export const postRepairCorrectionsPath = (runDir) => paths(runDir).postRepairCorrections;
const scopeRecord = (scope, items) => ({
  findingOnly: Boolean(scope.findingOnly),
  changed: { findings: scope.changed.findings.map((f) => ({ ordinal: f.ordinal, change: f.change, fields: f.fields })),
    lines: scope.changed.lines.map((l) => ({ area: l.area, change: l.change })),
    sections: scope.changed.sections.map((x) => x.title), registers: scope.changed.registers.map((r) => r.label) },
  items: items.map((i) => ({ kind: i.kind, role: i.role, label: i.label, ...(i.delivered != null ? { delivered: i.delivered } : {}) })),
});

/**
 * The narrowed review. Keeps the whole review aside first, so whatever this one writes, the run can put the
 * whole review back: `senior-eye-review.md` holds the review whose verdict the run carries, and the caller
 * decides that after the late-verdict rule. Returns `{reviewed: false}` when no accepted review came back —
 * the label then stays stale and the delivery guard decides, as for a whole review that failed.
 */
export async function runPostRepairReview(ctx, P, run, scope) {
  const runDir = run.runDir;
  const kept = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : null;
  if (kept != null) atomicWrite(reviewBeforeRepairPath(runDir), kept);
  const putBack = () => {
    if (kept == null) return;
    let now = null;
    try { now = readFileSync(P.seniorEyeReview, "utf8"); } catch { now = null; }
    if (now !== kept) atomicWrite(P.seniorEyeReview, kept);
  };
  const seq0 = nextRefutationSeq(runDir);
  const fold = readFold(runDir);
  const resting = restingOn(scope.changed, scope.after);
  const items = scopeItems(scope.changed, resting, fold?.map);
  const list = listForReview(scope.changed, resting, fold?.map);
  const changedInputs = changedInputsOf(scope.changed, { narrative: P.narrative, findings: P.findings });
  const message = repairFollowup("narrative-refutation:post-repair-review", {
    findings: P.findings, ...list, registerOnly: Boolean(ctx.registerOnly), job: ctx.job ?? {},
    skepticFlags: P.skepticFlags, frameReopenReceipt: P.frameReopenReceipt, floorDecisions: placementFloorDecisionLines(P),
    writerExclusions: writerExclusionBlock(P, { review: "later" }),
    // The record after the repair, and each changed finding by its ordinal, so a finding the repair removed is nameable.
    reviewAddresses: writeReviewAddresses(runDir, { records: [scope.after?.findings, { findings: scope.changed.findings }],
      narratives: [scope.after?.narrative], seq0 }),
  });
  const { text: blocks } = composeDispatchExtra("narrative-refutation", ctx, { skip: ["refute-plain-register"] });
  const t0 = Date.now();
  const r = await stage("narrative-refutation", ctx, {
    force: true, trigger: "post-repair-review", freshMessage: message, ...(blocks ? { extra: blocks } : {}), changedInputs,
  });
  const rec = r?.ok ? readAcceptedReviewSince(runDir, seq0) : null;
  const base = { seq0, ...scopeRecord(scope, items), changedInputs: changedInputs.map((x) => basename(String(x))), ms: Date.now() - t0 };
  if (!rec) {
    // NOT A PASS: no review the driver can act on came back. The whole review goes back in place, the record
    // says the review could not be read, and the label stays stale for the delivery guard.
    putBack();
    writePostRepairRecord(runDir, { status: "unread", ...base, fail: r?.ok ? "no-accepted-call" : String(r?.fail ?? "failed") });
    runLog(runDir, { event: "post-repair-review", read: false, fail: r?.ok ? "no-accepted-call" : String(r?.fail ?? "failed").slice(0, 120) });
    note(`[post-repair] the review after the delivery-check repair could not be read back — the whole review stays in place and the delivery guard decides`);
    return { reviewed: false };
  }
  const reviewText = readFileSync(P.seniorEyeReview, "utf8");
  atomicWrite(reviewAfterRepairPath(runDir), reviewText);
  const points = classifyPoints(rec.flags, items);
  const by = points.reduce((a, x) => ((a[x.class] = (a[x.class] ?? 0) + 1), a), {});
  writePostRepairRecord(runDir, { status: "read", ...base, verdict: rec.verdict, seq: rec.seq,
    points: points.map((x) => ({ n: x.n, kind: x.kind, on: x.on, target: x.target.label, class: x.class, text: String(rec.flags[x.n - 1]?.text ?? "") })) });
  runLog(runDir, { event: "post-repair-review", read: true, verdict: rec.verdict, flags: rec.flags.length, classes: by,
    changed: { findings: scope.changed.findings.length, lines: scope.changed.lines.length, sections: scope.changed.sections.length, registers: scope.changed.registers.length },
    findingOnly: Boolean(scope.findingOnly), ms: base.ms });
  return { reviewed: true, rec, reviewText, items, points, putBack, base };
}

/**
 * THE WHOLE REVIEW OF A REPAIR'S CHANGE: when the narrowed one could not be read, and when the change cannot be
 * narrowed at all (a change to the record the scope cannot compare, or one an earlier review could not read, as on
 * a resume). It returns what runPostRepairReview returns, so its points go to the same one correction; adopting its
 * verdict alone would leave its flags unapplied. When it cannot be read, the record says the change was not reviewed
 * (`unreadRecordReview`). No unread review is a pass, and the record never holds the run; a re-run that failed outright
 * leaves the reviewer's stamp as the released engine leaves it, for the freshness guard. `rerun`
 * is the reviewer's own stale-repair arm.
 */
export async function runWholeReviewForRecord(ctx, P, run, scope, rerun) {
  const runDir = run.runDir;
  const seq0 = nextRefutationSeq(runDir);
  const t0 = Date.now();
  const r = await rerun();
  const rec = r?.ok ? readAcceptedReviewSince(runDir, seq0) : null;
  const fold = readFold(runDir);
  const items = scopeItems(scope.changed, restingOn(scope.changed, scope.after), fold?.map);
  const base = { seq0, ...scopeRecord(scope, items), whole: true, ms: Date.now() - t0 };
  if (!rec) {
    const fail = r?.ok ? "no-accepted-call" : String(r?.fail ?? "failed");
    writePostRepairRecord(runDir, { status: "unread", ...base, fail });
    runLog(runDir, { event: "post-repair-review", read: false, whole: true, fail: fail.slice(0, 120) });
    note(`[post-repair] neither review of what the repair changed could be read back — it was not reviewed, and the run's record says so; ${r?.ok ? "the run delivers" : "the reviewer's re-run failed, so its stamp stays as it was and the freshness guard decides, as in the released engine"}`);
    return { reviewed: false };
  }
  const reviewText = readFileSync(P.seniorEyeReview, "utf8");
  atomicWrite(reviewAfterRepairPath(runDir), reviewText);
  const points = classifyPoints(rec.flags, items);
  writePostRepairRecord(runDir, { status: "read", ...base, verdict: rec.verdict, seq: rec.seq,
    points: points.map((x) => ({ n: x.n, kind: x.kind, on: x.on, target: x.target.label, class: x.class, text: String(rec.flags[x.n - 1]?.text ?? "") })) });
  runLog(runDir, { event: "post-repair-review", read: true, whole: true, verdict: rec.verdict, flags: rec.flags.length, ms: base.ms });
  return { reviewed: true, rec, reviewText, items, points, putBack: () => {}, base };
}

/** Where the state the review after a repair reads is kept whole, before the review and its correction run. */
export const postRepairStatePath = (runDir) => paths(runDir).postRepairState;

/**
 * THE STATE THE REVIEW AFTER A REPAIR READS, KEPT WHOLE before the review and its correction can lose any of it: the
 * findings record, its narrative, the merge base the next patch builds on, and the fold, in one file under `_driver/`,
 * so the four are kept together or not at all. Where a part cannot be read, no state is kept, and an earlier one is
 * removed so that it never stands for this review. Returns whether a state was kept. Never throws.
 */
export function retainStateBeforeReview(runDir, P) {
  try {
    const findings = readFileSync(P.findings, "utf8");
    const base = snapshotSynthesisBase(runDir);
    if (base.accepted == null || base.narrative == null) throw new Error("a part of the state could not be read");
    atomicWrite(postRepairStatePath(runDir), JSON.stringify({ ts: new Date().toISOString(), findings, narrative: base.narrative,
      accepted: base.accepted, fold: snapshotFold(runDir) }) + "\n");
    return true;
  } catch (e) {
    try { rmSync(postRepairStatePath(runDir), { force: true }); } catch { /* nothing to remove */ }
    runLog(runDir, { event: "post-repair-state-not-kept", reason: String(e?.message ?? e).slice(0, 160) });
    return false;
  }
}

/**
 * THE LAST RECORD A SAVE PASSED, rebuilt through the driver's own acceptance: the save the review read (`before`), then
 * the save kept from before the delivery-check repair (sources 3 and 4 of `trustedStateBeforeCorrection`, with the
 * same duty rule). Null when neither stands. Never throws.
 */
export function recordFromTheSaves(Pv, runDir, before) {
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  const reads = (() => { try { return driverReadsFor(runDir); } catch { return null; } })();
  const fromSave = (params, accepted, from) => {
    if (!params || accepted == null || !reads) return null;
    const accept = (r) => { try { return acceptSynthesis(params, r); } catch { return null; } };
    let v = accept(reads), duty = "current", refused = null;
    if (!v?.ok && reads.owed != null) {
      refused = v?.reason ?? null;
      const w = accept({ ...reads, owed: null, declined: null });
      if (w?.ok) { v = w; duty = "relaxed"; }
    }
    if (!v?.ok || typeof v.findings !== "string" || typeof v.narrative !== "string") return null;
    const h = sha(v.findings);
    return { raw: v.findings, sha: h, model: { raw: v.findings, sha: h }, fold: null, base: { accepted, narrative: v.narrative }, from, duty,
      ...(duty === "relaxed" ? { refusedUnderCurrentDuty: String(refused ?? "").slice(0, 160) } : {}) };
  };
  const bytes = (at) => { try { return readFileSync(at, "utf8"); } catch { return null; } };
  return fromSave(before, snapshotSynthesisBase(runDir).accepted, "accepted-save")
    ?? fromSave(readRepairBase(runDir), bytes(repairBasePath(runDir)), "save-before-the-repair");
}

/**
 * A FINDINGS RECORD BROKEN AFTER SYNTHESIS PASSED IT IS RESTORED AT DELIVERY, NOT ENDED ON. The delivery checks
 * find the record broken at the top level, so a write after synthesis broke it. The record comes back from the
 * last save that passed, by the corrective rollback's own search (`recordFromTheSaves`): the save the review read, then
 * the save kept from before the delivery-check repair. It is folded, and given the seam's writes, as after any save, and
 * the check runs again on the record that now stands. The broken record is kept under `_driver/` as evidence. Returns
 * {from, duty}, or null where no save stands or the record restored fails the check too. IMPURE (writes the run).
 */
export async function restoreTheRecordThatPassed(ctx, P, runDir, check) {
  const pre = recordFromTheSaves(P, runDir, lastAcceptedCall(runDir));
  if (!pre?.raw) return null;
  try { copyFileSync(P.findings, paths(runDir).findingsBrokenAtDelivery); } catch { /* the evidence is best-effort */ }
  writeFindings(runDir, pre.raw, { why: "record-that-passed-restored", settles: [] });
  restoreSynthesisBase(runDir, pre.base);
  try { foldAfterSave(runDir, P.findings); } catch (e) { note(`[core-artifact] the restored record could not be folded (${String(e?.message ?? e).slice(0, 100)})`); }
  try { await ctx.afterSynthesisSave?.(); } catch (e) { note(`[core-artifact] the seam's writes could not be made again over the restored record (${String(e?.message ?? e).slice(0, 100)})`); }
  try { check(readFileSync(P.findings, "utf8")); } catch { return null; }
  return { from: pre.from, duty: pre.duty ?? "current" };
}

// A correction row's outcomes that say the pass changed the record or the narrative (corrections-feedforward.mjs).
const CORRECTION_CHANGED = new Set(["section-changed", "line-removed", "line-changed", "findings-removed", "findings-changed"]);

/**
 * THE CORRECTIONS A RECORD RESTORED FROM THE SAVE BEFORE THE REPAIR DOES NOT CARRY: what the correction after the review
 * of that repair changed, by the names its points targeted. The corrections' state is judged once, when the correction
 * runs, so nothing else would see that the restored record predates it. Written as that state, the client gate's
 * "findings-stale" reason closes the client export over it, as when a correction did not reach the findings. [] when
 * the record came from the accepted save, or no correction after the repair changed anything. Never throws.
 */
export function correctionsTheRestoreLacks(runDir, from) {   // @internal
  if (from !== "save-before-the-repair") return [];
  try {
    const rec = JSON.parse(readFileSync(postRepairCorrectionsPath(runDir), "utf8"));
    const named = (r) => (Array.isArray(r.targets) && r.targets.length ? r.targets : [(rec.classes ?? []).find((c) => c?.n === r.n)?.target]);
    return [...new Set((rec.rows ?? []).filter((r) => CORRECTION_CHANGED.has(r?.outcome)).flatMap(named)
      .map((t) => String(t ?? "").trim()).filter(Boolean))];
  } catch { return []; }
}

// ── WHETHER EACH REVIEWER CORRECTION REACHED THE RECORD THE REPORT WAS BUILT FROM ───────────────────────
//
// The corrective pass keeps a basis — what each flag changed in the fields a report prints from the record —
// in `_driver/corrections-delivered.json`, and every assembly reads it against the record the report was
// built from and writes the outcome beside it (corrections-delivered.mjs). The last assembly's answer stands.
// corrections-applied.json, which the open points and the verdict re-check read, is not touched.
export const CORRECTIONS_DELIVERED_FILE = "corrections-delivered.json";
// Whether the recheck after the correction saved an accepted review (`read`) or not (`unread`, with why), with the
// entry verdict and the verdict that stood. An unread recheck is a correction nobody verified.
export const CORRECTIVE_RECHECK_FILE = "corrective-recheck.json";
