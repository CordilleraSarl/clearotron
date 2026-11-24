// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// product-fault.mjs — a call that failed because of the product, not because of the step's work.
//
// ONE ANSWER, WORDED ONCE (ruled 2026-11-24). Every place that establishes a product fault hands the step this message
// and nothing else of the fault: what failed, and why, stays in the run's own record. The step is not asked to repeat
// the call, the retry ladder does not ask it either, and the run delivers what the call could not produce as a gap it
// states. The record rule a recording step carries (engine/common.mjs, `recordRule`) tells it to stop on a refusal that
// says the failure is a product fault, so the message keeps those words.
//
// A FAULT IS ESTABLISHED FROM THE RUN'S OWN RECORD, never inferred from an absence. The register's call log
// (tool-calls.mjs) holds a start line for every register call and a settle line for every one that returned, so a call
// that started and never settled was sent and never came back. No log, or a call that returned, is not a fault.
import { existsSync } from "node:fs";
import { paths } from "./run-record.mjs";
import { registerPlanCallKilled } from "./tool-calls.mjs";

export const PRODUCT_FAULT_MESSAGE =
  "This failed because of a product fault, not your work. Don't repeat the call. Finish the rest of your task and hand back what you have.";

/** The register unit's axis a stage label names, or null for any other stage. PURE. */
const registerUnitAxis = (label) => /^register-unit:([a-z0-9-]+)$/.exec(String(label ?? ""))?.[1] ?? null;

/**
 * The product fault a failed attempt ended on, or null when its failure is the step's own to correct.
 *
 * A register unit whose plan call was sent and never returned has no band, and its note cannot be filed without one, so
 * the attempt ends as `tool_timeout` (the note was there), as a missing note, or as a turn that ended with the call
 * still out. Each is the call that never came back: the call log says so for that unit's axis, and the band is absent.
 * A rate limit is not one of these; it keeps its own wait-and-resume path. Returns `{ cause, axis, tool }`.
 */
export function productFaultOf({ fail, runDir = null, label = null } = {}) {
  const f = String(fail ?? "");
  if (!f || f === "rate_limited") return null;
  const timeout = /(?:^|:)tool_timeout:([a-z_]+):([a-z0-9-]+)/.exec(f);
  if (timeout) return { cause: "tool_timeout", tool: timeout[1], axis: timeout[2] };
  const axis = registerUnitAxis(label);
  if (axis && runDir && !existsSync(paths(runDir).registerBand(axis))) {
    const killed = registerPlanCallKilled(runDir, axis);
    if (killed) return { cause: "tool_timeout", tool: String(killed.tool ?? ""), axis };
  }
  return null;
}
