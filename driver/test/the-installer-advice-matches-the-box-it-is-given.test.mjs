// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Three defects with one shape: the installer and the portal told a reader something that was true of
// some other box.
//
//   107  the re-mint command was a CONSTANT — `--sub portal --verbs start_run,stop_run` — so an
//        operator with a third verb was told to re-mint narrower than what they had, and the verb they
//        lost failed later as an upstream refusal that reads like an engine fault.
//   194  `--apply` announced "GENERATED … Written to the env file at mode 600" and then REFUSED and
//        exited, having written nothing. A reader told a secret exists does not go looking for it.
//   197  `--apply` derives the door's allow-list from its port, and the env merge is add-only — so
//        after a port change the door binds the new port, the allow-list names the old one, and every
//        request 403s while the installer reports the file "left as the operator set them".
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { accountCapAdvice } from "../portal-service.mjs";
import { allowedHostsMerged, allowedHosts } from "../../shared/client-door.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const RENDER = join(ROOT, "driver", "systemd", "render-units.mjs");

/** A posture as `opsTokenPosture` hands one over. */
const posture = (o = {}) => ({ readable: true, scope: "ops", sub: "portal", verbs: ["start_run", "stop_run"],
  accounts: null, accountCapped: false, expiresAt: null, daysLeft: null, expired: false, implausibleExp: false, ...o });

// ── 107 ─────────────────────────────────────────────────────────────────────────────────────────────

test("107 the re-mint command carries the token's OWN verbs, not the two the string used to name", () => {
  const said = accountCapAdvice(posture({ verbs: ["start_run", "stop_run", "feed_context"], sub: "portal-alpha" }));
  assert.match(said, /--verbs start_run,stop_run,feed_context/,
    "the advice named a narrower verb set than the token has, so following it silently drops a verb");
  assert.match(said, /--sub portal-alpha/, "the advice re-mints under a different subject than the token carries");
});

