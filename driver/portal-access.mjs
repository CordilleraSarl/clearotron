// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-access.mjs — identity → principal for the unified portal. The INNER authorization boundary:
// the sign-in door proves WHO; this module decides WHAT THEY SEE AND MAY DO. Pure decisions over the
// grants object — fail-closed at every edge: an unmapped identity gets NO principal (403 at the door), a
// request outside the person's access resolves to 404 semantics (never 403 — existence must not leak),
// and the grants substrate is the SAME file the connector reads (`CLEAROTRON_ACCESS_FILE`), resolved by
// the SAME function (`resolvePerson`, shared/scope.mjs), so the two doors cannot disagree about a person.
// Shape and semantics: INSTALL.md §8; examples/grants.example.json.
import { resolvePerson } from "../shared/scope.mjs";

/**
 * makePrincipal({ email, grants }) → the person, or null when the address has no access anywhere.
 *
 *   { email, everything, permissions: { run, manage }, access, accounts, organisations, genericOrgs, accountOrgs }
 *
 * There is no role. What a person may SEE is their access; what they may DO is two switches, asked by
 * name through `seesEverything`, `mayRun` and `mayManage` below and never through a role word. Nothing
 * about the part of an address after its `@` admits anyone: the staff-by-domain branch is deleted, and an
 * address is admitted by its own entry in the grants file.
 *
 * `generic` is never in `accounts`. It is not a company: each organisation has its own, it is addressed as
 * the pair (`account=generic`, `tenant=<organisation>`), and `genericOrgOf` decides it.
 */
export function makePrincipal({ email, grants = null }) {
  return resolvePerson(email, grants);
}

/** Access to the top of the tree: every organisation, every company, every person. */
export const seesEverything = (p) => p?.everything === true;
/** Run clearances: start and stop them, inside the person's access. */
export const mayRun = (p) => p?.permissions?.run === true;
/** Manage: add people, add companies, change settings, inside the person's access. */
export const mayManage = (p) => p?.permissions?.manage === true;

/** An organisation's display name: its `name` in the grants file, else its key. */
export function organisationName(grants, key) {
  const n = grants?.tenants?.[key]?.name;
  return typeof n === "string" && n.trim() ? n.trim() : key;
}

/** An access point as the portal shows it: names attached, keys kept. `everything` carries no key. */
export function namedPoint(p, grants, companyNames = {}) {
  if (p.kind === "everything") return { kind: "everything" };
  if (p.kind === "organisation") return { kind: "organisation", key: p.key, name: organisationName(grants, p.key) };
  return { kind: "company", key: p.key, name: companyNames[p.key] ?? p.key, org: p.org };
}

/**
 * What `/portal/api/me` says about a person's reach and switches — the fields the screens read, so no
 * screen derives a visibility rule of its own. `organisations` is every organisation the person sees
 * anything in (a company's heading needs its organisation's name); `genericOrgs` is the ones whose
 * Generic they see.
 */
export function principalView(principal, grants, companyNames = {}) {
  return {
    permissions: { run: mayRun(principal), manage: mayManage(principal) },
    access: (principal.access ?? []).map((p) => namedPoint(p, grants, companyNames)),
    organisations: (principal.organisations ?? []).map((key) => ({ key, name: organisationName(grants, key) })),
    accountOrgs: { ...(principal.accountOrgs ?? {}) },
    genericOrgs: [...(principal.genericOrgs ?? [])],
  };
}

/**
 * May this person read a run, given who it belongs to? The ONE answer for every run-scoped route: the
 * listing, the report, the summary, the feedback form. `owner` is the run's company key (`generic` when it
 * had none); `organisation` is the organisation a Generic run was filed under, null for one filed before
 * organisations existed.
 *
 * A company's run: the company must be inside the person's access. A Generic run: the person must see
 * that organisation's Generic — and an unfiled one is visible only to a person who sees everything, which
 * is exactly who could read it before.
 */
export function mayReadRun(principal, { owner, organisation = null }) {
  if (!principal) return false;
  if (owner !== "generic") return principal.accounts === "*" || (Array.isArray(principal.accounts) && principal.accounts.includes(owner));
  if (seesEverything(principal)) return true;
  return organisation != null && Array.isArray(principal.genericOrgs) && principal.genericOrgs.includes(organisation);
}

/**
 * Does everything `other` holds sit inside `viewer`'s reach? Switches belong to the person, not to an
 * access point, so a manager may set someone's switches only when that person's whole access is inside
 * the manager's own — otherwise changing them would change what the person may do somewhere the manager
 * cannot see.
 */
