// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reference-score.mjs — compare a completed run against a lawyer's reference answer. PURE.
//
// ── what this is for ─────────────────────────────────────────────────────────────────────────────────
//
// Every assertion the E2E suite makes today is a property of the JOB SPEC: the right pipeline ran, the
// ordered components attached, the instructed territory count survived. A run can surface the wrong
// conflicts, band them wrongly, and satisfy every one of them. This is the other question — was the
// answer any good — and it is answered by comparing against an answer a lawyer already gave.
//
// ── it is a measurement, never a target ──────────────────────────────────────────────────────────────
//
// A run built to reproduce a reference has proved nothing; that is the rules-engine trap in a new
// costume, and this whole programme exists to avoid it. So: no PASS, no overall grade, no exit code
// carrying a verdict. What the score is for is MOVEMENT — a mark the reference found and this run did
// not, or a bucket that changed between rounds.
//
// `noise` is reported neutrally and deliberately last in the reading order. A finding absent from the
// reference may be a genuine find; the engine has already beaten the reference on citation history.
//
// ── the buckets, and why `withheld` is the one that matters ──────────────────────────────────────────
//
//   found       in the reference, and in the run's findings list
//   withheld    in the run's own RETRIEVED records, and not in its findings — the gather/judgment seam
//   lost        never retrieved at all
//   excluded    in the reference, in a class or territory this scenario does not run — not a miss
//   additional  a mark the client had already accepted before the search. Surfacing it is CORRECT
//   noise       in the findings, in neither list
//   uncovered   in the findings, belonging to a SUBJECT MARK this reference does not answer — not a miss
//               and not noise. `excluded` one axis over: same reading, own bucket (see referenceCoverage)
//
// `withheld` is what changes where a fix goes. Two marks in a prior round sat in the run's own band and
// neither reached the findings: recall was not the problem, the seam was. A scorer that collapses
// `withheld` into `lost` sends the fix to variant generation, which was working.
//
// A register-only run has no such seam to measure — a knockout lane publishes what it rated and keeps no
// separate retrieved corpus — so `register_only: true` in the reference collapses the two honestly and
// says it did, rather than reporting a `withheld: 0` that means "not computed".
//
// ── matching ─────────────────────────────────────────────────────────────────────────────────────────
//
// On stem, never on label. One round relabelled a mark to a three-name composite; an exact diff read
// that as a drop plus a find. See matchesReference.

import { normalizeElement, consonantSkeleton } from "./form-neighbourhood.mjs";
import { canonicalJurisdictionCode } from "./jurisdiction-codes.mjs";

export const REFERENCE_SCHEMA_VERSION = 1;

// ── — THE SCORER STAMPS ITS OWN VERSION, BECAUSE AN INSTRUMENT FIX INVALIDATES ITS BACK-CATALOGUE ─
//
// `REFERENCE_SCHEMA_VERSION` above versions the INPUT — the reference file this scorer is pointed at.
// Nothing versioned the INSTRUMENT, so every archived score read as comparable to every other and a
// reader had no way to tell which of them predate a change in what a bucket records.
//
// BUMPED BY THIS CHANGE. `found[].matched_ordinal` did not exist before it, so a score that carries it
// and a score that does not are not one measurement described two ways — they are two instruments.
// Bump on any change to what a bucket MEANS or what it records; not on wording, formatting, or a crash
// fix. The property worth keeping is that a reader comparing two runs can tell whether the comparison
// is valid at all.
//
// 4 —. v3 DECLARED `matched_ordinal` AND NEVER CARRIED ONE: the field existed, and the map in
// scripts/score.mjs that builds this function's input did not list `ordinal`, so every v3 score reads
// null on every find. That is why the stamp has to move for what looks like a one-line fix. A reader
// holding a v3 score cannot tell "this finding had no ordinal" from "this scorer could not see
// ordinals at all", and only the version distinguishes them: AT v3 THE NULL MEANS NOT-CARRIED, at 4 it
// means the finding genuinely has none. No v3 score can be re-read to recover the number.
// 6 —, folded into. `noise` and `additional` now record `ordinal`. At 5 and below a
// knockout score named a mark and an owner and nothing identifying, so no scored finding could be tied
// back to the row that produced it — and a null there could not be told from a scorer that never looked.
// Same distinction the v3→v4 note draws, one bucket set over: AT 5 THE ABSENCE MEANS NOT-CARRIED, at 6 a
// null means the finding genuinely had no ordinal.
// 5 —. WHAT `found` MEANS CHANGED, not how it is worded: the alias rule no longer credits a gold
// entry to a different proprietor's mark on a fragment of the entry's name, and a mark whose own name
// contains an unspaced middot is no longer split into pieces that match on their own. Scores at 4 and
// below report recall that is too HIGH by an unknown amount on any scenario whose gold carries a
// multi-part mark, so the two are not comparable in the direction that matters.
// — v7: the delivery line no longer reads a MISSING status.json as a refusal.
// Scores at 6 and below printed THE ORDER WAS REFUSED for every archived run, above correct
// numbers, so a v6 delivery verdict on a pool dir is not comparable with a v7 one.
export const SCORER_VERSION = 7;

/**
 * The owner as a person reads it.
 *
 * The two sides of a score carry owner in two shapes: a RUN finding carries the typed object
 * { name, country, registrations } (findings-model.mjs OWNER_KEYS), a GOLD entry carries a
 * lawyer-typed string. Every bucket flows through one printer, so whichever shape reaches it is
 * interpolated as-is — and the buckets built from run findings (ADDITIONAL, NOISE) printed
 * `[object Object]` in the column those rows are read for, while the gold-built ones (LOST,
 * WITHHELD) printed fine. Flatten at the boundary and one printer serves both.
 *
 * Both shapes are accepted because score.mjs reads PRESERVED runs, some older than the typed shape.
 */
export function ownerName(owner) {
  if (typeof owner === "string") return owner.trim() || null;
  const n = owner?.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

// Corporate and device wording that is never the distinctive part of a mark.
const NOISE_TOKENS = new Set(["inc", "llc", "ltd", "limited", "gmbh", "sa", "ag", "co", "corp",
  "corporation", "company", "and", "the", "of", "device", "stylised", "stylized"]);

/** Normalized tokens of one label, corporate noise dropped. */
export function labelTokens(label) {
  return String(label ?? "")
    .split(/[\s/,·&+|—–-]+/)
    .map(normalizeElement)
    .filter((t) => t && !NOISE_TOKENS.has(t));
}

/**
 * The ALIASES a label carries — the alternative names for one record.
 *
 * The two separator classes do different work and conflating them is the bug worth stating. `/ , · & |`
 * separate ALTERNATIVES for the same record: `VENZAL / VENZALMONO / VENZALKOMB` is one relabelled entry,
 * and `CHROMA / & Device` is one mark plus a device note. Whitespace and hyphens separate WORDS WITHIN
 * one name: `TIKI TWIST` is not `TIKI`.
 *
 * Treating a word separator as an alias separator makes every multi-word mark match its own first word —
 * so a reference `TIKI` would claim the run's `TIKI TWIST`, and a genuinely withheld mark would be
 * reported as found. That is a false clean on the exact pair this scorer was built for.
 */
/*
 * ── — THE MIDDOT IS OVERLOADED IN THE GOLD, AND SPACING IS THE ONLY SIGNAL THAT SEPARATES ITS TWO
 * JOBS. A SPACED middot is the lawyer's alternation between renderings of one record. An UNSPACED one is
 * a character INSIDE a single mark's own name, and splitting there manufactures short aliases that each
 * key into the alias rule on their own — so a two-letter fragment of one mark's name became a standalone
 * identity that any proprietor's mark could satisfy.
 *
 * Measured over every gold set in the config store, 37 distinct marks: 6 carry a middot, 5 spaced and 1
 * unspaced. This rule therefore keeps every alternation the lawyers actually wrote and stops the one
 * that was never an alternation. Whitespace on EITHER side is enough — requiring both would turn a
 * typing slip into a scoring change, and no separator in the corpus is one-sided.
 *
 * `&` NO LONGER SPLITS AT ALL. It is an ordinary word-joining character inside mark names, and its
 * alternation use in this corpus is always already separated by another character — a device note
 * reached by the `/` beside it. Both marks carrying an `&` are SPACED, so spacing cannot discriminate
 * here the way it does for the middot, and the choice is between splitting both or neither. Neither is
 * right: splitting cost a whole mark its identity, and folding costs nothing measurable.
 *
 * `/ , |` stay unconditional. They are never part of a mark's own name.
 */
export function labelAliases(label) {
  return String(label ?? "")
    .split(/\s+·\s*|\s*·\s+|[/,|]+/)
    .map((part) => labelTokens(part).join(""))
    .filter(Boolean);
}

/** The consonant skeleton is only discriminating once there is enough of it. TIKI and TIKA are both "tk". */
const MIN_SKELETON = 4;

// asked for a minimum ALIAS length, or a stated reason there is none. THERE IS NONE, deliberately.
// The two-character alias that prompted the question was never a mark — it was half of one mark's name,
// manufactured by splitting on an unspaced middot, and `labelAliases` no longer produces it. Measured
// over the same 37 distinct gold marks: 1 alias shorter than four characters before that fix, 0 after.
// A floor would guard nothing that still exists, and it would not be free — short marks are real, and a
// floor is the kind of rule that turns a genuine two- or three-character registration into a silent
// miss. MIN_SKELETON is a different argument: it bounds a FUZZY rule, where too little signal makes
// unrelated names collide. Equality of whole aliases needs no floor.

/**
 * Does `candidate` (a run's finding or record) name the same mark as `ref`?
 *
 * Rules, in order, each returning the name that fired so the report can say WHY two labels were treated
 * as one mark. A match nobody can audit is worse than a miss.
 *
 *  1. SCRIPT. normalizeElement keeps only [a-z0-9], so a CJK mark folds to the empty string and every
 *     Latin rule below would match it against everything. R1's reference contains a Chinese registration
 *     and the jx lane exists to generate it, so getting this wrong would score the one thing that
 *     scenario is for as a find it never made. Raw comparison after NFKC — which folds full-width and
 *     compatibility renderings of the same characters — and nothing else.
 *
 *     WHOLE MARK, NOT CONTAINMENT. This rule was containment in both directions and unowned,
 *     which is rule 4's test WITHOUT rule 4's guard — on the one path where the guard matters most,
 *     because a Han mark carries no aliases and no skeleton to catch the error further down. Measured
 *     live: gold 色度 (class 9) scored as RETRIEVED because the run held 色度花间 (class 41, a different
 *     proprietor). Every CJK found/withheld verdict in every R1/R6 score was decided that way, in both
 *     directions, so the recall numbers were unquotable rather than merely wrong.
 *
 *     The engine's own classifier had already ruled this and said why: band-shape.mjs takes equality
 *     only for a Han mark and states that "色度計 contains 色度 and is a different mark", and whether
 *     that matters is judgment's call. The scorer was the looser of the two. It is now the same rule,
 *     with the same containment escape the Latin path has and on the same condition — an owner the
 *     CALLER established, never one this function guessed — reported as `script-contained` so a report
 *     can tell an exact CJK match from an owner-gated one.
 *  2. ALIAS. Any alias of one label equals any alias of the other, compared as whole names. This is what
 *     makes `VENZAL` match `VENZAL / VENZALMONO / VENZALKOMB` — the relabelling an exact diff misreads
 *     as a drop plus a find — while keeping `TIKI` and `TIKI TWIST` apart.
 *  3. SKELETON. Consonant skeletons of 4+ characters agree. Reaches the one-vowel spelling pairs a variant
 *     sweep must not split, without letting short marks collide — 4 is the floor because TIKI and TIKA
 *     both skeletonise to "tk".
 *  4. CONTAINED — ONLY when the caller has established that both sides carry the SAME OWNER.
 *     One label's word sequence sits contiguously inside the other's. Rules 2 and 3 handle a reference
 *     mark being an ALIAS of, or a spelling neighbour of, a surfaced one; neither handles it being
 *     CONTAINED in one, and that is how `DELPHI GENETICS` and `DG DELPHI GENETICS` — identical owner,
 *     one record — were filed as a `lost` and a `noise` on the same run. A record cannot be both never
 *     retrieved and surfaced-but-unknown, and the entry it split was the reference's highest-risk one.
 *
 *     READ WITH RULE 2, NOT AGAINST IT (2026-08-14). Rule 2's block says the alias rule "keeps `TIKI`
 *     and `TIKI TWIST` apart", and this rule joins exactly that pair under a matched owner —
 *     `matchesReference("TIKI", "TIKI TWIST", {sameOwner:true})` returns `contained`. Both are right
 *     and they read as contradictory side by side. Rule 2 asks whether two labels are the SAME NAME,
 *     where a word separator must never collapse a longer mark into its first word. Rule 4 asks a
 *     different question that only an established owner match makes answerable: whether ONE PROPRIETOR
 *     rendered ONE record long and short. Neither answer weakens the other, and a future reader
 *     resolving the apparent conflict by narrowing either one would break the case it was built for.
 *
 *     OWNER IDENTITY IS THE DISCRIMINATOR, and it is the whole reason this rule is safe. Containment on
 *     its own would pull `Delphi Pharmaceuticals` and `Delphi Laboratories` into `found` and manufacture
 *     recall the run does not have — five such marks sit in this very scenario's own results. Gated on
 *     `ownersMatch`, it reaches exactly the case it is for: one proprietor, one record, two renderings.
 *     The caller establishes the owner agreement; this function never guesses it.
 */
export function matchesReference(ref, candidate, { sameOwner = false } = {}) {
  const rawRef = String(ref ?? "").trim();
  const rawCand = String(candidate ?? "").trim();
  if (!rawRef || !rawCand) return null;

  const refAliases = labelAliases(rawRef);
  const candAliases = labelAliases(rawCand);

  // 1 — nothing Latin on one side. Do not fall through: an empty alias list would match everything.
  if (!refAliases.length || !candAliases.length) {
    const a = rawRef.normalize("NFKC").replace(/\s+/g, "");
    const b = rawCand.normalize("NFKC").replace(/\s+/g, "");
    if (!a || !b) return null;
    if (a === b) return "script";
    // The containment escape, gated exactly as rule 4 is. Without the gate this line scored a different
    // proprietor's longer mark as the reference's own.
    if (sameOwner && (a.includes(b) || b.includes(a))) return "script-contained";
    return null;
  }

  // 3 — ALIAS. splits this in two, on the same precedent as rules 1 and 4 (, "the scorer calls
  // a different owner's longer mark a hit"). This rule was the one cross-owner escape left open.
  //
  // FULL IDENTITY — one name on each side and they are the same name — is NOT a relaxation and stays
  // ungated. A different proprietor registering the identical mark is a real conflict and the thing this
  // engine exists to surface; refusing it would be a recall collapse dressed as precision. `ownersMatch`
  // is fail-closed, so gating here would send every entry whose owner the gold does not record straight
  // to `lost` — 3 of 41 register entries carry no owner.
  //
  // PARTIAL — either side decomposed into several alternatives and only one of them matched — IS a
  // relaxation, and it is the shape the defect travelled in. Matching one alternative of a multi-part
  // label claims the record the lawyer named on the strength of a FRAGMENT of its identity, and only the
  // proprietor tells that apart from a different company that happens to use the same fragment.
  //
  // THE GATE COSTS NOTHING, measured rather than hoped: after the splitter fix above, 5 gold entries
  // still decompose and ALL 5 carry an owner, while the 3 carrying none never decompose. On the
  // candidate side it cannot cost anything by construction — `owner.name` is a REQUIRED field on every
  // finding (findings-model.mjs throws `finding_owner_invalid` on an absent or empty one), on the
  // knockout lane as much as the clearance one.
  // THE GATE IS KEYED ON THE REFERENCE SIDE ALONE, and the rule I abandoned to get here is worth
  // recording so nobody re-derives it. I first keyed it on BOTH sides — full identity meant one name on
  // each — and a shipped test refuted it in one line: `matchesReference("ZORVIL", "ZORVIL / ZORVILMONO
  // / ZORVILKOMB")` is the RELABELLING case, where a round rewrote one mark as a three-name composite,
  // and it must stay an alias match. There the CANDIDATE decomposed while the gold's identity — one
  // name — was matched in FULL. Nothing was claimed on a fragment.
  //
  // The asymmetry is the whole point and it is not cosmetic. The reference is the lawyer's statement of
  // WHICH RECORD is at issue; a match resting on one part of a multi-part gold label claims that record
  // on a piece of its name, and only the proprietor separates that from a different company using the
  // same piece. How the RUN chose to label what it found is the run's business, and folds no identity
  // claim into the gold.
  const fullIdentity = refAliases.length === 1;
  if (fullIdentity || sameOwner) {
    for (const r of refAliases) if (candAliases.includes(r)) return "alias";
  }

  // — THE SKELETON RULE CARRIES THE SAME GATE, because it reads the SAME alias lists and would
  // otherwise walk straight around the one above. Measured: with only rule 3 gated, 3 of the 5 gold marks
  // that still decompose were credited to a different proprietor anyway — the skeleton of a decomposed
  // alias equals the skeleton of the candidate's whole name, so an EXACT fragment match re-entered here
  // wearing a fuzzy rule's name. A gate one rule wide is not a gate.
  //
  // The distinction is a property of WHICH ALIAS matched, never of which rule matched it, so it belongs
  // to both: full identity on both sides stays ungated, and a match resting on one alternative of a
  // decomposed label needs the proprietor. This is strictly narrower than gating skeleton outright,
  // which would change the fuzzy rule for the ordinary single-name case it was built for.
  if (fullIdentity || sameOwner) {
    for (const r of refAliases) {
      const skel = consonantSkeleton(r);
      if (!skel || skel.length < MIN_SKELETON) continue;
      if (candAliases.some((c) => consonantSkeleton(c) === skel)) return "skeleton";
    }
  }

  // 4 — containment, and ONLY under an owner the caller has already matched.
  if (sameOwner && containsWordRun(labelTokens(rawRef), labelTokens(rawCand))) return "contained";
  return null;
}

/**
 * Does either token array contain the other as a CONTIGUOUS run of whole words? Both directions —
 * under an owner match the direction carries no information (one proprietor rendering one record long
 * or short), and requiring one would turn a symmetric fact into a coin toss on which side the lawyer
 * happened to type first.
 *
 * Whole words, never characters: `veltri` must not be found inside `veltrinsoft`, which is a different
 * proprietor's different mark and exactly the collision `labelAliases`' own doc block warns about.
 * Empty on either side is never a match — an empty array is contained in everything.
 */
function containsWordRun(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length || !long.length) return false;
  for (let i = 0; i + short.length <= long.length; i++)
    if (short.every((t, j) => long[i + j] === t)) return true;
  return false;
}

