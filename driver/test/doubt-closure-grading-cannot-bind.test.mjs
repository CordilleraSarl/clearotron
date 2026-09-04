// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// amendment 2 asks doubt-closure to be graded "doubts on band 1 + 2" / "doubts on band 1" — i.e.
// keyed on the disposition of the finding each doubt is about. IT CANNOT BIND, and this file is why.
//
// stitchDoubts settles on a findings.json join FIRST, before any other source. So a doubt that joins a
// finding is already SETTLED and never reaches doubt-closure; every doubt still OPEN has no join, and
// therefore no disposition to grade on. The one escape — `citesOwnSource`, a doubt born IN findings.json
// — is unreachable, because no mint site births one there.
//
// The consequence is not "the filter selects everything". It is that a disposition filter written over
// open doubts SELECTS ON NULL: fail it open and the rung does nothing, fail it closed and it silently
// drops every doubt in the run. Both look like working code. That is why this is a test and not a note.
//
// ── WHAT THIS FILE DOES NOT SAY, added 2026-08-22 because it was about to be read as saying it ───────
//
// This is about the FINDING's disposition or band. It is not a claim that doubt-closure cannot be graded
// at all. The PLACEMENT TIER is a second key with a different provenance: it comes from the carry
// artifact — where placement-inquiry put the candidate — and not from a finding, so the stitch above
// cannot have consumed it. Measured on the same 28 delivered runs that give this file's zero: 0 of 420
// open doubts join a finding, and 199 of those 420 carry a placement tier. The driver now selects on it
// (doubt-selection.mjs, subject.placementTier), and nothing here is weakened by that — the two keys are
// not the same key, and the arms below still hold for the one they are about.
import test from "node:test";
import assert from "node:assert/strict";
import { mintCrossCheckDoubts, mintContradictionDoubts, stitchDoubts, findingJoinFor }
  from "../doubt-ledger.mjs";

const FINDINGS = [
  { ordinal: 1, mark: "VOLTMAX ENERGYCORE", owner: { name: "NutriVolt Beverages, Inc." }, classes: [32],
    disposition: "adversarial", band: "High" },
];
const subjectFor = (mark) => ({ mark, owner: "", terms: [mark], text: `${mark} — is it cleared?` });
const openDoubt = (id, artifact, mark) => ({
  id, birth: { place: "gather-crosscheck", artifact, quote: "q" },
  subject: subjectFor(mark), status: "open", ending: null,
});
const stitch = (doubts) => stitchDoubts(doubts, { findings: FINDINGS, coverageRows: [], registerFindingsText: "" });

// ── CONTROLS: the join instrument must be able to return BOTH answers ─────────────────────────────
test("#1503 CONTROL — the disposition join binds on a real finding and misses on a stranger", () => {
  const hit = findingJoinFor(subjectFor("VOLTMAX ENERGYCORE"), FINDINGS);
  assert.ok(hit, "the join returned NULL on a finding that is present — the instrument is dead and every "
    + "zero below would be meaningless");
  assert.equal(hit.disposition, "adversarial");
  assert.equal(findingJoinFor(subjectFor("QQPLTHXVEL"), FINDINGS), null, "the join matched a mark that is "
    + "in no finding — it would report a disposition for anything");
});

// ── the real birth artifacts, discovered from the minters rather than asserted ────────────────────
test("#1503 no mint site births a doubt in findings.json — so `citesOwnSource` never fires for it", () => {
  const minted = [
    ...mintCrossCheckDoubts("CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE — owner unclear", "common-law-findings.md"),
    ...mintCrossCheckDoubts("CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE — scope unclear", "register-units/us-32.md"),
    ...mintContradictionDoubts([
      { title: "**[NEW] NutriVolt VOLTMAX ENERGYCORE**", owner: "NutriVolt Beverages, Inc.",
        source_layer: "Common-law", description: "CRITICAL FINDING: active nationwide product." },
      { title: "Kestrel Hydration (VOLTMAX ENERGYCORE NOT found on NutriVolt sites)", owner: "",
        source_layer: "Common-law", description: "VOLTMAX ENERGYCORE does not appear in any channel." },
    ]),
  ];
  assert.ok(minted.length >= 3, `only ${minted.length} doubts minted — the fixtures stopped minting and the `
    + "arm below would pass over an empty set");
  for (const d of minted) {
    assert.notEqual(d.birth.artifact, "findings.json",
      `${d.id} births in findings.json — the escape in the invariant below is now REACHABLE, and a `
      + "disposition filter over open doubts would bind on some doubts and not others");
  }
});

test("#1503 a doubt that joins a finding is SETTLED by the stitch — it never reaches doubt-closure", () => {
  for (const artifact of ["common-law-findings.md", "register-units/us-32.md", "audit.md"]) {
    const [out] = stitch([openDoubt(`d:${artifact}`, artifact, "VOLTMAX ENERGYCORE")]);
    assert.equal(out.status, "checked-and-settled",
      `a doubt born in ${artifact} joining finding #1 was left OPEN — the stitch order changed, and `
      + "doubt-closure grading may now be implementable; re-read this file's header before doing it");
    assert.equal(out.ending.evidence.file, "findings.json");
  }
});

test("#1503 THE INVARIANT — no doubt still OPEN after the stitch carries a disposition", () => {
  const out = stitch([
    openDoubt("d1", "common-law-findings.md", "VOLTMAX ENERGYCORE"),   // joins → settles
    openDoubt("d2", "register-units/us-32.md", "QQPLTHXVEL"),          // no join → open
    openDoubt("d3", "audit.md", "ZZTRIVANE"),                          // no join → open
  ]);
  const open = out.filter((d) => d.status === "open");
  assert.ok(open.length > 0, "nothing stayed open — the arm proves nothing about open doubts");
  for (const d of open) {
    assert.equal(findingJoinFor(d.subject, FINDINGS), null,
      `${d.id} is OPEN and carries a disposition — amendment 2's doubt-closure row can now be keyed, `
      + "and this file's premise is stale");
  }
});

test("#1503 the zero above is a consequence of BIRTH, not a dead join — the escape does produce one", () => {
  const [out] = stitch([openDoubt("d:own", "findings.json", "VOLTMAX ENERGYCORE")]);
  assert.equal(out.status, "open", "a doubt born in findings.json was settled from findings.json — it "
    + "cited its own source, which citesOwnSource exists to prevent");
  assert.ok(findingJoinFor(out.subject, FINDINGS),
    "even the escape carries no disposition — the invariant arm above would pass with a dead join, so "
    + "its zero would be worth nothing");
});
