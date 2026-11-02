// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE POSITIONS A CORRECTION HANDS ITS SAVE: the excluded positions its review flags name, for which the writer's save
// may add a finding (synthesis-record.mjs, `correctionPositions`). The driver writes them into the tool servers' env
// for that correction's dispatch (gather-config.mjs), and the save tool's server reads them there, never from the
// payload (recording-server.mjs). Their own module, so a server reading them imports nothing else.

/** Where a correction's positions reach the save tool's server. */
export const CORRECTION_POSITIONS_ENV = "CLEAROTRON_CORRECTION_POSITIONS";

/** The positions a server was handed, or null where it was handed none it can read: no correction's dispatch. PURE. */
export function correctionPositionsFrom(env = process.env) {
  if (!env) return null;
  let v;
  try { v = JSON.parse(String(env.CLEAROTRON_CORRECTION_POSITIONS ?? "")); } catch { return null; }
  return Array.isArray(v) && v.length && v.every((u) => typeof u === "string") ? v : null;
}
