// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/anthropic-agent.mjs — the `anthropic-agent` engine: runs one stage turn as a standalone
// `claude -p` process (OFF any agent gateway), with streaming stall-detection (the #1 speed prize
// that the blocking subprocess path structurally cannot do — see stages.mjs narrative-refutation note).
//
// Contract: engine/CONTRACT.md. runTurn() returns the registry-standard normalized tuple
// (`{code, killed, wall, stdout, stderr, laneWaitMs, json, usage, reads, readsTruncated, modelWire,
// providerWire, sessionRef, signals}`), with a SYNTHESIZED `json` envelope in the classifier's shape so every downstream
// classifier in gateway.mjs (payloadText, json.status check, isEmbeddedFallback, isTimeout,
// isLaneWedge) works unchanged.
//
// Pinned from a 2026-06-16 capture of `claude -p`: subscription auth is headless (apiKeySource:"none");
// result event carries usage{input_tokens,output_tokens,cache_read_input_tokens,
// cache_creation_input_tokens}, total_cost_usd, session_id, stop_reason; stream_event partials are the
// watchdog heartbeat (--include-partial-messages).

import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeTurnInstructions, FILE_OUTPUT, absolutizeSkillRefs, resolveSpawnCwd, spawnGraceMs, isRecordTool, stallMs, engineMaxBufferChars, startGovernedChild, governWatchdog, readGovernedStreams } from "./common.mjs";   // the child, its watchdog, its reader, and the stall and buffer limits both engines share
import { resolveEngineProgram, resolveModel } from "../driver.config.mjs";
import { sessionSpeed } from "./speed.mjs";   // — whether this session's model can take the speed its run asks for   // — the one place that finds the program; it reads every spelling of the setting
import { authorityTrees } from "../authority-trees.mjs";
import { clearEngineChild } from "./child-record.mjs";   // the shared child (startGovernedChild) writes the record; this clears it at settle
import { engineEnv } from "./engine-env.mjs";   // — the program's environment, by list (see spawnEnv)
import { engineSpawn, spawnsDetached } from "./engine-spawn.mjs";   // one answer to how a turn starts and ends, on every platform
import { newSessionRecord, noteClaudeEvent, sessionSummary, countTool, streamSink, claudeEnding } from "./session-record.mjs";   // what the session went through, beside how it ended

// Read per-call (not module-level) so tests can drive a short stall timeout / a mock binary.
// ONE place knows how to find the program (driver.config.mjs resolveEngineProgram): the explicit setting,
// then PATH, then the copy Clearotron installed. What it found is spawned by ABSOLUTE path, because a
// bare word lets spawn(2) walk PATH on its own and never reach the installed copy. When nothing resolved,
// what was asked for is spawned unchanged, so that failure reads exactly as it always has; the run door
// (preflightEngineBinary) refuses that case before any stage runs.
const claudeBin = () => { const r = resolveEngineProgram("anthropic-agent"); return r.resolved ?? r.bin; };

// AUTH TOGGLE (config, not code). The subscription path is the cost-saving default: claude -p with NO
// ANTHROPIC_API_KEY in its env falls back to the OAuth subscription credentials (apiKeySource:"none" →
// INCLUDED in the subscription, not API-billed). But the gateway keeps ANTHROPIC_API_KEY in the shared
// .env, and a present API key OVERRIDES the subscription — so we must STRIP it from the claude subprocess
// env. CLEAROTRON_AI_BILLING=api-key keeps the key (the standing fallback for when the subscription is
// revoked — Anthropic's advance notice = today's per-call API cost). Default = subscription.
//
// `cloud` strips it too, as that mode's acceptance asks: a key has no part in a turn the vendor's switches
// send to the reader's cloud account, and dropping it means a leftover key can never be what bills. A
// gateway's credential is its own ANTHROPIC_AUTH_TOKEN, which rides through in the vendor's namespace. The
// word is parsed by auth.mjs (billingMode), the one place that reads it. This never validates and never
// throws, because the doors that do (the top of runStage, the probe, the jx runner) have already run.
//
// THE REST OF THE ENVIRONMENT IS A LIST, NOT A COPY. The program and every tool server it starts get what
// engine-env.mjs names and nothing else, so the key that signs access tokens and the portal's secrets
// never reach a stage. The billing rule above is applied there, with the rest of the list.
export function spawnEnv(base = process.env) {
  return engineEnv(base, { engine: "anthropic-agent" });
}

/**
 * How much of a turn's elapsed time was the model actually WORKING — elapsed minus tool wait, including
 * a call still in flight. PURE, and exported so the ceiling's rule can be asserted without burning the
 * 60s floor `hardMs` clamps to.
 *
 * The two quantities TILE the elapsed time and there is no third bucket, which is what makes this
 * subtraction total rather than an estimate: every millisecond is either wait or work.
 */
export function activeElapsedMs({ wall, toolWaitMs = 0, toolAskedAt = null, now = Date.now() }) {
  const inFlight = toolAskedAt != null ? Math.max(0, now - toolAskedAt) : 0;
  return Math.max(0, wall - toolWaitMs - inFlight);
}
// NO-PROGRESS ceiling (charter P1 §1, 2026-07-30). The byte-stall above resets on ANY streamed byte, so a
// turn that keeps the pipe warm without doing anything (ping/system chatter, an endless junk stream, a
// wedged loop that never moves a token or touches its output file) burns silently to the hard wall — the
// shape it catches: a synthesis SIGKILLed at the 1500s wall whose retry did the identical work in 369s. This
// second clock resets ONLY on honest progress — token movement (usage-bearing events, content deltas),
// a completed agent-loop step (assistant/user events), or an artifact write observed on the stage's own
// expected output files (progressFiles) — and kills WELL BELOW the wall when none of it advances.
// CLEAROTRON_NO_PROGRESS_MS pins it absolutely (tests); else it is max(the stage's stall clock, a 300s floor)
// so it can never fire before the byte-stall and never clips a legitimately quiet-but-working stretch
// shorter than 5 minutes. A no-progress kill is RECORDED as a stall (signals.stalled + signals.noProgress),
// never as "the stage needed more time" — the retry policy must not extend the budget for it.
// TRICKLE FLOOR — a turn that streams a token every twelve seconds is not a slow turn, and no clock
// above can see it. The byte-stall resets on any streamed byte; the no-progress ceiling resets on token
// movement, deliberately, because a healthy streaming turn must never be clipped for being slow. So a
// trickle held both off and was stopped only by the last-resort wall, at budget + 60s, with the whole
// attempt discarded and re-run from the start.
//
// MEASURED, on one round of one scenario, and that is stated because it is not yet a distribution: two
// stages killed at the wall streamed 0.08 and 0.12 output tokens per second of ACTIVE time; their own
// retries, same matter and same engine, ran at 74 and 82.83. Three orders of magnitude apart, which is
// why a floor needs no fine calibration to separate them — and exactly why the floor below sits far
// under the slowest healthy sample rather than near the gap. The number that finally ships wants the
// same window read across the other preserved rounds; until then this is a floor against a pathology,
// not a budget for a stage.
//
// ON ACTIVE TIME, never elapsed, for the reason the hard ceiling states at length: a turn waiting on a
// slow tool is not producing tokens and must not be killed for it. Zero disables the instrument.
const minTokensPerSec = () => {
  const v = Number(process.env.CLEAROTRON_MIN_TOKENS_PER_SEC);
  return Number.isFinite(v) && v >= 0 ? v : 1;
};
// THE WARM-UP IS NOT A COURTESY, it is what makes the measurement meaningful: a rate over three seconds
// of active time is noise, and a turn that thinks before it writes would fail a floor applied at once.
// Five minutes of ACTIVE time is well past the point where a working turn has produced something, and
// far short of the 46 and 41 minutes the killed attempts burned.
const rateWarmupMs = () => {
  const v = Number(process.env.CLEAROTRON_MIN_TOKENS_WARMUP_MS);
  return Number.isFinite(v) && v > 0 ? v : 300000;
};
const noProgressMs = (stallClockMs) => {
  const pinned = Number(process.env.CLEAROTRON_NO_PROGRESS_MS);
  if (pinned > 0) return pinned;
  const floor = Number(process.env.CLEAROTRON_NO_PROGRESS_FLOOR_MS) > 0 ? Number(process.env.CLEAROTRON_NO_PROGRESS_FLOOR_MS) : 300000;
  return Math.max(stallClockMs, floor);
};

