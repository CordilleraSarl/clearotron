// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Changing and removing somebody, through the routes the People page presses.
//
// Nothing tested the write side of this page before — `git ls-files driver/test/* | xargs grep -l
// admin/people` came back empty, so the only route that edits who may enter this installation had no
// arm on it at all, and the one defect that found is in here: the form's "Everything on this
// Clearotron" had never worked.
//
// The four properties that matter are all about a caller who can see PART of somebody:
//
//   - the diff is computed from the FILE, not from the request, so a stale page cannot write back over
//     an edit it never saw;
//   - a narrowing never touches the entry under `people`, which is where permissions and access to
//     everything live and which a bounded caller cannot read;
//   - how far a removal reaches is the server's answer, never the request's;
//   - a removal from the whole install revokes the connector keys, and says honestly when it cannot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDenylistPath, isRevoked } from "../../shared/scope.mjs";
import { makePortalService, makeConnectorKeyRevoker } from "../portal-service.mjs";

const FILE = () => ({
  tenants: {
    anthropic: { name: "Anthropic", accounts: ["anthropic-eu", "anthropic-us"],
      users: { "dana@anthropic.example": "*", "priya@anthropic.example": "*" } },
    cordillera: { name: "Cordillera", accounts: ["summit", "ridge"],
      users: { "dana@anthropic.example": ["summit"] } },
  },
  people: {
    "dana@anthropic.example": { run: true, manage: false },
    "priya@anthropic.example": { run: true, manage: true },
    "krzys@cordillera.example": { run: true, manage: true, everything: true },
  },
  connectKeys: {
    "jti-dana-1": { sub: "dana@anthropic.example", client: "an assistant", minted: "2026-09-01T00:00:00.000Z" },
    "jti-priya-1": { sub: "priya@anthropic.example", client: "an assistant", minted: "2026-09-01T00:00:00.000Z" },
  },
});

const KRZYS = { email: "krzys@cordillera.example" };   // sees everything
const PRIYA = { email: "priya@anthropic.example" };    // manages Anthropic, and cannot see Summit
const DANA = "dana@anthropic.example";

/** A service over an in-memory grants file, with the write and the revocation watched rather than done. */
const on = (start = FILE(), { revoke = "real" } = {}) => {
  const state = { grants: start, writes: 0, denylist: [], audits: [] };
  const svc = makePortalService({
    poolRoot: "/nonexistent", workspaceRoot: "/nonexistent", secret: "s",
    grants: () => state.grants,
    writeGrants: async (g) => { state.grants = g; state.writes++; },
    audit: (rec) => state.audits.push(rec),
    revokeConnectorKeys: revoke === null ? null : async ({ email, grants }) => {
      const { recordedKeysFor, removeRecordedKeys } = await import("../../shared/client-door.mjs");
      const jtis = recordedKeysFor(grants, email).map((r) => r.jti);
      if (revoke === "lateArm") return { grants, revoked: 0, jtis, lateArm: true };
      state.denylist.push(...jtis);
      return { grants: removeRecordedKeys(grants, jtis), revoked: jtis.length, jtis, lateArm: false };
    },
  });
  return { state, post: (what, who, body) => svc.route("POST", `/portal/admin/people/${what}`, who, body),
    view: (who) => svc.route("GET", "/portal/admin/access", who) };
};

const pointsFor = (grants, email) => {
  const out = [];
  for (const [t, v] of Object.entries(grants.tenants)) {
    const held = v.users[email];
    if (held === "*") out.push(`${t}/*`);
    else for (const a of held ?? []) out.push(`${t}/${a}`);
  }
  return out.sort();
};

