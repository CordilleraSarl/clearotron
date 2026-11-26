// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN WHOSE SEARCHES ARE ITS OWN KEEPS ONE SEARCH SERVICE.
//
// Where a run's dictated searches are run by its own AI program (engine/mcp/own-search.mjs), the driver prepares each
// grid's ledger before the stage, and the research server, run here as its own process, serves that ledger as recorded,
// with no research credential at all. A grid the driver did not prepare is refused, and nothing is sent to the
// research service: one run never mixes two search services in one grid. A run without the setting is unchanged.
// Every name and host is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");

/** One research call to the server, run as its own process with the run folder and environment given. */
async function callTool(args, env) {
  return await new Promise((resolve, reject) => {
    const base = { ...process.env };
    delete base.PERPLEXITY_API_KEY;
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...base, ...env } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* non-json */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "perplexity_research", arguments: args } },
    ]) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

function aRun({ own = true, prepared = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "own-search-server-"));
  const runDir = join(root, "studio", "clearance-search", "run-under-test");
  mkdirSync(driverDir(runDir), { recursive: true });
  if (own) writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ schema: 1, engine: "anthropic-agent", register: null, research: "own" }));
  const ledgerPath = join(runDir, "common-law-grid.json");
  const specPath = driverDir(runDir, "grid-spec.json");
  writeFileSync(specPath, JSON.stringify({ terms: ["QZORVAK"], platforms: ["web", "shop.example.com"], output_path: ledgerPath }, null, 2) + "\n");
  if (prepared) writeFileSync(ledgerPath, JSON.stringify({
    cells: [{ term: "QZORVAK", platform: "web", status: "hit", candidates: [{ title: "QZORVAK candles", url: "https://pages.example.com/qzorvak" }] }],
    extras: { pr_risk: [] }, gaps: ["QZORVAK | shop.example.com | own search: not-sent"] }, null, 2) + "\n");
  return { runDir, specPath, ledgerPath };
}
const log = (runDir) => { try { return readFileSync(join(runDir, "_driver", "reading-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test("a grid the driver prepared is served as recorded, with no research credential", async () => {
  const { runDir, specPath } = aRun();
  const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir });
  assert.match(text, /^Grid ALREADY RECORDED for this spec/, text.slice(0, 300));
  assert.match(text, /pages\.example\.com\/qzorvak/);
  assert.ok(!log(runDir).some((r) => /not set/.test(String(r.error ?? ""))), "never refused for want of a key");
});

test("a grid it did not prepare is refused, and nothing is sent elsewhere, even with a key", async () => {
  const { runDir, specPath, ledgerPath } = aRun({ prepared: false });
  const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir, PERPLEXITY_API_KEY: "placeholder-not-a-key" });
  assert.match(text, /searches are run by its own AI program, and the driver has not prepared the grid/);
  assert.ok(!log(runDir).some((r) => r.ok === true), "nothing was searched");
  let written = true; try { readFileSync(ledgerPath); } catch { written = false; }
  assert.equal(written, false, "no ledger was bought");
});

test("a question still needs the research service's key on such a run: only the grid is the program's own", async () => {
  const { runDir } = aRun();
  const text = await callTool({ task: "Does QZORVAK sell candles?" }, { CLEAROTRON_BAND_RUN_DIR: runDir });
  assert.match(text, /PERPLEXITY_API_KEY not set/);
});

test("a run without the setting is unchanged: no key, no grid", async () => {
  const { runDir, specPath } = aRun({ own: false });
  const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir });
  assert.match(text, /PERPLEXITY_API_KEY not set/);
});