// tier/alias → claude -p model alias. EVERY TIER GOES AS THE VENDOR'S OWN ALIAS — opus, sonnet, haiku,
// fable — so the CLI serves the newest model of that family, and a new one arrives with no edit here.
// opus and sonnet were pinned to claude-opus-5 / claude-sonnet-5 from 2026-07-27, when the bare "opus"
// still resolved to Opus 4.8 on the live CLI (2.1.209). The pin was reversed on 2026-09-14, for two
// reasons. A hand-pinned id is a silent downgrade on every clearance from the day a better model ships.
// And on Bedrock, Vertex and Foundry the CLI resolves an alias through the vendor's own
// ANTHROPIC_DEFAULT_OPUS_MODEL / _SONNET_MODEL / _HAIKU_MODEL / _FABLE_MODEL, which an exact id bypasses:
// a cloud with no deployment of that exact name refuses the turn. The cost is that a model can move under a
// clearance without a test; the witness is the id the CLI reports, recorded on every attempt row
// (`modelActual`) and on the published run. To hold a tier still, set the vendor's variable in the env file
// (ANTHROPIC_DEFAULT_OPUS_MODEL=<id>): the stage's environment carries the vendor's `ANTHROPIC_*` names
// (engine-env.mjs), so it reaches the CLI with no setting of Clearotron's own. ANTHROPIC_DEFAULT_FABLE_MODEL holds fable, which no stage asks for
// unless an override names it, as CLEAROTRON_SYNTHESIS_MODEL=fable does. A catalog id a caller names
// (anthropic/claude-opus-5) still goes as that exact id. The non-anthropic tiers (gemini skeptic, deepseek refutation, azure) have no claude equivalent →
// substituted with an anthropic model (also GRADE-MOVING, A/B-only); their bare-alias substitutes
// (e.g. deepseek → "opus") are legacy aliases no stage names today, intentionally left un-pinned. They
// stay registered so a stage that names one is SUBSTITUTED loudly rather than caught by the regex
// fallback below and run as sonnet in silence.
// fable (2026-07-10): registered so CLEAROTRON_SYNTHESIS_MODEL=fable (stages.mjs synthesis override) resolves
// correctly. Without an entry here, claudeModel()'s regex fallback below would silently treat unrecognized
// strings as sonnet instead of erroring — quietly invalidating an A/B test rather than failing loud.
// corruption 3 — THE SUBSTITUTIONS ARE GONE. This table used to carry `gemini: "sonnet"`,
// `gemini-flash: "sonnet"`, `deepseek-v4-pro: "opus"` and `azure: "sonnet"`, and the fall-through below
// mapped ANY unrecognised alias to "sonnet". So `--model gemini` ran sonnet while the telemetry logged
// `google/gemini-3.1-pro-preview` (gateway stamps `resolveModel(<requested alias>)`), and every
// attribution downstream of that row — the A/B arm, the token rollup, the billing classes — was
// keyed to a model that never ran. Nothing said so, because a substitution has no error to report.
//
// The four cross-provider aliases were already dead before this change: the model-failover chain was
// deleted, and the two stages that named them were made honest in the defs (skeptic declares
// `sonnet`, narrative-refutation declares `opus` — stages.mjs). They existed only to substitute.
//
// An alias with no claude equivalent now FAILS LOUD, exactly as `openaiModel` has always done for a
// non-GPT id. That is the issue's requirement in one line: an unhonoured model override is an error,
// not a substitution.
// THE CATALOG IDS ARE NOT LISTED HERE ANY MORE, and removing them is what makes one rule cover every
// id. Four sat here and two of them disagreed with the other two: `anthropic/claude-opus-5` and
// `anthropic/claude-sonnet-5` went over as those models, while `anthropic/claude-sonnet-4-6` and
// `anthropic/claude-haiku-4-5` went over as their tier's alias. A caller naming an exact model got it
// or lost it depending on which of the four they happened to name, and nothing said which.
//
// The rule below now answers all four the same way, and no run changes: a stage names its TIER, and the
// tier words above are still the whole of what a run passes. These ids reach this function only when a
// caller names one — an override or an experiment arm — and there, being given the model you named is
// the behaviour the rest of this function already promises.
const CLAUDE_MODEL = { opus: "opus", sonnet: "sonnet", haiku: "haiku", fable: "fable" };
export function claudeModel(model) {
  if (!model) return undefined;
  if (CLAUDE_MODEL[model]) return CLAUDE_MODEL[model];
  // A bare or dated anthropic id ("claude-haiku-4-5-20251001") still resolves to its family alias —
  // that is a NAMING form of a model claude can actually run, not a substitution of a different one.
  // The family must be named IN the id: a `claude-*` id whose family this build does not recognise
  // throws too, rather than riding the old else-arm into sonnet.
  // FABLE IS READ HERE TOO, and its absence was a live defect rather than a gap in readiness: the bare
  // `fable` alias is in the table above, so `CLEAROTRON_SYNTHESIS_MODEL=fable` worked and hid it, while
  // the pinned id every vendor page names — `claude-fable-5-1` — threw on its way to a program that runs
  // it. Measured 2026-09-22: the program accepts that id and reports serving `claude-fable-5-1`.
  const fam = /opus/i.test(model) ? "opus" : /haiku/i.test(model) ? "haiku" : /sonnet/i.test(model) ? "sonnet"
    : /fable/i.test(model) ? "fable" : null;
  if (fam && /^(?:anthropic\/)?claude-/i.test(model)) {
    const bare = String(model).replace(/^anthropic\//i, "").toLowerCase();
    // A CONCRETE ID GOES TO THE PROGRAM AS ITSELF, AND THAT IS WHAT MAKES A PIN A PIN. It used to come
    // back as the bare family alias, so a caller who named an exact model got whichever model the tier
    // pointed at — the same model on the day it was written, a different one the day a newer one
    // shipped, and nothing to read in between. A silent un-pinning is the substitution this function
    // exists to refuse, in the one form it still allowed.
    //
    // A FAMILY WITH NO VERSION IS THE TIER, not a model: `claude-opus` is what an operator types for a
    // deployment of that tier, and the program has no model by that name. It keeps following the family.
    //
    // Measured against the program rather than assumed (2026-09-22): it accepts `claude-sonnet-5`,
    // `claude-haiku-4-5-20251001` and `claude-fable-5-1` and reports serving each of them, so passing an
    // exact id through costs nothing that the alias was buying. Where a caller names an id the program
    // does not know, it says so and the turn fails loudly — which is the honest end of a bad pin.
    return /^claude-(?:[a-z]+-\d|\d)/.test(bare) ? bare : fam;
  }
  throw new Error(`anthropic-agent: no claude model mapped for "${model}" — this engine runs claude only. Pass opus/sonnet/haiku/fable or a concrete claude-* id. (It used to substitute sonnet silently and log the alias you asked for.)`);
}

// ── thinking tier → `claude --effort` ────────────────────────────────────────────────────────────────
// CANONICAL TABLE. `engine/openai-agent.mjs` carries the byte-equal twin for the tiers both vocabularies
// can express, and `engine.anthropic.test.mjs` pins the two together — the same duplicate-plus-drift-test
// discipline the output rules once used here (this module deliberately imports nothing but node
// built-ins, so a shared leaf import is not on the table).
//
// LIVE VOCABULARY (claude 2.1.193 `--help`, checked 2026-08-03): `--effort` takes
// low | medium | high | xhigh | max. The old comment on this line said "low/medium/high/max" and was
// stale — `xhigh` exists and this table has never used it.
//
// corruption 4a — `off` MEANS ONE THING NOW. It mapped to `low` here and to `minimal` on codex,
// which put the two engines a whole rung apart at the bottom of the ladder: on codex `off` and `low`
// were different levels, here they were the same one, so a cross-engine effort comparison at `off` was
// off by one and nothing said so. `low` is anthropic's floor — there is no rung beneath it — so the
// only way `off` can mean one thing on both engines is for codex to come UP to `low`. It does
// (openai-agent.mjs), and codex's `minimal` is now unreachable from the driver's vocabulary. That is
// the honest trade: a rung we cannot reach costs less than a tier that means two things.
//
// `max` is the one tier the two tables still differ on, and deliberately: it means "this engine's top
// rung", which is `max` here and `xhigh` on codex (codex has no `max`). The drift test asserts exactly
// that one exception rather than letting the tables drift generally. No stage uses `max` today.
const EFFORT = { off: "low", low: "low", medium: "medium", adaptive: "medium", high: "high", max: "max" };
export function effortFor(thinking) { return EFFORT[thinking] ?? "medium"; }
/** The tiers whose mapping MUST be identical on every engine (see the note above; `max` is the exception). */
export const CROSS_ENGINE_EFFORT_TIERS = ["off", "low", "medium", "adaptive", "high"];
export const EFFORT_TABLE = { ...EFFORT };

export function mapUsage(u) {
  if (!u) return null;
  const input = u.input_tokens || 0, output = u.output_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

// The output rules and the skill-reference rewrite are shared with the Codex adapter: engine/common.mjs.
export { claudeTurnInstructions, absolutizeSkillRefs };

// Returns { args, input }: `args` is the flag list with `-p` as a BARE flag (no positional prompt), and
// `input` is the absolutized prompt to write to the child's STDIN. The prompt is NOT an argv element:
// Linux caps one argv string at MAX_ARG_STRLEN (128 KB), and a big stage prompt (the register-unit
// primary-sweep inlines the whole plan slice — 150 KB+ on a 4-class mark) blew past it → `spawn E2BIG`,
// a 2 ms pre-exec kill that failed identically on every retry (ROADTRIPPIN' VIBES, 2026-07-07). A pipe
// carries MBs, so stdin removes the ceiling for every stage. `claude -p` reads the prompt from stdin when
// no positional is given (live CLI 2.1.179: "non-interactive mode via -p, or when stdin is piped").
// ── — DOES THIS TURN NEED THE RUN DIRECTORY AT ALL? ───────────────────────────────────────────
//
// `--add-dir runDir` was pushed unconditionally, so every seat held Read over the whole run — findings.json,
// every other rendered card, the narrative, the placement file, the register band. report-card's dispatch
// says "you have NO other finding's data", and that sentence described an intention with nothing holding
// it: the data was one Read away. is the precedent quoted five lines below the grant — a live
// clearance wrote into the doctrine tree "doing exactly what it was permitted to do, under prose stating
// the opposite" — and the fix there was a mechanism at the moment of the action.
//
// MEASURED FIRST, and it is a permission gap with no observed exercise: 358 report-card attempts across
// the delivered corpus, 0 reads of another card, of findings.json, or of any named run artifact, against a
// control of 364 attempts naming their OWN card. So this is PREVENTION, priced as prevention.
//
// THE TEST IS THE DISPATCH, AND THE DECLARATION MUST AGREE. Two facts are available here:
//
//   MEASUREMENT   does the message actually name a path under runDir? Computable at this site with
//                 nothing threaded, and it fails SAFE — the moment a prompt gains a path, the grant
//                 comes back on its own, with nobody having to remember a declaration.
//   DECLARATION   `seatWrites: false` on the stage's recording row. It says the DRIVER writes the
//                 artifact, so the seat needs no write root.
//
// The grant drops only when BOTH agree there is nothing to reach: no path named AND the seat authors
// nothing. Either one alone keeps it. An UNKNOWN declaration (a stage with no recording row, `null`
// here) keeps it too — this can only ever remove a grant from a stage positively established as needing
// none, which is eight of them (`SEAT_WRITE_FREE_STAGES`).
//
// A DISAGREEMENT IS A LOUD ROW, NOT A SILENT PICK. If the two facts differ, one of them is stale — a
// prompt that gained a path the declaration did not expect, or a stage declared to author a file whose
// dispatch never names where. That is exactly the drift and are both about, and it is worth
// more as a signal than as a decision: the grant is kept, and the disagreement is said out loud.
//
// ANTHROPIC-ONLY, AND MEASURED RATHER THAN ASSUMED. The obvious next step is to apply the same rule to
// openai-agent's `--add-dir` (buildCodexArgs pushes the identical root), and it would accomplish nothing:
// that engine spawns with `cwd = resolveSpawnCwd({cwd, runDir})` — the RUN DIR (deliberately) —
// under its sandbox, which makes cwd a writable root on its own. Dropping the flag there
// would remove a grant the seat still holds by another door and let this comment claim an isolation the
// engine does not have. Codex-side isolation is a cwd question, and a separate decision.
/**
 * Does the dispatch ORDER the seat to write at a run-dir path — as opposed to merely handing one over
 * to READ?: the disagreement note below used to fire on ANY mention, and measured across
 * the recording stages that was SEVEN standing false alarms per run — every one a path handed as data
 * ("the tiers are in <path>", "see <path> for context"), which `seatWrites:false` (= the DRIVER
 * authors the output) is perfectly consistent with. A warning that fires seven times on every healthy
 * run is the warning nobody reads, and the one real drift it exists for drowns. So the note keys on a
 * WRITE ORDER: a sentence that both names the path and carries an imperative write verb, with the
 * negated form excluded ("do NOT save <path> yourself" is the driver claiming the write, which AGREES
 * with the declaration). Prose-shaped on purpose and priced as a heuristic: it steers a WARNING, never
 * the grant — the grant still keys on the bare mention, which is the fail-safe direction — and the
 * arms drive it against every real write-free stage's rendered dispatch, so a drift in dictation style
 * that blinds it reds a test rather than fading out. PURE.
 */
export function dispatchOrdersRunDirWrite(dispatch, runDir) {
  const dir = String(runDir ?? "");
  const text = String(dispatch ?? "");
  if (!dir || !text.includes(dir)) return false;
  const frags = text.split(/(?<=[.;])\s+|\n+/);
  const verb = /\b(write|save|emit|append|store|create|author)\b/i;
  const negated = /\b(?:do\s+not|don't|never)\b(?:\s+\S+){0,3}?\s*\b(?:write|save|emit|append|store|create|author)\b/i;
  return frags.some((f) => f.includes(dir) && verb.test(f) && !negated.test(f));
}

export function runDirGrant({ runDir, dispatch, seatWrites = null } = {}) {
  const dir = String(runDir ?? "");
  if (!dir) return { grant: false, names: false, note: null };
  const names = String(dispatch ?? "").includes(dir);
  const grant = names || seatWrites !== false;
  let note = null;
  if (names && seatWrites === false && dispatchOrdersRunDirWrite(dispatch, dir)) {
    // — resolved in the direction the behaviour needs: a write-free stage HANDS paths
    // over to read all the time (that is what the grant is for), so only an ORDER TO WRITE is a
    // disagreement worth a row. The grant itself is untouched either way — dispatch wins, fail-safe.
    note = `[run-dir-grant] a stage declared seatWrites:false is ORDERED to write at a path under ${dir} in its dispatch. `
      + "The run-dir root is kept — the dispatch wins — but the declaration says the driver authors the "
      + "output, so the declaration and the prompt disagree, and one of them is out of date.";
  } else if (!names && seatWrites === true) {
    note = `[run-dir-grant] a stage declared to author a file names NO path under ${dir} in its dispatch. `
      + "The root is kept, but nothing tells the seat where to write, so either the prompt lost its output "
      + "path or the declaration is wrong.";
  }
  return { grant, names, note };
}

/**
 * The program's tools that run a command, removed from every stage by name. From the vendor's tools
 * reference: `Bash` "Executes shell commands", `PowerShell` "Executes PowerShell commands natively" (the
 * shell it offers on Windows, and on other systems when switched on), and `Monitor` "Runs a command in the
 * background". Stages read and write their files through Read, Write and Edit and call their tool
 * servers. No stage is granted a shell in the grant table (gather-config.mjs); what this removes is the
 * shell the program offered them anyway.
 */
export const COMMAND_TOOLS = Object.freeze(["Bash", "PowerShell", "Monitor"]);
/**
 * The program's own web search, removed from every stage by the same name-removal. The engine's web search
 * is its own: the common-law sweep, which keeps a record of every result. The program's was never granted,
 * and every attempt a stage made at it was refused, a turn spent for nothing (observed in testing,
 * 2026-10-02 and 2026-10-03: 48 attempts in five runs, all refused). Removed, the model is never offered it.
 * The codex engine turns its own off the same way (`web_search`, codex-config.mjs).
 */
export const OWN_SEARCH_TOOLS = Object.freeze(["WebSearch"]);
/** The program's tools that write a file. A result that comes back an error is a write that failed. */
const FILE_WRITE_TOOLS = Object.freeze(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function buildClaudeArgs({ message, model, thinking, speed = "standard", footing = null, resumeRef, mcpConfig, allowedTools, builtinTools = null, output = FILE_OUTPUT, maxBudgetUsd, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, seatWrites = null, grantDispatch = null }) {
  const input = absolutizeSkillRefs(message, skillsDir, resolveSkill);
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  const m = claudeModel(model); if (m) args.push("--model", m);
  args.push("--effort", effortFor(thinking));
  // THE SPEED is a setting, not a flag: `fastMode` in the one `--settings` value below (stageSettings), the vendor's
  // unattended form (https://code.claude.com/docs/en/fast-mode, "Toggle fast mode": `claude -p --settings
  // '{"fastMode": true}'`, v2.1.205 or later). Every session of an Urgent run asks for it where the model sent above has
  // a faster setting (engine/speed.mjs, sessionSpeed); on any other model it is not asked for, so the model stays the
  // one the stage chose, and the turn's record says why it ran at standard speed.
  const sp = sessionSpeed({ ordered: speed, engine: "anthropic-agent", model: m });
  // Stages WRITE their output file; acceptEdits auto-approves Write/Edit in non-interactive -p (Read is
  // always allowed). Gather tools (E3) ride --allowedTools so they never prompt either.
  args.push("--permission-mode", "acceptEdits");
  // THE TURN'S OUTPUT RULE, by how it returns its result (common.mjs): its record tool, a file, or its reply, then the
  // evidence rule. On every call, the resumed one included: a resumed turn returns its result the same way.
  args.push("--append-system-prompt", claudeTurnInstructions(output));
  if (resumeRef) args.push("--resume", resumeRef);          // warm-resume → reuses the prompt cache
  if (mcpConfig) { args.push("--mcp-config", mcpConfig, "--strict-mcp-config"); }
  if (allowedTools) args.push("--allowedTools", allowedTools);
  // A STAGE THAT NAMES ITS BUILT-IN TOOLS is started with those alone (`--tools`, the vendor's
  // CLI help: "Specify the list of available tools from the built-in set"). The tool servers' tools are unaffected.
  if (Array.isArray(builtinTools) && builtinTools.length) args.push("--tools", builtinTools.join(","));
  // NO TOOL THAT RUNS A COMMAND, ON ANY STAGE, WHATEVER THE MACHINE'S OWN SETTINGS SAY. `--allowedTools`
  // lists tools that run without asking; it removes nothing, and the program runs a command it classes as
  // read-only (`cat`, `ls`) without asking at all. Measured on 2.1.280 with this argv: the model ran `echo`
  // through Bash on a login with no rule allowing it. A bare name here "removes the matching tools from
  // Claude's context" (the vendor's CLI reference, `--disallowedTools`), on every call, the resumed one
  // included, so the model is never offered them. See COMMAND_TOOLS for the three names.
  args.push("--disallowedTools", [...COMMAND_TOOLS, ...OWN_SEARCH_TOOLS].join(" "));
  const cap = maxBudgetUsd ?? (process.env.CLEAROTRON_MAX_BUDGET_USD ? Number(process.env.CLEAROTRON_MAX_BUDGET_USD) : null);
  if (cap != null && Number.isFinite(cap)) args.push("--max-budget-usd", String(cap));
  // FILE ACCESS: claude's Read/Write/Edit tools are confined to cwd + --add-dir roots even under
  // acceptEdits (cwd is a neutral tmpdir here; reads only since READ_FENCE, below), so the compute-skills tree (skillsDir — the
  // driver-co-located skills/) and THIS run's dir are added here — every stage output and prior-stage artifact
  // is absolute under runDir. Two NARROW roots (least-privilege; the skills tree is a leaf, NOT an agent
  // workspace — no SOUL.md/MEMORY.md/memory/*). Neither root has a CLAUDE.md/AGENTS.md at its head AND we do
  // not set CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD, so --add-dir grants access only — no memory
  // auto-load. Added on EVERY call (incl. the --resume warm-retry branch: a resumed turn re-needs file
  // access). EVERY skills root (overlay + base), since a prompt may now reference files from both.
  //
  // BOTH ROOTS ARE GRANTED WRITABLE. `--add-dir` HAS NO READ-ONLY FORM, and acceptEdits above auto-approves
  // Write/Edit. Until 2026-08-14 this comment said "grant READ of the compute-skills tree" and the parameter
  // was called `skillsReadRoots` — and is what that costs: a live clearance wrote two files into the
  // doctrine tree, doing exactly what it was permitted to do, under prose stating the opposite. The intent
  // was real and is unchanged; what was missing was any mechanism holding it. The write boundary is now
  // enforced at the moment of the write, by the PreToolUse deny-hook in ./deny-authority-write.mjs, whose
  // policy is derived HERE from the same two variables as the grant — one site, so the boundary cannot
  // drift from what was granted.
  const grantRoots = (skillsGrantRoots?.length ? skillsGrantRoots : [skillsDir].filter(Boolean));
  for (const r of grantRoots) args.push("--add-dir", r);
  // — ONE COMPUTED VALUE FEEDS BOTH THE GRANT AND THE BOUNDARY. The comment above says the
  // deny-hook's policy is "derived HERE from the same two variables as the grant — one site, so the
  // boundary cannot drift from what was granted", and that property is what makes dropping the root
  // safe: a boundary still describing a root that was never handed out would be the sibling defect,
  // created by the fix for this one. `granted` is that single value.
  // A RESUMED TURN KEEPS THE GRANT ITS STAGE WAS DISPATCHED WITH. The warm patch names its files through
  // rel(), so judged on its own text a stage that writes nothing itself would lose the run folder on the
  // retry. That cost nothing while reads were unconfined; under READ_FENCE it would take away the folder
  // the stage has been reading. The gateway passes the stage's own dispatch as `grantDispatch`.
  const rd = runDirGrant({ runDir, dispatch: grantDispatch ?? input, seatWrites });
  const granted = rd.grant ? runDir : null;
  if (granted) args.push("--add-dir", granted);
  const boundary = writeBoundarySettings({ skillsRoots: grantRoots, profilesDir, runDir: granted, footingWord: footing?.word ?? null });
  args.push("--settings", stageSettings(boundary, { fast: sp.sent === "fast" }));
  // THE FOOTING CHECK reads the program's hook events, which it reports only when asked (`--include-hook-events`, the
  // vendor's CLI help: "Include all hook lifecycle events in the output stream"). Only the check's own turn asks.
  if (footing?.word) args.push("--include-hook-events");
  return { args, input, grantNote: rd.note, speed: sp };
}

/**
 * THE FILE TOOLS READ ONLY THE STAGE'S OWN FOLDERS. Without this, Read, Grep and Glob open any path the
 * account can open, the install's settings file and the key that signs access keys included, and a page
 * a stage fetched can ask for exactly that. The vendor's setting makes those tools refuse any path outside
 * the session's working directories "in every permission mode" (settings reference,
 * `permissions.blockReadsOutsideWorkingDirectories`, Claude Code 2.1.257 or later; the floor is 2.1.280).
 * The working directories are the neutral cwd and the `--add-dir` roots above: the instruction trees and,
 * when granted, the run folder. A folder the account's own Claude settings add
 * (`permissions.additionalDirectories`) is a working directory too, and stays readable: measured, the
 * refusal on a login with three such folders listed all three. Every turn carries it, the probe's included.
 */
export const READ_FENCE = Object.freeze({ blockReadsOutsideWorkingDirectories: true });

/**
 * The one `--settings` value a turn carries: the read fence, the write boundary's hook when there is one, and the faster
 * speed when the turn asks for it. One value, because the program reads one `--settings`: a second would replace the
 * first, and the boundary with it.
 */
export function stageSettings(boundary, { fast = false } = {}) {
  return JSON.stringify({ permissions: { ...READ_FENCE }, ...(boundary ? JSON.parse(boundary) : {}), ...(fast ? { fastMode: true } : {}) });
}

/**
 * The `--settings` JSON that installs the write boundary, or null when there is nothing to protect.
 *
 * The policy travels in the hook's OWN argv (base64). That is deliberate: hook and policy are ONE object, so
 * "installed but unconfigured" — the silent half-state that would leave a boundary reporting nothing —
 * cannot occur.
 *
 * NO SHELL, ON ANY PLATFORM. The hook is written in exec form, `command` plus `args`, which the CLI
 * spawns directly with each element as one argument (the vendor's hooks reference; the form arrived in
 * 2.1.139, below this engine's floor). It used to be one command string quoted for a POSIX shell. On
 * Windows without Git Bash the CLI runs a hook string in PowerShell instead, where POSIX quoting does not
 * parse, and a hook that fails to start lets the write through (below). Exec form needs `command` to be a
 * real program, which `process.execPath` is: the Node running the driver, never a bare `node` whose PATH
 * under a service manager need not carry it.
 *
 * NOTE for whoever next edits the flag list: `--bare` disables hooks. Adding it removes this boundary
 * silently, exactly as `--add-dir` silently granted write.
 */
export function writeBoundarySettings({ skillsRoots = [], profilesDir = null, runDir = null, hookPath = null, footingWord = null } = {}) {
  const trees = authorityTrees({ skillsRoots, profilesDir, runDir });
  if (!trees.length) return null;
  const hook = hookPath ?? join(dirname(fileURLToPath(import.meta.url)), "deny-authority-write.mjs");
  // A HOOK THAT CANNOT START FAILS OPEN, and that is the CLI's behaviour rather than a choice we get to
  // make: a hook command exiting nonzero for any reason other than a deny is a NON-BLOCKING error, so the
  // write proceeds. A half-deployed checkout would therefore run unprotected and say nothing, so this
  // refuses to build the dispatch at all.
  //
  // WHERE THE THROW LANDS IS NOT FULLY TRACED, and the comment says so rather than implying it is fine.
  // Measured: there is NO enclosing try around `engine.runTurn` in gateway.mjs, so this leaves the stage
  // dispatch as an exception rather than a stage-fail envelope. Whether the runner's drain loop catches it
  // or dies on it was not traced. The choice stands either way — the hook file is co-located in this repo
  // and ships with it, so "missing" means a broken deploy, and a broken deploy that stops loudly beats one
  // that runs every clearance with no boundary and says nothing.
  try { statSync(hook); }
  catch { throw new Error(`write_boundary_hook_missing:${hook} (the deny-hook is not in this deployment; a missing hook command fails OPEN in the CLI, so the dispatch is refused rather than run unprotected)`); }
  // THE FOOTING CHECK'S WORD, on the check's turn alone (engine/probe.mjs). The same program and the same policy are
  // installed on the session's start too, and answer there with the word, on stderr: proof from the program's own
  // output that the hooks this value carries run in this session. Every other turn carries neither.
  const footing = typeof footingWord === "string" && footingWord ? footingWord : null;
  const payload = Buffer.from(JSON.stringify({ trees, runDir: runDir ?? null, ...(footing ? { footing } : {}) }), "utf8").toString("base64");
  return JSON.stringify({
    hooks: {
      ...(footing ? { SessionStart: [{ hooks: [{ type: "command", command: process.execPath, args: [hook, payload] }] }] } : {}),
      PreToolUse: [{
        // Bash is in the matcher because seats had it and it walked past this hook entirely. The command
        // tools are now removed from every stage (COMMAND_TOOLS, above), and the arm stays for a program
        // that does not honour the removal. What it can and cannot do is stated at its declaration in
        // deny-authority-write.mjs; it is a detector, and naming it here does not make it a boundary.
        matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash",
        hooks: [{ type: "command", command: process.execPath, args: [hook, payload] }],
      }],
    },
  });
}

// Synthesize the envelope gateway.mjs expects (so all classifiers work unchanged).
export function synthesizeEnvelope({ resultEvent, usage, killed }) {
  const r = resultEvent;
  const text = typeof r?.result === "string" ? r.result : "";
  const ok = !killed && r && !r.is_error && r.subtype === "success";
  return {
    status: ok ? "ok" : (killed ? "timeout" : "error"),
    result: { meta: { agentMeta: { usage } }, payloads: [{ text }] },
    summary: r?.subtype, runId: r?.session_id, stopReason: r?.stop_reason,
    // …and beside the stop reason, what ended the session and, on an error, the program's own words for it
    // (session-record.mjs, claudeEnding). Recorded only: `ok` above reads exactly what it read before.
    ...claudeEnding(r),
  };
}

export const anthropicAgentEngine = {
  name: "anthropic-agent",
  // WHAT THIS ENGINE GUARANTEES ABOUT SEAT WRITES, said out loud in the run record.
  // `deny-authority-write.mjs` is a `claude -p` PreToolUse hook, so it refuses a seat's writes into the
  // doctrine tree, the profile store and `<runDir>/_driver/` at the moment of the write. That is a real
  // boundary and this engine has it.
  writeBoundary: "enforced",
  // The id a turn's rows record as asked for: the tier through Claude's catalog, `opus` → `anthropic/claude-opus`.
  resolveModelId(model) { return resolveModel(model); },
  async runTurn({ message, model, thinking, speed = "standard", footing = null, timeoutSec, resumeRef, mcpConfig, allowedTools, builtinTools = null, output = FILE_OUTPUT, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, seatWrites = null, grantDispatch = null, stallSec, progressFiles, streamFile = null } = {}) {
    if (!message) throw new Error("anthropic-agent.runTurn: message is required");
    const { args, input, grantNote, speed: sent } = buildClaudeArgs({ message, model, thinking, speed, footing, resumeRef, mcpConfig, allowedTools, builtinTools, output, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, seatWrites, grantDispatch });
    // the cross-check speaks. Driver stderr is what an operator reads, and it is where the other
    // drift notices in this engine already land ([ledger], [env-aliases], [queue-watch]).
    if (grantNote) process.stderr.write(`${grantNote}\n`);
    const t0 = Date.now();
    // Per-stage stall override: a heavy stage (synthesis/register-digest) can legitimately go quiet for
    // minutes of thinking, so it sets its own stallSec; light stages fall back to the global CLEAROTRON_STALL_MS
    // (default 120s) so a real wedge still trips fast. Clamp NaN/≤0 → global so a misconfig never disables it.
    const STALL = (Number(stallSec) > 0 ? Number(stallSec) * 1000 : stallMs());
    const NOPROG = noProgressMs(STALL);   // the honest-progress ceiling (see noProgressMs) — ≥ STALL by construction unless pinned for tests
    const MIN_RATE = minTokensPerSec();   // output tokens per second of ACTIVE time; 0 disables (see minTokensPerSec)
    const WARMUP = rateWarmupMs();        // active time before the floor may fire at all
    // legacy-engine parity (+60s past the stage timeout); clamp NaN/≤0 → 660s so the hard wall never
    // silently disables. `CLEAROTRON_HARD_MS` pins it for tests, exactly as CLEAROTRON_STALL_MS and
    // CLEAROTRON_NO_PROGRESS_MS pin the other two clocks — and it is why this ceiling had no end-to-end arm
    // until now: the floor here is 61 SECONDS at the shortest, so no arm could drive the site without
    // sitting for a minute, and the change to what the ceiling MEASURES was covered only by unit tests
    // of the pure function. Reverting the one line at the site left the whole suite green. A non-positive
    // or unparseable value falls through to the computed wall rather than disabling it.
    const pinnedHard = Number(process.env.CLEAROTRON_HARD_MS);
    const hardMs = pinnedHard > 0 ? pinnedHard : (Number(timeoutSec) > 0 ? Number(timeoutSec) + 60 : 660) * 1000;
    const pollMs = Math.max(50, Math.min(1000, Math.floor(Math.min(STALL, NOPROG) / 2)));  // tight enough for fast tests, ≤1s in prod
    return await new Promise((resolve) => {
      // The turn's state, which every phase below reads and writes (the phases follow the adapter).
      const st = { resolve, resumeRef, cwd, runDir, progressFiles, streamFile, args, input, t0, STALL, NOPROG, MIN_RATE, WARMUP, hardMs, pollMs, speed: sent.sent, standardBecause: sent.standardBecause };
      st.settle = (code) => settle(st, code);   // declared before any phase, as the hoisted function it was
      if (!spawnTurn(st)) return;
      streamState(st);
      toolState(st);
      lineParser(st);
      killAndWatch(st);
      wireStreams(st);
    });
  },
};

// ── runTurn's phases, in the order the turn runs them ──────────────────────────────────────────────────────

/** Starts the program with the prompt on stdin and records its pid. False when the spawn itself failed, and the turn is settled. */
function spawnTurn(st) {
  st.child = undefined;
  // Spawn from a cwd that is NOT the driver's repo dir: stages use absolute paths, so cwd is a
  // CLAUDE.md-discovery and trust surface. The driver runs under a checkout that HAS a CLAUDE.md, and
  // inheriting that would load the dev-assistant instructions into every stage (context pollution +
  // cost). It also avoids the EACCES when the inherited cwd is unreadable by the runner's user.
  //
  // cwd is a granted WRITE root here (file tools are confined to cwd + --add-dir), so it is
  // the run dir when there is one. See resolveSpawnCwd in common.mjs for why, and for what it deletes.
  st.spawnCwd = resolveSpawnCwd({ cwd: st.cwd, runDir: st.runDir });
  // stdin is a PIPE (not "ignore"): the prompt rides stdin, not a `-p` argv element, so it is never
  // subject to the 128 KB MAX_ARG_STRLEN ceiling (the E2BIG that killed the register-unit sweep).
  // detached:true (C2): claude spawns its MCP servers as CHILDREN (gather-config), and killing only
  // the direct pid orphaned them for days (a bridge.mjs --server legaldatahunter orphan, PPID 1, ran
  // 3.5 days — still holding its upstream transport, still able to bill and race *-band.json writes).
  // Detached makes claude its own process-group leader, so the watchdog's kills reach the whole tree.
  // Not on Windows, which has no process groups: there the turn stays attached, and ends as a tree
  // (engine-spawn.mjs says why, and how the program itself is started).
  st.run = engineSpawn(claudeBin(), st.args);
  // Started, fed its prompt on stdin then EOF, and recorded as the run's child by the piece both engines share
  // (common.mjs, startGovernedChild), which also gives the one tree kill. Before it asks, the kill records what the
  // watchdog had seen when it decided (killDecision reads it); recording only.
  const started = startGovernedChild({ command: st.run.command, args: st.run.args, cwd: st.spawnCwd, env: spawnEnv(), detached: spawnsDetached(),
    input: st.input, runDir: st.runDir,
    onKill: () => { st.atKill ??= { ms: Date.now() - st.t0, spoken: st.firstOutputAt !== null, toolCalls: st.toolCalls }; } });
  if (started.spawnError) return void st.resolve(errResult(st.t0, started.spawnError, st.resumeRef));
  st.child = started.child;
  st.killTree = started.killTree;
  return true;
}

/** What the stream has shown so far: the buffers and kill flags, the clocks, the usage per message, and the thinking, model and reads gauges. */
function streamState(st) {
  st.resultEvent = null; st.killed = false; st.stallKill = false; st.settled = false;
  st.noProgressKill = false;               // the no-progress ceiling fired (a stall discriminator, see noProgressMs)
  st.trickleKill = false;                  // the token-rate floor fired (a stall discriminator, see minTokensPerSec)
  st.overflow = false;                     // A3: stdout/stderr exceeded maxBuffer — force a nonzero fail, never parse the truncated tail
  st.maxBuffer = engineMaxBufferChars();
  st.lastMove = Date.now();
  st.lastProgress = Date.now();            // honest-progress clock: token movement / agent-loop steps / artifact writes ONLY
  st.firstOutputAt = null;                 // first byte of the PROTOCOL (stdout only); until then every clock below is timing STARTUP
  st.atKill = null;                        // what the watchdog had seen when it decided to kill — recording only, see killDecision
  st.silentIdleMs = null;                  // the no-progress clock at the watchdog's last look before the child spoke — recording only
  st.GRACE = spawnGraceMs();             // one source of the grace: common.mjs sets it
  st.sawAnyEvent = false;                  // ANY parseable stream event (incl. system:init) — false on close = the CLI died before streaming (startup-class failure)
  st.rateLimitEvent = null;   // a 429 session-cap rejection rides a `rate_limit_event` (status:"rejected" + resetsAt)
  // Streamed-usage accumulator: what the turn PROVABLY moved, observed from the stream itself, so a
  // killed turn is never journalled as usage:null when millions of tokens moved (the "137 + usage:null
  // ⇒ mislabelled transient/lane-wedge" class).
  //
  // KEYED BY MESSAGE, AND EACH FIELD IS THE LARGEST READING SEEN FOR THAT MESSAGE. One API call's usage
  // reaches the stream several times: on `message_start`, on every `assistant` event (one per content
  // block), and on its `message_delta`, whose output count is the call's own running total. Summing the
  // assistant events counted a call's input and cache once per block and its output at whatever it
  // was when the block went out, and dropping the delta lost the rest: a turn killed after 75 calls
  // journalled 810 output tokens. Which event carries the final count need not be known here, and the
  // order is inferred rather than recorded, so every reading is kept and the largest wins. A delta names
  // no message, so it belongs to the one its last `message_start` opened; an assistant event with no id
  // and no open message is a call of its own, as it always was.
  st.perMessage = new Map();
  st.openMessage = null; st.anonMessages = 0;
  // SPEED GAUGE: the speed each API call reports it was served at (`usage.speed`), by message, as the usage above is.
  // Read from the program's own output, never from what the turn asked for (engine/speed.mjs).
  st.speedByMessage = new Map();
  st.noteSpeed = (key, u) => { if (typeof u?.speed === "string" && u.speed) st.speedByMessage.set(key, u.speed); };
  st.fastInit = null;                     // init's fast_mode_state and fast_mode_disabled_reason: the session's start
  st.fastNotice = null;                   // the program's own notice about fast mode (out of usage credits), first one
  st.sessionInit = null;                  // the session's id as init states it: what a turn killed before its result resumes
  st.sessionReport = null;                // init's own account of the session: tools, helpers, key source, version
  st.hookResponses = [];                  // the hooks the program reports it ran, when the turn asked to be told
  st.foldUsage = (key, u) => {
    if (!u) return;
    const was = st.perMessage.get(key);
    st.perMessage.set(key, was
      ? { input: Math.max(was.input, u.input), output: Math.max(was.output, u.output),
          cacheRead: Math.max(was.cacheRead, u.cacheRead), cacheWrite: Math.max(was.cacheWrite, u.cacheWrite) }
      : { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite });
  };
  st.streamedUsage = () => {
    const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const m of st.perMessage.values()) {
      u.input += m.input; u.output += m.output; u.cacheRead += m.cacheRead; u.cacheWrite += m.cacheWrite;
    }
    u.total = u.input + u.output + u.cacheRead + u.cacheWrite;
    return u.total > 0 ? u : null;   // zero observed movement stays null — a never-admitted turn must keep classifying as a lane wedge
  };
  st.progress = () => { st.lastProgress = Date.now(); };
  // THINKING GAUGE: did extended thinking actually engage on this turn? The stage tier ("high"/"low"/…)
  // only says what we ASKED for — `--effort` is a disposition, not a guarantee (a probe at --effort high
  // on a trivial prompt produced no thinking block at all). Nothing else records the answer: there is NO
  // reasoning-token count anywhere in the claude payload (not result.usage, not usage.iterations), so
  // thinking spend is unrecoverable and only the yes/no is observable.
  //
  // Judge on BLOCK PRESENCE + signature, NEVER on the block's text. `thinking.display` defaults to
  // "omitted" on Opus 5, so an ENGAGED block streams with a zero-length `thinking` string and a real
  // `signature` — reading the text would report "no thinking" on every production turn.
  st.thought = false;
  // THE FIRST CALL'S CACHE SPLIT: how much of the opening prompt the provider served from its cache and how much it wrote
  // to it, read off the first assistant message's usage. Every caching claim about a stage was rebuilt from raw streams
  // by hand; this puts the first call's figures on the attempt. null when the stream carried no assistant message.
  st.firstCall = null;
  // MODEL GAUGE (corruption 3): which model the PROVIDER says served this turn. Until now
  // nothing on any record was a function of the provider's response — `modelUsed` was
  // `resolveModel(<the alias we asked for>)`, a pure function of the request, so a substitution or a
  // tier bounce was unobservable by construction. The truth is on the wire twice: `system:init`
  // carries the session's `.model`, and every completed `assistant` message carries `message.model`.
  //
  // Both are kept, and the assistant's wins when present, because they answer different questions:
  // init is what the CLI was CONFIGURED with, the assistant message is what actually served the API
  // call. A turn killed before its first assistant event still has init's answer rather than none.
  //
  // THREE-VALUED, like every other gauge here: the engine reports the string it observed or `null`.
  // It never falls back to the requested alias — a record that says "actual: <what we asked for>"
  // when nothing was observed is precisely the absence-read-as-a-pass this issue exists to end. The
  // comparison and the policy live in gateway.mjs; this reports, it does not judge.
  //
  // A MESSAGE THE CLI WROTE ITSELF NAMES NO MODEL. The CLI labels such a message `<synthetic>` in the
  // model field, measured in testing on Azure Foundry (2026-09-14): with the opus pin naming a
  // deployment that did not exist, the turn exited 1 with the CLI's own error and its assistant event
  // said `<synthetic>`. No model served that turn, so the label is never taken as a served id, and
  // `answeredItself` stops init's answer from standing in for one: init says what the session was
  // configured with, and naming it here would name a model for a turn no model served. A real id on
  // an earlier assistant event of the same turn now stands, because that model did serve a call;
  // before the label was refused, the label that followed overwrote it.
  st.wireModelInit = null; st.wireModelAssistant = null; st.answeredItself = false;
  // READS GAUGE (AD-4, 2026-07-30 addendum): which files this turn actually OPENED, from the stream's
  // completed Read tool_use blocks. The stage prompt OFFERS a set of documents (declared inputs +
  // skill refs); nothing recorded whether the turn could and did read them — and one review
  // found a stage that "largely COULD NOT read" its deciding docs, a fact that had to be
  // reconstructed forensically. Same posture as the thinking gauge: presence-only observation (the
  // tool_use block's file_path), never the content; the tuple carries `reads` UNCONDITIONALLY — an
  // empty array is the recorded fact "this turn read no files", distinct from an adapter that cannot
  // observe reads at all (no `reads` key → journalled as null by the gateway).
  st.reads = new Set();
  // …and the CAP is itself recorded. The set stops growing at READS_CAP; without a flag a capped list
  // reads as a complete one — "these are the files the turn opened" when it means "these are the first
  // 500". `readsTruncated` is the same three-valued discipline the gauge itself carries: false = the
  // list is everything observed, true = at least one further distinct path was dropped at the cap.
  // (A repeat of an already-recorded path is NOT truncation — nothing is lost.)
  st.READS_CAP = 500;
  st.readsTruncated = false;
}

/** What the turn's tool calls have shown so far: the counts, the session record and stream sink, and the outstanding asks and their wait periods. */
function toolState(st) {
  // ── THE TWO NUMBERS THAT MAKE A SLOW TURN A DIAGNOSIS RATHER THAN AN INFERENCE ────────
  //
  // `tokensPerSec` says so itself: "the denominator still contains the turn's own tool waits… it
  // records the ratio; it does not diagnose it." Establishing that a slow stage was WAITING rather
  // than generating has meant reading archived runs by hand and correlating — and the attempt record
  // carries no tool-call count and no tool duration at all.
  //
  // TWO INTEGERS, NO CONTENT. Not a call log: no tool names, no inputs, no per-call rows. The owner's
  // ruling against tool-call log records was about call logs carrying client mark text, and a count
  // and a millisecond total carry none — nothing here can name a mark.
  //
  // The wait is measured off the loop the stream already reports: an `assistant` message carrying
  // tool_use blocks is the agent asking, and the `user` event that follows is its result arriving
  // ("a completed tool result = the agent loop advanced", below). The gap between them is the turn
  // waiting on tools rather than generating.
  st.toolCalls = 0;
  // …AND THE SAME CALLS BY TOOL NAME, so a tool server's own log can be set against what the model
  // asked for. A name is the program's identifier for a tool (`Read`, `mcp__band__band_lookup`), never
  // an input, so it carries no client text. The values sum to `toolCalls` by construction: one fold
  // per tool_use block, at the one site that counts them.
  st.toolCallsByName = Object.create(null);
  // …AND WHICH OF THEM A TOOL SERVER ANSWERED WITH AN ERROR. A refused call the model then re-made used to
  // leave the stage row reading ok on one attempt, as though nothing had happened. Each ask's id names its
  // tool, and its result says whether it came back as an error; nothing else is kept.
  st.toolNameById = new Map();
  st.toolErrorIds = new Set();
  // WHAT THE SESSION WENT THROUGH, beside how it ended: every result event, every classifier cut,
  // every refusal and every restart, each with when it arrived. See session-record.mjs; the retry
  // policy below still reads the LAST result alone, so this records and decides nothing.
  st.session = newSessionRecord();
  // The raw stream, one file per session beside its dispatch (the caller names it). Opened before the
  // first byte can arrive; closed in settle(). A sink that could not open is a null writer whose
  // close() says why.
  st.sink = streamSink(st.streamFile);
  // HOW MANY OF THOSE ASKED FOR A COMMAND TOOL. The command tools are removed from every stage
  // (COMMAND_TOOLS), so the number a test round expects here is zero, and a count is what proves it: a
  // flag in the argv shows what was asked of the program, this shows what the model did. Still a count
  // of calls, never a name or an input.
  st.commandToolCalls = 0;
  // WRITES THE PROGRAM REPORTED AS FAILED: a Write or Edit whose result came back an error. The engine
  // probe refuses a machine on it, because it is the engine's own word that a file could not be written,
  // not an inference from a file that is missing. The ids of the write asks, so their results are known.
  st.writesFailed = 0;
  st.writeAsks = new Set();
  st.toolWaitMs = 0;
  st.toolAskedAt = null;
  // The last time this turn asked for a tool, apart from its own record write, and the last time it asked for that write:
  // what the gateway reads to tell a turn killed while still working from one killed silent or finishing (`lastToolAsk`).
  st.lastWorkAskAt = null; st.lastRecordAskAt = null;
  // WHAT THE WAIT IS MADE OF, keyed by the tool(s) that caused it.
  //
  // The total alone cannot answer the question it was collected for. "Exclude tool wait from the kill
  // clock because a turn waiting on a tool is the harness working" is TRUE of `register_execute_plan`
  // and FALSE of the perplexity tools, which dispatch to a MODEL — that wait is another model
  // generating, and treating it as free time would leave a hung sub-model bounded by nothing.
  //
  // One interval, ONE KEY: when a message asks for several tools it waits once, so the key is the
  // sorted set joined by "+". Every millisecond is attributed exactly once and the values sum to
  // `toolWaitMs` — a per-name split would double-count a concurrent ask and quietly break that identity.
  st.toolAskedNames = null;
  // WHICH CHUNK an ask arrived in. Every line in one stdout chunk is parsed in
  // one synchronous loop, so they all share a single Date.now(). If an ask and its result land in
  // the SAME chunk, the parent was not running between them and the gap it measures is 0 — for a
  // wait that really happened. Reproduced deterministically by blocking this process's event loop:
  // a turn that waited 260ms reported 0, with toolCalls still correct at 3.
  //
  // The discriminator is DELIVERY, not value. A genuine zero-millisecond wait is measurable and
  // real (two chunks, no gap); keying on `spent === 0` would flag those and miss a stall that
  // happened to leave 1ms on the clock.
  st.toolAskedChunk = null;
  // THE LATENT HALF, NOT THE STALL — ONE OUTSTANDING ASK WAS ALL THIS COULD
  // HOLD. `toolAskedAt` was a single slot, so a second assistant message arriving before the first
  // ask's result OVERWROTE the first ask's start time and its wait was never counted at all.
  // Measured on the overlap fixture (two asks, 150ms each): the old code reported toolWaitMs=149
  // with ONE tool in the map, for a turn that spent ~300ms waiting.
  //
  // WHY NOT SIMPLY GIVE EACH ASK ITS OWN CLOCK. Two asks outstanding at once wait CONCURRENTLY, so
  // their intervals overlap in real time; adding them counts the same milliseconds twice and can
  // exceed the turn's own elapsed time. Measured: 497 against a 469ms turn, which the wall cap on
  // `settledToolWaitMs` then clamped, breaking the identity the kill clock reads. The comment above
  // `toolWaitByTool` said so before this was tried — a per-name split double-counts a concurrent ask.
  //
  // SO: attribute each millisecond to the SET of tools outstanding during it, which is the very
  // convention this file already uses for one message asking several tools. A period ends whenever
  // the outstanding SET CHANGES, not when any single ask resolves:
  //
  //     T0      ask A       {A}      period opens
  //     T0      ask B       {A,B}    close 0ms
  //     T0+200  result B    {A}      close 200ms → "A+B"
  //     T0+300  result A    {}       close 100ms → "A"
  //
  // Every millisecond is credited exactly once, nothing is lost, and the one-message-two-tools case
  // reduces to today's behaviour exactly. `tool_use_id` is what makes it work: it says WHICH ask
  // left the set. Closing "the oldest" instead puts the tail under the wrong key.
  // The outstanding unit is the ASK — one assistant MESSAGE — not one tool id. A message asking
  // for several tools waits ONCE, and the first result naming any of its ids closes the whole ask.
  // That rule predates this change and is what stops a two-tool ask being counted twice; keeping
  // the unit at the id level left the second tool of such an ask outstanding forever.
  st.openAsks = [];             // ask records still outstanding, oldest first
  st.askById = new Map();       // tool_use_id → its ask record
  st.periodStart = null;          // when the current outstanding-SET period began
  st.periodChunk = null;          // the chunk it began in — the unmeasurable flag
  st.anonSeq = 0;                 // ids are on the wire, but never assume: synthesize if absent
  st.periodKey = () =>
    [...new Set(st.openAsks.flatMap((r) => r.names))].sort().join("+");
  // A PERIOD THAT OPENS AND CLOSES INSIDE ONE CHUNK IS UNMEASURABLE, WHICHEVER EVENT CLOSED IT.
  //
  // This line used to read: "a period that opens and closes inside one chunk because two ASKS
  // arrived together is not an unmeasurable wait, it is no wait. Only a RESULT closing in its ask's
  // chunk is." That reasoning is wrong and issue 1828's own title says why — the gauge times when
  // the driver PARSED each line, so a driver stall records a real wait as zero. Two asks 120ms apart
  // on the wire land in ONE stdout chunk when the reader is scheduled late; the parser sees them
  // microseconds apart, and the first ask's solo period — real time, really waited — is credited
  // ZERO with nothing saying it could not be seen. Measured on main 2026-08-25: a fixture that waits
  // 120ms between two asks reported {"a+b":150,"b":149} and a total of 299 where 420 was owed; the
  // missing 120 is exactly the collapsed period.
  //
  // The total is unchanged and that is deliberate: time the reader never observed must not be
  // invented, and `spent` stays what the clock says. What changes is that the run now SAYS the
  // period was unobservable instead of reporting no wait — the same vocabulary the result side has
  // had since 1828, one branch away, withheld from the ask side by the argument above.
  //
  // `cause` separates them because they mean different things to a reader: one is a tool that
  // answered inside a stalled read, the other is an ask superseded before its own period could be
  // seen. A consumer that only counts rows is unaffected.
  st.closePeriod = (now, onResult) => {
    if (st.periodStart === null || st.openAsks.length === 0) return;
    const k = st.periodKey() || "?";
    const spent = Math.max(0, now - st.periodStart);
    // A period seen across two chunks is measured even when the clock reads it as 0 ms, as a coarse clock can:
    // its ask is named with what the clock gave. Crediting only a positive wait dropped it, unmeasured and undeclared.
    if (spent > 0 || st.periodChunk !== st.chunkSeq) {
      st.toolWaitMs += spent;
      st.toolWaitByTool[k] = (st.toolWaitByTool[k] ?? 0) + spent;
    }
    if (st.periodChunk === st.chunkSeq) {
      st.unmeasurable.push({ tool: k, chunk: st.chunkSeq, bytes: st.chunkBytes, sincePrevChunkMs: st.chunkGapMs,
        cause: onResult ? "result-in-ask-chunk" : "ask-superseded-in-chunk" });
    }
  };
  // `settledToolWaitMs` adds `endedAt - toolAskedAt` as the gap still open when a kill landed. It
  // must therefore track the CURRENT UNCREDITED PERIOD — earlier periods are already in the total,
  // and handing it an older timestamp would count them twice, inflating the total and deflating
  // `activeMs` on exactly the killed-mid-tool turn the field exists for.
  st.syncOpenAsk = () => {
    st.toolAskedAt = st.openAsks.length ? st.periodStart : null;
    st.toolAskedNames = st.openAsks.length ? st.periodKey() : null;
    st.toolAskedChunk = st.openAsks.length ? st.periodChunk : null;
  };
  st.chunkSeq = 0; st.chunkBytes = 0; st.chunkGapMs = 0; st.prevChunkAt = null;
  st.unmeasurable = [];
  st.toolWaitByTool = Object.create(null);
}

/** The parser for one stream line, which every gauge above reads from. */
function lineParser(st) {
  // Parse ONE NDJSON line. The result event may arrive as the FINAL line with NO trailing newline
  // (NDJSON uses newline as separator, not terminator) — the close handler flushes `buf` through here
  // so the result is never dropped (B1: a dropped result mislabels a clean success as a hard failure).
  // Progress semantics: token-bearing events (assistant / message_start / message_delta), content deltas
  // (output tokens being generated) and completed agent-loop steps (user = a tool result landed) reset
  // the progress clock; system/init/ping chatter and unparseable partials reset ONLY the byte clock.
  st.parseLine = (line) => {
    line = line.trim(); if (!line) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; /* partial/non-json line */ }
    st.sawAnyEvent = true;
    noteClaudeEvent(st.session, ev, Date.now() - st.t0);
    if (ev.type === "result") st.resultEvent = ev;
    else if (ev.type === "rate_limit_event") st.rateLimitEvent = ev;
    else if (ev.type === "system" && ev.subtype === "init") {
      // MODEL GAUGE — the session's configured model, the earliest wire statement of what will run.
      if (typeof ev.model === "string" && ev.model && !isCliLabel(ev.model)) st.wireModelInit ??= ev.model;
      st.fastInit ??= { state: ev.fast_mode_state ?? null, reason: ev.fast_mode_disabled_reason ?? null };
      // THE SESSION'S ID, as the program states it when the session opens. The result event repeats it at the end, but a
      // turn stopped at its time limit never sends one, and the warm resume of a turn stopped while working needs the id
      // of the session to resume: handed the stage's own key instead, the program refuses it ("requires a valid session
      // ID"), and the retry is spent on the refusal (measured in testing, 2026-11-26).
      if (typeof ev.session_id === "string" && ev.session_id) st.sessionInit ??= ev.session_id;
      // WHAT THE PROGRAM SAYS ABOUT ITS OWN SESSION: the built-in tools it offers, the helpers it can hand work to, where
      // its API key came from, and its version. The footing check reads these (engine/probe.mjs); recording only here.
      st.sessionReport ??= {
        tools: Array.isArray(ev.tools) ? ev.tools.map(String) : null,
        agents: Array.isArray(ev.agents) ? ev.agents.map(String) : null,
        apiKeySource: typeof ev.apiKeySource === "string" ? ev.apiKeySource : null,
        version: typeof ev.claude_code_version === "string" ? ev.claude_code_version : null,
      };
    }
    // A HOOK THE PROGRAM RAN, as it reports one when asked (`--include-hook-events`): which event, how it ended, and the
    // start of what it wrote to stderr. Bounded, since only the footing check reads them.
    else if (ev.type === "system" && ev.subtype === "hook_response") {
      if (st.hookResponses.length < 20) st.hookResponses.push({ hook: ev.hook_event ?? null, outcome: ev.outcome ?? null,
        exitCode: Number.isFinite(ev.exit_code) ? ev.exit_code : null, stderr: String(ev.stderr ?? "").slice(0, 200) });
    }
    // THE PROGRAM'S NOTICE ABOUT FAST MODE. Out of usage credits, it retries each fast request at standard speed and says so
    // "on the message stream as a `system` message with subtype `notification`" (the vendor's fast-mode page, "Handle rate
    // limits"). The first such notice is kept, bounded, as the row's reason.
    else if (ev.type === "system" && ev.subtype === "notification") {
      const text = [ev.text, ev.message, ev.notification, ev.title].find((x) => typeof x === "string" && x) ?? "";
      if (!st.fastNotice && /fast/i.test(text)) st.fastNotice = text.slice(0, 300);
    }
    else if (ev.type === "assistant") {
      // MODEL GAUGE — the model that served THIS API call. Authoritative over init (see above).
      if (typeof ev.message?.model === "string" && ev.message.model) {
        if (isCliLabel(ev.message.model)) st.answeredItself = true;
        else st.wireModelAssistant = ev.message.model;
      }
      // THINKING GAUGE — block presence + signature, never the text (display defaults to "omitted",
      // so an engaged block carries a zero-length `thinking` string). See the declaration above.
      if (!st.thought && ev.message?.content?.some?.((b) => b?.type === "thinking")) st.thought = true;
      // READS GAUGE — completed assistant messages carry the full tool_use blocks; a Read's file_path
      // is the record. (Partials stream input via input_json_delta and are deliberately not parsed —
      // the completed message always follows.) Capped so a pathological turn cannot bloat telemetry.
      // Array.isArray, not `?? []`: a truthy NON-iterable `content` (a display-mode or CLI-version
      // change that streams an object, a `"…"` string) throws TypeError out of parseLine — which runs
      // on EVERY stdout chunk AND from settle(), where the throw would land after `settled = true` and
      // clearInterval(watchdog) but before resolve(): the driver dies mid-stage with no fail
      // classification and no recovery park, or the turn never settles with its watchdog already gone.
      // Same belt-and-braces as the thinking gauge's `?.some?.()` on the line above.
      for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (b?.type === "tool_use") { st.toolCalls++; countTool(st.toolCallsByName, b?.name); }   // every tool, not only Read; the count and its split by name
        if (b?.type === "tool_use" && b?.id != null) st.toolNameById.set(String(b.id), String(b?.name ?? "?"));
        if (b?.type === "tool_use" && COMMAND_TOOLS.includes(b?.name)) st.commandToolCalls++;
        if (b?.type === "tool_use" && FILE_WRITE_TOOLS.includes(b?.name) && b?.id != null) st.writeAsks.add(String(b.id));
        if (b?.type === "tool_use" && b?.name === "Read" && typeof b?.input?.file_path === "string") {
          if (st.reads.size < st.READS_CAP) st.reads.add(b.input.file_path);
          else if (!st.reads.has(b.input.file_path)) st.readsTruncated = true;   // a DISTINCT path was dropped
        }
      }
      // The clock starts only if this message actually asked for a tool; an assistant message that
      // asked for none leaves it null, so ordinary generation is never counted as a wait.
      const askBlocks = (Array.isArray(ev.message?.content) ? ev.message.content : [])
        .filter((b) => b?.type === "tool_use");
      const asked = askBlocks.map((b) => String(b?.name ?? "?"));
      st.toolAskedAt = asked.length ? Date.now() : null;
      st.toolAskedChunk = asked.length ? st.chunkSeq : null;
      st.toolAskedNames = asked.length ? [...new Set(asked)].sort().join("+") : null;
      if (asked.length) {
        const now = Date.now();
        if (asked.some((n) => !isRecordTool(n))) st.lastWorkAskAt = now; else st.lastRecordAskAt = now;
        st.closePeriod(now, false);          // the outstanding set is about to change
        const rec = { names: asked.slice() };
        st.openAsks.push(rec);
        for (const b of askBlocks) {
          const id = b?.id == null ? `__anon_${st.anonSeq++}` : String(b.id);
          st.askById.set(id, rec);
        }
        st.periodStart = now; st.periodChunk = st.chunkSeq;
      }
      st.syncOpenAsk();
      // This block's usage, folded into its own call: the largest reading wins, so a block's early count
      // never replaces the delta's running total, and a second block of the same call adds nothing twice.
      const usageKey = ev.message?.id ?? st.openMessage ?? `__assistant_${++st.anonMessages}`;
      st.foldUsage(usageKey, mapUsage(ev.message?.usage));
      st.noteSpeed(usageKey, ev.message?.usage);
      if (!st.firstCall && ev.message?.usage) st.firstCall = mapUsage(ev.message.usage);
      st.progress();
    }
    else if (ev.type === "user") {
      for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (b?.type === "tool_result" && b?.is_error === true && st.writeAsks.has(String(b?.tool_use_id))) st.writesFailed++;
        if (b?.type === "tool_result" && b?.is_error === true && b?.tool_use_id != null) st.toolErrorIds.add(String(b.tool_use_id));
      }
      // the result of the ask above. Only counted when an ask is outstanding, so a `user`
      // event with no preceding tool_use adds nothing rather than charging the turn for a gap it
      // never spent waiting.
      // Which ask is this the result OF? The id on the wire answers it. Falling back to the
      // OLDEST outstanding ask keeps a stream that carries no id working exactly as before, rather
      // than dropping the interval and quietly under-reporting the turn.
      const named = (Array.isArray(ev.message?.content) ? ev.message.content : [])
        .filter((b) => b?.type === "tool_result")
        .map((b) => (b?.tool_use_id == null ? null : st.askById.get(String(b.tool_use_id))))
        .filter((r) => r && st.openAsks.includes(r));
      const leaving = named.length
        ? [...new Set(named)]
        : (st.openAsks.length ? [st.openAsks[0]] : []);
      if (leaving.length) {
        const now = Date.now();
        st.closePeriod(now, true);
        for (const rec of leaving) {
          const i = st.openAsks.indexOf(rec);
          if (i >= 0) st.openAsks.splice(i, 1);
        }
        st.periodStart = st.openAsks.length ? now : null;
        st.periodChunk = st.openAsks.length ? st.chunkSeq : null;
      }
      st.syncOpenAsk();
      st.progress();      // a completed tool result = the agent loop advanced
    }
    else if (ev.type === "stream_event") {
      const t = ev.event?.type;
      if (t === "message_start") {
        st.openMessage = ev.event.message?.id ?? `__start_${++st.anonMessages}`;
        st.foldUsage(st.openMessage, mapUsage(ev.event.message?.usage));
        st.noteSpeed(st.openMessage, ev.event.message?.usage);
        st.progress();
      }
      else if (t === "message_delta") { st.foldUsage(st.openMessage ?? "__delta_without_start", mapUsage(ev.event?.usage)); st.noteSpeed(st.openMessage ?? "__delta_without_start", ev.event?.usage); st.progress(); }
      else if (t === "content_block_delta" || t === "content_block_start") st.progress();
      // THINKING GAUGE (partials): the earliest tells. Any one is sufficient; belt-and-braces so a
      // display-mode or CLI-version change cannot silently blind the gauge.
      if (!st.thought) {
        const e = ev.event;
        if (e?.content_block?.type === "thinking"
          || e?.delta?.type === "thinking_delta" || e?.delta?.type === "signature_delta") st.thought = true;
      }
    }
  };
}

