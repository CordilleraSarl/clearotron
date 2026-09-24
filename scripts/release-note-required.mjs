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
// ── ONLY A PULL REQUEST'S OWN COMMITS ARE READ, AND THAT IS THE ONLY READING THAT COUNTS ─────────────
//
// The per-commit question below does not survive a squash. A squash commit adds every note the branch
// carried, so it "carries its own note", and any prose release line it inherited from a folded commit is
// excused. Measured on a simulated squash of an integration branch whose one offending commit this guard
// refused commit by commit: over the squash it passed. So this guard is a gate only where it reads the
// commits a pull request brings, one at a time, before they are folded. That is how CI runs it, on the
// pull request's range; on a push to main the range is empty and it says so rather than passing quietly.
//
// AND POINTED AT MAIN'S OWN LINE IT SAYS SO, ON EVERY ANSWER. A range with a commit on `origin/main`'s
// first-parent history is reading the squashes themselves. That reading still catches a squash that
// shipped code with no note at all (an arm replays one), so it is not refused. It cannot catch a prose
// line a squash inherited, and its pass is therefore not the per-commit answer. So every answer over
// that line carries the sentence that says which of the two it can give. An audit of what shipped
// reads the pull requests that brought it, never the squashes they became. An arm pins
// both readings side by side, and that CI runs this on the pull request's range and nowhere else.
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
//
// ── A NOTE THE RANGE WITHDRAWS, AND SAYS WHY, IS AN ANSWER ────────────────────────────────────────────
//
// A ruling took a beta-only change back out, and the commit that removed it removed the note that
// announced it too, so the stable changelog would not promise a ceiling the stable release does not have.
// That deletion is right, and it left two earlier commits naming a note the range no longer carries:
// refused, and unfixable, because the only fix the check offered was editing commits already pushed.
//
// So a note that a LATER commit in the same range DELETES counts as consumed for the commits that added
// or named it — provided the deleting commit says why, in its own `Release-note: none — <reason>` or in a
// note of its own. The reason is asked of the DELETING commit because it is the newest of the two, the
// only one that can still be amended, and the one that knows why the reader now hears nothing. Said, not
// silent: every commit excused this way is printed with the sha that withdrew its note and that reason.
//
// A deletion that gives no reason still refuses, and names the deleting commit as where the reason goes.
// The move a pre-release makes — `.changeset/<name>.md` deleted and `.changeset/pre/<name>.md` added in
// one commit — is not a withdrawal: the note still reaches a reader, and a version commit is that shape.
// ── A LATER COMMIT MAY ANSWER A BARE `none` FOR ONE NAMED COMMIT ───────────────────────────────────────
//
// A commit carried `Release-note: none` with no reason and was merged into an integration branch before
// anyone read it, and a second branch was already built on that merge. The only fix this check offered was
// the commit's own message, so the answer was a rewrite of a shared branch. A later commit may therefore
// answer for it, in its own message:
//
//     Release-note-for: <sha> none — <why a reader would see no difference>
//
// Held tight, because a loose one excuses by accident:
//   - one line names one commit, by its full sha or a prefix of at least 7 characters, resolved against
//     THIS range's commits only. A prefix that matches none of them, or several, is refused;
//   - the named commit must be an ANCESTOR of the answering one (git ancestry, never timestamps), and a
//     commit cannot answer for itself;
//   - the reason is read by NO_NOTE itself, so the two forms cannot drift. Empty, or a dash, is refused;
//   - one commit takes one answer: two lines naming the same commit are both refused, even when they agree;
//   - an answer naming a commit that owes none (it ships no code, carries a note, or gives its own reason)
//     is refused as stale. An answer ignored in silence reads as though it did something.
// Every answer taken is printed with the sha that gave it, and every refused answer fails the check and
// names the commit that carries it. The answering commit is read like any other: one that ships no code,
// such as an empty commit, owes nothing of its own.
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
/** `Release-note-for: <sha> none — <reason>`: a later commit answering a bare `none` (see the header). */
const ANSWER_LINE = /^[ \t]*Release-note-for:[ \t]*(?<rest>.*?)[ \t]*$/gim;
const ANSWER_HEAD = /^(?<sha>[0-9a-f]{7,40})(?<tail>(?:[ \t].*)?)$/i;

/**
 * PURE. Every `Release-note-for:` line in the range, judged. `isAncestor(a, b)` says whether commit `a` is
 * an ancestor of commit `b`; without one, range order stands in for it (the range is read oldest first).
 * @returns {{answers: Map<string, {by:string, subject:string, reason:string}>,
 *   refused: Array<{sha:string, subject:string, text:string, problem:string}>}}
 */
