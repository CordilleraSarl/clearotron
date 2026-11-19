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
// turn ordinal keys into strings and reorder them), a Set as its members in insertion order. The register's
// records and the saved logos are stored by reference: their bodies stay in the run's `_records/` and
// `_driver/logos/`, which can hold thousands of records.
//
// PURE: no IO and no clock. publishReport hands it the values readClearanceDocument read.
import { clearanceReportData } from './report-data.mjs';
import { deriveActionConditions } from '../findings-model.mjs';

export const CLEARANCE_DOCUMENT = 'report-document/clearance-1';

const entries = (m) => (m instanceof Map ? [...m.entries()] : null);
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
  const { verdict: signoff, ...rating } = d.verdictInfo ?? {};
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
      // The verdict record without the reviewer's sign-off, which is the review stage's and sits in `reviewer`.
      record: d.verdictInfo ? rating : null,
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
      caseLaw: { byOrdinal: entries(d.caseLawByOrdinal) ?? [], notice: d.caseLawNotice ?? '' },
      enforcerSignals: d.enforcerSignals ?? [],
      seniorRights: orNull(d.seniorRights),
      records: d.recordsByUri instanceof Map ? [...d.recordsByUri.keys()] : [],
      recordLinks: d.officeLinks ? { byUri: entries(d.officeLinks.byUri), tally: orNull(d.officeLinks.tally), summary: orNull(d.officeLinks.summary) } : null,
      logos: d.logos instanceof Map ? [...d.logos].map(([ref, l]) => [ref, l?.state ?? null]) : [],
      followUpKinds: entries(d.followUpKinds) ?? [],
      servedModels: orNull(d.served),
    },
    reviewer: {
      signoff: d.verdictInfo ? orNull(signoff) : null,
      // Each withdrawn finding with its place in the run's list, so a reader can restore the list's order.
      withdrawn: all.flatMap((f, at) => (isWithdrawn(f) ? [{ at, finding: f }] : [])),
      quarantined: d.quarantined ?? [],
      coverageJudgment: orNull(d.coverageJudgment),
      corrections: orNull(d.correctionsDoc),
      receipts: orNull(d.reviewReceipts),
      droppedConditions: d.droppedConditions ?? [],
      undispatchedProbes: d.undispatchedProbes ?? [],
      withheldFamilies: d.withheldFamilies ?? [],
      releasedFamilies: d.releasedFamilies ?? [],
      setAside: d.setAside ?? [],
      fetchState: orNull(d.fetchState),
      clientGate: orNull(d.clientGate),
      degradedParts: d.degradedRows ?? [],
      commonLawJoinedTerms: members(d.commonLawJoinedTerms),
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
