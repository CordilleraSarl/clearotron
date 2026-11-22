// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// attempt-record.mjs — what one attempt wrote, read and still owes, and the two records of it.
//
// The stage ladder (gateway.mjs runStageLadder) asks measureAttempt once the attempt's failure is named (rescue.mjs),
// then writes the attempt's row in the stage's own log and its event on the run's spine. All of it records; nothing
// here breaks, parks or retries.

import { writeFileSync } from "node:fs";
import { driverDir } from "../run-record.mjs";
import { envOn } from "../driver.config.mjs";
import { stageLog, runLog, note, outputMeta } from "../log.mjs";
import { endingFields } from "../engine/session-record.mjs";
import { recordBestDraft } from "../best-draft.mjs";
//: the allowlisted progress-quantity extractor. Acyclic — repairs.mjs imports node builtins only
// (fs/crypto/path). Used only when the validator did not stamp its own count; never a digit hunt.
import { progressQuantity } from "../repairs.mjs";
import { measureManualsSeen } from "../manuals-seen.mjs";
import { statOf, gradedFormMeta } from "./judge.mjs";
import { attemptOk, draftCarryEligible, spentBudgetCleanly, streamDigest, streamMeta, tokensPerSec, toolGauge, writeBoundaryOf } from "./turn-signals.mjs";

export function measureAttempt({ name, files, runDir }, { attempt, key, warm, turn, preArtifact, fail, stampedQuantity, failingFile, killClass,
  killSeen, attemptFails }) {
  // AD-4 house rule — both computed UNCONDITIONALLY, three-valued on purpose:
  //   wrote: did THIS attempt move any expected artifact? true/false when the stage has expected files,
  //          null when it has none (nothing to emit — distinct from "did not write").
  //   reads: the turn's reads gauge; [] = ran and read nothing, null = this engine cannot observe reads.
  //   readsTruncated: whether that list is COMPLETE. An engine that caps its gauge (anthropic-agent stops
  //          at 500 distinct paths) hands back a list that reads as exhaustive when it is a prefix — so a
  //          `read:false` derived from it would be manufactured. null when there is no gauge to truncate.
  //   warm: whether THIS attempt was a warm patch. A warm patch resumes the failed session with only the
  //          fix instruction — the declared inputs are not re-offered, so the turn opening nothing is the
  //          normal warm-resume shape, not evidence it ignored them. Journalled on the attempt row already;
  //          it rides the return tuple so the stage row's `read` flags can honour it (post-merge audit N1).
  // `wrote` and the exit-1 rescue's freshness test read the SAME per-attempt snapshot (preArtifact), so a
  // rescued row can never carry wrote:false, and a failed row's wrote:true is the mid-write/taint shape.
  const wrote = files.length ? files.some((f) => statOf(f) !== preArtifact.get(f)) : null;
  const reads = Array.isArray(turn.reads) ? turn.reads : null;
  const readsTruncated = reads === null ? null : turn.readsTruncated === true;

  // — the convergence ledger. Two facts the attempt row never carried:
  //   quantity: how many of the thing are STILL wrong ("9 meaning receipts undisposed"), as a NUMBER,
  //     taken from the UNTRUNCATED fail string — the validator's own count where it stamped one, the
  //     allowlisted text extraction otherwise (repairs.mjs progressQuantity). null = this failure
  //     carries no progress quantity; NEVER 0, which would read as "nothing left" — i.e. as a PASS.
  //     Written unconditionally, three-valued like `wrote` and `reads`: on a successful attempt and on
  //     a quantity-less failure alike the row SAYS null rather than staying silent.
  //   noChange: this attempt's failure is byte-identical to the previous attempt's. The ladder already
  //     stops on that for the content classes (the A4 break below) — but it can only know it AFTER
  //     paying for the attempt, and nothing recorded that the attempt bought a repeat rather than a
  //     fresh result. The flag is recorded for EVERY class, wider than the break it names, because a
  //     record of what happened is not the policy about what to do with it.
  // RECORDING ONLY: no break/park/terminate decision reads either field ( owns that policy).
  const quantity = fail ? (stampedQuantity ?? progressQuantity(fail)?.value ?? null) : null;
  const noChange = Boolean(fail) && attemptFails[attemptFails.length - 1] === fail;

  // ── — PRESERVE THE BEST REJECTED DRAFT ─────────────────────────────────────────────────
  // RECORDING ONLY, like `quantity` and `noChange` beside it: nothing here breaks, parks or terminates,
  // and what the machinery DOES with a preserved draft is pipeline.mjs's decision. Without this, a
  // recovery park re-commissions the stage cold and the convergence it parked to protect is gone — the
  // halves that reached 1 and 2 violations restarted at 21 and 13.
  // Three refusals, each closing a way this could quietly certify a bad document as the floor:
  //   · a KILL-CLASS attempt (killClass || killSeen) is never preserved — the same refusal the exit-1
  //     rescue makes above and for the same reason: `wrote` is a MUTATION, not a proof of a complete
  //     rewrite, and a stage validate is a SHAPE check. A kill-torn artifact is not a base to patch.
  //   · `wrote !== true` — an inherited file, or an earlier attempt's, is not THIS attempt's work.
  //   · a non-finite quantity never wins (best-draft.beatsBest) — ABSENT IS NOT ZERO.
  if (runDir && fail && wrote === true && !killClass && !killSeen && draftCarryEligible(fail)) {
    const target = failingFile ?? files[0] ?? null;
    if (target && recordBestDraft(runDir, name, target, { quantity, fail, attempt, key }))
      note(`[${name}] attempt ${attempt} rejected at count ${quantity} — preserved as the best draft so far (the next dispatch continues it rather than restarting)`);
  }
  return { wrote, reads, readsTruncated, quantity, noChange };
}

