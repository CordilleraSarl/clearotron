// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// / — REFERENCE INTEGRITY IN THE "ONLY YOU CAN" SECTION, MEASURED INSTEAD OF PROMISED.
//
// `buildOnlyYouSection` carried this for months:
//
//     "an ask can never name an entity no finding identifies — the reference-integrity property holds
//      by construction"
//
// It did not hold, and the sentence sat directly above the code that falsified it. The subject join
// resolves `action.ordinals` to findings and appends the finding's label when the ask does not already
// contain it. NOTHING read the other names in the text. So an ask bound to a live finding whose text
// names a different party delivered as
//
//     Obtain consent from PARTY-B before launch. (re: PARTY-A (Party A Ltd))
//
// — the mechanism whose comment promised it prevented misattribution manufacturing one.
//
// ── THE BOUNDARY THIS FILE ALSO PINS ────────────────────────────────────────────────────────────────
//
// The cure is the run's own party index, and an index built from findings can only see names the run
// knows. An ask naming a supplier or licensee no finding carries is INVISIBLE to it, and the last test
// here asserts that limit rather than leaving it to be discovered as a second false guarantee. 's
// orphan lint is what catches that class at delivery.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cardedParties, actionPartyReferences } from "../findings-model.mjs";
import { buildOnlyYouSection } from "../pipeline.mjs";

const F = (ordinal, mark, owner, disposition = "conflict") =>
  ({ ordinal, mark, owner: { name: owner }, disposition });
const FINDINGS = [
  F(1, "PARTY-A", "Party A Ltd"),
  F(2, "MERIDIAN", "Meridian Holdings SA"),
  F(3, "GONEMARK", "Gone Ltd", "withdrawn"),
];
const act = (over = {}) => ({ id: 1, kind: "consent", ordinals: [1], text: "Do the thing before launch", ...over });

test("#1096 the index splits what a reader can look up from what the run merely knew", () => {
  const ix = cardedParties(FINDINGS);
  assert.ok(ix.live.has("party-a") && ix.live.has("party a ltd"), "a live card's mark and owner are both addressable");
  assert.ok(ix.withdrawn.has("gonemark"), "a withdrawn card's party is known and NOT lookupable");
  assert.ok(!ix.live.has("gonemark"), "a withdrawn party must not read as live — that is the whole distinction");
});

test("#1096 a party in both a live and a withdrawn card counts as LIVE", () => {
  // Two findings, one owner, one of them withdrawn. The reader CAN look the owner up, so naming it in
  // an ask is not an orphan. Getting this backwards would flag correct asks on any multi-finding owner.
  const ix = cardedParties([...FINDINGS, F(4, "OTHERMARK", "Gone Ltd")]);
  assert.ok(ix.live.has("gone ltd"));
  assert.ok(!ix.withdrawn.has("gone ltd"));
});

test("#1096 short names are not in the index — a two-letter 'party' matches inside ordinary words", () => {
  const ix = cardedParties([F(1, "AB", "Q")]);
  assert.equal(ix.live.size, 0, "a name that would match inside prose turns every ask into a false positive");
});

test("#1096 the reference report names the carded parties an ask asserts", () => {
  const ix = cardedParties(FINDINGS);
  const r = actionPartyReferences(act({ text: "Obtain consent from Meridian Holdings SA before launch" }), ix);
  assert.deepEqual(r.names, ["MERIDIAN"], "the run's own spelling, not the text's");
  assert.deepEqual(r.withdrawnNames, []);
});

test("#1096 an ask naming a WITHDRAWN party is reported — it points at a card that renders nowhere", () => {
  const ix = cardedParties(FINDINGS);
  const r = actionPartyReferences(act({ text: "Clear the GONEMARK overlap with counsel" }), ix);
  assert.deepEqual(r.withdrawnNames, ["GONEMARK"],
    "previously silent: the ordinal missed the store, the loop hit `continue`, and no subject rendered");
});

test("#1096 an action whose ordinals ALL fail to resolve is flagged, not silently unsubjected", () => {
  const ix = cardedParties(FINDINGS);
  assert.equal(actionPartyReferences(act({ ordinals: [3] }), ix).boundLost, true, "bound only to a withdrawn card");
  assert.equal(actionPartyReferences(act({ ordinals: [99] }), ix).boundLost, true, "bound to nothing at all");
  assert.equal(actionPartyReferences(act({ ordinals: [1] }), ix).boundLost, false);
  assert.equal(actionPartyReferences(act({ ordinals: [] }), ix).boundLost, false,
    "a run-level action is not a broken reference — [] ordinals is a deliberate shape (#1080)");
});

// ── THE DELIVERED SENTENCE ──────────────────────────────────────────────────────────────────────────

const onlyYou = (actions) => buildOnlyYouSection(actions, FINDINGS);

test("#1096 THE DEFECT ITSELF: a bound ask naming another carded party gets NO manufactured subject", () => {
  const md = onlyYou([act({ ordinals: [1], text: "Obtain consent from Meridian Holdings SA before launch" })]);
  assert.match(md, /Obtain consent from Meridian Holdings SA before launch/, "the ask still renders, whole");
  assert.ok(!/\(re: PARTY-A/.test(md),
    "the join appended a different party's label to a sentence that already named one — the delivered line "
    + "then reads as though the two were connected, which is exactly what the retired comment promised "
    + "could not happen");
});

test("#1096 …and the honest join still happens when the ask names nobody", () => {
  // The positive control. A guard that suppressed every subject would pass the test above and silently
  // remove a join the reader needs to know which finding an ask closes.
  const md = onlyYou([act({ ordinals: [1], text: "Instruct counsel on the joined-script forms" })]);
  assert.match(md, /\(re: PARTY-A \(Party A Ltd\)\)/,
    "an ask that names no party must still be told which finding it closes");
});

test("#1096 an ask that names its OWN bound party is not given a redundant subject", () => {
  const md = onlyYou([act({ ordinals: [1], text: "Obtain consent from Party A Ltd before launch" })]);
  assert.ok(!/\(re:/.test(md), "the ask already says who it is about");
});

test("#1096 THE LIMIT, asserted so it is not mistaken for a guarantee again", () => {
  // A party the run never saw is outside every index built from findings. This is NOT caught, and
  // saying so here is the point: the previous comment claimed a property this code cannot have, and a
  // reader who trusts a second such claim is the failure being prevented.
  const ix = cardedParties(FINDINGS);
  const r = actionPartyReferences(act({ text: "Obtain consent from Northwind Logistics GmbH before launch" }), ix);
  assert.deepEqual(r.names, [], "no finding carries this party, so no index can see it");
  const md = onlyYou([act({ ordinals: [1], text: "Obtain consent from Northwind Logistics GmbH before launch" })]);
  assert.match(md, /\(re: PARTY-A \(Party A Ltd\)\)/,
    "the join still fires here — the residue #1080's orphan lint catches at delivery, and the reason the "
    + "producer's comment now states its reach instead of claiming reference integrity outright");
});
