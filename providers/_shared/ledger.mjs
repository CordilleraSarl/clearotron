// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Shared register ledger — ONE implementation for every provider core ────────────────────────────
//
// Replaces the three byte-similar copies that lived in providers/{corsearch,clarivate,signa}/src/core.js.
// One register provider runs at a time, so all three append to the SAME per-call / per-record JSONL with
// an identical row schema; every consumer reads these paths unchanged:
//   driver/provider-usage.mjs, driver/registry-fidelity.mjs, driver/coverage-ledger.mjs,
//   driver/engine/mcp/gather-config.mjs (serverEnv).
//
// The names are now vendor-neutral — CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG over
// register-calls.jsonl / register-records.jsonl. The old CORSEARCH_* names still work for one
// release, and an existing corsearch-named file is still read where it sits, so no deployed box has to
// be migrated. Every rule about which name wins lives in ONE place — ./ledger-path.mjs — and the writer
// and all three readers call it, which is what removes the driver-reads-new / plugin-writes-old
// ordering footgun the rename was previously deferred over. gather-config's serverEnv closes the last
// gap by handing a spawned server the ALREADY-RESOLVED path, so a child never re-decides.
//
// Every row carries a `provider` discriminator so a ledger line says which vendor produced it.
//
// Paths are captured at MODULE LOAD, exactly as all three cores did — deliberately not lazy: a
// read-at-call-time lookup would be a behaviour change (the offline test fleet re-imports driver
// modules per test and relies on the frozen value).
//
// SECURITY — the ids below (agentId / sessionKey / sessionId) are the GATEWAY tool-call context
// (e.g. "localagent", "clearotron-acme-…"), the per-run attribution. They are NEVER the provider credential
// (Corsearch's `sessionKey` COOKIE merely shares the name; Clarivate's X-ApiKey; Signa's Bearer token).
// The ledger is only ever handed `tctx` + response metrics — keep it so.
//
// Telemetry is fully isolated in try/catch: a ledger failure must NEVER affect a search.

import { appendFileSync, mkdirSync, statSync, openSync, readSync, closeSync, readFileSync, writeFileSync, renameSync, rmdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { ledgerPath, RUN_RECORD_LOG_FILE } from "./ledger-path.mjs";

export const CALL_LOG_PATH = ledgerPath("call");
// Spec A1 (citation fidelity): every fetched record's BODY is persisted alongside the call ledger, so the
// driver can verify report registry identifiers FIELD-FOR-FIELD against the record actually fetched (and
// archive the records into the run dir). Same session attribution; same never-break-a-search posture.
//
// — THIS IS NOW THE FALLBACK, NOT THE ADDRESS. The record log is run-scoped (see ledger-path.mjs);
// its destination arrives per write. Two different processes need two different mechanisms and both are
// live:
//   · the SPAWNED register MCP server is forked once per run and gather-config hands it
//     CLEAROTRON_REGISTER_RECORD_LOG pointing at that run's `_driver/` — so the module-load capture below is
//     already the right per-run value in the child, and nothing about it needed to change.
//   · the DRIVER also fetches records (the registry-evidence closure, the screen-gate refetch, the
//     knockout listing) and is LONG-LIVED, with several runs' pipelines in flight at once
//     (runner.mjs drains queues concurrently). A process-global address — captured here or re-read from
//     process.env — would attribute one run's records to another, silently. So the driver passes the run's
//     path per call on `tctx.recordLog`, which is the only shape that is correct under concurrency.
// The const remains for a writer with no run dir at all (a bare CLI probe, a test): losing a body is
// worse than filing it globally, and `fetchedWithoutRecord` in registry-fidelity is what makes a run
// whose bodies went there report as a FAILURE rather than as a clean zero.
export const RECORD_LOG_PATH = ledgerPath("record");

// Build the telemetry context for a tool call from the SDK tool-factory `ctx` (per-call gateway context).
export const tctxOf = (ctx, kind) => ({
  kind,
  agentId:    ctx?.agentId    ?? null,
  sessionKey: ctx?.sessionKey ?? null,
  sessionId:  ctx?.sessionId  ?? null,
});

function append(path, line) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line + "\n");
  } catch { /* telemetry must never break a search */ }
}

/**
 * Bind the ledger to one provider id. Returns { logCall, logRecordBody, tctxOf } — the exact trio each
 * core used to define inline.
 *   logCall(tctx, metrics)         metrics = { http_status, ok, attempts, took_ms, bytes, cache_hit }
 *   logRecordBody(tctx, target, body)
 */
