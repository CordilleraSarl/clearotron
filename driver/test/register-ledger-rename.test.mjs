// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the shared register ledger stops wearing one vendor's name, WITHOUT moving any box off its
// existing file.
//
// The unit tests for the resolver itself are providers/_shared/test/ledger-path.test.mjs. These are the
// three places the rename could still go wrong end to end:
//   · a deployed box, upgraded, silently reading a file that is not there  (acceptance criterion 2)
//   · a spawned MCP server re-deriving a different path than the driver that reads what it writes
//   · a product module still naming a vendor for this ledger                (acceptance criterion 1)

import { test } from "node:test";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { assembleRunRecords } from "../registry-fidelity.mjs";
import { SUITE_TELEMETRY_DIR_ENV } from "../../providers/_shared/ledger-path.mjs";   //
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

// driver.config.mjs freezes REGISTER_PROVIDER at module load and made an unset value a hard
// refusal, so the value has to exist BEFORE gather-config's import chain runs — hence the dynamic
// import. A static one is hoisted above this line and the build refuses by name.
pinEnv(process.env, "CLEAROTRON_DATABASE", envFrom(process.env, "CLEAROTRON_DATABASE") ?? "corsearch");
const { buildGatherMcpConfig } = await import("../engine/mcp/gather-config.mjs");

const REPO = join(fileURLToPath(new URL("../..", import.meta.url)));
const PREFIX = "prelim-tmp594-aa-";
const ROW = (target, body) => JSON.stringify({
  ts: "t", sessionKey: `agent:clawdi:${PREFIX}register-unit-x`, target, body,
}) + "\n";

const HOME_WAS = process.env.HOME;
// moved the telemetry DIRECTORY as well (the platform dot-directory -> ~/trademark/telemetry), and the
// resolver answers over both. `files` land in the LEGACY directory because that is what these tests are
// about — an upgraded box, which is production; pass `neutralFiles` for the current-home cases.
function fakeHome(files = {}, neutralFiles = {}) {
  const h = mkdtempSync(join(tmpdir(), "led594-"));
  const tel = join(h, ".openclaw", "telemetry");
  const cur = join(h, "trademark", "telemetry");
  mkdirSync(tel, { recursive: true });
  mkdirSync(cur, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(tel, name), body);
  for (const [name, body] of Object.entries(neutralFiles)) writeFileSync(join(cur, name), body);
  process.env.HOME = h;
  // — THE SUITE REDIRECT IS LIFTED FOR THE LIFE OF THE FAKE HOME, and that is the point of it
  // rather than a workaround. `npm test` exports CLEAROTRON_SUITE_TELEMETRY_DIR so a suite run's ledgers
  // land in its own temp root instead of the box's; these tests exist to walk the BOX ladder, and a
  // faked home is exactly the claim "for the next few lines, behave like a box". Leaving the redirect
  // in force would short-circuit the ladder above the first rung and every assertion below would pass
  // or fail for a reason that has nothing to do with what it is testing.
  SUITE_WAS = process.env[SUITE_TELEMETRY_DIR_ENV];
  delete process.env[SUITE_TELEMETRY_DIR_ENV];
  return tel;
}
let SUITE_WAS;
const restoreHome = () => {
  if (HOME_WAS === undefined) delete process.env.HOME; else process.env.HOME = HOME_WAS;
  if (SUITE_WAS === undefined) delete process.env[SUITE_TELEMETRY_DIR_ENV];
  else pinEnv(process.env, SUITE_TELEMETRY_DIR_ENV, SUITE_WAS);
};

// ──: the RECORD log left the home directory, and the ladder no longer reaches it ───────────────
//
// The five tests that used to live here pinned 's existence ladder as `assembleRunRecords` walked
// it — legacy name read where it sits, neutral name preferred, unread sibling announced. That contract
// is now the CALL ledger's alone, and its unit coverage is providers/_shared/test/ledger-path.test.mjs.
// What replaces them is the pair that makes the move non-silent: the global file is NOT read, and an
// operator is told it exists.

