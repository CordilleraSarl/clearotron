// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the knockout lane on the mock engine
//
// A KNOCKOUT PUBLISHES ONCE, AS A CLEARANCE DOES.
//
// A clearance records its publish result in `.published`, and a resume that finds it delivers what was published
// (run-delivered.mjs). A knockout recorded nothing, so a run stopped between its publish and its delivery record
// published a second time when it resumed. It now records the result the same way, and a resume that finds the
// record delivers from it. These arms drive the knockout lane itself, with the engine mocked and nothing dialled.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-publishes-once-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };

/** One knockout through the lane, with `plant` run on its run directory first. */
async function knockout(codename, { plant = () => {} } = {}) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-10-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  plant(dir);
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-10", codename, archiveDir: join(studioRoot, "archive", `2026-11-10-${codename}`) };
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, {
    recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
    countExecutor: async () => ({ ok: true, total: 3 }),
    gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
    sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
  });
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  return res;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const published = (codename) => readdirSync(join(ROOT, "pool"), { recursive: true }).filter((p) => String(p).endsWith(`knockout-audit-${codename}.xlsx`));
const events = (runDir, name) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.event === name);

test("a knockout that publishes records what it published, and delivers that", async () => {
  const res = await knockout("records-it");
  const record = readJson(join(res.runDir, ".published"));
  assert.ok(record.ts, "the record says when it was written, as every sentinel does");
  assert.equal(record.url, res.url);
  assert.deepEqual(record.reports.map((r) => r.url), res.reports.map((r) => r.url));
  const delivery = readJson(driverDir(res.runDir, "delivery.json"));
  assert.deepEqual(delivery.reports, record.reports.map((r) => ({ mark: r.mark, url: r.url })), "the delivery names what was published");
  assert.equal(published("records-it").length, 1, "premise: the run published its workbook");
  assert.equal(events(res.runDir, "knockout-published").length, 1);
});

test("a knockout resumed after it published delivers the recorded result and publishes nothing again", async () => {
  const poolRunDir = mkdtempSync(join(ROOT, "pool-run-"));
  const stored = { runId: "lanternwick-2026-11-10-already-out", url: "https://reports.example.test/already-out/report.html",
    reports: [{ mark: "LANTERNWICK", url: "https://reports.example.test/already-out/report.html" }],
    auditUrl: "https://reports.example.test/already-out/audit.xlsx", auditFile: null, auditError: null,
    poolRunDir, statement: "Published before the stop.", total: 1, qcFlags: [], receipts: 0 };
  const res = await knockout("already-out", { plant: (dir) => writeFileSync(join(dir, ".published"), JSON.stringify({ ts: "2026-11-10T18:00:00.000Z", ...stored })) });
  assert.equal(res.url, stored.url, "the resumed run delivers the recorded publish");
  assert.equal(published("already-out").length, 0, "nothing was published a second time");
  assert.equal(events(res.runDir, "knockout-published").length, 0, "no second publish in the run's journal");
  const delivery = readJson(driverDir(res.runDir, "delivery.json"));
  assert.equal(delivery.url, stored.url);
  assert.deepEqual(delivery.reports, stored.reports);
  assert.match(delivery.emailBodyHtml, /already-out\/audit\.xlsx/, "the email links the recorded audit workbook");
  assert.equal(readJson(join(res.runDir, ".delivered")).url, stored.url);
  const stamped = readdirSync(poolRunDir);
  assert.equal(stamped.length, 1, "the delivered state is stamped on the recorded pool folder");
  assert.equal(readJson(join(poolRunDir, stamped[0])).runId, stored.runId);
});
