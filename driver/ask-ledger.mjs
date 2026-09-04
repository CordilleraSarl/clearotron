// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ask-ledger.mjs — every question the run asks ITSELF ends: executed, judged immaterial with
// reasons, or loudly handed over.
//
// THE DEFECT THIS KILLS: an E2E run raised nine post-synthesis asks and every one converted to a
// silent deferral — not because the machinery lost them (the receipts existed) but because NOTHING
// joined the birth records to an ENDING. Some questions never even had a durable birth record
// (supplemental proposals rejected at the mint seam lived only in a tool response). This module is
// the deterministic JOIN over the run's ten ask birth-places, and nothing more: it re-reads the
// receipts the machinery already writes and computes, per ask, how it ended.
//
// SIBLING of doubt-ledger.mjs — deliberately NOT a merge. Doubts are PROSE questions joined to
// answers by quote-verified text matching; asks are MACHINE objects (directives, proposals, plan
// entries) joined to the plan-execution record by qid. What they share is the ending vocabulary,
// the audit surface ("# Questions the run asked itself" renders both ledgers side by side) and the
// ONE closure judgment (the doubt-closure stage takes both, under the same anti-confabulation
// guard). Merging the modules would force prose joins onto machine objects or vice versa.
//
// THE ENDING VOCABULARY (frozen):
//   executed          — the ask's queries ran. For a row carrying qids[] this is COMPUTED from the
//                       plan-execution receipt (joinPlanToBands' executed set) — never asserted, not
//                       even by the closure stage. A receipt may claim "swept"; the ledger re-checks.
//   judged-immaterial — a RECORDED reasoned judgment says the ask does not matter here (a skip
//                       reason, a mint-lint rejection, a closure-stage citation). Reasons required.
//   recovery          — the ask could not be closed and was LOUDLY handed over: a disclosed
//                       deferral riding a coverage row + clamp, an unresolved sidecar, a failure
//                       packet. The handoff field names the surface a human reads it on.
//   (no ending)       — OPEN. Goes ONCE to the doubt-closure stage (dictated ASK line-form below;
//                       IMMATERIAL always available — the terminating move); still-open ships
//                       VISIBLY OPEN in the audit with a handoff record. NEVER a delivery gate,
//                       never a count threshold, and no cost/token/time figure lives anywhere here.
//
// PURE by design (no node imports, no I/O, no clock — `ts` is injected). The pipeline call site
// owns every file read and writes _driver/asks.json at the audit seam, exactly like doubts.json.
// The ONE import below is intra-driver and to an equally pure module, so that still holds.
//
// ── WHY THE VERBATIM PREDICATE IS IMPORTED AND NOT COPIED ────────────────────────────────────────
//
// The header above already says these two ledgers judge "under the same anti-confabulation guard",
// and until now that was two identical copies of `squash` agreeing by luck. One artifact —
// doubt-closure.md — is parsed TWICE, by two parsers, into two ledgers, and both verify their
// citations against the SAME fileTexts. A divergence between the copies would settle a doubt and
// fail to end an ask on ONE seat's ONE citation, with nothing in either artifact recording that the
// two checks disagreed: it would read as the seat citing badly.
//
// SCOPED BY CONTRACT, NOT BY RESEMBLANCE. An expression-level census run before this change found
// `replace(/\s+/g, " ").trim()` 60 times across 35 non-test driver files — it is a generic
// string-tidying idiom, and a "one true normalizer" rule over it would be a false generalisation.
// `clip` just below is character-identical to doubt-ledger's and STAYS duplicated on that test: a
// divergence there changes how long a display string is, not whether something settles.
//
// `verify.mjs` holds the same expression for the OPPOSITE direction of trust — it checks the
// DRIVER's instructed values appear in the model's frame, where this checks the MODEL's quote
// appears in a driver-held file. Same expression, different question; it stays separate.
import { squash } from "./doubt-ledger.mjs";
//
// Ask record shape (frozen — _driver/asks.json and the audit's Ask Ledger both render it):
//   {
//     ask_id: "ask:<place-slug>:<stable ref>",
//     born:   { place, artifact, ref, ts },      // where the question was raised, mechanically
//     ask:    { text, owner, structured },       // structured = the machine object, carried verbatim
//     qids:   [ ... ],                           // the plan qids that would answer it (may be [])
//     ending: { kind, by, evidence, reasons, ts } | null,
//     handoff: "<the surface a human reads an un-ended/handed-over ask on>" | null,
//   }

const clip = (s, n = 200) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";

export const ASK_ENDINGS = ["executed", "judged-immaterial", "recovery"];

