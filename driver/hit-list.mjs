// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// hit-list.mjs — the slim hit list: one line per enumerated record, and the fate every line owes.
//
// ── WHY A LIST AND NOT THE BAND ─────────────────────────────────────────────────────────────────────
//
// The band carries every record whole. Judgment then owes an individually authored fate for each, and
// on the run this was measured against, 89.2% of what it wrote was discard justification — 640 rows so
// that 58 could be the answer. A lawyer does not do that: they triage from a hit list, open the few,
// and never mention the set-aside mass. The list is the working object; the band stays the archive.
//
// ── THE FIELD SET IS DERIVED, NOT PROPOSED ──────────────────────────────────────────────────────────
//
// Every field here is one the run's OWN dismissals used. Measured over that run's 640 discards:
//   territory  320 · sign 152 · status 75      → 547 (85.5%) dismissible from three fields
//   owner-leg   69                             → the owner join
//   goods       15                             → NOT dismissible on a line; must be opened
// and all 58 keeps name at least one of these fields in their stated reason. Nothing here is included
// because it seemed useful; each row above is why a field is on the line.
//
// `read` is the office's own reading of the mark. 558 of 1,937 band rows (28.8%) carry one on the
// normalised record and lose it at the band row — the asymmetry being that the OWNER's name already
// travels in two scripts on that row and the MARK's travels in one.
//
// The line drops `_query`/`_queries`/`screen` — 61% of a band row's bytes — and keeps the qid alone,
// because the completeness witness needs the join and nothing dismisses a record on its provenance.

/**
 * THE FATES. A line ends with exactly one, and the set is closed so completeness is verifiable by
 * counting rather than by reading prose.
 */
export const FATES = Object.freeze({
  NOT_PICKED: 0,          // scanned on the list, never opened
  OPENED_DISMISSED: 1,    // fetched, read, set aside
  REPORTED: 2,            // fetched, read, carried into the report
});
export const FATE_VALUES = Object.freeze(Object.values(FATES));

/**
 * THE GROUNDS A LINE CAN BE DISMISSED ON WITHOUT OPENING IT — one question per code.
 *
 * The run this is derived from labelled 481 discards `off-field`, and that one label was doing two
 * unrelated jobs: 320 of them meant "outside the scope markets" and 152 meant "a different sign".
 * A code that means two things cannot be verified mechanically against anything, which is the whole
 * requirement, so the conflation does not survive into the codes.
 */
export const LINE_GROUNDS = Object.freeze(["territory", "sign", "status", "out-of-class", "owner-leg"]);

/**
 * ONE VOCABULARY, MERGED FROM TWO — ruled 2026-08-31, and the old tokens do not ride back in.
 *
 * The digest already spoke a closed set: `off-field`, `goods-distance`, `duplicate-of-surfaced`,
 * `dead-status`, `out-of-class`. This set replaces it, taking the virtues of each:
 *
 *   - THE SPLIT SURVIVES. `off-field` carried 481 discards on the measured round while meaning
 *     "outside the scope markets" 320 times and "a different sign" 152 times. One code, two questions,
 *     unverifiable — so `territory` and `sign` stay separate and `off-field` does not exist here.
 *   - `out-of-class` COMES ACROSS, and it is the member my own derivation missed: I read one round's
 *     discard prose, that round expressed class drops as `off-field`, and the token never appeared in
 *     the sample. A set derived from a sample is missing whatever the sample was.
 *   - THE SPELLINGS ARE PICKED ONCE, here: `status` (was `dead-status`), `owner-leg` (was
 *     `duplicate-of-surfaced`), `goods` (was `goods-distance`). The dictation conforms to these.
 *
 * The retired tokens survive ONLY in the archived-run reader's map — an artifact written by old code
 * stays readable, and new code speaks one tongue.
 */
export const RETIRED_GROUND_TOKENS = Object.freeze({
  "dead-status": "status",
  "duplicate-of-surfaced": "owner-leg",
  "goods-distance": "goods",
  "out-of-class": "out-of-class",
  // ✕ `off-field` has NO single successor, deliberately. It meant territory OR sign, and which one a
  // given archived row meant is not recoverable from the token — only from its prose. A reader of an
  // old artifact must say so rather than pick one and be right 2 times in 3.
  "off-field": null,
});

