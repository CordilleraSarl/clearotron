// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// crowd-context.mjs — the counts a lawyer closes a crowd doubt with, gathered as EVIDENCE to judgment.
//
// THE DOUBT THIS SERVES. When the register coverage ledger holds a MATERIAL slice the funnel could not
// enumerate to has_more:false (a `coverage-limited` row on a material axis — the exact shape the
// synthesis COVERAGE JUDGMENT dictation names as its sufficient:false path), the lawyer today has only
// the descriptor: "~N,NNN hits, not exhausted". A real practitioner closes that doubt AFFIRMATIVELY with
// crowded-field evidence: how many live registrations carry the formative term at all, how many inside
// the in-scope classes, and — decisive — the exact/near-identical subset actually SEEN, record by
// record, when it is small enough to enumerate completely. This module gathers exactly those three
// things and hands them up. It decides NOTHING: whether the counts plus the seen sample amount to a
// crowd the confusion analysis already prices in is judgment's call (synthesis coverage_judgment), and
// the dictation's crowd-context path demands the lawyer NAME the counts and the clean sample in the
// reason — a number here is never a threshold and never flips sufficiency by itself.
//
// NORTH-STAR COMPLIANCE. (1) Judgment decides — this module only widens what judgment can SEE; nothing
// here reads less evidence than before (it only ever adds reads), and no count gates anything. (2)
// Absence is non-fatal by construction: the orchestrator returns null on any executor failure and the
// pipeline integration wraps the whole pass in try/catch → `crowd-context-failed` run.jsonl event and
// the run continues; synthesis's material-slice ⇒ sufficient:false path stands unchanged when the
// artifact is absent. (3) Materiality comes from the LEDGER ROW'S OWN axis/status/term data joined to
// the frozen plan — never from a hardcoded mark rule (the judgment-relocation mandate: no per-case
// sufficiency logic in the machine).
//
// PURE (no node imports) like coverage-ledger.mjs / named-band.mjs — selection and composition test
// offline; the ONE effectful edge (the register query lane) is an INJECTED async executor, so tests
// pass a stub and the pipeline passes an adapter over the SAME provider executePlan lane that
// runSaturationProbeCodeSide and the fan-in repair kit dispatch through (no new provider surface).
//
// Executor contract (the injected function): `async executor(entries) => blocks[]` — entries are
// register-plan-shaped rows {qid, axis: CROWD_CONTEXT_AXIS, predicate, term|terms, nice_classes,
// regions, expected_kind}; blocks are named-band-shaped {qid, state, total_hits, fetched, records?,
// sample?, error?} (what makeExecutePlan writes). The pipeline adapter round-trips a STANDALONE plan
// file (_driver/crowd-context-plan.json → _driver/crowd-context-band.json) so the frozen register plan
// and the axis bands are never touched — this pass mutates no existing artifact.

import { NON_MATERIAL_AXES } from "./coverage-ledger.mjs";

// ── caps — these bound SPEND, never sufficiency ─────────────────────────────────────────────────────
// Each cap limits how many provider calls / how many fetched records one evidence pass may buy. They
// are NEVER a decider: a subset larger than CROWD_ENUM_CAP is reported by its count (judgment weighs
// the number), a run with more qualifying slices than CROWD_MAX_SLICES gathers the first N and notes
// the rest — in no case does hitting a cap make coverage "sufficient" or "insufficient". That call
// belongs to the lawyer reading the artifact, per the coverage-judgment dictation.
export const CROWD_ENUM_CAP = 200;             // full-enumeration ceiling for the exact/near-identical subset
export const CROWD_MAX_SLICES = 4;             // ledger slices per pass (each costs ~2 calls/term + ≤2 subset calls)
export const CROWD_MAX_TERMS_PER_SLICE = 12;   // per-term count fan-out bound (2 count probes per term)

