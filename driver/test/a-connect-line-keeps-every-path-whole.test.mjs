// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CONNECT LINE KEEPS EVERY PATH WHOLE, IN THE SHELL OR FILE IT IS PASTED INTO.
//
// Measured on the published beta, 2026-09-19. The Claude Code line joined its arguments with spaces, so
// under `/tmp/Example User/…` bash handed the assistant `/tmp/Example` and `User/node/bin/node` as two
// arguments; the work directory and the server's path split the same way. The Codex block wrapped raw
// values in double quotes, so `C:\Program Files\nodejs\node.exe` made a file Python's `tomllib` refuses:
// "Unescaped '\' in a string".
//
// Each check here reads the text the way its reader will: a real bash and a real sh run the line against a
// stand-in `claude` that records the arguments it received, and a real TOML parser reads the block. A string
// that merely contains the right path proves nothing about how it is split. The Windows lines are read by
// the C runtime's documented splitting rules, written out below, because this machine has no Windows shell;
// no claim is made about a real Windows session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { stdioConnectFor, STDIO_SERVER_NAME, remoteConnectFor } from "../../shared/stdio-connect.mjs";
import { tomlString } from "../../shared/toml-string.mjs";

const serverOf = (installRoot) => join(installRoot, "mcp-server", "serve.mjs");

/** The arguments a POSIX shell hands `claude` for this line, read from a stand-in that records them. */
function argvIn(shell, line) {
  const r = spawnSync(shell, ["-c", `claude() { printf '%s\\0' "$@"; }\n${line}`], { encoding: "utf8" });
  assert.equal(r.status, 0, `${shell} could not run the line: ${r.stderr}`);
  return r.stdout.split("\0").slice(0, -1);
}

/**
 * How a Windows program splits its command line (the C runtime's rules). Whitespace outside quotes ends an
 * argument; a double quote toggles quoting; backslashes are literal unless they run up to a quote, where
 * 2n of them give n and the quote toggles, and 2n+1 give n and a literal quote.
 */
function windowsArgv(line) {
  const out = [];
  let cur = "", inQuotes = false, started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i] === "\\") { n++; i++; }
      if (line[i] === '"') {
        cur += "\\".repeat(Math.floor(n / 2));
        if (n % 2) cur += '"'; else inQuotes = !inQuotes;
      } else { cur += "\\".repeat(n); i--; }
      started = true;
    } else if (c === '"') { inQuotes = !inQuotes; started = true; }
    else if (/\s/.test(c) && !inQuotes) { if (started) out.push(cur); cur = ""; started = false; }
    else { cur += c; started = true; }
  }
  if (started) out.push(cur);
  return out;
}

