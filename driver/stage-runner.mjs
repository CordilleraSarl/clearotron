// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stage-runner.mjs — ONE STAGE OF EITHER LANE: reuse the output it holds, or run its one model turn, and record which.
//
// ── TWO COPIES OF ONE SKELETON ──────────────────────────────────────────────────────────────────────────
//
// The clearance's `stageOnce` (pipeline.mjs) and the Knockout's `koStage` (pipeline-knockout.mjs) each took the start
// time, reused a valid output or said why not, recorded the transition, called `runStage`, wrote the `stage` row and
// stamped what a success was based on. Written twice, the two drifted. The Knockout kept no copy of an output it was
// about to overwrite, so a chunk rated again over a replacement that then failed lost the rating it had. Its row carried
// neither the inputs the turn was offered nor what the turn reported, so a Knockout row could not be read the way a
// clearance row is. The skeleton is written once now, here, and both lanes run through it.
//
// WHAT THIS MODULE OWNS, in this order: the start time, taken before any work; the freshness row (`stage-stale`) and the
// reuse row (`skip`); the transition, at entry and again on success; the copy of a held output before a dispatch can
// overwrite it (`output-snapshot`); the one `runStage` call; the `stage` row; and the stamp of what a success read.
//
// A FAILURE IS RETURNED HERE, NEVER THROWN. What a failure means belongs to the lane: the clearance hands it to its own
// ladder, and the Knockout throws it at its boundary as the same `StageFailure` it always threw. A cancellation raised by
// the gateway, and a refusal a lane throws while composing its dispatch, pass through untouched and write no row, as
// they always have.
//
// WHAT A LANE SUPPLIES: its definition table (`lane.stages`) and `lane.prepare`, which builds one dispatch from a
// definition. The dispatch names the label, the output, the model, the inputs, the lane's freshness rule, how a held
// output is copied aside, the `runStage` options and what its rows carry. See `runLaneStage` for each field.
//
// WHAT STAYS WITH ITS LANE. Anything one lane has and the other does not is built inside that lane's `prepare`, keyed
// on what its definitions declare, so the other lane cannot reach it. The clearance keeps `--from` and forced reruns,
// the floor duty that blocks a skip, the winning-attempt recovery on a skip, and the output contract with its placement
// form. It also keeps the follow-up, carried draft and refresh message, the model tiers and their check, the time limit
// derived from the band with its ceiling refusal, and the document-growth trip. The Knockout keeps its own time and
// stall limits, its model override, its freshness rule and its review invalidation.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { runStage } from "./gateway.mjs";
import { recordTransition } from "./progress.mjs";
import { fileMeta, note, outputMeta, runLog } from "./log.mjs";
import { stageWallFields } from "./run-outcome.mjs";

/**
 * The inputs a stage row journals: each declared input's fingerprint, and whether the settled turn opened it.
 * `read` is three-valued. `true` means the turn opened the file. `false` means a complete gauge saw it unopened.
 * `null` means the gauge cannot say.
 */
export function journalStageInputs(paths = [], { reads = null, readsTruncated = null, warm = false } = {}) {
  const readSet = Array.isArray(reads) ? new Set(reads) : null;
  // A-1 — `followup` was an arm of this predicate and is not any more. It encoded the same false premise
  // the composer fixes: that a followup is a resumed session whose files were not re-offered. It is
  // not. A followup dispatch is a NEW stage() call, i.e. attempt 1, and `resumeRef` is passed only on a
  // warm retry — so a cold followup's reads gauge is exactly as groundable as a fresh dispatch's, and
  // nulling it turned "verified unread" into "unknowable" on precisely the dispatches worth measuring.
  // `warm` STAYS, and it is the arm that was always right: a warm patch resumes the failed session and is
  // deliberately not re-offered its files, so the turn opening nothing is the normal warm shape rather
  // than evidence it ignored them. `readsTruncated` stays for the same kind of reason — a capped gauge
  // would manufacture a `read:false`. The caller still journals `followup` on the row, so a reader can
  // still split the two populations; it just no longer erases one of them.
  const unreliable = Boolean(warm) || readsTruncated === true;
  return paths.map((p) => {
    const m = fileMeta(p);
    if (!m) return m;
    const opened = readSet ? readSet.has(p) : null;
    return { ...m, read: opened === true ? true : (unreliable ? null : opened) };
  });
}

