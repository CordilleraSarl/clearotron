// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A PUBLIC TREE MUST NOT ACQUIRE, AS ONE TABLE.
//
// `scripts/added-reference-check.mjs` refuses these in a diff, so a pull request cannot add one. The
// floor beside `driver/test/fixtures/public-residue-backlog.json` counts what is already here, so the
// standing population can only fall. Two readers, one table: a class the diff guard refuses and the
// census does not count is a class whose number nobody can act on, and the reverse is a number nobody
// can hold.
//
// ── WHY THE TABLE CAN BE PUBLISHED AT ALL ────────────────────────────────────────────────────────
//
// A guard is a list of what it looks for, and this file ships in the tree it protects. So the test for
// every entry is whether SPELLING IT DISCLOSES ANYTHING. Generic account names, role words and the
// repository's own retired names disclose nobody. A person's name and the names given to working
// sessions do, and they are not here: those stay in the private table that
// `shared/identifier-sentinels.mjs` describes, reached through `CLEAROTRON_IDENTIFIER_BLOCKLIST`, and
// this file does not restate them under another heading.
//
// That split is a real limit and it is stated rather than papered over: public CI cannot refuse a name
// it is not allowed to know. What it can refuse is every class below, which is what let the last set
// through.
//
// QUOTING A BAD LINE IS STILL WRITING IT, and there is no exemption for backticks. Both comments in
// this file that once showed a banned token as an example were refused by the guard they describe, and
// the answer was to reword them rather than to excuse a span. An exemption for quoted text would be a
// hole in exactly the classes that need none: an account name inside backticks is as published as one
// outside them, and any author could quote their way past. Where a bad input genuinely has to be
// SHOWN, it goes in a test arm as a string literal — which this guard does not read, by the same rule
// that keeps it away from CSS and composite keys.
//
// ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────────────
//
// PRODUCT VOCABULARY. `lane`, `round`, `box`, `ruling`, `prelim`, `knockout`, `seat` and `jx` are this
// product's own nouns. A guard refusing them fires thousands of times, and a guard that fires on
// correct prose is one whose next reader deletes from the workflow.
//
// `deploy` IS A SKILL NAME AND IS NOT BANNED, for the same reason. It is an ordinary English word and a
// paragraph about deploying would be refused line by line.
//
// `clawdi` IS NOT BANNED, and this one was measured rather than reasoned. It reads like an internal
// name and it is the product's own default agent id: `CLEAROTRON_DEFAULT_AGENT=clawdi` is in
// INSTALL.md, in the configuration reference and in the operations runbook, and it is a path segment in
// every run directory. 49 lines carry it in that sense and none carries it as a reference to the other
// product, which is the class that would have been worth refusing. Banning it would refuse the install
// instructions a stranger reads first.

import { execFileSync } from "node:child_process";
import { CUT_RECORD_PRESENT, isWithheld } from "./withheld-paths-access.mjs";

// ── A COLOUR IS NOT A CITATION, AND ONE PROPERTY LIST SETTLES BOTH READINGS ──────────────────────
//
// A three-digit hex colour and a three-digit reference are the same characters, and the digits cannot
// tell you which one you are looking at. The SITE settles it: a value whose property is a colour is a
// colour.
//
// TWO RULES FROM ONE LIST, and they are not interchangeable — this is the split
// `shared/identifier-scan.mjs` had to learn after a line-scoped exemption quietly cleared every other
// name on the line beside the one that earned it.
//
//   TOKEN-SCOPED (`COLOUR_PROPERTY`) — anchored at the end of the text BEFORE a token, so it exempts
//   that token and nothing else. This is what the diff guard uses: a stylesheet line may hold a colour
//   and a citation, and only the colour is excused.
//
//   LINE-SCOPED (`COLOUR_SITE`) — true anywhere on the line. Correct only where the whole line is a
//   declaration and there is nothing else on it to miss, which is how
//   `driver/test/prompt-payload-names-no-tracker-issue.test.mjs` reads a stylesheet.
//
// Lifted here from that test so the two stop being separate spellings of one rule.
const COLOUR_PROPERTIES = "color|background|background-color|border|border-color|fill|stroke|outline|box-shadow|text-shadow";

/** Anchored: true when the text immediately before a token is a colour property awaiting its value. */
export const COLOUR_PROPERTY = new RegExp(`(?:^|[;{\\s(,])(?:${COLOUR_PROPERTIES})\\s*:\\s*$`, "i");

/** Unanchored: true when the line is a colour declaration at all. */
export const COLOUR_SITE = new RegExp(`(?:^|[;{\\s])(?:${COLOUR_PROPERTIES})\\s*:`, "i");

