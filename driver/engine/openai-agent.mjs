// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/openai-agent.mjs — the `openai-agent` engine: runs one stage turn as a standalone `codex exec`
// process (OFF any agent gateway), with the SAME streaming stall-watchdog + detached-group-kill the
// anthropic engine uses (both share engine/common.mjs). It is the driver's SECOND provider adapter — the
// proof that CLEAROTRON_AI can switch back-end providers. `runTurn()` returns the driver's normalized
// tuple (engine/CONTRACT.md §1) with a synthesized `json` envelope in the classifier's shape, so every downstream
// classifier in gateway.mjs (payloadText, json.status, isTimeout, isLaneWedge, isOverloaded) works
// UNCHANGED. Single-provider, like the anthropic engine: one run's stages all execute as GPT, so the
// telemetry's model provenance is honest without any cross-provider bookkeeping.
//
// LIVE-UNVERIFIED (grounded in the codex docs + flag corpus, 2026-07; confirmed by the credentialed W5
// run, not on this box): the exact `--json` event stream is pinned from the published schema —
//   {"type":"thread.started","thread_id":…}                    → sessionRef (resume handle)
//   {"type":"turn.completed","usage":{input_tokens,cached_input_tokens,output_tokens}}  → Usage
//   {"type":"item.completed","item":{"type":"agent_message","text":…}}                  → payload text
//   {"type":"turn.failed","error":{"message":…}} / {"type":"error","message":…}         → failure
// Invocation is pinned from the flag corpus: prompt on STDIN via the `-` placeholder, `--json`,
// `--skip-git-repo-check` (neutral non-repo cwd), `--sandbox workspace-write --add-dir <runDir>` for the
// stage output, `-m <model>`, `-c model_reasoning_effort=<effort>`, and a per-run `CODEX_HOME` holding a
// rendered config.toml (mcp_servers + developer_instructions) + (subscription) a seeded auth.json.
// CLEAROTRON_CODEX_SANDBOX_BYPASS=1 swaps that `--sandbox workspace-write` for
// `--dangerously-bypass-approvals-and-sandbox` — see buildCodexArgs below for why.

import { mkdtempSync, writeFileSync, copyFileSync, existsSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runStreamingChild, absolutizeSkillRefs, WRITE_DISCIPLINE, buildEnvelope, resolveSpawnCwd } from "./common.mjs";
import { renderCodexConfigToml } from "./mcp/codex-config.mjs";
import { resolveAuthMode } from "./auth.mjs";
import { envFrom } from "../../shared/env-aliases.mjs";   // — advice names the name in force

const codexBin = () => envFrom(process.env, "CLEAROTRON_CODEX_PATH") || "codex";

