// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// deployment-box.mjs — which deployment this process is running on. One rule, read by every surface.
//
// The box NAMES ITSELF, via `CLEAROTRON_BOX`, and is never inferred from the account name, the checkout
// path or the port. Those are all correlated with the answer and none of them is the answer: a dev
// worktree running under the production service account, or a restored clone at a production path,
// would each be misread by a rule that guesses.
//
// AN UNRECOGNISED VALUE IS NULL, NOT A GUESS. `scripts/live-surface-check.mjs` established this and it
// is the load-bearing half: its unit inventory suppresses the expected-but-absent arm when the box is
// unknown, because the alternative — assuming production — reports every production unit missing on a
// box that never had them. A wrong box name is worse than an absent one everywhere this is read.
//
// Extracted to `shared/` for, when `/portal/health` became the second reader. Two inline copies
// of the same allowlist agree on the day they are written and drift afterwards; that is the defect
// was filed about one field over, and the fix there was the same — import the function, never
// re-derive the answer.
export const DEPLOYMENT_BOXES = ["prod", "test"];

/**
 * @returns {"prod"|"test"|null} the self-declared box, or null when unset or unrecognised.
 *
 * Read at CALL time, deliberately. `shared/brand.mjs` builds its value at module scope and that is
 * exactly why a rename reached the report and not the portal — portal-service is outside
 * `CLI_ENTRIES` and applies the alias translation in its own body, so anything captured at import time
 * there freezes a pre-translation environment.
 */
export function deploymentBox(env = process.env) {
  const v = (env.CLEAROTRON_BOX ?? "").trim();
  return DEPLOYMENT_BOXES.includes(v) ? v : null;
}
