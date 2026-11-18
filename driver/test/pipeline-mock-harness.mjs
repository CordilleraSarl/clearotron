// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The mock-pipeline harness the pipeline.mock test files share: the environment a hermetic mock run needs, the seeded
// customer store, the job, `runPipeline` and the helpers more than one file uses. Importing it sets that environment,
// so a test file imports it before anything that reads it. Every run is billable-call-free (mock engine).
// THE AGENT IS PINNED BECAUSE THE PATH IS THE AGENT'S (ruling 563). The studio paths these fixtures
// build resolve under `config.defaultAgent`, which reads CLEAROTRON_DEFAULT_AGENT. Until that ruling one
// agent was named as a literal instead, so a fixture spelling that same word matched by coincidence and
// nothing said which of the two decided — CLEAROTRON_AGENT is read by nothing in the shipped tree.
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir, driverRel } from "../../shared/driver-dir.mjs";
import { fileURLToPath } from "node:url";
import { MEANING_SEAT } from "../common-law-receipts.mjs";

// The pool's public base URL is deployment config with NO placeholder default — unset ⇒ publishReport
// omits the link and status.url is null. These tests assert a delivered run carries a report link, so they
// stand on a configured deployment.
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");

export const HERE = dirname(fileURLToPath(import.meta.url));
// A run dir under the archive, with either separator: on Windows the path the pipeline returns is native.
export const ARCHIVED = /[\\/]archive[\\/]/;
// recursively find the first file named `name` under `root` (best-effort — null if none / unreadable).
// The recursive listing is in native separators, so the last segment is split on either: matched on "/"
// alone, a Windows run finds no nested file and the absence arm below passes having looked at nothing.
export function findFile(root, name) {
  try { const hit = readdirSync(root, { recursive: true }).find((p) => String(p).split(/[\\/]/).pop() === name); return hit ? join(root, hit) : null; }
  catch { return null; }
}
export const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// repair-first: the fan-in plan-direct-execute repair would otherwise call the REAL provider adapter
// (network) when a mock run drops a dictated qid — off by default here; tests that exercise the repair
// inject opts.planExecutor, which takes precedence over this gate.
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
// The register-gap clamp is OFF in THIS legacy harness: several fixtures deliberately ship an unclosed
// deferred row (pre-clamp shapes) and assert non-verdict behaviour. The dedicated
// pipeline.mock.registergap.test.mjs file (own process, own root) exercises the clamp ON.
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// spec 62 (per-project config): the shipped profiles/ carries the demo customers but no project overlays.
// Seed a CLEAROTRON_CUSTOMERS_DIR copy of the real profiles/ dir plus a projects/demo-brand-owner/japan-and-korea-app-launch.json
// overlay so the project path runs end-to-end. Set BEFORE the first pipeline import — profiles.mjs freezes
// its PROFILE_DIR when the module first loads (the same first-import freeze the workspaceRoot notes below
// describe), and this file only imports the pipeline lazily inside runPipeline.
export const PROFILES_SEED = mkdtempSync(join(tmpdir(), "clearotron-profiles-"));
cpSync(join(HERE, "..", "profiles"), PROFILES_SEED, { recursive: true });
mkdirSync(join(PROFILES_SEED, "projects", "demo-brand-owner"), { recursive: true });
writeFileSync(join(PROFILES_SEED, "projects", "demo-brand-owner", "japan-and-korea-app-launch.json"), JSON.stringify({
  projectName: "Japan and Korea app launch",
  platforms: ["store.steampowered.com", "store.epicgames.com", "play.google.com", "apps.apple.com",
    "gog.com", "itch.io", "mobygames.com", "humblebundle.com", "gamejolt.com"],
}, null, 2) + "\n");
// A company that picked no marketplaces (the owner's ruling of 2026-09-23): an empty list, which loads.
writeFileSync(join(PROFILES_SEED, "harbour-goods.json"), JSON.stringify({
  name: "Harbour Goods", matchDomains: ["harbour-goods.example"], platforms: [],
}, null, 2) + "\n");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES_SEED);

