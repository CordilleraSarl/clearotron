// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/probe.mjs — prove the configured engine can COMPLETE A TURN, not that a file exists.
//
// WHY THIS EXISTS BESIDE preflightEngineBinary AND NOT INSTEAD OF IT
//
// `preflightEngineBinary` (driver.config.mjs) answers "can spawn(2) start this?" from the filesystem and
// deliberately never spawns; its header says why, and that reasoning is untouched. It is the right check
// and it is not sufficient. An executable on PATH that is SIGNED OUT, whose credential expired, whose
// model tier is unavailable, or whose quota is spent passes every file-side test and then fails at the
// first stage — after the run directory, the frozen profile and the status sidecar exist, wearing the
// shape of a model fault. A clearance runs for hours. The difference between failing at second three and
// failing at minute ninety is a typo versus a wasted afternoon plus the spend on every stage before it.
// The wizard admitted the gap in prose ("Setup does not check that it is logged in"); this closes it.
//
// THE CHEAPEST TURN THAT PROVES THE WHOLE PATH
//
// One `haiku`-tier turn at `low` effort on a six-word prompt, with no MCP config, no allowed tools, no
// skills dir and no run dir — the smallest argv either adapter can build. It exercises every link a
// stage uses: binary → spawn → billing mode → credential → model access → a completed turn parsed by
// the adapter's own settle path. And it is far lighter than the thing it protects: one register-sweep
// stage prompt inlines 150 KB of plan and runs for minutes.
//
// WHAT IT DOES NOT PROVE, said out loud. It exercises the CHEAP tier. Both tiers ride one credential on
// a subscription, so AUTH is proven for all of them; a per-tier model entitlement or a per-tier quota is
// not. That is the honest cost of "the probe must not be a heavier operation than the thing it
// protects", and it is the right trade — the failures this catches are engine-wide, not tier-specific.
//
// IT REUSES EACH ADAPTER'S OWN SPAWN PATH AND HAND-ROLLS NOTHING
//
// The turn goes through `engine.runTurn()`. On anthropic that is `buildClaudeArgs` (prompt on STDIN, `-p`
// as a bare flag, `--effort`, the WRITE_DISCIPLINE system prompt) plus `spawnEnv`; on codex it is
// `buildCodexArgs` plus `spawnEnv` plus the per-run `CODEX_HOME` with its rendered config.toml and its
// seeded auth.json — including that adapter's own auth.json refusal, which is a cheaper check than a
// turn and runs before one. Both bring their stall watchdog, their detached group-kill and their result
// parsing. A probe that built its own argv would prove a path no stage takes.
//
// IT NEVER TOUCHES BILLING MODE
//
// `resolveAuthMode` is CALLED, and calling it is the point: it is the door the gateway opens at the top
// of runStage, and `anthropic-agent`'s own `spawnEnv` does NOT call it — so a probe that went straight
// to runTurn would pass on `CLEAROTRON_AI_BILLING=api-key` with no `ANTHROPIC_API_KEY` and fail loud on
// the first real stage, which is precisely the class of miss this module exists to end. It reads and
// throws. Nothing here sets, defaults, suggests or repairs a mode: which auth an engine turn runs under
// is a spend decision and it is not this file's.
//
// KEEPING THE SUITE OFFLINE
//
// A probe spawns a real CLI and costs a real turn, so a test suite that reached the default path would
// quietly start making model calls. Two seams, and they are the whole mechanism:
//   · `runTurn` / `engine` are injectable. When either is given, `loadAdapter` is NEVER referenced — a
//     test injects a `loadAdapter` that throws to prove exactly that.
//   · `classifyProbe` is PURE over a normalized tuple, so every failure mode is asserted from a literal.
// The one place the real adapter is exercised, it is pointed at `driver/test/mock-claude.mjs` through
// `CLEAROTRON_CLAUDE_PATH` — the same offline fixture the engine tests already spawn.

import { ENGINE_BINARIES, DEFAULT_ENGINE_ID, engineAdapterSpecifier } from "../driver.config.mjs";
import { resolveAuthMode } from "./auth.mjs";

/** Six words. Short enough to be free in practice, and it still requires a real completed turn. */
export const PROBE_PROMPT = "Reply with the single word: ok.";
/** The CHEAP rung of the driver's tier vocabulary on BOTH adapters (engine/CONTRACT.md §3). */
export const PROBE_MODEL = "haiku";
/** The floor rung of both EFFORT tables. There is nothing below `low` on anthropic. */
export const PROBE_THINKING = "low";
/** A person is waiting at a wizard. The adapter's hard wall is this + 60s. */
export const PROBE_TIMEOUT_SEC = 60;
/** …and 30s of ZERO streamed bytes is already a dead engine at this size of turn. The default is 120s. */
export const PROBE_STALL_SEC = 30;

