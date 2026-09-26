// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Auth unit tests: the Cloudflare Access JWT verifier. Mints RS256 tokens with a local keypair and verifies
// them against a local JWKS (jose), so the accept/reject logic is exercised offline with no network.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { makeAccessVerifier, AuthError } from "../lib/cf-access.mjs";

const TEAM = "cordillera";
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const AUD = "test-aud-tag-123";
const KID = "test-key-1";

let priv, jwks;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  priv = privateKey;
  const pub = await exportJWK(publicKey);
  Object.assign(pub, { kid: KID, alg: "RS256", use: "sig" });
  jwks = createLocalJWKSet({ keys: [pub] });
});

async function mint({ email = "staff@example-firm.com", aud = AUD, iss = ISS, expEpoch, noExp = false, kid = KID } = {}) {
  let t = new SignJWT(email === undefined ? {} : { email }).setProtectedHeader({ alg: "RS256", kid }).setIssuedAt();
  if (iss) t = t.setIssuer(iss);
  if (aud) t = t.setAudience(aud);
  if (!noExp) t = t.setExpirationTime(expEpoch ?? Math.floor(Date.now() / 1000) + 300);
  return t.sign(priv);
}
const mkVerify = () => makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example-firm.com"], jwks });
const isAuth = (status) => (e) => e instanceof AuthError && e.status === status;

test("accepts a valid example-firm.com token", async () => {
  const r = await mkVerify()(await mint());
  assert.equal(r.email, "staff@example-firm.com");
});

test("rejects a wrong audience (confused-deputy guard) — 401", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ aud: "some-other-app" })), isAuth(401));
});

test("rejects a wrong issuer — 401", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ iss: "https://evil.cloudflareaccess.com" })), isAuth(401));
});

test("rejects an expired token — 401", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ expEpoch: Math.floor(Date.now() / 1000) - 60 })), isAuth(401));
});

test("rejects a disallowed email domain — 403", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ email: "mallory@evil.com" })), isAuth(403));
});

test("rejects a token with no email claim — 403", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ email: null })), isAuth(403));
});

test("rejects a missing token — 401", async () => {
  await assert.rejects(() => mkVerify()(undefined), isAuth(401));
  await assert.rejects(() => mkVerify()(""), isAuth(401));
});

test("constructor fails closed without team/aud", () => {
  assert.throws(() => makeAccessVerifier({ team: "", aud: "" }), /fail-closed|required/i);
  assert.throws(() => makeAccessVerifier({ team: TEAM }), /required/i);
});

test("empty domain allow-list FAILS CLOSED at construction (footgun guard)", () => {
  // Without allowedDomains the verifier would accept ANY authenticated email — refuse to build it unless
  // the caller opts out explicitly. This is the footgun fix: a forgotten allowedDomains is now an error,
  // not a silent open door.
  assert.throws(() => makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: [], jwks }), /allowAnyDomain|fail-closed|refusing/i);
  assert.throws(() => makeAccessVerifier({ team: TEAM, aud: AUD, jwks }), /allowAnyDomain|fail-closed|refusing/i);
});

test("empty domain allow-list is allowed only with explicit allowAnyDomain:true (client-MCP surface)", async () => {
  const verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: [], allowAnyDomain: true, jwks });
  const r = await verify(await mint({ email: "guest@partner.com" }));
  assert.equal(r.email, "guest@partner.com");
});

// --- hardening from the security review ---

test("rejects an ARRAY email claim (no String() coercion / gate bypass) — 403", async () => {
  // String(["x@evil.com","y@example-firm.com"]) would end with "@example-firm.com" and slip past a suffix check.
  await assert.rejects(async () => mkVerify()(await mint({ email: ["x@evil.com", "y@example-firm.com"] })), isAuth(403));
});

test("rejects a non-string email claim (number/object) — 403", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ email: 42 })), isAuth(403));
  await assert.rejects(async () => mkVerify()(await mint({ email: { addr: "x@example-firm.com" } })), isAuth(403));
});

test("exact-domain match: a subdomain look-alike is rejected — 403", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ email: "mallory@evil.example-firm.com" })), isAuth(403));
  // and the legitimate exact domain still passes
  assert.equal((await mkVerify()(await mint({ email: "ok@example-firm.com" }))).email, "ok@example-firm.com");
});

test("rejects a token with NO exp claim (no never-expiring tokens) — 401", async () => {
  await assert.rejects(async () => mkVerify()(await mint({ noExp: true })), isAuth(401));
});

// --- tenant-parameterized provider (issuer / claim / email allowlist are config, not code) ---

