// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the withdrawn-finding check, on invented report text
//
// A LIVE FINDING THAT SHARES A WITHDRAWN ONE'S MARK AND OWNER IS NOT THE WITHDRAWN ONE BACK.
//
// One owner can hold the same mark in several records, and each record can be its own finding. When the review
// withdraws one of them and the others stay live, the live ones keep their cards, under the same `## <owner> — <mark>`
// head. The check for a withdrawn finding back in the report read every head that carried the withdrawn finding's mark
// and owner as that finding, so a live sibling's card failed it. On a test run of a crowded matter, 2026-10-28, that
// one false failure closed the client export, failed the machine check, and was the only fault the overview's repair
// was handed. A card that carries its own `- ord:` line is the finding that line names. The mark-and-owner head
// match is kept for a card with no ord line, the older card shape it was written for. Every mark and owner here is
// invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionConsistencyChecks } from "../predelivery-lint.mjs";

const OWNER = "Quillfern Holdings Ltd";
const live = { ordinal: 231, mark: "QF", owner: { name: OWNER }, disposition: "adversarial" };
const withdrawn = { ordinal: 334, mark: "QF", owner: { name: OWNER }, disposition: "withdrawn",
  withdrawn_reason: "the goods wording does not support the assessment" };
const card = (ord, head = `${OWNER} — QF`) => [`## ${head}`, ...(ord == null ? [] : [`- ord: ${ord}`]),
  "- read: an invented reading of the record.", "- tier: headline-candidate", "### Full detail", "", "- **Why.** invented.", ""].join("\n");
const report = (...cards) => ["# Marks", "", ...cards].join("\n");
const failing = (reportMd) => correctionConsistencyChecks({ reportMd, findings: [live, withdrawn] })
  .filter((c) => !c.pass).map((c) => c.id);

test("a live card under the withdrawn finding's mark and owner, with its own ord line, is not the withdrawn finding back", () => {
  assert.deepEqual(failing(report(card(231))), [], "a live sibling's card was read as the withdrawn finding");
});

test("the withdrawn finding's own card is still found, by its ord line", () => {
  assert.deepEqual(failing(report(card(231), card(334))), ["correction-consistency:334"]);
});

test("a card with no ord line under the withdrawn finding's mark and owner is still found, as the older card shape was", () => {
  assert.deepEqual(failing(report(card(null))), ["correction-consistency:334"]);
});

test("THE CONTROL: a card with no ord line under another owner's name is not the withdrawn finding", () => {
  assert.deepEqual(failing(report(card(null, "Brackenmoor Trading SA — QF"))), []);
});
