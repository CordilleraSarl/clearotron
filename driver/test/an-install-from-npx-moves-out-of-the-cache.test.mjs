// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN INSTALL RUN FROM NPX MOVES OUT OF NPX'S CACHE.
//
// `npx clearotron install` wired the launcher and every connect line to npm's cache, which npm replaces on
// an update and deletes on a clean. The install now puts the same version under `~/.local` first and runs
// itself from there, `update` follows that prefix, and a connect line composed from the cache names the
// permanent copy once it exists. These arms drive the pure halves and hold the wiring; the whole move needs
// the registry, so it is walked on a published build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { relocationPlan, packagedUpdate, channelOf, stableInstallRoot, compareVersions, readDistTags, demoProgramPlan, ensureDemoProgram, demoProgramEnv } from "../../shared/permanent-install.mjs";
import { invocationPrefix } from "../../shared/invocation.mjs";
import { installShim, inspectShim, shimPath, SHIM_MARKER } from "../../shared/verb-shim.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NPX = "/srv/op/.npm/_npx/0a1b2c/node_modules/clearotron";

test("an install in npx's cache plans a move to ~/.local, at its own version", () => {
  const plan = relocationPlan({ installDir: NPX, env: { HOME: "/srv/op" }, platform: "linux", version: "0.3.0-beta.5" });
  assert.equal(plan.prefix, "/srv/op/.local");
  assert.equal(plan.root, "/srv/op/.local/lib/node_modules/clearotron");
  assert.equal(plan.entry, "/srv/op/.local/lib/node_modules/clearotron/bin/clearotron.mjs");
  assert.deepEqual(plan.npmArgs.slice(0, 4), ["install", "--global", "--prefix", "/srv/op/.local"]);
  assert.equal(plan.npmArgs.at(-1), "clearotron@0.3.0-beta.5", "the move must install THIS version, never whatever is newest");
  // THE CONTROL: anywhere else, there is nothing to move.
  for (const dir of [ROOT, "/srv/op/.local/lib/node_modules/clearotron", "/usr/lib/node_modules/clearotron"])
    assert.equal(relocationPlan({ installDir: dir, env: { HOME: "/srv/op" }, platform: "linux", version: "1.0.0" }), null, dir);
});

test("a move that cannot be made here says why, rather than installing something else", () => {
  const at = (o) => relocationPlan({ installDir: NPX, env: { HOME: "/srv/op" }, platform: "linux", version: "1.0.0", ...o });
  assert.deepEqual(at({ platform: "win32" }), { skip: "windows" });
  assert.deepEqual(at({ env: {} }), { skip: "no-home" });
  assert.deepEqual(at({ version: null }), { skip: "no-version" });
});

test("versions order the way npm orders them, a prerelease below its release", () => {
  const order = ["0.2.4", "0.3.0-beta.2", "0.3.0-beta.5", "0.3.0-beta.10", "0.3.0-rc.1", "0.3.0", "0.3.1", "1.0.0"];
  for (let i = 0; i < order.length; i++)
    for (let j = 0; j < order.length; j++)
      assert.equal(Math.sign(compareVersions(order[i], order[j])), Math.sign(i - j), `${order[i]} against ${order[j]}`);
  assert.equal(compareVersions("0.3.0", "not a version"), null);
  assert.equal(compareVersions(undefined, "0.3.0"), null);
});