// tier/alias → codex `-m` model id. opus/sonnet/haiku are the driver's abstract tiers (CONTRACT §3). The
// GPT ids are ENV-OVERRIDABLE and default to three DISTINCT rungs of the codex ladder — `gpt-5.6-sol`,
// `gpt-5.6-terra`, `gpt-5.6-luna`, all present in the codex CLI as installed — so an out-of-the-box run
// uses REAL, current ids rather than invented guesses, and a stage's declared tier means the same thing
// on both engines. `sol` remains what codex itself reports as its own default (live-probed 2026-07-27:
// `model: gpt-5.6-sol, provider: openai`), which is why the judgment tier keeps it.
//
// ── THE THREE TIERS MAP ONTO THE CODEX LADDER (owner ruling 2026-09-02,) ──────────────────────────
//
// Every stage declares a tier — opus / sonnet / haiku — engine-independently. The anthropic engine
// resolves those three declarations onto three models. Until this ruling codex resolved ALL THREE onto
// `gpt-5.6-sol`, so a stage that had declared itself cheap ran top-tier anyway and the declaration
// meant nothing on this engine. Aligning them is the whole change: two string defaults.
//
// The owner's words, deciding it without a prior experiment: *"august 11 was long ago and we changed a
// lot since then. I dont want to re-run an experiment. this is just failing as is."*
//
// ── WHAT MEASURED, WHICH IS STILL TRUE OF THE DAY IT WAS MEASURED ───────────────────────────
//
// is closed and released, and its measurement is NOT withdrawn: on 2026-08-11/12, with
// SWEEP=terra / CHEAP=luna, every codex clearance died on structural-output gates —
// `missing:negative-results`, `no_coverage_status_row`, `named_band_missing` — across 2 scenarios ×
// 3 stage families, and BYTE-IDENTICALLY on retry. That was true of that code and that CLI.
//
// What has changed is not the measurement but everything around it: three weeks of stage-contract
// work, and a codex CLI that has moved several minor versions. The ruling above supersedes 's
// conclusion; it does not erase its evidence. A reader who finds first must be able to get here.
//
// ── HOW A REGRESSION ANNOUNCES ITSELF — no experiment is scheduled, and none is needed ────────────
//
// If the cheaper tiers cannot hold the contracts, the SAME three gates fire, at the stage that
// produced the bad output rather than at delivery, landing as a `fail` row in `_driver/<stage>.jsonl`.
// The first sonnet- and haiku-declared stages in a clearance are reached within the first few
// dispatches, so the next codex clearance reports the answer early and cheaply.
//
// Stages that would report first: the `register-unit` sweeps (sonnet/adaptive — the bulk of the
// register work), then `common-law` and the `common-law-half` seats (haiku/low).
//
// Byte-identical retry remains the tell if it does happen: a model that is INCAPABLE of a contract is
// not flaky at it, so no retry budget and no temperature reaches it, and the failure surfaces as a
// STAGE GATE — it reads as an engine bug on a run whose only fault is its configuration.
//
// A deliberate change to these three is a diff to the constants below, where a reviewer sees it —
// never an env line on a box that nobody can trace to an author.
//
// corruption 3 — THE CROSS-PROVIDER SUBSTITUTIONS ARE GONE HERE TOO. `gemini`, `gemini-flash`,
// `deepseek-v4-pro`, `azure` and `fable` used to map onto a GPT tier and were documented as "explicit
// substitution, GRADE-MOVING, A/B-only". They are dead aliases now (the failover chain went in and
// both stages that named them declare an anthropic tier in the defs), and an unhonoured override that
// runs SOMETHING is worse than one that refuses: the arm still produces a number and the number is a
// story. They fall through to the throw below, which is where they always should have been. Concrete
// gpt-*/o* ids still pass through.
const JUDGMENT = process.env.CLEAROTRON_OPENAI_MODEL_JUDGMENT || "gpt-5.6-sol";     // opus   — unchanged
const SWEEP    = process.env.CLEAROTRON_OPENAI_MODEL_SWEEP    || "gpt-5.6-terra";   // sonnet — was sol
const CHEAP    = process.env.CLEAROTRON_OPENAI_MODEL_CHEAP    || "gpt-5.6-luna";    // haiku  — was sol
const OPENAI_MODEL = { opus: JUDGMENT, sonnet: SWEEP, haiku: CHEAP };
export function openaiModel(model) {
  if (!model) return undefined;
  if (OPENAI_MODEL[model]) return OPENAI_MODEL[model];
  if (/^(gpt-|o\d|openai\/)/i.test(model)) return model;           // explicit concrete id → passthrough
  throw new Error(`openai-agent: no GPT tier mapped for model "${model}" — set CLEAROTRON_OPENAI_MODEL_* or pass a concrete gpt-*/o* id.`);
}

// ── thinking tier → codex `model_reasoning_effort` ───────────────────────────────────────────────────
// codex vocabulary: minimal | low | medium | high | xhigh (its own default is xhigh).
//
// corruption 4a — `off` NO LONGER MEANS TWO THINGS. It mapped to `minimal` here and to `low` on the
// anthropic engine, so at the bottom of the ladder the two engines sat a whole rung apart: on codex
// `off` and `low` were different levels, on claude they were the same one, and any cross-engine effort
// comparison at `off` was off by one with nothing on the record to say so. `low` is the anthropic floor
// (claude 2.1.193 `--effort` takes low|medium|high|xhigh|max — there is no rung beneath `low`), so the
// only alignment available is codex coming UP. `minimal` is therefore unreachable from the driver's
// tier vocabulary; that is deliberate and cheaper than a tier that means two things.
//
// `max` is the one deliberate divergence: it means "this engine's top rung", `xhigh` here and `max` on
// claude, because codex has no `max`. engine.anthropic.test.mjs pins the tables together and asserts
// that single exception, so the two cannot drift generally. No stage uses `max` today.
const EFFORT = { off: "low", low: "low", medium: "medium", adaptive: "medium", high: "high", max: "xhigh" };
export function effortFor(thinking) { return EFFORT[thinking] ?? "medium"; }
export const EFFORT_TABLE = { ...EFFORT };

