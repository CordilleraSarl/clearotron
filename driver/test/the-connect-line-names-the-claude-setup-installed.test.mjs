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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { STDIO_SHAPES, WSL_ROW_HEADINGS, stdioConnectFor, stdioConnectOffer } from "../../shared/stdio-connect.mjs";
import { connectOffers } from "../../shared/connect-clients.mjs";
import { namingProgram } from "../engine/probe.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLED = "/h/.local/share/clearotron/engines/node_modules/@anthropic-ai/claude-code/cli.js";
// The lines as the one composer writes them, so the rewrite is driven over what start actually prints.
const LINES = stdioConnectOffer({ workDir: "/w", reportsDir: "/p" });

// Imported where it is used, so the real start below still runs against a tree that does not have it.
const naming = async () => (await import("../../bin/start.mjs")).connectLinesNamingClaude;
const screen = async () => (await import("../../bin/start.mjs")).connectScreen;

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
  assert.equal(row(named, WSL_ROW_HEADINGS.fromWindows).text, row(wsl, WSL_ROW_HEADINGS.fromWindows).text, "the Windows row runs Windows' own claude");
  assert.equal(row(named, WSL_ROW_HEADINGS.insideWsl).text, `${INSTALLED}${row(wsl, WSL_ROW_HEADINGS.insideWsl).text.slice("claude".length)}`,
    "the row run inside Linux kept the bare word");
  assert.equal(named.verify, wsl.verify, "the line a surface prints once stays the Windows side's");
  assert.equal(row(named, WSL_ROW_HEADINGS.fromWindows).verify, wsl.verify, "the Windows row checks Windows' own claude");
  assert.equal(row(named, WSL_ROW_HEADINGS.insideWsl).verify, `${INSTALLED}${wsl.verify.slice("claude".length)}`,
    "the check line typed inside Linux runs a claude that shell does not have");
  const connectScreen = await screen();
  const lines = connectScreen(named);
  assert.deepEqual(lines.filter((l) => l.includes("Check it:")).map((l) => l.trim()),
    [`Check it:  ${wsl.verify}`, `Check it:  ${INSTALLED}${wsl.verify.slice("claude".length)}`], "each row does not carry its own check");
  // THE CONTROLS: with one answer for both rows, or no rows at all, the check is said once, last.
  const onPath = connectLinesNamingClaude(wsl, { source: "path", resolved: "/usr/local/bin/claude" });
  assert.deepEqual(connectScreen(onPath).filter((l) => l.includes("Check it:")), [`  Check it:  ${wsl.verify}`]);
  assert.deepEqual(connectScreen(LINES).slice(-2), [`  Check it:  ${LINES.verify}`, ""]);
});

test("the portal's page and `clearotron connect` name the installed copy, in the command and in its check", () => {
  const name = (text) => namingProgram(text, ENGINE_BINARIES["anthropic-agent"], { source: "installed", path: INSTALLED });
  const routes = (o = {}) => Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) => [shape, stdioConnectFor(shape, { workDir: "/w", reportsDir: "/p", ...o })]));
  const disk = (have) => connectOffers(have).find((o) => o.client.id === "claude-code" && o.route === "disk");
  const words = (offer) => JSON.stringify(offer.steps);
  const bare = disk({ stdioRoutes: routes() });
  assert.match(words(bare), /"text":"claude mcp add /, "anti-vacuity: the row does not hand over a bare claude");
  assert.match(words(bare), /`claude mcp list`/, "anti-vacuity: the row does not say how to check it");
  const named = disk({ stdioRoutes: routes(), nameClaude: name });
  assert.ok(words(named).includes(`"text":"${INSTALLED} mcp add `), `the command is still the bare word: ${words(named)}`);
  assert.ok(words(named).includes(`\`${INSTALLED} mcp list\``), `the check is still the bare word: ${words(named)}`);
  assert.doesNotMatch(words(named), /"text":"claude mcp add |`claude mcp list`/);
  // Another app's route names no program of ours, and it is left as it was.
  const other = (have) => connectOffers(have).filter((o) => o.route === "disk" && o.client.id !== "claude-code").map(words);
  assert.deepEqual(other({ stdioRoutes: routes(), nameClaude: name }), other({ stdioRoutes: routes() }));
  // UNDER WSL ONE HINT SERVES BOTH SIDES, so only the row run inside Linux moves.
  const wsl = disk({ stdioRoutes: routes({ wsl: { distro: "Ubuntu" } }), wsl: true, nameClaude: name });
  assert.ok(words(wsl).includes(`"text":"${INSTALLED} mcp add `), "the row run inside Linux kept the bare word");
  assert.match(words(wsl), /`claude mcp list`/, "the hint that serves both sides was rewritten for one");
  for (const file of ["driver/portal-service.mjs", "bin/connect.mjs"])
    assert.match(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), /nameClaude: claudeNamer\(/, `${file} does not hand its offers the rewrite`);
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

test("a demo on a machine with no Claude program says so before its connect line, and only then", async () => {
  // The line runs Claude Code. Printed alone on a machine without it, it failed as "claude: command not found".
  const { connectPrerequisiteLines } = await import("../../bin/start.mjs");
  const said = (o) => connectPrerequisiteLines(o).map((l) => l.trim()).join(" ");
  assert.equal(said({ demo: true, program: { resolved: null } }),
    "This needs Claude Code, and this machine does not have it. Install Claude Code, then run the line below.");
  // CONTROLS: a demo on a machine that has the program, and a real install, whose setup offers the program.
  assert.deepEqual(connectPrerequisiteLines({ demo: true, program: { resolved: "/opt/example/bin/claude" } }), []);
  assert.deepEqual(connectPrerequisiteLines({ demo: false, program: { resolved: null } }), []);
  // And it is printed where the reader meets the connect line: after the heading, before the line itself.
  const src = readFileSync(new URL("../../bin/start.mjs", import.meta.url), "utf8");
  assert.match(src, /say\("  Connect your assistant to this install — no address and no sign-in:"\);\n\s*say\(""\);\n\s*for \(const line of connectPrerequisiteLines\(\{ demo: DEMO, program: claudeProgram \}\)\) say\(line\);/,
    "the line is no longer said straight above the demo's connect line");
});
