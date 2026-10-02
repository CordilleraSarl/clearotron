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
import { join, dirname, basename, sep } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { toolGroupsForStage } from "../engine/mcp/gather-config.mjs";   // conversion 11 — the grant the tool-group edge is keyed on

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "clearance-exp-ctx-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const PL = await import("../pipeline.mjs");
const ST = await import("../stages.mjs");
const SC = await import("../stage-context.mjs");

const jobFor = (ref) => ({ id: `job-${ref}`, msgId: `<${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: `MARK ${ref}`, classes: [9, 41], provider: "corsearch" });
const codenameOf = (runDir) => basename(runDir).replace(/^\d{4}-\d\d-\d\d-/, "");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);   // same 12-hex prefix as log.mjs fileMeta, which is what the receipt records
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
// A run-relative path in the one spelling the goldens below are written in. The product builds these
// with the platform's separator, so on Windows they arrive as `_driver\band-shape.json`; the claim is
// about WHICH artefacts, not about the separator, and on Linux this is the identity.
const posixRel = (p) => String(p).split(sep).join("/");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  "clearance-variants": ["matter-context.md"],
  "common-law": ["variant-manifest.md", "matter-context.md"],
  "common-law-half": ["variant-manifest.md", "matter-context.md"],
  "register-unit": ["variant-manifest.md", "matter-context.md"],
  // STEP 3 — the judges read the pile, and the pile is laid out from exactly these: the order, the frozen
  // plan and its execution, the merged band and each unit's band, the web results, and the client the run
  // is bound to (owner-judgment-run.mjs, pile.mjs). Not the unit notes and not the common-law prose: the
  // pile carries neither. It replaced placement-inquiry and register-digest (2026-10-01), whose rows went
  // with them.
  "owner-judgment": ["_driver/instructed-scope.json", "_driver/register-plan.json", "_driver/plan-execution.json", "register-named-band.json", "register-units/saturation-probe-band.json", "register-units/primary-sweep-band.json", "register-units/transliteration-numeric-band.json", "register-units/incumbent-class-band.json", "common-law-grid.json", "customer-bind.json"],
  // The sceptic, synthesis, the review and doubt closure read the judges' decisions where they read the
  // register findings document: one file renamed for another in each row, nothing widened.
  skeptic: ["owner-decisions.json", "common-law-findings.md", "variant-manifest.md", "matter-context.md", "_driver/plan-execution.json", "register-coverage-ledger.json"],
  // — WIDENED, deliberately, and the golden is doing its job by making that say so out loud. The
  // two files added are the plan-execution receipt and the machine coverage ledger: the run's record of
  // what was and was not searched, which reached the stage's REVIEWER as a driver-computed table and did
  // not reach the stage that writes the claim.
  //
  // Widening is the direction this golden's own message warns about, so the parking argument is made
  // rather than assumed. What held the identical skeptic declaration back a whole wave was that all four
  // `refreshSupplementalExecution` sites run DOWNSTREAM of the skeptic dispatch — the receipt moved after
  // the stage read it, on most non-trivial runs, with no in-pass arm to repair the staleness. Every one
  // of those four sites runs UPSTREAM of the synthesis dispatch. The coverage ledger is settled by
  // step 3, which writes the judges' decisions in the same pass; synthesis declares those, so the ledger
  // is a strict co-mover with an input this stage already stales on. And a
  // stamp written before this ships carries no entry for either path, so `diffFingerprint` — which walks
  // the RECORDED entries — manufactures no staleness on a run already in flight.
  synthesis: ["owner-decisions.json", "common-law-findings.md", "register-named-band.json", "matter-context.md", "variant-manifest.md", "skeptic-flags.md", "_driver/crowd-context.json", "crowd-context.md", "_driver/plan-execution.json", "register-coverage-ledger.json"],
  "case-law": ["narrative.md"],
  // — NARROWED by one, the reopen receipt, in both rows (synthesis and this one): the mid-run reopening
  // that wrote it left the engine. Narrowing is the safe direction: an input a stage no longer declares is
  // skipped when its stamp is compared (diffFingerprint), so no run in flight reads stale on it.
  "narrative-refutation": ["narrative.md", "owner-decisions.json", "common-law-findings.md", "matter-context.md", "skeptic-flags.md"],
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
  "doubt-closure": ["findings.json", "owner-decisions.json", "register-coverage-ledger.json"],
};

test("hazard 1: stageInputs matches the frozen freshness contract, stage for stage", () => {
  const P = ST.paths("/run");
  const rel = (p) => posixRel(p.slice("/run/".length));
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
  assert.deepEqual(ST.stageInputs("owner-judgment", P, { axes: ["primary-sweep"] }).filter((f) => posixRel(f).includes("register-units/")),
    [P.registerBand("primary-sweep")], "the per-axis unit fan-out still follows `axes`");
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
    const rel = posixRel(e.rel);
    if (e.dir) { assert.ok(existsSync(join(shadowDir, e.rel)), `${stage}: directory ${e.rel} missing from the sandbox`); continue; }
    assert.ok(e.sha, `${stage}: ${e.rel} [${e.kind}] is on the canonical run and was NOT in the sandbox at dispatch`);
    // `shaCanonical` is the sandbox's bytes with the sandbox's own path rewritten back to the run dir.
    // Only the driver-written grid specs differ from `sha` — they name their own output_path, which
    // must point INTO the sandbox; a raw-byte comparison there would flag the rig working correctly.
    // `_driver/register-positions.json` and `_driver/declination-spec.json` are the context artefacts the
    // DRIVER stamps with a wall-clock `ts` as it writes them (pipeline.mjs deriveBandShape and
    // prepareDeclinationSpec). Everything the derivations themselves compute is deterministic, so the
    // comparison strips exactly that one driver-written key and nothing else.
    if (rel === "_driver/register-positions.json" || rel === "_driver/declination-spec.json") {
      const strip = (p) => { const j = JSON.parse(readFileSync(p, "utf8")); delete j.ts; return JSON.stringify(j); };
      assert.equal(strip(join(shadowDir, e.rel)), strip(canonical), `${stage}: ${e.rel} differs from the canonical run (beyond its driver-written ts stamp)`);
    } else {
      assert.equal(e.shaCanonical, sha(canonical), `${stage}: ${e.rel} [${e.kind}] differs BYTE-WISE from what the canonical run held`);
    }
    checked.push(rel);
  }
  return checked;
}

// ── 2. THE TWO KNOWN-BROKEN CASES BECOME THE PROOF ───────────────────────────────────────────────────

// On Windows the grid spec's output_path is written into JSON, where every backslash is doubled, and the
// receipt's canonicalised fingerprint looks for the sandbox path with single ones — so it never rewrites
// the path back and the half spec reads as a different context. That is the product's comparison, not
// this arm's.
test("--experiment common-law-half — the arm RUNS at all, and its context is byte-equal to the canonical run's",
  async () => {
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
  const halfSpec = receipt.edges.find((e) => posixRel(e.rel) === "_driver/grid-spec.half-b.json");
  assert.notEqual(halfSpec.sha, halfSpec.shaCanonical,
    "the re-derived half spec must name an output_path INSIDE the sandbox — if its raw and canonicalised shas are equal it is still dictating writes into the canonical run");
  assert.match(JSON.parse(readFileSync(driverDir(ex.shadowDir, "grid-spec.half-b.json"), "utf8")).output_path,
    new RegExp(`^${escapeRe(ex.shadowDir)}[\\\\/]`), "…and that output_path points at the sandbox, not the canonical run");
  assert.ok(existsSync(driverDir(ex.shadowDir, "grid-spec.json")),
    "the canonical spec the half derives from rides along (the derivation's own read set, pulled in by the closure)");
  console.log(`      common-law-half: ${checked.length} context artefacts byte-equal`);
});

// The band readers were placement, the register digest and synthesis; synthesis is the one left, and it
// carries the band shape arms the digest used to.
test("--experiment synthesis — the derived band shape is IN the sandbox and byte-equal", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const P = ST.paths(runDir);
  assert.ok(existsSync(P.bandShape), "the canonical run must carry _driver/band-shape.json");
  assert.ok(!ST.stageInputs("synthesis", P, { axes: [] }).includes(P.bandShape),
    "…and it must still be UNDECLARED on synthesis — the freshness list is untouched");

  const ex = await PL.runExperiment(job, { codename, experiment: "synthesis", label: "ctx proof" });
  // The band artefacts only, not the whole context: a sandboxed synthesis re-prepares its declination
  // spec without the order's scope, because the sandbox does not carry _driver/instructed-scope.json for
  // this stage. That gap predates this arm (measured on the base commit, 2026-10-01) and is filed rather
  // than fixed here; the band shape is what this arm is about.
  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  for (const rel of ["_driver/band-shape.json", "band-shape.md", "register-named-band.json"]) {
    const e = receipt.edges.find((x) => posixRel(x.rel) === rel);
    assert.ok(e?.sha, `${rel} must be in the sandboxed writer's context — it was the artifact all four #217 arms ran without`);
    assert.equal(e.shaCanonical, sha(join(runDir, e.rel)), `${rel} differs BYTE-WISE from what the canonical run held`);
  }
});

