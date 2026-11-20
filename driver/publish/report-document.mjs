// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/report-document.mjs — the run's report as one versioned JSON document, `report-document/clearance-1`.
//
// Every surface a run publishes (the page, the workbook, the cover emails, meta.json, the data file and the
// connector) reads its facts from what publish assembles. Today each surface takes them by its own route; this
// document is the one route they move to, one surface at a time, each move proved byte-equal. It is written to
// the run's own record (`_driver/report-document.json`), never the pool: the pool is the delivered archive, and
// the reviewer and staff sections do not belong in it.
//
// THE SECTION IS THE AUDIENCE. `client` is what reaches the client page, the email, the data file and the
// portal; `reviewer` is what only the workbook and the reviewing lawyer see; `staff` is the run record's alone.
// `run`, `scope`, `framework`, `verdict` and `prose` are read by every surface. A value sits in one place.
//
// VALUES ARE STORED RAW, as publish read them. The client scrub, a surface's own fallback (the data file's
// `matter || runId`, meta.json's frozen stage label) and its own field names are the projection's work, so
// two surfaces that default differently today still can from one document.
//
// JSON-SAFE BY CONSTRUCTION: a Map is stored as its [key, value] entries in insertion order (an object would
// turn ordinal keys into strings and reorder them), a Set as its members in insertion order, a Set inside a Map's
// value included (JSON writes a Set as `{}`). The register's
// records and the saved logos are stored by reference: their bodies stay in the run's `_records/` and
// `_driver/logos/`, which can hold thousands of records.
//
// PURE: no IO and no clock. publishReport hands it the values readClearanceDocument read.
import { clearanceReportData, knockoutReportData } from './report-data.mjs';
import { deriveActionConditions } from '../findings-model.mjs';
import { deliveryFlagLines } from '../predelivery-lint.mjs';
import { NOT_COMPLETED } from '../degraded-parts.mjs';

export const CLEARANCE_DOCUMENT = 'report-document/clearance-1';

const entries = (m) => (m instanceof Map ? [...m].map(([k, v]) => [k, v instanceof Set ? [...v] : v]) : null);
const members = (s) => (s instanceof Set ? [...s] : null);
const orNull = (v) => (v === undefined ? null : v);

/**
 * The clearance run as one document. `d` is readClearanceDocument's return; `codename`, `customerKey` and
 * `auditFile` are known only to publishReport (the last once the workbook is built).
 */
