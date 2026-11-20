// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// judge.mjs — whether a stage's artifacts are there and pass its validator, and the forms each judgement syncs first.
//
// The stage ladder (gateway.mjs runStageLadder) makes one judgement per stage run. It grades each settled turn, the
// form repair re-grades a repaired file with it (form-repair.mjs), and the rescues ask it whether an attempt wrote
// valid artifacts of its own (rescue.mjs). Each first syncs the meaning-sweep, coverage and placement forms, and keeps
// what it synced last for the warm-patch veto and the attempt row.

import { existsSync, readFileSync, statSync } from "node:fs";
import { outputMeta } from "../log.mjs";

// statOf feeds the ONE artifact-state snapshot both the exit-1 rescue and AD-4's emitted-vs-landed
// gauge read. It is taken PER ATTEMPT, just before the turn is dispatched — it used to be taken
// once before the whole ladder, which is the cross-attempt rescue hole post-merge audit 2 found: a
// later attempt's nonzero exit was judged "fresh" against a snapshot predating an EARLIER attempt's
// write, so attempt 1's kill-torn partial rescued attempt 2's no-write exit as stage truth.
export const statOf = (f) => { try { const s = statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };

//: the seat-facing form the last judgement synced, measured at record time so the row carries the
// bytes that were on disk when the attempt settled. At most one of the three fires per stage — a stage
// owns one form or none — and the ?? chain is that fact, not a preference between them.
export const gradedFormMeta = (lastGraded) => outputMeta(lastGraded);

export function artifactJudgement({ files, validate, runDir }, { syncDispositionForm, syncCoverageForm, syncPlacementForm, toolWrittenArtifact, rel,
  gradedArtifact, saidBackOnly }) {
  let lastUnion = null;         // the last judgement's meaning-sweep counted state (syncDispositionForm's
                                // return). Written onto the attempt row for the journal AND read by the
                                // veto below — the run's own answer to "did this session rule any of
                                // its rows?", counted by the gate's own isRuled, never a token name
  let lastCoverageUnion = null; //: the same, for the register coverage form
  let lastPlacementUnion = null; //: the same, for the placement form — and it renders placements.json
  // The artifact judgement, lifted out of the classification chain into ONE function so the
  // write-time form repair below can RE-JUDGE the corrected file with the same code — never with a
  // second, drifting copy of the contract. It returns the three facts that must always travel
  // together: the fail string, the validator's own stamped count, and WHICH file was
  // rejected (the repair aims at that file, and only that file's bytes decide whether it landed).
  const judgeArtifacts = () => {
    // — union the meaning-sweep form BEFORE judging it, on every judgement (see syncDispositionForm).
    // A ruling recorded on attempt 1 is therefore still recorded on attempt 3, and the outstanding count
    // cannot rise. Returns null for every stage that owns no meaning sweep, which is all but one.
    const u = syncDispositionForm(files);
    if (u) lastUnion = u;
    // — the same treatment for the register coverage form. A status recorded on attempt 1 is
    // still recorded on attempt 3, and the outstanding count cannot rise.
    const cu = syncCoverageForm(files);
    if (cu) lastCoverageUnion = cu;
    // — and the same for placement, which also RENDERS placements.json from the union. A tier
    // placed on attempt 1 is on disk, in the deliverable, before attempt 1 is allowed to finish.
    const pu = syncPlacementForm(files);
    if (pu) lastPlacementUnion = pu;
    for (const f of files) {
      if (!existsSync(f)) {
        // A TOOL-WRITTEN ARTIFACT IS ABSENT FOR ONE OF TWO REASONS, and they are not the same finding:
        // the seat never called its record tool, or it called and every call was REFUSED. The token was
        // the same for both, so a stage that met a defect, was told by name, and could not restate it
        // reported as a stage that produced nothing. Measured twice, on two different stages: the
        // writer's forbidden coverage form went from naming that defect to "produced nothing", and a
        // register unit whose band is missing went from `named_band_missing` to an absent note, because
        // its transport refuses a note over a band that does not exist. Both are a strictly earlier
        // catch reported as a strictly worse signature. The refusal journal is the transport's own
        // record of the second case; the LAST entry is the one the stage exhausted on. The token stays
        // `missing_file` — `contract-vocabulary` classifies by prefix and the repair ladder's routing
        // for this file is already the tool re-route — so this adds the cause without moving the class.
        //
        // THE READER TAKES (runDir, file) so both kinds of row can share one signature. A per-RUN
        // transport's reader ignores the second argument, which is what makes this forward-compatible;
        // a per-AXIS one needs it, because six units append in parallel and one shared journal would be
        // a record nobody can attribute.
        const refused = toolWrittenArtifact(f)?.refusals?.(runDir, f) ?? [];
        const last = refused.length ? String(refused[refused.length - 1]?.reason ?? "") : "";
        return { fail: `missing_file:${rel(f)}${last ? ` — every call refused, last: ${last}` : ""}`, quantity: null, file: f };
      }
      if (validate) {
        const v = validate(f, readFileSync(f, "utf8"));
        // — the token names THE ARTIFACT THE VALIDATOR GRADED, which for every form-bearing stage
        // is a sibling of the declared output, not the output itself. `common-law-findings.half-m.md`
        // was named on a refusal reading `form_untouched=79` over a 46-line file that holds no rows;
        // the 79 rows are in the disposition form, which the message never mentioned. `file:` stays the
        // stage's own output — that is the repair anchor and the ladder's byte-identity key, and both
        // are unchanged by naming the graded artifact in the string a human reads.
        if (!v.ok) {
          const g = gradedArtifact(v.reason, f);
          return { fail: `invalid_file:${rel(g)}:${v.reason}`, quantity: Number.isFinite(v.quantity) ? v.quantity : null, file: f, graded: g === f ? null : g };
        }
      }
    }
    return { fail: null, quantity: null, file: null, graded: null };
  };
  // ONE artifact judgement, shared by both rescues below (the rule: never a second, drifting copy of
  // the contract). Present + written by THIS attempt (the per-attempt snapshot — an inherited file and
  // equally an earlier attempt's file never rescue a failed turn) + passes the stage's own validator.
  // Made once per attempt, from that attempt's snapshot `preArtifact`.
  const attemptWroteTruthOf = (preArtifact) => (why = null) => {
    // — the rescues judge with `validate` directly rather than through judgeArtifacts, so the union
    // has to run here too or a rescued turn would be refused for rows the form already holds. Idempotent,
    // so the double call on the normal path costs a regeneration and changes nothing.
    const u = syncDispositionForm(files);
    if (u) lastUnion = u;
    const cu = syncCoverageForm(files);          //, same reason
    if (cu) lastCoverageUnion = cu;
    // — and placement. THIS CALL IS THE R1 CURE: the wall rescue asks whether this attempt wrote
    // a valid artifact, and until the union has run and placements.json has been rendered from it, the
    // answer for a killed-in-the-gap attempt is no. Idempotent, so the double call costs a regeneration.
    const pu = syncPlacementForm(files);
    if (pu) lastPlacementUnion = pu;
    // `why`, when a caller passes one, is told WHICH file failed and on what, so a refusal can name both.
    return files.every((f) => {
      const now = statOf(f);
      const no = (cause, reason) => { if (why) Object.assign(why, { file: rel(f), cause, ...(reason ? { reason } : {}) }); return false; };
      if (now === null) return no("absent");
      if (now === preArtifact.get(f)) return no("not-written-by-this-attempt");
      // A said-back refusal is a duty the artifact leaves open, not an invalid artifact: it never stops a rescue.
      if (validate) { const v = validate(f, readFileSync(f, "utf8")); if (!v.ok && !saidBackOnly(v.reason)) return no("invalid", v.reason ? String(v.reason) : undefined); }
      return true;
    });
  };
  return {
    judgeArtifacts, attemptWroteTruthOf,
    get lastUnion() { return lastUnion; }, get lastCoverageUnion() { return lastCoverageUnion; }, get lastPlacementUnion() { return lastPlacementUnion; },
  };
}
