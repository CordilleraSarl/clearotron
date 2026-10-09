// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// surface-duty.mjs — did every record that reached the findings surface get an ANSWER?
//
// The floors check ( item 2, floor-duty.mjs) asks that question at PLACEMENT. This asks it one
// stage later, where the same duty has the same hole: a record that survived screening and placement
// and reached a register-findings surface has already been judged worth a reader's attention. Synthesis
// then either delivers it or does not, and when it does not, the run records THAT it did not and cannot
// say WHY for any single record.
//
// Measured on one delivered round, from its own `_driver/record-carry.json`: 102 records at
// `synthesis:not-delivered`, every one of them `reason_source: step-silent`. One was a registered mark
// with a real register id, and `unreasoned: 0` in the same ledger read as "every drop has a reason".
//
// THAT ZERO IS WHY THIS EXISTS, and it is the shape to keep in mind: the ledger HAS a label for every
// drop. The label is inferred from where the record stopped, not stated by the step that stopped it, and
// `step-silent` is the ledger saying so honestly. A reader cannot tell "correctly judged irrelevant"
// from "silently lost" — opposite repairs — and the count of the two together was 102.
//
// WHY THE PREDICATE CARRIES NO ANSWER KEY. The issue calls this a gold-set tripwire, and a relayed
// summary of the ruling had it firing on a dropped answer-key mark. It does not, deliberately:
//
//   · The answer keys live in the config repository, which never merges into this one. A check that
//     needs them cannot ship here at all.
//   · A run is not scored when it delivers. The round that produced the 102 sat a full day unscored —
//     the defect was found by someone running a scorer a day later, which is exactly the delay this is
//     meant to remove. A tripwire that only fires against a gold set inherits that delay.
//   · The silence is the defect. A record declined without a ground is worth flagging whether or not it
//     happens to be in someone's answer key; the answer-key mark was the proof, not the population.
//
// So the predicate is the issue's own text — reach `findings-surface`, reason_source `step-silent` —
// and it is computable from the run's own artifacts, on the run, with no external file.
//
// DISCLOSURE ONLY, the same posture as floor-duty and for the same reason: the dictation that makes
// synthesis state its grounds ships WITH this check, so every run predating it reports its whole
// findings surface unanswered. That is the correct reading of those runs, not a broken check. It
// re-tiers nothing, blocks nothing, and fails no run.

export const SURFACE_DUTY_SCHEMA_VERSION = 1;

/**
 * THE POPULATION: records a judging stage had already accepted. Two reaches, not one.
 *
 * THIS WAS `findings-surface` ALONE, AND THAT WAS A BUG THIS CHECK WOULD HAVE HIDDEN. The issue's item 3
 * names that reach because that is where the silence WAS when it was written — 102 records at
 * `synthesis:not-delivered`, every one `step-silent`. `d80a8388` then made synthesis state its grounds,
 * and a fresh reproduction on a later run showed the count at that reach collapsing while **71 records
 * appeared at `digest:silent-drop`, reach `placed`, `reason_source: absent` — with a lawyer-named mark
 * among them.**
 *
 * A tripwire keyed on the old signature would have gone green on that run and reported a cure. That is
 * this issue's own defect committed by the instrument built to detect it: keyed on a surface, it
 * reports that surface's history rather than the run's condition. So the predicate keys on the HARM —
 * a record a stage accepted, ending with no ground stated — and not on the token that expressed it in
 * one round.
 */
const ANSWERABLE_REACH = new Set(["placed", "findings-surface"]);

/**
 * NO GROUND WAS STATED. Both tokens mean it, by different routes, and both leave a reader unable to
 * tell "correctly judged irrelevant" from "silently lost":
 *
 *   step-silent   the stage completed and recorded no ground for this record
 *   absent        the stage's own output does not name the record at all — it neither carried it, nor
 *                 wrote it a drop row, nor resolved it
 *
 * `step-stated` is the only answer. `step-structural` is deliberately NOT here: it means the stage
 * never completed, so nothing judged the record — an upstream absence, which record-carry already
 * reports under its own name, and blaming a judging stage for it would be wrong.
 */
const NO_GROUND = new Set(["step-silent", "absent"]);

const uriOf = (row) => String(row?.uri ?? row?.record_id ?? "").trim().toLowerCase();

/**
 * Every record that reached the findings surface and carries no stated ground, read off the rows
 * `record-carry.json` already produces. PURE — pass it the rows, it reads nothing else.
 *
 * TAKES ROWS, NOT A RUN DIRECTORY, so the arms can construct the states the tree cannot produce. The
 * state that matters here — a surfaced record with a STATED ground — does not exist on any archived run,
 * because nothing has ever written one. An arm driven off a real run would certify only the half that
 * is already broken.
 *
 * @param {{uri?: string, record_id?: string, reach?: string, reason?: string,
 *          reason_source?: string, mark?: string, placement?: object}[]} rows
 */
export function reconcileSurfaceDuty({ rows = [] } = {}) {
  const entries = Array.isArray(rows) ? rows : [];
  const totals = { surfaced: 0, answered: 0, silent: 0 };
  const silent = [];
  const seen = new Set();

  for (const row of entries) {
    if (!ANSWERABLE_REACH.has(String(row?.reach ?? ""))) continue;
    const uri = uriOf(row);
    // A surfaced row with no record id is still surfaced and still counted — dropping it would shrink
    // the denominator and make the ratio look better for a data defect. It cannot be de-duplicated,
    // so it is never suppressed as a repeat either.
    if (uri && seen.has(uri)) continue;
    if (uri) seen.add(uri);
    totals.surfaced++;
    if (NO_GROUND.has(String(row?.reason_source ?? ""))) {
      totals.silent++;
      silent.push({
        uri: uri || null,
        mark: String(row?.mark ?? "").trim() || null,
        reason: String(row?.reason ?? "").trim() || null,
        // WHERE the silence is, carried per row. When one producer is fixed the silence moves rather
        // than ending, so a reader needs the seam and the source to see that it moved — a bare count
        // would have read as progress across the run that motivated this widening.
        reach: String(row?.reach ?? "") || null,
        reason_source: String(row?.reason_source ?? "") || null,
        tier: row?.placement?.tier ?? null,
      });
    } else {
      totals.answered++;
    }
  }

  return {
    schema_version: SURFACE_DUTY_SCHEMA_VERSION,
    totals,
    // TRIPPED IS A CLAIM ABOUT THIS RUN, NOT A THRESHOLD. One silent decline at a reader surface is the
    // defect; there is no count at which it becomes acceptable, so there is no number to tune here.
    tripped: totals.silent > 0,
    silent,
  };
}

/**
 * The one-line disclosure a run emits when the tripwire fires.
 *
 * SAYS WHAT CANNOT BE TOLD APART, rather than "N unreasoned". The reader's question is never "how many"
 * — it is whether a mark they would have wanted is among them, and the honest answer is that the run
 * cannot say, which is the defect stated rather than a number that reads as a score.
 */
export function surfaceDutyNote(result) {
  const { silent = 0, surfaced = 0 } = result?.totals ?? {};
  if (!silent) return null;
  return `[surface-duty] ${silent} of ${surfaced} record(s) reached a findings surface and were not `
    + `delivered, with no ground recorded for any of them — so "correctly judged irrelevant" and `
    + `"silently dropped" cannot be told apart for these records, and they are opposite repairs`;
}
