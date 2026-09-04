// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// party-facts.mjs — a factual assertion about a named party must resolve to a source the run holds,
// AND to a source of a kind that can support it.
//
//, split from criterion 4. A delivered clearance narrative described the client's own
// company: a named therapeutic pipeline, and a named commercial agreement. Two elements of that
// sentence were sourced and stand. Three were not, and they failed in three DIFFERENT ways:
//
//   INVENTED      a named indication that occurs in NO run artifact. Not in the 855 fetched record
//                 bodies, not in the common-law grid, not in any findings or report surface. Every
//                 occurrence run-wide is downstream of the sentence itself — the seat's own output, the
//                 reviewer quoting it back, and the correction recording its removal.
//
//   CONTRADICTED  the company's own description WAS in the grid and said something materially
//                 different. The cited source is literally an announcement of a strategic INVESTMENT;
//                 the narrative called it a manufacturing agreement.
//
//   CATEGORY      a second named indication that is REAL and IS in the run — in the US application's
//                 class-5 goods wording. That is a statement of what the mark is registered FOR. The
//                 narrative rendered it as what the company's pipeline IS.
//
// ── WHY THE THIRD SHAPE DECIDES THE DESIGN ───────────────────────────────────────────────────────────
//
// A traceability rule that asks "does this token appear in some source" PASSES the category case,
// because the token does appear. It is not a sourcing failure; it is a claim about a registration's
// scope re-presented as a claim about a company's activities. So the rule cannot key on presence. It
// keys on WHICH KIND OF DOCUMENT the term came from, which is why this module partitions the run's text
// before it tests anything.
//
//   DESCRIPTIVE          the common-law grid (candidate titles and extras) and the matter context.
//                        Material about parties. This is the only corpus that can support a claim
//                        about what a company does.
//
//   REGISTRATION SCOPE   the `goodsAndServices` field of every fetched record body, and nothing else
//                        from those records. What a mark is registered for. NEVER evidence about a
//                        company's activities, however true the words are.
//
// The registration vocabulary is taken FROM THE RUN rather than from a list written here, so the
// category test needs no judgment about which words are domain terms: a term is testable because this
// run's own goods wording contains it.
//
// ── WHAT THIS DOES NOT COVER, STATED SO A GREEN RUN IS NOT MISREAD ───────────────────────────────────
//
// Deciding which words in a sentence are factual assertions is not solvable deterministically, and a
// check that guessed would false-trip until somebody switched it off. So the extraction is BOUNDED: it
// fires only on a closed set of assertion frames (`developing X`, `pipeline in X`, `an X agreement`,
// `treatment of X`, …), and only inside a paragraph that names a party. A claim phrased outside those
// frames is not examined. WIDENING THE FRAME LIST IS HOW COVERAGE GROWS — a clean result means no
// framed assertion failed, never that the prose is fully sourced.
//
// The CONTRADICTED shape is narrower still. "Materially departs from source" is a semantic judgment;
// what is mechanised here is one closed vocabulary of relationship kinds (investment, acquisition,
// partnership, …). It catches the specimen class and will not catch the next unrelated departure.

/** Assertion frames. Each captures the OBJECT of a factual claim, stopping at sentence punctuation. */
const FRAMES = [
  /\bpipelines?\s+(?:in|for)\s+([^.;:!?]+)/gi,
  /\bdevelop(?:ing|s|ed)?\s+([^.;:!?]+)/gi,
  /\bdevelopment\s+of\s+([^.;:!?]+)/gi,
  /\btreatment\s+of\s+([^.;:!?]+)/gi,
  /\b(?:clinical|preclinical)\s+(?:trials?|programmes?|programs?)\s+(?:in|for)\s+([^.;:!?]+)/gi,
  /\bspecialis(?:es|ing)\s+in\s+([^.;:!?]+)|\bspecializ(?:es|ing)\s+in\s+([^.;:!?]+)/gi,
  /\bfocus(?:es|ed|ing)?\s+on\s+([^.;:!?]+)/gi,
  // "a strategic manufacturing agreement" — the object sits BEFORE the noun here, so the frame reads back.
  /\b(?:an?|the)\s+([A-Za-z][\w-]*(?:\s+[\w-]+){0,3}?)\s+(?:agreement|partnership|collaboration|deal)\b/gi,
];

