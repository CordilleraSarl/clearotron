// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `--experiment` must hand a stage exactly what pipeline would.
//
// Three things are proved here, in the order they matter:
//
//   1. `stageInputs` still returns exactly the frozen freshness contract. That map feeds
//      stageStaleness / writeStamp / dependencyOrder / reconcilePassStamps / mcp-server trace /
//      stage-freshness — widening what it returns makes previously-fresh stages read stale and can PARK
//      a live run.  adds a SECOND view instead of touching this one.
//   2. An `--experiment` arm's context is byte-equal to the canonical run's, over a REAL pipeline run
//      (the offline mock harness — real driver code, real artifacts, no billable calls), for the two
//      cases  names as known-broken: `common-law-half` and `register-digest`.
//   3. A sandbox that cannot reproduce something the canonical run has REFUSES the dispatch by name.
//      The old copy loop `continue`d past it — an absence read as a pass, the defect class this
//      codebase has shipped seven times.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { toolGroupsForStage } from "../engine/mcp/gather-config.mjs";   // conversion 11 — the grant the tool-group edge is keyed on

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "prelim-exp-ctx-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_RECALL_PROBES ||= "0";

const PL = await import("../pipeline.mjs");
const ST = await import("../stages.mjs");
const SC = await import("../stage-context.mjs");