/** How the turn is ended, and the watchdog that ends a stalled, trickling or overlong turn. */
function killAndWatch(st) {
  // The tree kill is the shared one (spawnTurn, startGovernedChild). Caveat: the group kill reaps claude's MCP children
  // only while claude does not setpgid them itself — post-deploy verification item.
  // Artifact-advance watch: an observed write to the stage's own expected output file(s) is the third
  // honest progress signal (a long single Write of the final artifact may follow minutes of quiet tool
  // work). A couple of statSync calls per ≤1s tick — negligible.
  st.artifactSeen = new Map();   // path → "mtimeMs:size" last observed
  st.artifactProgress = () => {
    for (const f of st.progressFiles ?? []) {
      let sig = null;
      try { const s = statSync(f); sig = `${s.mtimeMs}:${s.size}`; } catch { /* not written yet */ }
      if (sig !== null && st.artifactSeen.get(f) !== sig) { st.artifactSeen.set(f, sig); st.progress(); }
    }
  };
  // Is this turn producing tokens too slowly to be working? Active time, after the warm-up, over the
  // turn's own streamed output — the same accumulator the journal reports, so the number that kills a
  // turn is the number a reader afterwards sees.
  // What the rate WAS when the floor fired, for the failure line. Two decimals: the readings this
  // exists for are hundredths of a token per second.
  st.trickleRate = (now = Date.now()) => {
    const activeMs = activeElapsedMs({ wall: now - (st.firstOutputAt ?? now), toolWaitMs: st.toolWaitMs, toolAskedAt: st.toolAskedAt, now });
    return activeMs > 0 ? (((st.streamedUsage()?.output ?? 0) * 1000) / activeMs).toFixed(2) : "0.00";
  };
  st.isTrickling = (now) => {
    const activeMs = activeElapsedMs({ wall: now - st.firstOutputAt, toolWaitMs: st.toolWaitMs, toolAskedAt: st.toolAskedAt, now });
    if (activeMs < st.WARMUP) return false;
    return (st.streamedUsage()?.output ?? 0) < (st.MIN_RATE * activeMs) / 1000;
  };
  // The shared watchdog (common.mjs, governWatchdog) with this engine's own clocks.
  // THE STARTUP DEBT. An earlier repair widened the deadline below until the first byte but left this
  // clock's ORIGIN at spawn, so the startup interval stayed on the meter: the moment the grace let
  // go, progIdle already WAS the whole boot, and any NOPROG shorter than startup had expired before
  // the child was observed at all. The kill then landed on the next tick, before the ask could reach
  // toolCalls — a turn recorded as making no progress when nothing had yet had the chance to.
  // Releasing a clock is not starting one: the first byte is this clock's origin, not its green light.
  // ── STARTUP IS NEITHER SILENCE NOR WORK ──────────────────────────────────────────────
  // Every clock here USED TO start at SPAWN, so until the child's first byte they were all timing
  // process startup: an idle clock that had not yet seen silence, and an active clock that had not
  // yet seen work. Past tense deliberately — that work is finished, and the sentence stayed true of
  // the byte-stall below (`lastMove`) while being false of the progress clock above, which is
  // precisely the gap that let the defect sit here for a day looking like ambient flake. This was
  // established for the byte-stall in common.mjs, whose watchdog this engine now shares (governWatchdog);
  // before, it spawned its own child, so that fix never reached this watchdog. Under full-suite load
  // a starved spawn crossed a 400ms test ceiling before the mock had emitted anything, and the kill
  // was recorded as a no-progress stall against a turn that had not yet been given a chance to
  // progress. A child that never speaks AT ALL is still bounded: the byte-stall fires at max(STALL, GRACE).
  st.watchdog = governWatchdog({ pollMs: st.pollMs, stall: st.STALL, grace: st.GRACE, hardMs: st.hardMs, killTree: st.killTree,
    lastMove: () => st.lastMove, spoken: () => st.firstOutputAt !== null, onTick: st.artifactProgress,
    progressIdle: (now) => now - (st.firstOutputAt === null ? st.lastProgress : Math.max(st.lastProgress, st.firstOutputAt)),
    onSilentIdle: (ms) => { st.silentIdleMs = ms; },
    // No observable progress (tokens/agent-loop/artifact) for NOPROG while bytes kept the pipe warm:
    // kill it NOW, well below the wall, and record it as a STALL — never let the ceiling raise turn
    // into extended stall burn, and never let this kill read as "the stage needed more time".
    noProgressMs: st.NOPROG,
    // ── A TRICKLE IS A STALL WEARING A STREAM ────────────────────────────────────────────
    //
    // Both clocks above are satisfied by a token every twelve seconds: the byte-stall resets on any
    // byte, and the no-progress ceiling counts token movement as progress ON PURPOSE, because the
    // engine contract promises a slow-but-working streaming turn is never clipped. So the only thing
    // that stopped a trickle was the wall, at budget + 60s, with the whole attempt thrown away.
    //
    // This fires far below the wall and is RECORDED AS A STALL with its own discriminator, so the
    // retry policy treats it as one and never extends the budget for the next attempt — the thing a
    // ceiling raise would have done, and the reason this is not one.
    //
    // The rate is over the turn's own streamed output, on active time, after a warm-up. A healthy
    // turn is nowhere near it: the samples that motivated this ran at 74 and 82.83 tokens per second
    // against kills at 0.08 and 0.12, and the floor sits at 1.
    isTrickling: st.MIN_RATE > 0 ? (now) => st.isTrickling(now) : null,
    // ── THE CEILING MEASURES ACTIVE TIME, NOT ELAPSED ────────────────────────────────────
    //
    // Ruling: "there isnt such thing as a hung model. it always delivers something or fails."
    // So this ceiling exists for the harness's own failure modes, not to budget the model, and a turn
    // still doing work must not die because a tool it was waiting on took a while to answer.
    //
    // MEASURED, not assumed. One register stage ran twice in the same run — same engine, same matter,
    // same date. Attempt 1: 646.7s elapsed, 74.8% of it tool wait, 17 calls at 28.5s each. Attempt 2:
    // 51.2s elapsed, 0.6% wait, 3 calls at 0.1s each. Generation differed by 1.6%; elapsed by 3.9×;
    // per-call latency by 285×. Read on elapsed those are a healthy turn and a pathological one. Read
    // on active time they are the same turn — 81.8 and 80.5 tokens/sec. Across the register family the
    // 4.16× elapsed spread collapses to 1.27× on active time, while common-law on the same run spreads
    // 22.9× on active time: the same instrument, opposite results, so the flatness is the lane's
    // property and not the measure flattering everything.
    //
    // WHAT STILL BOUNDS A GENUINELY STUCK TURN, so this is not a ceiling removal:
    //   a silent process     the byte-stall above, 120s, reset by any streamed byte
    //   a working-looking    the no-progress ceiling above, reset only by a COMPLETED tool result,
    //   loop that never ends an artifact write, or token movement — so a tool that never returns is
    //                        bounded there, tighter than this ceiling ever was
    // Both are progress clocks. This one was the only elapsed clock, and elapsed was the wrong
    // quantity: a long turn has three causes — tool latency, a generation stall, and sheer VOLUME
    // (one healthy stage ran 40.9 minutes at a normal rate producing 186k tokens) — and nothing that
    // keys on elapsed can tell them apart.
    // measured from the FIRST BYTE, never from spawn. Startup is not active time either, and
    // against a tight pin it was the whole budget — a 900ms spawn hit a 500ms ceiling having done
    // nothing at all, and the turn died carrying `hardWall` with zero tool calls to explain it.
    elapsed: (now) => activeElapsedMs({ wall: now - st.firstOutputAt, toolWaitMs: st.toolWaitMs, toolAskedAt: st.toolAskedAt, now }),
    mark: (why) => { st.killed = true; if (why !== "hardWall") st.stallKill = true; if (why === "noProgress") st.noProgressKill = true; if (why === "trickle") st.trickleKill = true; } });
}

