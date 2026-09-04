// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Mark families — the sidecar, and the one wall that matters around it.
//
// A family is curation: somebody asserted that two names are one piece of work. Two properties decide
// whether that is safe to store, and both are tested as breaches rather than as features — it must
// survive the operation designed to rewrite the pool, and it must never put one customer's marks under
// another customer's heading.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { familyId, familiesView, groupRuns, ungroupRuns, readFamilies } from "../portal-families.mjs";

const poolWith = (runs = {}) => {
  const root = mkdtempSync(join(tmpdir(), "fam-pool-"));
  for (const [runId, customerKey] of Object.entries(runs)) {
    mkdirSync(join(root, runId), { recursive: true });
    writeFileSync(join(root, runId, "meta.json"), JSON.stringify({ runId, customerKey }));
  }
  return root;
};

test("grouping two runs puts them under one named family", () => {
  const root = poolWith({ plus: "aurora", max: "aurora" });
  const r = groupRuns(root, { name: "Hydra range", runIds: ["plus", "max"], account: "aurora" });
  assert.equal(r.familyId, "hydra-range");
  assert.equal(r.runs, 2);

  const view = familiesView(root, "aurora");
  assert.deepEqual(view.of, { plus: "hydra-range", max: "hydra-range" });
  assert.equal(view.names["hydra-range"], "Hydra range");
});

test("the id is derived from the name, so grouping into it twice MERGES rather than duplicating", () => {
  // Otherwise a second "Hydra range" would appear as a second heading with the same words on it.
  const root = poolWith({ a: "aurora", b: "aurora" });
  groupRuns(root, { name: "Hydra range", runIds: ["a"], account: "aurora" });
  groupRuns(root, { name: "hydra  RANGE", runIds: ["b"], account: "aurora" });
  const view = familiesView(root, "aurora");
  assert.equal(Object.keys(view.names).length, 1, "one family, not two");
  assert.deepEqual(Object.keys(view.of).sort(), ["a", "b"]);
});

test("ONE CUSTOMER'S FAMILY NEVER ADOPTS ANOTHER'S — same name, different owner, refused", () => {
  // Two clients can both have a "Core range". The ids collide by construction, and silently merging them
  // would file one customer's marks under the other's heading — the failure this whole module exists to
  // avoid, and the silent kind.
  const root = poolWith({ ours: "aurora", theirs: "borealis" });
  groupRuns(root, { name: "Core range", runIds: ["ours"], account: "aurora" });
  const r = groupRuns(root, { name: "Core range", runIds: ["theirs"], account: "borealis" });
  assert.ok(r.error, "refused");
  assert.equal(familiesView(root, "borealis").of["theirs"], undefined);
});

test("a family is scoped on READ as well as on write", () => {
  // Belt and braces. The route resolves the account from each run's own meta, but the view is what
  // actually reaches a browser, and it must not carry another owner's brand-line names.
  const root = poolWith({ ours: "aurora", theirs: "borealis" });
  groupRuns(root, { name: "Ours", runIds: ["ours"], account: "aurora" });
  groupRuns(root, { name: "Theirs", runIds: ["theirs"], account: "borealis" });

  const mine = familiesView(root, "aurora");
  assert.deepEqual(Object.keys(mine.names), ["ours"]);
  assert.deepEqual(Object.keys(mine.of), ["ours"]);
  assert.ok(!JSON.stringify(mine).includes("Theirs"), "not one byte of the other owner's family");

  const all = familiesView(root, null);
  assert.equal(Object.keys(all.names).length, 2, "the staff all-owners view still sees both");
});

test("THE SIDECAR SURVIVES A REPUBLISH — this is why it is not in meta.json", () => {
  // The whole reason for the file. `rerender-all` rewrites every meta.json in the pool; a family flag
  // stored there would be erased by the operation meant to bring old reports up to date.
  const root = poolWith({ plus: "aurora" });
  groupRuns(root, { name: "Hydra range", runIds: ["plus"], account: "aurora" });

  // Simulate the republish: meta.json rewritten from scratch, exactly as publishReport does.
  writeFileSync(join(root, "plus", "meta.json"), JSON.stringify({ runId: "plus", customerKey: "aurora" }));

  assert.equal(familiesView(root, "aurora").of["plus"], "hydra-range", "the grouping is still there");
});