export function reachCovers(viewer, other) {
  if (seesEverything(viewer)) return true;
  if (!other || seesEverything(other)) return false;
  const orgs = viewer?.genericOrgs ?? [];
  const companies = Array.isArray(viewer?.accounts) ? viewer.accounts : [];
  return (other.access ?? []).every((p) => p.kind === "organisation" ? orgs.includes(p.key)
    : p.kind === "company" ? orgs.includes(p.org) || companies.includes(p.key) : false);
}

export class PortalDeny extends Error {
  constructor(status, message) { super(message); this.name = "PortalDeny"; this.status = status; }
}

/**
 * Which organisation's Generic a request means — the organisation key, or null.
 *
 *   named       it must be one whose Generic this person sees (`genericOrgs`), else 404;
 *   unnamed     the one organisation whose Generic they see, when there is exactly one;
 *   unnamed, for a person who sees everything and several organisations (or none): null — Generic filed
 *               under no organisation, which is how every Generic run was filed before organisations
 *               existed, and only a person who sees everything sees those runs;
 *   otherwise   404 when they see no Generic at all, 400 naming the field when they see several.
 */
export function genericOrgOf(principal, tenant = null) {
  const t = tenant == null || String(tenant).trim() === "" ? null : String(tenant).trim();
  const orgs = Array.isArray(principal?.genericOrgs) ? principal.genericOrgs : [];
  if (t != null) {
    if (orgs.includes(t)) return t;
    throw new PortalDeny(404, "not found");
  }
  if (orgs.length === 1) return orgs[0];
  if (seesEverything(principal)) return null;
  if (!orgs.length) throw new PortalDeny(404, "not found");
  throw new PortalDeny(400, "name an organisation (?tenant=) — Generic belongs to an organisation, and this login sees several");
}

/**
 * The ONE chokepoint every account-scoped route passes. Resolves the EFFECTIVE account for a request:
 *   - a person who sees everything: any account — but an account-scoped route must still NAME one (no
 *     accidental install-wide writes); unnamed resolves to null and the caller decides (list-all views);
 *   - anyone else: the named account must be inside their access — a foreign account is a 404, never a
 *     403, because existence never leaks; unnamed defaults to their only company, or is a 400 when there
 *     are several or none;
 *   - `generic` is the pair, and `genericOrgOf` decides it here rather than per route.
 *
 * The gates — `everything` for install-wide surfaces, `manage`, `run` — each refuse with 404: the surface
 * does not exist for this person, and a refusal that told "you may not" apart from "there is nothing
 * here" would tell a stranger which endpoints exist.
 *
 * ORDERING GENERIC STAYS WITH A PERSON WHO SEES EVERYTHING, and it is refused here rather than per route.
 * Generic is exempt from the daily run cap (runner.mjs: it is the neutral no-customer profile), so a
 * `run` against it is uncapped spend. Seeing an organisation's Generic is the model's rule; spending
 * against it without a cap is not decided yet, and until it is, the chokepoint keeps it where it was.
 * Refusing here covers every spending route at once, including the ones nobody has written yet.
 */
export function assertPrincipal(principal, { account = null, tenant = null, door = false,
  everything = false, manage = false, run = false, ...rest } = {}) {
  if ("staffOnly" in rest) throw new TypeError("assertPrincipal: `staffOnly` is gone — gate on `everything`, `manage` or `run`");
  if (!principal) throw new PortalDeny(403, "no portal access for this identity");
  if (everything && !seesEverything(principal)) throw new PortalDeny(404, "not found");
  if (manage && !mayManage(principal)) throw new PortalDeny(404, "not found");
  if (run && !mayRun(principal)) throw new PortalDeny(404, "not found");
  // door mode: the caller only needs "may this identity enter" — NEVER resolve an account (a
  // multi-account person must not 404 off the front door; review 2026-07-18)
  if (door) return null;
  if (account == null) {
    if (principal.accounts === "*") return null;
    if (Array.isArray(principal.accounts) && principal.accounts.length === 1) return principal.accounts[0];
    throw new PortalDeny(400, principal.accounts?.length
      ? "name an account (?account=) — this login covers several"
      : "name an account (?account=) — this login holds no company of its own, only its organisation's Generic");
  }
  const a = String(account).trim().toLowerCase();
  if (a === "generic") {
    genericOrgOf(principal, tenant);
    if (run && !seesEverything(principal)) throw new PortalDeny(404, "not found");
    return a;
  }
  if (principal.accounts === "*" || (Array.isArray(principal.accounts) && principal.accounts.includes(a))) return a;
  throw new PortalDeny(404, "not found");
}
