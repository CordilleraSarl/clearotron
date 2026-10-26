// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A TURN'S TOOL SERVERS ARE TOLD WHEN TO STOP SENDING.
//
// A plan call that outlasted its turn ended with it, and the unit could not write what the call had answered. Each
// turn now hands every tool server its time to stop sending, ahead of the turn's deadline by the reserve
// (providers/_shared/send-until.mjs), and every register server puts it on the call context the executor reads. The
// config is built per turn, because each attempt has its own deadline, and both engines carry a server's own
// environment to it: Claude passes the config whole, and codex writes each server's environment into its own table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withSendUntil } from "../engine/mcp/gather-config.mjs";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.stringify({ mcpServers: { register: { command: "node", args: ["server.mjs"], env: { CLEAROTRON_GATHER_SESSION_KEY: "k" } },
  band: { command: "node", args: ["band.mjs"] } } });

test("the turn's config hands every server its time to stop sending, and keeps what each already had", () => {
  const cfg = JSON.parse(withSendUntil(CONFIG, 1_800_000_123.9));
  for (const [name, server] of Object.entries(cfg.mcpServers))
    assert.equal(server.env?.CLEAROTRON_GATHER_SEND_UNTIL_MS, "1800000123", `${name} was not told when to stop sending`);
  assert.equal(cfg.mcpServers.register.env.CLEAROTRON_GATHER_SESSION_KEY, "k", "a server's own environment was lost");
  assert.equal(withSendUntil(undefined, 1), undefined, "a stage with no tools was given a config");
  assert.equal(withSendUntil("not json", 1), "not json");
  assert.equal(withSendUntil(CONFIG, Number.NaN), CONFIG, "a time that is not a number was written");
});

test("codex carries the time to stop sending to each server it starts", () => {
  const toml = renderCodexConfigToml({ mcpConfig: withSendUntil(CONFIG, 1_800_000_000), allowedTools: "", developerInstructions: "" });
  assert.equal((toml.match(/CLEAROTRON_GATHER_SEND_UNTIL_MS = "1800000000"/g) ?? []).length, 2, `codex's config does not carry it to both servers:\n${toml}`);
});

test("the wiring: each turn and each repair turn builds its config with the time, and every register server reads it", () => {
  const gateway = readFileSync(join(HERE, "..", "gateway.mjs"), "utf8");
  const sites = gateway.match(/mcpConfig: withSendUntil\(gatherMcpConfig, Date\.now\(\) \+ effTimeout \* 1000 - sendReserveMs\(effTimeout\)\)/g) ?? [];
  assert.equal(sites.length, 2, "a turn is dispatched without its time to stop sending");
  assert.doesNotMatch(gateway, /mcpConfig: gatherMcpConfig[,}]/, "a turn still takes the stage's config as it was built");
  const servers = readdirSync(join(HERE, "..", "engine", "mcp")).filter((f) => f.endsWith("-server.mjs"))
    .filter((f) => /const tctx = \(kind\) => \(\{/.test(readFileSync(join(HERE, "..", "engine", "mcp", f), "utf8")));
  assert.ok(servers.length >= 6, `guard: found only ${servers.length} register servers, so this reads too few`);
  for (const f of servers)
    assert.match(readFileSync(join(HERE, "..", "engine", "mcp", f), "utf8"), /sendUntilMs: sendUntilFromEnv\(\),/, `${f} does not put the time on its call context`);
});
