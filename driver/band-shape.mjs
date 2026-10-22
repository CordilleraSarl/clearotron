// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// band-shape.mjs — the DETERMINISTIC SHAPE of the merged register band (PR-8, Thread D1).
//
// The 2026-07-28 postmortem's lesson: the merged band is megabytes (median 5.2MB across the archive; Read hard-refuses
// >256KB), so judgment never read it whole — every stage sliced it with improvised, unreviewed shell
// (digest#2: 71 ad-hoc Bash calls). This module is the reading layer's frozen-plan equivalent: a PURE,
// deterministic projection of the band, served in parts once it outgrows one answer (the groups section grows
// with the band; the parts banner says how many), derived by the driver after EVERY named-band re-merge.
//
// What it is NOT: a relevance/sufficiency/materiality judgment. Tiers are MECHANICAL string classes
// (the same pure utils the form floor is built from — normalizers + doubleMetaphone); whether a
// same-family record matters is judgment's call, made over the shape + the band tools' record lookups.
// Machine checks (band validator, collapsed-slice fail, taint, band-truth gate, plan-execution join,
// form-oracle, crowd-context, lint) keep reading the COMPLETE band — the shape is judgment's map, never
// a substitute substrate for code.
//
// PROVIDER-NEUTRAL BY CONSTRUCTION (the binding constraint): classification and every shape key hang
// off the neutral record fields only — mark_text, classes, status, owner_name, screen.registry,
// screen.live_status, screen_verdict, the date fields, _query. NEVER score / poca_scores /
// onomaticsAggression / highlight / raw: those are one vendor's shape (the other nulls them), and a
// shape keyed on them would silently degrade on a provider swap.
//
// PURE (no node imports) like named-band.mjs / coverage-ledger.mjs — tests run offline.

import { normalizeElement, editNeighbourhood, consonantSkeleton, confusableSkeleton, foldDiacritics } from "./form-neighbourhood.mjs";
import { doubleMetaphone } from "./phonetic-key.mjs";
import { probeOrder } from "./order-probe.mjs";   // item 11 — inert unless CLEAROTRON_ORDER_PROBE_SEED is set
import { normKey } from "./placement-diff.mjs";
import { canonicalJurisdictionCode, KNOWN_JURISDICTION_CODES } from "./jurisdiction-codes.mjs";   // — one spelling per register: a band's "EM" and a market's "EU" are one office
import { bindingLayersFor } from "./binding-layers.mjs";
import { territoryKey } from "./territory-tiers.mjs";   // — a territory written as a name reads as its code   // — the registers that bind an ordered territory: its own, the EU's for a member, every member's for the EU, Benelux, Madrid   // — the set-aside key's owner fold: an owner is grouped the way a set-aside row covers it

export const BAND_SHAPE_SCHEMA_VERSION = 1;

/** The mechanical tiers, strongest first. `unclassifiable` = the classifier could not compare (no Latin
 *  skeleton survives normalization — a non-Latin script mark); it is a BLIND SPOT, never an "other". */
export const SHAPE_TIERS = ["identical", "near-identical", "same-family", "other", "unclassifiable"];

// Status words that mechanically read DEAD. Anything else — including unknown/absent — reads LIVE:
// the floors err toward listing a record, never toward dropping one (fail-safe direction).
const DEAD_STATUS_RE = /\b(expired|invalid|dead|abandon\w*|cancel\w*|withdraw\w*|laps\w*|removed|refus\w*|reject\w*|surrender\w*|inactive|ended)\b/i;

/** Mechanical liveness: screen.live_status when the funnel screened it, else the status word, else live. */
export function isLiveRecord(record) {
  const ls = String(record?.screen?.live_status ?? "").trim().toLowerCase();
  if (ls === "dead") return false;
  if (ls === "live") return true;
  const status = String(record?.screen?.status ?? record?.status ?? "").trim();
  if (!status) return true;                      // unknown ⇒ live (fail-safe: floors include it)
  return !DEAD_STATUS_RE.test(status);
}

