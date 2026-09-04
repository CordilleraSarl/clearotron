// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jx.mjs — the Stage-1.5 jx orchestration (Phase 2b slice 1): the frozen lane decision, the
// candidate-generation executor chain, and the register-plan fold. Called from ONE never-kill block
// in pipelineInner (after attachRegisterPlan, before decideAxes) — everything here degrades and
// logs; only the pipeline's own plan-write is load-bearing.
//
// The fold contract (the recall-probes pattern, verbatim): deterministic qids ⇒ resume-idempotent;
// capped with logged overflow; run-local plan write only (NEVER the slug store); receipt sidecar
// `_driver/jx-lanes.json`; per-call ledger `_driver/jx-completions.jsonl` (tokens/counts only — the
// owner rule: no currency anywhere). Candidates ride the EXISTING transliteration-numeric axis, so
// the unit spawn (axis-from-plan), coverage skeleton, taint chain and clean gates all inherit with
// zero new wiring. What they carry is the ROMANISATION, not the characters — see jxPlanEntries.
import { readFileSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { decideJxLanes, candidateRefusal, canonicalTerm, romanizationSpellings, LANGUAGE_LANES, jxBillingStamp } from "./jx-lanes.mjs";
import { cnipaSubgroupsForClasses, cnipaEditionLabel } from "./jx-subclass.mjs";   // — replaces the hand-written seed table
import { kebab } from "./search-policy.mjs";
import { JX_PROVIDERS } from "./driver.config.mjs";
import { foldSupplementalEntries, validatePlanFeasibility } from "./register-plan.mjs";

export const JX_CANDIDATE_CAP = 8;   // per lane — a register query costs real money; depth is not volume

// The candidate → qid key. NOT kebab(): kebab strips every non-[a-z0-9] char, so ALL Han-script
// candidates would collapse to one key and dedup would silently eat the lane (caught by jx-units).
// NFC-canonical first (an NFC/NFD pair must be ONE key — review 2026-07-18); Unicode letters/numbers
// survive; whitespace/punctuation collapse — same-collision semantics, any script.
export const jxKey = (s) => canonicalTerm(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "cand";
export const MAX_LANE_ATTEMPTS = 3;   // degraded-lane retries across resumes (repairable, never terminal)

/**
 * THE ONLY WAY a `fold.lanes[<lane>]` record is built. `degraded` states WHETHER as a boolean on
 * every record; the cause rides its own `degradedCause` field. Before this, the failure path wrote the
 * cause string INTO `degraded` and the two healthy paths wrote no field at all — so the scorer's
 * `typeof === "boolean"` read reported "(not stated)" on a healthy lane AND on a degraded one, and the
 * reader could not tell a lane that ran cleanly from one that never ran.
 *
 * An ABSENT record still says nothing: the early returns in runJxCandidateFold write no lane record at
 * all, and those lanes must keep reading "(not stated)". This factory only governs records that ARE
 * written — it never manufactures one.
 */
export const jxFoldLaneRecord = ({ cause = null, ...rest } = {}) => ({
  degraded: cause != null,
  degradedCause: cause == null ? null : String(cause).slice(0, 200),
  ...rest,
});

// ── — THE RUN STATES WHICH jx SLICES IT EXECUTED ──────────────────────────────────────────────
//
// R6 asserts `_driver/jx-lanes.json:fold.executes` exists, and until this block NOTHING wrote it: a
// non-truncated grep over driver/, scripts/ and providers/ found exactly one `executes` assignment in
// the engine, jx-lanes.mjs's PER-LANE policy field, frozen at mint — deleted by, since a value
// frozen before any slice runs cannot state what ran, and always reading "candidates" made the source
// assert that slices 2–3 below do not exist. So a delivered Full country run
// could not say from its own record whether "deep China" ran or degraded to slice-1 behaviour. On the
// 2026-08-09 R6 the SERP grid was 49/49 cells gapped on an exhausted quota — loud in the units record,
// silent in the fold. One record spoke and the other could not.
//
// TWO FIELDS, BECAUSE ONE CANNOT CARRY BOTH JOBS.
//   `executes` is a SCALAR STRING, because reference-score.mjs:1103 routes it into the same slot as the
//   per-lane `executes` string and scripts/score.mjs interpolates it bare — an object prints
//   [object Object] there. It names the slices that RAN, "+"-joined, and is NEVER "" (the e2e `exists`
//   op passes on an empty string, so an all-failed run would have gone green on a statement of nothing).
//   When no slice ran it is the literal "none".
//   `slices` carries the three-valued truth the issue asks for, keyed by slice name — dash-safe and
//   colon-free so `fold.slices.serp-grid.state` stays addressable by the e2e path grammar.
//
// FIVE STATES, NOT THREE, AND THE TWO EXTRA ONES ARE THE HONEST ONES.
//   ran             a durable record says it completed        (units[k].done === true / lane not degraded)
//   gapped          a durable record says it degraded         (carries degradedCause and attempts)
//   not-armed       the env switch that gates it is off
//   refused         armed, no durable record, and a captured cause says why it declined structurally
//   not-established none of the above settles it — an absence, stated as one, never defaulted to a pass
//
// `refused` has to stay distinct from `not-armed` or the record lies about the switch: pipeline.mjs
// gated the nativeread block on one arm while the unit refused on another, so a skip event could exist
// for a slice that was never armed. item 8 deleted every one of those arms and the divergence with
// them. Arming is still read from the ENV — CLEAROTRON_NATIVE_LANGUAGE_<code>, the one switch that survives — never from
// the presence of an event; the event supplies the `why` and nothing else.
export const JX_SLICES = [
  { name: "candidates", slice: 1, unit: null },
  { name: "serp-grid", slice: 2, unit: "serp-grid:zh", lane: "zh" },
  { name: "nativeread", slice: 3, unit: "nativeread:zh", lane: "zh" },
];

import { laneArmed } from "./driver.config.mjs";

/**
 * Derive the run's slice statement from durable state. PURE — no clock, no fs; `sidecar` is the parsed
 * jx-lanes.json, `units` the parsed _driver/jx/units.json (or null), `causes` a {sliceName: string} map
 * of skip reasons lifted from run.jsonl for DECORATION only.
 */
export function deriveJxSliceStatement({ sidecar, units = null, env = process.env, causes = {} } = {}) {
  const unitRows = (units && typeof units === "object" ? units.units : null) ?? {};
  const declaredLanes = Object.keys(sidecar?.lanes ?? {});
  const foldLanes = sidecar?.fold?.lanes ?? {};
  const slices = {};
  for (const s of JX_SLICES) {
    if (s.slice === 1) {
      // Slice 1 is the only multi-lane slice, so it rolls up — and it never overstates: EVERY armed lane
      // must be present and healthy for "ran". One gapped lane makes the whole slice gapped.
      const lanes = {};
      for (const l of declaredLanes) {
        // — laneArmed, NOT envOn: envOn is the default-OFF opt-in reader, and reading a
        // fail-open lane switch through it made every unset lane read "not-armed" on a run where
        // the executor had armed it and dispatched.
        if (!laneArmed(l, env)) { lanes[l] = "not-armed"; continue; }
        const rec = foldLanes[l];
        lanes[l] = rec == null ? "not-established" : rec.degraded === true ? "gapped" : "ran";
      }
      const live = Object.values(lanes).filter((v) => v !== "not-armed");
      const state = !declaredLanes.length ? "not-established"
        : !live.length ? "not-armed"
        : live.includes("not-established") ? "not-established"
        : live.includes("gapped") ? "gapped" : "ran";
      const gapped = Object.entries(lanes).filter(([, v]) => v === "gapped").map(([l]) => l);
      slices[s.name] = { slice: 1, state, lanes, basis: "_driver/jx-lanes.json:fold.lanes",
        why: state === "ran" ? `every armed lane (${live.length}) carries a fold record stating degraded:false`
          : state === "not-armed" ? "no lane is armed in this run's own environment"
          : state === "gapped" ? `lane(s) ${gapped.join(", ")} degraded — see fold.lanes[].degradedCause`
          : "an armed lane carries no fold record at all — the receipt was never written" };
      continue;
    }
    // item 8 — the per-slice CLEAROTRON_JX_* arms are gone, so "armed" is now the ONE condition that
    // survives: the lane not killed. 's warning still applies to how it is read — laneArmed is the
    // fail-open reader, and reading it through the old default-OFF `envOn` made every unset lane report
    // not-armed on a run that had dispatched.
    const armed = laneArmed(s.lane, env);
    const rec = unitRows[s.unit];
    const base = { slice: s.slice, lane: s.lane, unit: s.unit };
    if (!armed) {
      slices[s.name] = { ...base, state: "not-armed", basis: `env CLEAROTRON_NATIVE_LANGUAGE_${String(s.lane).toUpperCase()}`,
        why: `CLEAROTRON_NATIVE_LANGUAGE_${String(s.lane).toUpperCase()} off in this run's own environment when the statement was minted — the lane was killed, not merely idle` };
    } else if (rec && rec.degraded === true) {
      slices[s.name] = { ...base, state: "gapped", attempts: rec.attempts ?? null,
        basis: `_driver/jx/units.json:units["${s.unit}"]`, why: String(rec.degradedCause ?? "degraded, cause not recorded").slice(0, 300) };
    } else if (rec && rec.done === true) {
      slices[s.name] = { ...base, state: "ran", basis: `_driver/jx/units.json:units["${s.unit}"]`,
        why: "the unit record states done:true with degraded:false" };
    } else if (causes[s.name]) {
      slices[s.name] = { ...base, state: "refused", basis: "run.jsonl skip event",
        why: String(causes[s.name]).slice(0, 300) };
    } else {
      slices[s.name] = { ...base, state: "not-established", basis: `_driver/jx/units.json:units["${s.unit}"]`,
        why: "armed, but no unit record and no recorded cause — whether it ran CANNOT be established from this run" };
    }
  }
  const ran = JX_SLICES.filter((s) => slices[s.name].state === "ran").map((s) => s.name);
  return { executes: ran.length ? ran.join("+") : "none", slices };
}

// ── — WHAT THE LANE ASKED FOR vs WHAT IT GOT, AND THE FLAG WHEN THEY DIFFER ────────────────────
//
// FOURTH INSTANCE OF ONE SEAM, and the last field still printed. `lanes.<lane>.depth` in
// `_driver/jx-lanes.json` is frozen at mint from `jxPolicy.laneDepth`; it records what the customer's
// config ASKED FOR and nothing reads it to gate a slice. deleted the `degraded` fallback that read
// the declaration, stopped folding the run-level statement into the per-lane slot, deleted the
// frozen `executes` — each time a mint-time declaration was being read as an execution record. `depth`
// is the remaining instance, and `scripts/score.mjs` printed it bare in an execution row:
//
//     lane zh: executes=candidates+serp-grid  depth=full  degraded=false  accepted=4
//
// A reader concludes the deep lane ran. It does not follow: a profile set to `full` on an unarmed
// deployment and one set to `candidates` on an armed deployment execute identically.
//
// OWNER RULING (2026-08-17): flag, do not gate. "If we can't run deep dive on serpAPI we need to flag
// it." So `depth` is not deleted and it does not start gating anything — the run derives what the lane
// ACTUALLY got from the same durable record `executes` already comes from, and says so beside the ask.
// Gating would change what a run executes and therefore what it bills; a flag changes only what the
// record admits.
//
// ── TWO SHORTFALL CAUSES, AND COLLAPSING THEM WOULD BE THE FALSE GENERALISATION ────────────────────
//
// The deep slices are zh-ONLY by construction: JX_SLICES pins `lane: "zh"` on both slice 2 and slice 3,
// and SERP_LANES has a single row. So `laneDepth.ja = "full"` asks for something THIS BUILD DOES NOT
// HAVE, which no environment can arm; `laneDepth.zh = "full"` on a box with CLEAROTRON_NATIVE_LANGUAGE_ZH off
// asks for something the build has and the deployment did not turn on. Same printed shortfall, opposite
// remedies — one is "buy/build the slice", the other is "arm the switch" — so they are separate causes
// and never one token.
//
// ZERO IS NOT A PASS, in the shape this file already uses everywhere else: a lane whose slices settle to
// nothing readable reports `ran: null` and the flag still fires. "Could not establish that full ran" is
// not "candidates ran", and reporting the second from the first would be the original defect wearing a
// new field name.
//
// PURE. Takes the parsed sidecar and the slice statement `deriveJxSliceStatement` just produced.
export function deriveLaneDepthVerdicts({ sidecar, slices } = {}) {
  const declared = sidecar?.lanes ?? {};
  const out = {};
  for (const lane of Object.keys(declared)) {
    const asked = typeof declared[lane]?.depth === "string" ? declared[lane].depth : null;
    // The deep slices THIS BUILD carries for THIS lane. Read off JX_SLICES rather than named here, so a
    // lane that gains a slice later is covered without this function being edited — and so a lane that
    // has none is a measured fact rather than a hardcoded assumption about ja/ko.
    const deep = JX_SLICES.filter((s) => s.slice > 1 && s.lane === lane);
    const deepStates = deep.map((s) => ({ name: s.name, state: slices?.[s.name]?.state ?? null, why: slices?.[s.name]?.why ?? null }));
    const deepRan = deepStates.filter((d) => d.state === "ran").map((d) => d.name);
    // Slice 1 is the multi-lane one: its per-lane state lives in `.lanes`, never in a scalar `.state`.
    const candidatesState = slices?.candidates?.lanes?.[lane] ?? null;

    const ran = deepRan.length ? "full" : candidatesState === "ran" ? "candidates" : null;
    const shortfall = asked === "full" && ran !== "full";
    let cause = null, why = null;
    if (shortfall) {
      if (!deep.length) {
        cause = "not-built-for-lane";
        why = `this build carries no deep slice for the ${lane} lane — the SERP grid and native read are zh-only `
          + `(JX_SLICES, SERP_LANES), so \`full\` cannot be delivered here by any environment. The lane ran as a `
          + `slice-1 candidate lane, which is what it ships as.`;
      } else if (ran === null) {
        cause = "not-established";
        why = `the deep slice(s) ${deepStates.map((d) => `${d.name}=${d.state ?? "no record"}`).join(", ")} did not state that they ran, `
          + `and slice 1 for this lane is ${candidatesState ?? "unrecorded"} — what this lane delivered CANNOT be established from `
          + `this run's own record. Not reported as candidates: that would be a claim no artifact supports.`;
      } else {
        cause = "requested-full-ran-candidates";
        why = `asked for full and ran candidates only — ${deepStates.map((d) => `${d.name} ${d.state ?? "no record"}`).join(", ")}`
          + `${deepStates.some((d) => d.state === "not-armed") ? " (an env arm is off on this deployment, not a fault in the run)" : ""}`;
      }
    }
    out[lane] = { asked, ran, shortfall, cause, why,
      basis: "_driver/jx-lanes.json:lanes[].depth (asked) vs fold.slices (ran)" };
  }
  return out;
}

const flag = (name) => ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").trim().toLowerCase());
// — the private copy is gone; laneArmed (driver.config.mjs) is the one reader.

// ── The frozen lane decision: minted once (cold), read verbatim forever (a resume NEVER re-decides —
// the freezeProfile doctrine). Plain-prelim runs never reach this (the caller gates on the component).
export function attachJxLanes(ctx) {
  const sidecarPath = driverDir(ctx.run.runDir, "jx-lanes.json");
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — cold start */ }
  if (raw != null) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`_driver/jx-lanes.json is corrupt (${e.message}) — investigate; the frozen lane decision is never silently re-derived`); }
    ctx.jxLanes = parsed;
    return { minted: false };
  }
  const decision = decideJxLanes({ job: ctx.job, profile: ctx.profile, searchPolicy: ctx.searchPolicy });
  // — the edition is the DATABASE's, read from its provenance row, so the sidecar cannot claim an
  // edition the lookup did not answer from. Null when the database is unreachable, which is an absence
  // and reads as one rather than as a stale label.
  const sidecar = { schema: 1, ...decision, cnipaEdition: cnipaEditionLabel(), frozenAt: new Date().toISOString() };
  writeFileSync(`${sidecarPath}.tmp`, JSON.stringify(sidecar, null, 2) + "\n");
  renameSync(`${sidecarPath}.tmp`, sidecarPath);
  ctx.jxLanes = sidecar;
  return { minted: true };
}