const jobFor = (ref) => ({ id: `job-${ref}`, msgId: `<${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: `MARK ${ref}`, classes: [9, 41], provider: "corsearch" });
const codenameOf = (runDir) => basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);   // same 12-hex prefix as log.mjs fileMeta, which is what the receipt records
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ── 1. THE FRESHNESS MAP DID NOT MOVE ────────────────────────────────────────────────────────────────

// THE FRESHNESS CONTRACT, FROZEN.
//
// stageInputs feeds stageStaleness / writeStamp / dependencyOrder / reconcilePassStamps /
// mcp-server trace / stage-freshness. Widening what it returns makes previously-fresh stages read
// STALE and can PARK a live run — the skeptic declaration was held back an entire wave for exactly
// that. adds a SECOND view (stage-context.mjs) rather than touching this one.
//
// A golden, not a diff against origin/main. The differential — 798 comparisons across every stage ×
// axes × axis × registerOnly, all byte-identical — was this PR's one-time proof and lives in its body.
// As a committed test it would assert that no branch may EVER change this map, which is wrong: the map
// is allowed to change, deliberately and in daylight. This fails on any change and asks for the update
// to happen in the same PR that makes it.
const FRESHNESS_GOLDEN = {
  "matter-frame": [],
  "prelim-variants": ["matter-context.md"],
  "blind-frame": ["inbound-request.txt"],
  "common-law": ["variant-manifest.md", "matter-context.md"],
  "common-law-half": ["variant-manifest.md", "matter-context.md"],
  "register-unit": ["variant-manifest.md", "matter-context.md"],
  "placement-inquiry": ["matter-context.md", "common-law-findings.md", "register-named-band.json", "register-units/saturation-probe.md", "register-units/primary-sweep.md", "register-units/transliteration-numeric.md", "register-units/incumbent-class.md"],
  "register-digest": ["variant-manifest.md", "matter-context.md", "placement-recommendations.md", "placements.json", "register-named-band.json", "register-units/saturation-probe.md", "register-units/primary-sweep.md", "register-units/transliteration-numeric.md", "register-units/incumbent-class.md"],
  skeptic: ["register-findings.md", "common-law-findings.md", "variant-manifest.md", "matter-context.md", "_driver/plan-execution.json", "register-coverage-ledger.json"],
  // — MOVED, and this is the golden doing its job. frame-diff now runs BEFORE placement-inquiry and
  // register-digest, so register-findings.md and register-coverage-ledger.json — both digest OUTPUTS — do
  // not exist when it runs. Declaring a later stage's outputs as this stage's inputs is the park mechanism
  // the message above names: they would go absent→present mid-pass and stale a skipped frame-diff on the
  // delivery path. They are replaced by the surface the digest was re-narrating: the merged named band and
  // the per-axis unit notes, which are exactly what placement-inquiry (its new neighbour) already declares.
  // The set is the same width, so nothing here widens; what changes is WHICH artifacts, and the two coming
  // out are the two that would park a run.
  "frame-diff": ["blind-frame-model.json", "scope-ledger.json", "variant-manifest.md", "register-named-band.json", "register-units/saturation-probe.md", "register-units/primary-sweep.md", "register-units/transliteration-numeric.md", "register-units/incumbent-class.md", "common-law-findings.md"],
  // — WIDENED, deliberately, and the golden is doing its job by making that say so out loud. The
  // two files added are the plan-execution receipt and the machine coverage ledger: the run's record of
  // what was and was not searched, which reached the stage's REVIEWER as a driver-computed table and did
  // not reach the stage that writes the claim.
  //
  // Widening is the direction this golden's own message warns about, so the parking argument is made
  // rather than assumed. What held the identical skeptic declaration back a whole wave was that all four
  // `refreshSupplementalExecution` sites run DOWNSTREAM of the skeptic dispatch — the receipt moved after
  // the stage read it, on most non-trivial runs, with no in-pass arm to repair the staleness. Every one
  // of those four sites runs UPSTREAM of the synthesis dispatch. The coverage ledger is written by
  // `runDigest`, which rewrites `register-findings.md` in the same pass; synthesis has always declared
  // that file, so the ledger is a strict co-mover with an input this stage already stales on. And a
  // stamp written before this ships carries no entry for either path, so `diffFingerprint` — which walks
  // the RECORDED entries — manufactures no staleness on a run already in flight.
  synthesis: ["register-findings.md", "common-law-findings.md", "placement-recommendations.md", "placements.json", "register-named-band.json", "matter-context.md", "variant-manifest.md", "skeptic-flags.md", "_driver/frame-reopen.json", "_driver/crowd-context.json", "crowd-context.md", "_driver/plan-execution.json", "register-coverage-ledger.json"],
  "case-law": ["narrative.md"],
  "narrative-refutation": ["narrative.md", "register-findings.md", "common-law-findings.md", "placement-recommendations.md", "placements.json", "matter-context.md", "skeptic-flags.md", "_driver/frame-reopen.json"],
  // — NARROWED from nine to two, deliberately: the stage declared nine and opened two (the 08-02 R2
  // dependency graph), and its prompt asserted grounding in all nine. Declaration and citations now both
  // say narrative.md + findings.json, pinned together by the exact-set guard in operability.test.mjs.
  // Narrowing is the safe direction this golden's own message names — a stage that declares FEWER inputs
  // can only become less stale, never more, so no run parks on it. The refutation's staleness still
  // reaches this stage transitively (narrative-refutation's inputs are a subset of synthesis's, plus
  // narrative — synthesis's own output), and its VERDICT reaches the prompt as driver-computed data
  // (_driver/verdict.json → displayVerdict), never as a file read.
  "report-overview": ["narrative.md", "findings.json"],
  "report-card": ["case-law-findings.md", "findings.json"],
  "doubt-closure": ["findings.json", "register-findings.md", "register-coverage-ledger.json"],
};

test("#236 hazard 1: stageInputs matches the frozen freshness contract, stage for stage", () => {
  const P = ST.paths("/run");
  const rel = (p) => p.slice("/run/".length);
  const actual = {};
  for (const name of Object.keys(ST.STAGES)) actual[name] = ST.stageInputs(name, P, { axes: ST.REGISTER_AXES }).map(rel);
  assert.deepEqual(actual, FRESHNESS_GOLDEN,
    "stageInputs MOVED. That map is the delivery freshness contract: a wider list makes previously-fresh stages read stale and can park a live run (see the skeptic entry in stages.mjs). If the change is intended, update FRESHNESS_GOLDEN in THIS PR and say in the body which stages move and why. If it is not, you have widened the map when you meant to widen the sandbox view — that is stage-context.mjs.");
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(FRESHNESS_GOLDEN).sort(), "a stage was added or removed without updating the golden");

  // the two things the golden's single opts shape cannot show
  assert.ok(ST.stageInputs("synthesis", P, { axes: [] }).some((f) => f.endsWith("common-law-findings.md")),
    "precondition: synthesis declares the common-law findings");
  assert.ok(!ST.stageInputs("synthesis", P, { axes: [], registerOnly: true }).some((f) => f.endsWith("common-law-findings.md")),
    "registerOnly still drops the common-law findings (a register-only run wrote none)");
  assert.deepEqual(ST.stageInputs("register-digest", P, { axes: ["primary-sweep"] }).filter((f) => f.includes("register-units/")),
    [P.registerUnit("primary-sweep")], "the per-axis unit fan-out still follows `axes`");
  // An unknown stage must keep returning [] rather than throwing: dependencyOrder swallows throws, so a
  // regression there would be silent, not loud.
  assert.deepEqual(ST.stageInputs("no-such-stage", P, {}), [], "unknown stage still returns []");
});

// ── the shared canonical run (one real mock pipeline, reused by the arms below) ───────────────────────

let CANON = null;
async function canonicalRun() {
  if (CANON) return CANON;
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"]) delete process.env[k];
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  // FAIL AT SYNTHESIS on purpose. --experiment resolves a LIVE run dir (an archived, delivered run is
  // deliberately not a target), and a clean mock run delivers and archives itself. Parking at synthesis
  // leaves every artefact the arms below need — the merged band, the derived shape, the grid specs, the
  // placement pair, the coverage ledger — on a live run dir, which is also the state an operator is
  // actually in when they reach for --experiment.
  process.env.MOCK_FAIL_STAGE = "joint synthesis narrative";
  const job = jobFor("TMPEXPCTX1");
  const res = await PL.pipeline(job);
  assert.equal(res.ok, false, "the canonical mock run parks at synthesis so its run dir stays live");
  assert.equal(res.failedStage, "synthesis");
  delete process.env.MOCK_FAIL_STAGE;
  CANON = { job, runDir: res.runDir, codename: codenameOf(res.runDir) };
  return CANON;
}

/**
 * The arm's context AT DISPATCH, compared byte-for-byte with the canonical run.
 *
 * Read from `_driver/experiment-context.json` — the receipt runExperiment fingerprints before it
 * dispatches — NOT from the sandbox files afterwards: the stage overwrites its own output, and several
 * context artefacts (a half's findings file, the canonical common-law findings) are exactly that.
 */
function assertContextByteEqual(stage, canonRunDir, shadowDir) {
  const receipt = JSON.parse(readFileSync(driverDir(shadowDir, "experiment-context.json"), "utf8"));
  assert.ok(receipt.edges.length > 0, `${stage}: the context receipt is empty`);
  const checked = [];
  for (const e of receipt.edges) {
    const canonical = join(canonRunDir, e.rel);
    if (e.dir) { assert.ok(existsSync(join(shadowDir, e.rel)), `${stage}: directory ${e.rel} missing from the sandbox`); continue; }
    assert.ok(e.sha, `${stage}: ${e.rel} [${e.kind}] is on the canonical run and was NOT in the sandbox at dispatch`);
    // `shaCanonical` is the sandbox's bytes with the sandbox's own path rewritten back to the run dir.
    // Only the driver-written grid specs differ from `sha` — they name their own output_path, which
    // must point INTO the sandbox; a raw-byte comparison there would flag the rig working correctly.
    // `_driver/register-positions.json` is the one context artefact the DRIVER stamps with a wall-clock
    // `ts` as it writes it (pipeline.mjs deriveBandShape). Everything the derivation itself computes is
    // deterministic, so the comparison strips exactly that one driver-written key and nothing else.
    if (e.rel === "_driver/register-positions.json") {
      const strip = (p) => { const j = JSON.parse(readFileSync(p, "utf8")); delete j.ts; return JSON.stringify(j); };
      assert.equal(strip(join(shadowDir, e.rel)), strip(canonical), `${stage}: ${e.rel} differs from the canonical run (beyond its driver-written ts stamp)`);
    } else {
      assert.equal(e.shaCanonical, sha(canonical), `${stage}: ${e.rel} [${e.kind}] differs BYTE-WISE from what the canonical run held`);
    }
    checked.push(e.rel);
  }
  return checked;
}

// ── 2. THE TWO KNOWN-BROKEN CASES BECOME THE PROOF ───────────────────────────────────────────────────

test("#236: --experiment common-law-half — the arm RUNS at all, and its context is byte-equal to the canonical run's", async () => {
  const { job, runDir, codename } = await canonicalRun();
  // The precondition the issue names: the half-spec sidecar is DERIVED in pipeline() and DECLARED
  // nowhere, so the old rig copied stageInputs() and the validator then refused for want of it.
  const P = ST.paths(runDir);
  assert.ok(existsSync(P.gridSpecHalf("b")), "the canonical run must carry _driver/grid-spec.half-b.json for this to be the case #236 describes");
  assert.ok(!ST.stageInputs("common-law-half", P, { axis: "b" }).includes(P.gridSpecHalf("b")),
    "…and it must still be UNDECLARED — the fix is a second view, not a wider freshness list");

  const ex = await PL.runExperiment(job, { codename, experiment: "common-law-half", axis: "b", label: "ctx proof" });
  const checked = assertContextByteEqual("common-law-half", runDir, ex.shadowDir);
  assert.ok(checked.includes("_driver/grid-spec.half-b.json"),
    "the half-grid spec the prompt hands the plugin as grid_spec_path must be IN the sandbox");
  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  const halfSpec = receipt.edges.find((e) => e.rel === "_driver/grid-spec.half-b.json");
  assert.notEqual(halfSpec.sha, halfSpec.shaCanonical,
    "the re-derived half spec must name an output_path INSIDE the sandbox — if its raw and canonicalised shas are equal it is still dictating writes into the canonical run");
  assert.match(JSON.parse(readFileSync(driverDir(ex.shadowDir, "grid-spec.half-b.json"), "utf8")).output_path,
    new RegExp(`^${ex.shadowDir}/`), "…and that output_path points at the sandbox, not the canonical run");
  assert.ok(existsSync(driverDir(ex.shadowDir, "grid-spec.json")),
    "the canonical spec the half derives from rides along (the derivation's own read set, pulled in by the closure)");
  console.log(`      common-law-half: ${checked.length} context artefacts byte-equal`);
});

test("#236: --experiment register-digest — the derived band shape is IN the sandbox and byte-equal", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const P = ST.paths(runDir);
  assert.ok(existsSync(P.bandShape), "the canonical run must carry _driver/band-shape.json");
  assert.ok(!ST.stageInputs("register-digest", P, { axes: [] }).includes(P.bandShape),
    "…and it must still be UNDECLARED on register-digest — the freshness list is untouched");

  const ex = await PL.runExperiment(job, { codename, experiment: "register-digest", label: "ctx proof" });
  const checked = assertContextByteEqual("register-digest", runDir, ex.shadowDir);
  for (const rel of ["_driver/band-shape.json", "band-shape.md", "register-named-band.json"])
    assert.ok(checked.includes(rel), `${rel} must be in the sandboxed digest's context — it was the artifact all four #217 arms ran without`);
  console.log(`      register-digest: ${checked.length} context artefacts byte-equal`);
});

