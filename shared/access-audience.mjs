// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// access-audience.mjs — which Access application audiences a deployment accepts, and the client/staff line.
//
// — F54. Two rules, in one file, because THEY UNDO INDEPENDENTLY AND EACH IS A
// FAIL-OPEN WHEN UNDONE. Splitting them across modules is how one gets "simplified" by a reader who has
// only met the other.
//
// ── WHY NOT IN mcp-server/lib/cf-access.mjs, BESIDE THE VERIFIER THAT USES THEM ──────────────────────
//
// That module statically imports `jose`, and three of the five callers here deliberately do not: the
// portal, profile and recipe services import it LAZILY, inside the branch that actually needs a
// verifier, so a laptop install never loads a JWT library it will never call. `portal-service.mjs`
// states that reasoning at its own LocalAuthError and declines the import for the same reason. Parsing
// an environment variable needs no crypto, so it does not get to drag one in.
/**
 * The audience or audiences this deployment accepts, from one environment value.
 *
 * — F54. A deployment runs one Access application PER AUDIENCE — the portal,
 * the staff door, the client door — and the verification path has always supported that: jose's
 * `audience` takes a string OR an array and passes on any match. What limited a deployment to one was
 * every caller reading the variable as a single string. Measured against the install's own jose with
 * three real application audiences: all three accepted, an unrelated one refused; and under the
 * single-audience configuration a valid token from any application but one was refused.
 *
 * ── WHY THIS RETURNS A STRING FOR 0 AND 1, AND ONLY AN ARRAY FOR 2 OR MORE ────────────────────────
 *
 * AN EMPTY ARRAY IS TRUTHY. Every caller guards with `!AUD` and refuses to start when it is falsy, and
 * `makeAccessVerifier` below refuses to build for the same reason. Returning `[]` for an unset variable
 * would satisfy all of them — turning three fail-CLOSED checks fail-OPEN at once, which is the class
 * this codebase writes its guards against. So the empty case must stay a falsy string, and the
 * one-value case stays a string because there is no reason for it to become a container.
 *
 * `list[0]` rather than the raw value for the single case: identical for every caller here, because
 * `envFrom` already trims and returns undefined for empty, and correct rather than accidental for a
 * caller that does not.
 */
export function accessAudience(raw) {
  const list = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 1 ? list : (list[0] ?? "");
}

/**
 * Is `candidate` one of the audiences `staff` accepts? — F54.
 *
 * The client door asserts its audience DIFFERS from the staff one, and did so with `===`. That stops
 * expressing the boundary the moment staff is a list: with staff "portal,ops" and a client audience of
 * "ops", `!==` is true and the door starts — sharing an audience the staff surface accepts, which is
 * the client/staff collapse that assertion exists to refuse. Membership is the question, not equality.
 */
export function audienceIncludes(staff, candidate) {
  if (!candidate) return false;
  const list = Array.isArray(staff) ? staff : (staff ? [staff] : []);
  return list.includes(candidate);
}

/**
 * The audience(s) as a BOOT LOG should print them — truncated, one per application.
 *
 * — F54, and this exists because of a defect this change introduced. Every
 * caller logged `aud=${AUD.slice(0, 8)}…`, which is correct for a string and silently wrong for a list:
 * `Array.prototype.slice` takes ELEMENTS, so a two-audience deployment printed both values IN FULL and
 * appended a single ellipsis that was no longer true. The line intends a recognisable fragment; with a
 * list it produced the opposite of a fragment.
 *
 * Truncating each entry keeps what the line was for — an operator matching the log against the Access
 * application they configured — for both shapes.
 */
export function audienceLabel(aud) {
  const list = Array.isArray(aud) ? aud : (aud ? [aud] : []);
  if (!list.length) return "(none)";
  return list.map((a) => `${String(a).slice(0, 8)}…`).join(",");
}