/**
 * THE GROUNDS THE BAND ALREADY KNOWS THE ANSWER TO — inherited from the transport this set replaces.
 *
 * A seat may not relabel a record the band screened as live-and-in-scope into a status or class drop.
 * That check existed because prose grounds let it happen unseen, and it survives the merge.
 *
 * `owner-leg` is DELIBERATELY ABSENT and that is the ruling, not an oversight: the join between two
 * legs of one right is the model's, made on the line. An exact-string owner compare leaves 20 of 69
 * legs unjoinable where a normalised one leaves 1 — one registrant filed three ways, plus a
 * case-sensitivity rung — so code re-deriving it would manufacture ~20 needless opens AND would be
 * code deciding two rights are the same mark, which this design forbids.
 *
 * `sign` is absent for the same reason in a different key: whether two marks are the same sign is the
 * judgment, not a field.
 */
export const BAND_CHECKED_GROUNDS = Object.freeze({
  status: { verdict: "drop:dead" },
  "out-of-class": { verdict: "drop:out-of-class" },
  territory: { scope: true },       // checked against the run's instructed territories, not a verdict
});

/**
 * ✕ `goods` IS DELIBERATELY NOT A LINE GROUND, AND THIS IS THE DESIGN'S OWN RULE IN CODE.
 *
 * "Dismiss unopened only on grounds visible on the line. If the reason needs the record, open it."
 * A goods-distance call reads the recitation — 15 discards on the measured run did exactly that, and
 * every one of them must become an open rather than a cheaper dismissal. Naming it here, outside
 * LINE_GROUNDS, is what makes `assertFates` able to refuse it.
 */
export const OPEN_ONLY_GROUNDS = Object.freeze(["goods"]);

/**
 * One line, from one band record.
 *
 * `office` is NOT carried: it equalled `jurisdictions` on 1,937 of 1,937 rows of the run measured, and
 * two fields for one fact is how two fields come to disagree. If a provider ever distinguishes them the
 * line must carry the DESIGNATION — the question is whether a right can bar the client HERE, not who
 * issued it.
 *
 * @param {object} rec  a band record
 * @param {string|null} reading  the office-recorded reading of the mark, where the record has one
 */
