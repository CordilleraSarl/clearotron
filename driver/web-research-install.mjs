// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// web-research-install.mjs — the installation's web-research setting, read in one place.
//
// Its own leaf, apart from web-research-names.mjs: that one reads no setting because every tool server imports it, and
// no tool server is handed this one. The run door (web-research.mjs) and the flag snapshot both read it here, so a
// screen that reads the snapshot and the door that runs the search cannot read the setting two ways.
import { WEB_RESEARCH_SERVICES, WEB_RESEARCH_SETTING } from "./web-research-names.mjs";

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
