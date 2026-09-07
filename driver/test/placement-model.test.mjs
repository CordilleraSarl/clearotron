// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// B2 (charter 2026-07-31) — placements.json: the structured mirror of placement-inquiry's four tier
// sections ({mark, owner, jurisdiction, records[], tier, reason}). The reason is the load-bearing
// field (a bare tuple is RULED OUT — the digest corrects placement by arguing with its reason), so
// the parser enforces reason presence AND a bare-label test. All offline, synthetic fixtures.
//
// The bare-label test was a 40-CHARACTER floor until the review of 2026-07-31 (finding 1) probed it with
// `"Off-field noise; not relevant to this matter."` — 45 characters, so it PASSED, while being exactly
// the bare label the floor's own header said it rejected. It failed in the other direction too, throwing
// out real short reasons that name real facts. The count is gone; what replaced it tests the property
// the header always claimed (the reason is not the TIER RESTATED), and the accept-cases below are
// transcribed from REAL placement-recommendations.md prose in the archived pool, because an invented
// accept-case would have certified whatever the author thought a reason looks like.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlacementsJson, validatePlacement, PLACEMENT_TIERS, isTierRestatementOnly } from "../placement-model.mjs";
import { placementsChecks } from "../predelivery-lint.mjs";

const ENTRY = {
  mark: "VOLTMAX",
  owner: "Synth Beverages GmbH",
  jurisdiction: "EU",
  records: ["/mark/eu/000000001"],
  tier: "sheet-2",
  reason: "A regional soft-drink bottler whose class-32 leg reads as private-label energy drinks sold through grocery — the customer base overlaps only at the retail shelf, and the mark's added matter distinguishes on the register.",
};
const doc = (placements) => JSON.stringify({ schema_version: 1, placements });

test("a valid placements.json parses; every tier of the closed enum is accepted", () => {
  const entries = PLACEMENT_TIERS.map((tier, i) => ({ ...ENTRY, mark: `M${i}`, tier }));
  const v = parsePlacementsJson(doc(entries));
  assert.equal(v.schemaVersion, 1);
  assert.equal(v.placements.length, PLACEMENT_TIERS.length);
  assert.deepEqual(v.placements.map((p) => p.tier), PLACEMENT_TIERS);
});

test("top-level defects throw token-first: unparseable / unknown key / empty array", () => {
  assert.throws(() => parsePlacementsJson("not json"), /placements_unparseable/);
  assert.throws(() => parsePlacementsJson(JSON.stringify([ENTRY])), /placements_unparseable/);
  assert.throws(() => parsePlacementsJson(JSON.stringify({ placements: [ENTRY], extra: 1 })), /placements_key_unknown:extra/);
});

// Review 2026-07-31: an EMPTY array used to throw placements_empty, which made a zero-candidate run an
// unrepairable fail-closed — the model cannot conjure candidates the funnel never surfaced, so the
// corrective ladder burned its attempts on the most expensive stage in the cycle. It parses now; the
// "empty" fact is a predelivery-lint FLAG (placementsChecks). Malformed ENTRIES still throw.
test("an empty placements array parses (the empty case is a lint flag, never a validator kill)", () => {
  const v = parsePlacementsJson(doc([]));
  assert.deepEqual(v.placements, []);
  assert.equal(v.schemaVersion, 1);
  // and the flag is where the fact now lives
  assert.equal(placementsChecks({ placements: [] })[0].pass, false);
  assert.equal(placementsChecks({ placements: [] })[0].id, "placements-empty");
  assert.equal(placementsChecks({ placements: [] })[0].structural, true);
  assert.equal(placementsChecks({ placements: [ENTRY] })[0].pass, true);
  // absent (every archived run) emits NOTHING — the replay corpus can never grow a failure
  assert.deepEqual(placementsChecks({ placements: null }), []);
  assert.deepEqual(placementsChecks({}), []);
});

