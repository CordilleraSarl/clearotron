// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// notice-delivery.mjs — failure notices sent through the route an install configures (notice-route.mjs), each one
// recorded from first sight to confirmed delivery, across restarts.
//
// WHAT IS OWED, AND WHERE IT IS READ FROM. A notice is owed for what an order's receipt says (order-receipt.mjs) and
// for the engine check's record, never for an outbox marker: a marker is an edge-trigger that the owed-run rescan
// drops again and a courier's acknowledgement deletes, so a record keyed on one would be made twice or lose its
// source. What is owed, to whom:
//
//   an order refused at the claim     the person who placed it
//   an order refused at dispatch      the person who placed it, and the operator (the pre-start checks, the sign-in)
//   a run that stopped                the person who placed it, and the operator
//   the engine check failing          the operator
//   a finished report's send stuck    the operator alone (design, 2026-11-26): the report is the courier's to deliver,
//                                     and the outbox's no-progress breaker setting its marker aside is the confirmed
//                                     failure (quarantine/STUCK-ALERTS.jsonl). Elapsed time alone raises nothing. The
//                                     alert settles nothing: the report stays owed to its submitter, and the courier's
//                                     own delivery settles it, without a second search
//
// A cancelled order was stopped on request, and a parked one resumes by itself: neither is owed a notice. An audience
// is owed nothing from before the route began to serve it, so naming a route does not send the install's history, and
// an audience handed over from a courier is not told again what the courier told it.
//
// WHAT EACH AUDIENCE IS SENT. Fields, never sentences: the words a recipient reads are the owner's, and none are
// approved yet. The person who placed an order is sent the receipt as `order_status` gives it to a company (no
// account, no diagnostics, a reason only for an order refused before it ran) and the recipient their order named.
// The operator is sent the fault and the next recovery action as a code. Nothing sent for one company carries
// another's reference, account or mark.
//
// ONE ROUTE PER EVENT AND RECIPIENT. The route serves the audiences the install names (CLEAROTRON_NOTICE_AUDIENCES);
// an audience it does not name stays with the courier, through the outbox, untouched. A receiver's 2xx stops any
// further handoff of that notice. Where the receiver also returns a downstream send receipt for the person who placed
// a stopped run, that run's owed send is settled as mark_sent settles it (send-settle.mjs), for that failure only; a
// run already settled is not sent at all.
//
// THE RECORD. One file per notice, `<outbox>/deliveries/<id>.json`, a folder no courier's `*.pending` glob reaches.
// The id is a hash of the event, the audience and the recipient: it survives restarts and retries, and it travels to
// the receiver so a receiver can drop a repeat. States, each recorded as it happens:
//
//   pending     owed, not yet sent
//   attempted   written BEFORE the request goes out; a record still here at the start of a pass is a process that
//               stopped mid-send, and the receiver may or may not hold the notice
//   confirmed   the receiver answered 2xx
//   failed      not reached, or refused by the receiver: sent again after a wait; the search is never repeated
//   ambiguous   the request went out and no answer came back, or a process stopped mid-send. Sent again only where
//               the receiver drops repeats (CLEAROTRON_NOTICE_DEDUPE=1); otherwise left for the operator to settle
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { config } from "./driver.config.mjs";
import { receiptIn } from "./order-receipt.mjs";
import { NOTICE_AUDIENCES, noticeRoute, postNotice } from "./notice-route.mjs";
import { engineCheckDir } from "./engine/health.mjs";
import { owedPacket, sendSettled, settleSend } from "./send-settle.mjs";
import { runDirFor } from "./outbox-backoff.mjs";   // the run a stuck marker names, live or archived
import { note } from "./log.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const NOTICE_STATES = Object.freeze(["pending", "attempted", "confirmed", "failed", "ambiguous"]);
/** What the operator does next, as a code: the words are the owner's. */
export const NEXT_ACTIONS = Object.freeze({ "check-engine": "check-engine", "read-the-run": "read-the-run",
  "settle-with-receiver": "settle-with-receiver", "release-the-delivery": "release-the-delivery" });

const deliveriesDir = () => join(config.outboxDir, "deliveries");
const recordPath = (id) => join(deliveriesDir(), `${id}.json`);
const sincePath = () => join(deliveriesDir(), "route-since.json");

