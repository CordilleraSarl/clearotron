// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// registry.mjs — which engine adapters this driver ships, and which one this activation runs.
//
// The gateway asks this module and names no engine itself, so an engine is added here and in its own
// adapter, and the stage ladder does not change.

import { resolveModel } from "../driver.config.mjs";
import { anthropicAgentEngine } from "./anthropic-agent.mjs";
import { openaiAgentEngine } from "./openai-agent.mjs";

// ── Engine seam (CLEAROTRON_AI) ──────────────────────────────────────────────────────────────────
// The 14 stages run on the anthropic-agent engine (`claude -p` off-gateway with the stall-watchdog; see
// engine/CONTRACT.md). Its runTurn() returns the normalized tuple runStage consumes
// ({code,killed,wall,stdout,stderr,laneWaitMs,json,usage,sessionRef,signals}); all the
// classification/retry/warm logic below is engine-agnostic. There is no second exec path beside it —
// the comms one-shots that used to have one now write outbox packets and spawn nothing.
//
// Engine registry (provider adapters). The driver orchestration + the classification/retry/warm ladder are
// ENGINE-AGNOSTIC: everything provider-specific lives behind an engine's runTurn() → the normalized tuple. So
// provider CHOICE (e.g. Anthropic → OpenAI) = which adapter is registered and selected via CLEAROTRON_AI —
// NOT a model-name swap: each provider needs its own agentic-runtime adapter (MCP/tools/skills/streaming/resume).
// One is implemented today: `anthropic-agent` (`claude -p`, off-gateway). Adding e.g. `openai-agent` = write
// engine/openai-agent.mjs implementing the same runTurn() contract (engine/CONTRACT.md §1), registerEngine() it,
// and select it via CLEAROTRON_AI — runStage is untouched. (The legacy gateway-bin engine removed in the
// extraction was a *runtime*, not a provider choice, and coupled the driver to one integrator platform.) An
// unknown CLEAROTRON_AI fails loud — no silent wrong-provider run. There are no comms stages: every
// requester-facing event is an outbox packet (docs/DELIVERY.md).
const ENGINES = new Map([
  [anthropicAgentEngine.name, anthropicAgentEngine],
  [openaiAgentEngine.name, openaiAgentEngine],   // second provider adapter (codex exec) — CLEAROTRON_AI=openai-agent
]);
export const DEFAULT_ENGINE = anthropicAgentEngine.name;   // "anthropic-agent" — production default UNCHANGED
/**
 * The ids this registry actually holds — read-only, so a SECOND list can be pinned against the first
 * rather than drifting away from it in silence. `ENGINE_BINARIES` in driver.config names the
 * binary variable per engine and the wizard builds its menu from it; without this, "the wizard offers
 * an engine the driver does not ship" and "the driver ships an engine setup cannot reach" are both
 * invisible until a reader picks the row that does not exist. Same guarantee the register-provider
 * list already has (onboard-wizard.test.mjs, "a new adapter must not be invisible to setup").
 */
export function registeredEngines() { return [...ENGINES.keys()]; }
export function registerEngine(engine) {
  if (!engine?.name || typeof engine.runTurn !== "function") throw new Error("registerEngine: expected an { name, runTurn } engine adapter");
  ENGINES.set(engine.name.toLowerCase(), engine);
}

/**
 * The machine's engine: the one a run STARTS on. PROCESS-WIDE, and the missing parameter is the point. A run
 * that has started serves its turns from the engine it recorded then (`engineForRun` in run-choices.mjs), so
 * a later change to `CLEAROTRON_AI` reaches new runs only.
 *
 * This took a `_stageName` it ignored, under a call-site comment reading "per-stage: CLEAROTRON_AI base,
 * comms forced to the gateway, override-able". None of that existed: no per-stage override, no comms
 * forcing, no per-job override. `CLEAROTRON_AI` is read from the process env at every activation and
 * governs every stage of every job in it.
 *
 * A comment describing a capability that does not exist is worse than no comment — it gets believed and
 * planned against, and the plan only fails once someone tries to use it. Corrected rather than built:
 * per-stage selection is an architecture change (a job spec would have to carry the engine, and the
 * routing would have to survive resume), not a comment fix.
 *
 * WHAT THE ABSENCE COSTS, stated so a round plan does not discover it mid-round: **an A/B cannot run
 * both engines concurrently on one instance.** Comparing codex against anthropic means flipping
 * CLEAROTRON_AI and running sequentially, or standing up a second instance with its own env, pool and
 * ports. The same absence blocks routing the refutation reviewer to a different engine for family
 * diversity (ENGINE-OPENAI-ADAPTER §6). Recorded in docs/E2E.md, which is where a round plan looks.
 */
/** The registered adapter for one engine name, or null: no fallback to the machine's engine. */
export function engineNamed(id) { return ENGINES.get(String(id ?? "").trim().toLowerCase()) ?? null; }

export function selectEngine() {
  const id = (process.env.CLEAROTRON_AI || DEFAULT_ENGINE).toLowerCase();
  const engine = ENGINES.get(id);
  if (!engine) throw new Error(`CLEAROTRON_AI="${id}" is not a registered engine adapter (available: ${[...ENGINES.keys()].join(", ")}). Implement one and registerEngine() it — see engine/CONTRACT.md.`);
  return engine;
}

/**
 * The model id a turn's rows record as asked for: the engine's own `resolveModelId`, or, for an adapter
 * that declares none, Claude's catalog (`resolveModel`), which is what every such row has carried.
 */
export function modelIdOf(engine, model) {
  return engine.resolveModelId ? engine.resolveModelId(model) : resolveModel(model);
}
