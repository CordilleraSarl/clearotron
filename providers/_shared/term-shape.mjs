// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// term-shape.mjs — the ONE vocabulary for "is this string a searchable mark term, and does it agree
// with its predicate?" (plan & dispatch determinism — the A1/A2 fix).
//
// Two defect classes shipped as SILENT CLEANS, and both were shape-vs-predicate
// disagreements nobody checked:
//
//   * WILDCARD-UNDER-LITERAL: the frozen plan carried {predicate:"exact", term:"TIKI*"} ×4. Dispatch
//     never inspects term characters on a literal predicate, so the provider searched the star as a
//     character, found nothing, and the band recorded state:"enumerated", total_hits:0 — a
//     schema-level confident clean over a slice that was never really searched.
//   * LABEL-AS-TERM: a frame-diff directive's display label ("Reverse-order TIKI composites
//     (TROPICAL TIKI, ISLAND TIKI)") was dispatched verbatim as a mark term. Structured transport,
//     prose value — same nil search, same false clean.
//
// This module is the shared detector all four seams call: the plan freeze-lint
// (register-plan.mjs validatePlanFeasibility), the proposal mint (engine/mcp/supplemental.mjs
// rejected[] ladder), the executor's defence-in-depth (execute-plan.mjs plan-defect refusal), and the
// frame-diff variant fallback (frame-diff-model.mjs deriveDirectiveRemedy → disclose).
//
// PROVIDER-AGNOSTIC BY CONSTRUCTION: these checks operate at the PLAN PREDICATE level, above any
// capability mapping — whether a provider maps `wildcard` to starts_with/ends_with or to a native `*`
// pattern is irrelevant to whether a star-anchored string may ride a literal predicate.
//
// The escape hatch: an entry/proposal carrying `term_literal: true` asserts "this string IS the mark,
// verbatim — lint it no further" (a genuine multi-word slogan mark, a mark with an anchored star).
// The compiler stamps it on manifest-derived terms whose shape would otherwise trip the lint (the
// manifest is the ratified mark vocabulary — provenance, not shape, is what distinguishes a 6-word
// slogan mark from prose). Minted/hand-authored entries must earn it explicitly.
//
// PURE (no node imports) → tests offline.

/**
 * An ANCHORED `*` — leading or trailing — is wildcard syntax. An INFIX star is not: marks like
 * E*TRADE legitimately carry one, and the executor's anchoring map (planPredicateParams) only ever
 * strips leading/trailing stars. `?` is NEVER plan syntax (a mark like GUESS? carries it literally;
 * no plan predicate maps it), so it contributes nothing here.
 */
export function hasAnchoredWildcard(term) {
  const t = String(term ?? "").trim();
  if (!t) return false;
  return t.startsWith("*") || t.endsWith("*");
}

// The predicates whose term is searched as LITERAL mark text (the star would be a character, not an
// operator). `owner` is exempt from ALL term-shape rules: owner names are legitimately long prose-shaped
// strings ("MONSTER ENERGY COMPANY, SOCIÉTÉ ORGANISÉE SELON LES LOIS DE L'ETAT DU DELAWARE") and ride
// their own field.
const LITERAL_PREDICATES = new Set(["exact", "default", "phonetic"]);

/**
 * Does the term's shape DISAGREE with its predicate? Returns the plain-English issue, or null.
 * Both directions:
 *   - anchored-`*` term under a literal predicate → the star is searched as a character → false clean;
 *   - `wildcard` predicate over a term with no `*` at all → nothing to anchor, the pattern is a lie.
 */
export function termPredicateIssue(term, predicate) {
  const t = String(term ?? "").trim();
  const p = String(predicate ?? "");
  if (!t) return null;                       // emptiness is its own (existing) feasibility rule
  if (LITERAL_PREDICATES.has(p) && hasAnchoredWildcard(t))
    return `wildcard-shaped term "${t.slice(0, 40)}" under literal predicate "${p}" — the provider searches the star as a character and returns a confident 0 over marks that exist (a false clean). Use predicate "wildcard", or stamp term_literal:true if the mark really carries an anchored star`;
  // `?` IS pattern syntax on the wildcard predicate (form-neighbourhood mints single-char patterns
  // like n?v?p?ls?; the executor hands the raw pattern to the provider default) — it just never makes
  // a term wildcard-SHAPED under a literal predicate (GUESS? is a mark).
  if (p === "wildcard" && !/[*?]/.test(t))
    return `predicate "wildcard" over "${t.slice(0, 40)}" which carries neither \`*\` nor \`?\` — there is no pattern to anchor; use a literal predicate`;
  return null;
}

