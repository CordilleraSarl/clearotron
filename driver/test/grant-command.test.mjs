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

import { accountsForEmail, assertGrantsShape, resolvePerson } from "../../shared/scope.mjs";   // — the resolver half

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

test("a valid grant is written, and the file stays hand-readable", () => {
  const f = withFile(ACME());
  const r = run(f, ["add", "lawyer@acme.test", "--tenant", "acme", "--accounts", "acme-main"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(read(f).tenants.acme.users["lawyer@acme.test"], ["acme-main"]);
  assert.match(r.out, /no restart/, "the operator must be told the change is already live");
});

test("REFUSES a dangling account — and names what the tenant actually holds", () => {
  // The whole value of the command. Written, this grant resolves to nothing and fails as a silent 404
  // for that person with nothing in any log to explain it.
  const f = withFile(ACME());
  const r = run(f, ["add", "x@acme.test", "--tenant", "acme", "--accounts", "acme-nope"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /does not hold "?acme-nope/);
  assert.match(r.err, /acme-main, acme-eu/, "a refusal that does not name the valid values is half a refusal");
  assert.deepEqual(read(f).tenants.acme.users, {}, "NOTHING may be written on a refusal");
});

test("REFUSES an unknown tenant, and lists the ones that exist", () => {
  const f = withFile(ACME());
  const r = run(f, ["add", "x@acme.test", "--tenant", "ghost", "--accounts", "acme-main"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /No tenant "ghost"/);
  assert.match(r.err, /Tenants: acme/);
});

test("REFUSES a multi-@ identity — the rule is makePrincipal's, not a second one", () => {
  // portal-access refuses these outright so the grant could never match. A first-@ split once
  // classified "x@firm.ch@evil.com" as staff while the edge saw evil.com.
  const f = withFile(ACME());
  const r = run(f, ["add", "a@b.test@evil.test", "--tenant", "acme", "--accounts", "acme-main"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /more than one @/);
  assert.deepEqual(read(f).tenants.acme.users, {});
});

test("a pre-existing mess does NOT block adding a colleague", () => {
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

test("removing the last person leaves the TENANT, and it round-trips", () => {
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

test("remove-tenant deletes it, and says how many grants went with it", () => {
  const g = ACME();
  g.tenants.acme.users["a@acme.test"] = "*";
  g.tenants.acme.users["b@acme.test"] = ["acme-eu"];
  const f = withFile(g);
  const r = run(f, ["remove-tenant", "acme"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /2 grant\(s\)/, "silently dropping two people's access would be the wrong kind of quiet");
  assert.deepEqual(read(f).tenants, {});
});

test("removing somebody who is not there writes NOTHING and says so", () => {
  const f = withFile(ACME());
  const before = readFileSync(f, "utf8");
  const r = run(f, ["remove", "nobody@acme.test"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /not on the guest list/);
  assert.equal(readFileSync(f, "utf8"), before, "a no-op must not rewrite the file at all");
});

test("a malformed guest list is REFUSED, never rewritten", () => {
  // loadGrants throws on malformed JSON, so the portal is already 500ing. Rewriting the file from a
  // parse this command invented would destroy whatever the operator was halfway through fixing.
  const p = join(mkdtempSync(join(tmpdir(), "grant-cmd-bad-")), "grants.json");
  writeFileSync(p, '{"tenants": {"acme": ');
  const r = run(p, ["add", "x@acme.test", "--tenant", "acme", "--accounts", "a"]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /not valid JSON/);
  assert.equal(readFileSync(p, "utf8"), '{"tenants": {"acme": ', "the broken file must be left exactly as found");
});

test("`list` reports the wildcard as what it actually reaches", () => {
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
test("a valid-JSON guest list with the wrong shape is refused by name, not by TypeError", () => {
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

test("the resolver states the same fault when grants never came through the file reader", () => {
  // Grants also reach `accountsForEmail` from callers that never opened a file — an injected fixture, a
  // store read elsewhere — so the check at the read is necessary and not sufficient.
  assert.throws(
    () => accountsForEmail("a@b.c", { tenants: { acme: { users: { "a@b.c": { acme: true } } } } }),
    (e) => /must be "\*" or an array of account keys/.test(e.message) && !/is not iterable/.test(e.message),
    "the resolver threw the raw TypeError instead of naming the fault");
  // AND THE LEGAL SHAPES STILL RESOLVE — a refusal that also refuses correct files is the worse defect.
  // Legal in today's model: a company counts only under the organisation that holds it, an organisation's
  // list is never "*", and "*" — everything — belongs to a person.
  assert.deepEqual(accountsForEmail("a@b.c", { tenants: { acme: { accounts: ["acme"], users: { "a@b.c": ["acme"] } } } }), ["acme"]);
  assert.deepEqual(accountsForEmail("a@b.c", { tenants: { acme: { accounts: ["acme"], users: { "a@b.c": "*" } } } }), ["acme"],
    "a grant of the whole organisation must resolve to every company it holds");
  assert.equal(accountsForEmail("a@b.c", { tenants: {}, people: { "a@b.c": { everything: true } } }), "*");
});

// ── 2191 F13 · THE ROSTER'S PATH HAS ONE OWNER ──────────────────────────────────────────────────────
//
// `grant` read CLEAROTRON_ACCESS_FILE and nothing else, so it refused with "Set CLEAROTRON_ACCESS_FILE"
// — a variable NOTHING writes. `start` injects it into the environment of the services it supervises and
// never persists it, so the door found the roster and every sibling CLI in the operator's own shell did
// not. Enrolling a client had no working path at all.

test("the grants path resolves with no variable set, and agrees with installPaths", async () => {
  const { defaultGrantsPath, installPaths } = await import("../../bin/start.mjs");

  // THE DEFAULT, and it must be the SAME path installPaths states — not a second opinion that drifts the
  // first time anyone moves the base.
  const home = "/home/somebody";
  const viaDefault = defaultGrantsPath({ env: { HOME: home } });
  assert.ok(viaDefault.endsWith(join("trademark", "grants.json")),
    `the default must be the documented one, got ${viaDefault}`);
  assert.equal(viaDefault, installPaths(dirname(dirname(viaDefault) + "/x")).grants.replace(/x$/, ""),
    "the shape must come from installPaths");

  // AN EXPLICIT VARIABLE STILL WINS — an operator whose roster lives elsewhere must not be overridden.
  assert.equal(defaultGrantsPath({ env: { CLEAROTRON_ACCESS_FILE: "/srv/roster.json" } }), "/srv/roster.json");

  // AND A MOVED BASE IS FOLLOWED. Setup records CLEAROTRON_REPORTS_DIR as <base>/pool, so the base is its
  // parent — which is how a `--base` install keeps grant and the door pointing at one file.
  assert.equal(defaultGrantsPath({ env: { CLEAROTRON_REPORTS_DIR: "/opt/ct/pool" } }), join("/opt/ct", "grants.json"));
});

test("with nothing set, grant names the real file and a command that writes it", () => {
  const home = mkdtempSync(join(tmpdir(), "f13-nofile-"));
  const r = spawnSync(process.execPath, [join(HERE, "..", "..", "bin", "grant.mjs"), "list"],
    { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, CLEAROTRON_NO_ENV_FILE: "1" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.doesNotMatch(out, /Set CLEAROTRON_ACCESS_FILE/,
    "it must not send the reader to a variable nothing writes — that was the dead end");
  assert.match(out, /grants\.json/, `it must name the file it looked for:\n${out}`);
  assert.match(out, /clearotron start/, `and the command that creates it:\n${out}`);
});

// ── A PERSON IS ACCESS PLUS TWO PERMISSIONS ─────────────────────────────────────────────────────────
//
// `--run` and `--manage` are written through the People page's own editor, and with neither the person is
// view-only — which the command says, because a grant that silently lets somebody do nothing is the kind
// of surprise this command exists to prevent.

test("--run and --manage are written under people, and neither is view-only, said in a sentence", () => {
  const f = withFile(ACME());
  const viewer = run(f, ["add", "reader@acme.test", "--tenant", "acme", "--accounts", "acme-main"]);
  assert.equal(viewer.code, 0, viewer.err);
  assert.equal(read(f).people?.["reader@acme.test"], undefined, "a view-only person needs no entry: absence is both switches off");
  assert.match(viewer.out, /view what this gives them and do nothing else/, "the view-only outcome must be said, not discovered");
  assert.match(viewer.out, /--run/, "…and it must name the flag that changes it");

  const lead = run(f, ["add", "lead@acme.test", "--tenant", "acme", "--accounts", "*", "--run", "--manage"]);
  assert.equal(lead.code, 0, lead.err);
  assert.deepEqual(read(f).people["lead@acme.test"], { run: true, manage: true });
  assert.equal(read(f).tenants.acme.users["lead@acme.test"], "*");
  assert.match(lead.out, /run clearances and manage/);
  assert.deepEqual(resolvePerson("lead@acme.test", read(f)).permissions, { run: true, manage: true },
    "the resolver both doors read must see what was written");
});

test("a grant never takes away access to everything, nor a permission nobody mentioned", () => {
  const g = ACME();
  g.people = { "owner@acme.test": { run: true, manage: true, everything: true }, "runner@acme.test": { run: true, manage: false } };
  const f = withFile(g);
  // THE INSTALLER GIVEN A COMPANY. `withPerson` replaces the entry it writes, so this is the path on which
  // access to the whole install would vanish with nothing said.
  const owner = run(f, ["add", "owner@acme.test", "--tenant", "acme", "--accounts", "acme-eu", "--run"]);
  assert.equal(owner.code, 0, owner.err);
  assert.equal(read(f).people["owner@acme.test"].everything, true, "the person who installed lost access to the whole install");
  // AND A PERSON WHO HOLDS RUN keeps it when a company is added without repeating the flag.
  const r = run(f, ["add", "runner@acme.test", "--tenant", "acme", "--accounts", "acme-eu"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(read(f).people["runner@acme.test"], { run: true, manage: false }, "adding a company silently took Run away");
  assert.match(r.out, /unchanged/);
});

test("removing a person from everywhere removes their permissions and their access to everything", () => {
  const g = ACME();
  g.tenants.acme.users["owner@acme.test"] = "*";
  g.people = { "owner@acme.test": { run: true, manage: true, everything: true } };
  const f = withFile(g);
  // FROM ONE TENANT the entry stays — they may hold access elsewhere — and the command says what remains.
  const one = run(f, ["remove", "owner@acme.test", "--tenant", "acme"]);
  assert.equal(one.code, 0, one.err);
  assert.equal(read(f).people["owner@acme.test"]?.everything, true);
  assert.match(one.out, /still has access to everything/, "a removal that leaves the whole install reachable must say so");
  // FROM EVERYWHERE nothing is left that admits them. A removal that left `everything` behind would report
  // success and revoke nothing.
  const all = run(f, ["remove", "owner@acme.test"]);
  assert.equal(all.code, 0, all.err);
  assert.equal(read(f).people["owner@acme.test"], undefined);
  assert.equal(resolvePerson("owner@acme.test", read(f)), null, "the person removed from everywhere can still get in");
});

test("the first organisation, given whole, is written in a shape the portal loads", () => {
  // An organisation's `accounts` of "*" is refused by the loader, so the first-tenant path must never write
  // it: the organisation holds no company yet, and the person holds the whole organisation.
  const f = withFile({ tenants: {} });
  const r = run(f, ["add", "lawyer@acme.test", "--tenant", "acme", "--accounts", "*"]);
  assert.equal(r.code, 0, r.err);
  const after = read(f);
  assert.deepEqual(after.tenants.acme.accounts, []);
  assert.equal(after.tenants.acme.users["lawyer@acme.test"], "*");
  assert.doesNotThrow(() => assertGrantsShape(after, "grants.json"), "the command wrote a file the portal refuses to load");
});

test("list names a person with access to everything and no tenant row, and no domain rule", () => {
  const g = ACME();
  g.people = { "owner@acme.test": { run: true, manage: true, everything: true } };
  const f = withFile(g);
  const r = run(f, ["list"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /owner@acme\.test/);
  assert.match(r.out, /everything on this install/);
  assert.doesNotMatch(r.out, /arrive by domain/, "the list still describes the deleted domain rule");
});
