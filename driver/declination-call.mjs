// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// declination-call.mjs — a record that reached the findings surface leaves it BY A STATED DECISION.
//
// ── THE DEFECT THIS CLOSES (, and 's half of the same seam) ────────────────────────────────
//
// `record-carry.json` on R2 round `e48f7056` read `unreasoned: 0` and was telling the truth in the weak
// sense only: every drop had a LABEL, and on 102 of them the label was inferred from where the record
// stopped rather than stated by the step that stopped it. One of those 102 was DELPHIC — a lawyer-named
// gold mark, REGISTERED, placed on sheet-2, stamped `carry: "carried"`, carried onto the findings
// surface, and then absent from the delivered report with nothing anywhere saying why.
//
// The seam recorder could not have said why. `recordSynthesisSeam` passed `seamRows` a ZERO-ARITY
// constant callback — `reasonFor: () => ({ reason: "synthesis:not-delivered", reason_source:
// "step-silent" })` — so every record it discarded got the same sentence whatever it was. The sibling
// seam one stage earlier already does the right thing: `recordDigestSeam` passes `(rec, uri) =>` and
// reads the digest's OWN output, returning `step-stated` where the digest spoke and `absent` where it
// did not. The shape was in the file; synthesis just had nothing to read.
//
// So this is what synthesis writes, and it is a CALL rather than a document on purpose.
//
// ── WHY NOT A PROSE SECTION, WHICH IS WHAT THE DIGEST DOES ──────────────────────────────────────────
//
// The digest states its declines in a `Negative-results` section of `register-findings.md`, and
// `placementIndex` parses them back out. That is the precedent, and it is precisely the one that must
// not be extended: the standing transport ruling is that no model hand-authors machine-parsed content.
// The disposition form failed to parse and produced a loud token; `parseClosureLines` failed to parse
// and produced NOTHING, which is worse. A declination lost in transit is byte-identical to a record the
// stage looked at and delivered — and both of those are byte-identical to today's silence.
//
// The seat sends VALUES. The serialization is ours. A transport failure becomes inexpressible.
//
// ── THE REASON ENUM IS DERIVED, NOT MINTED ──────────────────────────────────────────────────────────
//
// Every token below is an omission `synthesis-rules.md` ALREADY authorises, in its own words, and the
// file is cited per token in REASON_NOTES. That matters more than it looks: a vocabulary with two
// authors drifts, and the drift is silent because both authors are describing the same intent. There is
// ONE author here and it is the dictation the seat is already following. A reason the rules do not
// authorise is not a reason this tool can express.
//
// ── THE REFUSALS ARE BOOKKEEPING, NEVER A LEGAL CALL ────────────────────────────────────────────────
//
// The engine delivers facts and the lawyer decides. Nothing here rules on whether a mark is a conflict,
// and nothing here protects anybody from anything. Every refusal below fires only where a stated reason
// CONTRADICTS a fact the driver already holds from the job — `instructed-scope.json`, written before any
// model ran:
//
//   • any discretionary reason over a mark IDENTICAL to the applied-for mark (house normalizer), live,
//     in a filed class. `synthesis-rules.md`:200 — "Never drop an on-point identical / near-identical
//     mark in the relevant class" — "holds regardless of filer profile". A declination here contradicts
//     the instruction the same turn is following.
//
// That is the whole list, and it is one item because one item is what survived being replayed against a
// real run. See `contradictionFor` for the refusal that was built, measured at 170 hits out of 170
// records, and deleted.
//
// IDENTICAL, NOT NEAR-IDENTICAL, and the gap is deliberate. `markKey` equality is mechanical; "near"
// is the judgment the rule leaves to the lawyer, and a tool that guessed at it would be making the
// legal call this comment says it does not make. The narrow half is enforced and the wide half is left
// where it belongs. The seat keeps every non-discretionary route: `duplicate-of-delivered` and
// `own-right` are bookkeeping about the deliverable, not claims about relevance, and neither is refused
// on any record.
//
// A refusal is actionable INSIDE the turn — the answer names the row and says which fact contradicts
// the reason — so the seat re-states it now rather than a scorer finding it a day later.
//
// ── GROUNDS IS NOT GRADED, AND THAT IS A DECISION ───────────────────────────────────────────────────
//
// The first draft ran `grounds` through `grounds-grammar.mjs`'s `classifyGroundsNote`, on the reasoning
// that a note describing the material instead of stating a ground is the defect one artifact over.
// Measured against seven realistic declinations before anything was built on it, that classifier refused
// ALL SEVEN as `unclear` — including "already delivered as finding 4 under the EUIPO record for the same
// proprietor". It is not a bug in the classifier. It answers a different question: 's notes must say
// what could NOT BE ESTABLISHED about a charged rating, and a declination says why a record does not earn
// a line. Two different speech acts, and a grammar built for one rejects the other on sight.
//
// Wiring it would have refused every honest declination and left the seat with the silent path as the
// only one that worked — rebuilding the defect this module exists to close, behind a check that looked
// like rigour.
//
// So grounds is checked for PRESENCE and nothing else. That is also the principled answer: the contract
// says grounds is prose for the human reader and is never machine-parsed, and grading its grammar is
// machine-parsing it. The reviewing lawyer judges whether a ground is any good. The tool's job is to
// make sure one was written and that it is not the reason token typed twice.
//
// PURE — no node imports, so it tests offline, exactly like doubt-closure-call.mjs and disposition-call.mjs.
// It imports the house normalizer and known-conflicts.mjs does not import it: the dependency runs ONE WAY,
// so there is no second opinion about what an identical mark is.
import { markKey } from "./known-conflicts.mjs";

