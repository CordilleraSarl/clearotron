// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// floor-duty.mjs — did every floor row come back on the placement form?
//
// THE FLOORS are the one unconditional obligation in placement-inquiry's doctrine: every live in-class
// identical/near-identical record, listed individually, never capped. `band-shape.mjs` says so in its own
// comments — "the floors are mechanical obligations a lawyer must answer row by row", and "floors are
// NEVER capped" — and SKILL.md orders them placed with no precondition and no exception.
//
// Nothing checked it. Measured on two delivered runs, 2026-08-20: 45 of 207 floors on one and 99 of
// 225 on the next never reached the placement form at all, every one of them a LIVE filing,
// and one of them `normalized-equal` to the target and pending in the EU across six classes.
//
// WHY THIS READS THE FORM AND NOT THE PROSE. The obligation used to read "placed or explicitly reasoned
// away", and *reasoned away* is prose — unfalsifiable by machine. On the first of those runs 39 of the 45
// missing marks ARE discussed somewhere in the recommendations and 0 of the 45 record ids are named, so
// "discussed" and "reasoned away" cannot be told apart from the text. The owner ruling of 2026-08-20
// settled it: the duty survives, narrowed to the must-check list, discharged by NAMING THE RECORD ID
// with a one-line ground. That is a row on a form, and a row is checkable.
//
// It needs no new vocabulary. `placements.json` already carries `records[]` and `reason` per entry, and
// the form's own contract already offers `tier: "out-of-scope-filtered"` for a candidate you looked at
// and ruled out — measured on the same run, 12 of 83 entries already use it and all 83 carry a reason.
// The mechanism existed; it was simply never applied across the whole floor.
//
// THE TIER IS NOT THE TEST, deliberately. Placed at any tier and ruled out at the filtered tier discharge
// the duty identically — both are the seat answering for the row. So no tier name appears in the
// predicate; tier only enriches the breakdown, which is why this module imports no tier vocabulary and
// cannot drift when that list changes.
//
// DISCLOSURE ONLY. It re-tiers nothing, blocks nothing and fails no run — the same posture as
// placement-carry, and for the same reason: the dictation that orders the record ids ships WITH this
// check, so every run predating it reports its whole floor unmet. That is the correct reading of those
// runs, not a broken check.
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
import { entryUris } from "./placement-carry.mjs";

export const FLOOR_DUTY_SCHEMA_VERSION = 1;

/**
 * THE ERA STAMP that turns this derivation from disclosure into a delivery floor.
 *
 * The duty is only checkable because the dictation orders the record ids, and that dictation ships WITH
 * the check — so a run whose placement seat never saw it reports its whole floor unmet, correctly, and
 * must not be blocked for it. `computable:false` cannot carry that distinction: measured across every
 * run directory on the box, 19 of 24 carry no floor-duty artifact at all, and on this box "absent" means
 * a KNOCKOUT run far more often than it means an old one. An unarmed absence and a clean floor would
 * read identically, which is the fail-open this stamp exists to refuse.
 *
 * ARMED ON A PASS THAT ACTUALLY RAN, never merely on the stage being reached. A resume that SKIPS
 * placement over a partial artifact leaves `placements.json` written by a seat that never got the
 * dictation — the one reachable way to hold a seat to an order it never received — so a skipped pass
 * arms nothing and its run is judged as it always was.
 *
 * The stamp says only "this run's placement ran under code that carries the floors order". It records no
 * count, because a count here would be a second copy of the artifact's own arithmetic.
 */
export const FLOOR_DUTY_STAMP = "floor-duty-armed.json";

/** Arm the floor for this run. Best-effort: a lost stamp disarms the floor, which is the safe direction
 *  — it degrades to the disclosure this check already was, never to a block nobody can explain. */
export function armFloorDuty(runDir, { now = () => new Date().toISOString() } = {}) {
  try {
    ensureDriverDir(String(runDir ?? ""));
    writeFileSync(driverDir(String(runDir ?? ""), FLOOR_DUTY_STAMP), JSON.stringify({
      _provenance: "the placement pass on this run ran under code that orders the floors by record id "
        + "(#1117), so its floor account may be held to that order (tracker issue 1955)",
      ts: now(),
    }, null, 2) + "\n");
    return true;
  } catch { return false; }
}

/**
 * THE STAGE WHOSE DUTY THIS IS —. Named ONCE, here, beside the duty itself, so the
 * skip decision in the pipeline does not grow its own copy of the coupling.
 */
export const FLOOR_DUTY_STAGE = "placement-inquiry";