export function writeAttemptRow({ name, engine, agent, model, files, runDir, followup, bandSize, derivedLimit, auth },
  { lastUnion, lastCoverageUnion, lastPlacementUnion }, facts) {
  const { attempt, key, warm, warmEscalatedAt, effTimeout, dispatch, witnessed, wire, turn, cli, modelRequested,
    modelActual, modelBasis, modelSnapshot, modelMismatch, providerReported, timedOutBy, fail, formRepairsThisAttempt, rescued, quiescentMs,
    rescueRefused, rescueRefusedFile, rescueRefusedReason, attemptRefusals, attemptKilledWhile, lastGraded, wrote, reads, readsTruncated,
    quantity, noChange } = facts;
  const { code, killed, wall, stderr, laneWaitMs, json, usage } = turn;
  // — THIS COMMENT USED TO SAY the `usage` extraction "has only ever logged null" and that the
  // envelope shape was "unconfirmed". Both halves are false and have been for a long time, which is
  // how a stale build-stage note came to describe a live field as dead. Measured on preserved runs
  // whose engine commit is byte-identical to this file: the R5 register-unit attempt row of 08-12
  // carries {input:8349, output:18374, cacheRead:1805815, cacheWrite:96608, total:1929146}. Every
  // figure in its own table is a verbatim read of these rows — the issue was minted BY reading
  // the field this comment called null. The shape is `mapUsage`'s canonical
  // {input, output, cacheRead, cacheWrite, total}, written by both engines
  // (anthropic-agent.mjs mapUsage, openai-agent.mjs from turn.completed).
  //
  // CLEAROTRON_DUMP_JSON stays, but as what it now is: a raw-envelope capture for reading a field this
  // extraction does not map, not an open probe waiting for an answer it already has.
  if (envOn("CLEAROTRON_DUMP_JSON") && json) {
    try { writeFileSync(driverDir(runDir, `${name}.attempt${attempt}.rawjson.json`), JSON.stringify(json, null, 2)); } catch { /* best-effort */ }
  }
  // Telemetry is TOKENS ONLY (owner directive 2026-07-11): the attempt row carries the raw `usage`
  // counts and no driver-computed currency — the per-engine cost policy (costUsd/pricedModel) and the
  // price table it read are gone. Raw provider output (e.g. a CLEAROTRON_DUMP_JSON capture) is untouched.
  stageLog(runDir, name, {
    attempt, key, agent, model,
    // engine-aware provenance: the GPT id on an openai run, the anthropic-catalog id on an anthropic
    // run. STILL THE REQUESTED RESOLUTION — unchanged in meaning so run-economics.mjs and tokens.mjs
    // keep reading exactly what they have always read.
    modelUsed: modelRequested,
    // corruption 3 — the wire's own answer, beside it. Three-valued and written UNCONDITIONALLY:
    //   modelActual   — the id the provider reported, or null when the stream never said one.
    //   modelBasis    — "actual" | "unknown". Never "requested-dressed-as-actual".
    //   modelMismatch — true/false when both sides name a family, null when either does not.
    // Written even on the rows where they are null, so "this engine cannot report" stays visibly
    // different from "this record predates the gauge".
    modelActual, modelBasis, modelSnapshot, modelMismatch, providerReported,
    cliVersion: cli.version, cliVersionProbe: cli.probe, ...(cli.why ? { cliVersionWhy: cli.why } : {}), cliSource: cli.source,
    cliFloor: cli.floor ?? null, cliBelowFloor: cli.belowFloor ?? null,
    // W3 billing telemetry: which engine ran + the RESOLVED billing mode (subscription vs api-key). This
    // records INTENT (the mode the engine was configured to bill under), not independent billing evidence
    // — the actual proof is the provider console (claude's stream also reports apiKeySource; codex does
    // not). The value's job here is to make a silent mode-mismatch impossible to miss after the fact.
    //
    // — `apiBilled` IS WRITTEN EVEN WHEN FALSE, and it read `|| undefined` until now, which
    // elided exactly the value a subscription run has. The cost was measured rather than argued: a
    // sweep of every archived August run looking for this stamp found it nowhere, and the CONTROL
    // showed no run carried one at all — so the absence could not say whether API mode had ever been
    // used, and the question had to be left open. That is the house rule two files over, in the wild:
    // "every telemetry field is written unconditionally, so 'did not happen' stays distinguishable
    // from 'not recorded'" (instrumentation-house-rule.test.mjs). A run must be able to STATE that it
    // billed subscription, not merely fail to state that it billed API.
    engine: engine.name, writeBoundary: writeBoundaryOf(engine), authMode: auth.mode, apiBilled: auth.apiBilled === true, cloud: auth.cloud ?? null,
    // build 2 — THIS attempt is the fresh dispatch bought by discarding a warm session that
    // reproduced its own failure. Exact, not cumulative: a `warmEscalatedAt > 0` test would mark
    // every later attempt too the moment the ladder is deepened, and the row would stop meaning
    // one dispatch.
    warmEscalated: attempt === warmEscalatedAt || undefined,
    code, wall, timeoutSec: effTimeout, fail,
    // — THE DRIVER'S OWN VERDICT ON THIS ATTEMPT: the same `ok!fail` the run.jsonl spine has
    // carried since AD-4, which this row never had. Its headline was `status`/`summary`, both echoed
    // verbatim from the ENGINE's envelope — they answer "did the CLI turn complete", never "did this
    // attempt produce what the stage exists to produce". Sixty report-card attempts on round 892dd88e
    // journalled status:"ok", summary:"success", code:0, wrote:true and output.present:true beside a
    // populated `fail`, and a watcher keyed on the headline saw sixty successes.
    // — AND NOT WHEN THE SESSION REACHED AN ERROR RESULT, whatever its last result said: a refusal a
    // restart recovered is a session that was refused (engine/session-record.mjs). `fail` is unchanged,
    // so the ladder and every reader asking "did the stage fail" read exactly what they read before.
    ok: attemptOk(fail, turn),
    // What the session went through — every result, classifier cut, refusal and restart, with when —
    // and where its raw stream is, or why it was not kept. null where the engine cannot report.
    session: turn.session ?? null, stream: streamMeta(runDir, turn.stream),
    // The engine's claim about itself, KEPT and renamed to say whose claim it is. A self-report is
    // evidence — deleting it would destroy the only record of what the seat believed it had done — and
    // it is not a verdict. Still three-valued (ok | timeout | error). Nothing in the driver reads either
    // field (measured across driver/, scripts/ and mcp-server/), so the rename costs no consumer, and
    // archived rows keep `status`/`summary` meaning exactly what they meant when they were written.
    engineStatus: json?.status,
    // TRUE exactly when the engine said the turn completed and the driver failed the attempt anyway.
    // BOTH filed shapes are this one: wrote:false with the artifact never written, and wrote:true with
    // the artifact written and rejected. A check keyed on `wrote` alone sees only the first.
    selfReportContradicted: (fail && json?.status === "ok") || undefined,
    // convergence ledger (see the computation above): the progress quantity as a number —
    // null means ABSENT, never zero — and whether this attempt reproduced its predecessor exactly.
    quantity, noChange: noChange || undefined,
    // — what the meaning-sweep union held after this attempt was judged. `carried` is the number
    // of rows whose ruling came from a PREVIOUS attempt, i.e. exactly the work a cold re-dispatch used
    // to destroy. Absent on every stage that owns no meaning sweep. RECORDING ONLY.
    // — `parked` rides here too. RECORDING ONLY, so this one is diagnostics rather than a
    // client surface — but it is the trail the NEXT round reads to ask what a run actually did, and a
    // trail that omits the parks describes a run that decided everything.
    dispositions: lastUnion ? { countable: lastUnion.countable, ruled: lastUnion.ruled, outstanding: lastUnion.outstanding, parked: lastUnion.parked, total: lastUnion.total } : undefined,
    // — the same field for the register coverage form. Absent on every stage that owns no
    // coverage form, and on any run whose plan apparatus is out of reach. RECORDING ONLY.
    coverage: lastCoverageUnion ? { settled: lastCoverageUnion.settled, outstanding: lastCoverageUnion.outstanding, carried: lastCoverageUnion.carried, total: lastCoverageUnion.total } : undefined,
    // — the placement form's own row. `carried` is the measurement the issue asks for: tiers a
    // previous attempt placed that this one did not re-submit, i.e. exactly what the R1 discard
    // destroyed. `unresolved` counts selections the fold does not hold. RECORDING ONLY.
    placements: lastPlacementUnion ? { settled: lastPlacementUnion.settled, outstanding: lastPlacementUnion.outstanding,
      carried: lastPlacementUnion.carried, total: lastPlacementUnion.total, seatRows: lastPlacementUnion.seat_rows,
      unresolved: lastPlacementUnion.unresolved, rendered: lastPlacementUnion.rendered, account: lastPlacementUnion.account } : undefined,
    //: how many in-dispatch form repairs THIS attempt bought (absent = none). Its own rows
    // sit immediately above with the defect each one was dispatched to fix.
    formRepairs: formRepairsThisAttempt || undefined,
    laneWaitMs,   // WS-C turn-cap queue time — the live overlap validation reads this
    // A6: the provider's stop reason, verbatim — the max_tokens fault line is countable from the
    // rows alone (fail carries the named fault; this field carries the raw discriminator).
    stopReason: json?.stopReason ?? undefined, ...endingFields(json),   // — and beside it what ended the session: its kind, the vendor's status, and on an error the program's own words (session-record.mjs)
    // taint durability (copper-lattice): the kill discriminators survive to disk — register-taint.mjs
    // reads these rows across process restarts (--resume), where the in-memory turn object is gone.
    // `followup` matters too: a followup success PATCHES the prior session's output, it never
    // supersedes a taint the way a fresh full pass does.
    killed: killed || undefined,
    timeoutCause: timedOutBy ?? undefined,   // — which of the three timeout signals fired: killed, stderr or wall
    signals: turn.signals ?? undefined,
    //: how long every declared artifact had been untouched when the turn settled. Present on any
    // hard-wall kill the wall rescue looked at — INCLUDING the ones it refused, so "considered and
    // refused" is readable from the record and never the same silence as "never looked". null when the
    // arm did not apply (no wall, no validator, no declared file).
    quiescentMs: Number.isFinite(quiescentMs) ? Math.round(quiescentMs) : undefined,
    rescueRefused: rescueRefused ?? undefined,   // — the cause, when the rescue looked and refused
    rescueRefusedFile: rescueRefusedFile ?? undefined, rescueRefusedReason: rescueRefusedReason ?? undefined,
    refusedCalls: attemptRefusals ?? undefined,   // — {count, last}: this dispatch's refusals, on a timeout
    //: the verbatim message this attempt was dispatched with — {file, sha, bytes, chars, kind}.
    // null when the run has no directory or the gate is off; {present:false, error} when the write
    // failed. An absence is a record here, never a silence.
    dispatch,
    // exit-1 rescue (charter P1 §2): the turn exited nonzero but its artifact was fresh + valid — the
    // row records WHAT was rescued so the journal never reads a rescued 500 as a clean turn.
    // Since it also carries "timeout": a hard-wall kill whose artifact was finished and quiet.
    // A stage that succeeded AT THE WALL is therefore distinguishable from one that succeeded
    // normally — `rescued:"timeout"` plus `killed:true` on the winning row is the signature.
    rescued: rescued ?? undefined,
    followup: followup || undefined,
    warm: warm || undefined,
    runId: json?.runId, engineSummary: json?.summary,   // — the SEAT's word for itself; see `ok` above
    usage,
    // — the ratio `usage` and `wall` could always have been divided into, recorded so nobody
    // has to read two archived runs to find out a stage generated four times slower. null (never 0)
    // on a turn that measured nothing — see tokensPerSec.
    tokensPerSec: tokensPerSec(usage, wall),
    // — WHAT tokensPerSec's denominator CONTAINS, beside the ratio. Two integers from the
    // stream's own agent loop: how many tools the turn called, and how long it spent waiting for
    // them. A slow stage and a stage doing more tool work look identical in the ratio alone, which
    // is the comparison had to reconstruct by hand across archived runs.
    //
    // null (not 0, and not absent) on an engine that cannot report them, so "this adapter does not
    // measure" stays visibly different from "this turn called no tools" — see toolGauge.
    ...toolGauge(turn), band: bandSize ?? undefined,
    inputBytes: derivedLimit?.inputBytes ?? undefined, derivedLimitSec: derivedLimit?.sec ?? undefined,
    // …and whether this attempt spent that limit and exited cleanly anyway. Written UNCONDITIONALLY and
    // three-valued, beside the two numbers it is about, so a failure that had used its whole budget is
    // not left looking like an artifact problem. It names a fact; it moves no retry policy. See
    // `spentBudgetCleanly`.
    budgetSpentCleanly: spentBudgetCleanly({ fail, killed, code, wall, derivedLimitSec: derivedLimit?.sec }),
    killedWhile: attemptKilledWhile,
    // The share of each told manual this turn's model was shown: what it was sent, manuals inline, and what its tools returned
    // (manuals-seen.mjs); null where the stream cannot say. A resumed turn is sent only its repair and is shown only what it
    // read after resuming, so read it beside `warm`.
    manualsSeen: measureManualsSeen(turn, witnessed.told, engine.name, { sent: wire?.text }),
    // AD-4 emitted-vs-landed, UNCONDITIONAL (was success-only, which made a failed attempt's mid-write
    // artifact invisible): `output` = what LANDED on disk after this attempt (null when the stage has no
    // expected file); `wrote` = whether THIS attempt emitted it (see the computation above the runDir
    // gate). A failed row with wrote:true is the mid-write/taint shape; ok with wrote:false is inherited.
    // outputMeta, NOT fileMeta: an attempt that emitted nothing must journal {present:false} — under
    // fileMeta it journalled {sha:null,size:0}, a record where there is no file (see log.mjs).
    output: files.length ? outputMeta(files[0]) : null,
    // — THE FORM'S OWN sha, beside the output's. On a form-bearing stage the declared output is
    // the prose the seat writes once; the form is what every attempt after the first is graded on.
    // Five attempts on one delivered run recorded one identical output sha, so the record could not
    // distinguish a retry that filled 40 rows from one that touched nothing. ADDITIVE — `output`
    // keeps its meaning exactly, and this is absent on every stage that owns no form.
    form: gradedFormMeta(lastGraded) ?? undefined,
    wrote,
    // AD-4 reads gauge: which files the turn actually opened ([] = none; null = engine can't observe)
    // and whether that list is complete (true = the engine's cap dropped distinct paths).
    reads, readsTruncated,
    stderrTail: streamDigest(stderr),
    // — STDOUT ONLY WHEN THE TURN PRODUCED NO PARSEABLE JSON. A crashing wrapper prints its
    // reason to whichever stream it likes, and on the observed failure the record carried neither.
    // Absent on every healthy turn, so this costs nothing on the runs that work.
    stdoutTail: (fail && !json) ? streamDigest(turn.stdout) || undefined : undefined,
  });
}

