// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-audit.mjs — the machinery behind 's E1, E2 and E3 checks.
//
// PURE and OFFLINE, like coverage-ledger.mjs and findings-model.mjs: it reads source text and the
// declarations, and it computes. Nothing here runs on a clearance — no pipeline path imports it and no
// stage dispatch reads it. It exists for `driver/test/contract-audit.test.mjs` and for a human asking
// what the contract says.
//
//   E1  every stage declares, beside its `message`, the elements it asks a model for and the CLASS of
//       each, from a closed enum, plus the validator tokens that speak about that element.
//   E2  declarations ∪ validator vocabulary is a closed partition, in two arms of different strength:
//         arm 1  a token no element accounts for      → hard red, now
//         arm 2  an element no token speaks about     → a per-stage RATCHET (owner ruling 2026-08-13)
//   E3  structure is returned, never emitted as text — with a named, shrinking backlog for the sites
//       that exist today, because a lint that greenlights every existing hole certifies the problem.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VOCABULARY, ARM1_EXEMPTIONS, COVERED_SOURCES, INNER_CODES, TRIPWIRE_OUT_OF_SCOPE, normalizeFailToken } from "./contract-vocabulary.mjs";

// ── E1: the closed class enum ────────────────────────────────────────────────────────────────────────
//
// There is NO bare `mechanical`. A mechanical element must say what discharges it, because "mechanical"
// alone is a label a defect can wear —: "a declaration that lists a mechanical element as judgment
// to get past CI is the defect wearing a label", and the same is true one level down for a mechanical
// element that never names its discharge.
export const CONTRACT_CLASSES = [
  "judgment",
  "mechanical:pre-bound",
  "mechanical:code-extracted",
  "mechanical:tool-written",
  "mechanical:code-assigned",
  "mechanical:code-rendered",
];

export const isMechanical = (cls) => String(cls ?? "").startsWith("mechanical:");

/**
 * Flatten STAGES' contractElements into rows.
 * @returns {Array<{stage:string, element:string, class:string, tokens:string[]}>}
 */
export function declaredElements(stages) {
  const rows = [];
  for (const [stage, def] of Object.entries(stages)) {
    const ce = def?.contractElements;
    if (!ce) continue;
    for (const [element, spec] of Object.entries(ce)) {
      rows.push({ stage, element, class: spec?.class, tokens: Array.isArray(spec?.tokens) ? spec.tokens : [] });
    }
  }
  return rows;
}

// ── E2: matching a declared token against a vocabulary row ───────────────────────────────────────────
//
// A row is either a literal token or a FAMILY prefix (a parser's closed token family reached through a
// dynamic emit site). A declaration accounts for a family by naming any token in it, so match is:
// exact equality, or — for a family row — the declared token starts with the family prefix.
function accountsFor(row, declaredToken) {
  const d = normalizeFailToken(declaredToken);
  if (d === row.token) return true;
  if (row.family && d.startsWith(row.token)) return true;
  return false;
}

const exemptionFor = (token, stage) =>
  ARM1_EXEMPTIONS.find((x) => x.token === token && x.stages.includes(stage)) ?? null;

/**
 * ARM 1 — a validator token no element declaration accounts for. Hard red.
 * @returns {Array<{token:string, stage:string, site:string}>} unaccounted (token, stage) pairs
 */
export function arm1Unaccounted(stages) {
  const rows = declaredElements(stages);
  const byStage = new Map();
  for (const r of rows) {
    if (!byStage.has(r.stage)) byStage.set(r.stage, []);
    byStage.get(r.stage).push(...r.tokens);
  }
  const out = [];
  for (const row of VOCABULARY) {
    for (const stage of row.stages) {
      if (exemptionFor(row.token, stage)) continue;
      const declared = byStage.get(stage) ?? [];
      if (!declared.some((t) => accountsFor(row, t))) out.push({ token: row.token, stage, site: row.site });
    }
  }
  return out;
}

/**
 * ARM 2 — a declared element no validator token speaks about. A RATCHET, not a red build.
 *
 * The owner's ruling (, 2026-08-13) is four conditions, and they are the ruling rather than
 * suggestions: the baseline is PER STAGE and carries the ELEMENT NAMES (it is the audit object, not a
 * bare count); CI fails on any per-stage INCREASE so a new hole cannot hide behind a fix elsewhere; arm 1
 * is exempt from the ratchet; and wave 1's moves are expected to move the number.
 *
 * @returns {Record<string, string[]>} stage → the element names with no token, sorted
 */
