// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Structured JSONL logging into <run-dir>/_driver/, plus human-facing progress on stderr.
// (Plain node process — Date/timestamps are fine here; the Date.now restriction is Workflow-sandbox-only.)

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

function appendLine(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
}

// Content fingerprint of a stage I/O file — {name, sha (first 12 of sha256), size}. Powers the input→output
// linkage telemetry (what a stage handed downstream) and the `compare` verb's "did the inputs change?" row.
// Best-effort: a missing/unreadable file yields sha:null,size:0 rather than throwing.
export function fileMeta(absPath) {
  if (!absPath) return null;
  try {
    const b = readFileSync(absPath);
    return { name: basename(absPath), sha: createHash("sha256").update(b).digest("hex").slice(0, 12), size: b.length };
  } catch {
    return { name: basename(absPath), sha: null, size: 0 };
  }
}

// The OUTPUT record for a stage / attempt row — {name, sha, size, present}, three-valued at the top level:
//   null            → the stage declares NO output file (nothing was ever expected)
//   {present:false} → an output WAS expected and is not on disk (or is unreadable): sha and size are null
//   {present:true}  → it landed; sha + size describe the bytes actually there
//
// Why this is not fileMeta. fileMeta is deliberately forgiving — a missing path yields {sha:null,size:0} —
// which is right for an INPUT fingerprint (absent-then-present is a legitimate change the freshness stamp
// must see) and WRONG for an output: AD-4 made `output` unconditional so a failed attempt's mid-write
// artifact stops being invisible, and with fileMeta behind it a stage that emitted NOTHING journalled a
// plausible-looking zero-size record instead. That is the house rule inverted — absence rendered as a
// record — on the very surface the babysit protocol polls. `present` makes the absence unmistakable and
// `size:null` refuses to claim a byte count nobody measured (a real 0-byte file is present:true, size:0).
export function outputMeta(absPath) {
  if (!absPath) return null;
  try {
    const b = readFileSync(absPath);
    return { name: basename(absPath), sha: createHash("sha256").update(b).digest("hex").slice(0, 12), size: b.length, present: true };
  } catch {
    return { name: basename(absPath), sha: null, size: null, present: false };
  }
}

// One line per stage transition + the verdict + delivery result.
export function runLog(runDir, obj) {
  appendLine(driverDir(runDir, "run.jsonl"), obj);
}

// Per-stage attempt detail (argv-redacted, status, file-validation result).
export function stageLog(runDir, stage, obj) {
  appendLine(driverDir(runDir, `${stage}.jsonl`), obj);
}

// Human progress — stderr only, so stdout stays clean for any JSON the driver itself emits.
export function note(...parts) {
  process.stderr.write(parts.join(" ") + "\n");
}
