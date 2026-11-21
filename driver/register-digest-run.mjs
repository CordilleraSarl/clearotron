// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-digest-run.mjs — every pass of the register digest: its dispatch and the blocks the driver composes for it,
// the facts its write-up is rendered from, the coverage ledger derived from its form, and the reconciliation of what was
// retrieved with what it judged.
//
// Moved out of pipeline.mjs unchanged, so that the steps import it instead of having it handed in.
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
import { deriveRegisterPositions, dominantElementComposites, isLiveRecord } from "./band-shape.mjs";
import { openChannelRows } from "./common-law-receipts.mjs";
import { armCoverageForm, coverageFormInput, coverageFormStamp, readCoverageForm, writeCoverageForm } from "./coverage-form-io.mjs";
import { buildCoverageAbsenceForm, coverageFormAbsence, coverageFormBrief, renderCoverageAbsenceSection, renderCoverageLedgerJsonFromForm, renderCoverageLedgerSection, spliceCoverageLedger } from "./coverage-form.mjs";
import { applyTaintDeferred, classTokensFromScopeText, coerceToolAbsenceDeferred, parseCoverageLedgerFull, parseCoverageLedgerJson } from "./coverage-ledger.mjs";
import { unionCoverageForm } from "./coverage-union.mjs";
import { documentCoverage, renderDocumentCoverageSection, spliceDocumentCoverage } from "./document-coverage.mjs";
import { REGISTER_PROVIDER } from "./driver.config.mjs";
import { receiptSettled, settleReceipt } from "./envelope-settle.mjs";
import { note, runLog } from "./log.mjs";
import { bandRecords } from "./named-band.mjs";
import { ownerScreenNegative } from "./owner-screen.mjs";
import { entryUris } from "./placement-carry.mjs";
import { placementRecallEndings } from "./placement-decisions.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";
import { recordTransition, writeRunStatus } from "./progress.mjs";
import { carryRecallFollowup, parseCrowdRulings, parseFindingsEndings, readOkRecordUris, RECALL_RECONCILIATION_SCHEMA_VERSION, recallReconciliationEvent, reconcileRecall, unendedSignature } from "./recall-reconciliation.mjs";
import { derivePlacementCarry, recordDigestSeam } from "./record-carry-trace.mjs";
import { bandRecordUri } from "./record-carry.mjs";
import { recordOriginsFor } from "./record-origins.mjs";
import { batchesOf, ACCOUNTING_STAMP as DIGEST_ACCOUNTING_STAMP, FACTS_FILE as DIGEST_FACTS_FILE, digestAccountingGap, digestBatchBrief } from "./register-digest-record.mjs";
import { readActiveTaintAxes } from "./register-taint.mjs";
import { assembleRunRecords, readRecordArtifacts } from "./registry-fidelity.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { abbrev } from "./repair-contract.mjs";
import { StageFailure } from "./run-outcome.mjs";
import { atomicWrite } from "./run-record.mjs";
import { inScopeClassList } from "./run-scope.mjs";
import { forceFromActive, safeReadJson, stage } from "./stage-dispatch.mjs";
import { lines, paths } from "./stages.mjs";
import { parseVariantManifestModel } from "./variant-manifest-model.mjs";
import { validators } from "./verify.mjs";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// ── WS-A: machine coverage ledger plumbing ───────────────────────────────────────────────────────────
// The coverage gates read the machine ledger when the digest saved one, else the legacy prose parse.
// Called FRESH at each gate — register-findings.md AND the JSON are rewritten by re-digests, so a
// cached read could span a rewrite. An unreadable machine ledger here is near-impossible (the file
// passed the stage validator) — fall back to prose rather than crash; the validator owns that failure.
/**
 * The relabels every coverage consumer reads rows through: a tool-absence relabelled deferred, a clean on a
 * timeout-tainted axis downgraded, and the open channels the run dictated and nobody ran. One function, so a ledger
 * read from any source is relabelled alike. IMPURE (reads the run's taint and grid receipts).
 */
export function relabelCoverageRows(runDir, rows) {   // @internal
  return [...applyTaintDeferred(coerceToolAbsenceDeferred(rows), readActiveTaintAxes(runDir)), ...openChannelRows(runDir)];
}

export function loadCoverageLedger(runDir) {   // @internal
  // Keystone (#1): every consumer reads through here, so the tool-absence→deferred relabel applies ONCE,
  // at the single choke point — the escalation-skip gate, the deadline envelope, and the U1 clamp all then
  // act on the corrected status. The relabel is a pure backstop over coverageLedger.coerceToolAbsenceDeferred
  // (a closeable could-not-reach gap must never read as an accepted saturation limit).
  // Timeout-taint (copper-lattice): the sibling relabel — a confirmed-clean row on an axis whose winning
  // pass was kill-touched (register-taint.mjs) is downgraded to deferred at the same choke point, so the
  // envelope re-runs it and the verdict floor clamps over it, whatever the prose self-reported.
  const relabel = (rows) => relabelCoverageRows(runDir, rows);
  const jsonPath = paths(runDir).registerCoverageLedger;
  if (existsSync(jsonPath)) {
    try { return { rows: relabel(parseCoverageLedgerJson(readFileSync(jsonPath, "utf8"))), source: "machine", dropped: [] }; }
    catch (e) { note(`loadCoverageLedger: machine ledger unreadable (${String(e.message).slice(0, 80)}) — prose fallback`); }
  }
  const findingsPath = paths(runDir).registerFindings;
  if (!existsSync(findingsPath)) return { rows: [], source: "none", dropped: [] };
  const { rows, dropped } = parseCoverageLedgerFull(readFileSync(findingsPath, "utf8"));
  return { rows: relabel(rows), source: "prose", dropped };
}

/** Read the owner-screen receipt back (the lint + the digest/skeptic data block read it). */
export function readOwnerScreen(P) {   // @internal
  try { return existsSync(P.ownerScreen) ? JSON.parse(readFileSync(P.ownerScreen, "utf8")) : null; }
  catch { return null; }
}
// The identity fields deriveRegisterPositions needs, from _records/ — registration/application
// numbers, the Madrid IR↔base linkage and the protocol/agreement designations, none of which a search
// row can carry. ONE builder for the two callers (the shape derivation and, when the shape's artifact
// is missing, the recall reconciliation), so the two can never disagree about what a position is.
// Measured on the real 2,596-record band: 220 ms over 35 MB. PURE-ish (reads, never writes).
export function recordDetailIndex(runDir) {
  const detailByUri = new Map();
  for (const [uri, body] of readRecordArtifacts(runDir)) {
    const basics = (Array.isArray(body?.basicRegistrationApplications) ? body.basicRegistrationApplications : [])
      .flatMap((b) => (Array.isArray(b?.basicRegistrations) ? b.basicRegistrations : []))
      .map((b) => b?.basicRegistrationNumber).filter(Boolean);
    const md0 = body?.madridDesignations;
    const designations = [...(Array.isArray(md0?.protocol) ? md0.protocol : []), ...(Array.isArray(md0?.agreement) ? md0.agreement : [])];
    detailByUri.set(uri, {
      registrationNumber: body?.registrationNumber ?? null,
      applicationNumber: body?.applicationNumber ?? null,
      basicRegistrationNumbers: basics,
      madridDesignations: designations,
    });
  }
  return detailByUri;
}
// The MIRROR-quarantine predicate: which coverage failures mean "the findings are good and only the
// machine ledger is bad", so the run may proceed on the rows it has with the mirror quarantined.
//
// — NARROWED FROM `coverage_` TO THE STRUCTURE FAMILY, and the width was already wrong. A bare
// `coverage_` prefix swept in every `coverage_clean_*` judgment token too: a refused CLEAN CLAIM deleted
// the machine ledger and stamped `machineLedgerNote` saying "coverage gates read the prose table for
// this run" — a sentence about a defect that was never the mirror's. It survived only because the
// re-validate underneath it re-failed, so the synthetic ok never fired. With the coverage FORM the same
// width would be live: `coverage_no_status` names a judgment the seat has not made, and quarantining a
// derived artifact cannot make that true. The form tokens are deliberately OUT — a refused judgment
// fails the stage and rides the corrective ladder, which is the only thing that can fix it.
const isCoverageLedgerFail = (fail) => /invalid_file:.*?:coverage_(ledger|axis|key|mirror|status|classes)_/.test(fail ?? "");