const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const stringOr = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
function writeAtomic(path, value) {
  mkdirSync(deliveriesDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

/** The stable id of one notice: its event, its audience and its recipient. */
export function deliveryId(eventKey, audience, recipientKey) {
  return createHash("sha256").update(`${eventKey}\u0000${audience}\u0000${recipientKey}`).digest("hex").slice(0, 24);
}

// ── who it is for ───────────────────────────────────────────────────────────────────────────────────────────────

/** The person an order names as its submitter or forwarder, bound to the company (and organisation) it was for. */
function submitterOf(job) {
  const account = job?.profileKey ?? null;
  return {
    account, organisation: account === "generic" ? (job?.tenant ?? null) : null,
    forwarder: job?.forwarder ?? null, forwarderEmail: job?.forwarderEmail ?? null, msgId: job?.msgId ?? null,
  };
}
/** An order that names nobody to tell (no forwarder, no address) is owed no notice to its submitter. */
const reachable = (r) => Boolean(r.forwarder || r.forwarderEmail);
const submitterKey = (r) => `submitter\u0000${r.account ?? ""}\u0000${r.organisation ?? ""}\u0000${r.forwarderEmail ?? r.forwarder ?? ""}`;
const OPERATOR = Object.freeze({ role: "operator" });

/** The receipt as a company sees it: the same fields `order_status` answers a client with. */
const clientView = (r) => ({
  reference: r.reference, state: r.state, terminal: true, runId: r.runId ?? null,
  reason: r.state === "refused" ? (r.reason ?? null) : null,
});

// ── what is owed ────────────────────────────────────────────────────────────────────────────────────────────────

const TERMINAL_MARKER = /^(.+)\.(failed|duplicate)$/;
const atMs = (iso) => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? t : null; };

/** The latest time any of an order's terminal files was written, read without opening them. */
function lastWritten(qdir, ref) {
  let latest = 0;
  for (const s of ["failed", "failed.reason", "failed.result", "duplicate", "duplicate.reason"]) {
    try { latest = Math.max(latest, statSync(join(qdir, `${ref}.${s}`)).mtimeMs); } catch { /* not this one */ }
  }
  return latest;
}

/**
 * Every notice owed, read from the queue's receipts and the engine check's record. PURE over the files it reads.
 * `since` holds, per audience, the time from which it is owed notices (null: not served). An order written before
 * every audience's time is passed over unread, so a pass costs what is new, not the install's whole history.
 * Each: { id, eventKey, kind, audience, recipient, body, at, settle? }.
 */
export function owedNotices({ queueDirs = config.queueDirs, since = { submitter: 0, operator: 0 }, checkDir = engineCheckDir() } = {}) {
  const owed = [];
  const served = NOTICE_AUDIENCES.filter((a) => Number.isFinite(since?.[a]));
  if (!served.length) return owed;
  const earliest = Math.min(...served.map((a) => since[a]));
  const owedTo = (audience, at) => served.includes(audience) && (atMs(at) ?? 0) >= since[audience];
  for (const qdir of [...new Set((queueDirs ?? []).filter(Boolean).map((d) => resolve(d)))]) {
    let names;
    try { names = readdirSync(qdir); } catch { continue; }
    const refs = new Set(names.map((n) => TERMINAL_MARKER.exec(n)?.[1]).filter(Boolean));
    for (const ref of refs) {
      if (lastWritten(qdir, ref) < earliest) continue;
      const r = receiptIn(qdir, ref, names);
      if (!r) continue;
      const submitter = submitterOf(r.job);
      const fault = { reference: r.reference, runId: r.runId ?? null, account: submitter.account, organisation: submitter.organisation };
      if (r.state === "refused") {
        const eventKey = `order\u0000${qdir}\u0000${r.reference}`;
        const kind = "order-refused";
        if (reachable(submitter)) owed.push({ eventKey, kind, audience: "submitter", recipient: submitter, at: r.updatedAt, body: { order: clientView(r) } });
        if (r.kind === "pre-run")
          owed.push({ eventKey, kind, audience: "operator", recipient: OPERATOR, at: r.updatedAt,
            body: { fault: { kind, cause: "pre-run", ...fault, reason: r.reason ?? null, nextAction: NEXT_ACTIONS["check-engine"] } } });
      } else if (r.state === "failed") {
        const result = readJsonSafe(join(qdir, `${ref}.failed.result`));
        const runDir = result?.runDir ?? null;
        const packet = runDir ? owedPacket(runDir) : null;
        // A run that recovered owes its report, and no longer stands stopped: nobody is told it stopped. Its order
        // still reads failed in the queue, so this is read from the run.
        if (packet?.settled === "delivery") continue;
        // Each failure is its own event, named by its packet's id: a run that stops again after a notice owes a new
        // one, under a new delivery id. A packet written before packets carried an id keeps the run's one key.
        const failureId = packet?.settled === "failure" ? stringOr(readJsonSafe(packet.path)?.failureId) : null;
        const eventKey = `run\u0000${r.runId ?? r.reference}${failureId ? `\u0000${failureId}` : ""}`;
        const kind = "run-stopped";
        // Which failure each notice is about, kept on its record: a later failure or the run's report supersedes it.
        const occurrence = runDir ? { occurrence: { runDir, failureId } } : {};
        if (reachable(submitter) && !(runDir && sendSettled(runDir)))
          owed.push({ eventKey, kind, audience: "submitter", recipient: submitter, at: r.updatedAt, body: { order: clientView(r) }, ...occurrence,
            // The send this notice settles is THIS failure's, told to THIS person: a later failure or the run's report
            // is never it. A failure without an id is settled by no receipt.
            ...(runDir ? { settle: { runDir, runId: r.runId, failureId, recipient: submitterKey(submitter) } } : {}) });
        owed.push({ eventKey, kind, audience: "operator", recipient: OPERATOR, at: r.updatedAt, ...occurrence,
          body: { fault: { kind, ...fault, failedStage: result?.failedStage ?? null, reason: r.reason ?? null, nextAction: NEXT_ACTIONS["read-the-run"] } } });
      }
    }
  }
  // A finished report's send the courier could not make: one alert per marker the no-progress breaker set aside, while
  // the run it names is still owed. A run settled since (the courier delivered it) is owed no alert.
  for (const rec of stuckDeliveries()) {
    const runId = String(rec.marker ?? "").replace(/(\.failed)?\.pending$/, "");
    const runDir = runId ? runDirFor(runId) : null;
    if (runDir && sendSettled(runDir)) continue;
    owed.push({ eventKey: `stuck\u0000${rec.marker}\u0000${rec.ts}`, kind: "delivery-stuck", audience: "operator", recipient: OPERATOR, at: rec.ts,
      body: { fault: { kind: "delivery-stuck", runId: runId || null, marker: rec.marker ?? null, packet: rec.kind ?? null, strikes: rec.strikes ?? null,
        recover: rec.recover ?? null, nextAction: NEXT_ACTIONS["release-the-delivery"] } } });
  }
  // The engine check: one notice per failing episode, the alert the check itself raised.
  let checks = [];
  try { checks = readdirSync(checkDir).filter((n) => n.endsWith(".check.json")); } catch { /* no check yet */ }
  for (const name of checks) {
    const rec = readJsonSafe(join(checkDir, name));
    if (!rec || rec.ok !== false || rec.lane !== "configuration" || !rec.alertedAt) continue;
    const engine = name.replace(/\.check\.json$/, "");
    owed.push({ eventKey: `engine\u0000${engine}\u0000${rec.alertedAt}`, kind: "engine-check-failed", audience: "operator", recipient: OPERATOR, at: rec.alertedAt,
      body: { fault: { kind: "engine-check-failed", engine, mode: rec.mode ?? null, basis: rec.basis ?? null, headline: rec.headline ?? null, fix: rec.fix ?? null, nextAction: NEXT_ACTIONS["check-engine"] } } });
  }
  return owed.filter((n) => owedTo(n.audience, n.at))
    .map((n) => ({ ...n, id: deliveryId(n.eventKey, n.audience, n.audience === "operator" ? "operator" : submitterKey(n.recipient)) }));
}

// ── the record ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The stuck deliveries the outbox's no-progress breaker has recorded, oldest first. */
function stuckDeliveries() {
  let text = "";
  try { text = readFileSync(join(config.outboxDir, "quarantine", "STUCK-ALERTS.jsonl"), "utf8"); } catch { return []; }
  return text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r?.marker && r?.ts);
}

