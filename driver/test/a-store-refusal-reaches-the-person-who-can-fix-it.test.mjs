// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A store that cannot record a new company is refused with its path and the git commands that fix it.
// Those are for whoever runs the installation. A manager who holds an organisation can reach the same
// create, cannot act on a server path, and must not be shown one: they are told what to do instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeUpstream, STORE_REFUSAL_FOR_MANAGERS } from "../portal-upstream.mjs";
import { makePrincipal, mayManage, seesEverything } from "../portal-access.mjs";

const GRANTS = {
  tenants: { celta: { accounts: ["aurora"], users: { "boss@celta.example": "*" } } },
  people: {
    "boss@celta.example": { run: true, manage: true },
    "staff@example-firm.com": { run: true, manage: true, everything: true },
  },
};
const MANAGER = makePrincipal({ email: "boss@celta.example", grants: GRANTS });
const STAFF = makePrincipal({ email: "staff@example-firm.com", grants: GRANTS });

const STORE = "/srv/example/trademark/config";
const REFUSAL = {
  status: 409,
  json: { code: "store_no_identity", error: `No company was created: the store at ${STORE} has no git identity, so nothing saved to it `
    + `can be recorded — run \`git -C ${STORE} config user.email "you@example.com"\` and \`git -C ${STORE} config user.name "Your Name"\`, then try again.` },
};
const refusing = () => makeUpstream({ callUpstream: async () => REFUSAL, fileCompany: async () => { throw new Error("a refused create must file no grant"); } });

test("the fixture: both principals may create a company, and only staff see everything", () => {
  assert.ok(mayManage(MANAGER) && !seesEverything(MANAGER), "the manager holds an organisation whole, and Manage");
  assert.deepEqual(MANAGER.genericOrgs, ["celta"], "so the create reaches the store for them");
  assert.ok(seesEverything(STAFF));
});

test("staff are shown the store and the commands that fix it", async () => {
  const r = await refusing().createCompany(STAFF, { name: "Ferrymead Instruments" });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "store_no_identity");
  assert.ok(r.json.error.includes(STORE) && r.json.error.includes(`git -C ${STORE} config user.email`), r.json.error);
});

test("a manager who does not run the installation is told what to do, and shown no server path", async () => {
  const r = await refusing().createCompany(MANAGER, { name: "Ferrymead Instruments" });
  assert.equal(r.status, 409, "still a refusal, so the page says nothing was created");
  assert.equal(r.json.code, "store_no_identity", "the code survives, so the page decodes it as a refusal to render");
  assert.equal(r.json.error, STORE_REFUSAL_FOR_MANAGERS);
  assert.doesNotMatch(r.json.error, /\/srv\/|git -C|config user\./, "a server path or command reached a manager who cannot use it");
  assert.doesNotMatch(r.json.error, /try again shortly/i, "a permanent refusal is never a transient one");
});