test("custom OIDC issuer: a non-Cloudflare JWT-fronting proxy verifies via the issuer option", async () => {
  const iss = "https://login.example-idp.com/tenant-1/v2.0";
  const verify = makeAccessVerifier({ aud: AUD, issuer: iss, allowedDomains: ["example.com"], jwks });
  const r = await verify(await mint({ iss, email: "jordan@example.com" }));
  assert.equal(r.email, "jordan@example.com");
  // the CF-shaped issuer is now WRONG for this verifier
  await assert.rejects(async () => verify(await mint({ iss: ISS })), isAuth(401));
});

test("custom identity claim (e.g. preferred_username) is honored; missing it → 403", async () => {
  const verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com"], emailClaim: "preferred_username", jwks });
  const tok = await new SignJWT({ preferred_username: "Relay@Example.com" }).setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt().setIssuer(ISS).setAudience(AUD).setExpirationTime(Math.floor(Date.now() / 1000) + 300).sign(priv);
  assert.equal((await verify(tok)).email, "relay@example.com", "claim read + lowercased");
  await assert.rejects(async () => verify(await mint()), isAuth(403), "a token carrying only `email` lacks the configured claim");
});

test("exact email allowlist: applied IN ADDITION to the domain gate", async () => {
  const verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com"],
    allowedEmails: ["jordan@example.com"], jwks });
  assert.equal((await verify(await mint({ email: "Jordan@example.com" }))).email, "jordan@example.com");
  await assert.rejects(async () => verify(await mint({ email: "relay@example.com" })), isAuth(403),
    "right domain but not on the email allowlist");
});

test("constructor: issuer still needs an identity gate (fail-closed); neither issuer nor team fails closed", () => {
  assert.doesNotThrow(() => makeAccessVerifier({ aud: AUD, issuer: "https://x.example.com", allowedDomains: ["example.com"], jwks }));
  // issuer ALONE is not an identity gate — empty domains+emails without allowAnyDomain refuses to build
  assert.throws(() => makeAccessVerifier({ aud: AUD, issuer: "https://x.example.com", jwks }), /allowAnyDomain/);
  assert.throws(() => makeAccessVerifier({ aud: AUD, jwks }), /required/i);
});

// ── SOMEBODY ADDED ON THE PEOPLE PAGE SIGNS IN, WITH NO RESTART ───────────────────────────────────
//
// The deployment's own guest list is written by the People page and the write succeeds. This verifier
// read its two lists out of the environment ONCE, at construction, and never looked at that file — so
// the new person met a 403 naming their address, and restarting did not help, because the values do not
// come from the file they were added to.
//
// Driven on ONE verifier instance across a change to the list, which is what "no restart" means here:
// the same object refuses and then admits, with nothing rebuilt in between.
test("the union gate consults the guest list at verify time, so a person added after boot is admitted", async () => {
  let listed = [];
  const verify = makeAccessVerifier({
    team: TEAM, aud: AUD, jwks, identityMode: "union",
    allowedEmails: ["already@other.test"],        // the environment's floor, unchanged throughout
    allowedNow: () => listed,
  });

  const token = await mint({ email: "added@later.test" });
  await assert.rejects(() => verify(token), isAuth(403), "an address in neither list must still be refused");

  listed = ["added@later.test"];
  const claims = await verify(token);
  assert.equal(claims.email, "added@later.test", "the person added to the guest list is still refused");

  // THE FLOOR IS UNTOUCHED: what the environment permitted before is permitted now, and the callback
  // can only add. A deployment that names nobody in a file is not widened by any of this.
  assert.equal((await verify(await mint({ email: "already@other.test" }))).email, "already@other.test");
});

test("a resolver that throws, or answers nothing, leaves the door exactly where it was", async () => {
  // ON A REQUEST PATH, so it must not be able to make things worse. A guest list that cannot be read is
  // not a reason to refuse the people the environment already permits, and not a reason to admit anyone.
  const boom = makeAccessVerifier({ team: TEAM, aud: AUD, jwks, identityMode: "union",
    allowedEmails: ["already@other.test"], allowedNow: () => { throw new Error("ENOENT"); } });
  assert.equal((await boom(await mint({ email: "already@other.test" }))).email, "already@other.test",
    "an unreadable guest list refused somebody the environment permits");
  const strangerToken = await mint({ email: "added@later.test" });
  await assert.rejects(() => boom(strangerToken), isAuth(403),
    "an unreadable guest list admitted somebody nothing permits");

  // NO RESOLVER AT ALL is the shape every other caller has, and it must behave exactly as before.
  const plain = makeAccessVerifier({ team: TEAM, aud: AUD, jwks, identityMode: "union", allowedEmails: ["already@other.test"] });
  await assert.rejects(() => plain(strangerToken), isAuth(403));
});
