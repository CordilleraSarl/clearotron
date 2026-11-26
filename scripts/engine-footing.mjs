#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine-footing.mjs — does the installed Claude Code still start the way every run depends on? Free: no model call.
//
//   node scripts/engine-footing.mjs                          # the program as installed: its footing must hold
//   node scripts/engine-footing.mjs --simulate-minimal-mode  # the same with CLAUDE_CODE_SIMPLE=1: it must be refused
//   node scripts/engine-footing.mjs --json
//
// The run door proves the footing on the probe's real turn (driver/engine/probe.mjs, classifyFooting): the write guard
// runs, every built-in tool a stage is granted is offered, and the credential is the one the billing mode expects. Two
// of those three the program reports BEFORE it asks the vendor anything: its hook events and its list of tools. This
// runs one turn through the real adapter in a home folder of its own with no sign-in in it and no key, so the program
// reports its session, fails at sign-in, and costs nothing. The empty home is the whole guarantee: the adapter keeps
// no gateway address under subscription billing, so pointing one elsewhere would not stop a signed-in call. The
// nightly check runs it against the newest Claude Code release, so a release that changes how the program starts shows
// as a red check, not as a client's refused order.
//
// WHAT IT CANNOT SEE. The credential half needs a signed-in program, and so does the shape page fetching takes on a
// subscription sign-in (the `web-fetch` helper); the run door reads both on its own turn. The control run proves the
// check can fail: under the minimal mode it must answer "minimal-mode", or the check is blind and exits non-zero.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

/**
 * One credential-free footing turn: `{ verdict, report }`. `verdict` is classifyFooting's answer (null when the footing
 * holds), `report` what the program said about its session. `simulateMinimalMode` starts it with CLAUDE_CODE_SIMPLE=1.
 */
export async function footingTurn({ simulateMinimalMode = false, timeoutSec = 60 } = {}) {
  const home = mkdtempSync(join(tmpdir(), "clearotron-footing-home-"));
  const runDir = mkdtempSync(join(tmpdir(), "clearotron-footing-run-"));
  const keep = {};
  const set = (k, v) => { keep[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    // No sign-in and no key reach the program: a home with none in it, and every way to hand it one unset. It can only
    // report its session and fail at sign-in.
    set("HOME", home); set("USERPROFILE", home); set("CLAUDE_CONFIG_DIR", undefined);
    set("CLEAROTRON_AI", "anthropic-agent"); set("CLEAROTRON_AI_BILLING", "subscription");
    set("ANTHROPIC_API_KEY", undefined); set("CLAUDE_CODE_OAUTH_TOKEN", undefined); set("ANTHROPIC_AUTH_TOKEN", undefined);
    set("CLAUDE_CODE_SIMPLE", simulateMinimalMode ? "1" : undefined);
    const { anthropicAgentEngine } = await import("../driver/engine/anthropic-agent.mjs");
    const { classifyFooting, mintProbeSentinel } = await import("../driver/engine/probe.mjs");
    const { EVERY_STAGE_BUILTIN_TOOL } = await import("../driver/engine/mcp/gather-config.mjs");
    const word = mintProbeSentinel();
    const tuple = await anthropicAgentEngine.runTurn({ message: "Reply with the word ok.", model: "haiku", thinking: "low",
      timeoutSec, stallSec: Math.min(30, timeoutSec), runDir, output: { kind: "reply" },
      builtinTools: EVERY_STAGE_BUILTIN_TOOL, footing: { word } });
    const report = tuple.footing ?? null;
    // `completed: true`: this turn is judged on what the program reported, and a program that reported nothing fails it.
    const verdict = classifyFooting({ engine: "anthropic-agent", report, expect: { word, tools: EVERY_STAGE_BUILTIN_TOOL }, completed: true });
    return { verdict, report };
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const simulate = argv.includes("--simulate-minimal-mode");
  const { verdict, report } = await footingTurn({ simulateMinimalMode: simulate });
  const want = simulate ? "minimal-mode" : null;
  const got = verdict?.mode ?? null;
  const pass = got === want;
  if (argv.includes("--json")) process.stdout.write(JSON.stringify({ pass, simulate, want, got, verdict, report }, null, 2) + "\n");
  else {
    process.stdout.write(`Claude Code ${report?.version ?? "(no version reported)"}${simulate ? ", started in its minimal mode" : ""}\n`);
    process.stdout.write(`  tools offered: ${(report?.tools ?? []).join(", ") || "(none reported)"}\n`);
    process.stdout.write(`  hooks run: ${(report?.hooks ?? []).map((h) => `${h.hook} ${h.outcome}`).join(", ") || "(none)"}\n`);
    process.stdout.write(`  footing: ${got ?? "holds"} (${simulate ? "the control must be refused" : "it must hold"})\n`);
    if (verdict) process.stdout.write(`  ${verdict.headline}\n`);
  }
  if (!pass) process.stderr.write(simulate
    ? `engine-footing: the control was not refused as the minimal mode (got ${got ?? "holds"}), so this check cannot see the change it exists for\n`
    : `engine-footing: the footing does not hold: ${verdict?.headline ?? got}\n`);
  return pass ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
  process.stderr.write(`engine-footing: ${String(e?.stack ?? e)}\n`);
  process.exit(2);
});
