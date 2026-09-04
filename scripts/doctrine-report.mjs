#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import "../shared/env-local.mjs";   // — FIRST: this entry reaches driver/driver.config.mjs, which
                                    // captures env at module top, and a call in this file's BODY runs
                                    // after every static import has evaluated. Declared NO_DOTFILE
                                    // in shared/env-local.mjs: a report reads the install it is pointed
                                    // at and must not pick up a repo .env that aims it somewhere else.
//
// Which doctrine files this install overrides, and whether upstream has moved since.
//
//   node scripts/doctrine-report.mjs [--json]
//
//. The overlay resolution is read from `driver.config.mjs`, the SAME source the engine resolves
// with, so this report cannot come to disagree with the engine about which file actually runs.

import { dirname } from "node:path";
import { config as CONFIG } from "../driver/driver.config.mjs";
import { overlayReport, renderOverlayReport } from "../shared/doctrine-overlay.mjs";

let asJson = false;
for (const a of process.argv.slice(2)) {
  if (a === "--json") asJson = true;
  else { console.error(`unknown argument: ${a}`); process.exit(2); }
}

// resolveSkillPath() joins `dirname(root)` with a `skills/…`-relative path, so the TREE both layers are
// compared at is the `skills` directory itself.
const baseRoot = CONFIG.skillsBaseDir;
const overlayRoot = CONFIG.skillsOverlayDir;

const report = overlayReport({ baseRoot, overlayRoot });

if (asJson) {
  console.log(JSON.stringify({ base_root: baseRoot, overlay_root: overlayRoot, ...report }, null, 2));
} else {
  console.log();
  console.log(`  base:    ${baseRoot}`);
  console.log(`  overlay: ${overlayRoot ?? `(none configured — CLEAROTRON_INSTRUCTIONS_DIR is unset)`}`);
  console.log();
  console.log(renderOverlayReport(report, { indent: "  " }).join("\n"));
  console.log();
}
// This REPORTS; it does not judge and it merges nothing. Exit 0 means the report ran — a non-zero exit
// is reserved for a report that could not be produced, never for drift it found.
process.exit(report.ok ? 0 : 1);