/**
 * Copy a stage's output, before a dispatch can overwrite it, into `_history/<ts>-<reason>/`. Its attempt journal is copied
 * beside it, so a prior result is never lost and stays comparable (compare.mjs, and the artifact diff, read these folders).
 *
 * `sibs` are machine files written beside the output that a later stage treats as authoritative. They are copied and then
 * REMOVED, so a fresh output never sits beside the previous pass's record. A sibling that cannot be kept is said, and the
 * output is kept regardless.
 *
 * `key` adds a name to the folder, for a lane whose stage runs once per chunk: the folder then says which stage and chunk
 * it holds without opening it. Omitted, the folder is named as it always was.
 *
 * Returns the folder, or null when there is no output to keep. A failed copy of the output itself THROWS, and the dispatch
 * that would have overwritten it does not start.
 */
export function keepPriorOutput({ runDir, out, sibs = [], telemetry = null, reason, key = null, label = "" }) {
  if (!out || !existsSync(out)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(runDir, "_history", `${ts}-${reason}${key ? `-${String(key).replace(/[^\w.-]/g, "-")}` : ""}`);
  mkdirSync(dest, { recursive: true });
  copyFileSync(out, join(dest, basename(out)));
  for (const sib of sibs ?? []) {
    if (!sib || !existsSync(sib)) continue;
    try {
      copyFileSync(sib, join(dest, basename(sib)));
      rmSync(sib, { force: true });   // never leave the prior pass's machine record beside a fresh output
    } catch (e) { note(`[${label}] sibling snapshot/invalidate failed for ${basename(sib)} (${e.message})`); }
  }
  if (telemetry && existsSync(telemetry)) copyFileSync(telemetry, join(dest, basename(telemetry)));
  return dest;
}

/**
 * Run stage `name` of a lane once: reuse the output it holds, or dispatch it and record what happened.
 *
 * `lane.stages` is the lane's definition table; `lane.prepare(def, name, ctx, opts)` builds this one dispatch:
 *   runDir, label, out   where the journal is, the label the rows and the turn carry, the output (undefined: none)
 *   selector             the assigned model, as the rows name it beside the model that ran
 *   trigger              why it dispatches; "fresh" when omitted
 *   followup             the caller's word that this dispatch is a follow-up (false when omitted)
 *   rowFields            fields every row of this stage carries (the Knockout's lane and chunk)
 *   freshness()          the lane's freshness rule: { stale, reason?, changed }
 *   reusable(freshness)  whether the held output stands to be reused, by the lane's own rule
 *   reused()             on a reuse: { model?, result? }, the skip row's model and what this call returns
 *   beforeDispatch()     work owed once the stage is entered and before its output is copied aside
 *   snapshot(reason)     copies the held output aside and returns the folder; omitted, nothing is copied
 *   dispatch()           the `runStage` options; it may throw a refusal, which passes through with no row
 *   stageInputs()        the declared input paths the stage row journals
 *   rowExtra()           fields only this lane's stage row carries
 *   stamp(r)             records what a successful output was based on
 *   after(r, {priorSize, trigger})  work owed after the dispatch, success or not
 *   result(r)            what this call returns after a dispatch; `r` when omitted
 *
 * Returns the lane's reuse result, or the dispatch's. A failure is returned with `ok: false`, never thrown.
 */
export async function runLaneStage(lane, name, ctx, opts = {}) {
  // — THE STAGE'S OWN START, taken before ANY work: before the freshness read, the message composition, the
  // snapshot and `runStage`. Take it after the await instead and every field is still present, every presence
  // assertion still passes, and every interval is ~0 ms: the journal would say a fourteen-minute stage took
  // nothing. Only a magnitude or overlap assertion catches that, which is why its tests are written as overlaps.
  const tDispatch = Date.now();
  const def = lane.stages[name];
  if (!def) throw new Error(`unknown stage ${name}`);
  const s = lane.prepare(def, name, ctx, opts);
  const rowFields = s.rowFields ?? {};
  const trigger = s.trigger ?? "fresh";

  const freshness = s.freshness();
  if (freshness.stale) {
    const why = freshness.changed.map((c) => `${c.name} ${c.was ?? "(absent)"}→${c.now ?? "(absent)"}`).join(", ");
    runLog(s.runDir, { event: "stage-stale", stage: s.label, ...rowFields, changed: freshness.changed, ...(freshness.reason ? { reason: freshness.reason } : {}) });
    note(freshness.reason ? `[${s.label}] stale — ${freshness.reason}; recomputing`
      : `[${s.label}] stale — ${freshness.changed.length} input(s) changed since this output was produced (${why}); recomputing`);
  }
  // A STALE OUTPUT IS NEVER REUSED, whatever the lane's own rule says of it. The lane is still asked first, so anything
  // it records about the held output (the clearance's floor duty) is recorded on a stale pass too.
  if (s.reusable(freshness) && !freshness.stale) {
    const kept = s.reused?.() ?? {};
    note(`[${s.label}] skip — output already present and valid`);
    // outputMeta, NOT fileMeta: a reader of the skip row holds the stated contract, an absent output as {present:false},
    // and a row with no `present` key at all read as "not produced" for an artifact on disk that passed its validator.
    runLog(s.runDir, { event: "skip", stage: s.label, ...rowFields, trigger: "skip", ok: true,
      model: kept.model ?? s.selector, output: outputMeta(s.out), ...stageWallFields(tDispatch) });
    recordTransition(ctx, name);   // the displayed step advances on a resume too (monotonic; an unmapped stage moves no step)
    return kept.result ?? { ok: true, skipped: true };
  }

  // ── THE RUN IS IN THIS STAGE FROM THE MOMENT IT DISPATCHES ─────────────────────────────────────────
  //
  // The displayed step advanced only where a stage SUCCEEDED, so a run inside a stage that takes minutes read as being in
  // the previous one for the whole of it. Every mutating path funnels through here, so this is the one declaration of
  // entry. `writeRunStatus` keeps the furthest step ever reached, so a re-run mapping to an earlier stage cannot pull the
  // stepper back, and the bare `name` makes a fan-out's axes, or a batch's chunks, one display step.
  recordTransition(ctx, name);
  await s.beforeDispatch?.();

  // ── SNAPSHOT BEFORE OVERWRITE, AT THE ONE POINT EVERY DISPATCH PASSES ─────────────────────────────
  //
  // Reaching this line means the reuse above did not fire, so a held output here is about to be written over: by a
  // recompute of a stale output, a re-dispatch over an invalid one, a forced rerun or a correction. Its prior bytes go to
  // `_history/` first, and stay there whatever the dispatch then does, a failed one included. A valid reuse never gets
  // here and copies nothing.
  let priorSize = null;
  if (s.out && existsSync(s.out) && s.snapshot) {
    try { priorSize = statSync(s.out).size; } catch { /* best-effort */ }
    const reason = trigger === "fresh" ? "stale-recompute" : trigger;
    const snap = s.snapshot(reason);
    if (snap) {
      ctx.lastSnapshot = snap;
      runLog(s.runDir, { event: "output-snapshot", stage: s.label, ...rowFields, trigger: reason, snapshot: basename(snap) });
    }
  }

  const r = await runStage(s.label, await s.dispatch());
  // ── THE STAGE ROW: what the stage was handed, why it ran, what ran it and what it left ─────────────────
  //
  // BEFORE any stamp, and with `ok` on it: a stage that failed still spent its wall, and a lane whose failures leave no
  // completion row reports its own cost as smaller than it was. Each field is three-valued where it can be absent, so
  // "did not happen" never reads as "not recorded":
  //   model — THE MODEL THAT RAN, not the one assigned: the wire's word first, the engine's own resolution second, the
  //     assignment last. `modelSelector` keeps the assignment beside it, which is what re-spawns the writer.
  //   inputs — what the stage was OFFERED, with `read` saying whether the settled turn opened each (journalStageInputs).
  //     `followup`, `readsTruncated` and `warm` are written unconditionally beside it, so a row whose `read` flags are
  //     null says why in place, without a join to the attempt journal.
  //   output — null when the stage declares none, {present:false} when it is not on disk, else what landed.
  //   outputWritten — whether THIS dispatch emitted it (false: landed but inherited; null: not observed).
  //   summary — what the turn reported on success; null when no turn result came back, as on a failure.
  const stageInputs = s.stageInputs ?? (() => []);
  runLog(s.runDir, {
    event: "stage", stage: s.label, ...rowFields, trigger,
    ok: r.ok, attempts: r.attempts ?? null, fail: r.fail ?? null,
    model: r.modelWire ?? r.modelUsed ?? s.selector,
    modelSelector: s.selector,
    inputs: journalStageInputs(stageInputs(), { reads: r.reads, readsTruncated: r.readsTruncated, warm: r.warm }),
    followup: s.followup ?? false,
    readsTruncated: r.readsTruncated ?? null,
    warm: r.warm ?? null,
    ...(s.rowExtra?.() ?? {}),
    output: s.out ? outputMeta(s.out) : null,
    outputWritten: r.wrote ?? null,
    summary: r.json?.summary ?? null,
    ...stageWallFields(tDispatch),   // the wall boundaries, so a stage's cost is a fact
  });
  // Recorded only for an output that succeeded: a stamp says what the output on disk was based on.
  if (r.ok) s.stamp?.(r);
  // Re-asserted on success: entry records the same transition above, so this re-states the stage after a fan-out's
  // concurrent members have each written their own.
  if (r.ok) recordTransition(ctx, name);
  s.after?.(r, { priorSize, trigger });
  return s.result ? s.result(r) : r;
}