// ── THE AUDIENCE THE EDGE ISSUES, AS OPPOSED TO THE ONE THIS INSTALL EXPECTS ───────────────────────
//
// Everything above reads LOCAL configuration. What follows reads the EDGE, so `doctor` can compare the
// two — the half of the recreation trap with no symptom of its own. Deleting and recreating a
// Cloudflare Access application changes the audience; the existing warning fires on the CHALLENGE being
// wrong, so on a box where somebody recreated the application and then fixed the sign-in, every layer
// reads healthy and the stale audience stays invisible until a real request is rejected.
//
// ── WHERE THE AUDIENCE IS, AND WHERE IT IS NOT ───────────────────────────────────────────────────
//
// Access does not publish it in RFC 8414 discovery metadata. Two investigations looked there, correctly
// found nothing, and one concluded the route did not exist. It is in the REDIRECT handed to an
// unauthenticated caller: the login URL carries a `kid` parameter and a `meta` JWT naming the same value.
//
// ── THIS DECODES; IT DOES NOT VERIFY, AND THAT IS DELIBERATE ─────────────────────────────────────
//
// The meta token is public routing information served to a caller with no credential — its own
// `auth_status` reads `NONE`. It is not a bearer token and nothing here trusts it: the only thing taken
// from it is a string, which is then compared against local configuration. Verifying it would mean
// dragging in the credential path and `jose` with it — which this file's header explains at length that
// it must not do — to authenticate a document that authenticates nobody, and would invite a later
// reader to believe a valid signature here meant a request was authorised. It does not.
//
// ── AND THE READ IS CROSS-CHECKED AGAINST ITSELF ─────────────────────────────────────────────────
//
// The same value arrives two independent ways in one response: the `kid` parameter and the token's own
// `aud`. Using one when two are there throws away the only free integrity check on the read, and it is
// the check that would catch this code keying on a field Cloudflare later moves. When they disagree
// this reports the disagreement rather than picking a winner.
/** The path that says a hostname is Access-fronted. */
export const ACCESS_LOGIN_PATH = "/cdn-cgi/access/login/";

/** Base64url → utf8, with no exception escaping to the caller as a silent empty string. */
function decodeSegment(seg) {
  const raw = Buffer.from(String(seg), "base64url").toString("utf8");
  if (!raw) throw new Error("the segment decoded to nothing");
  return raw;
}

/**
 * The audience, read out of the location an unauthenticated request was redirected to.
 *
 * `kind` is the whole answer and every branch has one, because the failures here are NOT
 * interchangeable and the caller must be able to tell them apart:
 *
 *   unreachable      the edge could not be asked. A could-not-look, never agreement.
 *   not-fronted      the hostname answered without an Access challenge. Its own verdict, and the
 *                    single most important one: this check must not be able to SUCCEED by failing to
 *                    find an edge, which is the exact shape of the defect it exists to catch.
 *   unreadable       there is a challenge, and the audience could not be read out of it. Also a
 *                    could-not-look — the shape may have moved, and a moved shape is not agreement.
 *   disagree         `kid` and the token's `aud` name different audiences.
 *   read             one audience, agreed by both sources.
 */
// The marker an Access-fronted API path puts in `WWW-Authenticate`. Keyed on the RESOURCE-METADATA path
// rather than on "Bearer", which any OAuth resource anywhere would send — this names Cloudflare Access
// specifically, and it is the string the real door returns.
const ACCESS_RESOURCE_RE = /cloudflare-access-protected-resource/i;