// The dedicated axis token for the standalone crowd-context plan. Deliberately NOT one of
// REGISTER_AXES: these driver-minted entries must never be confusable with (or folded into) the frozen
// register plan, its skeleton, or any coverage gate — the executor lane filters by this token against
// the standalone plan file only.
export const CROWD_CONTEXT_AXIS = "crowd-context";

// ── text-join helpers (pure) ────────────────────────────────────────────────────────────────────────

// Normalize free prose to a space-bounded token stream so term membership is checked on WORD
// boundaries, not substrings — "ION" must join "exact-ION × cl.9" and must NOT join "coded goods".
const tokenize = (s) => ` ${String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/gi, " ").trim()} `;
const normTerm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9*]+/gi, " ").trim();

// Does the ledger row's own text carry this plan term? Word-bounded; a wildcard term (TRIPH*) matches
// any row token it prefixes/suffixes. Multi-word terms match as a contiguous token run. PURE.
export function termAppearsIn(term, hay) {
  const t = normTerm(term);
  if (!t) return false;
  const h = tokenize(hay);
  if (!t.includes("*")) return t.length >= 2 && h.includes(` ${t.replace(/\*/g, "")} `);
  const stem = t.replace(/\*/g, "").trim();
  if (stem.length < 2) return false;
  const tokens = h.trim().split(" ");
  if (t.endsWith("*") && !t.startsWith("*")) return tokens.some((w) => w.startsWith(stem));
  if (t.startsWith("*") && !t.endsWith("*")) return tokens.some((w) => w.endsWith(stem));
  return tokens.some((w) => w.includes(stem));
}

// Deterministic qid-suffix slug (mirrors register-plan.mjs's slug idiom; kept local so this module
// stays import-light and PURE).
const slug = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "t";

// ── slice selection (pure) ──────────────────────────────────────────────────────────────────────────

/**
 * Which coverage-ledger rows qualify for a crowd-context evidence pass, and with what formative terms.
 *
 * A row QUALIFIES when all of:
 *   - status === "coverage-limited": the search RAN and saturated — the "not enumerated to
 *     has_more:false" shape the synthesis material path is about. `deferred` rows are deliberately
 *     EXCLUDED: that slice was never searched / never reached its data, so no live count can close it
 *     affirmatively — it stays the escalation/envelope + registerGap clamp's problem, and gathering
 *     counts over it would dress an unexecuted search as evidence. `confirmed-clean` needs nothing.
 *   - the axis is MATERIAL (not in NON_MATERIAL_AXES): the saturation-probe's rows are count-only
 *     macro crowd descriptors by definition ("coverage-limited (count-only, saturated)") — off-field
 *     context, never the dangerous named band, and the U1 carve-out already keeps them from driving
 *     completeness. Selecting them would spend calls re-counting a count.
 *   - the slice's FORMATIVE TERMS are derivable from the row's OWN data joined to the frozen plan:
 *     a plan entry on the row's axis whose qid appears verbatim in the row text (the strongest join —
 *     machine-written rows carry it; mirrors register-plan's blockIsDisclosed), or whose term(s) appear
 *     word-bounded in the row's unit/scope/reason. NO fallback term invention: a row that joins nothing
 *     lands in skipped[] with the honest reason — composing queries from guessed terms would gather
 *     evidence about a slice nobody flagged (never a hardcoded mark rule, never an invented one).
 *
 * OWNER-LANE JOINS (F2, 2026-07-29). Two doctrine points the F2 plan entries force:
 *   - a `predicate:"owner"` entry NEVER contributes to term derivation: its term is the OWNER NAME,
 *     not mark text, and minting mark-text counts from it would search an owner name as a mark — the
 *     exact doctrine-2 violation the executor refuses on its own lane. A row that joins ONLY such an
 *     entry (the bare-owner portfolio count disclosure) is an honest skip: a portfolio count is not
 *     closeable by mark-text counts — the owner×term slice qids in its covered_by are the coverage.
 *   - an OWNER-SCOPED mark-text entry (the owner×formative slice) keeps its `owner` on the derived
 *     slice, and matched entries are GROUPED by owner scope: dropping the scope would mint counts over
 *     the un-owned formative crowd (e.g. 41,235) while claiming to describe the owner's slice, and
 *     mixing scopes in one slice would do the same under a different face.
 *
 * @param ledgerRows   [{axis, status, unit?, scope?, reason?}] — loadCoverageLedger shapes (already
 *                     tool-absence/taint relabelled at the pipeline's single choke point).
 * @param planContext  { entries?: register-plan entries, niceClasses?: plan.nice_classes,
 *                     regions?: plan.regions } — the frozen plan's own data; nothing else.
 * @returns { selected: [{axis, unit, reason, terms, nice_classes, regions, owner?}], skipped: [{axis, unit, reason}] }
 */
