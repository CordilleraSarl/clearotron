// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN WHOSE SEARCHES ARE ITS OWN KEEPS ONE SEARCH SERVICE.
//
// Where a run's dictated searches are run by its own AI program (engine/mcp/own-search.mjs), the driver prepares each
// grid's ledger before the stage, and the research server, run here as its own process, serves that ledger as recorded,
// with no research credential at all. A grid the driver did not prepare is refused, and nothing is sent to the
// research service: one run never mixes two search services in one grid. A stage's question is handed to the driver,
// which answers it with the run's own program on the product's tier. A run without the setting is unchanged.
// Every name and host is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";
import { serveOwnQuestions } from "../own-search-questions.mjs";
import { QUESTION_TIERS } from "../engine/mcp/own-search.mjs";
import { researchCall } from "../research-records.mjs";

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

test("serving a prepared grid leaves the record its own search wrote beside it", async () => {
  const { runDir, specPath, ledgerPath } = aRun();
  const sidecar = ledgerPath.replace(/\.json$/, ".provenance.json");
  const record = JSON.stringify({ provider: "codex", surface: "the AI program's own web search, in research-only sessions", ran: true, searches: 2 }, null, 2) + "\n";
  writeFileSync(sidecar, record);
  const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir, PERPLEXITY_API_KEY: "placeholder-not-a-key" });
  assert.match(text, /^Grid ALREADY RECORDED for this spec/, text.slice(0, 300));
  assert.equal(readFileSync(sidecar, "utf8"), record, "the research service rewrote a grid it never searched as its own");
});

test("on a run without the setting, a recorded grid is still stamped as the research service's", async () => {
  const { runDir, specPath, ledgerPath } = aRun({ own: false });
  const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir, PERPLEXITY_API_KEY: "placeholder-not-a-key" });
  assert.match(text, /^Grid ALREADY RECORDED for this spec/, text.slice(0, 300));
  const stamp = JSON.parse(readFileSync(ledgerPath.replace(/\.json$/, ".provenance.json"), "utf8"));
  assert.equal(stamp.provider, "perplexity");
  assert.equal(stamp.ran, false);
});

test("a grid it did not prepare is handed to the driver, searched by the run's own program, and served as recorded", async () => {
  const { runDir, specPath, ledgerPath } = aRun({ prepared: false });
  const codex = (q, url) => ({ type: "item.completed", item: { type: "web_search", action: { query: q }, results: [{ title: "QZORVAK", url }] } });
  const makeSessions = async () => ({ search: "codex", engine: "openai-agent", session: async (batch) => ({ answered: true, model: "gpt-6-luna",
    events: batch.map((d) => d.site ? codex(`${d.query} site:${d.site}`, `https://${d.site}/qzorvak`) : codex(d.query, "https://pages.example.com/qzorvak")) }) });
  const stop = serveOwnQuestions(runDir, { makeSessions, pollMs: 50 });
  try {
    const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir, PERPLEXITY_API_KEY: "placeholder-not-a-key" });
    assert.match(text, /^Grid ALREADY RECORDED for this spec \(2\/2 cells present\)/, text.slice(0, 300));
    assert.ok(JSON.parse(readFileSync(ledgerPath, "utf8")).cells.length === 2, "the driver wrote the ledger its own program searched");
  } finally { stop(); }
});

test("a grid the driver could not prepare is refused, with why, and nothing is sent elsewhere, even with a key", async () => {
  const { runDir, specPath, ledgerPath } = aRun({ prepared: false });
  const stop = serveOwnQuestions(runDir, { makeSessions: async () => ({ error: "the engine is signed out" }), pollMs: 50 });
  let text;
  try { text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir, PERPLEXITY_API_KEY: "placeholder-not-a-key" }); }
  finally { stop(); }
  assert.match(text, /searches are run by its own AI program, and the driver has not prepared the grid .* \(own search: the engine is signed out\)/);
  assert.ok(!log(runDir).some((r) => r.ok === true), "nothing was searched");
  let written = true; try { readFileSync(ledgerPath); } catch { written = false; }
  assert.equal(written, false, "no ledger was bought");
});