const RUN_LOG = (runDir) => driverDir(runDir, "register-record-bodies.jsonl");
function runDirWithRecords(rows) {
  const runDir = mkdtempSync(join(tmpdir(), "run743-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(RUN_LOG(runDir), rows);
  return runDir;
}

test("#743 the record log is read from THE RUN, not from the home directory", () => {
  // Both present, different rows. The run's own log is the one that answers — if the global leg were
  // still unioned in, `fromLedger` would be 2 and a run would be citing another run's evidence.
  fakeHome({ "corsearch-records.jsonl": ROW("/mark/eu/018922211", { registrationNumber: "GLOBAL" }) });
  try {
    const runDir = runDirWithRecords(ROW("/mark/us/86272665", { registrationNumber: "4641314" }));
    const r = assembleRunRecords(runDir, PREFIX);
    assert.equal(r.fromLedger, 1);
    assert.equal(r.records.get("/mark/us/86272665").registrationNumber, "4641314");
    assert.equal(r.records.has("/mark/eu/018922211"), false, "the box-global record log is not a source any more");
    assert.equal(r.ledgerError, null);
  } finally { restoreHome(); }
});

test("#743 an upgraded box is TOLD its global record log is retired — the cutover is never silent", () => {
  // Production carries 432 MB here and test 2.0 GB. Nothing reads either now. Saying nothing would leave
  // an operator with a large file, no explanation, and no reason to think anything had changed.
  const tel = fakeHome({ "corsearch-records.jsonl": ROW("/mark/eu/018922211", { registrationNumber: "9" }) });
  try {
    const r = assembleRunRecords(runDirWithRecords(""), PREFIX);
    assert.ok(r.ledgerNotice, "a large file that nothing reads is an absence, and an absence is a finding");
    assert.match(r.ledgerNotice, /RETIRED/);
    assert.match(r.ledgerNotice, /corsearch-records\.jsonl/, "…named, so the operator knows which file to archive");
    assert.equal(r.ledgerError, null, "a retired file is not a read failure");
    assert.ok(statSync(join(tel, "corsearch-records.jsonl")).size > 0, "and nothing deletes it — archiving is the operator's");
  } finally { restoreHome(); }
});

test("#594 the CALL ledger's legacy-name notice survives the record log's move", () => {
  // `ledgerDeprecationNotice` had ONE product caller: the record line that replaced. Production's
  // call ledger is still `corsearch-calls.jsonl`, still global and still live — losing this would leave
  // an operator with no way to learn the neutral name exists.
  fakeHome({ "corsearch-calls.jsonl": "x" });
  try {
    const r = assembleRunRecords(runDirWithRecords(""), PREFIX);
    assert.ok(r.ledgerNotice, "the call ledger's own resolution is still announced");
    assert.match(r.ledgerNotice, /legacy call ledger/);
    assert.match(r.ledgerNotice, /corsearch-calls\.jsonl/);
  } finally { restoreHome(); }
});

test("#743 NEITHER log present is a genuine empty, not a loud failure and nothing to announce", () => {
  // A run before its first fetch has no record log, and that is ordinary. This is the pin that stops
  // someone 'fixing' the guard below by throwing on ENOENT.
  fakeHome({});
  try {
    const r = assembleRunRecords(mkdtempSync(join(tmpdir(), "run743-")), PREFIX);
    assert.equal(r.fromLedger, 0);
    assert.equal(r.ledgerError, null, "'no records yet' is not 'the log could not be read'");
    assert.equal(r.ledgerNotice, null, "and a fresh install has nothing to archive");
  } finally { restoreHome(); }
});

test("#743 an EXPLICIT record-log path is the one walked", () => {
  // Every test that pins a fixture log passes one positionally, and any future one-off audit will too.
  fakeHome({ "corsearch-records.jsonl": ROW("/mark/eu/018922211", { registrationNumber: "9" }) });
  try {
    const runDir = mkdtempSync(join(tmpdir(), "run743-"));
    const explicit = join(runDir, "my-own-log.jsonl");
    writeFileSync(explicit, ROW("/mark/us/86272665", { registrationNumber: "4641314" }));
    const r = assembleRunRecords(runDir, PREFIX, explicit);
    assert.equal(r.fromLedger, 1);
    assert.ok(r.records.has("/mark/us/86272665"), "the explicit path is the one walked");
  } finally { restoreHome(); }
});

// ── the spawned server gets a resolved path, not a guess ────────────────────────────────────────────

test("#594/#743 a spawned register server is handed a RESOLVED call ledger and THIS RUN's record log", () => {
  fakeHome({ "corsearch-records.jsonl": "x", "corsearch-calls.jsonl": "x" });
  try {
    const runDir = mkdtempSync(join(tmpdir(), "run743-"));
    const cfg = buildGatherMcpConfig(["register"], { sessionKey: "prelim-x-y-z", agent: "clawdi", runDir });
    const env = cfg.mcpServers.register.env;
    assert.ok(env.CLEAROTRON_REGISTER_CALL_LOG, "unconditional — the old line forwarded nothing on every real box");
    assert.match(env.CLEAROTRON_REGISTER_CALL_LOG, /corsearch-calls\.jsonl$/,
      "the CALL ledger stays box-global, resolved by the driver including the legacy filename fallback");
    assert.equal(env.CLEAROTRON_REGISTER_RECORD_LOG, RUN_LOG(runDir),
      "#743 — the RECORD log is this run's, so the child cannot append a body where the run will not look");
    assert.equal(env.CORSEARCH_RECORD_LOG, undefined, "the vendor-named key is not forwarded");
    assert.equal(env.CORSEARCH_CALL_LOG, undefined);
  } finally { restoreHome(); }
});

test("#1390 no run dir REFUSES — the box-global record ledger is retired, not a fallback", () => {
  // This arm asserted the opposite until, on the reasoning that "losing a record body is worse
  // than filing it somewhere an operator has been told about". What the operator is told —
  // docs/architecture/06-operations-runbook.md — is that the global file is written by nothing and can
  // be archived with an `mv`. Filing a body there hands it to the next archive step.
  fakeHome({ "corsearch-records.jsonl": "x" });
  try {
    assert.throws(
      () => buildGatherMcpConfig(["register"], { sessionKey: "prelim-x-y-z", agent: "clawdi" }),
      /record bodies\s+belong to their run|needs the run it is fetching for/,
      "a register server was built with no run — its bodies would land in the retired global ledger");
    // And the refusal is about the RUN, not about registers in general: with one, it builds.
    const runDir = mkdtempSync(join(tmpdir(), "run1390-"));
    const cfg = buildGatherMcpConfig(["register"], { sessionKey: "prelim-x-y-z", agent: "clawdi", runDir });
    assert.equal(cfg.mcpServers.register.env.CLEAROTRON_REGISTER_RECORD_LOG, RUN_LOG(runDir));
  } finally { restoreHome(); }
});

test("#1390 a config with NO register server still builds without a run — the refusal is scoped", () => {
  // caselaw is bridges only and perplexity writes no record bodies; neither needs a run dir, and a
  // refusal that caught them would be a wider change than the issue asked for.
  fakeHome({ "corsearch-records.jsonl": "x" });
  try {
    assert.ok(buildGatherMcpConfig(["perplexity"], { sessionKey: "k", agent: "clawdi" }).mcpServers.perplexity);
    assert.equal(buildGatherMcpConfig(["perplexity"], { sessionKey: "k" }).mcpServers.perplexity.env
      .CLEAROTRON_REGISTER_RECORD_LOG, undefined,
      "a server that writes no record bodies must not be handed a record-log path at all");
  } finally { restoreHome(); }
});

// ── criterion 1, stated so it can actually be enforced ──────────────────────────────────────────────
//
// The issue writes this as "`git grep -i corsearch driver/` returns only the vendor's own adapter",
// which cannot pass as written: `corsearch` appears legitimately ~80 times across driver/ as a PROVIDER
// (its capability table, its query shape, its record fields, its enforcement telemetry). The criterion
// is about the SHARED LEDGER, so that is what this pins: no product module may name a vendor when it
// means this ledger. Tests and docs are exempt by design — the alias needs regression coverage and the
// deprecation needs documenting.

const LEDGER_VENDOR_NAME = /CORSEARCH_(CALL|RECORD)_LOG|corsearch-(calls|records)\.jsonl/;
const RESOLVER = "providers/_shared/ledger-path.mjs";   // must name them: it is what maps old to new

// EMPTY, AND THAT IS THE POINT (, second pass). It carried one entry: a historical note inside
// driver/pipeline.mjs that named the old env var, left alone because another agent was mid-flight in
// that file. The `tallyCorsearchCalls` rename took the line with it, exactly as the note above said it
// would, so the allowlist has nothing left to excuse.
//
// The SHAPE stays. An entry is keyed on CONTENT, never a line number: pipeline.mjs is 11k lines and
// actively edited, so a numeric pin would either rot into a false failure or drift onto a different
// line and excuse a real one. Keeping the mechanism costs nothing and means the next residual is
// declared with its reason instead of being deleted from a regex nobody reads.
const ALLOWED = [];
const allowed = (rel, line) => ALLOWED.some((a) => a.file === rel && line.includes(a.contains));

// — THE VACUITY CHECK SITS ON THE WALK'S RESULT (`modulesUnder`), not on each read. An
// empty leaf directory is ordinary: `driver/profiles/` is a runtime write target, so a deployed box
// grows an empty `driver/profiles/projects/<key>/` and no clone ever has one, because git stores no
// empty directory.
function* productModules(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "test", ".git", "dist", "bench"].includes(e.name)) continue;
      yield* productModules(p);
    } else if (/\.(mjs|js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) {
      yield p;
    }
  }
}