// ── the plan-execution join (the ONLY way an ask with qids becomes "executed") ────────────────────
/** {executed:Set<qid>, deferredReason:Map<qid,reason>} from the plan-execution receipt. PURE. */
export function planJoinFrom(planExecution) {
  // A MAP, not a Set — the value is what the slice RETURNED, and `Map` answers `.has` exactly
  // as the Set did, so every existing membership test is untouched.
  //
  // OLD RECEIPT vs FAILED COUNT IS A KEY-PRESENCE QUESTION, NOT A VALUE ONE. Before this array
  // held `{qid, state}` and NOTHING about the return; since `joinPlanToBands` always writes both
  // `records` and `total_hits`, either of which may legitimately be null. So a receipt carrying neither
  // KEY predates the instrument — "not recorded" — while one carrying the keys as null is a count the
  // provider could not take. Reading the VALUES alone collapses those two into one sentence, which is
  // the exact confusion exists to remove; `records: null` is indistinguishable from absent.
  // The first cut of this did read the values, and it reported every pre- receipt as a failed
  // count. Bare qid strings are tolerated too — no driver ever wrote them, so that arm proved nothing.
  const executed = new Map();
  for (const x of planExecution?.executed ?? []) {
    const qid = typeof x === "string" ? x : x?.qid;
    if (!qid) continue;
    const carriesReturn = Boolean(x) && typeof x === "object"
      && ("records" in x || "total_hits" in x);
    executed.set(qid, carriesReturn ? {
      records: Number.isFinite(x?.records) ? x.records : null,
      total_hits: Number.isFinite(x?.total_hits) ? x.total_hits : null,
    } : null);
  }
  const deferredReason = new Map((planExecution?.deferred ?? [])
    .map((x) => [x?.qid, String(x?.reason ?? "provider capability gap — deferred")]).filter(([q]) => q));
  return { executed, deferredReason };
}

/**
 * What a slice returned, in the reader's words — THREE-VALUED, and never a zero standing in for an
 * absence (register-plan.mjs's join records why). `null` records with a finite count means the provider
 * counted but the block carried no record list; both null means the receipt says nothing about the
 * return, which is what every pre- run looks like. PURE.
 */
export function returnedPhrase(info) {
  if (!info) return "what it returned was not recorded";
  const { records, total_hits: hits } = info;
  if (Number.isFinite(records)) {
    const n = `${records} record${records === 1 ? "" : "s"}`;
    return Number.isFinite(hits) && hits !== records ? `returned ${n} of ${hits} counted` : `returned ${n}`;
  }
  if (Number.isFinite(hits)) return `counted ${hits}, record list not carried`;
  return "ran, but the count could not be taken";
}

/**
 * — MAY AN EXECUTED RECALL PROBE DISCHARGE ON ITS OWN EXECUTION? Owner ruling 2026-08-19: "no".
 *
 * A recall ask discharges only when what came back is DEALT WITH. `kind:executed` alone discharges
 * nothing — and the failure it hid is the one this issue was filed on: a HIGH-graded live US
 * registration produced no doubt of any kind, because both its recall asks ended `executed` /
 * `handoff:null` the moment the plan-execution join reported that a query had RUN.
 *
 * THE LEGITIMATE CLOSE IS PRESERVED, and it is the whole reason this keys on the RETURN rather than on
 * execution: a probe that ran and found NOTHING has nothing to hand anyone, and closes exactly as it
 * does today. 's own build named that trap before this rule existed.
 *
 * THREE STATES, and only one of them discharges:
 *
 *   · `null` — a PRE- receipt, which carries no return keys at all. It closes as it always has.
 *     Refusing here would reopen every recall ask on every archived run, which is a rewrite of history
 *     rather than a rule about new ones. The key-presence discriminator in `planJoinFrom` is what makes
 *     this state distinguishable from "the count could not be taken", and it exists for this line.
 *   · `records: 0` with no positive count behind it — it ran, it came back empty. DISCHARGES.
 *   · anything else — records above zero, or zero records against a positive `total_hits` (the provider
 *     counted N and the block carried none of them), or a count that could not be taken at all. Does
 *     NOT discharge. "We asked and there are none" and "we could not tell" are different facts, and
 *     only the first one is an answer.
 *
 * PURE. Returns {discharges, why} — `why` is the reader's sentence for the handoff, never a token.
 */
export function recallDischargedByReturn(info) {
  if (!info) return { discharges: true, why: null };
  const { records, total_hits: hits } = info;
  if (records === 0 && !(Number.isFinite(hits) && hits > 0)) return { discharges: true, why: null };
  return { discharges: false, why: returnedPhrase(info) };
}

const mkEnding = (kind, by, { evidence = null, reasons = [], ts = null } = {}) =>
  ({ kind, by, evidence, reasons: (reasons ?? []).filter(Boolean).map((r) => clip(r, 300)), ts });

/** The computed ending for a row that owns qids[]: executed only when EVERY qid landed in the
 *  executed set; a capability-gap deferral is a recovery (the row is disclosed); otherwise null
 *  (open — a claimed sweep the execution record cannot confirm stays a question). PURE. */