test("ungrouping removes the run and drops a family left with nothing in it", () => {
  const root = poolWith({ a: "aurora", b: "aurora" });
  groupRuns(root, { name: "Hydra range", runIds: ["a", "b"], account: "aurora" });

  ungroupRuns(root, { runIds: ["a"] });
  let view = familiesView(root, "aurora");
  assert.deepEqual(Object.keys(view.of), ["b"], "the family survives while it still has a member");

  ungroupRuns(root, { runIds: ["b"] });
  view = familiesView(root, "aurora");
  assert.deepEqual(view.names, {}, "an empty family is not a family");
  assert.deepEqual(view.of, {});
});

test("A MALFORMED SIDECAR DEGRADES TO NO FAMILIES — it never takes the list down", () => {
  // The file is hand-editable on purpose: it is how staff fix a mis-grouping without the UI. A typo in it
  // must cost the grouping, not the Clearances page.
  const root = poolWith({ a: "aurora" });
  writeFileSync(join(root, "family-tags.json"), "{ this is not json");
  assert.deepEqual(familiesView(root, "aurora"), { of: {}, names: {} });
  assert.deepEqual(readFamilies(root).families, {});
});

test("a sidecar with the right JSON but the wrong shape is also survivable", () => {
  const root = poolWith({ a: "aurora" });
  writeFileSync(join(root, "family-tags.json"), JSON.stringify({ families: "nope", of: 42 }));
  assert.deepEqual(familiesView(root, "aurora"), { of: {}, names: {} });
});

test("a run pointing at a family that no longer exists is dropped from the view", () => {
  // Otherwise the browser would group a mark under an id with no name and render the raw slug as a
  // heading, which reads as corruption rather than as the stale pointer it is.
  const root = poolWith({ a: "aurora" });
  writeFileSync(join(root, "family-tags.json"), JSON.stringify({ schema: 1, families: {}, of: { a: "ghost" } }));
  assert.deepEqual(familiesView(root, "aurora").of, {});
});

test("writes land atomically — no temp file is left beside the pool", () => {
  const root = poolWith({ a: "aurora" });
  groupRuns(root, { name: "Hydra range", runIds: ["a"], account: "aurora" });
  assert.ok(existsSync(join(root, "family-tags.json")));
  assert.ok(!existsSync(join(root, "family-tags.json.tmp")), "the temp file was renamed, not left behind");
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, "family-tags.json"), "utf8")));
});

test("a nameless family is refused rather than minted with a blank heading", () => {
  const root = poolWith({ a: "aurora" });
  for (const name of ["", "   ", "!!!", null, undefined]) {
    assert.ok(groupRuns(root, { name, runIds: ["a"], account: "aurora" }).error, `${JSON.stringify(name)} refused`);
  }
});

test("run ids that are not one path segment never reach the store", () => {
  // The store is keyed by run id and the id also names a directory elsewhere in the service. Nothing
  // traversal-shaped is written into a file that another reader will trust.
  const root = poolWith({ a: "aurora" });
  const r = groupRuns(root, { name: "Hydra range", runIds: ["../../etc/passwd", "a/b", ".."], account: "aurora" });
  assert.ok(r.error, "nothing valid was left to group");
  assert.deepEqual(familiesView(root, "aurora").of, {});
});

