// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The portal and the connector must give one person one answer.
//
// A person reaches this product through two doors: the portal, which resolves a signed-in address with
// `makePrincipal`, and the connector, which resolves a key's person with `resolveScope`. When the two
// disagree, the same person can read on one what the other refuses, or start on one what the other
// forbids — and neither door is wrong on its own terms, which is why nothing else notices.
//
// So this drives BOTH doors over ONE grants file, person by person, and compares what each lets the
// person see and do: every company on the install, every organisation's Generic (and a Generic run filed
// under none), and starting a clearance against each. The people are the model's worked example plus the
// awkward edges. Kay is the case the doors DID disagree about before this: access to the whole install
// was honoured by the portal and refused by the connector as "an unscoped wildcard", so Kay's own key
// opened nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { makePrincipal, assertPrincipal, mayReadRun } from "../portal-access.mjs";
import { resolveScope, authorize, accountVisible, mintToken } from "../../shared/scope.mjs";

process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "test-secret-two-doors";

const GRANTS = {
  tenants: {
    northwind: { name: "Northwind", accounts: ["harbour", "quay"],
      users: { "dee@southbank.example": ["harbour"], "tam@harbour.example": ["harbour"], "typo@x.example": ["nowhere"] } },
    southbank: { name: "Southbank", accounts: [],
      users: { "pat@southbank.example": "*", "dee@southbank.example": "*", "*@southbank.example": "*" } },
  },
  people: {
    "kay@northwind.example": { run: true, manage: true, everything: true },
    "pat@southbank.example": { run: true, manage: true },
    "dee@southbank.example": { run: true },
    "*@southbank.example": { run: true },
  },
};
const COMPANIES = ["harbour", "quay", "unheld"];
const ORGS = ["northwind", "southbank", null];   // null: a Generic run filed before organisations existed
const PEOPLE = [
  "kay@northwind.example",      // everything — the case the doors disagreed about
  "pat@southbank.example",      // manages an organisation holding no company: only its Generic
  "dee@southbank.example",      // an organisation, plus one company of another
  "tam@harbour.example",        // one company, both switches off
  "anyone@southbank.example",   // a domain entry
  "someone@northwind.example",  // the everything-person's domain, with no entry of its own
  "typo@x.example",             // a row naming a company its organisation does not hold
  "stranger@nowhere.example",
];

const tries = (fn) => { try { fn(); return true; } catch { return false; } };

function doors(email) {
  const portal = makePrincipal({ email, grants: GRANTS });
  let connector = null;
  try {
    connector = resolveScope({ clientSurface: true, accountAccess: true,
      innerToken: mintToken({ scope: "account", sub: email }) });
  } catch (e) {
    if (!/^forbidden:/.test(e.message)) throw e;   // a refusal is an answer; anything else is a broken arm
  }
  return { portal, connector };
}

let dir;
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), "two-doors-"));
  writeFileSync(join(dir, "grants.json"), JSON.stringify(GRANTS));
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(dir, "grants.json"));
});
test.after(() => {
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("the table is not vacuous: both doors admit some people and refuse others", () => {
  const admitted = PEOPLE.filter((e) => doors(e).portal !== null);
  assert.ok(admitted.length >= 5, `only ${admitted.length} admitted — the comparisons below would be thin`);
  assert.ok(PEOPLE.length - admitted.length >= 2, "the refusal direction must be exercised too");
});

for (const email of PEOPLE) {
  test(`${email}: the two doors admit or refuse together, and see and start the same things`, () => {
    const { portal, connector } = doors(email);
    assert.equal(portal === null, connector === null,
      `admission: the portal ${portal ? "admits" : "refuses"} and the connector ${connector ? "admits" : "refuses"}`);
    // Refused by both is the whole answer for a person with no access: there is nothing further to see
    // or start, and the admission assertion above is what measured it.
    if (portal) {
      for (const company of COMPANIES) {
        assert.equal(tries(() => assertPrincipal(portal, { account: company })), accountVisible(connector, company),
          `seeing company ${company}`);
        assert.equal(tries(() => assertPrincipal(portal, { account: company, run: true })),
          tries(() => authorize(connector, "start_run", { markName: "X", profileKey: company })),
          `starting a clearance for ${company}`);
      }
      for (const organisation of ORGS) {
        assert.equal(mayReadRun(portal, { owner: "generic", organisation }), accountVisible(connector, "generic", organisation),
          `reading a Generic run filed under ${organisation ?? "no organisation"}`);
      }
      const orderGeneric = (organisation) => tries(() => assertPrincipal(portal, { account: "generic", tenant: organisation, run: true }));
      const portalGeneric = Object.keys(GRANTS.tenants).some(orderGeneric);
      assert.equal(portalGeneric, tries(() => authorize(connector, "start_run", { markName: "X" })), "ordering Generic");
    }
  });
}
