// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Taking access away, and reading what somebody holds — the other half of `withPerson`.
//
// Both faces that change the guest list go through these two functions: the portal's People page and
// `clearotron grant`. Before they existed the command deleted the keys itself, and the two paths had
// already drifted in a way nothing reported — `people` was matched without regard to case and the
// organisations' guest lists were matched exactly, so a file holding one spelling in one place and
// another in the other lost half a person per removal and said it had removed them.
//
// The refusals are the substance here, not the deletions. Each one is a narrowing the FILE cannot
// express, where the nearest thing it can express would be a different grant reported under the first
// one's sentence — so the shape of the failure is "nothing written, and why", never "close enough".

import { test } from "node:test";
import assert from "node:assert/strict";
import { personPoints, withoutPerson, withPerson } from "../../shared/grants-edit.mjs";

/**
 * Two organisations, four people, and every shape a person can take in this file: a whole organisation
 * (`"*"`), a list of companies, an entry under `people` with no organisation row at all, and — the one
 * that matters — an address spelled with capitals in one place and without them in the other.
 */
const FILE = () => ({
  tenants: {
    anthropic: { name: "Anthropic", accounts: ["anthropic-eu", "anthropic-us"],
      users: { "dana@anthropic.example": "*", "priya@anthropic.example": ["anthropic-eu"] } },
    cordillera: { name: "Cordillera", accounts: ["clawdi", "ridge"],
      users: { "dana@anthropic.example": ["clawdi"], "Tom@Outside.example": ["ridge"] } },
  },
  people: {
    "dana@anthropic.example": { run: true, manage: false },
    "priya@anthropic.example": { run: true, manage: true },
    "krzys@cordillera.example": { run: true, manage: true, everything: true },
    "tom@outside.example": { run: false, manage: false },
  },
});

const pointsOf = (g, e) => personPoints(g, e).points.map((p) => `${p.tenant}/${p.account ?? "*"}`).sort();

test("personPoints reads every shape a person can take, and the population is not empty", () => {
  const g = FILE();
  // THE FLOOR. Every assertion below is about what a read FOUND; a reader that silently matched nothing
  // would satisfy "priya holds no company in cordillera" and every other absence in this file.
  const everyone = Object.keys(g.people).map((e) => personPoints(g, e));
  assert.ok(everyone.filter((p) => p.points.length).length >= 3,
    "fewer than three of the four people resolved to any access — the reader is matching nothing");

  assert.deepEqual(pointsOf(g, "dana@anthropic.example"), ["anthropic/*", "cordillera/clawdi"]);
  assert.deepEqual(pointsOf(g, "priya@anthropic.example"), ["anthropic/anthropic-eu"]);
  // ACCESS TO EVERYTHING IS NOT A POINT. It lives under `people` and in no organisation, which is the
  // whole reason a narrowing cannot be honest about it.
  assert.deepEqual(pointsOf(g, "krzys@cordillera.example"), []);
  assert.equal(personPoints(g, "krzys@cordillera.example").switches.everything, true);
  assert.equal(personPoints(g, "krzys@cordillera.example").listed, true);
  assert.equal(personPoints(g, "nobody@nowhere.example").listed, false);
});

test("an address is matched without regard to case, in BOTH places a person appears", () => {
  const g = FILE();
  // `Tom@Outside.example` under the organisation, `tom@outside.example` under `people`. A file an
  // operator hand-edited, which this product loads and serves.
  const held = personPoints(g, "TOM@outside.EXAMPLE");
  assert.deepEqual(held.points, [{ tenant: "cordillera", account: "ridge" }], "the organisation row was missed");
  assert.equal(held.listed, true, "the entry under people was missed");

  const after = withoutPerson(g, { email: "tom@outside.example", all: true });
  assert.equal(Object.keys(after.tenants.cordillera.users).length, 1,
    "the mixed-case organisation row survived a removal that reported success");
  assert.equal(after.people["tom@outside.example"], undefined);
  assert.deepEqual(personPoints(after, "tom@outside.example"), { points: [], switches: { run: false, manage: false, everything: false }, listed: false });
});

