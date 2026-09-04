// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — TRADEMARK_MCP_AUTH_MODE=token: the third door on the staff MCP face, and the guards around it.
//
// The local install (`npm start`) needs this face, because it is the far end of the portal's Start
// button. Before this mode the only way to reach it without a Cloudflare Access edge was
// TRADEMARK_MCP_AUTH_DISABLED=1 — which authenticates nobody and hands every caller one synthetic
// address. `token` is the opposite: a valid HMAC-signed scoped key is REQUIRED on every request, checked
// before the rate limiter, the body and the session, with no synthetic identity to fall back on.
//
// WHAT THIS FILE IS ACTUALLY GUARDING. Every case here fails SILENTLY if it regresses:
//
//   · a typo in the mode name falling through to the default would open a different door than the one
//     asked for, and look like it worked;
//   · an unset TRADEMARK_MCP_ALLOWED_HOSTS turns DNS-rebinding protection OFF rather than erroring
//     (`enableDnsRebindingProtection` is keyed on the list being non-empty);
//   · the listening line printed "AUTH OFF (dev)" for anything with a null `verify`, which from this
//     commit includes the key door — a journal line claiming the opposite of the truth;
//   · and, most of all, MODE UNSET MUST MEAN WHAT IT MEANT BEFORE. The test box and production both run
//     this file with the mode unset, so a change in that branch is a change to every deployment.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a child env writes every spelling; — the pin follows the emitter
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "http-server.mjs");

/**
 * Start the server with an env and return how it exited. Used for the branches that must never listen.
 *
 * `timedOut` is reported SEPARATELY and asserted on, because a timeout kill arrives as
 * `err.code === undefined` — which a bare `code ?? 0` turns into a clean exit and a failing assertion
 * that blames the guard rather than the clock. On a loaded box that is a flake with a misleading
 * message, which is worse than a slow test.
 */
function boot(env, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SERVER], {
      env: pinEnvAll({ ...process.env }, env)   // — every spelling, or a pin of the other one upstream wins
     ,
      timeout: timeoutMs,
    }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, timedOut: Boolean(err?.killed), stderr: String(stderr) }));
  });
}

/** Every refusal is the same three facts: it did not hang, it did not listen, and it said why. */
function refused(r, ...patterns) {
  assert.ok(!r.timedOut, `it never exited — it must refuse, not listen. stderr:\n${r.stderr}`);
  assert.notEqual(r.code, 0, `it exited 0. stderr:\n${r.stderr}`);
  for (const p of patterns) assert.match(r.stderr, p);
}

/** Start the server and resolve on the first stderr line matching `re`, then stop it. */
function bootUntil(env, re, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const child = execFile(process.execPath, [SERVER], { env: pinEnvAll({ ...process.env }, env)   // — every spelling, or a pin of the other one upstream wins
     , timeout: timeoutMs },
      (err, stdout, stderr) => { if (!done) { done = true; resolve({ matched: false, stderr: String(stderr) || out, code: err?.code ?? 0 }); } });
    child.stderr.on("data", (c) => {
      out += String(c);
      if (!done && re.test(out)) { done = true; try { child.kill(); } catch { /* gone */ } resolve({ matched: true, stderr: out, code: null }); }
    });
  });
}

// PORT 0 everywhere: the kernel picks a free one, so this file can never collide with a real face on
// this machine and can never be the reason another agent's box goes quiet.
const TOKEN_BASE = {
  TRADEMARK_MCP_AUTH_MODE: "token",
  TRADEMARK_MCP_AUTH_DISABLED: "",
  TRADEMARK_MCP_DEV: "",
  TRADEMARK_MCP_HTTP_HOST: "127.0.0.1",
  TRADEMARK_MCP_HTTP_PORT: "0",
  TRADEMARK_MCP_ALLOWED_HOSTS: "127.0.0.1:18790",
  CLEAROTRON_ACCESS_FILE: "/tmp/does-not-need-to-exist.json",
  CF_ACCESS_TEAM: "", CLEAROTRON_OIDC_AUDIENCE: "", CLEAROTRON_OIDC_AUDIENCE: "",
};

