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
//
// ── A DECLINATION ANSWERS FOR ITS OWN COMMIT, NOT FOR THE RANGE ──────────────────────────────────────
//
// This read one `Release-note: none` anywhere in the range as the answer for all of it, so a pack of
// fifteen commits, fourteen internal and each honestly declining, carried the fifteenth, the one a client
// would notice, through with no note. Measured on three packs merged 2026-09-09 and 2026-09-10: twelve
// client-visible changes reached main that way. So the question is asked per COMMIT. A commit that ships
// code is answered by a note the range adds, or by its own `Release-note: none` with its own reason. A
// declination written by one commit says nothing about another.
//
// A `Release-note:` LINE WITH A SENTENCE IN IT IS REFUSED, unless the same commit adds a note. Every one of
// the twelve was written by somebody who believed they had written a release note, and none of them had:
// the releases page is built from `.changeset/*.md`, and a line in a commit message reaches no reader. A
// line may instead NAME the note that answers for it, `Release-note: .changeset/<name>.md`, and that is read
// as an answer, provided the range adds that note.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The declaration a commit makes when the change genuinely has nothing to tell a reader. */
// Horizontal space only. `\s` crosses a line break, so a bare `none` with any line after it, a trailer or
// another paragraph, read that line as its reason and passed as a declared decision.
export const NO_NOTE = /^[ \t]*Release-note:[ \t]*none\b[ \t]*[—:.-]?[ \t]*(?<reason>.*\S)?[ \t]*$/im;

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

/** Every `Release-note:` line in a message, as its value. */
const NOTE_LINE = /^\s*Release-note:[ \t]*(?<value>.*?)[ \t]*$/gim;
/** A note named in a `Release-note:` line: `.changeset/<name>.md`, or the bare `<name>.md`. */
const NAMED_NOTE = /^(?:\.changeset\/)?(?<name>[\w.-]+\.md)$/;

const isNotePath = (p) => p.startsWith(".changeset/") && p.endsWith(".md") && !p.endsWith("README.md");
const shipped = (paths, files) => paths.filter((p) => !NEVER_A_NOTE.some((re) => re.test(p)) && shipsCode(p, files));

// A NOTE COUNTS WHEN ITS COMMIT ADDS IT AND THE HEAD STILL HAS IT. A commit's paths come from `diff-tree`,
// which lists what it deletes and edits beside what it adds. Read as notes, a range whose only note was
// one it DELETED answered for every code commit in it, and a commit that edited another change's note was
// taken as carrying its own. Neither reaches a reader of this range: the release assembles the notes the
// head carries, and an edited note still describes the change that wrote it. Found in review, 2026-09-10,
// by driving both shapes; the range-wide rule this replaced had the same gap.
/**
 * PURE. What each commit in a range owes, decided per commit (see the header).
 *
 * @param {object} o
 * @param {Array<{sha:string, subject:string, message:string, paths:string[], added?:string[]}>} o.commits  non-merge,
 *   oldest first; `added` is the paths the commit adds, when the caller read them
 * @param {string[]} o.files  the package's own `files` list
 * @param {string[]|null} [o.atHead]  every path the head carries under `.changeset/`, when the caller read it
 * @returns {{visible:string[], notes:string[], declined:Array<{sha:string, subject:string, reason:string}>,
 *   owed:Array<{sha:string, subject:string, why:"no-note"|"prose"|"bare-none"|"names-a-missing-note", paths?:string[], text?:string}>}}
 */
export function commitVerdicts({ commits = [], files = [], atHead = null } = {}) {
  // `added` and `atHead` are what the command reads from git; a caller that passes neither keeps the older
  // reading of every changed path, which is what a pure table of paths means.
  const present = atHead ? new Set(atHead) : null;
  const notesOf = (c) => (c.added ?? c.paths).filter((p) => isNotePath(p) && (!present || present.has(p)));
  const notes = [...new Set(commits.flatMap(notesOf))];
  const noteNames = new Set(notes.map((p) => p.split("/").pop()));
  const visible = [...new Set(commits.flatMap((c) => shipped(c.paths, files)))];
  const declined = [], owed = [];
  for (const c of commits) {
    const ships = shipped(c.paths, files);
    if (!ships.length) continue;                              // nothing a reader could see in this commit
    const addsNote = notesOf(c).length > 0;
    const values = [...String(c.message ?? "").matchAll(NOTE_LINE)].map((m) => m.groups.value);
    const named = values.map((v) => NAMED_NOTE.exec(v)?.groups.name).filter(Boolean);
    const prose = values.filter((v) => !/^none\b/i.test(v) && !NAMED_NOTE.test(v));
    const at = { sha: c.sha, subject: c.subject };
    if (prose.length && !addsNote) { owed.push({ ...at, why: "prose", text: prose[0] }); continue; }
    const none = NO_NOTE.exec(String(c.message ?? ""));
    if (none) {
      const reason = none.groups?.reason;
      if (reason) declined.push({ ...at, reason }); else owed.push({ ...at, why: "bare-none" });
      continue;
    }
    if (addsNote) continue;                                   // it carries its own note
    const missing = named.filter((n) => !noteNames.has(n));
    if (missing.length) { owed.push({ ...at, why: "names-a-missing-note", text: missing[0] }); continue; }
    if (named.length) continue;                               // it names a note the range adds
    if (notes.length) continue;                               // a note in the range answers for it
    owed.push({ ...at, why: "no-note", paths: ships });
  }
  return { visible, notes, declined, owed };
}

