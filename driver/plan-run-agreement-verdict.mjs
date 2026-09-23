// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// DO describe_options AND plan_run AGREE ON WHICH PRODUCTS ARE AVAILABLE — the deployment check's arm,
// extracted so it can be driven without a door to call (the reason surface-exit-verdict.mjs gives).
//
// A plan_run that THROWS compared nothing. A 429 from the door's rate limit, a timeout, a refused
// connection: each means the question was never answered, and the check used to file it beside the real
// disagreements and exit 1, "drifted". Three runs of the check in two minutes exhausted the ops door's
// rate limit and the third reported a drift that a redeploy could not have fixed. So an unanswered ask is
// a marked skip, which exits 3, and only an answer that contradicts describe_options is a drift.

// The blocker wording plan_run uses for a product it will not run.
const UNAVAILABLE = /not part of the current release|not switched on|unavailable/i;

/**
 * Ask plan_run about each product describe_options listed, and say whether the two agree.
 *
 * @param {{ keys: string[], doorSays: Map<string, boolean>, probeProfileKey: string|null,
 *           ask: (key: string) => Promise<{blockers?: unknown[]}> }} input
 *   `ask` is the plan_run call for one product; a throw is a question that was not answered.
 * @returns {Promise<{state: "pass"|"fail"|"skip", message: string, blocked?: true}>}
 */
export async function planRunAgreementVerdict({ keys = [], doorSays = new Map(), probeProfileKey = null, ask }) {
  if (!probeProfileKey) {
    return { state: "skip", message: "no customer resolved to plan against — see the roster check" };
  }
  const disagreements = [];
  const unanswered = [];
  for (const key of keys) {
    let plan;
    try { plan = await ask(key); } catch (e) { unanswered.push(`${key}: ${String(e?.message ?? e).slice(0, 120)}`); continue; }
    const unavailable = (plan?.blockers ?? []).some((b) => UNAVAILABLE.test(String(b)));
    if (unavailable !== !doorSays.get(key)) {
      disagreements.push(`${key}: describe_options=${doorSays.get(key) ? "available" : "unavailable"} plan_run=${unavailable ? "unavailable" : "available"}`);
    }
  }
  // A drift outranks an unanswered ask, as in exitFor: the drift is actionable now. The unanswered
  // products stay on the line so the report does not read as though they were compared.
  if (disagreements.length) {
    return { state: "fail", message: disagreements.join(" · ")
      + (unanswered.length ? ` · and plan_run gave no answer for ${unanswered.length}: ${unanswered.join(" · ")}` : "") };
  }
  if (unanswered.length) {
    return { state: "skip", blocked: true, message: `could not ask plan_run about ${unanswered.length} of ${keys.length} product(s), `
      + `so those were not compared — ${unanswered.join(" · ")}` };
  }
  return { state: "pass", message: `${keys.length} products checked through both code paths` };
}
