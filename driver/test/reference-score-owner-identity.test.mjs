// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A RECORD MAY NEVER APPEAR IN TWO BUCKETS.
//
// On the delivered R2 clearance of 2026-08-06 @`d90d9bd` the scorer reported the same trademark
// twice, in two states that contradict each other:
//
//   LOST  — never retrieved      · VELTRIN GENETICS    · Veltrin Genetics S.A. (BX) · HIGH → MEDIUM
//   NOISE — not in the reference · DG VELTRIN GENETICS · Veltrin Genetics S.A.
//
// Identical owner; the reference mark sits whole inside the surfaced one. It understated recall on the
// highest-risk entry in the set, and it sent a build issue at retrieval when retrieval had
// worked. This is the ninth harness defect this month against no engine defect on the same runs.
//
// Two things are under test and the second matters more:
//   1. THE PAIRING — owner identity forces the mark comparison, so the record scores found.
//   2. THE CLASS — a surfaced record sharing an owner with an unfound reference entry is REPORTED as a
//      collision. The next pairing gets reported instead of discovered by reading two lists side by side.
//
// And the discipline the issue is explicit about: DO NOT FIX BY LOOSENING THE MATCH. Five marks in this
// scenario's own results share the VELTRIN token under different owners. Every one of them must stay out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesReference, ownerKey, ownersMatch, scoreRecall, scoreField } from "../reference-score.mjs";

// The real gold entry and the real finding, verbatim from R2.gold.json and the delivered findings.json.
const GOLD = { mark: "VELTRIN GENETICS", owner: "Veltrin Genetics S.A. (BX)", jurisdictions: ["US"],
  classes: [5, 42, 44], lawyer_risk: "HIGH → MEDIUM with mitigation", on_field: true };
const SURFACED = { mark: "DG VELTRIN GENETICS", evidence: "register",
  owner: { name: "Veltrin Genetics S.A.", country: "BE" }, band: "Manageable", group: "on-field" };
// The five same-token, different-owner marks the same run surfaced. Manufacturing recall from any of
// these is the failure mode that would be worse than the one being fixed.
const DIFFERENT_OWNERS = [
  { mark: "Veltrin Pharmaceuticals", evidence: "register", owner: { name: "Veltrin Pharmaceuticals" } },
  { mark: "veltrinsoft", evidence: "register", owner: { name: "Veltrinsoft SA" } },
  { mark: "Delphia Therapeutics", evidence: "register", owner: { name: "Delphia Therapeutics" } },
  { mark: "Veltrin Pharma", evidence: "register", owner: { name: "Veltrin Pharma" } },
  { mark: "DELFI Diagnostics", evidence: "register", owner: { name: "DELFI Diagnostics, Inc." } },
];

// ── 1. THE PAIRING ───────────────────────────────────────────────────────────────────────────────────

test("#450 the lawyer's trailing jurisdiction annotation is not part of the proprietor's name", () => {
  assert.equal(ownerKey("Veltrin Genetics S.A. (BX)"), ownerKey({ name: "Veltrin Genetics S.A." }));
  assert.equal(ownersMatch(GOLD.owner, SURFACED.owner), true);
  // Three of R2's nine entries carry the annotation and six do not — which is what makes it a
  // convention rather than a name. The same fold on the other two:
  assert.equal(ownersMatch("Veltrin Diagnostics, Inc. (US)", { name: "Veltrin Diagnostics, Inc." }), true);
  assert.equal(ownersMatch("Veltrin Scientific, LLC (US)", { name: "Veltrin Scientific, LLC" }), true);
});

test("#450 the fold is ONE trailing group — it is not a general parenthesis strip", () => {
  // A parenthetical INSIDE a name is part of the name and stays.
  assert.notEqual(ownerKey("Acme (Holdings) International"), ownerKey("Acme International"));
  // And the false-owner-match this module's own doc block is written against is untouched.
  assert.equal(ownersMatch("Shanghai Redwood Network Technology", "Shanghai Bluestone Network Technology"), false);
});

test("#450 owner identity forces the comparison — the reference mark CONTAINED in the surfaced one", () => {
  assert.equal(matchesReference(GOLD.mark, SURFACED.mark, { sameOwner: true }), "contained");
  // Both directions: under one proprietor the direction carries no information.
  assert.equal(matchesReference(SURFACED.mark, GOLD.mark, { sameOwner: true }), "contained");
});

