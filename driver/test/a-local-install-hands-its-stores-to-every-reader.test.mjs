// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LOCAL INSTALL'S STORES REACH EVERY READER, not only the services `clearotron start` launches.
//
// `start` handed its children the saved-search store at launch and wrote it nowhere else. The connector an
// assistant launches and `clearotron doctor` are not its children: they read the env file, which never
// named the store. So on a local install the portal listed a company's saved searches, the assistant was
// told there were none, and doctor said saved searches were off.
//
// This runs a real first start in a throwaway home, stops it, then drives the stdio connector and doctor
// from clean shells against what it left behind, and compares their answers with the portal's.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handRunEnv, assertReadItsEnvFile } from "./drive-env.mjs";   // the connector and doctor must read the file start wrote
import { startPaths, storesForOtherReaders } from "../../bin/start.mjs";
import { makeRecipeService } from "../recipe-service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `n` distinct ports free right now: each bound on port 0 and read back, all held until every one is chosen. */
async function freePorts(n) {
  const { createServer } = await import("node:net");
  const servers = [];
  for (let i = 0; i < n; i++) {
    const server = createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    servers.push(server);
  }
  const ports = servers.map((server) => String(server.address().port));
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

/** A real foreground first start in `home`, stopped once it has printed its sign-in summary. */
async function firstStart(home) {
  const [portal, mcp, client] = await freePorts(3);
  // NOTHING INHERITED, and the opt-out named: `start` must not be configured by a file on this box, and it
  // writes the file under `home` whether or not it reads one.
  const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--no-worker"], {
    env: { PATH: process.env.PATH, HOME: home, CLEAROTRON_NO_ENV_FILE: "1", PORTAL_LOCAL_USER: "op@localhost",
      PORTAL_SERVICE_PORT: portal, TRADEMARK_MCP_HTTP_PORT: mcp, CLIENT_MCP_HTTP_PORT: client },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let said = "";
  child.stdout.on("data", (c) => { said += c; });
  child.stderr.on("data", (c) => { said += c; });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  try {
    const deadline = Date.now() + 90000;
    while (!/Sign in as/.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  } finally {
    child.kill("SIGINT");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  return said;
}

const readEnv = (path) => Object.fromEntries(readFileSync(path, "utf8").split("\n")
  .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));

/** `describe_options` for each key, asked of the stdio connector an assistant launches, in a clean shell. */
async function connectorSavedSearches(home, keys) {
  const child = spawn(process.execPath, [join(REPO, "mcp-server", "server.mjs")], {
    env: handRunEnv({ HOME: home, PATH: process.env.PATH }, {}), stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "", buf = "";
  const replies = new Map();
  child.stderr.on("data", (c) => { stderr += c; });
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, 30000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (typeof m.id === "number" && m.id >= 2) replies.set(m.id, m);
        if (replies.size === keys.length) { clearTimeout(timer); resolve(); }
      }
    });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "arm", version: "0" } } }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  keys.forEach((profileKey, i) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i + 2, method: "tools/call",
    params: { name: "describe_options", arguments: { profileKey } } }) + "\n"));
  await done;
  child.kill("SIGKILL");
  const answers = {};
  keys.forEach((k, i) => {
    const reply = replies.get(i + 2);
    const text = reply?.result?.content?.[0]?.text;
    assert.ok(text && !reply.result.isError, `the connector gave no describe_options answer for ${k}:\n${JSON.stringify(reply)}\n${stderr.slice(0, 900)}`);
    answers[k] = JSON.parse(text);
  });
  return { answers, stderr };
}

