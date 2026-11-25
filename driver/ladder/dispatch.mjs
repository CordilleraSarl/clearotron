// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// dispatch.mjs — how an attempt goes out: warm or fresh, after what wait, with which message, and the turn itself.
//
// The stage ladder (gateway.mjs runStageLadder) asks retryMode at the top of every attempt and then dispatchTurn,
// which records the message before the turn is told it, witnesses the methodology it reads, inlines its manuals and
// runs it on the engine. What the turn hands back is judged after (judge.mjs, form-repair.mjs, rescue.mjs).

import { envGateOn } from "../driver.config.mjs";
import { runLog, note } from "../log.mjs";
import { frozenSnapshot, describeDrift } from "../run-integrity.mjs";   // — the frozen judged-by set across a seat turn
// The profiles STORE root, for the write boundary only — read from the module that owns it, never
// re-derived from CLEAROTRON_CUSTOMERS_DIR here. Acyclic: profiles.mjs imports node builtins + config.
import { profilesStoreDir } from "../profiles.mjs";
import { recordDispatch, streamFilePath } from "../dispatch-record.mjs";
import { witnessStageMethodology, describeMethodologyDrift } from "../methodology-witness.mjs";
import { inlineManuals } from "../manuals-inline.mjs";
import { builtinToolsFor } from "../engine/mcp/gather-config.mjs";
import { statOf } from "./judge.mjs";
import { recordEngineAnswered, turnAnswered } from "../engine/health.mjs";   // a completed turn moves the engine check's clock
import { correctiveMessage, warmPatchMessage, warmTimeoutMessage } from "./repair-messages.mjs";
import { retryBackoffMs, sleep, vetoResumeRuledNone, warmEligible } from "./turn-signals.mjs";

export async function retryMode({ name }, { attempt, lastFail, lastJson, lastKillClass, lastUnion, warmUsed }) {
  // Warm patch retry: resume the COMPLETED failed session with only the fix instruction (see design note
  // above warmEligible). Otherwise: fresh key + full corrective message (Fix B), exactly as before.
  // — the warm patch is VETOED, not de-allowlisted, and the veto keys on the DIRECT STATE:
  // the run's own counted rulings (lastUnion, counted by the gate's isRuled), never a failure-token
  // name. The connotation family stays in WARM_ELIGIBLE_RE because that allowlist decides two other
  // things: which file a repair is aimed at and whether a rejected draft may be carried across a
  // recovery park (draftCarryEligible). See vetoResumeRuledNone for the condition and its riders.
  //
  // `warmUsed` is NOT consumed here. A vetoed resume skips ITS warm patch and does not spend the
  // lane: if attempt 2 comes back with rows ruled (`call_partial` — a seat that has now recorded
  // rulings), attempt 3 can still warm, which is the case warm is good at.
  const vetoedResume = vetoResumeRuledNone(attempt, lastUnion);
  // A TURN STOPPED AT ITS HARD WALL WHILE STILL WORKING IS RESUMED, NOT RESTARTED. Its single extended retry (ladder/next-rung.mjs)
  // continues the same session with the message design wrote, so an hour of work is not done again; a kill that was silent, or
  // was only making its own record write, is retried fresh as before. The classification is killedWhile, below.
  const timeoutResume = lastFail === "timeout" && lastKillClass === "working";
  const warm = attempt > 1 && !warmUsed && process.env.CLEAROTRON_WARM_RETRY !== "0" && (timeoutResume || (!vetoedResume && warmEligible(lastFail, lastJson)));
  const timeoutWarm = warm && timeoutResume;
  if (warm) warmUsed = true;
  else if (vetoedResume && !warmUsed && process.env.CLEAROTRON_WARM_RETRY !== "0" && warmEligible(lastFail, lastJson))
    note(`[${name}] attempt ${attempt - 1} left this stage's meaning population with ZERO ruled rows (${String(lastFail).slice(0, 100)}) — a resumed session re-reads its own output and cannot rule what it did not rule; SKIPPING the warm patch and dispatching attempt ${attempt} FRESH (the warm attempt is not spent: a partial failure later in this ladder still gets it)`);
  // D3: inter-attempt backoff (see retryBackoffMs) — a retry dispatched the same second it failed
  // tends to re-hit the same still-booting gateway / still-overloaded provider. Attempt 1 never waits.
  // NOT WHEN THE TURN FINISHED AND ONLY THE VALIDATOR REFUSED IT: nothing in the environment failed, so
  // the wait buys nothing and costs the stage its length on the critical path. Known positively, by the
  // predicate the warm patch already uses (the turn's status ok, a validator refusal); a spawn,
  // transport or kill failure still waits.
  if (attempt > 1) {
    const validatorOnly = warmEligible(lastFail, lastJson);
    const backoff = validatorOnly ? 0 : retryBackoffMs();
    if (validatorOnly) note(`[${name}] no retry backoff before attempt ${attempt}: attempt ${attempt - 1} finished and only the validator refused it`);
    else if (backoff > 0) { note(`[${name}] retry backoff ${backoff}ms before attempt ${attempt}`); await sleep(backoff); }
  }
  return { vetoedResume, warm, timeoutWarm, warmUsed };
}

