// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// demo-run-agreement.mjs — a demo run and a demo account must AGREE, and neither one overrides the other.
//
// The profile's `demoData: true` marks an account as fiction, and the admission wall has always rejected a
// real clearance on it: the requester cannot fix that by re-sending, because the account itself is not
// real. `demoRun` on the JOB is the other half of the same sentence — the requester saying "I know, and
// this run is meant to be a demo".
//
// AGREEMENT, NEVER OVERRIDE, and the direction matters in both directions:
//
//   demo profile + demoRun job   → admitted. The one combination that is honest.
//   demo profile + ordinary job  → refused, unchanged: a real clearance cannot run on fiction.
//   REAL profile + demoRun job   → refused, and this is the half that is easy to forget. A demo banner
//                                  over a real account's report is the same lie pointing the other way,
//                                  and it is worse, because the reader has every reason to trust it.
//
// The profile marker stays non-overlayable. The job field CONSENTS to what the profile already says; it
// can never change what the profile means. A field that could flip an account from fiction to real, or
// back, would put the client's own request in charge of whether their report is true.

/**
 * Whether this job and this profile agree — and if not, the refusal, by name.
 *
 * @returns {{ok: true, demo: boolean} | {ok: false, reject: string}}
 */
export function demoRunAgreement({ demoRun = false, demoData = false, who = "this account" } = {}) {
  const job = demoRun === true;
  const profile = demoData === true;

  if (profile && job) return { ok: true, demo: true };
  if (!profile && !job) return { ok: true, demo: false };

  if (profile && !job) {
    // The existing wall's sentence, unchanged: this is the case it was written for.
    return { ok: false, reject: `${who} is DEMO DATA (demoData: true in its profile) and cannot run a real `
      + "clearance. Nothing has been searched, and nothing has been spent. Point the request at a real "
      + "account, or — if this account should be real — remove demoData from its profile." };
  }
  // REAL profile, demoRun job. Refused by name, and the sentence says which way the mismatch runs so
  // nobody reads it as the case above.
  return { ok: false, reject: `this request declares demoRun: true, and ${who} is a REAL account `
    + "(no demoData in its profile). A demo run marks its report as fiction, and marking a real account's "
    + "report as fiction is the same untruth as the reverse — it is refused rather than honoured. Drop "
    + "demoRun to run this account for real, or point the request at a demo account." };
}

/**
 * Is this a usable `demoRun` value at all — checked AT THE DOOR.
 *
 * A malformed value is TRUTHY and would otherwise die deep in a stage: `"false"`, `"no"` and `0` are all
 * things a hand-written manifest has carried. Only the literal booleans are a declaration; anything else
 * is refused where the requester can still read the sentence.
 */
export function demoRunShape(value) {
  if (value === undefined || value === null) return { ok: true, value: false };
  if (value === true || value === false) return { ok: true, value };
  return { ok: false, reject: `demoRun must be true or false, and this request sent ${JSON.stringify(value)}. `
    + "A string or a number here is truthy, so it would silently mean `true` and mark the report as "
    + "fiction on a value nobody typed deliberately." };
}