test("band_shape returns ok:true against a sandboxed synthesis (the tier filter is armed)", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const ex = await PL.runExperiment(job, { codename, experiment: "synthesis", label: "band tool" });
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


test("zero semantics: a sandbox that loses a context artefact REFUSES by name, it does not dispatch", () => {
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
  const rels = gaps.map((g) => posixRel(g.rel)).sort();
  assert.deepEqual(rels, ["_driver/band-shape.json", "_records"],
    "the shape and the (empty) records dir are on the canonical run and not in the sandbox — both are gaps");
  assert.equal(gaps.find((g) => posixRel(g.rel) === "_driver/band-shape.json").via, "band-shape", "a gap names WHY the artefact was wanted");
  assert.ok(!rels.includes("_driver/crowd-context.json"),
    "an artefact the CANONICAL run never had is not a gap — pipeline() would not have handed it either");

  // and the same check on a faithful sandbox is silent
  writeFileSync(driverDir(shadow, "band-shape.json"), "{}\n");
  writeFileSync(join(shadow, "_records", "r1.json"), "{}\n");
  assert.deepEqual(SC.sandboxGaps(manifest, canon, shadow), [], "a faithful sandbox reports no gaps");
  rmSync(canon, { recursive: true, force: true }); rmSync(shadow, { recursive: true, force: true });
});

test("an empty directory is MISSING, not present (a _records/ with nothing in it serves no record)", () => {
  const canon = mkdtempSync(join(tmpdir(), "gap-canon2-"));
  const shadow = mkdtempSync(join(tmpdir(), "gap-shadow2-"));
  mkdirSync(join(canon, "_records"), { recursive: true });
  writeFileSync(join(canon, "_records", "r1.json"), "{}\n");
  mkdirSync(join(shadow, "_records"), { recursive: true });   // created, never filled — the copy-loop bug
  const gaps = SC.sandboxGaps([{ path: join(canon, "_records"), kind: "tool-mediated", dir: true }], canon, shadow);
  assert.deepEqual(gaps.map((g) => posixRel(g.rel)), ["_records"], "an empty directory reads as MISSING");
  rmSync(canon, { recursive: true, force: true }); rmSync(shadow, { recursive: true, force: true });
});

// ── 4. THE PROVENANCE ROW, AND THE DRIVER-COMPUTED BLOCKS ────────────────────────────────────────────

test("an --experiment arm writes the order-probe provenance row on its OWN record", async () => {
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

test("a sandboxed synthesis is handed the same list of records to answer as the canonical pass", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const DECLINATIONS = /DECLINATIONS \(MANDATORY\): the judges carried (\d+) record\(s\)/;
  const canonical = readFileSync(driverDir(runDir, "synthesis.attempt1.dispatch.txt"), "utf8").match(DECLINATIONS);
  assert.ok(canonical, "the canonical synthesis pass must carry a list for this to be testing anything");

  const ex = await PL.runExperiment(job, { codename, experiment: "synthesis", label: "declinations" });
  const arm = readFileSync(driverDir(ex.shadowDir, "synthesis.attempt1.dispatch.txt"), "utf8").match(DECLINATIONS);
  assert.ok(arm, "the arm's dispatch carries no list: it replays a synthesis production never runs");
  assert.equal(arm[1], canonical[1], "and the list is the canonical pass's, record for record");
});

// ── 5. THE DECLARATION CANNOT DRIFT AWAY FROM verify.mjs ─────────────────────────────────────────────

test("drift guard: every _driver sidecar verify.mjs resolves is declared for some stage", () => {
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
  // 13 until the register digest's validator went (2026-10-01), taking coverage-enum.json and
  // register-plan.json with it; 11 since.
  assert.ok(found.size >= 11,
    `the sidecar extractor found only ${found.size} names in verify.mjs — it found 11 after the digest's validator went. `
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

test("→ #256: an order-SEEDED arm re-executes the band-shape seams instead of replaying them", async () => {
  const { job, runDir, codename } = await canonicalRun();
  const before = process.env.CLEAROTRON_ORDER_PROBE_SEED;
  process.env.CLEAROTRON_ORDER_PROBE_SEED = "7";
  let ex;
  try { ex = await PL.runExperiment(job, { codename, experiment: "synthesis", label: "seeded" }); }
  finally { if (before === undefined) delete process.env.CLEAROTRON_ORDER_PROBE_SEED; else process.env.CLEAROTRON_ORDER_PROBE_SEED = before; }

  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  assert.equal(receipt.seed, 7, "the arm records the seed it ran under — an unattributable arm is the failure the probe row exists to prevent");
  assert.ok(receipt.derived.includes("band-shape"), "the band-shape derivation RAN in the sandbox");
  // THE POINT. All three probeOrder seams sit inside band-shape.mjs's derivation functions, so a rig
  // that replayed a persisted band-shape.json would hand the seeded arm the UNSEEDED artefact and the
  // arm would come back byte-identical to its control — which is exactly what happened to all four
  // arms. Because the rig derives, the seeded shape moves.
  const shape = receipt.edges.find((e) => posixRel(e.rel) === "_driver/band-shape.json");
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

test("--experiment report-card rebuilds its INLINE context, and refuses when it cannot", async () => {
  const { job, runDir, codename } = await canonicalCardRun();
  // findings.json is a passed-inline edge: the agent never opens it, so it is NOT in the sandbox.
  const P = ST.paths(runDir);
  assert.ok(!SC.sandboxManifest("report-card", P, {}).some((e) => e.path === P.findings),
    "findings.json is passed INLINE — copying it into the sandbox would model an edge that does not exist");
  const ords = (JSON.parse(readFileSync(P.findings, "utf8")).findings ?? []).map((f) => Number(f.ordinal));
  assert.ok(ords.length, "the canonical run must carry rated findings for this case to exist");

  const ex = await PL.runExperiment(job, { codename, experiment: "report-card", axis: String(ords[0]), label: "inline" });
  assert.match(ex.shadowDir, /[\\/]_experiments[\\/]/, "the card arm ran sandboxed");
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
test("x #251: --axis is a per-stage membership test, and a stage that takes none still refuses one", async () => {
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

test("--dispatch-trigger refuses an unknown value rather than composing a quietly different arm", async () => {
  const { job, codename } = await canonicalRun();
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "synthesis", dispatchTrigger: "corective" }),
    /unknown value "corective"/, "a typo in the trigger must refuse — it decides which prompt blocks compose");
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
// it opens, matched against what the tool-group table declares. A new server that reads a file the driver
// writes is caught on the commit that adds it, with no edit here.
//
// IT TELLS A READ FROM A WRITE, AND THAT IS WHY IT NO LONGER FILTERS BY EXTENSION. It used to keep a file
// only when its name ended in `.json`, and that filter was standing in for the real question. Every file
// a server WRITES happens to end in `.jsonl` (its own call and reading logs), and so did one file a server
// READS (the band's record log), so excluding `.jsonl` excluded exactly the writes — and that one read,
// which a sandbox then ran without. Widening the extension alone would demand declarations for the
// servers' own outputs, which is not what a declaration means. So each use is classified: a file is a
// read if any use reads it, a write if every use writes it, and a use the walk cannot classify fails the
// arm rather than being guessed.
// A call whose name begins append or write writes: the node calls, and a server's own logging helper
// (the judges' server logs every request through `appendRequestLog`).
const WRITERS = /^(append[A-Z]\w*|write[A-Z]\w*|createWriteStream|atomicWrite)$/;
const NEUTRAL = /^(mkdirSync|dirname)$/;

/** Each driver-written file a server names, with how the server uses it: read, write, or unclassified. */
function driverFileUses(src) {
  const lines = src.split("\n");
  const consts = new Map([...src.matchAll(/const\s+([A-Z_]+)\s*=\s*"([^"]+\.[a-z]+)"/g)].map((m) => [m[1], m[2]]));
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The call whose FIRST argument is `expr` on this line, or null: `readFileSync(expr`, `appendFileSync(expr`.
  const callOn = (line, expr) => line.match(new RegExp(`([A-Za-z_$][\\w$]*)\\(\\s*${expr}`))?.[1] ?? null;
  // What one line does with `expr`: the call it is handed to (a write, a read, or neutral), or else the
  // local name it is bound to.
  const useOf = (line, expr) => {
    const fn = callOn(line, expr);
    if (fn) return WRITERS.test(fn) ? { write: true } : NEUTRAL.test(fn) ? { neutral: true } : { read: true };
    const bound = line.match(new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;]*${expr}`));
    return bound ? { bind: bound[1] } : null;
  };
  // A local name lives until its function ends: the next line that closes a top-level block or opens a
  // new top-level declaration. Followed further, one function's `p` would be read as another's.
  const scopeEnd = (from) => {
    for (let i = from; i < lines.length; i++) if (/^(\}|(export\s+)?(async\s+)?function\b|const\s)/.test(lines[i])) return i;
    return lines.length;
  };
  // Every use of `expr` from line `from` on, following a local binding through the rest of its scope.
  const usesFrom = (expr, from, to = lines.length) => {
    const out = [];
    for (let i = from; i < to; i++) {
      if (!new RegExp(expr).test(lines[i])) continue;
      const u = useOf(lines[i], expr);
      if (!u) continue;
      if (u.bind) out.push(...usesFrom(`\\b${esc(u.bind)}\\b`, i + 1, scopeEnd(i + 1)));
      else out.push(u);
    }
    return out;
  };
  const found = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/driverDir\([^,()]+,\s*([A-Za-z_]+|"[^"]+")\s*\)/g)) {
      const tok = m[1];
      const name = tok.startsWith('"') ? tok.slice(1, -1) : consts.get(tok);
      if (!name) continue;
      // The handle the rest of the file uses: a path function (`const f = () => driverDir(…)`, or one
      // whose body returns it), a local name, or the expression itself where it is used inline.
      // A block body counts only where this line RETURNS the path: an arrow that merely reads the file
      // inside its own body (an initialiser, say) hands its callers a value, not a path.
      const fnHead = (line.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*driverDir\(/)
        ?? (/\breturn\b[^;]*driverDir\(/.test(line)
          ? lines.slice(Math.max(0, i - 4), i).reverse().map((l) => l.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*\{/)).find(Boolean)
          : null));
      let uses;
      if (fnHead) uses = usesFrom(`\\b${esc(fnHead[1])}\\(\\)`, 0);
      else {
        const inline = esc(m[0]);
        const u = useOf(line, inline);
        uses = !u ? [] : u.bind ? usesFrom(`\\b${esc(u.bind)}\\b`, i + 1, scopeEnd(i + 1)) : [u];
      }
      const read = uses.some((u) => u.read), write = uses.some((u) => u.write);
      found.push({ name, kind: read ? "read" : write ? "write" : "unclassified" });
    }
  });
  return found;
}

test("every MCP server that reads a driver-written file has a declared tool-group edge", () => {
  const MCP = join(HERE, "..", "engine", "mcp");
  const servers = readdirSync(MCP).filter((f) => f.endsWith("-server.mjs"));
  assert.ok(servers.length >= 10,
    `only ${servers.length} server(s) discovered — the walk broke and a clean result below would mean nothing`);

  const uses = servers.flatMap((f) => driverFileUses(readFileSync(join(MCP, f), "utf8")).map((u) => ({ ...u, server: f })));
  const unclassified = uses.filter((u) => u.kind === "unclassified").map((u) => `${u.name} (${u.server})`);
  assert.deepEqual(unclassified, [],
    "the walk found a driver-written file it cannot tell is read or written — it refuses to guess, because a "
    + "read guessed as a write is exactly the file a sandbox then runs without. Teach driverFileUses the call.");
  const reads = uses.filter((u) => u.kind === "read");
  const writes = uses.filter((u) => u.kind === "write");
  // FLOORS ON BOTH HALVES, and on the extension the old filter hid: a walk that classified nothing, or
  // classified every `.jsonl` one way, would satisfy the declaration check below by accident.
  assert.ok(reads.length >= 4,
    `only ${reads.length} driver-written read(s) found across ${servers.length} servers — the matcher stopped `
    + "matching, and an empty result here is exactly the silence this arm exists to refuse");
  assert.ok(writes.length >= 3, `only ${writes.length} driver-written write(s) found — the read/write split is not being exercised`);
  assert.ok(reads.some((u) => u.name.endsWith(".jsonl")), "no `.jsonl` read is in the population — the extension is hiding a read again");

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

test("every file a tool group declares reaches the sandbox of every stage granted that group", () => {
  // A declaration is only half the guarantee: the other half is that the stage holding the tools gets the
  // file in its sandbox copy, or the grant and the stage disagree. Asserted for every group and every stage
  // granted it, so a new edge, or a new grant, is held to it without an edit here.
  const P = ST.paths("/run");
  let pairs = 0;
  const missing = [];
  const reached = new Set();
  for (const stage of Object.keys(ST.STAGES)) {
    const groups = toolGroupsForStage(stage).filter((g) => SC.TOOL_GROUP_EDGES[g]);
    if (!groups.length) continue;
    const manifest = new Set(SC.sandboxManifest(stage, P, { axes: ST.REGISTER_AXES }).map((e) => basename(String(e.path))));
    for (const g of groups) {
      for (const e of SC.TOOL_GROUP_EDGES[g](P) ?? []) {
        pairs++;
        const name = basename(String(e.path));
        if (manifest.has(name)) reached.add(name); else missing.push(`${name} (${g}) → ${stage}`);
      }
    }
  }
  assert.ok(pairs >= 20, `only ${pairs} declared-file × granted-stage pairs — the derivation broke, not the declarations`);
  assert.ok(reached.has("register-record-bodies.jsonl"), "the band's record log reaches no granted stage's sandbox");
  assert.deepEqual(missing, [], "a tool group declares a file that the sandbox of a stage granted that group does not carry");
});

test("the walk tells a read from a write: the logs the servers write are never demanded as inputs", () => {
  // THE CONTROL the extension filter never had. Each shape below is one a server uses today: a path
  // function written to, a local name written to, a path function whose body returns the path, a path
  // function read through a local name, a read inline, and a read inside an initialiser's own body. A walk that misclassifies any of them either
  // demands a declaration for an output or misses an input.
  const src = [
    'const logPath = () => driverDir(RUN_DIR, "a-log.jsonl");',
    'function note() { appendFileSync(logPath(), "x"); }',
    'function other() {',
    '  const p = driverDir(RUN_DIR, "b-log.jsonl");',
    '  mkdirSync(dirname(p), { recursive: true });',
    '  appendFileSync(p, "x");',
    '}',
    'const callLog = () => {',
    '  const dir = process.env.X;',
    '  return dir ? driverDir(dir, "c-log.jsonl") : null;',
    '};',
    'function event(row) {',
    '  const path = callLog();',
    '  if (!path) return;',
    '  appendFileSync(path, row);',
    '}',
    'const PRESET = (() => {',
    '  const p = JSON.parse(readFileSync(driverDir(RUN_DIR, "a-policy.json"), "utf8"));',
    '  return p.preset;',
    '})();',
    'const ledgerPath = () => driverDir(RUN_DIR, "bodies.jsonl");',
    'function body(uri) {',
    '  const p = ledgerPath();',
    '  if (!existsSync(p)) return null;',
    '  return readFileSync(p, "utf8");',
    '}',
    'const log = (row) => appendRequestLog(driverDir(runDir, "d-log.jsonl"), row);',
    'const SPEC = "a-spec.json";',
    'const spec = JSON.parse(readFileSync(driverDir(runDir, SPEC), "utf8"));',
  ].join("\n");
  const kinds = Object.fromEntries(driverFileUses(src).map((u) => [u.name, u.kind]));
  assert.deepEqual(kinds, { "a-log.jsonl": "write", "b-log.jsonl": "write", "c-log.jsonl": "write", "d-log.jsonl": "write",
    "bodies.jsonl": "read", "a-spec.json": "read", "a-policy.json": "read" });
});