// ── — THE EVIDENCE CLASS ────────────────────────────────────────────────────────────────────────
//
// matchesReference answers the STRING question: is this the same name? The scorer never asked the second
// one, and both knockout scenarios in one round were scored `found` on the answer to the first alone —
// a registered trademark satisfied by a retail-and-app identity on the common-law screen, and three
// register entries satisfied by a discussion thread. Both scored a nonzero register recall for lanes
// whose real register recall was zero. A recall figure that moves without the engine changing is worse
// than one that stays wrong, because it invites a conclusion.
//
// An entry in a gold set's `register` array is a REGISTERED RIGHT by construction of the array it sits
// in — no per-entry flag is needed and no gold set is edited. What was missing is entirely candidate-side.
export const EVIDENCE_CLASSES = ["register", "common-law", "case-law", "unknown"];

/**
 * Fold a run finding's own typed source into the class the scorer reasons about.
 *
 * `SOURCE_TYPES` (findings-model.mjs) is already a CLOSED, per-finding-validated vocabulary on the
 * clearance lane — register-vendor / register-euipo / common-law-marketplace / common-law-web / case-law
 * — so this is a fold, not a new contract. An unrecognised or absent value folds to "unknown", never to
 * a class: guessing here is how a false positive would come back wearing a type.
 */
export function evidenceClassOf(sourceType) {
  const t = String(sourceType ?? "").trim();
  if (/^register-/.test(t)) return "register";
  if (/^common-law-/.test(t)) return "common-law";
  if (t === "case-law") return "case-law";
  return "unknown";
}

/**
 * Does `candidate` SATISFY reference entry `entry` — the same mark, AND the right KIND of evidence?
 *
 * Returns { rule, evidence, ok } so a REFUSAL is as auditable as a match. A match nobody can audit is
 * bad; a refusal nobody can audit is worse, because it looks exactly like a search that never ran.
 *
 * `unknown` DOES NOT BLOCK, and that is deliberate. score.mjs reads PRESERVED runs, including ones older
 * than the typed source shape; converting their genuine finds into misses would be a second silent
 * defect dressed as a fix. Three-valued, on the same discipline the gap and verdict readers already use.
 */
export function satisfiesReference(entry, candidate) {
  const label = typeof entry === "string" ? entry : (entry?.mark ?? entry?.name ?? "");
  const mark = typeof candidate === "string" ? candidate : (candidate?.mark ?? "");
  // — the owner agreement is established HERE and handed to the matcher, which never guesses it.
  // A string entry / string candidate carries no owner, so the containment rule stays off for them.
  const sameOwner = typeof entry === "object" && typeof candidate === "object"
    && ownersMatch(entry?.owner, candidate?.owner);
  const rule = matchesReference(label, mark, { sameOwner });
  if (!rule) return { rule: null, evidence: null, ok: false };
  const evidence = (typeof candidate === "object" && candidate?.evidence) || "unknown";
  // A REGISTER entry is not satisfied by material that is not a register record. case-law is refused for
  // the same reason: a precedent naming the mark is not the registration.
  return { rule, evidence, ok: evidence === "register" || evidence === "unknown" };
}

/** In scope iff the entry's classes AND territories both intersect what the run was instructed to search. */
export function inScope(entry, scopeClasses = [], scopeTerritories = []) {
  const cls = (entry?.classes ?? []).map(String);
  const scopeCls = scopeClasses.map(String);
  if (scopeCls.length && cls.length && !cls.some((c) => scopeCls.includes(c))) return false;

  // TERRITORY, on the same rule as class. A reference covers what the lawyer searched, and a scenario
  // runs a subset — R1's gold set names filings in FR, IN, DE and TW while the run is instructed to seven
  // other territories. Scoring those as `lost` would report a scope decision as a recall defect, and on
  // that scenario it is five of fifteen entries, which is the difference between a bad round and a fine
  // one. Same shape as the class rule: an entry naming no territory is in scope, and a run that recorded
  // no scope cannot exclude anything.
  const terr = (entry?.jurisdictions ?? []).map(canonTerritory).filter(Boolean);
  const scopeTerr = scopeTerritories.map(canonTerritory).filter(Boolean);
  if (scopeTerr.length && terr.length && !terr.some((t) => scopeTerr.includes(t))) return false;

  return true;
}

/**
 * Fold a territory label to something comparable. The reference writes what the lawyer wrote — `FR (appl.)`,
 * `CH, LI, EU, US`, `TW / intl`, `EU + East Asia` — and the run records instructed codes. This is not a
 * jurisdiction resolver: it uppercases, strips parentheticals and keeps letters, which is enough to compare
 * `US` with `US`, and deliberately not enough to guess that `intl` covers anything.
 *
 * `INTL` and `WORLDWIDE` are treated as matching NOTHING, so a portfolio-wide entry is never excluded on
 * territory — it falls through to in-scope, where the class rule and the buckets can speak about it.
 */
