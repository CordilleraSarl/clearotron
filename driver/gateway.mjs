// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// gateway.mjs — the STAGE LADDER. One stage's turn, classified, retried, repaired, warm-patched. The
// design linchpin, and the reason every engine can be swapped without touching any of it.
//
// The name is historical and the file is not what it says: it was once the single wrapper around one
// integrator platform's agent CLI, and the compute path moved off that CLI long before the platform
// itself left the product. What remains here is engine-AGNOSTIC — runStage drives an adapter's
// runTurn() (engine/CONTRACT.md §1), and everything below classifies the normalized tuple that comes
// back. Renaming the file is a separate change with its own diff; naming what it is, here, costs
// nothing and stops the next reader looking for a gateway.
import { note } from "./log.mjs";
// — the closed disposition set has ONE author; this file dictates it and must not retype it.
import { isCancelled, readCancel, RunCancelled } from "./cancel.mjs";
import { engineForRun, selectEngine } from "./engine/registry.mjs";
import { timeoutCause, turnFailure } from "./ladder/turn-failure.mjs";
import { modelGauge, servingProgram } from "./ladder/model-gauge.mjs";
import { rescueAndName } from "./ladder/rescue.mjs";
import { nextRung } from "./ladder/next-rung.mjs";
import { stageOf } from "./ladder/stage.mjs";
import { artifactJudgement } from "./ladder/judge.mjs";
import { retryMode, dispatchTurn } from "./ladder/dispatch.mjs";
import { repairFormInDispatch } from "./ladder/form-repair.mjs";
import { measureAttempt, writeAttemptRow, writeAttemptEvent } from "./ladder/attempt-record.mjs";
// ABBREVIATED_VALUE_NOTE is no longer imported: it explained the "…" marker on a value the model
// had to reproduce EXACTLY, and the only messages that rendered one were the connotation arms telling a
// seat to copy a title or a URL. Nothing is copied now, so no connotation hint renders a cut identifier.
// It stays exported by repair-contract.mjs — other families may still need it.
import { abbrev } from "./repair-contract.mjs";
// — the artifact names come from their WRITERS, so the warm-patch branch below carries no second copy
// of either. Each file is written by its receiver and by nothing else.
import { everyToolCallRefused } from "./engine/tool-refusal.mjs";   // one definition, shared with the engine probe
export { everyToolCallRefused };
// The chunk artifact's name shape, IMPORTED from the module that constructs the path — never restated
// here. See TOOL_WRITTEN_PATTERNS below for why this table reads a pattern instead of owning one.
// The frame transport's refusal reader, so a missing plan or note can be told apart from a stage that
// never called its tool — the distinction, which its sibling stage still lacks.
// The supplemental lane's single source (stages.mjs). The import is acyclic — stages.mjs reads
// verify/coverage-ledger/config/framework and never reaches back here.
// The ask contract's enumeration (PURE, node-free — acyclic). The undispatchable hint reads the
// SIBLING ARTIFACT rather than the fail string, because the fail string is cut at 160 chars.
// — the meaning-sweep form and its accumulator. Both PURE and acyclic: connotation-search.mjs
// imports nothing, disposition-union.mjs imports only it, and neither reaches back here.
// The register-axis vocabulary, quoted verbatim into the coverage-form axis hint. ONE source: the same
// constant `rowIsSettled` refuses against, so the hint can never name a set the gate does not accept.
// Acyclic — coverage-ledger.mjs is PURE (no node imports, no driver imports).
import { CORRECTION_ROWS, correctionHint, correctiveMessage, frameDiffUndispatchable, heldSynthesisRecord, patchRows, REPAIR_HINTS, repairTarget, REPLACED_ROWS, requiredFileClause, warmPatchMessage, warmTimeoutMessage } from "./ladder/repair-messages.mjs";
import { attemptOk, draftCarryEligible, killedWhile, retryBackoffMs, spentBudgetCleanly, STREAM_DIGEST_KEEP, streamDigest, streamMeta, tokensPerSec, toolGauge, vetoResumeRuledNone, warmEligible, writeBoundaryOf } from "./ladder/turn-signals.mjs";
import { gradedArtifact, gridLedgerNameFor, isFormClassFail, SAID_BACK_TOKEN_SRC, saidBackOnly, syncCoverageForm, syncDispositionForm, syncPlacementForm, TOOL_WRITTEN_ARTIFACTS, TOOL_WRITTEN_DIRS, TOOL_WRITTEN_PATTERNS, toolWrittenArtifact } from "./ladder/form-sync.mjs";