// canonical Usage (CONTRACT §2). OpenAI's `input_tokens` INCLUDES the cached hits (`cached_input_tokens`
// is a subset), so subtract to avoid double-counting.
//
// — CODEX DOES REPORT A CACHE-CREATION BUCKET, and this said it did not. The comment here claimed
// "codex reports no separate cache-CREATION bucket" and the return hardcoded `cacheWrite: 0`. A live
// `turn.completed` from codex-cli 0.147.0 carries the field:
//
//   {"input_tokens":13580,"cached_input_tokens":11008,"cache_write_input_tokens":0,
//    "output_tokens":5,"reasoning_output_tokens":0}
//
// So the rollup recorded a hardcoded zero where a real number belongs. This is the shape again —
// a value re-derived (here: asserted) instead of read from the point that knows it — and it biases the
// codex arm's spend DOWNWARD against the anthropic arm's, which is exactly the comparison the round is
// being run to make. Magnitude on a real stage turn is still unmeasured: both fields were 0 on the
// one-token probe above, so this fixes the mapping, not the measurement.
//
// `reasoning_output_tokens` is DELIBERATELY NOT MAPPED, and the reason belongs on the record rather than
// in a future reader's guess. `tokens.mjs` carries no reasoning field at all: the anthropic side has no
// equivalent count, so a slot that is permanently 0 on one engine reads as "no thinking engaged" rather
// than "not reported", which is an absence presenting as a finding — the class this codebase keeps
// paying for. Mapping it needs a canonical-Usage change that says what the field means when an engine
// cannot produce it, and that is a contract decision, not a mapping fix. It stays unread here until then.
// Related and still open: `signals.thought` is null on this adapter because codex's reasoning-event
// vocabulary was never probed, and `reasoning_output_tokens > 0` may be the honest answer to it.
export function mapUsage(u) {
  if (!u) return null;
  const cacheRead = u.cached_input_tokens || 0;
  const inputTotal = u.input_tokens || 0;
  const output = u.output_tokens || 0;
  const input = Math.max(0, inputTotal - cacheRead);
  // NOT folded into `total`, and the reason is a known-unknown rather than a decision. `total` is
  // `inputTotal + output` by CONTRACT §2 on both engines. Whether codex's cache-creation tokens sit
  // INSIDE `input_tokens` (as `cached_input_tokens` demonstrably does) or beside it cannot be settled
  // from the only probe we have — both were 0 on it. Adding it would double-count if they are inside;
  // leaving it out undercounts if they are beside. Leaving `total` on the existing formula is the
  // change-nothing option, so the fix here is confined to surfacing the field that was hardcoded away.
  // TO SETTLE IT: one real stage turn with a non-zero `cache_write_input_tokens` — check whether
  // `input_tokens >= cached_input_tokens + cache_write_input_tokens`. That is a round's observation.
  const cacheWrite = u.cache_write_input_tokens || 0;
  return { input, output, cacheRead, cacheWrite, total: inputTotal + output };
}

// Apply the billing-mode (auth) toggle to the child env + point CODEX_HOME at the per-run dir. api-key:
// keep CODEX_API_KEY (the override codex honors over stored creds). subscription: STRIP the keys so codex
// uses the seeded auth.json (a present key would override it). resolveAuthMode throws loud if api-key mode
// has no key (W3). Returns { env, mode }.
export function spawnEnv(base = process.env, codexHome) {
  const { mode } = resolveAuthMode({ engineName: "openai-agent", env: base });
  const env = { ...base };
  if (codexHome) env.CODEX_HOME = codexHome;
  if (mode === "api-key") {
    // keep CODEX_API_KEY; do not seed an auth.json
  } else {
    delete env.CODEX_API_KEY;
    delete env.OPENAI_API_KEY;   // codex deprioritizes it when stored creds exist, but strip for a clean subscription bill
  }
  return { env, mode };
}

const authFilePath = (env = process.env) => env.CLEAROTRON_OPENAI_AUTH_FILE || join(homedir(), ".codex", "auth.json");

// Build the codex argv. Prompt rides STDIN via the `-` placeholder (no MAX_ARG_STRLEN ceiling on a 150KB
// register prompt). Global flags precede the `resume` subcommand (flag-corpus ordering). config.toml
// (mcp_servers + developer_instructions) rides CODEX_HOME, not argv.
//
// CLEAROTRON_CODEX_SANDBOX_BYPASS=1 (default off) swaps `--sandbox workspace-write` for
// `--dangerously-bypass-approvals-and-sandbox`, so codex runs shell commands directly under the invoking
// account's own OS-level permissions instead of building its own internal jail first — the same trust
// model anthropic-agent already runs under (claude -p has no equivalent internal sandbox layer). Exists
// because on at least one host, codex's internal sandbox helper cannot spawn AT ALL — every exec_command
// tool call (reading a skill file, writing a stage's output) fails before doing anything, and the only
// engine-visible symptom is the stage's output file never appearing (`missing_file` on an otherwise
// `status:"ok"` attempt that consumed real tokens). Confirmed independent of file/directory permissions
// on that host — a kernel/container sandboxing primitive codex's helper needs is unavailable there. Kept
// OFF by default: a host where codex's own sandbox works keeps that as a genuine second safety layer: an
// unconditional flip here would remove it everywhere, including hosts that never had this problem.
export function buildCodexArgs({ model, thinking, resumeRef, runDir } = {}) {
  const bypassSandbox = String(process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS || "") === "1";
  const base = ["exec", "--json", "--skip-git-repo-check",
    ...(bypassSandbox ? ["--dangerously-bypass-approvals-and-sandbox"] : ["--sandbox", "workspace-write"])];
  if (runDir) base.push("--add-dir", runDir);                     // writable root for the stage's absolute output path
  const m = openaiModel(model); if (m) base.push("-m", m);
  base.push("-c", `model_reasoning_effort=${effortFor(thinking)}`);
  if (resumeRef) return { args: [...base, "resume", resumeRef, "-"] };
  return { args: [...base, "-"] };
}

