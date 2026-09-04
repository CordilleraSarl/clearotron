// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE MECHANISM EXISTED, THE BUTTON DID NOT.
//
// The owner asked for a way to get a clearance off the Clearances page. Every part of that was already
// built except one: `archive-tags.json` is the pool's retired sidecar, `readArchivedSet` reads it,
// `scanAccountRuns` has honoured it since the portal cutover — and the only thing that could WRITE it
// was `pool-admin archive`, a CLI on the pool host. So the capability was live, complete, and reachable
// by nobody using the product.
//
// RETIRE, NOT DELETE. The issue is explicit and the reason is the pool: it is the published copy of real
// client matter, so an irreversible control does not belong on a staff screen. The tag is reversible by
// construction — take the id out and the run is back, unchanged — which is what makes putting the
// control on the screen safe at all.
//
// THE FAILURE THIS COULD HAVE SHIPPED WITH is not the button. It is the WRITE. pool-admin read the whole
// set, mutated it and wrote the whole file back; a portal doing the same thing is two writers on one
// file, and a retire landing in the other's window is simply erased — a run silently back on every
// screen with nothing to say why. So there is now ONE writer, it does its own read, and it renames into
// place.
//
// BREAK MATRIX:
//   · retiring takes the run off the listing        → break: ignore the flag in the scan, arm 1 goes red
//   · ONE file written, the run dir untouched       → break: touch the run dir, arm 2 goes red
//   · restore is the exact inverse                  → break: drop the restore branch, arm 3 goes red
//   · the audit names the actor and the verb        → break: drop the audit call, arm 4 goes red
//   · a client cannot reach any of it               → break: hang it off /portal/api, arm 5 goes red
//   · the retired view is ONLY retired runs         → break: return the whole pool, arm 6 goes red
//   · the writer reads INSIDE itself                → break: take a set from the caller, arm 7 goes red
//   · a retired run's REPORT still resolves         → break: gate the report route, arm 8 goes red
//   · nothing on this path deletes anything         → break: add a delete verb, arm 9 goes red
//   · the SERVED BUNDLE carries the control         → break: skip the rebuild, arm 10 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makePortalService } from "../portal-service.mjs";
import { readArchivedSet, updateArchived, ARCHIVE_TAGS_FILE } from "../publish/archive-tags.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "..", rel), "utf8");
const live = (rel) => src(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join("\n");

const poolWith = (runs = {}) => {
  const root = mkdtempSync(join(tmpdir(), "retire-pool-"));
  for (const [runId, customerKey] of Object.entries(runs)) {
    mkdirSync(join(root, runId), { recursive: true });
    writeFileSync(join(root, runId, "meta.json"), JSON.stringify({ runId, customerKey, markName: runId.toUpperCase() }));
    writeFileSync(join(root, runId, "report.html"), `<title>${runId}</title>ok`);
  }
  return root;
};

const audits = [];
const svcOn = (root) =>
  makePortalService({
    poolRoot: root, workspaceRoot: "/nonexistent", secret: "s",
    staffDomains: ["staff.example"],
    grants: () => ({ tenants: { aurora: { accounts: ["aurora"], users: { "c@aurora.example": ["aurora"] } } } }),
    audit: (rec) => audits.push(rec),
  });

const STAFF = { email: "k@staff.example" };
const CLIENT = { email: "c@aurora.example" };
const idsIn = (res) => res.json.runs.map((r) => r.runId).sort();

test("#611 arm 1 — retiring a run takes it off the listing, and the tag is what did it", async () => {
  const root = poolWith({ plus: "aurora", max: "aurora" });
  const svc = svcOn(root);
  assert.deepEqual(idsIn(await svc.route("GET", "/portal/api/runs", STAFF, {}, { account: "aurora" })), ["max", "plus"]);

  const r = await svc.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["plus"] });
  assert.equal(r.status, 200);
  assert.deepEqual([...readArchivedSet(root)], ["plus"], "the sidecar carries the id, which is the whole mechanism");
  assert.deepEqual(idsIn(await svc.route("GET", "/portal/api/runs", STAFF, {}, { account: "aurora" })), ["max"],
    "…and the listing honours it for staff too — retiring is not a per-reader preference");
});

test("#611 arm 2 — ONE file is written; the run directory is not touched", async () => {
  // "Retiring must not touch the run directory, the pool artifacts, or the matter ledger." The pool IS
  // real client matter, so this is the assertion the issue actually turns on.
  const root = poolWith({ plus: "aurora" });
  const before = readdirSync(join(root, "plus")).sort();
  const bytes = readFileSync(join(root, "plus", "report.html"));
  await svcOn(root).route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["plus"] });

  assert.deepEqual(readdirSync(join(root, "plus")).sort(), before, "no file added to or removed from the run");
  assert.deepEqual(readFileSync(join(root, "plus", "report.html")), bytes, "and nothing inside it rewritten");
  assert.deepEqual(readdirSync(root).filter((f) => !existsSync(join(root, f, "meta.json"))), [ARCHIVE_TAGS_FILE],
    "exactly one file appeared at the pool root, and it is the visibility tag");
});

