// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/driver.mjs — the SINGLE coupling point to the prelim-driver.
//
// Everything the MCP imports from the deterministic driver passes through here, so the dependency surface
// is one file: if the driver renames an export, this file fails loudly (test-caught), instead of silent
// drift. We import ONLY dependency-free driver modules (parse/verify/provider-usage/compare/stages/log/
// phase0/config/progress) — so the read-only server starts light. The what-if engine (pipeline.mjs, which
// transitively pulls publish/index.mjs → exceljs + native addons) is imported LAZILY inside lib/whatif.mjs,
// never here. Read-only: the MCP never edits any driver file.

export {
  paths, STAGES, STAGE_ORDER, stageInputs, stageOrdinal,
  REGISTER_AXES, decideAxes, axisTier,
} from "../../driver/stages.mjs";

// stripInternal/stripEngineInternals/stripTelemetry are the driver's OWN client-safety transforms — the
// same ones publish/render.mjs applies to the client HTML export. lib/scrub.mjs composes them so the MCP
// client surface and the delivered report answer "what may a client see?" from ONE definition ( R1:
// the leak existed because read_artifact re-answered it independently and drifted).
// — `plainify` used to ride here too, and it is DELETED. It was doc-52's presentation sanitizer:
// find-and-replace over a client-facing string, which ate the mark AXIS on a report that was clearing
// AXIS. The coverage rows this surface serves now carry a driver-emitted `areaLabel` beside the
// machine identifier, so there is nothing left to substitute.
// — resolutionForClient / contradictionResolutionForClient are the same idea one layer in: the audit
// block's cross-reference lines carry the placement key inside prose the client keeps, so the client cut
// of THOSE strings is the driver's rule too, not a second answer written in lib/scrub.mjs. parse.mjs now
// imports the disposition enum from findings-model.mjs (→ framework.mjs, node:fs + node:path only), so the
// read-only server's "dependency-free driver modules" discipline is unchanged.
export {
  parseAudit, parseReport, parseBlocks, parseFront, parseSections, plain,
  stripInternal, dropLabelledInternals, stripEngineInternals, stripTelemetry,
  resolutionForClient, contradictionResolutionForClient,
} from "../../driver/publish/parse.mjs";

export { buildAuditMd } from "../../driver/publish/audit-from-spine.mjs";

export { validators, parseVerdict, hasCoverageLedgerRow } from "../../driver/verify.mjs";

export { tallyRegisterCalls, DEFAULT_LEDGER_PATH } from "../../driver/provider-usage.mjs";

export { compareCmd, diffStageOutputs, telemetryDelta } from "../../driver/compare.mjs";

export { fileMeta } from "../../driver/log.mjs";

export { deriveSlug } from "../../driver/phase0.mjs";

export { config, resolveModel, MODELS } from "../../driver/driver.config.mjs";

// THE ONE PRODUCT-NAME RESOLVER. `reportIdentityFor` is the same registry join the report masthead
// and the portal list row use: it takes a run's FROZEN level (the product id in `_driver/search-policy.json`
// or in report-data.json's `level.searchLevel`) and answers what that product is called TODAY. It rides
// here rather than being imported directly so runs.mjs/brief.mjs keep one coupling point — search-policy.mjs
// is a leaf (node:fs + products.mjs + register-coverage.mjs), so the read-only server stays light.
// The MCP must never store or hardcode a product name: a stored name is exactly the bug removed.
export { reportIdentityFor } from "../../driver/search-policy.mjs";

// Customer roster (key/name/industry) — read-only, for the intake list_profiles tool. profiles.mjs is
// dependency-free (node:fs only), so it keeps the read-only server light (the lib's discipline).
export { loadProfiles, loadProjects } from "../../driver/profiles.mjs";

export { stepForStage, DISPLAY_STEPS } from "../../driver/progress.mjs";