/** Relationship kinds, for the CONTRADICTED shape. Closed by construction — see the header. */
const RELATIONSHIP_KINDS = ["investment", "acquisition", "merger", "partnership", "licence", "license",
  "manufacturing", "distribution", "collaboration", "supply", "joint venture", "spin-off"];

// Words that carry no domain content. Deliberately SHORT: this list exists to stop grammar, not to
// decide what a domain term is — that decision belongs to the run's own corpora, above.
const STOP = new Set(("a an the and or of in for with on at to from by as is are was were be been being this that these those "
  + "its their his her our your it they we you he she who whom which what when where why how not no nor so than then "
  + "new novel next first second other another such same own more most less least very much many few several some any all "
  + "both each every either neither one two three announced announces announcing including include includes included "
  + "strategic global leading based early late current recent ongoing planned potential possible").split(/\s+/));

// HYPHENS SPLIT. `protease-inhibitor` in a narrative and "protease inhibitors" in the source are the
// same fact, and keeping the hyphen inside the token made the compound resolve to nothing — so a
// CORRECTED report tripped the check and routed itself to the warm redo. Any clean report hyphenating a
// compound would have. Measured on the incident run's corrected narrative.
const words = (s) => String(s ?? "").toLowerCase().replace(/[-\u2010-\u2015]/g, " ").match(/[a-z]{3,}/g) ?? [];

/** Content tokens of a captured assertion object. PURE. */
const contentTerms = (obj) => [...new Set(words(obj).filter((w) => !STOP.has(w)))];

/**
 * Split the run's text into the two corpora the rule needs.
 *
 * `records` is the assembled record set (Map of uri → body) or any iterable of bodies. ONLY
 * `goodsAndServices` is read from them: an owner name or a status line is not a description of what a
 * company does either, and pooling the whole body would let any register field launder into a party fact.
 *
 * PURE — the caller reads the files.
 */
export function partyFactSources({ grid = null, records = null, matterContext = "" } = {}) {
  const gridText = [];
  for (const cell of (Array.isArray(grid?.cells) ? grid.cells : [])) {
    for (const c of (Array.isArray(cell?.candidates) ? cell.candidates : [])) {
      if (typeof c?.title === "string") gridText.push(c.title);
      if (typeof c?.snippet === "string") gridText.push(c.snippet);
    }
  }
  if (grid?.extras != null) gridText.push(JSON.stringify(grid.extras));
  const bodies = records == null ? []
    : [...(typeof records.values === "function" ? records.values() : records)];
  const perRecord = bodies.map((b) => goodsTextOf(b));
  const registrationScope = new Set(words(perRecord.flat().join(" \n ")));
  const recordsRead = perRecord.filter((t) => t.length > 0).length;
  return {
    descriptive: new Set(words(`${gridText.join(" \n ")} \n ${matterContext}`)),
    // THE ENTRIES, UNPOOLED. `descriptive` answers "does this run hold the word at all", which is the
    // right question for an INVENTED claim and the wrong one for a CONTRADICTED claim: on a real grid
    // every relationship word appears somewhere about somebody, so a pooled corpus says every
    // relationship is sourced. Measured: one candidate titled "Contract manufacturing services —
    // <unrelated company>" silences the contradiction test completely.
    descriptiveEntries: [...gridText, String(matterContext ?? "")].filter((t) => String(t).trim()),
    registrationScope,
    // Present-and-null, not absent: a run holding no grid must never read as "nothing is sourced".
    haveDescriptive: grid != null || Boolean(String(matterContext ?? "").trim()),
    // GATED ON EXTRACTED TEXT, NOT ON BODY COUNT. `bodies.length > 0` said "scope is judgeable" while the
    // corpus held nothing, so every goods-supported fact was reported INVENTED — the exact opposite of
    // what the category shape exists to say — and nothing announced the empty corpus.
    haveScope: registrationScope.size > 0,
    // AN ABSENCE THE CALLER MUST BE ABLE TO SEE: records were held and no goods text came out of them.
    // That is a reader defect, never a run whose registrations have no goods.
    scopeEmpty: bodies.length > 0 && registrationScope.size === 0,
    recordsHeld: bodies.length,
    // COVERAGE, because emptiness was the wrong question. The reader truncated at seven records and both
    // guards above stayed quiet: the corpus was partial, not empty. A caller comparing these two can see
    // a reader that stopped early; `scopeEmpty` never could.
    recordsRead,
  };
}

