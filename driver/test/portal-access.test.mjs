// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Who a signed-in identity turns out to be, and what they may do.
//
// makePrincipal is the inner authorization boundary: the sign-in door proves WHO, this decides WHAT THEY
// SEE AND MAY DO. The tests are written as breaches — each names something that must not happen — plus
// the model's own worked example, read back person by person, so a change to the model shows up here as
// a named person seeing something they should not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makePrincipal, assertPrincipal, genericOrgOf, seesEverything, mayRun, mayManage } from "../portal-access.mjs";

// The worked example: two organisations, one company, four people. Kay has access to everything; Pat runs
// and manages Southbank; Dee runs, in Southbank and in Northwind's company Harbour; Tam views Harbour and
// can start nothing. `generic` sits in Northwind's list the way a live file carried it — it is not a
// company, and nothing may treat it as one.
const grants = {
  tenants: {
    northwind: { name: "Northwind", accounts: ["generic", "harbour"],
      users: { "dee@southbank.example": ["harbour"], "tam@harbour.example": ["harbour"] } },
    southbank: { name: "Southbank", accounts: [],
      users: { "pat@southbank.example": "*", "dee@southbank.example": "*" } },
  },
  people: {
    "kay@northwind.example": { run: true, manage: true, everything: true },
    "pat@southbank.example": { run: true, manage: true },
    "dee@southbank.example": { run: true },
  },
};
const who = (email, g = grants) => makePrincipal({ email, grants: g });

test("the worked example resolves person by person as the model states it", () => {
  const kay = who("kay@northwind.example");
  assert.ok(seesEverything(kay) && mayRun(kay) && mayManage(kay));
  assert.deepEqual(kay.access, [{ kind: "everything" }]);
  assert.equal(kay.accounts, "*");
  assert.deepEqual(kay.genericOrgs, ["northwind", "southbank"], "both organisations' Generics");

  const pat = who("pat@southbank.example");
  assert.ok(!seesEverything(pat) && mayRun(pat) && mayManage(pat));
  assert.deepEqual(pat.access, [{ kind: "organisation", key: "southbank" }]);
  assert.deepEqual(pat.accounts, [], "Southbank holds no company yet");
  assert.deepEqual(pat.organisations, ["southbank"], "never Northwind, and never Harbour");

  const dee = who("dee@southbank.example");
  assert.ok(mayRun(dee) && !mayManage(dee));
  assert.deepEqual(dee.access, [{ kind: "organisation", key: "southbank" }, { kind: "company", key: "harbour", org: "northwind" }]);
  assert.deepEqual(dee.accounts, ["harbour"]);
  assert.deepEqual(dee.organisations, ["southbank", "northwind"], "Harbour's heading needs Northwind's name");
  assert.deepEqual(dee.genericOrgs, ["southbank"], "a company-level point never reaches its organisation's Generic");
  assert.deepEqual(dee.accountOrgs, { harbour: "northwind" });

  const tam = who("tam@harbour.example");
  assert.ok(!mayRun(tam) && !mayManage(tam), "no entry under people: both switches off");
  assert.deepEqual(tam.accounts, ["harbour"]);
});

test("a company-level point never reaches that organisation's Generic", () => {
  const dee = who("dee@southbank.example");
  assert.throws(() => assertPrincipal(dee, { account: "generic", tenant: "northwind" }), (e) => e.status === 404);
  assert.equal(assertPrincipal(dee, { account: "generic", tenant: "southbank" }), "generic");
  assert.equal(genericOrgOf(dee, null), "southbank", "the one organisation whose Generic Dee sees is implied");
  assert.throws(() => assertPrincipal(who("tam@harbour.example"), { account: "generic" }), (e) => e.status === 404,
    "Tam sees no Generic at all");
});

test("no staff by domain: an address shares nothing with a colleague's entry", () => {
  // The rule this model deleted admitted everyone after the `@`. Kay sees everything; a second address on
  // Kay's domain, with no entry of its own, gets no principal at all.
  assert.equal(who("someone@northwind.example"), null);
});

test("a domain entry never holds Manage or everything, even in grants that skipped the shape check", () => {
  const g = { tenants: { t: { accounts: ["harbour"], users: { "*@wide.example": "*" } } },
    people: { "*@wide.example": { run: true, manage: true, everything: true } } };
  const p = who("anyone@wide.example", g);
  assert.ok(!seesEverything(p) && !mayManage(p), "a domain-wide Manage is the deleted staff rule by another name");
  assert.ok(mayRun(p), "Run on a domain entry is honoured");
  // An exact entry wins over the domain's.
  const g2 = { ...g, people: { "*@wide.example": { run: true }, "one@wide.example": { run: false } } };
  assert.ok(!mayRun(who("one@wide.example", g2)));
});