test("token mode and the auth bypass together are FATAL — they mean opposite things", async () => {
  const r = await boot({ ...TOKEN_BASE, TRADEMARK_MCP_AUTH_DISABLED: "1", TRADEMARK_MCP_DEV: "1" });
  refused(r, /FATAL/, /TRADEMARK_MCP_AUTH_MODE=token/, /TRADEMARK_MCP_AUTH_DISABLED/);
});

test("token mode refuses a reachable address — an ops key must not cross the wire in clear", async () => {
  const r = await boot({ ...TOKEN_BASE, TRADEMARK_MCP_HTTP_HOST: "0.0.0.0" });
  refused(r, /FATAL/, /0\.0\.0\.0/);
});

test("token mode refuses an unset TRADEMARK_MCP_ALLOWED_HOSTS — the protection is off, not loud", async () => {
  const r = await boot({ ...TOKEN_BASE, TRADEMARK_MCP_ALLOWED_HOSTS: "" });
  refused(r, /TRADEMARK_MCP_ALLOWED_HOSTS/, /rebinding/i);
});

test("token mode mirrors the mandatory grants file", async () => {
  const r = await boot({ ...TOKEN_BASE, CLEAROTRON_ACCESS_FILE: "" });
  refused(r, new RegExp("CLEAROTRON_ACCESS_FILE"));
});

test("an unrecognised mode is FATAL, never a silent fall-through to the default", async () => {
  const r = await boot({ ...TOKEN_BASE, TRADEMARK_MCP_AUTH_MODE: "toekn" });
  refused(r, /TRADEMARK_MCP_AUTH_MODE="toekn"/, /is not a mode/);
  // It must not have wandered into the CF branch and reported a missing AUD instead — that message
  // would send the reader to configure Cloudflare over a typo.
  assert.ok(!new RegExp("CLEAROTRON_OIDC_AUDIENCE").test(r.stderr), "the typo, not a Cloudflare variable, is what it names");
});

test("MODE UNSET IS UNCHANGED — the old fail-closed refusals fire, and this mode is not mentioned", async () => {
  const r = await boot({
    TRADEMARK_MCP_AUTH_MODE: "",
    TRADEMARK_MCP_AUTH_DISABLED: "", TRADEMARK_MCP_DEV: "",
    CF_ACCESS_TEAM: "", CLEAROTRON_OIDC_AUDIENCE: "", CLEAROTRON_OIDC_AUDIENCE: "",
    TRADEMARK_MCP_HTTP_PORT: "0",
  });
  refused(r, new RegExp(`CLEAROTRON_OIDC_AUDIENCE|CF_ACCESS_TEAM|OIDC`));
  assert.ok(!/TRADEMARK_MCP_AUTH_MODE/.test(r.stderr), "a deployment that never heard of this mode must not be told about it");

  // And the bypass still works exactly as before — mode unset changes nothing about that branch.
  const bypass = await boot({
    TRADEMARK_MCP_AUTH_MODE: "",
    TRADEMARK_MCP_AUTH_DISABLED: "1", TRADEMARK_MCP_DEV: "",
    CLEAROTRON_ACCESS_FILE: "/tmp/whatever.json", TRADEMARK_MCP_HTTP_PORT: "0",
  });
  refused(bypass, /TRADEMARK_MCP_DEV/);
});

test("a correctly configured token door LISTENS, and its line says which door is open", async () => {
  const r = await bootUntil(TOKEN_BASE, /listening on http/);
  assert.ok(r.matched, `it should have reached listen; stderr was:\n${r.stderr}`);
  assert.match(r.stderr, /auth ON \(access key\)/);
  // The regression this replaces: every verify-less door printed the dev banner, which would now be a
  // line asserting authentication is off on a door that refuses every unkeyed request.
  assert.ok(!/AUTH OFF/.test(r.stderr), "a key door must never announce itself as auth-off");
});
