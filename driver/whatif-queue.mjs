// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// whatif-queue.mjs — the RUN-LOCAL queue a client's what-if waits in.
//
// Owner ruling 2026-08-27 opened what-if to clients. The remote surfaces cannot run it directly and that
// is a configuration fact rather than a policy: http-server.mjs states in its own header that they "NEVER
// shell", and lib/whatif.mjs imports driver/pipeline.mjs LAZILY so the read-only face never loads the
// engine at all. The only thing that runs the engine remotely is the queue, through the worker. So a
// client what-if becomes a queued job, and this file is the job's shape and its state machine.
//
// ── WHY IT IS NOT IN THE CLEARANCE QUEUE ─────────────────────────────────────────────────────────────
//
// studio/prelim-search/queue holds CLEARANCE jobs, and the runner treats every file in it as one: it
// runs validateJob's whole field allowlist, resolves a product and a scope through resolveRequest,
// checks the matter ledger for duplicates, counts the daily allowance, and takes a slot from the global
// run-lock pool. A what-if is none of those things — it re-runs ONE stage of a run that already exists,
// against a job that was already admitted, resolved and paid for. Threading a kind discriminator through
// that door would mean teaching six modules that a queue file might not be a clearance, and every one of
// them fails open if it is not taught: an unknown kind reads as a malformed clearance, not as a what-if.
//
// So the queue lives WHERE THE WORK IS: `<runDir>/_experiments/_queue/`, beside the `_experiments/`
// directory the result lands in. Three things follow from that placement, and they are the argument:
//
//   1. THE JOB IS ADDRESSED BY ITS RUN. A client reaches a what-if through {runId, experimentId}, so the
//      MCP dispatch chokepoint's existing account gate — assertAccountAccess on the resolved run — covers
//      enqueue and read alike. There is no second gate to keep in step with the first.
//   2. IT INHERITS THE RUN'S LIFECYCLE. Archive the run and its pending what-ifs go with it; the run dir
//      is already the unit everything else in this engine is keyed to.
//   3. THE CLEARANCE PATH IS UNTOUCHED. Nothing here is reachable from validateJob, slot-lock, the matter
//      ledger or queue-order, so no paid search can be starved, delayed or mis-admitted by a what-if.
//
// ── THE FILENAME VOCABULARY ──────────────────────────────────────────────────────────────────────────
//
// The same three-suffix protocol the clearance queue uses, for the same reason (queue-markers.mjs):
//
//   <id>.json         PENDING   — written by the enqueueing door
//   <id>.processing   CLAIMED   — atomic rename; only one worker can win it
//   <id>.done         FINISHED  — carries the result
//   <id>.failed       FINISHED  — carries the failure
//
// The claim is a rename because a rename is the only atomic claim a shared filesystem gives us. It
// deliberately does NOT carry the clearance queue's liveness sidecar: a what-if abandoned by a dead
// worker is re-claimable after `STALE_CLAIM_MS` and re-running one stage twice costs a stage, where
// re-running a CLEARANCE twice costs a second billable search and a second report to a lawyer. The
// cheaper failure buys a much simpler protocol, and the asymmetry is the whole reason to state it.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ── WHICH RUNS A WHAT-IF MAY TOUCH — ONE DECLARATION, TWO READERS ───────────────────────────────────
//
// FOUND BY DRIVING IT (, 2026-09-03). There were THREE copies of this question and
// they did not agree. `whatIfPlan` and `whatIfEnqueue` refused `location === "archive" || state ===
// "delivered"`; the worker refused the presence of any of `.delivered`, `.failed`, `.cancelled`,
// `.cancel`. A run that had FAILED passed the first two and was refused by the third — so a client could
// plan a what-if it was told was runnable, enqueue it successfully, and have the worker refuse it
// minutes later. The door promised what the worker refused, which is the defect class this engine's
// guards exist to catch, sitting inside the feature built to be careful about it.
//
// No unit test could see it: the MCP tests inject the runner, and the worker's own test writes
// `.delivered` — the one marker all three copies agreed about. It took a real run with a real marker.
//
// THE MEMBERSHIP, and why `failed` is NOT on it. The rule everywhere is "what-if runs on LIVE
// (undelivered) runs only", and a failed run is undelivered: re-running one stage of it under changed
// guidance is exactly how somebody investigates a failure, and its artifacts are all there. What stays
// refused is work that is FINISHED (delivered, archived — read it with trace/read_artifact instead) or
// work somebody STOPPED (cancelled — spending on a run its owner cancelled is the one direction with no
// good answer).
export const WHATIF_REFUSED_MARKERS = Object.freeze([".delivered", ".cancelled", ".cancel"]);

