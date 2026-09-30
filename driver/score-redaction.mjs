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
  // Engine prose about a matter, classified from reading its site rather than from a warning: the
  // reason a finding was ruled out is written about that finding and can name the party it concerns.
  "ruled_out_reason",
  // The findings document's own prose, surfaced the first time the run was walked rather than only the
  // reference. Each of these is the engine reasoning about a party in sentences.
  "net", "practical_position", "legal_position", "off_field_ground", "reason", "bears_on", "read",
  "condition", "basis", "quality",
  // THE SEVEN THE WARNING HAD BEEN NAMING, each read at the site that WRITES it rather than classified
  // from its key name — which is what the warning asks a reader to do, and what it now says.
  //
  // Four were measured against the real-name list, one key at a time: `email_line` hit 104 times across
  // 12 values, `transcription_note` 3 of 4, `scoring_caveat` 1 of 1, `what` 1 of 2. A line written to be
  // sent to somebody about their matter names them, which is what `email_line` is for.
  "email_line", "transcription_note", "scoring_caveat", "what",
  // Three read clean against that list TODAY and are protected on what their producer is for, because
  // clean today is not safe. `owner_description` sits at `common_law[].owner_description` and its job is
  // to describe a party: its values are generic in the references we hold and the next one written is
  // the one that names somebody. `channels_note` is 97 words of the lawyer's prose about a matter.
  "owner_description", "channels_note",
  // `sheet` is the one that argues for reading the producer rather than the name. Two files write it
  // and they mean different things: `presence-reconciliation.mjs` writes a two-word workbook label,
  // plainly safe, and a gold writes ten values, all distinct, up to 165 characters — tabulated register
  // rows carrying application and registration numbers. Only the gold's reaches this function today
  // (zero `sheet` keys in a real run's findings, checked on R19 `a46abdad`), so prose costs nothing and
  // is right for what arrives. See the note below on why that is luck rather than design.
  "sheet",
]);