// One call carries a BATCH. A tool that is tedious at N rows gets routed around — 17 of 23 recorded runs
// hand-wrote a program rather than author the disposition form — and 102 declines is squarely in the
// range where tedium becomes a correctness property. Same bound as the closure transport, for the same
// reason, and a further call carries the rest.
export const MAX_DECLINATIONS_PER_CALL = 40;

// ⭐ THE VOCABULARY, WITH ITS AUTHOR CITED PER TOKEN.
//
// `discretionary` marks a reason that ASSERTS SOMETHING ABOUT THE RECORD'S RELEVANCE. Those are the only
// ones any refusal below can fire on, because they are the only ones a fact from the job can contradict.
// The other two say something about the DELIVERABLE — this record is already in it, or it is ours — and
// no class list or mark string can disagree with either.
export const DECLINATION_REASONS = Object.freeze({
  "unrelated-goods": {
    discretionary: true,
    rules: "synthesis-rules.md:162-165",
    gloss: "the goods or services are unrelated to the matter's own, so it is not a legal finding "
      + "(commercial awareness only)",
  },
  "off-field-not-major": {
    discretionary: true,
    rules: "synthesis-rules.md:275-277",
    gloss: "an off-field name that is not a major brand, an active dispute or proceeding, or a "
      + "well-known enforcer — omitted, never listed for completeness",
  },
  "not-worth-the-line": {
    discretionary: true,
    rules: "synthesis-rules.md:272-274",
    gloss: "promote-or-omit: it fits none of the four manageable categories and is not relevant enough "
      + "to drive the read, so it is not worth the lawyer's line",
  },
  "duplicate-of-delivered": {
    discretionary: false,
    rules: "consolidation — the same right is already delivered under another record",
    gloss: "this record is the same right as one already delivered; it is consolidated, not dropped",
  },
  "own-right": {
    discretionary: false,
    rules: "the applicant's own or affiliated record (`own_rights` is a finding field)",
    gloss: "the record belongs to the applicant or an affiliate, so it is not a conflict to report",
  },
});

export const DECLINATION_REASON_TOKENS = Object.freeze(Object.keys(DECLINATION_REASONS));
const DISCRETIONARY = Object.freeze(
  DECLINATION_REASON_TOKENS.filter((t) => DECLINATION_REASONS[t].discretionary));

