// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tokens.mjs — per-run LLM token rollup from the _driver/*.jsonl stage telemetry (was cost.mjs; renamed
// under the tokens-only directive, owner 2026-07-11: the driver tracks NO currency — token counts only).
//
// Each stage writes one record PER ATTEMPT to _driver/<stage>.jsonl with {model, usage, ...} (gateway.mjs).
// This sums token counts across EVERY attempt (so retry waste is included) directly from `usage` —
//
// …and across every DIRECT-API call too. The jx lanes do not go through the gateway (they are
// non-agentic Messages calls) and write their own `_driver/jx-completions.jsonl`; until 2026-07-28 those
// rows named their counts `tokens` and carried no `model`, so the model gate below dropped every one of
// them and a whole lane's spend was counted NOWHERE. They now write {model, usage} like any other row.
// The `byStage` split keys off the filename, so the direct-API share stays recoverable as
// `byStage["jx-completions"]` — worth knowing when reading `attempts`, which counts model invocations
// (agent turns AND single API calls), not gateway retries alone.
// self-contained, so it also works on historical runs (their rows may carry a legacy costUsd; it is
// ignored, never re-emitted). The run-level event log (_driver/run.jsonl) is skipped (it holds runLog
// events, not stage-attempt usage). Best-effort by contract: an unreadable dir / bad line never throws —
// a telemetry rollup must not fail a delivered run.
//
// ── KNOWN UNDERCOUNT: SUB-AGENT TOKENS ARE NOT IN THESE NUMBERS (measured 2026-07-29) ───────────────
//
// A stage's `usage` comes from the ONE `result` event of its `claude -p` turn (engine/anthropic-agent.mjs
// mapUsage). When that turn delegates to a sub-agent, the sub-agent's tokens are NOT in it — settled by
// a controlled probe rather than inference: a turn whose sub-agent alone emitted 909 output tokens
// reported 200 for the whole turn, and its cacheWrite (10,089) came in BELOW the sub-agent's own 14,250.
// Under-, not over-counting, so the direction is at least safe.
//
// MAGNITUDE, measured across all 1,794 driver sessions on the production box (sub-agent tokens read from
// their own sidechain transcripts, `~/.claude/projects/<proj>/<session>/subagents/*.jsonl`):
//
//     4% of turns spawn a sub-agent at all
//     overall undercount:  ~1.3% of output,  ~6% of cacheWrite
//     on the turns that DO spawn one:  ~19% of output,  ~57% of cacheWrite
//
// So it is a small aggregate bias sitting on a minority of turns, not a multiple — and it is an order of
// magnitude below the retry variance already in the data (two runs of the SAME request, one failing
// harder, differ ~22× on output). Calibration is therefore NOT blocked on it; it is a documented bias to
// state alongside any fitted weight, not a silent one.
//
// If a future lane starts delegating heavily, this stops being small. The correction is available
// without new plumbing — the sidechain transcripts hold the missing counts — but it is deliberately NOT
// applied here: this module reads run artifacts, and reaching into a CLI's private transcript store
// would tie the rollup to that CLI's on-disk layout.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { resolveModel } from "./driver.config.mjs";
import { runLog, note } from "./log.mjs";
import { writeRunStatus } from "./progress.mjs";
import { stampRunEconomics, isCodeSide } from "./run-economics.mjs";

function emptyAcc() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, attempts: 0, thoughtTurns: 0 };
}

/**
 * WHICH MODEL ACTUALLY SERVED THE TURN — the key `byModel` buckets under.
 *
 * `rec.model` is the TIER the stage asked for ("opus", "haiku"), and `resolveModel` is the ANTHROPIC
 * catalog. Resolving one through the other is right for an Anthropic turn and wrong for every other
 * engine: a codex run rolled up as `anthropic/claude-opus-5` while its own `byEngine` said
 * `openai-agent` and its attempt rows said `gpt-5.6-sol`. The two halves of the same rollup contradicted
 * each other, and the wrong half is the one the consumption ledger carries.
 *
 * The engine already answers this. gateway.mjs resolves the tier through the engine that served the
 * turn (`engine.resolveModelId ?? resolveModel`) and stamps the answer on the row as `modelUsed`. So
 * this reads the stamp rather than re-deriving it — one resolution, at the point that knows.
 */
