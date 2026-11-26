// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// order-receipt.mjs — what became of an accepted order, looked up by the reference its door returned, for the account
// that placed it. Internal: nothing here sends a notice, and no door shows it yet.
//
// WHY A LOOKUP AND NOT A NEW RECORD. Everything a receipt needs is already on disk, in the queue directory, under the
// order's own reference (`<id>`, the queue file's name, which every door returns):
//
//   <id>.json                      accepted, waiting for a worker
//   <id>.processing.claimed-<tok>  a worker took it and stopped mid-claim; it is reclaimed under the same reference
//   <id>.processing                claimed, its pre-start checks under way
//   <id>.processing.meta           written at dispatch, AFTER those checks passed: the run's identity is minted
//   <id>.postponed (+ .meta)       parked, by a provider cap or our own recovery backoff; it resumes by itself
//   <id>.failed + .failed.reason   refused at the claim, before any run existed (failAtIntake)
//   <id>.duplicate + .reason       refused as the same matter as an earlier order (parkDuplicate)
//   <id>.{done,failed,cancelled}.result   the run's own outcome, with its run directory
//
// Nothing in the driver or the scripts deletes a terminal marker or its `.reason` / `.result`, so they last as long
// as the queue directory does. Reading them is therefore the durable receipt; a second store would be a second answer
// to the same question.
//
// THREE ANSWERS, NOT TWO, as `accountUsage` keeps them: `found`, `not-found`, and `could-not-look` (a queue directory
// that would not open is not "no such order"). An order that belongs to another account answers `not-found`, exactly
// as one that does not exist: neither its existence nor its reason is anybody else's to learn.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, dirname } from "node:path";
import { deriveSlug } from "./phase0.mjs";
import { stopReason } from "../shared/stop-reason.mjs";   // a cancelled order says it was stopped, never a blank reason

/**
 * The reference an order is known by: its queue file's name. The connector's start_run admits exactly these ids, so a
 * reference outside this set names no order, and is refused before it reaches a path. Mirrors start_run's validator.
 */
