// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/page-shell.mjs — the document both report renderers wrap their page in.
//
// The clearance report (render.mjs) and the Knockout (render-knockout.mjs) built this shell each on its own: the same
// head, title, typefaces, favicon, theme script and style block, written twice, with the report's base sheet and the
// print rule defined in both files. A change a skin needs, to the head, the fonts, the theme or print, had to be made
// twice, and the two copies had already drifted on the chrome sheet.
//
// WHAT DIFFERS BETWEEN THE TWO PAGES IS AN INPUT, NEVER A SWITCH. Each renderer passes its own title, its own sheet and,
// when the pool serves one, the address of the shared chrome sheet. The clearance inlines the chrome only when it is
// given no address, and the Knockout always inlines it; each decides that in what it passes as `css`, so the shell
// emits each page's bytes exactly as its renderer wrote them before. Converging the two would change a page a reader
// sees, and is not this module's to do.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_ROOT, REPORT_ROOT_DARK_EXPLICIT, THEME_INIT_EXPLICIT, FAVICON_LINK, BRAND, sectionStrip } from '../../shared/brand.mjs';
import { REPORT_FONT_STYLE } from '../../shared/brand-fonts.mjs';   // the typefaces travel inside the report; it fetches nothing to draw its text
import { escapeAttr as escHtml } from '../../shared/html-escape.mjs';

import { withColumnQueries } from './column-queries.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Brand :root tokens are sourced from shared/brand.mjs (REPORT_ROOT) and prepended to the report stylesheet, so
// report.css carries only rules — the palette lives in ONE place across surfaces.
// Each width rule carries its column twin (column-queries.mjs), which matches nothing until a column opts in: the
// conflict panel, and the report's column narrowed beside it.
export const REPORT_BASE = REPORT_ROOT + '\n' + withColumnQueries(readFileSync(join(HERE, 'templates', 'report.css'), 'utf8'));
// Print always renders light: re-assert the REPORT_ROOT light tokens under [data-theme=dark] inside @media
// print (a dark-toggled report must never print on near-black — ink/banding + legal-document convention).
const PRINT_LIGHT = '\n@media print{' + REPORT_ROOT.replace(':root{', ':root[data-theme="dark"]{color-scheme:light;') + '}';

// Dark theme rides at EMIT time — the module-level sheets stay untouched (their light half must render
// byte-identically). The toggle arrives via the nav.
//
// EXPLICIT ONLY. A report is the product's most client-facing artefact — it is opened in front of a client, and the
// portal frames it for one — and a client surface must never follow the OS colour preference. The clearance report
// once emitted the automatic pair and went dark on a dark-mode laptop, as a delivered legal document, on the
// standalone file AND framed in the portal, because the portal's shell does not strip the rule. The Knockout already
// took the explicit pair. Dark is still fully reachable, by the toggle and by a choice carried from any other
// surface; only the automatic part is gone.

/**
 * A stylesheet without its comments, for a page a client receives. The source files keep every comment: they carry
 * the reasoning (a stylesheet's notes are for whoever edits it), and a client who views the source of a forwarded
 * report would read internal process notes. A comment opener inside a quoted string or an unquoted url() is text, not
 * a comment, and is kept as it is; a comment between two word characters leaves a space, so no two tokens merge.
 * PURE.
 */
export function stripCssComments(css) {
  const src = String(css ?? '');
  let out = '';
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {                       // a quoted string, copied whole, escapes included
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (/^url\(/i.test(src.slice(i, i + 4)) && !/[\w-]/.test(src[i - 1] ?? '')) {   // url( … ), quoted or not
      let j = i + 4, quote = null;
      for (; j < src.length; j++) {
        if (quote) { if (src[j] === '\\') j++; else if (src[j] === quote) quote = null; }
        else if (src[j] === '"' || src[j] === "'") quote = src[j];
        else if (src[j] === ')') break;
      }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const next = end < 0 ? src.length : end + 2;
      if (/[\w-]$/.test(out) && /^[\w-]/.test(src.slice(next, next + 1))) out += ' ';
      i = next; continue;
    }
    out += ch; i++;
  }
  return out;
}

// THE PAGE'S OWN CHROME CARRIES ONE ATTRIBUTE, data-report-chrome: the sticky header (the bar, the export menu, the
// section strip) on both reports, and the Knockout's theme button. The portal frames a report and removes that chrome,
// and it found it by class names a re-skin could rename without a sound. An element carrying the attribute is the
// renderer saying "this is mine, not the report's". No stylesheet selects on it, so it changes nothing a reader sees.

/**
 * One report page. `title` is the page's own title as HTML, already escaped by its renderer; the shell adds the
 * product's name after it. `css` is the renderer's sheet, placed after the base sheet and before the dark and print
 * rules. `chromeHref`, when given, links the pool's shared chrome sheet after the inline style, so the chrome stays
 * last in the cascade. `body` is everything inside <body>.
 */
export function pageShell({ title, css, chromeHref, body }) {
  const chromeLinkTag = chromeHref ? `<link rel="stylesheet" href="${escHtml(chromeHref)}">` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${escHtml(BRAND.name)}</title>
${REPORT_FONT_STYLE}${FAVICON_LINK}${THEME_INIT_EXPLICIT}
<style>${stripCssComments(`${REPORT_BASE}\n${css}${REPORT_ROOT_DARK_EXPLICIT}${PRINT_LIGHT}`)}</style>${chromeLinkTag}</head><body class="has-glow">
${body}
</body></html>`;
}

/**
 * THE ONE REPORT FRAME (C14). Every report page is the same frame: the shell above, a sticky head holding the page's
 * top bar and its section strip, then the page's sections in their order inside <main>, then its footer. A product is
 * the parts it hands the frame, never a copy of the frame:
 *
 *   title(c), css(c)    the page's own title (already escaped) and sheet, as pageShell takes them
 *   topbar(c)           what the top bar holds
 *   afterHead(c)        what sits between the sticky head and the page's body
 *   sections            [id, draw(c)] in the order the page prints them; each draw returns its markup with the
 *                       whitespace that leads it, so the list joins with nothing
 *   footer(c)           what the footer holds
 *   afterWrap(c)        what closes the page after its body
 *   strip               the section strip's entries, [anchor, label], filtered to the anchors the page holds
 *
 * `c` is the page's context, built once by its product from what the page prints. The parts are called in the order
 * the page reads them top to bottom, so a part that counts or numbers as it draws sees the page in order.
 */
export function reportPage(page, c) {
  const html = pageShell({
    title: page.title(c),
    css: page.css(c),
    chromeHref: c.chromeHref,
    body: `<div class="rep-stickyhead no-print" data-report-chrome>
<div class="topbar no-print">
  ${page.topbar(c)}
</div>
<!--SECTION-STRIP-->
</div>
${page.afterHead(c)}<div class="wrap">
<main>
  ${page.sections.map(([, draw]) => draw(c)).join('')}
</main>

  <footer>
    ${page.footer(c)}
  </footer>
</div>${page.afterWrap(c)}`,
  });
  return html.replace('<!--SECTION-STRIP-->', sectionStrip(html, page.strip));
}
