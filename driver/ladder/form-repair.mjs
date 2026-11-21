// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// form-repair.mjs — a form defect handed back to the session that wrote it, inside the same dispatch.
//
// The stage ladder (gateway.mjs runStageLadder) asks this once a turn has been judged (judge.mjs) and before the
// rescues (rescue.mjs). A form-class failure gets up to MAX_FORM_REPAIRS repair turns per stage run, each resuming the
// session with the warm patch message; each is journalled, and the attempt's failure is what the last one left.

import { envGateOn } from "../driver.config.mjs";
import { stageLog, runLog, note, outputMeta } from "../log.mjs";
import { isCancelled } from "../cancel.mjs";
import { modelIdOf } from "../engine/registry.mjs";
import { profilesStoreDir } from "../profiles.mjs";
import { isTaintRow } from "../register-taint.mjs";
import { recordDispatch, streamFilePath } from "../dispatch-record.mjs";
import { endingFields } from "../engine/session-record.mjs";
import { statOf, gradedFormMeta } from "./judge.mjs";
import { isFormClassFail, MAX_FORM_REPAIRS } from "./form-sync.mjs";
import { repairTarget, warmPatchMessage } from "./repair-messages.mjs";
import { rel, streamDigest, streamMeta, tokensPerSec, writeBoundaryOf } from "./turn-signals.mjs";

