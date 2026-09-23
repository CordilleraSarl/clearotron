// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-rehearsal-version.mjs — what a rehearsal publishes: the version a beta cut would publish now.
//
//   node scripts/release-rehearsal-version.mjs      # stdout: publish_dry_run=true|false; the rest on stderr
//
// WHY A REHEARSAL DOES NOT PUBLISH MAIN'S VERSION. Main's version is the one already out on almost every
// day: a cut stamps it and publishes it, and it stays on main until the next cut. npm checks the registry
// even on `npm publish --dry-run`, so a rehearsal of main's own version answered "You cannot publish over
// the previously published versions" and went red (measured 2026-09-23 on 0.3.3), reading as a broken
// pipeline when nothing was wrong. It passed only between a cut and its publish, when nobody rehearses.
//
// So a rehearsal stamps the tree the way a `cut: beta` dispatch does, with release-version.mjs itself, and
// dry-runs that version: the one a cut made now would publish. The stamp lives in the job's own checkout
// and is never committed.
//
// WITH NO NOTE PENDING THERE IS NOTHING TO CUT, and a cut would refuse for exactly that reason. The
// version is then main's, which is out, so the publish dry run is skipped and says why, while every check
// before it still runs on those bytes. A note that is pending and still cannot be cut is a real failure,
// and the rehearsal fails with the version script's own refusal.
//
// Exit 0: stamped, or nothing to cut. Exit 1: the version script refused. Exit 2: could not look.
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { countNotes } from "./release-pre-gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** PURE. What a rehearsal does with the notes it finds pending at the top of `.changeset/`. */
export function rehearsalPlan({ pendingNotes }) {
  if (!Number.isInteger(pendingNotes) || pendingNotes < 0) return { action: "could-not-look" };
  return pendingNotes > 0 ? { action: "stamp-next-beta" } : { action: "nothing-to-cut" };
}

export function main(root = ROOT) {
  let pendingNotes;
  try { pendingNotes = countNotes(join(root, ".changeset")); }
  catch (e) { console.error(`release-rehearsal-version: could not read .changeset/: ${e.message}. Could not look.`); return 2; }
  const plan = rehearsalPlan({ pendingNotes });
  if (plan.action === "could-not-look") { console.error("release-rehearsal-version: could not count the pending notes. Could not look."); return 2; }
  if (plan.action === "nothing-to-cut") {
    console.error("release-rehearsal-version: no release note is pending, so there is nothing to cut and main's version is the one already out.");
    console.log("publish_dry_run=false");
    return 0;
  }
  console.error(`release-rehearsal-version: ${pendingNotes} note(s) pending; stamping the version a \`cut: beta\` would publish.`);
  // The version script's own output goes to stderr, so stdout carries the one line the workflow keeps.
  const r = spawnSync(process.execPath, [join(root, "scripts", "release-version.mjs"), "--cut=beta"], { cwd: root, stdio: ["ignore", 2, 2] });
  if (r.status !== 0) {
    console.error(`release-rehearsal-version: the version script refused (exit ${r.status ?? r.signal}), so a beta cut made now would refuse too.`);
    return 1;
  }
  console.log("publish_dry_run=true");
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exitCode = main();