export function readAnswers(commits = [], isAncestor = null) {
  const refused = [];
  const claims = new Map();
  commits.forEach((c, at) => {
    for (const m of String(c.message ?? "").matchAll(ANSWER_LINE)) {
      const text = m[0].trim();
      const bad = (problem) => refused.push({ sha: c.sha, subject: c.subject, text, problem });
      const head = ANSWER_HEAD.exec(m.groups.rest);
      if (!head) { bad("names no commit: the form is `Release-note-for: <sha> none — <reason>`"); continue; }
      const none = NO_NOTE.exec(`Release-note:${head.groups.tail}`);
      if (!none) { bad("does not say `none` straight after one sha: one line answers one commit"); continue; }
      if (!none.groups?.reason) { bad("gives no reason, and the reason is the whole point of the line"); continue; }
      const prefix = head.groups.sha.toLowerCase();
      const hits = commits.filter((k) => String(k.sha).toLowerCase().startsWith(prefix));
      if (!hits.length) { bad(`names ${prefix}, which is not a commit in this range`); continue; }
      if (hits.length > 1) { bad(`names ${prefix}, which matches ${hits.length} commits in this range`); continue; }
      const target = hits[0];
      const later = target.sha !== c.sha
        && (isAncestor ? isAncestor(target.sha, c.sha) : commits.indexOf(target) < at);
      if (!later) { bad(`names ${prefix}, which is not an earlier commit on this commit's own history`); continue; }
      if (!claims.has(target.sha)) claims.set(target.sha, []);
      claims.get(target.sha).push({ by: c.sha, subject: c.subject, text, reason: none.groups.reason });
    }
  });
  const answers = new Map();
  for (const [sha, list] of claims) {
    if (list.length > 1) {
      for (const a of list) refused.push({ sha: a.by, subject: a.subject, text: a.text,
        problem: `is one of ${list.length} answers naming ${sha.slice(0, 7)}; one commit takes one answer` });
      continue;
    }
    answers.set(sha, list[0]);
  }
  return { answers, refused };
}

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
 * @param {Array<{sha:string, subject:string, message:string, paths:string[], added?:string[], deleted?:string[]}>} o.commits
 *   non-merge, oldest first; `added` and `deleted` are the paths the commit adds and removes, when the caller read them
 * @param {string[]} o.files  the package's own `files` list
 * @param {string[]|null} [o.atHead]  every path the head carries under `.changeset/`, when the caller read it
 * @param {((a:string, b:string) => boolean)|null} [o.isAncestor]  git ancestry for `Release-note-for:` answers; range order without it
 * @returns {{visible:string[], notes:string[], declined:Array<{sha:string, subject:string, reason:string}>,
 *   withdrawals:Array<{sha:string, subject:string, note:string, by:string, reason:string}>,
 *   answered:Array<{sha:string, subject:string, by:string, reason:string}>,
 *   refusedAnswers:Array<{sha:string, subject:string, text:string, problem:string}>,
 *   owed:Array<{sha:string, subject:string, why:"no-note"|"prose"|"bare-none"|"names-a-missing-note"|"note-withdrawn-unsaid",
 *   paths?:string[], text?:string, by?:string}>}}
 */