// ── — THE COVERAGE LEDGER IS PUBLISHED FROM THE FORM, IN BOTH SHAPES ───────────────────────────
//
// Map #3 code-derived register-coverage-ledger.json FROM the model's prose `## Coverage ledger` table,
// which made a model-authored document the source of truth for every coverage gate downstream. The
// direction is INVERTED here: the driver-written form is the source, and BOTH the prose table and the
// JSON are renders of it. They agree by construction and neither can be the thing that drifts, which is
// the same argument Map #3 made one level down — applied to the artifact that was still authored.
//
// Called after every digest pass that ended ok, on the same seam deriveCoverageLedgerJson always ran.
// NEVER-KILL: any defect logs a note, drops a stale JSON and leaves the run to deliver on whatever the
// findings carry. The table is the rendered surface; the JSON is the gates' optimization.
function renderCoverageLedgerFromForm(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerFindings)) return;
  const stamp = coverageFormStamp(P.runDir);
  if (!stamp.required) return;
  const cf = readCoverageForm(P.runDir, stamp.formName);
  // M6 — A DECLARED ABSENCE IS RENDERED, NOT SKIPPED. Returning early here on a zero-row form would
  // leave the report with no `## Coverage ledger` section at all, and a reader cannot tell a missing
  // section from a run that swept everything and had nothing to say. The declaration names the cause and
  // states, in the lawyer's own section, that no coverage claim is made anywhere in the report.
  const absence = cf.rows && !cf.rows.length ? coverageFormAbsence(cf.parsed) : null;
  if (!absence && !cf.rows?.length) return;
  try {
    const section = absence ? renderCoverageAbsenceSection(absence) : renderCoverageLedgerSection(cf.rows);
    if (!section) return;
    // Idempotent: spliceCoverageLedger REPLACES a section already there, so re-rendering on a later pass
    // updates the table rather than appending a second one.
    atomicWrite(P.registerFindings, spliceCoverageLedger(readFileSync(P.registerFindings, "utf8"), section));
    runLog(P.runDir, { event: absence ? "coverage-absence-rendered" : "coverage-ledger-rendered", trigger, rows: cf.rows.length, ...(absence ? { cause: absence.cause } : {}) });
  } catch (e) {
    note(`runDigest: coverage-ledger render failed (${String(e.message).slice(0, 100)}) — the findings ship without the driver-rendered table`);
    runLog(P.runDir, { event: "coverage-ledger-render-failed", trigger, reason: String(e.message).slice(0, 120) });
  }
}

// ── — THE DOCUMENT-COVERAGE SENTENCE, RENDERED FROM THE RUN'S OWN RECORDS ─────────────────────
//
// The narrative seat is now told to say nothing about whether registry documents were obtained (see the
// block in stages.mjs). That prohibition alone would leave a run that genuinely fetched nothing with
// a report silent on the point, which reads as one where the wording WAS read — so the sentence has to be
// written, measured, by the only thing that can see the lane.
//
// Beside the coverage ledger and in the same document, because it is the same kind of statement: what this
// run's search actually rests on. Idempotent (spliceDocumentCoverage REPLACES), best-effort, and it never
// renders an empty section — a heading with nothing under it asserts an absence it cannot explain.
function renderDocumentCoverageFromRecords(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerFindings)) return;
  try {
    // The set the GATES consume, not `_records/` alone: a run whose bodies live only in the ledger would
    // otherwise be described as one that fetched nothing — the defect this renders against, re-created by
    // reading a narrower artifact than the one that holds the answer.
    const { records } = assembleRunRecords(P.runDir, `clearance-${ctx.run.slug}-${ctx.run.codename}-`);
    const summary = documentCoverage({ records, findings: safeReadJson(P.findings) });
    const section = renderDocumentCoverageSection(summary);
    if (!section) return;
    atomicWrite(P.registerFindings, spliceDocumentCoverage(readFileSync(P.registerFindings, "utf8"), section));
    runLog(P.runDir, { event: "document-coverage-rendered", trigger, ...summary });
  } catch (e) {
    note(`runDigest: document-coverage render failed (${String(e.message).slice(0, 100)}) — the findings ship without the driver-rendered section`);
    runLog(P.runDir, { event: "document-coverage-render-failed", trigger, reason: String(e.message).slice(0, 120) });
  }
}

