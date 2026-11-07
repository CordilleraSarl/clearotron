// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real `doctor` command five times; the portal, the runner's refusal and `start`'s line are driven in-process
//
// THE REFUSAL NAMES THE CONFIGURATION THE REFUSING PROCESS USES, AND HOW TO RELOAD IT.
//
// An install that cannot search refuses an order, and three places tell the person who runs it what to do:
//   - the portal, to the person who runs the install;
//   - the run's refusal in the operator's log;
//   - `clearotron start`'s own line.
// Each told them to run setup, which writes one file, and none said how the process that refused would see it.
// Background units read their own file, and a background start adds a line it lacks but never replaces one, an
// empty one included. A foreground `clearotron start` reads its settings once, when it starts. A service the product
// did not set up reads what its manager gives it. The owner's words now give each the whole remedy, and everyone
// else keeps the requester's sentence.
//
// Every input is planted: the unit files where user units live, the services' and the install's settings files,
// the process's environment, its command line and its cgroup. A test therefore reads nothing of this machine, and
// CI's own systemd ancestry cannot reach it. Nothing here starts a service or runs an engine. Invented names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { makePortalService } from "../portal-service.mjs";
import { runTables } from "../order-tables.mjs";
import { REGISTER_ENV, orderTimeRefusal } from "../run-requirements.mjs";
import { SERVER_INSTALL_SET } from "../../shared/server-units.mjs";
import { SERVER_UNITS, orderingLines } from "../../bin/start.mjs";
import { handRunEnv } from "./drive-env.mjs";
import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
// Namespaces, so a tree without this change fails each test on the words it shows rather than on a missing name.
// Without the portal's own path, it asked the runner's question alone, which is what the fallback asks.
const portal = await import("../portal-service.mjs");
const refusalOf = portal.portalOrderRefusal ?? (({ env, tables }) => orderTimeRefusal(env, tables));
const howItRunsModule = await import("../how-it-runs.mjs").catch(() => ({}));

const GRANTS = { tenants: { celta: { accounts: ["generic", "zephyr"], users: { "cli@celta.example": ["zephyr"] } } },
  people: { "staff@example-firm.com": { run: true, manage: true, everything: true }, "cli@celta.example": { run: true } } };
const OPERATOR = { email: "staff@example-firm.com" };   // sees everything: the person who runs the install
const CLIENT = { email: "cli@celta.example" };            // runs searches for one company, and sees nothing else
const ORDER = { account: "generic", markName: "QUILLBRAE", classes: [9], product: "global-preliminary-search", geography: { mode: "worldwide" } };
const REQUESTER = "This installation is not configured to run searches yet. Nothing has been searched and nothing has been "
  + "charged. Please contact whoever administers it.";
const MISSING = "no AI is chosen and no register is chosen";   // an install that has chosen neither, in the owner's phrases
const HEAD = `This install cannot run a search yet: ${MISSING}.`;
const CHARGED = "Nothing has been searched and nothing has been charged.";
const DOCTOR = "`clearotron doctor` names each setting.";

/** What `clearotron start --background` writes for each unit: the shipped template, which has no placeholder. */
const TEMPLATE = (u) => readFileSync(join(REPO, "driver", "systemd", u), "utf8");
const LAUNCHER_UNITS = () => Object.fromEntries(SERVER_INSTALL_SET.map((u) => [u, TEMPLATE(u)]));
const A_USER_UNIT = (unit = "clearotron-portal.service") => `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${unit}\n`;
const UNDER_SYSTEMD = { INVOCATION_ID: "0123456789abcdef0123456789abcdef" };
const STARTED_BY_START = ["node", "portal-service.mjs", "--start-env-file=/srv/op/.config/clearotron/.env"];
// The install's own folder, apart from the home, so the settings resolver finds no older file inside it.
const REPO_ROOT = mkdtempSync(join(tmpdir(), "refusal-remedy-install-"));

