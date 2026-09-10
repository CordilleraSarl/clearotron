// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// updater-identity.mjs — WHICH COPY OF THE UPDATER IS ACTUALLY DEPLOYING THIS BOX.
//
// Deploy health attributes a service to a commit by resolving a tree from the unit's WorkingDirectory
// and from `/proc/<pid>/cmdline`. Both halves fail for exactly one unit, and it is the one that does the
// deploying: the updater is a `oneshot` that runs from a home directory with no checkout under it, and
// its command line is the update script rather than the product entry point. So the unit that places
// every commit on this box was the one unit the check reported as "could NOT be read and was NOT
// compared" — an updater running from a stale copy would place a stale tree, and nothing would notice.
//
// THE UPDATER STAMPS ITSELF, the way the drainer already does, and this reads that stamp. The two shapes
// are deliberately the same: a best-effort write at the top of a tick, a verdict at the reading end, and
// an absent stamp treated as a failure rather than a skip.
//
// AN ABSENT STAMP IS THE LOUD CASE, and that is the whole point rather than a severity preference. The
// stamp writer shipped in the updater itself, so a copy of the updater old enough to predate it writes
// no stamp at all — which is precisely "the updater is running from a stale copy", the condition this
// exists to catch. Recording that as "not probed" would pass the exact box the check is for.
//
// WHAT THE SHA PAIR PROVES, AND WHAT IT DOES NOT. The stamp records the running copy's digest and the
// digest of the master it was taken from, and those two agreeing means the running copy matches the
// master AS THAT BOX CAN SEE IT. The master is read from a local store that nothing pulls
// automatically, so a store nobody has fetched leaves both sides equally old and equally in agreement.
// That case is real and this reader cannot see it; the pass message says so rather than claiming the
// updater is current, and the updater's own tick reports the store's age on the line above.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UPDATER_STAMP_BASENAME = "_updater-identity.json";

/**
 * Where the updater stamps itself: beside the update script, in the deploy directory it runs from.
 *
 * NEVER A HARDCODED PATH. The obvious spelling here is the service account's own home, and it is wrong
 * twice over: it publishes a login on a public surface, and it disagrees with any box that points the
 * updater somewhere else — which would red a healthy deployment forever, for a reason no message names.
 * The caller passes the directory it derived from the unit itself, and the environment overrides both.
 */
export function updaterStampPath(deployDir) { return join(deployDir, UPDATER_STAMP_BASENAME); }

/**
 * The one path the reader and the writer both resolve, from the one name the writer already honours.
 *
 * THE READER MUST NOT INVENT A SECOND ENV NAME. A reader-only variable is a seam: a box that redirects
 * its updater sets the writer's name, the reader keeps looking at the default, finds nothing, and
 * reports "no stamp" — the loud branch — about a deployment that is stamping correctly. One name, read
 * as the writer writes it: a FULL PATH to the stamp file, not a directory.
 *
 * @param {string|null} deployDir  where the updater runs, derived from the unit; used only as fallback
 * @param {object} [env]           process.env, injectable so a test can drive both branches
 */
export function resolveUpdaterStampPath(deployDir, env = process.env) {
  const named = env?.CLEAROTRON_UPDATER_STAMP || null;
  if (named) return named;
  return deployDir ? updaterStampPath(deployDir) : null;
}

/** The stamp, or null when there is none to read. A parse failure is a null — the verdict says so. */
export function readUpdaterStamp(deployDir, { read = null, env = process.env } = {}) {
  const rd = read ?? ((p) => readFileSync(p, "utf8"));
  const path = resolveUpdaterStampPath(deployDir, env);
  if (!path) return null;
  try { return JSON.parse(rd(path)); } catch { return null; }
}

/** Eight characters is enough to name a commit in a message, and null stays visibly null. */
const short = (c) => (c ? String(c).slice(0, 8) : "(unknown)");

/**
 * PURE. What deploy health should say about the copy of the updater that is deploying this box.
 *
 * @param {object} o
 * @param {object|null} o.stamp        readUpdaterStamp()'s answer
 * @param {number|null} o.now          epoch seconds, for the stamp's age
 * @param {string|null} o.deployClone  the git toplevel this deploy is checking
 * @param {number} [o.maxAgeSeconds]   how old a stamp may be before the updater counts as not running
 * @returns {{state:"pass"|"fail", message:string}}
 *
 * THE ALLOWANCE IS THREE HOURS AGAINST AN HOURLY TICK, and it is a judgement rather than a measurement,
 * so it is written down with its reasoning. The stamp is written at the top of every run, so on the
 * cadence the deployment keeps, one missed tick is an hour. It is not one hour here because a tick can
 * legitimately defer — the updater exits early while a clearance is queued, claimed or in flight — and
 * an arm that fired on a single deferral would red a box that is busy rather than broken. Three hours
 * is two consecutive misses: past any single deferral, and still inside the window where somebody would
 * want to know. Six hours was the first number written and it is five missed ticks, most of a working
 * day, which is slack a one-hour cadence does not need.
 */