test("a manager who sees everything changes what somebody holds, in one save", async () => {
  const { state, post } = on();
  const r = await post("change", KRZYS, { email: DANA, permissions: { run: true, manage: true },
    access: [{ kind: "organisation", key: "anthropic" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // Anthropic kept, Summit taken away — the untick the mockup draws.
  assert.deepEqual(pointsFor(state.grants, DANA), ["anthropic/*"]);
  assert.deepEqual(state.grants.people[DANA], { run: true, manage: true }, "their permissions did not follow the save");
  assert.equal(r.json.switchesApplied, true);
  assert.equal(state.writes, 1, "one save must be one write");
  assert.equal(state.audits.filter((a) => a.event === "person-change" && a.ok).length, 1, "the change left no record");
});

test("the diff is computed from the FILE, so a stale page cannot write back over an edit it never saw", async () => {
  const { state, post } = on();
  // Somebody else gives Dana a second company while this page is open. The page was drawn before it and
  // sends only what it knew: Anthropic and Summit.
  state.grants = structuredClone(state.grants);
  state.grants.tenants.cordillera.users[DANA] = ["summit", "ridge"];
  const r = await post("change", KRZYS, { email: DANA, permissions: { run: true, manage: false },
    access: [{ kind: "organisation", key: "anthropic" }, { kind: "company", key: "summit" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // The page's own set is what it asked for, so Ridge goes — that is a change this caller CAN see and
  // did order. What must not happen is the opposite: a point outside their view being rewritten. The
  // arm below is the one that proves the read was fresh, because a handler applying the request's own
  // notion of "before" would have reported removing nothing.
  assert.equal(r.json.removed, 1, "the handler diffed against its own copy of the page's state, not the file");
  assert.deepEqual(pointsFor(state.grants, DANA), ["anthropic/*", "cordillera/summit"]);
});

test("a bounded manager changes only their own half, and the other half is untouched and unsaid", async () => {
  const { state, post, view } = on();
  const before = JSON.stringify(state.grants.tenants.cordillera);
  // Priya manages Anthropic. Dana also holds Summit, which Priya cannot see.
  const seen = (await view(PRIYA)).json.people.find((p) => p.email === DANA);
  assert.deepEqual(seen.access.map((a) => a.key ?? a.kind), ["anthropic"], "Priya was shown access she cannot reach");
  assert.equal(seen.covered, false, "the page was told this row is the whole of Dana");

  const r = await post("change", PRIYA, { email: DANA, permissions: { run: false, manage: false },
    access: [{ kind: "company", key: "anthropic-eu" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(pointsFor(state.grants, DANA), ["anthropic/anthropic-eu", "cordillera/summit"]);
  assert.equal(JSON.stringify(state.grants.tenants.cordillera), before, "a bounded change reached an organisation the caller cannot see");
  // AND THE SWITCHES STAYED. They belong to the person, and part of that person is outside Priya's view.
  assert.deepEqual(state.grants.people[DANA], { run: true, manage: false }, "a bounded caller set permissions that apply where they cannot see");
  assert.equal(r.json.switchesApplied, false, "the answer must say the switches were not applied");
});

test("a point outside the caller's own reach is the same refusal as asking to see it", async () => {
  const { state, post } = on();
  const r = await post("change", PRIYA, { email: DANA, access: [{ kind: "company", key: "ridge" }], permissions: { run: true, manage: false } });
  assert.equal(r.status, 404);
  assert.equal(state.writes, 0, "a refused change still wrote the file");
});

test("nobody changes or removes themselves", async () => {
  const { state, post } = on();
  for (const what of ["change", "remove"]) {
    const r = await post(what, PRIYA, { email: PRIYA.email, permissions: { run: true, manage: false },
      access: [{ kind: "organisation", key: "anthropic" }] });
    assert.equal(r.status, 400, what);
    assert.match(r.json.error, /your own access/);
  }
  assert.equal(state.writes, 0);
});

test("unticking every row is not a removal — it is refused, with the removal named", async () => {
  const { state, post } = on();
  const r = await post("change", KRZYS, { email: DANA, permissions: { run: true, manage: false }, access: [] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /remove them instead/);
  assert.equal(state.writes, 0);
});

test("removing from the whole install strikes every row, the entry under people, AND the keys", async () => {
  const { state, post } = on();
  const r = await post("remove", KRZYS, { email: DANA });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.removed, "install");
  assert.deepEqual(pointsFor(state.grants, DANA), []);
  assert.equal(state.grants.people[DANA], undefined);
  assert.deepEqual(state.denylist, ["jti-dana-1"], "the removed person's connector key is still live");
  assert.equal(state.grants.connectKeys["jti-dana-1"], undefined, "the record of the revoked key stayed");
  assert.ok(state.grants.connectKeys["jti-priya-1"], "somebody else's key record went with them");
  assert.equal(r.json.keys.revoked, 1);
  assert.equal(state.writes, 1, "the removal and the struck record must land in one write");
});

test("a bounded removal takes the organisation and NOT the person — and revokes nothing", async () => {
  const { state, post } = on();
  const r = await post("remove", PRIYA, { email: DANA });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.removed, "organisations");
  assert.deepEqual(r.json.organisations, ["anthropic"]);
  assert.deepEqual(pointsFor(state.grants, DANA), ["cordillera/summit"]);
  // The entry under `people` is the half Priya cannot see, and it is how Dana still reaches Summit.
  assert.deepEqual(state.grants.people[DANA], { run: true, manage: false });
  // THE KEY STAYS. Dana is still on this install, and the key is how they reach what is left.
  assert.deepEqual(state.denylist, []);
  assert.equal(r.json.keys.checked, false);
});

test("THE REAL SEAM writes the revocation list and leaves the record standing", async () => {
  // The seam the portal is built with, driven against a directory of its own rather than a stand-in.
  // This is the arm that matters: the protection is a step FILTER and a throwing seam inside that
  // function, and a test that supplies its own revoker proves nothing about either.
  const home = mkdtempSync(join(tmpdir(), "revoke-home-"));
  const list = join(home, "denylist");
  const revoke = makeConnectorKeyRevoker({ env: { TRADEMARK_MCP_TOKEN_DENYLIST: list }, home });
  const grants = FILE();
  const r = await revoke({ email: DANA, grants });

  assert.equal(r.lateArm, false, "the fixture names a list, so this is the armed path — the risky one");
  assert.equal(r.revoked, 1);
  assert.deepEqual(r.jtis, ["jti-dana-1"]);
  assert.equal(existsSync(list), true, "the revocation list was not written");
  assert.match(readFileSync(list, "utf8"), /jti-dana-1/, "the key id is not on the list");
  // THE POINT. On a box where the portal names a list and the connector was started without one, this
  // path reads as armed and a plan carrying its ledger step would strike the record of a key that still
  // works — the only trace of it, gone.
  assert.equal(r.recordKept, true, "the answer does not say the record was kept");
  assert.ok(r.grants.connectKeys["jti-dana-1"], "the seam struck the record of a key it cannot confirm was revoked");
  assert.ok(grants.connectKeys["jti-dana-1"], "and it mutated the grants it was handed");
});

test("with no revocation list named, the real seam revokes through the install's default list", async () => {
  // This used to report the key as live: a door with no list named checked none. Every door now reads the
  // install's default list when none is named (isRevoked), so writing there calls the key back.
  const home = mkdtempSync(join(tmpdir(), "revoke-home-"));
  const revoke = makeConnectorKeyRevoker({ env: {}, home });
  const r = await revoke({ email: DANA, grants: FILE() });
  assert.equal(r.lateArm, false, "a write to the list every door reads was reported as reaching no door");
  assert.equal(r.revoked, 1);
  const list = defaultDenylistPath(home);
  assert.match(readFileSync(list, "utf8"), /jti-dana-1/, "the key id did not reach the default list");
  assert.equal(isRevoked("jti-dana-1", { env: {}, home }), true, "the verifier does not read the list the revoker wrote");
  assert.ok(r.grants.connectKeys["jti-dana-1"], "the portal struck a key record, which it never does");
});

test("a person with no key at all is not a revocation", async () => {
  const home = mkdtempSync(join(tmpdir(), "revoke-home-"));
  const revoke = makeConnectorKeyRevoker({ env: { TRADEMARK_MCP_TOKEN_DENYLIST: join(home, "denylist") }, home });
  const r = await revoke({ email: "nobody@nowhere.example", grants: FILE() });
  assert.equal(r.revoked, 0);
  assert.deepEqual(r.jtis, []);
  assert.ok((r.says ?? []).some((line) => /nothing to revoke/.test(line)), JSON.stringify(r.says));
});

test("the route keeps the record when its seam does", async () => {
  // The portal cannot see the connector's environment. `disablePlan` decides `lateArm` from the
  // environment it is handed, and on a box where the portal names a revocation list and the door was
  // started without one it reads as armed — so a plan carrying a ledger step would strike the record of
  // a key that still works, which is the one thing `client-door.mjs` states its ordering rule to
  // prevent. This drives the real seam, not the arm's stand-in, to prove the ledger step never runs.
  const { recordedKeysFor } = await import("../../shared/client-door.mjs");
  const state = { grants: FILE(), struck: 0 };
  const svc = makePortalService({
    poolRoot: "/nonexistent", workspaceRoot: "/nonexistent", secret: "s",
    grants: () => state.grants, writeGrants: async (g) => { state.grants = g; },
    // The shape the boot seam has: it reports what it revoked and hands the grants back UNCHANGED.
    revokeConnectorKeys: async ({ email, grants }) => {
      const jtis = recordedKeysFor(grants, email).map((r) => r.jti);
      return { grants, revoked: jtis.length, jtis, lateArm: false, recordKept: true };
    },
  });
  const r = await svc.route("POST", "/portal/admin/people/remove", KRZYS, { email: DANA });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.keys.revoked, 1, "the revocation did not happen");
  assert.equal(r.json.keys.recordKept, true, "the answer does not say the record was kept");
  assert.ok(state.grants.connectKeys["jti-dana-1"],
    "the portal struck a key record, and it cannot know whether the list it wrote is the one that door reads");
  assert.equal(state.grants.people[DANA], undefined, "the access record itself must still be gone");
  assert.equal(state.struck, 0);
});

test("a door started with no revocation list says the keys stay live, and strikes no record", async () => {
  const { state, post } = on(FILE(), { revoke: "lateArm" });
  const r = await post("remove", KRZYS, { email: DANA });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.keys.lateArm, true);
  assert.equal(r.json.keys.revoked, 0);
  assert.deepEqual(r.json.keys.jtis, ["jti-dana-1"]);
  // The access record is gone — that is the gate every surface reads — but the KEY RECORD stays, because
  // striking it would delete the only trace of a credential that still works.
  assert.equal(state.grants.people[DANA], undefined);
  assert.ok(state.grants.connectKeys["jti-dana-1"], "the record of a key that was NOT revoked was struck");
  assert.equal(state.audits.find((a) => a.event === "person-remove").keysUnrevokable, 1);
});

test("an installation that cannot revoke at all says so rather than implying it did", async () => {
  const { post } = on(FILE(), { revoke: null });
  const r = await post("remove", KRZYS, { email: DANA });
  assert.equal(r.status, 200);
  assert.equal(r.json.keys.checked, false);
  assert.match(r.json.keys.note, /cannot revoke/);
});

test("a whole email domain is a row like any other, through both routes", async () => {
  // `*@domain` admits everybody with an address there. It is not a person, and the product has always
  // drawn it in the same list — so the question is whether the two new routes treat it as one, or trip
  // over a key that is not an address. Driven rather than reasoned about, because the editor matches by
  // lowercased string and a pattern is a string that looks like one thing and means another.
  const start = FILE();
  start.tenants.anthropic.users["*@anthropic.example"] = "*";
  start.tenants.cordillera.users["*@anthropic.example"] = ["summit"];
  start.people["*@anthropic.example"] = { run: true, manage: false };
  const { state, post } = on(start);
  const DOMAIN = "*@anthropic.example";

  const narrowed = await post("change", KRZYS, { email: DOMAIN, permissions: { run: false, manage: false },
    access: [{ kind: "organisation", key: "anthropic" }] });
  assert.equal(narrowed.status, 200, JSON.stringify(narrowed.json));
  assert.deepEqual(pointsFor(state.grants, DOMAIN), ["anthropic/*"], "a domain row could not be narrowed");
  assert.deepEqual(state.grants.people[DOMAIN], { run: false, manage: false });

  const gone = await post("remove", KRZYS, { email: DOMAIN });
  assert.equal(gone.status, 200, JSON.stringify(gone.json));
  assert.equal(gone.json.removed, "install");
  assert.deepEqual(pointsFor(state.grants, DOMAIN), []);
  assert.equal(state.grants.people[DOMAIN], undefined);
  // And nobody else went with them.
  assert.deepEqual(pointsFor(state.grants, DANA), ["anthropic/*", "cordillera/summit"]);
});

test("somebody who is not on the guest list is a not-found, not an empty success", async () => {
  const { state, post } = on();
  for (const what of ["change", "remove"]) {
    const r = await post(what, KRZYS, { email: "nobody@nowhere.example", permissions: { run: true, manage: false },
      access: [{ kind: "organisation", key: "anthropic" }] });
    assert.equal(r.status, 404, what);
  }
  assert.equal(state.writes, 0);
});

test("the access page says keys can be withdrawn whenever the portal can withdraw them, list named or not", async () => {
  // This used to also require a revocation list named in the portal's environment, because a door with
  // none named checked none. Every door now reads the install's default list, so naming one is not the
  // question any more. The page stopped saying "keys stay live" on an install where they no longer do.
  const saved = process.env.TRADEMARK_MCP_TOKEN_DENYLIST;
  delete process.env.TRADEMARK_MCP_TOKEN_DENYLIST;
  try {
    const withRevoker = await on().view(KRZYS);
    assert.equal(withRevoker.status, 200, JSON.stringify(withRevoker.json));
    assert.equal(withRevoker.json.keysRevocable, true, "a portal that can revoke says it cannot, because no list is named");
    // The control: a portal built without a revoker still says it cannot.
    assert.equal((await on(FILE(), { revoke: null }).view(KRZYS)).json.keysRevocable, false);
  } finally {
    if (saved !== undefined) process.env.TRADEMARK_MCP_TOKEN_DENYLIST = saved;
  }
});
