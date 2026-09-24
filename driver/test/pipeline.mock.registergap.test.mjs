// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end with a register gap
// copper-lattice e2e (offline mock): the registerGap deliver-conditional floor + the recall-regression
// fixture, exercised ON in their own process (the legacy pipeline.mock harness runs with both knobs off —
// its scenarios share one frozen root/slug and predate the clamp). Mirrors pipeline.mock.test.mjs's
// harness; every run is billable-call-free (mock engine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_RECALL_TRIPWIRE = "1";      // ON — this file owns the controlled fixture
process.env.CLEAROTRON_REGISTER_GAP_CLAMP = "1";   // ON — the clamp under test
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// config.workspaceRoot freezes at FIRST import — every run in this file lands under ROOT.
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-mock-gap-"));
const SLUG_DIR = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "tmp8439-project-novapulse");

async function runPipeline(env, jobPatch = {}, opts = {}) {
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("recall regression: a prior-confirmed conflict the run neither carries nor justifies clamps CLEAR→CONDITIONAL", async () => {
  // Seed the slug fixture BEFORE the run: a live in-scope conflict the mock scenario never carries.
  mkdirSync(SLUG_DIR, { recursive: true });
  writeFileSync(join(SLUG_DIR, "_known-conflicts.json"), JSON.stringify({
    schema_version: 1,
    marks: { "project novapulse": [{ uri: "/mark/us/90491258", mark_text: "Zylight FROSTBERRY", classes: [9], status: "live", source: "auto:delivery teal-lattice", ts: "2026-07-07T00:00:00Z" }] },
  }, null, 2));
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL", "the recall regression is a deterministic CLEAR→CONDITIONAL floor");
  const reg = events.find((e) => e.event === "recall-regression");
  assert.ok(reg && reg.material >= 1, "recall-regression event recorded with a material violation");
  const clamp = events.find((e) => e.event === "coverage-floor-clamp");
  assert.ok(clamp && clamp.registerGap && clamp.registerGap.recall >= 1, "the clamp names the recall arm");
  // the tripwire flag also rides the internal integrity sidecar (flag-only surface)
  const integ = JSON.parse(readFileSync(driverDir(res.runDir, "reasoning-integrity.json"), "utf8"));
  assert.ok(integ.tripFlags.some((f) => f.startsWith("recall-regression:")), "recall-regression tripwire flagged");
  assert.ok(existsSync(join(res.runDir, ".delivered")), "delivers-always: clamped, never withheld");
});

test("spec 64: delivery upserts the WORKSPACE per-mark store; the human-seeded legacy matter file is never touched", async () => {
  // spec 64 moved the write to <studioRoot>/_known-conflicts/<mark>.json — the substrate a re-run under
  // ANY matter id reads. The legacy matter-sibling file stays byte-identical (human edits win there).
  const STORE = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "_known-conflicts", "project-novapulse.json");
  const store = JSON.parse(readFileSync(STORE, "utf8"));
  const rows = store.marks["project novapulse"] ?? [];
  assert.ok(rows.some((r) => String(r.source ?? "").startsWith("auto:delivery")), "auto-appended rows carry provenance");
  assert.ok(rows.some((r) => r.owner === "Mystery Owner LLC"), "rows carry the owner for the next run's named probes");
  const legacy = JSON.parse(readFileSync(join(SLUG_DIR, "_known-conflicts.json"), "utf8"));
  assert.deepEqual(legacy.marks["project novapulse"].map((r) => r.uri), ["/mark/us/90491258"],
    "the legacy matter file is read-only to code now — the seeded row is all it holds");
});