export function selectCrowdSlices(ledgerRows, planContext = {}) {
  const entries = Array.isArray(planContext.entries) ? planContext.entries : [];
  const fallbackClasses = (planContext.niceClasses ?? []).map(String);
  const regions = (planContext.regions ?? []).map(String);
  const selected = [];
  const skipped = [];
  for (const r of ledgerRows ?? []) {
    if (!r || r.status !== "coverage-limited") continue;
    const axis = String(r.axis ?? "").toLowerCase();
    if (NON_MATERIAL_AXES.includes(axis)) continue;   // count-only macro descriptors — off-field by doctrine
    const rowText = `${r.unit ?? ""} ${r.scope ?? ""} ${r.reason ?? ""}`;
    // join the row to the plan's OWN entries: qid-verbatim first, then word-bounded term membership;
    // matched entries GROUP by owner scope (null = un-owned) so a count always describes ONE crowd
    const groups = new Map();   // key "" | `o:<owner>` → { owner, terms:[], classes:Set }
    let ownerCountJoined = false;
    for (const e of entries) {
      if (!e || String(e.axis ?? "").toLowerCase() !== axis) continue;
      const entryTerms = Array.isArray(e.terms) ? e.terms : (e.term != null ? [e.term] : []);
      const qidHit = typeof e.qid === "string" && e.qid && rowText.includes(e.qid);
      const matched = qidHit ? entryTerms : entryTerms.filter((t) => termAppearsIn(t, rowText));
      if (!matched.length) continue;
      if (String(e.predicate ?? "") === "owner") { ownerCountJoined = true; continue; }   // owner name ≠ mark text, ever
      const owner = typeof e.owner === "string" && e.owner.trim() ? e.owner.trim() : null;
      const key = owner ? `o:${owner}` : "";
      if (!groups.has(key)) groups.set(key, { owner, terms: [], classes: new Set() });
      const g = groups.get(key);
      for (const t of matched) if (!g.terms.includes(t)) g.terms.push(t);
      for (const c of e.nice_classes ?? []) g.classes.add(String(c));
    }
    if (!groups.size) {
      // honest skip — no mark-text term derivable from the row's own data; we never invent one
      skipped.push({ axis, unit: r.unit ?? "", reason: ownerCountJoined
        ? "bare-owner portfolio count row — a portfolio count is not closeable by mark-text counts (the owner×term slices in its covered_by are the coverage); no mark-text term is derivable here"
        : "no formative term joinable from the plan — cannot compose evidence queries without inventing a term" });
      continue;
    }
    for (const g of groups.values()) {
      selected.push({
        axis,
        unit: r.unit ?? "",
        reason: r.reason ?? "",
        terms: g.terms,
        nice_classes: g.classes.size ? [...g.classes] : fallbackClasses,
        regions,
        ...(g.owner ? { owner: g.owner } : {}),
      });
    }
  }
  return { selected, skipped };
}

// ── entry minting (pure; exported for the orchestrator's own tests) ─────────────────────────────────

