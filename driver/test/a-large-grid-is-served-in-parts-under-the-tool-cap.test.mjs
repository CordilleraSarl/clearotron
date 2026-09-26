// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LARGE GRID'S CANDIDATES ARE SERVED IN PARTS, UNDER THE ENGINE'S CAP ON ONE TOOL RESULT.
//
// The engine errors a tool result past 25,000 tokens (about 100KB) by default. A grid hands every hit
// cell's candidates back to the web-search step, and they grow with results per cell, so a large grid at
// a high setting would lose the whole call. They are served in parts split between cells, and a later
// part is read from the saved ledger without searching again. A grid that fits reads exactly as before.
//
// Spawns the real server over real MCP stdio, on a recorded ledger, so no grid is bought.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";
import { candidateParts, candidatesForJudgment } from "../../providers/perplexity/src/core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");

async function callTool(args) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "perplexity_research", arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "placeholder-not-a-key" } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* non-json */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

// Invented spellings and example hosts. Titles and addresses at the lengths a live grid returns.
function recordedGrid({ terms, perCell }) {
  const root = mkdtempSync(join(tmpdir(), "grid-parts-"));
  const runDir = join(root, "studio", "clearance-search", "run-under-test");
  mkdirSync(driverDir(runDir), { recursive: true });
  const platforms = ["web", "shop.example.com", "store.example.net", "games.example.org", "market.example.io"];
  const ledgerPath = join(runDir, "common-law-grid.half-a.json");
  const specPath = driverDir(runDir, "grid-spec.half-a.json");
  writeFileSync(specPath, JSON.stringify({ terms, platforms, output_path: ledgerPath, half: "a" }, null, 2) + "\n");
  const cells = terms.flatMap((term) => platforms.map((platform) => ({ term, platform, status: "hit",
    candidates: Array.from({ length: perCell }, (_, i) => ({
      title: `${term} listing ${i + 1} on ${platform}, a page title of ordinary length`,
      url: `https://${platform === "web" ? "pages.example.com" : platform}/${term.toLowerCase()}/item-${i + 1}` })) })));
  writeFileSync(ledgerPath, JSON.stringify({ cells, gaps: [] }, null, 2) + "\n");
  return { root, specPath, cells };
}

// The cells a reply carries: the JSON array between the count line and the part's closing line.
function cellsIn(text) {
  const start = text.indexOf("\n[", text.indexOf("Candidate hits needing your taxonomy judgment"));
  const end = text.includes("\n[end of part") ? text.indexOf("\n[end of part") : text.length;
  return JSON.parse(text.slice(start + 1, end));
}