export function makeLedger(provider) {
  const logCall = (tctx, metrics) => {
    try {
      append(CALL_LOG_PATH, JSON.stringify({
        ts: new Date().toISOString(),
        provider,
        agentId:    tctx?.agentId    ?? null,
        sessionKey: tctx?.sessionKey ?? null,  // GATEWAY session key, NOT the provider credential
        sessionId:  tctx?.sessionId  ?? null,
        tool:       tctx?.kind       ?? null,
        target:     tctx?.target     ?? null,
        ...metrics,
      }));
    } catch { /* telemetry must never break a search */ }
  };
  const logRecordBody = (tctx, target, body) => {
    try {
      // The run's own log when the caller knows which run this is; the global fallback otherwise.
      // `tctx.recordLog` is a PATH the driver resolved from the run dir — never a credential, never
      // written into the row.
      const dest = typeof tctx?.recordLog === "string" && tctx.recordLog.trim()
        ? tctx.recordLog.trim() : RECORD_LOG_PATH;
      const row = {
        ts: new Date().toISOString(),
        provider,
        agentId:    tctx?.agentId    ?? null,
        sessionKey: tctx?.sessionKey ?? null,
        sessionId:  tctx?.sessionId  ?? null,
        target,
        body,
      };
      if (basename(dest) === RUN_RECORD_LOG_FILE) writeRecordOnce(dest, row);
      else append(dest, JSON.stringify(row));
    } catch { /* record persistence must never break a search */ }
  };
  return { logCall, logRecordBody, tctxOf };
}

// ── EACH REGISTER RECORD ONCE PER RUN ─────────────────────────────────────────────────────────────────
//
// A record that several queries return — an OR-list, a compound, the mark itself — was appended once per
// query. Measured on a delivered four-letter run: 2,898 lines for 2,098 distinct records, 800 of them a
// record already in the file, 21.6 MB of a 106 MB ledger, and the band server reads the whole file on a
// cache miss. 786 of the 800 were byte-identical bodies.
//
// So a body for a record already written is not appended. A body that DIFFERS from the one written (a
// status moved between two queries) replaces it ONCE, in place, and the replacement says so: `refreshed:
// true` and the timestamp of the body it replaced. Once only, so a field that varies between answers
// cannot rewrite the file on every query. Every field stays, the vendor's raw copy included.
//
// SEVERAL PROCESSES WRITE ONE RUN'S LEDGER — the register servers of parallel stages and the driver's own
// fetches — so "already written" is read off the FILE, never off this process's memory alone: each write
// indexes whatever was appended since this process last looked. Writes take a lock directory beside the
// file, so an in-place replacement (written to a temporary file and renamed over, which readers see
// atomically) cannot drop a line another process was appending. A lock that cannot be had in time falls
// back to a plain append: a duplicate line is the old behaviour, a lost record is not acceptable.
//
// Run-scoped ledgers only. The box-wide fallback file holds many runs, and a record one run fetched is not
// a record another run holds.
const RUN_INDEXES = new Map();   // dest → { offset, byTarget: Map<key, { hash, refreshed, ts, start, len }>, byGuid: Map<guid, key> }
const targetKey = (t) => String(t ?? "").toLowerCase();   // the key every reader of this file matches on
const bodyHash = (b) => createHash("sha1").update(JSON.stringify(b ?? null)).digest("hex");
// The record's own id: the last segment of `/mark/<office>/<id>`. The office segment is a hint that can
// differ between two answers for the same record, so a lookup by record keys on this and never on it.
const guidOf = (t) => { const k = targetKey(t); const i = k.lastIndexOf("/"); return i >= 0 ? k.slice(i + 1) : k; };

// `start` and `len` are the line's byte range, so one record can be read back without reading the file.
function indexRow(ix, line, start = null, len = null) {
  if (!line.trim()) return;
  try {
    const r = JSON.parse(line);
    const key = targetKey(r?.target);
    ix.byTarget.set(key, { hash: bodyHash(r?.body), refreshed: r?.refreshed === true, ts: r?.ts ?? null, start, len });
    if (key) ix.byGuid.set(guidOf(key), key);
  } catch { /* a torn or foreign line indexes nothing, and is left where it is */ }
}

