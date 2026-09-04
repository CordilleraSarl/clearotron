// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// corrections-feedforward.mjs — the reviewer's flags reach the corrective pass as DATA, and the recheck
// is handed what the driver OBSERVED rather than being asked to re-read two documents.
//
// 's first acceptance criterion is that a BLOCKING-verdict full re-run becomes structurally
// impossible. `docs/design/clearance-critical-path.md` §4 bounds how that can be built: refutation cannot
// run before synthesis (`stageInputs["narrative-refutation"]` includes the narrative, and dependencyOrder
// derives the edge mechanically), so the lever available is the CHANNEL the reviewer already writes into
// — `[kind: …]` tokens, a closed enum, parsed by verify.parseCorrections.
//
// THE EVIDENCE GATE §4 SET IS NOW MET, and it was not when the doc was written. The one measurement then
// was an all-zero histogram on a BLOCKING run, because the reviewer's skill taught the token twice, both
// `rating`. taught all four. The first run after it deployed:
//
//     {"event":"correction-kinds","verdict":"BLOCKING",
//      "counts":{"coverage-disposition":3,"fact":6,"rating":2,"narrative":1},"untyped":4,"total":12}
//
// Four kinds, eight of twelve lines typed. The channel carries content, so the feed-forward is being
// built on a measurement rather than on an assumption.
//
// WHAT THIS IS NOT. It does not skip the corrective pass, re-order the stages, or touch the verdict gate.
// The reviewer still decides; the recheck still re-writes the review and its verdict still rules. What
// changes is that both passes are handed a TABLE instead of a wall of prose, and the table's `observed`
// column is the driver's own reading of the findings diff — a fact neither model can assert away.
//
// PURE — no node imports. The io edge is the pipeline's, which already holds the pre-corrective snapshot
// (`_driver/findings-pre-corrective.json`, written since PR-4) and the post-pass file.

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every entity name the findings doc knows, as normalised → original. PURE. */
function knownEntities(...docs) {
  const out = new Map();
  for (const doc of docs)
    for (const f of doc?.findings ?? [])
      // MARK FIRST, and first-write-wins: a mark and its owner often normalise to the same token, and the
      // mark is the name a reader of this table recognises.
      for (const name of [f?.mark, f?.owner?.name]) { const n = norm(name); if (n && !out.has(n)) out.set(n, name); }
  return out;
}

/**
 * Which findings a flag NAMES. Matched on the finding's own mark/owner strings appearing in the flag
 * text, normalised — the same join `correctionNamedSet` uses run-wide, scoped to one line.
 *
 * A flag that names nothing is not a defect: "the narrative's second paragraph overstates the crowd" is a
 * legitimate correction with no entity in it. It gets `targets: []` and an outcome of `not-entity-scoped`,
 * which is a different fact from "named something and nothing moved". PURE.
 */
export function targetsOf(flagText, known) {
  const hay = norm(flagText);
  const hits = [];
  for (const [k, orig] of known) if (k && hay.includes(k) && !hits.includes(orig)) hits.push(orig);
  return hits;
}

/** A finding's comparable state — the fields a correction can move. PURE. */
const stateOf = (f) => JSON.stringify({
  disposition: f?.disposition ?? null,
  withdrawn_reason: f?.withdrawn_reason ?? null,
  band: f?.band ?? null,
  composite: f?.composite ?? null,
  owner: f?.owner?.name ?? null,
  meters: f?.meters ?? null,
  legal_position: f?.legal_position ?? null,
  practical_position: f?.practical_position ?? null,
});

/** Index a findings doc by every name its findings answer to. PURE. */
function byName(doc) {
  const out = new Map();
  for (const f of doc?.findings ?? [])
    for (const name of [f?.mark, f?.owner?.name]) { const n = norm(name); if (n && !out.has(n)) out.set(n, f); }
  return out;
}

/**
 * The driver's own account of what the corrective pass did, flag by flag.
 *
 * `outcome` is DERIVED, never asserted:
 *   findings-removed      — a finding this flag names was present before the pass and is GONE after it;
 *   findings-changed      — at least one finding this flag names has a different comparable state;
 *   findings-unchanged    — it named findings and none of them moved;
 *   not-entity-scoped     — the flag names no finding (a prose/structure correction);
 *   not-checkable         — the pre-corrective snapshot is missing, so nothing can be compared.
 *
 * "findings-unchanged" is NOT a failure and must never be rendered as one: correcting a narrative
 * sentence, or answering a flag with a reasoned no-change, both land here legitimately. It is the
 * reviewer's job to say whether the answer is good — this only says what moved, so the reviewer is
 * arguing with evidence rather than with its own memory of two long documents.
 *
 * — WHY "findings-removed" IS ITS OWN CLASS AND NOT THE STRONGEST FORM OF "changed".
 * A corrective pass, handed a flagged fact (a named-owner use), DELETED the fact rather than correcting
 * it: the flag went away without the report becoming true. Round 2's re-check caught it, and the catch
 * was fortunate rather than structural — this table, the driver's own evidence, called that deletion
 * `findings-changed`, which is the outcome that reads as the flag having landed. This comment used to
 * say the removal was "the strongest evidence a flag landed"; it is the strongest evidence a flag was
 * ANSWERED, and answered-by-deletion is the one answer the reviewer must see as itself.
 *
 * REMOVAL WINS over a change on the same flag. A flag naming three findings where one vanished and two
 * moved is a removal: the two that moved need no second look, and the one that is gone is the whole
 * question. Reporting the majority outcome would bury it exactly where it was buried before.
 * PURE.
 */
