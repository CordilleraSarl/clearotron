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
  // The register service's own reach, as the coverage line states it; a run that recorded none keeps the line above.
  registerSectionReach: (service, offices) => `REGISTER  —  ${service}, ${offices} office${offices === 1 ? '' : 's'}`,
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
  // Summary: the Jurisdiction row, the register's scope and then the common-law layer. `scope` arrives joined.
  jurisdictionLine: Object.freeze({
    worldwide: 'Worldwide',
    registerOnly: (scope) => `${scope} (register only — no common-law / marketplace search)`,
    noMarketplaces: (scope) => `${scope} (register) + common-law (Western web / social, plus any stores chosen for this matter)`,
    withCommonLaw: (scope) => `${scope} (register) + common-law (Western web / marketplace / social)`,
  }),
  // Summary: the Machine QC row's reasons, one per check the delivery failed. A list arrives joined.
  heldBecause: Object.freeze({
    findingsStale: (list) => `the reviewer's corrections did not reach the client-facing findings (${list}) — re-run the correction before this goes out`,
    escalationFailed: "the main search didn't finish — it needs to be re-run before this can be relied on",
    recordMismatch: 'a registration detail in the report does not match its official record',
    countsDoNotAddUp: 'the registration counts in the report do not add up',
    withdrawnStillShown: 'a conflict the reviewer withdrew still appears in the deliverable — the correction did not stick',
    permissionProse: 'the deliverable explains missing coverage by saying a search tool was blocked or lacked permission — on this configuration that is normally a by-design exclusion rather than an outage, so both the explanation and the coverage it excuses must be re-established before this can be relied on',
    findingsUnreadable: 'the results could not be read back to build the report',
    findingQuarantined: 'a result could not be read and had to be set aside, so the report would be missing it',
    inputAbsent: (list) => `a required input to this report was not there (${list}) — the report was built without it, which is not the same as a search that found nothing`,
  }),
  // Coverage & gaps: a probe the run decided on and never sent, and a result the run read and put down.
  overTheCap: 'over the cap, never dispatched',
  setAside: (what) => `Set aside: ${what}`,
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
 * The audit workbooks' tab names and column headers, keyed by the name the code builds each tab and row on. A header
 * the owner renamed reads differently from its key; a translation changes the values and never the keys, because the
 * rows are built on the keys.
 */
export const WORKBOOK_LABELS = Object.freeze({
  sheets: Object.freeze(Object.fromEntries([
    'Summary', 'Findings', 'What was searched', 'Coverage & gaps',
    'Negative Results', 'Audit Trail', 'Working Notes', 'Register Counts', 'Register Filings', 'Machine Checks',
  ].map((n) => [n, n]))),
  columns: Object.freeze({ ...Object.fromEntries([
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
    ].map((h) => [h, h])),
    // The owner's labels (2026-11-18): the report's words for the enforcement meter, and the Knockout's headings in
    // the clearance workbook's sentence case, in its words where a column holds the same thing.
    'Enforcer': 'Likely to enforce',
    'Finding Reference': 'Finding reference', 'Finding Name': 'Conflicting mark', 'Band': 'Risk band',
    'Search Term': 'Search term', 'Source / Context': 'Source / context', 'Notes': 'Note', 'Result Summary': 'Result summary',
  }),
});

/** The list of reports a client's own index page shows: its heading, its table and its search and pages. */
export const CLIENT_INDEX = Object.freeze({
  heading: (account) => `Trademark clearance — ${account}`,
  subheading: (n) => `${n} report(s) for this account · access-controlled · noindex.`,
  columns: Object.freeze({ matter: 'Matter', project: 'Project', client: 'Client', overall: 'Overall', run: 'Run', audit: 'Audit' }),
  search: 'Search',
  searchPlaceholder: 'Filter by matter, project or verdict…',
  searchLabel: 'Filter reports',
  noMatch: 'No matching reports',
  previous: 'Prev',
  next: 'Next',
  // The page's count line, built in the browser: "1–20 of 45", then " shown" under a filter.
  of: ' of ',
  shown: ' shown',
  retired: ' retired',
});

/** The register's own record of a cited registration, as the report shows it: its labels and its notes. */
export const REGISTER_RECORD = Object.freeze({
  // The labels, as approved on 2026-11-18.
  labels: Object.freeze({
    title: 'Register record',
    mark: 'Mark',
    goods: 'Goods and services',
    owner: 'Owner',
    country: 'Country',
    status: 'Status',
    number: 'Register number',
  }),
  mtNote: 'For the original wording, open the register number or use Ask AI.',
  noGoods: 'The record states no goods or services.',
  classNotStated: 'Class not stated',
  logoNotRetrieved: 'Logo not retrieved',
  registrationsCount: (n) => `${n} registrations`,
  showAllTerms: (n) => `Show all ${n} terms`,
  // `language` is the record's language by its English name, or null when the record does not say.
  machineTranslation: (language) => (language ? `Machine translation from ${language}` : 'Machine translation'),
  asRegistered: (language) => (language
    ? `In ${language}, as registered. No English translation on the record.`
    : 'As registered. No English translation on the record.'),
  logoAlt: (mark, country) => `${mark}, logo as registered in ${country}`,
});
