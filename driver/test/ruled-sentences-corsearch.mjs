// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SENTENCES OF skills/clearance-register/providers/corsearch.md THAT TESTS HOLD, IN ONE PLACE. Most are ruled wording a test guards on
// purpose, and a test that guards one names it from here rather than writing it out, so a ruled wording change is one edit.
// the-ruled-sentences-tests-hold-are-in-their-manuals.test.mjs checks each one is still in the manual, word for word.
export const CORSEARCH_SENTENCES = Object.freeze({
  donRunMultipleSeparatePhonetic: "Don't run multiple separate phonetic searches — they make more requests and return largely overlapping "
    + "results.",
  skillHandlesThisGeneratingTransliteration: "Skill handles this by generating transliteration variants in `clearance-variants`, with one script "
    + "question per market the frame names.",
});
