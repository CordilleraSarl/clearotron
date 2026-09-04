// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — EVERY DOOR THAT VERIFIES A JWT LETS THE DEPLOYMENT NAME ITS OWN PROVIDER.
//
// OWNER RULING, 2026-08-23: "we can't launch with an identity vendor, they bring their own — we can't
// force people to use any auth, they pick their own." Before this, five programs verified an access
// token and only two of them could be pointed at a provider the operator chose. The other three read
// `CF_ACCESS_TEAM` and refused to start without it, so a deployment fronted by Entra, Okta, Auth0 or
// oauth2-proxy — holding no Cloudflare team, because it uses no Cloudflare — could not start at all.
//
// ── WHY THIS IS A GUARD AND NOT THREE FIXED FILES ─────────────────────────────────────────────────
//
// The mechanism was ALREADY generic: `makeAccessVerifier` has always accepted `issuer`, `jwksUrl` and
// `emailClaim`, and `mcp-server/lib/cf-access.mjs` derives the CF issuer only when no issuer is given.
// What shipped single-vendor was every call site that never passed them. That is not a bug one fix
// closes — it is a shape a sixth door reproduces the day somebody adds one, by writing the four lines
// the other five already have and stopping at two of them.
//
// So the corpus is DERIVED: every tracked shipping file that calls the verifier. A file added later is
// in scope the day it lands, by nobody remembering.
//
// ── THE TWO HALVES, BECAUSE ONE WITHOUT THE OTHER IS ADVERTISED AND INERT ─────────────────────────
//
//   1. the CALL passes an issuer — without it the verifier derives the vendor's issuer regardless of
//      what the operator configured;
//   2. the BOOT GUARD accepts an issuer in place of a team — without it the process refuses to start
//      before reaching the call, and the seam is documented, settable and unreachable.
//
// The client MCP door had half of a third: its handler was never told which header carries the token,
// so it read `cf-access-jwt-assertion` whatever was configured.
//
// ── THIS COMMENT USED TO CLAIM A CHECK THAT DID NOT EXIST ─────────────────────────────────────────
//
// It read "Covered by arm 1's `authHeader` check on the surfaces that route through makeHttpHandler",
// and arm 1 scanned only `makeAccessVerifier(` for `issuer:`. There was no authHeader check anywhere
// in the file. So dropping `authHeader: AUTH_HEADER` from a call site stayed green, and the header
// half went back to being what this file's own words call the worst outcome — settable, documented
// and inert. Found by e2e, not by anything here.
//
// The lesson is the one this file exists to enforce, turned on itself: a comment asserting coverage is
// the thing that makes a gap invisible, because the next reader stops looking. Arm 1 scans BOTH callees
// now, and the claim above is what it does rather than what it intended.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "a verifier takes its issuer from configuration (#1672)";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };

/**
 * The argument text of every `<callee>(...)` CALL in `src`, definitions excluded.
 *
 * PARENTHESES ARE BALANCED rather than matched to the next `)`. The real call sites span lines and
 * carry nested object and template literals — `aud: AUD.slice(0, 8)` alone defeats a lazy match, and a
 * scanner that stopped there would read the options as missing an issuer that is plainly there.
 *
 * THE CALLEE IS A PARAMETER because two things need this exact scan and a second copy would drift:
 * `makeAccessVerifier` for the issuer, `makeHttpHandler` for the token header. Both have a definition
 * in the tree that is not a call, and both are spelled out in a JSDoc line that is not one either.
 */
export function callsTo(src, callee) {
  // COMMENT LINES ARE STRIPPED FIRST, and this file committed the fault before it stripped them.
  // `mcp-server/lib/cf-access.mjs` carries a JSDoc line spelling the whole signature —
  // `* makeAccessVerifier({ team, aud, …, issuer, jwksUrl, … })` — which the scanner read as a call
  // site. Worse than a stray hit: those are SHORTHAND parameter names with no colons, so the very
  // documentation that lists `issuer` was reported as a door that does not pass one. A guard that
  // cannot tell prose from code reports the documentation instead of the program, which is the fault
  // driver/test/unit-entries-load-env-local.test.mjs already records paying for once.
  const t = String(src ?? "").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const out = [];
  const re = new RegExp(`(export\\s+function\\s+)?\\b${callee}\\s*\\(`, "g");
  for (let m = re.exec(t); m; m = re.exec(t)) {
    if (m[1]) continue;                                   // a definition, not a call
    let depth = 0, i = re.lastIndex - 1;
    for (; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")" && --depth === 0) break;
    }
    out.push(t.slice(re.lastIndex, i));
  }
  return out;
}

