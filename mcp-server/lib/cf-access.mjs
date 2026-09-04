// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/cf-access.mjs — verify a JWT-fronting auth proxy's token and gate by identity (domain/email).
//
// DEFAULT SHAPE: Cloudflare Access. The remote HTTP face sits behind an auth proxy (CF Access, with any
// IdP behind it) that authenticates the user in the browser and forwards a signed JWT on every request.
// We re-validate that JWT at the origin (defence in depth — never trust the network/header alone):
//   - signature: RS256, against the issuer JWKS (createRemoteJWKSet handles kid/rotation/caching);
//   - issuer:    https://<team>.cloudflareaccess.com by default — or ANY OIDC issuer via `issuer`;
//   - audience:  the per-application AUD tag;
//   - identity:  the `email` claim (claim name configurable), gated to allowed domains and/or an exact
//     email allowlist.
// TENANT-PARAMETERIZED: a different JWT-fronting provider (direct Entra, Google IAP, Auth0,
// oauth2-proxy) is CONFIG, not code — set issuer/jwksUrl/emailClaim (+ the header name in the HTTP
// handler). Anything that is not "proxy forwards a verifiable JWT per request" (e.g. the origin itself
// terminating OAuth) is a new code path, deliberately out of scope here.
// Fail-closed: a verifier cannot be constructed without an issuer (or team) + aud, nor without an identity
// gate (allowedDomains and/or allowedEmails) unless the caller opts out explicitly with allowAnyDomain:true.
// Verify CF specifics against current docs at deploy time: /cloudflare-one/identity/authorization-cookie/validating-json/.

import { createRemoteJWKSet, jwtVerify } from "jose";

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; this.name = "AuthError"; }
}

/**
 * makeAccessVerifier({ team, aud, allowedDomains, allowedEmails, allowAnyDomain, issuer, jwksUrl, emailClaim, jwks })
 *   → async (token) => { email, sub, exp }
 * Throws AuthError(401|403) on any failure. `jwks` is injectable (a jose key-resolver) for testing; in
 * production it defaults to the issuer's remote JWKS. `issuer` overrides the CF-team derivation;
 * `jwksUrl` overrides the CF certs path; `emailClaim` names the identity claim (default "email" — e.g.
 * direct Entra puts identity in "preferred_username"). `allowedEmails` is an exact-address allowlist
 * applied IN ADDITION to the domain gate (either empty list = that gate off). Building a verifier with
 * NO identity gate at all requires an explicit allowAnyDomain:true (fail-closed footgun guard).
 */
export function makeAccessVerifier({ team, aud, allowedDomains = [], allowedEmails = [], allowAnyDomain = false, identityMode = "intersection", issuer, jwksUrl, emailClaim = "email", jwks } = {}) {
  const iss = issuer || (team ? `https://${team}.cloudflareaccess.com` : "");
  // `!aud` alone does not close this: an EMPTY ARRAY is truthy, so a parser that returned `[]` for an
  // unset variable would satisfy this guard and the four call sites' `!AUD` at once. MEASURED, because
  // the obvious guess is wrong: jose does NOT read `audience: []` as "no constraint" — it refuses every
  // token, including one minted for an audience the deployment does expect. `audience: undefined` is the
  // value that accepts everything. So the state this refuses to build is a door that COMES UP AND ADMITS
  // NOBODY, and the startup message that should have said "you configured no audience" is the one thing
  // that never prints. — F54 made `aud` able to be an array, so the guard has to
  // be able to see an empty one.
  if (!iss || !aud || (Array.isArray(aud) && aud.length === 0))
    throw new Error("makeAccessVerifier: aud plus team or issuer are required (fail-closed; refusing to build an open verifier)");
  const keySet = jwks ?? createRemoteJWKSet(new URL(jwksUrl || `${iss}/cdn-cgi/access/certs`));
  const domains = allowedDomains.map((d) => String(d).toLowerCase().replace(/^@/, "")).filter(Boolean);
  const emails = allowedEmails.map((e) => String(e).toLowerCase()).filter(Boolean);
  // Fail-closed on an EMPTY identity gate. Without domains (or an exact-email allowlist) the verifier
  // accepts ANY successfully authenticated email (only signature/issuer/audience are checked) — a fail-OPEN
  // posture that is almost always a config mistake (a forgotten allowedDomains). Refuse to build unless the
  // caller OPTS IN with allowAnyDomain:true, so skipping the identity gate is always a deliberate, greppable
  // decision — never an accident. The one legitimate no-gate surface is the client MCP face, where
  // authorization is by per-app AUD + a run-bound token (not email identity); it passes the flag and thereby
  // says so out loud.
  if (!domains.length && !emails.length && !allowAnyDomain)
    throw new Error("makeAccessVerifier: allowedDomains and allowedEmails are both empty and allowAnyDomain is not set — refusing to build a verifier that accepts any authenticated email (fail-closed). Pass allowAnyDomain:true to intentionally skip the identity gate.");

  return async function verifyAccess(token) {
    if (!token || typeof token !== "string") throw new AuthError(401, "missing auth-proxy JWT (e.g. Cf-Access-Jwt-Assertion)");
    let payload;
    try {
      // RS256 pinned (no alg-confusion); issuer + audience enforced; exp required (no never-expiring tokens).
      ({ payload } = await jwtVerify(token, keySet, { issuer: iss, audience: aud, algorithms: ["RS256"], requiredClaims: ["exp"], clockTolerance: "5s" }));
    } catch (e) {
      throw new AuthError(401, `invalid Access token: ${e.message}`);
    }
    // The identity claim is NOT a registered JWT claim, so jose does not type-check it. Require a real string
    // and match the domain EXACTLY on the part after the final '@' — never String()-coerce (an array/object
    // claim would otherwise be coerced into a string that can slip past a suffix check and mis-attribute the
    // audit log).
    const claim = payload[emailClaim];
    if (typeof claim !== "string" || !claim) throw new AuthError(403, `Access token ${emailClaim} claim missing or malformed`);
    const email = claim.toLowerCase();
    const at = email.lastIndexOf("@");
    if (at < 0) throw new AuthError(403, `Access token ${emailClaim} is not an address`);
    const domain = email.slice(at + 1);
    // Two gates, and HOW THEY COMBINE is a decision, not a detail.
    //
    // The default is INTERSECTION (both must pass), which is the right shape for narrowing within a
    // single domain: "one company's domain, and only these three people in it".
    //
    // A portal serving clients needs the other shape. Its population is a staff DOMAIN plus individually
    // named client addresses on domains that must never be admitted wholesale, and under intersection
    // that configuration locks out EVERYONE: staff fail the email list, clients fail the domain list.
    // (Observed exactly that way in production — every identity refused, including the one the domain
    // rule was written for.)
    //
    // So `identityMode: "union"` is opt-in and explicit. It never widens a single-gate config: with only
    // one list set, union and intersection are identical.
    if (identityMode === "union") {
      const okDomain = domains.length > 0 && domains.includes(domain);
      const okEmail = emails.length > 0 && emails.includes(email);
      if (!okDomain && !okEmail) throw new AuthError(403, `email not permitted: ${email}`);
    } else {
      if (domains.length && !domains.includes(domain)) throw new AuthError(403, `email domain not permitted: ${email}`);
      if (emails.length && !emails.includes(email)) throw new AuthError(403, `email not on the allowlist: ${email}`);
    }
    return { email, sub: payload.sub ?? null, exp: payload.exp ?? null };
  };
}