/** Fields that carry a name: a mark, a proprietor, a subject, a form of a mark. */
const NAME_KEYS = new Set([
  "mark", "owner", "subject", "name", "matched", "entry", "noise", "form", "use_form",
  // `refused` READS LIKE A BOOLEAN AND HOLDS A MARK. `reference-score.mjs` builds it as
  // `refused: refused.mark`, so a key whose name suggests a flag carries a name. Classified from its
  // producer rather than from the word — I had it in the safe set for one draft, which would have
  // shipped a leak inside the change that closes one.
  "refused",
  // `item` is a gap's identifier, `g.item ?? g.slice`, and I could not establish from its producer that
  // it never carries matter text. Protected rather than assumed safe: tokenising an identifier costs a
  // little readability, and the other error costs a name on the page.
  "item",
  // A SEARCH TERM IS A SPELLING OF A MARK. `term` carries the string a register question was actually
  // asked with — the same class of thing as `close_variations`, which was already protected, arriving
  // by a different route. Read at its site (the per-territory query roll) rather than inferred: it is
  // `e.term ?? e.terms[0]` off the frozen plan's own query entries.
  "term",
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
  // NOT A REFERENCE KEY AT ALL, read at its producer by the lane that owns this file: `coverage` appears
  // zero times in every gold. `reference-score.mjs` sets it from the scorer's own verdict word and the
  // scorer prints it as a state and a `why` — the harness's sentence about what it could measure, not a
  // sentence about anybody. Classified here because the warning below named it and a reader would
  // otherwise go looking in a gold file for a key the scorer invented.
  "coverage",
  "scenario", "schema_version", "schema", "framework", "id", "title", "door", "lane", "state", "why",
  "lawyer_band", "legal_level", "dispute_type", "lawyer_risk", "band", "rating", "ratingQualifier",
  "channel", "channels", "jurisdictions", "classes", "territories", "country", "rule", "bucket",
  "register_only", "on_field", "impact", "type", "disposition", "ordinal", "kind", "status",
  // Label-shaped fields the real references carry, confirmed one by one rather than assumed: a grade,
  // an expected-value word, and the territory a reference entry sits in.
  "grade", "expected", "jurisdiction",
  // Band and classification labels the findings document carries. Words from a fixed ladder, not names.
  "Dispute Type", "Legal Risk Level", "category", "source_type", "resolved_link",
  // The refusal record's own fields, surfaced once the run was walked: `refusedRule` and
  // `refusedEvidence` name the RULE that fired and the evidence class it wanted, both from fixed
  // vocabularies, and `refused` is its boolean. Read at their site rather than inferred from the names.
  // `refusedRule` names the RULE that fired and `refusedEvidence` the evidence class it wanted, both
  // fixed vocabularies. `refused` is NOT here: see NAME_KEYS.
  "refusedRule", "refusedEvidence",
  // THE TWENTY-ONE THE WARNING NAMED ON THE WITHHELD CORPUS, each classified by what its site holds
  // rather than by what its name suggests — two of them would have been got wrong by the name alone.
  //
  // `evidence` reads like matter content and is a CHANNEL CLASS: "register", "case-law", "unknown".
  // `key` reads like an account key and is a TERRITORY key. Both are safe; tokenising either would
  // have shredded output that names nobody.
  //
  // The rest are labels, states, counts and code-owned harness sentences: a sentence this tool composes
  // about its own measurement names no party, and withholding it whole would blank the conclusion a
  // reader came for. Where one of them interpolates engine prose, the prose's own key carries the
  // protection — `detail` is safe and `ruled_out_reason`, which it can quote, is prose.
  "absent", "asked", "axis", "collapseReason", "depth", "detail", "evidence", "executes", "generated",
  "key", "outcome", "ownerState", "qid", "recall", "record", "record_id", "sentence", "side",
  "statementWhy", "subQuery", "territory",
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
      // CLASSIFIED BY THE LEAF KEY NAME, AND THAT IS A KNOWN LIMIT rather than an oversight. Two files
      // can write the same key and mean different things: `sheet` is a two-word workbook label in
      // `presence-reconciliation.mjs` and a tabulated register row in a gold. Only one of them reaches
      // this function today, so the sets are right about what arrives — but they are right by luck, and
      // the day the other one arrives whichever answer is held is wrong for it. The fix, when it is
      // needed, is to decide on the FULL PATH before the leaf, the way the scenario-label guard does for
      // `cost.note` against `scoring.note`. Not done here because nothing yet needs it, and a path-aware
      // classifier built against a collision that has not happened would be guessing at its shape.
      if (isStr(v) && NAME_KEYS.has(k)) names.add(v.trim());
      else if (isStr(v) && PROSE_KEYS.has(k)) prose.add(v.trim());
      else if (Array.isArray(v) && NAME_LIST_KEYS.has(k)) { for (const e of v) if (isStr(e)) names.add(e.trim()); }
      else if (Array.isArray(v) && (k === "assertions" || k === "controls")) { for (const e of v) if (isStr(e)) prose.add(e.trim()); }
      else if (isStr(v) && !SAFE_KEYS.has(k)) unclassified.add(k);
      else walk(v);
    }
  };
  walk(root);
  // A MULTI-WORD NAME IS ALSO PROTECTED BY ITS DISTINCTIVE WORD, because prose shortens it.
  //
  // Measured on R18 `f5764a2f`: a two-word proprietor was collected in full and still printed in clear,
  // because the sentence that named it used the first word with a possessive and nothing else. Matching
  // only the whole string protects the form in the record and misses the form a reader actually meets —
  // and a redaction that covers the tidy case and not the prose one is worse than none, because the page
  // looks redacted.
  //
  // THE FLOOR IS FIVE CHARACTERS AND THE LEGAL FORMS ARE EXCLUDED. A short word, or "Holdings", or "Ltd",
  // is a word of ordinary English before it is anybody's name, and swapping those everywhere would shred
  // the surrounding text while protecting nobody. A distinctive five-letter-plus word is the part a
  // reader would recognise the party from, which is the thing being withheld.
  const LEGAL_FORM = new Set(["inc", "llc", "ltd", "limited", "gmbh", "corp", "corporation", "company",
    "holdings", "group", "plc", "sarl", "bv", "nv", "ag", "sa", "spa", "pty", "kk", "co", "and", "the", "of"]);
  // KEPT APART FROM THE GIVEN NAMES, because the two are not equally safe to
  // apply. A given name is a party's name and appears nowhere else by construction. A DERIVED word is an
  // ordinary word that happens to sit inside one, so it collides with the scorer's own scaffolding: a
  // party called "Depth Charge" turns `per-territory depth` into `per-territory «name 2»`, and a reader
  // cannot tell a redaction from a word. Both layers still apply to everything the run prints; only a
  // line the SCORER ITSELF authored drops the derived one, through `authoredRedactor` below.
  const derived = new Set();
  for (const n of [...names]) {
    const parts = n.trim().split(/\s+/);
    if (parts.length < 2) continue;
    for (const w of parts) {
      // FOLDED BEFORE THE FLOOR AND THE LEGAL-FORM LOOKUP, and the folded form is what is stored.
      // Both tests are wrong on the unfolded word, in opposite directions. `\uFF2C\uFF34\uFF24`
      // lowercases to `\uFF4C\uFF54\uFF44`, which is not in LEGAL_FORM, so the legal form became a
      // protected word — and once the text is folded too, that word matches every "Ltd" the run prints,
      // which is the shredding LEGAL_FORM exists to prevent. The floor has the mirror fault: the "fi"
      // ligature is four characters raw and five folded, so a distinctive word was excluded for being
      // short when it is not. Deriving from the folded form makes both decisions right by construction.
      const bare = foldForMatching(w).folded.replace(/[^\p{L}\p{N}]/gu, "");
      if (bare.length >= 5 && !LEGAL_FORM.has(bare.toLowerCase())) { names.add(bare); derived.add(bare); }
    }
  }
  // THE FLOOR STAYS AND THE CASE IT MISSES IS NAMED. A fleet decision on an internal page rather than
  // this file's preference: keep the floor, and name the case it does not cover.
  //
  // WHAT IT BUYS: a two-character token is cheap to collide with, and every standalone occurrence of one
  // would go — including words of this harness's own vocabulary. Lowering the floor is a real option and
  // its cost has not been measured, so it is left open on evidence rather than closed on an argument.
  //
  // WHAT IT COSTS, SAID PLAINLY BECAUSE THE OLD COMMENT DENIED IT. This used to claim a short name
  // protects "nothing a reader could identify anyone from". That is false, and it was measured: on one
  // scenario the two-character SUBJECT MARK of the matter is deleted here and prints in clear, beside a
  // name that was correctly withheld. The scenario is named after it and its run directory carries it.
  // `ops/real-names/scan.mjs` holds that same string as a list entry and refuses a page that shows it —
  // so two instruments on this box disagree about it, and this is the one that lets it through.
  //
  // The other clause was stale rather than false: "a substring of ordinary words" described a matcher
  // without boundaries. The matcher has them now — no letter or digit may sit immediately before a
  // match, and only a plural or possessive after — so a short name matches standing alone, not inside a
  // word. That narrows the shredding this floor was written to prevent, which is why lowering it is
  // worth measuring rather than dismissing.
  //
  // THE SCAN IS WHAT CATCHES THE MISS, and a reader of this file should know that rather than infer it.
  for (const n of [...names]) if (n.length < 3) names.delete(n);
  return { names, prose, derived, unclassified: [...unclassified].sort() };
}