/**
 * From when each audience is owed notices by this install's route: the moment the route began to serve it. An
 * audience the route stops serving loses its time, and gets a new one when it is served again, so nothing that
 * happened while a courier held it, or while no route did, is sent to it later. Returns { submitter, operator } in
 * epoch ms, null where not served. Writes only when something changed, and nothing on an install that never had a route.
 */
export function servedSince(served, now = Date.now()) {
  const held = readJsonSafe(sincePath())?.audiences ?? null;
  const next = Object.fromEntries(NOTICE_AUDIENCES.map((a) => [a,
    served.includes(a) ? (Number.isFinite(atMs(held?.[a])) ? held[a] : new Date(now).toISOString()) : null]));
  const changed = NOTICE_AUDIENCES.some((a) => (held?.[a] ?? null) !== next[a]);
  if (changed && (held || served.length)) writeAtomic(sincePath(), { audiences: next });
  return Object.fromEntries(NOTICE_AUDIENCES.map((a) => [a, atMs(next[a])]));
}

/**
 * Record which audiences the route serves as the worker starts, before it drains anything: a failure in the drain that
 * follows is owed its notice, and an audience no longer served is owed nothing from before it is served again. Runs
 * whether or not a route is configured. Never throws.
 */
export function markRouteSeen({ env = process.env, now = Date.now() } = {}) {
  try { const route = noticeRoute(env); servedSince(route.configured && route.ok ? route.audiences : [], now); }
  catch (e) { note(`[notices] could not record which audiences the route serves: ${e?.message ?? e}`); }
}

