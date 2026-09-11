// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO HANDS ITS RUNS TO THE ASSISTANT.
//
// `clearotron demo` published its four samples as reports and created no run directory, so the assistant
// its own connect line wired listed nothing. Walked on the published beta, 2026-09-11. The samples are now
// copied, as runs, into the demo's own workspace, where the connector looks. Nothing lands anywhere else,
// and the demo-then-install arms in `the-demo-is-its-own-install` hold the other half of that rule.
//
// SAFETY GUARD: the workspace is pinned before the connector's modules are imported, because the driver
// config freezes its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
const WS = __mkdtemp(__join(__tmpdir(), "demo-runs-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", WS);
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { seedDemoRuns, demoChildren } = await import("../demo-container.mjs");
const { enumerateRuns, resolveRun } = await import("../../mcp-server/lib/runs.mjs");
const { buildBrief } = await import("../../mcp-server/lib/brief.mjs");

test("the demo's samples become runs the connector lists and briefs, under the demo's own workspace only", () => {
  const samples = demoChildren(join(ROOT, "demo"));
  assert.ok(samples.length >= 4, `the package ships ${samples.length} samples; this arm needs the four it was written for`);
  const first = seedDemoRuns({ workspace: WS, examplesDir: join(ROOT, "demo") });
  assert.equal(first.seeded.length, samples.length, `a sample did not become a run: ${JSON.stringify(first)}`);

  const runs = enumerateRuns();
  assert.deepEqual(runs.map((r) => r.runId).sort(), [...first.seeded].sort(), "the connector does not list what the demo seeded");
  for (const r of runs) {
    assert.ok(r.runDir.startsWith(WS), `${r.runId} is listed from outside the demo's workspace: ${r.runDir}`);
    // Resolved the way the connector resolves a run before briefing it (server.mjs mustRun).
    const brief = buildBrief(resolveRun(r.runId));
    assert.equal(brief.runId, r.runId, `no brief for ${r.runId}`);
    assert.notEqual(brief.source, "none", `the brief for ${r.runId} found nothing to read`);
  }

  // A second start changes nothing, and the tracked samples were read, never written.
  const again = seedDemoRuns({ workspace: WS, examplesDir: join(ROOT, "demo") });
  assert.deepEqual(again.seeded, []);
  assert.equal(again.already.length, samples.length);
  assert.equal(execFileSync("git", ["status", "--porcelain", "--", "demo"], { cwd: ROOT, encoding: "utf8" }), "",
    "seeding the runs wrote into the tracked samples");
});

test("the demo seeds its runs, and only the demo does", () => {
  // WIRING, read from source: the seeding sits in the branch a demo start takes and a real start does not.
  const src = readStart();
  const call = src.indexOf("seedDemoRuns({ workspace: paths.workspace");
  assert.ok(call > 0, "the demo no longer seeds its runs");
  const branch = src.lastIndexOf("if (!DEMO) {", call);
  const elseTry = src.indexOf("} else try {", branch);
  assert.ok(branch > 0 && elseTry > branch && elseTry < call, "the seeding is not inside the demo-only branch");
});

function readStart() {
  return readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
}
