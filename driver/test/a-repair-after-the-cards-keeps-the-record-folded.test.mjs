// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery repair end to end on the mock pipeline, with invented names
//
// A REPAIR AFTER THE CARDS KEEPS THE RECORD FOLDED.
//
// Before the overview and the cards are built, the driver folds a second filing of the same conflict into
// one finding. A synthesis save after that seam — the pre-delivery lint's narrative repair, the stale repair
// — wrote the model's own record again, unfolded, and nothing folded it back. Measured on a test run: the
// folded filing stood as its own finding again, every finding after it moved down one place, 19 cards were
// rebuilt for findings that had only moved, and the last finding, owed a full prose card, shipped without
// one because no card had ever been built at its ordinal.
//
// Now the record is folded again on every save after the seam (design, 2026-10-03), so the delivered record
// keeps the fold and every finding owed a prose card gets one.
//
// ON THE 0.4 LINE (ported 2026-10-09): a synthesis repair there re-runs every stage downstream of synthesis,
// every card included (`delivery-stale-repair` lists them all), so whether a card whose finding did not
// change is rebuilt is not this fix's question on this line. The arms that held it, and the repair that
// changes one folded finding, belong to the engine line, where cards go stale per finding.
//
// The scenario, from mock knobs: three findings, the second a second filing of the first
// (MOCK_FINDINGS_N, MOCK_FINDINGS_TWIN); finding 1's write-up is over the cap, so the pre-delivery lint
// re-runs synthesis after the cards are built (MOCK_NARRATIVE_OVER_CAP).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_FINDINGS_TWIN", "MOCK_NARRATIVE_OVER_CAP"];
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_FINDINGS_TWIN: "2",
  MOCK_NARRATIVE_OVER_CAP: "1" };

async function runPipeline(env) {
  const root = tempDir("clearotron-refold-");
  for (const k of MOCK_KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...env })) pinEnv(process.env, k, v);
  const { pipeline, fullProseOrdinals } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, fullProseOrdinals };
}

test("a synthesis repair after the cards were built leaves the folded record folded, and every finding carded", async () => {
  const { res, events, fullProseOrdinals } = await runPipeline(SCENARIO);
  // CONTROLS — the scenario is the one described, or the claims below prove nothing.
  const fresh = events.filter((e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage)) && e.trigger === "fresh");
  assert.deepEqual(fresh.map((e) => e.stage).sort(), ["report-card:1", "report-card:2"],
    "the cards were not built on a folded record of two findings");
  const repair = events.findIndex((e) => e.event === "stage" && e.stage === "synthesis" && e.trigger === "lint-repair");
  assert.ok(repair > events.indexOf(fresh.at(-1)), "no synthesis repair ran after the cards were built");

  // THE CLAIMS.
  const doc = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  assert.equal(doc.findings.length, 2, `the repair unfolded the record: ${doc.findings.length} findings delivered`);
  const one = doc.findings.find((f) => f.ordinal === 1);
  assert.deepEqual((one?.owner?.registrations ?? []).map((r) => r.uri).sort(), ["/mark/us/90000001", "/mark/us/90000002"],
    "finding 1 does not hold the second filing");
  const cards = existsSync(join(res.runDir, "report-cards")) ? readdirSync(join(res.runDir, "report-cards")) : [];
  const uncarded = fullProseOrdinals(doc.findings).filter((o) => !cards.includes(`${o}.md`));
  assert.deepEqual(uncarded, [], `findings owed a prose card shipped without one: ${uncarded.join(", ")}`);
  assert.equal(res.ok, true, JSON.stringify(res));
});
