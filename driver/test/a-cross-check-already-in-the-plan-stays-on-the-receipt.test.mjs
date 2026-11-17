// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real fold
//
// A CROSS-CHECK THE PLAN ALREADY HOLDS STAYS ON THE RECEIPT.
//
// The register sweep mints cross-checks from the common-law pass, folds them into the plan, and writes
// `_driver/register-xcheck.json`. A run that enters the sweep again finds those cross-checks in the plan
// already. The fold passes over a qid the plan holds without adding or refusing it, so the screen kept
// none of them and the receipt was rewritten with no directives. Measured replaying a saved run, 2026-11-10:
// three cross-checks that had run left the audit and the ask count. The demotion tripwire
// reads the same receipt.
//
// `pass` below composes the selection, the fold and the receipt's directives as the sweep does; the last
// test pins that the sweep composes them this way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverSource } from "./driver-source.mjs";
import { foldSupplementalEntries, partitionFoldDirectives, screenThenCap } from "../register-plan.mjs";
import { crossChecksForThisPass } from "../steps/register-sweep.mjs";

const CAP = 10;

/** A cross-check in the shape the sweep mints, and the directive the receipt records for it. */
const ent = (term) => ({
  qid: `xcheck-mark:${term.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  axis: "primary-sweep", predicate: "default", term,
  nice_classes: ["5", "32"], regions: [], expected_kind: "enumerate",
});
const dir = (e) => ({ qid: e.qid, owner: null, markText: e.term, source: { term: e.term, platform: null, url: null } });

const PLAN = { plan_version: 1, entries: [ent("HOUSE MARK")].map((e) => ({ ...e, qid: "primary-sweep:default:house-mark" })) };

/** One pass of the sweep's mint: what it folds, the plan after, and the directives the receipt records. */
function pass(plan, terms, prior) {
  const candidates = terms.map(ent), candDirectives = candidates.map(dir);
  const sel = crossChecksForThisPass(plan, candidates, candDirectives, prior, CAP);
  const folded = foldSupplementalEntries(plan, sel.entries);
  const minted = new Set(sel.entries.map((e) => e.qid));
  const kept = [...sel.carried, ...partitionFoldDirectives(candDirectives.filter((d) => minted.has(d.qid)), folded.refused).kept];
  return { plan: folded.added.length ? folded.plan : plan, added: folded.added, kept, overflow: sel.overflow };
}

const qids = (xs) => xs.map((x) => x.qid).sort();

test("a second pass over the same signals keeps every cross-check the first minted", () => {
  const terms = ["ALPHA CO", "BETA LABS", "GAMMA"];
  const first = pass(PLAN, terms, null);
  assert.equal(first.added.length, 3, "the first pass mints all three");
  assert.equal(first.kept.length, 3);

  const second = pass(first.plan, terms, { directives: first.kept });
  assert.equal(second.added.length, 0, "nothing is minted twice");
  assert.deepEqual(qids(second.kept), qids(first.kept), "the receipt keeps the three it recorded");
  assert.deepEqual(second.kept, first.kept, "as the first receipt recorded them");
});

test("THE DEFECT: the screen alone keeps nothing the plan already holds", () => {
  const terms = ["ALPHA CO", "BETA LABS", "GAMMA"];
  const first = pass(PLAN, terms, null);
  assert.equal(screenThenCap(first.plan, terms.map(ent), CAP).entries.length, 0,
    "every one is already in the plan, so the screen adds none, and a receipt built from it alone is empty");
});

test("a receipt an earlier pass emptied is filled again from the plan", () => {
  const terms = ["ALPHA CO", "BETA LABS", "GAMMA"];
  const first = pass(PLAN, terms, null);
  const second = pass(first.plan, terms, { directives: [] });
  assert.deepEqual(qids(second.kept), qids(first.kept));
});

test("the cap counts what the plan already holds, so a second pass mints only what the first left room for", () => {
  const terms = Array.from({ length: 12 }, (_, i) => `TERM ${String.fromCharCode(65 + i)}`);
  const first = pass(PLAN, terms, null);
  assert.equal(first.added.length, CAP);
  assert.equal(first.overflow.length, 2);

  const second = pass(first.plan, terms, { directives: first.kept });
  assert.equal(second.added.length, 0, "the two over the cap stay over it");
  assert.equal(second.overflow.length, 2);
  assert.equal(second.kept.length, CAP);

  const fewer = pass(PLAN, terms.slice(0, 4), null);
  const more = pass(fewer.plan, terms, { directives: fewer.kept });
  assert.equal(more.added.length, CAP - 4, "new signals fill only the room the first pass left");
  assert.equal(more.kept.length, CAP);
});

test("on a first pass the answer is the screen's", () => {
  const terms = ["ALPHA CO", "BETA LABS", "GAMMA"];
  const candidates = terms.map(ent);
  const sel = crossChecksForThisPass(PLAN, candidates, candidates.map(dir), null, CAP);
  const screened = screenThenCap(PLAN, candidates, CAP);
  assert.deepEqual(sel.carried, []);
  assert.deepEqual({ entries: sel.entries, overflow: sel.overflow, refused: sel.refused }, screened);
});

test("the sweep selects, folds and records its cross-checks as above", () => {
  const src = driverSource("pipeline.mjs");
  assert.match(src, /const screened = crossChecksForThisPass\(ctx\.registerPlan, candidates, candDirectives, prior, XCHECK_CAP\);/);
  assert.match(src, /const kept = \[\.\.\.screened\.carried, \.\.\.partitionFoldDirectives\(candDirectives\.filter\(\(d\) => entryQids\.has\(d\.qid\)\), folded\.refused\)\.kept\];/);
  assert.match(src, /directives: kept, overflow,/, "the receipt records what was kept");
});
