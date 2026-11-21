// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// placement-pass-record.mjs — what one placement pass did, recorded: the ground each band record was left with, the
// floors the pass answered, and the band records it read.
//
// Moved out of pipeline.mjs unchanged, so that the steps import it instead of having it handed in.
import { ensureDriverDir } from "../shared/driver-dir.mjs";
import { armFloorDuty, FLOOR_DUTY_SCHEMA_VERSION, floorDutyEvent } from "./floor-duty.mjs";
import { readGoodsEvidence } from "./goods-evidence.mjs";
import { note, runLog } from "./log.mjs";
import { placedUriRows, placementSetAsideGrounds, standingSetAside, writePlacementDecisions } from "./placement-decisions.mjs";
import { readPlacementForm, readPlacementFormInput } from "./placement-form-io.mjs";
import { buildSelectionIndex, ownerFates, servedLines } from "./placement-form.mjs";
import { recordSeamDiscards } from "./record-carry-trace.mjs";
import { bandRecordUri } from "./record-carry.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { atomicWrite } from "./run-record.mjs";
import { floorDutyNow, safeReadJson } from "./stage-dispatch.mjs";
import { paths } from "./stages.mjs";

// ── — THE FLOOR DUTY, checked ────────────────────────────────────────────────────────────────
//
// The floors are placement-inquiry's one uncapped obligation and nothing verified them. The ruling
// of 2026-08-20 made the duty machine-checkable — placed, or named by record id with a one-line ground —
// and this is the check that ruling ordered. The dictation that tells the seat to name the ids ships in
// the same commit, so a run predating it reports its WHOLE floor unmet, correctly.
//
// SAME POSTURE AS placement-carry: disclosure only. It re-tiers nothing, gates nothing and sends no
// followup. `computable:false` carries its reason and NO counts — a zero would read as "every floor
// accounted for", which is the opposite of "the band could not be read".
export function deriveFloorDuty(ctx, r, trigger = null) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  const write = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      atomicWrite(P.floorDuty, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`floor-duty artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  const notComputable = (reason) => {
    write({ schema_version: FLOOR_DUTY_SCHEMA_VERSION, computable: false, reason });
    runLog(P.runDir, floorDutyEvent({ trigger, reason }));
    return null;
  };
  try {
    const now = floorDutyNow(P);
    if (now.reason) return notComputable(now.reason);
    const { artifact, placements } = now;
    const fates = placementOwnerFates(P, placements);
    artifact.owners = fates.counted ?? null;
    if (!fates.counted) artifact.owners_absent = fates.absent;   // no count, and why: no groups, or an input that would not read
    // The pass's own outcome, beside the rows. That lesson: a stage that failed or skipped makes every
    // record it did not reach an UPSTREAM ABSENCE, not a judgment, and a reader blaming the seat for a
    // crash is reading the artifact wrong.
    artifact.pass = { ok: r?.ok === true, skipped: r?.skipped === true };
    write(artifact);
    runLog(P.runDir, floorDutyEvent({ trigger, artifact }));
    const t = artifact.totals;
    const undischarged = t.unanswered + t.named_without_ground;
    if (undischarged) {
      note(`floor duty: ${undischarged} of ${t.floors} floor row(s) did not come back on the placement form`
        + `${t.named_without_ground ? ` (${t.named_without_ground} named with no ground)` : ""}`
        + " — every floor is a live in-class identical or near-identical record and the duty is uncapped;"
        + " this records the gap and re-tiers nothing");
    }
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "floor-duty-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`floor-duty derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

/** The band the placement seam saw, as `{uri}` rows. Cheap and tolerant: an unreadable band records nothing. */
function bandUriRows(P) {
  try {
    const band = safeReadJson(P.registerNamedBand);
    const enumerated = Array.isArray(band?.enumerated) ? band.enumerated : [];
    return enumerated.map((r) => ({ uri: bandRecordUri(r) })).filter((r) => r.uri);
  } catch { return []; }
}

/**
 * PLACEMENT. Everything in the band was in front of this pass; what it placed is in placements.json.
 * Recorded whether the pass completed or not — an incomplete pass discards nothing, and its rows say so
 * with `placement:stage-incomplete`, which is the ruling on the 澜珀 run made structural.
 */
function recordPlacementSeam(ctx, r, trigger = null) {
  const P = ctx.paths;
  const saw = bandUriRows(P);
  if (!saw.length) return null;
  return recordSeamDiscards(ctx, {
    seam: "placement", stage: "placement-inquiry", trigger, completed: r?.ok === true && !r?.skipped, skipped: r?.skipped === true,
    saw, carried: placedUriRows(P),
    evidence: r?.skipped ? "the pass was SKIPPED on an artifact already on disk, so it made no decision this pass" : (r?.fail ? String(r.fail).slice(0, 80) : ""),
    reasonFor: placementSeamReason(placementSetAsideGrounds(P)),
  });
}

/**
 * WHAT ONE PLACEMENT PASS DID, RECORDED: the ground every band record left it with (the seam rows) and the floors
 * it answered (the floor duty). The main path and the delivery gate's repeat of the stage both record through
 * here, so the ledger and the floor duty describe the placements the report is built from. Returns the pass
 * result.
 *
 * THE STAMP IS THE MAIN PATH'S. On the main path, a pass that actually ran arms the floor its account may be held
 * to. A SKIPPED pass leaves `placements.json` written by an earlier seat (on a resume, possibly one that never saw
 * the floors order), so it arms nothing, and its seam rows leave the earlier pass's grounds standing. The delivery
 * gate's repeat (`stale-repair`) arms nothing either: the floor it is held to is the one the run was already held
 * to, applied again to the repeated pass's account where the gate rebuilds the report from it. A run whose only
 * pass under the floors order is that repeat is held to no floor, as before.
 */
export function recordPlacementPass(ctx, r, trigger = null) {   // @internal — driven by its test with a run's own files
  recordPlacementSeam(ctx, r, trigger);
  deriveFloorDuty(ctx, r, trigger);
  // The decisions as they stand after this pass, where the reading step and the writer declare them: a pass that
  // changes only a set-aside's ground or a group's membership leaves a reader that already ran stale.
  try { writePlacementDecisions(ctx.paths); }
  catch (e) { runLog(ctx.paths.runDir, { event: "placement-decisions-failed", trigger, reason: String(e?.message ?? e).slice(0, 120) }); }
  if (r?.ok === true && r?.skipped !== true) recordPlacementBandIds(ctx.paths);
  if (r?.ok === true && r?.skipped !== true && trigger !== "stale-repair") armFloorDuty(ctx.paths.runDir);
  return r;
}

export const bandRecordIds = (band) => [...new Set((band?.enumerated ?? []).map((r) => String(r?.record_id ?? "").toLowerCase()).filter(Boolean))];

/** The named band's record ids a placement pass that ran read, so a record the band gains after it is known as new. */
function recordPlacementBandIds(P) {
  try {
    const ids = bandRecordIds(safeReadJson(P.registerNamedBand)).sort();
    atomicWrite(paths(P.runDir).placementBandIds, JSON.stringify({ count: ids.length, ids }) + "\n");
  } catch (e) { runLog(P.runDir, { event: "placement-band-ids-failed", reason: String(e?.message ?? e).slice(0, 120) }); }
}

/**
 * Every owner's fate at placement, by the shape's lists (placement-form.mjs `ownerFates`): `{counted}`, or `{absent}`
 * saying why there is no count. A shape with no groups has nothing to count by; an input that would not read is a
 * gap in the record. The two are not one fact, and the floor duty's artifact keeps them apart.
 */
export function placementOwnerFates(P, placements) {   // @internal — driven by its test with a run's own files
  try {
    const input = readPlacementFormInput(P.runDir);
    if (!input.groups) return { absent: "the band shape lists no groups" };
    const index = buildSelectionIndex(input);
    // What placement read, by its own reading log, and what each line's goods rest on, where the run recorded it.
    const evidence = readGoodsEvidence(P.runDir);
    const stateOf = Array.isArray(evidence?.records) ? new Map(evidence.records.map((r) => [normalizeRecordUri(r?.uri), r?.state])) : null;
    const placedUris = (Array.isArray(placements) ? placements : []).flatMap((p) => (Array.isArray(p?.records) ? p.records : []));
    const held = readPlacementForm(P.runDir);
    const counted = ownerFates({ groups: input.groups, entries: standingSetAside(held.set_aside, input, { placedUris, rows: held.rows }), index,
      placedUris,
      served: servedLines(input.groups, input.served, index),
      lineEvidence: stateOf ? (l) => stateOf.get(normalizeRecordUri(l?.record_id)) ?? null : null });
    return counted ? { counted } : { absent: "the band shape's groups could not be counted" };
  } catch (e) { return { absent: `an input could not be read: ${String(e?.message ?? e).slice(0, 120)}` }; }
}

/**
 * WHY A RECORD THE PICKING STEP DID NOT PLACE LEFT IT. Where the step set aside that owner's records as a
 * set, the record leaves with the step's own ground (sentence 6, ruled 2026-09-25). Otherwise the step
 * completed and said nothing about it, which is what the reason-less exit count reports. PURE.
 */
export function placementSeamReason(groundOf) {   // @internal
  return (_rec, uri) => {
    const g = typeof groundOf === "function" ? groundOf(uri) : null;
    if (g) return { reason: "placement:set-aside", reason_source: "step-stated",
      detail: g.by === "group" ? `placement-inquiry set aside this owner's records with group ${g.group}: ${g.ground}`
        : `placement-inquiry set aside this owner's records as a set: ${g.ground}` };
    return { reason: "placement:not-selected", reason_source: "step-silent",
      detail: "placement-inquiry completed this pass and named no placement for this record; the decision not to carry it was made and no ground for this record was recorded" };
  };
}
