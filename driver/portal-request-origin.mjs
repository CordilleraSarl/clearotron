// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STATE CHANGE MUST COME FROM THIS PORTAL'S OWN PAGES. The portal checked nothing about where a POST
// came from: the session cookie's SameSite attribute was the whole defence in local mode, and behind a
// proxy it was the proxy's cookie. A page on another site, or another app on this machine on another
// port (a browser treats every port on one host as the same site), could make a signed-in browser change
// state here. So every state-changing request is checked against this portal's own host, in both modes.
//
// THE HOST IS THE REQUEST'S OWN, NOT A LIST. `Host` is what the browser addressed. A proxy in front can
// rewrite it, and then says the original in `X-Forwarded-Host`, which Caddy sets by default. A page on
// another site cannot set either header on a victim's browser (a custom header forces a preflight the
// portal never grants), so accepting a match on either is still a match on this portal's own name.
// Compared with its port: another app on this machine differs only in the port.
//
// A REQUEST WITH NEITHER `Origin` NOR `Sec-Fetch-Site` IS NOT FROM A BROWSER. Every current browser sends
// one of them on a POST, and a script or `curl` sends neither. A script cannot be tricked into carrying
// someone else's session, so there is nothing to refuse, and its own credential still has to pass.

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const first = (v) => String(Array.isArray(v) ? v[0] : (v ?? "")).split(",")[0].trim();

/** The hosts this request says it was addressed to, lower-case, with their ports. */
function ownHosts(headers) {
  return new Set([first(headers?.host), first(headers?.["x-forwarded-host"])].filter(Boolean).map((h) => h.toLowerCase()));
}

/**
 * Why this request is refused as coming from somewhere other than this portal, or null to let it through.
 * @param {{ method?: string, headers?: Record<string, string|string[]|undefined> }} req
 * @returns {string|null}
 */
export function crossSiteReason(req) {
  if (!STATE_CHANGING.has(String(req?.method ?? "GET").toUpperCase())) return null;
  const headers = req?.headers ?? {};
  const origin = first(headers.origin);
  if (origin) {
    if (origin === "null") return "Origin is null";
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch { return "Origin is not an address"; }
    const own = ownHosts(headers);
    return own.has(host) ? null : `Origin ${host} is not this portal (${[...own].join(", ") || "no Host"})`;
  }
  const site = first(headers["sec-fetch-site"]).toLowerCase();
  if (site) return site === "same-origin" || site === "none" ? null : `Sec-Fetch-Site is ${site}`;
  return null;
}

/**
 * Whether a state-changing request carries a body that is not declared as JSON. The API reads every body as
 * JSON; a form post (`text/plain`, `application/x-www-form-urlencoded`) is the shape a page on another site
 * can send without a preflight, so it is refused here rather than parsed. A request with no body is not
 * asked for a type: the portal's own pages send none on a POST that carries nothing.
 */
export function bodyNotJson(req) {
  if (!STATE_CHANGING.has(String(req?.method ?? "GET").toUpperCase())) return false;
  const headers = req?.headers ?? {};
  const length = Number(first(headers["content-length"]) || 0);
  const hasBody = length > 0 || Boolean(first(headers["transfer-encoding"]));
  if (!hasBody) return false;
  const type = first(headers["content-type"]).split(";")[0].trim().toLowerCase();
  return type !== "application/json";
}
