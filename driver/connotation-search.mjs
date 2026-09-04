// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// connotation-search.mjs — the meaning/connotation sweep: its DICTATED queries (driver side) and the
// searched-not-asserted enforcement (validator side). Sister of use-check.mjs (spec 11): a "clean" claim
// is sayable ONLY when a search produced it.
//
// The bug this closes (live incident: a mark reading as a benign given name one letter off the Sureño
// street-gang label): the deterministic grid runs term×platform marketplace cells only — it asks
// "who SELLS this name?", never "what does this name MEAN?". A marketplace grid that finds no listing for
// the mark is SILENT on the street-gang association; only a MEANING search surfaces it. With no machine slot
// for the meaning search, the model fabricated "(None identified — affirmative sweep) … no gang associations".
//
// Two halves, both PURE (no node imports → tests offline):
//   1. buildConnotationQueries — the driver dictates the meaning queries (mark + near-forms × shapes) VERBATIM
//      into grid-spec.json; the perplexity plugin runs them on the general web and records each into the grid
//      ledger's extras.pr_risk[] (a recorded query — even with empty results — is the receipt the search ran).
//   2. findConnotationViolations — the validator: recorded meaning receipts must be disposed of, per query,
//      citing the receipt. A PR/reputational section that ASSERTS a clean result must additionally cite a
//      Connotation-search source line. A searched-clean (recorded queries, empty results) passes.
//
// ARMING (, owner's ruling 2026-08-04 — "arm on data, never on prose"): the disposition join, the
// recurrence floor and the did-the-search-run check all arm on `opts.recorded` being passed, which the
// caller keys on the grid-spec's `connotation.disposition_required` stamp — a structural fact the DRIVER
// writes and no model can redraft away. They used to arm on a phrase match over the model's own prose
// (CLEAN_CLAIM_RE), and that is how the 2026-08-04 R2 run was DELIVERED with 52 recorded receipts and zero
// checked, and the R1 run of the same round with 61: the corrective ladder drove both models into redrafting the
// summary sentence out of the section, and the whole gate went silent. Worse, a document with no PR
// section at all matched no block, so DELETING the section passed the gate. Receipts present now means
// receipts validated, whatever the document says.

// The meaning query shapes. NOT a banned-word list — these are SEARCH directions ("what does this name mean,
// and to whom?"). Perplexity surfaces foreign-language / gang / slang meanings from English query shapes
// (a benign given name one letter off "Sureño" → the gang label surfaces from "<mark> gang" / "<mark> urban dictionary").

export const CONNOTATION_SHAPES = ["meaning slang", "gang", "offensive", "urban dictionary", "wikipedia"];

/**
 * Build the dictated connotation queries from the mark + its near-forms (the grid variants). De-dups
 * case-insensitively and caps the term count (the meaning search is the mark + a handful of near-forms, not
 * the full variant explosion). Returns ["<term> <shape>", …] — run VERBATIM by the plugin's grid program. PURE.
 */
export function pickConnotationTerms(terms, maxTerms = 6) {
  const seen = new Set();
  const picked = [];
  for (const t of (terms ?? [])) {
    const v = String(t ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(v);
    if (picked.length >= maxTerms) break;
  }
  return picked;
}

export function buildConnotationQueries(terms, { shapes = CONNOTATION_SHAPES, maxTerms = 6 } = {}) {
  const picked = pickConnotationTerms(terms, maxTerms);
  const queries = [];
  for (const t of picked) for (const s of shapes) queries.push(`${t} ${s}`);
  return queries;
}

// WP-56 B1 — the NON-ENGLISH half of the meaning sweep. The core bucket runs the mark + its first
// near-forms; the manifest's translated/transliterated forms (non-Latin script rows, "丝绸与铁 / 席尔克"
// packed alternates) sat beyond its cap, so a mark could ship with no meaning read in the very scripts the
// manifest committed to search. These forms get their OWN capped bucket with meaning-appropriate shapes —
// the slang / urban-dictionary shapes are Latin-web search directions; a non-Latin or translated form
// wants its meaning and English reading. Which forms exist stays the variants stage's judgment (the
// structured manifest); this stays mechanical.
export const CONNOTATION_SHAPES_TRANSLIT = ["meaning", "meaning in english", "offensive meaning"];

// A letter outside the Latin script (property escape, not a codepoint range — punctuation/dashes in a
// Latin term must not read as "non-Latin").
const NON_LATIN_LETTER_RE = /(?![\p{Script=Latin}])\p{L}/u;

/**
 * Build the translit/translation connotation queries from the STRUCTURED variant-manifest model's
 * variants[] ({value, category, rationale}): rows typed category "transliteration" (a Latin-script
 * translation typed there rides along) plus any variant value carrying a non-Latin letter, whatever its
 * category. " / "-packed alternates split into individual forms; forms the core bucket already queries
 * (coreTerms, case-insensitive) are dropped; own cap (default 8, beside the core bucket's 6).
 * Returns ["<form> <shape>", …] like buildConnotationQueries. PURE.
 */
export function buildTranslitConnotationQueries(modelVariants, { shapes = CONNOTATION_SHAPES_TRANSLIT, maxTerms = 8, coreTerms = [] } = {}) {
  const seen = new Set((coreTerms ?? []).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean));
  const picked = [];
  for (const v of (modelVariants ?? [])) {
    const value = String(v?.value ?? "").trim();
    if (!value) continue;
    const isTranslit = String(v?.category ?? "").trim().toLowerCase() === "transliteration" || NON_LATIN_LETTER_RE.test(value);
    if (!isTranslit) continue;
    for (const form of value.split(" / ")) {
      const f = form.trim();
      if (!f) continue;
      const k = f.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(f);
      if (picked.length >= maxTerms) break;
    }
    if (picked.length >= maxTerms) break;
  }
  const queries = [];
  for (const t of picked) for (const s of shapes) queries.push(`${t} ${s}`);
  return queries;
}

// ── P2-C (Round-2 §8b) — the DERIVED half of the sweep's scope ─────────────────────────────────────────
// The fixed CONNOTATION_SHAPES floor asks generic search DIRECTIONS ("<mark> offensive") and stays — it is
// not a sensitivities checklist, and on the evidence run it did retrieve the cultural-criticism material.
// What no fixed list can ask is the PER-MATTER angle: the cultural origin a word evokes, the charged history
// of its imagery, the controversy specific to these goods in this market. Deriving those is judgment, so the
// MATTER FRAME authors them — its dictated `Meaning angles:` line (semantic field × market/industry; the
// stage message dictates it and the matterContext validator requires it on fresh runs, `none` allowed as an
// explicit reasoned emptiness). This parser is the mechanical half: extract, sanitize, cap. The queries are
// appended VERBATIM to grid-spec connotation.queries BESIDE the floor, so the per-query identity join
// (findDroppedConnotationQueries) polices their execution exactly like the floor's. NEVER a hardcoded
// sensitivities checklist — the angles are authored per matter; code only carries them.

// The frame's machine line (mirrors channelsFromMatterContext's "Search channels:" shape), ANCHORED to a
// line start: prose that merely MENTIONS `"Meaning angles:" line …` must never read as the line (the
// evidence-run fixture proved the un-anchored form does exactly that). Shared with the matterContext
// validator so "required on fresh runs" and "parsed here" can never drift apart.
export const MEANING_ANGLES_RE = /^[ \t]*(?:[-*]\s+)?meaning angles\s*[:—-]\s*([^\n]+)$/im;

// — WRAPPING quotes only, and the reason is a 26-minute death.
//
// The old sanitizer stripped quote RUNS anchored at each end independently:
//   part.trim().replace(/^["'`]+|["'`.]+$/g, "")
// A leading quote that OPENS AN INNER PHRASE is not a wrapper, and there is no trailing quote to remove
// with it. R1 PROJECT SABLE's frame authored a correct angle — the shape stages.mjs asks for — and the
// driver dictated a broken one:
//   IN   "Project Sable" video game controversy
//   OUT   Project Sable" video game controversy      ← one quote, unbalanced
// The meaning seat searched it and recorded the receipt under the query with the stray quote repaired, so
// the per-query identity join (findDroppedConnotationQueries) saw a dictated query with no receipt and no
// gap row. Verified on E2E's preserved R1 run of 2026-08-13 (test build 4353a74): 61 dictated, 61 receipts, 0 gaps, one
// dictated query unrecorded and one recorded query never dictated — the same angle, minus the quote. The
// merge threw `deterministic`, the ladder correctly refused to retry, and the run died at common-law after
// 26m15s with nothing delivered and the whole gather already paid for. 's class, inverted: the driver
// corrupted a well-formed model output.
//
// THE RULE: peel an outer pair only when both ends carry the SAME quote character AND the interior carries
// no further occurrence of it. `"a" b "c"` therefore keeps its quotes — its leading quote is not a wrapper
// either, and a rule that asked only "is a matching trailing quote present?" would strip that pair too:
// balanced, and still the wrong string. A peel can only ever remove a MATCHED pair, so this can never
// change an entry's quote parity — that is the property, and it is stronger than counting quotes on the
// way out. Nesting (`"\`x\`"`) peels layer by layer; trailing sentence punctuation is a separate strip and
// runs on each layer, so `"angle."` still yields `angle`.
const ANGLE_QUOTE_CHARS = ["\"", "'", "`"];
function sanitizeMeaningAngle(raw) {
  let s = String(raw ?? "").trim().replace(/\s+/g, " ");
  for (let layer = 0; layer <= ANGLE_QUOTE_CHARS.length; layer++) {
    s = s.replace(/[.\s]+$/, "");
    if (s.length < 2) break;
    const open = s[0];
    if (!ANGLE_QUOTE_CHARS.includes(open) || s[s.length - 1] !== open) break;
    const inner = s.slice(1, -1).trim();
    if (inner.includes(open)) break;             // the leading quote OPENS a phrase — it is not a wrapper
    s = inner;
  }
  return s.trim();
}

/**
 * Parse the matter frame's `Meaning angles: <q>; <q>; …` line into sanitized derived queries.
 * Semicolon-separated (an angle phrase may contain commas); `none` (the explicit reasoned-emptiness form)
 * and a missing line both yield [] — the floor always rides regardless. Sanitization is mechanical only:
 * strip WRAPPING quotes/backticks (see sanitizeMeaningAngle — a phrase quote inside the angle survives),
 * collapse whitespace, drop empties and over-length entries, dedupe
 * case-insensitively (against itself and `alreadyQueried`, so a derived angle never double-dictates a floor
 * query), cap the count. Content judgment stays the frame's. PURE.
 */
export function meaningAnglesFromMatterContext(md, { alreadyQueried = [], maxAngles = 8, maxLen = 90 } = {}) {
  const m = String(md || "").match(MEANING_ANGLES_RE);
  if (!m) return [];
  const value = m[1].trim();
  if (/^none\b/i.test(value)) return [];
  const seen = new Set((alreadyQueried ?? []).map((q) => String(q ?? "").trim().toLowerCase()).filter(Boolean));
  const picked = [];
  for (const part of value.split(";")) {
    const q = sanitizeMeaningAngle(part);
    // An entry with no letter or digit left is not an angle — it is punctuation. The old strip deleted
    // quote runs at both ends unconditionally, so `"` sanitized to "" and fell out here; the wrapper rule
    // keeps it, and a lone `"` dictated as a query is a search nobody asked for that no receipt can ever
    // match — the failure this change exists to stop. Dropped explicitly rather than as a side effect.
    if (!q || !/[\p{L}\p{N}]/u.test(q) || q.length > maxLen) continue;
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(q);
    if (picked.length >= maxAngles) break;
  }
  return picked;
}

// The PR / reputational / connotation section heading (the only place the gate polices — it must not flag a
// clean note that appears in some other section's prose, mirroring use-check's section-scoping).
const SECTION_RE = /reputational|connotation/i;

// — CLEAN_CLAIM_RE and SOURCE_RE are DELETED. Both still ran and both were already inert where it
// counted: moved every load-bearing arm onto the receipts ("arm on data, never on prose"), leaving
// CLEAN_CLAIM_RE gating only `no_source_cite` — an ADVISORY that is filtered out before any failure token
// is built (verify.mjs) and therefore never reached a model, a ladder or a verdict. Keeping a phrase
// matcher that decides nothing is how the next reader concludes the gate reads prose. It does not.
//
// One reachable behaviour goes with them, stated rather than discovered later: UNARMED (`recorded` null —
// a pre-P2-C archived spec), `no_recorded_queries` used to fire from a section that ASSERTED a clean read
// over zero recorded queries. Armed, that reason fires on the structural fact and is untouched. Measured
// against the corpus before deleting: no archived run in it carries that verdict, so nothing flips.

// ── P2-C (Round-2 §8b, leg 2) — the receipts-disposition arm ───────────────────────────────────────────────
// The evidence run proved the count gate alone is not enough: the meaning sweep RETRIEVED the cultural-
// criticism material (recorded receipts with URLs, five separate queries) and the reader still wrote a clean
// bottom line — retrieved-but-unread. Scope derivation (leg 1) widens what is asked; THIS arm makes what came
// back un-skippable: a clean-asserting PR section must dispose of every recorded query that returned results,
// per query, citing a recorded result (title or URL) — a query LIST is not a disposition (the evidence run
// listed all its queries and still reported clean past the receipts).

/**
 * Parse a grid ledger's recorded meaning-sweep receipts: extras.pr_risk[] across batches, projected to
 * exactly what the disposition join reads — [{query, results:[{title,url}]}]. Duplicate query strings
 * (defensive; the split partition is disjoint by construction) merge their results. The COUNT parser stays
 * in common-law-receipts.mjs (parsePrRiskQueries); this entries parser lives here so the P2-A-owned file is
 * untouched. Never throws; an unparseable ledger reads as no recorded entries. PURE.
 */
export function parsePrRiskResults(ledgerRaw) {
  let parsed;
  try { parsed = JSON.parse(ledgerRaw); } catch { return []; }
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  const byQuery = new Map();
  for (const b of batches) {
    const pr = b?.extras?.pr_risk;
    if (!Array.isArray(pr)) continue;
    for (const e of pr) {
      if (!e || typeof e.query !== "string" || !e.query.trim()) continue;
      const q = e.query.trim();
      // — the SNIPPET rides through. It is the only fetched text in the dataplane, so it is the only
      // thing a proof-of-reading spot-check can join against; before this the projection discarded it and
      // the capture never emitted one. Never part of the identity (receiptKey below is url-first,
      // title-fallback and unchanged) — a snippet that changes between two runs must not move a receipt id.
      // Absent on every archived ledger, which is exactly why no archived row is ever quote-required.
      const results = Array.isArray(e.results)
        ? e.results.map((r) => ({ title: String(r?.title ?? "").trim(), url: String(r?.url ?? "").trim(),
            snippet: String(r?.snippet ?? "").trim() }))
            .filter((r) => r.title || r.url)
        : [];
      if (byQuery.has(q)) byQuery.get(q).results.push(...results);
      else byQuery.set(q, { query: q, results });
    }
  }
  return [...byQuery.values()];
}

// Typographic punctuation folded to its ASCII counterpart before any citation compare. A receipt title
// arrives from the web with curly quotes and en-dashes; a model transcribing it into a markdown table
// types the ASCII forms. Without this fold the two never join, and the join is REJECTING A DISPOSITION THE
// MODEL WROTE CORRECTLY — on the 2026-08-04 VENZY run, `How ‘bad blood’ may have provoked Chicago’s first
// murder` (56 chars, far past every length bound) failed at character 5 against a doc line carrying the
// same headline with straight quotes. That is the loaded receipt the recurrence floor exists to force onto
// the page, discarded over an apostrophe. Folding weakens nothing: it makes the compare do what its own
// contract says — "the model quoted a title it could only have got by opening the receipt".
const foldPunct = (s) => s
  .replace(/[‘’‚‛]/g, "'")      // ‘ ’ ‚ ‛
  .replace(/[“”„‟]/g, '"')      // “ ” „ ‟
  .replace(/[‐-―−]/g, "-")           // ‐ ‑ ‒ – — ― and the minus sign
  .replace(/…/g, "...");                       // …
// EXPORTED for disposition-union.mjs and for nothing else. The union keys a query row on
// normText(query) and a recurrence row on normId(receipt_id) — the SAME normalisers this gate compares
// with, imported rather than re-written, because a union that preserves a ruling the gate would refuse
// (or drops one it would accept) is a silent disagreement between two copies of one rule. The import runs
// one way only: disposition-union.mjs reads this module, never the reverse.
export const normText = (s) => foldPunct(String(s ?? "").toLowerCase()).replace(/\s+/g, " ").trim();

