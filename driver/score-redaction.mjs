// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// score-redaction.mjs — keep the names in a scenario's reference answer out of a terminal nobody asked
// to put them in. PURE: no node builtins, so the rule is testable without a run directory.
//
// WHY THIS EXISTS. Scoring a run is routine, and it happens inside sessions whose entire output is
// recorded somewhere. A scenario's reference answer is a real lawyer's answer to a real matter: its
// marks, the proprietors it names and the sentences it reasons in are all matter content. Printing them
// by default puts them in that record every time anybody scores anything, and nobody asked for them.
// Two different people hit this two days running with the same command, which is what tells you it is a
// property of the tool rather than a run of carelessness.
//
// SO THE DEFAULT IS COUNTS, AND THE NAMES ARE A FLAG. Everything a reader needs to act on — the axes,
// the buckets, which entry fell in which — survives redaction, because an entry is identified by its
// index in the reference and an index is as good as a name for every question the scorer answers. The
// one job that genuinely needs the names, reading a surprising result against the finding text, asks
// for them.
//
// ── IT REDACTS AT THE OUTPUT BOUNDARY, NOT AT EACH PRINT SITE ────────────────────────────────────────
//
// The caller installs this over the whole output stream rather than wrapping the twenty-odd places that
// interpolate a name. That is deliberate and it is the difference between a fix and a near-miss:
// per-site redaction is exactly the shape that leaves one site out, and the site it leaves out is the
// one nobody remembered was printing a name. A boundary cannot be forgotten by a later edit, and a
// print site added next year is covered without anyone thinking about it.
//
// The cost is that this works on rendered text, so it needs every protected string up front. That is
// what `protectedStrings` is for, and what the test drives: the control is the flagged path over the
// same run, which must still contain the names. A redaction test with no such control cannot tell
// redaction from a command that printed nothing.

/** Prose in a reference is withheld whole. A sentence keeps naming its subject after its names are swapped out. */
const PROSE_KEYS = new Set([
  "note", "reasoning", "mitigation", "cross_mark_note", "driver", "scenario_note", "provenance_caveat",
  "counts_note", "schema_note", "overall", "source",
  // Found by the unclassified warning on its first run over the real reference files, which is what it
  // is for: `lawyer_position` and `common_law_note` are the lawyer reasoning about a named party, and
  // `next_step` is advice written about the subject. All three were printing in full.
  "lawyer_position", "common_law_note", "next_step", "counts_provenance",
]);

/** Fields that carry a name: a mark, a proprietor, a subject, a form of a mark. */
const NAME_KEYS = new Set([
  "mark", "owner", "subject", "name", "matched", "entry", "noise", "form", "use_form",
]);

/** Arrays whose entries are bare names rather than objects. */
const NAME_LIST_KEYS = new Set(["covers_marks", "close_variations", "variations", "aliases"]);

/**
 * Keys whose strings are NOT a name and NOT matter prose: schema labels, scenario ids, band and level
 * words, channel domains, the classes and territories a scope names.
 *
 * WRITTEN OUT SO THE LEFTOVER IS LOUD. Without this set, "unclassified" would name seven harmless keys
 * on every run and the warning would be noise inside a week — and a warning nobody reads is the same
 * absence-as-pass this module exists to close, one level up. With it, the leftover list is empty in
 * steady state, so a reference that gains a field says so the first time it is scored.
 */
const SAFE_KEYS = new Set([
  "scenario", "schema_version", "schema", "framework", "id", "title", "door", "lane", "state", "why",
  "lawyer_band", "legal_level", "dispute_type", "lawyer_risk", "band", "rating", "ratingQualifier",
  "channel", "channels", "jurisdictions", "classes", "territories", "country", "rule", "bucket",
  "register_only", "on_field", "impact", "type", "disposition", "ordinal", "kind", "status",
  // Label-shaped fields the real references carry, confirmed one by one rather than assumed: a grade,
  // an expected-value word, and the territory a reference entry sits in.
  "grade", "expected", "jurisdiction",
]);

