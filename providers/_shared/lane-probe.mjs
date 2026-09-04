// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Lane probe — prove a register lane RETRIEVES, rather than that a key is set ───────────────────
//
//. `doctor` proves the ENGINE by spending a turn and every other credential by
// reading a file. `✓ CLARIVATE_API_KEY set (.env)` is equally true of a valid key, an expired key, a key
// scoped to the wrong account, and forty characters of nonsense.
//
// ══ THE PAIRED CONTROL, AND WHY THE POSITIVE ONE CARRIES THE WEIGHT ══
//
// A dead credential and a genuinely empty register produce the SAME artifact: a small number in a narrow
// column. One round lost about an hour to that question after 87 counts came back `total: 0, ok: true` —
// which turned out to be CORRECT, because the corpus marks were invented. Nothing on the box could
// establish it, and what finally settled it was a hand-built pair run through the adapter in one process:
//
//     COCA-COLA  · contains · US   total=136
//     CORAL FREEZE · contains · US   total=0
//
//   POSITIVE control — a mark chosen to return hits. `total > 0` proves the lane RETRIEVES: credential,
//     transport, query construction and parsing all work. This is the arm that catches a dead key.
//   NEGATIVE control — an invented mark. `total == 0` proves the lane can also say "none".
//
// A dead credential makes BOTH return zero, so **a passing negative control alone proves nothing** and
// must never be reported as proof. The asymmetry is the whole design.
//
// ══ THREE STATES, BECAUSE TWO IS THE DEFECT ONE SUBSYSTEM OVER ══
//
// `proven` · `failed` (with the provider's own reason) · `cannot-prove` (with why).
//
// Reporting a provider that CANNOT be probed as `failed` is the could-not-look defect that tracker
// issues 1864 and 1874 both closed this week — a check that could not run reported as a check that
// found something wrong. The count kernel beside this file sets the precedent: it returns `total: null`
// with a reason rather than a zero it did not count.
//
// ══ THE TRANSPORT IS INJECTED, AND THAT IS NOT A STYLE CHOICE ══
//
// `countHits` comes in as a dependency with the DRIVER'S normalised signature —
// `countHits({ name, matchMode, classes, regions }, ctx) -> { ok, total, reason }` — the one every
// adapter in driver.config.mjs already answers. Matching the real seam is what makes the stub in the
// arms the same shape as production; a bespoke signature here would test a shape nothing calls.
// A prober that closes over `fetch` or imports a provider core inline can only ever be armed by a LIVE
// call — so it gets no arm in CI, and ships with a green that means nothing. Which is precisely the
// class of instrument this issue exists to complain about.

// The marks are DATA, overridable, and each says why it was chosen. A control that stops returning hits
// turns this probe into a permanent false alarm, so the reason has to survive for whoever re-picks it.
export const DEFAULT_CONTROLS = Object.freeze({
  positive: Object.freeze({
    mark: "COCA-COLA",
    why: "a mark registered in every major jurisdiction for a century — if this returns nothing, the "
       + "lane is not retrieving, whatever the credential file says",
  }),
  negative: Object.freeze({
    mark: "ZZQX-NOTAMARK-7731",
    why: "not a word in any language and not a registrable form — a register that returns hits for it "
       + "is matching something other than the query it was given",
  }),
});

// Derived from the capability, never asserted here: under `cheap` the count IS an ordinary billable
// search, so a paired control is TWO metered calls. Under `endpoint` it is a real count call.
export function probeSpend(capabilities) {
  // An UNKNOWN capability is not a cheap one. Defaulting here is how a local index gets announced as
  // billable; say so instead and let the operator decide.
  if (!capabilities || capabilities.countProbe == null)
    return { calls: 2, metered: null, note: "cost UNKNOWN — this provider's count capability could not be read" };
  const probe = capabilities.countProbe;
  if (probe === "none") return { calls: 0, metered: false, note: "no count capability — nothing to spend" };
  if (probe === "endpoint") return { calls: 2, metered: false, note: "two count-endpoint calls, not billable searches" };
  return { calls: 2, metered: true, note: "two BILLABLE searches — the count rides an ordinary search here" };
}

