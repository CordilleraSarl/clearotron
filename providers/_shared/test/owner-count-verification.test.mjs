// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── A ZERO-HIT BARE-OWNER COUNT IS UNVERIFIED, NEVER THE NUMBER ZERO ──────────────────────────────
//
// The defect these pin: a `predicate:"owner"` count descriptor asks how large an owner's portfolio is,
// the answer is read as a fact about that owner, and a 0 that came back because the query never named
// the styling the register holds is indistinguishable — in the artifact, in the projection and on the
// page — from an owner who genuinely has nothing. The provider answers HTTP 200 and nothing anywhere
// says the question was wrong. That is the same false-clean shape the providers already refuse for a
// term an index cannot hold; it had no equivalent on the owner field.
//
// These tests are PROVIDER-AGNOSTIC on purpose: the discrimination lives in the shared executor and
// hangs off the resolution a provider REPORTS, never off a vendor name. The clarivate half — that the
// resolution now happens at all on the count path, against real captured /resolution/company bodies —
// is in that adapter's own contract test.
//
// Run:  node --test providers/_shared/test/owner-count-verification.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  makeExecutePlan, ownerNameResolved, unresolvedOwnerCountReason,
} from "../execute-plan.mjs";

const TMP = mkdtempSync(join(tmpdir(), "owner-count-"));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const planFile = (entries) => {
  const p = join(TMP, `plan-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ schema: "register-plan/1", entries }));
  return p;
};
const bandOf = (p) => JSON.parse(readFileSync(p, "utf8"));

// The note shape providers emit (clarivate's expandOwnerTerms): the caller's own terms, the companies
// the owner vocabulary returned at/above the confidence threshold, and what was actually swept.
const note = (over) => ({ min_confidence: 50, raw_terms: ["ACME BEVERAGES"], resolved: [], swept: ["ACME BEVERAGES"], ...over });

/** One count-only owner entry, executed against a stub provider that answers with `countBody`. */
async function runOwnerCount(countBody, { predicate = "owner", term = "ACME BEVERAGES", covered_by = null } = {}) {
  const calls = [];
  const executePlan = makeExecutePlan({
    search: async (auth, params) => { calls.push(params); return { type: "text", text: JSON.stringify(countBody) }; },
    enumerate: async () => { throw new Error("a count-only descriptor must never enumerate"); },
    countParams: {},
  });
  const out = join(TMP, `band-${Math.random().toString(36).slice(2)}.json`);
  const plan = planFile([{
    qid: "incumbent-class:owner:acme+watch", axis: "incumbent-class", predicate, term,
    nice_classes: [32], regions: ["CH"], expected_kind: "count", ...(covered_by ? { covered_by } : {}),
  }]);
  const summary = JSON.parse((await executePlan({}, { plan_path: plan, axis: "incumbent-class", output_path: out })).text);
  return { block: bandOf(out)[0], summary, calls };
}

// ══ THE PREDICATE ═════════════════════════════════════════════════════════════════════════════════

test("ownerNameResolved: nothing resolved is UNVERIFIED — including the empty and the absent note", () => {
  assert.equal(ownerNameResolved(note({ resolved: [] })), false, "the vocabulary produced no styling");
  assert.equal(ownerNameResolved(null), false, "no note at all is not evidence of resolution");
  assert.equal(ownerNameResolved(undefined), false);
  assert.equal(ownerNameResolved("resolved"), false, "a non-object is not a note");
  // a resolution that ERRORED reports its errors and resolves nothing — the same standing as an empty one
  assert.equal(ownerNameResolved(note({ resolved: [], errors: ["ACME BEVERAGES: HTTP 503"] })), false);
});

test("ownerNameResolved: a resolved name that reached the sweep is VERIFIED", () => {
  assert.equal(ownerNameResolved(note({
    resolved: [{ applicant_name: "ACME BEVERAGES HOLDING AG", confidence: 74 }],
    swept: ["ACME BEVERAGES", "ACME BEVERAGES HOLDING AG"],
  })), true);
});

test("ownerNameResolved: the caller's term ALREADY being the register's styling is VERIFIED, not a failure", () => {
  // The one case a swept-list-grew test gets wrong. Resolution dedupes an exact match (expandOwnerTerms
  // skips a name it already carries), so the sweep does not grow — but the owner vocabulary DID stand
  // behind this query, and the zero it produced is a real counted zero about a name the register knows.
  assert.equal(ownerNameResolved(note({
    raw_terms: ["ACME BEVERAGES HOLDING AG"],
    resolved: [{ applicant_name: "ACME BEVERAGES HOLDING AG", confidence: 88 }],
    swept: ["ACME BEVERAGES HOLDING AG"],
  })), true);
  // case-insensitively, because the register's styling and the caller's differ in case all the time
  assert.equal(ownerNameResolved(note({
    raw_terms: ["Acme Beverages Holding AG"],
    resolved: [{ applicant_name: "ACME BEVERAGES HOLDING AG", confidence: 88 }],
    swept: ["Acme Beverages Holding AG"],
  })), true);
});

test("ownerNameResolved: styling that was found but could not be EXPRESSED never reached the wire", () => {
  // The register spells it with a reserved boolean word or a character this query language cannot
  // state; the provider names the drop on `unsearchable_resolved` and sweeps the caller's term alone.
  // Recognised-but-unasked is the same unverified position as unrecognised.
  assert.equal(ownerNameResolved(note({
    resolved: [{ applicant_name: "ACME AND SONS PLC", confidence: 71 }],
    swept: ["ACME BEVERAGES"],
    unsearchable_resolved: [{ applicant_name: "ACME AND SONS PLC", reason: "reserved boolean operator" }],
  })), false);
});

test("ownerNameResolved: the documented degrade-to-unresolved fallback is UNVERIFIED", () => {
  // The expanded stack was rejected on the wire and the sweep re-ran on the caller's raw term alone.
  // The provider names that on the note precisely so no reader believes the sweep ran expanded.
  assert.equal(ownerNameResolved(note({
    resolved: [{ applicant_name: "ACME BEVERAGES HOLDING AG", confidence: 74 }],
    swept: ["ACME BEVERAGES", "ACME BEVERAGES HOLDING AG"],
    degraded_to_unresolved_sweep: true,
  })), false);
});

test("unresolvedOwnerCountReason: says UNVERIFIED, names the owner, and points at the coverage EARLY", () => {
  const r = unresolvedOwnerCountReason("ACME BEVERAGES", ["incumbent-class:default:zephyrine+owner-acme", "b", "c"]);
  assert.match(r, /UNVERIFIED, never the number zero/);
  assert.match(r, /owner vocabulary returned no applicant styling/);
  assert.match(r, /"ACME BEVERAGES"/);
  assert.match(r, /not a portfolio size, not a clean negative/);
  // the pointer must survive a 400-char slice downstream (named-band.mjs projects the reason that way)
  assert.ok(r.slice(0, 400).includes("incumbent-class:default:zephyrine+owner-acme"),
    "the coverage pointer may not be the half that gets truncated");
  assert.match(r, /\+2 more/);
  assert.doesNotMatch(unresolvedOwnerCountReason("X", null), /coverage is/);
});

// ══ THE BLOCK THE EXECUTOR STAMPS ═════════════════════════════════════════════════════════════════

test("a bare-owner count of 0 whose owner name did NOT resolve is deferred+error, never a portfolio size", async () => {
  const { block, summary } = await runOwnerCount(
    { total_hits: 0, results: [], owner_resolution: note({ resolved: [] }) },
    { covered_by: ["incumbent-class:default:zephyrine+owner-acme"] });

  assert.equal(block.state, "incomplete", "the unit stays incomplete — fail-honest is the floor");
  assert.equal(block.total_hits, null, "NULL, not 0: nothing here may hand a reader a number to print");
  assert.equal(block.error, true, "never a sanctioned crowd — a clean may not rest on it");
  assert.equal(block.deferred, true, "deterministic: re-running re-derives the same zero, so it is disclosed, not ground");
  assert.match(block.reason, /UNVERIFIED, never the number zero/);
  assert.match(block.reason, /owner vocabulary returned no applicant styling/);
  assert.deepEqual(block.covered_by, ["incumbent-class:default:zephyrine+owner-acme"],
    "the pointer at the slices that ARE this owner's coverage survives");
  assert.ok(block.owner_resolution, "the resolution the sweep ran on rides on the block, verbatim");
  assert.deepEqual(summary.states, { "incumbent-class:owner:acme+watch": "error" });
});

test("…and a bare-owner count of 0 whose owner name DID resolve stays a counted zero", async () => {
  // The other half, and the one that keeps this from being a blanket refusal: the register's own
  // applicant styling was asked for and the answer really is none in scope. That is a fact, and it
  // ships as the sanctioned count descriptor it has always been.
  const { block, summary } = await runOwnerCount({
    total_hits: 0, results: [],
    owner_resolution: note({
      resolved: [{ applicant_name: "ACME BEVERAGES HOLDING AG", confidence: 74 }],
      swept: ["ACME BEVERAGES", "ACME BEVERAGES HOLDING AG"],
    }),
  });
  assert.equal(block.state, "incomplete");
  assert.equal(block.total_hits, 0);
  assert.notEqual(block.error, true);
  assert.notEqual(block.deferred, true);
  assert.match(block.reason, /count-only crowd descriptor/);
  assert.deepEqual(summary.states, { "incumbent-class:owner:acme+watch": "incomplete" });
});

test("a NON-ZERO bare-owner count is untouched even when the name did not resolve", async () => {
  // A number that was counted is a number that was counted: the crowd is real whatever the styling
  // question. Only the ZERO is manufacturable by asking the wrong question, and only the zero moves.
  const { block } = await runOwnerCount({ total_hits: 412, results: [], owner_resolution: note({ resolved: [] }) });
  assert.equal(block.total_hits, 412);
  assert.notEqual(block.error, true);
  assert.notEqual(block.deferred, true);
  assert.match(block.reason, /count-only crowd descriptor/);
});

test("a MARK-TEXT count of 0 is untouched — this rule is about the owner field only", async () => {
  const { block } = await runOwnerCount(
    { total_hits: 0, results: [], owner_resolution: note({ resolved: [] }) }, { predicate: "default", term: "ZEPHYRINE" });
  assert.equal(block.total_hits, 0);
  assert.notEqual(block.error, true);
  assert.match(block.reason, /count-only crowd descriptor/);
});

test("a provider that reports NO resolution note keeps today's block, byte for byte", async () => {
  // Deliberate: with no owner-resolution surface there is no evidence either way, and stamping every
  // bare-owner zero on such a provider UNVERIFIED would defer coverage the run may well have. The
  // question stays open there rather than being answered by guessing.
  const { block } = await runOwnerCount({ total_hits: 0, results: [] });
  assert.equal(block.total_hits, 0);
  assert.notEqual(block.error, true);
  assert.notEqual(block.deferred, true);
  assert.equal(block.owner_resolution, undefined);
  assert.match(block.reason, /count-only crowd descriptor/);
});

test("FAIL-HONEST FLOOR: a count probe that never answered still stamps error:true and no unverified spin", async () => {
  const executePlan = makeExecutePlan({
    search: async () => ({ type: "text", text: "ERROR: count probe — HTTP 502" }),
    enumerate: async () => { throw new Error("unreachable"); },
    countParams: {},
  });
  const out = join(TMP, "band-fail-honest.json");
  const plan = planFile([{ qid: "q-fail", axis: "incumbent-class", predicate: "owner", term: "ACME BEVERAGES",
    nice_classes: [32], regions: ["CH"], expected_kind: "count" }]);
  await executePlan({}, { plan_path: plan, axis: "incumbent-class", output_path: out });
  const [block] = bandOf(out);
  assert.equal(block.error, true);
  assert.notEqual(block.deferred, true, "a transient keeps the transient reading and rides the repair ladder");
  assert.match(block.reason, /provider error on the count probe/);
  assert.equal(block.total_hits, 0, "the un-answered shape is unchanged by this change");
});

test("a probe that ANSWERED but counted nothing is not read as a counted zero", async () => {
  // total_hits null is "we could not count", and `Number(null)` is 0. Reading that as a counted zero
  // would hang the owner-styling story on a probe that counted nothing — the right stamp for the wrong
  // reason. It keeps the shape it already had.
  const { block } = await runOwnerCount({ total_hits: null, results: [], owner_resolution: note({ resolved: [] }) });
  assert.doesNotMatch(String(block.reason), /UNVERIFIED/);
  assert.match(block.reason, /count-only crowd descriptor/);
  assert.equal(block.total_hits, 0, "the pre-existing `?? 0` floor for a null total is untouched by this change");
});