/** Live for the purposes of the identical-mark rule. A record whose status the run never established is
 *  NOT treated as live — the refusal must rest on a fact, and an unknown status is not one. The rule's
 *  own "even if it looks revocable or shelved" is why an expired-looking REGISTERED still counts. */
const LIVE_STATUSES = Object.freeze(["REGISTERED", "APPLICATION", "PENDING", "FILED", "PUBLISHED", "OPPOSED"]);
const isLive = (s) => LIVE_STATUSES.includes(String(s ?? "").trim().toUpperCase());

const asClassSet = (v) => {
  const out = new Set();
  for (const c of Array.isArray(v) ? v : []) {
    const n = Number(String(c ?? "").trim());
    if (Number.isInteger(n) && n >= 1 && n <= 45) out.add(n);
  }
  return out;
};

const sharedClasses = (a, b) => {
  const B = asClassSet(b);
  return [...asClassSet(a)].filter((c) => B.has(c)).sort((x, y) => x - y);
};

/** Does this record's mark equal one of the applied-for marks, under the house normalizer? PURE. */
export function isIdenticalToAppliedMark(recordMark, appliedMarks) {
  const k = markKey(recordMark);
  if (!k) return false;
  return (Array.isArray(appliedMarks) ? appliedMarks : []).some((m) => markKey(m) === k);
}

/** MIN_GROUNDS — a floor, not a grade. Long enough that the seat had to say something about THIS record;
 *  short enough that a genuine one-line ground passes. Deliberately not a sentence parser: see the header. */
export const MIN_GROUNDS = 20;

/** The only thing checked about grounds: that there is one, and that it is not the reason token echoed
 *  back. Returns a refusal string or "". PURE. */
export function groundsProblem(grounds, reason) {
  const g = String(grounds ?? "").trim();
  if (!g) {
    return `grounds is required: one or two lines, in your own words, saying why THIS record does not `
      + `earn a line in the report. The reason token is the category; grounds is what the reviewing `
      + `lawyer reads. A declination with no ground is the silence this tool exists to replace.`;
  }
  if (g.length < MIN_GROUNDS) {
    return `grounds is ${g.length} characters — too short to say anything about this record. Write the `
      + `sentence you would say to the reviewing lawyer if they asked why it is not in the report.`;
  }
  if (markKey(g) === markKey(reason) || markKey(g) === markKey(String(reason).replace(/-/g, " "))) {
    return `grounds repeats the reason token and adds nothing. The token is already recorded; grounds `
      + `is the part a person reads.`;
  }
  return "";
}

/**
 * THE CONTRADICTION TEST — the whole refusal surface, in one pure function so it is testable without a
 * call, a spec or a run directory. Returns a string naming the contradicting fact, or "" when the
 * declination is consistent with what the driver holds.
 *
 * `row` is the OFFERED row (driver-authored, from the discard seam's own record); `scope` is
 * instructed-scope.json (job-authored, written before any model). Neither is the seat's.
 */