test("spec 64 cross-matter e2e: a remembered conflict from ANOTHER matter id is probed BY NAME and, when neither carried nor justified, clamps CONDITIONAL", async () => {
  // Seed the WORKSPACE store with a conflict this scenario's findings never carry — provenance from a
  // different matter's delivery. The new run arrives REFLESS (a fresh noref matter id), exactly the
  // production shape that blinded the per-matter ledger (copper-causeway vs teal-conduit).
  const storeDir = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "_known-conflicts");
  mkdirSync(storeDir, { recursive: true });
  const storePath = join(storeDir, "project-novapulse.json");
  const doc = JSON.parse(readFileSync(storePath, "utf8"));
  doc.marks["project novapulse"].push({ uri: "/mark/us/99999999", mark_text: "GHOST MARK", classes: [9], status: "live",
    owner: "Ghost Owner LLC", source: "auto:delivery some-prior-run", ts: "2026-07-01T00:00:00Z" });
  writeFileSync(storePath, JSON.stringify(doc, null, 2));

  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { ref: null, id: "a-second-refless-request" });   // different matter id ⇒ different slug dir
  assert.equal(res.ok, true, JSON.stringify(res));

  // (1) the proactive half: deterministic recall probes folded into the frozen plan + receipt
  const probeEvt = events.find((e) => e.event === "register-recall-probes");
  assert.ok(probeEvt && probeEvt.minted >= 1, "recall probes minted into the plan");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "register-recall.json"), "utf8"));
  assert.ok(receipt.directives.some((d) => d.mark_text === "GHOST MARK" && d.owner === "Ghost Owner LLC"));
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  assert.ok(plan.entries.some((e) => e.qid === "recall-ghost-mark" && e.predicate === "exact"), "exact-name probe in the frozen plan");
  assert.ok(plan.entries.some((e) => e.qid === "recall-owner-ghost-owner-llc" && e.predicate === "owner"), "owner probe in the frozen plan");

  // (2) the post-hoc half: neither carried nor justified ⇒ material regression ⇒ registerGap clamp
  assert.equal(res.verdict, "CONDITIONAL", "cross-matter recall now clamps — the VENERET class is impossible");
  const clamp = events.find((e) => e.event === "coverage-floor-clamp");
  assert.ok(clamp && clamp.registerGap && clamp.registerGap.recall >= 1, "the clamp names the recall arm");
  const integ = JSON.parse(readFileSync(driverDir(res.runDir, "reasoning-integrity.json"), "utf8"));
  assert.ok(integ.tripFlags.some((f) => f.startsWith("recall-regression:")), "the tripwire flag rides the integrity sidecar");

  // (3) the new delivery upserts the SAME store (append-only; the seeded ghost row survives)
  const after = JSON.parse(readFileSync(storePath, "utf8"));
  assert.ok(after.marks["project novapulse"].some((r) => r.uri === "/mark/us/99999999"), "seeded row survives");
  assert.ok(after.marks["project novapulse"].some((r) => String(r.source ?? "").includes("auto:delivery") && r.uri === "/mark/us/90000001"),
    "the new run's carried legs are remembered too");
});

test("supplemental_lane contract e2e: a hand-authored (qid-less) band block FAILS the unit — the transcription lane is closed", async () => {
  process.env.MOCK_BAND_UNPLANNED = "1";
  try {
    const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" });
    assert.equal(res.ok, false);
    assert.match(String(res.failedStage ?? ""), /^register-unit:/);
    assert.match(String(res.reason ?? ""), /band_block_unplanned/);
  } finally { delete process.env.MOCK_BAND_UNPLANNED; }
});

test("spec 64 deadline-carry e2e: a remembered in-window opposition window on a CARRIED conflict without its date clamps CONDITIONAL", async () => {
  // Seed a store row for the very registration the mock findings carry (/mark/us/90000001) with an
  // opposition window closing soon. The mock run's bands carry no dates, so enrichment cannot self-heal
  // — the carried finding ships without a structured deadline ⇒ the deadline-carry arm must clamp.
  const storeDir = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "_known-conflicts");
  mkdirSync(storeDir, { recursive: true });
  const storePath = join(storeDir, "project-novapulse.json");
  const doc = existsSync(storePath) ? JSON.parse(readFileSync(storePath, "utf8")) : { schema_version: 1, marks: { "project novapulse": [] } };
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  doc.marks["project novapulse"] = (doc.marks["project novapulse"] ?? []).filter((r) => r.uri !== "/mark/us/90000001");
  doc.marks["project novapulse"].push({ uri: "/mark/us/90000001", mark_text: "PROJECT NOVAPULSE", classes: [9], status: "live",
    opposition_end: soon, deadline_source_uri: "/mark/us/90000001", source: "auto:delivery prior-run", ts: "2026-07-01T00:00:00Z" });
  writeFileSync(storePath, JSON.stringify(doc, null, 2));

  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { ref: null, id: "deadline-carry-scenario" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.verdict, "CONDITIONAL", "the dropped deadline clamps — DEMVENZY-class impossible");
  const dc = events.find((e) => e.event === "deadline-carry");
  assert.ok(dc && dc.n >= 1, "the deadline-carry event names the carried-without-date row");
  const clamp = events.find((e) => e.event === "coverage-floor-clamp");
  assert.ok(clamp && clamp.deadlineCarry >= 1, "the clamp carries the deadlineCarry arm");
  // — THE EVENT SAYS WHICH FLOOR EMITTED IT, AND WHICH OF THAT FLOOR'S INPUTS FIRED.
  // Three sites emit this event with the same from/to, so before `cause` a reader counting "how often
  // does a disclosed gap clamp a verdict" got a number mixing three unrelated causes.
  assert.equal(clamp.cause, "coverage",
    "the coverage floor names itself, rather than being inferred from which optional key is present");
  assert.ok(Array.isArray(clamp.causes) && clamp.causes.includes("deadlineCarry"),
    `this floor is seven causes under one name, so it lists the ones that fired: ${JSON.stringify(clamp.causes)}`);
  const verdictDoc = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.equal(verdictDoc.kinds.deadlineCarry, true);
  assert.ok(verdictDoc.reasons.some((r) => r.includes(soon)), "the reason names the closing date");
  const integ = JSON.parse(readFileSync(driverDir(res.runDir, "reasoning-integrity.json"), "utf8"));
  assert.ok(integ.tripFlags.some((f) => f.startsWith("deadline-carry:")), "the tripwire flag rides the integrity sidecar");
});


