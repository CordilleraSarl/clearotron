// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// vacuous-pass.mjs —: the census member for "the assertions can execute ZERO times".
//
// A GUARD CAN STOP GUARDING WITHOUT BEING DELETED, and the four delivered members cannot see this one.
// DELETED and RENAMED watch the collection glob; GUTTED counts assert SITES; SKIPPED reads skip lines.
// All four are satisfied by this:
//
//   for (const f of readdirSync(dir)) { assert.ok(check(f), "…"); }
//
// Empty directory, green test, no skip line. The file is present, its test count is unchanged, and its
// assert-site count is unchanged too — the census counts sites, and this is one site executing zero
// times. The guard stopped guarding and every existing member reports the suite intact.
//
// ── WHAT THIS CHECKS, AND WHY IT IS STATIC ────────────────────────────────────────────────────────
//
// It cannot know at rest whether a set will be empty at runtime. It checks the property that makes the
// question decidable AT runtime: that the loop's set is asserted NON-EMPTY before it is walked. A test
// that says `assert.ok(files.length, "…")` fails loudly on an empty corpus instead of passing quietly,
// and that is the whole remedy — the assertion belongs at the site, where the next reader meets it.
//
// ── CORPUS vs VIOLATIONS, the distinction no regex settles ────────────────────────────────────────
//
// A loop over a DISCOVERED CORPUS must not be empty — empty means the guard lost its subject. A loop
// over DISCOVERED VIOLATIONS must be allowed to be empty — empty is the passing state. The two are
// spelled identically. Measured 2026-08-20 across 563 driver test files: 36 discovered-set loops, and
// the sampled sites were corpus loops without exception, so the default is "assert non-empty" and the
// exceptions carry a reason at the entry. Same rule for every site, declared where a reader meets it.
//
// The GATED (env-conditional) member named in is NOT here: measured on the same tree, the
// dominant `if (process.env.X …)` idiom is save/restore teardown, which guards no assertion and cannot
// pass vacuously. Ruled out as measured-harmless (owner ruling 2026-08-20) rather than left unbuilt.

/**
 * THE REMEDY, at the site. Wrap the set a loop walks:
 *
 *   for (const f of nonEmpty(readdirSync(dir), "the skills directory")) { … }
 *
 * Throws when the set is empty or null, so a guard that lost its subject FAILS instead of reporting a
 * green over zero iterations. Deliberately not `assert` — this module stays dependency-free so product
 * code can use it too, and a thrown Error fails a node:test arm identically.
 *
 * `null` is checked separately from empty because a discovery helper that cannot build its corpus
 * (`trackedFiles` outside a checkout) returns null, and `null.length` would throw a TypeError whose
 * message says nothing about what went wrong.
 */
export function nonEmpty(set, what) {
  if (set == null) {
    throw new Error(`#1010 VACUOUS: ${what} is NULL — the set could not be built at all, so the `
      + "assertions below would execute ZERO times and this test would pass without checking anything.");
  }
  const n = typeof set.length === "number" ? set.length : (typeof set.size === "number" ? set.size : [...set].length);
  if (n === 0) {
    throw new Error(`#1010 VACUOUS: ${what} is EMPTY, so the assertions below would execute ZERO times `
      + "and this test would pass without checking anything. If empty is the PASSING state here because "
      + "the set is violations rather than corpus, do not wrap it — declare it in EMPTY_IS_THE_PASS.");
  }
  return set;
}

/** Discovery calls whose result is a set the tree/filesystem decides the size of. */
export const DISCOVERY_RE = /readdirSync|globSync|trackedFiles|execSync|readdir\(|glob\(/;

/** Comment lines are blanked, never dropped, so reported line numbers stay true to the file. */
const code = (text) => String(text ?? "").split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l));

/**
 * Every `for (… of <discovered set>)` in one test file, with whether that set is asserted non-empty
 * BEFORE the loop. PURE.
 *
 * Resolves a bare identifier back to its declaration in the same file, so the common two-line form
 * (`const files = readdirSync(d); … for (const f of files)`) is seen as discovered rather than opaque.
 *
 * @returns {Array<{line:number, expr:string, set:string|null, guarded:boolean}>}
 */