const isStr = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Every string this scorer must not print, gathered from the reference and from the run's own scored
 * buckets — a proprietor the run surfaced and the reference never named is still somebody's name.
 *
 * Returns two sets because they are withheld two different ways: a NAME is swapped for its index, so the
 * line it sits in still reads; PROSE is withheld whole, because a sentence with its names swapped out
 * still says what the matter is about.
 */
export function protectedStrings(root) {
  const names = new Set();
  const prose = new Set();
  // A string-valued key that is in none of the four sets. Reported by KEY, never by value: the point is
  // to say that this file has stopped describing the reference, not to print what it failed to protect.
  const unclassified = new Set();
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;          // a reference is a tree, but a scored bucket can share objects
    seen.add(node);
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("_")) continue;                       // `_why` keys document the file, not the matter
      if (isStr(v) && NAME_KEYS.has(k)) names.add(v.trim());
      else if (isStr(v) && PROSE_KEYS.has(k)) prose.add(v.trim());
      else if (Array.isArray(v) && NAME_LIST_KEYS.has(k)) { for (const e of v) if (isStr(e)) names.add(e.trim()); }
      else if (Array.isArray(v) && (k === "assertions" || k === "controls")) { for (const e of v) if (isStr(e)) prose.add(e.trim()); }
      else if (isStr(v) && !SAFE_KEYS.has(k)) unclassified.add(k);
      else walk(v);
    }
  };
  walk(root);
  // A one- or two-character "name" is a substring of ordinary words, and swapping it everywhere would
  // shred the surrounding prose without protecting anything a reader could identify anyone from.
  for (const n of [...names]) if (n.length < 3) names.delete(n);
  return { names, prose, unclassified: [...unclassified].sort() };
}

/** The line a caller prints when `unclassified` is not empty. Names keys, never values. */
export const unclassifiedNotice = (keys) =>
  `*** THE REFERENCE CARRIES ${keys.length} KEY(S) THIS REDACTION DOES NOT CLASSIFY: ${keys.join(", ")}. `
  + `Their text was NOT withheld and may name somebody. Classify each in driver/score-redaction.mjs as a `
  + `name, as prose, or as safe — this warning is the only thing standing between a new reference field `
  + `and the silent leak it would otherwise be.`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A name matches where it stands on its own, not where it happens to be inside a word.
 *
 * WHY THIS IS NEEDED AT ALL. Unbounded, a three-letter proprietor called `Arc` rewrote this tool's own
 * vocabulary: `Search found 3` became `Se«name 1»h found 3`, and `searched / not-searched` came out
 * mangled in the bucket rows. That is worse than a plain miss, because the page then carries a token
 * asserting a name was removed next to a word that was never a name — the reader cannot tell which of
 * the two happened, and three-letter marks and proprietors are common.
 *
 * WHY `\b` IS NOT ENOUGH. A name can legitimately end in punctuation, and it can carry a plural or a
 * possessive that a reader would still recognise it from — `Quillions`, `Quillion's`. So the rule is:
 * a letter or digit may not sit immediately BEFORE the match, and after it only a plural or possessive
 * suffix may, which is consumed along with the name rather than left stranded beside the token.
 *
 * WHAT IT STILL DOES NOT CATCH, stated because a redaction that overclaims is the thing this module
 * warns about: a name fused into a longer alphanumeric token with no separator — a slug, a domain, a
 * run-together identifier. The scorer does not print the reference in those forms today, and the honest
 * position is that this rule protects the forms it prints rather than every form that could exist.
 */