// Non-Latin script detection (the script-gap blind-spot detector) — Unicode script classes, mechanical.
const SCRIPT_RES = [
  ["han", /\p{Script=Han}/u], ["hiragana", /\p{Script=Hiragana}/u], ["katakana", /\p{Script=Katakana}/u],
  ["hangul", /\p{Script=Hangul}/u], ["cyrillic", /\p{Script=Cyrillic}/u], ["greek", /\p{Script=Greek}/u],
  ["arabic", /\p{Script=Arabic}/u], ["hebrew", /\p{Script=Hebrew}/u], ["thai", /\p{Script=Thai}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
];

/** The non-Latin scripts present in a string (sorted, deduped). PURE. */
export function nonLatinScripts(s) {
  const text = String(s ?? "");
  return SCRIPT_RES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const tokensOf = (s) => String(s ?? "").split(/[^\p{L}\p{N}]+/u).map((t) => normalizeElement(t)).filter(Boolean);

/**
 * The ALTERNATIVE NAMES a label carries — `VENZAL / VENZALMONO / VENZALKOMB` is one relabelled entry,
 * `LUMIVANE & Device` is one mark plus a device note.
 *
 * The separator class is reference-score's `labelAliases`, character for character, and the two are
 * meant to stay that way: the scorer and the engine must agree about what a relabelling is, or a record
 * the score calls found is a record the engine never put on the floor. NOT a shared import — the scorer
 * strips corporate-suffix noise tokens for a measuring job the engine has no business doing, and
 * importing it would drag that in. What is shared is the RULE, stated in both places.
 */
export function aliasesOf(label) {
  return String(label ?? "").split(/[/,·&|]+/).map((part) => normalizeElement(part)).filter(Boolean);
}

/**
 * Precompute the per-target comparison material ONCE (edit-1 neighbourhoods are the expensive part —
 * per target, never per record). Accepts raw strings; blank/unnormalizable targets are dropped.
 */
export function prepareTargets(targets) {
  const out = [];
  const seen = new Set();
  for (const raw of targets ?? []) {
    const text = String(raw ?? "").trim();
    const norm = normalizeElement(text);
    // ── — A TARGET WITH NO LATIN SKELETON IS STILL A TARGET (2026-08-14) ────────────────────────
    //
    // `if (!norm) continue` dropped it, and that is the other half of the seam. The jx lane exists to
    // GENERATE a Chinese meaning-token that no Latin sweep can reach; the token then arrived here and
    // was discarded before it could be compared to anything. Both ends of the comparison were throwing
    // away non-Latin content — the record in classifyRecord, the target here — so a mark could not be
    // identical to itself.
    //
    // Kept with EMPTY mechanical fields on purpose. `edit1`, `cons`, `metaphone` and `conf` are Latin
    // constructs; leaving them populated from an empty skeleton would let a one-character Latin mark
    // fall into this target's edit neighbourhood and read as near-identical to a Chinese one. Empty
    // means this target is reachable by the RAW arm in classifyRecord and by nothing else, which is
    // exactly the claim the code can defend.
    const key = norm || `raw:${text.normalize("NFKC")}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!norm) { out.push({ text, norm: "", edit1: new Set(), conf: "", cons: "", metaphone: [] }); continue; }
    out.push({
      text, norm,
      edit1: new Set(editNeighbourhood(norm)),
      conf: confusableSkeleton(text),
      cons: consonantSkeleton(norm),
      metaphone: doubleMetaphone(norm).filter(Boolean),
    });
  }
  return out;
}

const isPrepared = (t) => t && typeof t === "object" && t.edit1 instanceof Set;

/**
 * Deterministically classify ONE record mark against the run's targets (the mark + its manifest
 * variants). Returns { tier, target, basis } — target = the matched target's original text (null on
 * other/unclassifiable), basis = which mechanical test matched. Precedence is fixed: identical >
 * near-identical > same-family; within a tier the first target in the given order wins (stable).
 */
export function classifyRecord(markText, targets) {
  const prepared = Array.isArray(targets) && targets.every(isPrepared) ? targets : prepareTargets(targets);
  const text = String(markText ?? "");
  const norm = normalizeElement(text);
  if (!norm) {
    // ── — A MARK WITH NO LATIN SKELETON CAN STILL BE IDENTICAL, AND IT WAS (2026-08-14) ──────────
    //
    // R1 retrieved TEN exact-match 澜珀 registrations — four REGISTERED, three in class 9, all in the
    // matter's own classes — and the delivered report did not mention the token once. This line is
    // where they went. `normalizeElement` keeps only Latin characters, so a Han mark normalises to the
    // empty string, fell straight to `unclassifiable`, and `unclassifiable` is not one of the two tiers
    // the floors accept (see THE FLOORS below). The records were recorded as a script BLIND SPOT —
    // context for judgment — instead of as floor rows, which are the list where every entry must be
    // weighed. Retrieved, banded, positioned, and never an obligation.
    //
    // The classifier could not COMPARE them; that is true, and it is not the same as could not MATCH
    // them. 澜珀 equals 澜珀 by inspection. The precedent is in this repo already: reference-score's
    // matchesReference makes RAW comparison its rule 1 for exactly this case, because normalizeElement
    // keeps only [a-z0-9] and a CJK mark folds to the empty string that every Latin rule would match
    // against everything. The scorer has had that rule since R1's Chinese registration was specced. The
    // engine's own classifier never got it.
    //
    // EQUALITY ONLY, DELIBERATELY. The floors are mechanical obligations a lawyer must answer row by
    // row, so every member has to be defensible without judgment: raw-equal after NFKC (which folds
    // full-width and compatibility forms of the same characters) is that. Containment is not — 澜珀計
    // contains 澜珀 and is a different mark — and whether it matters is judgment's call, reached
    // through the same-family tiers and the crowd descriptors, not by widening a floor.
    //
    // THIS PARAGRAPH USED TO SAY "narrower than the scorer's rule", and it was right when it was
    // written: matchesReference's script rule was unowned containment in both directions until,
    // which scored gold 澜珀 as retrieved off a different proprietor's longer mark that contains it. The scorer now takes
    // equality too, with one owner-gated containment escape the floors deliberately do not have. The
    // two agree; neither is the looser one any more.
    const raw = text.normalize("NFKC").trim();
    if (raw) {
      for (const t of prepared) {
        if (raw === String(t.text ?? "").normalize("NFKC").trim())
          return { tier: "identical", target: t.text, basis: "script-exact" };
      }
    }
    const scripts = nonLatinScripts(text);
    return { tier: "unclassifiable", target: null, basis: scripts.length ? `non-latin-script:${scripts.join("+")}` : "no-comparable-content" };
  }
  const conf = confusableSkeleton(text);
  const cons = consonantSkeleton(norm);
  const meta = doubleMetaphone(norm).filter(Boolean);
  const toks = tokensOf(text);

  for (const t of prepared) if (norm === t.norm) return { tier: "identical", target: t.text, basis: "normalized-equal" };

  // ── member 2 — A RELABELLED RECORD IS THE SAME MARK, AND IT WAS TIERING BELOW THE FLOOR ────────
  //
  // Measured against the scorer on `origin/main`: `VENZAL / VENZALMONO / VENZALKOMB` and `LUMIVANE &
  // Device` are `alias` to reference-score and `same-family / token-identical` here. Not dropped —
  // tiered BELOW the line. The floors take `identical` and `near-identical` only, so a register record
  // that IS the mark under a relabelling never became a row a lawyer had to answer. Same consequence as
  // member 1, different cause: member 1 could not compare at all, this one compares and under-rates.
  //
  // ALIAS SEPARATORS ONLY, and the distinction is reference-score's, kept deliberately identical
  // because the two must agree about what a relabelling IS: `/ , · & |` separate ALTERNATIVE NAMES for
  // one record; whitespace and hyphens separate WORDS WITHIN one name. Conflating them makes every
  // multi-word mark match its own first word — `WAVO TWIST` would become `WAVO`, which is a different
  // proprietor's different mark and the collision the scorer's own doc block warns about. Whitespace is
  // NOT in the class here for exactly that reason.
  //
  // EQUALITY ONLY, as in member 1. An alias that EQUALS a target is that mark under another label; an
  // alias that merely resembles one is what the family tiers below already handle, and widening a floor
  // on resemblance manufactures obligations the record does not support.
  const aliases = aliasesOf(text);
  if (aliases.length > 1) {
    for (const a of aliases) for (const t of prepared) if (a === t.norm)
      return { tier: "identical", target: t.text, basis: "alias-exact" };
  }
  for (const t of prepared) {
    if (t.edit1.has(norm)) return { tier: "near-identical", target: t.text, basis: "edit-1" };
    if (conf && conf === t.conf) return { tier: "near-identical", target: t.text, basis: "confusable-skeleton" };
  }
  for (const t of prepared) {
    if (toks.includes(t.norm)) return { tier: "same-family", target: t.text, basis: "token-identical" };
    if (toks.some((tok) => t.edit1.has(tok))) return { tier: "same-family", target: t.text, basis: "token-edit-1" };
    if (cons && cons === t.cons) return { tier: "same-family", target: t.text, basis: "consonant-skeleton" };
    if (meta.length && t.metaphone.length && meta.some((m) => t.metaphone.includes(m))) return { tier: "same-family", target: t.text, basis: "double-metaphone" };
  }
  // ── A MARK TWO EDITS FROM A VARIANT OF SIX LETTERS OR MORE IS OF ITS FAMILY (ruled 2026-10-13) ────────
  //
  // The variants stage renders the mark's meaning in some of a market's languages, and the same word in another
  // language is often two edits from one of them. None of the rungs above reads that: one edit, a whole matching
  // word, the consonant skeleton, the sound code. Measured on a saved band, a register entry a reviewing lawyer
  // listed sat two edits from such a meaning form and read as "other". Each pair is compared, never enumerated:
  // the form floor's radius stays one edit (form-neighbourhood.mjs). The rung makes no floor, which takes the
  // identical and near-identical tiers only, and runs last, so no tier above it moves.
  for (const t of prepared) {
    if (t.norm.length >= EDIT2_MIN_LEN && withinTwoEdits(norm, t.norm)) return { tier: "same-family", target: t.text, basis: "edit-2" };
  }
  return { tier: "other", target: null, basis: "no-mechanical-match" };
}

/** The shortest target the two-edit rung reads: below six letters two edits reach too many unrelated words. */
export const EDIT2_MIN_LEN = 6;

/** Is `a` within two insertions, deletions or substitutions of `b`? Stops at the first row past two. PURE. */
function withinTwoEdits(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > 2) return false;
    prev = cur;
  }
  return prev[b.length] <= 2;
}

// ── dominant-element composites (P2-A, the recall spine) ────────────────────────────────────────────
// The candidate set of the retrieved→judgment reconciliation: every LIVE, in-scope, SCREEN-SURFACED
// record whose mark carries the manifest's dominant element — as a standalone token
// (`token-identical`), a token one edit away (`token-edit-1`), or CONCATENATED inside a longer
// squashed word (`concatenation` — the WAVOTONK class: same-family in substance, "other" to the
// token classifier, and the proven silent-death seam). Screen-surfaced only (screen_verdict
// surface:*): the obligation this feeds is "everything the screen surfaced ends somewhere a reader
// can see"; drop:* records were already ended by the screen with a policed drop row.
// The concatenation basis requires a dominant element of >= MIN_CONCAT_LEN normalized chars — a
// two-letter element as a substring would flood the set with noise. PURE.
//
// ROUND-2 FIX (review problem 6) — the concatenation test is WITHIN A TOKEN, never across the seam.
// The first cut joined every token (`toks.join("").includes(dom)`) and so matched spans that do not
// exist in the mark: on the 2026-07-29 evidence run `MUL TI KI` / `MUL-TI-KI!` (3 UZ records) folded
// to "multiki" and `NƯỚC UỐNG TINH KHIẾT IKIGAI …` (VN) to "…khietikigai…", four candidates the mark
// itself never spells. They rank last so they never reached the top slice, but they inflate the
// residual a declared crowd count must cover — a count written one short blocks the run (the
// reviewer reproduced 378 declared vs 379 residual → blocked). A concatenation is a SQUASHED WORD
// (WAVOTONK), which is a property of one token.
export const MIN_CONCAT_LEN = 4;

/**
 * The dominant element, prepared once for the per-record basis ladder below. Null when the element
 * yields no comparable Latin skeleton — the same "not computable" the composites return. PURE.
 */
export function prepareDominantElement(dominantElement) {
  const dom = normalizeElement(String(dominantElement ?? ""));
  if (!dom) return null;
  return { dom, edit1: new Set(editNeighbourhood(dom)) };
}

/**
 * HOW a mark carries the dominant element — the composites' own ladder, extracted so a second
 * consumer (the audit's register-presence store,) classifies with the SAME rungs
 * instead of a private re-derivation: `token-identical`, `token-edit-1`, `concatenation`
 * (>= MIN_CONCAT_LEN, within one token — never across the seam), or null. PURE.
 */
export function dominantElementBasis(markText, prep) {
  if (!prep) return null;
  const toks = tokensOf(markText);
  if (toks.includes(prep.dom)) return "token-identical";
  if (toks.some((t) => prep.edit1.has(t))) return "token-edit-1";
  if (prep.dom.length >= MIN_CONCAT_LEN && toks.some((t) => t.includes(prep.dom))) return "concatenation";
  return null;
}

export function dominantElementComposites(band, { dominantElement, inScopeClasses = [] } = {}) {
  const prep = prepareDominantElement(dominantElement);
  if (!prep) return null;                         // no comparable dominant element ⇒ not computable
  const scope = new Set((inScopeClasses ?? []).map(niceClassKey).filter(Boolean));
  const inScope = (r) => {
    const cls = classesOf(r);
    if (!scope.size) return true;
    if (!cls.length) return true;                 // class-less record ⇒ include (fail-safe)
    return cls.some((c) => scope.has(c));
  };
  const out = [];
  for (const r of Array.isArray(band?.enumerated) ? band.enumerated : []) {
    const verdict = String(r?.screen?.screen_verdict ?? r?.screen_verdict ?? "");
    if (!verdict.startsWith("surface:")) continue;
    if (!isLiveRecord(r) || !inScope(r)) continue;
    const basis = dominantElementBasis(r?.mark_text, prep);
    if (!basis) continue;
    out.push({
      record_id: r.record_id ?? null, mark_text: r.mark_text ?? null, basis,
      classes: classesOf(r), status: r.status ?? r?.screen?.status ?? null,
      owner_name: r.owner_name ?? null, registry: registryOf(r),
      screen_verdict: verdict, application_date: r.application_date ?? r?.screen?.application_date ?? null,
      _query: r._query ?? null,
    });
  }
  out.sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
  // item 11 — the order seam. Identity in production (probeOrder returns the same reference when no
  // seed is set); a seeded permutation only under an explicit probe arm. See order-probe.mjs.
  return probeOrder(out, "composites");
}

// ── register positions (P2-A / charter P2d) — same right → one position, territories listed ─────────
// A pure union-find over EXACT-IDENTITY edges only. Three edge kinds, each named on the position:
//   mark-owner   — normalized mark text + normalized owner name identical (the DE/TW-legs fold);
//   uk009-clone  — a GB record whose registration/application number is "UK009" + an EM/EU record's
//                  number, same normalized mark (the Brexit clone arithmetic);
//   ir-base      — a WO (Madrid) record whose basicRegistrationNumber equals another record's
//                  registrationNumber, same normalized mark (the IR ↔ base-registration leg).
// NO similar-rights folding, NO related-owner heuristic, NO brand-family guess — those are judgment
// (the Round-2 ruling: 25→10 is arithmetic, 10→9 is judgment and stays with the lawyer). The
// positions are a PROJECTION: register-named-band.json keeps every per-registration record (floors,
// coverage, taint and presence all read per-record); a position never shrinks the band.
// `detailByUri` is DATA (built by the driver from _records/): lowercased canonical uri →
// {registrationNumber, applicationNumber, basicRegistrationNumbers[], madridDesignations[]}. PURE.
//
// ── ROUND-2 FIX (review problem 4) — OWNER DIVERGENCE NEVER UNIONS ─────────────────────────────────
// Two rights merged into one position is a MISSED CONFLICT — the worst outcome this projection can
// produce, and strictly worse than two positions a lawyer folds by hand. The first cut ran all three
// edge kinds through ONE transitive union-find, so a single owner-divergent number bridge merged two
// whole registration families: on the evidence run `uk009-clone :: EM CTMSI0639…[The FROZO Company] ↔
// GB GBRII4F1E…[Fairmile Snack Foods Corporation]` (UK00917092446 = EM 17092446) pulled FROZO's separate
// NZ 139544 / CO 731889 / GB 3249489 registrations into Fairmile's 27, a single 31-record "position"
// across 18 territories — and the digest is told to write ONE Sheet-1 row for it. Two rules now:
//   (1) a NUMBER bridge unions only when the merged position would carry ONE owner identity (below).
//       A divergent bridge is still real arithmetic and still worth a reader's eye, so it is recorded
//       as a `cross_references` entry on BOTH positions — surfaced, never merged. Assignment recorded
//       at one office and not the other is exactly the case a lawyer must see as two rights.
//       ROUND-3: this is stated over the POSITION, not over the pair, and the difference is the whole
//       rule. The round-2 code read `identical(a,b) || a has no owner || b has no owner` — so a record
//       whose register entry omits the owner unioned with anything, and a single blank-owner record
//       sitting between two number bridges re-merged the two owners transitively with
//       `cross_references: 0`, i.e. silently, which is the exact outcome rule (1) exists to prevent.
//       A blank owner is not evidence of sameness; it is the absence of evidence. So it may still join
//       a position (the register simply did not print the field) but never BRIDGE two identities: the
//       union is refused the moment the two sides' positions hold owners that are not the same
//       identity, and the arithmetic becomes a cross-reference instead.
//   (2) owner identity is compared on a CORE + LEGAL-FORM pair, not on the suffix-stripped core
//       alone. Stripping entity words is what makes "Fairmile Snack Foods Corp." = "Fairmile Snack Foods
//       Corporation" work, but on the same band it also collapsed "Wavo Group Limited", "Wavo AG"
//       and "Wavo Corporation" to the bare core "wavo" and merged three distinct registrants on the
//       mark-owner edge alone. So: same core AND compatible legal forms (one side's form set a
//       SUBSET of the other's — a register that simply omits the form still matches, two different
//       stated forms never do).
// Conservative by construction: the failure mode this trades into is a FALSE SPLIT (AS Bestnet ↔
// Aktsiaselts Bestnet is genuinely one company and now reads as two positions with a named
// cross-reference). A visible split the lawyer folds beats a silent merge the lawyer cannot see.
const OWNER_FORMS = new Map(Object.entries({
  incorporated: "inc", inc: "inc", corporation: "corp", corp: "corp", company: "co", co: "co",
  limited: "ltd", ltd: "ltd", llc: "llc", llp: "llp", plc: "plc", gmbh: "gmbh", ag: "ag", sa: "sa",
  srl: "srl", sro: "sro", bv: "bv", nv: "nv", oy: "oy", ab: "ab", as: "as", aps: "aps", kk: "kk",
  sarl: "sarl", spa: "spa", pty: "pty", group: "group", holding: "holdings", holdings: "holdings",
}));

/** The owner identity of a raw register owner string: `{core, forms}` — the distinctive tokens with
 *  the legal-form words lifted out, plus the SET of form classes seen. Two owners are the same
 *  identity when the cores are equal and one form set contains the other (ownerIdentical). An empty
 *  core (an owner string that is nothing but a legal form) is never identical to anything. PURE. */
export function ownerIdentity(s) {
  const toks = foldDiacritics(String(s ?? "")).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean);
  const core = [], forms = new Set();
  for (const t of toks) { const f = OWNER_FORMS.get(t); if (f) forms.add(f); else core.push(t); }
  return { core: core.join(" "), forms };
}