// (2026-08-04, the terminal R2 run of that round) — LANGUAGE EDITIONS OF ONE DOCUMENT ARE ONE RECEIPT.
// The recurrence floor demanded the model cite the SAME dictionary lemma twice, under two language editions.
// Attempts 2, 6 and 8 died on https://fr.wiktionary.org/wiki/δελφίς; the model then cited it verbatim; attempt
// 9 died on https://en.wiktionary.org/wiki/δελφίς and the run went terminal — ~37 minutes of model work, no
// artifact. Both editions cleared the floor independently (en 8 owning queries, fr 5, floor 4) and their
// titles diverge before TITLE_PREFIX ("Wiktionary, the free dictionary" / "Wiktionnaire, le dictionnaire
// libre"), so citing one PROVABLY could not satisfy the other and no attempt could have converged.
// Folding the leading language-edition host label weakens the compare's contract not at all: the contract is
// "the model quoted something it could only have got by opening the receipt", and fr.wiktionary.org/wiki/δελφίς
// proves exactly that for en.wiktionary.org/wiki/δελφίς. BOUNDED two ways — only a leading 2-3 letter (or
// xx-yy) label, and only when a PATH follows, because folding a BARE host would let any URL on the domain
// satisfy a demand for one specific page. Measured on the evidence receipts: 274 distinct results → 266,
// and the load-bearing-by-recurrence set is the same 7, only re-keyed.
const LANG_HOST_LABEL_RE = /^(?:[a-z]{2,3}|[a-z]{2,3}-[a-z0-9]{2,4}|simple)\.(?=[^/]+\/)/;
const normUrl = (s) => String(s ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")
  .replace(LANG_HOST_LABEL_RE, "").replace(/\/+$/, "").trim();

// ── — A RECEIPT GETS AN IDENTITY, SO CITING ONE STOPS BEING A TRANSCRIPTION TASK ─────────────────
//
// Until this, the ONLY way to dispose of a recorded receipt was to retype its title or URL into prose
// that the join below substring-matched back out. The engine handed a model structured data, asked it to
// hand-transcribe the identifiers, and then string-matched them back — so the one part that could go
// wrong was the part we made the model do. Measured on the preserved 2026-08-06 evidence: of 14 refusals
// across the two halves, TEN were a correct ruling refused over the shape of its citation (6 + 2 titles
// present verbatim but under TITLE_MIN, 2 present only after folding curly quotes). Three clearances went
// terminal on this stage across the preceding rounds with no report at all.
//
//, and each made the transcription EASIER. None made it unnecessary, which is why
// each helped and none closed it. This does: the receipt carries an id, and the seat cites the id.
//
// THE ID IS DERIVED, NEVER STORED. It is a hash of the SAME identity key connotationObligations already
// dedups on (`normUrl(url)`, title fallback) — so the side that TELLS the seat its obligations and the
// side that JUDGES them cannot drift, for exactly the / reason: one calculation, not two kept in
// step. Nothing new is written to the ledger, no migration exists, and re-reading any ledger — a half's,
// the merged one, an archived one — re-derives the same ids from the same bytes.
//
// 40 bits over the ~274 distinct results a real sweep records puts a collision at ~3e-8. It is not
// engineered around, deliberately: a collision would surface as an id the gate cannot bind, which is
// LOUD (the run fails naming the id) rather than a silent mis-binding. Crockford's alphabet drops I/L/O/U
// so a transcribed id cannot be corrupted by the one confusion an 8-character token is exposed to.
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const FNV64_OFFSET = 0xcbf29ce484222325n, FNV64_PRIME = 0x100000001b3n, MASK64 = 0xffffffffffffffffn;
export function fnv1a64(s) {
  let h = FNV64_OFFSET;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * FNV64_PRIME) & MASK64; }
  return h;
}

/**
 * `<prefix>-` + 8 Crockford-base32 chars over 40 bits of `key`. receiptId's own body, lifted so the
 * disposition form's row ids are minted by the SAME hash rather than a second one that could drift.
 * PURE; never throws.
 */
export function shortId(prefix, key) {
  if (!key) return "";
  let h = fnv1a64(key);
  let out = "";
  for (let i = 0; i < 8; i++) { out = B32[Number(h & 31n)] + out; h >>= 5n; }
  return `${prefix}-${out}`;
}

/** The identity of a recorded result — url-first, title fallback, "" when it has neither. PURE. */
export function receiptKey(r) {
  return normUrl(r?.url) || (normText(r?.title) ? `t:${normText(r?.title)}` : "");
}

/**
 * The stable citable id of a recorded result: `R-` + 8 Crockford-base32 chars over 40 bits of its
 * identity key. "" for a result with no identity (neither url nor title) — such a result is not an
 * obligation either, so nothing ever asks for its id. PURE; never throws.
 */
export function receiptId(r) {
  return shortId("R", typeof r === "string" ? r : receiptKey(r));
}

/**
 * Normalized form an id is compared in — case- and dash-insensitive, so a re-cased copy still binds.
 * EXPORTED for disposition-union.mjs: the union keys recurrence rows on this, and it must be the
 * same function the gate binds with.
 */
export const normId = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// ── — THE PROSE JOIN IS GONE, AND WITH IT THE TRANSCRIPTION IT POLICED ─────────────────────────
//
// Four module-private functions used to live here — lineCitesResult, lineDisposes, classifyUndisposed
// and lineNamesResultUrl — plus the TITLE_MIN (12) / TITLE_PREFIX (24) bounds they compared against.
// Every one of them string-matched a MODEL-WRITTEN markdown line against TOOL-WRITTEN grid data, which
// is the defect: the engine held the exact identifiers, asked a model to retype them, and then matched
// them back out, so the one part that could go wrong was the part the model was made to do.
//
// The bounds were not wrong for what they did. TITLE_MIN refused the accident of a result titled "slush"
// being "cited" by the bare row "- CORAL FREEZE meaning slang"; TITLE_PREFIX let a long title bind without
// byte-perfect transcription; classifyUndisposed existed so the corrective hint could name a remedy
// instead of telling a model that HAD ruled the row to go and rule it. They are deleted because the thing
// they measured no longer happens: the driver writes the form, the seat sets `ruling` and `note`, and
// nothing is retyped. `cite_too_short` cannot occur when nothing is copied, and there is no line to
// classify when there is no line.
//
// What replaces the proof they carried is in §4 of docs/design/meaning-sweep-form.md and below: a
// deterministic spot-check of a few rows against the snippet the TOOL fetched. Three quote joins against
// fetched text prove more than 62 rows of perfect retyping, because retyping proves typing.

// ── — WHAT COUNTS AS A RULING, IN CODE, ON A CLOSED ENUM ───────────────────────────────────────
// The vocabulary was dictated in prose in three places and validated nowhere: `structuredQuery` accepted
// any truthy string, so "TBD" was a ruling. It is a closed set here, checked once, and it is the same set
// the union preserves and the form's own header names.
export const RULINGS = Object.freeze(["benign", "off-topic", "loaded", "inconclusive"]);
// ── — THE FOURTH RULING, AND WHY IT IS A RULING RATHER THAN A FLAG ─────────────────────────────
// `loaded` carried two different answers. "This reading is charged" and "I could not establish whether
// it is charged" were the same token, because doctrine folded the second into the first to keep it
// raising a Finding — which is right, and cost the report the ability to tell them apart. The ruling IS
// the contract selector, so the split belongs here and not on a boolean beside it: a row's ruling is
// what every downstream reader keys on, and a flag on a value that already means something else is a
// second vocabulary nobody parses. Named for what the seat did — the receipt did not settle it.
//
// BOTH still raise a Finding. An unresolved reputational question belongs on the page exactly as much
// as a settled one; this changes what the reader is told, never what reaches them.
export const DECLINED_RULING = "inconclusive";
/**
 * The same vocabulary as English prose, composed from the set — never a sentence typed out beside it,
 * which is how this vocabulary came to exist in three places. The corrective hint reads as a
 * sentence, not a list, and hardcoding that sentence is how this set came to exist in three places. A
 * fourth ruling renders "a, b, c or d" instead of silently dropping out of the hint — added one
 * and this function needed no edit, which is the property. PURE.
 */
export const rulingsProse = () => (RULINGS.length < 2 ? (RULINGS[0] ?? "")
  : `${RULINGS.slice(0, -1).join(", ")} or ${RULINGS[RULINGS.length - 1]}`);
const RULING_SET = new Set(RULINGS);

// The spot-check's bar. A quote must be long enough that it could not be typed by accident from the query
// or the title — 24 normalized characters, the same bound TITLE_PREFIX used and for the same reason
// ("you cannot copy a prefix you never read"), now applied to text the TOOL fetched rather than to a
// title the model had to retype. A snippet shorter than this cannot make a row quote-required.
const QUOTE_MIN = 24;

// ── M2 — THE BAR IS INFORMATION, NOT CHARACTERS ────────────────────────────────────────────────
//
// The reason above is the whole design, and it is not a character count: a quote must be long enough
// that it could not have been produced without reading the snippet. 24 Latin characters buy that. 24
// HANZI buy several times as much, because a Chinese character carries a morpheme where a Latin
// character carries a letter — so this constant asked the CJK lane for a passage far longer than the
// rule requires, and a 克罗玛 row failed on exactly that.
//
// IT CUT BOTH WAYS, which is why both sites move together or neither does. The same constant decides
// `usableSnippet` — which rows are ELIGIBLE to be quote-required at all — so a CJK snippet under 24
// characters, often a complete sentence, was judged too short to spot-check against and dropped out of
// eligibility without a word. Fixing the satisfaction bar alone would have left that half standing and
// looked like a fix.
//
// THREE is the ratio the existing rule already implies rather than a tuning knob: a CJK codepoint is
// worth about three Latin characters of unguessability, which puts the CJK bar near eight characters —
// a real phrase, and still impossible to produce without having read it.
const DENSE_WEIGHT = 3;

// Han, kana, Hangul and the CJK compatibility/extension blocks, which carry the same density.
// Deliberately NOT "anything non-Latin": Cyrillic and Greek are alphabetic, roughly one character per
// sound, and weighting them would let a short fragment clear a bar it should not.
// Includes the ASTRAL extension blocks (U+20000+). Leaving them out weighs an Extension-B
// ideograph as one Latin character — the exact under-count this change removes, on the rarest and
// least-tested characters in the lane. The `u` flag is what lets the astral range parse at all.
const DENSE_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]|[\u{20000}-\u{2FA1F}]/u;

/**
 * How much UNGUESSABILITY a fragment carries, in Latin-character equivalents.
 *
 * THE ONE MEASURE. `usableSnippet` (eligibility) and the quote/anchor minimum (satisfaction) both read
 * it, because two opposite biases out of one constant have to die together.
 *
 * Iterates CODE POINTS, not code units: `for…of` yields whole characters, so an astral-plane ideograph
 * counts once rather than twice. That is the same trap `quoteBinding`'s edge comparison documents one
 * function along, and it bites hardest on the lane this whole change is about.
 * PURE.
 */
export function quoteWeight(s) {
  let w = 0;
  for (const ch of normText(s)) w += DENSE_RE.test(ch) ? DENSE_WEIGHT : 1;
  return w;
}

/**
 * — WHICH passages of a snippet can ever satisfy `FRAGMENT_MIN`, 1-based.
 *
 * Derived HERE, beside the bar it tests, and against `quoteWeight` — the same function `segmentBinding`
 * uses. A caller computing this for itself with `.length` would drop satisfiable CJK passages and mint
 * the per-script partition removed; a caller with its own threshold would drift from the gate. One
 * function, one bar, one home. PURE.
 */
export function livePassages(snippet) {
  return snippetSegments(snippet)
    .map((seg, i) => (quoteWeight(seg) >= FRAGMENT_MIN ? i + 1 : 0))
    .filter(Boolean);
}

/** Is this captured snippet substantial enough to spot-check against? PURE. */
export function usableSnippet(s) { return quoteWeight(s) >= QUOTE_MIN; }

// ── — WHY A QUOTE DID NOT BIND, NOT MERELY THAT IT DID NOT ──────────────────────────────────────
// `quoteJoins` is a predicate and stays one: its answer is the gate's, and 's comment thread withdrew
// loosening it. What was missing is the REASON, and the reason is the whole.
//
// R6 (Full country search into China) died after four dispatches, byte-identical, on
// `connotation_no_ruling:no_ruling=1;Q-1F4YWF87 [冰冻浆果 meaning]`. That row WAS ruled — ruling `benign`,
// a note, a receipt_id in its own candidate list. Only the quote clause failed, because the seat had
// quoted two adjacent numbered definitions of a Taiwanese dictionary entry and dropped the ` 2. ` between
// them. Both halves verbatim; the concatenation not. The hint said "ensure EVERY row carries a ruling",
// the seat looked, saw a ruling, correctly changed nothing, and the ladder closed by construction.
//
// THE FATAL SUB-CASE IS THE ONE WHERE THE SEAT IS RIGHT. A retry can only escape a state the seat
// believes is wrong. R1's Cyrillic row failed the same clause for the opposite reason — a gloss appearing
// in NO candidate at all — and recovered on a fresh attempt, because there the seat had something to
// change. Same clause, opposite outcomes, one message that fit neither.
//
// So this classifies rather than loosens. Nothing that did not bind before binds now: `quoteJoins` is
// literally `quoteBinding(...).state === "bound"`. `quote_required` still means "copy this out of the
// snippet by hand, verbatim", and R1's fabricated quote is still refused — it just gets told what it did.
const QUOTE_EDGE = 12;

/**
 * WHY the seat's quote does or does not join against text the tool fetched for one of THIS row's
 * candidates. The states, and each has a different remedy — which is the point:
 *
 *   `bound`     — a candidate snippet contains the quote as one contiguous run. The gate accepts.
 *   `split`     — the quote's leading AND trailing edge both appear in ONE candidate's snippet, and the
 *                 whole quote does not. The seat transcribed real text across a boundary the snippet has
 *                 and the quote does not. Remedy: quote ONE continuous passage. R6's row.
 *   `absent`    — no candidate snippet contains either edge. The quote is not in the evidence. Remedy:
 *                 quote from a snippet that is. R1's row, and the paraphrase `quote_required` exists to
 *                 stop.
 *   `too_short` — under QUOTE_MIN normalized characters. Remedy: quote more of it.
 *   `missing`   — no quote at all.
 *
 * `receipt_id` is the candidate the near miss was found against, so the hint can name it. Null unless the
 * state is `bound` or `split` — on `absent` there is no nearest candidate to name, and inventing one
 * would send the seat to a receipt its text was never in.
 *
 * EDGES, NOT FRAGMENTS. This does not attempt to reconstruct how many pieces the quote is in: the answer
 * only has to be actionable, and "your first and last words are both in receipt R-… and the middle is
 * not" is the sentence that fixes R6 in one attempt. A fragment-counting join would be the loosening that
 * was withdrawn, wearing a diagnostic hat. PURE; never throws.
 *
 * @param {string} quote        the seat's quote
 * @param {Array}  candidates   the CANONICAL row's candidates (driver-written)
 * @returns {{state:"bound"|"split"|"absent"|"too_short"|"missing", receipt_id:string|null}}
 */
export function quoteBinding(quote, candidates) {
  const q = normText(quote);
  if (!q) return { state: "missing", receipt_id: null };
  // M2 — WEIGHT, NOT LENGTH. `.length` here is the satisfaction half of the same constant that
  // decides eligibility in `usableSnippet`; both now read quoteWeight, so the CJK lane is not asked for
  // four times the unguessability the rule wants and is not dropped from eligibility for the same reason.
  if (quoteWeight(q) < QUOTE_MIN) return { state: "too_short", receipt_id: null };
  const usable = (candidates ?? []).filter((c) => usableSnippet(c?.snippet));
  for (const c of usable) {
    if (normText(c.snippet).includes(q)) return { state: "bound", receipt_id: c?.receipt_id ?? null };
  }
  // The edges are taken from the NORMALIZED quote so they are compared on the same footing as the
  // snippet — CJK has no inter-word spaces, so a character count is the only edge available and it is
  // the right one: it is exactly what made this invisible to a reader in the first place.
  //
  // CODE POINTS, NOT CODE UNITS. `slice` cuts UTF-16, so on a surrogate pair it hands `includes` half a
  // character, the edge never matches, and a `split` reports as `absent` — the seat is then told its
  // verbatim text is in none of its receipts and has no way to act. It can only corrupt a message, never
  // a verdict, so it would never surface as an error; and it would surface on the non-Latin lane, which
  // is the lane this whole issue is about.
  const cp = Array.from(q);
  const head = cp.slice(0, QUOTE_EDGE).join(""), tail = cp.slice(-QUOTE_EDGE).join("");
  for (const c of usable) {
    const s = normText(c.snippet);
    // Ordered, and not merely both-present: a snippet holding the tail before the head is not this row's
    // passage split in two, and calling it `split` would tell the seat to look for something continuous
    // that was never there.
    const h = s.indexOf(head);
    if (h >= 0 && s.indexOf(tail, h + head.length) >= 0) return { state: "split", receipt_id: c?.receipt_id ?? null };
  }
  return { state: "absent", receipt_id: null };
}

/**
 * Does the seat's `quote` join against text the tool actually fetched for one of THIS row's candidates?
 * Any candidate of the row, not only the one the seat ruled on: the check proves the seat read the
 * receipts of the row it ruled, and pinning it to the chosen candidate would refuse a sound ruling
 * whenever the seat chose a candidate the capture returned no snippet for — the exact
 * correct-ruling-refused-over-its-citation shape this whole build exists to end.
 *
 * ONE definition, shared with quoteBinding above, because the gate and the message that explains the gate
 * disagreeing is the entire defect reported. PURE.
 */