const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

function main() {
  const base = argAfter("--base") || "origin/main";
  // ── `--head`, SO THE ACCEPTANCE TEST CAN BE STATED AT ALL ────────────────────────────────────────
  //
  // This check exists because one merge landed sixteen shipped files and no note, and the way to prove
  // it works is to replay it against that merge. With HEAD hardwired, `--base <merge>^` from any later
  // branch reaches that branch's own notes and PASSES — correctly, and answering a different question.
  // An arm named for the replay was asserting only that the check did not exit 2, which it could not
  // have failed, and would have reported the acceptance met for the life of the branch.
  const head = argAfter("--head") || "HEAD";
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
  let changed, commits, atHead;
  try {
    changed = git("diff", "--name-only", `${base}...${head}`).split("\n").filter(Boolean);
    // THE BRANCH'S OWN COMMITS. On a pull request the range can reach commits main already carries, from
    // main merged into the branch; each of those was asked when it merged, so it is not asked again here.
    // Only when `--head` is not given: a named range is a replay, and asks about exactly what it names.
    let exclude = [];
    if (head === "HEAD") {
      try { git("rev-parse", "--verify", "-q", "origin/main^{commit}"); exclude = ["--not", "origin/main"]; }
      catch { /* no origin/main in this clone: the range as given */ }
    }
    const shas = git("rev-list", "--no-merges", "--reverse", `${base}..${head}`, ...exclude).split("\n").filter(Boolean);
    commits = shas.map((sha) => ({
      sha,
      subject: git("log", "-1", "--format=%s", sha).trim(),
      message: git("log", "-1", "--format=%B", sha),
      paths: git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha).split("\n").filter(Boolean),
      added: git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "--diff-filter=A", sha).split("\n").filter(Boolean),
    }));
    atHead = git("ls-tree", "-r", "--name-only", head, "--", ".changeset/").split("\n").filter(Boolean);
  } catch (e) {
    // COULD NOT LOOK, never a pass — an unresolvable base is the shape this repository cares about.
    console.error(`release-note-required: cannot read the range against ${base}: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }

  let files;
  try { files = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).files ?? []; }
  catch (e) { console.error(`release-note-required: cannot read the shipped file list: ${e.message}`); process.exit(2); }
  if (!files.length) { console.error("release-note-required: package.json names no shipped files, so this cannot look"); process.exit(2); }

  const { visible, notes, declined, owed } = commitVerdicts({ commits, files, atHead });
  console.log(`release-note-required: ${changed.length} changed file(s) against ${base}`
    + `${head === "HEAD" ? "" : ` (head ${head})`}; `
    + `${visible.length} ship as code; ${notes.length} release note(s) in the range; ${commits.length} commit(s) read`);
  for (const d of declined) console.log(`  no note, declared on purpose by ${d.sha.slice(0, 7)}: ${d.reason}`);
  if (!owed.length) return;

  console.error(`\n${owed.length} commit(s) that ship as code owe a release note:\n`);
  for (const o of owed) {
    console.error(`  ${o.sha.slice(0, 7)} ${o.subject}`);
    if (o.why === "no-note") {
      for (const p of o.paths.slice(0, 6)) console.error(`      ${p}`);
      if (o.paths.length > 6) console.error(`      … and ${o.paths.length - 6} more`);
      console.error("      ships as code, this range adds no release note, and this commit does not decline one.");
    } else if (o.why === "prose") {
      console.error(`      says "Release-note: ${o.text.slice(0, 100)}". A sentence in a commit message reaches no`
        + "\n      reader: the releases page is written from .changeset/*.md. Put it in a note, or decline here.");
    } else if (o.why === "bare-none") {
      console.error("      says `Release-note: none` and gives no reason. The reason is the whole point of the"
        + "\n      line — it is what a later reader uses to tell a considered decision from a skipped step.");
    } else {
      console.error(`      names ${o.text} as its note, and this range adds no note by that name.`);
    }
  }
  console.error("\nSomebody installing Clearotron reads the releases page to decide whether to upgrade. Add a"
    + "\nnote — `npx changeset`, one plain sentence about what is different for them — or, if a commit"
    + "\ngenuinely has nothing to tell them, say so in THAT commit's message:"
    + "\n\n    Release-note: none — <why a reader would see no difference>"
    + "\n\nThe contract and its examples are in .changeset/README.md.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
