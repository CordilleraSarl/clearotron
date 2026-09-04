// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pipeline-knockout.mjs — the KNOCKOUT (Depth 1) slim lane.
//
// A knockout batch is ONE run: N marks (5–15), one broad CODE-side research call per mark (receipted),
// one LLM frame turn, chunked LLM assess turns, a one-row-per-mark report + 3-sheet audit workbook, the
// standard outbox delivery handoff. Dispatched from pipelineInner AFTER the profile/policy freezes
// (ctx.profile + ctx.searchPolicy are set; the run slot and pipeline()'s rate-limit postpone wrap us).
//
// What this lane deliberately does NOT have, by design:
//   - no register machinery, no grid, no coverage ledger — the sweep is ONE broad question per mark;
//   - no UNCONDITIONAL auto-recovery ladder. Since  this lane has a CLASS-AWARE one:
//     a knockout re-run costs ~$2, so a park is bought only where a fresh sample is the plausible
//     remedy — TRANSIENT gets the ladder, UNKNOWN exactly one park, DETERMINISTIC and FACTUAL get NONE,
//     every designed refusal gets none, and a signature that already parked is terminal at once.
//     Everything else goes terminal with the standard failure packet exactly as before (rate-limits
//     still postpone via pipeline()'s outer catch — we re-throw StageFailure).
//     A THROW SITE THAT KNOWS ITS OWN CLASS MUST STAMP IT (`failClass`, see StageFailure). Unstamped,
//     the ladder can only guess from the reason text, and the guess for anything the regexes do not
//     recognise is UNKNOWN — which buys a park. Every throw in this file was written while the lane had
//     no ladder and stamping was therefore free to skip; that is no longer true;
//
// A NOTE ON THE ISSUE NUMBER, BECAUSE THE HISTORY AND THE SOURCE DISAGREE AND ONLY ONE CAN BE FIXED.
// The commit that landed this ladder says "". That is the WRONG issue — 1886 is
// about doctrine resolution and has nothing to do with this lane. The work was authorised against the
// plan of record, 1889, which lists it by name. The commit message cannot be edited once pushed and
// history is not rewritten to tidy a citation, so the wrong number stands in the log forever; the
// references in this file are corrected and this comment is the reconciliation. A reader who greps the
// history for 1886 and lands here is in the right place and the number that brought them is not.
//   - no known-conflicts writes — triage hits are unverified; the recall ledger is read-only territory
//     for this lane (review 2026-07-17 doctrine).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
import { fileURLToPath } from "node:url";

import { runStage } from "./gateway.mjs";
import { config, RESEARCH_PROVIDERS, REGISTER_PROVIDER, activeProvider, missingCredentials } from "./driver.config.mjs";
import { StageFailure, buildFailurePacket, stageWallFields, terminalReasonFields, isDesignedRefusal } from "./pipeline.mjs";   // — the wall fields the spine already carries
import {
  REFUSAL_TERMINAL_KIND,   // — the terminal kind that is not a failure
  // — the clearance lane's recovery DECISION, reused rather than restated. The
  // ladder's class-awareness, its repeat-signature backstop and its lane accounting are one
  // implementation; a second copy here would be a second thing to keep true.
  decideRecovery, failureSignature, classifyFailureReason, countRecoveryLanes, weatherCeilingFor,
} from "./repairs.mjs";
import { RunCancelled } from "./cancel.mjs";   // stop-by-user: never the failure lane below
import { loadFrameworkManifest, parseFrameworkManifest, frameworkFor, DEFAULT_FRAMEWORK } from "./framework.mjs";
import { KO_STAGES, KO_STEPS, KO_STEP_REGISTER_COUNT, koSteps, koPaths, kebab, knockoutPrompt, koChunks } from "./stages-knockout.mjs";
import { kebabCollisions, reportIdentityFor, CAPABILITY_SKIPPED_CAUSE, CAPABILITY_SKIPPED_NOTE } from "./search-policy.mjs";
import { countPreflight, countRegisterHits, countedMarks, resolveCountExecutor } from "./register-count.mjs";
import { recordsPreflight, listRegisterRecords, listedMarks, resolveRecordExecutor } from "./register-records.mjs";
import { capabilitiesFor } from "./register-capabilities.mjs";
// — the ONE binding of the office split to this box's env, shared with the plan lane.
import { registerUnavailableOffices } from "./register-unreachable.mjs";
import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";   // — this run's record log
import { validators as koValidators, validateMergedFindings, worstBand, registerSurfacedFilings, raterCaveats, SURVIVOR_BOUNDARY_RE } from "./verify-knockout.mjs";
import { publishKnockout, composeKnockoutEmail } from "./publish/knockout.mjs";
import { writeRunStatus, rollupStatus, atomicWrite, identitySeed } from "./progress.mjs";   // — the identity seed is shared; the stepper is not
import { batchMarkName } from "./mark-name.mjs";
import { runLog, note, outputMeta } from "./log.mjs";
import { AGENT_WHATSAPP } from "./stages.mjs";
import { writeOutboxPacket } from "./outbox.mjs";
import { rollupTokens, stampTokenRollup } from "./tokens.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
import { writeSettleStamp } from "./settle-stamp.mjs";   // — the pool copy's own terminal state
import { stopReason } from "../shared/stop-reason.mjs";   //
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
export const TRIAGE_FRAMEWORK = "skills/prelim-search/risk-framework-triage.md";

// sentinel/archive mirror pipeline.mjs's private helpers (cross-referenced there) — byte-faithful.
const sentinel = (runDir, name, obj) => atomicWrite(join(runDir, name), JSON.stringify({ ts: new Date().toISOString(), ...obj }, null, 2) + "\n");
function archive(run) {
  try { mkdirSync(dirname(run.archiveDir), { recursive: true }); renameSync(run.runDir, run.archiveDir); return run.archiveDir; }
  catch (e) { note(`archive failed (non-fatal): ${e.message}`); return null; }
}
// Steps are addressed BY LABEL: Depth 2 inserts a step, so every index after the frame shifts. The
// run's own step list is frozen on ctx at dispatch (ctx.koSteps).
const koStep = (ctx, label, extra = {}) => {
  const steps = ctx.koSteps ?? KO_STEPS;
  const i = steps.indexOf(label);
  writeRunStatus(ctx, { stepIndex: i, stepLabel: label, stepN: i + 1, stepTotal: steps.length, ...extra });
};

// ── framework freeze (knockout flavour): the customer's OWN framework when configured, else the house
// TRIAGE ladder (NOT the clearance Generic default — a knockout rates at triage grain). Same freeze
// doctrine as attachFramework: minted once, read verbatim on resume, corrupt = loud.
function attachKnockoutFramework(ctx) {
  const sidecarPath = driverDir(ctx.paths.runDir, "framework.json");
  // ── THE DECK'S PATH, RESOLVED ONCE AND ON BOTH PATHS ────────────────────────
  //
  // The assess stage is served the DECK now, not only the manifest — `framework.mjs` states the rule
  // the manifest obeys: "vocabulary and order ONLY. Never a mapping table, threshold, or decision
  // rule — those live in the deck prose, where the model reasons with them." A rater given the band
  // words and not the rulebook was being told to honour ceilings stated in a document it never saw.
  //
  // Resolved HERE and hung on ctx rather than recomputed in the dispatch, because "which deck" is one
  // decision and a second copy of it is how the two lanes drifted in the first place. ABOVE the resume
  // return as well: a resumed run reads its manifest off the sidecar and would otherwise reach the
  // dispatch with no deck path at all — the stage would silently fall back to reading nothing, which
  // is exactly the failure this issue is about, reintroduced on the resume path only.
  const configured = frameworkFor(ctx.profile);
  const fwPath = configured !== DEFAULT_FRAMEWORK ? configured : TRIAGE_FRAMEWORK;
  ctx.frameworkPath = fwPath;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT */ }
  if (raw != null) {
    try { ctx.framework = parseFrameworkManifest(raw); }
    catch (e) { throw new Error(`_driver/framework.json is corrupt (${e.message}) — investigate; the frozen framework is never silently re-derived`); }
    readBackLadder(ctx, sidecarPath, { minted: false });
    return;
  }
  const manifest = loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath);   // see pipeline.mjs attachFramework
  ctx.framework = manifest;
  atomicWrite(sidecarPath, JSON.stringify(manifest, null, 2) + "\n");
  runLog(ctx.paths.runDir, { event: "framework", key: manifest.framework_key, custom: fwPath !== TRIAGE_FRAMEWORK, lane: "knockout", bands: manifest.bands.map((b) => b.label).join("/") });
  readBackLadder(ctx, sidecarPath, { minted: true });
}

