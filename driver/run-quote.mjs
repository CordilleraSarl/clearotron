// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-quote.mjs — the ONE place a job becomes a quote.
//
// effort-model.mjs is the arithmetic and stays a pure leaf. This is the layer above it: the thing that
// decides WHAT TO FEED the arithmetic, which is where the real risk lives. The model was ported with a
// parity test pinning it weight for weight, and the doors still disagreed — because the test pins the
// MATH and the divergence was in the INPUTS.
//
// It was a 9-point gap (`W.oneTerritory`, the largest single term) between the plan door and the run:
//   - the plan doors sized the request from the EFFECTIVE scope — profile defaults folded in, so an
//     account whose default is "United States" is a one-territory search;
//   - the pipeline sized it from the RAW job, where a request that named no territories has none, so the
//     one-territory term never fired and the stamped quote came in a whole unit under the screen.
// A ledger row pairing "what we quoted" with "what it consumed" is worthless if those two numbers came
// from different questions, and a calibration fitted against it would be fitting the wrong side.
//
// So every caller resolves through here: both plan doors and the run. Same resolver (resolveEffectiveScope
// — the one the codebase already made shared for exactly this reason), same lane decision, same inputs.
// Three copies of this derivation is what drifts; the knockout lane's missing token stamp came from
// precisely that shape of copy.

import { resolveEffectiveScope } from "./effective-scope.mjs";
import { decideJxLanes } from "./jx-lanes.mjs";
import { quoteEffort, leversFromResolved } from "./effort-model.mjs";

/**
 * Whether a native-language lane will ACTUALLY run.
 *
 * Not what the composer's toggle said, and not what the product's row says either: on a Full country
 * search the investigation is automatic, and a country with no adapter has nothing to route — so the
 * component being on does not mean a lane fires. Asked of `decideJxLanes` itself, which is the code that
 * decides, and which also sees a lane the account has switched off.
 *
 * Falls back to TRUE rather than false when the decision is unreadable: the resolved components already
 * say the investigation is part of this product, so quoting it as absent would under-price a search we
 * are about to run.
 */
function nativeLaneRuns({ job, profile, searchPolicy }) {
  if (!searchPolicy?.components?.jxLanes) return false;
  try { return Object.keys(decideJxLanes({ job, profile, searchPolicy })?.lanes ?? {}).length > 0; }
  catch { return true; }
}

/**
 * Quote a job against its resolved policy. Returns null if it cannot be sized — never throws, because
 * every caller (two previews and a run terminal) is somewhere a throw would cost more than a missing
 * number.
 *
 * `scope` may be passed when the caller has already resolved it (both plan doors have), purely to avoid
 * resolving twice; omitted, it is resolved here. Either way it is the SAME resolver, so the quote does
 * not depend on which door asked.
 */
export function quoteForJob({ job, profile = null, searchPolicy = null, scope = null } = {}) {
  try {
    // NO RESOLVED POLICY ⇒ NO QUOTE. Without a pipeline, leversFromResolved reads `undefined` as "not a
    // knockout" and an absent commonLawGrid as "no marketplace", which lands on register-only — a real
    // product, a plausible number, and a complete invention. A door that could not resolve the depth must
    // say it could not size the search, not quote a different search confidently.
    if (!searchPolicy?.pipeline) return null;
    const eff = scope ?? resolveEffectiveScope(job ?? {}, profile, searchPolicy);
    const levers = leversFromResolved({
      pipeline: searchPolicy?.pipeline,
      components: searchPolicy?.components,
      // THE PRODUCT'S ANSWER, and there is no longer a second one to OR it with: case law is what a Full
      // country search IS, so the resolved policy is the whole statement and a job flag that could
      // disagree with it no longer exists.
      caseLaw: searchPolicy?.caseLaw === true,
      territories: eff?.jurisdictions ?? [],
    });
    return quoteEffort({
      levers: { ...levers, nativeLanguage: levers.nativeLanguage && nativeLaneRuns({ job, profile, searchPolicy }) },
      names: Array.isArray(job?.marks) && job.marks.length ? job.marks.length : 1,
      classes: (eff?.classes ?? []).length,
      platforms: (eff?.platforms ?? []).length,
      density: profile?.marketplaceDensity ?? null,
    });
  } catch {
    return null;
  }
}

/**
 * AD-4 (2026-07-30 addendum) — quoted-vs-actual turnaround, reconciled at the delivered terminal.
 *
 * The consumption row already PAIRS the two figures (quote + wallSec on one line); what was missing is the
 * comparison being surfaced anywhere a reader looks — the R2 evidence run was quoted 1.5h and took 5.68h,
 * and nothing said so. This is that comparison, HOURS ONLY (the tokens-only/no-currency directive holds:
 * nothing here converts to money, and nothing ever should).
 *
 * Pure and total: every field is present on every return — a missing quote yields quotedHours:null (the run
 * was never sized, a recorded fact), a missing/garbled startedAt yields actualHours:null (the wall could not
 * be measured, also a recorded fact). ratio is actual/quoted, only when both sides exist and the quote is
 * positive. Never throws.
 */
export function reconcileTurnaround({ quote = null, startedAt = null, now = Date.now() } = {}) {
  const quotedHours = Number.isFinite(quote?.turnaroundHours) ? quote.turnaroundHours : null;
  let actualHours = null;
  if (startedAt != null) {
    const t = new Date(startedAt).getTime();
    if (Number.isFinite(t) && now >= t) actualHours = Number(((now - t) / 3600000).toFixed(2));
  }
  const ratio = quotedHours != null && quotedHours > 0 && actualHours != null
    ? Number((actualHours / quotedHours).toFixed(2)) : null;
  // WHAT actualHours MEASURES, said on the row rather than left to be inferred (post-merge audit,
  // problem 8). It is WALL from status.json `startedAt` — which a resume deliberately never rewrites — to
  // this terminal, so it spans rate-limit postpones and auto-recovery parks where nothing was running. The
  // ratio is therefore quoted-vs-elapsed, NOT quoted-vs-engine-time, and a run that waited out a cap looks
  // identical to one that ground. Parked time is not subtracted here on purpose: reconstructing it means
  // pairing park/resume events across separate driver processes, which is fragile and buys no diagnosis
  // the park events themselves do not already carry. The honest move is to label the figure.
  // Both fields are three-valued with actualHours: null when there was nothing to measure.
  const measured = actualHours != null;
  return {
    quotedHours, actualHours, ratio,
    actualHoursBasis: measured ? "wall:status.startedAt→terminal" : null,
    actualHoursIncludesParked: measured ? true : null,
  };
}
