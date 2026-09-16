// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// terminal-clamp.mjs — WHAT A TERMINAL GUARD DOES WHEN IT FINDS THE REPORT INCOMPLETE.
//
// Ruling, 2026-08-27, verbatim intent: **reports always ship**. When a terminal guard finds the
// report incomplete at delivery, the engine sends it with the gap patched conservatively and the defect
// named in the run record. It never withholds.
//
// ── WHY THIS IS A MODULE AND NOT A BRANCH IN THE PIPELINE ───────────────────────────────────────────
//
// `floor-duty.mjs` states the rule this follows, about its own predicate: "it lives in floor-duty.mjs
// so the arms can DRIVE it. Inline here it could only be pinned by source text, and a source-text pin
// cannot tell an armed check from one somebody disarmed while leaving its words in place."
//
// The same is true of the DECISION. A pipeline that decided inline could only be pinned by asserting
// its text contains no `throw` — which passes just as well against a version that throws somewhere
// else, and says nothing about what the run record ends up carrying.
//
// ── THE COST THAT PRODUCED THIS ─────────────────────────────────────────────────────────────────────
//
// Measured, not argued: a live clearance run died at delivery after 5.55 hours because the floor duty
// found ONE undischarged record. The guard was right and worked exactly as built — it was its first
// real catch. The client received nothing, instead of a report naming one gap.
//
// A guard that stops a report marks where a fix is missing. It is not itself the fix.

/** The verdicts, ordered by caution. A clamp may move RIGHT along this list and never left. */
const CAUTION = Object.freeze(["CLEAR", "CONDITIONAL", "BLOCKING"]);

/**
 * The shape of an engine identifier: `word_word:N` tokens (`floor_duty_undischarged:22`) and the
 * `snake_case` defect vocabulary generally. The CLIENT'S clause may never carry one —:
 * two delivered reports opened their Verdict row with exactly such a token, because the run-record
 * reason and the reader's clause were one fused string. Exported so the vocabulary guard and the
 * arms match the SHAPE this module refuses, not a hand-kept list of strings that already escaped.
 */
export const ENGINE_TOKEN_RE = /\b\w+_\w+(?::\d+)?\b/;

/**
 * Decide what a terminal guard does with a defect it has found at delivery. PURE.
 *
 * Always delivers. The only question is how far the verdict is clamped and what the run record says.
 *
 * TWO TEXTS, NEVER ONE. The `reason` is the RUN RECORD's sentence — token, counts,
 * record ids; the R2 scorer and the ops note read it. The `clause` is the READER's sentence — what is
 * open, in a lawyer's nouns — and it is what the Verdict row's "conditional on:" lede may render.
 * They were one fused string until two delivered reports led their hero panel with
 * `Floor_duty_undischarged:22 of 22 floor row(s)…`. This module refuses the fusion at the seam: a
 * clause that carries an engine token is refused the way an unnamed defect is, so the next producer
 * cannot re-fuse them and pass.
 *
 * @param {object}  a
 * @param {string}  a.verdict  the verdict as it stands
 * @param {string}  a.defect   the machine token, e.g. `floor_duty_undischarged:3`
 * @param {string}  a.reason   the run-record sentence, which must name the defect
 * @param {string}  a.clause   the reader-facing sentence in plain nouns — no token, id or engine noun
 * @param {object} [a.detail]  counts for the run record
 * @returns {{deliver: true, verdict: string, clamped: boolean, record: object, reason: string, clause: string}}
 */
export function terminalClampDecision({ verdict, defect, reason, clause, detail = {} }) {
  const token = String(defect ?? "").trim();
  if (!token) throw new TypeError("terminalClampDecision needs a defect token — an unnamed defect in the run record is the withholding it replaced, one step quieter");
  const text = String(reason ?? "").trim();
  if (!text) throw new TypeError("terminalClampDecision needs a run-record reason — the run record alone is not the client's answer");
  const readerClause = String(clause ?? "").trim();
  if (!readerClause) throw new TypeError("terminalClampDecision needs a reader-facing clause — without one the run-record reason becomes the client's verdict sentence, which is the tracker-2096 defect");
  if (ENGINE_TOKEN_RE.test(readerClause)) throw new TypeError(`terminalClampDecision: the reader's clause carries an engine identifier (${readerClause.match(ENGINE_TOKEN_RE)[0]}) — the clause is the client's sentence and speaks a lawyer's nouns; the token belongs in \`reason\` and the run record`);

  const at = CAUTION.indexOf(String(verdict ?? ""));
  // An UNKNOWN verdict is not clamped to a guess. It is delivered as it stands with the defect named:
  // inventing a verdict for a value this module does not recognise would be a worse answer than the
  // one the run already reached.
  const clampTo = at === 0 ? "CONDITIONAL" : verdict;

  return {
    deliver: true,                       // the whole ruling, and it is not conditional on anything
    verdict: clampTo,
    clamped: clampTo !== verdict,
    reason: text,
    clause: readerClause,
    record: { defect: token, delivered: true, ...detail, ...(clampTo !== verdict ? { from: verdict, to: clampTo } : {}) },
  };
}

