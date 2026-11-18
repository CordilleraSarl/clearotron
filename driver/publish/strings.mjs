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

/** The audit workbook's own sentences, sheet by sheet. */
export const WORKBOOK = Object.freeze({
  // Findings: how each conflict was treated, keyed by its disposition.
  treatment: Object.freeze({
    adversarial: 'On-field — stress-tested as the closest conflict',
    'coexistence-partner': 'Coexistence partner — living alongside, kept manageable',
    distinguished: 'Distinguished — weak shared element, kept manageable',
    'off-field': 'Off-field — outside the risk zone',
  }),
  withdrawn: (reason) => `Withdrawn on review — ${reason}`,
  noReasonRecorded: 'no reason recorded',
  contextNote: 'Noted for awareness — not a rated conflict',
  // Findings: whether each registration's record was retrieved.
  liveListing: 'n/a — live listing',
  retrieved: 'Retrieved from the register',
  notRetrievedUnverified: 'Not retrieved — details unverified',
  notIndividuallyRetrieved: 'Not individually retrieved',
  // `countries` arrives joined, "CA" or "US/AU".
  countriesRetrieved: (countries) => `${countries} retrieved`,
  countriesNotRetrieved: (countries) => `${countries} not retrieved`,
  // What was searched: each row's outcome, the section heads, and the words a common-law row is built from. A
  // count or a list arrives formatted; `across` is "~3" or "the".
  outcome: Object.freeze({
    findings: '→ Findings',
    excluded: 'Excluded',
    noConflict: 'No conflict',
    recorded: 'Recorded — read the Result',
    reviewed: 'Reviewed — not carried as a conflict',
    partial: 'No conflict — partial',
    notSearched: 'Open — not searched',
  }),
  couldNotBeSearched: 'could not be searched',
  registerSection: 'REGISTER  —  vendor register, worldwide',
  commonLawSection: 'COMMON-LAW  —  web / marketplace / social / product database',
  surfaces: (n) => `~${n} surfaces`,
  similarFound: 'similar listing(s) found',
  clean: '0 — clean',
  cleanOn: (ran, n) => `0 — clean on ${ran} of ${n}`,
  reasonsGiven: (count, list) => ` The surface${count === 1 ? '' : 's'} gave a reason: ${list}.`,
  someGaveNoReason: (count, list) => ` ${count} recorded no reason (${list}).`,
  noneGaveAReason: ' No reason was recorded for any of them.',
  notClosedAcross: (count, list) => ` ${count} surface${count === 1 ? '' : 's'} could not be searched (${list}) — this term is NOT closed across them.`,
  checkedJoined: (across) => `Checked across ${across} surfaces; similar listing(s) surfaced → see Findings`,
  checkedReviewed: (across) => `Checked across ${across} surfaces; listing(s) reviewed, none carried as a separate conflict`,
  checkedClean: (ran) => `Checked across ~${ran} surface${ran === 1 ? '' : 's'}; no listing found`,
  checkedNowhere: 'Not checked on any recorded surface',
  unlogged: Object.freeze({
    term: "COMMON-LAW  —  not itemised in this search's search log",
    result: 'no per-term rows recorded',
    outcome: 'Not itemised',
    note: 'This run is not recorded as a register-only search, so what this tab lists is not the whole of what it searched. Its search log holds no per-term common-law rows, so the sweep cannot be set out term by term here. Read this tab as an incomplete record of the searching — never as evidence that no common-law search ran — and check any common-law line on "Coverage & gaps" against the run\'s own common-law record.',
  }),
  // Findings: where a conflict was found, and the link to its source.
  sourceLayer: Object.freeze({ caseLaw: 'Case-law', marketplace: 'Marketplace', web: 'Web' }),
  view: 'View',
  // Summary: the mark-assessment, coverage-judgment and corrections blocks.
  markItself: 'The mark itself',
  distinctiveness: 'Distinctiveness',
  connotation: 'Connotation',
  perClass: (cls) => `Class ${cls}`,
  coexistingRegistration: 'Coexisting registration',
  howCoverageWasJudged: 'How coverage was judged',
  correctionsApplied: 'Review corrections applied',
  // Coverage & gaps: the state each area is in.
  state: Object.freeze({ clean: 'Clean', limited: 'Limited', open: 'Open', note: 'Note' }),
  // Summary: its labels and its sentences. A label under a heading is indented by the caller.
  summary: Object.freeze({
    title: (product) => `${product} — audit`,
    titleWithoutProduct: 'Search audit',
    subtitle: 'The full, downloadable record behind the report — what was searched, and what we concluded about each finding.',
    mark: 'Mark',
    matter: 'Matter',
    classes: 'Classes',
    registerCoverage: 'Register coverage',
    jurisdiction: 'Jurisdiction',
    searched: 'Searched',
    riskBand: 'Risk band',
    verdict: 'Verdict',
    checkFirst: '⚠  One thing to check first',
    nothingOpen: 'None — every search unit reached completion.',
    commonLaw: '⚠  Common-law searching',
    commonLawUnlogged: 'Not set out term by term in this workbook: this search\'s search log holds no per-term common-law rows, so "What was searched" lists the register terms only. Read that tab as an incomplete record of the searching, not as evidence that no common-law search ran, and check any common-law line on "Coverage & gaps" against the run\'s own common-law record.',
    machineQc: '⚠  Machine QC',
    // `count` is the number of failed checks, or `someChecks` when none is recorded.
    machineQcFailed: (count, reasons) => `${count} machine check(s) failed at publish — recorded here for review. ${reasons}`,
    someChecks: 'Some',
    checksNotEvaluated: 'the checks could not be evaluated',
    checksFlagged: 'Machine checks flagged',
    checksFlaggedCount: (n) => `${n} — enumerated below; the report was delivered as usual.`,
    check: 'Check',
    byTheNumbers: 'By the numbers',
    findingsRated: 'Findings rated',
    onField: 'On-field (the one stress-tested as closest)',
    distinguished: 'Distinguished / manageable',
    offField: 'Off-field (outside the risk zone)',
    areasAssessed: 'Coverage areas assessed',
    openOrLimited: 'Open / limited coverage',
    howToRead: 'How to read this workbook',
    findingsTab: 'Findings',
    findingsTabIs: 'every conflicting mark we surfaced, our call on it, and the evidence behind each call.',
    searchedTab: 'What was searched',
    searchedTabIsRegisterOnly: 'every search we ran. This was a REGISTER-ONLY search: trade mark registers were searched, marketplaces and common-law use were not.',
    searchedTabIsRegisterTerms: 'every register search we ran, term by term. The common-law searching is NOT set out here — see the caveat above — so this tab is not the whole record of what was searched.',
    searchedTabIsEverything: 'every search we ran — register and common-law — so you can see we looked everywhere.',
    coverageTab: 'Coverage & gaps',
    coverageTabIs: 'what is fully cleared and what is still open — read this first if you have a doubt.',
    evidenceTags: 'Evidence tags',
    evidenceTagsAre: "'verified' = checked against the register record we retrieved · 'not yet verified' = stated, but the record was not retrieved · 'inferred' = our own reading · 'not checked' = not checked",
    recordRetrieved: 'Record retrieved?',
    recordRetrievedIs: 'whether the register entry itself was retrieved; where a record could not be retrieved, its details are shown unverified.',
  }),
});

