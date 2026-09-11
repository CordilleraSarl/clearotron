// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FIRST HOUR READS TRUE.
//
// A stranger's first hour with the published package (measured on a beta, 2026-09-11) met six things that
// were not so. The example command the install prints failed from their home directory. The README
// promised a browser window that never opened, and its install line fails on a stock Linux Node. Its Quick
// start started the product before installing it, and the remedy it then met named a command the reader
// did not have. doctor predicted a portal that refuses to start and that nobody can use, and spoke to a
// package as if it were a checkout. Each arm below holds one of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { browserCommand, invoke, reachableCommand } from "../../shared/invocation.mjs";
import { handRunEnv } from "./drive-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const NPX = "/srv/op/.npm/_npx/0a1b2c/node_modules/clearotron";
const GLOBAL = "/srv/op/.local/lib/node_modules/clearotron";
const NO_SHIM = Object.freeze({ HOME: "/srv/op/nobody-home", PATH: "/usr/bin:/bin" });
const NOTHING_ON_DISK = Object.freeze({ exists: () => false, read: () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } });
const manifest = (version) => (p) => {
  if (p === join(NPX, "package.json")) return JSON.stringify({ version });
  throw new Error(`read outside the fixture: ${p}`);
};

test("the example clearance the install prints names its job by a path that exists, in the package", () => {
  const onboard = read("bin/onboard.mjs");
  assert.match(onboard, /const EXAMPLE_JOB = join\(REPO, "examples", "job\.euipo\.json"\);/);
  assert.match(onboard, /clearotron run --job \$\{[^}]*EXAMPLE_JOB[^}]*\}/, "the printed command names the job relative to wherever the reader stands");
  assert.ok(existsSync(join(ROOT, "examples", "job.euipo.json")), "the example job the install names is not in this tree");
  // IN THE PACKAGE, not only in this tree: the line is printed by an install, which holds what npm packed.
  // Offline: a dry-run pack resolves on disk, and npm reaching for a registry it does not need can block.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024, env: { ...process.env, npm_config_offline: "true" } });
  const files = (JSON.parse(out)[0]?.files ?? []).map((f) => f.path);
  assert.ok(files.length > 500, `npm listed ${files.length} file(s); this arm needs the real list`);
  assert.ok(files.includes("examples/job.euipo.json"), "the example job the install names is not in the package");
  // And a package has no npm scripts where its reader stands, so the install says the old way to a checkout only.
  assert.match(onboard, /if \(!PACKAGED\) say\(`[^`]*Each still works the old way too/);
});