/**
 * The line a caller prints when `unclassified` is not empty. Names keys, never values.
 *
 * IT DOES NOT SAY "THE REFERENCE", and that wording was a real misdirection rather than a looseness.
 * `protectedStrings` walks the reference, the scored buckets AND the run, so a key it names may come from
 * any of the three — and the first key it named after the run was added, `coverage`, is the scorer's own
 * field, absent from every gold. Anyone acting on the old sentence went looking in a gold file for a key
 * the scorer invented. Saying it does not know which source is worse than naming it and better than
 * naming the wrong one; carrying the source per key is a further change and is not this one.
 */
export const unclassifiedNotice = (keys) =>
  `*** THE REFERENCE, THE SCORED BUCKETS OR THE RUN CARRIES ${keys.length} KEY(S) THIS REDACTION DOES NOT `
  + `CLASSIFY, and this line does not know which: ${keys.join(", ")}. `
  + `Their text was NOT withheld and may name somebody. Classify each in driver/score-redaction.mjs as a `
  + `name, as prose, or as safe, reading the site that WRITES it rather than its key name — and protect `
  + `anything you cannot establish is free of matter text.`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A name is matched however it is rendered, and the token is spliced back into the ORIGINAL text.
 *
 * WHY. A score taken without `--names` printed a mark and its proprietor in clear, in the same sentence
 * as three that redacted correctly, because that one renders at full width: the protected set matched
 * only the exact code points the reference happened to carry. Full-width Latin is
 * ordinary in East Asian filings, so the failure concentrated in exactly the matters read in more than
 * one script. A register can also hand back full-width digits and punctuation, half-width katakana, and
 * an accented name either composed or decomposed. All of those are the same class, and one compatibility
 * fold answers all of them.
 *
 * WHY NOT FOLD THE WHOLE STRING. The fold has to be reversible enough to put the token back where the
 * name stood in the text the reader will see. Normalising the page and printing the normalised copy would
 * silently rewrite text that names nobody. So the fold is built as a PROJECTION: a folded string to match
 * in, and two arrays mapping each folded position back to the original range it came from.
 *
 * WHY BY CLUSTER, NOT BY CHARACTER. Folding one code point at a time keeps the mapping simple but never
 * recombines: `e` followed by a combining acute stays two characters and never matches the composed name.
 * So a character is grouped with the marks that follow it and the group is folded whole. The group has to
 * include the half-width katakana voiced marks, which are modifier LETTERS and not marks — without them
 * the fold yields U+30C8 U+3099 where the reference carries U+30C9, which is the same glyph on screen and
 * not a match. Measured, 2026-09-27; the character classes are why reading the output was not enough.
 *
 * EVERY FAILURE MODE HERE IS OVER-REDACTION. The spliced range runs from the start of the first cluster
 * the match touched to the end of the last, so it always contains the matched text and never less. A
 * match that lands part-way into one cluster removes the whole cluster.
 */