// — THE DECLARED SCOPE OF A WHOLE REVIEW.
//
//   { scoped: true,  ordinals: [6, 9, 12] }  every flag declared what it is about; the corrective pass
//                                            may be told to leave everything else alone.
//   { scoped: false, ordinals: [] }          at least one flag declared nothing, so the safe reading is
//                                            that anything may need to move — today's behaviour exactly.
//
// ALL-OR-NOTHING ON PURPOSE. A partial scope is the dangerous shape: it reads like a narrow instruction
// while one flag's subject is unknown, so the pass is told not to touch the finding that flag is about.
// Under-correcting a client deliverable is worse than paying for a wide pass, and `kind`'s own fail-safe
// takes the same direction one field over. PURE.
export function correctionScope(rows) {
  const list = rows ?? [];
  if (!list.length) return { scoped: false, ordinals: [] };
  if (list.some((r) => r.ordinals == null)) return { scoped: false, ordinals: [] };
  const ords = [...new Set(list.flatMap((r) => r.ordinals ?? []))].sort((a, b) => a - b);
  return { scoped: true, ordinals: ords };
}

/** The ordinals a findings doc actually carries. PURE. */
export const ordinalsOf = (doc) => new Set((doc?.findings ?? []).map((f) => f?.ordinal).filter(Number.isInteger));

/** Index a findings doc by ordinal. PURE. Hoisted so `scopeDrift` and `buildCorrectionsApplied` ask
 *  the same question of the same map rather than each building one. */
const byOrdinal = (doc) => new Map((doc?.findings ?? [])
  .filter((f) => Number.isInteger(f?.ordinal)).map((f) => [f.ordinal, f]));

/**
 * — findings that MOVED but no flag named, and flags naming an ordinal the run does not have.
 *
 * Both are recorded rather than refused. A hard gate here costs a whole extra dispatch on the stage this
 * issue exists to make cheaper, and the reviewer is about to read the table anyway — it is better placed
 * to say whether a knock-on edit was right than a diff is. `unbound` is the `cite_unbound` shape one gate
 * over and would deserve a refusal if it ever recurs; the first round measures whether it does.
 * PURE.
 */
export function scopeDrift(rows, preDoc, postDoc) {
  const scope = correctionScope(rows);
  const named = new Set(scope.ordinals);
  const have = ordinalsOf(preDoc?.findings ? preDoc : postDoc);
  const unbound = [...new Set((rows ?? []).flatMap((r) => r.ordinals ?? []))].filter((o) => !have.has(o));
  if (!scope.scoped || !preDoc || !postDoc) return { scoped: scope.scoped, named: [...named], moved: [], unbound };
  const pre = byOrdinal(preDoc), post = byOrdinal(postDoc);
  const moved = [];
  for (const [ord, a] of pre) {
    if (named.has(ord)) continue;
    const b = post.get(ord);
    if (!b || stateOf(a) !== stateOf(b)) moved.push(ord);
  }
  return { scoped: true, named: [...named], moved, unbound };
}