test("familyId folds case, spacing and accents but never collides two real words", () => {
  assert.equal(familyId("Hydra range"), "hydra-range");
  assert.equal(familyId("HYDRA  RANGE"), "hydra-range");
  assert.equal(familyId("Café Line"), "cafe-line");
  assert.notEqual(familyId("Hydra range"), familyId("Hydra ranger"));
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────────
//
// The first MUTATING endpoint in this service, so the wall around it is tested at the route rather than
// only in the module beneath it.

import { makePortalService } from "../portal-service.mjs";

const svcOn = (root) =>
  makePortalService({
    poolRoot: root, workspaceRoot: "/nonexistent", secret: "s",
    staffDomains: ["staff.example"],
    grants: () => ({ tenants: { aurora: { accounts: ["aurora"], users: { "c@aurora.example": ["aurora"] } } } }),
  });

const STAFF = { email: "k@staff.example" };
const CLIENT = { email: "c@aurora.example" };

test("A CLIENT CANNOT SEE OR SET FAMILIES, and is told 404 rather than 403", () => {
  // 404-never-403 is the house rule for anything tenant-scoped: a 403 confirms the surface exists. The
  // sanity check matters as much as the assertion — a client whose every request 403'd would pass this
  // test for the wrong reason.
  const root = poolWith({ plus: "aurora" });
  const svc = svcOn(root);
  return Promise.all([
    svc.route("GET", "/portal/api/runs", CLIENT, {}, { account: "aurora" }),
    svc.route("GET", "/portal/admin/families", CLIENT),
    svc.route("POST", "/portal/admin/families", CLIENT, { name: "X", runIds: ["plus"] }),
  ]).then(([runs, get, post]) => {
    assert.equal(runs.status, 200, "the same client CAN read their own runs — the 404s below are the families gate");
    assert.equal(get.status, 404);
    assert.equal(post.status, 404);
  });
});

test("staff can group and ungroup, and the change is visible on the next read", async () => {
  const root = poolWith({ plus: "aurora", max: "aurora" });
  const svc = svcOn(root);

  const made = await svc.route("POST", "/portal/admin/families", STAFF, { name: "Hydra range", runIds: ["plus", "max"] });
  assert.equal(made.status, 200);
  assert.equal(made.json.familyId, "hydra-range");

  const seen = await svc.route("GET", "/portal/admin/families", STAFF);
  assert.deepEqual(seen.json.of, { plus: "hydra-range", max: "hydra-range" });

  await svc.route("POST", "/portal/admin/families", STAFF, { action: "ungroup", runIds: ["plus", "max"] });
  assert.deepEqual((await svc.route("GET", "/portal/admin/families", STAFF)).json, { of: {}, names: {} });
});

test("THE OWNER COMES FROM THE RUNS, NOT THE BODY — a cross-owner family is refused", async () => {
  // A body-supplied owner is a body-supplied tenancy claim. Each run's account is read from its own
  // meta.json, and a request spanning two owners is refused rather than filed under one of them.
  const root = poolWith({ ours: "aurora", theirs: "borealis" });
  const r = await svcOn(root).route("POST", "/portal/admin/families", STAFF, { name: "Mixed", runIds: ["ours", "theirs"] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /different brand owners/);
});

test("a run that is not in the pool cannot be filed, however well-formed the id", async () => {
  const root = poolWith({ plus: "aurora" });
  for (const runIds of [["nope"], ["../../etc/passwd"], ["a/b"], [".."], []]) {
    const r = await svcOn(root).route("POST", "/portal/admin/families", STAFF, { name: "X", runIds });
    assert.equal(r.status, 400, `${JSON.stringify(runIds)} refused`);
  }
});

test("the GET is scoped by account, so one client's brand lines never ride along", async () => {
  const root = poolWith({ ours: "aurora", theirs: "borealis" });
  const svc = svcOn(root);
  await svc.route("POST", "/portal/admin/families", STAFF, { name: "Ours", runIds: ["ours"] });
  await svc.route("POST", "/portal/admin/families", STAFF, { name: "Theirs", runIds: ["theirs"] });

  const scoped = await svc.route("GET", "/portal/admin/families", STAFF, {}, { account: "borealis" });
  assert.deepEqual(Object.values(scoped.json.names), ["Theirs"]);
  assert.ok(!JSON.stringify(scoped.json).includes("Ours"));
});

test("only GET and POST are mounted — no verb is answered by accident", async () => {
  const root = poolWith({ plus: "aurora" });
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const r = await svcOn(root).route(method, "/portal/admin/families", STAFF, { runIds: ["plus"] });
    assert.equal(r.status, 404, `${method} is not mounted`);
  }
});

// ── the run listing's new fields ─────────────────────────────────────────────────────────────────────
//
// These live here rather than in their own file because they are the same wire the families view rides
// on, and they have the same failure mode: a refactor that quietly drops a field would leave every test
// around them passing while the Clearances list lost its names or its stages.

import { scanAccountRuns } from "../portal-service.mjs";

const poolOf = (metas) => {
  const root = mkdtempSync(join(tmpdir(), "scan-pool-"));
  for (const [runId, meta] of Object.entries(metas)) {
    mkdirSync(join(root, runId), { recursive: true });
    writeFileSync(join(root, runId, "meta.json"), JSON.stringify({ runId, customerKey: "aurora", ...meta }));
  }
  return root;
};
const scan = (root) => scanAccountRuns({ poolRoot: root, workspaceRoot: "/nonexistent" });

test("THE TYPED MARK REACHES THE WIRE, separately from the report's headline", () => {
  // Shaped on the real delivered run: markName "AquaPlus", title the model's whole headline. The UI
  // names rows and groups threads from the first and must never fall back to the second while the first
  // is there.
  const root = poolOf({
    plus: { markName: "AquaPlus", title: "AquaPlus — US Preliminary Trademark Clearance" },
  });
  const row = scan(root)[0];
  assert.equal(row.markName, "AquaPlus");
  assert.equal(row.title, "AquaPlus — US Preliminary Trademark Clearance", "the headline still travels, for the fallback");
});

test("a run predating markName reports null rather than borrowing the title", () => {
  // Three of the five pool runs are like this. Null is what makes the browser's fallback visible; a
  // server-side copy of the title into markName would hide which runs still need re-rendering.
  const row = scan(poolOf({ arbora: { title: "ARBORA" } }))[0];
  assert.equal(row.markName, null);
});

test("THE STAGE IS DERIVED FROM THE LEVEL, so runs delivered before stageLabel still show one", () => {
  // `product` has been in meta longer than `stageLabel`, and the label is a pure function of the
  // level — so the two July-19 runs get their stage today without a re-render.
  const rows = scan(poolOf({
    a: { searchLevel: "global-preliminary-search" },
    b: { searchLevel: "knockout-search" },
    c: { searchLevel: "global-preliminary-search", stageLabel: "Stage 1" },
  }));
  const by = Object.fromEntries(rows.map((r) => [r.runId, r]));
  assert.equal(by.a.stageLabel, "Global preliminary search", "derived");
  assert.equal(by.b.stageLabel, "Knockout search", "derived");
  // THE REGISTRY WINS over a frozen stamp — the same rule reportIdentityFor follows, and it has to be
  // the same rule or one run has two names on one screen. `c` was stamped "Stage 1" before the Depth
  // renumbering; its report banner now reads "Global preliminary search", so this row must too.
  assert.equal(by.c.stageLabel, "Global preliminary search", "a retired label must not drag the old scale into this list");
});

test("a level the registry no longer knows falls back to its frozen stamp rather than a blank", () => {
  // The one case where the stamp still speaks: there is no current answer for a retired row, and the
  // last thing anyone recorded beats an empty cell. Not a second numbering system — a last resort.
  const row = scan(poolOf({ gone: { searchLevel: "retired-level", stageLabel: "Stage 2 (retired)" } }))[0];
  assert.equal(row.stageLabel, "Stage 2 (retired)");
});

test("a run older than the level registry reports no stage rather than an invented one", () => {
  const row = scan(poolOf({ old: { title: "PETCARY" } }))[0];
  assert.equal(row.product, null);
  assert.equal(row.stageLabel, null);
});

test("an unrecognised level does not become a stage", () => {
  // The registry is the authority. A level it does not know is a level this build cannot describe, and
  // guessing a label for it would put a stage on screen that no policy defines.
  const row = scan(poolOf({ weird: { product: "not-a-level" } }))[0];
  assert.equal(row.stageLabel, null);
});
