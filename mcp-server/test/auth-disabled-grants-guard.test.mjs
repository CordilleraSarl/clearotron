// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The auth-disabled door must refuse to start without a grants file.
//
// THE HOLE THIS CLOSES, found by probing a freshly-started loopback door on the production box:
//
//   auth disabled  ⇒  no verified email  ⇒  every token-less caller is treated as firm staff
//                  ⇒  `internal` scope    ⇒  visibility = accountsForEmail(email, loadGrants())
//                  ⇒  and that function's FIRST line is `if (!grants) return "*"`
//
// So a loopback service door with no grants file hands every local process read-all across every
// customer, unauthenticated, in one HTTP call. The door is loopback-only, which bounds it to whatever
// already runs on the machine — on a box running several agents and a bridge, that is not a comfort.
//
// The config fix is one environment variable. This guard exists because a config fix relies on whoever
// writes the NEXT unit remembering, and the failure is completely silent when they do not.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a child env writes every spelling; — a refusal names the name in force
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "http-server.mjs");

/** Start the server with an env and return how it exited. It should never reach `listen`. */
function boot(env, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [SERVER], {
      env: pinEnvAll({ ...process.env }, env)   // — every spelling, or a pin of the other one upstream wins
     ,
      timeout: timeoutMs,
    }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stderr: String(stderr) }));
    // If it ever DOES listen, kill it — a hung test is a passing test's worst disguise.
    setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, timeoutMs - 500);
  });
}

const BASE = {
  TRADEMARK_MCP_AUTH_DISABLED: "1",
  TRADEMARK_MCP_DEV: "1",
  TRADEMARK_MCP_HTTP_HOST: "127.0.0.1",
  TRADEMARK_MCP_HTTP_PORT: "0",
  CLEAROTRON_ACCESS_FILE: "",
};

test("THE GUARD: auth-disabled with NO grants file refuses to start", async () => {
  const r = await boot({ ...BASE, CLEAROTRON_ACCESS_FILE: "" });
  assert.notEqual(r.code, 0, "it must exit non-zero, not listen");
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, new RegExp("CLEAROTRON_ACCESS_FILE"));
  // The message has to say WHY, or the next person sets it to something meaningless to get past it.
  assert.match(r.stderr, /read-all|ALL customers/i);
});

test("the two existing fail-closed guards still hold", async () => {
  // Auth disabled without dev mode.
  const noDev = await boot({ ...BASE, TRADEMARK_MCP_DEV: "", CLEAROTRON_ACCESS_FILE: "/tmp/whatever.json" });
  assert.notEqual(noDev.code, 0);
  assert.match(noDev.stderr, /TRADEMARK_MCP_DEV/);

  // Auth disabled on a reachable address — the one that stops this door being exposed by one edit.
  const notLoopback = await boot({ ...BASE, TRADEMARK_MCP_HTTP_HOST: "0.0.0.0", CLEAROTRON_ACCESS_FILE: "/tmp/whatever.json" });
  assert.notEqual(notLoopback.code, 0);
  assert.match(notLoopback.stderr, /not loopback/);
});

test("the guard is specific to auth-disabled — it does not break the authenticated door", async () => {
  // With auth ON, identity comes from the verified JWT and the grants file is not this guard's business.
  // A guard that fired here would make the real customer-facing surfaces refuse to start.
  const r = await boot({
    TRADEMARK_MCP_AUTH_DISABLED: "",
    TRADEMARK_MCP_DEV: "",
    CLEAROTRON_ACCESS_FILE: "",
    CF_ACCESS_TEAM: "", CLEAROTRON_OIDC_AUDIENCE: "", CLEAROTRON_OIDC_AUDIENCE: "",
    TRADEMARK_MCP_HTTP_PORT: "0",
  });
  assert.notEqual(r.code, 0, "it still refuses — but for the AUTH reason, not the grants one");
  assert.match(r.stderr, new RegExp(`CLEAROTRON_OIDC_AUDIENCE|CF_ACCESS_TEAM|OIDC`));
  // — through `currentName`, NOT the literal. The emitter names the current spelling now, so a
  // negative assertion on the retired one is true by construction and this arm could never fail again.
  assert.ok(!new RegExp("CLEAROTRON_ACCESS_FILE").test(r.stderr),
    "the grants guard must not fire on the authenticated path");
});
