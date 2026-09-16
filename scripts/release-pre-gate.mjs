// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-pre-gate.mjs — let a stable cut reach the version script when every note has already been
// consumed by a pre-release.
//
// THE PROBLEM THIS EXISTS FOR, MEASURED. `changesets/action` decides whether to run `version-script` by
// counting the release notes it can see, and it does that ONCE, at the top of the run, before it touches
// the working tree. Its reader is `readChangesetState`:
//
//     let preState = await readPreState(cwd);
//     let changesets = await readChangesets(cwd);
//     if (preState !== undefined && preState.mode === "pre") {
//       return { preState, changesets: changesets.filter((c) => !c.id.startsWith("pre/")) };
//     }
//     return { preState: undefined, changesets };
//
// `readChangesets` DOES enumerate `.changeset/pre/`, giving each note an id beginning `pre/`. The filter
// that hides them applies only while the tree says `mode: "pre"`.
//
// A pre-release consumes a note by MOVING it into `.changeset/pre/`, where it waits so the eventual
// stable can list every change since the last stable. So the ordinary state after cutting a beta is: no
// notes at the top level, every note under `pre/`, and the flag still saying `pre`. In that state the
// action counts zero, skips the version script, emits no pull request number, and the stable cut refuses
// with "Nothing to cut" — a refusal about the wrong thing, because the tree holds a whole release.
//
// WHAT THIS DOES, AND WHY IT IS NOT A TRICK. It writes the channel the dispatch asked for into the file
// the action reads, before the action reads it. A stable cut IS a tree leaving pre-release mode, and the
// notes under `pre/` ARE the notes that stable will carry; saying so is a true statement about this cut,
// not a device to get past a check. `release-version.mjs` already states the same principle for the
// other reader: "the mode a cut needs is a fact about the channel asked for, not about what the last cut
// happened to do." There are two readers of that fact and they are reached separately.
//
// THE WRITE IS DISCARDED, ON PURPOSE, AND THAT IS THE POINT. The action's own first act inside
// `runVersion` is `git checkout changeset-release/main` followed by `git reset --hard <the run's
// commit>`, which puts `pre.json` back to `pre`. The version script then runs in that rebuilt tree, finds
// the tree still in pre mode, and performs the real transition itself with `changeset pre exit` — which
// is where the transition has to happen, and the reason it was moved there. So this changes what the
// action COUNTS and nothing about what the cut DOES. Nothing here versions anything, and a tree this
// touched still produces the same version it would have produced had the gate never been in the way.
//
// WHAT IT REFUSES TO DO. It is silent on a beta, on a tree that is not in pre mode, on a tree whose notes
// are at the top level where the action can already see them, and on a tree with no notes anywhere. That
// last one matters most: a cut with genuinely nothing to cut must still refuse, and it still does,
// because this writes nothing when `.changeset/pre/` is empty.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))));

/** A note is a `.md` file that is not the directory's own README. */
export function countNotes(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md").length;
}

/**
 * PURE. Whether this cut has to restate its channel for the action's counter, and nothing else.
 *
 * `null` means leave the tree alone, and every `null` here is a case the action already reads correctly
 * — including the two that must keep refusing. Only the one state the action cannot see returns a write.
 *
 * Kept separate from the file it writes so the decision can be driven against every member of the class
 * rather than only against the tree that happens to be checked out.
 */
export function preGateDecision({ cut, mode, topLevelNotes, preNotes }) {
  // A beta never restates anything. A beta with no pending notes MUST still refuse, and that refusal is
  // this function returning null.
  if (cut !== "stable") return null;
  // Not in pre mode: the action's filter is not engaged, so whatever is there is already counted.
  if (mode !== "pre") return null;
  // The action can see these. Touching the flag here would change the pull request's title for a cut
  // that never needed help.
  if (topLevelNotes > 0) return null;
  // Nothing anywhere. "Nothing to cut" is then the truth, and the refusal downstream is correct.
  if (preNotes === 0) return null;
  return { mode: "exit" };
}

export function main(root = ROOT, argv = process.argv.slice(2)) {
  const cut = (argv.find((a) => a.startsWith("--cut=")) ?? "").slice("--cut=".length);
  // `--root` exists so this can be driven against a built tree rather than only against the checkout it
  // happens to live in. The workflow never passes it: there the script sits in the repository being cut,
  // which is what ROOT already means.
  const rootFlag = argv.find((a) => a.startsWith("--root="));
  if (rootFlag) root = rootFlag.slice("--root=".length);
  const preJson = join(root, ".changeset", "pre.json");
  const flag = existsSync(preJson) ? JSON.parse(readFileSync(preJson, "utf8")) : null;
  const mode = flag?.mode ?? "none";
  const topLevelNotes = countNotes(join(root, ".changeset"));
  const preNotes = countNotes(join(root, ".changeset", "pre"));

  const decision = preGateDecision({ cut, mode, topLevelNotes, preNotes });
  const state = `cut=${cut || "none"}, mode=${mode}, ${topLevelNotes} note(s) pending, ${preNotes} already consumed by the pre-release`;
  if (!decision) {
    // SAYS SO EITHER WAY. A step that is silent when it does nothing cannot be told from a step that did
    // not run, and this one is skipped far more often than it acts.
    console.log(`release-pre-gate: ${state} — leaving the flag alone.`);
    return 0;
  }
  writeFileSync(preJson, `${JSON.stringify({ ...flag, ...decision }, null, 2)}\n`);
  console.log(`release-pre-gate: ${state} — the notes this stable carries are all under .changeset/pre/,`
    + " where the action does not count them while the flag says pre. Writing mode=exit so it counts them."
    + " The version script performs the real transition after the action rebuilds the tree; this write is"
    + " discarded by that rebuild and changes no version.");
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(main());
