// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// page-links.mjs — the in-page links and the ids of a published page, read from its parsed start tags.
//
// A report page links to its own cards and sections by `href="#…"`. Two questions are asked of it: does every such link
// name an element the page carries, and does any id repeat. Both are answered from the page's elements, read by walking
// the document the way a browser's tokenizer does: a comment is skipped whole, the text of a script or style element is
// skipped to its end tag in any letter case, and an attribute value is read double-quoted, single-quoted or bare, with
// its character references decoded. Nothing is cut out of the markup by pattern first; a pattern that strips elements
// misses a spelling it did not foresee and leaves that element's text to be read as markup.

const SKIPPED_TEXT = new Set(["script", "style", "textarea", "title"]);
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (v) => v.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ref) => {
  if (ref[0] !== "#") return NAMED[ref.toLowerCase()] ?? whole;
  const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
  return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
});
const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isLetter = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

/** Every start tag of `html` in document order, as `{ tag, attrs }`, with tag and attribute names lowercased. */
export function pageElements(html) {
  const src = String(html);
  const lower = src.toLowerCase();
  const out = [];
  let i = 0;
  while ((i = src.indexOf("<", i)) !== -1) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src[i + 1] === "!" || src[i + 1] === "?" || src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (!isLetter(src[i + 1] ?? "")) { i += 1; continue; }   // a bare `<` in text
    let j = i + 1;
    while (j < src.length && !isSpace(src[j]) && src[j] !== "/" && src[j] !== ">") j++;
    const tag = lower.slice(i + 1, j);
    const attrs = {};
    for (;;) {
      while (j < src.length && (isSpace(src[j]) || src[j] === "/")) j++;
      if (j >= src.length || src[j] === ">") break;
      let k = j + 1;
      while (k < src.length && !isSpace(src[k]) && src[k] !== "/" && src[k] !== ">" && src[k] !== "=") k++;
      const name = lower.slice(j, k);
      j = k;
      while (j < src.length && isSpace(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (j < src.length && isSpace(src[j])) j++;
        const quote = src[j];
        if (quote === '"' || quote === "'") {
          const end = src.indexOf(quote, j + 1);
          value = src.slice(j + 1, end === -1 ? src.length : end);
          j = end === -1 ? src.length : end + 1;
        } else {
          k = j;
          while (k < src.length && !isSpace(src[k]) && src[k] !== ">") k++;
          value = src.slice(j, k);
          j = k;
        }
      }
      if (!Object.hasOwn(attrs, name)) attrs[name] = decode(value);   // the first of a repeated attribute wins, as in a browser
    }
    out.push({ tag, attrs });
    i = j + 1;
    if (SKIPPED_TEXT.has(tag)) {
      const end = lower.indexOf(`</${tag}`, i);
      i = end === -1 ? src.length : end;
    }
  }
  return out;
}

/** The page's ids and in-page link targets, the targets no element carries, and the ids that repeat. */
export function pageLinks(html) {
  const elements = pageElements(html);
  const ids = elements.filter((e) => Object.hasOwn(e.attrs, "id")).map((e) => e.attrs.id);
  const hrefs = elements.map((e) => e.attrs.href).filter((h) => typeof h === "string" && h.startsWith("#")).map((h) => h.slice(1));
  const known = new Set(ids);
  return {
    ids,
    hrefs,
    dead: hrefs.filter((h) => !known.has(h)),
    repeated: ids.filter((x, n) => ids.indexOf(x) !== n),
  };
}
