// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-access.mjs — identity → principal for the unified portal. The INNER
// authorization boundary: CF Access (the edge) proves WHO; this module decides WHAT THEY SEE. Pure
// decisions over injected inputs (grants object + staff domains) — fail-closed at every edge:
// an unmapped identity gets NO principal (403 at the door), a cross-account request resolves to 404
// semantics (never 403 — existence must not leak), and the grants substrate is the SAME file shape
// the MCP faces read (`CLEAROTRON_ACCESS_FILE`, shared/scope.mjs loadGrants), so portal enrolment and MCP
// grants stay one roster. Shape and semantics: INSTALL.md §8; examples/grants.example.json.
import { accountsForEmail } from "../shared/scope.mjs";

// LAST-@ semantics, matching the CF edge verifier (cf-access.mjs) and isFirmDomain (shared/scope.mjs)
// — the privilege parse must never disagree with the edge parse (review 2026-07-18: a first-@ split
// classified "x@firm.ch@evil.com" as staff while the edge saw evil.com).
const domainOf = (email) => { const e = String(email ?? "").toLowerCase(); const i = e.lastIndexOf("@"); return i < 0 ? "" : e.slice(i + 1); };

/**
 * makePrincipal({ email, grants, staffDomains }) →
 *   { role: "staff",  email, accounts: "*" }            — firm identity: everything, acting-for allowed
 * | { role: "client", email, accounts: ["aurora", …] }  — enrolled client: exactly the granted accounts
 * | null                                                — unknown identity: no portal (the door 403s)
 * Staff wins over an (accidental) grants row; a client row with a tenant-wide "*" grant is honored
 * but the role stays client (no staff surfaces).
 */
export function makePrincipal({ email, grants = null, staffDomains = [] }) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  if (e.indexOf("@") !== e.lastIndexOf("@")) return null;   // multi-@ identities are refused outright — no parse to disagree about
  if (staffDomains.map((d) => String(d).toLowerCase()).includes(domainOf(e)))
    return { role: "staff", email: e, accounts: "*" };
  const accounts = accountsForEmail(e, grants);
  if (accounts === "*") return { role: "client", email: e, accounts };
  if (Array.isArray(accounts) && accounts.length) {
    // `generic` is STAFF-ONLY and every route already enforces that (portal-service: the runs listing,
    // the report route and the LEAK-#9 rule all 404 it for a client). What no route did was stop it
    // being OFFERED: a tenant-wide grant expands to the full roster, `generic` is in the roster, and it
    // sorts first — so the brand-owner picker showed it at the top, the sidebar named it as the
    // client's own account, and choosing it produced "The list could not be loaded" every time.
    //
    // Found by resolving the real production grants for the one enrolled client rather than by reading
    // the route code, which looked correct in isolation. The routes WERE correct; the roster handed to
    // the picker was not, and a menu whose first item always fails is a defect wherever the refusal is
    // implemented.
    //
    // Filtered here, at the point the identity is decided, so the picker, the sidebar and every route
    // are working from one list. An explicit grant of `generic` is dropped too: it is not a thing a
    // client may hold, so honouring it in the menu would only defer the same 404.
    const visible = accounts.filter((a) => a !== "generic");
    if (visible.length) return { role: "client", email: e, accounts: visible };
    return null;   // a client granted nothing BUT generic holds no visible account at all
  }
  return null;
}

export class PortalDeny extends Error {
  constructor(status, message) { super(message); this.name = "PortalDeny"; this.status = status; }
}

/**
 * The ONE chokepoint every account-scoped route passes. Resolves the EFFECTIVE account for a request:
 *   - staff: any account (the acting-for picker) — but an account must still be NAMED for
 *     account-scoped routes (no accidental firm-wide writes);
 *   - client: the named account must be inside the grant — a foreign account is a 404 (not 403:
 *     existence never leaks), an unnamed account defaults to their only account (convenience) or
 *     404s when ambiguous.
 * staffOnly routes 404 for clients (the surface does not exist for them).
 */
export function assertPrincipal(principal, { staffOnly = false, account = null, door = false } = {}) {
  if (!principal) throw new PortalDeny(403, "no portal access for this identity");
  if (staffOnly && principal.role !== "staff") throw new PortalDeny(404, "not found");
  // door mode: the caller only needs "may this identity enter" — NEVER resolve an account (a
  // multi-account client must not 404 off the front door; review 2026-07-18)
  if (door) return null;
  if (account == null) {
    if (principal.role === "staff") return null;   // staff without acting-for: caller decides (list-all views)
    if (Array.isArray(principal.accounts) && principal.accounts.length === 1) return principal.accounts[0];
    if (principal.accounts === "*") return null;
    throw new PortalDeny(400, "name an account (?account=) — this login covers several");   // multi-account client must name one — an actionable 400, never a lockout
  }
  const a = String(account).trim().toLowerCase();
  if (principal.role === "staff") return a;
  // `generic` IS THE HOUSE ACCOUNT, AND IT IS REFUSED HERE RATHER THAN PER ROUTE.
  //
  // makePrincipal strips `generic` from a client's grant — but only on the ARRAY branch. A grant that
  // resolves to the literal "*" returns above it, untouched, and the wildcard test below then admits
  // `generic` like any other account. Three routes (the runs listing and the two report routes) carried
  // their own `role !== "staff"` check and closed the hole for themselves; POST /portal/api/run and
  // /run/plan never did. So the one path that spends money was the one path with no guard — against the
  // one account that is EXEMPT from the daily run cap (runner.mjs: `generic` is the neutral no-customer
  // profile and stays uncapped). Uncapped spend, reachable by a grant shape, is the worst combination
  // in this file.
  //
  // Refusing at the chokepoint fixes every account-scoped route at once, including the ones nobody has
  // written yet, which is the property the per-route checks could never have. Those three stay as they
  // are: they are cheap, and defence in depth on a spend boundary is not duplication.
  if (a === "generic") throw new PortalDeny(404, "not found");
  if (principal.accounts === "*" || (Array.isArray(principal.accounts) && principal.accounts.includes(a))) return a;
  throw new PortalDeny(404, "not found");
}