/** Every notice record on this install. */
export function noticeRecords() {
  let names = [];
  try { names = readdirSync(deliveriesDir()).filter((n) => n.endsWith(".json") && n !== "route-since.json"); } catch { return []; }
  return names.map((n) => readJsonSafe(join(deliveriesDir(), n))).filter(Boolean);
}

/** The wait before a failed notice is sent again: one minute, doubling, at most fifteen. */
const retryWaitMs = (failures) => Math.min(60_000 * 2 ** Math.max(0, failures - 1), 15 * 60_000);

// One pass at a time on this install, whichever process holds the route: the watch loop's timer, a one-shot drain.
// The lock holds the pid that took it; a lock whose process is gone is taken over.
function takeLock() {
  mkdirSync(deliveriesDir(), { recursive: true });
  const lock = join(deliveriesDir(), ".lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => { try { rmSync(lock, { force: true }); } catch { /* already gone */ } };
    } catch {
      let pid = 0;
      try { pid = Number(readFileSync(lock, "utf8").trim()); } catch { /* removed meanwhile */ }
      let alive = false;
      try { if (pid > 0 && pid !== process.pid) { process.kill(pid, 0); alive = true; } } catch { /* not running */ }
      if (alive) return null;
      try { rmSync(lock, { force: true }); } catch { /* raced */ }
    }
  }
  return null;
}

/**
 * One pass: record every owed notice the route serves, and send those that are due. Never throws.
 *
 * `afterAccepted(record)` runs between the receiver's 2xx and the record being written: the seam a test uses to stop
 * the process exactly there. `post` is the send (notice-route.mjs postNotice).
 */
