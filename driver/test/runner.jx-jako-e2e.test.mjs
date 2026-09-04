// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a full mock clearance through the real runner (ja/ko lanes)
// runner.jx-jako-e2e.test.mjs — the ja/ko slice-1 lanes end to end through the REAL runner at $0
// (2026-07-22, the runner.jx-e2e mould): ONE prelim-jx job with JP+KR+US in scope runs the full mock
// clearance with BOTH new lanes on fixtures — frozen two-lane decision, per-lane folds onto
// transliteration-numeric, per-lane script gates (Latin echo refused in each), one ledger row per
// lane — and proves zh stays out when no CN-family territory is in scope.
//
// SAFETY GUARD (2026-07-14 convention): every env var is set BEFORE the dynamic runner import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-jx-jako-e2e-")));
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
// canned candidates per lane: one good phonetic, one nickname, one Latin echo the script gate must
// refuse — plus, for ja, a katakana form carrying the phonemic ー (must pass).
writeFileSync(join(FIXTURES, "novapulse.ja.json"), JSON.stringify({ candidates: [
  { term: "ノヴァパルス", romanization: "NOVAPARUSU", kind: "phonetic", rationale: "standard katakana form" },
  { term: "ノーヴァ", romanization: "NOOVA", kind: "nickname", rationale: "clipped market form with long-vowel mark" },
  { term: "NOVAPULSE", romanization: "NOVAPULSE", kind: "phonetic", rationale: "latin echo — must be refused" },
] }));
writeFileSync(join(FIXTURES, "novapulse.ko.json"), JSON.stringify({ candidates: [
  { term: "노바펄스", romanization: "NOBAPEOLSEU", kind: "phonetic", rationale: "standard hangul form" },
  { term: "노바", romanization: "NOBA", kind: "nickname", rationale: "clipped market form" },
  { term: "노바 PULSE", romanization: "NOBA PULSE", kind: "phonetic", rationale: "mixed echo — must be refused" },
] }));

for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_JX_LANES: "1", CLEAROTRON_JX_FIXTURES: FIXTURES,
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

