// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/auth.mjs — billing-mode ("auth") resolution shared by the gateway and the engine adapters. This
// is what makes the "subscription vs API-key billing" toggle PROVABLE (W3):
//   • FAIL LOUD — a mode that claims API billing but has NO key throws here, instead of silently falling
//     through to the subscription (the pre-existing anthropic footgun: you think you are API-metered and
//     you are not). The gateway calls this once at the top of runStage, so the throw is controlled and
//     happens BEFORE any turn runs — and it fixes the anthropic path WITHOUT editing anthropic-agent.mjs.
//   • STAMP — the resolved { provider, mode, apiBilled } is recorded on the per-attempt telemetry row and
//     the run manifest, so any run can be SHOWN to have billed the way it claims.
// Provider-blind by design; a future/unknown engine gets a no-policy "unknown" result and never throws.
//
// STILL DEPENDENCY-FREE. `shared/env-aliases.mjs` is a frozen table and three pure functions — no node
// imports, no I/O — so importing it keeps every property this file's header claims.

// ONE NAME, READ THE SAME WAY BY BOTH ENGINES — and that is the design, not an accident of the rename.
//
// had each read take the current spelling first and then that engine's own legacy one, because
// BILLING was a COLLAPSE row: two old names folded into one new one, and resolving through the whole
// spelling list let the OpenAI half decide how an Anthropic run bills. deleted the old names, so
// there is one variable, only the selected engine is ever consulted, and the hazard has no route left.
//
// And deliberately written OUT at each site rather than through a helper: 's guard in
// `env-governance.test.mjs` finds a product read by the literal `env.NAME`, so a helper taking the
// name as an argument makes both reads invisible to it — measured, it turned them harness-only and
// put both names on the "no longer read by product code" list. The repetition is what keeps them
// visible to the census that has to see them.

export function resolveAuthMode({ engineName, env = process.env } = {}) {
  const name = String(engineName || "").toLowerCase();

  if (name === "anthropic-agent") {
    const mode = (env.CLEAROTRON_AI_BILLING || "subscription").toLowerCase() === "api-key" ? "api-key" : "subscription";
    if (mode === "api-key" && !env.ANTHROPIC_API_KEY)
      throw new Error(
        `CLEAROTRON_AI_BILLING=api-key but ANTHROPIC_API_KEY is not set — refusing to silently bill the ` +
        `subscription instead. Set the key, or use CLEAROTRON_AI_BILLING=subscription.`);
    return { provider: "anthropic", mode, apiBilled: mode === "api-key" };
  }

  if (name === "openai-agent") {
    const mode = (env.CLEAROTRON_AI_BILLING || "subscription").toLowerCase() === "api-key" ? "api-key" : "subscription";
    if (mode === "api-key" && !env.CODEX_API_KEY)
      throw new Error(
        `CLEAROTRON_AI_BILLING=api-key but CODEX_API_KEY is not set — refusing to silently bill the ChatGPT ` +
        `subscription instead. Set the key, or use CLEAROTRON_AI_BILLING=subscription.`);
    return { provider: "openai", mode, apiBilled: mode === "api-key" };
  }

  return { provider: name || "unknown", mode: "unknown", apiBilled: false };
}