export const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// Fresh module graph + env per run (driver.config reads env at import time).
export async function runPipeline(env, jobPatch = {}, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  // hermetic: clear the mock knobs so one test's MOCK_* never bleeds into the next (env is process-global).
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED", "MOCK_SEAT_DEFERS", "MOCK_LEDGER_LIMITED", "MOCK_SEARCH_FLOOR", "MOCK_CANDSELF", "MOCK_NO_GRID_LEDGER", "MOCK_CL_SHORT", "MOCK_CL_GAPS", "MOCK_CL_MISSING_QUERIES", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER", "MOCK_UNPARSEABLE_LEDGER", "MOCK_WRITE_RECORD", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF", "MOCK_NO_BLIND_MODEL", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_BAND_COLLAPSED", "MOCK_PLAN_DROP_QID", "MOCK_PLAN_DROP_STICKY", "MOCK_PLAN_DEFERRED", "MOCK_PLAN_HARD_ERROR", "MOCK_DEGENERATE_HEALS", "MOCK_VERDICT_DEFECTS", "MOCK_BAD_FINDING", "MOCK_MULTI_LEG", "MOCK_ACTIONS", "MOCK_ASK_ANSWER_BAD", "MOCK_FINDINGS_N", "MOCK_STAGE_TRACE", "MOCK_STAGE_DELAY_MS", "MOCK_MEANING_ANGLES", "MOCK_PR_RESULTS", "MOCK_CL_UNDISPOSED", "MOCK_NARRATIVE_RECO", "MOCK_REPORT_URI", "CLEAROTRON_REGISTER_RECORD_LOG", "CLEAROTRON_REGISTER_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent", ...env })) pinEnv(process.env, k, v);
  await opts.seed?.(root);   // config is all getters now (access-time env) — seed INSIDE this run's root
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, root, events };
}
export const stageOrder = (events) => events.filter((e) => e.event === "stage").map((e) => e.stage);

// studioRoot is the stable ".../studio/clearance-search" prefix of any run-dir (live or archived). Derive it
// from res.runDir (config.workspaceRoot is frozen at first import, so the per-test `root` can't be trusted).
// Matched with either separator, since the run dir is a native path.
export const MARKER = /[\\/]studio[\\/]clearance-search/;
export const studioRootOf = (runDir) => { const m = MARKER.exec(runDir); return runDir.slice(0, m.index + m[0].length); };

// ── envelope-settle: a refused slice is DECIDED at the receipt, not two expensive stages later ─────────
// MOCK_PLAN_DEFERRED makes the executor refuse a dictated slice the way a real capability gap arrives —
// error:true beside deferred:true, nothing dispatched — so joinPlanToBands routes it to the receipt's
// `deferred[]` and the run has to decide about it. The pure functions are pinned in
// provider-hard-error-deferral.test.mjs and a-capability-gap-is-decided-once-per-run.test.mjs; what these
// pin is the ORDER, the DURABILITY and the reach across digest passes, none of which a pure function can
// show. The knob targets a PRIMARY-SWEEP slice deliberately: that axis has sixteen other entries, so the
// plan does not defer it end to end and `accepted` can only come from the reason text matching
// isCapabilityGapReason — a fully-deferred axis is accepted whatever its reason says, which would let a
// broken reason string pass. (That held only once the partition asked the plan, fullyDeferredAxes, rather
// than the coverage skeleton, which marks an axis `deferred` for any single deferral.)
export const DEFERRED_SLICE = "+merch";

// ── Fix 2 (close-the-loop, arm #1): the register frame-reopen code-dispatch VERIFIES the intended search ──
// The blind spot the RUN1 project-halcyon false-close exploited: the mock executor only ever produced the
// RIGHT search, so a byte-diff always looked like a genuine close. These fixtures simulate the WRONG search
// (a wrong-class 0/0 enumerated block) reaching the band, and assert the close is NOT falsely swept.