export function ownerIdentical(a, b) {
  const x = ownerIdentity(a), y = ownerIdentity(b);
  if (!x.core || !y.core || x.core !== y.core) return false;
  const [small, big] = x.forms.size <= y.forms.size ? [x.forms, y.forms] : [y.forms, x.forms];
  for (const f of small) if (!big.has(f)) return false;   // subset ⇒ compatible; disjoint forms ⇒ not
  return true;
}

/** The union-find bucket key for the mark+owner edge — core + the SORTED form set, so
 *  "Wavo AG" and "Wavo Corporation" land in different buckets while "X Corp."/"X Corporation" share
 *  one. The subset relaxation (a register omitting the form) is applied by the second pass below. */
const ownerKey = (s) => { const { core, forms } = ownerIdentity(s); return core ? `${core}|${[...forms].sort().join("+")}` : ""; };
const normOwner = (s) => ownerIdentity(s).core;
const normMark = (s) => normalizeElement(String(s ?? ""));

export function deriveRegisterPositions(records, detailByUri = new Map()) {
  const recs = (records ?? []).filter((r) => r?.record_id);
  const parent = recs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const bridges = [];
  const crossRefs = [];                             // owner-divergent number arithmetic: named, NOT unioned
  // The owner IDENTITIES each component carries, one representative per identity. This is the thing a
  // number bridge is actually checked against (round 3): the pairwise check could not see that the
  // record on the far side of a blank-owner record names a different owner.
  const ownersOf = new Map();
  for (let i = 0; i < recs.length; i++) ownersOf.set(i, normOwner(recs[i].owner_name) ? [recs[i].owner_name] : []);
  const union = (a, b, kind, detail) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
      const keep = ownersOf.get(ra) ?? [];
      for (const o of ownersOf.get(rb) ?? []) if (!keep.some((k) => ownerIdentical(k, o))) keep.push(o);
      ownersOf.set(ra, keep);
      ownersOf.delete(rb);
    }
    if (kind !== "mark-owner") bridges.push({ kind, from: recs[a].record_id, to: recs[b].record_id, detail });
  };
  /** Would unioning these two components put two DIFFERENT owner identities in one position? That —
   *  not the identity of the two bridged records — is what a number bridge must never do. */
  const spansDistinctOwners = (a, b) => {
    const all = [...(ownersOf.get(find(a)) ?? []), ...(ownersOf.get(find(b)) ?? [])];
    return all.some((x) => all.some((y) => !ownerIdentical(x, y)));
  };
  /** The owner a bridge side STANDS FOR: its own recorded owner, or — when the register left the
   *  field blank — the identity its position already carries. Without this a blank-owner
   *  cross-reference renders "record A (—) ↔ record B (Omega Trading Ltd)": a divergence notice that
   *  names no divergence, which surfaces nothing. For the ordinary both-owners-named bridge this is
   *  the raw owner string, unchanged.
   *
   *  The fallback is always available where it is used, and not by luck: a number union is REFUSED
   *  only when spansDistinctOwners says the two components hold different identities, which means
   *  both components hold one. So on the only path that emits a cross-reference, a blank side's
   *  component has already accrued the identity it stands for — whichever order the bridges were
   *  tested in. The test pins that under four orderings, since no real band exercises it. */
  const bridgeOwner = (i) => (normOwner(recs[i].owner_name)
    ? recs[i].owner_name
    : ((ownersOf.get(find(i)) ?? [])[0] ?? recs[i].owner_name ?? null));
  // A number bridge across an owner divergence is REAL arithmetic on a right that has since split
  // (or was recorded differently at two offices). It is recorded on both sides and never unioned.
  // Deduped by (kind, pair): a record whose registrationNumber and applicationNumber are the SAME
  // string (the ordinary GB/EM case) would otherwise record the identical divergence twice — and the
  // count is read by a reader, so a doubled count is a wrong fact.
  const seenCross = new Set();
  const crossRef = (a, b, kind, detail) => {
    const key = `${kind}|${[recs[a].record_id, recs[b].record_id].sort().join("|")}`;
    if (seenCross.has(key)) return;
    seenCross.add(key);
    crossRefs.push({ kind, from: recs[a].record_id, to: recs[b].record_id, detail,
      owner_divergence: [bridgeOwner(a), bridgeOwner(b)] });
  };
  // ONE predicate, stated over the position (round 3). It subsumes the pairwise identity test — two
  // named, non-identical owners always span — and it additionally catches the blank-owner transitive
  // bridge the pairwise form waved through.
  const numberEdge = (a, b, kind, detail) =>
    (spansDistinctOwners(a, b) ? crossRef(a, b, kind, detail) : union(a, b, kind, detail));
  const detail = (r) => detailByUri.get(String(r.record_id).toLowerCase()) ?? {};

  // Number edges FIRST (they carry the named bridges — a pair that is ALSO mark+owner-identical
  // still records its clone/IR linkage), then the mark+owner fold sweeps the rest.
  // edges 1+2 — number arithmetic, mark-guarded (same normalized mark on BOTH sides so a numeric
  // coincidence across unrelated marks can never fold two rights into one).
  const numKey = (n) => String(n ?? "").trim();
  const byRegNum = new Map();                     // "<mark>|<number>" → index (first wins)
  for (let i = 0; i < recs.length; i++) {
    const d = detail(recs[i]);
    for (const n of [d.registrationNumber, d.applicationNumber]) {
      const key = `${normMark(recs[i].mark_text)}|${numKey(n)}`;
      if (numKey(n) && normMark(recs[i].mark_text) && !byRegNum.has(key)) byRegNum.set(key, i);
    }
  }
  for (let i = 0; i < recs.length; i++) {
    const d = detail(recs[i]);
    const mk = normMark(recs[i].mark_text);
    if (!mk) continue;
    // uk009-clone: GB "UK009" + 8-digit EM number
    for (const n of [d.registrationNumber, d.applicationNumber]) {
      const m = numKey(n).match(/^UK009(\d{8})$/i);
      if (!m) continue;
      const j = byRegNum.get(`${mk}|${m[1]}`);
      if (j != null && find(j) !== find(i)) numberEdge(j, i, "uk009-clone", `UK009${m[1]} = EM ${m[1]}`);
    }
    // ir-base: WO basicRegistrationNumber → the base registration's record
    for (const base of d.basicRegistrationNumbers ?? []) {
      const j = byRegNum.get(`${mk}|${numKey(base)}`);
      if (j != null && find(j) !== find(i)) numberEdge(j, i, "ir-base", `IR ${numKey(d.registrationNumber) || recs[i].record_id} basic registration ${numKey(base)}`);
    }
  }
  // edge 3 — mark+owner identity (the DE/TW-legs fold; runs last so number bridges stay named).
  // Pass 1 buckets on the exact core+form key; pass 2 folds a form-less owner into the single
  // form-bearing bucket that shares its core (the subset relaxation — "ASSOCIATED BRANDS INDUSTRIES"
  // into "… LIMITED"), and ONLY when exactly one such bucket exists: two candidate forms means the
  // register is ambiguous about which entity it is, and an ambiguous fold is a merge risk.
  const byMarkOwner = new Map();
  for (let i = 0; i < recs.length; i++) {
    const key = `${normMark(recs[i].mark_text)}|${ownerKey(recs[i].owner_name)}`;
    if (normMark(recs[i].mark_text) && ownerKey(recs[i].owner_name)) {
      if (byMarkOwner.has(key)) union(byMarkOwner.get(key), i, "mark-owner");
      else byMarkOwner.set(key, i);
    }
  }
  for (const [key, i] of byMarkOwner) {
    const [mk, ok] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
    if (!ok.endsWith("|")) continue;                // this bucket states a legal form — not the form-less side
    const core = ok.slice(0, -1);
    const peers = [...byMarkOwner].filter(([k]) => k !== key && k.startsWith(`${mk}|${core}|`));
    if (peers.length === 1) union(peers[0][1], i, "mark-owner");
  }

  const groups = new Map();
  for (let i = 0; i < recs.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const positions = [...groups.values()].map((members) => {
    const rs = members.map((i) => recs[i]);
    const uniq = (xs) => [...new Set(xs.filter((x) => x != null && String(x).trim() !== ""))];
    const territories = uniq(rs.flatMap((r) => {
      const md = detail(r).madridDesignations ?? [];
      return [registryOf(r), ...md];
    })).sort();
    const posBridges = bridges.filter((b) => rs.some((r) => r.record_id === b.from || r.record_id === b.to));
    const posCross = crossRefs.filter((b) => rs.some((r) => r.record_id === b.from || r.record_id === b.to));
    // `owners` is one representative per OWNER IDENTITY, not per raw string: the first cut listed raw
    // `owner_name`s while the fold compared normalized ones, so 78 positions reported ">1 owner" that
    // were purely typographic (Fairmile appeared as 8 variants) and buried the one real divergence in the
    // noise. Raw strings stay available as `owner_strings` for the audit trail. Post-fix a position
    // carries ONE identity by construction — >1 means some constituent has no owner recorded.
    const byIdentity = new Map();
    for (const o of uniq(rs.map((r) => r.owner_name))) {
      const k = ownerKey(o) || `~${String(o).toLowerCase()}`;
      if (!byIdentity.has(k)) byIdentity.set(k, o);
    }
    return {
      mark_text: rs[0].mark_text ?? null,
      owners: [...byIdentity.values()].sort(),
      owner_strings: uniq(rs.map((r) => r.owner_name)).sort(),
      records: rs.map((r) => r.record_id).sort(),
      classes: uniq(rs.flatMap((r) => classesOf(r))).sort((a, b) => Number(a) - Number(b)),
      statuses: uniq(rs.map((r) => r.status ?? r?.screen?.status)).sort(),
      territories,
      live: rs.some((r) => isLiveRecord(r)),
      bridges: posBridges,
      cross_references: posCross,
    };
  }).sort((a, b) => b.records.length - a.records.length || String(a.records[0]).localeCompare(String(b.records[0])));
  return {
    positions: probeOrder(positions, "positions"),   // item 11 seam — identity unless a probe seed is set
    cross_references: crossRefs,
    totals: {
      records: recs.length,
      positions: positions.length,
      bridges: bridges.reduce((acc, b) => { acc[b.kind] = (acc[b.kind] ?? 0) + 1; return acc; }, {}),
      // ASSERTED unconditionally (the instrumentation house rule): 0 owner-divergent bridges is
      // a real answer about this band, never an absent field.
      cross_references: crossRefs.length,
    },
  };
}

