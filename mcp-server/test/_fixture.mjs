// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Test fixture: a self-contained prelim run-dir under a temp CLEAROTRON_WORK_DIR, so the read libs can be
// exercised from an ordinary developer account — no gateway, and no access to a deployment's run-dirs.
// IMPORTANT: this module sets the env vars at import time;
// test files must import ONLY this module statically and import ../lib/* DYNAMICALLY inside before() — else
// ESM hoisting would load driver.config.mjs before the env is set.

import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { createHash } from "node:crypto";
import os from "node:os";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// mkdtemp per test process — a fixed /tmp name collides across USERS on a shared box (a leftover
// dir owned by another user makes every run EACCES). A preset CLEAROTRON_WORK_DIR is respected;
// only a root we created ourselves is removed on exit.
let createdRoot = null;
if (!process.env.CLEAROTRON_WORK_DIR) {
  createdRoot = mkdtempSync(join(os.tmpdir(), "ta-mcp-fixture-"));
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", createdRoot);
}
process.env.CLEAROTRON_REGISTER_CALL_LOG ??= join(process.env.CLEAROTRON_WORK_DIR, "register-calls.jsonl");
// THE DELIVERY POOL TOO, and UNCONDITIONALLY — unlike the two vars above. This fixture does not merely
// READ the pool (brief.mjs reads report-data.json from it): buildRichRun and buildKnockoutRun WRITE
// published data files into it. A `??=` would honour an already-exported CLEAROTRON_REPORTS_DIR and deposit
// fake deliveries into whatever pool it names — a deployment's real client archive, if that is what the
// caller had set — and it fails silently: tmp-prefixed runIds, no error, green suite. plan.test.mjs and
// describe-options.test.mjs both assign flat for the read-only case; a writer has no excuse not to.
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(process.env.CLEAROTRON_WORK_DIR, "pool"));
process.on("exit", () => {
  if (createdRoot) { try { rmSync(createdRoot, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

export const WS = process.env.CLEAROTRON_WORK_DIR;
export const POOL = process.env.CLEAROTRON_REPORTS_DIR;
export const RUN_ID = "tmptest1-acme-2026-06-08-copper-anvil";
const RUN_DIR = join(WS, "workspace-test", "studio", "prelim-search", "tmptest1-acme", "2026-06-08-copper-anvil");
const STUDIO = join(WS, "workspace-test", "studio", "prelim-search");

// A second, "rich" run (delivered, archived) for the timeline / diff / cross-run tools: an escalation
// re-digest that changed register-findings.md's sha, a BLOCKING→CONDITIONAL verdict pair, a manual-rerun
// _history snapshot to diff against, and a scattered-token line (MYRKUR … similar mark … conflict).
export const RUN_ID2 = "tmpmyrk1-myrkur-2026-05-20-iron-heron";
const RUN_DIR2 = join(WS, "workspace-test", "studio", "prelim-search", "archive", "2026-05", "tmpmyrk1-myrkur", "2026-05-20-iron-heron");

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);
function w(path, text) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); }
function meta(path) { const b = readFileSync(path); return { name: basename(path), sha: sha(b), size: b.length }; }

export function buildFixture() {
  mkdirSync(driverDir(RUN_DIR), { recursive: true });
  mkdirSync(join(RUN_DIR, "register-units"), { recursive: true });
  const p = (f) => join(RUN_DIR, f);

  w(p("matter-context.md"), "# Matter\nClient: ACME Corp; sector: software; customer base: developers.\nMaterially-matters jurisdictions: US, EU. Off-field sectors: food.\n" + "Context padding to clear the 200-char minimum so the validator is satisfied. ".repeat(3));
  w(p("variant-manifest.md"), "# Variants\n| variant | category |\n|---|---|\n| ACME (exact) | exact-phrase |\n| ACME PRO | compound |\n" + "padding ".repeat(20));
  w(p("common-law-findings.md"), "# Common-law\n| Finding | Source / Platform | Result |\n|---|---|---|\n| ACME Game | Steam | live |\n" + "padding ".repeat(20));
  w(p("register-units/primary-sweep.md"), "# primary-sweep\nstatus: confirmed-clean\n| Mark | Owner | Status |\n|---|---|---|\n| ACME | Beta Inc | Live |\n" + "padding ".repeat(20));
  w(p("register-units/saturation-probe.md"), "not applicable — count-only probe, no hits\n");
  w(p("placement-recommendations.md"), "# Placement\ntier: headline-candidate\nplacement: ACME → sheet-2\nlevel: A\n" + "padding ".repeat(30));
  w(p("register-findings.md"), "## Findings\n| Mark | Owner | Status | Classes | URL |\n|---|---|---|---|---|\n| ACME | Beta Inc | Live | 9 | https://tm.corsearch.com/mark/us/123 |\n\n## Coverage ledger\n| Jurisdiction | Axis | Status |\n|---|---|---|\n| US | primary-sweep | confirmed-clean |\n" + "padding ".repeat(20));
  w(p("skeptic-flags.md"), "no flags surfaced\n\n## Escalation decisions\nESCALATE: primary-sweep — confirm the Beta Inc owner cluster\n");
  w(p("narrative.md"), "# Synthesis narrative\nThe mark ACME faces a Live registration by Beta Inc in class 9 (US). Net: MEDIUM risk; proceed with a watch. " + "This narrative is padded well beyond the 300-character minimum the validator enforces so it parses as valid. ".repeat(4));
  w(p("case-law-findings.md"), "# Case law\nNo controlling precedent surfaced beyond the standard confusion factors in this jurisdiction. " + "padding ".repeat(6));
  w(p("senior-eye-review.md"), "CLEAR\nThe narrative is well-supported; no overclaims. Minor: scope the Germany note.\n");
  w(p("report.md"), [
    // front matter carries the two INTERNAL-only keys a client must never see, in their real shapes:
    // overall_badge (the Level/Composite code the report footer says is "removed on export") and
    // rated_under's `· profile <hash>` tail (framework config identity). See lib/scrub.mjs.
    "---", "type: prelim-clearance", "matter: TMPTEST1", "title: ACME", "client: ACME Corp",
    "classes: 9, 42", "overall_label: MEDIUM", "overall_badge: l3",
    "rated_under: House default (generic) · house default framework · profile d37721cda899", "---", "",
    "# Marks", "",
    "## Beta Inc — ACME, US", "- tier: 1", "- label: Level A · Composite 4 · Classic", "- group: on-field",
    "- one: Live US registration by Beta Inc in class 9.", "- open: true",
    "### The read", "A direct, live, in-class conflict. Net: change or clear before launch.",
    // The LABELLED internal form is what a PUBLISHED report.md actually carries — publish already consumed
    // the `::p::` marker (publish/index.mjs writes through stripInternal({client:false})). Kept here in its
    // real shape because a fixture carrying only `::p::` would let a client-view regression pass green.
    "### Full detail", "- Filing: US Reg 123, filed 2022.",
    "- [internal] Enforcer basis is inferred from portfolio signals, not a verified filing.",
    "- Source: [Corsearch · us/123](https://tm.corsearch.com/mark/us/123)", "",
    "## Other Owner — ACMEISH, EU", "- tier: 3", "- label: Level C · Composite 2 · Crowded Field", "- group: off-field",
    "- one: Off-field EU mark, different goods.",
    "### The read", "Different field; low concern.",
    "### Full detail", "- Source: [Corsearch · em/999](https://tm.corsearch.com/mark/em/999)", "",
    "# Coverage", "US + EU register swept; transliteration deferred.", "",
    "# Methodology", "Corsearch register + common-law sweep.", "",
  ].join("\n"));
  // client-summary.md — the RETIRED stage's document (its producing stage was deleted 2026-08-01). Kept
  // here, and deliberately carrying a `recommendation`, as the regression guard for the two defects it
  // caused: the brief must never source from it again, and it must never re-emit a "Recommendation:" line.
  // Without the recommendation key present the no-advice assertion would pass vacuously.
  w(p("client-summary.md"), "# Executive Summary\n- risk: MEDIUM\n- summary: One live US conflict by Beta Inc.\n- recommendation: Rebrand before launch and file defensively in class 42.\n# Marks\n## ACME — Beta Inc (US)\n- risk: MEDIUM\n");
  // The FROZEN product shape every run writes (pipeline.mjs). It records the LEVEL ID and never the
  // product's name — the name is resolved off the registry at read time (reportIdentityFor).
  w(driverDir(RUN_DIR, "search-policy.json"), JSON.stringify({
    schema: 1, level: "full-country-search", pipeline: "clearance", stageLabel: "Full country search",
    components: { registerProbe: false, jxLanes: true, commonLawGrid: true },
  }, null, 2));
  w(p("audit.md"), [
    "# Findings", "",
    "## ACME (Beta Inc)", "- source_layer: Register", "- owner: Beta Inc", "- owner_country: US",
    "- classes: 9", "- status: Live", "- url: https://tm.corsearch.com/mark/us/123",
    "- search_terms: ACME (exact)", "- key_factors: identical, in-class, live", "",
    "## ACME Game (creator)", "- source_layer: Common-law", "- owner: indie creator", "- status: marketplace use",
    "- url: https://store.steampowered.com/app/1", "- search_terms: ACME", "",
    "# Negative Results", "",
    "## NR1", "- source_layer: Register", "- search_term: ACME PRO (exact)", "- platform: Corsearch", "- result: 0 hits", "",
    "# Audit Trail", "",
    "## AT1", "- source_layer: Register", "- step: primary-sweep", "- query: ACME (exact)",
    "- rationale: dominant-element exact-in-class probe", "- source: Corsearch", "- result_summary: 1 live hit",
    "- tool_call: corsearch_search", "- finding_ref: ACME", "",
  ].join("\n"));

  // per-attempt telemetry for report-overview (cost prior + get_telemetry)
  w(driverDir(RUN_DIR, "report-overview.jsonl"),
    JSON.stringify({ ts: "2026-06-08T10:00:00Z", attempt: 1, key: "prelim-tmptest1-acme-copper-anvil-report-overview", model: "anthropic/claude-sonnet-4-6", modelUsed: "anthropic/claude-sonnet-4-6", code: 0, wall: 45, status: "ok", fail: null, usage: { input: 4000, output: 1200, total: 5200 }, output: meta(p("report.md")) }) + "\n");

  // run.jsonl — the self-describing provenance graph
  const stage = (label, out, inputs, model, trigger = "fresh") => ({
    event: "stage", stage: label, trigger, ok: true, attempts: 1, fail: null, model,
    inputs: inputs.map((f) => meta(p(f))), output: meta(p(out)), summary: `${label} done`,
  });
  const OPUS = "anthropic/claude-opus-4-8", SONNET = "anthropic/claude-sonnet-4-6", HAIKU = "anthropic/claude-haiku-4-5";
  const events = [
    { event: "start", agent: "test", job: { id: "job1", slug: "tmptest1-acme", codename: "copper-anvil" } },
    { event: "axes", axes: ["saturation-probe", "primary-sweep"] },
    stage("matter-frame", "matter-context.md", [], OPUS),
    stage("prelim-variants", "variant-manifest.md", ["matter-context.md"], OPUS),
    stage("common-law", "common-law-findings.md", ["variant-manifest.md", "matter-context.md"], HAIKU),
    stage("register-unit:primary-sweep", "register-units/primary-sweep.md", ["variant-manifest.md", "matter-context.md"], SONNET),
    stage("register-unit:saturation-probe", "register-units/saturation-probe.md", ["variant-manifest.md", "matter-context.md"], HAIKU),
    stage("placement-inquiry", "placement-recommendations.md", ["matter-context.md", "common-law-findings.md"], OPUS),
    stage("register-digest", "register-findings.md", ["variant-manifest.md", "matter-context.md", "placement-recommendations.md"], OPUS),
    stage("skeptic", "skeptic-flags.md", ["register-findings.md", "common-law-findings.md"], "google/gemini-3-flash-preview"),
    { event: "skeptic-escalation", escalated: ["primary-sweep"] },
    stage("synthesis", "narrative.md", ["register-findings.md", "common-law-findings.md", "placement-recommendations.md", "matter-context.md"], OPUS),
    stage("narrative-refutation", "senior-eye-review.md", ["narrative.md", "register-findings.md", "common-law-findings.md"], "together/deepseek-ai/DeepSeek-V4-Pro"),
    { event: "verdict", verdict: "CLEAR" },
    stage("report-overview", "report.md", ["narrative.md", "register-findings.md", "common-law-findings.md", "placement-recommendations.md", "senior-eye-review.md", "matter-context.md"], SONNET),
    { event: "provider-usage", provider: "corsearch", search: 2, record_fetch: 1, total: 3 },
  ];
  w(driverDir(RUN_DIR, "run.jsonl"), events.map((e) => JSON.stringify({ ts: "2026-06-08T10:00:00Z", ...e })).join("\n") + "\n");

  // status.json
  w(p("status.json"), JSON.stringify({
    schema: 1, id: "job1", runId: RUN_ID, slug: "tmptest1-acme", codename: "copper-anvil", date: "2026-06-08",
    agent: "test", forwarder: "jordan", ref: "TMPTEST1", markName: "ACME", classes: [9, 42],
    state: "running", stepN: 7, stepLabel: "Drafting the report", stepTotal: 9, verdict: "CLEAR", url: null,
    providerUsage: { corsearch: { search: 2, record_fetch: 1, total: 3 } },
    startedAt: "2026-06-08T09:00:00Z", updatedAt: "2026-06-08T10:00:00Z",
  }, null, 2) + "\n");

  // shared register call ledger (gateway-namespaced session keys → exercises stripGatewayNs)
  const led = process.env.CLEAROTRON_REGISTER_CALL_LOG;
  const lrow = (tool, key) => JSON.stringify({ ts: "2026-06-08T10:00:00Z", agentId: "test", sessionKey: `agent:test:${key}`, sessionId: `agent:test:${key}`, tool, target: "/mark/us/123", http_status: 200, ok: true, attempts: 1, took_ms: 50, bytes: 100, cache_hit: false });
  w(led, [
    lrow("search", "prelim-tmptest1-acme-copper-anvil-register-unit-primary-sweep"),
    lrow("search", "prelim-tmptest1-acme-copper-anvil-register-digest"),
    lrow("record_fetch", "prelim-tmptest1-acme-copper-anvil-register-unit-primary-sweep"),
    JSON.stringify({ ts: "x", sessionKey: "agent:other:prelim-someoneelse-xyz-register-digest", tool: "search", ok: true }), // must NOT match
  ].join("\n") + "\n");

  return { WS, runId: RUN_ID, runDir: RUN_DIR };
}

export function buildRichRun() {
  mkdirSync(driverDir(RUN_DIR2), { recursive: true });
  const p = (f) => join(RUN_DIR2, f);
  const OPUS = "anthropic/claude-opus-4-8";

  // canonical register-findings — note the SCATTERED-token line (the four words spread across one sentence)
  w(p("register-findings.md"), [
    "## Findings",
    "| Mark | Owner | Status | Classes | URL |",
    "|---|---|---|---|---|",
    "| MYRKUR | Øksemorder IVS | Live | 9 | https://tm.corsearch.com/mark/dk/77 |",
    "",
    "The MYRKUR mark presents a similar prior registration; treat as a blocking-candidate mark conflict pending review.",
    "",
    "## Coverage ledger",
    "| Jurisdiction | Axis | Status |",
    "|---|---|---|",
    "| DK | primary-sweep | escalated |",
  ].join("\n"));
  w(p("common-law-findings.md"), "# Common-law\n| Finding | Source | Result |\n|---|---|---|\n| none | — | clean |\n");
  w(p("skeptic-flags.md"), "## Escalation decisions\nESCALATE: primary-sweep — the Øksemorder owner cluster needs a second pass\n");
  w(p("senior-eye-review.md"), "CONDITIONAL\nThe MYRKUR conflict is real but narrow; deliver with open questions on the DK class scope.\n");

  // an OLDER snapshot of register-findings (status was Pending) → diff_artifact has two versions to compare
  const histDir = join(RUN_DIR2, "_history", "2026-05-20T10-00-00-000Z-manual-rerun");
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, "register-findings.md"), [
    "## Findings",
    "| Mark | Owner | Status | Classes | URL |",
    "|---|---|---|---|---|",
    "| MYRKUR | Øksemorder IVS | Pending | 9 | https://tm.corsearch.com/mark/dk/77 |",
    "",
    "## Coverage ledger",
    "| Jurisdiction | Axis | Status |",
    "|---|---|---|",
    "| DK | primary-sweep | confirmed-clean |",
  ].join("\n"));

  // run.jsonl — two register-digest events (sha CHANGE on escalation), then BLOCKING → CONDITIONAL → delivered
  const events = [
    { event: "start", agent: "test", job: { id: "job2", slug: "tmpmyrk1-myrkur", codename: "iron-heron" } },
    { event: "axes", axes: ["primary-sweep"] },
    { event: "stage", stage: "register-digest", trigger: "fresh", ok: true, attempts: 1, model: OPUS, inputs: [], output: { name: "register-findings.md", sha: "aaaaaaaaaaaa", size: 100 } },
    { event: "skeptic-escalation", escalated: ["primary-sweep"] },
    { event: "stage", stage: "register-digest", trigger: "escalation", ok: true, attempts: 1, model: OPUS, inputs: [], output: meta(p("register-findings.md")) },
    { event: "verdict", verdict: "BLOCKING" },
    { event: "verdict-2", verdict: "CONDITIONAL" },
    { event: "delivered-with-open-questions", verdict: "CONDITIONAL" },
  ];
  w(driverDir(RUN_DIR2, "run.jsonl"), events.map((e, i) => JSON.stringify({ ts: `2026-05-20T10:0${i}:00Z`, ...e })).join("\n") + "\n");

  w(p("status.json"), JSON.stringify({
    schema: 1, id: "job2", runId: RUN_ID2, slug: "tmpmyrk1-myrkur", codename: "iron-heron", date: "2026-05-20",
    agent: "test", forwarder: "jordan", ref: "TMPMYRK1", markName: "MYRKUR", classes: [9],
    state: "delivered", stepN: 9, stepLabel: "Sending to you", stepTotal: 9, verdict: "CONDITIONAL",
    url: "https://prelim.example/myrkur",
    startedAt: "2026-05-20T09:00:00Z", updatedAt: "2026-05-20T10:10:00Z", deliveredAt: "2026-05-20T10:10:00Z",
  }, null, 2) + "\n");

  // A DELIVERED CLEARANCE, with the published surface a delivered run actually has: no report.md in the
  // run dir (this run never had one), and report-data.json in the DELIVERY POOL, which is where both
  // lanes publish it. Before the brief could not see the pool at all, so this run — finished and
  // sent — briefed as "may still be in flight".
  w(driverDir(RUN_DIR2, "search-policy.json"), JSON.stringify({
    schema: 1, level: "global-preliminary-search", pipeline: "clearance", stageLabel: "Global preliminary search",
    components: { registerProbe: false, jxLanes: false, commonLawGrid: true },
  }, null, 2));
  w(join(POOL, RUN_ID2, "report-data.json"), JSON.stringify({
    schema: "report-data/1", kind: "clearance", runId: RUN_ID2, codename: "iron-heron",
    matter: "TMPMYRK1", markName: "MYRKUR", title: "MYRKUR", customerKey: "generic",
    issued: "2026-05-20 · 12:10", url: "https://prelim.example/portal/report/tmpmyrk1-myrkur-2026-05-20-iron-heron",
    auditFile: `${RUN_ID2}-audit.xlsx`, engineCommit: null,
    level: { searchLevel: "global-preliminary-search", stageLabel: "Global preliminary search" },
    verdict: {
      verdict: "CONDITIONAL", tier: 2, badge: null, band: "MEDIUM",
      statement: "One live Danish registration sits directly in class 9; the remaining hits are off-field.",
      conditions: ["Confirm the DK class-9 specification before filing."],
    },
    caption: "A narrow but real conflict in Denmark.",
    jurisdiction: "DK/EU (register) + common-law",
    findings: [
      { ordinal: 1, mark: "MYRKUR", band: "HIGH", net: "Live DK registration by Øksemorder IVS in class 9.", disposition: "on-field", group: "on-field", owner: { name: "Øksemorder IVS", country: "DK", registrations: [] } },
      { ordinal: 2, mark: "MYRKR", band: "MEDIUM", net: "Close variant filed in the EU, same class.", disposition: "on-field", group: "on-field", owner: { name: "Nordlys ApS", country: "EU", registrations: [] } },
      // An OUT-OF-SCOPE finding. The old report-card path filtered this group out, so the brief listed
      // fewer conflicts than the report the client was holding. It must appear here, one for one.
      { ordinal: 3, mark: "MYRKUR CAFE", band: "LOW", net: "Off-field café use; different goods.", disposition: "off-field", group: "out-of-scope", owner: { name: "Kaffe IVS", country: "DK", registrations: [] } },
    ],
    contextNotes: [], coverage: [],
    actions: { conditions: [{ id: "a1", kind: "condition", text: "Obtain a DK specification opinion before the filing date.", ordinals: [1], deadline: null }], advisories: [] },
    askAnswers: [],
  }, null, 2));

  return { WS, runId: RUN_ID2, runDir: RUN_DIR2, poolDir: join(POOL, RUN_ID2) };
}

