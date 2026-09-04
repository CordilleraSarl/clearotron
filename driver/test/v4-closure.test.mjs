// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// V4-4 (coverage closure: machine-closable gaps close before synthesis) + V4-5 (actions-reachability).
// Reference case: the delivered S&I report told the lawyer "a targeted re-run before client sign-off is
// the next step" for 91 cells the system knew, could close for ~$0.12, and chose to recommend instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { findCoverageLimitedCells, partitionClosableCells } from "../common-law-receipts.mjs";
import { findCoverageRecommendations } from "../verify.mjs";
import { actionsReachabilityChecks } from "../predelivery-lint.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const FINDINGS = (ledgerExtra = "") => `# Common-law findings

### Negative results (per-platform per-variant)
| Variant | Platform | Result |
|---|---|---|
| novapulse | Steam | not executed — coverage-limited (see ledger) |
| novapulse | web | No results |
| 转码 | Steam | not executed — coverage-limited (see ledger) |

### Coverage ledger
| Coverage unit | Status | Reason |
|---|---|---|
| 6 mandatory gaming platforms | confirmed-clean | 6/6 |${ledgerExtra}
`;

test("findCoverageLimitedCells: sanctioned vocabulary → [{variant, platform}]", () => {
  assert.deepEqual(findCoverageLimitedCells(FINDINGS()), [
    { variant: "novapulse", platform: "Steam" },
    { variant: "转码", platform: "Steam" },
  ]);
});

test("partitionClosableCells: mechanical-error ledger row exempts; bare prose outage does NOT", () => {
  const cells = findCoverageLimitedCells(FINDINGS());
  // mechanical: exception repr covering 转码 → exempt; novapulse stays closable
  const mech = partitionClosableCells(FINDINGS("\n| non-Latin reach (转码) | coverage-limited | TimeoutError('store cell') |"), cells);
  assert.deepEqual(mech.exempt, [{ variant: "转码", platform: "Steam" }]);
  assert.deepEqual(mech.closable, [{ variant: "novapulse", platform: "Steam" }]);
  // bare prose claim — closable until proven otherwise
  const prose = partitionClosableCells(FINDINGS("\n| non-Latin reach (转码) | coverage-limited | platform outage |"), cells);
  assert.equal(prose.exempt.length, 0);
  assert.equal(prose.closable.length, 2);
});

test("findCoverageRecommendations: the S&I line-154 phrasing flags; attempted-and-unreachable prose does not", () => {
  const bad = "Non-Latin transliteration variants were not executed on marketplace platforms; a targeted re-run before client sign-off is the next step.";
  assert.equal(findCoverageRecommendations(bad).length, 1);
  const honest = "Two marketplace cells were attempted twice in-loop and remain unreachable behind a platform timeout; they are recorded in the Coverage ledger.";
  assert.deepEqual(findCoverageRecommendations(honest), []);
  const offTopic = "A re-run of the financial model is the next step for the budget.";  // no marketplace context
  assert.deepEqual(findCoverageRecommendations(offTopic), []);
});

test("V4-5 actionsReachabilityChecks: machine-runnable ask flags; legal-judgment asks stay clean", () => {
  const [bad] = actionsReachabilityChecks({
    onlyYouText: "### Only you can close these\n- Run a register check on Threedust Games' portfolio before signing.\n- Decide the launch window.",
  });
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /Threedust/);
  // the two REAL only-you buckets (flint + garnet) must stay clean — every item is identity/judgment
  const [flint] = actionsReachabilityChecks({
    onlyYouText: `- **[Time-critical — US launch decision]** Confirm the US residual-risk position on High 5 Games' SATIN & BRONZE: decide whether the genre distinction brings the US to manageable — or whether a coexistence or clearance step is needed before US launch.