const installFileOf = (home) => join(home, ".config", "clearotron", ".env");
/** A throwaway machine: user units by name and text, the services' settings file, and the install's settings file. */
function machine({ units = {}, servicesFile = null, installFile = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "refusal-remedy-"));
  const dir = join(home, ".config", "systemd", "user");
  mkdirSync(dir, { recursive: true });
  for (const [u, text] of Object.entries(units)) writeFileSync(join(dir, u), text);
  if (servicesFile !== null) writeFileSync(join(home, ".env"), servicesFile);
  if (installFile !== null) {
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(installFileOf(home), installFile);
  }
  return home;
}

/** What the portal's review answers the order with, for `principal`, on the planted machine and process. */
async function reviewed(home, principal, { env = {}, argv = [], cgroup = "", readFile = null } = {}) {
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {},
    trigger: async (job) => ({ ok: true, id: job.id }),
    orderRefusal: async () => refusalOf({ env, tables: await runTables(), argv, home, repoRoot: REPO_ROOT,
      cgroup: () => cgroup, readFile: () => readFile, template: TEMPLATE }) });
  // A client orders for the one company it is granted; the person who runs the install, for any.
  const plan = await svc.route("POST", "/portal/api/run/plan", principal, principal === CLIENT ? { ...ORDER, account: "zephyr" } : ORDER);
  assert.equal(plan.status, 409, JSON.stringify(plan.json));
  assert.equal(plan.json.code, "not_configured");
  return plan.json;
}
const shown = async (home, process) => (await reviewed(home, OPERATOR, process)).errors[0];
const restart = (units) => `\`systemctl --user restart ${units.join(" ")}\``;
const servicesRead = (home) => `Its background services read their settings from ${join(home, ".env")}.`;
// UNITS THE LAUNCHER DID NOT WRITE ARE READ FOR THE FILE THEY NAME, `EnvironmentFile=%h/.env`, which expands as systemd
// expands it: the home, then `/.env`. That is the only form a machine with systemd meets. `join` puts a backslash
// there on Windows, which has no systemd and still runs this drive over planted units.
const unitsRead = (home) => `Its background services read their settings from ${home}/.env.`;

test("launcher units with no line yet for what is missing are sent to setup and a background start", async () => {
  for (const servicesFile of [null, "# kept by the operator\nPORTAL_LOCAL_USER=staff\n"]) {
    const home = machine({ units: LAUNCHER_UNITS(), servicesFile });
    try {
      assert.equal(await shown(home, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }), `${HEAD} ${servicesRead(home)} Run \`clearotron install\` `
        + "in a terminal to set it up, then `clearotron start --background`: it adds the missing lines to that file and restarts the "
        + `services. ${CHARGED}`, `file: ${servicesFile}`);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("an existing empty line, which a background start keeps, sends the reader to both places the setting lives", async () => {
  const both = (home, launcher) => `${HEAD} ${servicesRead(home)} \`clearotron start --background\` only adds a setting that file `
    + `has no line for; it never replaces one. Set each missing setting in that file and in ${launcher}, then restart the services: `
    + `${restart(SERVER_INSTALL_SET)}. ${DOCTOR} ${CHARGED}`;
  // The install has its own settings file: that is where the launcher adds from.
  const withFile = machine({ units: LAUNCHER_UNITS(), servicesFile: `${REGISTER_ENV}=\n`, installFile: "# the install's own\n" });
  // It has none: the launcher adds from the environment it runs in, and no file is named for it.
  const without = machine({ units: LAUNCHER_UNITS(), servicesFile: `${REGISTER_ENV}=\n` });
  try {
    assert.equal(await shown(withFile, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }), both(withFile, installFileOf(withFile)));
    assert.equal(await shown(without, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }),
      both(without, "the environment you run `clearotron start --background` in"));
  } finally { for (const h of [withFile, without]) rmSync(h, { recursive: true, force: true }); }
});

test("product units that are not the launcher's get their own file and restart, and never the setup route", async () => {
  const own = (home, units) => `${HEAD} ${unitsRead(home)} Set each missing setting in that file, then restart the services: `
    + `${restart(units)}. ${DOCTOR} ${CHARGED}`;
  // One unit edited by hand: a background start would overwrite it, so it is not offered.
  const edited = machine({ units: { ...LAUNCHER_UNITS(), "clearotron-portal.service": `${TEMPLATE("clearotron-portal.service")}# edited here\n` } });
  // A server unit the product does not manage sits beside them: a background start refuses on this machine.
  const FOREIGN = SERVER_UNITS.filter((u) => !SERVER_INSTALL_SET.includes(u));
  assert.ok(FOREIGN.length, "the detector names no unit the product does not manage, so this machine cannot be planted");
  const foreign = machine({ units: { ...LAUNCHER_UNITS(),
    ...Object.fromEntries(FOREIGN.map((u) => [u, "[Service]\nType=simple\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n"])) } });
  try {
    assert.equal(await shown(edited, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }), own(edited, SERVER_INSTALL_SET));
    assert.equal(await shown(foreign, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }), own(foreign, [...SERVER_INSTALL_SET, ...FOREIGN]));
  } finally { for (const h of [edited, foreign]) rmSync(h, { recursive: true, force: true }); }
});

