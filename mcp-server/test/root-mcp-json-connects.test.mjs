// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real server over stdio
//
// — ONE-STEP CONNECT. A visitor clones the repository, opens the folder in an MCP host, and the
// server is offered to them. `.mcp.json` at the repository root is the whole mechanism: Claude Code
// reads it on open and asks whether to trust the servers it names.
//
// THE FILE IS FOUR LINES BECAUSE IT HAS TO BE. Every value it could carry is a value the visitor would
// have to edit first, and an edit is the step this issue exists to remove. So:
//
//   · the command path is RELATIVE, resolved from the project root the host already opened
//   · there is NO env block — `driver.config.mjs` defaults the workspace root to ~/trademark/workspace,
//     the same laptop default `npm run example` and `npm start` use
//
// The arms below assert the file's shape AND that a server spawned from it actually answers, because a
// well-formed config naming a server that cannot start is the failure this would otherwise ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = join(ROOT, ".mcp.json");
const KEY = "trademark-artifacts";

test("#766 the repository root carries a .mcp.json naming this server", () => {
  assert.ok(existsSync(CONFIG), ".mcp.json is gone — opening the folder no longer offers the server, "
    + "and a visitor is back to reading CONNECT.md and editing a config by hand");
  const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
  const s = cfg.mcpServers?.[KEY];
  assert.ok(s, `.mcp.json no longer names "${KEY}" — the key is what CONNECT.md and the packs refer to`);
  assert.equal(s.command, "node");
  assert.deepEqual(s.args, ["mcp-server/server.mjs"]);
});

test("#766 it asks the visitor for NOTHING — no env block, and a path that is not somebody's machine", () => {
  const s = JSON.parse(readFileSync(CONFIG, "utf8")).mcpServers[KEY];
  // An env block here is a placeholder the visitor must replace, which is the step this file removes.
  assert.equal(Object.keys(s.env ?? {}).length, 0,
    "an env block reappeared — every key in it is an edit before the server will start, and the "
    + "acceptance is 'with no file edited'");
  for (const a of s.args) {
    assert.equal(isAbsolute(a), false, `${a} is absolute — it names the machine it was written on`);
    assert.ok(existsSync(join(ROOT, a)), `${a} does not resolve from the repository root`);
  }
  assert.doesNotMatch(readFileSync(CONFIG, "utf8"), /\/(home|Users)\//,
    "#644 — a config that names an account's home is wrong under every other account");
});

test("#766 a server spawned exactly as the config says ANSWERS, with the environment stripped", async () => {
  // The arms above are shape. This one is the claim: clone, open, accept, ask — no token, no edit.
  const s = JSON.parse(readFileSync(CONFIG, "utf8")).mcpServers[KEY];
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };   // deliberately not process.env
  const child = spawn(s.command, s.args, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    await new Promise((r) => setTimeout(r, 900));
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await new Promise((r) => setTimeout(r, 2500));
  } finally { child.kill(); }

  const msgs = out.split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = msgs.find((m) => m.id === 1);
  const tools = msgs.find((m) => m.id === 2);
  assert.ok(init, `the server never answered initialize — a config that offers a server that cannot `
    + `start is worse than no config\n${out.slice(0, 400)}`);
  assert.equal(init.result?.serverInfo?.name, KEY, "it introduced itself as something else");
  assert.ok(Array.isArray(tools?.result?.tools), "it answered initialize and then served no tool list");
  assert.ok(tools.result.tools.length > 20,
    `only ${tools.result.tools.length} tools — the surface a visitor is offered has collapsed`);
  for (const want of ["brief", "list_runs", "read_artifact"])
    assert.ok(tools.result.tools.some((t) => t.name === want), `the offered surface lost ${want}`);
});