// ── WHERE THE TURN CAP WENT, because its absence is a decision and not an oversight ──────────────
//
// A cross-process slot lock (CLEAROTRON_TURN_CAP, default 3) used to fence the command lanes of an
// integrator platform's agent gateway: every blocking turn held one lane for its full duration, and
// the 2026-06-12 starvation was three concurrent runs eating all of them. Compute stopped flowing
// through that gateway when the anthropic-agent engine became the default — engines run off-gateway
// and take no lane, laneWaitMs: 0 — which left the cap fencing FOUR comms one-shots and nothing else.
// Those one-shots are now outbox packets, so the cap governed an empty set.
//
// Leaving it in place would have been worse than deleting it: a configured cap and a permanently-zero
// in-use count reads as a working limit. Run parallelism is unaffected and is governed where it always
// was — CLEAROTRON_GATHER_CONCURRENCY x CLEAROTRON_MAX_CONCURRENT_RUNS, and pipeline.acquireRunSlot, which is
// the OTHER user of slot-lock.mjs and is untouched.

// What a settled turn's failure is called lives in ladder/turn-failure.mjs, and what the ladder does after it in
// ladder/next-rung.mjs, both carved out of the stage ladder below; these are re-exported so every importer is unchanged.
export { isEmbeddedFallback, isTimeout, timeoutCause, isLaneWedge, classifyWedge, isOverloaded, attemptTimedOut } from "./ladder/turn-failure.mjs";
export { warmHardWallStop } from "./ladder/next-rung.mjs";
export { CORRECTION_ROWS, correctionHint, correctiveMessage, frameDiffUndispatchable, heldSynthesisRecord, patchRows, repairTarget, REPLACED_ROWS, requiredFileClause, warmPatchMessage, warmTimeoutMessage };   // moved to ladder/repair-messages.mjs; importers read them here as before
export { attemptOk, draftCarryEligible, killedWhile, retryBackoffMs, spentBudgetCleanly, STREAM_DIGEST_KEEP, streamDigest, streamMeta, tokensPerSec, toolGauge, vetoResumeRuledNone, warmEligible, writeBoundaryOf };   // moved to ladder/turn-signals.mjs; importers read them here as before
export { gradedArtifact, gridLedgerNameFor, isFormClassFail, saidBackOnly, syncCoverageForm, syncDispositionForm, syncPlacementForm, TOOL_WRITTEN_ARTIFACTS, TOOL_WRITTEN_DIRS, TOOL_WRITTEN_PATTERNS, toolWrittenArtifact };   // moved to ladder/form-sync.mjs; importers read them here as before

