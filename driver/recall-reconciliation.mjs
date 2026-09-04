// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recall-reconciliation.mjs — the retrieved→judgment RECONCILIATION join (P2-A, the recall spine).
//
// The 2026-07-29 evidence run proved the loss class this module closes: records retrieved by the
// funnel, screened `surface:in-scope-live` on the dominant element in an instructed class, and then
// DEAD before any judgment surface — no finding, no drop row, no ruling, no mention (a live US
// registration among them). Every existing gate polices text that EXISTS (screen-gate polices drop
// rows that were written; the coverage ledger is per-slice; the recall floor is identical-name only)
// — the per-record obligation for same-family/other composites was prose, with no code join. This
// module is that join, the joinPlanToBands / ask-ledger-endings pattern applied to records:
//
//     screened-live dominant-element candidates  ∖  endings  =  a hard discrepancy list
//
// An ENDING is one of exactly three things a reader can see:
//   1. a carried finding  — the record's /mark URI appears in the findings file OUTSIDE the
//      Negative-results section (a Risk-relevant/Sheet-2/watchlist/out-of-scope row, or prose);
//   2. an individually reasoned negative — the URI appears in a Negative-results drop row;
//   3. membership of an explicitly ruled, COUNTED crowd — a Coverage-ledger row whose scope names
//      the dominant-element crowd and declares a member count covering the residual. Counted, never
//      enumerated: the crowd ruling is one row; the machine artifact enumerates the members.
//
// The candidate set is code-computed and code-RANKED; the top slice (the code-ranked closest
// records — registered rights first, then the freshest pendings) must ALWAYS end individually
// (1 or 2) — a crowd is a valid reasoned ending for the residual only. This is the Round-2 ruling:
// crowd-membership is a legitimate ending (crowd = judgment fuel), individual endings are mandatory
// only for the code-ranked top slice — never a write-everything rule, never a silent death.
//
// ── ROUND-2 FIX (review problem 2) — THE UNIT OF THE JOIN IS THE POSITION ──────────────────────────
// The first cut had two contracts joined only by prose: digest.md told the digest to write ONE
// Sheet-1 row per POSITION (the exact-identity collapse), while this join credited an ending only to
// the URIs literally cited, with no notion of positions. Proven on real records: /mark/cn/CHINIC4DC…
// and /mark/cn/CHINIC7788… (both TIKI TWIST, NORTHCOMEX USA LLC, class 32, REGISTERED) are ONE
// position AND both sit in the code-ranked top slice — a compliant digest writing one position row
// citing the senior URI left the other unended and the delivery died. The only thing standing
// between a correct report and a blocked run was a prose clause ("the URI cell listing EVERY
// constituent record URI") — a prompt, not a gate.
//
// So the POSITION is now the unit end to end: rows, ranking, top slice, residual and the crowd count
// are all per position, and an ending cited on ANY constituent URI ends the whole position. The two
// contracts share ONE source of truth — the count the followup dictates and the count this function
// computes come from the same denominator, so the 378-vs-379 block cannot reappear at a new seam.
// `positions` is DATA supplied by the caller (the driver's _driver/register-positions.json); with no
// positions every candidate is its own singleton position and the join degrades to per-record —
// legacy runs and register-gap runs keep working unchanged.
//
// PURE (no node imports) — the pipeline owns all IO, events and enforcement.

import { normalizeRecordUri } from "./registry-fidelity.mjs";
import { appendRepairTail } from "./repair-contract.mjs";   // pure too — see repair-contract.mjs's header
import { CROWD_RULING_TOKEN, CROWD_RULING_UNIT_GRAMMAR, COVERAGE_STATUSES, REGISTER_AXES,
  crowdRulingCount } from "./coverage-ledger.mjs";

// v2 — the join unit changed from the record to the POSITION (review problem 2).
export const RECALL_RECONCILIATION_SCHEMA_VERSION = 2;

/** The top slice size: the code-ranked POSITIONS that must end individually (finding or drop row). */
export const RECALL_TOP_SLICE = 10;

/**
 * The Coverage-ledger scope token that marks a crowd ruling row (see parseCrowdRulings).
 * MOVED to coverage-ledger.mjs and re-exported here, so every existing import site is unchanged. It had
 * to move because coverage-form.mjs must carry the same token into the `seat_row_contract` it writes
 * INTO the file the seat edits, and that module is pure by contract while this one is not (it reaches
 * registry-fidelity.mjs, which reads the filesystem). A second copy of the literal is 's defect.
 *
 * `crowdRulingCount` moved for the SAME reason and rides the same re-export: the typed coverage
 * call now refuses an uncounted crowd row at call time, and it is pure, so the parser had to sit in the
 * pure module both sides can reach.
 */
