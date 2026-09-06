// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// release-note-required.mjs — did a change that a reader can see arrive with something to read?
//
//   node scripts/release-note-required.mjs [--base <ref>]
//
// WHY THIS EXISTS. A bundle of nine operator-facing repairs landed with no note at all, so the release
// cut nothing and every one of them would have reached the releases page as silence. Nothing was broken
// and nothing went red: the notes are a separate file that nobody is asked for, and the lint that reads
// them only runs once they exist. A check whose subject is "the thing somebody forgot" cannot itself be
// the thing somebody forgets.
//
// ── WHAT COUNTS AS A CHANGE A READER CAN SEE ─────────────────────────────────────────────────────────
//
// Shipped code. Not "workspace source": read literally that would be the four workspace directories, and
// the bundle that prompted this changed none of them — every user-visible repair in it was in the root
// package. So the question is whether a path SHIPS, and that is answered by `package.json`'s own `files`
// list rather than by a list here, because a second list is one that goes stale. Tests, benches and
// fixtures are already excluded there, by the package, for the same reason a reader never sees them.
//
// ── AND WHY IT CAN BE ANSWERED WITH "NOTHING TO SAY" ──────────────────────────────────────────────────
//
// `.changeset/README.md` — the owner's contract, not a convention — says plainly that some changes need
// no note: "a note says what is different for that reader. If you cannot finish that sentence, there is
// nothing to say." A check that demanded a note for every shipped line would force somebody to write a
// sentence the contract says should not exist, and a check that makes people write lies is worse than no
// check at all.
//
// Measured rather than assumed, over the last twenty-five merges to main: thirteen changed shipped code,
// eight carried a note, and five did not — of those five, one was the miss this check exists to catch and
// the rest were prose inside code files, test scaffolding, and release plumbing. Roughly three in five of
// its refusals would have been wrong. So the escape is real, and it is not silent: a commit in the range
// says `Release-note: none` and gives a reason on the same line. That is a sentence somebody wrote on
// purpose, it lives in the history where the change does, and it can be read back later — which an empty
// file or a green tick cannot.
//
// ── WHAT THIS CANNOT SEE ─────────────────────────────────────────────────────────────────────────────
//
// Whether a note is TRUE, whether it describes this change, or whether a `Release-note: none` reason is
// honest. It checks that somebody was asked and answered. `release-notes-lint.mjs` reads the answer's
// form; a person still has to read its meaning.
//
// AND THE ONE WORTH SAYING OUT LOUD, because it is this check's own failure wearing a smaller size: it
// asks for AT LEAST ONE note in the range, and cannot tell which change any note is about. A bundle of
// nine repairs with one note between them passes here — eight of them reaching the releases page as the
// same silence this exists to stop. The range that prompted it had zero, which is why zero is what it
// can catch.
//
// Left as it is on purpose. Mapping notes to changes would need the check to know which file each note
// is about, and it does not and cannot: the notes are written for a reader who has never opened this
// repository and deliberately name no paths. A count-matching rule would be false precision — two notes
// for two changes is no evidence they are the right two — and it would push people to write filler to
// reach a number, which is the failure this repository has already paid for once. The remaining half is
// a person reading the diff and asking what a lawyer would want told.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The declaration a commit makes when the change genuinely has nothing to tell a reader. */
export const NO_NOTE = /^\s*Release-note:\s*none\b\s*[—:-]?\s*(?<reason>.*\S)?\s*$/im;

/**
 * Does this path ship, per the package's own `files` list?
 *
 * A negated pattern — one opening with `!`, as the test and fixture exclusions do — wins wherever
 * it appears, which is what makes tests exempt here without a second list to keep in step.
 */
