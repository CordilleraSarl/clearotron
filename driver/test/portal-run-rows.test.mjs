// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE RUN ROW NAMES ITS PRODUCT, and the name comes off the one resolver.
//
// A run card and a queue row call a search something. That string used to be built in the BROWSER, by a
// switch from product key to label in portal-ui/src/contract/home.ts — a second mapping table for a name
// the server already resolves for the delivered report's masthead. It drifted exactly the way a second
// table does: it listed the five retired depth slugs and none of the four products, so every run this
// build creates rendered a blank chip, and the browser test went green because it iterated the retired
// keys only.
//
// The switch is deleted and the wire carries `productName`. The guarantee the browser test used to hold
// therefore lives HERE, on the side that now decides it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { PRODUCT_IDS } from "../products.mjs";
import { reportIdentityFor, PRODUCT_POLICIES, RETIRED_POLICIES } from "../search-policy.mjs";
import { scanAccountRuns } from "../portal-service.mjs";

// The same expression portal-service.mjs's `productNameOf` evaluates. Kept as a local mirror rather than
// exported from the service, because portal-service.mjs binds a live HTTP surface at import.
const productNameOf = (product) => (typeof product === "string" ? reportIdentityFor(product).identity ?? null : null);

test("#463 every ORDERABLE product names itself on a run row, in the offering's own words", () => {
  assert.ok(PRODUCT_IDS.length === 4, "precondition: the offering is four products");
  for (const id of PRODUCT_IDS) {
    const name = productNameOf(id);
    assert.ok(name, `${id} — every orderable product must name itself on a card`);
    // This is the assertion the blank chip defeated: the row must resolve for the ids the build CREATES,
    // not merely for the ones it has retired.
    assert.equal(name, PRODUCT_POLICIES[id].report.identity, `${id} names itself off its own registry row`);
  }
});

test("#463 no stage or depth number reaches a run row — including on a retired run", () => {
  // "Stage 1" and "Stage 2" already mean the two halves of the legal reasoning inside every report sent,
  // so a card saying either is not jargon leaking — it is a different, wrong meaning arriving in the one
  // place a client will read it. "Depth N" is the retired ladder.
  for (const id of [...PRODUCT_IDS, ...Object.keys(RETIRED_POLICIES)]) {
    const name = productNameOf(id);
    assert.ok(name, `${id} has a name — an archived run still says what it was sold as`);
    assert.doesNotMatch(name, /\bstage\b/i, `${id} must not say "stage"`);
    assert.doesNotMatch(name, /\bdepth\s*\d/i, `${id} must not carry a depth number`);
  }
  // The trap this guards: `.banner` and `.stageLabel` BOTH carry the rung on a retired row, and either
  // would have been a one-word change in portal-service.mjs.
  assert.match(reportIdentityFor("prelim").banner, /Depth 4/, "precondition: banner is the field that leaks");
  assert.equal(reportIdentityFor("prelim").stageLabel, "Depth 4", "precondition: so does stageLabel");
  assert.equal(productNameOf("prelim"), "Preliminary clearance", "the row takes neither");
});

test("#463 the retired preliminaries stay distinguishable — the reason the card wraps instead of truncating", () => {
  // Ellipsised, "Preliminary clearance — register only" and "Preliminary clearance" collapse to the same
  // string, and they are close to opposite. Archived runs still carry both.
  const names = ["prelim", "prelim-register-only", "prelim-jx"].map(productNameOf);
  assert.equal(new Set(names).size, 3, "three retired preliminaries, three distinct names");
});

test("#463 a level the registry has forgotten resolves to NOTHING, never a guess", () => {
  assert.equal(productNameOf("something-new"), null);
  assert.equal(productNameOf(null), null);
  assert.equal(productNameOf(undefined), null);
});