export function quoteJoins(quote, candidates) {
  return quoteBinding(quote, candidates).state === "bound";
}

// ── THE ANCHOR DIRECTIVE — ONE SENTENCE, BOTH COMPOSERS ─────────────────────────────────────────────
// Served verbatim by the two sites that brief the meaning seat. It lived in both as near-duplicates and
// they had already drifted apart in wording; a fix applied to one of two composers is the defect class
// this whole week has been about, so there is now one of it.
//
// WHY THE VERB CHANGED. The brief gives the seat four fields. Three were imperatives — "set
// `receipt_index`", "`ruling` to", "`note` to one line" — and were written on 74 of 74 rows. The fourth
// read "a row marked `quote_required` also WANTS `anchor`": the only one phrased as a property of the
// row rather than an instruction to the seat, the only one that never said what happens if it is
// skipped, and the only one written ZERO times — 0 of 9 attempt-1 anchors across every run e2e could
// reach, in every case written promptly the moment a failure message demanded it.
//
// That correlation is the whole hypothesis and it is NOT proof: this text changes three things at once
// (verb form, addressing the flag the seat can see in its own form, and a consequence sentence that is
// entirely new information), so a pass will not say which one worked. Recorded here rather than left
// for a reader to assume the active ingredient was isolated. e2e's guess is the consequence sentence;
// mine is the verb form.
//
// THE CONSEQUENCE SENTENCE IS TRUE, AND DELIBERATELY NOT STRONGER. `isRuled` refuses a `quote_required`
// row whose spot-check does not bind (:647), so the stage fails while any remain. The stronger form —
// "you MUST write an anchor or the row fails" — would be FALSE, because `spotCheckBinds` also accepts a
// seat-typed `quote` that binds, the route archived and replay forms travel. A live seat filling a
// fresh form has no such quote; the slot is the driver's to fill from the anchor. So this is true for
// its audience, and a composer that ships a falsehood if this arm passes is not a trade worth making.
// — THE ORDER IS TWO FIELDS NOW, AND THE OLD ONE IS DELETED RATHER THAN LEFT BESIDE IT.
//
// A dictation is a code path: leaving the anchor sentence here "for compatibility" would keep a seat
// choosing between an order that works and one that cannot, which is the flag disease in prose. The
// PARSER for archived anchors stays (`anchorBinding`) — reading history is not ordering a shape.
//
// The wording separates the two duties on purpose, because a seat that reads them as one will produce a
// long fragment and re-create the failure: the NUMBER says which passage, the CHARACTERS show it was
// read. Nothing here asks for anything to be reproduced, translated, or joined up.
const POINT_DIRECTIVE = [
  "On every row the tool's answer marks as owing one, give `segment_index` — the NUMBER of the passage",
  "you relied on, from the numbered passages of the receipt you ruled on.",
  "And copy `fragment` — a few characters taken EXACTLY out of that same passage, in whatever script it",
  "is written in.",
  "The number says WHICH passage; the characters show you read it. The driver copies the passage into the",
  "record for you, so never reproduce it, never translate it, and never join two passages together.",
  "If the passage is not in your language, copy its characters as they are written — a translation or a",
  "paraphrase is not a copy and will not be accepted.",
  "A row owing these whose fragment does not appear in the passage it names is not counted as ruled, and",
  "this stage fails while any remain.",
];

// The anchor's own bar. SHORT ON PURPOSE — this is the piece a model must reproduce exactly, and every
// character it has to carry is a character it can get wrong. It only has to be long enough to LOCATE a
// passage, not to prove the passage was read; the extracted run does the proving, and code extracts it.
//
// ⛔ RETAINED FOR THE ARCHIVED-FORM PARSER ONLY. No live dictation asks for an `anchor` any more — see
// SEGMENT POINTING below. `anchorBinding` still runs, because archived and replayed forms carry
// anchors and quotes and re-reading history is not the same as ordering a shape.
const ANCHOR_MIN = 8;

// ── — SEGMENT POINTING: THE LOCATOR AND THE PROOF ARE TWO FIELDS, AND MUST STAY TWO ───────────
//
// THE DISEASE, and this file states it twice in contradictory terms twelve lines apart. The comment above
// says the anchor "only has to be long enough to LOCATE a passage, not to prove the passage was read".
// `anchorBinding`'s own doc says the opposite: "a seat that cannot point at eight characters of a snippet
// it was handed did not read it, and that is exactly what the spot-check is for." **Both were true, and
// that is the defect** — ONE string was doing two jobs with incompatible requirements:
//
//   · as a LOCATOR it had to be long and unique enough to pin an extraction span by exact match;
//   · as a PROOF it only had to be short and genuinely copied.
//
// The locator duty is what made it unsatisfiable. Measured over the retained corpus: 33 of 34 CJK-bearing
// runs carry `quote_unbound` against 0 of 47 Latin-only. On R5 round `892dd88e` a seat supplied English
// paraphrases of Japanese source text — 157 of 168 anchors contained no CJK at all — and walked
// `receipt_index` through all 8 candidates looking for one its anchor would bind against. Only 2–3 of the
// 8 were Latin-only, so THE WALK WAS UNWINNABLE BY CONSTRUCTION. 163 calls, 2 rows, and every refusal
// correct.
//
// SO THE TWO DUTIES ARE SPLIT, and the split is the thing a later editor must not undo:
//
//   LOCATOR = `segment_index`, a 1-based position into the driver's own numbered segments of the ruled
//             candidate's snippet. Machine-checked for range. NEVER UNSATISFIABLE — an integer in range
//             always exists. This is  M1's rule applied one level down: where a model must name one
//             of a set the driver already holds, it returns the position and code resolves it.
//
//   PROOF   = `fragment`, a few characters copied from INSIDE the chosen segment, checked by CONTAINMENT
//             ONLY and never used to locate or extract anything. Cheap to produce given the text,
//             expensive given only the metadata — which is the whole criterion for a read-proof, and it
//             does not require the driver to be ignorant of the answer. An examiner knowing the answer is
//             how examining works.
//
// WHY NOT DROP THE PROOF AND KEEP ONLY THE ORDINAL. Because an ordinal is guessable: 1-of-N, and the
// driver cannot check WHICH segment is right — relevance is the seat's judgment, not code's — so any
// in-range integer would pass and the read-proof would be gone entirely, not merely weakened. On the
// synthetic sample corpus 33 of 251 snippets segment to exactly one, where the pick proves nothing at all.
// "A ruling is backed by evidence the seat read the receipt" is part of what a delivered report claims,
// so retiring it is a product downgrade and not this change's to make.
//
// WHY NOT OFFER QUOTE-OR-POINT AS TWO ROUTES. A seat that may choose will point always, which drains the
// proof out of the Latin population where transcription is free today; and two routes need a
// satisfiability partition, which is `quoteWeight`'s disease returning in a new coat. ONE ordered shape,
// uniform across scripts, no threshold deciding which seats get which obligation.
//
// AND NOTE WHERE `quoteWeight` LANDS NOW. It weights a CJK codepoint at three Latin characters as a
// measure of UNGUESSABILITY, which is correct — and is exactly the right unit for a proof-of-reading bar.
// The bug was reusing an unguessability measure to decide TRANSCRIBABILITY. Same function, right question.
const FRAGMENT_MIN = 6;

/**
 * The driver's numbered segments of one snippet — the list the seat points into.
 *
 * Split on sentence terminators in BOTH script families plus hard line breaks. CJK is not
 * space-delimited, so a whitespace or word-count segmentation would return one giant segment for exactly
 * the population this change exists to serve.
 *
 * DETERMINISTIC AND PURE, because the seat is shown these numbers and then answers with one: a
 * segmentation that varied between the display and the check would refuse correct answers, which is the
 * defect being fixed. A snippet that splits to nothing is ONE segment — never zero, or an owed row would
 * become impossible to discharge, which is this issue in a new place.
 *
 * The segments are RAW text, trimmed only at the edges. They are what code copies into the artifact, so
 * they must never be normalised: `normText` lowercases and collapses whitespace, and a passage sliced out
 * of it is neither what the page said nor what the tool fetched. Normalised text CHECKS; raw text is COPIED.
 * PURE; never throws.
 */
export function snippetSegments(snippet) {
  const raw = String(snippet ?? "");
  if (!raw.trim()) return [];
  // ⚠️ THE CJK TERMINATORS SPLIT WITHOUT REQUIRING WHITESPACE, AND THAT IS THE WHOLE POINT.
  //
  // My first draft was `/(?<=[.!?;。！？；：])\s+|\n+/` — one alternation for both families, whitespace
  // required after the terminator. Japanese does not put a space after `。`, so the R5 snippet segmented
  // to ONE segment and the CJK population got a pointer with nothing to point at. **The fix for the
  // whitespace assumption had the whitespace assumption in it**, and its own test caught it.
  //
  // `。！？` therefore split on the lookbehind alone. `;：；` and the Latin set still require following
  // whitespace: a bare `:` separates a label from its content ("意味：アザミ") and splitting there would
  // cut a definition away from the term it defines, which is worse evidence rather than more of it.
  const parts = raw
    .split(/(?<=[。！？])|(?<=[.!?;；：])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw.trim()];
}

/**
 * Resolve a seat's POINTER plus PROOF against the candidate it ruled on.
 *
 * The candidate is the one `resolveCandidate` already bound, so a segment cannot come from a receipt the
 * seat did not rule on. That retires `anchor_foreign` as a reachable state rather than refusing it: the
 * old anchor was searched across every candidate in the row, which is why a ruling on candidate 2 could
 * be evidenced by text out of candidate 1 and had to be caught afterwards.
 *
 * THE PROOF IS CHECKED UNDER THE BINDER'S OWN NORMALISATION, both sides, symmetrically. That is a unit
 * alignment at the point of comparison, not a repair upstream of a detector: the defect being detected is
 * NOT READING, and a curly apostrophe against a straight one is not evidence about reading. Folding one
 * side only would refuse correct work, which is the whole failure class here.
 *
 * @returns {{state:"bound"|"no_segments"|"segment_missing"|"segment_invalid"|"segment_dead_end",
 *            quote:string|null, segments:number, segment:string|null,
 *            fragmentState:"bound"|"unbound"|"too_short"|"absent"|undefined}}
 * `fragmentState` is present only on a bound result and is EVIDENCE, never a verdict —.
 * PURE; never throws.
 */
export function segmentBinding({ segment_index, fragment } = {}, candidate) {
  const segments = snippetSegments(candidate?.snippet);
  const out = (state, extra = {}) => ({ state, quote: null, segments: segments.length, segment: null, ...extra });
  if (!segments.length) return out("no_segments");

  const rawIdx = segment_index;
  const given = rawIdx != null && String(rawIdx).trim() !== "";
  if (!given) return out("segment_missing");
  // DIGITS ONLY, exactly as resolveCandidate reads an ordinal: Number() takes "2.5", " 2 " and "2px" and
  // would turn a malformed answer into a confident selection.
  const n = /^\d+$/.test(String(rawIdx).trim()) ? Number(String(rawIdx).trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > segments.length) return out("segment_invalid");
  const seg = segments[n - 1];
  // ── — THE PASSAGE IS THE DEAD END, AND THAT IS NOT THE SEAT'S FRAGMENT BEING TOO SHORT ────────
  //
  // `snippetSegments` splits on newlines, so a snippet's elision markers become passages. On the receipt
  // that killed a production run, passages 2, 4, 6, 8 and 10 were the literal string "..." — five of
  // twelve, and no fragment can ever be copied out of one that clears the bar. Pointing at one was an
  // automatic dead end and the refusal said `fragment_too_short`, which blames the seat's fragment and
  // invites it to copy MORE characters out of a passage that has none to give.
  //
  // Checked against `quoteWeight`, never `.length`, and that is the whole of the constraint. The
  // bar already weights scripts — measured, a five-character CJK passage BINDS where a five-character
  // Latin one does not — so a length test would exclude satisfiable CJK passages and mint exactly the
  // per-script satisfiability partition removed, inside the fix meant to honour it. One function,
  // one threshold, no script anywhere in the decision.
  //
  // REFUSED AND NAMED rather than excluded from the pointable set: excluding would renumber the passages
  // the seat is reading, and a renumbered list is a fresh way to point at the wrong thing.
  if (quoteWeight(seg) < FRAGMENT_MIN) return out("segment_dead_end", { segment: seg });

  // ── — THE POINTER BINDS. THE FRAGMENT IS EVIDENCE WE RECORD, NOT A DUTY WE ENFORCE. ─────────
  //
  // Measured on the round this issue was filed from: of 144 refusals across the three heavy rows,
  // `fragment_unbound` 65 + `fragment_absent` 58 = 85%. `fragment_unbound` means THE SEAT POINTED AT THE
  // RIGHT PASSAGE and could not reproduce its characters. After removing the 24 dead-end receipts
  // and the 64 retired-envelope round trips, 107 refusals remain on live, satisfiable
  // passages. **The fragment was detecting transcription, not reading** — and it was charging a call for
  // every failure, on exactly the non-Latin text a model transcribes worst.
  //
  // That settles the objection this change had to answer. Dropping the duty would be indefensible if the
  // fragment were the only detector of a seat that never read the passage; it is not, because a seat that
  // never read it cannot name a passage that survives `segment_dead_end` either, and the histogram shows
  // the failures clustering on rows where the passage was named correctly.
  //
  // SO THE MEASUREMENT SURVIVES THE ENFORCEMENT. A fragment that arrives is still weighed and still
  // matched, and the verdict rides out on `fragmentState` for the receipts histogram — which is how the
  // transcription-quality signal scruffy used to settle this stays measurable after the duty that
  // produced it is gone. Never charge for it: an unbound fragment is a fact about the model, and the
  // seat's ruling is not worse for it.
  const frag = String(fragment ?? "").trim();
  const fragmentState = !frag
    ? "absent"
    : quoteWeight(frag) < FRAGMENT_MIN ? "too_short"
      : !normText(seg).includes(normText(frag)) ? "unbound"
        : "bound";

  // THE QUOTE IS THE SEGMENT, RAW, and grown only if it is too thin to stand alone as evidence. Growth
  // reads ONWARD from the pointed segment first, exactly as the anchor extraction did, so the passage is
  // a natural continuation of what the seat pointed at rather than a window centred on it.
  let lo = n - 1, hi = n;
  while (quoteWeight(segments.slice(lo, hi).join(" ")) < QUOTE_MIN && (hi < segments.length || lo > 0)) {
    if (hi < segments.length) hi += 1; else lo -= 1;
  }
  return { state: "bound", quote: segments.slice(lo, hi).join(" ").trim(), segments: segments.length, segment: seg,
           fragmentState };
}

/**
 * M2 — THE SEAT POINTS AT A PASSAGE; CODE COPIES IT OUT.
 *
 * The spot-check asked a model to reproduce 24 characters of fetched text byte-perfectly, and then
 * refused the whole row when it came back one character off or joined across a line break it could not
 * see. That is `connotation_quote_unbound`, three of the twelve observed corrections, and it refused
 * rulings that were CORRECT — the failure class this whole programme exists to end.
 *
 * So the seat returns an `anchor`: a short fragment it actually saw, long enough to find and short
 * enough to get right. Code finds it in the row's own captured snippets and EXTRACTS a run of at least
 * QUOTE_MIN weight around it. The quote in the artifact is then, by construction, verbatim text the
 * tool fetched — which is a stronger guarantee than the old one, because the old one was only as good
 * as the model's transcription.
 *
 * AN ANCHOR THAT BINDS NOWHERE IS REFUSED, code-side, as `absent`. It is not widened, not fuzzy-matched
 * and not accepted on the seat's word: a seat that cannot point at eight characters of a snippet it was
 * handed did not read it, and that is exactly what the spot-check is for. What changed is WHO copies —
 * not whether the text has to be real.
 *
 * THE EXTRACTION EXPANDS RIGHT FIRST, then left, and stops at the snippet's edges. Reading onward from
 * the anchor keeps the quote a natural continuation of what the seat pointed at; a window centred on it
 * would routinely start mid-word for no gain.
 *
 * @param {string} anchor      the seat's short fragment
 * @param {Array}  candidates  the CANONICAL row's candidates (driver-written)
 * @returns {{state:"bound"|"absent"|"too_short"|"missing", receipt_id:string|null, quote:string|null}}
 * PURE; never throws.
 */
