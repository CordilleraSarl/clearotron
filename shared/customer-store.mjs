// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHICH DIRECTORY HOLDS THE CUSTOMERS — asked once, so the settings surface and the runs cannot answer
// it differently.
//
//. The portal's settings surface (Brand profile, Projects, Custom searches) read
// `process.env.PROFILE_DIR || join(HERE, "profiles")` while the runs, the roster, the account picker and
// the artifacts door read `CLEAROTRON_CUSTOMERS_DIR`. Nothing set `PROFILE_DIR` — not `onboard`, not
// `.env.example`, not the box's own env — so the settings surface served the product's BUNDLED DEMO
// BUNDLE (aurora, generic, petcary, zephyr) while the runs served the real store.
//
// WHAT THE CLIENT SAW: every brand owner added the documented way was "These settings are not available
// to you." The clearance itself submitted and ran under their framework. Only the surface that
// configures them refused, and it refused with a tenancy message — so it read as a permissions problem
// rather than as two directories.
//
// AND THE DOCUMENTED INSTALL WAS WORSE, NOT BETTER. `onboard` writes PROFILE_REPO_ROOT at the config
// store. With PROFILE_DIR unset the store stayed inside the product checkout, the two disagreed, the
// containment guard threw, and every settings route 404'd. On a box installed from the docs the
// surface was OFF for everyone; on a hand-configured box it was ON against the demo bundle.
//
// READ AT CALL TIME, DELIBERATELY, and this is the one thing to know before reusing it.
// `driver/profiles.mjs` freezes its overlay at MODULE LOAD (`PROFILES_OVERLAY_DIR`) and says so in its
// own diagnostics. This reads `process.env` when it is called. The two therefore CAN disagree — a
// process that sets the variable after importing profiles.mjs gets a settings surface pointing at the
// live store and a roster still pointing at the bundle. That divergence is not hypothetical and it is
// not silently tolerated: `customerStoreDivergence()` below is what `doctor` reports it with. Making
// this freeze at load instead would hide the disagreement rather than remove it, because the two
// modules load at different moments and nothing orders them.

import { join } from "node:path";
import { envFrom } from "./env-aliases.mjs";

/**
 * The customer store this process should serve, and where the answer came from.
 *
 * `CLEAROTRON_CUSTOMERS_DIR` is the only configured source. `PROFILE_DIR` is NOT consulted: it was
 * retired by and reading it as a fallback would keep exactly the split this function
 * exists to close — a box that set only the old name would still get a second, different store.
 *
 * @param {{env?: object, bundledDir: string}} o  `bundledDir` is the caller's own demo bundle.
 * @returns {{dir: string, source: "configured"|"bundled"}}
 */
export function customerStoreDir({ env = process.env, bundledDir } = {}) {
  if (!bundledDir) throw new Error("customerStoreDir: bundledDir is required — a caller with no fallback "
    + "would resolve an unset store to `undefined` and read the process's working directory");
  const configured = (envFrom(env, "CLEAROTRON_CUSTOMERS_DIR") ?? "").trim();
  return configured ? { dir: configured, source: "configured" } : { dir: bundledDir, source: "bundled" };
}

/**
 * The one line that says which store a surface is serving, and whether that was configured or defaulted.
 *
 * Criterion 2: the startup log named the artifacts roster and the recipes store and
 * never the profile store, which is why the split took a `/proc` read to find. "bundled" is spelled out
 * rather than left as a path a reader has to recognise — on a house-defaults install it is correct, and
 * on a deployment that MEANT to configure a store it is the line that says it did not.
 */
export function customerStoreLine(label, { dir, source }) {
  return source === "configured"
    ? `${label} ON — store=${dir} (CLEAROTRON_CUSTOMERS_DIR)`
    : `${label} ON — store=${dir} (BUNDLED DEMO ROSTER — CLEAROTRON_CUSTOMERS_DIR is unset, so no customer `
      + "added to a config store is visible here)";
}

/**
 * Do the settings surface and the run roster disagree about which store they serve?
 *
 * Criterion 3. Returns null when they agree or when the roster's answer cannot be read — a failure to
 * look is not a finding about the deployment, and reporting one would be the confident wrong answer this
 * issue is about, facing the other way.
 *
 * @param {{surfaceDir: string|null, rosterDir: string|null}} o
 * @returns {{surface: string, roster: string}|null}
 */
export function customerStoreDivergence({ surfaceDir = null, rosterDir = null } = {}) {
  if (!surfaceDir || !rosterDir) return null;
  return surfaceDir === rosterDir ? null : { surface: surfaceDir, roster: rosterDir };
}
