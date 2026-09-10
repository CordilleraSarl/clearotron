// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHERE THE FRAMEWORK GUIDE IS, and which part of it. One definition, in a file a test can import.
//
// These live here rather than beside the component because this suite carries no JSX transform — Node
// cannot import a `.tsx` at all — so a constant declared in the component is a constant no arm can
// check. The anchor in particular has to be checkable: a deep link to a heading that has since been
// renamed is a dead link that looks alive, and only the guide itself can settle whether it resolves.
export const GUIDE_PATH = 'docs/configuration.md'

/** GitHub's anchor for the guide's "Writing your own, step by step" heading. */
export const GUIDE_ANCHOR = 'writing-your-own-step-by-step'
