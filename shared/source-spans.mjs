// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHICH PART OF EACH LINE OF A SCRIPT IS COMMENT, AND WHICH IS A STRING. The public-text guards read comments as prose
// and judged a line by how it starts: a line opening with `//` or `*` was read, and a comment after code on the same line
// was not. Strings were not read at all. This reads a whole JavaScript file once and hands back, per line, the comment
// text and the string text it holds, so a guard can read a trailing comment as the prose it is and count a string as
// what it is.
//
// NO DEPENDENCY, ON PURPOSE. The pattern guards run in CI without an install, so this cannot lean on a parser package.
// It is a small scanner instead: line and block comments, the three quote forms, template literals with their `${}`
// holes, and regular-expression literals, told from division by the token before them. Its test checks it against a
// real parser over the repository's own scripts.
//
// PURE. Never throws: text it cannot follow leaves the rest of the file read as code, which reads less, never more.

const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Per line (0-based), the comment text and the string text it holds.
 * @param {string} text a JavaScript source file
 * @returns {{ comment: string, strings: string }[]}
 */
export function sourceSpans(text) {
  const src = String(text ?? "");
  const lines = src.split("\n");
  const out = lines.map(() => ({ comment: "", strings: "" }));
  let line = 0;
  const add = (kind, ch) => { out[line][kind] += ch; };
  // A stack of contexts: "code" (with the template depth it closes), or a template literal.
  const stack = [{ kind: "code", braces: 0 }];
  let prev = "";          // the last significant code text, to tell a regular expression from a division
  let i = 0;
  // A `#!` first line is the interpreter's, and a parser reads it as a comment.
  if (src.startsWith("#!")) { const j = src.indexOf("\n"); out[0].comment = src.slice(2, j < 0 ? src.length : j); i = j < 0 ? src.length : j; }
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    const top = stack[stack.length - 1];
    if (c === "\n") { line++; i++; continue; }
    if (top.kind === "template") {
      if (c === "\\") { add("strings", c); if (d !== undefined && d !== "\n") add("strings", d); if (d === "\n") line++; i += 2; continue; }
      if (c === "`") { stack.pop(); prev = "`"; i++; continue; }
      if (c === "$" && d === "{") { stack.push({ kind: "code", braces: 0 }); prev = "{"; i += 2; continue; }
      add("strings", c); i++; continue;
    }
    // code
    if (c === "/" && d === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      out[line].comment += src.slice(i + 2, j);
      i = j; continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) { if (src[j] === "\n") line++; else add("comment", src[j]); j++; }
      i = Math.min(n, j + 2); continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") { add("strings", src[j + 1] ?? ""); j += 2; continue; } add("strings", src[j]); j++; }
      prev = c; i = j + 1; continue;
    }
    if (c === "`") { stack.push({ kind: "template" }); i++; continue; }
    if (c === "/" && REGEX_AFTER.test(prev.trimEnd())) {
      // A regular-expression literal: skip it whole, classes and escapes included, to the closing slash and flags.
      let j = i + 1, inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      prev = "/x/"; i = j; continue;
    }
    if (c === "{") top.braces++;
    if (c === "}") {
      if (top.braces === 0 && stack.length > 1) { stack.pop(); prev = "}"; i++; continue; }   // a template hole closes
      top.braces--;
    }
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? (/[\w$]$/.test(prev) ? prev + c : c) : c;
    i++;
  }
  return out;
}

/** Is this path a JavaScript source the scanner reads? */
export const isScript = (path) => /\.(m?js|cjs)$/.test(String(path));