export function slimLine(rec, reading = null) {
  const line = {
    id: rec?.record_id ?? null,
    q: rec?._qid ?? null,
    sign: rec?.mark_text ?? null,
    cl: rec?.classes ?? [],
    terr: rec?.jurisdictions ?? null,
    st: rec?.status ?? null,
    own: rec?.owner_name ?? null,
    fate: FATES.NOT_PICKED,
  };
  // ── DATES RIDE, AND THEY ARE NOT A DISMISSAL GROUND ────────────────────────────────────────────────
  //
  // Every other field here earns its place from the digest's dismissals. These three do not — no discard
  // on the measured round turned on a date. They are here because the LIST IS ALSO THE DOWNSTREAM'S
  // INPUT, and the locked body's rule for those stages is "change input, not logic".
  //
  // Measured on that round: placement cites 685 records, of which 59 are within the digest's keeps or
  // the 29 records anything opened. 626 have ONLY the line. Of the 346 placement rows that are
  // line-only, 20 state reasoning about filing, registration or seniority — and `register-findings.md`
  // carries 114 year references across the round. Without these fields that reasoning has no source,
  // and placement's logic would have to change, which the ruling forbids.
  //
  // COST, measured rather than estimated: 213 → 254 B mean per line, +19%, still 11.0x smaller than the
  // band row it replaces.
  //
  // ✕ THIS DOES NOT MAKE A DATE A DISMISSAL GROUND. `LINE_GROUNDS` is unchanged: a line still cannot be
  // set aside on a date, because no measured dismissal was. A record whose disposition turns on its
  // dates is one to open, and the under-open pattern that shows up in those 20 rows is a finding about
  // the seat, not a licence to widen the grounds.
  // ── WHAT `band_lookup` ASKS FOR, MEASURED FROM THE CALLS IT ACTUALLY MADE ──────────────────────────
  //
  // For the downstream swap to satisfy "no stage reads the fat band", the lookup has to answer from the
  // list. Over the 47 calls the archived round made: limit 35 · owner 15 · qid 15 · record_id 12 ·
  // nice_class 8 · text 7 · live_only 6 · tier 2 · query 1. Two of those did not survive the line as it
  // stood, and both would have failed QUIETLY.
  //
  // `qs` — THE FULL QID SET, and it rides only where there is more than one. The lookup matches through
  // `recordQids`, which reads the singular AND the plural, and 482 of 1,937 records (24.9%) carry more
  // than one. With only the singular, a quarter of the band becomes unfindable by the filter this run
  // used third-most.
  //
  // ✕ `q` KEEPS ITS TYPE. The plural could have widened `q` to string-or-array; it does not, because a
  // field that changes type breaks a reader that has already landed against it, and a new optional key
  // does not. Additive beats elegant where somebody else's code is already reading the shape.
  if (Array.isArray(rec?._qids) && rec._qids.length > 1) line.qs = [...rec._qids];
  // `live` — the screen's own liveness verdict, on every row that has one (all 1,937 on the measured
  // round). `isLiveRecord` reads this FIRST and only falls back to parsing the status text, so without
  // it the `live_only` filter does not go missing — it silently ANSWERS DIFFERENTLY for any record whose
  // screen says dead while its status text does not match the dead pattern. A fallback that changes the
  // answer is not a fallback.
  if (rec?.screen?.live_status) line.live = rec.screen.live_status;
  if (rec?.application_date) line.filed = rec.application_date;
  if (rec?.registration_date) line.reg = rec.registration_date;
  if (rec?.expiry_date) line.exp = rec.expiry_date;
  if (reading) line.read = reading;
  return line;
}

/**
 * THE COMPLETENESS VERDICT — mechanical, over codes, never over prose.
 *
 * Returns the defects rather than throwing: the caller decides whether an incomplete list is a refusal
 * or a disclosed row, and a function that killed a run over its own accounting would be the shape this
 * programme keeps removing.
 *
 * NAMES ITS DENOMINATOR. Three populations were in play on the measured run — 1,937 enumerated marks,
 * 685 owed records and 2,040 hydrated files — and any claim that does not say which it counted is not
 * a measurement. This one counts LINES.
 */
export function assertFates(lines, { verdictOf = null, scopeTerritories = null } = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  const problems = [];
  const unchecked = [];
  const scope = Array.isArray(scopeTerritories) && scopeTerritories.length
    ? new Set(scopeTerritories.map((t) => String(t).toUpperCase())) : null;
  const seen = new Set();
  for (const [i, l] of rows.entries()) {
    const at = l?.id ? `line ${i} (${l.id})` : `line ${i}`;
    if (!l?.id) problems.push(`${at}: no id — a line without one cannot be joined to anything`);
    else if (seen.has(l.id)) problems.push(`${at}: duplicate id — one enumerated record, one line`);
    else seen.add(l.id);

    if (!FATE_VALUES.includes(l?.fate))
      problems.push(`${at}: fate ${JSON.stringify(l?.fate)} is not one of ${FATE_VALUES.join(", ")} — every line owes exactly one`);

    if (l?.fate === FATES.NOT_PICKED) {
      if (!l?.ground) problems.push(`${at}: not picked and no ground — a dismissal nobody can check is the 640 memos again, one word long`);
      else if (OPEN_ONLY_GROUNDS.includes(l.ground))
        problems.push(`${at}: dismissed unopened on "${l.ground}", which needs the record. If the reason needs the record, open it.`);
      else if (!LINE_GROUNDS.includes(l.ground))
        problems.push(`${at}: ground "${l.ground}" is not one of ${LINE_GROUNDS.join(", ")}`);
      else {
        // ── THE BAND ALREADY KNOWS SOME OF THESE ANSWERS ────────────────────────────────────────────
        //
        // Inherited from the transport this vocabulary replaces: a seat may not relabel a record the
        // band screened live-and-in-scope into a status or class drop. Prose grounds let that happen
        // unseen; a closed token plus this check is what makes it visible.
        const rule = BAND_CHECKED_GROUNDS[l.ground];
        if (rule?.verdict) {
          // ✕ AN ABSENT VERDICT IS NOT A PASS. Without a lookup this check cannot run, and a check
          // that cannot run must say so — the whole failure family this issue is about is a silence
          // reading as an answer. Collected, reported, and never folded into `ok`.
          const v = verdictOf ? verdictOf(l.id) : undefined;
          if (v === undefined || v === null) unchecked.push(`${at}: ground "${l.ground}" is band-knowable and no screen verdict was available to check it against`);
          else if (v !== rule.verdict)
            problems.push(`${at}: dismissed on "${l.ground}" while the band screened it \`${v}\` — the band's read is the authority here, not the seat's relabel`);
        }
        if (rule?.scope) {
          if (!scope) unchecked.push(`${at}: ground "territory" is band-knowable and no instructed scope was supplied to check it against`);
          else if (l.terr && scope.has(String(l.terr).toUpperCase()))
            problems.push(`${at}: dismissed as out-of-territory while ${l.terr} IS an instructed territory`);
        }
      }
    }
  }
  return { ok: problems.length === 0, counted: rows.length, denominator: "lines", problems, unchecked };
}