test("#236: band_shape returns ok:true against a sandboxed register-digest (the tier filter is armed)", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const ex = await PL.runExperiment(job, { codename, experiment: "register-digest", label: "band tool" });
  // The band MCP server resolves the run it serves from CLEAROTRON_BAND_RUN_DIR, which gateway.mjs sets to
  // the ctx's runDir — the SHADOW dir on an experiment arm. Drive it exactly as the stage's tool call
  // would: a tier-filtered shape read, which is the call that returned ok:false in all four arms.
  const { spawn } = await import("node:child_process");
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, "..", "engine", "mcp", "band-server.mjs")],
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: ex.shadowDir } });
    let buf = "", got = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(got); };
    const timer = setTimeout(done, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) { got = m; clearTimeout(timer); done(); } } catch { /* non-json */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_shape", arguments: { tier: "identical" } } }) + "\n");
  });
  assert.ok(out, "band_shape returned nothing");
  assert.notEqual(out.result?.isError, true,
    `band_shape is an ERROR in the sandbox — the tier filter needs _driver/band-shape.json and the arm would run with no floors: ${out.result?.content?.[0]?.text?.slice(0, 200)}`);
});

// ── 3. AN ABSENCE IS A FINDING ───────────────────────────────────────────────────────────────────────

test("#236 zero semantics: a sandbox that loses a context artefact REFUSES by name, it does not dispatch", () => {
  // The unit under test is the gap check itself, over a hand-built canonical/sandbox pair: the runtime
  // integration proves the happy path, this proves the failing one without needing to break a stage.
  const canon = mkdtempSync(join(tmpdir(), "gap-canon-"));
  const shadow = mkdtempSync(join(tmpdir(), "gap-shadow-"));
  mkdirSync(driverDir(canon), { recursive: true });
  mkdirSync(driverDir(shadow), { recursive: true });
  mkdirSync(join(canon, "_records"), { recursive: true });
  mkdirSync(join(shadow, "_records"), { recursive: true });
  writeFileSync(join(canon, "matter-context.md"), "frame\n");
  writeFileSync(join(shadow, "matter-context.md"), "frame\n");
  writeFileSync(driverDir(canon, "band-shape.json"), "{}\n");
  writeFileSync(join(canon, "_records", "r1.json"), "{}\n");

  const P = ST.paths(canon);
  const manifest = [
    { path: P.matterContext, kind: "agent-reads-file" },
    { path: P.bandShape, kind: "tool-mediated", via: "band-shape", why: "the shape the tier filter needs" },
    { path: join(canon, "_records"), kind: "tool-mediated", dir: true },
    { path: P.crowdContext, kind: "driver-side" },   // absent on BOTH — faithful, never a gap
  ];
  const gaps = SC.sandboxGaps(manifest, canon, shadow);
  const rels = gaps.map((g) => g.rel).sort();
  assert.deepEqual(rels, ["_driver/band-shape.json", "_records"],
    "the shape and the (empty) records dir are on the canonical run and not in the sandbox — both are gaps");
  assert.equal(gaps.find((g) => g.rel === "_driver/band-shape.json").via, "band-shape", "a gap names WHY the artefact was wanted");
  assert.ok(!rels.includes("_driver/crowd-context.json"),
    "an artefact the CANONICAL run never had is not a gap — pipeline() would not have handed it either");

  // and the same check on a faithful sandbox is silent
  writeFileSync(driverDir(shadow, "band-shape.json"), "{}\n");
  writeFileSync(join(shadow, "_records", "r1.json"), "{}\n");
  assert.deepEqual(SC.sandboxGaps(manifest, canon, shadow), [], "a faithful sandbox reports no gaps");
  rmSync(canon, { recursive: true, force: true }); rmSync(shadow, { recursive: true, force: true });
});