export function foldForMatching(text) {
  const src = String(text);
  // A character plus any marks that follow it. `\uFF9E`/`\uFF9F` are the half-width voiced sound marks:
  // they behave as marks here and are not in `\p{M}`.
  const cluster = /\P{M}[\p{M}\uFF9E\uFF9F]*|[\p{M}\uFF9E\uFF9F]+/gu;
  let folded = "";
  const start = [];     // folded position -> where its cluster starts in the original
  const end = [];       // folded position -> where its cluster ends in the original
  for (let m = cluster.exec(src); m !== null; m = cluster.exec(src)) {
    // FORMAT CHARACTERS ARE DROPPED FOR MATCHING, never from the output. NFKC keeps every one of them:
    // a zero-width space, joiner, non-joiner, soft hyphen or byte-order mark sitting INSIDE a name
    // survives the fold, and the name is then printed in clear. Measured 2026-09-27: a zero-width space
    // one character into a protected name defeated the match completely. They carry no width and a reader
    // cannot see them, so a page can carry a party's name looking exactly like the redacted rows beside
    // it. Dropping them here only ever makes a match MORE likely, and the splice still removes the whole
    // original range, format characters included.
    const f = m[0].normalize("NFKC").replace(/\p{Cf}/gu, "");
    for (let k = 0; k < f.length; k++) { start.push(m.index); end.push(m.index + m[0].length); }
    folded += f;
  }
  start.push(src.length);
  end.push(src.length);
  return { folded, start, end };
}

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
 * run-together identifier.
 *
 * THIS COMMENT USED TO SAY THE SCORER DOES NOT PRINT THE REFERENCE IN THOSE FORMS. It does, and the
 * claim was the dangerous half of the paragraph: a reader who believed it would stop looking.
 *
 *   · The `run:` line prints the run directory, and a run directory is named after the matter — five
 *     of forty scenario slugs measured on the box are a client's name with nothing done to them.
 *   · Carry-through prints source URLs, and a mark inside a URL path is fused to what surrounds it.
 *   · A native-script page produced two fused matches on the first real page it was read against.
 *
 * So the honest position is narrower than it was written: this rule protects a name standing on its
 * own, with a plural or possessive, at any width. It does not protect one fused into a longer token,
 * that case is not rare, and the forms it misses are being counted rather than assumed away.
 *
 * A URL IS NOT AN EXEMPTION, and that is a decision rather than a side effect. A locator is not prose, and there was an argument that a name inside one is an address
 * rather than a disclosure — it was not taken. A reader who can see the address can fetch it, and what
 * comes back names the party as plainly as the page would have. So a protected name is withheld inside
 * a URL exactly as it is anywhere else: as a path segment, against a hyphen, between slashes, as a
 * subdomain, as a query value. An arm holds all five, because this used to be true by accident of the
 * boundary rule and is now true on purpose.
 *
 * THE ONE DECLINE INSIDE A URL IS THE FUSED CASE ABOVE, not a rule about URLs. `…/about/NAMEgroup`
 * survives for the same reason `NAMEgroup` survives in prose, and the measurement that decided against
 * refining the boundary counted it: 789 protected names across six scored pages, three declines, one of
 * them inside a URL. Nothing here narrows that; it only stops a reader concluding from a URL decline
 * that locators are treated differently.
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
export function redactor({ names = new Set(), prose = new Set(), hint = "run again with --names to read it" } = {}) {
  const index = new Map();
  // The token is the entry's position in a STABLE ordering of the protected set, not its position in the
  // reference: the same run scored twice must redact to the same tokens, and two entries that differ only
  // in case are one name.
  [...names].sort((a, b) => a.localeCompare(b)).forEach((n, i) => index.set(n.toLowerCase(), i + 1));
  // LONGEST FOLDED FIRST, not longest raw. The reason for longest-first is about the text being matched,
  // and that text is now the folded projection — folding does not preserve length, so raw order can put
  // a shorter name first and leave the tail of a longer one beside a token claiming it was removed.
  const withFold = (s) => ({ raw: s, fold: foldForMatching(s).folded });
  const ordered = [...names].map(withFold).sort((a, b) => b.fold.length - a.fold.length || a.raw.localeCompare(b.raw));
  const proseOrdered = [...prose].map(withFold).sort((a, b) => b.fold.length - a.fold.length);

  return function redact(text) {
    const src = String(text);
    // The page is folded ONCE, not once per name: the protected set runs to hundreds of entries on a real
    // reference, and re-folding for each would be a second full scan of the text per name.
    const { folded, start, end } = foldForMatching(src);
    // Accepted replacements, in ORIGINAL offsets, each accepted only where it overlaps nothing already
    // accepted. That is what makes prose win over the names inside it.
    const taken = [];
    // UNION, NEVER DROP. A candidate overlapping something already accepted is MERGED into it rather than
    // discarded, and dropping was the one step in this file that could SHRINK coverage. A name straddling
    // the edge of an accepted prose range was refused whole, and the text outside that range — the rest of
    // the name — was then emitted as it stood. Measured: prose "hello DRAV" beside a protected "DRAVOLINE"
    // printed "OLINE" in clear, immediately after a withheld token. That is the worst shape this module
    // has, because the token beside the fragment tells the reader the redaction is working. A name wholly
    // inside a prose range was always correct; only the straddle leaked. Merging restores the invariant
    // the fold already relies on: every failure here is over-redaction and none is a leak.
    //
    // WHICH TEXT A MERGED RANGE CARRIES. Prose beats a name, because a sentence with its names swapped out
    // still says what the matter is about. Between two names the INCUMBENT keeps its token — the earliest
    // entry in a stable ordering — because the same run scored twice must redact to the same tokens.
    const take = (at, stop, isFolded, withText, isProse) => {
      let from = isFolded ? start[at] : at;
      let to = isFolded ? end[stop - 1] : stop;
      const hits = [];
      for (let i = 0; i < taken.length; i++) if (from < taken[i].to && to > taken[i].from) hits.push(i);
      if (!hits.length) { taken.push({ from, to, withText, isProse }); return; }
      let text = withText;
      let prose = isProse;
      for (const i of hits) {
        const t = taken[i];
        from = Math.min(from, t.from);
        to = Math.max(to, t.to);
        if (t.isProse || !prose) { text = t.withText; prose = prose || t.isProse; }
      }
      // Accepted ranges are pairwise disjoint, so every range inside the merged extent is among the hits
      // and one pass is enough. `hits` ascends, so removing from the end keeps the earlier indexes valid.
      for (let k = hits.length - 1; k >= 0; k--) taken.splice(hits[k], 1);
      taken.push({ from, to, withText: text, isProse: prose });
    };

    // PROSE FIRST, AND IT WINS ANY OVERLAP: a sentence with its names swapped out still says what the
    // matter is about, so the whole sentence goes rather than the names inside it.
    for (const p of proseOrdered) {
      const needle = p.fold || p.raw;     // a string that folds to nothing is matched as it stands
      // AN EMPTY ENTRY IS SKIPPED, and the guard is here rather than left to the producer. `indexOf("")`
      // is 0 and the loop below advances by the needle's length, so an empty string spins forever. Nothing
      // empty can arrive from a reference today, because every branch that collects one tests it first —
      // but that is the producer's property, not this function's, and a hang has no error message.
      if (!needle) continue;
      const hay = p.fold ? folded : src;
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
        take(at, at + needle.length, Boolean(p.fold), `[withheld — ${hint}]`, true);
      }
    }
    for (const n of ordered) {
      const needle = n.fold || n.raw;
      if (!needle) continue;              // same reason as the prose loop above
      const hay = n.fold ? folded : src;
      const re = matcher(needle);
      const withText = `«name ${index.get(n.raw.toLowerCase())}»`;
      for (let m = re.exec(hay); m !== null; m = re.exec(hay)) {
        if (m[0].length === 0) { re.lastIndex += 1; continue; }   // never advance on an empty match
        take(m.index, m.index + m[0].length, Boolean(n.fold), withText, false);
      }
    }

    if (!taken.length) return src;
    taken.sort((a, b) => a.from - b.from);
    let out = "";
    let at = 0;
    for (const t of taken) {
      if (t.from < at) continue;
      out += src.slice(at, t.from) + t.withText;
      at = t.to;
    }
    return out + src.slice(at);
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
/**
 * The redactor for a line the SCORER ITSELF wrote — a heading, a column ruler, a label.
 *
 * It applies the party names and the reference's own sentences, and DROPS the derived words. So a
 * scaffolding word that happens to sit inside a party's name survives, and a reader keeps the structure
 * that tells them what was withheld.
 *
 * IT IS NOT A BYPASS, and that is the whole reason it is a redactor rather than a raw write. Routing
 * structural lines straight to the original writer would make this a hole: a data line sent through it by
 * mistake would print a party name in clear. Here the worst a mistake costs is a shortened form — the full
 * name is still taken out, and the given-name layer is exactly as strict as the main one. Every failure
 * mode of this path is over-redaction; none is a name escaping.
 */
export function authoredRedactor({ names = new Set(), prose = new Set(), derived = new Set(), hint } = {}) {
  // SUBTRACTS, rather than being handed a narrower set to union. The first shape of this had `redactor`
  // take the derived words as a separate argument, so every existing caller that did not pass them lost
  // the layer silently — including the live install. Two arms caught it. Dropping a layer has to be the
  // thing a caller asks for explicitly; the default cannot be the weaker one.
  const kept = new Set([...names].filter((x) => !derived.has(x)));
  return redactor({ names: kept, prose, ...(hint ? { hint } : {}) });
}

// The authored printer, live only while a redaction is installed. Held here rather than threaded through
// every caller so a call site needs nothing but the function.
let authoredPrint = null;

/**
 * Print a line this tool authored, with the derived-word layer dropped. With no redaction installed it is
 * an ordinary write, which is the `--names` case: nothing is withheld, so there is nothing to drop.
 */
/**
 * Redact a STRUCTURE rather than its serialisation.
 *
 * WHY A SERIALISED PAYLOAD CANNOT BE REDACTED AS TEXT. `--json` used to be built, stringified, and sent
 * through the boundary like any other line, which redacts a document that has no prose in it — every
 * string in it is either a field NAME the code wrote or a VALUE out of the data, and the two need
 * opposite treatment. Measured on one real score: the keys `owner` and `additional` came back as
 * `«name 141»` and `«name 1»`, because both are distinctive words of multi-word parties in that
 * reference. Two of the payload's fields were unaddressable — a consumer asking for `owner` finds
 * nothing, and cannot discover what to ask for instead. That is past readability: the JSON is an
 * interface.
 *
 * KEYS ARE AUTHORED AND VALUES ARE DATA, so each gets the instrument that fits it. A key is a literal in
 * this repository's source: the derived layer has no business in it, and dropping that layer is exactly
 * what `authoredRedactor` is for. A value came out of a reference or a run, so it keeps every layer,
 * including the derived one that closed the leak where a two-word proprietor's first word survived in
 * prose.
 *
 * A KEY IS STILL REDACTED, never passed through. If a party's whole name is also a field name, the field
 * name goes — that collision is worth a token, and it is not the ordinary-word case this exists for.
 *
 * Numbers, booleans and null are returned as they are: there is nothing in them to withhold, and turning
 * them into strings would change the payload's shape.
 */
export function redactDeep(value, { redactValue, redactKey }) {
  const walk = (v) => {
    if (typeof v === "string") return redactValue(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      // The key through the AUTHORED redactor, the value through the full one, in one pass so the two
      // can never drift apart by a caller forgetting one of them.
      for (const [k, x] of Object.entries(v)) out[redactKey(k)] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value);
}

export function printAuthored(line) {
  const text = `${line}\n`;
  if (authoredPrint) authoredPrint(text);
  else process.stdout.write(text);
}

/**
 * Write text that has ALREADY been redacted, part by part, through the original stream.
 *
 * THE ONE CALLER THIS IS FOR is a `redactDeep` payload, and the contract is narrow on purpose. Every
 * string in such a payload has been through a redactor already — values through the full one, keys
 * through the authored one — so sending it round again would re-apply the derived layer to keys and put
 * back the exact defect `redactDeep` exists to remove.
 *
 * IT IS A HOLE IF IT IS MISUSED, and unlike `printAuthored` there is no weaker layer standing behind it:
 * hand this raw run text and it prints in clear. So it takes text that a redactor produced, never text a
 * caller assembled, and the two arms that drive it both assert a name is absent rather than that a
 * structure survived.
 */
export function printPreRedacted(text) {
  if (rawPrint) rawPrint(text);
  else process.stdout.write(text);
}

// The raw printer, live only while a redaction is installed, for the reason above.
let rawPrint = null;

export function installRedaction(redact, io = { console, process }, authored = null) {
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
  // Writes through the ORIGINAL stream, so the wrap above cannot re-apply the
  // derived layer to a line that just had it dropped.
  authoredPrint = (text) => original.stdout(authored ? authored(text) : redact(text));
  // Straight through, because the caller's contract is that every part of it is already redacted.
  rawPrint = (text) => original.stdout(text);
  proc.on?.("uncaughtException", onUncaught);
  proc.on?.("unhandledRejection", onUncaught);
  return function uninstall() {
    authoredPrint = null;
    rawPrint = null;
    for (const m of ["log", "error", "warn", "info", "debug"]) con[m] = original[m];
    proc.stdout.write = original.stdoutRef;
    proc.stderr.write = original.stderrRef;
    proc.off?.("uncaughtException", onUncaught);
    proc.off?.("unhandledRejection", onUncaught);
      authoredPrint = null;
  };
}

/** The line every redacted read carries, so an absence is never silent. */
export const REDACTION_NOTICE =
  "names withheld — marks, proprietors and the reference's own sentences are replaced by «name N»; "
  + "run again with --names to print them. The counts and buckets below are unaffected.";
// The verb is "run again", not "pass": the suite forbids a verdict word anywhere in this tool's output,
// and the corpus arm that enforces it reads "pass" wherever it appears, including as an instruction to
// the reader. It was right to catch this. Plain words are better here anyway.
