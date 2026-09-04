#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine-probe.mjs —: run the engine turn probe on demand, and print what it decided.
//
//   npm run engine-probe                      # the engine CLEAROTRON_AI names
//   npm run engine-probe -- --engine openai-agent
//   npm run engine-probe -- --json
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
//
// `probeEngineTurn` is the smallest thing that genuinely exercises an engine: one Haiku-tier turn at low
// effort on a six-word prompt, through the adapter's own spawn path, with no MCP config, no tools, no
// skills dir and no run dir. It answers the one question an operator asks before spending anything —
// CAN this box run a turn, and under the billing mode it thinks it is using.
//
// It had no way to be asked. Its only callers were `bin/onboard.mjs` (the setup wizard, which asks it
// once, inside a flow) and `preflightEngineTurn` in `pipeline.mjs` (which asks it at the start of a run,
// when the question is already being answered the expensive way). needed it standalone to check
// API billing without paying for a clearance, and that is a permanent want, not that issue's want.
//
// ── WHAT IT COSTS, SAID PLAINLY BECAUSE THIS SPENDS MONEY ───────────────────────────────────────────
//
// ONE cheap-tier turn, on whatever credential the box is configured with. That is not free, and it is
// not a mock: the whole point is that it uses the real adapter and the real auth door. Nothing else runs
// — no stage, no provider call, no run dir written.
//
// ── WHAT A GREEN PROBE DOES NOT PROVE, from the module's own header ─────────────────────────────────
//
// The cheap tier only. Both tiers ride one credential, so AUTH is proven for all of them — a per-tier
// model entitlement or per-tier quota is not. And it sets up no tools, no gather MCP, no skills and no
// run dir, so none of that path is touched. A probe that says `ok` says the door opens.

// FIRST IMPORT, AND IT HAS TO BE. This entry statically reaches driver.config.mjs, which captures
// env at module top — and every static import evaluates before this file's own body runs, so applying the
// aliases in the body would be too late for the capture it is meant to fix.
import "../shared/env-local.mjs";
import { probeEngineTurn, probeFailureText, PROBE_MODEL, PROBE_TIMEOUT_SEC } from "../driver/engine/probe.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };

/**
 * The verdict as an exit code. THREE outcomes, not two: a probe that could not be run at all is not the
 * same as one that ran and said no, and a caller that collapses them cannot tell "this box is
 * misconfigured" from "this script broke".
 */
export const exitCodeFor = (verdict) => (verdict?.ok === true ? 0 : 1);

export function render(verdict, { json = false } = {}) {
  if (json) return JSON.stringify(verdict, null, 2);
  const lines = [`${verdict.ok ? "ok" : verdict.mode} — ${verdict.headline}`, `  basis: ${verdict.basis}`];
  // THE FIX TEXT IS RELAYED VERBATIM, for the same reason classifyProbe relays a thrower's message
  // verbatim: the module that owns the decision wrote it, and a second wording here would drift.
  if (verdict.fix) lines.push("", probeFailureText(verdict));
  return lines.join("\n");
}

if (isEntrypoint(import.meta.url)) {
  const engine = flag("--engine");
  const env = engine ? { ...process.env, CLEAROTRON_AI: engine } : process.env;
  const asJson = argv.includes("--json");
  if (!asJson) {
    console.error(`engine-probe: one ${PROBE_MODEL}-tier turn, up to ${PROBE_TIMEOUT_SEC}s, on this box's own `
      + `credential — real, and it costs whatever one cheap turn costs.`);
  }
  const verdict = await probeEngineTurn({ env });
  console.log(render(verdict, { json: asJson }));
  process.exit(exitCodeFor(verdict));
}