/** The program's stdout, stderr, error and close, wired to the parser and to settle. */
function wireStreams(st) {
  // A3 (gateway capAppend/finalCode parity): cap stdout AND stderr at maxBuffer. On overflow TRUNCATE
  // at the cap, pull the tree-kill FORWARD (an endless newline-free stream never trips the stall/hard
  // wall — every byte resets the stall clock), and settle nonzero with a clear overflow error so the
  // truncated tail can never parse as a valid result (a partial line would fail JSON anyway → resultEvent
  // stays null → nonzero fail). The group SIGKILL escalation killTree() arms still reaps a spewing tree.
  // The shared reader (common.mjs, readGovernedStreams), with this engine's rules: each raw chunk is counted and written
  // to the session stream before it is decoded; stderr neither speaks nor counts as liveness; only the line buffer is
  // held to the cap, since nothing keeps the whole output; and a line is parsed where it arrives, uncontained.
  //
  // STDERR DOES NOT START THE CLOCKS, and this line used to. This engine's protocol is
  // stream-json on STDOUT; stderr carries node warnings and CLI notices, which a child can emit
  // before it has done anything at all. Treating one as "the child has spoken" ended the grace and
  // — since the change that made the first byte the progress clock's ORIGIN — started that clock too,
  // so a turn whose real startup was still running got its no-progress ceiling measured from a
  // deprecation warning. A child that writes ONLY stderr is still bounded: it never starts, so the
  // byte-stall below fires at max(STALL, GRACE) exactly as it does for a silent spawn.
  //
  // The diagnostic follows the same rule deliberately. `firstByteMs=NEVER` now means "never spoke
  // its protocol", which is the question the no-progress specimen is actually asking — a number
  // that came from a stderr line would have answered a different one.
  st.reader = readGovernedStreams({ child: st.child, maxBuffer: st.maxBuffer, closed: () => st.settled, onLine: st.parseLine,
    stderrSpeaks: false, stderrIsLiveness: false, keepStdout: false, guardLines: false,
    onSpoken: () => { if (st.firstOutputAt === null) st.firstOutputAt = Date.now(); },   // the child has spoken; startup is over
    onMove: () => { st.lastMove = Date.now(); },
    onChunk: (d) => {
      st.chunkSeq += 1;                                            // see toolAskedChunk
      st.chunkBytes = d.length;
      st.chunkGapMs = st.prevChunkAt === null ? 0 : Date.now() - st.prevChunkAt;
      st.prevChunkAt = Date.now();
      st.sink.write(d);           // the raw stream, byte for byte, before anything parses it
    },
    onOverflow: () => { st.overflow = true; st.killTree(); st.settle(1); } });
  // error + close can BOTH fire for a single failure (Node) → settle EXACTLY once (no double clearInterval/resolve).
  st.child.on("error", (e) => { if (st.settled) return; st.settled = true; clearInterval(st.watchdog); st.sink.close(); st.resolve(errResult(st.t0, e, st.resumeRef)); });
  st.child.on("close", (code) => st.settle(code));
}

  function settle(st, code) {
    // the turn is over; the record must not outlive it, and is cleared only if
    // it still names THIS child.
    clearEngineChild(st.runDir, st.child?.pid);
    if (st.settled) return; st.settled = true;
    clearInterval(st.watchdog);
    // Reap the pipes: an overflow settle fires while a SIGTERM-immune spewer still holds stdout, so
    // settlement must never wait on a pipe some straggler keeps open (the group SIGKILL reaps the tree).
    try { st.child.stdout.destroy(); } catch { /* stream gone */ }
    try { st.child.stderr.destroy(); } catch { /* stream gone */ }
    st.reader.flush();   // B1: flush the final, un-terminated line (the result event) — but NEVER the truncated overflow tail
    st.stderr = st.reader.stderr();
    const stream = st.sink.close();   // after the flush: every byte the program wrote is in it, or the record says why not
    // ONE SAMPLE OF THE CLOCK, and both quantities below are derived from it. Two `Date.now()` calls
    // a few milliseconds apart are enough to break the identity on the very turn it matters for: on a
    // turn that is almost entirely tool wait, an in-flight gap measured LATER than the wall can exceed
    // it, `activeMs` clamps to zero, and the two stop tiling. It surfaced as an intermittent test
    // under suite load — which is what a race looks like from the outside and an instrumentation
    // defect from the inside.
    const endedAt = Date.now();
    const wall = (endedAt - st.t0) / 1000;
    // THE TWO CLOCKS MUST TILE THE WALL, in every case including the one that matters.
    //
    // A turn killed mid-tool-call has an OPEN ask that `toolWaitMs` has not closed. Reporting the
    // unclosed accumulator left `activeMs + toolWaitMs` short of the wall by exactly that gap — and
    // only on turns killed during a call, which is the population this rule is about. A guard asserting
    // the identity would have held on every ordinary attempt and quietly not held on the interesting
    // one. Closed here, ONCE, so both fields are derived from the same number.
    //
    // `toolWaitByTool` does NOT receive it: the ask has not resolved, so there is no name to charge.
    // That split was already documented as not summing to `toolWaitMs` (a concurrent ask would
    // double-count), so nothing downstream reads it as a partition.
    // CLAMPED TO THE WALL, so the pair tiles it in every case rather than in the common one. A gap
    // that reads longer than the whole turn is a clock artefact, not more waiting than there was time.
    const settledToolWaitMs = Math.min(Math.round(wall * 1000),
      Math.round(st.toolWaitMs + (st.toolAskedAt != null ? Math.max(0, endedAt - st.toolAskedAt) : 0)));
    // usage honesty: the result event is authoritative; a turn that never produced one (killed / died
    // mid-flight) reports what the STREAM proved it moved instead of null — so a stall/wall kill after
    // millions of cacheRead tokens can never be journalled as a 0-token event and mislabelled a lane
    // wedge or a transient-provider fault. Genuinely zero movement stays null (the wedge signature).
    const resultUsage = mapUsage(st.resultEvent?.usage);
    const streamUsage = resultUsage ? null : st.streamedUsage();
    const usage = resultUsage ?? streamUsage;
    const json = synthesizeEnvelope({ resultEvent: st.resultEvent, usage, killed: st.killed });
    // claude -p can exit 0 even on a failed turn (is_error rides the result envelope). Force a NONZERO
    // code on any failed turn so runStage's ladder catches it via the code!==0 branch (a hard,
    // fallback-eligible failure) rather than the softer status_<s> branch — parity with the retired gateway
    // nonzero_exit shape. (synthesizeEnvelope's status:"error" is belt-and-suspenders behind this.) Success → 0.
    // A3 overflow is likewise a hard failure (resultEvent is null → already caught here; kept explicit).
    const failed = st.overflow || st.killed || !st.resultEvent || st.resultEvent.is_error || st.resultEvent.subtype !== "success";
    // stall → make isTimeout fire (killed) AND carry the stall stderr signature the classifier reads, so the
    // taxonomy is identical; a 0-token stall then classifies as lane_wedge, which stage()'s lane-wedge retry takes.
    // overflow → carry a clear signature (killed stays false so it is a plain nonzero_exit, NOT a timeout/wedge).
    const stderrOut = st.overflow
      ? (st.stderr + `\nanthropic-agent output overflow: stdout/stderr exceeded ${st.maxBuffer} chars — killed the tree and failed the turn (truncated tail never parsed)`)
      : st.noProgressKill
        // THE SPECIMEN RIDES THE FAILURE, because the broken state expires. This kill has
        // twice reddened `main` from a test whose ANTI-VACUITY check failed — the turn died having
        // opened no tool ask — and neither the box's ambient load nor a full-suite run reproduces
        // it on demand. So the discriminating bit is recorded HERE, where the kill happens, rather
        // than hunted afterwards: `firstByteMs=NEVER` means the child never spoke and the grace
        // was genuinely exceeded (a starved spawn); a NUMBER means it spoke and the ask never
        // reached `toolCalls`, which is a progress-accounting fault and has nothing to do with
        // startup. Those want different fixes and the artifact now says which.
        ? (st.stderr + `\nrequest timed out (anthropic-agent no-progress watchdog: no token movement / agent-loop step / artifact write for ${Math.round(st.NOPROG / 1000)}s — a STALL, not a slow turn)`
          + `\nanthropic-agent no-progress specimen: firstByteMs=${st.firstOutputAt === null ? "NEVER" : Math.round(st.firstOutputAt - st.t0)}`
          + ` toolCalls=${st.toolCalls} noProgressMs=${st.NOPROG} graceMs=${st.GRACE}`)
      : st.trickleKill
        // ITS OWN SENTENCE, because "0 streamed tokens" is the one thing this kill is not. A reader
        // meeting the stall line over a turn that streamed for forty minutes would go looking for a
        // silent process and find a talkative one. The rate that killed it rides the line, so the
        // threshold can be argued from artifacts rather than from memory.
        ? (st.stderr + `\nrequest timed out (anthropic-agent trickle floor: ${st.trickleRate()} output tokens/sec of active time,`
          + ` under the ${st.MIN_RATE}/sec floor after a ${Math.round(st.WARMUP / 1000)}s warm-up — a STALL that kept the pipe warm, not a slow turn)`)
      : st.stallKill ? (st.stderr + "\nrequest timed out (anthropic-agent stall-watchdog: 0 streamed tokens)")
      // Startup-class death (the 3× register-digest code=1 zero-token shape): the CLI exited without
      // emitting a single stream event — the failure happened before any turn ran (arg/auth/MCP
      // startup), so the stderr above is the whole story. Name it so the journal's stderrTail is
      // never read as a mid-turn provider fault.
      : (!st.sawAnyEvent && !st.killed && st.resultEvent == null)
        ? (st.stderr + "\nanthropic-agent: the claude process exited without emitting any stream event — a startup-class failure (args/auth/MCP), not a mid-turn provider fault; the stderr above is the diagnosis")
      : st.stderr;
    // Rate-limit / session-cap rejection: claude -p emits a rate_limit_event{status:"rejected",resetsAt}
    // plus a result with api_error_status 429. Surface a distinct signal (+ the ISO reset time) so the
    // driver POSTPONES the run to resetsAt rather than running the futile fallback cascade (every tier
    // shares the one subscription). resetsAt is epoch SECONDS on the event -> ISO.
    const rateLimited = st.resultEvent?.api_error_status === 429 || st.rateLimitEvent?.rate_limit_info?.status === "rejected";
    const resetsAtRaw = st.rateLimitEvent?.rate_limit_info?.resetsAt;
    const resetsAt = rateLimited && resetsAtRaw ? new Date(Number(resetsAtRaw) * 1000).toISOString() : undefined;
    st.resolve({
      code: st.killed ? 137 : (failed ? (code || 1) : 0),
      killed: st.killed, wall,
      stdout: typeof st.resultEvent?.result === "string" ? st.resultEvent.result : "",
      stderr: stderrOut, laneWaitMs: 0,
      json, usage,
      // READS GAUGE: unconditional, like signals.thought — [] is the recorded fact "read nothing".
      // readsTruncated rides beside it, also unconditional: false = the list is complete as observed,
      // true = the 500-path cap dropped at least one further distinct file (so a `read:false` derived
      // from this list is unreliable and the consumer must downgrade it to "not observed").
      reads: [...st.reads], readsTruncated: st.readsTruncated,
      // The first call's cache read and cache write, in tokens (see `firstCall`); null when it was never seen.
      firstCallCache: st.firstCall ? { read: st.firstCall.cacheRead, creation: st.firstCall.cacheWrite } : null,
      toolCalls: st.toolCalls, toolWaitMs: settledToolWaitMs,   // two integers, no content
      // The same calls by tool name (values sum to toolCalls), and what the session went through: every
      // result, cut, refusal and restart (session-record.mjs). `stream` is the raw stream's file and size,
      // or why it was not kept. Recording only — `failed` above still reads the last result alone.
      toolCallsByName: { ...st.toolCallsByName }, session: sessionSummary(st.session), stream,
      // The two counts a test round reads per stage: calls to a command tool, and calls the program
      // refused. The refusals are the result event's own `permission_denials`, counted; null when the
      // turn settled with no result event, so "not reported" never reads as "none refused".
      commandToolCalls: st.commandToolCalls, writesFailed: st.writesFailed,
      toolCallsRefused: Array.isArray(st.resultEvent?.permission_denials) ? st.resultEvent.permission_denials.length : null,
      // The tool-server calls that came back as an error, by tool name: the program sent them and the
      // server refused or failed them. A call the program itself refused is counted above and not here.
      toolCallsErroredByName: toolServerErrors(st.toolErrorIds, st.toolNameById, st.resultEvent?.permission_denials),
      // ms from spawn to the child's FIRST byte, or null when it never spoke. RECORDING
      // ONLY: nothing branches on it. A recording field is protected by a test or by nothing, so
      // engine.anthropic.test.mjs pins it — deleting it must red something.
      firstByteMs: st.firstOutputAt === null ? null : Math.round(st.firstOutputAt - st.t0),
      // ms from spawn to the last tool ask that was not the stage's own record write, and to the last that was; null where
      // the turn made none. RECORDING, and read by the gateway only to choose how a hard-wall kill is retried.
      lastToolAsk: { workMs: st.lastWorkAskAt === null ? null : Math.round(st.lastWorkAskAt - st.t0), recordMs: st.lastRecordAskAt === null ? null : Math.round(st.lastRecordAskAt - st.t0) },
      // WHICH SIDE OF THE KILL a byte or a tool ask fell on. RECORDING ONLY, like firstByteMs. The
      // totals above keep counting after the decision, because what a dying child already wrote is
      // still read (streamed usage depends on it). On Windows the kill blocks this process while it
      // lists and ends the tree, measured at one to three seconds on the hosted runner, which is long
      // enough for a booting child to speak and open a tool ask that is read only afterwards.
      // `killDecision` is what the watchdog had seen when it decided: ms from spawn, whether the child
      // had spoken, and the tool asks read by then; null when nothing was killed. `silentIdleMs` is how
      // long the no-progress clock had run at the watchdog's last look before the child spoke; null
      // when it never looked at a silent child.
      killDecision: st.atKill, silentIdleMs: st.silentIdleMs,
      // WHICH CLOCK RAN OUT, and WHAT the wait was made of.
      //
      // The hard wall measures ELAPSED, and elapsed includes time the model spent waiting on tools
      // rather than generating. A wall kill whose elapsed is mostly tool wait is a different event from
      // one that ground for the whole budget generating, and nothing told them apart — so the question
      // "should the kill clock count tool wait" could not be answered from any record.
      //
      // `activeMs` INCLUDES THE IN-FLIGHT GAP. A turn killed mid-tool-call has an open ask that
      // `toolWaitMs` has not yet closed, and that is exactly the case this is for: leaving it out would
      // charge the model for the wait that killed it.
      //
      // UNCONDITIONAL, following `thought` below rather than the `|| undefined` siblings: a turn with no
      // tool wait must report 0, not vanish, or "the wall caught generation" is indistinguishable from
      // "this record predates the gauge".
      activeMs: Math.max(0, Math.round(wall * 1000) - settledToolWaitMs),
      toolWaitByTool: { ...st.toolWaitByTool },
      // the asks whose wait this process COULD NOT MEASURE, because the ask and
      // its result were delivered in one chunk. An ARRAY is a measurement (possibly `[]`: measured,
      // nothing unmeasurable), following toolWaitByTool's own rule that absence and "cannot report"
      // must not look alike. `toolWaitMs` and the per-tool split are untouched.
      toolWaitUnmeasurable: [...st.unmeasurable],
      // MODEL GAUGE: the id the WIRE reported, or null when the stream never said. Assistant
      // message first (what served the call), init second (what the session was configured with).
      // Never the requested alias, and never init's answer for a turn only the CLI answered — see the
      // declaration above.
      modelWire: st.wireModelAssistant ?? (st.answeredItself ? null : st.wireModelInit),
      // SPEED GAUGE: what the turn asked for beside what the program reported serving (speedOfClaudeTurn).
      speed: speedOfClaudeTurn({ requested: st.speed, standardBecause: st.standardBecause, result: st.resultEvent, init: st.fastInit, calls: st.speedByMessage, notice: st.fastNotice }),
      // FOOTING: what the program reported about its own session, and the hooks it reported running. Null when it said
      // nothing at start, which the footing check reads as a session it could not see (engine/probe.mjs).
      footing: st.sessionReport ? { ...st.sessionReport, hooks: [...st.hookResponses] } : null,
      // PROVIDER GAUGE: the program's own word for who served the turn, read from the result's per-model
      // usage ("firstParty" on Anthropic's own API and "foundry" on Azure Foundry, measured 2026-09-14),
      // or null when the stream never said or its models disagree. Recorded, never inferred from config.
      providerWire: providerOf(st.resultEvent),
      sessionRef: st.resultEvent?.session_id ?? st.sessionInit ?? st.resumeRef ?? null,
      // The raw result event's total_cost_usd is a provider-side field and stays in the provider's
      // own stream; the tuple carries no currency (tokens-only directive 2026-07-11) — `usage` is
      // the telemetry.
      // hardWall: the watchdog SIGKILLed at the full timeout+60 wall (NOT a stall). This flag carries the
      // distinction outward so a hard-wall over-budget grind is treated as a `timeout`, not a `lane_wedge`.
      // noProgress: the honest-progress ceiling fired (a stall discriminator — recorded as a stall, and
      // the retry policy must not extend the budget for it). usageStreamed: the tuple's usage was
      // reconstructed from the stream because the turn died without a result event (telemetry honesty —
      // never journal a token-moving kill as usage:null). noStreamEvents: the CLI died before emitting
      // ANY stream event — a startup-class failure, diagnosable from stderrTail alone.
      signals: { stalled: st.stallKill || undefined, noProgress: st.noProgressKill || undefined,
        // A TRICKLE IS A STALL, and this says which kind. Retry policy keys on `stalled` — so this
        // never extends the next attempt's budget — while a reader keys on this to tell a turn that
        // said nothing from one that said almost nothing for three quarters of an hour.
        trickle: st.trickleKill || undefined,
        hardWall: (st.killed && !st.stallKill) || undefined, rateLimited: rateLimited || undefined, resetsAt,
        usageStreamed: (streamUsage != null) || undefined,
        noStreamEvents: (!st.sawAnyEvent && st.resultEvent == null) || undefined,
        // thought: UNCONDITIONAL boolean — deliberately NOT `|| undefined` like every sibling here. The
        // whole point of the gauge is that "did not think" stays distinguishable from "this record
        // predates the gauge"; an omitted key would recreate exactly the ambiguity that made the old
        // reasoningTokens slot useless. false must be recorded AS false.
        thought: st.thought },
    });
  }