// A DELIVERED KNOCKOUT BATCH — the population (d) is about, and the one the MCP suite had no run of
// at all. Two names, so the pool carries `report-data-<slug>.json` PER MARK (publish/knockout.mjs writes
// the plain `report-data.json` only for a single-mark run) — a reader that stats one filename sees a
// delivered batch as an unpublished one. The run dir holds the knockout lane's OWN artifacts (koPaths):
// there is no report.md, no findings.json and no client-summary.md in it, which is why a brief built on
// the clearance path found nothing here.
export const RUN_ID_KO = "tmpkock1-halcyon-2026-08-04-brass-lantern";
const RUN_DIR_KO = join(STUDIO, "archive", "2026-08", "tmpkock1-halcyon", "2026-08-04-brass-lantern");

export function buildKnockoutRun() {
  mkdirSync(driverDir(RUN_DIR_KO), { recursive: true });
  mkdirSync(join(RUN_DIR_KO, "research"), { recursive: true });
  const p = (f) => join(RUN_DIR_KO, f);

  w(p("knockout-frame.md"), "# Frame\nTwo instructed names screened against the register and the open web.\n");
  w(p("knockout-plan.json"), JSON.stringify({ schema: 1, marks: [{ name: "PROJECT HALCYON" }, { name: "HALCYONA" }] }));
  w(p("knockout-findings.json"), JSON.stringify({
    schema: 1,
    batch: { executiveSummary: "One name is clear to proceed on; the other meets a live in-class registration." },
    marks: [
      { name: "PROJECT HALCYON", rating: "HIGH", ratingQualifier: "in-class", classesSearched: [9, 41] },
      { name: "HALCYONA", rating: "LOW", classesSearched: [9, 41] },
    ],
  }));
  w(p("knockout-assessment.md"), "# Assessment\nPROJECT HALCYON meets a live registration; HALCYONA does not.\n");
  w(p("research/project-halcyon.md"), "Sweep payload for PROJECT HALCYON.\n");
  w(p("research/halcyona.md"), "Sweep payload for HALCYONA.\n");
  w(driverDir(RUN_DIR_KO, "search-policy.json"), JSON.stringify({
    schema: 1, level: "knockout-search", pipeline: "knockout", stageLabel: "Knockout search",
    components: { registerProbe: true, jxLanes: false, commonLawGrid: false },
  }, null, 2));

  // Same status.json shape and same run-id format as a clearance (pipeline-knockout.mjs seeds it from the
  // shared run context) — which is why enumerateRuns already finds these; only `lane` distinguishes them.
  w(p("status.json"), JSON.stringify({
    schema: 1, id: "job3", runId: RUN_ID_KO, slug: "tmpkock1-halcyon", codename: "brass-lantern", date: "2026-08-04",
    agent: "test", forwarder: "jordan", ref: "TMPKOCK1",
    // VERBATIM the knockout lane's own spelling: pipeline-knockout.mjs writes
    // `markName: batchMarkName(markNames)` — "<first> +N more" for a batch — beside a countable `marks[]`,
    // and `verdict: overall` (the batch's worst band) at delivery. A fixture writing the bare first name
    // would let the brief's headline pass on a shape no real batch has.
    markName: "PROJECT HALCYON +1 more", marks: [{ name: "PROJECT HALCYON" }, { name: "HALCYONA" }],
    classes: [9, 41],
    lane: "knockout", state: "delivered", stepN: 5, stepLabel: "Sending to you", stepTotal: 5, verdict: "HIGH",
    url: "https://prelim.example/halcyon",
    startedAt: "2026-08-04T09:00:00Z", updatedAt: "2026-08-04T09:40:00Z", deliveredAt: "2026-08-04T09:40:00Z",
  }, null, 2) + "\n");

  const koDoc = (name, slug, band, qualifier, findings, summary) => ({
    schema: "report-data/1", runId: RUN_ID_KO, codename: "brass-lantern", matter: RUN_ID_KO,
    customerKey: "generic", issued: "2026-08-04 · 11:40",
    url: `https://prelim.example/portal/report/${RUN_ID_KO}/${slug}`,
    auditFile: `${RUN_ID_KO}-audit.xlsx`,
    // The knockout shape carries a RENDERED `identity` string beside the level id. The MCP reads
    // `searchLevel` and re-resolves — a stored name is the bug removed. The string here is
    // deliberately WRONG so a test can prove the brief did not read it.
    level: { searchLevel: "knockout-search", stageLabel: "Knockout search", identity: "STALE STORED NAME" },
    overall: band, summary, productContext: null,
    caveats: ["A knockout screen is not a clearance search: register records are listed, not analysed."],
    marks: [{
      name, band, qualifier: qualifier ?? null, classesSearched: [9, 41], classesDriving: [9],
      degraded: false, points: [], findings, registerCounts: null, registerFilings: null,
    }],
  });
  w(join(POOL, RUN_ID_KO, "report-data-project-halcyon.json"), JSON.stringify(koDoc(
    "PROJECT HALCYON", "project-halcyon", "HIGH", "in-class",
    [{ ref: "F1", ordinal: 1, name: "HALCYON", owner: "Halcyon Systems GmbH", band: "HIGH", type: "register", net: "Live EU registration in class 9.", basis: null, evidence: [], shape: "typed" }],
    "",
  ), null, 2));
  w(join(POOL, RUN_ID_KO, "report-data-halcyona.json"), JSON.stringify(koDoc(
    "HALCYONA", "halcyona", "LOW", null, [], "",
  ), null, 2));

  return { WS, runId: RUN_ID_KO, runDir: RUN_DIR_KO, poolDir: join(POOL, RUN_ID_KO) };
}

