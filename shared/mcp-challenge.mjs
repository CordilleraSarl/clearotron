// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// mcp-challenge.mjs — WHICH CHALLENGE AN MCP ROUTE ANSWERS WITH, which is a different fact from whether
// it answers at all, and the one that decides whether an assistant can connect.
//
// ── the measurement ( — F57; three applications, one account, one afternoon) ───
//
//   the one that WORKED       401 + www-authenticate: Bearer realm="OAuth"     the connector connects
//   the two in front of MCP   302 + www-authenticate: Cloudflare-Access        "Not found, 302"
//
// All three the same `Self-hosted` type, so nothing on this side distinguishes them and creating a
// fresh application does not help — a newly made one behaved like the two, not like the one. A connector cannot complete an
// interactive browser sign-in; it follows the OAuth challenge or it reports the redirect as a missing
// server. So an operator can put Access in front of an MCP door, have EVERY layer report healthy, and
// have no assistant able to connect.
//
// ── WHY THIS IS ITS OWN MODULE AND IMPORTS NOTHING ───────────────────────────────────────────────────
//
// TWO probes read an MCP route and both were blind to this in the same way: the client connector
// (`clientDoorReachability`) and the staff submit lane (`triggerLaneVerdict`). F57 names the connector;
// its own measurement covers BOTH hostnames. Two readers reaching the same conclusion by two hand-rolled
// rules is how they drift, and a rule that fires on one surface while the other stays green is the
// original defect with one fewer place to find it.

/**
 * The auth-scheme tokens in a `www-authenticate` header, lowercased.
 *
 * A SCHEME IS A TOKEN, NOT A SUBSTRING. The header carries comma-separated challenges, each opening
 * with its scheme followed by parameters, so `Bearer realm="Cloudflare-Access is down"` NAMES the
 * string without being the shape. Grepping the raw header finds that and calls a working deployment
 * broken — the same mistake as matching prose about a defect instead of the defect.
 *
 * Not a full RFC 9110 parser and it does not need to be: a comma inside a quoted realm splits one
 * challenge into two, which can only ever produce an EXTRA token, never suppress a real one. Callers
 * ask whether a specific scheme is present, so the failure direction is a false positive on a
 * hand-crafted realm, never a fronted door read as clear.
 *
 * @param {string|null|undefined} header
 * @returns {string[]|null} the schemes; [] when the header was absent; null when it was never read
 */
export function challengeSchemes(header) {
  if (header === undefined) return null;                     // NOT LOOKED AT — an older probe shape
  if (header === null || !String(header).trim()) return [];   // looked, and there was none: a finding
  return String(header).split(",")
    .map((c) => c.trim().split(/\s+/)[0].toLowerCase())
    .filter(Boolean);
}

/**
 * What the challenge form says about an MCP route that answered.
 *
 * KEYED ON THE PAIR, NOT THE HEADER ALONE. What was measured is `302 + Cloudflare-Access`. A
 * Cloudflare-Access challenge on a NON-redirect status is a shape nobody has driven, so it is reported
 * and not judged — claiming more than was measured is how a check starts refusing deployments that work.
 *
 * @param {{status: number|null, challenge: string|null|undefined}} probe
 * @returns {{blocked: boolean, fronted: boolean, looked: boolean, bearer: boolean}}
 */
export function challengeVerdict({ status = null, challenge } = {}) {
  const schemes = challengeSchemes(challenge);
  const fronted = (schemes ?? []).includes("cloudflare-access");
  const redirected = Number.isInteger(status) && status >= 300 && status < 400;
  return { blocked: fronted && redirected, fronted, looked: schemes !== null, bearer: (schemes ?? []).includes("bearer") };
}

/**
 * The sentence both probes print for the blocked shape, so neither invents its own wording.
 * @param {string} where  the address, as the reader typed it
 * @param {number|null} status
 */
export function blockedByAccessChallenge(where, status) {
  return `${where} answers ${status} with a Cloudflare-Access browser challenge, so NO ASSISTANT CAN `
    + "CONNECT THROUGH IT — a connector cannot complete an interactive sign-in and reports the redirect "
    + "as a missing server. The address, the tunnel and the door are all fine. It is the Access "
    + "application in front of this hostname that has to answer an MCP route with the OAuth challenge "
    + "(401 and `www-authenticate: Bearer`) instead of redirecting a browser — an application property "
    + "changed at your identity provider, not here, and NOT repaired by recreating the application "
    + "(recreating it loses this setting and changes the audience, which is two symptoms from one "
    + "cause). "
    // ── NAME THE SWITCH ──────────────────────────────────────────────────────────────────────────
    // The rule first and the vendor second, because the identity interface is configuration on
    // purpose: issuer, audience, claim and header are all settings, and a Cloudflare-only remedy
    // re-narrows an interface that was widened deliberately. But a rule with no switch behind it is
    // what 149 was filed about — it tells a reader they have the wrong challenge and not which
    // control to change, and a reader cannot find "the OAuth option" in a console by that name.
    + "The setting is whichever one makes the application issue OAuth tokens itself rather than "
    + "sign a browser in; on Cloudflare Access it is the application's Advanced settings → Managed "
    + "OAuth, which is OFF on a newly created application. "
    + "INSTALL.md, under \"Putting a surface behind your identity provider\", carries the one-line check "
    + "and what each answer means, and the second setting that has to be right beside it.";
}

/** The trailing note for an answering route, when the challenge form is worth naming. Empty when not. */
export function challengeNote(v) {
  if (!v.looked) return "";
  if (v.fronted) return " — behind a Cloudflare-Access challenge on a non-redirect status, which is not a "
    + "shape F57 measured; if an assistant cannot connect, read this first";
  if (v.bearer) return " with a Bearer challenge, the form an assistant follows";
  return "";
}

/**
 * WHICH CREDENTIAL THIS DOOR ACTUALLY TAKES, from one unauthenticated probe of it.
 *
 * The page that hands a reader their connector steps had this fixed: Claude's steps said to paste a key
 * and turn authentication off, because that was driven once against a door that took a key. Every hosted
 * deployment sits behind an identity provider, whose door answers a sign-in challenge and never honours
 * a key — so those steps minted a key for nothing and told the reader to ignore the one correct signal
 * on their screen. The steps have to follow what the door answers.
 *
 * `"sign-in"` a Bearer/OAuth challenge came back: an assistant can follow it, and there is no key.
 * `"key"`     it refused and named an access key in the body, which is what our own key door does.
 * `null`      NOT KNOWN — it was not probed, it did not answer, or it refused in a shape neither of the
 *             above recognises. The caller says so and offers both rather than guessing; a wrong guess
 *             here is a reader following steps that cannot work, which is the defect this comes from.
 *
 * The body is read for the key case because the header does not separate the two: a proxy-fronted door
 * and a key door can both answer 401 with nothing in `www-authenticate`, and only the body says which.
 * PURE.
 */
export function doorKind(probe) {
  if (!probe || probe.error) return null;
  const v = challengeVerdict(probe);
  if (v.bearer) return "sign-in";
  // KEYED ON THE DOOR SAYING IT REQUIRES ONE, never on the words "access key" appearing. The proxy door's
  // own refusal contains that phrase in the negative — "takes an auth-proxy JWT and never an access key"
  // — so a substring match would read the door that refuses keys as the door that wants one. That is the
  // same shape as a guard firing on a word that contains its pattern, met twice in this tree already.
  if (probe.status === 401 && /\b(?:key|token) is mandatory|mandatory on every request|requires an (?:access|account) key/i
    .test(String(probe.body ?? ""))) return "key";
  return null;
}