// ── Executor chain (the knockout resolveSweepExecutor idiom): injected (tests) → CLEAROTRON_JX_FIXTURES
// (the $0 dev seam: <mark-kebab>.<lane>.json {candidates:[…]}) → the live JX_PROVIDERS completions.
export function resolveJxExecutor(opts) {
  if (typeof opts?.jxExecutor === "function") return { exec: opts.jxExecutor, source: "injected" };
  const fixDir = process.env.CLEAROTRON_JX_FIXTURES;
  if (fixDir) {
    return {
      source: `fixtures:${fixDir}`,
      exec: async ({ mark, lane }) => {
        try {
          const raw = readFileSync(join(fixDir, `${kebab(mark)}.${lane}.json`), "utf8");
          const parsed = JSON.parse(raw);
          return { ok: true, candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [], tookMs: 0 };
        } catch (e) { return { ok: false, cause: `fixture missing/corrupt for ${kebab(mark)}.${lane}: ${String(e.message).slice(0, 120)}` }; }
      },
    };
  }
  return { source: "engine", exec: (args) => JX_PROVIDERS.completions.generate(args) };
}

/** Pure: candidates → validated plan entries for the lane. Refusals are RETURNED (the caller logs
 *  them into the receipt), never thrown; qids are deterministic (`jx-<lane>-<jxKey(term)>`, NFC-canonical).
 *  `existingEntries` (the CURRENT frozen plan) seeds both dedup dimensions AND the cap: a candidate
 *  whose term the compiled plan already enumerates is a refusal (never a second paid query on the
 *  same term), and prior jx entries count against the per-plan cap (a crash-window re-fold can never
 *  double past it — review 2026-07-18). */
