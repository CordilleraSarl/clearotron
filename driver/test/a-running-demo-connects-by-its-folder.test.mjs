// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUNNING DEMO CONNECTS BY ITS FOLDER, AND A KEY AT THE WRONG DOOR IS TOLD WHERE THE RIGHT ONE IS.
//
// Measured on a published beta, 2026-09-19: the demo led with the staff door, an account key taken there
// was refused with "an account key is only accepted on the client surface" and no address, and the route
// that worked took a key issued by hand and an address read out of the startup log. The owner ruled that
// `clearotron connect` takes `--base` and targets a running demo. The full drive, from a packed candidate's
// printed output alone, is recorded on the change that added this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { otherDoor, verifyToken } from "../../shared/scope.mjs";
import { demoTokenSecretPath } from "../../shared/client-door.mjs";
import { INSTALL_CREDENTIAL_FILE } from "../portal-local-auth.mjs";
import { stdioConnectFor } from "../../shared/stdio-connect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONNECT = join(ROOT, "bin", "connect.mjs");

test("a key refused at one door names the other, and nothing is added when this door was not told", () => {
  assert.equal(otherDoor("client", { CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLIENT_MCP_HTTP_PORT: "18962" }), " (client surface: http://127.0.0.1:18962/mcp)");
  assert.equal(otherDoor("staff", { TRADEMARK_MCP_HTTP_HOST: "0.0.0.0", TRADEMARK_MCP_HTTP_PORT: "18961" }), " (staff surface: http://127.0.0.1:18961/mcp)",
    "a wildcard bind is named as loopback, where a reader on this machine reaches it");
  assert.equal(otherDoor("client", { CLEAROTRON_CLIENT_MCP_URL: "https://mcp.example.test/mcp", CLIENT_MCP_HTTP_PORT: "18811" }), " (client surface: https://mcp.example.test/mcp)",
    "a public address is the one a remote assistant can reach, so it wins");
  assert.equal(otherDoor("client", {}), "", "a door that was not told says nothing rather than a guess");
});

test("the demo's banner leads with the client door, and each door is told where the other is", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  const client = src.indexOf("say(`  Client door  http://");
  const engine = src.indexOf("say(`  Engine door  http://");
  assert.ok(client > 0 && engine > client, "the engine door is printed before the client door again");
  const mcp = src.slice(src.indexOf("    mcp: {"), src.indexOf("    worker: {"));
  assert.match(mcp, /CLIENT_MCP_HTTP_PORT: String\(ports\.client\)/, "the staff door is not told where the client door is");
  const door = src.slice(src.indexOf("    client: {"), src.indexOf("CLIENT_MCP_ACCOUNT_ACCESS"));
  assert.match(door, /TRADEMARK_MCP_HTTP_PORT: String\(ports\.mcp\)/, "the client door is not told where the staff door is");
});

