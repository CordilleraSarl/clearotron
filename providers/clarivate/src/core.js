// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Clarivate register adapter — pure logic + HTTP helpers + telemetry, with ZERO plugin-SDK or
// TypeBox imports (node built-ins, global fetch and providers/_shared only). Everything this provider
// does lives here: driver/engine/mcp/clarivate-server.mjs wraps the module as a standalone MCP server,
// driver.config.mjs lazy-imports it for the in-process lanes, and the tests import it directly.
//
// PACKAGING NOTE: this core imports the shared ledger, screen primitives and enumerate kernel from
// ../../_shared/ — a sibling of src/, NOT inside it. Any packaging step that copies only src/ → dist/
// must be widened to carry providers/_shared/ alongside it.
//
// HOW THIS MODULE USES THE API:
//   * INT_CLASS_NUMBER takes an OR-list, so N classes = ONE call and there is no per-class fan-out —
//     the OR-list returns the deduplicated union of the single-class queries;
//   * query building uses the vendor's NATIVE booleans and wildcards inside the value string;
//   * enumerate runs on the shared kernel with countProbe:"endpoint" (POST /count first, then ONE
//     /search that returns the COMPLETE guid set);
//   * screening runs on the shared screenVerdict, so the verdict vocabulary is IDENTICAL to corsearch's;
//   * POST /resolution/company gives the owner sweep an exact-applicant resolution corsearch cannot do.
//
// PROVIDER-ABSTRACTION CONTRACT (one register provider is active at a time — never both):
//   - search results carry a Corsearch-shaped synthetic record_id `/mark/<office>/<guid>` so the
//     driver's URI machinery (pipeline CITED_URI_RE, screen-gate URI_RE, registry-fidelity artifact
//     round-trip) works for Clarivate UNCHANGED.
//   - record_fetch persists a NORMALIZED record body under that same id, using the neutral field names
//     registry-fidelity already reads (applicationNumber / registrationNumber / applicationDate /
//     registrationDate) plus a neutral statusClass — so the citation-fidelity gate is provider-blind.
//   - the per-call ledger uses the SAME schema + the SAME files the corsearch plugin and the driver use
//     (provider-usage + registry-fidelity read them with zero path change); each row carries a
//     `provider` discriminator. (The file names are vendor-neutral — `register-calls.jsonl` /
//     `register-records.jsonl`; providers/_shared/ledger-path.mjs still resolves the older
//     `corsearch-*` names on a box that already has them.)

import { makeLedger } from "../../_shared/ledger.mjs";
import { nonAnswerBodyError, parseJsonBody, unparsedBodyError } from "../../_shared/http-body.mjs";
import {
  BATCH_SCREEN_CHUNK, chunk, isAllClass, makeClassifyStatus, screenVerdict,
} from "../../_shared/screen.mjs";
import { makeEnumerate, ENUMERATE_NAMES_CHUNK_DEFAULT, parseToolText } from "../../_shared/enumerate.mjs";
import { makeCountProbe } from "../../_shared/count.mjs";
import { CAPABILITY_GAP_MARKER, defaultBuildEntryQuery, makeExecutePlan, makeRegionRequiredBuildEntryQuery, planPredicateParams } from "../../_shared/execute-plan.mjs";
import { isNonLatinTerm } from "../../_shared/script-form.mjs";
import { CAPABILITIES, CLARIVATE_OFFICE_CODES } from "./capabilities.js";

export const DEFAULT_BASE = "https://api.clarivate.com/compumark-content/api/v1";

export { CAPABILITIES, ENUMERATE_NAMES_CHUNK_DEFAULT };
export { BATCH_SCREEN_CHUNK, chunk, isAllClass, screenVerdict };

// ── Telemetry: shared register ledger (providers/_shared/ledger.mjs) ──────────────────────────────
// ONE implementation, shared with the corsearch and signa cores: the same per-call / per-record JSONL
// files (CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG — the wire contract with provider-usage.mjs,
// registry-fidelity.mjs, coverage-ledger.mjs and gather-config.mjs's serverEnv), the same row schema,
// with `provider:"clarivate"` as the discriminator. The ids logged (agentId/sessionKey/sessionId) are
// the GATEWAY tool-call context, NEVER the X-ApiKey.
export const { logCall, logRecordBody, tctxOf } = makeLedger("clarivate");

