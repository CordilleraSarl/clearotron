// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PACKAGE STARTS THE MCP SERVER, AND A MACHINE WITH NO INSTALL SEES THE DEMO THROUGH IT.
//
// No verb started the server: `npx clearotron` printed help, and a listing that launches the published
// package had nothing to launch. `clearotron mcp` starts it over stdio. Where the machine has an install,
// it reads that install's runs, an install whose settings live only in the services' `~/.env` included;
// a work folder that was named and is missing is said, never listed as empty; and where there is no
// install, it answers from the demo's four sample runs, each row saying it is the demo.
//
// Driven through the real command, over stdio, with a fresh home for every arm. Standard output must carry
// nothing but protocol messages, from the first byte.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTarget, demoWorkspace } from "../../bin/mcp.mjs";
import { VERBS } from "../../bin/clearotron.mjs";
import { seedDemoRuns } from "../../driver/demo-container.mjs";
import { DEMO_LABEL } from "../server.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const homes = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });
const freshHome = () => { const h = mkdtempSync(join(tmpdir(), "mcp-verb-home-")); homes.push(h); return h; };
const files = (map) => (p) => { if (p in map) return map[p]; throw Object.assign(new Error("absent"), { code: "ENOENT" }); };

test("the install decision: an install wherever one is configured or on disk, the demo only where there is none", () => {
  const home = "/h";
  const none = () => false;
  assert.deepEqual(mcpTarget({ env: {}, home, exists: none, read: files({}) }), { demo: true, env: {} });
  // A background install's services read ~/.env, and the server does not: its folders are handed over.
  assert.deepEqual(mcpTarget({ env: {}, home, exists: none, read: files({ "/h/.env": "CLEAROTRON_WORK_DIR=/srv/ws\nCLEAROTRON_REPORTS_DIR=/srv/pool\n" }) }),
    { demo: false, env: { CLEAROTRON_WORK_DIR: "/srv/ws", CLEAROTRON_REPORTS_DIR: "/srv/pool" } });
  // Configured and not pointed at a folder is still an install: the server names what is missing.
  assert.deepEqual(mcpTarget({ env: {}, home, exists: none, read: files({ "/h/.config/clearotron/.env": "TRADEMARK_MCP_TOKEN_SECRET=x\n" }) }),
    { demo: false, env: {} });
  assert.deepEqual(mcpTarget({ env: {}, home, exists: (p) => p === "/h/trademark/workspace", read: files({}) }), { demo: false, env: {} });
  // The environment's own value wins over a file's.
  assert.deepEqual(mcpTarget({ env: { CLEAROTRON_WORK_DIR: "/mine" }, home, exists: none, read: files({ "/h/.env": "CLEAROTRON_WORK_DIR=/srv/ws\n" }) }).env,
    { CLEAROTRON_WORK_DIR: "/mine" });
  // A ~/.env belonging to something else is not an install.
  assert.deepEqual(mcpTarget({ env: {}, home, exists: none, read: files({ "/h/.env": "SOME_OTHER_TOOL=1\n" }) }), { demo: true, env: {} });
});

test("the verb is on the one command", () => {
  assert.deepEqual(VERBS.mcp, ["bin/mcp.mjs"]);
});

/** Start `clearotron mcp`, initialize, list runs; return what came back and every stdout line. */
async function drive(home) {
  const child = spawn(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "mcp"],
    { env: { PATH: process.env.PATH, HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const reply = async (id) => {
    for (let i = 0; i < 400; i += 1) {
      for (const l of out.split("\n")) { try { const m = JSON.parse(l); if (m.id === id) return m; } catch { /* not yet a line */ } }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no reply ${id}; stderr: ${err.slice(0, 400)}`);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const init = await reply(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_runs", arguments: {} } });
    const listed = await reply(2);
    return { init, listed, lines: out.split("\n").filter(Boolean) };
  } finally { child.kill("SIGTERM"); }
}
const onlyProtocol = (lines) => lines.every((l) => { try { return JSON.parse(l).jsonrpc === "2.0"; } catch { return false; } });

test("with no install, the server answers from the demo's four runs, each saying it is the demo", async () => {
  const home = freshHome();
  const { init, listed, lines } = await drive(home);
  assert.ok(init.result?.serverInfo, "the server did not initialize");
  assert.ok(onlyProtocol(lines), `something other than protocol reached standard output: ${lines.find((l) => !l.startsWith("{"))}`);
  const runs = JSON.parse(listed.result.content[0].text);
  assert.equal(runs.length, 4);
  assert.ok(runs.every((r) => r.demo === DEMO_LABEL), "a demo row did not say it is the demo");
  // Seeded under the demo's own base, nowhere an install reads.
  assert.equal(existsSync(join(home, "trademark")), false, "the demo wrote where an install reads");
  assert.match(readFileSync(join(home, "trademark-demo", "workspace", "workspace-localagent", "studio", "clearance-search",
    runs[0].slug, `${runs[0].date}-${runs[0].codename}`, "status.json"), "utf8"), /"slug"/);
});

test("the demo's label is the demo's own two sentences, as `clearotron demo` prints them", () => {
  const printed = readFileSync(join(ROOT, "bin", "example.mjs"), "utf8");
  for (const sentence of DEMO_LABEL.split(/(?<=\.) /)) assert.ok(printed.includes(sentence), `not a sentence the demo prints: ${sentence}`);
});

test("an install configured only in the services' ~/.env reads its own runs, never the demo", async () => {
  const home = freshHome();
  const workspace = join(home, "srv", "workspace");
  seedDemoRuns({ workspace, examplesDir: join(ROOT, "demo") });   // a stand-in for the install's own runs
  writeFileSync(join(home, ".env"), `CLEAROTRON_WORK_DIR=${workspace}\n`);
  const { listed, lines } = await drive(home);
  assert.ok(onlyProtocol(lines));
  const runs = JSON.parse(listed.result.content[0].text);
  assert.equal(runs.length, 4);
  assert.ok(runs.every((r) => !("demo" in r)), "an install's run was labelled the demo");
  assert.equal(existsSync(demoWorkspace(home)), false, "an install's machine was given the demo's runs");
});

test("a work folder that was named and is missing is said, never listed as empty and never the demo", async () => {
  const home = freshHome();
  const missing = join(home, "no-such-folder");
  writeFileSync(join(home, ".env"), `CLEAROTRON_WORK_DIR=${missing}\n`);
  const { listed } = await drive(home);
  assert.equal(listed.result.isError, true);
  const said = listed.result.content[0].text;
  assert.ok(said.includes(`CLEAROTRON_WORK_DIR is ${missing}, which does not exist`), said);
  assert.doesNotMatch(said, /VENQORI/);
  mkdirSync(missing);
  assert.ok(Array.isArray(JSON.parse((await drive(home)).listed.result.content[0].text)), "an existing, empty folder is an empty list");
});