export function contradictionFor(reason, row, scope) {
  const spec = DECLINATION_REASONS[reason];
  if (!spec || !spec.discretionary) return "";
  const shared = sharedClasses(row?.classes, scope?.classes);
  const marks = Array.isArray(scope?.marks) ? scope.marks : [];

  if (isIdenticalToAppliedMark(row?.mark, marks) && isLive(row?.status) && shared.length) {
    return `this record's mark is IDENTICAL to the applied-for mark under the house normalizer, its `
      + `status is ${String(row?.status ?? "").trim() || "live"}, and it sits in class ${shared.join(", ")} `
      + `— one of the matter's own filed classes. synthesis-rules.md:167 orders that an on-point `
      + `identical mark in the relevant class is never dropped, and says so "regardless of filer `
      + `profile". Deliver it and rate it; a Stage-2 mitigant is a rating input, never a reason to omit. `
      + `If it is the applicant's own right or already delivered under another record, say so with `
      + `own-right or duplicate-of-delivered.`;
  }

  // THERE IS NO CLASS-OVERLAP REFUSAL, AND THE FIRST DRAFT HAD ONE. It refused `unrelated-goods` and
  // `off-field-not-major` over any record sharing one of the matter's filed classes, on the reasoning
  // that the driver holds both class lists and they disagree with the stated reason.
  //
  // Replayed against a delivered run (7a30934b, MERIDIAN THISTLE, classes 9 and 42) it fired on 170 of
  // 170 findings-surface records — every one — because the register sweep IS scoped to the filed
  // classes, so every record it retrieves is in one of them by construction. A refusal that fires on
  // the whole population is not a guard, it is a ban on the reason token.
  //
  // And it was wrong on the law as well as the numbers. A Nice class is not a statement about goods:
  // class 9 carries software, fire extinguishers and diving suits, and the rules' own goods-half asks
  // what the specification actually covers. "Shares class 9" and "the goods are unrelated" are both
  // true of the same record all the time. Refusing on that overlap would have been the engine making a
  // relatedness call, which is the lawyer's — the exact line this file's header promises not to cross.
  //
  // What survives is the one refusal the dictation states as a refusal in its own words, and it rests
  // on mark identity rather than on a judgment about goods.
  return "";
}

/**
 * THE SEAM'S DECISION, AS A PURE FUNCTION — 's guarantee, in the one place it can be asserted.
 *
 * `recordSynthesisSeam` is module-private in pipeline.mjs and always will be; it does file I/O and takes
 * a run context. The JUDGMENT it makes about each discarded record is this, and it is extracted so a test
 * can drive it with no run directory — the same reason `deriveRecordCarry` is exported "for its CALL-SITE
 * test". `declined` is `readDeclinations`'s three-valued result; `uri` is normalized already.
 *
 * The two branches are the whole issue:
 *   a recorded declination  → `step-stated`, carrying the seat's own grounds. A stated decision.
 *   nothing                 → `absent`. NOT `step-silent`, which REASON_SOURCES defines as "NOT a defect
 *                             ... the shape of an undiscriminating funnel with late judgment". Once the
 *                             dictation orders a decision per record, an unanswered record is the other
 *                             thing: "nothing attests anything. THE DEFECT the run reports."
 *
 * And the two NOTHING cases are told apart, because an absence is a finding: a run whose synthesis never
 * recorded anything is a different fact from one that recorded decisions and skipped this record. PURE.
 */
export function seamReasonFor(declined, uri) {
  const d = declined?.byUri?.get(uri);
  if (d) {
    const spec = DECLINATION_REASONS[d.reason];
    return {
      reason: `synthesis:declined:${d.reason}`,
      reason_source: "step-stated",
      detail: `synthesis declined this record as ${d.reason}${spec ? ` (${spec.gloss})` : ""} — ${d.grounds}`,
    };
  }
  return {
    reason: "synthesis:not-delivered",
    reason_source: "absent",
    detail: declined?.present
      ? "the register digest carried this record onto a findings surface, synthesis recorded declination decisions for this run, and NONE of them names this record — so it was neither delivered nor declined, and nothing states why"
      : "the register digest carried this record onto a findings surface and this synthesis pass delivered no finding naming it and recorded no declination for any record — no ground exists for this drop anywhere in the run",
  };
}

/**
 * THE ACCEPTANCE BOUNDARY. Partial accept, always: a refused row never voids its neighbours. All-or-
 * nothing was the old transport's whole disease — one bad row voided seventy-three good ones — and a
 * batch of 40 declines is exactly where re-creating it would hurt most.
 *
 * `spec.rows` is the offered list, driver-authored: every record this synthesis pass had on its findings
 * surface. The seat cites a row by its POSITION in that list and there is NO field for a uri — the
 * ruling, and it is load-bearing here: a validator that rejects an unknown uri has MOVED the defect; a
 * schema that cannot express one has REMOVED it. A record the pass was never handed cannot be spoken
 * about at all.
 *
 * Returns { accepted, refused, open, offered } — `open` is what is still owed, so the seat can finish
 * inside its own turn instead of learning from a lint after delivery.
 */
