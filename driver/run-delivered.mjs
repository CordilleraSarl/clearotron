// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-delivered.mjs — how a run ends delivered: the publish, the packet, the delivered state and the archive,
// whether or not the overall assessment completed.
//
// The clearance pipeline's delivery end state, moved out of pipelineInner unchanged. It hands back the two ways a run
// delivers. `helpers` are functions still held in pipeline.mjs, handed in because this module must not import that
// one back.
import { endAnswerMemory } from "../providers/_shared/answer-memory.mjs";
import { assessmentNotCompletedNote } from "../shared/client-failure-note.mjs";
import { driverDir } from "../shared/driver-dir.mjs";
import { assertNotCancelledBeforePublish } from "./cancel.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
import { degradedParts, writeDegradedParts } from "./degraded-parts.mjs";
import { config } from "./driver.config.mjs";
import { registerAdapter } from "./engine/run-choices.mjs";   // the run's register adapter, from ctx.register
import { note, runLog } from "./log.mjs";
import { NOT_COMPLETED_DIR } from "./parts-not-completed.mjs";
import { deliveryForRun } from "./profiles.mjs";
import { finalStepFields, readRunStatus, recordTransition, rollupStatus, signoffPatch, writeRunStatus } from "./progress.mjs";
import { DEFAULT_LEDGER_PATH, tallyRegisterCalls } from "./provider-usage.mjs";
import { composeEmailHtml, coverNoteOptions, deliverySubject, publishReport } from "./publish/index.mjs";
import { noteRegisterServed, providerUsageCaveat, registersServedFrom } from "./register-served.mjs";
import { renderReportOverview } from "./report-overview-record.mjs";
import { atomicWrite } from "./run-record.mjs";
import { reportIdentityFor } from "./search-policy.mjs";
import { writeSettleStamp } from "./settle-stamp.mjs";
import { paths, whatsappRouting } from "./stages.mjs";
import { stampTokenRollup } from "./tokens.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function deliveryEndState({ P, agent, ctx, job, run }, helpers) {
  const { applyScopeFrontMatterOf, archive, assessmentCoverageOfRun, localLanguageStateOf, logTurnaroundReconciliation, reportIdentityRecord, searchLogAuditMd, sentinel, setAsideTheAssessment, writeScopeFactsOf } = helpers;
  // ── PUBLISHING AND DELIVERING: ONE PATH, FOR EVERY RUN THAT DELIVERS ─────────────────────────────────
  //
  // The run's last steps, from publishing the report to the delivered state, the packet and the archive. A run whose
  // overall assessment completed reaches them at the end of the stage sequence. A run whose assessment could not be
  // completed reaches them from deliverWithoutTheAssessment below, with no verdict: the same publish, the same packet
  // and the same terminal, so the two deliveries cannot drift apart. `verdict` is the review's sign-off word, or null.
  async function publishAndDeliver(verdict) {
    let published;
    if (existsSync(join(run.runDir, ".published"))) {
      published = JSON.parse(readFileSync(join(run.runDir, ".published"), "utf8"));
      note(`publish skip — already published → ${published.url}`);
    } else {
      // THE LAST READ OF THE STOP FLAG, and it sits HERE rather than above the branch: a run that has
      // already published has delivered, and refusing at that point would record a delivered run as
      // cancelled — the same defect pointed the other way.
      assertNotCancelledBeforePublish(run.runDir, "clearance");
      // Same fact, same moment, same words as the knockout lane: past this line a stop cannot prevent
      // delivery, and the screen is told so rather than working it out.
      writeRunStatus(ctx, { stoppable: false });
      // THE PARTS THAT FAILED AND STILL SHIP (ruling 498): read from the run as it stands now, so a failure a
      // retry or a resume recovered writes nothing, and written for the audit workbook in the shipped
      // deferral row's words. The run's record keeps each raw cause; the reader's cell never carries one.
      try {
        const localLanguage = await localLanguageStateOf(run.runDir);
        const degraded = writeDegradedParts(run.runDir, degradedParts(run.runDir, { localLanguage }));
        runLog(run.runDir, { event: "degraded-parts", parts: degraded.parts.map((d) => ({ part: d.part, cause: d.cause })) });
      } catch (e) { runLog(run.runDir, { event: "degraded-parts-failed", cause: String(e?.message ?? e).slice(0, 200) }); }
      published = await publishReport({
        runId: `${run.slug}-${run.date}-${run.codename}`, codename: run.codename,
        reportMd: P.report, auditMd: P.audit, findingsJson: P.findings, poolRoot: config.poolRoot, poolUrl: config.poolUrl,
        // WS-B/D3: the resolved account key (frozen sidecar) buckets the per-customer portal index and
        // stamps meta.json; delivery selects the render/banner variant. Both default safe for old sidecars.
        customerKey: ctx.profile?.profileKey ?? "generic", delivery: deliveryForRun(ctx),
        // Instance #6 — the source run dir whose _records/ the render reads identifiers from (records were
        // materialized into run.runDir/_records by the lint-pass assembleRunRecords). NOT the pool dir.
        runDir: run.runDir,
      });
      sentinel(run.runDir, ".published", { runId: published.runId, url: published.url, counts: published.counts,
        clientGate: published.clientGate });   // machine-QC record (observability) — decides nothing
      // WHAT THE TWO GATES EACH SAID, in the run's own log, under names that say whose they are.
      // `.published` carries `clientGate.released` beside `counts.gateViolations`, which are the verdicts
      // of DIFFERENT gates: the first is the client-export refusal (evaluateClientGate), the second is the
      // audit workbook's own build check (validateAudit), which is advisory by design and decides nothing
      // about the release. Read as one gate they contradict each other — released, with a list of
      // violations beside it — and a delivered run shipped looking exactly like that. Named separately
      // here, with the advisory COUNT and the absences the gate did not close on, so the log a person
      // reads after a run answers "what did the checks say" without opening the sentinel and knowing
      // which field belongs to which gate.
      runLog(run.runDir, { event: "publish-gates",
        clientExport: published.clientGate?.released === false ? "closed" : "released",
        clientExportReasons: published.clientGate?.reasons ?? [],
        releasedDespiteAbsentInputs: (published.clientGate?.notClosing ?? []).map((n) => n.input),
        auditWorkbookAdvisory: published.counts?.gateViolations?.length ?? 0,
        // A workbook that failed to build cannot say so itself, so its failure is recorded here. Without
        // these two fields the advisory's 0 read as a clean workbook when there was none.
        auditWorkbook: published.auditFile ? "built" : published.auditError ? "failed" : "not built",
        auditWorkbookError: published.auditError ? String(published.auditError).slice(0, 300) : null });
      note(`published → ${published.url}`);
    }
    // Lifecycle honesty (charter P1 §4): publish is CODE, not a stage() call, so nothing ever advanced the
    // displayed step past "Drafting the report" — advance it here (monotonic; the delivered terminal below
    // completes the stepper). The skip branch advances too: a resumed run with .published is equally at 8/9.
    recordTransition(ctx, "publish");
    // ONE report: the two-bit delivery (clientReady/defects) is deleted. The machine-QC result is
    // telemetry — the reviewer reads it on the audit workbook. A4: the
    // stable reason codes still ride the event, so a classifier reading the spine never hashes prose.
    if (published.clientGate && published.clientGate.released === false) {
      runLog(run.runDir, { event: "machine-qc-failed", reasons: (published.clientGate.reasons ?? []).map(String), ...(published.clientGate.reasonCodes?.length ? { reasonCodes: published.clientGate.reasonCodes } : {}),
        ...(published.clientGate.evaluationError ? { evaluationError: published.clientGate.evaluationError } : {}) });
      note(`machine QC failed (${(published.clientGate.reasons ?? []).length} check(s)) — recorded on the audit workbook; the report is delivered as usual: ${(published.clientGate.reasons ?? []).join("; ")}`);
    }
    ctx.publishedUrl = published.url;
    writeRunStatus(ctx, { url: published.url });

    // Provider-usage rollup — billing-grade per-run Corsearch call counts from the plugin chokepoint
    // ledger (every API call flows through it; all of a run's calls are done by the time we publish).
    // Best-effort: a telemetry rollup must never affect a delivered run. `duplicate_fetches[_same/cross]`
    // measures the Workstream-B dedup opportunity (and which scope matters) directly from data.
    let providerTally = null;
    try {
      const provider = registerAdapter(ctx.register).id;
      const usage = tallyRegisterCalls(DEFAULT_LEDGER_PATH, `clearance-${run.slug}-${run.codename}-`);
      // ── A WHOLE-RUN TALLY FILED UNDER ONE REGISTER SAYS SO WHEN THE RUN SERVED MORE THAN ONE ──────
      //
      // This label is resolved HERE, at publish, while the tally it labels spans the whole run. On a run
      // whose register changed part-way that key is whichever register happened to be active at publish,
      // and every call is filed under it — the confident-and-wrong shape the served field exists to end.
      //
      // The key's SHAPE is untouched because a ledger reads this map. What is added is the caveat, in the
      // same record, so the two register fields in one status cannot silently disagree: the served list
      // says two, and this says the tally covers both and could only be filed under one. Splitting the
      // tally by register is a second question and is not answered here.
      // ── THE LEDGER IS WHAT KNOWS, SO ASK IT BEFORE READING THE RECORD ───────────────────────────
      //
      // `registersServed` was written from ONE place: the adapter wrapper the record fetcher, the record
      // lister and a gated plan executor pass through. A clearance that takes counts and never fetches a
      // record went through none of them and recorded no register at all — the run could not say which
      // vendor answered it, and `registersServedFrom` returned [] for a run that had called a register
      // hundreds of times.
      //
      // Every one of those calls wrote a ledger row, and every row carries the vendor that produced it, so
      // the tally just computed already holds the answer per call. Noting them here is not a second source
      // of truth competing with the first: it is the same memoised setter, which unions and writes only on
      // change, so the eager note during the run and this reconciliation at publish cannot disagree.
      //
      // WHY NOT `activeProvider()` HERE. That resolves the register active at publish, which is the
      // confident-and-wrong answer this whole field exists to end — and on a run that changed register it
      // would name one vendor while the rows name two. The rows are per call; the resolver is per moment.
      for (const id of usage.providers) noteRegisterServed(run.runDir, id);
      const served = registersServedFrom(readRunStatus(run.runDir));
      const spans = providerUsageCaveat(served);
      runLog(run.runDir, { event: "provider-usage", provider, ...(served.length > 1 ? { spans: served } : {}), ...usage });
      writeRunStatus(ctx, { providerUsage: { [provider]: usage }, ...spans });
      providerTally = { [provider]: usage };
      // AD-4: the line prints the complete by_tool census, not a hand-picked subset — the R2 run printed
      // "search=0" while 286 execute_plan calls carried the whole register workload, and the subset read
      // as "no searches happened". An unclassified count is called out loudly: it means the KINDS list in
      // provider-usage.mjs has fallen behind a tool name again.
      const byTool = Object.entries(usage.by_tool ?? {}).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)";
      // …and the LEDGER's own state rides the same line (post-merge audit, problem 4). A missing or
      // mis-pointed call ledger used to print `total=0 ((none))` — a clean-looking measurement of a
      // measurement that never happened. `total=0` is only believable when the ledger was read.
      // The PATH is named here and only here: note() is the driver's own stderr, internal by construction,
      // while the tally itself rides status.json and the MCP tool responses (see emptyTally's ledger note).
      const led = usage.ledger ?? null;
      const ledgerNote = !led ? ""
        : !led.configured ? " ledger=NOT-CONFIGURED — the zeros above are NOT a measurement"
        : !led.present ? ` ledger=MISSING (${DEFAULT_LEDGER_PATH}) — the zeros above are NOT a measurement`
        : !led.readable ? ` ledger=UNREADABLE (${DEFAULT_LEDGER_PATH}) — the zeros above are NOT a measurement`
        : ` ledger=read ${led.rowsScanned} row(s)`;
      note(`${provider} calls: total=${usage.total} (${byTool})${usage.unclassified ? ` UNCLASSIFIED=${usage.unclassified} — a tool name the KINDS list doesn't know` : ""} retries=${usage.retries} errors=${usage.errors} dup_fetch=${usage.duplicate_fetches} [same=${usage.duplicate_fetches_same_session} cross=${usage.duplicate_fetches_cross_session}]${ledgerNote}`);
    } catch (e) {
      note(`provider-usage rollup failed (non-fatal): ${e.message}`);
    }

    // Register calls are the SECOND cost axis and may dominate the LLM one at some depths, so the ledger
    // row carries both or it cannot answer "what did this run cost us" on its own.
    recordRunConsumption(ctx, { phase: "delivered", tokens: stampTokenRollup(run.runDir, "delivered"), providerUsage: providerTally });

    // AD-4 — quoted-vs-actual turnaround. The consumption row already pairs the two figures on one line
    // (quote + wallSec); nothing ever computed the comparison, which is how "quoted 1.5h, took 5.68h"
    // stayed a forensic discovery instead of a logged fact. Unconditional: a missing quote is recorded as
    // quotedHours:null (the run was never sized), never as silence. Every OTHER terminal writes the same
    // row with its own `state` — see logTurnaroundReconciliation.
    logTurnaroundReconciliation(run.runDir, ctx.quote, "delivered");

    // C — compose the email body in CODE: a single inline-HTML fragment (the cover note — headline
    // tier, the report link, and any surviving machine-check/scope/verdict flags). The mail tool passes
    // a fully-HTML body through unchanged. The notify leaf only sends it
    // verbatim. Non-fatal: the report is already published.
    const emailNames = [...new Set([job.markName, job.name,
      ...(Array.isArray(job.marks) ? job.marks.map((m) => m?.name) : [])].filter(Boolean))];
    // — THE PRODUCT NAME, off the run's own frozen policy row, for the cover note and the subject.
    // The same resolver the report itself renders from, so the covering email and the document cannot
    // name two different products. Null on a run with no sidecar ⇒ both surfaces say nothing rather
    // than asserting one.
    const emailProductName = reportIdentityFor(ctx.searchPolicy ?? null).identity;
    // The email's options, read from the run's frozen files by the publisher's one function (coverNoteOptions), which the
    // report document carries too: the verdict record as written and the band ladder. Read from the files rather than from
    // `published`, because a resume that finds the run already published has no document. The product's name stays the one
    // the subject takes, which names a run with no frozen policy as the legacy clearance it was.
    const emailVerdictOpts = { ...coverNoteOptions(run.runDir), productName: emailProductName ?? undefined };
    // ONE report (spec 2026-07-30 §6): the cover note is a cover note — verdict, one-line summary, link.
    // A10 (addendum, 2026-07-30) NARROWS the old "machine-QC never on the email" rule rather than
    // restating it: surviving predelivery machine-check failures are enumerated on BOTH delivery
    // surfaces — the workbook Summary and this cover note — because deleted the closed-gate block
    // that used to carry them and they were left living only in a _driver sink nobody reads. What the
    // rule still forbids is the ENGINE'S OWN WORDS getting there: composeEmailHtml enumerates
    // predelivery-lint's code-owned projection (deliveryFlagLines), never the checks' raw `detail` —
    // this mail is addressed to job.forwarderEmail, which on a client-principal run is the client.
    // THE REVIEWER'S OPEN POINTS NO LONGER RIDE THE EMAIL (owner ruling, 2026-10-01). This line read them
    // out of the run record and handed them to the cover, which is how the sentence naming the independent
    // reviewer reached a client after the 2026-09-24 ruling had already taken it off the report page: the
    // section stopped being spliced into the body and started being posted to the email instead. Measured
    // on the last thirty days of production, the report carries neither the heading nor that sentence since
    // that ruling, and the email carries both. The record is still written beside the report for the
    // reviewing lawyer; nothing reads it onto a client surface.
    writeFileSync(P.emailBody, composeEmailHtml(P.report, published.url, published.auditFile, emailNames, deliveryForRun(ctx), emailVerdictOpts));
    // ctx.verdict is set BEFORE the packet is composed, because the packet's copy reads it.
    ctx.verdict = verdict;
    // DELIVERY (Phase 2). The driver writes a self-contained delivery packet and leaves
    // status.sendPending; the integrator sends off it. The report is ALREADY published by this point,
    // so nothing here can lose it. There is no second delivery mode and no send stage: what used to sit
    // behind `CLEAROTRON_DELIVERY=stage` asked a gateway agent to send the mail and a chat ping, and that
    // gateway is not part of this product.
    {
      const mark = job.markName ?? job.name ?? job.ref ?? "the matter";
      const ref = job.ref ? ` (${job.ref})` : "";
      const vtag = emailVerdictOpts.tier ? ` Overall risk: ${emailVerdictOpts.tier}.` : "";   // the rating, never the reviewer's sign-off word (ruled 2026-09-22)
      // self-contained packet (the email body HTML is embedded so the courier needs no path resolution
      // across the archive move). The courier sends EXACTLY this — same subject, text and recipient the
      // deleted send stages composed, now composed in code.
      // ONE report: the packet carries no readiness bits — every delivered run routes the same way.
      const packet = {
        // ONE canonical runId form (charter P1 §3): `<slug>-<date>-<codename>` — the same id status.json,
        // the pool and the knockout lane carry ("one format across every consumer"). The packet's runId
        // NAMES the outbox marker below, and the dateless `<slug>-<codename>` form this lane used to mint
        // is what split one delivery into TWO markers two minutes apart (the outbox rescan re-drops from
        // status.runId, saw no marker under the dated name, and minted a second one — the 2026-07-19
        // runId-form split recurring). resolveRun still accepts the dateless legacy form for historical
        // packets; the .sent orphan guard (outbox-backoff.mjs) stays as defence and matches both forms.
        runId: `${run.slug}-${run.date}-${run.codename}`, agent,
        forwarder: job.forwarder, forwarderEmail: job.forwarderEmail, msgId: job.msgId,
        conversationId: job.conversationId ?? null,   // reply-lane fallback when msgId is not a Graph id
        subject: deliverySubject(emailProductName, job),
        emailBodyHtml: readFileSync(P.emailBody, "utf8"),
        // — the notice goes to whoever ASKED, with the operator's copy beside it and a
        // stated reason when no number is held. It used to go to AGENT_WHATSAPP[agent], which is the
        // operator on every run because every user shares one agent id.
        ...whatsappRouting(job, agent),
        whatsappText: `✅ Clearotron search for ${mark}${ref} is done.${vtag} Report: ${published.url}`,
        url: published.url, verdict, markName: job.markName ?? job.name ?? null,
      };
      // A NEW send supersedes any previous one: .sent is PER-SEND idempotence, not per-run-lifetime.
      // A run that terminally failed (notice sent → .sent written) and was then resumed to success
      // would otherwise be SKIPPED by clearotron-deliver's .sent guard — the report would never send.
      // The stale failure packet goes too, so the run dir tells exactly one delivery story. B4: the
      // per-channel send receipts are per-SEND state exactly like .sent — a stale email receipt from
      // the superseded send would make clearotron-deliver skip THIS packet's email, so they reset together.
      try { rmSync(join(run.runDir, ".sent")); } catch { /* none */ }
      try { rmSync(paths(run.runDir).sendReceipts, { force: true }); } catch { /* none */ }
      try { rmSync(paths(run.runDir).failure); } catch { /* none */ }
      writeFileSync(paths(run.runDir).delivery, JSON.stringify(packet, null, 2) + "\n");
      note(`delivery: handoff → wrote _driver/delivery.json (the forwarding agent's completion-watch sends email${packet.whatsappTo ? " + WhatsApp" : ""})`);
      // Workstream B — instant delivery: drop a marker in the fixed outbox so the prelim-outbox.path unit
      // wakes the forwarder agent NOW (vs ≤55m on the HEARTBEAT completion-watch, which stays as the
      // backstop). The marker only names the agent to wake; status.sendPending + the run's .sent guard
      // remain the source of truth, so a lost/cleared marker never double-sends nor loses a delivery.
      // Best-effort — a marker-write failure must never break the run (the backstop still delivers).
      try {
        mkdirSync(config.outboxDir, { recursive: true });
        writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${agent}\n`);
        note(`delivery: outbox marker → ${join(config.outboxDir, `${packet.runId}.pending`)} (instant wake)`);
      } catch (e) {
        note(`delivery: outbox marker write skipped (${String(e.message).slice(0, 100)}) — HEARTBEAT backstop still delivers`);
      }
    }

    // Final status BEFORE archive so the renamed status.json carries the delivered state into the archive;
    // then rebuild STATUS.md (which scans the archive too).
    // spec 64 — the delivered status carries THE one risk statement too, so the run-status surface can
    // speak the same sentence as every other surface (never a bare "CLEAR" beside an index "High").
    // ONE report: the terminal state is "delivered", full stop — the delivery.{clientReady,defects}
    // second bit is deleted with the split it narrated (machine QC lives on the workbook + telemetry).
    // Lifecycle honesty (charter P1 §4): the terminal state advances the stepper — a delivered run with
    // .published + .delivered on disk must never read "7/9" on any status surface (nothing runs after
    // the packet, so no stage transition would ever finish the display sequence). finalStepFields ⇒ 9/9.
    const deliveredAt = new Date().toISOString();
    writeRunStatus(ctx, { state: "delivered", ...signoffPatch(verdict), statement: emailVerdictOpts.statement ?? undefined, caption: published.caption ?? undefined, url: published.url, deliveredAt, sendPending: true, ...finalStepFields() });
    // — THE POOL COPY LEARNS ITS OWN TERMINAL STATE, HERE AND NOWHERE ELSE.
    // `meta.json` cannot carry this: it is composed inside publish, before this line runs, so the state
    // did not exist yet when it was written. This is the one moment where the terminal state and the
    // pool directory are both in hand. Best-effort by construction — the report is already published
    // and the run is already settled, so a failure to stamp is logged and the delivery proceeds.
    const stamp = writeSettleStamp(published.poolRunDir, { state: "delivered", signoff: verdict, deliveredAt, runId: published.runId ?? run.runId, lane: "clearance" });
    if (!stamp.written) note(`delivery: settle stamp not written (${stamp.reason})`);
    endAnswerMemory(run.runDir);   // the held answers do not travel into the archive
    const archived = archive(run);
    rollupStatus(run.studioRoot);
    // `notified: "pending"` and `sendPending: true` unconditionally, which is what the KNOCKOUT lane has
    // always written one file over. They used to be three-valued because a send STAGE could report
    // success, failure or "no chat binding" here; with the packet as the only lane the integrator owns
    // the outcome, and a field that can hold exactly one value is not evidence of anything. `notifiedChat`
    // is gone for the same reason rather than pinned to false — a key that is always there and always
    // says no reads as a measurement.
    sentinel(archived ?? run.runDir, ".delivered", { verdict, url: published.url, notified: "pending", archived, sendPending: true });
    note(`=== DELIVERED (verdict ${verdict}) → ${published.url}${archived ? ` — archived → ${archived}` : ""} ===\n`);
    return { ok: true, verdict, url: published.url, runDir: archived ?? run.runDir };
  }

  // ── WHEN THE OVERALL ASSESSMENT COULD NOT BE COMPLETED, THE RUN DELIVERS WHAT IT HOLDS ──────────────────────
  //
  // Reached from the synthesis site on the pass that resumes a run whose synthesis failed once its recovery was spent:
  // the catch recorded the assessment as not completed and parked the run (parts-not-completed.mjs). The run holds
  // everything except the assessment, and delivers the same page, workbook and email, built from that:
  //   · every assessment artifact an earlier pass left is set aside, so no rejected draft and no earlier verdict can
  //     reach a surface, and the run's status drops the rating it may still carry;
  //   · the audit is the search log the run holds, without the records the assessment would have rated and without
  //     placement's set-asides, which beside no finding would read as a list of only dismissals;
  //   · the coverage rows are the register's own coverage ledger, each with its recorded status;
  //   · report.md carries the run's identity and, as its conclusion, the one sentence for this state and the shipped
  //     action line, which the page, the email and the run list all read;
  //   · the workbook's "Findings" row says the part was not completed (degraded-parts.mjs).
  // Then it publishes and delivers as every run does. A failure from here on is an ordinary failure: the record exists,
  // so the catch does not route it again, and the run ends with the stop notice.
  async function deliverWithoutTheAssessment(open) {
    note(`[assessment] the overall assessment was not completed at ${open.stage ?? "an unrecorded stage"} — delivering what the run holds, with the gap stated`);
    const setAside = setAsideTheAssessment(P, run.runDir);
    writeRunStatus(ctx, { tier: null, statement: null, ...signoffPatch(null) });
    let audit = null;
    try {
      const a = searchLogAuditMd(P);
      writeFileSync(P.audit, a.md);
      audit = a.counts;
    } catch (e) { runLog(run.runDir, { event: "audit-build-failed", reason: String(e?.message ?? e).slice(0, 160) }); }
    const coverageRows = assessmentCoverageOfRun(run.runDir);
    atomicWrite(driverDir(run.runDir, NOT_COMPLETED_DIR, "assessment-coverage.json"), JSON.stringify({ rows: coverageRows }, null, 2) + "\n");
    writeFileSync(P.report, renderReportOverview({ overall_caption: assessmentNotCompletedNote(), handling_note: null, actions: [], methodology: null },
      reportIdentityRecord(job, ctx, run.runDir, null)));
    writeScopeFactsOf(ctx, P, run.runDir);
    applyScopeFrontMatterOf(P, run.runDir);
    runLog(run.runDir, { event: "assessment-not-completed-delivery", stage: open.stage ?? null, sig: open.sig ?? null,
      setAside, coverageRows: coverageRows.length, audit });
    return await publishAndDeliver(null);
  }
  return { deliverWithoutTheAssessment, publishAndDeliver };
}