/** How much engine stderr rides the verdict. Enough to diagnose, bounded so a spewing CLI cannot flood. */
const DETAIL_CHARS = 400;

// ── the failure-mode ladder ──────────────────────────────────────────────────────────────────────────
//
// "Cannot run" is not actionable. "Signed out", "no quota until 14:20", "that tier is not available to
// this account" each name the next thing the reader does. These patterns are read over the engine's own
// stderr / error text, and every verdict carries a `basis` saying HOW it was reached — the discipline
// openai-agent already applies to `rateLimitBasis`, for the same reason: a classification matched out of
// free text must never be reported with the confidence of a provider signal.
// `\/login` is the slash-command form the Claude CLI prints on a signed-out `-p` run ("Invalid API key ·
// Please run /login"); bare "login" is deliberately NOT matched, because it appears in prose that is not
// about being signed out.
const SIGNED_OUT_RE = /not logged in|logged out|signed out|please log ?in|\/login\b|claude login|codex login|no auth\.json|credentials? (?:were )?not found|no .* credentials|unauthori[sz]ed|authentication[_ ]error|invalid[_ -]?api[_ -]?key|oauth|\b401\b|\b403\b/i;
const TIER_RE = /model[_ -]?not[_ -]?found|unknown model|not a valid model|does not have access|no access to|model .{0,40}(?:not available|unavailable|not supported|unsupported)|unsupported model|no claude model mapped|no GPT tier mapped|permission[_ ]error/i;

const tail = (s) => {
  const t = String(s ?? "").trim();
  if (!t) return null;
  return t.length > DETAIL_CHARS ? `…${t.slice(-DETAIL_CHARS)}` : t;
};

const signInLine = (engine) => ENGINE_BINARIES[engine]?.signIn ?? "sign the CLI in";

/**
 * One verdict from one turn. PURE — no clock, no filesystem, no process.
 *
 * `tuple` is the engine's normalized return (engine/CONTRACT.md §1); `error` is a THROW, which is a
 * distinct class and not a returned failure: `openai-agent.runTurn` throws for both of its auth shapes
 * (resolveAuthMode on api-key-without-key, and the auth.json refusal) rather than settling a tuple.
 */
