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
    + "changed at your identity provider, not here, and not fixed by recreating the application. "
    + "INSTALL.md, under \"Putting a surface behind your identity provider\", carries the one-line check "
    + "and what each answer means.";
}

/** The trailing note for an answering route, when the challenge form is worth naming. Empty when not. */
export function challengeNote(v) {
  if (!v.looked) return "";
  if (v.fronted) return " — behind a Cloudflare-Access challenge on a non-redirect status, which is not a "
    + "shape F57 measured; if an assistant cannot connect, read this first";
  if (v.bearer) return " with a Bearer challenge, the form an assistant follows";
  return "";
}