test("107 the advice NEVER narrows a token, for any verb set — the property, not one example", () => {
  // The arm above is one token. This is the class: whatever the token carries, every verb of it must
  // survive the command a reader is told to run.
  for (const verbs of [["start_run"], ["stop_run"], ["start_run", "stop_run"],
    ["start_run", "stop_run", "feed_context"], ["a", "b", "c", "d"]]) {
    const said = accountCapAdvice(posture({ verbs }));
    const named = (said.match(/--verbs ([^\s`]+)/) ?? [])[1]?.split(",") ?? [];
    for (const v of verbs) {
      assert.ok(named.includes(v),
        `a token carrying [${verbs.join(", ")}] was told to re-mint as [${named.join(", ")}], losing ${v}`);
    }
  }
});

test("107 a FULL-OPS token is offered no --verbs flag at all — null is every verb, not none", () => {
  // The inversion that would make this advice harmful. `verbs: null` means the claim is absent, which
  // is the WIDEST posture; naming any list there is the narrowing the whole fix is about.
  const said = accountCapAdvice(posture({ verbs: null }));
  assert.doesNotMatch(said, /--verbs/,
    "a full-ops token was handed a verb list, which would cap a token that currently has no cap");
  assert.match(said, /--accounts <keys>/, "and it still has to say how to add the accounts cap");
});

test("107 an UNREADABLE payload is given no command to run", () => {
  // `opsTokenPosture` answers readable:false with every claim null, and that lands in this warning
  // because accountCapped is false when nothing could be read. A command built from those nulls is a
  // guess presented as an instruction — in the one case where following it destroys the token.
  const said = accountCapAdvice({ readable: false, sub: null, verbs: null });
  assert.doesNotMatch(said, /mint-token\.mjs/, "a command was composed out of claims nobody could read");
  assert.match(said, /could not be read/, "and the reader is told why they are not being given one");
});

// ── 197 ─────────────────────────────────────────────────────────────────────────────────────────────

test("197 re-deriving the allow-list follows the port, and keeps what the operator added", () => {
  const merged = allowedHostsMerged("127.0.0.1:18811,localhost:18811,mcp.example-firm.com", 18899);
  assert.match(merged, /127\.0\.0\.1:18899/, "the door binds 18899 and its allow-list does not name it — every request 403s");
  assert.match(merged, /localhost:18899/);
  assert.ok(merged.includes("mcp.example-firm.com"),
    "a host the operator added by hand was deleted by a repair about a port");
  assert.doesNotMatch(merged, /18811/, "the stale loopback entries were kept, so the list grows on every port change");
});

test("197 an allow-list that is already right is left exactly as it is", () => {
  const right = allowedHosts(18899);
  assert.equal(allowedHostsMerged(right, 18899), right,
    "a correct list was rewritten, which would report a change on every run and teach a reader to ignore it");
});

test("197 --apply re-derives the allow-list after a port change, and says that it did", () => {
  // DRIVEN THROUGH THE REAL CLI, twice against one env file, because the defect is in the MERGE and a
  // single apply cannot see it: the first run writes the list, and only a second run over a changed
  // port can leave it stale.
  const dir = mkdtempSync(join(tmpdir(), "ct197-"));
  try {
    const env = join(dir, "env");
    const grants = join(dir, "grants.json");
    writeFileSync(grants, JSON.stringify({ tenants: {} }));
    writeFileSync(env, `CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\nCLEAROTRON_ACCESS_FILE=${grants}\n`);
    const run = () => execFileSync(process.execPath, [RENDER, "--apply", "--dest", join(dir, "dest"), "--env", env],
      { encoding: "utf8", timeout: 120_000 });
    run();
    const first = readFileSync(env, "utf8");
    const port = (first.match(/^CLIENT_MCP_HTTP_PORT=(.*)$/m) ?? [])[1];
    assert.ok(port, "the first apply wrote no door port, so this arm cannot test a port CHANGE");

    const moved = String(Number(port) + 88);
    writeFileSync(env, first.replace(/^CLIENT_MCP_HTTP_PORT=.*$/m, `CLIENT_MCP_HTTP_PORT=${moved}`));
    const out = run();
    const after = readFileSync(env, "utf8");
    const hosts = (after.match(/^CLIENT_MCP_ALLOWED_HOSTS=(.*)$/m) ?? [])[1] ?? "";
    assert.ok(hosts.includes(`127.0.0.1:${moved}`),
      `the door binds ${moved} and its allow-list says ${hosts} — every request to it answers 403`);
    assert.doesNotMatch(out, /left as the operator set them/,
      "the installer reported the file untouched while re-deriving a value the operator never set");
    assert.match(out, /re-derived CLIENT_MCP_ALLOWED_HOSTS/,
      "the file changed under the operator and the output did not say so");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 194 ─────────────────────────────────────────────────────────────────────────────────────────────

test("194 a REFUSED apply announces no secret, because it wrote none", () => {
  // The refusal exits before anything reaches disk. Announcing a generated secret above it told the
  // reader a file holds 32 bytes it does not hold — and a reader who believes the secret exists does
  // not go looking for the reason their door will not start.
  const dir = mkdtempSync(join(tmpdir(), "ct194-"));
  try {
    const env = join(dir, "env");
    // NO ACCESS FILE: the client door's own blocker, and the one a hosted operator actually hits,
    // because `.env.deployment.example` ships that row empty.
    writeFileSync(env, "CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\nPORTAL_MCP_URL=\nCLEAROTRON_ACCESS_FILE=\n");
    let out = "";
    let refused = false;
    try {
      execFileSync(process.execPath, [RENDER, "--apply", "--dest", join(dir, "dest"), "--env", env],
        { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      refused = true;
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    assert.ok(refused, "the install did not refuse, so this arm never reaches the path it is named for");
    assert.match(out, /REFUSED/, "and it refused for the reason this arm is about");
    assert.doesNotMatch(out, /GENERATED a signing secret/,
      "a refused run announced a signing secret it never wrote");
    assert.doesNotMatch(out, /GENERATED the portal's secret/,
      "a refused run announced the portal's secret it never wrote");
    assert.doesNotMatch(out, /Written to the env file/,
      "a refused run claimed something was written to a file it did not write");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("194 an apply that SUCCEEDS still announces both secrets — the fix moved them, it did not delete them", () => {
  // The other half, and the one a careless repair breaks: an installer that begins generating
  // cryptographic material is a posture change the reader meets in the output of the command that did
  // it. Silence on the success path would be a different defect wearing this fix's clothes.
  const dir = mkdtempSync(join(tmpdir(), "ct194ok-"));
  try {
    const env = join(dir, "env");
    const grants = join(dir, "grants.json");
    writeFileSync(grants, JSON.stringify({ tenants: {} }));
    writeFileSync(env, `CLEAROTRON_CHECKOUT_DIR=/opt/clearotron\nCLEAROTRON_ACCESS_FILE=${grants}\n`);
    const out = execFileSync(process.execPath, [RENDER, "--apply", "--dest", join(dir, "dest"), "--env", env],
      { encoding: "utf8", timeout: 120_000 });
    assert.match(out, /GENERATED a signing secret/);
    assert.match(out, /GENERATED the portal's secret/);
    const body = readFileSync(env, "utf8");
    // AND THE ANNOUNCEMENT IS NOW TRUE, which is the whole point of moving it: read the file back.
    assert.match(body, /^TRADEMARK_MCP_TOKEN_SECRET=[0-9a-f]{64}$/m,
      "the run announced a signing secret and the file does not carry one");
    assert.match(body, /^PORTAL_SECRET=[0-9a-f]{64}$/m,
      "the run announced the portal's secret and the file does not carry one");
    assert.ok(!out.includes((body.match(/^PORTAL_SECRET=(.*)$/m) ?? [])[1]),
      "the portal secret was printed to stdout");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