// ── CONVERSION 11 — THE FACTS THE DIGEST'S RENDER IS COMPOSED FROM ────────────────────────────────
//
// Written before the digest dispatches, beside the coverage form and inside the same `willRun` gate, so
// the two artifacts the stage now depends on are armed by ONE condition and cannot disagree about which
// era the run is in.
//
// IT IS THE DRIVER'S, AND THAT IS THE POINT. `record_register_digest` takes no record field — no Mark,
// no Owner, no Classes, no count — and this sidecar is why it does not have to: everything the render
// needs is here, keyed by the uri the seat cites. The report-overview precedent, for the reason its own
// comment gives: facts that arrive as an option the driver writes cannot come back in as parameters the
// seat sets, which is what stops thirteen mechanical elements returning through the tool.
//
// NON-FATAL, and the failure direction is deliberate. A miss leaves no sidecar; `readDigestFacts`
// returns empty facts; every seat-sent uri then refuses by name (`registerdigest_uri_unknown`) on the
// first call. So a driver fault surfaces as a loud refusal on call 1 rather than as a document of blank
// identifier cells — the same fail-closed direction the coverage form's write order takes.
export function writeRegisterDigestFacts(ctx, trigger) {   // @internal
  const P = ctx.paths;
  try {
    const records = existsSync(P.registerNamedBand)
      ? bandRecords(JSON.parse(readFileSync(P.registerNamedBand, "utf8"))) : [];
    // The SLIM index — the ten fields the render reads, never the whole record. A band is measured in
    // megabytes and this file is read on every call.
    const slim = [];
    for (const r of records) {
      const uri = r?.record_id ?? r?.uri ?? r?.screen?.uri;
      if (!uri) continue;
      slim.push({
        record_id: uri, mark_text: r.mark_text ?? null, owner_name: r.owner_name ?? null,
        owner_country: r.owner_country ?? r?.screen?.owner_country ?? null,
        classes: r.classes ?? null, status: r.status ?? r?.screen?.status ?? null,
        application_date: r.application_date ?? r?.screen?.application_date ?? null,
        registration_date: r.registration_date ?? null, expiry_date: r.expiry_date ?? null,
        jurisdictions: r.jurisdictions ?? null,
        screen: { screen_verdict: r?.screen?.screen_verdict ?? r?.screen_verdict ?? null },
      });
    }
    let readIds = [];
    try { readIds = [...readOkRecordUris(readFileSync(P.readingLog, "utf8"))]; } catch { readIds = []; }

    // THE OWED SET: the records of the entries placement carried into this stage that the write-up must end, the
    // population the refusal judges. `record-carry.mjs` judges the seam against every placed record, and an adopted
    // entry is carried by its row.
    // ── AN ABSENT FILE IS THE ONLY BENIGN WAY TO HAVE NO OWED SET ────────────────────────────────
    //
    // This was one bare `catch {}` around the whole block, and it hid a `ReferenceError`: `entryUris`
    // was called here and imported nowhere, so the loop threw on EVERY run, `owed` stayed empty, the
    // stamp was never written and the accounting rule never armed anywhere — the precise fail-open this
    // transport's header defends against, arriving through a swallowed crash instead of through the
    // write order. Green everywhere, because nothing drove this writer. Found on a replay rig, not by a
    // test, 2026-08-27.
    //
    // So the two states are now separated. NO FILE is a real answer: this run has no structured
    // placements, there is no population to hold the seat to, and not arming is correct. A file that IS
    // present and cannot be turned into an owed set is a DRIVER DEFECT, and it arms with `owed: null` —
    // which the transport already refuses by name as a driver fault rather than a model one. Never
    // silently empty: "the driver told me none" and "the driver could not tell me" are different facts
    // and only the first may be checked against.
    //
    // WHAT THE WRITE-UP OWES IS PLACEMENT'S HEADLINE ENTRIES, judged per entry: a row naming any record of an entry ends
    // the whole entry. A sheet-2 entry is adopted as placed (`adopt`): the render writes its row on the entry's first
    // live record, else its first, with placement's reason, unless the write-up overrides it with any row naming any of
    // its records. A watchlist-annex entry is adopted the same way (`watch`), into the watchlist annex: the write-up's
    // render has no other table for it, so without that row it reached no surface and its ending was nobody's. Out-of-scope
    // entries owe nothing. An entry with no records owes nothing and gets no row.
    const owed = [];
    const owedEntries = [];
    const adopt = [];
    const watch = [];
    let owedFailed = null;
    if (existsSync(P.placementModel)) {
      try {
        const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
        const live = new Map(records.map((r) => [bandRecordUri(r).toLowerCase(), isLiveRecord(r)]));
        for (const e of Array.isArray(placements) ? placements : []) {
          const uris = entryUris(e);
          if (!uris.length) continue;
          if (e?.tier === "headline-candidate") { owedEntries.push({ uris }); owed.push(...uris); }
          else if (e?.tier === "sheet-2" || e?.tier === "watchlist-annex")
            (e.tier === "sheet-2" ? adopt : watch).push({ uri: uris.find((u) => live.get(u) === true) ?? uris[0], uris, reason: String(e?.reason ?? "") });
        }
      } catch (e) { owedFailed = String(e?.message ?? e).slice(0, 160); }
    }

    const facts = {
      schema_version: 1,
      owed: owedFailed ? null : [...new Set(owed)],
      ...(owedFailed ? {} : { owed_entries: owedEntries, adopt, watch }),
      identity: {
        mark: ctx.job?.markName ?? ctx.run?.slug ?? null,
        date: ctx.job?.filedDate ?? ctx.run?.startedAt?.slice?.(0, 10) ?? null,
        provider: (ctx.register ?? REGISTER_PROVIDER) ?? null,
      },
      recordHost: recordOriginsFor(ctx.register ?? REGISTER_PROVIDER)?.[0] ?? "",
      counts: digestSummaryCounts(ctx, slim.length),
      auditRows: digestAuditRows(ctx),
      readIds,
      records: slim,
    };
    ensureDriverDir(P.runDir);   // — one creator for `_driver/`, never a bare mkdir
    // ── THE STAMP LANDS BEFORE THE FACTS, AND THE ORDER IS THE FAIL-CLOSED LEG ────────────────────
    //
    // `armCoverageForm`'s rule, one artifact over: stamp first, artifact second. If the facts write
    // fails after the stamp lands, the seat reaches a run stamped for accounting with no owed list, and
    // the transport refuses that BY NAME as a driver fault. Stamp second would mean a failed facts write
    // silently disarms the rule — the fail-open the 1955 design named as the arm most likely to be got
    // wrong, and a rule that disarms itself on a disk error is worse than none because it reads as one.
    //
    // NOT STAMPED when the run has no structured placements: there is then no owed population to hold
    // the seat to, and arming over an empty list would refuse nothing while looking like a gate.
    // ARMED ON A FAILED OWED BUILD TOO. Not arming there would be the fail-open again by a shorter
    // route: the rule would switch itself off on exactly the runs whose owed set the driver got wrong.
    // Armed with `owed: null`, the transport refuses BY NAME as a driver fault on the first call.
    const armed = owed.length > 0 || owedFailed !== null;
    if (armed) atomicWrite(driverDir(P.runDir, DIGEST_ACCOUNTING_STAMP), JSON.stringify({ ts: new Date().toISOString(), owed: owedFailed ? null : owed.length, owed_failed: owedFailed }, null, 2) + "\n");
    atomicWrite(driverDir(P.runDir, DIGEST_FACTS_FILE), JSON.stringify(facts, null, 2) + "\n");
    if (owedFailed) note(`register-digest: placements.json is present and the owed set could not be built from it (${owedFailed}) — arming the accounting rule with no owed list, so the digest's first call refuses by name as a driver fault`);
    runLog(P.runDir, { event: "register-digest-facts-written", trigger, records: slim.length, readIds: readIds.length, owed: owedFailed ? null : owed.length, owed_failed: owedFailed, accounting_armed: armed });
  } catch (e) {
    note(`register-digest facts write failed (${String(e.message).slice(0, 100)}) — the digest's first call will refuse by name rather than render blank identifier cells`);
    runLog(P.runDir, { event: "register-digest-facts-failed", trigger, reason: String(e.message).slice(0, 120) });
  }
}

/** The `## Summary` counts, from the driver's own receipts. Every entry is [label, value]. */
function digestSummaryCounts(ctx, enumerated) {
  const P = ctx.paths;
  const out = [];
  const exec = safeReadJson(paths(P.runDir).planExecution);
  const entries = Array.isArray(exec?.skeleton) ? exec.skeleton : [];
  // ── NO TOOL NAME IS SPELLED HERE, AND THAT IS A CONSTRAINT RATHER THAN A STYLE CHOICE ────────────
  //
  // The first cut classified calls with `/fetch|record/i` vs `/search|enumerate|screen/i` to render a
  // "search + detail-fetch" split. Two source guards refused it, both correctly: `register-steering`
  // requires pipeline.mjs to reach the enumerate tool only through REGISTER_ENUMERATE_TOOL, and
  // `register-advertisement-vs-grant` reads a tool name in the driver's own text as the driver ORDERING
  // that tool — which made this file advertise `register_batch_screen` to a provider (signa) that does
  // not serve it. A hardcoded tool list here is a second register of tool names in the one file those
  // guards police.
  //
  // So the split goes and the honest counts stay. `tool-calls.jsonl` writes one line per call, which is
  // a total the driver can state without knowing what any of them was called; the records READ come from
  // the reading audit, which is already the driver's own list. That loses the search-vs-fetch breakdown,
  // and losing it is the right trade: the regex was guessing at a distinction the log does not record,
  // and a guessed number in a client-facing document is worse than a true one that says less.
  // ── NO LIVE COUNTER GOES IN THIS DOCUMENT, AND THE TOOL-CALL TOTAL WAS ONE ───────────────────────
  //
  // `tool calls recorded this run` was rendered here from `tool-calls.jsonl`'s line count, which GROWS
  // for as long as the run does. That put a moving number inside an artifact four other stages declare
  // as an input and hash for freshness — so every digest pass rendered a different document even when
  // the seat's values were byte-identical, every downstream stage went stale on it, and delivery
  // refused with "assembled from material that has since changed". Measured on the non-split closure
  // resume: two renders of the same findings, 28 calls and then 56, 108 bytes apart.
  //
  // THE RULE, since the next driver-derived fact will be tempting in the same way: a value rendered into
  // this document must be a fact about the FINDINGS, settled when they were. `enumerated records` is the
  // frozen band's size and `plan entries executed` counts the frozen plan's skeleton — both settle
  // before the digest runs and neither moves afterwards. A telemetry total is a fact about the RUN, it
  // belongs in the run log where it already is, and it means nothing to the lawyer reading this page.
  out.push(["enumerated records", enumerated]);
  out.push(["plan entries executed", entries.length]);
  return out;
}

/** The `### Audit trail` rows — per-unit search / detail-fetch counts with the driver's `_query` stamp. */
function digestAuditRows(ctx) {
  const P = ctx.paths;
  const exec = safeReadJson(paths(P.runDir).planExecution);
  const rows = [];
  for (const e of Array.isArray(exec?.skeleton) ? exec.skeleton : []) {
    rows.push({ unit: e?.axis ?? e?.qid ?? "—", searches: e?.searches ?? e?.pages ?? 0,
      detail_fetches: e?.detail_fetches ?? 0, query: e?.qid ?? "" });
  }
  return rows;
}

// Map #3 — the coverage-ledger JSON is now CODE-DERIVED from the validated prose (deriveCoverageLedgerJson
// below, called in runDigest after every digest pass), never authored by the model. The old save-MANDATE
// instruction (re-save your JSON mirror) is retired: there is nothing for the worker to save, and the JSON
// is consistent with the prose BY CONSTRUCTION, which kills the mirror-desync class the cross-check existed
// to catch.