function modelKey(rec) {
  if (typeof rec.modelUsed === "string" && rec.modelUsed) return rec.modelUsed;

  // NO STAMP. Two different situations, and guessing the same way for both is what caused the bug.
  const engine = typeof rec.engine === "string" ? rec.engine : "";

  // Rows predating the stamp, and the direct-API jx lanes, are Anthropic — that was the only engine
  // when they were written, and the jx lanes name a bare claude id that resolveModel exists to
  // normalise. Resolving keeps every historical rollup keyed exactly as it was.
  if (!engine || engine === "anthropic-agent") return resolveModel(rec.model);

  // Any OTHER engine with no stamp. The tier is not a model id and this catalog is not that engine's,
  // so there is no honest id to key under. Name the gap instead: the tokens still account (dropping
  // them would break byModel summing to total, and an invisible gap is the failure this file already
  // fixed once for byEngine), and the key says what is missing rather than asserting an Anthropic
  // model produced them.
  return `${engine}/unstamped:${rec.model}`;
}

// usage shape (gateway.mjs): {input,output,cacheRead,cacheWrite}. There is deliberately NO reasoning-token
// field: the old `reasoning`/`reasoningTokens` pair was an unfillable slot — no reasoning count exists
// anywhere in the claude payload (not result.usage, not usage.iterations), so no shipped adapter ever
// populated it and every run rolled up reasoning:0 forever. That 0 read as "no thinking" when it only ever
// meant "unpopulated", which is why it is gone rather than left declared. Thinking spend is NOT recoverable
// — Anthropic bills thinking inside output_tokens and never breaks it out.
//
// What IS observable is whether thinking engaged at all, per turn, from the stream's thinking blocks —
// carried on signals.thought (see engine/anthropic-agent.mjs) and counted as `thoughtTurns` below.
// null/missing usage (e.g. a provider stall) → all-zero.
function tokensOf(usage) {
  const u = usage || {};
  return {
    input: u.input || 0, output: u.output || 0,
    cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0,
  };
}

export function rollupTokens(runDir) {
  const dDir = driverDir(runDir);
  const total = emptyAcc();
  const byStage = {};
  const byModel = {};
  const byEngine = {};
  const byAuthMode = {};

  let files;
  try {
    files = readdirSync(dDir).filter((f) => f.endsWith(".jsonl") && f !== "run.jsonl");
  } catch {
    return { total, byStage, byModel, byEngine, byAuthMode }; // no telemetry dir → all-zero, never throws
  }

  for (const file of files) {
    const stage = file.replace(/\.jsonl$/, "");
    let raw;
    try { raw = readFileSync(join(dDir, file), "utf8"); } catch { continue; }
    for (const ln of raw.split("\n")) {
      if (!ln.trim()) continue;
      let rec;
      try { rec = JSON.parse(ln); } catch { continue; }
      if (!rec || typeof rec.model !== "string") continue; // only stage-attempt records carry a model
      const t = tokensOf(rec.usage);
      const accs = [total, (byStage[stage] ??= emptyAcc()), (byModel[modelKey(rec)] ??= emptyAcc())];
      // Engine and billing mode are split out because a token is not a portable unit of cost: a turn on a
      // SUBSCRIPTION appears on no API invoice at all, and two engines' tokens are not even the same thing
      // (different tokenizers, different accounting). Rolled up per engine, these stay comparable to
      // themselves over time, which is what a margin question actually needs.
      //
      // A row carrying no stamp — one predating it, or a direct-API lane like jx-completions — buckets as
      // "unknown" rather than being dropped, so `byEngine` always sums to `total` and the unattributed
      // share is VISIBLE. Dropping it would make the gap look like it did not exist.
      //
      // — A CODE-SIDE ROW IS NOT UNATTRIBUTED. The driver's own plan executor journals
      // `model: "code"` / `modelUsed: "code:execute-plan"` and carries NO engine and NO authMode fields,
      // because no engine served it and nobody was billed. Read with `?? "unknown"` it landed in the
      // bucket that means "we could not attribute this dispatch" — beside genuinely unstamped rows — and
      // destroyed that bucket's whole diagnostic value, which role-e2e doctrine actively reads. It also
      // made this rollup contradict `run-economics.byBilling`, which had the branch and got it right, on
      // the same dispatch in the same run. `isCodeSide` is IMPORTED from that module, not copied: one
      // definition, because two copies drifting apart is how the disagreement started.
      const codeSide = isCodeSide(rec);
      accs.push(byEngine[codeSide ? "code" : String(rec.engine ?? "unknown")] ??= emptyAcc());
      accs.push(byAuthMode[codeSide ? "not-provider-billed" : String(rec.authMode ?? "unknown")] ??= emptyAcc());
      for (const acc of accs) {
        acc.input += t.input;
        acc.output += t.output;
        acc.cacheRead += t.cacheRead;
        acc.cacheWrite += t.cacheWrite;
        // thoughtTurns counts turns where extended thinking ENGAGED, not turns where it was requested.
        // Strict === true: openai-agent reports null ("engine does not report") and pre-gauge records
        // carry no key at all — neither must be counted as a thinking turn, and neither is a false.
        if (rec.signals?.thought === true) acc.thoughtTurns += 1;
        acc.attempts += 1;
      }
    }
  }

  return { total, byStage, byModel, byEngine, byAuthMode };
}