// ── the ROW ITSELF, off the real scan ────────────────────────────────────────────────────────────────
//
// Everything above mirrors `productNameOf` and can only prove the resolver answers. It cannot see a row
// that never calls it — and one did not: the QUEUED row set `product` and no name at all, which the
// browser covered for by mapping the key itself. With that mapping deleted, a queued row would have
// rendered a bare date on the one screen a client opens straight after pressing Start. So the scan runs.
//
// The job file is the shape driver/test/runner.knockout-e2e.test.mjs enqueues and the runner consumes.
function withQueued(job, fn) {
  const root = mkdtempSync(join(tmpdir(), "portal-rows-"));
  try {
    const q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
    mkdirSync(q, { recursive: true });
    mkdirSync(join(root, "pool"), { recursive: true });
    writeFileSync(join(q, `${job.id}.json`), JSON.stringify(job, null, 2));
    const rows = scanAccountRuns({ poolRoot: join(root, "pool"), workspaceRoot: root, account: job.profileKey });
    assert.equal(rows.length, 1, "the queued job is the only row");
    return fn(rows[0]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const KO_JOB = {
  id: "ko-queued", msgId: "<ko-queued@x>", forwarder: "jordan", forwarderDomain: "example.com",
  profileKey: "aurora", product: "knockout-search", ref: "TMP9100", markName: "IRONWHISK",
  marks: [{ name: "IRONWHISK", classes: [8, 21] }, { name: "CLUVENDRA", classes: [8] }, { name: "SUNDAY ROAST CLUB", classes: [21, 35] }],
  classes: [8, 21, 35], goods: "kitchen tools; household utensils",
};

test("#463 a QUEUED row names the product it ordered, off the same resolver as a delivered one", () => {
  withQueued(KO_JOB, (row) => {
    assert.equal(row.state, "queued");
    assert.equal(row.product, "knockout-search");
    assert.equal(row.productName, "Knockout search", "the ordered product, named — not left for the browser to map");
    // Nothing is frozen until the run starts, so there is no stamped face to carry, and the row must not
    // invent one: a queued row asserting a rung would be the depth ladder back on a client's screen.
    assert.equal(row.stageLabel, null);
  });
  // A product the registry cannot name resolves to null rather than to the key — the row shows nothing
  // rather than a slug the client never saw in the offering.
  withQueued({ ...KO_JOB, product: "something-new" }, (row) => {
    assert.equal(row.productName, null);
  });
});

// (read side) — A BATCH IS N NAMES ON EVERY ROW IT APPEARS ON.
//
// The queued row is the window between pressing Start and the driver writing a status.json, and it was
// the only row in the listing that contradicted its own `product` field: it carried
// `product: "knockout-search"` and called itself `kind: "clearance"`, a literal. Result.tsx gates the
// names line on that kind, so a three-name batch showed no names at all — and the mark string beside it
// named ONE of the three, because the row took `marks[0].name`.
test("#472 a QUEUED knockout batch is a batch, and carries every name it was submitted with", () => {
  withQueued(KO_JOB, (row) => {
    assert.equal(row.kind, "knockout-batch", "the row's own product says knockout — it cannot also say clearance");
    assert.deepEqual(row.marks.map((m) => m.name), ["IRONWHISK", "CLUVENDRA", "SUNDAY ROAST CLUB"]);
    // Nothing is rated before the run starts. Names, never bands.
    assert.deepEqual([...new Set(row.marks.map((m) => m.band))], [null]);
    assert.equal(row.markName, "IRONWHISK +2 more", "the same spelling the delivered meta and the live status use");
  });
  // A clearance job stays a clearance and reads exactly as it did: one name, the one that was typed.
  withQueued({ ...KO_JOB, id: "cl-queued", product: "global-preliminary-search", markName: "AQUAPLUS", marks: [{ name: "AQUAPLUS", classes: [9] }] }, (row) => {
    assert.equal(row.kind, "clearance");
    assert.equal(row.markName, "AQUAPLUS");
    assert.deepEqual(row.marks.map((m) => m.name), ["AQUAPLUS"]);
  });
  // A product this build cannot place stays a clearance — that is what the listing has always shown for
  // anything it could not identify, and guessing "batch" would be worse than the old literal.
  withQueued({ ...KO_JOB, product: "something-new" }, (row) => {
    assert.equal(row.kind, "clearance");
  });
});

// The LIVE row. `marks: []` was deliberate — its own comment said a live run has no band ladder yet —
// but ONE array answered two questions and the second answer was false: the Result screen reads the
// length as a NAME count, so a running three-name batch told the customer it had "0 names", on a row
// whose mark string beside it said otherwise.
function withLive(status, fn) {
  const root = mkdtempSync(join(tmpdir(), "portal-rows-live-"));
  try {
    const dir = join(root, "workspace-clawdi", "studio", "prelim-search", "tmp9100-ironwhisk", "2026-08-07-fixture");
    mkdirSync(driverDir(dir), { recursive: true });
    mkdirSync(join(root, "pool"), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify(status, null, 2));
    writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: "aurora" }));
    writeFileSync(driverDir(dir, "search-policy.json"), JSON.stringify({ schema: 1, level: "knockout-search", pipeline: "knockout" }));
    const rows = scanAccountRuns({ poolRoot: join(root, "pool"), workspaceRoot: root, account: "aurora" });
    assert.equal(rows.length, 1);
    return fn(rows[0]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("#472 a RUNNING knockout batch reports the names it is reading, and no band for any of them", () => {
  // The shape pipeline-knockout.mjs writes at dispatch.
  withLive({ schema: 1, runId: "tmp9100-ironwhisk-2026-08-07-fixture", slug: "tmp9100-ironwhisk", state: "running", lane: "knockout",
             markName: "IRONWHISK +2 more", marks: [{ name: "IRONWHISK" }, { name: "CLUVENDRA" }, { name: "SUNDAY ROAST CLUB" }],
             updatedAt: "2026-08-07T09:00:00Z" }, (row) => {
    assert.equal(row.kind, "knockout-batch");
    assert.deepEqual(row.marks.map((m) => m.name), ["IRONWHISK", "CLUVENDRA", "SUNDAY ROAST CLUB"]);
    assert.equal(row.marks.length, 3, "the screen renders this length as a name count — 0 was a false statement");
    assert.deepEqual([...new Set(row.marks.map((m) => m.band))], [null], "a live run has no band ladder, and must not invent one");
    assert.equal(row.band, null);
    assert.deepEqual(row.bands, []);
  });
  // A run whose status predates the stamp carries no names and says so — never a fabricated one.
  withLive({ schema: 1, runId: "r", slug: "s", state: "running", lane: "knockout", markName: "OLDRUN", updatedAt: "2026-08-07T09:00:00Z" }, (row) => {
    assert.deepEqual(row.marks, []);
  });
});