export function anchorBinding(anchor, candidates) {
  const a = normText(anchor);
  if (!a) return { state: "missing", receipt_id: null, quote: null };
  // Measured in weight, like everything else here, so a CJK anchor of three characters is not asked to
  // be eight — the same bias that made this lane harder in the first place.
  if (quoteWeight(a) < ANCHOR_MIN) return { state: "too_short", receipt_id: null, quote: null };

  for (const c of (candidates ?? []).filter((x) => usableSnippet(x?.snippet))) {
    const raw = String(c?.snippet ?? "");
    // THE EXTRACT COMES OUT OF THE RAW SNIPPET, NEVER THE NORMALISED ONE. `normText` lowercases and
    // collapses whitespace runs, so a passage sliced out of it is neither what the page said nor what
    // the tool fetched — it would put mangled text into an artifact a lawyer reads, which is a worse
    // fault than the transcription problem being fixed. Normalised text FINDS; raw text is COPIED.
    //
    // The seat is shown the raw snippet, so a correctly copied anchor is normally present in it exactly
    // apart from case. That is the fast path.
    const at = raw.toLowerCase().indexOf(a.toLowerCase());
    if (at >= 0) {
      // CODE POINTS, not code units: slicing UTF-16 can cut a surrogate pair in half and put half a
      // character into a delivered artifact. Snippets are short, so this is cheap.
      const cp = Array.from(raw);
      let lo = Array.from(raw.slice(0, at)).length;
      let hi = lo + Array.from(a).length;
      // Expand RIGHT first, then left, stopping at the snippet's edges: reading onward from the anchor
      // keeps the passage a natural continuation of what the seat pointed at, where a centred window
      // would routinely open mid-word for no gain.
      while (quoteWeight(cp.slice(lo, hi).join("")) < QUOTE_MIN && (hi < cp.length || lo > 0)) {
        if (hi < cp.length) hi += 1; else lo -= 1;
      }
      const quote = cp.slice(lo, hi).join("").trim();
      if (quoteWeight(quote) >= QUOTE_MIN) return { state: "bound", receipt_id: c?.receipt_id ?? null, quote };
    }
    // TOLERANCE PATH. The anchor matches only after folding — a curly apostrophe against a straight one,
    // a line break the seat rendered as a space. It BINDS, and the seat has proved it read the receipt,
    // but folding changes lengths so no offset maps back to the raw text. Rather than slice normalised
    // text or guess an offset, the whole raw snippet becomes the quote: bounded, verbatim, and certainly
    // containing the passage. A slightly long quote is a far smaller fault than a mangled one.
    if (normText(raw).includes(a)) {
      const quote = raw.trim();
      if (quoteWeight(quote) >= QUOTE_MIN) return { state: "bound", receipt_id: c?.receipt_id ?? null, quote };
    }
  }
  return { state: "absent", receipt_id: null, quote: null };
}

/**
 * Does this row's spot-check pass, by EITHER route? PURE.
 *
 * The anchor is the route M2 adds; `quote` stays because every archived form carries one and no anchor,
 * and a replay that accepted only anchors would re-open every quote-required row in the archive. Same
 * leniency rule as M1's index-or-id: a new way in, never a replacement.
 */
export function spotCheckBinds(row, candidates) {
  if (quoteBinding(row?.quote, candidates).state === "bound") return true;
  return anchorBinding(row?.anchor, candidates).state === "bound";
}

/**
 * Is ONE form row RULED? The single definition of a discharged obligation, used by the gate below AND by
 * disposition-union.mjs — the union may only carry forward what this function would accept, or the two
 * disagree about what work is done and the outstanding count stops meaning anything.
 *
 * `row` is the seat's row (its fields may be anything); `canonical` is the DRIVER's regenerated row for
 * the same obligation, and every identifier is read from the canonical side. A seat that rewrites its own
 * candidate list cannot widen what binds. PURE; never throws.
 */
export function isRuled(row, canonical) {
  if (!row || !canonical) return false;
  if (!RULING_SET.has(String(row.ruling ?? "").trim().toLowerCase())) return false;
  if (!String(row.note ?? "").trim()) return false;
  if (!resolveCandidate(row, canonical).id) return false;
  // M2 — either route discharges the spot-check: the seat's own verbatim quote (archived forms,
  // replays) or the anchor it pointed with (everything new). What is never accepted is neither.
  if (canonical.quote_required && !spotCheckBinds(row, canonical.candidates)) return false;
  return true;
}

/**
 * WHICH CANDIDATE A SEAT ROW NAMES. The one resolution, and the only place an ordinal may exist.
 *
 * M1: where a model must name one of a set THE DRIVER ALREADY HOLDS, it returns the 1-based index
 * into that set and code resolves the index to the id. The seat typing an identifier is what gave
 * every receipt an id to stop, and rows still came back citing ids that were not on their own candidate
 * list — a whole paid dispatch discarded over a token nobody needed to transcribe.
 *
 * THREE WAYS IN, TRIED IN THIS ORDER, AND THE ORDER IS THE LENIENCY RULE:
 *   1. `receipt_index`, 1-based into the CANONICAL candidates. An index past the end does not bind and
 *      does not throw — it falls through, because a seat that also typed a good id must not lose a
 *      correct ruling to a bad ordinal.
 *   2. `receipt_id`, kept, and not as a kindness: EVERY ARCHIVED FORM carries ids and no indices. A
 *      resolution that took only indices would re-open every discharged row on every historical replay.
 *
 * AND NOTHING ELSE. There is deliberately no "if there is only one candidate, take it" clause here — see
 * the comment at the fall-through below, which the twins tests wrote. The one-candidate pre-bind is a
 * property of the FORM the driver writes, not of what a seat's answer is allowed to bind to.
 *
 * An unbindable answer resolves to NOTHING. Picking the first candidate would invent a ruling the seat
 * never made, on exactly the row where it was least sure.
 *
 * @returns {{id:string, from:"index"|"id"|null,
 *            state:"bound"|"out_of_range"|"unknown_id"|"unnamed"|"no_candidates"}}
 *
 * IDENTIFIERS ARE READ OFF `canonical`, NEVER OFF `row`. A seat that rewrites its own candidate list
 * cannot widen what binds; that is isRuled's rule and this inherits it unchanged.
 *
 * `state` separates failures a reader must tell apart: naming nothing is not the same defect as an
 * ordinal past the end of the list, and neither is a row with no candidates to name at all.
 *
 * @param {object} row        the seat's row — its fields may be anything
 * @param {object} canonical  the DRIVER's regenerated row, which owns the candidate list
 * @returns {{id:string, from:"index"|"id"|null,
 *            state:"bound"|"out_of_range"|"unknown_id"|"unnamed"|"no_candidates"}}
 * PURE; never throws.
 */
/**
 * Is this receipt a PLACEHOLDER a model produced from a shown shape, rather than a real id?
 *
 * A real receipt is `R-` plus eight Crockford-base32 characters, minted by `receiptId` from the result's
 * own URL. Anything else in that slot was invented, and the two known ways to invent one are both
 * pattern-matches on text the prompt displayed: the example token itself, and the metavariable that
 * described it. One production seat wrote `R-RECEIPT` into 27 rows.
 *
 * Deliberately NARROW. This decides the WORDING of a refusal that already happens for any unknown id —
 * it is not the refusal — so a false positive costs a slightly wrong sentence and a false negative costs
 * the old sentence. Neither can let a bad receipt through, which is why it is safe to keep it a
 * shape-check rather than a list to maintain.
 * PURE.
 */
export function isPlaceholderReceipt(id) {
  const s = String(id ?? "").trim().toUpperCase();
  if (!s.startsWith("R-")) return false;
  const tail = s.slice(2);
  if (!tail) return true;
  // THE METAVARIABLE IS A VALID RECEIPT SHAPE, which is exactly why it was so easy to echo: `X` is in
  // Crockford base32, so `R-XXXXXXXX` passes the shape test below and no amount of pattern-tightening
  // will separate it from a real id. It is named. So is the other observed echo. A shown token that
  // cannot be told from a real one by shape is the strongest argument for not showing one at all, which
  // is what this change does at the source — this list is the belt to that pair of braces.
  if (tail === "XXXXXXXX" || tail === "RECEIPT") return true;
  // A real tail is exactly 8 chars of Crockford base32 (no I, L, O or U).
  if (/^[0-9A-HJKMNP-TV-Z]{8}$/.test(tail)) return false;
  // Everything else in the R- namespace was invented.
  return true;
}

export function resolveCandidate(row, canonical) {
  const cands = Array.isArray(canonical?.candidates) ? canonical.candidates : [];
  if (!cands.length) return { id: "", from: null, state: "no_candidates" };
  // NORMALISED TO COMPARE, RAW TO RETURN — and the two must never be confused. `normId` folds the hyphen
  // out of `R-AAAAAAAA`, so returning it would write `RAAAAAAAA` into the accumulator: an id that matches
  // no candidate on the next regeneration, on a row that reads as ruled. The union's own carry is what
  // makes this fatal rather than cosmetic.
  const rawAt = (i) => String(cands[i]?.receipt_id ?? "").trim();
  const idAt = (i) => normId(cands[i]?.receipt_id);

  const rawIdx = row?.receipt_index ?? row?.receiptIndex;
  const hasIdx = rawIdx != null && String(rawIdx).trim() !== "";
  // DIGITS ONLY. Number() takes "2.5", " 2 " and "2px" and would turn a malformed answer into a
  // confident selection; an ordinal that is not an integer is not an ordinal.
  const n = hasIdx && /^\d+$/.test(String(rawIdx).trim()) ? Number(String(rawIdx).trim()) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= cands.length && idAt(n - 1)) {
    return { id: rawAt(n - 1), from: "index", state: "bound" };
  }

  // The id is taken from the CANONICAL candidate that matched, never from the seat's own bytes — the
  // seat's spelling may be folded-equal without being equal, and the driver's is the one that binds.
  const named = normId(row?.receipt_id);
  if (named) {
    const hit = cands.findIndex((c) => normId(c.receipt_id) === named);
    if (hit >= 0) return { id: rawAt(hit), from: "id", state: "bound" };
  }

  // NO SOLE-CANDIDATE FALLBACK HERE, AND THE REASON IS THE TWINS.
  //
  // The obvious version of M1's pre-bind resolves a one-candidate row to its only candidate right here.
  // It is wrong, and the existing suite proved it: `isRuled` is what formRowFinder's BOUND search calls,
  // so a sole-candidate fallback would make an ID-LESS seat row bind to any twin sharing its folded key
  // — one submitted ruling discharging TWO distinct obligations the seat answered once. That is the
  // rubber-stamp drift the recurrence floor was designed to refuse, arriving through the back door.
  //
  // The pre-bind is real, and it lives where it cannot widen binding: obligationRows WRITES the receipt
  // onto every one-candidate row, and unionDispositionForm RE-ASSERTS it on the merged row. A seat that
  // strips the field still ends up ruled, because the union puts the driver's receipt back before the
  // row is judged. What no longer happens is a bare ruling binding to a row nobody pointed at.
  //
  // Two failing tests wrote this comment: "MONOTONICITY still holds over the twins" and "an id-less
  // submission that answers ONE twin cannot poison the other".

  // Most specific failure first: an index that was offered and did not land names the field M1 asks for.
  if (hasIdx) return { id: "", from: null, state: "out_of_range" };
  if (named) return { id: "", from: null, state: "unknown_id" };
  return { id: "", from: null, state: "unnamed" };
}

// ── RECURRENCE FLOOR (review round 2026-07-31 — a RECORDED design decision, deviating from B8(ii)) ────
// ROUND2-FINDINGS B8(ii) reads as disposition over every recorded RESULT (~380 rows on the evidence run);
// disagreement 1 forbids exactly that rubber-stamp drift, and the per-query one-cited-result join alone
// provably re-admits the evidence-run shape: a doc can dispose all 54 queries citing only benign results
// while the loaded receipt — retrieved on query after query — is cited nowhere. The recorded middle:
// a result the sweep surfaced across RECURRENT_MIN or more DISTINCT queries is load-bearing by
// recurrence (on the evidence run that set is 7 results, the cultural-appropriation article among them,
// vs. 274 distinct results), and each must be cited on a line that disposes one of its own queries —
// the gate forces the receipt onto the page; the RULING on it stays the reader's judgment. This is
// deliberately LESS than full per-result disposition and MORE than the bare per-query join; the residual
// (a loaded receipt surfacing on fewer than RECURRENT_MIN queries, cited nowhere) is accepted and
// covered by the probe-34 validation tripwire + the skill's "rule on the result you actually weighed".
const RECURRENT_MIN = 4;

// ── — THE REASON SCALE IS MEASURED HERE AND DELIBERATELY DOES NOT DECIDE ────────────────────────
// was ruled "recurrence counts independent reasons, not query strings": a dictated query is
// "<term> <shape>", the sweep asks every shape of every mark variant, so the seven queries reading
// BIODELFIN/BIODELFINO/BIODOLPHIN/ΒΙΟΔΕΛΦΙΣ/ΔΕΛΦΙΣ/ΜΠΙΟΔΕΛΦΙΣ/Дельфис + "offensive meaning" that all
// return the dictionary definition of the word "offensive" are one reason asked seven ways. That
// reasoning is sound and the shape is the right way to express it. It is implemented below as
// connotationReasonKey, and it is RECORDED on every run — but it is NOT what clears the floor.
//
// IT WAS BUILT, MEASURED AGAINST THE THREE PRESERVED RUNS, AND REFUTED BY THEM. Making the floor read
// the reason scale inverts the signal it exists to read:
//   - The 2026-07 evidence run (test/fixtures/coral-freeze-pr-risk.json, 54 recorded queries): the floor's
//     obligation set goes 7 → 0. `punchdrink.com/articles/problem-with-tiki-bars-cultural-appropriation`
//     — THE receipt this floor was invented to force onto the page — is surfaced by four queries that are
//     all shape "offensive", so it scores ONE reason and drops out. The gate stops firing on the run it
//     was designed for.
//   - R1 PROJECT SABLE the R1 run @a55d9c3: 15 → 6, and the six that survive are four generic
//     dictionary/etymology pages plus two same-name sites. One of those two — a real
//     product carrying the exact mark, on one of that scenario's own gold channels — scores 2 and drops.
//   - R2 BIOVELTRIN the R2 run @a55d9c3: 21 → 6.
// The mechanism is systematic, not unlucky. A LOADED receipt is loaded in ONE direction ("this word has a
// bad history"), so it recurs across many mark variants under ONE shape. A GENERIC dictionary page answers
// EVERY direction, so it recurs across many shapes. Counting distinct shapes therefore promotes exactly the
// receipts the ruling wanted demoted and demotes the ones it wanted kept.
//
// So the floor keeps counting distinct query strings, and this module publishes the reason count instead:
// every recurrence violation carries `queries` and `reasons`, and the run's connotation audit records the
// sweep's distinct-reason total. The next ruling gets the numbers on both scales from real runs rather
// than an estimate. See the comment on the issue for the full census.
//
// LONGEST SHAPE WINS: "offensive meaning" (translit bucket) must not be read as the core "meaning" or as
// "offensive" — the three are different directions and collapsing them would under-count.
const ALL_CONNOTATION_SHAPES = [...new Set([...CONNOTATION_SHAPES, ...CONNOTATION_SHAPES_TRANSLIT])]
  .map((s) => normText(s)).filter(Boolean).sort((a, b) => b.length - a.length);

/**
 * The independent REASON a query represents: its dictated shape, or — for a derived meaning angle that
 * fits no shape — the query itself. PURE. MEASUREMENT ONLY: nothing gates on this. See the block above
 * for the three runs that refuted gating on it.
 */
export function connotationReasonKey(query) {
  const q = normText(query);
  for (const s of ALL_CONNOTATION_SHAPES) if (q.endsWith(` ${s}`)) return `shape:${s}`;
  return `angle:${q}`;
}

// ── — THE OBLIGATION SET IS COMPUTED ONCE AND USED TWICE ────────────────────────────────────────
// What a seat owes the meaning-receipts gate was, until this function, only ever derived INSIDE the gate —
// so a model learned its obligations one refusal at a time. R1 @a55d9c3 spent three attempts and two
// recovery parks discovering a list that its own ledger had already determined, and still died with four
// receipts it had never cited. The list could not be handed over at dispatch time (the seat RUNS the sweep;
// nothing is on disk when the prompt is composed) — but it exists the instant the grid tool returns, which
// is still before the first refusal. That is where it is now told: driver/engine/mcp/perplexity-server.mjs
// renders THIS function's output into the tool result.
//
// ONE CALCULATION, NOT TWO KEPT IN STEP. The owner's ruling is explicit and it is the acceptance, not a
// nicety: reject any version where the telling and the judging read different code paths. is the
// precedent — one calculation running twice, silently disagreeing on every clean run, unnoticed for weeks
// precisely because both copies looked correct. So findConnotationViolations consumes this and derives
// nothing of its own, the tool result renders this and derives nothing of its own, and
// connotation-obligations.test.mjs asserts the gate can never flag anything the render did not name.
//
// WHAT THIS CHANGES ABOUT THE EVIDENCE, stated plainly because it is a real trade. lineCitesResult's
// contract was "the model quoted something it could only have got by opening the receipt". Handing the
// model the URLs weakens that: a bound citation now proves the receipt was PUT ON THE PAGE, not that it was
// read. That is the contract the floor actually needs — its own doc block says "the gate forces the receipt
// onto the page; the RULING on it stays the reader's judgment" — and the ruling (benign / off-topic /
// loaded) is the model's own and is not handed over. The anti-fabrication guarantee is elsewhere and
// untouched: the ledger is written by the TOOL, never by the model.
//
/**
 * Everything a seat owes the meaning-receipts gate, from its recorded receipts alone. PURE; never throws.
 *
 * @param {Array<{query:string, results:Array<{title:string,url:string}>}>|null} recorded  parsePrRiskResults output
 * @returns {{floor:number, queries:Array<{query,results}>, recurrent:Array<{result,owners,reasons}>}}
 *   queries   — every recorded query that returned results; each owes one disposition row.
 *   recurrent — distinct results (keyed url-first, title fallback) surfaced across >= floor DISTINCT
 *               QUERIES; each additionally owes a citation bound to one of its own queries. `reasons` is
 *               the measured second scale  and decides nothing.
 */
