// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stage.mjs — one stage run's options, files, billing and tools, fixed before its first attempt.
//
// The stage ladder (gateway.mjs runStageLadder) asks this once per stage run and hands the answer to every phase of
// every attempt. It refuses a dispatch with no message or no session key, and a billing mode it cannot honour.

import { config } from "../driver.config.mjs";
import { withSendUntil } from "../engine/mcp/gather-config.mjs";
import { sendReserveMs } from "../../providers/_shared/send-until.mjs";   // each turn's plan calls stop sending ahead of its deadline
import { resolveAuthMode } from "../engine/auth.mjs";
import { REGISTER_ENUMERATE_TOOL } from "../stages.mjs";
import { stageTools } from "./stage-tools.mjs";

export function stageOf(name, opts, stageHome, engine) {
  const {
    agent = config.defaultAgent,
    message,
    // — OPTIONAL PER-ATTEMPT RECOMPOSE. A stage may declare that its dispatch text depends on state
    // the run changes between attempts; when it does, this recomposes the base the corrective text is
    // appended to. Absent — which is every stage but one — the base stays exactly `message`, byte for
    // byte, and there is a test that drives both arms to prove it.
    //
    // A CAPABILITY THE STAGE DECLARES, not a flag hiding a second path: there is no configuration that
    // turns this on for a stage that did not ask, and no branch a reader has to know about to predict what
    // a stage sends.
    refreshMessage,
    model,
    thinking,
    sessionKey,
    timeoutSec = 600,
    stallSec,          // per-stage stall override (anthropic-agent only); falls back to global CLEAROTRON_STALL_MS
    expectFile = [],
    validate,
    maxRetries = config.maxRetries,
    runDir,
    followup = false,   // the caller's word that this dispatch is a followup: a FRESH session (attempt 1, no
                        // resumeRef), journalled on every row beside `warm`. At its hard wall it takes the same
                        // one extended retry as any fresh dispatch (warmHardWallStop stops only a warm attempt).
    excludeTools, bandSize, derivedLimit = null,   // copper-lattice re-route: tool names dropped from this stage's allowedTools
    // THE CORRECTION THIS DISPATCH IS, when it is one: `{positions}`, the excluded positions its flags name. Its save may
    // add a finding for them, and its retries say so (`patchRows`); every other dispatch carries none.
    correction = null,
  } = opts;
  const adds = Boolean(correction);
  if (!message) throw new Error(`runStage(${name}): message is required`);
  if (!sessionKey) throw new Error(`runStage(${name}): sessionKey is required`);
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  // ION/copper-foundry 2026-07-22: this file cannot see the plan's supplemental_lane contract, and it
  // must not grow a second flag that could drift from it — so derive the lane from the ONE observable
  // that the contract produces here, the removed tool. Every corrective/warm re-dispatch below then
  // agrees with the toolset the attempt actually gets, instead of contradicting the base prompt.
  const supplementalLane = Array.isArray(excludeTools) && excludeTools.includes(REGISTER_ENUMERATE_TOOL);

  // Billing-mode (auth) resolution — fail LOUD if a mode claims API billing but has no key (fixes the
  // anthropic silent-fallthrough WITHOUT editing anthropic-agent.mjs), and give the stamp its value. Frozen
  // per run (env-derived). The throw is caught by pipelineInner's terminal catch and turned into a run
  // FAILURE carrying the named auth error on the guaranteed failure-packet lane (verified) — loud + named,
  // NOT a silent mis-bill. (Same catch as the unknown-engine throw above.)
  const auth = resolveAuthMode({ engineName: engine.name });
  // The stage's tool servers, allowed tools, skills folder and read grants, by the engine's two capability flags
  // (ladder/stage-tools.mjs).
  const { gatherMcpConfig, gatherAllowedTools, gatherSeatWrites, engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill } =
    stageTools({ engine, name, sessionKey, agent, runDir, correction, excludeTools });
  // EACH TURN'S OWN COPY of the stage's tool config, carrying that turn's time to stop sending: ahead of the turn's
  // deadline by the reserve, so a plan call returns what it holds while the turn can still write it (send-until.mjs).
  const turnConfig = (sec) => withSendUntil(gatherMcpConfig, Date.now() + sec * 1000 - sendReserveMs(sec));
  return { name, engine, stageHome, agent, message, refreshMessage, model, thinking, sessionKey, timeoutSec, stallSec, files, validate,
    maxRetries, runDir, followup, bandSize, derivedLimit, adds, supplementalLane, auth, gatherAllowedTools, gatherSeatWrites,
    engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill, turnConfig };
}
