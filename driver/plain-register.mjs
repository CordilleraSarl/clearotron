// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE TWO-REGISTER RULE, AS THE REVIEWER READS IT — tracker issue 333.
//
// The report goes to a lawyer who layers advice on top, and that lawyer's client reads the same page.
// The band, the summary, the basis line and the one-liners are the whole product for the second reader,
// and they were the hardest lines on it: single sentences of seventy-odd words in the lawyer's
// vocabulary. The owner's ruling is that default-visible text carries no legal or engine vocabulary at
// all, and that inside a fold the lawyer's words are allowed where a plain one would lose precision.
//
// THIS IS ADVISORY AND MUST STAY ADVISORY. A hit is a rewrite of that line — never a disclosure to the
// client, never a run failure. The rule is presentation: it changes no band, no evidence and nothing
// that is searched.
//
// — AND IT MUST NOT FIRE ON THE MARK IT IS CLEARING.
//
// This is the defect `coverage-form.mjs` records one level in: a refusal that cannot tell a mark from
// engine vocabulary blocked a clearance on the mark SLICE, and a render-time substitution turned "AXIS
// Bank filed in class 36" into "group Bank filed in class 36" on a report clearing AXIS. Half the words
// here are ordinary English and several are plausible marks — PREVAIL, SENIOR, SPECIFICATION. A check
// that flagged the mark under clearance would put noise on exactly the report that matters most, so
// every term the run is about is excluded before the text is read.

/**
 * The lawyer's vocabulary, as WORKED EXAMPLES with the plain form beside each. Not a ban list: the
 * issue rejects "a list of forbidden words as the mechanism" in terms, and this is what the reviewer
 * offers a seat as the rewrite, which is a different thing from a gate that refuses.
 *
 * Each entry is [what a lawyer writes, what the reader needs]. The second half is the load-bearing one —
 * a flag naming a word teaches nothing, and the seat has to produce a sentence.
 */
export const PLAIN_FORMS = Object.freeze([
  ["proprietor", "owner"],
  ["subsisting", "live"],
  ["specification", "goods list"],
  ["citable", "earlier marks the office can raise against you"],
  ["prevail", "win"],
  ["formative", "names built on"],
  ["belt-and-braces", "extra"],
  ["non-use attack", "could be cancelled for not being used"],
  ["on the record as it stands", "on what we found"],
  ["marks-and-goods comparison", "same name, same goods"],
  ["dispatch", "the request"],
  ["instructed", "what was asked"],
  ["chunk", ""],
]);

/** The longest visible sentence a reader should meet. The issue's number, not a derived one. */
export const SENTENCE_WORD_LIMIT = 25;

/**
 * How a term in `PLAIN_FORMS` is looked for in prose — ONE definition, because two of them drift.
 *
 * THE INFLECTIONS ARE THE POINT, and they were the reason a second copy of this rule survived. The
 * pre-delivery lint carried its own hand-tuned patterns — `\bproprietors?\b`, `\bprevails?\b|\bprevailing\b`
 * — while this file built `\bproprietor\b` and matched neither plural. So the pinned source was the
 * WEAKER of the two, and reading terms from it without this would have quietly narrowed what the live
 * check catches: a consolidation that loses coverage is a regression wearing a tidy-up's clothes.
 *
 * A trailing `s`, `es`, `ed` or `ing` after the term, and a hyphen matching a space, which is how the
 * same phrase is written in two documents by two people.
 */
export const termMatcher = (term) => new RegExp(
  `\\b${term.replace(/[-]/g, "[- ]").replace(/\s+/g, "\\s+")}(?:e?s|ed|ing)?\\b`, "i");

/** Everything the run is ABOUT — the mark, its variants, the owners named. Never flagged. */
const ownTerms = (about = {}) => {
  const out = [];
  for (const v of [about.mark, ...(about.marks ?? []), ...(about.owners ?? []), ...(about.terms ?? [])]) {
    const s = String(v ?? "").trim();
    if (s) out.push(s.toLowerCase());
  }
  return out;
};