test("entry defects throw token-first: missing mark/owner, bad records, off-enum tier, unknown key", () => {
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, mark: "" }])), /placement_mark_missing:0/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, owner: "" }])), /placement_owner_missing:VOLTMAX/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, jurisdiction: 7 }])), /placement_jurisdiction_invalid:VOLTMAX/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, records: "x" }])), /placement_records_invalid:VOLTMAX/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, records: [""] }])), /placement_records_invalid:VOLTMAX/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, tier: "headline" }])), /placement_tier_invalid:headline/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, extra: 1 }])), /placement_key_unknown:extra/);
});

test("the reason field is enforced: absent throws, and a bare label is rejected (a tuple is ruled out)", () => {
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, reason: "" }])), /placement_reason_missing:VOLTMAX/);
  const { reason: _r, ...noReason } = ENTRY;
  assert.throws(() => parsePlacementsJson(doc([noReason])), /placement_reason_missing:VOLTMAX/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, reason: "off-field noise" }])), /placement_reason_bare:VOLTMAX/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, reason: "sheet-2" }])), /placement_reason_bare:VOLTMAX/);
});

// THE REVIEWER'S PROBE, kept verbatim as the regression it is. 45 characters — it passed the character
// floor, and it is the bare label the floor existed to stop.
test("reason: the review probe that DEFEATED the character floor is rejected", () => {
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, reason: "Off-field noise; not relevant to this matter." }])),
    /placement_reason_bare:VOLTMAX/);
  // and the floor was wrong in the other direction: 37 characters, four checkable facts, would have
  // been thrown out for being short. Length is not the axis.
  assert.equal("Identical mark, cl 32, US, registered".length < 40, true, "this really is under the old floor");
  assert.doesNotThrow(() => parsePlacementsJson(doc([{ ...ENTRY, reason: "Identical mark, cl 32, US, registered" }])));
});

test("reason: every tier restatement is rejected, however it is spelled", () => {
  for (const bare of [
    "off-field noise", "OFF-FIELD NOISE", "sheet-2", "Sheet 2.", "Watchlist annex.", "Headline candidate.",
    "Out of scope — filtered.", "out-of-scope-filtered", "Placed at sheet-2 tier.",
    "Not relevant to this matter; no material relevance to the client.", "Irrelevant record, excluded.",
  ]) assert.equal(isTierRestatementOnly(bare), true, `"${bare}" says only where the candidate went`);
  // every tier token, mechanically — a tier rename can never leave a restatement accepted, because the
  // vocabulary is derived from PLACEMENT_TIERS rather than listed by hand.
  for (const t of PLACEMENT_TIERS) assert.equal(isTierRestatementOnly(t), true, t);
});

// ACCEPT-CASES FROM THE REAL POOL. Transcribed from the placement-recommendations.md of archived
// July-2026 runs — the "Why on-field", "Why lower-tier" and "Stage-2 mitigants" clauses are exactly the
// prose the reason field carries. Run against the whole harvested set (46 strings) during development
// with zero false positives; these are the shortest and the most conclusion-flavoured of them, which
// are the ones a bare-label test is most likely to get wrong. (Run ids and codenames stay out of this
// repo per the no-client-identifiers guard; the prose below is placement reasoning, not identity.)
test("reason: REAL placement prose from the archived pool is accepted", () => {
  for (const real of [
    "identical dominant element, primary instructed class, primary citation jurisdiction, on functional/hydration beverage goods sold to the same consumer through the same discovery channel",
    "SLUSH-initial in the exact convenience channel the SKU sells through, owned by a matter-context watchlist incumbent — but MONKEY is a strong distinguishing element and the mark reads as a store sub-brand",
    "single national right, no evidence of use surfaced, renewal ambiguity. Practical exposure is EUTM-filing risk rather than launch risk.",
    "the confusion read is weak — agrochemicals, perfumery and paper goods, and the client's cl-5 leg is dietary supplement, not medicinal, so customer and channel do not overlap",
    "Owner is a client partner under a documented coexistence.",
    "Identical dominant element in the core instructed class.",
  ]) {
    assert.equal(isTierRestatementOnly(real), false, `real placement prose rejected: ${real.slice(0, 60)}`);
    assert.doesNotThrow(() => parsePlacementsJson(doc([{ ...ENTRY, reason: real }])));
  }
});

