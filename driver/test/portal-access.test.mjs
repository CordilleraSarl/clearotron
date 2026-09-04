// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Who a signed-in identity turns out to be.
//
// makePrincipal is the inner authorization boundary: the edge proves WHO, this decides WHAT THEY SEE.
// The tests are written as breaches — each names something that must not happen — plus one that is not
// a breach at all but was the actual live defect: an account offered in the menu that every route
// refuses. A control that says no correctly is still a bug when the interface invites the request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makePrincipal, assertPrincipal } from "../portal-access.mjs";

// The grants shape is copied from the live enrolment file, not invented: a tenant carries `accounts`
// and a `users` map of address → "*" (meaning the whole tenant) or an explicit subset. The first tenant
// below reproduces a real production row — its address changed, its ACCOUNT LIST kept verbatim with
// `generic` first, which is the arrangement that produced the defect. The list is the load-bearing
// part; the tenant's real name was not, so it is named for its shape like its two siblings here.
const grants = {
  tenants: {
    "multi-account": {
      accounts: ["generic", "zephyr", "aurora", "petcary"],
      users: { "client@example.com": "*" },
    },
    "one-account": { accounts: ["zephyr"], users: { "solo@example.com": "*" } },
    "generic-only": { accounts: ["generic"], users: { "nothing@example.com": "*" } },
  },
};
const STAFF = ["staff.example"];
const principal = (email) => makePrincipal({ email, grants, staffDomains: STAFF });

test("THE OFFERED ACCOUNT: a client is never handed `generic`, which every route refuses", () => {
  // The live defect. A tenant-wide grant expands to the full roster; `generic` is in the roster and
  // sorts first; so the picker showed it at the top, the sidebar named it as the client's own account,
  // and choosing it produced "The list could not be loaded" every single time.
  const p = principal("client@example.com");
  assert.equal(p.role, "client");
  assert.ok(!p.accounts.includes("generic"), "generic is not offered");
  assert.deepEqual(p.accounts, ["zephyr", "aurora", "petcary"], "the granted accounts survive, in order");

  // and the refusal is still in force — this fix removes the invitation, not the control
  assert.throws(() => assertPrincipal(p, { account: "generic" }), (e) => e.status === 404);
});

test("every account a client IS offered actually resolves", () => {
  // The property that was broken: menu and routes must agree. Asserted over the whole list rather than
  // a chosen example, so adding a roster entry cannot quietly reintroduce a dead menu item.
  const p = principal("client@example.com");
  for (const account of p.accounts) {
    assert.equal(assertPrincipal(p, { account }), account, `${account} resolves`);
  }
});

test("a client granted NOTHING but generic gets no portal at all", () => {
  // Not an empty portal — no principal. An account list of [] would have meant "signed in, sees
  // nothing", and every screen would have had to invent its own explanation for that.
  assert.equal(principal("nothing@example.com"), null);
});

test("a client with one account still resolves it without naming it", () => {
  const p = principal("solo@example.com");
  assert.deepEqual(p.accounts, ["zephyr"]);
  assert.equal(assertPrincipal(p, { account: null }), "zephyr", "the single account is implied");
});

test("staff keep the roster, generic included — it is theirs", () => {
  // The filter is a CLIENT rule. Untagged runs live under generic and staff are the ones who triage
  // them; removing it for staff would hide real work.
  const p = makePrincipal({ email: "lawyer@staff.example", grants, staffDomains: STAFF });
  assert.equal(p.role, "staff");
  assert.equal(p.accounts, "*");
  assert.equal(assertPrincipal(p, { account: "generic" }), "generic");
});

test("a tenant-wide '*' grant stays a client, and stays '*'", () => {
  // '*' is not expanded here — scope.mjs owns that. What matters is that the role does not drift to
  // staff just because the reach is wide: a client with every account still has no staff surfaces.
  const wide = { tenants: { all: { accounts: "*", users: { "wide@example.com": "*" } } } };
  const p = makePrincipal({ email: "wide@example.com", grants: wide, staffDomains: STAFF });
  assert.equal(p.role, "client");
  assert.equal(p.accounts, "*");
});

test("a tenant-wide '*' client is STILL refused generic — the spend path had no guard of its own", () => {
  // The hole this closes: makePrincipal's generic filter runs on the ARRAY branch only, so a grant
  // resolving to the literal "*" reached assertPrincipal untouched and the wildcard test admitted
  // `generic`. Three routes carried their own role check; POST /portal/api/run and /run/plan did not —
  // so the only path that spends money was the only one unguarded, against the one account that is
  // exempt from the daily run cap. Asserted at the chokepoint, which is where every route inherits it.
  const wide = { tenants: { all: { accounts: "*", users: { "wide@example.com": "*" } } } };
  const p = makePrincipal({ email: "wide@example.com", grants: wide, staffDomains: STAFF });
  assert.equal(p.accounts, "*", "precondition: this is the wildcard shape, not an array");
  assert.equal(assertPrincipal(p, { account: "zephyr" }), "zephyr", "a wildcard grant still reaches a named account");
  assert.throws(() => assertPrincipal(p, { account: "generic" }), (e) => e.status === 404,
    "and never the house account");
  // Case and padding are normalised before the check, so the refusal cannot be stepped around.
  assert.throws(() => assertPrincipal(p, { account: " GENERIC " }), (e) => e.status === 404);
});

test("an unknown identity gets no principal", () => {
  assert.equal(principal("stranger@example.com"), null);
});

test("a multi-@ identity is refused outright rather than parsed", () => {
  // The edge and this module must never disagree about which domain an address belongs to.
  assert.equal(makePrincipal({ email: "x@staff.example@evil.com", grants, staffDomains: STAFF }), null);
});
