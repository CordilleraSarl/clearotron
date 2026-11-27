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
// AN INSTALLATION THAT NAMES NO SERVICE HAS CHOSEN NONE, and nothing chooses for it. A clearance that needs the web half
// is refused at the door with what to set, before anything is spent; a Knockout, whose answer stands without the web
// half, runs its register half and says the web half did not run. An installation upgraded from before the setting
// had the setting written once, by the upgrade, from its own record of research that ran on Perplexity
// (web-research-upgrade.mjs), never from its keys.
//
// A RUN KEEPS THE SERVICE IT STARTED ON (engine/run-choices.mjs). A run recorded before the setting existed ran on
// Perplexity and resumes there.
//
// IT IS NEVER A TOOL SERVER'S IMPORT: it reads the setting and the billing rules (engine/auth.mjs), which no tool server is
// handed. The names alone live in web-research-names.mjs, for the modules tool servers do import.
import { resolveAuthMode } from "./engine/auth.mjs";
import { QUESTION_TIERS, questionModel } from "./engine/mcp/own-search.mjs";   // the model each product's questions are ruled for
import { openaiModel } from "./engine/openai-agent.mjs";   // — as the Codex engine names it

import { OWN_SEARCH_STILL_PERPLEXITY, PERPLEXITY_KEY, WEB_RESEARCH_BEFORE_THE_SETTING, WEB_RESEARCH_FALLBACK_SETTING, WEB_RESEARCH_SERVICES, WEB_RESEARCH_SETTING } from "./web-research-names.mjs";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { paths } from "./run-record.mjs";
import { questionRoute, QUESTION_ROUTE_FILE } from "./engine/mcp/own-search-setting.mjs";
import { preflightResearchCredential } from "./driver.config.mjs";
export { OWN_SEARCH_STILL_PERPLEXITY, PERPLEXITY_KEY, WEB_RESEARCH_BEFORE_THE_SETTING, WEB_RESEARCH_FALLBACK_SETTING, WEB_RESEARCH_SERVICES, WEB_RESEARCH_SETTING, questionRoute };

const ENGINE_SEARCH = Object.freeze({ "anthropic-agent": "Claude", "openai-agent": "Codex" });

const DEFAULT_ENGINE = "anthropic-agent";

/**
 * The installation's web-research service: `{ service, chosen: true }`; `{ service: null, chosen: false, unset: true }`
 * for an installation that names none; `{ service: null, chosen: true, invalid }` for a value that names no service.
 * Neither null is ever read as a service: the door refuses each by name. PURE.
 */
export function installWebResearch(env = process.env) {
  const raw = String(env?.[WEB_RESEARCH_SETTING] ?? "").trim().toLowerCase();
  if (!raw) return { service: null, chosen: false, unset: true };
  if (WEB_RESEARCH_SERVICES.includes(raw)) return { service: raw, chosen: true };
  return { service: null, chosen: true, invalid: raw };
}

/**
 * Whether this installation can run `service`'s web research: `{ ok, service, missing, why }`. `missing` names the
 * settings a reader can add, never a value; `why` says in a phrase what stands in the way. It places no search and
 * calls no service: a credential that is set but refused is the service's own door's to find. `stillPerplexity` is the
 * parts own search still sends to Perplexity for the product asking, which then need its key; a Knockout asks with none,
 * since its owner lookups are asked of the program itself. PURE.
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
 * THE RUN DOOR FOR WEB RESEARCH: the run's service (`service`; a resumed run's recorded one, or null for a run recorded
 * as having none) or, where `service` is not given, the installation's, checked on the engine the run uses. Throws, as
 * the configuration's door does, before anything is spent. A setting that names no service is refused by name, never
 * read as either service. No service at all is refused for a clearance, whose answer needs the web half; a product
 * not yet known, which its profile settles later, is not refused here, and `refuseUnchosenResearch` asks again once
 * it is (design's ruling, 2026-11-27). IMPURE only through `env`.
 */
export function researchDoor(policy, env = process.env, { service, engine = null } = {}) {
  const install = service === undefined ? installWebResearch(env) : { service };
  if (install.invalid)
    throw new Error(`[preflight] ${WEB_RESEARCH_SETTING}=${install.invalid} names no web-research service on product "${policy?.product}" `
      + `— one of: own (the AI program's own web search) or perplexity; refusing rather than guess which one searches`);
  if (!install.service) {
    if (policy?.components?.commonLawGrid !== true) return { checked: false, component: "commonLawGrid", service: null, credEnv: null, missing: [], ...(policy ? {} : { deferred: true }) };
    throw new Error(notChosenRefusal(policy));
  }
  return preflightResearchCredential(policy, env, { service: install.service,
    own: install.service === "own" ? webResearchCapability({ service: "own", engine, env }) : null });
}

/**
 * THE SAME REFUSAL, ONCE THE RUN'S PRODUCT IS KNOWN: a run with no web-research service whose product needs the web half
 * is refused before its first stage; a Knockout, which runs its register half without one, passes. IMPURE only by
 * throwing.
 */
export function refuseUnchosenResearch(policy) {
  if (policy?.components?.commonLawGrid === true) throw new Error(notChosenRefusal(policy));
}