test("nothing a new reader meets promises a browser window the product never opens", () => {
  for (const f of ["README.md", "QUICKSTART.md", "INSTALL.md"])
    assert.doesNotMatch(read(f), /opens (the report|the portal|it) in your browser/, `${f} promises a browser opens`);
  assert.doesNotMatch(read("bin/onboard.mjs"), /prints one address, and opens it/, "the install's last screen promises start opens the address");
  assert.match(read("README.md"), /prints the portal's address and the passphrase to sign in with/);
});

test("the README installs without root, and an npm install line carries the EACCES answer, never sudo", () => {
  const readme = read("README.md");
  assert.match(readme.slice(readme.indexOf("**Then install it.**")), /^```bash\nnpx clearotron install\n```/m,
    "the README's install step is not the one that needs no root");
  assert.ok(readme.indexOf("npx clearotron install") < readme.indexOf("npm install -g clearotron"), "the npm line, which fails on a stock Linux Node, leads");
  const npmParagraphs = readme.split(/\n\n/).filter((p) => /npm install -g clearotron/.test(p));
  assert.ok(npmParagraphs.length > 0, "no npm install line to hold: the next arm would pass on nothing");
  for (const p of npmParagraphs) assert.match(p, /EACCES[\s\S]*npm install -g clearotron --prefix ~\/\.local/, "an npm install line with no answer to EACCES beside it");
  for (const f of ["README.md", "QUICKSTART.md"]) assert.doesNotMatch(read(f), /sudo npm/, `${f} answers EACCES with sudo`);
});

test("the Quick start installs before it starts", () => {
  const readme = read("README.md");
  const install = readme.indexOf("npx clearotron install"), start = readme.indexOf("clearotron start");
  assert.ok(install > 0 && start > 0, "the README names neither the install nor the start, so this arm holds nothing");
  assert.ok(install < start, "the README starts the product before installing it");
});

test("a remedy names a command the reader can type after npm cleans its cache", () => {
  const verb = 'start --organisation "<name>"';
  // From npx's cache: the published version, which runs anywhere, never `cd <the cache> && npx …`.
  assert.equal(reachableCommand(verb, { installDir: NPX, env: NO_SHIM, io: NOTHING_ON_DISK, read: manifest("0.3.0-beta.9") }), `npx clearotron@0.3.0-beta.9 ${verb}`);
  assert.equal(browserCommand(verb, NPX, manifest("0.3.0-beta.9")), `npx clearotron@0.3.0-beta.9 ${verb}`);
  // THE CONTROLS. Anywhere else the terminal gets invoke's answer and a page the bare name, as before; an
  // npx install whose version cannot be read falls back rather than naming a version it made up.
  const argv1 = join(GLOBAL, "bin", "clearotron.mjs");
  assert.equal(reachableCommand(verb, { argv1, installDir: GLOBAL, env: NO_SHIM, io: NOTHING_ON_DISK }), invoke(verb, argv1, NO_SHIM, NOTHING_ON_DISK, GLOBAL));
  assert.equal(browserCommand(verb, GLOBAL), `clearotron ${verb}`);
  const unreadable = () => { throw new Error("EACCES"); };
  assert.equal(browserCommand(verb, NPX, unreadable), `clearotron ${verb}`);
  assert.doesNotMatch(reachableCommand(verb, { installDir: NPX, env: NO_SHIM, io: NOTHING_ON_DISK, read: unreadable }), /clearotron@/);
});

test("the organisation remedy reaches the terminal and the New company screen in that form", () => {
  assert.match(read("bin/start.mjs"), /no organisation named yet — \\`\$\{reachableCommand\('start --organisation "<name>"'\)\}\\`/);
  assert.match(read("driver/portal-service.mjs"), /organisationCommand: browserCommand\('start --organisation "<name>"'\),/);
  const screen = read("portal-ui/src/screens/NewCompany.tsx");
  assert.match(screen, /File one with: \$\{ctx\.me\.organisationCommand\}/);
  assert.doesNotMatch(screen, /File one with: clearotron start/, "the screen still hard-codes the bare name");
});

// ── doctor, driven in a home that has never started ──────────────────────────────────────────────────
const NODE_BIN = dirname(process.execPath);
function doctor(home, extra = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "onboard.mjs"), "--check"], { cwd: ROOT, encoding: "utf8", timeout: 120_000,
    env: handRunEnv({ HOME: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...extra }, {}) });
  assert.equal(r.error, undefined, String(r.error));
  assert.notEqual(r.status, null, `doctor was killed by ${r.signal}`);
  return `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
}

test("doctor before the first start describes the portal start brings up, not a fronted one", async () => {
  const home = mkdtempSync(join(tmpdir(), "first-doctor-"));
  try {
    const { startPaths } = await import(pathToFileURL(join(ROOT, "bin", "start.mjs")).href);
    const grants = startPaths({ env: {}, base: join(home, "trademark") }).grants;
    const out = doctor(home);
    assert.match(out, /local passphrase door \(PORTAL_AUTH_MODE is unset, and `start` runs the local sign-in\)/);
    assert.ok(out.includes(`creates ${grants} and gives the person`), `doctor did not name the grants file start creates (${grants}):\n${out}`);
    assert.doesNotMatch(out, /REFUSES to start|NOBODY can use this portal|handled by a proxy in front/);
    // THE CONTROLS. A declared fronted mode is one start refuses, and doctor says so.
    assert.match(doctor(home, { PORTAL_AUTH_MODE: "auth-proxy" }), /PORTAL_AUTH_MODE=auth-proxy: `[^`]*clearotron start` refuses it, because start is the local install/);
    // Once the first start has written the grants file, doctor reads that file and judges it.
    mkdirSync(dirname(grants), { recursive: true });
    writeFileSync(grants, `${JSON.stringify({ people: { "op@example.com": { everything: true } } })}\n`);
    const after = doctor(home);
    assert.match(after, /somebody can use this portal/);
    assert.doesNotMatch(after, /no grants file yet/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("doctor on a packaged install drops a checkout's questions and names no npm script", () => {
  const onboard = read("bin/onboard.mjs");
  assert.match(onboard, /const PACKAGED = installRoute\(REPO\) === "packaged";/);
  assert.match(onboard, /if \(PACKAGED\) info\("running programs against a checkout's tree: not applicable to a packaged install"\);\n\s*else warn\(`could not tell whether running programs are on the current tree/);
  assert.match(onboard, /if \(PACKAGED && !configuredTree\) info\("running programs on a different checkout: not applicable to a packaged install"\);\n\s*else warn\(`could not tell whether running programs are on a different checkout/);
  assert.doesNotMatch(onboard, /; `npm run example` needs no engine/, "doctor names a checkout's npm script as the demo");
  assert.match(onboard, /\$\{reachableCommand\("demo"\)\}\\` needs no engine/);
  assert.doesNotMatch(onboard, /"[^"\n]*(IN|INTO) this checkout"/, "a doctor line calls the install `this checkout` whatever it is");
  assert.match(onboard, /Full detail: \$\{PACKAGED \? `node \$\{join\(REPO, "scripts", "doctrine-report\.mjs"\)\}` : "npm run doctrine-report"\}/);
});