export function classifyProbe({ engine, tuple = null, error = null, timeoutSec = PROBE_TIMEOUT_SEC } = {}) {
  const id = String(engine ?? "").trim().toLowerCase();
  const v = (mode, basis, headline, fix, extra = {}) =>
    ({ ok: false, engine: id, mode, basis, headline, fix, detail: null, ...extra });

  // ── a THROW ────────────────────────────────────────────────────────────────────────────────────────
  // The thrown text is relayed VERBATIM as the fix wherever the thrower already says what to do. Those
  // messages were written by the module that owns the decision (auth.mjs owns the billing refusal, the
  // codex adapter owns `codex login`); paraphrasing them here creates a second wording that drifts.
  if (error) {
    const msg = String(error?.message ?? error);
    if (/=api-key but/i.test(msg))
      return v("auth-misconfigured", "config",
        `${id} cannot start: the billing mode this box declares has no key`, msg, { detail: null });
    if (SIGNED_OUT_RE.test(msg))
      return v("signed-out", "config", `${id} is not signed in`, msg);
    if (TIER_RE.test(msg))
      return v("tier-unavailable", "config", `${id} cannot reach the model it was asked for`, tierFix(id, msg));
    return v("failed", "throw", `${id} could not run a turn`, msg);
  }

  if (!tuple) return v("failed", "none", `${id} returned nothing`, "The adapter settled no tuple — this is a driver bug, not a configuration one.");
  const s = tuple.signals ?? {};
  const text = `${tuple.stderr ?? ""}\n${tuple.stdout ?? ""}`;
  const detail = tail(tuple.stderr);

  if (tuple.code === 0) return { ok: true, engine: id, mode: "ok", basis: "completed-turn", headline: `${id} completed a turn`, fix: null, detail: null };

  // spawn itself failed. The filesystem preflight normally catches this first; when it does not, say so
  // in the binary's own vocabulary rather than as a mysterious engine fault.
  if (tuple.json == null && /spawn error|agent error:/i.test(String(tuple.stderr ?? "")))
    return v("cannot-spawn", "spawn-error", `the ${id} binary could not be started`,
      `Check ${ENGINE_BINARIES[id]?.env ?? "the engine binary variable"} — it must name an executable file, by absolute path or a bare name on PATH.`,
      { detail });

  // A PROVIDER SIGNAL beats every text match below it, and the reset time is the actionable part.
  if (s.rateLimited) {
    const basis = s.rateLimitBasis ?? "provider-signal";
    const fix = s.resetsAt
      ? "Nothing on this box is wrong. Wait for the reset, or run on an account with capacity."
      : `The engine reported a cap and no reset time${basis === "text-match" ? " (codex publishes none; this was read out of the error text, not a provider signal)" : ""}. Re-run later, or run on an account with capacity.`;
    return v("no-quota", basis, s.resetsAt ? `${id} has no quota until ${s.resetsAt}` : `${id} has no quota right now`, fix,
      { resetsAt: s.resetsAt ?? null, detail });
  }

  if (SIGNED_OUT_RE.test(text))
    return v("signed-out", "text-match", `${id} is not signed in`,
      `Sign in: ${signInLine(id)}, then run this again. Setup does not do it for you — the CLI owns its own login.`, { detail });

  if (TIER_RE.test(text))
    return v("tier-unavailable", "text-match", `${id} cannot reach the model it was asked for`, tierFix(id, text), { detail });

  if (tuple.killed || s.stalled || s.hardWall)
    return v("timed-out", "watchdog", `${id} started but did not finish a six-word turn in ${timeoutSec}s`,
      "The binary runs and the turn produces nothing. Run the CLI by hand once and see what it is waiting for — an unanswered login prompt and a wedged MCP server both look like this.", { detail });

  // The anthropic adapter's own diagnosis: the CLI exited without emitting a single stream event, i.e.
  // it died at startup (args/auth/MCP). That is the signed-out shape, and the basis says it was inferred
  // from the shape rather than read from a message.
  if (s.noStreamEvents)
    return v("signed-out", "startup-class", `${id} exited before it produced anything`,
      `That is the signed-out shape, so start there: ${signInLine(id)}, then run this again. The engine's stderr below is the diagnosis if it is something else.`, { detail });

  return v("failed", "nonzero-exit", `${id} ran but the turn failed (exit ${tuple.code})`,
    "The engine's stderr below is the whole story; a turn that starts and fails is not a configuration this check can name.", { detail });
}

/** The one place the tier doctrine is POINTED AT rather than re-authored. */
function tierFix(engine, msg) {
  if (engine === "openai-agent")
    return "This account cannot run the codex model the tiers point at. The three CLEAROTRON_OPENAI_MODEL_* "
      + "knobs default to three distinct rungs of the codex ladder (sol / terra / luna) — the mapping and "
      + "the reason are in docs/architecture/04-configuration-reference.md (the CLEAROTRON_OPENAI_MODEL_* rows) "
      + `and in the tier comment in driver/engine/openai-agent.mjs. Engine said: ${tail(msg)}`;
  return "The model alias is not one this CLI or this account can run. The tier map is in "
    + `docs/architecture/04-configuration-reference.md, "Model tiers and resolution". Engine said: ${tail(msg)}`;
}

/** One line a person can act on. Used by the wizard, by `--check` and by the run-door refusal. */
export function probeFailureText(verdict) {
  return verdict.fix ? `${verdict.headline} — ${verdict.fix}` : verdict.headline;
}

// ── WEATHER OR CONFIGURATION — the only question a RUN DOOR asks of a failed verdict ───────────
//
// The wizard can refuse on anything: a person is standing there, and the cost of being wrong is that they
// run `--check` again. The RUN DOOR cannot. A refusal there is terminal for a job that may have arrived by
// email at 03:00, and it fires on resumes too — where a wrong refusal abandons a run that already holds
// hours of finished stages. So the door needs to know which failures are about THIS BOX and which are
// about the weather, and this is where that partition lives, beside the ladder that produces the modes.
//
// CONFIGURATION — refuse. Something an operator set, or did not set, is wrong, and it will still be wrong
// in ninety seconds and in ninety minutes. Nothing is gained by building a run directory first.
//
// EVERYTHING ELSE — proceed, and say so. An upstream overload, a spent quota, a stalled turn and an exit
// code nobody can read are all conditions the run itself already handles BETTER than the door can: the
// rate-limit park carries the provider's own `resetsAt` and auto-resumes, and the weather lane of the
// recovery ladder exists precisely to keep an upstream 529 from spending the defect budget. A door that
// refused on those would replace a park that resumes itself with a terminal failure and a human — which
// is a REGRESSION on shipped behaviour, not a new guard. Measured, not argued: wiring the naive refusal
// turned `park lanes: an UPSTREAM OVERLOAD park charges weather` red, with the 529 arriving as the door's
// own refusal text.
//
// The default is OPEN. A mode this table does not name is weather, because a fault the ladder could not
// classify is by definition one the door cannot claim to understand — and the cost of being wrong runs
// the other way here: refusing wrongly kills a run that would have worked, proceeding wrongly costs the
// stages before a failure the engine was going to produce anyway.
const CONFIGURATION_MODES = new Set(["unknown-engine", "auth-misconfigured", "signed-out", "tier-unavailable", "cannot-spawn"]);

