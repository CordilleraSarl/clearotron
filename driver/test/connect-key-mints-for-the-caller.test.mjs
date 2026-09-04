// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// `/portal/api/connect-key` — the portal became an issuance path, and what that is allowed to mean.
//
// Owner ruling 2026-08-31: *"The page never shows a key, in any state."* The key still reaches the
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

test("an unenrolled identity is refused BEFORE anything is minted", () => {
  // Same reason `clearotron connect` refuses: a key issued to an identity the guest list never heard of
  // authenticates and is then refused on every request — a credential that opens nothing, handed to a
  // reader who then believes they are finished.
  assert.match(ROUTE, /accountsForEmail\(identity, loadGrants\(\)\)/, "enrolment is not checked");
  assert.match(ROUTE, /not_enrolled/, "an unenrolled caller is not refused by name");
  const refusal = ROUTE.indexOf("not_enrolled");
  assert.ok(refusal < ROUTE.indexOf("mintToken"), "the key is minted before enrolment is checked");
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
