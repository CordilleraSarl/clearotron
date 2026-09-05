// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-activity.mjs — a tiny append-only ledger of NON-report runtime activity.
//
// NO WRITER, as of 2026-08-04. Its only one was out of repo — the retired quality harness
// dynamic-imported recordActivity from here — and a change in that other repo deleted it. The ledger stays empty
// and statusSnapshot's alive-checks bucket is permanently so; nothing reads a FINISHED row either, since the
// only page that showed one was the Quality hub retired.
//
// It stays for now because deleting it changes the SNAPSHOT SHAPE, which the run-status page and the portal
// both read, and that is a separate change from removing the feedback machinery. Whoever picks that up:
// there is no live consumer to break, only a schema key to retire deliberately.
// so the Run-status surface can show EVERY run-slot consumer, not just client reports. The reports themselves
// come from their status.json (statusSnapshot already enumerates those). This ledger is the one piece that
// was missing: a place for a non-report worker to say "I'm waiting
// for a slot / running / done ($X)". JSONL, tolerant reads, best-effort writes (logging never fails the run).

import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Append one record. `id` is a per-INVOCATION id (e.g. "nova-pulse@<startTs>") so a check's waiting→running→done
// transitions collapse to ONE row, while two separate checks of the same case stay distinct rows (history).
export function recordActivity(ledgerPath, rec = {}) {
  try {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
  } catch { /* best-effort — activity logging must never fail the run it describes */ }
}

// STALE-REAP: a check that dies mid-run — hard reboot, SIGKILL, OOM, or an in-process throw before the
// terminal record lands — otherwise leaves its LAST record at a NON-terminal state
// ("waiting"/"running") forever: the writer's done/failed line never lands, and a finally/catch cannot run
// across a hard kill. So the READER reaps it — a non-terminal record whose ts is older than `staleAfterMs`
// is surfaced as "failed" with `stale:true`, never as a live "running…". The threshold sits comfortably
// above the worst-case live run (the overnight sweep hard-killed at 90 min; a normal check ~15-20 min), so a
// genuinely in-flight check is never mis-reaped. Reader-side is the ONLY recovery that survives a reboot.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;                 // 2h — > the 90-min overnight sweep hard-timeout + margin
const NON_TERMINAL = new Set(["waiting", "running"]);

// Read the ledger → the LATEST record per invocation id (state transitions collapse to the final state),
// newest-first, capped, with stale non-terminal records reaped (above). Tolerant of a missing / torn file.
// `now` accepts an epoch-ms number or an ISO string (statusSnapshot passes its injected ISO `now`).
export function readActivity(ledgerPath, { limit = 50, now = Date.now(), staleAfterMs = STALE_AFTER_MS } = {}) {
  let lines = [];
  try { lines = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean); } catch { return []; }
  const byId = new Map();
  for (const ln of lines) { try { const r = JSON.parse(ln); if (r && r.id) byId.set(r.id, r); } catch { /* skip a torn line */ } }
  const nowMs = typeof now === "number" ? now : (Date.parse(now) || Date.now());
  const reap = (r) => {
    if (!NON_TERMINAL.has(r.state)) return r;
    const tsMs = Date.parse(r.ts || "");
    if (!Number.isFinite(tsMs) || nowMs - tsMs <= staleAfterMs) return r;     // fresh (or undatable) → leave as-is
    return { ...r, state: "failed", stale: true, note: r.note || "no terminal record — presumed interrupted (stale)" };
  };
  // Presentation retire (2026-07-06 owner steer — same reversible pattern as run rows /): the
  // ledger stays append-only — APPEND a record with the same id carrying `retired: true` to hide the
  // row from every activity surface; append another without it to resurface. Forensics untouched.
  return [...byId.values()].filter((r) => r.retired !== true).map(reap).sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || ""))).slice(0, limit);
}