// ── Synthetic record-id (ref) grammar ─────────────────────────────────────────────────────────────
// Clarivate records are opaque guids with no public URL. We mint a Corsearch-shaped synthetic id
// `/mark/<office>/<guid>` (office lowercased) so every driver gate that greps `/mark/<cc>/<id>` works
// unchanged. `office` ALWAYS comes from the search ids[] key / the record's registrationOfficeCode —
// NEVER from the guid (the guid prefix is not the office code).
export function makeRef(office, guid) {
  return `/mark/${String(office || "xx").toLowerCase()}/${guid}`;
}
const REF_RE = /^\/mark\/([a-z]{2,4})\/(.+)$/i;
// Accept a synthetic `/mark/<office>/<guid>` ref OR a bare guid; return the guid for the /text call.
export function refToGuid(ref) {
  const m = REF_RE.exec(String(ref ?? "").trim());
  return m ? m[2] : String(ref ?? "").trim();
}
export function refToOffice(ref) {
  const m = REF_RE.exec(String(ref ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

// ── HTTP helper (with the metered chokepoint) ──────────────────────────────────────────────────────
export async function clarivateFetch(apiKey, base, path, { body = null, method = "POST", retries = 1, tctx = null } = {}) {
  const url = `${base}${path}`;
  const headers = { "X-ApiKey": apiKey, "Accept": "application/json" };
  const init = { method, headers };
  if (body !== null) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }

  const t0 = Date.now();
  let attempts = 0;
  let resp;
  try {
    for (let i = 0; i <= retries; i++) {
      attempts = i + 1;
      resp = await fetch(url, init);
      if (resp.ok || resp.status < 500 || i === retries) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  } catch (err) {
    logCall(tctx, { http_status: 0, ok: false, attempts, took_ms: Date.now() - t0, bytes: 0, cache_hit: false });
    throw err;
  }

  const raw = await resp.text();
  // The parse failure travels on `parseError` instead of being swallowed — providers/_shared/http-body.mjs.
  const { body: parsed, parseError } = parseJsonBody(raw);
  logCall(tctx, { http_status: resp.status, ok: resp.ok, attempts, took_ms: Date.now() - t0, bytes: raw.length, cache_hit: false });
  return { status: resp.status, ok: resp.ok, url, body: parsed, raw, parseError };
}

const errText = (r) => r?.body?.errorMessage ?? r?.body?.message ?? (r?.raw ? String(r.raw).slice(0, 200) : "");

// ══ QUERY BUILDING ═════════════════════════════════════════════════════════════════════════════════
//
// Compumark Content puts its whole query language INSIDE the searchFields[].value string: booleans
// (OR/AND/NOT), the ADJ adjacency operator, parentheses, and `*`/`?` wildcards. A bare space is an
// implicit AND, so a phrase is written with ADJ (`*CORAL ADJ PUP*`), never with a space.
// capabilities.js declares the limit per predicate; every mapping below matches it.

// The single mark field. Booleans + wildcards live in the value, so ONE searchField carries a whole
// OR-stack — the operator stays EQUALS and the value does the vendor's query-string work.
export const MARK_FIELD = "WORD_MARK_SPECIFICATION";
export const OWNER_FIELD = "APPLICANT_NAME";

/**
 * match_mode → { name, operator, pre, post, … }.
 *
 * `default` is a TRUE contains (`*term*`, probe: *NIK* = 806) — the old EQUALS mapping silently lost
 * recall and is gone. `exact` strips punctuation client-side (the EXACT field is case-insensitive but
 * punctuation-SENSITIVE). `wildcard` passes the caller's metacharacters through untouched — no
 * BEGINS_WITH/ENDS_WITH remapping is needed because `*`/`?` are native in the value; its only
 * rewriting is the phrase compile every mark mode gets (a space would otherwise be an implicit AND).
 * The CONTAINS *operator* is never emitted anywhere: it is a hard HTTP 400 on APPLICANT_NAME, and on
 * the mark field the value wildcard covers it.
 */
// `pre`/`post` are the wildcard wrap. They are applied to the FIRST and LAST token, not to the whole
// string, so a multi-word term compiles to `*TOK1 ADJ TOK2*` — see compilePhraseValue.
export const MATCH_MODE_TO_FIELD = Object.freeze({
  default:     { name: MARK_FIELD, operator: "EQUALS", pre: "*", post: "*", phrase: true, dropReserved: true },
  contains:    { name: MARK_FIELD, operator: "EQUALS", pre: "*", post: "*", phrase: true, dropReserved: true },
  exact:       { name: "EXACT_WORD_MARK_SPECIFICATION", operator: "EQUALS", pre: "", post: "", exact: true },
  phonetic:    { name: "PHONETIC_WORD_MARK_SPECIFICATION", operator: "EQUALS", pre: "", post: "", phrase: true, dropReserved: true },
  // `wildcard` is a RAW-PATTERN passthrough: the caller wrote the metacharacters themselves, so an
  // operator word here may well be the operator they meant. Phrase-compiled like the rest, but NOT
  // escaped — a boolean-looking pattern still fails loudly rather than being silently reinterpreted.
  wildcard:    { name: MARK_FIELD, operator: "EQUALS", pre: "", post: "", allowWildcard: true, phrase: true },
  starts_with: { name: MARK_FIELD, operator: "EQUALS", pre: "", post: "*", phrase: true, dropReserved: true },
  begins_with: { name: MARK_FIELD, operator: "EQUALS", pre: "", post: "*", phrase: true, dropReserved: true },
  ends_with:   { name: MARK_FIELD, operator: "EQUALS", pre: "*", post: "", phrase: true, dropReserved: true },
});

// ── A SPACE IS AN IMPLICIT *AND*, AND `ADJ` IS THE PHRASE OPERATOR ────────────────────────────────
//
// This replaces the old `spaceUnsafe` refusal, which rested on ONE misread datapoint: a two-word
// query returning 0 on the mark field was read as a space breaking the query; the
// follow-up then found spaces working on APPLICANT_NAME and concluded the two FIELDS differ. Both
// readings were wrong. The behaviour is:
//
//   *TWO WORDS*  ==  *TWO* AND *WORDS*      a space is an implicit AND
//   *A B*        ==  *B A*                  …and it is ORDER-BLIND
//   a two-word term can be 0 while each word alone is not — nothing is BOTH, which is not broken
//
// So multi-word terms were never silently zero; they were never SENT. The fields never differed. What
// the space is NOT is a phrase match — and a phrase operator exists, absent from the vendor's schema but
// solid on the wire:
//
//   MONSTER ADJ ENERGY = 67   ENERGY ADJ MONSTER = 0     ordered adjacency == phrase-contains
//   CORAL ADJ PUP   = 11   PUP ADJ CORAL   = 0
//   MOUNTAIN ADJ DEW ADJ VISIONARY = 1                   chains past two tokens (that mark was READ,
//                                                        not guessed — /search + /text, 49 texts)
//   *MOUNTAIN ADJ DEW* OR *MONSTER ADJ ENERGY* = 157 = 90 + 67    survives an OR-stack, exact sum, and
//   (…) OR (…) = 157 too                                 ADJ binds TIGHTER than OR — no parens needed
//
// A phrase is therefore EXPRESSIBLE, so doctrine 2 says express it. Precision beats the space's AND
// (67 ≤ 75), which matters: the AND would have quietly widened every multi-word slice.
//
// Two caveats, both recorded rather than hidden:
//   · There is NO string anchor for a phrase. `BEGINS_WITH "DIET MOUNTAIN"` = 9 > `DIET ADJ MOUNTAIN`
//     = 7, i.e. the operator degrades to per-token AND. So multi-word `starts_with`/`ends_with` become
//     phrase-CONTAINS — a strict superset of what was asked. Safe in a clearance sweep, which fails by
//     MISSING a mark and never by surfacing an extra one, but it is a widening and it is disclosed.
//   · Punctuation is not indexed (`MOUNTAIN ADJ DEW ADJ HI-RES` == `… HI ADJ RES` == 1), so a
//     punctuation-only token is dropped from the chain. Kept, it matches nothing and would zero the
//     whole phrase — `TIKI ADJ & ADJ SLUSH` = 0.
const PHRASE_OPERATOR = "ADJ";
// ── A TERM MUST BE ONE MARK, ON EVERY MARK-FIELD PREDICATE ────────────────────────────────────────
// The supplemental/cross-check lanes sometimes mint a LIST or a DESCRIPTION into the term field. All
// three of these appeared in one frozen plan, EACH minted twice — once `default`,
// once `exact`:
//   "SLUSH FREEZE, SLUSH ICE, SLUSH POP"                     three terms crammed into one
//   "TIKTOK / TIK- famous-neighbour family"                  a description of a family, not a name
//   "TIKE, TIPI one-keystroke neighbours of TIKI"
//
// Searched, they return 0 — and a 0 here reads as CLEAN, which is the one outcome this contract must
// never produce by accident. On that run the `default` twins deferred loudly while the `exact` twins
// came back `state:"enumerated"`, i.e. SILENTLY CLEAN. Same nonsense term, two opposite dispositions,
// and the quiet one is the dangerous one. `exact` was never guarded because stripPunctuation quietly
// dissolves the very separators that give the shape away — so the check runs on the RAW term, before
// any stripping, on every mark-field predicate rather than only the phrase ones.
//
// The bound is measured, not guessed. That plan's 86 exact terms: 54 one-word, 24 two-word, and a tail
// at 3/5/6/7 — every genuine mark and slogan at or under SEVEN. The prose one was fourteen, and it is
// the only exact term over eight. A separator is likewise carried by the three prose terms and nothing
// else.
const LIST_SEPARATOR_RE = /[,;/]|\betc\b/i;
const MAX_PHRASE_TOKENS = 8;

/**
 * Reject a term that is a LIST or a DESCRIPTION rather than one mark. Throws (→ a disclosed deferred
 * coverage row); returns the token list when the shape is fine.
 */
export function assertSingleMarkShape(rawTerm) {
  const raw = String(rawTerm ?? "").trim();
  const tokens = raw.split(/\s+/).filter((t) => t && !PUNCT_ONLY_RE.test(t));
  if (!tokens.length) throw new Error(`term ${JSON.stringify(raw)} has no searchable token`);
  if (tokens.length > 1 && LIST_SEPARATOR_RE.test(raw)) {
    throw new Error(`term ${JSON.stringify(raw)} looks like a LIST or a description, not one mark — it carries a `
      + `separator (, ; / etc). It would be searched as one long name and come back 0, which reads as CLEAN. `
      + `Send one mark per term instead.`);
  }
  if (tokens.length > MAX_PHRASE_TOKENS) {
    throw new Error(`term ${JSON.stringify(raw)} has ${tokens.length} words, past the ${MAX_PHRASE_TOKENS}-word bound `
      + `for a single mark — it reads as prose rather than a name. It would be searched as one long name and come `
      + `back 0, which reads as CLEAN. Send the mark itself.`);
  }
  return tokens;
}
// Read as OPERATORS wherever they stand alone in a value string, case-insensitively ("monster adj
// energy" = 67), with an optional proximity digit (ADJ2 = 72).
const RESERVED_TOKEN_RE = /^(?:AND|OR|NOT|ADJ|NEAR)\d*$/i;
const PUNCT_ONLY_RE = /^[^\p{L}\p{N}]+$/u;

/**
 * An operator word inside a phrase is DROPPED, and the gap it leaves is spanned by widening that one
 * adjacency to `ADJ<n+1>`.
 *
 * The obvious move — make the word lexically stop being an operator with an interior `?` — is WRONG,
 * and measurably so. Registers write these marks with an ampersand, not the word:
 *
 *   *BLACK ADJ A?D ADJ DECKER*   0      ← what the `?` escape asks for, and nothing is named that
 *   *BLACK ADJ DECKER*          55      ← BLACK & DECKER
 *   *BLACK ADJ2 DECKER*         55      ← identical: the connector is not indexed, so spanning costs nothing
 *   *BEN ADJ A?D ADJ JERRYS*     0   vs  *BEN ADJ JERRYS*  25
 *
 * A zero over a mark that exists is the failure this whole contract is built to prevent, so the escape
 * is gone. Dropping + `ADJ2` is right whether or not the index holds the word: if it is a stopword the
 * neighbours are already adjacent (55 == 55 above), and if some register does index it the widened
 * adjacency still reaches across. It is a superset of the literal phrase — safe in the direction a
 * clearance sweep needs, which fails by MISSING a mark and never by surfacing an extra one.
 *
 * `ADJ<n>` is real and probed: MONSTER ADJ ENERGY = 67, MONSTER ADJ2 ENERGY = 72, SALT ADJ PEPPER = 27
 * vs SALT ADJ2 PEPPER = 52 — so the widening is genuinely a widening, not a no-op we cannot see.
 */
export function isReservedToken(tok) {
  return RESERVED_TOKEN_RE.test(tok);
}

/**
 * Compile a caller term into ONE value string: single token → `pre + term + post` (byte-identical to
 * what the old per-mode `pattern()` emitted), multi-word → an ADJ chain with the wrap on the first and
 * last token, `*TOK1 ADJ TOK2*`.
 *
 * With `dropReserved`, an operator word is removed and the adjacency across it widens by one per
 * dropped token — "BLACK AND DECKER" → `*BLACK ADJ2 DECKER*`. See isReservedToken for why dropping
 * beats escaping (the escape returns 0 over marks that exist).
 */
export function compilePhraseValue(term, { pre = "", post = "", dropReserved = false } = {}) {
  const raw = String(term ?? "").trim();
  const tokens = assertSingleMarkShape(raw);

  // Walk the tokens, carrying the distance owed to the NEXT kept token.
  const kept = [];
  const gaps = [];          // gaps[i] = adjacency distance between kept[i] and kept[i + 1]
  let pendingGap = 1;
  for (const t of tokens) {
    if (dropReserved && isReservedToken(t)) { pendingGap += 1; continue; }
    if (kept.length) gaps.push(pendingGap);
    kept.push(t);
    pendingGap = 1;
  }
  if (!kept.length) {
    throw new Error(`term ${JSON.stringify(raw)} is nothing but operator words, so there is no name left to `
      + `search — the slice is deferred rather than searched as a different query.`);
  }

  let value = kept[0];
  for (let i = 1; i < kept.length; i++) {
    // ADJ === ADJ1's neighbour-distance for our purposes only at gap 1; past that the digit is required.
    value += ` ${PHRASE_OPERATOR}${gaps[i - 1] > 1 ? gaps[i - 1] : ""} ${kept[i]}`;
  }

  // A LEADING `*` on a ONE-CHARACTER first token is a sub-query over most of the register, and inside an
  // ADJ chain the provider gives up on it: HTTP 500 "Near/Adj queries with sub queries that can return a
  // huge amount…". Probed — one character breaks, two do not:
  //   *I ADJ CANT ADJ BELIEVE*  500      *IT ADJ STARTS ADJ WITH*  103
  //   *A ADJ BAR*               500      *AN ADJ APPLE*             55
  // So the leading wrap is dropped for that one case, and ONLY that case. It costs a little recall at
  // the leading token boundary (AN ADJ APPLE* = 31 vs *AN ADJ APPLE* = 55), which is why it is not done
  // generally — but the alternative here is not a narrower search, it is no search at all.
  const leadWrap = (kept.length > 1 && kept[0].length === 1) ? "" : pre;
  return `${leadWrap}${value}${post}`;
}

// ── Caller-input safety: NEVER let a term silently change the query's SEMANTICS ────────────────────
//
// Compumark parses booleans and parentheses INSIDE the value string, so a caller term containing
// ` OR ` / ` AND ` / ` NOT ` or parentheses would be READ AS OPERATORS — "BLACK AND DECKER" becomes a
// two-term AND, "X NOT Y" silently subtracts recall. Doctrine 2: never search something other than
// what was asked while reporting success.
//
// `allowReserved` is set on the PHRASE path only, where the term is tokenised and each operator word is
// dropped with the adjacency across it widened — so "BLACK AND DECKER" goes out as
// `*BLACK ADJ2 DECKER*` (55 hits; the register writes it "BLACK & DECKER") rather than being refused.
// That is an EXPRESSION of the term, not a rewrite of it, and it is a SUPERSET of the literal phrase.
// `exact` still rejects, and correctly: that field answers HTTP 400 "Use of operators (AND, NOT, ADJ,
// NEAR) is not allowed in this field" and offers no escape at all. The owner field is not ADJ-joined,
// so it rejects too.
// Wildcard metacharacters are rejected unless the caller used the `wildcard` predicate, so a stray
// `*` in a mark name cannot silently widen (or, inside an exact slice, distort) the query.
const RESERVED_BOOLEAN_RE = /(?:^|\s)(?:OR|AND|NOT)(?:\s|$)/i;
const PAREN_RE = /[()]/;
const WILDCARD_RE = /[*?]/;

/** Strip punctuation for EXACT_WORD_MARK_SPECIFICATION (case-insensitive but punctuation-sensitive). */
export function stripPunctuation(term) {
  return String(term ?? "").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}

// ── NON-LATIN MARK TERMS ARE NOT SEARCHABLE — AND THE FAILURE IS A SILENT ZERO ─────────────────────
// Compumark indexes a non-Latin filing by its ROMANISATION, never by its characters. The record
// carries both, and only the romanisation is a search key:
//
//     markVerbalElementText "华威豹"   markTransliteration "HUA WEI BAO"
//
// Established against records actually fetched and read, so this is not inference:
//
//     华威豹 → 0        HUA WEI BAO → 32   (and the 32 contain 华威豹)
//     小米   → 0        XIAOMI      → 57632
//
// Universal, not a CJK-specific behaviour — non-Latin records across CN/TW/JP/KR/TH/GR/UA/EG/IL/SA
// carried a populated markTransliteration (JP 7/7, KR 7/7, TW 12/12, TH 10/10, GR 6/6, UA 10/10,
// EG 11/11, SA 6/6, IL 1/1, CN 12/12).
//
// The romanisation is also STRICTLY BETTER for clearance than a character search would be:
// `HUA WEI BAO` returns 华威豹, 华味宝 AND 华为爆破 — three character sets, one pronunciation. Chinese
// squatting is overwhelmingly homophone-based, and a literal character match finds one of the three.
//
// So a native-script term reaching the wire is a CLIENT-SIDE REFUSAL, never a query: 0 with no error
// is the exact false-clean this provider swap exists to prevent, and it is the shape a caller is most
// likely to read as "nothing out there". The driver's job is to send the romanisation (see
// driver/jx.mjs); this guard is the backstop for every OTHER path — model-proposed supplementals,
// frame-diff remedies, a client-supplied mark in Cyrillic.
//
// The DETECTOR now lives in providers/_shared/script-form.mjs — one implementation, four providers.
// It was clarivate-only, which is exactly how the parity hole opened: the rule was true of an INDEX,
// but it was written as a property of a vendor file. The provider-specific half is the POLICY, and
// that is now declared as data (capabilities.nativeScriptIndex: false) and enforced for every provider
// by the shared plan executor. This guard stays as the deepest backstop for the paths that never reach
// that executor at all — re-exported so this module's surface is unchanged.
export { isNonLatinTerm };

/**
 * THE ENTRY-LEVEL HALF OF THE TRANSLITERATION FIX — where a non-Latin plan entry becomes a query
 * this index can actually answer.
 *
 * The plan is provider-neutral and states the question in BOTH forms (the native characters as the
 * term, the romanisation on `romanizedTerms`). Corsearch has a real native-script index and answers
 * the characters directly, so it uses the term and ignores the extra field. This index does not hold
 * the characters at all, so here the romanisation IS the query.
 *
 * Two substitutions, and the second is as load-bearing as the first:
 *
 *  1. names → the romanisation. Without it the query answers 0 with no error.
 *  2. the predicate is relaxed to contains. `exact` on a transliteration is a SILENT ZERO for exactly
 *     the registers this lane covers: an `exact` transliteration answers 0 where `contains` answers.
 *     The office writes the transliteration with its own spacing and its own trailing tokens
 *     ("SUK SETTHI" sits inside "ส;สุขเศรษฐี;SUK SETTHI"), so anchoring the whole string is the one
 *     shape guaranteed not to match. Widening here is safe in the direction that matters: a superset,
 *     never a false clean.
 *
 * Applied ONLY when the entry's own term is non-Latin — a Latin entry that happens to carry a
 * romanisation is left exactly as it was.
 */
export function substituteRomanizedNames(e, pp, plan) {
  const q = defaultBuildEntryQuery(e, pp, plan);
  const { romanized_names: roman, ...rest } = q;
  if (!Array.isArray(roman) || !roman.length) return rest;
  const native = Array.isArray(rest.names) ? rest.names : (rest.name != null ? [rest.name] : []);
  if (!native.some((t) => isNonLatinTerm(t))) return rest;
  const { name: _drop, names: _drop2, match_mode: _drop3, ...keep } = rest;
  return { ...keep, names: roman, match_mode: "default" };
}

// ── THE PARSER'S OWN UNSEARCHABLE SET, ON APPLICANT_NAME ──────────────────────────────────────────
// Ask for the WHOLE 400 message and the provider names them itself:
//
//   "The following characters are not searchable by themselves: " { } ( )
//    Additionally, the following characters are not searchable:
//    " { } ( ) ¦ # : ; < > ' ! | % [ ] ^ ~ Ã § Â ² ³ ¾"
//
// We screened for `( )` only. Two separate things were therefore killing whole OR-stacks:
//
//   1. punctuation — a quoted segment, braces, or a parenthesised suffix inside an applicant name
//   2. DIACRITICS — the tail of that list (Ã § Â ² ³) is what UTF-8 looks like decoded as Latin-1, and
//      every name that failed carried an accented character
//
// (2) is NOT a transport bug on our side: an explicit `charset=utf-8`, a raw UTF-8 byte body and a
// `\uXXXX`-escaped ASCII-only JSON body all behave identically.
//
// Both are EXPRESSIBLE, which is why neither is a reason to drop the name (same call as the
// apostrophe,). The shapes that work:
//   a quoted name      literal → 400,  the quotes stripped → answers,  `?`-substituted → answers
//   an accented name   literal → 400,  ASCII-folded → answers
//   `COMUNICAÇÕES`                    literal → 400,  ASCII-folded → 6605
//   `KEY COMÉRCIO`                    literal → 23,   ASCII-folded → 23   (folding never narrows)
//
// Strip rather than `?`-substitute: a bare space is an implicit AND on this field so the tokens still
// have to co-occur, and stripping cannot produce the `??` adjacency that a substitution would when two
// of these characters sit side by side (adjacent wildcards are their own 400). Parens ride along — an
// applicant name is a NAME, never a boolean expression, so there is no grouping to preserve.
// `'` is deliberately ABSENT: expandApostrophe expresses it as BOTH the `?`-wildcard and the
// stripped spelling, which is more precise than blanking it, and sanitize runs first.
// ── …AND THE SCREEN NOW IMPLEMENTS THE WHOLE OF IT ─────────────────────────────────────────
// The set above is quoted verbatim from the vendor's own 400. The regex below used to implement PART
// of it: `§ ² ³ ¾` were listed by the provider and absent from the character class, and NFD (which is
// canonical-only, unlike NFKD) does not decompose any of them — so a resolved applicant name carrying
// one passed the screen, reached the wire, and 400'd the WHOLE OR-stack it was joined into, taking the
// caller's own clean term down with it. `Ã` and `Â` need no entry: after the fold below they cannot
// survive, because both decompose to `A` + a combining mark.
// `²` and `³` are FOLDED to their ASCII digits rather than blanked. The digit is searchable, and a
// digit is part of a company's name — blanking it turns `M² DESIGN` into the token pair `M`+`DESIGN`,
// which the implicit token-AND then fails to match against a register holding `M2 DESIGN`. `§` and `¾`
// have no ASCII equivalent to fold to and join the strip set with the punctuation.
const OWNER_UNSEARCHABLE_RE = /["{}()¦#:;<>!|%\[\]^~§¾]/;   // NOT /g — `.test()` on a global regex is stateful

// ── THE DIACRITIC FOLD IS LATIN-ONLY, BY CONSTRUCTION ──────────────────────────────────────
// This fold was written for the accented-Latin 400s above — its own comment says "É→E, Ç→C" — and it
// stripped EVERY `\p{M}`, in every script. In scripts where the combining mark IS part of the letter
// that is not a fold, it is a MISSPELLING, minted silently onto the wire:
//
//   Й (U+0419 = И + U+0306)  → И          ОГРАНИЧЕННОЙ → ОГРАНИЧЕННОИ,  СКАЙ → СКАИ
//   Ё → Е,  ガ (カ + U+3099) → カ,  and the same for Thai vowel signs and Devanagari matras
//
// APPLICANT_NAME EQUALS is an implicit token-AND (see resolveOwnerParamsOnce), so a misspelled token
// is a token the register does not hold and the whole conjunction is empty: HTTP 200, `counts:{}`,
// 0 — read downstream as that owner's portfolio SIZE. This is the same collapse `formKey` was fixed
// for in providers/_shared/script-form.mjs; it survived here because this fold is private to the
// vendor file and nobody re-read it against a non-Latin name.
//
// Script-scoping the strip is the SAME fix `formKey` carries in providers/_shared/script-form.mjs,
// written in the same vocabulary so the two cannot be read as different rules: strip a combining mark
// only where its base letter is Latin. Every accented Latin name therefore folds byte-identically to
// before, and every other script passes through untouched.
const foldLatinDiacritics = (s) => s.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC");

export function sanitizeOwnerName(name) {
  const s = String(name ?? "");
  // Decompose, drop the combining marks OVER A LATIN BASE, and the accented letter becomes its ASCII
  // base. É→E, Ç→C — and Й stays Й.
  const folded = foldLatinDiacritics(s).replace(/²/g, "2").replace(/³/g, "3");
  if (!OWNER_UNSEARCHABLE_RE.test(folded)) return folded;
  return folded.replace(/["{}()¦#:;<>!|%\[\]^~§¾]/g, " ").replace(/\s+/g, " ").trim();
}

export function assertSearchableTerm(term, { allowWildcard = false, allowParens = false, allowReserved = false } = {}) {
  const t = String(term ?? "").trim();
  if (!t) throw new Error("empty search term");
  if (!allowReserved && RESERVED_BOOLEAN_RE.test(t)) {
    throw new Error(`term ${JSON.stringify(t)} contains a reserved boolean operator (OR/AND/NOT), which this provider parses INSIDE the value string; there is no escape syntax for this field — the slice is deferred rather than searched as a different query`);
  }
  if (!allowParens && PAREN_RE.test(t)) {
    throw new Error(`term ${JSON.stringify(t)} contains parentheses, which this provider parses as boolean grouping inside the value string — no escape syntax, so the slice is deferred rather than searched as a different query`);
  }
  if (!allowWildcard && WILDCARD_RE.test(t)) {
    throw new Error(`term ${JSON.stringify(t)} contains a wildcard metacharacter (* or ?) but the predicate is not \`wildcard\` — refusing to widen the query implicitly`);
  }
  return t;
}

/** The caller's mark terms, in one list: names[] ∪ name ∪ query (all three shapes are accepted). */
export function markTermsOf(p) {
  const out = [];
  for (const t of (Array.isArray(p?.names) ? p.names : [])) if (t != null && String(t).trim()) out.push(String(t).trim());
  for (const k of ["name", "query"]) {
    const v = p?.[k];
    if (v != null && String(v).trim()) out.push(String(v).trim());
  }
  return out;
}

/** The caller's owner terms: owners[] ∪ owner. */
export function ownerTermsOf(p) {
  const out = [];
  for (const t of (Array.isArray(p?.owners) ? p.owners : [])) if (t != null && String(t).trim()) out.push(String(t).trim());
  if (p?.owner != null && String(p.owner).trim()) out.push(String(p.owner).trim());
  return out;
}

export function hasAnyElement(p) {
  return markTermsOf(p).length > 0 || ownerTermsOf(p).length > 0 || !!p?.representative;
}

/**
 * Join terms into ONE value string with the EXPLICIT " OR " operator (a bare space is an implicit AND,
 * not an OR). ADJ binds tighter than OR, so phrase operands need no parentheses — probed:
 * `*MOUNTAIN ADJ DEW* OR *MONSTER ADJ ENERGY*` = 157 = 90 + 67, identical with parens.
 * The width bound is the parser's document-nesting cap; the enumerate
 * kernel chunks wide `names` stacks at capabilities.kernel.namesChunkDefault (= maxOrWidth) before they
 * ever reach here, so hitting this throw means a caller bypassed the kernel.
 */
export function joinOrValue(values) {
  const list = values.filter((v) => v != null && String(v).length);
  if (list.length > CAPABILITIES.maxOrWidth) {
    throw new Error(`OR-stack of ${list.length} terms exceeds the provider's safe OR width ${CAPABILITIES.maxOrWidth} — a wider stack is refused by the provider, so chunk it`);
  }
  return list.join(" OR ");
}

/**
 * Translate caller jurisdictions to Compumark registrationOfficeCodes (EU → EM, on EVERY request path)
 * and membership-check them. An office outside the provider's 186-code vocabulary is a genuine coverage
 * gap: it is reported, never silently dropped.
 */
export function resolveOffices(regions) {
  const codes = [];
  const unknown = [];
  for (const r of (Array.isArray(regions) ? regions : [])) {
    const c = CAPABILITIES.offices.translate(r);
    if (!c) continue;
    if (!CLARIVATE_OFFICE_CODES.includes(c)) { unknown.push(String(r)); continue; }
    if (!codes.includes(c)) codes.push(c);
  }
  return { codes, unknown };
}

/**
 * ONE /search (or /count) body — the SAME SearchRequest shape for both endpoints.
 *
 * Multi-class is ONE searchField whose value is the class OR-list ("9 OR 28 OR 41 OR 42"), probe-
 * verified identical (18 hits) to the deleted 4-call per-class fan-out.
 */
// ── THE APOSTROPHE IS NOT SEARCHABLE IN APPLICANT_NAME ────────────────────────────────────────────
// An apostrophe is not searchable: "TRADER VIC'S", "MCDONALD'S CORPORATION" and
// "…L'ETAT DU DELAWARE" all answer HTTP 400 — "the following characters are not searchable by
// themselves" — while the same names without the apostrophe answer 200. It is the character itself,
// not the elision and not the possessive; an earlier fix narrowed this to elided articles only, on the
// strength of a CLIENT-SIDE build check misread as an API result, and the possessive it declared safe
// is exactly what failed next.
//
// Dropping the name is the wrong remedy: `?` is a native single-character wildcard on this field, so
// the apostrophe is EXPRESSIBLE. "MCDONALD?S CORPORATION" returns 27 where the literal returns 400.
//
// Emit BOTH spellings OR-joined, because registers hold both: "TRADER VIC?S" matches the apostrophe'd
// record and "TRADER VICS" the stripped one (probe: 3 records each). One form alone silently loses
// whichever spelling the register happens to use — the exact false-clean this provider swap exists to
// avoid. Applies at THIS chokepoint so every path gets it: the caller's own term, the resolution
// expansion, and model-proposed supplementals alike.
export function expandApostrophe(term) {
  const s = String(term ?? "");
  if (!/['’]/.test(s)) return [s];
  const wild = s.replace(/['’]/g, "?");
  const stripped = s.replace(/['’]/g, "");
  return wild === stripped ? [wild] : [wild, stripped];
}

export function buildSearchRequest(p) {
  const modeKey = p?.match_mode || "default";
  const mode = MATCH_MODE_TO_FIELD[modeKey];
  if (!mode) throw new Error(`unknown match_mode: ${modeKey}`);

  const { codes, unknown } = resolveOffices(p?.regions);
  if (unknown.length) {
    throw new Error(`jurisdiction(s) [${unknown.join(", ")}] are outside this provider's registrationOfficeCode vocabulary — a coverage gap to disclose, never a filter to drop`);
  }
  if (!codes.length) throw new Error("regions[] is required (Compumark Content requires at least one registrationOfficeCode)");

  const searchFields = [];

  const markTerms = markTermsOf(p);
  if (markTerms.length) {
    const values = markTerms.map((t) => {
      // SHAPE FIRST, on the RAW term. stripPunctuation dissolves the very separators that mark a term
      // out as a list ("SLUSH FREEZE, SLUSH ICE, SLUSH POP" → one long name → 0 → reads as CLEAN), so
      // an `exact` slice checked after stripping is checked too late. compilePhraseValue re-checks for
      // the phrase modes; this is the one call that covers `exact`.
      assertSingleMarkShape(t);
      // A native-script term would answer 0 with no error — refuse it here so the slice DEFERS
      // loudly. The caller must send the romanisation (which is what this index actually holds).
      if (isNonLatinTerm(t)) {
        throw new Error(
          `term ${JSON.stringify(String(t).slice(0, 40))} is not in Latin script, and Compumark indexes `
          + `non-Latin filings by their transliteration, not their characters — searching it would `
          + `return 0 with no error, which reads as CLEAN. Send the romanisation instead `
          + `(e.g. 华威豹 → "HUA WEI BAO"), which also catches homophone variants the characters miss.`);
      }
      // exact: punctuation is stripped FIRST (the field is punctuation-sensitive), then validated —
      // stripping removes parentheses, so only a reserved boolean word can still reject the term.
      const base = mode.exact ? stripPunctuation(t) : t;
      const safe = assertSearchableTerm(base, {
        allowWildcard: !!mode.allowWildcard,
        allowParens: !!mode.exact,
        allowReserved: !!mode.dropReserved,   // compilePhraseValue drops them and widens the adjacency
      });
      // Multi-word → an ADJ chain (an ordered phrase). Single-token → exactly the old wrap.
      return mode.phrase ? compilePhraseValue(safe, mode) : `${mode.pre}${safe}${mode.post}`;
    });
    searchFields.push({ operator: mode.operator, name: mode.name, value: joinOrValue(values) });
  }

  const ownerTerms = ownerTermsOf(p);
  if (ownerTerms.length) {
    // APPLICANT_NAME with EQUALS (+ native wildcards; "NIKE*" ≡ BEGINS_WITH). The CONTAINS operator is
    // a HARD HTTP 400 on this field — it is never emitted, on any path.
    // sanitize BEFORE validating: the parser's unsearchable set includes `(` `)`, so a name like
    // "ACME (UK) LTD" would otherwise be refused by the paren check instead of simply being expressed.
    const values = ownerTerms.flatMap((t) =>
      expandApostrophe(assertSearchableTerm(sanitizeOwnerName(t), { allowWildcard: true })));
    searchFields.push({ operator: "EQUALS", name: OWNER_FIELD, value: joinOrValue(values) });
  }

  if (p?.representative) {
    // — THE SAME CHAIN AS THE OWNER FIELD ABOVE, for the same reason: this is a party-NAME field,
    // and party names are where the vendor's unsearchable set, accented Latin and the apostrophe all
    // actually turn up. Firms are worse than owners on all three — `SMITH & CO. (UK) LTD`, `MÜLLER &
    // PARTNER`, `O'BRIEN & CO` are ordinary styles, not edge cases.
    //
    // What it was before: `assertSearchableTerm` alone. That function SCREENS and does not strip — its
    // only mutation is `.trim()`. So every character the vendor's own 400 lists as unsearchable reached
    // the wire untouched, diacritics were not folded, and the apostrophe was never expanded. `(` and
    // `)` were caught, and caught for the WRONG REASON: refused client-side as boolean grouping rather
    // than expressed, which is precisely the failure the owner comment four lines up was written to
    // avoid.
    //
    // Ordering is not free and matches the owner path exactly — sanitize, then validate, then expand.
    // Sanitizing after validating would refuse `(UK)` before the strip could remove it, and expanding
    // before sanitizing would build the apostrophe variants out of an unsanitized string.
    //
    // `joinOrValue` because `expandApostrophe` returns one OR two values. The old code assigned a
    // scalar, so an apostrophe'd firm name would otherwise have produced `["A","B"]` in a string slot.
    const values = expandApostrophe(assertSearchableTerm(sanitizeOwnerName(p.representative), { allowWildcard: true }));
    searchFields.push({
      operator: "EQUALS", name: "REPRESENTATIVE_OR_CORRESPONDENT_NAME",
      value: joinOrValue(values),
    });
  }

  // ── multi-class = ONE call ────────────────────────────────────────────────────────────────────────
  const classes = (Array.isArray(p?.nice_classes) ? p.nice_classes : [])
    .map((c) => String(c).trim()).filter((c) => /^\d+$/.test(c));
  if (classes.length) {
    searchFields.push({ operator: "EQUALS", name: "INT_CLASS_NUMBER", value: joinOrValue([...new Set(classes)]) });
  }

  const queryOptions = {};
  if (p?.active_only != null)        queryOptions.activeOnly = !!p.active_only;
  if (p?.plurals != null)            queryOptions.plurals = !!p.plurals;
  if (p?.cross_references != null)   queryOptions.crossReferences = !!p.cross_references;
  if (p?.japanese_phonetics != null) queryOptions.japanesePhonetics = !!p.japanese_phonetics;
  if (p?.central_european_phonetics != null) queryOptions.centralEuropeanPhonetics = !!p.central_european_phonetics;

  const body = { registrationOfficeCodes: codes, searchFields };

  // Madrid handled correctly for a JURISDICTION-SCOPED sweep: when WO rides along with at least one
  // national/regional office, restrict International marks to those actually designated there. A
  // WO-only sweep is not jurisdiction-scoped, so the flag stays off (there is nothing to designate to).
  const woScoped = codes.includes("WO") && codes.some((c) => c !== "WO");
  const limitWO = p?.limit_wo_to_designated != null ? !!p.limit_wo_to_designated : woScoped;
  if (limitWO) body.limitWOresultsToDesignated = true;

  if (Object.keys(queryOptions).length) body.queryOptions = queryOptions;
  if (p?.raw_pagination && typeof p.raw_pagination === "object") Object.assign(body, p.raw_pagination);
  return body;
}

// ── Status classification ─────────────────────────────────────────────────────────────────────────
// FAIL OPEN, exactly like corsearch: only a CONFIDENTLY dead signal produces "dead"; anything the
// vocabulary does not recognise is "ambiguous" and must never auto-drop (the skill deep-fetches).
// The status vocabulary is REGISTERED (active:true),
// EXPIRED (active:false) and ABANDONED (active:false; seen masked as ABANDXXXX in the test:true
// captures). The LIVE list may safely over-list (a live verdict never drops); the DEAD list stays
// minimal — an unrecognised token falls through to `status.active`, then to a conservative heuristic.
export const CLARIVATE_STATUS_DEAD = Object.freeze(["expired", "abandoned"]);
export const CLARIVATE_STATUS_LIVE = Object.freeze(["registered", "pending", "published", "renewed", "filed", "accepted"]);
export const classifyClarivateStatus = makeClassifyStatus({ live: CLARIVATE_STATUS_LIVE, dead: CLARIVATE_STATUS_DEAD });

// ── Record-field pickers + normalization ──────────────────────────────────────────────────────────
// The canonical Applicant definition has EXACTLY four properties (applicantName, applicantNameNative,
// applicantAddressCountryCode, applicantAddress). `freeFormatNameLine` and `organizationName` — which
// CLARIVATE-ARCHITECTURE.md's fallback chain named — DO NOT EXIST in the vendor schema and are gone.
export function pickOwnerName(applicant) {
  if (!applicant) return null;
  return applicant.applicantName ?? applicant.applicantNameNative ?? null;
}
/**
 * The owner's name in its ORIGINAL script, kept separate rather than collapsed into pickOwnerName.
 *
 * `applicantName` is the Latin-script field, and for a CN/JP/KR owner Compumark fills it with a
 * ROMANISATION — for a Chinese proprietor, character-by-character pinyin: eleven lowercase syllables,
 * no word boundaries, no capitals. Collapsing the pair meant that string became the owner everywhere,
 * and it shipped as a section heading in a delivered client report.
 *
 * This is the same asymmetry `pickMarkTransliteration` above already fixed for the MARK — the record
 * carries the native form and the romanisation as two facts, so the record set should too. Which of them
 * is DISPLAYED is a downstream decision (registry-fidelity's bindFindingsToRecords); the provider's job
 * is only to stop throwing one of them away.
 *
 * Returns null when the pair is degenerate — an owner whose only name IS the native form has no separate
 * native field to report, and saying otherwise would invent a distinction the record does not draw.
 */
export function pickOwnerNameNative(applicant) {
  if (!applicant) return null;
  const native = applicant.applicantNameNative ?? null;
  if (!native) return null;
  return applicant.applicantName ? native : null;
}
export function pickOwnerCountry(applicant) {
  if (!applicant) return null;
  return applicant.applicantAddressCountryCode ?? null;
}
export function pickMarkText(rec) {
  return rec?.wordMarkSpecification?.markVerbalElementText ?? rec?.markVerbalElementText
      ?? (typeof rec?.wordMarkSpecification === "string" ? rec.wordMarkSpecification : null);
}
/** The romanised form Compumark actually INDEXES for a non-Latin mark ("华威豹" → "HUA WEI BAO"). */
export function pickMarkTransliteration(rec) {
  return rec?.wordMarkSpecification?.markTransliteration ?? rec?.markTransliteration ?? null;
}
/** The meaning, when the office recorded one ("אי" → "an island"). Not a search key — display only. */
export function pickMarkTranslation(rec) {
  return rec?.wordMarkSpecification?.markTranslation ?? rec?.markTranslation ?? null;
}
// The granular status LABEL (cmNormalisedStatus preferred, then markCurrentStatus).
export function pickStatusText(rec) {
  const s = rec?.status;
  if (s && typeof s === "object") return s.cmNormalisedStatus ?? s.markCurrentStatus ?? null;
  return rec?.cmNormalisedStatus ?? rec?.markCurrentStatus ?? null;
}
/**
 * live | dead | ambiguous — the ONE live/dead reading, shared by the screen rows and the normalized
 * record so the two can never disagree. Order: the normalised status LABEL (a closed, evidenced
 * vocabulary) → the vendor's own `status.active` boolean (a first-class field, not an unrecognised
 * token) → a conservative label heuristic → ambiguous.
 */
export function liveStatusOf(rec) {
  const label = pickStatusText(rec);
  const byLabel = classifyClarivateStatus(label);
  if (byLabel !== "ambiguous") return byLabel;
  const s = rec?.status;
  if (s && typeof s === "object" && typeof s.active === "boolean") return s.active ? "live" : "dead";
  const l = String(label ?? "").toLowerCase();
  if (/invalid|abandon|cancel|expir|dead|terminat|refus|withdraw|lapsed|void/.test(l)) return "dead";
  if (/regist|valid|live|pending|publish|renew|accept|active|filed/.test(l)) return "live";
  return "ambiguous";
}
/** live | dead | unknown — the neutral statusClass the driver's fidelity gates read. */
export function statusClassOf(rec) {
  const c = liveStatusOf(rec);
  return c === "ambiguous" ? "unknown" : c;
}
function yyyymmddToIso(s) {
  const d = String(s ?? "").replace(/\D/g, "");
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return s ?? null;
}
const isoList = (v) => {
  const list = Array.isArray(v) ? v : (v == null ? [] : [v]);
  const out = list.map(yyyymmddToIso).filter(Boolean);
  return out.length ? out : null;
};
const arrOrNull = (v) => (Array.isArray(v) && v.length ? v : null);

// intClassNumber arrives as EITHER a single value ("07") OR a comma-joined string
// ("03,06,09,20,21,27,35,36,39"). Split on any non-digit run and parse each — a bare parseInt() keeps
// only the first class (a multi-class record arrives as single-class).
export function normalizeClasses(rec) {
  const direct = rec?.niceClassifications ?? rec?.classifications;
  const fromGoodsServices = rec?.goodsServices?.intClassDescriptions;
  const list = Array.isArray(direct) ? direct : Array.isArray(fromGoodsServices) ? fromGoodsServices : null;
  if (!list) return null;
  const out = [];
  for (const e of list) {
    const n = e?.classNumber ?? e?.intClassNumber ?? e?.number ?? null;
    if (n == null) continue;
    for (const part of String(n).split(/[^0-9]+/)) {
      if (!part) continue;
      const parsed = parseInt(part, 10);
      if (!Number.isNaN(parsed)) out.push(parsed);
    }
  }
  return out.length ? Array.from(new Set(out)).sort((a, b) => a - b) : null;
}

/**
 * Goods & services, per Nice class, WITH the machine English translation
 * (cmComputerTranslationIntGoodsServicesDescription — present only when the office description is not
 * in English, which is exactly when a reviewer most needs it; the old normaliser dropped it).
 */
export function normalizeGoodsServices(rec) {
  const list = rec?.goodsServices?.intClassDescriptions;
  if (!Array.isArray(list) || !list.length) return null;
  return list.map((d) => ({
    classes: String(d?.intClassNumber ?? "").split(/[^0-9]+/).filter(Boolean).map(Number),
    language: d?.intGoodsLanguageCode ?? null,
    description: d?.intGoodsServicesDescription ?? null,
    translation_language: d?.cmComputerTranslationIntGoodsLanguageCode ?? null,
    translation: d?.cmComputerTranslationIntGoodsServicesDescription ?? null,
  }));
}

// Map a raw Clarivate /text record to the NEUTRAL normalized shape the driver + skill consume.
// officeHint = the office of the synthetic ref the caller cited (keeps cited==logged for WO/IR
// designations whose record office differs from the search ids[] key); the record's own
// registrationOfficeCode is the fallback.
export function normalizeRecord(rec, officeHint = null) {
  if (!rec || typeof rec !== "object") return rec;
  const office = officeHint || rec.registrationOfficeCode || "xx";
  const guid = rec.id ?? rec.guid ?? null;
  const st = rec.status && typeof rec.status === "object" ? rec.status : {};
  const applicant = Array.isArray(rec.applicants) ? rec.applicants[0] : null;
  return {
    uri: guid ? makeRef(office, guid) : null,
    provider: "clarivate",
    office: String(office).toLowerCase(),
    guid,
    // neutral identifiers — registry-fidelity REC reads these names directly (no provider branch).
    applicationNumber: st.application?.applicationNumber ?? rec.applicationNumber ?? null,
    registrationNumber: st.registration?.registrationNumber ?? rec.registrationNumber ?? null,
    applicationDate: yyyymmddToIso(st.application?.applicationDate ?? rec.applicationDate),
    registrationDate: yyyymmddToIso(st.registration?.registrationDate ?? rec.registrationDate),
    expiryDate: yyyymmddToIso(st.expiryDate ?? rec.expiryDate),
    // status history the old normaliser dropped — all documented, all delivered when populated.
    renewalDate: yyyymmddToIso(st.renewalDate),
    lastPublicationDate: yyyymmddToIso(st.lastPublicationDate),
    publicationDates: isoList(st.publicationDate),
    abandonmentDate: yyyymmddToIso(st.abandonmentDate),
    cancellationDate: yyyymmddToIso(st.cancellationDate),
    statusClass: statusClassOf(rec),  // live | dead | unknown — authoritative live/dead for the gates
    statusText: pickStatusText(rec),  // granular label (cmNormalisedStatus)
    markText: pickMarkText(rec),
    // The Latin key to a non-Latin mark. Compumark indexes non-Latin filings by their
    // TRANSLITERATION, not their characters (across Han/Kana/Hangul/Thai/Greek/
    // Cyrillic/Arabic/Hebrew — every non-Latin record sampled carried it). Dropping these left the
    // report unable to show WHY a Han record answered a Latin query, and left the driver with no
    // way to search a native-script mark at all. See NON_LATIN_RE below.
    markTransliteration: pickMarkTransliteration(rec),
    markTranslation: pickMarkTranslation(rec),
    markFeature: rec.markFeature ?? null,
    markDisclaimers: arrOrNull(rec.markDisclaimers),
    niceClasses: normalizeClasses(rec),
    goodsServices: normalizeGoodsServices(rec),
    owner: pickOwnerName(applicant),
    ownerNative: pickOwnerNameNative(applicant),
    ownerCountry: pickOwnerCountry(applicant),
    representative: Array.isArray(rec.representatives) ? (rec.representatives[0]?.representativeName ?? null) : null,
    // priority / seniority / Madrid chain — the fields that prove a record's REACH and its earliest
    // effective date. A WO record carries the designation arrays; an EM record often carries
    // seniorities. Dropping them lost the senior-right date a conflict analysis turns on.
    priorities: arrOrNull(rec.priorities),
    seniorities: arrOrNull(rec.seniorities),
    basicRegistrationApplications: arrOrNull(rec.basicRegistrationApplications),
    madridDesignations: {
      protocol: arrOrNull(rec.designatedCountryCodeMadridProtocol),
      agreement: arrOrNull(rec.designatedCountryCodeMadridAgreement),
      aripo: arrOrNull(rec.designatedCountryCodeARIPO),
    },
    imageAvailable: rec.markImagesAvailable ?? null,
    // Compumark Content has no public record URL; the renderer prints "verify at office" + the ref.
    resolved_link: null,
    // Opposition is structurally absent from Compumark Content /text: the vendor's schema DOES define
    // Trademark.markRecords[].{oppositionPeriodEndDate,oppositionPeriodText}, but they are never
    // populated — controlled against real EM records with zero
    // occurrences, while sparse fields (seniorities, priorities) DO appear, proving the full
    // schema is delivered. That control IS the finding; there is no document to go and read.
    // Represent as UNAVAILABLE. Never "none found".
    oppositions: null,
    _provenance: { opposition: "unavailable:clarivate-compumark-content" },
    _raw: rec, // full ST.66 record kept verbatim for the agent + audit
  };
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────
// Normalize a /search response ({ ids: { <office>: [guid…] } }) into stable rows whose record_id is
// the synthetic ref. /search has NO pagination and needs none: it returns the COMPLETE guid set, or
// fails loud with tooManyResults past 30000. Detail/screening comes from /text.
// ── "did the provider ANSWER", not "did the bytes parse" — the same discrimination as corsearch ────
// The vendor's SearchResponse has exactly ONE property ("Top-level
// response keys = [\"ids\"]" — CLARIVATE-ARCHITECTURE.md §pagination): a search answer is a body
// carrying ids{}. A parseable body WITHOUT it — this provider's own error envelope is
// {"errorMessage":…} — used to normalise to ids {} → total_hits 0: zero guids stamped
// as an answered search. The count/search divergence check was the only net, and it holds only when
// the count probe answered AND was populated. Not an answer ⇒ null total, an error surfaced.
export function isSearchResponseBody(body) {
  return body != null && typeof body === "object" && !Array.isArray(body)
    && body.ids != null && typeof body.ids === "object";
}

export function normalizeSearchResponse(body, echoQuery, matchMode) {
  // A NON-ANSWER (the response did not parse, or parsed into something that is not a search
  // response) reports total_hits NULL, never 0 — the same rule as the corsearch normalizer.
  // doSearch refuses before this is reachable; this is the second lock.
  const answered = isSearchResponseBody(body);
  const ids = body?.ids ?? {};
  const offices = Object.keys(ids);
  const results = [];
  let total = 0;
  for (const office of offices) {
    for (const guid of (Array.isArray(ids[office]) ? ids[office] : [])) {
      results.push({
        record_id: makeRef(office, guid),  // synthetic /mark/<office>/<guid>
        guid,
        office: String(office).toLowerCase(),
        mark_text: null, classes: null, status: null, status_date: null,
        application_date: null, registration_date: null, expiry_date: null,
        owner_name: null, owner_country: null, jurisdictions: office,
        mark_feature: null, image_path: null,
        raw: { guid, registrationOfficeCode: office },
      });
      total += 1;
    }
  }
  return {
    query: echoQuery, match_mode: matchMode || "default",
    total_hits: answered ? total : null, has_more: false, next_page_token: null, cap_warning: null,
    took_ms: body?.took ?? null,
    warnings: Array.isArray(body?.warnings) ? body.warnings : [],
    sources: offices,
    results,
  };
}

// The provider's honest crowd signal, NOT a fault: HTTP 400 "tooManyResults - The search returned N
// results. Maximum number of results is 30000." doEnumerate translates it into state:"incomplete"
// WITHOUT the error:true stamp (see doEnumerate). The marker token is load-bearing — keep it.
const TOO_MANY_RE = /tooManyResults\D*(\d+)?/i;
export function tooManyResultsCount(message) {
  const m = TOO_MANY_RE.exec(String(message ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

const echoOf = (params) => (markTermsOf(params)[0] ?? ownerTermsOf(params)[0] ?? params?.representative ?? "");

/**
 * Did the PROVIDER'S PARSER refuse this query? (As opposed to a transport fault, a crowd, or our own
 * client-side refusal.) The two owner arms that degrade back to the un-resolved sweep — doEnumerate and
 * doCount — must agree on what "refused" means, and they used to carry a private copy of this regex
 * each; landed the count arm's degrade, so the predicate is named once and shared.
 * PURE.
 */
export const providerRejectedTheQuery = (reason) => /HTTP 400|did not recognize the syntax/i.test(String(reason ?? ""));

export async function doSearch(apiKey, base, params, tctx) {
  if (!hasAnyElement(params)) {
    return { type: "text", text: "ERROR: clarivate_search — at least one search element (query, name, names, owner, owners, representative) is required." };
  }
  // The owner name is resolved HERE too, not only inside doEnumerate — see resolveOwnerParamsOnce for
  // why a search that never asked the provider's own owner vocabulary can answer 0 over a real filer.
  const { params: p, note: ownerResolution } = await resolveOwnerParamsOnce(apiKey, base, params, tctx);
  let body;
  try { body = buildSearchRequest(p); }
  catch (e) { return { type: "text", text: `ERROR: clarivate_search — ${e.message}` }; }

  const echo = echoOf(p);
  const callTctx = { ...tctx, target: String(echo).slice(0, 200) };
  const r = await clarivateFetch(apiKey, base, "/search", { body, tctx: callTctx });
  if (!r.ok) {
    const msg = errText(r);
    const tooMany = tooManyResultsCount(msg);
    if (tooMany != null) {
      // NOT a fault: the provider is truthfully telling us the band is a crowd. doEnumerate restates
      // this as an `incomplete` crowd descriptor with no error:true stamp.
      return { type: "text", text: `ERROR: clarivate_search — tooManyResults: ${tooMany} records exceed the provider's ${CAPABILITIES.resultCeiling}-result search ceiling` };
    }
    return { type: "text", text: `ERROR: clarivate_search HTTP ${r.status}${msg ? `: ${msg}` : ""}` };
  }
  // A 200 with an unparsed body would normalize to an empty ids{} — zero guids, state:"enumerated".
  // This provider happened to have a second net (doCount refuses, and the kernel's count/search
  // divergence check catches a populated probe against an empty search) but neither net covers a band
  // whose count could not be read either. Refuse at the source, in the vocabulary corsearch uses.
  if (r.parseError) return { type: "text", text: unparsedBodyError("clarivate_search", r, ` query=${String(echo).slice(0, 200)}`) };
  // Parsing is not answering: a 200 carrying this provider's own {"errorMessage":…} envelope (or any
  // other parseable non-search body) used to normalize to an empty ids{} — zero guids read as an
  // answered search. Only the ids{} shape is an answer; see isSearchResponseBody.
  if (!isSearchResponseBody(r.body)) {
    return { type: "text", text: nonAnswerBodyError("clarivate_search", r, "a search response (no ids{} — the one key POST /search answers with)", ` query=${String(echo).slice(0, 200)}`) };
  }
  const out = normalizeSearchResponse(r.body, echo, p.match_mode || "default");
  // The resolution note rides on the answer, exactly as it does on the enumerate result: a reader has
  // to be able to see WHICH applicant styling this sweep actually asked for, and a zero over an owner
  // whose styling was never found is a different fact from a zero over one whose styling was.
  if (ownerResolution) out.owner_resolution = ownerResolution;
  return { type: "text", text: JSON.stringify(out, null, 2) };
}

// ── Count ─────────────────────────────────────────────────────────────────────────────────────────
// POST /count takes the SAME SearchRequest body as /search, is cheap, works at ANY magnitude (209012
// returned without complaint) and returns PER-OFFICE counts in one call. This is the enumerate
// kernel's countProbe:"endpoint" dependency, so it returns the kernel's plain probe shape
// { ok, total, reason } — plus `per_office`, which is richer than corsearch can offer and rides into
// the crowd descriptor for judgment.

/** ONE /count round trip over already-resolved params. Returns the kernel's plain probe shape. */
async function countOnce(apiKey, base, p, tctx) {
  let body;
  try { body = buildSearchRequest(p); }
  // A buildSearchRequest throw is a CLIENT-SIDE REFUSAL: the request was never sent, and the answer can
  // never change on a retry (an office outside the 186-code vocabulary, a term carrying parentheses or
  // a 2-letter operator word this query language cannot state, a missing regions[]).
  // Marked as a capability gap so the plan executor DEFERS the slice — a disclosed coverage row the
  // lawyer reads — instead of stamping a transient error and grinding the whole run to a fan-in
  // StageFailure over an answer that will never differ. A real HTTP failure below keeps the transient
  // reading and rides the repair ladder, exactly as before.
  catch (e) { return { ok: false, total: null, per_office: null, reason: `${CAPABILITY_GAP_MARKER} ${e.message}` }; }

  const r = await clarivateFetch(apiKey, base, "/count", { body, tctx: { ...tctx, target: String(echoOf(p)).slice(0, 200) } });
  if (!r.ok) return { ok: false, total: null, per_office: null, reason: `HTTP ${r.status}${errText(r) ? `: ${errText(r)}` : ""}` };
  // Named rather than folded into the "no counts{}" branch below: both refuse (total null, never 0),
  // but someone repairing a run needs to know the response was CUT, not that the provider answered in
  // a shape we did not expect.
  if (r.parseError) return { ok: false, total: null, per_office: null, reason: `unparseable /count response body (HTTP ${r.status}, ${r.parseError}) — nothing was counted` };

  const counts = (r.body && typeof r.body.counts === "object" && r.body.counts) ? r.body.counts : null;
  if (!counts) return { ok: false, total: null, per_office: null, reason: "no counts{} in the /count response" };

  const per_office = {};
  let total = 0;
  for (const [office, n] of Object.entries(counts)) {
    const v = Number(n);
    if (!Number.isFinite(v)) continue;
    per_office[office] = v;
    total += v;
  }
  return { ok: true, total, per_office, reason: null };
}

export async function doCount(apiKey, base, params, tctx) {
  // The owner name is resolved on THIS path too (resolveOwnerParamsOnce). This is the arm the shared
  // plan executor's `expected_kind:"count"` descriptor dispatches through, so before this it was the
  // one owner lane that asked the register nothing but the caller's own spelling of the name — and a
  // bare-owner count is exactly where the answer is read as a portfolio SIZE.
  // `owner_resolution` rides on the probe shape so the executor can tell an owner whose styling the
  // provider knows from one whose it does not; the shared count kernel (providers/_shared/count.mjs)
  // returns a fixed shape and drops it, which is why the executor calls doCount directly.
  const { params: p, note: resolution } = await resolveOwnerParamsOnce(apiKey, base, params, tctx);
  let ownerResolution = resolution;
  let out = await countOnce(apiKey, base, p, tctx);

  // ── the ADDITIVE invariant, ENFORCED ON THE COUNT ARM TOO ────────────────────────────────
  // doEnumerate has had this fallback since the live run that died on "MONSTER ENERGY COMPANY, SOCIÉTÉ
  // ORGANISÉE SELON LES LOIS DE L'ETAT DU DELAWARE". The COUNT arm never got it, and the count arm is
  // what `expected_kind:"count"` dispatches through (see __executePlan below) — so on the one owner
  // lane the executor routes here, resolution was SUBTRACTIVE: it OR-joins up to maxOrWidth resolved
  // stylings into ONE APPLICANT_NAME value, and a single member 400s the
  // whole value, taking down the caller's own term, which would have answered on its own. The slice
  // then owns no band block and the fan-in gate fails the run — deterministic, so no repair rung can
  // change it. That is the shape was raised on: `clarivate count probe — HTTP 400: APPLICANT_NAME`.
  //
  // The screen above now implements the whole of the vendor's published unsearchable set, but statically
  // predicting every real-world company styling in every language the registers hold is a losing game —
  // which is exactly why the enumerate arm degrades instead of predicting. This is the same move, in the
  // same shape, so the two arms cannot drift: re-run on the caller's OWN owner term, take the result only
  // if it actually got somewhere, and NAME the degradation on the note.
  //
  // `ownerNameResolved` (providers/_shared/execute-plan.mjs) already reads
  // `degraded_to_unresolved_sweep === true` as "no register styling backed this sweep", so a zero that
  // comes back from the degraded probe keeps its UNVERIFIED descriptor with no change there.
  if (!out.ok && ownerResolution && providerRejectedTheQuery(out.reason)
      && Array.isArray(p?.owners) && p.owners.length > ownerTermsOf(params).length) {
    // `resolve_owner:false` is not decoration: without it resolveOwnerParamsOnce would re-expand the
    // very stack whose expansion the provider just refused.
    const rawOnly = { ...params, resolve_owner: false };
    delete rawOnly.owners;
    const { params: p2 } = await resolveOwnerParamsOnce(apiKey, base, rawOnly, tctx);
    const out2 = await countOnce(apiKey, base, p2, tctx);
    // Only ACCEPT the fallback if it actually got somewhere — a raw sweep that is refused too leaves the
    // original (expanded) failure standing, so the reason the reader sees is the real one.
    if (!providerRejectedTheQuery(out2.reason)) {
      ownerResolution = {
        ...ownerResolution,
        degraded_to_unresolved_sweep: true,
        degradation_reason: `the provider REJECTED the resolution-expanded APPLICANT_NAME stack (${p.owners.length} names): ${String(out.reason ?? "").slice(0, 200)}. `
          + `Resolution is additive-only, so the count fell back to the caller's own owner term(s) — ${ownerTermsOf(params).join(", ")}. `
          + `This is the UN-RESOLVED sweep: narrower than the expansion intended, never narrower than what was asked for.`,
      };
      out = out2;
    }
  }

  // The kernel's whole-stack probe result is surfaced to doEnumerate through this sink so the crowd
  // descriptor can carry per-office truth (the kernel is provider-agnostic and has no field for it).
  // Pushed from the ACCEPTED probe, so a degraded count reports the counts it actually took.
  if (out.ok && Array.isArray(params?.__countSink)) params.__countSink.push({ total: out.total, per_office: out.per_office });
  return ownerResolution ? { ...out, owner_resolution: ownerResolution } : out;
}

// EXACT: `{"errorMessage":"ids - Maximum number of ids is 100."}` at 101+.
export const TEXT_BATCH_MAX = 100;

function splitRefs(inputs) {
  const officeByGuid = {};
  const guids = [];
  for (const ref of inputs) {
    const guid = refToGuid(ref);
    if (!guid) continue;
    guids.push(guid);
    const o = refToOffice(ref);
    if (o) officeByGuid[guid] = o;
  }
  return { officeByGuid, guids };
}

async function fetchText(apiKey, base, group, testMode, tctx) {
  const body = { ids: group };
  if (testMode) body.test = true;
  const target = group.slice(0, 5).join(",") + (group.length > 5 ? `+${group.length - 5}` : "");
  const r = await clarivateFetch(apiKey, base, "/text", { body, tctx: { ...tctx, target } });
  if (!r.ok) return { ok: false, raw: [], error: `HTTP ${r.status} for a ${group.length}-id chunk: ${errText(r)}` };
  // On this provider /text is the ONLY source of mark text, classes, status and owner (the search
  // returns bare guids), and the kernel's contentFromScreen seam reads a chunk error to decide whether
  // a band's content landed. An unparsed chunk that reported no error made a band of nameless ids look
  // fully screened.
  if (r.parseError) return { ok: false, raw: [], error: `unparseable body (HTTP ${r.status}, ${r.parseError}) for a ${group.length}-id chunk` };
  // Shape, not just parse: /text answers { trademarks:[…], nonTrademarks:[…] }.
  // A parseable body that is neither that envelope nor a bare record array —
  // e.g. {"errorMessage":…} served with a 200 — used to fall through `[r.body]` and be normalized
  // into ONE all-null "record": a fabricated record minted from a call the provider never answered,
  // persisted for the citation gate and counted as a screened row. It is a failed chunk, exactly
  // like the unparseable case above. (A guid that is not a trademark record lands in nonTrademarks —
  // a provider FACT the kernel's contentFromScreen seam already respects — so an all-nonTrademarks
  // answer still reads as an answer with zero trademark rows, never as a failure.)
  const raw = Array.isArray(r.body?.trademarks) || Array.isArray(r.body?.nonTrademarks)
    ? (Array.isArray(r.body.trademarks) ? r.body.trademarks : [])
    : Array.isArray(r.body) ? r.body
    : null;
  if (raw === null) {
    return { ok: false, raw: [], error: `non-answer body (HTTP ${r.status}, parsed but not a /text response`
      + `${errText(r) ? ` — the body says: ${JSON.stringify(String(errText(r)).slice(0, 120))}` : ""}) for a ${group.length}-id chunk` };
  }
  return { ok: true, raw, error: null };
}

// ── Record fetch ──────────────────────────────────────────────────────────────────────────────────
// Accepts record_ids that are EITHER synthetic `/mark/<office>/<guid>` refs OR bare guids (so the
// skill flow is identical to Corsearch: search → record_id → record_fetch(record_id)). Returns the
// NORMALIZED records and persists each (keyed by its synthetic ref) for the driver's A1 citation gate.
// /text takes EXACTLY 100 ids per call (101+ → HTTP 400) — chunked here, at the bound the probe pins.
export async function doRecordFetch(apiKey, base, params, tctx) {
  const inputs = Array.isArray(params.record_ids) ? params.record_ids : [];
  if (inputs.length === 0) return { type: "text", text: "ERROR: clarivate_record_fetch — record_ids is required (non-empty array of refs or guids)." };

  const { officeByGuid, guids } = splitRefs(inputs);
  const groups = chunk(guids, TEXT_BATCH_MAX);
  const records = [];
  const errors = [];
  for (const group of groups) {
    const { ok, raw, error } = await fetchText(apiKey, base, group, params.test_mode, tctx);
    if (!ok) { errors.push(error); continue; }
    for (const rec of raw) records.push(normalizeRecord(rec, rec?.id ? officeByGuid[rec.id] : null));
  }
  if (!records.length && errors.length) {
    return { type: "text", text: `ERROR: clarivate_record_fetch — ${errors.join("; ")}` };
  }
  // A1: persist each normalized record keyed by its synthetic ref so the driver can field-verify
  // registry identifiers and archive the record into the run. (test_mode bodies are obfuscated — skip.)
  if (!params.test_mode) {
    for (const nr of records) if (nr?.uri) logRecordBody({ ...tctx, kind: "record_fetch" }, nr.uri, nr);
  }
  return { type: "text", text: JSON.stringify({ count: records.length, records, errors: errors.length ? errors : undefined }, null, 2) };
}

// ── Batch screen (POST /text, 100/call) ───────────────────────────────────────────────────────────
// Clarivate has NO separate cheap screening tier: /text is both the screen and the hydration (hence
// capabilities.screenSource === "billed-record-fetch"). The verdict vocabulary is the SHARED closed set
// (drop:dead | drop:out-of-class | surface:in-scope-live | surface:all-class | deepfetch:ambiguous) —
// byte-for-byte corsearch's, so a downstream gate cannot tell the providers apart.
export async function doBatchScreen(apiKey, base, params, tctx) {
  const inputs = (Array.isArray(params?.uris) ? params.uris : Array.isArray(params?.record_ids) ? params.record_ids : [])
    .filter((u) => typeof u === "string" && u);
  if (inputs.length === 0) return { type: "text", text: "ERROR: clarivate_batch_screen — uris (a non-empty array of refs or guids) is required" };
  const inScopeClasses = Array.isArray(params?.in_scope_classes)
    ? params.in_scope_classes.map(Number).filter(Number.isFinite) : [];

  const { officeByGuid, guids } = splitRefs(inputs);
  const groups = chunk(guids, TEXT_BATCH_MAX);
  const rows = [];
  const errors = [];
  const normalized = [];
  for (const group of groups) {
    const { ok, raw, error } = await fetchText(apiKey, base, group, params.test_mode, tctx);
    if (!ok) { errors.push(error); continue; }
    for (const rec of raw) {
      const nr = normalizeRecord(rec, rec?.id ? officeByGuid[rec.id] : null);
      normalized.push(nr);
      const row = {
        uri: nr.uri,
        guid: nr.guid,
        office: nr.office,
        mark_text: nr.markText,
        // cause 1 — THE MARK'S OWN READING TRAVELS WITH IT.
        //
        // The asymmetry is on the two lines below: the OWNER's name already rides in both scripts
        // (`owner` + `owner_native`) and the MARK's rode in one. The office records a reading for its
        // own non-Latin filings, `normalizeRecord` already carries it, and this row dropped it — so
        // judgment was shown a native-script mark beside its own romanised query with no reading on
        // either and concluded they were different marks. A delivered report told a client a
        // jurisdiction had not been searched in its own script while the run held both the query and
        // this value. On the measured round 558 of 1,937 records had one to carry.
        //
        // Null where the office records none, which is most Latin-script filings: this says what the
        // register says, and inventing a romanisation here would be this row certifying a reading
        // nobody filed.
        mark_transliteration: nr.markTransliteration ?? null,
        classes: nr.niceClasses,
        status: nr.statusText,
        owner: nr.owner,
        owner_native: nr.ownerNative,
        owner_country: nr.ownerCountry,
        application_date: nr.applicationDate,
        registration_date: nr.registrationDate,
        expiry_date: nr.expiryDate,
        live_status: liveStatusOf(rec),
        all_class: isAllClass(nr.niceClasses),
      };
      row.screen_verdict = screenVerdict(row, inScopeClasses);
      rows.push(row);
    }
  }
  if (rows.length === 0 && errors.length) {
    return { type: "text", text: `ERROR: clarivate_batch_screen — ${errors.join("; ")}` };
  }
  // The screen call IS the billed record fetch, so the band is fully hydrated here — persist it for the
  // driver's citation-fidelity gate exactly as record_fetch does (obfuscated test bodies excluded).
  if (!params.test_mode) {
    for (const nr of normalized) if (nr?.uri) logRecordBody({ ...tctx, kind: "batch_screen" }, nr.uri, nr);
  }
  const verdict_summary = {};
  for (const row of rows) verdict_summary[row.screen_verdict] = (verdict_summary[row.screen_verdict] ?? 0) + 1;
  return { type: "text", text: JSON.stringify({
    requested: inputs.length, returned: rows.length, chunks: groups.length,
    in_scope_classes: inScopeClasses.length ? inScopeClasses : "NOT PROVIDED — live marks fail-safe to surface:in-scope-live (no class-drop)",
    errors: errors.length ? errors : undefined,
    note: "Per-row `screen_verdict` (CLOSED SET) is the keep/drop authority — NOT the mark name or owner. drop:dead = a confidently dead status; drop:out-of-class = live but no in-scope-class overlap and not all_class — these two are batch-screen-authoritative drops. surface:in-scope-live and surface:all-class = a real in-scope candidate: decide it on the record's goods & services (this provider returns them on this very call). deepfetch:ambiguous = status unrecognised, never auto-drop.",
    verdict_summary,
    rows,
  }, null, 2) };
}

// ── Company resolution (POST /resolution/company) ──────────────────────────────────────────────────
// Resolves a loose company name to CONFIDENCE-SCORED exact applicant
// names with per-office trademark counts, so the owner cross-check sweeps the applicant names the
// register actually holds instead of a guess at the entity's styling.
//
// THRESHOLD (a judgment call, recorded): accept confidenceScore >= 50. The probe's control returned one
// applicant styling at 74.0/156 marks, a second at 50.0/1, then 32/31/31 — a clean break below 50. The
// scores are the probe's; the names are not, and the fixture spells them PAKA IZHUSEDI C.V. and IZHUSEDI
// ATQUDCGOXET LIMITED (fixtures/README.md). Over-inclusive is the SAFE direction here: a
// surplus applicant name adds marks a lawyer can discard, a missing one is invisible.
// And the expansion is strictly ADDITIVE — the caller's raw term is ALWAYS swept as well, so
// resolution can only ever gain recall, never lose it (a failed or empty resolution degrades to exactly
// the un-resolved sweep, which is the corsearch-parity behaviour).
export const OWNER_RESOLUTION_MIN_CONFIDENCE = 50;

export async function resolveCompany(apiKey, base, { companyName, regions }, tctx) {
  const { codes, unknown } = resolveOffices(regions);
  if (unknown.length) return { ok: false, companies: [], reason: `jurisdiction(s) [${unknown.join(", ")}] are outside this provider's office vocabulary` };
  if (!codes.length) return { ok: false, companies: [], reason: "regions[] is required" };
  const name = String(companyName ?? "").trim();
  if (!name) return { ok: false, companies: [], reason: "companyName is required" };

  const r = await clarivateFetch(apiKey, base, "/resolution/company",
    { body: { registrationOfficeCodes: codes, companyName: name }, tctx: { ...tctx, target: name.slice(0, 200) } });
  if (!r.ok) return { ok: false, companies: [], reason: `HTTP ${r.status}${errText(r) ? `: ${errText(r)}` : ""}` };
  // An unparsed body here resolved to ZERO companies with ok:true — the owner sweep then runs
  // un-widened while reporting itself resolved. Additive-only means a failed expansion must be VISIBLE.
  if (r.parseError) return { ok: false, companies: [], reason: `unparseable /resolution/company response body (HTTP ${r.status}, ${r.parseError}) — no applicant was resolved` };
  const companies = (Array.isArray(r.body?.companies) ? r.body.companies : []).map((c) => ({
    applicant_name: c?.applicantName ?? null,
    office: c?.registrationOfficeCode ?? null,
    trademarks: Number.isFinite(Number(c?.numberOfTrademarksFound)) ? Number(c.numberOfTrademarksFound) : null,
    confidence: Number.isFinite(Number(c?.confidenceScore)) ? Number(c.confidenceScore) : null,
  })).filter((c) => c.applicant_name);
  return { ok: true, companies, reason: null };
}

export async function doResolveCompany(apiKey, base, params, tctx) {
  const companyName = params?.company_name ?? params?.owner ?? null;
  const out = await resolveCompany(apiKey, base, { companyName, regions: params?.regions }, tctx);
  if (!out.ok) return { type: "text", text: `ERROR: clarivate_resolve_company — ${out.reason}` };
  const threshold = Number.isFinite(Number(params?.min_confidence)) ? Number(params.min_confidence) : OWNER_RESOLUTION_MIN_CONFIDENCE;
  return { type: "text", text: JSON.stringify({
    company_name: companyName,
    min_confidence: threshold,
    accepted: out.companies.filter((c) => (c.confidence ?? 0) >= threshold).map((c) => c.applicant_name),
    companies: out.companies,
  }, null, 2) };
}

/**
 * Expand an owner sweep's terms with the resolved exact applicant names. ADDITIVE by construction:
 * the caller's own terms are always kept, so this can only widen. Returns the params to sweep plus a
 * note that rides on the enumerate result for the record.
 */
export async function expandOwnerTerms(apiKey, base, params, tctx) {
  const raw = ownerTermsOf(params);
  const threshold = Number.isFinite(Number(params?.min_confidence)) ? Number(params.min_confidence) : OWNER_RESOLUTION_MIN_CONFIDENCE;
  const resolved = [];
  const errors = [];
  for (const term of raw) {
    const out = await resolveCompany(apiKey, base, { companyName: term, regions: params?.regions }, tctx);
    if (!out.ok) { errors.push(`${term}: ${out.reason}`); continue; }
    for (const c of out.companies) if ((c.confidence ?? 0) >= threshold) resolved.push(c);
  }
  // ── the ADDITIVE invariant, ENFORCED (review finding 5) ──────────────────────────────────────────
  // /resolution/company hands back REAL register styling — an entity's own "… C.V.", and in the wider
  // population "MARKS AND SPENCER PLC" or "SMITH (HOLDINGS) LTD". Those contain the reserved boolean
  // word AND / parentheses, which this provider parses as OPERATORS inside the value string. Pushed
  // unvalidated into owners[], the FIRST such name made buildSearchRequest throw over the WHOLE
  // APPLICANT_NAME searchField — killing the caller's own clean term, which had succeeded on its own a
  // moment earlier. The documented "strictly ADDITIVE, can only ever gain recall, never lose it"
  // invariant was therefore INVERTED, and it fired precisely on the well-known owners resolution
  // exists to help with.
  // Resolved names are a BONUS expansion, so an unsearchable one is DROPPED (and reported) — that
  // degrades to exactly the un-resolved sweep, which is the documented failure mode. The CALLER's own
  // terms are never filtered here: an unsearchable caller term still fails loud downstream and becomes
  // a disclosed deferred coverage row (doctrine 2), never a quietly narrowed search.
  const merged = [...raw];
  const unsearchable = [];
  for (const c of resolved) {
    const name = String(c.applicant_name ?? "").trim();
    if (!name) continue;
    if (merged.some((t) => t.toLowerCase() === name.toLowerCase())) continue;
    // Screen the name AS IT WILL BE SENT. buildSearchRequest sanitizes `" { } ( )` at the chokepoint,
    // so screening the raw string would drop names that go out perfectly well — which is exactly what
    // happened at worldwide scope, where a resolve returns hundreds of foreign applicant names.
    try { assertSearchableTerm(sanitizeOwnerName(name), { allowWildcard: true }); }
    catch (e) { unsearchable.push({ applicant_name: name, reason: String(e.message).slice(0, 160) }); continue; }
    // NOTE: apostrophes are NOT filtered here either. They are unsearchable literally, but expressible
    // as the `?` wildcard, so buildSearchRequest expands them at the chokepoint (see expandApostrophe)
    // and the name keeps its recall instead of being dropped. An earlier revision dropped "elided
    // article" names here on a mis-scoped rule; the character, not the elision, is the problem.
    merged.push(name);
  }
  // Budget by the EXPANDED width, not the name count: buildSearchRequest turns each apostrophe'd name
  // into TWO OR-operands (`TRADER VIC?S OR TRADER VICS`), so a flat slice at maxOrWidth overflows by
  // exactly the number of apostrophes in the stack — and the stack is then refused whole, taking the
  // slice with it. A regression introduced when it made the apostrophe expressible.
  const swept = [];
  let width = 0;
  for (const name of merged) {
    const cost = expandApostrophe(sanitizeOwnerName(name)).length;   // count what actually goes on the wire
    if (width + cost > CAPABILITIES.maxOrWidth) break;
    swept.push(name);
    width += cost;
  }
  const note = {
    min_confidence: threshold,
    raw_terms: raw,
    resolved: resolved.map((c) => ({ applicant_name: c.applicant_name, confidence: c.confidence, trademarks: c.trademarks, office: c.office })),
    swept,
    errors: errors.length ? errors : undefined,
    // A resolved name we cannot express in this provider's query language is a NAMED, DISCLOSED gap
    // riding on the enumerate result — never a silent drop, and never a reason to lose the sweep.
    unsearchable_resolved: unsearchable.length ? unsearchable : undefined,
    note: "ADDITIVE: the caller's own owner term is always swept, so resolution can only widen the sweep. A resolution failure — or a resolved applicant name this provider's query language cannot express (see unsearchable_resolved) — degrades to the un-resolved sweep, never to a narrower one.",
  };
  const next = { ...params, owners: swept };
  delete next.owner;
  return { params: next, note };
}

// ── THE OWNER NAME IS RESOLVED WHEREVER AN OWNER QUERY ENTERS THIS PROVIDER, NOT ONLY ON ENUMERATE ──
//
// expandOwnerTerms used to have exactly ONE call site: doEnumerate. doCount and doSearch never called
// it, and the shared plan executor's count arm dispatches through the `search` seam — which on this
// provider is wired to doCount (see __executePlan below, where routing a saturation count through
// POST /search would fail loud past 30000). So on the COUNT path the owner name was never resolved
// against the provider's own owner vocabulary at all.
//
// That matters because APPLICANT_NAME EQUALS is not a full-string equality: a bare space in the value
// is an IMPLICIT AND over the tokens (a two-word owner term = 156 == that owner's
// full `… C.V.` styling = 156, and the mark field behaves the same way). So an un-resolved owner term is usually
// BROADER than the register's own styling, not narrower — which is why this went unnoticed. But an AND
// still requires EVERY token the caller wrote to appear in the applicant string, and a manifest names
// an owner the way the world writes it, not the way the register spells it. One token the register does
// not hold — a group/holding suffix, a trading name, a translated legal form — and the whole conjunction
// is empty. The call comes back HTTP 200 with `counts:{}`, the count is 0, and 0 is then read as the
// size of that owner's portfolio. Zero-with-no-error is the same false-clean shape capabilities.js
// records for non-Latin mark terms, and it lands on the biggest filers, where a reader is least likely
// to doubt it.
//
// /resolution/company is the fix and it already exists: it hands back the exact applicant styling the
// register holds, which is precisely the token set the caller could not guess. Resolution is ADDITIVE
// by construction (expandOwnerTerms keeps the caller's own terms and only ever appends), so bringing it
// to this path can gain recall and cannot narrow a search.
//
// THE MARKER, and why it rides on `params`. doEnumerate resolves and then hands its EXPANDED params to
// the shared enumerate kernel, which calls doCount and doSearch again underneath — once per count
// probe, once per per-term rescue, once per OR-width window. Without a marker each of those would
// re-resolve names that are ALREADY the register's own styling: a /resolution/company call per swept
// name, and an expansion of an expansion, which is a different query from the one the caller's params
// describe. The marker is an internal `__`-prefixed param exactly like `__countSink`, and
// buildSearchRequest ignores params it does not know, so it never reaches the wire.
const OWNER_RESOLUTION_PARAM = "__owner_resolution";

/**
 * Resolve the owner terms on these params ONCE, and carry the note so every seam can surface it.
 *
 * Returns the params to search plus the resolution note (null when there was nothing to resolve).
 * A no-op — same params object, null note — when the caller opted out with `resolve_owner:false`,
 * when the query carries no owner term, or when these params have already been through here.
 */
export async function resolveOwnerParamsOnce(apiKey, base, params, tctx) {
  const already = params?.[OWNER_RESOLUTION_PARAM];
  if (already) return { params, note: already };
  if (params?.resolve_owner === false) return { params, note: null };
  if (ownerTermsOf(params).length === 0) return { params, note: null };
  const { params: next, note } = await expandOwnerTerms(apiKey, base, params, tctx);
  return { params: { ...next, [OWNER_RESOLUTION_PARAM]: note }, note };
}

// ── Image fetch (metadata only) ─────────────────────────────────────────────────────────────────
export async function doImageFetch(apiKey, base, params, tctx) {
  const inputs = Array.isArray(params.record_ids) ? params.record_ids : [];
  if (inputs.length === 0) return { type: "text", text: "ERROR: clarivate_image_fetch — record_ids is required (non-empty array)." };
  const useTest = params.test_mode !== false;
  const results = [];
  for (const ref of inputs) {
    const guid = refToGuid(ref);
    const body = { id: guid };
    if (useTest) body.test = true;
    const r = await clarivateFetch(apiKey, base, "/image", { body, tctx: { ...tctx, target: guid } });
    if (!r.ok) {
      results.push({ guid, error: `HTTP ${r.status}: ${errText(r)}` });
      continue;
    }
    // A truncated 200 (body null) fell through `r.body ?? {}` → `[upstream]` → one summary row with
    // has_image:false — "this record has no image" from a call that never landed. A parseable error
    // envelope took the same path. Both are per-guid FAILURES, reported in the same error field the
    // HTTP failure above uses; the answer shape is the vendor's ImageRetrievalResponse ({ images }).
    if (r.parseError) {
      results.push({ guid, error: `unparseable body (HTTP ${r.status}, ${r.parseError}) — the image call did not land; this is NOT "no image"` });
      continue;
    }
    const imgs = Array.isArray(r.body?.images) ? r.body.images : Array.isArray(r.body) ? r.body : null;
    if (imgs === null) {
      results.push({ guid, error: `non-answer body (HTTP ${r.status}, parsed but not an image response`
        + `${errText(r) ? ` — the body says: ${JSON.stringify(String(errText(r)).slice(0, 120))}` : ""}) — this is NOT "no image"` });
      continue;
    }
    const summary = imgs.map((img) => ({
      content_type: img?.contentType ?? img?.mimeType ?? null,
      image_size_bytes: typeof img?.image === "string" ? img.image.length : null,
      has_image: typeof img?.image === "string" && img.image.length > 0,
      available_keys: Object.keys(img || {}),
    }));
    results.push({ guid, test_mode: useTest, images: summary });
  }
  return { type: "text", text: JSON.stringify({ test_mode: useTest, count: results.length, results }, null, 2) };
}

// ── Filing date (per-register data freshness) ─────────────────────────────────────────────────────
// POST /filingdate — how CURRENT each register's data is (recordLastUpdated yyyyMMdd + the office's own
// currency notes). A coverage claim is only as good as the freshness of the register behind it.
export async function doFilingDate(apiKey, base, params, tctx) {
  const { codes, unknown } = resolveOffices(params?.regions);
  if (unknown.length) return { type: "text", text: `ERROR: clarivate_filing_date — jurisdiction(s) [${unknown.join(", ")}] are outside this provider's office vocabulary` };
  if (!codes.length) return { type: "text", text: "ERROR: clarivate_filing_date — regions[] is required" };
  const r = await clarivateFetch(apiKey, base, "/filingdate", { body: { registrationOfficeCodes: codes }, tctx: { ...tctx, target: codes.join(",") } });
  if (!r.ok) return { type: "text", text: `ERROR: clarivate_filing_date HTTP ${r.status}${errText(r) ? `: ${errText(r)}` : ""}` };
  // A truncated 200 or a parseable error envelope fell through `Array.isArray(r.body?.filingDates)
  // ? … : []` as {"count":0,"registers":[]} — a register-freshness claim of "nothing to report"
  // minted from a call the provider never answered. The answer shape is the vendor's
  // FilingDatesRetrievalResponse: filingDates[].
  if (r.parseError) return { type: "text", text: unparsedBodyError("clarivate_filing_date", r, ` offices=${codes.join(",")}`) };
  if (!Array.isArray(r.body?.filingDates)) {
    return { type: "text", text: nonAnswerBodyError("clarivate_filing_date", r, "a filing-date response (no filingDates[] — the one key POST /filingdate answers with)", ` offices=${codes.join(",")}`) };
  }
  const rows = r.body.filingDates.map((f) => ({
    office: f?.registrationOfficeCode ?? null,
    office_name: f?.registrationOfficeName ?? null,
    record_last_updated: yyyymmddToIso(f?.recordLastUpdated),
    notes: Array.isArray(f?.filingDatesText) ? f.filingDatesText : null,
  }));
  return { type: "text", text: JSON.stringify({ count: rows.length, registers: rows }, null, 2) };
}

// ── Enumerate — WIRED FROM THE SHARED KERNEL ──────────────────────────────────────────────────────
//
// The control flow (states, ceilings, the wide-`names` chunking, the count-first per-term rescue) lives
// in providers/_shared/enumerate.mjs — ONE implementation for every provider. This module supplies only
// the clarivate callables and declares its two capability seams (read from ./capabilities.js, never
// restated as literals here):
//
//   countProbe: "endpoint"              — POST /count FIRST (cheap, works at any magnitude, per-office),
//                                         so the ceiling is tested BEFORE the search. /search has no
//                                         partial mode: it returns the complete guid set or fails loud.
//   screenSource: "billed-record-fetch" — POST /text, 100/call, which screens AND hydrates.
//
// pageParams is EMPTY: this provider is single-shot, so there is no page/limit parameter to send.
const { enumerate: __enumerate } = makeEnumerate({
  search: (auth, params, tctx) => doSearch(auth.apiKey, auth.base, params, tctx),
  count: (auth, params, tctx) => doCount(auth.apiKey, auth.base, params, tctx),
  screen: (auth, params, tctx) => doBatchScreen(auth.apiKey, auth.base, params, tctx),
  hasAnyElement,
  missingElementError: "ERROR: clarivate_enumerate — at least one search element (query, name, names, owner, owners, representative) is required.",
  capabilities: { ...CAPABILITIES.kernel },
  pageParams: () => ({}),
  namesKey: "names",
  recordIdOf: (rec) => rec?.record_id,
  screenJoinKey: (row) => row?.uri,
});

export async function doEnumerate(apiKey, base, params, tctx) {
  // The owner sweep resolves the company name FIRST (one cheap call) and then sweeps APPLICANT_NAME
  // over the resolved exact names ∪ the caller's own term. Opt out with resolve_owner:false.
  // Routed through resolveOwnerParamsOnce so that this — the path that HAD resolution — and the count
  // and search paths that did not are now one implementation, and so the expanded params carry the
  // marker that stops the kernel's own doCount/doSearch calls from resolving a second time.
  let { params: p, note: ownerResolution } = await resolveOwnerParamsOnce(apiKey, base, params, tctx);
  // Is this call wide enough that the kernel splits it into OR-width windows? (Mirrors the kernel's own
  // env-tunable bound — see the per_office_counts note below, which is the only thing it decides here.)
  const envChunk = Number(process.env.CLEAROTRON_ENUMERATE_NAMES_CHUNK);
  const namesChunk = Number.isFinite(envChunk) && envChunk >= 1 ? Math.floor(envChunk) : CAPABILITIES.kernel.namesChunkDefault;
  const chunked = Array.isArray(p?.names) && p.names.filter(Boolean).length > namesChunk;

  const sink = [];
  let r = await __enumerate({ apiKey, base }, { ...p, __countSink: sink }, tctx);
  let parsed = parseToolText(r);
  if (!parsed) return r;

  // ── the ADDITIVE invariant, ENFORCED AT RUNTIME TOO ─────────────────────────────────────────────
  // expandOwnerTerms filters resolved names through assertSearchableTerm, which catches the shapes we
  // KNOW break the parser (reserved boolean words, parentheses). It cannot catch the ones we have not
  // met yet, and the population is real-world company styling in every language the registers hold.
  // Live example that killed a run: "MONSTER ENERGY COMPANY, SOCIÉTÉ ORGANISÉE SELON LES LOIS DE
  // L'ETAT DU DELAWARE" — the guard passes it, the provider answers HTTP 400 ("the following
  // characters are not searchable by themselves"), and because resolution OR-joins up to maxOrWidth
  // names into ONE APPLICANT_NAME value, that single member takes the whole stack down WITH the
  // caller's own term. The entry then owns no band block and the fan-in gate fails the entire run.
  //
  // Statically predicting every unsearchable styling is a losing game; degrading is not. Resolution is
  // documented as a BONUS expansion — "strictly ADDITIVE, can only ever gain recall, never lose it" —
  // so when the expanded stack is rejected, fall back to the sweep the caller actually asked for. That
  // is the un-resolved sweep, which is the documented failure mode, and it is strictly better than
  // losing the slice. The degradation is NAMED on the result (never silent), so a reader can see the
  // sweep was un-widened rather than believing it ran expanded.
  const providerRejected = parsed.state === "incomplete" && providerRejectedTheQuery(parsed.reason);
  if (providerRejected && ownerResolution && Array.isArray(p?.owners) && p.owners.length > ownerTermsOf(params).length) {
    // `resolve_owner:false` is not decoration here: doCount and doSearch now resolve on their own, so
    // without it the kernel's calls underneath this fallback would re-resolve the very names whose
    // expansion the provider has just rejected — reinstating the stack the fallback exists to drop.
    // The un-resolved sweep has to be genuinely un-resolved, at every seam.
    const rawOnly = { ...params, resolve_owner: false };
    delete rawOnly.owners;
    const sink2 = [];
    const r2 = await __enumerate({ apiKey, base }, { ...rawOnly, __countSink: sink2 }, tctx);
    const parsed2 = parseToolText(r2);
    // Only ACCEPT the fallback if it actually got somewhere — a raw sweep that fails too leaves the
    // original (expanded) failure standing, so the reason the reader sees is the real one.
    if (parsed2 && !providerRejectedTheQuery(parsed2.reason)) {
      ownerResolution = {
        ...ownerResolution,
        degraded_to_unresolved_sweep: true,
        degradation_reason: `the provider REJECTED the resolution-expanded APPLICANT_NAME stack (${p.owners.length} names): ${String(parsed.reason ?? "").slice(0, 200)}. `
          + `Resolution is additive-only, so the sweep fell back to the caller's own owner term(s) — ${ownerTermsOf(params).join(", ")}. `
          + `This is the UN-RESOLVED sweep: narrower than the expansion intended, never narrower than what was asked for.`,
      };
      parsed = parsed2;
      r = r2;
      sink.length = 0; for (const s of sink2) sink.push(s);
    }
  }

  if (parsed.state === "incomplete") {
    // The 30000 ceiling is the provider truthfully reporting a CROWD, not a fault. Restate it as a
    // crowd descriptor — and strip the kernel's generic "provider error" framing, because an
    // error-framed reason makes execute-plan stamp error:true and count the slice MISSING.
    const tooMany = /tooManyResults/i.test(String(parsed.reason ?? "")) ? tooManyResultsCount(parsed.reason) : null;
    if (tooMany != null) {
      if (tooMany > 0) parsed.total_hits = tooMany;
      parsed.reason = `the provider returned tooManyResults: ${tooMany || "the band"} records exceed its ${CAPABILITIES.resultCeiling}-result search ceiling, so the complete guid set is unreachable in one call. This is a CROWD descriptor for judgment — dilution the lawyer reads, not a provider fault and not a clean negative. Whether a narrower NAMED band is warranted is judgment's call (Layer B); the funnel does not self-narrow-and-retry.`;
    }
    // Per-office counts from the WHOLE-STACK /count probe — richer than corsearch can offer, and the
    // per-jurisdiction shape of the crowd is exactly what judgment needs to weigh materiality.
    // ONLY when there IS a whole-stack probe: a `names` stack wider than the chunk bound is enumerated
    // window-by-window, so sink[0] is the FIRST WINDOW's counts, not the stack's — and no whole-stack
    // count is computable anyway (the OR-width bound is a parser limit). A mislabelled per-jurisdiction
    // figure is worse than none, so in that case the field is omitted and says why.
    if (chunked) {
      parsed.per_office_counts = null;
      parsed.per_office_counts_unavailable = `the ${p.names.length}-name stack was enumerated in windows of ${namesChunk} (the provider's OR-width bound), so no whole-stack per-office count exists — per-window counts would misreport the jurisdictional shape of this crowd.`;
    } else if (sink.length && sink[0]?.per_office) {
      parsed.per_office_counts = sink[0].per_office;
    }
  }
  if (ownerResolution) parsed.owner_resolution = ownerResolution;
  return { type: "text", text: JSON.stringify(parsed, null, 2) };
}

// ── Execute-plan (phase 5) — the frozen register plan's executor for ONE axis ──────────────────────
//
// The orchestration is the PROVIDER-AGNOSTIC kernel (providers/_shared/execute-plan.mjs): two-pass
// guard evaluation, the qid-ownership MERGE, the error:true stamp and the temp+rename write are
// inherited byte-for-byte from the same code corsearch runs. Only the two seams are Clarivate-shaped,
// and both choices are load-bearing:
//
//   search  → doCount, RESHAPED into the executor's probe shape ({ total_hits, results }). An
//     `expected_kind:"count"` entry IS a saturation crowd by construction — that is why the compiler
//     dictated a count instead of an enumerate. POST /search FAILS LOUD past 30000 (tooManyResults),
//     so routing the count probe through it would return an ERROR string, the executor would stamp the
//     block error:true, and a SANCTIONED CROWD would be counted MISSING — doctrine 5 inverted. POST
//     /count never fails on magnitude (209012 returned without complaint) and carries per-office truth.
//     `countParams` is therefore {}: buildSearchRequest has no `limit` knob to honour, and passing a
//     dead parameter would only imply one exists.
//
//   enumerate → the EXPORTED doEnumerate, never the raw kernel `__enumerate`. The export is what adds
//     the /resolution/company owner resolution and the tooManyResults→crowd reframing. Wiring the raw
//     kernel would run every `owner`-predicate slice WITHOUT applicant resolution — a weaker search
//     wearing the right qid, which is exactly doctrine 2's failure mode.
const __executePlan = makeExecutePlan({
  search: async (auth, params, tctx) => {
    const c = await doCount(auth.apiKey, auth.base, params, tctx);
    if (!c?.ok) return { type: "text", text: `ERROR: clarivate count probe — ${c?.reason ?? "unknown cause"}` };
    // `owner_resolution` is what lets the executor tell a COUNTED zero from an UNVERIFIED one on a
    // bare-owner descriptor: a 0 over an owner whose applicant styling this provider's own owner
    // vocabulary never produced is not a portfolio size (see the count arm in
    // providers/_shared/execute-plan.mjs). JSON.stringify drops the key when there is nothing to say.
    return { type: "text", text: JSON.stringify({
      total_hits: c.total, per_office: c.per_office, owner_resolution: c.owner_resolution ?? undefined, results: [] }) };
  },
  enumerate: (auth, params, tctx) => doEnumerate(auth.apiKey, auth.base, params, tctx),
  countParams: {},
  // the declared contract, for declaration-driven refusals (owner×term) — never for query semantics
  capabilities: CAPABILITIES,
  // regions[] is MANDATORY here (buildSearchRequest throws without it). Several driver lanes mint plan
  // entries with `regions: []` because that is a harmless worldwide sweep on corsearch — the recall
  // probes, the common-law→register cross-check, frame-diff remedies and model-proposed supplementals.
  // Under the raw default builder every one of them hard-errored on this provider and was then
  // relabelled a tool-absence coverage row. Backfill from the FROZEN PLAN's own regions (= the matter's
  // scope, already translated to office codes at compile time); with no plan regions either, the
  // provider still fails loud rather than sweeping something that was never asked for.
  buildEntryQuery: makeRegionRequiredBuildEntryQuery(substituteRomanizedNames),
  // predicateParams → the WILDCARD predicate is Clarivate-shaped, and inheriting the shared default
  // here would silently mis-serve a slice this provider CAN execute.
  //
  // The shared mapping remaps only a CLEANLY anchored pattern (trailing `*` → starts_with, leading `*`
  // → ends_with) and hands everything else — `*NIK*`, `NI*E` — to "the provider default over the raw
  // pattern". On corsearch the default mode eats a `*`. Here it does not: `default` wraps the term as
  // `*term*` with allowWildcard:false, so the embedded metacharacter is REJECTED, /count fails, and
  // the band ships as a `state:"incomplete"` whose reason does NOT match execute-plan's /provider
  // error/i probe — i.e. a serviceable infix slice rendered as a SANCTIONED CROWD with no error stamp
  // and no deferred coverage row. Dilution invented out of a working query: doctrine 2's exact failure.
  // (register-plan.mjs's wildcardCapabilityKey emits `wildcardInfix` as a first-class case, and this
  // provider's contract DECLARES it — so the slice is reachable and supported.)
  //
  // `*` and `?` are native inside the value on this provider, so the honest mapping is: pass the
  // pattern through untouched under match_mode "wildcard". A `wildcard` entry carrying NO metacharacter
  // falls back to the shared behaviour (the contains default) — never to the narrower literal EQUALS
  // that match_mode "wildcard" would produce for a bare term.
  predicateParams: (entry) => {
    if (String(entry?.predicate ?? "") !== "wildcard") return planPredicateParams(entry);
    const terms = Array.isArray(entry?.terms) ? entry.terms : [entry?.term];
    return terms.some((t) => /[*?]/.test(String(t ?? ""))) ? { match_mode: "wildcard" } : {};
  },
});

// ── Count-only (Stage 0.5) ────────────────────────────────────────────────────────────────────────
// The shared kernel's "endpoint" seam over POST /count — the same probe the enumerate ceiling is
// tested with, so a count taken directly and a count taken inside an enumeration cannot disagree.
// Nothing is fetched and nothing is billed as a record call.
//
// A buildSearchRequest refusal (an office outside the 186-code vocabulary, a term carrying parentheses
// or a 2-letter operator word, missing regions[]) arrives here as ok:false with a CAPABILITY_GAP_MARKER reason —
// a DISCLOSED gap, never a zero. driver/register-count.mjs renders it as "not available".
const __countHits = makeCountProbe({
  count: (auth, params, tctx) => doCount(auth.apiKey, auth.base, params, tctx),
  capabilities: { countProbe: CAPABILITIES.kernel.countProbe },
});

/** @returns { ok, total, probe, reason, per_office? } — `total` is a number ONLY when ok. */
export async function doCountHits(apiKey, base, params, tctx) {
  if (!hasAnyElement(params)) return { ok: false, total: null, probe: "endpoint", reason: "at least one search element (query, name, names, owner, owners, representative) is required" };
  return __countHits({ apiKey, base }, params, tctx);
}

/** Same signature shape as every other clarivate entry point: (apiKey, base, params, tctx). */
export async function doExecutePlan(apiKey, base, params, tctx) {
  return __executePlan({ apiKey, base }, params, tctx);
}
