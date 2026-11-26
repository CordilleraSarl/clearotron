// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/speed.mjs — the speed a session asks its vendor for, and whether this installation can ask for the faster one.
//
// An order placed Urgent runs every session it starts on the vendor's faster setting wherever the session's model has
// one: every stage, its retries, warm resumes and repairs, and the native-language turns. A session whose model has no
// faster setting runs at its usual speed and its record says why. The model, effort, tools and work stay as they are.
// The choice is made once, when the run starts, and recorded with the run (engine/run-choices.mjs), so every retry,
// warm resume and repair asks for the speed its first attempt asked for. Fast and standard keep separate prompt caches,
// so a session that changed speed partway would pay for its whole context again.
//
// A LEAF: it reads the billing answer and the model it is handed, never the environment or a vendor. The order screens
// and the connector ask it whether this installation can run Urgent, before any run exists.

/** The two speeds a turn can ask for. */
export const SPEEDS = Object.freeze(["standard", "fast"]);

/** Why a session of an Urgent order runs at standard speed although the installation can run fast. */
export const STANDARD_BECAUSE = Object.freeze({ modelNotFast: "model-not-fast" });

/**
 * Does this model have the faster setting? Asked of the model the adapter is about to send (`--model` on Claude, `-m`
 * on Codex), never of the tier a stage declares: on Codex a tier's model is a setting, and on Claude a pinned id is
 * sent as itself. An absent model is not one the vendor lists, so it answers no. PURE.
 *
 * Claude, from the vendor's fast-mode page (https://code.claude.com/docs/en/fast-mode, read 2026-11-26), its opening
 * section: "On the Anthropic API, fast mode is supported on Fable 5.2, Opus 5.5, Opus 5, and Opus 4.8, but not on
 * Sonnet, Haiku, or other models", and "Opus 4.7 doesn't support fast mode". The rolling aliases `opus` and `fable`
 * name Opus 5.5 and Fable 5.2 today. The same page says fast mode for Opus 4.8 "will be removed on November 30, 2026";
 * a session pinned to it after that runs at standard speed by the vendor's own fallback, and its record says so.
 *
 * Codex, from its speed page (https://learn.chatgpt.com/docs/agent-configuration/speed.md, read 2026-11-26), section
 * "Fast mode": "Fast mode supports GPT-6.2 Astra and GPT-6.2 Sol. You can also use it with GPT-6.1 Sol, GPT-6.1 Terra,
 * GPT-6 Astra, GPT-6 Sol, and GPT-6 Luna." Those are the three models the Codex tiers default to, and four more.
 */
const CLAUDE_FAST = [/^(?:opus|fable)$/, /^claude-fable-5-2(?:-\d{8})?$/, /^claude-opus-5(?:-5)?(?:-\d{8})?$/, /^claude-opus-4-8(?:-\d{8})?$/];
const CODEX_FAST = new Set(["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);
export function fastSupported({ engine, model } = {}) {
  const id = String(engine ?? "").trim().toLowerCase();
  // A context-window suffix ("[1m]") names the same model.
  const m = String(model ?? "").trim().toLowerCase().replace(/\[[^\]]*\]$/, "");
  if (!m) return false;
  if (id === "anthropic-agent") return CLAUDE_FAST.some((re) => re.test(m.replace(/^anthropic\//, "")));
  if (id === "openai-agent") return CODEX_FAST.has(m.replace(/^openai\//, ""));
  return false;
}

/**
 * What one session sends: `{ sent, standardBecause }`. `ordered` is the speed the run asks of every session
 * (`turnSpeed`); `model` the one the adapter is about to send. A session of a fast run whose model has no faster
 * setting sends standard and names why; a standard run's sessions send standard with nothing to explain. PURE.
 */
export function sessionSpeed({ ordered = "standard", engine, model } = {}) {
  if (ordered !== "fast") return { sent: "standard", standardBecause: null };
  return fastSupported({ engine, model }) ? { sent: "fast", standardBecause: null } : { sent: "standard", standardBecause: STANDARD_BECAUSE.modelNotFast };
}

/**
 * Can this installation run Urgent: `{ available, reason }`. `engine` is the engine id, `auth` the billing answer the
 * run would use (engine/auth.mjs resolveAuthMode: `{ mode, cloud }`). `reason` is null when available, otherwise a
 * fixed word naming why. Nothing here calls a vendor. PURE.
 *
 * Claude, from the vendor's fast-mode page (https://code.claude.com/docs/en/fast-mode, read 2026-11-26), section
 * "Requirements": fast mode "is available through the Anthropic Console API, for Claude subscription plans using usage
 * credits, and on Google Cloud's Agent Platform with conditions", and "It is not available on Amazon Bedrock, Microsoft
 * Foundry, or Claude Platform on AWS". Section "Use fast mode on Agent Platform": there it can be turned on "for
 * Fable 5.2" only, and the stages run Opus, so Agent Platform answers no. A subscription without usage credits,
 * or an organisation that has switched fast mode off, still answers yes here: the program then runs the turn at
 * standard speed (section "Handle rate limits"), and the turn's own record says so.
 *
 * Codex: the faster tier is a per-call setting on every billing route Codex offers (its config reference,
 * `service_tier`); the program reports no served tier, which the turn's record says rather than this answer.
 */
export function urgentAvailability({ engine, auth } = {}) {
  const id = String(engine ?? "").trim().toLowerCase();
  if (id === "openai-agent") return { available: true, reason: null };
  if (id !== "anthropic-agent") return { available: false, reason: "unknown-engine" };
  if (auth?.mode === "cloud") {
    if (auth.cloud === "vertex") return { available: false, reason: "fable-only-on-this-cloud" };
    // Bedrock, Foundry, and a gateway in front of either: the vendor names the first two as not available, and a
    // gateway gives no way to know which provider serves it.
    return { available: false, reason: "not-on-this-cloud" };
  }
  if (auth?.mode === "api-key" || auth?.mode === "subscription") return { available: true, reason: null };
  return { available: false, reason: "unknown-billing" };
}

/**
 * What a run records about Urgent when it starts: `{ ordered, fast, reason }`. `fast` is true only when the order
 * asked for Urgent and the installation can run it; an order this installation cannot serve runs at standard speed and
 * says why. PURE.
 */
export function urgentDecision({ ordered, engine, auth } = {}) {
  const asked = ordered === true;
  if (!asked) return { ordered: false, fast: false, reason: null };
  const a = urgentAvailability({ engine, auth });
  return { ordered: true, fast: a.available, reason: a.reason };
}

/**
 * The speed a run asks of every session it starts: `fast` for a run recorded fast, `standard` otherwise. `urgent` is the
 * run's recorded decision (`urgentDecision`), or null for a run with none. Whether a session's model can take it is the
 * adapter's question (`sessionSpeed`), asked of the model it resolves. PURE.
 */
export function turnSpeed({ urgent = null } = {}) {
  return urgent?.fast === true ? "fast" : "standard";
}
