// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/report-data.mjs — the run as data, one producer per shape: clearanceReportData writes
// `report-data/clearance-1` and knockoutReportData (at the end of this file) `report-data/knockout-1`.
// Each shape's JSON Schema is under docs/report-data/.
//
// The assistant drafts client-facing mail from it. The portal does not read it: every report the portal
// shows is the stored HTML. The Knockout's shape is a different one, `report-data/knockout-1`; the two
// schemas are under docs/report-data/.
//
// THE TWO LANES DIVERGED ON 2026-09-07 AND THIS FILE DID NOT MOVE. The owner ruled
// that the KNOCKOUT report carries the reviewer's notes, on the ground that one report is read by the
// person who ran Clearotron and holding material back confuses where data went; render-knockout.mjs
// projects them under `reviewerNotes`. That ruling was about those notes on that lane. It did not touch
// what this producer strips — withdrawn findings, verification receipts, `::p::` tails, `[internal]`
// labels and engine-internal narration are all still cut here, and the guard test still polices them.
// Do not read the knockout change as licence to relax this list; if the ruling is meant to extend, it
// extends by being asked, not by inference.
//
// It remains the CLIENT CUT by construction, not by serve-time stripping:
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
import { DISPOSITION_GROUP, deriveActionConditions, projectAssessmentField, knockoutFindingViews } from '../findings-model.mjs';
import { COUNT_BASIS, COUNT_PREDICATES, countsForMark, countLine, variantFormsLine, disclosedFloor } from '../register-count.mjs';
import { recordBasisOf, recordsForMark, recordsLine } from '../register-records.mjs';
import { registerCardViews, ownerCheckFor, ownerCheckText, ownerCheckOutcome, NOT_WEIGHED_LINE as NOT_WEIGHED } from './render-knockout.mjs';
import { clientConditions } from '../terminal-clamp.mjs';   // the reader's clause per condition — one definition, shared with the email

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
  runId, codename, matter, markName, title, customerKey, issued, url, auditFile, engineCommit = null, servedModels = null,
  searchLevel, stageLabel, framework, verdictInfo, findings, coverage, contextNotes,
  markAssessment, fourAnswers, askAnswers, actions, jurisdiction, searchedJurisdictions, scopeBasis, caption,
  assessmentNotCompleted = false,
} = {}) {
  const live = (Array.isArray(findings) ? findings : []).filter((f) => f && f.disposition !== 'withdrawn');
  const { conditionActions, advisoryActions } = deriveActionConditions(actions ?? [], findings ?? []);
  const action = (a) => ({
    id: a.id ?? null, kind: a.kind ?? null, text: clientText(a.text),
    ordinals: Array.isArray(a.ordinals) ? a.ordinals : [],
    deadline: a.deadline?.date ? { kind: a.deadline.kind ?? null, date: a.deadline.date } : null,
  });
  return {
    schema: 'report-data/clearance-1',
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
    // The models that served the run, in first-use order, as tokens.mjs servedModels names them for a
    // client: a deployment's own name never, its tier instead. null when nothing was read.
    servedModels: Array.isArray(servedModels) ? servedModels : null,
    url: url || null,
    auditFile: auditFile || null,
    level: { searchLevel: searchLevel ?? null, stageLabel: stageLabel ?? null },
    framework: framework ? { key: framework.framework_key, title: framework.title, bands: framework.bands.map((b) => ({ label: b.label, tone: b.tone })) } : null,
    // The rating + the one risk statement — the exact record every other surface joins (spec 64). Named
    // `rating` (ruled 2026-09-22): as `verdict` it read as the clearance's answer and carried the reviewer's
    // sign-off word beside the band. The sign-off stays in the review stage's own record, not the client's.
    rating: verdictInfo ? {
      tier: verdictInfo.tier ?? null,
      badge: verdictInfo.badge ?? null,
      band: verdictInfo.band ?? null,
      statement: clientText(verdictInfo.statement),
      conditions: clientConditions(verdictInfo).map(clientText).filter(Boolean),
    } : null,
    caption: clientText(caption),
    // The run's overall assessment could not be completed, so there is no rating and no finding: a stated state, never
    // read from their absence. Absent on every other run, so its data file is unchanged.
    ...(assessmentNotCompleted ? { assessment: 'not-completed' } : {}),
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
      // the framework's own inputs, where it states a method — absent otherwise, so every other run's data is unchanged
      ...(f.inputs ? { inputs: f.inputs } : {}),
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
    // filing-routine" and neither copy was told. Ruling 2026-08-19: the kind renders.
    //
    // This surface is the one an outside reader of the data takes the asks from, so a fix that reached
    // only the markdown renderer would have left the kind unreachable here, while the tests around the
    // other copy went green. All four ADVISORY_KINDS travel; the partition is conditions vs advisories and
    // nothing else.
    actions: {
      conditions: conditionActions.map(action),
      advisories: advisoryActions.map(action),
    },
    askAnswers: (Array.isArray(askAnswers) ? askAnswers : []).map((a) => ({
      ask: clientText(a.ask), answer: clientText(a.answer),
    })).filter((a) => a.ask && a.answer),
  };
}