/**
 * APPLY THE DIGEST'S MARKS TO THE LIST, and record how complete they were —.
 *
 * ✕ THIS NEVER GATES A CALL, AND THAT IS DELIBERATE RATHER THAN UNFINISHED.
 *
 * A new dictation rule read-and-not-applied is a KNOWN failure mode on this engine: a ruled variants
 * rule shipped, the seat opened the file, and the rule reached one of thirty-six variants. Wiring fate
 * codes to a refusal on their first live outing would put a no-report path on the run that exercises
 * them — and a guard that stops a report marks where a fix is missing, it is not the fix.
 *
 * So: fates are ACCEPTED WHEN PRESENT and never required. A call carrying none behaves exactly as
 * before, the existing owed-keyed refusal is untouched, and no new way for a run to die is created.
 * Whether they become required is a later decision with a replay behind it.
 *
 * THE VERDICT LANDS ON THE LIST, NOT IN A LOG. The compliance number is the evidence that later
 * decision will want, and a measurement that dies in a log is the failure family this issue is about.
 * One artifact carries the coded lines and how complete they were.
 *
 * @returns {{applied:number, unknown:string[], verdict:object}|null} null when there is no list to mark
 */
export function applyFates(listPath, fates, { readJson, writeJson, verdictOf = null, scopeTerritories = null } = {}) {
  const doc = readJson(listPath);
  if (!doc || !Array.isArray(doc.lines)) return null;
  const byId = new Map(doc.lines.map((l) => [String(l?.id ?? "").toLowerCase(), l]));
  const unknown = [];
  let applied = 0;
  for (const f of Array.isArray(fates) ? fates : []) {
    const line = byId.get(String(f?.id ?? "").toLowerCase());
    // A fate for an id that is not on the list is NOT silently dropped: the list is the enumerated
    // population, so a mark on something outside it is a disagreement about what the run found, and
    // the only honest thing is to name it. 103 records were fetched but never enumerated on the
    // measured round — this is exactly where that class would surface.
    if (!line) { unknown.push(String(f?.id ?? "(no id)")); continue; }
    line.fate = f.fate;
    if (f.ground) line.ground = f.ground; else delete line.ground;
    applied++;
  }
  const verdict = assertFates(doc.lines, { verdictOf, scopeTerritories });
  doc.fate_verdict = {
    at: new Date().toISOString(), applied, unknown_ids: unknown.length,
    ...verdict, gating: false,   // stated in the artifact: this verdict did not gate the call
  };
  writeJson(listPath, doc);
  return { applied, unknown, verdict };
}
