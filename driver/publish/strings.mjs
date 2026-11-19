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
  // The risk tier a cover note's badge prints, by the tier it matched.
  tiers: Object.freeze({ veryHigh: 'VERY HIGH', high: 'HIGH', medium: 'MEDIUM', manageable: 'MANAGEABLE', low: 'LOW' }),
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
  // An order that names its countries: the rows below say where (owner, 2026-11-19).
  registerSectionNamed: 'REGISTER',
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
  // A machine check whose finding the report does not print, and the words a few cells fall back to.
  checkNotPassed: 'A machine check on the report did not pass.',
  notChecked: 'not checked',
  commonLawRegistration: '— (common-law)',
  notedOnly: 'n/a — noted only',
  // The engine's own words, and the reader's word each becomes in a cell. Keys are the engine's, lower case.
  readerWords: Object.freeze({
    receipt: 'record', receipts: 'records',
    lint: 'check', tripwire: 'check', tripwires: 'checks',
    composite: 'combined', scatter: 'chart', cache: 'stored copy',
    quadrant: 'position', quadrants: 'positions', coordinate: 'position', coordinates: 'positions',
    meter: 'measure', meters: 'measures',
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
  designating: (list) => ` · designating: ${list}`,
  designationsNotOnRecord: 'designated countries not on the fetched record — rights reach only its designations',
  priorityWindow: 'recent filing — Paris-priority window (potential global backdating)',
});

/**
 * What a registration number linked to the office's own page opens, and why one is cited by number instead: the
 * report's sentences under its findings, and the workbook's Link cell. `name` is the register's name, and `names` a
 * list of them, joined.
 */
export const RECORD_LINKS = Object.freeze({
  opensOfficePage: 'A registration number shown as a link opens the office’s own page for that record.',
  noPage: (name) => `${name}: the register publishes no page for a single record, so its registrations are cited by number.`,
  numberForm: (name) => `${name}: registrations whose numbers are not in the form the register's page address takes are cited by number, not linked.`,
  noAddress: (name) => `${name}: we hold no page address for this register, so its registrations are cited by number.`,
  noAddresses: (names) => `${names}: we hold no page address for these registers, so their registrations are cited by number.`,
  cell: Object.freeze({
    noPage: (name) => `No page for a single record at this register (${name}); cited by number`,
    noAddress: (name) => `No page address held for this register (${name}); cited by number`,
    numberForm: (name) => `Number not in the form this register's page address takes (${name}); cited by number`,
  }),
});