/** The block as a real TOML parser reads it. */
function parseToml(text) {
  // The bytes are decoded as UTF-8 by name: Python on Windows reads stdin in the ANSI code page, which
  // turns every non-ASCII value into something the block never said.
  const r = spawnSync("python3", ["-c", "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.buffer.read().decode('utf-8'))))"],
    { input: text, encoding: "utf8" });
  assert.equal(r.error, undefined, "python3 is not on this machine, and the TOML check needs a real parser");
  assert.equal(r.status, 0, `the block does not parse as TOML:\n${text}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

const HEAD = ["mcp", "add", STDIO_SERVER_NAME, "--scope", "user"];

// Paths a real machine can have: a space, an apostrophe in a name, the characters a shell acts on.
const POSIX_CASES = [
  { installRoot: "/tmp/Example User/clearotron", node: "/tmp/Example User/node/bin/node", workDir: "/tmp/Example User/workspace", reportsDir: "/tmp/Example User/reports" },
  { installRoot: "/home/o'brien/clearotron", node: "/home/o'brien/.nvm/versions/node/v22.17.0/bin/node", workDir: "/home/o'brien/work", reportsDir: null },
  { installRoot: "/srv/a $HOME & b;c/clearotron", node: "/srv/*(node)/bin/node", workDir: "/srv/`w` \"q\" ~x", reportsDir: "/srv/é ü" },
];

test("the Claude Code line reaches bash and sh as exactly the arguments it names", () => {
  for (const c of POSIX_CASES) {
    const line = stdioConnectFor("claude-cli", { ...c, platform: "linux" }).text;
    const env = [["CLEAROTRON_WORK_DIR", c.workDir], ["CLEAROTRON_REPORTS_DIR", c.reportsDir]].filter(([, v]) => v).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const want = [...HEAD, ...env, "--", c.node, serverOf(c.installRoot)];
    for (const shell of ["bash", "sh"]) assert.deepEqual(argvIn(shell, line), want, `${shell} split the line differently:\n${line}`);
  }
});

test("the stand-in can tell a split line from a whole one", () => {
  // THE CONTROL: the line as the published beta wrote it, arguments joined with spaces.
  const c = POSIX_CASES[0];
  const naive = `claude ${[...HEAD, "--", c.node, serverOf(c.installRoot)].join(" ")}`;
  assert.notDeepEqual(argvIn("bash", naive), [...HEAD, "--", c.node, serverOf(c.installRoot)]);
});

// The server's path is joined from the install root with this host's separator, as the product joins it.
// On a Windows host that path carries backslashes, which a POSIX shell word needs single-quoted and a TOML
// string needs doubled; everywhere else it is the bare path it always was.
const ORDINARY_SERVER = process.platform === "win32" ? "\\opt\\clearotron\\mcp-server\\serve.mjs" : "/opt/clearotron/mcp-server/serve.mjs";
const ORDINARY_SERVER_WORD = process.platform === "win32" ? `'${ORDINARY_SERVER}'` : ORDINARY_SERVER;
const ORDINARY_SERVER_TOML = process.platform === "win32" ? "\\\\opt\\\\clearotron\\\\mcp-server\\\\serve.mjs" : ORDINARY_SERVER;

test("an ordinary install's line reads exactly as it always has", () => {
  assert.equal(stdioConnectFor("claude-cli", { installRoot: "/opt/clearotron", node: "/usr/bin/node", workDir: "/w", reportsDir: "/p", platform: "linux" }).text,
    `claude mcp add ${STDIO_SERVER_NAME} --scope user -e CLEAROTRON_WORK_DIR=/w -e CLEAROTRON_REPORTS_DIR=/p -- /usr/bin/node ${ORDINARY_SERVER_WORD}`);
  assert.equal(stdioConnectFor("codex-toml", { installRoot: "/opt/clearotron", node: "/usr/bin/node", workDir: "/w", platform: "linux" }).text, [
    `[mcp_servers.${STDIO_SERVER_NAME}]`,
    `command = "/usr/bin/node"`,
    `args = ["${ORDINARY_SERVER_TOML}"]`,
    `env = { CLEAROTRON_WORK_DIR = "/w" }`,
  ].join("\n"));
});

const WINDOWS_CASES = [
  { installRoot: "C:\\Users\\Example\\clearotron", node: "C:\\Program Files\\nodejs\\node.exe", workDir: "C:\\Users\\Example\\workspace" },
  { installRoot: "C:\\Users\\Example User\\clearotron", node: "C:\\Program Files (x86)\\nodejs\\node.exe", workDir: "C:\\work dir\\" },
  { installRoot: "D:\\o'brien, a&b\\clearotron", node: "D:\\node\\node.exe", workDir: "D:\\w" },
];

test("the Windows Claude Code line is split back into exactly the arguments it names", () => {
  for (const c of WINDOWS_CASES) {
    const line = stdioConnectFor("claude-cli", { ...c, platform: "win32" }).text;
    assert.deepEqual(windowsArgv(line), ["claude", ...HEAD, "-e", `CLEAROTRON_WORK_DIR=${c.workDir}`, "--", c.node, serverOf(c.installRoot)],
      `a Windows program would read this line differently:\n${line}`);
  }
});

test("on WSL, the Windows-side line and the inside line each keep the distribution, the Node and the paths", () => {
  const c = { installRoot: "/home/Example User/clearotron", node: "/home/Example User/.nvm/versions/node/v22.17.0/bin/node", workDir: "/home/Example User/work" };
  for (const distro of ["Ubuntu-24.04", ""]) {
    const [fromWindows, insideWsl] = stdioConnectFor("claude-cli", { ...c, platform: "linux", wsl: { distro } }).variants;
    assert.deepEqual(windowsArgv(fromWindows.text),
      ["claude", ...HEAD, "--", "wsl.exe", "-d", distro || "YOUR-WSL-DISTRIBUTION", "-e", "env", `CLEAROTRON_WORK_DIR=${c.workDir}`, c.node, serverOf(c.installRoot)],
      `the Windows-side line splits differently:\n${fromWindows.text}`);
    assert.deepEqual(argvIn("bash", insideWsl.text), [...HEAD, "-e", `CLEAROTRON_WORK_DIR=${c.workDir}`, "--", c.node, serverOf(c.installRoot)],
      `the inside line splits differently:\n${insideWsl.text}`);
  }
});

test("the Codex block parses as TOML and gives back every value exactly", () => {
  const cases = [
    ...WINDOWS_CASES.map((c) => ({ ...c, platform: "win32" })),
    ...POSIX_CASES.map((c) => ({ ...c, platform: "linux" })),
    { installRoot: "C:\\a \"quoted\" dir", node: "C:\\Program Files\\nodejs\\node.exe", workDir: "C:\\tab\there", platform: "win32" },
  ];
  for (const c of cases) {
    const text = stdioConnectFor("codex-toml", c).text;
    const s = parseToml(text).mcp_servers?.[STDIO_SERVER_NAME];
    assert.ok(s, `no server table in:\n${text}`);
    assert.equal(s.command, c.node);
    assert.deepEqual(s.args, [serverOf(c.installRoot)]);
    const env = Object.fromEntries([["CLEAROTRON_WORK_DIR", c.workDir], ["CLEAROTRON_REPORTS_DIR", c.reportsDir]].filter(([, v]) => v));
    assert.deepEqual(s.env, env);
  }
  // On WSL the environment rides inside the arguments, and they come back whole too.
  const wsl = { installRoot: "/home/Example User/clearotron", node: "/home/Example User/node", workDir: "/home/Example User/w", wsl: { distro: "Ubuntu" } };
  assert.deepEqual(parseToml(stdioConnectFor("codex-toml", wsl).text).mcp_servers[STDIO_SERVER_NAME],
    { command: "wsl.exe", args: ["-d", "Ubuntu", "-e", "env", `CLEAROTRON_WORK_DIR=${wsl.workDir}`, wsl.node, serverOf(wsl.installRoot)] });
  // The web block's address goes through the same encoder.
  assert.equal(parseToml(remoteConnectFor("codex-toml-http", { address: "https://mcp.example.test/mcp" }).text).mcp_servers[STDIO_SERVER_NAME].url,
    "https://mcp.example.test/mcp");
});

test("the TOML encoder escapes every character TOML refuses raw, and the parser reads it back", () => {
  const every = Array.from({ length: 0x80 }, (_, i) => String.fromCharCode(i)).join("") + "é ☃ \u{1F600}";
  assert.equal(parseToml(`v = ${tomlString(every)}`).v, every);
  // THE CONTROL: the old form, a raw value in double quotes, is refused.
  const r = spawnSync("python3", ["-c", "import sys, tomllib; tomllib.loads(sys.stdin.read())"], { input: 'v = "C:\\Program Files"', encoding: "utf8" });
  assert.notEqual(r.status, 0, "the parser accepted an unescaped backslash, so it cannot tell a broken block from a good one");
});

test("the JSON shapes keep every value exactly, as they always did", () => {
  for (const c of [...POSIX_CASES.map((x) => ({ ...x, platform: "linux" })), ...WINDOWS_CASES.map((x) => ({ ...x, platform: "win32" }))]) {
    const s = JSON.parse(stdioConnectFor("desktop-json", c).text).mcpServers[STDIO_SERVER_NAME];
    assert.equal(s.command, c.node);
    assert.deepEqual(s.args, [serverOf(c.installRoot)]);
  }
});