const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

/** Strip hex colours, so what remains is only tokens that could be a reference. */
export const withoutColourValues = (line) => String(line).replace(HEX_COLOUR, (m, offset, whole) => {
  if (/[a-fA-F]/.test(m.slice(1))) return "";                              // letters ⇒ not a decimal number
  return COLOUR_PROPERTY.test(whole.slice(0, offset)) ? "" : m;            // all digits ⇒ the property decides
});

/** Strip the spans where a `#NNN` is an address rather than a reference. */
export const withoutLinkTargets = (line) => String(line)
  .replace(/\]\([^)]*\)/g, "]()")                 // markdown link targets, anchors included
  .replace(/https?:\/\/\S+/g, "")                  // bare URLs and their fragments
  .replace(/<[^>]*>/g, "");                        // angle-bracket autolinks

// A `#` COMMENT IS A COMMENT WHEREVER THE FILE FORMAT SAYS SO, not only in YAML. Extensionless is
// deliberate: a systemd unit or a dotfile often has no extension worth matching, so the KNOWN
// `#`-comment names are listed and everything else keeps the source rule.
const HASH_COMMENT = /(^|\/)(\.env[^/]*|[^/]*\.(ya?ml|sh|bash|service|timer|path|socket|conf|ini|toml|properties)|Dockerfile[^/]*|Makefile|\.gitignore|\.gitattributes)$/;

