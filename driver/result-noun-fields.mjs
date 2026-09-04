// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// result-noun-fields.mjs —. Every field whose NAME promises a result, and what its writer knows.
//
// fixed four instances in four modules and named the reason they were one issue: *"every field
// written into `_driver/*.json` or `run.jsonl` whose name is a result noun, checked against what the
// writing site actually knows at that moment."* No such enumeration existed. A failure list is a sample.
//
// ── WHY THIS IS A TABLE AND NOT A LINT ──────────────────────────────────────────────────────────────
//
// The class is *a field whose name promises a result and whose value reports an invocation*. That is a
// property of the WRITING SITE, not of the name — a field called `outcome` carrying an outcome is fine,
// and a field called `settled` carrying a dispatch return is the defect. Only reading the writer tells
// them apart, so the population is SPLIT and classified rather than filtered down to the offenders.
// Both halves are kept, for 's reason: a filtered population produces no number, and nobody can see
// what was hidden.
//
// ── THE TWO HALVES ──────────────────────────────────────────────────────────────────────────────────
//
// `atWriteSite` is how many of a pair's sites sit inside a call that actually writes one of those two
// artifact families — `runLog`/`stageLog`/`log`/`appendLine`/`recordSpan`, or `writeFileSync`/
// `atomicWrite` against a `driverDir()` path or a `P.<key>` built with `driverRel()`. A pair with zero is
// REPORTED, never dropped: it is a result noun in a module that writes these artifacts, and the reason it
// is out of scope is a fact worth stating rather than a filter nobody can see.
//
// ── WHAT THIS CANNOT SEE, SO THE NUMBER IS NOT READ AS COVERAGE ─────────────────────────────────────
//
// Fields that reach an artifact by SPREAD from a pure builder. `pipeline.mjs` writes
// `atomicWrite(P.recordCarry, JSON.stringify({ ts, trigger, ...artifact }))`, where `artifact` comes from
// `traceRecordCarry` in `record-carry.mjs`. No object literal at the write site carries those fields, so
// a call-site-scoped scan structurally cannot reach them.
//
// That limit was found by measurement, not by reasoning: extending the scan from
// `writeFileSync(driverDir(…))` to `atomicWrite` — the DOMINANT form in this tree, 59 sites against 19 —
// changed the hit count from 26 to 26. A matching count is not agreement. Closing it means scanning the
// pure builders as a second population, which is a larger job than this issue's criteria.
//
// ── HOW TO ADD A ROW ────────────────────────────────────────────────────────────────────────────────
//
// The guard derives (file, noun, siteCount, atWriteSiteCount) from the tree and fails on any pair this
// table does not carry, and on any pair whose counts moved. A new site in an already-listed file moves
// the count, so it fires too — the count is the thing that makes this more than a file list.
//
// `verdict` is one of:
//   "result"      — the value states what happened. The name is honest.
//   "invocation"  — the value states that something was CALLED. Fix by renaming, or by adding a sibling
//                   that carries the result (the remedy `repairs.mjs:724` already uses, keeping
//                   `outcome` for existing readers beside `dispatch` and `verdict`).
//   "out-of-scope" — never reaches `_driver/*.json` or `run.jsonl`; `atWriteSite` is 0.

/** The result nouns this sweep is about — 's list, verbatim. */
export const RESULT_NOUNS = Object.freeze(["outcome", "executed", "permanent", "settled", "closed", "recovered", "verified"]);

