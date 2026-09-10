// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO IS ITS OWN INSTALL, IN WHICHEVER ORDER A READER TAKES THE TWO.
//
// 0.3.0-beta.1's demo read the reader's real settings. `bin/start.mjs --demo` is a CLI entry, so it
// applied `~/.config/clearotron/.env` before it had parsed `--demo`, and every data path an environment
// names won over `--base`. On a machine with a real install the demo served that install's roster (no
// demo company in the switcher, no Generic), seeded its example reports into the real archive, and would
// have written a company created in the demo into the real store. With no organisation filed it offered
// no Generic even on a clean machine, and a company created there had nowhere to belong.
//
// WHAT THESE ARMS PIN:
//
//   1. the gate: `bin/start.mjs --demo` reads no `.env`, driven through the real entry against a planted
//      file, with the ordinary start as the control that the plant is live;
//   2. the grants a demo writes: its own organisation, holding its own company;
//   3. the store a demo seeds: its company and that company's projects, copied only when absent;
//   4. THE DEMO, BOOTED through `clearotron demo`, beside a real install whose settings name every path
//      and whose shell exports two of them: its switcher lists the demo company and Generic, a company
//      created there lands in the demo, and the real install is byte-identical afterwards;
//   5. the other order: the demo first, then a real `start` in the same home, and the real install
//      carries nothing of the demo.
//
// The switcher is asked through the shell's own `switcherKeys`, fed what the booted portal serves, so the
// arm is about the list a person sees rather than a copy of the rule that builds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer, connect } from "node:net";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDemoEntry, loadEnvLocal } from "../../shared/env-local.mjs";
import { installerGrants, installPaths, DEMO_ORGANISATION, demoAccounts, seedDemoStore } from "../../bin/start.mjs";
import { resolvePerson } from "../../shared/scope.mjs";
import { establishCredential } from "../portal-local-auth.mjs";
import { switcherKeys } from "../../portal-ui/src/shell/companyRows.ts";
import { genericFor } from "../../portal-ui/src/contract/genericKey.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLED = join(REPO, "driver", "profiles");
const DEMO_KEY = "demo-brand-owner";

/** Output with any line about a passphrase taken out, so no assertion message can carry one. */
const safe = (s) => String(s).split("\n").map((l) => (/passphrase/i.test(l) ? "[a passphrase line, redacted]" : l)).join("\n");

/** Every file under `root`, relative path → digest. Names and digests only: nothing a file holds is printed. */
function tree(root) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[relative(root, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** The names two trees disagree on, so a failure says WHICH file moved without saying what it holds. */
function moved(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}

/** A run of `n` consecutive free loopback ports. `--port` moves every door a demo opens: n, n+1, n+2. */
async function freePorts(n) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const base = 20000 + Math.floor(Math.random() * 30000);
    const free = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((res) => {
      const s = createServer();
      s.once("error", () => res(false));
      s.listen(base + i, "127.0.0.1", () => s.close(() => res(true)));
    })));
    if (free.every(Boolean)) return base;
  }
  throw new Error("no run of free ports was found — a could-not-look, not a verdict");
}

const listening = (port) => new Promise((res) => {
  const s = connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); res(true); });
  s.once("error", () => res(false));
});

function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stdout.on("data", (c) => { said += c; });
  child.stderr.on("data", (c) => { said += c; });
  const exited = new Promise((r) => child.on("exit", (code, signal) => r({ code, signal })));
  return { child, said: () => said, exited };
}

/** Up when the portal answers anything below 500 on `me`; false if the supervisor exits or time runs out. */
async function portalUp(port, run, ms = 150000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (run.child.exitCode !== null || run.child.signalCode !== null) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/portal/api/me`, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Stop a supervisor by the pid this test recorded, and wait until every door it opened refuses.
 * The supervisor forwards the signal to its children; the doors going quiet is the evidence they went.
 */
async function stop(run, ports) {
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGTERM");
  const ended = await Promise.race([run.exited, new Promise((r) => setTimeout(() => r(null), 30000))]);
  if (ended === null) { run.child.kill("SIGKILL"); await run.exited; }
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const open = (await Promise.all(ports.map(listening))).some(Boolean);
    if (!open) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`a door on ${ports.join("/")} was still open 20s after its supervisor stopped`);
}

async function signIn(port, passphrase) {
  const login = await fetch(`http://127.0.0.1:${port}/portal/login`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ passphrase }).toString(),
  });
  return (login.headers.get("set-cookie") ?? "").split(";")[0];
}

