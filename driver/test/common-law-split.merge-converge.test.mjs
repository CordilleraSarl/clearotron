// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// commonlaw-merge (2026-07-13): the two half-grid merge paths CONVERGE. The reopen/closure supplementary
// re-merge used to re-derive the canonical pair via mergeCommonLawArtifacts() with NO connotation re-check
// and NO canonical validate — an ungated re-merge that could launder a supplementary fold (or a corrupt
// hand-append) past the gate the fan-in enforces, shipping a "clear" that silently dropped pr_risk
// (connotation) queries. These tests pin the fix:
//   1) the code merge folds a GARBAGE or EMPTY supplementary batch WITHOUT changing the pr_risk count vs the
//      base ledger (the driver owns the append — a corrupt model sweep contributes nothing, never a false-clean);
//   2) the merged canonical the re-merge writes passes validators.commonLaw (the SAME gate the fan-in runs,
//      now reused on every re-merge) AND the per-query connotation identity join has teeth;
//   3) an honestly-recorded NON-SPEC gap row survives the merge (the spec-only recompute no longer erases it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { GRID_HALVES, splitGridTerms, mergeGrids, mergeCommonLawFindings, parsePrRiskQueries,
  findDroppedConnotationQueries } from "../common-law-receipts.mjs";
import { validators } from "../verify.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const SPEC_PLATFORMS = ["store.steampowered.com", "web"];
const SPEC = {
  terms: ["novapulse", "kroma", "转码", "chr0ma"],
  platforms: SPEC_PLATFORMS,
  output_path: "/x/r/common-law-grid.json",
  batch: 14,
  connotation: { queries: ["novapulse slang", "novapulse gang", "kroma meaning", "转码 meaning"] },
  ledger_required: true,
};
const cellsFor = (terms, platforms = SPEC_PLATFORMS) =>
  terms.flatMap((term) => platforms.map((platform) => ({ term, platform, status: "no_hit", results: [] })));
const prRisk = (queries) => queries.map((q) => ({ query: q, results: [] }));

// The two plugin-written half ledgers (both halves complete, every dictated query recorded in its partition).
function baseHalves() {
  const terms = splitGridTerms(SPEC.terms);
  const queries = splitGridTerms(SPEC.connotation.queries);
  return {
    a: { cells: cellsFor(terms.a), extras: { pr_risk: prRisk(queries.a) }, gaps: [] },
    b: { cells: cellsFor(terms.b), extras: { pr_risk: prRisk(queries.b) }, gaps: [] },
  };
}

// ── (1) the driver owns the append: a garbage/empty supplementary fold never moves the connotation count ──
test("mergeGrids: a GARBAGE or EMPTY supplementary batch folded per half never changes the pr_risk count vs base", () => {
  const { a, b } = baseHalves();
  const base = mergeGrids([a], [b], { spec: SPEC });
  const basePr = parsePrRiskQueries(JSON.stringify(base));
  const baseCells = base.cells.length;
  assert.equal(basePr, SPEC.connotation.queries.length, "the base folds every dictated connotation query");
  // Each shape is what a garbage / empty model supplementary sweep degrades to once readHalfLedger has folded
  // it into half a's batch array: a non-object batch, an empty object, an empty ledger, junk array elements,
  // and a pr_risk:[] supp. NONE may add, drop, or duplicate a connotation query or a cell.
  for (const supp of [null, {}, { cells: [], extras: {}, gaps: [] }, 42, "not-json", { extras: { pr_risk: [] } }, [7, "junk"]]) {
    const folded = mergeGrids([a, supp], [b], { spec: SPEC });
    assert.equal(parsePrRiskQueries(JSON.stringify(folded)), basePr,
      `pr_risk count unchanged by a garbage/empty supp (${JSON.stringify(supp)})`);
    assert.equal(folded.cells.length, baseCells, "cells unchanged by a garbage/empty supp");
    assert.deepEqual(findDroppedConnotationQueries(SPEC, folded), [], "no dictated connotation query dropped");
  }
});