const LEDGER_ROOTS = ["driver", "providers", "mcp-server", "bin"];

/**
 * The product modules under one root, asked once whether the walk found anything — and FAILING LOUDLY,
 * BY ROOT, when it did not.
 *
 *: this call used to sit inside `try { … } catch { continue; }`. One empty directory under
 * `driver/` — written by the product itself, on every deployed box, unstorable by git so no clone and no
 * CI run ever had one — made the walk throw, the catch ate it, and this arm swept 112 of 369 product
 * modules while reporting green. A guard that reports clean over a root it never opened is the
 * absence-as-pass shape the vacuity member exists to catch, wearing a green tick.
 *
 * So there is no catch. If the walk of a root fails, the arm fails and the message says WHICH root and
 * why — which is what separates this class from whatever else that catch was eating. A new red here is
 * this guard working; it is a finding to file, never a reason to make it quiet again.
 */
const modulesUnder = (dir, label = relative(REPO, dir)) => {
  try {
    return nonEmpty([...productModules(dir)], `the product modules under ${label}/`);
  } catch (e) {
    throw new Error(`the product-module walk of ${label}/ failed: ${e.message}`, { cause: e });
  }
};

test("#594 no product module names a vendor for the shared register ledger", () => {
  const offenders = [];
  const walkedCounts = {};
  for (const root of LEDGER_ROOTS) {
    const entries = modulesUnder(join(REPO, root), root);
    walkedCounts[root] = entries.length;
    for (const file of entries) {
      const rel = relative(REPO, file);
      if (rel === RESOLVER) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (!LEDGER_VENDOR_NAME.test(line)) return;
        // An incident record may name the file as it WAS, provided it says so.
        if (/then (still )?named|then named|#594 renamed|pre-#594|DEPRECATED|deprecated/i.test(line)) return;
        if (allowed(rel, line)) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
  }
  // THE SWEEP COMPLETED ON EVERY ROOT. An empty `offenders` means nothing until this is true — it was
  // the silent half, and it is the assertion that catch made impossible.
  assert.deepEqual(Object.keys(walkedCounts), LEDGER_ROOTS,
    `the sweep did not walk every root: ${JSON.stringify(walkedCounts)}`);
  assert.deepEqual(offenders, [],
    "each line above still points a reader at a vendor for a ledger five providers write to");
});

test("tracker 2018 the ledger walk refuses an empty tree and names the root it failed on", () => {
  // BOTH DIRECTIONS, and the second is the one the old catch swallowed: the refusal has to arrive, and
  // it has to say which root, or "the sweep is green" and "the sweep did not run" read the same.
  const tmp = mkdtempSync(join(tmpdir(), "b2018-ledger-"));
  const leaf = join(REPO, "driver", "profiles", "projects", `b2018-${process.pid}`);
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    assert.throws(() => modulesUnder(tmp, "an-empty-tree"),
      /the product-module walk of an-empty-tree\/ failed/,
      "a walk that found no module was swallowed, or refused without naming the root it failed on");

    // …and the leaf that produced changes nothing about what driver/ walks.
    const baseline = modulesUnder(join(REPO, "driver"), "driver").length;
    mkdirSync(leaf, { recursive: true });
    assert.equal(modulesUnder(join(REPO, "driver"), "driver").length, baseline,
      "an empty directory under driver/ changed the modules this sweep reads");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(leaf, { recursive: true, force: true });
  }
});

// SPLIT THIS ARM, because the two aliases stopped being one fact.
//
// The legacy FILENAMES must still be declared in the resolver: production's ledgers are
// corsearch-calls.jsonl (7.2 MB) and corsearch-records.jsonl (432.6 MB) TODAY, so `legacy-default` is a
// live resolution there and deleting it would point production at an empty file — which
// `forEachLedgerLine` reports as `error: null`, a clean-looking measurement of a measurement that never
// happened. That is exactly the failure was written to prevent.
//
// The legacy ENV NAMES must NOT be declared any more. They were a one-release alias; measured before
// removal, zero of the four env files on the test and production boxes set either, and no systemd unit
// does. An expiry nobody enforces is a deprecation that never ends.
test("#605 the resolver still maps the legacy FILENAMES — production is on them today", () => {
  const text = readFileSync(join(REPO, RESOLVER), "utf8");
  for (const name of ["corsearch-calls.jsonl", "corsearch-records.jsonl"]) {
    assert.ok(text.includes(name), `${name} must be declared in ${RESOLVER} or a deployed box loses its ledger`);
  }
});

test("#605 …and no longer maps the legacy ENV names, anywhere in the product", () => {
  const text = readFileSync(join(REPO, RESOLVER), "utf8");
  for (const name of ["CORSEARCH_CALL_LOG", "CORSEARCH_RECORD_LOG"]) {
    // A COMMENT may name them — prose about a retired alias is not the alias — so this is the same
    // content-keyed rule the vendor sweep below uses: no non-comment line may carry one.
    const live = text.split("\n").filter((ln) => ln.includes(name) && !/^\s*(\/\/|\*|\/\*)/.test(ln));
    assert.deepEqual(live, [], `${RESOLVER} still steers a ledger by ${name} — the alias expired with #605`);
  }
});
