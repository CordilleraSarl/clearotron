// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-dist-tag.mjs — which channel a published version lands on, derived from the version itself.
//
// THE FAILURE THIS EXISTS TO STOP IS SILENT. `npm publish` with no `--tag` publishes to `latest`, and
// `latest` is what `npm install clearotron` resolves to. So a beta published without a tag becomes the
// version every new user installs, the log says "published" either way, and nobody finds out until a
// user reports behaviour from a release that was never meant to be the default.
//
// The rule reads the VERSION rather than `.changeset/pre.json`, so it holds for a version cut by the
// standing pull request in pre-release mode AND for a tag a person pushed by hand. One rule, both
// routes, and it can be checked offline.
//
// A numeric-only pre-release identifier (`1.0.0-0`, which semver allows) has no channel name to use, so
// it lands on `next` — a real channel a reader can install from, and not `latest`.
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

/** The channel with no qualifier: what `npm install <pkg>` gives you. */
export const STABLE = "latest";

/** Where a pre-release with no usable channel name goes. */
export const UNNAMED_PRERELEASE = "next";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * The dist-tag this version must be published under.
 *
 * Throws on a version this cannot read. A tag guessed from an unparseable version would be `latest` by
 * default, which is the one outcome this file exists to prevent — so it refuses instead.
 */
export function distTag(version) {
  const m = SEMVER.exec(String(version ?? "").trim());
  if (!m) {
    throw new Error(`release-dist-tag: "${version}" is not a version this can read, so the channel it `
      + "belongs on cannot be derived. Publishing it would default to `latest`.");
  }
  const prerelease = m[4];
  if (!prerelease) return STABLE;
  const first = prerelease.split(".")[0];
  return /^[A-Za-z][0-9A-Za-z-]*$/.test(first) ? first : UNNAMED_PRERELEASE;
}

/** True when this version is a pre-release, which is also the GitHub release's prerelease flag. */
export function isPrerelease(version) {
  return distTag(version) !== STABLE;
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node scripts/release-dist-tag.mjs <version>");
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(distTag(version) + "\n");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

if (isEntrypoint(import.meta.url)) main();