/** The Knockout's audit workbook: its sheets' own words. A value a cell carries arrives formatted. */
export const KNOCKOUT_WORKBOOK = Object.freeze({
  noResults: 'No results found',
  inUseAs: (use) => ` — in use as ${use}`,
  callOk: (bytes) => `ok — ${bytes} bytes`,
  failed: (reason) => `FAILED — ${reason}`,
  setAside: (url) => `Set aside: ${url}`,
  // Working Notes: why a point the run looked at again is still open, as the note's prefix.
  openBecause: Object.freeze({
    'not-corrected': 'Not corrected in this search: ',
    'not-rechecked': 'Corrected, but not read again: ',
    'not-answered': 'Not answered: ',
  }),
  internalNote: 'Internal note',
  registerEstimate: 'Register estimate (model)',
  // Register Counts and Register Filings.
  notAvailable: 'not available',
  allClasses: 'all classes',
  worldwide: 'worldwide',
  formsNotRecorded: 'not recorded — this search predates the close-variation column',
  noCountRecorded: 'no count recorded',
  containingSearch: 'containing search',
  soundAlikeSearch: 'sound-alike search',
  closeVariation: 'close variation',
  identical: 'identical',
  notListed: 'not listed',
  noListingRecorded: 'no listing was recorded for this mark',
  searchDidNotRun: 'the search did not run',
  noneCarriedForward: 'none carried forward',
  noneFound: 'none found',
  cappedAt: (cap) => `capped at ${cap}`,
  // Machine Checks.
  checksFlagged: 'Machine checks flagged',
  checksFlaggedCount: (n) => `${n} — enumerated below; the report was delivered as usual.`,
  check: (i) => `Check ${i}`,
});

/**
 * The audit workbooks' tab names and column headers, keyed by the name the code builds each tab and row on, which is
 * today's English. A translation changes the values and never the keys, because the rows are built on the keys.
 */
export const WORKBOOK_LABELS = Object.freeze({
  sheets: Object.freeze(Object.fromEntries([
    'Summary', 'Findings', 'What was searched', 'Coverage & gaps',
    'Negative Results', 'Audit Trail', 'Working Notes', 'Register Counts', 'Register Filings', 'Machine Checks',
  ].map((n) => [n, n]))),
  columns: Object.freeze(Object.fromEntries([
    // The clearance workbook.
    'Field', 'Value',
    '#', 'Conflicting mark', 'Owner', 'Country', 'Source', 'Class', 'Registration(s)', 'Status & key dates',
    'Record retrieved?', 'Risk band', 'How we treated it', 'Mark similarity', 'Goods proximity', 'Use', 'Enforcer', 'Link',
    'Search term / variant', 'Scope', 'Result', 'Outcome', 'Note',
    'Area', 'State', 'What was done', "What's left",
    // The Knockout workbook.
    'Mark', 'Finding Reference', 'Finding Name', 'Band', 'Type', 'Net', 'Basis', 'Evidence',
    'Search Term', 'Source / Context', 'Notes', 'Result Summary',
    'Classes counted', 'Territories', 'Identical filings', 'Filings containing the name', 'Filings on close variations',
    'Close variation forms', 'Register',
    'Matched form', 'Trademark', 'Status', 'Classes', 'Territory', 'Filed', 'Registered', 'Record',
    'Check', 'What it found',
  ].map((h) => [h, h]))),
});