/** Is this line one the guard reads at all? Comments in source, everything in markdown. */
export const isProse = (path, line) => {
  if (/\.mde?$/.test(path) || path.endsWith(".md")) return true;
  const t = String(line).trim();
  if (HASH_COMMENT.test(path)) return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

// ── THE TWO TREES THIS GUARD DOES NOT READ ──────────────────────────────────────────────────────
//
// `demo/**` is recorded public-register data and the run artifacts replayed from it. The names in it
// are real trademark owners on a real register, which is what the demo is for; a guard reading it
// would refuse the product's own worked example.
//
// `driver/skills/**` is the engine's instruction text, and it has its own stricter guard next door in
// `driver/test/prompt-payload-names-no-tracker-issue.test.mjs` — which refuses a citation there in any
// form, prose line or not. Reading it here as well would put one tree under two rules that disagree
// about what a comment is.
const UNREAD_TREES = [/^demo\//, /^driver\/skills\//];

/** Does the guard read this path at all? */
export const isScannable = (path) => !UNREAD_TREES.some((re) => re.test(path));

// ── THE CLASSES ─────────────────────────────────────────────────────────────────────────────────
//
// Each is `{ id, pattern, why }`. The id is what the census counts under and what a floor entry names,
// so it is stable text: renaming one re-mints the fixture and the diff says so.
//
// `pattern` carries no `g` flag. A shared `g`-flagged regex carries `lastIndex` between `test` and
// `exec` calls, so the same instance answers differently on its second use — the kind of defect that
// shows up as one arm in ten failing. `EVERY_MATCH` below adds the flag for the one operation that
// needs it, and `String.prototype.matchAll` iterates a clone rather than the original (asserted in
// driver/test/the-public-residue-is-a-floor.test.mjs, because it is a property of the runtime and not
// of this file).

/** @type {{id: string, pattern: RegExp, why: string}[]} */
export const CLASSES = [
  {
    id: "bare-reference",
    pattern: /#[0-9]{3,}/,
    // THE REMEDY MOVED WITH THE CLASS BELOW. This used to read "write `tracker issue NNN`", which is
    // now the next entry in this table — a guard telling authors to write the form it refuses two
    // lines later. The remedy is not another spelling of the address; it is to drop the address.
    why: "a bare #NNN reference — GitHub links it into whichever repository renders it, which is not "
      + "the one the number belongs to, and it lives on in public history. Say why the code is as it "
      + "is; the citation belongs in the commit message or the pull request body.",
  },
  {
    // THE SPELLED FORM WAS THE REMEDY AND IS NOW THE CLASS. `tracker issue NNN` was what this guard
    // told authors to write instead of `#NNN`, because it carries no `#` and GitHub cannot linkify it.
    // That was right about the linkifying and wrong about the address: the tree carries the reason for
    // a decision, never its address, and a reader outside this project cannot open the number either
    // way. So the citation moves to the commit message and the pull request body, where it belongs,
    // and the code says why rather than where.
    id: "spelled-citation",
    pattern: /\btracker\s+issues?\s+[0-9]+/i,
    why: "a spelled tracker citation — the reason for a decision belongs in the tree, its address does "
      + "not. A reader outside this project cannot open the number. Say why the code is as it is; put "
      + "the citation in the commit message or the pull request body.",
  },
  {
    id: "login",
    pattern: /\b(?:testuser|azureuser|devuser)[0-9]*\b/i,
    why: "an account name from the machines this is built on. Say what the account is for — 'the "
      + "account the timer runs as' — not what it is called.",
  },
  {
    // THE PLACEHOLDER IS THE POINT OF THE NARROW LIST. `/home/you/trademark/pool` is what INSTALL.md
    // and docs/E2E.md tell a reader to write, and it is the first thing a stranger copies. A
    // `/home/<anything>/` rule would refuse the install instructions, so the accounts are named.
    id: "home-path",
    pattern: /\/home\/(?:testuser|azureuser|devuser|clearotron)[0-9]*\b/i,
    why: "a home directory on one of the machines this is built on. Use the placeholder the install "
      + "documentation uses, or name the setting rather than the path.",
  },
  {
    // ── DECLARED HERE, SPELLED ELSEWHERE, AND THE REASON IS THIS ENTRY'S OWN SENTENCE ──────────────
    //
    // This class had a pattern naming two private repositories as literals, and it shipped in the tree
    // it protects — so the guard published exactly what it exists to refuse. Its own `why` says it: a
    // public tree naming one publishes it, and the name outlives every link to it.
    //
    // THE SPLIT AT THE TOP OF THIS FILE ALREADY HAD THE ANSWER and this entry was on the wrong side of
    // it. A generic account name discloses nobody, which is why the logins are spelled out. A
    // repository name is not a generic word: it is a unique identifier of a private asset, and it
    // belongs with the personal names in the private table rather than here.
    //
    // FOUND BY A REVIEWER, AND DEMONSTRATED RATHER THAN ARGUED. The private scan refused their review
    // on its first pass, because reporting the defect meant quoting the pattern. A class whose literals
    // cannot be discussed in a public review without tripping a guard does not belong in a public file
    // — which is this file's own no-exemption-for-quoting rule, arriving from the other side.
    //
    // WHAT IS LOST, SAID PLAINLY RATHER THAN LEFT AS AN ABSENCE. Commit bodies are covered: the private
    // merge scan refuses this class today. What this entry would have added is FILE coverage, and
    // public CI cannot have it without the literals. So the class is declared with no pattern, skipped
    // here, and populated only where the roster is. A guard that cannot spell what it looks for says so
    // rather than looking clean.
    id: "private-repo-name",
    pattern: null,
    why: "a private repository name. A public tree naming one publishes it, and the name outlives "
      + "every link to it. Refused in commit bodies by the private merge scan; not spellable here.",
  },
  {
    // THE FOUR ARE SPELLED OUT RATHER THAN `role-\w+`. `role-shaping` is a real phrase in
    // driver/portal-service.mjs about what the report does with a party's role, and a prefix rule
    // refuses it — the first false positive would land on product prose, which is how a guard loses
    // its `&&`.
    // AND ONE OF THEM IS A REGISTERED MARK, which matters in this product and nowhere else. The bare
    // word in the pattern below — the one that is not prefixed `role-` — is banned because 20 files
    // carry it as our own word for a role, and no current use of it as a mark is in this tree today. But the corpus this product searches is MARKS, and that is
    // a well-known registered one — so the first false positive here will be a fixture, a worked example
    // or a doctrine line that names it legitimately. That is the same defect this codebase has met three
    // times in a different costume: a check that cannot tell a mark from its own vocabulary. When it
    // arrives, the fix is a site rule that exempts the mark where a mark belongs — not a widened pattern,
    // and not deleting the class, which would put 20 real leaks back.
    id: "role-name",
    pattern: /\brole-(?:dev|e2e|design|overwatch)\b|\boverwatch\b|\bclearance-runs\b/i,
    why: "our own word for how this is built, not the reader's. Say what was done and how it was "
      + "verified; a stranger cannot use the organisation chart and should not have to meet it.",
  },
  {
    id: "agent-trailer",
    // The comment leader is matched so the trailer is recognised at the start of a comment, and
    // CAPTURED OUT of the report: a reader told that the offending token includes the comment leader
    // has been handed the syntax around the finding as though it were part of it.
    pattern: /^[\s*/#]*(Agent:\s*role-\w+)/,
    why: "the agent trailer, which belongs on private surfaces only. On a public surface the "
      + "attribution is the commit author and nothing else.",
  },
  {
    // WORSE THAN THE CLASS ABOVE BECAUSE NOBODY READS IT AS PROSE. This one arrives in a template,
    // survives review by looking like machinery, and a commit message cannot be amended once pushed.
    // The same class is refused in commit bodies by the merge scan; nothing refused it inside a FILE
    // until this, and a file is the surface that stays.
    id: "machine-trailer",
    pattern: /Co-Authored-By:\s*Claude|Claude-Session:|Generated with \[Claude|claude\.ai\/code\/session/,
    why: "a machine-written attribution trailer or session link. On a public surface the attribution "
      + "is the commit author and nothing else.",
  },
];

/**
 * Every class this line offends, as `{ id, token, why }`. Empty when the line is not read, is not
 * prose, or is clean.
 *
 * Colour values and link targets are stripped once, before any class sees the line, so a class cannot
 * be written in a way that reintroduces either exclusion by accident.
 */
// EVERY OCCURRENCE, NOT THE FIRST. This was one-per-class-per-line until the census arm planted two
// citations on one line and read back 1. For the diff guard the difference is cosmetic — the reader is
// shown the line either way — but the backlog is a COUNT, and a count that stops at the first hit lets
// a floored line quietly gain a second one. The permissive half of a gate is the dangerous half.
const EVERY_MATCH = new Map(CLASSES.filter((c) => c.pattern).map((c) => [c.id, new RegExp(c.pattern.source, c.pattern.flags + "g")]));

/**
 * ── A CITATION THAT WRAPPED IS IN NEITHER LINE ─────────────────────────────────────────────────────
 *
 * Every class above reads ONE line, and prose in this tree wraps at a fixed width, so a citation whose
 * words end one line and whose number begins the next matches nothing. Measured on a real branch: four
 * citations went in, the census counted four and refused; three came out and the count returned to its
 * floor with the fourth still in the tree, because that one had wrapped.
 *
 * WORSE THAN A MISCOUNT, BECAUSE THE CENSUS IS A RATCHET. The floor only falls, and the check passing is
 * the statement that the tree grew nothing new — so a wrapped citation is not merely uncounted, it joins
 * the floor's silence, and nobody looks again because the number did not move.
 *
 * A WRAP IS A WRAP ONLY WHEN NEITHER LINE CARRIES ONE ALONE. Joining line N to N+1 also matches when the
 * whole citation sits on N+1, which would report every ordinary hit a second time as a wrap on the line
 * above it. `WRAPPED_HEAD` requires line N to END mid-citation, and that is what makes the pair disjoint
 * from the per-line count rather than overlapping it.
 *
 * THE TWO HEAD FORMS ARE COMPLETED BY DIFFERENT THINGS, and collapsing them is the false positive that
 * matters: a line ending in the bare word `tracker` needs the word `issue` on the next one, while a line
 * ending in `tracker issue` needs only a number — and without the split, any line ending in `tracker`
 * followed by a numbered list item reads as a citation.
 *
 * ONE DEFINITION. The sweep that removes these reads these same exports; a second detector agreeing today
 * is two detectors disagreeing later, and while the sweep could see this class and the census could not,
 * neither could report the disagreement.
 */
export const WRAPPED_HEAD = /\btracker\s*$|\btracker issues?\s*$/i;
export const WRAPPED_TAIL = /^\s*(?:\/\/|#|\*|--)?\s*(?:issues?\s+)?\d+/i;

/** True when `a` ends a citation that `b` completes. PURE. */
export const wrapsInto = (a, b) => {
  if (!WRAPPED_HEAD.test(a) || b === undefined) return false;
  return /\btracker\s*$/i.test(a) ? /^\s*(?:\/\/|#|\*|--)?\s*issues?\s+\d+/i.test(b) : /^\s*(?:\/\/|#|\*|--)?\s*\d+/.test(b);
};

/** The class a wrapped citation belongs to — the spelled one, because that is what it spells. */
export const WRAPPED_CLASS = "spelled-citation";

export function offendingClasses(path, line) {
  if (!isScannable(path) || !isProse(path, line)) return [];
  const text = withoutColourValues(withoutLinkTargets(line));
  const out = [];
  for (const c of CLASSES) {
    // A CLASS WITH NO PATTERN IS ONE THIS TREE CANNOT SPELL, not one with nothing to find. It stays in
    // the table so the census keeps its column and a reader meets the limit where the rule is, rather
    // than inferring it from an absence.
    const re = EVERY_MATCH.get(c.id);
    if (!re) continue;
    // A capture group, where a class has one, is the offending text with its surroundings dropped.
    for (const m of text.matchAll(re)) out.push({ id: c.id, token: m[1] ?? m[0], why: c.why });
  }
  return out;
}

/**
 * The standing population, per file, as `{ total, files: { path: number[] } }` — one count per class,
 * in `CLASSES` order, for every file carrying at least one.
 *
 * A file with no hit is absent rather than zero-filled, so the fixture shrinks as the tree is repaired
 * instead of recording a growing list of clean files.
 *
 * @param {string[]} files repo-relative paths
 * @param {(path: string) => string} read
 */
const COLUMN = new Map(CLASSES.map((c, i) => [c.id, i]));

// ── THE CENSUS IS A STATEMENT ABOUT THE PUBLISHED TREE, AND IT CAN BE RUN OVER A BIGGER ONE ──────
//
// The withheld corpus is laid back over this tree at its pre-cut paths to run the suite with it. Under
// that overlay `git ls-files` returns 110 files that are not in the published repository, and measured
// before this existed they carry 360 hits — 299 of them the one class this floor holds at ZERO. So the
// arms would have gone red on files the committed fixture cannot record: writing them into it would
// publish the withheld path list, which is the thing the cut exists to prevent.
//
// `isWithheld` is the instrument for that question and this is its THIRD reader — corrected 2026-09-09
// from "sixth", which counted three readers that do not exist. Its own file states
// the condition a new caller must meet — the fallback has to make the caller STRICTER, never looser —
// and this one does: with no cut record it answers false for everything, nothing is skipped, and the
// census counts the whole tree.
//
// AND IT IS INERT TODAY, WHICH IS SAID HERE RATHER THAN LEFT TO BE DISCOVERED. Measured: neither the
// published repository nor the one the overlay lays from carries `shared/withheld-paths.mjs`, so
// `CUT_RECORD_PRESENT` is false in both and this skip has never yet excluded a path. It stays because
// it is the right question and costs nothing the day a record exists. What actually separates the two
// populations today is the caller's business, and the floor test does it by asking which files are in
// HEAD: the overlay stages what it lays and never commits it, so a laid path is in the index and not
// in the published tree. An armed-but-blind guard is worth having only while it says which it is.
//
// THE COUNT IS RETURNED, NOT SWALLOWED. A skip nobody can see is how an exclusion becomes an outage:
// a predicate that started answering true for everything would report a clean, empty census, and that
// reads exactly like a repaired tree. The arms assert on `skipped` in both directions.
export function censusOf(files, read) {
  const out = { total: 0, files: {}, skipped: 0, cutRecord: CUT_RECORD_PRESENT };
  for (const path of files) {
    if (!isScannable(path)) continue;
    if (isWithheld(path)) { out.skipped++; continue; }
    let text;
    try { text = read(path); } catch { continue; }
    if (text.includes("\0")) continue;                       // a binary blob is not prose
    const counts = CLASSES.map(() => 0);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { id } of offendingClasses(path, lines[i])) counts[COLUMN.get(id)]++;
      // AND THE PAIR, which no per-line rule can see. Counted on the HEAD line and once: the head ends
      // mid-citation, so this can never be the same hit the loop above just counted.
      if (isProse(path, lines[i]) && wrapsInto(lines[i], lines[i + 1])) counts[COLUMN.get(WRAPPED_CLASS)]++;
    }
    const sum = counts.reduce((a, b) => a + b, 0);
    if (sum) { out.files[path] = counts; out.total += sum; }
  }
  return out;
}

/**
 * The files this checkout PUBLISHES, out of the ones it tracks.
 *
 * The suite is also run over a bigger tree: the withheld corpus is laid back over a clone at its
 * pre-cut paths so our own arms can run against it. That overlay stages what it lays and never commits
 * it, so a laid path is in the index and not in HEAD — which is the whole discriminator, and it is
 * exact rather than a heuristic about paths.
 *
 * The backlog is a statement about the published repository, so both the floor and the mint read this
 * and not the raw tracked list. Two spellings of "the population" is one population and one guess.
 *
 * @param {string[]} trackedList what `trackedFiles` returned — enumerated there so the loud
 *   no-checkout skip and the corpus marker stay in one place
 * @param {string} root
 * @returns {{files: string[], laid: number} | {error: string}}
 */
export function publishedOf(trackedList, root) {
  let head;
  try {
    head = new Set(execFileSync("git", ["-C", root, "ls-tree", "-r", "HEAD", "--name-only"],
      { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean));
  } catch (e) {
    // A tree with no HEAD cannot say what it published, and that is a could-not-look. It must not
    // become "nothing is laid here", which is the permissive reading and the one that passes.
    return { error: `could not read HEAD in ${root}: ${String(e.message).split("\n")[0]}` };
  }
  const files = trackedList.filter((f) => head.has(f));
  return { files, laid: trackedList.length - files.length };
}