test("#450 WITHOUT the owner, containment does not fire — the owner IS the gate", () => {
  assert.equal(matchesReference(GOLD.mark, SURFACED.mark), null);
  assert.equal(matchesReference(GOLD.mark, SURFACED.mark, { sameOwner: false }), null);
});

test("#450 containment is over WHOLE WORDS — VELTRIN never reaches inside VELTRINSOFT", () => {
  // Even if an owner match were somehow established, a character-substring rule would be wrong here.
  assert.equal(matchesReference("VELTRIN", "veltrinsoft", { sameOwner: true }), null);
  assert.equal(matchesReference("VELTRIN", "VELTRIN GENETICS", { sameOwner: true }), "contained");
  // An empty side is contained in everything, and must never match.
  assert.equal(matchesReference("星光", "VELTRIN GENETICS", { sameOwner: true }), null);
});

test("#450 the run scores 7 of 9, and the five same-token different-owner marks stay noise", () => {
  const reference = [GOLD,
    { mark: "VELTRIN SCIENTIFIC", owner: "Veltrin Scientific, LLC (US)", classes: [5, 42, 44], jurisdictions: ["US"] },
    { mark: "DELFITY", owner: "Novartis", classes: [5], jurisdictions: ["EU"] }];
  const b = scoreRecall({ reference, findings: [SURFACED, ...DIFFERENT_OWNERS],
    scopeClasses: ["5", "42", "44"], scopeTerritories: ["CH", "EU", "US"] });

  assert.equal(b.found.length, 1, "the owner-identical record is a find");
  assert.equal(b.found[0].mark, "VELTRIN GENETICS");
  assert.equal(b.found[0].rule, "contained", "and the report says WHY the two labels were treated as one mark");
  assert.equal(b.found[0].matched, "DG VELTRIN GENETICS");

  assert.deepEqual(b.lost.map((x) => x.mark).sort(), ["DELFITY", "VELTRIN SCIENTIFIC"],
    "the other two stay lost — the fix must not manufacture recall it does not have");
  assert.deepEqual(b.noise.map((x) => x.mark).sort(), DIFFERENT_OWNERS.map((x) => x.mark).sort(),
    "every same-token different-owner mark stays noise");
  assert.deepEqual(b.collisions, [], "and nothing contradicts anything");
});

test("#450 axis B can see the finding axis A matched — one record, one answer", () => {
  const rows = scoreField({ reference: [GOLD], findings: [SURFACED] });
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].state, "not-surfaced",
    "the axis that judges whether the GOODS were routed correctly must not report the mark as never seen");
});

// ── 2. THE CLASS — the assertion over the scorer's own output ────────────────────────────────────────

test("#450 a surfaced record sharing an owner with an unfound entry is REPORTED, never silently split", () => {
  // The pre-fix state, reconstructed: same owner, and a mark pairing the matcher cannot join. This is
  // the shape that must never again reach a reader as two independent facts.
  const reference = [{ ...GOLD, mark: "ZORVIL GENETICS" }];
  const b = scoreRecall({ reference, findings: [SURFACED],
    scopeClasses: ["5", "42", "44"], scopeTerritories: ["CH", "EU", "US"] });

  assert.equal(b.lost.length, 1, "the mark genuinely does not join");
  assert.equal(b.noise.length, 1);
  assert.equal(b.collisions.length, 1, "and the contradiction is stated");
  assert.equal(b.collisions[0].bucket, "lost");
  assert.equal(b.collisions[0].entry, "ZORVIL GENETICS");
  assert.equal(b.collisions[0].noise, "DG VELTRIN GENETICS");
  assert.match(b.collisions[0].why, /cannot be both/);
});

test("#450 the collision report is a RECORD, not a verdict — it never promotes anything itself", () => {
  const reference = [{ ...GOLD, mark: "ZORVIL GENETICS" }];
  const b = scoreRecall({ reference, findings: [SURFACED],
    scopeClasses: ["5", "42", "44"], scopeTerritories: ["CH", "EU", "US"] });
  assert.equal(b.found.length, 0,
    "auto-promoting a collision would be the scorer manufacturing recall out of its own confusion — a reader adjudicates");
});
