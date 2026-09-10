// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// `/portal/api/connect-key` — the portal became an issuance path, and what that is allowed to mean.
//
// Ruling 2026-08-31: *"The page never shows a key, in any state."* The key still reaches the
// browser, because a clipboard write needs it, and never becomes text.
//
// ── THE PROPERTY THAT ACTUALLY MATTERS ───────────────────────────────────────────────────────────
//
// The rule this replaces existed because a key rendered on a shared page made one person's credential
// everyone's. **Moving it to the clipboard does not answer that** — anyone who can load the page can
// still press the button. What answers it is that each press mints for THE CALLER, from the
// authenticated principal, never from anything the request said. A colleague pressing it gets their own
// credential: attributable in the audit log, revocable by name, and useless as a way to become someone
// else. Every arm below exists to keep that true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE = readFileSync(join(REPO, "driver", "portal-service.mjs"), "utf8");
const ROUTE = SERVICE.slice(
  SERVICE.indexOf('parts[2] === "connect-key"'),
  SERVICE.indexOf("// /portal/connect-help"),
);

test("the route exists and is reachable only by an authenticated caller", () => {
  assert.ok(ROUTE.length > 200, "the connect-key route was not found — every arm below would assert nothing");
  assert.ok(ROUTE.includes("assertPrincipal"), "an unauthenticated caller can mint a credential");
  assert.ok(/method === "POST"/.test(SERVICE.slice(SERVICE.indexOf('parts[2] === "connect-key"') - 120,
    SERVICE.indexOf('parts[2] === "connect-key"') + 80)), "minting is reachable by GET");
});

test("`sub` COMES FROM THE PRINCIPAL AND NEVER FROM THE REQUEST", () => {
  // The whole security property in one line. If `sub` could come from the body, the button would be a
  // way to obtain any identity's credential, and every other control here would be decoration.
  assert.match(ROUTE, /sub:\s*identity/, "the minted identity is not the caller's");
  assert.match(ROUTE, /const identity = principal\.email/, "the identity is not taken from the principal");
  for (const fromRequest of ["body", "query", "params", "JSON.parse"]) {
    assert.ok(!ROUTE.includes(fromRequest), `the route reads "${fromRequest}" — an identity must not come from the caller`);
  }
});

test("an unenrolled identity is refused BEFORE anything is minted", async () => {
  // Same reason `clearotron connect` refuses: a key issued to an identity the guest list never heard of
  // authenticates and is then refused on every request — a credential that opens nothing, handed to a
  // reader who then believes they are finished.
  //
  // Enrolled means a principal exists, and the DOOR decides it: an address with no access anywhere gets no
  // principal and is refused there, before the route reads anything else. Driven through the route rather
  // than read off its source, because the expression that used to do this job is gone.
  const { makePortalService } = await import("../portal-service.mjs");
  const grants = { tenants: {
    celta: { accounts: ["aurora"], users: { "cli@celta.example": ["aurora"] } },
    // An organisation that holds no company yet: its person reaches only its Generic.
    evaluation: { accounts: [], users: { "org@evaluation.example": "*" } },
  } };
  const lines = [];
  const svc = makePortalService({ poolRoot: "/nonexistent", workspaceRoot: "/nonexistent", secret: "s", grants,
    auditLog: (line) => lines.push(String(line)) });
  const issued = () => lines.filter((l) => l.startsWith("connect-key issued"));
  // BOTH SET, so the route CAN mint: without the address it stops at 409 no_connector, and without the
  // secret mintToken throws to a 503 — and the refusal below would then pass on either, not on the door.
  const saved = { url: process.env.CLEAROTRON_CLIENT_MCP_URL, secret: process.env.TRADEMARK_MCP_TOKEN_SECRET };
  process.env.CLEAROTRON_CLIENT_MCP_URL = "https://connector.example/mcp";
  process.env.TRADEMARK_MCP_TOKEN_SECRET = "connect-key-test-secret";
  try {
    const stranger = await svc.route("POST", "/portal/api/connect-key", { email: "who@nowhere.example" }, {});
    assert.equal(stranger.status, 403, `an address with no access anywhere is refused at the door: ${JSON.stringify(stranger.json)}`);
    assert.equal(stranger.json?.key, undefined, "and is handed no key");
    assert.deepEqual(issued(), [], "nothing was minted for it — no issuance was recorded");

    // THE CONTROL: the same route mints for an enrolled caller, so the refusal above is the door and not a
    // route that mints for nobody. The organisation-level person holds no company of their own, which is
    // exactly the reach a company-list check read as not enrolled.
    for (const email of ["cli@celta.example", "org@evaluation.example"]) {
      const r = await svc.route("POST", "/portal/api/connect-key", { email }, {});
      assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.json)}`);
      assert.ok(typeof r.json.key === "string" && r.json.key.startsWith("v1."), `${email} was minted a key`);
    }
    assert.deepEqual(issued(), ["connect-key issued for=cli@celta.example", "connect-key issued for=org@evaluation.example"]);
  } finally {
    if (saved.url === undefined) delete process.env.CLEAROTRON_CLIENT_MCP_URL; else process.env.CLEAROTRON_CLIENT_MCP_URL = saved.url;
    if (saved.secret === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = saved.secret;
  }
});

test("the response is NEVER CACHED, and the audit line records who — never what", () => {
  // A credential in a proxy or disk cache is the "outlives the moment" failure the ruling is about,
  // arriving by a route the page cannot see.
  assert.match(ROUTE, /cache-control/i, "a credential response may be cached");
  assert.match(ROUTE, /no-store/, "the response does not forbid storage");
  // The audit line must name the person and never the token: an audit log that records credentials is a
  // credential store with a different name.
  const audit = /auditLog\(`([^`]*)`\)/.exec(ROUTE)?.[1] ?? "";
  assert.ok(audit.includes("${identity}"), "the audit line does not say who");
  assert.ok(!audit.includes("${key}"), "the audit line records the token itself");
});

test("THE STALE WALL IS CORRECTED, not left to be trusted", () => {
  // This file used to assert, in a comment about token posture, that "the portal cannot mint … this
  // process deliberately holds no engine/MCP secrets — issuance is one path on purpose". Measured
  // 2026-08-31: `bin/start.mjs` generates the signing secret into `~/.env`, the portal unit loads that
  // file, and `childEnv` passes the same value to the portal child. The wall was never built, and four
  // lines above it the same comment warned that a comment asserting an unbuilt wall is worse than none.
  assert.ok(!SERVICE.includes("The portal cannot mint itself a capped token from here"),
    "the stale claim is still in the file, and it is the reason nobody goes to look");
  assert.match(SERVICE, /issuance is one path on purpose/,
    "the retired claim should be QUOTED in its correction — deleting it loses why the correction matters");
  // And the correction must not be a quiet edit: it names what was measured.
  assert.match(SERVICE, /childEnv/, "the correction does not say how the wall was measured");
});
