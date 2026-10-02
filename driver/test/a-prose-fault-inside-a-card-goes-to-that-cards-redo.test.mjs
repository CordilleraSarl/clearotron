// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the pre-delivery prose checks route a fault to the pass that can fix it, on invented names
//
// A PROSE FAULT INSIDE A CARD GOES TO THAT CARD'S REDO.
//
// The lint repair sends a report failure that carries an ordinal to that card's own redo, and one that
// carries none to the report-overview redo, which writes the shell and cannot edit a card. Four checks
// found faults inside cards and set no ordinal, so their repair went to the one pass that could not make
// it: prescription-prose, scope-numbers-in-prose, wipo-designation-language and counting-consistency.
// Each now reports a card's fault on that card's ordinal and the shell's on none, the way
// permission-prose already did. A card with no ordinal cannot be routed and stays with the shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prescriptionProseChecks, scopeNumberProseChecks, wipoLanguageChecks, countingChecks } from "../predelivery-lint.mjs";

const REPORT = [
  "---",
  "overall_label: Conditional",
  "---",
  "# Overview",
  "We recommend that the client files in class 9 now.",
  "Zorendik Holdings holds 11 registrations in the searched classes.",
  "",
  "## VELTRIN against ZORENDIK",
  "- ord: 1",
  "The practical path is to seek consent from the earlier owner.",
  "The search swept 14 classes on the register.",
  "Zorendik Holdings holds 12 registrations in the searched classes.",
  "",
  "## VELTRIN against NORVELL",
  "- ord: 2",
  "Its WIPO registration protects the mark worldwide.",
  "",
  "# Methodology",
  "The registers named in the order were read in full.",
].join("\n");

const failing = (rows) => rows.filter((r) => !r.pass);

test("a fault inside a card carries that card's ordinal, and the shell's carries none", () => {
  const rows = failing(prescriptionProseChecks({ reportMd: REPORT }));
  assert.deepEqual(rows.map((r) => r.ordinal ?? null).sort(), [1, null],
    "one row for card 1's \"practical path\", one for the shell's \"we recommend\"");
  assert.match(rows.find((r) => r.ordinal === 1).detail, /practical path/);
  assert.match(rows.find((r) => r.ordinal == null).detail, /We recommend/);
  assert.doesNotMatch(rows.find((r) => r.ordinal == null).detail, /practical path/, "a card's fault is not also sent to the overview");
});

test("scope numbers and the WIPO language route the same way", () => {
  const scope = failing(scopeNumberProseChecks({ reportMd: REPORT }));
  assert.deepEqual(scope.map((r) => r.ordinal), [1], "the swept-classes count sits in card 1 and nowhere else");
  const wipo = failing(wipoLanguageChecks({ reportMd: REPORT }));
  assert.deepEqual(wipo.map((r) => r.ordinal), [2], "the worldwide claim sits in card 2");
});

test("a count that disagrees inside a card goes to that card, and the copy outside keeps the cross-surface row", () => {
  const rows = failing(countingChecks({ report: REPORT }));
  const card = rows.find((r) => r.ordinal === 1);
  assert.ok(card, `no row reached card 1: ${JSON.stringify(rows)}`);
  assert.equal(card.surface, "report");
  assert.match(card.detail, /counted differently across surfaces: (11 vs 12|12 vs 11)/);
  assert.ok(rows.some((r) => r.ordinal == null && r.surface === "all"), "the shell's copy of the count still reaches the overview redo");
});

test("a clean report reads as one passing row per check, as before", () => {
  const clean = "# Overview\nNothing on the register reaches the goods.\n\n## VELTRIN against ZORENDIK\n- ord: 1\nThe earlier mark covers games.\n";
  for (const rows of [prescriptionProseChecks({ reportMd: clean }), scopeNumberProseChecks({ reportMd: clean }),
    wipoLanguageChecks({ reportMd: clean }), countingChecks({ report: clean })]) {
    assert.equal(rows.filter((r) => r.surface !== "client-summary").length, 1);
    assert.equal(rows[0].pass, true);
  }
});

test("a card with no ordinal cannot be routed, so its fault stays with the shell", () => {
  const unnumbered = "# Overview\nThe report states the facts.\n\n## VELTRIN\nThe practical path is to seek consent.\n";
  const rows = failing(prescriptionProseChecks({ reportMd: unnumbered }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ordinal, undefined, "an unroutable fault reaches the shell redo, never nowhere");
  assert.match(rows[0].detail, /practical path/);
});