test("an update installs the newest published version its channel may reach", () => {
  assert.equal(channelOf("0.3.0-beta.5"), "beta");
  assert.equal(channelOf("0.3.0"), "latest");
  assert.equal(channelOf("1.2.3-rc.1"), "rc");
  const cases = [
    // [installed, dist-tags, expected spec, expected current]
    // THE DEFECT: the release goes to latest and beta stays where it was, so following beta alone never arrives.
    ["0.3.0-beta.5", { latest: "0.3.0", beta: "0.3.0-beta.5" }, "0.3.0", false],
    ["0.3.0-beta.5", { latest: "0.3.1", beta: "0.3.0-beta.5" }, "0.3.1", false],
    // Before the release, the beta line is ahead of latest and a beta install stays on it.
    ["0.3.0-beta.4", { latest: "0.2.4", beta: "0.3.0-beta.5" }, "0.3.0-beta.5", false],
    ["0.3.0-beta.5", { latest: "0.2.4", beta: "0.3.0-beta.5" }, "0.3.0-beta.5", true],
    // A newer beta after the release is still reached from a beta install.
    ["0.3.1-beta.1", { latest: "0.3.0", beta: "0.3.1-beta.2" }, "0.3.1-beta.2", false],
    // A stable install never moves onto a prerelease, however new.
    ["0.3.0", { latest: "0.3.0", beta: "0.4.0-beta.1" }, "0.3.0", true],
    ["0.2.4", { latest: "0.3.0", beta: "0.4.0-beta.1" }, "0.3.0", false],
    // Nothing readable: the channel's own tag, and the caller is told.
    ["0.3.0-beta.5", null, "beta", false],
    ["0.3.0-beta.5", { latest: "garbage" }, "beta", false],
  ];
  for (const [installed, distTags, spec, current] of cases) {
    const u = packagedUpdate({ installDir: "/srv/op/.local/lib/node_modules/clearotron", version: installed, distTags });
    const label = `${installed} with ${JSON.stringify(distTags)}`;
    assert.equal(u.prefix, "/srv/op/.local", label);
    assert.equal(u.spec, spec, label);
    assert.equal(u.current, current, label);
    assert.equal(u.unread, distTags === null || distTags.latest === "garbage", label);
    assert.deepEqual(u.npmArgs, ["install", "--global", "--prefix", "/srv/op/.local", "--no-fund", "--no-audit", `clearotron@${spec}`], label);
  }
  assert.equal(packagedUpdate({ installDir: ROOT, version: "1.0.0", distTags: {} }), null, "a checkout is updated by pulling");
  assert.equal(packagedUpdate({ installDir: NPX, version: "1.0.0", distTags: {} }), null, "npx's cache is not an install to update in place");
});

test("the published versions are read from npm, and a failed read is an absence, not a version", () => {
  const calls = [];
  const run = (out, status = 0) => (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { status, stdout: out }; };
  assert.deepEqual(readDistTags(run('{"latest":"0.3.0","beta":"0.3.0-beta.5"}')), { latest: "0.3.0", beta: "0.3.0-beta.5" });
  assert.equal(calls[0], "npm view clearotron dist-tags --json");
  assert.equal(readDistTags(run("", 1)), null);
  // A failed npm is a failure even when it printed something that parses.
  assert.equal(readDistTags(run('{"latest":"9.9.9"}', 1)), null, "a failed npm view was read as the published versions");
  assert.equal(readDistTags(run("not json")), null);
  assert.equal(readDistTags(run("[]")), null);
  assert.equal(readDistTags(() => ({ error: new Error("ENOENT") })), null);
});

