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
import { join, basename, dirname, resolve } from "node:path";
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

/** The id rule's own sentence, for a reference that is not one; `max` is lower where an account's mark must fit. */
export const orderRefRefusal = (id, max = ORDER_REF_MAX) => `id ${JSON.stringify(id)}: Use an ID of 1–${max} characters. Start with an ASCII letter or digit. `
  + `The remaining characters may also include a dot, underscore, @ or hyphen.${id.length > max ? ` This one has ${id.length} characters.` : ""}`;

/**
 * The reference an order is filed under: as sent for a caller that sees every account, else carrying its account's
 * mark. A reference that already ends in that mark is that reference. Throws the id rule's sentence when the mark
 * would not fit. Moved here from the connector, unchanged, so every door files and finds by one rule.
 */
export function filedReference(asked, job, { everyAccount = false } = {}) {
  if (everyAccount) return asked;
  const mark = `@${accountMark(job ?? {})}`;
  if (asked.endsWith(mark)) return asked;
  const max = ORDER_REF_MAX - mark.length;
  if (asked.length > max) throw new Error(orderRefRefusal(asked, max));
  return `${asked}${mark}`;
}

/** The references `ref` names in one queue directory's listing as filed with an account's mark: `<ref>@<mark>`. */
const MARKED = new RegExp(`^@([0-9a-f]{${ACCOUNT_MARK_LEN}})\\.`);
function filedUnder(ref, names) {
  const out = new Set();
  for (const n of names) {
    if (!n.startsWith(`${ref}@`)) continue;
    const m = MARKED.exec(n.slice(ref.length));
    if (m) out.add(`${ref}@${m[1]}`);
  }
  return [...out];
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
 *
 *   { everything: true }          every order
 *   { account, organisation }     one account's orders, and one organisation's for Generic (the portal names one)
 *   { sees(account, organisation) }  the caller's own visibility rule, for a caller that may hold several accounts
 */
export function orderInScope(job, scope) {
  if (scope?.everything === true) return true;
  if (typeof scope?.sees === "function") {
    const account = job?.profileKey ?? null;
    return account != null && scope.sees(account, account === "generic" ? (job.tenant ?? null) : null) === true;
  }
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
  // WHEN IT LAST CHANGED: the latest of the marker and what was written beside it. A marker is the job file renamed,
  // and a rename keeps the file's time, so a refused order's marker alone says when it was PLACED; its `.reason` or
  // `.result` says when it was refused or stopped.
  let updatedAt = null;
  const stamps = [markerPath, ...(terminal ? [at(`${terminal}.reason`), at(`${terminal}.result`)] : [at(`${live}.meta`)])]
    .map((p) => { try { return statSync(p).mtimeMs; } catch { return null; } }).filter((t) => t != null);
  if (stamps.length) updatedAt = new Date(Math.max(...stamps)).toISOString();
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
    // WHERE IT WAS REFUSED, for whoever must act: at the claim (the allowance, the order's own content, a demo account)
    // the person who placed it can, and at dispatch (the pre-start checks, the engine's sign-in) only the operator can.
    return beforeStart
      ? { ...base, state: "refused", reason: why, runId: null, kind: result ? "pre-run" : "claim" }
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

/** Every queue directory's listing, each read once; a directory that would not open is counted, not skipped silently. */
function listQueues(queueDirs) {
  const dirs = [...new Set((Array.isArray(queueDirs) ? queueDirs : []).filter((d) => typeof d === "string" && d).map((d) => resolve(d)))];
  const listings = [];
  let unreadable = 0;
  for (const qdir of dirs) {
    try { listings.push({ qdir, names: readdirSync(qdir) }); }
    catch (e) { if (e?.code !== "ENOENT") unreadable++; }
  }
  return { listings, unreadable };
}

/** Every order held under any of `refs`, in any of the listings, whoever's it is. */
function heldUnder(listings, refs) {
  const hits = [];
  for (const ref of refs) for (const { qdir, names } of listings) {
    const r = receiptIn(qdir, ref, names);
    if (r) hits.push(r);
  }
  return hits;
}

/** The receipt as every door gives it, from one order's markers. */
function receiptOf(r) {
  return {
    reference: r.reference, state: r.state, stateText: RECEIPT_STATES[r.state], terminal: TERMINAL.has(r.state),
    reason: r.reason ?? null, runId: r.runId ?? null, ...(r.kind ? { kind: r.kind } : {}),
    account: r.job?.profileKey ?? null, ...(r.job?.profileKey === "generic" ? { organisation: r.job?.tenant ?? null } : {}),
    updatedAt: r.updatedAt,
  };
}

/**
 * The receipt for `reference`, as `scope` may see it (the forms `orderInScope` takes).
 *
 * WHICH ORDERS A REFERENCE NAMES. A caller who sees everything names exactly the reference it gives: an operator files
 * as sent. Any other caller names the order filed under that reference with its account's mark (`<reference>@<mark>`,
 * as `filedReference` files it), and the order filed under the reference as given: the reference start_run handed back,
 * or an order filed before references carried a mark. Every one of those is held to the caller's own visibility, so an
 * order another account holds is never among them.
 *
 * Returns one of:
 *   { found: true,  receipt: { reference, state, stateText, terminal, reason, runId, account, organisation, updatedAt } }
 *   { found: false, basis: "not-found" }                  no order by that reference that this caller may see
 *   { found: false, basis: "invalid-reference" }          not a reference any door issues
 *   { found: false, basis: "could-not-look", unreadable } a queue directory would not open: not an answer
 *   { found: false, basis: "ambiguous" }                  this caller may see two orders by it; neither is picked
 */
export function orderReceipt({ queueDirs, reference, scope } = {}) {
  const asked = String(reference ?? "");
  if (!ORDER_REF_RE.test(asked) || asked.includes("..")) return { found: false, basis: "invalid-reference" };
  const { listings, unreadable } = listQueues(queueDirs);
  const refs = scope?.everything === true ? [asked]
    : [...new Set([...listings.flatMap(({ names }) => filedUnder(asked, names)), asked])];
  const visible = heldUnder(listings, refs).filter((r) => orderInScope(r.job, scope));
  if (visible.length > 1) return { found: false, basis: "ambiguous" };
  if (visible.length === 1) return { found: true, receipt: receiptOf(visible[0]) };
  // Not found by this caller. A directory that would not open makes that a floor, not an answer.
  if (unreadable) return { found: false, basis: "could-not-look", unreadable };
  return { found: false, basis: "not-found" };
}

/** Whether two jobs are one account's: the same account, and the same organisation for Generic. */
function sameAccount(a, b) {
  const account = (j) => j?.profileKey ?? "generic";
  if (account(a) !== account(b)) return false;
  return account(a) !== "generic" || (a?.tenant ?? null) === (b?.tenant ?? null);
}

/**
 * What a new order meets before it is filed: an order already held under the reference it will be filed under, or under
 * the reference as sent (an order filed before references carried a mark). Asked before anything is counted or written,
 * so a retry is recognised as one. `scope` is the caller's visibility, in the forms `orderInScope` takes.
 *
 * Returns null when neither reference holds an order, or one of:
 *   { held: "mine",   receipt }            this caller's own order for the same account: the retry is that order
 *   { held: "other",  reference, state }   an order this caller may see, for another account: it is not this order
 *   { held: "hidden", reference }          the filed reference is taken by an order this caller may not see; nothing
 *                                          of it may be told, and it may not be written over
 * Under the reference as sent, an order this caller may not see is no order at all: the new one is filed beside it.
 */
export function orderAlreadyFiled({ queueDirs, filed, asked, job, scope } = {}) {
  const { listings } = listQueues(queueDirs);
  for (const ref of asked && asked !== filed ? [filed, asked] : [filed]) {
    for (const r of heldUnder(listings, [ref])) {
      if (!orderInScope(r.job, scope)) {
        if (ref === filed) return { held: "hidden", reference: ref };
        continue;
      }
      if (sameAccount(r.job, job)) return { held: "mine", receipt: receiptOf(r) };
      return { held: "other", reference: ref, state: r.state };
    }
  }
  return null;
}