/** Index every whole line appended since this process last looked; a file that shrank is re-read. */
function indexOf(dest) {
  let size = 0, ino = null;
  try { const st = statSync(dest); size = st.size; ino = st.ino; } catch { size = 0; }
  let ix = RUN_INDEXES.get(dest);
  // A replacement elsewhere renames a NEW file over this one: same path, different inode, and an offset
  // into the old file means nothing in the new one. Re-read from the start.
  if (!ix || size < ix.offset || ix.ino !== ino) { ix = { offset: 0, ino, byTarget: new Map(), byGuid: new Map() }; RUN_INDEXES.set(dest, ix); }
  if (size <= ix.offset) return ix;
  const fd = openSync(dest, "r");
  try {
    const CHUNK = 8 * 1024 * 1024;
    let carry = Buffer.alloc(0);
    let pos = ix.offset;
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const base = pos - data.length;   // the file offset of data[0]
      const last = data.lastIndexOf(0x0a);
      if (last < 0) { carry = data; continue; }
      for (let at = 0; at <= last;) {
        const nl = data.indexOf(0x0a, at);
        indexRow(ix, data.subarray(at, nl).toString("utf8"), base + at, nl - at);
        at = nl + 1;
      }
      carry = data.subarray(last + 1);   // a line still being written waits for the next look
      ix.offset = pos - carry.length;
    }
  } finally { closeSync(fd); }
  return ix;
}

/**
 * The record bodies this run already holds, for the given record ids: Map<id, body>, lowercased ids.
 *
 * Read off the run's own record log, which every process that fetches a record for the run writes to,
 * so a record the driver fetched is held for a tool server and the other way round. A run-scoped log only:
 * the box-wide fallback file holds many runs, and one run's record is not another's. Anything that cannot
 * be read reads as not held, which costs a fetch and never an answer.
 */
export function heldRecordBodies(dest, ids) {
  const out = new Map();
  if (typeof dest !== "string" || basename(dest) !== RUN_RECORD_LOG_FILE) return out;
  let ix;
  try { ix = indexOf(dest); } catch { return out; }
  const wanted = [...new Set((ids ?? []).map((g) => String(g ?? "").toLowerCase()).filter(Boolean))]
    .map((g) => [g, ix.byTarget.get(ix.byGuid.get(g) ?? "")]).filter(([, e]) => e && Number.isInteger(e.start) && Number.isInteger(e.len));
  if (!wanted.length) return out;
  let fd;
  try {
    fd = openSync(dest, "r");
    for (const [g, e] of wanted) {
      try {
        const buf = Buffer.alloc(e.len);
        if (readSync(fd, buf, 0, e.len, e.start) !== e.len) continue;
        const row = JSON.parse(buf.toString("utf8"));
        if (row?.body && typeof row.body === "object") out.set(g, row.body);
      } catch { /* a line that moved under us is simply not held */ }
    }
  } catch { /* unreadable: nothing held */ } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ } }
  return out;
}

const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no sleep available */ } };

/** Run `fn` holding the ledger's lock; false (and `fn` not run) when the lock could not be had in time. */
function withLedgerLock(dest, fn) {
  const lock = `${dest}.lock`;
  const deadline = Date.now() + 3000;
  for (;;) {
    try { mkdirSync(dirname(dest), { recursive: true }); mkdirSync(lock); break; }
    catch {
      // A holder that died leaves the directory behind; nothing holds this lock for more than a rewrite.
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) { rmdirSync(lock); continue; } } catch { continue; }
      if (Date.now() > deadline) return false;
      sleepMs(10);
    }
  }
  try { fn(); } finally { try { rmdirSync(lock); } catch { /* already gone */ } }
  return true;
}

function writeRecordOnce(dest, row) {
  const done = withLedgerLock(dest, () => {
    const ix = indexOf(dest);
    const key = targetKey(row.target);
    const hash = bodyHash(row.body);
    const prev = ix.byTarget.get(key);
    if (prev && (prev.hash === hash || prev.refreshed)) return;          // written already; replaced at most once
    if (!prev) {
      append(dest, JSON.stringify(row));
      indexOf(dest);
      return;
    }
    // A CHANGED BODY REPLACES THE ONE WRITTEN, in place, recorded as such. Written whole to a temporary
    // file and renamed over, so a reader sees the old file or the new one and never half of either.
    const next = { ...row, refreshed: true, refreshed_from: prev.ts ?? null };
    const kept = readFileSync(dest, "utf8").split("\n").filter((line) => {
      if (!line.trim()) return false;
      try { return targetKey(JSON.parse(line)?.target) !== key; } catch { return true; }
    });
    kept.push(JSON.stringify(next));
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, kept.join("\n") + "\n");
    renameSync(tmp, dest);
    RUN_INDEXES.delete(dest);
    indexOf(dest);
  });
  if (!done) append(dest, JSON.stringify(row));
}
