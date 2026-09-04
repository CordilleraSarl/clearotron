// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// band-shape.mjs — the DETERMINISTIC SHAPE of the merged register band (PR-8, Thread D1).
//
// The 2026-07-28 postmortem's lesson: the merged band is megabytes (median 5.2MB across the archive; Read hard-refuses
// >256KB), so judgment never read it whole — every stage sliced it with improvised, unreviewed shell
// (digest#2: 71 ad-hoc Bash calls). This module is the reading layer's frozen-plan equivalent: a PURE,
// deterministic projection of the band that fits in one Read (<256KB by construction for everything
// except the unconditional floors), derived by the driver after EVERY named-band re-merge.
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
 * `CHROMA & Device` is one mark plus a device note.
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
    // R1 retrieved TEN exact-match 色度 registrations — four REGISTERED, three in class 9, all in the
    // matter's own classes — and the delivered report did not mention the token once. This line is
    // where they went. `normalizeElement` keeps only Latin characters, so a Han mark normalises to the
    // empty string, fell straight to `unclassifiable`, and `unclassifiable` is not one of the two tiers
    // the floors accept (see THE FLOORS below). The records were recorded as a script BLIND SPOT —
    // context for judgment — instead of as floor rows, which are the list where every entry must be
    // weighed. Retrieved, banded, positioned, and never an obligation.
    //
    // The classifier could not COMPARE them; that is true, and it is not the same as could not MATCH
    // them. 色度 equals 色度 by inspection. The precedent is in this repo already: reference-score's
    // matchesReference makes RAW comparison its rule 1 for exactly this case, because normalizeElement
    // keeps only [a-z0-9] and a CJK mark folds to the empty string that every Latin rule would match
    // against everything. The scorer has had that rule since R1's Chinese registration was specced. The
    // engine's own classifier never got it.
    //
    // EQUALITY ONLY, DELIBERATELY. The floors are mechanical obligations a lawyer must answer row by
    // row, so every member has to be defensible without judgment: raw-equal after NFKC (which folds
    // full-width and compatibility forms of the same characters) is that. Containment is not — 色度計
    // contains 色度 and is a different mark — and whether it matters is judgment's call, reached
    // through the same-family tiers and the crowd descriptors, not by widening a floor.
    //
    // THIS PARAGRAPH USED TO SAY "narrower than the scorer's rule", and it was right when it was
    // written: matchesReference's script rule was unowned containment in both directions until,
    // which scored gold 色度 as retrieved off a different proprietor's 色度花间. The scorer now takes
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
  // Measured against the scorer on `origin/main`: `VENZAL / VENZALMONO / VENZALKOMB` and `CHROMA &
  // Device` are `alias` to reference-score and `same-family / token-identical` here. Not dropped —
  // tiered BELOW the line. The floors take `identical` and `near-identical` only, so a register record
  // that IS the mark under a relabelling never became a row a lawyer had to answer. Same consequence as
  // member 1, different cause: member 1 could not compare at all, this one compares and under-rates.
  //
  // ALIAS SEPARATORS ONLY, and the distinction is reference-score's, kept deliberately identical
  // because the two must agree about what a relabelling IS: `/ , · & |` separate ALTERNATIVE NAMES for
  // one record; whitespace and hyphens separate WORDS WITHIN one name. Conflating them makes every
  // multi-word mark match its own first word — `TIKI TWIST` would become `TIKI`, which is a different
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
  return { tier: "other", target: null, basis: "no-mechanical-match" };
}

