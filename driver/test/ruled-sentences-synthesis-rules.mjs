// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SENTENCES OF skills/clearance-search/synthesis-rules.md THAT TESTS HOLD, IN ONE PLACE. Most are ruled wording a test guards on
// purpose, and a test that guards one names it from here rather than writing it out, so a ruled wording change is one edit.
// the-ruled-sentences-tests-hold-are-in-their-manuals.test.mjs checks each one is still in the manual, word for word.
export const SYNTHESIS_SENTENCES = Object.freeze({
  mustRecordItsSourceThe: "MUST record its source in the finding's `own_rights.source`, which the driver checks in the structured "
    + "finding record. **Know what the negative means:**",
  nonUseRevocationCancellationNot: "(non-use revocation/cancellation, \"not in actual use\", \"no marketplace use found\") MUST record",
  carryTheSubstanceDropThe: "Carry the substance, drop the number",
  theSameRuleCoversThe: "The same rule covers the FACT",
  bothPositionsAreRequired: "Both positions are required on",
  requiredExactlyTheSameSet: "required on exactly the same set, with the same two exemptions",
  theFindingSentenceMostTwo: "**The finding sentence.** At most two sentences, each at most 25 words, in words a client reads without "
    + "a glossary. The first states the outcome as a likelihood: who would win against whom, for what goods, "
    + "where. *\"[Owner]'s earlier [mark] would probably win against [your mark] for [goods] in [territory].\"* "
    + "The second, only when the first cannot carry it, states what the earlier right covers: *\"Their "
    + "registration covers [goods].\"* No \"prevail\". No semicolon, no arrow, no advice, no band word. Every "
    + "fact that does not fit goes in the legal and practical positions below, never dropped.",
  theFindingSentenceMostTwo2: "**The finding sentence.** At most two sentences, each at most 25 words, in words a client reads\nwithout "
    + "a glossary. The first states the outcome as a likelihood: who would win against whom, for\nwhat goods, "
    + "where. *\"[Owner]'s earlier [mark] would probably win against [your mark] for [goods] in\n[territory].\"* "
    + "The second, only when the first cannot carry it, states what the earlier right covers:\n*\"Their "
    + "registration covers [goods].\"* No \"prevail\". No semicolon, no arrow, no advice, no band word.\nEvery "
    + "fact that does not fit goes in the legal and practical positions below, never dropped.",
  theFindingSentenceTheShape: "### The finding sentence — the shape of the typed `net`",
  theGroupedReasonedNegative: "### The grouped reasoned negative",
  conclusionNotChainAnswersThe: "**A conclusion, not a chain.** It answers the single question a lawyer asks of this\n",
  findingsNetChainedAndDoes: "(`findings_net_chained`), and so does the pre-delivery lint (`net-conclusion-form`).\n\n",
  sayWhatTrueTheWorld: "Say what is true of the world instead.\n",
  whatConclusionLooksLikeName: "**WHAT A CONCLUSION LOOKS LIKE.** Name the parties and the territory, and state the outcome as "
    + "a\nlikelihood. *\"Nothing on the German register reaches the applicant's class-9 goods.\"*\n",
});
