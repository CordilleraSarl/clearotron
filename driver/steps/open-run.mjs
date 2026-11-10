// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/open-run.mjs — what a run settles before its first stage: its order, engine, directory, resume checks and context.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";
import { orderSnapshot } from "../accepted-order.mjs";
import { recordSpan } from "../attributed-span.mjs";
import { activeProvider, config, preflightCredentials, preflightEngineBinary, preflightFreeSpace, preflightResearchCredential, REGISTER_PROVIDER } from "../driver.config.mjs";
import { engineProvenance } from "../engine-build.mjs";
import { preflightEngineTurn } from "../engine/probe.mjs";
import { engineNamed, registeredEngines, selectEngine } from "../engine/registry.mjs";
import { readRunChoices, recordRunChoices } from "../engine/run-choices.mjs";
import { note, runLog } from "../log.mjs";
import { buildRunContext } from "../phase0.mjs";
import { profileStoreResolution } from "../profiles.mjs";
import { RECORDS_MODES, heldRegisterCredentials, savedRecordFetch } from "../record-replay.mjs";
import { policyFor } from "../search-policy.mjs";
import { preflightSkillsStore } from "../skills-store-provenance.mjs";
import { assertTierSanity, paths } from "../stages.mjs";
import { stampTokenRollup } from "../tokens.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export async function openRun({ job, opts }, helpers) {
  const { attachProfile, attachSearchPolicy, depthLadderEvent, findRunDate, resumeStopRefusal } = helpers;
  // The order as it arrived, before anything below folds its scope or settles its fields (accepted-order.mjs).
  const acceptedOrder = orderSnapshot(job);
  assertTierSanity();
  // A RESUMED RUN KEEPS THE ENGINE IT STARTED ON (engine/run-choices.mjs), so the engine doors below test that
  // engine rather than the machine's current setting. The run's folder is named the way the resume below names
  // it, and naming it creates nothing; a resume with no folder reads as no record here and is refused below in
  // its own words. A recorded engine this driver does not have is refused by name before any door runs.
  const resuming = Boolean(opts.codename) && !opts.minted;
  const recorded = (() => {
    if (!resuming) return { state: "none" };
    const date = opts.date ?? findRunDate(job, opts.codename, opts.studioRoot ?? config.studioRoot);
    if (!date) return { state: "none" };
    return readRunChoices(buildRunContext(job, { studioRoot: opts.studioRoot, archiveRoot: opts.archiveRoot, codename: opts.codename, date }).runDir);
  })();
  if (recorded.state === "unreadable") {
    const err = new Error(`resume refused: run ${opts.codename}'s engine record ${recorded.detail}, so it is not resumed on the machine's engine in its place`);
    err.noResume = true;
    throw err;
  }
  if (recorded.state === "recorded" && !engineNamed(recorded.engine))
    throw new Error(`resume refused: run ${opts.codename} started on the "${recorded.engine}" engine, which this driver does not have registered (${registeredEngines().join(", ")}); it keeps that engine rather than switch`);
  const engineEnv = recorded.state === "recorded" ? { ...process.env, CLEAROTRON_AI: recorded.engine } : process.env;
  // The engine binary, first and UNCONDITIONALLY — before the register preflight, which two lanes skip.
  // Every lane spawns the engine: a knockout does, and so does a run with an injected recordFetcher. So
  // unlike the credential check below this one has no exemption, because there is no shape of run that
  // can proceed without it. It reads the filesystem and never spawns (driver.config.preflightEngineBinary).
  preflightEngineBinary(engineEnv);
  // — there is somewhere to write, checked the same way, at the same door and for the same reason.
  // UNCONDITIONAL like the binary check above and unlike the credential check below: every lane writes a
  // run directory, so there is no shape of run that is exempt. A full disk fails as "artifact absent" at
  // whatever stage reads the truncated file next — a stage unrelated to the cause, after the spend that
  // produced it — which is indistinguishable from a real engine or provider fault.
  //
  // A DISK IT CANNOT MEASURE IS NOT A PASS. Said out loud rather than swallowed (bin/uspto-sync.mjs's
  // precedent), because a guard whose silence reads as success is a guard that has stopped existing.
  const disk = preflightFreeSpace(process.env, opts.studioRoot ?? null);
  if (disk.warning) console.error(disk.warning);
  // — and the DOCTRINE it will be rated under is a tree somebody else can check out. A store on a
  // feature branch, or with uncommitted edits under the served path, produces a report graded against
  // prose that matches no commit anywhere; the run reads normally and nothing errors. Same door, same
  // reason as the three above, and the same three outcomes as the publication gate — could-not-determine
  // is not a pass. WARNS by default and throws only under CLEAROTRON_SKILLS_STORE_STRICT: an existing
  // deployment must behave exactly as it did before this landed. The result is stamped into the run's
  // run.jsonl below, once there is a run dir to stamp it into.
  const skillsStore = preflightSkillsStore();
  if (skillsStore.warning) console.error(skillsStore.warning);
  // doc-27 Item 2: fail fast on a missing register credential, BEFORE any model spend AND before a run
  // dir exists (the pre-try throw rides the QUEUE-level packet lane, `intake-<base>.prerun-failed`, since
  // re-routed it — there is no run dir to write a run-level packet into) — covers cold runs AND
  // resumes. Skip when a recordFetcher is injected (tests / alt fetchers), and skip for jobs whose
  // EXPLICIT selector names a knockout-pipeline product: that lane has no register machinery (review
  // 2026-07-17 — demanding an unused register key blocked knockout on clean envs). It used to preflight
  // its own SWEEP credential inside knockoutInner; since acceptance 6 it resolves a SKIP there
  // instead and discloses the half it did not run, so no research door is owed here either — see the
  // note on preflightResearchCredential below, which is gated on the component, not on this selector.
  // A knockout reached via recipe/profile default still passes through this preflight (resolution needs
  // the frozen profile, which needs the run dir) — on a register-credentialed deployment that is a no-op.
  //
  // READS `job.product`. It read the DELETED `job.searchLevel`, so it was false for every job and the
  // 2026-07-17 regression was silently back: a knockout dispatched on a clean env demanded a register
  // credential its lane never uses, and failed before any run dir existed.
  const jobPolicy = policyFor(String(job.product ?? "").trim().toLowerCase());
  const koSelector = jobPolicy?.pipeline === "knockout";
  // AN OFFLINE RESUME ANSWERS ITS RECORD FETCHES FROM THE RUN'S OWN RECORDS (`--records replay`, record-replay.mjs), so
  // it needs no register key and refuses to start while one is set: a stage's register tools read the same key.
  if (opts.records != null && !RECORDS_MODES.includes(opts.records))
    throw new Error(`--records: unknown value "${opts.records}" — one of: ${RECORDS_MODES.join(", ")}`);
  if (opts.records === "replay") {
    const held = heldRegisterCredentials(activeProvider());
    if (held.length)
      throw new Error(`--records replay: ${held.join(" + ")} is set, so a stage's register tools could still reach the register — unset it for this resume, which answers every record fetch from the run's own records`);
    opts.recordFetcher ??= (uri) => savedRecordFetch(opts.__runRef?.runDir, uri);
  }
  if (!opts.recordFetcher && !koSelector) preflightCredentials();
  // -6 — and the RESEARCH credential, for the products that cannot deliver their answer without it.
  //
  // NOT gated on `koSelector`, and that is not an oversight: the predicate inside is
  // `components.commonLawGrid === true`, which no knockout row carries, so a second knockout test here
  // would say the discriminator is insufficient when it is exactly sufficient. Gated on `recordFetcher`
  // like its two siblings, because that lane is the injected-fetcher lane and its exemption is the
  // established one — a fixture clearance holds no live credential of any kind.
  //
  // This moves a failure earlier; it does not add one. Without it the run spends every register stage
  // and dies at the grid, which is `research` in perplexity-server.mjs handing the model an ERROR string per
  // call — the shape named "degrades every mark per-call and the batch dies all-failed only AFTER
  // the paid frame turn" when it removed the knockout's refusal for the same reason in the other
  // direction. ADR-0003 carries the ruling for both lanes.
  if (!opts.recordFetcher) preflightResearchCredential(jobPolicy);
  // — and the engine can COMPLETE A TURN, not merely be a file on disk. built the probe and
  // wired it to `npm run setup`; a box that passed setup on Monday and signed out on Tuesday still gets
  // caught at stage one, ninety minutes and a run directory later, wearing the shape of a model fault.
  //
  // LAST OF THE FOUR DOORS, because it is the only one that SPENDS: the binary, the free space and the
  // register credential all refuse for nothing, so each gets its chance first and this one never runs for
  // a fault a cheaper check would have named. Still BEFORE buildRunContext, which is the whole property —
  // refused before a run directory, a frozen profile or a status sidecar exists. AWAITED: a floating
  // promise is no refusal at all.
  //
  // IT REFUSES ONLY A CONFIGURATION FAULT, and fails open on everything else (probeVerdictLane). An
  // upstream overload or a spent quota is not this box's defect and the run handles it better than the
  // door can — the rate-limit park carries the provider's own resetsAt and resumes itself, and the
  // recovery ladder's weather lane exists so a 529 does not spend the defect budget. Refusing there would
  // replace a park that recovers with a terminal failure and a human.
  //
  // GATED like the credential check, not like the binary check, and that is the ruling rather than
  // this file's: lanes with an injected recordFetcher and explicitly-selected knockout products do not
  // pay for the turn. Both of those lanes DO spawn the engine (preflightEngineBinary's header says so in
  // as many words), so the exemption is narrower than the reasoning that produced it — recorded on the
  // issue rather than quietly widened here.
  //
  // The verdict is stamped into run.jsonl below, once there is a run dir to stamp it into — a fail-open
  // that leaves no record is a check that has stopped existing.
  let engineTurn = null;
  // — the preflight is one of the two silences the D8 addendum found outside every stage, so it is
  // TIMED here and WRITTEN further down, beside the verdict, for the reason the paragraph above already
  // gives: there is no run dir yet. A span written here names `run` before it exists.
  let engineTurnStartedMs = null, engineTurnEndedMs = null;
  if (!opts.recordFetcher && !koSelector) {
    engineTurnStartedMs = Date.now();
    // `opts.engineTurnWait` stands in for the door's wait before it checks a locked sign-in refresh again,
    // in tests; a run passes none and waits.
    engineTurn = await preflightEngineTurn({ wait: opts.engineTurnWait, env: engineEnv });
    engineTurnEndedMs = Date.now();
    if (engineTurn.warning) console.error(engineTurn.warning);
  }
  const agent = opts.agent ?? config.defaultAgent;
  // Run-dir + archive root follow the executing agent's workspace (passed by the runner from the queue it
  // claimed); default to the legacy agent's. ctx.agent makes every stage — including the notify SEND — run as this agent.
  // opts.codename rebuilds a DICTATED run identity. Two callers use it: RESUME (re-drive an existing run
  // so idempotency reuses the prior, valid stages) and the runner's dispatch PRE-MINT (B1 — opts.minted:
  // a FRESH identity, minted freshness-aware and persisted to the queue sidecar BEFORE any spend, so a
  // crash-reclaim resumes this exact run instead of re-minting). Only a RESUME expects an existing run
  // dir; a minted dispatch is a cold start in every other respect. The resume date is read off disk (not
  // defaulted to today) so a resume works on any day after the original run.
  const isResume = resuming;
  const resumeDate = isResume ? (opts.date ?? findRunDate(job, opts.codename, opts.studioRoot ?? config.studioRoot)) : opts.date;
  if (isResume && !resumeDate)
    throw new Error(`resume: no live run-dir for codename "${opts.codename}" (a delivered run is archived — use --experiment/compare instead)`);
  const run = buildRunContext(job, { studioRoot: opts.studioRoot, archiveRoot: opts.archiveRoot, codename: opts.codename, date: resumeDate });
  opts.__runRef = run;   // expose the run identity so pipeline()'s rate-limit catch can postpone+resume it
  const P = paths(run.runDir);
  if (opts.records === "replay") runLog(run.runDir, { event: "records-replay", why: "every record fetch is answered from this run's saved records; nothing is sent to the register" });

  // RESUME guard: refuse to clobber a delivered run, and clear the stale .failed sentinel so a clean resume
  // doesn't read as failed. (Fresh runs — including minted dispatches — never enter here.)
  if (isResume) {
    // A4 — "delivered" is not only the `.delivered` sentinel (written LAST): the delivery tail commits
    // `_driver/delivery.json` + status.state "delivered" (report published, packet + outbox marker dropped)
    // sub-seconds earlier. A crash in that window leaves a live dir with no sentinel; re-handing it off rm's
    // .sent + receipts and re-sends → a duplicate report. Refuse on ANY of the three (the runner's reclaim
    // router consults the SAME check — runDirDelivered — and marks such a dir .done rather than resuming).
    const deliveredMarker = existsSync(join(run.runDir, ".delivered")) ? ".delivered"
      : existsSync(paths(run.runDir).delivery) ? "_driver/delivery.json"
      : (() => { try { return JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8"))?.state === "delivered" ? "status delivered" : null; } catch { return null; } })();
    if (deliveredMarker) {
      // `noResume`: the run identity EXISTS here — opts.__runRef was set just above — so the CLI's
      // exit advice would otherwise print a `--resume` command that lands right back on this same refusal.
      // The message already names the remedy; the flag is how the CLI knows not to contradict it.
      const err = new Error(`resume refused: run ${run.codename} already delivered (${deliveredMarker} present) — re-run a stage with --experiment instead`);
      err.noResume = true;
      throw err;
    }
    // ── — A STOPPED RUN IS REFUSED WHILE ITS EVIDENCE IS STILL ON DISK ──────
    //
    // ORDER IS THE ENTIRE FIX, and it goes here rather than in the watcher above it. The three rmSync
    // calls below are LOAD-BEARING for the legitimate path — a crash-postponed resume genuinely needs
    // `.failed`/`.postponed`/`.parked` gone — so they cannot simply be dropped. What was wrong is that
    // they ran BEFORE anything asked whether this run had been stopped, and the clearing is what made
    // the next pass blind: on the measured run the first resume erased the markers and reset the record,
    // and the second resume nine minutes later arrived at a run dir that no longer said it was over.
    // One resurrection is a missing check; two is a missing check that destroyed the evidence of itself.
    //
    // The delivered branch above is the same rule for a different terminal, and this is the rest of the
    // class it only covered one member of. `.cancel` is the REQUEST and a terminal status is the
    // SETTLEMENT: either is a decision this path must not overrule, and stop_run writes only the first
    // of them for a run that was still running when Stop was pressed.
    //
    // `noResume` for the same reason the delivered branch sets it: the run identity exists here, so the
    // CLI's exit advice would otherwise print a `--resume` that lands straight back on this refusal.
    const stopped = resumeStopRefusal(run.runDir);
    if (stopped) {
      const err = new Error(`resume refused: run ${run.codename} was stopped — ${stopped}. Nothing was cleared and nothing resumes; start a new run instead.`);
      err.noResume = true;
      throw err;
    }
    try { rmSync(join(run.runDir, ".failed")); } catch { /* absent is fine */ }
    try { rmSync(join(run.runDir, ".postponed")); } catch { /* absent is fine — a queue-lane resume leaves no run-dir sentinel behind (2026-07-04 auto-recovery) */ }
    try { rmSync(join(run.runDir, ".parked")); } catch { /* absent is fine — the grace-exit park sentinel is non-blocking BY DESIGN (a systemd restart is the normal SIGTERM case) */ }
    note(`resuming ${run.codename} — cleared .failed; idempotency skips completed (valid) stages`);
    // ── item 4 — SAY WHICH ENGINES THIS RUN HAS USED, AT EVERY RESUME ───────
    //
    // THE "STATED" READING, taken deliberately over the issue's alternative ("refused"). A refusal on
    // engine mismatch is a new way for the product to withhold a report, and what the client receives
    // is not a dev decision — it goes to the owner with options. Stating it costs nothing and is the
    // half that was actually missing.
    //
    // WHY IT WAS MISSING, measured on that run's preserved artifact: `tokens.byEngine` is stamped at
    // TERMINALS only (delivered, failed, cancelled, postponed, recovery-parked). That run resumed twice
    // and reached no terminal — it was stopped by moving its directory — so its byEngine still reads
    // openai-agent/openai/code, summing exactly to `total`, with none of the anthropic work the resumes
    // did. The artifact a reader opens says "clean codex run". The issue predicted byEngine "will show
    // both"; it does not, because nothing re-stamped it. A resume is precisely the moment the engine can
    // change, so it is the moment worth recording — and it re-states everything the PREVIOUS resume did.
    //
    // Re-uses the one stamping function rather than adding a call site of its own kind: it fires at
    // every terminal already, and tokens.mjs's own comment names "seven new call sites is how one gets
    // missed". Non-fatal by construction (rollupTokens is all-zero without telemetry and never throws).
    stampTokenRollup(run.runDir, "resumed");
  }

  ensureDriverDir(run.runDir);
  mkdirSync(join(run.runDir, "register-units"), { recursive: true });
  // — the doctrine store's identity, beside the run it served. The door already printed any warning
  // to stderr, but a journal line is not the run record: methodology-witness.mjs records WHICH FILES each
  // stage read, and this records whether the tree they came from is one anybody can check out. Written on
  // both lanes (before the knockout dispatch below) and best-effort — bookkeeping never kills a run.
  try {
    const s = skillsStore.result;
    runLog(run.runDir, { event: "skills-store", outcome: s.outcome, situation: s.situation, findings: s.findings,
      store: s.store, repoRoot: s.repoRoot, branch: s.branch, head: s.head, detail: s.detail });
  } catch { /* best-effort */ }
  // ── THE PROFILE HALF OF THE SAME QUESTION ──────────────────────────────────
  //
  // The line above says which DOCTRINE tree served this run. Nothing said which CUSTOMER CONFIG store
  // did, and that is the gap a day of rounds rode in on: the executing process held none of the store
  // directories, every customer silently resolved to the bundled demo roster, and the scenario assert
  // built to catch exactly that passed on every round — it checked the frozen framework was NON-EMPTY,
  // and a bundled demo framework is non-empty.
  //
  // Written beside its sibling and best-effort for the same reason: a run record that can kill a run is
  // worse than no run record. `bundled-fallback` is `outcome: pass` — it is a legitimate install on
  // Generic defaults, and the point was never to refuse it but to make it SAY so.
  try {
    const pr = profileStoreResolution();
    runLog(run.runDir, { event: "profile-store", outcome: pr.outcome, situation: pr.situation,
      findings: pr.findings, store: pr.store, readRoots: pr.readRoots, detail: pr.detail });
  } catch { /* best-effort */ }
  // — THE ENGINE AND REGISTER THIS RUN BELONGS TO. A cold start records the machine's choice once; a resume keeps
  // the record it has and is given none if it has none, so a run never gains a start nobody recorded. Each segment
  // logs the record beside the machine's setting, so a register that differs is on the record rather than silent.
  // Best-effort like its neighbours: a run whose record cannot be written runs on as a run with no record.
  try {
    const machine = { engine: selectEngine().name, register: REGISTER_PROVIDER ?? null };
    const held = isResume ? readRunChoices(run.runDir) : recordRunChoices(run.runDir, machine);
    const registerDiffers = held.state === "recorded" && held.register !== machine.register;
    runLog(run.runDir, { event: "run-choices", state: held.state, written: held.written === true,
      engine: held.engine ?? null, register: held.register ?? null, machineEngine: machine.engine, machineRegister: machine.register,
      ...(registerDiffers ? { registerDiffers: true } : {}) });
    if (registerDiffers)
      note(`[run-choices] this run started on the ${held.register ?? "(none)"} register; this machine is set to ${machine.register ?? "(none)"}, and serves the run with its own`);
  } catch (e) {
    try { runLog(run.runDir, { event: "run-choices", state: "not-written", detail: String(e?.message ?? e).slice(0, 300) }); } catch { /* best-effort */ }
  }
  // — WHICH ENGINE THIS RUN LOADED, beside the doctrine store whose commit sits one line up. Those
  // two `head`s are different repositories, which is the whole reason this event names its key
  // `engineHead`: reading the store's commit as the engine's is the mistake that produced two near-miss
  // wrong certifications in two days, and wore `status:regressed` on a run that predates its fix.
  //
  // HERE, and not at publish. The pool copy has carried the sha since — but only for a run that
  // PUBLISHED, and only in the pool, which is not the run dir that gets archived. A run that fails, is
  // aborted, or is preserved by the e2e lane carries nothing. This line is the first thing written after
  // the run dir exists, so every one of those keeps its attribution.
  //
  // WHAT IT STILL CANNOT COVER, said rather than discovered: a throw BEFORE the run dir is minted — the
  // credential and disk preflights, the class `preRunFailNotify` exists for. There is no `_driver/` to
  // write into, so those stay unattributable by construction, and the queue-level packet they do write
  // is a notice rather than a provenance record.
  //
  // A RESUME WRITES ITS OWN ROW. `run.jsonl` already carries one `start` event per segment
  // (backfill-started-at.test.mjs drives four), and a resumed segment can genuinely load different code
  // from the segment that began the run. Two rows that disagree is a FACT about the run, not a defect:
  // read the last one for what produced the delivered artifact, and read them all to see a mid-run
  // upgrade. Best-effort like its neighbour — bookkeeping never kills a run.
  try {
    const e = engineProvenance();
    runLog(run.runDir, { event: "engine-build", outcome: e.outcome, engineHead: e.engineHead,
      engineBranch: e.engineBranch, engineDirt: e.engineDirt, detail: e.detail });
    if (e.outcome !== "clean") note(`[engine-build] ${e.detail}`);
  } catch { /* best-effort */ }
  // — the engine-turn door's verdict, beside the run it let through. A refusal never reaches here (it
  // throws before any of this exists), so this row answers the two questions that survive: did the door
  // run at all on this lane, and — when it failed open on weather — WHAT it decided to let past. Without
  // it a proceeded-past-weather run is indistinguishable on the record from one that probed clean. A door
  // that checked twice, because the first check met a locked sign-in refresh, says so beside the second.
  try {
    if (engineTurn) runLog(run.runDir, { event: "engine-turn-probe", ok: engineTurn.ok === true,
      engine: engineTurn.engine ?? null, mode: engineTurn.mode ?? null, basis: engineTurn.basis ?? null,
      lane: engineTurn.ok === true ? "ok" : "weather", detail: engineTurn.detail ?? null,
      ...(engineTurn.recheckedAfter ? { recheckedAfter: engineTurn.recheckedAfter } : {}) });
    // — and the same probe as a SPAN the wall decomposition can attribute. Same measurement, second
    // reader: the row above goes to run.jsonl, which that instrument skips by name.
    if (engineTurn) recordSpan(run.runDir, "engine-turn", { startedMs: engineTurnStartedMs, endedMs: engineTurnEndedMs },
      { ok: engineTurn.ok === true, engine: engineTurn.engine ?? null, basis: engineTurn.basis ?? null });
  } catch { /* best-effort */ }
  // stateReset (A5): the resume guard above DELIBERATELY cleared terminal sentinels, so the status
  // seeds below (clearance seedRunStatus / knockout's own seed) may reopen a terminal state — that
  // authority is threaded, never ambient (writeRunStatus refuses a terminal→running flip without it).
  const ctx = { paths: P, job, run, agent, stateReset: isResume };
  opts.__ctx = ctx;   // P2 — the outer wrapper reconciles this pass's stamps in its finally, success or failure
  // WS-B: freeze the customer profile into the sidecar before ANY validated stage — early stages'
  // idempotency re-validation and the receipts gate must all see the same per-run values. Minted on
  // COLD starts only: a resumed pre-WS-B run stays legacy end to end (retro-minting would apply the
  // identity join to a grid the worker was never dictated).
  attachProfile(ctx, job, { write: !isResume });
  // Search-depth spine — freeze WHICH product shape this run is BEFORE the framework freeze (Phase 2a:
  // the knockout lane selects a different fallback framework, so the dispatch must happen first; the
  // policy freeze reads only ctx.profile). Cold-start mint only, like the profile freeze: a resumed
  // pre-spine run reads as legacy-implicit clearotron, never retro-minted.
  attachSearchPolicy(ctx, job, { write: !isResume });
  // acceptance 5 — recorded on EVERY run, ungraded included: "which ladder applied" must be a
  // read, never an inference from which product the job asked for.
  runLog(run.runDir, depthLadderEvent(ctx));
  return { P, acceptedOrder, agent, ctx, isResume, run };
}
