// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// shared/inline-markdown.mjs — the one inline-markdown dialect the report pages read model-written prose in.
//
// The model writes markdown because every other surface it feeds renders markdown. The clearance renderer read links,
// bold and italic; the Knockout renderer read bold, italic and code; and several clearance fields were escaped and
// nothing else. So a model-written `[label](https://…)` reached a delivered page as those characters on some fields
// and as a link on others, and the same sentence printed differently on a clearance and on a Knockout. Both renderers
// now read the same four forms through this function. The portal's span reader
// (portal-ui/src/contract/inlineMd.ts) mirrors it without ever building HTML.
//
// IT TAKES TEXT ITS CALLER HAS ALREADY ESCAPED. Each renderer escapes as it always has (both escape & < >; the
// Knockout also escapes quotes), so a page's existing text keeps its bytes and only the markdown forms change.
// Nothing here may be handed raw model text.
//
// THE FORMS, IN ORDER: links, then bold, then italic, then code. Bold runs before italic so the inner asterisks of a
// `**bold**` run are never read as a pair of italics, and an unmatched marker stays visible: `2 * 3` is a
// multiplication, and swallowing the character would silently edit a client's document.

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Does a link target open anything safely? http(s), mailto and an in-page `#` anchor; any other scheme is text. */
export const isSafeLinkTarget = (href) => /^https?:\/\//i.test(href) || /^mailto:/i.test(href) || String(href).startsWith('#');

/**
 * Escaped text → the same text with its inline markdown as HTML.
 *
 * Links: an external link opens in a new tab; an in-page anchor keeps same-tab navigation. A target with any other
 * scheme (javascript:, data:, vbscript:, …) renders as its label alone, as plain text.
 *
 * Provenance honesty: an authored 'Corsearch · <name>' label whose href is NOT a Corsearch page (live case: storefront
 * links labelled as the register vendor) gets its vendor token replaced by the link's actual host — a lawyer must never
 * cite a storefront as a register record.
 */
export function inlineMarkdown(escaped) {
  return String(escaped ?? '')
    .replace(LINK, (mm, txt, href) => {
      let label = txt;
      const vend = /^(Corsearch)\s*·\s*(.+)$/i.exec(txt);
      if (vend && /^https?:\/\//i.test(href) && !/corsearch\./i.test(href)) {
        try { label = `${new URL(href.replace(/&amp;/g, '&')).host.replace(/^www\./, '')} · ${vend[2]}`; } catch { /* keep authored label */ }
      }
      if (!isSafeLinkTarget(href)) return label;
      // XSS: the caller's escaping may not cover quotes, and a `"` in the href would break out of the attribute, so
      // quotes are escaped here. Not a second full escape: that would double-encode `&` in query strings
      // (?a=1&amp;b=2 → &amp;amp;).
      const safeHref = href.replace(/"/g, '&quot;');
      return /^https?:\/\//i.test(href) ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<a href="${safeHref}">${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
}