export const ORDER_REF_MAX = 128;
export const ORDER_REF_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,${ORDER_REF_MAX - 1}}$`);

// ── AN ACCOUNT'S REFERENCE IS ITS OWN ─────────────────────────────────────────────────────────────────────────────────
// A caller that does not see every account files its order under the reference it chose plus a fixed mark of its account
// (and of the organisation, for Generic), so two accounts' references never meet. start_run files that way; the lookup
// resolves a reference the same way, so a caller finds its order by the reference it chose or by the one it was given.

/** The fixed mark of an account's references: its account, and its organisation for Generic. */
export const ACCOUNT_MARK_LEN = 12;
export function accountMark({ profileKey, tenant } = {}) {
  const account = profileKey ?? "generic";
  const organisation = account === "generic" ? (tenant ?? "") : "";
  return createHash("sha256").update(`${account}\u0000${organisation}`).digest("hex").slice(0, ACCOUNT_MARK_LEN);
}

/**
 * The references `ref` may name for this caller, most specific first. A caller who sees everything names exactly what it
 * gives. Any other names its own account's filing of it (the reference plus its mark), then the bare reference, which an
 * order filed before references carried a mark still uses and which the scope check below still guards.
 */
export function referenceCandidates(ref, scope) {
  if (scope?.everything === true) return [ref];
  const mark = `@${accountMark({ profileKey: scope?.account ?? null, tenant: scope?.organisation ?? null })}`;
  if (ref.endsWith(mark)) return [ref];
  const filed = `${ref}${mark}`;
  return filed.length <= ORDER_REF_MAX ? [filed, ref] : [ref];
}

/** The states an order can be in, in the words the receipt uses. */
export const RECEIPT_STATES = Object.freeze({
  waiting: "accepted and waiting for a worker",
  checking: "taken by a worker; its checks before starting are under way",
  running: "passed its checks; its run has started",
  resumable: "parked, and will resume by itself",
  refused: "refused before a run started",
  failed: "its run stopped before delivering",
  delivered: "its run finished",
  cancelled: "stopped on request",
});
const TERMINAL = new Set(["refused", "failed", "delivered", "cancelled"]);

/**
 * May this caller see this order? The scope `checkRunCaps` counts a lane by: the job's account, and for Generic the
 * organisation it was filed under. A job that names no account (an email order before its claim) is visible only to
 * a caller who sees everything. PURE.
 */
export function orderInScope(job, scope) {
  if (scope?.everything === true) return true;
  const account = scope?.account ?? null;
  if (!account || !job || (job.profileKey ?? null) !== account) return false;
  return account !== "generic" || (job.tenant ?? null) === (scope?.organisation ?? null);
}

const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readTextSafe = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** A refusal's reason as the runner wrote it, without its own bookkeeping line ("notify: …"). */
function reasonFrom(text) {
  if (text == null) return null;
  const lines = String(text).split("\n").map((l) => l.trim()).filter((l) => l && !/^notify:/i.test(l));
  return lines.length ? lines.join("\n") : null;
}

/** The canonical run id, `<slug>-<date>-<codename>`, from a run directory (`…/<slug>/<date>-<codename>`). */
const runIdFromDir = (runDir) => (runDir ? `${basename(dirname(runDir))}-${basename(runDir)}` : null);

/** The run id a dispatch minted, from the job and its `.meta`, before any `.result` exists. */
function runIdFromMeta(job, meta) {
  if (!meta?.codename || !meta?.dateISO) return null;
  try { return `${deriveSlug(job)}-${meta.dateISO}-${meta.codename}`; } catch { return null; }
}

/** The marker files for one reference in one queue directory, by the name they carry. */
function markersFor(qdir, names, ref) {
  const own = names.filter((n) => n === `${ref}.json` || n.startsWith(`${ref}.`));
  const has = (s) => own.includes(`${ref}.${s}`);
  const claimed = own.find((n) => n.startsWith(`${ref}.processing.claimed-`) && !/\.(pid|meta|skips|tmp)$/.test(n)) ?? null;
  return { own, has, claimed };
}

/**
 * Read one order's receipt out of one queue directory, or null when the directory holds nothing for this reference.
 * The job is read from whichever marker carries it; `.result` decides before `.meta`, so a refusal after dispatch reads
 * as a refusal, and a run directory holding a park sentinel reads as resumable whatever the queue marker says.
 */
export function receiptIn(qdir, ref, names) {
  const { has, claimed } = markersFor(qdir, names, ref);
  const at = (s) => join(qdir, `${ref}.${s}`);
  const terminal = ["done", "failed", "cancelled", "duplicate"].find((s) => has(s)) ?? null;
  const live = has("postponed") ? "postponed" : has("processing") ? "processing" : claimed ? "claimed" : has("json") ? "json" : null;
  if (!terminal && !live) return null;
  const markerPath = terminal ? at(terminal) : live === "claimed" ? join(qdir, claimed) : at(live);
  const job = readJsonSafe(markerPath);
  let updatedAt = null;
  try { updatedAt = statSync(markerPath).mtime.toISOString(); } catch { /* the marker moved under us; the next read sees it */ }
  const base = { reference: ref, job, updatedAt };

  if (terminal) {
    const result = readJsonSafe(at(`${terminal}.result`));
    const reason = reasonFrom(readTextSafe(at(`${terminal}.reason`)));
    // A CANCELLED ORDER SAYS IT WAS STOPPED: the stop's own recorded reason, or, where none was written (an order taken
    // off the queue before it started), the shared stop sentence with nothing invented (shared/stop-reason.mjs).
    if (terminal === "cancelled") return { ...base, state: "cancelled", reason: result?.reason ?? stopReason(), runId: runIdFromDir(result?.runDir) };
    // A DUPLICATE'S RECORDED REASON NAMES THE EARLIER ORDER it matched (its message id), and that order may be another
    // account's: the matter signature does not include the account. Only its first line, which says what happened,
    // is the receipt's. Pointing to the earlier order is for a later increment, which can ask whether this caller may see it.
    if (terminal === "duplicate") return { ...base, state: "refused", reason: reason ? reason.split("\n")[0] : null, runId: null, kind: "duplicate" };
    if (terminal === "done") return { ...base, state: "delivered", reason: null, runId: runIdFromDir(result?.runDir) };
    // `.failed`: refused at the claim (a reason, no result), refused at dispatch (a pre-run result), or a run that
    // stopped. A run directory still holding a park sentinel is a run that will come back, not a failure.
    const runDir = result?.runDir ?? null;
    if (runDir && (existsSync(join(runDir, ".postponed")) || existsSync(join(runDir, ".resuming")))) {
      return { ...base, state: "resumable", reason: null, runId: runIdFromDir(runDir) };
    }
    const beforeStart = !result || result.failedStage === "pre-run" || !runDir;
    const why = reason ?? result?.reason ?? (result?.failedStage ? `stopped at ${result.failedStage}` : null);
    return beforeStart
      ? { ...base, state: "refused", reason: why, runId: null }
      : { ...base, state: "failed", reason: why, runId: runIdFromDir(runDir) };
  }
  if (live === "postponed") {
    const meta = readJsonSafe(at("postponed.meta"));
    return { ...base, state: "resumable", reason: null, runId: runIdFromDir(meta?.runDir) ?? runIdFromMeta(job, meta) };
  }
  if (live === "processing") {
    // CLAIMING IS NOT PASSING: `.meta` lands only at dispatch, after the checks. Without it the order is still being
    // checked, and nothing here says it started.
    const meta = readJsonSafe(at("processing.meta"));
    return meta?.codename
      ? { ...base, state: "running", reason: null, runId: runIdFromMeta(job, meta) }
      : { ...base, state: "checking", reason: null, runId: null };
  }
  if (live === "claimed") return { ...base, state: "checking", reason: null, runId: null };
  return { ...base, state: "waiting", reason: null, runId: null };
}

/**
 * The receipt for `reference`, as `scope` may see it.
 *
 *   scope   { account, organisation } for a company's caller, or { everything: true } for one who sees every order.
 *
 * Returns one of:
 *   { found: true,  receipt: { reference, state, stateText, terminal, reason, runId, account, organisation, updatedAt } }
 *   { found: false, basis: "not-found" }                  no order by that reference that this caller may see
 *   { found: false, basis: "invalid-reference" }          not a reference any door issues
 *   { found: false, basis: "could-not-look", unreadable } a queue directory would not open: not an answer
 *   { found: false, basis: "ambiguous" }                  two queue directories hold it; neither is picked
 */
export function orderReceipt({ queueDirs, reference, scope } = {}) {
  const asked = String(reference ?? "");
  if (!ORDER_REF_RE.test(asked) || asked.includes("..")) return { found: false, basis: "invalid-reference" };
  let couldNotLook = null;
  for (const ref of referenceCandidates(asked, scope)) {
    const r = receiptFor({ queueDirs, ref, scope });
    if (r.found || r.basis === "ambiguous") return r;
    if (r.basis === "could-not-look") couldNotLook = r;
  }
  return couldNotLook ?? { found: false, basis: "not-found" };
}

/** One reference, as `scope` may see it: the answer `orderReceipt` gives for that reference alone. */
function receiptFor({ queueDirs, ref, scope }) {
  const dirs = (Array.isArray(queueDirs) ? queueDirs : []).filter((d) => typeof d === "string" && d);
  const hits = [];
  let unreadable = 0;
  for (const qdir of dirs) {
    let names;
    try { names = readdirSync(qdir); }
    catch (e) { if (e?.code !== "ENOENT") unreadable++; continue; }
    const r = receiptIn(qdir, ref, names);
    if (r) hits.push(r);
  }
  const visible = hits.filter((r) => orderInScope(r.job, scope));
  if (visible.length > 1) return { found: false, basis: "ambiguous" };
  if (visible.length === 1) {
    const r = visible[0];
    return { found: true, receipt: {
      reference: r.reference, state: r.state, stateText: RECEIPT_STATES[r.state], terminal: TERMINAL.has(r.state),
      reason: r.reason ?? null, runId: r.runId ?? null, ...(r.kind ? { kind: r.kind } : {}),
      account: r.job?.profileKey ?? null, ...(r.job?.profileKey === "generic" ? { organisation: r.job?.tenant ?? null } : {}),
      updatedAt: r.updatedAt,
    } };
  }
  // Not found by this caller. A directory that would not open makes that a floor, not an answer.
  if (unreadable) return { found: false, basis: "could-not-look", unreadable };
  return { found: false, basis: "not-found" };
}