function endingForQids(qids, join, ts) {
  if (!qids.length) return null;
  if (qids.every((q) => join.executed.has(q))) {
    // — the ending says what came back, not merely that something ran. This text renders into
    // audit.md, which survives in the delivered pool after `_driver/` is purged: the whole reason the
    // count is here rather than in the run log is that a run log cannot be read a week later.
    const returned = qids.map((q) => `${q} (${returnedPhrase(join.executed.get(q))})`).join(", ");
    return mkEnding("executed", "plan-execution-join", { evidence: `qid(s) executed per plan-execution receipt: ${returned}`, ts });
  }
  const def = qids.map((q) => join.deferredReason.get(q)).find(Boolean);
  if (def) return mkEnding("recovery", "plan-execution-join", { reasons: [def], evidence: `qid(s) deferred per plan-execution receipt: ${qids.join(", ")}`, ts });
  return null;
}

/** The {ending, handoff} pair for one cross-check directive. Only `recall` is subject to 's
 *  discharge rule; every other net keeps the ending it always had. PURE. */
function recallEnding(name, qid, join, ts) {
  const ending = endingForQids([qid], join, ts);
  if (name !== "recall" || ending?.kind !== "executed") return { ending, handoff: null };
  const { discharges, why } = recallDischargedByReturn(join.executed.get(qid));
  if (discharges) return { ending, handoff: null };
  return {
    ending: null,
    handoff: `the probe ran and ${why} — a recall probe discharges on what came back, not on having run (#1349). `
      + `Ships OPEN in the audit's ask ledger for the reviewing lawyer.`,
  };
}

// ── derive: the deterministic join over the ten birth-places ──────────────────────────────────────
/**
 * Derive the run's ask ledger. Every input is a PARSED artifact (the pipeline owns the reads);
 * every input is optional — an absent artifact simply contributes no rows (legacy/replay-safe).
 *
 * The ten birth-places and their substrates:
 *   1. intake-ask           _driver/intake-asks.json + the report's answer lines
 *   2. skeptic-escalation   _driver/escalation-state.json
 *   3. escalation-skip      run.jsonl `escalation-skipped` events
 *   4. envelope             run.jsonl `envelope-decision` / `envelope-closed` events (+ state.failed)
 *   5. screen-gate          run.jsonl `screen-gate-violation` events + the unresolved sidecar
 *   6. frame-diff           _driver/frame-reopen.json (requested/swept/deferrals + directive_qids)
 *   7. form-neighbourhood   same receipt, rows the receipt's `born` map marks form-oracle-injected
 *   8. supplemental-proposal register-units/<axis>-supplemental-plan.json entries[] + rejected[]
 *   9. cross-check          _driver/register-xcheck.json + _driver/register-recall.json (+ overflow)
 *  10. crowd-context        run.jsonl `crowd-context-skips` / `crowd-context-failed` events
 * PURE.
 */