test("a service this install cannot name is told to set the settings where its manager gives them, with no command", async () => {
  const generic = `${HEAD} Its services take their settings from the service manager that runs them. Set each missing setting there, `
    + `then restart the services. ${DOCTOR} ${CHARGED}`;
  const home = machine({ units: LAUNCHER_UNITS() });
  const nofile = machine({ units: { "clearotron-portal.service": "[Service]\nType=simple\nEnvironment=A=1\nExecStart=/bin/true\n" } });
  try {
    for (const [what, home_, process] of [
      ["a system unit", home, { env: UNDER_SYSTEMD, cgroup: "0::/system.slice/clearotron-portal.service\n" }],
      ["a user unit the product did not install", home, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT("someone-elses.service") }],
      ["a cgroup that cannot be read", home, { env: UNDER_SYSTEMD, cgroup: "" }],
      ["a product unit that names no settings file", nofile, { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }],
    ]) {
      const said = await shown(home_, process);
      assert.equal(said, generic, what);
      assert.doesNotMatch(said, /systemctl/, `${what}: a restart command for a manager or unit this install cannot name`);
    }
  } finally { for (const h of [home, nofile]) rmSync(h, { recursive: true, force: true }); }
});

test("a portal under a foreground start is told to run setup, then stop the start and run it again", async () => {
  const home = machine();
  try {
    assert.equal(await shown(home, { argv: STARTED_BY_START }), `${HEAD} Run \`clearotron install\` in a terminal to set it up, then `
      + `stop \`clearotron start\` with Ctrl-C and run it again: it reads the settings setup writes when it starts. ${CHARGED}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a portal started some other way is told its own settings file, or its environment, and to start it again", async () => {
  const home = machine();
  try {
    assert.equal(await shown(home, { readFile: "/srv/op/portal.env" }), `${HEAD} Set each missing setting in /srv/op/portal.env, `
      + `which the portal reads when it starts, then start the portal again. ${DOCTOR} ${CHARGED}`);
    assert.equal(await shown(home, { readFile: null }), `${HEAD} Set each missing setting in the environment the portal runs in, `
      + `then start the portal again. ${DOCTOR} ${CHARGED}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("no form shows the browser a setting's name, and the requester keeps their sentence on every machine", async () => {
  const cases = [
    { home: machine({ units: LAUNCHER_UNITS() }), process: { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }, form: "it adds the missing lines" },
    { home: machine({ units: LAUNCHER_UNITS(), servicesFile: `${REGISTER_ENV}=\n` }), process: { env: UNDER_SYSTEMD, cgroup: A_USER_UNIT() }, form: "it never replaces one" },
    { home: machine({ units: LAUNCHER_UNITS() }), process: { env: UNDER_SYSTEMD, cgroup: "" }, form: "the service manager that runs them" },
    { home: machine(), process: { argv: STARTED_BY_START }, form: "then stop `clearotron start` with Ctrl-C" },
    { home: machine(), process: { readFile: null }, form: "the environment the portal runs in" },
  ];
  try {
    for (const { home, process, form } of cases) {
      // The planted folders are taken out first: a folder name is not a setting, whatever its letters.
      const body = JSON.stringify(await reviewed(home, OPERATOR, process)).split(home).join("<home>");
      assert.ok(body.includes(form), `this machine's form was not shown: ${body}`);
      assert.doesNotMatch(body, /CLEAROTRON_|PORTAL_/, `a setting's name reached the browser: ${body}`);
      assert.doesNotMatch(body, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached the browser: ${body}`);
      assert.deepEqual((await reviewed(home, CLIENT, process)).errors, [REQUESTER]);
    }
  } finally { for (const { home } of cases) rmSync(home, { recursive: true, force: true }); }
});

test("a process's own unit and its manager come from its cgroup, on either cgroup version", () => {
  assert.equal(typeof howItRunsModule.ownUnit, "function", "nothing reads which unit this process runs as");
  const { ownUnit } = howItRunsModule;
  assert.deepEqual(ownUnit(A_USER_UNIT()), { manager: "user", unit: "clearotron-portal.service" });
  assert.deepEqual(ownUnit("12:pids:/user.slice\n1:name=systemd:/user.slice/user-1000.slice/user@1000.service/clearotron-worker.service\n"),
    { manager: "user", unit: "clearotron-worker.service" }, "cgroup v1: systemd's own hierarchy");
  assert.deepEqual(ownUnit("0::/system.slice/clearotron-portal.service\n"), { manager: "system", unit: "clearotron-portal.service" });
  for (const none of ["", "0::/user.slice/user-1000.slice/session-3.scope\n", "0::/\n"]) assert.equal(ownUnit(none), null, JSON.stringify(none));
});

test("the run's refusal in the operator's log names the settings, then the same remedy for how the runner runs", async () => {
  const tables = await runTables();
  const remedy = (state) => orderTimeRefusal({}, tables, { howFor: () => state }).operator.split("Nothing has been searched and nothing has been spent. ")[1];
  const units = ["clearotron-mcp-face.service", "clearotron-worker.service"];
  assert.equal(remedy({ kind: "launcher", file: "/srv/op/.env", units, noLineYet: true }), "Its background services read their settings "
    + "from /srv/op/.env. Run `clearotron install` in a terminal to set it up, then `clearotron start --background`: it adds the missing "
    + "lines to that file and restarts the services.");
  assert.equal(remedy({ kind: "launcher", file: "/srv/op/.env", units, noLineYet: false, launcherFile: "/srv/op/.config/clearotron/.env" }),
    "Its background services read their settings from /srv/op/.env. `clearotron start --background` only adds a setting that file has no "
    + "line for; it never replaces one. Set each missing setting in that file and in /srv/op/.config/clearotron/.env, then restart the "
    + `services: ${restart(units)}.`);
  assert.equal(remedy({ kind: "units", file: "/srv/op/.env", units }), "Its background services read their settings from /srv/op/.env. "
    + `Set each missing setting in that file, then restart the services: ${restart(units)}.`);
  assert.equal(remedy({ kind: "service" }), "Its services take their settings from the service manager that runs them. Set each missing "
    + "setting there, then restart the services.");
  assert.equal(remedy({ kind: "start" }), "Run `clearotron install` in a terminal to set it up, then stop `clearotron start` with Ctrl-C "
    + "and run it again: it reads the settings setup writes when it starts.");
  assert.equal(remedy({ kind: "hand", file: "/srv/op/runner.env" }), "Set each missing setting in /srv/op/runner.env, which this runner "
    + "reads when it starts, then start this runner again.");
  assert.equal(remedy({ kind: "hand", file: null }), "Set each missing setting in the environment this runner runs in, then start this runner again.");
  // The log names every setting above its remedy, which is why it needs no pointer to doctor.
  const r = orderTimeRefusal({}, tables, { howFor: () => ({ kind: "service" }) });
  for (const n of r.names) assert.ok(r.operator.includes(`    ${n} — `), `${n} is not named in the log`);
  assert.doesNotMatch(r.operator, /clearotron doctor/);
  // The runner asks it of itself.
  assert.match(readFileSync(join(REPO, "driver", "runner.mjs"), "utf8"), /orderTimeRefusal\(process\.env, await runTables\(\), \{ howFor: \(missing\) => howItRuns\(\{ missing \}\) \}\)/,
    "the runner no longer asks how it runs");
});

test("start's line says to run it again after setup, and names the environment when it read no settings file", () => {
  const said = (file) => orderingLines({ missing: MISSING, install: "clearotron install", doctor: "clearotron doctor", file }).map((l) => l.trim()).join(" ");
  assert.equal(said("/srv/op/.config/clearotron/.env"), `Ordering a clearance from the portal is refused until this install can run a search: ${MISSING}. `
    + "Run `clearotron install` in a terminal to set it up, then stop this command with Ctrl-C and run it again: it reads the settings "
    + "setup writes when it starts.");
  assert.equal(said(null), `Ordering a clearance from the portal is refused until this install can run a search: ${MISSING}. This command `
    + "read no environment file of its own: set each missing setting in the environment it runs in, then stop it and run it again. "
    + "`clearotron doctor` names each setting.");
});

test("start hands the portal the file it read, as it hands the worker, and records it for doctor", () => {
  const src = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");
  assert.match(src, /const portal = start\("the portal", "driver\/portal-service\.mjs",[\s\S]{0,200}\{ args: envFileRead\(\) \? \[`--start-env-file=\$\{envFileRead\(\)\}`\] : \[\] \}\);/,
    "the portal is not told which settings file its start read");
  assert.match(src, /recordRunning\(\{[\s\S]{0,600}envFile: envFileRead\(\)/, "the running record does not say which settings file this start read");
  assert.match(src, /orderingLines\(\{ missing: whatIsMissing\(cannot\), install: invoke\("install"\), doctor: invoke\("doctor"\), file: envFileRead\(\) \}\)/,
    "start's line is not told whether this start read a settings file");
});

// ── DOCTOR'S OPENING SHARES THE PORTAL'S SENTENCE, AND SAYS TO RUN `start` AGAIN ONLY WHERE SETUP REACHES IT ────

const ROOT = doctorRepoRoot();
const NODE_DIR = (() => {
  const d = mkdtempSync(join(tmpdir(), "refusal-remedy-node-"));
  symlinkSync(process.execPath, join(d, process.platform === "win32" ? "node.exe" : "node"));
  return d;
})();

function doctor(home) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"], {
    cwd: ROOT, encoding: "utf8", timeout: 120_000,
    env: handRunEnv({ PATH: [NODE_DIR, "/usr/bin", "/bin"].join(delimiter), HOME: home, USERPROFILE: home,
      CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
  });
  if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message})`);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const lines = out.split("\n");
  const title = lines.indexOf("  Trademark clearance engine — configuration check");
  const install = out.match(/re-run `([^`]+)` to set it/)?.[1];
  assert.ok(title >= 0 && install, `doctor printed no title or no setup command:\n${out}`);
  return { lead: lines.slice(title + 1).find((l) => l.trim()), install, out };
}

/** A running start on record in `home`, as `clearotron start` leaves one: this test's own live process. */
function startOnRecord(home, fields) {
  const dir = join(home, ".config", "clearotron", "running");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, base: home,
    url: "http://127.0.0.1:9", host: "127.0.0.1", ports: { portal: 9, mcp: 10, client: 11 }, ...fields }));
}

test("doctor's opening says to run the start again only while one runs that read a settings file", () => {
  const home = mkdtempSync(join(tmpdir(), "refusal-remedy-doctor-"));
  try {
    const none = doctor(home);
    const today = `  This install cannot run a search yet: ${MISSING}. Run \`${none.install}\` in a terminal to set it up.`;
    assert.equal(none.lead, today, none.out);
    startOnRecord(home, { demo: false, envFile: join(home, ".config", "clearotron", ".env") });
    const running = doctor(home);
    assert.equal(running.lead, `  This install cannot run a search yet: ${MISSING}. Run \`${running.install}\` in a terminal to set it up, `
      + "then stop `clearotron start` with Ctrl-C and run it again: it reads the settings setup writes when it starts.", running.out);
    for (const [what, fields] of [["a demo's start", { demo: true, envFile: join(home, ".config", "clearotron", ".env") }],
      ["a start that read no settings file", { demo: false, envFile: null }], ["a start whose record predates the field", { demo: false }]]) {
      startOnRecord(home, fields);
      assert.equal(doctor(home).lead, today, `${what}: setup does not reach it, so it is not one to run again`);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
