// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO LINKS ITS REPORTS TO ITS OWN PORTAL.
//
// The demo's connector handed each sample run's stamped `url` to the assistant, and that was a test
// instance's address: an assistant asked to open a demo report sent the person there (measured on a
// published beta, 2026-09-11). The samples now carry the portal's route with no host, and the demo stamps
// its own portal's address onto its copies on every start.
//
// SAFETY GUARD: the workspace is pinned before the connector's modules are imported, because the driver
// config freezes its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
const WS = __mkdtemp(__join(__tmpdir(), "demo-links-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", WS);
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { seedDemoRuns, demoChildren, publishSource, reportRoute } = await import("../demo-container.mjs");
const { enumerateRuns, resolveRun } = await import("../../mcp-server/lib/runs.mjs");
const { buildBrief } = await import("../../mcp-server/lib/brief.mjs");

const ORIGIN = "http://127.0.0.1:28802";

test("each run the connector lists links to the demo portal's own route for that run", async () => {
  const seeded = seedDemoRuns({ workspace: WS, examplesDir: join(ROOT, "demo"), portalOrigin: ORIGIN });
  assert.ok(seeded.seeded.length >= 4, `the demo seeded ${seeded.seeded.length} run(s)`);

  // THE ROUTE IS THE PORTAL'S, compared by equality with what the portal's own run list says for the same
  // run, so a change to the route cannot leave these links behind.
  const { seedPool } = await import("../publish/seed-pool.mjs");
  const { republishRun } = await import("../publish/report-registry.mjs");
  const { scanAccountRuns } = await import("../portal-service.mjs");
  const pool = mkdtempSync(join(tmpdir(), "demo-links-pool-"));
  await seedPool({ pool, examplesDir: publishSource(join(ROOT, "demo"), { repoRoot: ROOT }), republish: republishRun });
  const portalRuns = scanAccountRuns({ poolRoot: pool, workspaceRoot: mkdtempSync(join(tmpdir(), "demo-links-empty-")) });
  const portalReport = new Map((portalRuns.runs ?? portalRuns).map((r) => [r.runId ?? r.id, r.report]));

  const runs = enumerateRuns();
  assert.equal(runs.length, seeded.seeded.length);
  for (const r of runs) {
    const route = portalReport.get(r.runId);
    assert.ok(route, `the portal lists no report for ${r.runId}: ${JSON.stringify([...portalReport.keys()])}`);
    assert.equal(r.url, `${ORIGIN}${route}`, `${r.runId} does not link to the demo portal's route for it`);
    assert.equal(route, reportRoute(r.runId));
    const status = JSON.parse(readFileSync(join(r.runDir, "status.json"), "utf8"));
    for (const d of status.reports ?? []) assert.ok(String(d.url).startsWith(`${ORIGIN}/portal/report/`), `a per-mark link in ${r.runId} is ${d.url}`);
    // The brief takes its links from the rendered report data, not from status.json; whatever it carries
    // must not be the deployment domain either.
    const brief = JSON.stringify(buildBrief(resolveRun(r.runId)));
    assert.doesNotMatch(brief, /cordillera\.ch/, `the brief for ${r.runId} links to the deployment domain`);
  }
  assert.equal(execFileSync("git", ["status", "--porcelain", "--", "demo"], { cwd: ROOT, encoding: "utf8" }), "",
    "stamping the links wrote into the tracked samples");
});

test("a later start on another port, or a copy an older version laid down, is re-stamped", () => {
  const ws = mkdtempSync(join(tmpdir(), "demo-links-restamp-"));
  const first = seedDemoRuns({ workspace: ws, examplesDir: join(ROOT, "demo"), portalOrigin: ORIGIN });
  // Each copy's status file, where the seed lays it: named from the sample's own fields, not discovered.
  const statusFiles = demoChildren(join(ROOT, "demo")).map((name) => {
    const s = JSON.parse(readFileSync(join(ROOT, "demo", name, "run", "status.json"), "utf8"));
    return join(ws, `workspace-${s.agent || "clawdi"}`, "studio", "prelim-search", s.slug, `${s.date}-${s.codename}`, "status.json");
  });
  assert.ok(statusFiles.length >= 4, `the package ships ${statusFiles.length} samples; this arm needs the four it was written for`);
  assert.equal(statusFiles.length, first.seeded.length);
  // An older version's copy: the host the samples used to carry, on one run.
  const old = JSON.parse(readFileSync(statusFiles[0], "utf8"));
  writeFileSync(statusFiles[0], JSON.stringify({ ...old, url: `https://old.example.test/${old.runId}/report.html` }, null, 2));

  const again = seedDemoRuns({ workspace: ws, examplesDir: join(ROOT, "demo"), portalOrigin: "http://127.0.0.1:31999" });
  assert.deepEqual(again.seeded, [], "a run in place was copied again");
  for (const f of statusFiles) {
    const s = JSON.parse(readFileSync(f, "utf8"));
    assert.equal(s.url, `http://127.0.0.1:31999${reportRoute(s.runId)}`, `${f} kept a link to somewhere else: ${s.url}`);
  }
});

test("the tracked samples carry the portal's route, never a host", () => {
  for (const name of demoChildren(join(ROOT, "demo"))) {
    const s = JSON.parse(readFileSync(join(ROOT, "demo", name, "run", "status.json"), "utf8"));
    assert.equal(s.url, reportRoute(s.runId), `${name}'s sample links somewhere other than the portal's route`);
  }
});