export function jxPlanEntries({ lane, laneDecision, candidates, inScopeClasses, existingEntries = [] }) {
  const entries = [], accepted = [], refused = [];
  const seen = new Set();
  const planTerms = new Set();
  let priorLaneCount = 0;
  for (const e of existingEntries) {
    if (typeof e?.qid === "string" && e.qid.startsWith(`jx-${lane}-`)) { seen.add(e.qid); priorLaneCount++; }
    const terms = Array.isArray(e?.terms) ? e.terms : e?.term != null ? [e.term] : [];
    for (const t of terms) planTerms.add(jxKey(t));
  }
  for (const cand of candidates ?? []) {
    const refusal = candidateRefusal(lane, cand);
    if (refusal) { refused.push({ term: String(cand?.term ?? "").slice(0, 60), reason: refusal }); continue; }
    const term = canonicalTerm(cand.term);
    const key = jxKey(term);
    const qid = `jx-${lane}-${key}`;
    if (seen.has(qid)) { refused.push({ term, reason: "duplicate research key (batch or prior fold)" }); continue; }
    if (planTerms.has(key)) { refused.push({ term, reason: "the compiled plan already enumerates this term" }); continue; }
    seen.add(qid);
    if (priorLaneCount + accepted.length >= JX_CANDIDATE_CAP) { refused.push({ term, reason: `over the ${JX_CANDIDATE_CAP}-candidate cap (per plan, prior folds included)` }); continue; }
    // THE ENTRY CARRIES BOTH FORMS, because the two register providers index non-Latin marks in
    // OPPOSITE ways and the plan is provider-neutral — it states the question, the provider expresses
    // it (probed 2026-07-29, live, on both):
    //
    //                       小米        华威豹      스타벅스
    //     corsearch          553          6          15      ← a real native-script index
    //     clarivate            0          0           0      ← indexes the TRANSLITERATION only
    //     clarivate (roman) 57632         32          18      ← HUA WEI BAO returns 华威豹 itself
    //
    // So the native term stays the searched term and `exact` stays the predicate — that is what
    // corsearch answers correctly today, and widening it there is not free: on corsearch `default`
    // takes 小米 from 553 to 127414, past its own 5000-result ceiling, turning a usable slice into an
    // unusable crowd. `romanizedTerms` rides alongside for the provider that needs it; clarivate
    // substitutes it (and relaxes the predicate, because `exact` on a transliteration is a silent
    // zero) in its own buildEntryQuery, where the reason lives. A provider that ignores the field
    // keeps exactly its current behaviour.
    entries.push({ qid, axis: "transliteration-numeric", predicate: "exact", term,
      romanizedTerms: romanizationSpellings(cand.romanization),
      nice_classes: inScopeClasses, regions: laneDecision.jurisdictions, expected_kind: "enumerate" });
    accepted.push({ qid, term, romanization: cand.romanization, kind: cand.kind,
      rationale: String(cand.rationale ?? "").slice(0, 300) });
  }
  return { entries, accepted, refused };
}

