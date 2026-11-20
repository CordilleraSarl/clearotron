// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/render-report.mjs — the one report renderer (C14).
//
// A run's report document says which report it is (`document`), and that names the page that draws it. Every page is
// drawn in the one frame (page-shell.mjs `reportPage`) from the parts its product hands it: its context, read from the
// document once, then its title, its sheet, its top bar, its sections in their order and its footer. A new report shape
// is a new document, a new page's parts and any sections it does not share, never a copy of a renderer.
//
// `surface` is what publish hands the page beside the document, because the document does not hold it: the page's
// addresses, the confidentiality posture, the demo flag, the saved records and logos the document names by reference,
// and, on a Knockout, which name's page this is (`at`). Each page reads the part of it that it prints.
import { CLEARANCE_DOCUMENT, KNOCKOUT_DOCUMENT } from './report-document.mjs';
import { reportPage } from './page-shell.mjs';
import { CLEARANCE_PAGE } from './render.mjs';
import { KNOCKOUT_PAGE } from './render-knockout.mjs';

const PAGES = new Map([[CLEARANCE_DOCUMENT, CLEARANCE_PAGE], [KNOCKOUT_DOCUMENT, KNOCKOUT_PAGE]]);

/**
 * The report page for a run's report document, as written. A document no page draws is refused by name: a page drawn
 * from a document it does not know would print whatever its defaults say about facts it never read.
 */
export function renderReport(doc, surface = {}) {
  const page = PAGES.get(doc?.document);
  if (!page) throw new Error(`renderReport: no report page draws a "${doc?.document}" document`);
  return reportPage(page, page.contextOf(doc, surface));
}
