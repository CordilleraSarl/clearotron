// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RESEARCH TOOL TAKES EACH ROUTE IT IS TOLD, AND NO OTHER, BEFORE ANYTHING IS SENT.
//
// A grid's first page takes `grid_spec_path`, a later page that and `part`, and research a nonblank `task`. The schema
// used to require `task`, so a grid call made as the manual dictates was refused before it ran, and a later page asked
// of a grid with no saved result fell through to a new paid grid run. Here, against the real server and a stand-in
// provider that counts every request:
//   · a grid call with no task is served; the older form with a redundant task is still served;
//   · a later page with no saved result, a page with no grid, and research with no task are each refused, and nothing
//     is sent;
//   · a depth, model or output schema a step still sends is ignored: the request carries none of them, and names the
//     research model itself;
//   · the provider's own charge never reaches the step's text, while an amount found in the research survives.
// Invented values only; nothing leaves this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { researchModelFor, withoutProviderCharge } from "../../providers/perplexity/src/core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");

// The stand-in provider: every request is appended to a file, so a test can count what was sent and read it.
const STUB = `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.STUB_SENT, JSON.stringify(JSON.parse(init?.body ?? "{}")) + "\\n");
  const text = "The invented owner sells QZORVEL toys online for $40 each.";
  return new Response(JSON.stringify({ status: "completed", model: "openai/gpt-6.2-sol", effort: "medium@2026-10-22.1", output: [{ type: "message", content: [{ type: "output_text", text }] }] }),
    { status: 200, headers: { "content-type": "application/json" } });
};`;
const PRELOAD = `data:text/javascript,${encodeURIComponent(STUB)}`;

function run() {
  const root = mkdtempSync(join(tmpdir(), "research-routes-"));
  const runDir = join(root, "studio", "clearance-search", "run-under-test");
  mkdirSync(driverDir(runDir), { recursive: true });
  const ledgerPath = join(runDir, "common-law-grid.json");
  const specPath = driverDir(runDir, "grid-spec.json");
  writeFileSync(specPath, JSON.stringify({ terms: ["QZORVEL"], platforms: ["web"], output_path: ledgerPath }, null, 2) + "\n");
  return { root, runDir, ledgerPath, specPath, sentPath: join(root, "sent.jsonl") };
}
const saveLedger = (r) => writeFileSync(r.ledgerPath, JSON.stringify({ cells: [{ term: "QZORVEL", platform: "web", status: "hit",
  candidates: [{ title: "QZORVEL wooden toy", url: "https://shop.example/qzorvel" }] }], gaps: [] }, null, 2) + "\n");
const sent = (r) => (existsSync(r.sentPath) ? readFileSync(r.sentPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

async function call(r, args) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "perplexity_research", arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", PRELOAD, SERVER], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "placeholder-not-a-key", STUB_SENT: r.sentPath, CLEAROTRON_BAND_RUN_DIR: r.runDir,
        CLEAROTRON_GATHER_SESSION_KEY: "research-routes" } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* not a reply */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const q of requests) child.stdin.write(JSON.stringify(q) + "\n");
  });
}

test("a grid call with only its spec path is served, and so is the older form with a redundant task", async () => {
  const r = run();
  try {
    saveLedger(r);
    const bare = await call(r, { grid_spec_path: r.specPath });
    assert.doesNotMatch(bare, /missing_required/, `the dictated grid call was refused: ${bare.slice(0, 200)}`);
    assert.match(bare, /Candidates from 1 cells, the whole result:/);
    assert.match(await call(r, { task: "grid", grid_spec_path: r.specPath }), /Candidates from 1 cells, the whole result:/);
    assert.equal(sent(r).length, 0, "a saved grid was searched again");
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("a later page with no saved result, a page with no grid, and research with no task are refused, and nothing is sent", async () => {
  const r = run();
  try {
    assert.match(await call(r, { grid_spec_path: r.specPath, part: 2 }), /^ERROR: page 2 of this grid cannot be served: no saved result was found at /);
    assert.match(await call(r, { part: 2 }), /^ERROR: a later page takes the same `grid_spec_path` as the first page, with `part`\./);
    assert.match(await call(r, {}), /^ERROR: `task` is required for research\. A grid call needs only `grid_spec_path`\./);
    assert.match(await call(r, { task: "   " }), /^ERROR: `task` is required for research\./);
    assert.equal(sent(r).length, 0, "a refused request reached the provider");
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

test("a depth, model or output schema a step still sends is ignored, and the provider's charge never reaches the step", async () => {
  const r = run();
  try {
    const reply = await call(r, { task: "Does the invented owner sell QZORVEL toys?", model: "invented-model", depth: "deep-research",
      response_schema: { type: "object" }, schema_name: "invented" });
    const [body] = sent(r);
    assert.ok(body, "the question was not sent");
    assert.notEqual(body.model, "invented-model", "the step's model override reached the provider");
    assert.equal(body.model ?? null, researchModelFor(body.preset), "the request names the research model wherever its effort is a research effort");
    assert.doesNotMatch(JSON.stringify(body), /invented-model|"schema"|response_format/, "the step's model or schema reached the provider");
    assert.match(reply, /\$40 each/, "an amount the research found was taken out");
    assert.doesNotMatch(reply, /Cost: \$/);
  } finally { rmSync(r.root, { recursive: true, force: true }); }
  const held = "Found at $40 each.\n\n---\n_Research metadata: Depth: pro-search | Tokens: 900 | Cost: $0.0123_";
  assert.equal(withoutProviderCharge(held), "Found at $40 each.\n\n---\n_Research metadata: Depth: pro-search | Tokens: 900_");
});

test("on a run whose product pins its effort, a question and a grid each name the research model, on the effort and tools they had", async () => {
  const r = run();
  try {
    writeFileSync(driverDir(r.runDir, "search-policy.json"), JSON.stringify({ schema: 1, level: "global-preliminary-search", web: { questionPreset: "medium", resultsPerCell: 15 } }));
    await call(r, { task: "Does the invented owner sell QZORVEL toys?" });
    await call(r, { grid_spec_path: r.specPath });
    const [question, grid] = sent(r);
    const row = readFileSync(driverDir(r.runDir, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((x) => x.args?.task);
    assert.deepEqual({ preset: row.args.preset, modelRequested: row.modelRequested, modelServed: row.modelServed, effortServed: row.effortServed },
      { preset: "medium", modelRequested: "openai/gpt-6.2-sol", modelServed: "openai/gpt-6.2-sol", effortServed: "medium@2026-10-22.1" },
      "the call's record keeps the model asked for, the one the response names and the effort that ran, apart from the preset");
    assert.deepEqual({ preset: question.preset, model: question.model, tools: question.tools.map((t) => t.type) },
      { preset: "medium", model: "openai/gpt-6.2-sol", tools: ["web_search"] }, "Global's question keeps its pinned effort and names the model");
    assert.deepEqual({ preset: grid.preset, model: grid.model, tools: grid.tools.map((t) => t.type) },
      { preset: "pro-search", model: "openai/gpt-6.2-sol", tools: ["sandbox", "web_search"] }, "the grid keeps its effort and tools and names the model");
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});
