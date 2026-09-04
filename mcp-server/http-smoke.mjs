// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Manual HTTP smoke. The SDK HTTP client uses fetch/undici, which OOMs under a restrictive `ulimit -v`,
// so run it as a user without one (the same constraint smoke.mjs describes):
//
//   node mcp-server/http-smoke.mjs
//
// Spawns the real http-server (auth DISABLED for local) on a loopback port, drives it over the MCP
// Streamable-HTTP protocol, and proves: what_if_* is ABSENT from the remote surface (no shell, no spend
// remotely), a read tool works, and a withheld what-if call is refused. The session it drives carries no
// token and so resolves to `internal` — the read tools; an ops token would also see the write verbs.

import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildFixture, buildRichRun, RUN_ID2 } from "./test/_fixture.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 18799);
buildFixture();
buildRichRun();

// The auth-disabled door refuses to start without CLEAROTRON_ACCESS_FILE (http-server.mjs — no grants file
// means every token-less local caller resolves to internal read-all). This smoke spawns exactly that door,
// so without a grants file it now dies at boot with FATAL and the smoke fails before it tests anything.
//
// The file must GRANT, not merely exist: an empty `{tenants:{}}` resolves the session to accounts:[] and
// every read assertion below would then legitimately return nothing. With auth off, http-handler.mjs
// synthesises the identity `local-test@disabled`, so the smoke's own guest list admits that domain to
// everything — the read-all this smoke has always assumed, now stated out loud instead of relied on by
// omission.
const grantsFile = join(tmpdir(), `http-smoke-grants-${process.pid}.json`);
writeFileSync(grantsFile, JSON.stringify({ tenants: { smoke: { accounts: "*", users: { "*@disabled": "*" } } } }));

const child = spawn("node", [join(here, "http-server.mjs")], {
  env: { ...process.env, TRADEMARK_MCP_AUTH_DISABLED: "1", TRADEMARK_MCP_DEV: "1", TRADEMARK_MCP_HTTP_PORT: String(PORT), TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", CLEAROTRON_ACCESS_FILE: grantsFile },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let failed = false;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failed = true; };

await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error("http-server did not become ready in 8s")), 8000);
  child.stderr.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(to); resolve(); } });
  child.on("exit", (c) => { clearTimeout(to); reject(new Error(`http-server exited early (${c})`)); });
});

const client = new Client({ name: "http-smoke", version: "0" }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log("tools:", names.length, "→", names.join(", "));
ok(names.includes("brief") && names.includes("decision_timeline") && names.includes("search_runs"), "read tools present");
ok(!names.includes("what_if_plan") && !names.includes("what_if_run"), "what_if_* ABSENT from the remote surface");

const dt = JSON.parse((await client.callTool({ name: "decision_timeline", arguments: { runId: RUN_ID2 } })).content[0].text);
ok(dt.runId === RUN_ID2 && Array.isArray(dt.verdictHistory), `decision_timeline works (verdictHistory=${dt.verdictHistory?.join("→")})`);

const wf = await client.callTool({ name: "what_if_run", arguments: { confirmationToken: "x" } });
ok(!!wf.isError, "withheld what_if_run is refused as unknown");

const res = await client.listResources();
ok(Array.isArray(res.resources), `resources listable (${res.resources.length})`);

await client.close();
child.kill("SIGKILL");
rmSync(grantsFile, { force: true });
console.log(failed ? "HTTP SMOKE FAILED" : "HTTP SMOKE OK");
process.exit(failed ? 1 : 0);