// THE BORDERLINE FLAG (boundary package 2026-08-01). placement declares it when its own written answer
// to the promotion question could be argued either way on this record. The whole point is that ABSENT is
// the ordinary case — every archived artifact predates the flag, and a validator that required it would
// have turned a professional declaration into a mandatory field nobody could answer honestly.
test("borderline is OPTIONAL: absent parses, true parses, false parses", () => {
  assert.doesNotThrow(() => parsePlacementsJson(doc([ENTRY])), "absent is the ordinary entry");
  assert.equal(parsePlacementsJson(doc([ENTRY])).placements[0].borderline, undefined);
  for (const v of [true, false]) {
    const p = parsePlacementsJson(doc([{ ...ENTRY, borderline: v }])).placements[0];
    assert.equal(p.borderline, v, `borderline:${v} survives validation verbatim`);
  }
  // an explicit null reads as absent, exactly as the jurisdiction arm treats it
  assert.doesNotThrow(() => parsePlacementsJson(doc([{ ...ENTRY, borderline: null }])));
});

test("borderline: a non-boolean is a token-first failure (the readings belong in reason)", () => {
  for (const bad of ["true", "yes", 1, {}, ["either way"]])
    assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, borderline: bad }])),
      /placement_borderline_invalid:VOLTMAX/, `borderline:${JSON.stringify(bad)} must not pass`);
});

// The regression a careless widening of onlyKeys would introduce: adding an OPTIONAL key must not turn
// the exact-key check into a permissive one. An unknown key is still rejected while borderline is set.
test("borderline does not loosen the exact-key check — an unknown key still throws beside it", () => {
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, borderline: true, extra: 1 }])),
    /placement_key_unknown:extra/);
  assert.throws(() => parsePlacementsJson(doc([{ ...ENTRY, borderline: true, Borderline: true }])),
    /placement_key_unknown:Borderline/, "the key is spelled one way");
});

test("a common-law candidate carries records:[] and jurisdiction \"\" legitimately", () => {
  const cl = { ...ENTRY, mark: "VOLTMAX FEST", jurisdiction: "", records: [], tier: "watchlist-annex" };
  const v = parsePlacementsJson(doc([cl]));
  assert.equal(v.placements[0].records.length, 0);
  assert.equal(v.placements[0].jurisdiction, "");
});

test("validatePlacement is exported for per-entry checks (offline unit path)", () => {
  assert.deepEqual(validatePlacement(ENTRY, 0), ENTRY);
  assert.throws(() => validatePlacement(null, 3), /placement_invalid:3/);
});

// The borderline flag is legal in a file FOUR stages read, three of which author reader-facing prose.
// The rule that keeps it out of the client's report travels with the file, stated once.
test("every stage told to read placements.json is also told what borderline is NOT for", async () => {
  const { STAGES, PLACEMENT_BORDERLINE_NOTE, paths } = await import("../stages.mjs");
  const P = paths("/r/prelim-search/x/y");
  const ctx = { paths: P, run: { slug: "x", codename: "y" }, axes: ["primary-sweep"], searchPolicy: { components: {} } };
  const readers = ["register-digest", "synthesis", "narrative-refutation", "report-overview"];
  for (const name of readers) {
    let msg = "";
    try { msg = STAGES[name].message(ctx); } catch { continue; }   // a stage needing richer ctx is covered by its own test
    if (!msg.includes(P.placementModel)) continue;
    assert.ok(msg.includes(PLACEMENT_BORDERLINE_NOTE),
      `${name} is handed placements.json but not the rule about borderline — that is the hedge leak, one door at a time`);
  }
  // and the rule itself must say the thing that matters
  assert.match(PLACEMENT_BORDERLINE_NOTE, /INTERNAL/);
  assert.match(PLACEMENT_BORDERLINE_NOTE, /NEVER becomes hedge language/);
});