test("#236: an empty directory is MISSING, not present (a _records/ with nothing in it serves no record)", () => {
  const canon = mkdtempSync(join(tmpdir(), "gap-canon2-"));
  const shadow = mkdtempSync(join(tmpdir(), "gap-shadow2-"));
  mkdirSync(join(canon, "_records"), { recursive: true });
  writeFileSync(join(canon, "_records", "r1.json"), "{}\n");
  mkdirSync(join(shadow, "_records"), { recursive: true });   // created, never filled — the copy-loop bug
  const gaps = SC.sandboxGaps([{ path: join(canon, "_records"), kind: "tool-mediated", dir: true }], canon, shadow);
  assert.deepEqual(gaps.map((g) => g.rel), ["_records"], "an empty directory reads as MISSING");
  rmSync(canon, { recursive: true, force: true }); rmSync(shadow, { recursive: true, force: true });
});

// ── 4. THE PROVENANCE ROW, AND THE DRIVER-COMPUTED BLOCKS ────────────────────────────────────────────

test("#236: an --experiment arm writes the order-probe provenance row on its OWN record", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const ex = await PL.runExperiment(job, { codename, experiment: "skeptic", label: "probe row" });
  const rows = events(ex.shadowDir).filter((e) => e.event === "order-probe");
  assert.equal(rows.length, 1, "exactly one order-probe row per arm");
  assert.ok("seed" in rows[0], "the row is three-valued: `seed` is always WRITTEN, null meaning the ordinary production ordering");
  // and the canonical run's experiment breadcrumb carries the same seed, so the arm is attributable
  // from either end.
  const bread = events(runDir).filter((e) => e.event === "experiment").pop();
  assert.ok("seed" in bread, "the canonical breadcrumb also records the arm's ordering");
});

