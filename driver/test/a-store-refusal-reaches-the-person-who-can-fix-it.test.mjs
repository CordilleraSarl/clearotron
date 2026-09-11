// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A store that cannot record a new company is refused with its path and the git commands that fix it.
// Those are for whoever runs the installation. A manager who holds an organisation can reach the same
// create, cannot act on a server path, and must not be shown one: they are told what to do instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeUpstream, STORE_REFUSAL_FOR_MANAGERS, STORE_FAULT_FOR_MANAGERS } from "../portal-upstream.mjs";
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

// ── A CREATE THE STORE COULD NOT UNDO, AND ONE THAT COULD NOT BE FILED ─────────────────────────────────
//
// Two rarer answers carry text from below this layer, git's last word and the grants file's own error,
// and either can name a server path. Same reader, same rule.

const UNDONE = { status: 500, json: { key: "ferrymead", error: `The company could not be recorded (fatal: unable to write ${STORE}/.git/index), `
  + `and its file could not be removed afterwards (EACCES: ${STORE}/profiles/ferrymead.json). It is on disk with no record behind it — tell an administrator.` } };

test("a create the store could not undo names its paths to staff and none to a manager", async () => {
  const up = makeUpstream({ callUpstream: async () => UNDONE, fileCompany: async () => { throw new Error("an unrecorded create must file no grant"); } });
  const staff = await up.createCompany(STAFF, { name: "Ferrymead Instruments" });
  assert.equal(staff.status, 500);
  assert.ok(staff.json.error.includes(STORE), "staff lose the one detail that says where to look");
  const manager = await up.createCompany(MANAGER, { name: "Ferrymead Instruments" });
  assert.equal(manager.status, 500);
  assert.equal(manager.json.error, STORE_FAULT_FOR_MANAGERS);
  assert.doesNotMatch(manager.json.error, /\/srv\/|\.git|EACCES|fatal:/, "a server path or git's own words reached a manager");
});

test("a company that could not be filed under its organisation names the grants file's error to staff only", async () => {
  const GRANTS_PATH = "/srv/example/trademark/grants.json";
  const created = { status: 201, json: { key: "ferrymead" } };
  const up = makeUpstream({ callUpstream: async () => created, fileCompany: async () => { throw new Error(`EACCES: permission denied, open '${GRANTS_PATH}'`); } });
  const manager = await up.createCompany(MANAGER, { name: "Ferrymead Instruments" });
  assert.equal(manager.status, 500);
  assert.match(manager.json.error, /could not be filed under its organisation/, "the manager still learns what happened");
  assert.doesNotMatch(manager.json.error, /\/srv\/|EACCES/, "the grants file's path reached a manager");
  // THE CONTROL, and the arm's reach: staff never file, because they hold no organisation, so the same
  // failure is driven for a manager who ALSO sees everything.
  const both = makePrincipal({ email: "lead@celta.example", grants: { ...GRANTS, tenants: { celta: { ...GRANTS.tenants.celta,
    users: { ...GRANTS.tenants.celta.users, "lead@celta.example": "*" } } }, people: { ...GRANTS.people, "lead@celta.example": { run: true, manage: true, everything: true } } } });
  const lead = await up.createCompany(both, { name: "Ferrymead Instruments", tenant: "celta" });
  assert.equal(lead.status, 500, JSON.stringify(lead.json));
  assert.ok(lead.json.error.includes(GRANTS_PATH), "a person who sees everything keeps the cause");
});
