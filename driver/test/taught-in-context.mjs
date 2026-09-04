// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// taught-in-context.mjs — "is this token TAUGHT, or does the string merely occur?"
//
//. ` DIRECTION 3` asks the right question — for every closed vocabulary a gate enforces, is
// every member reachable by the seat being judged? — and answered it with `taught.includes(token)` over
// a corpus of several hundred KB of prose. For a distinctive token (`no_recorded_queries`) that is
// sound. For a short ordinary-English one it is vacuous:
//
//     CORRECTION_KINDS = ["coverage-disposition", "fact", "rating", "narrative"]
//
// measured against the ONE file whose reader writes them, `fact` and `narrative` were "taught" by bare
// substring and appeared nowhere as values. Three of four were unreachable by the reviewer and the
// sweep was green over all three. The consequence is: the parser fails safe toward `fact`, so an
// untyped review read as a page of factual errors rather than as an empty channel.
//
// ── THE RULE: A TOKEN IS TAUGHT WHERE IT OCCURS AS A VALUE ──────────────────────────────────────────
//
// Not a length floor and not a commonness floor — this codebase refuses arbitrary numbers, and rightly.
// One mechanical question, asked of every vocabulary the same way: does this string ever occur in a
// position where a reader can only read it as one of the permitted answers?
//
//     `fact`      "fact"      | fact |      consent / fact / rating      kind: fact
//
// versus the same letters in a sentence, which teach nobody anything:
//
//     "…state the FACT that conditions reliance"      "as a matter of fact"
//
// The forms below are the ones this corpus actually uses, read off it rather than imagined: code spans,
// quotes, markdown table cells, slash- and pipe- and comma-alternations, `key: value`, and a list item
// whose gloss follows a dash. A token in ANY of them counts.
//
// WHY NOT SCOPE THE CORPUS TO THE EMITTING SEAT (the issue's shape 2). Strictly better and strictly more
// work — it needs a per-vocabulary map from token set to seat, which is a second copy of a relationship
// nothing else states, free to drift the moment a stage's skillReads change. This rule needs no such
// map: it is the same question everywhere. Shape 2 remains available for a vocabulary that earns it —
// already does it by hand for CORRECTION_KINDS, against the one file it belongs to.

/** Characters that may not sit against a token — otherwise `fact` matches inside `factual`, and
 *  `senior-clearance` inside `senior-clearance-required`. Hyphen included BECAUSE tokens carry it. */
const WORDISH = /[A-Za-z0-9_-]/;

/**
 * Openers a value may sit directly after. `(` and `[` cover "(one of: a, b)" and "[fact]"; `-` and `*`
 * cover a markdown bullet whose whole item is the token; `>` covers a blockquoted example.
 */
const OPEN = /[`"'|,:=([{>*-]\s*$/;

/**
 * Closers a value may sit directly before. The dash forms are a list item with a gloss after it —
 * "fact — a factual error in the narrative" — which is the commonest way this tree teaches a token.
 */
const CLOSE = /^\s*(?:[`"'|,:;.)\]}]|$|\r?\n|[—–-]\s|\(\s)/;

/**
 * A slash- or pipe-alternation member, on either side: `owner-site / independent / register-mirror`.
 *
 * This exists because the FIRST member of an alternation is introduced by prose — "EXACTLY one of
 * owner-site / independent / register-mirror" — so its left context is a word, and the paired test
 * below would call the one token the reader meets first untaught while passing the other two. Measured:
 * that mis-scored 4 of the 10 vocabularies this rule reports.
 *
 * Slash and pipe only. A COMMA is not enough on its own — "as a matter of fact, the rating" would then
 * teach `fact`, which is the exact vacuity exists to remove.
 *
 * A PIPE needs no surrounding space, because the corpus writes both forms and the tight one is a real
 * teaching: `registrability = registrable|registrable-with-conditions|obstructed`. A tight SLASH gets no
 * such licence — `skills/prelim-search/SKILL.md` is a path, not an alternation, and every skill
 * reference in this tree is one.
 */
const ALT_AFTER = /^(?:\s*[/|]\s|\|)/;
const ALT_BEFORE = /(?:\s[/|]\s*|\|)$/;

/**
 * True when `token` occurs at least once as a VALUE in `corpus`.
 *
 * PURE, and deliberately answers about the whole corpus rather than per file: DIRECTION 3's question is
 * "can the seat reach it", and the seat reads the tree plus its dispatch as one body of instruction.
 */
export function taughtAsValue(token, corpus) {
  const t = String(token ?? "");
  const text = String(corpus ?? "");
  if (!t) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(t, from);
    if (at < 0) return false;
    from = at + 1;
    const before = text.slice(Math.max(0, at - 40), at);
    const after = text.slice(at + t.length, at + t.length + 40);
    // A longer identifier that merely contains the token teaches nothing about the token.
    if (WORDISH.test(before.slice(-1)) || WORDISH.test(after.slice(0, 1))) continue;
    if (ALT_AFTER.test(after) || ALT_BEFORE.test(before)) return true;
    if (OPEN.test(before) && CLOSE.test(after)) return true;
  }
}

/** The tokens of `tokens` that the corpus never states as a value. */
export function untaughtTokens(tokens, corpus) {
  return (Array.isArray(tokens) ? tokens : []).filter((t) => !taughtAsValue(t, corpus));
}
