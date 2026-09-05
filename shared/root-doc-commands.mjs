// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// root-doc-commands.mjs — one owner for "does this command form work for the reader who followed this
// document".
//
// The rule lived inside `driver/test/the-readmes-commands-run-as-written.test.mjs`, where it could only
// ever be asked of the documents already in the checkout. On 2026-09-05 the release pipeline wrote a
// CHANGELOG.md that broke it — a note about `clearotron doctor`, correct plain English, in a generated
// file that had not told the reader how the binary got on `PATH`. Main has no CHANGELOG.md at all, so
// nothing in the branch that wrote the note could see it coming: the guard reddened on the VERSION PULL
// REQUEST, where a red blocks auto-merge and the release simply stops.
//
// So the rule is a function, and the release path asks it of the file it is about to generate. Same rule,
// same words, two callers — rather than a second copy in the release arm that agrees with this one until
// the day somebody edits one of them.
//
// ── THE RULE ────────────────────────────────────────────────────────────────────────────────────────
//
// A bare `clearotron <command>` is command-not-found (exit 127, measured on a real clone) unless the
// document has already put the binary on `PATH`. Two ways it can have done that:
//
//   · an `npm install -g clearotron` line ABOVE the site — line-based, because a reader executing a
//     quickstart top to bottom has not run a later line yet;
//   · the paragraph is ABOUT the `PATH` shim `clearotron install` writes, where the short form is the
//     thing being explained and `npx` would make the document contradict itself.
//
// PARAGRAPH, NOT LINE, for the second — INSTALL.md's exception runs to several sentences, and judged
// line by line the later ones look like stray bare commands.

/** A bare `clearotron <command>`: the form that needs the binary already on `PATH`. */
export const BARE = /(?<!npx )\bclearotron (?=[a-z])/;
/** The form that works from a fresh clone, and the anti-vacuity signal that the scan is reading. */
export const NPX = /npx clearotron [a-z]/g;
/** The line that puts the binary on `PATH` for everything below it. */
export const GLOBAL_INSTALL = /npm install -g clearotron/;
/** The paragraph that is ABOUT the shim, where the short form is the point. */
export const SHIM_PARAGRAPH = /short form|on your `PATH`|stop typing/;

/**
 * Every `clearotron` command site in one document, with what the document had told the reader by then.
 * PURE.
 *
 * @returns {{bare: Array<{file, line, text, paragraph, afterGlobalInstall}>, npx: Array<{file, line}>}}
 */
export function commandSites(file, text) {
  const lines = String(text ?? "").split("\n");
  const installedAt = lines.findIndex((l) => GLOBAL_INSTALL.test(l));
  const globalFrom = installedAt === -1 ? Infinity : installedAt + 1;
  const para = [];
  let n = 0;
  for (const line of lines) { if (line.trim() === "") n++; para.push(n); }
  const textOf = (k) => lines.filter((_, i) => para[i] === k).join(" ");
  const bare = [], npx = [];
  lines.forEach((line, i) => {
    if (BARE.test(line)) {
      bare.push({ file, line: i + 1, text: line.trim(), paragraph: textOf(para[i]), afterGlobalInstall: i + 1 > globalFrom });
    }
    npx.push(...(line.match(NPX) ?? []).map(() => ({ file, line: i + 1 })));
  });
  return { bare, npx };
}

/**
 * The bare sites a reader could not have run: neither below a global-install line nor inside a paragraph
 * about the shim. Empty is the passing state here — these are violations, not a corpus.
 */
export function unreachableBareSites(docs) {
  const out = [];
  for (const { file, text } of docs) {
    for (const s of commandSites(file, text).bare) {
      if (s.afterGlobalInstall) continue;
      if (SHIM_PARAGRAPH.test(s.paragraph)) continue;
      out.push(s);
    }
  }
  return out;
}

/** The sentence a reader gets, naming the site and both remedies. */
export function sentenceFor(s) {
  return `${s.file}:${s.line} uses the bare \`clearotron\` form with nothing above it that put the binary `
    + "on `PATH`. For a reader who cloned, that is command-not-found (exit 127, measured) — either write "
    + "it as `npx clearotron`, or give the document an `npm install -g clearotron` line before this point.";
}