const PASS = "the demo arm signs in with this";
function demoCredential(home) {
  const path = installPaths(join(home, "trademark-demo")).credential;
  mkdirSync(dirname(path), { recursive: true });
  establishCredential({ path, email: "demo@localhost", passphrase: PASS });
}

// ── 1. THE GATE ─────────────────────────────────────────────────────────────────────────────────────

test("isDemoEntry is `bin/start.mjs --demo` and nothing else", () => {
  const start = join(REPO, "bin", "start.mjs");
  assert.equal(isDemoEntry(["node", start, "--demo"]), true);
  assert.equal(isDemoEntry(["node", start, "--demo", "--port", "18860"]), true);
  for (const argv of [["node", start], ["node", join(REPO, "bin", "example.mjs"), "--demo"],
    ["node", join(REPO, "driver", "runner.mjs"), "--demo"], ["node", "--demo"], [], undefined])
    assert.equal(isDemoEntry(argv), false, `read as the demo's supervisor: ${JSON.stringify(argv)}`);
});

test("a demo's load applies nothing from a planted `.env`, and the ordinary load is the control", () => {
  const home = mkdtempSync(join(tmpdir(), "demo-envlocal-"));
  try {
    const file = join(home, ".config", "clearotron", ".env");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "CLEAROTRON_REPORTS_DIR=/a/real/install/pool\nCLEAROTRON_CUSTOMERS_DIR=/a/real/install/store\n");
    const said = [];
    const demoEnv = {};
    const demo = loadEnvLocal({ env: demoEnv, home, note: (l) => said.push(l), demo: true });
    assert.equal(demo.reason, "demo");
    assert.deepEqual(demo.applied, []);
    assert.deepEqual(demoEnv, {}, "a demo took a real install's settings");
    assert.match(said.join(""), /not reading .*`clearotron demo` runs on its own data and settings/);
    // THE CONTROL: the same file, read by anything that is not the demo, applies. Without it a plant
    // that never reached the loader would read as a pass.
    const liveEnv = {};
    const live = loadEnvLocal({ env: liveEnv, home, note: () => {} });
    assert.equal(live.reason, "read");
    assert.equal(liveEnv.CLEAROTRON_REPORTS_DIR, "/a/real/install/pool");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("through the real entry: `start --demo` leaves the planted `.env` alone, `start` reads it", () => {
  const home = mkdtempSync(join(tmpdir(), "demo-entry-"));
  try {
    const file = join(home, ".config", "clearotron", ".env");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "CLEAROTRON_REPORTS_DIR=/a/real/install/pool\n");
    const run = (args) => spawnSync(process.execPath, [join(REPO, "bin", "start.mjs"), ...args, "--license"],
      { encoding: "utf8", timeout: 60000, env: { PATH: process.env.PATH, HOME: home } });
    const demo = run(["--demo"]);
    assert.equal(demo.status, 0, `start --demo --license did not exit cleanly: ${demo.stderr}`);
    assert.match(demo.stderr, /\[env-local\] not reading/, "the demo did not say it left the file alone");
    assert.doesNotMatch(demo.stderr, /\[env-local\] applied/, "the demo applied a real install's settings");
    const live = run([]);
    assert.match(live.stderr, /\[env-local\] applied 1 variable/, "the control did not read the planted file, so the arm above proves nothing");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── 2. THE GRANTS A DEMO WRITES ─────────────────────────────────────────────────────────────────────

test("a demo's grants file holds its own organisation, with its company filed there", () => {
  const accounts = demoAccounts();
  assert.deepEqual(accounts, [DEMO_KEY], "the demo's accounts are read from the bundle's demo-data profiles");
  const { grants, changed } = installerGrants(null, { user: "demo@localhost", organisation: DEMO_ORGANISATION, companies: accounts });
  assert.deepEqual(changed, ["person", "organisation"]);
  assert.deepEqual(grants.tenants["demo-org"], { name: DEMO_ORGANISATION, accounts: [DEMO_KEY], users: {} });
  const me = resolvePerson("demo@localhost", grants);
  assert.deepEqual(me.genericOrgs, ["demo-org"], "no Generic for the demo's organisation, so the switcher offers none");
  assert.equal(me.accountOrgs[DEMO_KEY], "demo-org", "the demo company is unplaced");

  // THE 0.3.0-beta.1 DEMO'S FILE: its person, no organisation. The next start repairs it.
  const old = { tenants: {}, people: { "demo@localhost": { run: true, manage: true, everything: true } } };
  const repaired = installerGrants(old, { user: "demo@localhost", organisation: DEMO_ORGANISATION, companies: accounts });
  assert.deepEqual(repaired.changed, ["organisation"]);
  assert.deepEqual(repaired.grants.tenants["demo-org"].accounts, [DEMO_KEY]);

  // NEVER AFTERWARDS: a file that already holds an organisation is somebody's, and nothing is filed in it.
  const held = installerGrants(repaired.grants, { user: "demo@localhost", organisation: DEMO_ORGANISATION, companies: ["another"] });
  assert.deepEqual(held.changed, []);
  assert.deepEqual(held.grants, repaired.grants);
});

test("demoAccounts reads demo data, and neither a fixture nor an ordinary profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "demo-accounts-"));
  try {
    writeFileSync(join(dir, "shown.json"), JSON.stringify({ name: "Shown", demoData: true }));
    writeFileSync(join(dir, "fixture.json"), JSON.stringify({ name: "Fixture", demoData: true, testFixture: true }));
    writeFileSync(join(dir, "ordinary.json"), JSON.stringify({ name: "Ordinary" }));
    writeFileSync(join(dir, "broken.json"), "{ not json");
    assert.deepEqual(demoAccounts(dir), ["shown"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 3. THE STORE A DEMO SEEDS ───────────────────────────────────────────────────────────────────────

test("the demo's store gets its company and that company's projects, once, and a visitor's edit stays", () => {
  const to = join(mkdtempSync(join(tmpdir(), "demo-store-")), "profiles");
  try {
    assert.deepEqual(seedDemoStore({ from: BUNDLED, to, accounts: [DEMO_KEY] }), [DEMO_KEY]);
    assert.ok(existsSync(join(to, `${DEMO_KEY}.json`)), "the company's profile was not copied");
    const projects = readdirSync(join(BUNDLED, "projects", DEMO_KEY));
    assert.ok(projects.length >= 1, "anti-vacuity: the bundled demo company carries a project");
    for (const f of projects) assert.ok(existsSync(join(to, "projects", DEMO_KEY, f)), `project ${f} was not copied`);

    const edited = JSON.stringify({ ...JSON.parse(readFileSync(join(to, `${DEMO_KEY}.json`), "utf8")), name: "Edited By A Visitor" });
    writeFileSync(join(to, `${DEMO_KEY}.json`), edited);
    assert.deepEqual(seedDemoStore({ from: BUNDLED, to, accounts: [DEMO_KEY] }), [], "a second start copied again");
    assert.equal(readFileSync(join(to, `${DEMO_KEY}.json`), "utf8"), edited, "a second start overwrote a visitor's edit");
  } finally { rmSync(dirname(to), { recursive: true, force: true }); }
});

// ── 4. THE DEMO, BOOTED BESIDE A REAL INSTALL ───────────────────────────────────────────────────────

/** A real install as its settings describe it: data plane, store (a repository), grants, credential. */
function plantRealInstall(home) {
  const real = join(home, "trademark");
  const store = join(real, "config", "profiles");
  for (const d of [join(real, "pool", "a-real-run"), join(real, "workspace"), join(real, "queue"), join(real, "config", "recipes"), store])
    mkdirSync(d, { recursive: true });
  writeFileSync(join(real, "pool", "a-real-run", "meta.json"), JSON.stringify({ runId: "a-real-run" }));
  const generic = JSON.parse(readFileSync(join(BUNDLED, "generic.json"), "utf8"));
  writeFileSync(join(store, "real-client.json"), JSON.stringify({ ...generic, name: "Real Client" }, null, 2));
  const git = ["-c", "user.email=real@localhost", "-c", "user.name=real"];
  execFileSync("git", ["-C", join(real, "config"), "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", join(real, "config"), ...git, "add", "-A"]);
  execFileSync("git", ["-C", join(real, "config"), ...git, "commit", "-qm", "the real store"]);
  writeFileSync(join(real, "grants.json"), JSON.stringify({
    tenants: { "real-firm": { name: "Real Firm", accounts: ["real-client"], users: {} } },
    people: { "real@localhost": { run: true, manage: true, everything: true } } }, null, 2));
  establishCredential({ path: join(home, ".cordillera", "portal-local-credential.json"), email: "real@localhost", passphrase: "the real install's own" });
  const env = join(home, ".config", "clearotron", ".env");
  mkdirSync(dirname(env), { recursive: true });
  writeFileSync(env, [
    `CLEAROTRON_REPORTS_DIR=${join(real, "pool")}`, `CLEAROTRON_WORK_DIR=${join(real, "workspace")}`,
    `CLEAROTRON_QUEUE_DIR=${join(real, "queue")}`, `CLEAROTRON_ACCESS_FILE=${join(real, "grants.json")}`,
    `CLEAROTRON_CUSTOMERS_DIR=${store}`, `PROFILE_REPO_ROOT=${join(real, "config")}`,
    `CLEAROTRON_RECIPES_DIR=${join(real, "config", "recipes")}`, `RECIPE_REPO_ROOT=${join(real, "config")}`,
    'CLEAROTRON_ORGANISATION_NAME="Real Firm"', "PORTAL_LOCAL_USER=real@localhost", "",
  ].join("\n"));
  return { real, store };
}

const installState = (home) => ({
  install: tree(join(home, "trademark")), credential: tree(join(home, ".cordillera")), settings: tree(join(home, ".config", "clearotron")),
});

test("the demo, booted beside a real install, lists Demo Brand Owner and Generic, and leaves the install as it found it",
  { timeout: 360000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), "demo-beside-"));
    let run = null;
    let ports = [];
    try {
      const { real, store } = plantRealInstall(home);
      demoCredential(home);
      const before = installState(home);
      assert.ok(Object.keys(before.install).length >= 5, "anti-vacuity: the planted install holds files to compare");

      const base = await freePorts(3);
      ports = [base, base + 1, base + 2];
      // THE SHELL EXPORTS TWO OF THE SAME PATHS, so the environment half is driven as well as the file.
      run = launch([join(REPO, "bin", "clearotron.mjs"), "demo", "--no-open", "--port", String(base)],
        { PATH: process.env.PATH, HOME: home, CLEAROTRON_REPORTS_DIR: join(real, "pool"), CLEAROTRON_CUSTOMERS_DIR: store });
      assert.ok(await portalUp(base, run), `the demo's portal never answered:\n${safe(run.said()).slice(-3000)}`);

      const cookie = await signIn(base, PASS);
      assert.ok(cookie, `signing in to the demo with its own credential returned no session:\n${safe(run.said()).slice(-1500)}`);
      const get = async (p) => {
        const r = await fetch(`http://127.0.0.1:${base}${p}`, { headers: { cookie } });
        assert.equal(r.status, 200, `${p} answered ${r.status}`);
        return r.json();
      };
      const me = await get("/portal/api/me");
      const roster = (await get("/portal/admin/roster")).customers;

      // WHAT THE SWITCHER LISTS, asked of the shell's own rule with what this portal served.
      const listed = switcherKeys({ allAccounts: me.accounts === "*", accounts: Array.isArray(me.accounts) ? me.accounts : [],
        genericOrgs: me.genericOrgs ?? [] }, roster);
      assert.deepEqual(listed, [DEMO_KEY, genericFor("demo-org")],
        `the demo's switcher does not list Demo Brand Owner and Generic: ${JSON.stringify(listed)}`);
      assert.equal(roster.find((c) => c.key === DEMO_KEY)?.name, "Demo Brand Owner");
      assert.deepEqual(me.organisations, [{ key: "demo-org", name: DEMO_ORGANISATION }], "the top bar has no organisation to name");
      assert.ok(!roster.some((c) => c.key === "real-client"), "the demo is serving the real install's store");
      assert.match(run.said(), /it carries Demo Brand Owner, rating under its own framework, with 1 project/,
        "the boot line does not describe the roster the demo served");
      assert.match(run.said(), /\[env-local\] not reading/);
      assert.doesNotMatch(run.said(), /\[env-local\] applied/, "the demo applied the real install's settings");

      // A COMPANY CREATED IN THE DEMO BELONGS TO THE DEMO.
      const made = await fetch(`http://127.0.0.1:${base}/portal/api/config/companies`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Visitor Company" }),
      });
      assert.equal(made.status, 201, `creating a company in the demo was refused: ${(await made.clone().text()).slice(0, 300)}`);
      const key = (await made.json()).key;
      const demoPaths = installPaths(join(home, "trademark-demo"));
      assert.ok(existsSync(join(demoPaths.profiles, `${key}.json`)), "the new company is not in the demo's store");
      assert.ok(!existsSync(join(store, `${key}.json`)), "the new company was written into the REAL store");
      assert.ok(JSON.parse(readFileSync(demoPaths.grants, "utf8")).tenants["demo-org"].accounts.includes(key),
        "the new company was not filed under the demo's organisation");

      await stop(run, ports);
      run = null;
      const after = installState(home);
      for (const part of ["install", "credential", "settings"])
        assert.deepEqual(moved(before[part], after[part]), [], `the demo changed the real install's ${part}`);
      assert.ok(readdirSync(demoPaths.pool).some((d) => existsSync(join(demoPaths.pool, d, "meta.json"))),
        "anti-vacuity: the demo seeded its example reports, into its own archive");
    } finally {
      if (run) await stop(run, ports).catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  });

// ── 5. THE OTHER ORDER ──────────────────────────────────────────────────────────────────────────────

test("a demo first, then a real start in the same home: the real install carries nothing of the demo",
  { timeout: 360000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), "demo-first-"));
    let run = null;
    let ports = [];
    try {
      demoCredential(home);
      const base = await freePorts(3);
      ports = [base, base + 1, base + 2];
      run = launch([join(REPO, "bin", "clearotron.mjs"), "demo", "--no-open", "--port", String(base)], { PATH: process.env.PATH, HOME: home });
      assert.ok(await portalUp(base, run), `the demo's portal never answered:\n${safe(run.said()).slice(-3000)}`);
      await stop(run, ports);

      // THE REAL INSTALL, as a fresh one starts: its organisation named by setup, and nothing else.
      const env = join(home, ".config", "clearotron", ".env");
      mkdirSync(dirname(env), { recursive: true });
      writeFileSync(env, 'CLEAROTRON_ORGANISATION_NAME="Real Firm"\n');
      const live = await freePorts(3);
      ports = [live, live + 1, live + 2];
      run = launch([join(REPO, "bin", "start.mjs"), "--no-open", "--no-worker"], {
        PATH: process.env.PATH, HOME: home,
        PORTAL_SERVICE_PORT: String(live), TRADEMARK_MCP_HTTP_PORT: String(live + 1), CLIENT_MCP_HTTP_PORT: String(live + 2),
      });
      assert.ok(await portalUp(live, run), `the real install's portal never answered:\n${safe(run.said()).slice(-3000)}`);
      await stop(run, ports);
      run = null;

      const real = installPaths(join(home, "trademark"));
      const runs = readdirSync(real.pool).filter((d) => existsSync(join(real.pool, d, "meta.json")));
      assert.deepEqual(runs, [], "the real install's archive holds a report it did not produce");
      const grants = JSON.parse(readFileSync(real.grants, "utf8"));
      assert.ok(!("demo@localhost" in (grants.people ?? {})), "the demo's person is on the real install");
      assert.deepEqual(Object.values(grants.tenants).map((t) => t.name), ["Real Firm"], "the demo's organisation is on the real install");
      assert.ok(!existsSync(join(real.profiles, `${DEMO_KEY}.json`)), "the demo's company is in the real store");
      const settings = readFileSync(env, "utf8");
      assert.doesNotMatch(settings, /trademark-demo/, "the real install's settings name the demo's directory");
      let who = null;
      try { who = userInfo().username; } catch { /* a container with no passwd entry */ }
      assert.match(settings, new RegExp(`^PORTAL_LOCAL_USER=${(who || "user").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@localhost$`, "m"),
        "the real install signs in as someone other than its own local account");
      const cred = JSON.parse(readFileSync(join(home, ".cordillera", "portal-local-credential.json"), "utf8"));
      assert.notEqual(cred.email, "demo@localhost", "the real install's sign-in credential is the demo's");
    } finally {
      if (run) await stop(run, ports).catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  });