/**
 * The symbol a loop sits inside, as a path: `<enclosing test title> \u203a <nearest declaration>`.
 *
 * — the site anchor. A line number survives no edit above it: eleven comment lines added to an
 * unrelated diagnostic moved a declared site from :196 to :207 and reddened two arms in a pull request
 * about environment spellings. CONTRIBUTING's rule from ADR-0005 is cite the symbol, not the line, and
 * this is what lets a declaration table obey it.
 *
 * The declaration alone is not enough on its own: both declared sites are a `walk` helper running the
 * identical `readdirSync(dir, { withFileTypes: true })`, and one file repeats one expression five
 * times. The test title is what separates them, and the caller still asserts the match is unique.
 */
export function enclosingSymbol(lines, i) {
  let decl = null, title = null;
  for (let k = i; k >= 0 && !(decl && title); k--) {
    const l = lines[k];
    if (!decl) {
      const m = /(?:^|[;{}])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l)
        // `function*` too: a generator's name was invisible here, so a loop inside one
        // was anchored on whatever unrelated `const` happened to sit above it — an anchor pointing at
        // the wrong declaration is worse than none, because it moves when that declaration does.
        ?? /\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(l);
      if (m) decl = m[1];
    }
    if (!title) {
      const m = /\b(?:test|it|describe)\s*\(\s*(["\'`])([^"\'`]*)\1/.exec(l);
      if (m) title = m[2];
    }
  }
  if (title && decl) return `${title} \u203a ${decl}`;
  return decl ?? title ?? "(top level)";
}

export function discoveredLoops(text) {
  const lines = code(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // PAREN-MATCHED, not line-anchored. A regex ending the loop head at end-of-line cannot see
    // `for (const f of files) { assert.ok(f); }` — body on the same line — and a detector blind to a
    // spelling is a detector that certifies it. Its own arms caught this before it shipped.
    const head = /for\s*\(\s*(?:const|let|var)\s+/.exec(lines[i]);
    if (!head) continue;
    let depth = 0, close = -1;
    for (let k = lines[i].indexOf("(", head.index); k < lines[i].length; k++) {
      if (lines[i][k] === "(") depth++;
      else if (lines[i][k] === ")") { depth--; if (depth === 0) { close = k; break; } }
    }
    if (close < 0) continue;
    const inner = lines[i].slice(lines[i].indexOf("(", head.index) + 1, close);
    const of = / of /.exec(inner);
    if (!of) continue;
    const expr = inner.slice(of.index + 4).trim();
    let set = null;
    if (!DISCOVERY_RE.test(expr)) {
      const id = /^([A-Za-z_$][\w$]*)\s*$/.exec(expr)?.[1];
      if (!id) continue;
      const decl = lines.findIndex((l) => new RegExp(`(?:const|let|var)\\s+${id}\\s*=`).test(l));
      if (decl < 0 || decl > i || !DISCOVERY_RE.test(lines[decl])) continue;
      set = id;
    }
    const before = lines.slice(0, i).join("\n");
    // A non-emptiness assertion on THIS set: `assert.ok(files.length …)`, `assert.notEqual(files.length, 0)`.
    // Per SITE and per SET — an aggregate ("the file asserts some length somewhere") credited eleven
    // unguarded sites as guarded when this was first measured, which is the error it exists to avoid.
    // The wrapper AT THE SITE is the primary form: it reads in the loop head, where the next person
    // meets it, and it cannot drift away from the loop it protects the way a preceding statement can.
    // A hand-written non-emptiness assertion before the loop still counts — the point is the check, not
    // the spelling.
    // REFUSING IS ALSO GUARDING. `if (cases.length === 0) return t.skip("…")` does not iterate nothing
    // and call it a pass — it reports, loudly and countably, that the corpus is not here. That is the
    // outcome this member wants; demanding an assertion instead would be demanding a red where a
    // visible skip is the honest answer.
    const skipsInstead = set
      ? new RegExp(`\\b${set}\\.length\\s*===?\\s*0[^;]*\\.skip\\s*\\(`).test(before)
      : false;
    const guarded = /\bnonEmpty\s*\(/.test(expr) || skipsInstead || (set
      ? new RegExp(`assert\\.[a-z]+\\s*\\([^;]*\\b${set}\\b[^;]*\\.length`).test(before)
      : new RegExp(`assert\\.[a-z]+\\s*\\([^;]*(?:${DISCOVERY_RE.source})[^;]*\\.length`).test(before));
    out.push({ line: i + 1, symbol: enclosingSymbol(lines, i), expr: expr.slice(0, 80), set, guarded });
  }
  return out;
}

// ── THE EARLY-RETURN HALF ──────────────────────────────────────────────────────────────────
//
// 's ruling names two shapes. `discoveredLoops` above is the loop half. This is the other, and
// the two are not alike enough to share a detector:
//
//   test("the tree is clean", () => {
//     const corpus = trackedFiles(GUARD);
//     if (corpus == null) return;                // ← node:test counts this as a PASS
//     assert.deepEqual(hits(corpus), []);
//   });
//
// Off a checkout that arm reports a clean tree having read nothing. The loop half has one correct
// remedy — assert the set non-empty. This one does not: the question is the CONDITION, not the shape.
// `if (sha === null) return;` may be a documented hand-off to another arm; `if (!hits) return;` is a
// guard reporting clean when its instrument found nothing. Nothing mechanical separates them, so this
// reports the population and the caller declares the ones where bailing is right.
//
// TOP LEVEL ONLY, and that is the whole reason the raw figure was an over-count. measured 32
// sites from `grep '^\s*if\s*(...)\s*return;'` and sampled eight: half were `return` inside a
// callback, where it means `continue` and skips nothing. Depth is tracked through the line, not just
// at its start, so `arr.forEach(x => { if (x) return; })` on one line is not miscounted.
//
// LITERALS ARE BLANKED FIRST, and this is not a refinement — it is the difference between a usable
// detector and one nobody can act on. Measured on driver/test before blanking: 10 hits, of which FOUR
// were the string `return;` inside a regex or template literal in an assertion —
// `assert.match(SRC, /if \(!RUN_DIR\) return;/, …)` is a test ABOUT the shape, not an instance of it.
// A detector at 40% false positives demands four wrong edits and teaches the next reader to ignore it.
//
// LIMIT, stated rather than discovered: the blanker is a scanner, not a parser. A regex literal is
// recognised only where one can legally begin (after `(`, `,`, `=`, `:` or an operator), because `/`
// is also division; a regex in an unusual position would be missed and its contents scanned. That
// direction is the safe one — it over-reports, and an over-report is visible.

/** A `return` with no value: the bail. `return ctx.skip(...)` is the remedy and is not one. */
const BARE_RETURN_RE = /\breturn\s*(;|$)/;

/**
 * Blank the CONTENTS of string, template and regex literals, preserving length and delimiters so every
 * reported column and line still matches the file a reader opens.
 */
function blankLiterals(line) {
  const out = line.split("");
  let i = 0;
  while (i < out.length) {
    const ch = out[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < out.length && !(out[j] === ch && out[j - 1] !== "\\")) { out[j] = " "; j++; }
      i = j + 1; continue;
    }
    if (ch === "/") {
      const before = line.slice(0, i).trimEnd();
      const canStart = before === "" || /[(,=:[!&|?+\-*%;{}]$/.test(before) || /\breturn$/.test(before);
      if (canStart && out[i + 1] !== "/" && out[i + 1] !== "*") {
        let j = i + 1;
        while (j < out.length && !(out[j] === "/" && out[j - 1] !== "\\")) { out[j] = " "; j++; }
        i = j + 1; continue;
      }
    }
    i++;
  }
  return out.join("");
}

/**
 * Every bare `return;` at the TOP LEVEL of a `test(...)` callback in one file. PURE.
 *
 * @returns {Array<{line:number, text:string}>} 1-indexed lines, in file order.
 */
export function topLevelBails(text) {
  const lines = code(text).map(blankLiterals);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/\btest\s*\(/.test(lines[i])) continue;
    // Walk from the test( onwards, tracking brace depth. Depth 1 is the callback body's top level:
    // the callback's own `{` takes us from 0 to 1, and any nested block or arrow goes deeper.
    let depth = 0, started = false;
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === "{") { depth++; started = true; continue; }
        if (ch === "}") { depth--; continue; }
        if (depth !== 1 || !started) continue;
        // At the callback's top level. Does a bare `return` start here?
        if (ch !== "r" || !/\breturn\b/.test(line.slice(k, k + 7))) continue;
        if (/[\w$.]/.test(line[k - 1] ?? "")) continue;           // part of a longer identifier
        if (BARE_RETURN_RE.test(line.slice(k))) out.push({ line: j + 1, text: line.trim() });
      }
      if (started && depth <= 0) { i = j; break; }
    }
  }
  return out;
}