const withDemo = (fn) => {
  const home = mkdtempSync(join(tmpdir(), "connect-demo-"));
  const base = join(home, "trademark-demo");
  mkdirSync(base, { recursive: true });
  const run = (args, env = {}) => spawnSync(process.execPath, [CONNECT, ...args], {
    encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CLEAROTRON_NO_ENV_FILE: "1", ...env } });
  try { return fn({ home, base, run }); } finally { rmSync(home, { recursive: true, force: true }); }
};
const record = (home, rec) => {
  const dir = join(home, ".config", "clearotron", "running");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${rec.pid}.json`), JSON.stringify(rec));
};

const RUNNING = (base) => ({ pid: process.pid, demo: true, base, url: "http://127.0.0.1:12340/portal", host: "127.0.0.1", ports: { portal: 12340, mcp: 12341, client: 12342 } });

test("connect --base --where elsewhere finds the demo running from that folder and mints a key its door accepts", () => {
  withDemo(({ home, base, run }) => {
    const secret = "a-demo-secret-for-this-test-only";
    writeFileSync(demoTokenSecretPath(base), secret);
    writeFileSync(join(base, INSTALL_CREDENTIAL_FILE), JSON.stringify({ email: "demo@localhost" }));
    // This test's own pid stands for the running demo: alive, which is all the reader asks.
    record(home, RUNNING(base));
    const r = run(["--base", base, "--where", "elsewhere"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /This key lets an AI assistant act as demo@localhost through Clearotron's client door\. It is not a portal sign-in; the portal uses the passphrase \(/,
      "the key's purpose, in the approved words, comes first");
    assert.match(r.stdout, /Address:  http:\/\/127\.0\.0\.1:12342\/mcp\n/, "the address is the demo's client door, not the staff one");
    const key = /Key:\s+(\S+)/.exec(r.stdout)?.[1];
    assert.ok(key, "no key was printed");
    const before = process.env.TRADEMARK_MCP_TOKEN_SECRET;
    process.env.TRADEMARK_MCP_TOKEN_SECRET = secret;
    try {
      const t = verifyToken(key);
      assert.equal(t.scope, "account", "the key must be an account key, the kind the client door takes");
      assert.equal(t.sub, "demo@localhost", "and for the demo's one user");
    } finally { if (before === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = before; }
    assert.ok(!existsSync(join(home, ".config", "systemd")), "connecting to a demo wrote a unit");
  });
});

test("with no demo running from that folder it says so, names how to start one, and mints nothing", () => {
  withDemo(({ base, run }) => {
    const r = run(["--base", base]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Not available here — no demo is running from .*trademark-demo\./);
    assert.match(r.stdout, /What would change it: start it with `.*clearotron demo --base .*trademark-demo`/);
    assert.doesNotMatch(r.stdout, /Key:/);
  });
});

// ── EACH ASSISTANT ITS OWN FORM, BOUND TO THE DEMO (design, 2026-11-05; the owner's words, 2026-11-06) ──
//
// The demo's start names Claude Code's line, and "Another assistant? Run <connect> in a second terminal and pick it." for the
// rest. Each row's own form comes back, under the demo's own server name and with the demo's folders and flag, so a real
// install's connection beside it is untouched; no key is minted and nothing is written.
test("connect --base hands the assistant picked its own form, bound to the demo, and mints and writes nothing", () => {
  withDemo(({ home, base, run }) => {
    record(home, RUNNING(base));
    // Each row's shape, and the form the one composer writes for it, bound to this demo.
    const shapes = { codex: "codex-toml", chatgpt: "codex-toml", "claude-code": "claude-cli", claude: "desktop-json", other: "generic-json" };
    for (const [id, shape] of Object.entries(shapes)) {
      const r = run(["--base", base, "--client", id]);
      assert.equal(r.status, 0, `${id}: ${r.stdout}${r.stderr}`);
      const form = stdioConnectFor(shape, { workDir: join(base, "workspace"), reportsDir: join(base, "pool"), demo: true });
      for (const line of form.text.split("\n"))
        assert.ok(r.stdout.includes(line), `${id}: the demo's ${shape} form is not printed whole; missing: ${line}`);
      assert.ok(r.stdout.includes(join(base, "workspace")) && r.stdout.includes(join(base, "pool")), `${id}: the form is not bound to the demo's folders`);
      assert.match(r.stdout, /CLEAROTRON_DEMO/, `${id}: the form does not carry the demo flag`);
      assert.doesNotMatch(r.stdout, /trademark-artifacts(?!-demo)/, `${id}: the form names a real install's connection`);
      assert.doesNotMatch(r.stdout, /Key:|Address:/, `${id}: a key route was taken for an assistant on this machine`);
    }
    assert.ok(!existsSync(join(home, ".config", "systemd")), "connecting to a demo wrote a unit");
    assert.ok(!existsSync(join(home, ".config", "clearotron", ".env")), "connecting to a demo wrote settings");
    assert.ok(!existsSync(demoTokenSecretPath(base)), "a secret was made for a route that needs no key");
  });
});

test("connect --base with no assistant named asks which, refuses without a terminal, and lists without asking", () => {
  withDemo(({ home, base, run }) => {
    record(home, RUNNING(base));
    const r = run(["--base", base]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /Which assistant do you want to use\?/);
    assert.match(r.stderr, /stdin is not a terminal/);
    assert.doesNotMatch(r.stdout, /Key:/);
    const listed = run(["--base", base, "--list"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /^ {2}codex {12}Codex$/m);
    assert.doesNotMatch(listed.stdout, /Which assistant/);
    const unknown = run(["--base", base, "--client", "no-such-app"]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /no such assistant "no-such-app"/);
  });
});

test("the demo's start names the key route for its client door and the command that connects another assistant", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  const screen = src.indexOf("for (const line of connectScreen(connect)) say(line);");
  const another = src.indexOf("Another assistant? Run \\`${demoConnectCommand({ prefix: invocationPrefix(), base: paths.base })}\\` in a second terminal and pick it.");
  assert.ok(screen > 0 && another > screen, "the line for another assistant is not printed after Claude Code's connect line");
  assert.match(src.slice(screen, another + 20), /if \(DEMO\) \{ say\(`  Another assistant\?/, "the line is printed outside a demo");
  const help = readFileSync(CONNECT, "utf8");
  assert.match(help, /--base <dir> {6}a running demo's folder: connect your assistant to that demo\. With"\);\n\s*say\(" {22}--where elsewhere, mint a key for its client door, and print both"\);/);
});
