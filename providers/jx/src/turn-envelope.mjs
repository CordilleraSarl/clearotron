// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// turn-envelope.mjs — render a forced-tool request as a CLI-turn prompt, and read the turn's text back
// into the envelope the three lane parsers already understand. PURE. No driver import, no network.
//
// ── why this exists ( /) ─────────────────────────────────────────────────────────────────
//
// The jx lanes called the Anthropic Messages API directly with `tool_choice: {type:"tool"}`, on a key,
// at a hardcoded tier — regardless of which AI program the customer configured. The owner's standing
// rule is one vendor and one billing mode per run, never a mix, so the lanes move onto the run's chosen
// engine like every other model call in this product.
//
// TWO THINGS THE DIRECT API WAS DOING, and only one of them was ever written down as a reason.
//
//   1. `tool_choice` GUARANTEED THE SHAPE. A CLI turn cannot be forced, so the model is now ASKED for
//      the shape and the answer is validated — which is this engine's house pattern everywhere else.
//   2. `stop_reason: "max_tokens"` WAS THE TRUNCATION DEGRADE. core.js says why in place: a truncation
//      is byte-indistinguishable from a legitimate empty result, so it must surface as a degrade and
//      never as a quiet recall loss. That field is Messages-API-only.
//
// Losing (1) without replacing (2) is the whole danger, because every parser in this package answers a
// shape it cannot read with `[]`, and every lane wraps that in `ok: true`. On the judge lane an
// unreadable answer would mean every SERP hit comes back unclassified — which the report reads as NO
// ADVERSE HITS. So:
//
//   **"the answer block was absent" and "the answer block held zero rows" are different facts here.**
//
// `envelopeFromTurnText` returns `null` for the first and a real envelope for the second, and the lane
// functions turn `null` into `ok: false` with a cause. A model that answers "[]" is believed. A model
// that answers prose, a refusal or nothing is a degrade with a stated reason.

/** The instruction that replaces `tool_choice`: the shape, asked for rather than forced. */
export function shapeInstruction(tool) {
  const schema = JSON.stringify(tool?.input_schema ?? {}, null, 2);
  return [
    ``,
    `=== HOW TO ANSWER ===`,
    `Reply with ONE JSON object and NOTHING else — no prose before it, no prose after it, no markdown`,
    `fence, no explanation. It must validate against this schema:`,
    ``,
    schema,
    ``,
    `If the correct answer is that there is nothing to report, reply with the object carrying an EMPTY`,
    `array rather than with prose. An empty array is an answer; a sentence is not, and will be recorded`,
    `as a failure to answer rather than as a finding of nothing.`,
  ].join("\n");
}

/**
 * The prompt for one lane, from the request body that lane already builds. Reads `messages[0].content`
 * and the single entry in `tools`, so a lane that changes its prompt changes this with it and cannot
 * drift — there is no second copy of the wording here.
 */
export function promptFromRequest(body) {
  const text = String(body?.messages?.[0]?.content ?? "");
  const tool = Array.isArray(body?.tools) ? body.tools[0] : null;
  if (!text) throw new Error("jx-turn: request body carries no user message");
  if (!tool?.name) throw new Error("jx-turn: request body carries no tool to describe");
  return { prompt: text + "\n" + shapeInstruction(tool), toolName: tool.name };
}

/**
 * The first balanced JSON object in `text`, or null.
 *
 * Deliberately a scan and not a `JSON.parse` of the whole string: a CLI turn may wrap its answer in a
 * markdown fence or add a trailing newline, and refusing an otherwise-perfect answer over a fence would
 * turn a working lane into a degraded one. It is still strict about the thing that matters — the object
 * must PARSE — so a truncated or malformed answer is null, not a partial.
 */
export function firstJsonObject(text) {
  const s = String(text ?? "");
  for (let i = s.indexOf("{"); i !== -1; i = s.indexOf("{", i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = inStr; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(s.slice(i, j + 1)); } catch { break; }
      }
    }
  }
  return null;
}

/**
 * The turn's text as the `{content:[{type:"tool_use"…}]}` envelope every parser in this package reads,
 * or **null when nothing parseable was returned**.
 *
 * Null is the whole point. The parsers answer an unreadable shape with `[]`, which is indistinguishable
 * from a genuine empty result, so the distinction has to be made HERE — before a caller can wrap it in
 * `ok: true` and report "nothing found" for a turn that never answered.
 */
export function envelopeFromTurnText(text, toolName) {
  const obj = firstJsonObject(text);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  return { content: [{ type: "tool_use", name: toolName, input: obj }] };
}

/**
 * One lane's call, end to end: render → turn → truncation check → envelope → parse. The three lanes
 * differ only in the body they build, the cause they name for a truncation, and the parser they run,
 * so the ORDER of those checks lives here once rather than three times.
 *
 * `turn` is supplied by the driver and is injectable for tests:
 *   async ({prompt, kind}) => { ok, text, truncated, usage:{input,output}, model, vendor, authMode, cause }
 *
 * ATTRIBUTION RIDES EVERY RETURN, including the failures. A degrade still spent tokens, and without the
 * model, vendor and billing mode beside them they cannot be attributed in the run's rollup — which is
 * the half of that says a run must be able to state who did the work.
 */
export async function runJxTurn({ body, turn, kind, started, truncatedCause, parse }) {
  const t0 = Number.isFinite(started) ? started : Date.now();
  const blank = { tookMs: 0, model: null, vendor: null, authMode: null, usage: null };
  if (typeof turn !== "function") return { ok: false, cause: `${kind}: no turn runner was supplied`, ...blank };

  const { prompt, toolName } = promptFromRequest(body);
  let r;
  try { r = await turn({ prompt, kind }); }
  catch (e) { r = { ok: false, cause: `${kind} turn threw: ${String(e?.message ?? e).slice(0, 200)}` }; }

  const attribution = {
    tookMs: Date.now() - t0,
    model: r?.model ?? null, vendor: r?.vendor ?? null, authMode: r?.authMode ?? null,
    // Passed through WHOLE, and `null` stays null. The driver hands over the engine contract's canonical
    // Usage ({input, output, cacheRead, cacheWrite, total}); re-shaping it to two fields here would drop
    // cache and total tokens from the rollup, and a zeroed object in place of null would report a
    // measurement nobody took. Tokens only — never currency.
    usage: r?.usage ?? null,
  };
  if (!r?.ok) return { ok: false, cause: r?.cause || `${kind}: the turn did not complete`, ...attribution };
  // The truncation degrade, carried across the transport change. It was `stop_reason: "max_tokens"` on
  // the Messages API; on the engine seam it is the adapter's output-ceiling fault, which the driver's
  // turn runner maps to this flag. Losing it would make a truncated answer byte-indistinguishable from
  // a short one — in the lane whose job is native-script recall.
  if (r.truncated) return { ok: false, cause: truncatedCause, ...attribution };

  const envelope = envelopeFromTurnText(r.text, toolName);
  // THE ONE THAT MAKES THE TRANSPORT SWAP SAFE. `tool_choice` used to guarantee the shape; asking for it
  // cannot. Every parser in this package answers a shape it cannot read with `[]`, and a caller that
  // wrapped that in `ok: true` would report an unanswered judge batch as "no adverse hits". So an
  // unreadable answer is a degrade with a stated cause, and only a PARSED object reaches `parse`.
  if (!envelope) return { ok: false, ...attribution,
    cause: `${kind}: the turn returned no readable answer object — recorded as a degrade, never as an empty result` };

  return { ok: true, ...parse(envelope), ...attribution };
}