export { CROWD_RULING_TOKEN, CROWD_RULING_UNIT_GRAMMAR, crowdRulingCount };

const URI_RE = /\/mark\/[a-z]{2,6}\/[\w-]+/gi;
const lc = (u) => String(u ?? "").toLowerCase();

/**
 * Rank dominant-element candidates, strongest first. Deterministic, provider-neutral, and built so
 * the proven losses always rank top: (1) basis strength (a standalone dominant-element token beats
 * an edit-1 token beats a concatenation), (2) status (a REGISTERED right beats a pending
 * application beats other-live), (3) application year, newest first (the freshest filings are the
 * examination-collision risk), (4) record_id for stability. Returns a NEW sorted array.
 */
export function rankCandidates(candidates) {
  const basisRank = (b) => (b === "token-identical" ? 3 : b === "token-edit-1" ? 2 : 1);
  const statusRank = (s) => {
    const t = String(s ?? "").toLowerCase();
    if (/regist/.test(t)) return 2;
    if (/pend|appl|filed|examin|publish/.test(t)) return 1;
    return 0;
  };
  const year = (c) => {
    const m = String(c?.application_date ?? "").match(/\b(19|20)\d{2}\b/);
    return m ? Number(m[0]) : 0;
  };
  return [...candidates].sort((a, b) =>
    basisRank(b.basis) - basisRank(a.basis)
    || statusRank(b.status) - statusRank(a.status)
    || year(b) - year(a)
    || String(a.record_id).localeCompare(String(b.record_id)));
}

/**
 * Every /mark URI in the findings file, split by WHERE it appears: `dropRows` = inside a
 * "Negative results" section (an individually reasoned negative), `carried` = anywhere else (a
 * finding row / watchlist / out-of-scope / prose disposition — visible to a reader either way).
 * Section walk mirrors screen-gate.mjs; URIs are lowercased. PURE.
 */