function deriveCoverageLedgerJson(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerFindings)) return;
  renderCoverageLedgerFromForm(ctx, trigger);
  renderDocumentCoverageFromRecords(ctx, trigger);   // — the sentence the seat may no longer write
  const stamp = coverageFormStamp(P.runDir);
  const cf = stamp.required ? readCoverageForm(P.runDir, stamp.formName) : { rows: null };
  if (!cf.rows?.length) return;      // no form ⇒ nothing to derive; the gates read what the run carries
  try {
    const json = renderCoverageLedgerJsonFromForm(cf.rows, classTokensFromScopeText);
    // RE-VALIDATE the derived JSON against the STRICT contract BEFORE it lands (VELTRIPHEN 2026-06-19).
    // Kept unchanged under even though the form's axes are already canonical: on a defect DON'T land
    // it — a bad JSON would throw at EVERY loadCoverageLedger read, silently degrading every gate for the
    // whole run. Drop any stale JSON instead, so the fallback is explicit and the report flags the gap.
    parseCoverageLedgerJson(json);
    const tmp = P.registerCoverageLedger + ".tmp";
    writeFileSync(tmp, json);
    renameSync(tmp, P.registerCoverageLedger);
    runLog(P.runDir, { event: "coverage-ledger-derived", trigger });
  } catch (e) {
    // Prose unparseable (render threw) OR the derived JSON failed strict re-validate. Drop any stale JSON so
    // loadCoverageLedger falls back to prose cleanly (no throw at read), record the gap, and surface it on the report.
    try { rmSync(P.registerCoverageLedger, { force: true }); } catch { /* absent is fine */ }
    note(`runDigest: coverage-ledger derivation/validate failed (${String(e.message).slice(0, 100)}) — prose fallback`);
    runLog(P.runDir, { event: "coverage-ledger-fallback", trigger, reason: `derive_failed:${String(e.message).slice(0, 80)}` });
    ctx.machineLedgerNote = ctx.machineLedgerNote || `coverage machine-ledger unavailable (${abbrev(String(e.message), 60)}) — gates ran on the prose table`;
  }
}


// Snapshot the JSON to _history (audit) then delete it, ahead of a digest pass that will re-run.
// NEVER restored: a stale ledger over rewritten prose would corrupt every later gate on exactly the
// escalated/late-bound runs (the verified WS-A blocker); absence just means the gates fall back to
// prose until re-saved. Returns whether a file was actually dropped.
function dropStaleCoverageLedger(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerCoverageLedger)) return false;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(P.runDir, "_history", `${ts}-coverage-ledger-${trigger}`);
    mkdirSync(dest, { recursive: true });
    copyFileSync(P.registerCoverageLedger, join(dest, basename(P.registerCoverageLedger)));
  } catch { /* snapshot is best-effort */ }
  try { rmSync(P.registerCoverageLedger, { force: true }); } catch { /* best-effort */ }
  runLog(P.runDir, { event: "coverage-ledger-dropped", trigger });
  return true;
}

// Terminal ladder, invalid side (the machine contract never kills a run). The
// registerFindings validator checks prose FIRST, so a coverage_* reason means the findings are good
// and only the JSON mirror is bad after the corrective/warm retries — quarantine it (rename keeps it
// inspectable) and let the run proceed on the prose path with the machine_ledger_note delivery flag.
function quarantineCoverageLedger(ctx, failReason, trigger) {
  const P = ctx.paths;
  try {
    if (existsSync(P.registerCoverageLedger))
      renameSync(P.registerCoverageLedger, P.registerCoverageLedger.replace(/\.json$/, ".invalid.json"));
  } catch { /* best-effort */ }
  // The live file MUST be gone even if the rename failed (EBUSY/EACCES): otherwise the re-validate
  // re-fails on the same JSON and must() kills the run — the never-kill contract dies. No-op after
  // a successful rename.
  try { rmSync(P.registerCoverageLedger, { force: true }); } catch { /* best-effort */ }
  ctx.machineLedgerNote = `machine coverage ledger failed validation after corrective retries (${abbrev(String(failReason), 120)}) — quarantined; coverage gates read the prose table for this run`;
  writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });   // survives a crash-resume
  runLog(P.runDir, { event: "coverage-ledger-quarantined", trigger, reason: String(failReason).slice(0, 160) });
}

// ── — THE SAVE-ONLY FOLLOWUP IS GONE, BECAUSE NOTHING ASKS THE MODEL TO SAVE ANYTHING ─────────
//
// `ensureCoverageLedgerSaved` dispatched a followup that DICTATED the machine ledger's JSON schema
// by hand — "a JSON ARRAY, one object per prose Coverage-ledger table row, keys EXACTLY {axis, scope,
// status, reason}…" — a fourth copy of a contract that lives in coverage-ledger.parseCoverageLedgerJson.
// The artifact it asked for is now derived by the driver from the coverage form, so a missing JSON can
// only mean the DERIVE failed; asking a model to hand-write it would be asking it to fix a driver
// defect with a transcription, which is the whole shape removes. The never-kill contract is
// unchanged and is carried by the note below: a run whose JSON did not land delivers on the coverage
// rows the form carries, with the gap flagged on the report.
function noteCoverageLedgerAbsent(ctx, trigger) {
  const P = ctx.paths;
  if (!ctx.machineLedgerNote) {
    ctx.machineLedgerNote = "machine coverage ledger was not derived from the coverage form — coverage gates read the run's own rows for this run";
    writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });   // survives a crash-resume
  }
  runLog(P.runDir, { event: "coverage-ledger-fallback", trigger, reason: "derive_absent" });
}

// ── P2-A (the recall spine) — the retrieved→judgment RECONCILIATION ─────────────────────────────────
// Computed after EVERY digest pass (fresh, escalation, envelope, flush, AND idempotency
// skips — a resume must never sail past the gate): every live, in-scope, screen-surfaced record
// carrying the dominant element must END somewhere a reader can see — a finding row, a URI-citing
// Negative-results drop row, or membership of the explicitly ruled, COUNTED dominant-element crowd
// (a Coverage-ledger row). The code-ranked top slice must end individually. The evidence run's
// proven loss class: retrieved, screened surface:in-scope-live (a live US registration among them),
// then zero mentions on any judgment surface — all three kill seams (band→digest, round N→N+1
// rewrite, grid-candidate→judgment) die before the record first becomes text an existing gate can
// parse. This join IS that text, derived by code from the band, so nothing can die before it.
//
// Artifact: _driver/recall-reconciliation.json (the gate-visible discrepancy list; crowd memberships
// counted on the delivered surface, enumerated only here). Event: `recall-reconciliation` on every
// derivation — unended:0 is ASSERTED, never absent. Enforcement: unended ⇒ ONE followup on the
// winning digest session dictating the three ending forms (at most RECALL_FOLLOWUP_MAX attempts per
// unended-set signature, so a park/resume gets a fresh attempt without ever looping); what remains
// unended after that ships NAMED from the pre-verdict floor, through the terminal guards' deliver-and-clamp (the
// owner's ruling of 2026-10-19 that a run is never held), never a silent ship.
const RECALL_FOLLOWUP_MAX = 2;

// amendment 2 — the follow-up bound is a DEPTH ROW (2 / 1 / 1), not a constant. The constant stays
// as the one-country value and as the fallback, and the fallback direction is the whole point: a run whose
// depth is missing, malformed or from a product this build does not grade must get TODAY'S attempts, never
// fewer. Failing the other way would quietly shorten a recall check on exactly the runs we understand
// least. The ladder may only ever REDUCE this — that invariant is asserted per product in
// depth-ladder-table.test.mjs rather than clamped here, so an over-large row reds instead of being
// silently trimmed to something nobody asked for.
export const recallFollowupMaxFor = (ctx) => {   // @internal
  const n = ctx?.depth?.recallFollowupMax;
  return Number.isInteger(n) && n > 0 ? n : RECALL_FOLLOWUP_MAX;
};

