// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SENTENCES OF skills/narrative-refutation/SKILL.md THAT TESTS HOLD, IN ONE PLACE. Most are ruled wording a test guards on
// purpose, and a test that guards one names it from here rather than writing it out, so a ruled wording change is one edit.
// the-ruled-sentences-tests-hold-are-in-their-manuals.test.mjs checks each one is still in the manual, word for word.
export const REFUTATION_SENTENCES = Object.freeze({
  listEveryCorrectableDefect: "List every correctable defect. Choose the verdict by the severity grounds below.",
  theDriverChecksTheStructured: "The driver checks the structured finding record. A required use-check source belongs in that record. An "
    + "unknown use status does not require an invented source. The reviewer checks whether the available "
    + "evidence supports the claim.",
  useNegativeWithoutSearch: "**Use-negative without a search.**",
  checkUseCheckSourceAnd: "check `use_check.source` and the held answer supporting that claim",
  forEveryMaterialJurisdictionNamed: "- For every material jurisdiction named in `matter-context`: is it accounted for — by a ledger row, by "
    + "a complete worldwide answer, or inside the count of a crowd the identical mark's narrowing left? If no "
    + "question reached it at all, **FLAG (missing-coverage-row)** — the run cannot account for a jurisdiction "
    + "it called material.",
  missingCoverageRowMatterContext: "`missing-coverage-row` — a `matter-context` material jurisdiction no question reached at all",
  useMatterFrameMaterialJurisdiction: "**Use `matter-frame`'s material-jurisdiction list as your coverage checklist.** Confirm that the run "
    + "searched every jurisdiction it called material — by its own question, by a complete worldwide answer, "
    + "or inside the count of a crowd the identical mark's narrowing left — or honestly deferred it. Check the "
    + "grounds of validated placement decisions against the evidence; flag an unsupported decision.",
  confirmedCleanRowForJurisdiction: "a `confirmed-clean` row for a jurisdiction no search covered — neither its own question nor a complete "
    + "answer over a wider scope that contains it — is itself suspect",
  confirmThatTheRunSearched: "Confirm that the run searched every jurisdiction it called material — by its own question, by a "
    + "complete worldwide answer, or inside the count of a crowd the identical mark's narrowing left — or "
    + "honestly deferred it.",
  andOptionallyPositionsTheRecord: "and optionally `positions` (the record ids of the writer's excluded positions it is about, as their "
    + "list names them), and optionally `lines` (the addresses of the parts of the report it is about that are "
    + "not findings, copied from the dispatch's address list).",
  identifyWhatEachFlagAbout: "**Identify what each flag is about** — the `on` field",
  meansExistingFindingNamedFor: "`[on: -]` means no existing finding is named. For an excluded position, supply its record id in "
    + "`positions`. For a coverage line, an action, a mark assessment read or a narrative section with a "
    + "listed address, supply that address in `lines`. Name any passage without a listed address in `text`. "
    + "Omit all three fields only when none applies to the flag. A flag may carry `on`, `positions` and "
    + "`lines` together.",
  theWriterCorrectsTheNamed: "The writer corrects the named findings, excluded positions, and document passages, together with "
    + "conclusions that depend on them. Unaffected findings stay unchanged. The recheck reviews that same "
    + "scope and any additional changes the writer had to make, using its recorded reasons. A missing finding "
    + "number does not make the whole report open for revision.",
  insuranceAgainstDiffThatMissed: "insurance against a diff that missed something",
  doesTheReportAnswerThe: "Does the report answer the client's question: who could object, how strong they are, what the client "
    + "should do? Are the marks a lawyer would list present, and is each position written from the record that "
    + "matters? Answer that before any check on wording.",
});
