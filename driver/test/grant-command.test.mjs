// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// item 2 — the guest-list command.
//
// EVERY ARM DRIVES THE REAL BINARY over a real file, because the value of this command is entirely in
// its REFUSALS and a refusal is a process exit plus a message an operator has to act on. A unit test of
// the validity helper would pass while the command wrote anyway.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { accountsForEmail } from "../../shared/scope.mjs";   // — the resolver half

const HERE = dirname(fileURLToPath(import.meta.url));
const CMD = join(HERE, "..", "..", "bin", "grant.mjs");

function withFile(grants) {
  const p = join(mkdtempSync(join(tmpdir(), "grant-cmd-")), "grants.json");
  writeFileSync(p, JSON.stringify(grants, null, 2));
  return p;
}
const run = (file, args) => {
  const r = spawnSync(process.execPath, [CMD, ...args],
    { env: { ...process.env, CLEAROTRON_ACCESS_FILE: file }, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const ACME = () => ({ tenants: { acme: { accounts: ["acme-main", "acme-eu"], users: {} } } });

test("#1440-2 a valid grant is written, and the file stays hand-readable", () => {
  const f = withFile(ACME());
  const r = run(f, ["add", "lawyer@acme.test", "--tenant", "acme", "--accounts", "acme-main"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(read(f).tenants.acme.users["lawyer@acme.test"], ["acme-main"]);
  assert.match(r.out, /no restart/, "the operator must be told the change is already live");
});

test("#1440-2 REFUSES a dangling account — and names what the tenant actually holds", () => {
  // The whole value of the command. Written, this grant resolves to nothing and fails as a silent 404
  // for that person with nothing in any log to explain it.
  const f = withFile(ACME());
  const r = run(f, ["add", "x@acme.test", "--tenant", "acme", "--accounts", "acme-nope"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /does not hold acme-nope/);
  assert.match(r.err, /acme-main, acme-eu/, "a refusal that does not name the valid values is half a refusal");
  assert.deepEqual(read(f).tenants.acme.users, {}, "NOTHING may be written on a refusal");
});

test("#1440-2 REFUSES an unknown tenant, and lists the ones that exist", () => {
  const f = withFile(ACME());
  const r = run(f, ["add", "x@acme.test", "--tenant", "ghost", "--accounts", "acme-main"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /No tenant "ghost"/);
  assert.match(r.err, /Tenants: acme/);
});

test("#1440-2 REFUSES a multi-@ identity — the rule is makePrincipal's, not a second one", () => {
  // portal-access refuses these outright so the grant could never match. A first-@ split once
  // classified "x@firm.ch@evil.com" as staff while the edge saw evil.com.
  const f = withFile(ACME());
  const r = run(f, ["add", "a@b.test@evil.test", "--tenant", "acme", "--accounts", "acme-main"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /more than one @/);
  assert.deepEqual(read(f).tenants.acme.users, {});
});

test("#1440-2 a pre-existing mess does NOT block adding a colleague", () => {
  // Faults are attributed to THIS change. A guest list already carrying someone else's dangling grant
  // is not this operator's to fix first — refusing on it would make the command unusable on exactly the
  // file it exists to tidy.
  const g = ACME();
  g.tenants.acme.users["old@acme.test"] = ["gone-account"];
  const f = withFile(g);
  const r = run(f, ["add", "new@acme.test", "--tenant", "acme", "--accounts", "acme-eu"]);
  assert.equal(r.code, 0, `a pre-existing dangling grant must not block an unrelated valid add:\n${r.err}`);
  assert.deepEqual(read(f).tenants.acme.users["new@acme.test"], ["acme-eu"]);
  assert.deepEqual(read(f).tenants.acme.users["old@acme.test"], ["gone-account"], "and it must not be silently repaired");
});

test("#1440-2 removing the last person leaves the TENANT, and it round-trips", () => {
  // An empty `users` map is not a deleted tenant. Deleting it here would destroy configuration nobody
  // asked to remove; `remove-tenant` is the explicit verb for that.
  const g = ACME();
  g.tenants.acme.users["only@acme.test"] = "*";
  const f = withFile(g);
  assert.equal(run(f, ["remove", "only@acme.test"]).code, 0);
  const after = read(f);
  assert.ok(after.tenants.acme, "the tenant must survive its last grant being removed");
  assert.deepEqual(after.tenants.acme.users, {});
  assert.deepEqual(after.tenants.acme.accounts, ["acme-main", "acme-eu"], "and keep its accounts");
});

test("#1440-2 remove-tenant deletes it, and says how many grants went with it", () => {
  const g = ACME();
  g.tenants.acme.users["a@acme.test"] = "*";
  g.tenants.acme.users["b@acme.test"] = ["acme-eu"];
  const f = withFile(g);
  const r = run(f, ["remove-tenant", "acme"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /2 grant\(s\)/, "silently dropping two people's access would be the wrong kind of quiet");
  assert.deepEqual(read(f).tenants, {});
});

test("#1440-2 removing somebody who is not there writes NOTHING and says so", () => {
  const f = withFile(ACME());
  const before = readFileSync(f, "utf8");
  const r = run(f, ["remove", "nobody@acme.test"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /not on the guest list/);
  assert.equal(readFileSync(f, "utf8"), before, "a no-op must not rewrite the file at all");
});

test("#1440-2 a malformed guest list is REFUSED, never rewritten", () => {
  // loadGrants throws on malformed JSON, so the portal is already 500ing. Rewriting the file from a
  // parse this command invented would destroy whatever the operator was halfway through fixing.
  const p = join(mkdtempSync(join(tmpdir(), "grant-cmd-bad-")), "grants.json");
  writeFileSync(p, '{"tenants": {"acme": ');
  const r = run(p, ["add", "x@acme.test", "--tenant", "acme", "--accounts", "a"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /not valid JSON/);
  assert.equal(readFileSync(p, "utf8"), '{"tenants": {"acme": ', "the broken file must be left exactly as found");
});

test("#1440-2 `list` reports the wildcard as what it actually reaches", () => {
  const g = ACME();
  g.tenants.acme.users["boss@acme.test"] = "*";
  const f = withFile(g);
  const r = run(f, ["list"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /acme-main, acme-eu/, "a literal * would make the reader work out the rule themselves");
});


// ── — A WRONG SHAPE IS NOT A WRONG PARSE ──────────────────────────────────
//
// The arm above covers a file that is not JSON. This one covers a file that IS valid JSON and is the
// wrong shape, which is the failure an operator actually hits: it parses, so nothing upstream refuses,
// and it used to reach `accountsForEmail` and throw `TypeError: (eff ?? []) is not iterable` — naming a
// variable that appears nowhere in the file they just wrote, from a door that answers it as a 500.
//
// The fixture is the owner's own wrong guess from the issue, kept verbatim: an OBJECT where the code
// wants an array of account keys. It is the natural guess, which is why it is the one worth pinning.
test("2079 a valid-JSON guest list with the wrong shape is refused by name, not by TypeError", () => {
  const p = withFile({ tenants: { acme: { users: { "a@b.c": "*" }, accounts: { acme: { name: "Acme" } } } } });
  const r = run(p, ["list"]);
  assert.notEqual(r.code, 0, "a malformed guest list was accepted");
  assert.doesNotMatch(r.err, /is not iterable|TypeError/,
    "the operator got the stack trace this arm exists to replace");
  // WHAT THE MESSAGE HAS TO CARRY, and each of these is a thing the reader needs to act:
  assert.match(r.err, /accounts/, "the refusal does not name the field that is wrong");
  assert.match(r.err, /array of account keys/, "the refusal does not say what the shape should be");
  assert.match(r.err, /tenants\.acme\.accounts/, "the refusal does not name the path into the file");
});

test("2079 the resolver states the same fault when grants never came through the file reader", () => {
  // Grants also reach `accountsForEmail` from callers that never opened a file — an injected fixture, a
  // store read elsewhere — so the check at the read is necessary and not sufficient.
  assert.throws(
    () => accountsForEmail("a@b.c", { tenants: { acme: { users: { "a@b.c": { acme: true } } } } }),
    (e) => /must be "\*" or an array of account keys/.test(e.message) && !/is not iterable/.test(e.message),
    "the resolver threw the raw TypeError instead of naming the fault");
  // AND THE LEGAL SHAPES STILL RESOLVE — a refusal that also refuses correct files is the worse defect.
  assert.deepEqual(accountsForEmail("a@b.c", { tenants: { acme: { users: { "a@b.c": ["acme"] } } } }), ["acme"]);
  assert.equal(accountsForEmail("a@b.c", { tenants: { acme: { users: { "a@b.c": "*" }, accounts: "*" } } }), "*");
});
