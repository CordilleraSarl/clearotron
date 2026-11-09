// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-scenario.mjs <spec.json> — one scenario in a process of its own, because driver.config reads the
// environment at import. The coverage variable is cleared at once: this process is measured, and the mock
// programs it starts import driver modules that would otherwise count as lines the driver ran.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

delete process.env.NODE_V8_COVERAGE;
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { pipeline } = await import(join(spec.driver, "pipeline.mjs"));
let result;
try { result = await pipeline(spec.job, spec.opts ?? {}); }
catch (e) { result = { ok: false, threw: String(e?.message ?? e) }; }
writeFileSync(spec.resultFile, JSON.stringify(result));
process.exit(0);