// Under --json, stdout is clean JSON. Be defensive about any stray prefix lines anyway.
export function parseJsonStdout(stdout) {
  const s = (stdout ?? "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  const nl = s.lastIndexOf("\n{");
  if (nl >= 0) { try { return JSON.parse(s.slice(nl + 1)); } catch { /* fall through */ } }
  const br = s.indexOf("{");
  if (br >= 0) { try { return JSON.parse(s.slice(br)); } catch { /* fall through */ } }
  return null;
}

export function payloadText(json) {
  return (json?.result?.payloads ?? []).map((p) => p?.text ?? "").join("\n").trim();
}


// ── Engine seam (CLEAROTRON_AI) ──────────────────────────────────────────────────────────────────
// Which adapters exist and which one this activation runs are engine/registry.mjs's; the gateway asks it
// and names no engine. Re-exported here, so every importer of these names is unchanged.
export { DEFAULT_ENGINE, registeredEngines, registerEngine, selectEngine } from "./engine/registry.mjs";

/**
 * Run ONE pipeline stage as a blocking gateway agent turn, with file-truth gating + bounded retries.
 *
 * Failure taxonomy — none silently passes:
 *   (embedded fallback) | (non-zero/timeout exit) | (unparseable json) | (status != "ok")
 *   | (expectFile missing —) | (expectFile fails its structural validator)
 * Retries run on a FRESH session key (winning-key hardening), with ONE exception: a content failure
 * whose turn completed cleanly and whose reason is warm-allowlisted gets ONE warm patch retry that
 * RESUMES the failed session (see warmEligible below). Timeout/transport failures are always fresh.
 *
 * @returns {{ok:boolean, json?:object, attempts:number, text?:string, fail?:string}}
 */
// ──: ONE CODEX HOME PER STAGE LADDER, NOT PER TURN ────────────────────────────────────────────
//
// codex resolves `resume <thread-id>` against $CODEX_HOME/sessions. The engine used to create and
// delete that directory per TURN, so every warm resume pointed at a home that had never heard of the
// thread. Measured on codex-cli 0.147.0: it does not start fresh, it fails —
// `thread/resume failed: no rollout found for thread id … (code -32600)`, exit 1 — and the control
// (same id, its own home) resumes cleanly.
//
// THE SCOPE IS THE LADDER, NOT THE RUN. The issue proposed a per-RUN home; that is wrong here.
// pipeline.mjs's runBatched dispatches stages at gatherConcurrency, so several ladders are live inside
// one clearance at once, and each renders its own config.toml with its own [mcp_servers] and
// allowedTools. A shared per-run home would have concurrent turns overwriting one another's config —
// one stage served another stage's tools, or a half-written file. A ladder is exactly the unit that
// shares a session chain (lastSessionRef across attempts, repairRef inside one), so it is the unit
// that should share a home.
//
// Anthropic needs none of this: `claude -p --resume` resolves against an ambient store nothing wipes,
// which is precisely why warm resume worked there and not here.
export async function runStage(name, opts) {
  // The run's own engine: the one it recorded when it started, or the machine's for a run with no record.
  const engineForHome = engineForRun(opts?.runDir);
  let stageHome = null;
  if (engineForHome?.makeStageHome) {
    try { stageHome = engineForHome.makeStageHome(name); }
    catch { stageHome = null; }   // fall back to the engine's own per-turn home rather than fail a stage
  }
  try {
    return await runStageLadder(name, opts, stageHome, engineForHome);
  } finally {
    // Deleted when the LADDER settles — every resume that needed it has happened by then. Best-effort:
    // a home we cannot remove must never turn a completed stage into a failure.
    if (stageHome) engineForHome.releaseStageHome(stageHome);
  }
}

async function runStageLadder(name, opts, stageHome = null, engine = selectEngine()) {
  // The stage's options, files, billing and tools, fixed for the ladder (ladder/stage.mjs); every phase below reads them.
  const stage = stageOf(name, opts, stageHome, engine);
  const { model, sessionKey, timeoutSec, maxRetries, runDir } = stage;
  // The artifact judgement, and the forms it last synced, held across attempts (ladder/judge.mjs).
  const judge = artifactJudgement(stage);
  let lastFail;
  // — WHAT ACTUALLY RAN, carried out to the caller. The attempt rows have held the truth all along
  // (`modelActual` from the wire, `modelUsed` from the engine's own resolver); the ladder simply never
  // handed either back, so the stage event upstream had nothing to write but the ASSIGNED alias. On a
  // codex run that made the skim line read `anthropic/claude-sonnet-5` while the attempt milliseconds
  // away said `gpt-5.6-sol`. Both are kept: the wire's word is the truth, the resolver's is the fallback
  // when the stream never stated one, and neither is invented.
  let lastModelWire = null;
  let lastModelUsed = null;
  let lastJson = null;          // the failed attempt's parsed envelope — warm eligibility needs its status
  let lastKey = sessionKey;     // the failed attempt's session key — the warm patch resumes exactly it
  let lastSessionRef = sessionKey;  // the failed attempt's engine sessionRef — anthropic warm-resume (--resume) reuses it
  let lastKillClass = null;     // how the failed attempt's hard-wall kill read (killedWhile): a working one is resumed warm
  const attemptFails = [];      // every failed attempt's `fail` string, in order — the taint chain reads the
                                // winning invocation's ladder (a success AFTER a kill-class attempt is tainted)
  let killSeen = false;         // has ANY attempt in THIS ladder been kill-class (isTaintRow)? One kill closes
                                // the exit-1 rescue for the rest of the ladder — see the rescue block below
  let warmUsed = false;         // one warm attempt max per stage run (mirrors the single extended timeout retry)
  // build 2 — the attempt number escalated to a FRESH dispatch after a warm patch reproduced its
  // own failure byte-for-byte. 0 = never. Because `warm` requires !warmUsed, this can be set at most
  // once per stage run, which is the structural bound on the escalation.
  let warmEscalatedAt = 0;
  //: in-dispatch form repairs spent by this stage run, capped at MAX_FORM_REPAIRS. Per STAGE RUN,
  // not per attempt, so the added spend is bounded no matter how deep the ladder goes. Deliberately
  // SEPARATE from warmUsed: a form repair must not consume the warm attempt a work-class failure is
  // entitled to on attempt 2.
  let formRepairsUsed = 0;
  let attempt = 0;
  // A warm turn that never reached the model costs no rung, once per ladder: WARM_ZERO_USAGE_FREE_RUNGS in ladder/next-rung.mjs.
  let rungsRefunded = 0;
  let timeoutRetriesUsed = 0;   // a slow stage gets ONE longer shot, then we stop (don't burn 3× the budget)
  let effTimeout = timeoutSec;  // bumped ×1.5 for the single timeout retry
  let lastQuantity = null;      //: the settled attempt's progress quantity (null = ABSENT, never zero)
  let lastReads = null;         // AD-4 reads gauge of the settled (last) attempt — rides the failure return
  let lastReadsTruncated = null; // …and whether that gauge was capped (a capped list is not a complete one)
  let lastWarm = null;          // …and whether that attempt was a WARM PATCH (a resumed session is not re-offered
                                // the files, so its gauge cannot ground a `read:false` — see journalStageInputs)
  let lastWrote = null;         // AD-4 emitted-vs-landed of the settled (last) attempt — rides the failure return
  //: the artifact the last refusal was actually ABOUT, when that is not the declared output. ONE
  // source — the same derivation that names the file in the token — so the row and the token can never
  // disagree about which artifact a ladder was fighting over. It persists across attempts on purpose:
  // the attempt that finally PASSES is the one whose sha proves what the ladder bought.
  let lastGraded = null;
  // — the bound grows with the refunds rather than the counter shrinking. Decrementing `attempt`
  // would have made a real attempt 2 report as attempt 1, and every row keyed on that number would then
  // describe a turn that did not happen. The ladder gets another rung; the record keeps its arithmetic.
  while (attempt < maxRetries + 1 + rungsRefunded) {
    attempt++;
    // ── CANCELLATION IS HONOURED HERE ────────────────────────────────────────────────────────────
    // This is the ONLY point both pipelines pass through: the clearance lane reaches runStage via
    // stage → stageWithChain → stageOnce, the knockout lane via koStage. (progress.recordTransition
    // looks like a shared advance point and is not — knockout never calls it, so a check there would
    // miss every knockout run.)
    //
    // INSIDE the attempt loop, not at function entry, because the TURN is the unit of spend: a single
    // stage is up to maxRetries+1 model turns, and a stop pressed during a retry ladder should not have
    // to wait for the ladder to exhaust. Nothing is thrown mid-turn — a dispatched turn always finishes.
    if (isCancelled(runDir)) {
      note(`[${name}] CANCELLED by user — not dispatching attempt ${attempt}`);
      throw new RunCancelled(name, readCancel(runDir));
    }
    // Warm or fresh, and the wait before it; then the turn, with its dispatch record, witness and manuals (ladder/dispatch.mjs).
    const mode = await retryMode(stage, { attempt, lastFail, lastJson, lastKillClass, lastUnion: judge.lastUnion, warmUsed });
    const { vetoedResume, warm, timeoutWarm } = mode;
    warmUsed = mode.warmUsed;
    const { preArtifact, key, dispatch, dispatchedAt, witnessed, wire, turn, settledAt } = await dispatchTurn(stage,
      { attempt, warm, timeoutWarm, vetoedResume, lastFail, lastKey, lastSessionRef, warmEscalatedAt, effTimeout });
    const { code, killed, wall, stderr, json, usage } = turn;

    // What the turn asked for against what the wire reported, and which program served it (ladder/model-gauge.mjs).
    const { modelRequested, modelActual, modelBasis, providerReported, modelSnapshot, famRequested, famActual, modelMismatch } = modelGauge(engine, model, turn);
    const cli = servingProgram();
    if (modelActual) lastModelWire = modelActual;                       // — never overwritten with null

    let fail = null;
    let stampedQuantity = null;   //: a validator's own exact count, when it stamped one (see below)
    let failingFile = null;       //: the artifact the validator rejected — the repair's only target
    // A TURN THAT COMPLETED IS JUDGED ON WHAT IT WROTE, whatever its stderr says about a request inside it
    // (attemptTimedOut). Which signal fired is kept on the row either way.
    const timedOutBy = timeoutCause({ killed, code, wall, stderr, timeoutSec: effTimeout });
    fail = turnFailure({ timedOutBy, code, json, stderr });
    if (fail === null) {
      const j = judge.judgeArtifacts();
      fail = j.fail; stampedQuantity = j.quantity; failingFile = j.file; lastGraded = j.graded ?? lastGraded;
    }

    // A form defect is handed back to the session that wrote it, inside this dispatch (ladder/form-repair.mjs).
    const repaired = await repairFormInDispatch(stage, judge, { attempt, key, turn, effTimeout, fail, stampedQuantity, failingFile,
      formRepairsUsed, killSeen, lastGraded, lastModelUsed });
    const { formRepairsThisAttempt } = repaired;
    ({ fail, stampedQuantity, failingFile, formRepairsUsed, killSeen, lastGraded, lastModelUsed } = repaired);
    // Whether this attempt's own artifacts answer its failure, and the name the failure then goes by (ladder/rescue.mjs).
    const rescue = rescueAndName(stage, judge, { fail, turn, preArtifact, dispatchedAt, settledAt, killSeen,
      modelMismatch, famRequested, famActual, modelRequested, modelActual });
    const { killClass, attemptKilledWhile } = rescue;
    ({ fail, killSeen } = rescue);
    // What this attempt wrote, read and still owes, and its draft kept when it is the best so far (ladder/attempt-record.mjs).
    const { wrote, reads, readsTruncated, quantity, noChange } = measureAttempt(stage, { attempt, key, warm, turn, preArtifact, fail,
      stampedQuantity, failingFile, killClass, killSeen, attemptFails });
    lastWrote = wrote;
    lastReads = reads;
    lastReadsTruncated = readsTruncated;
    lastWarm = warm;

    if (runDir) {
      // The attempt's row in the stage's own log, then its event on the run's spine (ladder/attempt-record.mjs).
      const facts = { ...rescue, attempt, key, warm, warmEscalatedAt, effTimeout, dispatch, witnessed, wire, turn, cli, modelRequested,
        modelActual, modelBasis, modelSnapshot, modelMismatch, providerReported, timedOutBy, fail, formRepairsThisAttempt, lastGraded,
        wrote, reads, readsTruncated, quantity, noChange };
      writeAttemptRow(stage, judge, facts);
      writeAttemptEvent(stage, facts);
    }

    // sessionKey = the key that actually SUCCEEDED (attempt 1 = base key; a retry = `${base}-rerunN`). Callers
    // that re-run a stage as a follow-up pass THIS key, so the follow-up's records sit beside the attempt that
    // won (winning-key hardening). No engine resumes by key: resumeRef is the only continuity a turn has.
    if (!fail) return { ok: true, json, attempts: attempt, modelWire: lastModelWire, modelUsed: lastModelUsed, text: payloadText(json), sessionKey: key, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    attemptFails.push(fail);
    lastFail = fail;
    lastJson = json;
    lastKey = key;
    lastQuantity = quantity;   //: rides the ladder's final return, so the run-level catch stamps the exact count
    lastSessionRef = turn.sessionRef ?? lastSessionRef;   // anthropic warm-resume target for the next attempt
    lastKillClass = attemptKilledWhile;
    note(`[${name}] attempt ${attempt} FAILED: ${fail}${quantity === null ? "" : ` (count ${quantity}${noChange ? ", unchanged" : ""})`}`);

    // What the ladder does next after this failure — escalate, retry, break, or return — is ladder/next-rung.mjs.
    const next = nextRung({ fail, warm, attempt, maxRetries, attemptFails, usage, json, turn, signals: turn.signals, runDir, name, timeoutSec,
      saidBackOpen: SAID_BACK_OPEN_RE.test(fail), warmEscalatedAt, rungsRefunded, timeoutRetriesUsed, effTimeout });
    ({ warmEscalatedAt, rungsRefunded, timeoutRetriesUsed, effTimeout } = next);
    if (next.rung === "identical") return { ok: false, attempts: attempt, fail, sessionKey: key, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], identicalSignature: true, warmEscalated: warmEscalatedAt > 0 || undefined, quantity, noChange, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    if (next.rung === "rate-limited") return { ok: false, attempts: attempt, fail, resetsAt: turn.signals?.resetsAt, sessionKey: key, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], quantity, noChange, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    if (next.rung === "break") break;
  }
  // A SAID-BACK REFUSAL NEVER WITHHOLDS THE REPORT (reports always ship, ruled 2026-08-27). The placement form's
  // refusals refuse the pass so that a corrective turn carries them to the step, which is the only way back to it
  // within a pass (verify.mjs, placementSaidBackVerdict). They are the stage's last check, so a pass whose attempts
  // run out on one has passed every other, and stands: an open floor is recorded by the floor duty and named at
  // delivery; any other refusal is kept in the attempt record.
  if (SAID_BACK_OPEN_RE.test(lastFail ?? "")) {
    note(`[${name}] ${abbrev(String(lastFail), 160)} — still open when the attempts ran out: the pass stands; an open floor is recorded by the floor duty and named at delivery, and any other refusal is kept in the attempt record`);
    return { ok: true, json: lastJson, attempts: attempt, modelWire: lastModelWire, modelUsed: lastModelUsed, text: payloadText(lastJson), sessionKey: lastKey, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, reads: lastReads, readsTruncated: lastReadsTruncated, warm: lastWarm, wrote: lastWrote, formRepairs: formRepairsUsed, saidBackOpen: lastFail };
  }
  // sessionKey on FAILURE = the last attempted key (lastKey) — callers that recover terminally (e.g. the
  // WS-A coverage-ledger quarantine) need a session to attribute/resume; it is best-effort, not a winner.
  return { ok: false, attempts: attempt, fail: lastFail, sessionKey: lastKey, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, quantity: lastQuantity, reads: lastReads, readsTruncated: lastReadsTruncated, warm: lastWarm, wrote: lastWrote, formRepairs: formRepairsUsed };
}

/** The code of the repair hint a failure string selects, or null when it gets the default. PURE. */
export function failureCode(lastFail) {   // @internal — driven by its test
  return REPAIR_HINTS.find((row) => row.when.test(lastFail))?.code ?? null;
}

/** Every row's code, in the order the rows are read. */
export const REPAIR_HINT_CODES = Object.freeze(REPAIR_HINTS.map((row) => row.code));   // @internal — driven by its test
const SAID_BACK_OPEN_RE = new RegExp(`^invalid_file:.*?:${SAID_BACK_TOKEN_SRC}`);

