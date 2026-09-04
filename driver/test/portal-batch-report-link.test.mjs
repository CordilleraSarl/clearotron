// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a delivered batch's reports are REACHABLE, and the row says only what is true.
//
// Raised from the portal by the owner: a delivered two-mark knockout showed
//
//     "With Cordillera for a final read before release."
//
// There is no such review step. The run had delivered; both reports were in the pool. Three defects,
// stacked, and each one alone was enough to break the link:
//
//   1. `publish/knockout.mjs` computed a per-mark `slug` and then DESTRUCTURED IT AWAY when writing
//      meta.json. Every consumer that links a per-mark document needs it.
//   2. So `reportsOf()` returned slug:null, the portal built the RUN-LEVEL url for both marks, and
//      `resolveReportFile(meta, null)` answers null for a batch by design (: serving mark one of
//      eight as "the report" is exactly what that issue removed). Both links 404'd.
//   3. `Clearances.tsx` gated its whole row on `read.report` — the run-level link, which the service
//      sets null for a batch ON PURPOSE — so the row never opened and fell through to that sentence.
//
// The sentence is the part that mattered most: it explained a filename the portal did not recognise as
// an internal review step, to a paying customer, and it could not be right in either branch.
//
// Run:  node --test driver/test/portal-batch-report-link.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reportsOf, resolveReportFile } from "../portal-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, "..", "..", p), "utf8");

// A batch meta as the FIXED publisher writes it.
const BATCH = {
  runId: "run-1", kind: "knockout-batch", markName: "CORAL FREEZE +1 more",
  reports: [
    { mark: "CORAL FREEZE", slug: "coral-freeze", file: "report-coral-freeze.html", band: "Medium" },
    { mark: "CINDER LANTERN", slug: "cinder-lantern", file: "report-cinder-lantern.html", band: "Medium" },
  ],
};
// The same batch as ALREADY PUBLISHED — the shape found in the pool, with no slug.
const LEGACY_BATCH = { ...BATCH, reports: BATCH.reports.map(({ slug, ...r }) => r) };
const SINGLE = { runId: "run-2", kind: "clearance", markName: "BREEZEBERRY" };

test("#583 every per-mark report resolves to its own file, and to a DIFFERENT one", () => {
  const rows = reportsOf(BATCH);
  assert.deepEqual(rows.map((r) => r.slug), ["coral-freeze", "cinder-lantern"]);
  assert.equal(resolveReportFile(BATCH, "coral-freeze"), "report-coral-freeze.html");
  assert.equal(resolveReportFile(BATCH, "cinder-lantern"), "report-cinder-lantern.html");
  assert.notEqual(resolveReportFile(BATCH, "coral-freeze"), resolveReportFile(BATCH, "cinder-lantern"),
    "two names, two documents — a batch that served one for both would be #472's defect returning");
});

test("#583 a batch ALREADY in the pool heals off its own filename — no republish needed", () => {
  // A republish is not something the reader of a delivered report can ask for, so every batch published
  // before the slug rode has to link correctly as it stands. `report-<slug>.html` has always been the
  // publisher's name for a per-mark document, so this recovers the slug exactly rather than guessing.
  assert.deepEqual(reportsOf(LEGACY_BATCH).map((r) => r.slug), ["coral-freeze", "cinder-lantern"]);
  assert.equal(resolveReportFile(LEGACY_BATCH, "coral-freeze"), "report-coral-freeze.html");
});

test("#583 a batch still has NO run-level document, and asking for one still resolves to nothing", () => {
  // The fix must not smuggle in the behaviour removed. A slug-less request for a batch resolves to
  // NOTHING — never to its first mark.
  assert.equal(resolveReportFile(BATCH, null), null);
  assert.equal(resolveReportFile(LEGACY_BATCH, null), null);
  // …while a single-document run is untouched in both directions.
  assert.deepEqual(reportsOf(SINGLE), [{ mark: "BREEZEBERRY", slug: null, file: "report.html" }]);
  assert.equal(resolveReportFile(SINGLE, null), "report.html");
});

test("#583 the publisher writes the slug it computed — it was being thrown away one line from its use", () => {
  const t = src("driver/publish/knockout.mjs");
  assert.match(t, /reports: reports\.map\(\(\{ mark, slug, file, dataFile, band \}\) => \(\{ mark, slug, file, dataFile, band \}\)\)/,
    "meta.json's reports[] carries the slug; without it every consumer downstream is guessing");
});

test("#583 the clearances row opens a run that has reports, however many", () => {
  const t = src("portal-ui/src/screens/Clearances.tsx");
  assert.match(t, /const openable = Boolean\(read\.report\) \|\| read\.reports\.length > 0/,
    "`read.report` is the RUN-LEVEL link and is null for a batch by design — gating the row on it alone "
    + "made every batch unopenable");
});

test("#583 the SERVED BUNDLE carries the fix — portal-ui/dist is what the browser gets", (ctx) => {
  // The source is not the surface. `portal-ui/dist` is committed on purpose (portal-static.mjs: a missing
  // bundle must be a loud 503, never a blank page) and portal-static serves it verbatim, so a source-only
  // fix would leave the customer reading the old sentence out of a stale chunk while every test passed.
  const dir = join(HERE, "..", "..", "portal-ui", "dist", "assets");
  // BUILD OUTPUT, NOT SOURCE. `portal-ui/dist` is withheld from the public cut, so this arm has
  // nothing to read there. A STATED skip, never a silent pass: the defect it guards — a source-only
  // fix leaving the served bundle stale — cannot exist in a tree that commits no bundle, and in a
  // tree that does, this still runs.
  if (!existsSync(dir)) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");

  const bundles = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(bundles.length, "there is a built bundle at all");
  for (const b of bundles) {
    const js = readFileSync(join(dir, b), "utf8");
    assert.doesNotMatch(js, /final read before release/i, `${b}: the served bundle still claims the review step`);
  }
  assert.ok(bundles.some((b) => readFileSync(join(dir, b), "utf8").includes("Delivered — no report file found for this run.")),
    "and the honest line is the one actually shipped");
});

test("#583 no customer-facing surface claims a review step that does not exist", () => {
  // Comment lines are stripped first: the block above the fix QUOTES the old sentence so the next reader
  // knows what was wrong with it, and a test that could not tell a quotation from a claim would force the
  // record to be deleted along with the defect.
  const t = src("portal-ui/src/screens/Clearances.tsx")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(t, /final read before release/i,
    "a missing file was being explained as an internal review step, on a run that had delivered");
  assert.doesNotMatch(t, /with cordillera/i, "and no replacement may reintroduce the claim in other words");
  assert.match(t, /Delivered — no report file found for this run\./,
    "what remains states the machine's own fact and asserts nothing about who holds what");
});
