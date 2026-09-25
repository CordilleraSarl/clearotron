// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT OWNER LOOKUP THAT GOT NO ANSWER IS IN ITS AUDIT TRAIL (ruled 2026-09-25). The card still prints
// its use-check line whether the lookup answered or not, so a lookup that failed shipped with nothing saying
// so. It is now a row on the workbook's Audit Trail, in the trail's own columns: the query it asked, marked
// Degraded, with the reader's line for a search left open and never the raw cause. A run whose lookups all
// answered builds the trail it built before. Driven through the knockout lane itself, read from the workbook
// it published.
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "owner-lookup-trail-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AGENT = "clawdi";
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

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const OWNER_QUESTION = /What goods or services does the company "Brightmoor Candle Co"/;

async function knockout(codename, { lookupAnswers }) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-09-25-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-09-25", codename, archiveDir: join(studioRoot, "archive", `2026-09-25-${codename}`) };
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "clawdi", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, {
    recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
    countExecutor: async () => ({ ok: true, total: 3 }),
    sweepExecutor: async (task) => (OWNER_QUESTION.test(task) && !lookupAnswers
      ? { ok: false, cause: "HTTP 503: the provider is down" }
      : { ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
  });
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  const book = readdirSync(join(ROOT, "pool"), { recursive: true })
    .find((p) => String(p).endsWith(`knockout-audit-${codename}.xlsx`));
  assert.ok(book, "the knockout published no workbook");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(ROOT, "pool", book));
  const ws = wb.getWorksheet("Audit Trail");
  const head = ws.getRow(1).values.slice(1);
  const trail = [];
  ws.eachRow((row, n) => { if (n > 1) trail.push(Object.fromEntries(head.map((h, i) => [h, String(row.values[i + 1] ?? "")]))); });
  return trail;
}

test("an owner lookup that got no answer is a Degraded row on the Audit Trail, in the reader's words", async () => {
  const trail = await knockout("lookup-failed", { lookupAnswers: false });
  const row = trail.find((r) => OWNER_QUESTION.test(r["Search Term"]));
  assert.ok(row, `no trail row for the failed owner lookup: ${JSON.stringify(trail)}`);
  assert.equal(row["OK/Degraded"], "Degraded");
  assert.equal(row["Mark"], "LANTERNWICK");
  assert.equal(row["Result Summary"], "FAILED — it could not be completed this run, so it is left open here rather than reported as clean");
  assert.ok(!/503|provider is down/.test(JSON.stringify(row)), "the raw cause reached a reader's cell");
});

test("THE CONTROL: a knockout whose lookups all answered has no lookup row, as before", async () => {
  const trail = await knockout("lookup-answered", { lookupAnswers: true });
  assert.equal(trail.filter((r) => OWNER_QUESTION.test(r["Search Term"])).length, 0);
  assert.ok(trail.length > 0 && trail.every((r) => r["OK/Degraded"] === "OK"), `the trail is not the clean run's: ${JSON.stringify(trail)}`);
});
