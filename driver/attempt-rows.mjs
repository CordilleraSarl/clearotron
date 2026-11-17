// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// attempt-rows.mjs — what one row of a run's attempt log says: whether it is a provider attempt, and which model served it.
import { resolveModel } from "./driver.config.mjs";
import { engineStamp } from "./engine/stamps.mjs";

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
export function modelKey(rec) {
  if (typeof rec.modelUsed === "string" && rec.modelUsed) return rec.modelUsed;

  // NO STAMP. Two different situations, and guessing the same way for both is what caused the bug.
  const engine = typeof rec.engine === "string" ? rec.engine : "";

  // A TURN THAT NAMED NO MODEL, a native-language row recording `modelActual: null` (see isAttemptRow),
  // has no id at all. Its tokens still account, under a key that says the model is missing rather than
  // one built from the absent field. Asked FIRST, so no row keys as `undefined` because the catalog was
  // handed nothing to resolve.
  if (typeof rec.model !== "string") return `${engine || "unknown"}/no-model-reported`;

  // Rows predating the stamp are Anthropic — that was the only engine when they were written — and
  // resolving keeps every historical rollup keyed exactly as it was.
  //
  // A NATIVE-LANGUAGE ROW IS STAMPED WITH ITS VENDOR, NOT AN ENGINE (jxBillingStamp in jx-lanes.mjs), and
  // its `model` is the id that served the turn. An Anthropic one is normalised through the catalog like
  // any served Claude id, so it keys as `anthropic/claude-haiku-4-5`, apart from a stage's
  // `anthropic/claude-haiku` — the split ruled on and accepted with recording the tier. It used to fall
  // to the branch below and key as `anthropic/unstamped:<id>`, a name for a missing stamp on a row that
  // carries one. An OpenAI one keys as its served id, which is what an openai-agent stage row carries.
  const { catalog } = engineStamp(engine);
  if (!engine || catalog === "tier") return resolveModel(rec.model);
  if (catalog === "served") return rec.model;

  // Any OTHER engine with no stamp. The tier is not a model id and this catalog is not that engine's,
  // so there is no honest id to key under. Name the gap instead: the tokens still account (dropping
  // them would break byModel summing to total, and an invisible gap is the failure this file already
  // fixed once for byEngine), and the key says what is missing rather than asserting an Anthropic
  // model produced them.
  return `${engine}/unstamped:${rec.model}`;
}

/**
 * WHETHER A ROW IS A PROVIDER ATTEMPT, the one test rollupTokens and servedModels both apply. A row that
 * names a model is one: every stage attempt row carries the tier it asked for, and a native-language row
 * the id its turn reported. So is a native-language row whose turn ran and named no model, which records
 * `modelActual: null` instead (jxModelFields in jx-lanes.mjs). Without that second half, such a turn's
 * attempt and the tokens it reported were dropped from every total, and a run made only of such turns
 * read as one where nothing was looked at. A row with neither field is not a turn: the run log's events,
 * a tool call, a native-language call no provider served.
 */
export function isAttemptRow(rec) {
  return Boolean(rec) && (typeof rec.model === "string" || rec.modelActual === null);
}