test("after a real first start, the connector and doctor read the saved searches the portal lists", { timeout: 240000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "local-stores-"));
  const envFile = join(home, ".config", "clearotron", ".env");
  const nodeDir = mkdtempSync(join(tmpdir(), "local-stores-node-"));
  symlinkSync(process.execPath, join(nodeDir, "node"));
  try {
    const said = await firstStart(home);
    assert.match(said, /Sign in as/, `start never reached its sign-in summary, so nothing below would be measured:\n${said.slice(-1500)}`);

    // ── 1. START RECORDED WHAT IT HANDED ITS CHILDREN ────────────────────────────────────────────────
    const handed = storesForOtherReaders(startPaths({ env: {}, base: join(home, "trademark") }));
    const recorded = readEnv(envFile);
    for (const [name, value] of Object.entries(handed))
      assert.equal(recorded[name], value, `the env file does not record the ${name} start handed its children`);

    // What `npx clearotron install` adds to that file on the same install: the roster, and the data
    // directories, so neither reader below falls back to a place outside this home.
    const layout = startPaths({ env: {}, base: join(home, "trademark") });
    const profiles = join(layout.configStore, "profiles");
    mkdirSync(profiles, { recursive: true });
    const generic = JSON.parse(readFileSync(join(REPO, "driver", "profiles", "generic.json"), "utf8"));
    writeFileSync(join(profiles, "acme.json"), JSON.stringify({ ...generic, name: "Acme" }));
    appendFileSync(envFile, [`CLEAROTRON_CUSTOMERS_DIR=${profiles}`, `CLEAROTRON_REPORTS_DIR=${layout.pool}`,
      `CLEAROTRON_WORK_DIR=${layout.workspace}`, `CLEAROTRON_QUEUE_DIR=${layout.queue}`].join("\n") + "\n");

    // A saved search for a company and one for Generic, which owns saved searches like any company.
    const recipe = readFileSync(join(REPO, "driver", "recipes", "aurora", "quarterly-screen.json"), "utf8");
    for (const [key, slug] of [["acme", "acme-screen"], ["generic", "house-screen"]]) {
      mkdirSync(join(handed.CLEAROTRON_RECIPES_DIR, key), { recursive: true });
      writeFileSync(join(handed.CLEAROTRON_RECIPES_DIR, key, `${slug}.json`), recipe);
    }

    // ── 2. THE PORTAL'S LIST, by its own route over the store start handed it ───────────────────────
    const portal = makeRecipeService({ recipesDir: handed.CLEAROTRON_RECIPES_DIR, profileDir: profiles,
      loadProfiles: () => new Map([["generic", generic], ["acme", { ...generic, name: "Acme" }]]) });
    const portalSlugs = {};
    for (const key of ["acme", "generic"]) {
      const r = await portal.route("GET", `/recipes/${key}`, { email: "op@localhost" });
      assert.equal(r.status, 200, `the portal's route refused ${key}`);
      portalSlugs[key] = r.json.recipes.map((x) => x.slug);
      assert.equal(portalSlugs[key].length, 1, `the portal should list the one saved search planted for ${key}`);
    }

    // ── 3. THE CONNECTOR AN ASSISTANT LAUNCHES LISTS THE SAME ────────────────────────────────────────
    const { answers, stderr } = await connectorSavedSearches(home, ["acme", "generic"]);
    assertReadItsEnvFile(stderr, envFile);
    for (const key of ["acme", "generic"]) {
      assert.deepEqual((answers[key].account?.savedSearches ?? []).map((s) => s.slug), portalSlugs[key],
        `THE REPORTED CASE: the portal lists ${key}'s saved searches and the connector does not`);
    }

    // ── 4. DOCTOR SAYS THEY ARE ON, FROM THAT STORE, AND GIVES ONE ANSWER FOR THE ROSTER ─────────────
    let out;
    try {
      out = execFileSync(process.execPath, [join(REPO, "bin", "onboard.mjs"), "--check"], { encoding: "utf8", stdio: "pipe", timeout: 120000,
        env: handRunEnv({ HOME: home, PATH: [nodeDir, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}) });
    } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    assert.match(out, new RegExp(`saved searches are read from ${esc(handed.CLEAROTRON_RECIPES_DIR)}, and saves are committed in ${esc(handed.RECIPE_REPO_ROOT)}`),
      `doctor did not report the store start recorded:\n${out}`);
    assert.doesNotMatch(out, /saved searches are off/i, "THE REPORTED CASE: doctor said working saved searches were off");
    assert.match(out, new RegExp(`the services resolve profiles from ${esc(profiles)}`));
    assert.doesNotMatch(out.split("this command's own process")[0], /THE BUNDLED DEMO ROSTER/,
      "doctor gave two answers for where profiles come from");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(nodeDir, { recursive: true, force: true });
  }
});
