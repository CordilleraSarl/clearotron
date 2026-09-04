// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a full mock clearance through the real runner (the jx shadow units)
// runner.jx-p4-e2e.test.mjs — the jx shadow units end to end through the REAL runner at $0: a
// prelim-jx job (CN in scope) with the SERP-grid and nativeread units armed on fixtures. Proves the
// full shadow chain — frozen dictation, cell accounting + receipts-gate green, code-side mirror
// demotion, judged findings, the grounded read + aim-attention artifact — AND the shadow doctrine
// itself: the register plan carries only the slice-1 fold, synthesis consumed nothing (no
// jx-aim-consumed event; CLEAROTRON_JX_CONSUME off), and a second run with the unit flags dropped grows
// no _driver/jx dir at all.
//
// SAFETY GUARD (2026-07-14 convention): every env var is set BEFORE the dynamic runner import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-jx-p4-e2e-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const root = process.env.CLEAROTRON_WORK_DIR;
const FIXTURES = join(root, "jx-fixtures");
mkdirSync(FIXTURES, { recursive: true });

// slice-1 candidates (one Han candidate keeps the grid small: mark + variants + 1 candidate)
writeFileSync(join(FIXTURES, "velvetstorm.zh.json"), JSON.stringify({ candidates: [
  { term: "丝绒风暴", romanization: "SI RONG FENG BAO", kind: "semantic", rationale: "meaning translation a CN actor would file" },
] }));
// slice-2 serp cells: taobao carries a real listing + a tmkoo register-mirror for the candidate term;
// `default` (explicit) empties every other cell — engine-generated Latin variants can't be enumerated here
writeFileSync(join(FIXTURES, "velvetstorm.zh.serp.json"), JSON.stringify({
  cells: [{ term: "丝绒风暴", platform: "taobao.com", hits: [
    { title: "丝绒风暴 旗舰店", url: "https://item.taobao.com/item/4242", snippet: "product listing" },
    { title: "丝绒风暴 商标注册查询", url: "https://www.tmkoo.com/detail/777", snippet: "register data" },
  ] }],
  default: { hits: [] },
}));
// slice-2 judge: classify whatever ids arrive as listing-candidate (the mirror never reaches it)
writeFileSync(join(FIXTURES, "velvetstorm.zh.judge.json"), JSON.stringify({
  judgments: Array.from({ length: 40 }, (_, id) => ({ id, classification: "listing-candidate", note: "commerce page" })),
}));
// slice-3 read: one item grounded in the grid's taobao listing, one fabricated (must demote to lead)
writeFileSync(join(FIXTURES, "velvetstorm.zh.read.json"), JSON.stringify({ items: [
  { kind: "squatter-flag", record_uri: "https://item.taobao.com/item/4242", analysis_en: "listing uses the semantic form in trade", severity_hint: "high", grounds_en: "grid row" },
  { kind: "conflict-read", record_uri: "https://cnipa.invented/tm/1", analysis_en: "fabricated cite", severity_hint: "high", grounds_en: "" },
  { kind: "cultural-note", record_uri: null, analysis_en: "the semantic form reads as a cosmetics brand register", severity_hint: "low", grounds_en: "slice-wide" },
] }));

for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_JX_LANES: "1", CLEAROTRON_JX_FIXTURES: FIXTURES,
  // item 8 deleted CLEAROTRON_JX_SERP_GRID, CLEAROTRON_JX_NATIVEREAD and CLEAROTRON_JX_CONSUME, so the line
  // that used to arm the units is gone rather than moved. Nothing arms them now: they run whenever the
  // run's product carries the zh lane and the lane is not killed — which this queue entry does by
  // carrying nativeLanguage with a CN jurisdiction. Every assertion below is unchanged, because what
  // they assert (grid receipted, mirror demoted, read grounded, synthesis untouched) never depended on
  // the switch; it depended on the units running, which they now do by default.
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_PLAN_DISPATCH: "off",
  // -6 — a clearance product REFUSES at the run door without the research credential, exactly as
  // it already refuses without a register credential. This job carries commonLawGrid, so it declares
  // both, and for the same reason CORSEARCH_SESSION_KEY above is declared: the engine here is
  // mock-claude.mjs and nothing dials either vendor. A stub value, not a live one.
  PERPLEXITY_API_KEY: "test-offline",
  CLEAROTRON_RECALL_TRIPWIRE: "0", CLEAROTRON_REGISTER_GAP_CLAMP: "0", CLEAROTRON_BAND_TRUTH_GATE: "0",
  CLEAROTRON_SATPROBE_CODESIDE: "0",
})) pinEnv(process.env, k, v);

const { main } = await import("../runner.mjs");
const Q = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
mkdirSync(Q, { recursive: true });