// ── M2, FINISHED — A CONTRACT IS ITS FIELD SET, NOT ONLY ITS SENTENCES ──────────────────────────
//
// R5 (2026-08-14) found the half E12 structurally cannot see. Every dictated SENTENCE agreed after M1
// and M2 — the dispatch, the doctrine, the corrective hints all ordered `receipt_index` and `anchor`.
// The FORM did not: these rows were emitted with `quote: null` and no `anchor` key and no
// `receipt_index` key at all. So a seat was told to set two fields, opened the file, and found neither
// slot — and a slot for a third field the same instruction tells it not to write.
//
// That is the same defect as a diverging sentence and it fails the same way: silently, as a seat
// "failing" at something it was never coherently asked. E12 reconciles what the code SAYS; nothing
// reconciled what the code EMITS. Stated once here so the two row builders below cannot drift apart,
// which is how three of the four sentence copies came to exist in the first place.
//
// `quote` STAYS, and it is the driver's: anchorBinding extracts the passage into it (disposition-union
// seatFields), and a seat's own verbatim quote is still ACCEPTED on the archived/replay path
// (spotCheckBinds). What changed is that the seat is no longer left inferring where its anchor goes.
//
// ONE DECLARED LIST, TWO CONSUMERS. `MEANING_SEAT_FIELDS` is what the seat is asked for; the row builders
// below emit exactly these slots, and meaningSweepReceiptsInstruction() names exactly these fields. A test
// binds the three together (disposition-field-set.test.mjs), so a fifth field cannot be ordered without a
// slot appearing, and a slot cannot appear without the instruction naming it. That is the field-set half
// of the contract E12 checks the sentence half of.
// — `anchor` became `segment_index` + `fragment`: the LOCATOR and the PROOF, which one string was
// doing at once with incompatible requirements. See SEGMENT POINTING above for why they must stay two.
export const MEANING_SEAT_FIELDS = Object.freeze(["receipt_index", "ruling", "note", "segment_index", "fragment", "obstacle"]);

// `quote` is emitted beside them and is NOT a seat field: anchorBinding extracts the passage into it, and
// a seat's own verbatim quote is still accepted on the archived/replay path. It has a slot because the
// driver fills it, not because the seat is asked for it.
const SEAT_SLOTS = () => ({ ...Object.fromEntries(MEANING_SEAT_FIELDS.map((f) => [f, null])), quote: null });

export function connotationObligations(recorded) {
  // — every result carries its citable id from here on. Attached ONCE, at the single place the
  // obligation set is computed, so the render and the gate read the same object rather than each
  // re-deriving it; `id` is additive, so every existing reader of `results[]` is untouched.
  const queries = (Array.isArray(recorded) ? recorded : [])
    .filter((e) => Array.isArray(e?.results) && e.results.length && normText(e?.query))
    .map((e) => ({ ...e, results: e.results.map((r) => ({ ...r, id: receiptId(r) })) }));
  const byResult = new Map();
  for (const e of queries) {
    const nq = normText(e.query);
    const seen = new Set();
    for (const r of e.results) {
      const key = receiptKey(r);
      if (!key || seen.has(key)) continue;   // one query surfaces a result once, however many times it repeats in-page
      seen.add(key);
      if (!byResult.has(key)) byResult.set(key, { result: r, id: r.id, owners: [] });
      byResult.get(key).owners.push({ nq, query: e.query });
    }
  }
  const recurrent = [...byResult.values()]
    .filter((x) => x.owners.length >= RECURRENT_MIN)
    .map((x) => ({ ...x, reasons: new Set(x.owners.map((o) => connotationReasonKey(o.query))).size }));
  return { floor: RECURRENT_MIN, queries, recurrent };
}

// ── — THE ARTIFACT IS A FORM THE DRIVER WROTE, NOT A DOCUMENT THE SEAT AUTHORS ─────────────────
// gave every receipt an id so the seat could cite one instead of retyping a URL. It did not stop the
// seat AUTHORING the file: it still typed the query verbatim (a percent-encoded Korean Wikipedia path, a
// CJK query string), and one unrecognised row discarded the whole artifact — 19 of 20 receipts correctly
// ruled, thrown away, on the terminal production run of 2026-08-06.
//
// So the driver writes the file and the seat fills its own slots in it. `rows`, `row_id`, `kind`, `query`,
// `candidates`, `quote_required`, `receipt_id` and `quote` are the DRIVER'S; `receipt_index`, `ruling`,
// `note` and `anchor` are the SEAT'S. Nothing is transcribed, a missing row is structurally impossible,
// and the only reachable defects are an unset ruling and a damaged file.
//
// UPDATED 2026-08-14 ( M1 + M2). This sentence said `receipt_id, ruling, note and quote` for a day
// after both moves had changed the answer — the seat now gives a POSITION and an ANCHOR, and the driver
// resolves those into `receipt_id` and `quote`. E12 does not fire on it and that is correct rather than a
// gap: this is a `//` comment, and a comment is never dispatched to a model, which is the scope rule E12
// declares in its own header and the lesson E3 learned twice. It is still a statement that sent the next
// READER the wrong way, which is why it is fixed here rather than excused.
//
// PARSED LENIENTLY, JUDGED STRICTLY. A rejected parse costs a whole paid dispatch, so the array is taken
// from `rows`, from `dispositions` or from a bare top level, and per-row identifiers are read in either
// case convention. Nothing about that widens what BINDS: isRuled above reads every candidate id off the
// DRIVER's regenerated row, never off the bytes the seat handed back.
// ── — NAME THE CAUSE WHEN IT IS KNOWABLE, AND NEVER REPAIR IT ──────────────────────────────────
//
// A seat wrote ONE row's delimiters as typographic quotes — `“row_id”: “Q-AWMHCTCT”` — and its 74-row
// form stopped parsing at char 2535. `unparseable json (Expected property name…)` is true and gives the
// seat nothing to change. This adds the character and where it is.
//
// LOCALISED TO THE FAILURE, DELIBERATELY. Curly quotes appear in the `_provenance` prose of EVERY healthy
// form — 9 to 11 per file on the measured run — so "the file contains a curly quote" is true of the clean
// ones too and naming it on every parse failure would be a false attribution on faults that have nothing
// to do with quoting. Only a curly quote within 120 characters of the position the parser stopped at is
// reported, and a failure with none nearby is worded exactly as it was before.
//
// REPAIR IS REFUSED, AND THIS IS THE REASON RATHER THAN A PREFERENCE. In the very file that motivated
// this, a legitimate curly quote sits INSIDE a title value: `"BMB" Street Gang Member Sentenced…`. A
// delimiter and a quoted word are not separable without a full parser. Both readers on 2026-08-16 tried
// the blunt swap: it broke the file that had been parsing fine. A wrong repair silently corrupts a ruling
// instead of failing, which is worse than the defect it would be fixing.
const TYPOGRAPHIC_QUOTE = /[‘’“”]/;
function typographicCause(raw, message) {
  const at = Number((/position (\d+)/.exec(String(message ?? "")) || [])[1]);
  if (!Number.isFinite(at)) return "";
  const text = String(raw ?? "");
  const from = Math.max(0, at - 120);
  const hit = TYPOGRAPHIC_QUOTE.exec(text.slice(from, at + 120));
  if (!hit) return "";
  const cp = hit[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  return ` — typographic quote U+${cp} at position ${from + hit.index}: JSON delimiters must be plain ASCII double quotes`;
}

/**
 * Parse the meaning-sweep disposition form. Never throws. Returns {rows, error} — `error` is a short
 * reason when the bytes were present but unusable, so a malformed file reads as a NAMED defect rather
 * than as an absent one (an absence is a finding; a silently-empty parse is not). PURE.
 */
export function parseDispositionForm(raw) {
  if (raw == null) return { rows: null, error: null };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { rows: null, error: `unparseable json (${String(e.message).slice(0, 60)})${typographicCause(raw, e.message)}` }; }
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.rows) ? parsed.rows : parsed?.dispositions);
  if (!Array.isArray(arr)) return { rows: null, error: "no rows[] array at the top level or under `rows`" };
  const rows = [];
  for (const d of arr) {
    if (!d || typeof d !== "object") continue;
    rows.push({
      row_id: String(d.row_id ?? d.rowId ?? "").trim(),
      kind: String(d.kind ?? "").trim() || "query",
      query: String(d.query ?? "").trim(),
      receipt_id: String(d.receipt_id ?? d.receiptId ?? "").trim(),
      // M1 — the ORDINAL, carried as written and resolved nowhere near here. This function has no
      // candidate list, so it cannot resolve one, and a parser that guessed would be resolving against
      // the seat's own bytes. resolveCandidate does it against the DRIVER's row; every consumer reaches
      // it through isRuled or seatFields, so the ordinal never survives into an accumulated row.
      receipt_index: String(d.receipt_index ?? d.receiptIndex ?? "").trim(),
      ruling: String(d.ruling ?? "").trim(),
      note: String(d.note ?? "").trim(),
      quote: String(d.quote ?? "").trim(),
      // M2 — the POINTER, carried as written. Like `receipt_index`, it is resolved against the
      // DRIVER's candidates (anchorBinding) and never here: this function holds no snippets, so a parser
      // that tried would be matching the seat's bytes against the seat's bytes.
      anchor: String(d.anchor ?? "").trim(),
      // — THE PARK, carried through this whitelist ON PURPOSE. This parser REBUILDS each row from
      // a fixed key list, so a field written into the accumulator and not named here is silently dropped
      // on the next read. The gate re-unions the accumulator on every judgement (gateway.mjs), so a park
      // that did not survive a round trip would let the row return to the outstanding set and the
      // live-lock would resume — the exact failure this field exists to end. It is NOT a ruling: a parked
      // row keeps `ruling: null` and is counted apart, so no count ever claims it was decided.
      parked: d.parked === true,
      parked_reason: String(d.parked_reason ?? "").trim(),
      parked_refusals: Number.isFinite(Number(d.parked_refusals)) ? Number(d.parked_refusals) : 0,
      // — the park's PROVENANCE, and it is named here for the same reason `parked` is: a field the
      // accumulator holds and this list omits is dropped on the next read. Losing it would not resume the
      // live-lock, so it fails quieter than `parked` would — the row stays parked and simply forgets
      // whether a seat declared it or thirty refusals earned it, which is the one comparison the declared
      // exit is measured by.
      parked_kind: String(d.parked_kind ?? "").trim(),
    });
  }
  return { rows, error: null };
}

// EVERY OBLIGATION SHIPS. No head(), no slice(), no "…and N more". The register-digest sibling
// (gateway.mjs deferredSlicesRequiredRows) printed the first six qids per axis and elided the rest, and its
// own doc block records what that cost: "Under advice that is an economy; under a requirement it makes
// compliance impossible." Same rule here, and 's: a value a model must copy is complete, or it is
// visibly marked as cut. Nothing below is cut, so nothing below is marked.
/**
 * The obligation set as the seat's own to-do list, for the tool result. Returns "" when nothing is owed —
 * a half that owns no meaning queries must see no block at all, not an empty and alarming one. PURE.
 */
export function renderConnotationObligations(ob, { ledgerPath = "your half ledger", dispositionsPath = null } = {}) {
  if (!ob?.queries?.length) return "";
  const label = (r) => [r.title, r.url].map((s) => String(s ?? "").trim()).filter(Boolean).join(" — ") || "(untitled result)";
  // ── — THE PAGE IS NUMBERED OFF THE SAME FUNCTION THAT RESOLVES THE NUMBER ─────────────────
  //
  // `obligationRows` is the driver's row list, and a `row_index` is a position into it. Numbering this
  // page with its own counter would be two derivations of one ordering, which is the mistake 's
  // segment display already names in its own comment: "the display and the check cannot disagree, which
  // they would the moment either recomputed its own split". So the numbers come from the list itself.
  //
  // The receipts under each row are taken from that row's `candidates` for the same reason, and it is
  // not cosmetic: `candidates` drops any result the driver could mint no id for, while this block used to
  // number `e.results`, which keeps them. One such result and every ordinal below it in that row pointed
  // one candidate off — the seat naming receipt 3 and the driver binding receipt 4's id, silently. Both
  // ends now count the same list.
  const canonical = obligationRows(ob);
  const numberedQuery = new Map();
  const numberedRecurrence = new Map();
  canonical.forEach((r, i) => {
    if (r.kind === "recurrence") numberedRecurrence.set(String(r.receipt_id ?? "").trim(), { n: i + 1, row: r });
    else numberedQuery.set(String(r.query ?? ""), { n: i + 1, row: r });
  });
  const out = [
    "MEANING-SWEEP OBLIGATIONS — computed by the driver from the ledger just written, with the SAME",
    "calculation the validator will use to judge your work. This is the complete list: nothing here is",
    "abbreviated, truncated or elided, and there is nothing owed that is not named below.",
    "",
    // M1, FINISHED. This read "EVERY RECEIPT BELOW CARRIES AN ID (R-XXXXXXXX). Cite the ID." —
    // which, once M1 made the answer an ordinal, contradicted the form's own instruction two screens
    // down. Worse, it DISPLAYED the token shape: a model shown `R-XXXXXXXX` and asked for an id writes
    // `R-RECEIPT`, and that is the recorded mechanism behind 27 invented tokens on a single seat. The
    // ids are gone from this listing along with the instruction to cite them. Nothing here shows a shape
    // the seat could pattern-match, because a shape shown is a shape a model will produce.
    "YOU CITE NO IDENTIFIER ANYWHERE, AND THAT NOW INCLUDES THE ROW ITSELF. Every obligation below is",
    "NUMBERED, and so is every receipt within it. Those two numbers are the whole answer — never an id,",
    "never a query you retype, never a title or a URL. Nothing on this page has to be copied, and copying",
    "is what used to fail on receipts that had been read and ruled on correctly.",
    "",
    `1. EACH of these ${ob.queries.length} recorded queries returned results and owes ONE disposition, naming the`,
    "   NUMBER of the obligation (the number printed beside it below), the POSITION of one of THAT query's",
    "   own results (listed under it), and your ruling on it.",
    "   A query with no chosen receipt is not a disposition. A loaded reading ALSO becomes a Finding.",
    ...ob.queries.flatMap((e) => {
      const hit = numberedQuery.get(String(e.query));
      // A query with no row cannot be addressed, so it is named as a driver fault rather than numbered
      // wrongly. `obligationRows` walks the same `ob.queries`, so this is unreachable by construction —
      // and an unreachable branch that prints a number anyway is how a wrong number gets shipped.
      if (!hit) return [`   - ${e.query}   (DRIVER FAULT: this obligation has no row and cannot be recorded — report it, do not work around it)`];
      return [
      `   ${String(hit.n).padStart(2)}. ${e.query}`,
      // The ordinal is 1-based and per-row, matching `receipt_index` on the form exactly — the seat is
      // never asked to hold two different numbering schemes at once.
      //
      // THE REAL IDS STAY. 's acceptance is that the gate cannot fail a seat for an obligation the
      // tool result never named, and these are what a failure names. What was removed is the METAVARIABLE
      // and the instruction to cite one — a model shown `R-XXXXXXXX` writes `R-RECEIPT`, whereas a model
      // shown a list of real ids it is told not to type has nothing to pattern-match.
      ...hit.row.candidates.map((c, i) => `       ${String(i + 1).padStart(2)}. ${c.receipt_id}  ${label(c)}`),
      ];
    }),
  ];
  if (ob.recurrent.length) {
    out.push(
      "",
      `2. These ${ob.recurrent.length} results are LOAD-BEARING BY RECURRENCE — the sweep surfaced each across ${ob.floor} or more`,
      "   distinct queries. Beyond the rows above, EACH must be disposed under one of ITS OWN queries,",
      "   listed under it here. A disposition citing it under any other query does not bind.",
      "   THE NUMBERING CONTINUES from the list above — these are obligations too, addressed the same way.",
      // THE RECURRENCE ROW'S RECEIPT ID IS GONE FROM THIS LINE. It was kept for — a gate may
      // not fail a seat for an obligation the tool result never named — and what a failure names is now
      // the NUMBER, printed here, so the reason it was kept is satisfied by the number instead. It was
      // also the one id on this page sitting where an address goes, on the only row kind whose receipt
      // the seat does not choose; leaving it there was leaving the invitation this issue is about.
      // The query rows' receipt ids stay: those sit beside a choice the seat DOES make.
      ...ob.recurrent.flatMap(({ result, id, owners }) => {
        const hit = numberedRecurrence.get(String(id ?? "").trim());
        if (!hit) return [`   - ${label(result)}   (DRIVER FAULT: this recurrence has no row and cannot be recorded — report it, do not work around it)`];
        return [
          `   ${String(hit.n).padStart(2)}. ${label(result)}   (its receipt is already resolved by the driver — rule it, do not choose it)`,
          `     dispose it under one of: ${owners.map((o) => o.query).join(" | ")}`,
        ];
      }),
    );
  }
  if (dispositionsPath) {
    // B — THE SEAT SENDS VALUES; THE DRIVER WRITES THE DOCUMENT. The hand-edited form this block used to
    // dictate is gone: a model hand-typed a 140 KB JSON document, one row's delimiters were typographic
    // quotes, and 74 correct legal rulings were voided by a quote character. The typed call makes that
    // class inexpressible rather than caught — the serialization is the driver's.
    out.push(
      "",
      "HOW TO RECORD THEM. Call the `record_dispositions` tool — never write or edit any file for this.",
      "Pass `grid_spec_path` (the same driver-written spec path the grid tool was given) and `rows`: one",
      "entry per obligation above, each with `row_index` (the NUMBER printed beside that obligation above),",
      "`receipt_index` (the POSITION of the candidate you ruled on in that row's own list — 1 for the",
      `first, 2 for the second), \`ruling\` (${RULINGS.join(" / ")}), and \`note\` (one line of your`,
      "reasoning).",
      ...POINT_DIRECTIVE,
      "",
      // M1 — WHY A NUMBER AND NOT THE ID. The id is 8 characters the seat has to copy exactly, and a
      // mistyped one used to discard the whole artifact. A position cannot be mistyped into another row's
      // receipt: it is either in range or it is not, and out of range is reported rather than bound.
      //
      // — AND THE SAME SENTENCE NOW COVERS THE ROW, WHICH IS WHY THIS BLOCK STOPPED CONTRADICTING
      // ITSELF. Three paragraphs of this page told the seat to cite no identifier and then ordered one:
      // `row_id`, "exactly as the obligations sidecar lists it" — a sidecar that lists query strings and
      // has never carried a row id, on a page that printed none. The seat sent the only per-row label it
      // had, the query, and 28 calls died `unknown_row`. There is no id left on this page to order.
      "Both numbers are enough. You never type an identifier of any kind — not a row id, not a receipt id,",
      "not a query. The driver resolves each number and records what it resolves to. A row listed with",
      "exactly ONE receipt is already resolved; it needs no `receipt_index` — give it only its `row_index`,",
      "your `ruling` and your `note`.",
      "Rows are validated as they arrive: rows that validate are KEPT even when others in the same call",
      "are refused, and the tool's answer names every obligation still outstanding and which of them owe",
      "a `segment_index` and `fragment`. Your rulings ACCUMULATE across calls and across attempts — nothing",
      "already recorded",
      "needs re-sending. Send the rest in a further call until the answer reports nothing outstanding.",
      "",
      "The driver renders these into your findings file as the PR / reputational disposition table, so do",
      "not hand-write that table. Your PR section still carries your own narrative and any Findings.",
    );
  }
  out.push(
    "",
    "The ruling on each receipt is yours and is not supplied here. What is supplied is which receipts you",
    "must rule on, so that you learn it now rather than from a refusal.",
  );
  return out.join("\n");
}