// ── dominant-element composites (P2-A, the recall spine) ────────────────────────────────────────────
// The candidate set of the retrieved→judgment reconciliation: every LIVE, in-scope, SCREEN-SURFACED
// record whose mark carries the manifest's dominant element — as a standalone token
// (`token-identical`), a token one edit away (`token-edit-1`), or CONCATENATED inside a longer
// squashed word (`concatenation` — the TIKITONK class: same-family in substance, "other" to the
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
// (TIKITONK), which is a property of one token.
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
  const scope = new Set((inScopeClasses ?? []).map((c) => String(c).trim()).filter(Boolean));
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
//       Corporation" work, but on the same band it also collapsed "Tiki Group Limited", "Tiki AG"
//       and "Tiki Corporation" to the bare core "tiki" and merged three distinct registrants on the
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
 *  "Tiki AG" and "Tiki Corporation" land in different buckets while "X Corp."/"X Corporation" share
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
const classesOf = (r) => (Array.isArray(r?.classes) ? r.classes : r?.classes != null ? [r.classes] : []).map((c) => String(c).trim()).filter(Boolean);
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
export function buildBandShape(band, { targets = [], inScopeClasses = [], crowdContext = null, caps = {}, positions = null } = {}) {
  const prepared = prepareTargets(Array.isArray(targets) && targets.every(isPrepared) ? targets.map((t) => t.text) : targets);
  const records = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const crowds = Array.isArray(band?.crowds) ? band.crowds : [];
  const scope = new Set((inScopeClasses ?? []).map((c) => String(c).trim()).filter(Boolean));
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

  for (const r of records) {
    const cls = classifyRecord(r?.mark_text, prepared);
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
  const concentrations = [...owners.entries()]
    .map(([owner_name, v]) => ({ owner_name, records: v.records, live: v.live }))
    .sort((a, b) => b.records - a.records || a.owner_name.localeCompare(b.owner_name))
    .slice(0, ownerCap);

  // Crowd descriptors + the crowd-context JOIN (compose with QW1's artifact; never mutate it): a
  // context slice joins a crowd when one of its terms appears in the crowd's query (case-folded).
  const ccSlices = Array.isArray(crowdContext?.slices) ? crowdContext.slices : [];
  const fold = (s) => foldDiacritics(String(s ?? "")).toLowerCase();
  const shapeCrowds = crowds.map((c) => {
    const q = fold(c.query);
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
    role: "deterministic shape of the merged register band — judgment reads THIS whole and looks up records through the band tools (every lookup is logged); machine checks keep reading the complete band; tiers are mechanical string classes, never a relevance or materiality judgment",
    targets: prepared.map((t) => t.text),
    in_scope_classes: [...scope].sort(),
    totals: { records: records.length, crowds: crowds.length, by_tier: byTier },
    floors: { in_class_identical_or_near: floorsOrdered },
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

  return { shape, md: renderBandShapeMd(shape, { positions }) };
}

const fmtN = (n) => Number(n ?? 0).toLocaleString("en-US");
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";

// Bounded aggregate table: top rows by count, one honest remainder line — never for the floors.
function topTable(md, title, cols, entries, cap = 30) {
  const rows = Object.entries(entries).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  md.push("", `### ${title}`, "", `| ${cols[0]} | ${cols[1]} |`, "|---|---|");
  for (const [k, v] of rows.slice(0, cap)) md.push(`| ${cell(k)} | ${fmtN(v)} |`);
  if (rows.length > cap) md.push(`| … ${fmtN(rows.length - cap)} more (full detail in band-shape.json) | |`);
}

/** The readable mirror — small enough to Read whole; the floors section is complete by contract. PURE. */
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

export function renderBandShapeMd(shape, { positions = null } = {}) {
  const md = [];
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

  const floors = shape.floors.in_class_identical_or_near;
  md.push("", "## Floors — every LIVE in-class identical / near-identical record (complete list, never sampled)", "");
  if (!floors.length) {
    md.push("(none — no live in-class record classified identical or near-identical to any target)");
  } else {
    md.push("| mark | tier | target | classes | status | owner | registry | record |");
    md.push("|---|---|---|---|---|---|---|---|");
    for (const f of floors) {
      md.push(`| ${cell(f.mark_text)} | ${f.tier} | ${cell(f.matched_target)} | ${cell(f.classes.join(","))} | ${cell(f.status)} | ${cell(f.owner_name)} | ${cell(f.registry)} | ${cell(f.record_id)} |`);
    }
  }

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
  return md.join("\n");
}