test("a grid past the cap is served in parts, each under it, and together they are every candidate once", async () => {
  const terms = Array.from({ length: 12 }, (_, i) => `LANTERNWICK${String.fromCharCode(65 + i)}`);
  const g = recordedGrid({ terms, perCell: 25 });
  try {
    const first = await callTool({ task: "grid", grid_spec_path: g.specPath });
    const m = first.match(/\[perplexity_research part 1\/(\d+) — these candidates exceed one tool response/);
    assert.ok(m, `a large grid was not served in parts: ${first.slice(0, 300)}`);
    const total = Number(m[1]);
    assert.ok(total >= 2);
    assert.match(first, new RegExp(`\\[end of part 1/${total} — call perplexity_research again with \\{"grid_spec_path": ${JSON.stringify(g.specPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, "part": 2\\} for the next part\\]`));
    const replies = [first];
    for (let p = 2; p <= total; p++) replies.push(await callTool({ task: "grid", grid_spec_path: g.specPath, part: p }));
    assert.match(replies[total - 1], new RegExp(`\\[end of part ${total}/${total} — the candidates are complete once parts 1\\.\\.${total} are all read\\]`));
    for (const r of replies) {
      assert.match(r, /Grid ALREADY RECORDED/, "a later part searched again");
      assert.ok(r.length < 80000, `a part is ${r.length} characters, past what one tool result can carry`);
    }
    const served = replies.flatMap(cellsIn).map((c) => `${c.term}|${c.platform}|${c.candidates.length}`);
    assert.deepEqual(served, g.cells.map((c) => `${c.term}|${c.platform}|${c.candidates.length}`),
      "the parts lost, repeated or reordered a cell");
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

// A later part must page the answer part 1 was cut from, including a ledger with honest gap cells or a
// meaning query that returned nothing: those are accounted when the ledger is written, so a repeat call
// reads the saved ledger rather than buying the grid again. With a placeholder key any search here would
// fail, so a clean page, and a ledger unchanged on disk, are the proof that nothing was bought.
test("a later part pages a ledger with a gap cell from disk, split as part 1 was", async () => {
  const terms = Array.from({ length: 12 }, (_, i) => `LANTERNWICK${String.fromCharCode(65 + i)}`);
  const g = recordedGrid({ terms, perCell: 25 });
  try {
    const ledgerPath = JSON.parse(readFileSync(g.specPath, "utf8")).output_path;
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.cells.pop();
    ledger.gaps.push(`${terms.at(-1)} | market.example.io | the program did not return this cell`);
    const bytes = JSON.stringify(ledger) + "\n";
    writeFileSync(ledgerPath, bytes);
    const expected = candidateParts(candidatesForJudgment(ledger), 70000);
    assert.ok(expected.length >= 2, "the fixture no longer needs parts");
    const page = await callTool({ task: "grid", grid_spec_path: g.specPath, part: 2 });
    assert.doesNotMatch(page, /ERROR/, `part 2 did not page the saved ledger: ${page.slice(0, 200)}`);
    assert.match(page, new RegExp(`\\[perplexity_research part 2/${expected.length} `));
    assert.deepEqual(cellsIn(page).map((c) => `${c.term}|${c.platform}`), expected[1].map((c) => `${c.term}|${c.platform}`),
      "part 2 is not the second part of the split part 1 was cut from");
    assert.equal(readFileSync(ledgerPath, "utf8"), bytes, "the page rewrote the ledger");
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

test("a later part pages a meaning half with an unanswered query, without searching again", async () => {
  const terms = Array.from({ length: 12 }, (_, i) => `LANTERNWICK${String.fromCharCode(65 + i)}`);
  const g = recordedGrid({ terms, perCell: 25 });
  try {
    const spec = JSON.parse(readFileSync(g.specPath, "utf8"));
    const queries = ["LANTERNWICK meaning slang", "LANTERNWICK offensive"];
    spec.connotation = { queries, disposition_required: true, dispositions_path: join(dirname(spec.output_path), "common-law-dispositions.half-a.json") };
    writeFileSync(g.specPath, JSON.stringify(spec, null, 2) + "\n");
    const ledger = JSON.parse(readFileSync(spec.output_path, "utf8"));
    ledger.extras = { pr_risk: [{ query: queries[0], results: [{ title: "What the word turns up", url: "https://receipts.example/1", snippet: "" }] }] };
    const bytes = JSON.stringify(ledger) + "\n";
    writeFileSync(spec.output_path, bytes);
    // Part 1 carries the meaning obligations as well, so it is cut smaller; every later call must reserve
    // the same room, or the parts overlap or skip a cell.
    const first = await callTool({ task: "grid", grid_spec_path: g.specPath });
    const total = Number(first.match(/\[perplexity_research part 1\/(\d+) /)?.[1]);
    assert.ok(total >= 2, `the meaning half was not served in parts: ${first.slice(0, 200)}`);
    const replies = [first];
    for (let p = 2; p <= total; p++) replies.push(await callTool({ task: "grid", grid_spec_path: g.specPath, part: p }));
    for (const r of replies.slice(1)) assert.doesNotMatch(r, /ERROR/, `a later part did not page the saved ledger: ${r.slice(0, 200)}`);
    assert.deepEqual(replies.flatMap(cellsIn).map((c) => `${c.term}|${c.platform}`), g.cells.map((c) => `${c.term}|${c.platform}`),
      "the parts overlap or skip a cell: part 1 and the later parts were cut differently");
    assert.equal(readFileSync(spec.output_path, "utf8"), bytes, "a page rewrote the ledger");
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});

test("THE CONTROL: a grid that fits is one reply with no part lines, as before", async () => {
  const g = recordedGrid({ terms: ["LANTERNWICK"], perCell: 3 });
  try {
    const text = await callTool({ task: "grid", grid_spec_path: g.specPath });
    assert.doesNotMatch(text, /part \d+\//);
    assert.match(text, /Candidate hits needing your taxonomy judgment \(5\):\n\[/);
    assert.equal(cellsIn(text).length, 5);
  } finally { rmSync(g.root, { recursive: true, force: true }); }
});