// …and a mode alone is not enough, because `basis` says HOW WELL the mode is known and the ladder already
// makes that distinction for its own reasons. `startup-class` is an INFERENCE FROM SILENCE — the CLI died
// before emitting a stream event, which is the signed-out shape and is also what a wedged MCP server, an
// OOM kill and a PATH gap look like. That last one is not hypothetical: onboard-wizard.test.mjs records a
// hosted runner where a hermetic PATH left `env` unable to resolve node, and the probe "correctly reported
// a startup-class engine death" on a machine whose engine was fine. Refusing a production run on that
// inference manufactures the outage it was written to prevent, so it warns instead.
const NAMED_BASES = new Set(["config", "text-match", "spawn-error"]);

/**
 * "ok" | "configuration" | "weather" — PURE, and the whole of the door's judgment.
 *
 * Deliberately NOT a boolean: the door prints a different sentence for each, and a caller that only wants
 * "may I refuse?" reads `=== "configuration"`.
 */
export function probeVerdictLane(verdict) {
  if (verdict?.ok) return "ok";
  const mode = String(verdict?.mode ?? "");
  const basis = String(verdict?.basis ?? "");
  return CONFIGURATION_MODES.has(mode) && NAMED_BASES.has(basis) ? "configuration" : "weather";
}

/** What the run says out loud when it proceeds past a failed probe. A silent fail-open is not a check. */
export function probeWeatherWarning(verdict) {
  const detail = verdict.detail ? ` — engine said: ${verdict.detail}` : "";
  return `[preflight] the engine did not complete a probe turn: ${probeFailureText(verdict)}\n`
    + `  PROCEEDING ANYWAY (${verdict.mode}/${verdict.basis}) — this is not a fault this box can fix, and the run's own `
    + `rate-limit park and recovery ladder handle it better than a refusal at the door would.${detail}`;
}

// ── running it ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Point process.env at the engine the CALLER means, for the duration of the turn.
 *
 * The adapters read `process.env` directly and by design — `claudeBin()`, `codexBin()` and both
 * `spawnEnv`s do, per call, so tests can drive a mock binary. The wizard's chosen engine is not in
 * process.env yet (there is no .env until the end), so without this the probe would faithfully exercise
 * whatever the operator's shell happens to have set and report a pass for the wrong engine — the same
 * frozen-provider trap `preflightCandidate` works around one file over.
 *
 * ONLY the engine-selection keys are applied. Credentials and billing-mode variables are deliberately
 * NOT copied: the probe must bill exactly the way a run on this box would, and moving a spend variable
 * to make a probe pass is the one thing this must never do.
 */
function applyEngineEnv(env) {
  if (!env || env === process.env) return () => {};
  const keys = ["CLEAROTRON_AI", ...Object.values(ENGINE_BINARIES).map((s) => s.env)];
  const saved = new Map();
  for (const k of keys) {
    saved.set(k, process.env[k]);
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = String(env[k]);
  }
  return () => {
    for (const [k, was] of saved) {
      if (was === undefined) delete process.env[k];
      else process.env[k] = was;
    }
  };
}

/** The default loader: ONE registry (ENGINE_BINARIES), one leaf module, imported only when used. */
async function defaultLoadAdapter(engine) {
  const spec = ENGINE_BINARIES[engine];
  const mod = await import(engineAdapterSpecifier(engine));
  const adapter = mod[spec.adapter];
  if (!adapter?.runTurn) throw new Error(`engine/probe: ${spec.module} does not export a runnable ${spec.adapter}`);
  return adapter;
}

/**
 * Run the probe and return a verdict. Never throws for a configuration fault — a caller that wants a
 * refusal calls `preflightEngineTurn`, and a caller that wants to report calls this.
 */
