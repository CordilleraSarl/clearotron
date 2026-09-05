// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-dist-tag.mjs — which channel a published version lands on.
//
// THE FAILURE THIS EXISTS TO STOP IS SILENT. `npm publish` with no `--tag` publishes to `latest`, and
// `latest` is what `npm install clearotron` resolves to. A version reaching `latest` by default rather
// than by decision is the shape of it: the log says "published" either way, and nobody finds out until
// somebody reports behaviour from a release that was never meant to be what they got.
//
// ── AND DURING THE PRE-RELEASE PHASE, `latest` IS THE PRE-RELEASE. ──────────────────────────────────
//
// This file used to say, in capitals, that a pre-release must never reach `latest`. That is the right
// rule for a product with ordinary users, and it is not what this product is doing right now. Owner
// ruling, 2026-09-05, in his words: "latest has all our fixes." While `.changeset/pre.json` is in `pre`
// mode the people installing are the people he wants on the newest build, so every merge that carries a
// release note cuts a pre-release and publishes it as `latest`.
//
// `beta` IS NOT ALSO SET, and that is a measurement rather than an omission. npm's trusted publishing
// exchanges its OIDC token inside `npm publish` and nowhere else — `lib/commands/publish.js` is the only
// caller, and the credential it returns lives in that process's config and is never saved. `npm dist-tag
// add` therefore has no credential at all, and setting a second tag would mean putting a long-lived
// token in this repository, which is the one thing the publishing design forbids. One publish, one tag.
//
// OUTSIDE PRE MODE THE ORIGINAL RULE STANDS, unchanged and for the original reason: a hand-cut `1.0.0-rc.1`
// lands on `rc`, never on `latest`, because outside the pre-release phase a release candidate reaching
// every new user is the silent failure this file was written for.
//
// A numeric-only pre-release identifier (`1.0.0-0`, which semver allows) has no channel name to use, so
// outside pre mode it lands on `next` — a real channel a reader can install from, and not `latest`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

/** The channel with no qualifier: what `npm install <pkg>` gives you. */
export const STABLE = "latest";

/** Where a pre-release with no usable channel name goes. */
export const UNNAMED_PRERELEASE = "next";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * The dist-tag this version must be published under.
 *
 * `preMode` is the repository's pre-release state, read from `.changeset/pre.json` by the caller rather
 * than from disk here, so this stays a function of its arguments and every branch is drivable.
 *
 * Throws on a version this cannot read. A tag guessed from an unparseable version would be `latest` by
 * default, and defaulting onto `latest` is the failure this file is about — so it refuses instead, in
 * pre mode as well, where the answer would otherwise be `latest` for the right reason and by accident.
 */
export function distTag(version, { preMode = false } = {}) {
  const m = SEMVER.exec(String(version ?? "").trim());
  if (!m) {
    throw new Error(`release-dist-tag: "${version}" is not a version this can read, so the channel it `
      + "belongs on cannot be derived. Publishing it would default to `latest`.");
  }
  // THE PRE-RELEASE PHASE PUTS EVERYTHING ON `latest`, by the owner's ruling. Checked after the version
  // is parsed, never before: refusing an unreadable version matters more here, not less, because in pre
  // mode `latest` is the answer and an unparseable version would reach it without anybody deciding.
  if (preMode) return STABLE;
  const prerelease = m[4];
  if (!prerelease) return STABLE;
  const first = prerelease.split(".")[0];
  return /^[A-Za-z][0-9A-Za-z-]*$/.test(first) ? first : UNNAMED_PRERELEASE;
}

/**
 * Is the repository in pre-release mode? Read from the file changesets keeps for exactly this.
 *
 * `pre exit` leaves the file behind with `mode: "exit"`, so the FILE's existence is not the answer and
 * reading it that way would keep publishing stable versions as if they were pre-releases forever.
 */
export function preModeFrom(preJsonText) {
  if (!preJsonText) return false;
  try {
    return JSON.parse(preJsonText).mode === "pre";
  } catch {
    // A pre.json that cannot be parsed is not "not in pre mode" — that answer publishes a pre-release
    // under whatever the version happens to imply, silently. The caller refuses instead.
    throw new Error("release-dist-tag: .changeset/pre.json is unreadable, so whether this repository is "
      + "in pre-release mode cannot be known, and the channel would be guessed.");
  }
}

/**
 * True when this version is a pre-release — the GitHub release's prerelease flag.
 *
 * READ FROM THE VERSION, never from the channel. In pre mode the channel is `latest` for a version that
 * is very much a pre-release, so deriving this from `distTag` would mark the GitHub release as stable.
 *
 * A VERSION IT CANNOT READ REFUSES, exactly as `distTag` does, and for the same reason: `false` is the
 * unsafe answer. It marks the release stable, which is the state a reader trusts most, off a string
 * nobody could parse.
 */
export function isPrerelease(version) {
  const m = SEMVER.exec(String(version ?? "").trim());
  if (!m) {
    throw new Error(`release-dist-tag: "${version}" is not a version this can read, so whether it is a `
      + "pre-release cannot be answered. Refusing rather than calling it stable.");
  }
  return !!m[4];
}

function main() {
  const args = process.argv.slice(2);
  // `--prerelease` answers the OTHER question about the same version, and it is a separate flag because
  // the two answers come apart in pre mode and the release is what shows it: `0.1.1-beta.0` publishes to
  // the `latest` CHANNEL by the owner's ruling, and is still a pre-release. Deriving the GitHub release's
  // flag from the channel — `[ "$DIST_TAG" != "latest" ]`, which is what the workflow did — marks a beta
  // as the stable release on the releases page, which is the one place a reader looks to find out.
  const wantsFlag = args.includes("--prerelease");
  const version = args.find((a) => !a.startsWith("--"));
  if (!version) {
    console.error("usage: node scripts/release-dist-tag.mjs <version> [--prerelease]");
    process.exitCode = 2;
    return;
  }
  const preJson = join(dirname(fileURLToPath(import.meta.url)), "..", ".changeset", "pre.json");
  try {
    if (wantsFlag) {
      // From the VERSION, and pre mode is not consulted at all: a version either carries a pre-release
      // identifier or it does not, and no channel decision changes that.
      process.stdout.write(String(isPrerelease(version)) + "\n");
      return;
    }
    const preMode = preModeFrom(existsSync(preJson) ? readFileSync(preJson, "utf8") : null);
    process.stdout.write(distTag(version, { preMode }) + "\n");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

if (isEntrypoint(import.meta.url)) main();