export function parseFindingsEndings(findingsContent) {
  const carried = new Set();
  const dropRows = new Set();
  let inNeg = false;
  for (const ln of String(findingsContent ?? "").split("\n")) {
    const h = ln.match(/^#{1,6}\s+(.*)/);
    if (h) { inNeg = /negative results/i.test(h[1]); continue; }
    for (const m of ln.matchAll(URI_RE)) (inNeg ? dropRows : carried).add(lc(m[0]));
  }
  return { carried, dropRows };
}

/**
 * Crowd ruling rows from the (already parsed) Coverage-ledger rows: any row whose unit/scope names
 * the dominant-element crowd and declares a member count — `… dominant-element crowd (N members) …`.
 * Returns [{scope, status, declared, reason}]; declared = the parsed count (0 when unparseable —
 * an uncounted ruling covers nothing). PURE.
 *
 * — the token test and the count regex MOVED to coverage-ledger.crowdRulingCount and are called
 * here rather than restated. Behaviour is unchanged by construction (the two lines this replaced are
 * that function's body), and the point is what the move buys: the typed coverage call refuses the
 * uncounted row using this exact reading, so the refusal at call time and the block at delivery can
 * never be about different numbers.
 */
export function parseCrowdRulings(ledgerRows) {
  const out = [];
  for (const r of ledgerRows ?? []) {
    const cell = String(r?.unit ?? r?.scope ?? "");
    const declared = crowdRulingCount(cell);
    if (declared === null) continue;   // null = not a crowd ruling; 0 = ruled and counting nothing
    out.push({
      scope: cell,
      status: r?.status ?? null,
      declared,
      reason: String(r?.reason ?? ""),
    });
  }
  return out;
}

/**
 * Group ranked candidates into POSITIONS. `positions` is the driver's exact-identity projection —
 * either `deriveRegisterPositions().positions` rows ({records:[uri,…]}) or bare uri arrays. A
 * candidate in no supplied position is its own singleton. Groups come back in ranked order (a
 * position's rank is its STRONGEST constituent candidate) and each carries the position's FULL
 * constituent list, including records that are not themselves candidates — the digest may end the
 * position by citing any one of them. PURE.
 */
// Each group carries TWO parallel member lists: `members` are lowercased canonical JOIN KEYS (the
// findings-ending sets are lowercased), and `member_display` are the URIs in the band's own casing.
// The distinction is load-bearing downstream, not cosmetic: the followup PRINTS URIs for the model to
// copy into a Sheet-1 row, and the report composes its clickable URL from the cited path — register
// record ids are provider-native uppercase, so printing the join key would push a case-mangled path
// into the delivered report. Match on `members`, show `member_display`.
export function groupByPosition(rankedCandidates, positions = []) {
  const canon = (u) => lc(normalizeRecordUri(u) || u || "");
  const keyOf = new Map();                          // member uri (lowercased) → position key
  const membersOf = new Map();                      // position key → {keys[], display[]}
  for (const p of positions ?? []) {
    const byKey = new Map();                        // lowercased key → the URI as written (first wins)
    for (const u of (Array.isArray(p) ? p : p?.records ?? [])) {
      const k = canon(u);
      if (k && !byKey.has(k)) byKey.set(k, String(u));
    }
    if (!byKey.size) continue;
    const keys = [...byKey.keys()].sort();
    membersOf.set(keys[0], { keys, display: keys.map((k) => byKey.get(k)) });
    for (const k of keys) keyOf.set(k, keys[0]);
  }
  const groups = [];
  const seen = new Map();
  for (const c of rankedCandidates) {
    const uri = canon(c.record_id);
    const key = keyOf.get(uri) ?? uri;
    let g = seen.get(key);
    if (!g) {
      const m = membersOf.get(key) ?? { keys: [uri], display: [String(c.record_id ?? uri)] };
      g = { key, members: m.keys, member_display: m.display, candidates: [] };
      seen.set(key, g);
      groups.push(g);
    }
    g.candidates.push(c);
  }
  return groups;
}

/**
 * THE JOIN. candidates = dominantElementComposites() output (band-shape.mjs); endings =
 * parseFindingsEndings() output; crowdRulings = parseCrowdRulings() output; positions = the
 * exact-identity projection (deriveRegisterPositions().positions) or [] for per-record behaviour.
 *
 * The unit is the POSITION (review problem 2). Rules:
 *  - a position ends when ANY constituent URI is in `dropRows` (a reasoned negative) or `carried`
 *    (a finding) — this is the same "one Sheet-1 row per position citing a constituent URI" contract
 *    the digest is given, so the two can never disagree;
 *  - the code-ranked top slice (first `topSlice` POSITIONS after ranking) must end individually — a
 *    crowd NEVER ends a top-slice position;
 *  - the residual (below the slice, not individually ended) is covered by crowd membership IFF at
 *    least one crowd ruling exists AND the summed declared count >= the residual POSITION count
 *    (declared may exceed it — a ruling that covers more than needed stays valid across rounds);
 *  - everything else is UNENDED — the hard discrepancy list.
 *
 * Deterministic; returns the machine artifact (no timestamps — the caller stamps `ts`).
 */
export function reconcileRecall({ candidates = [], endings, crowdRulings = [], topSlice = RECALL_TOP_SLICE, positions = [], dominantElement = null, inScopeClasses = [] } = {}) {
  const carried = endings?.carried ?? new Set();
  const dropRows = endings?.dropRows ?? new Set();
  const ranked = rankCandidates(candidates);
  const groups = groupByPosition(ranked, positions);
  // ANY constituent URI ends the position — drop row first so an explicit negative is reported as
  // the reason even when the same position is also mentioned elsewhere.
  // match on the lowercased key, REPORT the URI in the band's own casing (see groupByPosition)
  const endingOf = (g) => {
    for (let i = 0; i < g.members.length; i++) if (dropRows.has(g.members[i])) return { ending: "drop-row", ended_by: g.member_display[i] };
    for (let i = 0; i < g.members.length; i++) if (carried.has(g.members[i])) return { ending: "finding", ended_by: g.member_display[i] };
    return { ending: null, ended_by: null };
  };
  const top = groups.slice(0, Math.max(0, topSlice));
  const rest = groups.slice(Math.max(0, topSlice));
  const row = (g, tier) => {
    const c = g.candidates[0];                      // the position's strongest constituent candidate
    const { ending, ended_by } = endingOf(g);
    return {
      record_id: c.record_id, mark_text: c.mark_text, basis: c.basis, classes: c.classes,
      status: c.status, registry: c.registry, application_date: c.application_date ?? null,
      // the position, spelled out: every constituent URI (any one of which ends it) and the
      // candidate records it collapses — so the artifact is auditable without re-deriving positions.
      // Provider casing, because these URIs are printed for the model to copy into a Sheet-1 row and
      // the report composes its clickable URL from the cited path.
      position_records: g.member_display,
      candidate_records: g.candidates.map((x) => x.record_id),
      tier, ending, ended_by,
    };
  };
  const topRows = top.map((g) => row(g, "top-slice"));
  const restRows = rest.map((g) => row(g, "residual"));
  const residualUnended = restRows.filter((r) => !r.ending);
  const declared = crowdRulings.reduce((n, r) => n + (Number.isFinite(r.declared) ? r.declared : 0), 0);
  const crowdCovers = crowdRulings.length > 0 && declared >= residualUnended.length;
  const unended = [
    ...topRows.filter((r) => !r.ending).map((r) => ({ ...r,
      why: "code-ranked top-slice position with no individual ending — needs a finding row or a Negative-results drop row citing ANY ONE of its constituent URIs (a crowd never ends a top-slice position)" })),
    ...(crowdCovers ? [] : residualUnended.map((r) => ({ ...r,
      why: crowdRulings.length
        ? `residual position not individually ended and the ruled crowd counts only ${declared} member(s) against a residual of ${residualUnended.length} — refresh the crowd ruling's count or end the position individually`
        : "residual position not individually ended and NO ruled dominant-element crowd exists in the Coverage ledger — rule the crowd (one counted row) or end the position individually" }))),
  ];
  for (const r of restRows) if (!r.ending && crowdCovers) r.ending = "crowd";
  return {
    schema_version: RECALL_RECONCILIATION_SCHEMA_VERSION,
    computable: true,
    unit: "position",
    dominant_element: dominantElement,
    in_scope_classes: inScopeClasses,
    top_slice: topRows,
    crowd: { rulings: crowdRulings, declared, residual: residualUnended.length, covers: crowdCovers },
    totals: {
      candidates: ranked.length,
      positions: groups.length,
      top_slice: topRows.length,
      ended_finding: [...topRows, ...restRows].filter((r) => r.ending === "finding").length,
      ended_drop_row: [...topRows, ...restRows].filter((r) => r.ending === "drop-row").length,
      ended_crowd: restRows.filter((r) => r.ending === "crowd").length,
      unended: unended.length,
    },
    unended,
  };
}

/**
 * ROUND-2 FIX (review problem 8) — the `recall-reconciliation` run.jsonl row, built ONE way for both
 * branches. The first cut logged only {trigger, computable:false, reason} when the join could not run,
 * so "the gate found nothing unended" (unended:0) and "the gate did not run" were indistinguishable by
 * FIELD PRESENCE on that row — the exact ambiguity landed the instrumentation house rule to kill.
 * Every field below is written on every row; absence is expressed as an explicit null. PURE.
 */
export const RECALL_EVENT_FIELDS = ["candidates", "positions", "top_slice", "ended_finding",
  "ended_drop_row", "ended_crowd", "unended", "crowd_declared", "crowd_residual"];

export function recallReconciliationEvent({ trigger = null, artifact = null, reason = null } = {}) {
  const computable = artifact?.computable === true;
  const vals = computable
    ? { ...artifact.totals, crowd_declared: artifact.crowd?.declared, crowd_residual: artifact.crowd?.residual }
    : {};
  const row = { event: "recall-reconciliation", trigger, computable, reason };
  for (const k of RECALL_EVENT_FIELDS) row[k] = vals[k] ?? null;
  return row;
}

/**
 * The unended-set SIGNATURE a followup attempt is counted against — the sorted position keys, so a
 * digest that ends one position and loses another re-arms the budget while a byte-identical stall
 * does not. PURE. (Uses the position's full constituent list, not the representative alone, so a
 * re-derive that picks a different senior leg for the same position keeps the same signature.)
 */
export function unendedSignature(artifact) {
  return (artifact?.unended ?? [])
    .map((u) => (u.position_records?.length ? u.position_records.map(lc).sort().join("+") : lc(u.record_id)))
    .sort().join(",");                             // case-folded: the signature is identity, not display
}

/**
 * ROUND-2 FIX (review problem 5) — the followup receipt that must SURVIVE a re-derive.
 * `deriveRecallReconciliation` replaces the artifact file wholesale on every pass; the attempt
 * counter lives in that file, so without this carry-forward the counter reset to 0 on every read and
 * RECALL_FOLLOWUP_MAX never engaged (an unbounded warm digest turn per pass, on a 2,596-record band).
 * Returns the keys to merge over the fresh artifact: the prior receipt is kept only while the
 * unended set is UNCHANGED — a different set is genuinely new work and gets a fresh budget. PURE.
 */
export function carryRecallFollowup(priorArtifact, freshArtifact) {
  const prior = priorArtifact?.followup ?? null;
  if (!prior?.sig) return {};
  return prior.sig === unendedSignature(freshArtifact) ? { followup: prior } : {};
}

/**
 * The warm-followup text for an unended reconciliation — dictates the three ending forms verbatim,
 * with the CURRENT code-computed residual count for the crowd row (so the declared count can never
 * drift below the census). The counts and the unit here come from the SAME artifact reconcileRecall
 * produced, so what the digest is told to declare and what the gate re-computes are one number
 * (review problem 2). PURE; the pipeline sends it on the winning digest session.
 *
 * ── ROUND 4: THE CROWD ROW GOES IN THE FORM, AND UNDER IT NEVER WENT ANYWHERE ELSE ────────────
 *
 * This block used to dictate the crowd ruling as a markdown TABLE ROW appended to register-findings.md,
 * and after a seat that complied EXACTLY could not clear the gate. Trace it: the followup lands,
 * the seat writes the pipe row into the findings file, the pass ends ok, and pipeline's
 * deriveCoverageLedgerJson runs — `renderCoverageLedgerFromForm` splices the `## Coverage ledger`
 * section out and re-renders it FROM THE FORM (spliceCoverageLedger REPLACES the section), and
 * `renderCoverageLedgerJsonFromForm` rewrites register-coverage-ledger.json FROM THE FORM. Then
 * deriveRecallReconciliation re-reads the rulings through loadCoverageLedger, which prefers that JSON.
 * The row the seat was ordered to write is gone from both artifacts before anything reads it. Unended
 * stays put, the followup budget burns, and the pre-verdict floor blocks delivery over a ruling that
 * WAS made. That is exactly — a fact obeyed as a failure and ignored as an input — on the one
 * seat row the digest is compelled to write and the only one that blocks a report.
 *
 * So when the run has a coverage form, the row is dictated as the FORM OBJECT, with all five fields
 * SEAT_ROW_FIELDS names and the count in the cell parseCrowdRulings actually reads. `coverageFormPath`
 * absent keeps the old table dictation byte-for-byte: a legacy or archived-resume run has no form, its
 * ledger IS the prose table, and loadCoverageLedger's prose fallback is what reads it.
 *
 * THE AXIS IS THE SEAT'S HERE TOO. This block used to hard-code `primary-sweep` into the dictated row
 * while the skill and `seat_row_contract.axis_rule` both attribute a counted dominant-element crowd to
 * `saturation-probe` — a real disagreement, though not a gate-refused one, and it is NOT settled here:
 * `saturation-probe` is in NON_MATERIAL_AXES, so the choice moves the CLEAR→CONDITIONAL clamp and that
 * is a doctrine call, not a fix-round call. The dictation now shows the closed set and leaves the
 * attribution to the seat, which is the only change that cannot move a verdict on its own. Raised.
 */
export function buildReconcileFollowup(artifact, { registerFindingsPath, hasCoverageForm = false }) {
  const un = artifact?.unended ?? [];
  const topUn = un.filter((r) => r.tier === "top-slice");
  const resUn = un.filter((r) => r.tier === "residual");
  // A position ends when ANY ONE constituent URI is cited — spelled out per row so the model never
  // has to guess that citing the senior leg is enough (the prose-only version of this contract is
  // exactly what made a compliant digest block).
  const cites = (r) => {
    const members = r.position_records ?? [];
    return members.length > 1
      ? ` — ONE position of ${members.length} records; cite ANY ONE of: ${members.join(" ; ")}`
      : "";
  };
  const lines = [
    `You are RESUMING your own register-digest session. The driver's retrieved-to-judgment RECONCILIATION found ${un.length} screened-live dominant-element POSITION(s) that end NOWHERE a reader can see — retrieved, screened in an instructed class, then silent. A report never ships losing screened candidates silently. The unit is the POSITION (the exact-identity collapse in the shape's "## Positions" section): one row ends the whole position, and citing ANY ONE constituent URI is enough. End each one now:`,
  ];
  if (topUn.length) {
    lines.push(
      ``,
      // CONVERSION 11 — the row SHAPES are gone from this dictation because the driver renders them. What
    // the seat sends is the uri and its judgment; the Notes cell's provenance is composed from the band.
    `TOP-SLICE (code-ranked closest positions — each MUST end individually, never as a crowd member): give each either a \`findings_rows\` entry (uri + flag_reason + verify) OR a \`negative_rows\` entry (uri + drop_reason), sent through \`record_register_digest\`. One position per entry, reason decided on that right's own facts. You cite the uri; the driver renders every identifier cell and the drop-row provenance from the band record it names:`,
      ...topUn.map((r) => `- ${r.record_id} — ${r.mark_text} (${(r.classes ?? []).join(",")}; ${r.status}; ${r.registry})${cites(r)}`),
    );
  }
  if (resUn.length) {
    lines.push(
      ``,
      `RESIDUAL (${resUn.length} position(s)): individually ending each is NOT required — membership of an explicitly ruled, counted crowd is a legitimate reasoned ending. Add (or refresh) ONE crowd-ruling coverage row with a declared count >= ${resUn.length}:`,
      ...(hasCoverageForm ? [
        // THE TOOL, NOT THE TABLE AND NOT A FILE (typed transport). The driver re-renders both the
        // `## Coverage ledger` table and register-coverage-ledger.json FROM what the tool records, so a
        // row written anywhere else is overwritten before the reconciliation re-reads it. All five
        // fields, because a seat row missing `kind` is dropped by seatRows and one missing `axis` is
        // refused at call time.
        `It is recorded through the \`record_coverage\` TOOL — a seat row, NOT a markdown table row and NOT an edit to any file. The driver re-renders the \`## Coverage ledger\` table and its JSON mirror from what the tool records after this pass, so a table row you type by hand is overwritten before anything reads it and the ruling counts for nothing. Call record_coverage with:`,
        `  { "kind": "seat", "axis": "<one bare token of: ${REGISTER_AXES.join(" / ")}>", "unit": "<that same axis> / ${CROWD_RULING_TOKEN} (${resUn.length} members): <one-line label for the residual class>", "status": "${COVERAGE_STATUSES[0]}" OR "${COVERAGE_STATUSES[1]}", "reason": "<the ruling — WHY crowd membership is the reasoned ending for these positions (crowding, dilution, off-field pattern), on your judgment of the class, never a count threshold>" }`,
        `THE COUNT LIVES IN THE \`unit\` VALUE AND NOWHERE ELSE. A count written into \`reason\` reads as ZERO, the crowd then covers no position, and delivery blocks over a ruling you did make. A re-sent row with the same unit REPLACES the recorded one, so refreshing the count is one call.`,
      ] : [
        // No form on this run (legacy / archived resume): the prose table IS the ledger, read by
        // loadCoverageLedger's fallback. Unchanged dictation, deliberately.
        `Add it to the Coverage ledger table in EXACTLY this shape, with a real register axis on the left (one of: ${REGISTER_AXES.join(" / ")}):`,
        `| <axis> / ${CROWD_RULING_TOKEN} (${resUn.length} members): <one-line label for the residual class> | ${COVERAGE_STATUSES[0]} OR ${COVERAGE_STATUSES[1]} | <the ruling — WHY crowd membership is the reasoned ending for these positions (crowding, dilution, off-field pattern), on your judgment of the class, never a count threshold> |`,
      ]),
      `The count is in POSITIONS, exactly as the driver counts them — write ${resUn.length}, not a record count.`,
      `Any residual position your judgment says is NOT mere crowd (a live registration you'd cite, a fresh in-class pending) gets its own finding or drop row instead — either direction is yours; the obligation is only that it ENDS somewhere visible.`,
    );
  }
  lines.push(
    ``,
    // A-3 — this was "re-emit the COMPLETE updated <file> (full file, not a diff)", the sentence
    // repair-contract.mjs exists to retire. It is the wrong instruction twice over here. register-findings.md
    // is the largest document in the run (103 KB on the evidence run, 160 KB by the end of its ladder), and
    // this correction ADDS rows for positions that end nowhere — it changes nothing already written. Retyping
    // 160 KB to add four rows is the latency, and it risks every line it retypes.
    // appendRepairTail rather than editRepairTail: the file is INCOMPLETE, so "everything not named above
    // already passed" would be false, and an append is supposed to grow.
    // TWO ROUTES WHEN THERE IS A FORM, and saying so is the point: the findings file takes the
    // individual endings, the crowd row rides the record_coverage tool. The old single sentence sent
    // both to the findings file, where the crowd row was overwritten by the driver's own re-render.
    // ── CONVERTED (conversion 11) ─────────────────────────────────────────────────────────────────
    //
    // What stood here named the findings path and closed with `appendRepairTail` — a hand-write order
    // for a document whose only writer is now the driver, which is the superseded path the golden rule
    // bans and which recording-agreement direction (a) refuses by name.
    //
    // THE ARGUMENT THAT PUT `appendRepairTail` HERE IS PRESERVED, NOT DISCARDED, and it is why the call
    // below says PATCH. This correction ADDS endings for positions that end nowhere and changes nothing
    // already written; the findings document was 103 KB on the evidence run and 160 KB by the end of its
    // ladder, and re-emitting it to add four rows was the latency this tail existed to avoid. A patch
    // call carries exactly the rows being added: cheaper than the append it replaces, and it cannot
    // half-apply the way a targeted edit can.
    //
    // TWO ROUTES WHEN THERE IS A FORM, and saying so is still the point: the individual endings ride
    // record_register_digest, the crowd row rides record_coverage. Two transports, two statements.
    hasCoverageForm && resUn.length
      ? `Send the individual endings as a PATCH call to \`record_register_digest\` (patch: true — the rows you name are added or replaced by uri and everything else you sent is kept), and record the crowd row through the \`record_coverage\` tool. Two calls, two transports. There is no file for you to write or edit.`
      : `Send these endings as a PATCH call to \`record_register_digest\` (patch: true — the rows you name are added or replaced by uri and everything else you sent is kept). Change nothing you are not ending. There is no file for you to write or edit and nothing you write by hand is read.`,
  );
  return lines.filter((l) => l !== null).join("\n");
}

// ── read-before-rate (charter P2c) — the deciding-document join ─────────────────────────────────────
//
// A disposition that turns on goods wording / status / examination history must rest on the on-disk
// record, READ — not on the band row. The findings contract already stamps the claim
// (meters[].basis === "verified-from-record" + a /mark source); the reading layer already logs every
// band_record call. This join makes the stamp checkable: stamped-from-record × record-on-disk ×
// reading-log ok:true. The evidence run stamped 19/19 findings "verified-from-record" while reading
// 9 documents — the honor-system gap this closes.

/**
 * @param findings   parsed findings[] (lenient parse output)
 * @param hasRecord  (lowercased canonical uri) => boolean — is the official record on disk?
 * @param wasRead    (lowercased canonical uri) => boolean — reading-log ok:true band_record row?
 * @returns rows [{ordinal, mark, meter, uri, onDisk, read}] for every verified-from-record register
 *          source; `violations` = onDisk && !read (a stamp the reading log cannot back). PURE.
 */
export function findUnreadRatedSources({ findings = [], hasRecord = () => false, wasRead = () => false } = {}) {
  const rows = [];
  for (const f of findings) {
    if (String(f?.disposition ?? "") === "withdrawn") continue;
    for (const [meter, m] of Object.entries(f?.meters ?? {})) {
      if (!m || m.basis !== "verified-from-record") continue;
      const canon = normalizeRecordUri(m.source);
      if (!canon) continue;                       // a URL / non-register source — not this join's subject
      const uri = lc(canon);
      const onDisk = hasRecord(uri);
      rows.push({ ordinal: f.ordinal ?? null, mark: f.mark ?? null, meter, uri, onDisk, read: onDisk ? wasRead(uri) : null });
    }
  }
  return { rows, violations: rows.filter((r) => r.onDisk && r.read === false) };
}

// ──: the basis a run can PROVE ─────────────────────────────────────────────────────────────────
//
// RULING (2026-08-10): `basis: "verified-from-record"` means THE RUN CAN PROVE IT. The model never
// self-attests a read. That is the rule every form in this program was built on — the machine writes
// what must be exact, the model supplies judgment — and a basis claim is exact data, not judgment.
//
// So the stamp stops being a claim that gets AUDITED and becomes a field that gets DERIVED. The
// difference is not stylistic. The audit was a second full synthesis pass costing ~10 serial minutes on
// 3 of 4 runs to have a model re-assert what the log already knew, and it had two structural holes that
// no amount of re-asserting could close:
//
//   1. IT RAN ONCE, BEFORE REFUTATION. Re-derived on the delivered findings.json of the four runs it
//      measured, the counts do not match what it recorded: 35→37, 28→31, 37→38, 41→40. Stamps entered
//      and left the deliverable AFTER the only check that polices them. A derivation runs at every
//      write, so there is no "after".
//   2. `off_disk` WAS NEVER A VIOLATION. The join only fired on onDisk && !read, so a stamp citing a
//      record the run never fetched at all fell through untouched. the 2026-08-10 R6
//      delivered with its own artifact reading {"stamped":19,"read":0,"off_disk":19,"violations":0}:
//      nineteen meters claiming the disposition rests on the official record, zero of those records on
//      disk, and the gate reported no violation. Under "the run can prove it" there is nothing to
//      argue about — nineteen unprovable claims are nineteen demotions.
//
// A demotion is not a flag and not a caveat: the meter becomes `inferred-from-signal`, which is what the
// evidence supports, and every downstream surface already knows how to present an inference AS one
// (stages.mjs card contract, joinEvidenceStatus's `_status`). The source is KEPT — it is still the lead
// the claim points at, and dropping it would destroy the only thing that says which record to go read.

/**
 * Every meter whose `verified-from-record` stamp the machine evidence cannot support.
 *
 * Scope is exactly `findUnreadRatedSources`': meters citing a REGISTER RECORD uri. A meter citing a
 * website is not this join's subject — the reading log does not cover the open web, and demoting on
 * evidence nothing collects would be a guess wearing a machine's authority.
 *
 * @returns [{ordinal, mark, meter, uri, from, to, why}] — `why` is `record-never-fetched` (no record on
 *          disk to have read) or `record-on-disk-never-read` (the old violation). PURE.
 */
export function unprovableRecordBases({ findings = [], hasRecord = () => false, wasRead = () => false } = {}) {
  const { rows } = findUnreadRatedSources({ findings, hasRecord, wasRead });
  return rows.filter((r) => r.read !== true).map((r) => ({
    ordinal: r.ordinal, mark: r.mark, meter: r.meter, uri: r.uri,
    from: "verified-from-record", to: "inferred-from-signal",
    why: r.onDisk ? "record-on-disk-never-read" : "record-never-fetched",
  }));
}

/**
 * Apply the demotions to a parsed findings doc. Returns a NEW doc (the input is not mutated) and the
 * count actually applied — which can be lower than the demotion list only if the doc moved underneath,
 * so the caller records both and a divergence is visible rather than assumed.
 *
 * Matched on (ordinal, meter) — the ordinal is the findings contract's own join key, used by the card
 * render and the plan audit. Matching on the uri instead would demote every meter that happens to cite
 * the same record, including ones whose read IS logged.
 *
 * A meter that is ALREADY `inferred-from-signal` is not counted as applied, even if a caller names it.
 * `applied` is what the caller compares against its demotion list to decide whether an unprovable claim
 * is still standing, so a no-op that inflated it would hide exactly the shortfall that check exists to
 * catch. PURE.
 */
export function applyDerivedBases(doc, demotions = []) {
  const byOrdinal = new Map();
  for (const d of demotions) {
    if (d?.ordinal == null) continue;
    if (!byOrdinal.has(d.ordinal)) byOrdinal.set(d.ordinal, new Set());
    byOrdinal.get(d.ordinal).add(d.meter);
  }
  let applied = 0;
  const findings = (doc?.findings ?? []).map((f) => {
    const meters = byOrdinal.get(f?.ordinal);
    if (!meters || !f?.meters) return f;
    const next = { ...f, meters: { ...f.meters } };
    for (const name of meters) {
      const m = next.meters[name];
      if (!m || typeof m !== "object" || m.basis !== "verified-from-record") continue;
      next.meters[name] = { ...m, basis: "inferred-from-signal" };
      applied += 1;
    }
    return next;
  });
  return { doc: { ...doc, findings }, applied };
}

/** Parse _driver/reading-log.jsonl content into the set of lowercased canonical uris with an
 *  ok:true band_record row. Tolerant of torn lines (best-effort append log). PURE. */
export function readOkRecordUris(readingLogContent) {
  const out = new Set();
  for (const ln of String(readingLogContent ?? "").split("\n")) {
    if (!ln.trim()) continue;
    let row;
    try { row = JSON.parse(ln); } catch { continue; }
    if (row?.tool !== "band_record" || row?.ok !== true) continue;
    const canon = normalizeRecordUri(row?.args?.record_id);
    if (canon) out.add(lc(canon));
  }
  return out;
}