export function canonTerritory(label) {
  const s = String(label ?? "").replace(/\(.*?\)/g, "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!s || s === "INTL" || s === "INTERNATIONAL" || s === "WORLDWIDE") return null;
  return s;
}

// ── — WHICH SUBJECT MARKS DOES THIS REFERENCE ANSWER ────────────────────────────────────────────
//
// A batch run searches SUBJECT MARKS. R3 searches two. Its gold set answers one, and the scorer used to
// flatten both marks' findings into one list and measure all of them against that one-mark reference —
// so the second mark's legitimate hits printed as `noise`, the bucket a reader scans to ask "did the
// engine surface junk?". They are not junk. They are the correct output of a mark nobody wrote a
// reference for. The inflation was silent, permanent and grew with every round.
//
// SUBJECT vs MARK, and the two are not the same word. A finding's `mark` is the CONFLICTING name the run
// surfaced ("Coral Freezes"). Its `subject` is the mark the batch was searching when it surfaced it
// ("CORAL FREEZE"). Only the subject can be compared with a reference's declared coverage.
//
// THE DECLARATION IS A FIELD, NEVER AN INFERENCE. `covers_marks` is an optional array on the gold set.
// The existing `mark` field is NOT read for this and must not be: it is a display header, never
// validated, and a lawyer writing "CORAL FREEZE (and variants)" or a batch label there would silently
// exclude the whole batch and print noise 0 — the same defect, wearing a fix.
//
// BATCH-LEVEL, AND SAID SO. `covers_marks` declares coverage for the BATCH. `register[]` entries carry
// no per-mark attribution, so a gold declaring two marks still flattens its own entries between them.
// Scoring truly per mark needs a lawyer to attribute each register entry to a subject; that is why the
// scorer states its coverage and excludes the rest rather than running one score per mark.

/**
 * Which of the marks this run searched does this reference answer? PURE.
 *
 * `coversMarks` is the gold set's declaration (absent → null). `subjects` is the run's own SUBJECT ROLL,
 * lifted off the artifact that already gates it — three-valued: `null` means this lane publishes no
 * per-mark roll at all (the clearance lane), `[]` means it published one and it was empty.
 *
 * A subject matches a declared label through `matchesReference` — the same stem rule the buckets use, so
 * a gold's "CORAL FREEZE" and a run's "Coral Freeze" are one mark and the two halves can never disagree.
 *
 * FOUR STATES, and `excludes` is non-empty in exactly one of them:
 *
 *   declared                        `covers_marks` present, at least one subject matched. `excludes` is
 *                                   every subject no declared label matched.
 *   undeclared                      no `covers_marks`. Excludes NOTHING and says which marks ran, so the
 *                                   old gold-set shape keeps scoring exactly as it did — visibly
 *                                   undeclared rather than silently mis-bucketed.
 *   declaration-matches-no-subject  `covers_marks` present and NOT ONE subject matched — a typo, a
 *                                   rename, a stale gold. It REFUSES to exclude. Without this arm a
 *                                   one-character typo sends every finding to `uncovered`, noise reads 0
 *                                   and the round reads as a clean sweep. This is the most dangerous
 *                                   silent failure the field introduces, and the refusal is the guard.
 *   no-subject-roll                 `subjects === null`. Nothing changes for the clearance lane.
 *
 * `undeclaredIn` is the other direction: declared labels no subject matched while others did — the
 * reference names a mark this run never searched. Reported, never silent.
 */
export function referenceCoverage({ coversMarks = null, subjects = null } = {}) {
  const declared = (Array.isArray(coversMarks) ? coversMarks : [])
    .map((s) => String(s ?? "").trim()).filter(Boolean);
  const roll = subjects === null || subjects === undefined
    ? null
    : (subjects ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  const base = { covers: declared, subjects: roll, covered: [], excludes: [], undeclaredIn: [] };

  if (roll === null) return { ...base, state: "no-subject-roll", why:
    "this lane publishes no per-mark subject roll, so there is no mark to place out of the reference's scope — every finding is measured against it, exactly as before" };

  const named = roll.length ? roll.join(", ") : "(none)";
  if (!declared.length) return { ...base, state: "undeclared", why:
    `NOT DECLARED — this run searched ${roll.length} mark${roll.length === 1 ? "" : "s"} (${named}) and the reference declares no \`covers_marks\`, so every finding is measured against it. `
    + "Which marks this reference answers cannot be established from the gold set." };

  const covered = roll.filter((s) => declared.some((d) => matchesReference(d, s)));
  if (!covered.length) return { ...base, state: "declaration-matches-no-subject", undeclaredIn: declared, why:
    `the reference declares \`covers_marks\` (${declared.join(", ")}) and NOT ONE of the marks this run searched (${named}) matches it. `
    + "Nothing is placed out of scope: a declaration matching no subject is a stale or mistyped gold set, and excluding on it would empty every bucket and read as a clean sweep." };

  const coveredSet = new Set(covered);
  const excludes = roll.filter((s) => !coveredSet.has(s));
  const undeclaredIn = declared.filter((d) => !roll.some((s) => matchesReference(d, s)));
  const why = excludes.length
    ? `the reference answers ${covered.length} of the ${roll.length} marks this run searched: ${covered.join(", ")}. `
      + `${excludes.join(", ")} ${excludes.length === 1 ? "is" : "are"} not answered here — ${excludes.length === 1 ? "its" : "their"} findings are \`uncovered\`, neither noise nor lost.`
    : `the reference answers every mark this run searched: ${covered.join(", ")}.`;
  return { ...base, state: "declared", covered, excludes, undeclaredIn,
    why: why + (undeclaredIn.length
      ? ` It also names ${undeclaredIn.join(", ")}, which this run never searched.`
      : "") };
}

/**
 * Axis A — bucket every reference entry, and every finding the reference does not contain.
 *
 * `findings` and `retrieved` are label lists the caller lifted off the run's own artifacts. Keeping the
 * artifact reading out of here is what lets this run offline over a preserved dir with no driver
 * imports, and what lets the test drive it on verbatim records from a real run.
 *
 * — `coverage` is `referenceCoverage`'s answer, and the findings it names are PARTITIONED OFF
 * BEFORE the entry loop rather than filtered out of `noise` after it. Before, because an uncovered
 * mark's finding must not be able to satisfy a covered reference entry and manufacture a `found`: the
 * reference answers CORAL FREEZE, and a CINDER LANTERN hit does not answer it. An entry only an uncovered
 * finding would have matched is then honestly `lost`.
 *
 * The subject test here is EXACT string equality, never `matchesReference`. Both sides came off the same
 * subject roll; the fuzzy match happens once, in `referenceCoverage`, between the gold's label and the
 * roll. Two loops asking the matcher the same question two different ways is.
 */
export function scoreRecall({ reference, findings = [], retrieved = [], scopeClasses = [], scopeTerritories = [], registerOnly = false, collapseReason = null, preAccepted = [], coverage = null }) {
  const entries = reference ?? [];
  const buckets = { found: [], withheld: [], lost: [], excluded: [], additional: [], noise: [], uncovered: [] };
  const claimed = new Set();

  // — the partition, before anything is scored.
  const outOfScope = new Set((coverage?.excludes ?? []).map(String));
  const isUncovered = (f) => Boolean(f?.subject) && outOfScope.has(String(f.subject));
  const all = findings ?? [];
  const scorable = all.filter((f) => !isUncovered(f));
  for (const f of all.filter(isUncovered)) {
    buckets.uncovered.push({ mark: f.mark, owner: f.owner ?? null, band: f.band ?? null, subject: f.subject,
      why: `the mark "${f.subject}" is not among the marks this reference answers (${(coverage?.covers ?? []).join(", ") || "none declared"})` });
  }

  for (const e of entries) {
    const label = e.mark ?? e.name ?? "";
    if (!inScope(e, scopeClasses, scopeTerritories)) {
      // NOT `lost`. The reference covers classes and territories this scenario does not run; scoring
      // those as misses would report a scope decision as a recall defect. Listed, never silently dropped.
      const cls = (e.classes ?? []).map(String);
      const terr = (e.jurisdictions ?? []).map(String);
      const byClass = scopeClasses.length && cls.length && !cls.some((c) => scopeClasses.map(String).includes(c));
      buckets.excluded.push({ ...e, why: byClass
        ? `classes ${cls.join("/")} outside the run's ${scopeClasses.join("/")}`
        : `territories ${terr.join("/")} outside the run's ${scopeTerritories.join("/")}` });
      continue;
    }
    //: the same-name test AND the right-kind-of-evidence test. Both, or it is not a find.
    const hit = scorable.find((f) => satisfiesReference(e, f).ok);
    if (hit) {
      claimed.add(hit.mark);
      const s = satisfiesReference(e, hit);
      // — WHICH FINDING, NOT JUST WHICH NAME. `matched` records the mark string the finding carries,
      // and on a run holding five findings whose marks are the gold label or start with it, that string
      // does not say which of them earned the credit. The number is not claimed wrong; it is
      // UNAUDITABLE — a reader cannot re-derive it from the artifact, which for a scoring instrument is
      // the same problem one step removed.
      //
      // `ordinal` is the number the narrative and findings.json already agree on, so it is the identifier
      // a reader can follow. NULL WHEN ABSENT rather than derived from an index: `scorable` is a FILTERED
      // list, so a position in it is not the finding's ordinal, and a plausible wrong number is worse
      // here than a stated absence.
      buckets.found.push({ ...e, matched: hit.mark,
        matched_ordinal: Number.isInteger(hit.ordinal) ? hit.ordinal : null,
        rule: s.rule, evidence: s.evidence, subject: hit.subject ?? null });
      continue;
    }
    // — AN ABSENCE IS A FINDING. The entry was not satisfied, but say whether something NEARLY did.
    // "a register entry whose only namesake was marketplace material" is a specific, actionable fact
    // about the lane; a bare `lost` row hides it and reads as "the search never saw this name at all".
    const refused = findings.find((f) => { const s = satisfiesReference(e, f); return s.rule && !s.ok; });
    // AGAIN, ON THE THIRD LOOP. The found loop and the noise loop below both ask the matcher the
    // OWNER-AWARE question; this one asked the strict one, and the asymmetry decided a bucket. A
    // proprietor's own record whose mark text carries a leading element the gold label does not — a
    // device prefix, an initialism — fails the strict test, so `withheld` cannot fire and the entry
    // falls through to `lost`. `lost` prints as "never retrieved" about a record sitting in the run's
    // own band, which sends the fix to variant generation when the defect is at the gather/judgment
    // seam. That is the exact wrong-fix this file's withheld/lost split exists to prevent.
    //
    // SAFE BY CONSTRUCTION, because `ownersMatch` is fail-closed: absent owner on either side returns
    // false and the strict test is what runs, so this can only ever relax a pair whose proprietor the
    // scorer has already established. It is not a fuzzier matcher — the relaxation is containment under
    // a proven-equal owner, and a DIFFERENT mark of the SAME owner still returns null.
    const heldRule = (r) => matchesReference(label, r.mark, { sameOwner: ownersMatch(e?.owner, r?.owner) });
    // ── — THE OWNER DECIDES WHICH RECORD IS CITED, NEVER BAND ORDER ───────────────
    //
    // This was `retrieved.find(heldRule)` — the FIRST match in band order, with nothing preferring the
    // entry's own proprietor. Measured on the 2026-08-27 R2 round against R2's gold: of eight entries,
    // five matched more than one band record and three cited the wrong company. For two of those three
    // the RIGHT record was already in the match set and was passed over on position alone — DELPHIC's at
    // index 1, DELPHYS's at index 3.
    //
    // The looseness of the matcher is NOT the fault here and is deliberately left alone. Only one of the
    // three wrong citations came from a skeleton collision; the other two were `alias` matches — the
    // identical characters owned by a different company, which is a real conflict and the thing this
    // engine exists to surface. Gating that would trade measured recall for speculative precision.
    //
    // MEMBERSHIP IS UNCHANGED, and that is what keeps the baseline honest: the entry is withheld if ANY
    // record matched, exactly as before. Only the CITED record moves. R2's buckets stay found 0 /
    // withheld 8 / lost 1.
    const heldAll = registerOnly ? [] : retrieved.filter((r) => heldRule(r));
    const heldOwned = heldAll.filter((r) => ownersMatch(e?.owner, r?.owner));
    // ✕ ONLY WHEN THE ENTRY NAMES AN OWNER. `ownersMatch` is fail-closed, so an entry the gold records no
    // owner for would match nothing and disclose on every row — turning a scorer that cited a correct
    // record into one that cites none, for entries where there is nothing to disambiguate WITH and no
    // ambiguity to disclose. 3 of R2's 41 register entries carry no owner; this file already refuses to
    // penalise them elsewhere for the same reason. Without an owner the old first-match stands.
    const entryNamesOwner = Boolean(ownerKey(e?.owner));
    if (heldAll.length) {
      // AMONG THE OWNER'S OWN RECORDS, PREFER THE CLOSEST NAME. `heldOwned[0]` is band order again, one
      // level down: DELPHIC's owner holds several records and the first is `DELPHIC ADAPTABLE`, while the
      // lawyer named plain `DELPHIC`. Right proprietor, wrong record of theirs. An `alias` rule is an
      // identity match on the name; `skeleton` and `contained` are near-forms. Take an identity match
      // when the owner has one.
      const strongest = (rows) => rows.find((r) => heldRule(r) === "alias") ?? rows.find((r) => heldRule(r) === "script") ?? rows[0] ?? null;
      const cited = entryNamesOwner ? strongest(heldOwned) : strongest(heldAll);
      buckets.withheld.push({ ...e,
        // NAME THE BLINDNESS, NEVER INVENT THE VERDICT (the doctrine asks of the run
        // scorer, arrived at here from the other direction). With no owner-identified record the honest
        // answer is that none was identified — not the first near-form that happened to sort early.
        // `ownersMatch` is fail-closed, so this fires both when the proprietors genuinely differ and when
        // the same company is written two ways; the second is a real gap, filed on its own, and until it
        // lands this row says "could not identify" rather than guessing.
        matched: cited ? cited.mark : null,
        record: cited ? (cited.record_id ?? null) : null,
        rule: cited ? heldRule(cited) : null,
        ...(cited ? {} : {
          ownerUnidentified: true,
          why: `matched ${heldAll.length} band record(s) and none could be attributed to this entry's `
            + `owner, so no record is cited: ${heldAll.slice(0, 4).map((r) => `${r.mark} (${r.owner ?? "owner unrecorded"})`).join("; ")}`,
        }),
        ...(heldOwned.length > 1 ? { ownerMatchedRecords: heldOwned.length } : {}) });
      continue;
    }
    // The reason must name the ACTUAL cause. `registerOnly` is set by two different situations — a
    // knockout lane with no gather/judgment seam, and a run dir with no `_driver/` and therefore no
    // retrieved corpus to look in — and a row that blames the wrong one tells the reader the lane was
    // register-only when it was not. The caller says which.
    buckets.lost.push({ ...e,
      ...(refused ? { refused: refused.mark, refusedEvidence: satisfiesReference(e, refused).evidence,
        refusedRule: satisfiesReference(e, refused).rule } : {}),
      ...(registerOnly
        ? { why: collapseReason ?? "withheld could not be computed for this run" }
        : {}) });
  }

  for (const f of scorable) {
    if (claimed.has(f.mark)) continue;
    // — the SAME call the found-loop makes, owner agreement included. Two loops asking the matcher
    // different questions is how one record reached two buckets: this one said "not a reference mark"
    // while the loop above said "not retrieved", and both were reported as facts about the run.
    if (entries.some((e) => matchesReference(e.mark ?? e.name ?? "", f.mark,
      { sameOwner: ownersMatch(e?.owner, f?.owner) }))) continue;
    // A mark the client had already accepted before the search is NOT noise. It is absent from the
    // headline set on purpose, and a run that surfaces it did the right thing — the reference says so
    // explicitly. Scoring it as noise would penalise a correct find and, worse, teach the next round to
    // suppress it.
    const pre = preAccepted.find((p) => matchesReference(p.mark ?? p.name ?? "", f.mark));
    if (pre) {
      // (folded into) — THE ORDINAL IDENTIFIES THE ROW. Without it a knockout score named a
      // mark and an owner and nothing that ties the row back to the finding it came from, so no scored
      // finding on a knockout run was identifiable. `found` has carried `matched_ordinal` since;
      // these two buckets are where a knockout finding actually lands, and they carried nothing.
      buckets.additional.push({ mark: f.mark, owner: f.owner ?? null, band: f.band ?? null, subject: f.subject ?? null,
        ordinal: Number.isInteger(f.ordinal) ? f.ordinal : null,
        matched: pre.mark ?? pre.name, why: pre.why ?? "pre-accepted by the client before the search" });
      continue;
    }
    // Neutral by construction. Assess it; do not assume it is wrong.
    // — `subject` rides along so a reader can tell WHICH mark surfaced this without opening
    // knockout-findings.json, on a covered mark's noise row as much as on an uncovered one.
    buckets.noise.push({ mark: f.mark, owner: f.owner ?? null, band: f.band ?? null, subject: f.subject ?? null,
      ordinal: Number.isInteger(f.ordinal) ? f.ordinal : null });
  }

  // ── — A RECORD MAY NEVER APPEAR IN TWO BUCKETS, AND THE SCORER SAYS SO ITSELF ─────────────────
  //
  // The containment rule above fixes the pairing that was observed. This states the CLASS, so the next
  // one is reported instead of discovered by reading two lists side by side and noticing. A surfaced
  // record whose owner matches a reference entry the run did NOT find is a collision: the two rows are
  // about the same proprietor, and they cannot both be true.
  //
  // RECORDED, NEVER THROWN, and never silently resolved into a bucket. This is a harness — it reports
  // what it saw. Auto-promoting a collision to `found` would be the scorer manufacturing recall from
  // its own confusion, which is the defect one layer up from the one being fixed. score.mjs prints
  // these; a reader adjudicates.
  buckets.collisions = [];
  for (const bucket of ["lost", "withheld"]) {
    for (const e of buckets[bucket]) {
      for (const n of buckets.noise) {
        if (!ownersMatch(e.owner, n.owner)) continue;
        buckets.collisions.push({ bucket, entry: e.mark ?? e.name ?? null, noise: n.mark,
          owner: ownerName(n.owner) ?? ownerName(e.owner),
          why: `the reference entry is reported ${bucket} while a surfaced record of the SAME owner is reported noise — one record cannot be both` });
      }
    }
  }

  return buckets;
}

/**
 * — WHAT `withheld` CANNOT SEE, MEASURED AND PUT ON ITS OWN LINE. PURE.
 *
 * `scoreRecall` iterates REFERENCE ENTRIES. `retrieved` is consulted only from inside that loop, to ask
 * "was this reference entry retrieved and then dropped". So a mark the run retrieved, dropped, and which
 * the reference does not happen to name is examined by nothing — it reaches no bucket, and `withheld`
 * cannot rise for it however many there are.
 *
 * THE ROUND THAT MEASURED IT: the reviewer returned BLOCKING on two live in-class rights the run's own
 * register-findings carried and its findings, narrative and placements did not. Both are in the run's
 * retrieved corpus. Neither is in the nine-mark reference. `withheld` scored 0, beside a coverage ledger
 * claiming "every right found is reported" — two independent-looking surfaces corroborating a false
 * statement, because both are scoped to the same nine marks.
 *
 * AND THE DIRECTION IS THE DANGEROUS ONE. A `withheld` that over-counted would be investigated the first
 * round it appeared. This one reads clean.
 *
 * This does NOT compute carry-through — that needs the run's screened set and is 's acceptance 1.
 * What it does is stop a bare `0` from reading as "nothing was dropped", by naming on the line how many
 * retrieved marks the number could not have spoken to. The file already refuses a bare `0` for the
 * no-`_driver/` case, in as many words; this is the same refusal for the case that reads clean.
 *
 * `outside` counts DISTINCT MARK TEXTS, not records: a proprietor with six records of one mark is one
 * thing the measure cannot see, not six.
 *
 * @returns {{referenceEntries:number, retrievedMarks:number, outside:number, note:string}}
 * PURE; never throws.
 */
export function withheldScope({ reference = [], retrieved = [], registerOnly = false } = {}) {
  const entries = Array.isArray(reference) ? reference : [];
  const corpus = Array.isArray(retrieved) ? retrieved : [];
  const marks = [...new Set(corpus.map((r) => String(r?.mark ?? "").trim()).filter(Boolean))];
  const named = (m) => entries.some((e) => matchesReference(e?.mark ?? e?.name ?? "", m,
    { sameOwner: false }));
  const outside = registerOnly ? 0 : marks.filter((m) => !named(m)).length;
  const n = entries.length;
  // THREE ANSWERS, NEVER TWO. An EMPTY corpus is not "nothing sits outside the measure" — it is the
  // measure having nothing to look at, and phrasing it as the reassuring case would recreate this
  // issue's own defect inside its fix. Same rule the collapse reason above follows.
  const scopeOf = `of ${n} reference mark${n === 1 ? "" : "s"}`;
  const note = registerOnly ? ""
    : !marks.length
      ? `${scopeOf} — and the retrieved corpus is EMPTY, so this number rests on nothing; it is not a clean result`
      : outside
        ? `${scopeOf} — ${outside} other retrieved mark${outside === 1 ? "" : "s"} are outside this measure entirely (#1322)`
        : `${scopeOf} — all ${marks.length} retrieved mark${marks.length === 1 ? " is" : "s are"} named by the reference, so nothing sits outside it`;
  return { referenceEntries: n, retrievedMarks: marks.length, outside, note };
}

/**
 * — the buckets above, folded PER SUBJECT MARK. PURE.
 *
 * The acceptance this answers is "the mark→bucket attribution is readable without opening
 * knockout-findings.json". It is a FOLD over buckets `scoreRecall` has already built, never a second
 * scoring pass, on the same discipline axis E states: it can never disagree with them about which row
 * landed where.
 *
 * ONE ROW PER SUBJECT IN THE ROLL, not per subject that produced a finding. A mark searched that came
 * back with nothing still gets a row; derived from the rows instead, a covered mark that came back clean
 * would read identically to a mark that was never searched.
 *
 * A COLUMN A ROW CANNOT SPEAK TO IS `null`, NEVER `[]`. An uncovered mark's findings were never measured
 * against the reference, so `noise: 0` would say they were measured and came back clean. Same defect
 * axis E's `no-reference-entries` row and its three-valued `returned` exist to prevent.
 *
 * FOUR COLUMNS, AND THE REST ARE NOT ATTRIBUTABLE. `lost`, `withheld` and `excluded` are REFERENCE-ENTRY
 * rows — `lost`/`excluded` come off `ref.register`, `withheld` off `retrieved`, and `retrieved` carries
 * no subject at all (a register band record has none). So they cannot be attributed to a subject mark
 * and are given no column rather than a misleading one. That is also precisely where this breaks if the
 * clearance lane ever goes multi-mark: `withheld` would need a subject on the retrieved corpus first.
 */
export function scoreByMark({ buckets = {}, coverage = null, lane = null } = {}) {
  const state = coverage?.state ?? null;
  const roll = coverage?.subjects ?? null;
  const notes = [
    "lost, withheld and excluded are reference-entry rows — withheld is measured against a retrieved corpus that carries no subject — so they are not attributable to one mark and get no column here.",
    ...(lane === "knockout"
      // Without this the covered mark's `found —` reads as a recall failure this change caused. It is
      // neither: the knockout lane publishes common-law material by construction, and satisfiesReference
      // refuses a register gold entry on common-law evidence. Structurally zero here, and always was.
      ? ["on the knockout lane every published finding is common-law material and a register gold entry is never satisfied by it, so `found` is structurally 0 on this lane and was before this fold existed."]
      : []),
  ];
  if (!Array.isArray(roll)) return { state, rows: null, why: coverage?.why ?? null, notes,
    absent: "this lane publishes no per-mark subject roll, so there is nothing to fold per mark" };

  const covered = new Set((coverage?.covered ?? []).map(String));
  const excludes = new Set((coverage?.excludes ?? []).map(String));
  const of = (name, subject) => (buckets?.[name] ?? []).filter((r) => String(r?.subject ?? "") === String(subject));

  const rows = roll.map((subject) => {
    // The per-row word IS the coverage state where coverage could not be established, so a reader cannot
    // read the `coverage:` line and this column as two different facts.
    const word = state === "declared" ? (covered.has(subject) ? "covered" : excludes.has(subject) ? "not-covered" : "covered") : state;
    const notCovered = word === "not-covered";
    return {
      subject, coverage: word,
      found: notCovered ? null : of("found", subject),
      additional: notCovered ? null : of("additional", subject),
      noise: notCovered ? null : of("noise", subject),
      uncovered: notCovered ? of("uncovered", subject) : null,
    };
  });
  return { state, rows, why: coverage?.why ?? null, notes, absent: null };
}

/**
 * Axis B — did on-field goods stay on-field?
 *
 * The reference marks the entries whose goods are squarely the client's field. A run that routes one of
 * those to `off-field` or `ruled_out` has not missed it, it has mis-grouped it, and the two need
 * different fixes. Entries the reference does not flag are not scored here — absent is `not-declared`,
 * never a silent pass.
 */
export function scoreField({ reference = [], findings = [] }) {
  const rows = [];
  for (const e of reference) {
    if (e.on_field !== true) continue;
    const label = e.mark ?? e.name ?? "";
    // — the SAME question axis A asks, owner agreement included. Left out, this axis reported
    // `DELPHI GENETICS` as "not-surfaced — cannot be scored on field" on the very run where axis A had
    // just matched it. One record, two axes, two answers is the defect this issue names, and the axis
    // that cannot see the finding is the one that decides whether its GOODS were routed correctly.
    const f = findings.find((x) => matchesReference(label, x.mark, { sameOwner: ownersMatch(e?.owner, x?.owner) }));
    if (!f) { rows.push({ mark: label, state: "not-surfaced", detail: "cannot be scored on field — see the recall buckets" }); continue; }
    const off = f.disposition === "off-field";
    const ruled = f.ruled_out === true;
    rows.push({
      mark: label, matched: f.mark,
      state: off ? "off-field" : ruled ? "ruled-out" : "on-field",
      detail: off ? `disposition=off-field` : ruled ? `ruled_out: ${f.ruled_out_reason ?? "no reason given"}` : `disposition=${f.disposition ?? "—"}`,
    });
  }
  return rows;
}

/**
 * Axis C — were the product's real channels searched?
 *
 * The reference names the channels a lawyer would expect for this vertical: a developer tool is cleared
 * on GitHub and Steam, not only on consumer storefronts. `searchedText` is every channel receipt the
 * caller could find in the run, concatenated. A channel absent from that text was not searched, and
 * that is a finding about the run, not about the scorer.
 */
export function scoreSources({ channels = [], searchedText = "" }) {
  const hay = String(searchedText).toLowerCase();
  return channels.map((c) => ({ channel: c, searched: hay.includes(String(c).toLowerCase()) }));
}

/**
 * The run's verdict, read from whichever lane's artifact holds it.
 *
 * `_driver/verdict.json` is a CLEARANCE-lane artifact. The knockout lane writes none — its verdict is
 * the worst band across the batch, stamped on status.json, with the per-mark ratings in
 * knockout-findings.json. Reading only the clearance path made every knockout run print
 * `verdict: (unreadable)`, and a blank on a line a reader skims is an absence dressed as
 * nothing-to-see. Same defect class as the wildcard assert this issue also fixes: a check written
 * against one lane's artifacts, pointed at a lane that does not write them.
 *
 * Three-valued, unchanged: `null` means the verdict could not be read, which is NOT "not clean". What
 * IS new is that a null now arrives with `why`, so the caller can print the reason instead of a blank,
 * and `source` names the artifact the answer came from so the read is attributable.
 *
 * Pure — the caller reads the files and hands over parsed documents.
 */
export function readVerdict({ verdictDoc = null, knockoutFindings = null, status = null } = {}) {
  const clean = (text) => /\b(clear|clean|no conflict|no material)\b/i.test(text);
  if (verdictDoc) {
    const text = [verdictDoc.tier, verdictDoc.verdict, verdictDoc.statement, verdictDoc.badge].filter(Boolean).join(" · ");
    if (text) return { clean: clean(text), text, source: "_driver/verdict.json", why: null };
  }
  const marks = Array.isArray(knockoutFindings?.marks) ? knockoutFindings.marks : [];
  if (marks.length) {
    // The band words the lane actually rated, per mark, plus the batch's worst. Deliberately NOT
    // hardcoded to "a knockout is never clean": that is a doctrine this scorer would be inventing, and
    // a knockout deliverable that DOES read as clear is a defect worth seeing rather than smoothing.
    const rows = marks
      .map((m) => [m.name, [m.rating, m.ratingQualifier ? `(${m.ratingQualifier})` : null].filter(Boolean).join(" ")].filter(Boolean).join(": "))
      .filter((s) => s.includes(":"));
    const text = [status?.verdict ? `worst band ${status.verdict}` : null, ...rows].filter(Boolean).join(" · ");
    if (text) return { clean: clean(text), text, source: "knockout-findings.json + status.json — this lane writes no _driver/verdict.json", why: null };
  }
  return { clean: null, text: null, source: null,
    why: verdictDoc
      ? "_driver/verdict.json carries no tier, verdict, statement or badge"
      : "neither lane's verdict artifact could be read — no _driver/verdict.json (clearance) and no rated marks in knockout-findings.json (knockout)" };
}

/**
 * Axis D — gap discipline. A declared coverage gap must be closed, or it must block a clean finding.
 *
 * The failure this measures is neither of those: declared, logged, and then reasoned past. So an open
 * gap sitting next to a clean verdict is reported as `open-and-clean` — the only combination the axis
 * exists to catch. A run that declared nothing reports `none-declared`, which is a fact about the run
 * and not a pass.
 */
export function scoreGapDiscipline({ gaps = [], verdictIsClean = null }) {
  if (!gaps.length) return { state: "none-declared", verdict_clean: verdictIsClean, rows: [] };
  const rows = gaps.map((g) => {
    const open = !["closed", "covered", "resolved", "cleared"].includes(String(g.status ?? "").toLowerCase());
    // Three states, not two. `verdictIsClean === null` means the verdict could not be read — and an
    // unread verdict must not be reported as "blocking", which is the reassuring reading of the pair.
    const state = !open ? "closed"
      : verdictIsClean === true ? "open-and-clean"
      : verdictIsClean === false ? "open-and-blocking"
      : "open-verdict-unread";
    return { item: g.item ?? g.slice ?? "(unnamed)", status: g.status ?? null, reason: g.reason ?? null, state };
  });
  return { state: "declared", verdict_clean: verdictIsClean, rows };
}

/**
 * Bucket membership between two rounds, by reference label. Movement is the whole point.
 *
 * KEYED ON THE LABEL, so it reports a movement ONCE per distinct label however many rows carry it. That
 * is pre-existing and it is what `noise` already does; `uncovered` joins the iteration
 * automatically and inherits exactly the same property, no better and no worse. On the first round after
 * lands, every finding of a mark the reference does not answer prints `noise → uncovered`. That is
 * the measuring instrument changing, not the engine — a round's noise count is not comparable across it.
 * Related and also pre-existing: `collisions` rows carry no `mark`/`name`, so they all key to "".
 */
export function bucketDelta(now, before) {
  if (!before) return null;
  const keyed = (b) => new Map(Object.entries(b)
    .flatMap(([name, rows]) => rows.map((r) => [String(r.mark ?? r.name ?? ""), name])));
  const a = keyed(before);
  const z = keyed(now);
  const moved = [];
  for (const [mark, to] of z) {
    const from = a.get(mark);
    if (from && from !== to) moved.push({ mark, from, to });
  }
  for (const [mark, from] of a) if (!z.has(mark)) moved.push({ mark, from, to: "absent-from-reference" });
  for (const [mark, to] of z) if (!a.has(mark)) moved.push({ mark, from: "new-in-reference", to });
  return moved.sort((x, y) => x.mark.localeCompare(y.mark));
}

// ── — AXIS E · PER-TERRITORY DEPTH ──────────────────────────────────────────────────────────────
//
// Depth 5 is "preliminary clearance with jurisdiction deep-dive", singular, and R1 spreads it across
// seven territories. Scored in aggregate, a lane that deep-dives one territory and sweeps the other six
// worldwide reports the same recall as one that deep-dived all seven. This axis is the fold that tells
// them apart, over buckets scoreRecall has already built.
//
// WHAT MAKES AN ENTRY A PER-JURISDICTION SUB-QUERY, and why the definition is the whole measurement.
// "Per-jurisdiction" is not "narrower than the scope". It is a query that names ONE territory and no
// other — the deep-dive. Both weaker rules fail on the same shape, in the same direction:
//
//   SET EQUALITY AGAINST THE SCOPE ("all-scope, therefore not a deep-dive") asks whether one entry names
//     EVERY instructed territory, and its negation is not the deep-dive. compileRegisterPlan stamps ONE
//     resolved `regions` array on every dictated entry (register-plan.mjs), and resolveRegions DROPS any
//     instructed jurisdiction the active provider does not cover — so on a seven-territory matter where
//     the provider covers six, the single worldwide sweep is not set-equal to the scope and would score
//     as a deep-dive for all six.
//   PROPER SUBSET fails on one worldwide sweep sent in region chunks — regions ['CN','RU','NZ','PH'] and
//     ['EM','GB','US'] are each a proper subset, and all seven territories would be credited with a
//     deep-dive apiece. Seven territories reporting the depth of one, which is the exact reading this
//     axis exists to prevent.
//
// So three shapes, and each row carries all three counts because reporting only the first would overstate
// the failure ("nothing reached RU"):
//
//   own          the entry's regions, folded and deduped, are exactly {T}. THE per-jurisdiction sub-query.
//   grouped      they name T alongside at least one other territory — the worldwide sweep and every chunk
//                of it. It reaches the territory; it does not deep-dive into it.
//   unrestricted no regions at all — the provider's absent-region clause, which reaches everything and
//                names nothing. Counted ONCE, globally, never attributed to a territory.
//
// The classification is computed on the entry's FULL folded region set, BEFORE the in-scope filter: an
// entry naming CN and JP on a CN-scoped run is not a CN deep-dive because JP is off this axis.
//
// A one-territory run credits every executed query as that territory's own, and that is truthful — each
// one named it and nothing else. There is no across-territories question on one territory, and
// concludeDepth answers `null` there rather than a yes or a no.
//
// THE OFFICE-VOCABULARY FOLD. A plan's regions are in the PROVIDER's office vocabulary — clarivate
// spells the EUIPO "EM" and the UK "GB" — while instructed scope says "EU" and "UK". Compared raw, two
// of seven territories report "no sub-query" on every run, forever, which is an absence manufactured by
// the scorer. `territoryKey` folds both sides through jurisdiction-codes.mjs, and the ROWS are keyed on
// the fold too: a scope that names both UK and GB is ONE territory, not two rows double-counting its
// reference entries and inflating the conclusion's denominator. `canonTerritory` is left exactly as it
// is: it feeds `inScope`, whose behaviour is not this issue's to change.

/**
 * The comparison key for one territory label: `canonTerritory`, then the office-alias fold (UK→GB,
 * EM/EUTM/EUIPO→EU). `null` for a portfolio-wide token, same as `canonTerritory` — INTL is deliberately
 * not a territory, so it can never be silently attributed to one.
 */
export function territoryKey(label) {
  const t = canonTerritory(label);
  if (!t) return null;
  return canonicalJurisdictionCode(t) || null;
}

const qidOf = (r) => (typeof r === "string" ? r : r?.qid);

/**
 * What the execution receipt says happened to ONE planned qid.
 *
 * The receipt is joinPlanToBands' own output, spread verbatim (pipeline.mjs writePlanExecutionReceipt),
 * and that join keeps THREE distinct non-executed outcomes on purpose. Collapsing them into
 * "planned-not-executed" sends a reader to hunt for a dispatch failure when the truth is a disclosed
 * capability gap:
 *
 *   executed   dispatched, with the band's own state. `incomplete` means the slice hit the provider's
 *              result ceiling and the band is NOT the whole answer (deriveCoverageSkeleton counts it as
 *              a crowd) — a deep-dive that ceilinged out is not a deep-dive that held.
 *   deferred   the active provider structurally cannot express this slice. Retrying is pointless; the
 *              gap is disclosed, and the reader's next stop is the coverage ledger, not the dispatcher.
 *   skipped    a when-guard's parent came back a crowd, so the child was never dispatched. A decision.
 *   missing    never dispatched, or a provider error wearing the incomplete shape.
 *
 * A receipt that carries none of those three arrays (an older or trimmed one) yields `unclassified`,
 * which says the receipt does not state which — never one of the three by guess. PURE.
 */
export function receiptOutcome(qid, execution) {
  const ex = (Array.isArray(execution?.executed) ? execution.executed : []).find((e) => qidOf(e) === qid);
  if (ex) return { outcome: "executed", state: typeof ex === "string" ? "" : String(ex.state ?? "").toLowerCase(), detail: null };
  for (const k of ["deferred", "skipped", "missing"]) {
    const row = (Array.isArray(execution?.[k]) ? execution[k] : []).find((r) => qidOf(r) === qid);
    if (row) return { outcome: k, state: null, detail: typeof row === "string" ? null : (row.reason ?? row.guard ?? null) };
  }
  const classifies = ["deferred", "skipped", "missing"].some((k) => Array.isArray(execution?.[k]));
  return { outcome: "unclassified", state: null, detail: classifies
    ? "the receipt lists this entry in none of its executed / deferred / skipped / missing arrays — it is older than this plan version"
    : "the receipt carries only `executed`, so which of deferred / skipped / missing this was cannot be established" };
}

/**
 * Fold the frozen plan × the execution receipt into per-territory sub-query facts. PURE — the caller
 * reads the files.
 *
 * UNRESOLVABLE IS ITS OWN ANSWER, AND IT IS NOT "NONE". A pool dir has no `_driver/`, so it has no plan
 * and no receipt — and a row printing `own 0` there would say the engine issued no sub-query when the
 * truth is that the scorer could not look. Two absences, two different artifacts to go and check.
 *
 * An EMPTY `executed[]` is unresolvable on the same rule, and the sibling join in the codebase already
 * applies it: searchedJurisdictionsFromPlan (register-plan.mjs) returns `resolved:false` for exactly
 * this input. A run that died before dispatch writes a receipt with an empty list, and turning that into
 * "no territory got a sub-query" states an engine finding drawn from a crash — on the most expensive
 * scenario in the suite, which is the one nobody re-runs casually to check.
 */
export function planSubQueries({ plan = null, execution = null, scopeTerritories = [] } = {}) {
  const scopeKeys = [...new Set((scopeTerritories ?? []).map(territoryKey).filter(Boolean))];
  // The plan's OWN disclosure of the territories the active provider does not cover (resolveRegions'
  // deferred rows). A territory absent from every entry's regions reads as `not-in-plan`, and without
  // this the reader goes looking for a plan bug when the plan already said the provider cannot reach it.
  const notCovered = {};
  for (const d of Array.isArray(plan?.deferred_coverage) ? plan.deferred_coverage : []) {
    const k = territoryKey(d?.jurisdiction);
    if (k && !notCovered[k]) notCovered[k] = String(d?.reason ?? "").slice(0, 300) || "the frozen plan records this jurisdiction as deferred coverage";
  }
  // `sweep.state: null` on every unresolved path, deliberately: an absent sweep must read as COULD NOT
  // LOOK, never as `enumerated`. Defaulting it the other way would turn a plan nobody could read into a
  // confident "no narrow was owed", which is the shape this whole axis exists to refuse.
  const blank = { resolved: false, why: null, scopeKeys, notCovered, unrestricted: { planned: 0, executed: 0 }, byTerritory: {},
    sweep: { state: null, qid: null, seen: 0 } };
  const entries = Array.isArray(plan?.entries) ? plan.entries : null;
  if (!entries?.length) return { ...blank, why: "no _driver/register-plan.json entries — the frozen plan could not be read" };
  const execRows = Array.isArray(execution?.executed) ? execution.executed : null;
  if (!execRows) return { ...blank, why: "no _driver/plan-execution.json — which planned queries actually ran cannot be established" };
  if (!execRows.length) return { ...blank, why: "_driver/plan-execution.json lists no executed query — the run recorded no dispatch at all, which is a receipt to explain and not a measurement of depth" };

  const byTerritory = {};
  const slot = () => ({
    own: { planned: 0, executed: 0, enumerated: 0, incomplete: 0, queries: [], qids: [], terms: [] },
    grouped: { planned: 0, executed: 0 },
    notExecuted: { deferred: 0, skipped: 0, missing: 0, unclassified: 0 },
    named: false,
  });
  for (const k of scopeKeys) byTerritory[k] = slot();
  const unrestricted = { planned: 0, executed: 0 };
  // ── THE IN-SCOPE SWEEP'S OWN STATE — what decides whether a narrow was OWED at all ───────────────
  //
  // `subQueryState` returns `none` for a territory with no entry of its own, and that one value covers
  // two opposite situations. The doctrine (`skills/prelim-register/SKILL.md`, Recipe 1 §2b) says a slice
  // gets its own `register_enumerate` ONLY on the guarded crowd-narrow path — when Step 2, the
  // region-scoped in-scope sweep, returned `incomplete` and a major may sit in the un-paged remainder.
  // When Step 2 returns `enumerated` the complete set provably contains every in-scope slice and the
  // per-major queries are taken from it machine-side; a narrow there is redundant, not missing.
  //
  // So `none` alone reported both "correctly not narrowed" and "owed and nobody went", and the depth
  // conclusion named the territory as lacking depth either way. On both preserved R2 runs Step 2 read
  // `records == total_hits == 14`, so every `none` was the redundant kind — and the axis reported a
  // shortfall that was not one.
  //
  // STEP 2 IS THE `default` PREDICATE, NOT ANY BROAD QUERY. `PLAN_PREDICATES` distinguishes
  // "default" — the contains-style substring band Recipe 1 Step 2 dictates — from "wildcard"
  // (a `name:"<x> *"` pattern), "exact", "phonetic" and "owner". A wildcard band that ceilings out is a
  // real question and it is a JUDGMENT one; it does not open this mechanical path. Keying on the
  // predicate rather than on "a broad query that came back incomplete" is the whole difference between
  // the two, and reading the qid text instead would collapse them.
  //
  // Scope-covering only: an entry naming ONE territory is a narrow itself, not the sweep it answers to.
  //
  // ── AND THE PREDICATE ALONE SELECTS THE WRONG ENTRY ON EVERY REAL PLAN ──────
  //
  // The predicate is a filter. It was also, until this change, the KEY — "the FIRST scope-covering
  // `default` entry is Step 2" — and three axes mint `predicate: "default"` entries, so the first one
  // in plan order is decided by the plan's sort, not by what the entry asks.
  //
  // `compileRegisterPlan` sorts by `axisRank` over `REGISTER_AXES` (register-plan.mjs), and
  // `saturation-probe` is index 0. Every common or saturated-common element mints a
  // `saturation-probe:default:<element>` entry that inherits the plan's full region list — scope-
  // covering — and sorts ahead of everything on `primary-sweep`. So on any plan whose manifest names
  // one common element, the entry this fold selected was a saturation probe.
  //
  // That is not a near miss. `scope-facts.mjs` states the consequence in its own F2 doctrine block:
  // an `expected_kind: "count"` descriptor "enumerates nothing by construction, so its band state is
  // `incomplete` on every run that ever takes it". A probe is a `limit:1` count descriptor. So the
  // fold read `incomplete`, set `owed`, and every territory with no narrow of its own became
  // `owedAndAbsent` — the fix that split `none` in two reporting the defect it was built to stop.
  //
  // Measured on the one preserved R2 round (the tracker issue names it), plan of 100 entries:
  //   [1]  saturation-probe:default:bio        count      incomplete   ← selected
  //   [25] primary-sweep:default:<dominant element>  enumerate  enumerated   ← Step 2
  // and the conclusion read DOES NOT HOLD with `owedAndAbsent: ["CH","EU","US"]` over a run whose
  // Step 2 enumerated to completion, 14 of 14.
  //
  // THE ERROR IS ONE-DIRECTIONAL, AND THAT DECIDES WHICH OLD SCORES A READER MUST GO BACK TO.
  // `saturation-probe` is the ONLY axis that sorts before `primary-sweep`: `transliteration-numeric`
  // and `incumbent-class` sort after it, so neither can preempt Step 2 however many scope-covering
  // defaults they carry — 17 of them on the measured plan, every one `enumerated`, none of them ever
  // selected. And a probe cannot be the other kind of wrong, because it cannot enumerate. A probe that
  // was planned but NOT executed does not lock the fold either: its state is null, so the `state ===
  // null` test below falls through to the next candidate, which is Step 2.
  //
  // So the wrong entry was always a probe and it always read `incomplete`. The old fold could report a
  // shortfall that was not there; it could not hide one that was. **Every pre-fix `holds: false` on a
  // plan carrying a common element is suspect. Every pre-fix `holds: true` stands.**
  //
  // SO THE AXIS IS THE KEY AND THE PREDICATE STAYS A FILTER. Recipe 1 Step 2 is the dominant-element
  // contains slice on `primary-sweep`, and the compiler designates that entry structurally rather
  // than by name: it is `parentQid`, the crowd-gate parent the wildcard fringe hangs its
  // `when: { runs_if_enumerated }` guard on (register-plan.mjs). It is pushed unconditionally, so
  // every freshly compiled plan carries exactly one.
  //
  // FIRST-OF-AXIS IS NOT SELF-EVIDENT, AND IT IS NOT THE AXIS THAT MAKES IT SAFE. Two things do, and
  // both are worth checking rather than taking on this comment's word:
  //   · the compiler mints no OTHER `default` on this axis — `markPredicate` returns "exact" or
  //     "wildcard" and nothing else, so the mark and every variant are screened out by the predicate;
  //   · everything minted later APPENDS behind it. `foldSupplementalEntries` (register-plan.mjs)
  //     returns `entries: [...plan.entries, ...added]` — a strict append, never a splice and never a
  //     re-sort — and both the supplemental lane and the cross-check lane arrive through it.
  //
  // The second is load-bearing, not bookkeeping. `pipeline.mjs`'s cross-check lane mints
  // `{ axis: "primary-sweep", predicate: s.owner ? "owner" : "default", regions: [] }`, and a
  // non-owner row there is a scope-covering `primary-sweep` `default` — structurally indistinguishable
  // from Step 2 under this filter. Eight of them sit at [74]-[81] on the measured plan, behind Step 2
  // at [25], and they are behind it BECAUSE of that append, not because of anything the filter can
  // see. Should a path ever re-order the entry list, first-of-axis stops naming Step 2 and this fold
  // needs the compiler's own designation — `parentQid`, carried into the plan — rather than a rule
  // re-derived here.
  //
  // `e.axis`, NOT THE QID PREFIX. A supplemental qid is `supp:<axis>:<predicate>:<slug>:<fp8>`, so its
  // prefix is `supp` — and that round carries two of them on this axis. The field is the axis; the
  // qid is a name that usually starts with it. `register_plan_axis_invalid` already refuses an entry
  // whose axis is not one of the four, so the field is validated at the plan's door.
  //
  // AN AXIS-LESS PLAN FALLS BACK TO "GOT NONE", WHICH IS WHERE THIS AXIS STARTED. A frozen plan
  // predating the field selects nothing, `seen` stays 0, and concludeDepth takes the unclassified
  // branch — the pre-discriminator answer, unchanged. That is a downgrade only if an answer read off
  // the wrong entry counts as an answer.
  //
  // `expected_kind` is deliberately NOT a second filter. It is the corroborating property (a probe
  // counts, a sweep enumerates), and two overlapping keys have no defined winner where they diverge.
  const STEP_2_AXIS = "primary-sweep";
  // `seen` counts within the selected axis: it answers "how many in-scope sweeps were planned", and
  // pooling three axes made it answer nothing. On that round's plan it reads 11 rather than 36.
  const sweep = { state: null, qid: null, seen: 0 };
  // THE COMPILER'S OWN DESIGNATION WINS OVER POSITION —. Held separately and
  // applied after the walk, so the first-of-axis rule below stays exactly as it was for a frozen
  // plan that predates the stamp. Same fallback shape as the axis field above: a plan without it
  // gets the answer it got before the field existed, never a different one.
  const designated = { state: null, qid: null, found: false };

  for (const e of entries) {
    const out = receiptOutcome(e?.qid, execution);
    const ran = out.outcome === "executed";
    // Fold and dedupe FIRST, then classify, then attribute. Classifying after the in-scope filter is how
    // an entry naming CN and JP would read as a CN-only deep-dive on a CN-scoped run.
    const regs = [...new Set((Array.isArray(e?.regions) ? e.regions : []).map(territoryKey).filter(Boolean))];
    const isOwn = regs.length === 1;
    // Recorded BEFORE the unrestricted early-return below, because the provider's absent-region clause
    // (no regions at all) is scope-covering too — it reaches everything and names nothing — and the
    // first cut missed it there, which would have read a worldwide sweep as "no Step 2 found".
    if (String(e?.axis ?? "") === STEP_2_AXIS && String(e?.predicate ?? "") === "default" && !isOwn) {
      sweep.seen++;
      // The FIRST scope-covering default entry ON THIS AXIS is Step 2. A later one is a re-dispatch, a
      // cross-check probe or a supplemental band; `seen` is carried so a reader can tell a single sweep
      // from several rather than being told a number that quietly folded them.
      if (sweep.state === null) { sweep.state = out.state || (ran ? "" : null); sweep.qid = e.qid ?? null; }
      // …and if the compiler stamped this entry, it IS Step 2 whatever its position.
      if (e?.crowd_gate_parent === true && !designated.found) {
        designated.found = true; designated.state = out.state || (ran ? "" : null); designated.qid = e.qid ?? null;
      }
    }
    if (!regs.length) { unrestricted.planned++; if (ran) unrestricted.executed++; continue; }
    for (const k of regs) {
      if (!byTerritory[k]) continue;                       // a region outside the instructed scope: not this axis's row
      const t = byTerritory[k];
      t.named = true;
      if (!isOwn) { t.grouped.planned++; if (ran) t.grouped.executed++; continue; }
      t.own.planned++;
      t.own.queries.push({ qid: e.qid ?? null, term: e.term ?? (Array.isArray(e.terms) ? e.terms[0] : null), axis: e.axis ?? null,
        outcome: out.outcome, state: out.state, detail: out.detail });
      if (!ran) { t.notExecuted[out.outcome === "unclassified" ? "unclassified" : out.outcome]++; continue; }
      t.own.executed++;
      if (out.state === "enumerated") t.own.enumerated++;
      else if (out.state === "incomplete") t.own.incomplete++;
      if (e?.qid) t.own.qids.push(e.qid);
      if (e?.term && !t.own.terms.includes(e.term)) t.own.terms.push(e.term);
    }
  }
  // THE DESIGNATION IS APPLIED HERE, NOT INSIDE THE WALK —. Overwriting mid-walk
  // would make the result depend on which entry the loop reached first, which is the property this
  // change exists to remove. `seen` is untouched: it counts scope-covering sweeps on the axis and
  // that question has not changed.
  if (designated.found) { sweep.state = designated.state; sweep.qid = designated.qid; }
  return { resolved: true, why: null, scopeKeys, notCovered, unrestricted, byTerritory, sweep };
}

/**
 * The state of one territory's sub-query, from that territory's fold. NINE values, and every one of them
 * sends the reader somewhere different — which is the point: `none` and `unresolved` and `deferred` all
 * print as an empty column under a collapsed vocabulary, and they mean the engine chose not to, the
 * scorer could not look, and the provider cannot express it.
 */
function subQueryState(t, resolved) {
  if (!resolved) return "unresolved";
  if (!t.named) return "not-in-plan";                            // no entry's regions name this territory at all
  if (!t.own.planned) return "none";                             // reached only by grouped/unrestricted queries
  if (t.own.enumerated > 0) return "issued";
  if (t.own.incomplete > 0) return "issued-ceilinged";           // ran, and came back over the provider's ceiling
  if (t.own.executed > 0) return "issued-state-unstated";
  for (const k of ["deferred", "skipped", "missing"]) if (t.notExecuted[k] > 0) return k;
  return "planned-not-executed";
}

/** Which recall bucket a reference entry landed in — by label, over the buckets scoreRecall returned. */
function bucketOfEntry(buckets, label) {
  for (const name of ["found", "withheld", "lost", "excluded"]) {
    if ((buckets?.[name] ?? []).some((r) => String(r.mark ?? r.name ?? "") === String(label))) return name;
  }
  return null;
}

/**
 * Axis E — per territory: was a jurisdiction sub-query issued, what did it return, and which of the
 * reference's entries for that territory were found, withheld or lost.
 *
 * WHAT IT RETURNED is answered twice, because the two halves fail separately. `own.queries` carries each
 * sub-query's own outcome and band state off the receipt; `returned` counts the retrieved RECORDS whose
 * `_qid`/`_qids` provenance names one of those sub-queries. A record count with no state would hide a
 * ceilinged slice; a state with no record count would not say what came back.
 *
 * TWO ZERO STATES, AND NEITHER IS A PERCENTAGE. This is the absence-reads-as-a-pass shape the issue
 * names, and it has two halves that point at two different artifacts:
 *
 *   no-reference-entries   the territory carries nothing to score. NOT 0% (which reads as total
 *                          failure) and NOT 100% (which reads as a clean sweep). A fact about the
 *                          REFERENCE — go and look at the gold set.
 *   sub-query `unresolved` the plan or the execution receipt could not be read. A fact about the RUN
 *                          DIR — go and look for `_driver/`. Distinct from `none`, which is a real
 *                          answer meaning the engine issued no narrowed query for this territory.
 *
 * PORTFOLIO-WIDE ENTRIES ARE THEIR OWN ROW. R1's reference says `intl` entries "stay in scope — they
 * are reachable from any of the seven". Reachable from any is not attributable to one: counting them
 * under all seven would inflate every territory's denominator by the same three entries and make a
 * territory carrying nothing look like a territory carrying three.
 */
export function scoreTerritories({ buckets = {}, scopeTerritories = [], retrieved = [], plan = null, execution = null } = {}) {
  const instructed = (scopeTerritories ?? []).map(String).filter(Boolean);
  const subq = planSubQueries({ plan, execution, scopeTerritories: instructed });

  // ONE ROW PER TERRITORY, not per instructed label. A scope naming UK and GB (or EU and EM) names one
  // office twice; two rows would count its reference entries twice and make the conclusion say "across
  // all 4 instructed territories" about two.
  const labelsByKey = new Map();
  for (const t of instructed) {
    const k = territoryKey(t);
    if (!k) continue;
    if (!labelsByKey.has(k)) labelsByKey.set(k, []);
    if (!labelsByKey.get(k).includes(t)) labelsByKey.get(k).push(t);
  }

  // Attribute every bucketed reference entry to the instructed territories it names.
  const emptyRows = () => ({ found: [], withheld: [], lost: [], excluded: [] });
  const perKey = new Map([...labelsByKey.keys()].map((k) => [k, emptyRows()]));
  const portfolioWide = emptyRows();
  const outsideScope = [];

  for (const name of ["found", "withheld", "lost", "excluded"]) {
    for (const r of buckets?.[name] ?? []) {
      const keys = [...new Set((r.jurisdictions ?? []).map(territoryKey).filter(Boolean))];
      const inScopeKeys = keys.filter((k) => perKey.has(k));
      if (!keys.length) { portfolioWide[name].push(r); continue; }          // intl / worldwide only
      if (!inScopeKeys.length) { outsideScope.push({ ...r, bucket: name }); continue; }
      for (const k of inScopeKeys) perKey.get(k)[name].push(r);
    }
  }

  // Records carry the qid(s) of the slice(s) that surfaced them (named-band.mjs recordQids), so what a
  // sub-query RETURNED is a join, not an estimate. A corpus carrying no provenance at all is an
  // absence with its own reason — never a zero, which would read as a sub-query that came back empty.
  const anyProvenance = (retrieved ?? []).some((r) => (r?.qids ?? []).length);

  const rows = [];
  for (const [key, labels] of labelsByKey) {
    const e = perKey.get(key);
    const scored = e.found.length + e.withheld.length + e.lost.length;
    const t = subq.byTerritory[key] ?? {
      own: { planned: 0, executed: 0, enumerated: 0, incomplete: 0, queries: [], qids: [], terms: [] },
      grouped: { planned: 0, executed: 0 }, notExecuted: { deferred: 0, skipped: 0, missing: 0, unclassified: 0 }, named: false,
    };
    const subQuery = subQueryState(t, subq.resolved);
    const returned = !subq.resolved || !t.own.executed ? null
      : !anyProvenance ? { records: null, why: "the retrieved records carry no `_qid` provenance, so what this sub-query returned cannot be attributed to it" }
      : { records: (retrieved ?? []).filter((r) => (r?.qids ?? []).some((q) => t.own.qids.includes(q))).length, why: null };
    rows.push({
      territory: labels[0], key, instructedAs: labels, subQuery,
      // Only on `not-in-plan`, and only when the plan said so itself — never a guess about why a
      // territory is missing from every entry's regions.
      notCoveredReason: subQuery === "not-in-plan" ? (subq.notCovered?.[key] ?? null) : null,
      own: t.own, grouped: t.grouped, notExecuted: t.notExecuted, returned,
      entries: e, scored,
      // A fraction, never a percentage, and null when there is nothing to divide. `n/0` and `0%` and
      // `100%` are all conclusions about a territory whose reference carries no entry to score.
      recall: scored ? `${e.found.length}/${scored}` : null,
      state: scored ? "scored" : "no-reference-entries",
    });
  }

  const pScored = portfolioWide.found.length + portfolioWide.withheld.length + portfolioWide.lost.length;
  // `subq.sweep?.state` and not `subq.sweep.state`: an older caller, or a `blank` from a path added
  // later, must degrade to "could not look" rather than throwing inside a scorer.
  const conclusion = concludeDepth({ instructed: rows.map((r) => r.territory), rows, resolved: subq.resolved, why: subq.why,
    sweepState: subq.sweep?.state ?? null, sweepSeen: subq.sweep?.seen ?? 0 });
  return {
    rows, conclusion,
    subQueriesResolved: subq.resolved,
    why: subq.why,
    unrestricted: subq.unrestricted,
    portfolioWide: {
      entries: portfolioWide, scored: pScored,
      recall: pScored ? `${portfolioWide.found.length}/${pScored}` : null,
      state: pScored ? "scored" : "no-reference-entries",
      note: "portfolio-wide (intl) entries — reachable from any territory, attributable to none, so never counted in a territory row",
    },
    outsideScope,
  };
}

/**
 * The one-sentence conclusion the acceptance asks for. Three-valued and MECHANICAL: it states which
 * instructed territories got their own jurisdiction sub-query, which got one that came back over the
 * provider's result ceiling, and which got none. Nothing else.
 *
 * A CEILINGED SUB-QUERY IS NOT DEPTH HOLDING. `incomplete` is the provider's word for "your slice is over
 * my result ceiling"; the band is a descriptor of a crowd, not the whole answer. Folding it into `issued`
 * would let a deep-dive that ceilinged out on every territory print HOLDS — the same overstatement as
 * counting the worldwide sweep, one layer down.
 *
 * It is not a PASS and does not become one. The harness still prints no verdict on whether the run was
 * any good — "CN and EU got one, RU/NZ/PH/UK/US did not" is a reading of the plan, the same kind of fact
 * as a bucket count. What it deliberately does NOT do is substitute a softer standard: the reference
 * expects sub-queries for four named territories, but the question asked is across SEVEN, so the
 * sentence names every territory that got none and lets the reader weigh it against the reference.
 *
 * `null` — not "no" — when the run was instructed fewer than two TERRITORIES (labels are folded first, so
 * a scope naming UK and GB is one), or when the plan could not be read (the scorer could not look).
 */
export function concludeDepth({ instructed = [], rows = [], resolved = true, why = null, sweepState = null, sweepSeen = 0 } = {}) {
  const labels = (instructed ?? []).filter(Boolean);
  const keys = [...new Set(labels.map(territoryKey).filter(Boolean))];
  const n = keys.length;
  // A label that folds to no territory is not a territory. Counting the LABELS when the fold refuses
  // them all is how `["intl","worldwide"]` with zero rows printed HOLDS across two — a confident
  // positive over nothing, which is the class this whole axis exists to stop.
  if (!n) return { holds: null, without: [], with: [], ceilinged: [], notOwed: [], owedAndAbsent: [],
    sentence: labels.length
      ? `Not applicable — none of the ${labels.length} instructed label${labels.length === 1 ? "" : "s"} (${labels.join(", ")}) names a territory this axis can compare; a portfolio-wide token is not a territory.`
      : `Not applicable — the run was instructed no territories, so there is no across-territories depth question to answer.` };
  if (n < 2) return { holds: null, without: [], with: [], ceilinged: [], notOwed: [], owedAndAbsent: [],
    sentence: `Not applicable — the run was instructed ${n} territor${n === 1 ? "y" : "ies"}, so there is no across-territories depth question to answer.` };
  if (!resolved) return { holds: null, without: [], with: [], ceilinged: [], notOwed: [], owedAndAbsent: [],
    sentence: `Depth across ${n} territories COULD NOT BE MEASURED — ${why ?? "the frozen plan and the execution receipt could not be read"}. That is an absence, not a "no".` };
  // The rows must actually cover the territories being concluded about. A territory with no row has no
  // answer, and a sentence about "all N" built from fewer than N rows is a claim about the missing ones.
  const covered = new Set(rows.map((r) => territoryKey(r.territory)).filter((k) => keys.includes(k))).size;
  if (covered < n) return { holds: null, without: [], with: [], ceilinged: [], notOwed: [], owedAndAbsent: [],
    sentence: `Depth across ${n} territories COULD NOT BE MEASURED — rows were supplied for ${covered} of them, so the rest have no answer here rather than a "no".` };
  const withq = rows.filter((r) => r.subQuery === "issued").map((r) => r.territory);
  const ceilinged = rows.filter((r) => r.subQuery === "issued-ceilinged" || r.subQuery === "issued-state-unstated").map((r) => r.territory);
  const without = rows.filter((r) => !["issued", "issued-ceilinged", "issued-state-unstated"].includes(r.subQuery)).map((r) => r.territory);
  // ── WAS A NARROW OWED AT ALL? `none` COVERED TWO OPPOSITE ANSWERS ────────────────────────────────
  //
  // Doctrine, Recipe 1 §2b: when Step 2 — the region-scoped in-scope sweep — returns `enumerated`, the
  // complete set PROVABLY CONTAINS every in-scope slice, so the per-major slices are taken from it
  // machine-side and a per-jurisdiction `register_enumerate` is redundant. A narrow is owed ONLY where
  // Step 2 came back `incomplete` and a major may sit in the un-paged remainder.
  //
  // Until now this function could not tell those apart: both printed as "got none" and both drove
  // DOES NOT HOLD. On both preserved R2 runs Step 2 read `records == total_hits == 14`, so every "got
  // none" was the redundant kind and the axis reported a shortfall that did not exist — which is what
  // made a gold assertion read as unmet against an engine doing exactly what the doctrine says.
  //
  // THREE-VALUED, LIKE EVERY OTHER ANSWER IN THIS FILE. An unknown sweep state is `null` — could not be
  // measured — never a confident "nothing was owed". Defaulting an absent state to "complete" would
  // manufacture a pass out of a plan nobody could read, which is the exact shape this axis exists to
  // refuse.
  // NO STEP 2 IN THE PLAN IS NOT AN UNREADABLE STEP 2, and conflating them cost five green arms on the
  // first cut. A plan with no scope-covering `default` entry — every fixture in this suite that predates
  // the predicate, and any recipe that does not use one — has nothing for this discriminator to read,
  // and turning that into "could not be measured" would take answers that WERE decisive and make them
  // unknown. A new discriminator must never downgrade an existing answer because its own input is
  // absent; it may only add.
  //
  // So: found-and-unreadable is unknown; not-found is the previous behaviour, unchanged.
  const sweepFound = Number(sweepSeen) > 0;
  const owedUnknown = sweepFound && sweepState == null;
  const owed = sweepState === "incomplete";
  const owedAndAbsent = owed ? without : [];
  const notOwed = sweepFound && sweepState === "enumerated" ? without : [];
  const unclassified = without.filter((t) => !owedAndAbsent.includes(t) && !notOwed.includes(t));
  if (owedUnknown && without.length) return { holds: null, with: withq, without, ceilinged, notOwed, owedAndAbsent,
    sentence: `Depth across ${n} territories COULD NOT BE MEASURED — ${without.length} territor${without.length === 1 ? "y" : "ies"} got no sub-query of their own and the in-scope sweep's own state could not be read, so whether one was OWED is unknown. That is an absence, not a "no".` };
  if (notOwed.length && !ceilinged.length && !withq.length) return { holds: true, with: withq, without, ceilinged, notOwed, owedAndAbsent,
    sentence: `Deep-dive depth HOLDS across all ${n} instructed territories WITHOUT a per-jurisdiction sub-query, and that is the doctrine rather than a shortfall: the in-scope sweep enumerated to completion, so the complete set contains every in-scope slice and the per-major slices are taken from it machine-side (Recipe 1 §2b). A narrow is owed only over an INCOMPLETE sweep.` };
  if (!without.length && !ceilinged.length) return { holds: true, with: withq, without, ceilinged, notOwed, owedAndAbsent,
    sentence: `Deep-dive depth HOLDS across all ${n} instructed territories: each got at least one executed sub-query that names it and not the whole scope, and that enumerated to completion.` };
  const clauses = [
    `${withq.length ? withq.join(", ") : "none"} got an executed jurisdiction sub-query that enumerated`,
    ...(ceilinged.length ? [`${ceilinged.join(", ")} got one that did not enumerate — over the provider's result ceiling, so its band is not the whole answer`] : []),
    // The two halves of "got none" are named separately, because they ask the reader for different
    // things: one is a gap to chase, the other is the doctrine and needs nothing.
    ...(owedAndAbsent.length ? [`${owedAndAbsent.join(", ")} got none AND ONE WAS OWED — the in-scope sweep came back incomplete, so a major may sit in the un-paged remainder and nothing went to look`] : []),
    ...(notOwed.length ? [`${notOwed.join(", ")} got none and none was owed — the in-scope sweep enumerated to completion, so their slices are contained in it`] : []),
    // THE UNCLASSIFIED REMAINDER, and forgetting it cost two green arms. Replacing the old "got none"
    // clause with the two above dropped every territory the discriminator could not classify — a plan
    // with no scope-covering `default` entry has neither an owed nor a not-owed answer, and the sentence
    // then named nobody at all. The new clauses ADD to the old one; they do not replace it.
    ...(unclassified.length ? [`${unclassified.join(", ")} got none`] : []),
  ];
  return { holds: false, with: withq, without, ceilinged, notOwed, owedAndAbsent,
    sentence: `Deep-dive depth DOES NOT HOLD across all ${n} instructed territories: ${clauses.join("; ")}.`,
  };
}

// ── — THE SCRIPT-LANE TARGET ────────────────────────────────────────────────────────────────────
//
// R1 is named for one finding: a Chinese registration that shares no Latin substring with the mark, so
// no Latin-variant sweep reaches it and the jx lane has to generate it. That line gets reported on its
// own because it is the single entry proving the lane worked.
//
// IT IS DERIVED, NOT HARDCODED, and that is the point. An acceptance keyed on a literal character was
// written against a bad transcription of an image-only PDF — the wrong Chinese word where the source
// says another — and a scorer line built on it would have printed "not generated" on every run forever,
// been correct every time, and looked exactly like the lane failing on the one finding the scenario
// exists to prove.
//
// THE SELECTOR IS A SCRIPT SEGMENT, NOT AN EMPTY ALIAS LIST. The first cut selected entries whose
// `labelAliases` came back empty, which is the same property one step too coarse: the gold set is
// lawyer-maintained prose, and `色度 / SEDU`, `色度 (SEDU)` and `色度 SEDU` all fold to the single alias
// `sedu`. The target would drop out of the selection and the line would then print a CONFIDENT FALSE
// claim — "the reference names no register entry outside the Latin script". was itself an edit to
// that mark string, so an annotation arriving there is not hypothetical. `scriptSegments` reads the
// property directly: a run of letters outside the Latin script, which no Latin-variant sweep can reach
// whatever else the lawyer wrote beside it.

/**
 * The non-Latin letter runs inside a label — the part of a mark no Latin-variant sweep can reach.
 *
 * Common and Inherited are excluded from the run and every run must contain a real LETTER, so an
 * accented Latin mark in NFD (`CAFE` + U+0301, whose combining mark is Inherited) is not a script
 * segment, and neither is punctuation, a device note or a digit. `CHROMA / & Device` yields nothing;
 * `色度 / SEDU` yields the segment the jx lane has to generate. PURE.
 */
export function scriptSegments(label) {
  const runs = String(label ?? "").match(/(?:(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{M}])+/gu) ?? [];
  return [...new Set(runs.map((r) => r.trim()).filter((r) => r && /\p{L}/u.test(r)))];
}

/**
 * AND IT NAMES THE OWNER, NOT ONLY THE TOKEN. "the term was generated" is satisfied by any proprietor's
 * record of the same characters, while the finding the scenario is named for belongs to one named
 * company. A line that cannot tell those apart proves nothing about the lane, so `owner` is its own
 * three-valued state and a `differs` prints both sides rather than resolving to a pass.
 *
 * Owner tokens for comparison: the label rules, corporate noise already dropped, order-insensitive.
 */
/**
 * CORPORATE LEGAL FORMS, DROPPED FROM AN OWNER KEY ONLY —.
 *
 * `NOISE_TOKENS` covers US, UK and German forms and almost nothing else, so `BePharBel Manufacturing`
 * and `BePharBel Manufacturing, Société anonyme` read as two companies. Measured: of twenty common forms
 * appended to an otherwise identical name, NINETEEN broke the match — only `S.A.` survived, and only
 * because `sa` happens to be on that list.
 *
 * DECLARED, NOT DERIVED, AND THE DISTINCTION IS THE POINT. The register corpus can say which forms OCCUR
 * — that is what the coverage arm measures — but it cannot say which trailing tokens ARE forms. Ranked by
 * recurrence across distinct names, the R2 band puts `b v` (15 names) next to `philadelphia` (5) and
 * `mind` (5): one is a legal form, the others are words companies are named after. Stripping those would
 * make genuinely different companies match, which is the failure the strict comparison exists to prevent.
 * So the category is a judgement, made once, here — and measured against the corpus rather than by it.
 *
 * OWNERS ONLY. `labelTokens` also builds MARK aliases and the containment run; a mark called `S.A.` is a
 * mark, and collapsing its dots or dropping it as noise would be a different defect.
 */
export const OWNER_LEGAL_FORMS = new Set([
  // present in the register corpus this engine reads
  "bv", "nv", "srl", "sl", "sa", "sarl", "se", "oy", "oyj", "ab", "spa",
  // widely carried by the registers this engine searches, declared before they bite
  "sas", "plc", "kg", "as", "aps", "pty", "llp", "ooo", "pc", "pa", "kk",
  "sprl", "ehf", "snc", "scs", "sca", "kft", "doo", "dd", "gie", "cv", "vof", "kabushiki", "kaisha",
  // `sp. z o.o.` — present in the corpus as the bare tail `o.o.`. `oo` and `spzoo`, never `zoo`: three
  // characters is a word a company can be named after, and the join only ever forms from trailing tokens
  // of two characters or fewer, so the risky spelling is unreachable by construction.
  "oo", "spzoo",
  // spelled-out forms — the case that started this
  "societe", "société", "anonyme", "anonima", "anonyma", "aktiengesellschaft", "aktiebolag",
  "aktieselskab", "naamloze", "vennootschap", "besloten", "sociedad", "limitada", "srls",
]);

/**
 * `B.V.` and `BV` are one form, not two —. Splitting on dots turns a dotted
 * abbreviation into single letters, so `B.V.`, `S.A.` and `S.r.l.` arrived as `b`,`v` / `s`,`a` /
 * `s`,`r`,`l` and matched nothing. That is one tokenising bug behind a good share of the nineteen broken
 * forms, not nineteen separate gaps. PURE.
 */
export function collapseDottedAbbreviations(s) {
  return String(s ?? "").replace(/\b(?:[\p{L}]\.\s*){2,}/gu, (m) => m.replace(/[.\s]/g, "") + " ");
}

/** Accents folded for the FORM comparison only — `sàrl` and `sarl` are one form. The owner's own name
 *  keeps its accents; only the legal-form lookup is folded. PURE. */
const deaccent = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * Drop the declared legal forms, INCLUDING the ones a separator split into pieces —.
 *
 * `A/S` and `S.à r.l.` survive the dot-collapse as `a`+`s` and `s`+`rl`, because the separator was a slash
 * in one and a bare accented letter in the other. Rather than grow a regex per separator, adjacent SHORT
 * tokens are joined and the join is offered to the declared list. The list decides, so a new separator
 * shape costs nothing and a new form is one entry.
 *
 * THE TRAILING RUN FIRST, then the singles, and the order cost an attempt to learn: `S.à r.l.` normalises
 * to `sa` + `rl`, and dropping singles first removed `sa` as a form in its own right and left `rl` alone,
 * which is not one.
 *
 * ✕ TRAILING ONLY, and never a lone token. `A B Widgets` joined its LEADING initials into `ab`
 * (Aktiebolag) and matched a company called `Widgets` — a strictness regression introduced by the fix for
 * a strictness gap. A legal form sits at the END of a name; initials sit at the front. PURE.
 */
export function dropLegalForms(tokens) {
  const out = [...tokens];
  for (let i = out.length - 2; i >= 0; i--) {
    const run = out.slice(i);
    if (run.some((t) => t.length > 2)) continue;
    if (OWNER_LEGAL_FORMS.has(deaccent(run.join("")))) { out.length = i; break; }
  }
  return out.filter((t) => !OWNER_LEGAL_FORMS.has(t));
}

export function ownerKey(owner) {
  const n = ownerName(owner);
  if (!n) return null;
  // — DROP A TRAILING PARENTHETICAL ANNOTATION. A gold set is lawyer-typed, and the convention in
  // it is a jurisdiction hint after the name: `Delphi Genetics S.A. (BX)`, `Delphi Diagnostics, Inc.
  // (US)` — three of R2's nine entries carry one and six do not, which is what makes it an annotation
  // rather than part of any name. A run finding carries the typed owner object and never one of these,
  // so the strict token-set equality below could not match the two sides of the SAME proprietor, and
  // `Delphi Genetics S.A.` scored against `Delphi Genetics S.A. (BX)` as a different company.
  //
  // ONE trailing group, and only at the end. This is not a general parenthesis fold: a parenthetical
  // inside a name is part of the name, and `Shanghai <A> Network Technology` vs `Shanghai <B> Network
  // Technology` — the false-owner-match this function's doc block is written against — carries none and
  // is untouched.
  // — collapse dotted abbreviations FIRST, then drop the legal forms. Owners only:
  // labelTokens also builds mark aliases, where a dot and a short token can both be part of the name.
  const toks = dropLegalForms(labelTokens(collapseDottedAbbreviations(n.replace(/\s*\([^()]*\)\s*$/, ""))));
  return toks.length ? toks.slice().sort().join(" ") : null;
}

/**
 * Do two owner strings name the same proprietor? STRICT — the distinctive token sets must be equal.
 *
 * Deliberately not fuzzy, and deliberately not a superset test. A false owner match is the exact defect
 * this line exists to prevent (`Shanghai <A> Network Technology` vs `Shanghai <B> Network Technology`
 * differ in one token out of four), and a superset rule would let a two-token subset claim a four-token
 * name. Anything short of equality returns false and the caller prints both strings, which a human can
 * adjudicate — an auditable refusal beats an unauditable match.
 */
export function ownersMatch(a, b) {
  const ka = ownerKey(a), kb = ownerKey(b);
  return Boolean(ka && kb && ka === kb);
}

/**
 * WHICH SLICES RAN FOR ONE LANE, derived from the run's own `fold.slices` statement.
 *
 * The lane declaration used to carry `executes: "candidates"`, frozen at mint and therefore a claim
 * about work that had not happened yet — and, once slices 2–3 shipped, a false one. It is gone. This
 * derives the same sentence from the delivery-time record instead: slice 1 from its per-lane map
 * (`slices.candidates.lanes[lane]`), slices 2–3 from their own `lane` field. PER LANE, never the
 * run-level join: the SERP grid is zh-only, so `lane ja: executes=candidates+serp-grid` would be a
 * claim about the ja lane that no record supports ('s fix, kept exact here).
 *
 * THREE ANSWERS, AND THE THIRD IS THE ONE THAT MATTERS:
 *   "candidates+serp-grid"  the named slices ran for this lane
 *   "none"                  the record covers this lane and NOTHING ran for it — a positive answer
 *   null                    no record covers this lane at all. Never "none": a run that died before
 *                           delivery states nothing, and reading that as "nothing ran" is the same
 *                           reassuring-absence defect as `exists` passing on "".
 *
 * PURE.
 */
export function laneExecutes(slices, lane) {
  if (!slices || typeof slices !== "object" || Array.isArray(slices)) return null;
  const ran = [];
  let covered = false;
  for (const [name, s] of Object.entries(slices)) {
    if (!s || typeof s !== "object") continue;
    // slice 1 is the only MULTI-lane slice, so its state is a per-lane map — the roll-up beside it
    // ("one gapped lane makes the whole slice gapped") is a run fact and would misreport a healthy lane
    if (s.lanes && typeof s.lanes === "object") {
      if (!Object.prototype.hasOwnProperty.call(s.lanes, lane)) continue;
      covered = true;
      if (s.lanes[lane] === "ran") ran.push(name);
      continue;
    }
    if (s.lane !== lane) continue;
    covered = true;
    if (s.state === "ran") ran.push(name);
  }
  if (!covered) return null;
  return ran.length ? ran.join("+") : "none";
}

/**
 * Read the jurisdiction-lane fold, THREE-VALUED ON THE FILE ITSELF. `_driver/jx-lanes.json` is the
 * artifact the scenario's own assert points at (`jx-lanes.json:fold.executes`), and it is what says
 * whether the lane the script-lane target depends on ran at all — the difference between "the engine
 * generated the term" and "the engine searched that jurisdiction at depth".
 *
 *   absent               `present:false` with a reason. Never a quiet nothing.
 *   present, no lanes    `present:true, lanes:[]` — the run wrote the file and declared no lane. That is
 *                        a different fact from the file not existing, and a reader who cannot tell them
 *                        apart cannot tell a missing artifact from a lane that never got built.
 *   present, with lanes  each lane's own `executes` / `depth` / `degraded` / counts, nothing inferred.
 *                        `executes` is derived from the run's `fold.slices` record for THAT lane
 *                        (laneExecutes,) — read from a record, never assumed from the declaration.
 *
 * PURE.
 */
export function readJxLanes(doc) {
  if (!doc || typeof doc !== "object") {
    return { present: false, why: "no _driver/jx-lanes.json — whether a jurisdiction lane ran cannot be established", lanes: [] };
  }
  const declared = doc.lanes ?? {};
  const folded = doc.fold?.lanes ?? {};
  const names = [...new Set([...Object.keys(declared), ...Object.keys(folded)])];
  const lanes = names.map((name) => {
    const d = declared[name] ?? {};
    const f = folded[name] ?? {};
    const accepted = Array.isArray(f.accepted) ? f.accepted.length : null;
    return {
      lane: name,
      // — the run-level statement is NO LONGER folded into the per-lane slot. This leg was a reader
      // written before its writer, and it contradicted this function's own docstring ("each lane's own
      // `executes` … nothing inferred"). Now that fold.executes exists it would be actively false: the
      // SERP grid is zh-only (jx-lanes.mjs SERP_LANES), so a CN+JP run would have printed
      // `lane ja: executes=candidates+serp-grid` — a claim about the ja lane that no record supports.
      // The run-level statement travels in its own slot on the return, below.
      //
      // — DERIVED from fold.slices, with the declaration as a LEGACY fallback only. Two artifact
      // generations reach this line and they are read in this order deliberately:
      //   fold.slices present     → derive. The record of what ran wins, always.
      //   pre- artifact       → its frozen `lanes.<lane>.executes` string, the only thing that run
      //                             ever recorded (a run minted between  and  carries BOTH, and
      //                             the derived value is the accurate one — hence the order).
      //   neither                 → null ⇒ the scorer prints "(not stated)". Not "none": no statement
      //                             and "nothing ran" are different facts.
      executes: laneExecutes(doc.fold?.slices, name) ?? (typeof d.executes === "string" ? d.executes : null),
      // — `depth` IS THE ASK, and it is now labelled as one everywhere it is read. It is frozen at
      // mint from jxPolicy.laneDepth and nothing gates a slice on it, so a bare `depth=full` in an
      // execution row is the same mint-time-declaration-read-as-execution-record seam, and
      // each removed one instance of. The field keeps its name and its value — a reader of an old
      // artifact must still find it where it was — and the row now carries the ASK and the GOT side by
      // side, plus the flag when they differ.
      depth: d.depth ?? null,
      // THE RUN'S OWN VERDICT, never re-derived here. It is minted at delivery by stateJxSlices from the
      // run's own environment (driver/jx.mjs deriveLaneDepthVerdicts), and the arms are environment — so
      // a reader deriving it now would answer for the box the SCORER runs on, which is exactly the class
      // of mistake this family exists to stop. Three-valued on the record itself, the same discipline as
      // `statement` below: an artifact that never stated it says so, and that is not a pass.
      depthVerdict: (() => {
        const v = doc.fold?.depth?.[name];
        if (!v || typeof v !== "object") {
          return { recorded: false, asked: d.depth ?? null, ran: null, shortfall: null,
            why: "the run did not state what depth this lane actually got (no fold.depth) — a pre-#893 artifact, "
              + "or a run that never reached the delivery statement. Whether the ask was met CANNOT be established" };
        }
        return { recorded: true, asked: v.asked ?? null, ran: v.ran ?? null,
          shortfall: typeof v.shortfall === "boolean" ? v.shortfall : null,
          cause: typeof v.cause === "string" ? v.cause : null,
          why: typeof v.why === "string" ? v.why : null };
      })(),
      // ONLY the fold can state fold health. The declaration is frozen before the fold runs, so a
      // `degraded` there would be a health claim about work not yet done — the fallback leg that used
      // to read it was a reader with no writer, and deleting it makes the contract exact.
      degraded: typeof f.degraded === "boolean" ? f.degraded : null,
      degradedCause: typeof f.degradedCause === "string" ? f.degradedCause : null,
      accepted,
      refused: Array.isArray(f.refused) ? f.refused.length : null,
      jurisdictions: Array.isArray(d.jurisdictions) ? d.jurisdictions : [],
    };
  });
  return {
    present: true,
    why: lanes.length ? null : "_driver/jx-lanes.json is present and declares no lane — the file was written and no jurisdiction lane was built, which is not the same as the file being absent",
    lanes,
    // — the RUN-level statement, three-valued on itself in the same discipline as the rest of this
    // function: present, or absent with a reason. A pre- artifact and a fold that never ran are both
    // "the run did not state it", and neither is a pass.
    statement: typeof doc.fold?.executes === "string" ? doc.fold.executes : null,
    slices: doc.fold?.slices ?? null,
    statementWhy: typeof doc.fold?.executes === "string" ? null
      : "the run did not state which jx slices it executed (no fold.executes) — a pre-#552 artifact, or a fold that never ran",
  };
}

/**
 * Read the SHADOW UNIT records (`_driver/jx/units.json`), three-valued on the file itself — the same
 * discipline as readJxLanes, for the same reason.
 *
 * The units are what a SERP credential outage actually breaks: SerpAPI is the grid unit's provider, not
 * the candidate fold's, so a dead key degrades a unit and leaves the lane's own `degraded` correctly
 * false. Without this read, that outage reaches no printed line at all.
 *
 *   absent               `present:false` with a reason. BOTH unit switches default OFF, so an absent
 *                        file means the units never ran — never `degraded:false` per unit, which would
 *                        report health for work nothing attempted.
 *   present, no units    `present:true, units:[]` — its own fact, its own sentence.
 *   present, with units  each unit's own `degraded` / cause / attempts, nothing inferred.
 *
 * `degraded` is TYPEOF-tested, never coerced. A pre- units.json carries the cause STRING in that
 * field; `Boolean(r.degraded)` would report an old artifact as having stated something it never stated.
 *
 * PURE.
 */
export function readJxUnits(doc) {
  if (!doc || typeof doc !== "object") {
    return { present: false, why: "no _driver/jx/units.json — whether the shadow units ran cannot be established (both unit switches default off, so this is the expected shape on a run that never armed them)", units: [] };
  }
  const recs = doc.units ?? {};
  const units = Object.keys(recs).map((key) => {
    const r = recs[key] ?? {};
    return {
      key,
      done: r.done === true,
      degraded: typeof r.degraded === "boolean" ? r.degraded : null,
      degradedCause: typeof r.degradedCause === "string" ? r.degradedCause : null,
      attempts: Number.isFinite(r.attempts) ? r.attempts : null,
    };
  });
  return { present: true, why: units.length ? null : "_driver/jx/units.json is present and records no unit — the file was written and no shadow unit reported, which is not the same as the file being absent", units };
}

/**
 * The script-lane target line — generated or not generated, and whose record came back.
 *
 * `plan`/`execution` answer GENERATION (did the engine put the term in the frozen plan, and did that
 * query run). `retrieved`/`findings` answer RETURN. `jxLanes` answers how deep the lane went. All four
 * are separate states because they fail separately and a run can pass one and fail the next.
 *
 * TERM GENERATION IS EXACT-MATCH against the entry's script SEGMENT (and the whole label), not the
 * containment rule the buckets use. A query for a five-character mark CONTAINING the target is not a
 * query for the target, and crediting it would be the same overstatement in a new place. Records stay on
 * `matchesReference` — evaluated against the segment, whose empty Latin alias list routes it to the
 * script branch — so this line and the bucket it reports can never disagree about what matched.
 */
export function scoreScriptTargets({ reference = [], buckets = {}, findings = [], retrieved = [], plan = null, execution = null, jxLanes = null, jxUnits = null } = {}) {
  const lane = readJxLanes(jxLanes);
  const units = readJxUnits(jxUnits);
  const entries = reference ?? [];
  // A gold entry carrying a non-Latin script segment is one no Latin-variant sweep can reach. That
  // property, not a glyph — and it survives a Latin transliteration written beside it.
  const targets = entries.map((e) => ({ entry: e, segments: scriptSegments(e?.mark ?? e?.name ?? "") })).filter((t) => t.segments.length);
  if (!targets.length) {
    // NO CONFIDENT NEGATIVE THE COMPUTATION HAS NOT ESTABLISHED. With entries to read, "none of them
    // carries a non-Latin segment" is a fact and says how many were checked. With NO entries, the same
    // sentence would be a claim about a reference that was never there.
    return { lane, units, targets: [], note: entries.length
      ? `none of the ${entries.length} register entr${entries.length === 1 ? "y" : "ies"} in the reference carries a non-Latin script segment — this scenario has no script-lane target to report. An absence in the REFERENCE, not a result for the run.`
      : "the reference carries no register entries, so whether it names a script-lane target could not be established — read the gold set, not this line." };
  }

  const planEntries = Array.isArray(plan?.entries) ? plan.entries : null;
  const execRows = Array.isArray(execution?.executed) ? execution.executed : null;
  const executed = new Set((execRows ?? []).map(qidOf).filter(Boolean));
  const planWhy = !planEntries ? "no _driver/register-plan.json entries — the frozen plan could not be read"
    : !execRows ? "no _driver/plan-execution.json — whether the query ran cannot be established"
    : !execRows.length ? "_driver/plan-execution.json lists no executed query — the run recorded no dispatch at all, so whether this term was searched cannot be established"
    : null;

  const rows = targets.map(({ entry, segments }) => {
    const label = String(entry.mark ?? entry.name ?? "").trim();
    const wanted = [...new Set([label, ...segments])];
    const queries = (planEntries ?? [])
      .filter((p) => wanted.includes(String(p?.term ?? "").trim()))
      .map((p) => ({ qid: p.qid ?? null, axis: p.axis ?? null, regions: Array.isArray(p.regions) ? p.regions : [], executed: executed.has(p?.qid) }));
    const generated = planWhy ? "unresolved"
      : queries.some((q) => q.executed) ? "executed"
      : queries.length ? "planned-not-executed"
      : "not-generated";

    // What came back. THE BUCKETS' RULE FIRST, so the two can never disagree about what IS the mark —
    // then a disclosed widening. stopped the buckets scoring a longer Han mark that merely
    // CONTAINS the target (gold 色度 was being scored off a different proprietor's 色度花间), and that is
    // right for a recall verdict and wrong for this list: a script-lane target's reader needs to see
    // that the lane came back with a neighbour rather than with nothing, which is the difference
    // between a lane that did not fire and one that fired and missed.
    //
    // SAFE BECAUSE IT IS COUNTED NOWHERE. `records` feeds `ownerState`, `ownersReturned` and the printed
    // list. The recall number on this row is `bucket`, and that is read from the buckets scoreRecall
    // already computed — never from here. Every widened row carries `exact: false`, which is the flag
    // the disclosure rests on.
    const scriptNeighbour = (a, b) => {
      const x = String(a ?? "").normalize("NFKC").replace(/\s+/g, "");
      const y = String(b ?? "").normalize("NFKC").replace(/\s+/g, "");
      return Boolean(x && y && x !== y && (x.includes(y) || y.includes(x)));
    };
    const hits = (mark) => segments.some((s) => matchesReference(s, mark) || scriptNeighbour(s, mark));
    const isExact = (mark) => wanted.includes(String(mark ?? "").trim());
    const seen = new Map();
    for (const r of retrieved ?? []) {
      if (!hits(r.mark)) continue;
      const k = r.record_id ?? `${r.mark}`;
      if (!seen.has(k)) seen.set(k, { mark: r.mark, owner: ownerName(r.owner), record_id: r.record_id ?? null, exact: isExact(r.mark), side: "retrieved" });
    }
    for (const f of findings ?? []) {
      if (!hits(f.mark) || !satisfiesReference({ ...entry, mark: segments[0] }, f).ok) continue;
      const k = `finding:${f.mark}`;
      if (!seen.has(k)) seen.set(k, { mark: f.mark, owner: ownerName(f.owner), record_id: null, exact: isExact(f.mark), side: "finding" });
    }
    const records = [...seen.values()];

    const goldOwner = ownerName(entry.owner);
    const matched = records.filter((r) => ownersMatch(goldOwner, r.owner));
    const named = [...new Set(records.map((r) => r.owner).filter(Boolean))];
    // FOUR states, and only the first is the lane proving anything about THIS finding.
    const ownerState = !goldOwner ? "reference-names-no-owner"
      : !records.length ? "no-records"
      : matched.length ? "matched"
      : named.length ? "differs"
      : "records-carry-no-owner";

    return {
      mark: label, segments, owner: goldOwner, jurisdictions: entry.jurisdictions ?? [],
      bucket: bucketOfEntry(buckets, label),
      generated, why: planWhy, queries, records,
      ownerState, ownerMatched: matched.map((r) => r.owner), ownersReturned: named,
    };
  });
  return { lane, units, targets: rows, note: null };
}

// ── — A KNOCKOUT IS GRADED ON WHAT A KNOCKOUT PROMISES ─────────────────────────────────────────
//
// R3 and R4 are knockout scenarios and their gold sets are clearance-grade lawyer reviews listing
// SIMILAR marks — TIKI PUNCH, TIKI TROPICS — which a count of the exact string and its close variations
// can never retrieve. The 2026-08-12 round scored them 0/8 and 0/9 on BOTH free-tier and clarivate, same
// day, same engine. That zero is baked in by the product definition, and it costs twice: the two
// cheapest scenarios cannot detect a recall regression because they are already at the floor, and every
// scoreboard reader sees "0/8 found · band Medium" and reads a broken product. It has already triggered
// one owner alarm.
//
// So a knockout scenario gets a knockout-shaped reference: how many filings the register should hold for
// the exact mark in the named classes, and WHICH close variations the run was supposed to count. Both
// are read from the run's own register sidecars — never from findings, which is the clearance lane's
// artifact and the reason the mismatch existed.
//
// A RANGE, NOT A NUMBER. The register moves between rounds: filings are added, abandoned and reinstated,
// and a gold set pinned to an exact total would go red on the register doing its job rather than on the
// engine doing it wrong. The range is the lawyer's judgement about what the answer cannot fall outside.
//
// THE NAMED VARIATIONS ARE WHERE THE RECALL SIGNAL LIVES. A count in range proves the lane answered; it
// does not prove the lane still generates CORALFREEZE from CORAL FREEZE. `close_variations` names the forms
// the run must be able to show it counted, so the regression the issue is about — "CORALFREEZE no longer
// caught" — moves an axis instead of moving nothing.

/**
 * Grade one run's register counts against a count-shaped gold set. PURE.
 *
 * @param {object[]} counts       the reference's `counts` block
 * @param {object|null} registerCounts  the run's _driver/register-counts.json
 * @param {object|null} registerRecords the run's _driver/register-records.json — carries the terms the
 *                                      lane actually searched, which is the only place the close
 *                                      variations are recorded
 * @returns {{rows: object[], missingArtifact: string|null}}
 */
export function scoreCounts({ counts = [], registerCounts = null, registerRecords = null } = {}) {
  // AN ABSENCE IS A FINDING. A knockout scored with no counts sidecar has not passed the count check; it
  // has failed to be measurable, and every row below would otherwise read as an in-range zero.
  if (!registerCounts) {
    return { rows: [], missingArtifact: "_driver/register-counts.json is absent — this run cannot be graded on counts at all, "
      + "and an ungraded run is not a passing one" };
  }
  const byName = (doc, name) => (doc?.marks ?? []).find(
    (m) => String(m?.name ?? "").trim().toLowerCase() === String(name ?? "").trim().toLowerCase()) ?? null;

  const rows = (counts ?? []).map((want) => {
    const label = String(want?.mark ?? "");
    const got = byName(registerCounts, label);
    if (!got) {
      return { mark: label, state: "not-counted", why: "the run's counts sidecar holds no entry for this mark", counted: null,
        range: want?.identical ?? null, variations: [] };
    }
    // `identical` is the narrow question a knockout answers — the name itself. `containing` is the
    // register's broad name match and runs to the hundreds; it is deliberately NOT graded, because a
    // range over it would be a range over the register's own matching behaviour.
    const counted = got?.counts?.identical?.total ?? null;
    const range = want?.identical ?? null;
    const state = counted == null ? "not-counted"
      : !range ? "counted"
      : (Number.isFinite(range.min) && counted < range.min) ? "below-range"
      : (Number.isFinite(range.max) && counted > range.max) ? "above-range"
      : "in-range";

    // Which close variations the lane actually put to the register. The terms list is the run's own
    // record of what it searched, so a variation absent from it was never asked — which is exactly the
    // regression this axis exists to catch, and is different from a variation asked and answered zero.
    const asked = new Set(((byName(registerRecords, label)?.terms) ?? [])
      .map((t) => String(t?.term ?? "").trim().toUpperCase()).filter(Boolean));
    const variations = (want?.close_variations ?? []).map((v) => ({
      form: v, counted: asked.has(String(v).trim().toUpperCase()),
    }));

    return { mark: label, state, counted, range, variations,
      why: state === "not-counted" ? "the sidecar entry carries no identical total" : null };
  });

  // A reference that names variations against a run with no records sidecar cannot answer the variation
  // half, and saying so beats reporting every form as uncounted.
  const wantsVariations = (counts ?? []).some((c) => (c?.close_variations ?? []).length);
  return { rows, missingArtifact: wantsVariations && !registerRecords
    ? "_driver/register-records.json is absent — the close-variation axis could not be read, so every form below reads as uncounted"
    : null };
}

/** Validate a gold set before scoring against it. A malformed reference must not read as a clean sweep. */
export function validateReference(ref) {
  const errs = [];
  if (!ref || typeof ref !== "object") return ["reference is not an object"];
  if (ref.schema_version !== REFERENCE_SCHEMA_VERSION)
    errs.push(`schema_version must be ${REFERENCE_SCHEMA_VERSION} — got ${JSON.stringify(ref.schema_version)}`);
  if (!ref.scenario) errs.push("no `scenario` id");
  if (!ref.source) errs.push("no `source` — a reference with no named author cannot be audited");
  const reg = ref.register;
  if (!Array.isArray(reg) || !reg.length) errs.push("`register` must be a non-empty array of the marks the lawyer named");
  else for (const [i, e] of reg.entries()) {
    if (!e?.mark) errs.push(`register[${i}] has no \`mark\``);
    if (e?.classes && !Array.isArray(e.classes)) errs.push(`register[${i}].classes must be an array`);
  }
  if (ref.scope && !Array.isArray(ref.scope.classes)) errs.push("`scope.classes` must be an array");
  // — OPTIONAL, and that IS the migration. An existing gold set carrying no `covers_marks` keeps
  // validating and keeps scoring exactly as it did; `referenceCoverage` reports `undeclared`, excludes
  // nothing, and names the marks the run searched. REFERENCE_SCHEMA_VERSION deliberately does NOT move:
  // :1028 refuses any other value, so a bump would stop every gold set in the config store from scoring
  // at once. Present-but-malformed is an ERROR rather than an ignore, on this function's own contract —
  // a reference the scorer half-reads is one that reads as a clean sweep.
  if (ref.covers_marks !== undefined) {
    if (!Array.isArray(ref.covers_marks) || !ref.covers_marks.length)
      errs.push("`covers_marks`, where present, must be a non-empty array of the subject marks this reference answers");
    else if (ref.covers_marks.some((m) => typeof m !== "string" || !m.trim()))
      errs.push("every `covers_marks` entry must be a non-empty string naming one subject mark");
  }
  // — OPTIONAL, and that is the migration, exactly as `covers_marks` was. Every gold set in the
  // config store carries no `counts` today and keeps validating and scoring unchanged.
  // REFERENCE_SCHEMA_VERSION deliberately does NOT move: a bump would stop all of them at once.
  // Present-but-malformed is an ERROR rather than an ignore — a half-read reference reads as a pass.
  if (ref.counts !== undefined) {
    if (!Array.isArray(ref.counts) || !ref.counts.length)
      errs.push("`counts`, where present, must be a non-empty array — one entry per mark the knockout was asked to count");
    else for (const [i, c] of ref.counts.entries()) {
      if (!c?.mark) errs.push(`counts[${i}] has no \`mark\``);
      if (c?.classes !== undefined && !Array.isArray(c.classes)) errs.push(`counts[${i}].classes must be an array`);
      const r = c?.identical;
      if (r !== undefined) {
        if (typeof r !== "object" || r === null) errs.push(`counts[${i}].identical must be an object with min and/or max`);
        else {
          for (const k of ["min", "max"])
            if (r[k] !== undefined && !Number.isFinite(r[k])) errs.push(`counts[${i}].identical.${k} must be a number`);
          // A range that cannot contain anything would fail every round and read as a recall collapse.
          if (Number.isFinite(r.min) && Number.isFinite(r.max) && r.min > r.max)
            errs.push(`counts[${i}].identical has min ${r.min} above max ${r.max} — no count can satisfy it`);
        }
      }
      if (c?.close_variations !== undefined) {
        if (!Array.isArray(c.close_variations))
          errs.push(`counts[${i}].close_variations must be an array of the forms the run must have counted`);
        else if (c.close_variations.some((v) => typeof v !== "string" || !v.trim()))
          errs.push(`every counts[${i}].close_variations entry must be a non-empty string`);
      }
    }
  }
  return errs;
}

/**
 * — is this reference the right SHAPE for the lane that ran? Returns a refusal sentence, or null.
 *
 * The scorer used to grade a knockout against a similar-marks sheet and annotate every miss
 * "register-only run: no gather/judgment seam to measure". That footnote was doing the work of an error:
 * the run could not have found those marks, the zero was structural, and the scoreboard printed
 * "0/8 found · band Medium" as though it were a measurement of the engine.
 *
 * Kept here rather than in scripts/score.mjs so the rule is testable without a run directory, and so a
 * second consumer of these gold sets cannot reach a different verdict about the same pairing.
 */
export function referenceLaneMismatch({ lane, ref }) {
  if (lane !== "knockout") return null;
  if (Array.isArray(ref?.counts) && ref.counts.length) return null;
  const named = (ref?.register ?? []).length;
  return `${ref?.scenario ?? "this scenario"} ran the KNOCKOUT lane and its reference is a similar-marks sheet`
    + `${named ? ` naming ${named} mark(s)` : ""}, with no \`counts\` block.\n`
    + `  A knockout answers one narrow question — how many register filings exist for the exact mark and\n`
    + `  its close variations in the named classes. It never retrieves similar marks, so every entry on\n`
    + `  that sheet is unreachable by construction and the score would be a structural zero reported as a\n`
    + `  measurement of the engine.\n`
    + `  Give this scenario a \`counts\` block — expected identical-count ranges per mark and the close\n`
    + `  variations the run must have counted — or score it against a lane that promises retrieval.`;
}

// ── — THE GOLD'S ASSERTIONS AND CONTROLS ARE READ, OR THE HARNESS IS SILENT ON THEM ────────────
//
// A gold declares `assertions` and `controls` and the scorer read NEITHER. Grepping its output for
// either word returned nothing, so a failing assertion and a passing one looked identical — and on the
// best run on record, one assertion had failed in eight runs of eight while the output read 78% recall
// and a clean withheld column.
//
// THEY ARE PROSE, so most cannot be decided mechanically, and that is the whole design problem. The
// answer is NOT to decide fewer of them: an omitted assertion reads exactly like a passing one, which
// is the state this fixes. Every declared statement is reported, with an outcome or with an explicit
// "cannot evaluate" and its reason.
//
// WHAT CAN BE DECIDED is the part that names a MARK. The buckets already know each gold mark's fate, so
// a statement naming one carries a fact the scorer holds: "this assertion turns on a mark that is
// `lost`". That is not a verdict on the sentence — a lawyer's assertion can turn on a mark and still be
// about something else — so it is reported as EVIDENCE beside the statement rather than as a pass/fail
// on the prose. The reader supplies the judgement; the harness supplies what it knows.
//
// A CONJUNCTIVE CONTROL IS SPLIT, and this is the half that matters most. One R2 control reads
// "<A> missed AND dead <B> delivered". Across eight runs A was missed in seven while B reached findings
// in one, so the control as a conjunction fired ONCE while the condition it exists to catch was live
// SEVEN times. Each named mark becomes its own half with its own outcome, so a half that stops firing
// is visible instead of absorbed by the other.

const MARK_TOKEN_RE = /\b[A-Z][A-Z0-9]{2,}(?:[ ·-][A-Z][A-Z0-9]{1,})*\b/g;
// A FLOOR, NOT A CLAIM TO COMPLETENESS. Lawyers write in capitals for emphasis, so some prose words will
// always be read as mark-shaped — and that is TOLERABLE here in a way it would not be in a gate: an
// unrecognised token joins no bucket and is reported `not-in-this-run`, which is true and costs a reader
// one line. The list exists to keep the common ones out of the output, not to make the extraction sound.
// Widen it when the noise becomes distracting; never rely on it for correctness.
const STOPWORDS = new Set(["AND", "THE", "NOT", "BUT", "FOR", "WITH", "ONLY", "ALL", "ANY", "US", "EU", "CH",
  "UK", "DE", "FR", "JP", "CN", "KR", "TW", "WIPO", "EUIPO", "USPTO", "IPO", "TM", "PDF", "URL", "API",
  "BEFORE", "AFTER", "MUST", "NEVER", "ALWAYS", "EVERY", "NONE", "BOTH", "EACH", "THAN", "THEN", "THIS",
  "THAT", "WHEN", "WHERE", "WHICH", "FIRST", "SECOND", "HIGH", "LOW", "MEDIUM", "CLEAR", "OPEN"]);

/** Mark-shaped tokens a statement names, upper-cased and de-duped. PURE. */
export function marksNamedIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(MARK_TOKEN_RE)) {
    // TRIM STOPWORDS OFF THE ENDS BEFORE JUDGING THE TOKEN, or an emphasis word adjacent to a mark
    // swallows it: "but NOT GAMMA" matches as the single token `NOT GAMMA`, which is on no stopword
    // list, joins no bucket, and loses the mark it contains. Found by an arm in this suite, and it is
    // the failure mode that would matter — a real gold sentence putting a capitalised word beside a real
    // mark would silently drop the join and the statement would read `unevaluated`.
    let parts = m[0].trim().split(/[ ·-]/).filter(Boolean);
    while (parts.length && STOPWORDS.has(parts[0])) parts.shift();
    while (parts.length && STOPWORDS.has(parts[parts.length - 1])) parts.pop();
    if (!parts.length) continue;
    const t = m[0].trim().slice(m[0].trim().indexOf(parts[0]),
      m[0].trim().lastIndexOf(parts[parts.length - 1]) + parts[parts.length - 1].length);
    if (STOPWORDS.has(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Every declared assertion and control, with what the run's own buckets say about the marks it names.
 *
 * `verdict` is deliberately narrow: `evidence` when the statement names at least one mark this run
 * classified, `unevaluated` otherwise — never `pass`. The scorer does not read English and must not
 * appear to. PURE.
 */
export function scoreStatements({ assertions = [], controls = [], buckets = {} } = {}) {
  const state = new Map();
  for (const [name, rows] of Object.entries(buckets ?? {}))
    for (const r of Array.isArray(rows) ? rows : [])
      for (const key of [r?.mark, r?.matched]) {
        const k = String(key ?? "").trim().toUpperCase();
        if (k && !state.has(k)) state.set(k, name);
      }

  const judge = (text, kind) => {
    const named = marksNamedIn(text);
    const halves = named.map((mark) => ({ mark, state: state.get(mark) ?? "not-in-this-run" }));
    return {
      kind, text: String(text ?? ""),
      halves,
      verdict: halves.some((h) => h.state !== "not-in-this-run") ? "evidence" : "unevaluated",
      // An unevaluated statement says WHY, or a reader cannot tell "the harness cannot decide this" from
      // "the harness forgot". The distinction is the entire point of the issue this closes.
      why: halves.length === 0
        ? "names no mark this scorer can join to a bucket — a prose assertion the harness cannot decide"
        : (halves.every((h) => h.state === "not-in-this-run")
          ? `names ${halves.map((h) => h.mark).join(", ")}, none of which this run classified`
          : null),
    };
  };

  return [
    ...(Array.isArray(assertions) ? assertions : []).map((t) => judge(t, "assertion")),
    // Controls are judged the same way and SPLIT the same way. A conjunction of two marks yields two
    // halves, each with its own state, which is the property the R2 control needed and did not have.
    ...(Array.isArray(controls) ? controls : []).map((t) => judge(t, "control")),
  ];
}

/**
 * The delivery answer, in four states —.
 *
 * A refusal and an unpreserved terminal state are DIFFERENT facts and the scorer must not merge them.
 * Publish writes the pool copy and `state: "delivered"` is written AFTER publish returns, so a pool dir
 * proves publication and never delivery. Nothing here infers a settle from a file's existence.
 */
export function deliveryLine(run) {
  if (run.deliveryState === "delivered" && run.deliveredAt) return `delivered: YES — ${run.deliveredAt}`;
  // A status.json that exists and does not say delivered IS the refusal case this line was written for
  //: a refusal after model work has every artifact a delivered run has, so it must lead.
  if (run.hasStatus) {
    return `delivered: NO — THE ORDER WAS REFUSED. state=${run.deliveryState ?? "(status.json carries no state)"}`
      + `${run.deliveredAt ? "" : ", never settled into delivery"}.`
      + ` Everything below scores prose that was never signed off.`;
  }
  // — THE POOL COPY'S OWN SETTLE STAMP, written by the delivery path at the
  // moment the terminal state was decided. This is read BEFORE the meta.json branch below, because a
  // stamp is a recorded answer and meta.json is only evidence of publication. Nothing here infers a
  // settle from a file's existence: the stamp carries an explicit state and is reported as what it
  // says, so a run that published and then failed reads as that failure and never as a delivery.
  if (run.settle) {
    if (run.settle.state === "delivered" && run.settle.deliveredAt)
      return `delivered: YES — ${run.settle.deliveredAt} (settle stamp on the pool copy)`;
    return `delivered: NO — the pool copy's settle stamp records state=${run.settle.state}`
      + `${run.settle.deliveredAt ? "" : ", never settled into delivery"}.`
      + ` Everything below scores prose that was never signed off.`;
  }
  if (run.poolMeta) {
    const issued = run.poolMeta.issuedAt ? ` published ${run.poolMeta.issuedAt}` : " publication time not recorded";
    const verdict = run.poolMeta.verdict ?? run.poolMeta.overall;
    // NOT PRESERVED stays the honest answer for a pool copy with no stamp — a run archived before the
    // stamp existed, or one whose best-effort write failed. An absent stamp is unknown, not a refusal.
    return `delivered: NOT PRESERVED — this is a pool copy carrying no settle stamp, so the terminal`
      + ` state cannot be read here. NOT a refusal: nothing about this directory says the order`
      + ` failed.\n           Durable record:${issued}`
      + `${verdict ? `, verdict ${verdict}` : ", no verdict recorded"}.`
      + ` A run delivered before the stamp shipped, or one whose stamp write failed, reads exactly like`
      + ` this. Score the workspace run dir for the settle, while it exists.`;
  }
  return `delivered: NOT ANSWERABLE — no status.json and no meta.json in this directory, so neither the`
    + ` terminal state nor the publication is recorded here. No verdict is inferred from that.`;
}

/**
 * The engine commit and where it came from —.
 *
 * status.json first, because a live run's own stamp is authoritative. Then the pool's meta.json, which
 * carries the same commit for a published run. Reading only status.json made the scorer print "this run
 * predates the status.json engine stamp" for every pool dir — a WRONG claim, not a missing one.
 */
export function engineCommitOf({ status = null, meta = null } = {}) {
  if (status?.engineCommit) return { commit: status.engineCommit, from: "status.json" };
  if (meta?.engineCommit) return { commit: meta.engineCommit, from: "meta.json" };
  return { commit: null, from: null };
}