export function readAudience({ location = "", status = null, error = null, wwwAuthenticate = "", viaEdge = false } = {}) {
  if (error) return { kind: "unreachable", why: String(error?.message ?? error).slice(0, 200) };
  // ── THREE DOORS, NOT ONE ────────────────────────────────────────────────────────────────────────
  //
  // This returned `not-fronted` for every response with no redirect, and measured against production's
  // four configured hostnames that one label covered three materially different states:
  //
  //   trademark.cordillera.ch        302  redirect present  → audience read, kid agrees
  //   mcp.cordillera.ch/mcp          401  no redirect       → not-fronted   ← FALSE, it IS fronted
  //   clients-mcp.cordillera.ch/mcp  401  no redirect       → not-fronted   ← FALSE, it IS fronted
  //   agent-mcp.cordillera.ch/mcp    502  no redirect       → not-fronted   ← an origin fault
  //
  // None of these was a false pass — every one returned ok:false, which is the property that matters
  // most and is untouched. It was a WRONG DIAGNOSIS on a safe failure, and the cost is a reader's hour
  // spent hunting an Access application that exists and is working.
  if (!location) {
    // FRONTED, API PATH. Managed OAuth on an MCP path answers RFC 9728 style instead of redirecting a
    // browser: a 401 whose `WWW-Authenticate` names a Cloudflare Access protected-resource document.
    // Measured on the real door — that document resolves 200, says `protected: true`, and carries NO
    // audience. So this is a stated could-not-look about the audience ON A DOOR THAT IS CONFIRMED
    // PRESENT, which is neither a pass nor "no door".
    if (ACCESS_RESOURCE_RE.test(String(wwwAuthenticate ?? ""))) {
      return { kind: "fronted-api",
        why: `the hostname answered ${status ?? "401"} as an OAuth-protected resource, naming a Cloudflare `
          + "Access protected-resource document — it is fronted, and this route carries no audience to read" };
    }
    // THE EDGE ANSWERED AND THE ORIGIN DID NOT. A 5xx carrying `cf-ray` is Cloudflare reporting that it
    // reached the door and the thing behind it did not answer. Calling that "nothing is fronting this
    // hostname" is exactly backwards.
    if (viaEdge && Number(status) >= 500) {
      return { kind: "origin-failed",
        why: `the edge answered ${status} for this hostname — Cloudflare reached the door and the origin `
          + "behind it did not answer, so the audience could not be asked for" };
    }
    return { kind: "not-fronted", why: `the hostname answered ${status ?? "with no redirect"} and sent no Access challenge` };
  }
  let url;
  try { url = new URL(location); } catch {
    return { kind: "unreadable", why: `the redirect target is not a URL: ${String(location).slice(0, 120)}` };
  }
  if (!url.pathname.includes(ACCESS_LOGIN_PATH)) {
    return { kind: "not-fronted", why: `the redirect goes to ${url.origin}${url.pathname}, which is not an Access login` };
  }
  const kid = url.searchParams.get("kid") || "";
  const token = url.searchParams.get("meta") || "";
  if (!token) return { kind: "unreadable", why: "the Access login carries no `meta` token", kid };
  const parts = token.split(".");
  if (parts.length < 2) return { kind: "unreadable", why: "the `meta` token is not a JWT", kid };
  let payload;
  try { payload = JSON.parse(decodeSegment(parts[1])); } catch (e) {
    return { kind: "unreadable", why: `the \`meta\` token's payload could not be read (${String(e?.message ?? e).slice(0, 80)})`, kid };
  }
  const aud = typeof payload?.aud === "string" ? payload.aud : "";
  if (!aud) return { kind: "unreadable", why: "the `meta` token's payload names no `aud`", kid };
  // BOTH SOURCES, OR NEITHER IS TRUSTED. A `kid` that is absent is itself a change in the shape.
  if (!kid) return { kind: "unreadable", why: "the Access login carries no `kid` to cross-check the token against", aud };
  if (kid !== aud) {
    return { kind: "disagree", aud, kid, hostname: payload?.hostname ?? "", why: "the two sources name different audiences" };
  }
  return { kind: "read", aud, kid, hostname: payload?.hostname ?? "" };
}

/**
 * What to tell the reader, given what was configured and what the edge said.
 *
 * NOTHING HERE RETURNS "fine" FOR A QUESTION IT COULD NOT ASK. Each unhappy kind carries its own
 * sentence naming what was not established, because "no problem reported" and "no problem" are the two
 * things this whole check exists to keep apart.
 */
