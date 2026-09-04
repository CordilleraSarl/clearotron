// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// call-capture.mjs — the forensic record of what a seat SENT, one file per call, refusals included.
//
// 's sibling. Every recording transport captures the payload
// BEFORE its decision, so the evidence survives a refusal. Each of them wrote that capture to a path
// derived from something that does not change between calls — a literal `call-001.json`, an axis name, a
// finding's ordinal — so a second call to the same subject DESTROYED the first's evidence. Measured on
// on a preserved run in the 2026-08-27 round: two refusals in the refusal log, one payload on disk, and it was
// the accepted third call. The file whose header promises "including calls that were refused" held the
// one call that was not.
//
// THIS MODULE OWNS ALLOCATION, NEVER NAMING. Each transport keeps its own namespace and hands in a
// `nameFor(seq)`, because their schemes genuinely differ and a uniform one breaks the odd member:
// `report-card` already spells its captures `call-<ordinal>.json`, unpadded, so a padded sequence in the
// same directory would put call 2 of ordinal 1 on top of ordinal 2's first call. The caller knows its own
// namespace; this file does not need to.
//
// SEQUENCE 1 KEEPS THE EXISTING NAME. Consumers read `call-001.json` today — three test files read it and
// none writes it — so the first call must stay where it is and only the second onward gain a suffix.
//
// BEST-EFFORT, ALWAYS. A capture that throws would kill a run that was otherwise delivering, and a lost
// forensic record is worth far less than a delivered report. Every entry point here returns a failure
// rather than raising one.

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * The next unused sequence number for a namespace.
 *
 * Derived from what is ON DISK rather than from a counter held in memory: a resumed run, a re-dispatched
 * stage and a second process all have to agree, and only the directory knows about all three.
 */
export function nextSeq(existingNames, nameFor, { max = 999 } = {}) {
  const have = new Set((existingNames ?? []).map((n) => basename(String(n))));
  for (let seq = 1; seq <= max; seq++) if (!have.has(basename(nameFor(seq)))) return seq;
  return null;   // the namespace is full — the caller reports it, nothing throws
}

/**
 * Capture one call, before any decision is made about it.
 *
 * @param nameFor  (seq) => absolute path. seq 1 MUST be the transport's existing capture path.
 * @returns {{ path: string|null, seq: number|null, failed: string|null }}
 */
export function captureCall({ nameFor, params, extra = null, now = () => new Date().toISOString(), io = {} } = {}) {
  const list = io.list ?? ((d) => { try { return readdirSync(d); } catch { return []; } });
  const write = io.write ?? writeFileSync;
  const mkdir = io.mkdir ?? ((d) => mkdirSync(d, { recursive: true }));
  try {
    const first = nameFor(1);
    mkdir(dirname(first));
    const seq = nextSeq(list(dirname(first)), nameFor);
    if (seq == null) return { path: null, seq: null, failed: "the capture namespace is full (999 calls)" };
    const path = nameFor(seq);
    write(path, JSON.stringify({
      _provenance: "the typed call as RECEIVED by the tool, WHOLE — never the seat's own bytes, and never a selection: every key the recorder was handed is written, including ones this transport does not accept, because a payload pruned to what we liked is not evidence about what was sent",
      seq,
      receivedAt: now(),
      // NOT-YET-RECORDED IS SAID OUT LOUD. The verdict is a second write, after the decision; a process
      // that dies in between leaves this record, and a reader must not take a missing verdict for a clean
      // one. `recorded: false` surviving on disk means the decision never came back.
      verdict: { recorded: false, note: "written before the decision; if this is still false, the call never reached one" },
      // Caller fields, for transports that record something alongside the payload — report-card's bound
      // ordinal, for one. Spread BEFORE `params` so a caller cannot shadow the record's own shape.
      ...(extra ?? {}),
      params: params ?? null,
    }, null, 2) + "\n");
    return { path, seq, failed: null };
  } catch (e) { return { path: null, seq: null, failed: String(e?.message ?? e).slice(0, 200) }; }
}

/**
 * Stamp the verdict that followed a captured call. Best-effort: a failure here loses the link between a
 * shape and its outcome, which is worth strictly less than the run.
 */
export function stampVerdict(path, verdict, { io = {} } = {}) {
  if (!path) return false;
  const read = io.read ?? ((p) => readFileSync(p, "utf8"));
  const write = io.write ?? writeFileSync;
  try {
    const rec = JSON.parse(read(path));
    rec.verdict = { recorded: true, ...verdict };
    write(path, JSON.stringify(rec, null, 2) + "\n");
    return true;
  } catch { return false; }
}

/**
 * Merge fields into a captured record, at the TOP level —.
 *
 * For transports that already record their outcome as their own named fields rather than under
 * `verdict`. Keeping their spelling is deliberate: a consumer reads `refusedReason` today, and moving it
 * to make this file tidier would break a reader to fix a writer. Best-effort, like every write here.
 */
export function mergeCapture(path, fields, { io = {} } = {}) {
  if (!path) return false;
  const read = io.read ?? ((p) => readFileSync(p, "utf8"));
  const write = io.write ?? writeFileSync;
  try {
    const rec = JSON.parse(read(path));
    write(path, JSON.stringify({ ...rec, ...(fields ?? {}) }, null, 2) + "\n");
    return true;
  } catch { return false; }
}