// WHERE THE CAPABILITY ACTUALLY LIVES, asked rather than assumed. The driver's adapter object does NOT
// carry `capabilities` — it is null on every one of them — so a caller reading `adapter.capabilities`
// silently gets the default and prints the wrong cost. Caught by running it: `uspto-local`, a LOCAL
// index, was announced as "BILLABLE — the count rides a real search here". (issue 1871)
//
// Returns null when it cannot be read, which the caller must report as unknown rather than as cheap.
export async function loadProviderCapabilities(repoRoot, providerId, importer = (u) => import(u)) {
  if (!providerId) return null;
  try {
    const m = await importer(new URL(`file://${repoRoot}/providers/${providerId}/src/capabilities.js`).href);
    return m?.CAPABILITIES ?? m?.default ?? null;
  } catch { return null; }
}

export function makeLaneProbe(deps) {
  const { countHits, capabilities = {}, controls = DEFAULT_CONTROLS } = deps;
  if (typeof countHits !== "function")
    throw new Error("[lane-probe] countHits dependency is required — the transport is injected, never imported");

  // `regions` is not decoration: it is MANDATORY on at least one adapter, which refuses a worldwide
  // count as a disclosed capability gap rather than returning a number. A probe that omitted it would
  // report that refusal as a failing credential.
  return async function proveLane(query = {}, ctx = {}) {
    const { matchMode = "contains", classes = [], regions = ["US"] } = query;
    const spend = probeSpend(capabilities);
    if ((capabilities.countProbe ?? "cheap") === "none") {
      return {
        state: "cannot-prove", spend,
        reason: 'this provider declares countProbe "none" — it reports no total, so a control-mark count '
              + "cannot prove it. That is an absent capability, not a failure: nothing here was asked and "
              + "refused. Prove it another way or say it is unproven; do not read this as a bad credential.",
        positive: null, negative: null,
      };
    }

    const one = async (control) => {
      try {
        const r = await countHits({ name: control.mark, matchMode, classes, regions }, ctx);
        return { mark: control.mark, ok: !!r?.ok, total: r?.total ?? null, reason: r?.reason ?? null };
      } catch (e) {
        // The kernel guards its own transport, so reaching here means something outside it threw.
        return { mark: control.mark, ok: false, total: null, reason: String(e?.message ?? e) };
      }
    };

    const positive = await one(controls.positive);

    // FAIL EARLY AND SPEND LESS. If the positive control did not retrieve, the negative control cannot
    // add anything — a dead lane returns zero for both, which is the confusion this exists to end.
    if (!positive.ok || positive.total === null) {
      return { state: "failed", spend: { ...spend, calls: 1 }, positive, negative: null,
        reason: `the control mark ${positive.mark} could not be counted: ${positive.reason ?? "no reason given"}` };
    }
    if (positive.total === 0) {
      return { state: "failed", spend: { ...spend, calls: 1 }, positive, negative: null,
        reason: `the control mark ${positive.mark} returned 0 records. It is registered in every major `
              + "jurisdiction, so a zero here means the lane is not retrieving — a dead or wrong-scoped "
              + "credential produces exactly this, and so does a query path that has stopped working." };
    }

    const negative = await one(controls.negative);
    // The lane RETRIEVES — that is proven and the negative control cannot unprove it. A negative control
    // that misbehaves is reported beside the proof, never instead of it.
    let caveat = null;
    if (!negative.ok || negative.total === null) {
      caveat = `the negative control ${negative.mark} could not be counted (${negative.reason ?? "no reason"}), `
             + "so `0 means none` is unverified on this lane — retrieval is still proven.";
    } else if (negative.total > 0) {
      caveat = `the negative control ${negative.mark} returned ${negative.total} records. It is not a `
             + "registrable form, so the lane is matching something other than the query it was given — "
             + "retrieval is proven, but a zero from this lane cannot yet be read as `none`.";
    }
    return { state: "proven", spend, positive, negative, caveat,
      reason: `${positive.mark} returned ${positive.total} records — the lane retrieved, so the credential, `
            + "the transport and the query path all work." };
  };
}
