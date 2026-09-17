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

/**
 * For every note now under `pre/`, the commit that most recently PUT IT THERE.
 *
 * ONE WALK OF `.changeset/`, NOT ONE QUERY PER FILE, and that is a correctness fix rather than a saving.
 * `git log --diff-filter=A -- .changeset/pre/<name>` looks right and lies in two ways. A cut consumes a
 * note by MOVING it, which git records as a rename and not an add. And a path-limited log simplifies
 * history: for a note that went into `pre/`, back out, and in again — which is exactly what the note that
 * prompted this guard did — it reports the FIRST creation and never mentions the release that consumed it.
 * Measured 2026-09-17: the query named `911b0b4 The report a client opens, redrawn` for a note the beta.6
 * version commit had just consumed, so the guard refused a tree that was correct.
 *
 * `--full-history` stops the simplification, `-M` makes the rename legible, and `--name-status` says where
 * each file LANDED. The first entry naming a destination under `pre/` is the most recent one, because the
 * log is newest-first.
 *
 * THE TWO FLAGS ARE NOT EQUALLY GUARDED, and that is written down rather than left to be discovered.
 * Removing `-M` reds the arm for this, because ignoring renames is the original defect and a linear
 * fixture reproduces it. Removing `--full-history` reds NOTHING, because the simplification it defeats
 * needs a MERGE in the history and the fixture repository has none — the real case was this repository
 * with main merged into a branch. So that flag is carried on a measurement rather than on a passing
 * test, and deleting it because nothing goes red would restore a defect no arm here can see.
 */
export function consumedProvenance(root = ROOT) {
  let out;
  try {
    out = execFileSync("git",
      ["log", "--full-history", "-M", "--name-status", "--format=@@%h%x00%an%x00%s", "--", ".changeset/"],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return new Map();   // no history to read — the caller reports that, it does not condemn anything
  }
  const seen = new Map();
  let commit = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@@")) {
      const [hash, author, subject] = line.slice(2).split("\0");
      commit = { hash, author, subject };
      continue;
    }
    if (!commit || !line.trim()) continue;
    const parts = line.split("\t");
    const dest = parts[parts.length - 1];           // A → the path; R → the destination
    const m = /^\.changeset\/pre\/(.+)$/.exec(dest);
    if (!m) continue;
    if (!seen.has(m[1])) seen.set(m[1], commit);    // newest-first, so the first sighting is the latest
  }
  return seen;
}

/** The commit that most recently put this note under `pre/`, or null when history cannot answer. */
export function addedBy(name, root = ROOT) {
  return consumedProvenance(root).get(name) ?? null;
}

/** The commit that consumed this note, as a line for a reader. */
export function consumedBy(name, root = ROOT) {
  const a = addedBy(name, root);
  return a ? `${a.hash} ${a.subject}` : null;
}

// A NOTE ARRIVES UNDER `pre/` ONE WAY ONLY: a cut moves it there after publishing it. The author and the
// subject of that commit are how it is recognised, and both are the release pipeline's own doing rather
// than a convention anybody types.
const VERSION_AUTHOR = "github-actions[bot]";
const VERSION_SUBJECT = /^Release\s/;

/**
 * Notes sitting in the consumed pile that no cut put there — written straight into `.changeset/pre/`.
 *
 * Such a note is born consumed: the versioning tool filters `pre/` ids out of its count while the tree is
 * in pre-release mode, so the note is never eligible for a release and nothing refuses it. It then lands
 * in the eventual stable's changelog as though a pre-release had already carried it. Measured
 * 2026-09-17: one note in this state, holding the whole report redesign, published by no release at all.
 *
 * NEEDS HISTORY. A shallow clone cannot say which commit added a file, and answering "misfiled" from a
 * missing answer would condemn every note on a depth-1 checkout. Those are returned as `unknown` and the
 * caller decides; `main` refuses to give a verdict when it could not look at any of them.
 */
export function misfiledNotes(root = ROOT) {
  const preDir = join(root, ".changeset", "pre");
  if (!existsSync(preDir)) return { misfiled: [], checked: 0, unknown: [] };
  const provenance = consumedProvenance(root);
  const misfiled = [], unknown = [];
  for (const name of mdIn(preDir, { keepReadme: true })) {
    const added = provenance.get(name);
    if (!added) { unknown.push(name); continue; }
    if (added.author !== VERSION_AUTHOR || !VERSION_SUBJECT.test(added.subject)) misfiled.push({ name, ...added });
  }
  return { misfiled, checked: misfiled.length + (mdIn(preDir, { keepReadme: true }).length - unknown.length - misfiled.length), unknown };
}

export function placementMain(root = ROOT) {
  const preDir = join(root, ".changeset", "pre");
  if (!existsSync(preDir)) {
    console.log("release-duplicate-notes: no .changeset/pre/ in this tree — nothing has been consumed yet.");
    return 0;
  }
  const { misfiled, unknown } = misfiledNotes(root);
  const total = mdIn(preDir, { keepReadme: true }).length;
  if (total && unknown.length === total) {
    console.error("release-duplicate-notes: could not look — no commit could be found for any of the "
      + `${total} note(s) under .changeset/pre/. This check reads history to tell a note a cut consumed `
      + "from one written straight into the consumed pile, so it needs a full clone (fetch-depth: 0).");
    return 2;
  }
  if (misfiled.length) {
    for (const m of misfiled) {
      console.error(`::error file=.changeset/pre/${m.name}::${m.name} sits in .changeset/pre/, the pile a cut `
        + `moves a note into AFTER publishing it, but it was put there by \`${m.hash} ${m.subject}\` rather than `
        + "by a release. A note written straight into pre/ is never counted, never published, and then appears "
        + "in the next stable's changelog as though a pre-release had carried it. Move it to .changeset/.");
    }
    console.error(`\nrelease-duplicate-notes: ${misfiled.length} note(s) in the consumed pile that no cut consumed`
      + `${unknown.length ? `, and ${unknown.length} whose history could not be read` : ""}.`);
    return 1;
  }
  console.log(`release-duplicate-notes: every one of the ${total - unknown.length} consumed note(s) was put there `
    + `by a release${unknown.length ? `; ${unknown.length} could not be read` : ""}.`);
  return 0;
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

if (isEntrypoint(import.meta.url)) {
  process.exitCode = process.argv.includes("--placement") ? placementMain() : main();
}
