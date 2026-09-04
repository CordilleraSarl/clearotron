// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — "is this path inside the product checkout?", in ONE place.
//
// introduced this rule and then wrote it TWICE in bin/onboard.mjs: once in the setup step that
// REFUSES a configuration directory inside the clone, once in the doctor section that FLAGS one. Two
// copies of a boundary is how the two answers start disagreeing — and neither copy could be asserted,
// because both sat inside an interactive function that validates a live engine binary before it ever
// reaches them. A rule nothing can test is a rule that only gets checked when it is already wrong.
//
// THE SEPARATOR IS THE WHOLE RULE. A bare `startsWith(repoRoot)` calls `<repo>-notes` a path inside
// `<repo>`, because the string genuinely does start with it — so a user who keeps their config in a
// sibling directory named after the checkout is refused at setup for no reason, and the message tells
// them to move a directory that was never in the wrong place. Appending the separator is what makes it
// a PATH prefix rather than a STRING prefix.

import { resolve, sep } from "node:path";

/**
 * True when `candidate` is the checkout root itself or a path beneath it.
 *
 * Both sides are resolved first: one relative and one absolute path that name the same directory must
 * not answer differently depending on which the caller happened to hold.
 *
 * @param {string} candidate  the path being judged
 * @param {string} repoRoot   the product checkout root
 */
export function isInsideCheckout(candidate, repoRoot) {
  if (!candidate || !repoRoot) return false;
  const a = resolve(candidate), root = resolve(repoRoot);
  // The root itself counts as inside: `CLEAROTRON_CUSTOMERS_DIR=<repo>` is the same defect as
  // `<repo>/profiles`, and answering false for it would let the plainest form of the mistake through.
  if (a === root) return true;
  return a.startsWith(root.endsWith(sep) ? root : root + sep);
}