/** Sentences, split on terminators that end one. Crude on purpose — this counts words, not grammar. */
export const sentencesOf = (text) =>
  String(text ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export const wordsIn = (sentence) => String(sentence ?? "").trim().split(/\s+/).filter(Boolean).length;

/**
 * What is wrong with one default-visible line, as rewrite advice. `[]` means nothing to say.
 *
 * `about` carries the run's own marks and owners so they are never reported — see the header. A term
 * that IS the thing being cleared is not the lawyer's vocabulary, it is the subject.
 */
export function plainRegisterFlags(text, about = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const mine = ownTerms(about);
  // Blank the run's own terms before reading, rather than filtering hits afterwards: a mark can contain
  // one of these words ("PREVAIL"), and a hit inside it is not a hit at all.
  let scan = raw;
  for (const t of mine) {
    if (!t) continue;
    scan = scan.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }

  const flags = [];
  for (const [term, plain] of PLAIN_FORMS) {
    if (!termMatcher(term).test(scan)) continue;
    flags.push({
      kind: "vocabulary",
      term,
      say: plain
        ? `"${term}" is the lawyer's word — the reader needs "${plain}". Rewrite the sentence, do not swap the word.`
        : `"${term}" is an engine word and has no place on a page a client reads. Rewrite the sentence.`,
    });
  }

  for (const s of sentencesOf(raw)) {
    const n = wordsIn(s);
    if (n > SENTENCE_WORD_LIMIT) {
      flags.push({
        kind: "length",
        words: n,
        say: `${n} words in one sentence, and a visible line takes ${SENTENCE_WORD_LIMIT}. Split it — one idea per sentence, `
          + "the conclusion first. Do not shorten it by dropping the reason.",
      });
    }
  }
  return flags;
}

/**
 * The fields a reader meets before opening anything. Named here rather than at each call site so the
 * two products answer to one list — the knockout and the clearance drifted apart once already.
 *
 * EVERY ENTRY IS A PATH INTO A DELIVERED RECORD, and an arm resolves each one against the runs under
 * `demo/`. That is the whole repair. The clearance half named eight fields of which six did not exist
 * in any casing, and the reason nobody noticed is that a list of names is only ever read BY a person:
 * `thirdPartyRights` beside a record carrying `four_answers.third_party_rights` reads as correct, and a
 * loop over it opens nothing and reports a clean result over text it never read. A path either resolves
 * or the arm says so.
 *
 * THE PATHS ARE THE SURFACES THE LIVE CHECK ALREADY READS. `plainRegisterExtra` in pipeline.mjs walks
 * the clearance record's own keys and had a comment explaining that it could not use this list. The list
 * is now what that walk reads, plus the four answers, which render on the report as prose and were
 * missing from both. One definition, and the walk is the thing that made it checkable.
 *
 * `[]` MARKS A LIST and `*` an object's own values: `findings[].net` is one sentence per finding, and
 * `four_answers.*.read` one per answer — that register is keyed by answer name and is not an array.
 *
 * WHAT CAME OFF, AND WHY EACH. `oneLiner` and `freedomToOperate` exist in no record in either casing and
 * name no surface anybody could point at — they are gone rather than renamed, because inventing a target
 * for them would be a guess in the one place a guess reads as a fact. `ownRights` resolves to
 * `findings[].own_rights.source`, which is a record URI and not prose: a citation has no register, and
 * running a plain-words check over one would flag the profession's vocabulary inside a machine
 * identifier. `batchOpener` was in the KNOCKOUT half and is dead in both casings there.
 *
 * KNOWN INCOMPLETE, DELIBERATELY. `marks[].registerReads[].read` is walked as knockout-visible prose by
 * `knockoutVisibleProse` and is not on the knockout list here. Adding it would widen what the reviewing
 * pass rewrites on a delivered report, which is a change to what a client receives and not this repair's
 * to make. The acceptance here is that every entry names something real, not that the list is complete;
 * the completeness question is recorded on the issue rather than settled in passing.
 */
export const DEFAULT_VISIBLE_FIELDS = Object.freeze({
  knockout: [
    "batch.executiveSummary", "batch.standardCaveats[]",
    "marks[].basis", "marks[].factors[]", "marks[].counterFactors[]", "marks[].mitigation",
    "marks[].purpleNotes[]", "marks[].findings[].net",
  ],
  clearance: [
    "mark_assessment.distinctiveness", "mark_assessment.connotation",
    "four_answers.*.read", "findings[].net", "coverage[].note", "actions[].text",
  ],
});

/**
 * Every string a path in `DEFAULT_VISIBLE_FIELDS` reaches in one delivered record.
 *
 * THIS IS WHAT MAKES THE LIST CHECKABLE, and its absence is why six dead names sat there for months. A
 * list of bare names can only be read by a person; a path can be resolved, so an arm can say which
 * entries open nothing.
 *
 * `[]` walks a list, `*` walks an object's own values — `four_answers` is keyed by answer name rather
 * than being an array, and a path that assumed a list there resolved to nothing while looking right.
 *
 * TWO FIELDS ARRIVE AS EITHER A STRING OR AN OBJECT, and this reads both because the code that renders
 * them does. A reviewer's note is `p?.text ?? p` in `knockoutVisibleProse`; an assessment field is
 * `typeof v === "string" ? v : v?.read` where the structured form carries typed rows beside the prose.
 * Resolving only the string form would have reported both as dead on a record that carries them, which
 * is the same absence-dressed-as-a-fact this repair exists to remove — measured, on the delivered runs.
 *
 * A missing key yields NOTHING rather than throwing. An absent optional field is a fact about that
 * record, and the arm decides what an absence means across several of them.
 */
export function resolveVisiblePath(record, path) {
  let nodes = [record];
  for (const seg of String(path).split(".")) {
    const list = seg.endsWith("[]");
    const key = list ? seg.slice(0, -2) : seg;
    const next = [];
    for (const n of nodes) {
      if (n == null || typeof n !== "object") continue;
      if (key === "*") { next.push(...Object.values(n)); continue; }
      const v = key ? n[key] : n;
      if (v == null) continue;
      if (list && Array.isArray(v)) next.push(...v); else next.push(v);
    }
    nodes = next;
  }
  return nodes
    .map((n) => (typeof n === "string" ? n : (typeof n?.text === "string" ? n.text : n?.read)))
    .filter((s) => typeof s === "string" && s.trim());
}
