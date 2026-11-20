// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONNECTOR ANSWERS WITH WHAT THE REPORT DELIVERED. Publishing binds each finding to the register record the run saved
// for it, and prints a coverage row the run's record repeats once. get_finding and get_search_coverage read the run's
// files from before that, so on a run whose saved record says something else than the assessment wrote, the connector
// gave the assessment's owner, status and classes beside a page that printed the record's, and listed a repeated row
// twice. Both now answer with the report's delivered values, keeping the finding's id, and list each registration a
// finding cites apart. A run published before the report document answers from its files, as before.
//
// The full-country demo is seeded as the connector finds a run, and its first finding's saved record is given an invented
// owner, status and classes before it is published.
//
// SAFETY GUARD: the workspace and the pool are pinned before anything is imported, because the driver config freezes
// its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "connector-delivered-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WS = process.env.CLEAROTRON_WORK_DIR, POOL = process.env.CLEAROTRON_REPORTS_DIR;
const { seedDemoRuns, publishSource, demoChildren } = await import("../../driver/demo-container.mjs");
const { republishRun } = await import("../../driver/publish/report-registry.mjs");
const { paths } = await import("../../driver/run-record.mjs");

const statusFiles = (dir, depth = 0) => (depth > 7 || !existsSync(dir) ? [] : readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (name === "status.json") return [p];
  return statSync(p).isDirectory() && !name.startsWith("_") ? statusFiles(p, depth + 1) : [];
}));

mkdirSync(POOL, { recursive: true });
const examples = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });
seedDemoRuns({ workspace: WS, examplesDir: examples, portalOrigin: "http://127.0.0.1:9" });
const name = demoChildren(examples).find((n) => /full-country/.test(n));
const meta = JSON.parse(readFileSync(join(examples, name, "meta.json"), "utf8"));
const runDir = dirname(statusFiles(WS).find((f) => JSON.parse(readFileSync(f, "utf8")).runId === meta.runId));

// The first finding's saved record, given an owner, status and classes the assessment did not write.
const f1 = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).findings.find((f) => f.ordinal === 1);
const uri = f1.owner.registrations[0].uri;
const recordFile = join(runDir, "_records", `${uri.split("/")[2]}-${uri.split("/")[3]}.json`);
const record = JSON.parse(readFileSync(recordFile, "utf8"));
writeFileSync(recordFile, JSON.stringify({ ...record, owner: "Harrowgate Instruments Ltd", ownerCountry: "GB", statusClass: "dead", statusText: "EXPIRED", niceClasses: [9, 11] }));
await republishRun({ runId: meta.runId, meta, pool: POOL, poolUrl: "", runDir });
const { tools } = await import("../server.mjs");
const { getFinding } = await import("../lib/findings.mjs");

/** The same question with the run's report document set aside, as a run published before it reads. */
async function withoutDocument(ask) {
  const document = paths(runDir).reportDocument;
  renameSync(document, `${document}.aside`);
  try { return await ask(); } finally { renameSync(`${document}.aside`, document); }
}

test("get_finding states the registration facts the report delivered, under the finding's own id", async () => {
  assert.equal(f1.owner.name !== "Harrowgate Instruments Ltd", true, "premise: the assessment wrote another owner");
  const answer = await tools.get_finding({ runId: meta.runId, id: "F1" });
  assert.equal(answer.id, "F1");
  assert.equal(answer.owner, "Harrowgate Instruments Ltd", "the owner is not the one the report delivered");
  assert.equal(answer.owner_country, "GB");
  assert.equal(answer.status, "EXPIRED");
  assert.equal(answer.classes, "9, 11");
  assert.deepEqual(answer.registrations.map((r) => [r.registration, r.status, r.classes]), [[uri, "EXPIRED", ["9", "11"]]],
    "each registration the finding cites is not listed apart with its own facts");
  // A negative result and an audit row keep their meaning: the same answer as the run's audit gives.
  for (const id of ["NR1", "AT1"]) {
    const own = getFinding(paths(runDir), id);
    if (own) assert.deepEqual(await tools.get_finding({ runId: meta.runId, id }), own, `${id} changed`);
  }
  // A run published before the document answers from its files.
  const before = await withoutDocument(() => tools.get_finding({ runId: meta.runId, id: "F1" }));
  assert.equal(before.owner, f1.owner.name);
  assert.equal(before.registrations, undefined);
});

test("get_search_coverage states the rows the report delivered, a repeated row once", async () => {
  const delivered = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8")).client.coverage;
  const written = JSON.parse(readFileSync(join(runDir, "findings.json"), "utf8")).coverage;
  assert.ok(written.length > delivered.length, "premise: the run's record repeats a row the report prints once");
  const { areas } = await tools.get_search_coverage({ runId: meta.runId });
  assert.equal(areas.length, delivered.length, "the coverage answer is not the report's rows");
  assert.deepEqual(areas.map((a) => a.state), delivered.map((r) => r.state));
  const before = await withoutDocument(() => tools.get_search_coverage({ runId: meta.runId }));
  assert.equal(before.areas.length, written.length, "a run published before the document no longer answers from its files");
});
