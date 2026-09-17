// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-duplicate-notes.mjs — refuse a release note that sits in `.changeset/` and `.changeset/pre/` at
// once, because the next cut would publish its text a second time.
//
//   node scripts/release-duplicate-notes.mjs
//
// Exit 0 when no note is in both places · 1 when one is, each named with the cut that consumed it · 2 when
// it could not look.
//
// ── WHAT GOES WRONG, MEASURED ──────────────────────────────────────────────────────────────────────
//
// A pre-release consumes a note by MOVING it from `.changeset/` into `.changeset/pre/`, where it waits so
// the eventual stable can list every change since the last stable. A branch that carries its own copy of
// work already on main can put that same filename back at the top level. The tree then holds both, and
// nothing refuses it: the next cut consumes the top-level copy again and republishes its sentence on the
// releases page — the surface a stranger reads to decide whether to upgrade.
//
// Seen on a report pack's head, 2026-09-16: ten notes consumed by a beta at 17:32Z were re-added three
// minutes later by a branch commit. No run would have failed.
//
// ── WHY THE CONSUMING CUT COMES FROM GIT AND NOT FROM pre.json ─────────────────────────────────────
//
// It would be natural to read the consuming release out of `.changeset/pre.json`. It is not there. In
// changesets 3.x that file carries `{ mode, tag }` and nothing else — no list of consumed notes and no
// initial versions — so the only record of WHICH cut took a note is the commit that added it under
// `pre/`. That commit is the version commit, and its subject names the release. A guard that read
// `pre.json` for this would find an absent field and report nothing, which is the failure this comment
// exists to stop somebody re-introducing.
//
// ── THE FLOOR ──────────────────────────────────────────────────────────────────────────────────────
//
// An empty `.changeset/` is the ordinary state straight after a cut, and an empty `pre/` is the ordinary
// state on a tree that has never pre-released. Neither is a defect, but a run that enumerated nothing
// because it was pointed at the wrong place must not read as a pass, so the count of what was compared is
// printed on success and a missing `.changeset/` is a refusal rather than a clean answer.
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const mdIn = (dir, { keepReadme = false } = {}) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && (keepReadme || e.name !== "README.md"))
    .map((e) => e.name)
    .sort();

/** The notes present in BOTH `.changeset/` and `.changeset/pre/`, by file name. */
export function duplicateNotes(root = ROOT) {
  const dir = join(root, ".changeset");
  if (!existsSync(dir)) return { error: `${dir} does not exist — this is not a tree that carries release notes` };
  const preDir = join(dir, "pre");
  const waiting = mdIn(dir);
  const consumed = existsSync(preDir) ? mdIn(preDir, { keepReadme: true }) : [];
  const inPre = new Set(consumed);
  return { duplicates: waiting.filter((n) => inPre.has(n)), waiting: waiting.length, consumed: consumed.length };
}

/** The commit that ADDED this note under `pre/` — the version commit of the cut that consumed it. */
export function consumedBy(name, root = ROOT) {
  try {
    const out = execFileSync("git",
      ["log", "--diff-filter=A", "-1", "--format=%h %s", "--", `.changeset/pre/${name}`],
      // stderr ignored: outside a checkout git writes "fatal: not a git repository", and this function's
      // answer to that is "no commit found", not a line of noise in the middle of a CI failure.
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function main(root = ROOT) {
  const read = duplicateNotes(root);
  if (read.error) {
    console.error(`release-duplicate-notes: could not look — ${read.error}.`);
    return 2;
  }
  if (read.duplicates.length) {
    for (const name of read.duplicates) {
      const by = consumedBy(name, root);
      console.error(`::error file=.changeset/${name}::${name} is in .changeset/ and in .changeset/pre/ at once. `
        + `It was already consumed by ${by ? `\`${by}\`` : "an earlier cut (no commit found that added it under pre/)"}, `
        + "so the next cut would publish its text a second time. Delete the copy at the top level — the one "
        + "under pre/ is the record the stable release reads.");
    }
    console.error(`\nrelease-duplicate-notes: ${read.duplicates.length} note(s) counted twice, `
      + `of ${read.waiting} waiting and ${read.consumed} already consumed.`);
    return 1;
  }
  console.log(`release-duplicate-notes: no note is counted twice — ${read.waiting} waiting, `
    + `${read.consumed} already consumed by an earlier cut.`);
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exitCode = main();
