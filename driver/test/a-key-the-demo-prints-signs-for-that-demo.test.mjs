// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KEY COMMAND THE DEMO PRINTS ISSUES A KEY FOR THAT DEMO.
//
// The demo's terminal said its client door "refuses every caller until a key is issued: … clearotron key
// issue <email>". Run as printed on a published beta (2026-09-11) it refused — "this install has no token
// signing secret" — because the demo held its secret in memory only, and the verb read the install's
// settings. The demo now keeps that secret in its own base, and the printed command names the base and
// the demo's own account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { demoTokenSecret, demoTokenSecretPath, keyIssueCommand } from "../../shared/client-door.mjs";
import { demoBaseResetTarget } from "../../bin/start.mjs";
import { handRunEnv } from "./drive-env.mjs";   // a hand-run command's environment, with this box's own marks off it

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the demo keeps one signing secret in its own base, written once and read back", () => {
  const base = mkdtempSync(join(tmpdir(), "demo-base-"));
  try {
    let mints = 0;
    const io = { read: (f) => readFileSync(f, "utf8"), write: (f, t) => writeFileSync(f, t, { mode: 0o600 }), mint: () => `secret-${++mints}` };
    assert.equal(demoTokenSecret(base, io), "secret-1");
    assert.equal(readFileSync(demoTokenSecretPath(base), "utf8").trim(), "secret-1");
    assert.equal(demoTokenSecret(base, io), "secret-1", "a second start signs with the same secret, so a key issued before it still works");
    assert.equal(mints, 1);
    assert.ok(demoTokenSecretPath(base).startsWith(base), "the secret lives inside the demo's base: removing the demo is one directory");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the printed command names the demo's own account and base, and nothing extra for the default install", () => {
  assert.equal(keyIssueCommand({ prefix: "/d/program/bin/", demo: true, user: "demo@localhost", base: "/d", defaultBase: "/h/trademark" }),
    "/d/program/bin/clearotron key issue demo@localhost --base /d");
  assert.equal(keyIssueCommand({ demo: true, user: "demo@localhost", base: "/my demo", defaultBase: "/h/trademark" }),
    'clearotron key issue demo@localhost --base "/my demo"');
  assert.equal(keyIssueCommand({ demo: false, user: "me@localhost", base: "/h/trademark", defaultBase: "/h/trademark" }),
    "clearotron key issue <email>", "an install's key is for somebody else, so its subject stays the reader's to name");
  assert.equal(keyIssueCommand({ demo: false, user: "me@localhost", base: "/srv/tm", defaultBase: "/h/trademark" }),
    "clearotron key issue <email> --base /srv/tm");
});