export async function deliverNotices({ env = process.env, now = () => Date.now(), post = postNotice, afterAccepted = null, queueDirs = config.queueDirs } = {}) {
  const route = noticeRoute(env);
  if (!route.configured || !route.ok) return { route, sent: 0, confirmed: 0, skipped: "no-route" };
  const release = takeLock();
  if (!release) return { route, sent: 0, confirmed: 0, skipped: "another-pass" };
  let sent = 0, confirmed = 0;
  try {
    // An audience the route does not serve has no time, so its notices stay with the courier, untouched.
    for (const n of owedNotices({ queueDirs, since: servedSince(route.audiences, now()) })) {
      const path = recordPath(n.id);
      let rec = readJsonSafe(path);
      if (!rec) {
        rec = { id: n.id, kind: n.kind, audience: n.audience, recipient: n.recipient, eventAt: n.at, state: "pending",
          ...(n.settle ? { settle: n.settle } : {}), ...(n.occurrence ? { occurrence: n.occurrence } : {}),
          attempts: [], createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
        writeAtomic(path, rec);
      }
      if (rec.state === "confirmed") { settleIfOwed(rec); continue; }
      // A process that stopped mid-send left the record attempted: the receiver may hold the notice.
      if (rec.state === "attempted") {
        rec = { ...rec, state: "ambiguous", updatedAt: new Date(now()).toISOString(),
          attempts: rec.attempts.map((a, i) => (i === rec.attempts.length - 1 && !a.outcome ? { ...a, outcome: "ambiguous", detail: "stopped before the answer was recorded" } : a)) };
        writeAtomic(path, rec);
      }
      if (rec.state === "ambiguous" && !route.dedupe) continue;   // the operator settles it with the receiver
      if (rec.state === "failed" && now() < (atMs(rec.nextAttemptAt) ?? 0)) continue;
      if (rec.state === "ambiguous" && now() < (atMs(rec.nextAttemptAt) ?? 0)) continue;
      // Sending: recorded first, so a stop between here and the answer is seen as one.
      rec = { ...rec, state: "attempted", updatedAt: new Date(now()).toISOString(), attempts: [...rec.attempts, { at: new Date(now()).toISOString(), outcome: null }] };
      writeAtomic(path, rec);
      sent++;
      const answer = await post(route.url, { deliveryId: n.id, kind: n.kind, audience: n.audience, recipient: n.recipient, at: n.at, ...n.body }, { deliveryId: n.id });
      if (answer.outcome === "confirmed") afterAccepted?.(rec);
      const failures = rec.attempts.filter((a) => a.outcome && a.outcome !== "confirmed").length + (answer.outcome === "confirmed" ? 0 : 1);
      const last = { ...rec.attempts.at(-1), outcome: answer.outcome, ...(answer.status ? { status: answer.status } : {}), ...(answer.detail ? { detail: answer.detail } : {}) };
      rec = { ...rec, state: answer.outcome, updatedAt: new Date(now()).toISOString(), attempts: [...rec.attempts.slice(0, -1), last],
        ...(answer.outcome === "confirmed" ? { nextAttemptAt: null } : { nextAttemptAt: new Date(now() + retryWaitMs(failures)).toISOString() }) };
      writeAtomic(path, rec);
      if (answer.outcome === "confirmed") {
        confirmed++;
        if (answer.sent) { rec = { ...rec, downstream: { ...answer.sent, at: new Date(now()).toISOString() } }; writeAtomic(path, rec); }
        settleIfOwed(rec);
      }
      else note(`[notices] ${n.kind} for the ${n.audience} not delivered (${answer.outcome}: ${answer.detail ?? answer.status ?? "?"}); recorded as ${rec.state}`);
    }
  } catch (e) {
    note(`[notices] pass FAILED (isolated; the records stand and the next pass resumes): ${e?.message ?? e}`);
  } finally { release(); }
  return { route, sent, confirmed };
}

/**
 * The receiver's downstream send receipt for the person who placed a stopped run settles that run's owed send, once
 * (design, 2026-11-26). A bare 2xx does not: it says the receiver accepted the notice, not that the person was told,
 * and the delivery id is a correlation id minted before the send, not evidence of it.
 *
 * The settle is bound to what the record held when the notice was first seen, never to what this pass reads of the
 * run: the failure (its packet's id) and the person. Nothing is settled when the run now owes another send (it
 * stopped again, or recovered and owes its report), when the failure has no id to compare, or when the failure
 * changes between this check and the settle being written (settleSend's `expect`).
 */
function settleIfOwed(rec) {
  const settle = rec?.settle;
  const messageId = rec?.downstream?.messageId;
  if (rec?.audience !== "submitter" || !settle?.runDir || !messageId) return;
  const who = settle.runId ?? "?";
  if (!settle.failureId || settle.recipient !== submitterKey(rec.recipient ?? {})) {
    note(`[notices] ${who}: the receiver's receipt names no failure it can be bound to; the run stays owed`);
    return;
  }
  if (sendSettled(settle.runDir)) return;
  const owed = owedPacket(settle.runDir);
  if (owed?.settled !== "failure" || readJsonSafe(owed.path)?.failureId !== settle.failureId) {
    note(`[notices] ${who}: the receiver's receipt is for an earlier failure; the run now owes another send, which it leaves owed`);
    return;
  }
  try {
    const status = readJsonSafe(join(settle.runDir, "status.json")) ?? {};
    const done = settleSend({ run: { runId: settle.runId ?? status.runId, runDir: settle.runDir, slug: status.slug ?? null, codename: status.codename ?? null },
      evidence: { messageId }, via: "notice-route", expect: { settled: "failure", failureId: settle.failureId } });
    if (done?.refused) note(`[notices] ${who}: the failure changed as the receipt was recorded; the run stays owed`);
  } catch (e) { note(`[notices] settle of ${who} FAILED (the notice stands confirmed; the run stays owed): ${e?.message ?? e}`); }
}

/**
 * What has taken a stopped run's notice over, read from the run as it is now: "later-failure" (the run stopped again, its
 * packet carries another failure's id) or "report" (it recovered, and its report is the send it owes). null when nothing
 * has, and when the notice or the run names no failure to compare by: a legacy unknown is never taken for superseded.
 */
export function supersededBy(rec) {
  const occ = rec?.occurrence ?? (rec?.settle ? { runDir: rec.settle.runDir, failureId: rec.settle.failureId } : null);
  if (rec?.kind !== "run-stopped" || !occ?.runDir || !occ.failureId) return null;
  const owed = owedPacket(occ.runDir);
  if (owed?.settled === "delivery") return "report";
  if (owed?.settled !== "failure") return null;
  const now = stringOr(readJsonSafe(owed.path)?.failureId);
  return now && now !== occ.failureId ? "later-failure" : null;
}

/**
 * What the operator sees: every notice not yet confirmed, with its next action. Newest first. A notice a later event
 * superseded stays listed, with its own outcome, for the record: it is sent again by nothing and asks nothing of the
 * operator, so only the current event's notice can carry an action.
 */
export function undeliveredNotices({ env = process.env } = {}) {
  const dedupe = noticeRoute(env).dedupe === true;   // a receiver that drops repeats is sent an uncertain notice again
  const uncertain = (r) => (r.state === "ambiguous" || r.state === "attempted") && !dedupe;
  return noticeRecords().filter((r) => r.state !== "confirmed")
    .map((r) => {
      const superseded = supersededBy(r);
      return { id: r.id, kind: r.kind, audience: r.audience, state: r.state, attempts: r.attempts.length,
        lastDetail: r.attempts.at(-1)?.detail ?? null, nextAttemptAt: r.nextAttemptAt ?? null, updatedAt: r.updatedAt ?? null,
        superseded,
        // An uncertain delivery needs the operator; a failed one is sent again by itself; a superseded one, neither.
        retriesByItself: !superseded && !uncertain(r),
        nextAction: !superseded && uncertain(r) ? NEXT_ACTIONS["settle-with-receiver"] : null };
    })
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

/**
 * The operator's answer for one notice, by its delivery id, after checking the receiver (design, 2026-11-26). A
 * supported action, so nobody edits a record by hand:
 *   "received"  the receiver holds it: this notice alone is confirmed, the same fact its 2xx would have stated; it
 *               settles no run
 *   "absent"    the receiver does not hold it: this notice alone is sent again, under the same id, on the next pass;
 *               a notice a later event superseded is sent again by nothing, so the answer is refused, saying so
 * An answer that stays unknown is not given, and the notice keeps its state. Only a notice that was sent and is not
 * confirmed takes an answer. Returns { ok: true, id, state } or { ok: false, reason }, a code.
 */
export function reconcileNotice(id, answer, { now = Date.now() } = {}) {
  if (!/^[0-9a-f]{24}$/.test(String(id ?? ""))) return { ok: false, reason: "not-a-delivery-id" };
  if (answer !== "received" && answer !== "absent") return { ok: false, reason: "answer-is-received-or-absent" };
  const release = takeLock();
  if (!release) return { ok: false, reason: "a-pass-is-running" };
  try {
    const path = recordPath(id);
    const rec = readJsonSafe(path);
    if (!rec) return { ok: false, reason: "no-such-notice" };
    if (!["ambiguous", "attempted", "failed"].includes(rec.state)) return { ok: false, reason: `not-reconcilable:${rec.state}` };
    const superseded = supersededBy(rec);
    if (answer === "absent" && superseded) return { ok: false, reason: "superseded-no-retry", superseded, retries: false };
    const at = new Date(now).toISOString();
    const attempts = [...rec.attempts, { at, outcome: answer === "received" ? "confirmed" : "absent", by: "operator" }];
    if (answer === "received") {
      // The same fact as the receiver's own 2xx: it holds the notice. Nothing is settled by it.
      writeAtomic(path, { ...rec, state: "confirmed", updatedAt: at, nextAttemptAt: null, attempts });
      return { ok: true, id, state: "confirmed" };
    }
    writeAtomic(path, { ...rec, state: "failed", updatedAt: at, nextAttemptAt: at, attempts });
    return { ok: true, id, state: "failed" };
  } finally { release(); }
}

// THE OPERATOR'S COMMAND LINE. `list` prints every notice not confirmed; `received <id>` and `absent <id>` give the
// receiver's answer for one. Every answer is JSON, and a refusal exits 4 with its reason code.
if (isEntrypoint(import.meta.url)) {
  const [verb, id] = process.argv.slice(2);
  const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  if (verb === "list" && !id) out(undeliveredNotices());
  else if ((verb === "received" || verb === "absent") && id) {
    const r = reconcileNotice(id, verb);
    out(r);
    if (!r.ok) process.exitCode = 4;
  } else {
    process.stderr.write("usage: node driver/notice-delivery.mjs list | received <delivery id> | absent <delivery id>\n");
    process.exitCode = 2;
  }
}
