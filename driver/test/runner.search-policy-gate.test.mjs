// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner's admission half of the search-depth spine
// runner.search-policy-gate.test.mjs — the search-depth spine's ADMISSION half.
//
// What must hold forever:
//   - a job selecting a level this build/deployment cannot run PARKS AS CLARIFY at intake (requester
//     notified, nothing searched) — never silently runs as a different-priced product, never drops;
//   - a job with NO selector runs exactly today's prelim end to end, and the run freezes its product
//     identity (_driver/search-policy.json → level "prelim") + publish stamps it (meta.json kind/product)
//     — the Stage-1 byte-identity guarantee, proven on a $0 mock run;
//   - matterSignature: single-mark non-knockout jobs produce the EXACT pre-spine string (every existing
//     ledger entry keeps deduping); batches key on the full sorted mark set; a level change never collides.
//
// SAFETY GUARD (2026-07-14 convention): driver.config freezes workspaceRoot AND poolRoot at import —
// every env var below is set BEFORE the dynamic runner import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";   // legacy-harness posture (see runner.dedup.test.mjs)
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";     // mock runs never dial the provider

const root = mkdtempSync(join(tmpdir(), "prelim-spine-"));
const RECIPES = join(root, "recipes");
mkdirSync(join(RECIPES, "generic"), { recursive: true });
writeFileSync(join(RECIPES, "generic", "plain.json"), JSON.stringify({ label: "Plain prelim", base: "global-preliminary-search" }));
for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_RECIPES_DIR: RECIPES,
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  CORSEARCH_SESSION_KEY: "test-offline",
})) pinEnv(process.env, k, v);
delete process.env.CLEAROTRON_KNOCKOUT_MODE;   // deployment posture under test: everything OFF (the default)
delete process.env.CLEAROTRON_RECIPES_MODE;
delete process.env.CLEAROTRON_JX_LANES;

// Dynamic import AFTER env is set (driver.config captures the roots at module load).
const { main, matterSignature, findDuplicateMatter, recordMatter } = await import("../runner.mjs");
const { resolveSearchPolicy, gateResolvedPolicy } = await import("../search-policy.mjs");
const Q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
mkdirSync(Q, { recursive: true });
const OUTBOX = join(root, "prelim-outbox");   // config.outboxDir default: <workspaceRoot>/prelim-outbox

// Delivered runs are MOVED to the archive subtree — discover run dirs by walking for the sidecar.
const findSidecarRuns = (base) => {
  const hits = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (existsSync(driverDir(d, "search-policy.json"))) { hits.push(d); return; }
    for (const e of entries) if (e.isDirectory()) walk(join(d, e.name), depth + 1);
  };
  walk(base, 0);
  return hits;
};

