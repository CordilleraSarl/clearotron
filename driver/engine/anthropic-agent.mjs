// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/anthropic-agent.mjs — the `anthropic-agent` engine: runs one stage turn as a standalone
// `claude -p` process (OFF any agent gateway), with streaming stall-detection (the #1 speed prize
// that the blocking subprocess path structurally cannot do — see stages.mjs narrative-refutation note).
//
// Contract: engine/CONTRACT.md. runTurn() returns the registry-standard normalized tuple
// (`{code, killed, wall, stdout, stderr, laneWaitMs, json, usage, reads, readsTruncated, modelWire,
// sessionRef, signals}`), with a SYNTHESIZED `json` envelope in the classifier's shape so every downstream
// classifier in gateway.mjs (payloadText, json.status check, isEmbeddedFallback, isTimeout,
// isLaneWedge) works unchanged.
//
// Pinned from a 2026-06-16 capture of `claude -p`: subscription auth is headless (apiKeySource:"none");
// result event carries usage{input_tokens,output_tokens,cache_read_input_tokens,
// cache_creation_input_tokens}, total_cost_usd, session_id, stop_reason; stream_event partials are the
// watchdog heartbeat (--include-partial-messages).

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSpawnCwd, spawnGraceMs } from "./common.mjs";
import { envFrom } from "../../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half
import { authorityTrees } from "../authority-trees.mjs";
import { recordEngineChild, clearEngineChild } from "./child-record.mjs";   //

// Read per-call (not module-level) so tests can drive a short stall timeout / a mock binary.
const claudeBin = () => envFrom(process.env, "CLEAROTRON_CLAUDE_PATH") || "claude";

// AUTH TOGGLE (config, not code). The subscription path is the cost-saving default: claude -p with NO
// ANTHROPIC_API_KEY in its env falls back to the OAuth subscription credentials (apiKeySource:"none" →
// INCLUDED in the subscription, not API-billed). But the gateway keeps ANTHROPIC_API_KEY in the shared
// .env, and a present API key OVERRIDES the subscription — so we must STRIP it from the claude subprocess
// env. CLEAROTRON_AI_BILLING=api-key keeps the key (the standing fallback for when the subscription is
// revoked — Anthropic's advance notice = today's per-call API cost). Default = subscription.
export function spawnEnv(base = process.env) {
  const env = { ...base };
  const mode = (base.CLEAROTRON_AI_BILLING || "subscription").toLowerCase();
  if (mode !== "api-key") delete env.ANTHROPIC_API_KEY;   // subscription: force OAuth/subscription billing
  return env;
}
// 120s of ZERO streamed output = the silent-provider-stall abort. A healthy turn
// streams thinking + output deltas continuously, so this never clips a slow-but-working turn.
const stallMs = () => Number(process.env.CLEAROTRON_STALL_MS || 120000);

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
const noProgressMs = (stallClockMs) => {
  const pinned = Number(process.env.CLEAROTRON_NO_PROGRESS_MS);
  if (pinned > 0) return pinned;
  const floor = Number(process.env.CLEAROTRON_NO_PROGRESS_FLOOR_MS) > 0 ? Number(process.env.CLEAROTRON_NO_PROGRESS_FLOOR_MS) : 300000;
  return Math.max(stallClockMs, floor);
};
// C2: grace between the watchdog's group SIGTERM and the group SIGKILL that follows it (see killTree
// in runTurn). ~5s — long enough for claude to flush, short enough that a wedged tree dies promptly.
const killEscalateMs = () => Math.max(50, Number(process.env.CLEAROTRON_KILL_ESCALATE_MS || 5000));
// A3: cap the engine's stdout/stderr the way the retired gateway exec did (capAppend/finalCode in
// gateway.mjs). A model that emits one endless newline-free line otherwise grows `buf` to the
// V8 string limit → uncaught RangeError → runner crash mid-drain (and every streamed byte resets the stall
// clock, so the watchdog never trips). Default 64MB (gateway parity); CLEAROTRON_ENGINE_MAX_BUFFER shrinks it for tests.
const engineMaxBufferChars = () => Math.max(1024, Number(process.env.CLEAROTRON_ENGINE_MAX_BUFFER || 64 * 1024 * 1024));

// tier/alias → claude -p model alias. haiku passes straight through (claude understands the alias —
// the 2026-06-16 capture used `--model haiku`). opus and sonnet are PINNED to their full model names
// (claude-opus-5 / claude-sonnet-5) rather than the bare "opus"/"sonnet" aliases, so they no longer
// silently drift to whatever Anthropic/the CLI currently calls "opus"/"sonnet" — matching the driver's
// reproducibility conventions (warm-resume same-model, PURE-FILE replay). opus was bumped off the
// floating "opus" alias to the pinned claude-opus-5 on 2026-07-27: the bare alias still resolved to
// claude-opus-4-8 on the live CLI (2.1.209) at the time, so this is a real, GRADE-MOVING model change
// validated in the paid A/B (CONTRACT §3), never on $0 replay — same price as 4.8 ($5/$25). The
// non-anthropic tiers (gemini skeptic, deepseek refutation, azure) have no claude equivalent →
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
// attribution downstream of that row — the A/B arm, the token rollup, 's billing classes — was
// keyed to a model that never ran. Nothing said so, because a substitution has no error to report.
//
// The four cross-provider aliases were already dead before this change: the model-failover chain was
// deleted, and the two stages that named them were made honest in the defs (skeptic declares
// `sonnet`, narrative-refutation declares `opus` — stages.mjs). They existed only to substitute.
//
// An alias with no claude equivalent now FAILS LOUD, exactly as `openaiModel` has always done for a
// non-GPT id. That is the issue's requirement in one line: an unhonoured model override is an error,
// not a substitution.
const CLAUDE_MODEL = {
  opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "haiku", fable: "fable",
  "anthropic/claude-opus-5": "claude-opus-5", "anthropic/claude-sonnet-5": "claude-sonnet-5",
  "anthropic/claude-sonnet-4-6": "sonnet", "anthropic/claude-haiku-4-5": "haiku",
};
export function claudeModel(model) {
  if (!model) return undefined;
  if (CLAUDE_MODEL[model]) return CLAUDE_MODEL[model];
  // A bare or dated anthropic id ("claude-haiku-4-5-20251001") still resolves to its family alias —
  // that is a NAMING form of a model claude can actually run, not a substitution of a different one.
  // The family must be named IN the id: a `claude-*` id whose family this build does not recognise
  // throws too, rather than riding the old else-arm into sonnet.
  const fam = /opus/i.test(model) ? "opus" : /haiku/i.test(model) ? "haiku" : /sonnet/i.test(model) ? "sonnet" : null;
  if (fam && /^(?:anthropic\/)?claude-/i.test(model)) return fam;
  throw new Error(`anthropic-agent: no claude model mapped for "${model}" — this engine runs claude only. Pass opus/sonnet/haiku/fable or a concrete claude-* id. (It used to substitute sonnet silently and log the alias you asked for: #238 corruption 3.)`);
}