/**
 * THE MEANING-SWEEP RECEIPTS INSTRUCTION — one composer, because it was authored FOUR TIMES.
 *
 * M1 found the same sentence hand-written at THREE sites in stages.mjs (numbers dropped: a HISTORICAL find) and again in the tool
 * result above, each a near-copy with its own wording, all four telling the seat to type `receipt_id`.
 * Changing the form's contract in one of them would have left three prompts ordering the opposite of
 * what the driver now reads — a model handed two contradictory orders picks one, and which one is not
 * knowable from the code.
 *
 * The precedent is in this file's own lane and is quoted here because it is the same defect one layer
 * up. stages.mjs's own comment on the schema it deleted: "one of THREE copies of one shape bound by
 * nothing — the other two were in the tool result and the rendered skill". removed the duplicated
 * SCHEMA and left the duplicated INSTRUCTION standing. This removes that.
 *
 * The three sites differed in wording, not in meaning, and the differences were drift rather than
 * design: one asked for "one line", two for "one line saying what the receipt says and why it reads that
 * way". The stronger reading is kept for all three. What genuinely varies is the form path, whether the
 * seat owns a half (which can own no queries at all), and whether this lane writes a findings file.
 *
 * @param {object} [opts]
 * @param {string} [opts.lead]     the opening clause — the only place a caller may differ in tone
 * @param {boolean} [opts.mayOwnNoQueries] this seat may own zero meaning queries, so there may be
 *                                         nothing to record at all. NOT "is a half seat" — see below.
 * @param {boolean} [opts.findingsTail] append the Finding + driver-renders-the-table sentence
 * @returns {string} one paragraph, no trailing newline
 * PURE.
 */
export function meaningSweepReceiptsInstruction({
  lead = "MEANING-SWEEP RECEIPTS:",
  mayOwnNoQueries = false,
  findingsTail = true,
} = {}) {
  return [
    `${lead} when the grid tool returns, its result lists every meaning obligation you owe — one row per`,
    "obligation, each with its own candidate receipts.",
    // BOTH ROW KINDS, NAMED. taught the doctrine what a recurrence row is; this text still described
    // only the query rows and their singular `query`, so the seat met rows it had never been told
    // existed — carrying `queries` as a LIST and a receipt already resolved. A seat that does not know a
    // row kind cannot rule it, and common-law-half:m has never once come back first-attempt clean.
    "Most rows carry a single `query` and that query's own results. Some carry `kind: \"recurrence\"`: a",
    "result the sweep surfaced across several DISTINCT queries, whose `queries` field is a LIST of them",
    "and whose receipt the driver has already resolved — so they take no `receipt_index` from you.",
    "Rule those too — one ruling each, under the recurrence itself; you do not choose a query for them",
    "and you do not choose their receipt.",
    // B — THE SEAT SENDS VALUES; THE DRIVER WRITES THE DOCUMENT. You record rulings by CALLING the
    // `record_dispositions` tool, never by writing or editing a file: a model once hand-typed a 140 KB
    // JSON document, one row's delimiters were typographic quotes, and 74 correct rulings were voided by
    // a quote character. The tool validates each row as it arrives and keeps what validates.
    "Record every ruling by calling the `record_dispositions` tool — never by writing or editing a file.",
    "Pass `grid_spec_path` (the same driver-written spec path the grid tool was given) and `rows`, one",
    "entry per obligation: `row_index` (the NUMBER printed beside that obligation in the obligations",
    "block), `receipt_index` (the POSITION of the candidate you ruled on in that row's own list — 1 for",
    "the first, 2 for the second, and so on),",
    `\`ruling\` exactly ${RULINGS.join(" / ")}, and \`note\` — one line saying what the receipt says`,
    "and why it reads that way.",
    ...POINT_DIRECTIVE,
    // — THE EXIT FROM THE PROOF, ORDERED HERE BECAUSE A SEAT CAN ONLY TAKE AN EXIT IT IS TOLD ABOUT.
    // One production run died on a single row refused 217 times, every refusal an evidence-duty one: the
    // seat had its ruling and could not copy a fragment that binds. It kept trying because trying again
    // was the only move the instruction gave it. This is scoped hard to the PROOF — a row that cannot be
    // judged is ruled `loaded` per the skill, and saying so twice would make `obstacle` the easier road.
    "If a row is genuinely impossible to evidence — every passage an elision marker, nothing quotable in",
    "any of them — send `obstacle`: one line saying what stops you, ALONGSIDE your `ruling` and `note`,",
    "never instead of them. That row is then recorded as undecided with your sentence in place of proof,",
    "and the sweep completes rather than stalling on it. Try first: any passage with text in it will do,",
    "and a few characters is enough — `obstacle` is for the receipt that offers nothing, not the awkward one.",
    // The two sentences below are why the position is safe to ask for, and both were learned the hard
    // way: an id is 8 characters to copy exactly and one mistyped id used to discard a whole artifact.
    "You never type an id — the driver resolves the position to the id and records it for you.",
    "A row listed with exactly ONE receipt is already resolved: it takes no",
    "`receipt_index` — give that row only your `ruling` and `note`.",
    "Rows that validate are KEPT even when others in the same call are refused, and the tool's answer",
    "names every obligation still outstanding and which of them owe a `segment_index` and `fragment`.",
    "Your rulings ACCUMULATE",
    "across calls and across attempts: a row you have ruled on stays ruled, so nothing already answered",
    "needs redoing — send only what the answer reports outstanding.",
    // THE OPTION WAS `half`, AND `half` IS A PROXY FOR THE WRONG THING.
    //
    // The sentence explains a real condition: a seat that owns no meaning queries owes no rulings — the
    // grid tool lists it no obligations and `record_dispositions` refuses a half that owes nothing.
    // Halves a and b genuinely hit it, and without the explanation the absence reads as missing work and
    // the seat invents some.
    //
    // But it was keyed on BEING A HALF, and every half-lane call site passes that literal — so the
    // meaning seat, which by construction always owns meaning queries, read a sentence ending "you fill
    // in nothing" while owing 74 rulings. The condition was wrong by construction for exactly one seat,
    // and it was the seat that has never come back first-attempt clean.
    //
    // Keyed on the OBLIGATIONS now, which is the thing the sentence is actually about. Same family as
    // the rest of this bundle: a decision taken on a surface token while the thing itself says the
    // opposite ('s axis outcome, 's status code, 's trailing default, 's deleted arm).
    ...(mayOwnNoQueries ? ["Your half may own zero meaning queries. If so the grid tool lists you no"
      + " obligations, and recording nothing is the complete and correct outcome for you — do not invent"
      + " rulings and do not create any dispositions file."] : []),
    ...(findingsTail ? ["A loaded reading ALSO becomes a Finding in your findings file, and the driver renders the",
      "disposition table into the canonical findings — do not hand-write that table."] : []),
  ].join(" ");
}

/**
 * The human-readable disposition table, rendered by the DRIVER from the seat's structured rows — the
 * document a lawyer reads is unchanged in kind, and nothing in it is a string the model had to copy.
 * Rows whose id resolves to a recorded receipt render with that receipt's real title and URL (taken from
 * the ledger, not from the seat); an unresolvable id renders as itself, because hiding it would hide the
 * defect. Returns "" when there is nothing to render. PURE.
 */
export function renderDispositionTable(rows, ob) {
  const byId = new Map();
  for (const e of ob?.queries ?? []) for (const r of e.results) if (r.id) byId.set(normId(r.id), r);
  // — the rows are the FORM's, and a row the seat never ruled on has nothing to render: it is
  // outstanding work, which the gate reports as a count, not a table row reading "—".
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const usable = (rows ?? []).filter((d) => d?.receipt_id && d?.ruling);
  // ── — A PARKED ROW IS NOT AN OUTSTANDING ROW, AND THE FILTER ABOVE STOPPED BEING SAFE ─────────
  //
  // The line above is correct for its original subject and the comment says why: an unruled row is
  // outstanding work, the stage FAILS while any remains, and nothing ships — so a table row reading "—"
  // would be noise about a document no reader ever sees.
  //
  // The park broke that premise. A parked row is undecided AND the stage completes, so the document IS
  // delivered — and `ruling` is null on it, so this filter silently dropped it. The reader received a
  // table that looks complete, with the one obligation nobody could decide simply absent. No gap, no
  // marker, nothing to notice. That is 's lying receipt reached by the shortest path there is.
  //
  // Rendered as its OWN block rather than as rows of the ruling table, deliberately: an undecided row
  // sitting in a column headed "Ruling" is read as a ruling, whatever the cell says.
  const parked = (rows ?? []).filter((d) => d?.parked === true);
  const parkedBlock = parked.length ? [
    "",
    "### Meaning obligations left UNDECIDED",
    "",
    `${parked.length} of ${(rows ?? []).length} obligation(s) could not be ruled. They are listed here because a`,
    "sweep that omitted them would read as complete. Each is unresolved evidence, not a clean result.",
    "",
    "| Query | Receipt | Why it is undecided |",
    "|---|---|---|",
    ...parked.map((d) => {
      const r = byId.get(normId(d.receipt_id));
      const q = d.kind === "recurrence" ? `(recurred across ${d.queries?.length ?? "several"} queries)` : d.query;
      const kind = String(d.parked_kind ?? "").trim() || "exhausted";
      const why = String(d.parked_reason ?? "").trim() || "no reason was recorded";
      return `| ${cell(q)} | ${cell(r ? (r.title || r.url) : (d.receipt_id || "(no receipt)"))} | ${cell(`${kind}: ${why}`)} |`;
    }),
  ] : [];
  // NOT `if (!usable.length) return ""` any more: a sweep whose ONLY outcome was parks would have
  // rendered nothing at all, which is the same disappearance one level up.
  if (!usable.length && !parked.length) return "";
  if (!usable.length) return ["## PR / reputational risk — meaning-sweep dispositions (driver-rendered)",
    "", "No obligation in this sweep could be ruled.", ...parkedBlock, ""].join("\n");
  return [
    "## PR / reputational risk — meaning-sweep dispositions (driver-rendered)",
    "",
    `Every recorded meaning query that returned results, the receipt it was ruled on, and the ruling. Rendered`,
    `by the driver from the seat's structured dispositions; the receipt titles and URLs come from the tool-written`,
    `grid ledger, never from prose.`,
    "",
    "| Query | Receipt | Source | Ruling | Note |",
    "|---|---|---|---|---|",
    ...usable.map((d) => {
      const r = byId.get(normId(d.receipt_id));
      // A recurrence row carries no single query of its own — it is owed BECAUSE the sweep surfaced it
      // across four or more. Name that, rather than printing an empty cell the reader has to interpret.
      const q = d.kind === "recurrence" ? `(recurred across ${d.queries?.length ?? "several"} queries)` : d.query;
      return `| ${cell(q)} | ${cell(r ? (r.title || r.url) : "(id not in this ledger)")} | ${cell(r?.url ?? d.receipt_id)} | ${cell(d.ruling || "—")} | ${cell(d.note)} |`;
    }),
    ...parkedBlock,
    "",
  ].join("\n");
}

// Attributed to a violation when the doc carries NO PR/reputational/connotation section at all. An explicit,
// stable label — never null/undefined, which would print as "undefined" inside a failure token.
const NO_POLICED_SECTION = "(no PR / reputational / connotation section)";

