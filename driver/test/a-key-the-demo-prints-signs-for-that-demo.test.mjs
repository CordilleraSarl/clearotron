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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { demoTokenSecret, demoTokenSecretPath, keyIssueCommand } from "../../shared/client-door.mjs";

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
  assert.match(src, /until a key is issued: \$\{keyIssueCommand\(\{ prefix: invocationPrefix\(\), demo: DEMO, user, base: paths\.base,/);
  assert.match(src, /const tokenSecret = DEMO\s*\n\s*\? demoTokenSecret\(paths\.base, \{/);
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
    const env = { PATH: process.env.PATH, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" };
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