// A planExecutor that writes controlled band blocks for the minted qids. `classesFor(call)` picks the
// class tag the block records (the [cl …] describePlanEntry writes); records=[] + total_hits=0 makes it an
// evidentially-empty 0/0 that byte-changes the band but must not count as a close on the wrong scope.
export function fieldGapExecutor(scriptFn) {
  const calls = [];
  const planExecutor = async ({ planPath, axis, outputPath, qids }) => {
    const n = calls.length + 1;
    const { cls, hasRecords } = scriptFn(n);
    calls.push({ n, axis, qids, cls });
    const blocks = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : [];
    for (const qid of qids) {
      const i = blocks.findIndex((b) => b && b.qid === qid);
      const block = { state: "enumerated", qid, query: `exact NOVAPULSE [cl ${cls.join(",")}]`,
        total_hits: hasRecords ? 2 : 0,
        records: hasRecords ? [{ record_id: `/mark/us/${qid.slice(-6)}`, mark_text: "NOVAPULSE", classes: cls.map(Number), status: "Registered", owner_name: "Owner", owner_country: "US", screen_verdict: "surface:in-scope-live" }] : [] };
      if (i >= 0) blocks[i] = block; else blocks.push(block);
    }
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, states: {} };
  };
  return { planExecutor, calls };
}

// ── A1 SPLIT: the two-member common-law gather (perf/commonlaw-split-gather) ─────────────────────────────

// Normalize a grid ledger (single object / merged object / batch array) to comparable sets — the
// acceptance is "same cells, gaps, pr_risk", never byte-identity (the merged object legitimately
// reorders keys and normalizes gap strings to objects).
export function ledgerSets(raw) {
  const batches = Array.isArray(raw) ? raw : [raw];
  const cells = [], gaps = [], prRisk = [];
  for (const b of batches) {
    for (const c of b.cells ?? []) cells.push(`${c.term}|${c.platform}`);
    for (const g of b.gaps ?? []) gaps.push(typeof g === "string" ? g.split("|").slice(0, 2).map((s) => s.trim()).join("|") : `${g.term}|${g.platform}`);
    for (const e of b.extras?.pr_risk ?? []) if (e?.query) prRisk.push(e.query);
  }
  return { cells: cells.sort(), gaps: gaps.sort(), prRisk: prRisk.sort() };
}

