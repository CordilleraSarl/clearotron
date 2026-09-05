// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/whatif.mjs — the single-step, approval-gated counterfactual.
//
// TWO-CALL HANDSHAKE (enforces "deliberate action with confirmation" identically for both consumers):
//   whatIfPlan(...)  → DRY-RUN, no spend: what will re-run, the cost prior, what sits downstream that will
//                      NOT be recomputed, a completeness verdict, and a confirmationToken.
//   whatIfRun(token) → EXECUTES: runs ONE stage in a sandbox (_experiments/…, canonical byte-identical, the
//                      experiment's billed calls keyed off-run) then diffs it against canonical.
//
// v1 supports `instructions` (re-run the step with extra guidance, e.g. "treat ACME's mark as expired") and
// `model`. The precise change-an-input-FILE flavor (a `patch`) needs a 1-line additive hook in the driver's
// runExperiment — deferred to a COORDINATED driver change (a parallel agent is editing the driver). What-if
// runs on LIVE (undelivered) runs only; the sandbox engine resolves live run-dirs, archived runs are read-only.
//
// runExperiment SPAWNS THE ENGINE BINARY (`stage()` → runStage → the selected adapter) and (via
// pipeline.mjs → publish/index.mjs) pulls exceljs + native addons, so it is imported LAZILY here and this
// module is only loaded by the server when a what-if tool is called — the read-only surface never touches
// it.: this line used to name one integrator platform's agent CLI, which stopped being the compute
// path when the engine seam landed. The reason for the lazy import and for withholding the tool remotely
// is unchanged — what-if spends money and spawns a process — but it is the ENGINE it spawns.