test("a stage's question on such a run is answered by the run's own program through the driver, and never sent elsewhere", async () => {
  const { runDir } = aRun();
  const asked = [];
  const makeSessions = async (o) => ({ search: "codex", engine: "openai-agent", made: o,
    question: async (task) => { asked.push({ task, model: o.model, thinking: o.thinking });
      return { text: "QZORVAK candles are sold by Northwind Play GmbH.\nhttps://pages.example.com/qzorvak", model: "gpt-6.1-sol", speed: "standard", seconds: 1,
        events: [{ type: "item.completed", item: { type: "web_search", action: { query: "QZORVAK candles" }, results: [{ title: "QZORVAK", url: "https://pages.example.com/qzorvak" }] } }] }; } });
  const stop = serveOwnQuestions(runDir, { makeSessions, pollMs: 50, tierOf: () => QUESTION_TIERS["multi-country-focus-search"] });
  try {
    // A key is set, and is not used: nobody chose that service for this run.
    const text = await callTool({ task: "Does QZORVAK sell candles?" }, { CLEAROTRON_BAND_RUN_DIR: runDir, PERPLEXITY_API_KEY: "placeholder-not-a-key" });
    assert.match(text, /^QZORVAK candles are sold by Northwind Play GmbH\./, text.slice(0, 300));
    assert.deepEqual(asked, [{ task: "Does QZORVAK sell candles?", model: "opus", thinking: "high" }], "asked once, on the product's ruled tier");
    const row = log(runDir).find((r) => r.tool === "perplexity_research");
    assert.deepEqual({ ok: row.ok, service: row.service, model: row.model, sources: row.sources }, { ok: true, service: "own:codex", model: "gpt-6.1-sol", sources: 1 });
    assert.deepEqual(researchCall(row), { known: true, service: "own:codex", kind: "question", question: "Does QZORVAK sell candles?", ok: true, error: null, session: null, replay: false },
      "the run's record says which service answered");
  } finally { stop(); }
});

test("a question the driver cannot answer on its product's tier is a failed lookup with why, never an answer", async () => {
  const { runDir } = aRun();
  const stop = serveOwnQuestions(runDir, { makeSessions: async () => ({ error: "unused" }), pollMs: 50, tierOf: () => null });
  try {
    const text = await callTool({ task: "Does QZORVAK sell candles?" }, { CLEAROTRON_BAND_RUN_DIR: runDir });
    assert.equal(text, "ERROR: Research failed — own search: no question tier is ruled for this run's product");
    const row = log(runDir).find((r) => r.tool === "perplexity_research");
    assert.deepEqual({ ok: row.ok, service: row.service }, { ok: false, service: "own" });
  } finally { stop(); }
});

test("a run without the setting is unchanged: no key, no grid", async () => {
  const { runDir, specPath } = aRun({ own: false });
  const text = await callTool({ task: "", grid_spec_path: specPath }, { CLEAROTRON_BAND_RUN_DIR: runDir });
  assert.match(text, /PERPLEXITY_API_KEY not set/);
});

test("at the stage's tool, an answer citing only an unrecorded page is a failed lookup, and a mixed one keeps only recorded pages", async () => {
  const A = "https://pages.example.com/qzorvak", B = "https://elsewhere.example.org/claim";
  const searchOf = (urls) => ({ type: "item.completed", item: { type: "web_search", action: { type: "search", queries: ["QZORVAK"] }, results: urls.map((url) => ({ url })) } });
  for (const [text, expect] of [[`Northwind sells QZORVAK candles.\n${B}`, "unsupported"], [`Northwind sells QZORVAK candles.\n${A}\n${B}`, "mixed"]]) {
    const { runDir } = aRun();
    const stop = serveOwnQuestions(runDir, { pollMs: 50, tierOf: () => QUESTION_TIERS["global-preliminary-search"],
      makeSessions: async () => ({ search: "codex", question: async () => ({ text, events: [searchOf([A])] }) }) });
    try {
      const out = await callTool({ task: "Does QZORVAK sell candles?" }, { CLEAROTRON_BAND_RUN_DIR: runDir });
      const row = log(runDir).find((r) => r.tool === "perplexity_research");
      let kept = ""; try { kept = readFileSync(join(runDir, "_driver", "research-answers.jsonl"), "utf8"); } catch { /* none */ }
      if (expect === "unsupported") {
        assert.equal(out, "ERROR: Research failed — own search: the answer cites no page its searches returned");
        assert.deepEqual({ ok: row.ok, outcome: row.outcome }, { ok: false, outcome: "unsupported-cited" });
        assert.equal(kept, "", "nothing is kept for reuse");
      } else {
        assert.match(out, /pages\.example\.com\/qzorvak/);
        assert.doesNotMatch(out, /elsewhere\.example\.org/, "the stage was handed an address no search returned");
        assert.deepEqual({ ok: row.ok, outcome: row.outcome, sources: row.sources }, { ok: true, outcome: "supported", sources: 1 });
        assert.doesNotMatch(kept, /elsewhere\.example\.org/, "an unrecorded address was kept for reuse");
      }
    } finally { stop(); }
  }
});