// ── — READ THE LADDER BACK THE WAY ITS CONSUMER READS IT, AT THE ONE MOMENT IT IS FREE ─────────
//
// `knockoutAssessChunk` does not use `ctx.framework`. It re-reads the sidecar off disk with a forgiving
// reader and derives its ladder from `fw?.bands`; when that comes back empty, its three band checks —
// `knockout_band_unknown`, `classesDriving`, `registerEstimate` — are ALL inert and every rating in the
// chunk passes unchecked, with no runLog and no note. A run the ladder never constrained is then
// indistinguishable from one it did.
//
// The refusal that would have caught it does not reach that path. `framework.mjs` rejects a manifest with
// fewer than two bands, but the validator never parses, so the guarantee lives on a road the consumer does
// not travel — check-what-enforces, not what declares. Checking here costs no model call: this runs before
// any assess dispatch.
//
// TWO DISPOSITIONS, because it is not the same fault in both directions:
//   MINTED — the driver wrote the file itself, moments ago, from a manifest it had already parsed. If it
//     cannot read its own ladder back, the driver is contradicting itself and nothing downstream is
//     trustworthy. Hard fail, before a paid turn.
//   PRE-EXISTING (a resume, or an archived run replayed) — those bytes predate this process and may
//     predate this shape. 's own "not claimed" names exactly this risk: a replay turning red is how
//     this fix would go wrong. So it is LOUD and it does not stop the run.
export function readBackLadder(ctx, sidecarPath, { minted }) {   // exported for its test: both dispositions are driven directly
  let bands = null;
  try { bands = JSON.parse(readFileSync(sidecarPath, "utf8"))?.bands; } catch { /* handled below */ }
  const ladder = Array.isArray(bands) ? bands.map((b) => String(b?.label ?? "")).filter(Boolean) : [];
  if (ladder.length) return;
  const detail = `${sidecarPath} does not read back as a band ladder, so knockoutAssessChunk's three band checks would pass every rating unchecked`;
  if (minted) throw new Error(`knockout_ladder_unreadable: ${detail} — the driver wrote this file itself from a parsed manifest, so this is a driver fault and no seat can fix it`);
  // THE RECORDING CANNOT BE WHAT STOPS THE RUN. `runLog` → `appendLine` (log.mjs:11) does an unguarded
  // mkdirSync + appendFileSync: on EACCES or a full disk it THROWS. Everywhere else in the driver that is
  // the accepted behaviour, but not here — this branch exists precisely to keep a pre-existing run alive,
  // and a throw out of it would take down the run it is written to spare, for a reason unrelated to
  // frameworks. The note still fires either way: stderr is the one sink that does not touch the disk.
  try {
    runLog(ctx.paths.runDir, { event: "knockout-ladder-unreadable", path: sidecarPath, lane: "knockout", minted: false });
  } catch (e) {
    note(`knockout-ladder-unreadable could not be written to run.jsonl (${String(e?.message ?? e).slice(0, 80)}) — the finding below still stands`);
  }
  note(`_driver/framework.json does not read back as a band ladder — the knockout band checks will not constrain this run's ratings. The file predates this process, so the run continues; investigate before trusting its bands.`);
}

// ── koStage: the slim lane's stage runner — skip-if-output-valid (the stageOnce pattern), one
// runStage call, StageFailure on exhaustion (rate_limited rides to pipeline()'s postpone catch).
async function koStage(name, ctx, { chunkNo = null, msgCtx = {} } = {}) {
  // — the stage's own start, captured before ANY work: before the existsSync, before the validator
  // read, before the message composition. states why on the spine — capture it after the await and
  // every field is still present, every presence assertion still passes, and every interval is ~0 ms, so
  // the journal would assert that a four-minute assess took nothing.
  const tDispatch = Date.now();
  const def = KO_STAGES[name];
  const K = ctx.K;
  const out = def.out(K, chunkNo ?? undefined);
  const label = chunkNo != null ? `${name}#${chunkNo}` : name;
  const model = process.env.CLEAROTRON_KNOCKOUT_MODEL || def.model;
  if (existsSync(out)) {
    const v = def.validate(out, readFileSync(out, "utf8"));
    if (v.ok) {
      // Was `{event:"stage-skip"}`, which nothing read: mcp-server/lib/events.mjs classifies `stage` and
      // `skip` and dropped this lane on the floor, so a knockout run's stages were invisible in get_run
      // while the clearance spine's were not. Renamed rather than duplicated — no legacy path, and the
      // grep that found its only reader found none.
      runLog(ctx.paths.runDir, { event: "skip", stage: label, lane: "knockout", trigger: "skip", ok: true,
        model, output: outputMeta(out), ...stageWallFields(tDispatch) });
      return { ok: true, skipped: true };
    }
    runLog(ctx.paths.runDir, { event: "stage-stale", stage: label, reason: v.reason });
  }
  const r = await runStage(label, {
    agent: ctx.agent,
    message: def.message({ ...ctx, K, chunkNo, ...msgCtx }),
    model, thinking: def.thinking,
    sessionKey: `prelim-${ctx.run.slug}-${ctx.run.codename}-${label}`,
    timeoutSec: def.timeoutSec, stallSec: def.stallSec,
    expectFile: out, validate: def.validate, runDir: ctx.paths.runDir,
  });
  // BEFORE the throw, and with `ok` on the row. A stage that failed still spent its wall, and a lane
  // whose failures leave no completion row reports its own cost as smaller than it was — which is the
  // reading error exists to prevent, in the direction that flatters.
  runLog(ctx.paths.runDir, { event: "stage", stage: label, lane: "knockout", trigger: "fresh",
    // — the knockout lane's own copy of the clearance lane's defect, found by counting the stage
    // events rather than trusting that there was one. It wrote the ASSIGNED alias, so a codex knockout
    // named an Anthropic model on the line a reader skims. Same precedence as the clearance stage event:
    // the wire's word, then the engine's resolution, then the assignment as the unchanged legacy fallback.
    ok: r.ok, attempts: r.attempts ?? null, fail: r.fail ?? null,
    model: r.modelWire ?? r.modelUsed ?? model,
    modelSelector: model,          // — what re-spawns the writer, beside what ran
    output: outputMeta(out), outputWritten: r.wrote ?? null, ...stageWallFields(tDispatch) });
  if (!r.ok) throw new StageFailure(label, r.fail ?? "failed", r.resetsAt);
  return r;
}

// ── The sweep executor chain: injected (tests) → fixtures dir (the $0 offline guarantee) → the live
// RESEARCH_PROVIDERS.perplexity adapter. Executor contract:
// async (task, {mark, preset}) -> { ok, text?, cause?, bytes?, tookMs? }.
export function resolveSweepExecutor(opts) {   // exported for its test, like readBackLadder above
  if (typeof opts?.sweepExecutor === "function") return { exec: opts.sweepExecutor, source: "injected" };
  const fixDir = process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES;
  if (fixDir) {
    return {
      source: `fixtures:${fixDir}`,
      exec: async (_task, { mark }) => {
        try {
          const text = readFileSync(join(fixDir, `${kebab(mark)}.md`), "utf8");
          return { ok: true, text, bytes: Buffer.byteLength(text) };
        } catch (e) { return { ok: false, cause: `fixture missing for ${kebab(mark)}: ${e.message}` }; }
      },
    };
  }
  // acceptance 6 — NO CAPABILITY REFUSES THE SCREEN FOR WANT OF A KEY. The live sweep needs a
  // research credential this deployment may not hold, and under ADR-0003 that is a choice between
  // refusing at preflight and degrading with a disclosure. It degrades: `registerProbe` is true on the
  // knockout row of PRODUCT_POLICIES, so the filing counts are in the product independently of this
  // call, and a keyless screen returns them and states the half that did not run.
  //
  // A SKIP RATHER THAN AN EXEC, and that is the whole mechanism. Deleting the preflight throw alone
  // would have been the wrong fix and the comment at that throw says why: the executor would be called
  // per mark, the cred-guard would degrade each one, and the batch would die at the all-failed branch
  // AFTER the paid frame turn — worse than the refusal, and it costs money to reach. Not-attempted and
  // attempted-and-failed are different runs; this is the first.
  if (!process.env.PERPLEXITY_API_KEY) return { source: "perplexity", exec: null, skipped: "common-law-no-credential" };
  return { source: "perplexity", exec: (task, { preset }) => RESEARCH_PROVIDERS.perplexity.research(task, { preset }) };
}

// bounded-concurrency fan-out (local copy of the runBatched idiom — pipeline.mjs's is private).
// A non-finite limit collapses to 1 worker, never to zero (Array.from({length: NaN}) is [] — a typo'd
// concurrency env var would otherwise silently skip the ENTIRE sweep; review 2026-07-17).
async function runBatched(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const cap = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}

// ── The lane ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * THE SURVIVOR BOUNDARY — the sentence that says what a knockout screen is NOT.
 *
 * The boundary of the screen is stated by the ENGINE rather than left to the assessing model, which is
 * the one party that cannot see it: a screen cannot know what it did not look for.
 *
 * The PRODUCT comes off the frozen policy through the registry join — the same name the masthead prints,
 * so the page cannot say one thing in the header and something else in the caveat.
 *
 * `.identity`, NOT `.banner`. Banner leads with the stage label, so on the two retired knockout
 * rows this caveat read "at the configured depth (Depth 1 — Knockout review)": a rung on a ladder the
 * offering no longer has, printed in client-facing prose, on the same page whose masthead had just
 * stopped printing one. The phrase "the configured depth" went with it — the screen is named by the
 * product it IS. A policy that resolves to no name says "a knockout screen" rather than asserting one.
 *
 * EXTRACTED FROM knockoutInner, WITH ITS GUARD, because the two must not drift. The idempotence check
 * used to be a regex literal written out beside the sentence, and rewording the sentence left the guard
 * matching the OLD phrase — so a re-merge would have appended a SECOND copy of the boundary to the
 * delivered report, and nothing in 3,891 tests could see it. They are now one exported pair: the regex
 * matches the invariant clause of the sentence this function builds, and a test holds them together.
 */