// — MARKUP IS NOT A SHAPE JUDGEMENT, SO IT IS NEVER SHIELDABLE AND NEVER WORD-COUNTED.
//
// R2b died at fan-in on a plan carrying its own section headings as search terms:
//
//   term="**Core (BIOVELTRIN, BIO VELTRIN, BIO-VELTRIN, etc.)**"    predicate=default
//   term="**Formative root (VELTRIN, DELPHIN, DELPHINUS, etc.)**"   predicate=default
//
// Twenty minutes earlier the same matter on the same commit delivered clean, and the only difference
// was those two strings. Both happened to be 6 words, so they tripped the >4-word arm below by luck;
// a one-word `**BIOVELTRIN**` trips nothing at all, dispatches literally, and comes back
// state:"enumerated", total_hits:0 — a false clean, quieter than the failure.
//
// The three arms are the ones the issue names, and NOT the bracket: `predicate:"owner"` rows carry
// parenthesised company names ("Delphi Technologies (BorgWarner Inc.)") and a bracket rule breaks
// owner search, which is the very lane this screen protects. Every arm fires at ANY word count.
//
//   `**` / `__`     markdown emphasis. No register indexes it; a mark cannot contain it.
//   `# ` … `###### `  a heading marker. The TRAILING SPACE IS REQUIRED — `#LIKEAGIRL` is a real mark.
//   `, etc.` / `, …`  an enumeration: the string stands for a GROUP of terms, so no single literal
//                     can search it. This is the half that survives when the emphasis is stripped.
//
// Markup also bypasses the `term_literal:true` escape hatch (see entryTermIssues). That hatch means
// "this string IS the mark, verbatim" — a claim a `**`-wrapped string cannot truthfully make, and a
// model can set it itself on a supplemental proposal. Shielded, it is a nil search wearing a receipt.
const MARKUP_ARMS = [
  [/\*\*|__/, "markdown emphasis"],
  [/^\s*#{1,6}\s/, "a markdown heading marker"],
  [/,\s*(?:etc\b\.?|…|\.\.\.)/i, 'a ", etc." enumeration — the string stands for a GROUP of terms, and no single literal can search a group'],
];

/**
 * Is the string MARKUP or an enumeration rather than a mark term? Returns the plain-English issue,
 * or null. Fires at any word count, on any predicate but `owner` (the caller exempts that).
 *
 * The message is written in the frame-diff guard's remedy shape — name the row, name what is wrong,
 * then say WHAT TO SEARCH — because the stage that authored the string is the one that has to
 * restate it, and "invalid term" tells it nothing it can act on.
 */
/**
 * ANNOTATION shape — a term carrying a note about what it stands for, rather than the mark itself.
 * Parenthetical, sentence punctuation, space-flanked slash. Returns the WHY, or null. PURE.
 *
 * LENGTH-INDEPENDENT BY DESIGN, and that is the whole point of keeping it separate from the prose/
 * long-form arm. A slogan mark has a legitimately long dominant element and cannot be restated any
 * shorter, so refusing a value for BEING LONG is right at the compiler and wrong at a corrective
 * stage gate — it hands back a reason with no remedy. An annotation always has a remedy: delete the
 * note, keep the term. — that is also why it may sit ABOVE a word-count floor: `ZEPHYR (root)`
 * is an annotation by no measure a word count can see, exactly as 's one-word `**BIOVELTRIN**`
 * was markup by no measure a word count could see.
 *
 * Moved here from variant-manifest-model.mjs so the stage gate and the plan compiler share
 * ONE predicate instead of two that drifted: the gate's caught a lone `)` and the compiler's did not.
 */
export function termAnnotationIssue(term) {
  const t = String(term ?? "").trim();
  if (t.includes("(") || t.includes(")")) return "parenthetical";
  if (t.includes("—") || t.includes(";")) return "sentence punctuation";
  if (/\s\/\s/.test(t)) return "space-flanked slash";
  return null;
}

export function termMarkupIssue(term) {
  const t = String(term ?? "").trim();
  if (!t) return null;
  const why = MARKUP_ARMS.filter(([re]) => re.test(t)).map(([, w]) => w);
  if (!why.length) return null;
  return `"${t.slice(0, 60)}" is not a searchable mark term (${why.join("; and ")}). Dispatched literally it returns a confident 0 over marks that exist — a nil search that reads as CLEAN — so it is refused here rather than at fan-in. Supply the mark-shaped term(s) it stands for: {terms:["…","…"], nice_classes:[…]}. Say WHAT to search, not what the group is called`;
}

/**
 * Is the string PROSE/LABEL-shaped rather than mark-shaped? Returns the plain-English issue, or null.
 * Markup first ( — that arm has no word floor and no escape hatch), then, and deliberately
 * conservative — it NEVER fires on ≤2 words (no genuine short mark is collateral):
 *   - more than 4 words (across a plan's 86 exact terms: every genuine mark/slogan ≤7 words,
 *     the one prose term was 14 — but 4 is the bound because a >4-word MARK is exactly what the
 *     compiler's manifest-provenance term_literal stamp exists for);
 *   - `(` — a parenthetical is annotation, never mark text;
 *   - `—` (em-dash) or `;` — sentence punctuation;
 *   - a space-flanked `/` — an enumeration separator ("TIKTOK / TIK- family"), NOT the tight slash
 *     marks legitimately carry (24/7, GUNS N/ROSES).
 */
export function termShapeIssue(term) {
  const t = String(term ?? "").trim();
  if (!t) return null;
  const markup = termMarkupIssue(t);
  if (markup) return markup;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return null;
  const label = (why) => `"${t.slice(0, 60)}" is label/prose-shaped (${why}) — dispatching it as a mark term is a nil search that reads as a clean; supply the mark-shaped term(s) it stands for, or stamp term_literal:true for a genuine mark of this shape`;
  if (words.length > 4) return label(`${words.length} words`);
  if (t.includes("(")) return label("parenthetical");
  if (t.includes("—") || t.includes(";")) return label("sentence punctuation");
  if (/\s\/\s/.test(t)) return label("space-flanked slash");
  return null;
}

/**
 * Every term-shape/term-predicate issue on ONE plan entry (or minted proposal) — the seam-shared
 * walk. Returns [{ term, issue }]; [] means the entry's terms agree with its predicate.
 *
 * TWO EXEMPTIONS, AND THEY ARE NOT THE SAME EXEMPTION:
 *
 *   `predicate: "owner"` is exempt from EVERYTHING, first, before any other test. Owner names are
 *   long, prose-shaped and parenthesised by nature ("Delphi Technologies (BorgWarner Inc.)"), they
 *   ride their own field, and the cross-check lane mints them — so this is what makes it safe to
 *   screen that lane at all.
 *
 *   `term_literal: true` shields only the SHAPE and PREDICATE arms. It asserts "this string IS the
 *   mark, verbatim", which a genuine 6-word slogan mark can truthfully claim and a `**`-wrapped
 *   string cannot. It used to be a blanket early return, and that is a hole rather than a hatch: a
 *   model sets the flag itself on a supplemental proposal (engine/mcp/supplemental.mjs), and the
 *   executor runs this same walk — so a shielded `**BIOVELTRIN**` reached the wire, enumerated
 *   nothing, and recorded state:"enumerated", total_hits:0. Quieter than the run that died.
 */
export function entryTermIssues(entry) {
  const e = entry ?? {};
  const predicate = String(e.predicate ?? "default");
  const literal = e.term_literal === true;
  const terms = Array.isArray(e.terms) ? e.terms : e.term != null ? [e.term] : [];
  const out = [];

  // ── THE ONE RULE THE OWNER EXEMPTION DOES NOT COVER ─────────────────────────────────────────
  //
  // `predicate:"owner"` used to return on the line above, before any term was looked at, because owner
  // names are legitimately long and prose-shaped and every shape rule below would maul them. That
  // exemption is right and it stays. What it ALSO did was let through a term with nothing in it: on
  // a measured run the engine built an applicant-name query that was A SINGLE PERIOD, and it shipped as
  // the slice "primary-sweep / owner: ." with two HTTP 400 APPLICANT_NAME deferrals.
  //
  // Substance is not a shape judgement. A string carrying no letter and no digit cannot be a mark and
  // cannot be a company — there is nothing in it for any provider to match, under any predicate. So it
  // runs FIRST, for every predicate, and `term_literal` does not shield it, for the same reason markup
  // is not shielded: that stamp claims "this string IS the mark, verbatim", and no punctuation run can
  // make that claim truthfully.
  for (const t of terms) {
    const issue = termSubstanceIssue(t);
    if (issue) out.push({ term: String(t ?? ""), issue });
  }
  if (out.length || predicate === "owner") return out;

  for (const t of terms) {
    const issue = termMarkupIssue(t)
      ?? (literal ? null : (termPredicateIssue(t, predicate) ?? termShapeIssue(t)));
    if (issue) out.push({ term: String(t ?? ""), issue });
  }
  return out;
}

/**
 * Is there anything in this term to search? Returns the plain-English issue, or null.
 *
 * The floor under every other rule in this file, and the only one that reaches `owner` rows. EMPTY stays
 * the feasibility rule's business, as everywhere here — this is about a term that is PRESENT and carries
 * no searchable content: ".", "-", "…", "()", a stray bullet.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. The provider bounces such a query (HTTP 400), the run discloses
 * it as a coverage gap, and the client is correctly told the slice could not be searched. So the defect
 * ships as HONEST OUTPUT — better for the reader, and worse for anyone hoping to notice that the engine
 * asked a question which could never have had an answer. Refusing it here turns a bounced query into a
 * refused one, at the builder, before a paid call.
 *
 * UNICODE-AWARE ON PURPOSE: `\p{L}`/`\p{N}`, never `[a-z0-9]`. A CJK, Cyrillic or Arabic mark carries no
 * ASCII letter, and an ASCII floor would refuse exactly the marks the jx lane exists to search.
 *
 * PURE.
 */
export function termSubstanceIssue(term) {
  const t = String(term ?? "").trim();
  if (!t) return null;
  if (/[\p{L}\p{N}]/u.test(t)) return null;
  return `term "${t.slice(0, 40)}" carries no letter or digit — there is nothing in it for a provider to `
    + `match, under any predicate. Refused at the builder rather than bounced by the provider and `
    + `disclosed as a coverage gap the run could never have closed`;
}
