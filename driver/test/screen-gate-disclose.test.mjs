// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end through the screen-gate disclosure
// screen-gate DISCLOSE-AND-CONTINUE, which replaced an earlier fail-loud arm:
// an in-scope live mark dropped on goods whose official record cannot be retrieved is marked
// UNEXAMINED — "couldn't fetch", NOT failed. The run continues; the disclosure rides three joined
// surfaces: ctx + the durable _driver/screen-gate-unresolved.json sidecar (the floor's clamp input),
// a per-mark coverage-limited row on findings.json (reader-visible), and the coverage floor's
// CLEAR→CONDITIONAL clamp so nobody relies on the mark as clean. Unit half tests the exported
// readers; e2e half runs the mock pipeline (legacy funnel-OFF dispatch — the funnel-ON path is
// exercised in digest-funnel.pipeline.test.mjs). All fixtures use invented marks (no client data).
// SAFETY GUARD (repo convention): pin the workspace root + call ledger BEFORE any driver import —
// driver.config freezes workspaceRoot at first import with a production default.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "prelim-sgd-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScreenGateUnresolved, injectScreenGateCoverage } from "../pipeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

// ── unit half: the exported ctx/sidecar readers ─────────────────────────────────────────────────────

function mkRun({ sidecar = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sgd-unit-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (sidecar) writeFileSync(driverDir(dir, "screen-gate-unresolved.json"), JSON.stringify(sidecar, null, 2) + "\n");
  return dir;
}
const UNRESOLVED = [
  { mark: "KINETIC", uri: "/mark/cn/88001-42", cause: "record 404 (provider)" },
  { mark: "GLASS LANTERN", uri: null, cause: "drop row names no record URI — the dismissal cannot be examined or audited" },
];
const quiet = () => {};

test("loadScreenGateUnresolved: ctx rows win; the sidecar is the resume shape; absent/corrupt ⇒ []", () => {
  const dir = mkRun({ sidecar: { ts: "t", unresolved: UNRESOLVED } });
  // in-process: this session's gate produced ctx — the sidecar (possibly older) must not override it
  const ctxRows = [{ mark: "OTHER", uri: "/mark/us/1", cause: "x" }];
  assert.deepEqual(loadScreenGateUnresolved(dir, { screenGateUnresolved: ctxRows }), ctxRows, "ctx preferred");
  // resume shape: no ctx (the disclosing process died) — the floor reads the durable sidecar
  assert.deepEqual(loadScreenGateUnresolved(dir, {}), UNRESOLVED, "sidecar-only read (resume)");
  assert.deepEqual(loadScreenGateUnresolved(dir, { screenGateUnresolved: [] }), UNRESOLVED, "an EMPTY ctx array is not a disclosure — fall through");
  // nothing anywhere ⇒ no disclosure owed
  assert.deepEqual(loadScreenGateUnresolved(mkRun(), {}), [], "absent sidecar");
  const corrupt = mkRun();
  writeFileSync(driverDir(corrupt, "screen-gate-unresolved.json"), "{ torn");
  assert.deepEqual(loadScreenGateUnresolved(corrupt, {}), [], "corrupt sidecar never throws");
});

// an invented-mark findings.json (schema v2; coverage alone keeps it valid — the cn-scope-honesty fixture shape)
const FINDINGS_DOC = { schema_version: 2, findings: [], coverage: [{ area: "register / US", state: "confirmed-clean", note: "" }] };

test("injectScreenGateCoverage: one coverage-limited row PER unresolved mark from the sidecar alone, idempotent, pre-existing rows untouched", () => {
  const dir = mkRun({ sidecar: { ts: "t", unresolved: UNRESOLVED } });
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify(FINDINGS_DOC, null, 2));
  injectScreenGateCoverage(P, dir, quiet, {});   // no ctx — the resume/sidecar shape
  const once = JSON.parse(readFileSync(P.findings, "utf8"));
  const rows = once.coverage.filter((c) => String(c.area).startsWith("Unexamined drop /"));
  assert.equal(rows.length, 2, "one row per unresolved mark");
  const kinetic = rows.find((c) => c.area.includes("KINETIC"));
  assert.equal(kinetic.area, "Unexamined drop / KINETIC (/mark/cn/88001-42)", "keyed by mark+uri");
  assert.equal(kinetic.state, "coverage-limited", "a disclosed limit — the CONDITIONAL clamp comes from the floor's screenGateGap arm, never this row");
  assert.match(kinetic.note, /official register record could not be retrieved \(record 404 \(provider\)\)/);
  assert.match(kinetic.note, /dropped on goods, could not be examined; verify this record before relying/);
  const unnamed = rows.find((c) => c.area.includes("GLASS LANTERN"));
  assert.equal(unnamed.area, "Unexamined drop / GLASS LANTERN", "no URI ⇒ mark alone keys the row");
  assert.match(unnamed.note, /names no record URI/);
  // resume/re-entry: a second pass must not duplicate
  injectScreenGateCoverage(P, dir, quiet, {});
  const twice = JSON.parse(readFileSync(P.findings, "utf8"));
  assert.equal(twice.coverage.filter((c) => String(c.area).startsWith("Unexamined drop /")).length, 2, "idempotent by mark+uri");
  assert.equal(twice.coverage[0].area, "register / US", "the pre-existing coverage row is untouched");
});

