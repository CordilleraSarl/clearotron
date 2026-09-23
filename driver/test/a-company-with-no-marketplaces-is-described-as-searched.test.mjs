// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real publisher and reads what it wrote into the pool
//
// A company may pick no marketplaces (the owner's ruling of 2026-09-23). Its searches still covered
// marketplaces through the general web search, and through any stores the engine chose for the matter, so
// the summary line says that rather than naming a marketplace search nobody picked. The fact comes from the
// run's frozen profile, which is the list the run actually searched; a run with no frozen profile keeps
// today's words.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "no-marketplaces-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { publishReport } = await import("../publish/index.mjs");

async function publish(tag, profile) {
  const runDir = join(ROOT, `run-${tag}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${tag}`, markName: "TIMBER" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, findings: [] }));
  if (profile) writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify(profile));
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0899-2026-09-23-${tag}`;
  await publishReport({ runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: "harbour",
    skipRegen: true, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  const read = (name) => JSON.parse(readFileSync(join(poolRoot, runId, name), "utf8"));
  return { data: read("report-data.json"), depth: read("search-depth.json") };
}

test("a run whose company picked no marketplaces says the general web ran, plus any stores chosen", async () => {
  const { data, depth } = await publish("none", { key: "harbour", platforms: [] });
  assert.match(data.jurisdiction, /\(register\) \+ common-law \(Western web \/ social, plus any stores chosen for this matter\)$/);
  assert.equal(depth.counts.sweep.noMarketplacesPicked, true, "the report's two lines read this flag");
});

test("THE CONTROL: a company with marketplaces, and a run with no frozen profile, keep today's words", async () => {
  for (const [tag, profile] of [["some", { key: "harbour", platforms: ["etsy.com"] }], ["legacy", null]]) {
    const { data, depth } = await publish(tag, profile);
    assert.match(data.jurisdiction, /\(register\) \+ common-law \(Western web \/ marketplace \/ social\)$/, tag);
    assert.equal("noMarketplacesPicked" in depth.counts.sweep, false, `${tag}: the record keeps its earlier shape`);
  }
});