- Confirm whether the client holds any unregistered prior use of "Satin & Steel" predating High 5 Games' 2013 registration — internal use is invisible to external search.
- Confirm whether RTVE's Class 41 scope (TV and radio programme production and broadcasting) is confusingly similar to gaming entertainment in the Spanish and EU market — a legal proximity judgment that no search can resolve.`,
  });
  assert.equal(flint.pass, true, flint.detail);
  const [garnet] = actionsReachabilityChecks({
    onlyYouText: `- [Time-critical] Confirm whether the client has any unregistered prior use of "Satin & Steel" predating the High 5 SATIN & BRONZE filing date (April 2014) — internal or undocumented prior use is not visible to any external search.
- Confirm whether RTVE's Class 41 broadcasting scope is confusingly similar to gaming entertainment in the ES/EU market — a legal proximity judgment that determines whether the RTVE watchlist item remains off-field or escalates to a rated finding.`,
  });
  assert.equal(garnet.pass, true, garnet.detail);
});

// ── e2e: the closure pass inside the pipeline ───────────────────────────────────────────────────────────

const JOB = {
  id: "closure-job", msgId: "<closure@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8444", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function run(env, id) {
  const root = mkdtempSync(join(tmpdir(), "v4closure-"));
  for (const k of ["MOCK_CL_GAPS", "MOCK_NARRATIVE_RECO", "MOCK_CL_SHORT", "MOCK_REPORT_URI", "MOCK_NO_GRID_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_REGISTER_RECORD_LOG: join(root, "records.jsonl"), ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, id });
  for (const k of ["MOCK_CL_GAPS", "MOCK_NARRATIVE_RECO"]) delete process.env[k];
  let events = [];
  try { events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { /* failed early */ }
  return { res, events };
}

test("V4-4 e2e: closable cells → ONE supplementary pass closes them; receipt written; no front-matter note", async () => {
  const { res, events } = await run({ MOCK_CL_GAPS: "1" }, "closure-ok");
  assert.equal(res.ok, true, JSON.stringify(res));
  const ev = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ requested: ev.requested, closed: ev.closed, remaining: ev.remaining }, { requested: 2, closed: 2, remaining: 0 });
  // A1 split (default on): the closure followup is ROUTED to the half-session owning the missing cells
  // ("common-law-half:a" here — the gap variant is a half-a term); flag-off keeps the bare "common-law".
  assert.ok(events.some((e) => e.event === "stage" && e.stage.startsWith("common-law") && e.trigger === "coverage-closure"), "supplementary pass ran warm on the stage session");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "coverage-closure.json"), "utf8"));
  assert.equal(receipt.closed, 2);
  const fm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n[\s\S]*?\n---/)[0];
  assert.doesNotMatch(fm, /coverage_note/, "closed gaps ship no note");
});

test("V4-4 e2e: persistent gaps ship as the attempted-and-unreachable note with the closable offer (no $ figure)", async () => {
  const { res, events } = await run({ MOCK_CL_GAPS: "persist" }, "closure-persist");
  assert.equal(res.ok, true, JSON.stringify(res));
  const ev = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ requested: ev.requested, remaining: ev.remaining }, { requested: 2, remaining: 2 });
  const fm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n[\s\S]*?\n---/)[0];
  assert.match(fm, /coverage_note:/);
  assert.match(fm, /attempted in-loop and still unreachable/);
  assert.match(fm, /closable on instruction \(\d+ supplementary grid call/);
  assert.doesNotMatch(fm, /[$]/, "tokens-only: the offer names the work, never a price");
});

test("V4-4 e2e: exempt cells (mechanical ledger failure) get NO pass; note names the mechanical cause", async () => {
  const { res, events } = await run({ MOCK_CL_GAPS: "exempt" }, "closure-exempt");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(!events.some((e) => e.event === "stage" && e.trigger === "coverage-closure"), "no pass for exempt cells");
  const ev = events.find((e) => e.event === "coverage-closure");
  assert.deepEqual({ requested: ev.requested, exempt: ev.exempt }, { requested: 0, exempt: 2 });
  const fm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n[\s\S]*?\n---/)[0];
  assert.match(fm, /mechanical platform failure/);
});

test("V4-4 e2e: a narrative recommending a marketplace re-run fails the synthesis gate (receipt exists)", async () => {
  const { res } = await run({ MOCK_CL_GAPS: "persist", MOCK_NARRATIVE_RECO: "1" }, "closure-reco");
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res), /coverage_recommendation/);
});