test("#236: a sandboxed register-digest carries the driver-computed prompt blocks runDigest composes", async () => {
  const { job, codename } = await canonicalRun();
  const ctx = PL.reconstructCtx(job, { codename });
  // The extraction is output-identical by construction: this pins the composed string per trigger, so a
  // future edit to any of the three blocks cannot silently diverge between runDigest and the rig.
  const fresh = PL.digestDispatchExtra(ctx, { trigger: "fresh", willRun: true });
  const corrective = PL.digestDispatchExtra(ctx, { trigger: "escalation", willRun: true });
  assert.notEqual(fresh, corrective,
    "a corrective digest pass carries the placement RULINGS TAIL and a fresh one does not — if these are equal the trigger gate has stopped working");
  assert.ok(String(corrective).includes(String(fresh ?? "")) || fresh == null,
    "the corrective extra COMPOSES with the fresh blocks, it never replaces them");
  // a skipping pass (willRun false) never carries the tail
  const skipped = PL.digestDispatchExtra(ctx, { trigger: "escalation", willRun: false });
  assert.ok(!/PLACEMENT RULINGS TAIL/.test(String(skipped ?? "")), "a pass that will not re-run carries no rulings tail");
});

// ── 5. THE DECLARATION CANNOT DRIFT AWAY FROM verify.mjs ─────────────────────────────────────────────