test("a row naming a company its own organisation does not hold grants nothing", () => {
  // Harbour belongs to Northwind. A Southbank row naming it has no place in the tree.
  const g = { tenants: { northwind: { accounts: ["harbour"] }, southbank: { accounts: [], users: { "x@y.example": ["harbour"] } } } };
  assert.equal(who("x@y.example", g), null);
});

test("Generic is never offered as a company, and is ordered by whoever holds its organisation whole with Run", () => {
  // Ruling 2026-09-10: Generic is capped like any company, per organisation, so ordering it follows
  // the rule for seeing it. The cap itself is the runner's (each-organisations-generic-carries-the-daily-cap).
  const pat = who("pat@southbank.example");
  assert.ok(!pat.accounts.includes("generic"));
  assert.equal(assertPrincipal(pat, { account: "generic", tenant: "southbank", run: true }), "generic", "Pat orders Southbank's Generic");
  assert.equal(assertPrincipal(pat, { account: " GENERIC ", run: true }), "generic", "case and padding normalise, and one organisation is implied");
  assert.throws(() => assertPrincipal(pat, { account: "generic", tenant: "northwind", run: true }), (e) => e.status === 404,
    "never another organisation's");
  assert.throws(() => assertPrincipal(who("dee@southbank.example"), { account: "generic", tenant: "northwind", run: true }),
    (e) => e.status === 404, "a company-level point never orders its organisation's Generic");
  assert.throws(() => assertPrincipal(who("tam@harbour.example"), { account: "generic", run: true }), (e) => e.status === 404,
    "and a person without Run orders nothing");
  assert.equal(assertPrincipal(who("kay@northwind.example"), { account: "generic", tenant: "southbank", run: true }), "generic");
});

test("every company a person IS offered actually resolves", () => {
  // Menu and routes must agree, over the whole list rather than a chosen example.
  const dee = who("dee@southbank.example");
  for (const account of dee.accounts) assert.equal(assertPrincipal(dee, { account }), account, `${account} resolves`);
  assert.throws(() => assertPrincipal(who("pat@southbank.example"), { account: "harbour" }), (e) => e.status === 404,
    "a company outside the person's access is a 404, never a 403");
});

test("the permission gates refuse with 404, and the view-only person still views", () => {
  const tam = who("tam@harbour.example");
  assert.equal(assertPrincipal(tam, { account: null }), "harbour", "the single company is implied");
  assert.throws(() => assertPrincipal(tam, { account: "harbour", run: true }), (e) => e.status === 404);
  assert.throws(() => assertPrincipal(tam, { door: true, manage: true }), (e) => e.status === 404);
  assert.throws(() => assertPrincipal(who("pat@southbank.example"), { door: true, everything: true }), (e) => e.status === 404);
  assert.equal(assertPrincipal(who("kay@northwind.example"), { door: true, everything: true, manage: true }), null);
});

test("a person who sees everything names an account for scoped routes, and Generic unnamed is unfiled", () => {
  const kay = who("kay@northwind.example");
  assert.equal(assertPrincipal(kay, { account: null }), null, "the caller decides the list-all view");
  assert.equal(genericOrgOf(kay, null), null, "several organisations and none named: filed under none, as before");
  assert.throws(() => assertPrincipal(who("pat@southbank.example"), { account: null }), (e) => e.status === 400);
});

test("an unconverted `staffOnly` gate fails loudly rather than being ignored", () => {
  assert.throws(() => assertPrincipal(who("kay@northwind.example"), { staffOnly: true }), TypeError);
});

test("a wildcard organisation is refused by name", () => {
  assert.throws(() => who("a@b.example", { tenants: { t: { accounts: "*", users: { "a@b.example": "*" } } } }),
    /a company belongs to exactly one organisation/);
});

test("an unknown identity gets no principal, and a multi-@ identity is refused rather than parsed", () => {
  assert.equal(who("stranger@example.com"), null);
  assert.equal(who("kay@northwind.example@evil.com"), null);
  assert.equal(makePrincipal({ email: "kay@northwind.example", grants: null }), null, "no grants file: nobody");
});
