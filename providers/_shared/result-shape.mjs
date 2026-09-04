// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── THE NEUTRAL TOOLS' RESULT VOCABULARY ─────────────────────────────────────────────────────────
//
// `register_batch_screen`, `register_search` and `register_enumerate` are NEUTRAL tools: one name, one
// contract, whichever provider is wired. The MCP `inputSchema` constrains what goes IN. Nothing
// constrained what came back, so three providers answered the same tool in two vocabularies and every
// test passed — each provider's tests assert its own shape, and the composite's tests used stubs
// returning whatever the composite happened to read.
//
// What that costs is never an exception. A consumer reads one name, gets `undefined`, and `undefined`
// becomes `[]` at the first `?? []`. Batch screen decides which surfaced records are IN SCOPE, so an
// empty list reads downstream exactly like "nothing matched" — a clean negative over records nobody
// looked at. That is what the free tier shipped, error-free, from until.
//
// ── what this file is, and what it is NOT ────────────────────────────────────────────────────────
//
// It is a DECLARATION plus a checker, and it is enforced by a gate that drives every provider that
// exposes the tool (providers/_shared/test/neutral-result-shape.test.mjs). It is deliberately NOT
// imported by any provider core or by the driver: the tool result text IS the model's prompt surface,
// so a runtime check that rewrote, reordered or rejected a response body would change what the seat
// reads. Everything declared below is what the providers ALREADY return on origin/main — the point is
// that a future provider cannot quietly stop returning it.
//
// A declaration nothing drives goes stale and then lies, which is worse than none. Hence the gate
// calls the real `doBatchScreen` of every provider against stubbed transport rather than asserting
// over hand-written fixtures of what we believe they return.

/** The closed set `screenVerdict()` produces. The digest tells the seat this field is the keep/drop
 *  authority ("NOT the mark name or owner"), so a row without it leaves the model no authority to
 *  read and a row with an unknown value leaves it guessing. Cross-checked against the implementation
 *  by the gate, so this cannot drift from providers/_shared/screen.mjs. */
export const SCREEN_VERDICTS = Object.freeze([
  "drop:dead",
  "drop:out-of-class",
  "surface:in-scope-live",
  "surface:all-class",
  "deepfetch:ambiguous",
]);

/**
 * The declared shape of each neutral tool's success result, as parsed from its `text` payload.
 *
 * `list` is THE name. `listAliases` are names that already exist in shipped payloads and must stay
 * element-identical to `list` if present — an alias that diverges from the thing it aliases is worse
 * than no alias, because both look authoritative. `reservedScalars` are keys whose NAME reads like a
 * collection but whose value is a scalar; they are the specific trap this contract exists to stop
 * being read as a row list, and they are declared rather than renamed (see `screened`, below).
 */
export const NEUTRAL_TOOL_RESULT_SHAPE = Object.freeze({
  register_batch_screen: Object.freeze({
    list: "rows",
    listAliases: Object.freeze(["results"]),
    // An id the register did not answer is NOT a screening verdict. It rides separately so a short
    // `rows` can never be read as "these were screened and found clean" (euipo; the free tier merges
    // its members' into one).
    optional: Object.freeze(["not_found"]),
    // ── the row identity: TWO spellings, reconciled per provider ─────────────────────────────────
    // corsearch and clarivate rows carry `uri`; euipo, uspto-local and the free tier carry
    // `record_id`. That is the same defect family as the list name, one level down — and the reason
    // it has not bitten is not that anyone noticed: it is that each provider declares its own
    // `screenJoinKey` to makeEnumerate, and the two providers whose rows say `record_id` declare
    // `screenSource: "search-row"`, so the kernel's join path never runs for them at all.
    //
    // So the invariant is NOT "every row says uri". It is: every row carries one of these, and the
    // key the provider's own kernel is configured to join on is the one its own doBatchScreen emits.
    // See BATCH_SCREEN_JOIN_KEY.
    row: Object.freeze({ identity: Object.freeze(["uri", "record_id"]), verdict: "screen_verdict" }),
    // euipo answers `screened: <count>`. The free tier's pre- read was
    // `parsed.rows ?? parsed.screened ?? parsed.results ?? parsed.records` — on euipo that chain
    // resolves an INTEGER as the screening result the moment `rows` is ever absent. The key is NOT
    // renamed here: the response text is the seat's prompt surface and euipo's own callers read it.
    // It is declared as a scalar so the gate fails if it ever becomes a list, and so anyone reading
    // this file learns the trap instead of rediscovering it.
    reservedScalars: Object.freeze({ screened: "number", asked: "number" }),
  }),
  // Audited alongside batch screen ('s "worth checking at the same time"): NO split. Every
  // provider that implements search answers `results[]` — corsearch and clarivate through
  // `normalizeSearchResponse`, euipo/uspto-local/free-tier directly — and the driver reads exactly
  // that name (driver/driver.config.mjs:779, :949).
  register_search: Object.freeze({
    list: "results",
    listAliases: Object.freeze([]),
    optional: Object.freeze(["total_hits", "has_more", "next_page_token"]),
    row: Object.freeze({ identity: "record_id", verdict: null }),
    reservedScalars: Object.freeze({ total_hits: "number-or-null" }),
  }),
  // Also audited, and this one has a split WITHIN the tool rather than across providers: the list's
  // name depends on `state`. `enumerated` carries `records[]`; `incomplete` carries `sample[]` (a
  // truncated 20) and NO `records`. A consumer reading `records` on an incomplete result gets
  // `undefined` — the same false clean one state away. Both spellings come from the shared kernel
  // (providers/_shared/enumerate.mjs), and the free tier reproduces the pair by hand.
  register_enumerate: Object.freeze({
    listByState: Object.freeze({ enumerated: "records", incomplete: "sample" }),
    optional: Object.freeze(["total_hits", "count", "fetched", "reason", "term_counts", "class_counts"]),
    row: Object.freeze({ identity: "record_id", verdict: null }),
  }),
});