/**
 * MAY THIS STAGE'S OUTPUT BE SKIPPED AS "PRESENT AND VALID"? —.
 *
 * Two parts of the engine disagreed about "valid" for one placement pass, and a parked run fell into the
 * gap. On resume the stage skipped — output present, own validator satisfied — while the delivery floor
 * called that same pass's duty undischarged. Both read the same artifact and reached opposite answers,
 * and nothing reconciled them, so the seat was never dispatched again and the duty became permanently
 * undischargeable. One measured run spent 5.55 hours travelling toward a failure it was doomed to at the
 * moment it resumed.
 *
 * RECONCILED TOWARD THE STRICTER SIDE, which is the standing rule for two judgements that disagree: an
 * undischarged duty makes the output NOT valid for skip purposes. The stage runs again and the seat gets
 * the chance to place the floor or name it with a ground.
 *
 * SAFE TO RE-RUN, and that is measured rather than hoped: the placement form is UNIONED into an
 * accumulator before it is judged and `placements.json` is rendered from the accumulator (, after an
 * incident where a killed attempt's finished tiers were thrown away). A second pass merges; it does not
 * start from nothing.
 *
 * FAIL-OPEN ON EVERY UNKNOWN. Unarmed, unreadable, absent, not-computable, or a duty already discharged
 * all return false — skip as before. This may only ever COST a re-run of one stage; it must never be the
 * reason a resume cannot proceed.
 */
export function floorDutyBlocksSkip(runDir, stageName) {
  if (stageName !== FLOOR_DUTY_STAGE) return false;
  if (!floorDutyArmed(runDir)) return false;
  let artifact;
  try { artifact = JSON.parse(readFileSync(driverDir(String(runDir ?? ""), "floor-duty.json"), "utf8")); }
  catch { return false; }
  return Boolean(floorDutyBlock(artifact, { armed: true }));
}

/** Is the delivery floor armed for this run? Absent ⇒ archived or knockout era ⇒ never block. */
export function floorDutyArmed(runDir) {
  return existsSync(driverDir(String(runDir ?? ""), FLOOR_DUTY_STAMP));
}

/** A floor's record id, normalised the SAME way placement uris are — `entryUris` lowercases, so this
 *  must too or every comparison is a miss. One normaliser, never a second matcher. */
const floorUri = (row) => String(row?.record_id ?? "").trim().toLowerCase();

/** A ground is one line the seat wrote. Whitespace is not a ground; neither is a bare label the
 *  contract already forbids. Length is NOT judged here — `reason` quality is predelivery-lint's job and
 *  duplicating it would put two thresholds on one field. */
const hasGround = (entry) => String(entry?.reason ?? "").trim().length > 0;

/**
 * Reconcile the floors against the placement form.
 *
 * @param floors      `band-shape.json`'s `floors.in_class_identical_or_near` rows.
 * @param placements  `placements.json`'s `placements` entries.
 * @returns the artifact body. Every floor lands in exactly one disposition and the four counts sum to
 *          `floors`, so a reader can reconcile it without trusting this module's arithmetic.
 */