export function writeAttemptEvent({ name, maxRetries, runDir, bandSize, derivedLimit, auth }, facts) {
  const { attempt, warm, warmEscalatedAt, dispatch, wire, turn, cli, modelRequested, modelActual, modelBasis, modelSnapshot, modelMismatch,
    providerReported, timedOutBy, fail, formRepairsThisAttempt, rescued, quiescentMs, rescueRefused, rescueRefusedFile, rescueRefusedReason,
    attemptRefusals, attemptKilledWhile, wrote, quantity, noChange } = facts;
  const { code, killed, wall, usage } = turn;
  // AD-4 — `attempt` lands on run.jsonl too (ADDITIVE: _driver/<stage>.jsonl keeps the full per-attempt
  // detail and the harness keeps reading it there; run.jsonl gets the lean per-attempt spine it never
  // had — its readers previously saw one "stage" event with attempts:N and no causes, and the knockout
  // lane logs no stage events at all, so run.jsonl alone could not distinguish "no retries happened"
  // from "retries not recorded here"). Best-effort like every telemetry write.
  try {
    runLog(runDir, {
      event: "attempt", stage: name, attempt, of: maxRetries + 1, ok: attemptOk(fail, turn), fail: fail ?? null,
      // The spine carries the one-word answer and the pointer; the per-stage row carries the record.
      interrupted: turn.session?.interrupted ?? null, stream: streamMeta(runDir, turn.stream)?.file ?? null,
      //: the spine carries the same pair as the per-stage log, or the two disagree about what
      // ran. `model` stays the requested resolution (its existing readers); `modelActual` is the wire.
      model: modelRequested, modelActual, modelBasis, modelSnapshot, modelMismatch, providerReported,
      cliVersion: cli.version, cliVersionProbe: cli.probe, ...(cli.why ? { cliVersionWhy: cli.why } : {}), cliSource: cli.source,
    cliFloor: cli.floor ?? null, cliBelowFloor: cli.belowFloor ?? null,
      wrote, warm: warm || undefined, warmEscalated: attempt === warmEscalatedAt || undefined,
      rescued: rescued ?? undefined, killed: killed || undefined, timeoutCause: timedOutBy ?? undefined,
      quiescentMs: Number.isFinite(quiescentMs) ? Math.round(quiescentMs) : undefined,   // — see the per-stage row
      rescueRefused: rescueRefused ?? undefined,   // — the cause, when the rescue looked and refused
      rescueRefusedFile: rescueRefusedFile ?? undefined, rescueRefusedReason: rescueRefusedReason ?? undefined,
      refusedCalls: attemptRefusals ?? undefined,   // — see the per-stage row
      // — AND THE BILLING PAIR, by the same argument makes for the model pair one field up:
      // the spine carries it or the two logs disagree about what ran. This is the row a sweep across
      // archived runs actually reads, and the question "has this box ever billed API" could not be
      // answered from it because the pair was only ever on the per-stage log. Written unconditionally,
      // like everything else here: a subscription run states `false`.
      authMode: auth.mode, apiBilled: auth.apiBilled === true, cloud: auth.cloud ?? null,
      //: the spine carries the POINTER and the sha, not the text — enough to find the file and
      // to tell two attempts apart without opening either.
      dispatch: dispatch?.file ?? null, dispatchSha: dispatch?.sha ?? null,
      // The manuals this attempt's opening message carried, by name, size and sha, and any left to a read: what was sent
      // stays apart from what the session read with its tools afterwards.
      manualsInline: wire.inlined.length ? wire.inlined : undefined, manualsLeftToRead: wire.missing.length ? wire.missing : undefined,
      //: the spine carries the convergence pair too — the ladder's shape (25 → 9 → 9 vs
      // 29 → 11 → pass) is readable from run.jsonl alone, without joining the per-stage log.
      quantity, noChange: noChange || undefined,
      // — and the COST pair, by the same argument made for the convergence pair. The
      // spine carried neither `wall` nor `usage`, so "which stage generated slowly" was not a
      // question run.jsonl could answer at all: it took joining the per-stage log for every stage
      // in the run, which is why the anomaly was found by hand across two archived runs rather than
      // by anything watching. Written UNCONDITIONALLY, null and not 0 when the turn measured
      // nothing — an unmeasured turn and a turn that emitted nothing are different events, and the
      // 485-second killed dispatch is exactly the one a 0 here would erase.
      wall, outputTokens: usage?.output ?? null, tokensPerSec: tokensPerSec(usage, wall),
      // — the spine carries them too, or a round has to join two files to ask why a stage was slow.
      ...toolGauge(turn), band: bandSize ?? undefined,
    inputBytes: derivedLimit?.inputBytes ?? undefined, derivedLimitSec: derivedLimit?.sec ?? undefined,
    // …and the same fact on this row, because one of the two carrying it records half the runs and
    // reads as done. Three-valued and beside the numbers it is about. See `spentBudgetCleanly`.
    budgetSpentCleanly: spentBudgetCleanly({ fail, killed, code, wall, derivedLimitSec: derivedLimit?.sec }),
    killedWhile: attemptKilledWhile,
      formRepairs: formRepairsThisAttempt || undefined,   //, see the stage row above
    });
  } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
}
