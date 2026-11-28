// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// outbox-notices.mjs — WHAT AN OUTBOX PACKET MAY HOLD, BECAUSE THE FILE LEAVES THE ENGINE (design, 2026-11-27).
//
// docs/DELIVERY.md offers an integrator each `<name>.pending` file whole, so the file is user output as much as any door
// that reads it: it holds the notice a person reads and the routing it is sent by, and nothing else. The stage, the
// reason as the driver reported it, the repairs and the staff copy stay in the run's own record (`_driver/failure.json`),
// and a check's own words stay in the queue's `<base>.failed.reason` or `.result`. Every write goes through
// `userOutboxPacket` (outbox.mjs), and so does every read a door hands on (list_outbox_events), so a file an earlier
// version wrote is told in the same words as a new one.
//
// An earlier version wrote the staff copy into these files. `plainOlderOutboxPackets` rewrites such a file in this shape
// under its own name as the worker starts, before it delivers anything: the name is what settles it (mark_sent,
// ack_event), and the routing and the failure's id are kept, so an upgrade neither loses a notice nor sends one twice.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./driver.config.mjs";
import { note } from "./log.mjs";
import { atomicWrite, ensureDriverDir, paths } from "./run-record.mjs";
import { runDirFor } from "./outbox-backoff.mjs";
import { clientNotStartedText, duplicateNoticeText, userFailurePacket } from "./run-outcome.mjs";

/**
 * One outbox packet as it may leave the engine. PURE, and composing it twice gives it unchanged.
 *
 * A stopped run's packet is its notice and routing (userFailurePacket). The three notices filed before a run exists are
 * already written plain; one an earlier version wrote is recognised by the field only that version wrote, and composed
 * again from its routing: the not-started sentence, or the duplicate sentence with no word of the earlier order, since
 * whether this requester may see that order was not recorded with it. `whatsappToReason` leaves no packet: it names the
 * requester's address and the setting that holds chat numbers, which is the install's own setup.
 */
export function userOutboxPacket(p) {
  if (!p || typeof p !== "object") return p;
  if (p.kind === "run-failed") return userFailurePacket(p);
  const { whatsappToReason: _hint, ...rest } = p;
  const mark = p.markName || p.base || "the matter";
  if (p.kind === "intake-rejected" && Array.isArray(p.errors) && p.errors.length)
    return { ...rest, errors: [], text: clientNotStartedText(null, mark) };
  if (p.kind === "pre-run-failed" && "reason" in p) {
    const { reason: _r, ...plain } = rest;
    return { ...plain, text: clientNotStartedText(null, mark) };
  }
  if (p.kind === "duplicate-skipped" && ("matterSignature" in p || "matchedBy" in p)) {
    const { matterSignature: _s, matchedBy: _m, ...plain } = rest;
    return { ...plain, priorMsgId: null, priorJobId: null, priorRecordedAt: null, text: duplicateNoticeText(p.base) };
  }
  return rest;
}

/**
 * Rewrite every outbox packet an earlier version wrote, in place and under its own name. Returns the files rewritten.
 *
 * A stopped run's record is confirmed first: where its run folder holds no `_driver/failure.json`, the older packet is
 * written there before the outbox copy loses a word, since it is then the only full record. A run whose folder is gone
 * was removed with its record; its notice is still owed, and is rewritten all the same. A packet that cannot be read is
 * left as it is, for the door to shape on reading. Never throws: a sweep that fails must not stop the worker delivering.
 */
export function plainOlderOutboxPackets({ outboxDir = config.outboxDir, recordDirFor = runDirFor } = {}) {
  const rewritten = [];
  let names = [];
  try { names = readdirSync(outboxDir).filter((f) => f.endsWith(".pending")).sort(); } catch { return rewritten; }
  for (const file of names) {
    const path = join(outboxDir, file);
    let p;
    try {
      const raw = readFileSync(path, "utf8");
      if (!raw.trimStart().startsWith("{")) continue;   // a delivered marker: the agent's id and nothing else
      p = JSON.parse(raw);
    } catch { continue; }
    const plain = { ...(p.ts ? { ts: p.ts } : {}), ...userOutboxPacket(p) };
    if (JSON.stringify(plain) === JSON.stringify(p)) continue;
    try {
      if (p.kind === "run-failed" && p.runId) {
        const runDir = recordDirFor(p.runId);
        if (runDir && !existsSync(paths(runDir).failure)) {
          ensureDriverDir(runDir);
          atomicWrite(paths(runDir).failure, JSON.stringify(p, null, 2) + "\n");
        }
      }
      atomicWrite(path, JSON.stringify(plain, null, 2) + "\n");
      rewritten.push(file);
    } catch (e) {
      note(`outbox: an earlier version's packet ${file} could not be rewritten (${String(e?.message ?? e).slice(0, 120)}) — doors still hand it on as its notice`);
    }
  }
  if (rewritten.length) note(`outbox: ${rewritten.length} packet(s) an earlier version wrote now hold only their notice and routing: ${rewritten.join(", ")}`);
  return rewritten;
}
