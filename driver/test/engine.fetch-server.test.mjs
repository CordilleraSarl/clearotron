// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/fetch-server.mjs — the codex-engine's stand-in for claude's built-in WebFetch (codex has none).
// Offline stdio round-trip: handshake → tools/list → a bad-url guard call that returns a clean isError with
// NO network. A live fetch is not exercised here — undici breaks under the constrained ulimits this
// suite runs with, so the transport is proved against a host that never resolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");

async function mcpSession(serverScript, requests, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, serverScript)], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    const responses = {}; let buf = "", stderr = "";
    const wantIds = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ responses, stderr }); };
    const timer = setTimeout(done, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) { responses[m.id] = m; wantIds.delete(m.id); } } catch { /* non-json */ }
      }
      if (wantIds.size === 0) { clearTimeout(timer); done(); }
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

test("fetch server: handshake + exposes fetch_url", async () => {
  const { responses } = await mcpSession("fetch-server.mjs", [INIT, LIST]);
  assert.equal(responses[1]?.result?.serverInfo?.name, "fetch");
  assert.deepEqual((responses[2]?.result?.tools ?? []).map((t) => t.name), ["fetch_url"]);
});

test("fetch server: a non-url arg returns a clean isError (guard, no network)", async () => {
  const CALL = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fetch_url", arguments: { url: "not-a-url" } } };
  const { responses } = await mcpSession("fetch-server.mjs", [INIT, CALL]);
  assert.equal(responses[3]?.result?.isError, true);
  assert.match(responses[3]?.result?.content?.[0]?.text ?? "", /valid absolute http\(s\) url/);
});