// A RUN STILL IN FLIGHT — no published output anywhere, in the run dir or the pool. The path that must
// not regress: a client asking about a run mid-flight is told it is mid-flight, never that it is delivered
// and never that it found nothing.
export const RUN_ID_FLIGHT = "tmpflit1-vespera-2026-08-11-tin-kestrel";
const RUN_DIR_FLIGHT = join(STUDIO, "tmpflit1-vespera", "2026-08-11-tin-kestrel");

export function buildInFlightRun() {
  mkdirSync(driverDir(RUN_DIR_FLIGHT), { recursive: true });
  const p = (f) => join(RUN_DIR_FLIGHT, f);
  w(p("matter-context.md"), "# Matter\nClient: Vespera Labs; sector: instruments.\n" + "padding ".repeat(30));
  w(driverDir(RUN_DIR_FLIGHT, "search-policy.json"), JSON.stringify({
    schema: 1, level: "multi-country-focus-search", pipeline: "clearance", stageLabel: "Multi-country focus search",
    components: { registerProbe: false, jxLanes: false, commonLawGrid: true },
  }, null, 2));
  w(p("status.json"), JSON.stringify({
    schema: 1, id: "job4", runId: RUN_ID_FLIGHT, slug: "tmpflit1-vespera", codename: "tin-kestrel", date: "2026-08-11",
    agent: "test", forwarder: "jordan", ref: "TMPFLIT1", markName: "VESPERA", classes: [9],
    state: "running", stepN: 3, stepLabel: "Sweeping the register", stepTotal: 9, verdict: null, url: null,
    startedAt: "2026-08-11T09:00:00Z", updatedAt: "2026-08-11T09:20:00Z",
  }, null, 2) + "\n");
  return { WS, runId: RUN_ID_FLIGHT, runDir: RUN_DIR_FLIGHT };
}