export async function repairFormInDispatch(stage, { judgeArtifacts }, { attempt, key, turn, effTimeout, fail, stampedQuantity, failingFile,
  formRepairsUsed, killSeen, lastGraded, lastModelUsed }) {
  const { name, engine, stageHome, agent, model, thinking, files, runDir, stallSec, adds, supplementalLane, auth, gatherAllowedTools,
    gatherSeatWrites, engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill, turnConfig } = stage;
  const { json } = turn;
  // ── — WRITE-TIME FORM REJECTION, INSIDE THE DISPATCH ────────────────────────────────────
  // In the 08-02 round, 5 of 12 non-clean dispatches were PURE FORM: a bad enum, a closed-vocabulary
  // string twice, an undispatchable wildcard. Each burned a full paid dispatch — a fresh model call
  // and minutes of wall-clock — to discover something the contract already knew by name. The contract
  // is unchanged (see FORM_CLASS_RE); what moves is WHEN it is answered. A form defect is handed back
  // to the SAME session that wrote it, with the SAME warmPatchMessage the attempt-2 warm retry would
  // have carried, before this dispatch settles — so the retry ladder is never charged for it and its
  // attempts stay available for the failures that actually need another pass.
  //
  // WHAT THIS DELIBERATELY DOES NOT TOUCH — a work-class failure behaves exactly as it does today.
  // It is not form-class, so it never enters this loop; `warmUsed` is NOT consumed here, so a work
  // failure that reaches the ladder still gets its warm attempt 2 (the connotation tokens are
  // warm-eligible by an explicit 2026-08-01 ruling, and a form fix must not quietly revoke it).
  //
  // ZERO SEMANTICS — the three ways this could read an absence as a pass, and how each is closed:
  //   1. A repair turn that WRITES NOTHING. Re-judging byte-identical bytes would either "confirm"
  //      the same failure (harmless but wasteful) or, if the validator were ever non-deterministic,
  //      manufacture a pass out of the harness's own silence. So the TARGET file's stat is the gate:
  //      unchanged (or gone) ⇒ NOT repaired, the ORIGINAL fail stands, and the ladder gets it. The
  //      target is what the repair MESSAGE names (repairTarget) — usually a sibling, not the
  //      expectFile — because watching the wrong file turns a correct repair into a false "no-write".
  //   2. A repair turn that was KILLED. Its bytes may be torn mid-write and a shape validator cannot
  //      prove otherwise, so it is never re-judged, and its kill arms killSeen for the rest of the
  //      ladder — the same refusal the exit-1 rescue makes below.
  //   3. A form failure this list does not recognise. It never enters the loop at all and reaches the
  //      ladder as a work-class failure would — visibly, never swallowed as "validated fine".
  // Cancellation is honoured by SKIPPING the repair (the turn is the unit of spend): the loop top
  // above throws RunCancelled on the next attempt, so no new throw site is introduced here.
  let formRepairsThisAttempt = 0;
  let repairRef = turn.sessionRef;
  while (fail && failingFile && isFormClassFail(fail)
         && formRepairsUsed < MAX_FORM_REPAIRS
         && envGateOn("CLEAROTRON_FORM_REPAIR")
         // A6: an output-ceiling turn's defect is caused by the budget, not by the vocabulary — it
         // keeps its named fault and its own policy below.
         && json?.stopReason !== "max_tokens"
         && !isCancelled(runDir)) {
    formRepairsUsed++; formRepairsThisAttempt++;
    const triggeredBy = fail;
    // THE FILE THE REPAIR MESSAGE ACTUALLY AIMS AT — not necessarily the rejected expectFile. Every
    // framediff_/coverage_ token routes its repair to a SIBLING (frame-diff.json,
    // register-coverage-ledger.json) and tells the model NOT to touch the .md, so watching the .md
    // would read a compliant model's correct answer as "wrote nothing". repairTarget is the same
    // derivation warmPatchMessage uses to compose the instruction — one rule, two readers.
    const target = repairTarget(triggeredBy, files);
    const targetPre = statOf(target);
    const repairPre = new Map(files.map((f) => [f, statOf(f)]));
    note(`[${name}] FORM defect at write time (${triggeredBy.slice(0, 140)}) — repairing INSIDE this dispatch (${formRepairsUsed}/${MAX_FORM_REPAIRS}) at ${rel(target)}; the retry ladder is not charged`);
    //: a form repair is a real model invocation, so it gets its own record rather than hiding
    // inside the attempt it belongs to. Hoisted only to be recordable — the message is unchanged.
    const repairMessage = warmPatchMessage(triggeredBy, files, { supplementalLane, adds });
    const repairDispatch = envGateOn("CLEAROTRON_DISPATCH_RECORD")
      ? recordDispatch(runDir, name, { attempt, repair: formRepairsUsed + 1, kind: "form-repair", message: repairMessage })
      : null;
    // — `seatWrites` IS DELIBERATELY NOT PASSED HERE, and the omission is the decision. A form
    // repair exists precisely because a file came out malformed and the seat is being told to go fix
    // it at `target`, so this turn authors a file whatever the stage's steady-state row says. Omitting
    // the declaration leaves it `null` — unknown — and unknown keeps the grant, which is the answer
    // this turn wants. Passing `gatherSeatWrites` would lean on the dispatch naming an ABSOLUTE path
    // under the run dir to win the grant back, and warmPatchMessage renders the target through rel();
    // a relative path there would silently strip the write root off the one turn that needs it most.
    // — AND THE OUTPUT RULE IS THE STAGE'S, for the one engine that reads one per turn. A recording stage's form repair is a
    // record call, so a Codex turn keeps that stage's rule (openai-agent.mjs, codexDeveloperInstructions). A signal only that
    // adapter reads, from the same declaration, so the grant decided above is not touched.
    const rt = await engine.runTurn({ agent, sessionKey: key, message: repairMessage, model, thinking, recordsItsResult: gatherSeatWrites === false,
      timeoutSec: effTimeout, resumeRef: repairRef, stageHome, mcpConfig: turnConfig(effTimeout), allowedTools: gatherAllowedTools,
      skillsDir: engineSkillsDir, skillsGrantRoots: engineSkillsGrantRoots, profilesDir: profilesStoreDir, resolveSkill: engineResolveSkill, runDir, stallSec,
      progressFiles: files, streamFile: streamFilePath(runDir, name, attempt, formRepairsUsed + 1) });
    repairRef = rt.sessionRef ?? repairRef;
    // A KILLED REPAIR TURN'S BYTES ARE NOT STAGE TRUTH. Same doctrine as the exit-1 rescue below: a
    // stage validator is a SHAPE check, not a completeness proof, and a torn draft can pass its own
    // validator — so a repair turn that was killed (or exited nonzero, or came back with a non-ok
    // envelope) never gets re-judged. Its kill also ARMS killSeen, which closes the exit-1 rescue for
    // the rest of this ladder exactly as an attempt's kill would.
    const repairKill = isTaintRow({ fail: null, code: rt.code, killed: rt.killed, signals: rt.signals });
    if (repairKill) killSeen = true;
    const repairSettled = !repairKill && rt.code === 0 && rt.json?.status === "ok";
    // Did the TARGET file change and still exist? That, and nothing else, decides whether a repair
    // happened. Deleting it is not a repair either.
    const nowStat = statOf(target);
    const landed = repairSettled && nowStat !== null && nowStat !== targetPre;
    let outcome;
    if (!repairSettled) {
      outcome = repairKill ? "killed" : "unsettled";
    } else if (!landed) {
      outcome = "no-write";
    } else {
      const j = judgeArtifacts();
      if (j.fail === triggeredBy) outcome = "unchanged";      // wrote, reproduced its own failure byte-for-byte
      else { fail = j.fail; stampedQuantity = j.quantity; failingFile = j.file; lastGraded = j.graded ?? lastGraded; outcome = fail ? "moved" : "repaired"; }
    }
    if (runDir) {
      // A repair turn is a real model invocation and is journalled as one — same {model, usage}
      // shape every dispatch row carries, so tokens.mjs and run-economics.mjs count its spend
      // honestly. It is NOT an attempt row: `repair` names the row's class, and its `fail` is the
      // defect this turn was dispatched to FIX, never the attempt's settled outcome. Written BEFORE
      // the attempt row below, which is both chronologically true and what keeps the attempt row the
      // last line of the stage's telemetry (compare.mjs reads exactly that line).
      stageLog(runDir, name, {
        attempt, key, agent, model,
        modelUsed: (lastModelUsed = modelIdOf(engine, model)),
        // Same billing stamp as the attempt row, written on the same terms — see the note there.
        engine: engine.name, writeBoundary: writeBoundaryOf(engine), authMode: auth.mode, apiBilled: auth.apiBilled === true, cloud: auth.cloud ?? null,
        code: rt.code, wall: rt.wall, timeoutSec: effTimeout,
        // — same rename as the attempt row above. This row already carries the driver's verdict as
        // `repairOutcome` (only "repaired" is success), so it needs no `ok`; what it lacked was any mark
        // that the engine had claimed otherwise.
        engineStatus: rt.json?.status,
        repair: formRepairsUsed, repairOf: MAX_FORM_REPAIRS, repairOutcome: outcome, fail: triggeredBy,
        repairTarget: rel(target),   // the file the repair was AIMED at (often a sibling, not the expectFile)
        dispatch: repairDispatch,    // — the verbatim message this repair turn was given
        stopReason: rt.json?.stopReason ?? undefined, ...endingFields(rt.json),   // — and what ended it, in the program's words on an error
        killed: rt.killed || undefined, signals: rt.signals ?? undefined,
        session: rt.session ?? null, stream: streamMeta(runDir, rt.stream),   // — the repair session's own record, as on the attempt row
        warm: true,   // a repair turn always RESUMES the session that wrote the defect
        runId: rt.json?.runId, engineSummary: rt.json?.summary, usage: rt.usage,
        selfReportContradicted: (outcome !== "repaired" && rt.json?.status === "ok") || undefined,   //
        // — a repair turn is a real model invocation and run-economics counts it as a dispatch.
        // Skipping it here would leave retry-waste rows as the only dispatches with no rate.
        tokensPerSec: tokensPerSec(rt.usage, rt.wall),
        output: files.length ? outputMeta(files[0]) : null,
        form: gradedFormMeta(lastGraded) ?? undefined,   // — see the attempt row
        // `wrote` keeps its house meaning (did THIS turn move ANY expected artifact); `repairLanded`
        // is the narrower fact the decision above was actually made on.
        //
        // NULL WHEN THERE IS NOTHING EXPECTED, EXACTLY AS THE ATTEMPT ROW DOES IT. A stage
        // declaring no expected artifact leaves `files` empty, and `[].some()` is `false` — so this row
        // used to answer "this turn wrote nothing" where the attempt row answers "there was nothing to
        // write". Two producers of one field, two units for the empty case, and the reader is
        // `run-economics.mjs`: `if (rec.wrote === false) st.emittedOnDispatchesThatWroteNothing +=
        // cls.output`. Every repair turn on such a stage billed its whole output to a waste counter.
        // The `output:` line above already guards the same emptiness on the same row.
        wrote: files.length ? files.some((f) => statOf(f) !== repairPre.get(f)) : null,
        repairLanded: landed,
        reads: Array.isArray(rt.reads) ? rt.reads : null,
        readsTruncated: Array.isArray(rt.reads) ? rt.readsTruncated === true : null,
        stderrTail: streamDigest(rt.stderr),
      });
      try {
        runLog(runDir, {
          event: "form-repair", stage: name, attempt, repair: formRepairsUsed, of: MAX_FORM_REPAIRS,
          fail: triggeredBy, outcome, landed, ok: outcome === "repaired",
          model: modelIdOf(engine, model),
        });
      } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
    }
    note(`[${name}] in-dispatch form repair ${formRepairsUsed}: ${outcome}${outcome === "moved" ? ` → ${String(fail).slice(0, 140)}` : ""}`);
    // Every stop below means "another repair turn cannot converge, or must not be trusted": the turn
    // did not settle cleanly, it wrote nothing, or it reproduced its own failure byte-for-byte (the A4
    // doctrine, applied inside the dispatch). In all three the ORIGINAL fail goes to the ladder.
    if (outcome !== "moved") break;
  }
  return { fail, stampedQuantity, failingFile, formRepairsThisAttempt, formRepairsUsed, killSeen, lastGraded, lastModelUsed };
}
