// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a full mock clearance through the real runner (zh lane)
// runner.jx-e2e.test.mjs — the zh candidate lane end to end through the REAL runner at $0: a prelim-jx job
// (CN in scope) runs the FULL mock clearance with the zh candidate lane on fixtures — the frozen lane
// decision, the fold onto transliteration-numeric, the auto-spawned unit, receipts/ledger — and a
// plain-prelim control job in the same process proves the component gate (no jx artifacts at all).
//
// SAFETY GUARD (2026-07-14 convention): every env var is set BEFORE the dynamic runner import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-jx-e2e-")));
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
// the canned zh candidates for NOVAPULSE — the $0 seam (one phonetic, one nickname, one Latin echo the
// script gate must refuse)
writeFileSync(join(FIXTURES, "novapulse.zh.json"), JSON.stringify({ candidates: [
  { term: "诺瓦脉冲", romanization: "NUO WA MAI CHONG", kind: "phonetic", rationale: "sound-alike a CN distributor would file" },
  { term: "诺瓦", romanization: "NUO WA", kind: "nickname", rationale: "two-character market shorthand" },
  { term: "NOVAPULSE", romanization: "NOVAPULSE", kind: "phonetic", rationale: "latin echo — must be refused" },
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

test("prelim-jx e2e: frozen zh lane → fixture candidates → fold on transliteration-numeric → unit spawned → delivered", async () => {
  writeFileSync(join(Q, "jx-run.json"), JSON.stringify({
    id: "jx-run", msgId: "<jx@x>", forwarder: "dev", forwarderDomain: "example.com",
    product: "multi-country-focus-search", nativeLanguage: true, ref: "TMP9200", markName: "NOVAPULSE",
    classes: [9], goods: "game software", jurisdictions: ["CN", "US"],
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.jx-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "jx-run.done")), `queue entry consumed as .done (markers: ${readdirSync(Q).join(",")})`);
  const dirs = findRun("novapulse");
  assert.equal(dirs.length, 1, `expected one novapulse run dir, got: ${dirs.join(" | ")}`);
  const rd = dirs[0];

  const sp = JSON.parse(readFileSync(driverDir(rd, "search-policy.json"), "utf8"));
  assert.equal(sp.level, "multi-country-focus-search");
  assert.equal(sp.pipeline, "clearance");

  // the frozen lane decision + the fold receipt
  const jx = JSON.parse(readFileSync(driverDir(rd, "jx-lanes.json"), "utf8"));
  assert.deepEqual(Object.keys(jx.lanes), ["zh"]);
  assert.deepEqual(jx.lanes.zh.jurisdictions, ["CN"], "US routes nowhere; CN routes zh");
  assert.equal(jx.fold.lanes.zh.accepted.length, 2, "two Han-script candidates accepted");
  assert.ok(jx.fold.lanes.zh.refused.some((r) => /not wholly Han-script/.test(r.reason)), "the Latin echo was refused, receipted");
  assert.ok(Array.isArray(jx.fold.lanes.zh.cnipaSubgroups), "CNIPA awareness rides the receipt");

  // the ledger (tokens/counts only)
  const ledger = readFileSync(driverDir(rd, "jx-completions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].ok, true);
  assert.equal(ledger[0].candidates, 3);

  // the fold landed on the frozen plan: jx-zh qids, transliteration-numeric, exact, CN-scoped
  const plan = JSON.parse(readFileSync(driverDir(rd, "register-plan.json"), "utf8"));
  const jxEntries = plan.entries.filter((e) => e.qid.startsWith("jx-zh-"));
  assert.equal(jxEntries.length, 2);
  assert.ok(jxEntries.every((e) => e.axis === "transliteration-numeric" && e.predicate === "exact"));
  // The Latin equivalent rides alongside the characters — this index has no character index at all,
  // so without it the whole lane answers 0 with no error (see providers/clarivate/src/core.js).
  assert.deepEqual(jxEntries.find((e) => e.term === "诺瓦").romanizedTerms, ["NUO WA", "NUOWA"]);
  assert.deepEqual(jxEntries[0].regions, ["CN"]);

  // axis-from-plan spawned the unit; the run delivered
  assert.ok(existsSync(join(rd, "register-units", "transliteration-numeric.md")), "the transliteration-numeric unit ran");
  const status = JSON.parse(readFileSync(join(rd, "status.json"), "utf8"));
  assert.equal(status.state, "delivered", `run state: ${status.state} (${status.reason ?? ""})`);
});

test("component gate: a clearance without the investigation, in the SAME process (env still on), grows NO jx artifacts", async () => {
  // TWO countries, one of them CN. The scope still ROUTES a zh lane and the env is still on — so what
  // decides is the PRODUCT's component and nothing else, which is the whole claim of this test.
  //
  // It used to name CN alone, and asserted the run froze as a Global preliminary search. That assertion
  // was the freeze bug: the wall admitted one country as a Full country search (case law, native
  // language, 2.5h) and attachSearchPolicy re-resolved against an EMPTY scope and froze the worldwide
  // product over it. A Full country search carries the investigation automatically, so the one-country
  // shape can never be this test's subject; a Multi-country focus search without the toggle is.
  writeFileSync(join(Q, "plain-run.json"), JSON.stringify({
    id: "plain-run", msgId: "<plain@x>", forwarder: "dev", forwarderDomain: "example.com",
    ref: "TMP9201", markName: "QUIETMARK", classes: [9], goods: "game software", jurisdictions: ["CN", "FR"],
  }));
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.jx-e2e.test.mjs");
  assert.ok(existsSync(join(Q, "plain-run.done")));
  const rd = findRun("quietmark")[0];
  assert.ok(rd, "plain run dir found");
  const frozen = JSON.parse(readFileSync(driverDir(rd, "search-policy.json"), "utf8"));
  assert.equal(frozen.level, "multi-country-focus-search", "the scope names the product, at the freeze as at the wall");
  assert.equal(frozen.components.jxLanes, false, "the toggle was not ticked, so the investigation is not part of this search");
  assert.ok(!existsSync(driverDir(rd, "jx-lanes.json")), "no lane sidecar — a plain prelim never touches jx machinery");
  assert.ok(!existsSync(driverDir(rd, "jx-completions.jsonl")), "no ledger");
  const plan = JSON.parse(readFileSync(driverDir(rd, "register-plan.json"), "utf8"));
  assert.ok(plan.entries.every((e) => !e.qid.startsWith("jx-")), "no jx entries in the plan");
});
