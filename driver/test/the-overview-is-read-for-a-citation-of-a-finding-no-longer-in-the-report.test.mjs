// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE OVERVIEW IS READ FOR A CITATION OF A FINDING NO LONGER IN THE REPORT, AND EACH SURFACE'S CHECK READS ITS OWN LINES.
//
// The reference check read the wrong lines on both of its surfaces. On the report, its zone was meant to be the "Only
// you can close these" block; the block split ends at `##` and `###` only, so the zone ran on through the overview's
// `# Methodology` up to the first card. On the email, its zone was the report's two action blocks, the methodology
// included, while the email carries only the conditions from the client's list. So an overview citing a withdrawn
// finding was caught only by accident (a rendered client list before the methodology, and the citation written
// "Finding 334", capitalised), and the email's check named a party from a line the email does not carry.
//
// Now the report's zone is the client's list alone, the email's is the conditions the email carries, and a check of its
// own reads the overview's prose for a citation of a withdrawn or absent finding in any written form. Its failure goes
// to the overview's repair, and if it ships it reads as the owner's sentence. The zones and the check land together:
// narrowing the zone alone would let such a citation pass with no flag. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runLint, onlyYouZone, citedFindingNumbers, overviewCitationChecks, deliveryFlagLines, OVERVIEW_CITATION_ID } from "../predelivery-lint.mjs";
import { overviewCitationFault, locateReportFaults } from "../repair-targets.mjs";
import { emailConditionsOf } from "../publish/email-conditions.mjs";

const FINDINGS = [
  { ordinal: 1, mark: "NOVAPULSE", owner: { name: "Brannick Tooling" }, disposition: "adversarial" },
  { ordinal: 2, mark: "NOVAPULS", owner: { name: "Ostrava Kites" }, disposition: "adversarial" },
  { ordinal: 3, mark: "NOVAPULSAR", owner: { name: "Quillmere AG" }, disposition: "withdrawn" },
];
const ACTIONS = (you) => `# Actions

### Checks we ran — what we found

- Use check on Brannick Tooling: live sales found.

### Only you can close these

${you}
`;
const report = ({ you = "- Obtain consent from Brannick Tooling before filing.", methodology = "" } = {}) => `---
title: NOVAPULSE
overall_caption: One conflict needs a decision.
---

${ACTIONS(you)}
# Methodology

${methodology || "The register was searched in full."}

# Marks

## NOVAPULSE — Brannick Tooling
- ord: 1
`;
const ids = (lint) => lint.failures.map((f) => f.id);
const lint = (over) => runLint({ searchedNames: ["NOVAPULSE"], headerName: "NOVAPULSE", ratedNames: ["NOVAPULSE"], findings: FINDINGS, verdictDoc: { verdict: "CONDITIONAL" }, ...over });

test("the report's client list ends at the next heading of any level, so the methodology after it is not read as an action", () => {
  const md = report({ methodology: "Hartwell Instruments was consulted on the class 9 market." });
  assert.equal(onlyYouZone(md), "### Only you can close these\n\n- Obtain consent from Brannick Tooling before filing.\n");
  assert.ok(!ids(lint({ reportMd: md })).includes("reference-integrity"), "a name in the methodology was read as an action line");
  // A party the client's list names, and nothing else in the report introduces, is still named.
  const orphan = lint({ reportMd: report({ you: "- Obtain consent from Delmont Optics before filing." }) });
  assert.ok(orphan.failures.some((f) => f.id === "reference-integrity" && f.orphans?.includes("Delmont Optics")), JSON.stringify(ids(orphan)));
});