test("removing from the install strikes every organisation row AND the entry under people", () => {
  const g = FILE();
  const after = withoutPerson(g, { email: "dana@anthropic.example", all: true });
  assert.deepEqual(pointsOf(after, "dana@anthropic.example"), []);
  assert.equal(after.people["dana@anthropic.example"], undefined);
  // The organisations themselves are untouched: still there, still holding their companies, simply with
  // nobody of that name on the guest list.
  assert.deepEqual(after.tenants.anthropic.accounts, ["anthropic-eu", "anthropic-us"]);
  assert.equal(after.tenants.anthropic.name, "Anthropic");
  assert.ok("priya@anthropic.example" in after.tenants.anthropic.users, "another person's row was taken with them");
});

test("a narrowing never touches `people` — the half a bounded manager cannot see", () => {
  const g = FILE();
  const after = withoutPerson(g, { email: "dana@anthropic.example", points: [{ tenant: "anthropic" }] });
  assert.deepEqual(pointsOf(after, "dana@anthropic.example"), ["cordillera/clawdi"]);
  assert.deepEqual(after.people["dana@anthropic.example"], { run: true, manage: false },
    "a narrowing rewrote permissions the person who ordered it may not be able to see");
});

test("a narrowing is REFUSED for somebody who holds everything, and writes nothing", () => {
  const g = withPerson(FILE(), { email: "dana@anthropic.example", points: [], switches: { run: true, manage: true, everything: true } });
  const before = JSON.stringify(g);
  assert.throws(() => withoutPerson(g, { email: "dana@anthropic.example", points: [{ tenant: "anthropic" }] }),
    /access to everything/);
  assert.equal(JSON.stringify(g), before, "the refused call still changed the object it was given");
  // Removing them from the install is the act that is honest about it, and it is not refused.
  assert.equal(withoutPerson(g, { email: "dana@anthropic.example", all: true }).people["dana@anthropic.example"], undefined);
});

test("one company cannot be taken out of an organisation held WHOLE", () => {
  const g = FILE();
  // `"*"` means "this organisation, including companies added to it later". The nearest expressible
  // narrowing is today's list minus one — a different grant, and it would silently stop admitting
  // whatever the organisation gains next.
  assert.throws(() => withoutPerson(g, { email: "dana@anthropic.example", points: [{ tenant: "anthropic", account: "anthropic-us" }] }),
    /holds the whole of "anthropic"/);
  assert.equal(g.tenants.anthropic.users["dana@anthropic.example"], "*");
});

test("the last company goes with the row, not as an empty list", () => {
  const g = FILE();
  const after = withoutPerson(g, { email: "priya@anthropic.example", points: [{ tenant: "anthropic", account: "anthropic-eu" }] });
  assert.equal("priya@anthropic.example" in after.tenants.anthropic.users, false,
    "an empty list left behind reads as a person with a row and no access, which is a different state");
  assert.ok("dana@anthropic.example" in after.tenants.anthropic.users);
});

test("an organisation this file does not have is a refusal, not a silent no-op", () => {
  const g = FILE();
  assert.throws(() => withoutPerson(g, { email: "dana@anthropic.example", points: [{ tenant: "nosuch" }] }), /no organisation "nosuch"/);
  assert.throws(() => withoutPerson(g, { email: "dana@anthropic.example", points: [] }), /nothing was named/);
  assert.throws(() => withoutPerson(g, { email: "", all: true }), /email address/);
});

test("PURE — the grants object handed in is never the one handed back", () => {
  const g = FILE();
  const before = JSON.stringify(g);
  withoutPerson(g, { email: "dana@anthropic.example", all: true });
  withoutPerson(g, { email: "priya@anthropic.example", points: [{ tenant: "anthropic", account: "anthropic-eu" }] });
  assert.equal(JSON.stringify(g), before, "an editor that mutates its input makes the caller's fresh read stale");
});