test("#611 arm 3 — restore is the exact inverse, and does not need a readable run to work", async () => {
  const root = poolWith({ plus: "aurora" });
  const svc = svcOn(root);
  await svc.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["plus"] });
  await svc.route("POST", "/portal/admin/retired", STAFF, { action: "restore", runIds: ["plus"] });
  assert.deepEqual([...readArchivedSet(root)], [], "the tag is gone");
  assert.deepEqual(idsIn(await svc.route("GET", "/portal/api/runs", STAFF, {}, { account: "aurora" })), ["plus"],
    "and the row is back exactly as it was — which is what makes retire safe to offer");

  // THE WAY BACK MUST NOT DEPEND ON THE THING THAT WENT WRONG. A retire can outlive a readable meta
  // (a half-written republish, a run moved by hand); refusing to restore in exactly that case is
  // refusing at the moment the control is most needed.
  const orphan = poolWith({});
  updateArchived(orphan, (s) => s.add("vanished"));
  const back = await svcOn(orphan).route("POST", "/portal/admin/retired", STAFF, { action: "restore", runIds: ["vanished"] });
  assert.equal(back.status, 200);
  assert.deepEqual([...readArchivedSet(orphan)], []);
  // …but RETIRING an id that names no run is still refused: an unchecked id writes a tag nothing can
  // ever explain or remove from a screen.
  const bogus = await svcOn(orphan).route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["nope"] });
  assert.equal(bogus.status, 400);
});

test("#611 arm 4 — the audit names the actor, the verb and the account", async () => {
  audits.length = 0;
  const root = poolWith({ plus: "aurora" });
  const svc = svcOn(root);
  await svc.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["plus"] });
  await svc.route("POST", "/portal/admin/retired", STAFF, { action: "restore", runIds: ["plus"] });
  assert.deepEqual(audits.map((a) => a.event), ["run-retire", "run-restore"],
    "both directions are filed — an un-retire nobody can trace is a run reappearing for no reason");
  assert.ok(audits.every((a) => a.by === STAFF.email), "with the actor's email, like family-group already does");
  assert.ok(audits.every((a) => a.account === "aurora"), "and the owner, resolved from the run rather than the body");
});

test("#611 arm 5 — a client cannot see or set this, and is told 404 rather than 403", async () => {
  // 404-never-403, the house rule for anything tenant-scoped. The sanity check matters as much as the
  // assertion: a client whose every request 404'd would pass this test for the wrong reason.
  const root = poolWith({ plus: "aurora" });
  const svc = svcOn(root);
  const [runs, get, post] = await Promise.all([
    svc.route("GET", "/portal/api/runs", CLIENT, {}, { account: "aurora" }),
    svc.route("GET", "/portal/admin/retired", CLIENT),
    svc.route("POST", "/portal/admin/retired", CLIENT, { action: "retire", runIds: ["plus"] }),
  ]);
  assert.equal(runs.status, 200, "the same client CAN read their own runs — the 404s below are the gate");
  assert.equal(get.status, 404);
  assert.equal(post.status, 404);
  assert.deepEqual([...readArchivedSet(root)], [], "and the refused write wrote nothing");
});

test("#611 arm 6 — the retired view is the FOLD: only retired runs, never a second copy of the page", async () => {
  const root = poolWith({ plus: "aurora", max: "aurora" });
  const svc = svcOn(root);
  await svc.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["plus"] });
  assert.deepEqual(idsIn(await svc.route("GET", "/portal/admin/retired", STAFF)), ["plus"],
    "the live run is NOT in the fold — you open it to find what you filed");
  assert.deepEqual(idsIn(await svc.route("GET", "/portal/api/runs", STAFF, {}, { account: "aurora" })), ["max"],
    "and the retired one is not in the listing: the two views partition the pool");
});

