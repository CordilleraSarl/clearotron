// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/column-queries.mjs — the report's own narrow layout, for a column narrower than the window.
//
// The report's responsive rules ask the WINDOW how wide it is. The conflict panel needs the report's narrow layout in a
// column that is narrow while the window is not: beside the panel on a laptop, the column is narrowed to the width the
// report already has a layout for, and the card inside the panel is drawn at the panel's width. A third layout is not
// wanted, and neither is a second copy of the rules kept in step by hand, so each width rule is answered here, in code,
// by a twin that asks the column instead.
//
// THE TWINS CHANGE NOTHING UNTIL THEY ARE ASKED TO. Each one is scoped by a zero-specificity :where() to a column that
// opted in: the report's column while the page carries `rep-narrow`, and the panel. Everywhere else they match nothing,
// so with the panel shut every element is styled by exactly the rules it had before, in the same order. A max-width rule
// keeps its window form, which a wide window never meets; a min-width rule's window form is kept for every column that
// did not opt in, and its twin answers for the one that did. Print rules and rules that ask anything but width are left
// as they are.
//
// THE COLUMN'S WIDTH IS MEASURED INSIDE ITS PADDING, the window's outside it. The report's column has 26 px each side, so
// a twin asks for the window's breakpoint less 52 px: a column narrowed to 664 px lays out as a 664 px window would.
// The panel is a query container without padding, so it is offset the same way by the CSS that sizes it.
import { strict as assert } from "node:assert";

export const COLUMN = "repcol";
export const INSET = 52;
const OPTED_IN = ":where(html.rep-narrow,.cpanel)";
const NOT_OPTED_IN = ":where(html:not(.rep-narrow))";

/** The index just after the block that opens at `open` (a `{`), skipping comments and strings. */
function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") { const j = css.indexOf("*/", i + 2); i = j < 0 ? css.length : j + 1; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1; i = j; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  throw new Error("column-queries: a block in the stylesheet never closes");
}

/** The plain rules inside a block body, as [selectors, declarations]. A nested at-rule is refused: none exists today. */
function rulesOf(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open < 0) { assert.equal(body.slice(i).replace(/\/\*[\s\S]*?\*\//g, "").trim(), "", "column-queries: text after the last rule"); break; }
    const head = body.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (head.startsWith("@")) throw new Error(`column-queries: a nested at-rule (${head}) inside a width rule is not handled`);
    const end = blockEnd(body, open);
    out.push([head, body.slice(open + 1, end - 1)]);
    i = end;
  }
  return out;
}

const scope = (selectors, prefix) => selectors.split(",").map((s) => `${prefix} ${s.trim()}`).join(",");

/**
 * The stylesheet with a column twin beside each width rule. PURE: the same text in gives the same text out.
 * @param {string} css
 */
export function withColumnQueries(css) {
  let out = "";
  let i = 0;
  const at = /@media\s*([^{]*)\{/g;
  let m;
  while ((m = at.exec(css))) {
    const cond = m[1].trim();
    const open = m.index + m[0].length - 1;
    const end = blockEnd(css, open);
    const width = cond.match(/^(?:(screen)\s+and\s+)?\(\s*(max|min)-width\s*:\s*(\d+)px\s*\)$/);
    if (!width) { at.lastIndex = open + 1; continue; }   // print, motion, colour scheme: left as they are, and searched inside
    const [, screen, kind, px] = width;
    const rules = rulesOf(css.slice(open + 1, end - 1));
    const n = Number(px) - INSET;
    const twin = `@container ${COLUMN} (${kind}-width:${n}px){${rules.map(([s, d]) => `${scope(s, OPTED_IN)}{${d}}`).join("")}}`;
    const original = kind === "min"
      ? `@media ${cond}{${rules.map(([s, d]) => `${scope(s, NOT_OPTED_IN)}{${d}}`).join("")}}`
      : css.slice(m.index, end);
    out += css.slice(i, m.index) + original + (screen ? `@media screen{${twin}}` : twin);
    i = end;
    at.lastIndex = end;
  }
  return out + css.slice(i);
}
