// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/report-data.mjs — PR-9: the CLEARANCE run as data. The knockout lane has written
// report-data.json since the one-report collapse; the clearance lane's native-render branch existed in
// the portal with NO producer anywhere (B3's "the aspirational path") — this is that producer.
//
// Two readers, one file (the knockout doctrine, verbatim): the assistant drafts client-facing mail from
// it, and the portal's native-render path reads it instead of iframing baked HTML. It is the CLIENT CUT
// by construction, not by serve-time stripping:
//   • only LIVE findings (a withdrawn finding renders nowhere — it does not exist here either);
//   • no verification receipts (use_check / own_rights / bears_on — those are the reviewer's evidence
//     trail and live in the audit workbook), no withdrawn_reason, no quarantine records;
//   • no coverage_judgment (its reason renders INTERNAL-only on report.html) and no corrections
//     attestation (audit-workbook material);
//   • EVERY free-prose string goes through the existing client scrub rules — the same three transforms
//     the client HTML export applies (stripInternal client-cut → labelled-internal drop →
//     engine-internal sentence filter). A data file that quietly re-admitted internal material would
//     reopen exactly the leak the one-report collapse closed; the not-a-back-door test in
//     test/report-data.test.mjs polices this the way render-knockout's does.
//
// PURE — no IO, no config: publishReport gathers the stores and passes them in, so the producer is unit-
// testable offline and a republished archived run reproduces its file deterministically.
import { stripInternal, dropLabelledInternals, stripEngineInternals } from './parse.mjs';
import { DISPOSITION_GROUP, deriveActionConditions, projectAssessmentField } from '../findings-model.mjs';

// The client scrub choke point: the three existing rules, in the order the client HTML applies them.
// Structural values (uris, enum tokens, dates, numbers) do not route through here — they carry no prose.
const clientText = (s) => {
  if (s == null) return null;
  const out = stripEngineInternals(dropLabelledInternals(stripInternal(String(s), { client: true }))).replace(/\s+/g, ' ').trim();
  return out || null;
};

// One mark_assessment field → { text, …structured rows }: the deterministic projection PLUS the typed
// rows (both are client content — the section renders on both report variants). String input → text only.
function assessmentField(v) {
  if (v == null) return null;
  const text = clientText(projectAssessmentField(v));
  if (typeof v === 'string') return text ? { text } : null;
  const rows = (list, map) => (Array.isArray(list) && list.length ? list.map(map) : undefined);
  return {
    text,
    spectrum: clientText(v.spectrum) ?? undefined,
    per_class: rows(v.per_class, (r) => ({ class: String(r.class).trim(), note: clientText(r.note) })),
    per_market: rows(v.per_market, (r) => ({ market: clientText(r.market), note: clientText(r.note) })),
    counter_registrations: rows(v.counter_registrations, (r) => ({
      mark: clientText(r.mark) ?? undefined, uri: r.uri ?? undefined,
      owner: clientText(r.owner) ?? undefined, note: clientText(r.note) ?? undefined,
    })),
    acquired: clientText(v.acquired) ?? undefined,
    note: clientText(v.note) ?? undefined,
  };
}

/**
 * The clearance run as client-cut data. Throws on nothing it can help; the CALLER treats any throw as
 * "no data file this publish" and stamps meta.reportSchema only on success.
 */
