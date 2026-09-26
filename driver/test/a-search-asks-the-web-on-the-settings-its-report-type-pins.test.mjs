// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEARCH ASKS THE WEB ON THE SETTINGS ITS REPORT TYPE PINS (ruled 2026-09-25).
//
// Two settings, one row per product, nothing read from the environment: the vendor tier every question the
// run asks goes out on (knockout low, global preliminary medium, multi-country high, full country xhigh),
// and how many results each grid cell and each meaning query asks for and keeps (10, 15, 20, 25). The run
// freezes the pair in its search policy, which is its record; a run frozen before the rule carries none
// and runs exactly as runs did before it. Grids stay on the tier they run on today.
//
// The research server is driven over its real stdio protocol; nothing here reaches a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { PRODUCT_POLICIES, resolveSearchPolicy } from "../search-policy.mjs";
import { resultsPerCellOf } from "../pipeline.mjs";
import { KNOCKOUT_WEB } from "../stages-knockout.mjs";
import { buildGridProgramTask, questionPresetFor, retriesForPreset, detectPreset } from "../../providers/perplexity/src/core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");

test("each report type pins the ruled tier for its questions and the ruled results per cell", () => {
  const web = Object.fromEntries(Object.entries(PRODUCT_POLICIES).map(([k, v]) => [k, v.web]));
  assert.deepEqual(web, {
    "knockout-search": { questionPreset: "pro-search", resultsPerCell: 10 },   // pro-search is the vendor's old name for low
    "global-preliminary-search": { questionPreset: "medium", resultsPerCell: 15 },
    "multi-country-focus-search": { questionPreset: "high", resultsPerCell: 20 },
    "full-country-search": { questionPreset: "xhigh", resultsPerCell: 25 },
  });
  assert.deepEqual([KNOCKOUT_WEB.resultsPerCell, KNOCKOUT_WEB.questionPreset], [10, "pro-search"], "the knockout reads the same row");
  assert.deepEqual(resolveSearchPolicy({ product: "full-country-search" }, { territories: ["CH"] }).web, { questionPreset: "xhigh", resultsPerCell: 25 },
    "the resolved policy the run freezes carries the row's settings");
});

test("a grid spec carries its report type's results per cell, and a run frozen before the rule carries none", () => {
  assert.deepEqual(resultsPerCellOf({ web: { resultsPerCell: 20 } }), { results_per_cell: 20 });
  assert.deepEqual(resultsPerCellOf({ components: {} }), {}, "a policy frozen before the rule");
  assert.deepEqual(resultsPerCellOf(null), {});
});

test("the program asks each cell and each meaning query for the pinned number, and without one asks as before", () => {
  const spec = { terms: ["QZXV"], platforms: ["web", "shop.example.com"], output_path: "/w/studio/clearance-search/runs/r/grid.json",
    connotation: { queries: ["QZXV meaning"] } };
  const before = buildGridProgramTask(spec);
  assert.match(before, /limit=10, domains=\[platform\]/);
  assert.match(before, /if len\(results\) >= 8: break/);
  assert.match(before, /search\.web\(query, limit=10\)   # GENERAL web — OMIT the domains= argument; collect up to 8 /);
  const full = buildGridProgramTask({ ...spec, results_per_cell: 25 });
  assert.match(full, /limit=25, domains=\[platform\]/);
  assert.match(full, /if len\(results\) >= 25: break/);
  assert.match(full, /search\.web\(query, limit=25\)   # GENERAL web — OMIT the domains= argument; collect up to 25 /);
  assert.equal(full.replace(/25/g, "N"), before.replace(/limit=10/g, "limit=N").replace(/>= 8/g, ">= N").replace(/up to 8 /g, "up to N "),
    "nothing else in the program moved");
});

test("a question goes out on the run's pinned tier whatever depth it names, and on its own depth without one", () => {
  assert.equal(questionPresetFor({ pinned: "xhigh", depth: "fast-search", task: "x" }), "xhigh");
  assert.equal(questionPresetFor({ pinned: null, depth: "fast-search", task: "x" }), "fast-search");
  assert.equal(questionPresetFor({ pinned: null, depth: null, task: "short" }), detectPreset("short"));
  assert.equal(questionPresetFor({ pinned: "not-a-tier", depth: null, task: "short" }), detectPreset("short"), "an unknown setting is not obeyed");
  assert.deepEqual(["low", "medium", "high", "xhigh"].map(retriesForPreset), [2, 1, 1, 1], "the deep tiers keep the deep tiers' one retry");
});

// One JSON-RPC exchange with the real server: the tool list it serves for a run.
async function toolsFor(runDir) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "placeholder-not-a-key", CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("no tools/list answer")); }, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(m.result.tools); }
      }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

function runWithPolicy(policy) {
  const dir = mkdtempSync(join(tmpdir(), "pinned-tier-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (policy) writeFileSync(driverDir(dir, "search-policy.json"), JSON.stringify(policy));
  return dir;
}

test("on a pinned run the research tool says it runs at the search's depth and offers no depth of its own", async () => {
  const [tool] = await toolsFor(runWithPolicy({ schema: 1, level: "full-country-search", web: { questionPreset: "xhigh", resultsPerCell: 25 } }));
  assert.match(tool.description, /^Web\/marketplace research via Perplexity's agent API, at the depth this search is set to\. /);
  assert.equal("depth" in tool.inputSchema.properties, false);
});

test("THE CONTROL: a run frozen before the rule is served the tool it always was", async () => {
  const [tool] = await toolsFor(runWithPolicy({ schema: 1, level: "global-preliminary-search", components: {} }));
  assert.match(tool.description, /Auto-detects depth \(fast-search\|pro-search\|deep-research\|advanced-deep-research\) unless `depth` is given\./);
  assert.deepEqual(tool.inputSchema.properties.depth.enum, ["fast-search", "pro-search", "deep-research", "advanced-deep-research"]);
});
