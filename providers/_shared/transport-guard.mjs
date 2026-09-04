// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Transport guard — a network REJECTION is a provider error, not an aborted stage ─────────────────
//
// A register that answers 503 is already handled everywhere: the provider's HTTP helper returns a tool
// result, `isToolError` sees it, and the enumerate kernel degrades THAT ONE query to
// {state:"incomplete", reason:"provider error …"}. A register that never answers at all — ETIMEDOUT,
// ECONNRESET, EAI_AGAIN, a socket hang-up — took a completely different route: the rejection propagated
// out of the provider's fetch helper, out of `enumerate`, out of `executePlan`, and killed the stage.
// A register plan carries tens of queries, so ONE routine timeout on one of them lost all of them.
//
// The asymmetry was never a decision, it was a gap. The provider fetch layer's own catch is deliberate
// and says so ("record the failed call, then preserve the original propagate behaviour") — it is the
// layer that knows about the wire, and re-raising there is right. What was missing is anything ABOVE it
// catching. That is here: the KERNEL's I/O seams. Every provider builds its enumerate / execute-plan /
// count out of these kernels by handing them `search` / `count` / `screen` / `enumerate` dependencies,
// so wrapping those dependencies covers every provider at once — including the ones whose exported
// wrapper does extra live work outside the kernel (clarivate resolves owner names before it enumerates).
//
// ══ WHY THE SEAM AND NOT THE KERNEL BODY ═══════════════════════════════════════════════════════════
//
// These wrappers go around the DEPENDENCY CALL, never around a kernel function's body. The distinction
// is load-bearing: an I/O dependency throwing is an expected fact about networks and must degrade; a
// kernel-internal TypeError is a BUG and must stay loud. Wrapping the body would swallow both, and the
// second one silently — which is how a defect ships as an "incomplete" for months.
//
// ══ NO NEW VOCABULARY ══════════════════════════════════════════════════════════════════════════════
//
// A converted rejection re-enters the EXISTING path, it does not open a new one. `guardToolCall` returns
// the tool-error shape the 503 path already produces, so the enumerate kernel writes its own
// "provider error during enumeration (page N)" and execute-plan then stamps error:true with
// "provider error (after one in-tool retry)" — byte-identical framing to an outage. `guardCountCall`
// returns the {ok:false, total:null} shape count.mjs already returns on every failure, honouring that
// file's one rule: nothing can produce a 0 that was not counted.
//
// TRANSIENT, NEVER DEFERRED: the text must never contain execute-plan's CAPABILITY_GAP_MARKER, or a
// timeout would be stamped `deferred:true` and disclosed as a permanent capability the provider lacks,
// instead of riding the repair ladder that a transient fault is supposed to ride. A network that did
// not answer this second may answer the next, which is the whole definition of transient. `faultText`
// strips the marker; an agreement test pins the literal below to the real export.
//
// RETRIES STAY BOUNDED: nothing here retries. The conversion happens once, at the seam, and the ONE
// in-tool retry execute-plan already performs is the only repeat — a timeout costs exactly the same
// bounded number of attempts an outage costs.

// Mirrors CAPABILITY_GAP_MARKER in ./execute-plan.mjs. Duplicated rather than imported to keep this
// module dependency-free (execute-plan imports THIS); providers/_shared/test/kernel-seams.test.mjs
// pins the two together so they cannot drift.
const CAPABILITY_GAP_MARKER_MIRROR = "capability-gap:";

/**
 * Render a thrown transport rejection as one short diagnostic line.
 *
 * The CODE leads, deliberately: every consumer of this text truncates it (the enumerate kernel at 140
 * chars, execute-plan's count descriptor at 100), and `ETIMEDOUT` vs `ECONNRESET` vs `EAI_AGAIN` is the
 * whole diagnostic payload — put it last and it is the first thing cut.
 *
 * `cause` is read as well as `code`, and that is the case that actually matters in production: undici
 * (node's fetch) reports EVERY transport fault as the same opaque `TypeError: fetch failed` and hides
 * the real errno on `err.cause`. Reading only the top level would stamp every live timeout, reset and
 * DNS failure with one indistinguishable string — which is exactly the "a zero must carry WHY" problem
 * one layer up.
 */
export function faultText(err, where = "provider") {
  const code = err?.code ?? err?.cause?.code ?? err?.errno ?? err?.cause?.errno ?? null;
  const message = String(err?.message ?? err ?? "unknown cause");
  const causeMessage = err?.cause?.message ? String(err.cause.message) : "";
  const detail = causeMessage && causeMessage !== message ? `${message} (${causeMessage})` : message;
  const line = `${code ? `${code} — ` : ""}transport failure on the ${where} call (no response from the provider): ${detail}`;
  // Belt and braces: a fault is TRANSIENT by construction and must never read as a capability gap.
  return line.split(CAPABILITY_GAP_MARKER_MIRROR).join("capability-gap ");
}

export const __CAPABILITY_GAP_MARKER_MIRROR = CAPABILITY_GAP_MARKER_MIRROR;

/**
 * Wrap an I/O dependency that returns a TOOL RESULT ({ text } / { isError }) — `search`, `screen`,
 * `enumerate`. A rejection becomes the tool-error shape a 5xx already produces, so every caller's
 * existing `isToolError` branch handles it with no new code and no new state.
 *
 * A non-function is passed through untouched: several deps are legitimately absent (a provider with no
 * `count`, a provider that screens off the search row), and the kernels already guard on their type.
 */
export function guardToolCall(fn, where = "provider") {
  if (typeof fn !== "function") return fn;
  return async function guardedToolCall(...args) {
    try {
      return await fn(...args);
    } catch (err) {
      return { isError: true, text: `ERROR: ${faultText(err, where)}` };
    }
  };
}

/**
 * Wrap the `count` dependency, whose contract is { ok, total, reason } rather than a tool result. The
 * failure shape is count.mjs's own: ok:false with total NULL — never 0, because "we could not ask" and
 * "we asked and the answer is none" must never be confusable.
 */
export function guardCountCall(fn, where = "count") {
  if (typeof fn !== "function") return fn;
  return async function guardedCountCall(...args) {
    try {
      return await fn(...args);
    } catch (err) {
      return { ok: false, total: null, reason: faultText(err, where) };
    }
  };
}