export function clearanceReportDocument(d, { codename = null, customerKey = null, auditFile = null, auditError = null } = {}) {
  const all = Array.isArray(d.findings) ? d.findings : [];
  const isWithdrawn = (f) => f?.disposition === 'withdrawn';
  // The forward asks as the report partitions them. An ask whose findings were all withdrawn is dropped
  // here, so the client section never needs the withdrawn findings to read its own asks.
  const { conditionActions, advisoryActions } = deriveActionConditions(d.actionsRegister ?? [], all);
  const pol = d.searchPolicy ?? null;
  return {
    document: CLEARANCE_DOCUMENT,
    build: { engineCommit: orNull(d.engineCommit), renderedAt: orNull(d.renderedAt), tokens: orNull(d.tokenRollup?.total) },
    run: {
      runId: d.runId ?? null,
      codename: codename || null,
      customerKey: customerKey || null,
      organisation: orNull(d.organisation),
      project: orNull(d.project),
      markName: orNull(d.markName),
      issued: orNull(d.issued),
      issuedAt: orNull(d.issuedAt),
      asOf: orNull(d.asOf),
      url: orNull(d.reportRoute),
      auditFile: auditFile || null,
      product: {
        name: orNull(d.productName),
        level: orNull(pol?.level),
        // Today's registry's label and the one frozen with the run, apart: the page and the data file read the
        // first, meta.json the second.
        stageLabel: orNull(d.stageLabel),
        frozenStageLabel: orNull(d.frozenStageLabel),
        depthNote: orNull(d.depthNote),
      },
      provenance: {
        recipe: orNull(pol?.recipe), enqueuedVia: orNull(pol?.enqueuedVia),
        enqueuedBy: orNull(pol?.enqueuedBy), parentRunId: orNull(pol?.parentRunId),
      },
      // The register the run read: its name, its citation rule, and where its records are published.
      provider: {
        label: orNull(d.providerLabel),
        citation: orNull(d.runProviderConf?.recordCitation),
        origin: orNull(d.recordOrigin),
        origins: orNull(d.runOrigins),
      },
      // The findings record's declared version; the page chooses the grouped negatives' layout by it.
      findingsVersion: orNull(d.findingsSchemaVersion),
    },
    scope: {
      jurisdiction: orNull(d.jurisdiction),
      scopeBasis: orNull(d.scopeBasis),
      searchedJurisdictions: orNull(d.searchedJurisdictions),
      planTerritories: orNull(d.planTerritories),
      registerReach: orNull(d.registerReach),
      registerScope: orNull(d.registerScope),
      registerOnly: Boolean(d.registerOnly),
      noMarketplacesPicked: Boolean(d.noMarketplacesPicked),
      searchDepth: orNull(d.searchDepth),
    },
    framework: { manifest: orNull(d.framework), method: orNull(d.frameworkMethod) },
    verdict: {
      // The verdict record whole. Its sign-off is the reviewer's word, but the page prints it as the recommendation
      // on a record with no statement, so it is read here with the rest.
      record: orNull(d.verdictInfo),
      // The record as written in the run's verdict file, which the cover email reads. It differs from `record` on a record
      // older than the derived display fields, and where the assessment was not completed.
      written: orNull(d.verdictWritten),
      assessmentNotCompleted: Boolean(d.assessmentNotCompleted),
    },
    client: {
      findings: all.filter((f) => !isWithdrawn(f)),
      coverage: d.coverage ?? [],
      contextNotes: d.contextNotes ?? [],
      markAssessment: orNull(d.markAssessment),
      fourAnswers: orNull(d.fourAnswers),
      askAnswers: orNull(d.askAnswers),
      actions: { conditions: conditionActions, advisories: advisoryActions },
      coverageJudgment: orNull(d.coverageJudgmentDisplay),
      // Each finding's court decisions. The session-wide notice is not carried: no surface prints it.
      caseLaw: { byOrdinal: entries(d.caseLawByOrdinal) ?? [] },
      enforcerSignals: d.enforcerSignals ?? [],
      seniorRights: orNull(d.seniorRights),
      records: d.recordsByUri instanceof Map ? [...d.recordsByUri.keys()] : [],
      recordLinks: d.officeLinks ? { byUri: entries(d.officeLinks.byUri), tally: orNull(d.officeLinks.tally), summary: orNull(d.officeLinks.summary) } : null,
      logos: d.logos instanceof Map ? [...d.logos].map(([ref, l]) => [ref, l?.state ?? null]) : [],
      followUpKinds: entries(d.followUpKinds) ?? [],
      servedModels: orNull(d.served),
    },
    reviewer: {
      // Each withdrawn finding with its place in the run's list, so a reader can restore the list's order.
      withdrawn: all.flatMap((f, at) => (isWithdrawn(f) ? [{ at, finding: f }] : [])),
      quarantined: d.quarantined ?? [],
      coverageJudgment: orNull(d.coverageJudgment),
      corrections: orNull(d.correctionsDoc),
      // The predelivery checks that failed, with their raw detail, which stays here: the workbook is handed their delivery
      // lines. The run's other review receipts reach no surface, so they are not carried.
      lint: d.reviewReceipts?.lint ?? [],
      droppedConditions: d.droppedConditions ?? [],
      undispatchedProbes: d.undispatchedProbes ?? [],
      withheldFamilies: d.withheldFamilies ?? [],
      releasedFamilies: d.releasedFamilies ?? [],
      setAside: d.setAside ?? [],
      fetchState: orNull(d.fetchState),
      clientGate: orNull(d.clientGate),
      degradedParts: d.degradedRows ?? [],
      commonLawJoinedTerms: members(d.commonLawJoinedTerms),
      // audit.md as parsed: the search log the workbook sets out.
      audit: orNull(d.auditParsed),
    },
    staff: {
      inputsAbsent: d.inputsAbsent ?? [],
      publishParts: d.publishParts ?? [],
      findingsError: orNull(d.findingsError),
      auditError: auditError ?? null,
    },
    // report.md as parsed: its front matter, its sections by heading and the finding cards. Raw, as the page reads it.
    prose: {
      frontMatter: d.parsed?.fm ?? {},
      sections: d.parsed?.secs ?? {},
      cards: d.parsed?.cards ?? [],
    },
  };
}