test("#611 arm 7 — the writer does its own read, so a concurrent retire is not erased", () => {
  // THE LOST UPDATE, reproduced. pool-admin and the portal both write this file, as different users.
  // The old shape was read → mutate → write-whole-file, with the read at the CALL SITE: anything the
  // other writer added between the two is gone.
  const root = poolWith({});
  updateArchived(root, (s) => s.add("first"));

  // A caller holding a stale snapshot — exactly what pool-admin's `list`-then-`archive` did.
  const stale = readArchivedSet(root);
  updateArchived(root, (s) => s.add("meanwhile"));         // the other writer lands here
  updateArchived(root, (s) => {
    assert.ok(s.has("meanwhile"), "THE FIX: the set handed to the mutator is read inside the writer, not passed in");
    assert.ok(!stale.has("meanwhile"), "premise: the caller's own snapshot never saw it");
    return s.add("second");
  });
  assert.deepEqual([...readArchivedSet(root)].sort(), ["first", "meanwhile", "second"],
    "every writer's id survives — with the old shape 'meanwhile' would be gone");

  // Written by RENAME, so a reader never sees a half-file and a crash leaves the previous one intact.
  const w = live("driver/publish/archive-tags.mjs");
  assert.match(w, /renameSync\(tmp, target\)/, "atomic replace");
  assert.match(w, /mutate\(readArchivedSet\(poolDir\)\)/, "and the read is INSIDE the writer");
  // pool-admin must not have kept a private writer beside it.
  const pa = live("driver/publish/pool-admin.mjs");
  assert.ok(!/function writeTags/.test(pa), "one writer, or the race comes back through the other door");
  assert.match(pa, /updateArchived\(POOL, \(set\) =>/, "…and the CLI goes through it");
});

test("#611 arm 8 — retiring a run does NOT revoke its report link", async () => {
  // Retirement is about what the pool ADVERTISES, not about who may read what. The link is in mail we
  // have already sent, and 404ing it from a curation command is not what "retire" means to the person
  // clicking it.
  const root = poolWith({ plus: "aurora" });
  const svc = svcOn(root);
  await svc.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["plus"] });
  assert.equal((await svc.route("GET", "/portal/report/plus/", STAFF)).status, 200, "staff");
  assert.equal((await svc.route("GET", "/portal/report/plus/", CLIENT)).status, 200, "and the client whose run it is");
});

test("#611 arm 9 — nothing on this path deletes anything, and the screen never offers to", () => {
  const svc = live("driver/portal-service.mjs");
  const at = svc.indexOf('parts[2] === "retired"');
  assert.ok(at > 0, "the route is where this test thinks it is");
  const route = svc.slice(at, at + 3000);
  assert.ok(!/rmSync|unlinkSync|rmdirSync/.test(route),
    "the pool is the published copy of real client matter — this route writes ONE tag and nothing else");
  const screen = live("portal-ui/src/screens/Clearances.tsx");
  assert.ok(!/>\s*Delete\s*</.test(screen), "no delete control, now or by drift");
  assert.match(screen, /api\.setRetired\(\{ action: 'retire', runIds \}\)/, "the row control calls the audited capability");
  assert.match(screen, /api\.setRetired\(\{ action: 'restore', runIds: \[run\.runId\] \}\)/, "…and so does the way back");
  // The confirm answers the thing a person actually fears before it asks for a decision.
  const handler = screen.slice(screen.indexOf("const retireMark"), screen.indexOf("const retireMark") + 900);
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /report links keep working/);
  assert.match(handler, /mark\.reads\.map\(\(r\) => r\.runId\)/,
    "a row is a name and the tag is per run — retiring one read of a retired name is a half-done act");
});

test("#611 arm 10 — the SERVED BUNDLE carries it; portal-ui/dist is what the browser gets", (ctx) => {
  // The source is not the surface. `portal-ui/dist` is committed on purpose and portal-static serves it
  // verbatim, so a source-only fix leaves the user on the old screen while every other test passes.
  const dir = join(HERE, "..", "..", "portal-ui", "dist", "assets");
  // BUILD OUTPUT, NOT SOURCE. `portal-ui/dist` is withheld from the public cut, so this arm has
  // nothing to read there. A STATED skip, never a silent pass: the defect it guards — a source-only
  // fix leaving the served bundle stale — cannot exist in a tree that commits no bundle, and in a
  // tree that does, this still runs.
  if (!existsSync(dir)) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");

  const bundles = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(bundles.length, "there is a built bundle at all");
  const anyHas = (needle) => bundles.some((b) => readFileSync(join(dir, b), "utf8").includes(needle));
  // ANCHORED ON THE TOGGLE ITSELF, not on the phrase "Show retired". That phrase is in the confirm and
  // in the row tooltip too, so a bundle carrying those and NOT the control passed this arm — caught by
  // the break matrix, which is the only reason this reads the way it does now.
  assert.ok(anyHas("Show retired ("), "the served bundle has no way into the fold — dist was not rebuilt");
  assert.ok(anyHas("Hide retired"), "…the toggle does not close either, so it is not the control at all");
  assert.ok(anyHas("report links keep working"), "…nor is the confirm there");
  assert.ok(anyHas("/portal/admin/retired"), "…nor the route it calls");
});
