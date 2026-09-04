// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Fix-1 — the closure / frame-reopen top-up lane routes through the DETERMINISTIC plugin-write + code-fold
// (grid_spec_path → plugin writes the supplementary ledger → driver folds via mergeGrids), NEVER an agent
// hand-append of stdout JSON. Reference incident: 2026-07-12 quartz-bastion, where a Haiku common-law-half
// agent, told to "APPEND the supplementary call's stdout JSON … make the file a JSON array", produced
// `…"ps":[]}\n,\n]` into common-law-grid.half-a.json → grid_ledger_unparseable → the code merge re-derived
// half-a's cells as gaps → coverage-closure re-fire → register-digest thrash. The suite MISSED it because
// the mock only ever wrote VALID ledger JSON; these tests inject the exact malformed shape and prove the
// driver no longer depends on any agent-authored ledger JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir, driverRel } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { mergeGrids, parseGridLedger, findGridLedgerViolations, findCoverageLimitedCells, parsePrRiskQueries } from "../common-law-receipts.mjs";
import { validators } from "../verify.mjs";
import { suppLedger, malformedAppend } from "./mock-stage-fixtures.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "clfix-job", msgId: "<clfix@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8480", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
// MOCK_FAIL_STAGE IS IN THIS LIST DELIBERATELY. It used not to be, and a fixture below that throws
// between setting it and clearing it leaked a rigged synthesis into the next two tests, which failed
// with `failedStage: "synthesis"` and nothing in their own setup to explain it. Clearing at the START
// of every run is the only placement a throwing fixture cannot skip.
const KNOBS = ["MOCK_CL_GAPS", "MOCK_CL_APPEND_MALFORMED", "MOCK_FRAME_DIFF", "MOCK_FAIL_STAGE"];

async function run(env, id) {
  const root = mkdtempSync(join(tmpdir(), "clfix-"));
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

const clText = (dir) => readFileSync(join(dir, "common-law-findings.md"), "utf8");
const clValid = (dir) => validators.commonLaw(join(dir, "common-law-findings.md"), clText(dir)).ok;
const hasUnparseable = (events) => events.some((e) => /grid_ledger_unparseable/.test(JSON.stringify(e)));

// ── guard (test c): the append instruction is GONE; the cell arm dictates a driver-written supp spec ─────
test("guard: no lane instructs an agent ledger append; the closure cell arm dictates grid_spec_path", async () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.doesNotMatch(src, /APPEND the supplementary call/, "the agent-authored ledger append is deleted from every lane");
  // dynamic: a split run with closable cells routes the closure followup through a supplementary grid spec
  const { messages } = await run({ MOCK_CL_GAPS: "1" }, "guard");
  const closure = messages.filter((m) => /RESUMING your own common-law session/.test(m) && /supplementary search-as-code grid/.test(m));
  assert.ok(closure.length >= 1, "a closure followup was issued");
  for (const m of closure) {
    assert.match(m, /grid_spec_path:\s*\S+supp-closure\.json/, "the cell arm points grid_spec_path at a driver-written supplementary spec");
    assert.doesNotMatch(m, /APPEND the supplementary call/);
  }
});

// ── (test a): the malformed-append knob is armed but INERT after the fix — the split lane closes clean ──
test("e2e (split): malformed-append knob armed → the deterministic supp closes the gaps; no grid_ledger_unparseable", async () => {
  const { res, events } = await run({ MOCK_CL_GAPS: "1", MOCK_CL_APPEND_MALFORMED: "1" }, "split-knob");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(!hasUnparseable(events), "no unparseable-ledger event — the ledger was never hand-appended");
  const closure = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ requested: closure.requested, closed: closure.closed, remaining: closure.remaining }, { requested: 2, closed: 2, remaining: 0 });
  // the PLUGIN wrote a supplementary ledger sibling; the canonical ledger folds to zero gaps and validates
  assert.ok(readdirSync(res.runDir).some((f) => /supp-closure\.json$/.test(f)), "a supplementary ledger was written by the plugin");
  const canonical = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.equal(canonical.gaps.length, 0, "the fold recomputed the closed gaps away");
  assert.equal(clValid(res.runDir), true, "the merged canonical passes the common-law validator");
  // caveat 4: the supplementary spec omits connotation (the identity join stays at canonical level)
  const suppSpecFile = readdirSync(driverDir(res.runDir)).find((f) => /grid-spec\.half-[ab]\.supp-closure\.json$/.test(f));
  assert.ok(suppSpecFile, "a per-half supplementary grid spec was written");
  assert.ok(!("connotation" in JSON.parse(readFileSync(driverDir(res.runDir, suppSpecFile), "utf8"))), "the supp spec carries NO connotation block");
});