/**
 * The whole slice, one never-kill call from pipelineInner. Requires ctx.registerPlan + the jxLanes
 * component on the frozen policy (the caller checks the component; this checks env + lanes + resume
 * state). Returns { folded, cause? } for the pipeline's log line — it NEVER throws.
 */
/**
 * Mint the run's slice statement onto `_driver/jx-lanes.json`. Called LATE — at delivery, after slice 3
 * — because a writer inside runJxCandidateFold can only ever say "candidates": the fold runs before both
 * retrieval slices. Never-kill, idempotent, resume-safe.
 *
 * READS THE SIDECAR FROM DISK, never ctx.jxLanes — the same reason injectScriptScopeCoverage gives: at
 * delivery on a resume the fold block may never have re-attached it. Deriving from durable state alone
 * (units.json + the frozen sidecar + env) makes this a pure function of the disk, callable from any late
 * point without having to prove every resume path traverses the jx blocks.
 *
 * NEVER re-derives `lanes` or `scope`: attachJxLanes freezes those and throws on a corrupt sidecar, so an
 * unreadable one here NOTES AND RETURNS WITHOUT WRITING rather than minting a second opinion.
 */
export function stateJxSlices(runDir, { env = process.env, note = () => {}, runLog = () => {} } = {}) {
  try {
    const sidecarPath = driverDir(runDir, "jx-lanes.json");
    // ABSENT AND UNPARSEABLE ARE NOT THE SAME FACT, and the first cut printed one sentence for both.
    // A run with no jx lane has no sidecar, and that is normal — saying "NOT writing one" there reads as
    // a withheld action. A sidecar that EXISTS and does not parse is a real defect in a driver-written
    // frozen decision, and it stays loud. Neither writes.
    let raw = null;
    try { raw = readFileSync(sidecarPath, "utf8"); }
    catch { return { stated: false, reason: "no-jx-lane" }; }   // no lane on this run — nothing to state
    let sidecar = null;
    try { sidecar = JSON.parse(raw); }
    catch (e) { note(`jx slice statement: _driver/jx-lanes.json EXISTS and does not parse (${String(e?.message ?? e).slice(0, 80)}) — NOT writing one; the lane decision is frozen and is not this writer's to re-derive`); return { stated: false, reason: "unparseable" }; }
    let units = null;
    try { units = JSON.parse(readFileSync(driverDir(runDir, "jx", "units.json"), "utf8")); } catch { /* no retrieval slices ran — absence is read below, never as a pass */ }
    const causes = {};
    try {
      for (const line of readFileSync(driverDir(runDir, "run.jsonl"), "utf8").split("\n")) {
        if (!line.includes("-skipped")) continue;
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (row?.event === "jx-serp-grid-skipped" && row.cause) causes["serp-grid"] = row.cause;
        if (row?.event === "jx-nativeread-skipped" && row.cause) causes.nativeread = row.cause;
      }
    } catch { /* decoration only — a missing journal changes no STATE, only a `why` */ }
    const { executes, slices } = deriveJxSliceStatement({ sidecar, units, env, causes });
    // — the per-lane ask-vs-got verdict, minted HERE and not at the scorer, for the reason the whole
    // seam exists: a reader that derives it on the fly can only speak for the box it is run on, and the
    // arms are environment. Stated at delivery, from this run's own env, it becomes a fact of the run.
    const depth = deriveLaneDepthVerdicts({ sidecar, slices });
    // Idempotent: a delivered-then-resumed run leaves the artifact byte-identical rather than restamping.
    // `depth` JOINS the comparison rather than riding along: without it a run stamped before has a
    // matching executes+slices, returns `unchanged`, and never acquires the verdict — an artifact that
    // silently stays on the old shape is exactly what the idempotence check is for and against.
    if (sidecar.fold?.executes === executes
      && JSON.stringify(sidecar.fold?.slices ?? null) === JSON.stringify(slices)
      && JSON.stringify(sidecar.fold?.depth ?? null) === JSON.stringify(depth))
      return { stated: true, executes, unchanged: true };
    const out = { ...sidecar, fold: { ...(sidecar.fold ?? {}), executes, slices, depth, statedAt: new Date().toISOString() } };
    writeFileSync(`${sidecarPath}.tmp`, JSON.stringify(out, null, 2) + "\n");
    renameSync(`${sidecarPath}.tmp`, sidecarPath);
    // The shortfall reaches the run journal by NAME. A verdict that only lives in a sidecar field is one
    // more thing nobody reads; the owner's ruling was that a lane which could not run deep is flagged.
    const shortfalls = Object.entries(depth).filter(([, v]) => v.shortfall).map(([l, v]) => `${l}:${v.cause}`);
    runLog(runDir, { event: "jx-slices-stated", executes, ...(shortfalls.length ? { depthShortfall: shortfalls.join(" ") } : {}) });
    for (const [lane, v] of Object.entries(depth))
      if (v.shortfall) note(`jx lane ${lane}: asked depth=full, ran ${v.ran ?? "(not established)"} — ${v.cause}. ${v.why}`);
    return { stated: true, executes, depth };
  } catch (e) {
    note(`jx slice statement skipped (${String(e?.message ?? e).slice(0, 100)}) — never-kill`);
    return { stated: false };
  }
}