test("a connect line composed in npx's cache names the permanent copy once it exists", () => {
  const home = mkdtempSync(join(tmpdir(), "permanent-home-"));
  try {
    const env = { HOME: home };
    assert.equal(stableInstallRoot({ installRoot: NPX, env }), NPX, "no permanent copy yet, so there is nothing else to name");
    const root = join(home, ".local", "lib", "node_modules", "clearotron");
    mkdirSync(join(root, "mcp-server"), { recursive: true });
    writeFileSync(join(root, "mcp-server", "server.mjs"), "");
    assert.equal(stableInstallRoot({ installRoot: NPX, env }), root);
    assert.equal(stableInstallRoot({ installRoot: ROOT, env }), ROOT, "an install outside the cache names itself");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("npm's link into this install is replaced with the launcher; a link into another install is not", { skip: process.platform === "win32" && "no POSIX launcher on Windows" }, () => {
  const home = mkdtempSync(join(tmpdir(), "permanent-link-"));
  try {
    // The layout `npm install --global --prefix ~/.local` leaves behind.
    const root = join(home, ".local", "lib", "node_modules", "clearotron");
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "clearotron.mjs"), "#!/usr/bin/env node\n");
    const path = shimPath({ HOME: home });
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync("../lib/node_modules/clearotron/bin/clearotron.mjs", path);
    assert.equal(inspectShim(path, { installDir: root }).kind, "npm-link");
    const r = installShim({ env: { HOME: home }, installDir: root, nodePath: process.execPath });
    assert.equal(r.ok, true, `npm's own link was treated as somebody else's: ${r.reason} ${r.detail}`);
    assert.equal(lstatSync(path).isSymbolicLink(), false, "the link was left in place of the launcher");
    assert.match(readFileSync(path, "utf8"), new RegExp(SHIM_MARKER));
    assert.equal(inspectShim(path, { installDir: root }).kind, "ours");
    // THE CONTROL: a link into a DIFFERENT install is still not ours to replace.
    const other = join(home, "other");
    mkdirSync(join(other, "bin"), { recursive: true });
    writeFileSync(join(other, "bin", "clearotron.mjs"), "#!/usr/bin/env node\n");
    rmSync(path);
    symlinkSync(join(other, "bin", "clearotron.mjs"), path);
    assert.equal(inspectShim(path, { installDir: root }).kind, "foreign");
    assert.equal(installShim({ env: { HOME: home }, installDir: root }).reason, "occupied");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the move comes before any question or write, update runs npm only after the live-run refusal, and connect lines go through it", () => {
  // WIRING, read from source: driving either verb end to end needs the registry.
  const onboard = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  const cli = onboard.slice(onboard.indexOf("async function runCli() {"));
  const move = cli.indexOf("const move = relocationPlan();");
  assert.ok(move > 0, "the install no longer plans the move");
  assert.ok(move < cli.indexOf("createInterface("), "the move must come before the first question");
  assert.ok(move < cli.indexOf("// 9 ── write, atomically"), "and before anything is written");
  const update = readFileSync(join(ROOT, "bin", "update.mjs"), "utf8");
  const plan = update.indexOf("packaged = packagedUpdate();");
  const holds = update.indexOf("liveRunHolds({");
  const npm = update.indexOf('runInCheckout("npm", packaged.npmArgs)');
  assert.ok(plan > 0 && holds > plan && npm > holds, "a packaged update must be planned, then refused over a live run, then run");
  // npm relinks `<prefix>/bin/clearotron` on every install, over the launcher; the update puts it back.
  const relaunch = update.indexOf("installShim()", npm);
  assert.ok(relaunch > npm && relaunch < update.indexOf("return 0;", npm), "a packaged update leaves npm's link in place of the launcher");
  const connect = readFileSync(join(ROOT, "shared", "stdio-connect.mjs"), "utf8");
  for (const fn of ["stdioConnectCommand", "stdioConnectFor"]) {
    const at = connect.indexOf(`export function ${fn}(`);
    const signature = connect.slice(at, connect.indexOf("{\n", at));
    assert.match(signature, /installRoot = stableInstallRoot\(/, `${fn} composes from the running root even inside npx's cache`);
  }
});

test("a demo run from npx plans its own copy inside its base, and runs no npm when that copy is current", () => {
  const at = (o) => demoProgramPlan({ base: "/srv/op/trademark-demo", installDir: NPX, platform: "linux", version: "0.3.0-beta.6", exists: () => false, ...o });
  const plan = at();
  assert.equal(plan.prefix, "/srv/op/trademark-demo/program", "the copy is outside the demo's base, so removing the demo would not remove it");
  assert.equal(plan.root, "/srv/op/trademark-demo/program/lib/node_modules/clearotron");
  assert.equal(plan.current, false);
  assert.equal(plan.npmArgs.at(-1), "clearotron@0.3.0-beta.6", "the copy must be THIS version");
  assert.deepEqual(plan.npmArgs.slice(0, 4), ["install", "--global", "--prefix", "/srv/op/trademark-demo/program"]);
  // Current: the copy is there at this version, so a second start runs no npm.
  const read = (p) => (p.endsWith("package.json") ? JSON.stringify({ version: "0.3.0-beta.6" }) : "");
  assert.equal(at({ exists: () => true, read }).current, true);
  assert.equal(at({ exists: () => true, read: () => JSON.stringify({ version: "0.3.0-beta.5" }) }).current, false, "an older copy was taken as current");
  // THE CONTROLS: outside npx there is nothing to copy; Windows and an unreadable version say why.
  assert.equal(at({ installDir: ROOT }), null);
  assert.deepEqual(at({ platform: "win32" }), { skip: "windows" });
  assert.deepEqual(at({ version: null }), { skip: "no-version" });
});

test("a demo's services name the demo's own copy first, then the permanent install, then the running root", () => {
  const home = mkdtempSync(join(tmpdir(), "demo-program-"));
  try {
    const base = join(home, "trademark-demo");
    const env = { HOME: home, CLEAROTRON_DEMO: "1", CLEAROTRON_WORK_DIR: join(base, "workspace") };
    const lay = (root) => { mkdirSync(join(root, "mcp-server"), { recursive: true }); writeFileSync(join(root, "mcp-server", "server.mjs"), ""); };
    assert.equal(stableInstallRoot({ installRoot: NPX, env }), NPX, "nothing laid down yet, so there is nothing else to name");
    const permanent = join(home, ".local", "lib", "node_modules", "clearotron");
    lay(permanent);
    assert.equal(stableInstallRoot({ installRoot: NPX, env }), permanent);
    const own = join(base, "program", "lib", "node_modules", "clearotron");
    lay(own);
    assert.equal(stableInstallRoot({ installRoot: NPX, env }), own, "the demo named another install rather than its own copy");
    // THE CONTROL: the same layout without the demo flag is an install's, and names the permanent copy.
    assert.equal(stableInstallRoot({ installRoot: NPX, env: { ...env, CLEAROTRON_DEMO: undefined } }), permanent);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the demo's copy is made only when missing, and a failed copy is said and never stops the demo", () => {
  const plan = demoProgramPlan({ base: "/srv/op/trademark-demo", installDir: NPX, platform: "linux", version: "0.3.0-beta.6", exists: () => false });
  const drive = ({ status = 0, stderr = "", laid = true, env = {}, p = plan } = {}) => {
    const calls = [], said = [];
    const root = ensureDemoProgram({ base: "/srv/op/trademark-demo", say: (l) => said.push(l), env, plan: p,
      run: (cmd, args) => { calls.push([cmd, ...args]); return { status, stderr }; },
      exists: (f) => f === "/srv/op/npm-cli.js" || (laid && f === join(plan.root, "mcp-server", "server.mjs")) });
    return { root, calls, said };
  };
  // A current copy is used as it is: no npm, nothing said.
  const current = drive({ p: { ...plan, current: true } });
  assert.deepEqual([current.root, current.calls.length, current.said.length], [plan.root, 0, 0]);
  // Nothing to copy: outside npx, or a layout that says why it cannot.
  for (const p of [null, { skip: "windows" }]) assert.deepEqual(drive({ p }).root, null);
  assert.equal(drive({ p: null }).calls.length, 0);
  // A fresh copy through the npm that launched this, when npm names one, else `npm` itself.
  const viaNpx = drive({ env: { npm_execpath: "/srv/op/npm-cli.js" } });
  assert.equal(viaNpx.root, plan.root);
  assert.deepEqual(viaNpx.calls, [[process.execPath, "/srv/op/npm-cli.js", ...plan.npmArgs]]);
  assert.deepEqual(drive().calls, [["npm", ...plan.npmArgs]]);
  // FAILURES ARE NULL AND SAID: npm refusing, and npm reporting success with no program laid down.
  const refused = drive({ status: 1, stderr: "npm notice\nnetwork unreachable" });
  assert.equal(refused.root, null);
  assert.match(refused.said.join("\n"), /could not be copied \(network unreachable\)/);
  assert.equal(drive({ laid: false }).root, null, "an npm exit 0 with no program on disk was taken as a copy");
});

test("services started from the demo's copy print commands that name the copy, not npm's cache", () => {
  const prefix = "/srv/op/trademark-demo/program";
  const root = join(prefix, "lib", "node_modules", "clearotron");
  const npxEnv = { HOME: "/srv/op/nobody-home", PATH: "/usr/bin:/bin", npm_command: "exec", npm_lifecycle_event: "npx",
    npm_execpath: "/srv/op/npm-cli.js", CLEAROTRON_INVOKED_AS: `${NPX}/../.bin/clearotron`, CLEAROTRON_DEMO: "1" };
  const env = demoProgramEnv(npxEnv);
  for (const k of ["npm_command", "npm_lifecycle_event", "npm_execpath", "CLEAROTRON_INVOKED_AS"]) assert.equal(env[k], undefined, `${k} reached the copy's services`);
  assert.deepEqual([env.HOME, env.PATH, env.CLEAROTRON_DEMO], [npxEnv.HOME, npxEnv.PATH, "1"], "the rest of the environment must pass through");
  assert.equal(npxEnv.npm_command, "exec", "the caller's environment was edited in place");
  // npm puts the executable in `<prefix>/bin`, which is on nobody's PATH, so the command names it in full.
  const io = { exists: (f) => f === join(prefix, "bin", "clearotron"), read: () => { throw new Error("no shim"); } };
  assert.equal(invocationPrefix(join(root, "bin", "start.mjs"), env, io, root), `${prefix}/bin/`);
  // THE CONTROL: the same services started from npx's cache print the cache's form, which a clean breaks.
  const fromCache = invocationPrefix(join(NPX, "bin", "start.mjs"), npxEnv, io, NPX);
  assert.match(fromCache, /_npx.*npx $/, "the control no longer prints npx's form; this arm is not measuring the move");
});

test("the demo starts its services from its copy, and a start --demo from npx still makes one", () => {
  const example = readFileSync(join(ROOT, "bin", "example.mjs"), "utf8");
  const copy = example.indexOf("const programRoot = ensureDemoProgram({ base: demoBase");
  const spawnAt = example.indexOf("const child = spawn(process.execPath, [join(startFrom, \"bin\", \"start.mjs\"), ...startArgs]");
  assert.ok(copy > 0 && copy < spawnAt, "the services are started before the copy is made, so they run from npm's cache");
  assert.match(example.slice(spawnAt), /^const child = spawn\([^;]*cwd: startFrom,[^;]*env: programRoot \? demoProgramEnv\(process\.env\) : process\.env,/,
    "the services started from the copy keep npm's npx marks, or run in the cache's directory");
  assert.equal(example.match(/spawn\(process\.execPath/g).length, 1, "a second start of the services bypasses the copy");
  const start = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  const plan = start.indexOf("const demoProgramRoot = DEMO ? ensureDemoProgram({ base: paths.base, say }) : null;");
  const spawnEnv = start.indexOf("const envs = childEnv({ ports, paths, user");
  assert.ok(plan > 0 && plan < spawnEnv, "the copy is made after the services' environment is composed, so the portal names the cache");
  assert.match(start, /stdioConnectOffer\(\{ workDir: paths\.workspace, reportsDir: paths\.pool, \.\.\.\(demoProgramRoot \? \{ installRoot: demoProgramRoot \} : \{\}\) \}\)/,
    "the terminal's connect line does not name the demo's own copy");
});