// Fold ONE codex --json line into the running event accumulator.
export function parseCodexEvent(line, ev) {
  let e; try { e = JSON.parse(line); } catch { return; }
  // MODEL GAUGE ( corruption 3) — OPPORTUNISTIC on the stream, and its answer here is "nothing".
  //
  // MEASURED, not inferred (codex-cli 0.147.0, this box, 2026-08-11): `codex exec --json` emits exactly
  // thread.started / turn.started / item.completed / turn.completed, none of them carrying a model
  // field, and stderr is empty. So the STREAM does not state the served model. This line still reads a
  // top-level `model` in case a later codex emits one; `readServedModel` below is where the answer
  // actually comes from. Neither falls back to the requested tier: "actual = what we asked for" is the
  // exact lie the gauge exists to stop.
  if (typeof e?.model === "string" && e.model) ev.model = e.model;
  switch (e?.type) {
    case "thread.started": if (e.thread_id) ev.threadId = e.thread_id; break;
    case "turn.completed": ev.turnCompleted = true; if (e.usage) ev.usage = e.usage; break;
    case "turn.failed":    ev.turnFailed = e.error?.message || "turn.failed"; break;
    case "error":          ev.streamError = e.message || "stream error"; break;
    case "item.completed":
      if (e.item?.type === "agent_message" && typeof e.item.text === "string") ev.agentText = e.item.text;
      noteMcpToolCall(e.item, ev);
      break;
    // ── — AN MCP CALL THAT WAS REFUSED IS NOT A CALL NOBODY MADE ──────────
    //
    // When codex refuses an MCP call, the refusal lives only inside the child's rollout — a temp dir
    // this adapter deletes. The turn exits 0, engineStatus is ok, and the driver recorded
    // `toolCalls: null`, which reads as "made none" rather than "made three and all three were
    // refused".
    //
    // ✕ WHY a call was refused is NOT settled here, and this gauge does not decide it. The universal
    // reading was withdrawn on 1968 — real codex completed 1,292 MCP calls pre-rebuild — and the trace
    // is. What this ends is the recording gap, whatever the cause turns out to be.
    //
    // The stream already carries it. Measured on codex-cli 0.150.1 with a one-tool probe server:
    //   {"type":"mcp_tool_call","server":"probe","tool":"ping","status":"failed",
    //    "error":{"message":"MCP tool call requires approval, but approval policy is never"}}
    //   {"type":"mcp_tool_call","server":"probe","tool":"ping","status":"completed","result":{…}}
    //
    // ITEMS ARRIVE TWICE WITH THE SAME id — `in_progress` on item.started, then a terminal status on
    // item.completed — so they are keyed by id and the terminal state wins. Counting the lines instead
    // would double every call.
    case "item.started":
      noteMcpToolCall(e.item, ev);
      break;
    default: break;
  }
}

/**
 * Fold one `mcp_tool_call` item into the accumulator, keyed by its id so the two lines per call
 * (in_progress, then terminal) count once..
 *
 * THE MESSAGE IS RECORDED, NOT MATCHED. A call refused by the approval policy and a call denied by an
 * automatic reviewer are both `failed` with different text, and telling those apart is exactly what a
 * reader needs — a predicate over the approval wording would collapse them and answer for only the one
 * that existed on the day it was written.
 */
export function noteMcpToolCall(item, ev) {
  if (item?.type !== "mcp_tool_call" || !item.id) return;
  ev.mcpCalls ??= new Map();
  ev.mcpCalls.set(item.id, {
    server: item.server ?? null,
    tool: item.tool ?? null,
    status: item.status ?? null,
    message: item.error?.message ?? null,
  });
}

/**
 * The MCP tool-call gauge for this turn: what completed, what was REFUSED, and why.
 *
 * ✕ A TOOL THAT RAN AND ERRORED IS NOT A REFUSAL, and the first cut of this conflated them — which
 * would have made the gauge unable to draw the one distinction the whole issue is about. Measured
 * against our own band server on codex-cli 0.150.1, the two shapes are cleanly different:
 *
 *   refused before reaching the server   status "failed", error: { message: "MCP tool call requires…" }
 *   reached the server, tool errored     status "failed", error: NULL, result carries the tool's own text
 *
 * So a refusal is a `failed` that carries an `error.message`. Counting every non-completed call as a
 * refusal would report a band tool that ran and complained about its own missing run dir as an
 * approval problem, and send the next reader to the engine instead of to the fixture.
 */
