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
 * @param {{readable: boolean, accounts: string[]|null}} [o.caller]
 *                                   the claims of the key the door was asked with, in opsTokenPosture's
 *                                   shape. ABSENT, or `accounts: null`, means uncapped — every account — the
 *                                   way triggerCapGap reads a null cap. Never an empty one.
 * @returns {{state: "pass"|"fail"|"skip", message: string}}
 */
export function rosterVerdict({ keys, onDisk, bundledDemos, expectDemos, caller }) {
  const sameSet = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  const isBundled = sameSet(keys, bundledDemos);

  // An unscoped probe is a statement about the CALLER, never about the deployment.
  if (keys.length === 0)
    return { state: "skip", message: "the session resolved zero accounts — this probe is unscoped for this door, so the roster is NOT probed rather than failed" };

  if (onDisk) {
    // THE DOOR ANSWERS FOR THE KEY THAT ASKED. `list_profiles` is narrowed to the caller's account cap,
    // so a key minted before a company existed does not list it, and correctly. Compared with the whole
    // store, that read as the door and the store disagreeing, and the message below then pointed at a
    // stale roster (measured in testing, 2026-09-10). So the store is narrowed by the same cap before the
    // two are compared; a company outside the cap is the key's gap, which the caller reports on its own line.
    const unreadable = caller?.readable === false;
    const cap = !unreadable && Array.isArray(caller?.accounts) ? caller.accounts : null;
    const expected = cap ? onDisk.filter((k) => cap.includes(k)) : onDisk;
    if (!sameSet(keys, expected) && unreadable)
      // A KEY WHOSE CLAIMS CANNOT BE READ may be narrowing the answer, and a narrowing looks exactly like a
      // door that disagrees with its store. Neither passed nor failed: not compared, and said so.
      return { state: "skip", message: `the door sees ${keys.length} customer(s) (${keys.join(", ")}), `
        + `the configured store holds ${onDisk.length} (${onDisk.join(", ")}), and the claims of the key this `
        + "check asked with could not be read — so a narrowing by that key cannot be told from a door that "
        + "disagrees with its store. NOT compared" };
    if (!sameSet(keys, expected))
      return { state: "fail", message: `the door sees ${keys.length} customer(s) (${keys.join(", ")}), `
        + `the configured store holds ${onDisk.length} (${onDisk.join(", ")})`
        + (cap ? `, ${expected.length} of them within the cap of the key this check asked with` : "")
        + " — they disagree"
        // THE CAUSE IS NOT DERIVABLE FROM THIS COMPARISON, and it used to be asserted anyway. `isBundled`
        // is a set equality over NAMES, and a configured store ordinarily CONTAINS the bundled demo
        // names — so "the door resolved exactly the bundled roster" is equally true of a door with no
        // store and of a door whose store simply has not gained the newest company yet. Measured
        // 2026-09-09: a company added to the configured store minutes earlier, a door still holding the
        // roster it read at boot, and this line reporting a variable that was reaching the service
        // perfectly well. What the check can see is the two lists; which of the two causes produced them
        // is a question for whoever reads it.
        + (isBundled
          ? ". The door's set is name-identical to the bundled demo roster, which this comparison cannot "
            + "tell apart from a configured store carrying those same names: it is consistent BOTH with "
            + "CLEAROTRON_CUSTOMERS_DIR not reaching the service AND with the door still holding a roster "
            + "it read before the store changed. Check the door's environment and when it last read the store."
          : "") };
    return { state: "pass", message: `${keys.length} customer(s), matching the configured store`
      + (cap && expected.length < onDisk.length
        ? ` within the cap of the key this check asked with (${expected.length} of ${onDisk.length})` : "")
      + (expectDemos ? " — and this instance declares itself a test box, which the store's own CI keeps free of real client bundles" : "") };
  }

  if (isBundled && expectDemos)
    return { state: "pass", message: `the bundled demo roster (${keys.join(", ")}) — correct for a test instance with no configured store, which must never see real client bundles` };
  if (isBundled)
    // NO STORE IS VISIBLE TO THIS PROCESS, so unlike the branch above there is no second list to print
    // and the fallback reading is the likeliest one. It is still a reading: this process not holding
    // CLEAROTRON_CUSTOMERS_DIR is not proof the service does not, and the comparison is over names a
    // configured store would also carry. Named as the probable cause rather than the established one.
    return { state: "fail", message: `the door resolved ${keys.length} account(s) name-identical to the bundled demo roster (${keys.join(", ")}), `
      + `and no configured store is visible from here to compare against — most likely CLEAROTRON_CUSTOMERS_DIR is not reaching the service, `
      + `in which case every real customer will be refused. Confirm at the door's own environment before acting: a store holding these same names would look identical here` };
  if (expectDemos)
    return { state: "fail", message: `CLEAROTRON_E2E_EXPECT_DEMO_ROSTER=1 says this is a test instance with no configured store, but the door resolved ${keys.length} NON-demo customers — real client config has reached an instance that must not have it` };
  return { state: "pass", message: `${keys.length} customers (no CLEAROTRON_CUSTOMERS_DIR in THIS process to compare against)` };
}
