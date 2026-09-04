// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/usage.mjs — recompute a run's Corsearch billed-call usage LIVE from the shared ledger, and flag drift
// vs the cached status.json value.
//
// Why recompute: the driver's per-run attribution depends on `stripGatewayNs` (the fix), which is in the
// SOURCE this module imports — but a running prod driver that predates that commit may have written an
// under-counted `status.json.providerUsage`. Importing tallyRegisterCalls makes the MCP's live computation
// correct even when the stored value is stale; we surface both and flag the disagreement. Read-only.

import { tallyRegisterCalls, DEFAULT_LEDGER_PATH } from "./driver.mjs";

// The driver tags every billed call's gateway session-key `prelim-<slug>-<codename>-<stage>…`. Our server is
// named "trademark-artifacts", but the RUNS were produced by the prelim-driver, so the prefix stays `prelim-`.
export function runPrefix(run) { return `prelim-${run.slug}-${run.codename}-`; }

// — the compared key set is DERIVED from the two tallies, not restated here.
//
// It was `["search", "record_fetch", "total"]` — three of the seventeen numeric counters
// provider-usage.mjs writes. A run whose entire live-vs-cached disagreement sat in `enumerate`,
// `execute_plan`, `batch_screen` or `unclassified` reported `drift: false`. A drift detector that itself
// drifts is worse than none: it answers "they agree" about categories it never compared.
//
// The comparison set is the counters BOTH tallies carry. Absence is not disagreement: a cached tally
// written before a counter existed (the fixture's legacy `{search, record_fetch, total}` shape is exactly
// this) never recorded a value that could differ, and reading `?? 0` as a measurement would manufacture
// drift out of a schema change. What it must never do is silently skip a counter both sides DO carry —
// which is what the hardcoded three did.
//
// Both answers are returned BY NAME — `driftKeys` (which counters moved) and `comparedCounters` (which
// the verdict covers). A disagreement that cannot say which counter moved, or an agreement that cannot
// say what it compared, is the same silence with an extra variable.
export function comparedCounters(live, cached) {
  return Object.keys(cached ?? {})
    .filter((k) => typeof cached[k] === "number" && typeof live?.[k] === "number")
    .sort();
}

/** Which of those counters disagree. [] === they agree on everything comparable. */
function tallyDrift(live, cached) {
  return comparedCounters(live, cached).filter((k) => live[k] !== cached[k]);
}

// — THE CACHED TALLY IS KEYED BY THE PROVIDER THAT RAN, and this read hardcoded one vendor.
// `writeRunStatus(ctx, { providerUsage: { [provider]: usage } })` has keyed it by the ACTIVE provider
// id since the tier stopped being single-vendor, so on any Clarivate, Signa, EUIPO or USPTO run
// `providerUsage.corsearch` was undefined — and the drift detector then reported "no cached value was
// stored", which reads as a benign absence. It is the silent half of this issue's own defect: a name
// asserting a vendor dependency that does not exist, on the surface someone consults during an incident.
//
// ONE KEY, WHICHEVER IT IS. The driver writes exactly one, so taking the sole entry is not a guess; a
// tally carrying more than one provider would be a different fact and is reported as unusable rather
// than silently half-read.
export function cachedProviderTally(status) {
  const byProvider = status?.providerUsage;
  if (!byProvider || typeof byProvider !== "object") return null;
  const keys = Object.keys(byProvider).filter((k) => byProvider[k] && typeof byProvider[k] === "object");
  return keys.length === 1 ? byProvider[keys[0]] : null;
}

export function providerUsage(run, ledgerPath = DEFAULT_LEDGER_PATH) {
  const prefix = runPrefix(run);
  const live = tallyRegisterCalls(ledgerPath, prefix);
  const cached = cachedProviderTally(run.status);
  const compared = cached ? comparedCounters(live, cached) : [];
  const driftKeys = cached ? tallyDrift(live, cached) : [];
  const drift = cached ? driftKeys.length > 0 : null;
  return {
    runId: run.runId,
    prefix,
    live,                                    // billing-grade counts recomputed now from the ledger
    cached,                                  // what status.json stored at publish time (may be stale)
    drift,                                   // true = live disagrees with cached
    driftKeys,                               // …and WHICH counters disagree — a boolean names nothing
    comparedCounters: compared,              // …and which counters that verdict actually covers
    ledgerStale: cached != null && drift === true,
    lowConfidence: live.total === 0,         // no ledger rows matched this prefix
    note:
      live.total === 0
        ? "No ledger rows matched this run's prefix — the run may predate the namespace-strip fix, the ledger may have rotated, or no billed calls were made. Treat as low-confidence."
        : cached == null
          ? "No cached providerUsage was stored for this run; the live counts are the only source."
          : drift
            ? `Live recompute disagrees with the cached status.json value on: ${driftKeys.join(", ")} (the running driver predates the #152 attribution fix, or stored a tally shape that predates these counters) — trust the live counts.`
            : `Live recompute agrees with the stored value on all ${compared.length} counter(s) it carries (${compared.join(", ")}); counters the stored tally predates are not compared, never assumed equal.`,
  };
}