/** The Knockout report page: its own words, section by section. A value a sentence carries arrives formatted. */
export const KNOCKOUT_PAGE = Object.freeze({
  // The jump strip, in its order.
  strip: Object.freeze({ summary: 'Summary', findings: 'Findings', filings: 'Also considered', next: 'Next steps' }),
  degradedNote: 'Automated research for this name was unavailable — manual verification is recommended before relying on this rating.',
  // The rating's qualifier, in words: the closed set's own, and any other word framed.
  qualifier: Object.freeze({ low: 'at the low end of this band' }),
  qualifierOther: (word) => `${word} within this band`,
  names: (n) => `${n} names`,
  classes: (list) => `Classes ${list}`,
  // Registers that are not countries, in the two forms English needs: "the United States" and "United States application".
  registerNames: Object.freeze({
    EM: Object.freeze({ bare: 'European Union', phrase: 'the European Union' }),
    EU: Object.freeze({ bare: 'European Union', phrase: 'the European Union' }),
    WO: Object.freeze({ bare: 'international', phrase: 'the WIPO register' }),
    US: Object.freeze({ bare: 'United States', phrase: 'the United States' }),
    GB: Object.freeze({ bare: 'United Kingdom', phrase: 'the United Kingdom' }),
    UK: Object.freeze({ bare: 'United Kingdom', phrase: 'the United Kingdom' }),
    CH: Object.freeze({ bare: 'Swiss', phrase: 'Switzerland' }),
  }),
  // "a, b and c": `head` arrives joined on commas.
  listEnd: (head, last) => `${head} and ${last}`,
  // The counted scope, in one sentence.
  counted: Object.freeze({
    theRegister: 'the register',
    worldwideOn: (n, provider) => `Counted worldwide, ${n} registers, on ${provider}.`,
    worldwide: (provider) => `Counted worldwide on ${provider}.`,
    named: (list, provider) => `Counted in ${list}, on ${provider}.`,
    listed: (n, provider) => `Counted on ${n} registers, listed on the workbook's Register Counts sheet, on ${provider}.`,
  }),
  // The counts table: its heads, and a cell with no count.
  counts: Object.freeze({
    name: 'Name',
    exactly: (name) => `Exactly ${name}`,
    exactlyTheName: 'Exactly the name',
    contains: (name) => `Contains ${name}`,
    containsTheName: 'Contains the name',
    nearSpellingsOf: (forms) => `Near-spellings (${forms})`,
    nearSpellings: 'Near-spellings',
    noCountRecorded: 'no count recorded',
    notCountedThisRun: 'not counted on this run — it predates this column, and an archived report re-renders as what it was',
    notAvailable: 'not available',
    inClasses: (list) => `classes ${list}`,
    allClasses: 'all classes — this run named none, so nothing narrowed the count',
  }),
  // The filings listed under "Also considered". `rest` is `otherSearches` or `closeVariations`.
  filings: Object.freeze({
    noListing: 'No filings listing was recorded for this name.',
    foundAs: (form) => `found as ${form}`,
    head: Object.freeze({ trademark: 'Trademark', owner: 'Owner', status: 'Status', classes: 'Classes', territory: 'Territory', record: 'Record' }),
    showing: (shown, total, rest) => ` Showing ${shown} of ${total}, most material first — the filings this assessment weighed before the rest, then live filings before dead, in the searched classes before outside them, the name itself before ${rest}. The full list is in the audit workbook's Register Filings sheet.`,
    otherSearches: 'other searches',
    closeVariations: 'its close variations',
    sameRows: " The same rows are in the audit workbook's Register Filings sheet, most material first.",
  }),
  // Why no register was counted: the counts failed on this run, or the product tier does not include them.
  tierAbsence: Object.freeze({
    probeRan: 'Register hit-counts are part of this search, and none could be taken on this run — the per-name reason is recorded in the audit workbook. This is a gap in this run, not a limit of the product.',
    notInTier: 'Register hit-counts (identical · containing · close variations) are not included in this product tier, so no register was counted for this report. They are part of the Knockout search this offering sells today.',
  }),
  // The card fold's label: the clearance's word for the reasoning (owner, 2026-11-18).
  riskAssessment: 'Risk assessment',
  // A finding card's head and fold.
  finding: Object.freeze({
    unnamed: 'Unnamed finding',
    askAi: '\u2726 Ask AI about this finding',
    fullDetail: 'Full detail',
    sources: 'Sources: ',
  }),
  // The source chips a card wears.
  chips: Object.freeze({ commonLaw: 'Common law', register: 'Register' }),
  // About this request: its rows. The heading stays in the renderer, where a guard holds it to the part's name.
  about: Object.freeze({
    on: (provider) => `, on ${provider}`,
    registers: (n) => `${n} ${n === 1 ? 'register' : 'registers'}`,
    countedWorldwide: 'Counted worldwide',
    typeOfSearch: 'Type of search',
    instructedUse: 'Instructed use',
    classes: 'Classes',
    whereSearched: 'Where searched',
    context: 'Context',
    registersCounted: 'Registers counted',
    searchedOn: 'Searched on',
  }),
  // A name's read: where its register position stands, and what was counted for it. `near` is `nameNear` or
  // `closeVariation`; `where` is `above` or `below`; `classWhere` is `inClasses`'s phrase or empty.
  read: Object.freeze({
    filingsNotListed: 'The filings behind the counts could not be listed on this run, so nothing here says whether one stands.',
    countsNotListed: 'The filings behind those counts were not listed on this run.',
    noListing: 'No filings listing was recorded for this name.',
    theRegister: 'the register',
    inClasses: (n, list) => ` in class${n === 1 ? '' : 'es'} ${list}`,
    filingsStand: (n, near, provider, classWhere, refs, where) => `${n === 1 ? 'A filing' : `${n} filings`} of this name or ${near} stand${n === 1 ? 's' : ''} on ${provider}${classWhere} — ${refs} ${where}.`,
    nameNear: 'a name near it',
    closeVariation: 'a close variation of it',
    above: 'above',
    below: 'below',
    noneStands: (provider) => `No filing of this name or a close variation of it stands on ${provider}, in the classes counted.`,
    listingIncomplete: 'The filings listing for this name did not complete, so nothing here says whether one stands.',
    listedBelow: (n) => `${n} filing${n === 1 ? ' is' : 's are'} listed for this name below; none is carried up as a conflict — each is either shown dead on the register or outside the classes counted.`,
    remainingUncertainties: 'Remaining uncertainties',
    readFullAssessment: 'Read the full assessment',
  }),
  // A name's rating card and its row.
  readCard: Object.freeze({
    overallRisk: 'Overall risk',
    why: (band) => `Why ${band}`,
    whatWouldChange: 'What would change this',
    fullNarrative: 'Full narrative',
    noAdverseSignals: 'No adverse signals recorded for this name on this screen.',
  }),
  caveatLead: 'This screen also carries the following limits:',
  sections: Object.freeze({
    conflicts: 'Conflicts',
    leftOpen: 'Left open',
    alsoConsidered: 'Also considered',
    alsoConsideredNote: 'the filings behind the counts',
  }),
  // The top bar. A glyph beside a label stays with the markup.
  topbar: Object.freeze({
    allReports: 'All reports',
    issuedOn: (date) => `Issued on ${date}`,
    askAi: 'Ask AI',
    exportPdf: 'Export PDF',
    downloadAudit: 'Download full audit (Excel)',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
  }),
  // A register filing's card: its statement, its head and fold, and the use check on its owner.
  filingCard: Object.freeze({
    registration: 'registration',
    application: 'application',
    by: (owner) => `by ${owner}`,
    ownerNotStated: 'owner not stated on the record',
    classes: (n, list) => `class${n === 1 ? '' : 'es'} ${list}`,
    classesNotStated: 'classes not stated on the record',
    foundBySearch: (form) => ` Found by a search on ${form}.`,
    foundUnderVariation: (form) => ` Found under the close variation ${form}.`,
    unnamed: 'Unnamed filing',
    registerRecord: 'Register record: ',
    notWeighed: 'Register listing — this card carries no rating of its own',
    useCheckLabel: 'Use-check source:',
    useCheckUnavailable: 'Use check unavailable.',
    useCheckLinkUnavailable: 'link unavailable.',
    proprietorNotStated: 'proprietor not stated',
    noRecordAddress: 'no record address supplied',
  }),
  furtherFilings: (n) => `${n} further filing${n === 1 ? '' : 's'} for this name met the same test — every one of them is in the filings section below.`,
  issuedOn: (date) => `issued on ${date}`,
  // The batch's statement and the summary's list of documents.
  statement: (n, counts) => `Knockout screen — ${n} mark${n === 1 ? '' : 's'}: ${counts}.`,
  noRatedMarks: 'no rated marks',
  documents: 'Documents',
  unnamedMark: '(unnamed mark)',
  oneDocument: 'The register counts, the records and the coverage are in that document.',
  manyDocuments: 'One document per mark, each carrying its own register counts, records and coverage. There is no combined report: this summary is the only place the marks appear together.',
  receiptsIn: (file) => `The receipts are in the audit workbook: \`${file}\`.`,
});