// ── THE ROUTE A RUN'S QUESTIONS TAKE ON OWN SEARCH ────────────────────────────────────────────────────────────────
//
// A question never runs on a model below the one ruled for its product (design's ruling, 2026-11-26). Measured on the
// test box, 2026-11-27: a Codex ChatGPT sign-in offers no `gpt-6.2-sol`, Full country's model. So the route is resolved
// when the run opens, from the sign-in's own catalog read once with no model call (engine/codex-catalog.mjs), and frozen
// beside the run for every later question and every resume (design's ruling, 2026-11-27):
//   · the model is in the catalog: the run's own AI program answers;
//   · Full country, the model is missing, and the installer configured the fallback with its key: Perplexity answers
//     those questions, disclosed before the order runs and in the report;
//   · Full country, the model missing with no fallback, or the catalog not readable: the order stops before anything
//     is spent. A catalog that cannot be read is not known, never proof the model is missing nor authority to buy the
//     fallback;
//   · another product whose model the catalog lacks stops too; one whose catalog cannot be read runs, and a question it
//     cannot serve fails with the program's own reason.
export const FULL_COUNTRY = "full-country-search";

/** The words for each case, design's drafts awaiting the owner's yes. */
export const ROUTE_WORDS = Object.freeze({
  fullCountryMissing: "This Codex sign-in lacks the model needed for Full country. Configure the Perplexity fallback or choose a supported AI setup.",
  fullCountryUnknown: "Clearotron could not check whether this Codex sign-in supports Full country. Check the sign-in and try again.",
  fallbackBefore: "Perplexity will handle any questions that need the deepest research level.",
  fallbackReport: "Perplexity answered the deepest research questions.",
});

/** Whether the installer configured the Perplexity fallback, and with its key: `{ configured, keyed }`. PURE. */
export function researchFallback(env = process.env) {
  const configured = String(env?.[WEB_RESEARCH_FALLBACK_SETTING] ?? "").trim().toLowerCase() === "perplexity";
  return { configured, keyed: String(env?.[PERPLEXITY_KEY] ?? "").trim() !== "" };
}

/**
 * The route the run's questions take on own search: `{ route: "own" }`, `{ route: "perplexity", model, disclosure }`,
 * or `{ stop, why, detail }` where the order stops before anything is spent. `catalog` is the sign-in's model catalog
 * (a Set), or null where it could not be read. Codex only: Claude's catalog is not read. PURE.
 */
export function ownSearchRoute({ policy, engine, catalog, env = process.env }) {
  // The run's frozen policy names its product `level`; the registry's own entry names it `product`.
  const level = policy?.level ?? policy?.product ?? null;
  const tier = level ? QUESTION_TIERS[level] : null;
  if (engine !== "openai-agent" || !tier) return { route: "own" };
  let model;
  try { model = openaiModel(questionModel(tier, engine)); } catch { return { route: "own" }; }
  const known = catalog instanceof Set;
  if (known && catalog.has(model)) return { route: "own" };
  const detail = `${WEB_RESEARCH_FALLBACK_SETTING}=perplexity, with ${PERPLEXITY_KEY}`;
  if (level === FULL_COUNTRY) {
    if (!known) return { stop: "unknown", model, why: `[preflight] ${ROUTE_WORDS.fullCountryUnknown}`, detail: null };
    const fb = researchFallback(env);
    if (fb.configured && fb.keyed) return { route: "perplexity", model, disclosure: ROUTE_WORDS.fallbackBefore };
    return { stop: "missing", model, why: `[preflight] ${ROUTE_WORDS.fullCountryMissing} (${detail})`, detail };
  }
  if (!known) return { route: "own" };
  return { stop: "missing", model, detail: null, why: `[preflight] This search's research questions need ${model}, which this Codex sign-in does not offer. `
    + "Use Claude, or a Codex sign-in that offers it, then start the search again." };
}

/** Freeze the run's question route, once: a route already frozen is never rewritten. Returns the route that stands. IMPURE. */
export function freezeQuestionRoute(runDir, route) {
  const held = questionRoute(runDir);
  if (held) return held;
  ensureDriverDir(runDir);
  const p = driverDir(runDir, QUESTION_ROUTE_FILE);
  writeFileSync(`${p}.tmp`, JSON.stringify({ schema: 1, route: route.route, ...(route.model ? { model: route.model } : {}),
    ...(route.disclosure ? { disclosure: route.disclosure } : {}), frozenAt: new Date().toISOString() }, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
  return route.route;
}

/**
 * What a report may say about the fallback, from the run's own call log: `{ line, answered, failed }`. `line` is the
 * report's sentence only where every fallback question the run asked was answered; none asked attributes nothing to
 * Perplexity, and some failed leaves the line null for the actual outcome to be reported. IMPURE (reads).
 */
export function fallbackReport(runDir) {
  let answered = 0, failed = 0;
  let text = "";
  try { text = readFileSync(paths(runDir).readingLog, "utf8"); } catch { return { line: null, answered, failed }; }
  for (const l of text.split("\n")) {
    let row; try { row = JSON.parse(l); } catch { continue; }
    if (row?.tool !== "perplexity_research" || row.fallback !== true || row.args?.grid) continue;
    if (row.ok === true) answered++; else failed++;
  }
  return { line: answered > 0 && failed === 0 ? ROUTE_WORDS.fallbackReport : null, answered, failed };
}

/** The door's words for an installation that has chosen no web-research service. PURE. */
export function notChosenRefusal() {
  return "[preflight] Choose a web research service before starting this clearance. Run npx clearotron install.";
}