export function clearanceReportData({
  runId, codename, matter, markName, title, customerKey, issued, url, auditFile, engineCommit = null,
  searchLevel, stageLabel, framework, verdictInfo, findings, coverage, contextNotes,
  markAssessment, fourAnswers, askAnswers, actions, jurisdiction, searchedJurisdictions, scopeBasis, caption,
} = {}) {
  const live = (Array.isArray(findings) ? findings : []).filter((f) => f && f.disposition !== 'withdrawn');
  const { conditionActions, advisoryActions } = deriveActionConditions(actions ?? [], findings ?? []);
  const action = (a) => ({
    id: a.id ?? null, kind: a.kind ?? null, text: clientText(a.text),
    ordinals: Array.isArray(a.ordinals) ? a.ordinals : [],
    deadline: a.deadline?.date ? { kind: a.deadline.kind ?? null, date: a.deadline.date } : null,
  });
  return {
    schema: 'report-data/1',
    kind: 'clearance',
    runId,
    codename: codename || null,
    matter: matter || runId,
    markName: markName || null,
    title: clientText(title),
    customerKey: customerKey || 'generic',
    issued: issued || null,
    // The engine build that produced this report — the join from a flagged finding to a diff.
    engineCommit: engineCommit || null,
    url: url || null,
    auditFile: auditFile || null,
    level: { searchLevel: searchLevel ?? null, stageLabel: stageLabel ?? null },
    framework: framework ? { key: framework.framework_key, title: framework.title, bands: framework.bands.map((b) => ({ label: b.label, tone: b.tone })) } : null,
    // The one risk statement + its derivation — the exact record every other surface joins (spec 64).
    verdict: verdictInfo ? {
      verdict: verdictInfo.verdict ?? null,
      tier: verdictInfo.tier ?? null,
      badge: verdictInfo.badge ?? null,
      band: verdictInfo.band ?? null,
      statement: clientText(verdictInfo.statement),
      conditions: (Array.isArray(verdictInfo.reasons) ? verdictInfo.reasons : []).map(clientText).filter(Boolean),
    } : null,
    caption: clientText(caption),
    jurisdiction: clientText(jurisdiction),
    scopeBasis: scopeBasis ?? null,
    searchedJurisdictions: Array.isArray(searchedJurisdictions) ? searchedJurisdictions : [],
    // The mark itself — renders on both variants, so its rows are client content.
    markAssessment: markAssessment ? {
      distinctiveness: assessmentField(markAssessment.distinctiveness),
      connotation: assessmentField(markAssessment.connotation),
    } : null,
    // P5 — the four answers as data (both variants render them; the reads are prose ⇒ scrubbed).
    fourAnswers: fourAnswers ? Object.fromEntries(Object.entries(fourAnswers)
      .filter(([, a]) => a && typeof a === 'object')
      .map(([k, a]) => [k, {
        read: clientText(a.read),
        token: a.token ?? undefined,
        basis: clientText(a.basis) ?? undefined,
        ordinals: Array.isArray(a.ordinals) && a.ordinals.length ? a.ordinals : undefined,
        obstacles: Array.isArray(a.obstacles) && a.obstacles.length
          ? a.obstacles.map((r) => ({ class: String(r.class).trim(), note: clientText(r.note) }))
          : undefined,
      }])) : null,
    findings: live.map((f) => ({
      ordinal: f.ordinal,
      mark: f.mark,
      band: f.band ?? null,
      // item 9a — the one-clause net, written once in synthesis and rendered everywhere. It is a
      // client-facing sentence by design (it is the card's lead), so it joins the whitelist explicitly
      // and routes through clientText like every other model-authored free string.
      net: clientText(f.net),
      // — `disposition` IS NOT SERVED. It is a PLACEMENT key in the engine's own spelling: stages.mjs
      // dictates it as the posture that sets only where a card is placed and never the band, and its
      // members read as claims about the owner ("adversarial") rather than about the placement. This file
      // is the client cut by construction, so a field a component author would reasonably render is a
      // field that must already be client-safe — and `group` on the next line is the SAME fact in the
      // client report's own section-heading words, derived here rather than re-derived downstream.
      // D5 took the word off the report's risk chip and off list_findings; this is the third
      // door in that wall.
      //
      // ITS ONE SERVER-SIDE READER MOVED IN THE SAME COMMIT: portal-service.mjs's feedback-flag locator
      // now reads the posture from the run's findings.json, which publish copies into the same run dir.
      // Deleting this line alone would have written null into every flag captured afterwards.
      group: DISPOSITION_GROUP[f.disposition] ?? null,
      // legacy (composite-era) records keep their scale so archived republishes stay renderable
      composite: f.composite ?? null,
      level: f.level ?? null,
      owner: {
        name: clientText(f.owner?.name),
        country: f.owner?.country ?? null,
        registrations: (f.owner?.registrations ?? []).map((r) => ({
          uri: r.uri, classes: r.classes ?? [], status: r.status ?? null,
          filed: r.filed ?? null, expiry: r.expiry ?? null, jurisdiction: r.jurisdiction ?? null,
        })),
      },
      meters: f.meters ? Object.fromEntries(Object.entries(f.meters).map(([k, m]) => [k, { token: m?.token ?? null, basis: m?.basis ?? null }])) : null,
      quadrant: f.quadrant ?? null,
      source: f.source ? { source_type: f.source.source_type ?? null, resolved_link: f.source.resolved_link ?? null } : null,
      impact: clientText(f.impact),
      // P5 — the legal/practical split + the manageable category travel as client data (their prose
      // routes through the scrub choke point like every free string).
      legal_position: clientText(f.legal_position),
      practical_position: clientText(f.practical_position),
      // — the off-field negative's declared GROUND. A closed code-owned enum, so it needs no scrub
      // (unlike every free string beside it). It travels because a consumer holding the per-member
      // positions but not the ground can render the reads and still not say why the mark was cleared —
      // which is the grouping the report leads that section with.
      off_field_ground: f.disposition === 'off-field' && f.off_field_ground ? f.off_field_ground : undefined,
      manageable: f.manageable?.category ? { category: f.manageable.category, reason: clientText(f.manageable.reason) } : null,
      deadline: f.deadline?.date ? { kind: f.deadline.kind ?? null, date: f.deadline.date } : null,
      ruled_out: f.ruled_out === true ? true : undefined,
      ruled_out_reason: f.ruled_out === true ? clientText(f.ruled_out_reason) : undefined,
    })),
    contextNotes: (Array.isArray(contextNotes) ? contextNotes : []).map((n) => ({
      type: n.type, mark: n.mark, owner: clientText(n.owner) ?? undefined, context: clientText(n.context),
    })),
    coverage: (Array.isArray(coverage) ? coverage : []).map((c) => ({
      area: clientText(c.area), state: c.state, note: clientText(c.note) ?? undefined,
    })),
    // The forward asks, partitioned as the report partitions them: conditions gate a clean result;
    // advisories never do.
    //
    // — THE THIRD COPY OF A RULE THAT WAS WRONG IN ALL THREE PLACES. This line dropped
    // filing-routine "(ordinary mechanics are not an ask) — same rule as the code-built only-you
    // section", and that cross-reference was accurate: the only-you section dropped it too, through
    // ADVISORY_TAG rather than a named filter. then wrote a watch group for "monitoring and
    // filing-routine" and neither copy was told. Owner ruling 2026-08-19: the kind renders.
    //
    // This surface is the one that matters most for it. Legacy runs are served as baked bytes, but NEW
    // runs render component-native from report-data.json — so a fix that reached only the markdown
    // renderer would have left the kind unreachable on every run from here on, while the tests around
    // the other copy went green. All four ADVISORY_KINDS travel; the partition is conditions vs
    // advisories and nothing else.
    actions: {
      conditions: conditionActions.map(action),
      advisories: advisoryActions.map(action),
    },
    askAnswers: (Array.isArray(askAnswers) ? askAnswers : []).map((a) => ({
      ask: clientText(a.ask), answer: clientText(a.answer),
    })).filter((a) => a.ask && a.answer),
  };
}