test("injectScreenGateCoverage: no unresolved set ⇒ findings.json byte-identical; corrupt findings ⇒ never-kill, left byte-identical", () => {
  const clean = mkRun();
  const cleanP = { findings: join(clean, "findings.json") };
  const body = JSON.stringify(FINDINGS_DOC, null, 2);
  writeFileSync(cleanP.findings, body);
  injectScreenGateCoverage(cleanP, clean, quiet, {});
  assert.equal(readFileSync(cleanP.findings, "utf8"), body, "no disclosure owed ⇒ untouched");
  const corrupt = mkRun({ sidecar: { ts: "t", unresolved: UNRESOLVED } });
  const corruptP = { findings: join(corrupt, "findings.json") };
  writeFileSync(corruptP.findings, "{ not json");
  injectScreenGateCoverage(corruptP, corrupt, quiet, {});   // must not throw
  assert.equal(readFileSync(corruptP.findings, "utf8"), "{ not json", "never-kill: a corrupt findings.json is left alone");
});

// ── e2e half: the legacy (funnel-OFF) pipeline against the mock engine ──────────────────────────────

const JOB = {
  id: "test-job-sgd", msgId: "<sgd@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8301", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// Fresh module graph + env per run; `reuse` re-enters an existing run (the resume shape).
async function runMockPipeline(env, opts = {}, reuse = null) {
  const root = reuse?.root ?? mkdtempSync(join(tmpdir(), "prelim-sgd-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF",
    "CLEAROTRON_SCREEN_GATE_UNNAMED"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(reuse?.codename ? { codename: reuse.codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}
const unexaminedRows = (runDir) =>
  (JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).coverage ?? [])
    .filter((c) => String(c.area).startsWith("Unexamined drop /"));

test("(a+b+c) terminal violations no longer throw: the run delivers with ctx+sidecar populated, action disclose-clamp, CLEAR→CONDITIONAL naming the mark, and the coverage row injected", async () => {
  // MOCK_SCREEN_DROP=persist: the digest re-emits the same surface drop after the re-decide AND the
  // driver code-fetch 404s — the exact shape that fail-louded a whole ION report on 2026-07-22.
  const fetched = [];
  const recordFetcher = async (uri) => { fetched.push(uri); return { ok: false, cause: "record 404 (mock — unretrievable)" }; };
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist" }, { recordFetcher });

  assert.equal(res.ok, true, `never a dead run: ${JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage })}`);
  assert.ok(!existsSync(join(res.runDir, ".failed")), "no .failed sentinel");
  assert.ok(existsSync(join(res.runDir, ".delivered")) || res.runDir.includes("/archive/"), "delivered");
  assert.ok(fetched.includes("/mark/cn/88001-42"), "the driver still tried the targeted code-fetch first");

  // the event: same fields as before (count/uris/failures), action flipped fail-loud → disclose-clamp
  const unresolved = events.find((e) => e.event === "screen-gate-unresolved");
  assert.equal(unresolved?.action, "disclose-clamp");
  assert.equal(unresolved.count, 1);
  assert.deepEqual(unresolved.uris, ["/mark/cn/88001-42"]);
  assert.ok(unresolved.failures.some((f) => f.uri === "/mark/cn/88001-42" && /404/.test(f.cause)), "failures ride the event");

  // the durable sidecar (the receipt idiom — survives a crash between gate and delivery)
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-unresolved.json"), "utf8"));
  // — `cause_source` says WHICH of three this is. "the provider refused" and "the fetch reported ok
  // and the gate still cannot see the record" have different fixes and used to print identically.
  assert.deepEqual(sidecar.unresolved, [{ mark: "KINETIC", uri: "/mark/cn/88001-42",
    cause: "record 404 (mock — unretrievable)", cause_source: "provider" }]);

  // the clamp: CLEAR→CONDITIONAL via the floor's screenGateGap arm, marks named in the reason
  assert.equal(res.verdict, "CONDITIONAL", "clamped — the unexamined mark cannot ship as clean");
  assert.ok(events.some((e) => e.event === "coverage-floor-clamp" && e.screenGate === 1), "screenGateGap floor arm fired");
  const verdictSidecar = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.ok(verdictSidecar.reasons.some((r) => r.includes("KINETIC") && r.includes("could not be record_fetched")), "clamp reason names the mark");
  assert.equal(verdictSidecar.kinds.screenGate, true, "the reason KIND survives for the report bound line");

  // the reader-visible disclosure: exactly one coverage-limited row naming the mark
  const rows = unexaminedRows(res.runDir);
  assert.equal(rows.length, 1, "one row for the one unresolved mark");
  assert.ok(rows[0].area.includes("KINETIC") && rows[0].area.includes("/mark/cn/88001-42"));
  assert.equal(rows[0].state, "coverage-limited");
  assert.match(rows[0].note, /verify this record before relying/);
});

test("(b resume) the disclosure survives a park: pass 1 discloses then dies mid-delivery; the resume delivers CONDITIONAL with ONE coverage row (idempotent across passes)", async () => {
  // pass 1: disclose + clamp + inject happen, then the run parks at report-overview — the crash window
  // the durable sidecar exists for.
  const failingFetcher = async () => ({ ok: false, cause: "record 404 (mock — unretrievable)" });
  const p1 = await runMockPipeline({ MOCK_SCREEN_DROP: "persist", MOCK_FAIL_STAGE: "record_report_overview" }, { recordFetcher: failingFetcher });
  assert.equal(p1.res.ok, false, "pass 1 parks at report-overview (NOT the screen-gate)");
  assert.notEqual(p1.res.failedStage, "screen-gate", "the gate no longer kills runs");
  assert.ok(existsSync(driverDir(p1.res.runDir, "screen-gate-unresolved.json")), "the disclosure survives the park on disk");

  // pass 2: resume with the record STILL unretrievable — re-disclose, re-clamp, deliver.
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const p2 = await runMockPipeline({ MOCK_SCREEN_DROP: "persist" }, { recordFetcher: failingFetcher }, { root: p1.root, codename });
  assert.equal(p2.res.ok, true, JSON.stringify({ ok: p2.res.ok, fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.equal(p2.res.verdict, "CONDITIONAL", "the clamp holds across the park");
  assert.equal(unexaminedRows(p2.res.runDir).length, 1, "still exactly ONE row — the injection is idempotent by mark+uri across passes");
  assert.ok(existsSync(join(p2.res.runDir, ".delivered")) || p2.res.runDir.includes("/archive/"), "resume delivered");
});

test("(d) no violations ⇒ byte-identical behavior: no sidecar, no unresolved event, no coverage row, CLEAR delivered", async () => {
  const { res, events } = await runMockPipeline({}, {});
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CLEAR", "nothing to disclose, nothing to clamp");
  assert.ok(!existsSync(driverDir(res.runDir, "screen-gate-unresolved.json")), "no sidecar minted");
  assert.ok(!events.some((e) => e.event === "screen-gate-unresolved"), "no disclosure event");
  assert.ok(events.some((e) => e.event === "screen-gate-clean"), "gate clean");
  assert.equal(unexaminedRows(res.runDir).length, 0, "no injected rows");
});

test("(e) the fixable-row path heals at the flush: re-decide corrects the drop → recovered clean, sidecar cleared, no clamp", async () => {
  // MOCK_SCREEN_DROP=1 — the queued re-decide heals the row in the settlement flush. The mechanism
  // discloses TRANSIENTLY (the re-decide is deferred, so at gate time the drop is still unexamined), and
  // the post-flush recheck heals it: sidecar cleared, clamp lifted. A healed gap must not keep clamping.
  //
  // HOW IT HEALS CHANGED AT CONVERSION 11, and the old route was a loophole. It used to heal by the seat
  // retyping the record's own `screen_verdict` as `drop:off-field-confirmed`, which takes the row out of
  // this gate's scope — a seat rewriting the screen's provenance to change how a gate judged its own
  // drop. The driver renders that cell from the band now, so it is not expressible. The re-decide heals
  // the way the driver's followup words it instead ("KEEP IT AS A CONFLICT/FINDING if in-field"): the
  // seat changes its DECISION and the record takes a Sheet-1 row. Same property, honest route.
  const fetched = [];
  const recordFetcher = async (uri) => { fetched.push(uri); return { ok: false, cause: "mock no-op (re-decide path)" }; };
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "1" }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(fetched.includes("/mark/cn/88001-42"), "targeted code-fetch still fired");
  assert.ok(events.some((e) => e.event === "screen-gate-clean" && e.recovered === true), "recovered clean after the flush");
  assert.ok(!existsSync(driverDir(res.runDir, "screen-gate-unresolved.json")), "sidecar cleared once the flush healed the gap");
  assert.equal(res.verdict, "CLEAR", "no clamp — the drop now rests on examined goods");
  assert.equal(unexaminedRows(res.runDir).length, 0, "no injected rows");
});