// ── (2) CONVERGE: the merged canonical the re-merge writes passes the SAME gate the fan-in runs ──────────
// mergeCommonLawArtifacts now runs validators.commonLaw + findDroppedConnotationQueries on EVERY re-merge
// (fan-in, closure, frame-reopen). This assembles the canonical pair exactly as that code does — the merged
// grid ledger + the concatenated findings + the driver spec on disk — and proves it clears the canonical
// validator (the ungated re-merge could ship a pair the unsplit path would reject; the converged one cannot).
test("merged canonical (grid + findings + spec) clears validators.commonLaw — the re-merge gate the fan-in reuses", () => {
  const { a, b } = baseHalves();
  const merged = mergeGrids([a], [b], { spec: SPEC });
  const dir = mkdtempSync(join(tmpdir(), "clconverge-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(driverDir(dir, "grid-spec.json"), JSON.stringify(SPEC));
    writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(merged));
    const half = (h, terms) => [
      `# Common-law findings — half ${h}`, "",
      "## Findings — Mark: X", "| a | b |", "",
      "### Negative results",
      ...terms.flatMap((t) => SPEC_PLATFORMS.map((p) => `| ${t} | ${p} | No results |`)),
      "",
      "### PR / reputational", "None identified — reads clean.", "",
      "### Coverage ledger", "| unit | confirmed-clean | full |", "",
      "### Audit trail", "| 1 | grid | cells | ok |", "",
    ].join("\n") + "x".repeat(200);
    const terms = splitGridTerms(SPEC.terms);
    const findings = mergeCommonLawFindings(GRID_HALVES.map((h) => ({ half: h, content: half(h, terms[h]), error: null })));
    const p = join(dir, "common-law-findings.md");
    writeFileSync(p, findings);
    const v = validators.commonLaw(p, findings);
    assert.deepEqual(v, { ok: true, reason: "machine-receipts" },
      "the merged canonical passes the exact join, platform identity AND the connotation receipt");
    // the connotation completeness half of the re-merge gate is clean on a full merge …
    assert.deepEqual(findDroppedConnotationQueries(SPEC, merged), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("findDroppedConnotationQueries: the re-merge's connotation half-gate catches a query the fold never recorded", () => {
  // half b quarantined (null ledger): its partition's dictated meaning queries never ran. The count-based
  // gate stays satisfied (half a's receipts keep it > 0) — the identity join is what makes the re-merge fail-closed.
  const { a } = baseHalves();
  const merged = mergeGrids([a], null, { spec: SPEC, halfErrors: { b: "half-b did not complete: timeout" } });
  assert.ok(parsePrRiskQueries(JSON.stringify(merged)) > 0, "count-based gate blind — exactly the hole under test");
  assert.deepEqual(findDroppedConnotationQueries(SPEC, merged), splitGridTerms(SPEC.connotation.queries).b,
    "every dictated query half b owned reads as dropped — the re-merge gate would reject this pair");
});

// ── (3) UNION non-spec gap rows: the spec-only gap recompute no longer erases an honestly-recorded gap ────
test("mergeGrids: an honestly-recorded NON-SPEC gap row survives the merge (spec-only recompute no longer erases it)", () => {
  const { a, b } = baseHalves();
  // half a honestly records a gap for a cell OUTSIDE the canonical spec: a re-keyed variant ("chr0m4", not in
  // SPEC.terms) and an extra platform ("nuget.org", not in SPEC.platforms) it legitimately swept-and-missed.
  const aWithNonSpec = { ...a, gaps: [
    "chr0m4 | nuget.org | HTTP 503 — could not complete",           // non-spec term AND platform
    { term: "novapulse", platform: "npmjs.org", error: "rate-limited" }, // spec term, non-spec platform (object form)
  ] };
  const merged = mergeGrids([aWithNonSpec], [b], { spec: SPEC });
  const nonSpec1 = merged.gaps.find((g) => g.term === "chr0m4" && g.platform === "nuget.org");
  const nonSpec2 = merged.gaps.find((g) => g.term === "novapulse" && g.platform === "npmjs.org");
  assert.ok(nonSpec1, "the non-spec (term × platform) gap row survives the merge");
  assert.match(nonSpec1.error, /HTTP 503/, "it carries the half's honestly-recorded program error");
  assert.ok(nonSpec2, "a spec-term / non-spec-platform gap survives too (object gap form)");
  assert.match(nonSpec2.error, /rate-limited/);
  // the spec cells still recompute exactly as before (a full grid → no spec gaps), so the union only ADDS
  const specKeys = new Set(SPEC.terms.flatMap((t) => SPEC_PLATFORMS.map((p) => `${t}|${p}`)));
  assert.ok(merged.gaps.every((g) => g.term === "chr0m4" || g.platform === "npmjs.org" || specKeys.has(`${g.term}|${g.platform}`)),
    "no phantom spec gap invented");
  // a NON-spec gap whose cell IS present in cells[] must still drop (a stale gap a supp closed), same as spec cells
  const closed = mergeGrids([{ ...aWithNonSpec, cells: [...a.cells, { term: "chr0m4", platform: "nuget.org", status: "no_hit", results: [] }] }], [b], { spec: SPEC });
  assert.ok(!closed.gaps.some((g) => g.term === "chr0m4" && g.platform === "nuget.org"),
    "a non-spec gap whose cell got covered is dropped (cells[] still wins)");
});

// ── (4) e2e convergence: split closure THEN frame-reopen — the concurrent half followups re-merge to a
//        canonical that CLEARS validators.commonLaw (the reopen/closure re-merge is now gated, not ungated) ──
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const JOB = {
  id: "clconv-job", msgId: "<clconv@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8481", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const KNOBS = ["MOCK_CL_GAPS", "MOCK_FRAME_DIFF"];

async function run(env, id) {
  const root = mkdtempSync(join(tmpdir(), "clconv-"));
  const callLog = join(root, "calls.jsonl");
  for (const k of KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_REGISTER_RECORD_LOG: join(root, "records.jsonl"), MOCK_CALL_LOG: callLog, MOCK_CLAUDE_CALL_LOG: callLog, ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, id });
  for (const k of [...KNOBS, "MOCK_CALL_LOG", "MOCK_CLAUDE_CALL_LOG"]) delete process.env[k];
  const read = (p) => { try { return readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };
  const events = read(driverDir(res.runDir, "run.jsonl"));
  const messages = read(callLog).map((e) => Array.isArray(e) ? (e[e.indexOf("--message") + 1] ?? "") : (e.prompt ?? ""));
  return { res, events, messages };
}

test("e2e (split): coverage-closure THEN frame-reopen — the gated re-merge ships a canonical that passes validators.commonLaw", async () => {
  process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
  const { res, events, messages } = await run({ MOCK_CL_GAPS: "1", MOCK_FRAME_DIFF: "source" }, "conv");
  assert.equal(res.ok, true, JSON.stringify(res));   // the in-function re-merge gate did NOT false-fail the happy path
  // concurrency: BOTH half followups were dispatched (each targets its own half findings file)
  for (const h of GRID_HALVES)
    assert.ok(messages.some((m) => new RegExp(`common-law-findings\\.half-${h}\\.md`).test(m) && /RESUMING your own common-law session/.test(m)),
      `a half-${h} common-law followup was issued`);
  // the re-merge ran more than once (fan-in + at least one supplementary re-merge), each now gated
  assert.ok(events.filter((e) => e.event === "common-law-merged").length >= 2, "the re-merge fired on a supplementary lane, not only fan-in");
  // the load-bearing convergence assertion: the FINAL canonical the reopen/closure re-merge wrote is valid
  const p = join(res.runDir, "common-law-findings.md");
  const v = validators.commonLaw(p, readFileSync(p, "utf8"));
  assert.equal(v.ok, true, `the merged canonical clears the canonical validator (${v.reason})`);
  // and no connotation query silently vanished across the re-merges
  const grid = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  const spec = JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8"));
  assert.deepEqual(findDroppedConnotationQueries(spec, grid), [], "every dictated connotation query survived every re-merge");
});
