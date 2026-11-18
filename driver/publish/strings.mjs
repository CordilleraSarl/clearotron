// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/strings.mjs — the sentences the product composes for a client, in one place, by id.
//
// A firm working in another language would otherwise fork every file that writes one, and fork it again on
// every release. Each entry is today's text, character for character: moving a sentence here changes no word,
// and a sentence that changes is a change to a client surface, made as one and never inside a move. A label
// carries no markup and no closing punctuation where its surfaces differ on them; the caller adds those.
//
// NOT HERE: the words a model writes, the sentences the engine composes for a model, and the portal's strings,
// which have their own list (scripts/portal-strings.mjs). The renderers' sentences move here a file at a time.
//
// An entry is a string, or a function of the values a sentence carries.

/** The cover note that carries a clearance report to the lawyer, as HTML and as markdown. */
export const EMAIL = Object.freeze({
  openReport: '▶ Open the full report',
  downloadAudit: 'Download audit (Excel)',
  scopeLabel: 'Search scope:',
  scopeOpen: 'Some scoped searches remained open at delivery.',
  overallRisk: 'Overall risk:',
  onlyYouCanClose: 'Only you can close these',
  onlyYouCanCloseDefault: 'the open items set out in the report, before relying on a clean result',
  handlingNote: 'Handling note:',
  registerCoverage: 'Register coverage —',
  applicantMidRun: 'Applicant named mid-run:',
  client: 'Client:',
  classes: 'Classes:',
  basis: 'Basis:',
  // `domain` arrives with its own emphasis: <b>…</b> in the HTML note, **…** in the markdown one.
  accessNote: (domain) => `Access-controlled — sign in with a ${domain} account. Reply to this email with any questions.`,
});

/** The cover note that carries a Knockout to the lawyer: one line per searched name under a head. */
export const KNOCKOUT_EMAIL = Object.freeze({
  marks: (n) => `${n} mark${n === 1 ? '' : 's'}`,
  rating: 'rating',
  highestRating: 'highest rating',
  openReport: 'Open the full report',
  auditWorkbook: 'audit workbook',
  onePerName: 'One report per name below',
  // `link` is the audit workbook's own link, its words included.
  batchWorkbook: (link) => `, and one ${link} for the batch`,
  defaultCaveat: 'Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.',
  classes: 'Classes',
  manualCheck: 'manual verification recommended (automated research unavailable)',
  openThisReport: 'open this report',
});