/**
 * The data file (`report-data/clearance-1`) as the document's client projection: the same producer, handed
 * the document's values. Equal byte for byte to the file publish writes today.
 */
export function clearanceReportDataOf(doc) {
  const fm = doc.prose.frontMatter;
  const { run, scope, verdict, client } = doc;
  return clearanceReportData({
    runId: run.runId, codename: run.codename, matter: fm.matter, markName: run.markName, title: fm.title,
    customerKey: run.customerKey || 'generic', issued: run.issued, url: run.url, auditFile: run.auditFile,
    // The stage label REGISTRY-FIRST: today's registry's label, the one report.html renders, so a republished
    // pre-renumber run cannot carry one label on its page and another in its data file. The label frozen with the run
    // is the last resort, for a level today's registry no longer knows; meta.json keeps the frozen one by design.
    searchLevel: run.product.level, stageLabel: run.product.stageLabel ?? run.product.frozenStageLabel ?? null,
    engineCommit: doc.build.engineCommit, servedModels: client.servedModels,
    framework: doc.framework.manifest, verdictInfo: verdict.record, findings: client.findings,
    coverage: client.coverage, contextNotes: client.contextNotes, markAssessment: client.markAssessment,
    fourAnswers: client.fourAnswers, askAnswers: client.askAnswers,
    actions: [...client.actions.conditions, ...client.actions.advisories],
    jurisdiction: scope.jurisdiction, searchedJurisdictions: scope.searchedJurisdictions, scopeBasis: scope.scopeBasis,
    caption: fm.overall_caption || null, assessmentNotCompleted: verdict.assessmentNotCompleted,
  });
}

/**
 * The rating a clearance's surfaces state, and its badge: the verdict record's as the page reads it, the report's front
 * matter on a run older than the record, and none where the assessment was not completed. The page, the run record and
 * the cover email read it here, so a saved verdict from an assessment that did not complete rates nothing on any of them.
 */
export function clearanceRatingOf(doc) {
  const fm = doc.prose.frontMatter, { record, assessmentNotCompleted } = doc.verdict;
  if (assessmentNotCompleted) return { word: undefined, badge: undefined };
  return { word: record?.tier ?? fm.overall_label, badge: record?.badge ?? fm.overall_badge };
}

/** The run's findings in their own order: the withdrawn ones are put back where they were. */
export function allFindingsOf(doc) {
  const out = [...doc.client.findings];
  for (const { at, finding } of doc.reviewer.withdrawn) out.splice(at, 0, finding);
  return out;
}

/**
 * The document with the workbook publishing wrote, or why there is none. The document is built before the workbook,
 * which reads it, so the workbook's file name is set on it afterwards.
 */
export const withWorkbook = (doc, { auditFile = null, auditError = null } = {}) => ({
  ...doc, run: { ...doc.run, auditFile: auditFile || null }, staff: { ...doc.staff, auditError: auditError ?? null },
});

/**
 * The audit workbook's inputs from the document: buildAudit's contract, the search log, and the front matter. The failing
 * predelivery checks are handed over as their delivery lines, never their raw detail: the workbook's download link rides
 * in the cover note a client principal reads, so the workbook is a delivery surface under the same rule.
 */