// ── (test a, caveat 1): the NON-SPLIT fold is new code that reshapes the canonical ledger — replay it ──
//
// HOW A RUN STILL REACHES THIS BRANCH. It used to be one env value: CLEAROTRON_COMMONLAW_SPLIT=off.
// item 8 deleted that switch, and the `if (!clSplit)` fold at pipeline.mjs is emphatically NOT dead code
// — it is what a pre-split resume runs, which is a shape production has and the harness had never
// driven. Two conditions have to hold together, and the seed run is built to leave both:
//
//   the assembly is unsplit   a valid common-law-findings.md with no half artifacts beside it, which is
//                             what an older build left behind. The seed splits, merges, and then the
//                             fixture removes the halves.
//   there are cells to close  the seed's OWN closure pass must fail to close them, or the resume finds
//                             nothing closable and the fold never runs. MOCK_CL_APPEND_MALFORMED is
//                             exactly that: the supp ledger comes back unparseable, the driver's fold
//                             skips (by design — closable cells stay disclosed gaps rather than being
//                             silently closed), and the gaps survive into the resume.
//
// So the resume is a run with an unsplit assembly and real closable cells: `!clSplit`, and the fold this
// test was written for. The malformed-append lane it used to also exercise still has its own arms above.
async function runNonSplitClosure(id) {
  const root = mkdtempSync(join(tmpdir(), "clfix-"));
  const callLog = join(root, "calls.jsonl");
  for (const k of KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_REGISTER_RECORD_LOG: join(root, "records.jsonl"), MOCK_CALL_LOG: callLog, MOCK_CLAUDE_CALL_LOG: callLog,
    MOCK_CL_GAPS: "1", MOCK_FAIL_STAGE: "joint synthesis narrative",
  })) pinEnv(process.env, k, v);
  const { pipeline: seedPipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const seed = await seedPipeline({ ...JOB, id });
  assert.equal(seed.ok, false, `the seed must stop after the gather, with a run dir left to resume: ${JSON.stringify(seed)}`);
  assert.ok(existsSync(join(seed.runDir, "common-law-findings.half-a.md")),
    "the seed really SPLIT — if no half exists the surgery below removes nothing and proves nothing");
  const readJournal = (dir) => { try { return readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const seedEvents = readJournal(seed.runDir);
  const { rmSync, writeFileSync } = await import("node:fs");

  // ── THE SURGERY, and why each cut is the shape it is ──────────────────────────────────────────────
  // The FIRST attempt here rigged the seed's own closure to fail so its gaps would survive into the
  // resume. That was wrong about this repository: MOCK_CL_APPEND_MALFORMED corrupts the AGENT's hand
  // append, and the whole point of Fix-1 is that the driver no longer reads that — the plugin-written
  // supp ledger is still valid, the fold still runs, and the seed delivered ZERO gaps. The assertion
  // that caught it is kept below as the precondition.
  //
  // So the grid is made to RE-RUN on the resume instead, single-member, and gap freshly:
  //   remove the half artifacts  — an older build never wrote them
  //   remove the canonical findings — with them present the stage is warm and never re-runs
  //   trim the manifest to ONE variant — `splitTerms < 2` is the `single-term-grid` arm, which is the
  //     OTHER surviving unsplit route and had no test at all. A one-variant manifest cannot be MINTED
  //     (verify.mjs's completeness floor refuses a fresh manifest with no phonetic/visual member), but
  //     a resume READS the manifest off disk rather than re-minting it — which is exactly how a matter
  //     with one variant reaches this branch in production.
  for (const h of ["a", "b", "m"])
    for (const f of [`common-law-findings.half-${h}.md`, `common-law-grid.half-${h}.json`, `common-law-dispositions.half-${h}.json`, driverRel(`grid-spec.half-${h}.json`)])
      rmSync(join(seed.runDir, f), { force: true });
  for (const f of ["common-law-findings.md", "common-law-grid.json", "common-law-dispositions.json"])
    rmSync(join(seed.runDir, f), { force: true });
  // …AND the closure RECEIPT. `alreadyAttempted` keys on a signature of the closable cell set, and the
  // seed gapped the same two cells this resume will, so leaving the receipt makes closure skip itself
  // and the fold never runs — a green that proves nothing. A run whose grid has not been swept does not
  // carry a receipt for having closed it.
  rmSync(driverDir(seed.runDir, "coverage-closure.json"), { force: true });
  const manifestPath = join(seed.runDir, "variant-manifest.md");
  const manifest = readFileSync(manifestPath, "utf8");
  const rows = manifest.split("\n");
  const head = rows.findIndex((l) => /^### Variants/.test(l));
  assert.ok(head >= 0, "the manifest has no Variants heading — this fixture is trimming a shape that moved");
  const dataRows = [];
  for (let i = head; i < rows.length; i += 1) {
    if (/^### /.test(rows[i]) && i > head) break;
    if (/^\| /.test(rows[i]) && !/^\|\s*Value\s*\|/.test(rows[i]) && !/^\|[-\s|]+\|$/.test(rows[i])) dataRows.push(i);
  }
  assert.ok(dataRows.length > 1, `the manifest carries ${dataRows.length} variant row(s) — nothing to trim, so the single-term arm would not be exercised`);
  writeFileSync(manifestPath, rows.filter((_, i) => !dataRows.slice(1).includes(i)).join("\n"));

  delete process.env.MOCK_FAIL_STAGE;
  const codename = seed.runDir.split("/").pop().split("-").slice(3).join("-");
  const { pipeline: resumePipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await resumePipeline({ ...JOB, id }, { codename });
  for (const k of [...KNOBS, "MOCK_CALL_LOG", "MOCK_CLAUDE_CALL_LOG"]) delete process.env[k];
  // A delivered run is ARCHIVED, so read the journal from the dir the RESUME returned, never the seed's.
  return { res, events: readJournal(res.runDir).slice(seedEvents.length) };
}

test("e2e (non-split): the new code fold yields a {cells,extras,gaps} canonical every downstream reader accepts", async () => {
  const { res, events } = await runNonSplitClosure("nosplit-resume");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(events.some((e) => e.event === "common-law-supp-folded" && e.lane === "coverage-closure"),
    "the non-split code fold ran ON THE RESUME — the seed's own rows are sliced off by construction, so this cannot be answered by the split run that seeded it");
  const path = JSON.parse(readFileSync(driverDir(res.runDir, "common-law-path.json"), "utf8"));
  assert.equal(path.path, "unsplit", "…and the run really took the unsplit assembly, which is the precondition the fold branches on");
  assert.equal(path.reason, "single-term-grid",
    "by the route this fixture built — one of the two conditions that still reach the single-member assembly now that #1149 item 8 deleted the switch, and the one with no other test");
  assert.deepEqual(path.members, ["common-law"], "one member, named");
  assert.ok(!hasUnparseable(events));
  const raw = readFileSync(join(res.runDir, "common-law-grid.json"), "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(!Array.isArray(parsed) && Array.isArray(parsed.cells) && Array.isArray(parsed.gaps), "canonical is the single {cells,extras,gaps} object the split path also writes");
  assert.equal(parsed.gaps.length, 0, "the closed cells left the gap set");
  // every downstream ledger reader accepts the reshaped canonical (caveat 1 — verified, not assumed)
  assert.doesNotThrow(() => parseGridLedger(raw));
  const spec = JSON.parse(readFileSync(driverDir(res.runDir, "grid-spec.json"), "utf8"));
  assert.deepEqual(findGridLedgerViolations(spec.terms, raw, { minCellsPerVariant: spec.platforms.length }), [], "the exact join still holds over the folded ledger");
  assert.deepEqual(findCoverageLimitedCells("", raw), [], "no coverage-limited cells survive the fold");
  assert.ok(parsePrRiskQueries(raw) >= 1, "the connotation receipts survive the fold (identity join intact)");
  assert.equal(clValid(res.runDir), true, "the folded canonical passes the common-law validator");
});

// ── the incident's exact mechanism: closure THEN frame-reopen on the same split run ────────────────────
// RUN2 was the interaction, not either lane alone: coverage-closure had closed cells, then a frame-reopen
// re-dispatch ran and the corrupt hand-appended half ledger re-derived the closed cells as gaps → re-fire →
// thrash. Here the supp-closure ledger persists on disk and readHalfLedger re-reads it on EVERY merge, so
// the frame-reopen re-merge must keep the closed cells closed.
test("e2e (split): coverage-closure THEN frame-reopen source — closed cells STAY closed through the reopen re-merge", async () => {
  const { res, events } = await run({ MOCK_CL_GAPS: "1", MOCK_FRAME_DIFF: "source", MOCK_CL_APPEND_MALFORMED: "1" }, "closure-then-reopen");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(!hasUnparseable(events), "no unparseable-ledger event across the combined lanes");
  const closure = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ closed: closure.closed, remaining: closure.remaining }, { closed: 2, remaining: 0 }, "coverage-closure closed the cells");
  const reopen = events.find((e) => e.event === "frame-reopen");
  assert.ok(reopen && reopen.swept >= 1, "the frame-reopen source directive swept (re-dispatched the halves)");
  // the load-bearing assertion: the frame-reopen re-merge did NOT re-open the cells coverage-closure closed
  const grid = JSON.parse(readFileSync(join(res.runDir, "common-law-grid.json"), "utf8"));
  assert.equal(grid.gaps.length, 0, "the reopen re-merge preserved the closed cells (supp-closure re-read each merge) — no re-open, no re-thrash");
});

// ── false-clean guard: a cell the supp did NOT return stays a disclosed plugin-recorded gap ─────────────
test("false-clean guard: a cell the supplementary did NOT return stays a disclosed gap (never silently closed)", async () => {
  const { res, events } = await run({ MOCK_CL_GAPS: "persist" }, "persist-split");
  assert.equal(res.ok, true, JSON.stringify(res));
  const closure = events.find((e) => e.event === "coverage-closure");
  assert.equal(closure.remaining, 2, "the supp did not return the cells → they remain closable, not vanished");
  const canonical = readFileSync(join(res.runDir, "common-law-grid.json"), "utf8");
  assert.ok(findCoverageLimitedCells("", canonical).length >= 2, "the un-returned cells are still plugin-recorded gaps in the canonical ledger");
  const fm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n[\s\S]*?\n---/)[0];
  assert.match(fm, /coverage_note:/, "the surviving gap ships as an honest disclosed limitation");
});

// ── (test b): unit fold — union the closed cell, preserve extras.pr_risk (connotation identity intact) ──
test("unit fold: mergeGrids(main, plugin supp) unions the closed cell and preserves extras.pr_risk", () => {
  delete process.env.MOCK_CL_GAPS;   // suppLedger reads the knob — a closable supp writes the cell, no gap
  const spec = { terms: ["novapulse", "转码"], platforms: ["store", "web"], connotation: { queries: ["novapulse meaning"] } };
  const main = { cells: [
    { term: "novapulse", platform: "store" }, { term: "novapulse", platform: "web" }, { term: "转码", platform: "web" },
  ], extras: { pr_risk: [{ query: "novapulse meaning", results: [] }] }, gaps: ["转码 | store | skipped — batch budget reached"] };
  const supp = JSON.parse(suppLedger({ terms: ["转码"], platforms: ["store"] }));   // NO connotation in a supp
  const merged = mergeGrids(main, supp, { spec });
  assert.equal(merged.gaps.length, 0, "the closed cell left the gap set");
  assert.ok(merged.cells.some((c) => c.term === "转码" && c.platform === "store"), "the plugin supp cell folded into the canonical");
  assert.deepEqual(merged.extras.pr_risk.map((e) => e.query), ["novapulse meaning"], "the connotation receipt is preserved (the supp never re-runs it)");
});

// ── (test d): the load-bearing invariant — a plugin-recorded gap counts as ACCOUNTED ───────────────────
test("invariant pin: a plugin-recorded gap cell counts as accounted by findGridLedgerViolations", () => {
  // novapulse owns 2 platforms: web as a real cell, store as a recorded gap — both accounted, no shortfall.
  const ledger = JSON.stringify({ cells: [{ term: "novapulse", platform: "web" }], extras: {}, gaps: ["novapulse | store | skipped — batch budget reached"] });
  assert.deepEqual(findGridLedgerViolations(["novapulse"], ledger, { minCellsPerVariant: 2 }), [],
    "a recorded gap is accounted — so re-validating the UNCHANGED ledger at the closure stage still passes (fold-after-stage relies on this)");
});

// ── the regression knob has teeth: the injected shape IS the grid_ledger_unparseable corruption ────────
test("regression knob has teeth: the malformed append shape genuinely fails the ledger parse", () => {
  const bad = malformedAppend("grid_spec_path: /studio/prelim-search/x/_driver/grid-spec.json");
  assert.match(bad, /\}\n,\n\]/, "the knob reproduces the exact `}\\n,\\n]` shape from run.jsonl:62");
  assert.throws(() => JSON.parse(bad), "the shape is genuinely malformed JSON");
  assert.throws(() => parseGridLedger(bad), "parseGridLedger rejects it → this is what grid_ledger_unparseable would fire on if any append instruction returned");
});