export function buildCorrectionsApplied(rows, preDoc, postDoc) {
  // THE UNION OF BOTH SIDES, deliberately. Reading the post doc alone loses a finding the pass REMOVED —
  // and a removal is exactly when the flag would stop naming anything, so the post doc alone cannot even
  // see the event.: what that removal is EVIDENCE of is the question this module used to get wrong.
  const known = knownEntities(preDoc, postDoc);
  const pre = byName(preDoc), post = byName(postDoc);
  const preOrd = byOrdinal(preDoc), postOrd = byOrdinal(postDoc);
  return (rows ?? []).map((r) => {
    // — a DECLARED ordinal wins over the name match. `targetsOf` is a normalised prose join and it
    // is why six of nine flags on a delivered run resolved to nothing; the declaration is the reviewer's
    // own answer to the same question, and the driver validates it against the run's ordinals.
    //
    // ── — A DECLARED ORDINAL USED TO BE THROWN AWAY BY A NAMELESS FINDING ────────
    //
    // This resolved the declaration to the finding's NAME and then joined on that. A finding carrying
    // neither `mark` nor `owner.name` produced an empty `declared`, the code fell back to the prose
    // match, the prose match could not find a name that does not exist either — and the flag came out
    // `not-entity-scoped`, indistinguishable from one where the reviewer declared nothing at all.
    //
    // MEASURED, on the one scoped run in the four-run read: `named=[1..12]`, `unbound=[]` — every
    // declared ordinal exists — and FOUR of its twelve flags still resolved to nothing. The driver knew
    // exactly which finding each flag was about and discarded that certainty in favour of a name lookup.
    //
    // A third failure mode, distinct from "the reviewer did not declare" and from "the pass did not
    // close", and one that no per-flag retry would have touched. The ordinal IS the join; a name is a
    // way of guessing one. So the ordinals decide the outcome and the name is only a LABEL now — and a
    // finding with no name still gets a readable one rather than falling out of the measurement.
    const declaredOrds = (Array.isArray(r.ordinals) ? r.ordinals : [])
      .filter((o) => preOrd.has(o) || postOrd.has(o));
    const label = (o) => { const f = preOrd.get(o) ?? postOrd.get(o); return f?.mark ?? f?.owner?.name ?? `finding ${o}`; };
    const targets = declaredOrds.length ? declaredOrds.map(label) : targetsOf(r.text, known);
    let outcome;
    let removed = [];
    if (!preDoc) outcome = "not-checkable";
    else if (declaredOrds.length) {
      // The certain path. Every question below is asked of the finding the reviewer NAMED, by ordinal.
      removed = declaredOrds.filter((o) => preOrd.has(o) && !postOrd.has(o)).map(label);
      if (removed.length) outcome = "findings-removed";
      else {
        const moved = declaredOrds.some((o) => {
          const a = preOrd.get(o), b = postOrd.get(o);
          if (!a || !b) return true;
          return stateOf(a) !== stateOf(b);
        });
        outcome = moved ? "findings-changed" : "findings-unchanged";
      }
    }
    else if (!targets.length) outcome = "not-entity-scoped";
    else {
      // — asked FIRST, and named. A finding present before the pass and absent after it did not
      // change state; it stopped existing, and the flag that pointed at it has nothing left to point at.
      removed = targets.filter((t) => { const n = norm(t); return pre.get(n) && !post.get(n); });
      if (removed.length) outcome = "findings-removed";
      else {
        const moved = targets.some((t) => {
          const n = norm(t);
          const a = pre.get(n), b = post.get(n);
          // Only APPEARED reaches here now — a finding the pass added, which is a change. The vanished
          // half of this test moved to `removed` above; leaving it here as well would let a removal be
          // re-labelled `findings-changed` by any flag that also named something new.
          if (!a || !b) return true;
          return stateOf(a) !== stateOf(b);
        });
        outcome = moved ? "findings-changed" : "findings-unchanged";
      }
    }
    // `removed` is [] on every other outcome — the names are carried, never a count, because a reader
    // acting on this needs to know WHICH fact left the report.
    // — `ordinals` IS CARRIED. It was computed and dropped, so the saved artifact
    // could not answer "how many flags declared an ordinal at all" — the one number that decides
    // whether an unjoined flag is the reviewer's doing or the join's. Read across four runs and found
    // unrecoverable; one field makes it answerable from the next run on. It also feeds the report's
    // open-points section, which prints `(finding N)` beside a point and had no ordinals to print.
    return { n: r.n, kind: r.kind, typed: r.typed, text: r.text,
      ordinals: Array.isArray(r.ordinals) ? r.ordinals : null, targets, outcome, removed };
  });
}

/**
 *, T3b — WHICH OF THE REVIEWER'S OBJECTIONS THE RUN COULD NOT SHOW IT CLOSED.
 *
 * Owner decision, 2026-08-26, put to him as a client outcome: an objection the engine tried and failed
 * to fix is PRINTED IN THE REPORT, whatever the verdict. So the report needs a predicate over the
 * outcomes `buildCorrectionsApplied` mints, and the predicate's default direction is the whole of it.
 *
 * ── WRITTEN AS A CLOSED RESOLVED SET, SO A NEW OUTCOME PRINTS RATHER THAN VANISHES ─────────────────
 *
 * The tempting form is a list of the unresolved outcomes. It is the wrong way round: a sixth outcome
 * added later would match neither list and read as RESOLVED, which silently drops an objection from a
 * client's report — the exact class this repo keeps finding, where the permissive answer looks like the
 * old working one. Naming the resolved set instead means an unclassified outcome is DISCLOSED. That is
 * both the safe direction and the one the owner chose.
 *
 * ── WHY `findings-removed` IS NOT RESOLVED, WHICH IS THIS MODULE'S OWN RULING ──────────────────────
 *
 * `correctionsWorklist` states it directly: "CORRECT OR ESCALATE; DELETION IS NOT AN AVAILABLE MOVE. A
 * pass given a flagged fact deleted it rather than correcting it: the flag went away and the report did
 * not become true." A removal is the flag losing its subject, not the objection being answered, so it
 * belongs on the printed side. Deciding it here rather than at the report keeps one implementation of a
 * question this file already answered once.
 *
 * PURE.
 */
