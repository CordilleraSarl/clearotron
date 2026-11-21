// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// dispatch-extras.mjs — what a stage is handed beyond its manual: each stage's extra block, the case-law decision and
// its join, the coverage judgment, the plan audit's frame, the refutation pass, the derived bases settled after a
// pass, and the declination spec.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { ensureDriverDir } from "../shared/driver-dir.mjs";
import { reportLines } from "./corrections-feedforward.mjs";
import { waitingFamilyStates } from "./coverage-form-io.mjs";
import { coverageLedgerTableRows } from "./coverage-ledger.mjs";
import { parseFindingsJson, parseFindingsJsonLenient } from "./findings-model.mjs";
import { goodsEvidenceOfDrops, skepticDeferralExtra } from "./floor-and-gap-checks.mjs";
import { goodsFromLabel } from "./goods-evidence.mjs";
import { notesPageRows } from "./hand-off-exits.mjs";
import { note, runLog } from "./log.mjs";
import { plainRegisterFlags, SENTENCE_WORD_LIMIT } from "./plain-register.mjs";
import { profileOrdinals } from "./profile-selection.mjs";
import { joinCaseLawProfiles, parseCaseLawProfiles } from "./publish/parse.mjs";
import { applyDerivedBases, readOkRecordUris, unprovableRecordBases } from "./recall-reconciliation.mjs";
import { keptModelOrdinal, modelRecordPath, readFold } from "./record-fold.mjs";
import { digestDispatchExtra, loadCoverageLedger } from "./register-digest-run.mjs";
import { PLAN_AUDIT_CLASSES, PLAN_AUDIT_HEAD } from "./register-plan.mjs";
import { assembleRunRecords, findRegistryArithmeticIssues, findRegistryViolations } from "./registry-fidelity.mjs";
import { StageFailure } from "./run-outcome.mjs";
import { atomicWrite } from "./run-record.mjs";
import { productKeyOf } from "./search-policy.mjs";
import { DISPATCH_EXTRAS } from "./stage-context.mjs";
import { findingsSurfaceRows, safeReadJson, stage } from "./stage-dispatch.mjs";
import { writeFindings } from "./stage-freshness.mjs";
import { lines, nothingFound, nothingToRead, paths, recordEmptyReturn, stampDispatchBlocks } from "./stages.mjs";
import { rebaseSynthesis } from "./synthesis-record.mjs";
import { parseVerdict } from "./verify.mjs";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * — derive every meter's `basis` from the machine evidence and write the record. NEVER-KILL.
 *
 * Called at each seam where findings.json is settled, because the ONE-SHOT audit it replaced could not
 * see a stamp added after it ran, and four of four measured runs added or lost some. Idempotent: a
 * second call over an unchanged file demotes nothing and writes the same record with an empty list.
 *
 * Returns the record it wrote, or null if the findings file could not be read.
 */