// ── THE SURVIVING UNSPLIT LEVER, and how a test drives it ────────────────────────────────────────
//
// The settings cull deleted CLEAROTRON_COMMONLAW_SPLIT, and with it the only way to ask for the single-member
// assembly by flipping one variable. One lever still reaches that assembly, a production shape rather than a
// switch (pipeline.mjs deriveGridSpec):
//
//   single-term-grid   a grid carrying fewer than 2 terms. A one-variant manifest cannot be MINTED here
//                      (verify.mjs's completeness floor refuses a fresh manifest missing a core, phonetic
//                      or visual member), but a resume READS the manifest off disk rather than re-minting
//                      it, so the fixture builds the shape there.
//
// A resume of a run whose findings predate the split used to reach it too, and was the lever these tests
// drove. That arm is gone: a run from an earlier build is no longer resumed.
//
// The fixture: run until after the merge, remove every common-law artifact the gather wrote (halves AND
// canonical, so the gather is cold and runs again), trim the manifest to its first variant, then resume.
// The resume authors a one-term grid and gathers it on the single member.
export async function singleTermGridRun(extra = {}) {
  const { res: seed } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_FAIL_STAGE: "joint synthesis narrative", CLEAROTRON_RECOVERY_MAX: "1", ...extra });
  assert.equal(seed.ok, false, `the seed run must run the split and stop AFTER the merge: ${JSON.stringify(seed)}`);
  assert.ok(existsSync(join(seed.runDir, `common-law-findings.half-${MEANING_SEAT}.md`)),
    "the seed must really have SPLIT — if no half artifact exists the fixture removes nothing and proves nothing");
  const { rmSync } = await import("node:fs");
  for (const h of ["a", "b", MEANING_SEAT])
    for (const f of [`common-law-findings.half-${h}.md`, `common-law-grid.half-${h}.json`,
      `common-law-dispositions.half-${h}.json`, driverRel(`grid-spec.half-${h}.json`)])
      rmSync(join(seed.runDir, f), { force: true });
  // With the canonical findings on disk the gather is warm and never runs again; a grid that has not
  // been swept carries no receipt for having closed it either.
  for (const f of ["common-law-findings.md", "common-law-grid.json", "common-law-dispositions.json", driverRel("coverage-closure.json")])
    rmSync(join(seed.runDir, f), { force: true });
  const manifestPath = join(seed.runDir, "variant-manifest.md");
  const rows = readFileSync(manifestPath, "utf8").split("\n");
  const head = rows.findIndex((l) => /^### Variants/.test(l));
  assert.ok(head >= 0, "the manifest has no Variants heading — this fixture is trimming a shape that moved");
  const dataRows = [];
  for (let i = head + 1; i < rows.length && !/^### /.test(rows[i]); i += 1)
    if (/^\| /.test(rows[i]) && !/^\|\s*Value\s*\|/.test(rows[i]) && !/^\|[-\s|]+\|$/.test(rows[i])) dataRows.push(i);
  assert.ok(dataRows.length > 1, `the manifest carries ${dataRows.length} variant row(s) — nothing to trim, so the single-term arm would not be exercised`);
  writeFileSync(manifestPath, rows.filter((_, i) => !dataRows.slice(1).includes(i)).join("\n"));
  // READ THE JOURNAL FROM THE RUN DIR THE CALL RETURNED, never from a path captured earlier: a run that
  // DELIVERS is archived, so `seed.runDir` is an empty directory by the time the resume finishes and the
  // same read that worked before it succeeded returns ENOENT after. Three populations, one name.
  const journalAt = (dir) => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const seedEvents = journalAt(seed.runDir);
  delete process.env.MOCK_FAIL_STAGE;
  const codename = seed.runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline(JOB, { codename });
  // The journal is APPENDED to across the resume, so the seed's own `grid-split` and `common-law-path`
  // rows are still in it. Everything the resume asserts about events reads this slice, never the file —
  // counting the whole file would let the seed's split row answer a question about the resume.
  return { res, seedRunDir: seed.runDir, events: journalAt(res.runDir).slice(seedEvents.length) };
}

// ── the run RECORDS which common-law path it took, and which term of the selector decided it ──
//
// THE INCIDENT (E2E round, 2026-08-12). One build ran a single unsplit `common-law` stage and delivered
// in 95 minutes; the next ran three halves and died at 34. Nothing in either run's artifacts said what
// selected either path. `CLEAROTRON_COMMONLAW_SPLIT` was the obvious suspect and was a red herring both
// times — it is ON by default and was ON for both. The selector is a CONJUNCTION and a different term
// differed, but no artifact recorded any term, so the round's single most important open question was
// unanswerable from the record.
//
// THE SELECTOR, named:
//   a spec is authored at all  ⟸ !registerOnly && gridVariants.length && profile.platforms.length
//   then, only if a spec exists ⟸ gridSpec.terms.length >= 2
//
// The settings cull deleted the `config.commonLawSplit` conjunct (CLEAROTRON_COMMONLAW_SPLIT). That is worth
// reading against the incident above rather than skipping: the flag was the obvious suspect BOTH times
// and was the answer NEITHER time, which is the argument for recording every term instead of trusting
// the one with a name. The record is why deleting it is safe.
//
// The property under test is that the record exists on EVERY path and agrees with the assembly. The
// unsplit path is the one that mattered on 08-11 and the one that emitted nothing at all before this:
// a record that appears only when the split arms cannot explain a run that did not split.
export const readPathRecord = (runDir) => {
  const p = driverDir(runDir, "common-law-path.json");
  assert.ok(existsSync(p), `#753: _driver/common-law-path.json must exist on EVERY run — its absence IS the defect (${runDir})`);
  return JSON.parse(readFileSync(p, "utf8"));
};