export const RESULT_NOUN_FIELDS = Object.freeze([
  // ── in scope: written into _driver/*.json or run.jsonl ────────────────────────────────────────────
  { file: "driver/digest-queue.mjs", noun: "recovered", sites: 1, atWriteSite: 1, verdict: "result",
    why: "written on the branch where the post-repair `check()` returned zero violations — a re-measured state, not a call returning" },
  { file: "driver/gateway.mjs", noun: "outcome", sites: 1, atWriteSite: 1, verdict: "result",
    why: "the repair verdict the same row tests with `ok: outcome === \"repaired\"`; judged, not dispatched" },
  { file: "driver/gateway.mjs", noun: "settled", sites: 2, atWriteSite: 2, verdict: "result",
    why: "counts read off the coverage/placement unions" },
  { file: "driver/pipeline-knockout.mjs", noun: "recovered", sites: 1, atWriteSite: 1, verdict: "result",
    why: "written after the chunk files were actually removed" },
  { file: "driver/pipeline.mjs", noun: "closed", sites: 6, atWriteSite: 4, verdict: "result",
    why: "closure counts derived from the landed set (`qids.filter(q => landed.has(q)).length`) and from the receipt" },
  { file: "driver/pipeline.mjs", noun: "executed", sites: 4, atWriteSite: 3, verdict: "result",
    why: "lengths of the executed set as the join computed it" },
  { file: "driver/pipeline.mjs", noun: "outcome", sites: 11, atWriteSite: 6, verdict: "result",
    why: "the one member that reported an invocation — taint-rerun's `r.ok ? \"ok\" : …`, which travels on a StageFailure packet — now carries a `cleared` sibling read from the taint, #1529's remedy 10/5 -> 11/6 at tracker issue 1886: the profile-store receipt's `outcome: pr.outcome`. Classified by READING ITS WRITING SITE, which is profiles.mjs and not this file: the value is one of three literals chosen by a situation the resolver decided (`overlay` and `bundled-fallback` are `pass`, `env-arrived-late` is `blocked`), never a call's return read as a verdict. `bundled-fallback` being `pass` is the point of the whole receipt — a legitimate install that nobody was told about is what this row says out loud." },
  { file: "driver/pipeline.mjs", noun: "permanent", sites: 1, atWriteSite: 1, verdict: "result",
    why: "`permanent.length` — a count of the classified set" },
  { file: "driver/pipeline.mjs", noun: "recovered", sites: 3, atWriteSite: 3, verdict: "result",
    why: "each sits on a branch reached only after the gap was cleared; one follows a `throw` that guarantees the ledger exists" },
  { file: "driver/pipeline.mjs", noun: "settled", sites: 5, atWriteSite: 4, verdict: "result",
    why: "counts off the union and the doubt ledger" },
  { file: "driver/pipeline.mjs", noun: "verified", sites: 3, atWriteSite: 1, verdict: "result",
    why: "`rows.filter(r => r.verified).length`, where each row's flag is `srRecords.has(senior.uri)` — a lookup, not a call" },
  { file: "driver/repairs.mjs", noun: "closed", sites: 2, atWriteSite: 1, verdict: "result",
    why: "`effect.closed`, measured against `effect.asked`" },
  { file: "driver/repairs.mjs", noun: "outcome", sites: 1, atWriteSite: 1, verdict: "result",
    why: "#960 already remediated this one and left `outcome` in place beside `dispatch` and `verdict`, so archived rows keep parsing — the sibling remedy this table names" },

  // ── out of scope: a result noun in a module that writes these artifacts, but not at a write site ───
  { file: "driver/ask-ledger.mjs", noun: "executed", sites: 2, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/commonlaw-carry.mjs", noun: "executed", sites: 2, atWriteSite: 0, verdict: "out-of-scope" },
  // added a third: the `packaged` branch of classifyEngineCheckout. Read at the
  // writing site like the other two — it is a returned CLASSIFICATION of a checkout, not a field named
  // for a result whose value is what a call returned, so the verdict is unchanged.
  { file: "driver/engine-build.mjs", noun: "outcome", sites: 3, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/engine/mcp/supplemental.mjs", noun: "executed", sites: 2, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/outbox-backoff.mjs", noun: "outcome", sites: 5, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/portal-service.mjs", noun: "outcome", sites: 2, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/remedy-accounting.mjs", noun: "executed", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/runner.mjs", noun: "recovered", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/skills-store-provenance.mjs", noun: "outcome", sites: 6, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "driver/status-snapshot.mjs", noun: "outcome", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "mcp-server/lib/events.mjs", noun: "recovered", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "mcp-server/lib/ops.mjs", noun: "settled", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "mcp-server/server.mjs", noun: "outcome", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "scripts/backfill-started-at.mjs", noun: "outcome", sites: 5, atWriteSite: 0, verdict: "out-of-scope" },
  { file: "scripts/e2e.mjs", noun: "outcome", sites: 1, atWriteSite: 0, verdict: "out-of-scope" },
]);

/** The verdicts a row may carry. A row outside this set is a typo, not a classification. */
export const VERDICTS = Object.freeze(["result", "invocation", "out-of-scope"]);