export function clearanceWorkbookOf(doc) {
  const { run, scope, verdict, client, reviewer } = doc;
  const origins = run.provider.origins;
  return {
    contract: {
      degradedParts: reviewer.degradedParts, droppedConditions: reviewer.droppedConditions,
      undispatchedProbes: reviewer.undispatchedProbes, withheldFamilies: reviewer.withheldFamilies,
      releasedFamilies: reviewer.releasedFamilies, setAside: reviewer.setAside, findings: allFindingsOf(doc),
      frameworkMethod: doc.framework.method, coverage: client.coverage, contextNotes: client.contextNotes,
      coverageJudgment: reviewer.coverageJudgment, markAssessment: client.markAssessment, corrections: reviewer.corrections,
      fetchState: reviewer.fetchState, verdict: verdict.record, jurisdiction: scope.jurisdiction,
      commonLawJoinedTerms: reviewer.commonLawJoinedTerms, registerOnly: scope.registerOnly, clientGate: reviewer.clientGate,
      lintFailures: deliveryFlagLines(reviewer.lint), productName: run.product.name,
      registerPublishesRecordPages: origins == null ? null : origins.length > 0,
      recordLinks: client.recordLinks?.byUri ? new Map(client.recordLinks.byUri) : null,
      assessmentNotCompleted: verdict.assessmentNotCompleted, registerReach: scope.registerReach, registerScope: scope.registerScope,
      localScripts: scope.searchDepth?.counts?.localScripts ?? null,
    },
    audit: reviewer.audit,
    title: doc.prose.frontMatter.title,
    frontMatter: doc.prose.frontMatter,
  };
}

export const KNOCKOUT_DOCUMENT = 'report-document/knockout-1';

/**
 * The Knockout run as one document: every name in the batch, with each name's report as publishing wrote it.
 * `d` is readKnockoutDocument's return; `reports` is each name's report ({ mark, slug, file, url, band }), in
 * the order publishing wrote them.
 *
 * The run's findings record is kept whole, under its own names. The data file renames four of a mark's fields
 * (rating, ratingQualifier, bullets, purpleNotes) and goes on doing so in its projection: a rename here would be
 * one more way for the build to fail, and the record is what the page reads.
 */
export function knockoutReportDocument(d, { runId, codename = null, customerKey = null, findings, framework = null, overall = null, searchPolicy = null, depthNote = null, tokens = null, reports = [], auditFile = null, auditError = null }) {
  const identity = d.identity ?? {};
  return {
    document: KNOCKOUT_DOCUMENT,
    build: { engineCommit: orNull(d.engineCommit), renderedAt: orNull(d.dates?.renderedAt), tokens: orNull(tokens) },
    run: {
      runId: runId ?? null,
      codename: codename ?? null,
      customerKey: customerKey || null,
      organisation: orNull(d.organisation),
      title: orNull(d.title),
      markNames: d.markNames ?? [],
      issued: orNull(d.issued),
      issuedAt: orNull(d.dates?.issuedAt),
      searched: orNull(d.searched),
      origin: orNull(d.origin),
      auditFile: auditFile || null,
      single: Boolean(d.single),
      // Each name's report, with the band it carries: the name's own on a batch, the run's on one name.
      reports: reports.map(({ mark, slug, file, url, band }) => ({ mark, slug, file, url: orNull(url), band: band ?? null })),
      product: {
        name: orNull(identity.identity), stageLabel: orNull(identity.stageLabel), template: orNull(identity.template),
        banner: orNull(identity.banner), level: orNull(searchPolicy?.level), depthNote: orNull(depthNote),
      },
      provenance: {
        recipe: orNull(searchPolicy?.recipe), enqueuedVia: orNull(searchPolicy?.enqueuedVia),
        enqueuedBy: orNull(searchPolicy?.enqueuedBy), parentRunId: orNull(searchPolicy?.parentRunId),
      },
    },
    scope: {
      instructedScope: orNull(d.instructedScope),
      scopeUnreadable: Boolean(d.scopeUnreadable),
      // The frozen policy whole: the page composes "About this request" and the masthead from it.
      policy: orNull(searchPolicy),
      probeRan: Boolean(d.probeRan),
      // The searches that did not complete, which the page's Left open and the workbook's part rows read.
      steps: orNull(d.steps),
    },
    framework: { manifest: orNull(framework), method: orNull(d.frameworkMethod) },
    verdict: { overall: orNull(overall), badge: orNull(d.overallBadge), statement: orNull(d.statement) },
    client: {
      findings: orNull(findings),
      registerCounts: orNull(d.registerCounts),
      registerRecords: orNull(d.registerRecords),
      registerRecordsUnreadable: Boolean(d.registerRecordsUnreadable),
      // By reference: each filing's saved record stays in the run's `_records/` or its record log.
      filingRecords: d.filingRecords instanceof Map ? [...d.filingRecords.keys()] : [],
      logos: d.logos instanceof Map ? [...d.logos].map(([ref, l]) => [ref, l?.state ?? null]) : [],
      ownerChecks: d.ownerChecks ?? [],
      recordLinks: d.officeLinks ? { tally: orNull(d.officeLinks.tally), summary: orNull(d.officeLinks.summary) } : null,
      servedModels: orNull(d.served),
    },
    reviewer: {
      sweepReceipts: d.sweepReceipts ?? [],
      qcFlags: d.qcFlags ?? [],
      machineChecksFailed: orNull(d.machineChecksFailed),
      lookupsNotRun: d.lookupsNotRun ?? [],
      recordsNotKept: d.recordsNotKept ?? [],
      openPoints: d.openPoints ?? [],
      recordLinksDropped: orNull(d.recordLinksDropped),
      registerCountsUnreadable: Boolean(d.registerCountsUnreadable),
    },
    staff: { auditError: auditError ?? null },
  };
}