test("#236 drift guard: every _driver sidecar verify.mjs resolves is declared for some stage", () => {
  const src = readFileSync(join(HERE, "..", "verify.mjs"), "utf8");
  const found = new Set();
  // — verify.mjs now says driverDir(dir, "name.json") where it used to say join(dir, "_driver",
  // "name.json"). The OLD pattern still matched four names out of prose and template strings, so this
  // guard would have gone on passing while seeing 9 of 13 sidecars: a silent narrowing, not a red.
  // The floor arm below exists because of that, and it is asserted BEFORE the drift comparison.
  // The base can itself be a call — driverDir(dirname(p), "coverage-closure.json") — so the pattern has
  // to reach past a nested paren to the LAST quoted segment. A base-only pattern found 10 of the 13.
  for (const m of src.matchAll(/driverDir\([^;\n]*?,\s*(?:`|")([a-z0-9.$~{}-]+)(?:`|")\s*\)/g))
    if (/\.[a-z]+$/.test(m[1])) found.add(m[1]);
  for (const m of src.matchAll(/_driver\/([a-z0-9.-]+\.json)/g)) found.add(m[1]);
  assert.ok(found.size >= 13,
    `the sidecar extractor found only ${found.size} names in verify.mjs — it found 13 before #1336. `
    + `A pattern that stops matching the source makes every assertion below vacuous: nothing to compare `
    + `means nothing missing means green.`);
  assert.doesNotMatch(src, /join\([^)]*"_driver"/,
    "verify.mjs must not go back to building the path by hand — the extractor above reads the accessor form");
  const declared = new Set(Object.values(SC.VALIDATOR_SIDECARS).flat());
  const missing = [...found].filter((f) => {
    if (declared.has(f)) return false;
    // axis-parameterised names (grid-spec.half-a.json / a `${half}` template) are declared as edges
    if (SC.AXIS_PARAMETERISED_SIDECARS.some((prefix) => f.startsWith(prefix))) return false;
    // read by a validator whose STAGE no longer exists — recorded, not silently dropped
    if (SC.STAGELESS_VALIDATOR_SIDECARS.includes(f)) return false;
    return true;
  });
  assert.deepEqual(missing, [],
    `verify.mjs resolves _driver sidecar(s) that no stage declares in stage-context.mjs VALIDATOR_SIDECARS — an --experiment arm would be judged under different rules than production: ${missing.join(", ")}`);
});

// ── 6. WHY THIS IS DERIVE-IN-THE-RIG AND NOT PERSIST-AND-REPLAY ──────────────────────────────────────

test("#236 → #256: an order-SEEDED arm re-executes the band-shape seams instead of replaying them", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const before = process.env.CLEAROTRON_ORDER_PROBE_SEED;
  process.env.CLEAROTRON_ORDER_PROBE_SEED = "7";
  let ex;
  try { ex = await PL.runExperiment(job, { codename, experiment: "register-digest", label: "seeded" }); }
  finally { if (before === undefined) delete process.env.CLEAROTRON_ORDER_PROBE_SEED; else process.env.CLEAROTRON_ORDER_PROBE_SEED = before; }

  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  assert.equal(receipt.seed, 7, "the arm records the seed it ran under — an unattributable arm is the failure the probe row exists to prevent");
  assert.ok(receipt.derived.includes("band-shape"), "the band-shape derivation RAN in the sandbox");
  // THE POINT. All three probeOrder seams sit inside band-shape.mjs's derivation functions, so a rig
  // that replayed a persisted band-shape.json would hand the seeded arm the UNSEEDED artefact and the
  // arm would come back byte-identical to its control — which is exactly what happened to all four
  // arms. Because the rig derives, the seeded shape moves.
  const shape = receipt.edges.find((e) => e.rel === "_driver/band-shape.json");
  assert.ok(shape, "the shape is in the arm's context");
  const canonicalShape = sha(driverDir(runDir, "band-shape.json"));
  // Precondition, stated so a fixture that cannot answer the question fails loudly rather than passing
  // vacuously: the seam permutes LISTS, so a band whose every list is shorter than two entries could
  // not move under any seed.
  const lists = JSON.stringify(JSON.parse(readFileSync(driverDir(runDir, "band-shape.json"), "utf8")));
  assert.ok(lists.length > 500, "the fixture band's shape is too small to permute — this test would pass vacuously");
  assert.notEqual(shape.shaCanonical, canonicalShape,
    "the SEEDED arm produced a byte-identical shape to the unseeded canonical — the seam was replayed, not executed, which is the exact failure #236 exists to fix");
});

// A card needs findings.json, which SYNTHESIS authors — so the run above (parked AT synthesis) has
// none. Its own canonical, parked one stage later.
let CANON_CARD = null;
async function canonicalCardRun() {
  if (CANON_CARD) return CANON_CARD;
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FAIL_STAGE = "record_report_overview";
  const job = jobFor("TMPEXPCTX2");
  const res = await PL.pipeline(job);
  delete process.env.MOCK_FAIL_STAGE;
  assert.equal(res.ok, false, "parks at report-overview, so findings.json + the case-law layer are on a LIVE run dir");
  CANON_CARD = { job, runDir: res.runDir, codename: codenameOf(res.runDir) };
  return CANON_CARD;
}

test("#236: --experiment report-card rebuilds its INLINE context, and refuses when it cannot", async () => {
  const { job, runDir, codename } = await canonicalCardRun();
  // findings.json is a passed-inline edge: the agent never opens it, so it is NOT in the sandbox.
  const P = ST.paths(runDir);
  assert.ok(!SC.sandboxManifest("report-card", P, {}).some((e) => e.path === P.findings),
    "findings.json is passed INLINE — copying it into the sandbox would model an edge that does not exist");
  const ords = (JSON.parse(readFileSync(P.findings, "utf8")).findings ?? []).map((f) => Number(f.ordinal));
  assert.ok(ords.length, "the canonical run must carry rated findings for this case to exist");

  const ex = await PL.runExperiment(job, { codename, experiment: "report-card", axis: String(ords[0]), label: "inline" });
  assert.ok(ex.shadowDir.includes("/_experiments/"), "the card arm ran sandboxed");
  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  assert.equal(receipt.stage, "report-card");
  // an ordinal that does not exist must REFUSE, never dispatch a card against an undefined finding
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "report-card", axis: "9999" }),
    /receives ctx\.finding INLINE and it could not be rebuilt/,
    "an unresolvable inline field refuses by name");
  // a card arm with NO ordinal is refused one step earlier, by the per-stage --axis vocabulary
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "report-card" }),
    /requires --axis <ordinal>/, "…and a card arm with no ordinal at all is refused by the axis guard");
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "report-card", axis: "one" }),
    /is not a finding ordinal/, "…and a non-numeric ordinal never reaches the run dir");
});

// made --axis a MEMBERSHIP test against REGISTER_AXES for every stage. needs `--axis b`
// (a grid half) and `--axis 3` (a finding ordinal), which are the suffixes production's own dispatch
// labels already use. The membership test is kept and made PER STAGE — this pins both halves of that.
test("#236 x #251: --axis is a per-stage membership test, and a stage that takes none still refuses one", async () => {
  const job = jobFor("TMPAXISVOCAB");
  const bogus = "no-such-codename";
  // the vocabulary REFUSES, before the run dir is touched (the bogus codename would fail loudly otherwise)
  for (const [stage, bad, re] of [
    ["register-unit", "primary-swep", /is not a register axis/],
    ["common-law-half", "c", /is not a grid seat/],
    ["report-card", "0", /is not a finding ordinal/],
    ["skeptic", "primary-sweep", /is not a register axis, and skeptic takes no axis at all/],
  ]) await assert.rejects(() => PL.runExperiment(job, { codename: bogus, experiment: stage, axis: bad }), re,
    `--experiment ${stage} --axis "${bad}" must be refused`);
  // …and every valid value gets PAST the guard (it then fails on the bogus codename)
  // — the meaning seat is a first-class --experiment target: it is the seat a round will want
  // to re-run on its own when the meaning sweep is what is being measured.
  for (const [stage, good] of [["register-unit", "primary-sweep"], ["common-law-half", "a"], ["common-law-half", "b"], ["common-law-half", "m"], ["report-card", "1"]])
    await assert.rejects(() => PL.runExperiment(job, { codename: bogus, experiment: stage, axis: good }),
      (e) => !/--axis/.test(String(e?.message ?? e)), `--experiment ${stage} --axis "${good}" is valid`);
});