const matcher = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?:['’]s|s)?(?![\\p{L}\\p{N}])`, "giu");

/**
 * A redactor over rendered lines.
 *
 * Longest string first, always: `MC` and `MC MINECRAFT` both protected, shortest-first, leaves the tail
 * of the longer one on the page next to a token that claims it was removed — a redaction that reports
 * itself as complete while it is not is worse than none, because the next reader trusts it.
 *
 * Every token says what it replaced and how to get it back. A blanked line a reader cannot account for
 * sends them to re-run the command some other way, which is how the names end up on the page anyway.
 */
export function redactor({ names = new Set(), prose = new Set(), hint = "pass --names to read it" } = {}) {
  const index = new Map();
  const ordered = [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));
  // The token is the entry's position in a STABLE ordering of the protected set, not its position in the
  // reference: the same run scored twice must redact to the same tokens, and two entries that differ only
  // in case are one name.
  [...names].sort((a, b) => a.localeCompare(b)).forEach((n, i) => index.set(n.toLowerCase(), i + 1));
  const proseOrdered = [...prose].sort((a, b) => b.length - a.length);

  return function redact(text) {
    let out = String(text);
    for (const p of proseOrdered) {
      if (!out.includes(p)) continue;
      out = out.split(p).join(`[withheld — ${hint}]`);
    }
    // One pass per name, and no `test` before it: `replace` on a global regex resets `lastIndex` itself,
    // so the guard did no work the replace did not, and on a long protected set it was a second full
    // scan of the text for every name.
    for (const n of ordered) out = out.replace(matcher(n), `«name ${index.get(n.toLowerCase())}»`);
    return out;
  };
}

/**
 * Install `redact` over EVERY way this process writes text, and return a function that undoes it.
 *
 * `console.log` ALONE IS NOT THE BOUNDARY, and the difference matters to the argument this design rests
 * on. Wrapping one function was chosen over twenty per-site wrappers so that a print added later is
 * covered without anyone thinking about it — but that promise only held for one of the three ways out:
 * a later `console.error` carrying a mark, or a throw whose message interpolates one, printed in full.
 * Both are ERROR paths, which is where a name is most likely to be interpolated for diagnosis and least
 * likely to be read again afterwards.
 *
 * The uncaught handler is here for the same reason. It prints the redacted error and exits non-zero
 * rather than rethrowing: a rethrow would reach node's own printer, which writes to the real file
 * descriptor and never passes through anything installed here.
 */
export function installRedaction(redact, io = { console, process }) {
  const { console: con, process: proc } = io;
  // THE REFERENCE TO PUT BACK AND THE FUNCTION TO CALL ARE NOT THE SAME THING. A stream write has to be
  // called bound to its stream, but restoring the BOUND copy leaves a different function on the object
  // than was there before — which a caller comparing the two can see, and which makes a second install
  // wrap a wrapper. Both are kept: `stdout` to call through, `stdoutRef` to hand back.
  const original = {
    log: con.log, error: con.error, warn: con.warn, info: con.info, debug: con.debug,
    stdoutRef: proc.stdout.write, stderrRef: proc.stderr.write,
    stdout: proc.stdout.write.bind(proc.stdout), stderr: proc.stderr.write.bind(proc.stderr),
  };
  const wrap = (fn) => (...parts) => fn(redact(parts.map(String).join(" ")));
  for (const m of ["log", "error", "warn", "info", "debug"]) con[m] = wrap(original[m].bind(con));
  // A stream write takes a chunk, not a list, and its callback and encoding arguments have to survive.
  const wrapWrite = (fn) => (chunk, ...rest) =>
    fn(typeof chunk === "string" ? redact(chunk) : chunk, ...rest);
  proc.stdout.write = wrapWrite(original.stdout);
  proc.stderr.write = wrapWrite(original.stderr);
  const onUncaught = (e) => {
    original.stderr(`${redact(e?.stack ?? String(e))}\n`);
    proc.exit(1);
  };
  proc.on?.("uncaughtException", onUncaught);
  proc.on?.("unhandledRejection", onUncaught);
  return function uninstall() {
    for (const m of ["log", "error", "warn", "info", "debug"]) con[m] = original[m];
    proc.stdout.write = original.stdoutRef;
    proc.stderr.write = original.stderrRef;
    proc.off?.("uncaughtException", onUncaught);
    proc.off?.("unhandledRejection", onUncaught);
  };
}

/** The line every redacted read carries, so an absence is never silent. */
export const REDACTION_NOTICE =
  "names withheld — marks, proprietors and the reference's own sentences are replaced by «name N»; "
  + "pass --names to print them. The counts and buckets below are unaffected.";