export function shipsCode(path, files) {
  if (!/\.(mjs|ts|tsx|js)$/.test(path)) return false;
  // SOURCE THAT IS BUILT INTO SOMETHING SHIPPED COUNTS AS SHIPPED, and this is not a special case for
  // one directory. The package ships `portal-ui/dist/`, which is generated and git-ignored — so it can
  // never appear in a diff, and reading `files` alone would exempt every change to the screens a reader
  // actually looks at. Measured: past changes under `portal-ui/src` carried release notes, so the notes
  // agree this is reader-visible even though the shipped artefact is not in the tree.
  //
  // Derived from the same list rather than named here: for every shipped `<pkg>/dist/`, the sibling
  // `<pkg>/src/` is where it comes from. A second built package inherits this without an edit.
  for (const pattern of files) {
    const m = /^(.*)\/dist\/?$/.exec(pattern.replace(/^!/, ""));
    if (m && !pattern.startsWith("!") && path.startsWith(`${m[1]}/src/`)) return true;
  }
  let shipped = false;
  for (const pattern of files) {
    const negated = pattern.startsWith("!");
    const glob = negated ? pattern.slice(1) : pattern;
    if (!matches(path, glob)) continue;
    if (negated) return false;                 // an exclusion is final, wherever it appears
    shipped = true;
  }
  return shipped;
}

/** The small slice of glob the `files` list actually uses: a directory prefix, and star wildcards. */
function matches(path, glob) {
  if (glob.endsWith("/")) return path.startsWith(glob);
  if (!glob.includes("*")) return path === glob || path.startsWith(`${glob}/`);
  const re = new RegExp("^" + glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/(?<!\.)\*/g, "[^/]*") + "$");
  return re.test(path);
}

/** Paths that ship as code but say nothing to a reader on their own. */
export const NEVER_A_NOTE = [/(^|\/)CHANGELOG\.md$/, /(^|\/)package(-lock)?\.json$/, /^\.changeset\//];

const baseArg = () => {
  const i = process.argv.indexOf("--base");
  return i === -1 ? null : process.argv[i + 1];
};

function main() {
  const base = baseArg() || "origin/main";
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
  let changed, log;
  try {
    changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
    log = git("log", "--format=%B", `${base}..HEAD`);
  } catch (e) {
    // COULD NOT LOOK, never a pass — an unresolvable base is the shape this repository cares about.
    console.error(`release-note-required: cannot read the range against ${base}: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }

  let files;
  try { files = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).files ?? []; }
  catch (e) { console.error(`release-note-required: cannot read the shipped file list: ${e.message}`); process.exit(2); }
  if (!files.length) { console.error("release-note-required: package.json names no shipped files, so this cannot look"); process.exit(2); }

  const visible = changed.filter((p) => !NEVER_A_NOTE.some((re) => re.test(p)) && shipsCode(p, files));
  const notes = changed.filter((p) => p.startsWith(".changeset/") && p.endsWith(".md") && !p.endsWith("README.md"));
  const declined = NO_NOTE.exec(log);

  console.log(`release-note-required: ${changed.length} changed file(s) against ${base}; `
    + `${visible.length} ship as code; ${notes.length} release note(s) in the range`);

  if (!visible.length) return;                              // nothing a reader could see
  if (notes.length) return;                                 // asked and answered
  if (declined) {
    const reason = declined.groups?.reason;
    if (!reason) {
      console.error("\nA commit says `Release-note: none` and gives no reason. The reason is the whole "
        + "point of the line — it is what a later reader uses to tell a considered decision from a\nskipped step. Write it on the same line.");
      process.exit(1);
    }
    console.log(`  no note, declared on purpose: ${reason}`);
    return;
  }

  console.error(`\n${visible.length} file(s) that ship as code changed, and this range adds no release note:\n`);
  for (const p of visible.slice(0, 12)) console.error(`  ${p}`);
  if (visible.length > 12) console.error(`  … and ${visible.length - 12} more`);
  console.error("\nSomebody installing Clearotron reads the releases page to decide whether to upgrade. Add a"
    + "\nnote — `npx changeset`, one plain sentence about what is different for them — or, if this change"
    + "\ngenuinely has nothing to tell them, say so in a commit message:"
    + "\n\n    Release-note: none — <why a reader would see no difference>"
    + "\n\nThe contract and its examples are in .changeset/README.md.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