/**
 * Which identity key each provider's enumerate kernel joins screen rows back to the band on.
 *
 * `null` = the provider passes no `screenJoinKey` and inherits the kernel default, which is `uri`
 * (providers/_shared/enumerate.mjs). Declared here so the gate can prove the configuration and the
 * emitted rows agree per provider — the check that would fail the day someone flips euipo or
 * uspto-local off `screenSource: "search-row"` and the join path starts running for real.
 */
export const BATCH_SCREEN_JOIN_KEY = Object.freeze({
  corsearch: null,              // kernel default → uri
  clarivate: "uri",
  euipo: "record_id",
  "uspto-local": "record_id",   // declared `record_id ?? uri`; record_id is what the rows carry
  "free-tier": "record_id",     // no kernel of its own — its rows are its members', unmodified
});

/** The kernel default `screenJoinKey` resolves. Pinned by the gate against enumerate.mjs. */
export const DEFAULT_JOIN_KEY = "uri";

const isArr = Array.isArray;

/**
 * Check one parsed `register_batch_screen` payload against the declaration.
 *
 * Returns a list of violation sentences — EMPTY means conforming. A caller that treats a non-empty
 * list as "warnings" has misread it: every entry below is a shape a consumer would read as an empty
 * screen.
 */
export function batchScreenViolations(parsed, { label = "provider" } = {}) {
  const out = [];
  const spec = NEUTRAL_TOOL_RESULT_SHAPE.register_batch_screen;
  if (!parsed || typeof parsed !== "object" || isArr(parsed)) {
    return [`${label}: the result is not a JSON object — nothing can be read from it`];
  }
  const keys = Object.keys(parsed);

  if (!isArr(parsed[spec.list])) {
    out.push(`${label}: no \`${spec.list}\` array (keys: ${keys.join(", ") || "none"}). `
      + `\`${spec.list}\` is the neutral result vocabulary for register_batch_screen; a provider `
      + `answering in another name screens zero records and looks downstream exactly like "nothing matched".`);
    return out; // everything below is about the rows, and there are none to speak of
  }

  for (const alias of spec.listAliases) {
    if (!(alias in parsed)) continue;
    if (!isArr(parsed[alias])) {
      out.push(`${label}: \`${alias}\` is present but is not an array. It is a declared alias of `
        + `\`${spec.list}\` and must carry the same rows or not appear at all.`);
      continue;
    }
    if (parsed[alias].length !== parsed[spec.list].length) {
      out.push(`${label}: \`${alias}\` (${parsed[alias].length}) and \`${spec.list}\` `
        + `(${parsed[spec.list].length}) disagree on how many records were screened. Two authoritative-looking `
        + `lists of different lengths is worse than one name.`);
    }
  }

  for (const [key, kind] of Object.entries(spec.reservedScalars)) {
    if (!(key in parsed) || parsed[key] == null) continue;
    if (isArr(parsed[key])) {
      out.push(`${label}: \`${key}\` is an array. It is declared a ${kind} — a collection-shaped NAME `
        + `holding a count is the specific trap this contract exists to stop, and turning it into a real `
        + `list makes both readings plausible at once.`);
    } else if (kind === "number" && typeof parsed[key] !== "number") {
      out.push(`${label}: \`${key}\` is ${typeof parsed[key]}, declared ${kind}.`);
    }
  }

  if ("not_found" in parsed && parsed.not_found != null && !isArr(parsed.not_found)) {
    out.push(`${label}: \`not_found\` must be an array of unanswered ids or absent. An unanswered id is `
      + `not a screening verdict and may never be folded into \`${spec.list}\`.`);
  }

  const verdicts = new Set(SCREEN_VERDICTS);
  parsed[spec.list].forEach((row, i) => {
    if (!row || typeof row !== "object") { out.push(`${label}: ${spec.list}[${i}] is not an object`); return; }
    const names = spec.row.identity;
    const id = names.map((k) => row[k]).find((v) => typeof v === "string" && v);
    if (!id) {
      out.push(`${label}: ${spec.list}[${i}] carries no identity — none of ${names.join("/")} is a `
        + `non-empty string. That is what the enumerate kernel joins screen rows back to the band on `
        + `(providers/_shared/enumerate.mjs \`screenJoinKey\`); without it the row's content is silently `
        + `dropped and the record ships with null mark text under state:"enumerated".`);
    }
    const v = row[spec.row.verdict];
    if (!verdicts.has(v)) {
      out.push(`${label}: ${spec.list}[${i}] (${id ?? "unidentified"}) carries screen_verdict `
        + `${JSON.stringify(v)}, which is outside the closed set. The digest tells the seat this field is `
        + `the keep/drop authority — an unknown value leaves it guessing on a real conflict.`);
    }
  });

  return out;
}

/** True when a tool result is the providers' shared ERROR envelope rather than an answer. Every
 *  kernel keys on this prefix, so a checker that asserted shape over an error string would be
 *  asserting over a refusal it mistook for a pass. */
export function isToolErrorResult(r) {
  return typeof r?.text === "string" && r.text.startsWith("ERROR");
}