const inc = (obj, key, by = 1) => { const k = String(key); obj[k] = (obj[k] ?? 0) + by; };
/** A Nice class as one spelling: "09", "9" and 9 are class 9. PURE. */
export const niceClassKey = (c) => { const t = String(c ?? "").trim(); return /^\d+$/.test(t) ? String(Number(t)) : t; };
const classesOf = (r) => (Array.isArray(r?.classes) ? r.classes : r?.classes != null ? [r.classes] : []).map(niceClassKey).filter(Boolean);
const registryOf = (r) => String(r?.screen?.registry ?? (Array.isArray(r?.jurisdictions) ? r.jurisdictions[0] : r?.jurisdictions) ?? "").trim() || "unknown";
const yearOf = (r) => {
  const m = String(r?.application_date ?? r?.screen?.applicationDate ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
};
const OWNER_SCOPED_RE = /owner/i;

// A floor row: everything a lawyer needs to decide on THIS record, and everything a lookup needs to
// pull it — provider-neutral fields only.
const floorRow = (r, cls) => ({
  record_id: r.record_id ?? null,
  mark_text: r.mark_text ?? null,
  tier: cls.tier,
  matched_target: cls.target,
  basis: cls.basis,
  classes: classesOf(r),
  status: r.status ?? r?.screen?.status ?? null,
  live: isLiveRecord(r),
  owner_name: r.owner_name ?? null,
  registry: registryOf(r),
  // — READ BOTH LOCATIONS, in the same order line 246 reads them, because a field with two
  // readers that disagree about where it lives is a field one of them cannot see. `record-carry.mjs`
  // states the two homes outright: `rec.screen.screen_verdict` on a merged register band, and
  // `rec.screen_verdict` elsewhere. Line 246 already did the fallback; this row did not, and `status`
  // TWO LINES UP does — which is exactly why `status` measured 100% populated on the same rows that
  // measured 0%.
  //
  // MEASURED across every band shape reachable on this box: 259 artifacts, 47,392 floor rows, ZERO
  // non-null verdicts, while `live`, `status`, `basis`, `tier` and `matched_target` were each 100%.
  // Joined to the bands that produced them: 2,166 records carry `screen.screen_verdict` and NOT ONE
  // carries it at the top level, so this line could never have found a value.
  //
  // The issue filed against this read it the other way — it observed that no floor row carries a
  // `screen` sub-object and concluded the value was not hiding there. That evidence was about the
  // OUTPUT row, which this projection builds and which never copies `screen`; it said nothing about
  // the input. The input is where the value always was.
  screen_verdict: r?.screen?.screen_verdict ?? r.screen_verdict ?? null,
  _query: r._query ?? null,
});

// ── THE BAND IN THE LAWYER'S ORDER ──────────────────────────────────────────────────────────────────
//
// The crowded-field method, as ruled 2026-09-21: identical marks in the class;
// identical marks for the particular goods; the dominant word for the particular goods; then the rest,
// counted, with its rule. "Fifty? Read them all. A few hundred? Sort by the client's goods and markets,
// read the near ones first, list the rest. A thousand or more? The field is crowded: read the identical
// and live ones for the client's goods, tell the client it is crowded, and do not write up the rest."
//
// Code sorts on fields the records carry: the mark's tier against the targets, a goods-word match, class
// and status. It judges nothing.
export const BAND_GROUPS = ["a", "b", "c", "d", "rest"];
// The method's "a thousand or more": a group this size is served as its count and its first page.
export const CROWDED_GROUP_RECORDS = 1000;
const TIER_RANK = { identical: 0, "near-identical": 1, "same-family": 2, other: 3, unclassifiable: 4 };

/**
 * One record's group. PURE. `hits` is how many of the client's goods words its goods contain, or null
 * when the run holds no goods for it: unknown passes the goods test, so a record is never set aside for
 * what the run does not hold.
 *   (a) identical or near-identical to a target, live in the ordered classes, for the client's goods;
 *   (b) identical or near-identical to a target, in the ordered classes;
 *   (c) the same family as a target, or carrying the searched dominant word, for the client's goods;
 *   (d) every other live mark in the ordered classes, for the client's goods;
 *   the rest: everything else.
 */
export function recordGroup({ tier, live, inScope, hits, dominant = false }) {
  const ident = tier === "identical" || tier === "near-identical";
  const forGoods = hits !== 0;
  // (a) reads the goods of live records in the ordered classes only (ruled 2026-10-12): a dead or
  // out-of-class record's goods never put a mark in (a).
  if (ident && live && inScope && forGoods) return "a";
  if (ident && inScope) return "b";
  if ((tier === "same-family" || dominant) && forGoods) return "c";
  if (live && inScope && forGoods) return "d";
  return "rest";
}

/**
 * The band in the ruled order: ONE LINE PER MARK OF AN OWNER, in one collated list per group. PURE. The unit is
 * the mark, not the owner: an owner shown on one line under its closest mark hid a different mark of the
 * same owner, and a ground written about the shown mark set the other aside unseen.
 *
 * THE LIST IS THE ORDER'S SCOPE (ruled 2026-10-12). A worldwide order lists the world; an order naming its
 * territories lists every register that binds them (`bindingLayersFor`): a member state's own register,
 * the EU's and Madrid's for it, every member's for an EU order, Benelux for its three. A line held only in
 * registers outside them goes to the rest, counted with that reason and still open to a lookup. A record
 * whose register cannot be read stays in.
 *
 * "FOR THE CLIENT'S GOODS" MEANS THE PARTICULAR GOODS: the words that name the client's product, never
 * the class words the variants stage adds for the register search. `goods.hits` and `goods.matched`
 * answer for those words.
 *
 * EACH GROUP RUNS IN THE ORDER THE OWNER RULED (2026-10-12): a line with the client's goods on a live record
 * in the ordered classes first; then more live records in those classes; then more goods words; then a
 * client market; then more records. Code sorts on fields the records carry and judges nothing. A line
 * carries the goods words it matched, and not the goods text, which is one lookup away, except a floor in (b):
 * it matched none of the client's words, so it shows the goods the test read, cut short.
 *
 * A line sits in the best group its records in scope reach. `keysOf` gives a record's line and its owner's
 * set-aside key, both read through the positions fold, so a line covers exactly what a row naming one of
 * its records reaches. A line carries the words matched, so nothing on it is cut but a (b) floor's goods; the one line that cannot
 * be judged from itself is one the goods test placed while its records carry no goods on file.
 *
 * @param records    the band's enumerated records
 * @param classify   record → { tier, target } (the shape's own classifier over its targets)
 * @param inScope    record → boolean (the shape's own class test)
 * @param goods      { of, hits, matched } (record-goods.mjs), or null when the run holds none
 * @param dominantTerm  the word the register's goods-narrowed search asked for, or ""
 * @param keysOf     record → { line, owner }, or null
 * @param markets    the client's markets, as territory codes
 * @param territories  the order's territories, as codes (effective-scope.mjs `orderTerritories`); empty for a worldwide order
 */
/**
 * THE REST NEVER HOLDS A FLOOR. The rest is set aside in one row, at a thousand records or more on its first
 * page and its count, so a floor in it could be left unread. The group rule puts every floor in (a) or (b); a
 * rest holding one is a defect here, and the shape is refused rather than served with a floor no one will
 * read. PURE (throws).
 */
export function assertRestHoldsNoFloor(restLines) {
  const stray = (restLines ?? []).find((l) => l?.floors > 0);
  if (stray) throw new Error(`band shape: the rest holds a floor (${stray.record_id ?? stray.key}); a floor is listed in (a) or (b), never counted in the rest`);
}

/**
 * Every register that binds any of these territories: each territory's own, the EU's for a member, every
 * member's for the EU, Benelux's for its three, Madrid's for all. The Benelux register is written BX or as any
 * of its three members' codes, binds all three, and sits inside the EU. PURE.
 */
const BENELUX = ["BX", "NL", "BE", "LU"];
function bindingOffices(territories, code) {
  const out = new Set();
  for (const t of territories) {
    out.add(t);
    try { for (const l of bindingLayersFor(t)) out.add(code(l.office)); } catch { /* an unknown code binds itself */ }
  }
  if (out.has("WO")) out.add("IB");   // the International Bureau is the Madrid register by another name
  if (BENELUX.some((c) => out.has(c))) { for (const c of BENELUX) out.add(c); out.add("EU"); out.add("WO"); out.add("IB"); }
  return out;
}

// The goods text the test read for a record: the reader hands it as text, or as one statement per class, each with its
// text. Then that text cut short for a line.
const goodsReadText = (g) => (Array.isArray(g) ? g.map((x) => (typeof x === "string" ? x : x?.text)) : [typeof g === "string" ? g : g?.text])
  .filter((t) => typeof t === "string" && t.trim()).join("; ").replace(/\s+/g, " ").trim() || null;
export const FLOOR_GOODS_SHOWN = 140;
function cutGoods(text) {
  const t = String(text ?? "");
  if (t.length <= FLOOR_GOODS_SHOWN) return t;
  const head = t.slice(0, FLOOR_GOODS_SHOWN);
  const space = head.lastIndexOf(" ");
  return `${(space > FLOOR_GOODS_SHOWN / 2 ? head.slice(0, space) : head).replace(/[\s,;:.]+$/, "")}…`;
}

export function bandGroups(records, { classify, inScope, goods = null, dominantTerm = "", keysOf = null, markets = [], territories = [], evidenceOf = null } = {}) {
  const fold = (x) => foldDiacritics(String(x ?? "")).toLowerCase();
  const dom = fold(dominantTerm).trim();
  const domRe = dom ? new RegExp(`(^|[^\\p{L}\\p{N}])${dom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u") : null;
  const domPrep = prepareDominantElement(dominantTerm);   // the composites' own ladder, for a word fused into a longer one
  // A territory or register as written, a code or a name, read as its code: "Switzerland" and "CH" are one.
  const code = (t) => canonicalJurisdictionCode(territoryKey(String(t ?? "").trim()) || String(t ?? "").trim().toUpperCase());
  const ordered = new Set((territories ?? []).map(code).filter(Boolean));
  // An ordered territory the engine cannot read binds no register it knows; cutting on the others would drop
  // records inside it unseen. So it is reported, and the list holds every register.
  const unreadTerritories = [...ordered].filter((t) => !KNOWN_JURISDICTION_CODES.has(t));
  const offices = unreadTerritories.length ? new Set() : bindingOffices(ordered, code);
  // The client's markets, read the same way; a market of the EU holds a member's register too.
  const marketsGiven = [...new Set((markets ?? []).map(code).filter(Boolean))];
  const market = bindingOffices(new Set(marketsGiven), code);
  // A register as a provider writes it: a code, a list of codes, or a list of {jurisdiction, …}, read by its
  // code field alone. What cannot be read gives no code, and a record with none stays in.
  const raw = (j) => (j == null ? [] : Array.isArray(j) ? j.flatMap(raw) : typeof j === "object"
    ? ((j.jurisdiction ?? j.code ?? j.office ?? j.country) != null ? raw(j.jurisdiction ?? j.code ?? j.office ?? j.country) : [])
    : [j]);
  const territoriesOf = (r) => raw(r?.jurisdictions).map(code).filter((t) => /^[A-Z]{2,5}$/.test(t));
  const inOrder = (ts) => !offices.size || !ts.length || ts.some((t) => offices.has(t));
  const lines = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    const { tier } = classify(r);
    const g = goods ? goods.of(r) : null;
    const hits = goods && g ? goods.hits(g) : null;
    const words = goods && g && goods.matched ? goods.matched(g) : null;
    const live = isLiveRecord(r), s = inScope(r);
    const ts = territoriesOf(r);
    const outside = !inOrder(ts);
    const dominant = Boolean(domRe && domRe.test(fold(r?.mark_text))) || dominantElementBasis(r?.mark_text, domPrep) === "concatenation";
    const floor = (tier === "identical" || tier === "near-identical") && live && s;   // the floors' own test
    // A floor is never counted in the rest (ruled 2026-10-12): held only outside the order's territories, it
    // is still listed, in (a) or (b), where the step reads it and may set it aside by name on its territory.
    const group = outside && !floor ? "rest" : recordGroup({ tier, live, inScope: s, hits, dominant });
    // "On file" is a body `band_record` can open: goods read off the band row decide the group, never that.
    const onFile = goods?.held ? goods.held(r) : Boolean(g);
    const rec = { r, tier, hits, words, live, inScope: s, group, outside, floor, onFile, territories: ts, inMarket: ts.some((t) => market.has(t)),
      ...(floor ? { read: goodsReadText(g) } : {}) };
    const keys = typeof keysOf === "function" ? keysOf(r) : null;
    const ownerKey = keys?.owner ?? (normKey(r?.owner_name) ? `owner:${normKey(r?.owner_name)}` : `record:${String(r?.record_id ?? "").trim().toLowerCase()}`);
    const key = keys?.line ?? `line:${ownerKey}|${normMark(r?.mark_text) || String(r?.record_id ?? "").trim().toLowerCase()}`;
    const line = lines.get(key) ?? { key, owner_key: ownerKey, owner_name: String(r?.owner_name ?? "").trim() || null, recs: [] };
    line.recs.push(rec);
    lines.set(key, line);
  }
  const rank = (g) => BAND_GROUPS.indexOf(g);
  const better = (x, y) => TIER_RANK[x.tier] - TIER_RANK[y.tier] || (y.hits ?? -1) - (x.hits ?? -1)
    || Number(y.live) - Number(x.live) || String(x.r?.record_id ?? "").localeCompare(String(y.r?.record_id ?? ""));
  const byGroup = Object.fromEntries(BAND_GROUPS.map((g) => [g, { records: 0, set_records: 0, lines: [] }]));
  const noGoods = [];
  let outsideLines = 0, outsideRecords = 0;
  for (const l of lines.values()) {
    const group = BAND_GROUPS[Math.min(...l.recs.map((x) => rank(x.group)))];
    const inGroup = l.recs.filter((x) => x.group === group).sort(better);
    const best = inGroup[0];
    // Unknown is decided on the records that put the line in its group: a line placed by a record whose goods
    // could not be read is listed apart, whatever the line's other records carry.
    const known = inGroup.some((x) => x.words != null);
    const words = [...new Set(l.recs.flatMap((x) => x.words ?? []))];
    const liveInScope = l.recs.filter((x) => x.live && x.inScope && !x.outside);
    const row = {
      key: l.key, owner_key: l.owner_key, owner_name: l.owner_name, mark: String(best.r?.mark_text ?? "").trim() || null, group,
      records: l.recs.length, group_records: inGroup.length, live: l.recs.filter((x) => x.live).length,
      live_in_scope: liveInScope.length, goods_live_in_scope: liveInScope.some((x) => (x.hits ?? 0) > 0),
      best_tier: best.tier, goods_hits: known ? words.length : null, goods_words: known ? words : null,
      in_market: l.recs.some((x) => x.inMarket), in_scope: l.recs.some((x) => x.inScope),
      territories: [...new Set(l.recs.flatMap((x) => x.territories))].sort(),
      classes: [...new Set(l.recs.flatMap((x) => classesOf(x.r)))].sort((p, q) => Number(p) - Number(q) || p.localeCompare(q)),
      // A line the goods test could not place shows a record whose goods are on file where it has one, so
      // `band_record` opens the record the line names; `goods_on_file` says so of that record.
      record_id: (known ? best : (inGroup.find((x) => x.onFile) ?? best)).r?.record_id ?? null,
      // What the goods of the record the line names rest on (goods-evidence.mjs), where the run recorded it, and, where
      // their completeness is not established, whether any goods text is held at all (`goods_text: false` where none is,
      // as for a held record with no goods field).
      ...(typeof evidenceOf === "function" ? (() => {
        const ev = evidenceOf((known ? best : (inGroup.find((x) => x.onFile) ?? best)).r);
        return { goods_evidence: ev?.state ?? null, ...(ev?.state === "unknown" && ev?.readable == null ? { goods_text: false } : {}) };
      })() : {}),
      floors: l.recs.filter((x) => x.floor).length,
      // A FLOOR IN (b) SHOWS THE GOODS THE TEST READ, cut short: a (b) line matched none of the client's words, so
      // without them a page of floors could not be judged without opening each record.
      ...(group === "b" && known ? (() => { const read = l.recs.find((x) => x.floor && x.read)?.read; return read ? { floor_goods: cutGoods(read) } : {}; })() : {}),
      ...(known ? {} : { goods_on_file: inGroup.some((x) => x.onFile) }),
      ...(offices.size && l.recs.every((x) => x.outside) ? { outside: true } : {}),
    };
    // A line placed in (a), (c) or (d) by the goods test, whose records carry no goods the engine can read,
    // cannot be judged from the line: it is listed apart, opened before a fate, and no group row covers it.
    if (!known && (group === "a" || group === "c" || group === "d")) { noGoods.push(row); continue; }
    if (group === "rest" && l.recs.every((x) => x.outside)) { row.outside = true; outsideLines++; outsideRecords += l.recs.length; }
    byGroup[group].records += inGroup.length;
    byGroup[group].set_records += l.recs.length;
    byGroup[group].lines.push(row);
  }
  assertRestHoldsNoFloor(byGroup.rest.lines);
  const byName = (x, y) => String(x.owner_name ?? x.owner_key).localeCompare(String(y.owner_name ?? y.owner_key))
    || String(x.mark ?? "").localeCompare(String(y.mark ?? "")) || String(x.key).localeCompare(String(y.key));
  const herOrder = (x, y) => Number(y.goods_live_in_scope) - Number(x.goods_live_in_scope) || y.live_in_scope - x.live_in_scope
    || (y.goods_hits ?? -1) - (x.goods_hits ?? -1) || Number(y.in_market) - Number(x.in_market) || y.records - x.records || byName(x, y);
  for (const g of ["a", "b", "c", "d"]) byGroup[g].lines.sort(herOrder);
  // The rest runs by the client's goods words, then by live records in the ordered classes (ruled 2026-10-12):
  // listed whole under a thousand records, by its first page at a thousand or more, like any group.
  byGroup.rest.lines.sort((x, y) => (y.goods_hits ?? -1) - (x.goods_hits ?? -1) || y.live_in_scope - x.live_in_scope || byName(x, y));
  // The lines the goods test could not place run floors first, then by live records in the ordered classes,
  // then records: a floor here takes its own fate, so the floors lead the first page.
  noGoods.sort((x, y) => Number(y.floors > 0) - Number(x.floors > 0) || y.live_in_scope - x.live_in_scope || y.records - x.records || byName(x, y));
  return { dominant_term: dominantTerm || null, goods_on_file: Boolean(goods), markets: marketsGiven, territories: [...ordered], territories_unread: unreadTerritories,
    outside: { lines: outsideLines, records: outsideRecords }, by_group: byGroup, no_goods: noGoods };
}

/**
 * Build the deterministic band shape + its readable markdown mirror.
 *
 * @param band  { enumerated:[records], crowds:[descriptors] } — the MERGED named band (mergeNamedBands
 *              output / register-named-band.json), read complete. Never a sample.
 * @param opts.targets         the mark + its manifest variants (strings, or prepareTargets output)
 * @param opts.inScopeClasses  the instructed Nice classes (strings/numbers); [] ⇒ every class is in scope
 *                             for the floors (fail-safe: no class filter ⇒ nothing filtered out)
 * @param opts.crowdContext    the crowd-context.json object (composed with, never changed) or null
 * @param opts.caps            { owners?: N } — bounds on the AGGREGATE lists only; floors are NEVER capped
 * @param opts.positions       deriveRegisterPositions() output (or null) — the identity-collapse
 *                             PROJECTION rides the shape so judgment reads positions BEFORE the digest
 *                             (charter P2d); the band itself stays per-registration
 * @returns { shape, md }      deterministic — same band + inputs ⇒ same bytes (no timestamps)
 */
export function buildBandShape(band, { crowdNarrowing = [], targets = [], inScopeClasses = [], crowdContext = null, caps = {}, positions = null, goods = null, goodsTest = null, goodsWordCount = 0, dominantTerm = "", manifestDominant = "", keysOf = null, markets = [], territories = [], evidenceOf = null } = {}) {
  const prepared = prepareTargets(Array.isArray(targets) && targets.every(isPrepared) ? targets.map((t) => t.text) : targets);
  const records = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const crowds = Array.isArray(band?.crowds) ? band.crowds : [];
  const scope = new Set((inScopeClasses ?? []).map(niceClassKey).filter(Boolean));
  const inScope = (r) => {
    const cls = classesOf(r);
    if (!scope.size) return true;               // no instructed classes ⇒ everything is in scope
    if (!cls.length) return true;               // class-less record ⇒ include (fail-safe: never drop unseen)
    return cls.some((c) => scope.has(c));
  };

  const byTier = Object.fromEntries(SHAPE_TIERS.map((t) => [t, 0]));
  const byClass = {}, byStatus = {}, byRegistry = {}, byYear = {};
  const owners = new Map();                      // owner_name → { records, live }
  const floors = [];
  const unclassifiable = [];
  const scriptGaps = new Map();                  // script(s) key → { count, sample[] }

  const classified = new Map();
  for (const r of records) {
    const cls = classifyRecord(r?.mark_text, prepared);
    classified.set(r, cls);
    byTier[cls.tier]++;
    for (const c of classesOf(r)) inc(byClass, c);
    inc(byStatus, String(r?.status ?? r?.screen?.status ?? "unknown").trim().toLowerCase() || "unknown");
    inc(byRegistry, registryOf(r));
    inc(byYear, yearOf(r) ?? "unknown");
    const owner = String(r?.owner_name ?? "").trim() || "(owner not carried)";
    const o = owners.get(owner) ?? { records: 0, live: 0 };
    o.records++; if (isLiveRecord(r)) o.live++;
    owners.set(owner, o);

    // THE FLOORS — every identical / near-identical, LIVE, IN-CLASS record, listed individually and
    // UNCONDITIONALLY (never capped, never sampled): this is the list no lookup pattern may hide.
    if ((cls.tier === "identical" || cls.tier === "near-identical") && isLiveRecord(r) && inScope(r)) {
      floors.push(floorRow(r, cls));
    }
    if (cls.tier === "unclassifiable") {
      unclassifiable.push({ record_id: r?.record_id ?? null, mark_text: r?.mark_text ?? null, basis: cls.basis });
      const scripts = nonLatinScripts(r?.mark_text);
      if (scripts.length) {
        const key = scripts.join("+");
        const g = scriptGaps.get(key) ?? { count: 0, sample: [] };
        g.count++;
        if (g.sample.length < 10) g.sample.push({ record_id: r?.record_id ?? null, mark_text: r?.mark_text ?? null });
        scriptGaps.set(key, g);
      }
    }
  }
  // deterministic floor order: tier (identical first), then record_id
  floors.sort((a, b) => (a.tier === b.tier ? String(a.record_id).localeCompare(String(b.record_id)) : (a.tier === "identical" ? -1 : 1)));
  // item 11 seam — identity unless a probe seed is set. The floors are the sharpest place to ask the
  // question: they are complete by construction and every one must be weighed, so a read that moves
  // when only their order moves is an artefact of presentation, not of the record.
  const floorsOrdered = probeOrder(floors, "floors");

  const ownerCap = Number.isFinite(caps.owners) ? caps.owners : 40;
  const grouped = bandGroups(records, { classify: (r) => classified.get(r), inScope, goods, dominantTerm, keysOf, markets, territories, evidenceOf });
  const ownersIn = (ls) => new Set(ls.map((l) => l.owner_key)).size;
  const groupOf = (g) => {
    const ls = grouped.by_group[g].lines;
    return { records: grouped.by_group[g].records, set_records: grouped.by_group[g].set_records, lines: ls.length, owners: ownersIn(ls), list: ls };
  };
  const rest = grouped.by_group.rest.lines;
  const groups = {
    dominant_term: grouped.dominant_term, manifest_dominant: manifestDominant || null, goods_on_file: grouped.goods_on_file,
    markets: grouped.markets, territories: grouped.territories, territories_unread: grouped.territories_unread, outside: grouped.outside,
    goods_words_total: goodsWordCount || 0, goods_test: goodsTest ?? { source: goods ? "goods_words" : "none", words: [] },
    crowded_at: CROWDED_GROUP_RECORDS, first_page: ownerCap,
    a: groupOf("a"), b: groupOf("b"), c: groupOf("c"), d: groupOf("d"),
    rest: { records: grouped.by_group.rest.set_records, lines: rest.length, owners: ownersIn(rest), list: rest },
    no_goods: { records: grouped.no_goods.reduce((n, l) => n + l.records, 0), lines: grouped.no_goods.length,
      owners: ownersIn(grouped.no_goods), list: grouped.no_goods },
  };
  const concentrations = [...owners.entries()]
    .map(([owner_name, v]) => ({ owner_name, records: v.records, live: v.live }))
    .sort((a, b) => b.records - a.records || a.owner_name.localeCompare(b.owner_name))
    .slice(0, ownerCap);

  // Crowd descriptors + the crowd-context JOIN (compose with QW1's artifact; never mutate it): a
  // context slice joins a crowd when one of its terms appears in the crowd's query (case-folded).
  const ccSlices = Array.isArray(crowdContext?.slices) ? crowdContext.slices : [];
  const fold = (s) => foldDiacritics(String(s ?? "")).toLowerCase();
  // what was retrieved under each crowd (register-plan.mjs, crowdNarrowing): data on the descriptor, by its qid
  const endingByQid = new Map((Array.isArray(crowdNarrowing) ? crowdNarrowing : []).filter((r) => r?.qid && r?.narrowing).map((r) => [String(r.qid), r]));
  const shapeCrowds = crowds.map((c) => {
    const q = fold(c.query);
    const end = c.qid ? endingByQid.get(String(c.qid)) : null;
    const joined = ccSlices
      .filter((s) => (Array.isArray(s.terms) ? s.terms : []).some((t) => fold(t) && q.includes(fold(t))))
      .map((s) => ({ unit: s.unit ?? null, axis: s.axis ?? null, terms: s.terms ?? [],
        exact_subset_enumerated: s.exact_subset?.enumerated === true, exact_subset_total: s.exact_subset?.total_hits ?? null }));
    return {
      // — `?? 0` here re-collapsed the UNKNOWN that named-band.mjs now preserves, so fixing the
      // projection upstream alone would have left every reader of the shape seeing a counted zero.
      query: c.query, total_hits: c.total_hits ?? null, fetched: c.fetched ?? 0,
      reason: String(c.reason ?? "").slice(0, 400),
      // — the refusal stamps ride into the shape too. This is the SECOND projection between the
      // executor and judgment, and dropping them here would undo the first carry silently.
      ...(c.error === true ? { error: true } : {}),
      ...(c.deferred === true ? { deferred: true } : {}),
      ...(end ? { narrowing: end.narrowing, ...(end.lists?.length ? { lists: end.lists } : {}), ...(end.not_covered?.length ? { not_covered: end.not_covered } : {}) } : {}),
      crowd_context_slice: joined.length ? joined : null,
    };
  });

  // BLIND SPOTS — each with the mechanical detector that found it, so a reader can re-run the test.
  const blindSpots = [];
  const countOnlyOwnerZones = shapeCrowds.filter((c) => (c.total_hits ?? 0) > 0 && (c.fetched ?? 0) <= 1 && OWNER_SCOPED_RE.test(c.query));
  if (countOnlyOwnerZones.length) blindSpots.push({
    kind: "count-only-owner-zone",
    detector: "crowd descriptor with total_hits>0, fetched<=1, and an owner-scoped query — the owner's portfolio was counted, never screened",
    count: countOnlyOwnerZones.length,
    zones: countOnlyOwnerZones.map((c) => ({ query: c.query, total_hits: c.total_hits })),
  });
  // — A REFUSED SLICE IS ITS OWN BLIND SPOT, and it could never have been the one below.
  // `error`/`deferred` blocks land as total_hits:0, fetched:0, so `total_hits > fetched` is `0 > 0` —
  // FALSE. Every slice the provider refused was therefore invisible to the one detector built to say
  // what judgment could not see, and a run whose provider refused EVERYTHING produced a shape with no
  // unenumerated-crowd blind spot at all. An absence is a finding; this is the row that states it.
  const refused = shapeCrowds.filter((c) => c.error === true || c.deferred === true);
  if (refused.length) blindSpots.push({
    kind: "refused-slice",
    detector: "crowd descriptor stamped error/deferred by the executor — the slice was never answered, so its 0 is a placeholder and not a count",
    count: refused.length,
    zones: refused.map((c) => ({ query: c.query, reason: c.reason,
      kind: c.deferred === true ? "capability-gap" : "provider-error" })),
  });
  // — AN UNCOUNTABLE SLICE IS A BLIND SPOT, and could never have been the one below. With
  // `total_hits` null the comparison is `null > n`, which is false for every n — so a register that
  // REFUSED to give a total produced no blind spot at all, exactly as a refused slice did before
  //. Same arithmetic, second input class. These are slices that DID run and may have returned
  // records; it is the TOTAL that is unknown, so the count of what was fetched still rides.
  const uncountable = shapeCrowds.filter((c) => c.total_hits == null && c.error !== true && c.deferred !== true);
  if (uncountable.length) blindSpots.push({
    kind: "uncountable-slice",
    detector: "crowd descriptor whose total_hits is null — the register would not state a total, so the size of this zone is UNKNOWN and no completeness claim can rest on it",
    count: uncountable.length,
    zones: uncountable.map((c) => ({ query: c.query, total_hits: null, fetched: c.fetched, reason: c.reason })),
  });
  const unenumerated = shapeCrowds.filter((c) => (c.total_hits ?? 0) > (c.fetched ?? 0));
  if (unenumerated.length) blindSpots.push({
    kind: "unenumerated-crowd",
    detector: "crowd descriptor with total_hits > fetched — a slice the funnel could not enumerate to has_more:false",
    count: unenumerated.length,
    // — WHAT WAS ACTUALLY READ, so the coverage statement can say it. The owner's ask was one
    // line naming how many search terms exceeded the read limit and that the register's first N were
    // read; `count` is the first half and `read_depth` is the second. Reported as OBSERVED rather
    // than as the configured ceiling: the enumerate ceiling is a per-provider `ceilingDefault` in four
    // separate capabilities files and signa's own comment says the global figure is wrong for at least
    // one shape, so quoting a constant here would ship a plausible wrong number. What each slice
    // actually fetched cannot be wrong.
    read_depth: [...new Set(unenumerated.map((c) => c.fetched ?? 0))].sort((a, b) => a - b),
    zones: unenumerated.map((c) => ({ query: c.query, total_hits: c.total_hits, fetched: c.fetched })),
  });
  if (unclassifiable.length) blindSpots.push({
    kind: "unclassifiable-record",
    detector: "record whose mark_text yields no Latin skeleton under normalizeElement — the mechanical tiers cannot compare it; judgment must read it itself",
    count: unclassifiable.length,
    records: unclassifiable,
  });
  for (const [scripts, g] of [...scriptGaps.entries()].sort()) blindSpots.push({
    kind: "script-gap",
    detector: `Unicode script class match (${scripts}) on mark_text — a non-Latin mark the Latin classifier is blind to`,
    scripts,
    count: g.count,
    sample: g.sample,
  });

  const shape = {
    schema_version: BAND_SHAPE_SCHEMA_VERSION,
    role: "deterministic shape of the merged register band — judgment reads each group by the size sentence at its head and looks up records through the band tools (every lookup is logged); machine checks keep reading the complete band; tiers are mechanical string classes, never a relevance or materiality judgment",
    targets: prepared.map((t) => t.text),
    in_scope_classes: [...scope].sort(),
    totals: { records: records.length, crowds: crowds.length, by_tier: byTier },
    floors: { in_class_identical_or_near: floorsOrdered },
    groups,
    by_class: byClass,
    by_status: byStatus,
    by_registry: byRegistry,
    recency: { by_application_year: byYear },
    owners: {
      distinct: owners.size,
      concentrations,
      count_only_zones: countOnlyOwnerZones.map((c) => ({ query: c.query, total_hits: c.total_hits })),
    },
    crowds: shapeCrowds,
    blind_spots: blindSpots,
    // P2-A (charter P2d) — the exact-identity positions projection, when the driver derived one:
    // collapse ratio + the multi-record positions (same right across territories). Full detail
    // (every position incl. singletons, constituents, bridges) lives in _driver/register-positions.json.
    ...(positions ? { positions: {
      records: positions.totals.records,
      positions: positions.totals.positions,
      bridges: positions.totals.bridges,
      multi_record: positions.positions.filter((p) => p.records.length > 1).length,
      // owner-divergent number bridges that were NOT folded (review problem 4) — asserted, 0 included
      cross_references: positions.totals.cross_references ?? 0,
    } } : {}),
  };

  const { md, lines } = bandShapeMdLines(shape, { positions });
  shape.md_lines = lines;
  return { shape, md };
}

const fmtN = (n) => Number(n ?? 0).toLocaleString("en-US");
const cell = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";

// Bounded aggregate table: top rows by count, one honest remainder line — never for the floors.
function topTable(md, title, cols, entries, cap = 30) {
  const rows = Object.entries(entries).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  md.push("", `### ${title}`, "", `| ${cols[0]} | ${cols[1]} |`, "|---|---|");
  for (const [k, v] of rows.slice(0, cap)) md.push(`| ${cell(k)} | ${fmtN(v)} |`);
  if (rows.length > cap) md.push(`| … ${fmtN(rows.length - cap)} more (full detail in band-shape.json) | |`);
}

/** The readable mirror, served in parts when large; each floor is marked on its line, and the data keeps them all. PURE. */
/**
 * §8 — mark → the sharpest floor tier that mark holds, for the write-up-form predicate.
 *
 * THE JOIN KEY IS `mark_text`, AND THE SPEC SAYS WHY: a floor row has no `mark` field, so joining on one
 * returns a clean, plausible ZERO — every mark reads as holding no floor, every floor silently loses its
 * full card, and nothing anywhere reports a miss. That shape has already inverted one measurement on
 * this issue. The finding side supplies its own `mark`; both are normalised through `normMark`, the same
 * function the floors were built with, so the two sides cannot normalise differently.
 *
 * `identical` WINS over `near-identical` when a mark holds both, because the ruling is about the sharper
 * one: taking whichever row happened to be visited last would drop a full card on a record ordering.
 *
 * Returns an empty Map when there is no shape — an absent band-shape is a run with no floors to honour,
 * and the caller's `?? null` then reads as "no floor", which is the same answer it had before this
 * existed. PURE.
 */
export function floorTierByMark(shape) {
  const out = new Map();
  for (const row of shape?.floors?.in_class_identical_or_near ?? []) {
    const key = normMark(row?.mark_text);
    if (!key) continue;
    const tier = String(row?.tier ?? "");
    if (out.get(key) === "identical") continue;
    if (tier === "identical" || !out.has(key)) out.set(key, tier);
  }
  return out;
}

/** The same normalisation the floors were built with, so a caller cannot key the map differently. */
export const floorMarkKey = (s) => normMark(s);

// One line per mark of an owner, about 150 characters: the goods words it matched, never the goods text, and
// whether it holds a floor. Each list carries the method's size sentence for its own length: read them all;
// read the near ones first and list the rest; or, at a thousand records or more, the count and the first page.
const GROUP_HEADINGS = {
  a: "(a) Identical or near-identical to the mark or one of its forms, live in the ordered classes, for the client's goods",
  b: "(b) Identical or near-identical to the mark or one of its forms, in the ordered classes",
  c: "(c) The same family as the mark, or carrying the searched word, for the client's goods",
  d: "(d) Every other live mark in the ordered classes, for the client's goods",
};
export const READ_ALL_LINES = 50;
/** How many lines of the band hold a floor, wherever the shape put them. PURE. */
const floorLineCount = (groups) => ["a", "b", "c", "d", "no_goods"].reduce((n, g) => n + (groups[g]?.list ?? []).filter((l) => l.floors > 0).length, 0);
/** The lookup that pages a group, as the shape and the form's refusal both name it, so the two cannot drift. */
export const groupPageCall = (g) => `band_lookup {"group":"${g}"}`;

// PLACEMENT'S ORDERS IN THE SHAPE. Three sentences under the groups tell the reader to give every line a fate,
// and only placement owes the groups that. The band server serves the shape without them to every other
// stage (the owner's ruling, 2026-10-14), so they are declared once here and removed there by these same strings.
export const SORT_THE_NEAR_ONES = "A few hundred? Sort by the client's goods and markets, read the near ones first, list the rest.";
export const ONE_SET_ASIDE_ROW = "Write down what you set aside and why: one row, with this count.";
export const A_FATE_BY_NAME = "Each line takes its own fate by name; no group row covers these lines.";
export const PLACEMENT_GROUP_ORDERS = Object.freeze([SORT_THE_NEAR_ONES, ONE_SET_ASIDE_ROW, A_FATE_BY_NAME]);

// AND THE FATES THE GROUPS' SIZE SENTENCES ORDER (ruled 2026-10-18). Five more of placement's orders sit inside the
// groups' size sentences, and the shape's commands to page a group name a lookup only placement is offered. Every
// other stage is served the shape without them, removed by these same strings (`withoutPlacementOrders`); each
// group's identity, members and count stay, and so does the fact that a crowded group prints only its first page.
export const FLOORS_BY_NAME_HERE = "Every floor here is placed or set aside by name; this group's row covers only its other lines.";
export const A_CROWDS_ONE_ROW = "Read the first page, carry forward any line a lawyer would raise, and set the rest aside in this group's one row with the count: the client is told the field is crowded.";
export const A_CROWDS_ROW_COVERS_A_READ_FLOOR = "This row covers a floor only once you have read its line.";
export const AN_UNREAD_CROWDS_ONE_ROW = "Carry forward any line a lawyer would raise, and set the rest aside in this list's one row with the count, on the ground that their goods are unreadable and the field is crowded.";
export const AN_UNREAD_CROWDS_FLOOR = "A floor here is placed or set aside by name on its status or its territory; this row never covers it.";
export const AN_UNREAD_LISTS_FLOOR = "A floor here is placed, or set aside by name on its status or its territory; any other line may be set aside on the ground that its goods are unknown.";
// What placement does with a line of that list before its fate, by its marker (approved wording, 2026-10-19). Placement's
// alone, as its other orders are: every other stage keeps the markers as evidence and is not told of a fate.
export const AN_UNREAD_LINE_IS_CHECKED = 'A line marked "on file, not readable", "cut by the register, no goods word found", "goods held; completeness not established" or "no goods text held; completeness not established" must be checked with band_record before its fate. Read the evidence held for it, keeping its source and goods completeness clear. A line marked "no goods on file", "fetch failed, no goods on file" or "the register\'s record lists no goods" has no goods text on file. Missing goods do not establish that the goods are unrelated.';
export const PLACEMENT_LINE_ORDERS = Object.freeze([FLOORS_BY_NAME_HERE, A_CROWDS_ONE_ROW, A_CROWDS_ROW_COVERS_A_READ_FLOOR, AN_UNREAD_CROWDS_ONE_ROW, AN_UNREAD_CROWDS_FLOOR, AN_UNREAD_LISTS_FLOOR, AN_UNREAD_LINE_IS_CHECKED]);
const SHAPE_LISTS = ["a", "b", "c", "d", "rest", "no_goods"];
const pageEveryOtherLine = (g) => `; page every other line with ${groupPageCall(g)}`;
const pageWhereALineNeedsIt = (g) => `; page with ${groupPageCall(g)} only where a line needs reading`;
const pageTheFloorsLeft = (g) => `Where more floors are counted than this page shows, page the rest with ${groupPageCall(g)}; they come first.`;
/**
 * The shape as every stage but placement is served it: placement's orders and its group-page commands removed,
 * each with the space before it, inside its line, so no line moves and the line each listed mark is printed on
 * still holds. A crowded group's "The first N lines are below" stays, as a fact about what is printed. PURE.
 */
export function withoutPlacementOrders(text) {
  let t = String(text ?? "");
  for (const order of [...PLACEMENT_GROUP_ORDERS, ...PLACEMENT_LINE_ORDERS, ...SHAPE_LISTS.map(pageTheFloorsLeft)]) t = t.split(` ${order}`).join("").split(order).join("");
  for (const g of SHAPE_LISTS) t = t.split(pageEveryOtherLine(g)).join("").split(pageWhereALineNeedsIt(g)).join("");
  return t;
}

function renderGroupsMd(md, groups, rows = []) {
  md.push("", "## The band in the lawyer's order — for the client's goods first", "");
  if (groups.dominant_term && groups.manifest_dominant && normKey(groups.dominant_term) !== normKey(groups.manifest_dominant))
    md.push(`Sorted on «${cell(groups.dominant_term)}», the word the register's goods-narrowed search asked for (the variants stage named «${cell(groups.manifest_dominant)}»).`, "");
  // The words the goods test read, and where they came from: the client's product words, or, where the
  // variants stage named none, the words the register search was narrowed by. A fallback is said, never silent.
  const tested = groups.goods_test ?? { source: "none", words: [] };
  const named = tested.words?.length ? `: ${tested.words.map((w) => `«${cell(w)}»`).join(", ")}` : "";
  md.push(tested.source === "product_words"
    ? `The goods test reads each record's goods for the client's product words${named}.`
    : tested.source === "goods_words"
      ? `No product words were given, so the goods test reads each record's goods for the words the register search was narrowed by${named}. They include words other filings use for the same goods, so "for the client's goods" below is wider than the client's own product.`
      : "No goods words were given, so no record was tested on its goods.", "");
  if (groups.territories_unread?.length)
    md.push(`The order names ${groups.territories_unread.map((t) => `«${cell(t)}»`).join(", ")}, which the engine cannot read as a territory, so the list holds every register.`, "");
  else if (groups.territories?.length) md.push(`The list holds the order's territories: ${groups.territories.join(", ")}.`, "");
  if (groups.markets?.length) md.push(`The client's markets: ${groups.markets.join(", ")}.`, "");
  const total = groups.goods_words_total || 0;
  const word = groups.dominant_term || groups.manifest_dominant;
  const carrying = word ? `carrying «${cell(word)}»` : "carrying the searched word";
  const heading = (g) => (g === "c" ? `(c) The same family as the mark, or ${carrying}, for the client's goods` : GROUP_HEADINGS[g]);
  // A line the goods test could not place says why, from what its goods rest on: cut by the register, held but not
  // established whole (with goods text, or with none, as a held record with no goods field is), the register's
  // record listing none, a fetch that failed, or nothing held. Goods held whole that the test still could not read
  // are in a language it cannot use. A shape derived with no record of the goods evidence reads as it always did.
  const unread = (l) => {
    if (tested.source === "none") return "—";
    if (l.goods_evidence === "cut") return "cut by the register, no goods word found";
    if (l.goods_evidence === "unknown") return l.goods_text === false ? "no goods text held; completeness not established" : "goods held; completeness not established";
    if (l.goods_evidence === "absent") return "the register's record lists no goods";
    if (l.goods_evidence === "unavailable") return "fetch failed, no goods on file";
    if (l.goods_evidence === "complete") return "on file, not readable";
    return l.goods_on_file ? "on file, not readable" : "no goods on file";
  };
  const words = (l) => (l.goods_words == null ? unread(l)
    : `${fmtN(l.goods_words.length)} of ${fmtN(total)}${l.goods_words.length ? `: ${l.goods_words.join(", ")}` : ""}${l.floor_goods ? ` «${l.floor_goods}»` : ""}`);
  const count = (grp) => `${fmtN(grp.records)} records in ${fmtN(grp.lines)} lines from ${fmtN(grp.owners)} owners`;
  const where = (l) => `${l.territories.join(",")}${l.outside ? " (outside the order)" : ""}`;
  const row = (l) => `| ${cell(l.mark)} | ${cell(l.owner_name)} | ${cell(l.classes.join(","))} | ${fmtN(l.live)} of ${fmtN(l.records)} | ${cell(where(l))} | ${cell(words(l))} | ${l.floors > 0 ? "yes" : "no"} | ${cell(l.record_id)} |`;
  const head = ["| mark | owner | classes | live | territories | goods words | floor | record |", "|---|---|---|---|---|---|---|---|"];
  // A crowded group's own words for what it holds, in the crowded-field method's sentence (ruled 2026-10-12).
  const crowd = { b: "identical marks in the ordered classes for other goods than the client's",
    c: "marks of the same family as the mark, or carrying the searched word, for the client's goods", d: "other marks in the ordered classes for the client's goods" };
  const firstPage = `The first ${fmtN(groups.first_page)} lines are below`;
  for (const g of ["a", "b", "c", "d"]) {
    const grp = groups[g];
    md.push(`### ${heading(g)}`, "");
    if (!grp.lines) { md.push("(none)", ""); continue; }
    const crowded = grp.records >= groups.crowded_at;
    const readA = "These are the identical and near-identical marks live in the ordered classes for the client's goods: read every line.";
    md.push(g === "a"
      ? (crowded
        ? `${count(grp)}. ${readA} ${firstPage}${pageEveryOtherLine(g)}. ${FLOORS_BY_NAME_HERE}`
        : grp.lines <= READ_ALL_LINES ? `${count(grp)}. Fifty? Read them all.` : `${count(grp)}. ${readA}`)
      : crowded
        ? `${count(grp)}. A thousand or more? The field is crowded. These are ${crowd[g]}. ${A_CROWDS_ONE_ROW} ${firstPage}${pageWhereALineNeedsIt(g)}.${
          g === "b" ? ` ${A_CROWDS_ROW_COVERS_A_READ_FLOOR} ${pageTheFloorsLeft(g)}` : ""}`
        : grp.lines <= READ_ALL_LINES
          ? `${count(grp)}. Fifty? Read them all.`
          : `${count(grp)}. ${SORT_THE_NEAR_ONES}`, "");
    md.push(...head);
    for (const l of crowded ? grp.list.slice(0, groups.first_page) : grp.list) { rows.push([md.length, l.key]); md.push(row(l)); }
    md.push("");
  }
  const outside = groups.outside?.lines ? `, ${fmtN(groups.outside.lines)} lines of them held only outside the ordered territories` : "";
  // The rest is read by the size rule too: listed under a thousand records, by its first page at a thousand or
  // more, where its one row stands on that page read and the count.
  const rest = groups.rest;
  const restCrowded = rest.records >= groups.crowded_at;
  md.push(`**The rest: ${count(rest)}${outside}** — every record in none of (a) to (d) above. ${!rest.lines ? ONE_SET_ASIDE_ROW
    : restCrowded
      ? `A thousand or more? The field is crowded. ${A_CROWDS_ONE_ROW} ${firstPage}${pageWhereALineNeedsIt("rest")}.`
      : `${rest.lines <= READ_ALL_LINES ? "Fifty? Read them all." : SORT_THE_NEAR_ONES} ${ONE_SET_ASIDE_ROW}`}`);
  if (rest.lines) {
    md.push("", ...head);
    for (const l of restCrowded ? rest.list.slice(0, groups.first_page) : rest.list) { rows.push([md.length, l.key]); md.push(row(l)); }
  }
  if (groups.no_goods.lines) {
    // The lines the goods test could not place, read by the same size rule (ruled 2026-10-12): under a thousand
    // records, a fate per line by name, opened where goods are on file; at a thousand or more, the first page,
    // and one row on the rest whose goods are unreadable in a crowded field. A floor is never set aside on
    // its goods, so a floor here is placed or set aside on its status or territory.
    const ng = groups.no_goods;
    const crowded = ng.records >= groups.crowded_at;
    const lead = tested.source === "none"
      ? `**Not tested on goods: ${count(ng)}.** No goods words were given, so the goods test could not place them.`
      : `**Goods the test could not read: ${count(ng)}.**`;
    md.push("", crowded
      ? `${lead} A thousand or more? ${firstPage}, the floors first, then the live ones in the ordered classes. ${AN_UNREAD_CROWDS_ONE_ROW} ${AN_UNREAD_CROWDS_FLOOR} ${pageTheFloorsLeft("no_goods")}`
      : `${lead} ${ng.lines <= READ_ALL_LINES ? "Fifty? Read them all." : "A few hundred? Read the live ones in the ordered classes first."} ${A_FATE_BY_NAME}${tested.source === "none" ? "" : ` ${AN_UNREAD_LINE_IS_CHECKED}`} ${AN_UNREAD_LISTS_FLOOR}`, "");
    md.push(...head);
    for (const l of crowded ? ng.list.slice(0, groups.first_page) : ng.list) { rows.push([md.length, l.key]); md.push(row(l)); }
  }
}

export function renderBandShapeMd(shape, { positions = null } = {}) {
  return bandShapeMdLines(shape, { positions }).md;
}

/**
 * The readable shape, and the md line each listed line is printed on: `{ md, lines: {lineKey: lineNumber} }`,
 * 0-based over `md.split("\n")`. The band server reads `lines` from the shape's data to log which lines a
 * part it serves holds, so a group's row is checked against what the step read, not against what was
 * printed. PURE.
 */
export function bandShapeMdLines(shape, { positions = null } = {}) {
  const md = [], rows = [];
  md.push("# Band shape — the register band, mechanically mapped");
  md.push("");
  md.push("Deterministic projection of the complete merged register band (code-derived after every band");
  md.push("re-merge; no model wrote a word of it). Tiers are mechanical string classes over the mark and its");
  md.push("manifest variants — never a relevance or risk judgment. Use the band tools to pull any record or");
  md.push("slice named here (band_lookup / band_record); every lookup is logged to the run's reading audit.");
  md.push("");
  md.push(`Targets classified against: ${shape.targets.map((t) => `**${t}**`).join(", ") || "(none)"}.`);
  md.push(`In-scope classes: ${shape.in_scope_classes.length ? shape.in_scope_classes.join(", ") : "(no class filter)"}.`);
  md.push("");
  md.push(`**${fmtN(shape.totals.records)} enumerated record(s)**, **${fmtN(shape.totals.crowds)} crowd descriptor(s)**.`);
  md.push("");
  md.push("| tier | records |");
  md.push("|---|---|");
  for (const t of SHAPE_TIERS) md.push(`| ${t} | ${fmtN(shape.totals.by_tier[t])} |`);

  // THE FLOORS ARE MARKED ON THEIR LINES, NOT LISTED A SECOND TIME (ruled 2026-10-12). The band in the ruled order
  // carries every floor as a line, and a per-record list of the same records was most of a crowded shape the
  // step had to read whole before it could act. The shape's data keeps every floor for the floor duty, and
  // `band_lookup` returns any floor record on request.
  const floors = shape.floors.in_class_identical_or_near;
  const floorLines = shape.groups ? floorLineCount(shape.groups) : null;
  md.push("", floors.length
    ? `**Floors: ${fmtN(floors.length)} records${floorLines != null ? ` in ${fmtN(floorLines)} lines` : ""}** — every live in-class identical or near-identical record, each marked on its line in the band below.`
    : "**Floors:** none — no live in-class record classified identical or near-identical to any target.");

  if (shape.groups) renderGroupsMd(md, shape.groups, rows);

  topTable(md, "By Nice class", ["class", "records"], shape.by_class);
  topTable(md, "By status", ["status", "records"], shape.by_status);
  topTable(md, "By registry", ["registry", "records"], shape.by_registry);
  topTable(md, "By application year", ["year", "records"], shape.recency.by_application_year, 20);

  md.push("", "## Owners", "");
  md.push(`${fmtN(shape.owners.distinct)} distinct owner name(s). Largest holdings:`);
  md.push("", "| owner | records | live |", "|---|---|---|");
  for (const o of shape.owners.concentrations) md.push(`| ${cell(o.owner_name)} | ${fmtN(o.records)} | ${fmtN(o.live)} |`);

  if (positions) {
    // P2-A (charter P2d) — SAME RIGHT → ONE POSITION, territories listed. Exact-identity arithmetic
    // only (mark+owner / UK009-clone / IR-base); similar-rights and related-owner folds stay judgment.
    const multi = positions.positions.filter((p) => p.records.length > 1);
    md.push("", "## Positions — same right across territories (exact-identity projection)", "");
    md.push(`**${fmtN(positions.totals.records)} record(s) collapse to ${fmtN(positions.totals.positions)} position(s)** ` +
      `(bridges: ${Object.entries(positions.totals.bridges).map(([k, v]) => `${k} ×${fmtN(v)}`).join(", ") || "none"}). ` +
      `One Sheet-1 row per POSITION, ANY ONE constituent URI cited — never one row per registration. The band keeps ` +
      `every record; this is a projection. An owner divergence NEVER folds two registrations into one position ` +
      `(see Cross-references below — they stay separate rights). Full detail incl. singletons: _driver/register-positions.json.`);
    if (multi.length) {
      md.push("", "| mark | owner | records | classes | territories | bridges |", "|---|---|---|---|---|---|");
      for (const p of multi.slice(0, 30)) {
        md.push(`| ${cell(p.mark_text)} | ${cell(p.owners.join("; "))} | ${fmtN(p.records.length)} | ${cell(p.classes.join(","))} | ${cell(p.territories.join(","))} | ${cell([...new Set(p.bridges.map((b) => b.kind))].join(",") || "mark-owner")} |`);
      }
      if (multi.length > 30) md.push(`| … ${fmtN(multi.length - 30)} more multi-record position(s) (register-positions.json carries all) | | | | | |`);
    }
    // ROUND-2 (review problem 4): the owner-divergent number arithmetic, surfaced as its OWN list.
    // These pairs are a clone/IR linkage on record whose two sides name different owners — most often
    // an assignment recorded at one office and not the other. They are TWO positions here on purpose;
    // whether they are one right is judgment, made openly, and the fold is the lawyer's to make.
    const xrefs = positions.cross_references ?? [];
    md.push("", `**Cross-references — ${fmtN(xrefs.length)} owner-divergent number bridge(s)** (registration arithmetic links the two records but the owners differ, so they stay SEPARATE positions — fold them only on your own reasoning).`);
    if (xrefs.length) {
      md.push("", "| kind | record A (owner) | record B (owner) | arithmetic |", "|---|---|---|---|");
      for (const b of xrefs.slice(0, 30)) {
        md.push(`| ${cell(b.kind)} | ${cell(b.from)} (${cell(b.owner_divergence?.[0])}) | ${cell(b.to)} (${cell(b.owner_divergence?.[1])}) | ${cell(b.detail)} |`);
      }
      if (xrefs.length > 30) md.push(`| … ${fmtN(xrefs.length - 30)} more (register-positions.json carries all) | | | |`);
    }
  }

  md.push("", "## Crowds — slices the funnel could not enumerate", "");
  if (!shape.crowds.length) md.push("(none — every dispatched slice enumerated to has_more:false)");
  for (const c of shape.crowds) {
    // — THE SURFACE JUDGMENT READS MOST DIRECTLY, and the plainest form the defect took: a
    // slice the provider REFUSED was rendered here as "0 hit(s), 0 fetched", which is a crowd with
    // nothing in it. The executor's 0 is a placeholder next to an `error` stamp, never a count, so a
    // refused slice states that instead of a figure. Found by the arm in
    // refused-slice-is-not-a-counted-zero.test.mjs after the blind-spot mirror below was already
    // fixed — two renderers, one defect, and the second was the one that mattered more.
    const refusal = c.deferred === true ? "capability gap — the provider cannot express this slice"
      : c.error === true ? "provider error — the slice was never answered" : null;
    // — an UNKNOWN total renders as unknown. `fmtN(null)` is "0", so this line used to print
    // "0 hit(s)" directly beside the vendor's own sentence saying no count could be taken — the
    // artifact contradicting itself within one line.
    md.push(refusal
      ? `- \`${cell(c.query)}\` — NEVER ANSWERED (${refusal}); no count was taken, so this slice is unsearched, not empty. ${cell(c.reason)}`
      : c.total_hits == null
        ? `- \`${cell(c.query)}\` — SIZE UNKNOWN (the register would not state a total), ${fmtN(c.fetched)} fetched. No completeness claim can rest on this slice. ${cell(c.reason)}`
        : `- \`${cell(c.query)}\` — ${fmtN(c.total_hits)} hit(s), ${fmtN(c.fetched)} fetched. ${cell(c.reason)}`);
    for (const s of c.crowd_context_slice ?? []) {
      md.push(`  - crowd-context slice: ${cell(s.unit ?? s.axis)} (${(s.terms ?? []).join(", ")})${s.exact_subset_enumerated ? ` — exact/near-identical subset FULLY enumerated (${fmtN(s.exact_subset_total)} record(s), see crowd-context.md)` : ""}`);
    }
  }

  md.push("", "## Blind spots — what this shape mechanically cannot see", "");
  if (!shape.blind_spots.length) md.push("(none detected)");
  for (const b of shape.blind_spots) {
    md.push(`- **${b.kind}** (${fmtN(b.count)}) — detector: ${b.detector}`);
    // — a zone with NO count must not be rendered with one. A refused slice carries no
    // total_hits at all, and the old unconditional `${fmtN(z.total_hits)} hit(s)` would have printed a
    // hit figure for the one row whose whole point is that no figure was ever taken — the defect this
    // change removes, reappearing in the prose mirror one line later.
    for (const z of (b.zones ?? []).slice(0, 20)) {
      // — two different reasons a zone carries no total, and they are not interchangeable: a
      // REFUSED slice never ran, an UNCOUNTABLE one ran and the register would not size it.
      const counts = z.total_hits != null
        ? `${fmtN(z.total_hits)} hit(s)${z.fetched != null ? `, ${fmtN(z.fetched)} fetched` : ""}`
        : b.kind === "uncountable-slice"
          ? `size UNKNOWN — the register stated no total${z.fetched != null ? `, ${fmtN(z.fetched)} fetched` : ""}`
          : `never answered${z.kind ? ` (${cell(z.kind)})` : ""} — no count was taken`;
      md.push(`  - \`${cell(z.query)}\` — ${counts}`);
    }
    for (const r of (b.records ?? b.sample ?? []).slice(0, 20)) md.push(`  - ${cell(r.mark_text)} (${cell(r.record_id)})`);
    if ((b.records ?? b.sample ?? b.zones ?? []).length > 20) md.push(`  - … and ${fmtN((b.records ?? b.sample ?? b.zones).length - 20)} more (band-shape.json carries all)`);
  }
  md.push("");
  // A pushed element may hold line breaks of its own, so each row's line number counts the breaks before it.
  const lines = {};
  let at = 0, line = 0;
  for (const [index, key] of rows) {
    for (; at < index; at++) line += 1 + (md[at].match(/\n/g)?.length ?? 0);
    if (key != null) lines[key] = line;
  }
  return { md: md.join("\n"), lines };
}