/**
 * One turn's speed record: what it asked for and what the program reported serving. PURE.
 *
 * `served` is the result's `usage.speed`, the program's word for the turn; where the result says nothing, the calls'
 * own words decide it (`mixed` when they disagree), and null where none spoke. `calls` counts the turn's API calls by
 * the speed each reported, so a run can say how many of its calls ran fast. `state` and `disabledReason`
 * are the program's `fast_mode_state` and `fast_mode_disabled_reason` (measured on 2.1.295 and 2.1.326: `on`; `off` with
 * `sdk_opt_in_required` when the turn did not ask), and `notice` its own words when it ran a fast request at standard
 * speed for want of usage credits. `standardBecause` is why a session of a fast run asked for standard (engine/speed.mjs,
 * sessionSpeed), null otherwise. Nothing here is inferred from what the turn asked for.
 */
export function speedOfClaudeTurn({ requested = "standard", standardBecause = null, result = null, init = null, calls = new Map(), notice = null } = {}) {
  const count = { fast: 0, standard: 0, unknown: 0 };
  for (const v of calls.values()) count[v === "fast" ? "fast" : v === "standard" ? "standard" : "unknown"]++;
  const reported = typeof result?.usage?.speed === "string" && result.usage.speed ? result.usage.speed : null;
  const fromCalls = count.fast && count.standard ? "mixed" : count.fast ? "fast" : count.standard ? "standard" : null;
  const served = reported ?? fromCalls;
  return {
    requested, standardBecause: standardBecause ?? null, served, basis: served ? "reported" : "unknown", calls: count,
    state: result?.fast_mode_state ?? init?.state ?? null,
    disabledReason: result?.fast_mode_disabled_reason ?? init?.reason ?? null,
    notice: notice ?? null,
  };
}