function deriveRecallReconciliation(ctx, trigger) {
  const P = ctx.paths;
  const writeArtifact = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      // ROUND-2 FIX (review problem 5) — the followup RECEIPT survives the re-derive. This write is a
      // full replace and its payload has no `followup` key, so the very next read of it (the attempt
      // counter in enforceRecallReconciliation) always saw null: `attempts` was pinned at 0 and
      // RECALL_FOLLOWUP_MAX could never engage — every digest pass, including every skip-resume,
      // bought another full warm digest turn over the whole band while unended > 0. Carrying the key
      // forward here (not at the call site) covers all three callers of deriveRecallReconciliation.
      const carried = carryRecallFollowup(safeReadJson(P.recallReconciliation), artifact);
      atomicWrite(P.recallReconciliation, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact, ...carried }, null, 2) + "\n");
    } catch (e) { note(`recall-reconciliation artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  try {
    const notComputable = (reason) => {
      writeArtifact({ schema_version: RECALL_RECONCILIATION_SCHEMA_VERSION, computable: false, reason });
      // AD-4 house rule (review problem 8) — ONE row builder for both branches, every field written
      // unconditionally: "the gate found nothing unended" (unended:0) and "the gate could not run"
      // (unended:null) must be distinguishable by VALUE, never by field presence.
      runLog(P.runDir, recallReconciliationEvent({ trigger, reason }));
      return null;
    };
    if (!existsSync(P.registerNamedBand)) return notComputable("no merged register band");
    if (!existsSync(P.registerFindings)) return notComputable("no register findings file");
    let dominantElement = null;
    try { dominantElement = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")).dominant_element; }
    catch { /* prose-only manifest */ }
    if (!dominantElement) return notComputable("no structured dominant element (prose-only manifest)");
    let inScopeClasses = [];
    try { inScopeClasses = inScopeClassList(ctx.job, ctx.profile).map(String); }
    catch { inScopeClasses = (ctx.job?.classes ?? []).map(String); }
    const band = JSON.parse(readFileSync(P.registerNamedBand, "utf8"));
    const candidates = dominantElementComposites(band, { dominantElement, inScopeClasses });
    if (candidates === null) return notComputable("dominant element yields no comparable Latin skeleton");
    const endings = parseFindingsEndings(readFileSync(P.registerFindings, "utf8"));
    const crowdRulings = parseCrowdRulings(loadCoverageLedger(P.runDir).rows);
    // ROUND-2 FIX (review problem 2) — the join's unit is the POSITION, and the positions are the
    // SAME artifact the digest was told to write its Sheet-1 rows from (_driver/register-positions.json,
    // derived in deriveBandShape). One source of truth: the digest cites any one constituent URI, the
    // gate credits any one constituent URI, and the residual count both sides use is the same number.
    //
    // There is NO record-unit fallback, deliberately. Falling back to "every candidate is its own
    // position" is exactly the behaviour whose compliant-digest outcome is unended:1 — it would
    // reinstate the blocker this fix removed, at the seam where nobody would look (the shape's
    // positions write is best-effort inside a best-effort). So: read the artifact; if it is missing,
    // RE-DERIVE it here from the band + _records through the same builder; and only if that also
    // fails is the join NOT COMPUTABLE. A gate that cannot see positions does not get to judge
    // positions as records — and not-computable never blocks (fail-open, the legacy/replay path).
    let positions = safeReadJson(P.registerPositions)?.positions ?? null;
    if (!positions) {
      try {
        positions = deriveRegisterPositions(band?.enumerated ?? [], recordDetailIndex(P.runDir)).positions;
        runLog(P.runDir, { event: "recall-reconciliation-positions-rederived", trigger, positions: positions.length });
      } catch (e) {
        runLog(P.runDir, { event: "recall-reconciliation-positions-failed", trigger, fail: String(e?.message ?? e).slice(0, 160) });
        positions = null;
      }
    }
    if (!positions) return notComputable("no exact-identity positions projection — the join's unit is the POSITION and record-unit would block a compliant one-URI position row");
    const placement = placementRecallEndings(P, candidates.map((c) => c.record_id));
    const artifact = reconcileRecall({ candidates, endings, crowdRulings, positions, dominantElement, inScopeClasses, placement });
    writeArtifact(artifact);
    runLog(P.runDir, recallReconciliationEvent({ trigger, artifact }));
    if (artifact.totals.unended) note(`recall-reconciliation: ${artifact.totals.unended} screened-live dominant-element position(s) end NOWHERE (${artifact.totals.candidates} candidate record(s) in ${artifact.totals.positions} position(s); crowd declares ${artifact.crowd.declared} vs residual ${artifact.crowd.residual})`);
    return artifact;
  } catch (e) {
    // never-kill at the derive seam — the pre-verdict floor still reads the last good artifact.
    runLog(P.runDir, { event: "recall-reconciliation-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`recall-reconciliation derivation failed (non-fatal here; the pre-verdict floor reads the artifact): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

async function enforceRecallReconciliation(ctx, r, trigger) {
  const P = ctx.paths;
  let artifact = deriveRecallReconciliation(ctx, trigger);
  if (!artifact?.computable || !artifact.totals.unended) return;
  // one followup per unended-set signature, bounded across resumes (RECALL_FOLLOWUP_MAX):
  // the receipt rides the artifact file itself, so a crash between followup and re-derive re-arms
  // at most one extra attempt — bounded either way by the recovery ladder's identical-signature stop.
  // The receipt now SURVIVES the re-derive (carryRecallFollowup inside writeArtifact) — before that
  // fix this read always found null and the bound never engaged (review problem 5).
  const sig = unendedSignature(artifact);
  const prior = safeReadJson(P.recallReconciliation)?.followup ?? null;
  const attempts = prior && prior.sig === sig ? (prior.attempts ?? 0) : 0;
  const followupMax = recallFollowupMaxFor(ctx);
  if (!r?.sessionKey || attempts >= followupMax) {
    if (attempts >= followupMax) {
      runLog(P.runDir, { event: "recall-reconciliation-followup-exhausted", trigger, attempts, max: followupMax, unended: artifact.totals.unended });
      note(`recall-reconciliation: ${artifact.totals.unended} unended position(s) with the followup budget spent (${attempts}/${followupMax} on this signature) — the pre-verdict floor owns it from here`);
    }
    return;
  }
  note(`recall-reconciliation: ${artifact.totals.unended} unended position(s) — warm followup ${attempts + 1}/${followupMax} on the digest session`);
  // The crowd row rides the record_coverage TOOL when this run has a form (typed transport) — the
  // driver re-renders both the `## Coverage ledger` table and its JSON mirror from what the tool
  // records, so a hand-written table row is overwritten before deriveRecallReconciliation re-reads the
  // rulings. Same era stamp the dispatch brief keys on, so the followup can never disagree with it.
  const rrStamp = coverageFormStamp(P.runDir);
  const followup = repairFollowup("register-digest:recall-reconcile", {
    artifact,
    registerFindingsPath: P.registerFindings,
    hasCoverageForm: rrStamp.required,
  });
  const rr = await stage("register-digest", ctx, { force: true, followup, sessionKey: r.sessionKey, trigger: `recall-reconcile-${trigger}` });
  if (rr.ok) deriveCoverageLedgerJson(ctx, `recall-reconcile-${trigger}`);   // the followup rewrote the prose — keep the mirror honest
  artifact = deriveRecallReconciliation(ctx, `recall-reconcile-${trigger}`) ?? artifact;
  // stamp the followup receipt onto the artifact (attempt count keyed by the unended-set signature
  // that was ATTEMPTED — carryRecallFollowup keeps it across later re-derives while the set holds,
  // and drops it the moment the set changes, which is genuinely new work deserving a fresh budget).
  const cur = safeReadJson(P.recallReconciliation);
  if (cur) {
    cur.followup = { sig, attempts: attempts + 1, ok: rr.ok === true };
    try { atomicWrite(P.recallReconciliation, JSON.stringify(cur, null, 2) + "\n"); }
    catch { /* receipt is best-effort; the ladder still bounds */ }
  }
  if (artifact?.computable && artifact.totals.unended) {
    runLog(P.runDir, { event: "recall-reconciliation-unended", trigger, unended: artifact.totals.unended,
      uris: artifact.unended.slice(0, 8).map((u) => u.record_id) });
    note(`recall-reconciliation: ${artifact.totals.unended} position(s) STILL unended after the followup — the run delivers with them stated, clamped at the pre-verdict floor`);
  }
}

// EVERY register-digest pass (fresh, escalation, envelope, late-bind, stale-repair) flows through here so
// the WS-A machine-ledger ladder applies uniformly: any pass that will actually RE-RUN the digest
// drops the stale JSON first (not only followups — review finding: --from / a resume whose
// findings re-fail also rewrite the prose, and a forgotten re-save would leave the old JSON outvoting
// it while its very existence disables the missing-side recovery); followups carry the save mandate
// (the fresh full message already does); a coverage_* terminal failure quarantines + continues on
// prose; a missing JSON gets one warm save-only follow-up; a pass that ends with a validated ledger
// clears any stale fallback note. opts.trigger labels the events.
export async function runDigest(ctx, opts = {}) {
  const P = ctx.paths;
  const trigger = opts.trigger ?? "fresh";
  // Every digest pass routes through here — fresh, escalation, envelope, settlement-flush, late-flush,
  // stale-repair — so this one seat covers them all. The evidence run's doomed attempt (810s) and the two
  // flush attempts that failed the same validator again (1,402s + 1,506s) were all dispatches over
  // deferrals nothing had decided. Synthesis needs no seat of its own: it reads the digest's output, so
  // a settled digest settles it.
  await assertReceiptSettled(ctx, "register-digest");
  // An idempotency SKIP (valid findings + valid-or-absent JSON) must NOT drop — that JSON is live.
  const willRun = opts.force || forceFromActive(ctx, "register-digest")
    || !existsSync(P.registerFindings)
    || !validators.registerFindings(P.registerFindings, readFileSync(P.registerFindings, "utf8")).ok;
  // D1 — arm the off-enum coverage gate for every digest pass THIS driver dispatches: the sentinel is
  // the receipt the registerFindings validator keys coverage_status_offenum on (receipt PRESENCE, the
  // D1 invariant), so live off-enum Status rows fail token-first into the corrective ladder while
  // archived pre-D1 runs — which never carry the sentinel — keep their replay verdicts (27/64 corpus
  // files hold off-enum shapes; an unkeyed gate would mass-flip the replay harness). Written only when
  // the pass will actually RUN: a resume whose pre-D1 prose already validates is left un-armed.
  // Non-fatal like the instructed-scope write — a miss just leaves the extra gate un-armed.
  //
  // — THE SAME SENTINEL IS THE COVERAGE FORM'S ERA STAMP, AND THE WRITE ORDER IS THE FAIL-CLOSED
  // LEG. `armCoverageForm` stamps `form_required: true` BEFORE `writeCoverageForm` puts the form on
  // disk. Get that order wrong and a failed form write leaves no stamp, the gate never arms, and the run
  // passes having judged nothing — which is the confirmed blocker (a missing sidecar returns
  // {rows:null,error:null}, the validator finds nothing to judge, and a run with NO ruling artifact is
  // byte-for-byte indistinguishable from a fully ruled one). It is reachable: a full disk fails as
  // "artifact absent", not as a disk error. In this order a failed write leaves a stamp saying a form
  // was required and no form to judge, which verify.mjs refuses as `coverage_form_missing` — a named
  // driver bug, the same treatment grid_spec_unreadable / grid_ledger_missing already give one.
  //
  // ── M6 — ALWAYS ARM, ALWAYS WRITE (2026-08-14). SUPERSEDES THE CONDITIONAL ARM BELOW IT ────────
  //
  // What stood here armed the enum sentinel WITHOUT the form arm when the plan apparatus was out of
  // reach, on the stated ground that this was "exactly the state the gate this replaces was inactive
  // in — unchanged behaviour for those runs, and no coverage-form verdict is possible on them". That
  // reason was true about the GATE and false about the REPORT, and it is overridden.
  //
  // It was false about the report because the unarmed run did not go quiet: `stages.mjs` read the same
  // stamp and told the seat "this run has NO coverage form, so the ## Coverage ledger table in your
  // findings is yours to write and it is what every coverage gate reads". So the one condition
  // could not reach kept the arrangement existed to end — a model-authored markdown table as the
  // source of truth every coverage gate read. One contract per stage, not one per runtime condition.
  //
  // And it was the wrong shape even for the gate: an unarmed absence is INDISTINGUISHABLE FROM A
  // COMPLETE RUN. Nothing downstream could tell "this run had no plan apparatus" from "this run swept
  // everything and had nothing to declare". Now the artifact is written either way — with rows when
  // there are rows, and DECLARING its cause when there are none — so the difference is a fact on disk
  // instead of an inference from a missing file.
  //
  // The write order below is unchanged and is still the fail-closed leg: armCoverageForm stamps
  // `form_required: true` BEFORE the form lands, so a failed write leaves a stamp with no form, which
  // verify.mjs refuses as `coverage_form_missing` — a named driver bug — rather than a silent pass.
  if (willRun) {
    try {
      const { input, absent } = coverageFormInput(P.runDir);
      armCoverageForm(P.runDir);
      if (input) {
        const prior = readCoverageForm(P.runDir).rows;      // a re-dispatch keeps what earlier passes settled
        const u = unionCoverageForm({ rows: prior }, { rows: null }, input);
        writeCoverageForm(P.runDir, u.form);
        runLog(P.runDir, { event: "coverage-form-written", trigger, rows: u.total, settled: u.settled,
          open: u.form.rows.filter((x) => x.open).length, bandsUnreadable: input.bandsUnreadable });
      } else {
        writeCoverageForm(P.runDir, buildCoverageAbsenceForm({ cause: absent }));
        runLog(P.runDir, { event: "coverage-form-absent", trigger, cause: absent });
      }
    } catch (e) { note(`coverage-form/sentinel write failed: ${e.message} — if the stamp landed the digest fails closed on the absent form, which is the intended direction`); }
    writeRegisterDigestFacts(ctx, trigger);
  }
  // Boundary package (2026-08-01) — placement now DECLARES the entries whose answer to the promotion
  // question ("does this conflict change the advice, or only complete the record?") two competent lawyers
  // could argue either way on this record. digest.md tells the digest those are the expected place for its
  // judgment to differ and that each must be resolved either way in a `### Disagreement resolutions` row —
  // so the count belongs beside the pass that was HANDED them: it is how a reader sees whether the
  // boundary's residue is shrinking, or whether the digest is being asked to adjudicate the same records
  // every pass. COUNT AND MARKS ONLY: the two readings live in the artifact's `reason`, and borderline
  // prose has no more business in a log row than in the report. Silent when nothing is declared (and on
  // every archived / pre-flag run) — a zero row on every digest pass is a non-event. Marks capped like the
  // recall-reconciliation `uris` row above; `count` stays exact. Best-effort: observability never blocks a
  // digest, and an absent or malformed sibling is validators.placement's business, not this row's.
  if (willRun) {
    try {
      const declared = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements.filter((e) => e.borderline === true);
      if (declared.length) runLog(P.runDir, { event: "placement-borderline", count: declared.length, marks: declared.slice(0, 8).map((e) => e.mark) });
    } catch { /* absent, pre-flag or malformed — not this row's business */ }
  }
  const droppedStale = willRun ? dropStaleCoverageLedger(ctx, trigger) : false;
  // Map #3 — the model no longer authors the JSON (mandate retired); the driver derives it post-validate.
  // — the three driver-computed blocks are ONE named builder, so the --experiment rig composes
  // exactly what this dispatch composes. `effOpts === opts` whenever nothing was appended.
  const composedExtra = digestDispatchExtra(ctx, { trigger, willRun, extra: opts.extra });
  const effOpts = composedExtra === opts.extra ? opts : { ...opts, extra: composedExtra };
  let r = await stage("register-digest", ctx, effOpts);
  if (!r.ok && isCoverageLedgerFail(r.fail)) {
    quarantineCoverageLedger(ctx, r.fail, trigger);
    const v = validators.registerFindings(P.registerFindings,
      existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "");
    if (v.ok) {
      recordTransition(ctx, "register-digest");   // the synthetic ok bypasses stageOnce's success path
      r = { ok: true, attempts: r.attempts, sessionKey: r.sessionKey, model: r.model, quarantined: true };
    }
  }
  // Map #3 — DERIVE the JSON from the just-validated prose (atomic temp+rename). Runs on EVERY pass (fresh,
  // escalation, envelope, late-bind, stale-repair) so the JSON always reflects THIS pass's prose — the root cause
  // of the prior mirror-desync failures is eliminated. A quarantined pass keeps its findings (prose) but the
  // JSON was bad; re-deriving from the good prose recovers a valid one. NEVER-KILL: a derive throw falls to
  // the prose path inside deriveCoverageLedgerJson (no hard-fail).
  if (r.ok && !r.skipped && existsSync(P.registerFindings)) {
    deriveCoverageLedgerJson(ctx, trigger);
  }
  // Near-unreachable safety net: the derive (above) writes the JSON whenever the prose parses, so a missing
  // JSON here means the derive itself threw (unparseable prose) — the prose-fallback path already handled it.
  // Kept as the WS-A never-kill belt-and-braces (it routes to a save-only followup, then prose + flag).
  if (r.ok && !r.skipped && !r.quarantined && !existsSync(P.registerCoverageLedger)) {
    noteCoverageLedgerAbsent(ctx, trigger);
  }
  if (r.ok && !r.skipped && ctx.machineLedgerNote && existsSync(P.registerCoverageLedger)) {
    // this pass ended with a VALIDATED machine ledger — a prior fallback/quarantine note is now
    // false (the gates DO read the machine path from here on); clear it or the report lies.
    ctx.machineLedgerNote = null;
    writeRunStatus(ctx, { machineLedgerNote: null });
    runLog(P.runDir, { event: "coverage-ledger-recovered", trigger });
  }
  // P2-A — the retrieved→judgment reconciliation re-derives after EVERY pass, RAN OR SKIPPED (the
  // round-N→N+1 evaporation died exactly between passes; a skip-resumed run re-checks so a park
  // bought by the pre-verdict floor gets its fresh followup attempt here). Enforcement is one warm
  // followup; delivery blocking belongs to the pre-verdict floor, never to this seam (a flush whose
  // items must stay durable can't be failed from here).
  if (r.ok) await enforceRecallReconciliation(ctx, r, trigger);
  // — the placement→digest CARRY join, re-derived on the same seam and for the same reason: the
  // loss it counts happens BETWEEN passes. It never gates and never sends a followup — the artifact,
  // the asserted run.jsonl row and (at publish) one doubt per unanswered placement are the whole
  // mechanism, per presence-reconciliation's rule that this driver annotates and never re-decides.
  if (r.ok) derivePlacementCarry(ctx, trigger);
  // — THIS WAS `deriveRecordCarry(ctx, trigger)` AND IT WAS THE DEFECT. The trace joins against
  // findings.json, synthesis authors findings.json, and synthesis runs AFTER register-digest — so on a
  // linear fresh run the join ran against `[]` and every retrieved record that DID become a finding was
  // written down as having stopped at an earlier seam, naming that seam. It never errored; it reported a
  // confident wrong answer on the one artifact whose purpose is to say which records reached the
  // findings. It was accidentally right only on runs that tripped the delivery freshness gate, because
  // UPSTREAM_STALE_REPAIR re-runs the digest after synthesis.
  //
  // What belongs here is the DIGEST'S OWN account of what it just did — a fact this pass holds and the
  // next pass overwrites. The join moved to where the findings exist (deliverRun, before the doubt mint
  // and the predelivery lint both read it).
  if (r.ok || r.fail) recordDigestSeam(ctx, r, trigger);
  if (!r.ok && !isCoverageLedgerFail(r.fail) && droppedStale && !existsSync(P.registerCoverageLedger) && !ctx.machineLedgerNote) {
    // drop-then-fail (e.g. the non-fatal late-bind re-digest dying on transport): a valid ledger was
    // deleted and nothing re-saved it — the prose fallback must be visible, never silent.
    ctx.machineLedgerNote = `machine coverage ledger was dropped ahead of the ${trigger} re-digest, which then failed — coverage gates read the prose table for this run`;
    writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });
    runLog(P.runDir, { event: "coverage-ledger-fallback", trigger, reason: "dropped_then_failed" });
  }
  return r;
}