// Phase-1 entries for one slice: per formative term, ONE contains-style count across ALL classes (the
// register-wide ubiquity read) + ONE restricted to the slice's in-scope classes (the crowd where it
// matters), plus ONE exact-predicate count over the whole term set — the "dangerous category" gate
// probe that decides (phase 2) whether the subset is small enough to enumerate fully. Contains-style
// ("default") per-term counts on purpose: that is the predicate under which the sweep saturated, so
// the counts describe the SAME crowd the ledger row is about. An owner-scoped slice carries its
// `owner` onto EVERY minted entry for the same reason — un-owned counts would describe the wider
// formative crowd while claiming to describe the owner's slice.
export function mintSliceCountEntries(slice, i, { maxTerms = CROWD_MAX_TERMS_PER_SLICE } = {}) {
  const terms = slice.terms.slice(0, maxTerms);
  const base = { axis: CROWD_CONTEXT_AXIS, regions: slice.regions ?? [], expected_kind: "count",
    ...(typeof slice.owner === "string" && slice.owner ? { owner: slice.owner } : {}) };
  const out = [];
  terms.forEach((t, j) => {
    out.push({ ...base, qid: `crowdctx:s${i}-t${j}-${slug(t)}-all`, predicate: "default", term: t, nice_classes: [] });
    out.push({ ...base, qid: `crowdctx:s${i}-t${j}-${slug(t)}-cls`, predicate: "default", term: t, nice_classes: slice.nice_classes ?? [] });
  });
  out.push({
    ...base, qid: `crowdctx:s${i}-exact-count`, predicate: "exact",
    ...(terms.length > 1 ? { terms } : { term: terms[0] }),
    nice_classes: slice.nice_classes ?? [],
  });
  return out;
}

// The phase-2 enumerate entry for a slice whose exact-subset count came back tractable.
export function mintSliceEnumEntry(slice, i, { maxTerms = CROWD_MAX_TERMS_PER_SLICE } = {}) {
  const terms = slice.terms.slice(0, maxTerms);
  return {
    axis: CROWD_CONTEXT_AXIS, regions: slice.regions ?? [], expected_kind: "enumerate",
    qid: `crowdctx:s${i}-exact-enum`, predicate: "exact",
    ...(terms.length > 1 ? { terms } : { term: terms[0] }),
    nice_classes: slice.nice_classes ?? [],
    ...(typeof slice.owner === "string" && slice.owner ? { owner: slice.owner } : {}),
  };
}

// ── composition (pure) ──────────────────────────────────────────────────────────────────────────────

const fmtN = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "—");
const cell = (s) => String(s ?? "—").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 60);

/**
 * Build the machine JSON + the readable crowd-context.md from per-slice gathered results. EVIDENCE
 * VOICE ONLY, enforced by test: the md states counts and lists records; it draws no conclusion, sets
 * no status token, and never uses the coverage/verdict vocabulary — the lawyer's coverage_judgment is
 * where those words happen.
 *
 * @param sliceResults [{ slice, term_counts: [{term, all_classes, in_scope, error?}],
 *                       exact: {terms, nice_classes, total_hits, enumerated, records, sample, error?} }]
 * @returns { json, md }
 */
