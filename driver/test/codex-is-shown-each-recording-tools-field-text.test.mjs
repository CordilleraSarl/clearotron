// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Codex compacts an MCP tool whose input schema is over the server's `tool_input_schema_max_bytes`, and a
// compacted tool reaches the model without a single field description. The recording server is given a size
// every recording tool fits under (codex-config.mjs, CODEX_RECORDING_SCHEMA_BYTES), so Codex is shown the field
// text Claude is shown. These hold both halves: every stage's recording server carries the size, and no
// recording tool's schema has grown past it. Pure, $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCodexConfigToml, CODEX_RECORDING_SCHEMA_BYTES } from "../engine/mcp/codex-config.mjs";
import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, RECORDING_STAGES } from "../engine/mcp/gather-config.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIZE_LINE = `tool_input_schema_max_bytes = ${CODEX_RECORDING_SCHEMA_BYTES}`;
const serverBlocks = (toml) => toml.split(/^(?=\[)/m).filter((b) => b.startsWith("[mcp_servers."));

test("every recording stage's recording server is given the schema size, and no other server is", () => {
  const stages = Object.keys(RECORDING_STAGES);
  // A floor, so a stage list that came back empty cannot pass by having nothing to check.
  assert.ok(stages.length >= 10, `recording stages: ${stages.join(", ")}`);
  for (const stage of stages) {
    const groups = toolGroupsForStage(stage);
    const cfg = buildGatherMcpConfig(groups, { sessionKey: "s", agent: "a", runDir: "/tmp/run-x" });
    const blocks = serverBlocks(renderCodexConfigToml({ mcpConfig: JSON.stringify(cfg), allowedTools: allowedToolsFor(groups) }));
    const recording = blocks.filter((b) => /^args = \[.*recording-server\.mjs"/m.test(b));
    assert.equal(recording.length, 1, `${stage}: one recording server in:\n${blocks.join("")}`);
    assert.ok(recording[0].split("\n").includes(SIZE_LINE), `${stage}: no schema size in:\n${recording[0]}`);
    for (const b of blocks.filter((x) => x !== recording[0]))
      assert.doesNotMatch(b, /^tool_input_schema_max_bytes = /m, `${stage}: a server other than the recording server was given the size:\n${b}`);
  }
});

/** The tools the recording server serves, asked as a session asks: tools/list. A timeout fails. */
function servedTools() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(DRIVER, "engine", "mcp", "recording-server.mjs")], {
      stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("the recording server did not answer tools/list")); }, 20000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "schema-size", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("every recording tool's input schema fits under the size Codex is given", async () => {
  const tools = await servedTools();
  assert.ok(tools.length >= 10, `recording tools served: ${tools.map((t) => t.name).join(", ")}`);
  for (const t of tools) {
    const bytes = Buffer.byteLength(JSON.stringify(t.inputSchema ?? {}), "utf8");
    assert.ok(bytes <= CODEX_RECORDING_SCHEMA_BYTES,
      `${t.name}: its input schema is ${bytes} bytes, over the ${CODEX_RECORDING_SCHEMA_BYTES} Codex is given, so Codex would show it without `
      + "a single field description. Raise CODEX_RECORDING_SCHEMA_BYTES in codex-config.mjs, or shorten the schema.");
  }
});