test("the start banner prints that command, and a demo signs with the secret in its base", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  // A demo's own line is `connect --base` now (owner, 2026-09-19): it mints the key AND names the door, and
  // it signs with the same secret in the base. An install's line is still `key issue`.
  assert.match(src, /until a key is issued: \$\{DEMO \? demoConnectCommand\(\{ prefix: invocationPrefix\(\), base: paths\.base \}\) : keyIssueCommand\(\{ prefix: invocationPrefix\(\), demo: DEMO, user, base: paths\.base,/);
  assert.match(src, /const tokenSecret = DEMO\s*\n\s*\? demoTokenSecret\(paths\.base, \{/);
});

test("a demo is refused over an install's directory, so its secret never lands where the install's key command looks", () => {
  const home = mkdtempSync(join(tmpdir(), "demo-over-install-"));
  const start = (base, extra = {}) => spawnSync(process.execPath, [join(ROOT, "bin", "start.mjs"), "--demo", "--base", base], {
    encoding: "utf8", cwd: ROOT, timeout: 60000,
    // TMPDIR is the run's own, so a demo that got past the refusal copies its samples where the runner removes them.
    env: handRunEnv({ HOME: home, USERPROFILE: home, ...extra }, { PATH: process.env.PATH, TMPDIR: tmpdir() }),
  });
  try {
    // The directory an install is set up in by default.
    const dflt = join(home, "trademark");
    mkdirSync(join(dflt, "pool"), { recursive: true });
    const one = start(dflt, { CLEAROTRON_NO_ENV_FILE: "1" });
    assert.notEqual(one.status, 0);
    assert.match(`${one.stdout}${one.stderr}`, /--demo cannot run in .*trademark/);
    assert.ok(!existsSync(demoTokenSecretPath(dflt)), "the demo wrote its signing secret into the install's directory");

    // An install moved elsewhere, named by the settings in force rather than by its path.
    const moved = join(home, "elsewhere");
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(join(home, ".config", "clearotron", ".env"), `CLEAROTRON_REPORTS_DIR=${join(moved, "pool")}\n`);
    const two = start(moved);
    assert.notEqual(two.status, 0);
    assert.match(`${two.stdout}${two.stderr}`, /keeps its reports in/);
    assert.ok(!existsSync(demoTokenSecretPath(moved)), "the demo wrote its signing secret into the moved install's directory");

    // AN INSTALL SOMEBODY PUT SOMEWHERE OF ITS OWN AND NEVER CONFIGURED. No settings name it, it holds no
    // settings file and it is not the default directory — only its guest list says an install lives here.
    const quiet = join(home, "work", "tm");
    mkdirSync(quiet, { recursive: true });
    writeFileSync(join(quiet, "grants.json"), JSON.stringify({ tenants: {}, people: {} }));
    const four = start(quiet);
    assert.notEqual(four.status, 0);
    assert.match(`${four.stdout}${four.stderr}`, /guest list/);
    assert.ok(!existsSync(demoTokenSecretPath(quiet)), "the demo wrote its signing secret into an install nobody configured");

    // THE CONTROL: a directory of the demo's own is not refused — this run gets past the guard and stops
    // at the next thing wrong with it, which is the port it was given.
    const own = join(home, "a-demo-of-its-own");
    const three = start(own, { PORTAL_SERVICE_PORT: "not-a-port" });
    assert.notEqual(three.status, 0);
    assert.doesNotMatch(`${three.stdout}${three.stderr}`, /--demo cannot run in/);
    assert.match(`${three.stdout}${three.stderr}`, /is not a port number/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── THE DEMO'S OWN DEFAULT FOLDER IS ITS OWN, AND IT IS RESET RATHER THAN REFUSED ─────────────────
//
// A demo before this one kept its base, so a machine that met the product once carries a guest list in
// ~/trademark-demo. The guard above read that as somebody's install and refused — on a run with NO
// FLAGS AT ALL — telling the reader to "run the demo without --base", which is the command they had
// just run. Measured on a WSL walk of a published beta: the demo published its samples, copied the
// program, then refused its own default directory.
//
// The reset is narrow by construction and this arm drives the narrowness, not just the fix: the
// directory must be the demo's own default and the reader must not have named it. Every --base arm
// above still refuses, which is what keeps this from being "the demo deletes directories".
test("only the demo's own default folder is ever reset, and only when the reader did not name it", () => {
  // THE RULE, AS A TABLE, because the thing being decided is whether a directory is removed. Driven on
  // the exported decision rather than by starting a product: the site's own next complaint arrives
  // BEFORE this point (ports resolve first), so a spawn cannot reach the reset without running the
  // whole demo — which is a walk, not an arm. The call site is pinned separately below.
  const DEFAULT = "/h/trademark-demo";
  assert.equal(demoBaseResetTarget({ baseGiven: false, base: DEFAULT, demoDefault: DEFAULT }), DEFAULT,
    "the demo's own default folder, on a run with no flags — the case that was refused");
  assert.equal(demoBaseResetTarget({ baseGiven: true, base: DEFAULT, demoDefault: DEFAULT }), null,
    "a directory the reader NAMED is theirs, even when it is the same path");
  assert.equal(demoBaseResetTarget({ baseGiven: false, base: "/h/work/tm", demoDefault: DEFAULT }), null,
    "any other directory is not the demo's to clear");
  assert.equal(demoBaseResetTarget({ baseGiven: false, base: "/h/trademark-demo-2", demoDefault: DEFAULT }), null,
    "compared whole: a path that merely STARTS with the default is a different directory");
  assert.equal(demoBaseResetTarget({}), null, "and an unanswerable question answers no, never a path");
});

test("the reset is wired into the demo guard, and every named base still goes through the install checks", () => {
  // A PURE RULE NOTHING CALLS IS NOT A CHANGE — the trap this tree has hit before. Counted against the
  // source, so the table above cannot satisfy it on its own.
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(src, /const reset = demoBaseResetTarget\(\{ baseGiven: BASE_GIVEN, base, demoDefault:/,
    "the guard no longer asks the exported rule which directory it may reset");
  assert.match(src, /if \(reset && existsSync\(reset\)\) \{[\s\S]{0,200}rmSync\(reset,/,
    "and the removal is keyed on that answer rather than on a path computed beside it");
});

test("a refusal never tells the reader to drop a flag they did not give", () => {
  // The other half of the reported defect, and the half that would survive a narrow fix: the remedy
  // sentence was written for a reader who had passed --base, and printed to one who had not.
  const home = mkdtempSync(join(tmpdir(), "demo-remedy-"));
  try {
    const quiet = join(home, "work", "tm");
    mkdirSync(quiet, { recursive: true });
    writeFileSync(join(quiet, "grants.json"), JSON.stringify({ tenants: {}, people: {} }));
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "start.mjs"), "--demo", "--base", quiet], {
      encoding: "utf8", cwd: ROOT, timeout: 60000,
      env: handRunEnv({ HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1" }, { PATH: process.env.PATH, TMPDIR: tmpdir() }),
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /--demo cannot run in/, "a base the reader NAMED that looks like an install is still refused");
    assert.doesNotMatch(out, /without --base/, "the remedy told the reader to omit the flag they had just passed");
    assert.match(out, new RegExp(`remove ${quiet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      "and it names the exact directory, which is what the reader has to act on");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("run as printed it issues a key the demo's secret verifies — and without --base it cannot", async () => {
  const base = mkdtempSync(join(tmpdir(), "demo-base-"));
  const home = mkdtempSync(join(tmpdir(), "demo-home-"));
  const was = process.env.TRADEMARK_MCP_TOKEN_SECRET;
  try {
    writeFileSync(demoTokenSecretPath(base), "the-demo-secret\n", { mode: 0o600 });
    // THE DEMO'S OWN GUEST LIST, as `start --demo` writes it: the account is granted through the
    // top-level `people` map, and the tenant's `users` is empty. A reader that walks only `users` calls
    // this key inert while the door accepts it.
    writeFileSync(join(base, "grants.json"), JSON.stringify({
      tenants: { "demo-org": { name: "Demo Org", accounts: ["demo-brand-owner"], users: {} } },
      people: { "demo@localhost": { run: true, manage: true, everything: true } },
    }));
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1" };
    const key = (args) => spawnSync(process.execPath, [join(ROOT, "bin", "key.mjs"), ...args], { encoding: "utf8", cwd: ROOT, env });

    const issued = key(["issue", "demo@localhost", "--base", base]);
    assert.equal(issued.status, 0, issued.stderr);
    assert.doesNotMatch(issued.stderr, /no guest list|granted nothing/, "the guest list read is the demo's, which admits its own account");
    process.env.TRADEMARK_MCP_TOKEN_SECRET = "the-demo-secret";
    const { verifyToken } = await import("../../shared/scope.mjs");
    assert.equal(verifyToken(issued.stdout.trim()).sub, "demo@localhost", "the door, handed the demo's secret, accepts it");

    // THE CONTROL: the same command without --base reads the install's settings, which hold no secret here.
    const refused = key(["issue", "demo@localhost"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /no token signing secret/);

    // AND THE CONTROL FOR THE NOTE: an identity the guest list grants nothing is still told the door
    // will refuse its key, so the silence above is a reading and not a check that cannot fire.
    const stranger = key(["issue", "nobody@example.com", "--base", base]);
    assert.equal(stranger.status, 0, "the key is still issued: issuing before granting is a legitimate order");
    assert.match(stranger.stderr, /resolves to no accounts/);
  } finally {
    if (was === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = was;
    for (const d of [base, home]) rmSync(d, { recursive: true, force: true });
  }
});
