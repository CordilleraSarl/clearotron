// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-scenario.mjs <spec.json> — one scenario in a process of its own, because driver.config reads the
// environment at import. The coverage variable is cleared at once: this process is measured, and the mock
// programs it starts import driver modules that would otherwise count as lines the driver ran.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

delete process.env.NODE_V8_COVERAGE;
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { pipeline } = await import(pathToFileURL(join(spec.driver, "pipeline.mjs")).href);
/** A cancel arrives while the first turn is held: the request is written, then the turn is let go. */
function cancelOnceStarted() {
  const timer = setInterval(() => {
    const run = readdirSync(process.env.CLEAROTRON_WORK_DIR, { recursive: true }).find((p) => /[\\/]_driver$/.test(String(p)));
    if (!run) return;
    clearInterval(timer);
    writeFileSync(join(process.env.CLEAROTRON_WORK_DIR, String(run), "..", ".cancel"), JSON.stringify({ by: "snapshot" }));
    writeFileSync(process.env.MOCK_BARRIER_FILE, "released\n");
  }, 25);
}
let result;
try {
  if (spec.cancel) cancelOnceStarted();
  result = await pipeline(spec.job, spec.opts ?? {});
  if (spec.resume) {
    // The fault clears and the same run is asked for again by name, as a resume does.
    delete process.env.MOCK_FAIL_STAGE;
    const codename = String(result.runDir).split(/[\\/]/).pop().split("-").slice(3).join("-");
    result = await pipeline(spec.job, { ...(spec.opts ?? {}), codename });
  }
} catch (e) { result = { ok: false, threw: String(e?.message ?? e) }; }
writeFileSync(spec.resultFile, JSON.stringify(result));
process.exit(0);
