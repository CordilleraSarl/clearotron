// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/speed.mjs — the speed a turn asks its vendor for, and whether this installation can ask for the faster one.
//
// A job ordered Urgent runs its judgment-tier turns on the vendor's faster setting and every other turn at standard
// speed. The choice is made once, when the run starts, and recorded with the run (engine/run-choices.mjs), so every
// retry, warm resume and repair of a stage asks for the speed its first attempt asked for. Fast and standard keep
// separate prompt caches, so a turn that changed speed mid-stage would pay for its whole context again.
//
// A LEAF: it reads the billing answer it is handed and the shipped-engine table, never the environment or a vendor.
// The order screens and the connector ask it whether this installation can run Urgent, before any run exists.

/** The two speeds a turn can ask for. */
export const SPEEDS = Object.freeze(["standard", "fast"]);

/**
 * Is this model the judgment tier? Keyed on the tier a stage DECLARES, never on the id an engine resolves it to:
 * `opus`, and `fable` where an override names it (engine/CONTRACT.md §3). A catalog id that names one of those two
 * families counts too, so a stage pinned by id keeps its tier. The Codex engine maps the same declared alias onto
 * its judgment model, so one answer serves both engines. PURE.
 */
export function isJudgmentTier(model) {
  const m = String(model ?? "").trim().toLowerCase();
  if (m === "opus" || m === "fable") return true;
  return /^(?:anthropic\/)?claude-(?:opus|fable)(?:-|$)/.test(m);
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
 * Fable 5.2" only, and the judgment tier is Opus, so Agent Platform answers no. A subscription without usage credits,
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
 * The speed one turn asks for: `fast` on a judgment-tier turn of a run recorded fast, `standard` on every other turn.
 * `urgent` is the run's recorded decision (`urgentDecision`), or null for a run with none. PURE.
 */
export function turnSpeed({ urgent = null, model } = {}) {
  return urgent?.fast === true && isJudgmentTier(model) ? "fast" : "standard";
}
