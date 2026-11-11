// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives BOTH real publishers and reads the data file each wrote into the pool
//
// A DATA FILE LINKS ITS REPORT WHERE THE PORTAL SERVES IT.
//
// A clearance's data file named its report by the pool's directory layout, `<origin>/<runId>/report.html`,
// and the assistant's brief prints that link for a client's assistant to put in its mail. Production serves
// that address as "not found" (the owner's test, recorded beside reportRouteFor in publish/index.mjs); the
// email, the run record and a Knockout's data file already name the portal route. The owner ruled on
// 2026-11-11 that the clearance's data file names the route too. Both products are driven, so the two
// cannot drift apart again.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the
// env is pinned before any product module is imported.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "data-file-link-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { publishReport } = await import("../publish/index.mjs");
const { publishKnockout } = await import("../publish/knockout.mjs");

const ORIGIN = "https://trademark.test";
const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Moderate", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };
const markDoc = (name) => ({
  name, rating: "Moderate", bullets: ["Invented fixture for the data file's link."],
  findings: [{ ordinal: 1, name: "Look-alike listing", owner: "Invented Owner SA", band: "Moderate",
    net: "A listing under a closely similar name is live on a marketplace.", type: "Active Business", evidence: [] }],
});

async function publish(product) {
  const runDir = join(ROOT, `run-${product}`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `fixture-${product}`, markName: "QUILLMERE" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, findings: [] }));
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ key: `${product}-key` }));
  const poolRoot = join(ROOT, `pool-${product}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0775-2026-11-11-${product}`;
  const common = { runId, codename: product, runDir, poolRoot, poolUrl: ORIGIN, customerKey: `${product}-key`, skipRegen: true };
  if (product === "clearance") await publishReport({ ...common, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  else await publishKnockout({ ...common, findings: { marks: [markDoc("QUILLMERE")] }, framework: FRAMEWORK, overall: "Moderate" });
  return { runId, data: JSON.parse(readFileSync(join(poolRoot, runId, "report-data.json"), "utf8")) };
}

for (const product of ["clearance", "knockout"]) {
  test(`a ${product}'s data file links its report by the portal's route, not the pool's file layout`, async () => {
    const { runId, data } = await publish(product);
    assert.equal(data.url, `${ORIGIN}/portal/report/${runId}/`, `the ${product}'s data file names another address`);
    assert.doesNotMatch(String(data.url), /\/report\.html$/, "the pool's file layout is not an address the portal serves");
  });
}
