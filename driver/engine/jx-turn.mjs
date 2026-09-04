// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/jx-turn.mjs — the native-language lanes reach a model the same way every other stage does.
//
// ── why ( /, owner ruling 2026-08-20) ─────────────────────────────────────────────────────
//
// Verbatim: "one LLM provider only ever, API or auth, no mix". The jx lanes did not obey it and could
// not: they POSTed to the Anthropic Messages API on `ANTHROPIC_API_KEY` at a hardcoded haiku tier,
// whatever engine the customer had configured and whatever billing mode the run was on. Round
// 21f9b0ad's own receipt is the proof — engine `openai-agent` / SUBSCRIPTION on the agentic stages,
// `anthropic-direct` / API-KEY on all eleven jx calls, in one run. Every round this project has run
// mixed subscription and metered spend, and billing mode is an owner decision by standing rule.
//
// So these calls go through `engine.runTurn()`, the door every stage already uses, and the run's ONE
// engine and ONE billing mode carry them.
//
// ── resolveAuthMode IS CALLED HERE, and calling it is the point ──────────────────────────────────────
//
// `anthropic-agent`'s own `spawnEnv` does not call it, so anything that goes straight to `runTurn`
// passes on `CLEAROTRON_AI_BILLING=api-key` with no key and fails at the first real dispatch. probe.mjs
// documents that trap and this module inherits it. Nothing here sets, defaults, suggests or repairs a
// mode: which auth a turn runs under is a spend decision, and this file only reads it and reports it.
//
// ── THE TRUNCATION SIGNAL, AND WHERE IT IS THIN ──────────────────────────────────────────────────────
//
// The Messages API returned `stop_reason: "max_tokens"`, and the jx cores used it because — their own
// words — a truncation is byte-indistinguishable from a legitimate empty result and must surface as a
// degrade rather than a quiet recall loss. Across the seam:
//
//   anthropic-agent  synthesizes `stopReason` into its envelope (anthropic-agent.mjs), so the signal
//                    arrives intact and `truncated` is a fact.
//   openai-agent     does not carry it. On codex the ONLY truncation evidence is that a cut-off JSON
//                    object does not parse — which `envelopeFromTurnText` already turns into a degrade.
//
// STATED RATHER THAN PAPERED OVER: on codex a turn that hit its ceiling AFTER emitting a complete but
// short object is indistinguishable from one that meant it. That residue is smaller than the defect it
// replaces — today's lanes are simply skipped or billed elsewhere on codex — and it is a real gap, so
// `truncationObservable` rides every result and a reader can tell which kind of `ok` they are holding.

import { ENGINE_BINARIES, DEFAULT_ENGINE_ID, engineAdapterSpecifier } from "../driver.config.mjs";
import { resolveAuthMode } from "./auth.mjs";

/** The driver's tier vocabulary, not a wire model id (engine/CONTRACT.md §3) — the cheap rung on both. */
export const JX_TIER = "haiku";
/** The floor of both EFFORT tables. These lanes extract and classify; they do not deliberate. */
export const JX_THINKING = "low";
/** A jx turn inlines a hit batch or an evidence slice, so it is bigger than a probe and far short of a stage. */
export const JX_TIMEOUT_SEC = 180;
/** Zero streamed bytes for this long is a dead engine at this size of turn. */
export const JX_STALL_SEC = 90;

async function defaultLoadAdapter(engine) {
  const spec = ENGINE_BINARIES[engine];
  const mod = await import(engineAdapterSpecifier(engine));
  const adapter = mod[spec.adapter];
  if (!adapter?.runTurn) throw new Error(`engine/jx-turn: ${spec.module} does not export a runnable ${spec.adapter}`);
  return adapter;
}

/** The payload text of a normalized tuple, without importing the gateway (this module must stay light). */
export function turnText(tuple) {
  const payloads = tuple?.json?.result?.payloads;
  const first = Array.isArray(payloads) ? payloads[0] : null;
  return typeof first?.text === "string" ? first.text : String(tuple?.stdout ?? "");
}

/**
 * Read one normalized tuple into the shape the jx lanes consume. PURE, so every branch is assertable
 * from a literal rather than from a spawned CLI.
 */