// ── thinking tier → `claude --effort` ────────────────────────────────────────────────────────────────
// CANONICAL TABLE. `engine/openai-agent.mjs` carries the byte-equal twin for the tiers both vocabularies
// can express, and `engine.anthropic.test.mjs` pins the two together — the same duplicate-plus-drift-test
// discipline WRITE_DISCIPLINE already uses here (this module deliberately imports nothing but node
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

// The Write-tool discipline the stages assume but claude -p doesn't infer from "write your output to <path>".
// Byte-identical with engine/common.mjs's copy (this module deliberately imports nothing but node built-ins);
// engine.common.test.mjs asserts the two never drift. See that copy's header for the repair exception's why.
export const WRITE_DISCIPLINE =
  "OUTPUT DISCIPLINE — read carefully: when the task instructs you to write output to an absolute file path, " +
  "you MUST create that file by CALLING THE WRITE TOOL with that exact path and the full content. Output you " +
  "place only in your text reply is DISCARDED and the task is scored as FAILED. Do the actual work, write every " +
  "required file via the Write tool (overwrite if it exists), and only THEN reply — with just the path(s) you " +
  "wrote and a 2-3 line summary. Never claim a file is written unless you invoked the Write tool to write it. " +
  "EXCEPTION — REPAIRS: when the task instructs you to FIX or CORRECT an EXISTING file, use the Edit tool and " +
  "change only what the correction names — a file corrected with the Edit tool counts as written. Rewriting a " +
  "whole file to fix a few lines risks degrading content that already passed. If the file does not exist, the " +
  "rule above stands: create it in full with the Write tool.";

// The shared stage prompts reference skills by the convention `skills/foo/SKILL.md` — a workspace agent
// resolves these against its workspace cwd, but `claude -p` (cwd = a neutral tmpdir, to avoid loading the
// repo CLAUDE.md) resolves them against /tmp → missing_file (the 2026-06-16 matter-frame blocker). Rewrite
// every `skills/…md` token to an ABSOLUTE path under the configured compute-skills tree (`config.skillsDir`,
// default <driverDir>/skills as of the Phase-3 skills move; was <workspaceDir>/skills before). The refs keep
// their `skills/` prefix, so we join them onto the PARENT of skillsDir — i.e. join(dirname(skillsDir),
// "skills/foo.md"). Engine-localized: the caller's original message is NEVER mutated. The
// negative lookbehind on [\w/.] makes the rewrite IDEMPOTENT — an already-absolute path that contains
// `skills/` (the rewritten form, or a corrective/warm re-wrap of an absolutized message) is preceded by
// `/` and so is never double-prefixed.
const SKILL_REF = /(?<![\w/.])skills\/[A-Za-z0-9._/-]+\.md/g;
// `resolve` (optional) maps a `skills/...` ref to the file that should actually be read — the layered
// overlay-over-base lookup (driver.config.resolveSkillPath). Without it the legacy single-dir behaviour
// stands, so this stays a pure function over its inputs and every existing caller/test is unaffected.
export function absolutizeSkillRefs(message, skillsDir, resolve = null) {
  if (!message || (!skillsDir && !resolve)) return message;
  const base = skillsDir ? dirname(skillsDir) : null;   // skillsDir ends in /skills; refs carry their own `skills/` prefix
  return message.replace(SKILL_REF, (m) => (resolve ? resolve(m) : join(base, m)));
}

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
// that engine spawns with `cwd = resolveSpawnCwd({cwd, runDir})` — the RUN DIR (, deliberately) —
// under `--sandbox workspace-write`, which makes cwd a writable root on its own. Dropping the flag there
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

export function buildClaudeArgs({ message, model, thinking, resumeRef, mcpConfig, allowedTools, maxBudgetUsd, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, seatWrites = null }) {
  const input = absolutizeSkillRefs(message, skillsDir, resolveSkill);
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  const m = claudeModel(model); if (m) args.push("--model", m);
  args.push("--effort", effortFor(thinking));
  // FAST MODE REMOVED (2026-06-17): the Opus `--settings {"fastMode":true}` knob ~2.5×'d subscription-billed
  // usage and tripped the Claude 5-hour session cap mid-run (overage org-disabled → hard 429 → every stage
  // nonzero_exit_1). Reverted everywhere; HIGH effort is retained on the verdict/safety stages.
  // Stages WRITE their output file; acceptEdits auto-approves Write/Edit in non-interactive -p (Read is
  // always allowed). Gather tools (E3) ride --allowedTools so they never prompt either.
  args.push("--permission-mode", "acceptEdits");
  // OUTPUT DISCIPLINE (engine-localized; the shared stage prompts say "write your output to <path>" which
  // a workspace agent executes via its file tool, but claude -p tends to COMPOSE the output as text and
  // report "done" without ever calling Write — the matter-frame missing_file failures, 2026-06-16). Force
  // the Write-tool behaviour at the system-prompt level so EVERY stage's file actually lands, without
  // touching the shared stage prompts. Unconditional — no disable knob.
  args.push("--append-system-prompt", WRITE_DISCIPLINE);
  if (resumeRef) args.push("--resume", resumeRef);          // warm-resume → reuses the prompt cache
  if (mcpConfig) { args.push("--mcp-config", mcpConfig, "--strict-mcp-config"); }
  if (allowedTools) args.push("--allowedTools", allowedTools);
  const cap = maxBudgetUsd ?? (process.env.CLEAROTRON_MAX_BUDGET_USD ? Number(process.env.CLEAROTRON_MAX_BUDGET_USD) : null);
  if (cap != null && Number.isFinite(cap)) args.push("--max-budget-usd", String(cap));
  // FILE ACCESS: claude's Read/Write/Edit tools are confined to cwd + --add-dir roots even under
  // acceptEdits (cwd is a neutral tmpdir here), so the compute-skills tree (skillsDir — the
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
  const rd = runDirGrant({ runDir, dispatch: input, seatWrites });
  const granted = rd.grant ? runDir : null;
  if (granted) args.push("--add-dir", granted);
  const boundary = writeBoundarySettings({ skillsRoots: grantRoots, profilesDir, runDir: granted });
  if (boundary) args.push("--settings", boundary);
  return { args, input, grantNote: rd.note };
}