// ── — TWO REASONS, BECAUSE THERE ARE ONLY TWO THINGS LEFT THAT CAN GO WRONG ──────────────────
//
// Eight reasons collapse to two, and the deletions are not tidying: each named a way TRANSCRIPTION could
// fail, and nothing is transcribed any more.
//   undisposed_cite_absent / undisposed_no_ruling / recurrent_uncited → `no_ruling`. One state: the row
//     exists in the form and carries no ruling this gate accepts.
//   undisposed_unknown_receipt                                        → `form_damaged`. The seat named an
//     id that is not among THAT row's own candidates — the driver wrote those ids, so this is a damaged
//     form, not outstanding work, and its remedy is different.
//   undisposed_cite_too_short   deleted — cannot occur; nothing is retyped.
//   recurrent_uncited_form      deleted — the form has no shape for the seat to get wrong. 's
//     cited-but-unbound state was a property of PROSE (right page, wrong query string on the line); a
//     form row IS its binding, so the state has no representative.
//   no_source_cite              deleted — advisory, prose-only, never reached a token.
// `no_recorded_queries` STAYS as its own reason and its own token (connotation_search_missing): a sweep
// that did not RUN is a different failure from a sweep that was not ruled on, and keeping them apart is
// what makes the warm lane safe (gateway.mjs WARM_ELIGIBLE_RE).
//
// 's lesson survives the collapse and is the reason `form_damaged` is not folded into `no_ruling`:
// the gate must never destroy a completed clearance by conflating "did not do the work" with "wrote the
// answer in a shape that did not bind". Under the form the second class is a two-field correction the
// seat can finish, and the union means the rest of its work cannot be lost while it makes it.
//
// ── — THE REASON VOCABULARY IS EXPORTED, SO A TOOL CAN BIND TO IT INSTEAD OF RETYPING IT ────────
//
// An external probe script imported this very validator and then filtered its output on the
// string literal `"undisposed_query"` — a reason that stopped existing when split it into
// `undisposed_cite_too_short` / `undisposed_cite_absent`. The import kept working. The literal went
// stale in silence, and the probe printed `=== 0 undisposed ===` over evidence carrying 10 and 3.
//
// Nothing pinned the tool to the code it read, and that is the defect — not the three tools that were
// caught. A probe that imports this constant cannot go stale without failing loudly, and
// connotation-reason-vocabulary.test.mjs breaks CI if a reason is added, renamed or removed without
// this list following it. (It has already earned that twice: added two reasons, removed six.)
//
// CLOSED. Every value findConnotationViolations can put in `reason`, and nothing else.
// ADDED `quote_unbound` — the fourth, and the reason it is a reason. `undisposed_cite_absent` was
// folded into `no_ruling` by on the premise that "nothing is transcribed any more". That premise is
// true of the receipt_id, which the driver writes. It is NOT true of the QUOTE: `quote_required` means
// exactly "copy this text out of the snippet by hand, verbatim", and quoteJoins then checks the
// transcription with `includes()`. It is the one field on the form the seat must still transcribe, and
// its failure reason was deleted as though it could not happen. R6 died of that deletion.
//
// It is its own reason and not a `detail` on `no_ruling` because the two have different remedies and the
// hint is routed on the token: "add a ruling" sent to a seat that has ruled is a closed loop.
// CARRIES THE SAME ARGUMENT ONE CLAUSE FURTHER, ON THE EVIDENCE THAT 's FIX DID NOT REACH.
// R6 died three times on `no_ruling=75` over a 75-row form. The seat held a 144-line findings document it
// had just written, was told "75 rows carry no ruling", saw 75 rulings in the document in front of it, and
// changed nothing. It had written THE WRONG ARTIFACT: the disposition form was the deliverable and the
// message never named a file, so there was no way to learn that from the message. A fresh session after
// the park filled all 75 rows in 243 seconds — the work was never hard, the instruction was never
// findable. `no_ruling` fires identically whether a row carries no ruling token, a ruling with no
// receipt, or NOTHING AT ALL because the form was never opened, and those have different remedies.
//
// THE SPLIT IS STRICTLY NARROWER, exactly as 's was. Every state below failed before and fails now;
// `no_ruling` survives as the residual so nothing can fall out of the vocabulary. The whole-population
// collapse states of the retired hand-edited form (`form_untouched`, `form_unparseable`) died with the
// form path — their subject matter is carried by the call audit's own states below, read from the run's
// call records rather than inferred from file bytes.
export const CONNOTATION_REASONS = Object.freeze([
  "no_recorded_queries",   // the spec dictated a meaning sweep and the ledger recorded none
  "token_absent",          // — the row carries no ruling token this gate accepts
  "cite_absent",           // — the row is ruled and noted, and names no receipt_id
  "no_ruling",             // the residual: a form row carries no ruling this gate accepts (see isRuled)
  "quote_unbound",         // — the row IS ruled; only its quote does not join (see quoteBinding)
  "form_damaged",          // the accumulator is unreadable, or a row names an id that is not its own candidate
  "parked",                // / — the row is UNDECIDED and accounted for: not ruled, not owed
  // ── B — THE TYPED TRANSPORT'S OWN FOUR, and they JOIN this list rather than starting a second one ──
  //
  // The typed call removed the hand-authored document, and with it the only two states a hand-authored
  // document can privately be in: `form_untouched` ( — N rows, not one seat field set anywhere) and
  // `form_unparseable` ( — the seat's own submission did not parse). Both DIED with the form path;
  // their subject matter moved rather than vanished — a seat that recorded nothing is `call_never_made`,
  // and a submission destroyed in flight is `call_schema_violation` or `call_truncated`, each read from
  // the run's own call records. A transport whose new failures are unnamed is not safer than the one it
  // replaced, only quieter. Each carries ONE cause and ONE remedy — `form_damaged` carried two, and its
  // corrective sent a seat whose JSON had broken to go and fix a receipt id.
  //
  // They are members HERE because they are failures of this stage, and `connotation_` is applied to them
  // by the same composition every other reason goes through. The first draft named them
  // `disposition_call_*`, a parallel family for four states this one already covers — a string-collision
  // check passes that draft cleanly, because a new prefix collides with nothing precisely by being new.
  "call_never_made",       // rows are owed and no call was ever STARTED — an absence, made into a finding
  "call_truncated",        // a call started and never returned; its rows were never recorded. Ours, not the seat's
  "call_schema_violation", // calls arrived and not one row was accepted from any of them — the payload SHAPE
  "call_partial",          // rows landed and obligations remain; what is recorded is KEPT
]);

// ── THE FAMILY, EXPORTED, SO A NEW REASON CANNOT GO INVISIBLE AT A ROUTING SITE ──────────────────────
// Five consumers route on the literal `connotation_(no_ruling|quote_unbound|form_damaged)`: the warm
// allowlist, the two repair-sibling derivations, the merge-gate remedy channel and the corrective hint.
// A reason added without all five following it is not an error anywhere — the token simply matches
// nothing, the repair is aimed at the findings document instead of the form, and the ladder spends its
// attempts repairing a file the validator never re-reads. That is the same silent-staleness shape
// exported this vocabulary to end, one level up: bind to the list, never retype it.
//
// `no_recorded_queries` is DELIBERATELY ABSENT and must stay absent. Its token is `connotation_search_
// missing`, its remedy is "run the sweep", and keeping it out of this family is precisely what makes the
// warm lane safe (see WARM_ELIGIBLE_RE's block in gateway.mjs). This list means one thing: the sweep RAN,
// and what is wrong is the driver-written form the seat fills in.
export const CONNOTATION_FORM_REASONS = Object.freeze(
  CONNOTATION_REASONS.filter((r) => r !== "no_recorded_queries"));

/**
 * The reasons that mean ONE THING: this obligation is still outstanding. Before that was the single
 * reason `no_ruling`, and every reader filtering on the bare string got the whole set for free. After the
 * split a reader that still filters on `no_ruling` sees the residual only — which on the failure this
 * issue is about reports ZERO over a form nobody opened. Exported so the readers bind to the set instead
 * of retyping three of its four members: the audit census, the ladder's monotonicity check and the
 * disposition union all ask this question and none of them cares which clause refused.
 *
 * `quote_unbound` and `form_damaged` are deliberately absent: those rows ARE ruled.
 *
 * `parked` (/) is absent for the opposite reason and it is the load-bearing one: a parked row
 * is NOT ruled, and it is not outstanding either. Outstanding means "the seat still owes this", and the
 * whole point of the park is that the seat has been told to stop — leaving it here would keep the stage
 * failing forever on a row nobody may re-send, which is the deterministic death the park introduced.
 * It stays a census row so that every summarising seam can see it; being seen is the CONDITION of its
 * being accepted, never a consequence of it.
 */
export const CONNOTATION_UNRULED_REASONS = Object.freeze(
  ["token_absent", "cite_absent", "no_ruling"]);

/**
 * THE AUDIT'S THREE NUMBERS, DERIVED ONCE. `recordConnotationAudit` writes these onto every run and the
 * next round reads them; before it filtered on the bare string `no_ruling`, which after the split
 * would have reported `obligationsNeverAddressed: 0` over a form nobody opened — an absence reading as a
 * pass, on the exact failure this issue is about. Extracted here because it had NO test at all: the
 * number is only checkable when the derivation is separable from the file IO around it.
 * PURE.
 */
export function connotationAuditCounts(violations) {
  const v = violations ?? [];
  return {
    didNotBind: v.filter((x) => x?.reason === "form_damaged").length,
    neverAddressed: outstandingObligations(v),
    quotesUnbound: v.filter((x) => x?.reason === "quote_unbound").length,
    // — THE FOURTH NUMBER, because a parked row was in NONE of the three above. `neverAddressed`
    // counts the UNRULED reasons and `parked` is deliberately not one of them (a parked row is not owed),
    // so the audit reported zero problems over an obligation nobody decided — the round after this one
    // reads these numbers. Split by kind for the one measurement that says whether the honest exit works:
    // if seats take it, `exhausted` should fall toward zero while `declared` carries the same rows.
    parked: v.filter((x) => x?.reason === "parked").length,
    parkedDeclared: v.filter((x) => x?.reason === "parked" && x?.parked_kind === "declared").length,
  };
}

/** How many obligations a violation list leaves outstanding — the count `no_ruling`'s length used to be. */
export function outstandingObligations(violations) {
  let n = 0;
  for (const v of violations ?? []) {
    if (CONNOTATION_UNRULED_REASONS.includes(v?.reason)) n += 1;
  }
  return n;
}

/** `connotation_<form reason>` as a regex SOURCE — interpolated into the consumers' own patterns. */
export const CONNOTATION_FORM_TOKEN_SRC = `connotation_(?:${CONNOTATION_FORM_REASONS.join("|")})`;
/** The same, as a regex. Matches anywhere in a fail string. */
export const CONNOTATION_FORM_TOKEN_RE = new RegExp(CONNOTATION_FORM_TOKEN_SRC);

/**
 * Which obligation a form row answers. Query rows key on the normalized query, recurrence rows on the
 * normalized receipt id — the two identifiers the seat never has to type, since the driver wrote both.
 * PURE.
 *
 * THE KEY IS MANY-TO-ONE AND IT HAS TO BE. `normText` folds curly quotes and dashes, so a seat that
 * re-emitted the file from its own reading and typed `KOFF’RA gang` still answers the row recorded as
 * `KOFF'RA gang`. That tolerance is the point of the key and it is kept. What it costs is that two
 * DISTINCT recorded queries differing only in foldable punctuation share ONE key — which is why the row
 * ID is minted from the raw query instead (obligationRows) and why the lookup below resolves a key to
 * many rows rather than to one.
 */
export function formRowKey(row) {
  return String(row?.kind ?? "").trim() === "recurrence"
    ? `x:${normId(row?.receipt_id)}`
    : `q:${normText(row?.query)}`;
}

/**
 * THE ONE LOOKUP FROM A CANONICAL OBLIGATION TO THE FORM ROW THAT ANSWERS IT — used by the gate below AND
 * by disposition-union.mjs. It was two last-wins Maps, written out twice, and the duplication hid a defect
 * that survived a full review: `normText` folds punctuation, so `KOFF'RA gang` and `KOFF’RA gang` are two
 * recorded queries, two obligations and ONE key. A Map has one slot per key, so at most one of the two
 * could ever be discharged — a correct seat ruling each row on its own candidate measured
 * `ruled=1/2, outstanding=1` across four consecutive attempts, a fixed point one short of total, and the
 * ladder ran out. Monotonicity held the whole way down; the run still went terminal.
 *
 * THREE RULES, AND THE THIRD IS THE ONE THAT COSTS SOMETHING TO GET WRONG:
 *   1. The driver's row id first. It is unique per obligation (obligationRows) and the seat never types it.
 *   2. A row that BINDS wins over one that does not, wherever it was found — so two rows sharing a folded
 *      key each discharge their own obligation, which is what origin/main's list semantics did and what
 *      the Map lost.
 *   3. When the key is AMBIGUOUS — two obligations share it — and nothing bound, the answer is NOTHING.
 *      This is the rule that costs something to get wrong. Handing an unbound row to the second of two
 *      twins would report `form_damaged` on a row the seat never touched, naming an id that is not the
 *      reader's problem; and worse, the union's field-wise carry would write that foreign `receipt_id`
 *      into the ACCUMULATOR, where it persists. The next attempt then opens a row pre-filled with a
 *      receipt that can never bind, is told to change nothing else, and the row is a permanent fixed
 *      point — the failure class this whole change is fixing, re-created by its own fix. `no_ruling` on
 *      an untouched row is the honest reason and it leaves the carry clean.
 *
 * WHICH KEYS ARE AMBIGUOUS IS A FACT OF THE OBLIGATIONS, not of what the seat handed back, so the
 * canonical rows are the second argument. Omitted, no key is ambiguous — the pre-review behaviour, kept
 * only so a caller without an obligation set cannot be silently wrong about one.
 *
 * Takes a form object, a bare row array, null or junk — an absent form and a damaged one are NORMAL
 * inputs here, so neither may throw and neither may be the reason a lookup does not run. PURE.
 *
 * @param {Array|{rows:Array}|null} rows       the form rows to search (seat-submitted or prior)
 * @param {Array|{rows:Array}|null} canonical  the driver's regenerated obligation rows
 * @returns {(canonical:object) => object|undefined}
 */
