// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PARTY THE REPORT INTRODUCES IS INTRODUCED TO THE EMAIL'S READER, A TERRITORY'S SHORT NAME IS A TERRITORY, AND A VERB
// OPENING AN ITEM IS NOT PART OF A NAME.
//
// The email's check names a party its conditions mention and nothing introduces. It read only the email, so a party
// the report's cards introduce was named as unintroduced, though the email's reader reaches the report from it. Its
// name finder took "the UAE" in a list of countries for a party. And a condition opening "Clear" or
// "Verify" was read with the name after it as one name ("Clear <a party>"). Each of these printed the owner's line in
// the lawyer's workbook on a party that was not missing.
//
// Now the report outside its own action block counts as introduction, as it does for the report's check. The finder
// reads a territory's other names (UAE, PRC) as territories. An item's opening word is dropped and the name after it is
// still read, so a party the report names nowhere is still named, on both surfaces, with the owner's line. Every mark,
// owner and person is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runLint, properNameCandidates, deliveryFlagLines } from "../predelivery-lint.mjs";
import { emailConditionsOfReport } from "../publish/email-conditions.mjs";

const FINDINGS = [
  { ordinal: 1, mark: "SOLVIRA", owner: { name: "Ostrava Kites" }, disposition: "adversarial" },
  { ordinal: 2, mark: "SOLVIRRA", owner: { name: "Brannick Tooling" }, disposition: "adversarial" },
];
const report = (you) => `---
title: SOLVERA
overall_caption: Two conflicts need an answer.
---

# Actions

### Checks we ran — what we found

- A use check ran in the class 9 market.

### Only you can close these

${you}

# Methodology

The register was searched in full.

# Marks

## SOLVIRA — Ostrava Kites
- ord: 1

## SOLVIRRA — Brannick Tooling
- ord: 2
`;
const lint = (you) => {
  const reportMd = report(you);
  return runLint({ reportMd, searchedNames: ["SOLVERA"], headerName: "SOLVERA", ratedNames: ["SOLVERA"], findings: FINDINGS,
    verdictDoc: { verdict: "CONDITIONAL" }, emailConditions: emailConditionsOfReport(reportMd, "CONDITIONAL") });
};
const on = (l, id) => l.checks.find((c) => c.id === id);
const EMAIL = "reference-integrity:email", REPORT = "reference-integrity";
const OWNERS_LINE = "The email's conditions name a party that no finding in the report identifies.";

test("a party a card introduces is introduced to the email; one introduced nowhere is still named", () => {
  assert.equal(on(lint("- Obtain consent from Ostrava Kites before filing."), EMAIL)?.pass, true,
    "a party the report's cards introduce was named as unintroduced in the email");
  const nowhere = lint("- Obtain consent from Kestrel Mills before filing.");
  assert.deepEqual(on(nowhere, EMAIL)?.orphans, ["Kestrel Mills"]);
  assert.deepEqual(on(nowhere, REPORT)?.orphans, ["Kestrel Mills"]);
  assert.deepEqual(deliveryFlagLines(nowhere.failures.filter((f) => f.id === EMAIL)), [OWNERS_LINE], "the owner's line changed");
});

test("a condition cannot introduce itself through the report's copy of the action block", () => {
  // The email's conditions are the report's own action items, so the report counts only outside that block: the party
  // stands in the report, in that block alone, and is still named.
  const you = "- Obtain consent from Kestrel Mills before filing.";
  assert.equal(report(you).split("Kestrel Mills").length - 1, 1, "the control needs the party once, in the report's action block");
  assert.deepEqual(on(lint(you), EMAIL)?.orphans, ["Kestrel Mills"]);
});

test("a territory's short name is a territory, beside full country names or alone", () => {
  const item = "- Have the registers in Austria, the UAE, Norway and Chile searched before filing.";
  for (const id of [EMAIL, REPORT]) assert.equal(on(lint(item), id)?.pass, true, `${id} named a territory as a party`);
  assert.deepEqual(properNameCandidates("Search the PRC and UAE registers.", null, { territories: true }), []);
  // The control: without the territory reading, the short name is a candidate, as it was.
  assert.deepEqual(properNameCandidates("Search the UAE registers.", null, { territories: false }), ["UAE"]);
});

test("a verb opening an item is dropped, and the name after it is still read", () => {
  // The party after the verb is carded: nothing is named, on either surface.
  const carded = lint("- Clear Ostrava Kites's prior use before filing.\n- Clear Brannick Tooling's licence before filing.");
  for (const id of [EMAIL, REPORT]) assert.equal(on(carded, id)?.pass, true, `${id} read the verb as part of a name`);
  // The person after the verb is named nowhere: the person is named, without the verb, on both surfaces.
  const unnamed = lint("- Verify Halden Rourke's authority to consent before filing.");
  for (const id of [EMAIL, REPORT]) assert.deepEqual(on(unnamed, id)?.orphans, ["Halden Rourke"], `${id} lost the person, or kept the verb`);
  // A verb followed by one word leaves no name to read, as before.
  assert.deepEqual(properNameCandidates("- Instruct Japanese and Korean counsel.", null, { actionBullets: true }), []);
});