/** The verifier calls, named for the arm that reads them. */
export const verifierCalls = (src) => callsTo(src, "makeAccessVerifier");

/** Does this file's boot guard still demand a vendor team outright? */
export function demandsATeam(src) {
  // The fixed shape a fail-closed boot guard has here: refuse unless a team is set. The corrected
  // form is `(!TEAM && !OIDC_ISSUER)`, so an `&&` between them is what tells the two apart.
  return /!\s*TEAM\s*\|\|/.test(String(src ?? ""));
}

const corpus = () => trackedFiles(GUARD, { root: ROOT });

/** Shipping source only — a test may legitimately build either of these without configuring one. */
const shippingSources = (files) => files
  .filter((f) => /\.(mjs|js)$/.test(f) && !/(^|\/)test\//.test(f) && !/\.test\.(mjs|js)$/.test(f))
  .map((f) => [f, read(f)])
  .filter(([, s]) => s);

/**
 * Every shipping call to `callee` that does not name `key`, and the files that call it at all.
 *
 * ONE SWEEP FOR BOTH CALLEES, because the second one was missing and a comment claimed it was there.
 * A copy of this loop for the header would have been the drift this file's whole subject is about.
 */
function callsMissingKey(files, callee, key) {
  const callers = shippingSources(files).filter(([, s]) => callsTo(s, callee).length);
  const bare = [];
  for (const [f, src] of callers) {
    callsTo(src, callee).forEach((args, i) => {
      if (!new RegExp(`\\b${key}\\s*:`).test(args)) bare.push(`${f} (call ${i + 1}) passes no ${key}`);
    });
  }
  return { callers, bare };
}

test("#1672 every shipping call names its issuer, and every handler is told its token header", (ctx) => {
  const files = corpus();
  if (!files) return ctx.skip(skipReason(GUARD));

  const verifier = callsMissingKey(files, "makeAccessVerifier", "issuer");
  // AN EMPTY CORPUS IS THE FINDING. A predicate that stopped selecting and a tree with no doors give
  // the same green, and this is the sweep where that costs most.
  assert.ok(verifier.callers.length >= 5,
    `${verifier.callers.length} shipping file(s) call makeAccessVerifier — the scan has broken, not the tree`);
  assert.deepEqual(verifier.bare, [],
    `${verifier.bare.length} door(s) build a verifier without an issuer, so they resolve one vendor's issuer `
    + `whatever the deployment configured:\n  ${verifier.bare.join("\n  ")}\n\n`
    + "Pass issuer/jwksUrl/emailClaim from this surface's own env prefix, the way "
    + "mcp-server/http-server.mjs and driver/portal-service.mjs already do.");

  // ── THE HEADER HALF, WHICH THIS FILE CLAIMED AND DID NOT HAVE ────────────────────────────────────
  //
  // An issuer with no header is half a seam: the deployment names its provider, and the door still
  // reads `cf-access-jwt-assertion` — so a proxy that sets anything else authenticates nobody, which
  // is a fail-CLOSED misconfiguration that looks like a broken proxy. `makeHttpHandler` defaults the
  // name, deliberately, so a caller that omits it is not an error anywhere: it is silently the vendor's
  // header forever. Nothing but this arm can see that.
  const handler = callsMissingKey(files, "makeHttpHandler", "authHeader");
  assert.ok(handler.callers.length >= 4,
    `${handler.callers.length} shipping file(s) call makeHttpHandler — the scan has broken, not the tree`);
  assert.deepEqual(handler.bare, [],
    `${handler.bare.length} handler(s) are never told which request header carries the token, so they read `
    + `the vendor's default whatever the deployment configured:\n  ${handler.bare.join("\n  ")}\n\n`
    + "Pass authHeader from this surface's own env prefix. The default in makeHttpHandler exists for "
    + "callers that have no such setting, not as somewhere to leave one.");
});

test("#1672 no door refuses to start for want of a vendor team it does not need", (ctx) => {
  const files = corpus();
  if (!files) return ctx.skip(skipReason(GUARD));
  const offenders = files
    .filter((f) => /\.(mjs|js)$/.test(f) && !/(^|\/)test\//.test(f) && !/\.test\.(mjs|js)$/.test(f))
    .map((f) => [f, read(f)])
    .filter(([, s]) => s && verifierCalls(s).length && demandsATeam(s))
    .map(([f]) => f);
  assert.deepEqual(offenders, [],
    `${offenders.length} door(s) still fail closed on a missing team alone:\n  ${offenders.join("\n  ")}\n\n`
    + "A deployment behind its own OIDC provider holds no vendor team, so this refuses a correct "
    + "configuration before the verifier is ever built. The condition is an audience PLUS either a "
    + "team or an issuer: `(!TEAM && !OIDC_ISSUER) || !AUD`.");
});

test("#1672 both scans FIRE on planted source, and neither fires on the corrected shape", () => {
  // Driven over strings, because the tree is clean once this lands and a tree-driven canary certifies
  // nothing the day after it passes.
  assert.deepEqual(verifierCalls("verify = makeAccessVerifier({ team: TEAM, aud: AUD });"),
    ["{ team: TEAM, aud: AUD }"], "a single-line call must be found and its arguments returned");

  // THE PROSE TRAP, driven rather than trusted to the comment above it. Shorthand names carry no
  // colons, so a doc line listing `issuer` reads as a call that omits it — a false hit pointing at the
  // library that is doing the right thing.
  assert.deepEqual(verifierCalls(" * makeAccessVerifier({ team, aud, issuer, jwksUrl })"), [],
    "a JSDoc line spelling the signature must not read as a call site");
  assert.equal(/\bissuer\s*:/.test(verifierCalls("makeAccessVerifier({ team: TEAM, aud: AUD })")[0]), false,
    "a call with no issuer must read as bare");
  assert.equal(/\bissuer\s*:/.test(verifierCalls("makeAccessVerifier({ team: TEAM, issuer: I || undefined })")[0]), true,
    "…and a call that names one must not");

  // THE PARENTHESIS TRAP, which a lazy match gets wrong on the real call sites.
  const nested = 'makeAccessVerifier({ aud: AUD.slice(0, 8), issuer: OIDC || undefined })';
  assert.equal(verifierCalls(nested).length, 1, "a nested call inside the options must not end the span early");
  assert.match(verifierCalls(nested)[0], /issuer/, "…and the issuer after it must still be seen");

  assert.equal(verifierCalls("export function makeAccessVerifier({ team, aud, issuer } = {}) {").length, 0,
    "the DEFINITION is not a call site — counting it would let the library's own signature satisfy the sweep");

  // ── THE HEADER CALLEE, DRIVEN THE SAME WAY ──────────────────────────────────────────────────────
  //
  // The scan is one function now, so these prove the PARAMETER works rather than re-proving the
  // balancer. `mcp-server/lib/http-handler.mjs` carries both traps in one file — the definition and a
  // JSDoc line spelling the signature — which is exactly what caught this scanner out the first time.
  assert.deepEqual(callsTo("const h = makeHttpHandler({ verify, log })", "makeHttpHandler"),
    ["{ verify, log }"], "a call to the other callee must be found by the same scan");
  assert.equal(callsTo("export function makeHttpHandler({ verify, authHeader = 'x' }) {", "makeHttpHandler").length, 0,
    "the DEFINITION is not a call — the library's own default would otherwise satisfy the sweep");
  assert.deepEqual(callsTo(" * makeHttpHandler({ verify, limiter, sessions, createSession, ... })", "makeHttpHandler"), [],
    "nor is the JSDoc line that spells the signature");
  assert.equal(/\bauthHeader\s*:/.test(callsTo("makeHttpHandler({ verify, log })", "makeHttpHandler")[0]), false,
    "a call that names no header must read as bare");
  assert.equal(/\bauthHeader\s*:/.test(callsTo("makeHttpHandler({ verify, authHeader: H, log })", "makeHttpHandler")[0]), true,
    "…and one that names it must not");

  assert.equal(demandsATeam("} else if (!TEAM || !AUD) {"), true, "the old fail-closed shape must be caught");
  assert.equal(demandsATeam("} else if ((!TEAM && !OIDC_ISSUER) || !AUD) {"), false,
    "…and the corrected one must not, or the fix cannot be applied");
});
