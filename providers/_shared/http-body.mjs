// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── A body that did not parse is ABSENT, and an absent body is not a counted zero ──────────────────
//
// Every register adapter used to end its HTTP helper with the same three lines, verbatim, in four
// adapters and six places:
//
//     let parsed = null;
//     try { parsed = JSON.parse(raw); } catch (_) { /* non-JSON */ }
//
// It reads as tolerance. It is not: the parse failure is DISCARDED, `body` stays null, and from that
// point on a caller cannot tell "the provider sent nothing usable" from "the provider sent an empty
// result set". A 200 whose body a proxy cut mid-stream — the status line says success, so every
// `res.ok` check sails past it — then normalizes to `{ total_hits: 0, results: [] }` and ships as
// `state:"enumerated"`: a confident, well-formed, complete "this mark is free" over a query that
// never landed. `isToolError` is false and the payload parses, so nothing downstream can catch it.
//
// That is the worst artifact this system can produce, and it is worse than a crashed run in exactly
// the way a wrong answer is worse than a missing one. A zero must always carry WHY it is zero.
//
// So the parse failure becomes a FACT that travels: `parseError` is non-null exactly when the body
// did not parse, and each core's tool entry points REFUSE on it (an `ERROR:` tool result) instead of
// normalizing it. The shared kernels then do the right thing for free — enumerate.mjs reads an
// `ERROR:` as a provider error and returns `state:"incomplete"`; count.mjs returns
// `{ ok:false, total:null }`; the per-term/per-class rescues disposition the term `error` rather than
// `verified-zero`.
//
// PURE: no node imports, no vendor HTTP.

/**
 * Parse a JSON response body, KEEPING the failure instead of swallowing it.
 *
 * An EMPTY body is unparseable by this definition, and deliberately so: a zero-byte 200 is a cut
 * connection or a gateway stub, never an empty result set — an empty result set is `{"rows":[]}`.
 *
 * @param {string} raw  the response text exactly as read off the wire.
 * @returns {{ body: any, parseError: string|null }}
 *   `body` is the parsed JSON, or null when it did not parse (unchanged from before, so every
 *   existing `r.body?.…` error-message reader behaves identically).
 *   `parseError` is null on success, and on failure the parser's own message plus the byte count —
 *   the two facts that distinguish a truncation from a gateway error page.
 */
export function parseJsonBody(raw) {
  try {
    return { body: JSON.parse(raw), parseError: null };
  } catch (err) {
    const bytes = typeof raw === "string" ? raw.length : 0;
    return { body: null, parseError: `${err?.message ?? String(err)} (${bytes} bytes read)` };
  }
}

/**
 * The one sentence every adapter says when it refuses an unparsed body. Provider-neutral by
 * construction: the caller names its own tool, so the vocabulary stays identical across providers
 * and a reader (or a grep) sees the same failure whatever register is wired in.
 */
export function unparsedBodyError(tool, r, extra = "") {
  return `ERROR: ${tool} — the provider returned HTTP ${r?.status ?? "?"} with an UNPARSEABLE body `
    + `(${r?.parseError ?? "no JSON"}). The response did not land, so there is no result set here: `
    + `an ABSENT body is not an empty one and must never be read as zero hits.${extra}`;
}

/**
 * The sibling refusal, for a body that PARSED but does not carry the answer's shape — an error
 * envelope served with a success status (`{"message":"upstream search cluster unavailable"}`), a
 * gateway stub, a wrong-endpoint payload. `parseError` cannot see these: the bytes are valid JSON.
 * The discrimination that matters is not "did the bytes parse" but "did the provider ANSWER the
 * question" — each adapter states, per endpoint, what an answer looks like (the response shape it
 * was probed to return) and refuses everything else through this sentence. Same `ERROR:` prefix,
 * so the shared kernels inherit it identically to the unparseable case: enumerate → `incomplete`,
 * count → `{ ok:false, total:null }`, the rescues → disposition `error`, never `verified-zero`.
 *
 * `expected` names the missing shape in the caller's own words (e.g. "a search response (no
 * totalHitCount, no rows, no nextRequest)"); the envelope's own message, when it carries one under
 * a conventional key, is quoted so the reader sees what the provider actually said.
 */
export function nonAnswerBodyError(tool, r, expected, extra = "") {
  const said = r?.body?.message ?? r?.body?.errorMessage ?? r?.body?.error?.detail ?? r?.body?.detail ?? null;
  return `ERROR: ${tool} — the provider returned HTTP ${r?.status ?? "?"} with a body that parsed but is NOT ${expected}`
    + `${said != null ? ` — the body says: ${JSON.stringify(String(said).slice(0, 160))}` : ""}. `
    + `The provider did not answer the question, so there is no result set here: a non-answer must `
    + `never be read as zero hits.${extra}`;
}
