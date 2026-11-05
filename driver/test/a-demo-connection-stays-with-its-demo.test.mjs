// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO'S CONNECTION STAYS WITH ITS DEMO, AND STARTS NOTHING.
//
// The line `clearotron demo` prints connected an assistant with full operator tools under the same name a real install
// uses. `what_if_run` with a memo reached a model turn. `start_run` queued into the real install's queue, because the
// line named only the demo's workspace and the server fell back for the rest. Registered with `--scope user`, it outlived
// the demo, and then read the machine's own settings. A demo's tool request now reaches no model, register or paid search,
// the connection has its own name, every other path is the demo's, and a demo that is gone refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEMO_SERVER_NAME, STDIO_SERVER_NAME, STDIO_SHAPES, stdioConnectFor, stdioConnectOffer, stdioLauncher } from "../../shared/stdio-connect.mjs";
import { DEMO_WITHHELD_TOOLS, TOOL_SCOPES, visibleTools } from "../../shared/scope.mjs";
import { bindDemoConnection } from "../../shared/demo-connection.mjs";
import { connectOffers } from "../../shared/connect-clients.mjs";
import { installPaths } from "../../bin/start.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVE = join(ROOT, "mcp-server", "serve.mjs");
const routes = (o) => Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) => [shape, stdioConnectFor(shape, { workDir: "/d/workspace", reportsDir: "/d/pool", ...o })]));

test("every shape of a demo's line carries the demo's own name and says it is a demo; a real install's does not", () => {
  const offer = stdioConnectOffer({ workDir: "/d/workspace", demo: true });
  assert.match(offer.command, new RegExp(`^claude mcp add ${DEMO_SERVER_NAME} `), offer.command);
  assert.match(offer.command, /CLEAROTRON_DEMO=1/, offer.command);
  assert.equal(offer.name, DEMO_SERVER_NAME);
  assert.ok(offer.verify.includes(DEMO_SERVER_NAME), offer.verify);
  for (const [shape, route] of Object.entries(routes({ demo: true }))) {
    assert.equal(route.name, DEMO_SERVER_NAME, shape);
    assert.match(route.text, /CLEAROTRON_DEMO/, `${shape} does not say it is a demo: ${route.text}`);
  }
  assert.ok(stdioLauncher({ server: "/s", workDir: "/w", wsl: { distro: "Ubuntu" }, demo: true }).args.includes("CLEAROTRON_DEMO=1"), "the flag does not cross into WSL");
  // THE CONTROL: a real install's lines are what they were.
  for (const [shape, route] of Object.entries(routes({}))) {
    assert.equal(route.name, STDIO_SERVER_NAME, shape);
    assert.doesNotMatch(route.text, /CLEAROTRON_DEMO|-demo/, `${shape} of a real install was marked: ${route.text}`);
  }
});

test("the page's rows name the demo's connection in their words too", () => {
  const disk = (have) => connectOffers(have).filter((o) => o.route === "disk" && o.served).map((o) => JSON.stringify(o.steps)).join("\n");
  const demo = disk({ stdioRoutes: routes({ demo: true }), demo: true });
  assert.ok(demo.includes(DEMO_SERVER_NAME), "anti-vacuity: no row named the connection");
  assert.equal(demo.replaceAll(DEMO_SERVER_NAME, "").includes(STDIO_SERVER_NAME), false, "a demo's row still names a real install's connection");
  assert.equal(disk({ stdioRoutes: routes({}) }).includes(DEMO_SERVER_NAME), false, "a real install's row named the demo's");
});

test("no audience is offered a tool that starts work in a demo, and only those tools are withheld", () => {
  for (const name of DEMO_WITHHELD_TOOLS) assert.ok(TOOL_SCOPES[name], `${name} is no tool: the list has drifted from the table`);
  for (const audience of [{ kind: "ops", local: true }, { kind: "ops", local: false }, { kind: "account" }, { kind: "user" }, { kind: "internal" }]) {
    const demo = visibleTools({ ...audience, demo: true });
    const real = visibleTools(audience);
    for (const name of Object.keys(TOOL_SCOPES)) {
      if (DEMO_WITHHELD_TOOLS.includes(name)) assert.equal(demo(name), false, `${name} was offered to ${audience.kind} in a demo`);
      else assert.equal(demo(name), real(name), `${name} changed for ${audience.kind} in a demo`);
    }
  }
  assert.equal(visibleTools({ kind: "ops", local: true })("what_if_run"), true, "the control: a real install's local operator keeps it");
});