export function composeCrowdContext(sliceResults, meta = {}) {
  const slices = (sliceResults ?? []).map((sr) => ({
    axis: sr.slice.axis,
    unit: sr.slice.unit,
    ledger_reason: sr.slice.reason,
    terms: sr.slice.terms,
    nice_classes: sr.slice.nice_classes,
    // owner-scoped slice: the scope is DATA on the artifact, so no reader can take these counts for
    // the (much larger) un-owned formative crowd
    ...(typeof sr.slice.owner === "string" && sr.slice.owner ? { owner: sr.slice.owner } : {}),
    term_counts: sr.term_counts,
    exact_subset: sr.exact,
  }));
  const json = {
    schema_version: 1,
    // the artifact self-describes its standing so no future reader mistakes it for a gate input
    role: "evidence for the synthesis coverage_judgment — live counts and an enumerated exact/near-identical sample over material un-enumerated slices; counts are never a threshold and this artifact gates nothing",
    caps: { enum_cap: meta.enumCap ?? CROWD_ENUM_CAP, max_slices: meta.maxSlices ?? CROWD_MAX_SLICES, max_terms_per_slice: meta.maxTermsPerSlice ?? CROWD_MAX_TERMS_PER_SLICE },
    slices,
  };
  const md = [];
  md.push("# Crowd context — register counts and the enumerated exact/near-identical sample");
  md.push("");
  md.push("Driver-gathered evidence over each material register slice the funnel could not enumerate to");
  md.push("has_more:false. For every slice: per-term live register counts (all classes, and restricted to the");
  md.push("in-scope classes), and the exact/near-identical subset — fully enumerated, record by record, when it");
  md.push(`is at or under ${fmtN(json.caps.enum_cap)} records; otherwise its count. All figures are evidence for the reasoning;`);
  md.push("no figure is a threshold and nothing here makes a call on the coverage question.");
  for (const s of slices) {
    md.push("");
    md.push(`## ${s.unit || s.axis}`);
    md.push("");
    md.push(`Ledger reason: ${s.ledger_reason || "(none recorded)"}`);
    md.push("");
    if (s.owner) {
      md.push(`Owner scope: ${cell(s.owner)} — every count and the subset below are intersected with this owner's portfolio.`);
      md.push("");
    }
    md.push("| formative term | register hits (all classes) | hits in in-scope classes (" + (s.nice_classes ?? []).join(", ") + ") |");
    md.push("|---|---|---|");
    for (const tc of s.term_counts ?? []) {
      md.push(`| ${cell(tc.term)} | ${tc.error ? "count unavailable (provider error)" : fmtN(tc.all_classes)} | ${tc.error ? "count unavailable (provider error)" : fmtN(tc.in_scope)} |`);
    }
    const ex = s.exact_subset ?? {};
    md.push("");
    if (ex.error) {
      md.push(`Exact/near-identical subset (${(ex.terms ?? []).join(" / ")} × cl. ${(ex.nice_classes ?? []).join(",")}): provider error — no count or enumeration gathered for this subset.`);
    } else if (ex.enumerated) {
      md.push(`Exact/near-identical subset (${(ex.terms ?? []).join(" / ")} × cl. ${(ex.nice_classes ?? []).join(",")}): ${fmtN(ex.total_hits)} record(s), FULLY enumerated — every record listed below.`);
      if ((ex.records ?? []).length) {
        md.push("");
        md.push("| mark | owner | classes | status | record |");
        md.push("|---|---|---|---|---|");
        for (const r of ex.records ?? []) {
          md.push(`| ${cell(r.mark_text ?? r.mark)} | ${cell(r.owner_name ?? r.owner)} | ${cell(Array.isArray(r.classes) ? r.classes.join(",") : r.classes)} | ${cell(r.status)} | ${cell(r.record_id ?? r.uri)} |`);
        }
      } else {
        md.push("");
        md.push("(zero records — the exact/near-identical subset is empty at the count probe)");
      }
    } else {
      md.push(`Exact/near-identical subset (${(ex.terms ?? []).join(" / ")} × cl. ${(ex.nice_classes ?? []).join(",")}): ${fmtN(ex.total_hits)} record(s) — above the ${fmtN(json.caps.enum_cap)}-record enumeration cap, so its count is reported and the subset was not enumerated here.`);
    }
  }
  md.push("");
  md.push("---");
  md.push("These figures and records are inputs to the lawyer's own reasoning. The cap bounds what this pass");
  md.push("spends, never what the answer is.");
  md.push("");
  return { json, md: md.join("\n") };
}

// ── the orchestrator ────────────────────────────────────────────────────────────────────────────────