/**
 * Stamp the rollup onto the run: the `token-rollup` event in _driver/run.jsonl plus `status.json.tokens`.
 *
 * Called at EVERY terminal state, not just delivery (2026-07-28). It used to live inline on the publish
 * path only, so a run that failed, was rate-limit parked, or was parked for auto-recovery spent its
 * tokens and then carried no stamped figure at all — invisible to every consumer that reads
 * `status.json.tokens`, and precisely the runs whose spend is most worth seeing (retry waste concentrates
 * in them). Both pipelines call this one implementation rather than keeping a copy each.
 *
 * Restates rather than double-counts: `rollupTokens` recomputes from the append-only telemetry every
 * time, so a run that postpones, resumes and finally delivers ends on one correct total. `phase` records
 * which terminal wrote each event and the LAST one is the run's final word. Best-effort by contract — a
 * telemetry stamp must never affect a run, delivered or failed.
 */
export function stampTokenRollup(runDir, phase) {
  if (!runDir) return null;
  try {
    const tokens = rollupTokens(runDir);
    runLog(runDir, { event: "token-rollup", phase, ...tokens });
    writeRunStatus(null, { tokens }, runDir);
    const fmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
    const top = Object.entries(tokens.byModel).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
      .map(([m, v]) => `${m.split("/").pop()}=${fmt(v.input)}in/${fmt(v.output)}out`).join(" ");
    note(`run tokens (${phase}): ${fmt(tokens.total.input)} in / ${fmt(tokens.total.output)} out (cache ${fmt(tokens.total.cacheRead)} read / ${fmt(tokens.total.cacheWrite)} write) [${top}]`);
    // 's three instruments ride THIS call rather than getting call sites of their own. This function
    // already fires at every terminal of both pipelines — delivered, failed, cancelled, postponed,
    // recovery-parked — which is precisely the coverage the economics record needs, and adding seven new
    // call sites is how one gets missed (the knockout lane went a whole release without a token stamp for
    // exactly that reason). Its own try/catch: an economics failure must never cost the token stamp.
    try { stampRunEconomics(runDir, phase); } catch { /* measurement is never load-bearing */ }
    return tokens;
  } catch (e) {
    try { note(`token rollup failed (non-fatal): ${e.message}`); } catch { /* never mask a terminal */ }
    return null;
  }
}