// ── THE THREE CLAMP SITES ARE TELLABLE APART BY `cause` ALONE ───────────────────────────────────
//
// Two of them fired three milliseconds apart on a production run and read as one decision logged
// twice. They were two decisions wearing one name, and the test lane reasonably discounted one.
// Asserted over the SOURCE because the property is about all three sites while a mock run trips one
// floor at a time: an arm driving a single run cannot see two causes collide, which is the defect.
test("tracker 636 every coverage-floor-clamp site carries its own cause, and no two share one", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const sites = [...src.matchAll(/event: "coverage-floor-clamp", cause: "([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(sites.length, 3, `all three clamp sites must carry a cause; found ${sites.length}`);
  assert.equal(new Set(sites).size, 3,
    `two clamp sites share a cause and are indistinguishable again: ${sites.join(", ")}`);
  // The event name itself is deliberately NOT split: it is a true statement about the effect, and
  // something downstream may already count clamps in aggregate. A discriminator is additive.
  assert.equal((src.match(/event: "coverage-floor-clamp"/g) ?? []).length, 3,
    "the event keeps one name — three names would break an aggregate counter");
});

// ── ANOTHER COMPANY'S RECALL CHECK RUNS, AND IS NEVER LISTED IN THIS COMPANY'S AUDIT ──────────────────
// Ruled 2026-09-23: keep the searches, stop naming them. The store is kept per mark, so a second
// company's delivery of this name sits in the same file; its conflicts are still searched (a new
// company's clearance re-finds them), and the audit lists only this company's own recall checks.
test("a second company's remembered conflict is still searched, and this company's audit never names it", async () => {
  const storeDir = join(ROOT, "workspace-clawdi", "studio", "clearance-search", "_known-conflicts");
  mkdirSync(storeDir, { recursive: true });
  const row = (uri, mark_text, owner, customer) => ({ uri, mark_text, classes: [45], status: "live", owner, customer,
    source: "auto:delivery earlier-run", ts: "2026-07-01T00:00:00Z", terminal: "delivered" });
  writeFileSync(join(storeDir, "project-novapulse.json"), JSON.stringify({ schema_version: 2, marks: { "project novapulse": [
    row("/mark/us/97777777", "OWNCO LUMEN", "Ownco Partners LLC", "generic"),          // the mock run's own company
    row("/mark/us/98888888", "OTHERCO VANTA", "Otherco Holdings LLC", "another-company"),
  ] } }, null, 2));
  const { res } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" }, { ref: null, id: "second-company-recall-scenario" });
  assert.equal(res.ok, true, JSON.stringify(res));
  // the searches are unchanged: both remembered conflicts are probed, and the receipt says whose each was
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "register-recall.json"), "utf8"));
  assert.equal(receipt.customer, "generic");
  const byMark = Object.fromEntries(receipt.directives.map((d) => [d.mark_text, d.customers]));
  assert.deepEqual(byMark["OWNCO LUMEN"], ["generic"]);
  assert.deepEqual(byMark["OTHERCO VANTA"], ["another-company"]);
  const plan = JSON.parse(readFileSync(driverDir(res.runDir, "register-plan.json"), "utf8"));
  assert.ok(plan.entries.some((e) => e.term === "OTHERCO VANTA"), "another company's conflict is still searched");
  // the ask ledger and the audit list only this company's own recall check
  const asks = JSON.parse(readFileSync(driverDir(res.runDir, "asks.json"), "utf8"));
  const askText = JSON.stringify(asks);
  assert.ok(askText.includes("prior-confirmed conflict recall probe: OWNCO LUMEN"), "this company's own check is listed");
  assert.ok(!askText.includes("OTHERCO VANTA") && !askText.includes("Otherco Holdings"), "another company's is not");
  const audit = readFileSync(join(res.runDir, "audit.md"), "utf8");
  assert.ok(audit.includes("prior-confirmed conflict recall probe: OWNCO LUMEN"));
  assert.ok(!/recall probe[^\n]*(OTHERCO VANTA|Otherco Holdings)/.test(audit), "no audit line names another company's recall check");
});