import { STAGES, STAGE_ORDER, stageOrdinal, REGISTER_AXES, axisTier, resolveModel, config, deriveSlug } from "./driver.mjs";
import { readCapped } from "./util.mjs";
import { join, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
// — the SHARED eligibility composer. A leaf module (fs/path/crypto only), so a
// static import here costs the read-only surface nothing and buys the one thing three copies of this
// question could not give: the same answer at the door and at the worker.
import { whatIfRefusal } from "../../driver/whatif-queue.mjs";

// ── — THE NOTE SAYS WHAT IS TRUE, AND IT IS THE STRONGER SENTENCE ────────
//
// It used to open "The canonical run is byte-for-byte unchanged". A sha manifest of a canonical run dir
// across a real what-if says otherwise: 441 of 443 files identical, and two changed — `_driver/run.jsonl`
// gains the experiment's own provenance event, and `status.json`'s `updatedAt` moves. A client who
// checks finds two modified files and a sentence claiming none.
//
// THE BEHAVIOUR IS RIGHT AND IS NOT CHANGED HERE. A run should carry what was done to it; that
// provenance row is what made the framework defect on the sibling issue findable at all. What was wrong
// was the sentence, and the accurate version survives the check the old one fails: the artifacts are
// untouched, AND the run records that an experiment was taken against it. The second clause is a
// feature, so saying it out loud costs nothing and buys the reader an audit trail they did not know
// they had.
//
// EXPORTED so its arm asserts the shipped string rather than a copy of it — the reason this was
// invisible for so long is that nothing compared the words to the filesystem.
export const WHAT_IF_NOTE =
  "Sandboxed re-run complete. The canonical run's artifacts are untouched — every document it produced is "
  + "byte-identical — and the run's own log records that this experiment was taken against it. This output "
  + "lives in _experiments/ and its billed calls were keyed off the canonical run.";


// Stages that hit billed external APIs (so the cost gate is honest about more than tokens).
const BILLED_EXTERNAL = new Set(["common-law", "register-unit", "case-law"]);
const MAYBE_EXTERNAL = new Set(["prelim-variants"]); // may make a few Perplexity famous-mark calls

function encodeToken(op) { return Buffer.from(JSON.stringify(op)).toString("base64url"); }
function decodeToken(token) { try { return JSON.parse(Buffer.from(String(token), "base64url").toString("utf8")); } catch { return null; } }

// last telemetry line for a stage (the prior run's token usage — the cost prior).
function priorUsage(runDir, stage, axis) {
  const label = stage + (axis ? `:${axis}` : "");
  try {
    const lines = readCapped(driverDir(runDir, `${label}.jsonl`)).trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    return { model: last.modelUsed ?? last.model, usage: last.usage ?? null, wall: last.wall ?? null };
  } catch { return null; }
}

function completeness(stage) {
  const ord = stageOrdinal(stage);
  const reportOrd = stageOrdinal("report-overview"), synthOrd = stageOrdinal("synthesis");
  if (ord >= reportOrd) return { level: "complete", note: "This step writes (or post-dates) the final report itself, so the re-run IS a complete answer." };
  if (ord >= synthOrd) return { level: "near-complete", note: "Synthesis re-runs (the risk read), but report-overview (the curated write-up) is NOT re-run — expect the new read, not a re-formatted report." };
  return { level: "partial", note: "This is an EARLY step: the risk read (synthesis) and the report sit DOWNSTREAM and are NOT recomputed. You'll see the immediate output of this step only — a finished-report answer would need a full recompute." };
}

/** whatIfPlan — pure dry-run. run = resolved Run ({runId, slug, codename, agent, runDir, P, status, location}). */
export function whatIfPlan({ run, stage, axis = null, instructions = null, model = null, kind = "stage" }) {
  if (!run) throw new Error("whatIfPlan: run is required");
  // ── PLANNING A MEMO (tracker issue 132) ────────────────────────────────────────────────────────
  //
  // Without this branch the memo capability is COMPOSED AND UNREACHABLE. whatif-memo.mjs composes one,
  // whatIfRefusal already admits `kind: "memo"` on a finished run, and decodeOp already validates a memo
  // op — but nothing could mint the token, because the stage check two lines down refuses first and a
  // memo re-runs no stage. Every piece existed and no door opened onto them.
  //
  // A MEMO PLAN IS NOT A STAGE PLAN and shares none of its fields on purpose. There is no model tier to
  // resolve (nothing is re-run), no downstream to leave un-recomputed (nothing is recomputed), and no
  // prior telemetry to quote (this stage never ran). Carrying those keys with null values would tell a
  // reader the questions had been asked and answered "none", which is not what happened.
  if (kind === "memo") {
    const refusal = whatIfRefusal({ location: run.location, state: run.state, kind: "memo" });
    if (refusal) return { runnable: false, reason: `Run ${run.runId}: ${refusal}.` };
    const assumption = String(instructions ?? "").trim();
    if (!assumption)
      return { runnable: false, reason: "A memo needs the assumption to apply — pass the reader's own words as `instructions`." };
    return {
      runnable: true,
      kind: "memo",
      runId: run.runId,
      assumption,
      change: `re-read the archived evidence under: "${assumption}"`,
      // Stated rather than implied. The whole safety case for offering this on a DELIVERED report is
      // that it spends nothing and moves nothing, so a plan that did not say so would be asking for a
      // yes to a question the reader could not price.
      externalCalls: "Model tokens only — no searching, no register calls, nothing billed externally.",
      affectsFinalReport: false,
      parentUntouched: "The report and its archive are not modified. The memo is a separate document that names them.",
      honestyNote: "A memo reasons over evidence already gathered. It cannot confirm the assumption itself, "
        + "and it states what would be needed to.",
      confirmationToken: encodeToken({ runId: run.runId, kind: "memo", instructions: assumption }),
      next: "To execute, call what_if_run with this confirmationToken.",
    };
  }
  if (!STAGES[stage]) throw new Error(`whatIfPlan: unknown stage "${stage}" (valid: ${STAGE_ORDER.join(", ")})`);
  if (stage === "register-unit") {
    if (!axis || !REGISTER_AXES.includes(axis)) throw new Error(`whatIfPlan: register-unit requires a valid axis (one of: ${REGISTER_AXES.join(", ")})`);
  } else if (axis) {
    axis = null; // axis only applies to register-unit; ignore it elsewhere
  }
  const refusal = whatIfRefusal({ location: run.location, state: run.state });
  if (refusal) return { runnable: false, reason: `Run ${run.runId}: ${refusal}.` };
  const resolvedModel = resolveModel(model ?? (axis ? axisTier(axis).model : STAGES[stage].model));
  const ord = stageOrdinal(stage);
  // No filter is needed any more: `notify` and `notify-chat` were the two entries this excluded, and both
  // left STAGE_ORDER with the send stages. Everything still in the order is real recomputable work.
  const downstream = STAGE_ORDER.slice(ord + 1);
  const external = BILLED_EXTERNAL.has(stage)
    ? "WILL likely incur billed API calls (Corsearch / Perplexity / CourtListener)."
    : MAYBE_EXTERNAL.has(stage) ? "MAY make a few Perplexity famous-mark calls." : "Model tokens only — no billed search/API calls.";
  const prior = priorUsage(run.runDir, stage, axis);
  const comp = completeness(stage);

  return {
    runnable: true,
    runId: run.runId, stage, axis, model: resolvedModel,
    change: instructions ? `re-run with extra guidance: "${instructions}"` : model ? `re-run on ${resolvedModel}` : "re-run as-is (no change specified — supply `instructions` or `model`)",
    completeness: comp.level,
    affectsFinalReport: ord >= stageOrdinal("synthesis"),
    downstreamNotRecomputed: downstream,
    externalCalls: external,
    costPrior: prior ? { model: prior.model, tokens: prior.usage, wallSec: prior.wall, note: "The prior run of this stage used these tokens; a re-run is of similar order. Token cost depends on current model pricing." }
      : { note: "No prior telemetry for this stage — cost is unknown until it runs." },
    honestyNote: comp.note,
    confirmationToken: encodeToken({ runId: run.runId, stage, axis, instructions, model }),
    next: "To execute, call what_if_run with this confirmationToken. The original run is never touched; the result lands in _experiments/ and is diffed against canonical.",
  };
}

/**
 * Decode a confirmation token and re-validate its op from scratch. ONE decode, shared by the two doors
 * that act on a token — whatIfRun (which executes it) and whatIfEnqueue (which queues it for a worker
 * that will) — because the token is signed by nothing and a second reading of it is a second opinion
 * about what a valid what-if is. `what` names the caller so the refusal says which door refused.
 */
export function decodeOp(confirmationToken, what = "whatIfRun") {
  const op = decodeToken(confirmationToken);
  // — A MEMO OP CARRIES NO STAGE, because it re-runs none. It reasons over the
  // archived evidence under a stated assumption, so what it needs is the run and the assumption; a stage
  // field on it would be a lie about what it does, and would make every stage check below meaningful for
  // an op that dispatches nothing. Validated on its own terms in the same decode, so the two doors that
  // act on a token still get ONE opinion about what a valid what-if is.
  if (op && op.kind === "memo") {
    if (!op.runId) throw new Error(`${what}: a valid confirmationToken from what_if_plan is required (decoded token missing runId)`);
    if (!String(op.instructions ?? "").trim())
      throw new Error(`${what}: a memo needs the assumption to apply — plan it with the client's own words in instructions`);
    if (op.stage) throw new Error(`${what}: a memo re-runs no stage, so a token carrying one was not planned as a memo`);
    return op;
  }
  if (!op || !op.runId || !op.stage) throw new Error(`${what}: a valid confirmationToken from what_if_plan is required (decoded token missing runId/stage).`);
  const { stage, axis = null } = op;
  if (!STAGES[stage]) throw new Error(`${what}: unknown stage "${stage}"`);
  if (stage === "register-unit" && (!axis || !REGISTER_AXES.includes(axis))) throw new Error(`${what}: register-unit requires a valid axis (one of: ${REGISTER_AXES.join(", ")})`);
  if (stage !== "register-unit" && axis) throw new Error(`${what}: axis only applies to register-unit`);
  return op;
}

/**
 * whatIfEnqueue — the CLIENT path (owner ruling 2026-08-27). Queues the op for the worker instead of
 * running it, because the remote surfaces never spawn the engine and this module's own lazy import of
 * driver/pipeline.mjs is what keeps that true. Nothing below reaches runExperiment.
 *
 * THE CROSS-CHECK IS THE SECURITY PROPERTY, and it is here rather than at the chokepoint because this is
 * where the token is decoded. A confirmation token is plain base64url JSON — unsigned, and this file says
 * so at whatIfRun. The MCP dispatch gate fires on the caller's DECLARED `runId`, so a token naming a
 * different run would slip past a gate that never saw it. Declaring the run and then proving the token
 * agrees is what closes that: the gate checks the grant, this checks the token against the same run, and
 * a mismatch is refused by name rather than silently preferring one of the two.
 */
export async function whatIfEnqueue({ run, confirmationToken, requestedBy = null, account = null } = {}, deps = {}) {
  if (!run) throw new Error("whatIfEnqueue: run is required");
  const op = decodeOp(confirmationToken, "whatIfEnqueue");
  if (String(op.runId) !== String(run.runId))
    throw new Error(`whatIfEnqueue: this confirmationToken is for run "${op.runId}", not "${run.runId}" — plan the what-if on the run you mean to change.`);
  // — the KIND decides what "finished" means here: a stage re-run on a delivered
  // run is refused, and a memo over one is the whole point.
  const refusal = whatIfRefusal({ location: run.location, state: run.state, kind: op.kind ?? "stage" });
  if (refusal) throw new Error(`whatIfEnqueue: run ${run.runId}: ${refusal}.`);
  const enqueue = deps.enqueueWhatIf ?? (await import("../../driver/whatif-queue.mjs")).enqueueWhatIf;
  const job = enqueue(run.runDir, { op, requestedBy, account });
  return {
    queued: true, runId: run.runId, experimentId: job.id, kind: op.kind ?? "stage", stage: op.stage ?? null, axis: op.axis ?? null,
    queuedAt: job.queuedAt,
    next: "The experiment runs on the server and does not touch the original run. Call what_if_result with this runId and experimentId to collect the diff; it is queued, not instant.",
  };
}

/** whatIfRun — execute the planned op. deps lets tests inject fakes for the shelling/compare calls. */
export async function whatIfRun({ confirmationToken } = {}, deps = {}) {
  // The token is treated as UNTRUSTED input: even though what_if_plan minted it, we fully re-validate here
  // (stage, axis, live-only, slug guard) so a malformed or tampered token can never run an invalid/unsafe op.
  // There is intentionally NO token-free path — what_if_run cannot spend without a token from what_if_plan.
  const op = decodeOp(confirmationToken, "whatIfRun");
  const { runId, stage, axis = null, instructions = null, model = null } = op;

  const resolveRun = deps.resolveRun ?? (await import("./runs.mjs")).resolveRun;
  const run = resolveRun(runId);
  if (!run) throw new Error(`whatIfRun: run "${runId}" not found.`);
  const refusal = whatIfRefusal({ location: run.location, state: run.state });
  if (refusal) throw new Error(`whatIfRun: run ${runId}: ${refusal}.`);

  // reconstruct the minimal job the experiment engine needs, and guard that it rebuilds the SAME slug.
  const s = run.status ?? {};
  const job = { id: s.id, ref: s.ref, markName: s.markName, classes: s.classes, forwarder: s.forwarder, name: s.markName };
  if (deriveSlug(job) !== run.slug)
    throw new Error(`whatIfRun: cannot reconstruct the job for ${runId} (derived slug "${deriveSlug(job)}" != "${run.slug}"). status.json lacks the original ref/markName.`);

  const runExperiment = deps.runExperiment ?? (await import("../../driver/pipeline.mjs")).runExperiment;
  const compareCmd = deps.compareCmd ?? (await import("./driver.mjs")).compareCmd;

  const opts = {
    agent: run.agent,
    studioRoot: config.studioRootForAgent(run.agent),
    archiveRoot: config.archiveRootForAgent(run.agent),
    codename: run.codename,
    experiment: stage, axis, model, instructions, label: "whatif",
  };
  const r = await runExperiment(job, opts);
  if (!r.ok) return { ok: false, stage, axis, fail: r.fail, shadowDir: r.shadowDir ? basename(r.shadowDir) : null };

  let diff = null, telemetryDelta = null;
  try {
    const cmp = compareCmd({ runDir: run.runDir, stage, axis, a: "canonical", b: join("_experiments", basename(r.shadowDir)) });
    diff = cmp.diff; telemetryDelta = cmp.table;
  } catch (e) { diff = `(compare failed: ${e.message})`; }

  const comp = completeness(stage);
  return {
    ok: true, runId, stage, axis,
    shadowDir: basename(r.shadowDir), output: r.output ? basename(r.output) : null,
    completeness: comp.level, honestyNote: comp.note,
    diff, telemetryDelta,
    note: WHAT_IF_NOTE,
  };
}
