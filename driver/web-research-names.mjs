// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// web-research-names.mjs — the web-research services' names, and nothing that reads the environment.
//
// A LEAF THAT READS NO SETTING, on purpose. The run's record (engine/run-choices.mjs) and the configuration
// (driver.config.mjs) need the names, and every tool server imports both; a module that read the setting or the billing
// rules here would put those settings into every tool server's reach, which none is handed (web-research.mjs reads them).

export const WEB_RESEARCH_SETTING = "CLEAROTRON_WEB_RESEARCH";
export const WEB_RESEARCH_SERVICES = Object.freeze(["own", "perplexity"]);
/** The service of a run recorded before the setting existed, which ran there. An installation that names none chooses none. */
export const WEB_RESEARCH_BEFORE_THE_SETTING = "perplexity";
export const PERPLEXITY_KEY = "PERPLEXITY_API_KEY";

// THE PARTS OF A CLEARANCE'S WEB RESEARCH THAT OWN SEARCH DOES NOT RUN YET, each still sent to Perplexity. While one is
// listed, own search needs the Perplexity key for it, and says so: a part with no service would be a question the writer
// is refused, which a report reads as "no result". Each part leaves the list when own search runs it. None is listed:
// own search runs the dictated searches, the meaning re-asks, a Knockout's owner lookups and every stage's questions.
export const OWN_SEARCH_STILL_PERPLEXITY = Object.freeze([]);

/**
 * The installation's web-research service: `{ service, chosen: true }`; `{ service: null, chosen: false, unset: true }`
 * for an installation that names none; `{ service: null, chosen: true, invalid }` for a value that names no service.
 * Neither null is ever read as a service: the door refuses each by name. PURE: it reads only the
 * environment it is handed, so the flag snapshot and the run door read the setting the same way.
 */
export function installWebResearch(env = process.env) {
  const raw = String(env?.[WEB_RESEARCH_SETTING] ?? "").trim().toLowerCase();
  if (!raw) return { service: null, chosen: false, unset: true };
  if (WEB_RESEARCH_SERVICES.includes(raw)) return { service: raw, chosen: true };
  return { service: null, chosen: true, invalid: raw };
}
