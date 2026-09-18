// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// attr.mjs — a value placed inside a quoted HTML attribute, and a URL placed inside an href.
//
// Every renderer here has its own `esc`, and each escapes `&`, `<` and `>` — which is right for text and
// wrong inside an attribute: a `"` in the value closes the attribute and whatever follows is markup. So a
// value that sits between quotes goes through `attrValue`, which also encodes both quote characters.
//
// An href needs one more guard, because a correctly escaped `javascript:` URL is still a link that runs
// code when clicked, and the same for `data:` and `vbscript:`. So an href is built by `hrefAttr` or not at
// all: http(s) only — or, when the caller says so, a reference with no scheme (the audit download is a file
// beside the report). A browser drops tabs, newlines and other control characters from a URL before it
// reads the scheme, so the scheme is read with those removed: `java` + newline + `script:` is `javascript:`.

// Every C0 control character, space and DEL — what a URL parser strips or ignores before the scheme.
const IGNORED_BEFORE_SCHEME = /[\x00-\x20\x7f]/g;

/** A value safe between the quotes of an HTML attribute: & < > " and ' all encoded. PURE. */
export const attrValue = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * An href value, attribute-safe, or null when it must not be a link — the caller then renders its text
 * with no anchor. `relative: true` also admits a reference with no scheme, never a protocol-relative one
 * (`//host/…` is an external address by another spelling). PURE.
 */
export function hrefAttr(u, { relative = false } = {}) {
  const s = String(u ?? "").trim();
  if (!s) return null;
  const probe = s.replace(IGNORED_BEFORE_SCHEME, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe)?.[1];
  if (scheme) { if (!/^https?$/i.test(scheme)) return null; }
  else if (!relative || probe.startsWith("//") || probe.startsWith("\\\\")) return null;
  return attrValue(s);
}