export async function runJxCandidateFold(ctx, job, opts = {}, { runLog = () => {}, note = () => {}, inScopeClasses = [] } = {}) {
  const { run } = ctx;
  try {
    // (the CLEAROTRON_JX_LANES master leg was retired 2026-07-27 — the frozen lane decision below and the
    // per-lane CLEAROTRON_NATIVE_LANGUAGE_<code> switch are the controls; availability is settled before we get here)
    const { minted } = attachJxLanes(ctx);
    const lanes = ctx.jxLanes?.lanes ?? {};
    const laneKeys = Object.keys(lanes).filter((l) => LANGUAGE_LANES[l] && laneArmed(l));   // — the shared reader
    if (!laneKeys.length) return { folded: 0, cause: minted ? "no lanes in scope (jurisdictions/policy)" : "frozen decision has no lanes" };

    const receiptPath = driverDir(run.runDir, "jx-lanes.json");
    const prior = ctx.jxLanes;
    // an empty class scope can only fold entries parseRegisterPlan would REJECT on the next resume
    // (register_plan_classes_missing — the run bricks). Degrade the whole fold instead (review 2026-07-18).
    if (!Array.isArray(inScopeClasses) || !inScopeClasses.length)
      return { folded: 0, cause: "no in-scope classes — the fold would mint unparseable plan entries; skipped (receipted)" };

    // ── Per-lane resume state (review 2026-07-18 — the single foldedAt stamp had three failure modes:
    // a crash between plan write and receipt write re-billed AND double-folded; a wholly-degraded
    // fold froze a repairable credential failure terminal; and the resume report always said 0).
    //   done      — receipt records a successful generation, OR the PLAN already carries this lane's
    //               qids (crash-window repair: the paid work landed; rebuild the receipt, never re-bill)
    //   retryable — degraded with attempts < MAX_LANE_ATTEMPTS (repairable-not-terminal doctrine)
    const planLaneQids = (lane) => (ctx.registerPlan?.entries ?? [])
      .filter((e) => typeof e?.qid === "string" && e.qid.startsWith(`jx-${lane}-`));
    const priorLane = (lane) => prior?.fold?.lanes?.[lane] ?? null;
    const laneDone = (lane) => {
      const pl = priorLane(lane);
      if (pl && !pl.degraded) return true;
      return planLaneQids(lane).length > 0;
    };
    const laneAttempts = (lane) => priorLane(lane)?.attempts ?? 0;
    const pending = laneKeys.filter((l) => !laneDone(l) && laneAttempts(l) < MAX_LANE_ATTEMPTS);
    const foldedAlready = laneKeys.reduce((n, l) => n + planLaneQids(l).length, 0);
    // receipt repair (crash window between plan and receipt writes, pre-fix ordering): a lane whose
    // entries are IN the plan but whose receipt is missing/degraded gets a reconstructed receipt —
    // provenance closed, zero re-bill. Runs whether or not other lanes are pending.
    const repairReceipt = () => {
      let repaired = false;
      const lanesOut = { ...(prior?.fold?.lanes ?? {}) };
      for (const lane of laneKeys) {
        const pl = priorLane(lane);
        if ((!pl || pl.degraded) && planLaneQids(lane).length) {
          // the paid work LANDED and is in the plan — this lane is not degraded, and the rebuilt
          // receipt has to say so or the scorer reads a healthy lane as never-stated
          lanesOut[lane] = jxFoldLaneRecord({
            accepted: planLaneQids(lane).map((e) => ({ qid: e.qid, term: e.term })), refused: [],
            repaired: "receipt rebuilt from the frozen plan (crash window between plan and receipt writes)" });
          repaired = true;
        }
      }
      if (!repaired) return prior?.fold ?? null;
      // — default-then-override. `?? { executor: "repair" }` only injected the executor when `fold`
      // was WHOLLY absent; once a statement writer can create a fold block on a run whose fold never ran,
      // that fallback stops firing and the repaired fold would name no executor. Behaviour-identical today.
      const foldOut = { executor: "repair", ...(prior?.fold ?? {}), lanes: lanesOut, foldedAt: prior?.fold?.foldedAt ?? new Date().toISOString() };
      const sidecarOut = { ...prior, fold: foldOut };
      writeFileSync(`${receiptPath}.tmp`, JSON.stringify(sidecarOut, null, 2) + "\n");
      renameSync(`${receiptPath}.tmp`, receiptPath);
      ctx.jxLanes = sidecarOut;
      runLog(run.runDir, { event: "jx-receipt-repaired", lanes: Object.keys(lanesOut).filter((l) => lanesOut[l].repaired) });
      return foldOut;
    };
    if (!pending.length) {
      repairReceipt();
      const exhausted = laneKeys.filter((l) => !laneDone(l));
      return { folded: foldedAlready, cause: exhausted.length
        ? `already settled (${exhausted.join(", ")} degraded ${MAX_LANE_ATTEMPTS}× — receipted terminal)`
        : "already folded (frozen)" };
    }
    const repairedFold = repairReceipt();

    const { exec, source } = resolveJxExecutor(opts);
    const ledgerPath = driverDir(run.runDir, "jx-completions.jsonl");
    const markName = job.markName ?? job.name;
    const productContext = String(job.goods ?? ctx.profile?.industry ?? "").slice(0, 300);
    // — spread the PRIOR fold FIRST. `executes`/`slices` are minted at delivery, after this
    // function has run, and rebuilding the block from three literal keys silently dropped them on any
    // resume that still had a pending lane. The three keys this function owns are overwritten below it,
    // so carrying the rest forward changes nothing else. Carry-forward beats drop-and-re-mint: the drop
    // leaves a window in which the sidecar carries no statement at all, which reads as the pre- defect.
    const fold = { ...(repairedFold ?? {}), executor: source, lanes: { ...(repairedFold?.lanes ?? {}) }, foldedAt: repairedFold?.foldedAt ?? null };
    // criterion 4 — THE RECEIPT NAMES THE MODEL, NOT ONLY THE EXECUTOR.
    //
    // `executor` says which PATH ran the lane (`engine`, `fixtures:…`, `injected`); it does not say who
    // did the native-language work, and "the model is derivable from the run's attribution" is exactly
    // the derivation the criterion asked to stop needing. `jx-turn.mjs` already captures the model that
    // actually served each turn — the WIRE model, never the alias asked for — and it already reaches the
    // per-lane ledger row. This lifts it to the summary block a reader opens.
    //
    // ACCUMULATED, NEVER OVERWRITTEN, for the reason records above: lanes fold across resumes, so a
    // pass carrying one pending lane must not drop what earlier passes observed. The prior fold's set is
    // carried by the spread and merged into.
    //
    // TWO VALUES, because one cannot be honest on its own. `models` is every distinct model observed and
    // is the truth; `model` is the single name a reader wants and is set ONLY when there is exactly one.
    // Lanes disagreeing is a real state — a resume under a different program, a per-lane override — and
    // naming one of them would be a receipt that lies. `model: null` beside a populated `models` says so.
    // An executor that runs no model at all (fixtures, injected) contributes nothing and leaves both
    // empty, which is the honest answer rather than a fabricated tier name.
    const noteLaneModel = (observed) => {
      const name = String(observed ?? "").trim();
      if (!name) return;
      const seen = new Set(Array.isArray(fold.models) ? fold.models : []);
      seen.add(name);
      fold.models = [...seen].sort();
      fold.model = fold.models.length === 1 ? fold.models[0] : null;
    };
    const allEntries = [];
    for (const lane of pending) {
      const started = Date.now();
      let r;
      try { r = await exec({ mark: markName, productContext, lane }); }
      catch (e) { r = { ok: false, cause: `executor threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
      // billing path on the row — see jxBillingStamp: this lane is the driver's only per-token
      // invoice, and its rows bucketed as "unknown" in every per-run rollup until now.
      const row = { ts: new Date().toISOString(), lane, mark: markName, executor: source, ...jxBillingStamp(source, r),
        took_ms: r?.tookMs ?? (Date.now() - started), ok: Boolean(r?.ok),
        candidates: r?.ok ? (r.candidates?.length ?? 0) : 0,
        ...(r?.model ? { model: r.model } : {}),
        ...(r?.usage ? { usage: r.usage } : {}), ...(r?.ok ? {} : { cause: String(r?.cause ?? "unknown").slice(0, 300) }) };
      try { appendFileSync(ledgerPath, JSON.stringify(row) + "\n"); } catch { /* receipts best-effort */ }
      // Before the degraded-lane `continue` below: a lane that FAILED still ran a turn, and the model
      // that produced the failure is part of who did this run's native-language work.
      noteLaneModel(r?.model);
      if (!r?.ok) {
        const attempts = laneAttempts(lane) + 1;
        fold.lanes[lane] = jxFoldLaneRecord({ cause: r?.cause ?? "unknown", attempts,
          degradedAt: new Date().toISOString(), accepted: [], refused: [] });
        note(`jx ${lane} lane degraded (${row.cause}) — attempt ${attempts}/${MAX_LANE_ATTEMPTS}; a resume retries; the Latin plan stands (never-kill)`);
        continue;
      }
      const { entries, accepted, refused } = jxPlanEntries({ lane, laneDecision: lanes[lane], candidates: r.candidates,
        inScopeClasses, existingEntries: ctx.registerPlan?.entries ?? [] });
      // the CNIPA awareness note (informational ONLY — recorded in THIS receipt for the operator/audit
      // trail; lawyer-visible report surfacing lands with the jx report section, a later slice)
      // — READ, NOT RECALLED. This was five hand-written classes marked `vetted:false`; measured
      // against the shipped table it carried 4 of the 22 groups in class 9 and returned null for class
      // 33, which has one. Every class now answers from the office's own table, with the edition and a
      // citation, and a class nobody transcribed REFUSES by name instead of reading as empty.
      const subgroups = lane === "zh" ? cnipaSubgroupsForClasses(inScopeClasses) : undefined;
      fold.lanes[lane] = jxFoldLaneRecord({ accepted, refused, ...(subgroups ? { cnipaSubgroups: subgroups } : {}) });
      allEntries.push(...entries);
    }

    let folded = 0;
    if (allEntries.length) {
      // fresh fold entries must be executable — an unexecutable candidate is dropped loudly, never folded
      const issues = validatePlanFeasibility({ entries: allEntries });
      const bad = new Set(issues.filter((i) => i.severity === "unexecutable").map((i) => i.entry));
      const good = allEntries.filter((e) => !bad.has(e.qid));
      for (const i of issues) if (bad.has(i.entry)) runLog(run.runDir, { event: "jx-entry-refused", qid: i.entry, issue: i.issue });
      const { plan, added, refused: foldRefused } = foldSupplementalEntries(ctx.registerPlan, good);
      // — expected empty, because the `unexecutable` filter above already drops term-shape issues
      // (validatePlanFeasibility classes them there, not `repairable`). Logged rather than assumed:
      // a silently dropped fold entry is a native-script candidate that stopped being searched with
      // nothing anywhere saying so, which is the absence-read-as-success this whole issue is about.
      for (const r of foldRefused) runLog(run.runDir, { event: "jx-entry-refused", qid: r.qid, issue: r.issue, at: "fold" });
      if (added.length) {
        const planPath = ctx.paths.registerPlan;
        // RECEIPT FIRST, then the plan (review 2026-07-18): with the receipt already recording the
        // lane as done, a crash between the two writes leans SAFE — the next resume sees a done lane
        // whose entries are absent from the plan… which laneDone() treats as done via the receipt, so
        // the run proceeds Latin-only for that lane (a bounded coverage loss, receipted) instead of
        // re-billing and double-folding. The reconciliation above covers the mirror ordering for
        // pre-fix runs (plan present, receipt missing).
        fold.foldedAt = new Date().toISOString();
        const sidecarEarly = { ...prior, fold };
        writeFileSync(`${receiptPath}.tmp`, JSON.stringify(sidecarEarly, null, 2) + "\n");
        renameSync(`${receiptPath}.tmp`, receiptPath);
        writeFileSync(`${planPath}.tmp`, JSON.stringify(plan, null, 2) + "\n");
        renameSync(`${planPath}.tmp`, planPath);
        ctx.registerPlan = plan;   // run-local only — no slug-store write-back (senior lawyer 2026-07-10)
        folded = added.length;
      }
    }
    fold.foldedAt = fold.foldedAt ?? new Date().toISOString();
    const sidecar = { ...prior, fold };
    writeFileSync(`${receiptPath}.tmp`, JSON.stringify(sidecar, null, 2) + "\n");
    renameSync(`${receiptPath}.tmp`, receiptPath);
    ctx.jxLanes = sidecar;
    runLog(run.runDir, { event: "jx-candidate-fold", lanes: pending, folded,
      refused: Object.values(fold.lanes).reduce((n, l) => n + (l.refused?.length ?? 0), 0) });
    if (folded) note(`jx lanes: ${folded} native-script candidate quer${folded === 1 ? "y" : "ies"} folded into the frozen plan (${pending.join(", ")})`);
    return { folded: folded + foldedAlready };
  } catch (e) {
    note(`jx lanes skipped (${String(e?.message ?? e).slice(0, 120)}) — never-kill; the Latin plan stands`);
    return { folded: 0, cause: String(e?.message ?? e).slice(0, 200) };
  }
}
