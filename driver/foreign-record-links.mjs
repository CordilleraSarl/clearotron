// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// foreign-record-links.mjs — a record link on a host the run's register does not publish: refused once, then
// blanked, and the run delivers.
//
// The findings gate refuses such a link (`finding_record_url_foreign_host`, findings-model.mjs). R2 on
// 0.4.1-beta.1 delivered no report over eleven of them: the seat copied each office's own page into a
// record link, every attempt was refused, and nothing could repair it. Two layers now act on it, and both
// record what they did under one event name and in one file, so a reader meets one fact however it arose:
//   · the synthesis transport, at the call (synthesis-record.mjs): the first offending call in a run is
//     refused, naming every finding, so the seat can fix them in the same turn; a repeat is accepted with
//     the foreign links blanked;
//   · the synthesis salvage lane (pipeline.mjs), for a findings file the transport did not write.
// Blanking is blankForeignRecordLinks (findings-model.mjs): a register link becomes "", the value that
// already means "this register publishes no page for the record".
import { writeFileSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";
import { blankForeignRecordLinks } from "./findings-model.mjs";
import { activeRecordOrigins } from "./record-origins.mjs";
import { runLog } from "./log.mjs";

export const FOREIGN_HOST_TOKEN = "finding_record_url_foreign_host";
export const BLANKED_FILE = "foreign-record-links.json";

/** The gate's list of record hosts: the caller's when it names one, else the run's register. */
export const recordOriginsOr = (given) => (given === undefined ? activeRecordOrigins() : given);

/**
 * The synthesis call, refused once and then blanked. PURE. `refusedBefore` is whether this run's transport
 * already refused a call for a foreign record link; until it has, the call is returned unchanged and the
 * gate refuses it.
 */
export function blankOnRepeat(call, origins, refusedBefore) {
  if (!refusedBefore || !Array.isArray(origins) || !call?.findings) return { call, blanked: [], kept: [] };
  const { doc, blanked, kept } = blankForeignRecordLinks(call.findings, origins);
  return { call: blanked.length ? { ...call, findings: doc } : call, blanked, kept };
}

/** What a blanking changed: the originals kept beside the run, and one run-log row. Never throws. */
export function recordBlanking(runDir, { stage, layer, blanked, kept, fail = null }) {
  try {
    writeFileSync(driverDir(runDir, BLANKED_FILE),
      JSON.stringify({ stage, layer, ...(fail ? { fail: String(fail).slice(0, 300) } : {}), blanked, kept }, null, 2) + "\n");
  } catch { /* the file is forensics; the run-log row below is the record */ }
  try {
    runLog(runDir, { event: "foreign-record-links-blanked", stage, layer, blanked: blanked.length, kept: kept.length,
      ordinals: [...new Set(blanked.map((b) => b.ordinal))] });
  } catch { /* a log that cannot be written must not stop the record it describes */ }
}
