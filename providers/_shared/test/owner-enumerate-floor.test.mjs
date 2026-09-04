// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── AN EMPTY OWNER *ENUMERATE* ON AN UNRESOLVED NAME IS A DECLARED GAP, NEVER A CLEAN NEGATIVE ──────
//
// Item 32 part 1, the floor. The sibling file (owner-count-verification.test.mjs) pins the COUNT arm,
// closed by. This is the other arm and it is the worse one: `enumerated` is the ONE state the owner
// screen lets a negative REST on, so a zero-record enumerated block ships as "we looked at this named
// competitor's portfolio and there is nothing in it" — about a real company, in a lawyer-facing report.
//
// APPLICANT_NAME EQUALS is an implicit token-AND. An owner name the register spells differently returns
// an EMPTY CONJUNCTION, which is not an empty portfolio, and the provider answers HTTP 200 either way.
//
// Provider-agnostic on purpose: the discrimination lives in the shared executor and hangs off the
// resolution a provider REPORTS, never off a vendor name.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeExecutePlan, ownerNameResolved, unresolvedOwnerEnumerateReason } from "../execute-plan.mjs";

const TMP = mkdtempSync(join(tmpdir(), "owner-enum-"));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const planFile = (entries) => {
  const p = join(TMP, `plan-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ schema: "register-plan/1", entries }));
  return p;
};
const bandOf = (p) => JSON.parse(readFileSync(p, "utf8"));

const note = (over) => ({ min_confidence: 50, raw_terms: ["MUSTER HANDELS GMBH & CO. KG"], resolved: [], swept: ["MUSTER HANDELS GMBH & CO. KG"], ...over });
const UNRESOLVED = note({});
const RESOLVED = note({ resolved: [{ applicant_name: "MUSTER HANDELS GMBH & CO KG", confidence: 91 }], swept: ["MUSTER HANDELS GMBH & CO. KG", "MUSTER HANDELS GMBH & CO KG"] });

/** One enumerate owner entry against a stub provider that answers with `body`. */
async function runOwnerEnumerate(body, { predicate = "owner", term = "MUSTER HANDELS GMBH & CO. KG", covered_by = null } = {}) {
  const executePlan = makeExecutePlan({
    search: async () => ({ type: "text", text: JSON.stringify({ total_hits: 0, results: [] }) }),
    enumerate: async () => ({ type: "text", text: JSON.stringify(body) }),
    countParams: {},
  });
  const out = join(TMP, `band-${Math.random().toString(36).slice(2)}.json`);
  const plan = planFile([{
    qid: "incumbent-class:owner:muster", axis: "incumbent-class", predicate, term,
    nice_classes: [5], regions: ["US"], expected_kind: "enumerate", ...(covered_by ? { covered_by } : {}),
  }]);
  await executePlan({}, { plan_path: plan, axis: "incumbent-class", output_path: out });
  return bandOf(out)[0];
}

test("item 32 — an empty owner enumerate on an UNRESOLVED name never ships as `enumerated`", async () => {
  const b = await runOwnerEnumerate({ state: "enumerated", total_hits: 0, records: [], owner_resolution: UNRESOLVED });
  assert.equal(b.state, "incomplete", "`enumerated` is the state a negative may rest on — this answer may not rest there");
  assert.equal(b.total_hits, null, "three-valued: never the number zero");
  assert.equal(b.deferred, true, "so downstream reads it as a disclosed coverage row, not a fault");
  assert.match(b.reason, /UNVERIFIED, never a clean negative/);
  assert.match(b.reason, /empty conjunction is not an empty portfolio/);
  assert.ok(b.owner_resolution, "the resolution attempt rides the block — a reader must see WHICH styling was asked for");
});

test("item 32 — a RESOLVED owner that genuinely has nothing stays a real negative", async () => {
  const b = await runOwnerEnumerate({ state: "enumerated", total_hits: 0, records: [], owner_resolution: RESOLVED });
  assert.equal(b.state, "enumerated", "resolved-and-empty is a finding; the floor must not turn every quiet owner into a caveat");
  assert.notEqual(b.total_hits, null);
});

test("item 32 — the floor is owner-shaped and empty-shaped, and nothing else", async () => {
  const notOwner = await runOwnerEnumerate({ state: "enumerated", total_hits: 0, records: [], owner_resolution: UNRESOLVED }, { predicate: "exact", term: "VENZY" });
  assert.equal(notOwner.state, "enumerated", "a mark-text sweep is not an owner claim");
  const notEmpty = await runOwnerEnumerate({ state: "enumerated", total_hits: 2, records: [{ record_id: "/mark/us/1" }, { record_id: "/mark/us/2" }], owner_resolution: UNRESOLVED });
  assert.equal(notEmpty.state, "enumerated", "records found is records found, resolved or not");
  const noNote = await runOwnerEnumerate({ state: "enumerated", total_hits: 0, records: [] });
  assert.equal(noNote.state, "enumerated", "a provider that reports no resolution attempt is not asserted to have failed one");
});

test("item 32 — the covered-by pointer sits EARLY, as it does on the count arm", async () => {
  const b = await runOwnerEnumerate({ state: "enumerated", total_hits: 0, records: [], owner_resolution: UNRESOLVED },
    { covered_by: ["primary-sweep:exact:venzy", "primary-sweep:wildcard:venz"] });
  assert.deepEqual(b.covered_by, ["primary-sweep:exact:venzy", "primary-sweep:wildcard:venz"]);
  assert.match(b.reason, /coverage is primary-sweep:exact:venzy \+1 more/,
    "a reader told the number is untrustworthy is told where the owner IS covered in the same breath, ahead of any 400-char slice");
});

test("item 32 — both arms hang off ONE discriminator", () => {
  assert.equal(ownerNameResolved(UNRESOLVED), false);
  assert.equal(ownerNameResolved(RESOLVED), true);
  assert.equal(ownerNameResolved({ ...RESOLVED, degraded_to_unresolved_sweep: true }), false,
    "a sweep that fell back to the caller's raw term did not resolve, however good the note looks");
  assert.match(unresolvedOwnerEnumerateReason("X", null), /this provider's owner vocabulary never produced/);
});
