// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ONE ANSWER TO "WHAT DOES THIS SCREEN ACTUALLY SAY?"
//
// Seven test files asked that question and seven answered it themselves, because the commentary in this
// tree deliberately restates the thing it sits above: the header of one screen says the words "on a
// report" while explaining that the claim was wrong, so a search over the whole file matches the
// explanation and passes a screen that still lies to the reader.
//
// Six of the seven copies missed a JSX comment. `{/*` is not `/*`, and the lines beneath it open with
// ordinary words, so a line filter anchored to comment openers walks straight past the span. Measured
// when this was written: 20 files under src/ carry one, 187 spans, 11,908 words of commentary reaching
// assertions about what a client sees. It cost a real arm — one counting the routes into the archive
// counted a NOTE about a button as a button, and went green the moment the second button was removed,
// which it would have done for any number of buttons as long as the note stayed.
//
// The seventh copy had drifted the other way and is the reason this is one function rather than a rule:
// it stripped block spans the others did not, and omitted `/*` from the openers the others had. Nobody
// chose either difference.

/**
 * A source file with its commentary removed — what is left is what a reader can end up seeing.
 *
 * WHICH LINE DOES WHAT, because two of the three overlap and a comment claiming otherwise would be the
 * same failure this file exists to fix, written in prose. A JSX comment contains a block comment, so
 * the second replace removes its WORDS either way; the first earns its place by taking the braces with
 * them, since a stripped `{/* … *\/}` otherwise leaves `{}` behind — a token the source never had, in
 * a string other arms go on to read structurally. The third reaches a whole-line comment the other two
 * do not, and the second reaches an INLINE span the third cannot. Each of the three has a case only it
 * covers, and the driven test carries one per line.
 *
 * The six copies that were blind had only the third. A line filter anchored to comment openers walks
 * past `{/*` and past every ordinary word beneath it. The seventh had the block span as well and was,
 * for that reason alone, the only one of the seven that could see a JSX comment at all.
 */
export const prose = (src: string): string =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')
