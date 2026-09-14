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
// And deliberately written OUT as a literal rather than passed to a helper as an argument: the env
// audit finds a product read by the literal `env.NAME`, so a helper taking the name as an argument makes
// the read invisible to it — measured, it turned the reads harness-only and put the name on the "no
// longer read by product code" list. `billingMode` below spells the name out, which keeps it visible.

// THREE MODES FOR CLAUDE, AND NOTHING ELSE IS A MODE. `cloud` bills Claude through the reader's own
// Google, Microsoft or Amazon account, or through a gateway in front of one (ANTHROPIC_BASE_URL). The
// vendor's program already routes on its own switches, which reach it because the stage environment is
// the driver's; what was missing was a billing word that says so. Without it a cloud machine had two
// choices and both were wrong: `api-key` refused for want of an Anthropic key the machine does not have,
// and `subscription` ran and stamped every row as billed to a subscription nobody was paying.
//
// AN UNKNOWN WORD IS REFUSED. It used to run as `subscription` on both engines, so a typo in the one
// setting that decides who pays was a quiet bill to the wrong account. It refuses here, at the top of
// runStage, in the probe and in the jx runner, before any turn runs.
export const BILLING_MODES = Object.freeze(["subscription", "api-key", "cloud"]);

/**
 * The billing word as the environment writes it, normalised and NOT validated: unset or blank reads as
 * the default. The one parse of the word. `resolveAuthMode` validates it; the anthropic adapter's
 * `spawnEnv`, which must never throw, reads it through here rather than parsing it a second way.
 */
export function billingMode(env = process.env) {
  return String(env.CLEAROTRON_AI_BILLING ?? "").trim().toLowerCase() || "subscription";
}

// The vendor's own switches, read the way its program reads them: "1", "true", "yes" or "on" switches
// one on. Spelled out one per line for the reason given above. The order is only the order a refusal
// names them in.
const switchedOn = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
const CLOUD_SWITCH = Object.freeze({ vertex: "CLAUDE_CODE_USE_VERTEX", foundry: "CLAUDE_CODE_USE_FOUNDRY", bedrock: "CLAUDE_CODE_USE_BEDROCK" });
function cloudsSwitchedOn(env) {
  const on = [];
  if (switchedOn(env.CLAUDE_CODE_USE_VERTEX)) on.push("vertex");
  if (switchedOn(env.CLAUDE_CODE_USE_FOUNDRY)) on.push("foundry");
  if (switchedOn(env.CLAUDE_CODE_USE_BEDROCK)) on.push("bedrock");
  return on;
}

// Every refusal below carries `billingRefusal: true`, so a reader classifies it by what it is rather than
// by its wording: the probe does, and a sign-in error that also names this setting is not one of these.
const refuse = (message) => Object.assign(new Error(message), { billingRefusal: true });
const notAMode = (mode, modes) => refuse(
  `CLEAROTRON_AI_BILLING=${mode} is not a billing mode — refusing to guess, because the guess would bill ` +
  `the subscription. One of: ${modes.join(", ")}.`);

export function resolveAuthMode({ engineName, env = process.env } = {}) {
  const name = String(engineName || "").toLowerCase();

  if (name === "anthropic-agent") {
    const mode = billingMode(env);
    if (mode === "api-key" && !env.ANTHROPIC_API_KEY)
      throw refuse(
        `CLEAROTRON_AI_BILLING=api-key but ANTHROPIC_API_KEY is not set — refusing to silently bill the ` +
        `subscription instead. Set the key, or use CLEAROTRON_AI_BILLING=subscription.`);
    const on = cloudsSwitchedOn(env);
    // A cloud's switch sends the program to that cloud whatever the billing word says. Measured on Foundry,
    // 2026-09-14: with the switch on and the word unset, the program reported Foundry as its provider and
    // the row was stamped as the subscription's. So a switch beside `subscription` or `api-key` is refused,
    // after a missing key, which is the fault the config page names first.
    if ((mode === "subscription" || mode === "api-key") && on.length)
      throw refuse(
        `${on.map((c) => CLOUD_SWITCH[c]).join(" and ")} ${on.length > 1 ? "are" : "is"} on, which sends Claude to ` +
        `that cloud account, while CLEAROTRON_AI_BILLING says ${mode} — refusing rather than record the wrong ` +
        `account. Use CLEAROTRON_AI_BILLING=cloud, or ${on.length > 1 ? "turn them off" : "turn the switch off"}.`);
    if (mode === "subscription") return { provider: "anthropic", mode, apiBilled: false };
    if (mode === "api-key") return { provider: "anthropic", mode, apiBilled: true };
    if (mode === "cloud") {
      if (on.length > 1)
        throw refuse(
          `CLEAROTRON_AI_BILLING=cloud but more than one cloud is switched on ` +
          `(${on.map((c) => CLOUD_SWITCH[c]).join(", ")}) — set exactly one, so the run can say which account it bills.`);
      // A switch names the cloud. ANTHROPIC_BASE_URL alone is the gateway form: a cloud reached through the
      // reader's own proxy. With a switch also set, the switch is what the program routes on.
      const cloud = on[0] ?? (env.ANTHROPIC_BASE_URL ? "gateway" : null);
      if (!cloud)
        throw refuse(
          `CLEAROTRON_AI_BILLING=cloud but none of CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY, ` +
          `CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_BASE_URL is set — refusing to silently bill the subscription ` +
          `instead. Set the one for your cloud (INSTALL.md), or use CLEAROTRON_AI_BILLING=subscription.`);
      return { provider: "anthropic", mode, apiBilled: true, cloud };
    }
    throw notAMode(mode, BILLING_MODES);
  }

  if (name === "openai-agent") {
    const mode = billingMode(env);
    if (mode === "cloud")
      throw refuse(
        `CLEAROTRON_AI_BILLING=cloud bills Claude through a cloud account, and this machine runs the Codex ` +
        `engine — refusing rather than billing the ChatGPT subscription instead. Use subscription or api-key ` +
        `with Codex, or CLEAROTRON_AI=anthropic-agent for a cloud account.`);
    if (mode !== "subscription" && mode !== "api-key") throw notAMode(mode, ["subscription", "api-key"]);
    if (mode === "api-key" && !env.CODEX_API_KEY)
      throw refuse(
        `CLEAROTRON_AI_BILLING=api-key but CODEX_API_KEY is not set — refusing to silently bill the ChatGPT ` +
        `subscription instead. Set the key, or use CLEAROTRON_AI_BILLING=subscription.`);
    return { provider: "openai", mode, apiBilled: mode === "api-key" };
  }

  return { provider: name || "unknown", mode: "unknown", apiBilled: false };
}
