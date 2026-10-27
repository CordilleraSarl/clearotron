// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE GROUP FILTER IS OFFERED TO PLACEMENT ALONE.
//
// Placement owes every line the shape's groups list a fate, so `band_lookup` offers it the group filter and says
// a group is read page by page. Every other band-reading stage was handed the same offer. A synthesis took it:
// 2,519 group pages, 2,498 of them past the end of a 140-line group, the server answering each with nothing
// (measured on a test run, 2026-10-13). The driver now tells the band server which stage reads the groups, and
// every other stage is offered the lookup without `group`, in the words every stage had before group pages
// existed. A group argument that arrives anyway is answered as before: the offer changes, not the answers.
// Invented data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildGatherMcpConfig } from "../engine/mcp/gather-config.mjs";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";
import { GROUP_READING_STAGES, BAND_READING_STAGES } from "../stages.mjs";

const SERVER = fileURLToPath(new URL("../engine/mcp/band-server.mjs", import.meta.url));
const GROUP_CLAUSE = "group (a, b, c, d, rest or no_goods: that list's lines in the shape's order, one per mark of an owner), ";
const OFFSET_GROUPS = "offset (default 0: where in the matching records or lines to start — a capped answer names the offset where the next page starts)";
// Word for word what every stage was offered before group pages existed.
const OFFSET_BAND = "offset (default 0: where in the matching records to start — a capped answer names the offset where the next page starts)";

function runDir(t) {
  const d = mkdtempSync(join(tmpdir(), "group-offer-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(driverDir(d), { recursive: true });
  const line = { key: "line:owner:alpha ltd|qzorvak", owner_key: "owner:alpha ltd", owner_name: "Alpha Ltd", mark: "QZORVAK", classes: ["9"],
    live: 1, records: 1, territories: ["EU"], goods_words: [], floors: 0, record_id: "/mark/eu/1" };
  writeFileSync(driverDir(d, "band-shape.json"), JSON.stringify({ groups: { b: { records: 1, lines: 1, list: [line] }, goods_words_total: 1 } }));
  return d;
}

/** One session with the band server: its tool list, and the answer to one call. */
async function session(dir, groupPages, call) {
  return await new Promise((resolve, reject) => {
    const env = { ...process.env, CLEAROTRON_BAND_RUN_DIR: dir };
    delete env.CLEAROTRON_BAND_GROUPS;
    if (groupPages) env.CLEAROTRON_BAND_GROUPS = "1";
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const got = {};
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(got); }, 8000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try {
          const m = JSON.parse(line);
          if (m.id === 2) got.lookup = m.result.tools.find((x) => x.name === "band_lookup");
          if (m.id === 3) { got.answer = m.result; clearTimeout(timer); child.kill("SIGKILL"); resolve(got); }
        } catch { /* not ours */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "band_lookup", arguments: call } }) + "\n");
  });
}

test("placement is offered the group filter and its pages; every other stage, the lookup it had before them", async (t) => {
  const dir = runDir(t);
  const placement = await session(dir, true, { group: "b" });
  const other = await session(dir, false, { group: "b" });
  assert.ok(placement.lookup?.inputSchema?.properties?.group, "placement lost the group filter");
  assert.ok(placement.lookup.description.includes(GROUP_CLAUSE) && placement.lookup.description.includes(OFFSET_GROUPS));
  assert.equal(other.lookup?.inputSchema?.properties?.group, undefined, "a stage that owes the groups nothing is offered their pages");
  assert.ok(other.lookup.description.includes(OFFSET_BAND), "the other stages' offset clause is not the one they had before group pages");
  assert.ok(!other.lookup.description.includes("group ("), "the group clause is still in the other stages' description");
  assert.equal(placement.lookup.description.replace(GROUP_CLAUSE, "").replace(OFFSET_GROUPS, OFFSET_BAND), other.lookup.description,
    "the two descriptions differ by more than the group clauses");
  // The offer changes; the answer does not: a group argument that arrives anyway is answered as before.
  for (const s of [placement, other]) assert.equal(JSON.parse(s.answer.content[0].text).lines_total, 1);
});

test("the driver flags the band server for placement alone, on both engines", () => {
  assert.deepEqual([...GROUP_READING_STAGES], ["placement-inquiry"]);
  for (const s of GROUP_READING_STAGES) assert.ok(BAND_READING_STAGES.has(s), `${s} reads the groups but not the band`);
  const cfg = (bandGroups) => buildGatherMcpConfig(["band"], { sessionKey: "s", agent: "a", runDir: "/run", bandGroups });
  assert.equal(cfg(true).mcpServers.band.env.CLEAROTRON_BAND_GROUPS, "1");
  assert.equal(cfg(false).mcpServers.band.env.CLEAROTRON_BAND_GROUPS, undefined);
  assert.equal(buildGatherMcpConfig(["band"], { sessionKey: "s", agent: "a", runDir: "/run" }).mcpServers.band.env.CLEAROTRON_BAND_GROUPS, undefined,
    "a caller that says nothing offers the group pages");
  const toml = renderCodexConfigToml({ mcpConfig: JSON.stringify(cfg(true)), allowedTools: ["mcp__band__band_lookup"], developerInstructions: "x" });
  const r = spawnSync("python3", ["-c", "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))"], { input: toml, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).mcp_servers.band.env.CLEAROTRON_BAND_GROUPS, "1", "the Codex configuration dropped the flag");
});
