// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — coverage_judgment.rows IS WRITTEN BY THE DRIVER.
//
// The dictation invited synthesis to author "one typed row per slice you weighed". The rows that name
// which slices are still open — the facts a reader checks a sufficiency call against — were therefore
// prose the model retyped out of a coverage ledger it had never been shown ('s other half: the
// ledger reached the reviewer as a table and the author not at all). That is the transcription
// contract one artifact over, and 's answer applies unchanged: remove the contract, not the elision.
// The driver holds the ledger and the plan-execution receipt; it writes the rows. What stays the model's
// is the part that cannot be derived — `sufficient`, and the `reason` for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { chmodSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { paths, STAGES, REGISTER_AXES } from "../stages.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { joinPlanToBands, deriveCoverageSkeleton } from "../register-plan.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// The mock-run harness (offline, no billable call). Env before the pipeline import — driver.config
// reads it at import — which is why this one import is dynamic.
const HERE = dirname(fileURLToPath(import.meta.url));
chmodSync(join(HERE, "mock-claude.mjs"), 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "prelim-447cj-mock-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_RECALL_PROBES ||= "0";

const PL = await import("../pipeline.mjs");
const { coverageJudgmentRows, stampCoverageJudgmentRows } = PL;

// The same plan/band pair the structural-input tests derive their receipt from: three planned entries,
// one of which the funnel produced no band block for. Derived through the production join rather than
// hand-typed, so the receipt has the shape a run writes and not the one this test imagined.
const PLAN = {
  schema_version: 1, plan_version: 3, nice_classes: ["5"], regions: ["US", "GB"], provider: "corsearch",
  entries: [
    { qid: "primary-sweep:exact:venzy", nice_classes: ["5"], regions: ["US"], axis: "primary-sweep", predicate: "exact", term: "VENZY", expected_kind: "enumerate" },
    { qid: "primary-sweep:wildcard:venz", nice_classes: ["5"], regions: ["US"], axis: "primary-sweep", predicate: "wildcard", term: "VENZ*", expected_kind: "enumerate" },
    { qid: "incumbent-class:owner:muster", nice_classes: ["5"], regions: ["GB"], axis: "incumbent-class", predicate: "owner", term: "Muster Handels GmbH & Co. KG", expected_kind: "count" },
  ],
};
const BANDS = {
  "primary-sweep": [
    { qid: "primary-sweep:exact:venzy", state: "enumerated", records: [] },
    { qid: "primary-sweep:wildcard:venz", state: "incomplete", records: [] },
  ],
  "incumbent-class": [],
};
const MISSING_QID = "incumbent-class:owner:muster";
const RECEIPT = (() => { const j = joinPlanToBands(PLAN, BANDS); return { plan_version: 3, ...j, skeleton: deriveCoverageSkeleton(PLAN, j) }; })();

const LEDGER = [
  { axis: "saturation-probe", scope: "macro count", status: "confirmed-clean", reason: "paged to has_more:false" },
  { axis: "primary-sweep", scope: "VENZ* wildcard, cl. 5, US", status: "coverage-limited", reason: "count-only, saturated" },
  { axis: "incumbent-class", scope: "owner probe, cl. 5, GB", status: "deferred", reason: "the provider produced no band block for this query" },
];

// A findings document in the emitted shape, taken from the mock's own synthesis fixture — the artifact
// the whole mock suite validates against — rather than a minimal object written to satisfy the parser.
const { synthesisFindings } = await import("./mock-stage-fixtures.mjs");
const baseDoc = (cj) => {
  const doc = JSON.parse(synthesisFindings(null, ""));
  if (cj === undefined) delete doc.coverage_judgment; else doc.coverage_judgment = cj;
  return doc;
};

function runDirWith(doc, { ledger = LEDGER, receipt = RECEIPT } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "prelim-447cj-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  if (ledger) writeFileSync(join(runDir, "register-coverage-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  if (receipt) writeFileSync(driverDir(runDir, "plan-execution.json"), JSON.stringify(receipt, null, 2) + "\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify(doc, null, 2) + "\n");
  return runDir;
}
const readBack = (runDir) => JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8"));
const stamp = (runDir) => stampCoverageJudgmentRows(paths(runDir), runDir, () => {}, { paths: paths(runDir) });

// ── 1. THE DERIVATION, AND THE JOIN ────────────────────────────────────────────────────────────────
const LEDGER_UNITS = LEDGER.map((r) => ({ ...r, unit: `${r.axis} / ${r.scope}` }));

test("#447: the rows are derived from BOTH sources, and a slice that both describe is disclosed ONCE", () => {
  const rows = coverageJudgmentRows(LEDGER_UNITS, RECEIPT);

  assert.deepEqual(rows.map((r) => r.area), [
    "primary-sweep / VENZ* wildcard, cl. 5, US",
    "incumbent-class / owner probe, cl. 5, GB",
  ], "one row per NOT-confirmed-clean ledger row — a confirmed-clean row IS the absence of a disclosure — and NO second row for the missing qid, whose axis already owns an open row");

  assert.match(rows[0].note, /^coverage-limited — count-only, saturated$/,
    "the note carries the ledger's own status and its own reason, not a paraphrase of them");

  // The missing qid is not dropped, it is NAMED on the row that already describes its axis. Rendered,
  // the un-joined pair read as the same fact twice in two vocabularies — "incumbent-class / owner probe:
  // deferred — the provider produced no band block for this query; incumbent-class:owner:muster: planned
  // and not executed this run — the funnel produced no band block for this query" — which is what the
  // stage's own COVERAGE PROSE rule forbids: state each coverage fact ONCE, in ONE place.
  assert.match(rows[1].note, /^deferred — .*\(no band block for: incumbent-class:owner:muster\)$/,
    "the qid rides VERBATIM on the ledger row for its own axis — every gate joins on it, and a shortened one is a row nobody can match back");

  // An axis with NO open ledger row still discloses its missing qid on its own — otherwise nothing
  // would, which is the silence exists to end.
  const orphan = coverageJudgmentRows(
    [{ axis: "primary-sweep", unit: "primary-sweep / all", status: "confirmed-clean", reason: "full" }], RECEIPT);
  assert.deepEqual(orphan.map((r) => r.area), [MISSING_QID],
    "a missing qid whose axis carries no open row gets a row of its own");
  assert.match(orphan[0].note, /planned and not executed this run/);

  // The join is the RECEIPT'S OWN axis map, never a guess off the qid string: `supp:` and `xcheck-`
  // entries carry prefixes that are not axes, so a prefix split would host them under nothing.
  const noSkeleton = coverageJudgmentRows(LEDGER_UNITS, { missing: [MISSING_QID] });
  assert.equal(noSkeleton.length, 3,
    "a receipt with no skeleton has no axis map, so every missing qid gets its own row — over-disclosing, never under-disclosing");

  // A run with nothing open produces NO rows: an empty rows[] is a fact about the run, never a
  // derivation that quietly gave up.
  assert.deepEqual(coverageJudgmentRows([{ axis: "primary-sweep", unit: "primary-sweep / all", status: "confirmed-clean", reason: "full" }], { missing: [], skeleton: [] }), [],
    "a fully clean run yields no rows at all");
});

// ── 2. THE STAMP REPLACES WHAT THE MODEL TYPED ─────────────────────────────────────────────────────
test("#447: model-authored rows are replaced wholesale, and the result still parses strictly", () => {
  const runDir = runDirWith(baseDoc({
    sufficient: true, reason: "the dangerous subset is enumerated and cleared",
    // What a synthesis authored under the old dictation, and the exact failure mode: a slice named
    // in words that join to nothing, over a ledger row that says the opposite.
    rows: [{ area: "the GB incumbent-class sweep", note: "searched clean" }],
  }));
  stamp(runDir);
  const out = readBack(runDir);

  assert.equal(out.coverage_judgment.sufficient, true, "the lawyer's call is untouched");
  assert.equal(out.coverage_judgment.reason, "the dangerous subset is enumerated and cleared", "and so is the reason for it");
  assert.deepEqual(out.coverage_judgment.rows.map((r) => r.area),
    ["primary-sweep / VENZ* wildcard, cl. 5, US", "incumbent-class / owner probe, cl. 5, GB"],
    "the authored rows are gone and the derived ones are in their place");
  assert.ok(JSON.stringify(out.coverage_judgment.rows).includes(MISSING_QID),
    "and the qid that never ran is still on the record, named on its own axis's row");
  assert.ok(!JSON.stringify(out.coverage_judgment.rows).includes("searched clean"),
    "a claim the ledger contradicts does not survive the stamp");

  parseFindingsJson(JSON.stringify(out));   // throws on any shape defect — the write is re-validated before it lands
});

// ── 3. ABSENT STAYS ABSENT ─────────────────────────────────────────────────────────────────────────
//
// `sufficient` clamps CLEAR→CONDITIONAL. Inventing a coverage_judgment where synthesis emitted none
// would put a verdict-moving field on nobody's judgment, which is a worse defect than the one this
// closes.
test("#447: a run whose synthesis emitted no coverage_judgment does not get one invented", () => {
  const runDir = runDirWith(baseDoc(undefined));
  const before = readFileSync(join(runDir, "findings.json"), "utf8");
  stamp(runDir);
  assert.equal(readFileSync(join(runDir, "findings.json"), "utf8"), before,
    "the file is byte-identical — no judgment is fabricated, and the absence is logged instead");
  assert.equal(readBack(runDir).coverage_judgment, undefined);
});

// ── 4. NOTHING OPEN ⇒ NO ROWS KEY ──────────────────────────────────────────────────────────────────
test("#447: on a run with nothing open, an authored rows[] is REMOVED rather than left standing", () => {
  const runDir = runDirWith(
    baseDoc({ sufficient: true, reason: "complete", rows: [{ area: "cl. 5 GB", note: "a slice the ledger does not carry" }] }),
    { ledger: [{ axis: "primary-sweep", scope: "all", status: "confirmed-clean", reason: "full" }], receipt: { plan_version: 3, executed: [], missing: [], skipped: [], deferred: [], skeleton: [] } });
  stamp(runDir);
  const out = readBack(runDir);
  assert.ok(!("rows" in out.coverage_judgment),
    "a row the machine cannot derive is not a row — leaving it would ship an open slice that nothing on disk says is open");
  assert.equal(out.coverage_judgment.sufficient, true);
});

// ── 5. NEVER-KILL, AND WHAT A CORRUPT SOURCE ACTUALLY COSTS ────────────────────────────────────────
test("#447: an unreadable findings.json leaves the bytes alone instead of failing the delivery", () => {
  const runDir = runDirWith(baseDoc({ sufficient: true, reason: "complete" }));
  writeFileSync(join(runDir, "findings.json"), "{ truncated mid-writ");
  const before = readFileSync(join(runDir, "findings.json"), "utf8");
  stamp(runDir);
  assert.equal(readFileSync(join(runDir, "findings.json"), "utf8"), before,
    "the findings parser owns that failure; this stamp never takes a delivery down with it");
});

// A corrupt LEDGER is a different story and the difference is worth pinning, because it is the one
// place this mechanism degrades silently. `loadCoverageLedger` is the shared choke point and its
// documented behaviour is to fall back to the prose table rather than throw — "the validator owns that
// failure" — so with no prose either, the ledger half of the row set is simply empty. The receipt half
// still lands. That is the correct degradation (every coverage consumer degrades the same way) but it
// is a HALF row set, and this test exists so that stops being a surprise.
test("#447: a corrupt ledger costs the ledger half of the rows and keeps the receipt half", () => {
  const runDir = runDirWith(baseDoc({ sufficient: true, reason: "complete" }));
  writeFileSync(join(runDir, "register-coverage-ledger.json"), "{ this is not json");
  stamp(runDir);
  assert.deepEqual(readBack(runDir).coverage_judgment.rows.map((r) => r.area), [MISSING_QID],
    "the qid that never ran is still disclosed — the receipt is a separate artifact and does not go with the ledger");
});

// ── 6. THE INVITATION IS DELETED, NOT MADE OPTIONAL ────────────────────────────────────────────────
//
// A dictation that still offers the key is a dictation a model will still fill in, and the driver would
// then be silently overwriting work someone was asked for. The two-level rule: the skills teach
// `{sufficient, reason}` and so does this.
test("#447: the synthesis dictation no longer invites rows[] and says who writes it", () => {
  const P = paths("/RUN");
  const job = { marks: [{ name: "VENZY", classes: [5] }], markName: "VENZY", name: "PROJECT K", classes: [5], ref: "TMP447", customer: "ACME", goods: "supplements", forwarder: "jordan", msgId: "<m>" };
  const msg = STAGES.synthesis.message({ paths: P, job, axes: REGISTER_AXES, registerOnly: false, agent: "clawdi", run: { slug: "s", codename: "c" } });

  const block = msg.match(/COVERAGE JUDGMENT \(MANDATORY[\s\S]*?Decide it on the RISK PICTURE/);
  assert.ok(block, "the coverage-judgment dictation is still there");
  assert.ok(!/optionally "rows"/.test(block[0]),
    "the old invitation is DELETED — an offered key is a key a model fills in, and the driver would then be overwriting asked-for work");
  assert.match(block[0], /Do NOT emit "rows": the driver writes that register itself/,
    "and the dictation says who writes it and from what");
  assert.match(block[0], /the machine writes the row, you rule on it/,
    "stating the division this whole programme turns on");
});

// ── 6b. AND SO DOES THE REPAIR HINT THE SAME SEAT READS ────────────────────────────────────────────
//
// review. The gateway's findings.json hint is what the model reads at the moment a findings_*
// token fails — the ONE turn where it is most likely to re-add a field the driver took. It still listed
// `coverage_judgment.rows[]` among the keys schema_version 5 "additionally allows", so the seat held
// the dictation's "Do NOT emit rows" and the repair turn's "you may" at the same time, and a corrective
// dispatch spent on writing rows is a dispatch spent writing something overwritten wholesale. b0ac330
// fixed this exact drift 271 lines below in the same function and left this arm on the old contract.
test("#447 review: the findings.json repair hint teaches the same rows[] contract as the dictation", async () => {
  const { correctionHint } = await import("../gateway.mjs");
  const hint = correctionHint("invalid_file:/run/findings.json:findings_coverage_judgment_rows_invalid");
  assert.ok(hint, "the findings.json arm still produces a hint");
  assert.ok(!/allows[\s\S]*coverage_judgment\.rows\[\]/.test(hint),
    "rows[] is no longer advertised as a key the model may emit");
  assert.match(hint, /coverage_judgment carries EXACTLY \{ sufficient, reason \} from you/,
    "the hint states the contract the dictation states");
  assert.match(hint, /do NOT emit[\s\S]*"rows"/,
    "and names the field the driver owns, on the turn the seat is most likely to re-add it");
});

// ── 7. AND THE PIPELINE ACTUALLY CALLS IT ──────────────────────────────────────────────────────────
//
// Everything above drives the stamp directly. None of it can see the CALL SITE: delete the line from the
// post-synthesis mutator seam and every assertion above stays green while no run ever writes a row. So
// this one runs a real (mocked, offline) delivery and reads the run journal, which records the decision
// on every run — including the runs where the derived set was already exact, because "already matched"
// and "never ran" are different facts and only one of them is a defect.
test("#447: a real delivered run records the stamp's decision in its own journal", async () => {
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_COVERAGE_INSUFFICIENT = "1";   // so the run HAS a coverage_judgment for the stamp to rule on
  // review — THE RUN MUST ACTUALLY PRODUCE ROWS. Without this knob every ledger row comes back
  // `confirmed-clean`, the derived set is empty, the stamp writes nothing (changed:false) and the
  // delivered coverage_judgment carries no `rows` key at all — so the per-row loop below ran ZERO
  // times and asserted nothing. The one test in either new file that drives a real delivery, and the
  // one the build report nominates as load-bearing, was pinning the call site and nothing else.
  process.env.MOCK_LEDGER_LIMITED = "incumbent-class";
  const job = { id: "job-TMP447CJ", msgId: "<tmp447cj@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMP447CJ", markName: "MARK TMP447CJ", classes: [9, 41], provider: "corsearch" };
  const res = await PL.pipeline(job);
  delete process.env.MOCK_COVERAGE_INSUFFICIENT;
  delete process.env.MOCK_LEDGER_LIMITED;
  assert.equal(res.ok, true, "the mock run must deliver for this to be reading a delivered findings.json");

  const dir = res.archiveDir ?? res.runDir;
  const rows = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((r) => r.event === "coverage-judgment-rows");
  assert.equal(rows.length, 1, "the stamp runs exactly once per delivery, at the post-synthesis mutator seam");
  assert.equal(rows[0].judgment, true, "it saw the run's coverage judgment");
  assert.equal(rows[0].changed, true, "and it actually WROTE — a run where the stamp is a no-op tests the call site and nothing else");

  // The delivered file is what a reader gets: whatever rows[] it carries came from the ledger and the
  // receipt, never from the seat. Asserted by VALUE — "area is a non-empty string" is satisfied just as
  // well by a model-authored row, so it could never have told the two apart.
  const cj = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).coverage_judgment;
  assert.equal(cj.sufficient, false, "the lawyer's sufficiency call survives the stamp untouched");
  // — each row now carries `areaLabel` beside the identifier. `area` is UNCHANGED and is still
  // what every gate joins on; the label is what the page prints, emitted by the driver at the one place
  // the area is minted, so no client-facing string is ever rewritten by pattern.
  assert.deepEqual(cj.rows, [
    { area: "incumbent-class (entire axis)", areaLabel: "owner portfolio sweep (all of it)",
      note: "coverage-limited — yielded to ring-fenced jurisdiction budget" },
    { area: "incumbent-class / extra script group", areaLabel: "owner portfolio sweep / extra script group",
      note: "coverage-limited — yielded to ring-fenced jurisdiction budget" },
  ], "the delivered rows are the LEDGER's, verbatim — the derived set survives consolidateFindingsFile and publish intact");

  // The whole-axis row says so. A ledger unit collapses to the bare axis when the row carries no scope,
  // and `projectCoverageJudgment` folds these straight into the coverage reason that render.mjs prints
  // in report.html — so a lone engine token there is what a client reads.
  assert.ok(cj.rows.some((r) => r.area === "incumbent-class (entire axis)"),
    "a scopeless ledger row names its scope rather than collapsing to a bare axis token");
  assert.ok(!cj.rows.some((r) => r.area === "incumbent-class"),
    "and the bare token is not what ships");

  // AND ON THE RENDERED SURFACE. Every other assertion in both new files stops at findings.json, so a
  // change that reads fine as JSON and badly as prose would pass all of them. `projectCoverageJudgment`
  // folds rows[] into the reason string and render.mjs prints it as "Coverage read (internal)" inside
  // report.html — which, under the one-report rule, is the report the client gets.
  const poolRun = readdirSync(join(ROOT, "pool")).find((d) => d.includes("tmp447cj"));
  assert.ok(poolRun, "the delivered run publishes into the pool — that is the copy a reader opens");
  const html = readFileSync(join(ROOT, "pool", poolRun, "report.html"), "utf8");
  const cov = /Coverage read \(internal\):<\/b>([^<]*)/.exec(html);
  assert.ok(cov, "the delivered report carries the coverage read line the rows fold into");
  // RE-POINTED (, second pass). The property is unchanged — a scopeless row still reaches the reader
  // saying it covers the whole thing — but the words are no longer the engine's. `plainify` translates the
  // four closed axis identifiers at the render choke point, because a delivered report.html put
  // "primary-sweep", "transliteration-numeric" and "slices" in front of a lawyer. The identifier survives
  // where it is joined on (the deepEqual on cj.rows above, unchanged); only the surface changes.
  // RE-POINTED AGAIN. The property is unchanged — a scopeless row reaches the reader saying it
  // covers the whole thing — but it now arrives as a FIELD the driver emitted rather than as a
  // substitution run over the rendered page. "(entire axis)" survives verbatim inside the label,
  // because `coverageUnitLabel` rewrites the axis HEAD and nothing else: the tail is where a mark
  // appears, and is what rewriting the tail costs.
  assert.match(cov[1], /owner portfolio sweep \(all of it\): coverage-limited/,
    "the whole-axis row reaches the reader saying it is the whole thing, not as a bare engine token");
  assert.match(cov[1], /owner portfolio sweep \/ extra script group: coverage-limited/,
    "and a scoped row keeps the scope the ledger gave it");
  assert.ok(!/incumbent-class/.test(cov[1]),
    "…and the engine identifier that scope was derived from is not on the page");
});