// Compact an enumerated record to the fields the artifact carries (the band record's screening facts;
// unknown/extra provider fields dropped — the md renders these five and judgment fetches anything deeper
// through the normal record lane).
const compactRecord = (r) => ({
  record_id: r.record_id ?? r.uri ?? null,
  mark_text: r.mark_text ?? r.mark ?? null,
  classes: Array.isArray(r.classes) ? r.classes : (r.classes != null ? [r.classes] : []),
  status: r.status ?? null,
  owner_name: r.owner_name ?? r.owner ?? null,
  jurisdictions: Array.isArray(r.jurisdictions) ? r.jurisdictions : [],
});

/**
 * Gather the crowd-context evidence: select slices → count phase → enumerate phase → compose.
 *
 * NON-FATAL BY CONTRACT: any executor failure (throw, or a rejected batch) is caught here — the
 * orchestrator emits a `crowd-context-failed` row through `log`, notes, and returns null. The caller
 * treats null as "no artifact this run" and the run proceeds untouched (the synthesis dictation's
 * no-crowd-context path stands). Per-BLOCK provider errors do NOT abandon the pass: the affected
 * term/subset is reported `error` honestly and everything gathered still ships — partial evidence is
 * still evidence, and throwing it away would be the machine deciding it wasn't good enough.
 *
 * @param opts.ledger       coverage-ledger rows (loadCoverageLedger(...).rows)
 * @param opts.planContext  { entries, niceClasses, regions } from the frozen register plan
 * @param opts.executor     INJECTED: async (entries) => band blocks (tests stub it; the pipeline passes
 *                          the planExec-lane adapter). Null/absent ⇒ no lane ⇒ null (logged, non-fatal).
 * @param opts.caps         { maxSlices?, maxTermsPerSlice?, enumCap? } — spend bounds only.
 * @param opts.note / opts.log  observability hooks (default no-ops; pipeline wires note()/runLog).
 * @returns { json, md, stats } | null
 */