// ── THE DRIVER-COMPUTED DIGEST PROMPT BLOCKS (item) ─────────────────────────────────────────────
//
// Three blocks that are context the digest receives and no file records: the deferred-axis hint (A8),
// the placement rulings tail (P5/A-2), and the owner×element screen receipt (P2-B). They lived inline
// in runDigest, so `--experiment register-digest` — which calls stage() directly and never enters
// runDigest — dispatched an arm WITHOUT all three. Named here so both callers compose the identical
// string; stage-context.mjs DISPATCH_EXTRAS declares this builder's read set, so the sandbox carries
// what it reads like any other edge.
//
// EXTRACTION ONLY. Same blocks, same order, same guards: A8 and the owner receipt are unconditional,
// the rulings tail keeps `willRun && trigger !== "fresh"`. Returns `extra` UNCHANGED — by identity, so
// a caller can tell nothing was appended — when no block fires.
export function digestDispatchExtra(ctx, { trigger = "fresh", willRun = true, extra = undefined } = {}) {   // @internal
  const P = ctx.paths;
  let out = extra;
  // — THE COVERAGE FORM BRIEF, replacing the deferred-slice block (was A8, 2026-07-30).
  //
  // What stood here composed a prose list of every deferred qid and told the stage each one "must appear
  // VERBATIM in a Coverage-ledger row". The block's own doc block explained why it could not elide any of
  // them: the join was on the qid verbatim, so a qid the stage was never shown could never be named.
  // R1 carried fourteen. The driver now writes those qids INTO the form as rows, each with its own
  // receipt reason and marked `open`, so the dispatch names the file rather than reciting its contents.
  //
  // STILL BEST-EFFORT HERE, AND — UNLIKE BEFORE — THAT IS NOW SAFE BY CONSTRUCTION RATHER THAN BY
  // ARGUMENT. The old block was best-effort because the ENFORCEMENT lived in the validator reading the
  // same receipt off disk. The form is not composed here at all: it is written above, before the
  // dispatch, and the era stamp is already armed. If this brief fails to compose, the seat gets a
  // dispatch without it and still finds the form on disk — and if the FORM is missing, the validator
  // fails closed. A composition failure costs a corrective round, never a silent pass.
  try {
    const stamp = coverageFormStamp(P.runDir);
    if (stamp.required) {
      const cf = readCoverageForm(P.runDir, stamp.formName);
      // Typed transport: the brief ENUMERATES the rows and names `record_coverage` — the dispatch is
      // the seat's only sight of its obligations now (the seat-facing form copy is dead), and the
      // tool's every answer re-lists what is outstanding, so a brief that failed to compose degrades
      // to learning-by-answer, never to a silent pass (the validator still refuses an unsettled row).
      const block = coverageFormBrief({ rows: cf.rows ?? [] });
      if (block) {
        out = out ? `${out}\n\n${block}` : block;
        runLog(P.runDir, { event: "digest-coverage-form-brief", rows: (cf.rows ?? []).length,
          open: (cf.rows ?? []).filter((r) => r.open).length });
      }
    }
  } catch (e) { note(`coverage-form brief skipped (non-fatal — the form is in _driver/ and the validator refuses an unsettled row): ${String(e.message).slice(0, 80)}`); }
  // — THE BATCH BLOCK: how the driver split this run's band, and which batches are still outstanding.
  //
  // The seat is told the split HERE rather than in the stage's dictation because the numbers are the
  // run's, not the contract's: a band of 40 records is one batch and a band of 1,161 is twelve, and on a
  // resume the outstanding set is what the killed attempt did not reach. The dictation says the rule;
  // this says the arithmetic.
  //
  // BEST-EFFORT, AND SAFE BY CONSTRUCTION rather than by argument — the coverage brief's precedent above,
  // for its reason. Nothing here enforces anything: a call naming a batch is judged against the driver's
  // own split whether or not this block composed, the tool's refusal re-states what is outstanding, and
  // the stage's exit gate refuses a document that ends fewer records than the run carried in. A brief
  // that fails to compose costs a corrective round; it cannot cost a record.
  try {
    const gap = digestAccountingGap(P.runDir);
    const block = digestBatchBrief(gap);
    if (block) {
      out = out ? `${out}\n\n${block}` : block;
      runLog(P.runDir, { event: "digest-batch-brief", trigger, owed: gap.owed.length,
        batches: batchesOf(gap.owed).length, unaccounted: gap.unaccounted.length });
    }
  } catch (e) { note(`digest batch brief skipped (non-fatal — the tool judges every batch against the driver's own split regardless): ${String(e.message).slice(0, 80)}`); }
  // AD-2 A9 (E2E-R2) + the P5 review (2026-07-31): a corrective/repair pass is told NOT to re-read the
  // whole placement file — the per-candidate tiers are in placements.json — but the RULINGS TAIL (band
  // reconciliation, disagreements, coverage rulings, open questions) lives ONLY in the md. Leaving it to
  // model discretion is exactly the loss A9 names, and the named backstop does not cover it:
  // findUnresolvedDisagreements only flags disagreement rows that EXIST, so a table that vanished
  // entirely yields zero flags. So on a corrective dispatch the tail rides the message AS DATA
  // (same shape as correctionsExtra's synthesis block). A fresh pass reads the md itself; a legacy run
  // with no tail costs nothing.
  //
  // A-2 — the guard used to read `&& !opts.followup`, on the reasoning that "a warm followup carries its
  // own message and is untouched". Both halves of that were wrong. A followup is not warm (A-1: it is
  // attempt 1 of a fresh session), and its own message is now COMPOSED with `extra` rather than replacing
  // it — so the tail reaches it. This is the dispatch that needed it most: the least able to reconstruct
  // the rulings tail was the only one denied it, and the flush is the largest re-digest surface in a run.
  //
  // Rebase note (P5 onto A8): this block COMPOSES with the deferred-axis hint above rather than
  // replacing it — it appends to the running `out`, not to the incoming `extra`. Restarting from `extra` here (the
  // pre-rebase shape) would have silently dropped A8's hint on every corrective digest pass, which is
  // the one dispatch where both blocks are wanted at once.
  if (willRun && trigger !== "fresh") {
    const tail = extractRulingsTail(existsSync(P.placement) ? readFileSync(P.placement, "utf8") : "");
    if (tail) {
      const block = lines(
        `PLACEMENT RULINGS TAIL (verbatim from ${P.placement}, provided AS DATA — do NOT re-read the placement file; adjudicate against these rulings: adopt each one or counter-reason it by engaging its stated reason, never silently drop one):`,
        "```markdown",
        tail,
        "```",
      );
      out = out ? `${out}\n\n${block}` : block;
      runLog(P.runDir, { event: "digest-rulings-tail", trigger, chars: tail.length });
    }
  }
  // Rebase note (P2-B onto P5/, 2026-07-31): this block is the THIRD writer of the composed extra on
  // this dispatch, after A8's deferred-axis hint and P5's placement rulings tail. It composes with both
  // for the same reason P5 composed with A8 — it appends to the running `out`, never to `extra`. A
  // corrective digest pass on a matter with a deferred axis and an owner lane carries all three blocks.
  // P2-B (charter P2b): the owner×element screen reaches the digest as DATA. The evidence run's
  // digest had to ASK the band whether the screen had run, got 0 from a broken qid join, and wrote
  // "the owner-by-owner screen produced no records" over a screen that had returned eleven. The
  // receipt says per owner what enumerated, what it attributed, and what did NOT run — and states
  // the one rule the printed negative has to obey.
  try {
    const screen = readOwnerScreen(P);
    const negative = ownerScreenNegative(screen);
    if (negative) {
      const block = `OWNER×ELEMENT SCREEN — DRIVER-COMPUTED RECEIPT (do NOT re-derive this from the band; it is the plan-execution join, and the band's own qids are its source):\n${negative}\n` +
        `Write the screen's coverage row and any owner paragraph FROM THIS. A negative about a named owner may rest ONLY on a slice listed as enumerated with zero records; ` +
        `an owner listed NOT RUN or count-only is a disclosed, open gap and must be written as one — never as "nothing found", and never as "the screen produced no records" when this receipt says records were attributed.`;
      out = out ? `${out}\n\n${block}` : block;
    }
  } catch (e) { note(`owner-screen dispatch data skipped (non-fatal): ${String(e.message).slice(0, 80)}`); }
  return out;
}