export const RESOLVED_OUTCOMES = Object.freeze(["findings-changed"]);

/** The rows to print. Anything not positively resolved, including a row of an outcome nobody has met. */
export const unresolvedFlags = (rows) =>
  (Array.isArray(rows) ? rows : []).filter((r) => r && !RESOLVED_OUTCOMES.includes(r.outcome));

/**
 * The typed worklist the corrective pass is handed, grouped by kind.
 *
 * Grouped rather than listed flat because the four kinds want four different moves, and a pass reading
 * twelve mixed lines has to re-derive that grouping for itself every time. The raw review still rides
 * below it in the followup: this is a better index of the same evidence, not a replacement for it. PURE.
 */
export function correctionsWorklist(rows) {
  if (!rows?.length) return "";
  const byKind = new Map();
  for (const r of rows) { if (!byKind.has(r.kind)) byKind.set(r.kind, []); byKind.get(r.kind).push(r); }
  const out = [`THE FLAGS, TYPED (${rows.length} — the reviewer's own \`[kind: …]\` declarations; an untyped line reads as \`fact\`):`];
  for (const [kind, list] of byKind) {
    out.push(`${kind} (${list.length}):`);
    for (const r of list) out.push(`  ${r.n}. ${r.text}`);
  }
  // — CORRECT OR ESCALATE; DELETION IS NOT AN AVAILABLE MOVE. A pass given a flagged fact deleted
  // it rather than correcting it: the flag went away and the report did not become true. Stated as a
  // constraint on the worklist itself, where the moves are chosen, rather than left to the recheck to
  // catch afterwards — the recheck that caught it did so once, and once is luck.
  out.push("",
    "REMOVING A FLAGGED FINDING DOES NOT ANSWER ITS FLAG. Correct the fact, or say why it cannot be corrected "
    + "and leave it standing for the reviewer. A finding you believe should not be there is WITHDRAWN with its "
    + "reason recorded, never deleted — a flag that stops naming anything reads as resolved, and the driver "
    + "reports the deletion by name either way.");
  return out.join("\n");
}

/**
 * The table the RECHECK is handed instead of "re-read both documents and see".
 *
 * The recheck's whole cost is that it re-reads the narrative and the findings to work out whether its own
 * corrections landed. The driver already knows: it holds the pre-corrective findings snapshot and the
 * post-pass file. Handing it that answer leaves the reviewer to do the part only it can — judge whether
 * what changed is RIGHT — rather than re-deriving what changed. PURE.
 */
export function correctionsAppliedTable(applied) {
  if (!applied?.length) return "";
  const out = ["WHAT THE DRIVER OBSERVED, flag by flag (machine-derived from the findings before and after the corrective pass — this is evidence, not the author's account of itself):",
    "", "| # | kind | flag | findings it names | what moved |", "|---|---|---|---|---|"];
  for (const r of applied) {
    // — a removal NAMES what left. `findings-removed` alone would tell the recheck that something
    // was deleted and not which fact, which is the half it needs to decide whether the deletion was legitimate.
    const what = r.outcome === "findings-removed" && r.removed?.length
      ? `${r.outcome}: ${r.removed.join(", ")}`
      : r.outcome;
    out.push(`| ${r.n} | ${r.kind} | ${r.text.slice(0, 90)}${r.text.length > 90 ? "…" : ""} | ${r.targets.join(", ") || "—"} | ${what} |`);
  }
  out.push("",
    "`findings-unchanged` is NOT a failure: a narrative-only correction and a reasoned no-change both land there. "
    + "What it tells you is where to look first.");
  if (applied.some((r) => r.outcome === "findings-removed"))
    out.push("",
      "**`findings-removed` IS a failure until you rule otherwise.** A flagged finding that is GONE after the "
      + "corrective pass had its flag answered by deletion, not by correction — the flag stops naming anything, "
      + "so it reads as resolved while the report is no truer than before. Check each named finding: a "
      + "withdrawal the evidence supports is legitimate and belongs in the record AS a withdrawal with its "
      + "reason; a fact removed because it was inconvenient to correct is the defect this row exists to show you.");
  return out.join("\n");
}
