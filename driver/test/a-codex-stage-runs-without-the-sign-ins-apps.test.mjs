// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CODEX STAGE RUNS WITHOUT THE SIGN-IN'S APPS.
//
// A ChatGPT sign-in brings the program's apps (connectors) into every Codex session as a tool server of its own,
// `codex_apps`, beside the servers a stage is given. With the program's own web search switched off, a knockout
// assess stage reached the web through that server's search service instead: four calls, each opening a live
// page (measured on the test box, Codex 0.162.0, 2026-10-13). The web-search setting never reached it; the
// vendor's configuration reference says its filters "do not restrict connectors or MCP servers". Every stage's
// configuration now switches the integration off (`features.apps`), in both safety settings. Measured the same
// day on 0.162.0 with a ChatGPT sign-in: the session offered 116 tools, the apps' among them, and with the switch
// 23, none of them the apps' or their search, with the sandbox bypassed and with it on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";

function parseToml(text) {
  const r = spawnSync("python3", ["-c", "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))"], { input: text, encoding: "utf8" });
  assert.equal(r.error, undefined, "python3 is not on this machine, and the TOML check needs a real parser");
  assert.equal(r.status, 0, `the config does not parse as TOML:\n${text}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("every stage's configuration switches the sign-in's apps off, in both safety settings, beside the web search", () => {
  for (const fence of [null, { runDir: "/run" }]) for (const withheld of [[], ["SIGNA_API_KEY"]]) {
    const where = `${fence ? "sandbox on" : "sandbox bypassed"}, ${withheld.length ? "names withheld" : "nothing withheld"}`;
    const cfg = parseToml(renderCodexConfigToml({ mcpConfig: JSON.stringify({ mcpServers: {} }), allowedTools: [],
      developerInstructions: "Answer the question asked.", fence, withheldFromCommands: withheld }));
    assert.equal(cfg.features?.apps, false, `${where}: the sign-in's apps stay on, and their search reaches the web`);
    assert.equal(cfg.web_search, "disabled", `${where}: the program's own web search is back`);
    assert.equal(cfg.features?.shell_snapshot, withheld.length ? false : undefined, `${where}: the shell snapshot setting moved`);
  }
});