/**
 * No stage starts on inputs a recorded, unresolved item is about to change.
 *
 * The start predicate (stageOnce → stage-freshness) tests input PRESENCE and content hash, never input
 * STATUS: plan-execution.json carrying three refused slices gates nothing, which is how placement-inquiry
 * started one second after the run recorded them and a digest attempt was dispatched already doomed.
 *
 * This is straight-line code, so "gating" really means "the decision step runs first" — the fan-in already
 * settles. This guard is the INSURANCE: a resume that reached here without passing the fan-in, a `--from`
 * fork, or a supplemental fold that bumped plan_version after the last decision. It never waits (there is
 * nothing to wait on) and never blocks: it settles, loudly, and lets the stage proceed on settled inputs.
 *
 * Fails loud only when the receipt itself is unreadable — a driver-written artifact, so a parse failure is
 * a defect, not a state to route around.
 */
export async function assertReceiptSettled(ctx, stageLabel) {
  const P = ctx?.paths;
  if (!P?.planExecution || !existsSync(P.planExecution)) return { settled: true, cause: "no-receipt" };
  let receipt;
  try { receipt = JSON.parse(readFileSync(P.planExecution, "utf8")); }
  catch (e) {
    throw new StageFailure("settled-gate", `_driver/plan-execution.json is unreadable (${String(e.message).slice(0, 120)}) — the run cannot tell which dictated slices were refused, and ${stageLabel} would read coverage it cannot vouch for`,
      undefined, { failClass: "deterministic" });
  }
  const state = receiptSettled(P, receipt);
  if (state.settled) return state;
  runLog(P.runDir, { event: "unsettled-inputs", stage: stageLabel, cause: state.cause,
    unsettled: state.unsettled.slice(0, 8) });
  note(`${stageLabel}: ${state.unsettled.length} recorded deferral(s) carry no decision (${state.cause}) — settling before the stage runs`);
  // Prefer the fan-in's lane: it carries the executor, so a mis-stamped deferral still gets its one
  // budgeted attempt. Absent it (a seam the fan-in never reached), settle anyway rather than log and
  // proceed unsettled — a guard that only narrates the problem it was written to fix is not a guard.
  // Dispatch-less settling records a suspect as ended, never as closed, so nothing is claimed untried.
  if (ctx.settleEnvelope) await ctx.settleEnvelope(`guard:${stageLabel}`);
  else await settleReceipt({ P, plan: ctx.registerPlan, receipt });
  // Re-read from disk: the settle may have re-joined and rewritten the receipt itself, so judging the
  // outcome against the pre-settle object in hand would report on a receipt that no longer exists.
  let after = receipt;
  try { after = JSON.parse(readFileSync(P.planExecution, "utf8")); } catch { /* keep the one we have */ }
  const settled = receiptSettled(P, after);
  if (!settled.settled)
    note(`${stageLabel}: ${settled.unsettled.length} deferral(s) STILL undecided after settling (${settled.cause}) — the stage proceeds and the coverage gate holds the line`);
  return settled;
}

// AD-2 A9 (E2E-R2) — placement's RULINGS TAIL, extracted verbatim: everything from the
// "### Coverage rulings & open questions" heading to the end of the file (per the placement-inquiry
// SKILL contract, that section and "### Open questions for the client / reviewer" close the file).
// Pure text→text so the extraction tests offline; "" when the heading is absent (a legacy or
// register-less run costs the dispatch nothing). Capped so a crowded band's rulings cannot balloon
// a followup dispatch — the cut lands on a line boundary and says so, never a silent mid-row chop.
export function extractRulingsTail(placementMd, { cap = 8000 } = {}) {   // @internal
  const text = String(placementMd ?? "");
  const m = text.match(/^#{2,4}\s*Coverage rulings\b.*$/im);
  if (!m) return "";
  const tail = text.slice(m.index).trim();
  if (tail.length <= cap) return tail;
  const cut = tail.lastIndexOf("\n", cap);
  return `${tail.slice(0, cut > 0 ? cut : cap).trimEnd()}\n\n[rulings tail truncated at ${cap} chars — the full text is in the placement file]`;
}