/**
 * The KNOCKOUT run as data: report-data.json beside each name's report, in the shape
 * `report-data/knockout-1` (docs/report-data/knockout-1.schema.json). It moved here from the Knockout
 * renderer so both producers sit together; its output did not change but for that string.
 *
 * The assistant drafts a client-facing email from it (which is why the retired per-customer email template
 * does not need to come back as config: formatting is judgement, and this is the input judgement works from).
 *
 * It carries what the REPORT says, plus the level identity, and nothing internal: the audit workbook is
 * where the working notes live, and a data file that quietly re-admitted them would reopen exactly the
 * leak this series closed.
 */
export function knockoutReportData(findings, framework, { runId, codename, overall, issued, identity, registerCounts, registerRecords = null, ownerChecks = [], url, auditFile, customerKey, matter, servedModels = null }) {
  const marks = findings?.marks ?? [];
  return {
    schema: 'report-data/knockout-1',
    runId,
    codename: codename || null,
    matter: matter || runId,
    customerKey: customerKey || 'generic',
    issued: issued || null,
    url: url || null,
    auditFile: auditFile || null,
    // The models that served the run, in first-use order, as tokens.mjs servedModels names them for a
    // client: a deployment's own name never, its tier instead. null when nothing was read.
    servedModels: Array.isArray(servedModels) ? servedModels : null,
    level: {
      searchLevel: identity?.level ?? null,
      stageLabel: identity?.stageLabel ?? null,
      identity: identity?.identity ?? null,
      // `banner` is NOT projected. It is stageLabel joined to identity, so on a retired row it carries a
      // depth rung — and report-data.json is a CLIENT surface (the portal's native render and the MCP
      // brief read it). The two fields it is made of are both here already; a consumer that wants the
      // internal face takes `stageLabel`, and nothing gets a pre-joined string that leaks one.
    },
    framework: framework ? { key: framework.framework_key, title: framework.title, bands: framework.bands.map((b) => ({ label: b.label, tone: b.tone })) } : null,
    overall: overall ?? null,
    summary: findings?.batch?.executiveSummary ?? null,
    productContext: findings?.batch?.productContext ?? null,
    caveats: findings?.batch?.standardCaveats ?? [],
    marks: marks.map((m) => {
      const counted = registerCounts ? countsForMark(registerCounts, m.name) : null;
      return {
        name: m.name,
        band: m.rating ?? null,
        qualifier: m.ratingQualifier ?? null,
        // WHAT THIS NAME IS FOR. Per MARK, not per batch — a character name and a
        // franchise title can sit at different bands on identical evidence, and the manner-of-use
        // calibration in the firm-wide reasoning turns on exactly this. It reached the plan and the
        // rater and stopped there: this projection is an explicit whitelist, so a field nobody adds is
        // a field the assistant drafting client mail never sees, however faithfully the rater carried
        // it. Null on an archived run that predates the frame carrying it.
        contextFraming: m.contextFraming ?? null,
        classesSearched: m.classesSearched ?? [],
        classesDriving: m.classesDriving ?? [],
        ...(Array.isArray(m.classGroups) && m.classGroups.length ? { classGroups: m.classGroups } : {}),
        degraded: Boolean(m.degraded),
        points: m.bullets ?? [],
        // ── THE ASSESSMENT THE RUN ALREADY WROTE ──────────────────────────────────────────────────
        //
        // Seven keys the assess stage writes into knockout-findings.json reached this file as nothing.
        // They were not withheld by a rule — no code decided against them; this projection is an explicit
        // whitelist and nobody had added them, so an assistant drafting from this file could not see the
        // reasoning behind a rating it was drafting about.
        //
        // `assessment` is the sharpest case: publish substitutes it into `batch.executiveSummary` ONLY on
        // a multi-mark batch, so on a single-mark run — the common knockout — the mark's own opening read
        // was written, validated, and then dropped by both surfaces at once.
        //
        // `purpleNotes` is the reviewer's notes, and it is here by the owner's ruling of 2026-09-07: one
        // report, read by the person who ran Clearotron, because keeping material off it "just adds
        // confusion for where data is lost". They are LABELLED on the page rather than merged into the
        // client-voiced body — see reviewerNotesBlock — so a reader can tell whose voice they are in.
        assessment: (() => { const t = String(m.assessment ?? '').trim(); return t || null; })(),
        counterFactors: m.counterFactors ?? [],
        mitigation: (() => { const t = String(m.mitigation ?? '').trim(); return t || null; })(),
        // `null`, not `false`, when the rater said nothing: a crowded field is a mitigant the reasoning
        // turns on, and an unstated one must not read as a stated "no".
        crowdedField: typeof m.crowdedField === 'boolean' ? m.crowdedField : null,
        reviewerNotes: m.purpleNotes ?? [],
        // The proof-of-search rows — the same defensibility record list_searches answers from.
        negatives: (m.negatives ?? []).map((n) => ({
          term: n?.term ?? null, source: n?.source ?? null, note: n?.note ?? null,
        })),
        // The rater's read of a filing it weighed, keyed by the record id the card prints, so a consumer
        // can join a read to its filing without matching on prose.
        registerReads: (m.registerReads ?? []).map((x) => ({
          recordId: x?.recordId ?? null,
          read: x?.read ?? null,
          band: String(x?.band ?? '').trim() || null,
          // the framework's own inputs, where it states a method — absent otherwise, so every other run's data is unchanged
          ...(x?.inputs ? { inputs: x.inputs } : {}),
        })),
        // — the typed finding, ranked, with the reference the report prints. The old key was
        // `evidence[]` and it was `(m.findings ?? []).filter((f) => f?.url)`: a typed finding has no
        // `url`, so this file — the one the assistant drafts client mail from — silently carried zero
        // conflicts for a mark that had several. `shape` says which record each row came from, so a
        // reader can tell a typed run from an archived prose one without guessing at the blanks.
        findings: [
          ...knockoutFindingViews(m, { manifest: framework }).map((v) => ({
            ref: v.ref, ordinal: v.ordinal, name: v.name, owner: v.owner, band: v.band, type: v.type,
            net: v.lead, basis: v.detail, evidence: v.evidence, shape: v.shape,
            ...(v.inputs ? { inputs: v.inputs } : {}),
          })),
          // — the promoted register filings, in the SAME array, from the SAME projection the page
          // renders from (registerCardViews). Two reasons it cannot live under its own key:
          //
          //  1. THE FLAG. portal-service.mjs resolves per-finding feedback as
          //     `data.marks[markIndex].findings.find(f => f.ordinal === ordinal)`, against the
          //     `data-ko-ord` the card carries. A card in the DOM with no row here resolves NOTHING and
          //     logs `resolved:false` — the reader's correction is captured against no facts, silently.
          //  2. THE BRIEF. mcp-server/lib/brief.mjs walks this array to write "Each name screened".
          //     A promoted filing the brief omitted would be the report and the brief disagreeing about
          //     what the run found.
          //
          // `shape: 'register'` is the load-bearing field: a consumer can tell a weighed conflict from a
          // pointed-at filing without parsing prose.
          //
          // `band` AND `basis` NOW CARRY THE RATER'S READ WHEN IT SENT ONE. Before
          // this, both were constants — `band: null` and the not-weighed sentence — on every filing of
          // every run, including runs where the seat had written a full read of that exact filing and the
          // HTML card was already printing it. The page and this file disagreed, and this file is the one
          // the MCP brief answers from, so the surface a reader asks "what did you make of that
          // registration?" was the surface that had dropped the answer.
          //
          // The unmatched case is unchanged and must stay that way: no row for this recordId ⇒ `band:
          // null` and the not-weighed line, which describes the card and claims nothing.
          ...registerCardViews(m, framework, registerRecords).cards.map((v) => {
            const row = (Array.isArray(m?.registerReads) ? m.registerReads : [])
              .find((x) => String(x?.recordId ?? '').trim() && String(x?.recordId ?? '').trim() === String(v.record?.recordId ?? '').trim());
            const read = String(row?.read ?? '').trim() || null;
            const band = String(row?.band ?? '').trim() || null;
            // The driver's own record of where this filing's proprietor was looked up, joined by
            // recordId. `null` where the run owed no check — the same three states the
            // card has, so a consumer can tell "searched and found nothing" from "never searched".
            const oc = ownerCheckFor(ownerChecks, v.record?.recordId);
            return {
              ref: v.ref, ordinal: v.ordinal, name: v.record.mark, owner: v.record.owner, band,
              ...(band && row?.inputs ? { inputs: row.inputs } : {}),
              type: 'Register filing',
              net: read ? v.statement : `${v.statement} It was ${NOT_WEIGHED}.`,
              basis: read ?? NOT_WEIGHED,
              useCheckSource: ownerCheckText(ownerCheckOutcome(oc)),
              evidence: v.evidence, shape: 'register',
            };
          }),
        ],
        registerCounts: counted?.counts
          ? {
            classScope: counted.classScope ?? null,
            classes: counted.classes ?? [],
            ...Object.fromEntries(COUNT_PREDICATES.map((p) => [p.key, Number.isFinite(counted.counts[p.key]?.total) ? counted.counts[p.key].total : null])),
            // The figure stays null for a floor — a floor is never a count to be summed — and the floor
            // rides beside it, so a reader of this file has the register's own figure and not only a null.
            ...(COUNT_PREDICATES.some((p) => disclosedFloor(counted.counts[p.key]) !== null)
              ? { floors: Object.fromEntries(COUNT_PREDICATES.filter((p) => disclosedFloor(counted.counts[p.key]) !== null)
                .map((p) => [p.key, disclosedFloor(counted.counts[p.key])])) }
              : {}),
            // The close column is an aggregate, so the forms under it ride with it — a consumer that
            // got the number and not the forms could restate the figure but never explain it, and this
            // file is what the assistant drafts client mail from.
            closeVariationForms: (counted.counts.close?.forms ?? []).map((f) => f.form),
            closeVariationsLine: variantFormsLine(counted),
            line: countLine(counted),
          }
          : null,
        // part 5 — the filings behind the narrow counts, as data. The assistant drafts client mail
        // from this file, so it gets the SAME three states the report gets: rows, an answered nothing,
        // or a stated reason. `records: []` with no line beside it would be read as "no filings".
        registerFilings: (() => {
          const listed = registerRecords ? recordsForMark(registerRecords, m.name) : null;
          if (registerRecords?.unavailable) return { available: false, line: registerRecords.unavailable, records: [] };
          if (!listed) return null;
          return {
            available: true,
            line: recordsLine(listed),
            fetched: listed.fetched ?? (listed.records ?? []).length,
            capped: Boolean(listed.capped),
            // THE CAP THE RUN RECORDED, beside the flag that says it bit. `capped: true` on its own cannot
            // tell a listing truncated at fifty from one a cap of zero stopped before it began: the first
            // is a register outcome and the second is a configuration, and a consumer reading the flag
            // alone reports them the same way. The run has always written `cap` per mark; nothing read it.
            //
            // NULL IS NOT ZERO and the two are kept apart all the way out, the way the portal's allowance
            // contract keeps them. Null is a sidecar that recorded no cap at all, which is every run
            // archived before the field existed; zero is a cap that was set to zero. Folding them together
            // would put an archived run and a misconfigured one on the same line.
            cap: Number.isFinite(listed.cap) ? listed.cap : null,
            records: (listed.records ?? []).map((r) => ({
              mark: r.mark, owner: r.owner, status: r.status, classes: r.classes ?? [],
              territory: r.territory, matchedForm: r.matchedForm, matchedBasis: r.matchedBasis,
              recordId: r.recordId, url: r.url,
              // The office's page for the filing, or its office and number and why it is not a link: the
              // report's own cell, as data. Only where the run's register has no record pages of its own.
              ...(r.officeLink ? { officeRecord: { label: r.officeLink.label, href: r.officeLink.href, reason: r.officeLink.reason } } : {}),
            })),
            // Which searches did NOT answer, by name. A consumer that lists only `records` would report
            // a partial listing as a complete one. A form the cap stopped keeps its sentence; a failed
            // search's own text stays in the run's filings record, never in this file.
            unanswered: (listed.terms ?? []).filter((t) => !t.ok).map((t) => ({ form: t.term, basis: t.basis, reason: t.notAsked ? t.reason ?? null : null })),
          };
        })(),
      };
    }),
    registerCountBasis: registerCounts ? COUNT_BASIS : null,
    registerFilingsBasis: registerRecords && !registerRecords.unavailable ? recordBasisOf(registerRecords) : null,
    registerProvider: registerCounts ? (registerCounts.providerLabel ?? registerCounts.provider ?? null) : null,
  };
}