const findRun = (needle) => {
  const hits = [];
  const walk = (d, depth) => {
    if (depth > 7) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (existsSync(driverDir(d, "search-policy.json")) && d.includes(needle)) { hits.push(d); return; }
    for (const e of es) if (e.isDirectory()) walk(join(d, e.name), depth + 1);
  };
  walk(join(root, "workspace-clawdi", "studio", "prelim-search"), 0);
  return hits;
};

test("phase-4 e2e: shadow units run on fixtures — grid receipted + gate green, mirror demoted, read grounded, synthesis untouched, delivered", async () => {
  writeFileSync(join(Q, "p4-run.json"), JSON.stringify({
    id: "p4-run", msgId: "<p4@x>", forwarder: "dev", forwarderDomain: "example.com",
    product: "multi-country-focus-search", nativeLanguage: true, ref: "TMP9300", markName: "VELVETSTORM",
    classes: [3], goods: "cosmetics", jurisdictions: ["CN", "US"],
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.jx-p4-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "p4-run.done")), `queue entry consumed as .done (markers: ${readdirSync(Q).join(",")})`);
  const rd = findRun("velvetstorm")[0];
  assert.ok(rd, "run dir found");
  const jx = (...p) => driverDir(rd, "jx", ...p);

  // slice 2 — the grid: frozen spec, every dictated cell accounted, receipts-gate green
  const spec = JSON.parse(readFileSync(jx("zh-grid-spec.json"), "utf8"));
  assert.ok(spec.terms.includes("VELVETSTORM") && spec.terms.includes("丝绒风暴"), `terms carry the mark + the candidate (${spec.terms.join(", ")})`);
  assert.equal(spec.platforms.at(-1), "web");
  assert.equal(spec.ledger_required, true);
  const grid = JSON.parse(readFileSync(jx("zh-grid.json"), "utf8"));
  assert.equal(grid.cells.length, spec.terms.length * spec.platforms.length, "every cell accounted");
  assert.deepEqual(grid.gaps, []);
  const unit = JSON.parse(readFileSync(jx("units.json"), "utf8")).units;
  assert.equal(unit["serp-grid:zh"].done, true);
  assert.equal(unit["serp-grid:zh"].gates.green, true, `receipts-gate green (${JSON.stringify(unit["serp-grid:zh"].gates.violations)})`);

  // mirror demotion held through the real chain
  const findings = JSON.parse(readFileSync(jx("zh-grid-findings.json"), "utf8"));
  const mirror = findings.findings.find((f) => f.url.includes("tmkoo.com"));
  assert.equal(mirror.classification, "register-mirror", "the tmkoo record page never classifies as use");
  assert.ok(findings.findings.some((f) => f.classification === "listing-candidate"), "the real listing was judged");

  // the corsearch-shape call ledger, run-prefixed
  const calls = readFileSync(jx("serp-calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, grid.cells.length);
  assert.ok(calls.every((c) => /^prelim-.*velvetstorm.*-jx-serp/.test(c.sessionKey)), `run-prefixed sessionKey (${calls[0]?.sessionKey})`);

  // slice 3 — the read: grounded item stands, fabricated cite demoted, slice-wide note grounded
  assert.equal(unit["nativeread:zh"].done, true);
  const aim = JSON.parse(readFileSync(jx("aim-attention.json"), "utf8"));
  assert.equal(aim.items.length, 3);
  assert.equal(aim.items.find((i) => i.kind === "squatter-flag").grounded, true, "grid-listing cite is in the fetched slice");
  assert.equal(aim.items.find((i) => i.kind === "conflict-read").demoted, "lead", "fabricated cite demotes");
  assert.equal(aim.items.find((i) => i.kind === "cultural-note").grounded, true);

  // SHADOW doctrine: the plan carries only the slice-1 fold; synthesis consumed nothing
  const plan = JSON.parse(readFileSync(driverDir(rd, "register-plan.json"), "utf8"));
  assert.equal(plan.entries.filter((e) => e.qid.startsWith("jx-zh-")).length, 1, "one folded candidate query — the grid/read added NOTHING to the plan");
  const events = readFileSync(driverDir(rd, "run.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(events.some((e) => e.event === "jx-serp-grid"), "grid event receipted");
  assert.ok(events.some((e) => e.event === "jx-nativeread"), "read event receipted");
  // THIS ARM ASSERTED A CONFIGURATION PRODUCTION NEVER RAN, and rewriting it the lazy way — keeping
  // "consumed nothing" and calling it unconditional — was wrong within one test run, which is why it is
  // written out. It read `!jx-aim-consumed`, justified as "CLEAROTRON_JX_CONSUME off". ADR-0002 records the
  // posture taken off the production unit on 2026-08-04: CLEAROTRON_JX_CONSUME **true**, against a source
  // default of off. The harness was the only place the off setting existed.
  //
  // That is the exact shape ADR-0002 forbids — "off means the output is different and NOBODY IS TOLD" —
  // and its remedy is not a flipped default: "either the behaviour is unconditional, or the switch and
  // its code are deleted. Defaulting a flag on is not sufficient." item 8 deletes it, so the seam
  // now fires here as it always did in production.
  //
  // SHADOW STILL MEANS SOMETHING, and this is what: a COUNT crosses into synthesis, never the items. The
  // plan assertion above is the other half — the grid and the read add no query to the register plan.
  const consumed = events.filter((e) => e.event === "jx-aim-consumed");
  assert.equal(consumed.length, 1, "the consume seam fires, unconditionally and exactly once — no switch decides it any more");
  assert.equal(consumed[0].items, aim.items.length,
    `what crosses into synthesis is the COUNT of aim items (${aim.items.length}), and the artifact stays where it is`);
  assert.ok(!JSON.stringify(consumed[0]).includes(aim.items[0].kind),
    "…and no item content rides the event — a shadow unit that narrated itself into the journal would reach the reader by the back door");

  // the run itself delivered exactly like slice 1
  assert.equal(JSON.parse(readFileSync(join(rd, "status.json"), "utf8")).state, "delivered");
});

test("the lane kill switch: the SAME process with CLEAROTRON_NATIVE_LANGUAGE_ZH at the EXPLICIT '0' spelling grows NO _driver/jx dir, and SAYS the lane was killed", async () => {
  // WHAT CHANGED AND WHAT DID NOT. This arm set the two per-slice arms to "0" and asserted the run was
  // byte-identical to one with them unset. item 8 deleted both, so that exact claim is untestable
  // and — more to the point — no longer true of the switch that remains. CLEAROTRON_NATIVE_LANGUAGE_ZH is fail-OPEN:
  // unset means ARMED. "0" and unset are OPPOSITES here, so inheriting the old title would have quietly
  // relabelled a narrower property with a stronger name.
  //
  // The hazard the old arm existed for DOES survive and is still worth a test: the off idiom is spelled,
  // not implied, and a reader that treats a non-empty string as truthy silently arms a lane an operator
  // switched off. laneArmed matches OFF_WORDS {0, off, false, no}; "0" is the documented spelling and is
  // the one exercised here.
  //
  // The second half is the part the old arm got backwards for the new world. It asserted SILENCE — no
  // skip rows — because an unarmed opt-in has nothing to say. A killed lane is not an idle lane:
  // shipped a client a coverage statement reading "off in this run's own environment" for a lane that
  // had dispatched, and the fix was that the run records what it did and did not search. Silence about a
  // killed lane is the same defect from the other side, so this asserts the kill is RECORDED.
  process.env.CLEAROTRON_NATIVE_LANGUAGE_ZH = "0";
  writeFileSync(join(FIXTURES, "quietwave.zh.json"), JSON.stringify({ candidates: [
    { term: "静浪", romanization: "JING LANG", kind: "semantic", rationale: "meaning translation" },
  ] }));
  writeFileSync(join(Q, "p4-off.json"), JSON.stringify({
    id: "p4-off", msgId: "<p4off@x>", forwarder: "dev", forwarderDomain: "example.com",
    product: "multi-country-focus-search", nativeLanguage: true, ref: "TMP9301", markName: "QUIETWAVE",
    classes: [3], goods: "cosmetics", jurisdictions: ["CN", "JP"],
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.jx-p4-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "p4-off.done")));
  const rd = findRun("quietwave")[0];
  assert.ok(rd, "control run dir found");
  assert.ok(existsSync(driverDir(rd, "jx-lanes.json")), "slice 1 still runs — killing zh does not kill the lane machinery");
  assert.ok(!existsSync(driverDir(rd, "jx")), "no Phase-4 artifacts at all with the zh lane killed — slices 2 and 3 are zh-only by construction");
  const events = readFileSync(driverDir(rd, "run.jsonl"), "utf8");
  assert.ok(!events.includes("jx-serp-grid-done") && !events.includes("jx-nativeread-done"),
    "and nothing ran — a killed lane dispatches no unit");
  // THE KILL IS ON THE RECORD. The lane sidecar is what the coverage statement is derived from, so a
  // killed lane that simply vanishes from it would deliver as though zh had never been in scope.
  const lanes = JSON.parse(readFileSync(driverDir(rd, "jx-lanes.json"), "utf8"));
  assert.ok("zh" in (lanes.lanes ?? {}),
    `the zh lane must still be DECLARED after being killed — dropping it makes an unsearched lane indistinguishable from an out-of-scope one: ${JSON.stringify(lanes)}`);
  assert.equal(JSON.parse(readFileSync(join(rd, "status.json"), "utf8")).state, "delivered");
});
