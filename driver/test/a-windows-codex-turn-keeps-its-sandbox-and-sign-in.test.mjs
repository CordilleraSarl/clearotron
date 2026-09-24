// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: A CODEX TURN RUNS INSIDE CODEX'S SANDBOX, AND KEEPS ITS SIGN-IN.
//
// Two facts about Codex on Windows, read in its own source at the version this engine pins (0.156.1):
//
//   · With no `[windows] sandbox` in its config, Codex picks NO Windows sandbox at all, so the
//     `--sandbox workspace-write` on the command line would hold nothing there. The per-turn config names
//     `unelevated`, the mode that needs no administrator.
//   · Windows lets a user make a symbolic link only with Developer Mode on or as an administrator. The
//     stage's sign-in is a link to the master login; where the link is refused it is a copy, and a refresh
//     Codex writes into the copy goes back to the master.
//
// Both are driven here on Linux: the renderer takes the platform, and the link is injected to refuse as
// Windows refuses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";
import { seedAuth, returnAuth } from "../engine/openai-agent.mjs";

const MCP = JSON.stringify({ mcpServers: { register: { command: "node", args: ["register.mjs"], env: {} } } });
const ALLOWED = "mcp__register__register_search WebFetch";

test("on Windows the turn's config names the unelevated sandbox; elsewhere it names none", () => {
  const win = renderCodexConfigToml({ mcpConfig: MCP, allowedTools: ALLOWED, platform: "win32" });
  assert.match(win, /^\[windows\]\nsandbox = "unelevated"$/m, `no Windows sandbox named, so Codex would run with none:\n${win}`);
  // A table after the server blocks, so no server key falls under it, and every server keeps its approval.
  const tables = win.match(/^\[[^\]]+\]$/gm);
  assert.equal(tables.at(-1), "[windows]", `the Windows table is not last, so the keys after it would be read as its own:\n${win}`);
  for (const block of win.split(/^(?=\[)/m).filter((b) => b.startsWith("[mcp_servers.")))
    assert.match(block, /^default_tools_approval_mode = "approve"$/m);
  const linux = renderCodexConfigToml({ mcpConfig: MCP, allowedTools: ALLOWED, platform: "linux" });
  assert.doesNotMatch(linux, /\[windows\]/, "a Windows table was written on Linux");
});

test("where Windows refuses the link, the sign-in is a copy, and a rotated login still goes back", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-seat-"));
  const master = join(dir, "master-auth.json");
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  writeFileSync(master, '{"tokens":"first"}');
  const refuse = () => { throw Object.assign(new Error("A required privilege is not held by the client."), { code: "EPERM" }); };
  const seeded = seedAuth(master, home, { link: refuse });
  const seat = join(home, "auth.json");
  assert.equal(lstatSync(seat).isSymbolicLink(), false);
  assert.equal(readFileSync(seat, "utf8"), '{"tokens":"first"}', "the stage started with no sign-in where Windows refused the link");
  writeFileSync(seat, '{"tokens":"rotated"}');   // Codex refreshed its token during the turn
  assert.equal(returnAuth(master, home, seeded), true);
  assert.equal(readFileSync(master, "utf8"), '{"tokens":"rotated"}',
    "the refreshed login stayed in the stage's copy, so the next turn would present a spent token");
});

test("a link that fails for any other reason is not papered over with a copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-seat-"));
  const master = join(dir, "master-auth.json");
  writeFileSync(master, "{}");
  const broken = () => { throw Object.assign(new Error("I/O error"), { code: "EIO" }); };
  assert.throws(() => seedAuth(master, mkdtempSync(join(tmpdir(), "codex-home-")), { link: broken }), /I\/O error/);
});

test("on Linux the sign-in is still the link it was", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-seat-"));
  const master = join(dir, "master-auth.json");
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  writeFileSync(master, "{}");
  seedAuth(master, home);
  assert.equal(lstatSync(join(home, "auth.json")).isSymbolicLink(), true);
});