const enqueue = (base, extra = {}) => writeFileSync(join(Q, `${base}.json`), JSON.stringify({
  id: base, msgId: `<${base}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  markName: "SPINE PROBE", classes: [9], provider: "corsearch", ...extra,
}));

// ── matterSignature (pure) ──────────────────────────────────────────────────────────────────────────
test("matterSignature: single-mark prelim stays BYTE-IDENTICAL to the pre-spine formula", () => {
  const job = { forwarder: "Sam", markName: "  Nova  Pulse ", classes: [41, 9], customer: "Acme Ltd", ref: "TMP-1" };
  assert.equal(matterSignature(job), "sam|nova pulse|9,41|acme ltd|tmp-1", "the exact legacy string — every ledger entry must keep colliding");
  assert.equal(matterSignature({ ...job, product: "global-preliminary-search" }), matterSignature(job),
    "an EXPLICIT prelim adds nothing — it is the same product as an implicit one");
});

test("matterSignature: a level is a dedup dimension (escalation never parks); KNOCKOUT batches key on the FULL sorted set", () => {
  const job = { forwarder: "sam", markName: "NOVA", classes: [9], customer: "acme", ref: "t1" };
  assert.notEqual(matterSignature(job, { product: "knockout" }), matterSignature(job),
    "knockout ≠ prelim for the same matter — the $2 screen must never dedup-block the $40 clearance");
  assert.equal(matterSignature(job, { product: "knockout" }), `${matterSignature(job)}|level:knockout`);
  const ko = { product: "knockout" };
  const batchA = { forwarder: "sam", markName: "ALPHA", marks: [{ name: "ALPHA" }, { name: "BETA" }, { name: "GAMMA" }] };
  const batchB = { forwarder: "sam", markName: "GAMMA", marks: [{ name: "GAMMA" }, { name: "ALPHA" }, { name: "BETA" }] };
  const batchC = { forwarder: "sam", markName: "ALPHA", marks: [{ name: "ALPHA" }, { name: "DELTA" }] };
  assert.equal(matterSignature(batchA, ko), matterSignature(batchB, ko), "a reordered re-send of the SAME batch collides");
  assert.notEqual(matterSignature(batchA, ko), matterSignature(batchC, ko), "two batches sharing mark #1 are DIFFERENT matters");
  assert.match(matterSignature(batchA, ko), /\|alpha \+ beta \+ gamma\|/);
  // the sorted-set form is knockout-scoped: a legacy multi-mark CLEARANCE job keys on markName exactly as before
  assert.match(matterSignature(batchA), /^sam\|alpha\|/, "multi-mark on a clearance level stays the legacy scalar form (byte-identity)");
});

test("findDuplicateMatter: the THREAD dimension is level-aware — a same-thread escalation never parks as duplicate", () => {
  const qdir = join(mkdtempSync(join(tmpdir(), "spine-ledger-")), "queue");
  mkdirSync(qdir, { recursive: true });
  const now = Date.now();
  const koSig = "jordan|nova|9|acme||level:knockout";
  const prelimSig = "jordan|nova|9|acme|";
  recordMatter(qdir, { sig: koSig, conversationId: "conv1", msgId: "<m1@x>", id: "m1", ts: now });
  // the headline flow: same thread, same mark, DIFFERENT level ⇒ not a duplicate on either dimension
  assert.equal(findDuplicateMatter(qdir, { sig: prelimSig, conversationId: "conv1", msgId: "<m2@x>" }, now), null,
    "knockout→prelim escalation in the SAME email thread must run, not park");
  // same level, same thread ⇒ still a duplicate (the gate keeps protecting double-spend)
  assert.ok(findDuplicateMatter(qdir, { sig: koSig, conversationId: "conv1", msgId: "<m3@x>" }, now));
  // legacy entries (no suffix) read as prelim: a prelim re-send still dedups against them by thread
  recordMatter(qdir, { sig: prelimSig, conversationId: "conv2", msgId: "<m4@x>", id: "m4", ts: now });
  assert.ok(findDuplicateMatter(qdir, { sig: prelimSig, conversationId: "conv2", msgId: "<m5@x>" }, now));
});

// ── admission gate (end to end through the real runner) ────────────────────────────────────────────
//
// Two tests lived here asserting that a knockout job and a recipeKey job PARK AS CLARIFY because
// CLEAROTRON_KNOCKOUT_MODE / CLEAROTRON_RECIPES_MODE were off — the posture this file pins as "everything OFF (the
// default)". Both switches were retired 2026-07-27: they gated shipped machinery, so on a correct
// deployment they could only read `true`, and read from a process with no engine environment they refused
// shipped depths (the ops-MCP told clients three of them were "not switched on for this account").
//
// They are replaced by a GATE-level assertion rather than another end-to-end run, deliberately: a job that
// admits here runs the whole mock pipeline and publishes, which would break the one-run/one-publish counts
// the byte-identity test below owns. A knockout executing end to end is covered by runner.knockout-e2e.
test("the retired switches refuse NOTHING at the gate — with the engine's own empty environment", () => {
  for (const n of ["CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"]) {
    assert.equal(process.env[n], undefined, `${n} is unset in this process, as it is in production services`);
  }
  const recipes = new Map([["generic/plain", { label: "Plain prelim", base: "global-preliminary-search" }]]);
  for (const [label, resolved] of [
    ["knockout", resolveSearchPolicy({ product: "knockout-search" }, {})],
    ["knockout-register", resolveSearchPolicy({ product: "knockout-search" }, {})],
    ["prelim-jx", resolveSearchPolicy({ product: "multi-country-focus-search" }, {})],
    ["a saved search", resolveSearchPolicy({ recipeKey: "plain" }, { profile: { key: "generic" }, recipes })],
  ]) {
    assert.equal(gateResolvedPolicy(resolved), null, `${label} must be admitted — it is built`);
  }
});

test("a deliveryRoute:'portal' job PARKS AS CLARIFY (no consumer yet — never a silent email-anyway)", async () => {
  enqueue("dr-1", { deliveryRoute: "portal" });
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.search-policy-gate.test.mjs");
  assert.ok(existsSync(join(Q, "dr-1.failed")));
  assert.match(readFileSync(join(Q, "dr-1.failed.reason"), "utf8"), /portal.*not available/);
});

// THE WALL for the (depth × scope) combination rules. Every door lands on this admission gate — email,
// portal, MCP, CLI — so the portal's courtesy 422 and plan_run's blocker can only ever agree with it,
// never stand in for it. Nothing runs and nothing is published: the requester is asked a question.
// (Deliberately asserted only on the refusal — a job that ADMITS here would run the full mock pipeline
// and break the one-run/one-publish counts the byte-identity test below owns.)
test("a Full country search over more than one country PARKS AS CLARIFY at the wall", async () => {
  enqueue("cl-1", { product: "full-country-search", jurisdictions: ["United States", "France"] });
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.search-policy-gate.test.mjs");
  assert.ok(existsSync(join(Q, "cl-1.failed")), "parked as .failed — never run, never dropped");
  const reason = readFileSync(join(Q, "cl-1.failed.reason"), "utf8");
  assert.match(reason, /reads exactly one country/);
  // Quoted, because THIS file is the one the echo doctrine protects: a reason file is read back line by
  // line, and a newline inside a territory name would forge a row in it (review 2026-07-27).
  assert.match(reason, /names 2 \("United States", "France"\)/,
    "the wall names the scope it counted, IN THE REQUESTER'S OWN SPELLING — it used to echo \"US\", \"FR\" "
    + "for the identical request the door refuses naming \"United States\", \"France\"");
  const packet = JSON.parse(readFileSync(join(OUTBOX, "intake-cl-1.failed.pending"), "utf8"));
  assert.equal(packet.classify, "clarify", "a question back to the requester, not a failure to retry");
});

// ── the Stage-1 byte-identity guarantee, proven on a full $0 mock run ───────────────────────────────
test("a NO-selector job runs the product its SCOPE names, end to end, and the run freezes that", async () => {
  // Blast-radius regression (review 2026-07-17): a corrupt recipe file ANYWHERE in the store must never
  // affect a default job — the store is consulted only when a job names a recipe.
  mkdirSync(join(RECIPES, "othercorp"), { recursive: true });
  writeFileSync(join(RECIPES, "othercorp", "broken.json"), "{not json");
  enqueue("plain-1", { customer: "Acme" });
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.search-policy-gate.test.mjs");
  assert.ok(existsSync(join(Q, "plain-1.done")), "the default path still delivers");
  // the frozen product identity (the delivered run has moved to the archive subtree)
  const runDirs = findSidecarRuns(join(root, "workspace-clawdi", "studio", "prelim-search"));
  assert.equal(runDirs.length, 1, "exactly one run froze a search-policy sidecar");
  const sp = JSON.parse(readFileSync(driverDir(runDirs[0], "search-policy.json"), "utf8"));
  // NOT a house default any more: `prelim` named three different searches depending on where it pointed,
  // so the default was a guess wearing a level key. This account names no territories, which is a
  // worldwide search, which is the Global preliminary search — derived, and the origin says so.
  assert.equal(sp.level, "global-preliminary-search");
  assert.equal(sp.pipeline, "clearance");
  assert.equal(sp.origins.level, "the-scope");
  assert.equal(sp.recipe, null);
  // the publish stamps — product identity + attribution live in meta.json from day one
  const pool = join(root, "pool");
  const metaDirs = readdirSync(pool, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(pool, d.name, "meta.json")));
  assert.equal(metaDirs.length, 1, "one published run");
  const meta = JSON.parse(readFileSync(join(pool, metaDirs[0].name, "meta.json"), "utf8"));
  assert.equal(meta.kind, "clearance");
  assert.equal(meta.searchLevel, "global-preliminary-search");
  assert.equal(meta.recipe, undefined);
});