export function audienceVerdict({ configured = "", read = {} } = {}) {
  // MEMBERSHIP, NOT EQUALITY, and this file already learned that once. A deployment runs one Access
  // application PER AUDIENCE and `CLEAROTRON_OIDC_AUDIENCE` may name several; the edge issues ONE for
  // the hostname being asked. `===` against a configured list reports every correct multi-application
  // deployment as a mismatch — the same mistake `audienceIncludes` above exists to have stopped making.
  const cfg = accessAudience(configured);
  const cfgList = Array.isArray(cfg) ? cfg : (cfg ? [cfg] : []);
  switch (read.kind) {
    case "unreachable":
      return { kind: "could-not-look", ok: false,
        message: `the edge could not be reached, so the audience it issues is unknown (${read.why}). `
          + "This is a failure to look, not agreement." };
    case "not-fronted":
      return { kind: "not-fronted", ok: false,
        message: `nothing is fronting this hostname with Access — ${read.why}. A door that is not there `
          + "cannot be the one this install is configured for, so this is a finding rather than a pass." };
    // NEITHER A PASS NOR "NO DOOR". The door is confirmed present and the audience is not readable by
    // this route — that is a stated could-not-look, and it must not read as either of the two things it
    // is not. Whether an API path's audience is reachable at all is open; nothing in the
    // protected-resource document carries it.
    case "fronted-api":
      return { kind: "fronted-api", ok: false,
        message: `this hostname IS fronted by Access — ${read.why}. The audience could not be compared, `
          + "which is a could-not-look about the audience and not a finding about the door." };
    case "origin-failed":
      return { kind: "could-not-look", ok: false,
        message: `the edge is up and the origin behind it is not — ${read.why}. Nothing here says anything `
          + "about the audience; it says the service is down." };
    case "unreadable":
      return { kind: "could-not-look", ok: false,
        message: `the Access challenge is there but its audience could not be read (${read.why}). `
          + "The shape may have moved; a shape that moved is not agreement." };
    case "disagree":
      return { kind: "sources-disagree", ok: false,
        message: `the edge's own two answers disagree: the login's \`kid\` says ${read.kid} and the `
          + `\`meta\` token says ${read.aud}. Neither is trustworthy on its own, so nothing is compared.` };
    case "read": {
      if (!cfgList.length) {
        return { kind: "not-configured", ok: false,
          message: `the edge issues ${read.aud} for this hostname, and CLEAROTRON_OIDC_AUDIENCE is unset, `
            + "so every request it fronts is checked against nothing." };
      }
      if (!audienceIncludes(cfg, read.aud)) {
        // BOTH VALUES, NEVER "audience mismatch". A reader who is told only that two things differ has
        // to go and find both of them, and the whole point of asking the edge was to hand them over.
        return { kind: "mismatch", ok: false,
          message: `the audience does not match. This install is configured with ${cfgList.join(", ")}, and the edge `
            + `issues ${read.aud} for ${read.hostname || "this hostname"}. Requests will be rejected `
            + "until they agree — recreating an Access application changes the audience." };
      }
      return { kind: "agree", ok: true,
        message: `the audience matches the one the edge issues for ${read.hostname || "this hostname"} (${read.aud})` };
    }
    default:
      return { kind: "could-not-look", ok: false,
        message: `the audience check returned no verdict it knows (${JSON.stringify(read.kind)}), which is `
          + "a fault in this check rather than a finding about the door." };
  }
}

/**
 * One unauthenticated request, with a bound on how long it may take.
 *
 * `redirect: "manual"` because the REDIRECT is the answer — following it fetches Cloudflare's login page
 * and throws away the only thing being read. Failure is returned rather than thrown: the caller's job is
 * to say "could not look", and an exception here would reach `doctor` as a crash instead.
 */
export async function probeAudience({ url, fetchImpl = fetch, timeoutMs = 5000, signalFor = null } = {}) {
  if (!url) return { error: new Error("no hostname is configured to ask") };
  const ac = signalFor ? null : new AbortController();
  const t = ac ? setTimeout(() => ac.abort(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { redirect: "manual", signal: signalFor ?? ac.signal });
    // TWO MORE HEADERS, AND THEY ARE THE WHOLE OF THIS CHECK. Without them every non-redirecting
    // answer collapses to "no redirect", and three different doors read as one. `www-authenticate` is
    // how an Access-fronted API path announces itself; `cf-ray` is how a 5xx says the EDGE answered and
    // the origin behind it did not. Both are on the response already — nothing extra is fetched.
    return { status: res.status, location: res.headers?.get?.("location") ?? "",
      wwwAuthenticate: res.headers?.get?.("www-authenticate") ?? "",
      viaEdge: Boolean(res.headers?.get?.("cf-ray")) };
  } catch (e) {
    return { error: e };
  } finally {
    if (t) clearTimeout(t);
  }
}