/**
 * Why a what-if may not touch this run, or null when it may. ONE composer, so the two callers cannot
 * drift: the MCP door knows `location`/`state`, the worker knows which marker files are on disk, and
 * both get the same sentence for the same run.
 */
export function whatIfRefusal({ location = null, state = null, markers = [], kind = "stage" } = {}) {
  const has = (m) => markers.includes(m);
  const finished = location === "archive" || state === "delivered" || has(".delivered");
  // — A MEMO IS NOT A RE-RUN, AND THE FINISHED STATE IS WHY IT EXISTS.
  //
  // The refusal below is right about re-running a STAGE on a finished run: that recomputes work over a
  // delivered report's own inputs, and the report is already with the client. But it was answering a
  // narrower question than the one clients ask. "What if the Korean application were abandoned?" about a
  // report they are holding is the most natural question there is, and both halves of the old answer —
  // closed runs are read-only, commission a fresh search — were true and left nothing in between.
  //
  // A memo reads the ARCHIVED evidence and reasons over it. It dispatches no search, recomputes no stage
  // and rates nothing anew; it is a child document that names its parent. So the finished state is not an
  // obstacle to it — a finished run is the only kind it makes sense on.
  //
  // CANCELLED STAYS REFUSED FOR BOTH. A run its owner stopped has evidence that was never completed, and
  // reasoning over a half-gathered record is how a memo comes to say more than the run ever knew.
  if (finished && kind !== "memo")
    return "this run is delivered or archived — what-if runs on live runs only; read it with trace or read_artifact instead";
  if (state === "cancelled" || has(".cancelled") || has(".cancel"))
    return kind === "memo"
      ? "this run was stopped before its evidence was complete, so a memo over it would reason from a record the run itself never finished"
      : "this run was stopped, so there is nothing here to re-run";
  return null;
}

/** A claim older than this is treated as abandoned and may be taken over. One stage, re-run at worst. */
export const STALE_CLAIM_MS = 60 * 60 * 1000;

export const WHATIF_QUEUE_REL = join("_experiments", "_queue");
export const whatIfQueueDir = (runDir) => join(runDir, WHATIF_QUEUE_REL);

// An id the caller supplied is never trusted as a path segment: it addresses a FILE in the run dir, so a
// slash or a dot-dot in it is a traversal out of the run the account gate just checked. Minted here,
// validated on every read.
const ID_RE = /^wi-[0-9a-f]{8}$/;
export const isWhatIfId = (id) => ID_RE.test(String(id ?? ""));
const mintId = () => `wi-${randomUUID().replace(/-/g, "").slice(0, 8)}`;

const STATES = { json: "queued", processing: "running", done: "done", failed: "failed" };

function pathFor(runDir, id, suffix) { return join(whatIfQueueDir(runDir), `${id}.${suffix}`); }

/**
 * Write a pending what-if job. `op` is the DECODED confirmation-token payload — the same
 * {runId, stage, axis, instructions, model} lib/whatif.mjs re-validates before it runs anything, stored
 * verbatim so the worker validates the caller's op rather than a re-derivation of it.
 */
export function enqueueWhatIf(runDir, { op, requestedBy = null, account = null, now = Date.now() }) {
  if (!op || typeof op !== "object" || !op.runId || !op.stage) throw new Error("enqueueWhatIf: op must carry runId and stage");
  const id = mintId();
  const dir = whatIfQueueDir(runDir);
  mkdirSync(dir, { recursive: true });
  const job = { schema: 1, id, op, requestedBy, account, queuedAt: new Date(now).toISOString() };
  // tmp-then-rename: a partially written manifest is unparseable forever, where an absent one is simply
  // not yet queued. The clearance queue's claim path learned this the expensive way.
  const tmp = pathFor(runDir, id, "json.tmp");
  writeFileSync(tmp, JSON.stringify(job, null, 2));
  renameSync(tmp, pathFor(runDir, id, "json"));
  return job;
}