export function commitVerdicts({ commits = [], files = [], atHead = null, isAncestor = null } = {}) {
  // `added` and `atHead` are what the command reads from git; a caller that passes neither keeps the older
  // reading of every changed path, which is what a pure table of paths means.
  // MATCHED ON THE NAME, NOT THE PATH, BECAUSE A PRE-RELEASE MOVES A NOTE IT CONSUMES.
  //
  // changesets in pre mode does not delete the note it publishes: it MOVES it from
  // `.changeset/<name>.md` into `.changeset/pre/<name>.md`, and re-applies every one of them when the
  // pre range is exited. The note still exists and still reaches the releases page — twice, once in the
  // pre-release and once in the stable cut it rolls into.
  //
  // Asking whether the ADDED PATH still exists therefore loses every note written before the last
  // pre-release cut, and the commit that wrote one is reported as owing a note it did write. The
  // failure arrives the moment a branch merges a main that has had a beta cut on it, which is now the
  // ordinary case rather than an edge one.
  const presentNames = atHead
    ? new Set(atHead.filter(isNotePath).map((p) => p.split("/").pop()))
    : null;
  const notesOf = (c) => (c.added ?? c.paths)
    .filter((p) => isNotePath(p) && (!presentNames || presentNames.has(p.split("/").pop())));
  const notes = [...new Set(commits.flatMap(notesOf))];
  const noteNames = new Set(notes.map((p) => p.split("/").pop()));
  const visible = [...new Set(commits.flatMap((c) => shipped(c.paths, files)))];
  const nameOf = (p) => p.split("/").pop();
  // WHICH NOTES THIS RANGE TAKES BACK, AND WHETHER IT SAYS WHY. A commit that deletes a note path and
  // adds one of the same name is MOVING it — what a pre-release cut does to every note it consumes — and
  // a move is not a withdrawal. A name the head still carries was never withdrawn at all.
  //
  // THE DELETION THAT ANSWERS IS THE LAST ONE, because a note can go and come back. This note was
  // written, consumed into `.changeset/pre/` by a beta cut, brought back at its old path by a merge of a
  // main the cut had already taken it from, dropped again as a duplicate, and only then removed under the
  // ruling. Taking the first deletion would have printed the duplicate sweep's reason — "removes
  // duplicates of notes that already shipped" — against a commit the ruling is what excuses. Measured on
  // the range, 2026-09-18.
  const withdrawn = new Map();
  commits.forEach((c, at) => {
    const readded = new Set((c.added ?? []).filter(isNotePath).map(nameOf));
    for (const p of (c.deleted ?? []).filter(isNotePath)) {
      const name = nameOf(p);
      if (readded.has(name)) continue;
      const own = notesOf(c).map(nameOf);
      const reason = NO_NOTE.exec(String(c.message ?? ""))?.groups?.reason
        ?? (own.length ? `the note ${own[0]} it wrote in its place` : null);
      withdrawn.set(name, { sha: c.sha, subject: c.subject, reason, at });
    }
    for (const name of readded) withdrawn.delete(name);   // a later copy puts the note back in the range
  });
  // AND A NAME THE HEAD STILL CARRIES WAS NEVER WITHDRAWN AT ALL: the release assembles what the head has.
  if (presentNames) for (const name of [...withdrawn.keys()]) if (presentNames.has(name)) withdrawn.delete(name);
  const declined = [], owed = [], withdrawals = [], answered = [];
  const { answers, refused: refusedAnswers } = readAnswers(commits, isAncestor);
  const used = new Set();
  for (const [i, c] of commits.entries()) {
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
      const answer = reason ? null : answers.get(c.sha);
      if (reason) declined.push({ ...at, reason });
      else if (answer) { answered.push({ ...at, by: answer.by, reason: answer.reason }); used.add(c.sha); }
      else owed.push({ ...at, why: "bare-none" });
      continue;
    }
    if (addsNote) continue;                                   // it carries its own note
    // THE NOTE THIS COMMIT ANSWERED WITH, TAKEN BACK BY A LATER ONE. Only a later commit: a name deleted
    // before this commit named it was never this commit's answer.
    const addedNames = [...new Set((c.added ?? c.paths).filter(isNotePath).map(nameOf))];
    const takenBack = [...new Set([...addedNames, ...named])]
      .map((n) => [n, withdrawn.get(n)]).filter(([, w]) => w && w.at > i);
    const said = takenBack.find(([, w]) => w.reason);
    if (said) { withdrawals.push({ ...at, note: said[0], by: said[1].sha, reason: said[1].reason }); continue; }
    if (takenBack.length) {
      owed.push({ ...at, why: "note-withdrawn-unsaid", text: takenBack[0][0], by: takenBack[0][1].sha });
      continue;
    }
    const missing = named.filter((n) => !noteNames.has(n));
    if (missing.length) { owed.push({ ...at, why: "names-a-missing-note", text: missing[0] }); continue; }
    if (named.length) continue;                               // it names a note the range adds
    if (notes.length) continue;                               // a note in the range answers for it
    owed.push({ ...at, why: "no-note", paths: ships });
  }
  // AN ANSWER THAT ANSWERED NOTHING IS REFUSED, NOT IGNORED (see the header).
  const owing = new Set(owed.map((o) => o.sha));
  for (const [sha, a] of answers) {
    if (used.has(sha)) continue;
    refusedAnswers.push({ sha: a.by, subject: a.subject, text: a.text,
      problem: owing.has(sha)
        ? `names ${sha.slice(0, 7)}, which owes a note this line cannot give: an answer covers only a bare \`none\``
        : `names ${sha.slice(0, 7)}, which owes no answer: it ships no code, carries a note, or gives its own reason` });
  }
  return { visible, notes, declined, withdrawals, owed, answered, refusedAnswers };
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
  let changed, commits, atHead, onMainLine = [];
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
    // MAIN'S OWN LINE IS NAMED (see the header): a squash there excuses the prose it inherited. Asked
    // only where main is known; a clone without it keeps the range as given.
    let mainKnown = false;
    try { git("rev-parse", "--verify", "-q", "origin/main^{commit}"); mainKnown = true; } catch { /* not known here */ }
    const mainLine = mainKnown ? new Set(git("rev-list", "--first-parent", "origin/main").split("\n").filter(Boolean)) : new Set();
    onMainLine = shas.filter((sha) => mainLine.has(sha));
    commits = shas.map((sha) => ({
      sha,
      subject: git("log", "-1", "--format=%s", sha).trim(),
      message: git("log", "-1", "--format=%B", sha),
      paths: git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha).split("\n").filter(Boolean),
      added: git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "--diff-filter=A", sha).split("\n").filter(Boolean),
      deleted: git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "--diff-filter=D", sha).split("\n").filter(Boolean),
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

  if (!commits.length) {
    // NOTHING TO READ IS SAID, NOT IMPLIED. On a push to main every commit is already on main, so the range
    // is empty by construction: the pull request that brought them was read before they were squashed.
    console.log(`release-note-required: no commit in ${base}..${head} that main does not already hold, so there `
      + "is nothing here to read. This guard answers for a pull request's own commits, one by one, and main's "
      + "history is never read.");
    return;
  }
  // ANCESTRY FROM GIT, NEVER TIMESTAMPS: an answer must come from a commit the named one is an ancestor of.
  const isAncestor = (a, b) => { try { git("merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
  const { visible, notes, declined, withdrawals, owed, answered, refusedAnswers } = commitVerdicts({ commits, files, atHead, isAncestor });
  console.log(`release-note-required: ${changed.length} changed file(s) against ${base}`
    + `${head === "HEAD" ? "" : ` (head ${head})`}; `
    + `${visible.length} ship as code; ${notes.length} release note(s) in the range; ${commits.length} commit(s) read`
    + `${withdrawals.length ? `; ${withdrawals.length} answered by a note the range withdrew` : ""}`);
  // PER COMMIT, SAID AS PER COMMIT. "no note, declared on purpose" read as a verdict on the range, and beside
  // a range that carries a note it told a reader skimming the output that none went out. Found in review.
  if (onMainLine.length) {
    console.log(`  NOT THE GATE'S READING: ${onMainLine.length} commit(s) read here are on main's own line (first `
      + `${onMainLine[0].slice(0, 7)}), so they are squashes. Over a squash this finds a change that shipped with no `
      + "note at all; it cannot find a prose release line the squash inherited, so a pass here is not the "
      + "per-commit answer. The gate is the pull request's own reading, before the squash.");
  }
  for (const d of declined) console.log(`  ${d.sha.slice(0, 7)} declines a note of its own, on purpose: ${d.reason}`);
  // AN EXCUSED COMMIT IS PRINTED, WITH THE SHA THAT EXCUSED IT. A pass this check reached by reading
  // another commit's decision is one a person may want to disagree with, and they cannot if it is silent.
  for (const w of withdrawals) {
    console.log(`  ${w.sha.slice(0, 7)} answered with ${w.note}, which ${w.by.slice(0, 7)} withdrew: ${w.reason}`);
  }
  for (const a of answered) {
    console.log(`  ${a.sha.slice(0, 7)} said a bare \`none\`, which ${a.by.slice(0, 7)} answers: ${a.reason}`);
  }
  if (!owed.length && !refusedAnswers.length) return;
  if (refusedAnswers.length) {
    console.error(`\n${refusedAnswers.length} Release-note-for answer(s) refused:\n`);
    for (const r of refusedAnswers) {
      console.error(`  ${r.sha.slice(0, 7)} ${r.subject}`);
      console.error(`      "${r.text.slice(0, 120)}" ${r.problem}.`);
    }
  }
  if (!owed.length) process.exit(1);

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
    } else if (o.why === "note-withdrawn-unsaid") {
      console.error(`      answered with ${o.text}, which ${o.by.slice(0, 7)} deletes in this range without saying why.`
        + "\n      A note the head does not carry reaches no reader. If the change it described went out of the"
        + "\n      release too, say that in THAT commit — `Release-note: none — <why>` — which is the newest of"
        + "\n      the two and the one that can still be amended.");
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