test("#236: --dispatch-trigger refuses an unknown value rather than composing a quietly different arm", async () => {
  const { job, codename } = await canonicalRun();
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "register-digest", dispatchTrigger: "escalaton" }),
    /unknown value "escalaton"/, "a typo in the trigger must refuse — it decides which prompt blocks compose");
});

// ── conversion 11: THE DIGEST'S FACTS SIDECAR IS A DECLARED DERIVATION ───────────────────────────────
//
// FOURTH OCCURRENCE of this file's own subject. `writeRegisterDigestFacts` has one call site, inside
// `runDigest`, and `--experiment` calls `stage()` directly — so a sandboxed digest got no facts sidecar,
// `readDigestFacts` returned empty facts, and the first seat call refused `registerdigest_uri_unknown`.
// The transport's fail-closed degradation firing correctly about the wrong cause, with nothing able to
// say the DRIVER never wrote the file. Found by the replay rig before any model call, 2026-08-27.
//
// The arms below are pure — they are about the DECLARATION, which is what was missing. The one that
// would have caught it is the first: the sidecar must be in the manifest at all, because a derivation's
// reads are pulled in ONLY IF one of its written paths is already wanted. Declaring the derivation
// without the tool-group edge would have changed nothing and read as a complete fix.
test("conversion 11: the digest's facts sidecar and accounting stamp are in its sandbox manifest", () => {
  const P = ST.paths("/run");
  const manifest = SC.sandboxManifest("register-digest", P, {});
  const at = (p) => manifest.find((e) => e.path === p);
  for (const [what, path] of [["the facts sidecar", driverDir(P.runDir, "register-digest-facts.json")],
                              ["the accounting era stamp", driverDir(P.runDir, "digest-accounting.json")]]) {
    assert.ok(at(path), `${what} must be in the sandbox manifest — without it sandboxGaps has no gap to `
      + "refuse on, and the arm dispatches into a context the driver never built");
  }
});

test("conversion 11: the facts derivation is SELECTED for a sandboxed digest, with its whole read set", () => {
  const P = ST.paths("/run");
  assert.ok(SC.derivationsFor("register-digest", P, {}).includes("register-digest-facts"),
    "the rig replays derivations by id — unselected, the sandbox produces no sidecar and reads as complete");
  const manifest = SC.sandboxManifest("register-digest", P, {});
  const paths = new Set(manifest.map((e) => e.path));
  // ALL SIX READS, not the three the writer opens directly. digestSummaryCounts and digestAuditRows are
  // called from inside it and open three more; a sandbox missing those derives a sidecar with different
  // counts and audit rows from the canonical one — silently, which is this file's whole subject.
  for (const [why, path] of [["the band the record index is built from", P.registerNamedBand],
                             ["which records this run read", P.readingLog],
                             ["the OWED set the accounting refusal holds the seat to", P.placementModel],
                             ["the plan-execution receipt both count helpers tabulate", P.planExecution],
                             ["the findings digestAuditRows returns empty without", P.registerFindings],
                             ["the coverage-form era stamp", P.coverageEnum],
                             ["the coverage accumulator the audit rows read", driverDir(P.runDir, "register-coverage-form.form.json")]]) {
    assert.ok(paths.has(path), `the sandbox must carry ${why} — the facts derivation opens it, so a copy `
      + "without it derives a DIFFERENT sidecar and nothing says so");
  }
});

test("conversion 11: the tool-group edge is keyed on the group the stage is actually granted", () => {
  // TWO COPIES THAT AGREE TODAY. `TOOL_GROUP_EDGES` is keyed by literal string; the grant is minted by
  // `recordingKey`, which is not exported. A rename on either side would silently un-declare the sidecar
  // and every arm above would still pass, because a manifest that never gains the edge simply omits it.
  assert.ok(toolGroupsForStage("register-digest").includes("recording-register-digest"),
    "the literal TOOL_GROUP_EDGES key must be a group this stage is granted — otherwise the edge is dead "
    + "and the facts sidecar leaves the manifest without a single arm going red");
});

test("conversion 11: the derivation FILLS A GAP and never overwrites the canonical copy", () => {
  // The inverse of band-shape's rule, and the byte-equality arm above is what forced it. This sidecar
  // is a projection taken at dispatch time; re-deriving it after the run reads artifacts that did not
  // exist when the seat saw it (digestAuditRows is empty before the digest writes its findings and
  // non-empty after), so an overwrite hands the arm a context the canonical run never had.
  const runDir = mkdtempSync(join(tmpdir(), "prelim-facts-copy-"));
  const at = driverDir(runDir, "register-digest-facts.json");
  mkdirSync(dirname(at), { recursive: true });
  const canonical = JSON.stringify({ schema_version: 1, records: [], owed: ["/mark/x"] }) + "\n";
  writeFileSync(at, canonical);
  // A band IS present, so the only thing stopping a rewrite is the copy-wins rule itself — without it
  // this arm would go red rather than passing for the wrong reason.
  writeFileSync(ST.paths(runDir).registerNamedBand, JSON.stringify({ enumerated: [] }) + "\n");
  const ctx = { paths: ST.paths(runDir), job: {}, run: {} };
  assert.equal(PL.DERIVATION_RUNNERS["register-digest-facts"](ctx), false,
    "the canonical copy stands — the derivation reports it did not derive");
  assert.equal(readFileSync(at, "utf8"), canonical,
    "…and the copy is byte-identical: a re-derivation here would silently change the arm's context");
  rmSync(runDir, { recursive: true, force: true });
});