export function acceptDeclinationCall(spec, received) {
  const rows = Array.isArray(spec?.rows) ? spec.rows : [];
  const scope = spec?.scope ?? {};
  const sent = Array.isArray(received?.declinations) ? received.declinations : [];

  const accepted = [];
  const refused = [];
  const claimed = new Set();

  // ── EVERY REFUSAL NAMES THE RECORD, NOT ONLY THE POSITION IT ARRIVED UNDER ────────────────
  //
  // `row_index` is a position into the spec THIS pass was handed, and that spec is rewritten between the
  // main and the corrective synthesis pass. A refusal ledger keyed on the position pools refusals of
  // whatever now sits at that offset, so a per-record refusal bound built on it would park an innocent
  // record and leave the live-locked one running. `uri` is the register record's own identifier — the
  // key `appendDeclinations` already stores accepted declinations under, and a map key in the spec's
  // producer, so it is non-null and unique by construction.
  //
  // A refusal whose index addresses no row keeps `uri: null` deliberately. It CANNOT be parked — you
  // cannot park a record you cannot name — and the bound counts it separately rather than dropping it,
  // because a per-record histogram that silently omits them reads as "nothing was refused".
  const uriAt = (i) => (Number.isInteger(i) && i >= 0 && i < rows.length ? (rows[i]?.uri ?? null) : null);
  const no = (row_index, why) => refused.push({
    row_index: Number.isInteger(row_index) ? row_index : null, uri: uriAt(row_index), why,
  });

  if (sent.length > MAX_DECLINATIONS_PER_CALL) {
    for (const [i, d] of sent.entries()) {
      if (i < MAX_DECLINATIONS_PER_CALL) continue;
      no(d?.row_index, `over the ${MAX_DECLINATIONS_PER_CALL}-row limit for one call — this row was not read. `
        + `Send it in a further call; every row accepted here is kept.`);
    }
  }

  for (const d of sent.slice(0, MAX_DECLINATIONS_PER_CALL)) {
    const idx = d?.row_index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) {
      no(idx, `row_index must be a position in the ${rows.length} record(s) this pass was handed `
        + `(0..${Math.max(0, rows.length - 1)}). A record you were not given is one you cannot speak about.`);
      continue;
    }
    if (claimed.has(idx)) {
      no(idx, "this row already carries a declination in this call — one decision per record.");
      continue;
    }

    const reason = String(d?.reason ?? "").trim();
    if (!DECLINATION_REASONS[reason]) {
      no(idx, `"${reason || "(none)"}" is not a declination reason. The vocabulary is `
        + `${DECLINATION_REASON_TOKENS.join(" | ")} — each one an omission synthesis-rules.md already `
        + `authorises. If your ground is none of these, the record is not one the rules let you omit.`);
      continue;
    }

    const grounds = String(d?.grounds ?? "").trim();
    const groundsFault = groundsProblem(grounds, reason);
    if (groundsFault) {
      no(idx, groundsFault);
      continue;
    }

    const clash = contradictionFor(reason, rows[idx], scope);
    if (clash) {
      no(idx, clash);
      continue;
    }

    claimed.add(idx);
    accepted.push({
      row_index: idx,
      uri: rows[idx]?.uri ?? null,
      mark: rows[idx]?.mark ?? null,
      reason,
      grounds,
    });
  }

  const open = rows
    .map((r, i) => ({ row_index: i, uri: r?.uri ?? null, mark: r?.mark ?? null, owner: r?.owner ?? null }))
    .filter((r) => !claimed.has(r.row_index));

  return { accepted, refused, open, offered: rows.length };
}
