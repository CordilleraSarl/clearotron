// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// roster-verdict.mjs — decide what a door's resolved customer roster MEANS.
//
// Extracted from scripts/live-surface-check.mjs so the decision can be tested. It had produced a
// false refusal twice, both times because an EXACT MATCH against a hard-coded list was standing in for
// the property actually being protected. Living inside a top-level-await script, neither occurrence could
// be caught by a test.
//
// The property is: **no real client bundle reaches an instance that is allowed to break.**
//
// Two regimes, and conflating them is the whole bug:
//
//   a configured store (CLEAROTRON_CUSTOMERS_DIR is set and readable)
//       → the STORE is the authority. The door must agree with it, on every instance. What the store may
//         contain is enforced where the store lives — the config repo's CI refuses any bundle without a
//         de-identified public counterpart — not by a triple written into the product repo.
//
//   no configured store
//       → the bundled roster governs, exactly as it always did — derived by driver/bundled-demos.mjs
//         from the directory that ships it, never a list written down. On a test box it is CORRECT
//; anywhere else it means CLEAROTRON_CUSTOMERS_DIR is not reaching the service (#83).
//
// Pure: no fs, no env, no network. Every input is a parameter so a test can state the whole world.

/**
 * @param {object} o
 * @param {string[]} o.keys          customer keys the door resolved, sorted
 * @param {string[]|null} o.onDisk   keys in the configured store, sorted — null when none is configured
 * @param {string[]} o.bundledDemos  the roster shipped in the product repo, sorted
 * @param {boolean} o.expectDemos    CLEAROTRON_E2E_EXPECT_DEMO_ROSTER=1 — "this instance is allowed to break"
 * @returns {{state: "pass"|"fail"|"skip", message: string}}
 */
export function rosterVerdict({ keys, onDisk, bundledDemos, expectDemos }) {
  const sameSet = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  const isBundled = sameSet(keys, bundledDemos);

  // An unscoped probe is a statement about the CALLER, never about the deployment.
  if (keys.length === 0)
    return { state: "skip", message: "the session resolved zero accounts — this probe is unscoped for this door, so the roster is NOT probed rather than failed" };

  if (onDisk) {
    if (!sameSet(keys, onDisk))
      return { state: "fail", message: `the door sees ${keys.length} customer(s), the configured store holds ${onDisk.length} — they disagree`
        + (isBundled ? ". The door resolved exactly the bundled demo roster, so this is #83: CLEAROTRON_CUSTOMERS_DIR is not reaching the service" : "") };
    return { state: "pass", message: `${keys.length} customer(s), matching the configured store`
      + (expectDemos ? " — and this instance declares itself a test box, which the store's own CI keeps free of real client bundles" : "") };
  }

  if (isBundled && expectDemos)
    return { state: "pass", message: `the bundled demo roster (${keys.join(", ")}) — correct for a test instance with no configured store, which must never see real client bundles` };
  if (isBundled)
    return { state: "fail", message: `the door resolved exactly the bundled demo roster (${keys.join(", ")}) — this is #83: CLEAROTRON_CUSTOMERS_DIR is not reaching the service, and every real customer will be refused` };
  if (expectDemos)
    return { state: "fail", message: `CLEAROTRON_E2E_EXPECT_DEMO_ROSTER=1 says this is a test instance with no configured store, but the door resolved ${keys.length} NON-demo customers — real client config has reached an instance that must not have it` };
  return { state: "pass", message: `${keys.length} customers (no CLEAROTRON_CUSTOMERS_DIR in THIS process to compare against)` };
}