export function arm2Unspoken(stages) {
  const out = {};
  for (const r of declaredElements(stages)) {
    if (r.tokens.length) continue;
    (out[r.stage] ??= []).push(r.element);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/**
 * Compare a measured arm-2 census against the committed baseline. Per-stage increase only.
 * @returns {Array<{stage:string, was:number, now:number, added:string[]}>} regressions
 */
export function arm2Regressions(measured, baseline) {
  const out = [];
  for (const stage of new Set([...Object.keys(measured), ...Object.keys(baseline)])) {
    const now = measured[stage] ?? [];
    const was = baseline[stage] ?? [];
    if (now.length > was.length) {
      const wasSet = new Set(was);
      out.push({ stage, was: was.length, now: now.length, added: now.filter((e) => !wasSet.has(e)) });
    }
  }
  return out;
}

// ── E2 soundness: the static extraction, inverted into a tripwire ────────────────────────────────────
//
// THE QUESTION E2 MUST ANSWER BEFORE IT IS TRUSTED: if a validator builds a token dynamically — string
// concatenation, a variable prefix, a token from a data table — a static extraction MISSES it, and arm 1
// then passes while blind. It does, at eight sites in verify.mjs alone (contract-vocabulary.mjs names
// D1–D8), plus a second-order class where the token literal sits inside an `onlyKeys` arrow function
// rather than in a `throw new Error("<token>` head.
//
// So the extraction is NOT the source of truth for arm 1 — the authored census is. The extraction is
// sound in exactly one direction, and that is the direction it is used in here: every token a regex CAN
// see must be covered by a census row. A token the census carries and the regex cannot see is expected
// and fine. A token the regex sees and the census does not is a build break — which is what stops the
// census going stale when somebody adds a literal `fail("new_token")` to verify.mjs.
// Both patterns require a `_`: every validator token in this tree is snake_case, and without that the
// arrow-function pattern matches any arrow returning a bare word ("register", "grid", "half") and buries
// the real signal in noise.
const TOKEN_RE = /(?:fail\(|throw new Error\()\s*[`"']([a-z][a-z0-9]*(?:_[a-z0-9]+)+)/g;
const ARROW_TOKEN_RE = /=>\s*[`"']([a-z][a-z0-9]*(?:_[a-z0-9]+)+)/g;
// — THE ACCEPTANCE BOUNDARY, which the two patterns above cannot see at all.
//
// A record module refuses with `return { ok: false, reason: "<token>: <restatement>" }` rather than
// `fail(` or a throw, so every token minted there was invisible to this census — three modules, ZERO
// tokens extracted, measured on 31cc49f0, while `variant-manifest-model.mjs` beside them extracted ten
// through its token-first throws. The difference was the return shape, never the token count.
//
// It matters more with each conversion, because the conversions are what MOVE refusals here: a stage's
// families leave verify.mjs's `fail(` and arrive at an acceptance boundary this regex did not read. Three
// stages had already moved when this was found, and the rows covering them were hand-authored with
// nothing re-deriving them — `acceptMatterFrame` mints eight tokens against a row documenting three.
const REASON_TOKEN_RE = /reason:\s*[`"']([a-z][a-z0-9]*(?:_[a-z0-9]+)+)/g;

// #1211 — A CITED SITE MUST BE A MINT. The extractor records the FIRST line a pattern matched, and the
// patterns read comment text as readily as code: `no_status` was cited at coverage-form.mjs:802, the
// JSDoc `@returns {Array<{reason:"no_status"|"form_damaged", …` annotation seventeen lines above the line
// that writes it. Every #1211 ruling cites its mint, so a citation drawn from a sentence about the code
// is a ruling about a sentence.
//
// Comment-ONLY lines, never a trailing `//` after code — a token minted on a line that also carries a
// comment is still minted there. Measured before it was trusted: across all 30 covered sources this moves
// exactly one citation (coverage-form.mjs:802 -> :828) and loses NO token, so the census does not shrink.
// That measurement is the load-bearing half: a filter that quietly dropped a comment-only token would
// take its coverage obligation with it, and the tripwire would read the absence as clean.
const COMMENT_ONLY_LINE = /^\s*(?:\/\/|\*|\/\*)/;

/** @returns {Map<string,string>} token → "file:line" of the first site that mints it */
export function extractStaticTokens(driverDir, files = COVERED_SOURCES) {
  const found = new Map();
  for (const f of files) {
    let text;
    try { text = readFileSync(join(driverDir, f), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // — ALL THREE PATTERNS OVER ALL COVERED SOURCES. The `reason:` shape ran over the seven
      // record modules alone while its 21 further findings were unruled. They are ruled now — INNER_CODES
      // and the exact-token rules in TRIPWIRE_OUT_OF_SCOPE — so the narrowing goes with them.
      if (COMMENT_ONLY_LINE.test(lines[i])) continue;
      for (const re of [TOKEN_RE, ARROW_TOKEN_RE, REASON_TOKEN_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(lines[i]))) if (!found.has(m[1])) found.set(m[1], `${f}:${i + 1}`);
      }
    }
  }
  return found;
}

/**
 * Which extracted tokens no census row covers and no scope rule excludes.
 * A non-empty result is a build break: either the census gained a hole, or a genuinely new token needs
 * a row (or an out-of-scope rule that says, in words, why no stage can emit it).
 */
export function tripwireUncovered(extracted) {
  const out = [];
  for (const [token, site] of extracted) {
    if (VOCABULARY.some((row) => accountsFor(row, token))) continue;
    if (outOfScopeRuleFor(token)) continue;
    // — AN INNER CODE IS EXCUSED BY ITS COMPOSITE, AND ONLY WHILE THAT COMPOSITE IS COVERED.
    // `innerCodeCovered` returns false for a row whose composite has lost its vocabulary row, so the code
    // lands here as uncovered and names the composite that went missing. That is the whole reason this is
    // a table of assertions rather than a list of exemptions: an exemption that outlives its own
    // justification is indistinguishable from one that was always wrong.
    const inner = innerCodeFor(token);
    if (inner && innerCodeCovered(inner)) continue;
    if (inner) { out.push({ token, site, orphanedFrom: uncoveredComposites(inner) }); continue; }
    out.push({ token, site });
  }
  return out;
}

/** The out-of-scope rule covering a token, by family prefix or by exact name — or null. */
export const outOfScopeRuleFor = (token) =>
  TRIPWIRE_OUT_OF_SCOPE.find((r) => (r.prefix ? String(token).startsWith(r.prefix) : token === r.token)) ?? null;

/** The INNER_CODES ruling for a bare code, or null. Exact — an inner code excuses itself and nothing else. */
export const innerCodeFor = (token) => INNER_CODES.find((r) => r.code === token) ?? null;

/** The composites a ruling names that no vocabulary row accounts for. Empty means the ruling still holds. */
export const uncoveredComposites = (row) =>
  (row?.rollsUpTo ?? []).filter((c) => !VOCABULARY.some((v) => accountsFor(v, c)));

/** Does this ruling still stand? A ruling with no composite at all never stood — that is what an out-of-scope rule is for. */
export const innerCodeCovered = (row) =>
  Boolean(row?.rollsUpTo?.length) && uncoveredComposites(row).length === 0;

/**
 *, THE OTHER DIRECTION — rulings for codes nothing mints any more.
 *
 * A stale row is not harmless: it excuses a name, so if that name is ever re-introduced for a different
 * purpose it arrives pre-excused, carrying a ruling written about something else. This is the phantom
 * check the repair-composer registry needed for the same reason, and it is the direction a census cannot
 * notice by itself — the tripwire only ever walks tokens that ARE there.
 *
 * @param {Map<string,string>} extracted  extractStaticTokens() output
 * @returns {Array<{code:string, mints:string[]}>} rulings whose code is no longer extracted anywhere
 */
export function innerCodesUnminted(extracted) {
  return INNER_CODES.filter((r) => !extracted.has(r.code)).map((r) => ({ code: r.code, mints: r.mints }));
}

// ── E3: structure returned, never emitted as text ────────────────────────────────────────────────────
//
// Three shapes, each of which makes a model type a structure that code then re-parses:
//
//   literal-json-skeleton  a JSON object/fence written INTO the instruction for the model to imitate
//   exactly-these-keys     a closed key-set or closed-enum clause dictated in prose
//   dictated-line-shape    a line template with <placeholders> that a driver parser re-reads
//
// The lint reads SOURCE TEXT (a stage's block in stages.mjs, and the skill files it reads), not a
// rendered message: rendering needs a run context, and half the contract lives in the skill file anyway
// —: "E1's declaration must be authored against the skill file the stage reads, not against
// stages.mjs alone, or half the contract escapes the check."
export const E3_KINDS = ["literal-json-skeleton", "exactly-these-keys", "dictated-line-shape"];

/**
 * The backlog registry carries a fourth kind the LINT structurally cannot see, and that gap is the
 * argument for the registry existing at all:
 *
 *   other — the dictate is not in the text being linted. Two shapes found: a stage message that
 *           DELEGATES its whole envelope to a skill file ("dictated keys + closed enums per the skill",
 *           stages.mjs:974 for blind-frame — a lint reading the message sees nothing and the skeleton
 *           escapes); and a field DICTATED THEN OVERWRITTEN, where the instruction annotates its own
 *           fields as driver-replaced in the model's own reading (delivery-contract.md:34-37).
 *
 * A lint tuned until it catches these would fire on every mention of a key name. The honest split is:
 * the lint holds the line on new violations, the registry names what is already there.
 */
export const E3_BACKLOG_KINDS = [...E3_KINDS, "other"];

const E3_PATTERNS = [
  { kind: "literal-json-skeleton", re: /```json|\{\s*"[a-z_]+"\s*:/i },
  { kind: "exactly-these-keys", re: /EXACTLY (?:these|one of|the)|keys EXACTLY|EXACTLY \{|closed enum|key set is closed|additionalProperties/i },
  // A quoted or backticked template carrying a <placeholder>, close to an instruction to emit it. The
  // placeholder class is deliberately loose (`<comma-separated DOMAINS>`, `<N>`, `<one record URI>`) —
  // the tell is a shape dictated for a parser to read back, not the casing inside the angle brackets.
  { kind: "dictated-line-shape", re: /(?:emit|write|include|output|state|add|append|end with|line|heading|row|bullet)[^.\n]{0,80}["'`\\][^"'`\n]{0,90}<[^>\n]{1,45}>/i },
];

/**
 * Count E3 violations in a block of instruction text, by kind.
 *
 * `skipLineComments` EXISTS BECAUSE THIS LINT CAUGHT ITS OWN SCAFFOLDING. The E1 declaration block
 * carries a comment reading "the class of each from the closed enum in …", which the exactly-these-keys
 * pattern matched in all 19 stages — inflating the committed ceiling by 19 and leaving room for 19 real
 * violations to land without tripping CI. E3 is about what a stage DISPATCHES to a model, and a `//`
 * comment is never dispatched, so comment lines are not instruction text.
 *
 * Only for .mjs sources: `//` is not a comment in the skill .md files, and a URL contains one.
 *
 * @param {string} text
 * @param {{skipLineComments?: boolean}} [opts]
 * @returns {Record<string, number>}
 */
export function e3Counts(text, { skipLineComments = false, stripDeclarations = false } = {}) {
  const out = Object.fromEntries(E3_KINDS.map((k) => [k, 0]));
  const src = stripDeclarations ? stripContractElements(String(text ?? "")) : String(text ?? "");
  for (const line of src.split("\n")) {
    if (skipLineComments && line.trimStart().startsWith("//")) continue;
    for (const { kind, re } of E3_PATTERNS) if (re.test(line)) out[kind]++;
  }
  return out;
}

/**
 * Remove the `contractElements: { … }` block from a stage's source.
 *
 * THE SAME LESSON, TWICE. The E1 declaration is prose ABOUT the contract and is never dispatched to a
 * model, but it necessarily quotes the shapes it classifies — element names like
 * "`- ord: <N>` (first body line)" and `why` text naming closed enums. Left in, the lint counts the
 * declaration as the violation it describes, and the ceiling rises every time the audit gets more
 * thorough. Skipping `//` comments caught the first version of this; the `why:` strings are code lines,
 * so they need the block removed rather than the comment skipped.
 *
 * Anchored on indentation, not on a brace count, because the element values contain braces.
 */
export function stripContractElements(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  let depth = null;
  for (const line of lines) {
    if (depth === null && /^(\s*)contractElements: \{$/.test(line)) {
      depth = line.match(/^(\s*)/)[1].length;
      continue;
    }
    if (depth !== null) {
      if (line === `${" ".repeat(depth)}},`) depth = null;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** e3Counts for a .mjs source: comments and E1 declarations are not instruction text. */
export const e3CountsMjs = (text) => e3Counts(text, { skipLineComments: true, stripDeclarations: true });

/**
 * The source ranges of each stage def in stages.mjs, so the lint can be scoped per stage.
 * @returns {Record<string, {from:number, to:number, text:string}>}
 */
export function stageSourceBlocks(stagesSource) {
  const lines = stagesSource.split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}"?([a-z][a-z0-9-]*)"?: \{$/);
    if (m) starts.push({ stage: m[1], from: i });
  }
  const out = {};
  for (let k = 0; k < starts.length; k++) {
    // A stage block ends where the next one begins, or at the table's closing brace.
    let to = k + 1 < starts.length ? starts[k + 1].from : lines.length;
    for (let i = starts[k].from + 1; i < to; i++) if (lines[i] === "};") { to = i; break; }
    out[starts[k].stage] = { from: starts[k].from + 1, to, text: lines.slice(starts[k].from, to).join("\n") };
  }
  return out;
}

/**
 * MECHANICAL **AND** UNSPOKEN-FOR — the highest-value target set for 's moves.
 *
 * An element in this set is not the model's judgment AND no validator polices it: nothing catches it
 * going wrong, and nothing about it needs a model. Every one is a candidate for the moves, and the set
 * is worth being able to find rather than reconstructing it from two other lists.
 *
 * @returns {Array<{stage:string, element:string, class:string}>}
 */
export function mechanicalAndUnspoken(stages) {
  return declaredElements(stages)
    .filter((r) => isMechanical(r.class) && r.tokens.length === 0)
    .map((r) => ({ stage: r.stage, element: r.element, class: r.class }));
}

// ── E3: DOES THE BACKLOG STILL DESCRIBE THE TREE? ────────────────────────────────────────────────────
//
// The registry has one failure mode nothing watched: a MOVE deletes a dictation and the row survives.
// The count then overstates the work left, the next agent spends a conversion slot on a hole that is
// already filled, and the file whose stated doctrine is "the headline is the backlog" is quietly wrong.
//
// Two instances existed the day this was written, and the second is the argument for the check being
// mechanical rather than a habit: M6 deleted register-digest's no-form arm on 2026-08-14 and left its
// row; and — landed that same morning, by the agent adding this check — interpolated synthesis's
// disposition list from its constant and left ITS row. Knowing about the disease did not prevent
// causing it four hours later.
//
// THE MATCH IS ON THE FILE, NEVER THE LINE. `where` carries a line number that drifts with every edit
// to stages.mjs, and the registry's own header says to read it as a pointer rather than a fact.

/**
 * The longest literal run of an evidence string — the part with no elision, no `${interpolation}` and
 * no `<placeholder>`, since those are exactly what a faithful quote cannot reproduce. PURE.
 */
export function evidenceAnchor(evidence) {
  return String(evidence ?? "")
    .split(/…|\$\{[^}]*\}|<[^>\n]{1,45}>|\\n/)
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

/** Whitespace- and escape-normalised, so a re-wrapped line is not read as a deleted one. PURE. */
export const normalizeQuote = (s) => String(s ?? "").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();

/**
 * EVERY repo-relative source path named in a `where` string, in order, de-duplicated. PURE.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────
 *
 * `where` was read as `String(e.where).split(":")[0]` — THE FIRST PATH, ALWAYS. Five of the backlog's rows
 * name more than one FILE: a dictation in `stages.mjs` AND its skill file, a rule "restated at
 * synthesis-rules.md", report-card's host table dictated in `delivery-contract.md`. **For every one of
 * those the second site was never checked**, so a dictation could be deleted there and this check would
 * report nothing — which is precisely the failure it exists to catch, one level up, inside the checker.
 *
 * A path needs at least one `/` so a bare "SKILL.md" in prose cannot masquerade as a location. The same
 * file named at two line numbers is ONE site: counting it twice is how "ten multi-file rows" was
 * over-reported by 2x before this function existed to answer the question.
 */
export function wherePaths(where) {
  const hits = [...String(where ?? "").matchAll(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:mjs|md|json)/g)]
    .map((m) => m[0]);
  return [...new Set(hits)];
}

/**
 * Backlog entries whose evidence no longer appears in ANY file `where` names.
 *
 * `readFile` is injected so this stays pure and testable on an invented corpus. An unreadable file is
 * REPORTED (`reason: "unreadable"`), never skipped — a registry pointing at a file that is gone is a
 * finding, and the silent-skip version of this check would go quiet exactly when a whole surface moved.
 *
 * AN ANCHOR UNDER 12 CHARACTERS IS NOT JUDGED. Too short to be evidence of anything: it would match
 * somewhere in almost any file and report a confident pass. Those entries are returned with
 * `reason: "anchor-too-short"` so they are visible as unjudged rather than counted as verified —
 * the distinction this codebase has paid for seven times.
 */
export function backlogEvidenceMisses(backlog, readFile) {
  const out = [];
  for (const e of backlog ?? []) {
    const sites = wherePaths(e?.where);
    const file = sites[0] ?? String(e?.where ?? "").split(":")[0].trim();
    // A `where` naming no resolvable path is an ABSENCE, not a pass — it would otherwise be checked
    // against "" and silently found.
    if (!sites.length) { out.push({ stage: e.stage, file, sites: [], reason: "no-path-in-where", anchor: "" }); continue; }

    const read = sites.map((p) => { try { return { p, src: readFile(p) }; } catch { return { p, src: null }; } });
    // EVERY unreadable site is its own finding — including the second one, which is the whole point.
    for (const u of read.filter((r) => r.src == null))
      out.push({ stage: e.stage, file: u.p, sites, reason: "unreadable", anchor: "" });
    const readable = read.filter((r) => r.src != null);
    if (!readable.length) continue;

    const anchor = normalizeQuote(evidenceAnchor(e.evidence));
    if (anchor.length < 12) { out.push({ stage: e.stage, file, sites, reason: "anchor-too-short", anchor }); continue; }
    // FOUND-IN-ANY, NOT FOUND-IN-EVERY. A multi-file `where` says "authored here, restated there", and
    // the `evidence` is often a COMPOSITE stitched across both; requiring the anchor at every site would
    // fail rows for being written the way the registry writes them. The question is whether the row has
    // outlived its dictation, and a dictation found at any named site has not been outlived.
    if (!readable.some((r) => normalizeQuote(r.src).includes(anchor)))
      out.push({ stage: e.stage, file, sites, reason: "not-found", anchor });
  }
  return out;
}

/**
 * Every backlog row whose `where` LINE NUMBER does not point at the dictation it describes. PURE given
 * `readFile`. Returns `{ misses, notChecked }` — the second is never folded into "pass".
 *
 * ── WHY THIS IS NOT `backlogEvidenceMisses` ──────────────────────────────────────────────────────────
 *
 * That one asks whether the row has OUTLIVED its dictation, and it reads the FILE: found anywhere in
 * any named site is a pass. It is blind to the line number by construction, and correctly so — a row
 * whose dictation moved has not outlived anything.
 *
 * But the line number is the half a reader actually uses, and NOTHING checked it. Measured on this file
 * 2026-08-23: **25 of 36 decidable rows pointed at the wrong line**, every one of them into
 * `stages.mjs`, drifting +909 to +1737 lines. The drifts CLUSTER — eleven rows at exactly +1395, five at
 * +1422 — because whole blocks moved together and no citation followed. Every one of those rows passed
 * `backlogEvidenceMisses` on the same run, which is the point: the two questions are different.
 *
 * ── WHY `notChecked` IS RETURNED RATHER THAN DROPPED ─────────────────────────────────────────────────
 *
 * An anchor that cannot be located is UNDECIDED, not correct. Folding it into the pass would rebuild the
 * false-clean this whole family of checks exists to remove, so it comes back as its own list with its own
 * reason and the caller pins the count.
 */
export function backlogLineMisses(backlog, readFile) {
  const misses = [], notChecked = [];
  for (const e of backlog ?? []) {
    const where = String(e?.where ?? "");
    // THE LEADING CITATION, not the whole string.: this was anchored with `$`, so a perfectly good
    // citation carrying a note — `driver/stages.mjs:<line> (restated at …synthesis-rules.md:<line>)` — was
    // ILLUSTRATIVE, AND THE NUMBERS ARE GONE ON PURPOSE. It carried real ones, and
    // the citation gate read the example as a live pointer: the lines moved with a doctrine split and the
    // gate reported a blank target in a comment that references nothing. A cautionary example lands as a
    // live reference — the same way a backticked issue ref still linkifies — so the shape stays and the
    // numbers do not.
    // declined for having PROSE, not for being ambiguous. A format rule doing a semantics job.
    //
    // AND THE EXEMPTION CORRELATED WITH THE DEFECT, which is what made it worth fixing rather than
    // documenting: a citation carries a parenthetical precisely when it points at several sites or a
    // restatement, and those are the rows most likely to drift. Two of the eleven it declined were wrong
    // by exactly +1395 — the same cluster this guard was built to find and names in its own commit.
    //
    // The parenthetical is commentary about OTHER sites; the primary citation is the one a reader
    // follows, so checking it loses nothing. A `where` that does not START with a citation is still
    // undecided.
    const m = where.match(/^([A-Za-z0-9_.\-\/]+\.(?:mjs|js|md|json)):(\d+)(?:\s*-\s*(\d+))?(?=$|[^\d-])/);
    if (!m) { notChecked.push({ stage: e?.stage, where, reason: "not-a-plain-citation" }); continue; }
    const [, file, a, b] = m;
    const lo = Number(a), hi = b ? Number(b) : Number(a);
    let src = null;
    try { src = readFile(file); } catch { src = null; }
    if (src == null) { notChecked.push({ stage: e?.stage, where, reason: "unreadable" }); continue; }
    const anchor = normalizeQuote(evidenceAnchor(e?.evidence));
    if (anchor.length < 12) { notChecked.push({ stage: e?.stage, where, reason: "anchor-too-short" }); continue; }
    const wins = anchorWindows(src, anchor);
    if (!wins.length) { notChecked.push({ stage: e?.stage, where, reason: "anchor-not-found" }); continue; }
    // FOUND-IN-ANY, matching backlogEvidenceMisses: a dictation restated twice is cited correctly by
    // either. Taking the FIRST window instead made a bold heading that restates a spec outrank the spec,
    // which read as a 2-line defect that was not one.
    if (wins.some((w) => lo <= w.end && hi >= w.start)) continue;
    const nearest = wins.reduce((x, y) => Math.abs(y.start - lo) < Math.abs(x.start - lo) ? y : x);
    misses.push({ stage: e?.stage, where, file, cited: lo, actual: nearest.start, drift: nearest.start - lo });
  }
  return { misses, notChecked };
}

/**
 * Every line window carrying `anchor`, as 1-based {start, end}. PURE.
 *
 * The window is grown BACKWARD from each candidate END. Growing the START forward instead returns
 * `end - cap` every time — any start before the real one still contains the anchor once the end reaches
 * it, so the smallest start wins and it is always the cap away. That bug reported `span: 40` on every
 * row and would have moved every repair by up to 40 lines.
 */
export function anchorWindows(src, anchor, cap = 40) {
  const lines = String(src).split("\n");
  const found = [];
  for (let e = 0; e < lines.length; e++) {
    let acc = "";
    for (let s = e; s >= Math.max(0, e - cap + 1); s--) {
      acc = acc ? normalizeQuote(lines[s]) + " " + acc : normalizeQuote(lines[s]);
      if (acc.includes(anchor)) { found.push({ start: s + 1, end: e + 1 }); break; }
    }
  }
  const merged = [];
  for (const w of found) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}


// ── E3, SECOND AXIS: THE DELIVERY SURFACE ────────────────────────────────────────────────────
//
// `backlogEvidenceMisses` asks ONE question — "is this quote in this file?" — and `where` is a list of
// FILE PATHS with no column for HOW the text reaches the model. So a dictation that moves out of a stage
// message and into a tool answer is, to E3, indistinguishable from one that was deleted: both read as
// "the quote is not in that file". The row still fails, so the check is not silent — but it fails for a
// reason it cannot name, and both repairs a reader reaches for (re-quote it, or retire it) are wrong.
//
// That matters because the migration is deliberate: dictations are moving into tool responses as policy,
// and each move takes a row out of E3's sight while the count stays plausible the whole way down.
//
// ── THE AUTHORED SITE DOES NOT DETERMINE THE SURFACE, AND ONE LIVE ROW PROVES IT ─────────────────────
//
// Measured before choosing, per this file family's own precedent ("A BLANKET ASSERTION WAS THE OBVIOUS
// BUILD AND IT WOULD HAVE BEEN NOISE"). Two candidate derivations were run over all 51 rows:
//
//   from the file that CONTAINS the anchor      wrong for common-law-half: the text is authored in
//                                               connotation-search.mjs, which by itself looks like a
//                                               driver module, and is delivered by perplexity-server.mjs
//   from an MCP import closure over the paths   over-attributes. Transitively, coverage-form.mjs becomes
//                                               a "tool response" through coverage-server → coverage-tool
//                                               → coverage-form, when pipeline.mjs:3553 in fact appends
//                                               its brief to the STAGE MESSAGE
//
// Both are wrong on a real row, so neither ships. The surface is DECLARED, and what the code does is
// REFUTE a declaration — it is not a classifier and cannot become one, because the whole finding is that
// text authored in one file is delivered through another. `CONTRACT_CLASSES` made this move already:
// there is no bare `mechanical` because "'mechanical' alone is a label a defect can wear."
//
// So a declaration must be WITNESSED by a path the row already names. A row claiming `tool-response`
// names a server module; a row claiming `skill-file` names a .md some stage actually reads. Move a
// dictation into a tool answer and update `where`, and the `stage-message` witness disappears — the
// surface change is its own red. Move it and DON'T update `where`, and the anchor stops resolving, and
// `backlogSurfaceMoves` below finds it on the surface it went to and says so by name.
export const E3_SURFACES = ["stage-message", "tool-response", "skill-file", "driver-written-form"];

/**
 * Every surface a single path can WITNESS, from the closed enum. PURE — the tree is injected.
 *
 * `skillReads` and `servers` are DERIVED by the caller and never recited: a recited skill list stops
 * covering a stage the day one is added, and the lint then reports clean because it never looked (the
 * rule contract-e3-baseline.mjs states for the same reason).
 *
 * `driver-written-form` is the residue and is marked as such deliberately: it is the honest home for a
 * dictation authored into a form the driver writes and the seat fills in, and there is no path shape
 * that identifies one. It witnesses nothing on its own, so a row declaring it is making a claim this
 * code cannot refute — which is why the census below is pinned exactly rather than left to grow.
 *
 * @param {string} path repo-relative
 * @param {{skillReads:Iterable<string>, servers:Iterable<string>}} tree
 * @returns {string[]}
 */
export function surfaceWitnesses(path, { skillReads = [], servers = [] } = {}) {
  const p = String(path ?? "");
  const skills = new Set([...skillReads].map((r) => (r.startsWith("driver/") ? r : `driver/${r}`)));
  const out = [];
  if (/^driver\/stages(-knockout)?\.mjs$/.test(p)) out.push("stage-message");
  if (skills.has(p)) out.push("skill-file");
  if ([...servers].includes(p)) out.push("tool-response");
  if (!out.length && /^driver\/.*\.mjs$/.test(p)) out.push("driver-written-form");
  return out;
}

/**
 * Backlog rows whose declared `surface` is missing, off-enum, or unwitnessed by any path they name.
 *
 * THE PARTITION IS CLOSED AND ASSERTED, NOT FILLED BY OMISSION. A row with no `surface` is reported
 * (`surface-absent`), never defaulted — a mandatory key quietly filled with a guess is how a present-but-
 * empty field comes to be cited later as a measurement.
 *
 * @returns {Array<{stage:string, reason:string, declared:string, witnessed:string[]}>}
 */
export function backlogSurfaceMisses(backlog, tree = {}) {
  const out = [];
  for (const e of backlog ?? []) {
    const declared = String(e?.surface ?? "");
    const witnessed = [...new Set(wherePaths(e?.where).flatMap((p) => surfaceWitnesses(p, tree)))];
    if (!declared) { out.push({ stage: e?.stage, reason: "surface-absent", declared, witnessed }); continue; }
    if (!E3_SURFACES.includes(declared)) { out.push({ stage: e?.stage, reason: "surface-off-enum", declared, witnessed }); continue; }
    if (!witnessed.includes(declared))
      out.push({ stage: e?.stage, reason: "surface-unwitnessed", declared, witnessed });
  }
  return out;
}

/** How many rows sit on each surface, zero-filled so a surface losing its last row is 0, not absent. */
export function surfaceCensus(backlog) {
  const out = Object.fromEntries(E3_SURFACES.map((s) => [s, 0]));
  for (const e of backlog ?? []) if (e?.surface in out) out[e.surface]++;
  return out;
}

/**
 * THE AXIS ITSELF: a row whose anchor is absent from every path it names, but PRESENT somewhere else —
 * reported with the file it moved to and that file's surface.
 *
 * This is the distinction exists for. Without it a moved dictation and a deleted one are the same
 * red, and the reader re-quotes or retires a row that should have been re-declared onto a new surface.
 *
 * `corpus` is INJECTED, and it must exclude this repo's own registers. `contract-e3-backlog.mjs` quotes
 * every anchor verbatim by construction, so a corpus containing it reports all 51 rows as moved into it
 * — a spectacular finding that is purely an artifact of the search. `driver/test/` and
 * `contract-e3-baseline.mjs` carry planted and anchored quotes for the same reason. The exclusion is
 * asserted in the test, because if it silently regresses this list becomes noise while staying green.
 *
 * @param {Array} backlog
 * @param {(p:string)=>string|null} readFile
 * @param {string[]} corpus repo-relative paths to search, registers excluded
 * @returns {Array<{stage:string, sites:string[], foundIn:string, surface:string[], anchor:string}>}
 */
export function backlogSurfaceMoves(backlog, readFile, corpus = [], tree = {}) {
  const out = [];
  const read = (p) => { try { return normalizeQuote(readFile(p)); } catch { return null; } };
  for (const e of backlog ?? []) {
    const sites = wherePaths(e?.where);
    const anchor = normalizeQuote(evidenceAnchor(e?.evidence));
    // Rows with no path and rows with an unjudgeable anchor are already reported by
    // backlogEvidenceMisses under their own reasons; re-reporting them here would double-count them.
    if (!sites.length || anchor.length < 12) continue;
    if (sites.some((p) => (read(p) ?? "").includes(anchor))) continue;
    for (const p of corpus) {
      if (sites.includes(p)) continue;
      if ((read(p) ?? "").includes(anchor))
        out.push({ stage: e.stage, sites, foundIn: p, surface: surfaceWitnesses(p, tree), anchor });
    }
  }
  return out;
}