/**
 * One name's data file (`report-data/knockout-1`) as the document's client projection, by the name's place in
 * the batch. Equal byte for byte to the file publishing writes for that name today.
 */
export function knockoutReportDataOf(doc, at) {
  const { run, client } = doc;
  const findings = client.findings ?? {};
  const m = (findings.marks ?? [])[at];
  // The name's own slice, as publishing builds it: on a batch, the page opens with the name's own assessment.
  const one = {
    ...findings, marks: [m],
    batch: { ...(findings.batch ?? {}), ...(run.single ? {} : { executiveSummary: String(m.assessment ?? '').trim() }) },
  };
  const report = run.reports[at];
  return knockoutReportData(one, doc.framework.manifest, {
    runId: run.runId, codename: run.codename, overall: report.band, issued: run.issued,
    registerCounts: client.registerCounts, registerRecords: client.registerRecords, ownerChecks: client.ownerChecks,
    auditFile: run.auditFile, customerKey: run.customerKey, matter: run.runId, servedModels: client.servedModels,
    identity: { identity: run.product.name, stageLabel: run.product.stageLabel, level: run.product.level },
    url: report.url,
  });
}

/** The Knockout workbook's inputs from the document, under the names buildKnockoutWorkbook takes them. */
export function knockoutWorkbookOf(doc) {
  const { client, reviewer, scope } = doc;
  return {
    findings: client.findings, sweepReceipts: reviewer.sweepReceipts, registerCounts: client.registerCounts,
    qcFlags: reviewer.qcFlags, framework: doc.framework.manifest, registerRecords: client.registerRecords,
    frameworkMethod: doc.framework.method, ownerChecks: [...client.ownerChecks, ...reviewer.lookupsNotRun],
    parts: {
      listing: client.registerRecords ? null : scope.steps.listing, reading: scope.steps.reading, review: scope.steps.review,
      machineChecks: reviewer.machineChecksFailed, aboutThisRequest: scope.scopeUnreadable ? { reason: NOT_COMPLETED } : null,
      droppedLinks: reviewer.recordLinksDropped, recordsNotKept: reviewer.recordsNotKept, openPoints: reviewer.openPoints,
    },
  };
}