test("the binding pins the demo's whole layout, exactly as the supervisor lays it out", () => {
  const base = join("/d", "demo-base");
  const env = { CLEAROTRON_WORK_DIR: join(base, "workspace"), CLEAROTRON_QUEUE_DIR: "/a/real/queue", CLEAROTRON_CUSTOMERS_DIR: "/a/real/store" };
  assert.equal(bindDemoConnection(env, () => true), null);
  const p = installPaths(base);
  assert.equal(env.CLEAROTRON_NO_ENV_FILE, "1", "the machine's settings file would still be read");
  for (const [name, want] of [["CLEAROTRON_REPORTS_DIR", p.pool], ["CLEAROTRON_QUEUE_DIR", p.queue], ["CLEAROTRON_OUTBOX_DIR", p.outbox], ["CLEAROTRON_RUN_LOCK_DIR", p.locks],
    ["CLEAROTRON_ACCESS_FILE", p.grants], ["CLEAROTRON_RECIPES_DIR", p.recipes], ["RECIPE_REPO_ROOT", p.configStore], ["CLEAROTRON_CUSTOMERS_DIR", p.profiles],
    ["PROFILE_REPO_ROOT", p.configStore], ["TRADEMARK_MCP_AUDIT_LOG", p.accessLog]]) {
    assert.equal(env[name], want, `${name} is not the demo's`);
  }
  assert.equal(env.CLEAROTRON_INSTRUCTIONS_DIR, "", "a real install's instructions would be read");
});

/** Start the server as a connect line starts it, in a home holding a real install's settings. */
function serve(home, extra) {
  const child = spawn(process.execPath, [SERVE], { env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (d) => { out += d; });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", (d) => { err += d; });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const reply = async (id) => {
    for (let i = 0; i < 600; i += 1) {
      for (const l of out.split("\n")) { try { const m = JSON.parse(l); if (m.id === id) return m; } catch { /* not yet a line */ } }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no reply ${id}; stderr: ${err.slice(0, 400)}`);
  };
  return { child, send, reply, err: () => err, out: () => out,
    closed: new Promise((res) => child.on("close", (code) => res(code))) };
}

async function toolsOf(s) {
  s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
  await s.reply(1);
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  s.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  return (await s.reply(2)).result.tools.map((t) => t.name);
}

test("a demo's server lists none of those tools, and refuses one called by name; the control keeps them", { timeout: 120000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "demo-connection-"));
  const workspace = join(home, "a-demo", "workspace");
  mkdirSync(workspace, { recursive: true });
  const demo = serve(home, { CLEAROTRON_DEMO: "1", CLEAROTRON_WORK_DIR: workspace });
  const real = serve(home, { CLEAROTRON_WORK_DIR: workspace, CLEAROTRON_NO_ENV_FILE: "1" });
  try {
    const listed = await toolsOf(demo);
    assert.ok(listed.includes("list_runs"), `the demo's server offers no reading tool: ${listed}`);
    for (const name of DEMO_WITHHELD_TOOLS) assert.ok(!listed.includes(name), `the demo's server offers ${name}`);
    demo.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "what_if_run", arguments: { confirmationToken: "x" } } });
    const called = await demo.reply(3);
    assert.equal(called.result?.isError, true, JSON.stringify(called));
    assert.match(JSON.stringify(called.result), /unknown tool/, "a tool the listing hides ran when called by name");
    assert.ok((await toolsOf(real)).includes("what_if_run"), "the control: the same server, not a demo, offers it");
  } finally { demo.child.kill(); real.child.kill(); rmSync(home, { recursive: true, force: true }); }
});

test("a demo that is gone refuses in one line, and serves nothing else in its place", { timeout: 60000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "demo-connection-"));
  try {
    const s = serve(home, { CLEAROTRON_DEMO: "1", CLEAROTRON_WORK_DIR: join(home, "removed", "workspace") });
    const code = await s.closed;
    assert.equal(code, 1, `the server stayed up for a demo that is gone:\n${s.err()}`);
    assert.match(s.err(), /the demo this connection belongs to is gone/, s.err());
    assert.equal(s.out(), "", "the server answered on its protocol stream");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("each surface that prints a demo's line says it is a demo's", () => {
  const read = (f) => readFileSync(join(ROOT, f), "utf8");
  assert.match(read("bin/start.mjs"), /stdioConnectOffer\(\{[^\n]*demo: DEMO/, "start's banner does not");
  const portal = read("driver/portal-service.mjs");
  assert.match(portal, /stdioConnectOffer\(\{[^\n]*demo: isDemo\(process\.env\)/, "the portal's route does not");
  assert.match(portal, /stdioConnectFor\(shape, \{[^\n]*demo: isDemo\(process\.env\)/, "the portal's rows do not");
  assert.match(portal, /nameClaude: claudeNamer\(\),\s*demo: isDemo\(process\.env\)/, "the portal's offers do not");
});