export async function dispatchTurn(stage, { attempt, warm, timeoutWarm, vetoedResume, lastFail, lastKey, lastSessionRef, warmEscalatedAt, effTimeout }) {
  const { name, engine, stageHome, agent, message, refreshMessage, model, thinking, sessionKey, stallSec, files, maxRetries, runDir, followup, adds,
    supplementalLane, gatherAllowedTools, gatherSeatWrites, turnOutput, engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill, turnConfig } = stage;
  // Snapshot each expected artifact at THIS attempt's start. TWO readers, one base — so they can never
  // disagree about what this dispatch emitted:
  //   · AD-4 emitted-vs-landed telemetry — `wrote` says whether this dispatch WROTE its artifact, as
  //     distinct from the artifact merely EXISTING afterwards (landed — possibly inherited, possibly an
  //     earlier attempt's);
  //   · the exit-1 rescue below — freshness against THIS attempt's start, never the ladder's start
  //     (post-merge audit 2; the one-shot pre-ladder snapshot this replaces let attempt 1's kill-torn
  //     partial read as attempt 2's own fresh write).
  // Position is safe: nothing between here and the dispatch touches `files` (the methodology witness
  // writes only its own _driver sidecar).
  const preArtifact = new Map(files.map((f) => [f, statOf(f)]));
  const key = attempt === 1 ? sessionKey : warm ? lastKey : `${sessionKey}-rerun${attempt - 1}`;
  // — THE BASE, RECOMPOSED IF THE STAGE ASKED FOR IT. Only on the fresh-session arm: a WARM patch
  // resumes the session that already holds the full text, so re-presenting a shorter list there would
  // describe a context the seat is not in. A hard-wall kill is never warm — `warmEligible` requires
  // `json?.status === "ok"` and a killed turn has none — so the arm that matters is this one.
  //
  // NEVER-KILL: a refresh that throws costs the base, never the attempt. A stage that cannot recompute
  // its own text must still dispatch the text it started with.
  let base = message;
  if (!warm && typeof refreshMessage === "function") {
    try { const fresh = refreshMessage(attempt); if (typeof fresh === "string" && fresh) base = fresh; }
    catch (e) { note(`[${name}] refreshMessage failed on attempt ${attempt}, dispatching the original text: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  const effMessage = timeoutWarm ? warmTimeoutMessage(files) : warm ? warmPatchMessage(lastFail, files, { supplementalLane, adds }) : correctiveMessage(base, attempt, lastFail, files, { supplementalLane, adds });
  note(`[${name}] attempt ${attempt}/${maxRetries + 1}${timeoutWarm ? " [warm resume: the timed-out turn was still working]" : warm ? " [warm patch]" : ""} (engine=${engine.name} agent=${agent} model=${model ?? "default"} key=${key} timeout=${effTimeout}s)`);
  // The engine runs ONE turn and returns the normalized tuple. Every adapter returns the same shape
  // (zero change); anthropic-agent = claude -p off-gateway with the stall-watchdog. A warm retry threads
  // the prior attempt's sessionRef so the engine resumes the SAME session (anthropic: via
  // --resume <session_id>, keeping the prompt cache warm). usage is destructured so the
  // cost telemetry below AND the lane-wedge check (isLaneWedge) read the same value.
  // WITNESS the methodology this turn is about to read, immediately before it reads it — same resolver,
  // same message, so what is recorded is what the engine resolves and not a re-derivation that could
  // disagree. Recording only: it freezes nothing, gates nothing, and can never fail a turn (see
  // methodology-witness.mjs). Silent in the normal case; a line only when a document MOVED under a run.
  // — WHAT THIS TURN WAS TOLD, written BEFORE it is told it. A turn that is walled, stalled or
  // SIGKILLed is exactly the turn whose prompt someone will want, and a record written afterwards is
  // the record that is missing then.
  //
  // DEFAULT ON, via envGateOn — deliberately NOT the CLEAROTRON_DUMP_JSON pattern a few lines below, which
  // is default-off. A flag that has to be remembered before the interesting run will not be set on the
  // interesting run, which is the whole shape of this defect. The kill switch exists for one case: a
  // pool filesystem under pressure, where the house rule is already `df -h /` before an unattended run.
  //
  // It is the PRE-IMAGE, not the wire bytes: the engine localizes skill refs at spawn, and
  // _driver/methodology-read.json carries that resolution. Two records, two questions.
  const dispatch = envGateOn("CLEAROTRON_DISPATCH_RECORD")
    ? recordDispatch(runDir, name, {
      attempt,
      kind: timeoutWarm ? "warm-timeout" : warm ? "warm-patch" : followup ? "followup" : attempt === warmEscalatedAt ? "fresh-escalation" : vetoedResume ? "fresh-total-defect" : attempt > 1 ? "corrective" : "fresh",
      message: effMessage,
      // — THE RESOLVED GRANT, recorded beside the sha of the message it went out with. This is
      // the value handed to `engine.runTurn` below as `allowedTools`, not a re-derivation of it: a
      // second computation of what a stage was granted could disagree with what it WAS granted, and a
      // record that disagrees with the run is worse than no record. `undefined` here is a tool-free
      // judgment stage, which recordDispatch writes as an explicit `[]`.
      grant: gatherAllowedTools,
    })
    : null;
  // The start of this attempt's window in the per-run refusal journals. Taken before the witness and
  // the snapshot, which only widens the window by their own time: an earlier attempt's refusals all
  // precede its own settle, so they stay outside it.
  const dispatchedAt = Date.now();
  const mcpConfig = turnConfig(effTimeout);   // this turn's copy, with its time to stop sending
  const witnessed = witnessStageMethodology(runDir, name, effMessage, engineResolveSkill);
  for (const line of describeMethodologyDrift(witnessed)) note(`[${name}] ${line}`);
  // — the frozen judged-by set, hashed into THIS PROCESS'S MEMORY before the seat runs. Never
  // written to disk before the comparison, so the thing being watched cannot reach it. See
  // run-integrity.mjs for why it is not a manifest file and why the append-only journals are excluded.
  const integrityBefore = frozenSnapshot(runDir);
  // THE STAGE'S MANUALS RIDE A FRESH SESSION'S OPENING MESSAGE (manuals-inline.mjs), for both engines alike. A resumed session
  // already holds them, and its message names none. The dispatch record and the witness above keep the composed text.
  const wire = warm || timeoutWarm ? { text: effMessage, inlined: [], missing: [] }
    : inlineManuals(effMessage, { resolve: engineResolveSkill, skillsDir: engineSkillsDir });
  const turn = await engine.runTurn({ agent, sessionKey: key, message: wire.text, grantDispatch: base, model, thinking, timeoutSec: effTimeout, resumeRef: warm ? lastSessionRef : undefined, stageHome, mcpConfig, allowedTools: gatherAllowedTools, builtinTools: builtinToolsFor(name), output: turnOutput, seatWrites: gatherSeatWrites, skillsDir: engineSkillsDir, skillsGrantRoots: engineSkillsGrantRoots, profilesDir: profilesStoreDir, resolveSkill: engineResolveSkill, runDir, stallSec,
    progressFiles: files,   // the no-progress watchdog's artifact-advance signal (anthropic-agent; other adapters ignore it)
    // The raw stream of this session, beside its dispatch record (engine/session-record.mjs). The engines
    // keep it while the disk has room and say on the tuple's `stream` what landed.
    streamFile: streamFilePath(runDir, name, attempt) });
  const settledAt = Date.now();   //: zero point of the wall-rescue quiescence clock, read before anything else
  if (turnAnswered(turn)) recordEngineAnswered(engine.name);
  // LOG-ONLY. Nothing here can fail a turn: the claim that the frozen set does not change across a seat
  // turn is READ from the writers' call sites and not yet MEASURED on a running system, and arming an
  // unmeasured guard is the defect class this exists to catch. One run supplies the number; the row's
  // own `armed: false` says so to anyone who meets a "would-fault" verdict in the log.
  try {
    const drift = describeDrift(name, integrityBefore, frozenSnapshot(runDir));
    if (drift) runLog(runDir, drift);
  } catch { /* an integrity check that fails a run by failing itself is worse than no check */ }
  return { preArtifact, key, dispatch, dispatchedAt, witnessed, wire, turn, settledAt };
}