/**
 * The goods and services TEXT of one record body, whatever its provider called the field.
 *
 * THIS IS A WALK RATHER THAN A PATH, and the reason is measured. The first cut read
 * `body.goodsAndServices` and required a string. Across 52,855 record artifacts on this box ZERO carry
 * that field as a string: the assembled Clarivate records use `goodsServices`, a LIST whose text sits at
 * `[].description`; the repo's own EUIPO sample uses `goodsAndServices`, a list of
 * `{classNumber, description: [{language, terms: [...]}]}`; the raw Clarivate probe fixture uses
 * `goodsServices.intClassDescriptions[].…Description`. Three shapes, three providers, no normalisation
 * at assembly — so any single path is an instrument that reports an empty corpus as "no goods".
 *
 * Keys are matched on DESCRIPTION/TERMS/TEXT rather than taking every string leaf, which keeps language
 * codes and class numbers out of a corpus that decides whether a word is a registration term.
 */
function goodsTextOf(body) {
  // NO DEPTH PARAMETER ON THE ENTRY POINT, and that is the fix rather than a style choice. It used to
  // take `(body, depth = 0)` and was called as `bodies.flatMap(goodsTextOf)` — and flatMap passes
  // (element, INDEX, array), so the array index arrived as the recursion depth. Every record past the
  // seventh returned [] immediately and the earlier ones were walked from the wrong starting depth.
  // Measured on this repo's own 27-record sample the corpus plateaued at 193 terms from the seventh
  // record on, however many were supplied; the correct answer for the same 27 is 2,805.
  //
  // NEITHER GUARD CAUGHT IT. `haveScope` was true and `scopeEmpty` false, because the corpus was PARTIAL
  // rather than empty — an emptiness check never fires on a half-filled table. So the recursion is now a
  // closure the caller cannot reach, and the arity trap is gone by construction rather than by everyone
  // remembering to wrap the call.
  return walkGoods(body, 0);
}

function walkGoods(body, depth) {
  if (!body || typeof body !== "object" || depth > 6) return [];
  const out = [];
  for (const [k, v] of Object.entries(body)) {
    if (depth === 0 && !/goods/i.test(k)) continue;          // only the goods subtree, at the top level
    const named = depth === 0 || /description|terms|text/i.test(k);
    if (typeof v === "string") { if (named) out.push(v); continue; }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string") { if (named) out.push(item); }
        else out.push(...walkGoods(item, depth + 1));
      }
      continue;
    }
    if (v && typeof v === "object") out.push(...walkGoods(v, depth + 1));
  }
  return out;
}

/** Can this run's corpora support a verdict at all? A missing artifact is a finding, not a pass. */
export const canJudgePartyFacts = (s) => Boolean(s?.haveDescriptive || s?.haveScope);

/**
 * Does a corpus carry this relationship kind, in any ordinary inflection?
 *
 * An exact token lookup misses it: the source that decided the specimen says "strategic investmentS",
 * and `investment !== investments`. Matching on a shared prefix of at least the kind's length keeps
 * `licence`/`licences` and `invest`-family together without pulling in unrelated words.
 */