test("conversion 11: the derivation refuses to claim it derived anything without a band", () => {
  // KNOWN-BAD DRIVE. With no band the sidecar still WRITES — well-formed, with an empty record index —
  // and every uri the seat cites then refuses by name. Reporting that as derived hands an arm a file
  // that is present and useless, which is an absence dressed as a pass one layer below where anyone
  // would look for it. The runner must return false, not a written file.
  const runDir = mkdtempSync(join(tmpdir(), "prelim-facts-noband-"));
  const ctx = { paths: ST.paths(runDir), job: {}, run: {} };
  assert.equal(PL.DERIVATION_RUNNERS["register-digest-facts"](ctx), false,
    "no band ⇒ the derivation reports NOT derived");
  assert.ok(!existsSync(driverDir(runDir, "register-digest-facts.json")),
    "…and writes nothing, so a later reader cannot mistake an empty index for a derived one");
  rmSync(runDir, { recursive: true, force: true });
});

test("#236: blind-frame stays STARVED — widening the sandbox did not widen the blind pass", async () => {
  const P = ST.paths("/run");
  const manifest = SC.sandboxManifest("blind-frame", P, { axes: ST.REGISTER_AXES });
  assert.deepEqual(manifest.map((e) => e.path), [P.inboundRequest],
    "the blind pass's sandbox is still exactly one file — the raw inbound request and nothing else");
  const ctxEdges = SC.stageContext("blind-frame", P, {});
  assert.equal(ctxEdges[0].kind, "conditional",
    "…and the one edge is CONDITIONAL: the prompt names it only when job.rawRequest exists");
});

// ── EVERY SERVER THAT OPENS A DRIVER-WRITTEN FILE HAS AN EDGE — the CLASS, not another instance ─────
//
// SIXTH AND SEVENTH OCCURRENCE PREVENTED, and the count is the argument. The digest's entry in
// `TOOL_GROUP_EDGES` calls its own gap "the fourth occurrence"; the fifth and sixth were then found IN
// that table — `declination-spec.json` and `doubt-closure-spec.json`, both present canonically and both
// absent from a synthesis sandbox — because the fix for the fourth was an ENTRY for one server rather
// than a rule about all of them. Four fixes of one class, each written as a fix of the class.
//
// So this arm DERIVES the population instead of listing it: every MCP server, every driver-written file
// it opens, matched against what the tool-group table declares. A new server that reads a spec is caught
// on the commit that adds it, with no edit here.
test("every MCP server that reads a driver-written file has a declared tool-group edge", () => {
  const MCP = join(HERE, "..", "engine", "mcp");
  const servers = readdirSync(MCP).filter((f) => f.endsWith("-server.mjs"));
  assert.ok(servers.length >= 10,
    `only ${servers.length} server(s) discovered — the walk broke and a clean result below would mean nothing`);

  // A driver-written read is `driverDir(runDir, X)` where X resolves to a literal filename. Both forms
  // the servers use: the constant, and the string inline.
  const reads = [];
  for (const f of servers) {
    const src = readFileSync(join(MCP, f), "utf8");
    const consts = new Map([...src.matchAll(/const\s+([A-Z_]+)\s*=\s*"([^"]+\.json)"/g)].map((m) => [m[1], m[2]]));
    for (const m of src.matchAll(/driverDir\([^,]+,\s*([A-Za-z_]+|"[^"]+")\s*\)/g)) {
      const tok = m[1];
      const name = tok.startsWith('"') ? tok.slice(1, -1) : consts.get(tok);
      if (name && name.endsWith(".json")) reads.push({ server: f, name });
    }
  }
  assert.ok(reads.length >= 3,
    `only ${reads.length} driver-written read(s) found across ${servers.length} servers — the matcher stopped `
    + "matching, and an empty result here is exactly the silence this arm exists to refuse");

  // Everything the tool-group table declares, over a probe paths object.
  const P = ST.paths("/run");
  const declared = new Set();
  for (const build of Object.values(SC.TOOL_GROUP_EDGES ?? {})) {
    for (const e of build(P) ?? []) declared.add(basename(String(e.path)));
  }
  const undeclared = [...new Set(reads.filter((r) => !declared.has(r.name)).map((r) => `${r.name} (${r.server})`))];
  assert.deepEqual(undeclared, [],
    "a server opens a driver-written file that no tool-group edge declares. A sandbox then dispatches "
    + "that stage without the file, the tool refuses about its own input, and `sandboxGaps` has no gap "
    + "to refuse on — so the arm measures the absence of a driver artifact rather than its variable. "
    + "Declare it in TOOL_GROUP_EDGES, keyed on a group the stage is actually granted.");
});