export function deriveAsks({
  intakeAsks = null, reportMd = "",
  escalationState = null, events = null,
  frameReopen = null, screenGateUnresolved = null,
  supplementalPlans = null, xcheck = null, recall = null,
  planExecution = null,
} = {}, { ts = null } = {}) {
  const join = planJoinFrom(planExecution);
  const evs = Array.isArray(events) ? events.filter((e) => e && typeof e === "object") : [];
  const asks = [];
  const push = (row) => { if (!asks.some((a) => a.ask_id === row.ask_id)) asks.push(row); };

  // 1 ── intake asks: the requester's explicit checks. Executed = the delivered report carries the
  // dictated labelled answer line (majority-distinctive-word join, the intakeAskChecks convention —
  // deterministic containment, never fuzzy); an answer of "NOT executed/completed" is the run's own
  // recorded handover; no line at all stays OPEN for the closure stage.
  (Array.isArray(intakeAsks) ? intakeAsks : []).forEach((a, i) => {
    const line = answerLineFor(a?.ask, reportMd);
    let ending = null, handoff = null;
    if (line && /\bnot\s+(?:executed|completed)\b/i.test(line)) {
      ending = mkEnding("recovery", "report-answer-join", { evidence: clip(line), reasons: ["the report's own answer line records the ask as not executed this run"], ts });
      handoff = "the report's Answers-to-your-instructions line + the findings coverage[] open row carry it to the requester";
    } else if (line) {
      ending = mkEnding("executed", "report-answer-join", { evidence: clip(line), ts });
    }
    push({
      ask_id: `ask:intake:${i + 1}`,
      born: { place: "intake-ask", artifact: "_driver/intake-asks.json", ref: String(i + 1), ts: null },
      ask: { text: String(a?.ask ?? ""), owner: String(a?.owner ?? "synthesis"), structured: a ?? null },
      qids: [], ending, handoff,
    });
  });

  // 2 ── skeptic escalations: axes the skeptic flagged and the run attempted to re-run.
  const esc = escalationState ?? {};
  const escFailed = new Set((esc.failed ?? []).filter((x) => typeof x === "string"));
  for (const axis of (esc.requested ?? []).filter((x) => typeof x === "string" && !x.includes(":"))) {
    let ending = null, handoff = null;
    if ((esc.completed ?? []).includes(axis)) {
      ending = mkEnding("executed", "escalation-state", { evidence: `escalation-state.completed includes ${axis}`, ts });
    } else if (escFailed.has(axis)) {
      ending = mkEnding("recovery", "escalation-state", { reasons: [`the ${axis} escalation re-run failed mechanically`], evidence: `escalation-state.failed includes ${axis}`, ts });
      handoff = "escalation-state.failed — the machine-QC checks read it and record the failure on the audit workbook";
    }
    push({
      ask_id: `ask:escalation:${axis}`,
      born: { place: "skeptic-escalation", artifact: "_driver/escalation-state.json", ref: axis, ts: esc.ts ?? null },
      ask: { text: `the skeptic flagged a material unresolved gap on ${axis} — re-run the axis to defend/adjust`, owner: "register", structured: null },
      qids: [], ending, handoff,
    });
  }

  // 3 ── escalation skips: an ESCALATE flag the code gate declined — always with its recorded reason.
  for (const e of evs.filter((e) => e.event === "escalation-skipped" && e.axis)) {
    push({
      ask_id: `ask:escalation-skip:${slug(e.axis)}`,
      born: { place: "escalation-skip", artifact: "_driver/run.jsonl", ref: String(e.axis), ts: e.ts ?? null },
      ask: { text: `the skeptic flagged ${e.axis} but the escalation gate declined the re-run`, owner: "register", structured: null },
      qids: [],
      ending: mkEnding("judged-immaterial", "code-gate", { reasons: [String(e.reason ?? "gated")], evidence: `run.jsonl escalation-skipped: ${String(e.reason ?? "")}`, ts }),
      handoff: null,
    });
  }

  // 4 ── envelope: deferred coverage-floor obligations the deadline envelope decided over.
  {
    const decisions = evs.filter((e) => e.event === "envelope-decision");
    const last = decisions[decisions.length - 1] ?? null;
    const closedVerified = new Set(evs.filter((e) => e.event === "envelope-closed").flatMap((e) => e.axes ?? []));
    const closedUnverified = new Set(evs.filter((e) => e.event === "envelope-closed").flatMap((e) => e.unverified ?? []));
    for (const axis of [...new Set(decisions.flatMap((e) => e.deferredAxes ?? []))]) {
      let ending = null, handoff = null;
      if (closedVerified.has(axis)) {
        ending = mkEnding("executed", "envelope-close-verified", { evidence: `envelope-closed verified ${axis}: the breach/deferral is gone from the re-digested ledger`, ts });
      } else if (closedUnverified.has(axis)) {
        ending = mkEnding("recovery", "envelope-close-verified", { reasons: [`${axis} re-emitted but the floor did not close`], evidence: `envelope-closed lists ${axis} unverified`, ts });
        handoff = "computeOpenFloors → envelope_note front-matter — ships disclosed, never marked closed";
      } else if (escFailed.has(`envelope:${axis}`)) {
        ending = mkEnding("recovery", "escalation-state", { reasons: [`the ${axis} envelope close failed mechanically`], evidence: `escalation-state.failed includes envelope:${axis}`, ts });
        handoff = "escalation-state.failed + envelope_note — the client gate reads it";
      } else if (last && last.close === false) {
        ending = mkEnding("recovery", "envelope-decision", { reasons: [String(last.reason ?? "deadline does not permit the close")], evidence: "run.jsonl envelope-decision close:false", ts });
        handoff = "envelope_note front-matter + the open coverage rows — the report states the unclosed floor with its mechanical cause";
      }
      push({
        ask_id: `ask:envelope:${slug(axis)}`,
        born: { place: "envelope", artifact: "_driver/run.jsonl", ref: String(axis), ts: last?.ts ?? null },
        ask: { text: `deferred coverage-floor work on ${axis} — close it in-loop if the deadline permits`, owner: "register", structured: null },
        qids: [], ending, handoff,
      });
    }
  }

  // 5 ── screen-gate: every in-scope-live goods/field drop flagged as unexamined. The gate re-check
  // is code; a row absent from the unresolved sidecar was cleared BY that re-check (executed); a row
  // still in it ships as the disclosed-unexamined recovery the clamp carries.
  {
    const unresolved = Array.isArray(screenGateUnresolved) ? screenGateUnresolved : [];
    const stillOpen = new Set(unresolved.map((u) => u?.uri ?? u?.mark).filter(Boolean));
    const flagged = [...new Set(evs.filter((e) => e.event === "screen-gate-violation").flatMap((e) => e.uris ?? []).filter(Boolean))];
    for (const uri of flagged) {
      const u = unresolved.find((x) => (x?.uri ?? x?.mark) === uri);
      push({
        ask_id: `ask:screen-gate:${slug(uri)}`,
        born: { place: "screen-gate", artifact: "_driver/run.jsonl", ref: String(uri), ts: null },
        ask: { text: `re-examine the goods/field drop of ${uri} on its fetched official record`, owner: "register", structured: null },
        qids: [],
        ending: u
          ? mkEnding("recovery", "screen-gate", { reasons: [String(u.cause ?? "record not retrievable")], evidence: "_driver/screen-gate-unresolved.json", ts })
          : mkEnding("executed", "screen-gate-recheck", { evidence: `the driver code-fetch + gate re-check cleared ${uri} (absent from the unresolved sidecar)`, ts }),
        handoff: u ? "per-mark unexamined coverage row + the coverage-honesty CONDITIONAL clamp" : null,
      });
    }
    // an unresolved row the violation events never named by URI (an unnamed drop) still gets its row
    for (const u of unresolved) {
      const key = u?.uri ?? u?.mark;
      if (!key || flagged.includes(key)) continue;
      push({
        ask_id: `ask:screen-gate:${slug(key)}`,
        born: { place: "screen-gate", artifact: "_driver/screen-gate-unresolved.json", ref: String(key), ts: null },
        ask: { text: `re-examine the goods/field drop of ${u.mark ?? key} on its fetched official record`, owner: "register", structured: null },
        qids: [],
        ending: mkEnding("recovery", "screen-gate", { reasons: [String(u.cause ?? "record not retrievable")], evidence: "_driver/screen-gate-unresolved.json", ts }),
        handoff: "per-mark unexamined coverage row + the coverage-honesty CONDITIONAL clamp",
      });
    }
  }

  // 6/7 ── frame-diff directives (incl. the form-oracle injections — receipt.born marks those): the
  // reopen receipt records the partition (swept ∪ deferrals == requested), but "executed" is still
  // COMPUTED here for any directive whose minted qids the receipt recorded — a receipt claim of
  // "swept" that the plan-execution record cannot confirm stays OPEN, never a false close.
  {
    const fr = frameReopen ?? {};
    const requested = (fr.requested ?? []).filter((k) => typeof k === "string");
    const swept = new Set((fr.swept ?? []).filter((k) => typeof k === "string"));
    const deferrals = new Map((fr.deferrals ?? []).filter((d) => d?.directive).map((d) => [d.directive, d]));
    const qidsByKey = fr.directive_qids && typeof fr.directive_qids === "object" ? fr.directive_qids : {};
    const bornByKey = fr.born && typeof fr.born === "object" ? fr.born : {};
    for (const key of requested) {
      const qids = (Array.isArray(qidsByKey[key]) ? qidsByKey[key] : []).filter(Boolean);
      const place = bornByKey[key] === "form-neighbourhood" ? "form-neighbourhood" : "frame-diff";
      let ending = null, handoff = null;
      const d = deferrals.get(key);
      if (d) {
        ending = mkEnding("recovery", "frame-reopen", { reasons: [String(d.reason ?? "deferred")], evidence: "_driver/frame-reopen.json deferrals", ts });
        handoff = "open coverage row (frame-gap) + the CLEAR→CONDITIONAL clamp — the report states the unswept omission";
      } else if (swept.has(key)) {
        ending = qids.length
          ? endingForQids(qids, join, ts)   // computed — null (open) when the execution record disagrees
          : mkEnding("executed", "frame-reopen-receipt", { evidence: "swept per the frame-reopen receipt (warm-resume arm — axis-level verification)", ts });
      }
      push({
        ask_id: `ask:frame:${slug(key)}`,
        born: { place, artifact: "_driver/frame-reopen.json", ref: key, ts: fr.ts ?? null },
        ask: { text: `${place === "form-neighbourhood" ? "mechanical form-oracle gap" : "blind frame-diff omission"}: ${key} — sweep it or say why not`, owner: "register", structured: null },
        qids, ending, handoff,
      });
    }
  }

  // 8 ── supplemental proposals: every model/driver-proposed register query (the entries), plus the
  // rejected[] rows that used to evaporate in a tool response. A rejection that the model then fixed
  // and got minted is SUPERSEDED (its outcome lives on the minted row); any other rejection — cap or
  // shape — is a real unanswered question and ends OPEN, so the closure stage can settle it
  // IMMATERIAL with a citation, or it ships visibly.
  for (const sp of Array.isArray(supplementalPlans) ? supplementalPlans : []) {
    const axis = String(sp?.axis ?? "");
    // Review fix (2026-07-29): a per-call-cap rejection is often RE-PROPOSED in the very next tool
    // call and minted — the tool response says so and the model obliges. Left unjoined, the rejected
    // row rides to closure as a permanent false-open beside the minted row's EXECUTED — noise the
    // closure stage must rescue every run. So a cap-hit rejection is joined against the SAME axis's
    // minted entries on (predicate, term/terms, nice_classes, owner); a match is superseded by the
    // minted qid (that row carries the live computed ending). Per-AXIS cap rejections can never mint
    // later and correctly find no match — they stay OPEN.
    const mintedByIdentity = new Map();
    for (const e of sp?.entries ?? []) {
      const id = e?.qid ? proposalIdentity(e) : null;
      if (id && !mintedByIdentity.has(id)) mintedByIdentity.set(id, e.qid);
    }
    for (const e of sp?.entries ?? []) {
      if (!e?.qid) continue;
      push({
        ask_id: `ask:supplemental:${e.qid}`,
        born: { place: "supplemental-proposal", artifact: `register-units/${axis}-supplemental-plan.json`, ref: e.qid, ts: null },
        ask: { text: `proposed register query: ${e.predicate} ${clip(e.term ?? (e.terms ?? []).join(" | "), 80)} [cl ${(e.nice_classes ?? []).join(",")}]${e.owner ? ` owner:${clip(e.owner, 40)}` : ""}`, owner: "register", structured: e },
        qids: [e.qid],
        ending: endingForQids([e.qid], join, ts),
        handoff: null,
      });
    }
    // rejected[] is an append-only event log — a warm retry re-proposing the same invalid batch
    // appends identical rows. ONE ask per distinct question: dedupe on (issue, proposal) while
    // keeping the first row's position as the stable ref.
    const seenRejected = new Set();
    (sp?.rejected ?? []).forEach((r, i) => {
      const issue = String(r?.issue ?? "rejected");
      const sig = `${issue} ${JSON.stringify(r?.proposal ?? null)}`;
      if (seenRejected.has(sig)) return;
      seenRejected.add(sig);
      // P2-B (charter P2e — nothing dies silently, and nothing is buried that did not die). The
      // supersededBy join used to run for CAP rejections only, so a SHAPE rejection that the model
      // then fixed in-turn and got minted + executed still rendered as a standalone
      // "judged-immaterial by mint-lint" — a reviewing lawyer read a burial that never happened. The
      // in-turn rephrase loop is the mint seam's best property (rejected[] → re-propose → executed,
      // proven on the 2026-07-29 run and now the remedy the A5 script screen hands back); the ledger
      // must show it working. So EVERY rejection attempts the join, and one that did not mint later
      // ends OPEN — a real unanswered question the closure stage settles with a citation or that ships
      // visibly. "judged-immaterial" is reserved for a materiality judgment somebody actually made.
      const supersededBy = mintedByIdentity.get(proposalIdentity(r?.proposal)) ?? null;
      push({
        ask_id: `ask:supplemental-rejected:${slug(axis)}:${i + 1}`,
        born: { place: "supplemental-proposal", artifact: `register-units/${axis}-supplemental-plan.json`, ref: `rejected[${i}]`, ts: r?.ts ?? null },
        ask: { text: `proposed register query rejected at the mint seam: ${clip(proposalText(r?.proposal), 100)}`, owner: "register", structured: r ?? null },
        qids: [],
        // superseded ⇒ the question was really answered elsewhere; otherwise OPEN (ending null), cap
        // rejection or shape rejection alike — the row is an ask nobody closed.
        ending: supersededBy
          ? mkEnding("judged-immaterial", "mint-join", { reasons: [issue, `the identical proposal was re-proposed and minted — its outcome lives on ask:supplemental:${supersededBy}`], evidence: `superseded by minted qid ${supersededBy}`, ts })
          : null,
        handoff: null,
      });
    });
  }

  // 9 ── cross-checks: the common-law→register recovery nets (xcheck + recall) — directives carry
  // qids (computed executed); over-cap rows are real unanswered questions (OPEN → closure/lawyer).
  for (const [name, doc] of [["xcheck", xcheck], ["recall", recall]]) {
    for (const d of doc?.directives ?? []) {
      if (!d?.qid) continue;
      push({
        ask_id: `ask:${name}:${d.qid}`,
        born: { place: "cross-check", artifact: `_driver/register-${name}.json`, ref: d.qid, ts: doc?.ts ?? null },
        ask: { text: `${name === "recall" ? "prior-confirmed conflict recall probe" : "common-law signal cross-check"}: ${clip(d.mark_text ?? d.markText ?? d.owner ?? d.qid, 80)}`, owner: "register", structured: d },
        qids: [d.qid],
        // — a RECALL probe does not discharge on execution alone (ruled). `xcheck` is untouched:
        // this issue is loop 3, and widening it to a sibling net nobody measured would be a rule
        // invented rather than ruled. When the return does not discharge, the row ships OPEN with a
        // handoff that SAYS WHAT CAME BACK — finalizeOpenHandoffs only stamps its generic line on a row
        // that has none, so the specific reason survives to the reviewing lawyer instead of being
        // flattened into "ships OPEN".
        ...recallEnding(name, d.qid, join, ts),
      });
    }
    (doc?.overflow ?? []).forEach((o, i) => {
      push({
        ask_id: `ask:${name}-overflow:${i + 1}`,
        born: { place: "cross-check", artifact: `_driver/register-${name}.json`, ref: `overflow[${i}]`, ts: doc?.ts ?? null },
        ask: { text: `${name} probe over the cap — never dispatched: ${clip(o?.term ?? o?.qid ?? "", 80)}${o?.reason ? ` (${clip(o.reason, 80)})` : ""}`, owner: "register", structured: o },
        qids: [], ending: null, handoff: null,
      });
    });
    // — a probe REFUSED as an un-searchable term is the same kind of row as an over-cap one: a
    // real signal from the common-law sweep that no register query answered. It carries no qid (the
    // point is that it never entered the plan), so `ending: null` — an OPEN ask nobody closed. Without
    // this loop the refusal lives only in a sidecar and every surface that accounts for asks reports
    // nothing, which is an absence read as success — the exact shape the refusal exists to prevent.
    (doc?.refused ?? []).forEach((r, i) => {
      push({
        ask_id: `ask:${name}-refused:${i + 1}`,
        born: { place: "cross-check", artifact: `_driver/register-${name}.json`, ref: `refused[${i}]`, ts: doc?.ts ?? null },
        ask: { text: `${name} probe refused as an un-searchable term — never dispatched: ${clip(r?.mark_text ?? r?.markText ?? r?.owner ?? r?.qid ?? "", 80)}${r?.issue ? ` (${clip(r.issue, 120)})` : ""}`, owner: "register", structured: r },
        qids: [], ending: null, handoff: null,
      });
    });
  }

  // 10 ── crowd-context: slices the evidence pass skipped (with the honest reason) or the pass
  // failing outright (the run proceeds on the disclosed sufficient:false path — a handover).
  {
    const seen = new Set();
    for (const e of evs.filter((e) => e.event === "crowd-context-skips")) {
      for (const s of e.skipped ?? []) {
        const key = `${s?.axis ?? ""}:${s?.unit ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        push({
          ask_id: `ask:crowd-skip:${slug(key)}`,
          born: { place: "crowd-context", artifact: "_driver/run.jsonl", ref: key, ts: e.ts ?? null },
          ask: { text: `gather crowd-context evidence for ${s?.axis ?? "?"} / ${s?.unit || "(scope-less row)"}`, owner: "register", structured: s },
          qids: [],
          ending: mkEnding("judged-immaterial", "crowd-context-select", { reasons: [String(s?.reason ?? "not gatherable")], evidence: "run.jsonl crowd-context-skips", ts }),
          handoff: null,
        });
      }
    }
    const failed = evs.find((e) => e.event === "crowd-context-failed");
    if (failed) {
      push({
        ask_id: "ask:crowd-failed:1",
        born: { place: "crowd-context", artifact: "_driver/run.jsonl", ref: "crowd-context-failed", ts: failed.ts ?? null },
        ask: { text: "gather the crowded-field evidence pass (per-term counts + enumerated exact subset)", owner: "register", structured: null },
        qids: [],
        ending: mkEnding("recovery", "crowd-context", { reasons: [String(failed.fail ?? "evidence pass failed")], evidence: "run.jsonl crowd-context-failed", ts }),
        handoff: "synthesis proceeds without the evidence artifact — the material-slice ⇒ sufficient:false path stands",
      });
    }
  }

  return asks;
}

/** Identity key joining a rejected compact proposal to a minted plan entry: (predicate, term/terms,
 *  nice_classes, owner) — the same fields the mint fingerprints. term and terms:[term] are the same
 *  QUESTION even though they mint different qids; classes/terms/owner are normalized the way the mint
 *  normalizes them. Null when the row carries no terms at all (nothing to match). PURE. */
export function proposalIdentity(p) {
  if (!p || typeof p !== "object") return null;
  const terms = Array.isArray(p.terms)
    ? p.terms.map((t) => String(t ?? "").trim()).filter(Boolean)
    : (typeof p.term === "string" && p.term.trim() ? [p.term.trim()] : []);
  if (!terms.length) return null;
  const nice = (Array.isArray(p.nice_classes) ? p.nice_classes : []).map((c) => String(c).trim()).filter(Boolean);
  const owner = typeof p.owner === "string" ? p.owner.trim() : "";
  return JSON.stringify([String(p.predicate ?? "default"), terms, nice, owner]);
}

/** Compact display text for a persisted rejected-proposal row. PURE. */
function proposalText(p) {
  if (!p || typeof p !== "object") return "(proposal not recorded)";
  const term = p.term ?? (Array.isArray(p.terms) ? p.terms.join(" | ") : "");
  return `${p.predicate ?? "?"} ${term}${p.owner ? ` owner:${p.owner}` : ""} [cl ${(p.nice_classes ?? []).join(",")}]`;
}

// ── the intake-ask answer join (the intakeAskChecks convention: majority distinctive words) ───────
const normWords = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The report's labelled "- You asked us to check X → …" line answering `ask`, or null. Deterministic
 *  majority-word containment (≥60% of the ask's distinctive words, same floor as intakeAskChecks) —
 *  never fuzzy. PURE. */
export function answerLineFor(ask, reportMd) {
  const ws = normWords(ask).split(" ").filter((w) => w.length >= 4).slice(0, 5);
  if (!ws.length) return null;
  const need = Math.max(1, Math.ceil(ws.length * 0.6));
  let best = null, bestN = 0;
  for (const raw of String(reportMd ?? "").split("\n")) {
    const line = raw.trim();
    if (!/^[-*]\s*You asked us to check/i.test(line)) continue;
    const hay = ` ${normWords(line)} `;
    const n = ws.filter((w) => hay.includes(` ${w} `)).length;
    if (n > bestN) { best = line; bestN = n; }
  }
  return bestN >= need ? best : null;
}

// ── the closure-stage ASK line-form (settle-by-citation, shared judgment with doubts) ─────────────
// The stage may end an open ask ONLY as judged-immaterial, and only by POINTING: one dictated line
// citing a verbatim quote from a citable file, re-verified by code (the doubt-ledger applyClosure
// guard, reused shape-for-shape). It can NEVER assert "executed" — execution is computed from the
// plan-execution record and is not the model's to claim. An OPEN line records the model's one-line
// recovery recommendation into the ask's handoff (visible in the audit), and changes nothing else.
//
//   IMMATERIAL <ask_id>: <file>: "<verbatim quote ≤200 chars>" — <one-line reason it is immaterial>
//   OPEN <ask_id>: <one-line what a human should do with it>
const IMMATERIAL_LINE_RE = /^(?:[-*]\s+)?IMMATERIAL\s+(\S+):\s*(\S+?):\s*"(.{1,300}?)"\s*—\s*(.+?)\s*$/;
const ASK_OPEN_LINE_RE = /^(?:[-*]\s+)?OPEN\s+(\S+):\s*(.+?)\s*$/;

/** Parse the stage's dictated ASK lines → [{verdict, id, file?, quote?, reason}]. Strict on purpose
 *  (a malformed line is ABSENT — its ask stays open); doubt SETTLED/OPEN lines for doubt ids simply
 *  never match an ask id and no-op in applyAskClosure. PURE. */
export function parseAskClosureLines(text) {
  const out = [];
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    let m = line.match(IMMATERIAL_LINE_RE);
    if (m) { out.push({ verdict: "IMMATERIAL", id: m[1], file: m[2], quote: m[3], reason: m[4] }); continue; }
    m = line.match(ASK_OPEN_LINE_RE);
    if (m) out.push({ verdict: "OPEN", id: m[1], reason: m[2] });
  }
  return out;
}

/**
 * The anti-confabulation guard, ask side (doubt-ledger applyClosure reused shape-for-shape): an
 * IMMATERIAL line ends its ask IFF the ask is still open AND the quote appears VERBATIM
 * (whitespace-normalized, nothing else) in the named citable file; anything short of that leaves
 * the ask OPEN and lands in `unverified` (LOUD — the call site logs each one). An OPEN line only
 * records the model's recovery recommendation into the ask's handoff. Returns
 * { asks, immaterialByStage, unverified }; never mutates its input. PURE.
 */
export function applyAskClosure(asks, closureLines, fileTexts = {}, { ts = null } = {}) {
  const byId = new Map();
  for (const l of closureLines ?? []) if (l?.id && !byId.has(l.id)) byId.set(l.id, l);
  const unverified = [];
  let immaterialByStage = 0;
  const out = (asks ?? []).map((a) => {
    if (a?.ending) return a;                                    // the stage may never touch an ended ask
    const l = byId.get(a.ask_id);
    if (!l) return a;
    if (l.verdict === "OPEN") return { ...a, handoff: clip(l.reason, 300) || a.handoff };
    const hay = squash(fileTexts?.[l.file]);
    const q = squash(l.quote);
    if (q && hay && hay.includes(q)) {
      immaterialByStage++;
      return { ...a, ending: mkEnding("judged-immaterial", "doubt-closure-stage", { evidence: `${l.file}: "${clip(l.quote)}"`, reasons: [l.reason], ts }) };
    }
    unverified.push({ ask_id: a.ask_id, file: l.file, quote: l.quote });
    return a;
  });
  return { asks: out, immaterialByStage, unverified };
}

/** Stamp the default handoff on every still-open ask (after closure) — an OPEN ask always names
 *  where a human meets it. Returns a NEW array. PURE. */
export function finalizeOpenHandoffs(asks) {
  return (asks ?? []).map((a) => (!a?.ending && !a?.handoff)
    ? { ...a, handoff: "ships OPEN in the audit's ask ledger — for the reviewing lawyer" }
    : a);
}

/** {total, executed, immaterial, recovery, open} — the asks.json header counts. PURE. */
export function summarizeAsks(asks) {
  const s = { total: 0, executed: 0, immaterial: 0, recovery: 0, open: 0 };
  for (const a of asks ?? []) {
    s.total++;
    if (!a?.ending) s.open++;
    else if (a.ending.kind === "executed") s.executed++;
    else if (a.ending.kind === "judged-immaterial") s.immaterial++;
    else s.recovery++;
  }
  return s;
}