export function settleDerivedBases(ctx, at) {   // @internal
  const P = ctx.paths;
  try {
    const recordFile = (uri) => join(P.runDir, "_records", String(uri).replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-") + ".json");
    // TWO parses of the same bytes, deliberately. The LENIENT parse is what every other join in the
    // driver reads, and it normalises — it adds a `schemaVersion` alias the on-disk contract forbids, so
    // writing it back fails the core-artifact gate on a key nobody typed. The strict parse is what gets
    // WRITTEN: the file's own keys, its own shape, with only the basis values changed.
    const raw = readFileSync(P.findings, "utf8");
    let doc = null;
    try { doc = parseFindingsJsonLenient(raw); } catch { return null; }
    let readSet = new Set();
    try { readSet = readOkRecordUris(readFileSync(P.readingLog, "utf8")); } catch { /* no reads logged ⇒ nothing is provable */ }
    const findings = doc?.findings ?? [];
    const demotions = unprovableRecordBases({
      findings,
      hasRecord: (uri) => existsSync(recordFile(uri)),
      wasRead: (uri) => readSet.has(uri),
    });
    let applied = 0;
    let unwritable = 0;
    let heldBase = null;   // what the synthesis merge base took, when there was a demotion to give it
    if (demotions.length) {
      let onDisk = null;
      try { onDisk = JSON.parse(raw); } catch { onDisk = null; }
      if (!onDisk) {
        // An absence is a finding: the demotions are real and could not be applied. Loud, and recorded
        // on the artifact below — never a quiet pass that leaves an unprovable claim standing.
        unwritable = demotions.length;
        note(`basis derivation (${at}): ${demotions.length} unprovable verified-from-record stamp(s) could NOT be demoted — `
          + `findings.json does not strictly parse, so the file cannot be rewritten without inventing its shape`);
        runLog(P.runDir, { event: "basis-derivation-unwritable", at, demotions: demotions.length });
      } else {
        const next = applyDerivedBases(onDisk, demotions);
        applied = next.applied;
        writeFindings(P.runDir, next.doc, { why: "derived-bases-demoted", settles: [] });
        // THE HELD BASE TAKES THE SAME DEMOTIONS. Every accepted synthesis patch merges onto
        // `_driver/synthesis-calls/accepted.json` and re-renders the findings it does not name from there, so a
        // demotion written to this file alone came back with the next patch, and the evidence check then told
        // the reviewer the stamp had returned. In the model's numbering: under a fold, a demotion lands on the
        // member the fold kept, whose object the folded finding is. The edit is judged as a call is; a refusal
        // leaves the base byte-identical and is recorded below, and the run goes on as it did before.
        if (applied) {
          const fold = readFold(P.runDir);
          const inModel = demotions.map((d) => ({ ...d, ordinal: keptModelOrdinal(fold, d.ordinal) })).filter((d) => d.ordinal != null);
          const r = rebaseSynthesis(P.runDir, (held) => applyDerivedBases(held, inModel).doc);
          heldBase = r.ok ? { base: r.changed ? "demoted" : "unchanged" }
            : /^no_base:/.test(String(r.reason)) ? { base: "no-base" } : { base: "refused", baseReason: String(r.reason).slice(0, 200) };
          if (heldBase.base === "refused") {
            note(`basis derivation (${at}): the synthesis merge base could not take the demotions (${heldBase.baseReason.slice(0, 100)}) — `
              + `it is left as it was, and the next accepted patch re-renders the stamps it holds`);
          }
        }
        // A SHORTFALL IS A FINDING. The demotions are computed against the lenient parse, which normalises
        // — so a raw finding missing the `ordinal` the match keys on would leave an unprovable claim
        // standing while `demoted` and `rows` sat next to each other looking consistent. Say it.
        if (applied !== demotions.length) {
          unwritable = demotions.length - applied;
          note(`basis derivation (${at}): ${unwritable} of ${demotions.length} unprovable stamp(s) did NOT apply — `
            + `the on-disk findings carry no matching ordinal/meter for them, so the claim is still standing`);
          runLog(P.runDir, { event: "basis-derivation-shortfall", at, expected: demotions.length, applied });
        }
      }
    }
    if (applied) {
      note(`basis derivation (${at}): ${applied} meter(s) demoted verified-from-record → inferred-from-signal — `
        + `the reading log cannot back the claim: `
        + demotions.slice(0, 3).map((d) => `${d.mark ?? d.ordinal}/${d.meter} (${d.why})`).join("; ")
        + `${demotions.length > 3 ? ` …${demotions.length - 3} more` : ""}`);
    }
    // The rows are the audit record, written whether or not anything moved (AD-4): "nothing was
    // demoted" and "nobody looked" must not read the same.
    const stampedBefore = findings.reduce((n, f) => n + Object.values(f?.meters ?? {})
      .filter((m) => m?.basis === "verified-from-record").length, 0);
    const record = { ts: new Date().toISOString(), at,
      stamped_before: stampedBefore, stamped_after: stampedBefore - applied, demoted: applied,
      ...(unwritable ? { unwritable } : {}), ...(heldBase ?? {}),
      rows: demotions.map((d) => ({ ordinal: d.ordinal, mark: d.mark, meter: d.meter, uri: d.uri, why: d.why })) };
    atomicWrite(P.basisDerivation, JSON.stringify(record, null, 2) + "\n");
    runLog(P.runDir, { event: "basis-derivation", at, stamped_after: stampedBefore - applied, demoted: applied,
      ...(heldBase ? { base: heldBase.base } : {}),
      never_fetched: demotions.filter((d) => d.why === "record-never-fetched").length,
      never_read: demotions.filter((d) => d.why === "record-on-disk-never-read").length });
    return record;
  } catch (e) {
    note(`basis derivation (${at}) skipped (${String(e?.message ?? e).slice(0, 100)}) — never-kill`);
    runLog(ctx?.paths?.runDir, { event: "basis-derivation-failed", at, fail: String(e?.message ?? e).slice(0, 160) });
    return null;
  }
}

// The driver-computed prompt blocks, bound the same way. `skepticDeferralExtra` and
// `digestDispatchExtra` are the two dispatches that carry context no file records.
export const DISPATCH_EXTRA_BUILDERS = {
  // WHICH PASS ARE WE REPRODUCING? A digest's extra is not one string: A8's hint and the owner receipt
  // ride every pass, the placement rulings tail rides only a CORRECTIVE one. Default "fresh" — that is
  // the pass a preserved run's canonical artifact came from, so it is what "identical to what pipeline()
  // would hand it" means unless the operator says otherwise (--dispatch-trigger).
  "digest-dispatch-extra": (ctx, opts = {}) => digestDispatchExtra(ctx, { trigger: opts.dispatchTrigger ?? "fresh", willRun: true }),
  // (the trigger vocabulary is validated in runExperiment — a typo must refuse, not quietly compose a
  // different arm: "escalaton" would silently drop the rulings tail and nothing would say so)
  "skeptic-deferral-extra": (ctx) => skepticDeferralExtra(ctx),
  // corruption 2 — narrative-refutation's two, composed inline at the dispatch site until now.
  "plan-audit": (ctx) => planAuditExtra(ctx),
  "refute-registry-check": (ctx) => refuteRegistryCheckExtra(ctx),
  "refute-plain-register": (ctx) => plainRegisterExtra(ctx),
  // — the SAME receipt derivation, one seat earlier. A distinct id rather than a second
  // `plan-audit` entry so the dispatch receipt (`extras`) still says which stage carried which block;
  // the builder delegates, so there is one derivation and one set of graded classes.
  "synthesis-plan-audit": (ctx) => planAuditExtra(ctx, { stage: "synthesis" }),
  "synthesis-coverage-ledger": (ctx) => coverageLedgerExtra(ctx),
};

/**
 * THE ONE COMPOSER ( corruption 2). Every driver-computed prompt block for a stage, built in
 * registry order, returned with the ids and sizes that produced it.
 *
 * Production dispatch sites call this and so does the `--experiment` sandbox. That is the entire fix:
 * corruption 2 was not a missing entry in a table, it was a design in which the production prompt and
 * the shadow prompt were composed by two different pieces of code that had to be kept in step by hand.
 * `refute()` drifted; nothing could have told anyone. With one composer a block cannot exist on one
 * path and not the other, and a NEW block reaches both the moment it is registered.
 *
 * A builder that throws is noted and skipped rather than failing the run — a prompt block is additive
 * context, and losing a production dispatch over one would be worse than the block being absent. The
 * `ids` it returns are what actually got built, so an absence is visible on the arm's receipt instead
 * of inferred from a table.
 *
 * ── review: THE COMPOSER STAMPS WHAT IT BUILT, AND THE PROMPT READS THE STAMP ────────────────
 *
 * A stage message that PROMISES a driver-computed block ("it is tabulated for you below") is making a
 * claim about this function's output, and it was making it unconditionally. Three reachable shapes
 * produce no block — no frozen register plan (a class-less matter or a pre-spec48 resume; the degrade
 * is documented at attachRegisterPlan), an unparseable receipt, and neither artifact on disk — and on
 * all three the seat was told a table was below and given none. A seat that reads no MISSING slice in
 * a promised table has been handed an absence dressed as a pass, which is the one inference
 * exists to stop.
 *
 * ONE DERIVATION, NOT A SECOND PREDICATE. The obvious fix — a helper the message calls to guess what
 * the builders will do — is two copies of one rule, which is the drift this build spent b0ac330
 * removing. Instead the composer records what it ACTUALLY built on the ctx, and the message branches
 * on that record. Every path that dispatches a stage cold composes first and renders the message
 * second (production at the fresh call site, `experimentExtra` for the `--experiment` arm, and the
 * stale-repair entry), so the stamp is always the truth about the very message being built. It cannot
 * be threaded at one call site instead: `experimentExtra` is a different function, and a stamp set
 * only in production would make the shadow prompt take a different branch from the run it measures —
 * corruption 2, rebuilt inside the build that cites corruption 2.
 *
 * ABSENT IS NOT CORRUPT. `failed` is recorded apart from "did not build": no plan and no receipt is a
 * legitimate run shape, while a receipt that exists and cannot be parsed is a DRIVER-written artifact
 * bug. Collapsing the two would make the bug read as an ordinary run — an absence that is not a
 * finding. The prompt says which of the two it is, and the note() still fires for the run log.
 */
export function composeDispatchExtra(name, ctx, opts = {}) {   // @internal
  const parts = [], ids = [], failed = [], empty = [];
  for (const x of DISPATCH_EXTRAS) {
    if (x.stage !== name) continue;
    // `skip`: blocks a dispatch deliberately does not send — the review after a delivery-check repair leaves
    // out the plain-words list, which covers every line a client meets and points at a check that review is
    // not given. Skipped is not built and not failed: it appears in neither list.
    if (Array.isArray(opts.skip) && opts.skip.includes(x.id)) continue;
    try {
      const built = DISPATCH_EXTRA_BUILDERS[x.id](ctx, opts);
      recordEmptyReturn(built, x.id, { parts, ids, empty });   // EVERY builder that ran is recorded, not only those that produced text: `if (built)` alone put an empty return in neither list, so a block that ran with nothing to flag read exactly like one that never ran — and only the second is a defect. The three-way sort lives in stages.mjs beside the sentinels it reads.
    } catch (e) {
      const detail = String(e?.message ?? e).slice(0, 100);
      failed.push({ id: x.id, error: detail });
      note(`dispatch extra "${x.id}" threw (${detail})`);
    }
  }
  // The stamp rides the ctx the message is about to be rendered from. Keyed by stage, because one ctx
  // composes blocks for several stages over a run and the last one must never answer for another.
  // `stampDispatchBlocks` is imported from stages.mjs, where the reader lives: one definition of the
  // stamp's shape, rather than a field name two files agree on by hand.
  stampDispatchBlocks(ctx, name, { built: ids.map((x) => x.id), failed, empty });
  return { text: parts.length ? parts.join("\n\n") : "", ids, failed, empty };
}

// The case-law profiles joined to the findings as they stand: the profiles carry the writer's numbers, and after a
// grouping the delivered record has its own (joinCaseLawProfiles).
//
// A JOIN THAT FAILS IS RECORDED BEFORE IT IS THROWN. Every caller asks only when the case-law file is there, and catches
// the throw as "no case-law layer", so a join that failed on a file that exists read exactly like a run with no case law:
// the cards and the delivery checks went on without it and nothing said so. The run log now carries the failure; what
// each caller does next is unchanged.
export const caseLawJoin = (P, findings) => {
  try {
    return joinCaseLawProfiles(parseCaseLawProfiles(readFileSync(P.caseLaw, "utf8")), findings, readFold(P.runDir)?.map?.modelToFolded ?? null);
  } catch (e) {
    const error = String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
    try { runLog(P.runDir, { event: "case-law-join-failed", error }); } catch { /* the note below still says it */ }
    note(`case law: the profiles could not be joined to the findings (${error}); this step goes on without them`);
    throw e;
  }
};

// Read the synthesis SUFFICIENCY signal from findings.json. The driver reads the raw JSON directly (NOT via the
// strict parseFindingsJson key-allowlist) so the verdict-clamp is decoupled from the findings parser: an absent
// field (clean run, archived run) is the "sufficient → deliver clean" default. Shape (synthesis contract):
// {sufficient:bool, reason:string}. There are no `commands`/`halt` any more — the lawyer's judgment that a
// material slice was not fully cleared CLAMPS the verdict CLEAR→CONDITIONAL (deliver-conditional), never a
// re-search loop and never a halt.
export function readCoverageJudgment(P) {
  const ABSENT = { present: false, sufficient: true, reason: "" };
  if (!existsSync(P.findings)) return ABSENT;
  let doc;
  try { doc = JSON.parse(readFileSync(P.findings, "utf8")); } catch { return ABSENT; }
  const cj = doc && typeof doc === "object" ? doc.coverage_judgment : null;
  if (!cj || typeof cj !== "object" || Array.isArray(cj)) return ABSENT;
  return {
    present: true,
    sufficient: cj.sufficient !== false,   // default-true: only an explicit false withholds (→ CONDITIONAL)
    reason: String(cj.reason ?? "").slice(0, 300),
  };
}

// Round 2 Change 1d — best-effort: the jurisdiction tokens a run actually searched, read from the coverage
// ledger unit scopes (e.g. "primary-sweep / EU", "transliteration-numeric / PH (material)"). A "worldwide" /
// "global" scope is reported separately: it covers the in-scope set (so no under-coverage), but on a narrow
// scope it is itself the over-reach the skill (Change 1c) must bound.
// A12 (addendum 2026-07-30): tokens are recorded in the CANONICAL vocabulary (UK→GB, EM/EUTM/EUIPO→EU —
// driver/jurisdiction-codes.mjs), so a ledger that spells the same territory two ways yields ONE code and
// the scope diff can never flag GB-vs-UK as different territories. Tokens outside the known universe ride
// back in `unknown` — carried in `jurisdictions` too (never dropped), but the caller must surface them
// LOUDLY (a jurisdiction nobody can place must never be a silent row in the machine record).
// item 13 — `extractSearchedJurisdictions` LIVED HERE AND IS GONE. It ran a two-letter scan over the
// coverage ledger's prose to decide which territories a run had searched, and the narrowing (drop
// tokens that are not known jurisdiction codes) closed only the half where the junk token was not a real
// code. The other half cannot be closed by any token list: SA, AG, KG, SL and SE are simultaneously real
// jurisdiction codes and ordinary European company suffixes, so "… GmbH & Co. KG" reads as Kyrgyzstan and
// always would have. A territory claimed as searched now traces to an EXECUTED QUERY —
// `searchedJurisdictionsFromPlan(plan, execution)` in register-plan.mjs, joining plan entries' `regions[]`
// to plan-execution's `executed[].qid`. Do not reintroduce a prose derivation here in any form.

/**
 * Does the case-law grounding stage run? REQUESTED-OR-DETECTED (F4, 2026-07-21).
 *
 * It used to be detection-only — a regex over the draft narrative — which made the composer's "Case law"
 * toggle a dead switch: a client could buy the "Full deep dive"'s headline feature and receive it only if
 * the drafting model happened to reach for one of these five words. `job.caseLaw === true` now forces it.
 *
 * The detector is deliberately kept as an OR rather than replaced. It is the run's own reasoning noticing
 * that the read turns on a precedent or an opposition, and a client who left the box unticked has not
 * thereby instructed us to ignore that. So the lever is ADDITIVE: it can only ever add the stage, never
 * suppress one the narrative called for — which is why an explicit `caseLaw: false` is recorded and not
 * obeyed. The honest way to sell a search without case law is a level that does not run it, not a flag
 * that overrides the run's judgment mid-flight.
 *
 * TWO PLACES CAN REQUEST IT, and they OR together for the same reason. `job.caseLaw` is this request;
 * `policy.caseLaw` is the frozen saved search that was named instead of a level — a composer that offers
 * "Save as search" over a lever the recipe then dropped would sell a search that quietly differs from the
 * one that was saved. Whichever asked, the run is the same and the log records both.
 */
// The five words whose presence in the draft narrative means the run's own reading turned on a precedent
// or an opposition. Exported so a probe binds to it instead of retyping it (the rule).
export const CASE_LAW_TRIGGERS = /watchlist|precedent|case[- ]law|opposition|famous mark/i;   // @internal

// — CASE LAW HAS EXACTLY ONE HOME, AND THE PRODUCT DECIDES IT, NOT THE NARRATIVE.
//
// The offering locked with the reviewing lawyer gives the case-law and opposition reading to the Full
// country search alone, over exactly one country, where it is automatic. Multi-country focus deliberately
// has no case-law component. `job.caseLaw` is refused at the door and `policy.caseLaw` is set from the
// product spec, so the REQUESTED path was already confined correctly — and the one-territory rule is
// enforced at that door.
//
// The detector was not. It fires mid-run, after admission, on a run already scoped to however many
// territories it was sold, and it passes no door: a Multi-country focus search over seven territories ran
// a case-law pass and wrote 10 KB of findings. That is a component of a product the client did not order,
// unbilled, with no scope guard — and the run's own scenario assertion passed, because it reads the
// recorded-and-ignored `caseLaw` flag rather than the artifacts.
//
// So the detector still DETECTS and no longer EXECUTES. The judgment is worth keeping — a run noticing
// that its read turns on an opposition is a real observation — and it is recorded as machine-written run
// data (the product, the trigger word, the territories) in `_driver/` only. It is the natural seed of a
// "a case-law question exists in territory X — a Full country search would examine it" recommendation,
// and NO report or email sentence for it exists here: no wording enters a deliverable that the owner has
// not agreed.
export const CASE_LAW_PRODUCT = "full-country-search";   // @internal

/**
 * Does the case-law grounding stage run? PRODUCT-GATED, requested-or-detected within it.
 *
 * `run` is true only on the one product that carries the reading. `detected` stays truthful whatever the
 * product is, because the observation is recorded rather than discarded, and `declined` names the state
 * the round could not previously see: the run's reading called for case law and the product does not
 * carry it.
 *
 * A run whose policy cannot be read at all is NOT eligible, and says so with `product: null`. Declining
 * is the safe direction — the alternative is starting an unbounded pass on a product nobody established
 * — and it is recorded rather than silent, which is what stops it being an absence read as a decision.
 *
 * PURE; never throws.
 */
export function decideCaseLaw({ job, narrative, policy } = {}) {   // @internal
  const requested = job?.caseLaw === true || policy?.caseLaw === true;
  const m = CASE_LAW_TRIGGERS.exec(String(narrative ?? ""));
  const detected = Boolean(m);
  // The product is `level` on a run's frozen policy and `product` on a bare selector; productKeyOf reads either
  // (search-policy.mjs), so a resumed run and a bare selector name the same product.
  const product = productKeyOf(policy) || null;
  const eligible = product === CASE_LAW_PRODUCT;
  const called = requested || detected;
  return {
    run: called && eligible,
    requested, detected, eligible, product,
    trigger: m ? m[0].toLowerCase() : null,
    // The observation this build exists to preserve: the reading called for case law, and the product
    // this run was sold does not carry it.
    declined: called && !eligible,
  };
}

/**
 * Write the spec the `record_declination` tool reads, and hand the same list to the dispatch. BOTH sides
 * come from one call so the seat's `row_index` and the tool's offered list cannot disagree — the
 * `CLOSURE_EVIDENCE_FILES` lesson one transport over, where two copies of a positional list would have
 * verified every citation against the wrong file.
 *
 * `scope` is instructed-scope.json, JOB-authored before any model ran. It is the only thing the
 * contradiction refusals rest on, which is why it is read here rather than accepted from the seat.
 */
// THE WRITE-UP IS TOLD WHAT EACH RECORD'S GOODS REST ON, beside its position (goods-evidence.mjs `goodsFromLabel`),
// so a record declined on goods is declined knowing whether those goods were the official record's, a search answer's,
// cut, or none. Only the dispatch's copy carries it; the spec the declination tool reads is the positions alone.
// A list the label could not be added to keeps its lines as they were, and the run says so: a write-up handed no goods
// source must not read as one whose records have none.
export function withGoodsFrom(ctx, P, rows, read = null) {   // @internal — driven by its test with a run's own files
  const unlabelled = (reason) => {
    try { runLog(P.runDir, { event: "write-up-goods-from-failed", rows: rows.length, reason: String(reason).slice(0, 120) }); } catch { /* the list still goes */ }
    return rows;
  };
  try {
    const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
    if (!runPrefix) return unlabelled("the run has no session prefix to read its evidence by");
    const uris = rows.filter((r) => r?.kind !== "page" && r?.uri).map((r) => r.uri);
    const evidence = read ?? goodsEvidenceOfDrops(P, runPrefix, uris);
    return rows.map((r) => {
      const e = r?.kind !== "page" && r?.uri ? evidence.get(r.uri) : null;
      return e ? { ...r, goods_from: goodsFromLabel({ state: e.goods, source: e.source, question: e.question }) } : r;
    });
  } catch (e) { return unlabelled(e?.message ?? e); }
}

// THE TOOL IS TOLD WHAT EACH RECORD'S GOODS REST ON, from the same derivation (ruled 2026-10-27). A goods decision on a
// mark identical to the applied-for mark, live in a filed class, stands only where the run holds that record's goods
// complete, so the spec the declination tool judges carries each record's state, a position's members' included. A
// list the states could not be added to keeps its rows as they were: the refusal then reads no state and refuses, and
// the run says so.
export function withGoodsStates(ctx, P, rows, read = null) {   // @internal — driven by its test with a run's own files
  const unstated = (reason) => {
    try { runLog(P.runDir, { event: "declination-goods-states-failed", rows: rows.length, reason: String(reason).slice(0, 120) }); } catch { /* the list still goes */ }
    return rows;
  };
  try {
    const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
    if (!runPrefix) return unstated("the run has no session prefix to read its evidence by");
    const evidence = read ?? goodsEvidenceOfDrops(P, runPrefix, surfaceUris(rows));
    const state = (u) => evidence.get(u)?.goods ?? null;
    return rows.map((r) => (r?.kind === "page" || !r?.uri ? r : { ...r, goods: state(r.uri),
      ...(Array.isArray(r.members) ? { members: r.members.map((m) => ({ ...m, goods: state(m?.uri) })) } : {}) }));
  } catch (e) { return unstated(e?.message ?? e); }
}
/** Every record a list of the writer's rows names, a position's members included. PURE. */
const surfaceUris = (rows) => [...new Set(rows.filter((r) => r?.kind !== "page" && r?.uri)
  .flatMap((r) => [r.uri, ...(Array.isArray(r.members) ? r.members.map((m) => m?.uri).filter(Boolean) : [])]))];
/**
 * What the goods of the writer's records rest on, READ ONCE for the labels its message carries and the states its tool
 * judges: the read walks the run's held records, which run to hundreds of megabytes, and took half a minute a pass on a
 * test run. null where it cannot be read; each reader then reads for itself and says so as before. IMPURE.
 */
function surfaceGoodsEvidence(ctx, P, rows) {
  try {
    const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
    return runPrefix ? goodsEvidenceOfDrops(P, runPrefix, surfaceUris(rows)) : null;
  } catch { return null; }
}

export function prepareDeclinationSpec(ctx, P) {   // @internal
  const rows = [...findingsSurfaceRows(P), ...notesPageRows(existsSync(P.commonLaw) ? readFileSync(P.commonLaw, "utf8") : null)];   // records, then the web notes' pages
  if (!rows.length) {
    // AN EMPTY LIST REPLACES THE LAST ONE; it does not leave it standing. The recorder holds the seat to
    // whatever list the spec file carries, and a repair or corrective pass re-prepares because the
    // findings may have moved. Left in place, a list from an earlier pass would bind a pass whose own
    // prompt carries none: the order enforced, and missing from the prompt.
    try { rmSync(paths(P.runDir).declinationSpec, { force: true }); } catch { /* absent is the goal */ }
    delete ctx.findingsSurface;
    return;
  }
  let scope = {};
  try { scope = JSON.parse(readFileSync(P.instructedScope, "utf8")) ?? {}; } catch { scope = {}; }
  try {
    ensureDriverDir(P.runDir);
    const read = surfaceGoodsEvidence(ctx, P, rows);
    atomicWrite(paths(P.runDir).declinationSpec,
      JSON.stringify({ ts: new Date().toISOString(), rows: withGoodsStates(ctx, P, rows, read), scope: { marks: scope.marks ?? [], classes: scope.classes ?? [] } }, null, 2) + "\n");
    ctx.findingsSurface = withGoodsFrom(ctx, P, rows, read);
  } catch (e) {
    // The dispatch block is gated on ctx.findingsSurface, so a failed write leaves the stage UNORDERED
    // rather than ordered to call a tool whose spec it cannot read. Loud in the log, never a dead order.
    note(`declination-spec write failed (non-fatal): ${e.message} — synthesis runs without the declination order this pass`);
  }
}

/**
 * B2 — the deterministic registry-fidelity check over the NARRATIVE, as a prompt block.
 *
 * Lifted verbatim out of `refute` ( corruption 2): it was composed inline at the dispatch site, so
 * it existed only on the production path and an `--experiment narrative-refutation` arm never carried
 * it. It is now a registry builder like every other driver-computed block — ONE composer, called by
 * `refute()` and by the sandbox alike, which is what makes the two prompts the same prompt.
 *
 * Reads `ctx.paths.runDir`, NOT `ctx.run.runDir`. Identical in production (they are the same directory)
 * and the whole point in a sandbox, where `ctx.run` still names the canonical run: reading that would
 * have the arm check its narrative against the canonical run's records and write `_records/` back into
 * the run it is supposed to leave byte-identical.
 *
 * PRESENCE-parity, not byte-parity, and that is stated rather than hoped: this block is a function of
 * the narrative ON DISK NOW, and by arm time a corrective cycle may have rewritten it. So the arm can
 * carry the same block, computed the same way, over different bytes — which is honest. What can never
 * happen again is the block being absent while the comparison run had it.
 */
function refuteRegistryCheckExtra(ctx) {
  try {
    const P = ctx.paths;
    const narrative = existsSync(P.narrative) ? readFileSync(P.narrative, "utf8") : "";
    if (!narrative) return "";
    const recordsByUri = assembleRunRecords(P.runDir, `clearance-${ctx.run.slug}-${ctx.run.codename}-`).records;
    const probs = [
      ...findRegistryArithmeticIssues(narrative).map((a) => `${a.block}: ${a.detail}`),
      ...findRegistryViolations(narrative, recordsByUri).filter((v) => v.kind === "mismatch")
        .map((v) => `${v.block}: ${v.field} says "${v.claimed}" but the fetched record (${v.uri}) says "${v.record}"`),
    ];
    if (!probs.length) return "";
    return lines(
      `DETERMINISTIC REGISTRY CHECK (B2): the code-level registry-fidelity checker found these structured-field problems in the narrative — treat each as a real defect a reasoning review MUST cover (the number/date-swap class). Verify against the fetched record and require correction in your verdict + flags:`,
      ...probs.map((p) => `- ${p}`),
    );
  } catch (e) { note(`refute registry pre-check (non-fatal): ${e.message}`); return ""; }
}

/**
 * Rule 1 of the two-register rule, over the clearance's default-visible lines, as a prompt block.
 *
 * ADVISORY, AND IT STAYS ADVISORY. A hit is a rewritten sentence in the reviewer's own flags — never a
 * disclosure to the client, never a run failure. It moves no band, no evidence and nothing that is
 * searched. That is the whole reason it rides THIS stage rather than the pre-delivery lint: the
 * reviewing pass already quotes a sentence and hands back the rewrite, in the voice it uses for
 * everything else, and it reaches the writer instead of the reader.
 *
 * THE DRIVER MEASURES, THE SEAT JUDGES. `plainRegisterFlags` is deterministic; this block reports what
 * it found — which line carries a word of the profession's, and how long a sentence ran. Whether the
 * sentence is actually wrong, and what replaces it, is the reviewer's call. The decision this
 * implements rejects a word list AS THE MECHANISM, so the block hands the seat evidence and never a
 * verdict: half these words are ordinary English and several are plausible marks.
 *
 * AND IT IS BLIND TO THE RUN'S OWN NOUNS. Every mark, variant and owner the run is about is blanked
 * before the text is read, because a check that flagged the mark being cleared would put its noise on
 * the one report where it matters most — the same defect one level in that turned "AXIS Bank filed in
 * class 36" into "group Bank filed in class 36" on a report clearing AXIS.
 *
 * WHY THE FIELDS ARE THE RECORD'S OWN KEYS, AND WHAT THAT USED TO SAY. This block could not use
 * `DEFAULT_VISIBLE_FIELDS.clearance`, because that list named fields no record carried — iterating it
 * would have opened nothing and reported a clean result over text it never read, which is the
 * absence-as-pass this block exists to avoid.
 *
 * That list is repaired now: every entry is a path that resolves against a delivered record, and an arm
 * resolves each one. The keys below are still written out rather than read from it, because this block
 * needs the `where` label it puts in front of each hit and the list carries paths and not labels. The
 * two agree on the surfaces, and the arm that resolves the list is what keeps that true.
 *
 * The old wording here also stated the defect slightly wrong, and said so about the field it was most
 * likely to mislead on: `thirdPartyRights` was called dead "in either casing" when the record carries
 * `four_answers.third_party_rights`, in fourteen files. Checking a name in one casing and reporting it
 * absent in both is the same error one level down from the one this paragraph is about.
 *
 * An absent or malformed findings.json yields no block, and the composer records the id as not built —
 * so "nothing to say" and "could not look" are told apart on the dispatch receipt rather than inferred.
 */
function plainRegisterExtra(ctx) {
  try {
    const P = ctx.paths;
    if (!existsSync(P.findings)) return nothingToRead(`no findings record at ${P.findings}, so no visible line was read`);   // NOT the same nothing as the one below: this never read a line
    // ABSENT IS NOT CORRUPT, and the composer already tells them apart — so let a parse failure THROW.
    // Swallowing it here would return "" and land the id in neither `ids` nor `failed`, which reads on
    // the dispatch receipt as "this run had nothing to say" over a record nobody could open. The file
    // being missing is the legitimately empty case and returns above; a record that exists and will not
    // parse is a real defect, and the receipt should carry it.
    const doc = parseFindingsJson(readFileSync(P.findings, "utf8"));

    // ONE MARK IS ONE MARK. An order names its mark in `marks` and again in `markName`, so the list held it
    // twice and the seat was told a run about one mark was about 2 (seen on a saved test run, 2026-10-29).
    // Deduped on the key the exclusion blanks by, trimmed and in any case, so the count is the number of
    // names removed before reading.
    const markKeys = new Set();
    const about = {
      marks: [
        ...(Array.isArray(ctx.job?.marks) ? ctx.job.marks.map((m) => (typeof m === "string" ? m : m?.name)) : []),
        ctx.job?.markName, ctx.job?.name,
      ].filter((x) => typeof x === "string" && x)
        .filter((x) => { const k = x.trim().toLowerCase(); if (!k || markKeys.has(k)) return false; markKeys.add(k); return true; }),
      owners: (doc.findings ?? [])
        .flatMap((f) => [f?.owner, f?.owner_name, f?.owner?.name])
        .filter((x) => typeof x === "string" && x),
    };

    // The surfaces a clearance reader meets before opening anything, named one by one so adding a
    // field to the page is a deliberate addition here too.
    const visible = [];
    const add = (where, v, field = null) => { const t = String(v ?? "").trim(); if (t) visible.push({ where, text: t, field }); };
    for (const f of doc.findings ?? []) add(`conflict ${f?.ordinal ?? "?"}'s finding sentence`, f?.net, "net");
    // The lines that are not a finding, labelled by `reportLines` — the labels the corrective cycle's
    // observation joins a flag back to, so what the reviewer is handed and what the driver reads agree.
    for (const l of reportLines(doc)) add(l.label, l.text);

    // A FINDING SENTENCE IS AT MOST TWO SENTENCES, so its length hit cannot say "split it": a finding sentence
    // already at two would be told to grow a third. What does not fit goes to the legal and practical
    // positions, in the approved paragraph's own words. Every other visible line, and the knockout's, keeps the
    // shared hit word for word — `plainRegisterFlags` is not changed.
    const findingSentenceLength = (n) => `${n} words in one sentence, and a visible line takes ${SENTENCE_WORD_LIMIT}. The finding sentence is at most two sentences: every fact that does not fit goes in the legal and practical positions, never dropped.`;
    const hits = [];
    for (const { where, text, field } of visible) {
      for (const flag of plainRegisterFlags(text, about)) {
        hits.push(`- ${where} — ${field === "net" && flag.kind === "length" ? findingSentenceLength(flag.words) : flag.say}`);
      }
    }
    if (!hits.length) return nothingFound(`no plain-words flag over ${visible.length} visible line(s)`);   // a NEGATIVE FINDING, and the count travels with it so a clean read is not a read of nothing

    // THE LAST SENTENCE IS DERIVED, NEVER ASSERTED, and the reason is that it is the one the seat acts
    // on. `about` is built from three optional job keys and from owners found in the record, and
    // nothing guarantees any of them is present — so on a run where the exclusion found nothing, an
    // absolute claim that every mark was removed is false in exactly the state where a hit IS the mark.
    // Found in review, 2026-09-08, driven on a job carrying no marks.
    //
    // THE EMPTY STATE SAYS SO RATHER THAN GOING QUIET. Dropping the clause would leave the seat with no
    // reading of a fact that changes what it should do; telling it the mark was not excluded is more
    // useful than telling it nothing, and far more useful than telling it the opposite.
    // TWO EXCLUSIONS, TWO FACTS, AND ONLY ONE OF THEM PROTECTS THE MARK. Keying the reassurance on
    // marks ∪ owners was the first repair and it moved the defect rather than closing it: owners come
    // from the RECORD and marks from the JOB, so a record carrying thirteen owners and a job naming no
    // mark made the set non-empty, fired the reassurance, and told the seat no flag was the mark under
    // clearance over a flag that was exactly that. That mixed state is the LIKELIER one in production —
    // records carry owners; a job missing its marks is the unusual half. Found in review, 2026-09-08,
    // driven on the first repair's own head.
    const marks = about.marks ?? [], owners = about.owners ?? [];
    const ownerNote = owners.length ? ` The ${owners.length} owner name(s) from the record were also removed.` : "";
    const exclusionNote = marks.length
      ? `The ${marks.length} mark(s) this run is about were removed before reading, so none of these is a hit inside the name being cleared.${ownerNote}`
      : `THIS RUN NAMED NO MARK TO EXCLUDE, so the mark under clearance was NOT removed before reading — a flag below may BE that mark. Check each against the matter before rewriting it.${ownerNote}`;
    return lines(
      `PLAIN WORDS ON WHAT THE READER SEES FIRST: a deterministic read of this run's default-visible lines — the ones a client meets before opening anything — flagged the lines below. Treat each as a candidate FLAGGED CORRECTION [kind: narrative] and handle it exactly as you handle the reader-owned nouns above: quote the sentence and give the rewrite that keeps every fact. THIS IS EVIDENCE, NOT A VERDICT — judge each in context and pass over any where the word is the subject rather than the profession's shorthand. ${exclusionNote}`,
      ...hits,
    );
  } catch (e) {
    // Re-thrown, not swallowed: composeDispatchExtra notes it and records the id under `failed`, so an
    // unreadable record is visible on the receipt instead of looking like a clean run. A prompt block is
    // additive context and the composer already refuses to fail a dispatch over one.
    throw new Error(`plain-register pre-check: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

// ── THE RECEIPT, AND THE GRADED CLASSES, STATED ONCE ────────────────────────────────────────────────
//
//. The receipt this block tabulates is the answer to "did that search run", and until now exactly
// one stage got it: the REVIEWER. `synthesis` — the stage that writes the claim the reviewer then
// blocks — was handed neither the receipt nor the coverage ledger, in the prompt or in the staleness
// map, and re-derived both by reading. On the first delivered clearance the reviewer blocked a synthesis
// that had written an enforcement history over a check the grid never dispatched: the evidence that it
// never dispatched was on disk before synthesis started, and the driver was already computing it for the
// stage downstream.
//
// So the block is shared, and the SPLIT is where the care goes. Two literals are the same for both
// readers — the head (what the receipt is) and the three graded classes (what each state MEANS). One
// literal is per-stage, because the two seats do genuinely different things with the same classes: the
// reviewer AUDITS a finished document against them under a named section title the validator keys on
// (`plan_audit_missing`), and synthesis RULES over them before a word is written. Writing the classes
// out twice, once per seat, is the shape — one rule in two places, drifting from the day the second
// copy is typed — and the classes are the part that must never drift, because class (1) is the blocking
// condition.
// THE HEAD AND THE GRADED CLASSES ARE NOT DECLARED HERE. They live in register-plan.mjs, beside the
// derivation that assigns the states, because the gateway's corrective hint is a THIRD reader of the
// same grading and `pipeline.mjs` imports `gateway.mjs` — so a constant declared here could never
// reach it.
const PLAN_AUDIT_FRAME = {
  // Unchanged in force and unchanged in section title: same three classes, same blocking condition,
  // same closing sentence. `verify.mjs` keys `plan_audit_missing` on the title, so it is verbatim.
  "narrative-refutation":
    `Your review MUST include a section titled "PLAN-EXECUTION CHECK" auditing it against the three classes below: a clean claim resting on class (1) is a BLOCKING flag — that search never ran; on class (2), verify the narrative treats the parent crowd as dilution context and flag ONLY if it is claimed searched-clean; on class (3), flag a clean claim ONLY when the narrative shows NO materiality reasoning for that slice. You audit the reasoning; you never manufacture a CONDITIONAL from a state label.`,
  // — the same receipt, one seat earlier, and the direction reverses: this stage is not being
  // audited against the classes afterwards, it is ruling over them before it writes.
  synthesis:
    `You are ruling over this receipt BEFORE you write — you are not being audited against it afterwards. A fact whose supporting slice falls in class (1) is UNWRITEABLE: say the check was not dispatched this run, and stop there. Class (3) is yours to weigh, and the weighing has to LAND where a reader sees it — a findings.json coverage[] row, or one line of reasoned-immaterial prose naming the slice.`,
};

export function planAuditExtra(ctx, { stage = "narrative-refutation" } = {}) {
  const P = ctx.paths;
  if (!ctx.registerPlan || !existsSync(P.planExecution)) return "";
  let exec;
  try { exec = JSON.parse(readFileSync(P.planExecution, "utf8")); }
  catch (e) { throw new StageFailure(stage, `plan-execution receipt unreadable (driver-written artifact): ${String(e.message).slice(0, 100)}`); }
  let rows = [];
  try {
    const crowds = exec.executed.filter((x) => x.state === "incomplete");
    // By the time this block is read the reading turn is over, and a waiting family it chose not to ask
    // is a settled judgment with its reason on record, not an open question. Counted as awaiting, a run
    // whose every waiting family was withheld told the reviewer they all remained open, and it raised a
    // coverage flag against judgments already made.
    const { withheld, awaiting } = waitingFamilyStates(P.runDir, exec.awaiting);
    const withheldOn = (axis) => withheld.filter((f) => f?.axis === axis).length;
    rows = [
      `- executed: ${exec.executed.length} entr${exec.executed.length === 1 ? "y" : "ies"} (${crowds.length} crowd/incomplete${crowds.length ? `: ${crowds.slice(0, 4).map((x) => x.qid).join("; ")}` : ""})`,
      `- missing (no band block): ${exec.missing.length}${exec.missing.length ? ` — ${exec.missing.slice(0, 4).join("; ")}` : ""}`,
      `- skipped (crowd-gated fringe): ${exec.skipped.length}`,
      // The families waiting for the reading turn, and those it asked. Without these lines the table's
      // own buckets summed to the whole plan less the waiting families, and a reviewer read it as
      // "no family waiting" while the receipt held 156.
      `- withheld by judgment (the reading turn chose not to ask them; each carries its reason on the coverage form): ${withheld.length}`,
      `- awaiting the reading turn's ask: ${awaiting.length}`,
      exec.asked?.length ? `- asked by the reading turn (a waiting family's question, asked by another entry): ${exec.asked.length}` : "",
      exec.unplanned?.length ? `- unplanned qid-stamped blocks: ${exec.unplanned.length}` : "",
      ...(exec.skeleton ?? []).map((s) => {
        const w = withheldOn(s.axis), a = Math.max(0, (s.awaiting ?? 0) - w);
        return `- axis ${s.axis}: ${s.state} (${s.executed}/${s.entries} executed, ${s.crowds} crowd${w ? `, ${w} withheld` : ""}${a ? `, ${a} awaiting` : ""})`;
      }),
    ];
  } catch (e) { rows = [`- (receipt table unavailable — read + audit the receipt file directly: ${P.planExecution})`]; note(`plan-audit receipt table (non-fatal): ${e.message}`); }
  return lines(
    `${PLAN_AUDIT_HEAD} ${PLAN_AUDIT_FRAME[stage] ?? PLAN_AUDIT_FRAME["narrative-refutation"]}`,
    PLAN_AUDIT_CLASSES,
    ...rows,
  );
}

// ── — THE COVERAGE LEDGER, HANDED TO THE SEAT THAT SIGNS THE RUN ──────────────────────────────
//
// The ledger's rows are the other half of "what was searched, and how completely". `skepticDeferralExtra`
// has handed them to the skeptic as a table since the 2026-07-30 addendum, for a reason that applies
// with more force one stage later: the skeptic re-derived the ledger out of a 103 KB prose document,
// spent 28,592 thinking tokens doing it and got it wrong. `synthesis` emits a MANDATORY coverage
// judgment and was never shown the ledger at all — it was told to produce "coverage honesty" over
// material it had to go and find.
//
// This is the ledger half only. The receipt half is `planAuditExtra` above, registered separately for
// the same stage, so a defect in one artifact cannot silently take the other block down with it (the
// composer catches per-builder) and the dispatch receipt records which of the two actually built.
function coverageLedgerExtra(ctx) {
  const P = ctx.paths;
  try {
    const rows = loadCoverageLedger(P.runDir).rows;
    if (!rows.length) return "";
    return lines(
      `COVERAGE LEDGER, DRIVER-COMPUTED — the machine ledger the register funnel wrote (${P.registerCoverageLedger}). These are the rows; do NOT re-derive them from the findings prose, and do not re-type their numbers into yours. The file is yours to read directly, but every row it holds is already below.`,
      "",
      "Coverage ledger (axis | unit | status | reason):",
      ...coverageLedgerTableRows(rows),
      "",
      `A row is `+"`confirmed-clean`"+` only where the funnel says so. A `+"`coverage-limited`"+` or `+"`deferred`"+` row is a slice this run did not close: your coverage judgment weighs it, and nothing anywhere in the opinion states it searched-clean.`,
    );
  } catch (e) { note(`synthesis coverage-ledger block skipped (non-fatal): ${String(e.message).slice(0, 80)}`); return ""; }
}

export async function refute(ctx) {
  // corruption 2 — this used to compose its two driver-computed blocks INLINE, which is how the
  // A/B rig came to run a shorter prompt than the run it compares against. Both blocks are registry
  // builders now (DISPATCH_EXTRA_BUILDERS), and this call site goes through the SAME composer the
  // sandbox uses: `composeDispatchExtra`. One composer means the production dispatch and the arm cannot
  // disagree about which blocks exist — the only way to keep them equal that does not rely on two lists
  // being edited together forever.
  //
  // What the blocks are: B2 feeds the deterministic registry-fidelity check over the NARRATIVE into the
  // reviewer, so a number/date swap (the teal-anvil failure the reviewer passed) is covered by the
  // reasoning review and caught HERE → corrective re-synthesis, not only at pre-delivery. The
  // plan-execution audit hands the reviewer the code-derived receipt of what actually ran.
  // lever 3 — DRIVER SELECTION. The band is on findings.json before this stage runs, so the
  // ordinals to profile are computed here and listed in the dispatch rather than described to the seat.
  // Set on ctx (not passed as an extra) so the verdict-recheck dispatch below carries the same list from
  // the same computation — a recheck that re-derived it could send a different one to the same session.
  //
  // EVERY UNREADABLE STATE RESOLVES TO null = EVERY FINDING: no cut on the row, no findings file, an
  // unparseable one, a manifest with no bands. Wrong toward depth costs time; wrong toward brevity drops
  // work from a report somebody paid for, and the only symptom is a profile nobody asked about missing.
  ctx.profileSelection = reviewProfileSelection(ctx);
  if (ctx.profileSelection.ordinals)
    runLog(ctx.run.runDir, { event: "profile-selection", of: ctx.profileSelection.total,
      selected: ctx.profileSelection.ordinals.length, keyless: ctx.profileSelection.keyless });
  const { text: extra } = composeDispatchExtra("narrative-refutation", ctx);
  const r = await stage("narrative-refutation", ctx, extra ? { extra } : {});
  // — CARRY THE CONDITION OUT. This returned a bare `{ ok: false }`, so the only
  // thing the caller could throw was a sentence about the LADDER, and the recovery classifier was handed
  // "failed after retries + fallback" — which names no provider condition and matches neither lane
  // regex. Measured on a codex test run that died after seventeen hours: every attempt recorded
  // `rate_limited` or `timeout`, both of which recoveryLaneOf reads as WEATHER, and the run was
  // classified `unknown`/`defect` and spent the small budget reserved for its own mistakes.
  if (!r.ok) return { ok: false, fail: r.fail ?? null };
  const verdict = parseVerdict(readFileSync(ctx.paths.seniorEyeReview, "utf8")) ?? "BLOCKING"; // parse-fail ⟹ fail-safe
  return { ok: true, verdict, key: r.sessionKey, model: r.model, thinking: r.thinking };
}

/**
 * A DRAW IS WORK ON THIS BOX, AND THE DEPLOY GUARD HAS TO BE ABLE TO SEE IT.
 *
 * `pipeline()` takes a run slot, so a clearance is visible to `deployRefusal` and an hourly deploy defers
 * over it. A draw is a direct invocation and took nothing, so the guard saw an idle box and a tick could
 * fast-forward the checkout, reinstall and restart the units under a running experiment. Measured in testing:
 * the only thing protecting a replication was somebody stopping the deploy timer by hand,
 * which made that hold load-bearing without anyone having decided it should be.
 *
 * IT TAKES ITS OWN LOCK, NOT A RUN SLOT. A run slot is admission-controlled against
 * `maxConcurrentRuns`, so acquiring one here would make a draw WAIT behind clearances and make clearances
 * wait behind draws — changing what a draw is in order to fix what a guard can see. The `draw` prefix is
 * a separate namespace in the same directory: the deploy guard counts it, and nothing else does.
 *
 * The cap is deliberately far above any real number of concurrent draws, because this lock exists to be
 * SEEN and never to ration. A draw that blocked here would be a new failure mode in place of an old one.
 */
/**
 * Which findings the review is asked to ground in a profile, from the findings, the framework's bands and the depth. Read
 * from the writer's own record while a fold is in force, in the numbering of the narrative the review reads and of the
 * flags it writes (record-fold.mjs).
 */
export const reviewProfileSelection = (ctx) => profileOrdinals({
  findings: safeReadJson(modelRecordPath(ctx.paths.runDir, ctx.paths.findings)),
  bandOrder: ctx.framework?.bands ?? null,
  maxRank: ctx.depth?.profileKeptBandRank ?? null,
});