export async function probeEngineTurn({
  env = process.env,
  engine: injectedEngine = null,
  runTurn: injectedRunTurn = null,
  loadAdapter = defaultLoadAdapter,
  timeoutSec = PROBE_TIMEOUT_SEC,
  stallSec = PROBE_STALL_SEC,
} = {}) {
  const id = String(env.CLEAROTRON_AI || DEFAULT_ENGINE_ID).trim().toLowerCase();
  if (!ENGINE_BINARIES[id]) {
    // NOT this function's refusal to make, exactly as preflightEngineBinary declines to make it:
    // gateway.selectEngine owns "that is not an engine", by name, with the available list.
    return {
      ok: false, engine: id, mode: "unknown-engine", basis: "config", detail: null,
      headline: `CLEAROTRON_AI="${id}" is not an engine this driver ships`,
      fix: `One of: ${Object.keys(ENGINE_BINARIES).join(", ")}. The run refuses on this by itself (gateway.selectEngine).`,
    };
  }

  // The billing-mode door, before anything spawns — a fail-loud config error must not cost a turn.
  try { resolveAuthMode({ engineName: id, env }); }
  catch (e) { return classifyProbe({ engine: id, error: e, timeoutSec }); }

  let turn = injectedRunTurn;
  if (!turn) {
    const adapter = injectedEngine ?? await loadAdapter(id);
    turn = (args) => adapter.runTurn(args);
  }

  const restore = applyEngineEnv(env);
  try {
    const tuple = await turn({ message: PROBE_PROMPT, model: PROBE_MODEL, thinking: PROBE_THINKING, timeoutSec, stallSec });
    return classifyProbe({ engine: id, tuple, timeoutSec });
  } catch (e) {
    return classifyProbe({ engine: id, error: e, timeoutSec });
  } finally {
    restore();
  }
}

/**
 * The run-door form: REFUSE a configuration fault, do not warn.
 *
 * The choice, stated so nobody has to re-decide it. The register-credential precedent refuses because a
 * run whose work is impossible must say so before it costs anything, and the reasoning transfers exactly:
 * every one of the fourteen stages spawns the engine, so an engine that cannot complete a six-word turn
 * cannot complete any of them. A warning would let the run build its directory, freeze its profile and
 * write its status sidecar, then die at stage one leaving a resumable-looking husk and a failure wearing
 * the shape of a model fault — which is the precise outcome preflightEngineBinary exists to prevent, and
 * a check that produces it while printing a warning is worse than no check, because the warning scrolls
 * past. The asymmetry settles it: refusing wrongly costs one cheap turn and a re-run; warning wrongly
 * costs the stages before the failure plus the afternoon.
 *
 * `preflightDeploymentUrls` is the counter-precedent and it does not apply: a missing hostname makes a
 * LINK impossible while the deliverable still ships. Nothing ships without an engine.
 *
 * THAT ASYMMETRY ONLY HOLDS FOR A FAULT THIS BOX OWNS. Where the engine is fine and the provider
 * is having a bad afternoon, "refusing wrongly costs one re-run" is false: it costs a run that would have
 * parked and resumed itself. So the refusal is scoped by `probeVerdictLane`, and everything outside it
 * returns a verdict carrying `warning` — the same shape `preflightFreeSpace` and `preflightSkillsStore`
 * already hand the door.
 *
 * NOTHING THROWN FROM UNDERNEATH BECOMES A REFUSAL. `probeEngineTurn` promises a verdict for every
 * CONFIGURATION fault, not for every fault: its adapter load sits outside its own try, so a broken import
 * or a missing `runTurn` export escapes as a raw error. That is a driver bug, and a driver bug must not
 * reach a client as a terminal refusal at the door — it fails open, loudly, and the run dies at stage one
 * with the engine's own message if it is real.
 */
export async function preflightEngineTurn(opts = {}) {
  let verdict;
  try {
    verdict = await probeEngineTurn(opts);
  } catch (e) {
    verdict = { ok: false, engine: String((opts?.env ?? process.env).CLEAROTRON_AI || DEFAULT_ENGINE_ID),
      mode: "probe-error", basis: "driver-bug", detail: null,
      headline: "the engine probe itself failed to run", fix: `This is a bug in the probe, not a fault on this box: ${String(e?.message ?? e)}` };
  }
  if (verdict.ok) return verdict;
  if (probeVerdictLane(verdict) !== "configuration") return { ...verdict, warning: probeWeatherWarning(verdict) };
  const detail = verdict.detail ? `\n  engine said: ${verdict.detail}` : "";
  throw new Error(`[preflight] ${probeFailureText(verdict)}${detail}`);
}