export function formRowFinder(rows, canonical = []) {
  const listOf = (x) => (Array.isArray(x) ? x : (Array.isArray(x?.rows) ? x.rows : []));
  const byId = new Map(), byKey = new Map();
  const push = (m, k, r) => { if (!k) return; const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  for (const r of listOf(rows)) {
    if (!r || typeof r !== "object") continue;
    push(byId, String(r.row_id ?? "").trim().toUpperCase(), r);
    push(byKey, formRowKey(r), r);
  }
  const seen = new Set(), ambiguous = new Set();
  for (const c of listOf(canonical)) {
    if (!c || typeof c !== "object") continue;
    const k = formRowKey(c);
    if (seen.has(k)) ambiguous.add(k); else seen.add(k);
  }
  return (row) => {
    if (!row) return undefined;
    const key = formRowKey(row);
    const ids = byId.get(String(row.row_id ?? "").trim().toUpperCase()) ?? [];
    const keys = byKey.get(key) ?? [];
    // The BOUND search always scans both, ambiguity included: twins carrying the same candidate set are
    // both answered by one row, and refusing that would invent an outstanding obligation.
    const bound = [...ids, ...keys].find((r) => isRuled(r, row));
    if (bound) return bound;
    if (ids.length) return ids.length === 1 ? ids[0] : undefined;
    if (ambiguous.has(key)) return undefined;
    return keys.length === 1 ? keys[0] : undefined;
  };
}

// The spot-check budget. THREE, and the number is the design's: enough that a seat cannot ignore the
// check, few enough that it is never the reason a clearance dies. The driver picks WHICH three.
export const QUOTE_SPOT_CHECKS = 3;

/**
 * The obligation set as the DRIVER-WRITTEN FORM's rows — the same object connotationObligations returns,
 * in the shape the seat fills in. One calculation, two shapes, never two calculations: the render, the
 * form and the gate all read this, so a row the gate can flag is by construction a row the seat was
 * handed.
 *
 * Driver-owned: row_id, kind, query/queries, candidates, quote_required. Seat-owned: receipt_id, ruling,
 * note, quote. A recurrence row's receipt_id is PRE-FILLED because there is exactly one receipt it can
 * name — there is nothing there for a seat to choose or to get wrong.
 *
 * THE SPOT-CHECK ROWS ARE PICKED BY THE DRIVER, DETERMINISTICALLY — sorted by the fnv1a64 of the row id,
 * lowest first. Same ledger, same rows, every regeneration and every replay: the seat cannot choose its
 * own three, and a re-run cannot shop for an easier set. Only rows with a candidate carrying a usable
 * captured snippet are eligible, so on every archived run — where no snippet was ever captured — ZERO
 * rows are quote-required and the replay is unaffected. That is deliberate: the spot-check proves out on
 * fresh runs and never blocks a replay.
 *
 * Snippets ride ONLY on the rows that are quote-required. The seat needs the text it must quote from and
 * nothing else; carrying every snippet on all 62 rows would triple the form for no gain.
 * PURE; never throws.
 */
export function obligationRows(ob, { spotChecks = QUOTE_SPOT_CHECKS } = {}) {
  // — THE SEGMENTS ARE SHOWN, NUMBERED, OR THE POINTER ASKS FOR A POSITION INTO A LIST NOBODY SAW.
  //
  // `segment_index` is a position into THIS array, written here by the driver and read back by
  // `segmentBinding` through the same `snippetSegments`. One derivation, both ends — the display and the
  // check cannot disagree, which they would the moment either recomputed its own split.
  //
  // 's defect is the one this avoids, arriving from the other direction: a seat ordered to set a
  // field it was never shown the values for. `receipt_index` is safe precisely because the candidate list
  // is in front of the seat; a segment ordinal is only safe on the same terms.
  //
  // The raw `snippet` STAYS beside them. The segments are the addressable form, the snippet is the text as
  // captured, and a seat reading the passage in context is the point of showing it at all.
  const cand = (r, id) => {
    const snippet = String(r?.snippet ?? "").trim();
    return { receipt_id: id, title: String(r?.title ?? "").trim(), url: String(r?.url ?? "").trim(),
      snippet, segments: snippetSegments(snippet) };
  };
  const rows = [];
  for (const e of ob?.queries ?? []) {
    const queryCands = e.results.filter((r) => r.id).map((r) => cand(r, r.id));
    rows.push({
      // THE ID IS MINTED FROM THE RAW RECORDED QUERY; THE KEY IS FOLDED. `formRowKey` normalises
      // punctuation so a retyped query still matches, and that fold is many-to-one: `KOFF'RA gang` and
      // `KOFF’RA gang` are two recorded queries — parsePrRiskResults dedupes on the EXACT trimmed string,
      // so both survive and both owe a row — with one folded key between them. Minting the id from the key
      // gave the two rows ONE id, and an id that identifies two rows identifies neither: at most one could
      // be discharged, and a `form_damaged` naming it had no followable remedy.
      //
      // The raw string is injective over this set BY CONSTRUCTION — parsePrRiskResults keys `byQuery` on
      // `e.query.trim()`, so two entries here cannot carry the same raw query — and it is as stable as the
      // ledger bytes, which is what a replay re-reads. The `q!` sigil is not `formRowKey`'s `q:` on
      // purpose: the two namespaces are different questions and must not be confused for each other.
      row_id: shortId("Q", `q!${e.query}`),
      kind: "query",
      query: e.query,
      candidates: queryCands,
      quote_required: false,
      // M1 — ONE CANDIDATE IS PRE-FILLED, and the rule is the recurrence rule with its `kind`
      // condition dropped. A recurrence row was already pre-filled "because there is exactly one receipt
      // it could name"; that reason is about the COUNT, not about the kind, and query rows hit it too —
      // 19 of 81 on the measured form. Pre-binding by construction at exactly one, never as a tiebreak.
      receipt_id: queryCands.length === 1 ? (queryCands[0].receipt_id || null) : null,
      ...SEAT_SLOTS(),
    });
  }
  for (const x of ob?.recurrent ?? []) {
    rows.push({
      row_id: shortId("X", `x:${normId(x.id)}`),
      kind: "recurrence",
      queries: x.owners.map((o) => o.query),
      candidates: [cand(x.result, x.id)],
      quote_required: false,
      receipt_id: x.id,
      ...SEAT_SLOTS(),
    });
  }
  const eligible = rows.filter((r) => r.candidates.some((c) => usableSnippet(c.snippet)));
  // BigInt compare, not subtraction: fnv1a64 returns a 64-bit BigInt and a numeric sort comparator over
  // one would coerce and collide. Ties break on the id itself, so the order is total.
  eligible.sort((a, b) => {
    const ha = fnv1a64(a.row_id), hb = fnv1a64(b.row_id);
    return ha < hb ? -1 : ha > hb ? 1 : (a.row_id < b.row_id ? -1 : a.row_id > b.row_id ? 1 : 0);
  });
  for (const r of eligible.slice(0, Math.max(0, spotChecks))) r.quote_required = true;
  for (const r of rows) if (!r.quote_required) for (const c of r.candidates) delete c.snippet;
  return rows;
}

/**
 * Find meaning-sweep obligations the seat has not ruled on, and a dictated sweep that never ran.
 *
 * ARMED ON DATA, NEVER ON PROSE (, owner's ruling 2026-08-04). `opts.recorded` being passed is the
 * whole arming condition and it is UNCHANGED by — the caller keys it on the grid-spec's own
 * `connotation.disposition_required` stamp, a structural fact the DRIVER writes and no model can redraft
 * away. Two consequences, both deliberate and both load-bearing:
 *   - `recorded` null/absent (pre-P2-C archived specs) leaves every arm below OFF. Replay verdicts on
 *     archived runs never flip. THIS IS A BACK-COMPAT INVARIANT — do not key the arm on anything else.
 *   - `recorded` passed and the document says nothing at all still checks the receipts. A missing section
 *     can no longer silence the gate: before  a doc with NO PR section matched no block, so DELETING
 *     the section passed, and the 2026-08-04 R2 run was DELIVERED with 52 recorded receipts and zero
 *     checked.
 *
 * THE FORM IS THE ONLY RULING ARTIFACT, and `form` null means there is no ruling artifact to judge —
 * NOT that every obligation is outstanding. That distinction is what keeps this replay-safe, and it is
 * the design's own (docs/design/meaning-sweep-form.md §6): no run in the archive carries a form, because
 * every one of them predates it, so a replay that treated absence as failure would flip every historical
 * verdict at once and the corpus gate would stop being able to tell an intended change from a mistake.
 * The absence cannot become a live hole, because on a fresh run the driver writes the form itself — at
 * the moment the grid returns (perplexity-server.mjs), before EVERY judgement (gateway.mjs) and at the
 * merge (pipeline.mjs) — so a seat cannot reach a pass by deleting it. Whether an archived run WOULD
 * have passed under the form is a question for a reconstruction, not for the gate.
 *
 * @param {string} commonLawContent  the findings text — read ONLY to attribute a violation to a section
 * @param {number} prRiskCount       recorded extras.pr_risk queries (parsePrRiskQueries)
 * @param {{recorded?: Array|null, form?: Array|null, formError?: string|null}} [opts]
 * @returns {Array<{section:string, reason:typeof CONNOTATION_REASONS[number],
 *                  row?:string, query?:string, result?:string, id?:string, detail?:string, count?:number}>}
 */
// THE CALL REASONS THIS MODULE WILL EMIT, as literals, and the audit's verdict is matched against them
// rather than trusted. Two things follow from writing them out here instead of forwarding a string:
//
//   · a reason this module does not know is REFUSED, not emitted. A token nothing declares is a token no
//     corrective covers and no probe filters on, and it would reach a seat as a bare word.
//   ·  reads this module's own source for what it can emit, so the literals have to be IN it.
//     Forwarding `callAudit.reason` would have passed that guard while emptying it — the vocabulary
//     would say four things are possible and the source would prove none of them.
const CALL_AUDIT_ROWS = Object.freeze({
  call_never_made: { reason: "call_never_made" },
  call_truncated: { reason: "call_truncated" },
  call_schema_violation: { reason: "call_schema_violation" },
  call_partial: { reason: "call_partial" },
});

export function findConnotationViolations(commonLawContent, prRiskCount = 0, { recorded = null, form = null, formError = null, callAudit = null } = {}) {
  const violations = [];
  if (recorded == null) return violations;
  // Which section a receipt violation is attributed to. DIAGNOSTIC ONLY — no failure token is built from
  // it — but it must never be null/undefined, which would print as "undefined" inside one.
  let firstPoliced = null;
  for (const ln of String(commonLawContent || "").split("\n")) {
    const h = ln.match(/^#{2,4}\s+(.*)/);
    if (h && firstPoliced == null && SECTION_RE.test(h[1])) firstPoliced = h[1].trim();
  }
  const section = firstPoliced ?? NO_POLICED_SECTION;
  // The load-bearing "did the search even run" check, on the structural fact rather than on a stock phrase.
  if (!(Number(prRiskCount) > 0)) violations.push({ section, reason: "no_recorded_queries" });
  const canonical = obligationRows(connotationObligations(recorded));
  if (!canonical.length) return violations;
  // Present-and-unparseable is a NAMED defect, never an absence (an absence is a finding; a silently
  // empty parse is not). It is reported once, for the file — not once per row it could not carry.
  if (formError) { violations.push({ section, reason: "form_damaged", detail: String(formError).slice(0, 120) }); return violations; }
  // ── B — WHAT HAPPENED TO THE SEAT'S CALLS, and why the verdict ARRIVES rather than being computed ───
  //
  // Under the typed transport the seat writes no document, so the states that can go wrong are states of
  // the CALL: never made, killed mid-flight, refused wholesale, or half-finished. This function cannot see
  // any of them — the evidence is `_driver/tool-calls.jsonl` and the receiver's own call index, both files,
  // and this module reads none. `disposition-call-audit.mjs` reads them and hands the verdict in, exactly
  // as `submittedError` above is handed in for the same reason.
  //
  // THE REASONS ARE EMITTED HERE, LITERALLY, and that is not incidental. pins CONNOTATION_REASONS to
  // what THIS module's source can emit, so a reason declared and never assigned fails CI — which is how
  // `undisposed_query` outlived its subject. Building the four somewhere else while declaring them here
  // would have satisfied the letter of that guard and hollowed it out.
  //
  // Returned early, like the two above and for the same reason: when the calls did not land, a per-row
  // census describes the driver's own accumulator rather than anything the seat did.
  const callRow = CALL_AUDIT_ROWS[String(callAudit?.reason ?? "")];
  if (callRow) {
    violations.push({ section, ...callRow, count: Number(callAudit.count) || canonical.length,
      detail: String(callAudit.detail ?? "").slice(0, 200) });
    return violations;
  }
  if (form == null) return violations;
  // Rows are found by the driver's own row id first and by the obligation key second. Both are identifiers
  // the seat never had to type; the second exists because a seat that re-emits the whole file from its own
  // reading may drop the id, and losing a sound ruling over a field the seat was told not to touch is the
  // shape this build exists to end. ONE lookup, shared with the union — see formRowFinder for why it is
  // not two Maps written out here.
  const find = formRowFinder(form, canonical);
  // — the per-row verdicts are collected before any is reported, because ONE of the states is a
  // property of the WHOLE set (form_untouched) and cannot be decided a row at a time.
  const rows = [];
  for (const c of canonical) {
    const s = find(c);
    if (s && isRuled(s, c)) continue;
    const named = String(s?.receipt_id ?? "").trim();
    const ids = new Set(c.candidates.map((x) => normId(x.receipt_id)).filter(Boolean));
    const label = c.kind === "recurrence"
      ? String(c.candidates[0]?.url || c.candidates[0]?.title || "").trim()
      : c.query;
    // ── / — A PARKED ROW IS ACCOUNTED FOR, AND SAYING SO IS THE CONDITION OF ACCEPTING IT ─
    //
    // THE DEFECT THIS CLOSES, MEASURED NOT ASSUMED. The park was built at the disposition TOOL — it drops
    // the row from `outstanding` so the seat stops being asked for it — and this census, which decides
    // whether the findings DOCUMENT is accepted, never heard of it. Replayed on 32adfe1c with both
    // controls behaving (a properly ruled row PASSES, an unsubmitted row FAILS `token_absent`), a parked
    // row FAILED here: by the counter as `token_absent`, by seat declaration as `quote_unbound`.
    //
    // So the stage failed anyway, the ladder retried, and the seat COULD NOT FIX IT — the tool refuses
    // the row it has already parked. Byte-identical attempts, ladder breaks on repeat-signature. That is
    // the fatal sub-case documented at the head of this file: a retry can only escape a state the seat
    // believes is wrong. The park made a slow death deterministic.
    //
    // AND THE OBVIOUS FIX IS THE LYING RECEIPT. Simply `continue`-ing here would complete the
    // stage over an undecided obligation and let the document claim "73 processed, all benign" — which is
    // the P1 filed against this exact seam. So acceptance is CONDITIONAL on the row being reported: this
    // is not a violation the ladder acts on, but it IS a census row, and every summarising seam reads the
    // census. A parked row that is not surfaced must never reach a reader as a clean one.
    if (s?.parked === true) {
      const kind = String(s.parked_kind ?? "").trim() || "exhausted";
      // The seat's own sentence when it declared the park; the counter's when the bound earned it. Empty
      // is possible on a form written before this field existed, so it is never assumed present — every
      // park field is empty-string on a healthy row, which is why nothing here tests for the KEY.
      const why = String(s.parked_reason ?? "").trim();
      rows.push({ section, row: c.row_id, query: c.query, result: label, id: c.receipt_id ?? undefined,
        reason: "parked", parked_kind: kind,
        detail: `row ${c.row_id} is UNDECIDED and parked (${kind})${why ? `: ${why}` : ""} — it is not ruled, `
          + `and no count may report it as one` });
      continue;
    }
    if (named && !ids.has(normId(named))) {
      // A PLACEHOLDER ECHOED FROM AN EXAMPLE IS ALREADY REFUSED — it is never a candidate id — but the
      // stock sentence does not tell the seat WHAT it did, and a seat that cannot tell "I picked the
      // wrong receipt" from "I copied the shape of one" repeats the second forever. One production seat
      // wrote the literal `R-RECEIPT` into 27 rows because the prompt displayed `R-XXXXXXXX`; the
      // display is gone (renderConnotationObligations, SKILL.md), and this names the remaining case.
      rows.push({ section, reason: "form_damaged", row: c.row_id, query: c.query, result: label, id: named,
        detail: isPlaceholderReceipt(named)
          ? `receipt_id ${named} is a PLACEHOLDER, not a receipt — no row has it. Do not type an id at `
            + `all: set \`receipt_index\` to the candidate's POSITION in that row's own list (1, 2, …)`
          : `receipt_id ${named} is not a candidate of row ${c.row_id} — do not name an id at all: set `
            + `\`receipt_index\` to that candidate's POSITION in the row's own list (1, 2, …)` });
      continue;
    }
    // — WHICH clause of isRuled refused. Everything except the quote is `no_ruling`, exactly as
    // before. A row that satisfies every other clause and fails ONLY the quote join is a different state
    // with a different remedy, and telling it to add the ruling it already has is what killed R6.
    //
    // The order is load-bearing: this is reached ONLY when the row is otherwise ruled, so a genuinely
    // unruled row can never be reported as a quote problem. `quote_unbound` cannot mask missing work —
    // it is strictly narrower than the state it splits off from, which is what 's warning demands.
    const otherwiseRuled = s
      && RULING_SET.has(String(s.ruling ?? "").trim().toLowerCase())
      && String(s.note ?? "").trim()
      && ids.has(normId(s.receipt_id));
    if (otherwiseRuled && c.quote_required) {
      // M2, FINISHED (R5, 2026-08-14) — REPORT THE FIELD THE SEAT ACTUALLY WROTE.
      //
      // This read `quoteBinding(s.quote, …)` and nothing else, so a seat that supplied a good-faith
      // `anchor` was told its QUOTE was missing. R5's attempt-2 corrective contradicted itself inside one
      // paragraph: "Change the `anchor` field only" beside "every quote-required row's `quote`". The seat
      // cannot act on that, and it did not.
      //
      // The chooser is spotCheckBinds' own order, read the other way round: spotCheckBinds asks whether
      // EITHER route bound; this asks which route the seat TOOK, so the sentence names the field it will
      // find in the file. An anchor present but unbound is an anchor problem; only a row with no anchor
      // at all is reported against the quote — which is the archived/replay shape, and correct for it.
      const wroteAnchor = String(s?.anchor ?? "").trim() !== "";
      const b = wroteAnchor ? anchorBinding(s.anchor, c.candidates) : quoteBinding(s.quote, c.candidates);
      const field = wroteAnchor ? "anchor" : "quote";
      const detail = wroteAnchor ? ANCHOR_DETAIL[b.state] : QUOTE_DETAIL[b.state];
      rows.push({ section, reason: "quote_unbound", row: c.row_id, query: c.query, result: label,
        id: normId(s.receipt_id), quote_state: b.state, bound_field: field,
        near_receipt: b.receipt_id ?? undefined,
        detail: `row ${c.row_id} is ruled; its ${field} ${detail}` });
      continue;
    }
    // — WHICH CLAUSE OF isRuled REFUSED, for the clauses left collapsed. The order follows
    // isRuled's own, so the state named is the FIRST thing the seat has to fix and never a later one it
    // cannot reach yet. Each is strictly narrower than the `no_ruling` it splits off from.
    const base = { section, row: c.row_id, query: c.query, result: label, id: c.receipt_id ?? undefined };
    if (s && !RULING_SET.has(String(s.ruling ?? "").trim().toLowerCase())) {
      // — SAY WHICH TOKEN, AND SAY WHICH ONES ARE ACCEPTED. This arm reported the ROW and nothing
      // about the token, while `quote_unbound` twelve lines above carries a sentence naming the field and
      // its state. That asymmetry is the whole of why the two behave differently on retry: measured over
      // the preserved runs, `call_partial` and `quote_unbound` clear on a later attempt 21 times out of
      // 21, and `token_absent` clears 3 of 7 — it is the one that runs to the wall.
      //
      // A seat told "row X carries no ruling token this gate accepts" knows WHERE to look and nothing
      // about WHAT to change. If it wrote `neutral` where the vocabulary says `benign`, the message it
      // gets back is true, unactionable, and identical on every attempt — which is the shape one
      // clause over: the location was findable and the content was not.
      //
      // THE ACCEPTED SET IS INTERPOLATED FROM `RULINGS`, never retyped. It is already the single
      // constant the dispatch prose and the skill are ratcheted against, so a fifth ruling
      // reaches this message the moment it reaches the enum — and a message that taught a stale
      // vocabulary would be worse than one that taught none.
      const wrote = String(s.ruling ?? "").trim();
      rows.push({ ...base, reason: "token_absent",
        wrote_token: wrote || null,
        detail: wrote
          ? `row ${c.row_id} is ruled \`${wrote.length > 40 ? `${wrote.slice(0, 40)}…` : wrote}\`, `
            + `which is not a ruling this gate accepts — use exactly one of ${rulingsProse()}`
          : `row ${c.row_id} carries no ruling at all — set \`ruling\` to exactly one of ${rulingsProse()}` });
      continue;
    }
    if (s && String(s.note ?? "").trim() && !String(s.receipt_id ?? "").trim()) {
      rows.push({ ...base, reason: "cite_absent" });
      continue;
    }
    // THE RESIDUAL, AND IT HAS REPRESENTATIVES — do not delete it. Two states land here and neither is
    // one of the three above: the obligation row is not in the form AT ALL (a seat that re-emitted the
    // file from its own reading and dropped rows), and a row that is ruled and cited with an empty
    // `note`. Both are honestly described by "carries no ruling this gate accepts".
    rows.push({ ...base, reason: "no_ruling" });
  }
  violations.push(...rows);
  return violations;
}

// The near-miss sentence, per state. This is the half of that had to be said out loud: "the quote's
// start and end are both present but not contiguous is exactly the sentence that would have fixed this in
// one attempt." Short enough to survive the bounded failure token; the full remedy is the gateway arm.
// The same sentence, for the field the seat is now ORDERED to write. `anchorBinding` has no `split`
// state — you cannot stitch two passages with a pointer — and its `too_short` floor is ANCHOR_MIN, not
// QUOTE_MIN, so a shared map would have told a seat to lengthen an anchor to a bound that does not
// apply to it. The remedy sentence is the anchor's own: point at less, exactly.
const ANCHOR_DETAIL = Object.freeze({
  bound: "joins",  // unreachable from the branch above; present so a state can never render as undefined
  absent: "appears in none of that row's receipts — copy a few words out of one of them exactly as written",
  too_short: `is under the ${ANCHOR_MIN}-character minimum — point at a few more words`,
  missing: "is empty",
});

const QUOTE_DETAIL = Object.freeze({
  bound: "joins",  // unreachable from the branch above; present so a state can never render as undefined
  split: "appears in one receipt in two pieces, not as one continuous passage",
  absent: "appears in none of that row's receipts",
  too_short: `is under the ${QUOTE_MIN}-character minimum`,
  missing: "is empty",
});