// — DEFINED IN verify-knockout.mjs NOW, and re-exported here so existing importers
// are untouched. The verifier needs it to tell the engine's own caveats from the rater's, and the import
// direction is producer -> verifier; it cannot be the other way without a cycle.
export { SURVIVOR_BOUNDARY_RE };

export function survivorBoundaryNote(policy) {
  const product = reportIdentityFor(policy ?? null).identity;
  const screenName = product ? `a ${product}` : "a knockout screen";
  return `This is ${screenName}, not a clearance. A mark not knocked out here is not clear — it is not knocked out at this screen's depth, and proceeds to clearance. Nothing above is a finding of availability.`;
}

// ── — the knockout lane's recovery park ───────────────────────────────────────
//
// EXPORTED so it can be armed directly. The clearance lane's equivalent is inline in a 6,000-line catch
// and is reachable only by driving a whole pipeline; that is why its class-awareness has no focused arm
// and why this one does.
//
// Returns the runner's park result, or NULL to mean "no park was bought — carry on to the terminal".
// Null is the answer on every path that is not a park, including a failure to read the run's own status:
// a park bought on an unreadable history could re-buy a signature that already parked, which is the one
// thing `decideRecovery`'s backstop exists to stop.
export function knockoutRecoveryPark({ ctx, run, e, reason, failedStage, note = () => {} }) {
  if (!run?.runDir) return null;
  let snapshot = {};
  try { snapshot = JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8")) ?? {}; } catch { snapshot = {}; }
  const priorAttempts = Number(snapshot.recoveryAttempts) || 0;
  const history = Array.isArray(snapshot.recoveryHistory) ? snapshot.recoveryHistory : [];
  // No early return for recoveryMax === 0: decideRecovery already refuses on its own ceiling
  // (laneAttempts < laneCeiling is false at 0), and a guard that cannot fail is a guard that looks
  // load-bearing and is not. Proved by planting its removal — nothing red. Letting the decision run
  // also means a deployment with the ladder OFF still records "recovery-classified", so the journal
  // says the ladder was consulted and declined rather than saying nothing at all.
  const recoveryMax = Math.max(0, Number(process.env.CLEAROTRON_RECOVERY_MAX ?? 3));

  const failSig = failureSignature(failedStage, reason,
    { codes: e instanceof StageFailure ? e.reasonCodes : undefined });
  const failClass = (e instanceof StageFailure && e.failClass) || classifyFailureReason(String(reason));
  const laneCounts = countRecoveryLanes(history, { total: priorAttempts });
  const weatherCeiling = weatherCeilingFor(recoveryMax);
  const decision = decideRecovery({
    failClass, sig: failSig.sig, reason: String(reason), history, priorAttempts,
    recoveryMax, hasRunDir: true, runCeiling: recoveryMax, weatherCeiling,
    weatherAttempts: laneCounts.weather, defectAttempts: laneCounts.defect,
  });
  try {
    runLog(run.runDir, { event: "recovery-classified", lane: "knockout", sig: failSig.sig,
      class: failClass, stage: failedStage, recoverable: decision.recoverable,
      parkBudget: decision.parkBudget, repeat: decision.repeat, recoveryLane: decision.lane });
  } catch { /* observability must never mask the failure being handled */ }
  if (!decision.recoverable) return null;

  const RECOVERY_BACKOFF_MIN = [2, 15, 60];   // attempt N resumes after BACKOFF[N-1] minutes (last repeats)
  const attempt = priorAttempts + 1;
  const backoffMin = RECOVERY_BACKOFF_MIN[Math.min(decision.sigAttempts, RECOVERY_BACKOFF_MIN.length - 1)];
  const recoveryResumesAt = new Date(Date.now() + backoffMin * 60000).toISOString();
  const lane = decision.lane;
  const recoveryLanes = {
    weather: { attempts: laneCounts.weather + (lane === "weather" ? 1 : 0), ceiling: weatherCeiling },
    defect: { attempts: laneCounts.defect + (lane === "defect" ? 1 : 0), ceiling: recoveryMax },
  };
  note(`[knockout] RECOVERABLE failure in ${run.codename} at ${failedStage} — parking for AUTO-RECOVERY, `
     + `${lane === "weather" ? "upstream weather" : "defect"} attempt ${attempt}/${recoveryMax}, resumes ${recoveryResumesAt}`);
  // `.postponed` and NO `.failed`: the marker IS the difference between a parked run and a dead one,
  // and writing both would leave a run the runner resumes and a reader reads as failed.
  try {
    sentinel(run.runDir, ".postponed", { kind: "recovery", lane: "knockout", recoveryResumesAt,
      postponedAt: new Date().toISOString(), stage: failedStage });
  } catch { /* best-effort — status.json below is the durable record */ }
  try {
    writeRunStatus(ctx, { state: "recovering", recoveryAttempts: attempt, recoveryMax, failedStage,
      ...terminalReasonFields(reason), recoveryResumesAt, resetsAt: null,
      recoveryLane: lane, recoveryLanes, lane: "knockout",
      recoveryHistory: [...history, { sig: failSig.sig, class: failClass, stage: failedStage,
        lane, at: new Date().toISOString(), quantity: decision.progress?.quantity ?? null }] });
  } catch { /* best-effort */ }
  try { runLog(run.runDir, { event: "recovery-parked", lane: "knockout", attempt, of: recoveryMax,
    sig: failSig.sig, recoveryResumesAt, recoveryLane: lane }); } catch { /* best-effort */ }
  try { recordRunConsumption(ctx, { phase: "recovery-park", tokens: stampTokenRollup(run.runDir, "recovery-park") }); }
  catch { /* best-effort */ }
  try { rollupStatus(run.studioRoot); } catch { /* best-effort */ }
  // `resetsAt` is the runner's due-clock contract (parkPostponed / postponedDueAt), not a status surface.
  return { ok: false, postponed: true, recovery: true, attempt, resetsAt: recoveryResumesAt,
    codename: run.codename, runDir: run.runDir, failedStage, lane: "knockout" };
}

export async function knockoutInner(ctx, job, opts = {}) {
  const { run, agent, paths: P } = ctx;
  const K = ctx.K = koPaths(run.runDir);
  const policy = ctx.searchPolicy;
  const runId = `${run.slug}-${run.date}-${run.codename}`;   // same shape as clearance (seedRunStatus) — one format across every consumer
  try {
    // ── — IDENTITY IS SEEDED BEFORE ANYTHING CAN REFUSE ──────────────────────────────────────────
    //
    // `ref` is the ONLY field round discovery matches on — e2e-rounds.mjs coerces a run's status `ref`
    // to a string and tests the prefix, and nothing else is consulted. (Phrased without the
    // "key: <quoted token>" shape on purpose: gitleaks' generic-api-key rule fires on it in prose.) And
    // `findRunsByRef`'s own docstring says it keys on status.json rather than meta.json *"so that failed
    // runs stay discoverable"* — meta.json is written at publish time, so discovery by it finds every run
    // that succeeded and not one that failed. The intent was written down; the guarantee was not
    // implemented.
    //
    // A run that dies before the full seat-flow seed below wrote status.json from the FAILURE writer, with
    // no `ref` — so `findRunsByRef` never saw it, `roundSettlement` got `runStates 0` + `markers 0`, and
    // the round settled to "unknown" forever. Re-reading it re-stamps unknown. Measured: one round
    // permanently unclosable, its run dir on disk the whole time with a complete diagnosis in it, while
    // the operator was told the evidence "may have been torn down".
    //
    // TWO PREFLIGHTS REACHED THE FAILURE WRITER BEFORE THE SEED, not one. The register-count refusal
    // below is the one that produced the specimen; a PERPLEXITY_API_KEY refusal above it was the same
    // orphan by a different door. Fixing either call site alone would have left the other, which is why
    // the identity goes HERE — above every refusal — rather than into a refusal's own writer.
    // THE SECOND DOOR IS GONE ( acceptance 6 made it a skip), and that does not make this
    // placement redundant: it is what keeps the next refusal added above the seed from re-orphaning its
    // run. Moving this stamp down into the surviving refusal's writer would rebuild the bug.
    //
    // Merged, not replaced: `writeRunStatus` merges, so the full seed further down still writes the step
    // flow, the mark names and everything else. This carries the fields that answer "which run and which
    // round is this", and nothing that would claim progress it has not made.
    //
    // `startedAt` now backfills HERE rather than at the failure, which is more honest and is the
    // documented first-write-wins behaviour (A3, progress.mjs) rather than a change to it.
    writeRunStatus(ctx, {
      schema: 1, id: job.id, runId, slug: run.slug, codename: run.codename,
      date: run.date, agent, forwarder: job.forwarder, ref: job.ref ?? null,
      state: "running", lane: "knockout",
      // — and the PROCESS and BUILD identity for the same reason the run
      // identity is here: a knockout refused in preflight is exactly the run whose record nobody can
      // otherwise attribute, and it is the one most likely to be asked about. Found by the derived
      // guard (driver/test/both-lanes-seed-identity.test.mjs), not by the issue, which named only the
      // seed further down.
      ...identitySeed(),
    }, null, { critical: true });   // door B — this write's failure is the one that must not be silent

    mkdirSync(K.researchDir, { recursive: true });
    attachKnockoutFramework(ctx);

    // Lane preflight (the doc-27 discipline, knockout flavour). This USED TO REFUSE the whole screen
    // when the live sweep had no credential. It no longer does ( acceptance 6): the resolver
    // returns a SKIP instead, the sweep is never attempted, and the screen delivers its register half
    // with the missing half disclosed. The reason the refusal existed is preserved, not discarded —
    // "the cred-guard degrades every mark per-call and the batch dies all-failed only AFTER the paid
    // frame turn" is exactly what a skip prevents, and prevents earlier than a throw did.
    // (pipelineInner's register preflight is skipped for this lane — knockout has no register machinery.)
    const sweep = resolveSweepExecutor(opts);

    // Depth 2 preflight — the SAME discipline, for the register count. Both refusals it can return
    // are structural (a provider that cannot count; a territory scope it cannot express), so they are
    // settled here, once, before the paid frame turn — never twenty identical per-mark failures and a
    // published report with an empty column where the product should have been.
    const probeWanted = Boolean(policy.components?.registerProbe);
    let countExec = { count: null, source: "none" };
    if (probeWanted) {
      const registerAdapter = activeProvider();
      const caps = capabilitiesFor(REGISTER_PROVIDER);
      countExec = resolveCountExecutor({
        counter: opts?.countExecutor ?? null, adapter: registerAdapter,
        agentId: agent, sessionKey: `prelim-${run.slug}-${run.codename}`,
        recordLog: runRecordLogPath(run.runDir),
        // FROM THE JOB, not the environment. Whether this run calls a real register
        // is a fact about the run, so it arrives with the run and lands on its record.
        fixtureDir: job?.registerFixtures?.counts ?? null,
      });
      // EVERY required variable. `Boolean(process.env[credEnv])` here was a half-check: it
      // reported "credential present" for a euipo instance holding the id and no secret, and would
      // have done the same for a free-tier instance holding one member of two. fixed the
      // same bug in preflightCredentials and left this site; one predicate now serves both.
      //
      // Computed ONCE and passed BOTH ways: the boolean decides, the names go into the sentence.
      // Recomputing inside the refusal string would be a second read of the environment between the
      // decision and the message, which is how a refusal comes to name a variable that is set.
      const missing = countExec.source === "provider" ? missingCredentials(registerAdapter) : [];
      // — the offices this box cannot reach, COMPUTED ONCE for both Depth 2 lanes and for the
      // refusal below, for the same reason `missing` is computed once above: a second read of the
      // environment between the decision and the message is how a refusal comes to name a variable
      // that is set, and here it would also let the count lane and the record lane narrow to different
      // scopes on the same run.
      //
      // ONLY when the counter is the real provider. On fixtures or an injected counter the offices this
      // deployment can reach are not what the lane is talking to, and splitting on them would defer a
      // register the fixture holds — a $0 lane reporting a gap it does not have (the shape 's
      // sibling defect had, and the reason `missing` carries the same guard).
      const unreachable = countExec.source === "provider" ? registerUnavailableOffices(caps) : [];
      ctx.registerUnreachable = unreachable;
      const refusal = countPreflight({
        capabilities: caps, jurisdictions: job.jurisdictions ?? null,
        hasAdapter: countExec.source !== "none",
        credentialPresent: missing.length === 0,
        missing, unreachable,
      });
      // — A REFUSAL, STAMPED AS ONE. Every arm countPreflight can return is the product declining
      // an ORDER against THIS DEPLOYMENT before a single token is bought: a provider that cannot count,
      // a credential this box does not hold, a territory the provider does not cover, a register it
      // covers and this install cannot reach. None of them is the engine breaking, and no retry moves
      // any of them — the remedy is always the order or the deployment. Recorded unstamped, correct
      // product behaviour landed in the failure channel and the failure counts stopped meaning anything.
      //
      // `failClass: "deterministic"` says the same thing to the OTHER reader: repairs.mjs's ladder. It
      // was stamped when this lane had no ladder for it to reach — "so the fact travels with the throw
      // rather than being re-guessed from prose by whichever catch the throw ends up in." As of tracker
      // issue 1889 that catch is this lane's own, the stamp is LIVE, and it is what buys this refusal
      // zero parks without the ladder having to read a word of the prose.
      if (refusal) throw new StageFailure("knockout-register-count", refusal, null,
        { refusal: true, failClass: "deterministic" });
      ctx.registerCaps = caps;
      if (unreachable.length)
        note(`register offices unreachable on this deployment: ${unreachable.map((u) => `${u.office} (${u.memberId}: ${u.missing.join(" + ")} unset)`).join(", ")} — the lane counts and lists the rest and discloses these on every mark`);
    }

    // intake artifacts + the code-authoritative instructed scope (mirrors pipelineInner's blocks —
    // dispatch happens before them, so this lane writes its own; the frame validator reads THIS file).
    try {
      if (job.rawRequest) writeFileSync(P.inboundRequest, String(job.rawRequest));
      if (job.brief) writeFileSync(P.confirmationBrief, String(job.brief));
    } catch (e) { note(`intake artifact write failed (non-fatal): ${e.message}`); }
    const markRows = Array.isArray(job.marks)
      ? job.marks.map((m) => (typeof m === "string" ? { name: m } : m)).filter((m) => m?.name)
      : [job.markName ?? job.name].filter(Boolean).map((name) => ({ name }));
    const markNames = markRows.map((m) => String(m.name));
    // research artifacts key on kebab(name) — a collision would silently share one payload between two
    // marks (validateJob clarifies this at intake; this guard covers direct dispatch).
    const koll = kebabCollisions(markNames);
    // `failClass: "factual"` — stamped because gave this lane a ladder that would
    // otherwise GUESS. The reason text matches neither classifier regex, so the guess is UNKNOWN, and
    // UNKNOWN buys one park: a ~$2 re-run of a job whose two mark names collide exactly as they did
    // before, ending in the identical throw two minutes later. FACTUAL rather than DETERMINISTIC on the
    // doctrine repairs.mjs states — deterministic means the repairs already ran and retry is futile;
    // factual means no retry can answer it because the answer is a person's. This throw's own remedy
    // sentence says which one it is: reword or drop one and re-enqueue. Both classes buy zero parks, so
    // the choice changes no behaviour — it changes the terminal kind the operator reads.
    if (koll.length)
      throw new StageFailure("knockout-scope", `marks ${koll.map(([a, b]) => `"${a}"/"${b}"`).join(", ")} collide to the same research key — reword or drop one and re-enqueue`, null,
        { failClass: "factual" });
    try {
      writeFileSync(K.instructedScope, JSON.stringify({
        marks: markNames, classes: job.classes ?? null, jurisdictions: job.jurisdictions ?? null,
        goods: job.goods ?? null, customer: job.customer ?? null,
        // per-mark detail (classes/ref from the request, e.g. the cockpit's "NAME [9, 42]" rows) — the
        // frame reads THIS file, so without it those classes silently vanished (review 2026-07-17)
        marksDetailed: markRows.map((m) => ({ name: String(m.name), ...(Array.isArray(m.classes) && m.classes.length ? { classes: m.classes } : {}), ...(m.ref ? { ref: m.ref } : {}) })),
      }, null, 2) + "\n");
    } catch (e) { note(`instructed-scope write failed (non-fatal): ${e.message}`); }

    // status seed — knockout's OWN step flow (never seedRunStatus's clearance stepper). Depth 2
    // walks one more step than a plain knockout, so the list is resolved once and frozen on ctx.
    const STEPS = ctx.koSteps = koSteps({ registerProbe: probeWanted });
    writeRunStatus(ctx, {
      schema: 1, id: job.id, runId, slug: run.slug, codename: run.codename,
      date: run.date, agent, forwarder: job.forwarder, ref: job.ref ?? null,
      // ONE SPELLING (progress.mjs batchMarkName). This line composed "IRONWHISK (+2 marks)" while the
      // publisher composed "IRONWHISK +2 more" for the SAME batch, so a run changed its name at delivery
      // and the browser — which threads reads on the name string — listed a batch's live face and its own
      // delivered face as two different marks. It also read "(+1 marks)" on every two-mark batch: the
      // same unguarded plural the publisher's title carried until.
      markName: batchMarkName(markNames),
      // THE NAMES THEMSELVES, so a surface can count them. status.json carried a mark STRING and nothing
      // countable, so the portal's live row sent `marks: []` and the Result screen — which reads that
      // array as a name count — told the customer a three-name batch had "0 names" for the whole run.
      // Bands stay off: a live batch has not been rated, and inventing one is the opposite failure.
      marks: markNames.map((name) => ({ name })),
      classes: job.classes ?? null, state: "running", lane: "knockout", stageLabel: policy.stageLabel,
      // — WHO IS RUNNING THIS AND WHICH BUILD. This lane opts out of the
      // clearance STEPPER (see the step list above) and used to lose the identity fields with it, so no
      // knockout run could be attributed to a commit by its own status.json and none was ever eligible
      // for reconcile-runs' exact liveness test. The stepper and the identity are separate calls now.
      ...identitySeed(),
      stepIndex: 0, stepLabel: STEPS[0], stepN: 1, stepTotal: STEPS.length,
      verdict: null, url: null, failedStage: null, reason: null, deliveredAt: null,
      // A5/A3: a re-run of a previously-terminal knockout may reopen the state ONLY because the resume
      // guard cleared the sentinel (ctx.stateReset threads that authority); startedAt is no longer
      // seeded anywhere — writeRunStatus backfills it first-write-wins.
      ...(ctx.stateReset ? { __stateReset: true } : {}),
    });
    rollupStatus(run.studioRoot);
    note(`=== KNOCKOUT batch (${policy.stageLabel}) — ${markNames.length} mark(s), framework ${ctx.framework.framework_key} ===`);

    // 1 — frame
    await koStage("knockout-frame", ctx);
    const plan = JSON.parse(readFileSync(K.plan, "utf8"));
    const planMarks = plan.marks;

    // 1.5 — STAGE 0.5: the register hit-counts. Pure code — no stage, no model, no turn. It runs
    // BEFORE the sweep because it is the cheap deterministic question and the client sees its answer
    // first; it runs after the frame only so the batch's shape is settled and a frame failure costs
    // nothing at the register. Its own inputs come from the REQUEST, not from the plan (below).
    let registerCounts = null;
    if (probeWanted) {
      koStep(ctx, KO_STEP_REGISTER_COUNT);
      ensureDriverDir(run.runDir);
      // resume: a settled prior sidecar is reused cell by cell, so a re-run never re-bills a count that
      // already landed — including across a build that ADDED a predicate, where only the new column is
      // bought (register-count.mjs cellSettled).
      let prior = null;
      try { prior = JSON.parse(readFileSync(K.registerCounts, "utf8")); } catch { /* first attempt */ }
      const doc = await countRegisterHits({
        // Scope comes from the REQUEST (markRows / job.classes), never from the frame's plan. The plan
        // is a model output, and its per-mark classes may carry the frame's own belt-and-braces
        // inference — fine for shaping a research prompt, wrong for a figure the client reads as
        // "filings in my classes". The names are identical either way (the frame validator enforces
        // one row per instructed mark, verbatim), so this is a scope decision, not a set difference.
        marks: markRows.map((m) => ({ name: String(m.name), classes: Array.isArray(m.classes) ? m.classes : null })),
        classes: job.classes ?? null, jurisdictions: job.jurisdictions ?? null,
        provider: REGISTER_PROVIDER, capabilities: ctx.registerCaps,
        counter: countExec.count, ledgerPath: K.countLedger, prior,
        unreachable: ctx.registerUnreachable ?? [],   // — computed once at preflight, above
        concurrency: 3,   // step 3 — was a knob; no environment ever set it
        // The close-variation fan-out's ceiling. A deployment may buy FEWER forms per mark than the code
        // cap — on Corsearch each form is a billable search — and may not buy more: variantForms clamps
        // to VARIANT_CAP, so this knob can only ever narrow. Unset ⇒ the code cap, which is the answer
        // for every deployment that has not thought about it.
        ...(process.env.CLEAROTRON_KNOCKOUT_VARIANT_CAP ? { variantCap: Number(process.env.CLEAROTRON_KNOCKOUT_VARIANT_CAP) } : {}),
      });
      const counted = countedMarks(doc);
      // Not one mark got a number. The count IS this product — a batch published now would be a plain
      // knockout wearing a Depth 2 label and price, which is the silent substitution the whole
      // search-policy registry exists to forbid. Terminal, with the provider's own reason on it.
      if (!counted) {
        const why = doc.marks?.[0]?.counts?.[Object.keys(doc.marks[0].counts)[0]]?.unavailable ?? "no reason recorded";
        throw new StageFailure("knockout-register-count",
          `no register count could be taken for any of the ${planMarks.length} mark(s) via ${REGISTER_PROVIDER} (executor ${countExec.source}) — first cause: ${String(why).slice(0, 200)}`, null);
      }
      atomicWrite(K.registerCounts, JSON.stringify(doc, null, 2) + "\n");
      registerCounts = doc;
      runLog(run.runDir, { event: "knockout-register-counts", provider: REGISTER_PROVIDER, executor: countExec.source, marks: doc.marks.length, counted, regions: doc.scope.regions ?? "worldwide" });
      if (counted < doc.marks.length) note(`register counts: ${doc.marks.length - counted}/${doc.marks.length} mark(s) unavailable — the batch continues (they publish as "not available", never as zero)`);

      // ── 1.6 — THE FILINGS BEHIND THE NARROW COUNTS ( part 5) ─────────────────────────────────
      //
      // NEVER TERMINAL, and that is the difference between this lane and the one above it. The counts
      // ARE the product — none of them means no product, so the run dies. The listing EXPLAINS the
      // counts: a batch that got its numbers and could not fetch the faces behind them is a smaller
      // deliverable, not a wrong one, and killing the run would throw away the part that was paid for.
      // Every failure lands as a recorded reason on the surfaces instead.
      const recExec = resolveRecordExecutor({
        lister: opts?.recordLister ?? null, adapter: activeProvider(),
        agentId: agent, sessionKey: `prelim-${run.slug}-${run.codename}`,
        // — this run's record log, not the box's. The knockout lane never reads the record bodies
        // its batch-screen hydration writes; before this they were pure growth on a global file.
        recordLog: runRecordLogPath(run.runDir),
        // The $0 guarantee, threaded rather than re-derived: if the COUNTS ran on fixtures, this lane
        // may not reach a live register. resolveRecordExecutor refuses instead of falling through.
        offline: countExec.source.startsWith("fixtures:"),
        fixtureDir: job?.registerFixtures?.records ?? null,
      });
      const recRefusal = countExec.source.startsWith("fixtures:") && recExec.source === "none"
        // NAMES WHAT THE READER CAN ACT ON. This said `CLEAROTRON_KNOCKOUT_RECORD_FIXTURES` — a variable that
        // no longer exists — so the sentence now names the job field that does.
        ? "this run counted from fixtures and its job declares no `registerFixtures.records` directory, so the "
          + "filings behind the counts were not listed — a fixture run never reaches a live register."
        : recordsPreflight({ capabilities: ctx.registerCaps, hasAdapter: recExec.source !== "none" });
      if (recRefusal) {
        // A structural refusal is RECORDED, not swallowed. Without a sidecar the surfaces cannot tell
        // "this provider does not list filings" from "nobody asked", and the second reads as an
        // omission — the same silence part 2 closed one section up.
        atomicWrite(K.registerRecords, JSON.stringify({
          schema: 1, provider: REGISTER_PROVIDER, providerLabel: ctx.registerCaps?.label ?? REGISTER_PROVIDER,
          takenAt: new Date().toISOString(), unavailable: recRefusal, marks: [],
        }, null, 2) + "\n");
        note(`register filings not listed: ${recRefusal}`);
        runLog(run.runDir, { event: "knockout-register-records-refused", provider: REGISTER_PROVIDER, reason: recRefusal });
      } else {
        try {
          const recDoc = await listRegisterRecords({
            marks: markRows.map((m) => ({ name: String(m.name), classes: Array.isArray(m.classes) ? m.classes : null })),
            classes: job.classes ?? null, jurisdictions: job.jurisdictions ?? null,
            provider: REGISTER_PROVIDER, capabilities: ctx.registerCaps,
            lister: recExec.list, ledgerPath: K.countLedger,
            // — the SAME split the counts used. Re-deriving it here would let the two halves of one
            // report narrow to different scopes; `recExec` can also be a fixture lister while the counts
            // ran live, and the offices a fixture holds are not this box's.
            unreachable: recExec.source === "provider" ? (ctx.registerUnreachable ?? []) : [],
            concurrency: 3,   // step 3 — the same constant as the sibling call above
            ...(process.env.CLEAROTRON_KNOCKOUT_RECORD_CAP ? { cap: Number(process.env.CLEAROTRON_KNOCKOUT_RECORD_CAP) } : {}),
            ...(process.env.CLEAROTRON_KNOCKOUT_VARIANT_CAP ? { variantCap: Number(process.env.CLEAROTRON_KNOCKOUT_VARIANT_CAP) } : {}),
          });
          atomicWrite(K.registerRecords, JSON.stringify(recDoc, null, 2) + "\n");
          runLog(run.runDir, { event: "knockout-register-records", provider: REGISTER_PROVIDER, executor: recExec.source,
            marks: recDoc.marks.length, listed: listedMarks(recDoc), records: recDoc.marks.reduce((n, m) => n + m.records.length, 0) });
        } catch (e) {
          // The lane does not throw per mark, so reaching here means something structural broke. It
          // still must not take the counts down with it — but it must not vanish either.
          note(`register filings listing failed (non-fatal): ${e.message}`);
          runLog(run.runDir, { event: "knockout-register-records-failed", provider: REGISTER_PROVIDER, cause: String(e?.message ?? e).slice(0, 300) });
        }
      }
    }

    // 2 — the sweep: ONE broad code-side research call per mark, receipted, per-mark degrade
    koStep(ctx, "Sweeping marks");
    const { exec, source } = sweep;
    const preset = process.env.CLEAROTRON_KNOCKOUT_PRESET || "pro-search";
    // step 3 — was a knob; no environment ever set it. The `Number.isFinite` guard beside it went
    // with the read: a constant cannot be typo'd, which is the hazard that guard existed for.
    const concurrency = 3;
    let callNo = 0;
    const degraded = new Map();
    const outaged = new Set();   // the subset of `degraded` whose cause was a 429/5xx — see the all-failed branch
    const recovered = [];   // previously-degraded marks whose re-sweep succeeded — their stale assess chunks must be invalidated
    if (sweep.skipped) {
      // acceptance 6 — NOT ATTEMPTED. No executor is called, so nothing is billed, nothing can
      // 429, and no `.failed` sentinel is written: there is no failure here to record, and writing one
      // would tell a resumed run that a sweep was tried.
      //
      // Every mark takes the named cause, and that is the ENTIRE downstream wiring. The assess stage
      // already reads it (stages-knockout.mjs renders "(DEGRADED: … — apply the null-results doctrine,
      // never inflate)"), verify-knockout.mjs already REFUSES a row that holds no payload and does not
      // carry degraded:true plus a manual-verification note, and the renderers already print it. The
      // null-results doctrine carries this case; it needed no new path, only a cause.
      for (const m of planMarks) degraded.set(m.name, CAPABILITY_SKIPPED_CAUSE[sweep.skipped] ?? sweep.skipped);
      runLog(run.runDir, { event: "knockout-sweep-skipped", marks: planMarks.length, executor: source, cause: sweep.skipped });
      note(`knockout sweep: not run (${sweep.skipped}) — the screen delivers its register half and discloses the rest`);
    } else {
    runLog(run.runDir, { event: "knockout-sweep-start", marks: planMarks.length, executor: source, preset, concurrency });
    await runBatched(planMarks, concurrency, async (m) => {
      const out = K.research(kebab(m.name));
      if (existsSync(out)) return;   // per-mark resume: only missing payloads re-sweep
      const hadFailed = existsSync(out + ".failed");
      const task = knockoutPrompt(m, plan.batch, { jurisdictions: job.jurisdictions ?? null });
      const started = Date.now();
      const n = ++callNo;
      let r;
      try { r = await exec(task, { mark: m.name, preset }); }
      catch (e) { r = { ok: false, cause: `executor threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
      const row = {
        ts: new Date().toISOString(), mark: m.name, callNo: n, preset, executor: source,
        took_ms: r?.tookMs ?? (Date.now() - started), bytes: r?.bytes ?? (r?.text ? Buffer.byteLength(r.text) : 0),
        ok: Boolean(r?.ok), ...(r?.ok ? {} : { cause: String(r?.cause ?? "unknown").slice(0, 300) }),
      };
      try { appendFileSync(K.sweepLedger, JSON.stringify(row) + "\n"); } catch { /* receipts best-effort, never fatal */ }
      if (r?.ok && r.text) {
        writeFileSync(out, r.text);
        if (hadFailed) {
          try { rmSync(out + ".failed"); } catch { /* best-effort */ }
          recovered.push(m.name);
        }
      } else {
        degraded.set(m.name, row.cause ?? "research unavailable");
        if (r?.outage === true) outaged.add(m.name);
        writeFileSync(out + ".failed", `research failed: ${row.cause ?? "unknown"}\n`);
      }
    });
    if (degraded.size >= planMarks.length) {
      // EVERY mark failed. Whether that ends the batch or pauses it depends on why, and until now it
      // always ended it: the throw carried a prose reason, and StageFailure sets `rateLimited` by an EXACT
      // string match on `reason === "rate_limited"`, so `rateLimited` was false, the lane's own catch wrote
      // .failed immediately, so the run reported a hard failure for a provider hiccup. When this was
      // written the rate-limit re-throw through pipeline()'s outer catch was the lane's ONLY escape
      // hatch and this path could not reach it. added a second one — the class-aware
      // ladder in the catch below — and an outage-shaped reason classifies TRANSIENT there, so this
      // block is no longer the difference between a park and a dead run. It stays because it is the
      // BETTER answer: `rate_limited` postpones on the provider's own clock through the outer catch,
      // where the ladder would spend a recovery attempt to learn the same thing.
      //
      // ALL of them must be outage-shaped, not merely one. A batch where two marks hit a 429 and one hit a
      // bad key is a broken configuration wearing an outage's clothes; parking it would auto-resume
      // forever and bury the real error. Anything mixed, anything unexplained, stays terminal.
      //
      // resetsAt is null: the provider does not surface Retry-After through this path, and runner.mjs's
      // postponedDueAt already applies the default backoff for a null. Better an honest null than a
      // fabricated deadline.
      if (outaged.size >= planMarks.length) {
        note(`knockout sweep: all ${planMarks.length} research calls failed with an outage-shaped status — postponing rather than failing the batch`);
        runLog(run.runDir, { event: "knockout-sweep-outage", marks: planMarks.length, executor: source });
        throw new StageFailure("knockout-sweep", "rate_limited", null);
      }
      throw new StageFailure("knockout-sweep", `all ${planMarks.length} research calls failed (executor ${source}) — nothing to assess`, null);
    }
    if (degraded.size) note(`knockout sweep: ${degraded.size}/${planMarks.length} mark(s) degraded — the batch continues (null-results doctrine)`);
    }

    // 3 — assess (chunked ≤8/turn; merged + gated in code). DEGRADED per the DISK truth (payload
    // presence), never the in-memory Map alone — resume-proof: a prior attempt's degrades count too.
    koStep(ctx, "Knockout assessment");
    const chunkRows = planMarks.map((m) => {
      const has = existsSync(K.research(kebab(m.name)));
      return { name: m.name, degraded: has ? null : (degraded.get(m.name) ?? "research unavailable (prior attempt)") };
    });
    const chunks = koChunks(chunkRows);
    // the assignment sidecar — the per-chunk validator joins each chunk's marks against THIS (membership
    // is enforced in code, not prompted); deterministic from the frozen plan, so a resume re-mints equal.
    atomicWrite(driverDir(run.runDir, "knockout-chunks.json"),
      JSON.stringify({ schema: 1, chunks: chunks.map((ch) => ch.map((m) => m.name)) }, null, 2) + "\n");
    // a recovered mark's evidence changed — its prior assess chunk is STALE by construction; drop it so
    // the stage re-runs (otherwise the re-sweep was billed for nothing and the fresh payload never read).
    if (recovered.length) {
      for (let c = 0; c < chunks.length; c++) {
        // Both locations: a stale chunk left at the pre-relocation path must be invalidated too, or a
        // resumed run reads the STALE one through the fallback below and the re-sweep is billed for nothing.
        if (chunks[c].some((m) => recovered.includes(m.name)) && (existsSync(K.assessChunk(c)) || existsSync(K.assessChunkLegacy(c)))) {
          try { for (const f of [K.assessChunk(c), K.assessChunkLegacy(c)]) if (existsSync(f)) rmSync(f); runLog(run.runDir, { event: "knockout-assess-invalidated", chunk: c, recovered: chunks[c].filter((m) => recovered.includes(m.name)).map((m) => m.name) }); } catch { /* best-effort */ }
        }
      }
    }
    for (let c = 0; c < chunks.length; c++) {
      await koStage("knockout-assess", ctx, { chunkNo: c, msgCtx: { chunkMarks: chunks[c], chunkTotal: chunks.length, framework: ctx.framework } });
    }
    const merged = { schema_version: 1, framework: null, batch: null, marks: [] };
    const summaries = [];
    for (let c = 0; c < chunks.length; c++) {
      // READ prefers the new location and falls back to the pre-relocation one, so a run whose chunks
      // were written before the move (or through the Bash bypass closed) resumes without paying for
      // a re-dispatch. Nothing writes the legacy path any more — see stages-knockout.mjs.
      const chunkPath = existsSync(K.assessChunk(c)) ? K.assessChunk(c) : K.assessChunkLegacy(c);
      const part = JSON.parse(readFileSync(chunkPath, "utf8"));
      if (c === 0) { merged.framework = part.framework ?? { source: ctx.framework.framework_key, ladder: ctx.framework.bands.map((b) => b.label) }; merged.batch = part.batch ?? null; }
      if (typeof part.chunkSummary === "string" && part.chunkSummary.trim()) summaries.push(part.chunkSummary.trim());
      merged.marks.push(...(part.marks ?? []));
    }
    if (!merged.batch) merged.batch = { productContext: plan.batch.productContext, standardCaveats: [] };
    // the WHOLE-batch executive summary = the per-chunk summaries, composed in code (every chunk's
    // validator required one, so no mark's chunk is silently absent — review 2026-07-17)
    merged.batch.executiveSummary = summaries.join("\n\n");
    // ── THE PENDING-REGISTER CAVEAT, CONDITIONAL SINCE RF-10 v3 ────────────────
    //
    // "Ratings reflect our common law assessment. Register analysis may adjust ratings in either
    // direction." This is a CODE DEFAULT that fires when the model supplied no caveat of its own, and
    // turned it from dormant into the thing that ships.
    //
    // BEFORE: knockout-assess calibration rule 4 ordered the seat to write that caveat, so the array
    // arrived non-empty and this default almost never fired. THAT RULE IS RETIRED IN THIS SAME BRANCH —
    // the seat is no longer told to write it — so the array now arrives EMPTY and this line injects the
    // sentence unconditionally. Retiring the rule in the doctrine while leaving its default in the code
    // did not remove the caveat; it made it fire on every run.
    //
    // And it is FALSE on the runs it now fires on. The rater is handed this run's fetched register
    // filings and weighs them, so "register analysis may adjust ratings" describes work that already
    // happened. RF-10 v3 (synthesis-rules.md): when register analysis ran AND surfaced live filings,
    // drop the caveat and cite the register evidence directly; where it did not run, it stands and is
    // the honest thing to say.
    //
    // THE DRIVER'S READ, off the run. A seat that could assert whether the register ran could waive its
    // own caveat. Records present AND non-empty: a file that exists with nothing in it is a register
    // that surfaced no filings, which is exactly the case the caveat is still true for.
    // — ONE DERIVATION, shared with the verifier. This was a private copy, and the
    // lint that checks the result did not have it: it required the caveat unconditionally while this
    // injected it conditionally, so any run where the seat supplied its own caveats failed by
    // construction. Two predicates that must agree forever is how they stop agreeing.
    // — THE SAME DERIVATION THE LINT USES. This counted the array, blanks included, so
    // `["", "  "]` read as "the rater supplied two" here and as "supplied none" in the verifier. The lint
    // could not see the disagreement because the survivor sentence below silenced it entirely.
    if (raterCaveats(merged.batch.standardCaveats).length === 0 && !registerSurfacedFilings(K.registerRecords)) {
      merged.batch.standardCaveats = ["Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction."];
    }
    if (!Array.isArray(merged.batch.standardCaveats)) merged.batch.standardCaveats = [];
    // ── the survivor sentence, in CODE ( fix 3) ────────────────────────────────────────────────────
    //
    // A mark this lane did not knock out is a SURVIVOR. It is not clear, and the document must not be
    // readable as though it were: the knockout screens, the clearance enumerates, and the whole distance
    // between them is the work that has not happened yet. Two runs on two matters delivered "Medium,
    // complete" while missing almost every mark the lawyer named, because a screen cannot know what it
    // did not look for — so the boundary of the screen is stated by the engine rather than left to the
    // assessing model, which is the one party that cannot see it.
    //
    // APPENDED, never prepended: publish/knockout.mjs's email takes standardCaveats[0], so leading with
    // this would silently replace the standing caveat in the requester's inbox.
    const survivorNote = survivorBoundaryNote(policy);
    if (!merged.batch.standardCaveats.some((c) => SURVIVOR_BOUNDARY_RE.test(String(c))))
      merged.batch.standardCaveats.push(survivorNote);
    // ── the skipped-capability sentence, in CODE, for the survivor sentence's own reason ──────
    //
    // The per-mark degrade above already reaches the client on every row. This is the RUN-level fact
    // underneath twenty identical rows: not "research was unavailable for this name" twenty times, but
    // one capability that never ran on this deployment. The assessing model cannot state it — it is
    // told a mark is degraded, never why the whole screen is — so the engine states it, exactly as it
    // states the survivor boundary two lines up.
    //
    // APPENDED, never prepended, for the same reason the survivor note is: publish/knockout.mjs's email
    // takes standardCaveats[0], and leading with this would silently replace the standing caveat in the
    // requester's inbox.
    const skippedNote = sweep.skipped ? CAPABILITY_SKIPPED_NOTE[sweep.skipped] : null;
    if (skippedNote && !merged.batch.standardCaveats.some((c) => String(c) === skippedNote))
      merged.batch.standardCaveats.push(skippedNote);
    // The merged gate now also validates the TYPED findings and receipts their citations, and it
    // NORMALISES as it validates — each finding's band comes back in the frozen deck's own casing — so
    // it runs BEFORE the artifact is written, not after. The counts are logged because a receipts pass
    // over zero citations is a different fact from a receipts pass, and only the count can tell them
    // apart afterwards.
    const mv = validateMergedFindings(run.runDir, merged, plan);
    if (!mv.ok) throw new StageFailure("knockout-assess", `merged findings failed the lint: ${mv.failures.join("; ")}`, null);
    runLog(run.runDir, { event: "knockout-receipts", ...mv.receipts });
    atomicWrite(K.findings, JSON.stringify(merged, null, 2) + "\n");
    try { writeFileSync(K.assessment, String(merged.batch.executiveSummary ?? "")); } catch { /* prose mirror, best-effort */ }

    // 4 — publish (report + workbook + meta + index)
    koStep(ctx, "Report & publish");
    const overall = worstBand(ctx.framework, merged.marks);
    const published = await publishKnockout({
      runId, codename: run.codename, runDir: run.runDir,
      findings: merged, plan, framework: ctx.framework, overall,
      poolRoot: config.poolRoot, poolUrl: config.poolUrl ?? envFrom(process.env, "CLEAROTRON_REPORTS_URL") ?? null,
      customerKey: ctx.profile?.profileKey ?? "generic",
      // — the frozen profile's delivery overlay decides the confidentiality marking, exactly as it
      // does on the clearance lane. Absent (an unbound run, or a profile silent on the field) is the
      // NO-OPINION state and gets the plain default; only an explicit `privileged:false` suppresses it.
      delivery: ctx.profile?.delivery,
      searchPolicy: policy, tokens: (() => { try { return rollupTokens(run.runDir).total; } catch { return null; } })(),
      registerCounts,
    });
    runLog(run.runDir, { event: "knockout-published", url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })), overall, marks: merged.marks.length });
    // The knockout lane put its token total in the PUBLISHED ARTIFACT but never stamped the run itself,
    // so `status.json.tokens` was empty for every Stage-0 run however it ended (fixed 2026-07-28) — and
    // a Stage-0 run appeared in no account-level consumption view at all.
    recordRunConsumption(ctx, { phase: "delivered", tokens: stampTokenRollup(run.runDir, "delivered") });

    // 5 — delivery handoff (byte-faithful to pipelineInner's packet contract; cross-ref pipeline.mjs)
    koStep(ctx, "Sending to you");
    // qcFlags: the projected predelivery-lint lines publishKnockout just computed and recorded — the
    // cover note enumerates exactly what the workbook does (A10, extended to this lane 2026-07-31).
    // They are FLAGS: the packet, the state and the send below are byte-identical with or without them.
    const emailHtml = composeKnockoutEmail({ findings: merged, framework: ctx.framework, overall, reports: published.reports, auditUrl: published.auditUrl, job, registerCounts, qcFlags: published.qcFlags });
    writeFileSync(K.emailBody, emailHtml);
    const nMarks = merged.marks.length;
    const refTag = job.ref ? ` (${job.ref})` : "";
    const packet = {
      runId, agent,
      forwarder: job.forwarder, forwarderEmail: job.forwarderEmail, msgId: job.msgId,
      conversationId: job.conversationId ?? null,
      subject: `Knockout trademark review — ${job.ref ?? markNames[0] ?? "batch"} (${nMarks} mark${nMarks === 1 ? "" : "s"})`,
      emailBodyHtml: emailHtml,
      whatsappTo: AGENT_WHATSAPP[agent] ?? null,
      // ONE LINE, N LINKS. This said "Report: <one url>" and on a batch that url is now null, which would
      // have read "Report: null" — the fail-visible shape doing its job, and still not a line to send. A
      // batch names every report it produced, in the order the names were ordered.
      whatsappText: `✅ Knockout screen${refTag} of ${nMarks} mark(s) is done — worst band ${overall}. `
        + (published.reports.length === 1
          ? `Report: ${published.reports[0].url}`
          : `Reports: ${published.reports.map((r) => `${r.mark} ${r.url}`).join(" · ")}`),
      // `url` is the run's single report, and NULL for a batch — publishKnockout's own rule, carried
      // through rather than papered over. `reports` is where a batch's documents are, and docs/DELIVERY.md
      // says so: an integrator that only knows `url` gets null on a batch and fails visibly, instead of
      // mailing the first of eight names as though it were the answer.
      url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })),
      verdict: overall, markName: batchMarkName(markNames),
    };
    try { rmSync(join(run.runDir, ".sent")); } catch { /* none */ }
    try { rmSync(driverDir(run.runDir, "send-receipts.json"), { force: true }); } catch { /* none */ }
    try { rmSync(driverDir(run.runDir, "failure.json")); } catch { /* none */ }
    writeFileSync(driverDir(run.runDir, "delivery.json"), JSON.stringify(packet, null, 2) + "\n");
    try {
      mkdirSync(config.outboxDir, { recursive: true });
      writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${agent}\n`);
    } catch (e) { note(`delivery: outbox marker write skipped (${String(e.message).slice(0, 100)})`); }
    const deliveredAt = new Date().toISOString();
    writeRunStatus(ctx, { state: "delivered", verdict: overall, statement: published.statement, url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })), deliveredAt, sendPending: true, stepIndex: STEPS.length - 1, stepLabel: STEPS[STEPS.length - 1], stepN: STEPS.length, stepTotal: STEPS.length });
    // — the knockout lane's pool copy learns its terminal state the same way,
    // for the same reason: publish returns the pool dir, and `state: "delivered"` is decided after it
    // returns. Same seam, same best-effort contract, no lane-specific exception to write down.
    const stamp = writeSettleStamp(published.poolRunDir, { state: "delivered", verdict: overall, deliveredAt, runId: published.runId ?? run.runId, lane: "knockout" });
    if (!stamp.written) note(`delivery: settle stamp not written (${stamp.reason})`);
    const archived = archive(run);
    rollupStatus(run.studioRoot);
    sentinel(archived ?? run.runDir, ".delivered", { verdict: overall, url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })), notified: "pending", sendPending: true, archived, lane: "knockout" });
    note(`=== KNOCKOUT DELIVERED (${nMarks} marks, worst ${overall}) → ${published.reports.map((r) => r.url).join(", ") || "no report URL (pool URL unset)"}${archived ? ` — archived → ${archived}` : ""} ===\n`);
    return { ok: true, verdict: overall, url: published.url, reports: published.reports, runDir: archived ?? run.runDir };
  } catch (e) {
    // rate-limit rides to pipeline()'s postpone catch (the shared park+auto-resume lane)
    if (e instanceof StageFailure && e.rateLimited) throw e;
    // STOPPED BY THE USER — terminal, and it must not take the failure lane below: that lane pushes
    // "❌ … FAILED at …" to the customer over the outbox, and someone who pressed Stop must never be
    // told their search broke. Same shape as the clearance lane's cancel terminal (pipeline.mjs).
    if (e instanceof RunCancelled) {
      note(`[knockout] STOPPED ${run?.codename ?? "run"} at ${e.stage} by user request${e.requestedAt ? ` (asked ${e.requestedAt})` : ""} — terminal, nothing delivered`);
      try { sentinel(run.runDir, ".cancelled", { stage: e.stage, requestedAt: e.requestedAt, via: e.via, lane: "knockout" }); } catch { /* best-effort */ }
      try { runLog(run.runDir, { event: "cancelled", stage: e.stage, lane: "knockout" }); } catch { /* best-effort */ }
      try { recordRunConsumption(ctx, { phase: "cancelled", tokens: stampTokenRollup(run.runDir, "cancelled") }); } catch { /* best-effort */ }
      // — the same builder the clearance lane uses; `lane` is carried because a knockout stop and a
      // clearance stop at the same stage name are different runs.
      writeRunStatus(ctx, { state: "cancelled", failedStage: e.stage,
        reason: stopReason({ stage: `${e.stage} (knockout)`, via: e.via, requestedAt: e.requestedAt }) });
      try { rollupStatus(run.studioRoot); } catch { /* best-effort */ }
      return { ok: false, cancelled: true, failedStage: e.stage, codename: run?.codename ?? null, runDir: run.runDir };
    }
    // ── — THE RECOVERY LADDER THIS LANE NEVER HAD ─────────────────────────────
    //
    // The line that stood here said "NO recovery ladder (a knockout re-run is ~$2)", and the comment
    // below it went further: "There is no recovery machinery on this lane to keep it away from."
    // So ANY validator exhaustion ended the run — dead until a human noticed — which is the exact shape
    // the clearance lane fixed after the VENZY bake: an in-stage ladder exhausted on model vocabulary
    // misses, terminal, and a fresh resume converges with high probability.
    //
    // WHY THE PRICE OBJECTION DOES NOT SURVIVE CLASS-AWARENESS. `decideRecovery` buys a park only where
    // a fresh re-sample is the plausible remedy: TRANSIENT gets the ladder, UNKNOWN gets exactly one
    // park, DETERMINISTIC and FACTUAL get NONE — their repairs already ran at the point of defect, so a
    // re-sample re-derives the same failure. And a signature that already parked once is terminal
    // immediately whatever the class guess said. At ~$2 a re-run the worst case for the common case is
    // one extra run, and the failures that would have burned it are exactly the ones that buy nothing.
    //
    // A DESIGNED REFUSAL BUYS NOTHING, AND THAT IS THE EXISTING BEHAVIOUR PRESERVED, NOT A NEW RULE.
    // countPreflight's refusals, a kebab collision — anything `isDesignedRefusal` already marks — is the
    // PRODUCT answering before model work began, not the engine breaking. Re-sampling a refusal re-earns
    // the same refusal and spends money to do it. The check is FIRST, ahead of every artifact below.
    const reason = e instanceof StageFailure ? e.reason : String(e?.stack ?? e);
    const failedStage = e?.stage ?? "knockout";
    const terminalKind = isDesignedRefusal(e) ? REFUSAL_TERMINAL_KIND : null;
    if (!terminalKind) {
      const parked = knockoutRecoveryPark({ ctx, run, e, reason, failedStage, note });
      // A park writes `.postponed` and NO `.failed`; the runner's `res.postponed` branch re-dispatches
      // it, and `pipeline()` re-enters THIS lane by policy, so a knockout park can never resume as a
      // clearance run. Verified structurally: pipeline.mjs dispatches on `searchPolicy.pipeline`.
      if (parked) return parked;
    }
    // terminal — the ladder above declined to buy a park: .failed + the standard failure packet
    // — WAS THIS THE PRODUCT REFUSING, OR THE ENGINE BREAKING? Asked once, here, and carried into
    // every record this block writes. Null on an ordinary failure, so nothing about an ordinary failure
    // changes shape. 's other half — a designed refusal must never reach recovery machinery — was
    // satisfied by construction while the lane had none. It is now satisfied by CODE: the
    // `if (!terminalKind)` above, which asks the refusal question BEFORE the ladder is consulted and is
    // the reason a refusal cannot buy a park. The arms that prove it are in the ladder's own test file.
    // REACHES THIS LANE ( · E11). The fix for "status.json truncates the cause the journal
    // keeps" landed on the clearance terminal and was never ported here, and this is the lane where it
    // bites hardest: countPreflight's refusals run 300–450 characters and every one of them puts the
    // REMEDY in its last sentence. The bare `.slice(0, 200)` cut the refusal at "There is no off",
    // deleting all three of "set the variable and re-run, order a search this deployment covers, or run
    // the plain knockout level" — on a terminal whose entire purpose is to tell an operator what to do.
    // `reason` keeps its 200 chars (it rides the ping); the cut is now STATED and the tail kept beside it.
    const { reason: shortReason, reasonTruncated, reasonFull } = terminalReasonFields(reason);
    sentinel(run.runDir, ".failed", { stage: failedStage, reason, lane: "knockout", terminalKind });
    runLog(run.runDir, { event: "failed", stage: failedStage, reason, lane: "knockout", ...(terminalKind ? { terminalKind } : {}) });
    writeRunStatus(ctx, { state: "failed", failedStage, reason: shortReason, reasonTruncated, reasonFull, terminalKind });
    recordRunConsumption(ctx, { phase: "failed", tokens: stampTokenRollup(run.runDir, "failed") });
    rollupStatus(run.studioRoot);
    // The two failure-notice lanes are MUTUALLY EXCLUSIVE, mirroring pipelineInner's failPingSent gate:
    // the outbox run-failed event is the primary; sendPending + the wake marker are the BACKSTOP only
    // when the event write failed (sendPending has no failure-side clear in the ack_event loop — arming
    // both double-notifies and leaves a permanent SEND PENDING; review 2026-07-17).
    let failPingSent = false;
    try {
      const rich = buildFailurePacket({
        runId, agent, job, failedStage, shortReason, terminalKind,
        reasonVerbatim: String(reason).slice(0, 1000), whatsappTo: AGENT_WHATSAPP[agent] ?? null,
      });
      const packet = {
        kind: "run-failed", ...rich,
        markName: job.markName ?? job.name ?? null, reason: shortReason,
        text: rich.whatsappText,   // the short fallback line legacy relays read (clearance parity)
      };
      writeFileSync(driverDir(run.runDir, "failure.json"), JSON.stringify(packet, null, 2) + "\n");
      failPingSent = Boolean(writeOutboxPacket(`${runId}.failed`, packet));
      if (!failPingSent) {
        // a fresh notice supersedes an older send's skip-guards (a resumed-then-failed-again run must
        // still notify — the .sent/receipts invariant, clearance parity)
        try { rmSync(join(run.runDir, ".sent")); } catch { /* none */ }
        try { rmSync(driverDir(run.runDir, "send-receipts.json"), { force: true }); } catch { /* none */ }
        writeRunStatus(ctx, { sendPending: true });
        mkdirSync(config.outboxDir, { recursive: true });
        writeFileSync(join(config.outboxDir, `${runId}.pending`), `${agent}\n`);
      }
    } catch (nfErr) { note(`knockout failure-notice write skipped (${String(nfErr?.message ?? nfErr).slice(0, 100)})`); }
    note(`=== KNOCKOUT ${terminalKind === REFUSAL_TERMINAL_KIND ? "REFUSED" : "FAILED"} ${run.codename} at ${failedStage}: ${shortReason} ===\n`);
    // `codename`: this lane's terminals reach the SAME CLI exit as the clearance lane's, and the
    // CLI composes its resume line from the returned identity. Without it a knockout operator is the only
    // one left with a failure and no way to know what to type.
    //
    // `terminalKind` — THE SECOND WRITER'S ONLY INPUT. This return does not stop at the CLI:
    // runner.mjs's queue terminal writes it whole into `<base>.failed.result`, and that sidecar is what
    // the E2E round reads for a run whose dir it cannot resolve (scripts/e2e.mjs readMarkerTerminal:
    // `st?.terminalKind ?? result?.terminalKind`). The marker's own SUFFIX stays `.failed` deliberately
    // — the runner writes exactly three (`done`/`cancelled`/`failed`) and the harness's
    // TERMINAL_BY_SUFFIX_RAN knows exactly those, so a fourth would not read as "refused" anywhere; it
    // would read as UNDETERMINED, which is how a refusal disappears instead of being mislabelled.
    return { ok: false, failedStage, reason, terminalKind, codename: run.codename, runDir: run.runDir };
  }
}