export function mcpToolGauge(ev) {
  const calls = [...(ev?.mcpCalls?.values() ?? [])];
  const refusals = calls.filter((c) => c.status === "failed" && c.message);
  return {
    mcpToolCalls: calls.filter((c) => c.status === "completed").length,
    mcpToolCallsRefused: refusals.length,
    // Bounded: a stage can attempt many, and a row is not a log. The first few name the class, and the
    // count beside them says how many more there were.
    mcpToolCallRefusals: refusals.slice(0, 5).map((c) => ({ server: c.server, tool: c.tool, message: c.message })),
  };
}

/**
 * THE SERVED MODEL — not on the wire, but codex writes it down.
 *
 * The gauge could not be answered on this engine and every codex row stamped `modelActual: null`, so
 * `modelMismatch` was null too and a silent substitution on the codex path was undetectable. The stream
 * genuinely carries nothing (see parseCodexEvent). One layer over, it does: codex writes a session
 * rollout to `$CODEX_HOME/sessions/<yyyy>/<mm>/<dd>/rollout-<ts>-<uuid>.jsonl`, and its `turn_context`
 * record carries `payload.model` — `"gpt-5.6-sol"` on the probe this was built from.
 *
 * WHY THIS IS THIS TURN'S ANSWER AND NOT A GUESS: runTurn already points `CODEX_HOME` at a per-run temp
 * dir, so the rollouts under it belong to this invocation and nothing else. No scan of a shared home, no
 * matching a session id against a directory of other runs' sessions.
 *
 * THE LAST value wins, not the first: a `turn_context` is written per turn, and what the row must say is
 * which model served the turn being recorded.
 *
 * NEVER THROWS, and null is a real answer. A missing rollout, an unreadable one, a codex that stops
 * writing them — all return null, which lands as `modelBasis: "unknown"`: exactly the state every codex
 * row carried before this change, and an honest one. Read AFTER the child exits and BEFORE the finally
 * block deletes the dir.
 */
export function readServedModel(codexHome, sinceMs = 0) {
  // — `sinceMs` is not optional decoration. This walks $CODEX_HOME/sessions, sorts every rollout
  // by mtime and reads the NEWEST, which is only "this turn's" while the home is created and destroyed
  // per turn. Once a home is shared across a stage's attempts and form-repairs, a turn that wrote NO
  // rollout of its own (spawn error, killed before codex opened its session file) would find the
  // PREVIOUS turn's rollout and report that model as this turn's modelActual.
  //
  // Today that case correctly returns null -> modelBasis:"unknown", which is an honest absence. Trading
  // it for a confident wrong answer would be a worse bug than the one fixes, so the caller stamps
  // the clock immediately before spawn and nothing older than that is eligible.
  if (!codexHome) return null;
  try {
    const root = join(codexHome, "sessions");
    if (!existsSync(root)) return null;
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/^rollout-.*\.jsonl$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const fresh = sinceMs ? files.filter((f) => { try { return statSync(f).mtimeMs >= sinceMs; } catch { return false; } }) : files;
    if (!fresh.length) return null;      // no rollout from THIS turn — absence, not the last turn's answer
    const ordered = fresh.slice().sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const files_ = ordered;
    let served = null;
    for (const line of readFileSync(files_[0], "utf8").split("\n")) {
      if (!line.trim()) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const m = rec?.payload?.model ?? rec?.model;
      if (typeof m === "string" && m) served = m;
    }
    return served;
  } catch {
    return null;                                  // telemetry is never load-bearing on a turn's outcome
  }
}

// ── rate limit / subscription cap ────────────────────────────────────────────────────────────────────
// codex carries NO structured rate-limit metadata — no field on any event, and (0.147.0) no usage,
// limit or quota subcommand to ask before a round; `doctor` covers install, config, auth and runtime
// health only. So the classification is a regex over free text, and the record says so: `rateLimitBasis`
// distinguishes "we matched words in an error message" from a provider signal, and a park with no
// `rateLimited` at all is a stall.
// `usage limit` added 2026-08-20 ( regression): codex-cli 0.147.0 states a subscription
// exhaustion as "You've hit your usage limit." — which matches NONE of the alternatives above, so a
// two-day account exhaustion classified as a stall and spent the DEFECT budget instead of weather.
// The original list was certified 21/21 green against wordings the test author wrote and never against
// a vendor message; `driver/test/fixtures/codex-usage-limit.json` now holds the real captured stream so
// that cannot recur. This alternation is still a list of prose a vendor may change without notice,
// which is exactly why `rateLimitBasis: "text-match"` stays on the record.
const RATE_LIMIT_RE = /\b429\b|rate.?limit|usage limit|quota|too many requests|insufficient_quota/i;