export async function buildCrowdContext({ ledger, planContext = {}, executor, caps = {}, note = () => {}, log = () => {} } = {}) {
  const maxSlices = caps.maxSlices ?? CROWD_MAX_SLICES;
  const maxTermsPerSlice = caps.maxTermsPerSlice ?? CROWD_MAX_TERMS_PER_SLICE;
  const enumCap = caps.enumCap ?? CROWD_ENUM_CAP;
  if (typeof executor !== "function") { note("crowd-context: no executor lane available — skipped (evidence pass needs the plan-direct provider lane)"); return null; }
  const { selected, skipped } = selectCrowdSlices(ledger, planContext);
  for (const s of skipped) note(`crowd-context: ${s.axis} / ${s.unit || "(scope-less row)"} not gatherable — ${s.reason}`);
  // PR-6 (ask ledger, birth-place 10): a skipped slice is a question the run asked itself and
  // declined WITH a reason — persist the rows to run.jsonl (they used to live only in note lines),
  // so the ask ledger can record each as judged-immaterial with the honest reason.
  if (skipped.length) log({ event: "crowd-context-skips", skipped });
  if (!selected.length) return null;   // nothing material to close — absence of the artifact is the normal case
  const slices = selected.slice(0, maxSlices);
  if (selected.length > slices.length) note(`crowd-context: ${selected.length} qualifying slice(s), gathering the first ${slices.length} (spend cap — the rest keep their ledger disclosure unchanged)`);
  try {
    // ── phase 1: one batched executor call for every count probe ─────────────────────────────────
    const countEntries = slices.flatMap((s, i) => mintSliceCountEntries(s, i, { maxTerms: maxTermsPerSlice }));
    const byQid = new Map((await executor(countEntries) ?? []).filter((b) => b && b.qid).map((b) => [b.qid, b]));
    // ── phase 2: enumerate each exact subset the count proved tractable (0 < hits ≤ cap) ─────────
    // A verified-zero count needs no call (enumerating an empty subset returns the empty subset);
    // an errored count gets no call either — we never enumerate blind on a count we don't have.
    const enumTargets = [];
    slices.forEach((s, i) => {
      const c = byQid.get(`crowdctx:s${i}-exact-count`);
      const hits = Number(c?.total_hits);
      if (c && !c.error && Number.isFinite(hits) && hits > 0 && hits <= enumCap) enumTargets.push(i);
    });
    if (enumTargets.length) {
      const enumEntries = enumTargets.map((i) => mintSliceEnumEntry(slices[i], i, { maxTerms: maxTermsPerSlice }));
      for (const b of (await executor(enumEntries) ?? [])) if (b && b.qid) byQid.set(b.qid, b);
    }
    // ── assemble per-slice results from the blocks (missing block = honest error disposition) ────
    const sliceResults = slices.map((s, i) => {
      const terms = s.terms.slice(0, maxTermsPerSlice);
      const term_counts = terms.map((t, j) => {
        const all = byQid.get(`crowdctx:s${i}-t${j}-${slug(t)}-all`);
        const cls = byQid.get(`crowdctx:s${i}-t${j}-${slug(t)}-cls`);
        const bad = !all || all.error || !cls || cls.error;
        return { term: t, all_classes: Number(all?.total_hits) || 0, in_scope: Number(cls?.total_hits) || 0, ...(bad ? { error: true } : {}) };
      });
      const c = byQid.get(`crowdctx:s${i}-exact-count`);
      const hits = Number(c?.total_hits) || 0;
      const en = byQid.get(`crowdctx:s${i}-exact-enum`);
      let exact;
      if (!c || c.error) {
        exact = { terms, nice_classes: s.nice_classes, total_hits: 0, enumerated: false, records: [], sample: [], error: true };
      } else if (hits === 0) {
        exact = { terms, nice_classes: s.nice_classes, total_hits: 0, enumerated: true, records: [], sample: [] };   // verified-zero — the count IS the enumeration
      } else if (en && !en.error && String(en.state).toLowerCase() === "enumerated") {
        exact = { terms, nice_classes: s.nice_classes, total_hits: Number(en.total_hits) || hits, enumerated: true,
          records: (Array.isArray(en.records) ? en.records : []).slice(0, enumCap).map(compactRecord), sample: [] };
      } else {
        // above the cap, or the enumerate itself came back incomplete/errored: the honest COUNT ships
        // (with any sample the lane returned) — never a partial list dressed as the full subset
        exact = { terms, nice_classes: s.nice_classes, total_hits: Number(en?.total_hits) || hits, enumerated: false,
          records: [], sample: (Array.isArray(en?.sample) ? en.sample : (Array.isArray(c?.sample) ? c.sample : [])).slice(0, 5).map(compactRecord),
          ...(en?.error ? { error: true } : {}) };
      }
      return { slice: s, term_counts, exact };
    });
    const { json, md } = composeCrowdContext(sliceResults, { enumCap, maxSlices, maxTermsPerSlice });
    const stats = {
      slices: sliceResults.length,
      terms: sliceResults.reduce((n, sr) => n + sr.term_counts.length, 0),
      enumerated_subsets: sliceResults.filter((sr) => sr.exact.enumerated).length,
      enumerated_records: sliceResults.reduce((n, sr) => n + (sr.exact.records?.length ?? 0), 0),
      skipped: skipped.length,
    };
    return { json, md, stats };
  } catch (e) {
    // NON-FATAL by contract: the evidence pass failing must never block or degrade the run — log the
    // structured event, note, and return null; synthesis proceeds exactly as if the pass never existed.
    const fail = String(e?.message ?? e).slice(0, 200);
    note(`crowd-context: executor failed (${fail}) — evidence pass abandoned, run continues without it`);
    log({ event: "crowd-context-failed", fail });
    return null;
  }
}
