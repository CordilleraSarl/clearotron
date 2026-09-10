// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the whole mock clearance pipeline to prove a RUN records what the plan preview knew.
//
// WHAT WAS WRONG. An account default territory the engine cannot search was refused at the point of entry,
// named on the profile screen and named in the plan response — and then no run said a word about it. The
// reading has exactly one producer, `defaultTerritoryState` in effective-scope.mjs, and neither run
// pipeline called it: the clearance lane imports `resolveTerritories` from the same module, which passes a
// misspelled account default straight through, and the knockout lane imported nothing from it at all. So a
// firm whose stored default was mistyped got a search narrower than its configuration said, every run, and
// the run's own record was silent. The import graph settled that without a clearance being spent on it.
//
// WHY A LIVE RUN AND NOT A UNIT CALL. The gap was never in the producer — it computes the right answer and
// always did. It was that nothing on the run path ASKED. Only a real run can show the question being
// asked, so this drives the mock pipeline end to end and reads the artifact the run leaves behind.
//
// The arms are a pair on purpose. A profile with a mistyped entry must NAME it; a profile with none must
// still write the file with an empty list. A record that appears only when there is something to say
// cannot be told apart from a record nobody wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

// The customers dir is frozen by profiles.mjs at ITS first import, and the pipeline is imported lazily
// below — so both fixture profiles are written before anything reads the directory.
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-dt-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
const base = JSON.parse(readFileSync(join(PROFILES, "generic.json"), "utf8"));
// "Sitzerland" is the defect in the shape a staff form produces it: a plausible typo, stored unvalidated,
// uppercased and carried. "US" beside it is the control within the control — a list that is PARTLY good
// must report the bad entry without losing the good ones.
writeFileSync(join(PROFILES, "mistyped-default.json"),
  JSON.stringify({ ...base, name: "Mistyped Default Fixture", defaultJurisdictions: ["US", "Sitzerland", "CH"] }, null, 2) + "\n");
writeFileSync(join(PROFILES, "clean-default.json"),
  JSON.stringify({ ...base, name: "Clean Default Fixture", defaultJurisdictions: ["US", "CH"] }, null, 2) + "\n");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

const ROOT = mkdtempSync(join(tmpdir(), "clearotron-mock-dt-"));
const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8451", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function runPipeline(jobPatch = {}) {
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
const sidecar = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "default-territories.json"), "utf8"));

test("a run whose account default the engine cannot search records the entry, by name", async () => {
  const { res, events } = await runPipeline({ profileKey: "mistyped-default" });
  assert.equal(res.ok, true, JSON.stringify(res));

  const rec = sidecar(res.runDir);
  assert.deepEqual(rec.unrecognized, ["Sitzerland"], `the run names the stored entry it cannot search: ${JSON.stringify(rec)}`);
  // the good entries survive — this reports, it does not narrow, and it does not lose the rest of the list
  assert.deepEqual(rec.searchable, ["US", "CH"], "the searchable defaults are recorded beside it, unchanged");
  assert.equal(rec.profileKey, "mistyped-default", "and the record says whose configuration it was");

  // the run's own log carries it, so an operator reading the run sees it without opening the sidecar
  const named = events.filter((e) => e.event === "default-territory-unrecognized");
  assert.equal(named.length, 1, `exactly one event names the drop: ${JSON.stringify(named)}`);
  assert.deepEqual(named[0].entries, ["Sitzerland"]);

  // THE FILE IS DICTATED, not a stray. The run-dir sweep logs any document the driver's own paths() table
  // does not name, and a new artifact is exactly the shape that trips it.
  const strays = events.filter((e) => e.event === "stray-artifact" && /default-territories/.test(String(e.name)));
  assert.deepEqual(strays, [], `the sidecar must be a dictated path: ${JSON.stringify(strays)}`);

  // The instructed scope is UNTOUCHED by this record — the matter frame is ordered to quote that file's
  // values verbatim, so a mistyped stored territory placed there would reach client-facing prose as
  // though the requester had asked for it. The separation is the point, and it is asserted, not assumed.
  const instructed = JSON.parse(readFileSync(driverDir(res.runDir, "instructed-scope.json"), "utf8"));
  assert.ok(!JSON.stringify(instructed).includes("Sitzerland"),
    `the job's own record must not carry a profile diagnostic: ${JSON.stringify(instructed)}`);
  const frame = existsSync(join(res.runDir, "matter-context.md")) ? readFileSync(join(res.runDir, "matter-context.md"), "utf8") : "";
  assert.ok(!frame.includes("Sitzerland"), "and it never reaches the matter frame");
});

test("a run with nothing to report writes the record anyway, as an asserted zero", async () => {
  const { res, events } = await runPipeline({ profileKey: "clean-default" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rec = sidecar(res.runDir);
  assert.deepEqual(rec.unrecognized, [], "an empty list is a value — a reader can tell this run was checked");
  assert.deepEqual(rec.searchable, ["US", "CH"]);
  assert.deepEqual(events.filter((e) => e.event === "default-territory-unrecognized"), [],
    "and nothing is logged when there is nothing to say");
});