/** Every pending (or stale-claimed) job in ONE run dir, oldest first. */
export function pendingWhatIf(runDir, { now = Date.now() } = {}) {
  const dir = whatIfQueueDir(runDir);
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files.sort()) {
    if (f.endsWith(".json")) { out.push({ runDir, id: f.slice(0, -5), path: join(dir, f), stale: false }); continue; }
    // A CLAIM NOBODY FINISHED. The clearance queue asks whether the claimer is alive; this asks only
    // whether the claim is old, because the worst case here is one stage run twice. Stated at the top.
    if (f.endsWith(".processing")) {
      let age = 0;
      try { age = now - statSync(join(dir, f)).mtimeMs; } catch { continue; }
      if (age > STALE_CLAIM_MS) out.push({ runDir, id: f.slice(0, -11), path: join(dir, f), stale: true });
    }
  }
  return out;
}

/**
 * Claim a job by atomic rename. Returns the parsed job, or null when another worker won it, the file
 * vanished, or its manifest is unreadable (which is recorded as a failure rather than retried forever).
 */
export function claimWhatIf(entry) {
  const target = pathFor(entry.runDir, entry.id, "processing");
  if (!entry.stale) {
    try { renameSync(entry.path, target); } catch { return null; }
  }
  try { return { ...JSON.parse(readFileSync(target, "utf8")), _path: target }; }
  catch (e) {
    try { writeFileSync(pathFor(entry.runDir, entry.id, "failed"), JSON.stringify({ id: entry.id, state: "failed", error: `unreadable manifest: ${e.message}` }, null, 2)); } catch { /* best-effort */ }
    return null;
  }
}

/**
 * Record a terminal state. `ok:false` writes `.failed`; both carry the payload the read tool returns.
 *
 * THE OP TRAVELS INTO THE TERMINAL RECORD. It was only ever on the `.json`/`.processing` manifest, so a
 * finished experiment could not say what it had been asked to do — and the read tool's whole listing
 * answers "what have I asked of this run". A record of a decision that does not carry the decision is
 * the same absence the audit trail exists to prevent; it is copied rather than re-derived because the
 * manifest is gone by the time anyone reads this.
 */
export function finishWhatIf(runDir, id, { ok, op = null, result = null, error = null, now = Date.now() }) {
  const body = { schema: 1, id, op, state: ok ? "done" : "failed", finishedAt: new Date(now).toISOString(), result, error };
  const suffix = ok ? "done" : "failed";
  const tmp = pathFor(runDir, id, `${suffix}.tmp`);
  writeFileSync(tmp, JSON.stringify(body, null, 2));
  renameSync(tmp, pathFor(runDir, id, suffix));
  try { const p = pathFor(runDir, id, "processing"); if (existsSync(p)) renameSync(p, `${p}.consumed`); } catch { /* best-effort */ }
  return body;
}

/**
 * The state of one what-if, for the read tool. Never throws on a missing job — an id that names nothing
 * is an ABSENCE, and the caller has to be able to tell it from a job that is merely still queued.
 */
export function readWhatIf(runDir, id) {
  if (!isWhatIfId(id)) return { id, state: "unknown", note: "not a what-if id issued by this server" };
  for (const [suffix, state] of Object.entries(STATES)) {
    const p = pathFor(runDir, id, suffix);
    if (!existsSync(p)) continue;
    let body = null;
    try { body = JSON.parse(readFileSync(p, "utf8")); } catch { /* a mid-write terminal reads as its state with no body */ }
    return { id, state, ...(body ?? {}) };
  }
  return { id, state: "unknown", note: "no what-if with that id on this run" };
}

/** Every what-if on a run, newest last — the listing behind "what have I asked of this run". */
export function listWhatIf(runDir) {
  let files = [];
  try { files = readdirSync(whatIfQueueDir(runDir)); } catch { return []; }
  const ids = new Set();
  for (const f of files) { const id = f.split(".")[0]; if (isWhatIfId(id)) ids.add(id); }
  return [...ids].sort().map((id) => readWhatIf(runDir, id));
}
