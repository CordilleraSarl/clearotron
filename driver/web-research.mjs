// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// web-research.mjs — which service runs an installation's web research, and whether this installation can run it.
//
// Two services: the run's own AI program's web search ("own"), or Perplexity ("perplexity"). The engine writes the
// list of searches either way; only who runs them differs (engine/mcp/own-search.mjs).
//
// ── ONE SETTING, READ IN ONE PLACE ─────────────────────────────────────────────────────────────────────────────────
//
// `CLEAROTRON_WEB_RESEARCH` names the service. Setup asks for it and writes it; setup, doctor, the installation page,
// start's warning and the run door all read it through `installWebResearch`, and what each service can run here
// through `webResearchCapability`. Nothing decides the service from which keys are present: a Perplexity key on an
// installation set to "own" is not used for its searches, and a missing key on one set to "own" refuses nothing.
//
// AN INSTALLATION THAT NAMES NO SERVICE KEEPS PERPLEXITY, the only service any installation had before this setting
// existed, so an upgrade keeps the route that worked. That is the installation's existing route, not an inference from
// its keys: with no key it still refuses at the door, by name, as before. It is reported as not chosen (`chosen:
// false`), so doctor can say the choice was never made.
//
// A RUN KEEPS THE SERVICE IT STARTED ON (engine/run-choices.mjs). A run recorded before the setting existed ran on
// Perplexity and resumes there.
//
// IT IS NEVER A TOOL SERVER'S IMPORT: it reads the setting and the billing rules (engine/auth.mjs), which no tool server is
// handed. The names alone live in web-research-names.mjs, for the modules tool servers do import.
import { resolveAuthMode } from "./engine/auth.mjs";

import { OWN_SEARCH_STILL_PERPLEXITY, PERPLEXITY_KEY, WEB_RESEARCH_BEFORE_THE_SETTING, WEB_RESEARCH_SERVICES, WEB_RESEARCH_SETTING } from "./web-research-names.mjs";
import { preflightResearchCredential } from "./driver.config.mjs";
export { OWN_SEARCH_STILL_PERPLEXITY, PERPLEXITY_KEY, WEB_RESEARCH_BEFORE_THE_SETTING, WEB_RESEARCH_SERVICES, WEB_RESEARCH_SETTING };

const ENGINE_SEARCH = Object.freeze({ "anthropic-agent": "Claude", "openai-agent": "Codex" });

const DEFAULT_ENGINE = "anthropic-agent";

/**
 * The installation's web-research service: `{ service, chosen }`, or `{ service: null, chosen: true, invalid }` for a
 * value that names no service. An invalid value is never read as either service: the door refuses it by name. PURE.
 */
export function installWebResearch(env = process.env) {
  const raw = String(env?.[WEB_RESEARCH_SETTING] ?? "").trim().toLowerCase();
  if (!raw) return { service: WEB_RESEARCH_BEFORE_THE_SETTING, chosen: false };
  if (WEB_RESEARCH_SERVICES.includes(raw)) return { service: raw, chosen: true };
  return { service: null, chosen: true, invalid: raw };
}

/**
 * Whether this installation can run `service`'s web research: `{ ok, service, missing, why }`. `missing` names the
 * settings a reader can add, never a value; `why` says in a phrase what stands in the way. It places no search and
 * calls no service: a credential that is set but refused is the service's own door's to find. `stillPerplexity` is the
 * parts own search still sends to Perplexity for the product asking, which then need its key; a Knockout asks with none,
 * since its owner lookups take their own course without the key. PURE.
 *
 * Own search follows the engine's route, from the vendors' documentation read on 2026-11-25:
 *   · Claude on a subscription or an API key carries its web search;
 *   · Claude through Amazon Bedrock has none;
 *   · on Google Vertex it is off unless the organisation switched it on, and on Microsoft Foundry and a gateway it is
 *     not documented here, so on those three it is not proved and not offered;
 *   · Codex on a subscription or an API key carries its web search, and the product has no cloud route for Codex.
 */
export function webResearchCapability({ service, engine = null, env = process.env, stillPerplexity = OWN_SEARCH_STILL_PERPLEXITY } = {}) {
  if (!WEB_RESEARCH_SERVICES.includes(service))
    return { ok: false, service: service ?? null, missing: [WEB_RESEARCH_SETTING], why: `${WEB_RESEARCH_SETTING} names no service (one of: ${WEB_RESEARCH_SERVICES.join(", ")})` };
  if (service === "perplexity") {
    const set = String(env?.[PERPLEXITY_KEY] ?? "").trim() !== "";
    return set ? { ok: true, service, missing: [], why: null } : { ok: false, service, missing: [PERPLEXITY_KEY], why: `${PERPLEXITY_KEY} is not set` };
  }
  const name = String(engine ?? env?.CLEAROTRON_AI ?? DEFAULT_ENGINE).trim().toLowerCase() || DEFAULT_ENGINE;
  if (!Object.hasOwn(ENGINE_SEARCH, name))
    return { ok: false, service, missing: [], why: `the ${name} engine has no web search of its own that this product reads` };
  let auth;
  try { auth = resolveAuthMode({ engineName: name, env }); }
  catch (e) { return { ok: false, service, missing: [], why: `the engine's billing setting is refused: ${String(e?.message ?? e).slice(0, 200)}` }; }
  if (auth.mode === "cloud") {
    const why = auth.cloud === "bedrock" ? "Claude through Amazon Bedrock has no web search of its own"
      : `Claude's own web search is not proved through ${auth.cloud === "gateway" ? "a gateway" : auth.cloud === "vertex" ? "Google Vertex" : "Microsoft Foundry"}`;
    return { ok: false, service, missing: [], why, cloud: auth.cloud };
  }
  if (stillPerplexity.length && String(env?.[PERPLEXITY_KEY] ?? "").trim() === "")
    return { ok: false, service, missing: [PERPLEXITY_KEY], search: ENGINE_SEARCH[name], billing: auth.mode,
      why: `${PERPLEXITY_KEY} is not set, and own search still sends its ${stillPerplexity.join(" and ")} to Perplexity` };
  return { ok: true, service, missing: [], why: null, search: ENGINE_SEARCH[name], billing: auth.mode, stillPerplexity: [...stillPerplexity] };
}

/**
 * THE RUN DOOR FOR WEB RESEARCH: the run's service (`service`, a resumed run's recorded one) or the installation's,
 * checked on the engine the run uses. Throws, as the configuration's door does, before anything is spent. A setting
 * that names no service is refused by name, never read as either service. IMPURE only through `env`.
 */
export function researchDoor(policy, env = process.env, { service = null, engine = null } = {}) {
  const install = service ? { service } : installWebResearch(env);
  if (!install.service)
    throw new Error(`[preflight] ${WEB_RESEARCH_SETTING}=${install.invalid} names no web-research service on product "${policy?.product}" `
      + `— one of: own (the AI program's own web search) or perplexity; refusing rather than guess which one searches`);
  return preflightResearchCredential(policy, env, { service: install.service,
    own: install.service === "own" ? webResearchCapability({ service: "own", engine, env }) : null });
}