test("the email's check reads the conditions the email carries, as the email composes them", () => {
  // A commercial decision is not a condition: the email does not carry it, so its check does not read it.
  const you = "- **[your decision]** Whether to buy out Delmont Optics.\n- Obtain consent from Brannick Tooling before filing.";
  const md = report({ you });
  assert.deepEqual(emailConditionsOf(ACTIONS(you).replace(/^# Actions\n\n/, ""), "CONDITIONAL"), ["Obtain consent from Brannick Tooling before filing."]);
  const email = lint({ reportMd: md }).checks.find((c) => c.id === "reference-integrity:email");
  assert.equal(email?.pass, false, "the email's check did not run, or named nothing");
  assert.deepEqual(email.orphans, ["Brannick Tooling"], "the email's check read a line the email does not carry, or missed the one it does");
  // The email introduces the party in the conclusion it quotes: then it is not an orphan there.
  const introduced = lint({ reportMd: md.replace("overall_caption: One conflict needs a decision.", "overall_caption: Brannick Tooling holds the one live conflict.") });
  assert.equal(introduced.checks.find((c) => c.id === "reference-integrity:email")?.pass, true);
  // On a clear result the email carries no conditions, so its check names nothing.
  assert.equal(lint({ reportMd: md, verdictDoc: { verdict: "CLEAR" } }).checks.find((c) => c.id === "reference-integrity:email")?.pass, true);
});

test("a citation is read in every written form, and a link, a colour or a decimal is not one", () => {
  assert.deepEqual(citedFindingNumbers("Finding 334 and finding 12; #7, findings #3, #4 and 9; findings 5–6; finding no. 8; FINDINGS 10 & 11 or 13."),
    [334, 12, 7, 3, 4, 9, 5, 6, 8, 10, 11, 13]);
  assert.deepEqual(citedFindingNumbers("See (#actions), page.html#12, x#12, a=#4, #c0392b and #336699; finding 12a."), []);
});

test("the overview's citation of a withdrawn or absent finding fails, whatever the client's list holds; a live finding's passes", () => {
  // The issue's missed cases: no rendered client list, and the citation written in lower case or as "#".
  const overview = (note) => `---\noverall_caption: Finding 2 is the obstacle.\n---\n\n# Actions\n\n### Checks we ran — what we found\n\n- A use check ran.\n\n# Methodology\n\n${note}\n`;
  for (const note of ["As finding 3 showed, the class is crowded.", "See #3 for the crowded class.", "Finding 3 remains open."]) {
    const md = report({ you: "", methodology: note });
    const [check] = lint({ reportMd: md, overviewMd: overview(note) }).checks.filter((c) => c.id === OVERVIEW_CITATION_ID);
    assert.equal(check?.pass, false, `the overview's "${note}" was not caught`);
    assert.deepEqual(check.cites, [{ ordinal: 3, withdrawn: true }]);
  }
  const [absent] = overviewCitationChecks({ overviewMd: overview("Finding 9 was not searched."), findings: FINDINGS });
  assert.deepEqual(absent.cites, [{ ordinal: 9, withdrawn: false }]);
  assert.equal(overviewCitationChecks({ overviewMd: overview("Findings 1 and 2 are live."), findings: FINDINGS })[0].pass, true);
});

test("the lines code builds into the overview's section are not the overview's, and a missing overview or record is not judged", () => {
  const coded = "# Actions\n\n### Answers to your instructions\n\n- Is it clear? → No: see finding 3.\n\n### Only you can close these\n\n- Ask about finding 3.\n\n# Methodology\n\nNothing cited.\n";
  assert.equal(overviewCitationChecks({ overviewMd: coded, findings: FINDINGS })[0].pass, true, "a code-built line was read as the overview's");
  assert.deepEqual(overviewCitationChecks({ overviewMd: null, findings: FINDINGS }), []);
  assert.deepEqual(overviewCitationChecks({ overviewMd: "Finding 3.", findings: null }), []);
  assert.ok(!lint({ reportMd: report() }).checks.some((c) => c.id === OVERVIEW_CITATION_ID), "a run with no overview text was judged on it");
});

test("the failure goes to the overview's repair once, in its ruled words, and ships as the owner's sentence", () => {
  const [check] = overviewCitationChecks({ overviewMd: "# Methodology\n\nFinding 3 remains open; #9 was not searched.", findings: FINDINGS });
  const fault = overviewCitationFault([check]);
  assert.deepEqual(fault.cites, [{ ordinal: 3, withdrawn: true }, { ordinal: 9, withdrawn: false }]);
  assert.ok(fault.detail.startsWith("References: finding 3 (withdrawn); finding 9 (absent). The listed references point to findings that have been withdrawn or are absent."));
  // The repair is not sent the check's own failure as well.
  assert.deepEqual(locateReportFaults([check].filter((f) => f.id !== OVERVIEW_CITATION_ID), { overview: "Finding 3 remains open." }).overview, []);
  assert.deepEqual(deliveryFlagLines([check]), ["This report's overview refers to a finding that is no longer in the report; read the overview against the findings list."]);
});
