// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// -6 — the RESEARCH credential refuses BEFORE the spend, and only for the products whose answer is
// not severable without it.
//
// The defect this closes is not a wrong answer, it is a paid one: a clearance with no PERPLEXITY_API_KEY
// used to run every register stage, reach the common-law grid, and get an ERROR string back per call
// (perplexity-server.mjs:149 — `if (!API_KEY) return "ERROR: PERPLEXITY_API_KEY not set`). The
// failure was correct and the spend before it was avoidable.
//
// WHAT IS EASY TO GET WRONG HERE, and what most of this file is about: the refusal must NOT be gated on
// `pipeline === "clearance"`. `prelim-register-only` is a clearance that carries `commonLawGrid: false`
// and reads no research credential at all — refusing it would break a working lane in the expensive
// direction, and it would look right. The component is the predicate. Both directions are asserted
// below, and a knockout is asserted NOT refused because acceptance 6 ruled that lane the other way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightResearchCredential, RESEARCH_PROVIDERS } from "../driver.config.mjs";
import { policyFor, ORDERABLE_PRODUCTS } from "../search-policy.mjs";

// A value no other token in this file, or in the adapter's own label, can collide with. A short
// sentinel ("x") once passed a no-leak assertion because the letter appears in "Perplexity" — the
// assertion held for the wrong reason. Distinctive on purpose.
const SECRET = "pplx-NOT-A-REAL-KEY-8b3f1d6a2c9e4407";
const withKey = { PERPLEXITY_API_KEY: SECRET };
const noKey = {};

const grid = (p) => policyFor(p)?.components?.commonLawGrid === true;

test("#1149-6 every orderable product carrying commonLawGrid refuses without the credential", () => {
  const carriers = ORDERABLE_PRODUCTS.filter(grid);
  assert.ok(carriers.length >= 3,
    `expected the three clearance searches to carry commonLawGrid, found ${carriers.length}: ${carriers.join(", ")}`);
  for (const product of carriers) {
    assert.throws(() => preflightResearchCredential(policyFor(product), noKey),
      /PERPLEXITY_API_KEY/,
      `${product} carries commonLawGrid and must refuse before spending`);
  }
});

test("#1149-6 a knockout is NOT refused — #1223 acceptance 6 ruled that lane skips and discloses", () => {
  for (const product of ORDERABLE_PRODUCTS.filter((p) => policyFor(p)?.pipeline === "knockout")) {
    const r = preflightResearchCredential(policyFor(product), noKey);
    assert.equal(r.checked, false, `${product} must not be refused for a credential its lane never reads`);
  }
});

// THE EXPENSIVE-DIRECTION CASE. A register-only clearance is a clearance, so the obvious predicate
// (`pipeline === "clearance"`) refuses it — for a credential it never reads, on a lane that works today.
test("#1149-6 a register-only clearance is NOT refused, though its pipeline is clearance", () => {
  const policy = policyFor("prelim-register-only");
  assert.equal(policy?.pipeline, "clearance", "fixture check: this row is a clearance");
  assert.equal(policy?.components?.commonLawGrid, false, "fixture check: and it carries no grid");
  const r = preflightResearchCredential(policy, noKey);
  assert.equal(r.checked, false, "gating on the pipeline instead of the component would refuse this");
});

// THE RESUME CASE. `policyFor` answers from RETIRED_POLICIES too, so an archived Depth 4 / Depth 5
// re-entering the pipeline is caught here rather than falling through to the old late failure.
test("#1149-6 a RETIRED product carrying the grid is still refused — resumes reach this door", () => {
  for (const product of ["prelim", "prelim-jx"]) {
    const policy = policyFor(product);
    assert.ok(policy, `fixture check: ${product} is still answerable as a retired row`);
    assert.equal(policy.components.commonLawGrid, true, `fixture check: ${product} carries the grid`);
    assert.throws(() => preflightResearchCredential(policy, noKey), /PERPLEXITY_API_KEY/,
      `a resumed ${product} must refuse before spending, exactly as its live successor does`);
  }
});

test("#1149-6 the credential present ⇒ no refusal, and the door says it checked", () => {
  const r = preflightResearchCredential(policyFor("full-country-search"), withKey);
  assert.equal(r.checked, true);
  assert.deepEqual(r.missing, []);
});

// AN UNKNOWN PRODUCT IS AN UNKNOWN, NOT A CLEARANCE. This door may only ever move a failure earlier;
// inventing one for a product this build cannot name would be a new failure.
test("#1149-6 an unresolvable or absent policy does not fire the door", () => {
  for (const policy of [null, undefined, {}, { components: {} }, policyFor("no-such-product")])
    assert.equal(preflightResearchCredential(policy, noKey).checked, false);
});

// A `false` here would read as "checked and passed". The door states that it did not apply.
test("#1149-6 not-applicable is STATED, and names the component it keyed on", () => {
  const r = preflightResearchCredential(policyFor("knockout-search"), noKey);
  assert.equal(r.checked, false);
  assert.equal(r.component, "commonLawGrid");
  assert.equal(r.credEnv, null, "no credential was consulted, so none is claimed");
});

// The literal is what makes a check a HALF check the day a second variable arrives (,). The
// door must read the adapter's own credEnv.
test("#1149-6 the variable comes from the adapter, not a literal in the door", () => {
  const r = preflightResearchCredential(policyFor("full-country-search"), withKey);
  assert.equal(r.credEnv, RESEARCH_PROVIDERS.perplexity.credEnv);
});

test("#1149-6 the refusal names the variable and never prints its value", () => {
  const msg = (() => {
    try { preflightResearchCredential(policyFor("global-preliminary-search"), noKey); return ""; }
    catch (e) { return String(e.message); }
  })();
  assert.match(msg, /PERPLEXITY_API_KEY/);
  assert.match(msg, /global-preliminary-search/, "the refusal names the product it refused");
  assert.ok(!msg.includes(SECRET), "a refusal must never carry a credential value");
  assert.match(msg, /Knockout/, "and it points at the lane that does NOT need the key");
});

// The env it was HANDED, never the ambient one — preflightCredentials' own lesson, applied here
// before this door can repeat it.
test("#1149-6 the door reads the env it was handed, not process.env", () => {
  const had = process.env.PERPLEXITY_API_KEY;
  process.env.PERPLEXITY_API_KEY = SECRET;
  try {
    assert.throws(() => preflightResearchCredential(policyFor("full-country-search"), noKey),
      /PERPLEXITY_API_KEY/, "an ambient key must not satisfy a check on a candidate env");
  } finally {
    if (had === undefined) delete process.env.PERPLEXITY_API_KEY; else process.env.PERPLEXITY_API_KEY = had;
  }
});

// Whitespace is not a credential. `missingCredentials` trims, and this door inherits that by using it.
test("#1149-6 a whitespace-only credential is missing", () => {
  assert.throws(() => preflightResearchCredential(policyFor("full-country-search"), { PERPLEXITY_API_KEY: "   " }),
    /PERPLEXITY_API_KEY/);
});