/**
 * Does a corpus carry this term, allowing ordinary inflection?
 *
 * `inhibitor` against a source that says `inhibitors` is the same word, and an exact lookup calls it
 * unsourced — which on a corrected report is a fabrication accusation against a term the source plainly
 * carries. Bounded deliberately: a shared prefix of at least four characters AND a length difference of
 * at most three, so `inhibitor`/`inhibitors` matches and `cat`/`catastrophe` does not.
 */
const stemMatch = (a, b) => {
  const n = Math.min(a.length, b.length);
  return n >= 4 && Math.abs(a.length - b.length) <= 3 && a.slice(0, n) === b.slice(0, n);
};
const corpusHas = (set, term) => {
  if (set.has(term)) return true;
  for (const w of set) if (stemMatch(w, term)) return true;
  return false;
};

const corpusHasKind = (set, kind) => {
  // TOKENISED THE SAME WAY THE CORPUS WAS. `words()` splits hyphens, so a corpus built from "EPFL
  // spin-off" holds `spin` and `off` — and a raw `set.has("spin-off")` answers false about text that
  // plainly contains it, which then reads as a CONTRADICTION of a source that agrees.
  const parts = words(kind);
  if (!parts.length) return false;
  // Inflection via the same rule the term classification uses — the source that decided the specimen
  // says "investmentS", and `investment !== investments`.
  return parts.every((part) => corpusHas(set, part));
};

/**
 * The form of a party's name to match ENTRIES against.
 *
 * Register owners carry legal forms ("Aurora Therapeutics SA"); web candidate titles carry whatever the
 * web uses ("Aurora Therapeutics"). That asymmetry is systematic — one corpus is the register, the other
 * is search results — so requiring the full string admits SOME entries about a party and excludes others
 * purely by name form. A half-scoped corpus is the failure this scoping was built to avoid, inverted: it
 * still reports a contradiction, now against a source the run plainly holds.
 *
 * So the match uses ONE form per party, derived once and applied to every entry: the shortest leading
 * prefix carrying two content words. No legal-form list, deliberately — a denylist fails open on the
 * form nobody typed, which is how KG/KGaA reached production in this file's neighbour.
 *
 * A NAME WITH FEWER THAN TWO CONTENT WORDS FALLS BACK TO ITSELF, exactly. One word is where a loose rule
 * starts collecting unrelated companies, and the cost of being strict here is a contradiction this check
 * stays silent about — never one it invents.
 */
const partyMatchForm = (name) => {
  const toks = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  let content = 0;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].toLowerCase().replace(/[^a-z]/g, "");
    if (w.length >= 3 && !STOP.has(w)) content++;
    if (content >= 2) return toks.slice(0, i + 1).join(" ");
  }
  return String(name ?? "").trim();
};