export function readJxTuple(tuple, { vendor, authMode, engine }) {
  // CANONICAL Usage, whole (engine/CONTRACT.md §2: {input, output, cacheRead, cacheWrite, total}). The old
  // Messages-API rows carried input/output only because that is all the API returned; keeping only those
  // two now would drop cache and total tokens from the rollup on the very lanes this change puts on the
  // meter. `null` stays null — CONTRACT.md says that means no tokens were accounted, e.g. a stall, and a
  // zeroed object there would be a measurement nobody took.
  const u = tuple?.usage;
  const usage = u ? { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0,
                      cacheWrite: u.cacheWrite ?? 0, total: u.total ?? 0 }
                  : null;
  // The model that actually served the turn, never the alias we asked for — 's criterion 4 is that
  // the receipt names who did the native-language work, and an alias does not name anyone. Both adapters
  // populate it (anthropic-agent from the assistant/init events, openai-agent from `ev.model`).
  const model = tuple?.modelWire ?? null;
  const base = { model, vendor, authMode, usage, engine };
  // WHETHER TRUNCATION IS OBSERVABLE IS A FACT ABOUT THE ADAPTER, NOT ABOUT THIS TURN. It is keyed on the
  // engine deliberately: `anthropic-agent` writes `stopReason: r?.stop_reason` unconditionally, so the
  // KEY is present on every one of its turns whether or not the wire said anything — testing for the key
  // would measure that adapter's style and report observability it did not have. openai-agent carries no
  // equivalent at all. So: anthropic can tell us, codex cannot, and this says which.
  const observable = engine === "anthropic-agent";
  const truncated = observable && tuple?.json?.stopReason === "max_tokens";

  if (tuple?.killed || tuple?.signals?.stalled)
    return { ok: false, cause: "the engine turn was killed before it answered (stall or wall)", truncationObservable: observable, ...base };
  if (tuple?.signals?.rateLimited)
    return { ok: false, cause: "the engine turn was rate-limited", truncationObservable: observable, ...base };
  if (tuple?.code !== 0 || tuple?.json?.status !== "ok")
    return { ok: false, cause: `the engine turn did not complete cleanly (code ${tuple?.code ?? "?"}, status ${tuple?.json?.status ?? "none"})`,
      truncationObservable: observable, ...base };

  return { ok: true, text: turnText(tuple), truncated, truncationObservable: observable, ...base };
}

/**
 * A `turn` runner for the jx lanes, bound to the run's engine and billing mode.
 *
 * Returns `{ turn, vendor, authMode, engine }`, or `{ error }` when the configuration refuses — the
 * caller degrades the lane with that cause rather than this throwing into a pipeline stage.
 */
export async function makeJxTurnRunner({
  env = process.env,
  engine: injectedEngine = null,
  runTurn: injectedRunTurn = null,
  loadAdapter = defaultLoadAdapter,
  timeoutSec = JX_TIMEOUT_SEC,
  stallSec = JX_STALL_SEC,
  // TIER AND THINKING ARE THE CALLER'S, defaulting to the jx lanes' own. The portal's
  // brief reader is the second caller of this door and it must NOT inherit these two: the owner's ruling
  // for that reader is Sonnet with thinking OFF, and `compose-read.mjs` carries a measured warning that
  // `thinking` is refused outright by Haiku 4.5 (400: adaptive thinking is not supported). Copying the
  // jx constants across would have been a failure on every press.
  //
  // What the second caller is here FOR is everything above these two lines — one auth resolution, one
  // billing mode, one adapter load. Duplicating that to vary a model is how a box ends up billing two
  // ways, which is the ruling this door exists to keep.
  model = JX_TIER,
  thinking = JX_THINKING,
  // Names the lane in the one message a caller shows a human when the configuration refuses.
  lane = "the jx lanes",
} = {}) {
  const id = String(env.CLEAROTRON_AI || DEFAULT_ENGINE_ID).trim().toLowerCase();
  if (!ENGINE_BINARIES[id]) return { error: `CLEAROTRON_AI=${id} is not an engine this driver ships` };

  let auth;
  try { auth = resolveAuthMode({ engineName: id, env }); }
  catch (e) { return { error: `${lane} cannot run under this billing configuration: ${String(e?.message ?? e)}` }; }

  let runTurn = injectedRunTurn;
  if (!runTurn) {
    let adapter;
    try { adapter = injectedEngine ?? await loadAdapter(id); }
    catch (e) { return { error: `the ${id} adapter could not be loaded: ${String(e?.message ?? e)}` }; }
    runTurn = (args) => adapter.runTurn(args);
  }

  const vendor = auth.provider;
  const authMode = auth.mode;
  return {
    vendor, authMode, engine: id,
    async turn({ prompt }) {
      let tuple;
      try { tuple = await runTurn({ message: prompt, model, thinking, timeoutSec, stallSec }); }
      catch (e) {
        return { ok: false, cause: `the engine turn threw: ${String(e?.message ?? e).slice(0, 200)}`,
          model: null, vendor, authMode, engine: id, usage: { input: 0, output: 0 }, truncationObservable: false };
      }
      return readJxTuple(tuple, { vendor, authMode, engine: id });
    },
  };
}
