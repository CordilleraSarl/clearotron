// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONNECT LINE NAMES THE CLAUDE SETUP INSTALLED.
//
// `clearotron start` closes with "Connect your assistant to this install" and a `claude mcp add …` line,
// then "Check it:  claude mcp list". Setup installs Claude into its own engines folder, which is not on
// PATH, so on a machine where that is the only copy both commands answered "command not found" (measured on
// a published beta, right after setup installed it). Setup's own sign-in line already names that copy by
// its full path; the connect lines now do the same, and leave a copy on PATH as the bare word.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WSL_ROW_HEADINGS, stdioConnectOffer } from "../../shared/stdio-connect.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLED = "/h/.local/share/clearotron/engines/node_modules/@anthropic-ai/claude-code/cli.js";
// The lines as the one composer writes them, so the rewrite is driven over what start actually prints.
const LINES = stdioConnectOffer({ workDir: "/w", reportsDir: "/p" });

// Imported where it is used, so the real start below still runs against a tree that does not have it.
const naming = async () => (await import("../../bin/start.mjs")).connectLinesNamingClaude;

test("the copy setup installed is named by its path, and a copy on PATH keeps the bare word", async () => {
  const connectLinesNamingClaude = await naming();
  assert.match(LINES.command, /^claude /, "anti-vacuity: the composer's line does not start with the program word");
  const named = connectLinesNamingClaude(LINES, { source: "installed", resolved: INSTALLED });
  assert.equal(named.command, `${INSTALLED}${LINES.command.slice("claude".length)}`);
  assert.equal(named.verify, `${INSTALLED}${LINES.verify.slice("claude".length)}`);
  for (const program of [{ source: "path", resolved: "/usr/local/bin/claude" }, { source: null, resolved: null }, null])
    assert.deepEqual(connectLinesNamingClaude(LINES, program), LINES, `${JSON.stringify(program)} changed the lines`);
});

test("under WSL only the row run inside Linux names the installed copy", async () => {
  const connectLinesNamingClaude = await naming();
  const wsl = stdioConnectOffer({ workDir: "/w", reportsDir: "/p", wsl: { distro: "Ubuntu" } });
  const row = (o, heading) => o.variants.find((v) => v.heading === heading);
  assert.ok(row(wsl, WSL_ROW_HEADINGS.fromWindows) && row(wsl, WSL_ROW_HEADINGS.insideWsl), "anti-vacuity: the composer wrote no WSL pair");
  const named = connectLinesNamingClaude(wsl, { source: "installed", resolved: INSTALLED });
  assert.deepEqual(row(named, WSL_ROW_HEADINGS.fromWindows), row(wsl, WSL_ROW_HEADINGS.fromWindows), "the Windows row runs Windows' own claude");
  assert.equal(row(named, WSL_ROW_HEADINGS.insideWsl).text, `${INSTALLED}${row(wsl, WSL_ROW_HEADINGS.insideWsl).text.slice("claude".length)}`,
    "the row run inside Linux kept the bare word");
  assert.equal(named.verify, wsl.verify, "the check line serves both sides under WSL");
});

test("a real start, with Claude only in setup's engines folder, prints a connect line that names it", { timeout: 180000, skip: process.platform === "win32" ? "the planted copy is a POSIX script" : false }, async () => {
  const home = mkdtempSync(join(tmpdir(), "connect-names-claude-"));
  // The copy setup installs: the package in the engines folder, its `bin` naming the program.
  const engines = join(home, "engines");
  const pkg = join(engines, "node_modules", "@anthropic-ai", "claude-code");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-code", version: "9.9.9", bin: { claude: "cli.js" } }));
  writeFileSync(join(pkg, "cli.js"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(pkg, "cli.js"), 0o755);
  // PATH without any directory that holds a `claude`, so the engines folder is the only copy.
  const path = String(process.env.PATH).split(delimiter).filter((d) => d && !existsSync(join(d, "claude"))).join(delimiter);
  const ENDED = /Check it:/;
  const stop = async ({ child, closed }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; }
  };
  const boot = async (ports) => {
    const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--no-worker"], {
      env: { PATH: path, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1", PORTAL_LOCAL_USER: "op@localhost",
        CLEAROTRON_ENGINES_DIR: engines,
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => { said += c; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { said += c; });
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 90000;
    while (!ENDED.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    return { child, closed, said: () => said };
  };
  const run = await withFreePorts(["portal", "mcp", "client"], boot, {
    busy: (r) => !ENDED.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await stop(r); rmSync(home, { recursive: true, force: true }); mkdirSync(home); },
  });
  try {
    const said = run.said();
    assert.match(said, /Connect your assistant to this install/, "start never reached its connect lines");
    const program = join(pkg, "cli.js");
    assert.doesNotMatch(said, /^\s+claude mcp add /m, "the connect line runs a `claude` this machine's PATH does not have");
    assert.ok(said.includes(`    ${program} mcp add `), `the connect line does not name the installed copy:\n${said.split("\n").filter((l) => /mcp (add|list)/.test(l)).join("\n")}`);
    assert.ok(said.includes(`Check it:  ${program} mcp list`), "the check line does not name the installed copy");
  } finally {
    await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