const mentions = (text, name) => {
  const n = String(name ?? "").trim();
  if (n.length < 3) return false;
  return new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![A-Za-z0-9])`, "i").test(text);
};

/**
 * Framed factual assertions about a named party that no source of the right KIND supports.
 *
 * @returns {Array<{shape: "invented"|"category"|"contradicted", term: string, party: string,
 *                  heading: string, frame: string}>}
 */
export function partyFactViolations({ paragraphs = [], partyNames = [], sources = null } = {}) {
  if (!canJudgePartyFacts(sources)) return [];
  const names = partyNames.map((n) => String(n ?? "").trim()).filter((n) => n.length >= 3);
  if (!names.length) return [];
  const out = [];
  for (const para of paragraphs) {
    const text = String(para?.text ?? "");
    const party = names.find((n) => mentions(text, n));
    if (!party) continue;
    const heading = String(para?.heading ?? "") || "(front matter)";
    // ONE FLAG PER SHAPE PER PARAGRAPH, terms listed. Per token, "a pipeline in lung adenocarcinoma"
    // files two rows for one clause and drags a common word ("lung") in beside the domain term. The
    // repair rewrites the clause once — competitorClaimChecks settled the same question the same way.
    const bucket = new Map();   // shape → { terms:Set, frame }
    const add = (shape, term, frame) => {
      if (!bucket.has(shape)) bucket.set(shape, { terms: new Set(), frame });
      bucket.get(shape).terms.add(term);
    };
    const seen = new Set();
    for (const frame of FRAMES) {
      frame.lastIndex = 0;
      for (const m of text.matchAll(frame)) {
        const obj = m.slice(1).find((g) => typeof g === "string" && g.trim());
        if (!obj) continue;
        for (const term of contentTerms(obj)) {
          if (seen.has(term)) continue;
          if (corpusHas(sources.descriptive, term)) continue;                // sourced, and by the right kind
          seen.add(term);
          // THE CATEGORY SHAPE. The term is real and this run holds it — in goods wording, which says
          // what a mark is registered for and never what a company does. A presence rule passes here.
          if (corpusHas(sources.registrationScope, term)) { add("category", term, obj.trim().slice(0, 80)); continue; }
          if (!sources.haveDescriptive) continue;   // no corpus to be absent FROM — never claim invention
          add("invented", term, obj.trim().slice(0, 80));
        }
      }
    }
    // THE CONTRADICTED SHAPE, for the one class it is mechanised for. Asserting relationship kind K
    // about a party while the descriptive corpus carries a different kind and not K is a departure from
    // source rather than an absence of one, and it reads differently to whoever repairs it.
    if (sources.haveDescriptive) {
      // SCOPED TO THE PARTY. Both sides of this test are about what the run says CONCERNING THIS PARTY,
      // so the corpus is the descriptive entries that name it — not the pooled one, which on a real grid
      // contains every relationship word about somebody and therefore calls every relationship sourced.
      const partyForm = partyMatchForm(party);
      const aboutParty = (Array.isArray(sources.descriptiveEntries) ? sources.descriptiveEntries : [])
        .filter((t) => mentions(t, partyForm));
      const partyCorpus = new Set(words(aboutParty.join(" \n ")));
      const asserted = RELATIONSHIP_KINDS.filter((k) => mentions(text, k) && !corpusHasKind(partyCorpus, k));
      const sourced = RELATIONSHIP_KINDS.filter((k) => corpusHasKind(partyCorpus, k));
      if (asserted.length && sourced.length) {
        // It outranks an "invented" row naming the same word: the run DID hold material on this
        // relationship and the narrative departed from it, which is a different repair.
        const inv = bucket.get("invented");
        for (const k of asserted) if (inv) for (const t of [...inv.terms]) if (k.startsWith(t)) inv.terms.delete(t);
        if (inv && !inv.terms.size) bucket.delete("invented");
        bucket.set("contradicted", { terms: new Set(asserted), frame: `source says ${sourced.join("/")}` });
      }
    }
    for (const [shape, { terms, frame }] of bucket)
      out.push({ shape, terms: [...terms], term: [...terms][0], party, heading, frame });
  }
  return out;
}

/** The sentence a repair reads. */
export function partyFactMessage(v) {
  const q = (v.terms ?? [v.term]).map((t) => `"${t}"`).join(", ");
  if (v.shape === "category")
    return `${v.heading}: ${q} is presented as a fact about ${v.party}, but this run holds it only in a `
      + `registration's goods and services wording — what a mark is registered FOR, never evidence about a `
      + `company's activities. Drop it or source it from material about the party ("${v.frame}").`;
  if (v.shape === "contradicted")
    return `${v.heading}: the narrative asserts a ${q} relationship for ${v.party}, and the run's own `
      + `material about that party describes a different one (${v.frame}). Say what the source says.`;
  return `${v.heading}: ${q} is stated as a fact about ${v.party} and resolves to no source this run `
    + `holds — not the common-law grid, not the matter context, not any fetched record's goods wording ("${v.frame}").`;
}
