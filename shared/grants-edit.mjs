// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grants-edit.mjs — the changes a person makes to the grants file: give someone access, take access
// away, and file a new company under its organisation.
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

/**
 * What a person holds now, read straight out of the file: `{ points, switches, listed }`.
 *
 * The form that changes somebody has to open filled in, and "filled in" means the file's own answer, not
 * the page's copy of it. `points` are the same `[{ tenant, account }]` shape `withPerson` takes, so a
 * caller can diff what it was handed against what is there and hand each half to the right function.
 *
 * ADDRESSES ARE MATCHED WITHOUT REGARD TO CASE, in both places a person can appear. Every writer in this
 * module lowercases on the way in, but the grants file is one an operator edits by hand, and a file
 * holding `Dana@x.example` under `people` and `dana@x.example` under a tenant is a file this product
 * loads and serves. A reader that matched exactly would report half of such a person and miss the half
 * carrying their permissions.
 */
export function personPoints(grants, email) {
  const e = String(email ?? "").trim().toLowerCase();
  const g = grants ?? {};
  const points = [];
  for (const [tenant, t] of Object.entries(g.tenants ?? {})) {
    const key = Object.keys(t?.users ?? {}).find((k) => String(k).toLowerCase() === e);
    if (key === undefined) continue;
    const held = t.users[key];
    if (held === "*") { points.push({ tenant, account: null }); continue; }
    for (const account of Array.isArray(held) ? held : []) points.push({ tenant, account });
  }
  const entry = Object.entries(g.people ?? {}).find(([k]) => String(k).toLowerCase() === e)?.[1];
  return {
    points,
    switches: { run: entry?.run === true, manage: entry?.manage === true, everything: entry?.everything === true },
    listed: entry !== undefined,
  };
}

/**
 * Take access away — the other half of `withPerson`, and deliberately its neighbour: one file decides what
 * a person IS, so the page and `clearotron grant` cannot drift into two answers.
 *
 * Two shapes, and the difference is the whole of the safety here.
 *
 * `all: true` removes the person from the install: every tenant's guest list AND their entry under
 * `people`, which is where their permissions and any access to everything live.
 *
 * `points` NARROWS instead, and never touches `people`. That restraint is the point: a manager who holds
 * one organisation can see only that organisation's half of somebody, so a narrowing they order must not
 * reach an entry they cannot read. It also means a narrowing CANNOT be honest about a person who holds
 * everything — that access does not live in any tenant, so striking tenant rows would leave them seeing
 * exactly what they saw before, under a sentence saying otherwise. That case is refused rather than
 * warned about: a warning printed after the write is read by whoever is already looking.
 *
 * A company inside an organisation the person holds WHOLE is refused too. `"*"` means "this organisation,
 * including companies added later", and the nearest expressible narrowing — today's list of companies,
 * minus one — is a different grant wearing the same shape. The caller offers the organisation instead.
 */
export function withoutPerson(grants, { email, points = [], all = false }) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e) throw new Error("removing access needs an email address");
  const g = structuredClone(grants ?? { tenants: {} });
  g.tenants ??= {};
  const held = personPoints(g, e);
  if (!all && !points.length) throw new Error("nothing was named to take away");
  if (!all && held.switches.everything)
    throw new Error(`${e} has access to everything on this install, which is not held in any organisation`
      + " — taking away one organisation would change nothing they can see. Remove them from the install instead.");

  const userKeyIn = (t) => Object.keys(t?.users ?? {}).find((k) => String(k).toLowerCase() === e);

  if (all) {
    for (const t of Object.values(g.tenants)) {
      const key = userKeyIn(t);
      // AN EMPTY `users` MAP IS NOT A DELETED TENANT. The organisation still exists and still holds its
      // companies; it simply has nobody on its guest list.
      if (key !== undefined) { t.users = { ...t.users }; delete t.users[key]; }
    }
    const peopleKey = Object.keys(g.people ?? {}).find((k) => String(k).toLowerCase() === e);
    if (peopleKey !== undefined) { g.people = { ...g.people }; delete g.people[peopleKey]; }
    assertGrantsShape(g, "the grants file after this change");
    return g;
  }

  for (const { tenant, account = null } of points) {
    const t = g.tenants[tenant];
    if (!t) throw new Error(`there is no organisation "${tenant}"`);
    const key = userKeyIn(t);
    if (key === undefined) continue;
    const have = t.users[key];
    t.users = { ...t.users };
    if (account == null) { delete t.users[key]; continue; }
    if (have === "*")
      throw new Error(`${e} holds the whole of "${tenant}", including companies added to it later,`
        + ` so "${account}" cannot be taken away on its own. Take away the organisation instead.`);
    const left = (Array.isArray(have) ? have : []).filter((a) => a !== account);
    if (left.length) t.users[key] = left;
    else delete t.users[key];
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