// A retry hint, WHEN THE MESSAGE HAPPENS TO CARRY ONE. Two anchored shapes and nothing clever: an
// explicit timestamp, or a relative delay with a unit. Anything else yields undefined and the driver
// parks on its default backoff exactly as before — a guessed reset is worse than none, because the
// pipeline postpones the whole run to it.
const RESET_AT_RE = /(?:resets?|available|try again)\s+(?:at|on)\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/i;
// A HUMAN-READABLE reset, which is the shape codex actually emits: "try again at Aug 22nd, 2026 9:06 AM".
// Anchored on the same lead-ins as RESET_AT_RE so it can only fire where the message is stating a reset,
// and it requires month + day + YEAR: without a year this would silently resolve to 1970 or to the
// current year, and postponing a run to a wrong date is the failure this module's own comment warns about.
// The ordinal suffix is stripped before Date.parse, which rejects "22nd" outright.
const RESET_HUMAN_RE = /(?:resets?|available|try again)\s+(?:at|on)\s+([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)/i;
const RETRY_IN_RE = /(?:retry|try)[- ]?(?:again\s+)?(?:after|in)[:\s]+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
const UNIT_MS = {
  ms: 1, millisecond: 1, milliseconds: 1,
  s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3,
  m: 6e4, min: 6e4, mins: 6e4, minute: 6e4, minutes: 6e4,
  h: 36e5, hour: 36e5, hours: 36e5,
};
export function parseResetHint(text, now = Date.now()) {
  if (!text) return undefined;
  const at = RESET_AT_RE.exec(text);
  if (at) {
    const t = Date.parse(at[1]);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  const rel = RETRY_IN_RE.exec(text);
  if (rel) {
    const ms = Number(rel[1]) * (UNIT_MS[rel[2].toLowerCase()] ?? 0);
    if (Number.isFinite(ms) && ms > 0) return new Date(now + ms).toISOString();
  }
  // Human-readable LAST, so an explicit machine timestamp always wins where a message carries both.
  const human = RESET_HUMAN_RE.exec(text);
  if (human) {
    // NO TIMEZONE is stated in this shape, so Date.parse resolves it in the BOX's zone. That is the
    // right reading — codex renders the reset in local time — but it is an assumption, not a provider
    // fact, which is why the caller stamps `resetsAtBasis: "text-parsed"`. If the box zone and the
    // vendor's rendering zone ever diverge, the error is bounded by that offset and the pipeline
    // re-parks on a still-capped account rather than resuming forever.
    const t2 = Date.parse(human[1].replace(/(\d{1,2})(?:st|nd|rd|th)\b/i, "$1"));
    // MUST be in the FUTURE, and that guard is what makes the missing timezone safe in BOTH directions.
    // Reading a zone-less "9:06 AM" in the box's zone can land BEHIND the vendor's intended instant when
    // the box runs ahead of it — a reset already in the past reads as "due now", so the pipeline resumes
    // straight back into a live cap. Returning undefined instead falls through to the default backoff,
    // which is the same conservative answer this function gives for any message it cannot read. Mirrors
    // the `ms > 0` guard the relative shape above already applies.
    if (Number.isFinite(t2) && t2 > now) return new Date(t2).toISOString();
  }
  return undefined;
}

function settleTuple({ r, ev, resumeRef }) {
  const killed = !!r.killed, overflow = !!r.overflow, stallKill = !!r.stallKill;
  // A turn is OK iff it reached turn.completed, did not turn.failed, and was not killed/overflowed. The
  // file-truth gate (runStage) validates the actual output file separately — an empty agent_message is fine.
  const failed = overflow || killed || !ev.turnCompleted || !!ev.turnFailed;
  const usage = mapUsage(ev.usage);
  const text = ev.agentText || "";
  const json = buildEnvelope({
    text, ok: !failed, killed, usage,
    summary: ev.turnFailed ? "failed" : (ev.turnCompleted ? "success" : undefined),
    runId: ev.threadId,
  });
  const stderrOut = overflow
    ? (r.stderr + `\nopenai-agent output overflow: stdout/stderr exceeded ${r.maxBuffer} chars — killed the tree and failed the turn (truncated tail never parsed)`)
    : (stallKill ? (r.stderr + "\nrequest timed out (openai-agent stall-watchdog: 0 streamed tokens)") : r.stderr);
  // Rate limit / quota. codex carries NO structured reset metadata, so the classification is a
  // regex over the failure text and the row says that in `rateLimitBasis`. A reset hint is used only
  // when the message states one; otherwise resetsAt stays undefined and the driver parks on its default
  // backoff (CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS), exactly as the anthropic no-reset 429 path does.
  const rateLimitText = `${ev.turnFailed || ""}\n${ev.streamError || ""}\n${r.stderr || ""}`;
  const rateLimited = !killed && RATE_LIMIT_RE.test(rateLimitText);
  const resetsAt = rateLimited ? parseResetHint(rateLimitText) : undefined;
  return {
    code: killed ? 137 : (failed ? (r.rawCode || 1) : 0),
    killed, wall: r.wall,
    stdout: text, stderr: stderrOut, laneWaitMs: 0,
    json, usage,
    // MODEL GAUGE (,): the id codex recorded for this turn — from its session rollout under
    // this run's own CODEX_HOME, since the event stream states none. Still two states and never one:
    // null = "this engine did not report", never the requested tier wearing the word "actual".
    // gateway.mjs records the absence as modelBasis:"unknown".
    modelWire: ev.model ?? null,
    sessionRef: ev.threadId ?? resumeRef ?? null,
    // hardWall vs stall: same null-usage kill shape, distinguished for classifyWedge (a hard-wall grind is
    // a `timeout`, a 0-token stall is a `lane_wedge`).
    // thought: NULL, not false — codex has its own reasoning-event vocabulary which has not been probed,
    // so this engine cannot honestly answer "did thinking engage". null = "engine does not report",
    // explicitly distinct from false = "reported, and it did not". Making codex report truthfully is
    // separate work; it is not the live engine (CLEAROTRON_AI=anthropic-agent).
    // rateLimitBasis: "text-match" says the cap was read out of an error MESSAGE, not out of a
    // provider signal — codex emits none. It is what tells a reader that a park classified this way is
    // as good as the words codex happened to use, and it is absent on a stall, which is the pair the
    // issue is about: a stall carries `stalled` and no rate-limit fields at all.
    // — the MCP gauge, written UNCONDITIONALLY like every other gauge on this
    // row. `mcpToolCalls: 0` with `mcpToolCallsRefused: 3` is the state this issue exists for, and it
    // must be impossible to read as "made none": two integers, never one. These are deliberately NOT
    // folded into `toolCalls`, which on anthropic-agent counts EVERY tool — codex's stream carries only
    // its MCP items, so one name for two populations would make a cross-engine comparison a lie. codex
    // still cannot report a whole-turn tool count, so `toolCalls` stays null, which is the house rule
    // for "this engine does not report" rather than "it called nothing".
    ...mcpToolGauge(ev),
    signals: {
      stalled: stallKill || undefined, hardWall: r.hardWall || undefined,
      // A gather stage that ran with none of its tools produced prose and no instrumented half. The
      // turn is still `ok` here — whether a refusal should FAIL the turn changes what a client
      // receives and is not this adapter's call — but nothing downstream can any longer fail to know.
      mcpRefused: mcpToolGauge(ev).mcpToolCallsRefused > 0 || undefined,
      rateLimited: rateLimited || undefined,
      rateLimitBasis: rateLimited ? "text-match" : undefined,
      // resetsAtBasis (, 2026-08-20): same honesty as rateLimitBasis one line up, for the reset
      // CLOCK rather than the classification. codex states its reset as human prose with NO timezone
      // ("try again at Aug 22nd, 2026 9:06 AM"), so the ISO we derive is a reading of that prose in the
      // box's own zone — never a provider fact. Absent when no hint was found, exactly as `resetsAt` is.
      resetsAtBasis: resetsAt ? "text-parsed" : undefined,
      resetsAt, thought: null,
    },
  };
}

function errResult(t0, e, resumeRef) {
  return {
    code: 1, killed: false, wall: (Date.now() - t0) / 1000, stdout: "",
    stderr: `openai-agent error: ${e?.message ?? e}`, laneWaitMs: 0,
    json: null, usage: null, modelWire: null, sessionRef: resumeRef ?? null,
  };
}

export const openaiAgentEngine = {
  name: "openai-agent",
  // — WHAT THIS ENGINE GUARANTEES ABOUT SEAT WRITES: NOTHING, and the record now says so.
  // The boundary is a `claude -p` PreToolUse hook and codex has no PreToolUse — an absence by
  // construction, not a misconfiguration. `--sandbox workspace-write --add-dir <runDir>` grants; it
  // cannot subtract, so the sandbox cannot express the denial either. A seat on this engine writing into
  // `_driver/` meets no boundary at all. `run-integrity.mjs` DETECTS drift across a turn and logs it,
  // which is a different thing from refusing the write and must not be read as this field being "some".
  writeBoundary: "none",
  // Capability flags the gateway reads (W2) instead of hardcoding `engine.name === "anthropic-agent"`:
  usesGatherMcp: true,    // codex loads [mcp_servers] under `exec` → the gather stages get their tools
  usesSkillsDir: true,    // needs skillsDir absolutization + a runDir writable root, like the anthropic engine
  // `multiProvider: false` sat here. Nothing read it: the cross-provider tail it was declared for was
  // gated on driver.config's own engine set, and both are deleted with the failover chain.
  // Honest provenance for the telemetry stamp: on an openai run, `modelUsed` must be the GPT id, NOT the
  // anthropic-catalog resolution. Non-throwing (unknown → the input) so a stray alias never breaks logging.
  resolveModelId(model) { try { return openaiModel(model) ?? model; } catch { return model; } },
  // — `codexHome` is the CALLER'S if it passes one, and the caller then owns its lifetime.
  //
  // codex stores sessions under $CODEX_HOME/sessions/ and resolves `resume <id>` against them. Creating
  // and deleting a home per TURN meant every warm resume pointed at a directory that had never heard of
  // the thread. Measured on codex-cli 0.147.0: it does not start fresh, it errors —
  // `thread/resume failed: no rollout found for thread id ... (code -32600)`, exit 1 — with the control
  // (same id, same binary, its own home) resuming cleanly. So every warm-patch retry and every
  // form-repair sub-turn on the codex arm has been failing.
  async runTurn({ message, model, thinking, timeoutSec, resumeRef, mcpConfig, allowedTools, cwd, skillsDir, skillsGrantRoots, profilesDir, resolveSkill, runDir, stallSec, codexHome: providedHome } = {}) {
    if (!message) throw new Error("openai-agent.runTurn: message is required");
    const t0 = Date.now();
    let codexHome;
    // A home we were GIVEN is never deleted here — the stage that owns the session chain owns the
    // directory, or the next resume in that chain has nothing to resume from again.
    const ownHome = !providedHome;
    try { codexHome = providedHome ?? mkdtempSync(join(tmpdir(), "codex-home-")); }
    catch (e) { return errResult(t0, e, resumeRef); }
    try {
      // Auth toggle (may throw loud on api-key-without-key — a config error, not a retryable failure).
      const { env, mode } = spawnEnv(process.env, codexHome);
      if (mode === "subscription") {
        const af = authFilePath(process.env);
        if (!existsSync(af))
          throw new Error(`CLEAROTRON_AI_BILLING=subscription but no auth.json at ${af} — run \`codex login\` (or set CLEAROTRON_OPENAI_AUTH_FILE — NOT an aliased name, and deliberately left as it is), or use CLEAROTRON_AI_BILLING=api-key + CODEX_API_KEY.`);
        copyFileSync(af, join(codexHome, "auth.json"));
      }
      // Per-run config.toml: the gather MCP servers (translated from the claude-shaped mcpConfig, so
      // gather-config.mjs is untouched) + developer_instructions = WRITE_DISCIPLINE (codex's
      // append-system-prompt equivalent; the shared stage prompts are never mutated).
      //
      // — `toolTimeoutSec` carries THIS TURN'S budget to codex's per-call tool cap. It is written
      // here, before the child is spawned, so the turn's remaining budget is still its whole budget;
      // there is nothing yet to subtract. Without it codex applies its own ~300s default and a long
      // dictated plan dies with no artifact while the stage still had most of its time — the exact
      // shape of R5's `register-unit:incumbent-class` failure on 2026-08-12 (stage timeoutSec 1500,
      // tool dead at 300). The same `timeoutSec` also arms the child's hard wall below, which stays the
      // backstop if a tool consumes the lot.
      writeFileSync(join(codexHome, "config.toml"),
        renderCodexConfigToml({ mcpConfig, allowedTools, developerInstructions: WRITE_DISCIPLINE, toolTimeoutSec: timeoutSec }));

      const input = absolutizeSkillRefs(message, skillsDir, resolveSkill);
      const { args } = buildCodexArgs({ model, thinking, resumeRef, runDir });
      // Stamped HERE, not at function entry: everything above is file writes that can take a moment, and
      // a floor set too early would let a previous turn's rollout back in on a shared home.
      const spawnedAtMs = Date.now();
      const ev = { threadId: null, usage: null, agentText: "", turnCompleted: false, turnFailed: null, streamError: null, model: null, mcpCalls: new Map() };
      const r = await runStreamingChild({
        bin: codexBin(), args, input, runDir,
        // — the run dir, not a shared tmpdir. codex's workspace-write sandbox makes cwd a writable
        // root, so this tightens the writable surface onto the run rather than widening it.
        cwd: resolveSpawnCwd({ cwd, runDir }),
        env, stallSec, timeoutSec,
        onStdoutLine: (line) => parseCodexEvent(line, ev),
        stderrIsLiveness: true,   // codex streams progress on STDERR → it is liveness for the stall watchdog
      });
      if (r.spawnError) return errResult(t0, r.spawnError, resumeRef);
      // The stream said no model (it never does — see readServedModel); the rollout under THIS run's
      // CODEX_HOME did. Read here, inside the try, because the finally below deletes that dir.
      if (!ev.model) ev.model = readServedModel(codexHome, spawnedAtMs);
      return settleTuple({ r, ev, resumeRef });
    } finally {
      try { if (ownHome && codexHome) rmSync(codexHome, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    }
  },
};
