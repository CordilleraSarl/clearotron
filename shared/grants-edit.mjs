// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grants-edit.mjs — the changes a person makes to the grants file: give someone access, and file a new
// company under its organisation.
//
// PURE. Each function takes the parsed grants object and returns a new one; the caller reads the file,
// applies the change and writes it atomically. One function per change, shared by every writer — the
// portal's People page, its company creation and `clearotron grant` — so two writers cannot produce two
// shapes of the same fact. Every result is put through `assertGrantsShape` before it is handed back, so a
// change that would make the file one the product refuses to load is refused here, before the write.
import { assertGrantsShape } from "./scope.mjs";

const SWITCHES = ["run", "manage", "everything"];

/**
 * Give a person access. `points` are `[{ tenant, account? }]`: a whole organisation, or one company that
 * organisation holds. Points are ADDED; nothing the person already holds is removed, and a company point
 * inside an organisation they already hold whole is already covered.
 *
 * `switches` (`{ run, manage, everything }`) replace the person's entry under `people` when
 * `setSwitches` is true. A caller that may not change them — the person's access reaches beyond the
 * caller's own — passes false, and the entry is left exactly as it was.
 */
export function withPerson(grants, { email, points = [], switches = {}, setSwitches = true }) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e || e.indexOf("@") <= 0 || e.indexOf("@") !== e.lastIndexOf("@"))
    throw new Error(`"${email}" is not one email address`);
  const g = structuredClone(grants ?? { tenants: {} });
  g.tenants ??= {};
  for (const { tenant, account = null } of points) {
    const t = g.tenants[tenant];
    if (!t) throw new Error(`there is no organisation "${tenant}"`);
    t.users = { ...(t.users ?? {}) };
    if (account == null) { t.users[e] = "*"; continue; }
    if (!(Array.isArray(t.accounts) ? t.accounts : []).includes(account))
      throw new Error(`organisation "${tenant}" does not hold "${account}"`);
    const held = t.users[e];
    if (held === "*") continue;
    t.users[e] = [...new Set([...(Array.isArray(held) ? held : []), account])];
  }
  if (setSwitches) {
    const entry = { run: switches.run === true, manage: switches.manage === true };
    if (switches.everything === true) entry.everything = true;
    g.people = { ...(g.people ?? {}), [e]: entry };
  }
  assertGrantsShape(g, "the grants file after this change");
  return g;
}

/** File a company under the organisation that holds it. A company belongs to exactly one organisation. */
export function withCompany(grants, { tenant, account }) {
  const g = structuredClone(grants ?? { tenants: {} });
  const t = g.tenants?.[tenant];
  if (!t) throw new Error(`there is no organisation "${tenant}"`);
  t.accounts = [...new Set([...(Array.isArray(t.accounts) ? t.accounts : []), account])];
  assertGrantsShape(g, "the grants file after this change");
  return g;
}

/**
 * Add an organisation. Its key is derived from the name — lowercase, hyphenated — and must not collide
 * with one that exists. Returns `{ grants, key }`.
 */
export function withOrganisation(grants, { name }) {
  const n = String(name ?? "").trim();
  if (!n) throw new Error("an organisation needs a name");
  const key = n.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "organisation";
  const g = structuredClone(grants ?? { tenants: {} });
  g.tenants ??= {};
  if (g.tenants[key]) throw new Error(`there is already an organisation "${key}"`);
  g.tenants[key] = { name: n, accounts: [], users: {} };
  assertGrantsShape(g, "the grants file after this change");
  return { grants: g, key };
}

export { SWITCHES };