/** POSIX single-quoting — the hook `command` is run through a shell, and a checkout path may hold spaces. */
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The `--settings` JSON that installs the write boundary, or null when there is nothing to protect.
 *
 * The policy travels in the hook's OWN argv (base64 — the alphabet is shell-safe, so no quoting question
 * survives into the command string). That is deliberate: hook and policy are ONE object, so "installed but
 * unconfigured" — the silent half-state that would leave a boundary reporting nothing — cannot occur.
 *
 * `process.execPath`, never a bare `node`: the hook command runs through a shell whose PATH under systemd
 * need not carry the node the driver is running on.
 *
 * NOTE for whoever next edits the flag list: `--bare` disables hooks. Adding it removes this boundary
 * silently, exactly as `--add-dir` silently granted write.
 */
export function writeBoundarySettings({ skillsRoots = [], profilesDir = null, runDir = null, hookPath = null } = {}) {
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
  catch { throw new Error(`write_boundary_hook_missing:${hook} (the #595 deny-hook is not in this deployment; a missing hook command fails OPEN in the CLI, so the dispatch is refused rather than run unprotected)`); }
  const payload = Buffer.from(JSON.stringify({ trees, runDir: runDir ?? null }), "utf8").toString("base64");
  return JSON.stringify({
    hooks: {
      PreToolUse: [{
        // #997 — Bash is in the matcher because seats have it and it walked past this hook entirely.
        // What the Bash arm can and cannot do is stated at its declaration in deny-authority-write.mjs;
        // it is a detector, and naming it here does not make it a boundary.
        matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash",
        hooks: [{ type: "command", command: `${shq(process.execPath)} ${shq(hook)} ${payload}` }],
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
  };
}

export const anthropicAgentEngine = {
  name: "anthropic-agent",
  // #954 — WHAT THIS ENGINE GUARANTEES ABOUT SEAT WRITES, said out loud in the run record.
  // `deny-authority-write.mjs` is a `claude -p` PreToolUse hook, so it refuses a seat's writes into the
  // doctrine tree, the profile store and `<runDir>/_driver/` at the moment of the write. That is a real
  // boundary and this engine has it.
  writeBoundary: "enforced",
  async runTurn({ message, model, thinking, timeoutSec, resumeRef, mcpConfig, allowedTools, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, seatWrites = null, stallSec, progressFiles } = {}) {
    if (!message) throw new Error("anthropic-agent.runTurn: message is required");
    const { args, input, grantNote } = buildClaudeArgs({ message, model, thinking, resumeRef, mcpConfig, allowedTools, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, seatWrites });
    // #1022 — the cross-check speaks. Driver stderr is what an operator reads, and it is where the other
    // drift notices in this engine already land ([ledger], [env-aliases], [queue-watch]).
    if (grantNote) process.stderr.write(`${grantNote}\n`);
    const t0 = Date.now();
    // Per-stage stall override: a heavy stage (synthesis/register-digest) can legitimately go quiet for
    // minutes of thinking, so it sets its own stallSec; light stages fall back to the global CLEAROTRON_STALL_MS
    // (default 120s) so a real wedge still trips fast. Clamp NaN/≤0 → global so a misconfig never disables it.
    const STALL = (Number(stallSec) > 0 ? Number(stallSec) * 1000 : stallMs());
    const NOPROG = noProgressMs(STALL);   // the honest-progress ceiling (see noProgressMs) — ≥ STALL by construction unless pinned for tests
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
      let child;
      // Spawn from a cwd that is NOT the driver's repo dir: stages use absolute paths, so cwd is a
      // CLAUDE.md-discovery and trust surface. The driver runs under a checkout that HAS a CLAUDE.md, and
      // inheriting that would load the dev-assistant instructions into every stage (context pollution +
      // cost). It also avoids the EACCES when the inherited cwd is unreadable by the runner's user.
      //
      // #524 — cwd is a granted WRITE root here (file tools are confined to cwd + --add-dir), so it is
      // the run dir when there is one. See resolveSpawnCwd in common.mjs for why, and for what it deletes.
      const spawnCwd = resolveSpawnCwd({ cwd, runDir });
      // stdin is a PIPE (not "ignore"): the prompt rides stdin, not a `-p` argv element, so it is never
      // subject to the 128 KB MAX_ARG_STRLEN ceiling (the E2BIG that killed the register-unit sweep).
      // detached:true (C2): claude spawns its MCP servers as CHILDREN (gather-config), and killing only
      // the direct pid orphaned them for days (a bridge.mjs --server legaldatahunter orphan, PPID 1, ran
      // 3.5 days — still holding its upstream transport, still able to bill and race *-band.json writes).
      // Detached makes claude its own process-group leader, so the watchdog's kills reach the whole tree.
      try { child = spawn(claudeBin(), args, { stdio: ["pipe", "pipe", "pipe"], cwd: spawnCwd, env: spawnEnv(), detached: true }); }
      catch (e) { return resolve(errResult(t0, e, resumeRef)); }
      // tracker issue 2076 — THE SECOND SPAWN PATH, and it has to record too. This engine does not go
      // through runStreamingChild; wiring one and assuming the other follows is the exact defect shape
      // 2122 was raised on the same day (the demo banner reached the clearance renderer and not the
      // knockout one). Best effort, never fatal.
      recordEngineChild(runDir, child.pid);
      // Feed the prompt on stdin then EOF — claude reads it and starts (replaces the old `</dev/null`
      // "avoid the 3s stdin wait"). Ignore EPIPE if the child already died (its close/error path settles).
      child.stdin.on("error", () => {});
      try { child.stdin.write(input); child.stdin.end(); } catch { /* child gone — handled by close/error */ }
      let buf = "", stderr = "", resultEvent = null, killed = false, stallKill = false, settled = false;
      let noProgressKill = false;               // the no-progress ceiling fired (a stall discriminator, see noProgressMs)
      let overflow = false;                     // A3: stdout/stderr exceeded maxBuffer — force a nonzero fail, never parse the truncated tail
      const maxBuffer = engineMaxBufferChars();
      let lastMove = Date.now();
      let lastProgress = Date.now();            // honest-progress clock: token movement / agent-loop steps / artifact writes ONLY
      let firstOutputAt = null;                 // #1692/#1813 — first byte of the PROTOCOL (stdout only); until then every clock below is timing STARTUP
      const GRACE = spawnGraceMs();             // one source of the grace: common.mjs, where #1703 set it
      let sawAnyEvent = false;                  // ANY parseable stream event (incl. system:init) — false on close = the CLI died before streaming (startup-class failure)
      let rateLimitEvent = null;   // a 429 session-cap rejection rides a `rate_limit_event` (status:"rejected" + resetsAt)
      // Streamed-usage accumulator: what the turn PROVABLY moved, observed from the stream itself, so a
      // killed turn is never journalled as usage:null when millions of tokens moved (the "137 + usage:null
      // ⇒ mislabelled transient/lane-wedge" class). Per completed API call the `assistant` event's usage is
      // authoritative (summed); an in-flight call contributes its `message_start` usage + the latest
      // `message_delta` output count until its own assistant event supersedes them (no double count).
      const streamTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let pendingStart = null, pendingDeltaOut = 0;
      const streamedUsage = () => {
        const p = mapUsage(pendingStart) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const u = {
          input: streamTotals.input + p.input,
          output: streamTotals.output + p.output + pendingDeltaOut,
          cacheRead: streamTotals.cacheRead + p.cacheRead,
          cacheWrite: streamTotals.cacheWrite + p.cacheWrite,
        };
        u.total = u.input + u.output + u.cacheRead + u.cacheWrite;
        return u.total > 0 ? u : null;   // zero observed movement stays null — a never-admitted turn must keep classifying as a lane wedge
      };
      const progress = () => { lastProgress = Date.now(); };
      // THINKING GAUGE: did extended thinking actually engage on this turn? The stage tier ("high"/"low"/…)
      // only says what we ASKED for — `--effort` is a disposition, not a guarantee (a probe at --effort high
      // on a trivial prompt produced no thinking block at all). Nothing else records the answer: there is NO
      // reasoning-token count anywhere in the claude payload (not result.usage, not usage.iterations), so
      // thinking spend is unrecoverable and only the yes/no is observable.
      //
      // Judge on BLOCK PRESENCE + signature, NEVER on the block's text. `thinking.display` defaults to
      // "omitted" on Opus 5, so an ENGAGED block streams with a zero-length `thinking` string and a real
      // `signature` — reading the text would report "no thinking" on every production turn.
      let thought = false;
      // MODEL GAUGE (#238 corruption 3): which model the PROVIDER says served this turn. Until now
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
      let wireModelInit = null, wireModelAssistant = null;
      // READS GAUGE (AD-4, 2026-07-30 addendum): which files this turn actually OPENED, from the stream's
      // completed Read tool_use blocks. The stage prompt OFFERS a set of documents (declared inputs +
      // skill refs); nothing recorded whether the turn could and did read them — and one review
      // found a stage that "largely COULD NOT read" its deciding docs, a fact that had to be
      // reconstructed forensically. Same posture as the thinking gauge: presence-only observation (the
      // tool_use block's file_path), never the content; the tuple carries `reads` UNCONDITIONALLY — an
      // empty array is the recorded fact "this turn read no files", distinct from an adapter that cannot
      // observe reads at all (no `reads` key → journalled as null by the gateway).
      const reads = new Set();
      // …and the CAP is itself recorded. The set stops growing at READS_CAP; without a flag a capped list
      // reads as a complete one — "these are the files the turn opened" when it means "these are the first
      // 500". `readsTruncated` is the same three-valued discipline the gauge itself carries: false = the
      // list is everything observed, true = at least one further distinct path was dropped at the cap.
      // (A repeat of an already-recorded path is NOT truncation — nothing is lost.)
      const READS_CAP = 500;
      let readsTruncated = false;
      // ── #1111 — THE TWO NUMBERS THAT MAKE A SLOW TURN A DIAGNOSIS RATHER THAN AN INFERENCE ────────
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
      let toolCalls = 0;
      let toolWaitMs = 0;
      let toolAskedAt = null;
      // #1111 — WHAT THE WAIT IS MADE OF, keyed by the tool(s) that caused it.
      //
      // The total alone cannot answer the question it was collected for. "Exclude tool wait from the kill
      // clock because a turn waiting on a tool is the harness working" is TRUE of `register_execute_plan`
      // and FALSE of the perplexity tools, which dispatch to a MODEL — that wait is another model
      // generating, and treating it as free time would leave a hung sub-model bounded by nothing.
      //
      // One interval, ONE KEY: when a message asks for several tools it waits once, so the key is the
      // sorted set joined by "+". Every millisecond is attributed exactly once and the values sum to
      // `toolWaitMs` — a per-name split would double-count a concurrent ask and quietly break that identity.
      let toolAskedNames = null;
      // tracker issue 1828 — WHICH CHUNK an ask arrived in. Every line in one stdout chunk is parsed in
      // one synchronous loop, so they all share a single Date.now(). If an ask and its result land in
      // the SAME chunk, the parent was not running between them and the gap it measures is 0 — for a
      // wait that really happened. Reproduced deterministically by blocking this process's event loop:
      // a turn that waited 260ms reported 0, with toolCalls still correct at 3.
      //
      // The discriminator is DELIVERY, not value. A genuine zero-millisecond wait is measurable and
      // real (two chunks, no gap); keying on `spent === 0` would flag those and miss a stall that
      // happened to leave 1ms on the clock.
      let toolAskedChunk = null;
      // tracker issue 1828 (the LATENT half, not the stall) — ONE OUTSTANDING ASK WAS ALL THIS COULD
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
      const openAsks = [];             // ask records still outstanding, oldest first
      const askById = new Map();       // tool_use_id → its ask record
      let periodStart = null;          // when the current outstanding-SET period began
      let periodChunk = null;          // the chunk it began in — tracker issue 1828's unmeasurable flag
      let anonSeq = 0;                 // ids are on the wire, but never assume: synthesize if absent
      const periodKey = () =>
        [...new Set(openAsks.flatMap((r) => r.names))].sort().join("+");
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
      const closePeriod = (now, onResult) => {
        if (periodStart === null || openAsks.length === 0) return;
        const k = periodKey() || "?";
        const spent = Math.max(0, now - periodStart);
        if (spent > 0) {
          toolWaitMs += spent;
          toolWaitByTool[k] = (toolWaitByTool[k] ?? 0) + spent;
        }
        if (periodChunk === chunkSeq) {
          unmeasurable.push({ tool: k, chunk: chunkSeq, bytes: chunkBytes, sincePrevChunkMs: chunkGapMs,
            cause: onResult ? "result-in-ask-chunk" : "ask-superseded-in-chunk" });
        }
      };
      // `settledToolWaitMs` adds `endedAt - toolAskedAt` as the gap still open when a kill landed. It
      // must therefore track the CURRENT UNCREDITED PERIOD — earlier periods are already in the total,
      // and handing it an older timestamp would count them twice, inflating the total and deflating
      // `activeMs` on exactly the killed-mid-tool turn the field exists for.
      const syncOpenAsk = () => {
        toolAskedAt = openAsks.length ? periodStart : null;
        toolAskedNames = openAsks.length ? periodKey() : null;
        toolAskedChunk = openAsks.length ? periodChunk : null;
      };
      let chunkSeq = 0, chunkBytes = 0, chunkGapMs = 0, prevChunkAt = null;
      const unmeasurable = [];
      const toolWaitByTool = Object.create(null);
      // Parse ONE NDJSON line. The result event may arrive as the FINAL line with NO trailing newline
      // (NDJSON uses newline as separator, not terminator) — the close handler flushes `buf` through here
      // so the result is never dropped (B1: a dropped result mislabels a clean success as a hard failure).
      // Progress semantics: token-bearing events (assistant / message_start / message_delta), content deltas
      // (output tokens being generated) and completed agent-loop steps (user = a tool result landed) reset
      // the progress clock; system/init/ping chatter and unparseable partials reset ONLY the byte clock.
      const parseLine = (line) => {
        line = line.trim(); if (!line) return;
        let ev;
        try { ev = JSON.parse(line); } catch { return; /* partial/non-json line */ }
        sawAnyEvent = true;
        if (ev.type === "result") resultEvent = ev;
        else if (ev.type === "rate_limit_event") rateLimitEvent = ev;
        else if (ev.type === "system" && ev.subtype === "init") {
          // MODEL GAUGE — the session's configured model, the earliest wire statement of what will run.
          if (typeof ev.model === "string" && ev.model) wireModelInit ??= ev.model;
        }
        else if (ev.type === "assistant") {
          // MODEL GAUGE — the model that served THIS API call. Authoritative over init (see above).
          if (typeof ev.message?.model === "string" && ev.message.model) wireModelAssistant = ev.message.model;
          // THINKING GAUGE — block presence + signature, never the text (display defaults to "omitted",
          // so an engaged block carries a zero-length `thinking` string). See the declaration above.
          if (!thought && ev.message?.content?.some?.((b) => b?.type === "thinking")) thought = true;
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
            if (b?.type === "tool_use") toolCalls++;   // #1111 — every tool, not only Read; a COUNT, never a name
            if (b?.type === "tool_use" && b?.name === "Read" && typeof b?.input?.file_path === "string") {
              if (reads.size < READS_CAP) reads.add(b.input.file_path);
              else if (!reads.has(b.input.file_path)) readsTruncated = true;   // a DISTINCT path was dropped
            }
          }
          // The clock starts only if this message actually asked for a tool; an assistant message that
          // asked for none leaves it null, so ordinary generation is never counted as a wait.
          const askBlocks = (Array.isArray(ev.message?.content) ? ev.message.content : [])
            .filter((b) => b?.type === "tool_use");
          const asked = askBlocks.map((b) => String(b?.name ?? "?"));
          toolAskedAt = asked.length ? Date.now() : null;
          toolAskedChunk = asked.length ? chunkSeq : null;   // tracker issue 1828
          toolAskedNames = asked.length ? [...new Set(asked)].sort().join("+") : null;
          if (asked.length) {
            const now = Date.now();
            closePeriod(now, false);          // the outstanding set is about to change
            const rec = { names: asked.slice() };
            openAsks.push(rec);
            for (const b of askBlocks) {
              const id = b?.id == null ? `__anon_${anonSeq++}` : String(b.id);
              askById.set(id, rec);
            }
            periodStart = now; periodChunk = chunkSeq;
          }
          syncOpenAsk();
          const u = mapUsage(ev.message?.usage);
          if (u) { streamTotals.input += u.input; streamTotals.output += u.output; streamTotals.cacheRead += u.cacheRead; streamTotals.cacheWrite += u.cacheWrite; }
          pendingStart = null; pendingDeltaOut = 0;   // this call's usage is now authoritative — drop its partials
          progress();
        }
        else if (ev.type === "user") {
          // #1111 — the result of the ask above. Only counted when an ask is outstanding, so a `user`
          // event with no preceding tool_use adds nothing rather than charging the turn for a gap it
          // never spent waiting.
          // Which ask is this the result OF? The id on the wire answers it. Falling back to the
          // OLDEST outstanding ask keeps a stream that carries no id working exactly as before, rather
          // than dropping the interval and quietly under-reporting the turn.
          const named = (Array.isArray(ev.message?.content) ? ev.message.content : [])
            .filter((b) => b?.type === "tool_result")
            .map((b) => (b?.tool_use_id == null ? null : askById.get(String(b.tool_use_id))))
            .filter((r) => r && openAsks.includes(r));
          const leaving = named.length
            ? [...new Set(named)]
            : (openAsks.length ? [openAsks[0]] : []);
          if (leaving.length) {
            const now = Date.now();
            closePeriod(now, true);
            for (const rec of leaving) {
              const i = openAsks.indexOf(rec);
              if (i >= 0) openAsks.splice(i, 1);
            }
            periodStart = openAsks.length ? now : null;
            periodChunk = openAsks.length ? chunkSeq : null;
          }
          syncOpenAsk();
          progress();      // a completed tool result = the agent loop advanced
        }
        else if (ev.type === "stream_event") {
          const t = ev.event?.type;
          if (t === "message_start") { pendingStart = ev.event.message?.usage ?? null; progress(); }
          else if (t === "message_delta") { const o = Number(ev.event?.usage?.output_tokens); if (o > 0) pendingDeltaOut = o; progress(); }
          else if (t === "content_block_delta" || t === "content_block_start") progress();
          // THINKING GAUGE (partials): the earliest tells. Any one is sufficient; belt-and-braces so a
          // display-mode or CLI-version change cannot silently blind the gauge.
          if (!thought) {
            const e = ev.event;
            if (e?.content_block?.type === "thinking"
              || e?.delta?.type === "thinking_delta" || e?.delta?.type === "signature_delta") thought = true;
          }
        }
      };
      // Group kill (C2): SIGTERM the whole process group, then group SIGKILL after the escalation grace.
      // ESRCH/EPERM (group already gone / not ours) falls back to the direct child.kill. The escalation
      // timer is unref'd but NOT cleared on close — the direct child exiting on the SIGTERM must not save
      // a SIGTERM-immune MCP straggler from the group SIGKILL. Caveat: the group kill reaps MCP children
      // only while claude does not setpgid them itself — post-deploy verification item.
      let escalation = null;
      const groupKill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* already gone */ } } };
      const killTree = () => {
        if (escalation) return;   // the watchdog polls — arm the escalation exactly once
        groupKill("SIGTERM");
        escalation = setTimeout(() => groupKill("SIGKILL"), killEscalateMs());
        escalation.unref?.();
      };
      // Artifact-advance watch: an observed write to the stage's own expected output file(s) is the third
      // honest progress signal (a long single Write of the final artifact may follow minutes of quiet tool
      // work). A couple of statSync calls per ≤1s tick — negligible.
      const artifactSeen = new Map();   // path → "mtimeMs:size" last observed
      const artifactProgress = () => {
        for (const f of progressFiles ?? []) {
          let sig = null;
          try { const s = statSync(f); sig = `${s.mtimeMs}:${s.size}`; } catch { /* not written yet */ }
          if (sig !== null && artifactSeen.get(f) !== sig) { artifactSeen.set(f, sig); progress(); }
        }
      };
      const watchdog = setInterval(() => {
        artifactProgress();
        const now = Date.now();
        // #1780 — THE STARTUP DEBT. #1692 widened the deadline below until the first byte but left this
        // clock's ORIGIN at spawn, so the startup interval stayed on the meter: the moment the grace let
        // go, progIdle already WAS the whole boot, and any NOPROG shorter than startup had expired before
        // the child was observed at all. The kill then landed on the next tick, before the ask could reach
        // toolCalls — a turn recorded as making no progress when nothing had yet had the chance to.
        // Releasing a clock is not starting one: the first byte is this clock's origin, not its green light.
        const progFrom = firstOutputAt === null ? lastProgress : Math.max(lastProgress, firstOutputAt);
        const idle = now - lastMove, progIdle = now - progFrom;
        // ── #1692 — STARTUP IS NEITHER SILENCE NOR WORK ──────────────────────────────────────────────
        // Every clock here USED TO start at SPAWN, so until the child's first byte they were all timing
        // process startup: an idle clock that had not yet seen silence, and an active clock that had not
        // yet seen work. Past tense deliberately — #1780 finished this, and the sentence stayed true of
        // the byte-stall below (`lastMove`) while being false of the progress clock above, which is
        // precisely the gap that let the defect sit here for a day looking like ambient flake. #1703 established this for the byte-stall in common.mjs — which this engine does not use,
        // because it spawns its own child, so that fix never reached this watchdog. Under full-suite load
        // a starved spawn crossed a 400ms test ceiling before the mock had emitted anything, and the kill
        // was recorded as a no-progress stall against a turn that had not yet been given a chance to
        // progress. A child that never speaks AT ALL is still bounded: the byte-stall fires at max(STALL, GRACE).
        const started = firstOutputAt !== null;
        if (idle >= (started ? STALL : Math.max(STALL, GRACE))) { stallKill = true; killed = true; killTree(); }
        // No observable progress (tokens/agent-loop/artifact) for NOPROG while bytes kept the pipe warm:
        // kill it NOW, well below the wall, and record it as a STALL — never let the ceiling raise turn
        // into extended stall burn, and never let this kill read as "the stage needed more time".
        else if (progIdle >= (started ? NOPROG : Math.max(NOPROG, GRACE))) { stallKill = true; noProgressKill = true; killed = true; killTree(); }
        // ── #1111 — THE CEILING MEASURES ACTIVE TIME, NOT ELAPSED ────────────────────────────────────
        //
        // Owner ruling: "there isnt such thing as a hung model. it always delivers something or fails."
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
        // #1692: measured from the FIRST BYTE, never from spawn. Startup is not active time either, and
        // against a tight pin it was the whole budget — a 900ms spawn hit a 500ms ceiling having done
        // nothing at all, and the turn died carrying `hardWall` with zero tool calls to explain it.
        else if (started && activeElapsedMs({ wall: now - firstOutputAt, toolWaitMs, toolAskedAt, now }) >= hardMs) {
          killed = true; killTree();
        }
      }, pollMs);
      // A3 (gateway capAppend/finalCode parity): cap stdout AND stderr at maxBuffer. On overflow TRUNCATE
      // at the cap, pull the tree-kill FORWARD (an endless newline-free stream never trips the stall/hard
      // wall — every byte resets the stall clock), and settle nonzero with a clear overflow error so the
      // truncated tail can never parse as a valid result (a partial line would fail JSON anyway → resultEvent
      // stays null → nonzero fail). The group SIGKILL escalation killTree() arms still reaps a spewing tree.
      const overflowKill = () => { if (overflow) return; overflow = true; killTree(); settle(1); };
      child.stdout.on("data", (d) => {
        if (settled || overflow) return;
        if (firstOutputAt === null) firstOutputAt = Date.now();   // #1692 — the child has spoken; startup is over
        chunkSeq += 1;                                            // tracker issue 1828 — see toolAskedChunk
        chunkBytes = d.length;
        chunkGapMs = prevChunkAt === null ? 0 : Date.now() - prevChunkAt;
        prevChunkAt = Date.now();
        lastMove = Date.now();   // ANY streamed byte = liveness → resets the stall clock
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) { parseLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
        if (buf.length > maxBuffer) { buf = buf.slice(0, maxBuffer); overflowKill(); }
      });
      child.stderr.on("data", (d) => {
        if (settled || overflow) return;
        // #1813 — STDERR DOES NOT START THE CLOCKS, and this line used to. This engine's protocol is
        // stream-json on STDOUT; stderr carries node warnings and CLI notices, which a child can emit
        // before it has done anything at all. Treating one as "the child has spoken" ended the grace and
        // — since #1780, which made the first byte the progress clock's ORIGIN — started that clock too,
        // so a turn whose real startup was still running got its no-progress ceiling measured from a
        // deprecation warning. A child that writes ONLY stderr is still bounded: it never starts, so the
        // byte-stall below fires at max(STALL, GRACE) exactly as it does for a silent spawn.
        //
        // The diagnostic follows the same rule deliberately. `firstByteMs=NEVER` now means "never spoke
        // its protocol", which is the question the no-progress specimen is actually asking — a number
        // that came from a stderr line would have answered a different one.
        stderr += d.toString();
        if (stderr.length > maxBuffer) { stderr = stderr.slice(0, maxBuffer); overflowKill(); }
      });
      // error + close can BOTH fire for a single failure (Node) → settle EXACTLY once (no double clearInterval/resolve).
      child.on("error", (e) => { if (settled) return; settled = true; clearInterval(watchdog); resolve(errResult(t0, e, resumeRef)); });
      child.on("close", (code) => settle(code));
      function settle(code) {
        // tracker issue 2076 — the turn is over; the record must not outlive it, and is cleared only if
        // it still names THIS child.
        clearEngineChild(runDir, child?.pid);
        if (settled) return; settled = true;
        clearInterval(watchdog);
        // Reap the pipes: an overflow settle fires while a SIGTERM-immune spewer still holds stdout, so
        // settlement must never wait on a pipe some straggler keeps open (the group SIGKILL reaps the tree).
        try { child.stdout.destroy(); } catch { /* stream gone */ }
        try { child.stderr.destroy(); } catch { /* stream gone */ }
        if (!overflow) { parseLine(buf); }   // B1: flush the final, un-terminated line (the result event) — but NEVER the truncated overflow tail
        buf = "";
        // ONE SAMPLE OF THE CLOCK, and both quantities below are derived from it. Two `Date.now()` calls
        // a few milliseconds apart are enough to break the identity on the very turn it matters for: on a
        // turn that is almost entirely tool wait, an in-flight gap measured LATER than the wall can exceed
        // it, `activeMs` clamps to zero, and the two stop tiling. It surfaced as an intermittent test
        // under suite load — which is what a race looks like from the outside and an instrumentation
        // defect from the inside.
        const endedAt = Date.now();
        const wall = (endedAt - t0) / 1000;
        // #1111 — THE TWO CLOCKS MUST TILE THE WALL, in every case including the one that matters.
        //
        // A turn killed mid-tool-call has an OPEN ask that `toolWaitMs` has not closed. Reporting the
        // unclosed accumulator left `activeMs + toolWaitMs` short of the wall by exactly that gap — and
        // only on turns killed during a call, which is the population #1111 is about. A guard asserting
        // the identity would have held on every ordinary attempt and quietly not held on the interesting
        // one. Closed here, ONCE, so both fields are derived from the same number.
        //
        // `toolWaitByTool` does NOT receive it: the ask has not resolved, so there is no name to charge.
        // That split was already documented as not summing to `toolWaitMs` (a concurrent ask would
        // double-count), so nothing downstream reads it as a partition.
        // CLAMPED TO THE WALL, so the pair tiles it in every case rather than in the common one. A gap
        // that reads longer than the whole turn is a clock artefact, not more waiting than there was time.
        const settledToolWaitMs = Math.min(Math.round(wall * 1000),
          Math.round(toolWaitMs + (toolAskedAt != null ? Math.max(0, endedAt - toolAskedAt) : 0)));
        // usage honesty: the result event is authoritative; a turn that never produced one (killed / died
        // mid-flight) reports what the STREAM proved it moved instead of null — so a stall/wall kill after
        // millions of cacheRead tokens can never be journalled as a 0-token event and mislabelled a lane
        // wedge or a transient-provider fault. Genuinely zero movement stays null (the wedge signature).
        const resultUsage = mapUsage(resultEvent?.usage);
        const streamUsage = resultUsage ? null : streamedUsage();
        const usage = resultUsage ?? streamUsage;
        const json = synthesizeEnvelope({ resultEvent, usage, killed });
        // claude -p can exit 0 even on a failed turn (is_error rides the result envelope). Force a NONZERO
        // code on any failed turn so runStage's ladder catches it via the code!==0 branch (a hard,
        // fallback-eligible failure) rather than the softer status_<s> branch — parity with the retired gateway
        // nonzero_exit shape. (synthesizeEnvelope's status:"error" is belt-and-suspenders behind this.) Success → 0.
        // A3 overflow is likewise a hard failure (resultEvent is null → already caught here; kept explicit).
        const failed = overflow || killed || !resultEvent || resultEvent.is_error || resultEvent.subtype !== "success";
        // stall → make isTimeout fire (killed) AND carry the stall stderr signature the classifier reads, so the
        // taxonomy is identical; a 0-token stall then classifies as lane_wedge and the chain cascades.
        // overflow → carry a clear signature (killed stays false so it is a plain nonzero_exit, NOT a timeout/wedge).
        const stderrOut = overflow
          ? (stderr + `\nanthropic-agent output overflow: stdout/stderr exceeded ${maxBuffer} chars — killed the tree and failed the turn (truncated tail never parsed)`)
          : noProgressKill
            // #1780 — THE SPECIMEN RIDES THE FAILURE, because the broken state expires. This kill has
            // twice reddened `main` from a test whose ANTI-VACUITY check failed — the turn died having
            // opened no tool ask — and neither the box's ambient load nor a full-suite run reproduces
            // it on demand. So the discriminating bit is recorded HERE, where the kill happens, rather
            // than hunted afterwards: `firstByteMs=NEVER` means the child never spoke and the grace
            // was genuinely exceeded (a starved spawn); a NUMBER means it spoke and the ask never
            // reached `toolCalls`, which is a progress-accounting fault and has nothing to do with
            // startup. Those want different fixes and the artifact now says which.
            ? (stderr + `\nrequest timed out (anthropic-agent no-progress watchdog: no token movement / agent-loop step / artifact write for ${Math.round(NOPROG / 1000)}s — a STALL, not a slow turn)`
              + `\nanthropic-agent no-progress specimen: firstByteMs=${firstOutputAt === null ? "NEVER" : Math.round(firstOutputAt - t0)}`
              + ` toolCalls=${toolCalls} noProgressMs=${NOPROG} graceMs=${GRACE}`)
          : stallKill ? (stderr + "\nrequest timed out (anthropic-agent stall-watchdog: 0 streamed tokens)")
          // Startup-class death (the 3× register-digest code=1 zero-token shape): the CLI exited without
          // emitting a single stream event — the failure happened before any turn ran (arg/auth/MCP
          // startup), so the stderr above is the whole story. Name it so the journal's stderrTail is
          // never read as a mid-turn provider fault.
          : (!sawAnyEvent && !killed && resultEvent == null)
            ? (stderr + "\nanthropic-agent: the claude process exited without emitting any stream event — a startup-class failure (args/auth/MCP), not a mid-turn provider fault; the stderr above is the diagnosis")
          : stderr;
        // Rate-limit / session-cap rejection: claude -p emits a rate_limit_event{status:"rejected",resetsAt}
        // plus a result with api_error_status 429. Surface a distinct signal (+ the ISO reset time) so the
        // driver POSTPONES the run to resetsAt rather than running the futile fallback cascade (every tier
        // shares the one subscription). resetsAt is epoch SECONDS on the event -> ISO.
        const rateLimited = resultEvent?.api_error_status === 429 || rateLimitEvent?.rate_limit_info?.status === "rejected";
        const resetsAtRaw = rateLimitEvent?.rate_limit_info?.resetsAt;
        const resetsAt = rateLimited && resetsAtRaw ? new Date(Number(resetsAtRaw) * 1000).toISOString() : undefined;
        resolve({
          code: killed ? 137 : (failed ? (code || 1) : 0),
          killed, wall,
          stdout: typeof resultEvent?.result === "string" ? resultEvent.result : "",
          stderr: stderrOut, laneWaitMs: 0,
          json, usage,
          // READS GAUGE: unconditional, like signals.thought — [] is the recorded fact "read nothing".
          // readsTruncated rides beside it, also unconditional: false = the list is complete as observed,
          // true = the 500-path cap dropped at least one further distinct file (so a `read:false` derived
          // from this list is unreliable and the consumer must downgrade it to "not observed").
          reads: [...reads], readsTruncated,
          toolCalls, toolWaitMs: settledToolWaitMs,   // #1111 — two integers, no content
          // #1780 — ms from spawn to the child's FIRST byte, or null when it never spoke. RECORDING
          // ONLY: nothing branches on it. A recording field is protected by a test or by nothing, so
          // engine.anthropic.test.mjs pins it — deleting it must red something.
          firstByteMs: firstOutputAt === null ? null : Math.round(firstOutputAt - t0),
          // #1111 — WHICH CLOCK RAN OUT, and WHAT the wait was made of.
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
          toolWaitByTool: { ...toolWaitByTool },
          // tracker issue 1828 — the asks whose wait this process COULD NOT MEASURE, because the ask and
          // its result were delivered in one chunk. An ARRAY is a measurement (possibly `[]`: measured,
          // nothing unmeasurable), following toolWaitByTool's own rule that absence and "cannot report"
          // must not look alike. `toolWaitMs` and the per-tool split are untouched.
          toolWaitUnmeasurable: [...unmeasurable],
          // MODEL GAUGE (#238): the id the WIRE reported, or null when the stream never said. Assistant
          // message first (what served the call), init second (what the session was configured with).
          // Never the requested alias — see the declaration above.
          modelWire: wireModelAssistant ?? wireModelInit ?? null,
          sessionRef: resultEvent?.session_id ?? resumeRef ?? null,
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
          signals: { stalled: stallKill || undefined, noProgress: noProgressKill || undefined,
            hardWall: (killed && !stallKill) || undefined, rateLimited: rateLimited || undefined, resetsAt,
            usageStreamed: (streamUsage != null) || undefined,
            noStreamEvents: (!sawAnyEvent && resultEvent == null) || undefined,
            // thought: UNCONDITIONAL boolean — deliberately NOT `|| undefined` like every sibling here. The
            // whole point of the gauge is that "did not think" stays distinguishable from "this record
            // predates the gauge"; an omitted key would recreate exactly the ambiguity that made the old
            // reasoningTokens slot useless. false must be recorded AS false.
            thought },
        });
      }
    });
  },
};

function errResult(t0, e, resumeRef) {
  return {
    code: 1, killed: false, wall: (Date.now() - t0) / 1000, stdout: "",
    stderr: `anthropic-agent spawn error: ${e?.message ?? e}`, laneWaitMs: 0,
    // reads: a spawn error means NO turn ran — [] is the true observation (nothing was read), not a gap.
    // modelWire: null for the opposite reason — no turn ran, so the wire said nothing about a model, and
    // the record must say UNKNOWN rather than inherit the alias that was asked for (#238).
    json: null, usage: null, reads: [], readsTruncated: false, modelWire: null, sessionRef: resumeRef ?? null,
  };
}