/** Does this run record entry name a defect? The property the acceptance turns on. */
export function recordNamesDefect(record) {
  return typeof record?.defect === "string" && record.defect.trim().length > 0 && record?.delivered === true;
}

/**
 * THE LEDE IS THE OPINION'S, BY DECISION AND NOT BY PUSH ORDER. The terminal guards run
 * earlier in the delivery block than the coverage floor, so their clauses landed at index 0 and the
 * Verdict row's "conditional on:" lede — one statement, four client surfaces — opened with a
 * completeness disclosure instead of the lawyer's own stated condition. Ruled: the opinion's condition
 * clauses win the lede; a guard's disclosure is one of the conditions and still reaches the reader in
 * the list and the count, but it is not the verdict. Clauses and reasons reorder TOGETHER — they are an
 * index-aligned pair and the reasons array is the count authority. PURE.
 *
 * @param {string[]} clauses      reader clauses, index-aligned with reasons
 * @param {string[]} reasons      run-record reasons
 * @param {Set<string>} guardSet  the clause texts that came from a terminal guard
 * @returns {{clauses: string[], reasons: string[]}}
 */
export function orderClausesForLede(clauses, reasons, guardSet) {
  const aligned = (clauses ?? []).map((c, i) => ({ c, r: (reasons ?? [])[i] }));
  const ordered = [...aligned.filter((x) => !guardSet?.has?.(x.c)), ...aligned.filter((x) => guardSet?.has?.(x.c))];
  return { clauses: ordered.map((x) => x.c), reasons: ordered.map((x) => x.r) };
}

/**
 * THE CLIENT'S CONDITION LIST, from a verdict sidecar. PURE.
 *
 * TWO TEXTS, NEVER ONE — stated at the top of this module, and until now honoured at only one of the
 * two ends. Every clamp site composes a run-record `reason` (token, counts, record ids) and a reader
 * `clause` (the same fact in a lawyer's nouns), and `terminalClampDecision` refuses a clause that
 * carries an engine identifier. The sidecar then persisted `reasons` alone and threw the clauses away,
 * so every client surface had only the run-record text to render. A delivered report's conditions
 * opened with `floor_duty_undischarged:4 of 430 floor row(s)…` while the SAME run's risk statement, one
 * line above, read the clean clause: `riskStatement` already prefers `clauses`, so the page contradicted
 * its own headline. This function is the other end of that rule.
 *
 * THE CLAUSE WINS WHERE THERE IS ONE, and the fallback is not politeness. Three machinery sites push
 * the reason AS the clause ("machinery reasons ARE factual open-states"), so for those entries the two
 * texts are one string and this returns it unchanged — correctly, because no second text exists to
 * prefer. A legacy sidecar written before this change carries no `clauses` key at all and falls back
 * entirely, which is what keeps archived runs republishable.
 *
 * ALIGNMENT IS BY INDEX AND THE REASONS ARE THE COUNT AUTHORITY. `orderClausesForLede` pairs the two
 * arrays and reorders them together; a BLOCKING verdict then appends its grounds to the reasons alone,
 * so `clauses` is legitimately SHORTER. Mapping over reasons and reaching for `clauses[i]` is what
 * makes that safe — never `clauses.map`, which would silently drop the appended grounds.
 *
 * BREAK MATRIX:
 *   · a clause replaces its token-bearing reason   → break: return reasons unchanged, arm 1 red
 *   · a clean reason with no clause survives       → break: return "" for a missing clause, arm 2 red
 *   · a legacy sidecar still yields its conditions  → break: require the clauses key, arm 3 red
 *   · clauses shorter than reasons loses nothing    → break: map over clauses, arm 4 red
 *
 * @param {{reasons?: string[], clauses?: string[]}} sidecar  the parsed `_driver/verdict.json`
 * @returns {string[]} one condition per reason, in the sidecar's own order
 */
export function clientConditions({ reasons, clauses } = {}) {
  const rs = Array.isArray(reasons) ? reasons : [];
  const cs = Array.isArray(clauses) ? clauses : [];
  return rs.map((r, i) => {
    const clause = typeof cs[i] === "string" ? cs[i].trim() : "";
    return clause || String(r ?? "").trim();
  }).filter(Boolean);
}