test("prelim-jx e2e: JP+KR scope → frozen ja+ko lanes → per-lane fixture folds → both script gates enforce → delivered; zh stays out", async () => {
  writeFileSync(join(Q, "jako-run.json"), JSON.stringify({
    id: "jako-run", msgId: "<jako@x>", forwarder: "dev", forwarderDomain: "example.com",
    product: "multi-country-focus-search", nativeLanguage: true, ref: "TMP9300", markName: "NOVAPULSE",
    classes: [9], goods: "fitness wearables", jurisdictions: ["JP", "KR", "US"],
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.jx-jako-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "jako-run.done")), `queue entry consumed as .done (markers: ${readdirSync(Q).join(",")})`);
  const dirs = findRun("novapulse");
  assert.equal(dirs.length, 1, `expected one novapulse run dir, got: ${dirs.join(" | ")}`);
  const rd = dirs[0];

  const sp = JSON.parse(readFileSync(driverDir(rd, "search-policy.json"), "utf8"));
  assert.equal(sp.level, "multi-country-focus-search");

  // the frozen TWO-lane decision — and zh not among them (no CN-family territory in scope)
  const jx = JSON.parse(readFileSync(driverDir(rd, "jx-lanes.json"), "utf8"));
  assert.deepEqual(Object.keys(jx.lanes).sort(), ["ja", "ko"]);
  assert.deepEqual(jx.lanes.ja.jurisdictions, ["JP"]);
  assert.deepEqual(jx.lanes.ko.jurisdictions, ["KR"]);

  // per-lane folds: 2 accepted each, the echo refused with the lane's own script message
  assert.equal(jx.fold.lanes.ja.accepted.length, 2, "ja: standard + ー-carrying nickname accepted");
  assert.ok(jx.fold.lanes.ja.refused.some((r) => /not wholly Japanese-script/.test(r.reason)), "ja Latin echo refused, receipted");
  assert.equal(jx.fold.lanes.ko.accepted.length, 2);
  assert.ok(jx.fold.lanes.ko.refused.some((r) => /not wholly Hangul-script/.test(r.reason)), "ko mixed echo refused, receipted");

  // one ledger row per lane (tokens/counts only)
  const ledger = readFileSync(driverDir(rd, "jx-completions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(ledger.length, 2, "one completions call per lane");
  assert.ok(ledger.every((l) => l.ok === true));

  // both folds landed on the frozen plan, region-scoped to their own territory
  const plan = JSON.parse(readFileSync(driverDir(rd, "register-plan.json"), "utf8"));
  const jaEntries = plan.entries.filter((e) => e.qid.startsWith("jx-ja-"));
  const koEntries = plan.entries.filter((e) => e.qid.startsWith("jx-ko-"));
  assert.equal(jaEntries.length, 2);
  assert.equal(koEntries.length, 2);
  assert.ok([...jaEntries, ...koEntries].every((e) => e.axis === "transliteration-numeric" && e.predicate === "exact"));
  assert.deepEqual(jaEntries[0].regions, ["JP"]);
  assert.deepEqual(koEntries[0].regions, ["KR"]);
  assert.ok(plan.entries.every((e) => !e.qid.startsWith("jx-zh-")), "no zh entries — CN not in scope");

  // — the other direction of the lane-general coverage row, on the SAME runner path: both lanes
  // folded real candidates here (2 each, asserted above), so both lanes searched, so NEITHER owes a
  // not-searched row. Paired with the ja/ko rows the kill-switch test below asserts, this is the
  // per-lane predicate answering both ways end to end rather than only refusing to fire.
  const covRan = JSON.parse(readFileSync(join(rd, "findings.json"), "utf8")).coverage ?? [];
  assert.ok(!covRan.some((c) => /(Japanese|Korean)-script register equivalents/.test(String(c?.area ?? ""))),
    `both lanes ran — nothing to disclose. areas: ${covRan.map((c) => c?.area).join(" | ")}`);

  // axis-from-plan spawned the unit; the run delivered
  assert.ok(existsSync(join(rd, "register-units", "transliteration-numeric.md")), "the transliteration-numeric unit ran");
  const status = JSON.parse(readFileSync(join(rd, "status.json"), "utf8"));
  assert.equal(status.state, "delivered", `run state: ${status.state} (${status.reason ?? ""})`);
});

test("per-lane kill switch: CLEAROTRON_NATIVE_LANGUAGE_KO=0 excludes ko at the fold while ja still runs", async () => {
  process.env.CLEAROTRON_NATIVE_LANGUAGE_KO = "0";
  try {
    writeFileSync(join(Q, "jaonly-run.json"), JSON.stringify({
      id: "jaonly-run", msgId: "<jaonly@x>", forwarder: "dev", forwarderDomain: "example.com",
      product: "multi-country-focus-search", nativeLanguage: true, ref: "TMP9301", markName: "NOVAPULSE JA ONLY",
      classes: [9], goods: "fitness wearables", jurisdictions: ["JP", "KR"],
    }));
    await main({ once: true });
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.jx-jako-e2e.test.mjs");
    assert.ok(existsSync(join(Q, "jaonly-run.done")));
    const rd = findRun("novapulse-ja-only")[0];
    assert.ok(rd, "ja-only run dir found");
    const jx = JSON.parse(readFileSync(driverDir(rd, "jx-lanes.json"), "utf8"));
    assert.deepEqual(Object.keys(jx.lanes).sort(), ["ja", "ko"], "the DECISION still records both lanes (scope is scope)");
    assert.ok(jx.fold.lanes.ja, "ja folded");
    assert.ok(!jx.fold.lanes.ko?.accepted?.length, "ko folded nothing — lane env kill honored");
    const plan = JSON.parse(readFileSync(driverDir(rd, "register-plan.json"), "utf8"));
    assert.ok(plan.entries.every((e) => !e.qid.startsWith("jx-ko-")), "no ko entries in the plan");

    // — the lane-general coverage row, END TO END on a run that reached JP and KR. Neither lane
    // searched anything here: ko was killed by the env switch, and ja's fold DEGRADED to zero accepted
    // candidates (this run's mark has no fixture, which is why `accepted` is empty above). Two
    // different causes, one fact — nothing was searched in either script — so both rows are owed.
    //
    // Before this run disclosed NOTHING about Japanese or Korean script. Silence there is
    // indistinguishable from "there was nothing to search", which is the defect is about.
    // Note what the degraded ja lane proves: the predicate is the fold's ACCEPTED candidates, not the
    // frozen lane decision. A lane that was nominally on and folded nothing still owes its row.
    //
    // This is a MOCK scenario on fixtures. No scheduled E2E scenario instructs JP or KR, so nothing
    // here is evidence that either lane has run on a real matter.
    const cov = JSON.parse(readFileSync(join(rd, "findings.json"), "utf8")).coverage ?? [];
    const areas = cov.map((c) => String(c?.area ?? ""));
    for (const script of ["Japanese", "Korean"]) {
      assert.ok(areas.some((a) => new RegExp(`${script}-script register equivalents`).test(a)),
        `${script}-script row owed — that lane accepted no candidates. areas: ${areas.join(" | ")}`);
    }
    assert.ok(!areas.some((a) => /Chinese-script register equivalents/.test(a)), "no CN-family territory in scope");
    assert.ok(cov.filter((c) => /(Japanese|Korean)-script register equivalents/.test(String(c?.area ?? "")))
      .every((c) => c.state === "coverage-limited"), "a disclosed limit, never the clamping `deferred`");
  } finally {
    delete process.env.CLEAROTRON_NATIVE_LANGUAGE_KO;
  }
});