function errResult(t0, e, resumeRef) {
  return {
    code: 1, killed: false, wall: (Date.now() - t0) / 1000, stdout: "",
    stderr: `anthropic-agent spawn error: ${e?.message ?? e}`, laneWaitMs: 0,
    // reads: a spawn error means NO turn ran — [] is the true observation (nothing was read), not a gap.
    // modelWire: null for the opposite reason — no turn ran, so the wire said nothing about a model, and
    // the record must say UNKNOWN rather than inherit the alias that was asked for.
    json: null, usage: null, reads: [], readsTruncated: false, modelWire: null, providerWire: null, sessionRef: resumeRef ?? null, footing: null,
    // No session ran, so there is nothing to have been interrupted and no stream: null, never an empty record.
    toolCallsByName: null, toolCallsErroredByName: null, session: null, stream: null,
  };
}

/**
 * The tool-server calls of one turn that came back as an error, by tool name: every `mcp__` ask whose
 * result carried `is_error`, less the asks the program refused itself (`permission_denials`, which
 * `toolCallsRefused` counts). An OBJECT is a measurement (`{}`: none). PURE.
 */
export function toolServerErrors(errorIds, nameById, denials) {
  const denied = new Set((Array.isArray(denials) ? denials : []).map((d) => String(d?.tool_use_id ?? "")).filter(Boolean));
  const byName = Object.create(null);
  for (const id of errorIds ?? []) {
    const name = nameById?.get(id);
    if (typeof name === "string" && name.startsWith("mcp__") && !denied.has(id)) countTool(byName, name);
  }
  return { ...byName };
}

/**
 * The program's own word for which provider served a turn, from the result event's per-model usage:
 * `modelUsage[<model>].provider`, "firstParty" on Anthropic's own API and "foundry" on Azure Foundry
 * (measured 2026-09-14, CLI 2.1.263). One word when every model the turn used names the same provider;
 * null when none does or they disagree, because a single word would then be a guess.
 */
export function providerOf(resultEvent) {
  const words = new Set();
  for (const u of Object.values(resultEvent?.modelUsage ?? {})) {
    const w = typeof u?.provider === "string" ? u.provider.trim() : "";
    if (w) words.add(w);
  }
  return words.size === 1 ? [...words][0] : null;
}

/**
 * Whether a model field holds one of the CLI's own bracketed labels, such as `<synthetic>` on a message
 * it wrote itself, rather than the id of a model. The reports skip the same shape when they name models.
 */
function isCliLabel(id) {
  return /^<.*>$/.test(String(id).trim());
}