/** The clearance report page: its own words, section by section. A value a sentence carries arrives formatted. */
export const REPORT_PAGE = Object.freeze({
  // The rating card: its labels, and the lines under the gauge. Counts arrive formatted for the reader.
  rating: Object.freeze({
    overallRisk: 'Overall risk',
    verdict: 'Verdict',
    recommendation: 'Recommendation',
    clear: 'Clear',
    conditions: 'Conditions',
    obstacleClass: (cls) => `Class ${cls}.`,
    basedOn: 'Based on',
    why: (band) => `Why ${band}`,
    commonLawUse: 'Common-law use',
    highestExposure: 'Highest exposure',
    recordsReadIn: (n, place) => `${n} records read in ${place}`,
    recordsReadAcross: (n, countries) => `${n} records read across ${countries} countries`,
    internationalRead: (n) => `${n} international registrations read`,
    nearNamesCleared: (n) => `${n} near-names cleared`,
    conflicts: (n) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}`,
    courtChecked: 'court decisions checked',
    courtNoneTouch: 'court decisions checked, none touch the name',
    courtNotChecked: 'court decisions could not be checked',
    searchCoverage: 'Search coverage',
    ratedOn: (framework) => `Rated on the ${framework}`,
    // The four answers, in their order.
    fourAnswers: Object.freeze({
      third_party_rights: 'Third-party rights',
      objection_likelihood: 'Likelihood of objection',
      registrability: 'Registrability',
      client_enforceability: 'Your own enforceability',
    }),
  }),
  allReports: '← All reports',
  // The five tiers, as the gauge's ticks and its pill print them.
  tierLabels: Object.freeze(['Clear', 'Low / Manageable', 'Medium', 'High', 'Very high']),
  tierPills: Object.freeze(['CLEAR', 'LOW', 'MEDIUM', 'HIGH', 'VERY HIGH']),
  // Where a use check's evidence came from, readable after "Evidence: verified,".
  useSource: Object.freeze({
    'owner-site': "from the owner's own site",
    independent: 'from an independent source',
    'register-mirror': 'from a register mirror, which is not evidence of use',
  }),
  useCheckNothingFound: 'Nothing found in the marketplaces searched.',
  useCheckNothingFoundNoMarketplaces: 'Nothing found in the general web search or in any store chosen for this matter.',
  // The meters: their labels, and the use meter's readings.
  meters: Object.freeze({
    use: 'Use',
    confirmed: 'Confirmed',
    notConfirmed: 'Not confirmed',
    unknown: 'Unknown',
    similarity: 'Similarity',
    goodsProximity: 'Goods proximity',
    likelyToEnforce: 'Likely to enforce',
  }),
  // The jurisdictions searched, as the About row and the What was searched section name them.
  scope: Object.freeze({
    coverageLimited: (name) => `${name} (coverage-limited)`,
    worldwideFocusOn: (where) => `Worldwide, focus on ${where}`,
    worldwideList: 'Worldwide',
  }),
  // About this request.
  about: Object.freeze({
    title: 'About this request',
    typeOfSearch: 'Type of search',
    instructedUse: 'Instructed use',
    classes: 'Classes',
    whereSearched: 'Where searched',
    worldwideFocus: (n) => `Worldwide \u00b7 ${n} focus territor${n === 1 ? 'y' : 'ies'}`,
    project: 'Project',
    searchedOn: 'Searched on',
  }),
  doFirst: 'Do this first · time-critical',
  // The answers to the client's instructions: the fold that holds the rest of an answer.
  more: 'More',
  // The names the search read and cleared, by group. Counts arrive formatted for the reader.
  cleared: Object.freeze({
    groups: Object.freeze({ 'dead-filing': 'Dead filings', 'different-goods': 'Different goods', other: 'Read and cleared' }),
    allInWorkbook: (n) => `All ${n} in the audit workbook`,
    names: (formatted, n) => `${formatted} ${n === 1 ? 'name' : 'names'}`,
    runCommonLawRecord: "the run's own common-law search record",
    webAndMarketplace: 'Web and marketplace names',
  }),
  whereItStands: 'Where it stands',
  nothingFound: 'Nothing found',
  // Court decisions: the section, and the line it carries. `forWhere` is `court.forWhere`'s phrase or empty.
  court: Object.freeze({
    title: 'Court decisions',
    forWhere: (where) => ` for ${where}`,
    notCompleted: (forWhere) => `Case-law research could not be completed${forWhere}.`,
    noneFound: (forWhere) => `Court decisions: none found${forWhere}.`,
    found: (forWhere) => `Court decisions were searched${forWhere} and are cited against the findings above.`,
  }),
  // What was searched: the section's rows. Counts arrive formatted for the reader, with the number beside for the plural.
  // The rows named for a part (Register, Marketplace and web, Local-language investigation, Court decisions) keep their
  // names in the renderer, where a guard holds each to the part's shipped name.
  searched: Object.freeze({
    title: 'What was searched',
    counts: 'Counts for this search',
    whereSearched: 'Where searched',
    inPlace: (place) => ` in ${place}`,
    acrossCountries: (n) => ` across ${n} countries`,
    plus: ', plus ',
    international: (formatted, n) => `${formatted} international registration${n === 1 ? '' : 's'}`,
    recordsRead: (formatted, n, where) => `${formatted} record${n === 1 ? '' : 's'} read${where}`,
    spellings: 'Spellings searched',
    checksWebAndStores: (n) => `${n} checks: the general web, plus any stores chosen for this matter.`,
    checksOnPlatforms: (n, platforms) => `${n} checks on ${platforms} platforms`,
    reputation: 'Reputation and meaning',
    checks: (n) => `${n} checks`,
    localScript: 'Local-script spellings',
    searched: 'Searched',
    notSearched: 'Not searched',
    included: 'Included',
    notPartOfSearch: 'Not part of this search',
    courtWords: Object.freeze({ found: 'Found', 'none-found': 'None found', 'not-checked': 'Not searched' }),
    leftOpen: 'Left open',
    provenance: 'Record provenance',
    numbersRead: 'Registration numbers on the cards were read from the register records. ',
    indexEntry: 'A registration shown as a register-index entry was seen in the register index; its full record was not pulled. ',
    inferred: '\u201cInferred\u201d beside an owner\u2019s likelihood to object means we judged it from what the owner sells and holds; we had no enforcement history to read.',
    everySearch: 'Every search and result, in the audit workbook',
  }),
  // Also considered: the names ruled out, as cards.
  alsoConsidered: Object.freeze({
    title: 'Also considered',
    defaultWhy: 'a different name in a related field — not a conflict with your mark',
    whyRuledOut: 'Why it was ruled out',
    legal: 'Legal position.',
    practical: 'Practical position.',
    ruledOut: 'Ruled out',
    askAi: '\u2726 Ask AI about this finding',
  }),
  // The closed heading over the conflicts below the risk (owner, 2026-11-18; both forms 2026-11-19): their count, and
  // each band below the risk by the framework's own word, joined by "or". One conflict reads in the singular.
  lowerBand: (count, bands) => `${count.toLocaleString('en-GB')} more conflict${count === 1 ? '' : 's'} rated ${bands.join(' or ')}`,
  // The chart of conflicts: its axes, its zone and its legend.
  chart: Object.freeze({
    goodsAxis: 'Goods / services proximity →',
    markAxis: 'Mark similarity →',
    zone: 'CONFUSION ZONE',
    onField: 'On-field · drives the read',
    secondaryWatch: 'Secondary · watch',
    secondaryManageable: 'Secondary · manageable',
    pending: 'Pending',
  }),
  // The rights-holders key beside the chart.
  key: Object.freeze({
    classes: (list) => `Cl.${list}`,
    // `link` arrives as the link to the section, its words from `commonLawSectionLink`.
    commonLawHint: (link) => `Common-law / marketplace — unregistered use, not register rights (${link}).`,
    commonLawSectionLink: 'see the Common-law & marketplace section',
    commonLawGroup: 'Common-law / marketplace',
    unregisteredUse: 'Unregistered use',
    title: 'Rights-holders',
    hint: 'Grouped by jurisdiction — open a region for its holders.',
  }),
  onFieldCommonLaw: 'On-field common-law conflicts (full cards above): ',
  marks: (n) => `${n} mark${n === 1 ? '' : 's'}`,
  evidence: (word) => `Evidence: ${word}`,
  // A finding card: its head, its rating chip, its one line when the read is missing, and its folds.
  card: Object.freeze({
    owner: 'Owner',
    notRatedAwareness: 'Not rated — awareness',
    level: (level) => `Level ${level}`,
    composite: (composite) => `Composite ${composite}`,
    bandRisk: (band) => `${band} risk`,
    notRatedCommercial: 'Not rated — commercial awareness',
    tierRisk: (tier, level, composite, dispute) => `${tier} risk (Level ${level} · Composite ${composite}) — ${dispute}.`,
    legalRisk: 'Legal risk.',
    practicalPosition: 'Practical position.',
    theRead: 'The read',
    includeInPdf: (n) => `Include conflict ${n} in the PDF`,
    askAi: '\u2726 Ask AI about this finding',
  }),
  // The mark itself: what the mark is, before any conflict.
  markItself: Object.freeze({
    title: 'The mark itself',
    distinctiveness: 'Distinctiveness.',
    connotation: 'Connotation & meaning.',
    acquired: (text) => `Acquired distinctiveness: ${text}`,
    perClass: (cls) => `Class ${cls}.`,
    byClassAndMarket: 'By class and market',
    registrationsConsidered: 'Registrations considered',
  }),
  famousNeighbours: 'Famous-mark neighbours noted',
  // The banner a demonstration report carries, on the clearance and the Knockout alike.
  demoBanner: Object.freeze({
    title: 'Demonstration report.',
    text: 'The mark is invented and this matter is not a real engagement. The register records, the searches behind them and the risk assessment are real.',
  }),
  // The top bar and its export menu. A glyph beside a label stays with the markup.
  topbar: Object.freeze({
    allReports: 'All reports',
    issuedOn: (date) => `Issued on ${date}`,
    askAi: 'Ask AI',
    exportAndAudit: 'Export & audit',
    downloadAudit: 'Download full audit (Excel)',
    selectAll: 'Select all',
    selectNone: 'Select none',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    exportHint: 'Tick a finding to keep it in the exported PDF; untick to drop it. Internal (review-only) notes are removed on export.',
  }),
  // What happens next: the section, and the chip each kind of step wears.
  next: Object.freeze({
    title: 'What happens next',
    timeCritical: 'Time-critical',
    openQuestion: 'Open question',
    yourDecision: 'Your decision',
    monitor: 'Monitor',
    filingStep: 'Filing step',
    beforeYouCanRely: 'Before you can rely',
  }),
  // The models that prepared the report. `list` arrives joined.
  preparedWith: (claude, list) => `Prepared with${claude ? ' Claude' : ''}: ${list}.`,
  claudeModel: (id) => `Claude ${id}`,
  // The jump strip's Conflicts entry; Summary stays in the renderer, where a guard holds it to the part's name, and
  // the others are their sections' titles.
  strip: Object.freeze({ conflicts: 'Conflicts' }),
  // The fold under the summary's lead.
  dependsOn: 'What this depends on',
  // The names set apart on the record, grouped by why, and a manageable owner's kind.
  setApart: Object.freeze({
    distinguished: 'Argued apart on the mark',
    'coexistence-partner': 'Coexistence on the record',
    'off-field:different-field': 'A different commercial field',
    'off-field:no-material-risk': 'Clearly won',
    'off-field:unstated': 'Cleared — ground not stated on the record',
  }),
  commonLaw: 'common-law',
  classesShort: 'Cl.',
  manageable: Object.freeze({
    'large-competitor': 'Large competitor',
    'commercial-partner': 'Commercial partner',
    troll: 'Troll',
    'well-known-enforcer': 'Well-known enforcer',
  }),
  // A card's Full detail: its fold, its registrations, its evidence lines and its open items. A link or a value that
  // carries markup arrives as markup; the words around it are here.
  detail: Object.freeze({
    fold: 'Full detail',
    inWorkbook: ' — full record in the audit workbook (“Download full audit (Excel)”)',
    registration: 'registration',
    indexEntry: '(register-index entry)',
    recordNotRetrieved: 'Official register record could not be retrieved',
    detailsUnverified: ' — registry details in this card are unverified.',
    appetite: (level) => `${level} appetite`,
    verified: 'verified',
    source: (src) => `source: ${src}`,
    enforcementOnFile: 'enforcement record on file',
    inferred: 'inferred',
    profileSignal: ' — reputation/profile signal.',
    telemetry: 'Enforcement telemetry.',
    corsearchRecords: 'Corsearch records ',
    aggression: (n) => `an aggression indicator of ${n}`,
    and: ' and ',
    oppositions: (n) => `${n} opposition proceeding${n === 1 ? '' : 's'}`,
    onOwnersRecord: (uri) => ` on the owner's record (${uri}) — provider telemetry, read beside the enforcer meter.`,
    useChecked: 'Use checked.',
    ownMarks: "Search of the client's own marks.",
    caseLaw: 'Case-law',
    openItem: 'Open item:',
    seniorNotPulled: (link) => ` we could not pull the official record for the oldest registration in this family (${link}). We verified this conflict from a later registration of the same mark by the same owner. Checking that oldest record is still open.`,
    seniorUnknown: ' we could not tell which registration in this family is the oldest — the register index gave us no dates. The conflict itself is verified from the record we pulled; identifying the oldest right is still open.',
    ifEnforced: 'If enforced:',
  }),
  // The findings sections: their headings and the leads of their folds. "Marks that can coexist" stays in the
  // renderer, where a guard holds both its layouts to the ruled words; Conflicts is the strip's own entry.
  findings: Object.freeze({
    sessionNotice: 'Session-wide notice',
    landscape: 'The conflict landscape',
    secondaryWatch: 'Secondary & watch',
    famousLead: 'Famous-mark neighbours.',
    famousNote: 'Diligence — no register record; not scored, does not affect the risk read.',
    sameNameLead: 'Same name, a different commercial field.',
    sameNameNote: 'Listed for completeness — not conflicts with your mark.',
  }),
  // What the search covered: each coverage state's word, and the head over the open rows. The connector names the
  // states in these same words.
  coverageStates: Object.freeze({
    'confirmed-clean': 'Searched — clean',
    'coverage-limited': 'Partially covered',
    open: 'Open item',
    'not-searched': 'Not searched',
    note: 'Note',
  }),
  nextStepsHead: 'Next steps & monitoring',
  marketplaceWebChip: 'Marketplace / web',
  chartTitle: (n) => `Chart of ${n} conflict${n === 1 ? '' : 's'}, placed by how similar each mark is and how close its goods are; each number links to its card below.`,
  // A record entry fetched from the register; `register` is the fallback when the run names no provider.
  recordVerified: (provider, date) => `verified — ${provider} record fetched ${date}`,
  register: 'register',
  followUpPrefix: 'Follow-up / ',
  exportPdfTicked: 'Export PDF (ticked findings)',
  searchedOn: (date) => `searched on ${date}`,
  issuedOn: (date) => `issued on ${date}`,
});