export function updaterVerdict({ stamp, now = null, deployClone = null, maxAgeSeconds = 3 * 3600 } = {}) {
  if (!stamp) {
    return { state: "fail", message:
      `no updater identity stamp at ${UPDATER_STAMP_BASENAME}: the copy of the updater that deploys this `
      + "box did NOT say what it is, so whether it is the current one was not established. A copy old "
      + "enough to predate the stamp writes none, which is itself the stale-updater case. This is a "
      + "failure to look, never a pass." };
  }

  // — AN UNREADABLE SIDE IS NOT A MISMATCH. A digest that could not be taken arrives as null, and
  // calling that "the two differ" would report drift invented out of a failure to read.
  const wsha = stamp.wrapperSha256 ?? null;
  const msha = stamp.masterSha256 ?? null;
  if (!wsha || !msha) {
    // The clause is written out per case rather than interpolated into one sentence: the single-sided
    // wording needs the negation and the both-sided wording carries it in "neither", so the one shared
    // sentence read "the master could be read as a digest" — the opposite of what happened, past an arm
    // that matched the phrase and never read the verb.
    const which = !wsha && !msha ? "neither the running copy of the updater nor its master could be read as a digest"
      : !wsha ? "the running copy of the updater could NOT be read as a digest"
      : "the master could NOT be read as a digest";
    const why = stamp.masterCommitError ? ` The updater reported: ${stamp.masterCommitError}` : "";
    return { state: "fail", message:
      `the updater stamp is present but ${which}, so the running copy was NOT `
      + `compared against its master.${why} This is a failure to look, never a pass.` };
  }

  // — THE AGE IS ALWAYS PRINTED AND RARELY JUDGED. A stopped deploy timer already fails on its own arm,
  // and a second red for one condition teaches a reader to discount both. This fires only when the stamp
  // is old enough that the updater cannot be running on any schedule the box could be keeping.
  const writtenAt = Number(stamp.writtenAt) || 0;
  const ageSeconds = now && writtenAt ? Math.max(0, now - writtenAt) : null;
  const ageNote = ageSeconds === null
    ? " (the stamp carries no readable time, so its age is unknown)"
    : ` (stamped ${Math.floor(ageSeconds / 60)} min ago)`;

  if (wsha !== msha) {
    return { state: "fail", message:
      `the running copy of the updater DIFFERS from its master${ageNote}: the copy that ran digests `
      + `${short(wsha)} and the master it was taken from digests ${short(msha)}. This box is being `
      + "deployed by an updater that is not the one in the store — reported, not reconciled." };
  }

  if (ageSeconds !== null && ageSeconds > maxAgeSeconds) {
    return { state: "fail", message:
      `the updater last stamped itself ${Math.floor(ageSeconds / 3600)}h ago${
        maxAgeSeconds ? `, past the ${Math.floor(maxAgeSeconds / 3600)}h this check allows` : ""}. `
      + "The stamp is written at the top of every tick, so a stamp this old means the updater has not "
      + "run — whatever the box is serving, it is not tracking the branch." };
  }

  // — IS THIS UPDATER DEPLOYING THE TREE BEING CHECKED? The stamp records the checkout it places
  // commits into. A box whose health check reads one clone while its updater feeds another is the
  // two-clone straddle with the deploying mechanism on the far side of it, and the digests above agree
  // in that state exactly as they do in a healthy one.
  const norm = (p) => String(p ?? "").replace(/\/+$/, "");
  if (deployClone && stamp.checkout && norm(stamp.checkout) !== norm(deployClone)) {
    return { state: "fail", message:
      `the updater matches its master${ageNote}, but it deploys a DIFFERENT tree than the one being `
      + `checked: it places commits into ${stamp.checkout} while this check reads ${deployClone}. `
      + "Whatever it keeps current, it is not this one." };
  }

  const into = stamp.checkout ? `, into ${stamp.checkout}` : "";
  return { state: "pass", message:
    `the running copy of the updater matches its master${ageNote}${into}, both digesting ${short(wsha)}`
    + `, master read at commit ${short(stamp.masterCommit)}. This says the running copy matches the `
    + "master AS THIS BOX HOLDS IT: the store it is read from is not pulled automatically, so a store "
    + "nobody has fetched leaves both sides equally old and equally in agreement." };
}
