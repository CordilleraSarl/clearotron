// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// trigger-cap.mjs — does the portal's trigger token still cover the roster it is asked to start runs for?
//
// ── THE OUTCOME THIS EXISTS TO STOP ─────────────────────────────────────────────────────────────────
//
// `clearotron brandowner add acmelaw` succeeded and said "doctor will now resolve acmelaw". The account
// appeared in the portal, accepted a project created through the UI, and refused every clearance:
//
//     FORBIDDEN (start_run): your grant [generic] does not include account "acmelaw" — start_run refused
//
// The portal's trigger lane runs on a PINNED ops token, minted before that account existed and frozen
// to the roster as it stood then. Creating an account does not re-mint it, and nothing in the CLI
// mentioned it — so an account existed in a state where the portal OFFERS a clearance the engine door
// will refuse, and the person who created it was told it was ready.
//
// ── THE PRODUCT ALREADY DETECTED THIS, AND TOLD THE JOURNAL ─────────────────────────────────────────
//
// The portal's boot check named the account, predicted the consequence and gave the remedy with its
// flag. That detection is good and is kept verbatim. What was wrong was WHERE it landed: a boot log
// nobody reads, when the next reader was a client whose search was refused. So the computation moves
// here and the surfaces a person is actually looking at ask it too — the command that creates the
// account, and `doctor`.
//
// ── WHY THE UNION, AND NOT THE ROSTER ───────────────────────────────────────────────────────────────
//
// The suggested cap is the UNION of the current cap and the roster, never the roster alone. The reason
// is the portal's own and it is kept because it is load-bearing: if the roster is ever read from a
// directory that is not the configured one — an unset customer store falls back to the bundled demo
// fixtures rather than failing — then "--accounts <roster>" would be an instruction to STRIP every real
// customer from the token. A warning that can talk somebody into breaking production is worse than no
// warning; a union is wrong in the harmless direction by construction.
//
// PURE. Takes the cap and the roster, returns what is missing. It reads no environment, decodes no
// token and touches no disk, so every caller can be driven without one.

/**
 * What the trigger token cannot start.
 *
 * `accounts` is the token's account cap: `null` means UNCAPPED — every account — which is not the same
 * as an empty list and is the inversion that makes this worth a named function rather than a filter at
 * three call sites. An uncapped token covers everything, so there is never a gap.
 *
 * @param {{accounts: string[]|null, roster: string[]}} args
 * @returns {{capped: boolean, uncovered: string[], union: string[]}}
 */
export function triggerCapGap({ accounts = null, roster = [] } = {}) {
  const cap = Array.isArray(accounts) ? accounts.filter(Boolean) : null;
  const keys = (roster ?? []).filter(Boolean);
  if (cap === null) return { capped: false, uncovered: [], union: [] };
  const uncovered = keys.filter((k) => !cap.includes(k));
  return { capped: true, uncovered, union: [...new Set([...cap, ...keys])].sort() };
}

/**
 * The one sentence every surface says about a gap, so three of them cannot say three different things.
 *
 * The wording is the portal boot check's, kept deliberately: it was measured to be the thing that would
 * have saved the owner an afternoon, and rewording it per surface is how the good half of a defect gets
 * lost while the fix ships.
 */
export function triggerCapWarning({ uncovered, union }) {
  return `the roster contains account(s) the trigger token cannot start: ${uncovered.join(", ")}. `
    + `Runs for them will be refused at the engine door. Re-mint with --accounts ${union.join(",")} `
    + `(union of the current cap and the roster — check it before using it).`;
}