export function reconcileFloorDuty({ floors = [], placements = [] } = {}) {
  const entries = Array.isArray(placements) ? placements : [];
  // uri -> the entry that names it. First writer wins; a uri named twice is the same duty discharged
  // once, and picking either entry gives the same disposition.
  const named = new Map();
  for (const e of entries) for (const u of entryUris(e)) if (!named.has(u)) named.set(u, e);

  const rows = [];
  // `unanswerable` is ADDITIVE and overlaps `unanswered` on purpose — see the note below the loop. The
  // four-way sum that reconciles is unchanged, so every reader that existed before this field still adds
  // up; what is new is that a reader can now separate the rows a SEAT could have answered from the rows
  // the BAND never gave it a way to answer.
  const totals = { floors: 0, accounted: 0, named_without_ground: 0, unanswered: 0, unanswerable: 0 };
  const byTier = {};
  for (const f of Array.isArray(floors) ? floors : []) {
    const uri = floorUri(f);
    totals.floors++;
    const entry = uri ? named.get(uri) : undefined;
    // A floor row with no record id at all is UNANSWERABLE, not unanswered — the band gave the seat
    // nothing to name. Counted with the unanswered because the duty is undischarged either way, and
    // distinguished on the row so nobody chases the seat for a row it could not have answered.
    const disposition = !uri ? "no-record-id"
      : entry === undefined ? "unanswered"
      : hasGround(entry) ? "accounted"
      : "named-without-ground";
    if (disposition === "accounted") {
      totals.accounted++;
      const tier = String(entry?.tier ?? "(untiered)");
      byTier[tier] = (byTier[tier] ?? 0) + 1;
    } else if (disposition === "named-without-ground") totals.named_without_ground++;
    else {
      totals.unanswered++;
      // ── THE DISTINCTION A DISCLOSURE COULD CARRY ON THE ROW AND A REFUSAL CANNOT ────────────────
      //
      // A floor row with no record id is UNANSWERABLE: the band gave the seat nothing to name, so no
      // seat behaviour could have discharged it. While this artifact only DISCLOSED, keeping that on the
      // row was enough. It is not enough for a delivery floor — blocking a run on it would fail the seat
      // for a band defect, and the repair it implies (go back and name the record) cannot be performed
      // by anyone. So the count is lifted to the totals, and the floor below counts the seat's share.
      if (disposition === "no-record-id") totals.unanswerable++;
    }
    rows.push({
      record_id: String(f?.record_id ?? ""), mark: String(f?.mark_text ?? ""),
      owner: String(f?.owner_name ?? ""), registry: String(f?.registry ?? ""),
      basis: String(f?.basis ?? ""), status: String(f?.status ?? ""), live: f?.live ?? null,
      disposition,
      tier: disposition === "accounted" ? String(entry?.tier ?? "(untiered)") : null,
    });
  }
  return {
    schema_version: FLOOR_DUTY_SCHEMA_VERSION, computable: true,
    totals, by_tier: byTier, rows,
    // The reconciliation, stated rather than left to be derived — an artifact that does not add up is a
    // bug in THIS module, and a reader should not have to sum four fields to find out.
    reconciles: totals.accounted + totals.named_without_ground + totals.unanswered === totals.floors,
    // THE SEAT'S OWN SHARE, which is what a delivery floor may hold it to: floors it was handed a record
    // id for and did not come back on. Stated here rather than computed at the floor, so the floor and
    // any reader are looking at one number with one definition.
    undischarged_by_seat: (totals.unanswered - totals.unanswerable) + totals.named_without_ground,
  };
}

/**
 * THE DELIVERY FLOOR'S PREDICATE, extracted so it can be DRIVEN rather than read.
 *
 * The first cut left this inline in `pipelineInner` and pinned it with source-text arms — the shape the
 * derivation's own guards use, because that function is internal. That shape cannot catch the failure
 * that matters here: disarming the check with `if (false && …)` leaves every asserted string in place
 * and every arm green. A guard that cannot fail is the thing this whole issue is about, so the
 * predicate moved here, where an arm passes it a state and reads the answer.
 *
 * Returns `null` for "do not block" and `{undischarged, floors, named_without_ground, unanswerable,
 * sample}` when the run must not ship. THREE WAYS TO RETURN NULL, each a different fact:
 *
 *   not armed     the placement pass did not run under the code carrying the floors order — an
 *                 archived run, or a knockout run that has no floors at all
 *   not computable the artifact could not be built; a could-not-look is neither a clean floor nor a
 *                 dirty one, and blocking on it would fail runs for a missing band file
 *   nothing owed  the seat came back on every floor it was given a record id for
 */
export function floorDutyBlock(artifact, { armed = false } = {}) {
  if (!armed || artifact?.computable !== true) return null;
  const undischarged = artifact?.undischarged_by_seat ?? 0;
  if (!(undischarged > 0)) return null;
  const t = artifact.totals ?? {};
  const sample = (Array.isArray(artifact.rows) ? artifact.rows : [])
    .filter((r) => r?.disposition === "unanswered" || r?.disposition === "named-without-ground")
    .slice(0, 4).map((r) => `${r.mark || "(unnamed)"} (${r.record_id})`).join("; ");
  return {
    undischarged, floors: t.floors ?? 0,
    named_without_ground: t.named_without_ground ?? 0,
    unanswerable: t.unanswerable ?? 0,
    sample,
  };
}

export const FLOOR_DUTY_EVENT_FIELDS = ["floors", "accounted", "named_without_ground", "unanswered"];

/** The run.jsonl row. `computable:false` carries its reason and NO counts — a zero here would read as
 *  "every floor accounted for", which is the opposite of "we could not look". */
export function floorDutyEvent({ trigger = null, artifact = null, reason = null } = {}) {
  if (!artifact) return { event: "floor-duty", trigger, computable: false, reason: reason ?? "not computed" };
  const t = artifact.totals;
  const out = { event: "floor-duty", trigger, computable: true, reconciles: artifact.reconciles === true };
  for (const k of FLOOR_DUTY_EVENT_FIELDS) out[k] = t[k];
  return out;
}
